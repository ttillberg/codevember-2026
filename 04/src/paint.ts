// Painting: a brush stroke becomes a road and is cut into the network.
// Where it meets a road it makes a junction; as a bridge it only lands at its two ends.
import { PAINTED, type Spec, type SpecRoad, type V } from './net';

const SNAP = 18; // an end this close to a road joins it
const MERGE = 26; // junctions closer than this become one

const dist = (a: V, b: V) => Math.hypot(b.x - a.x, b.y - a.y);

function simplify(pts: V[], eps: number): V[] {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  const L = dist(a, b) || 1;
  let worst = 0, wi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i].x - a.x) * (b.y - a.y) - (pts[i].y - a.y) * (b.x - a.x)) / L;
    if (d > worst) { worst = d; wi = i; }
  }
  if (worst < eps) return [a, b];
  return [...simplify(pts.slice(0, wi + 1), eps).slice(0, -1), ...simplify(pts.slice(wi), eps)];
}

function nearest(raw: V[], p: V) {
  let best = { d: Infinity, seg: 0, q: raw[0] };
  for (let i = 0; i < raw.length - 1; i++) {
    const a = raw[i], b = raw[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = dist(p, q);
    if (d < best.d) best = { d, seg: i, q };
  }
  return best;
}

/** The road under a point, or -1. */
export function findRoad(spec: Spec, p: V): number {
  let best = -1, bd = Infinity;
  spec.forEach((r, i) => {
    const d = nearest(r.raw, p).d - r.kind.lanes * r.kind.lw;
    if (d < 4 && d < bd) { bd = d; best = i; }
  });
  return best;
}

function length(pts: V[]) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

export function addStroke(spec: Spec, stroke: V[], bridge: boolean): Spec | null {
  const pts = simplify(stroke, 2.5).map((p) => ({ x: p.x, y: p.y }));
  if (length(pts) < (bridge ? 50 : 18)) return null;

  const joints: V[] = [];
  for (const r of spec) joints.push(r.raw[0], r.raw[r.raw.length - 1]);
  const cuts = new Map<number, V[]>();
  const joint = (p: V, ri: number): V => {
    for (const j of joints) if (dist(j, p) < MERGE) return j;
    joints.push(p);
    (cuts.get(ri) ?? cuts.set(ri, []).get(ri)!).push(p);
    return p;
  };

  // where the stroke crosses what is there
  const marks: { i: number; t: number; p: V }[] = [];
  if (!bridge) {
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], p2 = pts[i + 1];
      const rx = p2.x - p.x, ry = p2.y - p.y;
      spec.forEach((road, ri) => {
        if (road.bridge) return;
        for (let j = 0; j < road.raw.length - 1; j++) {
          const q = road.raw[j], q2 = road.raw[j + 1];
          const sx = q2.x - q.x, sy = q2.y - q.y;
          const den = rx * sy - ry * sx;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((q.x - p.x) * sy - (q.y - p.y) * sx) / den;
          const u = ((q.x - p.x) * ry - (q.y - p.y) * rx) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          marks.push({ i, t, p: joint({ x: p.x + rx * t, y: p.y + ry * t }, ri) });
        }
      });
    }
  }
  // the two ends reach for the nearest road
  const ends: (V | null)[] = [null, null];
  for (const e of [0, 1]) {
    const p = e ? pts[pts.length - 1] : pts[0];
    let bd = SNAP, bq: V | null = null, bi = -1;
    spec.forEach((road, ri) => {
      if (road.bridge) return;
      const n = nearest(road.raw, p);
      if (n.d - road.kind.lanes * road.kind.lw < bd) { bd = n.d - road.kind.lanes * road.kind.lw; bq = n.q; bi = ri; }
    });
    if (bq) ends[e] = joint(bq, bi);
  }

  // the stroke as a run of points, some of them junctions
  marks.sort((a, b) => a.i - b.i || a.t - b.t);
  type P = { p: V; j: boolean };
  let run: P[] = [];
  pts.forEach((p, i) => {
    run.push({ p, j: false });
    for (const m of marks) if (m.i === i) run.push({ p: m.p, j: true });
  });
  if (ends[0]) run = [{ p: ends[0], j: true }, ...run.slice(1)];
  if (ends[1]) run = [...run.slice(0, -1), { p: ends[1], j: true }];
  // loose points crowding a junction only make a kink
  run = run.filter((a, i) => a.j || i === 0 || i === run.length - 1 || !run.some((b) => b.j && dist(a.p, b.p) < 10));

  const made: SpecRoad[] = [];
  let piece: V[] = [run[0].p];
  for (let i = 1; i < run.length; i++) {
    piece.push(run[i].p);
    if (run[i].j || i === run.length - 1) {
      const a = piece[0], b = piece[piece.length - 1];
      const loose = !run[i].j || (made.length === 0 && !run[0].j);
      // a stub that goes nowhere is only worth keeping if it is long
      if (dist(a, b) > 1 && length(piece) > (loose ? 30 : 14)) {
        made.push({ raw: piece, kind: PAINTED, stalls: piece.slice(1).map(() => false), bridge });
      }
      piece = [run[i].p];
    }
  }
  if (!made.length) return null;
  if (bridge && (!ends[0] || !ends[1])) return null; // a bridge has to land

  // cut the roads it met
  const out: Spec = [];
  spec.forEach((road, ri) => {
    let pieces: SpecRoad[] = [road];
    for (const c of cuts.get(ri) ?? []) {
      let bp = 0, bn = nearest(pieces[0].raw, c);
      pieces.forEach((pc, k) => {
        const n = nearest(pc.raw, c);
        if (n.d < bn.d) { bn = n; bp = k; }
      });
      const pc = pieces[bp];
      const A: SpecRoad = { ...pc, raw: [...pc.raw.slice(0, bn.seg + 1), c], stalls: pc.stalls.slice(0, bn.seg + 1) };
      const B: SpecRoad = { ...pc, raw: [c, ...pc.raw.slice(bn.seg + 1)], stalls: pc.stalls.slice(bn.seg) };
      pieces.splice(bp, 1, A, B);
    }
    for (const pc of pieces) if (length(pc.raw) > 0.5) out.push(pc);
  });
  return [...out, ...made];
}

// ---------- smearing: push the roads that are there, like wet paint ----------

export const SMEAR_R = 65;

const far = (p: V) => Math.abs(p.x) > 400 || Math.abs(p.y) > 380;

/** Give the roads near p enough points to bend. Parking aisles stay as they are: their stalls need straight rows. */
export function smearStart(spec: Spec, p: V): Spec {
  return spec.map((r) => {
    if (r.stalls.some(Boolean) || nearest(r.raw, p).d > SMEAR_R) return r;
    const raw: V[] = [r.raw[0]];
    for (let i = 1; i < r.raw.length; i++) {
      const a = r.raw[i - 1], b = r.raw[i];
      const n = Math.max(1, Math.ceil(dist(a, b) / 12));
      for (let k = 1; k <= n; k++) raw.push(k === n ? b : { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    return { ...r, raw, stalls: raw.slice(1).map(() => false) };
  });
}

/** Drag everything within reach of `from` towards `to`, less the further away it is. Junctions go along, since roads share their end points. */
export function smear(base: Spec, from: V, to: V): Spec {
  const dx = to.x - from.x, dy = to.y - from.y;
  // what must not move: the lots, and the far ends where traffic comes in
  const pinned = new Set<string>();
  const key = (p: V) => p.x.toFixed(2) + ':' + p.y.toFixed(2);
  for (const r of base) if (r.stalls.some(Boolean)) for (const p of r.raw) pinned.add(key(p));
  return base.map((r) => {
    if (r.stalls.some(Boolean)) return r;
    let moved = false;
    const raw = r.raw.map((p) => {
      const d = dist(p, from);
      if (d >= SMEAR_R || far(p) || pinned.has(key(p))) return p;
      const w = (1 - (d / SMEAR_R) ** 2) ** 2;
      moved = true;
      return { x: p.x + dx * w, y: p.y + dy * w };
    });
    return moved ? { ...r, raw } : r;
  });
}
