// Rainwater puddles pooled in shallow hollows of the moss carpet. One instanced mesh draws every puddle in
// range (1 draw call, zero shadow-pass cost, no extra render passes). Reflections reuse the existing overhead
// canopy map (foliage.ts) and sun shadow map so the water mirrors the real crowns, sky gaps and sunbeams above.
import * as THREE from 'three';
import { mossLighting } from './shaders';
import { PUDDLE_CELL, puddleInCell, type Puddle } from './world';

const coarse = matchMedia('(pointer: coarse)').matches;
const RANGE = coarse ? 9 : 16;
const MAX = coarse ? 16 : 32;
const RIPPLES = 4;

/** Unit organic-ready disc: uv.x = normalised radius (0..1.06, tucked under the mossy bank), uv.y = angle. */
function discGeometry(segs: number, rings: number) {
  const radii = [0.28, 0.58, 0.85, 1.06].slice(0, rings);
  if (rings === 3) { radii[0] = 0.36; radii[1] = 0.74; radii[2] = 1.06; }
  const pos: number[] = [0, 0, 0];
  const uv: number[] = [0, 0];
  const idx: number[] = [];
  for (let r = 0; r < radii.length; r++) {
    const rad = radii[r];
    for (let s = 0; s < segs; s++) {
      const th = (s / segs) * Math.PI * 2;
      pos.push(Math.cos(th) * rad, 0, Math.sin(th) * rad);
      uv.push(rad, th);
    }
  }
  // centre fan
  for (let s = 0; s < segs; s++) {
    const a = 1 + s, b = 1 + ((s + 1) % segs);
    idx.push(0, b, a);
  }
  // concentric rings
  for (let r = 0; r < radii.length - 1; r++) {
    const r0 = 1 + r * segs, r1 = 1 + (r + 1) * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      const a = r0 + s, b = r0 + s1, c = r1 + s, d = r1 + s1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class Puddles {
  readonly root = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  list: Puddle[] = [];
  private iSize: THREE.InstancedBufferAttribute;
  private iHarm: THREE.InstancedBufferAttribute;
  private iHarm2: THREE.InstancedBufferAttribute;
  private cellKey = '';
  private ripples: THREE.Vector4[];
  private rippleIdx = 0;

  constructor(setup: (m: THREE.ShaderMaterial) => void) {
    const geo = discGeometry(coarse ? 20 : 32, coarse ? 3 : 4);
    this.iSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.iHarm = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.iHarm2 = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
    geo.setAttribute('iSize', this.iSize);
    geo.setAttribute('iHarm', this.iHarm);
    geo.setAttribute('iHarm2', this.iHarm2);

    this.ripples = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0));
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      defines: { COARSE: coarse ? 1 : 0 },
      uniforms: {
        uRipples: { value: this.ripples },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    setup(this.material);

    this.mesh = new THREE.InstancedMesh(geo, this.material, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1; // after opaque ground & moss, before dew beads
    this.root.add(this.mesh);
  }

  /** Send a small expanding ring across any puddle near (x, z) (footstep, hop or spore drop). */
  splash(x: number, z: number, time: number, strength = 1) {
    this.ripples[this.rippleIdx].set(x, z, time, strength);
    this.rippleIdx = (this.rippleIdx + 1) % RIPPLES;
  }

  /** Repack nearby puddles only when the walker crosses into a new coarse cell. */
  update(px: number, pz: number) {
    const c0 = Math.floor(px / PUDDLE_CELL), k0 = Math.floor(pz / PUDDLE_CELL);
    const key = `${c0},${k0}`;
    if (key === this.cellKey) return;
    this.cellKey = key;

    const R = Math.ceil(RANGE / PUDDLE_CELL);
    const found: { p: Puddle; d: number }[] = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const p = puddleInCell(c0 + dx, k0 + dz);
      if (!p) continue;
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d > RANGE + Math.max(p.rx, p.rz) * 1.4) continue;
      found.push({ p, d });
    }
    found.sort((a, b) => a.d - b.d);

    const n = Math.min(found.length, MAX);
    const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1);
    const sz = this.iSize.array as Float32Array;
    const h1 = this.iHarm.array as Float32Array;
    const h2 = this.iHarm2.array as Float32Array;
    this.list = [];
    for (let i = 0; i < n; i++) {
      const p = found[i].p;
      this.list.push(p);
      pos.set(p.x, p.y, p.z);
      q.setFromEuler(e.set(0, p.rot, 0));
      mat.compose(pos, q, scl);
      this.mesh.setMatrixAt(i, mat);
      sz[i * 4] = p.rx; sz[i * 4 + 1] = p.rz; sz[i * 4 + 2] = p.depth; sz[i * 4 + 3] = (p.seed % 1000) * 0.01;
      h1[i * 4] = p.a2; h1[i * 4 + 1] = p.p2; h1[i * 4 + 2] = p.a3; h1[i * 4 + 3] = p.p3;
      h2[i * 2] = p.a4; h2[i * 2 + 1] = p.p4;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.iSize.needsUpdate = true;
    this.iHarm.needsUpdate = true;
    this.iHarm2.needsUpdate = true;
  }
}

const vertexShader = /* glsl */ `
attribute vec4 iSize;  // rx, rz, depth, seed
attribute vec4 iHarm;  // a2, p2, a3, p3
attribute vec2 iHarm2; // a4, p4
varying vec3 vWorldPos;
varying float vU;
varying float vDepth;
varying float vSeed;

void main() {
  float r = uv.x;
  float th = uv.y;
  float wob = 1.0 + iHarm.x * cos(2.0 * th + iHarm.y) + iHarm.z * cos(3.0 * th + iHarm.w) + iHarm2.x * cos(4.0 * th + iHarm2.y);
  vec3 local = vec3(cos(th) * r * wob * iSize.x, 0.0, sin(th) * r * wob * iSize.y);
  vec4 wp = modelMatrix * instanceMatrix * vec4(local, 1.0);
  vWorldPos = wp.xyz;
  vU = r;
  vDepth = max(0.0, 1.0 - r * r) * iSize.z;
  vSeed = iSize.w;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform vec3 uLightDir;
uniform vec4 uRipples[4];
${mossLighting}

varying vec3 vWorldPos;
varying float vU;
varying float vDepth;
varying float vSeed;

void main() {
  DEPTH_ONLY
  // break up the shoreline at moss-tuft scale so no terrain grid segment reads straight
  float shoreNoise = (cNoise(vWorldPos.xz * 11.0) - 0.5) * 0.045;
  float edge = smoothstep(0.0, 0.011, vDepth) * smoothstep(1.01, 0.87, vU + shoreNoise);
  if (edge < 0.005) discard;

  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vWorldPos);

  // gentle wind micro-ripples, calmer right next to the sheltered mossy shore
  float calm = smoothstep(1.0, 0.55, vU);
  vec2 p = vWorldPos.xz;
  float t = uTime;
  float e = 0.022;
  vec2 w1 = p * 8.5 + vec2(t * 0.42, -t * 0.28);
  float h0 = cNoise(w1);
  vec2 grad = vec2(cNoise(w1 + vec2(e * 8.5, 0.0)) - h0, cNoise(w1 + vec2(0.0, e * 8.5)) - h0) * 0.018;
  #if !COARSE
  vec2 w2 = p * 23.0 + vec2(-t * 0.58, t * 0.39);
  float h2 = cNoise(w2);
  grad += vec2(cNoise(w2 + vec2(e * 23.0, 0.0)) - h2, cNoise(w2 + vec2(0.0, e * 23.0)) - h2) * 0.009;
  #endif
  grad *= calm;

  // expanding capillary rings from footsteps or landed spores
  for (int i = 0; i < 4; i++) {
    vec4 rp = uRipples[i];
    float age = t - rp.z;
    if (age <= 0.0 || age > 3.0 || rp.w <= 0.0) continue;
    vec2 dv = p - rp.xy;
    float d = length(dv);
    float ring = d - age * 0.36;
    float env = exp(-ring * ring * 65.0) * exp(-age * 1.4) * exp(-d * 2.2) * rp.w;
    if (env > 0.002 && d > 0.002) {
      grad += (dv / d) * cos(ring * 52.0) * env * 0.075;
    }
  }

  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.02);

  // reflected forest sky calibrated to post.ts: quiet misty woodland brightness, never brighter than the real sky
  float sunDot = max(dot(R, L), 0.0);
  float morning = smoothstep(0.15, 0.7, L.y);
  vec3 zenith = mix(vec3(0.10, 0.14, 0.20), vec3(0.16, 0.22, 0.27), morning);
  vec3 horizon = mix(vec3(0.13, 0.10, 0.055), vec3(0.18, 0.16, 0.115), morning);
  vec3 skyCol = mix(horizon, zenith, smoothstep(0.06, 0.6, R.y));
  skyCol += vec3(0.62, 0.44, 0.19) * pow(sunDot, 12.0) * 0.65;

  // sample the real overhead canopy map along the reflected ray so spruce/birch crowns mirror cleanly
  vec2 g = (vWorldPos.xz + 9.5 * R.xz / max(R.y, 0.16) - uCanopyBox.xy) / uCanopyBox.z;
  float open = (g.x > 0.0 && g.y > 0.0 && g.x < 1.0 && g.y < 1.0) ? texture2D(uCanopyMap, g).r : 0.55;
  vec2 rq = vWorldPos.xz * 0.4 + R.xz / max(R.y, 0.16) * 2.1;
  vec2 sway = vec2(sin(t * 0.35), cos(t * 0.27)) * 0.04;
  float lace = cNoise(rq * 2.8 + sway) * 0.55 + cNoise(rq * 8.2 - sway * 1.6) * 0.3 + cNoise(rq * 21.0 + sway * 2.2) * 0.15;
  float skyGap = smoothstep(0.40, 0.62, mix(0.55, open, min(uCanopyAmt, 1.0)) * 0.65 + lace * 0.55 - 0.12);

  // deep woodland green-brown reflected boughs contrasting with the pale misty sky openings
  vec3 canopyCol = vec3(0.008, 0.016, 0.007) + vec3(0.045, 0.032, 0.012) * pow(sunDot, 3.0);
  vec3 refl = mix(canopyCol, skyCol, skyGap);

  // low grazing angles reflect distant dark vertical trunks breaking up the horizon glow
  float ang = atan(R.z, R.x);
  float trunks = smoothstep(0.55, 0.72, cNoise(vec2(ang * 6.5 + vSeed, vSeed * 3.1)));
  refl = mix(refl, vec3(0.009, 0.008, 0.005), trunks * smoothstep(0.32, 0.04, R.y) * 0.72);

  // local shadow dims the water bed and gates tight sun sparkles without creating harsh halo bands on the mirror
  float shadow = shadowAt(vWorldPos, vec3(0.0, 1.0, 0.0));
  float lit = sunIn(shadow);
  vec3 H = normalize(L + V);
  float ndh = max(dot(N, H), 0.0);
  refl += vec3(1.1, 0.84, 0.45) * pow(ndh, 420.0) * 5.0 * lit;

  // true water Schlick Fresnel (IOR 1.333, F0 = 0.02, power 5) + shallow tannin-peat absorption
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  float absorb = (1.0 - exp(-vDepth * 26.0)) * 0.66;
  vec3 body = vec3(0.006, 0.005, 0.0025) * (0.4 * skyTint(vec3(0.0, 1.0, 0.0), 1.0) + 1.0 * lit);

  // single ACES tonemap on the un-premultiplied surface radiance, then premultiply for blending
  float a0 = 1.0 - (1.0 - absorb) * (1.0 - fres);
  vec3 surfCol = (body * absorb * (1.0 - fres) + refl * fres) / max(a0, 1e-3);
  float a = a0 * edge;
  gl_FragColor = vec4(tonemap(grade(surfCol)) * a, a);
  #include <colorspace_fragment>
}
`;
