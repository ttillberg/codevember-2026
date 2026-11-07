import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, FrontSide, Group, Mesh, Quaternion, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three';

const CENTRE = new Vector2(0, 0);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// Dab spacing as a fraction of the brush size, and the alpha each dab adds, so a stroke builds up smoothly rather
// than popping in dab by dab: about a dozen dabs overlap at any point of a round stroke.
const SPACING: Record<Brush, number> = { round: 0.06, bristle: 0.06, spray: 0.05, scrape: 0.08, glaze: 0.035, pencil: 0.06 };
const FLOW: Record<Brush, number> = { round: 0.2, bristle: 0.3, spray: 0.3, scrape: 0.12, glaze: 0.08, pencil: 0.25 };

// The wheel, tunable live. A trackball: drag turns the balloon about the axis across the drag, any direction,
// and it keeps turning once let go at the speed of the last move, slowing only a little. Grabbing never stops it.
export const wheel = {
  gain: Math.PI, // radians of turn per window width of drag
  drag: 0.08,    // how fast the spin dies away once let go, per second: next to nothing
  maxSpin: 40,   // radians per second
  q: new Quaternion(),      // the balloon's orientation
  omega: new Vector3(),     // angular velocity, world space
  grabbed: false,
  time: 0, calm: 1, // the breathing
};
import { MeshPhysicalNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import {
  abs, float, max, min, mix, mx_noise_float, normalMap, sin, smoothstep, normalViewGeometry, positionViewDirection, saturate, select, uniform, uv,
  vec2, vec3,
} from 'three/tsl';
import { K, PAINT_H, PAINT_W, PaintLayer, sim, type Brush, type Dab } from './paint';
import { FINISH, hexToRgb, tool } from './tool';
import { dripSettings, dryPile, maybeSpawn, stepDrips } from './drips';

export const paint = new PaintLayer();
// Dev: 0 normal, 1 coverage, 2 wetness, 3 thickness, 4 tint. And how much wet paint glosses up.
const uDebug = uniform(0);
const uWetGloss = uniform(1);
const uBump = uniform(sim.bump);
const uGrain = uniform(sim.grain);
const uEdge = uniform(2.2); // how much pigment gathers at a wash's edge
if (import.meta.env.DEV) { (window as any).__tool = tool; (window as any).__drips = dripSettings; (window as any).__wheel = wheel; (window as any).__sim = sim; (window as any).__paint = paint; (window as any).__dbg = uDebug; (window as any).__wetGloss = uWetGloss; (window as any).__edge = uEdge; }

// Thin clear rubber with paint on it. Clear rubber has no diffuse of its own, only its reflections and a thin
// border where it is seen edge on; where there is paint the surface is opaque in the paint's colour and finish, wet paint
// glossier, and the paint's thickness bumps the normal so runs and ridges catch the light.
function balloonMaterial(side: typeof FrontSide | typeof BackSide) {
  const m = new MeshPhysicalNodeMaterial();
  m.transparent = true;
  m.depthWrite = false;
  m.side = side;
  const c = paint.colorNode;
  const p = paint.propsNode;
  // Thick paint covers even where few dabs landed, so runs read as paint and not as a glaze.
  // Watercolour on the flat, dry washes (the glaze): pigment gathers where the wash ends, so the edge of a stroke,
  // and the edge of one layer over another, is denser than the middle, which is a little granular.
  // The ring sits just inside the rim: where the coverage is above the mean of its surroundings, a good way out,
  // the pigment has dried denser. Wide and soft, like a coffee ring, not a line.
  // u offsets stretched by 1 / sin(theta), clamped, so the measure is the same distance all over the sphere.
  const uScale = min(float(1).div(max(sin(float(1).sub(uv().y).mul(Math.PI)), 0.02)), 8).toVar();
  const e = vec2(float(26 * K / PAINT_W).mul(uScale), 26 * K / PAINT_H);
  const around = paint.colorAt(uv().sub(vec2(e.x, 0))).a.add(paint.colorAt(uv().add(vec2(e.x, 0))).a)
    .add(paint.colorAt(uv().sub(vec2(0, e.y))).a).add(paint.colorAt(uv().add(vec2(0, e.y))).a).mul(0.25);
  // A wash: no thickness, and no roughness at all, which only the glaze lays. Pencil paint and spray are thin too
  // but carry their finish, so they get none of the watercolour. (Roughness over coverage climbs with the overlap,
  // since the props target adds roughness up but saturates coverage; nought stays nought.)
  const wash = float(1).sub(saturate(p.x.mul(4))).mul(float(1).sub(smoothstep(0.02, 0.06, p.z.div(max(c.a, 0.001))))).toVar();
  const ring = saturate(c.a.sub(around).mul(uEdge)).mul(wash);
  const washA = c.a.mul(ring.mul(1.3).add(1));
  const cov = max(saturate(washA), saturate(p.x.mul(2.5))).toVar();
  const safe = max(c.a, 0.001);
  const tint = c.rgb.div(safe);
  const f1 = saturate(float(1).sub(abs(normalViewGeometry.dot(positionViewDirection))));
  // Only a thin border: the rubber shows edge on and almost nowhere else.
  const f2 = f1.mul(f1);
  const fresnel = f2.mul(f2).mul(f2).mul(f1);
  const wet = p.y;
  // Dev views: 1..4 flat data, 5 lit diffuse only, 6 no specular, 7 opacity 1.
  const flat = uDebug.greaterThanEqual(1).and(uDebug.lessThanEqual(4));
  const dbgView = select(uDebug.equal(1), vec3(cov), select(uDebug.equal(2), vec3(wet), select(uDebug.equal(3), vec3(p.x), tint)));
  const noSpec = uDebug.equal(5).or(uDebug.equal(6));
  const opaque = uDebug.equal(5).or(uDebug.equal(7));
  m.colorNode = select(flat, dbgView, mix(vec3(0), tint, cov));
  m.opacityNode = select(flat.or(opaque), float(1), mix(float(0.008).add(fresnel.mul(0.6)), float(1), cov));
  const roughPaint = mix(p.z.div(safe), float(0.04), wash).toVar(); // a wash is glass smooth
  // Wet paint glosses up, but matte less so: it stays dull even wet.
  const wetGloss = wet.mul(uWetGloss).mul(float(1).sub(smoothstep(0.6, 0.9, roughPaint)));
  m.roughnessNode = select(flat, float(1), mix(float(0.08), roughPaint.mul(mix(1, 0.3, wetGloss)), cov));
  m.metalnessNode = select(flat, float(0), p.w.div(safe).mul(cov));
  // A rough paint also reflects less: matte is matte, not just blurry.
  m.specularIntensityNode = select(flat.or(noSpec), float(0), mix(float(1), float(0.2), smoothstep(0.6, 0.95, roughPaint).mul(cov)));
  // Pale rim like a reflection of the room, instead of an environment map.
  m.emissiveNode = select(flat.or(noSpec), vec3(0), vec3(0.9, 0.88, 0.85).mul(fresnel).mul(0.35).mul(float(1).sub(cov.mul(0.7))));
  // Normal from the paint's height: thickness plus a fine grain, differenced across one texel each way in the
  // target. Orange peel on thick paint, ridges along bristle strokes, rounded lips on the runs.
  // Two texels either way: a step a run leaves is spread over a few texels, not drawn as a line.
  const px = float(2 * K / PAINT_W).mul(uScale), py = 2 * K / PAINT_H;
  // Height is the thickness, clamped so a big drop reads as a dome and not a cliff, plus a fine grain.
  // Compressed smoothly towards 1.5 rather than clamped: a hard cap drew a contour line wherever a run piled
  // the paint over it.
  const height = (at: any, props: any) => { const h = props.x.div(props.x.add(1)); return h.add(mx_noise_float(at.mul(vec2(2048 / 3, 1024 / 3))).mul(uGrain).mul(h)); };
  const hL = height(uv().sub(vec2(px, 0)), paint.propsAt(uv().sub(vec2(px, 0))));
  const hR = height(uv().add(vec2(px, 0)), paint.propsAt(uv().add(vec2(px, 0))));
  const hD = height(uv().sub(vec2(0, py)), paint.propsAt(uv().sub(vec2(0, py))));
  const hU = height(uv().add(vec2(0, py)), paint.propsAt(uv().add(vec2(0, py))));
  const slope = vec2(hR.sub(hL), hU.sub(hD)).mul(uBump).mul(-0.5);
  const nTs = vec3(slope, 1).normalize();
  m.normalNode = normalMap(nTs.mul(0.5).add(0.5), float(1)) as any;
  return m;
}

export function Balloon() {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const geo = useMemo(() => new SphereGeometry(1, 128, 96), []);
  const front = useMemo(() => balloonMaterial(FrontSide), []);
  const back = useMemo(() => balloonMaterial(BackSide), []);
  const stroke = useRef<{ u: number; v: number; seed: number } | null>(null);

  if (import.meta.env.DEV) (window as any).__gl = gl;
  // Splat this frame's dabs and run the paint before the scene renders.
  useFrame((_, dt) => {
    uBump.value = sim.bump; uGrain.value = sim.grain;
    // Liquid: how runny the paint is. The tongues along a stroke's edge start at less thickness, move faster
    // and dry slower; the legs are the drips (drips.ts), which form where paint piles up.
    const l = tool.liquid;
    // At zero nothing runs at all: the threshold sits above the thickest impasto and the rate is nil.
    sim.runAt = lerp(1.3, 0.35, l);
    sim.runNoise = lerp(0.3, 0.4, l);
    sim.lane = 14;
    sim.laneSharp = 1;
    sim.runRate = lerp(0, 0.7, Math.min(1, l * 2.5)) * lerp(0.3, 1, l);
    sim.dry = lerp(0.002, 0.00015, l);
    sim.spread = lerp(0.06, 0.12, l);
    sim.bleed = 0.03 + tool.watery * 0.14;
    dryPile(dt);
    stepDrips(dt, sim.gravityObj, tool.size, l, paint);
    paint.flush(gl, dt);
  }, -1);

  const dabAt = (u: number, v: number, angle: number, seed: number, grow = 1) => {
    const finish = FINISH[tool.finish];
    const glaze = tool.brush === 'glaze';
    const w = tool.watery;
    const d: Dab = {
      u, v, angle, seed,
      // Watery glaze: wider, thinner. Its softness rides in the rough slot, which the glaze doesn't use.
      // The spray dab is drawn a little bigger than the brush: the dense core fills the ring, the speckles go just outside.
      size: tool.size * (glaze ? 1 + w * 0.7 : tool.brush === 'spray' ? 1.2 : 1) * grow,
      rgb: hexToRgb(tool.hex),
      // Dabs overlap many times along the stroke, so each one carries only a little.
      flow: FLOW[tool.brush] * tool.flow * (glaze ? 1 - w * 0.45 : 1),
      brush: tool.brush,
      rough: glaze ? w : finish.rough,
      metal: finish.metal,
      wet: glaze ? 1 : tool.brush === 'spray' || tool.brush === 'pencil' ? 0 : undefined, // a wash is laid wet and floats out; spray and pencil are dry
    };
    paint.add(d);
    if (tool.brush !== 'scrape') maybeSpawn(d, tool.liquid, sim.gravityObj, grow > 1); // grow > 1: the can held still
    // Spray splatters: now and then a fat drop lands off to the side, outside the mist.
    if (tool.brush === 'spray' && Math.random() < 0.12) {
      const n = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        // Small dots, the same size whatever the brush, just outside the mist.
        const reach = Math.min(tool.size, 0.06);
        const r = reach * (0.5 + Math.random() * 0.4), t = Math.random() * Math.PI * 2;
        const circ = 2 * Math.max(Math.sin(v * Math.PI), 0.05);
        paint.add({
          ...d, brush: 'round', seed: Math.random() * 1000, angle: 0,
          u: ((u + Math.cos(t) * r / circ) % 1 + 1) % 1, v: Math.min(0.999, Math.max(0.001, v + Math.sin(t) * r)),
          size: 0.0015 + Math.random() ** 2 * 0.003, flow: 0.7 + Math.random() * 0.3, load: 0, wet: 0, // tiny flat dots
        });
      }
    }
  };
  // Spray keeps coming while the can is held still: a dab every so often at the same spot, so it builds up.
  const sprayHold = useRef(0), sprayHeld = useRef(0);

  // The brush sits at the centre of the screen: turning the balloon under it is the stroke. The left button
  // paints while it orbits, the right button only orbits. Each frame the centre ray is cast at the balloon and the
  // hit's uv is fed to the stroke, dabs laid at the brush's spacing along the way.
  const frontRef = useRef<Mesh>(null);
  const painting = useRef(false);
  const raycaster = useMemo(() => new Raycaster(), []);
  const camera = useThree((s) => s.camera);

  const hit = () => {
    const mesh = frontRef.current;
    if (!mesh) return null;
    raycaster.setFromCamera(CENTRE, camera);
    const h = raycaster.intersectObject(mesh, false)[0];
    return h?.uv ? { u: h.uv.x, v: h.uv.y, point: h.point } : null;
  };

  // Spray thins with speed, like a real can: full width dawdling, down to a quarter on a quick flick. Smoothed.
  const sprayWidth = useRef(1);
  const advance = (u: number, v: number, dt = 1 / 120) => {
    const s = stroke.current;
    if (!s) return;
    let du = u - s.u;
    if (du > 0.5) du -= 1; else if (du < -0.5) du += 1; // shortest way round the seam
    const dv = v - s.v;
    // Distance in v units: a u step is worth the circumference at this latitude.
    const circ = 2 * Math.max(Math.sin(s.v * Math.PI), 0.02);
    const dist = Math.hypot(du * circ, dv);
    const spacing = tool.size * SPACING[tool.brush];
    if (tool.brush === 'spray') {
      const speed = dist / Math.max(dt, 1e-3); // pole-to-pole units a second
      const want = 1 - 0.75 * Math.min(1, Math.max(0, (speed - 0.15) / 1.0));
      sprayWidth.current += (want - sprayWidth.current) * Math.min(1, dt * 12);
    } else sprayWidth.current = 1;
    if (dist < spacing) return;
    sprayHeld.current = 0; // moving again
    const angle = Math.atan2(dv, du * circ);
    const n = Math.floor(dist / spacing);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      // Spray speckles differ per dab; the other brushes keep the stroke's seed so their furrows run on.
      dabAt(((s.u + du * t) % 1 + 1) % 1, s.v + dv * t, angle, tool.brush === 'spray' ? s.seed + i : s.seed, sprayWidth.current);
    }
    const t = n / (dist / spacing);
    s.u = ((s.u + du * t) % 1 + 1) % 1;
    s.v += dv * t;
  };

  useEffect(() => {
    const el = gl.domElement;
    // Grabbing never stops it: held still, the balloon keeps turning under the hand. Moved, it follows the hand
    // (a window width is half a turn, about the axis across the drag) and on release spins on at the speed of the
    // last move.
    // Every finger (or the mouse) down on the balloon, at its last place. Two or more fingers turn it without
    // painting; the turn follows their centre, each finger moving it a share.
    let lastT = 0;
    const hand = new Vector3(), axis = new Vector3(), dq = new Quaternion();
    const fingers = new Map<number, { x: number; y: number }>();
    const move = (e: PointerEvent) => {
      const f = fingers.get(e.pointerId);
      if (!wheel.grabbed || !f) return;
      const mx = e.clientX - f.x, my = e.clientY - f.y;
      if (Math.abs(mx) + Math.abs(my) < 2) return; // a twitch, not a move
      f.x = e.clientX; f.y = e.clientY;
      const g = wheel.gain / Math.min(window.innerWidth, window.innerHeight) / fingers.size;
      axis.set(my * g, mx * g, 0); // right drag turns about y, down drag about x
      const angle = axis.length();
      if (angle > 0) {
        dq.setFromAxisAngle(axis.clone().divideScalar(angle), angle);
        wheel.q.premultiply(dq);
      }
      const t = e.timeStamp, dt = Math.max((t - lastT) / 1000, 1 / 240);
      // The hand's speed, from this step and the one before so a single odd event timing doesn't throw it.
      hand.multiplyScalar(0.5).addScaledVector(axis, 0.5 / dt);
      // Once the hand moves, the balloon is the hand's: the old spin fades out under it.
      wheel.omega.multiplyScalar(0.7);
      lastT = t;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size > 1) { painting.current = false; stroke.current = null; return; } // a second finger: just turn
      painting.current = !e.metaKey; // cmd: turn it without painting
      wheel.grabbed = true;
      el.classList.add('grabbing');
      hand.set(0, 0, 0);
      lastT = e.timeStamp;
    };
    const up = (e: PointerEvent) => {
      if (!fingers.delete(e.pointerId)) return; // not one of ours
      painting.current = false; // lifting one of two fingers doesn't start painting again
      stroke.current = null;
      if (fingers.size > 0) return; // still held by the other finger
      el.classList.remove('grabbing');
      if (!wheel.grabbed) return;
      wheel.grabbed = false;
      // Let go while moving: it spins on at the hand's speed. Let go after a pause: it stays as it is.
      if (!tool.inertia) {
        wheel.omega.set(0, 0, 0); // no inertia: it stops where the hand lets go
      } else if (e.timeStamp - lastT < 80 && hand.lengthSq() > 0) {
        wheel.omega.copy(hand);
        if (wheel.omega.length() > wheel.maxSpin) wheel.omega.setLength(wheel.maxSpin);
      }
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [gl]);

  // Paint under the brush where the camera is now, and size the ring on screen.
  useFrame(({ size }, dt) => {
    const h = hit();
    const ring = document.getElementById('reticle');
    if (ring) {
      // The brush diameter is in v units, pole to pole is pi r: project a point one radius to the side.
      let px = 0;
      if (h) {
        const r = tool.size * Math.PI * 0.5;
        const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(r);
        const a = h.point.clone().project(camera), b = h.point.clone().add(right).project(camera);
        px = Math.abs(b.x - a.x) * size.width * 0.5;
      }
      ring.style.width = ring.style.height = `${Math.max(px * 2, 12)}px`;
      ring.style.opacity = h ? '1' : '0.3';
    }
    if (!(painting.current || tool.auto) || !h) { stroke.current = null; return; }
    if (!stroke.current) {
      const seed = Math.random() * 1000;
      stroke.current = { u: h.u, v: h.v, seed };
      sprayHeld.current = 0;
      dabAt(h.u, h.v, 0, seed);
    } else {
      advance(h.u, h.v, dt);
      if (tool.brush === 'spray') {
        // Held still (not just moving slowly): the can keeps spraying and the cloud widens, up to twice the
        // brush after a couple of seconds. Moving, the stroke is the same at any speed.
        const s = stroke.current;
        let du = h.u - s.u; if (du > 0.5) du -= 1; else if (du < -0.5) du += 1;
        const moved = Math.hypot(du * 2 * Math.max(Math.sin(s.v * Math.PI), 0.02), h.v - s.v);
        if (moved < tool.size * SPACING.spray * 0.5) {
          sprayHeld.current += dt;
          sprayHold.current += dt;
          if (sprayHeld.current > 0.15 && sprayHold.current > 0.05) {
            sprayHold.current = 0;
            dabAt(h.u, h.v, 0, s.seed + Math.random() * 97, 1 + Math.min(sprayHeld.current, 2.5) * 0.4);
          }
        } else sprayHeld.current = 0;
      }
    }
  }, -2); // before the flush; a positive priority would turn off R3F's own render

  // Spin on, once let go, with hardly any drag.
  const groupRef = useRef<Group>(null);
  const step = useMemo(() => new Quaternion(), []);
  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    if (!wheel.grabbed) wheel.omega.multiplyScalar(Math.exp(-dt * wheel.drag));
    const w = wheel.omega.length();
    if (w > 0) {
      step.setFromAxisAngle(wheel.omega.clone().divideScalar(w), w * dt);
      wheel.q.premultiply(step);
    }
    g.quaternion.copy(wheel.q);
    // Attract mode: left still, it breathes, a slow swell, a slower bob and a lazy sway, a couple of percent. It
    // eases in over a few seconds once nothing moves and drops out quickly when it's held or spun, so in use the
    // balloon keeps its shape and its place.
    wheel.time += dt;
    const calmWant = wheel.grabbed || wheel.omega.length() > 0.05 ? 0 : 1;
    wheel.calm += (calmWant - wheel.calm) * Math.min(1, dt * (calmWant > wheel.calm ? 0.6 : 6));
    const breath = Math.sin(wheel.time * (2 * Math.PI / 4.5)) * 0.018 * wheel.calm;
    const bob = Math.sin(wheel.time * (2 * Math.PI / 7)) * 0.03 * wheel.calm;
    const sway = Math.sin(wheel.time * (2 * Math.PI / 11) + 1.3) * 0.015 * wheel.calm;
    g.position.set(sway, bob, 0);
    g.scale.setScalar(1 + breath); // always a perfect sphere, it only swells
    // The room's down, in the balloon's frame, for the runs.
    sim.gravityObj.set(0, -1, 0).applyQuaternion(g.quaternion.clone().invert());
  }, -3);

  return (
    <group ref={groupRef}>
      <mesh geometry={geo} material={back} renderOrder={0} />
      <mesh ref={frontRef} geometry={geo} material={front} renderOrder={1} />
    </group>
  );
}
