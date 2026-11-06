import { useLayoutEffect, useMemo, useRef } from 'react';
import { CatmullRomCurve3, InstancedMesh, Matrix4, Quaternion, TubeGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rodRadius } from './layout';

// Cross-section angles of the two rods, measured from straight down, positive towards the outside of the orbit:
// they cradle the marble from below like a marble run.
const RODS = [-45, 45].map((d) => (d * Math.PI) / 180);

// Unit normal of the orbit's plane (the orbit runs counterclockwise around it).
export function planeNormal(path: Vector3[]) {
  const n = new Vector3();
  for (let i = 0; i < path.length; i++) n.add(new Vector3().crossVectors(path[i], path[(i + 1) % path.length]));
  return n.normalize();
}

// Each ring hangs by its own four chains, straight up to winches in the ceiling, in two opposite pairs: reeling
// them in and out tilts the ring, and that tilt is what rolls the marble. Every ring rolls at its own speed, so
// no two rings can share chains.
export const CHAINS_PER_RING = 4;
export const ANCHORS = Array.from({ length: CHAINS_PER_RING }, (_, i) => Math.PI / 2 + (i * Math.PI * 2) / CHAINS_PER_RING);

// Index of the path point closest to a polar angle (in the horizontal plane).
export function anchorIndex(path: Vector3[], phi: number) {
  let best = 0, bd = Infinity;
  path.forEach((v, i) => {
    const d = Math.abs(Math.atan2(Math.sin(Math.atan2(-v.z, v.x) - phi), Math.cos(Math.atan2(-v.z, v.x) - phi)));
    if (d < bd) (bd = d), (best = i);
  });
  return best;
}

const normals = new WeakMap<Vector3[], Vector3>();
// A point in a rail's cross-section at path index i: angle from straight down (positive outwards), distance from
// the marble's centre line. Ring-local.
export function railPoint(path: Vector3[], i: number, angle: number, dist: number) {
  let n = normals.get(path);
  if (!n) normals.set(path, (n = planeNormal(path)));
  const N = path.length;
  const t = new Vector3().subVectors(path[(i + 1) % N], path[(i - 1 + N) % N]).normalize();
  const out = new Vector3().crossVectors(t, n).normalize();
  return path[i].clone().addScaledVector(n, -Math.cos(angle) * dist).addScaledVector(out, Math.sin(angle) * dist);
}

// The chain's bracket: an L of wire soldered to the outer rod, out sideways past the marble, then up to an eye
// level with the marble's centre. The chain rises vertically from the eye, clear of the marble's path.
const CLEAR = 0.35;
export function bracket(path: Vector3[], r: number, i: number, fine = false) {
  const rr = rodRadius(r, fine);
  const d = r + rr;
  const rod = railPoint(path, i, Math.PI / 4, d);
  const reach = r + CLEAR + rr;
  const low = Math.SQRT1_2 * d; // the outer rod sits this far below the centre line
  const corner = railPoint(path, i, Math.PI / 2, reach).addScaledVector(normals.get(path)!, -low);
  const eye = railPoint(path, i, Math.PI / 2, reach);
  return { rod, corner, eye };
}

const STEEL = { color: '#d9dcdf', metalness: 1, roughness: 0.22 } as const;
const SILVER = { color: '#f4f3ef', metalness: 1, roughness: 0.1 } as const;
const SOLDER = { color: '#b9bab4', metalness: 1, roughness: 0.45 } as const;

// Deterministic jitter so the solder blobs differ but do not change between renders.
const jitter = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// A bent wire track like a hand-soldered marble run: two steel rods along the marble's centre line, joined at
// regular intervals by little U-shaped ties that dip under the marble, a blob of solder at every joint.
export function Rail({ path, r, fine = false }: { path: Vector3[]; r: number; fine?: boolean }) {
  const metal = fine ? SILVER : STEEL;
  const blobs = useRef<InstancedMesh>(null!);

  const { rods, ties, joints } = useMemo(() => {
    const n = planeNormal(path);
    const rr = rodRadius(r, fine);
    const d = r + rr;
    const N = path.length;
    const frames = path.map((p, i) => {
      const t = new Vector3().subVectors(path[(i + 1) % N], path[(i - 1 + N) % N]).normalize();
      return { p, t, out: new Vector3().crossVectors(t, n).normalize() };
    });
    const at = (f: (typeof frames)[number], a: number, rad: number) =>
      f.p.clone().addScaledVector(n, -Math.cos(a) * rad).addScaledVector(f.out, Math.sin(a) * rad);

    const rods = RODS.map(
      (a) => new TubeGeometry(new CatmullRomCurve3(frames.map((f) => at(f, a, d)), true), Math.max(256, N * 2), rr, 8, true),
    );

    // Ties every few marble diameters, by arc length.
    const spacing = 2.6 * r + 1.2;
    const tieGeos = [];
    const joints: { p: Vector3; t: Vector3 }[] = [];
    let acc = spacing / 2;
    for (let i = 0; i < N; i++) {
      acc += path[i].distanceTo(path[(i + 1) % N]);
      if (acc < spacing) continue;
      acc = 0;
      const f = frames[i];
      const pts = [];
      for (let k = 0; k <= 10; k++) {
        const a = RODS[0] + ((RODS[1] - RODS[0]) * k) / 10;
        pts.push(at(f, a, d + 2.2 * rr * Math.cos(2 * a))); // dips 2 rod radii under the marble at the bottom
      }
      tieGeos.push(new TubeGeometry(new CatmullRomCurve3(pts), 20, rr * 0.8, 6, false));
      for (const a of RODS) joints.push({ p: at(f, a, d), t: f.t });
    }
    // Chain brackets, with a solder blob where each meets the rod and a little eye on top.
    for (const a of ANCHORS) {
      const b = bracket(path, r, anchorIndex(path, a), fine);
      const pts = [b.rod, b.rod.clone().lerp(b.corner, 0.5), b.corner, b.corner.clone().lerp(b.eye, 0.5), b.eye];
      tieGeos.push(new TubeGeometry(new CatmullRomCurve3(pts, false, 'catmullrom', 0.1), 16, rr * 0.8, 6, false));
      joints.push({ p: b.rod, t: new Vector3().subVectors(b.corner, b.rod).normalize() });
      joints.push({ p: b.eye, t: n.clone() });
    }
    return { rods, ties: tieGeos.length ? mergeGeometries(tieGeos) : null, joints, rr };
  }, [path, r, fine]);

  // Blobs: squashed, stretched along the rod, a little different each.
  useLayoutEffect(() => {
    const m = new Matrix4(), q = new Quaternion(), s = new Vector3();
    const rr = rodRadius(r, fine);
    const X = new Vector3(1, 0, 0);
    joints.forEach((j, i) => {
      q.setFromUnitVectors(X, j.t);
      const k = rr * (1.7 + 0.6 * jitter(i));
      s.set(k * (1.6 + 0.8 * jitter(i + 99)), k, k * (0.85 + 0.3 * jitter(i + 7)));
      m.compose(j.p, q, s);
      blobs.current.setMatrixAt(i, m);
    });
    blobs.current.count = joints.length;
    blobs.current.instanceMatrix.needsUpdate = true;
  }, [joints, r, fine]);

  return (
    <>
      {rods.map((g, i) => (
        <mesh key={i} geometry={g} castShadow receiveShadow>
          <meshStandardMaterial {...metal} />
        </mesh>
      ))}
      {ties && (
        <mesh geometry={ties} castShadow receiveShadow>
          <meshStandardMaterial {...metal} />
        </mesh>
      )}
      <instancedMesh key={joints.length} ref={blobs} args={[undefined, undefined, Math.max(1, joints.length)]} castShadow>
        <icosahedronGeometry args={[1, 2]} />
        <meshStandardMaterial {...SOLDER} />
      </instancedMesh>
    </>
  );
}
