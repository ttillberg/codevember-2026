// The place without an end: the strokes of any tile of an endless grid, made from a seed.
// A tile is as big as the hand-drawn map and laid out the same way: 1200 m square, centred on 0, 0, x east, y south.
// Tile (i, j) is column i, counted east, and row j, counted south: (0, -1) is the tile north of the hand-drawn one.
// With the default camera (it stands east-south-east of what it looks at) north is to the right on the screen
// and a little up, and west is away from the drone.
//
// Three things make the tiles fit together and come through the rules whole:
// - the big roads are a grid: every tile has the arterial along y = 0 and the cross street along x = 0, edge to edge;
// - whatever else crosses a border does so at a point that is a function of that border and the seed, never of one
//   tile alone, so the two tiles either side always agree on where it is, how big, and whether it is there at all;
// - everything smaller is grown inside the tile and kept well clear of every other stroke, further than the rules'
//   own ROOM, except where it joins one, squarely. So no two roads merge that were not meant to.
import { baseIntent, nearest, type Intent, type Stroke } from './intent';
import { TILE, cumLen, forgetFar, place, pointOn, rng, tilesNow, type V } from './net';

export { TILE };
/** The seed of the whole world. Another seed is another world; the grid of big roads is the same in all of them. */
export const WORLD = 2026;
/** How much of a tile is asked for: 0 the grid of big roads, 1 the streets too, 2 everything. */
export type Detail = 0 | 1 | 2;
/** What a tile is like. It decides how much is built in it. */
export type TileKind = 'plain' | 'dense' | 'woods' | 'hand';

const H = TILE / 2;
// a small road keeps this far from every other stroke: the rules' ROOM is 44, and whatever walks nearer a node than that takes it
const CLEAR = 50;
// two junctions on one road are at least this far apart, and further on the arterial
const APART = 58, APART_BIG = 90;
// how big a roundabout is drawn
const RING = 36;
// nothing small comes nearer the border than this, so two tiles never crowd each other across it
const INSIDE = H - 40;

/** A decent integer hash of a few integers. */
function hash(...v: number[]) {
  let h = 0x9e3779b9;
  for (const n of v) {
    h = Math.imul(h ^ (n | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** Where a street crosses a border, and whether there is one. */
export interface Gate { at: number; on: boolean }

/**
 * The border between tile (i, j) and (i + 1, j): where the two back streets cross it, as y.
 * The hand-drawn tile is not made by these numbers, so its two borders are written down here as it has them.
 */
export function gatesEast(i: number, j: number, seed = WORLD): { n: Gate; s: Gate } {
  if (j === 0 && i === 0) return { n: { at: -245, on: true }, s: { at: 265, on: true } };
  if (j === 0 && i === -1) return { n: { at: -240, on: true }, s: { at: 260, on: true } };
  const r = rng(hash(seed, 1, i, j));
  return { n: { at: Math.round(-240 + (r() * 2 - 1) * 45), on: r() < 0.8 }, s: { at: Math.round(260 + (r() * 2 - 1) * 45), on: r() < 0.8 } };
}

/**
 * The border between tile (i, j) and (i, j + 1), the one south of it: where the two side streets cross it, as x.
 * No side street leaves the hand-drawn tile, north or south.
 */
export function gatesSouth(i: number, j: number, seed = WORLD): { w: Gate; e: Gate } {
  if (i === 0 && (j === 0 || j === -1)) return { w: { at: -300, on: false }, e: { at: 300, on: false } };
  const r = rng(hash(seed, 2, i, j));
  return { w: { at: Math.round(-300 + (r() * 2 - 1) * 50), on: r() < 0.55 }, e: { at: Math.round(300 + (r() * 2 - 1) * 50), on: r() < 0.55 } };
}

/** What kind of tile this is. */
export function tileKind(i: number, j: number, seed = WORLD): TileKind {
  if (i === 0 && j === 0) return 'hand';
  const u = rng(hash(seed, 3, i, j))();
  return u < 0.16 ? 'woods' : u < 0.4 ? 'dense' : 'plain';
}

interface Made { strokes: Stroke[]; upTo: [number, number, number] }

const P = (...c: number[]): V[] => {
  const pts: V[] = [];
  for (let i = 0; i < c.length; i += 2) pts.push({ x: c[i], y: c[i + 1] });
  return pts;
};

/** Every stroke of a tile, the big ones first, and how many of them each level of detail takes. */
function make(i: number, j: number, seed: number): Made {
  if (i === 0 && j === 0) {
    // the hand-drawn map: the arterial and the cross street, then the back streets and the two lanes that tie them, then the rest
    return { strokes: baseIntent(), upTo: [2, 6, Infinity] };
  }
  const kind = tileKind(i, j, seed);
  const strokes: Stroke[] = [];
  // every stretch of every stroke, flat: ax, ay, bx, by, and the stroke it belongs to
  const segs: number[] = [];
  // the places where roads meet: nothing new joins a road near one
  const pins: V[] = [];
  const lay = (s: Stroke, ...at: V[]) => {
    const k = strokes.push(s) - 1;
    for (let n = 1; n < s.pts.length; n++) segs.push(s.pts[n - 1].x, s.pts[n - 1].y, s.pts[n].x, s.pts[n].y, k);
    pins.push(...at);
    return k;
  };

  /** One stroke may come nearer than CLEAR: the one it joins at p, squarely, or the one it is built along, at `flat`. */
  interface Near { s: number; p?: V; flat?: number }
  /** Is the line from a to b clear of every stroke there is, but for those it has leave to be near? */
  const clear = (a: V, b: V, near: Near[]) => {
    const x0 = Math.min(a.x, b.x) - CLEAR, x1 = Math.max(a.x, b.x) + CLEAR, y0 = Math.min(a.y, b.y) - CLEAR, y1 = Math.max(a.y, b.y) + CLEAR;
    const L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(L / 10));
    for (let q = 0; q < segs.length; q += 5) {
      const ax = segs[q], ay = segs[q + 1], bx = segs[q + 2], by = segs[q + 3];
      if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) continue;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      let ex: Near | undefined;
      for (const e of near) if (e.s === segs[q + 4]) ex = e;
      for (let k = 0; k <= n; k++) {
        const px = a.x + ((b.x - a.x) * k) / n, py = a.y + ((b.y - a.y) * k) / n;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
        const d = Math.hypot(px - ax - dx * t, py - ay - dy * t);
        const need = !ex ? CLEAR : ex.flat ?? Math.min(CLEAR, 0.85 * Math.hypot(px - ex.p!.x, py - ex.p!.y));
        if (d < need - 1e-6) return false;
      }
    }
    return true;
  };
  /** Is there room for one more junction here, on this stroke? */
  const room = (p: V, s: number) => {
    const m = s === 0 ? APART_BIG : APART;
    for (const q of pins) if (Math.hypot(q.x - p.x, q.y - p.y) < m) return false;
    return true;
  };
  /** The point of any road nearest p. Parking lots are not for joining. */
  const nearestRoad = (p: V) => {
    let best = { d: Infinity, q: p, s: -1 };
    for (let q = 0; q < segs.length; q += 5) {
      const st = strokes[segs[q + 4]];
      if (st.lot || st.ring) continue;
      const ax = segs[q], ay = segs[q + 1], dx = segs[q + 2] - ax, dy = segs[q + 3] - ay, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2));
      const x = ax + dx * t, y = ay + dy * t, d = Math.hypot(p.x - x, p.y - y);
      if (d < best.d) best = { d, q: { x, y }, s: segs[q + 4] };
    }
    return best;
  };
  /** The first road a ray from p along (ux, uy) meets. */
  const ahead = (p: V, ux: number, uy: number) => {
    let best: { t: number; q: V; s: number } | null = null;
    for (let q = 0; q < segs.length; q += 5) {
      const st = strokes[segs[q + 4]];
      if (st.lot || st.ring) continue;
      const ax = segs[q], ay = segs[q + 1], dx = segs[q + 2] - ax, dy = segs[q + 3] - ay;
      const den = ux * dy - uy * dx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - p.x) * dy - (ay - p.y) * dx) / den, u = ((ax - p.x) * uy - (ay - p.y) * ux) / den;
      if (t <= 0 || u < 0 || u > 1 || (best && t >= best.t)) continue;
      best = { t, q: { x: p.x + ux * t, y: p.y + uy * t }, s: segs[q + 4] };
    }
    return best;
  };
  /**
   * Does something going (ux, uy) at q meet stroke s squarely there? Measured against the road a node's length either
   * way, not only where it touches: a lane that leans along the road it joins is walked onto that road's next node.
   */
  const square = (s: number, q: V, ux: number, uy: number) => {
    const pts = strokes[s].pts, cum = cumLen(pts), at = nearest(pts, q).s;
    for (const d of [-45, 45]) {
      const o = pointOn(pts, cum, at + d), L = Math.hypot(o.x - q.x, o.y - q.y);
      if (L > 1 && Math.abs(((o.x - q.x) * ux + (o.y - q.y) * uy) / L) > 0.4) return false;
    }
    return true;
  };
  const inside = (p: V) => Math.abs(p.x) <= INSIDE && Math.abs(p.y) <= INSIDE;
  // a road may only stop in the open where the rules will not take its end for a way in: see far() in net.ts
  const mayEnd = (p: V) => Math.hypot(p.x - 10, p.y + 10) < 385;

  // ---------- 0: the grid ----------
  // the arterial and the cross street, where the hand-drawn map has them, in every tile
  lay({ pts: P(-H, 0, H, 0), w: 3 });
  lay({ pts: P(0, -H, 0, H), w: 2 }, { x: 0, y: 0 });
  const grid = strokes.length;

  // ---------- 1: the streets ----------
  // Two back streets, north and south of the arterial, and two side streets, west and east of the cross street, as the
  // hand-drawn map has them. Where they cross a border the border says where, and whether; in between the tile does.
  const r1 = rng(hash(seed, 4, i, j));
  const jit = (m: number) => (r1() * 2 - 1) * m;
  const west = gatesEast(i - 1, j, seed), east = gatesEast(i, j, seed), north = gatesSouth(i, j - 1, seed), south = gatesSouth(i, j, seed);
  // the lattice the streets hang on: two columns, two rows, and the grid
  const cx = [-300 + jit(42), 300 + jit(42)];
  const rowY = [
    [west.n.at, -215 + jit(28), -205 + jit(28), -215 + jit(28), east.n.at],
    [west.s.at, 240 + jit(28), 235 + jit(28), 240 + jit(28), east.s.at],
  ];
  const rowX = [-H, cx[0], 0, cx[1], H];
  // each street is four stretches; the outer ones are there if the border says so
  const rows = [[west.n.on, true, true, east.n.on], [west.s.on, true, true, east.s.on]];
  const cols = [[north.w.on, true, true, south.w.on], [north.e.on, true, true, south.e.on]];
  if (kind === 'woods') {
    // in the woods a street that comes in only goes as far as the next big road
    for (const s of rows) { s[1] = s[0]; s[2] = s[3]; }
    for (const s of cols) { s[1] = s[0]; s[2] = s[3]; }
  } else if (r1() < 0.3) {
    // now and then one stretch between two junctions was never built
    const k = (r1() * 8) | 0;
    (k < 4 ? rows : cols)[k & 1][1 + ((k >> 1) & 1)] = false;
  }
  // a street does not stop alone at a corner of the lattice: the one that would have met it there is built after all
  for (const n of [0, 1]) for (const c of [0, 1]) {
    const row = rows[n], col = cols[c], ro = c ? 3 : 0, ri = c ? 2 : 1, co = n ? 3 : 0, ci = n ? 2 : 1;
    if (Number(row[ro]) + Number(row[ri]) + Number(col[co]) + Number(col[ci]) !== 1) continue;
    if (row[ro] || row[ri]) col[ci] = true;
    else row[ri] = true;
  }
  // Now and then there is a roundabout where a back street meets a side street, drawn as a ring. Both streets stop at
  // the ring, either side, so that no junction is left in the middle of it. It is never laid over the big roads: they
  // are there before it, at the level below, and would go on straight through it.
  let ring = kind !== 'woods' && r1() < 0.2 ? (r1() * 4) | 0 : -1;
  const ringRow = ring >> 1, ringCol = ring & 1;
  if (ring >= 0 && Number(rows[ringRow][ringCol ? 3 : 0]) + Number(rows[ringRow][ringCol ? 2 : 1]) + Number(cols[ringCol][ringRow ? 3 : 0]) + Number(cols[ringCol][ringRow ? 2 : 1]) < 3) ring = -1;
  /** The same stretches, stopping short of the ring before stretch b and starting again after it. */
  const broken = (on: boolean[], pts: V[][], w: number, b: number, axis: 'x' | 'y') => {
    const end = pts[b - 1][pts[b - 1].length - 1];
    pts[b - 1][pts[b - 1].length - 1] = { ...end, [axis]: end[axis] - RING };
    pts[b][0] = { ...end, [axis]: end[axis] + RING };
    runs(on.map((o, k) => o && k < b), pts, w);
    runs(on.map((o, k) => o && k >= b), pts, w);
  };
  /** One stroke for each run of stretches that are there. */
  const runs = (on: boolean[], pts: V[][], w: number) => {
    for (let a = 0; a < 4; a++) {
      if (!on[a]) continue;
      let b = a;
      while (b < 3 && on[b + 1]) b++;
      const line: V[] = [];
      for (let k = a; k <= b; k++) line.push(...(k === a ? pts[k] : pts[k].slice(1)));
      lay({ pts: line, w });
      a = b;
    }
  };
  rows.forEach((on, n) => {
    const y = rowY[n];
    const pts = [0, 1, 2, 3].map((k) => P(rowX[k], y[k], rowX[k + 1], y[k + 1]));
    if (ring >= 0 && n === ringRow) broken(on, pts, 2, ringCol ? 3 : 1, 'x');
    else runs(on, pts, 2);
    // where it meets the cross street and the side streets, there or not: nothing else should come out just there
    for (const k of [1, 2, 3]) pins.push({ x: rowX[k], y: y[k] });
  });
  cols.forEach((on, n) => {
    const x = cx[n], lean = jit(55), gates = [n ? north.e.at : north.w.at, n ? south.e.at : south.w.at];
    const yn = rowY[0][n ? 3 : 1], ys = rowY[1][n ? 3 : 1];
    const pts = [
      P(gates[0], -H, (gates[0] + x) / 2 + jit(24), (yn - H) / 2, x, yn),
      P(x, yn, x + lean, 0),
      P(x + lean, 0, x, ys),
      P(x, ys, (gates[1] + x) / 2 + jit(24), (ys + H) / 2, gates[1], H),
    ];
    if (ring >= 0 && n === ringCol) broken(on, pts, 1, ringRow ? 3 : 1, 'y');
    else runs(on, pts, 1);
    pins.push({ x: x + lean, y: 0 });
  });
  // An avenue now and then: it leaves the arterial, cuts the corner at a slant and comes out on the cross street.
  if (kind !== 'woods' && r1() < 0.22) {
    for (let n = 0; n < 6; n++) {
      const sx = r1() < 0.5 ? -1 : 1, sy = r1() < 0.5 ? -1 : 1, a = 130 + r1() * 75, c = 95 + r1() * 30;
      const pts = P(sx * a, 0, sx * a, sy * 54, sx * 56, sy * c, 0, sy * c);
      const near: Near[] = [{ s: 0, p: pts[0] }, { s: 1, p: pts[3] }];
      if (!room(pts[0], 0) || !room(pts[3], 1) || !pts.every((p, k) => k === 0 || clear(pts[k - 1], p, near))) continue;
      lay({ pts, w: 2 }, ...pts);
      break;
    }
  }
  if (ring >= 0) {
    const c = { x: cx[ringCol], y: rowY[ringRow][ringCol ? 3 : 1] }, pts: V[] = [];
    for (let k = 0; k < 28; k++) pts.push({ x: c.x + RING * Math.cos(((k + 3.5) / 28) * 2 * Math.PI), y: c.y + RING * Math.sin(((k + 3.5) / 28) * 2 * Math.PI) });
    pts.push({ ...pts[0] });
    lay({ pts, w: 2, ring: true });
  }
  const streets = strokes.length;

  // ---------- 2: what is inside the blocks ----------
  const r2 = rng(hash(seed, 5, i, j));
  // Parking lots, as the hand-drawn one: a stroke snaking through its aisles beside the arterial or the cross street,
  // a driveway in from that road, and one out of its far end, straight on to the first road it finds.
  const lots = kind === 'woods' ? (r2() < 0.25 ? 1 : 0) : kind === 'dense' ? 1 + (r2() < 0.6 ? 1 : 0) : r2() < 0.75 ? 1 : 0;
  for (let made = 0, n = 0; made < lots && n < 14; n++) {
    const host = r2() < 0.65 ? 0 : 1;
    const along = (r2() < 0.5 ? -1 : 1) * (110 + r2() * 330), ud = r2() < 0.5 ? -1 : 1, vs = r2() < 0.5 ? -1 : 1;
    const aisles = r2() < 0.6 ? 3 : 5, depth = 52 + r2() * 26, front = 28;
    const at = (a: number, b: number): V => (host === 0 ? { x: along + ud * a, y: vs * b } : { x: vs * b, y: along + ud * a });
    const pts: V[] = [];
    for (let k = 0; k < aisles; k++) pts.push(at(k * 17.5, k % 2 ? front + depth : front), at(k * 17.5, k % 2 ? front : front + depth));
    const door = at(0, 0), end = pts[pts.length - 1];
    const out = ahead(end, host === 0 ? ud : 0, host === 0 ? 0 : ud);
    if (!out || out.t < 45 || out.t > 300 || out.s === host || !square(out.s, out.q, host === 0 ? ud : 0, host === 0 ? 0 : ud)) continue;
    if (!room(door, host) || !room(out.q, out.s) || !inside(end) || !inside(out.q)) continue;
    // the lot keeps clear of everything but its own road, and so does its way out, but for the road it comes out on
    if (!pts.every((p, k) => k === 0 || clear(pts[k - 1], p, [{ s: host, flat: front - 2 }]))) continue;
    if (!clear(end, out.q, [{ s: out.s, p: out.q }])) continue;
    lay({ pts, w: 0, lot: true });
    lay({ pts: [door, pts[0]], w: 1 }, door);
    lay({ pts: [end, out.q], w: 1 }, out.q);
    made++;
  }
  // A cut-through round a corner of the big junction, where a gas station would be.
  if (kind !== 'woods' && r2() < 0.4) {
    const sx = r2() < 0.5 ? -1 : 1, sy = r2() < 0.5 ? -1 : 1, a = 75 + r2() * 35, c = 62 + r2() * 22;
    const pts = P(sx * a, 0, sx * a, sy * c, 0, sy * c);
    const near: Near[] = [{ s: 0, p: pts[0] }, { s: 1, p: pts[2] }];
    if (room(pts[0], 1) && room(pts[2], 1) && clear(pts[0], pts[1], near) && clear(pts[1], pts[2], near)) lay({ pts, w: 1 }, ...pts);
  }

  // Lanes, after Xinpaifang: each grows out of a road that is there, squarely, and winds on a few steps at a time.
  // When it comes up against another road it joins it, squarely again; or it stops at somebody's door.
  // The next one may grow out of it. All of them keep clear of everything they do not join.
  const want = kind === 'woods' ? 2 + ((r2() * 4) | 0) : kind === 'dense' ? 30 + ((r2() * 10) | 0) : 16 + ((r2() * 7) | 0);
  const reach = kind === 'woods' ? 330 : kind === 'dense' ? 700 : 410;
  // which road a lane grows out of: by its length, lanes before streets and the arterial last
  const hosts: { s: number; cum: number[]; len: number; w: number }[] = [];
  let weight = 0;
  const host = (s: number) => {
    const st = strokes[s];
    if (st.lot || st.ring || st.pts.length < 2) return;
    const cum = cumLen(st.pts), len = cum[cum.length - 1];
    if (len < 100) return;
    const w = len * (s === 0 ? 0.5 : s < streets ? 1 : 1.5);
    hosts.push({ s, cum, len, w });
    weight += w;
  };
  for (let s = 0; s < strokes.length; s++) host(s);
  for (let made = 0, n = 0; made < want && n < want * 40; n++) {
    let x = r2() * weight, h = hosts[0];
    for (const o of hosts) { h = o; if ((x -= o.w) <= 0) break; }
    const d = 30 + r2() * (h.len - 60), side = r2() < 0.5 ? -1 : 1, turn0 = (r2() - 0.5) * 0.5, steps = 2 + ((r2() * 6) | 0), curl = (r2() - 0.5) * 0.5;
    const from = pointOn(strokes[h.s].pts, h.cum, d), e = pointOn(strokes[h.s].pts, h.cum, d + 1);
    if (Math.hypot(from.x, from.y) > reach || !inside(from) || !room(from, h.s)) continue;
    // it leaves the road it grows from at a right angle, or nearly
    let ang = Math.atan2(e.y - from.y, e.x - from.x) + side * (Math.PI / 2) + turn0;
    if (!square(h.s, from, Math.cos(ang), Math.sin(ang))) continue;
    const pts = [from], near: Near[] = [{ s: h.s, p: from }];
    let cur = from, done = false;
    /** End on the road ahead, if there is one near enough and it can be met squarely. */
    const join = () => {
      const look = { x: cur.x + Math.cos(ang) * 45, y: cur.y + Math.sin(ang) * 45 };
      const t = nearestRoad(look);
      const L = Math.hypot(t.q.x - cur.x, t.q.y - cur.y);
      if (t.s < 0 || L < 34 || L > 115 || !inside(t.q)) return false;
      const ux = (t.q.x - cur.x) / L, uy = (t.q.y - cur.y) / L;
      // squarely, and without doubling back on itself to get there
      if (!square(t.s, t.q, ux, uy) || ux * Math.cos(ang) + uy * Math.sin(ang) < 0.3) return false;
      if (!room(t.q, t.s) || Math.hypot(t.q.x - from.x, t.q.y - from.y) < APART_BIG) return false;
      if (!clear(cur, t.q, [...near, { s: t.s, p: t.q }])) return false;
      pts.push(t.q);
      return true;
    };
    for (let k = 0; k < steps; k++) {
      // the first step takes it well away from its road; no step turns so sharply that the rules would pin the corner
      const len = k ? 36 + r2() * 30 : 54 + r2() * 20;
      if (k) ang += Math.max(-0.55, Math.min(0.55, curl + (r2() - 0.5) * 0.8));
      const next = { x: cur.x + Math.cos(ang) * len, y: cur.y + Math.sin(ang) * len };
      // its own earlier stretches are in the way like any other road
      const own = pts.length > 2 && pts.slice(0, -2).some((p) => Math.hypot(p.x - next.x, p.y - next.y) < CLEAR);
      if (inside(next) && !own && clear(cur, next, near)) { pts.push(next); cur = next; continue; }
      break;
    }
    if (pts.length < 2) continue;
    done = join();
    // a dead end, if it may stop here; one in three that could are let be
    if (!done && !(mayEnd(cur) && r2() < 0.34)) continue;
    const s = lay({ pts, w: 1 }, from, cur, pts[pts.length - 1]);
    host(s);
    made++;
  }
  return { strokes, upTo: [grid, streets, Infinity] };
}

// the tiles made so far: the same tile is asked for again at each level of detail
const kept = new Map<string, Made>();

/**
 * The strokes of tile (i, j), in its own coordinates: the tile is centred on 0, 0, as the hand-drawn map is.
 * Each level of detail is the one below with more strokes after it, so a tile can be refined without its big roads moving.
 * Tile (0, 0) is the hand-drawn map itself.
 */
export function tileStrokes(i: number, j: number, detail: Detail = 2, seed = WORLD): Intent {
  const key = seed + ':' + i + ':' + j;
  let m = kept.get(key);
  if (!m) {
    if (place.on) forgetFar(kept);
    else if (kept.size > 400) kept.clear();
    kept.set(key, (m = make(i, j, seed)));
  }
  return m.strokes.slice(0, m.upTo[detail]);
}

/** The same without remembering anything: for measuring, and for checking that a tile comes out the same twice. */
export function tileFresh(i: number, j: number, detail: Detail = 2, seed = WORLD): Intent {
  const m = make(i, j, seed);
  return m.strokes.slice(0, m.upTo[detail]);
}

/** ?tile=i,j starts the page on that tile instead of the hand-drawn map, and &detail=0|1|2 on that much of it. */
export function tileAsked(): { i: number; j: number; detail: Detail } | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  const t = (q.get('tile') ?? '').split(',').map((n) => parseInt(n, 10));
  if (t.length !== 2 || !Number.isFinite(t[0]) || !Number.isFinite(t[1])) return null;
  const d = parseInt(q.get('detail') ?? '2', 10);
  const detail = (d === 0 || d === 1 ? d : 2) as Detail;
  // the hand-drawn tile, whole, is the page as it always was
  if (t[0] === 0 && t[1] === 0 && detail === 2) return null;
  return { i: t[0], j: t[1], detail };
}

/** The strokes of every tile of the window, each moved to where its tile lies. `hand` is what the hand-drawn tile is, if it is one of them. */
export function windowStrokes(hand: Intent): Intent {
  return tilesNow().flatMap((t) => held.get(t.i + ',' + t.j) ?? (t.i === 0 && t.j === 0 ? hand : tileStrokes(t.i, t.j).map((s) => ({ ...s, pts: s.pts.map((p) => ({ x: p.x + t.x, y: p.y + t.y })) }))));
}

// what each tile's strokes were when the window last left it: whatever was painted there is there when it comes back
const held = new Map<string, Intent>();
/** Before the window moves on: every stroke is put away with the tile its middle lies in. */
export function holdStrokes(intent: Intent) {
  for (const t of tilesNow()) held.set(t.i + ',' + t.j, []);
  for (const s of intent) {
    // (the middle of all its points: one point of it may lie on a border, and a stroke of two has no other)
    let x = 0, y = 0;
    for (const p of s.pts) { x += p.x; y += p.y; }
    const i = Math.min(place.i + 1, Math.max(place.i, Math.round(x / s.pts.length / TILE))), j = Math.min(place.j + 1, Math.max(place.j, Math.round(y / s.pts.length / TILE)));
    held.get(i + ',' + j)!.push(s);
  }
}
