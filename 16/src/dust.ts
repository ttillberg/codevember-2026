// Dust in the air: specks hanging over the moss, drifting slowly, that only show where the sun comes through.
// Each takes the light the floor would at its place (the shadow map and the canopy's spots), so the beams
// between the leaves fill with glittering motes and the shade between them stays dark: the god rays get a body.
// Fine dust scatters forward, so they glow looking into the sun and are faint with it at your back.
//
// All on the GPU: a few hundred instanced quads, each a seed. Its place is the seed's spot in a box around the
// eye plus a slow wander, wrapped into the box, so the box goes where you go and nothing is ever updated.
// Drawn after the atmosphere pass like the spores, testing itself against the scene's depth.
import * as THREE from 'three';
import { mossLighting } from './shaders';

const coarse = matchMedia('(pointer: coarse)').matches;
const COUNT = coarse ? 500 : 1200;
const BOX = new THREE.Vector3(3.2, 0.9, 3.2); // how far round the eye there is dust (metres): wide, low, deep

/**
 * The same, as glowing motes (`motes: true`): far fewer, bigger (a few millimetres, pollen or spores lit
 * through), in a bigger box, rising slowly and twinkling, each a bright core in a soft halo; they show a little in
 * the shade too. The splash's gold orbs in the light.
 */
export interface DustOptions { count?: number; box?: THREE.Vector3; motes?: boolean }

export class Dust {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(setup: (m: THREE.ShaderMaterial) => void, opts: DustOptions = {}) {
    const COUNT = opts.count ?? (coarse ? 500 : 1200);
    const BOX = opts.box ?? new THREE.Vector3(3.2, 0.9, 3.2);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT * 4; i++) seed[i] = Math.random();
    g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.instanceCount = COUNT;
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      defines: opts.motes ? { MOTES: 1 } : {},
      uniforms: {
        uPx: { value: 800 },
        tDepth: { value: null as THREE.Texture | null },
        cameraNear: { value: 0.01 },
        cameraFar: { value: 80 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uBox: { value: BOX },
        uGround: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // added light; the target's alpha holds the scene's depth for the lens, so it is left alone
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    setup(this.material);
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
  }

  /** The ground under the eye: the dust hangs from it up, not from the eye. */
  update(ground: number) {
    this.material.uniforms.uGround.value = ground;
  }

  setSize(w: number, h: number, fovDeg: number) {
    this.material.uniforms.uPx.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.material.uniforms.uRes.value.set(w, h);
  }
}

const vertexShader = /* glsl */ `
attribute vec4 iSeed;
uniform float uPx, uTime, uGround;
uniform vec3 uBox;
varying vec2 vUv;
varying vec3 vCentre;
varying float vViewZ;
varying float vSize;
varying float vSeed;
varying float vSpread;
void main() {
  // a slow wander: a drift with the air, a little lift, and a curl of its own
  float t = uTime;
  #ifdef MOTES
  // motes rise, slowly, each at its own pace, and curl more
  vec3 wander = vec3(0.01, 0.02 + 0.025 * iSeed.y, -0.005) * t
    + 0.14 * vec3(sin(t * (0.13 + 0.1 * iSeed.w) + iSeed.x * 40.0), sin(t * (0.09 + 0.08 * iSeed.x) + iSeed.y * 40.0), cos(t * (0.11 + 0.1 * iSeed.y) + iSeed.z * 40.0));
  #else
  vec3 wander = vec3(0.012, 0.004, -0.006) * t
    + 0.05 * vec3(sin(t * (0.11 + 0.1 * iSeed.w) + iSeed.x * 40.0), sin(t * (0.07 + 0.08 * iSeed.x) + iSeed.y * 40.0), cos(t * (0.09 + 0.1 * iSeed.y) + iSeed.z * 40.0));
  #endif
  // wrapped into a box round the eye (from the ground up), so it goes with you
  vec3 origin = vec3(cameraPosition.x - uBox.x * 0.5, uGround, cameraPosition.z - uBox.z * 0.5);
  vec3 p = iSeed.xyz * uBox + wander;
  p = origin + mod(p - origin, uBox);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  // specks of half a millimetre to a millimetre and a half (a soft glow round each, as a mote in a beam
  // looks): kept to a couple of pixels far off
  #ifdef MOTES
  float r = mix(0.003, 0.009, iSeed.w * iSeed.w) * 2.5; // (the quad holds the halo too)
  r = max(r, 7.0 * dist / uPx);
  #else
  float r = mix(0.0005, 0.0015, iSeed.w * iSeed.w);
  r = max(r, 2.2 * dist / uPx);
  #endif
  // the ones right in front of the eye are far out of focus: soft discs of light, as motes in a beam are in a
  // photo (the lens pass blurs by the scene behind them, so they are blurred here, the light spread thinner)
  float bokeh = mix(1.0, 9.0, smoothstep(0.7, 0.12, dist));
  r *= bokeh;
  vSpread = 1.0 / (bokeh * bokeh) * mix(1.0, 6.0, smoothstep(1.0, 9.0, bokeh));
  mv.xy += position.xy * r;
  vUv = position.xy;
  vCentre = p;
  vViewZ = dist;
  vSize = r;
  vSeed = iSeed.w;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
#include <packing>
uniform sampler2D tDepth;
uniform float cameraNear, cameraFar;
uniform vec2 uRes;
uniform vec3 uLightDir;
${mossLighting}
varying vec2 vUv;
varying vec3 vCentre;
varying float vViewZ;
varying float vSize;
varying float vSeed;
varying float vSpread;
void main() {
  float d = length(vUv);
  if (d > 1.0 || vViewZ < 0.02) discard;
  float sceneZ = -perspectiveDepthToViewZ(texture2D(tDepth, gl_FragCoord.xy / uRes).x, cameraNear, cameraFar);
  if (sceneZ < vViewZ) discard;
  // brightest in the sun, the beams; in the shade only a faint glimmer (near the ground the low sun leaves
  // most of the air in shadow, and lit only there the dust was all but gone)
  float sun = shadowAt(vCentre, vec3(0.0, 1.0, 0.0));
  float lit = clamp((sun - uShadowFloor) / max(1.0 - uShadowFloor, 1e-3), 0.0, 1.0);
  vec3 V = normalize(cameraPosition - vCentre);
  vec3 L = normalize(uLightDir);
  float fwd = pow(max(dot(-V, L), 0.0), 4.0);
  // a speck tumbles, catching the light now and then
  float glint = 0.45 + 0.55 * sin(uTime * (1.5 + 3.0 * vSeed) + vSeed * 60.0);
  // fading in from the eye (nothing in your face) and out into the haze
  #ifdef MOTES
  // a bright core in a soft halo; out of focus close up, a disc; twinkling slowly; in the shade still a glimmer
  float fade = smoothstep(0.45, 1.0, vViewZ) * exp(-vViewZ * 0.16); // (none right before the lens: a big blurred disc)
  float core = exp(-d * d * 9.0), halo = exp(-d * d * 2.5) * (1.0 - smoothstep(0.7, 1.0, d));
  float shape = vSpread < 0.9 ? (1.0 - smoothstep(0.82, 1.0, d)) * 0.9 : core + 0.35 * halo;
  float tw = 0.55 + 0.45 * sin(uTime * (0.6 + 1.2 * vSeed) + vSeed * 80.0);
  float a = shape * min(vSpread, 1.0) * (0.35 + 0.65 * lit) * (0.5 + 1.2 * fwd) * tw * fade;
  gl_FragColor = vec4(vec3(1.0, 0.82, 0.48) * a * 4.0, 0.0);
  #else
  float fade = smoothstep(0.05, 0.12, vViewZ) * exp(-vViewZ * 0.45);
  // a speck a soft dot; a disc flat with a slightly brighter rim, as out-of-focus light is
  float shape = vSpread < 0.9 ? (1.0 - smoothstep(0.82, 1.0, d)) * (0.8 + 0.25 * smoothstep(0.5, 0.95, d)) : 1.0 - smoothstep(0.0, 1.0, d);
  float a = shape * vSpread * (0.3 + 0.7 * lit) * (0.3 + 1.6 * fwd) * glint * fade;
  gl_FragColor = vec4(vec3(1.0, 0.8, 0.5) * a * 5.0, 0.0);
  #endif
}
`;
