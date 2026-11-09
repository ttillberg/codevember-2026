import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { Machine } from './Machine';
import { Drones } from './Drones';
import { DroneCam } from './DroneCam';
import { drone } from './drone';
import { st, rig, orbitBy } from './state';

const PARAMS = new URLSearchParams(location.search);
const CLEAN = PARAMS.has('clean'); // no page furniture, for the screengrab

// Two modes, the same two views in both: the machine fills the page, the eye's view sits in the corner, a drag on
// the page orbits the camera. Auto, the attract mode: the device flies on its own and the camera turns slowly on a
// turntable. Manual: a drag in the eye's view is the look, or with the pointer locked (l) the mouse itself is; w s
// and the up and down arrows go forward and back, a d and the side arrows strafe, space is forward too. Hard mode
// (h), in either: the machine turns in 4D all the time, changing plane as it goes.

/** The machine and the device on a rig with a fixed tilt; the camera orbits round it. */
function Rig({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera, size }, dt) => {
    ref.current?.quaternion.copy(rig.q);
    // the distance fits the machine's reach to the page, whichever way is narrower, with a margin; eased, so the
    // picture breathes as the machine changes shape rather than jumps; the wheel scales it
    const cam = camera as THREE.PerspectiveCamera;
    const vfov = THREE.MathUtils.degToRad(cam.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * (size.width / size.height));
    const fit = (st.reach * 0.98) / Math.sin(Math.min(vfov, hfov) / 2);
    rig.zoom += (fit * rig.zoomK - rig.zoom) * Math.min(1, dt * 2.5);
    camera.position.setFromSphericalCoords(rig.zoom, Math.PI / 2 - rig.pitch, rig.yaw);
    camera.lookAt(0, 0, 0);
  });
  return <group ref={ref}>{children}</group>;
}

const LOOK = 0.0035; // radians per pixel of look
const ORBIT = 0.006; // radians per pixel of orbit

export function App() {
  const [hard, setHard] = useState(st.hard);
  const [manual, setManual] = useState(drone.pilot);
  const [locked, setLocked] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  // the orbit: a drag turns the camera round the machine as it goes, and its speed is kept, smoothed, to coast on
  const orbit = useRef<{ x: number; y: number; t: number } | null>(null);
  const orbitDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    orbit.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    rig.orbitVel[0] = rig.orbitVel[1] = 0; rig.orbiting = true;
  };
  const orbitMove = (e: React.PointerEvent) => {
    const d = orbit.current;
    if (!d) return;
    const now = performance.now();
    orbitBy(-(e.clientX - d.x) * ORBIT, (e.clientY - d.y) * ORBIT, Math.max(1, now - d.t) / 1000);
    orbit.current = { x: e.clientX, y: e.clientY, t: now };
  };
  // a drag ends when its pointer capture does: on release, on cancel, or when the page takes the pointer away
  const orbitEnd = () => { orbit.current = null; rig.orbiting = false; };
  // the look: a drag turns the eye the way it is dragged
  const look = useRef<{ x: number; y: number } | null>(null);
  const lookDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !drone.pilot || document.pointerLockElement) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    look.current = { x: e.clientX, y: e.clientY };
  };
  const lookMove = (e: React.PointerEvent) => {
    const d = look.current;
    if (!d || !drone.pilot) return;
    drone.turn[0] += (e.clientX - d.x) * LOOK * 1.6; drone.turn[1] += -(e.clientY - d.y) * LOOK * 1.6;
    d.x = e.clientX; d.y = e.clientY;
  };
  const lookEnd = () => { look.current = null; };
  const onWheel = (e: React.WheelEvent) => { rig.zoomK = Math.min(2.2, Math.max(0.5, rig.zoomK * Math.exp(e.deltaY * 0.001))); };

  // the pointer lock: the mouse itself is the look, no drag; with shift held it orbits the machine instead, and
  // coasts when shift is let go
  useEffect(() => {
    const change = () => setLocked(document.pointerLockElement === stage.current);
    let last = 0;
    const move = (e: MouseEvent) => {
      if (document.pointerLockElement !== stage.current || !drone.pilot) return;
      if (e.shiftKey) {
        const now = performance.now(), dt = Math.max(1, now - last) / 1000; last = now;
        orbitBy(-e.movementX * ORBIT, e.movementY * ORBIT, dt);
        return;
      }
      rig.orbiting = false; // shift let go without its keyup reaching the page: the orbit coasts
      drone.turn[0] += e.movementX * LOOK; drone.turn[1] += -e.movementY * LOOK;
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') rig.orbiting = false; };
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
    if (!m && document.pointerLockElement) document.exitPointerLock();
  };

  useEffect(() => {
    const keys = drone.keys;
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'p') { setMode(!drone.pilot); return; }
      if (k === 'h') { st.hard = !st.hard; setHard(st.hard); return; }
      if (k === 'o') { st.inout = !st.inout; return; } // the hand-over at a wall: in-then-out by default, o folds
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
      if (k === ' ' || k === 'w' || k === 's' || k === 'arrowup' || k === 'arrowdown') keys.thrust = 0;
      if (k === 'a' || k === 'd' || k === 'arrowleft' || k === 'arrowright') keys.strafe = 0;
    };
    const blur = () => { keys.thrust = keys.strafe = 0; rig.orbiting = false; };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur); };
  }, []);

  // the page orbits; in manual a drag in the eye's view is the look, in auto the view lets the drag through (css).
  // The handlers stay on in both modes, so a mode switch mid-drag cannot leave a drag behind
  const stageHandlers = { onPointerDown: orbitDown, onPointerMove: orbitMove, onLostPointerCapture: orbitEnd };
  const camHandlers = { onPointerDown: lookDown, onPointerMove: lookMove, onLostPointerCapture: lookEnd };

  return (
    <>
      <div ref={stage} className={`stage ${locked ? 'locked' : ''}`} {...stageHandlers} onWheel={onWheel}>
        <Canvas camera={{ position: [0, 0, 10.5], fov: 34 }} gl={{ alpha: true, antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0, localClippingEnabled: true }} dpr={[1, 2]}>
          <Suspense fallback={null}>
            <Rig>
              <Machine />
              <Drones />
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
      {CLEAN ? null : <div className="plate"><b>08 Tesseract</b><i>Codevember 08</i></div>}
      <div id="lock" className="lock"><i /><i /><i /><i /><b>lock</b></div>
      <div className={`cam ${manual ? 'look' : 'pass'}`} {...camHandlers} />
      {CLEAN ? null : <div className="toggles">
        <button className={`toggle ${manual ? 'on' : ''}`} role="switch" aria-checked={manual} tabIndex={-1}
          onPointerDown={(e) => e.preventDefault()} onClick={() => setMode(!drone.pilot)}>
          <span className="track"><i /></span>
          <span className="label">Pilot</span>
        </button>
        <button className={`toggle ${hard ? 'on' : ''}`} role="switch" aria-checked={hard} tabIndex={-1}
          onPointerDown={(e) => e.preventDefault()} onClick={() => { st.hard = !st.hard; setHard(st.hard); }}>
          <span className="track"><i /></span>
          <span className="label">Hard mode</span>
        </button>
      </div>}
      {CLEAN ? null : manual ? <div className="keys">
        <span><kbd>{locked ? 'mouse' : 'drag eye'}</kbd>look</span>
        <span><kbd>{locked ? 'shift mouse' : 'drag'}</kbd>orbit</span>
        <span><kbd>w s ↑ ↓</kbd>forward, back</span>
        <span><kbd>a d ← →</kbd>strafe</span>
        <span><kbd>space</kbd>forward</span>
        <span><kbd>l</kbd>{locked ? 'unlock pointer' : 'lock pointer'}</span>
        <span><kbd>h</kbd>{hard ? 'hard off' : 'hard'}</span>
        <span><kbd>p</kbd>auto</span>
      </div> : <div className="keys">
        <span><kbd>drag</kbd>orbit</span>
        <span><kbd>h</kbd>{hard ? 'hard off' : 'hard'}</span>
        <span><kbd>p</kbd>manual</span>
      </div>}
    </>
  );
}
