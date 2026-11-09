import * as THREE from 'three';

// The tesseract: 16 vertices at (±1, ±1, ±1, ±1), 32 edges along one axis each.
// Turned in 4D and seen in perspective along w, it is a 3D object whose edges change length.
// That is the whole mechanism: a strut per edge that telescopes, a ball joint per vertex.

export type V4 = [number, number, number, number];

export const VERTS: V4[] = Array.from({ length: 16 }, (_, k) => [0, 1, 2, 3].map((i) => (k & (1 << i) ? 1 : -1)) as V4);

export const EDGES: { a: number; b: number; axis: number }[] = [];
for (let k = 0; k < 16; k++) for (let i = 0; i < 4; i++) if (!(k & (1 << i))) EDGES.push({ a: k, b: k | (1 << i), axis: i });

/** Eye distance along w. A corner gets to w = 2 at most, so the eye stays clear. */
export const D = 4.6;
export const SCALE = 1.05;

export type M4 = number[][];

/** Rotation by a in the plane of axis k (0 x, 1 y, 2 z) and w. */
export function rotPlane(k: number, a: number): M4 {
  const m: M4 = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)));
  const c = Math.cos(a), s = Math.sin(a);
  m[k][k] = c; m[k][3] = -s;
  m[3][k] = s; m[3][3] = c;
  return m;
}

export const mul = (a: M4, b: M4): M4 => a.map((row) => [0, 1, 2, 3].map((j) => row.reduce((acc, x, k) => acc + x * b[k][j], 0)));

/** Turn a vertex and project it: perspective along w, eye at (0, 0, 0, D). */
export function project(m: M4, v: V4, out: THREE.Vector3): THREE.Vector3 {
  const p = [0, 1, 2, 3].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2] + m[r][3] * v[3]);
  const s = (D / (D - p[3])) * SCALE;
  return out.set(p[0] * s, p[1] * s, p[2] * s);
}
