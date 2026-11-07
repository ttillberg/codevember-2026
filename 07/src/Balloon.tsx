import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, FrontSide, Mesh, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three';

const CENTRE = new Vector2(0, 0);
import { MeshPhysicalNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import {
  abs, float, max, mix, mx_noise_float, normalMap, normalViewGeometry, positionViewDirection, saturate, select, uniform, uv,
  vec2, vec3,
} from 'three/tsl';
import { PAINT_H, PAINT_W, PaintLayer, sim, type Dab } from './paint';
import { FINISH, hexToRgb, tool } from './tool';

export const paint = new PaintLayer();
// Dev: 0 normal, 1 coverage, 2 wetness, 3 thickness, 4 tint. And how much wet paint glosses up.
const uDebug = uniform(0);
const uWetGloss = uniform(1);
const uBump = uniform(sim.bump);
const uGrain = uniform(sim.grain);
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
  // Normal from the paint's height: thickness plus a fine grain, differenced across one texel each way in the
  // target. Orange peel on thick paint, ridges along bristle strokes, rounded lips on the runs.
  const px = 1 / PAINT_W, py = 1 / PAINT_H;
  const height = (at: any, props: any) => props.x.add(mx_noise_float(at.mul(vec2(PAINT_W / 3, PAINT_H / 3))).mul(uGrain).mul(props.x));
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
  useFrame(() => { uBump.value = sim.bump; uGrain.value = sim.grain; paint.flush(gl); }, -1);

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
    const spacing = tool.size * (tool.brush === 'spray' ? 0.12 : 0.2);
    if (dist < spacing) return;
    const angle = Math.atan2(dv, du * circ);
    const n = Math.floor(dist / spacing);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      dabAt(((s.u + du * t) % 1 + 1) % 1, s.v + dv * t, angle, s.seed + i);
    }
    const t = n / (dist / spacing);
    s.u = ((s.u + du * t) % 1 + 1) % 1;
    s.v += dv * t;
  };

  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => { if (e.button === 0) painting.current = true; };
    const up = () => { painting.current = false; stroke.current = null; };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
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
      ring.style.width = ring.style.height = `${Math.max(px * 2, 6)}px`;
      ring.style.opacity = h ? '1' : '0.3';
    }
    if (!painting.current || !h) { if (!h) stroke.current = null; return; }
    if (!stroke.current) {
      const seed = Math.random() * 1000;
      stroke.current = { u: h.u, v: h.v, seed };
      dabAt(h.u, h.v, 0, seed);
    } else advance(h.u, h.v);
  }, -2); // before the flush; a positive priority would turn off R3F's own render

  return (
    <group scale={[1, 1.12, 1]}>
      <mesh geometry={geo} material={back} renderOrder={0} />
      <mesh ref={frontRef} geometry={geo} material={front} renderOrder={1} />
    </group>
  );
}
