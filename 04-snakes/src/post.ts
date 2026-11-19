// After the render: a macro lens's shallow depth of field, then the grade.
// The scene is drawn into a multisampled float target with its depth. Depth of field gathers round
// each pixel on a golden-angle spiral, out to its circle of confusion (thin lens: it grows with how far
// a point is from the focus, in dioptres); a sample only counts where its own circle reaches this
// pixel, and one behind a sharp pixel only as far as this pixel's own circle, so nothing blurs over
// what is in focus. The focus is pulled by hand: it follows what is in the middle of the screen,
// a little late. Then tone mapping and sRGB, and the grade on the display values: a soft S curve,
// cool shadows and warm highlights, a touch more colour, a lifted black, a vignette, fine grain.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/** knobs: aperture (bigger, shallower), the largest blur in pixels at 1000 px tall, the grade's strength */
export const LOOK = { aperture: 0.011, maxBlur: 13, grade: 1, grain: 0.022, vignette: 0.38 };

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOF = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uNear, uFar, uFocus, uAperture, uMaxR;
varying vec2 vUv;
float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - d * (uFar - uNear));
}
float coc(float z) { return min(uAperture * abs(1.0 / uFocus - 1.0 / z) * uRes.y, uMaxR); }
void main() {
  vec3 c0 = texture2D(tColor, vUv).rgb;
  float z0 = viewZ(vUv);
  float r0 = coc(z0);
  vec3 sum = c0;
  float wsum = 1.0;
  const int N = 48;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N);
    float r = sqrt(t) * uMaxR;
    float a = float(i) * 2.39996323;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
    float z = viewZ(uv);
    float rs = coc(z);
    // behind this pixel: it can't blur over it further than this pixel's own blur
    if (z > z0) rs = min(rs, r0);
    float w = smoothstep(r - 1.0, r + 1.0, rs);
    sum += texture2D(tColor, uv).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, 1.0);
}`;

const GRADE = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uTime, uGrade, uGrain, uVignette, uExposure;
varying vec2 vUv;
// Khronos PBR neutral, as three has it, and the sRGB curve: written out here, under names of their
// own, since three adds its own copies to a ShaderMaterial on some paths and not others
vec3 neutral(vec3 color) {
  color *= uExposure;
  const float start = 0.76;
  const float desat = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < start) return color;
  float d = 1.0 - start;
  float newPeak = 1.0 - d * d / (peak + d - start);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desat * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
vec3 toSRGB(vec3 c) {
  return mix(pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 c = clamp(toSRGB(max(neutral(texture2D(tDiffuse, vUv).rgb), 0.0)), 0.0, 1.0);
  vec3 g = c;
  // a soft S curve
  g = mix(g, g * g * (3.0 - 2.0 * g), 0.28);
  float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
  // cool shadows, warm highlights
  g += vec3(-0.018, 0.004, 0.03) * (1.0 - smoothstep(0.0, 0.5, l));
  g += vec3(0.035, 0.014, -0.028) * smoothstep(0.45, 1.0, l);
  // a little more colour, a lifted black
  g = mix(vec3(l), g, 1.08);
  g = g * 0.975 + 0.012;
  c = mix(c, g, uGrade);
  // vignette
  vec2 q = vUv - 0.5;
  q.x *= uRes.x / uRes.y;
  c *= 1.0 - uVignette * smoothstep(0.3, 1.0, length(q) * 1.2);
  // grain, finer in the lights
  c += (hash(vUv * uRes + fract(uTime * 7.31) * 913.0) - 0.5) * uGrain * (1.2 - l);
  gl_FragColor = vec4(c, 1.0);
}`;

export function createPost(renderer: THREE.WebGLRenderer) {
  const make = (samples: number) => {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    return rt;
  };
  const scene = make(4);
  scene.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
  const blurred = make(0);

  const dof = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: scene.texture }, tDepth: { value: scene.depthTexture },
      uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.01 }, uFar: { value: 20 },
      uFocus: { value: 0.35 }, uAperture: { value: LOOK.aperture }, uMaxR: { value: 10 },
    },
    vertexShader: VERT, fragmentShader: DOF, depthTest: false, depthWrite: false,
  }));
  const grade = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: blurred.texture }, uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 }, uGrade: { value: LOOK.grade }, uGrain: { value: LOOK.grain }, uVignette: { value: LOOK.vignette },
      uExposure: { value: 1 },
    },
    vertexShader: VERT, fragmentShader: GRADE, depthTest: false, depthWrite: false,
  }));

  return {
    setSize(w: number, h: number) {
      const pr = renderer.getPixelRatio();
      const W = Math.round(w * pr), H = Math.round(h * pr);
      scene.setSize(W, H);
      blurred.setSize(W, H);
      const m1 = dof.material as THREE.ShaderMaterial, m2 = grade.material as THREE.ShaderMaterial;
      m1.uniforms.uRes.value.set(W, H);
      m2.uniforms.uRes.value.set(W, H);
    },
    render(world: THREE.Scene, camera: THREE.PerspectiveCamera, focus: number, time: number) {
      const m1 = dof.material as THREE.ShaderMaterial, m2 = grade.material as THREE.ShaderMaterial;
      const H = m1.uniforms.uRes.value.y;
      m1.uniforms.uNear.value = camera.near;
      m1.uniforms.uFar.value = camera.far;
      m1.uniforms.uFocus.value = focus;
      m1.uniforms.uAperture.value = LOOK.aperture;
      m1.uniforms.uMaxR.value = (LOOK.maxBlur * H) / 1000;
      m2.uniforms.uTime.value = time;
      m2.uniforms.uGrade.value = LOOK.grade;
      m2.uniforms.uGrain.value = LOOK.grain;
      m2.uniforms.uVignette.value = LOOK.vignette;
      m2.uniforms.uExposure.value = renderer.toneMappingExposure;
      renderer.setRenderTarget(scene);
      renderer.render(world, camera);
      renderer.setRenderTarget(blurred);
      dof.render(renderer);
      renderer.setRenderTarget(null);
      grade.render(renderer);
    },
  };
}

/** a camera held in the hand: slow breathing sway and a little tremor, never quite repeating */
export function handheld(time: number, out: { rot: THREE.Euler; pos: THREE.Vector3 }, amount = 1) {
  const n = (t: number, a: number, b: number, c: number) =>
    Math.sin(t * a) * 0.55 + Math.sin(t * b + 1.3) * 0.3 + Math.sin(t * c + 2.1) * 0.15;
  const t = time;
  out.rot.set(
    0.0042 * amount * n(t, 0.61, 1.47, 3.9),
    0.0048 * amount * n(t + 11, 0.53, 1.21, 4.3),
    0.0022 * amount * n(t + 23, 0.37, 1.13, 3.1),
  );
  out.pos.set(
    0.0016 * amount * n(t + 37, 0.43, 1.31, 2.9),
    0.0012 * amount * n(t + 53, 0.71, 1.05, 3.7) + 0.0008 * amount * Math.sin(t * 1.6), // breathing
    0.0016 * amount * n(t + 71, 0.47, 1.17, 3.3),
  );
  return out;
}
