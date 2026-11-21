import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * Depth of field, for the close shots: what is nearer or farther than the focus goes soft. Cheap: the blur is
 * gathered at half size (28 taps on a spiral, each counted only if it is itself soft enough to reach), then laid
 * over the sharp picture where that is out of focus. Off (`enabled`) when there is nothing to blur.
 */
export class Dof extends Pass {
  /** metres from the eye to what is sharp */
  focus = 5;
  /** 0 none, 1 all of it */
  amount = 0;
  private half = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private blur: THREE.ShaderMaterial;
  private mix: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private tall = 1;

  constructor(private camera: THREE.PerspectiveCamera, private depth: () => THREE.Texture | null) {
    super();
    const TAPS = 28;
    const vertexShader = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    // how soft, in half-size pixels: by how far off the focus it is as a lens has it (1/z), nothing close to it
    const coc = /* glsl */ `
      #include <packing>
      uniform sampler2D tDepth;
      uniform float near, far, focus, maxR;
      float zAt(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far); }
      float cocOf(float z) { return clamp(2.6 * abs(1.0 / focus - 1.0 / z) - 0.05, 0.0, 1.0) * maxR; }
    `;
    const uniforms = () => ({ tColor: { value: null }, tDepth: { value: null }, near: { value: 0.1 }, far: { value: 100 }, focus: { value: 5 }, maxR: { value: 0 } });
    this.blur = new THREE.ShaderMaterial({
      uniforms: { ...uniforms(), px: { value: new THREE.Vector2() }, grow: { value: 1 } },
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform vec2 px;
        uniform float grow;
        varying vec2 vUv;
        ${coc}
        void main() {
          float zc = zAt(vUv);
          float cc = cocOf(zc);
          vec3 acc = texture2D(tColor, vUv).rgb;
          float tot = 1.0, r = 1.0, a = 0.0;
          for (int i = 0; i < ${TAPS}; i++) {
            a += 2.39996323;
            vec2 uv = vUv + vec2(cos(a), sin(a)) * r * px;
            float zs = zAt(uv);
            float cs = cocOf(zs);
            if (zs > zc) cs = min(cs, cc * 2.0); // what is behind does not smear over what is sharp in front
            float m = smoothstep(r - 0.5, r + 0.5, cs);
            acc += mix(acc / tot, texture2D(tColor, uv).rgb, m);
            tot += 1.0;
            r += grow / r;
          }
          gl_FragColor = vec4(acc / tot, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    (this.blur as unknown as { taps: number }).taps = TAPS;
    this.mix = new THREE.ShaderMaterial({
      uniforms: { ...uniforms(), tBlur: { value: null } },
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tBlur;
        varying vec2 vUv;
        ${coc}
        void main() {
          float k = smoothstep(0.3, 1.6, cocOf(zAt(vUv)));
          gl_FragColor = vec4(mix(texture2D(tColor, vUv).rgb, texture2D(tBlur, vUv).rgb, k), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
  }

  setSize(w: number, h: number) {
    const W = Math.max(1, Math.ceil(w / 2)), H = Math.max(1, Math.ceil(h / 2));
    this.half.setSize(W, H);
    this.blur.uniforms.px.value.set(1 / W, 1 / H);
    this.tall = H;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const depth = this.depth();
    // at its most, a blur 1.1 % of the picture's height across
    const most = Math.max(2, 0.011 * this.tall);
    const maxR = depth ? most * this.amount : 0;
    this.blur.uniforms.grow.value = (most * most - 1) / (2 * (this.blur as unknown as { taps: number }).taps);
    for (const m of [this.blur, this.mix]) {
      const u = m.uniforms;
      u.tColor.value = readBuffer.texture;
      u.tDepth.value = depth;
      u.near.value = this.camera.near;
      u.far.value = this.camera.far;
      u.focus.value = this.focus;
      u.maxR.value = maxR;
    }
    renderer.setRenderTarget(this.half);
    this.quad.material = this.blur;
    this.quad.render(renderer);
    this.mix.uniforms.tBlur.value = this.half.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.material = this.mix;
    this.quad.render(renderer);
  }

  dispose() {
    this.half.dispose();
    this.blur.dispose();
    this.mix.dispose();
    this.quad.dispose();
  }
}
