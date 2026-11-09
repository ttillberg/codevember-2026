import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { Machine } from './Machine';
import { Drones } from './Drones';
import { DroneCam } from './DroneCam';
import { drone, cellId, cellName, CELL_HEX } from './drone';
import { st, rig, spinRig, DEBUG } from './state';

const PARAMS = new URLSearchParams(location.search);
const CLEAN = PARAMS.has('clean'); // no page furniture, for the screengrab
if (PARAMS.has('follow')) drone.view = 'follow';

/** The machine and the drone on a rig the drag turns; the camera stands still. */
function Rig({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    ref.current?.quaternion.copy(rig.q);
    const cp = Math.cos(rig.pitch);
    camera.position.set(Math.sin(rig.yaw) * cp * rig.zoom, Math.sin(rig.pitch) * rig.zoom, Math.cos(rig.yaw) * cp * rig.zoom);
    camera.lookAt(0, 0, 0);
  });
  return <group ref={ref}>{children}</group>;
}

export function App() {
  const [program, setProgram] = useState(st.program);
  const [smooth, setSmooth] = useState(st.smooth);
  const [pilot, setPilot] = useState(drone.pilot);
  // debugging: which cell the device is in, in the trail's colour for it
  const [cell, setCell] = useState({ id: cellId(), name: cellName() });
  useEffect(() => {
    if (!DEBUG) return;
    const t = setInterval(() => { const id = cellId(); setCell((c) => (c.id === id ? c : { id, name: cellName() })); }, 100);
    return () => clearInterval(t);
  }, []);
  // drag turns the machine, not the camera; the wheel zooms
  const drag = useRef<{ x: number; y: number; t: number } | null>(null);
  // at the controls the pointer is the look and a held button the thrust; otherwise it turns the rig
  const LOOK = 0.0035; // radians per pixel
  // the eye's view: at the controls a drag in it is the look, yaw and pitch; a click without a drag toggles the view
  const camDrag = useRef<{ x: number; y: number; moved: number } | null>(null);
  const onCamDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    camDrag.current = { x: e.clientX, y: e.clientY, moved: 0 };
  };
  const onCamMove = (e: React.PointerEvent) => {
    const d = camDrag.current;
    if (!d) return;
    e.stopPropagation();
    // the button is up and the release never came: the drag is over, and hovering is not a turn
    if (!(e.buttons & 1)) { camDrag.current = null; return; }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    if (drone.pilot) { drone.turn[0] += dx * LOOK * 1.6; drone.turn[1] += -dy * LOOK * 1.6; }
    d.x = e.clientX; d.y = e.clientY;
  };
  const onCamUp = (e: React.PointerEvent) => {
    const d = camDrag.current;
    if (!d) return;
    e.stopPropagation();
    camDrag.current = null;
    if (d.moved < 4) drone.view = drone.view === 'pov' ? 'follow' : 'pov';
  };
  const last = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (drone.pilot && !DEBUG) { drone.keys.thrust = 1; return; }
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now() }; rig.vel[0] = rig.vel[1] = 0;
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current && !(e.buttons & 1)) { drag.current = null; if (drone.pilot) drone.keys.thrust = 0; } // a release that never came
    if (DEBUG) {
      // debugging: the drag orbits the camera, in either mode
      const d = drag.current;
      if (!d) return;
      rig.yaw -= (e.clientX - d.x) * 0.006;
      rig.pitch = Math.max(-1.4, Math.min(1.4, rig.pitch + (e.clientY - d.y) * 0.006));
      drag.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      return;
    }
    if (drone.pilot) {
      const l = last.current;
      if (l) { drone.turn[0] += (e.clientX - l.x) * LOOK; drone.turn[1] += -(e.clientY - l.y) * LOOK; }
      last.current = { x: e.clientX, y: e.clientY };
      return;
    }
    last.current = null;
    const d = drag.current;
    if (!d) return;
    const now = performance.now(), dt = Math.max(1, now - d.t) / 1000;
    const dy = (e.clientX - d.x) * 0.006, dx = (e.clientY - d.y) * 0.006;
    spinRig(dy, dx);
    rig.vel[0] = dy / dt; rig.vel[1] = dx / dt;
    if (Math.abs(e.clientX - d.x) > 2) { st.way = Math.sign(e.clientX - d.x); st.flipIn = 8 + Math.random() * 14; }
    drag.current = { x: e.clientX, y: e.clientY, t: now };
  };
  const onUp = () => { drag.current = null; if (drone.pilot && !DEBUG) drone.keys.thrust = 0; };
  const onLeave = () => { drag.current = null; last.current = null; if (drone.pilot) drone.keys.thrust = 0; };
  const onWheel = (e: React.WheelEvent) => { rig.zoom = Math.min(18, Math.max(6, rig.zoom * Math.exp(e.deltaY * 0.001))); };

  useEffect(() => {
    // at the controls: w s thrust, a d and the side arrows yaw, up and down pitch; the keys are held, not tapped
    const keys = drone.keys;
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); if (drone.pilot) { keys.thrust = 1; return; } st.program = !st.program; setProgram(st.program); }
      if (k === 'm') { st.smooth = !st.smooth; setSmooth(st.smooth); }
      if (k === 'p') { drone.pilot = !drone.pilot; setPilot(drone.pilot); keys.thrust = keys.yaw = keys.pitch = 0; st.crank = 0; }
      if (drone.pilot) {
        if (k === 'w') keys.thrust = 1;
        if (k === 's') keys.thrust = -1;
        if (k === 'a' || k === 'arrowleft') keys.yaw = 1;
        if (k === 'd' || k === 'arrowright') keys.yaw = -1;
        if (k === 'arrowup') keys.pitch = 1;
        if (k === 'arrowdown') keys.pitch = -1;
        if (k.startsWith('arrow')) e.preventDefault();
        return;
      }
      if (k === 'arrowright') { e.preventDefault(); st.crank = 1; }
      if (k === 'arrowleft') { e.preventDefault(); st.crank = -1; }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowright' || k === 'arrowleft') st.crank = 0;
      if (k === 'w' || k === 's' || k === ' ') keys.thrust = 0;
      if (k === 'a' || k === 'd' || k === 'arrowleft' || k === 'arrowright') keys.yaw = 0;
      if (k === 'arrowup' || k === 'arrowdown') keys.pitch = 0;
    };
    const blur = () => { st.crank = 0; keys.thrust = keys.yaw = keys.pitch = 0; };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur); };
  }, []);

  return (
    <>
      <div className="stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onLeave} onPointerCancel={onUp} onWheel={onWheel}>
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
      <div className={pilot ? 'cam look' : 'cam'} onPointerDown={onCamDown} onPointerMove={onCamMove} onPointerUp={onCamUp} onPointerCancel={onCamUp} />
      {DEBUG ? <div className="cell"><i style={{ background: CELL_HEX[cell.id] }} />cell {cell.name}</div> : null}
      {CLEAN ? null : pilot ? <div className="keys">
        <span><kbd>drag eye</kbd>look</span>
        {DEBUG ? <><span><kbd>drag</kbd>orbit</span><span><kbd>a d</kbd>yaw</span><span><kbd>↑ ↓</kbd>pitch</span></> : <><span><kbd>move</kbd>look</span><span><kbd>hold</kbd>thrust</span></>}
        <span><kbd>space</kbd>thrust</span>
        <span><kbd>p</kbd>let go</span>
      </div> : <div className="keys">
        <span><kbd>space</kbd>{program ? 'stop program' : 'run program'}</span>
        <span><kbd>drag</kbd>{DEBUG ? 'orbit' : 'turn, sets the way'}</span>
        <span><kbd>m</kbd>{smooth ? 'servo' : 'smooth'}</span>
        <span><kbd>p</kbd>take the controls</span>
      </div>}
    </>
  );
}
