// Runs the traffic and draws it: one instanced mesh per vehicle type, plus the signal heads.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, InstancedBufferAttribute, InstancedMesh, MeshStandardMaterial, Object3D, ShaderMaterial } from 'three';
import { place, type Lane, type Net, type V } from './net';
import { Heat, Journeys } from './Traffic';
import { PARKED, Sim, signal } from './sim';
import { HOUR, NIGHT, NOW } from './haze';
import { beam, makeTypes } from './vehicles';
import { Glow, type GlowHandle, type Wall } from './Glow';
import { Works } from './Works';
import { settle, SOAKED, wet } from './wet';

/** How much faster than life the traffic runs, as a timelapse. */
export const TIMELAPSE = 60;

const tmp = new Color();
const SIG = { G: new Color(0x2dff7a), Y: new Color(0xffc21a), R: new Color(0xff2a1a) };
/** a lamp that is not lit */
const OUT = new Color(0x0d0e10);
const LAMPS = ['R', 'Y', 'G'] as const;

/** How the lamps of an emergency vehicle flash: side 1 three times, then side 2 three times, so many rounds a second. GLSL, `t` in seconds. */
const FLASH = /* glsl */ `
  float blink(float side, float t) {
    float ph = fract(t * 1.7 + side * 0.5);
    return step(ph, 0.5) * step(0.35, fract(ph * 6.0));
  }`;

/**
 * Body paint, and after dark the lamps at either end: on for whoever is driving, off for whoever is parked.
 * The lamps on the roof of an emergency vehicle flash, and by day as well.
 */
function bodywork() {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.25 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = NIGHT;
    s.uniforms.uNow = NOW;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 glow; attribute float aLit, flash; uniform float uNow; varying vec3 vGlow, vFlash;' + FLASH)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = flash > 0.5 ? vec3(0.0) : glow * aLit; vFlash = flash > 0.5 ? glow * blink(flash - 1.0, uNow) : vec3(0.0);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight; varying vec3 vGlow, vFlash;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * uNight + vFlash * (0.45 + 0.55 * uNight);');
  };
  m.customProgramCacheKey = () => 'bodywork';
  return m;
}

/** What the head lamps show of the road: no light, only a glow laid on the ground ahead of every vehicle that is under way. */
function headlight() {
  return new ShaderMaterial({
    uniforms: { uNight: NIGHT },
    vertexShader: /* glsl */ `
      attribute float aLit;
      varying vec2 vUv; varying float vLit;
      void main() { vUv = uv; vLit = aLit; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying vec2 vUv; varying float vLit;
      void main() {
        float across = 1.0 - vUv.y * vUv.y, along = smoothstep(0.0, 0.05, vUv.x) * (1.0 - vUv.x);
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.72) * across * across * along * along * vLit * uNight * BEAM, 1.0);
      }`,
    defines: { BEAM: '0.5' },
    blending: AdditiveBlending, transparent: true, depthWrite: false,
  });
}

/**
 * What the flashing lamps throw around an emergency vehicle: blue to one side and red to the other, in turn.
 * No light, a glow hung over its roof, so that it is seen from the drone by day too.
 */
function siren() {
  return new ShaderMaterial({
    uniforms: { uNight: NIGHT, uNow: NOW },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uNight, uNow;
      varying vec2 vUv;
      ${FLASH}
      void main() {
        float a = length(vUv - vec2(0.0, -0.3)), b = length(vUv - vec2(0.0, 0.3));
        vec3 c = vec3(0.08, 0.3, 1.0) * exp(-a * a * 9.0) * blink(0.0, uNow) + vec3(1.0, 0.06, 0.03) * exp(-b * b * 9.0) * blink(1.0, uNow);
        gl_FragColor = vec4(c * (1.0 - smoothstep(0.7, 1.0, length(vUv))) * mix(HALO_DAY, HALO_NIGHT, uNight), 1.0);
      }`,
    defines: { HALO_DAY: '1.1', HALO_NIGHT: '1.0' },
    blending: AdditiveBlending, transparent: true, depthWrite: false,
  });
}
/** How wide that glow is, metres, and how many emergency vehicles can be out at once. */
const HALO = 20, SIRENS = 18;

/** How many stretches of its way a vehicle's lights are drawn over, and how many stretches there are for all of them. */
const TRAIL = 8, STREAKS = 2400 * (place.on ? 3 : 1);

/**
 * A long exposure: the lamps drawn out along the way the vehicle came, red at the edges and warm between, fading with age.
 * Geometry, not a pass over the picture: a strip for each of the last few frames of each vehicle's way.
 */
function streak() {
  return new ShaderMaterial({
    uniforms: { uNight: NIGHT },
    vertexShader: /* glsl */ `
      attribute vec2 aAge; attribute float aHue;
      varying vec2 vUv; varying float vK, vHue;
      void main() { vUv = uv; vHue = aHue; vK = mix(aAge.x, aAge.y, uv.x); gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying vec2 vUv; varying float vK, vHue;
      void main() {
        float y = abs(vUv.y), lamp = smoothstep(0.35, 0.7, y) * (1.0 - smoothstep(0.8, 1.0, y)), mid = 1.0 - smoothstep(0.0, 0.6, y);
        vec3 c = vec3(1.0, 0.1, 0.04) * lamp * 1.5 + vec3(1.0, 0.72, 0.4) * mid * 0.55;
        // an emergency vehicle leaves its flashes behind: a stretch of blue, a stretch of red
        if (vHue > 0.5) c = (vHue > 1.5 ? vec3(1.0, 0.08, 0.04) : vec3(0.1, 0.35, 1.0)) * (1.0 - y * y) * 2.4;
        gl_FragColor = vec4(c * vK * vK * uNight * STREAK, 1.0);
      }`,
    defines: { STREAK: '0.9' },
    blending: AdditiveBlending, transparent: true, depthWrite: false,
  });
}

/** One stretch of a trail: from x = 0 where the vehicle is now to x = 1 where it was, a lamp's width either side. */
function strip() {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(Float32Array.from([0, 0, -1, 0, 0, 1, 1, 0, 1, 1, 0, -1]), 3));
  g.setAttribute('uv', new BufferAttribute(Float32Array.from([0, -1, 0, 1, 1, 1, 1, -1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** A flat square, a metre to every side of the middle. */
function pad() {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(Float32Array.from([-1, 0, -1, -1, 0, 1, 1, 0, 1, 1, 0, -1]), 3));
  g.setAttribute('uv', new BufferAttribute(Float32Array.from([-1, -1, -1, 1, 1, 1, 1, -1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

const NO_WALLS: Wall[] = [];

/** `speed` is how fast time goes: TIMELAPSE, or 0 for a still. */
export function Cars({ net, speed, target, trail = 0, glow = false, walls = NO_WALLS, onGlowFail, heat = false, trace = null, shade = true, onNote, onSim }: {
  /** told which simulation this is, for the buttons of ?debug */
  onSim?: (sim: Sim) => void;
  /** the same lights as a long exposure on a WebGPU canvas of its own (Glow.tsx) instead of as strips here, and what hides them */
  glow?: boolean;
  walls?: Wall[];
  onGlowFail?: () => void;
  /** seconds of their time the lights stay on the picture at night, as in a long exposure; 0 for none */
  trail?: number;
  /** do they cast shadows: not when the shadows are only drawn now and then, where theirs would trail behind */
  shade?: boolean;
  net: Net; speed: number;
  /** roughly how many vehicles to keep on the roads */
  target: number;
  heat?: boolean;
  /** a point on the stretch whose traffic is being followed */
  trace?: V | null;
  onNote?: (text: string) => void;
}) {
  const rate = useRef(speed);
  rate.current = speed;
  const types = useMemo(makeTypes, []);
  // one simulation for the life of the page: when the roads change, the traffic moves over to them
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sim = useMemo(() => new Sim(net, types), [types]);
  // and while a smear is dragged it is drawn pushed with the road under it, until it has moved over
  // where the window of tiles lay when the traffic was last put on its roads
  const lay = useRef({ x: place.x, y: place.y });
  useLayoutEffect(() => {
    sim.setNet(net);
    const was = lay.current;
    if (place.on && (was.x !== place.x || was.y !== place.y)) {
      // the tiles that have come into the window are not left empty until someone drives in
      sim.fill((p) => Math.abs(p.x - was.x) > place.half || Math.abs(p.y - was.y) > place.half);
      lay.current = { x: place.x, y: place.y };
    }
    settle('traffic', net);
  }, [sim, net]);
  useEffect(() => { sim.target = target; }, [sim, target]);
  const meshes = useRef<(InstancedMesh | null)[]>([]);
  const paint = useMemo(() => wet(bodywork(), 'traffic'), []);
  // the head lamps on the road: a fan to a vehicle, drawn from the same instances as the vehicle itself
  const beams = useRef<(InstancedMesh | null)[]>([]);
  const light = useMemo(() => ({
    mat: wet(headlight(), 'traffic'),
    geo: types.map((t) => beam(t.len, t.wid)),
    // which of them are under way, and so have their lamps on
    on: types.map((t) => new InstancedBufferAttribute(new Float32Array(t.cap), 1)),
  }), [types]);
  useLayoutEffect(() => {
    types.forEach((t, i) => {
      t.geo.setAttribute('aLit', light.on[i]);
      light.geo[i].setAttribute('aLit', light.on[i]);
      const b = beams.current[i], m = meshes.current[i];
      if (b && m) b.instanceMatrix = m.instanceMatrix;
    });
  }, [types, light]);

  // a fresh simulation (first mount, or a hot reload of sim.ts) starts from empty buffers
  useEffect(() => {
    for (const m of meshes.current) {
      if (!m) continue;
      m.instanceMatrix.array.fill(0);
      m.instanceMatrix.needsUpdate = true;
      for (const c of sim.cars) if (meshes.current[c.type] === m) c.fresh = c.dirty = true;
    }
    (window as any).sim = sim;
    onSim?.(sim);
  }, [sim, onSim]);

  // where each vehicle under way has been these last frames: x, height, y and the time, newest first
  const trails = useMemo(() => {
    const geo = strip(), age = new InstancedBufferAttribute(new Float32Array(STREAKS * 2), 2), hue = new InstancedBufferAttribute(new Float32Array(STREAKS), 1);
    geo.setAttribute('aAge', age);
    geo.setAttribute('aHue', hue);
    return { geo, age, hue, mat: wet(streak(), 'traffic'), past: new WeakMap<object, Float32Array>() };
  }, []);
  const streaks = useRef<InstancedMesh>(null);
  const halo = useMemo(() => ({ mat: wet(siren(), 'traffic'), geo: pad() }), []);
  const halos = useRef<InstancedMesh>(null);
  const exposure = useRef(trail);
  // the strips are not drawn while the other layer shows the same lights
  exposure.current = glow ? 0 : trail;
  const layer = useRef<GlowHandle>(null);
  const stay = useRef(trail);
  stay.current = trail;
  const exposed = useRef(false);
  exposed.current = glow && trail > 0;

  // The signals. Where a road comes to the lights a mast stands on its right at the stop line, with an arm out over the lanes,
  // and over each lane hangs a head: a dark box on its side with three lamps in a row, one of them lit
  const lights = useMemo(() => {
    const steel: { x: number; y: number; z: number; sx: number; sy: number; sz: number; rot: number }[] = [];
    const heads: { x: number; y: number; z: number; rot: number; phase: number; off: number; lamp: (typeof LAMPS)[number] }[] = [];
    const arms = new Map<string, Lane[]>();
    for (const l of net.lanes) {
      if (!l.road || !l.to.signal || !l.next.length) continue;
      const k = l.road.id + ':' + l.dir;
      (arms.get(k) ?? arms.set(k, []).get(k)!).push(l);
    }
    for (const lanes of arms.values()) {
      lanes.sort((p, q) => p.idx - q.idx);
      const lw = lanes[0].road!.lw;
      let rot = 0, post = { x: 0, y: 0 }, first = { x: 0, y: 0 };
      lanes.forEach((l, i) => {
        const a = l.pts[l.pts.length - 2], b = l.pts[l.pts.length - 1];
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const tx = (b.x - a.x) / d, ty = (b.y - a.y) / d, nx = -ty, ny = tx;
        rot = -Math.atan2(ny, nx);
        if (!i) first = b;
        // the mast on the sidewalk, to the right of the outermost lane
        post = { x: b.x + nx * (lw / 2 + 1.7), y: b.y + ny * (lw / 2 + 1.7) };
        steel.push({ x: b.x, y: 6.05, z: b.y, sx: 2.5, sy: 0.75, sz: 0.6, rot });
        // the lamps face the traffic that waits, and stand a little proud of their box so they show from above
        LAMPS.forEach((lamp, j) => heads.push({ x: b.x + nx * (j - 1) * 0.76 - tx * 0.1, y: 6.1, z: b.y + ny * (j - 1) * 0.76 - ty * 0.1, rot, phase: l.next[0].conn!.phase, off: l.to.sigOff, lamp }));
      });
      const reach = Math.hypot(post.x - first.x, post.y - first.y) + 1.2;
      const k = (reach / 2 - 0.2) / (reach - 1.2 || 1);
      steel.push({ x: post.x, y: 3.5, z: post.y, sx: 0.5, sy: 7, sz: 0.5, rot });
      steel.push({ x: post.x + (first.x - post.x) * k, y: 6.7, z: post.y + (first.y - post.y) * k, sx: reach, sy: 0.3, sz: 0.3, rot });
    }
    return { steel, heads };
  }, [net]);
  const heads = lights.heads;
  const headMesh = useRef<InstancedMesh>(null), steelMesh = useRef<InstancedMesh>(null);
  useEffect(() => {
    const o = new Object3D();
    heads.forEach((h, i) => {
      o.position.set(h.x, h.y, h.z); o.rotation.set(0, h.rot, 0);
      o.updateMatrix();
      headMesh.current!.setMatrixAt(i, o.matrix);
      headMesh.current!.setColorAt(i, h.lamp === 'R' ? SIG.R : OUT);
    });
    headMesh.current!.instanceMatrix.needsUpdate = true;
    lights.steel.forEach((s, i) => {
      o.position.set(s.x, s.y, s.z); o.scale.set(s.sx, s.sy, s.sz); o.rotation.set(0, s.rot, 0);
      o.updateMatrix();
      steelMesh.current!.setMatrixAt(i, o.matrix);
    });
    steelMesh.current!.instanceMatrix.needsUpdate = true;
  }, [lights, heads]);

  useFrame(({ camera, clock }, delta) => {
    NOW.value = clock.elapsedTime;
    // the night's quiet: it comes on over the hour before nine and lifts over the half hour before half past five
    const h = HOUR.value, ease = (a: number, b: number) => { const t = Math.min(1, Math.max(0, (h - a) / (b - a))); return t * t * (3 - 2 * t); };
    const quiet = h >= 12 ? ease(20, 21) : 1 - ease(5, 5.5);
    // never anything but a number: the ways in would shut for good on one that is not
    sim.quiet = quiet >= 0 && quiet <= 1 ? quiet : 0;
    const dt = Math.min(delta, 0.05) * rate.current;
    const n = Math.ceil(dt / 0.1);
    for (let i = 0; i < n; i++) {
      sim.step(dt / n);
      layer.current?.sample(sim.cars, sim.time);
    }
    layer.current?.draw(sim.cars, sim.time, camera, stay.current);

    const ms = meshes.current;
    for (const f of sim.freed) {
      const m = ms[f.type];
      if (m) m.instanceMatrix.array.fill(0, f.slot * 16, f.slot * 16 + 16);
    }
    sim.freed.length = 0;
    for (const c of sim.cars) {
      if (!c.dirty) continue;
      const m = ms[c.type];
      if (!m) continue;
      if (c.fresh) {
        m.setColorAt(c.slot, tmp.setHex(c.color));
        c.fresh = false;
        m.instanceColor!.needsUpdate = true;
      }
      const a = m.instanceMatrix.array, o = c.slot * 16;
      const cs = Math.cos(c.ang), sn = Math.sin(c.ang);
      a[o] = cs * c.sx; a[o + 1] = 0; a[o + 2] = sn * c.sx; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = c.sy; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = -sn * c.sz; a[o + 9] = 0; a[o + 10] = cs * c.sz; a[o + 11] = 0;
      a[o + 12] = c.x; a[o + 13] = c.h; a[o + 14] = c.y; a[o + 15] = 1;
      const on = light.on[c.type], lit = c.state === PARKED ? 0 : 1;
      if (on.array[c.slot] !== lit) { on.array[c.slot] = lit; on.needsUpdate = true; }
      if (c.state === PARKED) c.dirty = false;
    }
    for (const m of ms) if (m) m.instanceMatrix.needsUpdate = true;
    const dark = NIGHT.value > 0.01;
    // where the lights are a long exposure the beams are part of it (Glow.tsx), and are not drawn here as well
    for (const b of beams.current) if (b) b.visible = dark && !exposed.current;

    // the trails: every frame each vehicle under way notes where it is, and after dark its way so far is drawn
    const sm = streaks.current, T = exposure.current;
    if (sm) sm.visible = dark && T > 0;
    if (sm && T > 0) {
      const a = sm.instanceMatrix.array, age = trails.age.array, hue = trails.hue.array;
      let k = 0;
      for (const c of sim.cars) {
        if (c.state === PARKED) continue;
        let h = trails.past.get(c);
        if (!h) { trails.past.set(c, h = new Float32Array((TRAIL + 1) * 4).fill(NaN)); }
        if (dt > 0) {
          // a jump is not a journey: whoever was moved with the roads starts again
          if (Math.hypot(c.x - h[0], c.y - h[2]) > 90) h.fill(NaN);
          h.copyWithin(4, 0, TRAIL * 4);
          h[0] = c.x; h[1] = c.h; h[2] = c.y; h[3] = sim.time;
        }
        if (!sm.visible) continue;
        for (let j = 0; j < TRAIL && k < STREAKS; j++) {
          const p = j * 4, q = p + 4, old = 1 - (sim.time - h[q + 3]) / T, young = 1 - (sim.time - h[p + 3]) / T;
          if (!(young > 0) || h[q] !== h[q]) break;
          const dx = h[q] - h[p], dy = h[q + 2] - h[p + 2], d = Math.hypot(dx, dy);
          if (d < 0.05) continue;
          const o = k * 16, w = 0.95 / d;
          a[o] = dx; a[o + 1] = h[q + 1] - h[p + 1]; a[o + 2] = dy; a[o + 3] = 0;
          a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
          a[o + 8] = -dy * w; a[o + 9] = 0; a[o + 10] = dx * w; a[o + 11] = 0;
          a[o + 12] = h[p]; a[o + 13] = h[p + 1] + 0.4; a[o + 14] = h[p + 2]; a[o + 15] = 1;
          age[k * 2] = young; age[k * 2 + 1] = Math.max(0, old);
          // which flash it was at when it drove this stretch: mostly blue, which nothing else on the road is, and red now and then
          hue[k] = c.siren ? (Math.floor(h[p + 3] * 2) & 3 ? 1 : 2) : 0;
          k++;
        }
      }
      if (sm.visible) {
        sm.count = k;
        sm.instanceMatrix.needsUpdate = true;
        trails.age.needsUpdate = true;
        trails.hue.needsUpdate = true;
      }
    }

    // the glow over every emergency vehicle that is out
    const hl = halos.current;
    if (hl) {
      const a = hl.instanceMatrix.array;
      let k = 0;
      for (const c of sim.cars) {
        if (!c.siren || k >= SIRENS) continue;
        const o = k++ * 16, cs = Math.cos(c.ang) * HALO * 0.5, sn = Math.sin(c.ang) * HALO * 0.5;
        a[o] = cs; a[o + 1] = 0; a[o + 2] = sn; a[o + 3] = 0;
        a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
        a[o + 8] = -sn; a[o + 9] = 0; a[o + 10] = cs; a[o + 11] = 0;
        a[o + 12] = c.x; a[o + 13] = c.h + 4; a[o + 14] = c.y; a[o + 15] = 1;
      }
      hl.count = k;
      hl.visible = k > 0;
      hl.instanceMatrix.needsUpdate = true;
    }

    const hm = headMesh.current;
    if (hm && hm.instanceColor) {
      heads.forEach((h, i) => hm.setColorAt(i, signal(sim.time + h.off, h.phase) === h.lamp ? SIG[h.lamp] : OUT));
      hm.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      {types.map((t, i) => (
        <instancedMesh
          key={t.name}
          ref={(m) => { meshes.current[i] = m; }}
          args={[t.geo, paint, t.cap]}
          castShadow={shade}
          receiveShadow
          frustumCulled={false}
        />
      ))}
      {types.map((t, i) => (
        <instancedMesh key={t.name} ref={(m) => { beams.current[i] = m; }} args={[light.geo[i], light.mat, t.cap]} frustumCulled={false} />
      ))}
      <instancedMesh ref={streaks} args={[trails.geo, trails.mat, STREAKS]} frustumCulled={false} />
      <instancedMesh ref={halos} args={[halo.geo, halo.mat, SIRENS]} frustumCulled={false} />
      <Works sim={sim} net={net} />
      {glow && trail > 0 && <Glow ref={layer} walls={walls} onFail={onGlowFail} />}
      {heat && <Heat sim={sim} net={net} speed={speed} />}
      {trace && <Journeys sim={sim} net={net} at={trace} note={onNote} />}
      <instancedMesh ref={headMesh} args={[undefined, undefined, heads.length]} frustumCulled={false}>
        <boxGeometry args={[0.58, 0.72, 0.6]} />
        <meshBasicMaterial toneMapped={false} {...SOAKED.traffic} />
      </instancedMesh>
      <instancedMesh ref={steelMesh} args={[undefined, undefined, lights.steel.length]} castShadow frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={0x2e3136} roughness={0.7} metalness={0.3} {...SOAKED.traffic} />
      </instancedMesh>
    </group>
  );
}
