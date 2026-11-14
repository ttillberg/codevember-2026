// A drone parked over a stroad junction, on a clear day, running fast.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import { EffectComposer, Noise, TiltShift2, ToneMapping, Vignette, wrapEffect } from '@react-three/postprocessing';
import { BlendFunction, Effect, ToneMappingMode } from 'postprocessing';
import { DirectionalLight, HemisphereLight, MOUSE, PerspectiveCamera, TOUCH } from 'three';
import { HAZE, HAZE_FROM, HAZE_TO } from './haze';
import { Cars, TIMELAPSE } from './Cars';
import { World } from './World';
import { plantTown } from './Town';
import { People, Signs, Street } from './Life';
import { Painter, type Tool } from './Painter';
import { buildNet, type V } from './net';
import { baseIntent, derive, type Intent } from './intent';
import { addStroke, findStroke, smear, smearStart } from './paint';

/** The look of a drone clip shot through city haze: flat, pale, a little cool in the shadows. */
class FadeEffect extends Effect {
  constructor() {
    super('Fade', /* glsl */ `
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, 0.8);
        c = mix(c, c * vec3(0.9, 1.0, 1.12), 1.0 - smoothstep(0.0, 0.35, l));
        c = c * 0.92 + 0.012;
        // the haze thickens with distance: up the frame
        c = mix(c, vec3(0.62, 0.68, 0.74), 0.03 + 0.1 * uv.y * uv.y);
        outputColor = vec4(c, inputColor.a);
      }`, { blendFunction: BlendFunction.NORMAL });
  }
}
const Fade = wrapEffect(FadeEffect);

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
    const d = portrait ? 1150 : 800;
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
      maxDistance={1250}
      minPolarAngle={0.25}
      maxPolarAngle={1.05}
      enableDamping
      // the drone stays over the place: it cannot wander off into the haze
      onChange={(e) => {
        const t = (e!.target as unknown as { target: { x: number; z: number } }).target;
        const d = Math.hypot(t.x - TARGET[0], t.z - TARGET[2]);
        if (d > 130) { t.x = TARGET[0] + ((t.x - TARGET[0]) * 130) / d; t.z = TARGET[2] + ((t.z - TARGET[2]) * 130) / d; }
      }}
      dampingFactor={0.12}
      zoomSpeed={0.7}
      // one finger and the left button paint; two fingers, the right button and the wheel move the drone
      mouseButtons={{ LEFT: -1 as unknown as MOUSE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
      touches={{ ONE: -1 as unknown as TOUCH, TWO: TOUCH.DOLLY_PAN }}
    />
  );
}

/** The sun crosses from east to west; at five the tape cuts back to morning. */
function Sun({ speed }: { speed: number }) {
  // the day runs with the traffic: slower at life size, stopped in a still
  const day = useRef(0);
  const sun = useRef<DirectionalLight>(null);
  const sky = useRef<HemisphereLight>(null);
  useFrame((_, delta) => {
    day.current += (Math.min(delta, 0.1) * speed) / TIMELAPSE;
    const t = (day.current / DAY + 0.3) % 1;
    const phi = (t - 0.5) * 2.5; // radians either side of south
    const el = 0.38 + 0.6 * Math.cos(phi * 0.62);
    const s = sun.current!;
    s.position.set(TARGET[0] - Math.sin(phi) * Math.cos(el) * 900, Math.sin(el) * 900, TARGET[2] + Math.cos(phi) * Math.cos(el) * 900);
    const cut = Math.min(1, Math.min(t, 1 - t) * DAY * 1.2);
    const warm = 1 - Math.cos(phi * 0.62);
    s.intensity = 2.6 * cut * (1 - warm * 0.25);
    s.color.setRGB(1, 0.96 - warm * 0.22, 0.9 - warm * 0.5);
    sky.current!.intensity = 1.25 * cut;
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

const SPEEDS: [number, string][] = [[TIMELAPSE, 'Timelapse'], [1, 'Normal'], [0, 'Pause']];
const TOOLS: [Tool, string][] = [['road', 'Road'], ['bridge', 'Bridge'], ['smear', 'Smear'], ['yield', 'Yield']];

export function App() {
  // every state of the painting so far, so a stroke can be taken back
  const [history, setHistory] = useState<Intent[]>(() => [baseIntent()]);
  const [tool, setTool] = useState<Tool>('road');
  const [speed, setSpeed] = useState(TIMELAPSE);
  const before = useRef(TIMELAPSE);
  // a smear in progress: the paint as it is being pushed, not yet in the history
  const [live, setLive] = useState<Intent | null>(null);
  const grab = useRef<{ base: Intent; from: V } | null>(null);
  const intent = live ?? history[history.length - 1];
  // the roads are never edited: they are what the rules make of the strokes
  // the housing is planted once, on the place as it first stood, and is in the way from then on
  const first = useMemo(() => buildNet(derive(baseIntent())), []);
  const blocks = useMemo(() => plantTown(first), [first]);
  // everything with walls is in the way: the housing, and the sheds that were there from the start
  const walls = useMemo(() => [...blocks, ...first.buildings], [blocks, first]);
  const net = useMemo(() => buildNet(derive(intent, walls)), [intent, walls]);

  const onStroke = useCallback((pts: V[], bridge: boolean) => {
    setHistory((h) => {
      const next = addStroke(h[h.length - 1], pts, bridge, walls);
      return next ? [...h, next] : h;
    });
  }, []);
  const onYield = useCallback((p: V) => {
    setHistory((h) => {
      const cur = h[h.length - 1];
      const i = findStroke(cur, p, walls);
      if (i < 0) return h;
      // one step down each time; past the bottom it gets its priority back
      const d = ((cur[i].demote ?? 0) + 1) % 4;
      return [...h, cur.map((s, k) => (k === i ? { ...s, demote: d } : s))];
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
  // for trying strokes from the console
  useEffect(() => { (window as any).paint = onStroke; }, [onStroke]);
  const undo = useCallback(() => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo(); }
      // space holds the frame, and lets go of it again
      if (e.key === ' ') {
        e.preventDefault();
        setSpeed((s) => { if (s) before.current = s; return s ? 0 : before.current; });
      }
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
        <color attach="background" args={[HAZE]} />
        <fog attach="fog" args={[HAZE, HAZE_FROM, HAZE_TO]} />
        <Drone />
        <Sun speed={speed} />
        <World net={net} blocks={blocks} />
        <Cars net={net} speed={speed} />
        <People net={net} blocks={blocks} speed={speed} />
        <Signs net={net} blocks={blocks} />
        <Street net={net} blocks={blocks} speed={speed} />
        <Painter tool={tool} onStroke={onStroke} onYield={onYield} onSmear={onSmear} />
        <EffectComposer multisampling={touch ? 2 : 4}>
          <TiltShift2 blur={0.1} taper={0.55} start={[0, 0.52]} end={[1, 0.48]} samples={touch ? 6 : 10} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Fade />
          <Noise opacity={0.06} />
          <Vignette offset={0.25} darkness={0.4} />
        </EffectComposer>
      </Canvas>
      <div className="tools speed">
        {SPEEDS.map(([s, label]) => (
          <button key={label} className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)}>{label}</button>
        ))}
      </div>
      <div className="tools">
        {TOOLS.map(([t, label]) => (
          <button key={t} className={t === tool ? 'on' : ''} onClick={() => setTool(t)}>{label}</button>
        ))}
        <button disabled={history.length < 2} onClick={undo}>Undo</button>
      </div>
    </>
  );
}
