import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { Machine } from './Machine';
import { Drones } from './Drones';
import { DroneCam } from './DroneCam';
import { drone } from './drone';
import { st, rig, spinRig } from './state';

const PARAMS = new URLSearchParams(location.search);
const CLEAN = PARAMS.has('clean'); // no page furniture, for the screengrab
if (PARAMS.has('follow')) drone.view = 'follow';

/** The machine and the drone on a rig the drag turns; the camera stands still. */
function Rig({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    ref.current?.quaternion.copy(rig.q);
    camera.position.set(0, 0, rig.zoom);
    camera.lookAt(0, 0, 0);
  });
  return <group ref={ref}>{children}</group>;
}

export function App() {
  const [program, setProgram] = useState(st.program);
  const [smooth, setSmooth] = useState(st.smooth);
  // drag turns the machine, not the camera; the wheel zooms
  const drag = useRef<{ x: number; y: number; t: number } | null>(null);
  const onDown = (e: React.PointerEvent) => { if (e.button === 0) { drag.current = { x: e.clientX, y: e.clientY, t: performance.now() }; rig.vel[0] = rig.vel[1] = 0; } };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const now = performance.now(), dt = Math.max(1, now - d.t) / 1000;
    const dy = (e.clientX - d.x) * 0.006, dx = (e.clientY - d.y) * 0.006;
    spinRig(dy, dx);
    rig.vel[0] = dy / dt; rig.vel[1] = dx / dt;
    if (Math.abs(e.clientX - d.x) > 2) { st.way = Math.sign(e.clientX - d.x); st.flipIn = 8 + Math.random() * 14; }
    drag.current = { x: e.clientX, y: e.clientY, t: now };
  };
  const onUp = () => { drag.current = null; };
  const onWheel = (e: React.WheelEvent) => { rig.zoom = Math.min(18, Math.max(6, rig.zoom * Math.exp(e.deltaY * 0.001))); };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); st.program = !st.program; setProgram(st.program); }
      if (e.key === 'm') { st.smooth = !st.smooth; setSmooth(st.smooth); }
      if (e.key === 'ArrowRight') { e.preventDefault(); st.crank = 1; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); st.crank = -1; }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') st.crank = 0;
    };
    const blur = () => { st.crank = 0; };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur); };
  }, []);

  return (
    <>
      <div className="stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onPointerCancel={onUp} onWheel={onWheel}>
        <Canvas camera={{ position: [0, 0, 10.5], fov: 34 }} gl={{ alpha: true, antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0 }} dpr={[1, 2]}>
          <Rig>
            <Machine />
            <Drones />
          </Rig>
          <DroneCam />
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
      {CLEAN ? null : (
        <div className="cam" onClick={() => { drone.view = drone.view === 'pov' ? 'follow' : 'pov'; }} />
      )}
      {CLEAN ? null : <div className="keys">
        <span><kbd>space</kbd>{program ? 'stop program' : 'run program'}</span>
        <span><kbd>drag</kbd>turn, sets the way</span>
        <span><kbd>m</kbd>{smooth ? 'servo' : 'smooth'}</span>
      </div>}
    </>
  );
}
