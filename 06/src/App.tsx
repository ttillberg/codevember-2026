import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { BackSide, NeutralToneMapping, PCFShadowMap } from 'three';
import { AO } from './AO';
import { Beans } from './Beans';
import { PlanetCard } from './PlanetCard';
import { pick } from './selection';
import { Sea } from './Sea';
import { Space } from './Space';
import { Sun } from './Sun';
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
  const { camera, controls, scene, gl } = useThree();
  if (import.meta.env.DEV) {
    (window as any).__clock = clock;
    (window as any).__three = { scene, gl, camera };
    (window as any).__look = (x: number, y: number, z: number, tx = 0, ty = 0, tz = 0) => {
      camera.position.set(x, y, z);
      (controls as any)?.target.set(tx, ty, tz);
      (controls as any)?.update();
    };
  }
  return null;
}

// A bright, soft studio like a product shot of candy: a big softbox overhead, strips either side for the long
// highlights along each bean's glaze, a pale grey room for fill. Built from light cards, no HDR files.
function Studio() {
  return (
    // Very dim, a little fill and the reflections in the glazes: the sun is the key light, so each planet has a lit
    // side facing the lollipop and a dark side away from it.
    <Environment resolution={256} environmentIntensity={0.12}>
      <mesh scale={100}>
        <sphereGeometry />
        <meshBasicMaterial color="#4a4c50" side={BackSide} />
      </mesh>
      <Lightformer intensity={2.5} position={[0, 20, 0]} rotation-x={Math.PI / 2} scale={[40, 40, 1]} />
      <Lightformer intensity={2} position={[-20, 8, 0]} rotation-y={Math.PI / 2} scale={[40, 6, 1]} />
      <Lightformer intensity={2} position={[20, 8, 0]} rotation-y={-Math.PI / 2} scale={[40, 6, 1]} />
      <Lightformer intensity={1.5} position={[0, 8, 20]} scale={[40, 6, 1]} />
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

// Light or dark room. The choice is remembered between visits; B toggles it too.
const BACKGROUND = { light: '#eceef1', dark: '#0b0c0f' };
type Theme = keyof typeof BACKGROUND;
function savedTheme(): Theme {
  try {
    return localStorage.getItem('orrery-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function App() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const toggle = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  useEffect(() => {
    document.body.dataset.theme = theme;
    try {
      localStorage.setItem('orrery-theme', theme);
    } catch {
      // private mode: just don't remember
    }
  }, [theme]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => (e.key === 'b' || e.key === 'B') && toggle();
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  return (
    <>
      <Canvas camera={{ position: [0, 85, 0.01], fov: 40, near: 1, far: 250 }} dpr={[1, 2]} shadows={{ type: PCFShadowMap }} gl={{ toneMapping: NeutralToneMapping }} onPointerMissed={() => pick(null)}>
        <color attach="background" args={[BACKGROUND[theme]]} />
        <Tick />
        <DevHooks />
        <Studio />
        <Sun />
        <Space />
        <Suspense fallback={null}>
          <Physics gravity={[0, -30, 0]} timeStep={1 / 60}>
            <Beans />
            <Sea />
          </Physics>
        </Suspense>
        {/* Looking straight down on the lollipop, the orbits round it filling the view. */}
        <OrbitControls enableDamping makeDefault target={[0, 12.6, 0]} />
        <AO />
      </Canvas>
      <DateLabel />
      <button className="theme" onClick={toggle} aria-label="Toggle dark or light background">
        {theme === 'light' ? 'dark' : 'light'}
      </button>
      <PlanetCard />
    </>
  );
}
