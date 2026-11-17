import { line, poly, r, tabArt } from '../art';
import { Matrix4, Vector3 } from 'three';
import { foldMatrices } from '../fold';
import { DEG, ccw, tab, type Net, type Panel, type V2 } from '../net';
import type { Model } from './model';

// Turning Torso: a square tower turning a quarter turn on its way up. A twisted wall isn't flat,
// so each side is a column of triangles, two to a band, unfolded from the 3D tower: the base in
// the middle of the sheet, a column of triangles out from each of its edges, the roof off the end
// of the first column. Every fold is the bend between its two triangles; the sign is whichever
// lands the new corner where the tower has it. Floors are printed as bands cut at true heights,
// so they run on across the triangles.

const S = 26; // the square's side
const B = 5; // bands
const BH = 40; // each band's height
const TWIST = 90; // degrees, foot to top

type P3 = [number, number, number];
const sub3 = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a: P3) => Math.hypot(a[0], a[1], a[2]);
const dist3 = (a: P3, b: P3) => len3(sub3(a, b));
const dist2 = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// the corner j of the square at band level b, turned as it rises
function corner(b: number, j: number): P3 {
  const t = (TWIST * b) / B / DEG + Math.PI / 4 + (j * Math.PI) / 2;
  const rr = S / Math.SQRT2;
  return [rr * Math.cos(t), rr * Math.sin(t), b * BH];
}

// a triangle's outward normal: away from the tower's axis (or down, for the base)
function outward(a: P3, b: P3, c: P3): P3 {
  let n = cross(sub3(b, a), sub3(c, a));
  const m: P3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, 0];
  if (dot(n, m) < 0) n = [-n[0], -n[1], -n[2]];
  const l = len3(n);
  return [n[0] / l, n[1] / l, n[2] / l];
}
const bend = (n1: P3, n2: P3) => Math.acos(Math.max(-1, Math.min(1, dot(n1, n2)))) * DEG;

// the third corner of a triangle on edge p→q, at distances dp and dq, on the side away from `away`
function apex(p: V2, q: V2, dp: number, dq: number, away: V2): V2 {
  const d = dist2(p, q);
  const a = (dp * dp - dq * dq + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, dp * dp - a * a));
  const ex: V2 = [(q[0] - p[0]) / d, (q[1] - p[1]) / d];
  const base: V2 = [p[0] + ex[0] * a, p[1] + ex[1] * a];
  const ny: V2 = [-ex[1], ex[0]];
  const side = (away[0] - p[0]) * ny[0] + (away[1] - p[1]) * ny[1];
  const s = side > 0 ? -1 : 1;
  return [base[0] + ny[0] * h * s, base[1] + ny[1] * h * s];
}

// what each triangle is in 3D, for the print
export const solid = new Map<string, { p2: V2[]; p3: P3[] }>();

export function makeTorso(): Net {
  const panels: Panel[] = [];
  const add = (p: Omit<Panel, 'origin'>) => panels.push({ origin: p.poly[0], ...p });
  const put = (id: string, p2: V2[], p3: P3[]) => solid.set(id, { p2, p3 });

  // the foot, as it is on the ground
  const foot: V2[] = [0, 1, 2, 3].map((j) => [corner(0, j)[0], corner(0, j)[1]]);
  add({ id: 'base', kind: 'base', face: 'base', poly: foot, parent: null, hinge: null, fold: 0 });
  put('base', foot, [0, 1, 2, 3].map((j) => corner(0, j)));
  const down: P3 = [0, 0, -1];

  // each column: up the side from edge j..j+1 of the foot. Sheet and tower points kept together.
  const tops: Record<number, { a: V2; b: V2; n: P3; id: string }> = {};
  const lefts: { id: string; a: V2; b: V2; glue: string; n: P3; next: P3 }[] = [];
  for (let j = 0; j < 4; j++) {
    const j1 = (j + 1) % 4;
    // the edge in the sheet and in the tower
    let e2: [V2, V2] = [foot[j], foot[j1]];
    let e3: [P3, P3] = [corner(0, j), corner(0, j1)];
    let behind: V2 = [0, 0]; // the parent's other corner, to unfold away from
    let parent = 'base';
    let nParent = down;
    for (let b = 0; b < B; b++) {
      // T1: the foot's edge and the corner above j
      const u = corner(b + 1, j);
      const t1c = apex(e2[0], e2[1], dist3(e3[0], u), dist3(e3[1], u), behind);
      const id1 = `c${j}-${b}a`;
      const p1 = [e2[0], e2[1], t1c];
      const n1 = outward(e3[0], e3[1], u);
      add({ id: id1, kind: 'wall', face: 'side', poly: ccw(p1), parent, hinge: e2, fold: bend(nParent, n1) });
      put(id1, p1, [e3[0], e3[1], u]);
      // its left edge, up from corner j, takes the tab onto the column before
      lefts.push({ id: id1, a: e2[0], b: t1c, glue: `c${(j + 3) % 4}-${b}b`, n: n1, next: outward(corner(b, j), corner(b + 1, j), corner(b + 1, (j + 3) % 4)) });
      // T2: on the diagonal, the corner above j+1
      const v = corner(b + 1, j1);
      const t2c = apex(e2[1], t1c, dist3(e3[1], v), dist3(u, v), e2[0]);
      const id2 = `c${j}-${b}b`;
      const p2 = [e2[1], t2c, t1c];
      const n2 = outward(e3[1], v, u);
      add({ id: id2, kind: 'wall', face: 'side', poly: ccw(p2), parent: id1, hinge: [e2[1], t1c], fold: bend(n1, n2) });
      put(id2, p2, [e3[1], v, u]);
      // on up: the next band stands on T2's top edge
      behind = e2[1];
      e2 = [t1c, t2c];
      e3 = [u, v];
      parent = id2;
      nParent = n2;
      if (b === B - 1) tops[j] = { a: t1c, b: t2c, n: n2, id: id2 };
    }
  }
  for (const l of lefts) {
    add({ id: `tab-${l.id}`, kind: 'tab', face: 'tab', poly: tab(...orient(l.a, l.b, panels.find((p) => p.id === l.id)!.poly), 3.5, 24, 24), parent: l.id, hinge: [l.a, l.b], fold: bend(l.n, l.next), glue: l.glue });
  }

  // the roof: a square off the top of column 0, tabs from its other edges onto columns 1..3
  const up: P3 = [0, 0, 1];
  const t0 = tops[0];
  const top3 = [0, 1, 2, 3].map((j) => corner(B, j));
  // the roof's corners in the sheet: unfold the top square across column 0's top edge
  const c2 = apex(t0.a, t0.b, dist3(top3[0], top3[2]), dist3(top3[1], top3[2]), panels.find((p) => p.id === t0.id)!.poly.find((q) => q !== t0.a && q !== t0.b)!);
  const c3 = apex(t0.a, c2, dist3(top3[0], top3[3]), dist3(top3[2], top3[3]), t0.b);
  const roof = ccw([t0.a, t0.b, c2, c3]);
  add({ id: 'roof', kind: 'roof', face: 'roof', poly: roof, parent: t0.id, hinge: [t0.a, t0.b], fold: bend(t0.n, up) });
  put('roof', [t0.a, t0.b, c2, c3], [top3[0], top3[1], top3[2], top3[3]]);
  const sq: V2[] = [t0.a, t0.b, c2, c3];
  for (let j = 1; j < 4; j++) {
    const a = sq[j], b = sq[(j + 1) % 4];
    add({ id: `tab-roof-${j}`, kind: 'tab', face: 'tab', poly: tab(...orient(a, b, roof), 3.5, 40, 40), parent: 'roof', hinge: [a, b], fold: bend(up, tops[j].n), glue: tops[j].id });
  }
  pickSigns({ panels });
  return { panels };
}

// Each fold's sign: in fold space the foot stays put and the tower stands to -z, so a corner at
// (x, y, z) belongs at (x, y, -z). Parents first, each fold the way that puts its corners there;
// a tab the way that lays it flattest on the panel it glues to.
function pickSigns(net: Net) {
  const byId = new Map(net.panels.map((p) => [p.id, p]));
  const err = (p: Panel) => {
    const m = foldMatrices(net);
    const s = solid.get(p.id);
    if (s) return s.p2.reduce((e, q, i) => e + new Vector3(q[0], q[1], 0).applyMatrix4(m.get(p.id)!).distanceTo(new Vector3(s.p3[i][0], s.p3[i][1], -s.p3[i][2])), 0);
    const inv = new Matrix4().copy(m.get(p.glue!)!).invert();
    return p.poly.reduce((e, q) => e + Math.abs(new Vector3(q[0], q[1], 0).applyMatrix4(m.get(p.id)!).applyMatrix4(inv).z), 0);
  };
  for (const p of net.panels) {
    if (!p.parent) continue;
    const a = err(p);
    p.fold = -p.fold;
    if (err(p) >= a) p.fold = -p.fold;
    void byId;
  }
}

// edge a-b of a panel, ordered so tab() puts the tab outside it
function orient(a: V2, b: V2, polyOf: V2[]): [V2, V2] {
  const cx = polyOf.reduce((s, q) => s + q[0], 0) / polyOf.length;
  const cy = polyOf.reduce((s, q) => s + q[1], 0) / polyOf.length;
  const left = (b[0] - a[0]) * (cy - a[1]) - (b[1] - a[1]) * (cx - a[0]) > 0;
  return left ? [a, b] : [b, a];
}

// --- print: white slabs and dark glass, cut at the floors' real heights ---
const FLOOR = 4; // mm a floor
const GLASS = '#5d7480';
const SLAB = '#eef0ef';

// the part of a triangle between heights z0 and z1, in the sheet
function slab(p2: V2[], p3: P3[], z0: number, z1: number): V2[] {
  let pts = p2.map((q, i) => ({ q, z: p3[i][2] }));
  for (const [lim, keepAbove] of [[z0, true], [z1, false]] as const) {
    const out: typeof pts = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ina = keepAbove ? a.z >= lim : a.z <= lim;
      const inb = keepAbove ? b.z >= lim : b.z <= lim;
      if (ina) out.push(a);
      if (ina !== inb) {
        const t = (lim - a.z) / (b.z - a.z);
        out.push({ q: [a.q[0] + (b.q[0] - a.q[0]) * t, a.q[1] + (b.q[1] - a.q[1]) * t], z: lim });
      }
    }
    pts = out;
    if (!pts.length) return [];
  }
  return pts.map((p) => p.q);
}

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  const s = solid.get(p.id);
  if (!s) return '';
  const xs = p.poly.map((q) => q[0]), ys = p.poly.map((q) => q[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  if (p.id === 'base') return r(x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0, '#c9c6bf');
  if (p.id === 'roof') return r(x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0, '#d9dbd9') + poly(s.p2.map((q) => [x0 + (q[0] - x0) * 0.5 + 6, y0 + (q[1] - y0) * 0.5 + 6] as V2), '#b9bdbb');
  let out = poly(p.poly, SLAB);
  for (let z = 0; z < B * BH; z += FLOOR) {
    const g = slab(s.p2, s.p3, z + 1.2, z + FLOOR);
    if (g.length >= 3) out += poly(g, GLASS);
  }
  // the steel spine up the first column's edge
  if (p.id.startsWith('c0-') && p.id.endsWith('a')) out += line(s.p2[0][0], s.p2[0][1], s.p2[2][0], s.p2[2][1], '#9aa2a6', 1.6);
  return out;
}

export const torso: Model = { id: 'torso', name: 'Turning Torso', where: 'Västra Hamnen', net: makeTorso(), art };
