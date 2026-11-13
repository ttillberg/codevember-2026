import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { BackSide, NeutralToneMapping, PCFShadowMap } from 'three';
import { AO } from './AO';
import { CameraRig, ORBIT_SPEED } from './CameraRig';
import { Orbits, orbitsShown } from './Orbits';
import { Sky } from './Sky';
import { PlanetList } from './PlanetList';
import { Beans } from './Beans';
import { PlanetCard } from './PlanetCard';
import { pick } from './selection';
import { Space } from './Space';
import { Sun } from './Sun';
import { clock } from './clock';
import { ORBIT_Y } from './scale';
import { dateFromJd, jdFromDate } from './kepler';
import { typing } from './selection';
import { watchCursor } from './cursor';
import { HOLD_LOADER, intro, INTRO_TIME, roomLight } from './intro';

// Mounted first, so it advances time before the band reads it.
function Tick() {
  useFrame(({ scene, gl }, dt) => {
    if (!clock.paused) clock.jd += clock.speed * Math.min(dt, 0.1);
    // The opening: dark until the candy's in, then lighting up over a few seconds.
    if (intro.ready && intro.value < 1) intro.value = Math.min(1, (performance.now() - intro.ready) / 1000 / INTRO_TIME);
    scene.environmentIntensity = 0.04 * roomLight();
    gl.toneMappingExposure = intro.ready ? 0.25 + 0.75 * roomLight() : 0; // black until then
  });
  return null;
}

// Mounted with the candy, inside the Suspense: once it's in, the lights can come up, the page's controls with them.
// Rendered black meanwhile, so shaders compile and textures upload unseen; it waits for a run of smooth frames
// (or gives up waiting after a while, on a slow device) before starting, so the opening doesn't stutter.
const SMOOTH_FRAMES = 10, SMOOTH_DT = 1 / 40, WAIT_AT_MOST = 6; // frames, seconds, seconds
function Ready() {
  const s = useRef({ smooth: 0, since: 0 });
  useFrame((_, dt) => {
    if (intro.ready || HOLD_LOADER) return;
    s.current.since += dt;
    s.current.smooth = dt < SMOOTH_DT ? s.current.smooth + 1 : 0;
    if (s.current.smooth < SMOOTH_FRAMES && s.current.since < WAIT_AT_MOST) return;
    intro.ready = performance.now();
    document.body.classList.add('lit');
  });
  return null;
}

// Dev only: window.__look(x, y, z, tx, ty, tz) moves the camera, window.__clock is the simulated time.
// The pointer over the scene, kept to what a press would do (see cursor.ts).
function Cursor() {
  const { gl } = useThree();
  useEffect(() => watchCursor(gl.domElement), [gl]);
  return null;
}

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
    // side facing the sun and a dark side away from it.
    <Environment resolution={256} environmentIntensity={0.04}>
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

// Time, along the bottom: play or pause, the date beside it, and the three speeds under the date (named for how they
// feel rather than the factor between them). Space plays and pauses too. Kept in step with the clock every frame, as
// other things change it (focusing on a planet slows it down).
const SPEEDS: [string, number][] = [['×0.5', 0.4], ['×1', 3], ['×5', 30]]; // label, days a second
function Transport() {
  const date = useRef<HTMLInputElement>(null);
  const editing = useRef(false);
  const [state, setState] = useState({ paused: clock.paused, speed: clock.speed });
  useEffect(() => {
    let raf = 0, shown = NaN;
    redraw.current = () => (shown = NaN);
    const loop = () => {
      const day = Math.floor(clock.jd - 0.5); // a new date only once a day, at midnight
      if (date.current && !editing.current && day !== shown) (shown = day), (date.current.value = dateFromJd(clock.jd).toISOString().slice(0, 10));
      setState((s) => (s.paused === clock.paused && s.speed === clock.speed ? s : { paused: clock.paused, speed: clock.speed }));
      raf = requestAnimationFrame(loop);
    };
    loop();
    const key = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.code === 'Space') (e.preventDefault(), (clock.paused = !clock.paused));
      if (e.key === 'o' || e.key === 'O') orbitsShown.value = !orbitsShown.value;
    };
    addEventListener('keydown', key);
    return () => (cancelAnimationFrame(raf), removeEventListener('keydown', key));
  }, []);
  const at = SPEEDS.reduce((best, [, d], i) => (Math.abs(d - state.speed) < Math.abs(SPEEDS[best][1] - state.speed) ? i : best), 0);
  const blur = (e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.blur();
  const redraw = useRef(() => {});
  return (
    <div className="transport">
      <div className="now">
        <button className="play" onClick={(e) => ((clock.paused = !clock.paused), blur(e))} aria-label={state.paused ? 'Play' : 'Pause'}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d={state.paused ? 'M7.5 5.2v13.6L18.6 12z' : 'M7 5.5h2.6v13H7zM14.4 5.5H17v13h-2.6z'}
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <input
          ref={date}
          className="when"
          inputMode="numeric"
          aria-label="Date"
          spellCheck={false}
          onFocus={(e) => ((editing.current = true), (e.currentTarget.placeholder = e.currentTarget.value), (e.currentTarget.value = ''))}
          onBlur={() => ((editing.current = false), redraw.current())}
          onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
          onChange={(e) => {
            // Digits only, the dashes put in as you go; a whole, real date and it goes there and pauses, no enter needed.
            const d = e.currentTarget.value.replace(/\D/g, '').slice(0, 8);
            e.currentTarget.value = d.slice(0, 4) + (d.length > 4 ? '-' + d.slice(4, 6) : '') + (d.length > 6 ? '-' + d.slice(6, 8) : '');
            if (d.length < 8) return;
            const y = +d.slice(0, 4), m = +d.slice(4, 6), day = +d.slice(6, 8), at = new Date(Date.UTC(y, m - 1, day, 12));
            if (at.getUTCMonth() !== m - 1 || at.getUTCDate() !== day) return; // not a real date: keep typing
            clock.jd = jdFromDate(at);
            clock.paused = true; // held there, to look at that day
            e.currentTarget.blur();
          }}
        />
      </div>
      <span className="speeds">
        {SPEEDS.map(([label, days], i) => (
          <button key={label} className={i === at ? 'on' : ''} onClick={(e) => ((clock.speed = days), blur(e))}>
            {label}
          </button>
        ))}
      </span>
    </div>
  );
}

// Always the dark room: the page's text and panels follow it via body[data-theme].
const BACKGROUND = '#0b0c0f';

export function App() {
  useEffect(() => void (document.body.dataset.theme = 'dark'), []);
  return (
    <>
      <Canvas camera={{ position: [0, 80, 0.001], fov: 40, near: 0.1, far: 250 }} dpr={[1, 1.5]} shadows={{ type: PCFShadowMap }} gl={{ toneMapping: NeutralToneMapping }} onPointerMissed={(e) => !(e.metaKey || e.ctrlKey) && pick(null)}>
        <color attach="background" args={[BACKGROUND]} />
        <Tick />
        <DevHooks />
        <Cursor />
        <Studio />
        <Sun />
        <Sky />
        <Space />
        <Orbits />
        <Suspense fallback={null}>
          <Physics gravity={[0, -30, 0]} timeStep={1 / 60}>
            <Beans />
            <Ready />
          </Physics>
        </Suspense>
        {/* Orbit round the sun; the rig sets where it starts. */}
        <OrbitControls enableDamping enableZoom={false} enablePan={false} makeDefault target={[0, ORBIT_Y, 0]} autoRotateSpeed={ORBIT_SPEED} />
        <CameraRig />
        <AO />
      </Canvas>
      <PlanetList />
      <Transport />
      <PlanetCard />
    </>
  );
}
