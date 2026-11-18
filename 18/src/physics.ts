// The same chain, with weight: a swing in a swing. Every arm is a real pendulum hanging from
// the end of the one above it, a point mass at its joint, and what keeps it going is what you
// give a swing: a push along the way it should be moving, and the air against the way it is.
// Nothing holds it in place.
//
// - Its own rhythm. Each arm has a gravity of its own, set so that alone it swings its n times
//   a bar whatever its length (g = (2π n)² L). So the formula's motion is what every swing
//   does by itself, and the push is in time with that: (θ'* - θ') ω / Q, the formula's speed
//   against its own. On the formula the push is nothing at all.
// - Weight. Not as in nature, where a chain of equal weights swings the same whether they
//   are grams or kilos, so "no weight" would mean nothing. Here every joint weighs 1 to its
//   own arm, and its `mass` (0..1) is what it weighs to the arms above it: how hard it pulls
//   on what it hangs from, and how hard its motor pushes back. At 0 it rides the swing above
//   and is shaken by it, and the swing above never knows. With every one at 1 it is the real
//   chain of equal weights. In between the forces are one-sided: energy is not kept.
// - What bends the rhythm is then only what is real: a wide swing is slower than a small one,
//   the joint an arm hangs from is moving, and the arms under it pull.
//
// It runs in bars, not seconds, so tempo only says how fast a bar goes by, and a pause is a
// phase that stands still. And it runs ahead of what is seen, like the formula's crossings:
// the hits are known before they are heard.

import { reach, topSpeed, type Arm, type Hit } from './rhythm';

const TAU = Math.PI * 2;
const MAX = 8;
/** an arm let go from the very top passes the bottom at twice its own rate; past this many times it, the air goes thick */
const TOO_FAST = 3;
const THICK = 8;
/**
 * The push's knob (0..1) as one over the swing's Q: nothing at the bottom, 4 at the top (the
 * air is syrup and the push rules), and in the middle 0.36, about where a chain starts coming
 * round every bar: the knob's middle is the middle of what it does.
 */
export const PUSH_CURVE = Math.log(0.36 / 4) / Math.log(0.5);
const pushRate = (knob: number) => 4 * Math.pow(knob, PUSH_CURVE);

/** an arm's push at φ when it turns at om, as an angular acceleration: the formula's speed against its own */
function pushOn(a: Arm, phi: number, om: number): number {
  const wn = TAU * a.n;
  return pushRate(a.push) * wn * (a.swing * wn * Math.cos(wn * phi + a.phase) - om);
}
/** what a joint weighs to the arms above it */
const massOf = (a: Arm) => Math.min(1, Math.max(0, a.mass));
/** steps to a bar (RK4) */
export const STEPS = 4096;
/** every so many steps the angles are kept, for drawing */
const KEEP = 8;
const RATE = STEPS / KEEP;
/** kept states: four bars */
const CAP = 2048;
/** where kept state e lives (e is negative during a count in) */
const slot = (e: number) => (((e % CAP) + CAP) % CAP) * MAX;

export class Sim {
  live = false;
  /** steps done: its phase is i / STEPS */
  private i = 0;
  /** the first kept state, in kept states */
  private first = 0;
  private th = new Float64Array(MAX);
  private om = new Float64Array(MAX);
  private hist = new Float32Array(CAP * MAX);
  /** what every joint's signal was a step ago, and in which mode */
  private prev = new Float64Array(MAX);
  private prevMode: string | null = null;

  private A = new Float64Array(MAX * MAX);
  private b = new Float64Array(MAX);
  private mu = new Float64Array(MAX + 1);
  private tq = new Float64Array(MAX + 1);
  private k = [0, 1, 2, 3].map(() => new Float64Array(MAX));
  private ts = new Float64Array(MAX);
  private os = [0, 1, 2].map(() => new Float64Array(MAX));

  /** simulated up to here, bars */
  get phi() {
    return this.i / STEPS;
  }
  /** kept from here, bars */
  get from() {
    return Math.max(this.first, Math.floor(this.i / KEEP) - CAP + 1) / RATE;
  }

  /** start from where the formula is at φ (rounded up to a kept state) */
  reset(arms: Arm[], phi: number) {
    this.i = Math.ceil(phi * RATE) * KEEP;
    this.first = this.i / KEEP;
    for (let j = 0; j < arms.length; j++) this.seed(arms[j], j);
    this.prevMode = null;
    this.keep(arms.length);
    this.live = true;
  }

  private seed(a: Arm, j: number) {
    const p = TAU * a.n * this.phi + a.phase;
    this.th[j] = a.swing * Math.sin(p);
    this.om[j] = a.swing * TAU * a.n * Math.cos(p);
  }

  /** an arm was hung on the end: it starts on the formula, and its past is the formula's */
  added(arms: Arm[]) {
    const j = arms.length - 1;
    this.seed(arms[j], j);
    for (let e = Math.round(this.from * RATE); e <= Math.floor(this.i / KEEP); e++) {
      this.hist[slot(e) + j] = arms[j].swing * Math.sin((TAU * arms[j].n * e) / RATE + arms[j].phase);
    }
    this.prevMode = null;
  }

  /** arm j was taken away: the ones after it move up, in the past too */
  removed(j: number) {
    for (let m = j; m < MAX - 1; m++) {
      this.th[m] = this.th[m + 1];
      this.om[m] = this.om[m + 1];
    }
    for (let s = 0; s < CAP; s++) for (let m = j; m < MAX - 1; m++) this.hist[s * MAX + m] = this.hist[s * MAX + m + 1];
    this.prevMode = null;
  }

  private keep(n: number) {
    const s = slot(this.i / KEEP);
    for (let j = 0; j < n; j++) this.hist[s + j] = this.th[j];
  }

  /** the angles at φ, from what was kept; false if φ is before it (the formula's then) */
  sample(phi: number, n: number, out: number[]): boolean {
    const e = phi * RATE;
    const last = Math.floor(this.i / KEEP);
    if (!this.live || e < Math.round(this.from * RATE)) return false;
    const lo = Math.min(last, Math.floor(e));
    const hi = Math.min(last, lo + 1);
    const f = Math.min(1, e - lo);
    for (let j = 0; j < n; j++) {
      const a = this.hist[slot(lo) + j];
      out[j] = a + (this.hist[slot(hi) + j] - a) * f;
    }
    out.length = n;
    return true;
  }

  /** every arm's push at φ, per bar², from what was kept (how fast it turned is read off the states either side); false before it */
  pushAt(arms: Arm[], phi: number, out: number[]): boolean {
    const n = arms.length;
    const d = 1 / RATE;
    if (!this.sample(phi - d, n, this.was) || !this.sample(phi + d, n, out)) return false;
    for (let j = 0; j < n; j++) out[j] = pushOn(arms[j], phi, (out[j] - this.was[j]) / (2 * d));
    return true;
  }
  private was: number[] = [];

  /** every arm's angular acceleration, per bar², into out */
  private accel(arms: Arm[], phi: number, th: Float64Array, om: Float64Array, out: Float64Array) {
    const n = arms.length;
    const { A, b, mu, tq } = this;
    // what hangs under each joint, as the arms above it feel it (mu[i]: joint i and all below),
    // and each arm's push, as an acceleration of its own
    mu[n] = 0;
    tq[n] = 0;
    for (let i = n - 1; i >= 0; i--) {
      const a = arms[i];
      mu[i] = mu[i + 1] + massOf(a);
      tq[i] = pushOn(a, phi, om[i]);
    }
    // A θ" = b, every row over what its own arm carries (its joint at 1, the rest under it as
    // they weigh to it) and over its length
    for (let i = 0; i < n; i++) {
      const wn = TAU * arms[i].n;
      const carried = 1 + mu[i + 1];
      let bi = -wn * wn * arms[i].len * Math.sin(th[i]) + arms[i].len * tq[i];
      // the motor of the arm below pushes back on this one
      if (i + 1 < n) bi -= (mu[i + 1] / carried) * ((arms[i + 1].len * arms[i + 1].len) / arms[i].len) * tq[i + 1];
      for (let j = 0; j < n; j++) {
        const r = j <= i ? 1 : mu[j] / carried;
        const d = th[i] - th[j];
        A[i * n + j] = r * arms[j].len * Math.cos(d);
        bi -= r * arms[j].len * Math.sin(d) * om[j] * om[j];
      }
      b[i] = bi;
    }
    // gaussian elimination, the largest pivot first
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
      if (p !== c) {
        for (let m = c; m < n; m++) [A[c * n + m], A[p * n + m]] = [A[p * n + m], A[c * n + m]];
        [b[c], b[p]] = [b[p], b[c]];
      }
      const d = A[c * n + c];
      for (let r = c + 1; r < n; r++) {
        const f = A[r * n + c] / d;
        if (!f) continue;
        for (let m = c; m < n; m++) A[r * n + m] -= f * A[c * n + m];
        b[r] -= f * b[c];
      }
    }
    for (let r = n - 1; r >= 0; r--) {
      let s = b[r];
      for (let m = r + 1; m < n; m++) s -= A[r * n + m] * b[m];
      out[r] = b[r] = s / A[r * n + r];
    }
    // One-sided forces can feed an arm for ever. So the air goes thick past a speed no swing
    // gets to by itself (half as fast again as one let go from the very top): it cannot run away.
    for (let i = 0; i < n; i++) {
      const wn = TAU * arms[i].n;
      const over = Math.abs(om[i]) - TOO_FAST * wn;
      if (over > 0) out[i] -= Math.sign(om[i]) * over * THICK * wn;
    }
  }

  private step(arms: Arm[]) {
    const n = arms.length;
    const h = 1 / STEPS;
    const phi = this.i / STEPS;
    const { th, om, ts } = this;
    const [k1, k2, k3, k4] = this.k;
    const [o2, o3, o4] = this.os;
    this.accel(arms, phi, th, om, k1);
    for (let j = 0; j < n; j++) {
      ts[j] = th[j] + (h / 2) * om[j];
      o2[j] = om[j] + (h / 2) * k1[j];
    }
    this.accel(arms, phi + h / 2, ts, o2, k2);
    for (let j = 0; j < n; j++) {
      ts[j] = th[j] + (h / 2) * o2[j];
      o3[j] = om[j] + (h / 2) * k2[j];
    }
    this.accel(arms, phi + h / 2, ts, o3, k3);
    for (let j = 0; j < n; j++) {
      ts[j] = th[j] + h * o3[j];
      o4[j] = om[j] + h * k3[j];
    }
    this.accel(arms, phi + h, ts, o4, k4);
    for (let j = 0; j < n; j++) {
      th[j] += (h / 6) * (om[j] + 2 * o2[j] + 2 * o3[j] + o4[j]);
      om[j] += (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
    }
    this.i++;
  }

  private signals(arms: Arm[], out: Float64Array) {
    let x = 0;
    for (let j = 0; j < arms.length; j++) {
      const s = arms[j].len * Math.sin(this.th[j]);
      x += s;
      out[j] = arms[j].mode === 'each' ? s : x;
    }
  }

  /** run on to φ = to, and say where every joint crossed on the way (those at or after `since`) */
  advance(arms: Arm[], to: number, since: number, out: Hit[]) {
    const n = arms.length;
    // a joint whose line was changed starts from where it is against the new one: no hit for the change
    const modes = arms.map((a) => a.mode).join();
    if (this.prevMode !== modes) {
      this.signals(arms, this.prev);
      this.prevMode = modes;
    }
    const sig = new Float64Array(MAX);
    while (this.i < to * STEPS) {
      this.step(arms);
      // should it ever come apart all the same: back on the formula, where it is
      let whole = 0;
      for (let j = 0; j < n; j++) whole += this.th[j] + this.om[j];
      if (!Number.isFinite(whole)) {
        this.reset(arms, this.i / STEPS);
        this.signals(arms, this.prev);
        this.prevMode = arms.map((a) => a.mode).join();
      }
      this.signals(arms, sig);
      for (let k = 0; k < n; k++) {
        const s0 = this.prev[k];
        const s1 = sig[k];
        const up = s0 < 0 && s1 >= 0;
        if (up || (s0 > 0 && s1 <= 0)) {
          const phase = (this.i - 1 + s0 / (s0 - s1)) / STEPS;
          const top = topSpeed(arms, k);
          if (phase >= since && top > 0) out.push({ k, phase, dir: up ? 1 : -1, vel: Math.min(1, (Math.abs(s1 - s0) * STEPS) / top), pos: reach(arms, k, this.th) });
        }
        this.prev[k] = s1;
      }
      if (this.i % KEEP === 0) this.keep(n);
    }
    return out;
  }

  /** for the dev console: the energy of the real chain, every joint 1 (kept only when every weight is 1 and nothing pushes) */
  energy(arms: Arm[]): number {
    const n = arms.length;
    let vx = 0;
    let vy = 0;
    let e = 0;
    for (let j = 0; j < n; j++) {
      vx += arms[j].len * Math.cos(this.th[j]) * this.om[j];
      vy -= arms[j].len * Math.sin(this.th[j]) * this.om[j];
      e += 0.5 * (vx * vx + vy * vy) - (n - j) * (TAU * arms[j].n * arms[j].len) ** 2 * Math.cos(this.th[j]);
    }
    return e;
  }

  /** for the dev console: how fast the fastest arm turns, radians a bar */
  get speed(): number {
    let top = 0;
    for (let j = 0; j < MAX; j++) top = Math.max(top, Math.abs(this.om[j]));
    return top;
  }
}
