// The house as a flat net: panels in sheet coordinates (mm, y up, printed side +z),
// joined by hinges into a tree rooted at the base, plus the glue tabs that close it.

export type V2 = [number, number];
export type Kind = 'base' | 'wall' | 'gable' | 'roof' | 'tab' | 'part';
export type Face = 'front' | 'back' | 'side' | 'roof' | 'base' | 'tab' | 'part';

export interface Panel {
  id: string;
  kind: Kind;
  face: Face;
  poly: V2[]; // counter-clockwise
  parts?: V2[][]; // a concave panel: convex pieces that cover it (for the overlap check)
  parent: string | null;
  hinge: [V2, V2] | null; // the edge shared with the parent
  fold: number; // degrees at rest, + folds the panel behind the printed side
  glue?: string; // tabs: the panel it is glued behind
  origin: V2; // the panel's own corner, for its print
}

// Any net: panels in a tree rooted at the base.
export interface Net {
  panels: Panel[];
}

export interface House extends Net {
  W: number; // street front
  D: number; // depth
  H: number; // eaves height
  R: number; // ridge rise above the eaves
  T: number; // tab depth
  pitch: number; // roof pitch, degrees
  L: number; // roof slope length
  panels: Panel[];
}

// A trapezoid glue tab on the outer side of edge a→b (the right side, since polys are CCW).
// ta, tb: taper angles at a and b, measured from the edge.
export function tab(a: V2, b: V2, depth: number, ta = 45, tb = 45): V2[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ex = dx / len;
  const ey = dy / len;
  const nx = ey;
  const ny = -ex;
  const ca = depth / Math.tan(ta / DEG);
  const cb = depth / Math.tan(tb / DEG);
  return [
    a,
    [a[0] + nx * depth + ex * ca, a[1] + ny * depth + ey * ca],
    [b[0] + nx * depth - ex * cb, b[1] + ny * depth - ey * cb],
    b,
  ];
}

export const rect = (x: number, y: number, w: number, h: number): V2[] => [
  [x, y], [x + w, y], [x + w, y + h], [x, y + h],
];

const gable = (x: number, W: number, H: number, R: number): V2[] => [
  [x, 0], [x + W, 0], [x + W, H], [x + W / 2, H + R], [x, H],
];

// Strip of walls: front | right | back | left, the base under the front,
// both roof slopes stacked on the right wall. One piece, cut once.
export function makeHouse(W = 40, D = 50, H = 72, R = 26, T = 7): House {
  const L = Math.hypot(W / 2, R);
  const pitch = Math.atan2(R, W / 2) * DEG;
  // a gable tab that meets the roof hinge at a corner must not lean over it
  const tight = 90 - pitch - 4;

  const xR = W; // right wall
  const xB = W + D; // back gable
  const xL = 2 * W + D; // left wall
  const xE = 2 * W + 2 * D; // end of the strip

  const panels: Panel[] = [];
  const add = (p: Omit<Panel, 'origin'> & { origin?: V2 }) =>
    panels.push({ origin: p.origin ?? p.poly[0], ...p } as Panel);

  // base: the floor, root of the tree
  add({ id: 'base', kind: 'base', face: 'base', poly: rect(0, -D, W, D), parent: null, hinge: null, fold: 0 });
  add({ id: 'front', kind: 'gable', face: 'front', poly: gable(0, W, H, R), parent: 'base', hinge: [[0, 0], [W, 0]], fold: 90 });
  add({ id: 'right', kind: 'wall', face: 'side', poly: rect(xR, 0, D, H), parent: 'front', hinge: [[xR, 0], [xR, H]], fold: 90 });
  add({ id: 'back', kind: 'gable', face: 'back', poly: gable(xB, W, H, R), parent: 'right', hinge: [[xB, 0], [xB, H]], fold: 90 });
  add({ id: 'left', kind: 'wall', face: 'side', poly: rect(xL, 0, D, H), parent: 'back', hinge: [[xL, 0], [xL, H]], fold: 90 });
  add({ id: 'roof1', kind: 'roof', face: 'roof', poly: rect(xR, H, D, L), parent: 'right', hinge: [[xR, H], [xR + D, H]], fold: 90 - pitch });
  add({ id: 'roof2', kind: 'roof', face: 'roof', poly: rect(xR, H + L, D, L), parent: 'roof1', hinge: [[xR, H + L], [xR + D, H + L]], fold: 2 * pitch });

  // tabs: base edges glue behind the walls they meet
  add({ id: 'tab-base-left', kind: 'tab', face: 'tab', poly: tab([0, 0], [0, -D], T), parent: 'base', hinge: [[0, 0], [0, -D]], fold: 90, glue: 'left' });
  add({ id: 'tab-base-back', kind: 'tab', face: 'tab', poly: tab([0, -D], [W, -D], T), parent: 'base', hinge: [[0, -D], [W, -D]], fold: 90, glue: 'back' });
  add({ id: 'tab-base-right', kind: 'tab', face: 'tab', poly: tab([W, -D], [W, 0], T), parent: 'base', hinge: [[W, -D], [W, 0]], fold: 90, glue: 'right' });
  // the seam: left wall closes onto the front
  add({ id: 'tab-seam', kind: 'tab', face: 'tab', poly: tab([xE, 0], [xE, H], T), parent: 'left', hinge: [[xE, 0], [xE, H]], fold: 90, glue: 'front' });
  // the free eave: left wall top carries the second roof slope
  add({ id: 'tab-eave', kind: 'tab', face: 'tab', poly: tab([xE, H], [xL, H], T), parent: 'left', hinge: [[xE, H], [xL, H]], fold: 90 - pitch, glue: 'roof2' });
  // gable slopes hold the roof from under
  const slopes: [string, V2, V2, number, number, string][] = [
    ['front', [W, H], [W / 2, H + R], tight, 45, 'roof1'],
    ['front', [W / 2, H + R], [0, H], 45, 45, 'roof2'],
    ['back', [xB + W, H], [xB + W / 2, H + R], tight, 45, 'roof2'],
    ['back', [xB + W / 2, H + R], [xB, H], 45, tight, 'roof1'],
  ];
  slopes.forEach(([parent, a, b, ta, tb, glue], i) =>
    add({ id: `tab-${parent}-${i % 2 ? 'l' : 'r'}`, kind: 'tab', face: 'tab', poly: tab(a, b, T * 0.85, ta, tb), parent, hinge: [a, b], fold: 90, glue }),
  );

  return { W, D, H, R, T, pitch, L, panels };
}

export function bounds(polys: V2[][]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

const sameEdge = (a: V2, b: V2, c: V2, d: V2, e = 1e-6) =>
  (Math.hypot(a[0] - c[0], a[1] - c[1]) < e && Math.hypot(b[0] - d[0], b[1] - d[1]) < e) ||
  (Math.hypot(a[0] - d[0], a[1] - d[1]) < e && Math.hypot(b[0] - c[0], b[1] - c[1]) < e);

// Is edge a→b of a panel a fold (a hinge to its parent or a child) or a cut?
export function isFold(house: Net, panel: Panel, a: V2, b: V2) {
  if (panel.hinge && sameEdge(a, b, ...panel.hinge)) return true;
  return house.panels.some((c) => c.parent === panel.id && c.hinge && sameEdge(a, b, ...c.hinge));
}

// Pieces of a sheet must not overlap: separating axis test on the convex panels.
export function overlaps(house: Net, eps = 1e-3): [string, string][] {
  const out: [string, string][] = [];
  const ps = house.panels;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const A = ps[i].parts ?? [ps[i].poly];
    const B = ps[j].parts ?? [ps[j].poly];
    if (A.some((a) => B.some((b) => !separated(a, b, eps)))) out.push([ps[i].id, ps[j].id]);
  }
  return out;
}

function separated(A: V2[], B: V2[], eps: number) {
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const a = P[i];
    const b = P[(i + 1) % P.length];
    const nx = b[1] - a[1];
    const ny = a[0] - b[0];
    const len = Math.hypot(nx, ny);
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const [x, y] of A) { const d = (x * nx + y * ny) / len; amin = Math.min(amin, d); amax = Math.max(amax, d); }
    for (const [x, y] of B) { const d = (x * nx + y * ny) / len; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
    if (amax <= bmin + eps || bmax <= amin + eps) return true;
  }
  return false;
}

// The cut line: every edge that is not a fold, chained into one counter-clockwise loop.
export function outline(house: Net): V2[] {
  const edges: [V2, V2][] = [];
  for (const p of house.panels) for (let i = 0; i < p.poly.length; i++) {
    const a = p.poly[i];
    const b = p.poly[(i + 1) % p.poly.length];
    if (!isFold(house, p, a, b)) edges.push([a, b]);
  }
  const near = (u: V2, v: V2) => Math.hypot(u[0] - v[0], u[1] - v[1]) < 1e-6;
  const loop: V2[] = [edges[0][0]];
  let end = edges[0][1];
  const left = edges.slice(1);
  while (left.length) {
    const i = left.findIndex((e) => near(e[0], end));
    if (i < 0) throw new Error('outline does not close');
    loop.push(end);
    end = left[i][1];
    left.splice(i, 1);
  }
  // drop points in the middle of a straight run
  return loop.filter((p, i) => {
    const a = loop[(i + loop.length - 1) % loop.length];
    const b = loop[(i + 1) % loop.length];
    const cross = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
    const dot = (p[0] - a[0]) * (b[0] - p[0]) + (p[1] - a[1]) * (b[1] - p[1]);
    return Math.abs(cross) > 1e-6 || dot < 0;
  });
}

// The sheet of card the net is printed on.
export function sheetOf(house: Net, margin = 8) {
  const b = bounds(house.panels.map((p) => p.poly));
  return { x: b.x0 - margin, y: b.y0 - margin, w: b.w + 2 * margin, h: b.h + 2 * margin };
}
export type Sheet = ReturnType<typeof sheetOf>;

// shared by the nets
export const DEG = 180 / Math.PI;
export const ccw = (poly: V2[]): V2[] => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a < 0 ? [...poly].reverse() : poly;
};
