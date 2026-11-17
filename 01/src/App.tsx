import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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

// picking: the board as a little island on the table beside the folder, a tap on it opens it
function Idle() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const gl = useThree((s) => s.gl);
  const b = useMemo(() => createBoard(camera, gl.domElement, gl, makeRig(camera, gl.domElement), { open: () => useHud.setState({ board: true }) }), [camera, gl]);
  useEffect(() => () => b.dispose(), [b]);
  useFrame((_, dt) => b.animate(performance.now(), Math.min(0.05, dt)));
  return <primitive object={b.world} />;
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

// Pick a card: the sheets in a folder, Malmö, simplest first (the board is the island on the
// table beside it, see Idle). A page
// turns over on its spine by finger or pointer: drag it across and it follows, let go and it
// settles on the nearer page (a flick goes on). A tap on the open page picks it, one on the
// left-hand side turns back; arrow keys and a wheel turn too.
let leaf = 0; // the open page, kept while you are away
function Picker() {
  const n = MODELS.length;
  const [at, setAt] = useState(leaf);
  const drag = useRef<{ x: number; at: number; w: number; moved: boolean; t: number; v: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const go = (i: number) => {
    const j = Math.max(0, Math.min(n - 1, i));
    leaf = j;
    setAt(j);
  };
  const open = (i: number) => {
    leaf = i;
    useHud.setState({ model: MODELS[i].id, hint: '' });
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(Math.round(leaf) + 1);
      if (e.key === 'ArrowLeft') go(Math.round(leaf) - 1);
      if (e.key === 'Enter') open(Math.round(leaf));
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const wheelAt = useRef(0);
  return (
    <>
      <Plate hint="Flip through, tap a sheet to cut it out, or the board to visit" />
      <div className={`folder${dragging ? ' dragging' : ''}`}>
      <div
        className="book"
        onPointerDown={(e) => {
          const book = e.currentTarget.querySelector('.leaves')!.getBoundingClientRect();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, at, w: book.width, moved: false, t: performance.now(), v: 0 };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) < 6) return;
          if (!d.moved) { d.moved = true; setDragging(true); }
          const now = performance.now();
          const next = Math.max(-0.15, Math.min(n - 0.85, d.at - dx / d.w));
          d.v = (next - at) / Math.max(1, now - d.t);
          d.t = now;
          setAt(next);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          if (!d) return;
          if (d.moved) {
            // a flick carries on to the next page, else the nearer one
            const fling = Math.abs(d.v) > 0.002 ? Math.sign(d.v) * 0.5 : 0;
            go(Math.round(at + fling));
            return;
          }
          const spine = e.currentTarget.querySelector('.leaves')!.getBoundingClientRect().left;
          if (e.clientX < spine) go(Math.round(at) - 1);
          else open(Math.round(at));
        }}
        onPointerCancel={() => { drag.current = null; setDragging(false); go(Math.round(at)); }}
        onWheel={(e) => {
          const now = performance.now();
          if (now - wheelAt.current < 350) return;
          const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          if (Math.abs(d) < 8) return;
          wheelAt.current = now;
          go(Math.round(at) + Math.sign(d));
        }}
      >
        <div className="cover left" />
        <div className="cover right" />
        <div className="leaves">
          {MODELS.map((m, i) => {
            const turn = Math.max(0, Math.min(1, at - i));
            const near = Math.abs(i - at) < 2.5;
            return (
              <div
                key={m.id}
                className="leaf"
                style={{
                  transform: `rotateY(${-180 * turn}deg)`,
                  zIndex: turn > 0.5 ? i : n - i,
                  visibility: near ? 'visible' : 'hidden',
                }}
              >
                <div className="front">
                  <Sheet m={m} />
                  <span className="holes" />
                </div>
                <div className="back"><span>{i + 1}</span></div>
              </div>
            );
          })}
          <span className="rings" />
        </div>
      </div>
        <div className="count">{Math.round(at) + 1} / {n}</div>
      </div>
    </>
  );
}

// the folder, small: two covers open on a spine, a sheet in it
function FolderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 6.5 3 5v13l9 1.5 9-1.5V5z" /><path d="M12 6.5v13" /><path d="M14.5 8.2 18.5 7.6v8l-4 .6z" />
    </svg>
  );
}

function Sheet({ m }: { m: Model }) {
  return (
    <>
      <span className="print"><img src={face(m)} alt="" draggable={false} /></span>
      <b>{m.name}</b>
      <i>{m.where}</i>
    </>
  );
}

// at the board: back to the sheets
function BoardHud() {
  const n = useHud((s) => s.town.length);
  return (
    <>
      <Plate hint={n ? 'Tap one to turn it, drag to move, off the edge to take away' : 'Build something and put it here'} />
      <button className="sheets" type="button" aria-label="Back to the sheets" onClick={() => useHud.setState({ board: false })}>
        <FolderIcon />
      </button>
      <Zoom />
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
        <path className="arc" d="M36 20 Q120 64 204 20" />
        <path className="head" d="M30 13l7 8-10.5 1.5" />
        <path className="head" d="M210 13l-7 8 10.5 1.5" />
      </svg>
    </button>
  );
}

// zoom in and out, the fit being as far out as it goes
function Zoom() {
  const zoom = useHud((s) => s.zoom);
  return (
    <div className="zoom">
      <button type="button" aria-label="Zoom in" onClick={() => zoom(1.4)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
      <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.4)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
    </div>
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
        <FolderIcon />
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
      <Zoom />
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
