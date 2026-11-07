import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { BackSide, NeutralToneMapping, PCFShadowMap } from 'three';
import { AO } from './AO';
import { CameraRig } from './CameraRig';
import { PlanetList } from './PlanetList';
import { Beans } from './Beans';
import { PlanetCard } from './PlanetCard';
import { pick } from './selection';
import { Sea } from './Sea';
import { Space } from './Space';
import { Sun } from './Sun';
import { clock } from './clock';
import { dateFromJd, jdFromDate } from './kepler';

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

// A QuickTime style transport along the bottom, on frosted glass. On top: slower, play or pause, faster, and the
// speed at the right (three steps, named for how they feel rather than the factor between them). Underneath: the
// date, and a scrubber over two centuries to drag through time. Space plays and pauses too. Kept in step with the
// clock every frame, as other things change it (focusing on a planet slows it down).
const SPEEDS: [string, number][] = [['×0.25', 0.4], ['×1', 3], ['×5', 30]]; // label, days a second
const FROM = jdFromDate(new Date(Date.UTC(1900, 0, 1)));
const TO = jdFromDate(new Date(Date.UTC(2100, 0, 1)));
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} fill="currentColor" />
  </svg>
);
function Transport() {
  const date = useRef<HTMLSpanElement>(null);
  const scrub = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const [state, setState] = useState({ paused: clock.paused, speed: clock.speed });
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (date.current) date.current.textContent = dateFromJd(clock.jd).toISOString().slice(0, 10);
      if (scrub.current && !dragging.current) scrub.current.value = String(clock.jd);
      setState((s) => (s.paused === clock.paused && s.speed === clock.speed ? s : { paused: clock.paused, speed: clock.speed }));
      raf = requestAnimationFrame(loop);
    };
    loop();
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space') (e.preventDefault(), (clock.paused = !clock.paused));
    };
    addEventListener('keydown', key);
    return () => (cancelAnimationFrame(raf), removeEventListener('keydown', key));
  }, []);
  // The nearest step to the clock's speed, and stepping from it.
  const at = SPEEDS.reduce((best, [, d], i) => (Math.abs(d - state.speed) < Math.abs(SPEEDS[best][1] - state.speed) ? i : best), 0);
  const step = (by: number) => (clock.speed = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, at + by))][1]);
  const blur = (e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.blur();
  return (
    <div className="transport">
      <div className="top">
        <div className="buttons">
          <button onClick={(e) => (step(-1), blur(e))} aria-label="Slower" disabled={at === 0}>
            <Icon d="M11.5 6v12L3 12zM21 6v12l-8.5-6z" />
          </button>
          <button className="play" onClick={(e) => ((clock.paused = !clock.paused), blur(e))} aria-label={state.paused ? 'Play' : 'Pause'}>
            <Icon d={state.paused ? 'M7 4.5v15L19.5 12z' : 'M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z'} />
          </button>
          <button onClick={(e) => (step(1), blur(e))} aria-label="Faster" disabled={at === SPEEDS.length - 1}>
            <Icon d="M3 6v12l8.5-6zM12.5 6v12L21 12z" />
          </button>
        </div>
        <button className="speed" onClick={(e) => ((clock.speed = SPEEDS[(at + 1) % SPEEDS.length][1]), blur(e))} aria-label="Speed">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 12l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {SPEEDS[at][0]}
        </button>
      </div>
      <div className="timeline">
        <span ref={date} className="when" />
        <input
          ref={scrub}
          type="range"
          min={FROM}
          max={TO}
          step={1}
          defaultValue={clock.jd}
          aria-label="Date"
          onPointerDown={() => (dragging.current = true)}
          onPointerUp={(e) => ((dragging.current = false), e.currentTarget.blur())}
          onInput={(e) => (clock.jd = Number(e.currentTarget.value))}
        />
        <span className="end">2100</span>
      </div>
    </div>
  );
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
      <Canvas camera={{ position: [0, 72.6, 0.001], fov: 40, near: 1, far: 250 }} dpr={[1, 2]} shadows={{ type: PCFShadowMap }} gl={{ toneMapping: NeutralToneMapping }} onPointerMissed={() => pick(null)}>
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
        <CameraRig />
        <AO />
      </Canvas>
      <PlanetList />
      <Transport />
      <button className="theme" onClick={toggle} aria-label="Toggle dark or light background">
        {theme === 'light' ? 'dark' : 'light'}
      </button>
      <PlanetCard />
    </>
  );
}
