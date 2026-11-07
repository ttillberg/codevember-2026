import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { BackSide, NeutralToneMapping, PCFShadowMap } from 'three';
import { AO } from './AO';
import { CameraRig } from './CameraRig';
import { Orbits, orbitsShown } from './Orbits';
import { Stars } from './Stars';
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
const SPEEDS: [string, number][] = [['×0.5', 0.4], ['×1', 3], ['×5', 30]]; // label, days a second
const FROM = jdFromDate(new Date(Date.UTC(1900, 0, 1)));
const TO = jdFromDate(new Date(Date.UTC(2100, 0, 1)));
// Soft cornered glyphs, as QuickTime's: each shape filled and outlined with a round join, which rounds its corners.
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} fill="currentColor" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
  </svg>
);
// The transport can be dragged anywhere by its glass (not its buttons or scrubber), kept this far from the edges.
// Where it was left is remembered.
const EDGE = 12;
function useDraggable() {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const place = (x: number, y: number) => {
      const cx = Math.min(Math.max(x, EDGE), innerWidth - el.offsetWidth - EDGE);
      const cy = Math.min(Math.max(y, EDGE), innerHeight - el.offsetHeight - EDGE);
      Object.assign(el.style, { left: `${cx}px`, top: `${cy}px`, bottom: 'auto', transform: 'none' });
      return [cx, cy];
    };
    let saved: [number, number] | null = null;
    try {
      saved = JSON.parse(localStorage.getItem('orrery-transport') ?? 'null');
    } catch {
      // nothing remembered
    }
    if (saved) place(saved[0], saved[1]);
    let grab: { dx: number; dy: number } | null = null;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, input')) return;
      const r = el.getBoundingClientRect();
      grab = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
    };
    const move = (e: PointerEvent) => grab && place(e.clientX - grab.dx, e.clientY - grab.dy);
    const up = () => {
      if (!grab) return;
      grab = null;
      el.classList.remove('dragging');
      const r = el.getBoundingClientRect();
      try {
        localStorage.setItem('orrery-transport', JSON.stringify([r.left, r.top]));
      } catch {
        // private mode: just don't remember
      }
    };
    // A smaller window shouldn't leave it off screen.
    const resize = () => el.style.left && place(parseFloat(el.style.left), parseFloat(el.style.top));
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    addEventListener('resize', resize);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      removeEventListener('resize', resize);
    };
  }, []);
  return panel;
}

function Transport() {
  const panel = useDraggable();
  const date = useRef<HTMLSpanElement>(null);
  const scrub = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const [state, setState] = useState({ paused: clock.paused, speed: clock.speed, orbits: orbitsShown.value });
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (date.current) date.current.textContent = dateFromJd(clock.jd).toISOString().slice(0, 10);
      if (scrub.current && !dragging.current) scrub.current.value = String(clock.jd);
      setState((s) =>
        s.paused === clock.paused && s.speed === clock.speed && s.orbits === orbitsShown.value ? s : { paused: clock.paused, speed: clock.speed, orbits: orbitsShown.value },
      );
      raf = requestAnimationFrame(loop);
    };
    loop();
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space') (e.preventDefault(), (clock.paused = !clock.paused));
      if (e.key === 'o' || e.key === 'O') orbitsShown.value = !orbitsShown.value;
    };
    addEventListener('keydown', key);
    return () => (cancelAnimationFrame(raf), removeEventListener('keydown', key));
  }, []);
  // The nearest step to the clock's speed, and stepping from it.
  const at = SPEEDS.reduce((best, [, d], i) => (Math.abs(d - state.speed) < Math.abs(SPEEDS[best][1] - state.speed) ? i : best), 0);
  const step = (by: number) => (clock.speed = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, at + by))][1]);
  const blur = (e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.blur();
  return (
    <div ref={panel} className="transport">
      <div className="top">
        {/* The orbits on or off (O too): a little orbit with its planet. */}
        <button className={`orbits${state.orbits ? ' on' : ''}`} onClick={(e) => ((orbitsShown.value = !orbitsShown.value), blur(e))} aria-label="Orbits">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <ellipse cx="12" cy="12" rx="9.5" ry="6" fill="none" stroke="currentColor" strokeWidth="1.6" transform="rotate(-20 12 12)" />
            <circle cx="12" cy="12" r="2.6" fill="currentColor" />
            <circle cx="19.6" cy="8.4" r="1.9" fill="currentColor" />
          </svg>
        </button>
        <div className="buttons">
          <button onClick={(e) => (step(-1), blur(e))} aria-label="Slower" disabled={at === 0}>
            <Icon d="M11.2 7.2v9.6L4.2 12zM20.2 7.2v9.6L13.2 12z" />
          </button>
          <button className="play" onClick={(e) => ((clock.paused = !clock.paused), blur(e))} aria-label={state.paused ? 'Play' : 'Pause'}>
            <Icon d={state.paused ? 'M7.5 5.2v13.6L18.6 12z' : 'M7 5.5h2.6v13H7zM14.4 5.5H17v13h-2.6z'} />
          </button>
          <button onClick={(e) => (step(1), blur(e))} aria-label="Faster" disabled={at === SPEEDS.length - 1}>
            <Icon d="M3.8 7.2v9.6l7-4.8zM12.8 7.2v9.6l7-4.8z" />
          </button>
        </div>
        <div className="speed">
          {SPEEDS.map(([label, days], i) => (
            <button key={label} className={i === at ? 'on' : ''} onClick={(e) => ((clock.speed = days), blur(e))}>
              {label}
            </button>
          ))}
        </div>
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
        <span className="end">2100-01-01</span>
      </div>
    </div>
  );
}

// Always the dark room: the page's text and panels follow it via body[data-theme].
const BACKGROUND = '#0b0c0f';

export function App() {
  useEffect(() => void (document.body.dataset.theme = 'dark'), []);
  return (
    <>
      <Canvas camera={{ position: [0, 80, 0.001], fov: 40, near: 0.1, far: 250 }} dpr={[1, 2]} shadows={{ type: PCFShadowMap }} gl={{ toneMapping: NeutralToneMapping }} onPointerMissed={() => pick(null)}>
        <color attach="background" args={[BACKGROUND]} />
        <Tick />
        <DevHooks />
        <Studio />
        <Sun />
        <Stars />
        <Space />
        <Orbits />
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
      <PlanetCard />
    </>
  );
}
