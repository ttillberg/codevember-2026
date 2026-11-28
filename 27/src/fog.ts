// The air itself, lit. After day 20's light in the haze (its `rays.ts`: a march from the eye to whatever each pixel
// sees, at half resolution with a fixed dither, blurred on the way back up, added before the tone mapping), but here
// the light is the torch: at every step its cookie, its inverse square and its shadow map say how much of it gets
// there. Roots and stones cut dark blades out of the beam. And the dust is the same air, only thicker: wherever dirt
// comes down or a paw lands, a puff of density is put into the march, swells, sinks and thins out.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { U } from './gfx';

const PUFFS = 12;

interface Puff { p: THREE.Vector3; r: number; grow: number; a: number; life: number; age: number; vy: number }

export class Fog {
  /** scattering of the still air, per metre (with the phase function folded in) */
  density = 0.0036;
  /** how much thicker a full puff of dust is than that */
  dust = 0.026;
  on = true;
  private half = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private out = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private march: THREE.ShaderMaterial;
  private blend: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private puffs: Puff[] = [];

  constructor(steps = 20) {
    const vert = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    this.march = new THREE.ShaderMaterial({
      defines: { STEPS: steps, PUFFS },
      uniforms: {
        ...U,
        tDepth: { value: null },
        projInv: { value: new THREE.Matrix4() },
        camWorld: { value: new THREE.Matrix4() },
        camPos: { value: new THREE.Vector3() },
        uFog: { value: this.density },
        uPuff: { value: Array.from({ length: PUFFS }, () => new THREE.Vector4(0, 0, 0, 1)) },
        uPuffA: { value: new Float32Array(PUFFS) },
      },
      vertexShader: vert,
      fragmentShader: /* glsl */ `
        precision highp float;
        precision highp sampler3D;
        precision highp sampler2DShadow;
        uniform sampler2D tDepth;
        uniform sampler2DShadow uShadow;
        uniform sampler3D uNoise;
        uniform mat4 uLightVP, projInv, camWorld;
        uniform vec3 camPos, uLightPos, uLightDir, uLightCol, uMouth, uSky;
        uniform float uLightI, uDay, uTime, uFog;
        uniform vec4 uPuff[PUFFS];
        uniform float uPuffA[PUFFS];
        varying vec2 vUv;
        float cookie(float c) {
          float a = acos(clamp(c, -1.0, 1.0));
          return exp(-(a * a) / (0.17 * 0.17)) + 0.16 * exp(-(a * a) / (0.42 * 0.42));
        }
        // a fixed dither per pixel, so the steps do not show as bands; the blur after takes it out
        float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        void main() {
          float d = texture2D(tDepth, vUv).x;
          vec4 v = projInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          vec3 wp = (camWorld * vec4(v.xyz / v.w, 1.0)).xyz;
          vec3 rd = wp - camPos;
          float far = length(rd);
          rd /= far;
          float tout = min(far, 7.0);
          float j = ign(gl_FragCoord.xy);
          vec3 sum = vec3(0.0);
          float tau = 0.0;
          for (int i = 0; i < STEPS; i++) {
            // steps crowd towards the eye: the lamp is right beside it, and that is where the light is
            float a = (float(i) + j) / float(STEPS);
            float t = tout * a * a;
            float dt = tout * (2.0 * (float(i) + j) + 1.0) / float(STEPS * STEPS);
            vec3 p = camPos + rd * t;
            // still air is never even: slow billows, finer wisps
            vec3 q = p * 0.7 + vec3(uTime * 0.011, -uTime * 0.018, uTime * 0.008);
            float n = texture(uNoise, q).a * 0.5 + texture(uNoise, q * 2.7 + 0.4).a * 0.5;
            float dens = uFog * max(0.12, 1.0 + 1.7 * n);
            // dust is heavy: it hangs thickest below the eye, over the floor
            dens *= 1.0 + 0.5 * smoothstep(0.05, -0.16, p.y - camPos.y);
            // and it is the air of the burrow: out under the sky there is none of it, so the torch draws no clouds
            // on the day when we come back out
            float inside = smoothstep(0.2, -0.45, p.z - uMouth.z) * smoothstep(0.75, 0.45, p.y - uMouth.y);
            dens *= inside;
            for (int k = 0; k < PUFFS; k++) {
              if (uPuffA[k] > 0.0) {
                vec3 o = p - uPuff[k].xyz;
                dens += uPuffA[k] * exp(-dot(o, o) / (uPuff[k].w * uPuff[k].w)) * (0.55 + 0.9 * max(0.0, n + 0.5));
              }
            }
            // the torch: what of it reaches this bit of air
            vec3 L = uLightPos - p;
            float d2 = dot(L, L);
            vec3 l = L * inversesqrt(d2);
            float e = uLightI * cookie(dot(-l, uLightDir)) / (d2 + 0.025);
            vec4 sc = uLightVP * vec4(p, 1.0);
            if (sc.w > 0.0) {
              vec3 s = sc.xyz / sc.w * 0.5 + 0.5;
              if (s.x > 0.0 && s.x < 1.0 && s.y > 0.0 && s.y < 1.0 && s.z < 1.0) e *= texture(uShadow, s);
            }
            // (what scatters it is dust the colour of the ground, so the beam in the air is warmer than the lamp)
            vec3 light = uLightCol * vec3(1.0, 0.84, 0.66) * e;
            // and the day, for as far as it gets in through the mouth: brightest looking back into it
            vec3 Lm = p - uMouth;
            float dm2 = dot(Lm, Lm), dm = sqrt(dm2);
            float mu = dot(Lm / max(dm, 1e-3), -rd);
            float hg = 0.75 / pow(1.25 - mu, 1.5);
            // (through the even air, not the patchy: with the wisps in it the day came out of the mouth in rays)
            vec3 day = uSky * (uDay * (0.05 / (0.05 + dm2)) * smoothstep(3.2, 0.4, dm) * hg * 1.5);
            sum += (light * dens + day * (uFog * inside)) * (exp(-tau) * dt);
            tau += dens * 60.0 * dt;
          }
          gl_FragColor = vec4(sum, exp(-tau));
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.blend = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tFog: { value: null }, texel: { value: new THREE.Vector2() }, uOn: { value: 1 } },
      vertexShader: vert,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene, tFog;
        uniform vec2 texel;
        uniform float uOn;
        varying vec2 vUv;
        void main() {
          vec4 f = vec4(0.0);
          float w = 0.0;
          for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {
            float k = exp(-float(x * x + y * y) / 3.0);
            f += texture2D(tFog, vUv + vec2(x, y) * texel) * k;
            w += k;
          }
          f = mix(vec4(0.0, 0.0, 0.0, 1.0), f / w, uOn);
          // what is behind the air is seen through it, and the air's own light comes on top
          gl_FragColor = vec4(texture2D(tScene, vUv).rgb * f.a + f.rgb, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
  }

  setSize(w: number, h: number) {
    this.half.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
    this.out.setSize(w, h);
    this.blend.uniforms.texel.value.set(1 / this.half.width, 1 / this.half.height);
  }

  /** Dust let loose at p: how much (1 a proper fall of dirt), how wide it starts and ends, how long it hangs, how fast it sinks. */
  puff(p: THREE.Vector3, amount: number, r0 = 0.07, r1 = 0.3, life = 5, vy = -0.05) {
    const puff: Puff = { p: p.clone(), r: r0, grow: (r1 - r0) / life, a: amount, life, age: 0, vy };
    if (this.puffs.length < PUFFS) this.puffs.push(puff);
    else {
      // no room: the faintest one gives way
      let w = 0;
      for (let i = 1; i < PUFFS; i++) if (this.strength(this.puffs[i]) < this.strength(this.puffs[w])) w = i;
      if (this.strength(this.puffs[w]) < amount) this.puffs[w] = puff;
    }
  }

  private strength(f: Puff) {
    // quick to bloom, slow to clear; and the same dust spread wider is thinner
    const t = f.age / f.life;
    return f.a * Math.min(1, f.age / 0.25) * (1 - t) * (1 - t) * Math.min(1, (0.1 / f.r) ** 2 + 0.25);
  }

  update(dt: number) {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const f = this.puffs[i];
      f.age += dt;
      f.r += f.grow * dt;
      f.p.y += f.vy * dt;
      f.vy *= Math.exp(-dt * 0.9);
      if (f.age >= f.life) this.puffs.splice(i, 1);
    }
    const u = this.march.uniforms;
    for (let i = 0; i < PUFFS; i++) {
      const f = this.puffs[i];
      if (f) u.uPuff.value[i].set(f.p.x, f.p.y, f.p.z, f.r);
      u.uPuffA.value[i] = f ? this.strength(f) * this.dust : 0;
    }
  }

  /** The scene's frame with the air laid over it. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.WebGLRenderTarget, camera: THREE.PerspectiveCamera): THREE.WebGLRenderTarget {
    const u = this.march.uniforms;
    if (this.on) {
      u.tDepth.value = scene.depthTexture;
      u.projInv.value.copy(camera.projectionMatrixInverse);
      u.camWorld.value.copy(camera.matrixWorld);
      u.camPos.value.setFromMatrixPosition(camera.matrixWorld);
      u.uFog.value = this.density;
      renderer.setRenderTarget(this.half);
      this.quad.material = this.march;
      this.quad.render(renderer);
    }
    const b = this.blend.uniforms;
    b.tScene.value = scene.texture;
    b.tFog.value = this.half.texture;
    b.uOn.value = this.on ? 1 : 0;
    renderer.setRenderTarget(this.out);
    this.quad.material = this.blend;
    this.quad.render(renderer);
    return this.out;
  }
}
