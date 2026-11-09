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
  program: false, // the servo picks its own targets; off, it only turns when told to (a catch)
  smooth: false, // an even turn instead of the servo's steps. M swaps
  next: 1.2, // seconds until the next step
  crank: 0, // held key, -1 0 1
  way: 1, // which way it turns, +1 or -1: the last drag, or a flip now and then
  flipIn: 12, // seconds until it turns round on its own
  spinVel: 0, // the smooth mode's speed, eased towards SPIN * way so a flip is a swing, not a knock
  hard: false, // hard mode: the machine turns in 4D all the time, changing plane as it passes each quarter
  inout: false, // the hand-over at a wall: false, both halves at once, folded at the wall; true, the body goes all the way in, then comes out
  /** How far the machine reaches from its centre right now, in the 3D picture, for the camera to fit it. */
  reach: 4,
};

/** Debugging the flight: a readout of the cell the device is in, and lamps on that cell's corners. */
export const DEBUG = true;

/** The rig: the machine on a fixed tilt, and the camera orbiting round it, `yaw` and `pitch` about the centre; a
 * drag turns it and it coasts after; in the attract mode a turntable turns it slowly on its own. */
export const rig = {
  q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.27, -0.55, 0, 'YXZ')),
  zoom: 10.5, // camera distance, eased towards the fit
  zoomK: 1, // the wheel's factor on the fit, 1 fits the machine to the page
  yaw: 0, pitch: 0, // the camera's orbit
  orbitVel: [0, 0], orbiting: false, // rad/s of yaw and pitch from the last drag, coasting once it is let go
  turntable: true, // the slow turn on its own, in the attract mode
};

const CRANK = 1.6; // rad/s of target with a key held
const SPIN = 0.22; // rad/s, the smooth mode
const HARD_SPIN = 0.4; // rad/s, the hard mode's turn in 4D
const PITCH_MAX = 1.4; // radians the orbit goes up or down at most
const TURNTABLE = 0.07; // rad/s, the camera's slow orbit in the attract mode, a revolution in a minute and a half
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

/** A drag on the orbit: `dy` radians of yaw and `dp` of pitch, over `dt` seconds; the speed is kept, smoothed, to
 * coast on once it is let go. */
export function orbitBy(dy: number, dp: number, dt: number) {
  rig.orbiting = true;
  rig.yaw += dy;
  rig.pitch = THREE.MathUtils.clamp(rig.pitch + dp, -PITCH_MAX, PITCH_MAX);
  rig.orbitVel[0] += (dy / dt - rig.orbitVel[0]) * 0.5; rig.orbitVel[1] += (dp / dt - rig.orbitVel[1]) * 0.5;
}

export function tick(dt: number) {
  // the turntable: the camera orbits slowly on its own, in the attract mode
  if (rig.turntable) rig.yaw += TURNTABLE * dt;
  // the orbit coasts after a drag, slowing over a second or two
  if (!rig.orbiting && (rig.orbitVel[0] || rig.orbitVel[1])) {
    rig.yaw += rig.orbitVel[0] * dt;
    rig.pitch = THREE.MathUtils.clamp(rig.pitch + rig.orbitVel[1] * dt, -PITCH_MAX, PITCH_MAX);
    const k = Math.exp(-dt * 2.5);
    rig.orbitVel[0] *= k; rig.orbitVel[1] *= k;
    if (Math.abs(rig.orbitVel[0]) + Math.abs(rig.orbitVel[1]) < 1e-3) rig.orbitVel[0] = rig.orbitVel[1] = 0;
  }
  st.flipIn -= dt;
  if (st.flipIn <= 0) { st.way = -st.way; st.flipIn = 8 + Math.random() * 14; }

  if (st.hard) {
    // hard mode: an even turn all the time, turning round now and then; past each quarter it is banked, what little
    // is left over dropped (a frame's worth at most), and the turn goes on in another plane
    glide = null;
    st.spinVel += (HARD_SPIN * st.way - st.spinVel) * Math.min(1, dt * 1.2);
    st.angle += st.spinVel * dt;
    st.target = st.angle; st.vel = 0;
    if (Math.abs(st.angle) >= QUARTER) {
      const q = Math.sign(st.angle);
      st.angle = st.target = q * QUARTER;
      fold(q); // banked to an exact quarter, so fold moves on to another plane
    }
    return;
  }

  if (glide) {
    glide.t += dt;
    const e = THREE.MathUtils.smoothstep(glide.t, 0, glide.dur);
    st.angle = st.target = glide.from + (glide.to - glide.from) * e;
    st.vel = 0;
    if (glide.t >= glide.dur) {
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
