// Runs the traffic and draws it: one instanced mesh per vehicle type, plus the signal heads.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, InstancedBufferAttribute, InstancedMesh, MeshStandardMaterial, Object3D, ShaderMaterial } from 'three';
import type { Net, V } from './net';
import { Heat, Journeys } from './Traffic';
import { PARKED, Sim, signal } from './sim';
import { NIGHT } from './haze';
import { beam, makeTypes } from './vehicles';

/** How much faster than life the traffic runs, as a timelapse. */
export const TIMELAPSE = 60;

const tmp = new Color();
const SIG = { G: new Color(0x2dff7a), Y: new Color(0xffc21a), R: new Color(0xff2a1a) };

/** Body paint, and after dark the lamps at either end: on for whoever is driving, off for whoever is parked. */
function bodywork() {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.25 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = NIGHT;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 glow; attribute float aLit; varying vec3 vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow * aLit;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight; varying vec3 vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * uNight;');
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

/** How many stretches of its way a vehicle's lights are drawn over, and how many stretches there are for all of them. */
const TRAIL = 8, STREAKS = 2400;

/**
 * A long exposure: the lamps drawn out along the way the vehicle came, red at the edges and warm between, fading with age.
 * Geometry, not a pass over the picture: a strip for each of the last few frames of each vehicle's way.
 */
function streak() {
  return new ShaderMaterial({
    uniforms: { uNight: NIGHT },
    vertexShader: /* glsl */ `
      attribute vec2 aAge;
      varying vec2 vUv; varying float vK;
      void main() { vUv = uv; vK = mix(aAge.x, aAge.y, uv.x); gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying vec2 vUv; varying float vK;
      void main() {
        float y = abs(vUv.y), lamp = smoothstep(0.35, 0.7, y) * (1.0 - smoothstep(0.8, 1.0, y)), mid = 1.0 - smoothstep(0.0, 0.6, y);
        vec3 c = vec3(1.0, 0.1, 0.04) * lamp * 1.5 + vec3(1.0, 0.72, 0.4) * mid * 0.55;
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

/** `speed` is how fast time goes: TIMELAPSE, or 0 for a still. */
export function Cars({ net, speed, target, trail = 0, heat = false, trace = null, shade = true, onNote }: {
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
  useLayoutEffect(() => sim.setNet(net), [sim, net]);
  useEffect(() => { sim.target = target; }, [sim, target]);
  const meshes = useRef<(InstancedMesh | null)[]>([]);
  const paint = useMemo(bodywork, []);
  // the head lamps on the road: a fan to a vehicle, drawn from the same instances as the vehicle itself
  const beams = useRef<(InstancedMesh | null)[]>([]);
  const light = useMemo(() => ({
    mat: headlight(),
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
  }, [sim]);

  // where each vehicle under way has been these last frames: x, height, y and the time, newest first
  const trails = useMemo(() => {
    const geo = strip(), age = new InstancedBufferAttribute(new Float32Array(STREAKS * 2), 2);
    geo.setAttribute('aAge', age);
    return { geo, age, mat: streak(), past: new WeakMap<object, Float32Array>() };
  }, []);
  const streaks = useRef<InstancedMesh>(null);
  const exposure = useRef(trail);
  exposure.current = trail;

  const heads = useMemo(() => {
    const out: { x: number; y: number; z: number; phase: number; off: number }[] = [];
    for (const l of net.lanes) {
      if (!l.road || !l.to.signal || !l.next.length) continue;
      const a = l.pts[l.pts.length - 2], b = l.pts[l.pts.length - 1];
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const k = l.to.trim * 2 + 1;
      out.push({ x: b.x + ((b.x - a.x) / d) * k, y: 6.4, z: b.y + ((b.y - a.y) / d) * k, phase: l.next[0].conn!.phase, off: l.to.sigOff });
    }
    return out;
  }, [net]);
  const headMesh = useRef<InstancedMesh>(null);
  useEffect(() => {
    const o = new Object3D();
    heads.forEach((h, i) => {
      o.position.set(h.x, h.y, h.z);
      o.updateMatrix();
      headMesh.current!.setMatrixAt(i, o.matrix);
      headMesh.current!.setColorAt(i, SIG.R);
    });
    headMesh.current!.instanceMatrix.needsUpdate = true;
  }, [heads]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05) * rate.current;
    const n = Math.ceil(dt / 0.1);
    for (let i = 0; i < n; i++) sim.step(dt / n);

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
    for (const b of beams.current) if (b) b.visible = dark;

    // the trails: every frame each vehicle under way notes where it is, and after dark its way so far is drawn
    const sm = streaks.current, T = exposure.current;
    if (sm) sm.visible = dark && T > 0;
    if (sm && T > 0) {
      const a = sm.instanceMatrix.array, age = trails.age.array;
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
          k++;
        }
      }
      if (sm.visible) {
        sm.count = k;
        sm.instanceMatrix.needsUpdate = true;
        trails.age.needsUpdate = true;
      }
    }

    const hm = headMesh.current;
    if (hm && hm.instanceColor) {
      heads.forEach((h, i) => hm.setColorAt(i, SIG[signal(sim.time + h.off, h.phase)]));
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
      {heat && <Heat sim={sim} net={net} speed={speed} />}
      {trace && <Journeys sim={sim} net={net} at={trace} note={onNote} />}
      <instancedMesh ref={headMesh} args={[undefined, undefined, heads.length]} frustumCulled={false}>
        <boxGeometry args={[0.9, 0.9, 0.9]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
