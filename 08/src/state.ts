// Shared mutable state between the scene and the page. Read every frame, no React in the loop.
//
// One crank, one plane: the machine turns in XW only. Composing turns in two planes can point an edge straight at the
// eye, and a strut would have to shrink to nothing. In one plane the shortest strut is 0.73, the longest 3.03.
//
// The crank is a servo. It holds, then snaps a quarter turn, settles, holds again. A quarter turn is the tesseract's
// own period, so every hold is the same shape with the colours moved on. Some steps stagger: two or three uneven
// lurches with a breath between, like a stepper catching up. The whole thing on its turntable does the same, slower.
export const st = {
  angle: 0.3, // XW, radians, where the crank is
  target: 0.3, // where the servo is told to be
  vel: 0,
  program: true, // the servo picks its own targets
  smooth: true, // the default: an even spin and a slow turntable. M swaps in the servo
  next: 1.2, // seconds until the next step
  crank: 0, // held key, -1 0 1
  turntable: { angle: 0, target: 0, vel: 0, next: 3 },
  /** Orbiting sets the way: the camera's azimuth, written by the controls, and the way the last drag went. */
  azimuth: 0,
  lastAzimuth: 0,
  way: 1, // the idle spin follows the last drag: +1 or -1
  /** Longest and shortest strut right now, for the readout. */
  lengths: { min: 0, max: 0 },
};

export const CRANK = 1.6; // rad/s of target with a key held
const SPIN = 0.22, TURNTABLE = 0.08; // rad/s, the smooth mode

/** Stiff spring, a touch under critical: a step lands with one small overshoot, no wobble. */
const SERVO = { k: 360, zeta: 0.68 };
const TABLE = { k: 70, zeta: 0.6 };

function spring(x: number, v: number, target: number, dt: number, p: { k: number; zeta: number }): [number, number] {
  const c = 2 * Math.sqrt(p.k) * p.zeta;
  // two substeps keep it stable at a slow frame
  for (let i = 0; i < 2; i++) {
    const h = dt / 2;
    v += (p.k * (target - x) - c * v) * h;
    x += v * h;
  }
  return [x, v];
}

const DEG = Math.PI / 180;
const pick = <T,>(xs: [T, number][]) => {
  let r = Math.random() * xs.reduce((a, [, w]) => a + w, 0);
  for (const [x, w] of xs) { r -= w; if (r <= 0) return x; }
  return xs[xs.length - 1][0];
};

/** A quarter turn, queued as one move or as two or three uneven lurches; the last one is followed by a hold. */
const queue: { delta: number; wait: number }[] = [];
function step() {
  const sign = (Math.random() < 0.1 ? -1 : 1) * st.way;
  const parts = pick<number[]>([[[1], 5], [[0.65, 0.35], 3], [[0.5, 0.3, 0.2], 2]]);
  parts.forEach((f, i) => queue.push({
    delta: sign * 90 * DEG * f,
    wait: i === parts.length - 1 ? 0.9 + Math.random() * 1.8 : 0.08 + Math.random() * 0.1,
  }));
}

export function tick(dt: number) {
  // orbit the camera one way and the machine turns that way from then on
  let dAz = st.azimuth - st.lastAzimuth;
  if (dAz > Math.PI) dAz -= 2 * Math.PI; else if (dAz < -Math.PI) dAz += 2 * Math.PI;
  st.lastAzimuth = st.azimuth;
  if (Math.abs(dAz) > 1e-3) st.way = Math.sign(dAz);

  if (st.smooth) {
    if (st.program) st.target += SPIN * st.way * dt;
    st.target += st.crank * CRANK * dt;
    st.angle = st.target; st.vel = 0;
    const t = st.turntable;
    t.target += TURNTABLE * dt;
    t.angle = t.target; t.vel = 0;
    return;
  }
  if (st.program) {
    st.next -= dt;
    if (st.next <= 0) {
      if (!queue.length) step();
      const q = queue.shift()!;
      st.target += q.delta;
      st.next = q.wait;
    }
  }
  st.target += st.crank * CRANK * dt;
  [st.angle, st.vel] = spring(st.angle, st.vel, st.target, dt, SERVO);

  const t = st.turntable;
  t.next -= dt;
  if (t.next <= 0) {
    t.target += (Math.random() < 0.7 ? 1 : -1) * (15 + Math.random() * 50) * DEG;
    t.next = 2.5 + Math.random() * 4;
  }
  [t.angle, t.vel] = spring(t.angle, t.vel, t.target, dt, TABLE);
}

/** For the readout: what the servo is doing. */
export function phase(): string {
  if (st.smooth) return 'SMOOTH';
  if (Math.abs(st.target - st.angle) > 1.5 * DEG) return 'MOVE';
  if (Math.abs(st.vel) > 0.05) return 'SETTLE';
  return 'HOLD';
}
