// A drone parked over a stroad junction, on a clear day, running fast.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import { EffectComposer, Noise, TiltShift2, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { DirectionalLight, HemisphereLight, MOUSE, PerspectiveCamera, TOUCH } from 'three';
import { Cars } from './Cars';
import { World } from './World';
import { Painter, type Tool } from './Painter';
import { baseSpec, buildNet, type Spec, type V } from './net';
import { addStroke, findRoad, smear, smearStart } from './paint';

const TARGET: [number, number, number] = [10, 0, -10];
const DAY = 150; // seconds of ours for nine to five of theirs
const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/** Mobile first: a phone held upright looks down the arterial, a wide screen across it. */
function Drone() {
  const { camera, size } = useThree();
  const key = size.width < size.height ? 'p' : 'l';
  useMemo(() => {
    const portrait = key === 'p';
    const az = ((portrait ? 62 : 18) * Math.PI) / 180, el = ((portrait ? 44 : 40) * Math.PI) / 180;
    const d = portrait ? 1500 : 800;
    camera.position.set(TARGET[0] + d * Math.sin(az) * Math.cos(el), d * Math.sin(el), TARGET[2] + d * Math.cos(az) * Math.cos(el));
    (camera as PerspectiveCamera).fov = portrait ? 19 : 20;
    camera.lookAt(...TARGET);
    camera.updateProjectionMatrix();
  }, [camera, key]);
  return (
    <MapControls
      key={key}
      target={TARGET}
      minDistance={250}
      maxDistance={1700}
      minPolarAngle={0.25}
      maxPolarAngle={1.05}
      enableDamping
      dampingFactor={0.12}
      zoomSpeed={0.7}
      // one finger and the left button paint; two fingers, the right button and the wheel move the drone
      mouseButtons={{ LEFT: -1 as unknown as MOUSE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
      touches={{ ONE: -1 as unknown as TOUCH, TWO: TOUCH.DOLLY_PAN }}
    />
  );
}

/** The sun crosses from east to west; at five the tape cuts back to morning. */
function Sun() {
  const sun = useRef<DirectionalLight>(null);
  const sky = useRef<HemisphereLight>(null);
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime / DAY + 0.3) % 1;
    const phi = (t - 0.5) * 2.5; // radians either side of south
    const el = 0.38 + 0.6 * Math.cos(phi * 0.62);
    const s = sun.current!;
    s.position.set(TARGET[0] - Math.sin(phi) * Math.cos(el) * 900, Math.sin(el) * 900, TARGET[2] + Math.cos(phi) * Math.cos(el) * 900);
    const cut = Math.min(1, Math.min(t, 1 - t) * DAY * 1.2);
    const warm = 1 - Math.cos(phi * 0.62);
    s.intensity = 3.4 * cut * (1 - warm * 0.25);
    s.color.setRGB(1, 0.96 - warm * 0.22, 0.9 - warm * 0.5);
    sky.current!.intensity = 0.95 * cut;
  });
  const res = touch ? 2048 : 4096;
  return (
    <>
      <hemisphereLight ref={sky} args={[0xbcd4ff, 0x6b6a52, 0.95]} />
      <directionalLight ref={sun} castShadow shadow-mapSize={[res, res]} shadow-bias={-0.0004} shadow-normalBias={0.25}>
        <orthographicCamera attach="shadow-camera" args={[-430, 430, 330, -330, 100, 1900]} />
        <object3D attach="target" position={TARGET} />
      </directionalLight>
    </>
  );
}

const TOOLS: [Tool, string][] = [['road', 'Road'], ['bridge', 'Bridge'], ['smear', 'Smear'], ['yield', 'Yield']];

export function App() {
  // every state of the roads so far, so a stroke can be taken back
  const [history, setHistory] = useState<Spec[]>(() => [baseSpec()]);
  const [tool, setTool] = useState<Tool>('road');
  // a smear in progress: the roads as they are being pushed, not yet in the history
  const [live, setLive] = useState<Spec | null>(null);
  const grab = useRef<{ base: Spec; from: V } | null>(null);
  const spec = live ?? history[history.length - 1];
  const net = useMemo(() => buildNet(spec), [spec]);

  const onStroke = useCallback((pts: V[], bridge: boolean) => {
    setHistory((h) => {
      const next = addStroke(h[h.length - 1], pts, bridge);
      return next ? [...h, next] : h;
    });
  }, []);
  const onYield = useCallback((p: V) => {
    setHistory((h) => {
      const cur = h[h.length - 1];
      const i = findRoad(cur, p);
      if (i < 0) return h;
      // one step down each time; past the bottom it gets its priority back
      const d = ((cur[i].demote ?? 0) + 1) % 4;
      return [...h, cur.map((r, k) => (k === i ? { ...r, demote: d } : r))];
    });
  }, []);
  const top = useRef(history[history.length - 1]);
  top.current = history[history.length - 1];
  const liveRef = useRef(live);
  liveRef.current = live;
  const onSmear = useCallback((phase: 'start' | 'move' | 'end', p: V) => {
    if (phase === 'start') grab.current = { base: smearStart(top.current, p), from: p };
    else if (phase === 'move' && grab.current) setLive(smear(grab.current.base, grab.current.from, p));
    else if (phase === 'end') {
      const done = liveRef.current;
      grab.current = null;
      setLive(null);
      if (done) setHistory((h) => [...h, done]);
    }
  }, []);
  const undo = useCallback(() => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo(); }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [undo]);

  return (
    <>
      <Canvas
        shadows
        dpr={[1, touch ? 1.75 : 2]}
        camera={{ fov: 20, near: 60, far: 4000 }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={[0x5a6b34]} />
        <Drone />
        <Sun />
        <World net={net} />
        <Cars net={net} />
        <Painter tool={tool} onStroke={onStroke} onYield={onYield} onSmear={onSmear} />
        <EffectComposer multisampling={touch ? 2 : 4}>
          <TiltShift2 blur={0.1} taper={0.55} start={[0, 0.52]} end={[1, 0.48]} samples={touch ? 6 : 10} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Noise opacity={0.06} />
          <Vignette offset={0.25} darkness={0.55} />
        </EffectComposer>
      </Canvas>
      <div className="tools">
        {TOOLS.map(([t, label]) => (
          <button key={t} className={t === tool ? 'on' : ''} onClick={() => setTool(t)}>{label}</button>
        ))}
        <button disabled={history.length < 2} onClick={undo}>Undo</button>
      </div>
    </>
  );
}
