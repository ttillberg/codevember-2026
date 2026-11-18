// The same chain, with weight: a real pendulum of n arms, a point mass at every joint, in
// gravity. Left alone it is chaos, no bar ever repeats; so one knob, `loose`, blends two
// accelerations for every arm: what gravity and the other arms do to it (loose), and a pull
// towards where the formula says it should be (1 - loose), critically damped, with the
// formula's own acceleration fed forward so that at 0 it follows exactly. In between, the
// rhythm is the formula's, bent by weight.
//
// It runs in bars, not seconds: gravity is set so the first arm alone, let go, swings at its
// own rate (g = (2π n₁)² L₁). So tempo only says how fast a bar goes by, and a pause is a
// phase that stands still. And it runs ahead of what is seen, like the formula's crossings:
// the hits are known before they are heard.

import { topSpeed, type Arm, type Hit, type Mode } from './rhythm';

const TAU = Math.PI * 2;
const MAX = 8;
/** steps to a bar (RK4) */
export const STEPS = 4096;
/** every so many steps the angles are kept, for drawing */
const KEEP = 8;
const RATE = STEPS / KEEP;
/** kept states: four bars */
const CAP = 2048;
/** how hard an arm is pulled to the formula: the pull's own frequency, cycles a bar */
const PULL = 2;

const wrap = (a: number) => a - TAU * Math.round(a / TAU);
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
  private prevMode: Mode | null = null;

  private A = new Float64Array(MAX * MAX);
  private b = new Float64Array(MAX);
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

  /** every arm's angular acceleration, per bar², into out */
  private accel(arms: Arm[], loose: number, phi: number, th: Float64Array, om: Float64Array, out: Float64Array) {
    const n = arms.length;
    const { A, b } = this;
    if (loose > 0) {
      // n point masses of 1: A θ" = b, with μ(i, j) the mass hanging under both arms
      const g = (TAU * arms[0].n) ** 2 * arms[0].len;
      for (let i = 0; i < n; i++) {
        let bi = -(n - i) * g * Math.sin(th[i]);
        for (let j = 0; j < n; j++) {
          const mu = n - Math.max(i, j);
          const d = th[i] - th[j];
          A[i * n + j] = mu * arms[j].len * Math.cos(d);
          bi -= mu * arms[j].len * Math.sin(d) * om[j] * om[j];
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
        b[r] = s / A[r * n + r];
      }
    }
    const w = TAU * PULL;
    for (let i = 0; i < n; i++) {
      const a = arms[i];
      const wn = TAU * a.n;
      const p = wn * phi + a.phase;
      const s = a.swing * Math.sin(p);
      const pull = -wn * wn * s + 2 * w * (a.swing * wn * Math.cos(p) - om[i]) + w * w * wrap(s - th[i]);
      out[i] = (loose > 0 ? loose * b[i] : 0) + (1 - loose) * pull;
    }
  }

  private step(arms: Arm[], loose: number) {
    const n = arms.length;
    const h = 1 / STEPS;
    const phi = this.i / STEPS;
    const { th, om, ts } = this;
    const [k1, k2, k3, k4] = this.k;
    const [o2, o3, o4] = this.os;
    this.accel(arms, loose, phi, th, om, k1);
    for (let j = 0; j < n; j++) {
      ts[j] = th[j] + (h / 2) * om[j];
      o2[j] = om[j] + (h / 2) * k1[j];
    }
    this.accel(arms, loose, phi + h / 2, ts, o2, k2);
    for (let j = 0; j < n; j++) {
      ts[j] = th[j] + (h / 2) * o2[j];
      o3[j] = om[j] + (h / 2) * k2[j];
    }
    this.accel(arms, loose, phi + h / 2, ts, o3, k3);
    for (let j = 0; j < n; j++) {
      ts[j] = th[j] + h * o3[j];
      o4[j] = om[j] + h * k3[j];
    }
    this.accel(arms, loose, phi + h, ts, o4, k4);
    for (let j = 0; j < n; j++) {
      th[j] += (h / 6) * (om[j] + 2 * o2[j] + 2 * o3[j] + o4[j]);
      om[j] += (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
    }
    this.i++;
  }

  private signals(arms: Arm[], mode: Mode, out: Float64Array) {
    let x = 0;
    for (let j = 0; j < arms.length; j++) {
      const s = arms[j].len * Math.sin(this.th[j]);
      x += s;
      out[j] = mode === 'each' ? s : x;
    }
  }

  /** run on to φ = to, and say where every joint crossed on the way (those at or after `since`) */
  advance(arms: Arm[], mode: Mode, loose: number, to: number, since: number, out: Hit[]) {
    const n = arms.length;
    if (this.prevMode !== mode) {
      this.signals(arms, mode, this.prev);
      this.prevMode = mode;
    }
    const sig = new Float64Array(MAX);
    while (this.i < to * STEPS) {
      this.step(arms, loose);
      this.signals(arms, mode, sig);
      for (let k = 0; k < n; k++) {
        const s0 = this.prev[k];
        const s1 = sig[k];
        const up = s0 < 0 && s1 >= 0;
        if (up || (s0 > 0 && s1 <= 0)) {
          const phase = (this.i - 1 + s0 / (s0 - s1)) / STEPS;
          const top = topSpeed(arms, k, mode);
          if (phase >= since && top > 0) out.push({ k, phase, dir: up ? 1 : -1, vel: Math.min(1, (Math.abs(s1 - s0) * STEPS) / top) });
        }
        this.prev[k] = s1;
      }
      if (this.i % KEEP === 0) this.keep(n);
    }
    return out;
  }

  /** for the dev console: kinetic and potential energy of the weights, per bar² (constant when loose is 1) */
  energy(arms: Arm[]): number {
    const g = (TAU * arms[0].n) ** 2 * arms[0].len;
    let vx = 0;
    let vy = 0;
    let y = 0;
    let e = 0;
    for (let j = 0; j < arms.length; j++) {
      vx += arms[j].len * Math.cos(this.th[j]) * this.om[j];
      vy -= arms[j].len * Math.sin(this.th[j]) * this.om[j];
      y += arms[j].len * Math.cos(this.th[j]);
      e += 0.5 * (vx * vx + vy * vy) - g * y;
    }
    return e;
  }
}
