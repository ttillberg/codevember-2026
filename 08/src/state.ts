import * as THREE from 'three';
import { mul, rotPlane, type M4 } from './tesseract';

// Shared mutable state between the scene and the page. Read every frame, no React in the loop.
//
// One plane at a time. The machine turns in XW, YW or ZW, never two at once: compose turns in two planes and an edge
// can point straight at the eye, and a strut would have to shrink to nothing. But after a quarter turn the tesseract
// stands on itself again (a cell has moved to the next place), so the next quarter can go in any plane. The pose is a
// base of whole quarter turns, a signed permutation of the axes, and one live angle in one plane on top of it.
//
// On its own the machine holds its shape and glides a quarter turn at each catch; AUTOTRANSFORM swings it to and fro.
// (A hard mode, an even spin with the servo cutting in now and then with bursts of quick quarter turns, was dropped.)
export const st = {
  plane: 0, // 0 1 2: the axis turning with w right now
  base: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] as M4, // the quarter turns done so far
  angle: 0, // radians in the live plane; 0 to start, the tesseract at rest, the small cube square in the middle of the big one (0.3, a little turned, for a while, when it turned on its own from the start)
  target: 0, // where the servo is told to be
  vel: 0,
  settling: false, // let go after an alt-drag: the servo takes it to the nearest whole quarter
  cranking: false, // an alt-drag has it: nothing else turns it
  way: 1, // which way it turns, +1 or -1: the last drag, or a flip now and then
  flipIn: 12, // seconds until it turns round on its own
  spinVel: 0, // transform's speed, eased towards SOFT_SPIN * way so a flip is a swing, not a knock
  transform: false, // the transform switch, off to start (on for a while, and off before that), and the play/pause button bottom middle: the machine turns in 4D all the time, evenly and softly, changing plane at each quarter
  grid: true, // the camera grid, on to start: the eye's view behind the machine, or none
  inout: false, // the hand-over at a wall: false, both halves at once, folded at the wall, straight through; true (o), the body goes all the way in, then comes out (on to start for a moment)
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
  chaseK: 0, // at the controls, 0 to 1 eased: the camera behind the probe
  attract: false, // ATTRACT: the camera cuts between shots on a beat, on its own
  view: 'free' as 'free' | 'back' | 'side' | 'top', // following, where from: round it by the drag, or behind, beside or over the probe by its own turn
  focus: new THREE.Vector3(), // where the camera looks: the machine's middle, leaning towards the device on the turntable
  camera: null as THREE.Camera | null, // the main camera, for a drag to see where the machine's axes point on the page
};

// in dev, the state on the page for scripted checks
if (import.meta.env.DEV) Object.assign(window, { __st: st, __rig: rig });

const SOFT_SPIN = 0.22; // rad/s, transform's even turn in 4D (it swung to and fro either way of a quarter, breathing, for a while)
const PITCH_MAX = 1.4; // radians the orbit goes up or down at most
const TURNTABLE = 0.07; // rad/s, the camera's slow orbit in the attract mode, a revolution in a minute and a half
const QUARTER = Math.PI / 2;

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

/** A drag on the orbit: `dy` radians of yaw and `dp` of pitch, over `dt` seconds; the speed is kept, smoothed, to
 * coast on once it is let go. */
// A hand on it stops it doing so on its own: after a turn by hand in 4D the transform waits, after an orbit by hand
// the turntable waits, each IDLE seconds from the last touch, then picks up again (they ran on through it for a while).
const IDLE = 30;
let clock = 0, handAt = -Infinity, orbitAt = -Infinity;
/** AUTOTRANSFORM switched on: it starts now, not IDLE after the last hand on the machine (it waited, and on a phone,
 * a finger having touched a strut, it looked dead for half a minute). */
export function transformNow() { handAt = -Infinity; }
/** TURNTABLE switched on: the same, it turns now, not IDLE after the last orbit by hand. */
export function turntableNow() { orbitAt = -Infinity; }
/** Out of ATTRACT with the switch off: the servo takes the turn on to the nearest whole quarter, not left part way. */
export function settleTurn() { if (st.transform || st.cranking) return; st.target = Math.round(st.angle / QUARTER) * QUARTER; st.settling = true; }
export function orbitBy(dy: number, dp: number, dt: number) {
  orbitAt = clock;
  rig.orbiting = true;
  rig.yaw += dy;
  rig.pitch = THREE.MathUtils.clamp(rig.pitch + dp, -PITCH_MAX, PITCH_MAX);
  rig.orbitVel[0] += (dy / dt - rig.orbitVel[0]) * 0.5; rig.orbitVel[1] += (dp / dt - rig.orbitVel[1]) * 0.5;
}

/** An alt-drag turns the machine by hand. It takes over from a glide or a settle. The plane is the drag's to
 * pick, but only while the machine stands on a whole quarter: with a turn part done, another plane would be another
 * pose and it would jump. Returns the plane it turns in. */
export function crankStart(plane: number): number {
  handAt = clock;
  glide = null; st.settling = false; st.cranking = true;
  st.target = st.angle; st.vel = 0; st.spinVel = 0;
  if (Math.abs(st.angle - Math.round(st.angle / QUARTER) * QUARTER) < 1e-3) {
    bank();
    st.angle = st.target = 0; st.plane = plane;
  }
  return st.plane;
}
/** The whole quarters turned so far folded into the pose, in another plane (`fold`), what is left over kept. */
function bank() { const q = Math.round(st.angle / QUARTER); if (q !== 0) fold(q); }
/** `d` radians in the live plane, by hand; the way it goes is the way it turns from then on, and each whole quarter
 * is banked, in the same plane, so the drag goes on as it started. */
export function crankBy(d: number) {
  handAt = clock;
  st.angle += d; st.target = st.angle; st.vel = 0;
  if (d) st.way = Math.sign(d);
  if (Math.abs(st.angle) >= QUARTER) { const p = st.plane; fold(Math.trunc(st.angle / QUARTER)); st.plane = p; }
}
/** Let go: the servo takes it on to the nearest whole quarter, with its small overshoot, so the next drag can pick any
 * plane. */
export function crankEnd() {
  st.cranking = false; handAt = clock;
  st.target = Math.round(st.angle / QUARTER) * QUARTER;
  st.settling = true;
}

export function tick(dt: number) {
  clock += dt;
  if (rig.orbiting) orbitAt = clock;
  // the turntable: the camera orbits slowly on its own, in the attract mode, but not for IDLE after a hand on it
  if (rig.turntable && rig.spin && clock - orbitAt > IDLE) rig.yaw += TURNTABLE * dt;
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

  // transform waits IDLE after the last turn by hand
  // in ATTRACT it turns too, whatever the switch: the joints move for their close-ups
  if ((st.transform && clock - handAt > IDLE) || rig.attract) {
    glide = null; st.settling = false;
    // an even turn all the time, turning round now and then; past each quarter it is banked, what little is left
    // over dropped (a frame's worth at most), and the turn goes on in another plane (it breathed, to and fro either
    // way of a quarter, for a while)
    st.spinVel += (SOFT_SPIN * st.way - st.spinVel) * Math.min(1, dt * 1.2);
    st.angle += st.spinVel * dt;
    st.target = st.angle; st.vel = 0;
    if (Math.abs(st.angle) >= QUARTER) {
      const q = Math.sign(st.angle);
      st.angle = st.target = q * QUARTER;
      fold(q); // banked to an exact quarter, so fold moves on to another plane
    }
    return;
  }

  if (st.settling) {
    [st.angle, st.vel] = spring(st.angle, st.vel, st.target, dt, SERVO);
    if (Math.abs(st.target - st.angle) < 2e-3 && Math.abs(st.vel) < 0.03) {
      st.angle = st.target; st.vel = 0; st.settling = false;
      bank();
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
      bank();
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
