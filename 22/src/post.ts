import * as THREE from 'three';

/**
 * Lightweight single-pass 1984 35mm film color grade (Kodak Gold / Agfa bedroom stock):
 * - Renders the 3D scene into a 4x MSAA HDR HalfFloat render target
 * - Applies filmic ACES tone mapping, warm tungsten highlights, cool-tinted lifted shadows,
 *   gentle analog S-curve contrast, subtle optical lens vignette, and fine 24fps film grain.
 */
export class FilmColorGrade {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly postScene: THREE.Scene;
  private readonly postCam: THREE.OrthographicCamera;
  private readonly mat: THREE.ShaderMaterial;

  constructor(width: number, height: number, dpr: number) {
    this.target = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(width * dpr)),
      Math.max(1, Math.floor(height * dpr)),
      {
        type: THREE.HalfFloatType,
        samples: 4,
        depthBuffer: true,
      },
    );

    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uTime: { value: 0 },
        uExposure: { value: 0.98 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uExposure;
        varying vec2 vUv;

        // Filmic ACES approximation (Narkowicz 2015)
        vec3 acesFilm(vec3 x) {
          const float a = 2.51;
          const float b = 0.03;
          const float c = 2.43;
          const float d = 0.59;
          const float e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }

        // Fast hash for subtle organic 35mm grain
        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
          vec3 hdr = texture2D(tDiffuse, vUv).rgb;

          // 1. Exposure + filmic ACES tone map (from linear HDR)
          vec3 col = acesFilm(hdr * uExposure);

          // Convert to sRGB working space for gentle analog print grading
          col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));

          float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));

          // 2. 1984 Swedish 35mm split-toning:
          //    - Slightly lifted cool-slate shadows (keeps dark desk wood & crevices rich)
          //    - Warm creamy amber-gold midtones & highlights
          float shadowMask = pow(1.0 - clamp(luma, 0.0, 1.0), 2.4);
          float highMask = smoothstep(0.45, 1.0, luma);
          float midMask = 1.0 - abs(luma * 2.0 - 1.0);

          col += shadowMask * vec3(0.010, 0.016, 0.024);     // cool film-base shadow toe
          col *= mix(vec3(1.0), vec3(1.022, 1.006, 0.976), midMask * 0.75); // cozy analog mid warmth
          col *= mix(vec3(1.0), vec3(1.032, 1.004, 0.945), highMask * 0.72); // creamy tungsten roll-off

          // 3. Gentle analog S-curve contrast (preserves crisp C64 CRT blue legibility)
          vec3 sCurve = col * col * (3.0 - 2.0 * col);
          col = mix(col, sCurve, 0.16);

          // Slight saturation lift (+6%) for rich burnt-orange enamel, Colodore blue & TAC-2 vermilion
          float gLuma = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(gLuma), col, 1.06);

          // 4. Soft 35mm lens optical vignette framing the centered CRT
          vec2 d = (vUv - 0.5) * vec2(1.06, 1.0);
          float vig = 1.0 - dot(d, d) * 0.42;
          col *= clamp(vig, 0.68, 1.0);

          // 5. Ultra-fine luma-weighted 24fps 35mm film grain (never noisy on text)
          float frameStep = floor(uTime * 24.0);
          float n = hash12(gl_FragCoord.xy + vec2(frameStep * 17.3, frameStep * 31.7)) - 0.5;
          float grainWeight = (1.0 - highMask * 0.65) * 0.022;
          col += n * grainWeight;

          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.postScene.add(quad);
  }

  resize(width: number, height: number, dpr: number) {
    this.target.setSize(
      Math.max(1, Math.floor(width * dpr)),
      Math.max(1, Math.floor(height * dpr)),
    );
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, elapsed: number) {
    this.mat.uniforms.uTime.value = elapsed;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.postScene, this.postCam);
  }
}
