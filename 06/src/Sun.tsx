import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { LatheGeometry, type Mesh, MeshPhysicalMaterial, Vector3, SphereGeometry, Vector2 } from 'three';
import { gumMaterial, type Gum } from './Beans';

// The sun is a lollipop at the middle of the orbits: a round lemon yellow ball with a moulding seam round its middle,
// a little nub on top and a fine dimpled skin like peel, glowing softly from inside, on a short white paper
// stick. The light is inside the candy, so the planets are lit from the sun's
// side and throw their shadows away from it.
const CENTRE = 12.6; // the orbits' plane, the glass ball's middle
const RADIUS = 3.3;
const STICK = 0.3; // the stick's radius
const STICK_LENGTH = 3.65; // below the ball, in ball radii: a lollipop's proportions

// The belt round the middle where the two halves of the mould met: a flat band standing proud of the ball, with
// softly rounded edges. Half its height, how far it stands out, and how round its edges are, all in ball radii.
const BELT_HALF = 0.13;
const BELT_OUT = 1.05;
const BELT_ROUND = 0.05;

// The ball's outline, turned on a lathe: a slightly squashed sphere, the belt at its equator, a small nub on top.
function ballGeometry() {
  const pts: Vector2[] = [];
  const n = 480; // fine, so the belt's edges come out crisp
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI;
    let r = RADIUS * Math.cos(a);
    let y = RADIUS * Math.sin(a) * 0.95;
    // The belt: flat across its height, its edges rounding off into the ball.
    const over = Math.max(Math.abs(y) / RADIUS - BELT_HALF, 0) / BELT_ROUND;
    if (over < 1) r = Math.max(r, RADIUS * (BELT_OUT - BELT_ROUND * (1 - Math.sqrt(1 - over * over))));
    if (y > 0) y += RADIUS * 0.13 * Math.exp(-((r / (RADIUS * 0.17)) ** 2)); // the nub
    pts.push(new Vector2(Math.max(r, 0.0001), y));
  }
  const g = new LatheGeometry(pts, 96);
  g.computeVertexNormals();
  return g;
}

// Lemon candy: one yellow, a fine dimpled skin (the normal nudged by small scale noise), a hard glaze, and light
// coming through it from inside.
function lemon() {
  const m = new MeshPhysicalMaterial({ color: '#ffd200', roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying vec3 vObj;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `varying vec3 vObj;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
void main() {`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
  // Dimples: the slope of a fine noise, tipping the normal.
  vec3 q = vObj * 14.0;
  float e = 0.08, n0 = noise(q);
  vec3 g = vec3(noise(q + vec3(e, 0, 0)) - n0, noise(q + vec3(0, e, 0)) - n0, noise(q + vec3(0, 0, e)) - n0) / e;
  normal = normalize(normal - g * 0.16);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
  // Faked subsurface scattering from the light inside: looking straight in, the light has the least candy to get
  // through, so the middle glows bright and pale; towards the rim it crosses more of it, so it dims and deepens to
  // amber, and the dimples catch a little of it.
  float facing = abs(dot(normal, normalize(vViewPosition)));
  vec3 core = vec3(1.0, 0.93, 0.55);
  vec3 deep = vec3(1.0, 0.45, 0.04);
  totalEmissiveRadiance += core * pow(facing, 3.0) * 1.1 + deep * pow(1.0 - facing, 1.5) * 0.7 + diffuseColor.rgb * 0.15;`,
      );
  };
  return m;
}

// Which sun: the lemon lollipop, or a big sugared jelly ball like Uranus, orange gum with the light inside it.
const KIND: 'lollipop' | 'jelly' = 'jelly';
const JELLY: Gum = { deep: [255, 120, 0], pale: [255, 200, 40], bands: 0, size: 2048, grains: 70000 };

export function Sun() {
  return KIND === 'jelly' ? <JellySun /> : <Lollipop />;
}

function SunLight() {
  return (
    <pointLight
      color="#ffe2b8"
      intensity={260}
      decay={1}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0005}
      shadow-radius={4}
      shadow-camera-near={RADIUS + 0.1}
      shadow-camera-far={90}
    />
  );
}

// The jelly ball: sugared gum glowing from inside, as the light is in it. The glow goes through the colour map, so
// the sugar grains shine paler than the gum, and it's faked subsurface: looking straight in there's least gum to get
// through, so the middle is bright and pale; towards the rim it crosses more, so it dims and deepens to amber.
// It casts no shadow of its own.
const JELLY_TIME = { value: 0 };
const SUN_AT = new Vector3();
function jellyMaterial() {
  const m = gumMaterial('Sun', JELLY, RADIUS, '#ff8a00', 1, -1);
  m.emissive.set('#ffffff');
  m.emissiveMap = m.map;
  m.emissiveIntensity = 1.5;
  m.clearcoat = 0.7; // a wet, glassy gloss over the gum, like clear jelly
  m.clearcoatRoughness = 0.12;
  m.transmission = 0.15; // mostly glowing gum; much more and the pale room shows through and bleaches it
  m.needsUpdate = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = JELLY_TIME;
    // A slow wobble: the surface pushed in and out along its radius by a few long, slow, overlapping waves that
    // drift with time, so it never quite holds a shape. The normal is tipped by the wobble's slope to match.
    sh.vertexShader = sh.vertexShader
      .replace(
        'void main() {',
        /* glsl */ `uniform float uTime;
  float jellyWobble(vec3 p, float t) {
    return 0.035 * sin(p.x * 1.8 + t * 0.7) * sin(p.y * 2.2 - t * 0.5)
         + 0.025 * sin(p.z * 2.6 + p.x * 1.2 + t * 0.9)
         + 0.015 * sin(p.y * 4.2 + p.z * 3.4 - t * 1.3);
  }
void main() {`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
  vec3 jellyDir = normalize(position);
  float jellyW = jellyWobble(jellyDir, uTime);
  {
    float e = 0.01;
    vec3 g = vec3(jellyWobble(jellyDir + vec3(e, 0, 0), uTime), jellyWobble(jellyDir + vec3(0, e, 0), uTime), jellyWobble(jellyDir + vec3(0, 0, e), uTime)) - jellyW;
    g /= e;
    g -= dot(g, jellyDir) * jellyDir; // only its slope along the surface tips the normal
    objectNormal = normalize(objectNormal - g / (1.0 + jellyW));
  }`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed *= 1.0 + jellyW;')
      .replace(
        '#include <uv_vertex>',
        /* glsl */ `#include <uv_vertex>
  // The sugar slides about on the jelly as it wobbles: every map's coordinates drift by a slow field over the ball.
  {
    vec3 d = normalize(position);
    vec2 drift = vec2(0.006 * sin(d.y * 3.0 + uTime * 0.6) * sin(d.z * 2.5 - uTime * 0.4),
                      0.004 * sin(d.x * 2.8 - uTime * 0.5) * sin(d.y * 3.3 + uTime * 0.7));
    #ifdef USE_MAP
      vMapUv += drift;
    #endif
    #ifdef USE_EMISSIVEMAP
      vEmissiveMapUv += drift;
    #endif
    #ifdef USE_BUMPMAP
      vBumpMapUv += drift;
    #endif
    #ifdef USE_ROUGHNESSMAP
      vRoughnessMapUv += drift;
    #endif
  }`,
      );
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
  float facing = abs(dot(normal, normalize(vViewPosition)));
  vec3 core = vec3(1.0, 0.95, 0.7), deep = vec3(1.0, 0.4, 0.02);
  totalEmissiveRadiance *= mix(deep, core, pow(facing, 2.0)) * (0.55 + 1.1 * pow(facing, 1.5));`,
    );
  };
  return m;
}

function JellySun() {
  const { geometry, material } = useMemo(() => ({ geometry: new SphereGeometry(RADIUS, 128, 64), material: jellyMaterial() }), []);
  const ball = useRef<Mesh>(null!);
  useFrame(({ camera }, dt) => {
    JELLY_TIME.value += dt; // the wobble keeps going even while the clock is paused
    // With the camera inside it (looking out from the sun's side at an inner planet) the candy is hidden; its light stays.
    ball.current.visible = camera.position.distanceTo(ball.current.getWorldPosition(SUN_AT)) > RADIUS * 1.15;
  });
  return (
    <group position={[0, CENTRE, 0]}>
      <mesh ref={ball} geometry={geometry} material={material} />
      <SunLight />
    </group>
  );
}

function Lollipop() {
  const { ball, candy } = useMemo(() => ({ ball: ballGeometry(), candy: lemon() }), []);
  const top = -RADIUS * 0.8; // the stick goes a little way into the candy
  const length = RADIUS * (STICK_LENGTH + 0.2);
  return (
    <group position={[0, CENTRE, 0]}>
      {/* The candy holds the light, so it doesn't cast a shadow of its own. */}
      <mesh geometry={ball} material={candy} />
      <mesh position={[0, top - length / 2, 0]} castShadow>
        <cylinderGeometry args={[STICK, STICK, length, 24]} />
        {/* Paper white: lit mostly from above by the candy, so it glows a little on its own not to go grey. */}
        <meshStandardMaterial color="#f7f4ee" roughness={0.7} emissive="#f7f4ee" emissiveIntensity={0.35} />
      </mesh>
      <SunLight />
    </group>
  );
}
