// A drone parked over a stroad junction, on a clear day, running fast.
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import { Bloom, ChromaticAberration, EffectComposer, TiltShift2, ToneMapping, Vignette, wrapEffect } from '@react-three/postprocessing';
import { BlendFunction, Effect, ToneMappingMode } from 'postprocessing';
import { DirectionalLight, HemisphereLight, MOUSE, PerspectiveCamera, TOUCH, Uniform, Vector2 } from 'three';
import { HAZE } from './haze';
import { Cars, TIMELAPSE } from './Cars';
import { SEASONS, World, type Season } from './World';
import { plantTown, turnSome, type Block } from './Town';
import { People, Signs, Street } from './Life';
import { Painter, type Tool } from './Painter';
import { buildNet, type V } from './net';
import { baseIntent, derive, no, standing, type Intent } from './intent';
import { addStroke, smear, smearStart } from './paint';

/** The look of a drone clip shot through city haze: flat, pale, a little cool in the shadows. */
class FadeEffect extends Effect {
  constructor({ warm = 0.4 }: { warm?: number } = {}) {
    super('Fade', /* glsl */ `
      uniform float keep;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // autumn: what is warm keeps its colour, the rest fades
        float warm = smoothstep(0.02, 0.3, c.r - c.b);
        c = mix(vec3(l), c, 0.8 + keep * warm);
        c = mix(c, c * vec3(0.9, 1.0, 1.12), 1.0 - smoothstep(0.0, 0.35, l));
        c = c * 0.92 + 0.012;
        // the grade, bleak: some bite, cold shadows, lights that barely warm, colour drained, blacks lifted to grey
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.4);
        float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c += vec3(-0.03, 0.008, 0.035) * (1.0 - smoothstep(0.0, 0.5, g)) + vec3(0.02, 0.012, -0.015) * smoothstep(0.45, 1.0, g);
        c = mix(vec3(g), c, 0.78);
        c = clamp(c * 0.94 + vec3(0.03, 0.034, 0.04), 0.0, 1.0);
        outputColor = vec4(c, inputColor.a);
      }`, { blendFunction: BlendFunction.NORMAL, uniforms: new Map([['keep', new Uniform(warm)]]) });
  }
}
const Fade = wrapEffect(FadeEffect);

/** What the stock does to the picture: grain that sits in the shadows and thins out in the lights, and lights that go pale. */
class FilmEffect extends Effect {
  constructor() {
    super('Film', /* glsl */ `
      float fh(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // the lights lose their colour before they burn out
        c = mix(c, vec3(l), 0.45 * smoothstep(0.62, 1.0, l));
        // grain a pixel and a half across, new every frame, a little of it in colour
        vec2 px = floor(uv * resolution / 1.5);
        float t = floor(time * 24.0);
        vec3 n = vec3(fh(px + t * 1.7), fh(px + t * 2.3 + 41.0), fh(px + t * 3.1 + 97.0)) - 0.5;
        n = mix(vec3(n.x), n, 0.3);
        c += n * 0.035 * (1.0 - smoothstep(0.1, 0.95, l)) + n * 0.008;
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`, { blendFunction: BlendFunction.NORMAL });
  }
}
const Film = wrapEffect(FilmEffect);

const FRINGE = new Vector2(0.0012, 0.0008);
const TARGET: [number, number, number] = [10, 0, -10];
const DAY = 150; // seconds of ours for nine to five of theirs
const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
/** The place as it starts: the streets, and a few flyovers laid over them the way a hand would paint them. */
const BASE: Intent = [
  [[-232, -68], [-150, 0], [-60, 82]],
  [[215, -100], [245, 0], [230, 110]],
  [[-110, 168], [0, 140], [108, 180]],
].reduce((it, line) => addStroke(it, line.map(([x, y]) => ({ x, y })), true) ?? it, baseIntent());
/** One house in this many is left standing. */
const KEEP = 3;
/** Roughly how many vehicles are out: what a phone can carry, and what a desk can. */
const VEHICLES = touch ? 60 : 180;

/** Mobile first: a phone held upright looks down the arterial, a wide screen across it. */
function Drone() {
  const { camera, size } = useThree();
  const key = size.width < size.height ? 'p' : 'l';
  // The drone stays over the place: it cannot wander off into the haze.
  // One function for good: the controls take themselves apart and together again whenever this one changes,
  // and if that happens while a finger is lifting they never hear that it left.
  const fence = useCallback((e?: { target: unknown }) => {
    const c = e!.target as { target: { x: number; z: number }; object: { position: { x: number; z: number } }; getDistance(): number };
    const t = c.target, cam = c.object.position;
    const d = Math.hypot(t.x - TARGET[0], t.z - TARGET[2]);
    // the closer it flies, the further out it may go: up close there is no haze in the frame to hide
    const reach = Math.min(360, 130 + Math.max(0, 800 - c.getDistance()) * 0.45);
    if (d > reach) {
      // the camera is held back with what it looks at, or it would swing round and change height at the fence
      const bx = TARGET[0] + ((t.x - TARGET[0]) * reach) / d - t.x, bz = TARGET[2] + ((t.z - TARGET[2]) * reach) / d - t.z;
      t.x += bx; t.z += bz; cam.x += bx; cam.z += bz;
    }
  }, []);
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
      minDistance={70}
      maxDistance={1250}
      minPolarAngle={0.25}
      maxPolarAngle={1.05}
      enableDamping
      onChange={fence}
      dampingFactor={0.12}
      // the drone keeps its height: it pans and turns, it does not come down
      enableZoom={false}
      // one finger and the left button paint; two fingers and the right button move the drone
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

/**
 * The same value, a few frames late. When the roads change, the ground is laid first and what stands and moves
 * on it follows over the next frames, each in a frame of its own, so that no single frame has to carry it all.
 */
function useLater<T>(value: T, frames: number): T {
  const [late, setLate] = useState(value);
  useEffect(() => {
    let n = frames, id = 0;
    const tick = () => { if (--n <= 0) setLate(value); else id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [value, frames]);
  return late;
}

const NONE: Block[] = [];
// what to leave out of the place, from the address
const houses = !no('house'), trees = !no('tree');
// the time of year: autumn, or what ?season= says
const season: Season = (() => {
  const q = new URLSearchParams(location.search).get('season') as Season | null;
  return q && SEASONS.includes(q) ? q : 'autumn';
})();
const TOOLS: [Tool, string][] = [['road', 'Road'], ['bridge', 'Bridge'], ['smear', 'Smear'], ['trace', 'Trace']];

export function App() {
  // every state of the painting so far, so a stroke can be taken back
  const [history, setHistory] = useState<Intent[]>(() => [BASE]);
  const [tool, setTool] = useState<Tool>('road');
  // always a timelapse, sixty times life; P or space stops it
  const [paused, setPaused] = useState(false);
  const speed = paused ? 0 : TIMELAPSE;
  // reading the traffic: where it stands, and where one stretch's cars are going
  const [heat, setHeat] = useState(false);
  const [trace, setTrace] = useState<V | null>(null);
  const noteBox = useRef<HTMLDivElement>(null);
  const onNote = useCallback((t: string) => { if (noteBox.current) noteBox.current.textContent = t; }, []);
  // ?no=houses,trees: without the houses nothing is in the way of a road; the trees are only put out of sight
  // a smear in progress: the paint as it is being pushed, not yet in the history
  const [live, setLive] = useState<Intent | null>(null);
  const grab = useRef<{ base: Intent; from: V } | null>(null);
  const intent = live ?? history[history.length - 1];
  // the roads are never edited: they are what the rules make of the strokes
  // the housing is planted once, on the place as it first stood, and is in the way from then on
  const first = useMemo(() => buildNet(derive(BASE)), []);
  // only a few of them are kept, and a quarter of those turned: the roads are what is looked at
  const town = useMemo(() => turnSome(first, plantTown(first).filter((_, i) => i % KEEP === 0)), [first]);
  // a bridge takes down the houses in its line; the same list for as long as the same ones stand
  const left = houses ? standing(intent, town) : NONE;
  const kept = useRef(left);
  if (kept.current.length !== left.length || kept.current.some((b, i) => b !== left[i])) kept.current = left;
  const blocks = kept.current;
  // everything with walls is in the way: the housing, and the sheds that were there from the start
  const walls = useMemo(() => (houses ? [...town, ...first.buildings] : NONE), [houses, town, first]);
  const net = useMemo(() => {
    const n = buildNet(derive(intent, walls));
    return houses ? n : { ...n, buildings: [] };
  }, [intent, walls, houses]);

  // The stroke is not built the moment the hand lets go: the brush leaves a ghost of it, the frame is shown,
  // and then the rules are run and the town rebuilt, as something that may be interrupted.
  // the ground first, then the trees, then the traffic, then the people and the signs
  const place = useMemo(() => ({ net, blocks }), [net, blocks]);
  const wood = useLater(place, 1), roads = useLater(net, 2), life = useLater(place, 3);

  const onStroke = useCallback((pts: V[], bridge: boolean, air?: [boolean, boolean], done?: (ok: boolean) => void) => {
    requestAnimationFrame(() => setTimeout(() => {
      const next = addStroke(top.current, pts, bridge, walls, air);
      done?.(!!next);
      if (next) startTransition(() => setHistory((h) => [...h, next]));
    }, 0));
  }, [walls]);
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
      // P or space holds the frame, and lets go of it again
      if (e.key === ' ' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        setPaused((v) => !v);
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
        <Drone />
        <Sun speed={speed} />
        <World net={net} blocks={blocks} wood={wood} trees={trees} season={season} />
        <Cars net={roads} speed={speed} target={VEHICLES} heat={heat} trace={tool === 'trace' ? trace : null} onNote={onNote} />
        <People net={life.net} blocks={life.blocks} speed={speed} />
        <Signs net={life.net} blocks={life.blocks} />
        <Street net={life.net} blocks={life.blocks} speed={speed} />
        <Painter net={net} tool={tool} onStroke={onStroke} onSmear={onSmear} onTrace={setTrace} />
        <EffectComposer multisampling={touch ? 2 : 4}>
          <TiltShift2 blur={0.28} taper={0.56} start={[0, 0.52]} end={[1, 0.48]} samples={touch ? 10 : 18} />
          {/* the lights bleed into what is beside them, as they do through glass */}
          <Bloom mipmapBlur luminanceThreshold={0.72} luminanceSmoothing={0.2} intensity={0.55} radius={0.75} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Fade warm={season === 'autumn' ? 0.4 : season === 'spring' ? 0.2 : 0} />
          {/* the lens and the stock: colours part a little towards the corners, grain, dark corners */}
          <ChromaticAberration offset={FRINGE} radialModulation modulationOffset={0.35} />
          <Film />
          <Vignette offset={0.22} darkness={0.52} />
        </EffectComposer>
      </Canvas>
      <div className="tools side">
        <button className={heat ? 'on' : ''} onClick={() => setHeat((v) => !v)}>Heat</button>
      </div>
      {tool === 'trace' && <div className="note" ref={noteBox}>{trace ? '' : 'click a road'}</div>}
      <div className="tools">
        {TOOLS.map(([t, label]) => (
          <button key={t} className={t === tool ? 'on' : ''} onClick={() => setTool(t)}>{label}</button>
        ))}
        <button disabled={history.length < 2} onClick={undo}>Undo</button>
      </div>
    </>
  );
}
