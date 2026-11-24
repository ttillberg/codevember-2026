import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * Clean Scandinavian studio color grading & filmic highlight roll-off pass.
 * Keeps bright alabaster whites luminous and neutral-warm while giving shadows
 * a quiet architectural cool-stone lift and imperceptible micro-grain.
 */
export class StudioGradePass extends Pass {
  private readonly fsQuad: FullScreenQuad;
  readonly material: THREE.ShaderMaterial;

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uExposure: { value: 1.02 },
        uGradeStrength: { value: 1.0 },
        uVignette: { value: 0.085 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uExposure;
        uniform float uGradeStrength;
        uniform float uVignette;
        varying vec2 vUv;

        // Clean AgX-inspired gentle filmic tone curve (preserves airy studio whites)
        vec3 studioFilmic(vec3 x) {
          x = max(x, vec3(0.0));
          // Slightly softer shoulder than harsh ACES so light studio whites stay crisp & creamy
          vec3 a = x * (2.35 * x + 0.045);
          vec3 b = x * (2.22 * x + 0.56) + 0.125;
          return clamp(a / b, 0.0, 1.0);
        }

        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
          vec3 hdr = texture2D(tDiffuse, vUv).rgb;
          vec3 col = studioFilmic(hdr * uExposure);

          // Linear -> sRGB for subtle photographic print grading
          col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));

          float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
          float shadowMask = pow(1.0 - clamp(luma, 0.0, 1.0), 2.1);
          float highMask = smoothstep(0.55, 1.0, luma);

          // Minimalist studio color grade:
          // - Delicate cool-stone shadow lift (prevents muddy dark tracks)
          // - Subtle warm-ivory highlight tint
          vec3 graded = col;
          graded += shadowMask * vec3(0.008, 0.011, 0.015);
          graded *= mix(vec3(1.0), vec3(1.012, 1.005, 0.992), highMask * 0.65);

          // Very gentle micro-contrast S-curve
          vec3 sCurve = graded * graded * (3.0 - 2.0 * graded);
          graded = mix(graded, sCurve, 0.11);

          // Subtle editorial desaturation only on extreme shadows, keeping LEDs vivid
          col = mix(col, graded, uGradeStrength);

          // Soft studio lens vignette framing the cyclorama
          vec2 p = vUv - 0.5;
          float vig = 1.0 - dot(p, p) * uVignette * 3.1;
          col *= clamp(vig, 0.86, 1.0);

          // Imperceptible fine photographic grain (eliminates 8-bit cyclorama banding)
          float grain = (hash12(gl_FragCoord.xy + fract(uTime * 13.7) * 197.0) - 0.5) * 0.012;
          col = clamp(col + grain, 0.0, 1.0);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
    }
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

/**
 * Post-processing pipeline:
 * 1. Renders scene into 4x MSAA HDR HalfFloat target with depth texture
 * 2. Light GTAOPass (SSAO) — hides transparent outer plastic shell during AO prepass
 *    so ambient occlusion cleanly shades every interior labyrinth corridor & screw recess!
 * 3. StudioGradePass — filmic highlight roll-off, subtle Scandinavian color grading & fine grain
 */
export class StudioPost {
  readonly depth = new THREE.DepthTexture(1, 1);
  readonly target: THREE.WebGLRenderTarget;
  private readonly ping: THREE.WebGLRenderTarget;
  readonly aoPass: GTAOPass;
  readonly gradePass: StudioGradePass;
  private aoExcluded: THREE.Object3D[] = [];

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: this.depth,
    });
    this.ping = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
    });

    this.aoPass = new GTAOPass(scene, camera, 1, 1, { depthTexture: this.depth });
    this.aoPass.output = GTAOPass.OUTPUT.Default;
    this.aoPass.blendIntensity = 0.56; // Light, crisp studio SSAO in labyrinth tracks & screw recesses
    this.aoPass.updateGtaoMaterial({
      radius: 0.25,
      distanceExponent: 1.3,
      thickness: 0.58,
      scale: 1.18,
      samples: 16,
      distanceFallOff: 0.88,
    });
    this.aoPass.updatePdMaterial({
      lumaPhi: 8,
      depthPhi: 2.2,
      normalPhi: 3.0,
      radius: 3,
      radiusExponent: 1.5,
      rings: 2,
      samples: 12,
    });
    this.aoPass.renderToScreen = false;

    this.gradePass = new StudioGradePass();
    this.gradePass.renderToScreen = true;
  }

  setAoExcluded(objects: THREE.Object3D[]) {
    this.aoExcluded = objects;
  }

  setSize(w: number, h: number) {
    const pr = this.renderer.getPixelRatio();
    const W = Math.max(1, Math.floor(w * pr));
    const H = Math.max(1, Math.floor(h * pr));
    this.target.setSize(W, H);
    this.ping.setSize(W, H);
    this.aoPass.setSize(W, H);
  }

  render(time: number) {
    this.gradePass.material.uniforms.uTime.value = time;

    // 1. Main 4x MSAA HDR render (full scene including thin plastic shell + tape)
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);

    let readBuf = this.target;

    // 2. Light SSAO (GTAO) on opaque inner labyrinth + metal ball + screws (excluding transparent plastic shell & backdrop)
    if (this.aoPass.enabled && this.aoPass.blendIntensity > 0.001) {
      const prevVis: boolean[] = [];
      for (let i = 0; i < this.aoExcluded.length; i++) {
        prevVis.push(this.aoExcluded[i].visible);
        this.aoExcluded[i].visible = false;
      }
      this.aoPass.render(this.renderer, this.ping, this.target, 0, false);
      for (let i = 0; i < this.aoExcluded.length; i++) {
        this.aoExcluded[i].visible = prevVis[i];
      }
      readBuf = this.ping;
    }

    // 3. Studio color grading + tone mapping to screen
    this.gradePass.render(this.renderer, this.ping, readBuf);
  }

  dispose() {
    this.target.dispose();
    this.ping.dispose();
    this.depth.dispose();
    this.aoPass.dispose();
    this.gradePass.dispose();
  }
}
