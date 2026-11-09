// Shared mutable state between the scene and the page. Read every frame, no React in the loop.
//
// One crank, one plane: the machine turns in XW only. Composing turns in two planes can point an edge straight at the
// eye, and a strut would have to shrink to nothing. In one plane the shortest strut is 0.73, the longest 3.03.
//
// The crank is a servo. It holds, then snaps to a new target, overshoots a little, settles, holds again. Steps are
// mostly small and forward, now and then a quarter turn, now and then a twitch back. The whole thing on its turntable
// does the same, slower and rarer.
export const st = {
  angle: 0.3, // XW, radians, where the crank is
  target: 0.3, // where the servo is told to be
  vel: 0,
  program: true, // the servo picks its own targets
  next: 1.2, // seconds until the next step
  crank: 0, // held key, -1 0 1
  shift: false, // shift held: drag moves the target instead of orbiting
  turntable: { on: true, angle: 0, target: 0, vel: 0, next: 3 },
  /** Longest and shortest strut right now, for the readout. */
  lengths: { min: 0, max: 0 },
};

export const CRANK = 1.6; // rad/s of target with a key held

/** Underdamped spring: stiff and a bit bouncy, the look of a first prototype's actuator. */
const SERVO = { k: 360, zeta: 0.42 };
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

/** Choose the next crank step and the hold after it. */
function step() {
  const size = pick<number>([[5, 1], [15, 4], [30, 3], [45, 1.5], [90, 1]]);
  const back = Math.random() < (size <= 15 ? 0.3 : 0.12);
  st.target += (back ? -1 : 1) * size * DEG;
  // hold: longer after a big move, sometimes a quick second step
  st.next = Math.random() < 0.25 ? 0.14 + Math.random() * 0.1 : 0.35 + Math.random() * (size >= 45 ? 1.6 : 1.0);
}

export function tick(dt: number) {
  if (st.program) {
    st.next -= dt;
    if (st.next <= 0) step();
  }
  st.target += st.crank * CRANK * dt;
  [st.angle, st.vel] = spring(st.angle, st.vel, st.target, dt, SERVO);

  const t = st.turntable;
  if (t.on) {
    t.next -= dt;
    if (t.next <= 0) {
      t.target += (Math.random() < 0.7 ? 1 : -1) * (15 + Math.random() * 50) * DEG;
      t.next = 2.5 + Math.random() * 4;
    }
  }
  [t.angle, t.vel] = spring(t.angle, t.vel, t.target, dt, TABLE);
}

/** For the readout: what the servo is doing. */
export function phase(): string {
  if (Math.abs(st.target - st.angle) > 1.5 * DEG) return 'MOVE';
  if (Math.abs(st.vel) > 0.05) return 'SETTLE';
  return 'HOLD';
}
