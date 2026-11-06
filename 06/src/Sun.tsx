import { useMemo } from 'react';
import { LatheGeometry, MeshPhysicalMaterial, Vector2 } from 'three';

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

export function Sun() {
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
    </group>
  );
}
