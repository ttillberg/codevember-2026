import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Machine } from './Machine';
import { Drones } from './Drones';
import { DroneCam } from './DroneCam';
import { Laser, laser } from './Laser';
import { drone } from './drone';
import { st } from './state';

const PARAMS = new URLSearchParams(location.search);
const CLEAN = PARAMS.has('clean'); // no page furniture, for the screengrab
if (PARAMS.has('follow')) drone.view = 'follow';
if (PARAMS.has('laser')) { laser.on = true; laser.x = innerWidth * 0.5; laser.y = innerHeight * 0.48; } // for a screenshot

export function App() {
  const [program, setProgram] = useState(st.program);
  const [smooth, setSmooth] = useState(st.smooth);
  const [orbit, setOrbit] = useState(true);

  // hold the pointer still a moment and it becomes a laser; move it straight away and it orbits
  const hold = useRef<{ x: number; y: number; timer: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    laser.x = e.clientX; laser.y = e.clientY;
    const timer = window.setTimeout(() => { laser.on = true; setOrbit(false); hold.current = null; }, 220);
    hold.current = { x: e.clientX, y: e.clientY, timer };
  };
  const onMove = (e: React.PointerEvent) => {
    laser.x = e.clientX; laser.y = e.clientY;
    const h = hold.current;
    if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 4) { clearTimeout(h.timer); hold.current = null; }
  };
  const onUp = () => {
    if (hold.current) { clearTimeout(hold.current.timer); hold.current = null; }
    if (laser.on) { laser.on = false; setOrbit(true); }
  };
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
      <div className="stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onPointerCancel={onUp}>
        <Canvas camera={{ position: [4.8, 2.6, 8.2], fov: 34 }} gl={{ alpha: true, antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0 }} dpr={[1, 2]}>
          <Machine />
          <Drones />
          <DroneCam />
          <Laser />
          <ContactShadows position={[0, -3.4, 0]} opacity={0.6} scale={16} blur={2.6} far={5} resolution={1024} color="#2a2620" />
          <Environment resolution={256}>
            <Lightformer intensity={2.6} rotation-x={Math.PI / 2} position={[0, 7, 0]} scale={[10, 10, 1]} />
            <Lightformer intensity={1.8} rotation-y={Math.PI / 2} position={[-8, 2, 2]} scale={[8, 5, 1]} color="#fff4e6" />
            <Lightformer intensity={1.2} rotation-y={-Math.PI / 2} position={[8, 1, -2]} scale={[8, 5, 1]} color="#e6f0ff" />
            <Lightformer intensity={0.6} rotation-x={-Math.PI / 2} position={[0, -6, 0]} scale={[12, 12, 1]} color="#d8d2c6" />
          </Environment>
          <directionalLight position={[4, 8, 6]} intensity={1.1} />
          <OrbitControls
            enabled={orbit} enableDamping enablePan={false} minDistance={5} maxDistance={20} target={[0, -0.2, 0]}
            onChange={(e) => { if (e) st.azimuth = (e.target as { getAzimuthalAngle: () => number }).getAzimuthalAngle(); }}
          />
        </Canvas>
      </div>
      {CLEAN ? null : <div className="plate"><b>CDVMBR 08</b></div>}
      {CLEAN ? null : (
        <div className="cam" onClick={() => { drone.view = drone.view === 'pov' ? 'follow' : 'pov'; }} />
      )}
      {CLEAN ? null : <div className="keys">
        <span><kbd>space</kbd>{program ? 'stop program' : 'run program'}</span>
        <span><kbd>drag</kbd>orbit, sets the way</span>
        <span><kbd>hold</kbd>laser</span>
        <span><kbd>m</kbd>{smooth ? 'servo' : 'smooth'}</span>
      </div>}
    </>
  );
}
