// Spores are far too fine to see one by one: a pinch of them is smoke. A thrown pinch leaves a faint arc of
// smoke hanging in the air behind it and bursts where it lands in a small explosion of spores; what is left of
// the cloud settles into a pale band lying over the moss, drifting, slowly lifting and fading, so for a while
// you can still see where it went.
//
// Two kinds of particle on one instanced quad: puffs, soft blobs with moving wisps inside that swell as they
// spread, and motes, a haze of specks too small to make out that only shows where the light catches them.
// Drawn after the atmosphere pass, into the finished image, with their own lighter haze, so the column still
// shows against a far, misty background; they test themselves against the scene's depth (soft particles), so
// they go behind ferns and trunks and fade softly where they meet the moss.
import * as THREE from 'three';
import { mossLighting } from './shaders';

const MAX = 9000;
// a phone draws a little over half the particles: the soft puffs are big on screen near you, and their overdraw
// slowed it for as long as the smoke lingered
const Q = matchMedia('(pointer: coarse)').matches ? 0.5 : 1;

interface Shot { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; peak: number; onLand: (p: THREE.Vector3) => void }

export class Spores {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private span = new Float32Array(MAX);
  private grow = new Float32Array(MAX); // final size over start size
  private size0 = new Float32Array(MAX);
  private lift = new Float32Array(MAX); // upward pull: the band lifts, slowly
  private str = new Float32Array(MAX); // how dense
  private iPos: THREE.InstancedBufferAttribute;
  private iData: THREE.InstancedBufferAttribute; // size, alpha, kind (0 puff, 1 mote, 2 band), seed
  private next = 0;
  private shots: Shot[] = [];

  constructor(setup: (m: THREE.ShaderMaterial) => void, depth: THREE.DepthTexture | null = null) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.iData = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    g.setAttribute('iPos', this.iPos);
    g.setAttribute('iData', this.iData);
    g.instanceCount = MAX;
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uPx: { value: 800 },
        tDepth: { value: depth },
        cameraNear: { value: 0.01 },
        cameraFar: { value: 80 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uHazeCol: { value: new THREE.Color(0.11, 0.085, 0.05) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // premultiplied colour; the target's alpha holds the scene's depth for the lens, so it is left alone
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    setup(this.material);
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
  }

  private emit(p: THREE.Vector3, vx: number, vy: number, vz: number, life: number, size: number, kind: number, grow = 1, lift = 0, str = 1) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = this.span[i] = life;
    this.size0[i] = size;
    this.grow[i] = grow;
    this.lift[i] = lift;
    this.str[i] = str;
    const d = this.iData.array as Float32Array;
    d[i * 4] = size; d[i * 4 + 1] = 0; d[i * 4 + 2] = kind; d[i * 4 + 3] = Math.random();
  }

  /** Throw a pinch of spores from `from` to `to` along an arc; `onLand` gets the landing point. */
  throw(from: THREE.Vector3, to: THREE.Vector3, onLand: (p: THREE.Vector3) => void) {
    const d = from.distanceTo(to);
    this.shots.push({ from: from.clone(), to: to.clone(), t: 0, dur: 0.36 + d * 0.22, peak: 0.1 + d * 0.19, onLand });
  }

  private burst(p: THREE.Vector3) {
    const tmp0 = new THREE.Vector3();
    const q = p.clone();
    q.y += 0.015;
    const r = Math.random;
    // a small explosion: puffs thrown out and up fast, slowing, swelling into a low dome of smoke
    for (let k = 0; k < 110 * Q; k++) {
      const a = r() * Math.PI * 2, up = r(), sp = 0.12 + r() * 0.45;
      this.emit(q, Math.cos(a) * sp * (1 - 0.6 * up), 0.05 + up * 0.45, Math.sin(a) * sp * (1 - 0.6 * up), 2 + r() * 2.5, 0.012 + r() * 0.014, 0, 3 + r() * 4, 0.02, 1.2);
    }
    // the spores themselves, flung out with it: a glitter through the cloud
    for (let k = 0; k < 1600 * Q; k++) {
      const a = r() * Math.PI * 2, up = r(), sp = r() * 0.6;
      this.emit(q, Math.cos(a) * sp, 0.05 + up * 0.5, Math.sin(a) * sp, 1.5 + r() * 3, 0.0006 + r() * 0.0008, 1);
    }
    // what is left: a pale band of smoke lying low over the moss, wide and flat, that drifts off, lifts a
    // little and fades away. It fades in as the burst clears.
    const along = r() * Math.PI;
    for (let k = 0; k < 46 * Q; k++) {
      // an elongated patch, longer one way than the other
      const u = (r() - 0.5) * 2, v = (r() - 0.5) * 2;
      const x = q.x + Math.cos(along) * u * 0.28 - Math.sin(along) * v * 0.08;
      const z = q.z + Math.sin(along) * u * 0.28 + Math.cos(along) * v * 0.08;
      tmp0.set(x, q.y + 0.03 + r() * 0.07 * (1 - Math.abs(u) * 0.5), z);
      this.emit(tmp0, (r() - 0.5) * 0.01, 0.005 + r() * 0.01, (r() - 0.5) * 0.01, 15 + r() * 10, 0.02 + r() * 0.02, 2, 2 + r() * 1.5, 0.006, 0.55);
    }
  }

  /** A pinch sown: no throw, a soft cloud let go over the moss's top (`p`), rising a little and settling. It is
   * there at once: puffs that start near full size (the burst's start small and swell, which read as a second's
   * wait with no arc before them), and no slow band fading in. */
  sow(p: THREE.Vector3) {
    const r = Math.random;
    const q = p.clone();
    for (let k = 0; k < 40 * Q; k++) {
      const a = r() * Math.PI * 2, sp = 0.02 + r() * 0.08;
      this.emit(q, Math.cos(a) * sp, 0.01 + r() * 0.08, Math.sin(a) * sp, 2.5 + r() * 2.5, 0.026 + r() * 0.018, 0, 1.4 + r() * 0.6, 0.01, 1.0);
    }
    for (let k = 0; k < 700 * Q; k++) {
      const a = r() * Math.PI * 2, sp = r() * 0.15;
      this.emit(q, Math.cos(a) * sp, -0.05 + r() * 0.15, Math.sin(a) * sp, 1.5 + r() * 2.5, 0.0006 + r() * 0.0006, 1);
    }
    // what is left lying on the moss: a few wide, faint puffs that linger and drift
    const tmp0 = new THREE.Vector3();
    for (let k = 0; k < 12 * Q; k++) {
      tmp0.set(p.x + (r() - 0.5) * 0.16, p.y - 0.01 + r() * 0.03, p.z + (r() - 0.5) * 0.16);
      this.emit(tmp0, (r() - 0.5) * 0.008, 0.003, (r() - 0.5) * 0.008, 7 + r() * 5, 0.03 + r() * 0.015, 0, 1.4 + r() * 0.5, 0.004, 0.45);
    }
  }

  /** A puffball pressed: a jet of spore smoke out of its pore, up and over, settling around it. */
  puff(p: THREE.Vector3) {
    const r = Math.random;
    for (let k = 0; k < 50 * Q; k++) {
      const a = r() * Math.PI * 2, sp = r() * 0.06;
      this.emit(p, Math.cos(a) * sp, 0.12 + r() * 0.28, Math.sin(a) * sp, 2 + r() * 2.5, 0.006 + r() * 0.008, 0, 3 + r() * 4, 0.01, 1.2);
    }
    for (let k = 0; k < 600 * Q; k++) {
      const a = r() * Math.PI * 2, sp = r() * 0.1;
      this.emit(p, Math.cos(a) * sp, 0.1 + r() * 0.35, Math.sin(a) * sp, 1.5 + r() * 2.5, 0.0006 + r() * 0.0006, 1);
    }
    const tmp0 = new THREE.Vector3();
    for (let k = 0; k < 14 * Q; k++) {
      tmp0.set(p.x + (r() - 0.5) * 0.12, p.y - 0.02 + r() * 0.03, p.z + (r() - 0.5) * 0.12);
      this.emit(tmp0, (r() - 0.5) * 0.01, 0.004, (r() - 0.5) * 0.01, 10 + r() * 8, 0.015 + r() * 0.012, 2, 2 + r(), 0.005, 0.4);
    }
  }

  update(dt: number, time: number) {
    const tmp = new THREE.Vector3();
    const r = Math.random;
    for (let s = this.shots.length - 1; s >= 0; s--) {
      const sh = this.shots[s];
      const t0 = Math.min(sh.t, 1);
      sh.t += dt / sh.dur;
      const t1 = Math.min(sh.t, 1);
      // the arc: a continuous wisp of spore smoke hanging in the air behind the flying pinch, plus glittering
      // motes shed off the leading cloud so the trajectory reads clearly from the slingshot to landing
      const nPuff = Math.max(4, Math.round(9 * Q));
      for (let k = 0; k < nPuff; k++) {
        const t = t0 + (t1 - t0) * (k + r()) / nPuff;
        tmp.lerpVectors(sh.from, sh.to, t);
        tmp.y += sh.peak * 4 * t * (1 - t);
        this.emit(tmp, (r() - 0.5) * 0.014, (r() - 0.55) * 0.012, (r() - 0.5) * 0.014, 2.4 + r() * 1.6, 0.011 + r() * 0.007, 0, 2.2 + r() * 1.8, 0.002, 2.1);
      }
      // leading spore motes shedding off the pinch in flight
      const nMote = Math.max(6, Math.round(20 * Q));
      for (let k = 0; k < nMote; k++) {
        const t = t0 + (t1 - t0) * r();
        tmp.lerpVectors(sh.from, sh.to, t);
        tmp.y += sh.peak * 4 * t * (1 - t);
        this.emit(tmp, (r() - 0.5) * 0.05, (r() - 0.4) * 0.05, (r() - 0.5) * 0.05, 0.9 + r() * 1.1, 0.0008 + r() * 0.0008, 1, 1, 0, 1.4);
      }
      if (sh.t >= 1) {
        this.burst(sh.to);
        sh.onLand(sh.to);
        this.shots.splice(s, 1);
      }
    }
    const drag = Math.exp(-dt * 2.2);
    const d = this.iData.array as Float32Array;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { d[i * 4 + 1] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      const x = this.pos[k], y = this.pos[k + 1], z = this.pos[k + 2];
      // the air: a slow swirl that varies over space, so the smoke curls instead of spreading evenly,
      // a faint drift with the light breeze, and drag
      const sx = Math.sin(y * 9 + time * 0.6 + z * 11), sz = Math.cos(x * 8 - time * 0.5 + y * 7), sy = Math.sin(x * 17 + z * 21 + time * 0.4);
      this.vel[k] = this.vel[k] * drag + (sx * 0.03 + 0.008) * dt;
      this.vel[k + 1] = this.vel[k + 1] * drag + (this.lift[i] + 0.004 + sy * 0.012) * dt;
      this.vel[k + 2] = this.vel[k + 2] * drag + (sz * 0.03 - 0.004) * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      // clamped: a particle dying this frame has life below zero, and Math.pow of a negative number is NaN.
      // A NaN alpha is skipped by desktop GPUs but drawn as an opaque black disc on iPhones.
      const f = Math.max(0, this.life[i] / this.span[i]); // 1 new .. 0 gone
      const age = 1 - f;
      d[i * 4] = this.size0[i] * (1 + (this.grow[i] - 1) * (1 - Math.pow(1 - age, 2)));
      // the band comes in slowly as the burst clears, and goes out very slowly
      const band = d[i * 4 + 2] > 1.5;
      d[i * 4 + 1] = (band ? THREE.MathUtils.smoothstep(age, 0.02, 0.15) * f : Math.min(1, age * 35) * Math.pow(f, 1.3)) * this.str[i];
    }
    this.iPos.needsUpdate = true;
    this.iData.needsUpdate = true;
  }

  setSize(w: number, h: number, fovDeg: number) {
    this.material.uniforms.uPx.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.material.uniforms.uRes.value.set(w, h);
  }
}

const vertexShader = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iData; // size, alpha, kind, seed
uniform float uPx;
varying vec2 vUv;
varying vec3 vCentre;
varying float vAlpha;
varying float vKind;
varying float vSeed;
varying float vViewZ;
varying float vSize;
void main() {
  if (iData.y <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float dist = -mv.z;
  float r = iData.x;
  // motes are specks: kept to about a pixel, fading instead of shrinking below it
  float minR = 0.7 * dist / uPx;
  float fade = iData.z > 0.5 ? clamp(r / minR, 0.0, 1.0) : 1.0;
  r = max(r, minR);
  // band smoke is flattened: wide and low
  mv.xy += position.xy * r * (iData.z > 1.5 ? vec2(2.6, 0.7) : vec2(1.0));
  vUv = position.xy;
  vCentre = iPos;
  vAlpha = iData.y * fade;
  vKind = iData.z;
  vSeed = iData.w;
  vViewZ = dist;
  vSize = r;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
#include <packing>
uniform vec3 uLightDir;
uniform sampler2D tDepth;
uniform float cameraNear, cameraFar;
uniform vec2 uRes;
uniform vec3 uHazeCol;
${mossLighting}
varying vec2 vUv;
varying vec3 vCentre;
varying float vAlpha;
varying float vKind;
varying float vSeed;
varying float vViewZ;
varying float vSize;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n21(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float d = length(vUv);
  if (d > 1.0) discard;
  // soft particles: behind something solid, gone; meeting it, fading over about the puff's own size
  float sceneZ = -perspectiveDepthToViewZ(texture2D(tDepth, gl_FragCoord.xy / uRes).x, cameraNear, cameraFar);
  float soft = clamp((sceneZ - vViewZ) / max(vSize, 0.004), 0.0, 1.0);
  if (soft <= 0.0) discard;
  vec3 V = normalize(cameraPosition - vCentre);
  vec3 L = normalize(uLightDir);
  // fine dust scatters forward: pale from the side, glowing gold looking into the sun
  float fwd = pow(max(dot(-V, L), 0.0), 5.0);
  float light = 0.6 + 2.2 * fwd;
  float dens;
  if (vKind < 0.5 || vKind > 1.5) {
    // a puff: soft edge, wisps inside that turn slowly
    float a = vSeed * 6.28 + uTime * 0.15;
    mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 q = R * vUv * 1.6 + vSeed * 17.0;
    float w = n21(q * 1.3) * 0.55 + n21(q * 3.1 + uTime * 0.1) * 0.3 + n21(q * 7.0) * 0.15;
    // (1 - smoothstep(lo, hi)), never smoothstep(hi, lo): reversed edges are undefined in GLSL
    dens = (1.0 - smoothstep(0.1, 1.0, d)) * smoothstep(0.25, 0.85, w) * 0.16;
  } else {
    dens = (1.0 - smoothstep(0.3, 1.0, d)) * 0.3; // too fine to make out one by one: a faint glitter
    light *= 1.4;
  }
  // nothing big and soft right in front of the eye; and a lighter haze of its own than the scene's,
  // so the column still shows a good way off
  float near = smoothstep(0.06, 0.3, vViewZ);
  float haze = 1.0 - exp(-max(vViewZ - 1.0, 0.0) * 0.12);
  float a = dens * vAlpha * soft * near * (1.0 - 0.6 * haze);
  if (a < 0.002) discard;
  vec3 col = mix(vec3(0.85, 0.74, 0.58), vec3(1.0, 0.72, 0.36), clamp(fwd * 2.0, 0.0, 1.0)) * light;
  col = tonemap(grade(col));
  // pale dust with green in it, more in some grains than others (moss spores and all); after the tone map,
  // since a dense cloud is bright enough there to go white whatever its colour
  col *= mix(vec3(1.0), vec3(0.78, 1.0, 0.68), 0.3 + 0.6 * fract(vSeed * 7.13));
  col = mix(col, uHazeCol * 3.0, haze * 0.5);
  gl_FragColor = vec4(col * a, a);
}
`;
