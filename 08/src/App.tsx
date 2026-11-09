import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { Machine } from './Machine';
import { Drones } from './Drones';
import { DroneCam } from './DroneCam';
import { drone, cellId, cellName, CELL_HEX } from './drone';
import { st, rig, orbitBy, DEBUG } from './state';

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
  const [program, setProgram] = useState(st.program);
  const [smooth, setSmooth] = useState(st.smooth);
  const [hard, setHard] = useState(st.hard);
  const [inout, setInout] = useState(st.inout);
  const [manual, setManual] = useState(drone.pilot);
  const [locked, setLocked] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  // debugging: which cell the device is in, in its colour
  const [cell, setCell] = useState({ id: cellId(), name: cellName() });
  useEffect(() => {
    if (!DEBUG) return;
    const t = setInterval(() => { const id = cellId(); setCell((c) => (c.id === id ? c : { id, name: cellName() })); }, 100);
    return () => clearInterval(t);
  }, []);

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
    if (!(e.buttons & 1)) { orbit.current = null; rig.orbiting = false; return; } // a release that never came
    const now = performance.now();
    orbitBy(-(e.clientX - d.x) * ORBIT, (e.clientY - d.y) * ORBIT, Math.max(1, now - d.t) / 1000);
    orbit.current = { x: e.clientX, y: e.clientY, t: now };
  };
  const orbitEnd = () => { orbit.current = null; rig.orbiting = false; };
  // the look: a drag turns the eye the way it is dragged
  const look = useRef<{ x: number; y: number } | null>(null);
  const lookDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || document.pointerLockElement) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    look.current = { x: e.clientX, y: e.clientY };
  };
  const lookMove = (e: React.PointerEvent) => {
    const d = look.current;
    if (!d) return;
    if (!(e.buttons & 1)) { look.current = null; return; }
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
      drone.turn[0] += e.movementX * LOOK; drone.turn[1] += -e.movementY * LOOK;
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') rig.orbiting = false; };
    document.addEventListener('pointerlockchange', change);
    document.addEventListener('mousemove', move);
    addEventListener('keyup', up);
    return () => { document.removeEventListener('pointerlockchange', change); document.removeEventListener('mousemove', move); removeEventListener('keyup', up); };
  }, []);

  useEffect(() => {
    const keys = drone.keys;
    const setMode = (m: boolean) => {
      drone.pilot = m; setManual(m);
      keys.thrust = keys.strafe = 0; st.crank = 0;
      rig.turntable = !m;
      if (!m && document.pointerLockElement) document.exitPointerLock();
    };
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'p') { setMode(!drone.pilot); return; }
      if (k === 'h') { st.hard = !st.hard; setHard(st.hard); return; }
      if (k === 'o') { st.inout = !st.inout; setInout(st.inout); return; }
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
      // auto: space runs the program, m swaps servo and smooth, the side arrows crank
      if (k === ' ') { e.preventDefault(); st.program = !st.program; setProgram(st.program); }
      if (k === 'm') { st.smooth = !st.smooth; setSmooth(st.smooth); }
      if (k === 'arrowright') { e.preventDefault(); st.crank = 1; }
      if (k === 'arrowleft') { e.preventDefault(); st.crank = -1; }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowright' || k === 'arrowleft') st.crank = 0;
      if (k === ' ' || k === 'w' || k === 's' || k === 'arrowup' || k === 'arrowdown') keys.thrust = 0;
      if (k === 'a' || k === 'd' || k === 'arrowleft' || k === 'arrowright') keys.strafe = 0;
    };
    const blur = () => { st.crank = 0; keys.thrust = keys.strafe = 0; };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur); };
  }, []);

  // the page orbits; in manual a drag in the eye's view is the look, in auto the view lets the drag through
  const stageHandlers = { onPointerDown: orbitDown, onPointerMove: orbitMove, onPointerUp: orbitEnd, onPointerCancel: orbitEnd };
  const camHandlers = manual ? { onPointerDown: lookDown, onPointerMove: lookMove, onPointerUp: lookEnd, onPointerCancel: lookEnd } : {};

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
      {CLEAN ? null : <div className="plate"><b>Tesseract</b><i>CDVMBR 08</i></div>}
      <div id="lock" className="lock"><i /><i /><i /><i /><b>lock</b></div>
      <div className={`cam ${manual ? 'look' : 'pass'}`} {...camHandlers} />
      {DEBUG ? <div className="cell"><i style={{ background: CELL_HEX[cell.id] }} />cell {cell.name}</div> : null}
      {CLEAN ? null : manual ? <div className="keys">
        <span><kbd>{locked ? 'mouse' : 'drag eye'}</kbd>look</span>
        <span><kbd>{locked ? 'shift mouse' : 'drag'}</kbd>orbit</span>
        <span><kbd>w s ↑ ↓</kbd>forward, back</span>
        <span><kbd>a d ← →</kbd>strafe</span>
        <span><kbd>space</kbd>forward</span>
        <span><kbd>l</kbd>{locked ? 'unlock pointer' : 'lock pointer'}</span>
        <span><kbd>h</kbd>{hard ? 'hard off' : 'hard'}</span>
        <span><kbd>o</kbd>{inout ? 'fold' : 'in, out'}</span>
        <span><kbd>p</kbd>auto</span>
      </div> : <div className="keys">
        <span><kbd>drag</kbd>orbit</span>
        <span><kbd>space</kbd>{program ? 'stop program' : 'run program'}</span>
        <span><kbd>m</kbd>{smooth ? 'servo' : 'smooth'}</span>
        <span><kbd>h</kbd>{hard ? 'hard off' : 'hard'}</span>
        <span><kbd>o</kbd>{inout ? 'fold' : 'in, out'}</span>
        <span><kbd>p</kbd>manual</span>
      </div>}
    </>
  );
}
