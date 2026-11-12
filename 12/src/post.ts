import * as THREE from 'three';

// Scene → 4x MSAA HalfFloat target (alpha-to-coverage on the feathers needs the
// samples) with a depth texture → depth of field → tone map + grade → screen.
//
// DOF is a single gather pass: per-pixel circle of confusion from real depth,
// a golden-angle spiral of taps, each tap weighted by its own CoC so a sharp
// bird doesn't smear into the background and the background doesn't bleed
// over the bird's edge. Cheap and good enough at this scale.

const fsVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const dofFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;     // 1 / size
uniform float uNear, uFar;
uniform float uFocus;    // view-space distance in focus
uniform float uAperture; // CoC in px for 1/z difference of 1
uniform float uMaxCoc;   // px
uniform float uFarCoc;   // px for the sky sphere / cleared depth

float viewZ(float d) {
  // perspective depth → positive view distance
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
// x = CoC px, y = view distance
vec2 coc(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  if (d >= 0.99999) return vec2(uFarCoc, 1e4);
  float z = viewZ(d);
  // a real lens gets shallower up close; scale that back so a macro look at
  // the eye isn't a smear (blur grows with distance from focus, not 1/f^2)
  float k = uFocus / 3.3;
  return vec2(min(uAperture * abs(1.0 / uFocus - 1.0 / z) * k, uMaxCoc), z);
}

const int TAPS = 48;
const float GOLDEN = 2.39996323;

void main() {
  vec2 cz0 = coc(vUv);
  float c0 = cz0.x;
  vec3 acc = texture2D(tColor, vUv).rgb;
  if (any(isnan(acc)) || any(isinf(acc))) acc = vec3(0.0);
  float wsum = 1.0;
  // big enough to catch blurry foreground spilling over a sharp pixel
  float R = max(c0, uMaxCoc * 0.5);
  // rotate the spiral per pixel so a hot speck blurs to a soft disc, not a ring of dots
  float rot = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  float jr = fract(sin(dot(gl_FragCoord.xy, vec2(39.3468, 11.135))) * 24634.6345);
  for (int i = 1; i < TAPS; i++) {
    float fi = float(i);
    float r = sqrt((fi - jr) / float(TAPS)) * R;
    float a = fi * GOLDEN + rot;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uTexel;
    vec2 czi = coc(uv);
    // a tap behind us can't blur over us further than our own blur
    float ci = czi.y > cz0.y * 1.02 ? min(czi.x, c0) : czi.x;
    float w = smoothstep(r - 1.0, r + 1.0, ci);
    vec3 s = texture2D(tColor, uv).rgb;
    // one NaN pixel would smear into a dotted disc: drop it
    if (any(isnan(s)) || any(isinf(s))) continue;
    s = min(s, vec3(32.0));
    // out-of-focus highlights bloom into discs a little
    w *= 1.0 + 0.25 * smoothstep(0.6, 1.6, dot(s, vec3(0.333)));
    acc += s * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, c0 / uMaxCoc);
}
`;

const gradeFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform float uExposure;
uniform vec3 uWhite;     // white balance multiplier (linear)
uniform vec3 uLift;      // display space
uniform float uFade;     // lift the blacks toward a pale haze
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSat;
uniform float uContrast;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform vec2 uRes;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 c = texture2D(tColor, vUv).rgb * uExposure * uWhite;
  c = toneMapping(c);
  c = linearToOutputTexel(vec4(c, 1.0)).rgb;
  // lift / gamma / gain in display space
  c = uGain * (c + uLift * (1.0 - c));
  c = mix(c, vec3(0.78, 0.82, 0.76), uFade * (1.0 - c) * (1.0 - c));
  c = pow(max(c, 0.0), 1.0 / uGamma);
  // soft contrast around mid grey
  c = mix(vec3(0.5), c, uContrast);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  // vignette
  vec2 q = vUv - 0.5;
  q.x *= uRes.x / uRes.y;
  c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
  // grain, luminance-weighted, a touch stronger in the mids
  float g = hash(vUv * uRes + fract(uTime) * 91.7) - 0.5;
  c += g * uGrain * (0.4 + 0.6 * (1.0 - abs(l - 0.5) * 2.0));
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

export interface Post {
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, t: number): void;
  setSize(w: number, h: number, dpr: number): void;
  /** world-space point to keep in focus */
  focusOn(p: THREE.Vector3): void;
  dof: Record<string, THREE.IUniform>;
  grade: Record<string, THREE.IUniform>;
  /** swap the tone mapping curve (the grade pass calls it itself) */
  setToneMapping(t: THREE.ToneMapping): void;
}

export function createPost(renderer: THREE.WebGLRenderer, opts: { samples: number }): Post {
  const depth = new THREE.DepthTexture(1, 1);
  depth.type = THREE.UnsignedIntType;
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: opts.samples,
    depthTexture: depth,
    depthBuffer: true,
  });
  sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const dofRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const fsScene = new THREE.Scene();
  fsScene.add(quad);
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const dofMat = new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: dofFrag,
    uniforms: {
      tColor: { value: sceneRT.texture },
      tDepth: { value: depth },
      uTexel: { value: new THREE.Vector2() },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uFocus: { value: 3.3 },
      uAperture: { value: 90 },
      uMaxCoc: { value: 14 },
      uFarCoc: { value: 6 },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const gradeMat = new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: gradeFrag,
    uniforms: {
      tColor: { value: dofRT.texture },
      uExposure: { value: 1.0 },
      uWhite: { value: new THREE.Vector3(1, 1, 1) },
      uLift: { value: new THREE.Vector3(0, 0, 0) },
      uFade: { value: 0 },
      uGamma: { value: new THREE.Vector3(1, 1, 1) },
      uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSat: { value: 1 },
      uContrast: { value: 1 },
      uVignette: { value: 0.2 },
      uGrain: { value: 0.025 },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    depthTest: false,
    depthWrite: false,
    // keep toneMapped so three defines toneMapping() for the screen pass; the
    // shader calls it itself, before the grade
    toneMapped: true,
  });

  const focusWorld = new THREE.Vector3(0, 0.9, 0);
  const tmp = new THREE.Vector3();
  let focusDist = 3.3;
  let dpr = 1;

  return {
    dof: dofMat.uniforms,
    grade: gradeMat.uniforms,
    setToneMapping(t) {
      renderer.toneMapping = t;
      gradeMat.needsUpdate = true;
    },
    focusOn(p) {
      focusWorld.copy(p);
    },
    setSize(w, h, d) {
      dpr = d;
      const W = Math.floor(w * d);
      const H = Math.floor(h * d);
      sceneRT.setSize(W, H);
      dofRT.setSize(W, H);
      dofMat.uniforms.uTexel.value.set(1 / W, 1 / H);
      gradeMat.uniforms.uRes.value.set(W, H);
    },
    render(scene, camera, t) {
      // focus distance along the view axis, eased so saccades don't pump the focus
      tmp.copy(focusWorld).applyMatrix4(camera.matrixWorldInverse);
      focusDist += (-tmp.z - focusDist) * 0.15;
      dofMat.uniforms.uFocus.value = Math.max(focusDist, 0.1);
      dofMat.uniforms.uNear.value = camera.near;
      dofMat.uniforms.uFar.value = camera.far;
      // CoC numbers are tuned in CSS px; scale to the buffer
      dofMat.uniforms.uTexel.value.set(1 / sceneRT.width, 1 / sceneRT.height).multiplyScalar(dpr);
      gradeMat.uniforms.uTime.value = t;

      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      quad.material = dofMat;
      renderer.setRenderTarget(dofRT);
      renderer.render(fsScene, fsCam);
      quad.material = gradeMat;
      renderer.setRenderTarget(null);
      renderer.render(fsScene, fsCam);
    },
  };
}
