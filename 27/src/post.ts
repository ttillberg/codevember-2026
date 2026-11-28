// The camera behind the eye: an HDR frame, the glow of anything too bright, a lens that goes soft and dark towards its
// corners, exposure, film response and grain. And, out in front of the hole only, a depth of field: the eye is down
// in the grass, the blades against the lens and the bank behind go soft, and the hole is what is sharp.
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

// Depth of field as a gather: every pixel looks round it over the widest circle there is, and takes from each place
// only what that place's own circle of confusion would have spread this far.
const DOF = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc, tDepth;
uniform vec2 uTexel;
uniform float uFocus, uAmount, uMax, uNear, uFar;
float viewZ(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
// in pixels: nothing at the distance we are focused on, more the further off it in either direction (in dioptres)
float coc(float z) { return min(uMax, abs(1.0 / uFocus - 1.0 / z) * uAmount); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  float z0 = viewZ(texture2D(tDepth, vUv).x);
  float c0 = coc(z0);
  float turn = ign(gl_FragCoord.xy) * 6.2832;
  vec3 sum = vec3(0.0);
  float w = 0.0;
  for (int i = 0; i < 30; i++) {
    float r = sqrt((float(i) + 0.5) / 30.0) * uMax;
    float th = float(i) * 2.39996 + turn;
    vec2 uv = vUv + vec2(cos(th), sin(th)) * r * uTexel;
    float zs = viewZ(texture2D(tDepth, uv).x);
    // what is behind us in depth cannot smear over us if we are sharp ourselves
    float reach = zs > z0 ? min(coc(zs), c0) : coc(zs);
    float k = smoothstep(r - 1.5, r + 1.5, reach);
    sum += min(texture2D(tSrc, uv).rgb, vec3(64.0)) * k;
    w += k;
  }
#ifdef HALF
  // at half size: only what was gathered from round about, and how much of the pixel that is. The pixel itself
  // is put back at full size after (LAY), so what is sharp stays as sharp as it was
  gl_FragColor = vec4(sum / max(w, 1e-4), w / (1.0 + w));
#else
  gl_FragColor = vec4((texture2D(tSrc, vUv).rgb + sum) / (1.0 + w), 1.0);
#endif
}`;

const LAY = /* glsl */ `
precision highp float;
varying vec2 vUv; uniform sampler2D tSrc, tSoft;
void main() {
  vec4 s = texture2D(tSoft, vUv);
  gl_FragColor = vec4(mix(texture2D(tSrc, vUv).rgb, s.rgb, s.a), 1.0);
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

// (in the screen's own colours: laid on after everything else)
const DRAWING = /* glsl */ `
const vec3 PAPER = vec3(0.0235, 0.0157, 0.0118);
const vec3 INK = vec3(0.957, 0.957, 0.949);
const float INK_A = 0.42;`;

const FINAL = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene, tBlurA, tBlurB;
uniform float uExposure, uTime;
uniform vec2 uRes;
uniform float uAA;        // 1: the frame came with one sample a pixel, and its edges are smoothed here instead
uniform sampler2D tWire;  // the loading drawing: ink where red
uniform float uReveal;    // 0 the drawing alone, 1 the picture alone
${DRAWING}
uniform vec4 uGrain;      // how much, how big (pixels), how much less of it in the lights, how coloured (0 grey, 1 each channel its own)
uniform float uGrainRate; // new grain how many times a second (0: every frame)
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
// Edges, when the scene was drawn without its four samples a pixel (FXAA, the short one): where the frame steps,
// it is averaged along the step. Done on the frame squeezed under one, so that a light does not swamp what is beside
// it, and judged by eye, not by energy (the root).
vec3 squeeze(vec3 c) { c *= max(uExposure, 1e-4); return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 spread(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3) / max(uExposure, 1e-4); }
float seen(vec3 c) { return sqrt(dot(c, vec3(0.3, 0.6, 0.1))); }
vec3 smoothed(vec2 uv, vec3 mid) {
  vec2 px = 1.0 / uRes;
  vec3 m = squeeze(mid);
  float lm = seen(m);
  float lnw = seen(squeeze(texture2D(tScene, uv + vec2(-1.0, -1.0) * px).rgb)), lne = seen(squeeze(texture2D(tScene, uv + vec2(1.0, -1.0) * px).rgb));
  float lsw = seen(squeeze(texture2D(tScene, uv + vec2(-1.0, 1.0) * px).rgb)), lse = seen(squeeze(texture2D(tScene, uv + vec2(1.0, 1.0) * px).rgb));
  float lo = min(lm, min(min(lnw, lne), min(lsw, lse))), hi = max(lm, max(max(lnw, lne), max(lsw, lse)));
  if (hi - lo < max(0.02, hi * 0.1)) return mid;
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float less = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + less), -8.0, 8.0) * px;
  vec3 a = 0.5 * (squeeze(texture2D(tScene, uv + dir * (1.0 / 3.0 - 0.5)).rgb) + squeeze(texture2D(tScene, uv + dir * (2.0 / 3.0 - 0.5)).rgb));
  vec3 b = a * 0.5 + 0.25 * (squeeze(texture2D(tScene, uv - dir * 0.5).rgb) + squeeze(texture2D(tScene, uv + dir * 0.5).rgb));
  float lb = seen(b);
  return spread(lb < lo || lb > hi ? a : b);
}
void main() {
  vec2 c = vUv - 0.5;
  float asp = uRes.x / uRes.y;
  vec2 cc = vec2(c.x * asp, c.y);
  float r2 = dot(cc, cc) / (0.25 * (asp * asp + 1.0));
  vec2 ca = c * r2 * 0.006;
  vec3 mid = texture2D(tScene, vUv).rgb;
  vec3 col = vec3(texture2D(tScene, vUv + ca).r, mid.g, texture2D(tScene, vUv - ca).b);
  if (uAA > 0.5) col = max(col + smoothed(vUv, mid) - mid, 0.0);
  vec3 bA = texture2D(tBlurA, vUv).rgb, bB = texture2D(tBlurB, vUv).rgb;
  col = mix(col, bA, smoothstep(0.5, 1.15, r2) * 0.3);
  col += bA * 0.035 + bB * 0.06;
  col *= uExposure;
  col *= mix(1.0, 0.3, smoothstep(0.1, 1.05, r2));
  col = aces(col);
  float l = dot(col, vec3(0.3, 0.6, 0.1));
  // the grain of the film: two hashes summed (so it clumps a little, as grain does), new every frame or held
  vec2 gp = floor(gl_FragCoord.xy / max(uGrain.y, 1.0));
  float gt = uGrainRate > 0.0 ? floor(uTime * uGrainRate) / uGrainRate : uTime;
  vec2 go = vec2(fract(gt * 7.31) * 613.0, fract(gt * 3.17) * 271.0);
  float g = hash12(gp + go.x) + hash12(gp * 1.37 + go.y) - 1.0;
  vec3 gc = vec3(g);
  if (uGrain.w > 0.0) gc = mix(gc, vec3(g, hash12(gp + go.x + 17.0) + hash12(gp * 1.37 + go.y + 31.0) - 1.0, hash12(gp + go.x + 53.0) + hash12(gp * 1.37 + go.y + 71.0) - 1.0), uGrain.w);
  col += gc * uGrain.x * (1.0 - uGrain.z * l);
  col = max(col, 0.0);
  col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
  // the picture comes up over the drawing it was loaded behind
  if (uReveal < 1.0) col = mix(mix(PAPER, INK, texture2D(tWire, vUv).r * INK_A), col, uReveal);
  gl_FragColor = vec4(col, 1.0);
}`;

// The loading drawing by itself, before there is a picture: the place as a wireframe, in the ink of the title on the
// page's own dark. As little a shader as can be, so that nothing stands between the page and its first frame.
const DRAWN = /* glsl */ `
precision highp float;
uniform sampler2D tWire;
varying vec2 vUv;
${DRAWING}
void main() { gl_FragColor = vec4(mix(PAPER, INK, texture2D(tWire, vUv).r * INK_A), 1.0); }`;

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
  private dofMat: THREE.ShaderMaterial;
  private dofHalfMat: THREE.ShaderMaterial;
  private lay: THREE.ShaderMaterial;
  private soft: THREE.WebGLRenderTarget;
  private softH: THREE.WebGLRenderTarget;
  /** the loading drawing: multisampled (the canvas itself is not, and a wireframe shows it), freed once the picture is up */
  private wire: THREE.WebGLRenderTarget | null;
  private drawn: THREE.ShaderMaterial;
  private tri: THREE.BufferGeometry;
  exposure = 1;
  /** the film's grain: how much, how big in pixels, how much less of it in the lights (0 to 1), how coloured (0 to 1), and how many new grains a second (0: every frame). ?debug has sliders for these */
  grain = { amount: 0.026, size: 1, lights: 0.6, colour: 0, rate: 0 };
  /** depth of field: how much of it (0 none, and then the pass is not run at all), and the distance that is sharp, metres */
  dof = 0;
  focus = 1;
  /** the gather run on a quarter of the pixels and laid back over the sharp frame (a debug switch: cheaper, a little rougher) */
  dofHalf = false;
  /** smooth the edges in the last pass: for when the scene is drawn with one sample a pixel (setSamples(0)) */
  aa = false;

  constructor(private renderer: THREE.WebGLRenderer) {
    // (the scene's target keeps its depth as a texture: the light in the air is marched against it, fog.ts)
    const mk = (samples = 0, depth = false) => new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType, samples, depthBuffer: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      ...(depth ? { depthTexture: new THREE.DepthTexture(4, 4) } : {}),
    });
    this.scene = mk(4, true);
    this.half = mk(); this.qA = mk(); this.qB = mk(); this.eA = mk(); this.eB = mk(); this.soft = mk(); this.softH = mk();
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const mat = (frag: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.down = mat(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.blur = mat(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.final = mat(FINAL, {
      tScene: { value: null }, tBlurA: { value: null }, tBlurB: { value: null },
      uExposure: { value: 1 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2() },
      uGrain: { value: new THREE.Vector4() }, uGrainRate: { value: 0 }, uAA: { value: 0 },
      tWire: { value: null }, uReveal: { value: 1 },
    });
    this.wire = new THREE.WebGLRenderTarget(4, 4, { samples: matchMedia('(pointer: coarse)').matches ? 2 : 4 });
    this.drawn = mat(DRAWN, { tWire: { value: this.wire.texture } });
    this.tri = tri;
    const dofU = () => ({
      tSrc: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() },
      uFocus: { value: 1 }, uAmount: { value: 0 }, uMax: { value: 14 }, uNear: { value: 0.012 }, uFar: { value: 80 },
    });
    this.dofMat = mat(DOF, dofU());
    this.dofHalfMat = mat(DOF, dofU());
    this.dofHalfMat.defines = { HALF: 1 };
    this.lay = mat(LAY, { tSrc: { value: null }, tSoft: { value: null } });
    this.quad = new THREE.Mesh(tri, this.down);
    this.quad.frustumCulled = false;
    this.qScene.add(this.quad);
  }

  setSize(w: number, h: number) {
    this.scene.setSize(w, h);
    this.soft.setSize(w, h);
    this.softH.setSize(w >> 1, h >> 1);
    this.half.setSize(w >> 1, h >> 1);
    this.qA.setSize(w >> 2, h >> 2); this.qB.setSize(w >> 2, h >> 2);
    this.eA.setSize(w >> 4, h >> 4); this.eB.setSize(w >> 4, h >> 4);
    this.final.uniforms.uRes.value.set(w, h);
    this.wire?.setSize(w, h);
  }

  /** The loading drawing alone on the screen. draw: draws the wireframe (into the target bound for it). */
  drawing(draw: () => void) {
    if (!this.wire) return;
    this.renderer.setRenderTarget(this.wire);
    this.renderer.clear();
    draw();
    this.pass(this.drawn, null);
  }

  /** the picture is up: the drawing's target is given back */
  endWire() {
    this.wire?.dispose();
    this.wire = null;
    this.final.uniforms.tWire.value = null;
    this.drawn.dispose();
  }

  /** Every pass built ahead of its first frame, off the thread where the browser can (KHR_parallel_shader_compile). */
  compile() {
    return Promise.all([this.down, this.blur, this.final, this.dofMat, this.lay].map((m) => this.renderer.compileAsync(new THREE.Mesh(this.tri, m), this.cam)));
  }

  /** how many samples a pixel the scene is drawn with (4 as built; 0: one, and then `aa` wants to be on) */
  setSamples(n: number) {
    if (this.scene.samples === n) return;
    this.scene.samples = n;
    this.scene.dispose();
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

  /**
   * src: the frame to finish, the scene's own unless something (the air) has been laid over it since. reveal: 0 the
   * loading drawing alone, 1 the picture alone; draw: draws the wireframe, for as long as any of it shows.
   */
  render(time: number, src: THREE.WebGLRenderTarget = this.scene, camera?: THREE.PerspectiveCamera, reveal = 1, draw: (() => void) | null = null) {
    if (draw && this.wire) {
      this.renderer.setRenderTarget(this.wire);
      this.renderer.clear();
      draw();
    }
    if (this.dof > 0.004 && camera) {
      const m = this.dofHalf ? this.dofHalfMat : this.dofMat;
      const d = m.uniforms, px = src.height / 800;
      d.tSrc.value = src.texture;
      d.tDepth.value = this.scene.depthTexture;
      d.uTexel.value.set(1 / src.width, 1 / src.height);
      d.uFocus.value = this.focus;
      d.uAmount.value = 7 * px * this.dof;
      d.uMax.value = Math.max(2, 15 * px * this.dof);
      d.uNear.value = camera.near; d.uFar.value = camera.far;
      if (this.dofHalf) {
        this.pass(m, this.softH);
        this.lay.uniforms.tSrc.value = src.texture;
        this.lay.uniforms.tSoft.value = this.softH.texture;
        this.pass(this.lay, this.soft);
      } else this.pass(m, this.soft);
      src = this.soft;
    }
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
    u.uGrain.value.set(this.grain.amount, this.grain.size, this.grain.lights, this.grain.colour);
    u.uGrainRate.value = this.grain.rate;
    u.uAA.value = this.aa ? 1 : 0;
    u.tWire.value = this.wire?.texture ?? null;
    u.uReveal.value = this.wire ? reveal : 1;
    this.pass(this.final, null);
  }
}
