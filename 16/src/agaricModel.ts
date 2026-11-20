// The fly agaric as a model (model/agaric.py → public/agaric.glb): one mesh whose growth is four morph targets
// (egg, button, dome, wither; the basis is the grown one, open), drawn instanced, each fungus its own blend of
// them. Nothing is built while it grows: the page only sets a few weights per fungus. `?procagaric` keeps the
// procedural one, built ring by ring (fungi.ts), to compare.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** the model's own cap radius and stem height to the top of the cap, metres: each fungus is scaled from these */
export const MODEL_R = 0.065, MODEL_H = 0.165;
export const PROC_AGARIC = new URLSearchParams(location.search).has('procagaric');

let loading: Promise<THREE.BufferGeometry | null> | null = null;
/** The model's geometry, loaded once and shared (null if it could not be had: the procedural one stays). */
export function loadAgaric() {
  if (PROC_AGARIC) return Promise.resolve(null);
  loading ??= new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}agaric.glb`).then((gltf) => {
    let geo: THREE.BufferGeometry | null = null;
    gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) geo = (o as THREE.Mesh).geometry; });
    return geo;
  }).catch((e) => { console.warn('agaric.glb', e); return null; });
  return loading;
}

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * The weights for growth g (0..1) and withering rot (0..1), in the targets' order: egg, button, dome, wither,
 * round, upturn. Egg to button by a third of the way, button to dome by two thirds, dome to open at the end.
 * `shape` (-1..1) is this one's cap when grown: below zero a round dome, above it flattened and turned up at
 * the rim; mixed in as it opens.
 */
export function agaricWeights(g: number, rot: number, shape: number, out: number[]) {
  out[0] = out[1] = out[2] = 0;
  if (g < 0.35) { const t = ease(g / 0.35); out[0] = 1 - t; out[1] = t; }
  else if (g < 0.68) { const t = ease((g - 0.35) / 0.33); out[1] = 1 - t; out[2] = t; }
  else out[2] = 1 - ease(clamp01((g - 0.68) / 0.32));
  out[3] = ease(clamp01(rot / 0.85));
  const open = g < 0.68 ? 0 : 1 - out[2];
  out[4] = Math.max(0, -shape) * open;
  // an upturned rim is an old one's: it turns up late, and the withering bends it down again
  out[5] = Math.max(0, shape) * open * open * (1 - out[3]);
  return out;
}

/** The geometry for one InstancedMesh: the shared model's attributes (not copied), and its own per-fungus data. */
export function instancedAgaric(src: THREE.BufferGeometry, n: number) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
  g.morphAttributes = src.morphAttributes;
  g.morphTargetsRelative = src.morphTargetsRelative;
  g.setIndex(src.index);
  // veil (1 an egg all white .. 0), rot, the red's depth, a seed
  g.setAttribute('iData', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
  return g;
}

/** the vertex shader: the morph blend per instance, then into the world as the procedural ones go */
export const agaricVertexShader = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
attribute float _part;
attribute vec2 uv1;
attribute vec4 iData;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vPart;
varying vec2 vUvf;
varying vec3 vTint;
varying vec2 vUv1;
varying vec4 vData;
void main() {
  #include <beginnormal_vertex>
  #include <morphinstance_vertex>
  #include <morphnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
  vPart = _part;
  vUvf = uv;
  vUv1 = uv1;
  vData = iData;
  // the red: from a deep scarlet to a red going orange, one to the next (a little, it stays a fly agaric)
  float orange = fract(iData.w * 7.31);
  vTint = vec3(0.7 + 0.04 * orange, 0.025 + 0.11 * orange * orange, 0.02 + 0.01 * orange) * iData.z;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
