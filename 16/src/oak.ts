// Old oaks in the clearings, after the open-grown reference: the Blender model (model/oak.py, public/oak.glb), its
// wood and its leaves in one mesh, instanced, a few, each turned and sized its own way. The shader draws both by
// part: the wood's bark from its coordinates in metres (deep furrows running up, the ridges between broken into
// blocks, grey-brown, moss low on the shaded side), the leaves' outline cut from their cards (red oak's: lobes with
// pointed tips, deep notches between), green to gold to rust from leaf to leaf, the sun through them from behind.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mossLighting } from './shaders';
import { clearing, groundHeight, trunkInCell, TREE_CELL } from './world';
import { mulberry32 } from './noise';

export const OAK_CELL = 36;
const CELL = OAK_CELL; // one oak at most to a cell this big, and only in a clearing
const RANGE = 70;
const MAX = 16;

export interface Oak { x: number; z: number; turn: number; s: number }

/** The oak in a cell, if any: where it is most open, away from the start. */
export function oakInCell(ix: number, iz: number): Oak | null {
  const r = mulberry32((Math.imul(ix, 0x2c1b3c6d) ^ Math.imul(iz, 0x297a2d39) ^ 0x0a4) >>> 0);
  if (r() > 0.55) return null;
  // the most open of a few spots in the cell
  let best: { x: number; z: number; o: number } | null = null;
  for (let k = 0; k < 14; k++) {
    const x = (ix + 0.15 + 0.7 * r()) * CELL, z = (iz + 0.15 + 0.7 * r()) * CELL;
    // (and no trunk within a few metres: the clearings are smaller than an oak's crown)
    const tix = Math.floor(x / TREE_CELL), tiz = Math.floor(z / TREE_CELL);
    let near = false;
    for (let dz = -1; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1 && !near; dx++) {
      const t = trunkInCell(tix + dx, tiz + dz);
      if (t && Math.hypot(t.x - x, t.z - z) < 3.6) near = true;
    }
    if (near) continue;
    const o = clearing(x, z);
    if (!best || o > best.o) best = { x, z, o };
  }
  if (!best || best.o < 0.55 || Math.hypot(best.x, best.z) < 12) return null;
  // big and stately: a bole two metres across and more, a crown thirty to forty metres wide, standing over the
  // wood (at the model's own size and less it was one tree among the others)
  return { x: best.x, z: best.z, turn: r() * Math.PI * 2, s: 1.3 + 0.3 * r() };
}

export class Oaks {
  readonly root = new THREE.Group();
  oaks: Oak[] = [];
  private mesh: THREE.InstancedMesh | null = null;
  private cellKey = '';
  changed = false;

  constructor(setup: (m: THREE.ShaderMaterial) => void) {
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, side: THREE.DoubleSide, uniforms: {} });
    setup(material);
    new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}oak.glb`).then((gltf) => {
      let geo: THREE.BufferGeometry | null = null;
      gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) geo = (o as THREE.Mesh).geometry; });
      if (!geo) return;
      this.mesh = new THREE.InstancedMesh(geo, material, MAX);
      this.mesh.count = 0;
      this.mesh.frustumCulled = false;
      this.root.add(this.mesh);
      this.cellKey = '';
    }).catch((e) => console.warn('oak.glb', e));
  }

  update(px: number, pz: number) {
    if (!this.mesh) return;
    const ix0 = Math.floor(px / CELL), iz0 = Math.floor(pz / CELL);
    const key = `${ix0},${iz0}`;
    if (key === this.cellKey) return;
    this.cellKey = key;
    const R = Math.ceil(RANGE / CELL);
    this.oaks = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const o = oakInCell(ix0 + dx, iz0 + dz);
      if (o && Math.hypot(o.x - px, o.z - pz) < RANGE && this.oaks.length < MAX) this.oaks.push(o);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    this.oaks.forEach((o, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.turn);
      s.setScalar(o.s);
      p.set(o.x, groundHeight(o.x, o.z) - 0.1, o.z);
      this.mesh!.setMatrixAt(i, m.compose(p, q, s));
    });
    this.mesh.count = this.oaks.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.changed = true;
  }

  /** The bole is solid. */
  collide(x: number, z: number, pad: number) {
    for (const o of this.oaks) {
      const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), min = 0.75 * o.s * 1.3 + pad;
      if (d < min && d > 1e-6) { x = o.x + (dx / d) * min; z = o.z + (dz / d) * min; }
    }
    return [x, z];
  }
}

const vertexShader = /* glsl */ `
attribute float _part;
attribute float _girth;
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vPart;
varying float vGirth;
varying float vScale;
varying float vFootY;
void main() {
  vec4 lp = instanceMatrix * vec4(position, 1.0);
  vec3 ln = mat3(instanceMatrix) * normal;
  float s = length(instanceMatrix[0].xyz);
  vec4 wp = modelMatrix * lp;
  // the leaves stir in the air, each its own way, more out at the tips of the crown
  if (_part > 2.5) {
    float ph = _girth * 40.0 + wp.x * 0.3 + wp.z * 0.2;
    wp.xyz += vec3(sin(uTime * 1.3 + ph), sin(uTime * 1.7 + ph * 1.3) * 0.6, cos(uTime * 1.1 + ph)) * 0.025 * uv.y;
  }
  vNormal = normalize(mat3(modelMatrix) * ln);
  vWorldPos = wp.xyz;
  vUv = uv;
  vPart = _part;
  vGirth = _girth;
  vScale = s;
  vFootY = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform vec3 uLightDir;
${mossLighting}
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vPart;
varying float vGirth;
varying float vScale;
varying float vFootY;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n21(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
// noise round the tube at k per metre: x in metres round, C the girth's circumference; the last tenth round
// crossfades into the first, so the seam closes
float nb(float k, vec2 b, float C, vec2 o) {
  return mix(n21(b * k + o), n21((b - vec2(C, 0.0)) * k + o), smoothstep(0.9, 1.0, vUv.x));
}
// oak bark, in metres: deep furrows running up the trunk a hand apart, wandering and joining; the ridges between
// broken across into blocks; its height (0 down in a furrow, 1 on a ridge) and its colour
float barkAt(vec2 b, float C, out vec3 col) {
  // the furrows: long, wandering, joining and parting, where a noise stretched far up the trunk crosses its middle
  // (shorter and straighter, with the cuts across all at one spacing, it read as a grid of tiles)
  float warp = nb(2.0, b * vec2(1.0, 0.3), C, vec2(0.0)) * 0.35 + nb(5.0, b * vec2(1.0, 0.5), C, vec2(4.0, 1.0)) * 0.12;
  float f = nb(7.0, b * vec2(1.0, 0.07) + vec2(warp, 0.0), C, vec2(3.0, 0.0));
  float ridge = smoothstep(0.08, 0.38, abs(f - 0.5) * 2.0);
  // each ridge cut across into blocks at its own spacing and offset, the cuts not quite level
  float id = floor(f * 5.0 + warp * 3.0);
  float sp = 2.5 + 3.5 * h21(vec2(id, 1.7));
  float cut = abs(fract(b.y * sp + h21(vec2(id, 4.1)) + nb(3.0, b, C, vec2(9.0, 2.0)) * 0.9) - 0.5) * 2.0;
  float block = ridge * smoothstep(0.04, 0.22, cut);
  float h = block * (0.75 + 0.25 * nb(25.0, b, C, vec2(1.0)));
  vec3 grey = mix(vec3(0.19, 0.17, 0.14), vec3(0.34, 0.32, 0.28), h21(vec2(id, floor(b.y * sp + h21(vec2(id, 4.1))))) * 0.6 + nb(6.0, b, C, vec2(5.0)) * 0.4);
  col = mix(vec3(0.04, 0.034, 0.028), grey, h);
  return h;
}
// a red oak's leaf: lobes with pointed tips, the notches between them deep; c across (-1..1), v along (0..1)
float leafEdge(float c, float v) {
  float env = pow(max(sin(3.14159 * min(1.0, v * 1.08)), 0.0), 0.7);
  float tri = 1.0 - abs(fract(v * 3.2 + 0.35) - 0.5) * 2.0; // 0 in a notch, 1 at a lobe's tip
  float hw = env * (0.32 + 0.68 * pow(tri, 1.6));
  hw = max(hw, 0.06 * step(v, 0.12)); // the stalk
  return abs(c) - hw;
}
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uLightDir);
  if (dot(N, V) < 0.0) N = -N;
  float shadow = shadowAt(vWorldPos, N);
  float sun = sunIn(shadow);
  vec3 c;
  if (vPart > 2.5) {
    if (leafEdge(vUv.x, vUv.y) > 0.0) discard;
    // green, olive, gold, orange and rust, leaf by leaf; the midrib and veins paler
    float k = vGirth;
    vec3 col = k < 0.25 ? mix(vec3(0.16, 0.22, 0.05), vec3(0.32, 0.32, 0.07), k / 0.25)
             : k < 0.6 ? mix(vec3(0.42, 0.33, 0.07), vec3(0.55, 0.3, 0.05), (k - 0.25) / 0.35)
             : mix(vec3(0.5, 0.22, 0.05), vec3(0.36, 0.1, 0.04), (k - 0.6) / 0.4);
    float rib = 1.0 - smoothstep(0.0, 0.04, abs(vUv.x));
    col = mix(col, col * 1.35 + 0.02, rib * 0.6);
    col *= 0.85 + 0.3 * n21(vUv * vec2(6.0, 9.0) + k * 17.0);
    float diff = max(dot(N, L), 0.0);
    // thin: the sun comes through from behind, gold
    float thru = pow(max(dot(-V, L), 0.0), 3.0);
    c = col * (0.22 * skyTint(N, 1.0) * mix(0.6, 1.0, sun) + 1.3 * diff * shadow) + col * vec3(1.6, 1.25, 0.6) * thru * shadow * 1.4;
    c += rimLight(N, V) * col * 1.2 * rimShade(shadow);
  } else {
    float C = 6.2831853 * max(vGirth, 0.004) * vScale;
    vec2 b = vec2(vUv.x * C, vUv.y * vScale);
    vec3 col;
    float h = barkAt(b, C, col);
    // the relief: the normal tipped by the height's slope on screen
    vec3 dp = dFdx(vWorldPos), dq = dFdy(vWorldPos);
    float dh1 = dFdx(h), dh2 = dFdy(h);
    vec3 grad = (cross(dq, N) * dh1 + cross(N, dp) * dh2) / max(dot(dp, cross(dq, N)), 1e-6);
    float fine = 1.0 - smoothstep(0.004, 0.02, length(fwidth(b)));
    N = normalize(N - grad * 0.012 * fine);
    // moss low on the shaded side of the bole, lichen grey-green patches up the limbs
    float side = 0.5 + 0.5 * dot(normalize(vec3(N.x, 0.0, N.z) + 1e-4), normalize(vec3(-L.x, 0.0, -L.z)));
    float low = 1.0 - smoothstep(0.5, 2.5, vWorldPos.y - vFootY);
    col = mix(col, vec3(0.12, 0.17, 0.05), side * low * (0.4 + 0.6 * h) * 0.8);
    col = mix(col, vec3(0.27, 0.29, 0.22), smoothstep(0.6, 0.75, n21(b * vec2(1.6, 0.8) + 7.0)) * 0.35 * (vPart > 0.5 ? 1.0 : 0.4));
    float diff = max(dot(N, L), 0.0);
    c = col * (mix(0.12, 0.3, sun) * skyTint(N, 1.0) + 1.4 * diff * shadow);
    c += rimLight(N, V) * col * 0.8 * rimShade(shadow);
  }
  gl_FragColor = vec4(tonemap(grade(c)), 1.0);
  #include <colorspace_fragment>
}
`;
