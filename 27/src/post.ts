// The camera behind the eye: an HDR frame, the glow of anything too bright, a lens that goes soft and dark towards its
// corners, exposure, film response and grain.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOWN = /* glsl */ `
precision highp float;
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(min(c * 0.25, vec3(64.0)), 1.0);
}`;

const BLUR = /* glsl */ `
precision highp float;
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uDir;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
  c += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.316216;
  c += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}`;

const FINAL = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene, tBlurA, tBlurB;
uniform float uExposure, uTime;
uniform vec2 uRes;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec2 c = vUv - 0.5;
  float asp = uRes.x / uRes.y;
  vec2 cc = vec2(c.x * asp, c.y);
  float r2 = dot(cc, cc) / (0.25 * (asp * asp + 1.0));
  vec2 ca = c * r2 * 0.006;
  vec3 col = vec3(texture2D(tScene, vUv + ca).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - ca).b);
  vec3 bA = texture2D(tBlurA, vUv).rgb, bB = texture2D(tBlurB, vUv).rgb;
  col = mix(col, bA, smoothstep(0.5, 1.15, r2) * 0.3);
  col += bA * 0.035 + bB * 0.06;
  col *= uExposure;
  col *= mix(1.0, 0.3, smoothstep(0.1, 1.05, r2));
  col = aces(col);
  float l = dot(col, vec3(0.3, 0.6, 0.1));
  float g = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 613.0) + hash12(gl_FragCoord.xy * 1.37 + fract(uTime * 3.17) * 271.0) - 1.0;
  col += g * 0.035 * (1.0 - 0.6 * l);
  col = max(col, 0.0);
  col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
  gl_FragColor = vec4(col, 1.0);
}`;

export class Post {
  scene: THREE.WebGLRenderTarget;
  private half: THREE.WebGLRenderTarget;
  private qA: THREE.WebGLRenderTarget;
  private qB: THREE.WebGLRenderTarget;
  private eA: THREE.WebGLRenderTarget;
  private eB: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private qScene = new THREE.Scene();
  private cam = new THREE.Camera();
  private down: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial;
  private final: THREE.ShaderMaterial;
  exposure = 1;

  constructor(private renderer: THREE.WebGLRenderer) {
    // (the scene's target keeps its depth as a texture: the light in the air is marched against it, fog.ts)
    const mk = (samples = 0, depth = false) => new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType, samples, depthBuffer: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      ...(depth ? { depthTexture: new THREE.DepthTexture(4, 4) } : {}),
    });
    this.scene = mk(4, true);
    this.half = mk(); this.qA = mk(); this.qB = mk(); this.eA = mk(); this.eB = mk();
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const mat = (frag: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.down = mat(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.blur = mat(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.final = mat(FINAL, {
      tScene: { value: null }, tBlurA: { value: null }, tBlurB: { value: null },
      uExposure: { value: 1 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2() },
    });
    this.quad = new THREE.Mesh(tri, this.down);
    this.quad.frustumCulled = false;
    this.qScene.add(this.quad);
  }

  setSize(w: number, h: number) {
    this.scene.setSize(w, h);
    this.half.setSize(w >> 1, h >> 1);
    this.qA.setSize(w >> 2, h >> 2); this.qB.setSize(w >> 2, h >> 2);
    this.eA.setSize(w >> 4, h >> 4); this.eB.setSize(w >> 4, h >> 4);
    this.final.uniforms.uRes.value.set(w, h);
  }

  private pass(m: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = m;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.cam);
  }

  private downTo(src: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget) {
    this.down.uniforms.tSrc.value = src.texture;
    this.down.uniforms.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
    this.pass(this.down, dst);
  }

  private blurPair(a: THREE.WebGLRenderTarget, b: THREE.WebGLRenderTarget) {
    this.blur.uniforms.tSrc.value = a.texture;
    this.blur.uniforms.uDir.value.set(1 / a.width, 0);
    this.pass(this.blur, b);
    this.blur.uniforms.tSrc.value = b.texture;
    this.blur.uniforms.uDir.value.set(0, 1 / a.height);
    this.pass(this.blur, a);
  }

  /** src: the frame to finish, the scene's own unless something (the air) has been laid over it since */
  render(time: number, src: THREE.WebGLRenderTarget = this.scene) {
    this.downTo(src, this.half);
    this.downTo(this.half, this.qA);
    this.blurPair(this.qA, this.qB);
    this.downTo(this.qA, this.eA);
    this.blurPair(this.eA, this.eB);
    this.blurPair(this.eA, this.eB);
    const u = this.final.uniforms;
    u.tScene.value = src.texture;
    u.tBlurA.value = this.qA.texture;
    u.tBlurB.value = this.eA.texture;
    u.uExposure.value = this.exposure;
    u.uTime.value = time;
    this.pass(this.final, null);
  }
}
