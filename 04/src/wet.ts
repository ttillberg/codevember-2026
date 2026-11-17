// Wet paint. While a smear is being dragged the town is not built again: what lies on the roads is pushed in the
// vertex shader by the same falloff the smear gives the strokes, and the town is made again when the hand lets go.
import { Uniform, Vector2, Vector3, Vector4, type Material, type WebGLProgramParametersWithUniforms } from 'three';
import { SMEAR } from './paint';
import type { V } from './net';

/** Where the smear took hold (x, y on the ground) and where the hand is now (x, y). */
export const WET = new Uniform(new Vector4());

/** The smear's reach, squared, and the power of its falloff: what `SMEAR` in paint.ts says, for the shaders. */
export const FALL = new Uniform(new Vector2(SMEAR.r * SMEAR.r, SMEAR.fall));
/** Set how far the smear reaches (metres) and how its pull falls off (1 broad, 2 soft, 4 sharp), for the strokes and the shaders alike. */
export function smearSet(r: number, fall: number) {
  SMEAR.r = r;
  SMEAR.fall = fall;
  FALL.value.set(r * r, fall);
}

/**
 * What is rebuilt by itself when the roads change: the ground, the trees, the traffic, the street. For each, where the
 * hand was when what it shows was made (x, y), and whether that was during this smear at all (1) or after it (0).
 * Made before the smear, it was made with the hand where the smear took hold.
 */
export const SOAK = { ground: new Uniform(new Vector3()), trees: new Uniform(new Vector3()), traffic: new Uniform(new Vector3()), street: new Uniform(new Vector3()) };
export type Layer = keyof typeof SOAK;

/** A smear takes hold at p: everything there is was made before it. */
export function wetStart(p: V) {
  WET.value.set(p.x, p.y, p.x, p.y);
  for (const k of Object.values(SOAK)) k.value.set(p.x, p.y, 1);
}
/** The hand has moved to p. */
export function wetMove(p: V) {
  WET.value.z = p.x;
  WET.value.w = p.y;
}
/** The networks made while a smear is being dragged, each with where the hand was. */
const during = new WeakMap<object, V>();
/** This network was made by the smear with the hand at `at`. */
export function madeAt(net: object, at: V) {
  during.set(net, at);
}
/** This network is laid for good: it is what the painting is now. */
export function laid(net: object) {
  during.delete(net);
}
/** This layer has been made again from this network. */
export function settle(layer: Layer, net: object) {
  const at = during.get(net);
  if (at) SOAK[layer].value.set(at.x, at.y, 1);
  else SOAK[layer].value.z = 0;
}

const PUSH = /* glsl */ `
uniform vec4 uWet;
uniform vec3 uSoak;
uniform vec2 uWetFall;
#ifdef WET_FIRST
uniform float uWetFirst;
#endif
// as smear() in paint.ts moves a point of a stroke: all the way at the grab, nothing at the edge of its reach
float wetFall(vec2 p) {
  vec2 d = p - uWet.xy;
  float q = dot(d, d) / uWetFall.x;
  return q < 1.0 ? pow(1.0 - q, uWetFall.y) : 0.0;
}
vec4 wetAt(vec4 w) {
  float k = uSoak.z;
#ifdef WET_FIRST
  // only the instances from this one on: the rest are not on the roads
  k *= step(uWetFirst, float(gl_InstanceID));
#endif
  // where this point was before the smear, if what it belongs to was made with the hand somewhere along the way
  vec2 was = uSoak.xy - uWet.xy;
  vec2 p = w.xz - was * wetFall(w.xz);
  p = w.xz - was * wetFall(p);
  w.xz += (uWet.zw - uSoak.xy) * wetFall(p) * k;
  return w;
}
`;
const PROJECT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = viewMatrix * wetAt(modelMatrix * mvPosition);
gl_Position = projectionMatrix * mvPosition;
`;
/** how the shaders of this day put an instance on the screen when they are not three's own */
const PLAIN = 'projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0)';

function soakShader(s: WebGLProgramParametersWithUniforms, layer: Layer, first?: Uniform<number>) {
  s.uniforms.uWet = WET;
  s.uniforms.uSoak = SOAK[layer];
  s.uniforms.uWetFall = FALL;
  const head = (first ? '#define WET_FIRST\n' : '') + PUSH;
  if (first) s.uniforms.uWetFirst = first;
  if (s.vertexShader.includes('#include <project_vertex>')) {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + head).replace('#include <project_vertex>', PROJECT);
  } else if (s.vertexShader.includes(PLAIN)) {
    s.vertexShader = head + s.vertexShader.replace(PLAIN, 'projectionMatrix * viewMatrix * wetAt(modelMatrix * instanceMatrix * vec4(position, 1.0))');
  }
}

/** Let a material be pushed with its layer while a smear is dragged. `first`: only the instances from that one on. */
export function wet<M extends Material>(m: M, layer: Layer, first?: Uniform<number>): M {
  const before = m.onBeforeCompile, key = m.customProgramCacheKey();
  m.onBeforeCompile = (s, r) => {
    before.call(m, s, r);
    soakShader(s, layer, first);
  };
  m.customProgramCacheKey = () => key + '|wet:' + layer + (first ? ':first' : '');
  return m;
}

/** The same as props, for a material written in JSX that has no shader changes of its own. */
export function soaked(layer: Layer, first?: Uniform<number>) {
  return {
    onBeforeCompile: (s: WebGLProgramParametersWithUniforms) => soakShader(s, layer, first),
    customProgramCacheKey: () => 'wet:' + layer + (first ? ':first' : ''),
  };
}
export const SOAKED = { ground: soaked('ground'), trees: soaked('trees'), traffic: soaked('traffic'), street: soaked('street') };
