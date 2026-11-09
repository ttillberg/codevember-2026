import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Machine } from './Machine';
import { st, phase } from './state';

function Readout() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const a = st.angle * 180 / Math.PI;
        const cells = el.querySelectorAll('b');
        cells[0].textContent = `${String(Math.round(((a % 360) + 360) % 360)).padStart(3, '0')}°`;
        cells[1].textContent = String(Math.floor(a / 360));
        cells[2].textContent = st.lengths.min.toFixed(2);
        cells[3].textContent = st.lengths.max.toFixed(2);
        cells[4].textContent = phase();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="readout" ref={ref}>
      <span>XW <b>000°</b></span>
      <span>TURNS <b>0</b></span>
      <span>STRUT <b>0.00</b>–<b>0.00</b></span>
      <span>SERVO <b>HOLD</b></span>
    </div>
  );
}

const CLEAN = new URLSearchParams(location.search).has('clean'); // no page furniture, for the screengrab

export function App() {
  const [program, setProgram] = useState(st.program);
  const [shift, setShift] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); st.program = !st.program; setProgram(st.program); }
      if (e.key === 't') st.turntable.on = !st.turntable.on;
      if (e.key === 'Shift') { st.shift = true; setShift(true); }
      if (e.key === 'ArrowRight') { e.preventDefault(); st.crank = 1; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); st.crank = -1; }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') { st.shift = false; setShift(false); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') st.crank = 0;
    };
    const blur = () => { st.crank = 0; st.shift = false; setShift(false); };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur); };
  }, []);

  // shift + drag cranks
  const drag = useRef<number | null>(null);
  const onDown = (e: React.PointerEvent) => { if (st.shift) drag.current = e.clientX; };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current === null) return;
    st.target += (e.clientX - drag.current) * 0.006;
    drag.current = e.clientX;
  };
  const onUp = () => { drag.current = null; };

  return (
    <>
      <div className="stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
        <Canvas camera={{ position: [4.8, 2.6, 8.2], fov: 34 }} gl={{ alpha: true, antialias: true, toneMappingExposure: 1.15 }} dpr={[1, 2]}>
          <Machine />
          <ContactShadows position={[0, -3.4, 0]} opacity={0.6} scale={16} blur={2.6} far={5} resolution={1024} color="#2a2620" />
          <Environment resolution={256}>
            <Lightformer intensity={2.6} rotation-x={Math.PI / 2} position={[0, 7, 0]} scale={[10, 10, 1]} />
            <Lightformer intensity={1.8} rotation-y={Math.PI / 2} position={[-8, 2, 2]} scale={[8, 5, 1]} color="#fff4e6" />
            <Lightformer intensity={1.2} rotation-y={-Math.PI / 2} position={[8, 1, -2]} scale={[8, 5, 1]} color="#e6f0ff" />
            <Lightformer intensity={0.6} rotation-x={-Math.PI / 2} position={[0, -6, 0]} scale={[12, 12, 1]} color="#d8d2c6" />
          </Environment>
          <directionalLight position={[4, 8, 6]} intensity={1.1} />
          <OrbitControls enabled={!shift} enableDamping enablePan={false} minDistance={5} maxDistance={20} target={[0, -0.2, 0]} />
        </Canvas>
      </div>
      {CLEAN ? null : <div className="plate">
        <div className="brand">
          <b>TESSERAKT</b>
          <i>四次元 · 超立方体 · UNIT 08</i>
        </div>
        <p>A hypercube built for real. 32 telescopic struts on 16 ball joints, one servo cranking it through the XW plane in steps: a 4D turn seen in 3D is an object whose edges change length. Everything else is rigid.</p>
        <Readout />
      </div>}
      {CLEAN ? null : <div className="keys">
        <span><kbd>space</kbd>{program ? 'stop program' : 'run program'}</span>
        <span><kbd>←</kbd><kbd>→</kbd>crank</span>
        <span><kbd>⇧</kbd>drag crank</span>
        <span><kbd>drag</kbd>orbit</span>
        <span><kbd>t</kbd>turntable</span>
      </div>}
    </>
  );
}
