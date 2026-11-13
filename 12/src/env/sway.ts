import * as THREE from 'three';
import { Spring } from '../bird/util';
import { GRIP_X } from './branch';

// The twig gives a little under the bird. It is held off-screen to the left and bends as
// one mode, a cantilever: a point at x moves phi(x) times the tip's motion, up-down and
// a little sideways, each on its own damped spring. The bird's weight sags it where it
// stands; a landing or a push-off is a kick. The side shoot rides along rigidly at its
// root and its tip lags behind on a spring of its own, so the buds nod after the twig.
// Everything is moved in the vertex shader (the branch meshes sit in world space).

/** where the twig is held, and its far tip */
const XA = -3;
const XT = 1.8;
const INV = 1 / (XT - XA);

/** cantilever shape: 0 at the hold, 1 at the tip */
export function phi(x: number) {
  const s = Math.max(0, (x - XA) * INV);
  return s * s;
}
/** its slope, d phi / dx */
function dphi(x: number) {
  return 2 * Math.max(0, (x - XA) * INV) * INV;
}

export interface Sway {
  uniforms: {
    uSway: { value: THREE.Vector2 };
    uShootRoot: { value: THREE.Vector3 };
    uShootAxis: { value: THREE.Vector3 };
    uShootMove: { value: THREE.Vector3 };
    uShootBend: { value: THREE.Vector3 };
    uBudBend: { value: THREE.Vector3 };
  };
  /** 0 = rigid, 1 = default, more = softer */
  give: number;
  /** how far the twig has moved at world x */
  at(x: number, out: THREE.Vector3): THREE.Vector3;
  /** the bird's weight: on the twig at x, or off it (null) */
  load(x: number | null): void;
  /** come to rest under the present load at once (no bounce at the start) */
  settle(): void;
  /** feet pressing on the twig at x (a landing, a push-off); side: which way along z, -1..1 */
  push(x: number, strength: number, side?: number): void;
  /** patch every mesh under root to bend with the twig; the shoot's meshes get its whip */
  use(root: THREE.Object3D): void;
  /** make one material bend with the twig (a mask material drawn over the branch meshes) */
  patch(mat: THREE.Material): void;
  /** is this ray among the flowers? fills in the nearest point on the stem */
  reach(ray: THREE.Ray, out: THREE.Vector3): boolean;
  /** the pointer brushes past the shoot at this point on the stem, moving this fast, for dt seconds */
  brush(at: THREE.Vector3, velocity: THREE.Vector3, dt: number): void;
  update(dt: number): void;
}

const CHUNK = /* glsl */ `
uniform vec2 uSway;
uniform vec3 uShootRoot;
uniform vec3 uShootAxis;
uniform vec3 uShootMove;
uniform vec3 uShootBend;
uniform vec3 uBudBend;
attribute float aShoot; // 0 twig, 1 the shoot's stem, 2 its flowers
`;
const VERT = /* glsl */ `
{
  // the shoot is carried at its root, the rest bends along the twig
  float sx = max(0.0, (mix(transformed.x, uShootRoot.x, min(aShoot, 1.0)) - ${XA.toFixed(3)}) * ${INV.toFixed(5)});
  transformed.yz += sx * sx * uSway;
  if (aShoot > 0.5) {
    vec3 r = position - uShootRoot;
    float u = clamp(dot(r, uShootAxis) / dot(uShootAxis, uShootAxis), 0.0, 1.0);
    transformed += cross(uShootMove, r) + (uShootBend + step(1.5, aShoot) * uBudBend) * u * u;
  }
}`;

/** a point that follows a moving target on a damped spring: a mass on a stem */
class Lag {
  p = new THREE.Vector3();
  v = new THREE.Vector3();
  constructor(
    public freq: number,
    public zeta: number,
  ) {}
  reset(at: THREE.Vector3) {
    this.p.copy(at);
    this.v.set(0, 0, 0);
  }
  step(target: THREE.Vector3, dt: number) {
    const w = 2 * Math.PI * this.freq;
    const n = Math.max(1, Math.ceil(dt * this.freq * 8));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      for (const k of ['x', 'y', 'z'] as const) this.v[k] += (-w * w * (this.p[k] - target[k]) - 2 * this.zeta * w * this.v[k]) * h;
      this.p.addScaledVector(this.v, h);
    }
    return this.p;
  }
}

export function createSway(): Sway {
  // a thin live twig: quick and well damped, a couple of swings and it is still
  const up = new Spring(3.4, 0.2);
  const side = new Spring(2.9, 0.22);
  // the shoot's stem is short and stiff and hardly lags; the flower heads are the weight
  // on it, slower, and nod a little after it
  const stem = new Lag(4.5, 0.45);
  const heads = new Lag(2.6, 0.3);
  /** how much of their lag shows: the shoot only answers the twig a little */
  const SHOOT = 0.5;
  // the pointer brushing past: a nudge to the stem, which springs back
  const hand = new Lag(4.2, 0.38);
  const rest = new THREE.Vector3();
  /** how much a passing pointer gives the stem, and the most the stem takes */
  const BRUSH = 20;
  const BRUSH_MAX = 0.4;
  /** how far from the stem the flowers reach */
  const REACH = 0.11;
  let hasShoot = false;
  const tipAt = new THREE.Vector3();
  const onRay = new THREE.Vector3();
  const carried = new THREE.Vector3();
  const stemAt = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let first = true;
  let loadX: number | null = null;
  const uniforms: Sway['uniforms'] = {
    uSway: { value: new THREE.Vector2() },
    uShootRoot: { value: new THREE.Vector3(0.95, 0.04, 0.1) },
    uShootAxis: { value: new THREE.Vector3(0.45, 0.65, 0) },
    uShootMove: { value: new THREE.Vector3() },
    uShootBend: { value: new THREE.Vector3() },
    uBudBend: { value: new THREE.Vector3() },
  };
  // how far the twig sags under the bird at the grip, and how hard one full push kicks it
  const SAG = 0.005;
  /** where the tip rests under the bird's weight (sag at x is this times phi(x): SAG at the grip) */
  const sagTarget = () => (loadX === null ? 0 : (-SAG * sway.give * phi(loadX)) / phi(GRIP_X) ** 2);
  const KICK = 1.0;

  const patched = new WeakSet<THREE.Material>();
  function patch(mat: THREE.Material) {
    if (patched.has(mat)) return;
    patched.add(mat);
    const prev = mat.onBeforeCompile;
    const key = mat.customProgramCacheKey();
    mat.onBeforeCompile = (s, r) => {
      prev.call(mat, s, r);
      Object.assign(s.uniforms, uniforms);
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n${CHUNK}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT}`);
    };
    mat.customProgramCacheKey = () => `${key}|sway`;
    mat.needsUpdate = true;
  }

  const sway: Sway = {
    uniforms,
    patch,
    reach(ray, out) {
      if (!hasShoot) return false;
      const root = uniforms.uShootRoot.value;
      tipAt.copy(root).add(uniforms.uShootAxis.value);
      // (the flowers sit along the upper part of the stem)
      return ray.distanceSqToSegment(tmp.copy(root).lerp(tipAt, 0.15), tipAt, onRay, out) < REACH * REACH;
    },
    brush(at, v, dt) {
      // touched near the tip it gives more than down by the root
      const ax = uniforms.uShootAxis.value;
      const u = THREE.MathUtils.clamp(tmp.copy(at).sub(uniforms.uShootRoot.value).dot(ax) / ax.lengthSq(), 0, 1);
      // across the stem only (it bends, it doesn't stretch); a quick pass gives more than a slow one
      const dir = tmp.copy(ax).normalize();
      const speed = THREE.MathUtils.clamp(v.length(), 0.3, 2);
      hand.v.addScaledVector(v, BRUSH * dt * speed * (0.3 + u)).addScaledVector(dir, -hand.v.dot(dir) * 0.8);
      if (hand.v.length() > BRUSH_MAX) hand.v.setLength(BRUSH_MAX);
    },
    give: 1,
    at(x, out) {
      const f = phi(x);
      return out.set(0, up.x * f, side.x * f);
    },
    load(x) {
      loadX = x;
    },
    settle() {
      up.x = sagTarget();
      up.v = side.x = side.v = 0;
      first = true;
    },
    push(x, strength, s = 0) {
      const f = phi(x) * KICK * strength * sway.give;
      up.kick(-f);
      side.kick(f * 0.35 * s);
    },
    use(root) {
      root.updateMatrixWorld(true);
      const shootMeshes: THREE.Mesh[] = [];
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) patch(mat);
        if (/^(shoot|buds|hairs)$/.test(m.name)) shootMeshes.push(m);
      });
      // the shoot: root at its lowest end, axis up to its highest
      const shoot = shootMeshes.find((m) => m.name === 'shoot');
      hasShoot = !!shoot;
      if (shoot) {
        const pos = shoot.geometry.getAttribute('position') as THREE.BufferAttribute;
        shoot.geometry.computeBoundingBox();
        const bb = shoot.geometry.boundingBox!;
        const lo = new THREE.Vector3();
        const hi = new THREE.Vector3();
        let nl = 0;
        let nh = 0;
        const p = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          p.fromBufferAttribute(pos, i);
          if (p.y < bb.min.y + 0.03) (lo.add(p), nl++);
          if (p.y > bb.max.y - 0.03) (hi.add(p), nh++);
        }
        lo.divideScalar(Math.max(nl, 1));
        hi.divideScalar(Math.max(nh, 1));
        uniforms.uShootRoot.value.copy(lo);
        uniforms.uShootAxis.value.copy(hi).sub(lo);
      }
      for (const m of shootMeshes) {
        const n = m.geometry.getAttribute('position').count;
        m.geometry.setAttribute('aShoot', new THREE.Float32BufferAttribute(new Float32Array(n).fill(m.name === 'shoot' ? 1 : 2), 1));
      }
      first = true;
    },
    update(dt) {
      if (dt <= 0) return;
      up.step(sagTarget(), dt);
      side.step(0, dt);
      uniforms.uSway.value.set(up.x, side.x);
      // the shoot turns with the twig's slope at its root, carried rigidly
      const root = uniforms.uShootRoot.value;
      const axis = uniforms.uShootAxis.value;
      const slope = dphi(root.x);
      const ride = phi(root.x);
      const mv = uniforms.uShootMove.value.set(0, -slope * side.x, slope * up.x);
      // where its tip would be if it were stiff, and a soft tip that follows on a spring
      carried.copy(axis).add(tmp.crossVectors(mv, axis));
      carried.y += ride * up.x;
      carried.z += ride * side.x;
      if (first) {
        first = false;
        stem.reset(carried);
        heads.reset(carried);
        hand.reset(rest);
      }
      // the stem lags the carried tip (and whatever a finger does to it), the heads lag the stem
      stem.step(carried, dt);
      hand.step(rest, dt);
      stemAt.copy(carried).lerp(stem.p, SHOOT).add(hand.p);
      heads.step(stemAt, dt);
      uniforms.uShootBend.value.copy(stemAt).sub(carried);
      uniforms.uBudBend.value.copy(heads.p).sub(stemAt).multiplyScalar(SHOOT);
    },
  };
  return sway;
}
