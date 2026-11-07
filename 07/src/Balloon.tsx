import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, FrontSide, Group, Mesh, Quaternion, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three';

const CENTRE = new Vector2(0, 0);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// Dab spacing as a fraction of the brush size, and the alpha each dab adds, so a stroke builds up smoothly rather
// than popping in dab by dab: about a dozen dabs overlap at any point of a round stroke.
const SPACING: Record<Brush, number> = { round: 0.06, bristle: 0.06, spray: 0.08, scrape: 0.08, glaze: 0.1 };
const FLOW: Record<Brush, number> = { round: 0.2, bristle: 0.3, spray: 0.12, scrape: 0.12, glaze: 0.16 };

// The wheel, tunable live. A trackball: drag turns the balloon about the axis across the drag, any direction,
// and it keeps turning once let go at the speed of the last move, slowing only a little. Grabbing never stops it.
export const wheel = {
  gain: Math.PI, // radians of turn per window width of drag
  drag: 0.08,    // how fast the spin dies away once let go, per second: next to nothing
  maxSpin: 40,   // radians per second
  q: new Quaternion(),      // the balloon's orientation
  omega: new Vector3(),     // angular velocity, world space
  grabbed: false,
};
import { MeshPhysicalNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import {
  abs, float, max, min, mix, mx_noise_float, normalMap, normalViewGeometry, positionViewDirection, saturate, select, uniform, uv,
  vec2, vec3,
} from 'three/tsl';
import { PAINT_H, PAINT_W, PaintLayer, sim, type Brush, type Dab } from './paint';
import { FINISH, hexToRgb, tool } from './tool';
import { dripSettings, dryPile, maybeSpawn, stepDrips } from './drips';

export const paint = new PaintLayer();
// Dev: 0 normal, 1 coverage, 2 wetness, 3 thickness, 4 tint. And how much wet paint glosses up.
const uDebug = uniform(0);
const uWetGloss = uniform(1);
const uBump = uniform(sim.bump);
const uGrain = uniform(sim.grain);
if (import.meta.env.DEV) { (window as any).__tool = tool; (window as any).__drips = dripSettings; (window as any).__wheel = wheel; (window as any).__sim = sim; (window as any).__paint = paint; (window as any).__dbg = uDebug; (window as any).__wetGloss = uWetGloss; }

// Thin clear rubber with paint on it. Clear rubber has no diffuse of its own, only its reflections and a faint
// darkening at the rim; where there is paint the surface is opaque in the paint's colour and finish, wet paint
// glossier, and the paint's thickness bumps the normal so runs and ridges catch the light.
function balloonMaterial(side: typeof FrontSide | typeof BackSide) {
  const m = new MeshPhysicalNodeMaterial();
  m.transparent = true;
  m.depthWrite = false;
  m.side = side;
  const c = paint.colorNode;
  const p = paint.propsNode;
  // Thick paint covers even where few dabs landed, so runs read as paint and not as a glaze.
  const cov = max(c.a, saturate(p.x.mul(2.5))).toVar();
  const safe = max(c.a, 0.001);
  const tint = c.rgb.div(safe);
  const f1 = saturate(float(1).sub(abs(normalViewGeometry.dot(positionViewDirection))));
  const fresnel = f1.mul(f1).mul(f1);
  const wet = p.y;
  // Dev views: 1..4 flat data, 5 lit diffuse only, 6 no specular, 7 opacity 1.
  const flat = uDebug.greaterThanEqual(1).and(uDebug.lessThanEqual(4));
  const dbgView = select(uDebug.equal(1), vec3(cov), select(uDebug.equal(2), vec3(wet), select(uDebug.equal(3), vec3(p.x), tint)));
  const noSpec = uDebug.equal(5).or(uDebug.equal(6));
  const opaque = uDebug.equal(5).or(uDebug.equal(7));
  m.colorNode = select(flat, dbgView, mix(vec3(0), tint, cov));
  m.opacityNode = select(flat.or(opaque), float(1), mix(float(0.05).add(fresnel.mul(0.35)), float(1), cov));
  m.roughnessNode = select(flat, float(1), mix(float(0.08), p.z.div(safe).mul(mix(1, 0.3, wet.mul(uWetGloss))), cov));
  m.metalnessNode = select(flat, float(0), p.w.div(safe).mul(cov));
  m.specularIntensityNode = select(flat.or(noSpec), float(0), float(1));
  // Pale rim like a reflection of the room, instead of an environment map.
  m.emissiveNode = select(flat.or(noSpec), vec3(0), vec3(0.9, 0.88, 0.85).mul(fresnel).mul(0.35).mul(float(1).sub(cov.mul(0.7))));
  // Normal from the paint's height: thickness plus a fine grain, differenced across one texel each way in the
  // target. Orange peel on thick paint, ridges along bristle strokes, rounded lips on the runs.
  const px = 1 / PAINT_W, py = 1 / PAINT_H;
  // Height is the thickness, clamped so a big drop reads as a dome and not a cliff, plus a fine grain.
  const height = (at: any, props: any) => { const h = min(props.x, 1.2); return h.add(mx_noise_float(at.mul(vec2(PAINT_W / 3, PAINT_H / 3))).mul(uGrain).mul(h)); };
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
    sim.runAt = lerp(0.7, 0.35, l);
    sim.runNoise = lerp(0.3, 0.4, l);
    sim.lane = 14;
    sim.laneSharp = 1;
    sim.runRate = lerp(0.3, 0.7, l);
    sim.dry = lerp(0.002, 0.00015, l);
    sim.spread = lerp(0.06, 0.12, l);
    dryPile(dt);
    stepDrips(dt, sim.gravityObj, tool.size, l, paint);
    paint.flush(gl, dt);
  }, -1);

  const dabAt = (u: number, v: number, angle: number, seed: number) => {
    const finish = FINISH[tool.finish];
    const d: Dab = {
      u, v, angle, seed,
      size: tool.size,
      rgb: hexToRgb(tool.hex),
      // Dabs overlap many times along the stroke, so each one carries only a little.
      flow: FLOW[tool.brush] * tool.flow,
      brush: tool.brush,
      rough: finish.rough,
      metal: finish.metal,
    };
    paint.add(d);
    if (tool.brush !== 'scrape') maybeSpawn(d, tool.liquid, sim.gravityObj);
  };

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

  const advance = (u: number, v: number) => {
    const s = stroke.current;
    if (!s) return;
    let du = u - s.u;
    if (du > 0.5) du -= 1; else if (du < -0.5) du += 1; // shortest way round the seam
    const dv = v - s.v;
    // Distance in v units: a u step is worth the circumference at this latitude.
    const circ = 2 * Math.max(Math.sin(s.v * Math.PI), 0.02);
    const dist = Math.hypot(du * circ, dv);
    const spacing = tool.size * SPACING[tool.brush];
    if (dist < spacing) return;
    const angle = Math.atan2(dv, du * circ);
    const n = Math.floor(dist / spacing);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      // Spray speckles differ per dab; the other brushes keep the stroke's seed so their furrows run on.
      dabAt(((s.u + du * t) % 1 + 1) % 1, s.v + dv * t, angle, tool.brush === 'spray' ? s.seed + i : s.seed);
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
    let lastT = 0;
    const hand = new Vector3(), axis = new Vector3(), dq = new Quaternion();
    const move = (e: PointerEvent) => {
      if (!wheel.grabbed) return;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) < 2) return; // a twitch, not a move
      const g = wheel.gain / Math.min(window.innerWidth, window.innerHeight);
      axis.set(e.movementY * g, e.movementX * g, 0); // right drag turns about y, down drag about x
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
      painting.current = true;
      wheel.grabbed = true;
      el.classList.add('grabbing');
      hand.set(0, 0, 0);
      lastT = e.timeStamp;
    };
    const up = (e: PointerEvent) => {
      painting.current = false;
      stroke.current = null;
      el.classList.remove('grabbing');
      if (!wheel.grabbed) return;
      wheel.grabbed = false;
      // Let go while moving: it spins on at the hand's speed. Let go after a pause: it stays as it is.
      if (e.timeStamp - lastT < 80 && hand.lengthSq() > 0) {
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
  useFrame(({ size }) => {
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
      dabAt(h.u, h.v, 0, seed);
    } else advance(h.u, h.v);
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
    // The room's down, in the balloon's frame, for the runs.
    sim.gravityObj.set(0, -1, 0).applyQuaternion(g.quaternion.clone().invert());
  }, -3);

  return (
    <group ref={groupRef} scale={[1, 1.12, 1]}>
      <mesh geometry={geo} material={back} renderOrder={0} />
      <mesh ref={frontRef} geometry={geo} material={front} renderOrder={1} />
    </group>
  );
}
