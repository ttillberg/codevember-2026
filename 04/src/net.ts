// The road network: nodes, roads, lanes, junction connectors, conflicts, stalls, routing.
// 2D, metres, x east, y south (three.js z). Right-hand traffic.

export type V = { x: number; y: number };

export interface Node {
  id: number;
  p: V;
  roads: Road[];
  trim: number;
  signal: boolean;
  stub: boolean; // a dead end
  sigOff: number; // seconds this signal runs ahead of the cycle
  edge: boolean;
  /** how high it is: a junction on a bridge is up in the air */
  z: number;
}

export interface RoadKind {
  lanes: number; // per direction
  lw: number;
  speed: number;
  rank: number;
}

export interface Road extends RoadKind {
  id: number;
  a: Node;
  b: Node;
  raw: V[];
  pts: V[]; // centreline a→b, corners filleted
  base: V[]; // centreline trimmed at both junctions
  stallSegs: number[];
  bridge: boolean;
  /** the profile of its deck, if it is a bridge */
  deck?: Deck;
  len: number;
  feeds: boolean;
  ring: boolean; // one way, anticlockwise: a piece of a roundabout
  one: boolean; // one way, a to b: a ramp
  hw: number; // half its width
}

/** What the network is built from: a list of roads, derived from the strokes. Shared end points become junctions. */
export interface SpecRoad {
  raw: V[];
  kind: RoadKind;
  stalls: boolean[]; // per segment of raw
  bridge?: boolean;
  /** which piece of its stroke's bridge it is, counted from the start */
  part?: number;
  /** whether its first and last point hang on another bridge, up in the air */
  air?: [boolean, boolean];
  deck?: Deck;
  stroke: number; // the stroke it was derived from
  feeds?: boolean; // leads to a parking lot: wants a signal where it meets a big road
  ring?: boolean; // a piece of a roundabout: one way, from the first point to the last
  one?: boolean; // a ramp: one way, from the first point to the last
}
export type Spec = SpecRoad[];

export interface Conflict {
  o: Lane;
  sMine: number;
  sOther: number;
}

export interface Conn {
  turn: 'L' | 'T' | 'R';
  src: Lane;
  dst: Lane;
  node: Node;
  phase: number;
  conflicts: Conflict[];
  reserved: unknown[];
}

export interface Lane {
  id: number;
  pts: V[];
  cum: number[];
  len: number;
  speed: number;
  road: Road | null; // null for a connector
  dir: 1 | -1;
  idx: number; // 0 = next to the centreline
  from: Node;
  to: Node;
  next: Lane[];
  inc: Lane[]; // connectors that end in this lane
  sib: Lane[];
  cars: any[];
  conn?: Conn;
  /** when an emergency vehicle last drove up it, in the traffic's time: its signal lets it through and the cross traffic waits */
  rush?: number;
  /** road works along it, for as long as they last */
  dig?: Dig | null;
  /** its whole road is closed for works: no route goes in */
  shut?: boolean;
}

/** A stretch of a lane beside or under road works: coned off, so that nobody drives in it, or only slow past the cones. */
export interface Dig {
  s0: number;
  s1: number;
  closed: boolean;
}

export interface Stall {
  p: V;
  ang: number;
  laneF: Lane;
  sF: number;
  laneB: Lane;
  sB: number;
  car: unknown | null;
  res: boolean;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface Building extends Rect {
  h: number;
  wall: number;
  roof: number;
  canopy?: boolean;
}

export interface Net {
  nodes: Node[];
  roads: Road[];
  lanes: Lane[];
  stalls: Stall[];
  pads: Rect[];
  buildings: Building[];
  edges: Node[];
}

export const ART: RoadKind = { lanes: 3, lw: 3.3, speed: 16, rank: 3 };
export const CROSS: RoadKind = { lanes: 2, lw: 3.3, speed: 13, rank: 2 };
export const DRIVE: RoadKind = { lanes: 1, lw: 3.2, speed: 7, rank: 1 };
export const AISLE: RoadKind = { lanes: 1, lw: 3, speed: 4, rank: 0 };
/** the building blocks, smallest first */
export const KINDS = [AISLE, DRIVE, CROSS, ART];
/** the carriageway of a roundabout: it outranks everything that joins it */
export const ringKind = (lanes: number): RoadKind => ({ lanes, lw: 3.8, speed: 9, rank: 4 });
/** half the width of a road of this kind */
export const halfWidth = (k: RoadKind, ring?: boolean) => (ring ? (k.lanes * k.lw) / 2 : k.lanes * k.lw);
/** as high as a long bridge gets; a short one has no room to climb that far */
export const BRIDGE_H = 11;

/** Out in the haze, where a road is out of sight: traffic comes and goes there, and nowhere else. */
export const far = (p: V) => (place.half ? Math.max(Math.abs(p.x - place.x), Math.abs(p.y - place.y)) > place.half - 30 : Math.hypot(p.x - 10, p.y + 10) > 400);

/** How wide and deep a tile of the endless grid is, in metres: as big as the hand-drawn map. */
export const TILE = 1200;
/**
 * What is laid out: one tile round the middle, as the page always was (`half` 0), or with ?endless a window of two
 * tiles by two, each where it lies in the grid. ?endless=i,j names the north-west one of the four; without, the
 * hand-drawn tile is the south-west one. `sheds` is whether the hand-drawn tile's own sheds and yards stand.
 */
export const place = (() => {
  const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
  const t = (q?.get('endless') ?? '').split(',').map((n) => parseInt(n, 10));
  const on = !!q?.has('endless'), i = Number.isFinite(t[0]) ? t[0] : 0, j = Number.isFinite(t[1]) ? t[1] : -1;
  return { on, i, j, x: on ? (i + 0.5) * TILE : 0, y: on ? (j + 0.5) * TILE : 0, half: on ? TILE : 0, sheds: !on || (i >= -1 && i <= 0 && j >= -1 && j <= 0) };
})();
/** The window moves on over the grid: (i, j) is its north-west tile from now on. */
export function movePlace(i: number, j: number) {
  place.i = i; place.j = j; place.x = (i + 0.5) * TILE; place.y = (j + 0.5) * TILE;
  place.sheds = i >= -1 && i <= 0 && j >= -1 && j <= 0;
}
/** The tiles of the window, and where each one's middle lies. */
export const tilesNow = (): { i: number; j: number; x: number; y: number }[] =>
  place.on ? [0, 1].flatMap((b) => [0, 1].map((a) => ({ i: place.i + a, j: place.j + b, x: (place.i + a) * TILE, y: (place.j + b) * TILE }))) : [{ i: 0, j: 0, x: 0, y: 0 }];
/** One tile on its own, as if it were the whole place: what is planted in a tile is planted on this, so it never depends on its neighbours. */
export function alone<T>(sheds: boolean, make: () => T): T {
  const was = { half: place.half, sheds: place.sheds };
  place.half = 0; place.sheds = sheds;
  try { return make(); } finally { place.half = was.half; place.sheds = was.sheds; }
}
/** A number of a tile's own, to plant it by: 0 for the hand-drawn one, so that it stands as it always did. */
export const saltOf = (i: number, j: number) => (i === 0 && j === 0 ? 0 : ((Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0) % 100000 + 1);

export const STALL_W = 2.7;
export const STALL_D = 5.5;

// ---------- small maths ----------

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist = (a: V, b: V) => Math.hypot(b.x - a.x, b.y - a.y);

export function cumLen(pts: V[]) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i]));
  return c;
}

/** Offset a polyline; positive d is to the right of travel. */
export function offset(pts: V[], d: number): V[] {
  const n = pts.length;
  const out: V[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[i];
    const c = pts[Math.min(n - 1, i + 1)];
    let n1x = -(b.y - a.y), n1y = b.x - a.x;
    let n2x = -(c.y - b.y), n2y = c.x - b.x;
    const l1 = Math.hypot(n1x, n1y), l2 = Math.hypot(n2x, n2y);
    if (l1 < 1e-9) { n1x = n2x / l2; n1y = n2y / l2; } else { n1x /= l1; n1y /= l1; }
    if (l2 < 1e-9) { n2x = n1x; n2y = n1y; } else { n2x /= l2; n2y /= l2; }
    let mx = n1x + n2x, my = n1y + n2y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const k = Math.min(2, 1 / Math.max(0.3, mx * n1x + my * n1y));
    out.push({ x: b.x + mx * d * k, y: b.y + my * d * k });
  }
  return out;
}

export function pointOn(pts: V[], cum: number[], s: number): V {
  const len = cum[cum.length - 1];
  s = Math.max(0, Math.min(len, s));
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < s) i++;
  const seg = cum[i + 1] - cum[i] || 1;
  const t = (s - cum[i]) / seg;
  return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
}

export function trim(pts: V[], t0: number, t1: number): V[] {
  const cum = cumLen(pts);
  const len = cum[cum.length - 1];
  if (t0 + t1 > len - 1) {
    const k = (len - 1) / (t0 + t1);
    t0 *= k; t1 *= k;
  }
  const out = [pointOn(pts, cum, t0)];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > t0 + 0.05 && cum[i] < len - t1 - 0.05) out.push(pts[i]);
  out.push(pointOn(pts, cum, len - t1));
  return out;
}

function fillet(raw: V[], r: number): V[] {
  const out: V[] = [raw[0]];
  for (let i = 1; i < raw.length - 1; i++) {
    const p = raw[i], a = raw[i - 1], b = raw[i + 1];
    const la = dist(p, a), lb = dist(p, b);
    const rr = Math.min(r, la / 2, lb / 2);
    const p0 = { x: p.x + ((a.x - p.x) / la) * rr, y: p.y + ((a.y - p.y) / la) * rr };
    const p1 = { x: p.x + ((b.x - p.x) / lb) * rr, y: p.y + ((b.y - p.y) / lb) * rr };
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, u = 1 - t;
      out.push({ x: u * u * p0.x + 2 * u * t * p.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * p.y + t * t * p1.y });
    }
  }
  out.push(raw[raw.length - 1]);
  return out;
}

/** Position and unit tangent at s; extrapolates past either end. */
export function at(l: Lane, s: number, o: { x: number; y: number; ax: number; ay: number }) {
  const { pts, cum } = l;
  let i = 0;
  const n = cum.length;
  if (s >= l.len) i = n - 2;
  else if (s > 0) while (i < n - 2 && cum[i + 1] < s) i++;
  const a = pts[i], b = pts[i + 1];
  const seg = cum[i + 1] - cum[i] || 1;
  const ax = (b.x - a.x) / seg, ay = (b.y - a.y) / seg;
  const d = s - cum[i];
  o.x = a.x + ax * d; o.y = a.y + ay * d; o.ax = ax; o.ay = ay;
}

export function project(l: Lane, p: V): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < l.pts.length - 1; i++) {
    const a = l.pts[i], b = l.pts[i + 1];
    const seg = l.cum[i + 1] - l.cum[i] || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (seg * seg)));
    const d = Math.hypot(a.x + (b.x - a.x) * t - p.x, a.y + (b.y - a.y) * t - p.y);
    if (d < bd) { bd = d; best = l.cum[i] + t * seg; }
  }
  return best;
}

function crossing(a: Lane, b: Lane): { sa: number; sb: number } | null {
  for (let i = 0; i < a.pts.length - 1; i++) {
    const p = a.pts[i], p2 = a.pts[i + 1];
    const rx = p2.x - p.x, ry = p2.y - p.y;
    for (let j = 0; j < b.pts.length - 1; j++) {
      const q = b.pts[j], q2 = b.pts[j + 1];
      const sx = q2.x - q.x, sy = q2.y - q.y;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((q.x - p.x) * sy - (q.y - p.y) * sx) / den;
      const u = ((q.x - p.x) * ry - (q.y - p.y) * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return { sa: a.cum[i] + t * (a.cum[i + 1] - a.cum[i]), sb: b.cum[j] + u * (b.cum[j + 1] - b.cum[j]) };
      }
    }
  }
  return null;
}

// ---------- the place: a stroad junction outside an American town ----------

const PADS: Rect[] = [
  { x0: -182, y0: 19, x1: -123, y1: 91 },
  { x0: -102, y0: -86, x1: -12, y1: -15 },
];
const BUILDINGS: Building[] = [
  { x0: -190, y0: 98, x1: -122, y1: 122, h: 6, wall: 0xa9907a, roof: 0xbfbdb6 },
  { x0: -76, y0: -38, x1: -46, y1: -22, h: 5.5, wall: 0xc9c9c9, roof: 0xe6e4de, canopy: true },
  { x0: -48, y0: -60, x1: -20, y1: -44, h: 4.5, wall: 0x9c9488, roof: 0x8f8f8c },
  { x0: -250, y0: -160, x1: -150, y1: -95, h: 8, wall: 0xb0a898, roof: 0xdad7cf },
  { x0: -110, y0: -260, x1: -40, y1: -210, h: 6, wall: 0x99897a, roof: 0x77736c },
];

/**
 * The profile of one painted bridge, end to end: from z0 up (or down) a ramp to `top`, level, and a ramp to z1.
 * An end on the ground is at 0; one that hangs on another bridge is as high as that bridge is there.
 * A road that is a piece of the bridge starts `off` metres along it.
 */
export interface Deck { len: number; z0: number; z1: number; top: number; off: number }

/** How steep a ramp is by choice, and how steep it may get when it has to clear something. */
const SLOPE = 0.2, STEEP = 0.3;

/** Fit a profile: as high as wanted if the ramps have room, lower if not. `must` is for a bridge with something to clear. */
export function shape(len: number, z0: number, z1: number, want: number, must = false): Deck {
  const fit = ((must ? STEEP : SLOPE) * len + z0 + z1) / 2;
  return { len, z0, z1, top: Math.max(z0, z1, Math.min(want, fit)), off: 0 };
}

/** Height of a deck s metres along the whole bridge. */
export function heightAt(k: Deck, s: number) {
  const d0 = k.top - k.z0, d1 = k.top - k.z1;
  let R0 = d0 / SLOPE, R1 = d1 / SLOPE;
  const f = Math.min(1, k.len / (R0 + R1 || 1));
  R0 *= f; R1 *= f;
  const ss = (t: number) => t * t * (3 - 2 * t);
  if (s < R0) return k.z0 + d0 * ss(Math.max(0, s) / R0);
  if (s > k.len - R1) return k.z1 + d1 * ss(Math.max(0, k.len - s) / R1);
  return k.top;
}

/** Height of a plain bridge from ground to ground, len metres long, d metres along it. */
export function deckAt(len: number, d: number) {
  return heightAt(shape(len, 0, 0, BRIDGE_H), d);
}

/** Height of a bridge deck, d metres along its road. */
export function deck(r: Road, d: number) {
  return r.deck ? heightAt(r.deck, r.deck.off + d) : 0;
}

/** How far from its middle a junction keeps its roads back. A dead end keeps nothing back. */
export function junctionTrim(p: V, roads: { raw: V[]; hw: number; ring?: boolean }[]): number {
  if (roads.length < 2) return 0;
  // where an arm meets a roundabout it only has to clear the ring; and a ramp slides onto its road, it needs no square
  if (roads.some((r) => r.ring)) return Math.max(4, ...roads.filter((r) => !r.ring).map((r) => r.hw)) + 3;
  const hw = Math.max(...roads.map((r) => r.hw));
  let t = hw + (hw > 5 ? 5 : 2.5);
  if (roads.length < 3) return t;
  // arms that leave at a flat angle need longer before they are clear of each other
  const arms = roads.map((r) => {
    const at0 = dist(r.raw[0], p) <= dist(r.raw[r.raw.length - 1], p);
    const [a, q] = at0 ? [r.raw[0], r.raw[1]] : [r.raw[r.raw.length - 1], r.raw[r.raw.length - 2]];
    const d = dist(a, q) || 1;
    return { x: (q.x - a.x) / d, y: (q.y - a.y) / d, w: r.hw };
  });
  for (let i = 0; i < arms.length; i++) {
    for (let j = i + 1; j < arms.length; j++) {
      const cos = arms[i].x * arms[j].x + arms[i].y * arms[j].y;
      if (cos < 0.17) continue;
      const sin = Math.sqrt(Math.max(0.01, 1 - cos * cos));
      t = Math.max(t, Math.min(26, (Math.min(arms[i].w, arms[j].w) + Math.max(arms[i].w, arms[j].w) * cos) / sin + 2));
    }
  }
  return t;
}

export function buildNet(spec: Spec): Net {
  const nodes: Node[] = [];
  const roads: Road[] = [];
  const lanes: Lane[] = [];
  const stalls: Stall[] = [];
  const pads = place.sheds ? PADS : [], buildings = place.sheds ? BUILDINGS : [];

  // a junction up on a bridge is not the one on the ground under it, even at the very same spot
  const air = new Set<Node>();
  const N = (p: V, up = false): Node => {
    for (const n of nodes) if (air.has(n) === up && Math.abs(n.p.x - p.x) < 0.1 && Math.abs(n.p.y - p.y) < 0.1) return n;
    const n: Node = { id: nodes.length, p: { x: p.x, y: p.y }, roads: [], trim: 0, signal: false, stub: false, sigOff: 0, edge: false, z: 0 };
    if (up) air.add(n);
    nodes.push(n);
    return n;
  };
  for (const sr of spec) {
    const a = N(sr.raw[0], !!sr.air?.[0]), b = N(sr.raw[sr.raw.length - 1], !!sr.air?.[1]);
    const pts = fillet(sr.raw, 7);
    const stallSegs: number[] = [];
    sr.stalls.forEach((on, i) => on && stallSegs.push(i));
    const cum = cumLen(pts);
    const r: Road = { ...sr.kind, id: roads.length, a, b, raw: sr.raw, pts, base: [], stallSegs, bridge: !!sr.bridge, deck: sr.bridge ? sr.deck ?? shape(cum[cum.length - 1], 0, 0, BRIDGE_H) : undefined, feeds: !!sr.feeds, ring: !!sr.ring, one: !!sr.one, hw: halfWidth(sr.kind, sr.ring || sr.one), len: cum[cum.length - 1] };
    roads.push(r);
    a.roads.push(r);
    b.roads.push(r);
  }

  // ---------- junctions ----------
  for (const n of nodes) {
    n.stub = n.roads.length === 1;
    // where only bridges meet, the junction is as high as they are there
    if (n.roads.every((r) => r.bridge)) n.z = Math.max(0, ...n.roads.map((r) => deck(r, r.a === n ? 0 : r.len)));
    // traffic comes and goes only at the far ends of the map, not at a painted dead end
    n.edge = n.stub && far(n.p);
    n.trim = junctionTrim(n.p, n.roads.map((r) => ({ raw: r.raw, hw: r.hw, ring: r.ring || r.one })));
    const top = Math.max(...n.roads.map((r) => r.rank));
    n.signal = n.z === 0 && !n.roads.some((r) => r.ring) && ((n.roads.length >= 4 && n.roads.every((r) => r.rank >= 2)) || (n.roads.length >= 3 && top >= 3 && n.roads.some((r) => r.feeds)));
    n.sigOff = Math.abs(n.p.x) / 14;
  }
  // signals come one to a block: the bigger junction keeps its lights, the next one along gives way
  const size = (n: Node) => n.roads.reduce((a, r) => a + r.rank, 0);
  const lit: Node[] = [];
  for (const n of nodes.filter((n) => n.signal).sort((a, b) => size(b) - size(a) || a.id - b.id)) {
    if (lit.some((m) => dist(m.p, n.p) < 75)) n.signal = false;
    else lit.push(n);
  }

  const mkLane = (pts: V[], speed: number, road: Road | null, dir: 1 | -1, idx: number, from: Node, to: Node): Lane => {
    const cum = cumLen(pts);
    const l: Lane = { id: lanes.length, pts, cum, len: cum[cum.length - 1], speed, road, dir, idx, from, to, next: [], inc: [], sib: [], cars: [] };
    lanes.push(l);
    return l;
  };

  for (const r of roads) {
    r.base = trim(r.pts, r.a.trim, r.b.trim);
    const single = r.ring || r.one;
    for (const dir of (single ? [1] : [1, -1]) as (1 | -1)[]) {
      const src = dir === 1 ? r.base : [...r.base].reverse();
      const group: Lane[] = [];
      for (let i = 0; i < r.lanes; i++) {
        group.push(mkLane(offset(src, (i + 0.5) * r.lw - (single ? r.hw : 0)), r.speed, r, dir, i, dir === 1 ? r.a : r.b, dir === 1 ? r.b : r.a));
      }
      for (let i = 0; i < group.length; i++) {
        if (i > 0) group[i].sib.push(group[i - 1]);
        if (i < group.length - 1) group[i].sib.push(group[i + 1]);
      }
    }
  }

  const roadLanes = lanes.slice();
  const endDir = (l: Lane) => {
    const a = l.pts[l.pts.length - 2], b = l.pts[l.pts.length - 1];
    const d = dist(a, b) || 1;
    return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
  };
  const startDir = (l: Lane) => {
    const a = l.pts[0], b = l.pts[1];
    const d = dist(a, b) || 1;
    return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
  };

  const connect = (src: Lane, dst: Lane, turn: Conn['turn'], node: Node) => {
    const p0 = src.pts[src.pts.length - 1], p3 = dst.pts[0];
    const d0 = endDir(src), d1 = startDir(dst);
    const k = dist(p0, p3) * 0.38;
    const c1 = { x: p0.x + d0.x * k, y: p0.y + d0.y * k };
    const c2 = { x: p3.x - d1.x * k, y: p3.y - d1.y * k };
    const pts: V[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, u = 1 - t;
      pts.push({
        x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
      });
    }
    const slow = Math.min(src.speed, dst.speed);
    const speed = turn === 'T' ? slow : Math.min(slow, turn === 'L' ? 7 : 5);
    const c = mkLane(pts, speed, null, 1, 0, node, node);
    c.conn = { turn, src, dst, node, phase: Math.abs(d0.x) > Math.abs(d0.y) ? 0 : 1, conflicts: [], reserved: [] };
    c.next = [dst];
    src.next.push(c);
    dst.inc.push(c);
    return c;
  };

  for (const node of nodes) {
    if (node.stub) continue;
    const ins = roadLanes.filter((l) => l.to === node);
    const outs = roadLanes.filter((l) => l.from === node);
    const made: Lane[] = [];
    for (const src of ins) {
      const n = src.road!.lanes;
      const d0 = endDir(src);
      const groups = new Map<Road, Lane[]>();
      for (const o of outs) if (o.road !== src.road) (groups.get(o.road!) ?? groups.set(o.road!, []).get(o.road!)!).push(o);
      let fallback: { dst: Lane; a: number } | null = null;
      for (const g of groups.values()) {
        const m = g.length;
        const d1 = startDir(g[0]);
        const ang = Math.atan2(d0.x * d1.y - d0.y * d1.x, d0.x * d1.x + d0.y * d1.y);
        // a ramp is left and joined the way it points: nobody doubles back onto one or off it
        const ramp = src.road!.one !== g[0].road!.one;
        if ((src.road!.one || g[0].road!.one) && Math.abs(ang) > 1.9) continue;
        const turn: Conn['turn'] = node.roads.length === 2 || (src.road!.ring && g[0].road!.ring) || Math.abs(ang) < 0.87 ? 'T' : ang > 0 ? 'R' : 'L';
        const pick = turn === 'R' ? g[m - 1] : turn === 'L' ? g[0] : g[Math.min(src.idx, m - 1)];
        if (!fallback || Math.abs(ang) < fallback.a) fallback = { dst: pick, a: Math.abs(ang) };
        // on and off a roundabout every lane has its own way: the outer to the outer, the inner beside it
        if (ramp && node.z === 0) {
          // on the ground a ramp takes from the outer lane and gives to it
          if (g[0].road!.one ? src.idx === n - 1 : true) made.push(connect(src, g[0].road!.one ? g[Math.min(src.idx, m - 1)] : g[m - 1], 'T', node));
          continue;
        }
        if (src.road!.ring !== g[0].road!.ring) {
          made.push(connect(src, g[Math.max(0, m - 1 - (n - 1 - src.idx))], turn, node));
          continue;
        }
        if (turn === 'L' && src.idx !== 0) continue;
        if (turn === 'R' && src.idx !== n - 1) continue;
        made.push(connect(src, pick, turn, node));
      }
      if (!src.next.length && fallback) made.push(connect(src, fallback.dst, 'T', node));
    }
    for (let i = 0; i < made.length; i++) {
      for (let j = i + 1; j < made.length; j++) {
        const a = made[i], b = made[j];
        if (a.conn!.src === b.conn!.src) continue;
        let x: { sa: number; sb: number } | null = null;
        if (a.conn!.dst === b.conn!.dst) x = { sa: a.len, sb: b.len };
        else x = crossing(a, b);
        if (!x) continue;
        a.conn!.conflicts.push({ o: b, sMine: x.sa, sOther: x.sb });
        b.conn!.conflicts.push({ o: a, sMine: x.sb, sOther: x.sa });
      }
    }
  }

  // ---------- stalls ----------
  for (const r of roads) {
    const laneF = roadLanes.find((l) => l.road === r && l.dir === 1 && l.idx === 0)!;
    const laneB = roadLanes.find((l) => l.road === r && l.dir === -1 && l.idx === 0)!;
    const hw = r.hw;
    for (const si of r.stallSegs) {
      const a = r.raw[si], b = r.raw[si + 1];
      const L = dist(a, b);
      const tx = (b.x - a.x) / L, ty = (b.y - a.y) / L;
      const m0 = si === 0 ? r.a.trim + 1.5 : 9;
      const m1 = si === r.raw.length - 2 ? r.b.trim + 1.5 : 9;
      const n = Math.floor((L - m0 - m1) / STALL_W);
      const pad = (L - m0 - m1 - n * STALL_W) / 2;
      for (let k = 0; k < n; k++) {
        const d = m0 + pad + (k + 0.5) * STALL_W;
        const c = { x: a.x + tx * d, y: a.y + ty * d };
        for (const side of [1, -1]) {
          const nx = -ty * side, ny = tx * side;
          const off = hw + 0.4 + STALL_D / 2;
          stalls.push({
            p: { x: c.x + nx * off, y: c.y + ny * off },
            ang: Math.atan2(ny, nx),
            laneF, sF: project(laneF, c),
            laneB, sB: project(laneB, c),
            car: null, res: false,
          });
        }
      }
    }
  }

  return { nodes, roads, lanes, stalls, pads, buildings, edges: nodes.filter((n) => n.edge) };
}

// ---------- routing ----------

const jit = (id: number, seed: number) => {
  const x = Math.sin(id * 12.9898 + seed * 78.233) * 43758.5453;
  return 1 + 0.3 * (x - Math.floor(x));
};

/** Lane-level Dijkstra. A step to a sibling lane means "change lane somewhere along here". */
export function plan(net: Net, from: Lane, goals: Lane[], seed: number, noChange = false): Lane[] | null {
  const n = net.lanes.length;
  const d = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const goal = new Uint8Array(n);
  for (const g of goals) goal[g.id] = 1;
  d[from.id] = 0;
  // the nearest lane not yet settled comes off a heap: every car plans again whenever the roads change
  const heap: number[] = [from.id], key: number[] = [0];
  const push = (id: number, c: number) => {
    let i = heap.length;
    heap.push(id); key.push(c);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (key[p] <= c) break;
      heap[i] = heap[p]; key[i] = key[p]; i = p;
    }
    heap[i] = id; key[i] = c;
  };
  const pop = () => {
    const top = heap[0], id = heap.pop()!, c = key.pop()!;
    const m = heap.length;
    if (m) {
      let i = 0;
      for (;;) {
        let k = 2 * i + 1;
        if (k >= m) break;
        if (k + 1 < m && key[k + 1] < key[k]) k++;
        if (key[k] >= c) break;
        heap[i] = heap[k]; key[i] = key[k]; i = k;
      }
      heap[i] = id; key[i] = c;
    }
    return top;
  };
  for (;;) {
    let u = -1;
    while (heap.length) { const k = pop(); if (!done[k]) { u = k; break; } }
    if (u < 0) return null;
    const best = d[u];
    if (goal[u] && u !== from.id) {
      const path: Lane[] = [];
      for (let k = u; k >= 0; k = prev[k]) path.push(net.lanes[k]);
      return path.reverse();
    }
    done[u] = 1;
    const l = net.lanes[u];
    for (const m of l.next) {
      if (m.shut) continue;
      const c = best + (m.len / m.speed) * jit(m.id, seed) + (m.conn && m.conn.turn === 'L' ? 5 : 0);
      if (c < d[m.id]) { d[m.id] = c; prev[m.id] = u; push(m.id, c); }
    }
    if (!(noChange && l === from)) {
      for (const m of l.sib) {
        if (m.shut) continue;
        const c = best + (3 + 90 / l.len) * jit(m.id, seed);
        if (c < d[m.id]) { d[m.id] = c; prev[m.id] = u; push(m.id, c); }
      }
    }
  }
}
