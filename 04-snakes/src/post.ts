// After the render: ambient occlusion from the depth (the creases of the pile and the joins between
// bodies), a macro lens's shallow depth of field, then the grade.
// Occlusion is worked out at half size: each pixel's place in view space from the depth, its normal
// from its neighbours (the nearer of the two either side, so an edge doesn't smear), and 16 points
// in the hemisphere over it, turned by a hash per pixel; a point the scene lies in front of is
// occluded, counted less the further the blocker is (no dark halos round a body far in front). It is
// smoothed over the neighbours that are at the same depth and laid on the colour before the blur.
// The scene is drawn into a multisampled float target with its depth. Depth of field gathers round
// each pixel on a golden-angle spiral, out to its circle of confusion (thin lens: it grows with how far
// a point is from the focus, in dioptres); a sample only counts where its own circle reaches this
// pixel, and one behind a sharp pixel only as far as this pixel's own circle, so nothing blurs over
// what is in focus; the depth comes along in the colour's alpha from the pass before. The focus is
// pulled by hand, a little late, onto its mark (main.ts: a click). Then tone mapping and sRGB, and the grade on the display values: a soft S curve,
// cool shadows and warm highlights, a touch more colour, a lifted black, a vignette, fine grain.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/** knobs: what is shown (0 the picture, 1 the occlusion alone), occlusion strength and reach (m), aperture (bigger, shallower), the largest blur in pixels at 1000 px tall, the grade's strength */
export const LOOK = { view: 0, ao: 1.3, aoRadius: 0.025, aperture: 0.011, maxBlur: 13, grade: 1, grain: 0.022, vignette: 0.38 };

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const VIEWPOS = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uInvProj;
vec3 viewPos(vec2 uv) {
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).x * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}`;

// depth along the view (positive, metres) from the depth buffer: two constants, no matrix
const VIEWZ = /* glsl */ `
uniform sampler2D tDepth;
uniform float uNear, uFar;
float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - d * (uFar - uNear));
}`;

const AO = /* glsl */ `
precision highp float;
${VIEWPOS}
uniform mat4 uProj;
uniform vec2 uRes;
uniform float uRadius;
varying vec2 vUv;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 P = viewPos(vUv);
  if (-P.z > 5.0) { gl_FragColor = vec4(1.0); return; }
  vec2 px = 1.0 / uRes;
  vec3 r = viewPos(vUv + vec2(px.x, 0.0)) - P, l = P - viewPos(vUv - vec2(px.x, 0.0));
  vec3 u = viewPos(vUv + vec2(0.0, px.y)) - P, d = P - viewPos(vUv - vec2(0.0, px.y));
  vec3 dx = abs(r.z) < abs(l.z) ? r : l;
  vec3 dy = abs(u.z) < abs(d.z) ? u : d;
  vec3 N = normalize(cross(dx, dy));
  float a0 = hash(gl_FragCoord.xy) * 6.2832;
  vec3 rv = vec3(cos(a0), sin(a0), 0.0);
  vec3 T = normalize(rv - N * dot(rv, N));
  vec3 B = cross(N, T);
  float occ = 0.0;
  const int K = 16;
  for (int i = 0; i < K; i++) {
    float t = (float(i) + 0.5) / float(K);
    float a = float(i) * 2.39996323;
    float h = sqrt(1.0 - t);
    vec3 dir = T * cos(a) * sqrt(t) + B * sin(a) * sqrt(t) + N * h;
    float sc = mix(0.15, 1.0, fract(t * 7.0 + hash(gl_FragCoord.yx)));
    vec3 S = P + dir * uRadius * sc * sc;
    vec4 c = uProj * vec4(S, 1.0);
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    float sz = viewPos(suv).z;
    float range = smoothstep(0.0, 1.0, uRadius / max(abs(P.z - sz), 1e-5));
    occ += step(S.z + 0.0008, sz) * range;
  }
  gl_FragColor = vec4(vec3(1.0 - occ / float(K)), 1.0);
}`;

const COMPOSE = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tAO;
${VIEWZ}
uniform vec2 uAORes;
uniform float uStrength;
uniform float uView;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  float z0 = viewZ(vUv);
  float sum = 0.0, wsum = 0.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    vec2 uv = vUv + vec2(float(x), float(y)) / uAORes;
    float w = exp(-abs(viewZ(uv) - z0) * 400.0);
    sum += texture2D(tAO, uv).r * w;
    wsum += w;
  }
  float ao = sum / max(wsum, 1e-4);
  float k = clamp(mix(1.0, pow(ao, 1.5), uStrength), 0.0, 1.0);
  // the depth goes along in alpha, so the blur after needn't read the depth buffer again
  gl_FragColor = vec4(uView > 0.5 ? vec3(k * 0.6) : c * k, z0);
}`;

const DOF = /* glsl */ `
precision highp float;
uniform sampler2D tColor; // rgb the picture, a its depth along the view
uniform vec2 uRes;
uniform float uFocus, uAperture, uMaxR;
varying vec2 vUv;
float coc(float z) { return min(uAperture * abs(1.0 / uFocus - 1.0 / z) * uRes.y, uMaxR); }
void main() {
  vec4 s0 = texture2D(tColor, vUv);
  vec3 c0 = s0.rgb;
  float z0 = s0.a;
  float r0 = coc(z0);
  vec3 sum = c0;
  float wsum = 1.0;
  const int N = 48;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N);
    float r = sqrt(t) * uMaxR;
    float a = float(i) * 2.39996323;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
    vec4 sc = texture2D(tColor, uv);
    float z = sc.a;
    float rs = coc(z);
    // behind this pixel: it can't blur over it further than this pixel's own blur
    if (z > z0) rs = min(rs, r0);
    float w = smoothstep(r - 1.0, r + 1.0, rs);
    sum += sc.rgb * w;
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
  const aoRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType });
  const lit = make(0);
  const blurred = make(0);
  const invProj = new THREE.Matrix4();

  const ao = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: {
      tDepth: { value: scene.depthTexture }, uInvProj: { value: invProj }, uProj: { value: new THREE.Matrix4() },
      uRes: { value: new THREE.Vector2(1, 1) }, uRadius: { value: LOOK.aoRadius },
    },
    vertexShader: VERT, fragmentShader: AO, depthTest: false, depthWrite: false,
  }));
  const compose = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: scene.texture }, tAO: { value: aoRT.texture }, tDepth: { value: scene.depthTexture },
      uNear: { value: 0.01 }, uFar: { value: 20 }, uAORes: { value: new THREE.Vector2(1, 1) }, uStrength: { value: LOOK.ao }, uView: { value: 0 },
    },
    vertexShader: VERT, fragmentShader: COMPOSE, depthTest: false, depthWrite: false,
  }));

  const dof = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: lit.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
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
      lit.setSize(W, H);
      blurred.setSize(W, H);
      const aw = Math.ceil(W / 2), ah = Math.ceil(H / 2);
      aoRT.setSize(aw, ah);
      (ao.material as THREE.ShaderMaterial).uniforms.uRes.value.set(aw, ah);
      (compose.material as THREE.ShaderMaterial).uniforms.uAORes.value.set(aw, ah);
      const m1 = dof.material as THREE.ShaderMaterial, m2 = grade.material as THREE.ShaderMaterial;
      m1.uniforms.uRes.value.set(W, H);
      m2.uniforms.uRes.value.set(W, H);
    },
    render(world: THREE.Scene, camera: THREE.PerspectiveCamera, focus: number, time: number) {
      const m1 = dof.material as THREE.ShaderMaterial, m2 = grade.material as THREE.ShaderMaterial;
      const H = m1.uniforms.uRes.value.y;
      m1.uniforms.uFocus.value = focus;
      // the occlusion alone is shown sharp
      m1.uniforms.uAperture.value = LOOK.view ? 0 : LOOK.aperture;
      m1.uniforms.uMaxR.value = (LOOK.maxBlur * H) / 1000;
      m2.uniforms.uTime.value = time;
      m2.uniforms.uGrade.value = LOOK.grade;
      m2.uniforms.uGrain.value = LOOK.grain;
      m2.uniforms.uVignette.value = LOOK.vignette;
      m2.uniforms.uExposure.value = renderer.toneMappingExposure;
      renderer.setRenderTarget(scene);
      renderer.render(world, camera);
      const ma = ao.material as THREE.ShaderMaterial, mc = compose.material as THREE.ShaderMaterial;
      invProj.copy(camera.projectionMatrixInverse);
      ma.uniforms.uProj.value.copy(camera.projectionMatrix);
      ma.uniforms.uRadius.value = LOOK.aoRadius;
      mc.uniforms.uNear.value = camera.near;
      mc.uniforms.uFar.value = camera.far;
      mc.uniforms.uStrength.value = LOOK.ao;
      mc.uniforms.uView.value = LOOK.view;
      if (LOOK.ao > 0 || LOOK.view) {
        renderer.setRenderTarget(aoRT);
        ao.render(renderer);
      }
      renderer.setRenderTarget(lit);
      compose.render(renderer);
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
