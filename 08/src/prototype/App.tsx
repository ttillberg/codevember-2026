// PROTOTYPE: a tesseract built like flat-pack furniture, so the structure holds while it turns in 4D.
//
//   nodes   16 corner plugs, one per vertex (±1, ±1, ±1, ±1)
//   rails   32 square profiles, one per edge; every edge is shared by three boards, the rail takes all three
//   boards  24 panels, one per square face, inset in their frame of rails, with an edge band
//   dowels  96 pins, from each board's corners into the node there
//
// Every part is made of points in 4D, turned and seen in perspective along w each frame: as the tesseract turns, the
// parts stretch with the projection and stay joined. Drawn like an assembly manual: ink edges, hidden ones dashed.
// Space pauses the turn.
//
// Run: pnpm -C 08 proto
import { useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

type V4 = number[];
const D = 4.5; // eye distance along w: turning, a corner gets to w = 2, so the eye stays well clear
const SCALE = 1.1;

// ---- the tesseract

const VERTS: V4[] = Array.from({ length: 16 }, (_, k) => [0, 1, 2, 3].map((i) => (k & (1 << i) ? 1 : -1)));
const EDGES: [number, number][] = [];
for (let k = 0; k < 16; k++) for (let i = 0; i < 4; i++) if (!(k & (1 << i))) EDGES.push([k, k | (1 << i)]);
/** Squares: two free axes i < j, the other two fixed; corners in order round the square. */
const FACES: number[][] = [];
for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
  const fixed = [0, 1, 2, 3].filter((a) => a !== i && a !== j);
  for (let f = 0; f < 4; f++) {
    const base = (f & 1 ? 1 << fixed[0] : 0) | (f & 2 ? 1 << fixed[1] : 0);
    FACES.push([base, base | (1 << i), base | (1 << i) | (1 << j), base | (1 << j)]);
  }
}

// ---- sizes, in the tesseract's units (an edge is 2)

const RAIL = 0.035; // half the rail's profile
const NODE = 0.07; // half the corner plug
const BOARD = 0.022; // half a board's thickness
const INSET = 0.07; // how far a board's corners sit in from the vertices, along the face
const DOWEL = 0.018; // dowel radius

// ---- 4D turn and projection

function turn(angles: number[]): number[][] {
  // XW, then ZW, then YW
  const m: number[][] = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)));
  const rot = (k: number, a: number) => {
    const c = Math.cos(a), s = Math.sin(a);
    for (let r = 0; r < 4; r++) {
      const x = m[r][k], w = m[r][3];
      m[r][k] = x * c - w * s; m[r][3] = x * s + w * c;
    }
  };
  rot(0, angles[0]); rot(2, angles[1]); rot(1, angles[2]);
  return m;
}
const apply = (m: number[][], v: V4) => [0, 1, 2, 3].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2] + m[r][3] * v[3]);
/** Screen point and the perspective scale there (to size the parts like the space round them). */
function project(p: V4): [THREE.Vector3, number] {
  const s = (D / (D - p[3])) * SCALE;
  return [new THREE.Vector3(p[0] * s, p[1] * s, p[2] * s), s];
}
const lerp4 = (a: V4, b: V4, t: number) => a.map((x, i) => x + (b[i] - x) * t);

// ---- mesh building

/** Growable flat-shaded triangle buffer. */
class Tris {
  geo = new THREE.BufferGeometry();
  pos: Float32Array; nor: Float32Array; n = 0;
  edges: number[] = []; // the boxes' 12 edges each, as segment pairs, for the drawing
  constructor(max: number) {
    this.pos = new Float32Array(max * 9); this.nor = new Float32Array(max * 9);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
  }
  /** A box from 8 corners, bit 0 along, bits 1 and 2 across; faces outward by the box's middle. */
  box(c: THREE.Vector3[]) {
    for (let k = 0; k < 8; k++) for (const b of [1, 2, 4]) if (!(k & b)) this.edges.push(...c[k].toArray(), ...c[k | b].toArray());
    const mid = c.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / 8);
    for (const [a, b, d, e] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) {
      this.quad(c[a], c[b], c[d], c[e], mid);
    }
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, inside: THREE.Vector3) {
    const n = new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(d, b));
    if (n.lengthSq() < 1e-14) return;
    n.normalize();
    const flip = n.dot(new THREE.Vector3().add(a).add(c).multiplyScalar(0.5).sub(inside)) < 0;
    if (flip) n.negate();
    const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => {
      [p, q, r].forEach((v, k) => { v.toArray(this.pos, this.n * 9 + k * 3); n.toArray(this.nor, this.n * 9 + k * 3); });
      this.n++;
    };
    if (flip) { tri(a, c, b); tri(a, d, c); } else { tri(a, b, c); tri(a, c, d); }
  }
  done() {
    this.geo.setDrawRange(0, this.n * 3);
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true;
    this.geo.computeBoundingSphere();
    this.n = 0;
  }
}

/** Two unit vectors across a direction. */
function across(d: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const u = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  return [u, new THREE.Vector3().crossVectors(d, u).normalize()];
}

/** A square-section bar from a to b, half-widths ra at a and rb at b (tapering with the perspective). */
function bar(out: Tris, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number) {
  const d = new THREE.Vector3().subVectors(b, a).normalize();
  const [u, v] = across(d);
  const c: THREE.Vector3[] = [];
  for (let k = 0; k < 8; k++) {
    const p = k & 1 ? b : a, r = k & 1 ? rb : ra;
    c.push(p.clone().addScaledVector(u, (k & 2 ? 1 : -1) * r).addScaledVector(v, (k & 4 ? 1 : -1) * r));
  }
  out.box(c);
}

const st = { angles: [0.35, 0.2, 0], spin: true, boards: true };

/** Fat line segments, rewritten every frame. */
function segments(max: number, mat: LineMaterial) {
  const geo = new LineSegmentsGeometry();
  geo.setPositions(new Float32Array(max * 6));
  const obj = new LineSegments2(geo, mat);
  obj.frustumCulled = false;
  return { geo, mat, obj };
}
function setSegments(l: ReturnType<typeof segments>, pts: number[], dashed = false) {
  const P = l.geo.attributes.instanceStart as THREE.InterleavedBufferAttribute;
  (P.data.array as Float32Array).set(pts.slice(0, P.data.array.length));
  P.data.needsUpdate = true;
  l.geo.instanceCount = Math.min(pts.length, P.data.array.length) / 6;
  if (dashed) l.obj.computeLineDistances();
}

const INK = '#151515';

/** The kit as a technical drawing: parts filled white (only to hide what's behind), their edges in ink; edges behind
 * other parts dashed and grey, so the inside still reads. */
function Kit() {
  const size = useThree((x) => x.size);
  const parts = useMemo(() => {
    const solid = new Tris((FACES.length * 5 + EDGES.length + 16) * 12);
    const fill = new THREE.Mesh(solid.geo, new THREE.MeshBasicMaterial({
      color: '#ffffff', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    fill.frustumCulled = false;
    const MAX = (FACES.length * 5 + EDGES.length + 16) * 12;
    const seen = segments(MAX, new LineMaterial({ color: INK, linewidth: 1.4 }));
    const hidden = segments(MAX, new LineMaterial({
      color: '#9a9a9a', linewidth: 0.9, dashed: true, dashSize: 0.05, gapSize: 0.05, depthFunc: THREE.GreaterDepth, depthWrite: false,
    }));
    return { solid, fill, seen, hidden };
  }, []);
  useEffect(() => { for (const l of [parts.seen, parts.hidden]) l.mat.resolution.set(size.width, size.height); }, [size, parts]);

  useFrame((_, dt) => {
    if (st.spin) { st.angles[0] += dt * 0.21; st.angles[1] += dt * 0.13; st.angles[2] += dt * 0.07; }
    const m = turn(st.angles);
    const P = VERTS.map((v) => project(apply(m, v)));
    const out = parts.solid;
    out.edges.length = 0;

    // nodes: a cube at each vertex, sized by the perspective there
    for (const [p, s] of P) {
      const c: THREE.Vector3[] = [];
      for (let k = 0; k < 8; k++) c.push(p.clone().add(new THREE.Vector3(k & 1 ? 1 : -1, k & 2 ? 1 : -1, k & 4 ? 1 : -1).multiplyScalar(NODE * s / SCALE)));
      out.box(c);
    }
    // rails: node to node
    for (const [a, b] of EDGES) bar(out, P[a][0], P[b][0], RAIL * P[a][1] / SCALE, RAIL * P[b][1] / SCALE);
    // boards: the face, inset from its corners in 4D, seen in perspective, thickened across its plane;
    // dowels: from each board corner into the node it's fixed to
    if (st.boards) for (const f of FACES) {
      const centre = f.map((k) => VERTS[k]).reduce((a, v) => a.map((x, i) => x + v[i] / 4), [0, 0, 0, 0]);
      const corners = f.map((k) => project(apply(m, lerp4(VERTS[k], centre, INSET))));
      const q = corners.map(([p]) => p);
      const n = new THREE.Vector3().subVectors(q[2], q[0]).cross(new THREE.Vector3().subVectors(q[3], q[1])).normalize();
      const t = corners.map(([, s]) => BOARD * s / SCALE);
      const top = q.map((p, i) => p.clone().addScaledVector(n, t[i])), bot = q.map((p, i) => p.clone().addScaledVector(n, -t[i]));
      out.box([bot[0], bot[1], bot[3], bot[2], top[0], top[1], top[3], top[2]]);
      f.forEach((k, i) => {
        const [node, s] = P[k];
        bar(out, q[i], node, DOWEL * corners[i][1] / SCALE, DOWEL * s / SCALE);
      });
    }
    const lines = out.edges.slice();
    out.done();
    setSegments(parts.seen, lines);
    setSegments(parts.hidden, lines, true);
  });

  return (
    <>
      <primitive object={parts.fill} />
      <primitive object={parts.seen.obj} />
      <primitive object={parts.hidden.obj} />
    </>
  );
}

export function App() {
  const [, redraw] = useState(0);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); st.spin = !st.spin; redraw((x) => x + 1); }
      if (e.key === 'b') { st.boards = !st.boards; redraw((x) => x + 1); }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  return (
    <>
      <Canvas flat camera={{ position: [4.2, 3.4, 9.8], fov: 40 }}>
        <color attach="background" args={['#ffffff']} />
        <Kit />
        <OrbitControls enableDamping enablePan={false} />
      </Canvas>
      <div className="proto-hud">
        <b>TESSERAKTA</b>
        <span>Nodes, rails, boards and dowels, turning in 4D. Space pauses, B hides the boards. Drag to turn.</span>
      </div>
    </>
  );
}
