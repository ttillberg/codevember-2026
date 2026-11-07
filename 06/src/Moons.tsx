import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BallCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  type Group,
  Color,
  CylinderGeometry,
  MeshPhysicalMaterial,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LENGTH, NEPTUNE, NonpareilDrop, PlanetCandy, TRITON_COLOURS } from './Beans';
import { clock, motion } from './clock';
import { moonPositions, planetPositions } from './world';
import { rng } from './random';
import { NOISE } from './glsl';

// The planets' main moons, as small sugar coated sweets on circles round their planet beans. Real periods (days),
// distances squeezed in close, just clear of the bean, sizes to suit. At 30 days a second the real periods would blur
// into rings, so they are squeezed too, like the distances: a moon takes about the square root of its period in days
// (times SECONDS) to go round, never faster than its real pace at the clock's speed. Each keeps its own pace, so no
// two line up for long, inner ones still quicker than outer ones. They are light: steered along their orbits
// like the planets, so a planet bean or a thrown sweet knocks them off course, and they drift back onto it.
type Moon = {
  name: string;
  period: number; // days, negative is retrograde
  orbit: number; // scene units from the planet's middle
  radius: number;
  colour: string;
  allsort?: Allsort; // one of the liquorice allsorts instead of a ball
  gumball?: boolean; // a glossy pastel gumball, like Saturn
  bean?: string; // a little jelly bean, the same sweet as this planet's
  nonpareil?: boolean; // a little nonpareil drop like Neptune, in pinks
  popcorn?: boolean; // a piece of popcorn
};
// Liquorice allsorts: a square of layers (bottom to top), or a roll, a coloured coat round a core.
export type Allsort =
  | { kind: 'layers'; layers: string[] }
  | { kind: 'roll'; coat: string; core: string }
  | { kind: 'bobble'; colour: string }; // the round one, covered in nonpareils
type System = { host: string; normal: Vector3; moons: Moon[] };

const UP = new Vector3(0, 1, 0);
const tipped = (deg: number, axis = new Vector3(1, 0, 0)) => UP.clone().applyAxisAngle(axis, (deg * Math.PI) / 180);

const SYSTEMS: System[] = [
  // The Moon's orbit is tipped 5° to Earth's.
  { host: 'Earth', normal: tipped(5.1), moons: [{ name: 'Moon', period: 27.32, orbit: 2.5, radius: 0.42, colour: '#f6ecd0', popcorn: true }] },
  {
    host: 'Mars',
    normal: tipped(1),
    moons: [
      // Mars is a chilli jelly bean, so its two little moons are chilli jelly beans too, just small.
      { name: 'Phobos', period: 0.319, orbit: 2.4, radius: 0.18, colour: '#a5121c', bean: 'Mars' },
      { name: 'Deimos', period: 1.263, orbit: 2.85, radius: 0.14, colour: '#a5121c', bean: 'Mars' },
    ],
  },
  {
    host: 'Jupiter',
    normal: tipped(2),
    moons: [
      // Jupiter's moons are liquorice allsorts, round its big yellow roll.
      { name: 'Io', period: 1.769, orbit: 2.3, radius: 0.3, colour: '#f06a9a', allsort: { kind: 'bobble', colour: '#f06a9a' } },
      { name: 'Europa', period: 3.551, orbit: 2.7, radius: 0.32, colour: '#f3efe6', allsort: { kind: 'layers', layers: ['#f3efe6', '#1a1416', '#f3efe6', '#1a1416', '#f3efe6'] } },
      { name: 'Ganymede', period: 7.155, orbit: 3.15, radius: 0.4, colour: '#f2a65a', allsort: { kind: 'layers', layers: ['#f2a65a', '#1a1416', '#f2a65a'] } },
      { name: 'Callisto', period: 16.689, orbit: 3.6, radius: 0.36, colour: '#1a1416', allsort: { kind: 'roll', coat: '#1a1416', core: '#f3efe6' } },
    ],
  },
  // Titan, just beyond the belt of little gumballs: a gumball itself, orange. The belt bends round it as it passes.
  { host: 'Saturn', normal: tipped(-20), moons: [{ name: 'Titan', period: 15.945, orbit: 3.4, radius: 0.3, colour: '#f5a04e', gumball: true }] },
  // Uranus's moons aren't here: they're gum drops stuck on to it, see Beans.
  // Triton goes round backwards, on an orbit tipped well over.
  { host: 'Neptune', normal: tipped(23), moons: [{ name: 'Triton', period: -5.877, orbit: 2.3, radius: 0.3, colour: '#de3592', nonpareil: true }] },
];

const SECONDS = 6; // a moon's squeezed period, in seconds, per square root of its real period in days: Phobos, the quickest, goes round in about 3.4 s, never a blur
const MAX_SPIN = 1.2; // radians a second: the fastest a knocked moon may turn about itself
const PULL = 4; // per second: how hard a knocked moon is drawn back to its place on its orbit
const DENSITY = 0.5; // light next to the planet beans (25), so they shove the moons and not the other way round

function MoonBody({ moon, system, index }: { moon: Moon; system: System; index: number }) {
  const ref = useRef<RapierRigidBody>(null!);
  // A stable random number per moon, from its name, for its starting place and its own small tilt.
  const luck = useMemo(() => {
    let h = 2166136261;
    for (const c of moon.name) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (k: number) => (((Math.imul(h, k * 2654435761) >>> 0) % 10000) / 10000);
  }, [moon.name]);
  const angle = useRef(luck(1) * Math.PI * 2);
  const { u, w } = useMemo(() => {
    // The moon's own orbit plane: the system's, tipped a degree or three about a random line, as real orbits are.
    const across = new Vector3(Math.cos(luck(2) * 6.28), 0, Math.sin(luck(2) * 6.28)).projectOnPlane(system.normal).normalize();
    const normal = system.normal.clone().applyAxisAngle(across, ((luck(3) - 0.5) * 6 * Math.PI) / 180);
    // Two directions across the orbit's plane, so that with the normal straight up it goes round the way the planets do.
    const u = new Vector3(1, 0, 0).projectOnPlane(normal).normalize();
    const w = new Vector3().crossVectors(normal, u);
    return { u, w };
  }, [system, luck]);
  const at = useMemo(() => new Vector3(), []), before = useMemo(() => new Vector3(), []), vel = useMemo(() => new Vector3(), []);
  const started = useRef(false);

  useFrame((_, dt) => {
    const host = planetPositions.get(system.host);
    if (!host || !ref.current) return;
    // Turns a second: the real pace at the clock's speed, or the squeezed one, whichever is slower.
    const period = Math.abs(moon.period);
    const turns = clock.paused ? 0 : Math.min(clock.speed / period, motion() / (SECONDS * Math.sqrt(period)));
    angle.current += dt * turns * Math.sign(moon.period) * Math.PI * 2;
    const a = angle.current;
    before.copy(at);
    at.copy(host).addScaledVector(u, Math.cos(a) * moon.orbit).addScaledVector(w, Math.sin(a) * moon.orbit);
    const rb = ref.current;
    if (!started.current) {
      // Start on its orbit.
      rb.setTranslation(at, true);
      started.current = true;
      return;
    }
    // Move with its place on the orbit, plus a pull back to it: a knock sends it off, the pull brings it home.
    const p = rb.translation();
    vel.subVectors(at, before).divideScalar(Math.max(dt, 1e-4));
    vel.x += (at.x - p.x) * PULL;
    vel.y += (at.y - p.y) * PULL;
    vel.z += (at.z - p.z) * PULL;
    if (clock.paused) {
      // Paused: held in its place on its orbit, so it stays with its planet while paused.
      rb.setTranslation(at, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    } else rb.setLinvel(vel, true);
    // Their own spin, from knocks, never runs away: capped, and damped back down (angularDamping below).
    const turning = rb.angvel(), spin = Math.hypot(turning.x, turning.y, turning.z);
    if (clock.paused) rb.setAngvel({ x: 0, y: 0, z: 0 }, true); // paused: everything holds still
    else if (spin > MAX_SPIN) {
      const k = MAX_SPIN / spin;
      rb.setAngvel({ x: turning.x * k, y: turning.y * k, z: turning.z * k }, true);
    }
    let mine = moonPositions.get(moon.name);
    if (!mine) moonPositions.set(moon.name, (mine = new Vector3()));
    mine.copy(p);
  });

  return (
    <RigidBody ref={ref} type="dynamic" gravityScale={0} canSleep={false} colliders={false} angularDamping={1.5} position={[0, -100, 0]}>
      <BallCollider args={[moon.radius]} restitution={0.8} density={DENSITY} />
      <group>
      {moon.popcorn ? (
        <Popcorn radius={moon.radius} seed={index + 4} />
      ) : moon.nonpareil ? (
        <group scale={moon.radius / NEPTUNE.a}>
          <NonpareilDrop colours={TRITON_COLOURS} core="#5e0934" count={500} />
        </group>
      ) : moon.bean ? (
        // The planet's own sweet, shrunk to a moon: a bean a bit more than twice its radius long.
        <group scale={(moon.radius * 2.4) / LENGTH}>
          <PlanetCandy name={moon.bean} />
        </group>
      ) : moon.allsort ? (
        <AllsortSweet allsort={moon.allsort} size={moon.radius} seed={index * 7.7 + moon.orbit} />
      ) : (
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[moon.radius, 32, 16]} />
        {moon.gumball ? (
          <meshPhysicalMaterial color={moon.colour} roughness={0.3} clearcoat={0.75} clearcoatRoughness={0.15} sheen={0.4} sheenColor="#fff4e0" emissive={moon.colour} emissiveIntensity={0.05} />
        ) : (
          // A faint glow of its own colour, so the night side still reads, like the planet beans.
          <meshPhysicalMaterial color={moon.colour} roughness={0.35} clearcoat={1} emissive={moon.colour} emissiveIntensity={0.25} />
        )}
      </mesh>
      )}
      </group>
    </RigidBody>
  );
}

// The Moon is a piece of popcorn: a puffy, lumpy cluster of lobes burst out of the kernel, matt and super white, the
// faintest warm tint down between them, with a scrap of brown hull stuck on.
function popcornGeometry(radius: number, seed: number) {
  const rnd = rng(seed * 7 + 3);
  const lobes: BufferGeometry[] = [];
  const cream = new Color('#ffffff'), butter = new Color('#f6efe0'), hull = new Color('#7a4a24'), c = new Color();
  const lobe = (r: number, at: Vector3, colour: Color, lumps: number) => {
    const raw = new IcosahedronGeometry(r, 4);
    raw.deleteAttribute('normal');
    raw.deleteAttribute('uv');
    const g = mergeVertices(raw); // shared corners, so it shades smooth
    const p = g.attributes.position, v = new Vector3(), colours = new Float32Array(p.count * 3), k = rnd() * 10;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = v.clone().normalize();
      // Puffed and creased, like a burst kernel.
      const bump = 1 + lumps * (Math.sin(n.x * 5 + k) * Math.sin(n.y * 4 - k) * Math.sin(n.z * 6 + k * 0.5) + 0.4 * Math.sin(n.x * 11 + n.z * 9 + k));
      v.multiplyScalar(bump).add(at);
      p.setXYZ(i, v.x, v.y, v.z);
      // Buttery towards the middle of the piece, creamy out at the tips.
      c.copy(butter).lerp(colour, Math.min(1, v.length() / radius));
      colours.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(colours, 3));
    lobes.push(g);
  };
  lobe(radius * 0.55, new Vector3(), cream, 0.12);
  const count = 6 + Math.floor(rnd() * 3);
  for (let i = 0; i < count; i++) {
    const y = rnd() * 2 - 1, a = rnd() * Math.PI * 2, ring = Math.sqrt(1 - y * y);
    const dir = new Vector3(Math.cos(a) * ring, y, Math.sin(a) * ring);
    lobe(radius * (0.32 + rnd() * 0.2), dir.multiplyScalar(radius * (0.42 + rnd() * 0.15)), cream, 0.16);
  }
  lobe(radius * 0.16, new Vector3(0, -radius * 0.5, radius * 0.18), hull, 0.25); // the hull
  const merged = mergeGeometries(lobes);
  merged.computeVertexNormals();
  return merged;
}
// Super white: a strong glow of its own as well, so even its shaded side stays bright.
const POPCORN = new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.82, sheen: 0.5, sheenColor: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.75 });
function Popcorn({ radius, seed }: { radius: number; seed: number }) {
  const geometry = useMemo(() => popcornGeometry(radius, seed), [radius, seed]);
  return <mesh geometry={geometry} material={POPCORN} castShadow receiveShadow />;
}

// Liquorice allsorts are soft and handmade looking: corners rounded off, surfaces slightly uneven, layers not quite
// lined up, a fine sugary grain. Helpers for that, then the sweet itself.

// Smooth noise from a few incommensurate sines: cheap, seamless, and the same function for every part of a sweet,
// so pieces that touch (a coat and its core) wobble together.
const wobble = (x: number, y: number, z: number, seed: number) =>
  Math.sin(x * 2.1 + seed) * Math.sin(y * 1.7 - seed * 0.7) * Math.sin(z * 2.3 + seed * 1.3) +
  0.4 * Math.sin(x * 4.3 + z * 3.1 + seed * 2.1) * Math.sin(y * 3.7 - x * 1.3);

// Push each vertex out from the middle a little by that noise, read in the sweet's own size (so a planet sized roll
// and a moon sized one look alike), to keep any surface from being perfectly flat.
function organic<T extends BufferGeometry>(g: T, amount: number, seed: number, size: number): T {
  const p = g.attributes.position, v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = wobble(v.x / size, v.y / size, v.z / size, seed);
    const len = v.length() || 1;
    v.multiplyScalar(1 + (n * amount * size) / len);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// Sugar: matte, a faint glow of its own so it reads on its night side, and a fine grain in the shader, from the
// slope of a smooth 3D noise in the sweet's own space (no texture, so no pixels and no UV seams).
// Three finishes: fondant (fine sugar), coconut (the rolls' coats, coarse flakes), liquorice (smooth, a soft sheen).
type Finish = 'fondant' | 'coconut' | 'liquorice';
const FINISH: Record<Finish, { scale: number; depth: number; roughness: number; clearcoat: number }> = {
  fondant: { scale: 22, depth: 0.06, roughness: 0.8, clearcoat: 0 },
  coconut: { scale: 12, depth: 0.14, roughness: 0.9, clearcoat: 0 },
  liquorice: { scale: 14, depth: 0.03, roughness: 0.45, clearcoat: 0.35 },
};
const LIQUORICE = '#1a1416';
const SUGAR = new Map<string, MeshPhysicalMaterial>();
function sugarMaterial(colour: string, size: number, finish: Finish = colour === LIQUORICE ? 'liquorice' : 'fondant') {
  const key = colour + size + finish;
  let m = SUGAR.get(key);
  if (m) return m;
  const f = FINISH[finish];
  m = new MeshPhysicalMaterial({ color: colour, roughness: f.roughness, clearcoat: f.clearcoat, clearcoatRoughness: 0.4, emissive: colour, emissiveIntensity: 0.15 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrain = { value: f.scale / size };
    sh.uniforms.uDepth = { value: f.depth };
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying vec3 vObj;\nvarying mat3 vToView;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObj = position;\n  vToView = normalMatrix;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `varying vec3 vObj;
  varying mat3 vToView; // object to view space, for normals
  uniform float uGrain, uDepth;
  ${NOISE}
  // Two octaves, the second folded into ridges, so it reads as flakes and crystals rather than a soft blur.
  float grain(vec3 q) { return noise(q) + 0.6 * abs(noise(q * 2.9 + 11.0) * 2.0 - 1.0); }
void main() {`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
  // The grain's slope, in object space, turned to view space to tip the normal.
  vec3 q = vObj * uGrain;
  float e = 0.12, g0 = grain(q);
  vec3 g = vec3(grain(q + vec3(e, 0, 0)) - g0, grain(q + vec3(0, e, 0)) - g0, grain(q + vec3(0, 0, e)) - g0) / e;
  normal = normalize(normal - vToView * g * uDepth);`,
      );
  };
  SUGAR.set(key, m);
  return m;
}

// Fill a polyline with points every step or so, so the lathe has enough rings for the noise to bend smoothly.
function resample(pts: Vector2[], step: number) {
  const out: Vector2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], k = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let j = 1; j <= k; j++) out.push(a.clone().lerp(b, j / k));
  }
  return out;
}

// A roll's coat, turned on a lathe: a thick tube, its outer edges rounded over, and at each end a small lip curling
// into the hole, where the core sits a touch recessed.
function rollCoat(radius: number, core: number, length: number) {
  const pts: Vector2[] = [], half = length / 2, round = radius * 0.16, lip = radius * 0.05, n = 12;
  const corner = (cx: number, cy: number, r: number, from: number, to: number) => {
    for (let i = 0; i <= n; i++) {
      const a = from + (i / n) * (to - from);
      pts.push(new Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  };
  pts.push(new Vector2(core, -half + lip * 2)); // inside the hole
  corner(core + lip, -half + lip, lip, Math.PI, Math.PI * 1.5); // the lip, rolling out of the hole
  corner(radius - round, -half + round, round, -Math.PI / 2, 0); // bottom outer edge
  corner(radius - round, half - round, round, 0, Math.PI / 2); // top outer edge
  corner(core + lip, half - lip, lip, Math.PI / 2, Math.PI); // the lip, back into the hole
  pts.push(new Vector2(core, half - lip * 2));
  const g = new LatheGeometry(resample(pts, radius * 0.04), 128);
  return g;
}

// One liquorice allsort, about 2 × size across: a square of soft layers, or a roll with its core showing at the ends.
// The round one: a ball covered in tiny sugar beads, spread evenly (a Fibonacci spiral).
function Bobble({ colour, size, seed }: { colour: string; size: number; seed: number }) {
  const ref = useRef<InstancedMesh>(null!);
  const count = 420, r = size * 0.9;
  const bead = useMemo(() => new SphereGeometry(size * 0.12, 8, 6), [size]);
  useLayoutEffect(() => {
    const m = new Matrix4(), golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (2 * (i + 0.5)) / count, ring = Math.sqrt(1 - y * y), a = i * golden + seed;
      // A little squashed, like the real thing, and the beads not quite even.
      const k = r * (1 + 0.04 * Math.sin(i * 12.9898 + seed));
      m.makeTranslation(Math.cos(a) * ring * k, y * k * 0.85, Math.sin(a) * ring * k);
      ref.current.setMatrixAt(i, m);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  }, [r, seed]);
  return (
    <group>
      <mesh scale={[1, 0.85, 1]} material={sugarMaterial(colour, size)} castShadow receiveShadow>
        <sphereGeometry args={[r, 32, 16]} />
      </mesh>
      <instancedMesh ref={ref} args={[bead, undefined, count]} castShadow receiveShadow>
        <meshPhysicalMaterial color={colour} roughness={0.45} clearcoat={0.4} emissive={colour} emissiveIntensity={0.15} />
      </instancedMesh>
    </group>
  );
}

export function AllsortSweet({ allsort, size, seed }: { allsort: Allsort; size: number; seed: number }) {
  if (allsort.kind === 'bobble') return <Bobble colour={allsort.colour} size={size} seed={seed} />;
  return <Cut allsort={allsort} size={size} seed={seed} />;
}

// The cut ones: layers, or a roll.
function Cut({ allsort, size, seed }: { allsort: Exclude<Allsort, { kind: 'bobble' }>; size: number; seed: number }) {
  const parts = useMemo(() => {
    if (allsort.kind === 'layers') {
      const side = size * 1.6, layer = (side * 0.75) / allsort.layers.length;
      return allsort.layers.map((colour, i) => ({
        colour,
        geometry: organic(new RoundedBoxGeometry(side, layer * 1.04, side, 6, layer * 0.3), 0.02, seed + i, size),
        // Each layer sits a touch off the one below, as if cut by hand.
        position: [(Math.sin(seed + i * 2.3) * side) / 40, (i - (allsort.layers.length - 1) / 2) * layer, (Math.cos(seed + i * 1.7) * side) / 40] as [number, number, number],
        rotation: [0, Math.sin(seed * 3 + i) * 0.05, 0] as [number, number, number],
      }));
    }
    const length = size * 1.5, core = size * 0.36; // the liquorice core about a third of the roll across, as in the bag
    return [
      { colour: allsort.coat, finish: 'coconut' as Finish, geometry: organic(rollCoat(size, core, length), 0.012, seed, size), position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] },
      // The core: a little shorter, so it sits just recessed in the coat's lips, wobbling with the same noise.
      {
        colour: allsort.core,
        geometry: organic(new CylinderGeometry(core * 1.01, core * 1.01, length - size * 0.12, 96, 12), 0.012, seed, size),
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
      },
    ];
  }, [allsort, size, seed]);
  return (
    <group rotation={allsort.kind === 'roll' ? [0, 0, Math.PI / 2] : [0, 0, 0]} scale={allsort.kind === 'roll' ? [1, 1, 0.9] : [1, 1, 1]}>
      {parts.map((part, i) => (
        <mesh key={i} geometry={part.geometry} material={sugarMaterial(part.colour, size, 'finish' in part ? part.finish : undefined)} position={part.position} rotation={part.rotation} castShadow receiveShadow />
      ))}
    </group>
  );
}

export function Moons() {
  return (
    <>
      {SYSTEMS.flatMap((s) => s.moons.map((m, i) => <MoonBody key={m.name} moon={m} system={s} index={i} />))}
      <SpaceStation />
    </>
  );
}

// The International Space Station, in candy, so small it only shows once you're close to the Earth: a candy cane
// truss, three marshmallow modules across it, and eight panels of dark blue hard candy, going round low and fast on
// an orbit tipped 51.6°, always pointing the way it's going. Not part of the physics.
const ISS_ORBIT = 1.36 + 0.42; // just off the Earth's pebbles
const ISS_TURNS = 0.12; // turns a second at full speed (the real one goes round about every 92 minutes)
const ISS_NORMAL = new Vector3(0, 1, 0).applyAxisAngle(new Vector3(1, 0, 0), (51.6 * Math.PI) / 180);
const CANE = (() => {
  // The truss: a thin stick striped red and white along its length, lying along x.
  const g = new CylinderGeometry(0.012, 0.012, 0.56, 10, 28).rotateZ(Math.PI / 2);
  const p = g.attributes.position, colours = new Float32Array(p.count * 3), red = new Color('#e0242c'), white = new Color('#ffffff');
  for (let i = 0; i < p.count; i++) {
    const c = Math.floor((p.getX(i) + 0.28) / 0.04) % 2 ? red : white;
    colours.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colours, 3));
  return g;
})();
const CANE_MATERIAL = new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.8, emissive: '#ffffff', emissiveIntensity: 0.08 });
const MALLOW = new CylinderGeometry(0.032, 0.032, 0.11, 16).rotateX(Math.PI / 2);
const MALLOWS = ['#f7c6d9', '#ffffff', '#c9f0de'].map((colour) => new MeshPhysicalMaterial({ color: colour, roughness: 0.85, sheen: 0.6, sheenColor: '#ffffff', emissive: colour, emissiveIntensity: 0.2 }));
const PANEL = new BoxGeometry(0.11, 0.004, 0.05);
const PANEL_MATERIAL = new MeshPhysicalMaterial({ color: '#1b2f8a', roughness: 0.15, clearcoat: 1, emissive: '#1b2f8a', emissiveIntensity: 0.35 });
function SpaceStation() {
  const ref = useRef<Group>(null!);
  const s = useMemo(() => ({ angle: 0, at: new Vector3(), ahead: new Vector3(), u: new Vector3(1, 0, 0).projectOnPlane(ISS_NORMAL).normalize(), w: new Vector3() }), []);
  s.w.crossVectors(ISS_NORMAL, s.u);
  const look = useMemo(() => new Matrix4(), []);
  useFrame((_, dt) => {
    const earth = planetPositions.get('Earth');
    if (!earth || !ref.current) return;
    s.angle += dt * Math.min(clock.paused ? 0 : clock.speed * 15.5, motion() * ISS_TURNS) * Math.PI * 2;
    const place = (a: number, out: Vector3) =>
      out.copy(earth).addScaledVector(s.u, Math.cos(a) * ISS_ORBIT).addScaledVector(s.w, Math.sin(a) * ISS_ORBIT);
    place(s.angle, s.at);
    place(s.angle + 0.05, s.ahead);
    ref.current.position.copy(s.at);
    // The truss across the way it's going, the panels' faces towards the Earth.
    look.lookAt(s.at, s.ahead, s.at.clone().sub(earth).normalize());
    ref.current.quaternion.setFromRotationMatrix(look);
  });
  return (
    <group ref={ref}>
      <mesh geometry={CANE} material={CANE_MATERIAL} />
      {MALLOWS.map((m, i) => (
        <mesh key={i} geometry={MALLOW} material={m} position={[(i - 1) * 0.036, 0, 0.04]} />
      ))}
      {[-1, 1].flatMap((side) =>
        [0, 1, 2, 3].map((k) => (
          <mesh key={`${side}${k}`} geometry={PANEL} material={PANEL_MATERIAL} position={[side * (0.17 + (k % 2) * 0.12), 0, k < 2 ? 0.035 : -0.035]} />
        )),
      )}
    </group>
  );
}
