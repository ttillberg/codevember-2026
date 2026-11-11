import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Environment, Lightformer } from '@react-three/drei';
import { Machine } from './Machine';
import { Drones } from './Drones';
import { DroneCam, eyeView, regionsOf, page } from './DroneCam';
import { Grip, grip, strutAt, strutW, PICK_TOUCH } from './Grip';
// CellMap (./CellMap.tsx), the cells' little map with their colours, is off the page for now
import { drone, target } from './drone';
import { st, rig, orbitBy, crankStart, crankBy, crankEnd, pose, transformNow, turntableNow, settleTurn } from './state';
import { project, VERTS, EDGES } from './tesseract';
import { dof } from './dof';

const PARAMS = new URLSearchParams(location.search);
const CLEAN = PARAMS.has('clean'); // no page furniture, for the screengrab: the first person view maximized, a faint ground
// the probe in from the start, for the screengrab (no button to press under ?clean), followed as it comes in by the
// button, but orbited for the screengrab
// the probe is in from the start (an ACTIVATE PROBE button brought it in, for a while), the camera free, ORBIT
// (followed to start, for a while); under ?clean only with ?probe
if (!CLEAN || PARAMS.has('probe')) drone.on = true;
if (CLEAN) { eyeView.max = true; page.clean = true; }

// Two modes, the same two views in both: the machine fills the page, the eye's view the right third behind it.
// Auto, the attract mode: the device flies on its own, the camera turns slowly on a turntable, a drag orbits it.
// Manual: a drag anywhere is the look, shift-drag orbits, or with the pointer locked (l) the mouse itself is the
// look; w s and the up and down arrows go forward and back, a d and the side arrows strafe, space is forward too.
// In both an alt-drag turns the machine in 4D by hand.


// The three modes, pills under MODE, nothing more (a line on the one picked under them before): on its own the camera orbits the machine or follows
// the beetle; the pilot is at the controls.
type Mode = 'attract' | 'orbit' | 'follow' | 'probe' | 'pilot';
// in this order: ORBIT, FOLLOW, PILOT, from the farthest to the controls (follow, pilot, orbit for a moment)
const MODES: [Mode, string][] = [
  ['attract', 'Demo'],
  ['orbit', 'Orbit'],
  ['follow', 'Follow'],
  ['pilot', 'Pilot'],
];

/** Folds itself away on a tap anywhere outside `ref`, while `open`. */
function useAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  return ref;
}
const hold = (e: React.PointerEvent) => { e.preventDefault(); e.stopPropagation(); };

/** The settings, top right beside the mode: a wheel, and a tap opens a card under it with AUTOTRANSFORM, a checkbox
 * row (a phone's only, AUTOTRANSFORM on its own on a desktop, for a while). */
/** One checkbox row of the settings' card. */
const Check = ({ on, toggle, children }: { on: boolean; toggle: () => void; children: React.ReactNode }) => (
  <button className={on ? 'at' : ''} role="checkbox" aria-checked={on} tabIndex={-1} onPointerDown={hold} onClick={toggle}>
    <i className="box" aria-hidden>{on ? <svg width={8} height={8} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3.2L13 4.5" /></svg> : null}</i>{children}
  </button>
);
function Settings({ transform, toggle, turntable, toggleTurntable, blur, toggleBlur }: { transform: boolean; toggle: () => void; turntable: boolean; toggleTurntable: () => void; blur: boolean; toggleBlur: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useAway(open, () => setOpen(false));
  return (
    <div ref={ref} className={`settings ${open ? 'open' : ''}`}>
      <button className="wheel" tabIndex={-1} aria-label="Settings" aria-expanded={open} onPointerDown={hold} onClick={() => setOpen(!open)}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx={12} cy={12} r={3} />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open ? <div className="list">
        <Check on={transform} toggle={toggle}>Autotransform</Check>
        {/* the camera's slow turn round the machine, off to start (no switch for it, for a while) */}
        <Check on={turntable} toggle={toggleTurntable}>Turntable</Check>
        {/* the depth of field, on to start: off, the machine sharp all through, and cheaper */}
        <Check on={blur} toggle={toggleBlur}>Depth of field</Check>
      </div> : null}
    </div>
  );
}

/** A phone's mode, top right: the mode it is in and a chevron, and a tap opens the three under it, frosted, the one it
 * is in darker; a tap on one picks it, a tap anywhere else folds it. On a desktop too now (the pills there, for a while). */
function ModeMenu({ mode, pick }: { mode: Mode; pick: (m: Mode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useAway(open, () => setOpen(false));
  const stop = hold;
  return (
    <div ref={ref} className={`modemenu ${open ? 'open' : ''}`}>
      <button className="now" tabIndex={-1} aria-haspopup="listbox" aria-expanded={open} onPointerDown={stop} onClick={() => setOpen(!open)}>
        {MODES.find(([m]) => m === mode)?.[1] ?? 'Probe'}
        <svg width={9} height={9} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3.5 6 8 10.5 12.5 6" /></svg>
      </button>
      {open ? <div className="list" role="listbox" aria-label="Mode">
        {MODES.map(([m, name]) => <button key={m} className={mode === m ? 'at' : ''} role="option" aria-selected={mode === m} tabIndex={-1}
          onPointerDown={stop} onClick={() => { pick(m); setOpen(false); }}>{name}</button>)}
      </div> : null}
    </div>
  );
}

// the turntable and the transform off to start (both on, then the turntable alone, for a while); no switch for the
// turntable, AUTOTRANSFORM and T for the transform
// ATTRACT to start on a desktop, till the mouse first moves (or a key, or the wheel); a phone starts in ORBIT
const ATTRACT_FIRST = !CLEAN && !matchMedia('(max-width: 640px), (max-height: 500px), (pointer: coarse)').matches;
if (ATTRACT_FIRST) rig.attract = true;
rig.spin = true; // the turntable on to start, a switch for it in the wheel's card (off, for a while)


// A phone's tilt (its device orientation, the gyroscope): leaning it turns the view a little round the machine, from how
// it was held when the tilt came on. Asked for at the first touch's end (iOS wants a gesture and a yes); elsewhere it
// just starts. TILT_K: degrees of view for a degree of lean; TILT_MAX the most either way.
const tilt = { asked: false, base: null as null | [number, number], want: [0, 0], now: [0, 0] };
const TILT_K = 0.7, TILT_MAX = THREE.MathUtils.degToRad(28);
function tiltOn() {
  if (tilt.asked || typeof DeviceOrientationEvent === 'undefined') return;
  tilt.asked = true;
  const listen = () => addEventListener('deviceorientation', (e) => {
    if (e.beta == null || e.gamma == null) return;
    // the lean across and the lean back, as the screen is turned (on its side the two swap)
    const a = (screen.orientation?.angle ?? 0) % 360;
    const across = a === 90 ? e.beta : a === 270 || a === -90 ? -e.beta : a === 180 ? -e.gamma : e.gamma;
    const back = a === 90 ? -e.gamma : a === 270 || a === -90 ? e.gamma : a === 180 ? -e.beta : e.beta;
    tilt.base ??= [across, back];
    const c = (v: number) => THREE.MathUtils.clamp(THREE.MathUtils.degToRad(v * TILT_K), -TILT_MAX, TILT_MAX);
    tilt.want = [c(across - tilt.base[0]), c(back - tilt.base[1])];
  });
  const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof D.requestPermission === 'function') D.requestPermission().then((s) => { if (s === 'granted') listen(); }).catch(() => {});
  else listen();
}

/** The machine and the device on a rig with a fixed tilt; the camera orbits round it. */
function Rig({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera, size }, dt) => {
    ref.current?.quaternion.copy(rig.q);
    rig.camera = camera;
    // the distance fits the machine's reach to the page, whichever way is narrower, with a margin; eased, so the
    // picture breathes as the machine changes shape rather than jumps; the wheel scales it
    const cam = camera as THREE.PerspectiveCamera;
    // the machine has its own part of the window, never under the text (regionsOf): it fits that part, and is moved
    // into it (below), both eased, so the probe coming in slides it over
    const { main, aim } = regionsOf(size.width, size.height);
    const k = part.w ? Math.min(1, dt * 3) : 1;
    // its middle, or off it where the phone's view disc would hide the probe
    const ax = aim?.x ?? main.x + main.w / 2, ay = aim?.y ?? main.y + main.h / 2;
    part.x += (ax - part.x) * k; part.y += (ay - part.y) * k;
    part.w += (main.w - part.w) * k; part.h += (main.h - part.h) * k;
    const t = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const vfov = 2 * Math.atan(t * (part.h / size.height)), hfov = 2 * Math.atan(t * (part.w / size.height));
    // an upright phone's home page: a third bigger than the fit, out past the sides (the width is what holds it in)
    const home = size.width <= 640 && size.height > size.width && !drone.on && !page.boxed ? HOME_BIG : 1; // in the box, just the fit
    const fit = (st.reach * 1.0) / Math.sin(Math.min(vfov, hfov) / 2) / home;
    rig.zoom += (fit * rig.zoomK - rig.zoom) * Math.min(1, dt * 2.5);
    // on the turntable the look leans towards the device a part of the way from the machine's middle, slowly, so it
    // follows the flight without chasing it; and eases back to the middle off it
    const lean = rig.turntable && rig.spin && drone.on ? FOCUS : 0; // no beetle, the middle
    project(pose(), drone.p, focusAt).applyQuaternion(rig.q).multiplyScalar(lean);
    const sdt = drone.frozen ? 0 : dt; // P: what goes after the beetle holds too; a drag and the wheel still go
    rig.focus.lerp(focusAt, Math.min(1, sdt * 0.8));
    // a phone's lean, eased, on top of the orbit
    tilt.now[0] += (tilt.want[0] - tilt.now[0]) * Math.min(1, dt * 6); tilt.now[1] += (tilt.want[1] - tilt.now[1]) * Math.min(1, dt * 6);
    const yaw = rig.yaw - tilt.now[0], pitch = THREE.MathUtils.clamp(rig.pitch + tilt.now[1] * 0.6, -1.4, 1.4);
    camera.position.setFromSphericalCoords(rig.zoom, Math.PI / 2 - pitch, yaw);
    // follow (the switch): the same orbit, round the beetle instead of the machine's middle, nearer; eased in and out
    tail.lerp(drone.world, Math.min(1, sdt * (rig.close ? CLOSE_LAG * 2 : FOLLOW_EASE))); // in close, the look right on it
    if (rig.followK < 0.001) lag.copy(tail); // not following: the camera's own catch-up starts from where the look is
    lag.lerp(tail, Math.min(1, sdt * (rig.close ? CLOSE_LAG : FOLLOW_LAG))); // in close, the camera keeps up
    // on its own, the switch
    rig.followK += ((rig.follow && !drone.pilot ? 1 : 0) - rig.followK) * Math.min(1, dt * 2); // at the controls the chase, below (the follow on a phone for a while)
    const fk = rig.followK;
    // the probe's own way and up in the world, eased, for the views by its turn and the chase
    const ve = Math.min(1, sdt * CHASE_EASE);
    chaseFwd.lerp(drone.worldFwd, ve).normalize(); chaseUp.lerp(drone.worldUp, ve).normalize();
    let upWant = WORLD_UP;
    if (fk > 0.001) {
      const D = rig.close ? PROBE_D : rig.zoom * (size.width <= 640 || size.height <= 500 ? FOLLOW_PHONE : FOLLOW);
      if (rig.view === 'free') off.setFromSphericalCoords(D, Math.PI / 2 - THREE.MathUtils.clamp(pitch, -LEVEL, LEVEL), yaw);
      else {
        // behind it, beside it or over it, by its own turn (the follow went round by the drag alone for a while)
        sideV.crossVectors(chaseFwd, chaseUp).normalize();
        if (rig.view === 'back') off.copy(chaseFwd).multiplyScalar(-D).addScaledVector(chaseUp, D * 0.25);
        else if (rig.view === 'side') off.copy(sideV).multiplyScalar(D).addScaledVector(chaseUp, D * 0.15);
        else { off.copy(chaseUp).multiplyScalar(D).addScaledVector(chaseFwd, -D * 0.2); upWant = chaseFwd; }
      }
      viewOff.lerp(off, Math.min(1, sdt * 3)); // a change of view glides
      look.copy(rig.focus).lerp(tail, fk);
      camera.position.lerp(followAt.copy(lag).add(viewOff), fk);
    } else { look.copy(rig.focus); viewOff.copy(camera.position).sub(lag); }
    camUp.lerp(upWant, Math.min(1, dt * 3)).normalize(); camera.up.copy(camUp); // over it, the camera's up its way, not the sky's
    // at the controls, the chase: from behind the probe and a little over it, looking past it the way it flies, eased
    // after it so a turn swings the view round rather than snapping it (the usual camera, and on a phone the follow,
    // for a while)
    rig.chaseK += ((drone.pilot ? 1 : 0) - rig.chaseK) * Math.min(1, dt * 2);
    if (rig.chaseK > 0.001) {
      // 45 degrees round from straight behind, to its right, so it is seen three-quarters and its way still reads
      // (straight behind, for a while)
      sideV.crossVectors(chaseFwd, chaseUp).normalize();
      chaseAt.copy(drone.world).addScaledVector(chaseFwd, -CHASE_BACK * Math.cos(CHASE_YAW)).addScaledVector(sideV, CHASE_BACK * Math.sin(CHASE_YAW)).addScaledVector(chaseUp, CHASE_UP);
      chaseLook.copy(drone.world).addScaledVector(chaseFwd, CHASE_AHEAD);
      camera.position.lerp(chaseAt, rig.chaseK);
      look.lerp(chaseLook, rig.chaseK);
    }
    if (rig.attract) directShot(camera, dt, sdt, size.width <= 640 || size.height <= 500);
    else attract.on = false;
    camera.lookAt(look);
    // into its part: the picture slid so the page's middle lands on the part's (it was the beetle two thirds across,
    // following, and then the left half, split)
    const ox = size.width / 2 - part.x, oy = size.height / 2 - part.y;
    if (Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5) cam.setViewOffset(size.width, size.height, ox, oy, size.width, size.height);
    else if (cam.view?.enabled) cam.clearViewOffset();
    // the depth of field on what the camera looks at, the beetle when following; nearer, the blur deeper, as a lens's
    dof.focus.copy(look).lerp(drone.world, rig.chaseK); // chasing, on the probe, not past it
    dof.aperture = THREE.MathUtils.lerp(DOF_WIDE, rig.close ? DOF_CLOSE : DOF_FOLLOW, fk); // in close, shallow
    dof.skip = !rig.follow && !drone.pilot; // in ORBIT none, whatever the switch: the whole machine sharp (on there too, for a while)
    if (rig.attract) { dof.skip = attract.kind === 'wide' || attract.kind === 'flyover' || attract.kind === 'edge'; dof.focus.copy(attract.focus); dof.aperture = attract.kind === 'follow' ? DOF_FOLLOW : attract.kind === 'ball' ? DOF_FOLLOW * 0.4 : DOF_CLOSE; } // the ball so near, a narrow blur, or it goes soft across its own depth // in ATTRACT on what the shot is of, but for the wide shots
  });
  return <group ref={ref}>{children}</group>;
}
// PROBE: the follow in close on the probe, as near as a close-up, the camera keeping right up with it, the drag going round it
const PROBE_D = 0.5, CLOSE_LAG = 6;
const FOCUS = 0.3; // how far the turntable's look leans from the machine's middle to the device
const DOF_CLOSE = 0.016; // ATTRACT's close-ups: a shallow focus, the probe sharp and the struts round it soft

// ATTRACT: the camera cuts, hard, between shots on a strict beat, as a trailer cut to music would: every cut lands on
// the beat, at a tempo that can be set (TEMPO in the wheel's card, or tapped in); close shots last one beat, follows
// and far shots two; a wall gone through or a piece caught makes the next cut, on the next beat, a close-up (it cut in
// at once, off the beat, for a while). The beat runs on the page's own clock, so a pause or a slow frame does not
// shift it. It runs after the rest of the rig, over whatever the orbit and the follow eased.
const attract = {
  on: false, t: 0, bpm: 40, beats: 0, left: 1, pending: false, clock: 0, span: 1.5, edge: 0, along: 0.5, // the tempo; beats run, as a fraction; beats left in this shot; a close-up asked for
 kind: 'wide' as 'wide' | 'flyover' | 'edge' | 'follow' | 'close' | 'ball' | 'smoke' | 'joint', flow: 1,
  yaw: 0, pitch: 0, dist: 1, view: 0, dir: new THREE.Vector3(), drift: 0, crossings: -1, taken: 0, joint: 0,
  focus: new THREE.Vector3(), // what the shot is of, for the depth of field
};
// the follows: from where round the probe, in its own frame (ahead, to its right, up), and the camera's up its way or
// the sky's
const FOLLOWS: { at: [number, number, number]; upFwd?: boolean }[] = [
  { at: [-1, 0, 0.3] }, // behind and a little over
  { at: [0, 1, 0.15] }, // beside
  { at: [-0.25, 0, 1], upFwd: true }, // over it, looking down its back
  { at: [1, 0.2, 0.15] }, // ahead, coming at the camera
  { at: [-0.7, -0.5, -0.45] }, // under and behind, looking up at it
  { at: [0.6, -0.8, 0.3] }, // three-quarters ahead
];
const sv = new THREE.Vector3(), pv = new THREE.Vector3();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
function nextShot(early: boolean) {
  const a = attract;
  // a wall or a catch: a close-up; else, by chance: a wide, a far one from outside the machine, the probe close, the
  // ball close, the smoke, a joint close as it moves, or a follow (the ball only while there is one up)
  const r = Math.random();
  // (far shots from well outside it, for a while: little use; a fly-over now, and slow runs along the edges inside)
  a.kind = early ? 'close' : r < 0.1 ? 'wide' : r < 0.22 ? 'flyover' : r < 0.36 ? 'edge' : r < 0.47 ? 'close' : r < 0.56 ? (target.up ? 'ball' : 'close') : r < 0.64 ? 'smoke' : r < 0.71 ? 'joint' : 'follow';
  a.left = a.kind === 'follow' || a.kind === 'flyover' || a.kind === 'edge' ? 2 : 1; // in beats
  a.span = (a.left * 60) / a.bpm; // the shot's length in seconds, for a move that crosses it whole
  // along an edge of the outer cube as it stands now (the twelve farthest from the middle), in between it and the inner
  // one, clear of both (any of the 32, for a moment: inside the inner struts, or in a joint)
  { const m4 = pose(), far = EDGES.map((e, i) => ({ i, r: project(m4, VERTS[e.a], sv).add(project(m4, VERTS[e.b], pv)).length() })).sort((x, y) => y.r - x.r);
    a.edge = far[Math.floor(Math.random() * 12)].i; }
  a.along = rand(0.25, 0.75);
  a.joint = Math.floor(Math.random() * VERTS.length);
  a.t = 0;
  // the move carries on over the cut: every shot turns round its subject the same way, at its own steady rate, and
  // the way only changes now and then, not at every cut (each shot drifted its own way, for a while)
  if (Math.random() < FLOW_FLIP) a.flow = -a.flow;
  a.yaw = rand(0, Math.PI * 2); a.pitch = rand(-0.35, 0.9);
  a.dist = rand(0.55, 1.05);
  // follows: from behind it half the time, the rest from any side (any side alike, for a while)
  a.view = Math.random() < 0.5 ? 0 : Math.floor(Math.random() * FOLLOWS.length);
  a.dir.set(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).normalize();
}
function directShot(camera: THREE.Camera, dt: number, sdt: number, phone: boolean) {
  const a = attract;
  if (!a.on) { a.on = true; a.clock = 0; a.crossings = drone.crossings; a.taken = drone.taken; nextShot(false); }
  a.t += sdt;
  // a wall gone through or a piece taken: the next cut is a close-up on it, and comes on the next beat
  if (drone.crossings !== a.crossings || (drone.taken > 0.5 && a.taken <= 0.5)) a.pending = true;
  a.crossings = drone.crossings; a.taken = drone.taken;
  // the beat, on the real clock: a cut only ever on it
  const now = performance.now(); // the wall clock, not the frame's step, which is clamped on a slow frame
  if (a.clock > 0) a.beats += ((now - a.clock) / 1000) * (a.bpm / 60);
  a.clock = now;
  if (a.beats > 4) a.beats %= 1; // back from a hidden tab: on the beat still, without a burst of cuts
  while (a.beats >= 1) {
    a.beats -= 1; a.left -= 1;
    if (a.left <= 0 || a.pending) { const early = a.pending; a.pending = false; nextShot(early); }
  }
  const turn = a.flow * a.t; // seconds into the shot, the way round: the same rates in every shot, so the move runs on
  const up = (camera as THREE.PerspectiveCamera).up;
  if (a.kind === 'wide') {
    // round the machine, a steady sweep, looking at its middle
    camera.position.setFromSphericalCoords(rig.zoom * a.dist, Math.PI / 2 - a.pitch, a.yaw + turn * FLOW_WIDE);
    look.set(0, 0, 0).lerp(drone.world, 0.25);
    up.copy(WORLD_UP);
    return;
  }
  if (a.kind === 'flyover') {
    // over the top of the machine from outside, a straight pass across it, looking down at its middle
    const u = THREE.MathUtils.clamp(a.t / a.span, 0, 1) - 0.5;
    sv.set(Math.cos(a.yaw), 0, Math.sin(a.yaw)); // the way across
    pv.set(-sv.z, 0, sv.x); // to one side of the line, a little
    camera.position.set(0, rig.zoom * FLY_UP, 0).addScaledVector(sv, rig.zoom * FLY_ACROSS * u * a.flow).addScaledVector(pv, rig.zoom * 0.18);
    look.set(0, 0, 0);
    up.copy(WORLD_UP);
    return;
  }
  if (a.kind === 'edge') {
    // inside, slow along one of the struts, a little in from it, looking at the machine's middle: the room going round
    const e = EDGES[a.edge], m4 = pose();
    project(m4, VERTS[e.a], sv).applyQuaternion(rig.q); project(m4, VERTS[e.b], pv).applyQuaternion(rig.q);
    const u = THREE.MathUtils.clamp(a.along + EDGE_RATE * turn, 0.2, 0.8); // clear of the joints at its ends
    camera.position.copy(sv).lerp(pv, u).multiplyScalar(EDGE_IN);
    look.set(0, 0, 0);
    up.copy(WORLD_UP);
    return;
  }
  if (a.kind === 'ball' || a.kind === 'joint') {
    // in close on the piece, or on one of the joints, where it is now: as the machine turns, the camera goes with it
    if (a.kind === 'ball' && !target.up) { nextShot(false); return; }
    project(pose(), a.kind === 'ball' ? target.p : VERTS[a.joint], a.focus).applyQuaternion(rig.q);
    pv.copy(a.dir).applyAxisAngle(WORLD_UP, turn * FLOW_CLOSE);
    camera.position.copy(a.focus).addScaledVector(pv, a.kind === 'ball' ? CLOSE * 0.32 : CLOSE * 1.3);
    look.copy(a.focus);
    up.copy(WORLD_UP);
    return;
  }
  sideV.crossVectors(chaseFwd, chaseUp).normalize();
  if (a.kind === 'smoke') {
    // the wake: a point a way back along it, the camera off to its side, sliding along it the way round goes
    a.focus.copy(drone.world).addScaledVector(chaseFwd, -SMOKE_BACK);
    camera.position.copy(a.focus).addScaledVector(sideV, SMOKE_OUT * a.flow).addScaledVector(chaseUp, SMOKE_OUT * 0.35).addScaledVector(chaseFwd, -SMOKE_OUT * 0.12 * a.t);
    look.copy(a.focus);
    up.copy(chaseUp);
    return;
  }
  a.focus.copy(drone.world);
  if (a.kind === 'follow') {
    const f = FOLLOWS[a.view], D = rig.zoom * (phone ? FOLLOW_PHONE : FOLLOW);
    sv.set(0, 0, 0).addScaledVector(chaseFwd, f.at[0]).addScaledVector(sideV, f.at[1]).addScaledVector(chaseUp, f.at[2]).normalize().applyAxisAngle(chaseUp, turn * FLOW_FOLLOW);
    camera.position.copy(drone.world).addScaledVector(sv, D);
    look.copy(drone.world);
    up.copy(f.upFwd ? chaseFwd : chaseUp);
    return;
  }
  // a close-up: in on the probe from anywhere, going round it
  pv.copy(a.dir).applyAxisAngle(WORLD_UP, turn * FLOW_CLOSE);
  camera.position.copy(drone.world).addScaledVector(pv, CLOSE);
  look.copy(drone.world);
  up.copy(WORLD_UP);
}
const FLOW_WIDE = 0.16, FLOW_CLOSE = 0.35, FLOW_FOLLOW = 0.22;
const FLY_UP = 0.75, FLY_ACROSS = 1.5; // the fly-over: its height over the middle, and how far it goes across, against the fit
const EDGE_RATE = 0.06, EDGE_IN = 0.62; // along a strut: of its length a second, and how far in from it towards the middle // rad/s round the subject, by shot (a push in on the close-ups, for a while)
const FLOW_FLIP = 0.15; // the chance at a cut that the way round turns about
// in dev, a shot on demand for scripted checks: __shot('ball')
if (import.meta.env.DEV) Object.assign(window, { __attract: attract, __shot: (k: typeof attract.kind) => { nextShot(false); attract.kind = k; attract.left = 999; } });
const CLOSE = 0.42; // world units: a close-up's distance from the probe, about four of its radii
const SMOKE_BACK = 0.55, SMOKE_OUT = 0.6; // the wake's shot: how far back along it, and how far off to its side
const look = new THREE.Vector3(), followAt = new THREE.Vector3();
const part = { x: 0, y: 0, w: 0, h: 0 }; // the machine's part of the window, its middle and size, eased
const DOF_WIDE = 0.007, DOF_FOLLOW = 0.009; // the blur at twice the focus distance, against the page's height

// Follow: the orbit round the beetle, and nothing more. The look eases after it, a point that glides rather than
// jumps; the way round is the orbit's own yaw and pitch, which the turntable and a drag turn, so nothing of the
// machine's turn in 4D swings the camera. No higher or lower than LEVEL: straight above or below, the camera's up has
// nothing to hold to and the picture spins. (Shots in turn, from the back, the side, above, and a close-up on the
// catch, were tried first, with cuts and then glides; too much.)
const HOME_BIG = 1.33; // the machine on an upright phone's home page, against the fit
const FOLLOW = 0.18, FOLLOW_PHONE = 0.22; // the distance to the beetle against the fit to the whole machine (0.5 and 0.35, then 0.3 on a desktop, for a while)
const FOLLOW_EASE = 2; // how fast the look goes after the beetle (1/s)
const FOLLOW_LAG = 0.35; // how fast the camera itself catches up with it (1/s): slowly, so it trails the probe and the look turns after it (it went with the look for a while)
const LEVEL = 0.87; // radians, about 50 degrees
const tail = new THREE.Vector3(), lag = new THREE.Vector3(), off = new THREE.Vector3();
const chaseFwd = new THREE.Vector3(0, 0, -1), chaseUp = new THREE.Vector3(0, 1, 0), chaseAt = new THREE.Vector3(), chaseLook = new THREE.Vector3();
const CHASE_YAW = Math.PI / 4; // round from straight behind, to the right
const CHASE_BACK = 1.7, CHASE_UP = 0.4, CHASE_AHEAD = 0.25; // the look all but on the probe: from 45 degrees round, a look far ahead put it off its mark, on a phone behind the view (1, then 2 straight behind) // world units: behind it, over it, and the look ahead of it (2, straight behind; a quarter of these, the probe filling the screen, for a moment)
const sideV = new THREE.Vector3(), viewOff = new THREE.Vector3(), camUp = new THREE.Vector3(0, 1, 0), WORLD_UP = new THREE.Vector3(0, 1, 0);
const CHASE_EASE = 4; // how fast the chase swings round after the probe's turn (1/s)
const focusAt = new THREE.Vector3();

// The keys at the controls, as day 07's help: flat grey caps, and what each does in small caps beside them.
const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
/** The Enter key's mark, a return arrow, drawn, so no font makes it an emoji. */
const EnterMark = () => (
  <svg width={10} height={9} viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-label="Enter"><path d="M10.5 1v4.5H2M4.5 3 2 5.5 4.5 8" /></svg>
);
const Key = ({ children, wide }: { children: React.ReactNode; wide?: boolean }) => <kbd className={`key${wide ? ' wide' : ''}`}>{children}</kbd>;
/** A crosshair, the sight of a first-person game: the pointer lock makes the mouse the look. A ring, four ticks
 * through it with a gap at the middle, a dot there. */
const Crosshair = () => (
  <svg className="icon" width={14} height={14} viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M11 1.5v5M11 15.5v5M1.5 11h5M15.5 11h5" />
    <circle cx="11" cy="11" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);
/** The first person view's corner button: four corners pointing out to maximize, in to minimize. */
const Corners = ({ out }: { out: boolean }) => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={out ? 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4' : 'M6 2v4H2M10 2v4h4M10 14v-4h4M6 14v-4H2'} />
  </svg>
);
/** The first person view's other corner button: an eye while it shows (to hide it), a grid while it is hidden (to
 * bring it back). */
const EyeOrGrid = ({ shown }: { shown: boolean }) => (
  <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {shown
      ? <><path d="M1.5 8C3.2 4.8 5.4 3.3 8 3.3S12.8 4.8 14.5 8C12.8 11.2 10.6 12.7 8 12.7S3.2 11.2 1.5 8Z" /><circle cx="8" cy="8" r="2.2" /></>
      : <path d="M2.5 2.5h11v11h-11zM6.2 2.5v11M9.8 2.5v11M2.5 6.2h11M2.5 9.8h11" />}
  </svg>
);
/** Transform's button: a pause while it turns, a play while it is still. */
const PlayPause = ({ playing }: { playing: boolean }) => (
  <svg width={11} height={11} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    {playing ? <path d="M4 2.5h2.6v11H4zM9.4 2.5H12v11H9.4z" /> : <path d="M4.5 2.3 13.5 8l-9 5.7z" />}
  </svg>
);
// On a phone at the controls the fisheye view is a pad: held in the middle the probe flies forward, and dragged out
// of it, it keeps flying and turns towards the finger; put down outside the middle it only turns, no thrust. It turns
// at the finger's angle from the middle (up and to the right, both at once), for as long as it is held. Outlined
// arrows at the edges and a ring with a dot in the middle show it, the arrow nearest the finger lit. (A dashed ring
// between, forward and turning inside it, for a moment; only the four ways, by quarters, for a while; a FORWARD
// button before.)
type Zone = 'c' | 't' | 'r' | 'b' | 'l' | null;
const PAD_TURN = 1.3; // rad/s, held off the middle
const PAD_MIDDLE = 44; // CSS px from the middle: the middle, where a hold starts the thrust (its ring 64 across)
/** The pad, on a phone at the controls and on a desktop wherever the view is in the column; `take`, pressed away from
 * the controls, takes them first, so the view is always a way in to flying. On a desktop it is only a sign: a drag
 * on the view is the look, as anywhere at the controls, the arrow it goes towards lit, and the ring lit while it
 * flies forward (the keys); holding to fly is a phone's. */
function Pad({ take, shown }: { take: () => void; shown: boolean }) {
  const [zone, setZone] = useState<Zone>(null);
  const held = useRef<Zone>(null);
  const drag = useRef<[number, number] | null>(null); // a desktop's: where the pointer was
  const [going, setGoing] = useState(false); // a desktop's: flying forward, by the keys
  const go = useRef(false); // the hold started in the middle: it flies, wherever the finger goes after
  const dir = useRef<[number, number]>([0, 0]); // the way to turn, a unit vector, x right and y up
  const hold = (z: Zone) => {
    drone.keys.thrust = z !== null && (go.current || z === 'c') ? 1 : 0;
    if (z === held.current) return;
    held.current = z; setZone(z);
  };
  const holdAt = (e: React.PointerEvent, start = false) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2, d = Math.hypot(x, y);
    if (start) go.current = d < PAD_MIDDLE;
    if (d < PAD_MIDDLE) return hold('c');
    dir.current = [x / d, -y / d];
    hold(Math.abs(x) > Math.abs(y) ? (x > 0 ? 'r' : 'l') : (y > 0 ? 'b' : 't'));
  };
  useEffect(() => {
    // an edge held turns it a little every frame (the probe takes its turn a frame at a time)
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!isPhone()) { const g = drone.pilot && drone.keys.thrust > 0; setGoing((was) => (was === g ? was : g)); }
      // the thrust kept on while held: taking the controls clears the keys a frame after the press
      else if (held.current) drone.keys.thrust = go.current || held.current === 'c' ? 1 : 0;
      if (held.current && held.current !== 'c') {
        drone.turn[0] += dir.current[0] * PAD_TURN * dt;
        drone.turn[1] += dir.current[1] * PAD_TURN * dt;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); if (held.current) drone.keys.thrust = 0; };
  }, []);
  const arrow = (d: 't' | 'r' | 'b' | 'l') => (
    <svg key={d} className={`arrow ${d} ${zone === d ? 'on' : ''}`} width={26} height={26} viewBox="0 0 26 26" aria-hidden>
      <path d="M13 5 22 19H4Z" style={{ transform: `rotate(${{ t: 0, r: 90, b: 180, l: 270 }[d]}deg)`, transformOrigin: '13px 13px' }} />
    </svg>
  );
  return (
    <div className={`pad ${shown ? 'shown' : ''}`} aria-label="Fly: hold the middle to go forward and drag out of it to turn as it goes, hold off the middle to turn only" onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.preventDefault(); if (!drone.pilot) take(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        if (isPhone()) holdAt(e, true); else drag.current = [e.clientX, e.clientY];
      }}
      onPointerMove={(e) => {
        if (held.current) { holdAt(e); return; }
        if (!drag.current) return;
        const dx = e.clientX - drag.current[0], dy = e.clientY - drag.current[1];
        drag.current = [e.clientX, e.clientY];
        drone.turn[0] += dx * LOOK * 1.6; drone.turn[1] += -dy * LOOK * 1.6; // the look, as a drag at the controls
        if (Math.hypot(dx, dy) > 0.5) { const z: Zone = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't'); setZone((was) => (was === z ? was : z)); }
      }}
      onLostPointerCapture={() => { go.current = false; drag.current = null; hold(null); setZone(null); }}>
      {(['t', 'r', 'b', 'l'] as const).map(arrow)}
      <span className={`ring ${zone === 'c' || going ? 'on' : ''}`}><i /></span>
    </div>
  );
}

/** PILOT's mark on a phone: four arrows out from the middle, the moves the pad gives. */



const Moves = () => (
  <svg className="moves" width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2" />
  </svg>
);
/** The probe's way out: a stop, a small square. */
const Stop = () => (
  <svg width={8} height={8} viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M2 2h12v12H2z" /></svg>
);
/** An arrow key's mark: a small solid triangle, drawn, so no font turns it into an emoji. */
const Tri = ({ d }: { d: 'up' | 'down' | 'left' | 'right' }) => (
  <svg width={7} height={7} viewBox="0 0 8 8" aria-label={d} style={{ transform: `rotate(${{ up: 0, right: 90, down: 180, left: 270 }[d]}deg)` }}>
    <path d="M4 1 L7.2 7 H0.8 Z" fill="currentColor" />
  </svg>
);
const Do = ({ how, what }: { how: React.ReactNode; what: string }) => <><span className="how">{how}</span><span className="what">{what}</span></>;

const LOOK = 0.0035; // radians per pixel of look
const isPhone = () => matchMedia('(max-width: 640px), (max-height: 500px)').matches;
const ORBIT = 0.006; // radians per pixel of orbit
const CRANK = 0.006; // radians in 4D per pixel of an alt-drag
const CRANK_PICK = 6; // px an alt-drag moves before it picks its plane

// The hand on the crank. An alt-drag picks its plane by the way it goes: each of the machine's three axes is seen on
// the page, and the one the drag runs along most turns with w, so cells flow the way it is dragged (the inner cube
// along +axis for a turn up). A short axis, near the line of sight, counts for less. From then on only the part of
// the drag along that axis turns it.
// A strut taken in the hand (Grip) picks the same way, so it matters which way it is dragged: along itself it slides
// on its own axis, across it goes along one of the other two, up and down another turn than left and right. The
// turn's sign is set so the strut goes with the drag: one out toward the eye in 4D (the outer cube) moves the other
// way to one in the inner cube; one along w spans both, and goes the way alt does.
// It can take another plane without letting go: when the drag swings round so another axis fits it better and next to
// none of it runs along the one in hand, the machine glides on to the nearest whole quarter, a little each move, and
// the drag takes the new axis there (one plane per drag, till the release, for a while).
const hand = { on: false, axis: [0, 0], acc: [0, 0], picked: false, sign: 1, recent: [0, 0], want: -1 };
const SWITCH_PX = 24; // how far the recent drag must have gone, its way, before it may ask for another axis
const SWITCH_ALONG = 0.5; // ... and how little of it may run along the axis in hand (the cosine)
const QUARTER_TURN = Math.PI / 2;
const tmpV = new THREE.Vector3(), tmpO = new THREE.Vector3();
/** Where axis `k` of the machine points on the page, in pixels, y down; long when it lies across the view. */
function onPage(k: number): [number, number] {
  const cam = rig.camera;
  if (!cam) return k === 0 ? [1, 0] : k === 1 ? [0, -1] : [0, 0];
  tmpO.set(0, 0, 0).project(cam);
  tmpV.set(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0).applyQuaternion(rig.q).project(cam);
  const c = document.querySelector('.stage canvas') as HTMLElement | null, w = c?.clientWidth || innerWidth, h = c?.clientHeight || innerHeight; // the canvas's shape
  return [(tmpV.x - tmpO.x) * w / 2, -(tmpV.y - tmpO.y) * h / 2];
}
function handDown(sign = 1) { hand.on = true; hand.picked = false; hand.acc = [0, 0]; hand.sign = sign; hand.recent = [0, 0]; hand.want = -1; }
/** The axis the drag (ux, uy), a unit on the page, runs along most. */
function axisFor(ux: number, uy: number) {
  let best = 0, score = -1;
  for (let k = 0; k < 3; k++) { const [ax, ay] = onPage(k), s = Math.abs(ax * ux + ay * uy); if (s > score) { score = s; best = k; } }
  return best;
}
function takeAxis(k: number) { const [ax, ay] = onPage(k), l = Math.hypot(ax, ay) || 1; hand.axis = [ax / l, ay / l]; }
function handMove(dx: number, dy: number) {
  if (!hand.on) return;
  if (!hand.picked) {
    hand.acc[0] += dx; hand.acc[1] += dy;
    const n = Math.hypot(hand.acc[0], hand.acc[1]);
    if (n < CRANK_PICK) return;
    const best = axisFor(hand.acc[0] / n, hand.acc[1] / n);
    const k = crankStart(best); // the plane it is free to take, or the one it is part way through
    takeAxis(k); hand.picked = true;
    hand.want = best !== k ? best : -1; // part way through another: on to its quarter, then this one
    dx = hand.acc[0]; dy = hand.acc[1]; // what moved while it was picking counts too
  }
  // the drag's way lately, for another axis
  hand.recent = [hand.recent[0] * 0.8 + dx, hand.recent[1] * 0.8 + dy];
  const rn = Math.hypot(hand.recent[0], hand.recent[1]);
  if (hand.want < 0 && rn > SWITCH_PX) {
    const ux = hand.recent[0] / rn, uy = hand.recent[1] / rn, b = axisFor(ux, uy);
    if (b !== st.plane && Math.abs(ux * hand.axis[0] + uy * hand.axis[1]) < SWITCH_ALONG) hand.want = b;
  }
  if (hand.want >= 0) {
    // on to the nearest whole quarter, eased by the move, then the new plane from there
    const diff = Math.round(st.angle / QUARTER_TURN) * QUARTER_TURN - st.angle;
    if (Math.abs(diff) > 0.01) { crankBy(diff * 0.3); return; }
    crankBy(diff);
    takeAxis(crankStart(hand.want)); hand.want = -1; hand.recent = [0, 0];
    return;
  }
  crankBy((dx * hand.axis[0] + dy * hand.axis[1]) * CRANK * hand.sign);
}
function handUp() { if (hand.on && hand.picked) crankEnd(); hand.on = false; grip.held = -1; }

export function App() {
  const [transform, setTransform] = useState(st.transform);
  // TURNTABLE, in the wheel's card: the camera's slow orbit, off to start; switched on it starts at once
  const [turntable, setTurntable] = useState(rig.spin);
  const [blur, setBlur] = useState(dof.on); // DEPTH OF FIELD, in the wheel's card
  const toggleBlur = () => { dof.on = !dof.on; setBlur(dof.on); };
  const toggleTurntable = () => { rig.spin = !rig.spin; if (rig.spin) turntableNow(); setTurntable(rig.spin); };
  // the piece in the lock, at the controls: LOCK can be tapped (polled, drone.lockable is set each frame)
  // (a class on #lock, not React's: DroneCam toggles its `on` there too)
  useEffect(() => { const id = setInterval(() => document.getElementById('lock')?.classList.toggle('can', drone.lockable && drone.pilot && !drone.docking), 100); return () => clearInterval(id); }, []);
  // the instructions bottom right, until dismissed by their x; remembered on this browser if it lets us
  const [grid, setGrid] = useState(st.grid);
  const [maxi, setMaxi] = useState(eyeView.max);
  const [beetle, setBeetle] = useState(drone.on);
  // an upright phone's home page is a page that scrolls: the text, the machine in a square box, the probe under it;
  // the canvas is the box, in the flow, so the page scrolls it as it scrolls the text
  useEffect(() => {
    document.body.classList.toggle('home', !beetle && !CLEAN);
    if (beetle) window.scrollTo(0, 0);
    const upright = matchMedia('(max-width: 640px) and (orientation: portrait)');
    const box = () => { page.boxed = !beetle && !CLEAN && upright.matches; };
    box(); upright.addEventListener('change', box);
    return () => upright.removeEventListener('change', box);
  }, [beetle]);
  // in the box a finger off the struts is the page's, so it scrolls: only one on a strut, or two, are kept from the
  // browser (touch-action lets it pan; this takes the touch back where the machine wants it)
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const keep = (e: TouchEvent) => {
      if (!page.boxed || drone.pilot || (e.target as Element).closest?.('button')) return; // a button in the box is the button's
      if (e.touches.length >= 2) { if (e.cancelable) e.preventDefault(); return; }
      if (e.type !== 'touchstart') return;
      const t = e.touches[0], r = el.getBoundingClientRect();
      if (strutAt(t.clientX - r.left, t.clientY - r.top, PICK_TOUCH) >= 0 && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchstart', keep, { passive: false }); el.addEventListener('touchmove', keep, { passive: false });
    return () => { el.removeEventListener('touchstart', keep); el.removeEventListener('touchmove', keep); };
  }, []);
  const [open, setOpen] = useState(!drone.on || !matchMedia('(max-width: 640px), (max-height: 500px)').matches); // the text: all of it to start; on a phone folded with the probe in
  const [mode, setModeState] = useState<Mode>(drone.pilot ? 'pilot' : rig.follow ? 'follow' : rig.attract ? 'attract' : 'orbit');
  const manual = mode === 'pilot';
  // ATTRACT to start, on a desktop: the first move of the mouse, a key or the wheel and it is over, ORBIT from there
  const attractFirst = useRef(ATTRACT_FIRST);
  useEffect(() => {
    if (!ATTRACT_FIRST) return;
    let moved = 0; // a real move: some way across the page (the browser sends a still one of its own as the page lays out)
    const wake = (e: Event) => {
      if (!attractFirst.current) return off();
      if (e instanceof PointerEvent) {
        if (e.pointerType !== 'mouse') return;
        moved += Math.hypot(e.movementX, e.movementY);
        if (moved < 30) return;
      }
      setMode('orbit'); off();
    };
    const off = () => { removeEventListener('pointermove', wake); removeEventListener('keydown', wake); removeEventListener('wheel', wake); };
    addEventListener('pointermove', wake); addEventListener('keydown', wake); addEventListener('wheel', wake);
    return off;
  }, []);
  const lastAuto = useRef<Mode>(rig.follow ? 'follow' : 'orbit'); // where p goes back to from the pilot
  const [locked, setLocked] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  // A drag anywhere on the page, what it does set when it starts: with alt it turns the machine in 4D by hand; at
  // the controls a plain drag is the look and shift orbits the camera; on its own a plain drag orbits. The orbit's
  // speed is kept, smoothed, to coast on.
  const drag = useRef<{ kind: 'look' | 'orbit' | 'crank'; x: number; y: number; t: number } | null>(null);
  // touch: one finger turns the machine in 4D (alt-drag's job), two orbit it (a pinch zoomed too, and got in the way of the orbit); each finger kept
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const pair = useRef<{ x: number; y: number; d: number; t: number } | null>(null);
  const pairOf = () => {
    const [a, b] = [...fingers.current.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, t: performance.now() };
  };
  const dragDown = (e: React.PointerEvent) => {
    // a drag only from the machine's own part: not from the fisheye view, not from behind the text
    const { main } = regionsOf(innerWidth, innerHeight);
    if (!page.boxed && (e.clientX < main.x || e.clientX > main.x + main.w || e.clientY < main.y || e.clientY > main.y + main.h)) return;
    if (e.pointerType === 'touch') {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.current.size === 1) {
        // a finger down on a strut takes it in the hand and turns the machine in 4D by it, as alt-drag on a desktop;
        // anywhere else it orbits (it turned in 4D by the drag anywhere, for a while); at the controls it is the look
        const at = (e.currentTarget as HTMLElement).getBoundingClientRect(); // the joints are in the canvas's pixels
        const strut = drone.pilot ? -1 : strutAt(e.clientX - at.left, e.clientY - at.top, PICK_TOUCH);
        // in the home page's box, off the struts it is the page's: it scrolls, nothing turns (two fingers orbit)
        if (page.boxed && strut < 0) { drag.current = null; return; }
        const kind = drone.pilot ? 'look' : strut >= 0 ? 'crank' : 'orbit';
        drag.current = { kind, x: e.clientX, y: e.clientY, t: performance.now() };
        if (strut >= 0) { grip.held = strut; const w = strutW(strut); handDown(Math.abs(w) > 0.2 ? -Math.sign(w) : 1); }
        if (kind === 'orbit') { rig.orbitVel[0] = rig.orbitVel[1] = 0; rig.orbiting = true; }
      } else if (fingers.current.size === 2) {
        // the second finger: no more turning by hand, the pair orbits from here
        handUp(); drag.current = null;
        pair.current = pairOf();
        rig.orbitVel[0] = rig.orbitVel[1] = 0; rig.orbiting = true;
      }
      return;
    }
    if (e.button !== 0 || document.pointerLockElement) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // on its own a drag on a strut takes it in the hand, no alt needed (alt was the only way to a strut for a while);
    // alt-drag anywhere still turns it in 4D by the drag
    const strut = !drone.pilot ? grip.hover : -1;
    const kind = e.altKey || strut >= 0 ? 'crank' : drone.pilot && !e.shiftKey ? 'look' : 'orbit';
    drag.current = { kind, x: e.clientX, y: e.clientY, t: performance.now() };
    if (kind === 'orbit') { rig.orbitVel[0] = rig.orbitVel[1] = 0; rig.orbiting = true; }
    if (kind === 'crank' && strut < 0) handDown();
    if (strut >= 0) { grip.held = strut; handDown(Math.abs(grip.w) > 0.2 ? -Math.sign(grip.w) : 1); }
  };
  // the pointer, for the strut under it
  const pointerAt = (e: React.PointerEvent) => { grip.x = e.clientX; grip.y = e.clientY; grip.in = true; grip.alt = e.altKey; };
  const dragMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      if (!fingers.current.has(e.pointerId)) return;
      fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p0 = pair.current;
      if (p0 && fingers.current.size >= 2) {
        const p = pairOf();
        orbitBy(-(p.x - p0.x) * ORBIT, (p.y - p0.y) * ORBIT, Math.max(1, p.t - p0.t) / 1000);
        pair.current = p;
        return;
      }
    } else pointerAt(e);
    const d = drag.current;
    if (!d) return;
    const now = performance.now(), dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (d.kind === 'orbit') orbitBy(-dx * ORBIT, dy * ORBIT, Math.max(1, now - d.t) / 1000);
    else if (d.kind === 'crank') handMove(dx, dy);
    else if (drone.pilot) { drone.turn[0] += dx * LOOK * 1.6; drone.turn[1] += -dy * LOOK * 1.6; }
    d.x = e.clientX; d.y = e.clientY; d.t = now;
  };
  // a drag ends when its pointer capture does: on release, on cancel, or when the page takes the pointer away
  const dragEnd = (e?: React.PointerEvent) => {
    if (e?.pointerType === 'touch') {
      fingers.current.delete(e.pointerId);
      if (fingers.current.size < 2 && pair.current) { pair.current = null; rig.orbiting = false; } // the pair broken: the orbit coasts, the finger left does nothing till all are up
      if (fingers.current.size > 0) return;
    }
    drag.current = null; rig.orbiting = false; handUp();
  };
  const onWheel = (e: React.WheelEvent) => { rig.zoomK = Math.min(2.2, Math.max(0.5, rig.zoomK * Math.exp(e.deltaY * 0.001))); };

  // the pointer lock: the mouse itself is the look, no drag; with shift held it orbits the machine instead, and
  // coasts when shift is let go; with alt it turns the machine
  useEffect(() => {
    const change = () => setLocked(document.pointerLockElement === stage.current);
    let last = 0;
    const move = (e: MouseEvent) => {
      if (document.pointerLockElement !== stage.current || !drone.pilot) return;
      if (e.altKey) { if (!hand.on) handDown(); handMove(e.movementX, e.movementY); return; }
      handUp(); // alt let go without its keyup reaching the page
      if (e.shiftKey) {
        const now = performance.now(), dt = Math.max(1, now - last) / 1000; last = now;
        orbitBy(-e.movementX * ORBIT, e.movementY * ORBIT, dt);
        return;
      }
      rig.orbiting = false; // shift let go without its keyup reaching the page: the orbit coasts
      drone.turn[0] += e.movementX * LOOK; drone.turn[1] += -e.movementY * LOOK;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') rig.orbiting = false;
      if (e.key === 'Alt' && document.pointerLockElement) handUp();
    };
    document.addEventListener('pointerlockchange', change);
    document.addEventListener('mousemove', move);
    addEventListener('keyup', up);
    return () => { document.removeEventListener('pointerlockchange', change); document.removeEventListener('mousemove', move); removeEventListener('keyup', up); };
  }, []);

  // the mode, from the pills on the left or p: orbit and follow on its own, the pilot at the controls
  const setMode = (m: Mode) => {
    attractFirst.current = false; // picked: whatever it is, it stays
    if (m !== 'pilot' && m !== 'probe') lastAuto.current = m; // where the pilot and the probe's button go back to
    if (rig.attract && m !== 'attract') settleTurn(); // it turned in ATTRACT: on to a whole quarter, unless AUTOTRANSFORM goes on
    drone.pilot = m === 'pilot'; rig.follow = m === 'follow' || m === 'probe'; rig.close = m === 'probe'; rig.attract = m === 'attract'; setModeState(m);
    if (m === 'attract') { attract.left = 0; attract.beats = 1; } // straight into a shot, on a beat
    document.body.classList.toggle('pilot', m === 'pilot'); // on a phone: the view, the pad, no pills (style.css)
    drone.keys.thrust = drone.keys.strafe = 0;
    rig.turntable = m !== 'pilot';
    if (m !== 'pilot' && document.pointerLockElement) document.exitPointerLock();
  };

  useEffect(() => {
    const keys = drone.keys;
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.key === 'Alt') { grip.alt = true; e.preventDefault(); return; } // alt held: the strut under the pointer shows
      if (k === 'p') { drone.frozen = !drone.frozen; return; } // pause everything (it was the pilot, which the pills do)
      if (k === 't') { toggleTransformRef.current(); return; } // transform, play or pause
      if (k === 'o') { st.inout = !st.inout; return; } // the hand-over at a wall: in, then out by default, o for folded
      if (e.key === 'Enter' && drone.pilot) { e.preventDefault(); drone.catchAsk = true; return; } // COLLECT: dock and take the piece, if it is in the lock
      if (drone.pilot) {
        // manual: w s and up down forward and back, a d and the side arrows strafe, space forward, l the lock
        if (k === ' ' || k === 'w' || k === 'arrowup') keys.thrust = 1;
        if (k === 's' || k === 'arrowdown') keys.thrust = -1;
        if (k === 'a' || k === 'arrowleft') keys.strafe = -1;
        if (k === 'd' || k === 'arrowright') keys.strafe = 1;
        if (k === 'l') { if (document.pointerLockElement) document.exitPointerLock(); else stage.current?.requestPointerLock(); }
        if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
        return;
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.key === 'Alt') grip.alt = false; // the strut's outline goes with alt
      if (k === ' ' || k === 'w' || k === 's' || k === 'arrowup' || k === 'arrowdown') keys.thrust = 0;
      if (k === 'a' || k === 'd' || k === 'arrowleft' || k === 'arrowright') keys.strafe = 0;
    };
    const blur = () => { keys.thrust = keys.strafe = 0; rig.orbiting = false; grip.alt = false; handUp(); };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur); };
  }, []);

  // bottom left over the keys in either mode: on top the controls switch (manual or auto), twice the small size;
  // then the settings, the camera's turntable and the machine turning in 4D on its own.
  // transform, and the turntable with it: the play/pause button bottom middle (a TRANSFORM switch under SETTINGS before)
  const toggleTransform = () => { st.transform = !st.transform; rig.spin = st.transform; setTransform(st.transform); };
  // AUTOTRANSFORM, top right of the view: the machine's turn in 4D on its own, alone, the turntable left as it is
  const toggleAuto = () => { st.transform = !st.transform; if (st.transform) transformNow(); setTransform(st.transform); };
  // following, where from: FREE, BACK, SIDE, TOP, a switch under AUTOTRANSFORM
  const toggleTransformRef = useRef(toggleTransform); // for the keys, set up once
  toggleTransformRef.current = toggleAuto; // T: AUTOTRANSFORM's (the transform and the turntable together for a while)
  const controls = !beetle ? null : <>
    <div className="pills" role="radiogroup" aria-label="Mode">
      {MODES.map(([m, name]) => <button key={m} className={`pill ${m} ${mode === m ? 'at' : ''}`} role="radio" aria-checked={mode === m} tabIndex={-1}
        onPointerDown={(e) => e.preventDefault()} onClick={() => setMode(m)}><i className="radio" />{m === 'pilot' ? <Moves /> : null}{name}</button>)}
    </div>
  </>;

  const stageHandlers = { onPointerDown: dragDown, onPointerMove: dragMove, onLostPointerCapture: dragEnd, onPointerLeave: () => { grip.in = false; },
    onPointerUp: (e: React.PointerEvent) => { if (e.pointerType === 'touch') tiltOn(); } }; // a touch's end, a gesture iOS lets ask for the tilt

  return (
    <>
      <div ref={stage} className={`stage ${locked ? 'locked' : ''}`} {...stageHandlers} onWheel={onWheel}>
        <Canvas camera={{ position: [0, 0, 10.5], fov: 34 }} gl={{ alpha: true, antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0, localClippingEnabled: true }} dpr={[1, 2]}>
          <Suspense fallback={null}>
            <Rig>
              <Machine />
              <group visible={beetle}><Drones /></group>
              <Grip />
            </Rig>
            <DroneCam />
          </Suspense>
          {/* no contact shadow under it any more: it redrew the whole machine every frame, for the battery (a soft one, 1024, for a while) */}
          <Environment resolution={256}>
            <Lightformer intensity={2.6} rotation-x={Math.PI / 2} position={[0, 7, 0]} scale={[10, 10, 1]} />
            <Lightformer intensity={1.8} rotation-y={Math.PI / 2} position={[-8, 2, 2]} scale={[8, 5, 1]} color="#fff4e6" />
            <Lightformer intensity={1.2} rotation-y={-Math.PI / 2} position={[8, 1, -2]} scale={[8, 5, 1]} color="#e6f0ff" />
            {/* the fill from below, stronger, so the shade side of a strut is lifted, not muddy (0.6, for a while) */}
            <Lightformer intensity={1.8} rotation-x={-Math.PI / 2} position={[0, -6, 0]} scale={[12, 12, 1]} color="#ece6da" />
          </Environment>
          <directionalLight position={[4, 8, 6]} intensity={1.1} />
        </Canvas>
        {/* the machine turning in 4D on its own, a switch top right of the view, on a desktop, in the phone's box and full screen */}
        {CLEAN ? null : <div className="corner">
          {/* a phone's mode: a dropdown top right, over AUTOTRANSFORM (the three pills on a row at the foot, for a while) */}
          <ModeMenu mode={mode} pick={setMode} />
          {/* PROBE at a tap: a round button beside the mode, a target; on it, a tap goes back to where it was */}
          <button className={`focus ${mode === 'probe' ? 'on' : ''}`} tabIndex={-1} aria-label={mode === 'probe' ? 'Back from the probe' : 'Focus on the probe'} aria-pressed={mode === 'probe'}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={() => setMode(mode === 'probe' ? lastAuto.current : 'probe')}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><circle cx={12} cy={12} r={7} /><circle cx={12} cy={12} r={2.2} fill="currentColor" stroke="none" /><path d="M12 1.5v3.5M12 19v3.5M1.5 12H5M19 12h3.5" /></svg>
          </button>
          {/* and beside it a wheel, the settings: AUTOTRANSFORM in it (on its own under the dropdown, for a while) */}
          <Settings transform={transform} toggle={toggleAuto} turntable={turntable} toggleTurntable={toggleTurntable} blur={blur} toggleBlur={toggleBlur} />
          <button className={`autot ${transform ? 'on' : ''}`} tabIndex={-1} role="checkbox" aria-checked={transform} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={toggleAuto}>
          <i className="box" aria-hidden>{transform ? <svg width={8} height={8} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3.2L13 4.5" /></svg> : null}</i>Autotransform
        </button>
          {/* FREE | BACK | SIDE | TOP, where the follow is from, was here for a while: FREE, round it by the drag, kept */}
        </div>}
        {/* an upright phone's home page: how the hands work, in the box, bottom right (bottom left, and under it, titled INSTRUCTIONS, for a moment) */}
      </div>
      {CLEAN ? null : <div className={`plate ${open ? '' : 'folded'} ${beetle ? 'probing' : ''}`}><div className="head"><b>08 Tesseract</b><i><a className="home" href="../">Codevember 2026 <span lang="ja">すべてのプロジェクト</span></a></i></div>{beetle ? null : <div className="curtain"><button tabIndex={-1} aria-label={open ? 'Fold the text away' : 'Unfold the text'} onPointerDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}><svg width={10} height={10} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: open ? 'none' : 'rotate(180deg)' }}><path d="M2.5 10.5 8 5l5.5 5.5" /></svg></button></div>}</div>}
      {/* an upright phone's home page: under the box the probe, a line drawing of it, what it is, and the way in, the
          probe in, full screen and followed (in the box, at its foot, for a moment) */}
      {/* an upright phone with the probe in: no text, a footer instead, where it is (08 TESSERACT, and / PILOT at the controls; a PROBE between them for a while) and BACK, one up */}
      {CLEAN || !beetle ? null : <nav className="crumbs" aria-label="Where you are">
        {/* the title alone: the mode pills at the foot are the way between the modes (08 TESSERACT / PILOT and BACK in a footer, then BACK alone up here, for a while) */}
        <span className="trail title"><span className="at">08 Tesseract</span><a className="home" href="../">Codevember 2026 <span lang="ja">すべてのプロジェクト</span></a></span>
      </nav>}
      {/* the first person view's corner, top right: hide or show it, and, shown, maximize or
          minimize it, the corner the only way to them */}
      {CLEAN || !beetle || (!maxi && grid) ? null : <button className="maxi eye" tabIndex={-1} aria-label={grid ? 'Hide the first person view' : 'Show the first person view'}
        onPointerDown={(e) => e.preventDefault()} onClick={() => { st.grid = !st.grid; setGrid(st.grid); }}>
        <EyeOrGrid shown={grid} />
      </button>}
      {CLEAN || !beetle || !grid ? null : <button className={`maxi ${maxi ? "" : "solo"}`} tabIndex={-1} aria-label={maxi ? 'Minimize the first person view' : 'Maximize the first person view'}
        onPointerDown={(e) => e.preventDefault()} onClick={() => { eyeView.max = !eyeView.max; setMaxi(eyeView.max); }}>
        <Corners out={!maxi} />
      </button>}
      {/* bottom middle, at the controls: the pointer lock; locked, there is no pointer to click with, so the way out
          instead: esc (transform's play/pause beside it for a while) */}
      {/* on a phone at the controls, the fisheye view is the pad */}
      {CLEAN || !beetle ? null : <Pad take={() => setMode('pilot')} shown={grid && !maxi} />}
      {CLEAN || !manual ? null : <div className="middle">
        {locked ? <div className="play hint"><Key wide>Esc</Key>to unlock</div> : <button className="play lockpill" tabIndex={-1}
          onPointerDown={(e) => e.preventDefault()} onClick={() => stage.current?.requestPointerLock()}>
          <Crosshair />
          Lock pointer
        </button>}
      </div>}
      {/* split: a hairline between the machine's half and the view's */}
      {CLEAN || !beetle || !grid || maxi ? null : <div className="divider" />}
      {/* the lock round the piece in the view, and LOCK under it a button in the piece's colour: tapped, the probe docks
          and takes it (it docked on its own after half a second in the lock, for a while) */}
      <div id="lock" className="lock"><i /><i /><i /><i /><button tabIndex={-1} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={() => { drone.catchAsk = true; }}><span className="word">Collect</span><Key><EnterMark /></Key></button></div>
      {/* a little arrow on the view's rim, towards the piece while it is out of sight, in its colour (DroneCam) */}
      <div id="toball" className="toball" aria-hidden><svg width={22} height={22} viewBox="0 0 16 16"><path d="M3 2.5 14 8 3 13.5 5.5 8Z" /></svg></div>
      {/* bottom left, under the blurb and as wide: mode and settings; the shortcuts bottom right, as wide */}
      {CLEAN ? null : <div className="keys">
        {controls}
      </div>}
      {/* the drags only: L, T and P still work, unlisted (listed for a while) */}
      {CLEAN ? null : <div className="keys right">
        {manual ? <>
        <h6 className="shortcuts">Navigation</h6>
        <Do how={<Key wide>{locked ? 'Mouse' : 'Drag'}</Key>} what="Steer" />
        <Do how={<><Key>W</Key><Key>S</Key><Key><Tri d="up" /></Key><Key><Tri d="down" /></Key></>} what="Forward, back" />
        <Do how={<><Key>A</Key><Key>D</Key><Key><Tri d="left" /></Key><Key><Tri d="right" /></Key></>} what="Strafe" />
        <Do how={<Key wide>Space</Key>} what="Forward" />
        <Do how={<Key><EnterMark /></Key>} what="Collect" />
        {/* shift-drag to orbit and alt-drag to transform, under VIEW, were listed here for a while; they still work */}
        </> : null /* on its own the drawing bottom right says it, rotate and transform (listed, DRAG and DRAG AN EDGE, for a while) */}
      </div>}
    </>
  );
}
