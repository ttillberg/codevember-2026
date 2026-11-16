import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { Desk } from './Desk';
import { Effects } from './Effects';
import { createGame, type Game } from './game';
import { makeRig } from './rig';
import { useHud } from './hud';
import { keep, kept } from './keep';

export function App() {
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
        <Card />
        <Effects />
      </Canvas>
      <Hud />
    </>
  );
}

// The card. On a hot update this runs again with the new code: the old game says what it is,
// a new one is made and told, the old one is let go once the new one is in.
function Card() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const gl = useThree((s) => s.gl);
  const last = useRef<Game | null>(null);
  const game = useMemo(() => {
    const saved = last.current?.save() ?? kept();
    const g = createGame(camera, gl.domElement, gl, makeRig(camera, gl.domElement));
    if (saved) g.load(saved);
    last.current = g;
    keep(g.save);
    return g;
  }, [camera, gl]);
  useEffect(() => () => game.dispose(), [game]);
  useFrame((_, dt) => game.animate(performance.now(), Math.min(0.05, dt)));
  return <primitive object={game.world} />;
}

// The page around the scene: the plate with what to do now, start over and turn over top right,
// undo and redo bottom centre.
function Hud() {
  const { hint, canUndo, canRedo, actions } = useHud();
  return (
    <>
      <div className="plate">
        <div className="head">
          <b>01 Fold</b>
          <i><a className="home" href="../">Codevember 2026 <span lang="ja">折る</span></a></i>
          <i className="hint">{hint}</i>
        </div>
      </div>
      <button className="flip" type="button" aria-label="Turn the card over" onClick={actions.flip}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 15.5 12 19l8-3.5" /><path d="M4 8.5 12 5l8 3.5" /><path d="M18.5 12a6.5 3.2 0 1 1-2-2.3" /><path d="M16.2 7.6l.4 2.2-2.2.4" /></svg>
      </button>
      <button className="again" type="button" aria-label="Start over" onClick={actions.reset}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 1 0 1.7-4M2.5 1.8v2.6h2.6" /></svg>
      </button>
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
