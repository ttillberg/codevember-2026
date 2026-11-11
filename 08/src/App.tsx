import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { Machine } from './Machine';
import { Drones } from './Drones';
import { DroneCam, eyeView, regionsOf, page } from './DroneCam';
import { Grip, grip, strutAt, strutW, PICK_TOUCH } from './Grip';
// CellMap (./CellMap.tsx), the cells' little map with their colours, is off the page for now
import { drone } from './drone';
import { st, rig, orbitBy, crankStart, crankBy, crankEnd, pose } from './state';
import { project } from './tesseract';
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
type Mode = 'orbit' | 'follow' | 'pilot';
// in this order: ORBIT, FOLLOW, PILOT, from the farthest to the controls (follow, pilot, orbit for a moment)
const MODES: [Mode, string][] = [
  ['orbit', 'Orbit'],
  ['follow', 'Follow'],
  ['pilot', 'Pilot'],
];

/** The ?'s note: why this is short, and two days late, plainly (next to Pascal, Kubrick and the rest, then a stamp collector's drawer, for a moment). Frosted, over everything; a tap outside it, the x or Esc closes it. */
function Note({ close }: { close: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, []);
  return (
    <div className="note-veil" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <article className="note" role="dialog" aria-label="On cutting short">
        <button className="x" aria-label="Close" onClick={close}>
          <svg width={10} height={10} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden><path d="M3 3l10 10M13 3 3 13" /></svg>
        </button>
        <h3>On cutting short</h3>
        <p>Thanks for your curiosity. I meant to explain what is going on here, and ran out of time, which is more or less the whole story. Codevember is one small thing a day. A day is a short form, and the whole point of a short form is that it stays short. This one is two days late.</p>
        <p>It began as a tesseract that turns. To make the turn readable it needed something living inside it, so a probe; the probe needed a view, the view a map, the map a lens, the walls a honeycomb, the honeycomb a ripple. Each step made sense on its own. In the end I took out nine tenths of it. And the honest part is that most of what is left could have been had without all that work. Almost.</p>
        <p>The marks on the struts that nobody reads, a honeycomb finer than the eye can tell, a wave that was tried and taken out again. Not wasted, exactly. Just not for anyone else.</p>
        <p>The almost is the part I keep. Without the nine tenths there is a cube in a cube that turns. With them there is a cube in a cube that turns, and I know why it looks the way it does. It is a small difference. Most days it is the one I am after.</p>
        <p className="sign">Two days late. Still, it turns.</p>
      </article>
    </div>
  );
}

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

/** A phone's settings, top right beside the mode: a wheel, and a tap opens a card under it with AUTOTRANSFORM, a
 * checkbox row. Hidden on a desktop, AUTOTRANSFORM on its own there. */
function Settings({ transform, toggle }: { transform: boolean; toggle: () => void }) {
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
        <button className={transform ? 'at' : ''} role="checkbox" aria-checked={transform} tabIndex={-1} onPointerDown={hold} onClick={toggle}>
          <i className="box" aria-hidden>{transform ? <svg width={8} height={8} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3.2L13 4.5" /></svg> : null}</i>Autotransform
        </button>
      </div> : null}
    </div>
  );
}

/** A phone's mode, top right: the mode it is in and a chevron, and a tap opens the three under it, frosted, the one it
 * is in darker with its dot filled; a tap on one picks it, a tap anywhere else folds it. Hidden on a desktop. */
function ModeMenu({ mode, pick }: { mode: Mode; pick: (m: Mode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useAway(open, () => setOpen(false));
  const stop = hold;
  return (
    <div ref={ref} className={`modemenu ${open ? 'open' : ''}`}>
      <button className="now" tabIndex={-1} aria-haspopup="listbox" aria-expanded={open} onPointerDown={stop} onClick={() => setOpen(!open)}>
        {MODES.find(([m]) => m === mode)?.[1]}
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
rig.spin = false;


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
    tail.lerp(drone.world, Math.min(1, sdt * FOLLOW_EASE));
    if (rig.followK < 0.001) lag.copy(tail); // not following: the camera's own catch-up starts from where the look is
    lag.lerp(tail, Math.min(1, sdt * FOLLOW_LAG));
    // on its own, the switch
    rig.followK += ((rig.follow && !drone.pilot ? 1 : 0) - rig.followK) * Math.min(1, dt * 2); // at the controls the chase, below (the follow on a phone for a while)
    const fk = rig.followK;
    // the probe's own way and up in the world, eased, for the views by its turn and the chase
    const ve = Math.min(1, sdt * CHASE_EASE);
    chaseFwd.lerp(drone.worldFwd, ve).normalize(); chaseUp.lerp(drone.worldUp, ve).normalize();
    let upWant = WORLD_UP;
    if (fk > 0.001) {
      const D = rig.zoom * (size.width <= 640 || size.height <= 500 ? FOLLOW_PHONE : FOLLOW);
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
      chaseAt.copy(drone.world).addScaledVector(chaseFwd, -CHASE_BACK).addScaledVector(chaseUp, CHASE_UP);
      chaseLook.copy(drone.world).addScaledVector(chaseFwd, CHASE_AHEAD);
      camera.position.lerp(chaseAt, rig.chaseK);
      look.lerp(chaseLook, rig.chaseK);
    }
    camera.lookAt(look);
    // into its part: the picture slid so the page's middle lands on the part's (it was the beetle two thirds across,
    // following, and then the left half, split)
    const ox = size.width / 2 - part.x, oy = size.height / 2 - part.y;
    if (Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5) cam.setViewOffset(size.width, size.height, ox, oy, size.width, size.height);
    else if (cam.view?.enabled) cam.clearViewOffset();
    // the depth of field on what the camera looks at, the beetle when following; nearer, the blur deeper, as a lens's
    dof.focus.copy(look).lerp(drone.world, rig.chaseK); // chasing, on the probe, not past it
    dof.aperture = THREE.MathUtils.lerp(DOF_WIDE, DOF_FOLLOW, fk);
  });
  return <group ref={ref}>{children}</group>;
}
const FOCUS = 0.3; // how far the turntable's look leans from the machine's middle to the device
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
const CHASE_BACK = 1.7, CHASE_UP = 0.4, CHASE_AHEAD = 2; // world units: behind it, over it, and the look ahead of it (a quarter of these, the probe filling the screen, for a moment)
const sideV = new THREE.Vector3(), viewOff = new THREE.Vector3(), camUp = new THREE.Vector3(0, 1, 0), WORLD_UP = new THREE.Vector3(0, 1, 0);
const CHASE_EASE = 4; // how fast the chase swings round after the probe's turn (1/s)
const focusAt = new THREE.Vector3();

// The keys at the controls, as day 07's help: flat grey caps, and what each does in small caps beside them.
const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
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

// The phone's cheat sheet, as an assembly manual draws it: line art, no words but a caption, the hand and the arrows
// doing the telling. A cube in hairline, the struts out of sight dashed; one finger on a strut, lime, with an arrow
// along it and one across, the two ways it turns the machine in 4D; two fingers and a sweep over the cube, the orbit.
const CUBE = (
  <>
    <path className="far" d="M26 13V29M12 36L26 29L40 36" />
    <path d="M12 20L26 13L40 20L26 27ZM12 20V36L26 43L40 36V20M26 27V43" />
  </>
);
/** An arrowhead at (x, y) pointing along angle `a` (degrees, 0 to the right, y down). */
const Head = ({ x, y, a }: { x: number; y: number; a: number }) => (
  <path className="head" d="M-3.2 -2.4L0 0L-3.2 2.4" transform={`translate(${x} ${y}) rotate(${a})`} />
);
// A hand as a manual draws it, in local units, the fingertip at the origin and the wrist down at y 46, cut by the
// drawing's edge: one finger out, the others curled, the thumb in; or two out together, for the two-finger turn.
// the hand as a pointing hand in a manual: the index up, a round tip, the other three folded, their knuckles a row
// of bumps down the right, the thumb out to the left and curled in, a cuff at the wrist (a thinner hand, the fingers
// barely folded, for a while)
const HAND_ONE = 'M-4.5 21V4.5A4.5 4.5 0 0 1 4.5 4.5V17C5 13.5 11.5 13.5 11.5 17.5C12 15 17 15.5 17 19.5C17.5 17.5 21.5 18.5 21 22.5C21 30 19 34 16.5 38H-7.5C-10.5 34 -13 31 -14 27C-15.5 23 -14.5 19 -11.5 18.5C-8.5 18 -6 20 -4.5 21Z';
const HAND_LINES = 'M4.5 17V22M11.5 17.5V23M17 19.5V24.5M-4.5 21C-6 23 -6.5 26 -6 28';
const CUFF = 'M-9 38H18V45H-9ZM-4 39.5V43.5M1 39.5V43.5';
/** A hand coming in from below, its fingertip at (x, y), leaning `a` degrees. */
const Hand = ({ x, y, a, k = 0.72 }: { x: number; y: number; a: number; k?: number }) => (
  <g className="hand" transform={`translate(${x} ${y}) rotate(${a}) scale(${k})`}>
    <path className="skin" d={HAND_ONE} />
    <path d={HAND_LINES} />
    <path className="skin" d={CUFF} />
  </g>
);
const Cheat = ({ close }: { close: () => void }) => (
  <div className="cheat">
    {/* a small round x on its top right corner: away with it, and it stays away on this browser */}
    <button className="x" aria-label="Dismiss the instructions" tabIndex={-1} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={close}>
      <svg width={7} height={7} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" aria-hidden><path d="M3 3l10 10M13 3 3 13" /></svg>
    </button>
    <figure>
      {/* drawn after Theo's sketch: the cube, its hidden edges dashed, the strut in lime, the two ways it goes, and a
          gloved hand, its finger on the strut's foot (a thin hand and hairlines for a while) */}
      <svg className="manual" width={72} height={74} viewBox="250 200 790 820">
        <path className="far" d="M498 345V560M330 668L495 575M500 575L670 668" />
        <path className="cube" d="M295 452L498 337L686 448M295 452L498 568L686 452M295 452V688L498 800L686 690V452M498 568V800" />
        <path className="edge-o" d="M686 452V604" /><path className="edge-i" d="M686 452V604" />
        <path className="arr" d="M545 272H850M592 240L545 272L592 306M802 238L850 272L802 306" />
        <path className="arr" d="M848 392V632M814 438L848 392L882 438M814 586L848 632L882 586" />
        <path className="glove" d="M760 975C742 988 750 1030 790 1034L915 1030C950 1025 955 978 930 965Z" />
        <path className="glove" d="M682 648C680 602 742 594 762 634L822 770C818 720 882 702 906 770C906 720 982 720 990 820C995 880 975 940 945 965L760 977C730 952 700 928 660 916C610 905 590 860 612 830C642 800 700 815 742 846Z" />
        <path className="crease" d="M824 880L834 944M870 856L874 940M914 870L902 934" />
      </svg>
    </figure>
    <i className="rule" />
    <figure>
      {/* the orbit: a drag on the page off the struts, the same glove, its finger on nothing, a sweep over it and the
          way the finger goes, both ways */}
      <svg className="manual" width={72} height={74} viewBox="250 200 790 820">
        <path className="far" d="M330 470A300 120 0 0 0 930 470" />
        <path className="arr" d="M330 470A300 120 0 0 1 930 470M300 418L330 470L388 452M872 452L930 470L960 418" />
        <path className="arr" d="M560 560H880M606 528L560 560L606 594M834 528L880 560L834 594" />
        <path className="glove" d="M760 975C742 988 750 1030 790 1034L915 1030C950 1025 955 978 930 965Z" />
        <path className="glove" d="M682 648C680 602 742 594 762 634L822 770C818 720 882 702 906 770C906 720 982 720 990 820C995 880 975 940 945 965L760 977C730 952 700 928 660 916C610 905 590 860 612 830C642 800 700 815 742 846Z" />
        <path className="crease" d="M824 880L834 944M870 856L874 940M914 870L902 934" />
      </svg>
    </figure>
  </div>
);


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
  const [why, setWhy] = useState(false); // the ? and its note
  // the piece in the lock, at the controls: LOCK can be tapped (polled, drone.lockable is set each frame)
  // (a class on #lock, not React's: DroneCam toggles its `on` there too)
  useEffect(() => { const id = setInterval(() => document.getElementById('lock')?.classList.toggle('can', drone.lockable && drone.pilot && !drone.docking), 100); return () => clearInterval(id); }, []);
  // the instructions bottom right, until dismissed by their x; remembered on this browser if it lets us
  const [cheat, setCheat] = useState(() => { try { return localStorage.getItem('08-cheat') !== 'off'; } catch { return true; } });
  const dismissCheat = () => { setCheat(false); try { localStorage.setItem('08-cheat', 'off'); } catch { /* not kept, fine */ } };
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
  const [mode, setModeState] = useState<Mode>(drone.pilot ? 'pilot' : rig.follow ? 'follow' : 'orbit');
  const manual = mode === 'pilot';
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
    if (m !== 'pilot') lastAuto.current = m;
    drone.pilot = m === 'pilot'; rig.follow = m === 'follow'; setModeState(m);
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
  const toggleAuto = () => { st.transform = !st.transform; setTransform(st.transform); };
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
      {why ? <Note close={() => setWhy(false)} /> : null}
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
          <ContactShadows position={[0, -3.4, 0]} opacity={0.6} scale={16} blur={2.6} far={5} resolution={1024} color="#2a2620" />
          <Environment resolution={256}>
            <Lightformer intensity={2.6} rotation-x={Math.PI / 2} position={[0, 7, 0]} scale={[10, 10, 1]} />
            <Lightformer intensity={1.8} rotation-y={Math.PI / 2} position={[-8, 2, 2]} scale={[8, 5, 1]} color="#fff4e6" />
            <Lightformer intensity={1.2} rotation-y={-Math.PI / 2} position={[8, 1, -2]} scale={[8, 5, 1]} color="#e6f0ff" />
            <Lightformer intensity={0.6} rotation-x={-Math.PI / 2} position={[0, -6, 0]} scale={[12, 12, 1]} color="#d8d2c6" />
          </Environment>
          <directionalLight position={[4, 8, 6]} intensity={1.1} />
        </Canvas>
        {/* the machine turning in 4D on its own, a switch top right of the view, on a desktop, in the phone's box and full screen */}
        {CLEAN ? null : <div className="corner">
          {/* a phone's mode: a dropdown top right, over AUTOTRANSFORM (the three pills on a row at the foot, for a while) */}
          <ModeMenu mode={mode} pick={setMode} />
          {/* and beside it a wheel, the settings: AUTOTRANSFORM in it (on its own under the dropdown, for a while) */}
          <Settings transform={transform} toggle={toggleAuto} />
          {/* a ? that opens a note, on frosted glass: why this is short (beside AUTOTRANSFORM on a desktop, bottom left on a phone) */}
          <button className="why" tabIndex={-1} aria-label="Why this is short" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={() => setWhy(true)}>?</button>
          <button className={`autot ${transform ? 'on' : ''}`} tabIndex={-1} role="checkbox" aria-checked={transform} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={toggleAuto}>
          <i className="box" aria-hidden>{transform ? <svg width={8} height={8} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3.2L13 4.5" /></svg> : null}</i>Autotransform
        </button>
          {/* FREE | BACK | SIDE | TOP, where the follow is from, was here for a while: FREE, round it by the drag, kept */}
        </div>}
        {/* an upright phone's home page: how the hands work, in the box, bottom right (bottom left, and under it, titled INSTRUCTIONS, for a moment) */}
        {CLEAN || !cheat ? null : <Cheat close={dismissCheat} />}{/* shown by the page: a phone's home page's box, a desktop's corner away from the controls (style.css) */}
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
      <div id="lock" className="lock"><i /><i /><i /><i /><button tabIndex={-1} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={() => { drone.catchAsk = true; }}>lock</button></div>
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
        <h6 className="shortcuts">View</h6>
        <Do how={<><Key>⇧</Key> + <Key wide>{locked ? 'Mouse' : 'Drag'}</Key></>} what="Orbit" />
        <Do how={<><Key>{MAC ? '⌥' : 'Alt'}</Key> + <Key wide>{locked ? 'Mouse' : 'Drag'}</Key></>} what="Transform" />
        </> : null /* on its own the drawing bottom right says it, rotate and transform (listed, DRAG and DRAG AN EDGE, for a while) */}
      </div>}
    </>
  );
}
