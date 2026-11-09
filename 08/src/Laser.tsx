import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { project, type V4, type M4 } from './tesseract';
import { pose } from './state';

// A laser into the tesseract. Wherever the pointer is, a pink beam comes in level across the screen, right to left,
// through the point under it, and goes straight on through the machine. At every wall it
// crosses it is displaced: a short jog sideways along that wall's 4D normal as it projects right now, and then on,
// parallel to itself, at half the strength. Straight, stepped and dimmed at every wall, like light through a stack
// of glass; the steps turn with the machine because the normals do.

export const laser = { on: false, x: 0, y: 0 }; // pointer, css px
/** Where the beam met walls this frame, in 4D, nearest first, with the strength it had there. For the drone cam. */
export const beamHits: { i: number; si: number; j: number; sj: number; p4: V4; k: number }[] = [];
export const BEAM = { PINK: new THREE.Color('#ef5f9f'), CORE: new THREE.Color('#ffd6ea'), LOSS: 0.5 };

const PINK = BEAM.PINK;
const CORE = BEAM.CORE; // the hot middle of the beam
const PAPER = new THREE.Color('#e6e6e4'); // what the beam fades towards
/** No post bloom on a transparent canvas: the glow is the beam drawn three times, a hot core and two soft halos. */
const LAYERS = [
  { width: 1, opacity: 1, core: true },
  { width: 3.5, opacity: 0.35, core: false },
  { width: 9, opacity: 0.12, core: false },
];
const MAX_WALLS = 8;
const STEP = 0.11; // the jog at a wall, 3D units
const LOSS = 0.5; // the strength left after a wall
const TAIL = 0.7; // how far the beam runs past the last wall
const FROM_RIGHT = 9; // the beam comes in level across the screen, from this far right of the point you hold

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

type Hit = { face: typeof FACES[number]; dist: number; at: THREE.Vector3; p4: V4 };

export function Laser() {
  const { camera, size } = useThree();
  const parts = useMemo(() => {
    const group = new THREE.Group();
    const lines = LAYERS.map((l) => {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 0, 0, 0]);
      geo.setColors([1, 1, 1, 1, 1, 1]);
      const mat = new LineMaterial({ linewidth: l.width, vertexColors: true, toneMapped: false, transparent: true, opacity: l.opacity, depthWrite: false });
      const line = new Line2(geo, mat);
      line.frustumCulled = false;
      group.add(line);
      return { line, geo, mat, core: l.core };
    });
    const dot = (r: number, opacity: number) => {
      const o = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity === 1 }), MAX_WALLS * 2);
      o.count = 0;
      o.frustumCulled = false;
      group.add(o);
      return o;
    };
    const dots = [dot(0.016, 1), dot(0.035, 0.3), dot(0.065, 0.1)];
    group.visible = false;
    return { group, lines, dots };
  }, []);
  useEffect(() => { for (const l of parts.lines) l.mat.resolution.set(size.width, size.height); }, [size, parts]);

  const tmp = useMemo(() => ({
    ray: new THREE.Raycaster(), ndc: new THREE.Vector2(), hand: new THREE.Vector3(), beam: new THREE.Ray(),
    a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), hit: new THREE.Vector3(),
    bary: new THREE.Vector3(), p: new THREE.Vector3(), q: new THREE.Vector3(), n: new THREE.Vector3(), off: new THREE.Vector3(),
    cur: new THREE.Vector3(), dummy: new THREE.Object3D(), col: new THREE.Color(),
  }), []);

  /** Every face a ray meets, nearest first, each with the 4D point met. */
  function hits(m: M4, ray: THREE.Ray, all: boolean): Hit[] {
    const { a, b, c, d, hit, bary } = tmp;
    const out: Hit[] = [];
    for (const face of FACES) {
      const P = face.corners.map((k, n) => project(m, k, [a, b, c, d][n]));
      for (const [i0, i1, i2] of [[0, 1, 2], [0, 2, 3]]) {
        if (!ray.intersectTriangle(P[i0], P[i1], P[i2], false, hit)) continue;
        THREE.Triangle.getBarycoord(hit, P[i0], P[i1], P[i2], bary);
        const w = [0, 0, 0, 0];
        w[i0] = bary.x; w[i1] = bary.y; w[i2] = bary.z;
        const p4 = [0, 1, 2, 3].map((k) => face.corners.reduce((acc, cn, n) => acc + cn[k] * w[n], 0)) as V4;
        out.push({ face, dist: hit.distanceTo(ray.origin), at: hit.clone(), p4 });
        if (!all) break;
      }
    }
    out.sort((x, y) => x.dist - y.dist);
    return out;
  }

  /** The wall's 4D normal, seen in 3D at the point: the fixed axis that lies most across the beam, pointing inward. */
  function jog(m: M4, h: Hit, dir: THREE.Vector3, out: THREE.Vector3) {
    const { p, q, n } = tmp;
    let best = Infinity;
    for (const [axis, sign] of [[h.face.i, h.face.si], [h.face.j, h.face.sj]]) {
      const up = h.p4.slice() as V4, dn = h.p4.slice() as V4;
      up[axis] += 0.01; dn[axis] -= 0.01;
      project(m, up, p); project(m, dn, q);
      n.subVectors(p, q).multiplyScalar(-sign).normalize(); // inward
      n.addScaledVector(dir, -n.dot(dir)); // across the beam
      const along = Math.abs(1 - n.length()); // small when the normal was already across
      if (n.lengthSq() > 1e-6 && along < best) { best = along; out.copy(n).normalize(); }
    }
    if (best === Infinity) out.set(0, 0, 0);
  }

  useFrame(() => {
    const { group, lines, dots } = parts;
    beamHits.length = 0;
    if (!laser.on) { group.visible = false; return; }
    const m = pose();
    const { ray, ndc, hand, beam, off, cur, dummy, col } = tmp;
    ndc.set((laser.x / size.width) * 2 - 1, -((laser.y / size.height) * 2 - 1));
    ray.setFromCamera(ndc, camera);

    // the point under the pointer, on the first face its ray meets; the beam comes in level across the screen,
    // right to left, through it
    const target = hits(m, ray.ray, false)[0];
    if (!target) { group.visible = false; return; }
    cur.setFromMatrixColumn(camera.matrixWorld, 0); // the camera's right
    hand.copy(target.at).addScaledVector(cur, FROM_RIGHT);
    beam.set(hand, cur.negate());

    // every wall along the beam, nearest first; at each a jog, then on parallel, half as strong
    const walls = hits(m, beam, true).filter((h, i, arr) => i === 0 || h.dist - arr[i - 1].dist > 1e-3).slice(0, MAX_WALLS);
    const pts: number[] = [hand.x, hand.y, hand.z];
    const cols: number[] = [], coreCols: number[] = [];
    const marks: { p: THREE.Vector3; k: number }[] = [];
    let strength = 1;
    const push = (p: THREE.Vector3) => { pts.push(p.x, p.y, p.z); };
    const tint = () => {
      col.copy(PAPER).lerp(PINK, strength); cols.push(col.r, col.g, col.b);
      col.copy(PAPER).lerp(CORE, strength); coreCols.push(col.r, col.g, col.b);
    };
    tint();
    off.set(0, 0, 0);
    for (const h of walls) {
      beamHits.push({ i: h.face.i, si: h.face.si, j: h.face.j, sj: h.face.sj, p4: h.p4, k: strength });
      cur.copy(h.at).add(off);
      push(cur); tint(); marks.push({ p: cur.clone(), k: strength });
      jog(m, h, beam.direction, tmp.n);
      off.addScaledVector(tmp.n, STEP);
      strength *= LOSS;
      cur.copy(h.at).add(off);
      push(cur); tint(); marks.push({ p: cur.clone(), k: strength });
    }
    const last = walls.length ? walls[walls.length - 1].dist : target.dist;
    cur.copy(beam.origin).addScaledVector(beam.direction, last + TAIL).add(off);
    push(cur); tint();

    for (const l of lines) {
      l.geo.setPositions(pts);
      l.geo.setColors(l.core ? coreCols : cols);
      l.line.computeLineDistances();
    }
    group.visible = true;
    for (const d of dots) {
      marks.forEach(({ p, k }, i) => {
        dummy.position.copy(p); dummy.scale.setScalar(0.6 + 0.4 * k); dummy.updateMatrix();
        d.setMatrixAt(i, dummy.matrix);
        d.setColorAt(i, col.copy(PAPER).lerp(d === dots[0] ? CORE : PINK, k));
      });
      d.count = marks.length;
      d.instanceMatrix.needsUpdate = true;
      if (d.instanceColor) d.instanceColor.needsUpdate = true;
    }
  });

  return <primitive object={parts.group} />;
}
