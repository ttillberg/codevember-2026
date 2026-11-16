// Traffic. Cars follow lanes (deterministic paths), keep distance with IDM, obey the signal,
// yield by rank and turn, take gaps their driver accepts, change lanes, park and leave.
import { at, deck, plan, project, rng, type Lane, type Net, type Node, type Stall } from './net';
import { PAINTS, WORK_PAINTS, pick, type VType } from './vehicles';

export const DRIVE = 0, PARKING = 1, PARKED = 2, LEAVING = 3;

export interface Profile {
  vf: number; // how fast, as a share of the limit
  T: number; // headway, s
  a: number; // acceleration
  b: number; // comfortable braking
  s0: number; // standstill gap
  gap: number; // gap accepted when yielding, s
  patience: number; // s of waiting before they just go
}

export interface Car {
  id: number;
  type: number;
  slot: number;
  len: number;
  color: number;
  sx: number; sy: number; sz: number;
  prof: Profile;
  state: number;
  lane: Lane | null;
  prev: Lane | null;
  s: number;
  v: number;
  route: Lane[];
  ri: number;
  granted: Lane | null;
  goal: Lane[];
  stall: Stall | null;
  stopS: number;
  lat: number; latT: number;
  lcAt: number;
  wait: number;
  t: number;
  dwell: number;
  // pose, and the pose a park/leave move starts from
  x: number; y: number; ang: number;
  h: number; // height above the ground: on a bridge
  fx: number; fy: number; fa: number;
  fresh: boolean;
  dirty: boolean;
  why: string; // what is holding it at a junction, for debugging
}

const CYCLE = [24, 3.5, 2, 16, 3.5, 2];
const CYCLE_T = CYCLE.reduce((a, b) => a + b, 0);

/** 'G' | 'Y' | 'R' for a phase (0 east–west, 1 north–south) */
export function signal(time: number, phase: number): 'G' | 'Y' | 'R' {
  let t = time % CYCLE_T;
  for (let i = 0; i < 6; i++) {
    if (t < CYCLE[i]) {
      const mine = phase === 0 ? i < 3 : i >= 3;
      if (!mine) return 'R';
      const k = i % 3;
      return k === 0 ? 'G' : k === 1 ? 'Y' : 'R';
    }
    t -= CYCLE[i];
  }
  return 'R';
}

const P = { x: 0, y: 0, ax: 0, ay: 0 };
const Q = { x: 0, y: 0, ax: 0, ay: 0 };

export class Sim {
  cars: Car[] = [];
  time = 0;
  freed: { type: number; slot: number }[] = [];
  /** roughly how many vehicles should be out on the roads; null leaves it to the place */
  target = 0;
  /** how many are out on the roads now, the parked ones not counted */
  private rand: () => number;
  private nextId = 1;
  private slots: number[][];
  private slotTop: number[];
  private sources: { node: Node; lanes: Lane[]; rate: number; acc: number }[] = [];
  private sinks = new Map<Node, Lane[]>();

  constructor(public net: Net, public types: VType[], seed = 4) {
    this.rand = rng(seed);
    this.slots = types.map(() => []);
    this.slotTop = types.map(() => 0);
    this.wire();
    // the lots start half full
    for (const st of net.stalls) {
      if (this.rand() > 0.42) continue;
      const c = this.make(true);
      if (!c) continue;
      this.park(c, st);
      c.dwell = this.rand() * 1800;
    }
  }

  private wire() {
    const old = this.sources;
    this.sources = [];
    this.sinks.clear();
    for (const n of this.net.edges) {
      const out = this.net.lanes.filter((l) => l.road && l.from === n);
      const inn = this.net.lanes.filter((l) => l.road && l.to === n);
      const was = old.find((o) => o.node.p.x === n.p.x && o.node.p.y === n.p.y);
      this.sources.push({ node: n, lanes: out, rate: out[0].road!.rank >= 3 ? 0.3 : 0.13, acc: was ? was.acc : this.rand() });
      this.sinks.set(n, inn);
    }
  }

  /** The roads changed under the traffic. Every car finds its place in the new network and thinks again. */
  setNet(net: Net) {
    if (net === this.net) return;
    this.net = net;
    this.wire();
    // a stall survives if there is still one where it was, give or take: cutting a road shifts the row a little
    const taken = new Set<Stall>();
    const same = (old: Stall): Stall | null => {
      let best: Stall | null = null, bd = 2;
      for (const s of net.stalls) {
        if (taken.has(s)) continue;
        const d = Math.abs(s.p.x - old.p.x) + Math.abs(s.p.y - old.p.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) taken.add(best);
      return best;
    };
    const lanes = net.lanes;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const st = c.stall ? same(c.stall) : null;
      c.lane = null; c.prev = null; c.granted = null; c.lat = 0; c.latT = 0; c.wait = 0; c.why = '';
      if (c.state === PARKED || c.state === PARKING) {
        // its stall was paved over
        if (!st || st.car) { c.stall = null; this.remove(c); continue; }
        c.state = PARKED; c.stall = st; st.car = c; st.res = true;
        // keep which way it faces, take the new stall's line
        c.ang = st.ang + (Math.cos(c.ang - st.ang) < 0 ? Math.PI : 0);
        c.x = st.p.x; c.y = st.p.y; c.dirty = true;
        continue;
      }
      // the nearest lane going its way
      let best: Lane | null = null, bs = 0, bd = 7;
      const dx = Math.cos(c.ang), dy = Math.sin(c.ang);
      for (const l of lanes) {
        const s = project(l, c);
        at(l, s, P);
        const d = Math.hypot(P.x - c.x, P.y - c.y);
        if (d < bd && P.ax * dx + P.ay * dy > 0.3) { bd = d; best = l; bs = s; }
      }
      c.stall = null; c.stopS = -1;
      if (!best) { this.remove(c); continue; }
      c.state = DRIVE;
      c.lane = best; best.cars.push(c);
      c.s = Math.min(best.len - 0.05, bs + c.len / 2);
      let ok = false;
      if (st && !st.res) {
        if ((best === st.laneF && c.s < st.sF) || (best === st.laneB && c.s < st.sB)) {
          c.route = [best]; c.ri = 0; c.goal = [st.laneF, st.laneB];
          ok = true;
        } else {
          const route = plan(net, best, [st.laneF, st.laneB], c.id);
          if (route) { c.route = route; c.ri = 0; c.goal = [st.laneF, st.laneB]; ok = true; }
        }
        if (ok) {
          st.res = true; c.stall = st;
          c.stopS = c.route[c.route.length - 1] === st.laneF ? st.sF : st.sB;
        }
      }
      if (!ok && !this.setRoute(c, best, false)) this.remove(c);
    }
  }

  // ---------- making and removing ----------

  private profile(heavy: boolean): Profile {
    const r = this.rand, k = r();
    // calm, ordinary, hurried
    const m = k < 0.25 ? 0 : k < 0.8 ? 1 : 2;
    const p: Profile = {
      vf: [0.82, 0.98, 1.16][m] + (r() - 0.5) * 0.12,
      T: [2.0, 1.4, 0.9][m] + (r() - 0.5) * 0.4,
      a: [1.2, 1.7, 2.5][m] + (r() - 0.5) * 0.4,
      b: [2.0, 2.6, 3.4][m],
      s0: [2.8, 2.2, 1.6][m] + r() * 0.5,
      gap: [5.5, 4.2, 3.0][m] + (r() - 0.5),
      patience: [45, 28, 14][m] + r() * 10,
    };
    if (heavy) { p.a *= 0.55; p.vf *= 0.92; p.T += 0.4; p.gap += 1.5; }
    return p;
  }

  private make(mustPark: boolean): Car | null {
    const r = this.rand;
    let ti = 0;
    for (let tries = 0; tries < 20; tries++) {
      let x = r(), i = 0;
      for (; i < this.types.length - 1; i++) if ((x -= this.types[i].weight) <= 0) break;
      ti = i;
      if (!mustPark || this.types[ti].parks) break;
    }
    const t = this.types[ti];
    const slot = this.slots[ti].length ? this.slots[ti].pop()! : this.slotTop[ti] < t.cap ? this.slotTop[ti]++ : -1;
    if (slot < 0) return null;
    const j = 0.94 + r() * 0.12;
    const c: Car = {
      id: this.nextId++, type: ti, slot, len: t.len * j, color: pick(t.heavy || t.name === 'van' ? WORK_PAINTS : PAINTS, r()),
      sx: j, sy: 0.96 + r() * 0.08, sz: 0.97 + r() * 0.06,
      prof: this.profile(t.heavy), state: DRIVE, lane: null, prev: null, s: 0, v: 0, route: [], ri: 0, granted: null,
      goal: [], stall: null, stopS: -1, lat: 0, latT: 0, lcAt: 0, wait: 0, t: 0, dwell: 0,
      x: 0, y: 0, ang: 0, h: 0, fx: 0, fy: 0, fa: 0, fresh: true, dirty: true, why: '',
    };
    this.cars.push(c);
    return c;
  }

  private remove(c: Car) {
    if (c.lane) this.leaveLane(c);
    if (c.stall) { c.stall.res = false; if (c.stall.car === c) c.stall.car = null; }
    this.slots[c.type].push(c.slot);
    this.freed.push({ type: c.type, slot: c.slot });
    const i = this.cars.indexOf(c);
    this.cars[i] = this.cars[this.cars.length - 1];
    this.cars.pop();
  }

  private leaveLane(c: Car) {
    const l = c.lane!;
    const i = l.cars.indexOf(c);
    if (i >= 0) l.cars.splice(i, 1);
    if (c.granted) {
      const res = c.granted.conn!.reserved;
      const k = res.indexOf(c);
      if (k >= 0) res.splice(k, 1);
      c.granted = null;
    }
    c.lane = null;
  }

  private park(c: Car, st: Stall) {
    c.state = PARKED;
    c.stall = st;
    st.car = c; st.res = true;
    // nose in, or backed in now and then
    c.x = st.p.x; c.y = st.p.y; c.ang = st.ang + (this.rand() < 0.12 ? Math.PI : 0) + (this.rand() - 0.5) * 0.05;
    c.dirty = true;
  }

  // ---------- routes ----------

  private setRoute(c: Car, from: Lane, toStall: boolean): boolean {
    let goals: Lane[] = [];
    let st: Stall | null = null;
    if (toStall) {
      const free = this.net.stalls;
      for (let k = 0; k < 12 && !st; k++) {
        const s = free[(this.rand() * free.length) | 0];
        if (!s.res) st = s;
      }
    }
    if (st) goals = [st.laneF, st.laneB];
    else {
      const ends = this.net.edges.filter((n) => n !== from.from);
      // most traffic stays on the arterial
      const w = ends.map((n) => (n.roads[0].rank >= 3 ? 3 : 1));
      let x = this.rand() * w.reduce((a, b) => a + b, 0), i = 0;
      for (; i < ends.length - 1; i++) if ((x -= w[i]) <= 0) break;
      goals = this.sinks.get(ends[i])!;
    }
    const route = plan(this.net, from, goals, c.id);
    if (!route) return false;
    c.route = route; c.ri = 0; c.goal = goals;
    if (c.stall && c.stall !== st && c.state === DRIVE) c.stall.res = false;
    c.stall = st; c.stopS = -1;
    if (st) {
      st.res = true;
      const last = route[route.length - 1];
      c.stopS = last === st.laneF ? st.sF : st.sB;
    }
    return true;
  }

  // ---------- one step ----------

  step(dt: number) {
    this.time += dt;
    const r = this.rand;

    let out = 0;
    for (const c of this.cars) if (c.state !== PARKED) out++;
    // asked for a number, the ways in open up or shut until about that many are out
    const flow = out >= this.target ? 0 : Math.min(8, 0.4 + 10 * (1 - out / this.target));
    for (const src of this.sources) {
      src.acc += flow * src.rate * dt * (0.75 + 0.5 * Math.sin(this.time * 0.021 + src.node.id));
      if (src.acc < 1) continue;
      const lane = src.lanes[(r() * src.lanes.length) | 0];
      let clear = true;
      for (const o of lane.cars) if (o.s - o.len < 12) clear = false;
      if (!clear) { src.acc = Math.min(src.acc, 3); continue; }
      const c = this.make(false);
      if (!c) continue;
      src.acc -= 1;
      const wantsStall = this.types[c.type].parks && r() < 0.18;
      if (!this.setRoute(c, lane, wantsStall)) { this.remove(c); continue; }
      c.lane = lane; lane.cars.push(c);
      c.s = c.len; c.v = lane.speed * 0.8; c.lcAt = 8 + r() * 40;
    }

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.state === PARKED) {
        c.dwell -= dt;
        if (c.dwell <= 0) this.tryLeave(c);
      } else if (c.state === PARKING) {
        c.t += dt / 3.2;
        this.movePose(c, c.stall!.p.x, c.stall!.p.y, c.stall!.ang);
        if (c.t >= 1) {
          this.leaveLane(c);
          const st = c.stall!;
          this.park(c, st);
          c.ang = st.ang;
          c.dwell = 120 + -Math.log(1 - r()) * 700;
        }
      } else if (c.state === LEAVING) {
        c.t += dt / 4;
        this.lanePose(c);
        const tx = c.x, ty = c.y, ta = c.ang;
        this.movePose(c, tx, ty, ta);
        if (c.t >= 1) { c.state = DRIVE; c.x = tx; c.y = ty; c.ang = ta; }
      } else this.drive(c, dt);
    }
  }

  private movePose(c: Car, tx: number, ty: number, ta: number) {
    const t = Math.min(1, c.t), e = t * t * (3 - 2 * t);
    let da = ta - c.fa;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    // turn first, then slide in: reads as steering
    const ea = Math.min(1, e * 1.5);
    c.x = c.fx + (tx - c.fx) * e; c.y = c.fy + (ty - c.fy) * e; c.ang = c.fa + da * ea;
    c.dirty = true;
  }

  private tryLeave(c: Car) {
    const st = c.stall!;
    const fake = st.laneF;
    const ends = this.net.edges;
    const goals = this.sinks.get(ends[(this.rand() * ends.length) | 0])!;
    const ra = plan(this.net, st.laneF, goals, c.id);
    const rb = plan(this.net, st.laneB, goals, c.id + 1);
    const useF = !rb || (ra && ra.length <= rb.length);
    const route = useF ? ra : rb;
    if (!route) { c.dwell = 20; return; }
    const lane = useF ? fake : st.laneB;
    const s = (useF ? st.sF : st.sB) + 1.5;
    for (const l of [st.laneF, st.laneB]) {
      const sl = l === st.laneF ? st.sF : st.sB;
      for (const o of l.cars) if (o.s > sl - 10 && o.s - o.len < sl + 7) { c.dwell = 2 + this.rand() * 3; return; }
    }
    st.car = null; st.res = false;
    c.stall = null; c.stopS = -1;
    c.route = route; c.ri = 0; c.goal = goals;
    c.lane = lane; lane.cars.push(c); c.prev = null;
    c.s = Math.min(lane.len - 0.5, s + c.len / 2); c.v = 0;
    c.fx = c.x; c.fy = c.y; c.fa = c.ang;
    c.state = LEAVING; c.t = 0; c.lcAt = 0; c.wait = 0;
  }

  private gapAhead(c: Car, out: { gap: number; v: number }) {
    const L = c.lane!;
    let gap = Infinity, lv = 0;
    for (const o of L.cars) {
      if (o === c) continue;
      if (o.s > c.s || (o.s === c.s && o.id < c.id)) {
        const g = o.s - o.len - c.s;
        if (g < gap) { gap = g; lv = o.v; }
      }
    }
    if (gap === Infinity) {
      let d = L.len - c.s;
      let prev = L;
      for (let i = c.ri + 1; i < c.route.length && d < 90; i++) {
        const n = c.route[i];
        if (n.road && n.road === prev.road && n.dir === prev.dir) break; // a lane change, not a continuation
        let tail = Infinity, tv = 0;
        for (const o of n.cars) {
          const rear = o.s - o.len;
          if (rear < tail) { tail = rear; tv = o.v; }
        }
        if (tail < Infinity) { gap = d + tail; lv = tv; break; }
        d += n.len;
        prev = n;
      }
    }
    out.gap = gap; out.v = lv;
  }

  private idm(c: Car, v0: number, gap: number, lv: number) {
    const p = c.prof;
    const free = Math.max(-2, 1 - Math.pow(c.v / v0, 4));
    let inter = 0;
    if (gap < 1e6) {
      const ss = p.s0 + Math.max(0, c.v * p.T + (c.v * (c.v - lv)) / (2 * Math.sqrt(p.a * p.b)));
      const q = ss / Math.max(gap, 0.2);
      inter = q * q;
    }
    return Math.max(-9, p.a * (free - inter));
  }

  private yields(a: Lane, b: Lane) {
    const A = a.conn!, B = b.conn!;
    const ra = A.src.road!.rank, rb = B.src.road!.rank;
    if (ra !== rb) return ra < rb;
    if (A.turn !== 'T' && B.turn === 'T') return true;
    return A.turn === 'L' && B.turn === 'R';
  }

  private no(c: Car, why: string) {
    c.why = why;
    return false;
  }

  private tryGrant(c: Car, conn: Lane): boolean {
    const info = conn.conn!;
    const L = c.lane!;
    // nobody jumps the queue
    for (const o of L.cars) if (o !== c && o.s > c.s && o.granted === null) return this.no(c, 'queue');
    if (info.node.signal) {
      const st = signal(this.time + info.node.sigOff, info.phase);
      if (st === 'R') return this.no(c, 'red');
      // a waiting left turn sneaks through on yellow
      if (st === 'Y' && !(info.turn === 'L' && c.wait > 2)) return this.no(c, 'yellow');
    }
    // don't block the box: only go if the lane beyond is sure to have room, whatever happens there
    const dst = info.dst;
    let used = 0;
    for (const o of dst.cars as Car[]) used += o.len + 2.5;
    for (const k of dst.inc) {
      for (const o of k.cars as Car[]) used += o.len + 2.5;
      for (const o of k.conn!.reserved as Car[]) used += o.len + 2.5;
    }
    // a lane shorter than a car takes one at a time
    // but whoever is on a roundabout keeps going round: if each waited for room ahead, a full ring would never move again
    const round = info.src.road!.ring && dst.road!.ring;
    if (!round && (dst.len <= 14 ? used > 0 : used + c.len + 2.5 > dst.len - 1)) return this.no(c, 'box');
    for (const k of info.conflicts) {
      const D = k.o, di = D.conn!;
      if (di.reserved.length) return this.no(c, 'reserved by ' + (di.reserved[0] as Car).id);
      for (const o of D.cars) if (o.s - o.len < k.sOther + 1.5) return this.no(c, 'crossing ' + o.id);
      if (c.wait < c.prof.patience && this.yields(conn, D)) {
        if (info.node.signal && signal(this.time + info.node.sigOff, di.phase) === 'R') continue;
        const src = di.src;
        for (const o of src.cars as Car[]) {
          if (o.route[o.ri + 1] !== D) continue;
          // stuck behind someone who is not going anywhere: no threat
          let stuck = false;
          for (const q of src.cars as Car[]) if (q !== o && q.s > o.s && q.granted === null && q.v < 1) { stuck = true; break; }
          if (stuck) continue;
          if ((src.len - o.s) / Math.max(o.v, 4) < c.prof.gap) return this.no(c, 'yield');
        }
      }
    }
    info.reserved.push(c);
    c.granted = conn;
    c.why = '';
    return true;
  }

  private tryChange(c: Car, T: Lane): boolean {
    const L = c.lane!;
    const sT = Math.min(T.len - 0.1, (c.s / L.len) * T.len);
    for (const o of T.cars as Car[]) {
      if (o.s >= sT) {
        if (o.s - o.len - sT < 1.5 + 0.25 * c.v) return false;
      } else if (sT - c.len - o.s < 1.5 + Math.max(0, o.v - c.v) * 2 + 0.3 * o.v) return false;
    }
    const lw = L.road!.lw;
    this.leaveLane(c);
    c.lane = T; T.cars.push(c);
    c.s = sT;
    c.lat = (L.idx - T.idx) * lw; c.latT = 1;
    c.ri++;
    c.prev = null;
    c.lcAt = c.s + 10 + this.rand() * 30;
    return true;
  }

  private drive(c: Car, dt: number) {
    const L = c.lane!;
    const p = c.prof;
    const nxt = c.route[c.ri + 1] as Lane | undefined;
    let v0 = L.speed * (L.speed < 8 ? Math.min(p.vf, 1.05) : p.vf);
    const toEnd = L.len - c.s;
    if (nxt && nxt.speed < v0 && toEnd < (c.v * c.v - nxt.speed * nxt.speed) / 3.6 + 4) v0 = nxt.speed * Math.min(p.vf, 1.1);

    const g = G;
    this.gapAhead(c, g);
    let acc = this.idm(c, v0, g.gap, g.v);

    let stop = Infinity;
    if (nxt) {
      if (nxt.conn) {
        if (c.granted !== nxt) {
          const X = (c.v * c.v) / 5 + c.v * 1.2 + 6;
          if (toEnd > X || !this.tryGrant(c, nxt)) stop = L.len - 0.3;
        }
      } else if (nxt.road && nxt.road === L.road) {
        // a lane change the route needs
        if (c.s >= Math.min(c.lcAt, L.len - 12) && this.tryChange(c, nxt)) return;
        stop = L.len - 2;
        if (c.wait > p.patience) {
          // give up: take whatever this lane allows and work it out from there
          const alt = plan(this.net, L, c.goal, c.id + 7, true);
          if (alt) {
            c.route = alt; c.ri = 0;
            if (c.stall) { const last = alt[alt.length - 1]; c.stopS = last === c.stall.laneF ? c.stall.sF : c.stall.sB; }
          }
          c.wait = 0;
        }
      }
    } else if (c.stall) {
      stop = c.stopS;
      if (c.s > c.stopS - 1.2 && c.v < 0.8) {
        this.lanePose(c);
        c.fx = c.x; c.fy = c.y; c.fa = c.ang;
        c.state = PARKING; c.t = 0; c.v = 0;
        return;
      }
    }
    if (stop < Infinity) acc = Math.min(acc, this.idm(c, v0, stop - c.s + p.s0, 0));

    c.v = Math.max(0, c.v + acc * dt);
    c.s += c.v * dt;
    if (c.v < 0.5) c.wait += dt; else if (c.v > 3) c.wait = 0;
    if (c.latT > 0) c.latT = Math.max(0, c.latT - dt / 2.6);

    if (c.s >= L.len) {
      if (!nxt) {
        if (c.stall) { c.s = L.len - 0.01; c.v = 0; }
        else { this.remove(c); return; }
      } else if (nxt.conn && c.granted !== nxt) {
        c.s = L.len - 0.01; c.v = 0;
      } else if (!nxt.conn && nxt.road && nxt.road === L.road) {
        c.s = L.len - 0.01; c.v = 0;
      } else {
        const over = c.s - L.len;
        const i = L.cars.indexOf(c);
        if (i >= 0) L.cars.splice(i, 1);
        if (c.granted === nxt) {
          const res = nxt.conn!.reserved;
          const k = res.indexOf(c);
          if (k >= 0) res.splice(k, 1);
          c.granted = null;
        }
        c.prev = L; c.lane = nxt; nxt.cars.push(c);
        c.s = over; c.ri++;
        c.lcAt = 8 + this.rand() * 40;
      }
    }
    this.lanePose(c);
    c.dirty = true;
  }

  /** Pose from the two axles, so a long vehicle sweeps a corner properly. */
  private lanePose(c: Car) {
    const L = c.lane!;
    const sf = c.s - c.len * 0.18, sr = c.s - c.len * 0.82;
    if (sf < 0 && c.prev) at(c.prev, c.prev.len + sf, P); else at(L, sf, P);
    if (sr < 0 && c.prev) at(c.prev, c.prev.len + sr, Q); else at(L, sr, Q);
    let x = (P.x + Q.x) / 2, y = (P.y + Q.y) / 2;
    let ang = Math.atan2(P.y - Q.y, P.x - Q.x);
    if (c.latT > 0) {
      const e = c.latT * c.latT * (3 - 2 * c.latT);
      x += -P.ay * c.lat * e; y += P.ax * c.lat * e;
      ang += Math.sign(c.lat) * -0.1 * Math.sin(Math.PI * c.latT);
    }
    c.x = x; c.y = y; c.ang = ang;
    // through a junction it is as high as the junction; on a road, as high as the deck where it is.
    // A lane the other way runs from the far end of its road
    const d = c.s - c.len / 2 + L.from.trim;
    c.h = !L.road ? L.from.z : L.road.bridge ? deck(L.road, L.dir === 1 ? d : L.road.len - d) : 0;
  }
}

const G = { gap: 0, v: 0 };
