// Fungi as models (model/*.py → public/*.glb), one kind at a time: each one mesh whose growth is morph targets
// over the grown one, drawn instanced, each fungus its own blend. Nothing is built while it grows: the page only
// sets a few weights per fungus. The kinds without a model yet are built ring by ring in fungi.ts.
//
// Every model has the same targets in the same order: egg, button, dome, wither (the stages, the basis the grown
// one, open), then round and upturn (the grown one's other caps, one or the other mixed in per fungus).
// `?procfungi` keeps all of them procedural, `?procagaric` (or any kind) just that one, to compare.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type ModelKind = 'agaric' | 'porcini';
/** each model's file and its own cap radius and height to the top of the cap, metres: each fungus is scaled from these */
export const MODELS: Record<ModelKind, { file: string; R: number; H: number }> = {
  agaric: { file: 'agaric.glb', R: 0.065, H: 0.165 },
  porcini: { file: 'porcini.glb', R: 0.065, H: 0.125 },
};
export const MODEL_KINDS = Object.keys(MODELS) as ModelKind[];
export const isModelKind = (k: string): k is ModelKind => k in MODELS;

const params = new URLSearchParams(location.search);
const procedural = (k: ModelKind) => params.has('procfungi') || params.has(`proc${k}`);

const loading = new Map<ModelKind, Promise<THREE.BufferGeometry | null>>();
/** A model's geometry, loaded once and shared (null if it could not be had: the procedural one stays). */
export function loadModel(kind: ModelKind) {
  if (procedural(kind)) return Promise.resolve(null);
  let p = loading.get(kind);
  if (!p) {
    p = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}${MODELS[kind].file}`).then((gltf) => {
      let geo: THREE.BufferGeometry | null = null;
      gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) geo = (o as THREE.Mesh).geometry; });
      return geo;
    }).catch((e) => { console.warn(MODELS[kind].file, e); return null; });
    loading.set(kind, p);
  }
  return p;
}
/** all of them, in */
export const loadModels = () => Promise.all(MODEL_KINDS.map(loadModel));

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * The weights for growth g (0..1) and withering rot (0..1), in the targets' order: egg, button, dome, wither,
 * round, upturn. Egg to button by a third of the way, button to dome by two thirds, dome to open at the end.
 * `shape` (-1..1) is this one's cap when grown: below zero a round dome, above it flattened and turned up at
 * the rim; mixed in as it opens.
 */
export function modelWeights(g: number, rot: number, shape: number, out: number[]) {
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
export function instancedModel(src: THREE.BufferGeometry, n: number) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
  g.morphAttributes = src.morphAttributes;
  g.morphTargetsRelative = src.morphTargetsRelative;
  g.setIndex(src.index);
  // how young (a fly agaric's veil, a bolete's white pores), rot, unused, a seed
  g.setAttribute('iData', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
  // its colour: a fly agaric's red, a bolete's brown
  g.setAttribute('iTint', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
  return g;
}

/** the vertex shader: the morph blend per instance, then into the world as the procedural ones go */
export const modelVertexShader = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
attribute float _part;
attribute vec2 uv1;
attribute vec4 iData;
attribute vec3 iTint;
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
  vTint = iTint;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
