import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { BackSide, FrontSide, SphereGeometry } from 'three';
import { MeshPhysicalNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import {
  abs, bumpMap, float, max, mix, normalViewGeometry, positionViewDirection, saturate, select, uniform, vec3,
} from 'three/tsl';
import { PaintLayer, sim, type Dab } from './paint';
import { FINISH, hexToRgb, tool } from './tool';

export const paint = new PaintLayer();
// Dev: 0 normal, 1 coverage, 2 wetness, 3 thickness, 4 tint. And how much wet paint glosses up.
const uDebug = uniform(0);
const uWetGloss = uniform(1);
if (import.meta.env.DEV) { (window as any).__sim = sim; (window as any).__paint = paint; (window as any).__dbg = uDebug; (window as any).__wetGloss = uWetGloss; }

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
  if (sim.bump > 0) m.normalNode = bumpMap(p, float(sim.bump)) as any;
  return m;
}

export function Balloon() {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const controls = useThree((s) => s.controls) as any;
  const geo = useMemo(() => new SphereGeometry(1, 128, 96), []);
  const front = useMemo(() => balloonMaterial(FrontSide), []);
  const back = useMemo(() => balloonMaterial(BackSide), []);
  const stroke = useRef<{ u: number; v: number; seed: number } | null>(null);

  if (import.meta.env.DEV) (window as any).__gl = gl;
  // Splat this frame's dabs and run the paint before the scene renders.
  useFrame(() => paint.flush(gl), -1);

  const dabAt = (u: number, v: number, angle: number, seed: number) => {
    const finish = FINISH[tool.finish];
    const d: Dab = {
      u, v, angle, seed,
      size: tool.size,
      rgb: hexToRgb(tool.hex),
      flow: tool.brush === 'spray' ? tool.flow * 0.35 : tool.brush === 'scrape' ? 0.5 : tool.flow,
      brush: tool.brush,
      rough: finish.rough,
      metal: finish.metal,
    };
    paint.add(d);
  };

  const down = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || !e.uv) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (controls) controls.enabled = false;
    const seed = Math.random() * 1000;
    stroke.current = { u: e.uv.x, v: e.uv.y, seed };
    dabAt(e.uv.x, e.uv.y, 0, seed);
  };

  const move = (e: ThreeEvent<PointerEvent>) => {
    const s = stroke.current;
    if (!s || !e.uv) return;
    let du = e.uv.x - s.u;
    if (du > 0.5) du -= 1; else if (du < -0.5) du += 1; // shortest way round the seam
    const dv = e.uv.y - s.v;
    // Distance in v units: a u step is worth the circumference at this latitude.
    const circ = 2 * Math.max(Math.sin(s.v * Math.PI), 0.02);
    const dist = Math.hypot(du * circ, dv);
    const spacing = tool.size * (tool.brush === 'spray' ? 0.12 : 0.2);
    if (dist < spacing) return;
    const angle = Math.atan2(dv, du * circ);
    const n = Math.floor(dist / spacing);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      let u = s.u + du * t;
      u = ((u % 1) + 1) % 1;
      dabAt(u, s.v + dv * t, angle, s.seed + i);
    }
    const t = n / (dist / spacing);
    s.u = ((s.u + du * t) % 1 + 1) % 1;
    s.v += dv * t;
  };

  useEffect(() => {
    const up = () => {
      stroke.current = null;
      if (controls) controls.enabled = true;
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [controls]);

  return (
    <group scale={[1, 1.12, 1]}>
      <mesh geometry={geo} material={back} renderOrder={0} />
      <mesh geometry={geo} material={front} renderOrder={1} onPointerDown={down} onPointerMove={move} />
    </group>
  );
}
