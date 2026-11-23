import * as THREE from 'three';
import type { Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * The frame: the scene drawn once, with 4x MSAA and its depth into a texture (the AO and the light in the haze read
 * it), then each pass after it from one plain target into another, the last to the screen. (Three's EffectComposer
 * would have every pass write into a multisampled target the size of the screen, and resolve it, for nothing.)
 */
export class Post {
  readonly depth = new THREE.DepthTexture(1, 1);
  readonly target: THREE.WebGLRenderTarget;
  private a = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private b = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  readonly passes: Pass[] = [];

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: this.depth });
  }

  setSize(w: number, h: number) {
    const pr = this.renderer.getPixelRatio();
    const W = Math.floor(w * pr), H = Math.floor(h * pr);
    for (const t of [this.target, this.a, this.b]) t.setSize(W, H);
    for (const p of this.passes) p.setSize(W, H);
  }

  insert(pass: Pass, at: number) {
    this.passes.splice(at, 0, pass);
    this.passes.forEach((p, i) => (p.renderToScreen = i === this.passes.length - 1));
    pass.setSize(this.target.width, this.target.height);
  }

  render(eye: THREE.Camera) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(this.scene, eye);
    let read = this.target, write = this.a;
    const live = this.passes.filter((p) => p.enabled);
    live.forEach((p, i) => {
      p.renderToScreen = i === live.length - 1;
      p.render(r, write, read, 0, false);
      if (p.needsSwap) {
        read = write;
        write = write === this.a ? this.b : this.a;
      }
    });
  }
}
