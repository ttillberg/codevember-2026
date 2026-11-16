// A drone parked over a stroad junction, through a day and a night of autumn, running fast.
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import { Bloom, ChromaticAberration, EffectComposer, SMAA, TiltShift2, ToneMapping, Vignette, wrapEffect } from '@react-three/postprocessing';
import { BlendFunction, Effect, ToneMappingMode } from 'postprocessing';
import { Color, DirectionalLight, HemisphereLight, MOUSE, OrthographicCamera, PerspectiveCamera, TOUCH, Uniform, Vector2 } from 'three';
import { HAZE, MOOD, NIGHT, RICH, hoursPerSecond, skyAt } from './haze';
import { Cars, TIMELAPSE } from './Cars';
import type { Sim } from './sim';
import { gpu } from './Glow';
import { SEASONS, World, type Season } from './World';
import { plantSmall, plantTown, turnSome, type Block } from './Town';
import { People, Signs, Street } from './Life';
import { Commons, plantCommons, standingCommons } from './Park';
import { Painter, type Tool } from './Painter';
import { buildNet, type V } from './net';
import { MAP } from './map';
import { baseIntent, derive, no, standing, type Intent } from './intent';
import { addStroke, smear, smearStart } from './paint';

/** The grade: exposure, warmth, bite, how much colour is left, how grey the blacks are, and what the stock and the glass add. */
type Grade = { gain: number; temp: number; bite: number; sat: number; lift: number; grain: number; bloom: number; dark: number; soft: number };
const GRADE: Grade = { gain: 1, temp: -0.55, bite: 0.35, sat: 0.81, lift: 0, grain: 0, bloom: 0.55, dark: 0, soft: no('soft') ? 0 : 0.5 };

/** The look of a drone clip shot through city haze: flat, pale, a little cool in the shadows. */
class FadeEffect extends Effect {
  constructor({ warm = 0.4, gain = 1, temp = 0, bite = 0.4, sat = 0.78, lift = 1 }: Partial<Grade> & { warm?: number } = {}) {
    super('Fade', /* glsl */ `
      uniform float keep, gain, temp, bite, sat, lift, rich, night;
      uniform vec3 mood;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        // the hour has its own balance, under the one that was set by hand
        vec3 c = inputColor.rgb * gain * mood * vec3(1.0 + 0.1 * temp, 1.0, 1.0 - 0.1 * temp);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // autumn: what is warm keeps its colour, the rest fades
        float warm = smoothstep(0.02, 0.3, c.r - c.b);
        c = mix(vec3(l), c, 0.8 + keep * warm);
        c = mix(c, c * vec3(0.9, 1.0, 1.12), 1.0 - smoothstep(0.0, 0.35, l));
        c = c * 0.92 + 0.012;
        // the grade, bleak: some bite, cold shadows, lights that barely warm, colour drained, blacks lifted to grey
        c = mix(c, c * c * (3.0 - 2.0 * c), bite);
        float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c += vec3(-0.03, 0.008, 0.035) * (1.0 - smoothstep(0.0, 0.5, g)) + vec3(0.02, 0.012, -0.015) * smoothstep(0.45, 1.0, g);
        c = mix(vec3(g), c, sat + rich);
        // at night the blacks are let down again, or the dark is milk
        c = clamp(c * 0.94 + vec3(0.03, 0.034, 0.04) * lift * (1.0 - 0.6 * night), 0.0, 1.0);
        outputColor = vec4(c, inputColor.a);
      }`, { blendFunction: BlendFunction.NORMAL, uniforms: new Map<string, Uniform>([...Object.entries({ keep: warm, gain, temp, bite, sat, lift }).map(([k, v]): [string, Uniform] => [k, new Uniform(v)]), ['mood', MOOD], ['rich', RICH], ['night', NIGHT]]) });
  }
}
const Fade = wrapEffect(FadeEffect);

/** What the stock does to the picture: grain that sits in the shadows and thins out in the lights, and lights that go pale. */
class FilmEffect extends Effect {
  constructor({ grain = 1 }: { grain?: number } = {}) {
    super('Film', /* glsl */ `
      uniform float grain;
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
        c += grain * (n * 0.035 * (1.0 - smoothstep(0.1, 0.95, l)) + n * 0.008);
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`, { blendFunction: BlendFunction.NORMAL, uniforms: new Map([['grain', new Uniform(grain)]]) });
  }
}
const Film = wrapEffect(FilmEffect);

const FRINGE = new Vector2(0.0012, 0.0008);
const TARGET: [number, number, number] = [10, 0, -10];
const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
/** Where the drone hangs and what its lens does: degrees round and up, metres away, the point on the ground it looks at. */
type Shot = { az: number; el: number; dist: number; fov: number; x: number; z: number; blur: number; taper: number; lean: number; focus: number };
const SHOTS: Record<'p' | 'l', Shot> = {
  p: { az: 62, el: 44, dist: 1150, fov: 19, x: TARGET[0], z: TARGET[2], blur: 0.28, taper: 0.56, lean: -2.3, focus: 0.5 },
  l: { az: 22, el: 69.5, dist: 800, fov: 27.5, x: -1, z: -10, blur: 0.45, taper: 0.98, lean: -2.3, focus: 0.38 },
};
const upright = () => innerWidth < innerHeight;
/** ?debug: sliders for the shot, and a button that copies it. */
const debug = new URLSearchParams(location.search).has('debug');
const SLIDERS: [keyof Shot, string, number, number, number][] = [
  ['az', 'Turn', -180, 180, 0.5], ['el', 'Tilt', 30, 75, 0.5], ['dist', 'Away', 200, 2000, 5], ['fov', 'Lens', 8, 50, 0.5],
  ['x', 'X', -360, 360, 1], ['z', 'Z', -360, 360, 1], ['blur', 'Blur', 0, 0.6, 0.01], ['taper', 'Taper', 0.1, 1, 0.01],
  ['lean', 'Lean', -90, 90, 0.5], ['focus', 'Focus', 0, 1, 0.01],
];
const GRADES: [keyof Grade, string, number, number, number][] = [
  ['gain', 'Expose', 0.5, 1.6, 0.01], ['temp', 'Warm', -2, 2, 0.05], ['bite', 'Bite', 0, 1, 0.01], ['sat', 'Colour', 0, 1.5, 0.01],
  ['lift', 'Lift', 0, 3, 0.05], ['grain', 'Grain', 0, 4, 0.05], ['bloom', 'Bloom', 0, 2, 0.01], ['dark', 'Corners', 0, 1, 0.01],
  ['soft', 'Soft', 0, 3, 0.05],
];
/** What can be switched off to see what it costs; ?no=msaa,tilt,bloom,shadow,lazy,soft starts without them. */
/** How edges are smoothed: the card's own multisampling, four samples or two, a pass over the finished picture, or not at all. */
const AAS = ['msaa4', 'msaa2', 'smaa', 'none'] as const;
type Fx = { aa: (typeof AAS)[number]; tilt: boolean; bloom: boolean; shadow: boolean; lazy: boolean };
const FX: Fx = { aa: no('msaa') ? 'none' : 'msaa2', tilt: !no('tilt'), bloom: !no('bloom'), shadow: !no('shadow'), lazy: !no('lazy') };
const SWITCHES: [Exclude<keyof Fx, 'aa'>, string][] = [['tilt', 'Tilt shift'], ['bloom', 'Bloom'], ['shadow', 'Shadows'], ['lazy', 'Lazy shadows']];
/** What can be asked of the traffic without waiting for it: an emergency vehicle sent now, a works site opened now near the middle. */
const PERKS: [string, (sim: Sim) => void][] = [['Send ambulance', (s) => s.dispatch()], ['Dig', (s) => s.dig()]];
const DPR = touch ? 1.75 : 2;
/** How the drone moves by itself: metres it glides to either side, degrees it swings round, metres it bobs in the wind, metres it shakes, seconds for a round. */
type Move = { drift: number; orbit: number; hover: number; shake: number; period: number };
const MOVE: Move = { drift: 19, orbit: 3, hover: 1.3, shake: 0, period: 45 };
const MOVES: [keyof Move, string, number, number, number][] = [
  ['drift', 'Glide', 0, 80, 1], ['orbit', 'Swing', 0, 30, 0.5], ['hover', 'Bob', 0, 6, 0.1], ['shake', 'Shake', 0, 3, 0.05], ['period', 'Round', 10, 120, 1],
];
const FPS = 30;
const RAD = Math.PI / 180;
/**
 * The hour it is, whether it stands still there, how many seconds of ours a day and its night take, and how many seconds
 * of theirs the lights of the traffic stay on the picture after dark. It opens in the low sun of the afternoon.
 */
type Clock = { hour: number; hold: boolean; day: number; trail: number; lights: (typeof LIGHTS)[number] };
/** How those lights are drawn: strips behind each vehicle, a long exposure on a WebGPU canvas over the picture (Glow.tsx), or not. The second where there is a WebGPU, on a desk; ?gpu asks for it on a phone too, ?no=gpu for the strips. */
const LIGHTS = ['geometry', 'webgpu', 'off'] as const;
// ?hour=19 starts at seven in the evening instead
const hourAsked = parseFloat(new URLSearchParams(location.search).get('hour') ?? '');
const CLOCK: Clock = { hour: hourAsked >= 0 && hourAsked < 24 ? hourAsked : 15.3, hold: false, day: 240, trail: 8, lights: new URLSearchParams(location.search).has('gpu') || (!touch && !no('gpu')) ? 'webgpu' : 'geometry' };
const CLOCKS: [Exclude<keyof Clock, 'hold' | 'lights'>, string, number, number, number][] = [['hour', 'Time', 0, 24, 0.05], ['day', 'Day', 30, 600, 10], ['trail', 'Trails', 0, 16, 0.5]];
const hhmm = (h: number) => `${Math.floor(h)}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
/** The place as it starts: the streets, and a few flyovers laid over them the way a hand would paint them. ?debug starts on `MAP`. */
const BASE: Intent = [
  [[-232, -68], [-150, 0], [-60, 82]],
  [[215, -100], [245, 0], [230, 110]],
  [[-110, 168], [0, 140], [108, 180]],
].reduce((it, line) => addStroke(it, line.map(([x, y]) => ({ x, y })), true) ?? it, baseIntent());
/** One house in this many is left standing. */
const KEEP = 2;
/** Roughly how many vehicles are out: what a phone can carry, and what a desk can. */
const VEHICLES = touch ? 60 : 180;

/** So many frames a second and no more: a timelapse does not need them, and the graphics card rests in between. */
function Pace({ fps }: { fps: number }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    let id = 0, last = 0;
    const tick = (t: number) => {
      id = requestAnimationFrame(tick);
      // four milliseconds short of a frame: a screen is never on time to the millisecond, and would drop frames
      if (t - last < 1000 / fps - 4) return;
      // the first frame starts the clock: it has no time behind it
      if (!last) get().clock.elapsedTime = t / 1000;
      last = t;
      get().advance(t / 1000);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [get, fps]);
  return null;
}

/** Mobile first: a phone held upright looks down the arterial, a wide screen across it. */
function Drone({ shot, move, set, onShot }: {
  shot: Shot | null; move: Move;
  /** goes up when a slider has moved the shot: only then is the drone put where the shot says */
  set: number;
  onShot?: (s: Partial<Shot>) => void;
}) {
  const { camera, size, gl, scene, advance } = useThree();
  // ?debug: the renderer, the scene and the frame itself on the window, to be measured from outside
  if (debug) (window as any).three = { gl, scene, advance, camera };
  const key = size.width < size.height ? 'p' : 'l';
  const s = shot ?? SHOTS[key];
  // where the controls start looking; after that the point is moved by hand, by a slider or by the drone, never by this
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const target = useMemo<[number, number, number]>(() => [s.x, 0, s.z], [key]);
  // what the drone's own motion has added to the shot so far, to be taken off again before the next step
  const own = useRef({ x: 0, z: 0, hx: 0, hy: 0, hz: 0, turn: 0 });
  // a hand on the drone: only then, and while it coasts to a stop, do the sliders follow it
  const held = useRef(0);
  const controls = useRef<{ target: { x: number; z: number } }>(null);
  /** The shot as it stands, less what the drone did by itself. */
  const read = useCallback((): Pick<Shot, 'az' | 'el' | 'dist' | 'x' | 'z'> | null => {
    const c = controls.current, m = own.current, p = camera.position;
    if (!c) return null;
    const dx = p.x - m.hx - c.target.x, dy = p.y - m.hy, dz = p.z - m.hz - c.target.z, dist = Math.hypot(dx, dy, dz);
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return { az: r1((Math.atan2(dx, dz) - m.turn) / RAD), el: r1(Math.asin(dy / dist) / RAD), dist: Math.round(dist), x: r1(c.target.x - m.x), z: r1(c.target.z - m.z) };
  }, [camera]);
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
    if (!onShot || performance.now() > held.current) return;
    // a hand on the drone moves the sliders with it
    const now = read();
    if (now) onShot(now);
  }, [onShot, read]);
  // the drone holds its place the way a drone does: gliding a little, swinging a little, bobbing in the wind
  const at = useRef(0);
  const fly = useRef((_t: number) => {});
  fly.current = (t: number) => {
    const c = controls.current;
    if (!c) return;
    at.current = t;
    const w = (2 * Math.PI) / move.period, m = own.current, p = camera.position;
    const x = move.drift * Math.sin(w * t), z = move.drift * 0.6 * Math.sin(w * t * 0.73 + 1.3);
    const turn = move.orbit * RAD * Math.sin(w * t * 0.5 + 0.7);
    // the shake is the same thing faster: gusts and motors, three sines that never line up
    const k = move.shake;
    const hx = move.hover * (Math.sin(t * 0.83) + 0.4 * Math.sin(t * 2.1 + 1)) + k * (Math.sin(t * 9.1) + 0.6 * Math.sin(t * 14.3 + 2) + 0.3 * Math.sin(t * 23.7 + 4));
    const hz = move.hover * (Math.sin(t * 0.67 + 2) + 0.4 * Math.sin(t * 1.7)) + k * (Math.sin(t * 10.7 + 1) + 0.6 * Math.sin(t * 16.9) + 0.3 * Math.sin(t * 21.1 + 3));
    const hy = move.hover * 0.6 * Math.sin(t * 1.13 + 0.5) + k * 0.5 * Math.sin(t * 12.3 + 5);
    // off with the last bob, round the point it looks at, along with the glide, on with the new bob
    const dx = p.x - m.hx - c.target.x, dz = p.z - m.hz - c.target.z, a = turn - m.turn, cos = Math.cos(a), sin = Math.sin(a);
    c.target.x += x - m.x; c.target.z += z - m.z;
    p.set(c.target.x + dx * cos + dz * sin + hx, p.y - m.hy + hy, c.target.z - dx * sin + dz * cos + hz);
    own.current = { x, z, hx, hy, hz, turn };
  };
  useMemo(() => {
    (camera as PerspectiveCamera).fov = s.fov;
    camera.updateProjectionMatrix();
    const az = s.az * RAD, el = s.el * RAD;
    camera.position.set(s.x + s.dist * Math.sin(az) * Math.cos(el), s.dist * Math.sin(el), s.z + s.dist * Math.cos(az) * Math.cos(el));
    camera.lookAt(s.x, 0, s.z);
    if (controls.current) { controls.current.target.x = s.x; controls.current.target.z = s.z; }
    // and straight back to where its own motion had it, so a slider does not make it jump
    own.current = { x: 0, z: 0, hx: 0, hy: 0, hz: 0, turn: 0 };
    fly.current(at.current);
    // not when the shot only followed a hand: that one is flown already
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, key, set]);
  useFrame(({ clock }) => fly.current(clock.elapsedTime));
  return (
    <MapControls
      ref={controls as never}
      key={key}
      onStart={() => { held.current = Infinity; }}
      onEnd={() => { held.current = performance.now() + 900; }}
      target={target}
      minDistance={70}
      maxDistance={debug ? 2000 : 1250}
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

/**
 * Lazy shadows are drawn again only every so many frames: the sun is slow, and what moves fast casts none then.
 * A low sun is not slow on the ground, where the end of a long shadow runs: under LOW_SUN radians they are drawn twice as often.
 */
const SHADOW_EVERY = 6, LOW_SUN = 0.35;
/** Metres from the middle that the shadows reach, and how far up anything stands that casts one. */
const SHADE = { wide: 430, far: 400, tall: 70 };

/** The sun, the sky and the moon: one light that casts shadows and one that fills them, moved and coloured by the hour. */
function Sun({ speed, shadow, lazy, clock, scrub, onHour }: {
  speed: number; shadow: boolean; lazy: boolean; clock: Clock;
  /** goes up when the hour was set by hand: only then does the clock jump to it */
  scrub: number;
  /** ?debug: told the hour now and then, so the slider runs with it */
  onHour?: (h: number) => void;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const frame = useRef(0);
  useEffect(() => {
    gl.shadowMap.autoUpdate = !lazy;
    return () => { gl.shadowMap.autoUpdate = true; };
  }, [gl, lazy]);
  // the day runs with the traffic: stopped in a still
  const hour = useRef(clock.hour);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { hour.current = clock.hour; }, [scrub]);
  const sun = useRef<DirectionalLight>(null);
  const sky = useRef<HemisphereLight>(null);
  useFrame((_, delta) => {
    const n = frame.current++;
    if (!clock.hold && speed > 0) {
      hour.current = (hour.current + Math.min(delta, 0.1) * (speed / TIMELAPSE) * hoursPerSecond(hour.current, clock.day)) % 24;
      if (onHour && n % 8 === 0) onHour(hour.current);
    }
    const k = skyAt(hour.current);
    if (lazy && n % (k.el < LOW_SUN ? SHADOW_EVERY / 2 : SHADOW_EVERY) === 0) gl.shadowMap.needsUpdate = true;
    const s = sun.current!, cos = Math.cos(k.el), sin = Math.sin(k.el);
    s.position.set(TARGET[0] - Math.sin(k.phi) * cos * 900, sin * 900, TARGET[2] + Math.cos(k.phi) * cos * 900);
    s.intensity = k.power;
    s.color.copy(k.sun);
    // a low sun sees the ground edge on: the shadow map is drawn only as tall as that, and its pixels go further
    const cam = s.shadow.camera as OrthographicCamera;
    cam.top = Math.min(330, SHADE.far * sin + SHADE.tall * cos);
    cam.bottom = -Math.min(330, SHADE.far * sin + 8);
    cam.updateProjectionMatrix();
    sky.current!.intensity = k.fill;
    sky.current!.color.copy(k.air);
    sky.current!.groundColor.copy(k.earth);
    (scene.background as Color).copy(k.back);
  });
  const res = touch ? 2048 : 4096;
  return (
    <>
      <hemisphereLight ref={sky} args={[0xbcd4ff, 0x6b6a52, 0.95]} />
      <directionalLight ref={sun} castShadow={shadow} shadow-mapSize={[res, res]} shadow-bias={-0.0004} shadow-normalBias={0.25}>
        <orthographicCamera attach="shadow-camera" args={[-SHADE.wide, SHADE.wide, 330, -330, 100, 1900]} />
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
  const [history, setHistory] = useState<Intent[]>(() => [debug ? MAP : BASE]);
  const [tool, setTool] = useState<Tool>('road');
  // always a timelapse, sixty times life; P or space stops it
  const [paused, setPaused] = useState(false);
  const speed = paused ? 0 : TIMELAPSE;
  // reading the traffic: where it stands, and where one stretch's cars are going
  const [heat, setHeat] = useState(false);
  const [trace, setTrace] = useState<V | null>(null);
  // ?debug: the shot under the sliders; without it the drone keeps its own
  const [shot, setShot] = useState<Shot | null>(() => (debug ? SHOTS[upright() ? 'p' : 'l'] : null));
  const [grade, setGrade] = useState(GRADE);
  const [fx, setFx] = useState(FX);
  // canvas pixels to a screen point, at most
  const [dpr, setDpr] = useState(DPR);
  const [fps, setFps] = useState(FPS);
  const [move, setMove] = useState(MOVE);
  const [clock, setClock] = useState(CLOCK);
  const [scrub, setScrub] = useState(0);
  // is there a WebGPU to draw the lights with: not known until it is asked, and only asked where it matters
  const [gpuOk, setGpuOk] = useState<boolean | null>(null);
  useEffect(() => { if (gpuOk === null && (debug || clock.lights === 'webgpu')) gpu().then((d) => setGpuOk(!!d)); }, [gpuOk, clock.lights]);
  const noGpu = useCallback(() => setGpuOk(false), []);
  // without it the strips are drawn, and nothing is said
  const lights = clock.lights === 'webgpu' && gpuOk === false ? 'geometry' : clock.lights;
  const onHour = useCallback((h: number) => setClock((c) => ({ ...c, hour: Math.round(h * 100) / 100 })), []);
  // the last softness is the browser's: a blur on the canvas itself, so many pixels wide
  useEffect(() => { document.documentElement.style.setProperty('--soft', grade.soft + 'px'); }, [grade.soft]);
  const [set, setSet] = useState(0);
  const [copied, setCopied] = useState('');
  const copy = (what: string, v: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(v));
    setCopied(what);
    setTimeout(() => setCopied(''), 1200);
  };
  // the painting off the clipboard: it goes on the history like a stroke, so Undo takes it back
  const pasteMap = async () => {
    try {
      const map = JSON.parse(await navigator.clipboard.readText().catch(() => prompt('Map JSON') ?? '')) as Intent;
      if (!Array.isArray(map) || !map.every((s) => Array.isArray(s?.pts))) throw 0;
      setHistory((h) => [...h, map]);
      setCopied('pasted');
    } catch {
      setCopied('bad');
    }
    setTimeout(() => setCopied(''), 1200);
  };
  const onShot = useCallback((p: Partial<Shot>) => setShot((s) => {
    if (!s) return s;
    return (Object.keys(p) as (keyof Shot)[]).every((k) => Math.abs(s[k] - p[k]!) < 0.05) ? s : { ...s, ...p };
  }), []);
  const lens = shot ?? SHOTS[upright() ? 'p' : 'l'];
  // the line that stays sharp: through the middle of the frame at `focus` up it, leaning `lean` degrees
  const [start, end] = useMemo<[[number, number], [number, number]]>(() => {
    const cx = 0.5 * Math.cos(lens.lean * RAD), cy = 0.5 * Math.sin(lens.lean * RAD);
    return [[0.5 - cx, lens.focus - cy], [0.5 + cx, lens.focus + cy]];
  }, [lens.lean, lens.focus]);
  // ?debug: the traffic itself, for the buttons that ask something of it
  const traffic = useRef<Sim | null>(null);
  const onSim = useCallback((s: Sim) => { traffic.current = s; }, []);
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
  const town = useMemo(() => {
    const big = turnSome(first, plantTown(first).filter((_, i) => i % KEEP === 0));
    // and between them the little ones, along the roads
    return [...big, ...plantSmall(first, big)];
  }, [first]);
  // a bridge takes down the houses in its line; the same list for as long as the same ones stand
  const left = houses ? standing(intent, town) : NONE;
  const kept = useRef(left);
  if (kept.current.length !== left.length || kept.current.some((b, i) => b !== left[i])) kept.current = left;
  const blocks = kept.current;
  // everything with walls is in the way: the housing, and the sheds that were there from the start
  // the little ones are not: a road goes through them
  const walls = useMemo(() => (houses ? [...town.filter((b) => !b.small), ...first.buildings] : NONE), [houses, town, first]);
  const net = useMemo(() => {
    const n = buildNet(derive(intent, walls));
    if (!houses) return { ...n, buildings: [] };
    // the filling stations that still stand bring their roofs and their yards
    const fuel = blocks.filter((b) => b.pumps);
    return fuel.length ? { ...n, buildings: [...n.buildings, ...fuel.map((b) => b.pumps!)], pads: [...n.pads, ...fuel.map((b) => b.pad!)] } : n;
  }, [intent, walls, houses, blocks]);

  // The stroke is not built the moment the hand lets go: the brush leaves a ghost of it, the frame is shown,
  // and then the rules are run and the town rebuilt, as something that may be interrupted.
  // the ground first, then the trees, then the traffic, then the people and the signs
  // what is common ground: the park, the pitch, the school and the hedges, planted once like the housing,
  // and whatever of it the roads as they are now have left
  const commons = useMemo(() => plantCommons(first, town), [first, town]);
  const place = useMemo(() => ({ net, blocks, green: standingCommons(commons, net, blocks) }), [net, blocks, commons]);
  const wood = useLater(place, 1), roads = useLater(net, 2), life = useLater(place, 3);
  // what the WebGPU lights cannot be seen through
  const hides = useMemo(() => [...life.blocks, ...life.net.buildings], [life]);

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
        // the picture is soft on purpose: more pixels than this only heat the machine
        dpr={Math.min(devicePixelRatio, dpr)}
        frameloop="never"
        camera={{ fov: 20, near: 60, far: 4000 }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={[HAZE]} />
        <Pace fps={fps} />
        <Drone shot={shot} move={move} set={set} onShot={debug ? onShot : undefined} />
        <Sun speed={speed} shadow={fx.shadow} lazy={fx.lazy} clock={clock} scrub={scrub} onHour={debug ? onHour : undefined} />
        <World net={net} blocks={blocks} wood={wood} trees={trees} season={season} />
        <Cars net={roads} speed={speed} target={VEHICLES} trail={lights === 'off' ? 0 : clock.trail} glow={lights === 'webgpu'} walls={hides} onGlowFail={noGpu} shade={!fx.lazy} heat={heat} trace={tool === 'trace' ? trace : null} onNote={onNote} onSim={onSim} />
        <Commons green={place.green} speed={speed} />
        <People net={life.net} blocks={life.blocks} walks={life.green.walks} rides={life.green.rides} speed={speed} shade={!fx.lazy} />
        <Signs net={life.net} blocks={life.blocks} />
        <Street net={life.net} blocks={life.blocks} speed={speed} />
        <Painter net={net} tool={tool} onStroke={onStroke} onSmear={onSmear} onTrace={setTrace} />
        <EffectComposer multisampling={fx.aa === 'msaa4' ? 4 : fx.aa === 'msaa2' ? 2 : 0}>
          {fx.tilt && <TiltShift2 blur={lens.blur} taper={lens.taper} start={start} end={end} samples={touch ? 10 : 18} />}
          {/* the lights bleed into what is beside them, as they do through glass */}
          {fx.bloom && <Bloom mipmapBlur luminanceThreshold={0.72} luminanceSmoothing={0.2} intensity={grade.bloom} radius={0.75} />}
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Fade warm={season === 'autumn' ? 0.4 : season === 'spring' ? 0.2 : 0} gain={grade.gain} temp={grade.temp} bite={grade.bite} sat={grade.sat} lift={grade.lift} />
          {/* the lens and the stock: colours part a little towards the corners, grain, dark corners */}
          <ChromaticAberration offset={FRINGE} radialModulation modulationOffset={0.35} />
          <Film grain={grade.grain} />
          <Vignette offset={0.22} darkness={grade.dark} />
          {fx.aa === 'smaa' ? <SMAA /> : <></>}
        </EffectComposer>
      </Canvas>
      <div className="tools side">
        <button className={heat ? 'on' : ''} onClick={() => setHeat((v) => !v)}>Heat</button>
      </div>
      {shot && (
        <div className="pane">
          {SLIDERS.map(([k, label, min, max, step]) => (
            <label key={k}>
              <span>{label}</span>
              <input type="range" min={min} max={max} step={step} value={shot[k]} onChange={(e) => { onShot({ [k]: +e.target.value }); setSet((n) => n + 1); }} />
              <output>{shot[k]}</output>
            </label>
          ))}
          <hr />
          {MOVES.map(([k, label, min, max, step]) => (
            <label key={k}>
              <span>{label}</span>
              <input type="range" min={min} max={max} step={step} value={move[k]} onChange={(e) => setMove((m) => ({ ...m, [k]: +e.target.value }))} />
              <output>{move[k]}</output>
            </label>
          ))}
          <hr />
          {CLOCKS.map(([k, label, min, max, step]) => (
            <label key={k}>
              <span>{label}</span>
              <input type="range" min={min} max={max} step={step} value={clock[k]} onChange={(e) => { setClock((c) => ({ ...c, [k]: +e.target.value })); if (k === 'hour') setScrub((n) => n + 1); }} />
              <output>{k === 'hour' ? hhmm(clock.hour) : clock[k]}</output>
            </label>
          ))}
          <label>
            <span>Lights</span>
            <select value={lights} onChange={(e) => setClock((c) => ({ ...c, lights: e.target.value as Clock['lights'] }))}>
              {LIGHTS.map((l) => <option key={l} value={l} disabled={l === 'webgpu' && gpuOk === false}>{l === 'webgpu' && gpuOk === false ? 'webgpu (not here)' : l}</option>)}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={clock.hold} onChange={(e) => setClock((c) => ({ ...c, hold: e.target.checked }))} />
            <span>Hold time</span>
          </label>
          <hr />
          {GRADES.map(([k, label, min, max, step]) => (
            <label key={k}>
              <span>{label}</span>
              <input type="range" min={min} max={max} step={step} value={grade[k]} onChange={(e) => setGrade((g) => ({ ...g, [k]: +e.target.value }))} />
              <output>{grade[k]}</output>
            </label>
          ))}
          <hr />
          <label>
            <span>Pixels</span>
            <select value={dpr} onChange={(e) => setDpr(+e.target.value)}>
              {[0.75, 1, 1.25, 1.5, 1.75, 2].map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label>
            <span>Frames</span>
            <select value={fps} onChange={(e) => setFps(+e.target.value)}>
              {[30, 60].map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label>
            <span>Edges</span>
            <select value={fx.aa} onChange={(e) => setFx((f) => ({ ...f, aa: e.target.value as Fx['aa'] }))}>
              {AAS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          {SWITCHES.map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={fx[k]} onChange={(e) => setFx((f) => ({ ...f, [k]: e.target.checked }))} />
              <span>{label}</span>
            </label>
          ))}
          <button onClick={() => copy('shot', { ...shot, ...grade, dpr, fps, move, fx, clock })}>{copied === 'shot' ? 'Copied' : 'Copy'}</button>
          <button onClick={() => { setShot(SHOTS[upright() ? 'p' : 'l']); setSet((n) => n + 1); setGrade(GRADE); setFx(FX); setDpr(DPR); setFps(FPS); setMove(MOVE); setClock(CLOCK); setScrub((n) => n + 1); }}>Reset</button>
          <button onClick={() => copy('map', intent)}>{copied === 'map' ? 'Copied' : 'Copy map'}</button>
          <button onClick={pasteMap}>{copied === 'pasted' ? 'Pasted' : copied === 'bad' ? 'Not a map' : 'Paste map'}</button>
          {PERKS.map(([label, ask]) => <button key={label} onClick={() => traffic.current && ask(traffic.current)}>{label}</button>)}
        </div>
      )}
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
