import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Desk } from './Desk';
import { Effects } from './Effects';
import { createGame, type Game, type Saved } from './game';
import { createBoard, placeNew } from './board';
import { makeRig } from './rig';
import { useHud } from './hud';
import { card, dropCard, putCard, watch } from './store';
import { MODELS, modelById, type Model } from './models';
import { sheetSvg } from './art';
import { sheetOf } from './net';

// where each card was left is kept (see store), to pick up again when it comes back to the
// mat; one that went on the board starts afresh
const placed = new Set<string>();

// the built one goes on the board, the sheet starts over
function put() {
  const id = useHud.getState().model;
  if (!id) return;
  placeNew(id);
  placed.add(id);
  useHud.setState({ model: null, board: true, ready: false });
}

export function App() {
  const model = modelById(useHud((s) => s.model));
  const board = useHud((s) => s.board);
  return (
    <>
      <Canvas
        orthographic
        camera={{ manual: true, near: 10, far: 4000 }}
        shadows="percentage"
        flat
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
      >
        <Desk />
        {model ? <Card key={model.id} model={model} /> : board ? <Board /> : <Idle />}
        <Effects />
      </Canvas>
      {model ? <Hud /> : board ? <BoardHud /> : <Picker />}
    </>
  );
}

// The card. On a hot update this runs again with the new code: the old game says what it is,
// a new one is made and told, the old one is let go once the new one is in.
function Card({ model }: { model: Model }) {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const gl = useThree((s) => s.gl);
  const last = useRef<Game | null>(null);
  const game = useMemo(() => {
    const saved: Saved | null = last.current?.save() ?? card(model.id);
    const g = createGame(model, camera, gl.domElement, gl, makeRig(camera, gl.domElement));
    if (saved) g.load(saved);
    last.current = g;
    watch(g.save);
    return g;
  }, [camera, gl, model]);
  useEffect(() => () => {
    watch(null);
    if (placed.delete(model.id)) dropCard(model.id);
    else putCard(game.save());
    game.dispose();
  }, [game, model]);
  useFrame((_, dt) => game.animate(performance.now(), Math.min(0.05, dt)));
  return <primitive object={game.world} />;
}

// the board, what was built standing on it
function Board() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const gl = useThree((s) => s.gl);
  const b = useMemo(() => createBoard(camera, gl.domElement, gl, makeRig(camera, gl.domElement)), [camera, gl]);
  useEffect(() => () => b.dispose(), [b]);
  useFrame((_, dt) => b.animate(performance.now(), Math.min(0.05, dt)));
  return <primitive object={b.world} />;
}

// no card yet: the bare mat, seen the usual way
function Idle() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const gl = useThree((s) => s.gl);
  const rig = useMemo(() => makeRig(camera, gl.domElement), [camera, gl]);
  useFrame(() => rig.fit(new THREE.Box3(new THREE.Vector3(-110, 0, -110), new THREE.Vector3(110, 10, 110))));
  return null;
}

// a card's face: its printed sheet, small
const faces = new Map<string, string>();
function face(m: Model) {
  if (!faces.has(m.id)) {
    const { svg } = sheetSvg(m.net, m.art, sheetOf(m.net), 3);
    faces.set(m.id, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  }
  return faces.get(m.id)!;
}

// Pick a card: the sheets laid out, Malmö, simplest first
function Picker() {
  return (
    <>
      <Plate hint="Pick a sheet to cut out" />
      <div className="picker">
        {MODELS.map((m, i) => (
          <button key={m.id} type="button" className="sheet" style={{ ['--tilt' as string]: `${(((i * 7) % 5) - 2) * 1.1}deg` }} onClick={() => useHud.setState({ model: m.id, hint: '' })}>
            <span className="print"><img src={face(m)} alt="" draggable={false} /></span>
            <b>{m.name}</b>
            <i>{m.where}</i>
          </button>
        ))}
        <BoardCard />
      </div>
    </>
  );
}

// the last card: the board, with what stands on it
function BoardCard() {
  const n = useHud((s) => s.town.length);
  return (
    <button type="button" className="sheet" style={{ ['--tilt' as string]: '1.6deg' }} onClick={() => useHud.setState({ board: true })}>
      <span className="print kraft"><span>{n || ''}</span></span>
      <b>The board</b>
      <i>{n ? `${n} standing` : 'Nothing on it yet'}</i>
    </button>
  );
}

// at the board: back to the sheets
function BoardHud() {
  const n = useHud((s) => s.town.length);
  return (
    <>
      <Plate hint={n ? 'Tap one to turn it, drag to move, off the edge to take away' : 'Build something and put it here'} />
      <button className="sheets" type="button" aria-label="Back to the sheets" onClick={() => useHud.setState({ board: false })}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="6.5" width="11" height="14" rx="1" /><path d="M8 3.5h11.5a1 1 0 0 1 1 1V17" /></svg>
      </button>
    </>
  );
}

// A turn button: a tap turns clockwise, a drag turns the way it goes. `step`: a long drag turns
// again every so many px (0: once per press)
function useTurn(tap: () => void, drag: (dx: number, dy: number) => void, step = 0) {
  const at = useRef<{ x: number; y: number; fired: boolean } | null>(null);
  return {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      e.currentTarget.setPointerCapture(e.pointerId);
      at.current = { x: e.clientX, y: e.clientY, fired: false };
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const a = at.current;
      if (!a || (a.fired && !step)) return;
      const dx = e.clientX - a.x, dy = e.clientY - a.y;
      if (Math.hypot(dx, dy) < (a.fired ? step : 14)) return;
      drag(dx, dy);
      Object.assign(a, { x: e.clientX, y: e.clientY, fired: true });
    },
    onPointerUp() {
      if (at.current && !at.current.fired) tap();
      at.current = null;
    },
    onPointerCancel() { at.current = null; },
    onKeyDown(e: React.KeyboardEvent) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } },
  };
}

// the view's turn: an arc along the bottom. Clockwise seen from above is the near side going
// left, so a tap turns the way a drag to the left does
function Dial() {
  const turnView = useHud((s) => s.turnView);
  const h = useTurn(() => turnView(-1), (dx, dy) => { if (Math.abs(dx) > Math.abs(dy)) turnView(Math.sign(dx)); }, 90);
  return (
    <button className="dial" type="button" aria-label="Turn the view" {...h}>
      <svg viewBox="0 0 240 60" aria-hidden="true">
        <path className="rim" d="M26 16 Q120 70 214 16" />
        <path className="track" d="M26 16 Q120 70 214 16" />
        <path className="line" d="M30 19 Q120 66 210 19" />
        <path className="line" d="M30 19l2 13M30 19l12.5 -4" />
        <path className="line" d="M210 19l-2 13M210 19l-12.5 -4" />
      </svg>
    </button>
  );
}

// the piece's turns: about up, and over
function Turns() {
  const { spin, tip } = useHud((s) => s.actions);
  const a = useTurn(() => spin(-1), (dx, dy) => { if (Math.abs(dx) > Math.abs(dy)) spin(Math.sign(dx)); });
  const b = useTurn(() => tip(1, 0), (dx, dy) => tip(dx, dy));
  const cube = <><path d="M12 8.2 15.6 10v4L12 15.8 8.4 14v-4z" /><path d="M8.4 10 12 11.8 15.6 10M12 11.8v4" /></>;
  return (
    <div className="turns">
      <button type="button" aria-label="Turn it round" {...a}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {cube}<path d="M5.2 9.6C2.4 10.6 2 12.6 3.6 14c2.7 2.5 13.7 2.5 16.6 0 1.6-1.4 1.2-3.4-1.6-4.4" /><path d="m18.6 7.4 1 2.2-2.3.8" />
        </svg>
      </button>
      <button type="button" aria-label="Tip it over" {...b}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {cube}<path d="M9.4 19.6C5.4 17.4 4.2 10.8 6.4 6.6 8.2 3.4 13 2.6 16 4.8" /><path d="m14.2 3.2 2 1.6-1.4 2.2" />
        </svg>
      </button>
    </div>
  );
}

function Plate({ hint }: { hint: string }) {
  return (
    <div className="plate">
      <div className="head">
        <b>01 Fold</b>
        <i><a className="home" href="https://ttillberg.github.io/codevember-2026/">Codevember 2026 <span lang="ja">折る</span></a> · <a className="home" href="https://x.com/theo_t">@theo_t</a></i>
        <i className="hint">{hint}</i>
      </div>
    </div>
  );
}

// The page around the scene: the plate with what to do now; top right back to the sheets, turn
// over, start over; undo and redo bottom left, the view's arc bottom centre, the piece's turns
// bottom right.
function Hud() {
  const { hint, canUndo, canRedo, ready, actions } = useHud();
  return (
    <>
      <Plate hint={hint} />
      <button className="sheets" type="button" aria-label="Pick another sheet" onClick={() => useHud.setState({ model: null })}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="6.5" width="11" height="14" rx="1" /><path d="M8 3.5h11.5a1 1 0 0 1 1 1V17" /></svg>
      </button>
      <button className="flip" type="button" aria-label="Turn the card over" onClick={actions.flip}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 15.5 12 19l8-3.5" /><path d="M4 8.5 12 5l8 3.5" /><path d="M18.5 12a6.5 3.2 0 1 1-2-2.3" /><path d="M16.2 7.6l.4 2.2-2.2.4" /></svg>
      </button>
      <button className="again" type="button" aria-label="Start over" onClick={actions.reset}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 1 0 1.7-4M2.5 1.8v2.6h2.6" /></svg>
      </button>
      {ready && <button className="put" type="button" onClick={put}>Put it on the board</button>}
      <Dial />
      <Turns />
      <div className="tools">
        <button className="undo" type="button" aria-label="Undo" disabled={!canUndo} onClick={actions.undo}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
        </button>
        <button className="redo" type="button" aria-label="Redo" disabled={!canRedo} onClick={actions.redo}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
        </button>
      </div>
    </>
  );
}
