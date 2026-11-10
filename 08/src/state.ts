import * as THREE from 'three';
import { mul, rotPlane, type M4 } from './tesseract';

// Shared mutable state between the scene and the page. Read every frame, no React in the loop.
//
// One plane at a time. The machine turns in XW, YW or ZW, never two at once: compose turns in two planes and an edge
// can point straight at the eye, and a strut would have to shrink to nothing. But after a quarter turn the tesseract
// stands on itself again (a cell has moved to the next place), so the next quarter can go in any plane. The pose is a
// base of whole quarter turns, a signed permutation of the axes, and one live angle in one plane on top of it.
//
// On its own the machine holds its shape and glides a quarter turn at each catch. Hard mode turns it evenly all the
// time, changing plane as it passes each quarter, and every so often the servo cuts in: the spin stops dead and a
// burst of quick quarter turns snaps through, some staggered in uneven lurches, each landing with a small overshoot.
export const st = {
  plane: 0, // 0 1 2: the axis turning with w right now
  base: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] as M4, // the quarter turns done so far
  angle: 0.3, // radians in the live plane
  target: 0.3, // where the servo is told to be
  vel: 0,
  next: 0, // seconds until the servo's next move in a burst
  burstIn: 8, // seconds until the next burst, in hard mode
  bursting: false, // the servo has the machine: the hard mode's spin waits
  settling: false, // let go after an alt-drag: the servo takes it to the nearest whole quarter
  cranking: false, // an alt-drag has it: nothing else turns it
  way: 1, // which way it turns, +1 or -1: the last drag, or a flip now and then
  flipIn: 12, // seconds until it turns round on its own
  spinVel: 0, // the hard mode's speed, eased towards HARD_SPIN * way so a flip is a swing, not a knock
  transform: true, // the transform switch: the machine turns in 4D all the time, evenly and softly, changing plane at each quarter
  hard: false, // hard mode: the machine turns in 4D all the time, changing plane as it passes each quarter
  /** The eye's rooms, hairlines only now (g went round them): 'drawing', the outlined tubes with dash-dot centre lines and detail circles
   * over them, as an architect's drawing; 'outline', the tubes alone; 'hairline', a pixel line each, circles at the joints. */
  grid: false, // the camera grid: the rooms in the eye's view, or the piece alone in the paper; off on its own, on at the controls
  eye: 'hairline' as 'drawing' | 'outline' | 'hairline',
  inout: false, // the hand-over at a wall: false, both halves at once, folded at the wall; true (o), the body goes all the way in, then comes out
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
  spin: true, // the turntable switch: off, the camera stays where it is left
  follow: false, followK: 0, // the follow switch, and 0 to 1 eased: the camera in close on the device, going round it
  focus: new THREE.Vector3(), // where the camera looks: the machine's middle, leaning towards the device on the turntable
  camera: null as THREE.Camera | null, // the main camera, for a drag to see where the machine's axes point on the page
  machine: null as THREE.Object3D | null, // the machine's parts, for the follow camera to see what is in its way
};

// in dev, the state on the page for scripted checks
if (import.meta.env.DEV) Object.assign(window, { __st: st, __rig: rig });

const HARD_SPIN = 0.4; // rad/s, the hard mode's turn in 4D
const SOFT_SPIN = 0.22; // rad/s, transform's: the same turn, softer
const BURST_EVERY: [number, number] = [6, 14]; // seconds between the servo's bursts, in hard mode
const PITCH_MAX = 1.4; // radians the orbit goes up or down at most
const TURNTABLE = 0.07; // rad/s, the camera's slow orbit in the attract mode, a revolution in a minute and a half
const QUARTER = Math.PI / 2;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** The whole 4D rotation right now: the live plane's turn on top of the base. */
export const pose = (): M4 => mul(rotPlane(st.plane, st.angle), st.base);

/** Stiff spring, a touch under critical: a step lands with one small overshoot, no wobble. */
const SERVO = { k: 160, zeta: 0.68 };

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

/** The servo's burst, queued: first a snap to the next quarter the way it is turning, then one to three more quarter
 * turns, each whole or in two or three uneven lurches, quick, with a breath between. */
const queue: { delta: number; wait: number }[] = [];
function burst() {
  st.bursting = true;
  st.target = st.angle; st.vel = st.spinVel; st.next = 0; // from where the spin is, at its speed
  const w = st.way;
  queue.push({ delta: (Math.floor((st.angle * w) / QUARTER + 1e-6) + 1) * QUARTER * w - st.angle, wait: rnd(0.28, 0.45) });
  for (let n = 1 + Math.floor(Math.random() * 3); n > 0; n--) {
    const parts = pick<number[]>([[[1], 5], [[0.65, 0.35], 3], [[0.5, 0.3, 0.2], 2]]);
    parts.forEach((f, i) => queue.push({ delta: w * QUARTER * f, wait: i === parts.length - 1 ? rnd(0.25, 0.45) : rnd(0.09, 0.15) }));
  }
}

/** A drag on the orbit: `dy` radians of yaw and `dp` of pitch, over `dt` seconds; the speed is kept, smoothed, to
 * coast on once it is let go. */
export function orbitBy(dy: number, dp: number, dt: number) {
  rig.orbiting = true;
  rig.yaw += dy;
  rig.pitch = THREE.MathUtils.clamp(rig.pitch + dp, -PITCH_MAX, PITCH_MAX);
  rig.orbitVel[0] += (dy / dt - rig.orbitVel[0]) * 0.5; rig.orbitVel[1] += (dp / dt - rig.orbitVel[1]) * 0.5;
}

/** An alt-drag turns the machine by hand. It takes over from a glide, a burst or a settle. The plane is the drag's to
 * pick, but only while the machine stands on a whole quarter: with a turn part done, another plane would be another
 * pose and it would jump. Returns the plane it turns in. */
export function crankStart(plane: number): number {
  glide = null; st.settling = false; st.cranking = true;
  if (st.bursting) { st.bursting = false; queue.length = 0; st.burstIn = rnd(...BURST_EVERY); }
  st.target = st.angle; st.vel = 0; st.spinVel = 0;
  const q = Math.round(st.angle / QUARTER);
  if (Math.abs(st.angle - q * QUARTER) < 1e-3) {
    if (q !== 0) fold(q);
    st.angle = st.target = 0; st.plane = plane;
  }
  return st.plane;
}
/** `d` radians in the live plane, by hand; the way it goes is the way it turns from then on, and each whole quarter
 * is banked, in the same plane, so the drag goes on as it started. */
export function crankBy(d: number) {
  st.angle += d; st.target = st.angle; st.vel = 0;
  if (d) st.way = Math.sign(d);
  if (Math.abs(st.angle) >= QUARTER) { const p = st.plane; fold(Math.trunc(st.angle / QUARTER)); st.plane = p; }
}
/** Let go: the servo takes it on to the nearest whole quarter, with its small overshoot, so the next drag can pick any
 * plane. In hard mode the spin just picks up from there. */
export function crankEnd() {
  st.cranking = false;
  if (st.hard || st.transform) return;
  st.target = Math.round(st.angle / QUARTER) * QUARTER;
  st.settling = true;
}

export function tick(dt: number) {
  // the turntable: the camera orbits slowly on its own, in the attract mode
  if (rig.turntable && rig.spin) rig.yaw += TURNTABLE * dt;
  // the orbit coasts after a drag, slowing over a second or two
  if (!rig.orbiting && (rig.orbitVel[0] || rig.orbitVel[1])) {
    rig.yaw += rig.orbitVel[0] * dt;
    rig.pitch = THREE.MathUtils.clamp(rig.pitch + rig.orbitVel[1] * dt, -PITCH_MAX, PITCH_MAX);
    const k = Math.exp(-dt * 2.5);
    rig.orbitVel[0] *= k; rig.orbitVel[1] *= k;
    if (Math.abs(rig.orbitVel[0]) + Math.abs(rig.orbitVel[1]) < 1e-3) rig.orbitVel[0] = rig.orbitVel[1] = 0;
  }
  if (st.cranking) return; // by hand: nothing else turns it
  st.flipIn -= dt;
  if (st.flipIn <= 0) { st.way = -st.way; st.flipIn = 8 + Math.random() * 14; }

  if (st.hard || st.transform) {
    glide = null; st.settling = false;
    // transform alone is the soft one: the same even turn, slower, and no servo cutting in
    if (!st.hard && st.bursting) { st.bursting = false; queue.length = 0; st.target = st.angle; st.vel = 0; }
    if (st.bursting) {
      // the servo has it: each move on its cue, the spring after it; once the last has landed and settled, bank the
      // quarters, change plane, and let the spin pick up again from still
      st.next -= dt;
      if (queue.length && st.next <= 0) { const q = queue.shift()!; st.target += q.delta; st.next = q.wait; }
      [st.angle, st.vel] = spring(st.angle, st.vel, st.target, dt, SERVO);
      if (!queue.length && st.next <= 0 && Math.abs(st.target - st.angle) < 2e-3 && Math.abs(st.vel) < 0.03) {
        st.angle = st.target; st.vel = 0; st.spinVel = 0;
        const q = Math.round(st.angle / QUARTER);
        if (q !== 0) fold(q);
        st.bursting = false; st.burstIn = rnd(...BURST_EVERY);
      }
      return;
    }
    if (st.hard) {
      st.burstIn -= dt;
      if (st.burstIn <= 0) { burst(); return; }
    }
    // an even turn all the time, turning round now and then; past each quarter it is banked, what little is left
    // over dropped (a frame's worth at most), and the turn goes on in another plane
    st.spinVel += ((st.hard ? HARD_SPIN : SOFT_SPIN) * st.way - st.spinVel) * Math.min(1, dt * 1.2);
    st.angle += st.spinVel * dt;
    st.target = st.angle; st.vel = 0;
    if (Math.abs(st.angle) >= QUARTER) {
      const q = Math.sign(st.angle);
      st.angle = st.target = q * QUARTER;
      fold(q); // banked to an exact quarter, so fold moves on to another plane
    }
    return;
  }
  // out of hard mode mid-burst: the servo lets go where the machine is
  if (st.bursting) { st.bursting = false; queue.length = 0; st.target = st.angle; st.vel = 0; }

  if (st.settling) {
    [st.angle, st.vel] = spring(st.angle, st.vel, st.target, dt, SERVO);
    if (Math.abs(st.target - st.angle) < 2e-3 && Math.abs(st.vel) < 0.03) {
      st.angle = st.target; st.vel = 0; st.settling = false;
      const q = Math.round(st.angle / QUARTER);
      if (q !== 0) fold(q);
    }
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
  }
}

/** One quarter turn as a glide, eased in and out over `dur` seconds: the machine changes shape when the device has
 * taken a piece, and holds between. */
let glide: { from: number; to: number; t: number; dur: number } | null = null;
export function turnGlide(dur = 2) {
  if (st.cranking) return; // in a hand that has it, the catch's turn is the hand's
  st.settling = false; st.vel = 0;
  const q = Math.round(st.target / QUARTER);
  if (q !== 0) fold(q);
  // to an exact quarter, so the bank at the end leaves nothing over and the pose is continuous through it
  const dir = (Math.random() < 0.1 ? -1 : 1) * st.way;
  glide = { from: st.angle, to: (Math.round(st.angle / QUARTER) + dir) * QUARTER, t: 0, dur };
}
