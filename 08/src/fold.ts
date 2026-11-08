// A 4D wardrobe: a tesseract-shaped box, flat-packed as its net of eight cells (the cross Dalí painted), folded up
// through w, then a door that opens.
//
// Folded, the wardrobe is [-A,A] x [-B,B] x [-C,C] x [0,L]: tall and shallow in 3D, L deep in w. The net lies in
// w = 0: the base cell in the middle, a cell on each of its six faces, L thick, and the far cell under the bottom arm.
// A hinge is a square face; turning about it is a rotation in a plane about the hinge, here the plane of the arm's
// direction and w, so a quarter turn stands the arm up along w. The far cell turns on its own hinge in the net's frame
// first, then rides the bottom arm's turn, which sends w into +y and lays it over the base.
//
// The door is the +z cell. Once folded it hangs on its face with the +x cell and swings in the zx plane, like any
// door, except a door of a 4D wardrobe is a whole cube.
//
// Steps like an assembly manual: progress t runs 0..1 over STEPS steps and each hinge turns during one of them.

export type V4 = [number, number, number, number];

export const A = 1, B = 1.8, C = 0.65, L = 1.6;
export const STEPS = 5;
export const DOOR_STEP = 4;

/** Rotation of (p[i] - ci, p[j] - cj) by sign x angle, angle eased 0..max over its step. */
export interface Hinge { i: number; j: number; ci: number; cj: number; sign: 1 | -1; step: number; max: number }
export interface Cell {
  name: string;
  offset: [number, number, number];
  size: [number, number, number]; // half sizes
  hinges: Hinge[]; // applied in order
  arrow?: [number, number, number]; // where its arrow starts, in the net; default just off its outer face
  noArrow?: boolean;
}

const Q = Math.PI / 2;
/** Fold hinge: arm along sign * axis, hinged at sign * at, standing up into w. */
const fold = (axis: number, sign: 1 | -1, step: number, at: number): Hinge => ({
  i: axis, j: 3, ci: sign * at, cj: 0, sign, step, max: Q,
});

export const DOOR = 3;

export const CELLS: Cell[] = [
  { name: 'base', offset: [0, 0, 0], size: [A, B, C], hinges: [] },
  { name: '+x', offset: [A + L / 2, 0, 0], size: [L / 2, B, C], hinges: [fold(0, 1, 0, A)] },
  { name: '-x', offset: [-A - L / 2, 0, 0], size: [L / 2, B, C], hinges: [fold(0, -1, 0, A)] },
  {
    name: 'door', offset: [0, 0, C + L / 2], size: [A, B, L / 2],
    // folded first, then swung about the line x = A, z = C, out towards +z
    hinges: [fold(2, 1, 1, C), { i: 2, j: 0, ci: C, cj: A, sign: 1, step: DOOR_STEP, max: Q * 1.15 }],
    arrow: [-A, 0, C + L + 0.15],
  },
  { name: '-z', offset: [0, 0, -C - L / 2], size: [A, B, L / 2], hinges: [fold(2, -1, 1, C)] },
  { name: '+y', offset: [0, B + L / 2, 0], size: [A, L / 2, C], hinges: [fold(1, 1, 2, B)] },
  // The bottom arm and the far cell go last and together: the far cell closes like a lid as the arm stands up.
  // One after the other, the far cell would stand straight out along w and cross the eye at w = D.
  { name: '-y', offset: [0, -B - L / 2, 0], size: [A, L / 2, C], hinges: [fold(1, -1, 3, B)] },
  {
    name: 'far', offset: [0, -2 * B - L, 0], size: [A, B, C],
    hinges: [fold(1, -1, 3, B + L), fold(1, -1, 3, B)], noArrow: true,
  },
];

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const stepProgress = (t: number, step: number) => ease(t * STEPS - step);

/** Fold a point of a cell's net position (w = 0) to progress t. */
export function foldPoint(cell: Cell, p: V4, t: number): V4 {
  for (const hg of cell.hinges) {
    const a = hg.sign * hg.max * stepProgress(t, hg.step);
    if (a === 0) continue;
    const c = Math.cos(a), s = Math.sin(a);
    const u = p[hg.i] - hg.ci, v = p[hg.j] - hg.cj;
    p[hg.i] = hg.ci + u * c - v * s;
    p[hg.j] = hg.cj + u * s + v * c;
  }
  return p;
}

/** Corner k (bits x, y, z) of a cell, folded to progress t, in 4D. */
export function corner(cell: Cell, k: number, t: number, out: V4): V4 {
  for (let a = 0; a < 3; a++) out[a] = cell.offset[a] + (k & (1 << a) ? 1 : -1) * cell.size[a];
  out[3] = 0;
  return foldPoint(cell, out, t);
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

/** Every square face is shared by two cells. The door's six belong to it: on the other cells they go when it opens.
 * Per cell, the indices into FACES that lie on z = C once folded. */
export const DOOR_FACES: number[][] = CELLS.map((cell, ci) => {
  if (ci === DOOR) return [];
  const p: V4 = [0, 0, 0, 0];
  const closed = DOOR_STEP / STEPS;
  return FACES.flatMap((f, fi) => (f.every((k) => Math.abs(corner(cell, k, closed, p)[2] - C) < 1e-6) ? [fi] : []));
});

// ---- 4D -> 3D

const D = 3; // eye distance along w: the far cell comes out bigger than the base, like a box seen from in front
const tmp: V4 = [0, 0, 0, 0];

/** Where the camera looks at progress t: the mean of the carcass's corners (not the door's, it swings about), so it
 * turns about its middle whatever the fold. */
export function centreAt(t: number, out: V4): V4 {
  out.fill(0);
  const tt = Math.min(t, DOOR_STEP / STEPS);
  for (const cell of CELLS) for (let k = 0; k < 8; k++) {
    corner(cell, k, tt, tmp);
    for (let i = 0; i < 4; i++) out[i] += tmp[i] / 64;
  }
  return out;
}

/** The net is long, the wardrobe compact: grow as it folds. */
export const zoomAt = (t: number) => 0.55 + 0.3 * ease(t * STEPS / DOOR_STEP);

/** Centre, turn in XW, YW, ZW, perspective along w. Writes x, y, z into out at o. */
export function project(p: V4, c: V4, angles: number[], zoom: number, out: Float32Array | number[], o = 0) {
  for (let i = 0; i < 4; i++) p[i] -= c[i];
  rot(p, 0, 3, angles[0]);
  rot(p, 1, 3, angles[1]);
  rot(p, 2, 3, angles[2]);
  const s = (D / (D - p[3])) * zoom;
  out[o] = p[0] * s; out[o + 1] = p[1] * s; out[o + 2] = p[2] * s;
}

// ---- inside: rails, hangers and shirts, a set every few steps along w

const RAIL_Y = B * 0.78;
const LAYERS = [0.2, 0.5, 0.8].map((f) => f * L);
const HANGERS_X = [-0.55, 0, 0.55].map((f) => f * A);

/** Line segments of the wardrobe's contents in 4D, pairs of points. */
export const CONTENTS: V4[] = (() => {
  const segs: V4[] = [];
  const line = (pts: [number, number, number][], w: number) => {
    for (let i = 0; i < pts.length - 1; i++) segs.push([...pts[i], w], [...pts[i + 1], w]);
  };
  LAYERS.forEach((w, li) => {
    line([[-A, RAIL_Y, 0], [A, RAIL_Y, 0]], w); // rail, wall to wall
    HANGERS_X.forEach((x, hi) => {
      const y = RAIL_Y;
      // the hook curls over the rail, in the hanger's plane (yz: shoulders run front to back)
      const hook: [number, number, number][] = [];
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * (1.25 - (i / 8) * 1.25);
        hook.push([x, y + 0.07 + Math.sin(a) * 0.07, Math.cos(a) * 0.07]);
      }
      hook.push([x, y - 0.1, 0]);
      line(hook, w);
      const sh = C * 0.8, drop = 0.28;
      line([[x, y - 0.1, 0], [x, y - drop, sh], [x, y - drop, -sh], [x, y - 0.1, 0]], w);
      // a shirt or a long coat, alternating
      const long = (li + hi) % 2 === 1;
      const hem = y - (long ? 2.4 : 1.4);
      line([[x, y - drop, sh], [x, hem, sh * 0.85], [x, hem, -sh * 0.85], [x, y - drop, -sh]], w);
    });
  });
  return segs;
})();

// ---- parts per page

/** Which part each cell is: same size, same letter. */
export const PART: string[] = ['A', 'B', 'B', 'D', 'C', 'E', 'E', 'A'];

/** Pairs of cells that meet on a face at progress t (two cells share one face at most). */
function joints(t: number) {
  const seen = new Map<string, number[]>();
  const p: V4 = [0, 0, 0, 0];
  CELLS.forEach((cell, ci) => FACES.forEach((f) => {
    const m = [0, 0, 0, 0];
    for (const k of f) { corner(cell, k, t, p); for (let i = 0; i < 4; i++) m[i] += p[i] / 4; }
    const key = m.map((x) => (Math.round(x * 1000) / 1000 + 0).toFixed(3)).join(',');
    seen.set(key, [...(seen.get(key) ?? []), ci]);
  }));
  return new Set([...seen.values()].filter((v) => v.length === 2).map((v) => v.join('-')));
}

/** Per step: the cells it brings in and the screws for every joint it closes (four a joint; the door's get none,
 * it has to open). The fold's own hinges are already joints in the flat pack. */
export const STEP_PARTS: { cells: number[]; screws: number }[] = Array.from({ length: STEPS }, (_, s) => {
  const before = joints(s / STEPS), after = joints(Math.min(s + 1, DOOR_STEP) / STEPS);
  const fresh = [...after].filter((j) => !before.has(j) && !j.split('-').map(Number).includes(DOOR));
  const cells = s === 0 ? [0, 1, 2] : CELLS.flatMap((c, ci) => (c.hinges[0]?.step === s && s !== DOOR_STEP ? [ci] : []));
  return { cells, screws: fresh.length * 4 };
});

/** The handle, on the door's front, in the door's net frame: z = C + L lands on the front face, net w = -d sticks
 * it out d in front once folded. */
export const HANDLE: V4[] = (() => {
  const x = -A + 0.28, d = 0.14, h = 0.4, z = C + L;
  const pts: V4[] = [[x, -h, z, 0], [x, -h, z, -d], [x, h, z, -d], [x, h, z, 0]];
  return pts.flatMap((p, i) => (i < pts.length - 1 ? [p, pts[i + 1]] : []));
})();

/** When each cell's door face starts lying on the door's own (from then on only the door draws it, or the two fight):
 * the base from the start, it's the door's hinge in the flat pack, the rest when the step that joins them ends. */
export const DOOR_JOIN_T: number[] = CELLS.map((_, ci) => {
  for (let s = 0; s <= DOOR_STEP; s++) if (joints(s / STEPS).has([ci, DOOR].sort((a, b) => a - b).join('-'))) return s / STEPS;
  return Infinity;
});
