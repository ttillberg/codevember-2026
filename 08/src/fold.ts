// The tesseract as a net of eight cubes (the cross Dalí hung his Christ on) and the hinges that fold it up through w.
//
// Folded, the tesseract is [-1,1]^3 x [0,2]. The net lies in w = 0: the base cell at the centre, a cell on each of its
// six faces, and the last one, the far cell w = 2, hanging under the bottom arm. A hinge is a square face; turning
// about it is a rotation in the plane of the arm's direction n and w, about the hinge's hyperplane dot(p, n) = at.
// A quarter turn stands the arm up along w. The far cell turns on its own hinge first, in the net's frame, then rides
// the bottom arm's turn: the arm's w turns into +y, which brings it back over the base.
//
// The fold is done in steps, like an assembly manual: fold progress t runs 0..1 over STEPS steps and each hinge turns
// during one of them.

export type V4 = [number, number, number, number];

export interface Hinge { axis: 0 | 1 | 2; sign: 1 | -1; at: number; step: number }
export interface Cell { name: string; offset: [number, number, number]; hinges: Hinge[] }

export const STEPS = 4;

const h = (axis: 0 | 1 | 2, sign: 1 | -1, step: number, at = 1): Hinge => ({ axis, sign, at, step });

export const CELLS: Cell[] = [
  { name: 'base', offset: [0, 0, 0], hinges: [] },
  { name: '+x', offset: [2, 0, 0], hinges: [h(0, 1, 0)] },
  { name: '-x', offset: [-2, 0, 0], hinges: [h(0, -1, 0)] },
  { name: '+z', offset: [0, 0, 2], hinges: [h(2, 1, 1)] },
  { name: '-z', offset: [0, 0, -2], hinges: [h(2, -1, 1)] },
  { name: '+y', offset: [0, 2, 0], hinges: [h(1, 1, 2)] },
  // the bottom arm and the far cell under it go last and together: the far cell closes like a lid as the arm stands up.
  // Inner hinge first (applied in the net's frame), then the arm's. One after the other, the far cell would stand
  // straight out along w to w = 4 and cross the eye at w = D.
  { name: '-y', offset: [0, -2, 0], hinges: [h(1, -1, 3)] },
  { name: 'far', offset: [0, -4, 0], hinges: [h(1, -1, 3, 3), h(1, -1, 3)] },
];

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export const hingeAngle = (hg: Hinge, t: number) => (Math.PI / 2) * ease(t * STEPS - hg.step);

/** Fold a point of a cell's net position (w = 0) to progress t. */
export function foldPoint(cell: Cell, out: V4, t: number): V4 {
  for (const hg of cell.hinges) fold(out, hg, hingeAngle(hg, t));
  return out;
}

/** Corner k (bits x, y, z) of a cell, folded to progress t, in 4D. */
export function corner(cell: Cell, k: number, t: number, out: V4): V4 {
  out[0] = cell.offset[0] + (k & 1 ? 1 : -1);
  out[1] = cell.offset[1] + (k & 2 ? 1 : -1);
  out[2] = cell.offset[2] + (k & 4 ? 1 : -1);
  out[3] = 0;
  return foldPoint(cell, out, t);
}

/** Is this cell turning during step s (0-based)? */
export const movesIn = (cell: Cell, s: number) => cell.hinges.some((hg) => hg.step === s);

function fold(p: V4, { axis, sign, at }: Hinge, a: number) {
  const c = Math.cos(a), s = Math.sin(a);
  const u = sign * p[axis] - at, v = p[3];
  const u2 = u * c - v * s;
  p[axis] += sign * (u2 - u);
  p[3] = u * s + v * c;
}

/** Rotate in the plane of axes i and j. */
export function rot(p: V4, i: number, j: number, a: number) {
  const c = Math.cos(a), s = Math.sin(a);
  const x = p[i], y = p[j];
  p[i] = x * c - y * s;
  p[j] = x * s + y * c;
}

// Cube topology, corners by bit index.
export const EDGES: [number, number][] = [];
for (let k = 0; k < 8; k++) for (const b of [1, 2, 4]) if (!(k & b)) EDGES.push([k, k | b]);

// Each face as a loop of four corners.
export const FACES: [number, number, number, number][] = [];
for (const a of [1, 2, 4]) {
  const [b, c] = [1, 2, 4].filter((x) => x !== a);
  for (const side of [0, a]) FACES.push([side, side | b, side | b | c, side | c]);
}

// ---- 4D -> 3D

const D = 3; // eye distance along w: the far cell comes out at half the size of the near one
const tmp: V4 = [0, 0, 0, 0];

/** Where the camera looks at progress t: the mean of all corners, so it turns about its middle whatever the fold. */
export function centreAt(t: number, out: V4): V4 {
  out.fill(0);
  for (const cell of CELLS) for (let k = 0; k < 8; k++) {
    corner(cell, k, t, tmp);
    for (let i = 0; i < 4; i++) out[i] += tmp[i] / 64;
  }
  return out;
}

/** The net is four cubes tall, the tesseract one and a half: grow as it folds. */
export const zoomAt = (t: number) => 0.68 + 0.5 * ease(t);

/** Centre, turn in XW, YW, ZW, perspective along w. Writes x, y, z into out at o. */
export function project(p: V4, c: V4, angles: number[], zoom: number, out: Float32Array | number[], o = 0) {
  for (let i = 0; i < 4; i++) p[i] -= c[i];
  rot(p, 0, 3, angles[0]);
  rot(p, 1, 3, angles[1]);
  rot(p, 2, 3, angles[2]);
  const s = (D / (D - p[3])) * zoom;
  out[o] = p[0] * s; out[o + 1] = p[1] * s; out[o + 2] = p[2] * s;
}
