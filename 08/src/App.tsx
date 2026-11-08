import { useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
type Controls = { enabled: boolean };
import { Tesseract } from './Scene';
import { STEPS } from './fold';
import { state, goTo } from './state';

/** Ortho zoom from the window, so the net fits whatever the shape of the screen. */
function Fit() {
  const { camera, size } = useThree();
  useEffect(() => {
    camera.zoom = Math.min(size.width, size.height) / 8.6;
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

/** The page: step number, parts box, buttons. Polls the state, it changes every frame anyway. */
function Page() {
  const [, tick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => { tick((n) => (n + 1) % 1e6); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const { t, target, auto, spin } = state;
  const s = Math.min(STEPS - 1, Math.floor(t * STEPS + 1e-6));
  const page = t >= 1 ? STEPS + 1 : s + 1;
  const going = Math.round(target * STEPS) + 1;
  return (
    <>
      <div className="step">{page}</div>
      {page === 1 && (
        <div className="parts">
          <svg width="44" height="44" viewBox="-22 -22 44 44">
            <path d="M0-16 14-8V8L0 16-14 8V-8Z M-14-8 0 0 14-8 M0 0V16" />
          </svg>
          <span>8×</span>
        </div>
      )}
      <div className="bar">
        <button className={auto ? 'on' : ''} onClick={() => (state.auto = !state.auto)} title="Play (space)">
          {auto ? (
            <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="1" width="3.5" height="12" /><rect x="8.5" y="1" width="3.5" height="12" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 1 13 7 3 13Z" /></svg>
          )}
        </button>
        <span className="sep" />
        {Array.from({ length: STEPS + 1 }, (_, i) => (
          <button key={i} className={going === i + 1 ? 'on' : ''} onClick={() => goTo(i)} title={`Step ${i + 1} (${i + 1})`}>
            {i + 1}
          </button>
        ))}
        <span className="sep" />
        <button className={spin ? 'on' : ''} onClick={() => (state.spin = !state.spin)} title="Turn in 4D (D)">4D</button>
      </div>
    </>
  );
}

// ?step=N opens on page N, already folded that far; ?clean leaves the page bare, for screengrabs.
const params = new URLSearchParams(location.search);
const CLEAN = params.has('clean');
if (params.has('step')) {
  const n = Math.max(1, Math.min(STEPS + 1, Number(params.get('step')) || 1)) - 1;
  goTo(n);
  state.t = state.target;
}
if (CLEAN) document.documentElement.classList.add('clean');

export function App() {
  const controls = useRef<Controls>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && controls.current) controls.current.enabled = false;
      if (e.repeat) return;
      if (e.key === ' ') { state.auto = !state.auto; e.preventDefault(); }
      if (e.key === 'd' || e.key === 'D') state.spin = !state.spin;
      const n = Number(e.key);
      if (n >= 1 && n <= STEPS + 1) goTo(n - 1);
      const at = Math.round(state.target * STEPS);
      if (e.key === 'ArrowRight') goTo(Math.min(STEPS, at + 1));
      if (e.key === 'ArrowLeft') goTo(Math.max(0, at - 1));
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && controls.current) controls.current.enabled = true;
    };
    // shift and drag turns it in 4D: across in XW, up and down in YW
    let last: { x: number; y: number } | null = null;
    const pdown = (e: PointerEvent) => { if (e.shiftKey && (e.target as Element).tagName === 'CANVAS') last = { x: e.clientX, y: e.clientY }; };
    const pmove = (e: PointerEvent) => {
      if (!last) return;
      const k = 4 / Math.min(innerWidth, innerHeight);
      state.angles[0] += (e.clientX - last.x) * k;
      state.angles[1] += (e.clientY - last.y) * k;
      last = { x: e.clientX, y: e.clientY };
    };
    const pup = () => (last = null);
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('pointerdown', pdown);
    addEventListener('pointermove', pmove);
    addEventListener('pointerup', pup);
    return () => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      removeEventListener('pointerdown', pdown);
      removeEventListener('pointermove', pmove);
      removeEventListener('pointerup', pup);
    };
  }, []);

  return (
    <>
      <Canvas flat orthographic camera={{ position: [10, 7, 12], zoom: 80, near: -100, far: 100 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <Fit />
        <Tesseract />
        <OrbitControls ref={controls as never} enablePan={false} enableDamping autoRotate autoRotateSpeed={0.35} />
      </Canvas>
      {!CLEAN && <Page />}
    </>
  );
}
