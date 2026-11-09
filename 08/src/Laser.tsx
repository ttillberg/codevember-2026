import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { project, type V4, type M4 } from './tesseract';
import { pose } from './state';

// A laser pointer into the tesseract. Hold the pointer still and a pink beam enters the machine where you point and
// travels the way the drone does: straight through the cell it is in, and at every face on into the neighbouring
// cell, the 4D right angle taken. A straight line in 4D would project to a straight line in 3D, so this is what
// following the space looks like from outside: a beam that kinks at every wall it passes.

export const laser = { on: false, x: 0, y: 0 }; // pointer, css px

const PINK = '#ef5f9f';
const MAX_CROSS = 7, MAX_LEN = 10;

/** The 24 square faces: two axes fixed at ±1, two free. Corners in order round the square. */
const FACES: { i: number; si: number; j: number; sj: number; corners: V4[] }[] = [];
for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) for (const si of [-1, 1]) for (const sj of [-1, 1]) {
  const free = [0, 1, 2, 3].filter((a) => a !== i && a !== j);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    const c: V4 = [0, 0, 0, 0];
    c[i] = si; c[j] = sj; c[free[0]] = u; c[free[1]] = v;
    return c;
  });
  FACES.push({ i, si, j, sj, corners });
}

type Cell = { held: number; sign: number; free: number[] };
const cellOf = (held: number, sign: number): Cell => ({ held, sign, free: [0, 1, 2, 3].filter((a) => a !== held) });
const embed = (c: Cell, u: number[]): V4 => { const p: V4 = [0, 0, 0, 0]; p[c.held] = c.sign; c.free.forEach((a, k) => { p[a] = u[k]; }); return p; };

export function Laser() {
  const { camera, size } = useThree();
  const parts = useMemo(() => {
    const geo = new LineGeometry();
    geo.setPositions([0, 0, 0, 0, 0, 0]);
    const mat = new LineMaterial({ color: PINK, linewidth: 2.5, transparent: true, opacity: 0.95, toneMapped: false });
    const line = new Line2(geo, mat);
    line.frustumCulled = false;
    line.visible = false;
    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: PINK, toneMapped: false }), MAX_CROSS + 1);
    dots.count = 0;
    dots.frustumCulled = false;
    return { line, geo, mat, dots };
  }, []);
  useEffect(() => { parts.mat.resolution.set(size.width, size.height); }, [size, parts]);

  const tmp = useMemo(() => ({
    ray: new THREE.Raycaster(), ndc: new THREE.Vector2(),
    a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), hit: new THREE.Vector3(),
    J: new THREE.Matrix3(), v: new THREE.Vector3(), p: new THREE.Vector3(), q: new THREE.Vector3(), dummy: new THREE.Object3D(),
  }), []);

  /** d(project)/du at u in the cell, by central differences. */
  function jacobian(m: M4, cell: Cell, u: number[]): THREE.Matrix3 {
    const h = 0.01, cols: number[] = [];
    for (let k = 0; k < 3; k++) {
      const up = u.slice(), dn = u.slice();
      up[k] += h; dn[k] -= h;
      project(m, embed(cell, up), tmp.p); project(m, embed(cell, dn), tmp.q);
      cols.push((tmp.p.x - tmp.q.x) / (2 * h), (tmp.p.y - tmp.q.y) / (2 * h), (tmp.p.z - tmp.q.z) / (2 * h));
    }
    // columns are d/du_k; Matrix3.set is row-major
    return tmp.J.set(cols[0], cols[3], cols[6], cols[1], cols[4], cols[7], cols[2], cols[5], cols[8]);
  }

  useFrame(() => {
    const { line, geo, dots } = parts;
    if (!laser.on) { line.visible = false; dots.count = 0; return; }
    const m = pose();
    const { ray, ndc, a, b, c, d, hit, v, dummy } = tmp;
    ndc.set((laser.x / size.width) * 2 - 1, -((laser.y / size.height) * 2 - 1));
    ray.setFromCamera(ndc, camera);

    // the first face the pointer's ray meets, and where on it, as weights of its corners
    let best: { face: typeof FACES[number]; dist: number; w: number[] } | null = null;
    for (const face of FACES) {
      const P = face.corners.map((k, n) => project(m, k, [a, b, c, d][n]));
      for (const [i0, i1, i2] of [[0, 1, 2], [0, 2, 3]]) {
        if (!ray.ray.intersectTriangle(P[i0], P[i1], P[i2], false, hit)) continue;
        const dist = hit.distanceTo(ray.ray.origin);
        if (best && dist >= best.dist) continue;
        const bary = new THREE.Vector3();
        THREE.Triangle.getBarycoord(hit, P[i0], P[i1], P[i2], bary);
        const w = [0, 0, 0, 0];
        w[i0] = bary.x; w[i1] = bary.y; w[i2] = bary.z;
        best = { face, dist, w };
      }
    }
    if (!best) { line.visible = false; dots.count = 0; return; }
    const { face, w } = best;
    const p4 = [0, 1, 2, 3].map((k) => face.corners.reduce((acc, cn, n) => acc + cn[k] * w[n], 0)) as V4;

    // of the two cells on the face, the one the beam goes into: where its direction points away from the wall
    let cell: Cell | null = null, dir: number[] = [];
    for (const [held, sign, wall, wallSign] of [[face.i, face.si, face.j, face.sj], [face.j, face.sj, face.i, face.si]]) {
      const cnd = cellOf(held, sign);
      const u = cnd.free.map((ax) => p4[ax]);
      const J = jacobian(m, cnd, u).invert();
      v.copy(ray.ray.direction).applyMatrix3(J).normalize();
      const dd = [v.x, v.y, v.z];
      const k = cnd.free.indexOf(wall);
      if (Math.sign(dd[k]) === -wallSign || !cell) { cell = cnd; dir = dd; if (Math.sign(dd[k]) === -wallSign) break; }
    }
    if (!cell) return;
    const u = cell.free.map((ax) => p4[ax]);

    // march: straight in the cell to the next wall, through it into the neighbour, the held axis swapping
    const pts: number[] = [];
    const hits: THREE.Vector3[] = [];
    project(m, p4, v); pts.push(v.x, v.y, v.z); hits.push(v.clone());
    let len = 0;
    for (let n = 0; n < MAX_CROSS; n++) {
      let t = Infinity, k = -1;
      for (let i = 0; i < 3; i++) if (Math.abs(dir[i]) > 1e-6) {
        const ti = (Math.sign(dir[i]) - u[i]) / dir[i];
        if (ti < t) { t = ti; k = i; }
      }
      if (k < 0) break;
      t = Math.min(t, MAX_LEN - len);
      for (let i = 0; i < 3; i++) u[i] += dir[i] * t;
      len += t;
      project(m, embed(cell, u), v); pts.push(v.x, v.y, v.z);
      if (len >= MAX_LEN) break;
      hits.push(v.clone());
      // through the wall on axis k: it is held now; the old held axis is free, and we move inward along it
      const wallAxis = cell.free[k], wallSign = Math.sign(dir[k]);
      const old = cell.held, oldSign = cell.sign;
      const next = cellOf(wallAxis, wallSign);
      const u2 = next.free.map((ax) => (ax === old ? oldSign : u[cell!.free.indexOf(ax)]));
      const d2 = next.free.map((ax) => (ax === old ? -oldSign * Math.abs(dir[k]) : dir[cell!.free.indexOf(ax)]));
      cell = next; u.splice(0, 3, ...u2); dir = d2;
    }
    geo.setPositions(pts);
    line.visible = true;
    line.computeLineDistances();
    hits.forEach((h, i) => { dummy.position.copy(h); dummy.scale.setScalar(i === 0 ? 1.4 : 1); dummy.updateMatrix(); dots.setMatrixAt(i, dummy.matrix); });
    dots.count = hits.length;
    dots.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <primitive object={parts.line} />
      <primitive object={parts.dots} />
    </>
  );
}
