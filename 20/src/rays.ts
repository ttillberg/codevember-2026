import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { NOISE3D } from './noise';
import { COVER } from './materials';

/** the fans in the end wall (hall.ts): daylight comes in through them, cut by the blades as they turn */
export interface Fans {
  list: { at: THREE.Vector3; angle: number }[];
  dir: THREE.Vector3;
  radius: number;
  hub: number;
  blades: number;
  wallZ: number;
  /** and the ones in the sun's wall, x = wallX: the sun comes in through those, the blades cut it */
  side: { at: THREE.Vector3; angle: number }[];
  sideScale: number;
  /** how open each wall's leaf shutters are, 0..1 */
  shutter: { end: number; side: number };
  wallX: number;
}

/**
 * Light in the haze, for real: from the eye out to whatever each pixel sees, a march through the air, and at
 * every step the sun's shadow map says whether the sun gets there. Where the roof, the trusses and the towers
 * stand in its way the air stays dark, so the light comes down through the structure in shafts and bars. Marched
 * at half the resolution, blurred a little on the way back up, added to the picture before the tone mapping.
 */
export class Rays extends Pass {
  intensity = 1;
  /** how fast the sun's light is used up on its way down from the roof, per metre */
  fade = 0.025;
  /** how patchy the air is: 0 even, 1 drifting smoke and dust */
  smoke = 0.8;
  /** and a glare right under the roof, so many times the rest, gone a few metres down */
  top = 16;
  topFade = 0.18;
  /** the light through the fans, against the sun's */
  fan = 3;
  /** and how fast it is used up on its way in, per metre */
  fanFade = 0.078;
  private half = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private march: THREE.ShaderMaterial;
  private blend: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private fans: Fans;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private sun: THREE.DirectionalLight,
    private podSun: THREE.DirectionalLight,
    private depth: () => THREE.Texture | null,
    o: { roof: number; box: THREE.Box3; density: number; steps?: number; fans: Fans },
  ) {
    super();
    this.fans = o.fans;
    const f = o.fans;
    this.march = new THREE.ShaderMaterial({
      defines: { STEPS: o.steps ?? 24, FANS: f.list.length, SIDES: f.side.length, BLADES: f.blades.toFixed(1), FAN_R: f.radius.toFixed(2), HUB: f.hub.toFixed(2) },
      uniforms: {
        tDepth: { value: null },
        tShadow: { value: null },
        tPod: { value: null },
        podMatrix: { value: new THREE.Matrix4() },
        podZone: { value: new THREE.Vector2() },
        tNoise: { value: NOISE3D },
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
        fade: { value: 0.025 },
        smoke: { value: 0.8 },
        top: { value: 16 },
        topFade: { value: 0.18 },
        time: { value: 0 },
        fans: { value: f.list.map(() => new THREE.Vector3()) },
        fanDir: { value: f.dir },
        wallZ: { value: f.wallZ },
        sides: { value: f.side.map(() => new THREE.Vector3()) },
        wallX: { value: f.wallX },
        sideScale: { value: f.sideScale },
        coverX: COVER.x,
        iris: { value: new THREE.Vector2(1, 1) },
        coverSun: COVER.sun,
        coverGlass: COVER.glass,
        fan: { value: 3 },
        fanFade: { value: 0.078 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        precision highp sampler2DShadow;
        uniform sampler2D tDepth;
        uniform sampler2DShadow tShadow, tPod;
        uniform highp sampler3D tNoise;
        uniform mat4 shadowMatrix, podMatrix, projInv, camWorld;
        uniform vec3 camPos, sunDir, sunColor, boxMin, boxMax;
        uniform vec2 podZone;
        uniform float roof, density, fade, smoke, top, topFade, time;
        uniform vec3 fans[FANS]; // the centre's x and y, and how far round the blades are
        uniform vec3 fanDir;
        #if SIDES > 0
        uniform vec3 sides[SIDES]; // in the sun's wall: z and y of the centre, how far round
        #endif
        uniform float wallZ, wallX, sideScale, fan, fanFade;
        uniform vec4 coverX, coverSun; // the roof's shutter (hall.ts, materials.ts)
        uniform vec4 coverGlass; // where the roof is glass: along x, along z
        uniform vec2 iris; // the fans' leaf shutters, the end wall's and the sun's wall's: 1 open, 0 shut
        // through the leaf shutter: inside the five-sided opening its blades' inner edges make (as hall.ts lays them)
        float leaf(vec2 o, float s) {
          if (s > 0.999) return 1.0;
          float a = s * (FAN_R + 0.3) - 0.08, turn = (1.0 - s) * 0.3, m = -1e9;
          for (int k = 0; k < 5; k++) { float an = turn + float(k) * 1.2566371; m = max(m, dot(o, vec2(cos(an), sin(an)))); }
          return smoothstep(a + 0.05, a - 0.05, m);
        }
        float cover(vec3 p) {
          float t = (coverSun.w - p.y) / max(coverSun.y, 0.05);
          if (t < 0.0) return 1.0;
          float hx = p.x + coverSun.x * t;
          // past the glass the roof is deck, out to the walls: no sun comes down through it. (The sun's map lets
          // specks of it by, and the shutter, which once lay over all of the roof when shut and hid them, stops
          // at the glass's end now: the dark under the roof was dotted with them.) What crosses the roof's
          // height outside the wall came in through the wall, and is let be
          if ((hx > coverGlass.y + 1.0 && hx < wallX) || hx < coverGlass.x - 1.0) return 0.0;
          // (and at the hall's two ends the same, along z: the specks were over the end wall's fans too)
          float hz = p.z + coverSun.z * t;
          if (hx < wallX && (hz < coverGlass.z - 1.0 || hz > coverGlass.w + 1.0)) return 0.0;
          if (coverX.w < 0.5) return 1.0;
          // (in the air its edge is not the half metre it is on the steel: the light comes on over 8 m behind it. As
          // it starts to roll back, the first slit lets in a sheet of light a hand thick, thinner than a step of
          // this march, and the air under the roof was dots where a step happened to land in it. Now a thin
          // sheet is a faint one, and it is full by the time it is thick enough to be met at every step)
          return 1.0 - smoothstep(coverX.x - coverX.z, coverX.x + coverX.z, hx) * (1.0 - smoothstep(coverX.y, coverX.y + 8.0, hx));
        }
        varying vec2 vUv;
        // how open a fan is at o from its centre, in the wall's plane: shut outside the drum and on the hub, by the
        // blades (broad at the tip, pitched, so a little narrower seen down the axis) and the three struts behind
        float vent(vec2 o, float turn) {
          float r = length(o);
          float a = atan(o.y, o.x);
          const float SEC = 6.2831853 / BLADES;
          float ab = abs(mod(a - turn + 0.5 * SEC, SEC) - 0.5 * SEC) * r;
          float w = mix(0.5, 1.3, clamp((r - HUB) / (FAN_R - 0.25 - HUB), 0.0, 1.0)) * 0.866;
          float open = smoothstep(w - 0.12, w + 0.12, ab);
          float as = abs(mod(a - 1.5707963 + 1.0471976, 2.0943951) - 1.0471976) * r;
          open *= smoothstep(0.08, 0.3, as);
          return open * smoothstep(FAN_R + 0.15, FAN_R - 0.1, r) * smoothstep(HUB - 0.1, HUB + 0.15, r);
        }
        // a fixed dither per pixel, so the steps do not show as bands; the blur after takes it out
        float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        // smoke and dust: big slow billows and finer wisps, drifting sideways and rising a little
        float air(vec3 p) {
          // (value noise, tiling, from a 3D texture: one fetch an octave instead of eight hashes)
          vec3 q = p * 0.06 + vec3(time * 0.012, -time * 0.006, time * 0.008);
          float n = texture(tNoise, q / 32.0).r * 0.62 + texture(tNoise, (q * 2.9 + vec3(4.1, time * 0.03, 1.3)) / 32.0).r * 0.38;
          return mix(1.0, smoothstep(0.28, 0.78, n) * 2.0, smoke);
        }
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
          float fsum = 0.0;
          // (the same for the light through the fans, looking into it brighter)
          float fmu = dot(rd, -fanDir);
          float fphase = 0.25 + 0.75 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * fmu, 1.5) / 4.0;
          for (int i = 0; i < STEPS; i++) {
            float t = tin + (float(i) + j) * dt;
            vec3 p = camPos + rd * t;
            vec4 s = shadowMatrix * vec4(p, 1.0);
            float lit = texture(tShadow, vec3(s.xy, s.z - 0.0008)) * cover(p);
            // the fans in the sun's wall: the map has the round holes, not the blades turning in them. Back up the
            // sun's light to the wall, and if it came in through a fan, how open it is there
            // And the small windows in that wall, a metre wide: their shafts are thinner than a step of this
            // march, which met each one or missed it by the dither, and they came out as rows of dots across the
            // dark (plain to see with the roof shut). What came in through the wall and not through a fan is left
            // out of the air; it still falls on the steel.
            if (p.x < wallX) {
              vec3 q = p - sunDir * ((p.x - wallX) / sunDir.x);
              bool fanned = false;
              #if SIDES > 0
              for (int k = 0; k < SIDES; k++) {
                vec2 o = vec2(q.z - sides[k].x, q.y - sides[k].y) / sideScale; // (bigger: the same fan, scaled)
                if (dot(o, o) < (FAN_R + 0.3) * (FAN_R + 0.3)) { lit *= vent(o, sides[k].z) * leaf(o, iris.y); fanned = true; }
              }
              #endif
              if (!fanned && q.y < roof) lit = 0.0;
            }
            // the hall's map has only the steel in it: the pod and its cables, from the pod's own sun. But only what
            // stands near the pod along the light: that map has the steel too, sharp to the millimetre, where the
            // hall's blurs the thin bars away, and the air in its column would come out darker than round it.
            // So: shadowed if the first thing the pod's sun meets is past the start of the pod's stretch of the light
            // (zs) and before the point, or the end of that stretch, whichever comes first (1 - ze)
            vec4 ps = podMatrix * vec4(p, 1.0);
            if (all(greaterThan(ps.xyz, vec3(0.0))) && all(lessThan(ps.xyz, vec3(1.0)))) {
              float zs = texture(tPod, vec3(ps.xy, podZone.x));
              float ze = texture(tPod, vec3(ps.xy, min(ps.z, podZone.y) - 0.0005));
              lit *= 1.0 - zs * (1.0 - ze);
            }
            // used up on the way down: the further below the roof along the light, the less is left
            float down = max(roof - p.y, 0.0) / max(-sunDir.y, 0.2);
            lit *= exp(-fade * down) + top * exp(-topFade * down);
            // the air thicker up where the light is, and less of it gets back to the eye from far
            float h = 0.55 + 0.45 * smoothstep(-30.0, roof, p.y);
            float w = h * air(p) * exp(-0.012 * t) * dt;
            sum += lit * w;
            // the fans: back along their light to the wall, and how open the fan is where it gets there
            float dz = p.z - wallZ;
            vec2 q = p.xy - fanDir.xy * (dz / fanDir.z);
            // (only where the light could be: the fans all sit at one height, so a band of the wall)
            if (dz > 0.0 && abs(q.y - fans[0].y) < FAN_R + 0.3) {
              float open = 0.0;
              // (the blades' pattern goes soft with the way from the wall, as light through a fan does, and by 45 m it
              // is the round of the fan at what the blades let by. Far from the wall the slices of light between
              // the blades were thinner than a step of this march, and left specks in the dark where one was met)
              float soft = smoothstep(12.0, 45.0, dz);
              for (int k = 0; k < FANS; k++) {
                vec2 o = q - fans[k].xy;
                float r = length(o);
                float round_ = 0.5 * smoothstep(FAN_R + 0.15 + 2.0 * soft, FAN_R - 0.1 - 2.0 * soft, r) * smoothstep(HUB - 0.1 - soft, HUB + 0.15 + soft, r);
                open += mix(vent(o, fans[k].z), round_, soft) * leaf(o, iris.x);
              }
              fsum += open * exp(-fanFade * dz) * w;
            }
          }
          gl_FragColor = vec4(sunColor * (sum * phase + fsum * fan * fphase) * density, 1.0);
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

  /** steps along each ray: fewer, cheaper, coarser (the dither and the blur hide most of it) */
  set steps(n: number) { this.march.defines.STEPS = n; this.march.needsUpdate = true; }
  get steps() { return this.march.defines.STEPS as number; }

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
      const pod = this.podSun.shadow.map?.depthTexture ?? null;
      u.tPod.value = pod ?? map;
      u.podMatrix.value.copy(this.podSun.shadow.matrix);
      if (!pod) u.podMatrix.value.makeScale(0, 0, 0); // nothing yet: every point falls outside it
      // the pod's stretch of its sun's depth: from 4 m before its centre (the cables over it) to 3 m past it
      const c = this.podSun.shadow.camera;
      const d = this.podSun.position.distanceTo(this.podSun.target.position);
      u.podZone.value.set((d - 4 - c.near) / (c.far - c.near), (d + 3 - c.near) / (c.far - c.near));
      u.projInv.value.copy(this.camera.projectionMatrixInverse);
      u.camWorld.value.copy(this.camera.matrixWorld);
      u.camPos.value.setFromMatrixPosition(this.camera.matrixWorld);
      u.sunDir.value.subVectors(this.sun.target.position, this.sun.position).normalize();
      u.sunColor.value.copy(this.sun.color);
      u.fade.value = this.fade;
      u.smoke.value = this.smoke;
      u.top.value = this.top;
      u.topFade.value = this.topFade;
      this.fans.list.forEach((f, i) => u.fans.value[i].set(f.at.x, f.at.y, f.angle));
      this.fans.side.forEach((f, i) => u.sides.value[i].set(f.at.z, f.at.y, f.angle));
      u.fan.value = this.fan;
      u.iris.value.set(this.fans.shutter.end, this.fans.shutter.side);
      u.fanFade.value = this.fanFade;
      u.time.value = performance.now() / 1000;
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

