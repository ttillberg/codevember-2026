import { useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
type Controls = { enabled: boolean };
import { Tesseract } from './Scene';
import { CELLS, DOOR_STEP, PART, STEPS, STEP_PARTS } from './fold';
import { state, goTo, labels } from './state';

/** Ortho zoom from the window, so the net fits whatever the shape of the screen. */
function Fit() {
  const { camera, size } = useThree();
  useEffect(() => {
    camera.zoom = Math.min(size.width * 0.8, size.height) / 9;
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

const PAGES = STEPS + 1;

/** A part drawn in isometric line work, sized from its half sizes. */
function IsoBox({ size: [x, y, z] }: { size: number[] }) {
  const k = 13 / Math.max(x, y, z);
  const P = (a: number, b: number, c: number) => {
    const u = (a - c) * 0.866 * k, v = (-b + (a + c) * 0.5) * k;
    return `${u.toFixed(1)} ${v.toFixed(1)}`;
  };
  const [X, Y, Z] = [x, y, z];
  const d = `M${P(-X, Y, Z)}L${P(X, Y, Z)}L${P(X, Y, -Z)}L${P(-X, Y, -Z)}Z M${P(-X, Y, Z)}L${P(-X, -Y, Z)}L${P(X, -Y, Z)}L${P(X, -Y, -Z)}L${P(X, Y, -Z)} M${P(X, Y, Z)}L${P(X, -Y, Z)}`;
  return <svg className="ico" width="44" height="52" viewBox="-22 -26 44 52"><path d={d} /></svg>;
}

const Screw = () => (
  <svg className="ico" width="16" height="52" viewBox="-8 -26 16 52">
    <path d="M-6-20h12v5h-12Z M-3-15v26l3 5 3-5v-26 M-3-10l6 2 M-3-4l6 2 M-3 2l6 2 M-3 8l6 2" />
  </svg>
);
const HingeIco = () => (
  <svg className="ico" width="34" height="52" viewBox="-17 -26 34 52">
    <path d="M-14-14h12v28h-12Z M2-14h12v28H2Z M-2-14h4v28h-4Z" /><circle cx="-8" cy="-6" r="1.6" /><circle cx="-8" cy="6" r="1.6" /><circle cx="8" cy="-6" r="1.6" /><circle cx="8" cy="6" r="1.6" />
  </svg>
);
const HandleIco = () => (
  <svg className="ico" width="22" height="52" viewBox="-11 -26 22 52"><path d="M-6-18h6v36h-6 M0-14h5v28h-5" /></svg>
);

/** What a page needs, part letters counted, plus screws, or the door's fittings on its page. */
function Parts({ page }: { page: number }) {
  if (page > STEPS) return null;
  const sp = STEP_PARTS[page - 1];
  const counts = new Map<string, { n: number; ci: number }>();
  for (const ci of sp.cells) {
    const e = counts.get(PART[ci]) ?? { n: 0, ci };
    e.n++;
    counts.set(PART[ci], e);
  }
  const items: React.ReactNode[] = [...counts.entries()].map(([letter, { n, ci }]) => (
    <div className="item" key={letter}>
      <IsoBox size={CELLS[ci].size} />
      <span className="n">{n}×</span>
      <span className="tag">{letter}</span>
    </div>
  ));
  if (sp.screws) items.push(<div className="item" key="s"><Screw /><span className="n">{sp.screws}×</span></div>);
  if (page === DOOR_STEP + 1) {
    items.push(<div className="item" key="h"><HingeIco /><span className="n">2×</span></div>);
    items.push(<div className="item" key="g"><HandleIco /><span className="n">1×</span></div>);
  }
  return <div className="parts">{items}</div>;
}

/** Customer service, for when the fourth dimension won't go together. Also where the keys are. */
function Service({ close }: { close: () => void }) {
  return (
    <div className="service" onClick={close}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <svg className="phone" width="120" height="96" viewBox="0 0 120 96">
          <path d="M14 30c0-12 20-18 46-18s46 6 46 18v8H82v-8c0-4-10-6-22-6s-22 2-22 6v8H14Z" />
          <path d="M26 42h68l10 44H16Z" />
          <circle cx="60" cy="62" r="13" /><circle cx="60" cy="62" r="4" />
        </svg>
        <div className="q">?</div>
        <h2>TESSERAKTA</h2>
        <p>Trouble assembling? Call customer service.</p>
        <p className="num">0000 – 1111</p>
        <p className="hours">Open every day, in every dimension.</p>
        <dl>
          <dt>space</dt><dd>play, pause</dd>
          <dt>1 – {PAGES}, ← →</dt><dd>go to a page</dd>
          <dt>D</dt><dd>turn it in 4D, on page 5</dd>
          <dt>drag</dt><dd>walk round it</dd>
          <dt>shift drag</dt><dd>turn it in 4D yourself</dd>
        </dl>
        <button onClick={close}>OK</button>
      </div>
    </div>
  );
}

/** The page: step number, parts, letters, buttons. Polls the state, it changes every frame anyway. */
function Page() {
  const [, tick] = useState(0);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    let raf = 0;
    const loop = () => { tick((n) => (n + 1) % 1e6); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHelp(false);
      if (e.key === '?' || e.key === 'h') setHelp((h) => !h);
    };
    addEventListener('keydown', key);
    return () => { cancelAnimationFrame(raf); removeEventListener('keydown', key); };
  }, []);
  const { t, target, auto, spin } = state;
  const s = Math.min(STEPS - 1, Math.floor(t * STEPS + 1e-6));
  const page = t >= 1 ? PAGES : s + 1;
  const going = Math.round(target * STEPS) + 1;
  return (
    <>
      <div className="step">{page}</div>
      <Parts page={page} />
      {labels.map((l, ci) => l.on && (
        <span key={ci} className="label" style={{ transform: `translate(${l.x}px, ${l.y}px)` }}>{PART[ci]}</span>
      ))}
      <button className="help" onClick={() => setHelp(true)} title="Customer service (?)">?</button>
      <div className="foot"><b>TESSERAKTA</b> {page}/{PAGES}</div>
      <div className="bar">
        <button className={auto ? 'on' : ''} onClick={() => (state.auto = !state.auto)} title="Play (space)">
          {auto ? (
            <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="1" width="3.5" height="12" /><rect x="8.5" y="1" width="3.5" height="12" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 1 13 7 3 13Z" /></svg>
          )}
        </button>
        <span className="sep" />
        {Array.from({ length: PAGES }, (_, i) => (
          <button key={i} className={going === i + 1 ? 'on' : ''} onClick={() => goTo(i)} title={`Page ${i + 1} (${i + 1})`}>
            {i + 1}
          </button>
        ))}
        <span className="sep" />
        <button className={spin ? 'on' : ''} onClick={() => (state.spin = !state.spin)} title="Turn in 4D (D)">4D</button>
      </div>
      {help && <Service close={() => setHelp(false)} />}
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
