// The pane as a planar graph of cracks. A bullet grows cracks from its impact: radials that wander and fork,
// tangential ones that hop from radial to radial, a rim around the hole. A crack that meets another one stops
// there (a T junction), so nothing ever crosses and the graph stays planar by construction. When the pane is
// doomed every open tip runs until it meets something, and the faces of the graph are the shards.
//
// Units are metres, in pane space: x 0…W, y 0…H, y up. Every node also has a slant: where the crack surface
// meets the back of the glass, as an offset from where it meets the front. Slants are per node, so the back of
// the pane is tiled by the same graph, displaced.

export function rng32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What the settings panel turns. Read at every bullet. */
export const CRACKS = {
  radials: 20, radialsVar: 12, longP: 0.5, length: 0.2, lengthVar: 0.8,
  wander: 0.45, kink: 0.16, branch: 5, rings: 0.65, ringsFar: 0.3, hole: 0.0062, slant: 0.42,
};

export const FRAME = 1;
export const CRACK = 0;
export const RIM = 2;

/** One crack, tip to tip: its nodes, the arc length at each and when the tip got there. */
export interface Path {
  nodes: number[];
  s: number[];
  times: number[];
  parent: number;
  parentIdx: number;
  delay: number;
  kind: number;
  /** ran out of energy in clear glass (its tip crawls to a stop) instead of running into something */
  open: boolean;
  /** radials start at the impact: their first segment is inside the hole and never drawn */
  skipFirst: boolean;
  timed: boolean;
}

export interface Impact {
  x: number;
  y: number;
  r: number;
  time: number;
  rim: number[]; // node ids around the hole
}

interface Tip {
  node: number;
  ang: number;
  cx: number;
  cy: number;
  path: number;
}

interface Grow {
  node: number;
  ang: number;
  budget: number;
  mode: 0 | 1 | 2; // 0 radial, 1 tangential, 2 straight
  cx: number;
  cy: number;
  sign: number;
  parent: number;
  parentIdx: number;
  delay: number;
  first: number; // length of the first step, 0 for the usual
  branch: number; // chance to fork, per metre
  skipFirst: boolean;
}

/** A drawn piece of crack: from node a at time ta to node b at time tb. */
export interface Seg {
  a: number;
  b: number;
  ta: number;
  tb: number;
  kind: number;
}

const CELL = 0.02;
const SNAP = 0.0008;

export class Pane {
  nx: number[] = [];
  ny: number[] = [];
  ox: number[] = [];
  oy: number[] = [];
  nbr: number[][] = [];
  ea: number[] = [];
  eb: number[] = [];
  ekind: number[] = [];
  private stamp: number[] = [];
  private stampNow = 0;
  private cols: number;
  private rows: number;
  private cells: number[][];
  private owner: number[] = []; // path that made the node, -1 for junctions
  private ownerIdx: number[] = [];
  paths: Path[] = [];
  impacts: Impact[] = [];
  tips: Tip[] = [];
  crackLen = 0;
  rand: () => number;
  private rs = 0; // the state of the pane's own random numbers, so a copy of the pane carries on the same
  W: number;
  H: number;
  T: number;

  constructor(W: number, H: number, T: number, seed: number) {
    this.W = W; this.H = H; this.T = T;
    this.rs = seed >>> 0;
    this.rand = this.makeRand();
    this.cols = Math.ceil(W / CELL) + 1;
    this.rows = Math.ceil(H / CELL) + 1;
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    const c = [this.node(0, 0, 0, 0), this.node(W, 0, 0, 0), this.node(W, H, 0, 0), this.node(0, H, 0, 0)];
    for (let i = 0; i < 4; i++) this.edge(c[i], c[(i + 1) % 4], FRAME);
  }

  private makeRand() {
    return () => {
      this.rs = (this.rs + 0x6d2b79f5) | 0;
      let t = Math.imul(this.rs ^ (this.rs >>> 15), 1 | this.rs);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A copy to try things on: the break is prepared on one while the pane itself can still be shot. */
  clone(): Pane {
    const c = Object.create(Pane.prototype) as Pane;
    Object.assign(c, this);
    c.nx = this.nx.slice(); c.ny = this.ny.slice(); c.ox = this.ox.slice(); c.oy = this.oy.slice();
    c.ea = this.ea.slice(); c.eb = this.eb.slice(); c.ekind = this.ekind.slice();
    c.stamp = this.stamp.slice(); c.owner = this.owner.slice(); c.ownerIdx = this.ownerIdx.slice();
    c.nbr = this.nbr.map((l) => l.slice()); c.cells = this.cells.map((l) => l.slice());
    c.paths = this.paths.map((q) => ({ ...q, nodes: q.nodes.slice(), s: q.s.slice(), times: q.times.slice() }));
    c.impacts = this.impacts.map((i) => ({ ...i, rim: i.rim.slice() }));
    c.tips = this.tips.map((t) => ({ ...t }));
    c.rand = c.makeRand();
    return c;
  }

  private gauss() {
    const r = this.rand;
    return (r() + r() + r() + r() - 2) * 1.7320508;
  }

  private node(x: number, y: number, ox: number, oy: number) {
    this.nx.push(x); this.ny.push(y); this.ox.push(ox); this.oy.push(oy);
    this.nbr.push([]); this.owner.push(-1); this.ownerIdx.push(0);
    return this.nx.length - 1;
  }

  private edge(a: number, b: number, kind: number) {
    const e = this.ea.length;
    this.ea.push(a); this.eb.push(b); this.ekind.push(kind); this.stamp.push(0);
    this.nbr[a].push(b); this.nbr[b].push(a);
    this.gridAdd(e);
    if (kind !== FRAME) this.crackLen += Math.hypot(this.nx[a] - this.nx[b], this.ny[a] - this.ny[b]);
    return e;
  }

  private gridAdd(e: number) {
    const { nx, ny, ea, eb } = this;
    const a = ea[e], b = eb[e];
    const x0 = Math.max(0, Math.floor(Math.min(nx[a], nx[b]) / CELL)), x1 = Math.min(this.cols - 1, Math.floor(Math.max(nx[a], nx[b]) / CELL));
    const y0 = Math.max(0, Math.floor(Math.min(ny[a], ny[b]) / CELL)), y1 = Math.min(this.rows - 1, Math.floor(Math.max(ny[a], ny[b]) / CELL));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.cells[y * this.cols + x].push(e);
  }

  /** First thing the step A→B runs into: the node it ends on (an old one, or a new one cut into the edge), or -1. */
  private hit(from: number, bx: number, by: number): number {
    const { nx, ny, ea, eb } = this;
    const ax = nx[from], ay = ny[from];
    const rx = bx - ax, ry = by - ay;
    const rl = Math.hypot(rx, ry);
    if (rl < 1e-9) return -1;
    const pad = 0.0005;
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad) / CELL)), x1 = Math.min(this.cols - 1, Math.floor((Math.max(ax, bx) + pad) / CELL));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by) - pad) / CELL)), y1 = Math.min(this.rows - 1, Math.floor((Math.max(ay, by) + pad) / CELL));
    const st = ++this.stampNow;
    let bt = Infinity, be = -1, bu = 0;
    const et = 0.0002 / rl;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cell = this.cells[y * this.cols + x];
      for (let k = 0; k < cell.length; k++) {
        const e = cell[k];
        if (this.stamp[e] === st) continue;
        this.stamp[e] = st;
        const c = ea[e], d = eb[e];
        if (c === from || d === from) continue;
        const sx = nx[d] - nx[c], sy = ny[d] - ny[c];
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-14) continue;
        const qx = nx[c] - ax, qy = ny[c] - ay;
        const t = (qx * sy - qy * sx) / den;
        if (t <= 1e-9 || t > 1 + et || t >= bt) continue;
        const u = (qx * ry - qy * rx) / den;
        const eu = 0.0002 / Math.hypot(sx, sy);
        if (u < -eu || u > 1 + eu) continue;
        bt = t; be = e; bu = u;
      }
    }
    if (be < 0) return -1;
    const c = ea[be], d = eb[be];
    const len = Math.hypot(nx[d] - nx[c], ny[d] - ny[c]);
    if (bu * len < SNAP) return c;
    if ((1 - bu) * len < SNAP) return d;
    // cut the edge in two at the junction; the drawn crack does not change, the new node lies on it
    const u = Math.min(1, Math.max(0, bu));
    const m = this.node(nx[c] + (nx[d] - nx[c]) * u, ny[c] + (ny[d] - ny[c]) * u, this.ox[c] + (this.ox[d] - this.ox[c]) * u, this.oy[c] + (this.oy[d] - this.oy[c]) * u);
    eb[be] = m;
    const nd = this.nbr[d]; nd[nd.indexOf(c)] = m;
    const nc = this.nbr[c]; nc[nc.indexOf(d)] = m;
    this.nbr[m].push(c, d);
    const e2 = this.ea.length;
    this.ea.push(m); this.eb.push(d); this.ekind.push(this.ekind[be]); this.stamp.push(0);
    this.gridAdd(e2);
    return m;
  }

  private link(a: number, b: number, kind: number) {
    if (a === b || this.nbr[a].includes(b)) return false;
    this.edge(a, b, kind);
    return true;
  }

  private grow(g: Grow, queue: Grow[], kind = CRACK): number {
    const { nx, ny } = this;
    const rand = this.rand;
    const id = this.paths.length;
    const path: Path = { nodes: [g.node], s: [0], times: [], parent: g.parent, parentIdx: g.parentIdx, delay: g.delay, kind, open: false, skipFirst: g.skipFirst, timed: false };
    this.paths.push(path);
    let cur = g.node, ang = g.ang, budget = g.budget, s = 0, kappa = 0;
    let slant = this.gauss() * 0.3;
    const amax = this.T * CRACKS.slant;
    let first = g.first;
    let guard = 0;
    while (budget > 1e-5 && guard++ < 4000) {
      const r = Math.hypot(nx[cur] - g.cx, ny[cur] - g.cy);
      let h = first > 0 ? first : Math.min(0.014, 0.0035 + 0.05 * r);
      first = 0;
      if (g.mode === 0) {
        kappa = kappa * 0.92 + this.gauss() * CRACKS.wander;
        ang += kappa * h + this.gauss() * 0.02;
        if (this.rand() < h * 4) ang += this.gauss() * CRACKS.kink; // a kink now and then
      } else if (g.mode === 1) {
        // around the impact, opening a little: it meets the next radial slightly further out
        const rad = Math.atan2(ny[cur] - g.cy, nx[cur] - g.cx);
        ang = rad + g.sign * (Math.PI / 2 - 0.1) + this.gauss() * 0.05;
        h = Math.min(h, Math.max(0.002, r * 0.22));
      }
      if (h > budget) h = Math.max(budget, 0.0015);
      const bx = nx[cur] + Math.cos(ang) * h, by = ny[cur] + Math.sin(ang) * h;
      const x = this.hit(cur, bx, by);
      if (x >= 0) {
        if (this.link(cur, x, kind)) {
          s += Math.hypot(nx[x] - nx[cur], ny[x] - ny[cur]);
          path.nodes.push(x); path.s.push(s);
        }
        return id;
      }
      slant = Math.max(-1, Math.min(1, slant * 0.93 + this.gauss() * 0.22));
      const n = this.node(bx, by, -Math.sin(ang) * slant * amax, Math.cos(ang) * slant * amax);
      this.owner[n] = id; this.ownerIdx[n] = path.nodes.length;
      this.edge(cur, n, kind);
      s += h; budget -= h;
      path.nodes.push(n); path.s.push(s);
      if (g.branch > 0 && budget > 0.02 && rand() < g.branch * h) {
        const side = rand() < 0.5 ? -1 : 1;
        const a = (0.2 + rand() * 0.3) * side;
        queue.push({ ...g, node: n, ang: ang + a, budget: budget * (0.3 + rand() * 0.5), parent: id, parentIdx: path.nodes.length - 1, delay: 0, first: 0, skipFirst: false, branch: g.branch * 0.7 });
        ang -= a * 0.25;
        budget *= 0.65 + rand() * 0.3;
      }
      cur = n;
    }
    path.open = true;
    this.tips.push({ node: cur, ang, cx: g.cx, cy: g.cy, path: id });
    return id;
  }

  /** Where a new shot would land in a hole that is already there. */
  inHole(x: number, y: number) {
    for (const im of this.impacts) if (Math.hypot(x - im.x, y - im.y) < im.r * 0.9) return true;
    return false;
  }

  /** A bullet at x, y. Returns the cracks to draw, each with the time its tip passes. */
  shoot(x: number, y: number, time: number, energy = 1, blunt = false): { segs: Seg[]; ticks: number[]; impact: Impact } {
    const rand = this.rand;
    const firstPath = this.paths.length;
    x = Math.min(this.W - 0.004, Math.max(0.004, x));
    y = Math.min(this.H - 0.004, Math.max(0.004, y));
    const c = this.node(x, y, 0, 0);
    const rh = CRACKS.hole * (0.9 + rand() * 0.35);
    const impact: Impact = { x, y, r: rh, time, rim: [] };
    const queue: Grow[] = [];
    const nR = blunt ? Math.max(40, CRACKS.radials) : Math.round(CRACKS.radials + rand() * CRACKS.radialsVar);
    const a0 = rand() * Math.PI * 2;
    const radials: number[] = [];
    for (let i = 0; i < nR; i++) {
      const ang = a0 + ((i + (rand() - 0.5) * 0.6) / nR) * Math.PI * 2;
      const long = rand() < (blunt ? Math.max(0.85, CRACKS.longP) : CRACKS.longP);
      // log-normal: most long ones stop within a hand's width, a few cross the pane
      const budget = long ? CRACKS.length * energy * Math.exp(this.gauss() * CRACKS.lengthVar) : 0.006 + rand() * rand() * 0.05;
      radials.push(this.grow({ node: c, ang, budget: budget + rh, mode: 0, cx: x, cy: y, sign: 1, parent: -1, parentIdx: 0, delay: 0, first: rh * (0.85 + rand() * 0.4), branch: long ? CRACKS.branch : 0, skipFirst: true }, queue));
    }
    while (queue.length) this.grow(queue.shift()!, queue);

    // the rim of the hole, from each radial to the next
    const rimNodes = radials.map((p) => this.paths[p].nodes[1]).filter((n) => n !== undefined);
    for (let i = 0; i < rimNodes.length && rimNodes.length > 2; i++) {
      const a = rimNodes[i], b = rimNodes[(i + 1) % rimNodes.length];
      if (a === b) continue;
      const x = this.hit(a, this.nx[b], this.ny[b]);
      const to = x >= 0 ? x : b;
      if (this.link(a, to, RIM)) {
        this.paths.push({ nodes: [a, to], s: [0, 1], times: [time, time], parent: -1, parentIdx: 0, delay: 0, kind: RIM, open: false, skipFirst: false, timed: true });
      }
    }
    impact.rim = rimNodes;

    // tangential cracks, dense by the hole and rare far out
    const lastRadial = this.paths.length;
    for (let p = firstPath; p < lastRadial; p++) {
      const path = this.paths[p];
      if (path.kind !== CRACK) continue;
      let next = rh * (1.5 + rand());
      for (let i = 2; i < path.nodes.length - 1; i++) {
        const n = path.nodes[i];
        const r = Math.hypot(this.nx[n] - x, this.ny[n] - y);
        if (r < next) continue;
        next = r * (1.22 + rand() * 0.5) + 0.002;
        if (rand() > CRACKS.ringsFar + CRACKS.rings * Math.exp(-r / 0.075)) continue;
        if (this.nbr[n].length > 2) continue;
        queue.push({ node: n, ang: 0, budget: r * (0.5 + rand() * 2.2), mode: 1, cx: x, cy: y, sign: rand() < 0.5 ? -1 : 1, parent: p, parentIdx: i, delay: 0.004 + rand() * 0.03, first: 0, branch: 0, skipFirst: false });
      }
    }
    while (queue.length) this.grow(queue.shift()!, queue);

    // a few tips give a little more, later: the glass ticks
    const ticks: number[] = [];
    const old = this.tips;
    this.tips = [];
    for (const tip of old) {
      if (tip.path < firstPath || rand() > 0.18 || this.nbr[tip.node].length !== 1) { this.tips.push(tip); continue; }
      const delay = 0.5 + rand() * rand() * 3.5;
      // the new path leaves its own tip
      this.grow({ node: tip.node, ang: tip.ang, budget: 0.008 + rand() * 0.04, mode: 0, cx: tip.cx, cy: tip.cy, sign: 1, parent: tip.path, parentIdx: this.paths[tip.path].nodes.length - 1, delay, first: 0, branch: 0, skipFirst: false }, queue);
      ticks.push(delay);
    }
    queue.length = 0;

    this.impacts.push(impact);
    this.stampTimes(firstPath, time, false);
    return { segs: this.segs(firstPath), ticks: ticks.map((d) => time + d), impact };
  }

  /** Every open tip runs until it meets a crack or the frame, and islands are tied to the rest. */
  /** With `standing`, nothing runs on: only the pieces the cracks already cut out are cut smaller, and the
   *  largest face, the glass still standing, is left alone. */
  finish(time: number, maxArea = 0.006, spread = 1, standing = false, gone: (loop: number[]) => boolean = () => false): Seg[] {
    const firstPath = this.paths.length;
    const tips = this.tips;
    if (!standing) this.tips = [];
    const queue: Grow[] = [];
    for (const tip of standing ? [] : tips) {
      if (this.nbr[tip.node].length !== 1) continue;
      this.grow({ node: tip.node, ang: tip.ang, budget: 10, mode: 0, cx: tip.cx, cy: tip.cy, sign: 1, parent: -2, parentIdx: 0, delay: this.rand() * 0.22 * spread, first: 0, branch: 0, skipFirst: false }, queue);
    }
    // a group of cracks that touches nothing else would be a shard inside a shard: tie it to the rest
    for (let pass = 0; pass < 30 && !standing; pass++) {
      const comp = this.components();
      const main = comp[0];
      let best = -1;
      for (let i = 4; i < comp.length; i++) if (comp[i] !== main && this.nbr[i].length && (best < 0 || this.nx[i] > this.nx[best])) best = i;
      if (best < 0) break;
      this.grow({ node: best, ang: 0, budget: 10, mode: 2, cx: this.nx[best], cy: this.ny[best], sign: 1, parent: -2, parentIdx: 0, delay: this.rand() * 0.2, first: 0, branch: 0, skipFirst: false }, queue);
    }
    // and the big pieces give way: cracks across every face larger than a hand
    for (let pass = 0; pass < 8; pass++) {
      let cut = 0;
      const loops = this.faces().filter((l) => !gone(l));
      let keep: number[] | null = null;
      if (standing) {
        let big = 0;
        for (const loop of loops) { const a = this.area(loop); if (a > big) { big = a; keep = loop; } }
      }
      for (const loop of loops) {
        if (loop === keep) continue;
        let a = 0, cx = 0, cy = 0;
        for (let i = 0; i < loop.length; i++) {
          const u = loop[i], v = loop[(i + 1) % loop.length];
          const w = this.nx[u] * this.ny[v] - this.nx[v] * this.ny[u];
          a += w; cx += (this.nx[u] + this.nx[v]) * w; cy += (this.ny[u] + this.ny[v]) * w;
        }
        a /= 2;
        if (a < maxArea * (0.6 + this.rand() * 0.8)) continue;
        cx /= 6 * a; cy /= 6 * a;
        const from = loop[Math.floor(this.rand() * loop.length)];
        const ang = Math.atan2(cy - this.ny[from], cx - this.nx[from]) + this.gauss() * 0.25;
        this.grow({ node: from, ang, budget: 10, mode: 0, cx, cy, sign: 1, parent: -2, parentIdx: 0, delay: (0.05 + pass * 0.04 + this.rand() * 0.2) * spread, first: 0, branch: 0, skipFirst: false }, queue);
        cut++;
      }
      if (!cut) break;
    }
    if (!standing) this.tips = [];
    this.stampTimes(firstPath, time, true);
    return this.segs(firstPath);
  }

  area(loop: number[]) {
    let a = 0;
    for (let i = 0; i < loop.length; i++) { const u = loop[i], v = loop[(i + 1) % loop.length]; a += this.nx[u] * this.ny[v] - this.nx[v] * this.ny[u]; }
    return a / 2;
  }

  private components() {
    const n = this.nx.length;
    const comp = new Int32Array(n).fill(-1);
    const stack: number[] = [];
    for (let i = 0; i < n; i++) {
      if (comp[i] >= 0) continue;
      comp[i] = i; stack.push(i);
      while (stack.length) {
        const u = stack.pop()!;
        for (const v of this.nbr[u]) if (comp[v] < 0) { comp[v] = i; stack.push(v); }
      }
    }
    return comp;
  }

  /** When each tip passes each node. A crack that runs into something is there in a frame or two; one that
   *  runs out of energy is as fast at first, then crawls: its last centimetres are what the eye gets. */
  private stampTimes(from: number, time: number, rush: boolean) {
    const rand = this.rand;
    for (let p = from; p < this.paths.length; p++) {
      const path = this.paths[p];
      if (path.timed) continue;
      path.timed = true;
      const parent = path.parent >= 0 ? this.paths[path.parent] : null;
      const t0 = (parent ? parent.times[Math.min(path.parentIdx, parent.times.length - 1)] : time) + path.delay;
      const L = path.s[path.s.length - 1] || 1e-6;
      const slow = path.open && !rush;
      const dur = slow ? 0.1 + L * 0.5 + rand() * 0.3 : L / 30 + 0.004;
      const pow = slow ? 4.5 : 1;
      for (let i = 0; i < path.nodes.length; i++) path.times.push(t0 + dur * Math.pow(path.s[i] / L, pow));
    }
  }

  private segs(from: number): Seg[] {
    const out: Seg[] = [];
    for (let p = from; p < this.paths.length; p++) {
      const path = this.paths[p];
      for (let i = path.skipFirst ? 1 : 0; i < path.nodes.length - 1; i++) {
        out.push({ a: path.nodes[i], b: path.nodes[i + 1], ta: path.times[i], tb: path.times[i + 1], kind: path.kind });
      }
    }
    return out;
  }

  /** The faces of the graph, each a loop of node ids, counter-clockwise. Call after finish(). */
  faces(): number[][] {
    const { nx, ny } = this;
    const n = nx.length;
    // drop dead ends: a crack that ends in clear glass bounds nothing
    const deg = this.nbr.map((l) => l.length);
    const dead = new Uint8Array(n);
    const stack: number[] = [];
    for (let i = 0; i < n; i++) if (deg[i] === 1) stack.push(i);
    while (stack.length) {
      const u = stack.pop()!;
      if (dead[u]) continue;
      dead[u] = 1;
      for (const v of this.nbr[u]) if (!dead[v] && --deg[v] === 1) stack.push(v);
    }
    const sorted: number[][] = new Array(n);
    const seen: Uint8Array[] = new Array(n);
    for (let u = 0; u < n; u++) {
      if (dead[u]) { sorted[u] = []; seen[u] = new Uint8Array(0); continue; }
      const l = this.nbr[u].filter((v) => !dead[v]);
      const ang = l.map((v) => Math.atan2(ny[v] - ny[u], nx[v] - nx[u]));
      const idx = l.map((_, i) => i).sort((a, b) => ang[a] - ang[b]);
      sorted[u] = idx.map((i) => l[i]);
      seen[u] = new Uint8Array(l.length);
    }
    const faces: number[][] = [];
    for (let u0 = 0; u0 < n; u0++) {
      for (let k0 = 0; k0 < sorted[u0].length; k0++) {
        if (seen[u0][k0]) continue;
        const loop: number[] = [];
        let u = u0, k = k0, area = 0, guard = 0;
        while (!seen[u][k] && guard++ < 100000) {
          seen[u][k] = 1;
          const v = sorted[u][k];
          loop.push(u);
          area += nx[u] * ny[v] - nx[v] * ny[u];
          // at v, turn to the next edge clockwise from the one we came by: the face stays on the left
          const lv = sorted[v];
          const j = lv.indexOf(u);
          k = (j - 1 + lv.length) % lv.length;
          u = v;
        }
        if (area > 1e-9 && loop.length >= 3) faces.push(loop);
      }
    }
    return faces;
  }
}
