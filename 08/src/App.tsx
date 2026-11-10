import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { Machine } from './Machine';
import { Drones } from './Drones';
import { DroneCam } from './DroneCam';
import { Grip, grip } from './Grip';
import { drone } from './drone';
import { st, rig, orbitBy, crankStart, crankBy, crankEnd, pose } from './state';
import { project } from './tesseract';
import { dof } from './dof';

const PARAMS = new URLSearchParams(location.search);
const CLEAN = PARAMS.has('clean'); // no page furniture, for the screengrab

// Two modes, the same two views in both: the machine fills the page, the eye's view the right third behind it.
// Auto, the attract mode: the device flies on its own, the camera turns slowly on a turntable, a drag orbits it.
// Manual: a drag anywhere is the look, shift-drag orbits, or with the pointer locked (l) the mouse itself is the
// look; w s and the up and down arrows go forward and back, a d and the side arrows strafe, space is forward too.
// In both an alt-drag turns the machine in 4D by hand. Hard mode (h), in either: the machine turns in 4D all the
// time, changing plane as it goes.


/** A small switch: a track and a label, lime when on; never takes focus, so space stays forward. */
const Small = ({ on, label, act, big }: { on: boolean; label: string; act: () => void; big?: boolean }) => (
  <button className={`toggle small ${big ? 'x2' : ''} ${on ? 'on' : ''}`} role="switch" aria-checked={on} tabIndex={-1}
    onPointerDown={(e) => e.preventDefault()} onClick={act}>
    <span className="track"><i /></span>
    <span className="label">{label}</span>
  </button>
);

/** The machine and the device on a rig with a fixed tilt; the camera orbits round it. */
function Rig({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera, size }, dt) => {
    ref.current?.quaternion.copy(rig.q);
    rig.camera = camera;
    // the distance fits the machine's reach to the page, whichever way is narrower, with a margin; eased, so the
    // picture breathes as the machine changes shape rather than jumps; the wheel scales it
    const cam = camera as THREE.PerspectiveCamera;
    const vfov = THREE.MathUtils.degToRad(cam.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * (size.width / size.height));
    const fit = (st.reach * 1.0) / Math.sin(Math.min(vfov, hfov) / 2);
    rig.zoom += (fit * rig.zoomK - rig.zoom) * Math.min(1, dt * 2.5);
    // on the turntable the look leans towards the device a part of the way from the machine's middle, slowly, so it
    // follows the flight without chasing it; and eases back to the middle off it
    const lean = rig.turntable && rig.spin ? FOCUS : 0;
    project(pose(), drone.p, focusAt).applyQuaternion(rig.q).multiplyScalar(lean);
    rig.focus.lerp(focusAt, Math.min(1, dt * 0.8));
    camera.position.setFromSphericalCoords(rig.zoom, Math.PI / 2 - rig.pitch, rig.yaw);
    // follow (the switch): the same orbit, round the beetle instead of the machine's middle, nearer; eased in and out
    tail.lerp(drone.world, Math.min(1, dt * FOLLOW_EASE));
    rig.followK += ((rig.follow && !drone.pilot ? 1 : 0) - rig.followK) * Math.min(1, dt * 2); // on its own only: at the controls the camera is the usual one
    const fk = rig.followK;
    if (fk > 0.001) {
      off.setFromSphericalCoords(rig.zoom * FOLLOW, Math.PI / 2 - THREE.MathUtils.clamp(rig.pitch, -LEVEL, LEVEL), rig.yaw);
      look.copy(rig.focus).lerp(tail, fk);
      camera.position.lerp(followAt.copy(tail).add(off), fk);
      camera.lookAt(look);
    } else camera.lookAt(look.copy(rig.focus));
    // the depth of field on what the camera looks at, the beetle when following; nearer, the blur deeper, as a lens's
    dof.focus.copy(look);
    dof.aperture = THREE.MathUtils.lerp(DOF_WIDE, DOF_FOLLOW, fk);
  });
  return <group ref={ref}>{children}</group>;
}
const FOCUS = 0.3; // how far the turntable's look leans from the machine's middle to the device
const look = new THREE.Vector3(), followAt = new THREE.Vector3();
const DOF_WIDE = 0.007, DOF_FOLLOW = 0.009; // the blur at twice the focus distance, against the page's height

// Follow: the orbit round the beetle, and nothing more. The look eases after it, a point that glides rather than
// jumps; the way round is the orbit's own yaw and pitch, which the turntable and a drag turn, so nothing of the
// machine's turn in 4D swings the camera. No higher or lower than LEVEL: straight above or below, the camera's up has
// nothing to hold to and the picture spins. (Shots in turn, from the back, the side, above, and a close-up on the
// catch, were tried first, with cuts and then glides; too much.)
const FOLLOW = 0.5; // the distance to the beetle against the fit to the whole machine
const FOLLOW_EASE = 2; // how fast the look goes after the beetle (1/s)
const LEVEL = 0.87; // radians, about 50 degrees
const tail = new THREE.Vector3(), off = new THREE.Vector3();
const focusAt = new THREE.Vector3();

// The keys at the controls, as day 07's help: flat grey caps, and what each does in small caps beside them.
const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const Key = ({ children, wide }: { children: React.ReactNode; wide?: boolean }) => <kbd className={`key${wide ? ' wide' : ''}`}>{children}</kbd>;
/** A crosshair, the sight of a first-person game: the pointer lock makes the mouse the look. A ring, four ticks
 * through it with a gap at the middle, a dot there. */
const Crosshair = () => (
  <svg className="icon" width={22} height={22} viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M11 1.5v5M11 15.5v5M1.5 11h5M15.5 11h5" />
    <circle cx="11" cy="11" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);
/** An arrow key's mark: a small solid triangle, drawn, so no font turns it into an emoji. */
const Tri = ({ d }: { d: 'up' | 'down' | 'left' | 'right' }) => (
  <svg width={7} height={7} viewBox="0 0 8 8" aria-label={d} style={{ transform: `rotate(${{ up: 0, right: 90, down: 180, left: 270 }[d]}deg)` }}>
    <path d="M4 1 L7.2 7 H0.8 Z" fill="currentColor" />
  </svg>
);
const Do = ({ how, what }: { how: React.ReactNode; what: string }) => <><span className="how">{how}</span><span className="what">{what}</span></>;

const LOOK = 0.0035; // radians per pixel of look
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
const hand = { on: false, axis: [0, 0], acc: [0, 0], picked: false, sign: 1 };
const tmpV = new THREE.Vector3(), tmpO = new THREE.Vector3();
/** Where axis `k` of the machine points on the page, in pixels, y down; long when it lies across the view. */
function onPage(k: number): [number, number] {
  const cam = rig.camera;
  if (!cam) return k === 0 ? [1, 0] : k === 1 ? [0, -1] : [0, 0];
  tmpO.set(0, 0, 0).project(cam);
  tmpV.set(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0).applyQuaternion(rig.q).project(cam);
  return [(tmpV.x - tmpO.x) * innerWidth / 2, -(tmpV.y - tmpO.y) * innerHeight / 2];
}
function handDown(sign = 1) { hand.on = true; hand.picked = false; hand.acc = [0, 0]; hand.sign = sign; }
function handMove(dx: number, dy: number) {
  if (!hand.on) return;
  if (!hand.picked) {
    hand.acc[0] += dx; hand.acc[1] += dy;
    const n = Math.hypot(hand.acc[0], hand.acc[1]);
    if (n < CRANK_PICK) return;
    const ux = hand.acc[0] / n, uy = hand.acc[1] / n;
    let best = 0, score = -1;
    for (let k = 0; k < 3; k++) { const [ax, ay] = onPage(k), s = Math.abs(ax * ux + ay * uy); if (s > score) { score = s; best = k; } }
    const k = crankStart(best); // the plane it is free to take, or the one it is part way through
    const [ax, ay] = onPage(k), l = Math.hypot(ax, ay) || 1;
    hand.axis = [ax / l, ay / l]; hand.picked = true;
    dx = hand.acc[0]; dy = hand.acc[1]; // what moved while it was picking counts too
  }
  crankBy((dx * hand.axis[0] + dy * hand.axis[1]) * CRANK * hand.sign);
}
function handUp() { if (hand.on && hand.picked) crankEnd(); hand.on = false; grip.held = -1; }

export function App() {
  const [, setHard] = useState(st.hard); // no switch for now, h; kept so the key re-renders
  const [spin, setSpin] = useState(rig.spin);
  const [transform, setTransform] = useState(st.transform);
  const [follow, setFollow] = useState(rig.follow);
  const [grid, setGrid] = useState(st.grid);
  const [manual, setManual] = useState(drone.pilot);
  const [locked, setLocked] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  // A drag anywhere on the page, what it does set when it starts: with alt it turns the machine in 4D by hand; at
  // the controls a plain drag is the look and shift orbits the camera; on its own a plain drag orbits. The orbit's
  // speed is kept, smoothed, to coast on.
  const drag = useRef<{ kind: 'look' | 'orbit' | 'crank'; x: number; y: number; t: number } | null>(null);
  const dragDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || document.pointerLockElement) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // on its own, with alt held, a drag on a strut takes it in the hand; alt is the only way to a strut
    const strut = !drone.pilot && e.altKey ? grip.hover : -1;
    const kind = e.altKey || strut >= 0 ? 'crank' : drone.pilot && !e.shiftKey ? 'look' : 'orbit';
    drag.current = { kind, x: e.clientX, y: e.clientY, t: performance.now() };
    if (kind === 'orbit') { rig.orbitVel[0] = rig.orbitVel[1] = 0; rig.orbiting = true; }
    if (kind === 'crank' && strut < 0) handDown();
    if (strut >= 0) { grip.held = strut; handDown(Math.abs(grip.w) > 0.2 ? -Math.sign(grip.w) : 1); }
  };
  // the pointer, for the strut under it
  const pointerAt = (e: React.PointerEvent) => { grip.x = e.clientX; grip.y = e.clientY; grip.in = true; grip.alt = e.altKey; };
  const dragMove = (e: React.PointerEvent) => {
    pointerAt(e);
    const d = drag.current;
    if (!d) return;
    const now = performance.now(), dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (d.kind === 'orbit') orbitBy(-dx * ORBIT, dy * ORBIT, Math.max(1, now - d.t) / 1000);
    else if (d.kind === 'crank') handMove(dx, dy);
    else if (drone.pilot) { drone.turn[0] += dx * LOOK * 1.6; drone.turn[1] += -dy * LOOK * 1.6; }
    d.x = e.clientX; d.y = e.clientY; d.t = now;
  };
  // a drag ends when its pointer capture does: on release, on cancel, or when the page takes the pointer away
  const dragEnd = () => { drag.current = null; rig.orbiting = false; handUp(); };
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

  // manual or auto, from p or the switch on the left
  const setMode = (m: boolean) => {
    drone.pilot = m; setManual(m);
    drone.keys.thrust = drone.keys.strafe = 0;
    rig.turntable = !m;
    if (!m && document.pointerLockElement) document.exitPointerLock();  };

  useEffect(() => {
    const keys = drone.keys;
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.key === 'Alt') { grip.alt = true; e.preventDefault(); return; } // alt held: the strut under the pointer shows
      if (k === 'p') { setMode(!drone.pilot); return; }
      if (k === 'h') { st.hard = !st.hard; setHard(st.hard); return; }
      if (k === 'o') { st.inout = !st.inout; return; } // the hand-over at a wall: folded by default, o for in, then out
      if (k === 'g') { st.eye = ({ drawing: 'outline', outline: 'hairline', hairline: 'drawing' } as const)[st.eye]; return; } // the eye's rooms: drawing, outlines, hairlines
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
  // then the settings, the camera's turntable and the machine turning in 4D on its own. Hard mode has no switch for
  // now: h.
  const controls = <><h5>Mode</h5><div className="smalls"><Small big on={manual} label={`Controls ${manual ? 'on' : 'off'}`} act={() => setMode(!drone.pilot)} /></div></>;
  const smalls = <>
    <h5>Settings</h5>
    <div className="smalls">
      <Small on={spin} label={`Turntable ${spin ? 'on' : 'off'}`} act={() => { rig.spin = !rig.spin; setSpin(rig.spin); }} />
      <Small on={transform} label={`Transform ${transform ? 'on' : 'off'}`} act={() => { st.transform = !st.transform; setTransform(st.transform); }} />
      <Small on={grid} label={`Camera grid ${grid ? 'on' : 'off'}`} act={() => { st.grid = !st.grid; setGrid(st.grid); }} />
      {/* follow is for the attract mode only */}
      {manual ? null : <Small on={follow} label={`Follow ${follow ? 'on' : 'off'}`} act={() => { rig.follow = !rig.follow; setFollow(rig.follow); }} />}
    </div>
  </>;

  const stageHandlers = { onPointerDown: dragDown, onPointerMove: dragMove, onLostPointerCapture: dragEnd, onPointerLeave: () => { grip.in = false; } };

  return (
    <>
      <div ref={stage} className={`stage ${locked ? 'locked' : ''}`} {...stageHandlers} onWheel={onWheel}>
        <Canvas camera={{ position: [0, 0, 10.5], fov: 34 }} gl={{ alpha: true, antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0, localClippingEnabled: true }} dpr={[1, 2]}>
          <Suspense fallback={null}>
            <Rig>
              <Machine />
              <Drones />
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
      </div>
      {CLEAN ? null : <div className="plate"><b>08 Tesseract</b><i>Codevember 2026</i></div>}
      <div id="lock" className="lock"><i /><i /><i /><i /><b>lock</b></div>
      {CLEAN ? null : manual ? <div className="keys">
        {controls}
        {/* then the pointer lock; locked, there is no pointer to click with, so the way out instead: esc */}
        {locked ? <div className="action hint"><Key wide>Esc</Key>to unlock</div> : <button className="action" tabIndex={-1}
          onPointerDown={(e) => e.preventDefault()} onClick={() => stage.current?.requestPointerLock()}>
          <Crosshair />
          Lock pointer
        </button>}
        {smalls}
        <h5 className="shortcuts">Shortcuts <span>(interactive mode)</span></h5>
        <h6 className="shortcuts">Navigation</h6>
        <Do how={<Key wide>{locked ? 'Mouse' : 'Drag'}</Key>} what="Steer" />
        <Do how={<><Key>W</Key><Key>S</Key><Key><Tri d="up" /></Key><Key><Tri d="down" /></Key></>} what="Forward, back" />
        <Do how={<><Key>A</Key><Key>D</Key><Key><Tri d="left" /></Key><Key><Tri d="right" /></Key></>} what="Strafe" />
        <Do how={<Key wide>Space</Key>} what="Forward" />
        <h6 className="shortcuts">View</h6>
        <Do how={<><Key>⇧</Key> + <Key wide>{locked ? 'Mouse' : 'Drag'}</Key></>} what="Orbit" />
        <Do how={<Key>L</Key>} what={locked ? 'Unlock pointer' : 'Lock pointer'} />
        <h6 className="shortcuts">Options</h6>
        <Do how={<><Key>{MAC ? '⌥' : 'Alt'}</Key> + <Key wide>{locked ? 'Mouse' : 'Drag'}</Key></>} what="Twist the tesseract" />
        <Do how={<Key>G</Key>} what="Drawing, outlines or hairlines in the eye" />
      </div> : <div className="keys">
        {controls}
        {smalls}
        <h5 className="shortcuts">Shortcuts</h5>
        <h6 className="shortcuts">View</h6>
        <Do how={<Key wide>Drag</Key>} what="Rotate" />
        <h6 className="shortcuts">Options</h6>
        <Do how={<><Key>{MAC ? '⌥' : 'Alt'}</Key> + <Key wide>Drag</Key></>} what="Twist the tesseract, by an edge if over one" />
        <Do how={<Key>G</Key>} what="Drawing, outlines or hairlines in the eye" />
      </div>}
    </>
  );
}
