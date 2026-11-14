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
  len: number;
  look: number; // the rank it is drawn as; rank itself is who yields
}

/** What the network is built from: a list of roads. Shared end points become junctions. */
export interface SpecRoad {
  raw: V[];
  kind: RoadKind;
  stalls: boolean[]; // per segment of raw
  bridge?: boolean;
  demote?: number; // steps of priority taken away: it yields where it used to go first
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
/** what the brush lays down */
export const PAINTED: RoadKind = { lanes: 2, lw: 3.3, speed: 13, rank: 2 };
export const BRIDGE_H = 7.5;

// the big lots get their own signal on the arterial, as they do
const SIGNALS = [[170, 0], [-170, 0]];

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
  { x0: 88, y0: -151, x1: 182, y1: -19 },
  { x0: -182, y0: 19, x1: -88, y1: 101 },
  { x0: -102, y0: -86, x1: -12, y1: -15 },
  { x0: 78, y0: 17, x1: 262, y1: 74 },
];
const BUILDINGS: Building[] = [
  { x0: 70, y0: -228, x1: 202, y1: -160, h: 9, wall: 0xb9b2a4, roof: 0xd9d8d2 },
  { x0: -196, y0: 108, x1: -98, y1: 136, h: 6, wall: 0xa9907a, roof: 0xbfbdb6 },
  { x0: -76, y0: -38, x1: -46, y1: -22, h: 5.5, wall: 0xc9c9c9, roof: 0xe6e4de, canopy: true },
  { x0: -48, y0: -60, x1: -20, y1: -44, h: 4.5, wall: 0x9c9488, roof: 0x8f8f8c },
  { x0: 128, y0: 82, x1: 160, y1: 100, h: 5, wall: 0xb85c44, roof: 0x9b9a96 },
  { x0: 196, y0: 84, x1: 228, y1: 102, h: 5, wall: 0xc7b89a, roof: 0xcfcdc6 },
  { x0: 50, y0: 150, x1: 150, y1: 215, h: 8, wall: 0x8f9499, roof: 0xb7b9ba },
  { x0: -250, y0: -160, x1: -150, y1: -95, h: 8, wall: 0xb0a898, roof: 0xdad7cf },
  { x0: -110, y0: -260, x1: -40, y1: -210, h: 6, wall: 0x99897a, roof: 0x77736c },
  { x0: 270, y0: -100, x1: 340, y1: -50, h: 6, wall: 0xa7a59f, roof: 0xc8c5bd },
];

export function baseSpec(): Spec {
  const spec: Spec = [];
  const N = (x: number, y: number): V => ({ x, y });
  const R = (a: V, b: V, kind: RoadKind, via: V[] = [], stallSegs: number[] = []) => {
    const raw = [a, ...via, b];
    spec.push({ raw, kind, stalls: raw.slice(1).map((_, i) => stallSegs.includes(i)) });
  };
  const chain = (ns: V[], kind: RoadKind) => {
    for (let i = 0; i < ns.length - 1; i++) R(ns[i], ns[i + 1], kind);
  };
  /** A parking lot is one road snaking through its aisles: no junctions inside, so nothing to lock up. */
  const lot = (xs: number[], y0: number, y1: number) => {
    const via: V[] = [];
    const segs: number[] = [];
    xs.forEach((x, i) => {
      const [ya, yb] = i % 2 ? [y1, y0] : [y0, y1];
      if (i > 0) via.push({ x, y: ya });
      if (i < xs.length - 1) via.push({ x, y: yb });
      segs.push(i * 2);
    });
    const last = xs.length % 2 ? y1 : y0;
    R(N(xs[0], y0), N(xs[xs.length - 1], last), AISLE, via, segs);
  };

  // the arterial (east–west) and the cross street
  chain([N(-460, 0), N(-170, 0), N(-90, 0), N(0, 0), N(90, 0), N(170, 0), N(250, 0), N(460, 0)], ART);
  chain([N(0, -420), N(0, -140), N(0, -70), N(0, 0), N(0, 90), N(0, 420)], CROSS);

  // big box store lot, north-east
  lot([170, 152.5, 135, 117.5, 100], -28, -140);
  R(N(170, 0), N(170, -28), DRIVE);
  R(N(0, -140), N(100, -140), DRIVE);

  // strip mall lot, south-west
  lot([-170, -152.5, -135, -117.5, -100], 28, 90);
  R(N(-170, 0), N(-170, 28), DRIVE);
  R(N(-100, 90), N(0, 90), DRIVE);

  // gas station cut-through, north-west
  R(N(-90, 0), N(0, -70), DRIVE, [{ x: -90, y: -70 }]);

  // fast food loop, south-east
  R(N(90, 0), N(250, 0), DRIVE, [{ x: 90, y: 60 }, { x: 250, y: 60 }], [1]);
  return spec;
}

/** Height of a bridge deck, d metres along its road. */
export function deck(r: Road, d: number) {
  if (!r.bridge) return 0;
  const R = Math.min(45, r.len / 2);
  const t = Math.max(0, Math.min(1, Math.min(d, r.len - d) / R));
  return BRIDGE_H * t * t * (3 - 2 * t);
}

export function buildNet(spec: Spec): Net {
  const nodes: Node[] = [];
  const roads: Road[] = [];
  const lanes: Lane[] = [];
  const stalls: Stall[] = [];
  const pads = PADS, buildings = BUILDINGS;

  const N = (p: V): Node => {
    for (const n of nodes) if (Math.abs(n.p.x - p.x) < 0.1 && Math.abs(n.p.y - p.y) < 0.1) return n;
    const n: Node = { id: nodes.length, p: { x: p.x, y: p.y }, roads: [], trim: 0, signal: false, stub: false, sigOff: 0, edge: false };
    nodes.push(n);
    return n;
  };
  for (const sr of spec) {
    const a = N(sr.raw[0]), b = N(sr.raw[sr.raw.length - 1]);
    const pts = fillet(sr.raw, 7);
    const stallSegs: number[] = [];
    sr.stalls.forEach((on, i) => on && stallSegs.push(i));
    const cum = cumLen(pts);
    const r: Road = { ...sr.kind, rank: sr.kind.rank - (sr.demote ?? 0), look: sr.kind.rank, id: roads.length, a, b, raw: sr.raw, pts, base: [], stallSegs, bridge: !!sr.bridge, len: cum[cum.length - 1] };
    roads.push(r);
    a.roads.push(r);
    b.roads.push(r);
  }

  // ---------- junctions ----------
  for (const n of nodes) {
    n.stub = n.roads.length === 1;
    // traffic comes and goes only at the far ends of the map, not at a painted dead end
    n.edge = n.stub && (Math.abs(n.p.x) > 400 || Math.abs(n.p.y) > 380);
    const hw = Math.max(...n.roads.map((r) => r.lanes * r.lw));
    n.trim = n.stub ? 0 : hw + (hw > 5 ? 5 : 2.5);
    n.signal = (n.roads.length >= 4 && n.roads.every((r) => r.look >= 2)) || SIGNALS.some(([x, y]) => x === n.p.x && y === n.p.y);
    n.sigOff = Math.abs(n.p.x) / 14;
  }

  const mkLane = (pts: V[], speed: number, road: Road | null, dir: 1 | -1, idx: number, from: Node, to: Node): Lane => {
    const cum = cumLen(pts);
    const l: Lane = { id: lanes.length, pts, cum, len: cum[cum.length - 1], speed, road, dir, idx, from, to, next: [], inc: [], sib: [], cars: [] };
    lanes.push(l);
    return l;
  };

  for (const r of roads) {
    r.base = trim(r.pts, r.a.trim, r.b.trim);
    for (const dir of [1, -1] as const) {
      const src = dir === 1 ? r.base : [...r.base].reverse();
      const group: Lane[] = [];
      for (let i = 0; i < r.lanes; i++) {
        group.push(mkLane(offset(src, (i + 0.5) * r.lw), r.speed, r, dir, i, dir === 1 ? r.a : r.b, dir === 1 ? r.b : r.a));
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
        const turn: Conn['turn'] = node.roads.length === 2 || Math.abs(ang) < 0.87 ? 'T' : ang > 0 ? 'R' : 'L';
        const pick = turn === 'R' ? g[m - 1] : turn === 'L' ? g[0] : g[Math.min(src.idx, m - 1)];
        if (!fallback || Math.abs(ang) < fallback.a) fallback = { dst: pick, a: Math.abs(ang) };
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
    const hw = r.lanes * r.lw;
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
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && d[i] < best) { best = d[i]; u = i; }
    if (u < 0) return null;
    if (goal[u] && u !== from.id) {
      const path: Lane[] = [];
      for (let k = u; k >= 0; k = prev[k]) path.push(net.lanes[k]);
      return path.reverse();
    }
    done[u] = 1;
    const l = net.lanes[u];
    for (const m of l.next) {
      const c = best + (m.len / m.speed) * jit(m.id, seed) + (m.conn && m.conn.turn === 'L' ? 5 : 0);
      if (c < d[m.id]) { d[m.id] = c; prev[m.id] = u; }
    }
    if (!(noChange && l === from)) {
      for (const m of l.sib) {
        const c = best + (3 + 90 / l.len) * jit(m.id, seed);
        if (c < d[m.id]) { d[m.id] = c; prev[m.id] = u; }
      }
    }
  }
}
