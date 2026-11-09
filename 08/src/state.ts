import * as THREE from 'three';
import { mul, rotPlane, type M4 } from './tesseract';

// Shared mutable state between the scene and the page. Read every frame, no React in the loop.
//
// One plane at a time. The machine turns in XW, YW or ZW, never two at once: compose turns in two planes and an edge
// can point straight at the eye, and a strut would have to shrink to nothing. But after a quarter turn the tesseract
// stands on itself again (a cell has moved to the next place), so the next quarter can go in any plane. The pose is a
// base of whole quarter turns, a signed permutation of the axes, and one live angle in one plane on top of it.
//
// The smooth mode turns evenly and changes plane as it passes each quarter. The servo holds, snaps a quarter turn,
// settles, holds again; some steps stagger in two or three uneven lurches with a breath between.
export const st = {
  plane: 0, // 0 1 2: the axis turning with w right now
  base: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] as M4, // the quarter turns done so far
  angle: 0.3, // radians in the live plane, where the crank is
  target: 0.3, // where the servo is told to be
  vel: 0,
  quarters: 0, // quarter turns done
  program: false, // the servo picks its own targets; off, it only turns when told to (a catch)
  smooth: false, // an even turn instead of the servo's steps. M swaps
  next: 1.2, // seconds until the next step
  crank: 0, // held key, -1 0 1
  way: 1, // which way it turns, +1 or -1: the last drag, or a flip now and then
  flipIn: 12, // seconds until it turns round on its own
  spinVel: 0, // the smooth mode's speed, eased towards SPIN * way so a flip is a swing, not a knock
  /** Longest and shortest strut right now, for the readout. */
  lengths: { min: 0, max: 0 },
};

/** The rig: the camera stands still, straight on; dragging turns the machine itself, about the room's axes. */
export const rig = {
  q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.27, -0.55, 0, 'YXZ')),
  vel: [0, 0], // rad/s about y and x, from the last drag, decaying
  zoom: 10.5, // camera distance
};
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), tq = new THREE.Quaternion();
export function spinRig(dy: number, dx: number) {
  rig.q.premultiply(tq.setFromAxisAngle(AY, dy)).premultiply(tq.setFromAxisAngle(AX, dx));
}

export const CRANK = 1.6; // rad/s of target with a key held
const SPIN = 0.22; // rad/s, the smooth mode
const TURNTABLE = 0.07; // rad/s, the rig's slow turn about the room's up, a revolution in a minute and a half
const QUARTER = Math.PI / 2;
const DEG = Math.PI / 180;

/** The whole 4D rotation right now: the live plane's turn on top of the base. */
export const pose = (): M4 => mul(rotPlane(st.plane, st.angle), st.base);

/** Stiff spring, a touch under critical: a step lands with one small overshoot, no wobble. */
const SERVO = { k: 360, zeta: 0.68 };

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

const pick = <T,>(xs: [T, number][]) => {
  let r = Math.random() * xs.reduce((a, [, w]) => a + w, 0);
  for (const [x, w] of xs) { r -= w; if (r <= 0) return x; }
  return xs[xs.length - 1][0];
};

/** Bank q whole quarter turns in the live plane into the base, and move on to another plane. The plane only changes
 * when nothing is left over: a leftover angle carried into a new plane is a different pose, and the machine would
 * jump. */
function fold(q: number) {
  st.base = mul(rotPlane(st.plane, q * QUARTER), st.base).map((row) => row.map(Math.round)) as M4;
  st.angle -= q * QUARTER;
  st.target -= q * QUARTER;
  st.quarters += Math.abs(q);
  if (Math.abs(st.angle) < 1e-3) st.plane = pick<number>([0, 1, 2].filter((p) => p !== st.plane).map((p) => [p, 1]));
}

/** A quarter turn, queued as one move or as two or three uneven lurches; the last one is followed by a hold. */
const queue: { delta: number; wait: number }[] = [];
function step() {
  // bank what the last step did, so this one starts from a standing tesseract in a fresh plane
  const q = Math.round(st.target / QUARTER);
  if (q !== 0) fold(q);
  const sign = (Math.random() < 0.1 ? -1 : 1) * st.way;
  const parts = pick<number[]>([[[1], 5], [[0.65, 0.35], 3], [[0.5, 0.3, 0.2], 2]]);
  parts.forEach((f, i) => queue.push({
    delta: sign * 90 * DEG * f,
    wait: i === parts.length - 1 ? 0.9 + Math.random() * 1.8 : 0.08 + Math.random() * 0.1,
  }));
}

export function tick(dt: number) {
  // a slow turntable, always, about the room's up; a drag adds to it and coasts off again
  spinRig(TURNTABLE * dt, 0);
  // the rig coasts after a drag; drag one way and the machine turns that way from then on; it also turns round on its own
  if (rig.vel[0] || rig.vel[1]) {
    spinRig(rig.vel[0] * dt, rig.vel[1] * dt);
    const k = Math.exp(-dt * 4);
    rig.vel[0] *= k; rig.vel[1] *= k;
    if (Math.abs(rig.vel[0]) + Math.abs(rig.vel[1]) < 1e-3) rig.vel[0] = rig.vel[1] = 0;
  }
  st.flipIn -= dt;
  if (st.flipIn <= 0) { st.way = -st.way; st.flipIn = 8 + Math.random() * 14; }

  if (glide) {
    glide.t += dt;
    const u = Math.min(1, glide.t / glide.dur), e = u * u * (3 - 2 * u);
    st.angle = st.target = glide.from + (glide.to - glide.from) * e;
    st.vel = 0;
    if (u >= 1) {
      st.angle = st.target = glide.to;
      glide = null;
      const q = Math.round(st.angle / QUARTER);
      if (q !== 0) fold(q);
    }
    return;
  }
  if (st.smooth) {
    st.spinVel += (SPIN * st.way * (st.program ? 1 : 0) - st.spinVel) * Math.min(1, dt * 1.2);
    st.target += (st.spinVel + st.crank * CRANK) * dt;
    st.angle = st.target; st.vel = 0;
    // past a quarter, bank it and carry on in another plane
    while (st.angle >= QUARTER) fold(1);
    while (st.angle <= -QUARTER) fold(-1);
    return;
  }
  if (st.program || queue.length) {
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
}

/** One quarter turn as a glide, eased in and out over `dur` seconds: the machine changes shape when the device has
 * taken a piece, and holds between. */
let glide: { from: number; to: number; t: number; dur: number } | null = null;
export function turnGlide(dur = 2) {
  const q = Math.round(st.target / QUARTER);
  if (q !== 0) fold(q);
  // to an exact quarter, so the bank at the end leaves nothing over and the pose is continuous through it
  const dir = (Math.random() < 0.1 ? -1 : 1) * st.way;
  glide = { from: st.angle, to: (Math.round(st.angle / QUARTER) + dir) * QUARTER, t: 0, dur };
}

/** For the readout: what the servo is doing. */
export function phase(): string {
  if (st.smooth) return 'SMOOTH';
  if (Math.abs(st.target - st.angle) > 1.5 * DEG) return 'MOVE';
  if (Math.abs(st.vel) > 0.05) return 'SETTLE';
  return 'HOLD';
}
