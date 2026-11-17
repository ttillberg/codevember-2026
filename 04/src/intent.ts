// What is painted, and the rules that turn it into roads.
// The strokes are the only thing kept. Every time they change the network is derived again from nothing:
// each stroke is walked from node to node, sharing the nodes that are already near, and each run of
// edges between junctions gets a road style.
import { BRIDGE_H, boxed, cumLen, deckAt, far, heightAt, shape, type Deck, halfWidth, junctionTrim, KINDS, pointOn, ringKind, type Rect, type Spec, type SpecRoad, type V } from './net';

export interface Stroke {
  pts: V[];
  /** how big a road is meant: 0 aisle, 1 driveway, 2 street, 3 arterial */
  w: number;
  /** a parking lot aisle: its long straights get stalls, the turns between them do not */
  lot?: boolean;
  /** flies over what it crosses and only lands at its two ends */
  bridge?: boolean;
  /** a bridge whose start or end hangs on another bridge instead of landing: a ramp, or a link between two decks */
  air?: [boolean, boolean];
  /** a bridge whose start or end stops up in the air, where its ramps leave it */
  open?: [boolean, boolean];
  /** one way, from the first point to the last: a ramp */
  one?: boolean;
  /** closes on itself: a roundabout, one way round */
  ring?: boolean;
  /** laid by the brush, after the houses were there */
  paint?: boolean;
}
export type Intent = Stroke[];

/** ?no=roundabout: junctions stay junctions however many arms they have, and a closed stroke is just a road */
/** A junction turns into a roundabout by itself only with this many arms. */
export const RING_ARMS = 6;
/** Is this left out of the place? From ?no=house,trees,roundabout in the address; a word counts by how it starts. */
const NO = (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('no') ?? '' : '').toLowerCase().split(',');
export const no = (word: string) => NO.some((w) => w.startsWith(word));
export const RINGS = !no('round');

const SNAP = 18; // an end this close to a road joins it
const R = 26; // junctions closer than this are one
const ROOM = 44; // a road keeps this far from every other, or it is the same road
const RING = 16; // a roundabout only shares the nodes right on its line
const LOT = 14; // but a parking lot only takes in what comes right up to it
const STEP = 6; // how finely a stroke is walked

const dist = (a: V, b: V) => Math.hypot(b.x - a.x, b.y - a.y);
export { far };
const half = (s: Stroke) => KINDS[s.w].lanes * KINDS[s.w].lw;

export function length(pts: V[]) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/** The point of a polyline nearest p: how far, on which segment, where, and how far along. */
export function nearest(pts: V[], p: V) {
  let best = { d: Infinity, seg: 0, q: pts[0], s: 0 };
  let run = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (L * L || 1)));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = dist(p, q);
    if (d < best.d) best = { d, seg: i, q, s: run + t * L };
    run += L;
  }
  return best;
}

/**
 * Houses are in the way, and nothing takes them down. Whatever is painted or pushed towards one bends round it
 * where there is room and squeezes between two: a road, a roundabout, a bridge. Only a parking lot stays as it is.
 */
function dodge(s: Stroke, houses: Rect[]): Stroke {
  if (s.bridge) return span(s, houses);
  if (s.lot || !houses.length) return s;
  const m = half(s) + 2.5;
  const hit = houses.filter((h) => s.pts.some((p, i) => i > 0 && segNear(s.pts[i - 1], p, h, m)));
  if (!hit.length) return s;
  const cum = cumLen(s.pts);
  const len = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(len / 5));
  let pts: V[] = [];
  for (let k = 0; k <= n; k++) pts.push(pointOn(s.pts, cum, (len * k) / n));
  const push = (p: V, m: number): V => {
    for (let it = 0; it < 4; it++) {
      const h = hit.find((q) => p.x > q.x0 - m && p.x < q.x1 + m && p.y > q.y0 - m && p.y < q.y1 + m);
      if (!h) return p;
      // out through the nearest wall
      const dl = p.x - (h.x0 - m), dr = h.x1 + m - p.x, du = p.y - (h.y0 - m), dd = h.y1 + m - p.y;
      const d = Math.min(dl, dr, du, dd);
      p = d === dl ? { x: h.x0 - m - 0.1, y: p.y } : d === dr ? { x: h.x1 + m + 0.1, y: p.y } : d === du ? { x: p.x, y: h.y0 - m - 0.1 } : { x: p.x, y: h.y1 + m + 0.1 };
    }
    return p;
  };
  // pushed well clear, then eased: the easing pulls the line back in, so it is given room to do it.
  // What comes out takes the house in a wide curve, not round its corners
  for (let pass = 0; pass < 6; pass++) {
    pts = pts.map((p) => push(p, m + 7));
    for (let e = 0; e < 4; e++) pts = pts.map((p, i) => (i === 0 || i === n ? p : { x: (pts[i - 1].x + 2 * p.x + pts[i + 1].x) / 4, y: (pts[i - 1].y + 2 * p.y + pts[i + 1].y) / 4 }));
  }
  // and whatever the easing still left inside is put out, just
  return { ...s, pts: pts.map((p) => push(p, m)) };
}

/** A circular arc from a to b that bulges `bow` times the chord to the left of it. 0 is a straight line. */
export function arc(a: V, b: V, bow: number): V[] {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ex = (b.x - a.x) / L, ey = (b.y - a.y) / L;
  const n = Math.max(16, Math.ceil((L * (1 + 2.6 * bow * bow)) / 8));
  const pts: V[] = [];
  if (Math.abs(bow) < 0.01) {
    for (let i = 0; i <= n; i++) pts.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
    return pts;
  }
  const h = bow * L, sg = Math.sign(h), R = (L * L / 4 + h * h) / (2 * Math.abs(h));
  const ux = -ey * sg, uy = ex * sg;
  const cx = (a.x + b.x) / 2 + ux * (Math.abs(h) - R), cy = (a.y + b.y) / 2 + uy * (Math.abs(h) - R);
  const th = Math.atan2(L / 2, R - Math.abs(h));
  for (let i = 0; i <= n; i++) {
    const f = -th + (2 * th * i) / n, c = R * Math.cos(f), q = R * Math.sin(f);
    pts.push({ x: cx + ux * c + ex * q, y: cy + uy * c + ey * q });
  }
  pts[0] = a; pts[n] = b;
  return pts;
}

/** How far the hand bowed out from the straight line between its ends, as a share of that line. Left is positive. */
function bowOf(s: Stroke) {
  const a = s.pts[0], b = s.pts[s.pts.length - 1];
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
  let h = 0;
  for (const p of s.pts) {
    const d = (p.x - a.x) * nx + (p.y - a.y) * ny;
    if (Math.abs(d) > Math.abs(h)) h = d;
  }
  // a shaky line is a straight one; and no more than half a circle
  const k = h / L;
  return Math.abs(k) < 0.06 ? 0 : Math.max(-0.5, Math.min(0.5, k));
}

/** The line a bridge is asked to take before anything is in its way: one arc of a circle, as the hand bowed. */
function sweep(s: Stroke): V[] {
  return arc(s.pts[0], s.pts[s.pts.length - 1], bowOf(s));
}

/**
 * A bridge is a beam, not a hose: one arc of a circle from end to end, bowed as the hand bowed, straight if it did not.
 * Where a house still stands in the line the arc is opened or closed until it gets past; what is low enough it goes over.
 * If no arc gets past, there is no bridge.
 */
function span(s: Stroke, houses: (Rect & { h?: number })[]): Stroke {
  const a = s.pts[0], b = s.pts[s.pts.length - 1];
  // a bridge is wider than its road, and should not shave a wall
  const m = half(s) + 4.5;
  const k0 = bowOf(s);
  for (const dk of [0, 0.05, -0.05, 0.1, -0.1, 0.16, -0.16, 0.23, -0.23, 0.31, -0.31, 0.4, -0.4]) {
    const k = k0 + dk * (k0 < 0 ? -1 : 1);
    if (Math.abs(k) > 0.5) continue;
    const pts = arc(a, b, k), n = pts.length - 1;
    const len = length(pts);
    // clear under the slab, with a metre to spare
    const over = (h: number | undefined, i: number) => h !== undefined && h + 2.5 < Math.min(deckAt(len, (len * (i - 1)) / n), deckAt(len, (len * i) / n));
    if (!houses.some((h) => pts.some((p, i) => i > 0 && segNear(pts[i - 1], p, h, m) && !over(h.h, i)))) return { ...s, pts };
  }
  return { ...s, pts: [a, { x: a.x + 0.01, y: a.y }] };
}

function segNear(a: V, b: V, h: Rect, m: number) {
  const x0 = h.x0 - m, x1 = h.x1 + m, y0 = h.y0 - m, y1 = h.y1 + m;
  if (Math.max(a.x, b.x) < x0 || Math.min(a.x, b.x) > x1 || Math.max(a.y, b.y) < y0 || Math.min(a.y, b.y) > y1) return false;
  for (let k = 0; k <= 8; k++) {
    const x = a.x + ((b.x - a.x) * k) / 8, y = a.y + ((b.y - a.y) * k) / 8;
    if (x > x0 && x < x1 && y > y0 && y < y1) return true;
  }
  return false;
}

/**
 * How high every bridge is. Each painted bridge is one profile, however many pieces it was cut into where others join it.
 * An end that hangs on an earlier bridge is as high as that one is there; and a bridge that crosses an earlier one
 * keeps clear of it, over or under. Read off the finished roads, since that is where the ends really are.
 */
function layers(spec: Spec): Spec {
  // the slab, room for a lorry under it, and a little for where the road is cut back at its junctions
  const CLEAR = 7.5, FORK = 8.5;
  const by = new Map<number, SpecRoad[]>();
  for (const r of spec) if (r.bridge) (by.get(r.stroke) ?? by.set(r.stroke, []).get(r.stroke)!).push(r);
  const done: { pts: V[]; cum: number[]; k: Deck; hw: number }[] = [];
  for (const [, parts] of [...by].sort((a, b) => a[0] - b[0])) {
    parts.sort((a, b) => (a.part ?? 0) - (b.part ?? 0));
    const pts = parts.flatMap((r, i) => (i ? r.raw.slice(1) : r.raw));
    const cum = cumLen(pts), len = cum[cum.length - 1];
    /** how high the deck is that this end hangs on */
    const hung = (p: V) => {
      let z = -1, bd = 3;
      for (const t of done) {
        const n = nearest(t.pts, p);
        if (n.d < bd) { bd = n.d; z = heightAt(t.k, n.s); }
      }
      return z;
    };
    const air = [!!parts[0].air?.[0], !!parts[parts.length - 1].air?.[1]];
    // an end that hangs on nothing is where the bridge forks into its ramps: not as high as a bridge gets, so they are short
    const up = (p: V) => { const z = hung(p); return z < 0 ? FORK : z; };
    const z0 = air[0] ? up(pts[0]) : 0, z1 = air[1] ? up(pts[pts.length - 1]) : 0;
    // wherever the two decks lie over each other, not only where their middles cross: sampled along this one
    const hw = Math.max(...parts.map((r) => halfWidth(r.kind, r.one)));
    const cross: { d: number; h: number }[] = [];
    for (const t of done) {
      for (let d = 0; d <= len; d += 5) {
        // where it joins a deck it does not have to clear it;
        // nor at its feet, where no height of the deck would lift it clear
        if (d < 25 || d > len - 25 || (air[0] && d < 32) || (air[1] && d > len - 32)) continue;
        const n = nearest(t.pts, pointOn(pts, cum, d));
        if (n.d < hw + t.hw + 1) cross.push({ d, h: heightAt(t.k, n.s) });
      }
    }
    // a bridge from ground to ground humps; one that hangs on another only goes as high as its ends
    let want = air[0] || air[1] ? Math.max(z0, z1) : BRIDGE_H;
    let k = shape(len, z0, z1, want);
    const clear = () => cross.every((q) => Math.abs(heightAt(k, q.d) - q.h) >= CLEAR);
    while (!clear() && want < 45) k = shape(len, z0, z1, (want += 1.5), true);
    let off = 0;
    for (const r of parts) {
      r.deck = { ...k, off };
      off += length(r.raw);
    }
    done.push({ pts, cum, k, hw });
  }
  return spec;
}

/** The rules: strokes in, roads between junctions out. Same strokes, same town. */
/**
 * A bridge is not stopped by the housing: what stands in its line comes down. Only the houses of the town;
 * the sheds on the lots belong to the roads and stay.
 */
export function standing<T extends Rect>(intent: Intent, houses: T[]): T[] {
  const spans = intent.filter((s) => s.bridge && s.pts.length > 1).map((s) => ({ m: half(s) + 4.5, pts: sweep(s) }));
  // the little ones by the road come down for any road that is painted through them, not only for a bridge
  const roads = intent.filter((s) => s.paint && !s.bridge && s.pts.length > 1).map((s) => ({ m: half(s) + 3, pts: s.pts }));
  if (!spans.length && !roads.length) return houses;
  // the box round each stroke: a house outside it, by its margin, is near none of its stretches
  const box = new Map((spans as { m: number; pts: V[] }[]).concat(roads).map((s) => {
    const xs = s.pts.map((p) => p.x), ys = s.pts.map((p) => p.y);
    return [s, { x0: Math.min(...xs) - s.m, y0: Math.min(...ys) - s.m, x1: Math.max(...xs) + s.m, y1: Math.max(...ys) + s.m }];
  }));
  const hit = (list: typeof spans, h: Rect) => list.some((s) => {
    const b = box.get(s)!;
    if (b.x1 < h.x0 || b.x0 > h.x1 || b.y1 < h.y0 || b.y0 > h.y1) return false;
    return s.pts.some((p, i) => i > 0 && segNear(s.pts[i - 1], p, h, s.m));
  });
  const left = houses.filter((h) => !('path' in h) || !(hit(spans, h) || ('small' in h && h.small && hit(roads, h))));
  return left.length === houses.length ? houses : left;
}

// The same strokes among the same houses are asked for several times when a stroke is laid: answer once.
const made = new WeakMap<Intent, { houses: Rect[]; spec: Spec }>();
// one list for "no houses", so that asking twice without any is asking the same thing
export const NO_HOUSES: Rect[] = [];
const NO_NODES: number[] = [];

export function derive(intent: Intent, houses: Rect[] = NO_HOUSES): Spec {
  const was = made.get(intent);
  if (was && was.houses === houses) return was.spec;
  const spec = layers(courts(roundabouts(rules(intent, houses))));
  made.set(intent, { houses, spec });
  return spec;
}

/** The roads as they lie between their junctions, before the yards, the roundabouts and the heights are put on them. */
export const plan = (intent: Intent, houses: Rect[] = NO_HOUSES): Spec => rules(intent, houses);

function rules(intent: Intent, houses: Rect[]): Spec {
  houses = standing(intent, houses);
  intent = intent.map((s) => dodge(s, houses));
  const cums = intent.map((s) => cumLen(s.pts));
  const lens = cums.map((c) => c[c.length - 1]);
  // the box round every stroke: two that are nowhere near each other need not be asked point by point
  const boxes = intent.map((t) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of t.pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); } return { x0, y0, x1, y1 }; });

  // ---------- nodes: the places roads can go through ----------
  // A stroke takes the node that is already near, and only makes a new one where there is room.
  // That one rule keeps roads from lying on each other, makes paint on paint the same road,
  // and keeps the arms of a junction well apart.
  const nodes: (V & { lot: boolean; air?: boolean })[] = [];
  // a node up on a bridge and one on the ground are never the same node, however close on the map
  // (the nodes lie in squares of 64 m, put there as they are made: a point asks the squares it can reach, not every node)
  const cells = new Map<number, number[]>();
  let celled = 0;
  const near = (p: V, r: number, air = false) => {
    for (; celled < nodes.length; celled++) {
      const c = Math.floor(nodes[celled].x / 64) * 100003 + Math.floor(nodes[celled].y / 64), l = cells.get(c);
      if (l) l.push(celled); else cells.set(c, [celled]);
    }
    let best = -1, bd = Infinity;
    for (let gx = Math.floor((p.x - r) / 64); gx <= Math.floor((p.x + r) / 64); gx++) {
      for (let gy = Math.floor((p.y - r) / 64); gy <= Math.floor((p.y + r) / 64); gy++) {
        for (const k of cells.get(gx * 100003 + gy) ?? NO_NODES) {
          const d = dist(nodes[k], p);
          // the nearest, and of two as near the one made first, as when every node was asked in turn
          if (!!nodes[k].air === air && d < (nodes[k].lot ? Math.min(r, LOT) : r) && (d < bd || (d === bd && k < best))) { bd = d; best = k; }
        }
      }
    }
    return best;
  };
  const node = (p: V, r = R, lot = false) => {
    const k = near(p, r);
    if (k >= 0) return k;
    nodes.push({ x: p.x, y: p.y, lot });
    return nodes.length - 1;
  };
  // a parking lot is not for driving through: a painted road stops at its edge
  const lots = intent.filter((s) => s.lot).map((s) => ({
    x0: Math.min(...s.pts.map((p) => p.x)) + 1, x1: Math.max(...s.pts.map((p) => p.x)) - 1,
    y0: Math.min(...s.pts.map((p) => p.y)) + 1, y1: Math.max(...s.pts.map((p) => p.y)) - 1,
  }));
  // nor through a house: where it could not get round one, it ends
  const housed = boxed(houses, 2), inHouse = (p: V) => housed(p.x, p.y, 1);
  const inLot = (p: V) => inHouse(p) || lots.some((l) => p.x > l.x0 && p.x < l.x1 && p.y > l.y0 && p.y < l.y1);
  /** where a stroke has to pass: its ends, its crossings, its corners */
  const pins: { s: number; k: number }[][] = intent.map(() => []);

  /** how many of its two ends found something to stand on */
  const landed = intent.map(() => 0);
  // an end reaches for the nearest road
  intent.forEach((s, i) => {
    if (s.ring) {
      // a ring starts and ends in the same place and reaches for nothing
      const k = node(s.pts[0]);
      pins[i].push({ s: 0, k }, { s: lens[i], k });
      return;
    }
    for (const e of [0, 1]) {
      const p = e ? s.pts[s.pts.length - 1] : s.pts[0];
      if (s.bridge && s.open?.[e]) {
        // it stops in the air: its ramps come to it there
        let k = near(p, 3, true);
        if (k < 0) k = nodes.push({ x: p.x, y: p.y, lot: false, air: true }) - 1;
        pins[i].push({ s: e ? lens[i] : 0, k });
        landed[i]++;
        continue;
      }
      if (s.bridge && s.air?.[e]) {
        // an end that was put on a deck hangs on the nearest bridge painted before this one, clear of its ramps' feet
        let up: { j: number; n: ReturnType<typeof nearest> } | null = null;
        for (let j = 0; j < i; j++) {
          if (!intent[j].bridge || landed[j] !== 2) continue;
          const n = nearest(intent[j].pts, p);
          // or right on its end, if that end is open for ramps
          const mid = n.s > 15 && n.s < lens[j] - 15, tip = (intent[j].open?.[0] && n.s < 3) || (intent[j].open?.[1] && n.s > lens[j] - 3);
          if (n.d < SNAP && (mid || tip) && (!up || n.d < up.n.d)) up = { j, n };
        }
        if (up) {
          let k = near(up.n.q, intent[up.j].open ? 3 : 14, true);
          if (k < 0) k = nodes.push({ x: up.n.q.x, y: up.n.q.y, lot: false, air: true }) - 1;
          pins[i].push({ s: e ? lens[i] : 0, k });
          pins[up.j].push({ s: up.n.s, k });
          landed[i]++;
          continue;
        }
      }
      let bd = SNAP, bj = -1, bn: ReturnType<typeof nearest> | null = null;
      intent.forEach((t, j) => {
        if (j === i || t.bridge) return;
        const B = boxes[j];
        if (Math.hypot(Math.max(B.x0 - p.x, p.x - B.x1, 0), Math.max(B.y0 - p.y, p.y - B.y1, 0)) - half(t) >= bd) return;
        const n = nearest(t.pts, p);
        if (n.d - half(t) < bd) { bd = n.d - half(t); bj = j; bn = n; }
      });
      const hit = bn as ReturnType<typeof nearest> | null;
      const k = node(hit ? hit.q : p);
      pins[i].push({ s: e ? lens[i] : 0, k });
      if (hit) { pins[bj].push({ s: hit.s, k }); landed[i]++; }
      else if (s.bridge) pins[i].pop(); // a bridge that does not land
    }
  });
  // strokes that cross, each other or themselves
  for (let i = 0; i < intent.length; i++) {
    if (intent[i].bridge) continue;
    for (let j = i; j < intent.length; j++) {
      if (intent[j].bridge || intent[i].lot || intent[j].lot) continue;
      if (boxes[i].x0 > boxes[j].x1 + 1 || boxes[j].x0 > boxes[i].x1 + 1 || boxes[i].y0 > boxes[j].y1 + 1 || boxes[j].y0 > boxes[i].y1 + 1) continue;
      const A = intent[i].pts, B = intent[j].pts;
      for (let a = 0; a < A.length - 1; a++) {
        const p = A[a], rx = A[a + 1].x - p.x, ry = A[a + 1].y - p.y;
        for (let b = i === j ? a + 2 : 0; b < B.length - 1; b++) {
          const q = B[b], sx = B[b + 1].x - q.x, sy = B[b + 1].y - q.y;
          const den = rx * sy - ry * sx;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((q.x - p.x) * sy - (q.y - p.y) * sx) / den;
          const u = ((q.x - p.x) * ry - (q.y - p.y) * rx) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const k = node({ x: p.x + rx * t, y: p.y + ry * t });
          pins[i].push({ s: cums[i][a] + t * Math.hypot(rx, ry), k });
          pins[j].push({ s: cums[j][b] + u * Math.hypot(sx, sy), k });
        }
      }
    }
  }
  // corners: every one in a parking lot, the sharp ones elsewhere
  intent.forEach((s, i) => {
    if (s.bridge) return;
    for (let n = 1; n < s.pts.length - 1; n++) {
      const a = s.pts[n - 1], p = s.pts[n], b = s.pts[n + 1];
      const turn = Math.abs(Math.atan2((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x), (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)));
      if (s.lot) pins[i].push({ s: cums[i][n], k: node(p, 0.5, true) });
      else if (turn > 0.6) pins[i].push({ s: cums[i][n], k: node(p) });
    }
  });

  // ---------- edges: walk every stroke from node to node ----------
  interface Edge { a: number; b: number; by: number[]; lot: boolean; bridge?: V[]; part?: number; ring?: boolean; fwd?: boolean }
  const edges = new Map<string, Edge>();
  // roundabouts are walked first: they keep their shape, and everything else comes to them
  const order = intent.map((_, i) => i).sort((a, b) => Number(!!intent[b].ring) - Number(!!intent[a].ring) || a - b);
  order.forEach((i) => {
    const s = intent[i];
    const ps = pins[i].slice().sort((a, b) => a.s - b.s);
    if (s.bridge) {
      if (landed[i] !== 2) return;
      // one piece between each two places something joins it
      const at = ps.filter((p, n) => n === 0 || p.k !== ps[n - 1].k);
      for (let n = 0; n < at.length - 1; n++) {
        const a = at[n], b = at[n + 1];
        const cut = [pointOn(s.pts, cums[i], a.s), ...s.pts.filter((_, m) => cums[i][m] > a.s + 1 && cums[i][m] < b.s - 1), pointOn(s.pts, cums[i], b.s)];
        edges.set('b' + i + ':' + n, { a: a.k, b: b.k, by: [i], lot: false, bridge: cut, part: n });
      }
      return;
    }
    let seq: number[] = [];
    if (s.lot) seq = ps.map((p) => p.k);
    else {
      let n = 0;
      for (let d = 0; ; d += STEP) {
        const at = Math.min(d, lens[i]);
        for (; n < ps.length && ps[n].s <= at; n++) seq.push(ps[n].k);
        const p = pointOn(s.pts, cums[i], at);
        // a ring keeps the shape it was drawn in: it gives way to nothing, the rest comes to it
        // a ring lies over a parking lot, but not over a house
        seq.push((s.ring ? inHouse(p) : inLot(p)) ? -1 : node(p, s.ring ? RING : ROOM));
        if (at >= lens[i]) break;
      }
    }
    seq = seq.filter((k, n) => n === 0 || k !== seq[n - 1]);
    if (s.ring) {
      // traffic goes round anticlockwise, whichever way the hand went
      let area = 0;
      for (let n = 0; n < s.pts.length - 1; n++) area += s.pts[n].x * s.pts[n + 1].y - s.pts[n + 1].x * s.pts[n].y;
      if (area > 0) seq.reverse();
    }
    // there and straight back is not a road
    for (let n = 1; n < seq.length - 1; n++) if (seq[n] >= 0 && seq[n - 1] === seq[n + 1]) { seq.splice(n, 2); n = Math.max(0, n - 2); }
    for (let n = 0; n < seq.length - 1; n++) {
      if (seq[n] < 0 || seq[n + 1] < 0) continue;
      const a = Math.min(seq[n], seq[n + 1]), b = Math.max(seq[n], seq[n + 1]);
      const e = edges.get(a + ':' + b) ?? edges.set(a + ':' + b, { a, b, by: [], lot: false }).get(a + ':' + b)!;
      if (!e.by.includes(i)) e.by.push(i);
      e.lot ||= !!s.lot;
      if (s.ring && !e.ring) { e.ring = true; e.fwd = seq[n] === a; }
    }
  });

  // ---------- road styles ----------
  // a driveway that ends in a parking lot wants a signal where it meets the arterial, as they do
  const feeds = intent.map((s) => {
    if (s.lot || s.w !== 1) return false;
    return intent.some((t) => t.lot && t.w === 0 && [t.pts[0], t.pts[t.pts.length - 1]].some((q) => dist(q, s.pts[0]) < 1 || dist(q, s.pts[s.pts.length - 1]) < 1));
  });
  // how big: the biggest stroke that went this way, and a size up for every time it was painted over
  const level = (e: Edge) => Math.min(3, Math.max(...e.by.map((i) => intent[i].w)) + e.by.length - 1);
  const alike = (a: Edge, b: Edge) => !a.bridge && !b.bridge && level(a) === level(b) && a.lot === b.lot && !!a.ring === !!b.ring && a.by[0] === b.by[0];

  const around: Edge[][] = nodes.map(() => []);
  for (const e of edges.values()) { around[e.a].push(e); around[e.b].push(e); }
  // a road runs on through every node where nothing else joins and nothing about it changes
  const through = (k: number) => around[k].length === 2 && alike(around[k][0], around[k][1]);

  const spec: Spec = [];
  const used = new Set<Edge>();
  const emit = (ks: number[], e: Edge) => {
    const s = intent[e.by[0]];
    if (e.ring) {
      const first = edges.get(Math.min(ks[0], ks[1]) + ':' + Math.max(ks[0], ks[1]))!;
      if ((first.a === ks[0]) !== first.fwd) ks = ks.slice().reverse();
    }
    let raw = e.bridge ? e.bridge.map((p) => ({ x: p.x, y: p.y })) : ks.map((k) => ({ x: nodes[k].x, y: nodes[k].y }));
    if (e.bridge) {
      raw[0] = { ...nodes[e.a] }; raw[raw.length - 1] = { ...nodes[e.b] };
      // an end pulled onto its node can land on the next point of the span: two points in one place break the ribbon
      const last = raw[raw.length - 1];
      raw = raw.filter((p, i) => i === 0 || i === raw.length - 1 || (Math.hypot(p.x - raw[i - 1].x, p.y - raw[i - 1].y) > 1 && Math.hypot(p.x - last.x, p.y - last.y) > 1));
    }
    else if (!e.lot) {
      // the nodes in between are only there to give it its shape: ease them
      for (let it = 0; it < 2; it++) raw = raw.map((p, n) => (n === 0 || n === raw.length - 1 ? p : { x: (raw[n - 1].x + 2 * p.x + raw[n + 1].x) / 4, y: (raw[n - 1].y + 2 * p.y + raw[n + 1].y) / 4 }));
    }
    const k0 = ks[0], k1 = ks[ks.length - 1];
    const blind = (around[k0].length === 1 && !far(nodes[k0])) || (around[k1].length === 1 && !far(nodes[k1]));
    // a stub that goes nowhere is only worth keeping if it is long
    if (blind && length(raw) < 30) return;
    let lv = level(e);
    // a road that ends in the grass is a cul-de-sac, whatever it was painted as
    if (blind && e.by.length === 1) lv = Math.min(lv, 1);
    const kind = e.ring ? ringKind(Math.min(3, 1 + e.by.length)) : KINDS[lv];
    let longest = 0;
    const cum = cums[e.by[0]];
    for (let n = 1; n < cum.length; n++) longest = Math.max(longest, cum[n] - cum[n - 1]);
    const stalls = raw.slice(1).map((q, n) => {
      if (!s.lot) return false;
      const seg = nearest(s.pts, { x: (raw[n].x + q.x) / 2, y: (raw[n].y + q.y) / 2 }).seg;
      return cum[seg + 1] - cum[seg] >= longest / 2;
    });
    spec.push({ raw, kind, stalls, bridge: !!e.bridge, part: e.part, air: e.bridge ? [!!nodes[e.a].air, !!nodes[e.b].air] : undefined, stroke: e.by[0], by: e.by, feeds: e.by.some((i) => feeds[i]), ring: e.ring, one: !!(e.bridge && s.one) });
  };
  const walk = (k: number, e: Edge) => {
    const ks = [k];
    for (;;) {
      used.add(e);
      k = e.a === k ? e.b : e.a;
      ks.push(k);
      if (!through(k) || k === ks[0]) break;
      const nx = around[k][0] === e ? around[k][1] : around[k][0];
      if (used.has(nx)) break;
      e = nx;
    }
    if (ks[0] === ks[ks.length - 1] && ks.length > 3) {
      // a loop back to where it started is two roads, or it has no far end
      const m = ks.length >> 1;
      emit(ks.slice(0, m + 1), e);
      emit(ks.slice(m), e);
    } else if (ks[0] !== ks[ks.length - 1]) emit(ks, e);
  };
  for (let k = 0; k < nodes.length; k++) if (!through(k)) for (const e of around[k]) if (!used.has(e)) walk(k, e);
  // what is left are rings with no junction on them
  for (const e of edges.values()) if (!used.has(e)) walk(e.a, e);
  return settle(spec);
}

/**
 * Junctions need room. A road too short to fit between the two junctions it joins is not a road:
 * the two are one junction, and it is taken up into it. Repeated until everything fits.
 */
function settle(spec: Spec): Spec {
  const key = (p: V) => p.x.toFixed(2) + ':' + p.y.toFixed(2);
  for (let pass = 0; pass < 300; pass++) {
    const at = new Map<string, { p: V; roads: SpecRoad[] }>();
    for (const r of spec) {
      for (const p of [r.raw[0], r.raw[r.raw.length - 1]]) {
        const n = at.get(key(p)) ?? at.set(key(p), { p, roads: [] }).get(key(p))!;
        n.roads.push(r);
      }
    }
    const trim = new Map<string, number>();
    for (const [k, n] of at) trim.set(k, junctionTrim(n.p, n.roads.map((r) => ({ raw: r.raw, hw: halfWidth(r.kind, r.ring || r.one), ring: r.ring || r.one }))));
    const fixed = (n: { roads: SpecRoad[] }) => n.roads.some((r) => r.ring || r.stalls.some(Boolean));
    let worst: SpecRoad | null = null, lack = 0;
    for (const r of spec) {
      if (r.bridge || r.ring || r.stalls.some(Boolean)) continue;
      const ka = key(r.raw[0]), kb = key(r.raw[r.raw.length - 1]);
      if (at.get(ka)!.roads.length < 2 || at.get(kb)!.roads.length < 2) continue;
      // nor one that would drag a parking lot along
      // a roundabout or a parking lot does not move, but it can take in what crowds it. Two of them stay two
      if (fixed(at.get(ka)!) && fixed(at.get(kb)!)) continue;
      // a junction can only take so many arms
      if (at.get(ka)!.roads.length + at.get(kb)!.roads.length - 2 > 8) continue;
      const d = trim.get(ka)! + trim.get(kb)! + 6 - length(r.raw);
      if (d > lack) { lack = d; worst = r; }
    }
    if (!worst) break;
    const gone = worst;
    const A = at.get(key(gone.raw[0]))!, B = at.get(key(gone.raw[gone.raw.length - 1]))!;
    // the busier junction stays where it is
    const [keep, lose] = fixed(B) || (!fixed(A) && B.roads.length > A.roads.length) ? [B, A] : [A, B];

    const clear = Math.max(10, trim.get(key(keep.p))!);
    const next: Spec = [];
    for (const r of spec) {
      if (r === gone) continue;
      const e0 = key(r.raw[0]) === key(lose.p), e1 = key(r.raw[r.raw.length - 1]) === key(lose.p);
      if (!e0 && !e1) { next.push(r); continue; }
      const a = e0 ? keep.p : r.raw[0], b = e1 ? keep.p : r.raw[r.raw.length - 1];
      const mid = r.raw.slice(1, -1).filter((p) => !(e0 && dist(p, a) < clear) && !(e1 && dist(p, b) < clear));
      const raw = [{ x: a.x, y: a.y }, ...mid, { x: b.x, y: b.y }];
      if (dist(a, b) < 1 && length(raw) < 60) continue; // a loop too small to drive
      // two roads between the same two junctions, side by side, are one road
      const twin = next.findIndex((q) => {
        const same = (key(q.raw[0]) === key(a) && key(q.raw[q.raw.length - 1]) === key(b)) || (key(q.raw[0]) === key(b) && key(q.raw[q.raw.length - 1]) === key(a));
        return same && dist(a, b) >= 1 && Math.abs(length(q.raw) - length(raw)) < 30;
      });
      const made = { ...r, raw, stalls: raw.slice(1).map(() => false) };
      if (twin < 0) next.push(made);
      else if (made.kind.rank > next[twin].kind.rank) next[twin] = made;
    }
    spec = next;
  }
  return spec;
}

/**
 * A road does not just stop. Where one ends in the open there is a small yard: room to turn, and to park.
 */
function courts(spec: Spec): Spec {
  const key = (p: V) => p.x.toFixed(2) + ':' + p.y.toFixed(2);
  const deg = new Map<string, number>();
  for (const r of spec) for (const p of [r.raw[0], r.raw[r.raw.length - 1]]) deg.set(key(p), (deg.get(key(p)) ?? 0) + 1);
  return spec.map((r) => {
    if (r.bridge || r.ring || r.kind.rank < 1 || r.stalls.some(Boolean)) return r;
    let raw = r.raw, stalls = r.stalls;
    for (const end of [0, 1]) {
      const p = end ? raw[raw.length - 1] : raw[0];
      if (deg.get(key(p)) !== 1 || far(p)) continue;
      // the last stretch, cut to the length of a yard
      const o = end ? raw.slice().reverse() : raw.slice();
      const os = end ? stalls.slice().reverse() : stalls.slice();
      const L = dist(o[0], o[1]);
      if (L < 16) continue;
      if (L > 46) { o.splice(1, 0, { x: o[0].x + ((o[1].x - o[0].x) * 38) / L, y: o[0].y + ((o[1].y - o[0].y) * 38) / L }); os.splice(1, 0, false); }
      os[0] = true;
      raw = end ? o.reverse() : o;
      stalls = end ? os.reverse() : os;
    }
    return raw === r.raw ? r : { ...r, raw, stalls };
  });
}

/**
 * A junction with six arms or more is a roundabout: a ring, one way, and every arm meets it on its own.
 * The more arms and the wider they are, the bigger the ring.
 */
function roundabouts(spec: Spec): Spec {
  const key = (p: V) => p.x.toFixed(2) + ':' + p.y.toFixed(2);
  const at = new Map<string, { p: V; ends: { r: SpecRoad; e: 0 | 1 }[] }>();
  for (const r of spec) {
    ([0, 1] as const).forEach((e) => {
      const p = e ? r.raw[r.raw.length - 1] : r.raw[0];
      (at.get(key(p)) ?? at.set(key(p), { p, ends: [] }).get(key(p))!).ends.push({ r, e });
    });
  }
  const raws = new Map<SpecRoad, V[]>(spec.map((r) => [r, r.raw]));
  const rings: Spec = [];
  for (const n of at.values()) {
    // nor where bridges meet: that is up in the air
    if (!RINGS || n.ends.length < RING_ARMS || n.ends.filter((a) => a.r.bridge).length > 1 || n.ends.some((a) => a.r.ring || a.r.stalls.some(Boolean))) continue;
    const c = n.p;
    // each arm, seen from the middle outwards
    const arms = n.ends.map(({ r, e }) => {
      const o = e ? raws.get(r)!.slice().reverse() : raws.get(r)!;
      return { r, e, o, t: halfWidth(r.kind) + 3, len: length(o), m: 1, th: 0, sub: c };
    });
    const aim = (R: number) => {
      for (const a of arms) {
        a.m = a.o.findIndex((p, k) => k > 0 && dist(p, c) > R + 4);
        if (a.m < 0) a.m = a.o.length - 1;
        const d = dist(a.o[a.m], c) || 1;
        a.th = Math.atan2((a.o[a.m].y - c.y) / d, (a.o[a.m].x - c.x) / d);
        a.sub = { x: c.x + ((a.o[a.m].x - c.x) / d) * R, y: c.y + ((a.o[a.m].y - c.y) / d) * R };
      }
      arms.sort((a, b) => b.th - a.th); // anticlockwise, as the traffic goes
    };
    const gap = (i: number) => (arms[i].th - arms[(i + 1) % arms.length].th + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
    aim(26);
    // room on the ring for each arm to get on and off
    let R = 22;
    arms.forEach((a, i) => { R = Math.max(R, (a.t + arms[(i + 1) % arms.length].t + 16) / gap(i)); });
    R = Math.min(R, 75, Math.min(...arms.map((a) => a.len)) - 12);
    if (R < 16) continue;
    aim(R);
    if (arms.some((a) => dist(a.sub, a.o[a.o.length - 1]) < 6)) continue;
    for (const a of arms) {
      const cut = [a.sub, ...a.o.slice(a.m)];
      raws.set(a.r, a.e ? cut.reverse() : cut);
    }
    const kind = ringKind(arms.some((a) => a.r.kind.lanes >= 3) || arms.length > 6 ? 2 : 1);
    arms.forEach((a, i) => {
      const b = arms[(i + 1) % arms.length], g = gap(i);
      const steps = Math.max(2, Math.ceil(g / 0.2));
      const raw: V[] = [a.sub];
      for (let k = 1; k < steps; k++) raw.push({ x: c.x + R * Math.cos(a.th - (g * k) / steps), y: c.y + R * Math.sin(a.th - (g * k) / steps) });
      raw.push(b.sub);
      rings.push({ raw, kind, stalls: raw.slice(1).map(() => false), stroke: a.r.stroke, ring: true });
    });
  }
  return [...spec.map((r) => (raws.get(r) === r.raw ? r : { ...r, raw: raws.get(r)!, stalls: raws.get(r)!.slice(1).map(() => false) })), ...rings];
}

// ---------- the place as it stands: a stroad junction outside an American town, as strokes ----------

export function baseIntent(): Intent {
  const out: Intent = [];
  const P = (...c: number[]): V[] => {
    const pts: V[] = [];
    for (let i = 0; i < c.length; i += 2) pts.push({ x: c[i], y: c[i + 1] });
    return pts;
  };
  /** A parking lot is one stroke snaking through its aisles: no junctions inside, so nothing to lock up. */
  const lot = (xs: number[], y0: number, y1: number) => {
    const c: number[] = [];
    xs.forEach((x, i) => {
      const [ya, yb] = i % 2 ? [y1, y0] : [y0, y1];
      c.push(x, ya, x, yb);
    });
    out.push({ pts: P(...c), w: 0, lot: true });
  };

  // the arterial (east–west) and the cross street
  // both run on out of sight, into the haze
  out.push({ pts: P(-600, 0, 600, 0), w: 3 });
  out.push({ pts: P(0, -600, 0, 600), w: 2 });

  // back streets either side of the arterial, and two lanes that tie them together: the place is a net, not a cross
  out.push({ pts: P(-600, -240, -300, -215, 0, -205, 300, -215, 600, -245), w: 2 });
  out.push({ pts: P(-600, 260, -300, 240, 0, 235, 300, 245, 600, 265), w: 2 });
  out.push({ pts: P(-300, -215, -290, 0, -300, 240), w: 1 });
  out.push({ pts: P(300, -215, 295, 0, 300, 245), w: 1 });

  // strip mall lot, south-west
  lot([-170, -152.5, -135], 28, 80);
  out.push({ pts: P(-170, 0, -170, 28), w: 1 });
  out.push({ pts: P(-135, 80, 0, 80), w: 1 });

  // gas station cut-through, north-west
  out.push({ pts: P(-90, 0, -90, -70, 0, -70), w: 1 });

  // Inside the blocks it is lanes, as in Xinpaifang, Chongqing: they wind between the houses, meet at odd angles,
  // loop back on the street they left and stop at somebody's door. This is where the tangle starts.
  const lane = (...c: number[]) => out.push({ pts: P(...c), w: 1 });
  // north-east
  lane(0, -120, 70, -130, 130, -165, 190, -150, 215, -100, 297, -95);
  lane(130, -165, 120, -110, 150, -60, 150, 0);
  lane(215, -100, 235, -55, 205, -30);
  lane(70, -130, 62, -70, 95, -45);
  // south-east
  lane(0, 110, 60, 95, 120, 120, 170, 90, 230, 110, 296, 100);
  lane(120, 120, 108, 180, 150, 240);
  lane(170, 90, 176, 40, 150, 0);
  lane(230, 110, 242, 165, 205, 200);
  // north-west, round the warehouse and behind the gas station
  lane(-292, -60, -225, -72, -185, -40, -170, 0);
  lane(0, -150, -55, -138, -105, -165, -135, -212);
  // south-west, behind the strip mall
  lane(-294, 140, -235, 150, -180, 185, -110, 168, -55, 190, 0, 170);
  lane(-180, 185, -172, 239);
  // and loops hung on the back streets, out towards the haze
  lane(100, -213, 108, -270, 175, -292, 238, -262, 250, -216);
  lane(-200, 241, -192, 300, -125, 322, -62, 292, -60, 236);
  return out;
}
