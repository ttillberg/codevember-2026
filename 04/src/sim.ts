// Traffic. Cars follow lanes (deterministic paths), keep distance with IDM, obey the signal,
// yield by rank and turn, take gaps their driver accepts, change lanes, park and leave.
// Now and then an emergency vehicle crosses the town in a hurry, and a stretch of road is dug up for a while.
import { at, deck, plan, project, rng, type Lane, type Net, type Node, type Road, type Stall } from './net';
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
  siren: boolean; // an emergency vehicle on a call
  dodge: number; // when it may next try to pull out round what is in its way
}

/** Road works: one lane coned off for a stretch, or a whole road closed. */
export interface Site {
  kind: 'lane' | 'road';
  /** where it is and which way the lane runs there: what it is found by again when the roads change */
  x: number; y: number; ax: number; ay: number;
  /** metres of lane coned off */
  span: number;
  until: number;
  /** the lane that is coned off, from s0 to s1 */
  lane: Lane | null; s0: number; s1: number;
  /** the road that is closed, and its lanes */
  road: Road | null; lanes: Lane[];
  /** whoever was inside has driven out: the cones are up */
  live: boolean;
  seed: number;
}

/** How much faster than the limit an emergency vehicle drives. */
const HURRY = 1.6;
/** Metres before a junction from which it has the signal for itself, and the seconds it may stand still before it gives that up. */
const CLEAR = 160, STUCK = 6;
/** Seconds of the traffic's time between two calls, at least and at most. */
const CALL = [900, 2700];
/** How fast the traffic goes past road works, m/s. */
const PAST = 6;
/** Seconds a site lasts, and seconds until the next one opens. */
const LASTS = [4000, 9000], NEXT = [300, 1500];
/** Metres of lane left free before the cones and after them, to merge in. */
const LEAD = 30, AFTER = 35;
/** How many sites there are at a time, at most. */
const SITES = 2;
/** The middle of the map: works open within sight of it if they can. */
const MID = { x: 0, y: -10 }, SIGHT = 330;

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
  /** How much of the night's quiet there is, 0 by day and 1 from nine at night to half past five: the big roads stay busy, the small ones empty. */
  quiet = 0;
  /** What became of every try to send someone in, since the count was last read: in, way in not clear, no vehicle to be had, no way through. */
  tally = { sent: 0, blocked: 0, none: 0, lost: 0 };
  /** how many are out on the roads now, the parked ones not counted */
  private rand: () => number;
  private nextId = 1;
  private slots: number[][];
  private slotTop: number[];
  private sources: { node: Node; lanes: Lane[]; rate: number; acc: number }[] = [];
  private sinks = new Map<Node, Lane[]>();
  /** the road works there are now, and a number that goes up whenever they change, for whoever draws them */
  works: Site[] = [];
  worksRev = 0;
  /** both can be switched off, to measure the traffic without them */
  perks = { rescue: true, works: true };
  // the calls and the works draw their own lots, so the ordinary traffic gets the same ones with or without them
  private perk: () => number;
  private rescue: number[] = [];
  private common: number;
  private callAt: number;
  private calls = 0;
  private digAt: number;
  private digs = 0;
  private tended = 0;

  constructor(public net: Net, public types: VType[], seed = 4) {
    this.rand = rng(seed);
    this.perk = rng(seed + 17);
    this.slots = types.map(() => []);
    this.slotTop = types.map(() => 0);
    types.forEach((t, i) => t.siren && this.rescue.push(i));
    this.common = types.filter((t) => t.weight > 0).length;
    this.callAt = 240 + this.perk() * 600;
    this.digAt = 60 + this.perk() * 180;
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

  /** Ground that was not there before (the window of tiles moved on): its lots start half full, as the first ones did. */
  fill(fresh: (p: { x: number; y: number }) => boolean) {
    for (const st of this.net.stalls) {
      if (st.car || st.res || !fresh(st.p) || this.rand() > 0.42) continue;
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
    // the works are found again where they were, before anyone plans a way: one whose road is gone, or no longer fit, is dropped
    for (let i = this.works.length - 1; i >= 0; i--) if (!this.place(this.works[i], false)) this.works.splice(i, 1);
    this.worksRev++;
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
    // the box round each lane: one that is out of reach is not worth finding the nearest point of
    const box = new Float64Array(lanes.length * 4);
    lanes.forEach((l, k) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of l.pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      box.set([x0, y0, x1, y1], k * 4);
    });
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
      for (let k = 0; k < lanes.length; k++) {
        // (a point found on a stretch of no length may lie a metre past it)
        const bx = Math.max(box[k * 4] - c.x, c.x - box[k * 4 + 2], 0), by = Math.max(box[k * 4 + 1] - c.y, c.y - box[k * 4 + 3], 0);
        if (Math.hypot(bx, by) > bd + 2) continue;
        const l = lanes[k];
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

  private make(mustPark: boolean, type = -1): Car | null {
    const r = this.rand;
    let ti = type;
    for (let tries = 0; tries < 20 && type < 0; tries++) {
      let x = r(), i = 0;
      for (; i < this.common - 1; i++) if ((x -= this.types[i].weight) <= 0) break;
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
      x: 0, y: 0, ang: 0, h: 0, fx: 0, fy: 0, fa: 0, fresh: true, dirty: true, why: '', siren: false, dodge: 0,
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
    this.revoke(c);
    c.lane = null;
  }

  /** It no longer has the junction ahead for itself, and has to ask again. */
  private revoke(c: Car) {
    if (!c.granted) return;
    const res = c.granted.conn!.reserved;
    const k = res.indexOf(c);
    if (k >= 0) res.splice(k, 1);
    c.granted = null;
  }

  /**
   * Whoever is behind this one in its lane asks again too: one that keeps the junction while the one in front of it
   * has to wait for room beyond, room that its own claim is taking, would stand there for good.
   */
  private revokeBehind(c: Car) {
    for (const o of c.lane!.cars as Car[]) if (o !== c && o.s < c.s) this.revoke(o);
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
    if (toStall && this.net.stalls.length) {
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
    const q = this.quiet, target = this.target * (1 - 0.2 * q);
    const flow = out >= target ? 0 : Math.min(8, 0.4 + 10 * (1 - out / target));
    for (const src of this.sources) {
      // at night the big roads are as busy as ever; hardly anyone comes in by a small one
      const hush = 1 - (src.lanes[0].road!.rank >= 3 ? 0 : 0.93) * q;
      src.acc += hush * flow * src.rate * dt * (0.75 + 0.5 * Math.sin(this.time * 0.021 + src.node.id));
      if (src.acc < 1) continue;
      const lane = src.lanes[(r() * src.lanes.length) | 0];
      let clear = true;
      for (const o of lane.cars) if (o.s - o.len < 12) clear = false;
      if (!clear) { src.acc = Math.min(src.acc, 3); this.tally.blocked++; continue; }
      const c = this.make(false);
      if (!c) { this.tally.none++; continue; }
      src.acc -= 1;
      const wantsStall = this.types[c.type].parks && r() < 0.18;
      if (!this.setRoute(c, lane, wantsStall)) { this.remove(c); this.tally.lost++; continue; }
      this.tally.sent++;
      c.lane = lane; lane.cars.push(c);
      c.s = c.len; c.v = lane.speed * 0.8; c.lcAt = 8 + r() * 40;
    }

    if (this.perks.rescue && this.time >= this.callAt) {
      // a way in that is not clear this moment is tried again the next
      this.callAt = this.time + (this.dispatch() ? CALL[0] + this.perk() * (CALL[1] - CALL[0]) : 3);
    }
    if (this.time - this.tended >= 1 || this.time < this.tended) { this.tended = this.time; this.tend(); }

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.state === PARKED) {
        c.dwell -= dt;
        // and whoever is parked for the night mostly stays parked
        if (c.dwell <= 0) { if (q > 0 && r() < q * 0.9) c.dwell = 60 + r() * 240; else this.tryLeave(c); }
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
    // an emergency vehicle is coming up this lane: the lights let it through, and whoever is in front of it
    const rushed = this.time - (L.rush ?? -9) < 0.5;
    if (info.node.signal && !rushed) {
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
      if (rushed) continue;
      // and whoever would cross its way waits until it is through
      if (this.time - (di.src.rush ?? -9) < 0.5) return this.no(c, 'siren');
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

  /** Is there room for it beside itself in lane T, at sT. `push` is someone who has waited at the cones: a smaller gap will do. */
  private room(c: Car, T: Lane, sT: number, push = false): boolean {
    // nobody moves over into a coned-off lane until the works are behind
    const d = T.dig;
    if (d && d.closed && sT - c.len < d.s1 + 2) return false;
    for (const o of T.cars as Car[]) {
      if (o.s >= sT) {
        if (o.s - o.len - sT < (push ? 1 : 1.5 + 0.25 * c.v)) return false;
      } else if (sT - c.len - o.s < (push ? 1 + Math.max(0, o.v - c.v) * 1.2 : 1.5 + Math.max(0, o.v - c.v) * 2 + 0.3 * o.v)) return false;
    }
    return true;
  }

  /** Move over into lane T. With `route` it is not a change its way asked for: it goes on from there by this one. */
  private change(c: Car, T: Lane, sT: number, route?: Lane[]) {
    const L = c.lane!;
    const lw = L.road!.lw;
    this.leaveLane(c);
    c.lane = T; T.cars.push(c);
    c.s = sT;
    c.lat = (L.idx - T.idx) * lw; c.latT = 1;
    if (route) {
      c.route = route; c.ri = 0;
      if (c.stall) { const last = route[route.length - 1]; c.stopS = last === c.stall.laneF ? c.stall.sF : c.stall.sB; }
    } else c.ri++;
    this.revokeBehind(c);
    c.prev = null;
    c.lcAt = c.s + 10 + this.rand() * 30;
  }

  private tryChange(c: Car, T: Lane): boolean {
    const L = c.lane!;
    const sT = Math.min(T.len - 0.1, (c.s / L.len) * T.len);
    if (!this.room(c, T, sT)) return false;
    this.change(c, T, sT);
    return true;
  }

  /**
   * Pull out into the lane beside it and find the way from there: round the cones, or round whoever is in the way of a siren.
   * `ahead` is how many metres of free road the other lane must have to be worth it.
   */
  private sidestep(c: Car, ahead = 0): boolean {
    const L = c.lane!;
    for (const T of L.sib) {
      if (T.shut) continue;
      const sT = Math.min(T.len - 0.1, (c.s / L.len) * T.len);
      if (!this.room(c, T, sT, c.wait > 2)) continue;
      if (ahead > 0) {
        let free = Infinity;
        for (const o of T.cars as Car[]) if (o.s >= sT) free = Math.min(free, o.s - o.len - sT);
        if (free < ahead) continue;
      }
      // from the other lane if there is a way from it, or else back into this one further on
      const alt = c.goal.includes(T) ? [T] : plan(this.net, T, c.goal, c.id) ?? [T, ...c.route.slice(c.ri)];
      if (ahead > 0 && alt[1] === L) continue;
      this.change(c, T, sT, alt);
      return true;
    }
    return false;
  }

  private drive(c: Car, dt: number) {
    const L = c.lane!;
    const p = c.prof;
    const nxt = c.route[c.ri + 1] as Lane | undefined;
    let v0 = L.speed * (L.speed < 8 && !c.siren ? Math.min(p.vf, 1.05) : p.vf);
    const toEnd = L.len - c.s;
    if (nxt && nxt.speed < v0 && toEnd < (c.v * c.v - nxt.speed * nxt.speed) / 3.6 + 4) v0 = nxt.speed * Math.min(p.vf, c.siren ? 1.3 : 1.1);

    // road works: out of the lane that is coned off before the cones, and slowly past them in the others
    const dig = L.dig;
    let cone = Infinity;
    if (dig) {
      if (!dig.closed) {
        if (c.s > dig.s0 - 15 - (c.v * c.v) / 4 && c.s - c.len < dig.s1) v0 = Math.min(v0, PAST);
      } else if (c.s < dig.s0) {
        if (dig.s0 - c.s < 110 && this.time >= c.dodge) {
          if (this.sidestep(c)) return;
          c.dodge = this.time + 0.5;
        }
        cone = dig.s0 - 1;
      }
    }

    const g = G;
    this.gapAhead(c, g);
    let acc = this.idm(c, v0, g.gap, g.v);

    if (c.siren && L.road) {
      // the junction ahead is told that it is coming; one that is stuck for good stops asking, or nothing would ever move again
      if (toEnd < CLEAR && c.wait < STUCK) L.rush = this.time;
      // and it pulls out round whoever is slow in front of it
      if (g.gap < 12 + c.v * 2 && g.v < v0 * 0.7 && toEnd > 25 && this.time >= c.dodge) {
        if (this.sidestep(c, g.gap + 20)) return;
        c.dodge = this.time + 1;
      }
    }

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
    if (cone < stop) stop = cone;
    if (stop < Infinity) acc = Math.min(acc, this.idm(c, v0, stop - c.s + p.s0, 0));

    c.v = Math.max(0, c.v + acc * dt);
    c.s += c.v * dt;
    if (c.s > cone) { c.s = cone; c.v = 0; }
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

  // ---------- emergency vehicles ----------

  /** Send an emergency vehicle across the town now: in at one end of the map and out at another, an ambulance, a fire engine and a police car in turn. */
  dispatch(): boolean {
    const r = this.perk, n = this.sources.length;
    if (!this.rescue.length || n < 2) return false;
    // from any way in that is clear this moment, starting with one drawn by lot
    for (let k = 0, k0 = (r() * n) | 0; k < n; k++) {
      const src = this.sources[(k0 + k) % n], lane = src.lanes[0];
      let clear = true;
      for (const o of lane.cars as Car[]) if (o.s - o.len < 14) clear = false;
      if (!clear) continue;
      // to the further end rather than the one next door
      let goal = src.node, x = 0;
      for (const e of this.net.edges) if (e !== src.node) x += (e.p.x - src.node.p.x) ** 2 + (e.p.y - src.node.p.y) ** 2;
      x *= r();
      for (const e of this.net.edges) {
        if (e === src.node) continue;
        goal = e;
        if ((x -= (e.p.x - src.node.p.x) ** 2 + (e.p.y - src.node.p.y) ** 2) <= 0) break;
      }
      const goals = this.sinks.get(goal)!;
      const route = plan(this.net, lane, goals, this.calls);
      if (!route) continue;
      const c = this.make(false, this.rescue[this.calls % this.rescue.length]);
      if (!c) return false;
      this.calls++;
      c.siren = true;
      // every part of it has its own paint
      c.color = 0xffffff;
      c.prof = { vf: HURRY, T: 0.7, a: 3.2, b: 4, s0: 2, gap: 2.5, patience: 6 };
      c.route = route; c.ri = 0; c.goal = goals;
      c.lane = lane; lane.cars.push(c);
      c.s = c.len; c.v = lane.speed; c.lcAt = 8 + r() * 40;
      return true;
    }
    return false;
  }

  // ---------- road works ----------

  /** Can a stretch of this lane be coned off: the kerb lane of a road with another lane beside it, long enough to merge before and after. */
  private laneOk(l: Lane, span: number) {
    const r = l.road;
    return !!r && !r.bridge && !r.ring && !r.one && r.lanes >= 2 && l.idx === r.lanes - 1 && !r.stallSegs.length && l.len >= span + LEAD + AFTER && !l.shut && !l.dig;
  }

  /**
   * Can this road be closed, before asking whether there is another way: a back street, not a way in or somebody's parking.
   * Not a bigger street either: what it carries does not fit down the lanes around it, and they lock up.
   */
  private roadOk(r: Road) {
    return !r.bridge && !r.ring && !r.one && r.rank === 1 && !r.stallSegs.length && r.len - r.a.trim - r.b.trim >= 60 && !r.a.stub && !r.b.stub;
  }

  private open(l: Lane) {
    return !l.shut && !(l.conn && (l.conn.src.shut || l.conn.dst.shut));
  }

  /** The lanes that can be reached from these, or from which these can be reached, driving only where it is open. */
  private reach(seeds: Lane[], back: boolean): Uint8Array {
    const seen = new Uint8Array(this.net.lanes.length), q: Lane[] = [];
    for (const l of seeds) if (this.open(l) && !seen[l.id]) { seen[l.id] = 1; q.push(l); }
    while (q.length) {
      const l = q.pop()!;
      for (const m of back ? (l.conn ? [l.conn.src] : l.inc) : l.next) if (!seen[m.id] && this.open(m)) { seen[m.id] = 1; q.push(m); }
      for (const m of l.sib) if (!seen[m.id] && this.open(m)) { seen[m.id] = 1; q.push(m); }
    }
    return seen;
  }

  /**
   * Close a road if there is another way for everybody: every lane that could be reached from a way in still can,
   * and every lane from which a way out could be reached still has one. Leaves it closed if so.
   */
  private shut(lanes: Lane[]): boolean {
    const ends: [Lane[], boolean][] = [];
    for (const src of this.sources) ends.push([src.lanes, false]);
    for (const inn of this.sinks.values()) ends.push([inn, true]);
    const before = ends.map(([l, back]) => this.reach(l, back));
    for (const l of lanes) l.shut = true;
    for (let i = 0; i < ends.length; i++) {
      const after = this.reach(ends[i][0], ends[i][1]);
      for (const m of this.net.lanes) {
        if (!before[i][m.id] || after[m.id] || !this.open(m)) continue;
        for (const l of lanes) l.shut = false;
        return false;
      }
    }
    return true;
  }

  /** Whoever was on a way through a road that has just closed finds another. */
  private detour() {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i], L = c.lane;
      if (!L || (c.state !== DRIVE && c.state !== LEAVING)) continue;
      // already on it, or turning into it: it drives out the far end
      if (L.shut || (L.conn && L.conn.dst.shut)) continue;
      let through = false;
      for (let k = c.ri + 1; k < c.route.length; k++) if (c.route[k].shut) { through = true; break; }
      if (!through) continue;
      if (c.granted) {
        this.revoke(c);
        this.revokeBehind(c);
      }
      const alt = plan(this.net, L, c.goal, c.id);
      if (alt) {
        c.route = alt; c.ri = 0;
        if (c.stall) { const last = alt[alt.length - 1]; c.stopS = last === c.stall.laneF ? c.stall.sF : c.stall.sB; }
      } else if (c.siren || !this.setRoute(c, L, false)) this.remove(c);
    }
  }

  /** Put a site on the network as it is now, at the place it remembers. False if nothing there will take it. */
  private place(w: Site, replan: boolean): boolean {
    let best: Lane | null = null, bs = 0, bd = 12;
    for (const l of this.net.lanes) {
      if (!l.road || l.dig || l.shut || !(w.kind === 'lane' ? this.laneOk(l, w.span) : l.idx === 0 && this.roadOk(l.road))) continue;
      const s = project(l, w);
      at(l, s, P);
      const d = Math.hypot(P.x - w.x, P.y - w.y);
      if (d < bd && P.ax * w.ax + P.ay * w.ay > 0.5) { bd = d; best = l; bs = s; }
    }
    if (!best) return false;
    const r = best.road!;
    const lanes = this.net.lanes.filter((l) => l.road === r && (w.kind === 'road' || l.dir === best!.dir));
    if (lanes.some((l) => l.dig || l.shut)) return false;
    if (w.kind === 'lane') {
      const s0 = Math.max(LEAD, Math.min(best.len - AFTER - w.span, bs - w.span / 2)), s1 = s0 + w.span;
      for (const l of lanes) l.dig = { s0: (s0 / best.len) * l.len, s1: (s1 / best.len) * l.len, closed: l === best };
      w.lane = best; w.s0 = s0; w.s1 = s1; w.road = null;
      at(best, (s0 + s1) / 2, P);
    } else {
      if (!this.shut(lanes)) return false;
      w.road = r; w.lane = null;
      at(best, best.len / 2, P);
      if (replan) this.detour();
    }
    w.lanes = lanes;
    w.x = P.x; w.y = P.y; w.ax = P.ax; w.ay = P.ay;
    return true;
  }

  /** Open a site: a lane coned off or a road closed, `near` a point if one is given, or else somewhere within sight of the middle. */
  private start(kind: Site['kind'], near?: V2): boolean {
    const r = this.perk;
    const span = 30 + r() * 15;
    const spots: { x: number; y: number; ax: number; ay: number; d: number }[] = [];
    for (const l of this.net.lanes) {
      if (!l.road || !(kind === 'lane' ? this.laneOk(l, span) : l.idx === 0 && l.dir === 1 && this.roadOk(l.road))) continue;
      // anywhere along it that leaves room to merge, or its middle if the whole road goes
      const s = kind === 'lane' ? (near ? project(l, near) : LEAD + span / 2 + r() * (l.len - LEAD - AFTER - span)) : l.len / 2;
      at(l, s, P);
      const to = near ?? MID;
      spots.push({ x: P.x, y: P.y, ax: P.ax, ay: P.ay, d: Math.hypot(P.x - to.x, P.y - to.y) });
    }
    if (near) spots.sort((a, b) => a.d - b.d);
    else {
      // by lot among those in sight, then among the rest
      for (const p of spots) p.d = (p.d < SIGHT ? 0 : 1) + r();
      spots.sort((a, b) => a.d - b.d);
    }
    for (let i = 0; i < spots.length && i < 8; i++) {
      const p = spots[i];
      const w: Site = { kind, x: p.x, y: p.y, ax: p.ax, ay: p.ay, span, until: this.time + LASTS[0] + r() * (LASTS[1] - LASTS[0]), lane: null, s0: 0, s1: 0, road: null, lanes: [], live: false, seed: (r() * 1e6) | 0 };
      if (!this.place(w, true)) continue;
      this.works.push(w);
      this.worksRev++;
      return true;
    }
    return false;
  }

  private end(w: Site) {
    for (const l of w.lanes) { l.dig = null; l.shut = false; }
    this.works.splice(this.works.indexOf(w), 1);
    this.worksRev++;
  }

  /** Is nobody left where the works are to be. */
  private empty(w: Site) {
    if (w.lane) {
      for (const c of w.lane.cars as Car[]) if (c.s > w.s0 && c.s - c.len < w.s1) return false;
      return true;
    }
    for (const l of w.lanes) {
      if (l.cars.length) return false;
      for (const k of l.inc) if (k.cars.length || k.conn!.reserved.length) return false;
    }
    return true;
  }

  /** Sites come and go by themselves: looked at once a second of the traffic's time. */
  private tend() {
    for (let i = this.works.length - 1; i >= 0; i--) if (this.time >= this.works[i].until) this.end(this.works[i]);
    for (const w of this.works) if (!w.live && this.empty(w)) { w.live = true; this.worksRev++; }
    if (this.perks.works && this.works.length < SITES && this.time >= this.digAt) {
      // a lane and a road in turn; where there is no room for one, try again soon
      const ok = this.start(this.digs++ % 2 ? 'road' : 'lane');
      this.digAt = this.time + (ok ? NEXT[0] + this.perk() * (NEXT[1] - NEXT[0]) : 120);
    }
  }

  /** Open a site now, as near the middle of the map as one will go; the oldest makes room for it. */
  dig(): boolean {
    while (this.works.length >= SITES) this.end(this.works[0]);
    const kind = this.digs++ % 2 ? 'road' : 'lane';
    return this.start(kind, MID) || this.start(kind === 'lane' ? 'road' : 'lane', MID);
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
type V2 = { x: number; y: number };
