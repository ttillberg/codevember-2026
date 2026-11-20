import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * Light in the haze, for real: from the eye out to whatever each pixel sees, a march through the air, and at
 * every step the sun's shadow map says whether the sun gets there. Where the roof, the trusses and the towers
 * stand in its way the air stays dark, so the light comes down through the structure in shafts and bars. Marched
 * at half the resolution, blurred a little on the way back up, added to the picture before the tone mapping.
 */
export class Rays extends Pass {
  intensity = 1;
  private half = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private march: THREE.ShaderMaterial;
  private blend: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private sun: THREE.DirectionalLight,
    private depth: () => THREE.Texture | null,
    o: { roof: number; box: THREE.Box3; density: number; steps?: number },
  ) {
    super();
    this.march = new THREE.ShaderMaterial({
      defines: { STEPS: o.steps ?? 64 },
      uniforms: {
        tDepth: { value: null },
        tShadow: { value: null },
        shadowMatrix: { value: new THREE.Matrix4() },
        projInv: { value: new THREE.Matrix4() },
        camWorld: { value: new THREE.Matrix4() },
        camPos: { value: new THREE.Vector3() },
        sunDir: { value: new THREE.Vector3() },
        sunColor: { value: new THREE.Color() },
        boxMin: { value: o.box.min },
        boxMax: { value: o.box.max },
        roof: { value: o.roof },
        density: { value: o.density },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        precision highp sampler2DShadow;
        uniform sampler2D tDepth;
        uniform sampler2DShadow tShadow;
        uniform mat4 shadowMatrix, projInv, camWorld;
        uniform vec3 camPos, sunDir, sunColor, boxMin, boxMax;
        uniform float roof, density;
        varying vec2 vUv;
        // a fixed dither per pixel, so the steps do not show as bands; the blur after takes it out
        float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        void main() {
          float d = texture2D(tDepth, vUv).x;
          vec4 v = projInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          vec3 wp = (camWorld * vec4(v.xyz / v.w, 1.0)).xyz;
          vec3 rd = wp - camPos;
          float far = length(rd);
          rd /= far;
          // only inside the hall: clip the ray to its box
          vec3 inv = 1.0 / rd;
          vec3 t0 = (boxMin - camPos) * inv, t1 = (boxMax - camPos) * inv;
          float tin = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), max(min(t0.z, t1.z), 0.0));
          float tout = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
          tout = min(tout, far);
          if (tout <= tin) { gl_FragColor = vec4(0.0); return; }
          // forward scattering: brighter looking into the light
          float mu = dot(rd, -sunDir);
          float g = 0.6;
          float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
          float phase = 0.25 + 0.75 * hg / 4.0;
          float dt = (tout - tin) / float(STEPS);
          float j = ign(gl_FragCoord.xy);
          float sum = 0.0;
          for (int i = 0; i < STEPS; i++) {
            float t = tin + (float(i) + j) * dt;
            vec3 p = camPos + rd * t;
            vec4 s = shadowMatrix * vec4(p, 1.0);
            float lit = texture(tShadow, vec3(s.xy, s.z - 0.0008));
            // the air thicker up where the light is, and less of it gets back to the eye from far
            float h = 0.55 + 0.45 * smoothstep(-30.0, roof, p.y);
            sum += lit * h * exp(-0.012 * t) * dt;
          }
          gl_FragColor = vec4(sunColor * sum * density * phase, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.blend = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tRays: { value: null }, texel: { value: new THREE.Vector2() }, intensity: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tRays;
        uniform vec2 texel;
        uniform float intensity;
        varying vec2 vUv;
        void main() {
          vec3 r = vec3(0.0);
          float w = 0.0;
          for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {
            float k = exp(-float(x * x + y * y) / 3.0);
            r += texture2D(tRays, vUv + vec2(x, y) * texel).rgb * k;
            w += k;
          }
          gl_FragColor = texture2D(tDiffuse, vUv);
          gl_FragColor.rgb += r / w * intensity;
        }`,
      depthTest: false,
      depthWrite: false,
    });
  }

  setSize(w: number, h: number) {
    this.half.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
    this.blend.uniforms.texel.value.set(1 / this.half.width, 1 / this.half.height);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.march.uniforms;
    const map = this.sun.shadow.map?.depthTexture ?? null;
    const depth = this.depth();
    const on = !!map && !!depth && this.intensity > 0;
    if (on) {
      u.tDepth.value = depth;
      u.tShadow.value = map;
      u.shadowMatrix.value.copy(this.sun.shadow.matrix);
      u.projInv.value.copy(this.camera.projectionMatrixInverse);
      u.camWorld.value.copy(this.camera.matrixWorld);
      u.camPos.value.setFromMatrixPosition(this.camera.matrixWorld);
      u.sunDir.value.subVectors(this.sun.target.position, this.sun.position).normalize();
      u.sunColor.value.copy(this.sun.color);
      renderer.setRenderTarget(this.half);
      this.quad.material = this.march;
      this.quad.render(renderer);
    }
    this.blend.uniforms.tDiffuse.value = readBuffer.texture;
    this.blend.uniforms.tRays.value = this.half.texture;
    this.blend.uniforms.intensity.value = on ? this.intensity : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.material = this.blend;
    this.quad.render(renderer);
  }

  dispose() {
    this.half.dispose();
    this.march.dispose();
    this.blend.dispose();
    this.quad.dispose();
  }
}
