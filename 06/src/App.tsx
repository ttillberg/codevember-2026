import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { BackSide } from 'three';
import { Band } from './Band';
import { clock } from './clock';
import { dateFromJd } from './kepler';

// Mounted first, so it advances time before the band reads it.
function Tick() {
  useFrame((_, dt) => {
    if (!clock.paused) clock.jd += clock.speed * Math.min(dt, 0.1);
  });
  return null;
}

// Dev only: window.__look(x, y, z, tx, ty, tz) moves the camera, window.__clock is the simulated time.
function DevHooks() {
  const { camera, controls } = useThree();
  if (import.meta.env.DEV) {
    (window as any).__clock = clock;
    (window as any).__look = (x: number, y: number, z: number, tx = 0, ty = 0, tz = 0) => {
      camera.position.set(x, y, z);
      (controls as any)?.target.set(tx, ty, tz);
      (controls as any)?.update();
    };
  }
  return null;
}

// Bright studio built from light cards, no HDR files.
function Studio() {
  return (
    <Environment resolution={256}>
      <mesh scale={100}>
        <sphereGeometry />
        <meshBasicMaterial color="#d9dde2" side={BackSide} />
      </mesh>
      <Lightformer intensity={3} position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[30, 30, 1]} />
      <Lightformer intensity={1.5} position={[-14, 3, 6]} rotation-y={Math.PI / 2} scale={[16, 5, 1]} />
      <Lightformer intensity={1.5} position={[14, 3, -6]} rotation-y={-Math.PI / 2} scale={[16, 5, 1]} />
      <Lightformer intensity={1} position={[0, 2, 16]} scale={[20, 3, 1]} />
    </Environment>
  );
}

function DateLabel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (ref.current) ref.current.textContent = dateFromJd(clock.jd).toISOString().slice(0, 10);
      raf = requestAnimationFrame(loop);
    };
    loop();
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space') clock.paused = !clock.paused;
    };
    addEventListener('keydown', key);
    return () => (cancelAnimationFrame(raf), removeEventListener('keydown', key));
  }, []);
  return <div ref={ref} className="date" />;
}

export function App() {
  return (
    <>
      <Canvas camera={{ position: [0, 51, 0.01], fov: 40, near: 0.1, far: 400 }} dpr={[1, 2]}>
        <color attach="background" args={['#000000']} />
        <Tick />
        <DevHooks />
        <Studio />
        <Band />
        <OrbitControls enableDamping makeDefault />
        <EffectComposer multisampling={4}>
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        </EffectComposer>
      </Canvas>
      <DateLabel />
    </>
  );
}
