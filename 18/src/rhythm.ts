// The model: a chain of arms, each swinging about the end of the one before it. No physics
// yet, only trigonometry: an arm's angle from the vertical is swing · sin(2π n φ + phase),
// where φ is the bar (0..1 is one bar) and n how many swings it makes in it. So a joint's
// sideways position is a sum of sines, a Fourier series, and the rhythm is where that sum
// crosses zero: where the joint passes the centre line.

export interface Arm {
  /** swings per bar: the harmonic */
  n: number;
  /** the largest angle from the vertical, radians */
  swing: number;
  /** length, 1 is the first arm's */
  len: number;
  /** radians, where in its swing it is when the bar starts */
  phase: number;
  /** 0..1, how loud its joint's voice is: 0 is muted */
  vol: number;
  /** silenced, whatever its volume; and, when any arm has it, only those that do are heard */
  mute?: boolean;
  solo?: boolean;
  /** how heavy its joint is, when the chain has weight (physics.ts): only against the others' does it count */
  mass: number;
  /** what its joint crosses to sound */
  mode: Mode;
  /** 0..1, how hard its swing is pushed in time, when the chain has weight: 0 lets it go */
  push: number;
  /** which colour and which voice are its own: they go with it when it is moved along the chain */
  hue: number;
  /** which of a kit's sounds is its own, when sounds go by arm (a drum of the machine's, a pair of the bones) */
  sound: number;
}

/**
 * What a joint has to cross to sound: `sum` is the centre line under the pivot (the joint's
 * own position, every arm above it added up), `each` is the vertical under its own origin
 * (its arm alone: plain polyrhythm).
 */
export type Mode = 'sum' | 'each';

export interface Hit {
  /** which joint */
  k: number;
  /** when, in bars */
  phase: number;
  /** 1 crossing to the right, -1 to the left: tick and tock */
  dir: 1 | -1;
  /** 0..1, how fast it crossed, against the fastest that joint can go */
  vel: number;
  /** how far under the root the joint was when it crossed, in arm lengths (over it is less than nothing): with where the root is, its height on the ruler, its note */
  pos: number;
}

/** a whole turn; and the most arms a chain has: the model, the weighted chain and the page all go by these */
export const TAU = Math.PI * 2;
export const MAX_ARMS = 8;

export const angle = (a: Arm, phi: number) => a.swing * Math.sin(TAU * a.n * phi + a.phase);

/** the joints' positions for these angles, x to the right and y down, in arm lengths: [x0, y0, x1, y1, …] */
export function place(arms: Arm[], angles: ArrayLike<number>, out: number[] = []): number[] {
  let x = 0;
  let y = 0;
  for (let k = 0; k < arms.length; k++) {
    x += arms[k].len * Math.sin(angles[k]);
    y += arms[k].len * Math.cos(angles[k]);
    out[2 * k] = x;
    out[2 * k + 1] = y;
  }
  out.length = arms.length * 2;
  return out;
}

/** how far under the root joint k is at these angles, in arm lengths: its height, not how far away it is */
export function reach(arms: Arm[], k: number, angles: ArrayLike<number>): number {
  let y = 0;
  for (let j = 0; j <= k; j++) y += arms[j].len * Math.cos(angles[j]);
  return y;
}

/** what joint k crosses zero with */
export function signal(arms: Arm[], k: number, phi: number): number {
  if (arms[k].mode === 'each') return arms[k].len * Math.sin(angle(arms[k], phi));
  let x = 0;
  for (let j = 0; j <= k; j++) x += arms[j].len * Math.sin(angle(arms[j], phi));
  return x;
}

/** the fastest joint k's signal can change, per bar */
export function topSpeed(arms: Arm[], k: number): number {
  let s = 0;
  for (let j = arms[k].mode === 'each' ? k : 0; j <= k; j++) s += arms[j].len * arms[j].swing * TAU * arms[j].n;
  return s;
}

/**
 * Every crossing in (from, to], found by stepping and then bisecting, so a hit lands where it
 * is, not on a frame: the motion is a formula, the future is known.
 */
export function crossings(arms: Arm[], from: number, to: number, out: Hit[] = []): Hit[] {
  if (!(to > from)) return out;
  let maxN = 1;
  for (const a of arms) maxN = Math.max(maxN, a.n);
  const steps = Math.max(1, Math.ceil((to - from) * maxN * 96));
  const d = (to - from) / steps;
  const h = 1e-4 / maxN;
  for (let k = 0; k < arms.length; k++) {
    const top = topSpeed(arms, k);
    if (!(top > 0)) continue;
    let p0 = from;
    let s0 = signal(arms, k, p0);
    for (let i = 1; i <= steps; i++) {
      const p1 = i === steps ? to : from + i * d;
      const s1 = signal(arms, k, p1);
      const up = s0 < 0 && s1 >= 0;
      if (up || (s0 > 0 && s1 <= 0)) {
        let a = p0;
        let b = p1;
        for (let it = 0; it < 22; it++) {
          const m = (a + b) / 2;
          if (signal(arms, k, m) < 0 === s0 < 0) a = m;
          else b = m;
        }
        const p = (a + b) / 2;
        const v = Math.abs(signal(arms, k, p + h) - signal(arms, k, p - h)) / (2 * h);
        out.push({ k, phase: p, dir: up ? 1 : -1, vel: Math.min(1, v / top), pos: reach(arms, k, arms.map((a) => angle(a, p))) });
      }
      p0 = p1;
      s0 = s1;
    }
  }
  return out;
}
