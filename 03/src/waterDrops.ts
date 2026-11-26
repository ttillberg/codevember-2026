import * as THREE from 'three';
import { clamp, fbm3, mulberry32, smoothstep } from './rng';
import { DEFAULT_BOTTOM_POOL, getMeltBounds, getStructuralMelt, MeltFieldState, POPSICLE, sampleLocalHeat } from './shape';
import { PopsicleIceSystem } from './popsicleIce';
import { FILM_U, LiquidFilmSystem } from './liquidFilm';
import { DEFAULT_RECIPE, PopsicleRecipe, resolveOpticalPalette } from './recipe';

// Strict WebGL2/Metal/Adreno portable GLSL helpers (no pow(negative, 2.0), no inverted smoothstep, no zero normalize)
const GLSL_SAFE_HELPERS = /* glsl */ `
  float sq(float x) { return x * x; }
  float revStep(float hi, float lo, float x) { return 1.0 - smoothstep(lo, hi, x); }
  vec3 safeNorm(vec3 v) { return v * inversesqrt(max(dot(v, v), 1e-8)); }
`;

export type DropMode = 'minimal' | 'full' | 'off';

export interface DropDebugParams {
  /** Gravity teardrop asymmetry / downward heaviness [0..1.6] */
  sag: number;
  /** Vertical elongation multiplier on side & sliding drops [0.85..1.8] */
  stretch: number;
  /** Border softness, feathering & subtle optical rim blur [0..1.5] */
  edgeBlur: number;
  /** Directional cast shadow & contact occlusion strength on ice [0..1.5] */
  shadow: number;
  /** Shadow penumbra spread & softness [0.2..2.0] */
  shadowBlur: number;
  /** Dark optical glass contour rim strength [0..1.5] */
  rimDark: number;
  /** Overall surface drop scale multiplier [0.5..1.8] */
  size: number;
  /** Bottom-rim pooled liquid accumulation fullness [0..2.0] */
  bottomPool: number;
  /** Bottom pendant drip frequency multiplier [0..2.0] */
  dripRate: number;
  /** Number of clinging crystal drops along the bottom rim [0..80] */
  bottomDrops: number;
}

export const MAX_BOTTOM_DROPS = 80;

export const DEFAULT_DROP_DEBUG: DropDebugParams = {
  sag: 0.54,
  stretch: 1.51,
  edgeBlur: 1.20,
  shadow: 0.44,
  shadowBlur: 1.05,
  rimDark: 0.48,
  size: 1.00,
  bottomPool: DEFAULT_BOTTOM_POOL,
  dripRate: 0.76,
  bottomDrops: 10,
};

export interface WaterDropUniforms {
  uSceneTex: { value: THREE.Texture | null };
  uDropFieldTex: { value: THREE.Texture | null };
  uResolution: { value: THREE.Vector2 };
  uTime: { value: number };
  uDropSag: { value: number };
  uDropStretch: { value: number };
  uDropSize: { value: number };
  uEdgeSoftness: { value: number };
  uShadowStrength: { value: number };
  uShadowBlur: { value: number };
  uRimDark: { value: number };
  uDropSigma: { value: THREE.Vector3 };
  uDropCreamColor: { value: THREE.Vector3 };
  uDropOpacity: { value: number };
  uShadowTint: { value: THREE.Vector3 };
  uStainColor: { value: THREE.Vector3 };
}

export interface WaterDropSystem {
  fieldScene: THREE.Scene;
  resolveScene: THREE.Scene;
  pendantGroup: THREE.Group;
  uniforms: WaterDropUniforms;
  setMode(mode: DropMode): void;
  getMode(): DropMode;
  setDebugParams(partial: Partial<DropDebugParams>): void;
  getDebugParams(): DropDebugParams;
  /** True when at least one surface metaball splat needs Pass 6a (`dropFieldRT`) rendering */
  hasDropField(): boolean;
  /** Live-updates drop absorption, creamy opacity, underside pools & stick syrup tint for custom recipes */
  setRecipe(recipe: PopsicleRecipe): void;
  /** Instantly bead up tiny glistening micro-drops where the pointer just melted freezer frost */
  spawnFrostMeltDrops(uNorm: number, vNorm: number, meltedAmount: number, film: LiquidFilmSystem): void;
  /** Clears transient frost-melt condensation beads (e.g. when scrubbing melt slider directly) */
  clearFrostDrops(): void;
  reset(): void;
  update(
    state: MeltFieldState,
    ice: PopsicleIceSystem,
    film: LiquidFilmSystem,
    dt: number,
    meltSpeedMul: number,
  ): void;
  dispose(): void;
}

interface SurfaceDrop {
  uNorm: number;
  vNorm: number;
  initU: number;
  initV: number;
  radius: number;
  initRadius: number;
  maxRadius: number;
  growRate: number;
  /** Downward velocity in vNorm/sec (positive = moving down) */
  velV: number;
  /** Lateral velocity in uNorm/sec (meandering around frost & into wet channels!) */
  velU: number;
  /** True when contact-angle hysteresis is currently broken (surging liquid drop!) */
  sliding: boolean;
  /** Individual surface pinning resistance (creates natural stop-and-go stick-slip bursts!) */
  pinBias: number;
  /** Accumulated distance slid since last continuous rivulet trail node */
  trailDistAccum: number;
  /** Arc length counter along current run (drives Rayleigh-Plateau trail breakup!) */
  runArcLen: number;
  /** Post-merge capillary wobble */
  wobble: number;
  wobblePhase: number;
  isRim: boolean;
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  alive: boolean;
  respawnDelay: number;
}

interface TrailNode {
  uNorm: number;
  vNorm: number;
  baseRadius: number;
  /** Remaining lifetime [0..1] */
  life: number;
  maxLife: number;
  /** Arc-length phase for physical Rayleigh-Plateau pinch breakup as the trail ages! */
  arcPhase: number;
  /** 0.35 = thin glistening wet film trail; 0.72 = thick freshly-shed tail */
  plumpness: number;
  juiceTint: number;
  pos: THREE.Vector3;
  normal: THREE.Vector3;
}

type PendantStage = 'dormant' | 'growing' | 'pinching' | 'recoiling';

interface PendantDrop {
  side: -1 | 1;
  /** Fractional target across the live safe flat-underside span [0 = near stick .. 1 = safely inset from outer corner] */
  slotFrac: number;
  /** Minimum safe flat-underside span required before this extra drop activates (gracefully thins at late melt) */
  minSpan: number;
  lobeIndex: 0 | 1 | 2 | 3;
  anchorU: number;
  initAnchorU: number;
  anchorV: number;
  stage: PendantStage;
  initStage: PendantStage;
  /** Accumulated dimensionless volume [0..1] during 'growing' stage */
  grow: number;
  initGrow: number;
  /** Real-time elapsed seconds inside 'dormant', 'pinching', or 'recoiling' */
  stageTime: number;
  dormantDuration: number;
  pinchDuration: number;
  recoilDuration: number;
  growRate: number;
  scale: number;
  neckGeo: THREE.BufferGeometry;
  neckMesh: THREE.Mesh;
  fallMesh: THREE.Mesh;
  fallActive: boolean;
  fallTime: number;
  fallPos: THREE.Vector3;
  fallVelY: number;
  fallR: number;
  /** Pinch-point local Y preserved at snap moment so recoil smoothly retracts from the exact snap height */
  recoilStartY: number;
  /** Cached safe underside bounds from last per-side bottom scan (prevents dormant minSpan bypass!) */
  slotFits: boolean;
  minSafeAbsX: number;
  maxSafeAbsX: number;
}

const MAX_SURFACE_DROPS = 520;
const MAX_TRAIL_NODES = 1200;
const MAX_FROST_DROPS = 180;
const TOTAL_METABALLS = MAX_SURFACE_DROPS + MAX_TRAIL_NODES + MAX_FROST_DROPS;

// Persistent 2D surface wetness & micro-roughness grid wrapped around (uNorm, vNorm)
// Enables REAL liquid memory: sliding drops paint low-friction wet rivulets that pull subsequent drops into shared meandering streams!
const WET_U = 96;
const WET_V = 96;

/**
 * Pass 6a: Additive Metaball Kernel Splat Material for BOTH plump droplets & continuous wet rivulet trails!
 * Channels accumulated in `dropFieldRT` (RGBA HalfFloat):
 *   R = dimensionless liquid potential Phi
 *   G = screen-pixel-radius-weighted potential (R_px * Phi)
 *   B = dome plumpness weighted potential (plump * Phi: 1.0 = round drop, ~0.35 = flat wet rivulet film!)
 *   A = berry-juice tint weighted potential (tint * Phi)
 */
function createMetaballSplatMaterial(sharedUniforms: WaterDropUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    // True linear additive (ONE + ONE) so .a (juiceTint) NEVER attenuates .rgb metaball channels!
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uResolution: sharedUniforms.uResolution,
      uDropSag: sharedUniforms.uDropSag,
      uDropStretch: sharedUniforms.uDropStretch,
      uDropSize: sharedUniforms.uDropSize,
    },
    vertexShader: /* glsl */ `
      // aCenter = xyz world position on live ice surface
      // aNormal = xyz outward ice surface normal
      // aParams = (worldRadius, aspectY, plumpness, juiceTint)
      // aMotion = (tiltAngleRad, wobbleAmt, gravitySag)
      attribute vec3 aCenter;
      attribute vec3 aNormal;
      attribute vec4 aParams;
      attribute vec3 aMotion;

      uniform vec2 uResolution;
      uniform float uDropSag;
      uniform float uDropStretch;
      uniform float uDropSize;

      varying vec2 vLocal;
      varying float vRadiusPx;
      varying float vPlumpness;
      varying float vJuiceTint;
      varying float vVisibility;
      varying float vSag;

      void main() {
        float r = aParams.x * uDropSize;
        float baseAspectY = aParams.y;
        float plumpness = aParams.z;
        float juiceTint = aParams.w;
        float tilt = aMotion.x;
        float wobble = aMotion.y;
        float rawSag = aMotion.z;

        vLocal = position.xy * 2.0; // [-1, 1]
        vPlumpness = plumpness;
        vJuiceTint = juiceTint;
        vSag = clamp(rawSag * uDropSag, 0.0, 1.65);

        if (r < 0.0004) {
          vVisibility = 0.0;
          vRadiusPx = 0.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        vec3 V = normalize(cameraPosition - aCenter);
        float ndv = dot(normalize(aNormal), V);

        vVisibility = smoothstep(-0.22, 0.06, ndv);
        if (vVisibility <= 0.001) {
          vRadiusPx = 0.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        // Grazing silhouette drops clear the curved ice shoulder smoothly without hard vertical depth slicing
        float rimBias = mix(r * 3.4, r * 0.68, smoothstep(-0.08, 0.48, ndv));
        vec3 worldCenter = aCenter + aNormal * (r * 0.20) + V * rimBias;
        vec4 mvCenter = viewMatrix * vec4(worldCenter, 1.0);

        float projScaleY = projectionMatrix[1][1];
        vRadiusPx = max(1.4, (r * projScaleY * (0.5 * uResolution.y)) / max(0.25, -mvCenter.z));

        // Gravity-heavy teardrop vertical elongation scales smoothly with uDropStretch & per-drop sag weight!
        float stretchWeight = 0.28 + 0.72 * clamp(rawSag, 0.0, 1.25);
        float aspectY = max(0.92, baseAspectY * (1.0 + (uDropStretch - 1.0) * stretchWeight));

        // Generous quad padding guarantees bottom-heavy teardrop bellies NEVER clip at quad bounds
        float rx = r * 1.64 * (1.0 - wobble * 0.14);
        float ry = r * 1.60 * aspectY * (1.0 + wobble * 0.14);

        vec2 localOff = vec2(position.x * 2.0 * rx, position.y * 2.0 * ry);
        // Align elongated sliding droplet & rivulet trail along its actual meandering flow direction!
        float ct = cos(tilt);
        float st = sin(tilt);
        vec2 rotOff = vec2(localOff.x * ct - localOff.y * st, localOff.x * st + localOff.y * ct);
        rotOff.y -= r * (aspectY - 1.0) * 0.24;

        mvCenter.xy += rotOff;
        gl_Position = projectionMatrix * mvCenter;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vLocal;
      varying float vRadiusPx;
      varying float vPlumpness;
      varying float vJuiceTint;
      varying float vVisibility;
      varying float vSag;

      void main() {
        vec2 p = vLocal;
        float s = vSag;

        // C-infinity boundary-preserving Mobius gravity warp on [-1, 1]:
        // Shifts the dome peak & center of mass LOWER into a heavy hanging belly while lengthening the upper taper!
        float shift = clamp(0.28 * s, 0.0, 0.44);
        float py = (p.y + shift) / (1.0 + shift * p.y);

        // Teardrop width profile: narrower clinging upper shoulder/tail, fuller heavier lower belly
        float topT = clamp(py, 0.0, 1.0);
        float botT = clamp(-py, 0.0, 1.0);
        float taperX = 1.0 + s * (0.48 * topT + 0.28 * topT * topT) - s * 0.15 * botT * (1.0 - 0.35 * botT);

        // 1.12 horizontal pad scale guarantees d2 >= 1 before |vLocal.x| = 1 even at max sag
        vec2 q = vec2(p.x * 1.12 * taperX, py);
        float d2 = dot(q, q);
        if (d2 >= 1.0) discard;

        // C1-smooth cubic metaball kernel -> continuous liquid bridges & smooth gravity-weighted domes!
        float m = 1.0 - d2;
        float phi = m * m * m * vVisibility;

        gl_FragColor = vec4(phi, phi * vRadiusPx, phi * vPlumpness, phi * vJuiceTint);
      }
    `,
  });
}

/**
 * Pass 6b: Fullscreen Liquid Optical Resolve Shader.
 * Resolves BOTH tall hemispherical merged droplets (`plump ≈ 1.0`) AND delicate flatter
 * glistening wet rivulet traces (`plump ≈ 0.35..0.55`) seamlessly from the SAME unified liquid field!
 */
function createMetaballResolveMaterial(sharedUniforms: WaterDropUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uSceneTex: sharedUniforms.uSceneTex,
      uDropFieldTex: sharedUniforms.uDropFieldTex,
      uHasDropField: { value: 0.0 },
      uResolution: sharedUniforms.uResolution,
      uEdgeSoftness: sharedUniforms.uEdgeSoftness,
      uShadowStrength: sharedUniforms.uShadowStrength,
      uShadowBlur: sharedUniforms.uShadowBlur,
      uRimDark: sharedUniforms.uRimDark,
      uDropSigma: sharedUniforms.uDropSigma,
      uDropCreamColor: sharedUniforms.uDropCreamColor,
      uDropOpacity: sharedUniforms.uDropOpacity,
      uShadowTint: sharedUniforms.uShadowTint,
      uStainColor: sharedUniforms.uStainColor,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform sampler2D uSceneTex;
      uniform sampler2D uDropFieldTex;
      uniform float uHasDropField;
      uniform vec2 uResolution;
      uniform float uEdgeSoftness;
      uniform float uShadowStrength;
      uniform float uShadowBlur;
      uniform float uRimDark;
      uniform vec3 uDropSigma;
      uniform vec3 uDropCreamColor;
      uniform float uDropOpacity;
      uniform vec3 uShadowTint;
      uniform vec3 uStainColor;

      varying vec2 vUv;

      const float ISO_THRESH = 0.34;
      ${GLSL_SAFE_HELPERS}

      float evalDomeHeightPx(vec4 f) {
        float phi = f.r;
        float e = max(0.0, phi - ISO_THRESH);
        if (e <= 0.0) return 0.0;
        float invPhi = 1.0 / max(phi, 0.0001);
        float rEff = f.g * invPhi;
        float plump = clamp(f.b * invPhi, 0.22, 1.0);
        // Tall convex dome for plump drops; delicate lower-profile wet meniscus for thin rivulet trails!
        float dome = sqrt(e / (e + 0.42));
        return rEff * dome * (0.26 + 0.62 * plump);
      }

      void main() {
        vec4 baseSample = texture2D(uSceneTex, vUv);
        vec3 baseScene = baseSample.rgb;
        float baseTag = baseSample.a;

        vec2 tx = 1.0 / uResolution;
        float pxScale = clamp(uResolution.y / 1000.0, 0.65, 2.4);

        // === CAPILLARY SURFACE-TENSION MENISCUS WHERE UNCOVERED BERRY/FRUIT MEETS MELTING ICE ===
        // postIceRT.a tags: 0.00 = studio air, 0.25 = open ice, 0.55 = contact-zone ice, 1.00 = uncovered solid.
        // Fast probe skips >94% of pixels; seam pixels use a symmetric C∞ Gaussian bell (4 * sFrac * iFrac)
        // with zero discontinuity across the 1px boundary and zero studio-air bleed!
        if (baseTag > 0.42) {
          bool isSolidPx = baseTag > 0.78;
          vec2 r1 = (2.0 * pxScale) * tx;
          vec2 r2 = (4.2 * pxScale) * tx;
          vec2 pR = (6.2 * pxScale) * tx;

          vec4 p0 = texture2D(uSceneTex, vUv + vec2( pR.x,   0.0));
          vec4 p1 = texture2D(uSceneTex, vUv + vec2(-pR.x,   0.0));
          vec4 p2 = texture2D(uSceneTex, vUv + vec2(  0.0,  pR.y));
          vec4 p3 = texture2D(uSceneTex, vUv + vec2(  0.0, -pR.y));

          vec4 c0 = texture2D(uSceneTex, vUv + vec2( r1.x,  r1.y));
          vec4 c1 = texture2D(uSceneTex, vUv + vec2(-r1.x,  r1.y));
          vec4 c2 = texture2D(uSceneTex, vUv + vec2( r1.x, -r1.y));
          vec4 c3 = texture2D(uSceneTex, vUv + vec2(-r1.x, -r1.y));

          float oppProbe = 0.0;
          if (isSolidPx) {
            oppProbe += ((p0.a > 0.40 && p0.a < 0.72) ? 1.0 : 0.0) + ((p1.a > 0.40 && p1.a < 0.72) ? 1.0 : 0.0)
                      + ((p2.a > 0.40 && p2.a < 0.72) ? 1.0 : 0.0) + ((p3.a > 0.40 && p3.a < 0.72) ? 1.0 : 0.0)
                      + ((c0.a > 0.40 && c0.a < 0.72) ? 1.0 : 0.0) + ((c1.a > 0.40 && c1.a < 0.72) ? 1.0 : 0.0)
                      + ((c2.a > 0.40 && c2.a < 0.72) ? 1.0 : 0.0) + ((c3.a > 0.40 && c3.a < 0.72) ? 1.0 : 0.0);
          } else {
            oppProbe += ((p0.a > 0.78) ? 1.0 : 0.0) + ((p1.a > 0.78) ? 1.0 : 0.0)
                      + ((p2.a > 0.78) ? 1.0 : 0.0) + ((p3.a > 0.78) ? 1.0 : 0.0)
                      + ((c0.a > 0.78) ? 1.0 : 0.0) + ((c1.a > 0.78) ? 1.0 : 0.0)
                      + ((c2.a > 0.78) ? 1.0 : 0.0) + ((c3.a > 0.78) ? 1.0 : 0.0);
          }

          if (oppProbe > 0.01) {
            vec4 m0 = texture2D(uSceneTex, vUv + vec2( r2.x,   0.0));
            vec4 m1 = texture2D(uSceneTex, vUv + vec2(-r2.x,   0.0));
            vec4 m2 = texture2D(uSceneTex, vUv + vec2(  0.0,  r2.y));
            vec4 m3 = texture2D(uSceneTex, vUv + vec2(  0.0, -r2.y));
            vec4 f0 = texture2D(uSceneTex, vUv + vec2( pR.x * 0.75,  pR.y * 0.75));
            vec4 f1 = texture2D(uSceneTex, vUv + vec2(-pR.x * 0.75,  pR.y * 0.75));
            vec4 f2 = texture2D(uSceneTex, vUv + vec2( pR.x * 0.75, -pR.y * 0.75));
            vec4 f3 = texture2D(uSceneTex, vUv + vec2(-pR.x * 0.75, -pR.y * 0.75));

            // Accumulate symmetric Gaussian blur + smooth solid/contact-ice fractions (strictly excluding studio air!)
            vec3 blurSum = baseScene * 1.15;
            float wSum = 1.15;
            float sSum = isSolidPx ? 1.15 : 0.0;
            float iSum = isSolidPx ? 0.0 : 1.15;

            if (c0.a > 0.15) { blurSum += c0.rgb * 1.00; wSum += 1.00; if (c0.a > 0.78) sSum += 1.00; else if (c0.a > 0.40) iSum += 1.00; }
            if (c1.a > 0.15) { blurSum += c1.rgb * 1.00; wSum += 1.00; if (c1.a > 0.78) sSum += 1.00; else if (c1.a > 0.40) iSum += 1.00; }
            if (c2.a > 0.15) { blurSum += c2.rgb * 1.00; wSum += 1.00; if (c2.a > 0.78) sSum += 1.00; else if (c2.a > 0.40) iSum += 1.00; }
            if (c3.a > 0.15) { blurSum += c3.rgb * 1.00; wSum += 1.00; if (c3.a > 0.78) sSum += 1.00; else if (c3.a > 0.40) iSum += 1.00; }

            if (m0.a > 0.15) { blurSum += m0.rgb * 0.78; wSum += 0.78; if (m0.a > 0.78) sSum += 0.78; else if (m0.a > 0.40) iSum += 0.78; }
            if (m1.a > 0.15) { blurSum += m1.rgb * 0.78; wSum += 0.78; if (m1.a > 0.78) sSum += 0.78; else if (m1.a > 0.40) iSum += 0.78; }
            if (m2.a > 0.15) { blurSum += m2.rgb * 0.78; wSum += 0.78; if (m2.a > 0.78) sSum += 0.78; else if (m2.a > 0.40) iSum += 0.78; }
            if (m3.a > 0.15) { blurSum += m3.rgb * 0.78; wSum += 0.78; if (m3.a > 0.78) sSum += 0.78; else if (m3.a > 0.40) iSum += 0.78; }

            if (p0.a > 0.15) { blurSum += p0.rgb * 0.48; wSum += 0.48; if (p0.a > 0.78) sSum += 0.48; else if (p0.a > 0.40) iSum += 0.48; }
            if (p1.a > 0.15) { blurSum += p1.rgb * 0.48; wSum += 0.48; if (p1.a > 0.78) sSum += 0.48; else if (p1.a > 0.40) iSum += 0.48; }
            if (p2.a > 0.15) { blurSum += p2.rgb * 0.48; wSum += 0.48; if (p2.a > 0.78) sSum += 0.48; else if (p2.a > 0.40) iSum += 0.48; }
            if (p3.a > 0.15) { blurSum += p3.rgb * 0.48; wSum += 0.48; if (p3.a > 0.78) sSum += 0.48; else if (p3.a > 0.40) iSum += 0.48; }

            if (f0.a > 0.15) { blurSum += f0.rgb * 0.42; wSum += 0.42; if (f0.a > 0.78) sSum += 0.42; else if (f0.a > 0.40) iSum += 0.42; }
            if (f1.a > 0.15) { blurSum += f1.rgb * 0.42; wSum += 0.42; if (f1.a > 0.78) sSum += 0.42; else if (f1.a > 0.40) iSum += 0.42; }
            if (f2.a > 0.15) { blurSum += f2.rgb * 0.42; wSum += 0.42; if (f2.a > 0.78) sSum += 0.42; else if (f2.a > 0.40) iSum += 0.42; }
            if (f3.a > 0.15) { blurSum += f3.rgb * 0.42; wSum += 0.42; if (f3.a > 0.78) sSum += 0.42; else if (f3.a > 0.40) iSum += 0.42; }

            vec3 seamBlur = blurSum / wSum;

            // Symmetric C∞ bell curve: peaks at 1.00 right on the exact boundary (sFrac = iFrac = 0.5),
            // identical on both sides of the 1px seam, and decays smoothly to 0.0 away from the waterline!
            float sFrac = sSum / wSum;
            float iFrac = iSum / wSum;
            float seamBell = clamp(4.0 * sFrac * iFrac, 0.0, 1.0);

            // 1. Continuous optical surface-tension blur dissolving the depth-buffer seam seamlessly
            baseScene = mix(baseScene, seamBlur, smoothstep(0.0, 0.92, seamBell) * 0.95);

            // 2. Soft concave capillary contact shadow where wet syrup pools in the berry-ice crease
            float shadowBell = pow(seamBell, 1.45);
            vec3 creaseTint = mix(vec3(0.36, 0.34, 0.34), uShadowTint, 0.78);
            baseScene = mix(baseScene, baseScene * creaseTint, shadowBell * 0.46);
          }
        }

        // Skip all drop-field fetches when Pass 6a had zero active splats (still keeps berry-ice seam blur above!)
        if (uHasDropField < 0.5) {
          gl_FragColor = vec4(baseScene, baseTag);
          return;
        }

        vec4 fC = texture2D(uDropFieldTex, vUv);
        float phi = fC.r;

        // Quick directional shadow probe slightly above & left of pixel (key light casts shadow down & right!)
        vec2 shDir = vec2(-0.22, 1.0);
        vec2 shProbeUv = vUv + shDir * (2.6 * uShadowBlur * pxScale) * tx;
        vec4 fShProbe = texture2D(uDropFieldTex, shProbeUv);

        // Ultra-fast early exit on ~90% of pixels with zero nearby droplet or cast shadow!
        if (phi <= 0.008 && fShProbe.r <= 0.025) {
          gl_FragColor = vec4(baseScene, baseTag);
          return;
        }

        // Exact popsicle/solid vs backdrop-air mask from postIceRT.a (works identically on Pure Coconut & dark berries!)
        float onIceMask = smoothstep(0.05, 0.20, baseTag);

        // Soft directional cast shadow + subtle meniscus contact occlusion around/beneath each drop
        vec3 shadowedBase = baseScene;
        if (uShadowStrength > 0.005 && onIceMask > 0.01) {
          float shR = fShProbe.r > 0.01 ? clamp(fShProbe.g / fShProbe.r, 2.0, 26.0) : 5.0;
          float shOffsetPx = (1.1 + shR * 0.16) * (0.65 + 0.55 * uShadowBlur) * pxScale;
          vec2 shCenterUv = vUv + shDir * shOffsetPx * tx;
          vec2 sp = (1.55 + 2.35 * uShadowBlur) * pxScale * tx;

          vec4 s0 = texture2D(uDropFieldTex, shCenterUv);
          vec4 s1 = texture2D(uDropFieldTex, shCenterUv + vec2(-sp.x,  sp.y));
          vec4 s2 = texture2D(uDropFieldTex, shCenterUv + vec2( sp.x,  sp.y));
          vec4 s3 = texture2D(uDropFieldTex, shCenterUv + vec2(-sp.x, -sp.y));
          vec4 s4 = texture2D(uDropFieldTex, shCenterUv + vec2( sp.x, -sp.y));
          vec4 shAvg = (s0 * 2.0 + s1 + s2 + s3 + s4) * (1.0 / 6.0);

          float shPhi = shAvg.r;
          float shInvPhi = 1.0 / max(shPhi, 0.0001);
          float shPlump = clamp(shAvg.b * shInvPhi, 0.25, 1.0);
          float shJuice = clamp(shAvg.a * shInvPhi, 0.0, 1.0);

          float castSh = smoothstep(0.05, ISO_THRESH + 0.16, shPhi);
          // Delicate omnidirectional contact halo hugging the outer wet meniscus ring
          float haloSpan = 0.09 + 0.08 * uShadowBlur;
          float haloSh = smoothstep(ISO_THRESH - haloSpan, ISO_THRESH + 0.02, phi) *
                         (1.0 - smoothstep(ISO_THRESH - 0.01, ISO_THRESH + 0.07, phi));
          float shAmt = clamp((castSh * 0.72 + haloSh * 0.42) * uShadowStrength * onIceMask * (0.42 + 0.58 * shPlump), 0.0, 0.76);
          vec3 shadowTint = mix(uShadowTint, uShadowTint * 0.76, shJuice);
          shadowedBase = mix(baseScene, baseScene * shadowTint, shAmt);
        }

        // Pure shadow pixel outside the feathered drop boundary -> skip expensive Sobel & refraction!
        float outerMargin = max(0.032, 0.095 * uEdgeSoftness + 0.024);
        if (phi <= ISO_THRESH - outerMargin) {
          gl_FragColor = vec4(shadowedBase, baseTag);
          return;
        }

        vec4 fTL = texture2D(uDropFieldTex, vUv + vec2(-tx.x,  tx.y));
        vec4 fT  = texture2D(uDropFieldTex, vUv + vec2(  0.0,  tx.y));
        vec4 fTR = texture2D(uDropFieldTex, vUv + vec2( tx.x,  tx.y));
        vec4 fL  = texture2D(uDropFieldTex, vUv + vec2(-tx.x,   0.0));
        vec4 fR  = texture2D(uDropFieldTex, vUv + vec2( tx.x,   0.0));
        vec4 fBL = texture2D(uDropFieldTex, vUv + vec2(-tx.x, -tx.y));
        vec4 fB  = texture2D(uDropFieldTex, vUv + vec2(  0.0, -tx.y));
        vec4 fBR = texture2D(uDropFieldTex, vUv + vec2( tx.x, -tx.y));

        float hTL = evalDomeHeightPx(fTL);
        float hT  = evalDomeHeightPx(fT);
        float hTR = evalDomeHeightPx(fTR);
        float hL  = evalDomeHeightPx(fL);
        float hR  = evalDomeHeightPx(fR);
        float hBL = evalDomeHeightPx(fBL);
        float hB  = evalDomeHeightPx(fB);
        float hBR = evalDomeHeightPx(fBR);

        float gradPhi = length(vec2(fR.r - fL.r, fT.r - fB.r)) * 0.5;

        float dhdx = ((hTR + 2.0 * hR + hBR) - (hTL + 2.0 * hL + hBL)) * 0.125;
        float dhdy = ((hTL + 2.0 * hT + hTR) - (hBL + 2.0 * hB + hBR)) * 0.125;

        vec2 slope = vec2(dhdx, dhdy);
        float slopeCap = mix(3.6, 2.35, clamp(uEdgeSoftness * 0.60, 0.0, 0.85));
        float slopeLen = length(slope);
        if (slopeLen > slopeCap) {
          slope *= slopeCap / slopeLen;
        }
        vec3 N = normalize(vec3(-slope.x * 1.15, -slope.y * 1.15, 1.0));
        vec3 V = vec3(0.0, 0.0, 1.0);
        float ndv = clamp(N.z, 0.0, 1.0);

        float invPhi = 1.0 / max(phi, 0.0001);
        float rEff = fC.g * invPhi;
        float plump = clamp(fC.b * invPhi, 0.22, 1.0);
        float juiceTint = clamp(fC.a * invPhi, 0.0, 1.0);

        // Refraction bends strongly in tall droplets and gently in flat glistening wet trails!
        float refrPx = clamp(rEff * (0.45 + 0.72 * plump), 2.0, 34.0);
        vec2 refrOffset = -N.xy * refrPx * tx * (0.72 + 0.55 * (1.0 - ndv));

        vec2 uvR = clamp(vUv + refrOffset * 0.94, vec2(0.002), vec2(0.998));
        vec2 uvG = clamp(vUv + refrOffset * 1.00, vec2(0.002), vec2(0.998));
        vec2 uvB = clamp(vUv + refrOffset * 1.07, vec2(0.002), vec2(0.998));

        vec3 refrCol;
        refrCol.r = texture2D(uSceneTex, uvR).r;
        refrCol.g = texture2D(uSceneTex, uvG).g;
        refrCol.b = texture2D(uSceneTex, uvB).b;

        // Subtle optical rim blur near the outer drop border so meniscus melts organically into the wet ice
        float edgeProx = 1.0 - smoothstep(ISO_THRESH, ISO_THRESH + 0.07 + 0.18 * uEdgeSoftness, phi);
        if (uEdgeSoftness > 0.02 && edgeProx > 0.02) {
          vec2 bStep = (0.65 + 1.35 * uEdgeSoftness) * pxScale * tx;
          vec3 refrBlur = (
            texture2D(uSceneTex, clamp(uvG + vec2(-bStep.x,  bStep.y), vec2(0.002), vec2(0.998))).rgb +
            texture2D(uSceneTex, clamp(uvG + vec2( bStep.x,  bStep.y), vec2(0.002), vec2(0.998))).rgb +
            texture2D(uSceneTex, clamp(uvG + vec2(-bStep.x, -bStep.y), vec2(0.002), vec2(0.998))).rgb +
            texture2D(uSceneTex, clamp(uvG + vec2( bStep.x, -bStep.y), vec2(0.002), vec2(0.998))).rgb
          ) * 0.25;
          refrCol = mix(refrCol, refrBlur, edgeProx * clamp(uEdgeSoftness * 0.56, 0.0, 0.72));
        }

        vec3 juiceTrans = exp(-uDropSigma * (0.14 + 0.30 * clamp(juiceTint * 1.4, 0.0, 1.0) * (0.35 + 0.45 * plump)));
        float poolSyrup = smoothstep(0.46, 0.84, juiceTint);
        float topJoin = smoothstep(-0.30, 0.65, N.y);
        vec3 syrupAbsorb = exp(-uDropSigma * (0.35 + 0.45 * (topJoin * 0.68 + (1.0 - ndv) * 0.32)));
        refrCol *= mix(juiceTrans, syrupAbsorb, poolSyrup);

        // Creamy coconut / milky-base surface droplets look glossy & softly milky rather than pure clear water!
        vec3 l1 = normalize(vec3(-0.48, 0.58, 0.66));
        vec3 l2 = normalize(vec3(0.54, 0.44, 0.71));
        if (uDropOpacity > 0.15) {
          float cWrap = 0.64 + 0.38 * clamp((dot(N, l1) + 0.4) / 1.4, 0.0, 1.0) + 0.22 * clamp((dot(N, l2) + 0.4) / 1.4, 0.0, 1.0);
          vec3 creamyDrop = uDropCreamColor * cWrap;
          refrCol = mix(refrCol, creamyDrop, clamp(uDropOpacity * (0.48 + 0.34 * plump), 0.0, 0.82));
        }

        // Softened optical glass contour: controlled by uRimDark & gently pulled inward from razor alpha edge
        float innerEdgeLift = 0.04 + 0.09 * clamp(uEdgeSoftness, 0.0, 1.2);
        float darkContour = revStep(0.76, 0.34, ndv) * smoothstep(innerEdgeLift, 0.32 + innerEdgeLift * 0.5, ndv);
        vec3 darkRimTint = mix(uShadowTint * 0.65, uStainColor * 0.45, clamp(juiceTint * 1.15, 0.0, 1.0));
        vec3 col = mix(refrCol, refrCol * darkRimTint, clamp(darkContour * (0.36 + 0.46 * plump) * uRimDark * (1.0 - uDropOpacity * 0.42), 0.0, 0.92));

        // Luminous bottom caustic crescent (warm translucent flavor glow on water drops, softer on cream drops)
        float bottomCaustic = revStep(0.14, -0.76, N.y) * smoothstep(0.14, 0.72, ndv);
        vec3 causticTint = mix(vec3(0.72, 0.66, 0.62), uStainColor * 0.88 + vec3(0.14), 0.45 + 0.45 * poolSyrup);
        col += causticTint * bottomCaustic * (0.28 + 0.52 * plump) * (1.0 - 0.35 * poolSyrup) * (1.0 - uDropOpacity * 0.55);

        // Glassy Fresnel studio sheen (makes thin wet trails glisten crisply when light grazes their edges!)
        float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 4.2);
        vec3 R = reflect(-V, N);
        float stripRefl = exp(-sq((abs(R.x) - 0.62) / 0.18)) * smoothstep(-0.85, 0.85, R.y);
        float topRefl = smoothstep(0.50, 0.92, R.y);
        vec3 envSpec = mix(vec3(1.22, 1.16, 1.12), uStainColor * 0.72 + vec3(0.52), poolSyrup * 0.65) * (0.30 + 1.45 * stripRefl + 0.80 * topRefl);
        col = mix(col, envSpec, clamp(fresnel * (0.50 + 0.16 * plump) * (1.0 - 0.28 * poolSyrup), 0.0, 0.70));

        // Razor-sharp studio pinpoint catchlights
        vec3 h1 = safeNorm(l1 + V);
        vec3 h2 = safeNorm(l2 + V);
        float spec1 = pow(max(dot(N, h1), 0.0), 200.0);
        float spec2 = pow(max(dot(N, h2), 0.0), 155.0);
        col += vec3(2.8, 2.68, 2.62) * (spec1 * 1.22 + spec2 * 0.78) * (0.55 + 0.45 * plump);

        // Feathered wet meniscus blend (smoothly responds to uEdgeSoftness on BOTH face & side silhouette drops!)
        float softFaceMul = mix(0.68, 1.0, onIceMask);
        float aaWidth = max(0.011, gradPhi * (1.15 + uEdgeSoftness * 2.25 * softFaceMul)) + uEdgeSoftness * 0.052 * softFaceMul;
        float mask = smoothstep(ISO_THRESH - aaWidth * 0.68, ISO_THRESH + aaWidth * 0.85, phi);

        vec3 outCol = mix(shadowedBase, col, mask);
        gl_FragColor = vec4(outCol, max(baseTag, mask));
      }
    `,
  });
}

/** Optical water shader for the 3D Rayleigh-Plateau bottom-rim hanging & pinching pendant drops. */
function createPendantDropMaterial(
  sharedUniforms: WaterDropUniforms,
  lensPower: number,
  juiceTint: number,
  enableCollarFade = true,
  softReflection = false,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: !enableCollarFade,
    side: THREE.FrontSide,
    uniforms: {
      uSceneTex: sharedUniforms.uSceneTex,
      uResolution: sharedUniforms.uResolution,
      uLensPower: { value: lensPower },
      uJuiceTint: { value: juiceTint },
      uDropSigma: sharedUniforms.uDropSigma,
      uDropCreamColor: sharedUniforms.uDropCreamColor,
      uDropOpacity: sharedUniforms.uDropOpacity,
      uShadowTint: sharedUniforms.uShadowTint,
      uStainColor: sharedUniforms.uStainColor,
    },
    vertexShader: /* glsl */ `
      ${enableCollarFade ? 'attribute float aCollarFade;\n      attribute float aFilletFade;' : ''}
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      varying float vLocalY;
      varying float vCollarFade;
      varying float vFilletFade;

      void main() {
        #ifdef USE_INSTANCING
          mat4 instModel = modelMatrix * instanceMatrix;
        #else
          mat4 instModel = modelMatrix;
        #endif
        vec4 wp = instModel * vec4(position, 1.0);
        vLocalY = wp.y - instModel[3].y;
        vWorldPos = wp.xyz;
        vCollarFade = ${enableCollarFade ? 'aCollarFade' : '1.0'};
        vFilletFade = ${enableCollarFade ? 'aFilletFade' : '1.0'};
        vec3 invScale = vec3(
          1.0 / max(1e-5, length(instModel[0].xyz)),
          1.0 / max(1e-5, length(instModel[1].xyz)),
          1.0 / max(1e-5, length(instModel[2].xyz))
        );
        vec3 worldN = normalize(mat3(instModel) * (normal * invScale * invScale));
        vWorldNormal = worldN;
        vViewNormal = normalize(mat3(viewMatrix) * worldN);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform sampler2D uSceneTex;
      uniform vec2 uResolution;
      uniform float uLensPower;
      uniform float uJuiceTint;
      uniform vec3 uDropSigma;
      uniform vec3 uDropCreamColor;
      uniform float uDropOpacity;
      uniform vec3 uShadowTint;
      uniform vec3 uStainColor;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      varying float vLocalY;
      varying float vCollarFade;
      varying float vFilletFade;

      ${GLSL_SAFE_HELPERS}

      void main() {
        if (vCollarFade < 0.004) discard;
        vec2 screenUv = gl_FragCoord.xy / uResolution;
        vec3 N = normalize(vWorldNormal);
        vec3 Nv = normalize(vViewNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);

        float ndv = clamp(dot(N, V), 0.0, 1.0);

        // Calm lens refraction to 0 right at the underside join (vFilletFade -> 0) so the overlapping upper
        // wetting skirt matches uSceneTex invisibly (ZERO semicircle halo or horizontal seam on tiny drops!),
        // ramping smoothly to crisp jewel refraction across the hanging drop belly!
        vec2 refrVec = -Nv.xy * uLensPower * (0.62 + 0.72 * pow(1.0 - ndv, 0.8)) * vFilletFade;
        vec2 uvR = clamp(screenUv + refrVec * 0.94, vec2(0.002), vec2(0.998));
        vec2 uvG = clamp(screenUv + refrVec * 1.00, vec2(0.002), vec2(0.998));
        vec2 uvB = clamp(screenUv + refrVec * 1.07, vec2(0.002), vec2(0.998));

        vec3 refrCol;
        refrCol.r = texture2D(uSceneTex, uvR).r;
        refrCol.g = texture2D(uSceneTex, uvG).g;
        refrCol.b = texture2D(uSceneTex, uvB).b;

        float topJuice = smoothstep(-0.085, 0.006, vLocalY);
        float effTint = uJuiceTint * (0.38 + 0.30 * topJuice);
        vec3 flavorTrans = exp(-uDropSigma * (0.13 + 0.28 * effTint) * (0.24 + 0.76 * vFilletFade));
        refrCol *= flavorTrans;
        vec3 collarColor = mix(uStainColor, uDropCreamColor, uDropOpacity);
        refrCol = mix(refrCol, collarColor, (1.0 - vFilletFade) * (0.04 + 0.22 * uDropOpacity));

        vec3 camH = safeNorm(vec3(cameraPosition.x, 0.0, cameraPosition.z));
        vec3 camR = vec3(camH.z, 0.0, -camH.x);
        vec3 l1 = normalize(-0.50 * camR + vec3(0.0, 0.56, 0.0) + 0.66 * camH);
        vec3 l2 = normalize( 0.56 * camR + vec3(0.0, 0.42, 0.0) + 0.71 * camH);
        // Smoothly match creamy & opaque condensed-milk recipes with rich thick opaque cream drops!
        float creamMix = smoothstep(0.04, 0.86, uDropOpacity) * 0.98;
        if (creamMix > 0.005) {
          float cWrap = 0.52 + 0.42 * clamp((dot(N, l1) + 0.38) / 1.38, 0.0, 1.0) + 0.18 * clamp((dot(N, l2) + 0.40) / 1.40, 0.0, 1.0);
          vec3 creamyPendant = uDropCreamColor * cWrap;
          refrCol = mix(refrCol, creamyPendant, creamMix);
        }

        // Delicate refractive silhouette contour — fades cleanly to 0 at yEdge so ZERO dark arc prints on the ice!
        float darkContour = revStep(0.66, 0.28, ndv) * smoothstep(0.02, 0.22, ndv);
        vec3 darkRimTint = mix(uShadowTint * 0.64, uStainColor * 0.46, effTint);
        vec3 col = mix(refrCol, refrCol * darkRimTint, darkContour * (0.68 * vFilletFade) * (1.0 - uDropOpacity * 0.50));

        float bottomCaustic = revStep(0.16, -0.78, Nv.y) * smoothstep(0.12, 0.70, ndv) * vFilletFade;
        col += mix(vec3(0.78, 0.68, 0.64), uStainColor * 0.80 + vec3(0.20), 0.50) * bottomCaustic * 0.74 * (1.0 - uDropOpacity * 0.65);

        float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 4.4);
        vec3 R = reflect(-V, N);
        float rxStudio = dot(R, camR);
        float stripRefl = exp(-sq((abs(rxStudio) - 0.64) / 0.16)) * smoothstep(-0.85, 0.85, R.y);
        float topRefl = smoothstep(0.52, 0.92, R.y);
        vec3 envSpec = vec3(1.18, 1.12, 1.08) * (0.24 + ${softReflection ? '0.46' : '1.45'} * stripRefl + ${softReflection ? '0.42' : '0.82'} * topRefl);
        col = mix(col, envSpec, clamp(fresnel * (${softReflection ? '0.38' : '0.60'} - 0.18 * uDropOpacity) * vFilletFade, 0.0, ${softReflection ? '0.42' : '0.65'}));

        vec3 h1 = safeNorm(l1 + V);
        vec3 h2 = safeNorm(l2 + V);
        float spec1 = pow(max(dot(N, h1), 0.0), ${softReflection ? '280.0' : '220.0'});
        float spec2 = pow(max(dot(N, h2), 0.0), ${softReflection ? '220.0' : '170.0'});
        col += vec3(2.7, 2.6, 2.52) * (spec1 * ${softReflection ? '0.72' : '1.10'} + spec2 * ${softReflection ? '0.48' : '0.72'}) * vFilletFade;

        float alpha = smoothstep(0.0, 0.06, ndv) * vCollarFade;
        gl_FragColor = vec4(col, clamp(alpha * 0.99, 0.0, 1.0));
      }
    `,
  });
}

/**
 * Creates a real 3D glossy translucent melted-ice / berry-syrup sleeve wrapped snugly around the birch stick!
 * Features:
 * - Thick curved wet meniscus collar welding the melting popsicle bottom onto the wooden stick
 * - Undulating 3D-displaced translucent strawberry-syrup drip tongues & bulbous creeping tips oozing down the wood
 * - Live optical refraction of the birch wood grain (`uSceneTex`) + glossy dark meniscus edge + crisp white specular streaks!
 */
function createStickMeltOverlay(sharedUniforms: WaterDropUniforms, seed: number): {
  mesh: THREE.Mesh;
  uniforms: {
    uIceBottomY: { value: number };
    uIceTopY: { value: number };
    uIceAmount: { value: number };
    uStickWetness: { value: number };
    uMelt: { value: number };
  };
  dispose(): void;
} {
  const segU = 48;
  const archRows = 20;
  const shaftRows = 92;
  const botArchRows = 16;
  const segV = archRows + shaftRows + botArchRows;
  const vCount = (segU + 1) * (segV + 1);
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const indices: number[] = [];

  // Exact world-space outer envelope of createWoodStickGeometry() (including rounded top & bottom semicircle caps!)
  // plus tight clearance (+0.0014/+0.0016) so sticky glaze wraps cleanly over both rounded ends with ZERO Z-clipping!
  const hw = POPSICLE.stickEdgeX + 0.0014;
  const hd = POPSICLE.stickDepth * 0.5 + 0.0016;
  const yArchCenter = POPSICLE.stickTopY - POPSICLE.stickWidth * 0.5;
  const yBotArchCenter = POPSICLE.stickBottomY + POPSICLE.stickWidth * 0.5;
  const rArch = hw;

  for (let iv = 0; iv <= segV; iv++) {
    let y: number;
    let archScaleX = 1.0;
    let archScaleZ = 1.0;
    let archT = 0.0;
    let archSign = 1.0;
    let bevelT = 0.0;

    if (iv <= archRows) {
      // Slightly apex-biased angular spacing over the rounded top semicircle cap so even macro zoom is silky-round
      const frac = Math.pow(iv / archRows, 1.15); // 0 = very top tip, 1 = arch base
      const archAng = frac * Math.PI * 0.5;
      archT = Math.cos(archAng); // 1 at top tip -> 0 at arch base
      archSign = 1.0;
      y = yArchCenter + archT * rArch;
      archScaleX = iv === 0 ? 0.0 : Math.sin(archAng);
      // Match wood bevel rolloff (~0.95..1.0) so glaze stays proud of the flat upper cap face
      bevelT = smoothstep(0.945, 1.0, archT);
      archScaleZ = iv === 0 ? 0.0 : Math.sqrt(Math.max(0.02, 1.0 - bevelT * bevelT));
    } else if (iv <= archRows + shaftRows) {
      const shaftFrac = (iv - archRows) / shaftRows;
      y = yArchCenter - shaftFrac * (yArchCenter - yBotArchCenter);
    } else {
      const botIdx = iv - (archRows + shaftRows);
      const frac = Math.pow(Math.max(0, 1.0 - botIdx / botArchRows), 1.15); // 1 = arch base, 0 = bottom tip
      const archAng = frac * Math.PI * 0.5;
      archT = Math.cos(archAng); // 0 at arch base -> 1 at bottom tip
      archSign = -1.0;
      y = yBotArchCenter - archT * rArch;
      archScaleX = iv === segV ? 0.0 : Math.sin(archAng);
      bevelT = smoothstep(0.945, 1.0, archT);
      archScaleZ = iv === segV ? 0.0 : Math.sqrt(Math.max(0.02, 1.0 - bevelT * bevelT));
    }

    for (let iu = 0; iu <= segU; iu++) {
      const uNorm = iu / segU;
      const theta = iu === segU ? 0 : uNorm * Math.PI * 2;
      const sT = Math.sin(theta);
      const cT = Math.cos(theta);
      const sgnX = sT >= 0 ? 1 : -1;
      const sgnZ = cT >= 0 ? 1 : -1;

      // Superellipse cross-section snugly matching the extruded beveled birch stick
      const x = sgnX * Math.pow(Math.abs(sT), 0.34) * hw * archScaleX;
      const z = sgnZ * Math.pow(Math.abs(cT), 0.38) * hd * archScaleZ;

      let nx: number;
      let ny: number;
      let nz: number;
      if (iv === 0) {
        nx = 0;
        ny = 1;
        nz = 0;
      } else if (iv === segV) {
        nx = 0;
        ny = -1;
        nz = 0;
      } else {
        let nxB = (sgnX * Math.pow(Math.max(1e-4, Math.abs(sT)), 1.66)) / hw;
        let nzB = (sgnZ * Math.pow(Math.max(1e-4, Math.abs(cT)), 1.62)) / hd;
        const bLen = Math.hypot(nxB, nzB) || 1;
        nxB /= bLen;
        nzB /= bLen;

        if (archT > 0.001) {
          nx = nxB * (1.0 - archT * 0.55);
          ny = archSign * (archT * Math.abs(sT) * 0.92 + bevelT * 0.88);
          nz = nzB * (1.0 - bevelT * 0.60);
          const nLen = Math.hypot(nx, ny, nz) || 1;
          nx /= nLen;
          ny /= nLen;
          nz /= nLen;
        } else {
          nx = nxB;
          ny = 0;
          nz = nzB;
        }
      }

      const idx = iv * (segU + 1) + iu;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;

      normals[idx * 3] = nx;
      normals[idx * 3 + 1] = ny;
      normals[idx * 3 + 2] = nz;
    }
  }

  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * (segU + 1) + iu;
      const b = a + 1;
      const c = a + (segU + 1);
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(indices);

  const stickMeltUniforms = {
    uIceBottomY: { value: POPSICLE.yBottom as number },
    uIceTopY: { value: POPSICLE.yTop as number },
    uIceAmount: { value: 1.0 as number },
    uStickWetness: { value: 0.0 as number },
    uMelt: { value: 0.0 as number },
  };

  // Single source of truth for stick syrup & edge-runoff procedural field shared by vertex + fragment shaders
  const stickSyrupFieldGlsl = /* glsl */ `
    ${GLSL_SAFE_HELPERS}

    float evalLiquidLayer(float x, float dSmooth, float reach, float speed, float phase, float xCenter, float xWidth) {
      // Constant wrap period guarantees d(front)/dt = +speed > 0 ALWAYS (never reverses upward while reach grows!)
      const float CYCLE = 1.65;
      float front = mod(uTime * speed + phase * CYCLE, CYCLE);
      float dx = (x - xCenter) / xWidth;
      float lobeShape = exp(-dx * dx * 1.15);
      float grainRipple = sin(x * 11.5 + phase * 4.3 + uSeed) * 0.018 + cos(x * 23.0 - uSeed) * 0.008;
      float frontY = front * (0.38 + 0.78 * lobeShape) + grainRipple;

      float reachMax = max(0.04, reach * 1.25);
      float reachClip = revStep(reachMax + 0.08, reachMax - 0.14, dSmooth);
      float frontInReach = revStep(reachMax + 0.14, reachMax - 0.06, frontY);
      float fadeEnd = revStep(CYCLE, CYCLE - 0.14, front);

      float sheet = revStep(frontY + 0.016, frontY - 0.030, dSmooth) * smoothstep(0.02, 0.10, front) * (0.35 + 0.65 * lobeShape) * reachClip * fadeEnd;
      float softLip = exp(-sq((dSmooth - frontY) / 0.014)) * lobeShape * smoothstep(0.03, 0.12, front) * fadeEnd * frontInReach;
      return sheet * 0.28 + softLip * 0.20;
    }

    float evalEdgeWave(float dSmooth, float reach, float speed, float phase, float bulbLen) {
      // Constant wrap period guarantees every edge wave strictly travels DOWNWARD (d(front)/dt = +speed > 0)!
      const float CYCLE = 1.65;
      float front = mod(uTime * speed + phase * CYCLE, CYCLE);
      float fadeEnds = smoothstep(0.015, 0.09, front) * revStep(CYCLE, CYCLE - 0.14, front) * revStep(reach + 0.10, reach - 0.08, front);
      float head = exp(-sq((dSmooth - front) / bulbLen)) * 0.78;
      float tail = revStep(front + bulbLen * 0.6, front - bulbLen * 2.8, dSmooth) * smoothstep(-0.01, 0.025, dSmooth) * 0.34;
      return (head + tail) * fadeEnds;
    }

    // Subtle organic wet side-edge trickle film along BOTH left & right stick edges while ice is actively melting
    float evalSideEdgeRunoff(vec2 xzNorm, float wy) {
      // Fade active mid-stick runoff cleanly as the final ice bead disappears (no phantom drips starting mid-stick!)
      float edgeWet = smoothstep(0.055, 0.24, uMelt) * smoothstep(0.08, 0.42, uStickWetness) * smoothstep(0.04, 0.36, uIceAmount);
      if (edgeWet < 0.005) return 0.0;
      float sideMask = smoothstep(0.66, 0.96, abs(xzNorm.x));
      if (sideMask < 0.005) return 0.0;

      float distBelow = uIceBottomY - wy;
      float dSmooth = 0.5 * (distBelow + sqrt(distBelow * distBelow + 0.0005));
      float topCut = smoothstep(0.002, 0.036, distBelow);
      float reach = 0.14 + smoothstep(0.055, 0.58, uMelt) * 1.25;
      float trackMask = revStep(reach + 0.08, reach - 0.14, dSmooth) * topCut;

      float sidePhase = xzNorm.x >= 0.0 ? 0.43 : 0.0;
      float w1 = evalEdgeWave(dSmooth, reach, 0.026, 0.11 + sidePhase, 0.055);
      float w2 = evalEdgeWave(dSmooth, reach, 0.044, 0.57 + sidePhase * 1.3, 0.042);
      float w3 = evalEdgeWave(dSmooth, reach, 0.064, 0.89 + sidePhase * 0.7, 0.034);
      float organicRipple = 0.72 + 0.28 * sin(wy * 24.0 + uTime * 0.24 + sidePhase * 8.0 + uSeed);

      float ribbon = (0.14 * trackMask * organicRipple + clamp(w1 + w2 * 0.85 + w3 * 0.70, 0.0, 1.05) * topCut);
      return clamp(ribbon * sideMask * edgeWet, 0.0, 1.05);
    }

    // Lush, cohesive sticky melted-popsicle glaze coating the entire upper stick where the ice cream actually sat
    // (wrapping cleanly over the rounded top cap down through the submerged zone & tapering down the handle!)
    float evalStickyResidue(vec2 xzNorm, float wy) {
      float x = xzNorm.x;
      float creepT = uTime * 0.0065;
      // Organic slow-creeping syrup waves & viscous pooling ridges across the entire upper ice-contact zone
      float grain1 = 0.5 + 0.5 * sin(x * 6.8 + (wy + creepT) * 7.2 + uSeed);
      float grain2 = 0.5 + 0.5 * cos(x * 13.5 - (wy + creepT * 1.4) * 11.0 + uSeed * 1.7);
      float verticalStreaks = smoothstep(0.18, 0.88, grain1 * 0.62 + grain2 * 0.38);

      // Thickest glossy pools sitting right on the upper rounded cap & carved text zone where the popsicle sat
      float capPool = exp(-sq((wy - ${(POPSICLE.stickTopY - 0.10).toFixed(3)}) / 0.22)) * (0.28 + 0.18 * cos(x * 4.2 + uSeed));
      float d1 = exp(-sq((x + 0.26) / 0.34) - sq((wy - ${(POPSICLE.stickTopY - 0.26).toFixed(3)}) / 0.24)) * 0.36;
      float d2 = exp(-sq((x - 0.24) / 0.32) - sq((wy - ${(POPSICLE.stickTopY - 0.58).toFixed(3)}) / 0.26)) * 0.34;
      float d3 = exp(-sq((x + 0.04) / 0.38) - sq((wy - ${(POPSICLE.stickTopY - 0.96).toFixed(3)}) / 0.28)) * 0.28;
      // Subtle lower trailing drip tongues extending softly down the handle from the wet upper coat
      float trail1 = exp(-sq((x + 0.22) / 0.32)) * smoothstep(-1.75, -0.92, wy) * (0.14 + 0.12 * sin(wy * 9.0 + uTime * 0.18 + uSeed));
      float trail2 = exp(-sq((x - 0.20) / 0.30)) * smoothstep(-1.62, -0.88, wy) * (0.14 + 0.12 * cos(wy * 8.2 + uTime * 0.15 - uSeed));

      // Strong, unmistakable glossy coat across the ENTIRE upper ice-contact zone (y > -1.04 up to the rounded tip!)
      float iceSeatZone = smoothstep(-1.26, -0.78, wy);
      float baseCoat = mix(0.16, 0.46, iceSeatZone);
      float streaks = verticalStreaks * mix(0.16, 0.28, iceSeatZone);
      return clamp(baseCoat + streaks + capPool + d1 + d2 + d3 + trail1 + trail2, 0.0, 0.94);
    }

    float evalSyrupField(vec2 xzNorm, float wy) {
      float wet = clamp(uStickWetness, 0.0, 1.0);
      if (wet < 0.08 && uIceAmount > 0.95) return 0.0;

      float x = xzNorm.x;
      float z = xzNorm.y;
      float faceMask = smoothstep(0.28, 0.72, abs(z));

      float iceFlow = 0.0;
      float layerAmt = smoothstep(0.20, 0.80, wet);
      float iceBlend = smoothstep(0.0, 0.60, uIceAmount);
      if (layerAmt > 0.005 && iceBlend > 0.005) {
        float distBelow = uIceBottomY - wy;
        float dSmooth = 0.5 * (distBelow + sqrt(distBelow * distBelow + 0.0006));
        float reach = smoothstep(0.15, 0.90, wet);

        float l1 = evalLiquidLayer(x, dSmooth, reach, 0.022, 0.12, -0.34, 0.62);
        float l2 = evalLiquidLayer(x, dSmooth, reach, 0.030, 0.44,  0.30, 0.58);
        float l3 = evalLiquidLayer(x, dSmooth, reach, 0.018, 0.72, -0.04, 0.78);
        float l4 = evalLiquidLayer(x, dSmooth, reach, 0.036, 0.91,  0.42, 0.52);

        float collar = exp(-dSmooth / max(0.036, 0.075 * (0.5 + 0.7 * reach))) * 0.30 * iceBlend;
        float layered = (l1 + l2 + l3 + l4) * layerAmt * 1.20;
        float topFade = smoothstep(-0.075, 0.014, distBelow);
        iceFlow = clamp((collar * smoothstep(0.10, 0.36, wet) + layered) * faceMask * topFade, 0.0, 0.95);
      }

      // Smoothly coat the revealed upper stick as the sliding ice retreats downward (wide blend prevents any horizontal seam!),
      // and seamlessly wrap the entire stick once bare!
      float bareWeight = clamp(max(1.0 - iceBlend, smoothstep(uIceTopY - 0.14, uIceTopY + 0.08, wy) * smoothstep(-1.45, -1.05, wy)), 0.0, 1.0);
      float bareSticky = 0.0;
      if (bareWeight > 0.005) {
        float sticky = evalStickyResidue(xzNorm, wy);
        // Coat both the broad front/back faces AND softly wrap around the beveled edges & rounded top cap!
        float capWrap = smoothstep(${(POPSICLE.stickTopY - 0.16).toFixed(3)}, ${(POPSICLE.stickTopY - 0.02).toFixed(3)}, wy);
        float bareMask = mix(0.42 + 0.58 * faceMask, 0.88 + 0.12 * faceMask, capWrap);
        bareSticky = clamp(sticky * bareMask, 0.0, 0.92);
      }

      return clamp(max(iceFlow * iceBlend, bareSticky * bareWeight), 0.0, 0.94);
    }
  `;

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: {
      uSceneTex: sharedUniforms.uSceneTex,
      uResolution: sharedUniforms.uResolution,
      uTime: sharedUniforms.uTime,
      uIceBottomY: stickMeltUniforms.uIceBottomY,
      uIceTopY: stickMeltUniforms.uIceTopY,
      uIceAmount: stickMeltUniforms.uIceAmount,
      uStickWetness: stickMeltUniforms.uStickWetness,
      uMelt: stickMeltUniforms.uMelt,
      uSeed: { value: seed * 3.17 },
      uDropSigma: sharedUniforms.uDropSigma,
      uDropCreamColor: sharedUniforms.uDropCreamColor,
      uDropOpacity: sharedUniforms.uDropOpacity,
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uIceBottomY;
      uniform float uIceTopY;
      uniform float uIceAmount;
      uniform float uStickWetness;
      uniform float uMelt;
      uniform float uSeed;

      varying vec3 vWorldPos;
      varying vec3 vBaseNormal;
      varying vec2 vLocalXZ;
      varying float vWorldY;

      ${stickSyrupFieldGlsl}

      void main() {
        vWorldY = position.y;
        vec2 xzNorm = vec2(position.x / ${hw.toFixed(6)}, position.z / ${hd.toFixed(6)});
        vLocalXZ = xzNorm;

        float thick = evalSyrupField(xzNorm, position.y);
        float edgeRun = evalSideEdgeRunoff(xzNorm, position.y);

        float distBelow = uIceBottomY - position.y;
        float dSmooth = 0.5 * (distBelow + sqrt(distBelow * distBelow + 0.0006));

        float tinyMeniscus = exp(-dSmooth * 36.0) * smoothstep(-0.04, 0.015, distBelow) * smoothstep(0.10, 0.45, uStickWetness) * uIceAmount * 0.0011;
        float layerBulge = smoothstep(0.06, 0.90, thick) * (0.0010 + 0.0018 * max(uStickWetness, 1.0 - uIceAmount));
        // Ultra-subtle damp surface film on the wood edge (zero hollow rail — real 3D teardrops carry the side dripping silhouette!)
        float edgeBulge = edgeRun * 0.0016;
        vec3 displaced = position + normal * (tinyMeniscus + layerBulge + edgeBulge);

        vec4 wp = modelMatrix * vec4(displaced, 1.0);
        vWorldPos = wp.xyz;
        vBaseNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform sampler2D uSceneTex;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform float uIceBottomY;
      uniform float uIceTopY;
      uniform float uIceAmount;
      uniform float uStickWetness;
      uniform float uMelt;
      uniform float uSeed;
      uniform vec3 uDropSigma;
      uniform vec3 uDropCreamColor;
      uniform float uDropOpacity;

      varying vec3 vWorldPos;
      varying vec3 vBaseNormal;
      varying vec2 vLocalXZ;
      varying float vWorldY;

      ${stickSyrupFieldGlsl}

      void main() {
        float fFace = evalSyrupField(vLocalXZ, vWorldY);
        float fEdge = evalSideEdgeRunoff(vLocalXZ, vWorldY);
        float fC = max(fFace, fEdge);
        if (fC < 0.04) discard;

        vec3 N0 = normalize(vBaseNormal);
        vec3 rawT = cross(vec3(0.0, 1.0, 0.0), N0);
        vec3 T = length(rawT) > 0.001 ? normalize(rawT) : vec3(1.0, 0.0, 0.0);
        vec3 B = normalize(cross(N0, T));

        float epsS = 0.028;
        vec2 stepXZ = vec2(T.x * epsS, T.z * epsS * (${(hw / hd).toFixed(4)}));
        float dv = 0.010;
        float fR = max(evalSyrupField(vLocalXZ + stepXZ, vWorldY), evalSideEdgeRunoff(vLocalXZ + stepXZ, vWorldY));
        float fL = max(evalSyrupField(vLocalXZ - stepXZ, vWorldY), evalSideEdgeRunoff(vLocalXZ - stepXZ, vWorldY));
        float fD = max(evalSyrupField(vLocalXZ, vWorldY - dv), evalSideEdgeRunoff(vLocalXZ, vWorldY - dv));
        float fU = max(evalSyrupField(vLocalXZ, vWorldY + dv), evalSideEdgeRunoff(vLocalXZ, vWorldY + dv));

        float gradT = (fR - fL) / (2.0 * epsS);
        float gradV = (fD - fU) / (2.0 * dv);

        float sideZone = smoothstep(0.56, 0.92, abs(vLocalXZ.x));
        float edgeFactor = smoothstep(0.06, 0.34, fEdge) * sideZone;

        // Keep glossy liquid meniscus normals alive across the entire rounded top cap where the ice cream sat,
        // only gently softening right at the very grazing top apex edge (zero hard specular pinching!).
        float distBelow = uIceBottomY - vWorldY;
        float tipDamp = mix(0.42, 1.0, revStep(${POPSICLE.stickTopY.toFixed(3)}, ${(POPSICLE.stickTopY - 0.032).toFixed(3)}, vWorldY));
        float topDamp = max(1.0 - uIceAmount, smoothstep(-0.01, 0.035, distBelow)) * tipDamp;
        vec3 N = normalize(
          N0 - T * clamp(gradT * (0.16 + 0.14 * edgeFactor) * tipDamp, -0.45, 0.45) +
          B * clamp(gradV * (0.085 + 0.09 * edgeFactor) * topDamp, -0.45, 0.45)
        );
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(N, V), 0.0, 1.0);

        vec2 screenUv = gl_FragCoord.xy / uResolution;
        // Keep side-edge refraction tight (0.0038 max) so the wood edge never pulls a hollow white stripe off the backdrop!
        float refrAmp = mix(0.0018 + 0.0040 * smoothstep(0.06, 0.88, fC), 0.0038, edgeFactor);
        vec2 refrOff = -N.xy * refrAmp;
        vec3 bgWood = texture2D(uSceneTex, clamp(screenUv + refrOff, vec2(0.002), vec2(0.998))).rgb;

        float optDepth = smoothstep(0.04, 0.88, fC);
        float bareSeatBoost = (1.0 - uIceAmount) * smoothstep(-1.15, -0.60, vWorldY);
        vec3 syrupTrans = exp(-uDropSigma * mix(0.26 + 0.12 * bareSeatBoost, 0.21, edgeFactor) * (0.20 + 0.66 * optDepth));
        vec3 col = bgWood * syrupTrans;
        vec3 camH = safeNorm(vec3(cameraPosition.x, 0.0, cameraPosition.z));
        vec3 camR = vec3(camH.z, 0.0, -camH.x);
        float isMilkDrop = smoothstep(0.76, 0.98, uDropOpacity);
        float creamMix = smoothstep(0.04, 0.86, uDropOpacity) * clamp(0.45 + 0.45 * optDepth + 0.22 * isMilkDrop, 0.0, mix(0.86, 0.98, isMilkDrop)) * mix(0.44, 1.0, smoothstep(0.0, 0.55, uIceAmount));
        if (creamMix > 0.005) {
          vec3 cL1 = normalize(-0.48 * camR + vec3(0.0, 0.54, 0.0) + 0.68 * camH);
          vec3 cL2 = normalize( 0.52 * camR + vec3(0.0, 0.42, 0.0) + 0.74 * camH);
          float cWrap = mix(0.62, 0.44, isMilkDrop) + 0.36 * clamp((dot(N, cL1) + 0.45) / 1.45, 0.0, 1.0) + 0.18 * clamp((dot(N, cL2) + 0.45) / 1.45, 0.0, 1.0);
          col = mix(col, uDropCreamColor * cWrap, creamMix);
        }

        // Delicate optical meniscus contour — subtle & organic (never a heavy dark pipe outline!)
        float lipContour = clamp(-gradV * 0.052 * topDamp, 0.0, 0.22);
        col *= (1.0 - lipContour);

        // Damp harsh specular streaks along the curved wood side bevels while keeping silky glossy coat across the upper cap!
        float bevelCalm = (1.0 - sideZone * 0.76) * smoothstep(0.05, 0.28, ndv);
        float fresnel = 0.016 + 0.984 * pow(1.0 - ndv, 4.5);
        vec3 l1 = normalize(-0.46 * camR + vec3(0.0, 0.54, 0.0) + 0.70 * camH);
        vec3 l2 = normalize( 0.52 * camR + vec3(0.0, 0.42, 0.0) + 0.74 * camH);
        vec3 h1 = safeNorm(l1 + V);
        vec3 h2 = safeNorm(l2 + V);
        float spec1 = pow(max(dot(N, h1), 0.0), 175.0);
        float spec2 = pow(max(dot(N, h2), 0.0), 140.0);
        // Subtle broad wet clearcoat sheen so the coated top of the stick unmistakably reads as wet glazed syrup
        float broadSheen = pow(max(dot(N, h1), 0.0), 28.0) * 0.12 + pow(max(dot(N, h2), 0.0), 24.0) * 0.085;
        float milkSpecCalm = 1.0 - isMilkDrop * 0.48;
        col = mix(col, vec3(1.04, 0.96, 0.94), clamp(fresnel * (0.14 + 0.09 * bareSeatBoost) * bevelCalm * milkSpecCalm, 0.0, 0.22));
        col += vec3(1.75, 1.64, 1.58) * (spec1 * 0.66 + spec2 * 0.45 + broadSheen * (0.35 + 0.62 * bareSeatBoost)) * bevelCalm * milkSpecCalm;

        float baseAlpha = mix(0.80, 0.52, edgeFactor);
        float alpha = smoothstep(0.05, 0.22, fC) * mix(baseAlpha, 0.95, isMilkDrop * smoothstep(0.10, 0.48, fC)) * smoothstep(0.02, 0.14, ndv);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'stick-melt-glaze';
  return {
    mesh,
    uniforms: stickMeltUniforms,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Creates two dedicated, continuous 3D flowing syrup streams hugging BOTH the left and right outer
 * edges of the wooden popsicle stick. Once melting ramps up, most melted liquid drains here as a
 * constant, organically varying translucent stream with concave ice-to-stick drainage funnels and
 * downward-advecting Kapitza roll-waves (swelling crests + slender glistening necks — never rigid pipes!).
 */
function createStickFlowStreams(
  sharedUniforms: WaterDropUniforms,
  seed: number,
): {
  group: THREE.Group;
  uniforms: {
    uIceBottomY: { value: number };
    uIceAmount: { value: number };
    uMelt: { value: number };
    uFlowRate: { value: number };
    uLeftFunnelY: { value: number };
    uRightFunnelY: { value: number };
    uLeftFunnelW: { value: number };
    uRightFunnelW: { value: number };
  };
  dispose(): void;
} {
  const segU = 22;
  const segV = 96;
  const stride = segU + 1;
  const vCount = stride * (segV + 1);
  const positions = new Float32Array(vCount * 3);
  const indices: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const idx = iv * stride + iu;
      positions[idx * 3] = u;
      positions[idx * 3 + 1] = v;
      positions[idx * 3 + 2] = 0;
    }
  }

  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  // Wide bounding sphere so GPU vertex displacement is never frustum-culled
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -1.2, 0), 2.5);

  const stickEdgeX = POPSICLE.stickEdgeX;
  const stickHalfD = POPSICLE.stickDepth * 0.5;

  const streamUniforms = {
    uIceBottomY: { value: POPSICLE.yBottom as number },
    uIceAmount: { value: 1.0 as number },
    uMelt: { value: 0.0 as number },
    uFlowRate: { value: 1.0 as number },
    uLeftFunnelY: { value: POPSICLE.yBottom as number },
    uRightFunnelY: { value: POPSICLE.yBottom as number },
    uLeftFunnelW: { value: 0.0 as number },
    uRightFunnelW: { value: 0.0 as number },
  };

  function makeStreamMaterial(
    phaseOffset: number,
    sideGain: number,
    funnelYUniform: { value: number },
    funnelWUniform: { value: number },
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.FrontSide,
      uniforms: {
        uSceneTex: sharedUniforms.uSceneTex,
        uResolution: sharedUniforms.uResolution,
        uTime: sharedUniforms.uTime,
        uIceBottomY: streamUniforms.uIceBottomY,
        uIceAmount: streamUniforms.uIceAmount,
        uMelt: streamUniforms.uMelt,
        uFlowRate: streamUniforms.uFlowRate,
        uFunnelY: funnelYUniform,
        uFunnelW: funnelWUniform,
        uPhase: { value: phaseOffset + seed * 2.13 },
        uSideGain: { value: sideGain },
        uDropSigma: sharedUniforms.uDropSigma,
        uDropCreamColor: sharedUniforms.uDropCreamColor,
        uDropOpacity: sharedUniforms.uDropOpacity,
        uShadowTint: sharedUniforms.uShadowTint,
        uStainColor: sharedUniforms.uStainColor,
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uIceBottomY;
        uniform float uIceAmount;
        uniform float uMelt;
        uniform float uFlowRate;
        uniform float uFunnelY;
        uniform float uFunnelW;
        uniform float uPhase;
        uniform float uSideGain;

        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying vec3 vViewNormal;
        varying float vWorldY;
        varying float vCa;
        varying float vThickNorm;
        varying float vFlowMask;
        varying float vMeniscus;

        ${GLSL_SAFE_HELPERS}

        // Skewed gravity-driven falling liquid wave (plump downward-leading crest + smooth tapering tail)
        // Uses monotonically integrated uFlowPhase so even live speed-slider changes never reverse wave motion!
        float surgeWave(float d, float speed, float freq, float phase, float pwr) {
          float ph = d * freq - uFlowRate * speed * freq + phase;
          float skew = sin(ph - 0.46 * sin(ph));
          return pow(clamp(0.5 + 0.5 * skew, 0.0, 1.0), pwr);
        }

        // Evaluates continuous outward liquid stream thickness (world units) at height y
        float evalStreamThick(float y, float flowStrength, float meniscusStrength, out float outMeniscus) {
          float d = uIceBottomY - y;
          float dPos = max(0.0, d);
          // Smooth advancing wetness front early on -> full continuous drainage down the whole stick once melting builds!
          float reach = 0.06 + smoothstep(0.08, 0.34, uMelt) * 1.48;
          float reachMask = revStep(reach + 0.07, reach - 0.14, dPos);

          // Subtle two-scale tangential capillary meniscus kissing the underside translucent pouch smoothly
          // before curving gracefully inward onto the vertical wooden stick stream!
          float dFunnel = max(0.0, uFunnelY - y);
          float meniscusCurve = 0.54 * exp(-dFunnel / 0.064) + 0.46 * exp(-dFunnel / 0.017);
          float icePresence = smoothstep(0.0, 0.26, uIceAmount);
          float meniscus = uFunnelW * meniscusCurve * meniscusStrength * icePresence;
          outMeniscus = meniscusCurve * smoothstep(0.004, 0.022, uFunnelW) * meniscusStrength * icePresence;

          // Constant liquid core (never disconnects once melt is heavy) + calm viscous downward-advecting roll-waves!
          float slowSwell = 0.76 + 0.24 * sin(dPos * 5.8 - uFlowRate * 0.34 + uPhase * 0.9);
          float baseCore = (0.0044 + 0.0060 * flowStrength) * slowSwell;

          float w1 = surgeWave(dPos, 0.115, 9.8,  uPhase * 1.1 + 0.3, 2.2);
          float w2 = surgeWave(dPos, 0.175, 16.5, uPhase * 2.4 + 2.1, 2.6);
          float w3 = surgeWave(dPos, 0.072, 6.2,  uPhase * 0.7 + 4.3, 1.9);
          float w4 = surgeWave(dPos, 0.215, 24.0, uPhase * 3.1 + 0.8, 2.4);
          float waves = (w1 * 0.0115 + w2 * 0.0080 + w3 * 0.0068 + w4 * 0.0030) * (0.42 + 0.58 * flowStrength);
          float waveCalm = 1.0 - meniscusCurve * 0.55;

          return meniscus + (baseCore + waves * waveCalm) * reachMask * flowStrength * uSideGain;
        }

        vec3 evalStreamPos(
          float ca,
          float sa,
          float v,
          float flowStrength,
          float meniscusStrength,
          out float outThick,
          out float outMeniscus
        ) {
          float yStart = min(${(POPSICLE.stickTopY - 0.04).toFixed(4)}, max(uIceBottomY + 0.020, uFunnelY + 0.046));
          float yBotArch = ${(POPSICLE.stickBottomY + POPSICLE.stickWidth * 0.5).toFixed(4)};
          float yEnd = ${(POPSICLE.stickBottomY + 0.012).toFixed(4)};
          // Concentrate vertical resolution near the upper concave meniscus bridge for silky smooth normals & silhouette
          float vCurve = v * 0.65 + v * v * 0.35;
          float y = mix(yStart, yEnd, vCurve);

          float tipTaper = smoothstep(yEnd, yBotArch, y);
          float thick = evalStreamThick(y, flowStrength, meniscusStrength, outMeniscus) * (0.20 + 0.80 * tipTaper);
          outThick = thick;

          // Follow the semicircular rounded bottom curve of the wooden stick so liquid hugs the tip cleanly!
          float rStick = ${(stickEdgeX - 0.0025).toFixed(5)};
          float dyBot = max(0.0, yBotArch - y);
          float woodEdgeX = sqrt(max(0.0001, rStick * rStick - dyBot * dyBot));

          float innerLap = (0.011 + min(thick, 0.028) * 0.72) * (0.35 + 0.65 * tipTaper);
          float xOut = (ca >= 0.0) ? (ca * thick) : (ca * innerLap);
          float zSwell = min(thick, 0.028) * 0.42 + max(0.0, thick - 0.028) * 0.24;
          float zHalf = ${stickHalfD.toFixed(5)} + 0.0012 + zSwell * smoothstep(-0.65, 0.45, ca);

          float zPos = sa * zHalf;
          float xPos = woodEdgeX + xOut;
          return vec3(xPos, y, zPos);
        }

        void main() {
          float u = position.x;
          float v = position.y;

          // Completely dry while freezer frost is thawing (melt < 0.16); peaks at mid-melt and subsides cleanly at endgame!
          float flowStrength = smoothstep(0.16, 0.44, uMelt) * (1.0 - smoothstep(0.64, 0.90, uMelt));
          float meniscusStrength = smoothstep(0.16, 0.30, uMelt) * (1.0 - smoothstep(0.64, 0.88, uMelt));
          vFlowMask = max(flowStrength, meniscusStrength);

          // Open curved D-cross-section hugging the vertical wooden edge from back bevel (-128 deg)
          // around outer liquid crest (0 deg, +X) to front bevel (+128 deg)
          float ang = (u - 0.5) * 4.46;
          float caC = cos(ang);
          float saC = sin(ang);

          float thickC;
          float meniscusC;
          vec3 P = evalStreamPos(caC, saC, v, flowStrength, meniscusStrength, thickC, meniscusC);

          // Analytical circumferential tangent tu (since thickness is independent of u -> cuts evalStreamPos from 5 to 3!)
          float innerLap = 0.011 + min(thickC, 0.028) * 0.72;
          float rOut = mix(innerLap, thickC, smoothstep(-0.08, 0.08, caC));
          float sCa = smoothstep(-0.65, 0.45, caC);
          float tCa = clamp((caC + 0.65) / 1.10, 0.0, 1.0);
          float dsDca = (caC > -0.65 && caC < 0.45) ? (6.0 * tCa * (1.0 - tCa) / 1.10) : 0.0;
          float zSwell = min(thickC, 0.028) * 0.42 + max(0.0, thickC - 0.028) * 0.24;
          float zHalf = ${stickHalfD.toFixed(5)} + 0.0012 + zSwell * sCa;
          vec3 tu = vec3(-saC * rOut, 0.0, caC * zHalf - saC * saC * zSwell * dsDca);

          float epsV = 0.004;
          float dummyThick;
          float dummyMen;
          vec3 PvP = evalStreamPos(caC, saC, min(1.0, v + epsV), flowStrength, meniscusStrength, dummyThick, dummyMen);
          vec3 PvM = evalStreamPos(caC, saC, max(0.0, v - epsV), flowStrength, meniscusStrength, dummyThick, dummyMen);
          vec3 tv = PvP - PvM;
          vec3 localN = safeNorm(cross(tu, tv));

          vCa = caC;
          vThickNorm = clamp(thickC / 0.026, 0.0, 1.35);
          vMeniscus = meniscusC;

          vec4 wp = modelMatrix * vec4(P, 1.0);
          vWorldPos = wp.xyz;
          vWorldY = wp.y;
          vWorldNormal = normalize(mat3(modelMatrix) * localN);
          vViewNormal = normalize(normalMatrix * localN);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;

        uniform sampler2D uSceneTex;
        uniform vec2 uResolution;
        uniform float uIceBottomY;
        uniform float uFunnelY;
        uniform vec3 uDropSigma;
        uniform vec3 uDropCreamColor;
        uniform float uDropOpacity;
        uniform vec3 uShadowTint;
        uniform vec3 uStainColor;

        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying vec3 vViewNormal;
        varying float vWorldY;
        varying float vCa;
        varying float vThickNorm;
        varying float vFlowMask;
        varying float vMeniscus;

        ${GLSL_SAFE_HELPERS}

        void main() {
          if (vFlowMask < 0.008 || vThickNorm < 0.03) discard;

          // Keep meniscus continuous all the way up behind the pouch silhouette (where hardware depth clips it seamlessly!)
          float topStart = max(uIceBottomY + 0.016, uFunnelY + 0.040);
          float topFull = max(uIceBottomY - 0.006, uFunnelY + 0.010);
          float topFade = revStep(topStart, topFull, vWorldY);
          float meniscusBlend = clamp(vMeniscus, 0.0, 1.0);
          float funnelClarity = clamp((1.0 - meniscusBlend * 0.85) * revStep(uFunnelY + 0.014, uFunnelY - 0.085, vWorldY), 0.0, 1.0);
          float innerFade = smoothstep(-0.60, 0.08, vCa);
          float thickFade = smoothstep(0.03, 0.18, vThickNorm);
          float alphaMask = topFade * innerFade * thickFade;
          if (alphaMask < 0.005) discard;

          vec2 screenUv = gl_FragCoord.xy / uResolution;
          vec3 N = normalize(vWorldNormal);
          vec3 Nv = normalize(vViewNormal);
          vec3 V = normalize(cameraPosition - vWorldPos);
          float ndv = clamp(dot(N, V), 0.0, 1.0);

          // Realistic thin-stream Snell refraction (gentler inside the pale concave meniscus so wood never bleeds into it!)
          float outerMask = smoothstep(-0.10, 0.32, vCa) * topFade;
          float refrAmp = mix(0.0016, 0.0052 * (0.70 + 0.36 * vThickNorm), outerMask) * mix(1.0, 0.68, meniscusBlend);
          vec2 refrVec = -Nv.xy * refrAmp * (0.65 + 0.55 * pow(1.0 - ndv, 0.85));

          vec3 refrCol;
          refrCol.r = texture2D(uSceneTex, clamp(screenUv + refrVec * 0.94, vec2(0.002), vec2(0.998))).r;
          refrCol.g = texture2D(uSceneTex, clamp(screenUv + refrVec * 1.00, vec2(0.002), vec2(0.998))).g;
          refrCol.b = texture2D(uSceneTex, clamp(screenUv + refrVec * 1.07, vec2(0.002), vec2(0.998))).b;

          // Match crystal-clear pale translucency of the bottom pouch across the meniscus bridge,
          // deepening smoothly into luminous juicy syrup crests as the stream pours down the wooden stick!
          float depthAmt = (0.105 + 0.23 * clamp(vThickNorm, 0.0, 1.15)) * (0.44 + 0.56 * funnelClarity);
          vec3 flavorTrans = exp(-uDropSigma * depthAmt);
          refrCol *= flavorTrans;
          // Soft translucent blush matching the crystal bottom pouch right at the top meniscus weld (zero tone step!)
          float pouchBlush = meniscusBlend * (1.0 - uDropOpacity * 0.85) * 0.24;
          refrCol = mix(refrCol, refrCol * mix(vec3(1.0), uStainColor * 0.72 + vec3(0.46), 0.78), pouchBlush);
          float woodWeld = revStep(0.55, -0.10, vCa) * (1.0 - uDropOpacity * 0.70) * smoothstep(0.24, 0.90, funnelClarity);
          refrCol = mix(refrCol, refrCol * mix(vec3(1.0), uStainColor * 1.02 + vec3(0.10), 0.42), woodWeld * 0.55);

          // Smooth creamy & pulpy recipe support (Coconut, Mango, Chocolate, Banana!)
          vec3 camH = safeNorm(vec3(cameraPosition.x, 0.0, cameraPosition.z));
          vec3 camR = vec3(camH.z, 0.0, -camH.x);
          vec3 l1 = normalize(-0.48 * camR + vec3(0.0, 0.56, 0.0) + 0.68 * camH);
          vec3 l2 = normalize( 0.54 * camR + vec3(0.0, 0.42, 0.0) + 0.72 * camH);
          float isMilkDrop = smoothstep(0.76, 0.98, uDropOpacity);
          float creamMix = smoothstep(0.04, 0.86, uDropOpacity) * mix(0.88, 0.98, isMilkDrop);
          if (creamMix > 0.005) {
            float cWrap = mix(0.62, 0.44, isMilkDrop) + 0.36 * clamp((dot(N, l1) + 0.45) / 1.45, 0.0, 1.0) + 0.20 * clamp((dot(N, l2) + 0.45) / 1.45, 0.0, 1.0);
            refrCol = mix(refrCol, uDropCreamColor * cWrap, creamMix);
          }

          // Delicate optical glass rim matching the translucent bottom pouch edge across the concave meniscus,
          // sharpening naturally into the crisp vertical stick-stream silhouette below!
          float darkContour = revStep(0.64, 0.20, ndv) * smoothstep(0.01, 0.18, ndv) * outerMask;
          vec3 streamRimTint = mix(uShadowTint * 0.64, uStainColor * 0.48, 0.52);
          vec3 pouchRimTint = mix(uShadowTint * 0.82, uStainColor * 0.74 + vec3(0.18), 0.45);
          vec3 darkRimTint = mix(streamRimTint, pouchRimTint, meniscusBlend * 0.85);
          float rimStrength = mix(0.62, 0.36, meniscusBlend) * (1.0 - uDropOpacity * 0.52);
          vec3 col = mix(refrCol, refrCol * darkRimTint, darkContour * rimStrength);

          // Subtle internal caustic brighten along downward-facing swelling wave bellies
          float waveCaustic = revStep(0.18, -0.68, Nv.y) * smoothstep(0.14, 0.72, ndv) * outerMask;
          col += mix(vec3(0.76, 0.68, 0.64), uStainColor * 0.78 + vec3(0.22), 0.50) * waveCaustic * 0.46 * (1.0 - uDropOpacity * 0.65);

          // Restrained silky studio Fresnel & gliding specular sparkles rippling down every surging wave crest!
          float fresnel = 0.018 + 0.982 * pow(1.0 - ndv, 4.6);
          vec3 R = reflect(-V, N);
          float rxStudio = dot(R, camR);
          float stripRefl = exp(-sq((abs(rxStudio) - 0.62) / 0.18)) * smoothstep(-0.85, 0.85, R.y);
          vec3 envSpec = vec3(1.16, 1.10, 1.06) * (0.24 + 0.42 * stripRefl);
          col = mix(col, envSpec, clamp(fresnel * (0.34 - 0.14 * uDropOpacity) * outerMask, 0.0, 0.36));

          vec3 h1 = safeNorm(l1 + V);
          vec3 h2 = safeNorm(l2 + V);
          float spec1 = pow(max(dot(N, h1), 0.0), 250.0);
          float spec2 = pow(max(dot(N, h2), 0.0), 200.0);
          col += vec3(2.4, 2.32, 2.25) * (spec1 * 0.68 + spec2 * 0.44) * outerMask;

          float alpha = smoothstep(0.0, 0.06, ndv) * alphaMask;
          gl_FragColor = vec4(col, clamp(alpha * 0.97, 0.0, 1.0));
        }
      `,
    });
  }

  const matR = makeStreamMaterial(0.0, 1.0, streamUniforms.uRightFunnelY, streamUniforms.uRightFunnelW);
  const matL = makeStreamMaterial(3.7, 1.06, streamUniforms.uLeftFunnelY, streamUniforms.uLeftFunnelW);

  const meshR = new THREE.Mesh(geo, matR);
  meshR.name = 'stick-flow-right';
  meshR.frustumCulled = false;

  const meshL = new THREE.Mesh(geo, matL);
  meshL.name = 'stick-flow-left';
  meshL.rotation.y = Math.PI;
  meshL.frustumCulled = false;

  const group = new THREE.Group();
  group.add(meshR, meshL);

  return {
    group,
    uniforms: streamUniforms,
    dispose() {
      geo.dispose();
      matR.dispose();
      matL.dispose();
    },
  };
}

/**
 * Continuous syrupy overflow filament hanging from the rounded bottom tip of the wooden stick:
 * - Swells a concave V-meniscus collar around the rounded bottom tip as stick runoff converges
 * - Extends downward into a glistening flowing liquid thread once the tip overflows
 * - Necks, pinches off, and retracts cleanly into a hanging meniscus at late melt before final drops finish!
 */
function createStickTipFilamentSystem(
  seed: number,
  sharedUniforms: {
    uSceneTex: { value: THREE.Texture | null };
    uResolution: { value: THREE.Vector2 };
    uTime: { value: number };
    uDropSigma: { value: THREE.Vector3 };
    uDropCreamColor: { value: THREE.Vector3 };
    uDropOpacity: { value: number };
    uShadowTint: { value: THREE.Vector3 };
    uStainColor: { value: THREE.Vector3 };
  },
): {
  mesh: THREE.Mesh;
  uniforms: {
    uFlowPhase: { value: number };
    uReach: { value: number };
    uThickness: { value: number };
    uTailDrop: { value: number };
    uCollarAmt: { value: number };
  };
  dispose(): void;
} {
  const segU = 22;
  const segV = 88;
  const stride = segU + 1;
  const vCount = stride * (segV + 1);
  const positions = new Float32Array(vCount * 3);
  const indices: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const idx = iv * stride + iu;
      positions[idx * 3] = u;
      positions[idx * 3 + 1] = v;
      positions[idx * 3 + 2] = 0;
    }
  }
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);

  const tipY = POPSICLE.stickBottomY;
  const stickHalfW = POPSICLE.stickWidth * 0.5;
  const stickHalfD = POPSICLE.stickDepth * 0.5;
  const yArcCenter = tipY + stickHalfW;
  const filUniforms = {
    uFlowPhase: { value: 0.0 as number },
    /** Downward length of the flowing filament below stickBottomY (0 -> 2.45 world units) */
    uReach: { value: 0.0 as number },
    /** Overall filament body fullness [0..1] (thins smoothly as supply winds down & pinches off) */
    uThickness: { value: 0.0 as number },
    /** Post-pinch falling tail offset [0..1.8]: detaches the broken filament tail downward off-screen! */
    uTailDrop: { value: 0.0 as number },
    /** Concave V-meniscus collar presence hugging the rounded bottom stick tip [0..1] */
    uCollarAmt: { value: 0.0 as number },
  };

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: {
      uSceneTex: sharedUniforms.uSceneTex,
      uResolution: sharedUniforms.uResolution,
      uTime: sharedUniforms.uTime,
      uDropSigma: sharedUniforms.uDropSigma,
      uDropCreamColor: sharedUniforms.uDropCreamColor,
      uDropOpacity: sharedUniforms.uDropOpacity,
      uShadowTint: sharedUniforms.uShadowTint,
      uStainColor: sharedUniforms.uStainColor,
      uFlowPhase: filUniforms.uFlowPhase,
      uReach: filUniforms.uReach,
      uThickness: filUniforms.uThickness,
      uTailDrop: filUniforms.uTailDrop,
      uCollarAmt: filUniforms.uCollarAmt,
      uPhase: { value: seed * 3.17 + 1.1 },
    },
    vertexShader: /* glsl */ `
      uniform float uFlowPhase;
      uniform float uReach;
      uniform float uThickness;
      uniform float uTailDrop;
      uniform float uCollarAmt;
      uniform float uPhase;
      uniform float uDropOpacity;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      varying float vV;
      varying float vRadNorm;
      varying float vAlphaMask;

      ${GLSL_SAFE_HELPERS}

      float filamentWave(float d, float speed, float freq, float ph, float pwr) {
        float a = d * freq - uFlowPhase * speed * freq + ph;
        float skew = sin(a - 0.44 * sin(a));
        return pow(clamp(0.5 + 0.5 * skew, 0.0, 1.0), pwr);
      }

      float smaxFil(float a, float b, float k) {
        float h = clamp(0.5 + 0.5 * (b - a) / max(1e-5, k), 0.0, 1.0);
        return mix(a, b, h) + k * h * (1.0 - h);
      }

      void evalFilament(float v, out float outY, out float outRx, out float outRz, out float outCx, out float outCz, out float outMask) {
        const float tipY = ${tipY.toFixed(4)};
        const float stickHalfW = ${stickHalfW.toFixed(4)};
        const float stickHalfD = ${stickHalfD.toFixed(4)};
        const float yArcCenter = ${yArcCenter.toFixed(4)};
        const float collarOverlap = 0.064;

        float yTop = tipY + collarOverlap;
        float totalLen = max(0.08, uReach + collarOverlap);
        // Concentrate vertex density near the top V-meniscus collar & rounded tip!
        float vCurve = v * 0.42 + v * v * 0.58;
        float d = vCurve * totalLen;

        // When pinching off (uTailDrop > 0), lower filament detaches cleanly below pinch neck and accelerates off-screen!
        float tailMask = smoothstep(0.085, 0.175, d);
        float y = yTop - d - uTailDrop * tailMask * 1.75;
        outY = y;

        // Continuous distance downward from the upper wood-flank attachment (yTop) and below the stick tip (tipY)
        float sTop = max(0.0, yTop - y);
        float dBelow = max(0.0, tipY - y);
        float viscousMul = mix(1.0, 1.28, smoothstep(0.25, 0.90, uDropOpacity));

        // 1. TRUE WOOD-ARC-TANGENT CONCAVE V-MENISCUS COLLAR (ZERO horizontal shelf, ZERO step!)
        // Along the curved lower flanks of the rounded stick tip (y > tipY), hug the semicircular birch contour
        // smoothly and then sweep tangentially inward into a concave V-funnel converging beneath the tip!
        float dyArc = clamp(yArcCenter - y, 0.0, stickHalfW);
        float woodHalfW = sqrt(max(0.0, stickHalfW * stickHalfW - dyArc * dyArc));
        float vFunnel = (0.092 * exp(-sTop / 0.056) + 0.018 * exp(-sTop / 0.135)) * uCollarAmt * viscousMul;
        // Clamp collar width smoothly inside the wet wood flank near yTop so it tucks invisibly onto the glazed stick!
        float topWoodClamp = mix(min(vFunnel, woodHalfW + 0.005 * uCollarAmt), vFunnel, smoothstep(0.012, 0.046, sTop));
        float collarRx = topWoodClamp;
        // Keep front-to-back depth flush against the flat wooden stick face above tipY, tapering smoothly into circular below!
        float collarRz = (stickHalfD + 0.003) * exp(-dBelow / 0.052) * uCollarAmt;

        // 2. Continuous syrupy flowing thread with gentle gravity-accelerated taper + gliding Rayleigh-Plateau pulses!
        float gravityTaper = 1.0 / pow(1.0 + dBelow * 1.15, 0.22);
        float w1 = filamentWave(dBelow, 0.62, 11.5, uPhase, 1.9);
        float w2 = filamentWave(dBelow, 0.92, 19.5, uPhase * 1.7 + 2.1, 2.3);
        float pulse = 1.0 + (w1 * 0.34 + w2 * 0.18) * smoothstep(0.03, 0.26, dBelow);

        // Rounded leading droplet bead while the filament is first overflowing & stretching down off the tip!
        float distFromTip = max(0.0, (1.0 - vCurve) * totalLen);
        float extendingMask = 1.0 - smoothstep(1.35, 2.15, uReach);
        float leadHead = exp(-sq((distFromTip - 0.036) / 0.038)) * 0.018 * extendingMask * smoothstep(0.02, 0.16, uReach);
        float tipClose = smoothstep(0.0, 0.028, distFromTip);

        // Smooth hourglass pinch-off right below the meniscus when transitioning from continuous stream -> final drops!
        float pinchZone = exp(-sq((dBelow - 0.082) / 0.052));
        float pinchAtten = 1.0 - smoothstep(0.0, 0.48, uTailDrop) * pinchZone;
        float tailFade = 1.0 - smoothstep(0.45, 1.35, uTailDrop) * tailMask;
        // Soften residual upper cone during pinch so it rounds gracefully into the first final drop instead of a sharp needle
        float collarPinchRound = 1.0 - smoothstep(0.15, 0.85, uTailDrop) * smoothstep(0.015, 0.090, dBelow);

        float bodyR = (0.0172 * gravityTaper * pulse * uThickness + leadHead) * viscousMul * pinchAtten * tailFade * tipClose;
        // C-infinity smooth blend from the tangent V-meniscus collar into the cylindrical liquid filament!
        float rx = smaxFil(bodyR, collarRx * collarPinchRound, 0.0085) * tipClose;
        float rz = smaxFil(bodyR, collarRz * collarPinchRound, 0.0075) * tipClose;

        // Close bottom pole cleanly to zero; keep top edge tucked flush on the curved stick contour!
        float botPole = smoothstep(1.0, 0.985, v);
        outRx = rx * botPole;
        outRz = rz * botPole;

        // Whisper-subtle organic capillary sway as the syrupy thread streams downward
        float swayAmp = smoothstep(0.05, 0.65, dBelow) * 0.0062 * (1.0 - uDropOpacity * 0.32);
        outCx = sin(dBelow * 4.0 - uFlowPhase * 2.2 + uPhase) * swayAmp;
        outCz = cos(dBelow * 3.2 - uFlowPhase * 1.8 + uPhase * 0.7) * swayAmp * 0.65;

        // Feather alpha invisibly onto the glazed curved wood flanks across the top 0.036 of overlap
        float topFeather = smoothstep(0.004, 0.038, sTop);
        outMask = topFeather * smoothstep(1.0, 0.965, v) * smoothstep(0.0018, 0.0070, max(rx, rz));
      }

      void main() {
        float u = position.x;
        float v = position.y;
        float ang = u * 6.2831853;
        float ca = cos(ang);
        float sa = sin(ang);

        float yC, rxC, rzC, cxC, czC, mC;
        evalFilament(v, yC, rxC, rzC, cxC, czC, mC);
        vec3 P = vec3(cxC + ca * rxC, yC, czC + sa * rzC);

        float epsV = 0.005;
        float yP, rxP, rzP, cxP, czP, mP;
        float yM, rxM, rzM, cxM, czM, mM;
        evalFilament(min(1.0, v + epsV), yP, rxP, rzP, cxP, czP, mP);
        evalFilament(max(0.0, v - epsV), yM, rxM, rzM, cxM, czM, mM);

        vec3 tu = vec3(-sa * max(rxC, 1e-4), 0.0, ca * max(rzC, 1e-4));
        vec3 tv = vec3(cxP + ca * rxP - (cxM + ca * rxM), yP - yM, czP + sa * rzP - (czM + sa * rzM));
        vec3 localN = safeNorm(cross(tu, tv));

        vV = v;
        vRadNorm = clamp(max(rxC, rzC) / 0.024, 0.0, 1.4);
        vAlphaMask = mC;

        vec4 wp = modelMatrix * vec4(P, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * localN);
        vViewNormal = normalize(normalMatrix * localN);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform sampler2D uSceneTex;
      uniform vec2 uResolution;
      uniform vec3 uDropSigma;
      uniform vec3 uDropCreamColor;
      uniform float uDropOpacity;
      uniform vec3 uShadowTint;
      uniform vec3 uStainColor;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      varying float vV;
      varying float vRadNorm;
      varying float vAlphaMask;

      ${GLSL_SAFE_HELPERS}

      void main() {
        if (vAlphaMask < 0.01) discard;

        vec2 screenUv = gl_FragCoord.xy / uResolution;
        vec3 N = normalize(vWorldNormal);
        vec3 Nv = normalize(vViewNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(N, V), 0.0, 1.0);

        // Crisp cylindrical liquid lens refraction (bends the warm studio backdrop cleanly through the thin syrup filament!)
        float refrAmp = 0.0052 * (0.70 + 0.55 * vRadNorm);
        vec2 refrVec = -Nv.xy * refrAmp * (0.62 + 0.65 * pow(1.0 - ndv, 0.78));

        vec3 refrCol;
        refrCol.r = texture2D(uSceneTex, clamp(screenUv + refrVec * 0.94, vec2(0.002), vec2(0.998))).r;
        refrCol.g = texture2D(uSceneTex, clamp(screenUv + refrVec * 1.00, vec2(0.002), vec2(0.998))).g;
        refrCol.b = texture2D(uSceneTex, clamp(screenUv + refrVec * 1.07, vec2(0.002), vec2(0.998))).b;

        // Rich juicy flavor Beer-Lambert tint (matches the wet stick runoff & hanging drops seamlessly!)
        float depthAmt = 0.42 + 0.46 * vRadNorm;
        refrCol *= exp(-uDropSigma * depthAmt);
        refrCol = mix(refrCol, refrCol * mix(vec3(1.0), uStainColor * 0.92 + vec3(0.10), 0.80), 0.44 * (1.0 - uDropOpacity * 0.85));

        vec3 camH = safeNorm(vec3(cameraPosition.x, 0.0, cameraPosition.z));
        vec3 camR = vec3(camH.z, 0.0, -camH.x);
        vec3 l1 = normalize(-0.48 * camR + vec3(0.0, 0.56, 0.0) + 0.68 * camH);
        vec3 l2 = normalize( 0.54 * camR + vec3(0.0, 0.42, 0.0) + 0.72 * camH);

        // Opaque creamy / chocolate / coconut milk filament support!
        float isMilkDrop = smoothstep(0.76, 0.98, uDropOpacity);
        float creamMix = smoothstep(0.04, 0.86, uDropOpacity) * mix(0.90, 0.98, isMilkDrop);
        if (creamMix > 0.005) {
          float cWrap = mix(0.62, 0.44, isMilkDrop) + 0.36 * clamp((dot(N, l1) + 0.45) / 1.45, 0.0, 1.0) + 0.20 * clamp((dot(N, l2) + 0.45) / 1.45, 0.0, 1.0);
          refrCol = mix(refrCol, uDropCreamColor * cWrap, creamMix);
        }

        // Crisp dark optical liquid edge contour so the thin glistening filament reads vividly against the bright studio backdrop!
        float darkContour = revStep(0.72, 0.14, ndv) * smoothstep(0.01, 0.15, ndv);
        vec3 darkRimTint = mix(uShadowTint * 0.48, uStainColor * 0.36, 0.58);
        vec3 col = mix(refrCol, refrCol * darkRimTint, darkContour * (0.82 - 0.38 * uDropOpacity));

        // Internal warm backlit caustic glow down the core of the liquid thread
        float coreGlow = pow(ndv, 1.5) * (1.0 - uDropOpacity * 0.80);
        col += (uStainColor * 0.45 + vec3(0.16, 0.10, 0.10)) * coreGlow * 0.26;

        // Crisp gliding vertical studio highlight stripe running down the glossy filament!
        float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 4.0);
        vec3 R = reflect(-V, N);
        float rxStudio = dot(R, camR);
        float stripRefl = exp(-sq((abs(rxStudio) - 0.56) / 0.17));
        vec3 envSpec = vec3(1.25, 1.18, 1.14) * (0.30 + 0.52 * stripRefl);
        col = mix(col, envSpec, clamp(fresnel * (0.44 - 0.18 * uDropOpacity), 0.0, 0.46));

        vec3 h1 = safeNorm(l1 + V);
        vec3 h2 = safeNorm(l2 + V);
        float spec1 = pow(max(dot(N, h1), 0.0), 210.0);
        float spec2 = pow(max(dot(N, h2), 0.0), 160.0);
        col += vec3(2.8, 2.70, 2.62) * (spec1 * 0.85 + spec2 * 0.52);

        float alpha = smoothstep(0.0, 0.06, ndv) * vAlphaMask;
        gl_FragColor = vec4(col, clamp(alpha * 0.99, 0.0, 1.0));
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'stick-tip-filament';
  mesh.frustumCulled = false;
  mesh.visible = false;

  return {
    mesh,
    uniforms: filUniforms,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Reusable 3D asymmetric gravity-sagged teardrop geometry designed to cling flush to the
 * left and right vertical edges of the wooden popsicle stick (x = 0 is the wood edge plane,
 * +X protrudes cleanly into the studio air; rotated 180 deg around Y for the left stick edge).
 */
function createStickEdgeDropGeometry(): THREE.BufferGeometry {
  const segU = 22;
  const segV = 28;
  const stride = segU + 1;
  const vCount = stride * (segV + 1);
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const collarFades = new Float32Array(vCount);
  const filletFades = new Float32Array(vCount);
  const indices: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const t = iv / segV; // 0 = tapered top wet tail, 1 = plump bottom dome
    const y = 1.0 - 2.0 * t;
    const angV = t * Math.PI;
    // C-infinity smooth elongated gravity-sagged teardrop profile with slender upper wet tail & plump lower belly!
    const rho = (Math.pow(Math.sin(angV * 0.5), 1.65) * Math.sin(angV)) / 0.654;
    const collarFade = smoothstep(0.0, 0.16, t);
    const filletFade = smoothstep(0.02, 0.24, t);

    for (let iu = 0; iu <= segU; iu++) {
      const ang = iu === segU ? 0 : (iu / segU) * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      // Outer half (+X) protrudes cleanly & prominently past the wood edge into the bright studio backdrop;
      // inner half (-X) tucks snugly onto the wood edge and feathers invisibly into the wet wood!
      const xLocal = (ca >= 0 ? ca * rho : ca * rho * 0.30) - 0.04 * rho;
      const zLocal = sa * rho * 0.86;
      const idx = iv * stride + iu;
      positions[idx * 3] = xLocal;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = zLocal;
      const innerFeather = smoothstep(-0.22, 0.16, ca);
      collarFades[idx] = collarFade * innerFeather;
      filletFades[idx] = filletFade * smoothstep(-0.14, 0.24, ca);
    }
  }

  // Exact smooth outward normals via finite-difference surface tangents
  for (let iv = 0; iv <= segV; iv++) {
    for (let iu = 0; iu <= segU; iu++) {
      const idx = iv * stride + iu;
      const o = idx * 3;
      if (iv === 0) {
        normals[o] = 0.2;
        normals[o + 1] = 0.98;
        normals[o + 2] = 0;
        continue;
      }
      if (iv === segV) {
        normals[o] = 0;
        normals[o + 1] = -1;
        normals[o + 2] = 0;
        continue;
      }
      const iuPrev = iu === 0 ? segU - 1 : iu - 1;
      const iuNext = iu === segU ? 1 : iu + 1;
      const ivPrev = Math.max(0, iv - 1);
      const ivNext = Math.min(segV, iv + 1);

      const oUp = (iv * stride + iuNext) * 3;
      const oUm = (iv * stride + iuPrev) * 3;
      const oVp = (ivNext * stride + iu) * 3;
      const oVm = (ivPrev * stride + iu) * 3;

      const tux = positions[oUp] - positions[oUm];
      const tuy = positions[oUp + 1] - positions[oUm + 1];
      const tuz = positions[oUp + 2] - positions[oUm + 2];
      const tvx = positions[oVp] - positions[oVm];
      const tvy = positions[oVp + 1] - positions[oVm + 1];
      const tvz = positions[oVp + 2] - positions[oVm + 2];

      const nx = tuy * tvz - tuz * tvy;
      const ny = tuz * tvx - tux * tvz;
      const nz = tux * tvy - tuy * tvx;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals[o] = nx / len;
      normals[o + 1] = ny / len;
      normals[o + 2] = nz / len;
    }
  }

  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('aCollarFade', new THREE.BufferAttribute(collarFades, 1));
  geo.setAttribute('aFilletFade', new THREE.BufferAttribute(filletFades, 1));
  geo.setIndex(indices);
  return geo;
}

const PENDANT_SEG_U = 28;
const PENDANT_SEG_V = 40;

// Hoisted scratch arrays & trig LUTs for zero-allocation axisymmetric lathe rebuilds
const _pendantRadiusProfile = new Float32Array(PENDANT_SEG_V + 1);
const _pendantYProfile = new Float32Array(PENDANT_SEG_V + 1);
const _pendantCosU = new Float32Array(PENDANT_SEG_U + 1);
const _pendantSinU = new Float32Array(PENDANT_SEG_U + 1);
for (let iu = 0; iu <= PENDANT_SEG_U; iu++) {
  const ang = iu === PENDANT_SEG_U ? 0 : (iu / PENDANT_SEG_U) * Math.PI * 2;
  _pendantCosU[iu] = Math.cos(ang);
  _pendantSinU[iu] = Math.sin(ang);
}

function createPendantLatheGeometry(): THREE.BufferGeometry {
  const vCount = (PENDANT_SEG_U + 1) * (PENDANT_SEG_V + 1);
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const collarFades = new Float32Array(vCount);
  const filletFades = new Float32Array(vCount);
  const indices: number[] = [];

  for (let iv = 0; iv < PENDANT_SEG_V; iv++) {
    for (let iu = 0; iu < PENDANT_SEG_U; iu++) {
      const a = iv * (PENDANT_SEG_U + 1) + iu;
      const b = a + 1;
      const c = a + (PENDANT_SEG_U + 1);
      const d = c + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const normAttr = new THREE.BufferAttribute(normals, 3);
  const collarAttr = new THREE.BufferAttribute(collarFades, 1);
  const filletAttr = new THREE.BufferAttribute(filletFades, 1);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  normAttr.setUsage(THREE.DynamicDrawUsage);
  collarAttr.setUsage(THREE.DynamicDrawUsage);
  filletAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', normAttr);
  geo.setAttribute('aCollarFade', collarAttr);
  geo.setAttribute('aFilletFade', filletAttr);
  geo.setIndex(indices);
  return geo;
}

interface PendantEvalResult {
  visible: boolean;
  yBulbCenter: number;
  bulbR: number;
  pinchY: number;
}

function updatePendantLatheGeometry(
  geo: THREE.BufferGeometry,
  stage: PendantStage,
  grow: number,
  stageU: number,
  scale: number,
  recoilStartY: number,
): PendantEvalResult {
  // True physical capillary drop radius (~0.036 at scale=1 -> matches real water drop breakup scale!)
  const Rmax = 0.036 * scale;
  if (Rmax < 0.002 || stage === 'dormant' || (stage === 'growing' && grow < 0.008)) {
    return { visible: false, yBulbCenter: 0, bulbR: 0, pinchY: 0 };
  }

  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const normAttr = geo.attributes.normal as THREE.BufferAttribute;
  const collarAttr = geo.attributes.aCollarFade as THREE.BufferAttribute;
  const filletAttr = geo.attributes.aFilletFade as THREE.BufferAttribute;
  const pos = posAttr.array as Float32Array;
  const norm = normAttr.array as Float32Array;
  const collarArr = collarAttr.array as Float32Array;
  const filletArr = filletAttr.array as Float32Array;

  const radiusProfile = _pendantRadiusProfile;
  const yProfile = _pendantYProfile;

  const smax = (a: number, b: number, k: number) => {
    const h = clamp(0.5 + (0.5 * (b - a)) / Math.max(1e-5, k), 0, 1);
    return a + (b - a) * h + k * h * (1 - h);
  };

  // neckMesh is positioned at (tmpPos.x, tmpPos.y - 0.003, tmpPos.z * 0.12), aligning y = 0 directly with
  // the perspective-projected bottom silhouette of the curved lower ice bevel. The wide concave wetting fillet
  // flares tangentially RIGHT AT yEdge = -0.001 while the upper rim smoothly tucks cleanly inside the bevel!
  const yEdge = -0.001;
  const yFillet = 0.0028 * scale;
  const yTop = 0.009 * scale * (stage === 'growing' ? 0.65 + 0.35 * clamp(grow, 0, 1) : 1.0);
  let yBulbCenter = yEdge - 0.01;
  let bulbR = Rmax;
  let pinchY = -Rmax;

  if (stage === 'recoiling') {
    const u = clamp(stageU, 0, 1);
    // Slightly viscous sugary-juice upper cone retracts smoothly upward into the wet ice rim
    const snap = Math.exp(-u * 4.8) * Math.cos(u * Math.PI * 1.15);
    const tipY = Math.min(yEdge - 0.001, recoilStartY * Math.max(-0.04, snap));
    const tipR = Math.max(0.0012, Rmax * (0.20 + 0.14 * Math.sin(u * Math.PI)) * (1.0 - 0.68 * u));
    const collarR = Rmax * (1.42 - 0.52 * u);

    if (tipY >= yEdge - 0.002) {
      return { visible: false, yBulbCenter: 0, bulbR: 0, pinchY: 0 };
    }

    const tipCenterY = tipY + tipR;
    for (let iv = 0; iv <= PENDANT_SEG_V; iv++) {
      const lin = iv / PENDANT_SEG_V;
      const s = lin < 0.72 ? lin : 0.72 + 0.28 * Math.sin(((lin - 0.72) / 0.28) * Math.PI * 0.5);
      const y = yTop + (tipY - yTop) * s;
      yProfile[iv] = y;
      if (iv === PENDANT_SEG_V) {
        radiusProfile[iv] = 0;
      } else if (y <= tipCenterY) {
        const t = clamp((tipCenterY - y) / Math.max(1e-4, tipR), 0, 1);
        radiusProfile[iv] = tipR * Math.sqrt(Math.max(0, 1.0 - t * t));
      } else {
        const su = clamp((yFillet - y) / Math.max(1e-4, yFillet - tipCenterY), 0, 1);
        const cone = collarR * Math.exp(-su * 2.5);
        radiusProfile[iv] = smax(cone, tipR * (0.72 + 0.28 * su), tipR * 0.48);
      }
    }
    bulbR = tipR;
    yBulbCenter = tipCenterY;
  } else {
    let bulbVert: number;
    let collarR: number;
    let rMin: number;
    let pUp: number;
    let pBot: number;
    let waistFrac: number;
    let neckAmt: number;

    if (stage === 'growing') {
      const g = clamp(grow, 0, 1);
      // TRUE YOUNG-LAPLACE PENDANT EMERGENCE (ZERO flat cut, ZERO glued-on marble, ZERO upper halo!):
      // - Early growth (g = 0..0.48): wide, smooth concave-to-convex liquid bell hanging cleanly BELOW the
      //   bottom silhouette, flaring gracefully outward into the underside edge (like real melt references!)
      // - Mature growth (g = 0.48..1.0): smoothly transitions into a teardrop hourglass waist right before pinch!
      bulbR = Rmax * Math.pow(g, 0.72);
      bulbVert = bulbR * (0.76 + 0.44 * smoothstep(0.25, 1.0, g));
      const yBottomTarget = -Rmax * (0.85 * Math.pow(g, 0.65) + 2.00 * Math.pow(g, 1.25));
      yBulbCenter = yBottomTarget + bulbVert;
      collarR = Math.max(Rmax * 0.70, bulbR * (2.32 - 0.52 * g));
      neckAmt = smoothstep(0.48, 1.0, g);
      rMin = bulbR * (1.0 - 0.44 * neckAmt);
      pUp = 1.95;
      pBot = 1.15;
      waistFrac = 0.48;
    } else {
      // 'pinching': exact C1 continuation from growing (g = 1.0) -> thinning hourglass catenoid bridge -> snap!
      const u = clamp(stageU, 0, 1);
      bulbR = Rmax * (1.0 - 0.07 * Math.sin(u * Math.PI * 0.85));
      bulbVert = Rmax * (1.20 + 0.22 * Math.sin(u * Math.PI * 0.80) + 0.04 * u);
      const sagDist = 3.55 * Rmax * Math.pow(u, 2.05);
      // Exact match with growing g = 1.0: -2.85*Rmax + 1.20*Rmax = -1.65*Rmax
      yBulbCenter = -1.65 * Rmax - sagDist;
      collarR = Rmax * (1.80 - 0.26 * u);
      rMin = Math.max(0.004 * Rmax, Rmax * 0.56 * Math.pow(Math.max(0, 1.0 - u), 1.08));
      pUp = 1.95 + 0.35 * u;
      pBot = 1.15 + 0.32 * u;
      waistFrac = 0.48 + 0.04 * u;
      neckAmt = 1.0;
    }

    const yBottom = yBulbCenter - bulbVert;
    const yWaist = Math.min(yFillet - 0.002, Math.max(yBulbCenter + 0.002, yFillet + (yBulbCenter - yFillet) * waistFrac));
    pinchY = yWaist;

    if (yBottom >= yEdge - 0.001) {
      return { visible: false, yBulbCenter, bulbR, pinchY };
    }

    const spanBell = Math.max(1e-4, yFillet - yBulbCenter);
    const spanUp = Math.max(1e-4, yFillet - yWaist);
    const spanDn = Math.max(1e-4, yWaist - yBulbCenter);
    const spanCap = Math.max(1e-4, yTop - yFillet);

    for (let iv = 0; iv <= PENDANT_SEG_V; iv++) {
      const lin = iv / PENDANT_SEG_V;
      const s = lin < 0.72 ? lin : 0.72 + 0.28 * Math.sin(((lin - 0.72) / 0.28) * Math.PI * 0.5);
      const y = yTop + (yBottom - yTop) * s;
      yProfile[iv] = y;

      if (iv === PENDANT_SEG_V) {
        radiusProfile[iv] = 0;
        continue;
      }

      if (y <= yBulbCenter) {
        // Plump smooth rounded lower dome (C1 tangent dr/dy = 0 at y = yBulbCenter)
        const t = clamp((yBulbCenter - y) / Math.max(1e-4, bulbVert), 0, 1);
        radiusProfile[iv] = bulbR * Math.sqrt(Math.max(0, 1.0 - t * t));
      } else {
        // 1. Pure monotonic concave-outward capillary bell (used for early emerging swells -> zero pinch/seam!)
        let rBell: number;
        if (y <= yFillet) {
          const tB = clamp((y - yBulbCenter) / spanBell, 0, 1);
          rBell = bulbR + (collarR - bulbR) * Math.pow(tB, 1.75);
        } else {
          const tCap = clamp((y - yFillet) / spanCap, 0, 1);
          rBell = collarR * (1.0 + 0.22 * tCap);
        }

        // 2. Mature teardrop / hourglass catenoid bridge (blended in smoothly as neckAmt 0 -> 1!)
        let rHour: number;
        if (y <= yWaist) {
          const tDn = clamp((yWaist - y) / spanDn, 0, 1);
          const sw = Math.pow(tDn, pBot);
          const f = sw * sw * (3.0 - 2.0 * sw);
          rHour = rMin + (bulbR - rMin) * f;
        } else if (y <= yFillet) {
          const tUp = clamp((y - yWaist) / spanUp, 0, 1);
          rHour = rMin + (collarR - rMin) * Math.pow(tUp, pUp);
        } else {
          const tCap = clamp((y - yFillet) / spanCap, 0, 1);
          rHour = collarR * (1.0 + 0.22 * tCap);
        }

        radiusProfile[iv] = rBell + (rHour - rBell) * neckAmt;
      }
    }
  }

  // Pure axisymmetric lathe (ZERO Z-protrusion onto the front ice face -> clean 360-deg orbit & zero ghost dome!)
  const filletSpan = Math.max(0.006, Math.min(0.018, Math.max(0.005, yEdge - yBulbCenter) * 0.72));
  const stride = PENDANT_SEG_U + 1;
  let maxR = 0;
  for (let iv = 0; iv <= PENDANT_SEG_V; iv++) {
    const r = radiusProfile[iv];
    if (r > maxR) maxR = r;
    const y = yProfile[iv];

    const ivPrev = iv > 0 ? iv - 1 : 0;
    const ivNext = iv < PENDANT_SEG_V ? iv + 1 : PENDANT_SEG_V;
    const dr = radiusProfile[ivNext] - radiusProfile[ivPrev];
    const dy = yProfile[ivNext] - yProfile[ivPrev];
    const invNLen = 1.0 / (Math.hypot(-dy, dr) || 1);
    const nr = -dy * invNLen;
    const ny = dr * invNLen;

    // Smoothly dissolve alpha from 1.0 (full visible drop + concave fillet below yEdge) -> 0.0 across the
    // tucked upper collar; filletFade reaches 0 RIGHT at yEdge so ZERO dark contour/halo draws over the ice!
    const collarFade = 1.0 - smoothstep(yEdge, yTop - 0.001, y);
    const filletFade = smoothstep(yEdge, yEdge - filletSpan, y);
    const rowOff = iv * stride;

    if (iv === PENDANT_SEG_V) {
      for (let iu = 0; iu <= PENDANT_SEG_U; iu++) {
        const idx = rowOff + iu;
        const o = idx * 3;
        pos[o] = 0;
        pos[o + 1] = y;
        pos[o + 2] = 0;
        norm[o] = 0;
        norm[o + 1] = -1;
        norm[o + 2] = 0;
        collarArr[idx] = collarFade;
        filletArr[idx] = filletFade;
      }
    } else {
      for (let iu = 0; iu <= PENDANT_SEG_U; iu++) {
        const ca = _pendantCosU[iu];
        const sa = _pendantSinU[iu];
        const idx = rowOff + iu;
        const o = idx * 3;
        pos[o] = ca * r;
        pos[o + 1] = y;
        pos[o + 2] = sa * r;
        norm[o] = ca * nr;
        norm[o + 1] = ny;
        norm[o + 2] = sa * nr;
        collarArr[idx] = collarFade;
        filletArr[idx] = filletFade;
      }
    }
  }

  posAttr.needsUpdate = true;
  normAttr.needsUpdate = true;
  collarAttr.needsUpdate = true;
  filletAttr.needsUpdate = true;

  // O(1) analytic bounding sphere (avoids scanning 1,189 vertices on every drop update!)
  const yMin = yProfile[PENDANT_SEG_V];
  const yMid = 0.5 * (yTop + yMin);
  const halfH = 0.5 * Math.abs(yTop - yMin);
  if (!geo.boundingSphere) geo.boundingSphere = new THREE.Sphere();
  geo.boundingSphere.center.set(0, yMid, 0);
  geo.boundingSphere.radius = Math.hypot(maxR, halfH) + 0.005;

  return { visible: true, yBulbCenter, bulbR, pinchY };
}

export function createWaterDropSystem(
  seed: number,
  initialMode: DropMode = 'off',
  initialRecipe: PopsicleRecipe = DEFAULT_RECIPE,
): WaterDropSystem {
  const disposables: Array<{ dispose(): void }> = [];
  let dropMode: DropMode = initialMode;
  const debugParams: DropDebugParams = { ...DEFAULT_DROP_DEBUG };
  const initPal = resolveOpticalPalette(initialRecipe);

  const uniforms: WaterDropUniforms = {
    uSceneTex: { value: null },
    uDropFieldTex: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 720) },
    uTime: { value: 0 },
    uDropSag: { value: debugParams.sag },
    uDropStretch: { value: debugParams.stretch },
    uDropSize: { value: debugParams.size },
    uEdgeSoftness: { value: debugParams.edgeBlur },
    uShadowStrength: { value: debugParams.shadow },
    uShadowBlur: { value: debugParams.shadowBlur },
    uRimDark: { value: debugParams.rimDark },
    uDropSigma: { value: new THREE.Vector3(...initPal.dropSigma) },
    uDropCreamColor: { value: new THREE.Vector3(...initPal.dropCreamColor) },
    // Keep drops, stick runoff, and tip filament translucent & refractive (matching Water optics) on all bases
    uDropOpacity: { value: 0.0 },
    uShadowTint: { value: new THREE.Vector3(...initPal.shadowTint) },
    uStainColor: { value: new THREE.Vector3(...initPal.stainColor) },
  };

  function setRecipe(nextRecipe: PopsicleRecipe) {
    const pal = resolveOpticalPalette(nextRecipe);
    uniforms.uDropSigma.value.set(...pal.dropSigma);
    uniforms.uDropCreamColor.value.set(...pal.dropCreamColor);
    uniforms.uDropOpacity.value = 0.0;
    uniforms.uShadowTint.value.set(...pal.shadowTint);
    uniforms.uStainColor.value.set(...pal.stainColor);
  }

  // === PASS 6a: INSTANCED LIQUID METABALL KERNEL SPLATS ===
  const baseQuad = new THREE.PlaneGeometry(1, 1);
  const instGeo = new THREE.InstancedBufferGeometry();
  instGeo.index = baseQuad.index;
  instGeo.attributes.position = baseQuad.attributes.position;

  const centersArr = new Float32Array(TOTAL_METABALLS * 3);
  const normalsArr = new Float32Array(TOTAL_METABALLS * 3);
  const paramsArr = new Float32Array(TOTAL_METABALLS * 4);
  const motionArr = new Float32Array(TOTAL_METABALLS * 3);

  const centersAttr = new THREE.InstancedBufferAttribute(centersArr, 3);
  const normalsAttr = new THREE.InstancedBufferAttribute(normalsArr, 3);
  const paramsAttr = new THREE.InstancedBufferAttribute(paramsArr, 4);
  const motionAttr = new THREE.InstancedBufferAttribute(motionArr, 3);
  centersAttr.setUsage(THREE.DynamicDrawUsage);
  normalsAttr.setUsage(THREE.DynamicDrawUsage);
  paramsAttr.setUsage(THREE.DynamicDrawUsage);
  motionAttr.setUsage(THREE.DynamicDrawUsage);

  instGeo.setAttribute('aCenter', centersAttr);
  instGeo.setAttribute('aNormal', normalsAttr);
  instGeo.setAttribute('aParams', paramsAttr);
  instGeo.setAttribute('aMotion', motionAttr);
  instGeo.instanceCount = TOTAL_METABALLS;

  const splatMat = createMetaballSplatMaterial(uniforms);
  const splatMesh = new THREE.Mesh(instGeo, splatMat);
  splatMesh.frustumCulled = false;
  splatMesh.name = 'water-metaball-splats';

  const fieldScene = new THREE.Scene();
  fieldScene.add(splatMesh);
  disposables.push(baseQuad, instGeo, splatMat);

  // === PASS 6b: FULLSCREEN LIQUID METABALL RESOLVE ===
  const resolveGeo = new THREE.PlaneGeometry(2, 2);
  const resolveMat = createMetaballResolveMaterial(uniforms);
  const resolveScene = new THREE.Scene();
  resolveScene.add(new THREE.Mesh(resolveGeo, resolveMat));
  disposables.push(resolveGeo, resolveMat);

  // === PASS 6c: 3D BOTTOM-RIM HANGING PENDANT DROPS + 3D MELTED SYRUP GLAZE & FLOW STREAMS ON STICK ===
  const pendantGroup = new THREE.Group();
  const stickMelt = createStickMeltOverlay(uniforms, seed);
  pendantGroup.add(stickMelt.mesh);
  const stickFlow = createStickFlowStreams(uniforms, seed);
  pendantGroup.add(stickFlow.group);
  let stickFlowPhase = 0.0;
  disposables.push(stickMelt, stickFlow);

  const pendantMat = createPendantDropMaterial(uniforms, 0.044, 0.56, true, false);
  const pendantFallMat = createPendantDropMaterial(uniforms, 0.046, 0.56, false, false);
  // Crisp jewel refraction + restrained soft studio reflection for vertical stick-edge droplets (no blown-out white D-ring!)
  const stickEdgeDropMat = createPendantDropMaterial(uniforms, 0.028, 0.58, true, true);
  // Pure unit sphere so detached fallMesh matches pinching bulb radius 1:1 with zero size jump!
  const fallGeo = new THREE.SphereGeometry(1, 24, 18);
  const stickEdgeDropGeo = createStickEdgeDropGeometry();
  disposables.push(pendantMat, pendantFallMat, stickEdgeDropMat, fallGeo, stickEdgeDropGeo);

  // 8 staggered real-3D elongated teardrops (4 left, 4 right) clinging to and sliding down the wooden stick edges!
  // All start hidden ('dormant') fresh out of the freezer, then swell & glide smoothly down BOTH wooden edges.
  interface StickEdgeDrop {
    side: -1 | 1;
    stage: 'dormant' | 'swelling' | 'sliding';
    y: number;
    radius: number;
    maxR: number;
    velY: number;
    stageTime: number;
    dormantDur: number;
    initDormantDur: number;
    spawnDropY: number;
    phase: number;
    mesh: THREE.Mesh;
  }

  const stickEdgeX = POPSICLE.stickEdgeX;
  const stickEdgeSpecs: Array<{
    side: -1 | 1;
    maxR: number;
    dormantDur: number;
    spawnDropY: number;
    phase: number;
  }> = [
    // Left stick edge (4 varied drops spaced evenly in time so they glide down cleanly separated — never bunched!)
    { side: -1, maxR: 0.024, dormantDur: 0.3, spawnDropY: 0.018, phase: 0.4 },
    { side: -1, maxR: 0.015, dormantDur: 2.0, spawnDropY: 0.052, phase: 2.1 },
    { side: -1, maxR: 0.020, dormantDur: 3.8, spawnDropY: 0.024, phase: 3.9 },
    { side: -1, maxR: 0.013, dormantDur: 5.5, spawnDropY: 0.078, phase: 5.5 },
    // Right stick edge (4 varied drops with independent staggered cadence!)
    { side: 1, maxR: 0.023, dormantDur: 1.0, spawnDropY: 0.020, phase: 1.3 },
    { side: 1, maxR: 0.014, dormantDur: 2.8, spawnDropY: 0.062, phase: 3.1 },
    { side: 1, maxR: 0.019, dormantDur: 4.6, spawnDropY: 0.026, phase: 4.8 },
    { side: 1, maxR: 0.013, dormantDur: 6.3, spawnDropY: 0.088, phase: 0.9 },
  ];

  const stickEdgeDrops: StickEdgeDrop[] = stickEdgeSpecs.map((spec, idx) => {
    const mesh = new THREE.Mesh(stickEdgeDropGeo, stickEdgeDropMat);
    mesh.visible = false;
    mesh.name = `stick-edge-drop-${idx}`;
    if (spec.side < 0) {
      mesh.rotation.y = Math.PI;
    }
    pendantGroup.add(mesh);
    return {
      side: spec.side,
      stage: 'dormant',
      y: POPSICLE.yBottom - spec.spawnDropY,
      radius: 0,
      maxR: spec.maxR,
      velY: 0,
      stageTime: 0,
      dormantDur: spec.dormantDur,
      initDormantDur: spec.dormantDur,
      spawnDropY: spec.spawnDropY,
      phase: spec.phase,
      mesh,
    };
  });

  // === PERSISTENT 2D SURFACE WETNESS & FROST-ROUGHNESS FIELD ===
  const wetnessGrid = new Float32Array(WET_U * WET_V);
  const roughGrid = new Float32Array(WET_U * WET_V);
  let hasWetness = false;
  let activeDropInstances = 0;
  const fluxPerLobe = new Float32Array(4);
  const roughSeed = seed * 17.3;

  // Bake static organic ice micro-roughness & subtle pinning potential field across (uNorm, vNorm)
  for (let iv = 0; iv < WET_V; iv++) {
    const v = iv / (WET_V - 1);
    for (let iu = 0; iu < WET_U; iu++) {
      const ang = (iu / WET_U) * Math.PI * 2;
      const sx = Math.sin(ang);
      const cz = Math.cos(ang);
      // Multi-scale pinning landscape: drops meander smoothly around frost patches & toward flute valleys!
      const n1 = fbm3(sx * 3.8 + roughSeed, v * 5.2, cz * 3.8, 3);
      const n2 = fbm3(sx * 11.0 + roughSeed * 1.7, v * 14.0, cz * 11.0, 2);
      roughGrid[iv * WET_U + iu] = n1 * 0.65 + n2 * 0.35;
    }
  }

  function sampleGrid(grid: Float32Array, uNorm: number, vNorm: number): number {
    const uW = ((uNorm % 1) + 1) % 1;
    const vC = clamp(vNorm, 0, 1);
    const fu = uW * WET_U;
    const fv = vC * (WET_V - 1);
    const iu0 = Math.floor(fu) % WET_U;
    const iu1 = (iu0 + 1) % WET_U;
    const iv0 = Math.min(WET_V - 1, Math.floor(fv));
    const iv1 = Math.min(WET_V - 1, iv0 + 1);
    const tu = fu - Math.floor(fu);
    const tv = fv - iv0;
    const a = grid[iv0 * WET_U + iu0] * (1 - tu) + grid[iv0 * WET_U + iu1] * tu;
    const b = grid[iv1 * WET_U + iu0] * (1 - tu) + grid[iv1 * WET_U + iu1] * tu;
    return a * (1 - tv) + b * tv;
  }

  function depositWetness(uNorm: number, vNorm: number, amount: number) {
    if (amount <= 0) return;
    hasWetness = true;
    const uW = ((uNorm % 1) + 1) % 1;
    const vC = clamp(vNorm, 0, 1);
    const cu = Math.floor(uW * WET_U) % WET_U;
    const cv = Math.min(WET_V - 1, Math.floor(vC * (WET_V - 1)));
    // Soft 3x3 wet channel stamp so neighboring drops feel capillary attraction into the wet track!
    for (let dv = -1; dv <= 1; dv++) {
      const iv = cv + dv;
      if (iv < 0 || iv >= WET_V) continue;
      for (let du = -1; du <= 1; du++) {
        const iu = (cu + du + WET_U) % WET_U;
        const w = du === 0 && dv === 0 ? 1.0 : du === 0 || dv === 0 ? 0.55 : 0.25;
        const idx = iv * WET_U + iu;
        wetnessGrid[idx] = Math.min(1.0, wetnessGrid[idx] + amount * w);
      }
    }
  }

  // === DETERMINISTIC SURFACE DROPLET POPULATION ===
  const rand = mulberry32(seed * 409 + 19);
  const drops: SurfaceDrop[] = [];

  for (let i = 0; i < MAX_SURFACE_DROPS; i++) {
    const isRim = i < Math.floor(MAX_SURFACE_DROPS * 0.52);
    let uNorm: number;
    let vNorm: number;
    let initRadius: number;

    if (isRim) {
      const side = i % 2 === 0 ? 0.25 : 0.75;
      const frontBias = side === 0.25 ? -0.018 : 0.018;
      uNorm = (side + frontBias + (rand() - 0.5) * 0.082 + 1) % 1;
      vNorm = 0.06 + rand() * 0.88;
      const p = rand();
      initRadius = 0.0048 + Math.pow(p, 2.2) * 0.0145;
    } else {
      const isFront = rand() < 0.88;
      uNorm = isFront ? ((rand() - 0.5) * 0.44 + 1) % 1 : 0.5 + (rand() - 0.5) * 0.36;
      vNorm = 0.07 + rand() * 0.87;
      const p = rand();
      initRadius = 0.0044 + Math.pow(p, 2.35) * 0.0125;
    }

    drops.push({
      uNorm,
      vNorm,
      initU: uNorm,
      initV: vNorm,
      radius: initRadius,
      initRadius,
      maxRadius: 0.052 + rand() * 0.014,
      growRate: 0.00045 + Math.pow(rand(), 1.55) * 0.00145,
      velV: 0,
      velU: 0,
      sliding: false,
      pinBias: 0.92 + rand() * 0.36,
      trailDistAccum: 0,
      runArcLen: 0,
      wobble: 0,
      wobblePhase: rand() * Math.PI * 2,
      isRim,
      pos: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 0, 1),
      alive: true,
      respawnDelay: 0,
    });
  }

  // === CONTINUOUS WET RIVULET TRAIL RING BUFFER ===
  const trailPool: TrailNode[] = Array.from({ length: MAX_TRAIL_NODES }, () => ({
    uNorm: 0,
    vNorm: 0,
    baseRadius: 0,
    life: 0,
    maxLife: 1,
    arcPhase: 0,
    plumpness: 0.42,
    juiceTint: 0.26,
    pos: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 0, 1),
  }));
  let trailCursor = 0;

  function emitTrailNode(
    uNorm: number,
    vNorm: number,
    radius: number,
    arcPhase: number,
    plumpness: number,
    juiceTint: number,
    lifetime: number,
  ) {
    const tn = trailPool[trailCursor];
    trailCursor = (trailCursor + 1) % MAX_TRAIL_NODES;
    tn.uNorm = uNorm;
    tn.vNorm = vNorm;
    tn.baseRadius = radius;
    tn.life = 1.0;
    tn.maxLife = lifetime;
    tn.arcPhase = arcPhase;
    tn.plumpness = plumpness;
    tn.juiceTint = juiceTint;
  }

  // 6 staggered varied underside pendant sites (3 left, 3 right)—all strictly bounded inside the live flat
  // underside (never overhanging onto the curving outer corner!) so several lively small-to-medium drops
  // glisten and break off along the underside at once. All start dry ('dormant') fresh out of the freezer!
  const pendantSpecs: Array<{
    side: -1 | 1;
    slotFrac: number;
    minSpan: number;
    lobeIndex: 0 | 1 | 2 | 3;
    anchorU: number;
    anchorV: number;
    initStage: PendantStage;
    initGrow: number;
    growRate: number;
    scale: number;
    dormantDur: number;
  }> = [
    // Left side (3 varied staggered drops — calm, unhurried when idle, brisk when warmed by pointer!)
    { side: -1, slotFrac: 0.94, minSpan: 0.00, lobeIndex: 0, anchorU: 0.855, anchorV: 0.010, initStage: 'dormant', initGrow: 0.0, growRate: 0.036, scale: 0.84, dormantDur: 2.6 },
    { side: -1, slotFrac: 0.50, minSpan: 0.15, lobeIndex: 0, anchorU: 0.895, anchorV: 0.010, initStage: 'dormant', initGrow: 0.0, growRate: 0.031, scale: 0.56, dormantDur: 5.2 },
    { side: -1, slotFrac: 0.06, minSpan: 0.07, lobeIndex: 1, anchorU: 0.935, anchorV: 0.010, initStage: 'dormant', initGrow: 0.0, growRate: 0.029, scale: 0.70, dormantDur: 7.8 },
    // Right side (3 varied staggered drops — calm, unhurried when idle, brisk when warmed by pointer!)
    { side: 1, slotFrac: 0.06, minSpan: 0.00, lobeIndex: 2, anchorU: 0.065, anchorV: 0.010, initStage: 'dormant', initGrow: 0.0, growRate: 0.034, scale: 0.82, dormantDur: 3.8 },
    { side: 1, slotFrac: 0.50, minSpan: 0.15, lobeIndex: 2, anchorU: 0.105, anchorV: 0.010, initStage: 'dormant', initGrow: 0.0, growRate: 0.030, scale: 0.54, dormantDur: 6.4 },
    { side: 1, slotFrac: 0.94, minSpan: 0.07, lobeIndex: 3, anchorU: 0.145, anchorV: 0.010, initStage: 'dormant', initGrow: 0.0, growRate: 0.028, scale: 0.68, dormantDur: 9.0 },
  ];

  const pRand = mulberry32(seed * 613 + 41);
  const pendants: PendantDrop[] = pendantSpecs.map((spec, idx) => {
    const jitterU = seed === 1 ? 0 : (pRand() - 0.5) * 0.012;
    const initStage: PendantStage = spec.initStage;
    const initGrow = spec.initGrow;
    const neckGeo = createPendantLatheGeometry();
    const neckMesh = new THREE.Mesh(neckGeo, pendantMat);
    neckMesh.name = `pendant-neck-${idx}`;
    pendantGroup.add(neckMesh);

    const fallMesh = new THREE.Mesh(fallGeo, pendantFallMat);
    fallMesh.visible = false;
    fallMesh.name = `pendant-fall-${idx}`;
    pendantGroup.add(fallMesh);

    disposables.push(neckGeo);
    const startU = (spec.anchorU + jitterU + 1) % 1;

    return {
      side: spec.side,
      slotFrac: spec.slotFrac,
      minSpan: spec.minSpan,
      lobeIndex: spec.lobeIndex,
      anchorU: startU,
      initAnchorU: startU,
      anchorV: spec.anchorV,
      stage: initStage,
      initStage,
      grow: initGrow,
      initGrow,
      stageTime: 0,
      dormantDuration: spec.dormantDur,
      pinchDuration: 0.85,
      recoilDuration: 0.42,
      growRate: spec.growRate,
      scale: spec.scale,
      neckGeo,
      neckMesh,
      fallMesh,
      fallActive: false,
      fallTime: 0,
      fallPos: new THREE.Vector3(),
      fallVelY: 0,
      fallR: 0.036 * spec.scale,
      recoilStartY: -0.07 * spec.scale,
      slotFits: true,
      minSafeAbsX: POPSICLE.stickEdgeX + 0.074,
      maxSafeAbsX: 0.5,
    };
  });

  // === LUSH BOTTOM-RIM CRYSTAL PEARLS (SINGLE INSTANCED DRAW CALL, ZERO EXTRA GPU COST!) ===
  // Clinging micro-to-plump Young-Laplace crystal dew pearls studding the entire flat underside rim
  // left & right of the wooden stick, softly breathing & absorbing cleanly whenever a big drop swells over them.
  interface BottomRimPearl {
    side: -1 | 1;
    slotFrac: number;
    zFrac: number;
    baseScale: number;
    elong: number;
    minSpan: number;
    appearAt: number;
    freq: number;
    phase: number;
  }

  // Bake at grow = 0.72 so even small-scale pearls have a lush, crisp, unmistakably round crystal silhouette below the rim!
  const bottomPearlGeo = createPendantLatheGeometry();
  updatePendantLatheGeometry(bottomPearlGeo, 'growing', 0.72, 0, 1.0, 0);
  disposables.push(bottomPearlGeo);

  const bottomRimPearls: BottomRimPearl[] = [];
  {
    const bRand = mulberry32(seed * 919 + 173);
    const perSideMax = Math.floor(MAX_BOTTOM_DROPS / 2);
    const PHI_INV = 0.6180339887498949;
    const perSideLists: BottomRimPearl[][] = [[], []];

    for (let sIdx = 0; sIdx < 2; sIdx++) {
      const side: -1 | 1 = sIdx === 0 ? -1 : 1;
      const sideOffset = bRand();
      const placed: Array<{ s: number; z: number; r: number }> = [];

      // Golden-ratio quasi-random placement so ANY prefix count (0..80) spreads evenly across BOTH sides
      // with zero bunching and rock-steady positions as the user drags the Bot Drops debug slider!
      for (let rank = 0; rank < perSideMax; rank++) {
        const isMainRow = rank < 16 || rank % 3 !== 2;
        const baseSlot = 0.03 + (((rank + 0.5) * PHI_INV + sideOffset) % 1) * 0.94;
        const pSize = bRand();
        const highDensityTaper = smoothstep(14, perSideMax - 1, rank);
        const baseScale = isMainRow
          ? (0.28 + Math.pow(pSize, 1.42) * 0.56) * (1.0 - highDensityTaper * 0.34)
          : (0.24 + Math.pow(pSize, 1.55) * 0.34) * (1.0 - highDensityTaper * 0.25);

        let chosenS = clamp(baseSlot + (bRand() - 0.5) * (isMainRow ? 0.045 : 0.10), 0.02, 0.98);
        let chosenZ = isMainRow
          ? (bRand() - 0.45) * 0.38
          : rank % 2 === 0
            ? 0.34 + bRand() * 0.22
            : -0.46 + bRand() * 0.22;

        const minScaleClear = 0.024 * (1.0 - highDensityTaper * 0.45);
        for (let attempt = 0; attempt < 12; attempt++) {
          let overlap = false;
          for (let j = 0; j < placed.length; j++) {
            const o = placed[j];
            const ds = (chosenS - o.s) * 0.34;
            const dz = (chosenZ - o.z) * 0.08;
            const minD = (baseScale + o.r) * minScaleClear + 0.005;
            if (ds * ds + dz * dz < minD * minD) {
              overlap = true;
              break;
            }
          }
          if (!overlap) break;
          chosenS = clamp(baseSlot + (bRand() - 0.5) * 0.11, 0.02, 0.98);
          chosenZ = isMainRow
            ? (bRand() - 0.45) * 0.46
            : rank % 2 === 0
              ? 0.30 + bRand() * 0.26
              : -0.50 + bRand() * 0.26;
        }
        placed.push({ s: chosenS, z: chosenZ, r: baseScale });
        // Stagger minSpan thresholds so as the popsicle narrows in late melt, pearls thin out organically instead of bunching!
        const tier = rank % 4;
        const minSpan = tier === 0 ? 0.00 : tier === 1 ? 0.06 : tier === 2 ? 0.14 : 0.22;
        perSideLists[sIdx].push({
          side,
          slotFrac: chosenS,
          zFrac: chosenZ,
          baseScale,
          elong: 0.84 + Math.min(1, baseScale) * 0.24 + (bRand() - 0.5) * 0.08,
          minSpan,
          appearAt: 0.02 + bRand() * 0.42,
          freq: 0.45 + bRand() * 0.65,
          phase: bRand() * Math.PI * 2,
        });
      }
    }

    // Interleave left & right strictly [L0, R0, L1, R1, ...] so any Bot Drops count stays balanced on both sides!
    for (let rank = 0; rank < perSideMax; rank++) {
      bottomRimPearls.push(perSideLists[0][rank], perSideLists[1][rank]);
    }
  }

  const bottomPearlsMesh = new THREE.InstancedMesh(bottomPearlGeo, pendantMat, bottomRimPearls.length);
  bottomPearlsMesh.name = 'bottom-rim-pearls';
  bottomPearlsMesh.frustumCulled = false;
  bottomPearlsMesh.count = 0;
  bottomPearlsMesh.visible = false;
  pendantGroup.add(bottomPearlsMesh);
  disposables.push(bottomPearlsMesh);

  // === BOTTOM-STICK OVERFLOW FILAMENT & LATE-MELT FINAL PINCH-OFF DROPS ===
  const stickTipFilament = createStickTipFilamentSystem(seed, {
    uSceneTex: uniforms.uSceneTex,
    uResolution: uniforms.uResolution,
    uTime: uniforms.uTime,
    uDropSigma: uniforms.uDropSigma,
    uDropCreamColor: uniforms.uDropCreamColor,
    uDropOpacity: uniforms.uDropOpacity,
    uShadowTint: uniforms.uShadowTint,
    uStainColor: uniforms.uStainColor,
  });
  pendantGroup.add(stickTipFilament.mesh);
  disposables.push(stickTipFilament);

  // Final slow lingering drops emitted from the rounded stick bottom tip after the continuous filament pinches off!
  const tipDropNeckGeo = createPendantLatheGeometry();
  updatePendantLatheGeometry(tipDropNeckGeo, 'growing', 0.5, 0, 1.0, 0);
  const tipDropNeckMesh = new THREE.Mesh(tipDropNeckGeo, pendantMat);
  tipDropNeckMesh.name = 'stick-tip-final-neck';
  tipDropNeckMesh.frustumCulled = false;
  tipDropNeckMesh.visible = false;
  pendantGroup.add(tipDropNeckMesh);
  disposables.push(tipDropNeckGeo);

  const tipDropFallPool = Array.from({ length: 4 }, (_, idx) => {
    const m = new THREE.Mesh(fallGeo, pendantFallMat);
    m.name = `stick-tip-final-drop-${idx}`;
    m.frustumCulled = false;
    m.visible = false;
    pendantGroup.add(m);
    return {
      mesh: m,
      active: false,
      y: POPSICLE.stickBottomY as number,
      velY: 0,
      radius: 0.025,
      time: 0,
    };
  });

  let tipFilamentPhase = 0;
  let tipFilamentReach = 0;
  let tipFilamentTailDrop = 0;
  let tipDropStage: 'idle' | 'growing' | 'pinching' | 'recoiling' | 'done' = 'idle';
  let tipDropGrow = 0;
  let tipDropStageTime = 0;
  let tipDropsEmitted = 0;
  const TIP_FINAL_DROPS_MAX = 4;
  let prevTipMelt = 0;

  /**
   * Gently swells the nearest bottom-rim downward morph lobe when a sliding surface droplet
   * wraps under the lower bevel and drains into the accumulated pooling curve!
   */
  function feedBottomLobe(state: MeltFieldState, worldX: number, volumeBoost: number) {
    if (!state.bottomLobes) return;
    let lobeIdx: number;
    if (worldX < -0.26) lobeIdx = 0;
    else if (worldX < 0) lobeIdx = 1;
    else if (worldX < 0.26) lobeIdx = 2;
    else lobeIdx = 3;
    state.bottomLobes[lobeIdx] = Math.min(1.55, state.bottomLobes[lobeIdx] + volumeBoost * 1.4);
  }

  const scanPos = new THREE.Vector3();
  const scanNorm = new THREE.Vector3();
  const BOTTOM_SCAN_STEPS = 44;
  const BOTTOM_SCAN_N = BOTTOM_SCAN_STEPS + 1;

  interface SideBottomScan {
    u: Float32Array;
    x0: Float32Array;
    y0: Float32Array;
    z0: Float32Array;
    ny0: Float32Array;
    x1: Float32Array;
    y1: Float32Array;
    z1: Float32Array;
    ny1: Float32Array;
    lowestY: number;
    flatEdgeAbsX: number;
    innerPouchY: number;
    maxRimAbsX: number;
    hasSmooth: boolean;
  }

  function makeSideScan(): SideBottomScan {
    return {
      u: new Float32Array(BOTTOM_SCAN_N),
      x0: new Float32Array(BOTTOM_SCAN_N),
      y0: new Float32Array(BOTTOM_SCAN_N),
      z0: new Float32Array(BOTTOM_SCAN_N),
      ny0: new Float32Array(BOTTOM_SCAN_N),
      x1: new Float32Array(BOTTOM_SCAN_N),
      y1: new Float32Array(BOTTOM_SCAN_N),
      z1: new Float32Array(BOTTOM_SCAN_N),
      ny1: new Float32Array(BOTTOM_SCAN_N),
      lowestY: Infinity,
      flatEdgeAbsX: 0,
      innerPouchY: Infinity,
      maxRimAbsX: 0,
      hasSmooth: false,
    };
  }

  const leftBottomScan = makeSideScan();
  const rightBottomScan = makeSideScan();

  /**
   * Samples a side's bottom flat-underside profile ONCE per side per frame, computing exact sub-pixel
   * linear crossings for `flatEdgeAbsX` and `maxRimAbsX` so bottom pearls & pendants glide smoothly
   * inward with zero discrete bin jumps even during fast melt!
   */
  function scanSideBottom(ice: PopsicleIceSystem, side: -1 | 1, stickClearX: number, out: SideBottomScan, dt = 0) {
    const uStick = side < 0 ? 0.985 : 0.015;
    const uOuter = side < 0 ? 0.752 : 0.248;
    let lowestY = Infinity;
    let innerPouchY = Infinity;
    let rawMaxRimAbsX = 0;

    let prevRimMargin = -1;
    let prevRimAx = 0;
    for (let k = 0; k <= BOTTOM_SCAN_STEPS; k++) {
      const u = uStick + (uOuter - uStick) * (k / BOTTOM_SCAN_STEPS);
      out.u[k] = u;

      ice.sampleLiveSurface(u, 0.008, scanPos, scanNorm);
      out.x0[k] = scanPos.x;
      out.y0[k] = scanPos.y;
      out.z0[k] = scanPos.z;
      out.ny0[k] = scanNorm.y;

      const ax = Math.abs(scanPos.x);
      const rimMargin = -0.50 - scanNorm.y;
      if (rimMargin >= 0) {
        if (ax > rawMaxRimAbsX) rawMaxRimAbsX = ax;
      } else if (k > 0 && prevRimMargin >= 0) {
        const denom = prevRimMargin - rimMargin;
        const t = denom > 1e-6 ? clamp(prevRimMargin / denom, 0, 1) : 0;
        const crossAx = prevRimAx + (ax - prevRimAx) * t;
        if (crossAx > rawMaxRimAbsX) rawMaxRimAbsX = crossAx;
      }
      prevRimMargin = rimMargin;
      prevRimAx = ax;

      if (ax >= POPSICLE.stickEdgeX + 0.012 && ax <= POPSICLE.stickEdgeX + 0.072 && scanNorm.y <= -0.45) {
        if (scanPos.y < innerPouchY) innerPouchY = scanPos.y;
      }
      if (ax >= stickClearX && scanNorm.y <= -0.72 && scanPos.y < lowestY) {
        lowestY = scanPos.y;
      }

      ice.sampleLiveSurface(u, 0.018, scanPos, scanNorm);
      out.x1[k] = scanPos.x;
      out.y1[k] = scanPos.y;
      out.z1[k] = scanPos.z;
      out.ny1[k] = scanNorm.y;
    }

    // Continuous sub-pixel linear crossing of both normal-flatness & height-flatness margins
    let rawFlatEdgeAbsX = stickClearX;
    let prevFlatMargin = -1;
    let prevFlatAx = stickClearX;
    for (let k = 0; k <= BOTTOM_SCAN_STEPS; k++) {
      const ax = Math.abs(out.x0[k]);
      const flatMargin = Math.min(-0.74 - out.ny0[k], lowestY + 0.014 - out.y0[k]);
      if (ax >= stickClearX) {
        if (flatMargin >= 0) {
          if (ax > rawFlatEdgeAbsX) rawFlatEdgeAbsX = ax;
        } else if (k > 0 && prevFlatMargin >= 0) {
          const denom = prevFlatMargin - flatMargin;
          const t = denom > 1e-6 ? clamp(prevFlatMargin / denom, 0, 1) : 0;
          const crossAx = prevFlatAx + (ax - prevFlatAx) * t;
          if (crossAx > rawFlatEdgeAbsX) rawFlatEdgeAbsX = crossAx;
        }
      }
      prevFlatMargin = flatMargin;
      prevFlatAx = ax;
    }

    out.lowestY = lowestY;
    out.innerPouchY = innerPouchY;
    if (dt > 0 && out.hasSmooth) {
      const alpha = 1.0 - Math.exp(-dt * 16.0);
      out.flatEdgeAbsX += (rawFlatEdgeAbsX - out.flatEdgeAbsX) * alpha;
      out.maxRimAbsX += (rawMaxRimAbsX - out.maxRimAbsX) * alpha;
    } else {
      out.flatEdgeAbsX = rawFlatEdgeAbsX;
      out.maxRimAbsX = rawMaxRimAbsX;
      out.hasSmooth = true;
    }
  }

  /** Continuous linear interpolation along the cached bottom rim scan (zero discrete bin snapping!). */
  function sampleScanAtAbsX(
    scan: SideBottomScan,
    absX: number,
  ): { found: boolean; u: number; y: number; ny: number } {
    for (let k = 0; k < BOTTOM_SCAN_STEPS; k++) {
      const ax0 = Math.abs(scan.x0[k]);
      const ax1 = Math.abs(scan.x0[k + 1]);
      const lo = ax0 <= ax1 ? ax0 : ax1;
      const hi = ax0 <= ax1 ? ax1 : ax0;
      if (absX >= lo && absX <= hi && (scan.ny0[k] <= -0.60 || scan.ny0[k + 1] <= -0.60)) {
        const span = ax1 - ax0;
        const t = Math.abs(span) > 1e-6 ? clamp((absX - ax0) / span, 0, 1) : 0;
        return {
          found: true,
          u: scan.u[k] + (scan.u[k + 1] - scan.u[k]) * t,
          y: scan.y0[k] + (scan.y0[k + 1] - scan.y0[k]) * t,
          ny: scan.ny0[k] + (scan.ny0[k + 1] - scan.ny0[k]) * t,
        };
      }
    }
    let bestK = -1;
    let bestDist = Infinity;
    for (let k = 0; k <= BOTTOM_SCAN_STEPS; k++) {
      if (scan.ny0[k] > -0.66) continue;
      const d = Math.abs(Math.abs(scan.x0[k]) - absX);
      if (d < bestDist) {
        bestDist = d;
        bestK = k;
      }
    }
    if (bestK < 0 || bestDist > 0.05) {
      return { found: false, u: 0, y: 0, ny: 0 };
    }
    return { found: true, u: scan.u[bestK], y: scan.y0[bestK], ny: scan.ny0[bestK] };
  }

  /**
   * Resolves the exact continuous sub-pixel flat-underside anchor for a pendant drop from its side's cached scan,
   * strictly inset from BOTH the wooden stick AND the upward-curving rounded bottom corner.
   */
  function resolvePendantSlotFromScan(
    scan: SideBottomScan,
    side: -1 | 1,
    slotFrac: number,
    dropScale: number,
    stickClearX: number,
  ): { found: boolean; u: number; v: number; minSafeAbsX: number; maxSafeAbsX: number; availSpan: number } {
    const uMid = side < 0 ? 0.8685 : 0.1315;
    const refCollarHalfW = 0.036 * Math.max(0.76, dropScale) * 1.92;
    const minSafeAbsX = stickClearX + 0.022;
    const maxSafeAbsX = scan.flatEdgeAbsX - refCollarHalfW * 1.05 - 0.014;
    const availSpan = maxSafeAbsX - minSafeAbsX;

    if (availSpan < -0.018) {
      return { found: false, u: uMid, v: 0.008, minSafeAbsX, maxSafeAbsX, availSpan };
    }

    const clampMaxX = Math.max(minSafeAbsX, maxSafeAbsX);
    const targetAbsX = clamp(
      availSpan <= 0 ? (minSafeAbsX + maxSafeAbsX) * 0.5 : minSafeAbsX + availSpan * slotFrac,
      minSafeAbsX,
      clampMaxX,
    );
    const samp = sampleScanAtAbsX(scan, targetAbsX);
    if (!samp.found) {
      return { found: false, u: uMid, v: 0.008, minSafeAbsX, maxSafeAbsX, availSpan };
    }

    return { found: true, u: samp.u, v: 0.008, minSafeAbsX, maxSafeAbsX, availSpan };
  }

  function feedPendantFromDrop(uNorm: number, volumeBoost: number) {
    const dripMul = debugParams.dripRate;
    if (dripMul <= 0.001) return;
    let bestP = pendants[0];
    let bestDu = 999;
    for (let k = 0; k < pendants.length; k++) {
      const du = Math.abs(wrappedDeltaU(uNorm, pendants[k].anchorU));
      if (du < bestDu) {
        bestDu = du;
        bestP = pendants[k];
      }
    }
    if (!bestP) return;
    const effBoost = volumeBoost * dripMul;
    if (bestP.stage === 'growing') {
      bestP.grow = Math.min(1.0, bestP.grow + effBoost);
    } else if (bestP.stage === 'dormant') {
      bestP.stageTime += effBoost * 14.0;
      if (bestP.stageTime >= bestP.dormantDuration) {
        bestP.stage = 'growing';
        bestP.grow = 0;
        bestP.stageTime = 0;
      }
    }
  }

  function wrappedDeltaU(fromU: number, toU: number): number {
    let du = toU - fromU;
    if (du > 0.5) du -= 1.0;
    if (du < -0.5) du += 1.0;
    return du;
  }

  /**
   * Volume-conserving pairwise droplet coalescence + momentum transfer!
   * When a surging liquid drop hits a pinned bead in its path (or two swelling drops touch):
   * - Their volumes fuse (`r = cbrt(r1^3 + r2^3)`), giving a burst of downward surge & capillary wobble;
   * - Even a stationary pinned bead struck from above immediately unpins and surges downward!
   */
  function runCoalescence(ice: PopsicleIceSystem, dt: number, initialRelax: boolean) {
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (!d.alive) continue;
      ice.sampleLiveSurface(d.uNorm, d.vNorm, d.pos, d.normal);
    }

    const mergeRatio = initialRelax ? 0.80 : 0.82;
    const attractRatio = 1.45;

    for (let i = 0; i < drops.length; i++) {
      const a = drops[i];
      if (!a.alive) continue;

      for (let j = i + 1; j < drops.length; j++) {
        const b = drops[j];
        if (!b.alive) continue;

        const rSum = a.radius + b.radius;
        const maxRange = rSum * attractRatio;

        const dx = b.pos.x - a.pos.x;
        if (Math.abs(dx) > maxRange) continue;
        const dy = b.pos.y - a.pos.y;
        if (Math.abs(dy) > maxRange) continue;
        const dz = b.pos.z - a.pos.z;
        if (Math.abs(dz) > maxRange) continue;

        const distSq = dx * dx + dy * dy + dz * dz;
        const mergeDist = rSum * mergeRatio;

        if (distSq < mergeDist * mergeDist) {
          const big = a.radius >= b.radius ? a : b;
          const small = a.radius >= b.radius ? b : a;

          const vBig = big.radius * big.radius * big.radius;
          const vSmall = small.radius * small.radius * small.radius;
          const vTotal = vBig + vSmall;
          const massRatio = vSmall / vTotal;

          const du = wrappedDeltaU(big.uNorm, small.uNorm);
          big.uNorm = (big.uNorm + du * massRatio * 0.68 + 1) % 1;
          big.vNorm = clamp(big.vNorm + (small.vNorm - big.vNorm) * massRatio * 0.68, 0.024, 0.95);
          big.radius = Math.min(big.maxRadius, Math.cbrt(vTotal));

          if (!initialRelax) {
            if (a.sliding || b.sliding) {
              // Fast-racing heavy drop gobbles a pinned pearl and surges even faster!
              big.velV = Math.max(big.velV, small.velV) + (0.06 + massRatio * 0.14);
              big.velU = clamp(big.velU * (1 - massRatio) + small.velU * massRatio + du * 0.08, -0.025, 0.025);
              big.sliding = true;
            } else if (big.radius >= 0.034 * big.pinBias) {
              // Two swollen pearls just merged past critical heavy break-free mass -> launch quickly!
              big.sliding = true;
              big.velV = 0.12 + massRatio * 0.08;
              big.velU = 0;
            }
            big.wobble = Math.min(1.0, big.wobble + 0.55 + massRatio * 0.65);
            depositWetness(big.uNorm, big.vNorm, 0.45);
          }

          ice.sampleLiveSurface(big.uNorm, big.vNorm, big.pos, big.normal);

          small.alive = false;
          small.radius = 0;
          small.velV = 0;
          small.velU = 0;
          small.sliding = false;
          small.respawnDelay = initialRelax ? 1.8 + ((j * 0.37) % 5.0) : 2.5 + ((j * 0.53) % 6.5);

          if (big === b) break;
        } else if (!initialRelax && dt > 0 && distSq < maxRange * maxRange) {
          // Gentle capillary pull into neighboring pinned bead right as they pass -> smoothly bends into it!
          const dist = Math.sqrt(distSq) || 1e-4;
          const prox = smoothstep(maxRange, mergeDist, dist);
          if (a.sliding && !b.sliding && b.vNorm < a.vNorm + 0.02) {
            const duToB = wrappedDeltaU(a.uNorm, b.uNorm);
            a.velU += clamp(duToB, -0.03, 0.03) * prox * dt * 1.4;
          } else if (b.sliding && !a.sliding && a.vNorm < b.vNorm + 0.02) {
            const duToA = wrappedDeltaU(b.uNorm, a.uNorm);
            b.velU += clamp(duToA, -0.03, 0.03) * prox * dt * 1.4;
          } else {
            const big = a.radius >= b.radius ? a : b;
            const small = a.radius >= b.radius ? b : a;
            const du = wrappedDeltaU(small.uNorm, big.uNorm);
            small.uNorm = (small.uNorm + du * prox * dt * 0.42 + 1) % 1;
            small.vNorm = clamp(small.vNorm + (big.vNorm - small.vNorm) * prox * dt * 0.42, 0.025, 0.95);
          }
        }
      }
    }
  }

  let hasInitialized = false;
  let respawnRand = mulberry32(seed * 911 + 73);
  const tmpPos = new THREE.Vector3();
  const tmpNorm = new THREE.Vector3();

  function reset() {
    wetnessGrid.fill(0);
    hasWetness = false;
    activeDropInstances = 0;
    lastLowScanMelt = -999;
    leftBottomScan.hasSmooth = false;
    rightBottomScan.hasSmooth = false;
    respawnRand = mulberry32(seed * 911 + 73);

    for (const d of drops) {
      d.uNorm = d.initU;
      d.vNorm = d.initV;
      d.radius = d.initRadius;
      d.velV = 0;
      d.velU = 0;
      d.sliding = false;
      d.trailDistAccum = 0;
      d.runArcLen = 0;
      d.wobble = 0;
      d.alive = true;
      d.respawnDelay = 0;
    }
    for (const tn of trailPool) {
      tn.life = 0;
      tn.baseRadius = 0;
    }
    for (const p of pendants) {
      p.anchorU = p.initAnchorU;
      p.stage = p.initStage;
      p.grow = p.initGrow;
      p.stageTime = 0;
      p.fallActive = false;
      p.fallTime = 0;
      p.fallVelY = 0;
      p.fallMesh.visible = false;
      p.neckMesh.visible = false;
      p.slotFits = true;
    }
    for (const sd of stickEdgeDrops) {
      sd.stage = 'dormant';
      sd.y = POPSICLE.yBottom - sd.spawnDropY;
      sd.radius = 0;
      sd.velY = 0;
      sd.stageTime = 0;
      sd.dormantDur = sd.initDormantDur;
      sd.mesh.visible = false;
    }
    resetMinimalDrops();
    clearFrostDrops();
    instGeo.instanceCount = 0;
    resolveMat.uniforms.uHasDropField.value = 0.0;
    stickMelt.uniforms.uIceBottomY.value = POPSICLE.yBottom;
    stickMelt.uniforms.uIceTopY.value = POPSICLE.yTop;
    stickMelt.uniforms.uIceAmount.value = 1.0;
    stickMelt.uniforms.uStickWetness.value = 0.0;
    stickMelt.uniforms.uMelt.value = 0.0;
    stickMelt.mesh.visible = false;
    stickFlow.uniforms.uIceBottomY.value = POPSICLE.yBottom;
    stickFlow.uniforms.uIceAmount.value = 1.0;
    stickFlow.uniforms.uLeftFunnelY.value = POPSICLE.yBottom;
    stickFlow.uniforms.uRightFunnelY.value = POPSICLE.yBottom;
    stickFlow.uniforms.uLeftFunnelW.value = 0.0;
    stickFlow.uniforms.uRightFunnelW.value = 0.0;
    stickFlow.uniforms.uMelt.value = 0.0;
    stickFlowPhase = 0.0;
    stickFlow.uniforms.uFlowRate.value = 0.0;
    stickFlow.group.visible = false;
    stickTipFilament.mesh.visible = false;
    stickTipFilament.uniforms.uFlowPhase.value = 0;
    stickTipFilament.uniforms.uReach.value = 0;
    stickTipFilament.uniforms.uThickness.value = 0;
    stickTipFilament.uniforms.uTailDrop.value = 0;
    stickTipFilament.uniforms.uCollarAmt.value = 0;
    tipFilamentPhase = 0;
    tipFilamentReach = 0;
    tipFilamentTailDrop = 0;
    tipDropStage = 'idle';
    tipDropGrow = 0;
    tipDropStageTime = 0;
    tipDropsEmitted = 0;
    prevTipMelt = 0;
    tipDropNeckMesh.visible = false;
    for (const fd of tipDropFallPool) {
      fd.active = false;
      fd.mesh.visible = false;
    }
    bottomPearlsMesh.count = 0;
    bottomPearlsMesh.visible = false;
    hasInitialized = false;
  }

  function stepLiquidPhysics(
    state: MeltFieldState,
    ice: PopsicleIceSystem,
    film: LiquidFilmSystem,
    dt: number,
    meltSpeedMul: number,
  ) {
    const meltRate = (1.0 + state.melt * 2.1) * meltSpeedMul;
    const condensationOnset = smoothstep(0.044, 0.16, state.melt);
    if (condensationOnset <= 0.005) return;

    // 1. Gently evaporate/level surface wetness memory over ~12 seconds (skip loop completely when dry!)
    if (hasWetness) {
      const wetDecay = Math.exp(-dt * 0.085);
      let anyWet = false;
      for (let k = 0; k < wetnessGrid.length; k++) {
        if (wetnessGrid[k] > 0.001) {
          wetnessGrid[k] *= wetDecay;
          anyWet = true;
        } else {
          wetnessGrid[k] = 0;
        }
      }
      hasWetness = anyWet;
    }

    // 2. Surface beads cling naturally to cold ice, swell & coalesce slowly, and DISSOLVE into creeping
    //    viscous glaze lobes (`filmH`) instead of racing independently down straight lines!
    const epsU = 1.0 / WET_U;

    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];

      if (!d.alive) {
        d.respawnDelay -= dt * meltRate;
        // As ice turns into thoroughly melted wet slush (melt > 0.45), fewer fresh cold-condensation beads nucleate!
        if (d.respawnDelay <= 0 && state.melt < 0.58) {
          if (d.isRim) {
            const side = i % 2 === 0 ? 0.25 : 0.75;
            const frontBias = side === 0.25 ? -0.018 : 0.018;
            d.uNorm = (side + frontBias + (respawnRand() - 0.5) * 0.08 + 1) % 1;
          } else {
            d.uNorm = ((respawnRand() - 0.5) * 0.44 + 1) % 1;
          }
          d.vNorm = 0.20 + respawnRand() * 0.74;
          // Nucleate cleanly from invisible micro-dew (0.0014) so fresh condensation NEVER pops in!
          d.radius = 0.0014;
          d.velV = 0;
          d.velU = 0;
          d.sliding = false;
          d.trailDistAccum = 0;
          d.runArcLen = 0;
          d.wobble = 0;
          d.alive = true;
        }
        continue;
      }

      ice.sampleLiveSurface(d.uNorm, d.vNorm, d.pos, d.normal);

      const localHeat = sampleLocalHeat(d.pos.x, d.pos.y, state);
      const liveDist = Math.hypot(d.pos.x - state.pointerX, d.pos.y - state.pointerY);
      const liveHeat = state.pointerHeat * Math.exp(-(liveDist * liveDist) / 0.14);
      const heatBoost = 1.0 + localHeat * 3.5 + liveHeat * 6.5;

      // Sample continuous 2D viscous glaze film thickness right under this bead!
      const filmH = film.sampleThickness(d.uNorm, d.vNorm);

      // When a thick creeping glossy melt-glaze sheet (filmH > 0.34) sweeps over a cold bead,
      // the bead merges/dissolves smoothly into the flowing liquid glaze sheet (like process/melt!)
      if (filmH > 0.36 && !d.isRim) {
        const absorbRate = smoothstep(0.36, 0.72, filmH) * dt * 0.55;
        const shed = Math.min(d.radius, absorbRate * 0.032);
        d.radius -= shed;
        film.deposit(d.uNorm, d.vNorm, shed * 4.2, 1);
        // Gently drift downward with the slow viscous glaze wave as it dissolves
        d.vNorm = Math.max(0.028, d.vNorm - smoothstep(0.32, 0.85, filmH) * 0.022 * dt);
        if (d.radius < 0.0038) {
          d.alive = false;
          d.radius = 0;
          d.sliding = false;
          d.respawnDelay = 4.5 + respawnRand() * 6.0;
          continue;
        }
      }

      const wetHere = Math.max(sampleGrid(wetnessGrid, d.uNorm, d.vNorm), smoothstep(0.18, 0.55, filmH));
      const wetBelow = sampleGrid(wetnessGrid, d.uNorm, Math.max(0.02, d.vNorm - 0.025));
      const wetEff = Math.max(wetHere, wetBelow * 0.85);

      const wetL = sampleGrid(wetnessGrid, d.uNorm - epsU * 1.8, Math.max(0.02, d.vNorm - 0.015));
      const wetR = sampleGrid(wetnessGrid, d.uNorm + epsU * 1.8, Math.max(0.02, d.vNorm - 0.015));
      const gradWetU = wetR - wetL;

      const roughHere = sampleGrid(roughGrid, d.uNorm, d.vNorm);
      const roughL = sampleGrid(roughGrid, d.uNorm - epsU * 1.5, d.vNorm);
      const roughR = sampleGrid(roughGrid, d.uNorm + epsU * 1.5, d.vNorm);
      const gradRoughU = roughR - roughL;

      // Slow condensation swelling on thawed surfaces (stay calmly pinned until genuinely big & heavy!)
      const localThaw = 1.0 - smoothstep(0.24, 0.68, film.sampleRime(d.uNorm, d.vNorm));
      d.radius = Math.min(d.maxRadius, d.radius + d.growRate * 0.72 * dt * meltRate * heatBoost * condensationOnset * localThaw);

      // === CRITICAL-MASS PINNING -> FAST GRAVITY RUN ===
      // Pearl-drops stay completely pinned until they swell/coalesce into REALLY big heavy drops,
      // then break surface tension and race quickly down the popsicle face!
      const roughPin = 0.88 + roughHere * 0.34;
      const wetLubrication = 1.0 - wetEff * 0.35;
      const heatLubrication = 1.0 / (1.0 + liveHeat * 0.50 + localHeat * 0.25);

      const breakFreeRadius = 0.036 * d.pinBias * roughPin * wetLubrication * heatLubrication;

      if (!d.sliding) {
        if (d.radius >= breakFreeRadius && localThaw > 0.25) {
          d.sliding = true;
          d.velV = 0.12 + (d.radius - breakFreeRadius) * 5.0;
          d.velU = 0;
          d.runArcLen = 0;
          d.trailDistAccum = 0;
        }
      } else {
        // Once critical mass breaks surface tension -> accelerate briskly under gravity and zip down!
        const massDrive = 1.65 + Math.max(0, d.radius - 0.024) * 75.0 * (1.0 + wetEff * 0.8) * (1.0 + liveHeat * 0.9);
        const slideDrag = 1.9 + roughHere * 0.65 * (1.0 - wetEff * 0.55);
        d.velV += (massDrive - d.velV * slideDrag) * dt;
        d.velV = clamp(d.velV, 0.11, 0.74 * (1.0 + liveHeat * 0.55));

        const channelPull = gradWetU * (0.035 + d.velV * 0.55);
        const roughDeflect = -gradRoughU * (0.015 + d.velV * 0.24);

        let flutePull = 0;
        const uSigned = d.uNorm > 0.5 ? d.uNorm - 1.0 : d.uNorm;
        if (Math.abs(uSigned) < 0.16) {
          const nearRightFlute = uSigned > 0 ? 0.044 : -0.044;
          const distFlute = nearRightFlute - uSigned;
          if (Math.abs(distFlute) < 0.032) {
            flutePull = distFlute * 0.12;
          }
        }

        d.velU += (channelPull + roughDeflect + flutePull - d.velU * 6.5) * dt;
        const maxLatVel = Math.min(0.020, d.velV * 0.24);
        d.velU = clamp(d.velU, -maxLatVel, maxLatVel);

        const prevU = d.uNorm;
        const prevV = d.vNorm;
        // As the surface curves underneath the bottom lip (normal.y -> -1), tangential gravity drops toward zero
        // and d(x)/d(v) grows steep: smoothly brake v-speed so drops NEVER shoot horizontally inward toward center!
        const underSlopeBrake = 0.14 + 0.86 * smoothstep(-0.72, -0.15, d.normal.y);
        const stepV = d.velV * dt * underSlopeBrake;
        const stepU = d.velU * dt * underSlopeBrake;

        d.vNorm -= stepV;
        d.uNorm = (d.uNorm + stepU + 1) % 1;

        // Couple sliding drop directly into BOTH wetness memory AND the 2D viscous glaze PDE!
        depositWetness(d.uNorm, d.vNorm, clamp(stepV * 14.0, 0.06, 0.45));
        film.deposit(d.uNorm, d.vNorm, clamp(stepV * 2.2, 0.008, 0.08), 1);

        const ds = Math.hypot(stepU * 3.2, stepV * 2.1);
        d.trailDistAccum += ds;
        d.runArcLen += ds;

        const trailR = clamp(d.radius * (0.30 + clamp(d.velV * 1.1, 0, 0.10)), 0.005, 0.0125);
        const emitSpacing = trailR * 0.48;

        if (d.trailDistAccum >= emitSpacing) {
          const count = Math.min(5, Math.floor(d.trailDistAccum / emitSpacing));
          for (let k = 1; k <= count; k++) {
            const frac = k / count;
            const tu = (prevU + wrappedDeltaU(prevU, d.uNorm) * frac + 1) % 1;
            const tv = prevV + (d.vNorm - prevV) * frac;
            emitTrailNode(
              tu,
              tv + d.radius * 0.34,
              trailR,
              d.runArcLen * 28.0 + k * 0.50,
              0.38,
              d.isRim ? 0.32 : 0.26,
              9.5 + (i % 7) * 0.85,
            );
          }
          d.trailDistAccum -= count * emitSpacing;

          const dryLossFactor = 1.0 - wetEff * 0.72;
          const volLoss = count * trailR * trailR * trailR * 0.045 * dryLossFactor;
          d.radius = Math.max(0.024, Math.cbrt(Math.max(1e-8, d.radius ** 3 - volLoss)));
        }
      }

      if (d.wobble > 0.001) {
        d.wobble *= Math.exp(-dt * 5.0);
        d.wobblePhase += dt * 24.0;
      }

      if (d.normal.y < -0.44 || d.vNorm < 0.048) {
        // Reached the rounded underside curve -> slow gently in place and drain smoothly into the bottom
        // liquid film / morph lobe right where it arrived (NO sudden sideways magnet pull toward center!).
        let bestDu = 999;
        for (let k = 0; k < pendants.length; k++) {
          const du = wrappedDeltaU(d.uNorm, pendants[k].anchorU);
          if (Math.abs(du) < Math.abs(bestDu)) bestDu = du;
        }
        // Only a tiny local capillary merge if already right beside a hanging pendant drop
        if (Math.abs(bestDu) < 0.036) {
          d.uNorm = (d.uNorm + clamp(bestDu, -0.008, 0.008) * Math.min(1, dt * 0.65) + 1) % 1;
        }
        const crawlBrake = smoothstep(-0.78, -0.25, d.normal.y);
        d.vNorm = Math.max(0.018, d.vNorm - dt * 0.006 * crawlBrake);
        d.velV *= Math.exp(-dt * 6.0);
        d.velU *= Math.exp(-dt * 8.0);
        const rBefore = d.radius;
        const drainStep = Math.min(d.radius, dt * (0.034 + d.radius * 0.65));
        d.radius = Math.max(0, d.radius - drainStep);
        if (rBefore > d.radius) {
          const dVol = (rBefore ** 3 - d.radius ** 3) / (0.042 ** 3);
          feedBottomLobe(state, d.pos.x, clamp(dVol * 0.75, 0, 0.055));
          feedPendantFromDrop(d.uNorm, clamp(dVol * 0.16, 0, 0.045));
        }
        if (d.radius < 0.0018) {
          d.alive = false;
          d.radius = 0;
          d.velV = 0;
          d.velU = 0;
          d.sliding = false;
          d.respawnDelay = 3.5 + respawnRand() * 5.5;
        }
      }
    }

    // 3. Pairwise coalescence
    runCoalescence(ice, dt, false);

    // 4. Age continuous rivulet trail nodes
    for (let i = 0; i < trailPool.length; i++) {
      const tn = trailPool[i];
      if (tn.life > 0) {
        tn.life = Math.max(0, tn.life - dt / tn.maxLife);
      }
    }
  }

  // Curated sparse lower-body sweat droplets for 'minimal' mode (10 quiet beads with volume-conserving coalescence
  // and smooth bottom-rim swallowing into the accumulated bottom pool & hanging pendant drops!)
  interface MinimalDrop {
    uNorm: number;
    vNorm: number;
    initU: number;
    initV: number;
    radius: number;
    initRadius: number;
    maxRadius: number;
    growRate: number;
    /** Heavy critical pearl radius required to overcome surface tension and run swiftly downward */
    breakFreeR: number;
    isRim: boolean;
    alive: boolean;
    absorbing: boolean;
    respawnDelay: number;
    slipping: boolean;
    velV: number;
    velU: number;
    wobble: number;
    wobblePhase: number;
    pos: THREE.Vector3;
    normal: THREE.Vector3;
  }

  const minRand = mulberry32(seed * 733 + 109);
  // Very sparse, quiet lower-body sweat (10 subtle beads — calm when idle and cleanly gone by late melt!)
  const MINIMAL_DROP_COUNT = 10;
  const minimalDrops: MinimalDrop[] = [];
  for (let i = 0; i < MINIMAL_DROP_COUNT; i++) {
    const isRim = i < Math.floor(MINIMAL_DROP_COUNT * 0.60);
    let uNorm: number;
    let vNorm: number;
    let radius: number;
    if (isRim) {
      const side = i % 2 === 0 ? 0.25 : 0.75;
      const frontBias = side === 0.25 ? -0.022 : 0.022;
      uNorm = (side + frontBias + (minRand() - 0.5) * 0.075 + 1) % 1;
      vNorm = 0.08 + minRand() * 0.40;
      radius = 0.0030 + Math.pow(minRand(), 2.0) * 0.0044;
    } else {
      uNorm = ((minRand() - 0.5) * 0.40 + 1) % 1;
      vNorm = 0.10 + minRand() * 0.34;
      radius = 0.0028 + Math.pow(minRand(), 2.0) * 0.0042;
    }
    const growRate = 0.00007 + Math.pow(minRand(), 1.95) * 0.00024;
    const breakFreeR = 0.0285 + minRand() * 0.0070;
    minimalDrops.push({
      uNorm,
      vNorm,
      initU: uNorm,
      initV: vNorm,
      radius,
      initRadius: radius,
      maxRadius: 0.036,
      growRate,
      breakFreeR,
      isRim,
      alive: true,
      absorbing: false,
      respawnDelay: 0,
      slipping: false,
      velV: 0,
      velU: 0,
      wobble: 0,
      wobblePhase: minRand() * Math.PI * 2,
      pos: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 0, 1),
    });
  }

  function setMode(mode: DropMode) {
    dropMode = mode;
  }

  function getMode(): DropMode {
    return dropMode;
  }

  function setDebugParams(partial: Partial<DropDebugParams>) {
    if (partial.sag !== undefined) {
      debugParams.sag = clamp(partial.sag, 0, 1.6);
      uniforms.uDropSag.value = debugParams.sag;
    }
    if (partial.stretch !== undefined) {
      debugParams.stretch = clamp(partial.stretch, 0.85, 1.8);
      uniforms.uDropStretch.value = debugParams.stretch;
    }
    if (partial.edgeBlur !== undefined) {
      debugParams.edgeBlur = clamp(partial.edgeBlur, 0, 1.5);
      uniforms.uEdgeSoftness.value = debugParams.edgeBlur;
    }
    if (partial.shadow !== undefined) {
      debugParams.shadow = clamp(partial.shadow, 0, 1.5);
      uniforms.uShadowStrength.value = debugParams.shadow;
    }
    if (partial.shadowBlur !== undefined) {
      debugParams.shadowBlur = clamp(partial.shadowBlur, 0.2, 2.0);
      uniforms.uShadowBlur.value = debugParams.shadowBlur;
    }
    if (partial.rimDark !== undefined) {
      debugParams.rimDark = clamp(partial.rimDark, 0, 1.5);
      uniforms.uRimDark.value = debugParams.rimDark;
    }
    if (partial.size !== undefined) {
      debugParams.size = clamp(partial.size, 0.5, 1.8);
      uniforms.uDropSize.value = debugParams.size;
    }
    if (partial.bottomPool !== undefined) {
      debugParams.bottomPool = clamp(partial.bottomPool, 0, 2.0);
    }
    if (partial.dripRate !== undefined) {
      debugParams.dripRate = clamp(partial.dripRate, 0, 2.0);
    }
    if (partial.bottomDrops !== undefined) {
      debugParams.bottomDrops = Math.round(clamp(partial.bottomDrops, 0, MAX_BOTTOM_DROPS));
    }
  }

  function getDebugParams(): DropDebugParams {
    return { ...debugParams };
  }

  function resetMinimalDrops() {
    for (const md of minimalDrops) {
      md.uNorm = md.initU;
      md.vNorm = md.initV;
      md.radius = md.initRadius;
      md.alive = true;
      md.absorbing = false;
      md.respawnDelay = 0;
      md.slipping = false;
      md.velV = 0;
      md.velU = 0;
      md.wobble = 0;
    }
  }

  // === INSTANT FROST-MELT MICRO-DROPLET RING BUFFER (beads up right where pointer wipes freezer frost!) ===
  interface FrostMeltDrop {
    uNorm: number;
    vNorm: number;
    radius: number;
    targetRadius: number;
    velV: number;
    velU: number;
    slipping: boolean;
    wobble: number;
    wobblePhase: number;
    alive: boolean;
    pos: THREE.Vector3;
    normal: THREE.Vector3;
  }

  const frostRand = mulberry32(seed * 1217 + 53);
  const frostMeltDrops: FrostMeltDrop[] = Array.from({ length: MAX_FROST_DROPS }, () => ({
    uNorm: 0,
    vNorm: 0,
    radius: 0,
    targetRadius: 0,
    velV: 0,
    velU: 0,
    slipping: false,
    wobble: 0,
    wobblePhase: 0,
    alive: false,
    pos: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 0, 1),
  }));
  let frostCursor = 0;

  function clearFrostDrops() {
    for (let i = 0; i < frostMeltDrops.length; i++) {
      const fd = frostMeltDrops[i];
      fd.alive = false;
      fd.radius = 0;
      fd.targetRadius = 0;
      fd.slipping = false;
      fd.velV = 0;
      fd.velU = 0;
      fd.wobble = 0;
    }
    frostCursor = 0;
  }

  function spawnFrostMeltDrops(uNorm: number, vNorm: number, meltedAmount: number, film: LiquidFilmSystem) {
    if (dropMode === 'off' || meltedAmount <= 0.008) return;
    // Delicate sweaty micro-beading along pointer-melted frost (1-2 soft beads rather than dense glass marbles)
    const count = clamp(Math.round(0.6 + meltedAmount * 1.8), 1, 2);

    for (let n = 0; n < count; n++) {
      const ang = frostRand() * Math.PI * 2;
      const dist = Math.sqrt(frostRand()) * 0.026;
      const u = (uNorm + Math.cos(ang) * dist * 0.72 + 1) % 1;
      const v = clamp(vNorm + Math.sin(ang) * dist * 1.15, 0.055, 0.945);

      // Only bead up where frost actually melted into wet ice
      if (film.sampleRime(u, v) > 0.68) continue;

      const targetR = 0.0030 + Math.pow(frostRand(), 1.95) * 0.0052;

      // If another frost bead is already very close, coalesce cleanly into it instead of stacking!
      let merged = false;
      for (let k = 0; k < frostMeltDrops.length; k++) {
        const ex = frostMeltDrops[k];
        if (!ex.alive) continue;
        const du = wrappedDeltaU(ex.uNorm, u);
        const dv = ex.vNorm - v;
        if (du * du * 2.0 + dv * dv < 0.00022) {
          const mergedR = Math.min(0.030, Math.cbrt(ex.targetRadius ** 3 + targetR ** 3 * 0.72));
          ex.targetRadius = mergedR;
          ex.wobble = Math.min(0.85, ex.wobble + 0.45);
          merged = true;
          break;
        }
      }
      if (merged) continue;

      // Allocate next slot in ring buffer (prefer dead slot first so older gliding drops stay intact)
      let slotIdx = -1;
      for (let t = 0; t < frostMeltDrops.length; t++) {
        const idx = (frostCursor + t) % frostMeltDrops.length;
        if (!frostMeltDrops[idx].alive) {
          slotIdx = idx;
          frostCursor = (idx + 1) % frostMeltDrops.length;
          break;
        }
      }
      if (slotIdx < 0) {
        slotIdx = frostCursor;
        frostCursor = (frostCursor + 1) % frostMeltDrops.length;
      }

      const fd = frostMeltDrops[slotIdx];
      fd.uNorm = u;
      fd.vNorm = v;
      fd.targetRadius = targetR;
      // Immediately visible tiny glistening bead that swells smoothly to targetRadius over ~100ms!
      fd.radius = targetR * 0.62;
      fd.velV = 0;
      fd.velU = 0;
      fd.slipping = false;
      fd.wobble = 0.55;
      fd.wobblePhase = frostRand() * Math.PI * 2;
      fd.alive = true;
    }
  }

  function stepFrostMeltDrops(state: MeltFieldState, ice: PopsicleIceSystem, film: LiquidFilmSystem, dt: number, meltSpeedMul: number) {
    const epsU = 1.0 / WET_U;
    const bloomAlpha = 1.0 - Math.exp(-dt * 14.0);
    const rate = (0.9 + state.melt * 1.4) * meltSpeedMul;

    for (let i = 0; i < frostMeltDrops.length; i++) {
      const fd = frostMeltDrops[i];
      if (!fd.alive) continue;

      // Rapid smooth beading-up from melted hoarfrost water
      if (fd.radius < fd.targetRadius) {
        fd.radius += (fd.targetRadius - fd.radius) * bloomAlpha;
      }
      if (fd.wobble > 0.001) {
        fd.wobble *= Math.exp(-dt * 6.5);
        fd.wobblePhase += dt * 24.0;
      }

      // Gently fade tiny micro-beads out only once the popsicle is heavily melted and shrinking away
      if (state.melt > 0.62) {
        fd.targetRadius = Math.max(0, fd.targetRadius - dt * 0.006);
        fd.radius = Math.min(fd.radius, fd.targetRadius);
        if (fd.radius < 0.0014) {
          fd.alive = false;
          continue;
        }
      }

      if (!fd.slipping) {
        // Stay completely pinned as a crisp pearl until really big & heavy (by pointer accumulation or condensation)!
        const onset = smoothstep(0.055, 0.18, state.melt);
        if (onset > 0.02 && fd.targetRadius < 0.0235) {
          fd.targetRadius += 0.00026 * dt * rate * onset;
        }
        if (fd.radius >= 0.0205) {
          fd.slipping = true;
          fd.velV = 0.12 + (fd.radius - 0.0205) * 6.0;
          fd.velU = 0;
        }
      } else {
        ice.sampleLiveSurface(fd.uNorm, fd.vNorm, fd.pos, fd.normal);
        const underSlopeBrake = 0.14 + 0.86 * smoothstep(-0.72, -0.15, fd.normal.y);
        const roughL = sampleGrid(roughGrid, fd.uNorm - epsU * 1.5, fd.vNorm);
        const roughR = sampleGrid(roughGrid, fd.uNorm + epsU * 1.5, fd.vNorm);
        const steerU = -(roughR - roughL) * 0.016;
        // Heavy pearl broke free -> accelerate quickly under gravity!
        const massAccel = 1.75 + Math.max(0, fd.radius - 0.018) * 85.0;
        fd.velV += (massAccel - fd.velV * 1.95) * dt;
        fd.velV = clamp(fd.velV, 0.11, 0.74);
        fd.velU += (steerU - fd.velU * 5.0) * dt;
        fd.velU = clamp(fd.velU, -fd.velV * 0.14, fd.velV * 0.14);

        const stepV = fd.velV * dt * underSlopeBrake;
        fd.vNorm = Math.max(0.018, fd.vNorm - stepV);
        fd.uNorm = (fd.uNorm + fd.velU * dt * underSlopeBrake + 1) % 1;
        film.deposit(fd.uNorm, fd.vNorm, stepV * 0.65, 1);

        // Drain smoothly in place into the downward-morphed bottom pooling belly once reaching the curved overhang
        if (fd.normal.y < -0.44 || fd.vNorm <= 0.050) {
          const rBefore = fd.radius;
          fd.targetRadius = Math.max(0, fd.targetRadius - dt * 0.026);
          fd.radius = Math.max(0, fd.radius - dt * 0.026);
          fd.velV *= Math.exp(-dt * 6.0);
          fd.velU *= Math.exp(-dt * 8.0);
          if (rBefore > fd.radius) {
            feedBottomLobe(state, fd.pos.x, clamp(((rBefore ** 3 - fd.radius ** 3) / (0.042 ** 3)) * 0.75, 0, 0.04));
          }
          if (fd.radius < 0.0014) {
            fd.alive = false;
            fd.radius = 0;
          }
        }
      }
    }
  }

  /**
   * True 3D volume-conserving coalescence for small droplets in 'minimal' mode:
   * - When two small droplets meet, they gently pull together via capillary bridge and FUSE into ONE larger drop
   *   (`rNew = cbrt(r1^3 + r2^3)`), permanently keeping the combined volume (never shrinking back!).
   * - When an incoming drop hits a bottom-rim pool bead, the bottom pool bead swallows it and grows (bleeding
   *   excess liquid smoothly into the nearest big hanging pendant drop!).
   */
  function runMinimalCoalescence(ice: PopsicleIceSystem, dt: number, initialRelax: boolean) {
    for (let i = 0; i < minimalDrops.length; i++) {
      const md = minimalDrops[i];
      if (!md.alive || md.radius < 0.0014) continue;
      ice.sampleLiveSurface(md.uNorm, md.vNorm, md.pos, md.normal);
    }

    const mergeRatio = initialRelax ? 0.72 : 0.74;
    const attractRatio = 1.38;

    for (let i = 0; i < minimalDrops.length; i++) {
      const a = minimalDrops[i];
      if (!a.alive || a.absorbing || a.radius < 0.0020) continue;

      for (let j = i + 1; j < minimalDrops.length; j++) {
        const b = minimalDrops[j];
        if (!b.alive || b.absorbing || b.radius < 0.0020) continue;

        const rSum = a.radius + b.radius;
        const maxRange = rSum * attractRatio;

        const dx = b.pos.x - a.pos.x;
        if (Math.abs(dx) > maxRange) continue;
        const dy = b.pos.y - a.pos.y;
        if (Math.abs(dy) > maxRange) continue;
        const dz = b.pos.z - a.pos.z;
        if (Math.abs(dz) > maxRange) continue;

        const distSq = dx * dx + dy * dy + dz * dz;
        const mergeDist = rSum * mergeRatio;

        if (distSq < mergeDist * mergeDist) {
          // Larger (or lower) drop swallows the smaller one!
          let host: MinimalDrop;
          let guest: MinimalDrop;
          if (Math.abs(a.radius - b.radius) > 0.0015) {
            host = a.radius >= b.radius ? a : b;
            guest = a.radius >= b.radius ? b : a;
          } else {
            host = a.vNorm <= b.vNorm ? a : b;
            guest = a.vNorm <= b.vNorm ? b : a;
          }

          const vHost = host.radius ** 3;
          const vGuest = guest.radius ** 3;
          const vTotal = vHost + vGuest;
          const massRatio = vGuest / Math.max(1e-10, vTotal);
          const mergedR = Math.cbrt(vTotal);

          const du = wrappedDeltaU(host.uNorm, guest.uNorm);
          host.uNorm = (host.uNorm + du * massRatio * 0.42 + 1) % 1;
          host.vNorm = clamp(host.vNorm + (guest.vNorm - host.vNorm) * massRatio * 0.42, 0.006, 0.95);
          host.radius = Math.min(host.maxRadius, mergedR);

          if (!initialRelax) {
            host.wobble = Math.min(0.85, host.wobble + 0.40 + massRatio * 0.45);
            if (a.slipping || b.slipping) {
              // Racing heavy drop swept up a smaller pearl in its path -> keep running even faster!
              host.slipping = true;
              host.velV = Math.max(host.velV, guest.velV) + 0.055 + massRatio * 0.14;
              host.velU = clamp(host.velU * (1 - massRatio) + guest.velU * massRatio + du * 0.04, -0.022, 0.022);
            } else if (host.radius >= host.breakFreeR) {
              // Two swelling pearls just fused into a REALLY big drop -> break surface tension and zip down!
              host.slipping = true;
              host.velV = 0.12 + (host.radius - host.breakFreeR) * 5.0;
              host.velU = 0;
            }
          }

          ice.sampleLiveSurface(host.uNorm, host.vNorm, host.pos, host.normal);

          // Guest is cleanly swallowed and will slowly re-condense from invisible micro-dew later
          guest.alive = false;
          guest.absorbing = false;
          guest.radius = 0;
          guest.slipping = false;
          guest.velV = 0;
          guest.velU = 0;
          guest.wobble = 0;
          guest.respawnDelay = initialRelax ? 4.0 + ((j * 0.73) % 10.0) : 7.0 + ((j * 1.13) % 18.0);

          if (host === b) break;
        } else if (!initialRelax && dt > 0 && distSq < maxRange * maxRange) {
          // Gentle capillary bend ONLY when a fast-racing drop brushes past a pinned pearl in its path!
          // Stationary pearls stay rock-steady until their swelling edges touch & fuse.
          const dist = Math.sqrt(distSq) || 1e-4;
          const prox = smoothstep(maxRange, mergeDist, dist);
          if (a.slipping && !b.slipping && b.vNorm < a.vNorm + 0.025) {
            const duToB = wrappedDeltaU(a.uNorm, b.uNorm);
            a.velU += clamp(duToB, -0.025, 0.025) * prox * dt * 2.2;
          } else if (b.slipping && !a.slipping && a.vNorm < b.vNorm + 0.025) {
            const duToA = wrappedDeltaU(b.uNorm, a.uNorm);
            b.velU += clamp(duToA, -0.025, 0.025) * prox * dt * 2.2;
          }
        }
      }
    }
  }

  let lastLowScanMelt = -999;

  function stepMinimalDrops(state: MeltFieldState, ice: PopsicleIceSystem, film: LiquidFilmSystem, dt: number, meltSpeedMul: number) {
    const condensationOnset = smoothstep(0.044, 0.16, state.melt);
    if (condensationOnset <= 0.005) return;

    const epsU = 1.0 / WET_U;
    const lateQuiet = 1.0 - smoothstep(0.42, 0.70, state.melt);
    const rate = (0.65 + state.melt * 0.85) * lateQuiet * meltSpeedMul;

    for (let i = 0; i < minimalDrops.length; i++) {
      const md = minimalDrops[i];

      if (!md.alive) {
        md.respawnDelay -= dt * rate;
        // Stop spawning fresh side beads once the bar narrows past mid-melt (clean end of melt!)
        if (md.respawnDelay <= 0 && state.melt < 0.48) {
          md.uNorm = ((md.initU + (respawnRand() - 0.5) * 0.08) + 1) % 1;
          md.vNorm = 0.14 + respawnRand() * 0.36;
          md.radius = 0.0014;
          md.alive = true;
          md.absorbing = false;
          md.slipping = false;
          md.velV = 0;
          md.velU = 0;
          md.wobble = 0;
        }
        continue;
      }

      if (md.wobble > 0.001) {
        md.wobble *= Math.exp(-dt * 5.2);
        md.wobblePhase += dt * 22.0;
      }

      // Smooth in-place absorption into the bottom-rim liquid film / downward morph lobe right where the drop arrived
      // (NEVER suddenly yanked sideways across the bottom rim toward the center!)
      if (md.absorbing) {
        ice.sampleLiveSurface(md.uNorm, md.vNorm, md.pos, md.normal);
        let bestDu = 999;
        for (let k = 0; k < pendants.length; k++) {
          const du = wrappedDeltaU(md.uNorm, pendants[k].anchorU);
          if (Math.abs(du) < Math.abs(bestDu)) bestDu = du;
        }
        // Only an ultra-subtle local capillary pull when already right beside a hanging pendant drop
        if (Math.abs(bestDu) < 0.036) {
          md.uNorm = (md.uNorm + clamp(bestDu, -0.008, 0.008) * Math.min(1, dt * 0.65) + 1) % 1;
        }
        const crawlBrake = smoothstep(-0.78, -0.25, md.normal.y);
        md.vNorm = Math.max(0.018, md.vNorm - dt * 0.005 * crawlBrake);

        const rBefore = md.radius;
        const drainStep = Math.min(md.radius, dt * 0.022);
        md.radius = Math.max(0, md.radius - drainStep);

        if (rBefore > md.radius) {
          // Swell the nearest downward-morphed bottom lobe right under this drop's X,
          // and bleed a gentle fraction into the hanging pendant reservoir!
          const dVolRaw = rBefore ** 3 - md.radius ** 3;
          const dVol = dVolRaw / (0.042 ** 3);
          feedBottomLobe(state, md.pos.x, clamp(dVol * 0.85, 0, 0.06));
          feedPendantFromDrop(md.uNorm, clamp(dVol * 0.22, 0, 0.028));
        }

        if (md.radius < 0.0014) {
          md.alive = false;
          md.absorbing = false;
          md.radius = 0;
          md.slipping = false;
          md.velV = 0;
          md.velU = 0;
          md.respawnDelay = 8.0 + respawnRand() * 18.0;
        }
        continue;
      }

      ice.sampleLiveSurface(md.uNorm, md.vNorm, md.pos, md.normal);

      const liveDist = Math.hypot(md.pos.x - state.pointerX, md.pos.y - state.pointerY);
      const liveHeat = state.pointerHeat * Math.exp(-(liveDist * liveDist) / 0.14);
      const localBoost = 1.0 + liveHeat * 6.5;
      const localThaw = 1.0 - smoothstep(0.24, 0.68, film.sampleRime(md.uNorm, md.vNorm));

      // Pearl-drops steadily condense & swell on thawed ice until some grow REALLY big!
      const condenseCap = md.breakFreeR * 1.08;
      if (md.radius < condenseCap && localThaw > 0.12) {
        md.radius = Math.min(condenseCap, md.radius + md.growRate * dt * rate * localBoost * condensationOnset * localThaw);
      }

      if (!md.slipping) {
        // If the melting bottom bevel rises underneath a pinned drop, drain it smoothly into the bottom rim
        if (md.normal.y < -0.50 || md.vNorm <= 0.044) {
          md.absorbing = true;
          continue;
        }
        // Stay COMPLETELY PINNED like crisp glass pearls until really big & heavy enough to break surface tension!
        const effBreakFreeR = md.breakFreeR / (1.0 + liveHeat * 0.32);
        if (md.radius >= effBreakFreeR && localThaw > 0.25) {
          md.slipping = true;
          md.velV = 0.12 + (md.radius - effBreakFreeR) * 6.0;
          md.velU = 0;
        }
      } else {
        const roughL = sampleGrid(roughGrid, md.uNorm - epsU * 1.5, md.vNorm);
        const roughR = sampleGrid(roughGrid, md.uNorm + epsU * 1.5, md.vNorm);
        const steerU = -(roughR - roughL) * 0.018;

        // Smoothly brake downward UV speed as the drop enters the rounded bottom overhang (normal.y < -0.15)
        // so the steepening bottom bevel curvature NEVER whips droplets horizontally inward toward the center!
        const underSlopeBrake = 0.14 + 0.86 * smoothstep(-0.72, -0.15, md.normal.y);

        // Once critical mass breaks surface tension -> accelerate rapidly under gravity & run REALLY quick!
        const massAccel = 1.75 + Math.max(0, md.radius - 0.018) * 95.0;
        md.velV += (massAccel - md.velV * 1.85) * dt;
        md.velV = clamp(md.velV, 0.10, 0.78 * (1.0 + liveHeat * 0.55));

        md.velU += (steerU - md.velU * 5.2) * dt;
        const maxU = md.velV * 0.14;
        md.velU = clamp(md.velU, -maxU, maxU);

        const stepV = md.velV * dt * (1.0 + liveHeat * 0.6) * underSlopeBrake;
        md.vNorm = Math.max(0.018, md.vNorm - stepV);
        md.uNorm = (md.uNorm + md.velU * dt * underSlopeBrake + 1) % 1;

        // Paint a glistening wet sheen along its fast run path
        film.deposit(md.uNorm, md.vNorm, clamp(stepV * 1.35, 0.004, 0.045), 1);

        if (md.normal.y < -0.44 || md.vNorm <= 0.048) {
          // Reached the rounded lower overhang -> slow & drain smoothly in place into the underside pooling curve!
          md.absorbing = true;
          md.slipping = false;
        }
      }
    }

    // Run 60Hz pairwise coalescence so fast-running big drops cleanly sweep up every small pearl in their path!
    runMinimalCoalescence(ice, dt, false);
  }

  function update(
    state: MeltFieldState,
    ice: PopsicleIceSystem,
    film: LiquidFilmSystem,
    dt: number,
    meltSpeedMul: number,
  ) {
    uniforms.uTime.value = state.time;

    const stickClearX = POPSICLE.stickEdgeX + 0.052;
    const { yTop: yTopLive, yBot: yBotLive, iceAmount, iceGone } = getMeltBounds(state.melt);

    if (!hasInitialized) {
      // Snap each of the 6 pendant drops cleanly onto its own safe flat-underside slot using one scan per side!
      scanSideBottom(ice, -1, stickClearX, leftBottomScan);
      scanSideBottom(ice, 1, stickClearX, rightBottomScan);
      for (let k = 0; k < pendants.length; k++) {
        const p = pendants[k];
        const scan = p.side < 0 ? leftBottomScan : rightBottomScan;
        const res = resolvePendantSlotFromScan(scan, p.side, p.slotFrac, p.scale, stickClearX);
        p.minSafeAbsX = res.minSafeAbsX;
        p.maxSafeAbsX = res.maxSafeAbsX;
        p.slotFits = res.found && res.availSpan >= p.minSpan;
        if (res.found) {
          p.anchorU = res.u;
          p.anchorV = res.v;
          p.initAnchorU = res.u;
        }
      }
      runCoalescence(ice, 0, true);
      runMinimalCoalescence(ice, 0, true);
      hasInitialized = true;
    }

    // Physical mass remaining on the outer sides: full at early/mid structural melt, tapering smoothly to zero as the
    // popsicle shrinks down toward the stick at late melt (so side dripping winds down naturally!)
    const structMelt = getStructuralMelt(state.melt);
    const sideSupply = 1.0 - smoothstep(0.45, 0.72, structMelt);
    const pendantMeltPace =
      (0.72 + Math.sin(clamp(structMelt, 0, 0.82) * Math.PI * 1.22) * 0.42) * sideSupply * meltSpeedMul;
    const activeIceScale = iceGone ? 0 : clamp(1.0 - smoothstep(0.50, 0.76, structMelt), 0, 1);

    if (dt > 0 && !iceGone) {
      if (dropMode === 'full') {
        stepLiquidPhysics(state, ice, film, dt, meltSpeedMul);
      } else if (dropMode === 'minimal') {
        stepMinimalDrops(state, ice, film, dt, meltSpeedMul);
      }
      if (dropMode !== 'off') {
        stepFrostMeltDrops(state, ice, film, dt, meltSpeedMul);
      }

      // Feed real bottom drainage from the 2D viscous sticky glaze film PDE into bottom lobes & gently into pendants
      // (most liquid escapes down the stick once melting builds; side drainage winds down with sideSupply!)
      fluxPerLobe.fill(0);
      const liveHalfW = POPSICLE.halfWidthBottom * (1.0 - structMelt * 0.44);
      for (let iu = 0; iu < FILM_U; iu++) {
        const q = film.bottomFlux[iu];
        if (q <= 0.0001) continue;
        const uNorm = (iu + 0.5) / FILM_U;
        const wx = Math.sin(uNorm * Math.PI * 2) * liveHalfW;
        feedBottomLobe(state, wx, Math.min(0.045 * dt, q * 0.075));
        const lobeIdx = wx < -0.26 ? 0 : wx < 0 ? 1 : wx < 0.26 ? 2 : 3;
        fluxPerLobe[lobeIdx] += q;
      }
      if (sideSupply > 0.05) {
        for (let k = 0; k < pendants.length; k++) {
          const qLobe = fluxPerLobe[pendants[k].lobeIndex];
          if (qLobe > 0) {
            feedPendantFromDrop(pendants[k].anchorU, Math.min(0.012 * dt, qLobe * 0.010 * sideSupply));
          }
        }
      }
    }

    // Update 3D melted-ice glossy syrup glaze on the birch wooden stick (keep dry while frosted!)
    const frostGoneGate = smoothstep(0.18, 0.02, film.avgRime);
    const liveStickWet = clamp(
      Math.max(film.stickWetness * 1.15, smoothstep(0.14, 0.54, state.melt) * 0.98 * frostGoneGate),
      0,
      1,
    );
    stickMelt.uniforms.uIceBottomY.value = yBotLive;
    stickMelt.uniforms.uIceTopY.value = yTopLive;
    stickMelt.uniforms.uIceAmount.value = iceAmount;
    stickMelt.uniforms.uStickWetness.value = liveStickWet;
    stickMelt.uniforms.uMelt.value = state.melt;
    stickMelt.mesh.visible = !(liveStickWet < 0.08 && iceAmount > 0.95 && state.melt < 0.14);

    stickFlow.uniforms.uIceBottomY.value = yBotLive;
    stickFlow.uniforms.uIceAmount.value = iceAmount;
    stickFlow.uniforms.uMelt.value = state.melt;
    if (dt > 0) {
      stickFlowPhase += dt * clamp(0.38 + meltSpeedMul * 0.24, 0.24, 1.15);
    }
    stickFlow.uniforms.uFlowRate.value = stickFlowPhase;
    stickFlow.group.visible = state.melt > 0.16 && state.melt < 0.90;

    // === BOTTOM-STICK OVERFLOW FILAMENT -> PINCH-OFF -> FINAL SLOW DROPS -> COMPLETE STOP ===
    {
      const m = state.melt;
      const scrubbed = dt === 0 || Math.abs(m - prevTipMelt) > 0.04;
      prevTipMelt = m;

      // Overflow starts once glossy stick runoff reaches & overflows the rounded bottom tip (melt ~ 0.24),
      // flows steadily down through mid-melt (0.30..0.67), necks & pinches off (0.66..0.74),
      // emits 3-4 lingering final slow drops (0.71..0.875), and stops completely (>= 0.88)!
      const wetOverflowGate = smoothstep(0.16, 0.44, liveStickWet);
      const overflowAmt = smoothstep(0.22, 0.36, m) * wetOverflowGate;
      const pinchProgress = smoothstep(0.66, 0.74, m);
      const supplyEnd = 1.0 - smoothstep(0.84, 0.89, m);

      if (dt > 0) {
        tipFilamentPhase += dt * clamp(0.68 + meltSpeedMul * 0.42, 0.35, 1.90);
      }

      if (m < 0.21 || wetOverflowGate < 0.04) {
        tipFilamentReach = 0;
        tipFilamentTailDrop = 0;
        tipDropStage = 'idle';
        tipDropGrow = 0;
        tipDropStageTime = 0;
        tipDropsEmitted = 0;
        stickTipFilament.mesh.visible = false;
        tipDropNeckMesh.visible = false;
        for (const fd of tipDropFallPool) {
          fd.active = false;
          fd.mesh.visible = false;
        }
      } else {
        // 1. Continuous flowing filament + pinch-off tail detachment
        const targetReach = overflowAmt * 2.45;
        if (scrubbed) {
          tipFilamentReach = targetReach;
          tipFilamentTailDrop = pinchProgress * 1.55;
        } else {
          // Smooth physical downward extension when overflowing (stretches cleanly off the bottom of the screen!)
          const extendRate = targetReach > tipFilamentReach ? 1.55 : 3.0;
          tipFilamentReach += (targetReach - tipFilamentReach) * Math.min(1, dt * extendRate);
          if (pinchProgress > 0.01) {
            tipFilamentTailDrop = Math.min(1.65, Math.max(tipFilamentTailDrop + dt * (1.35 + pinchProgress * 2.5), pinchProgress * 1.55));
          } else {
            tipFilamentTailDrop = 0;
          }
        }

        const filThick =
          smoothstep(0.23, 0.35, m) *
          wetOverflowGate *
          (1.0 - smoothstep(0.60, 0.72, m) * 0.55) *
          (1.0 - smoothstep(0.71, 0.75, m));
        const collarAmt =
          smoothstep(0.21, 0.31, m) *
          wetOverflowGate *
          (1.0 - smoothstep(0.67, 0.74, m));

        stickTipFilament.uniforms.uFlowPhase.value = tipFilamentPhase;
        stickTipFilament.uniforms.uReach.value = tipFilamentReach;
        stickTipFilament.uniforms.uThickness.value = filThick;
        stickTipFilament.uniforms.uTailDrop.value = tipFilamentTailDrop;
        stickTipFilament.uniforms.uCollarAmt.value = collarAmt;
        stickTipFilament.mesh.visible =
          (filThick > 0.015 && tipFilamentTailDrop < 1.48) || collarAmt > 0.02;

        // 2. Final slow lingering drops from the rounded bottom tip after the filament stops (melt ~ 0.71..0.88)!
        const inFinalDropWindow = m >= 0.71 && m < 0.875 && supplyEnd > 0.02;
        if (scrubbed) {
          for (const fd of tipDropFallPool) {
            fd.active = false;
            fd.mesh.visible = false;
          }
          if (inFinalDropWindow) {
            // Deterministic preview pose when scrubbing directly into the final-drops phase!
            const phaseT = clamp((m - 0.71) / 0.165, 0, 1);
            tipDropsEmitted = Math.min(TIP_FINAL_DROPS_MAX - 1, Math.floor(phaseT * TIP_FINAL_DROPS_MAX));
            tipDropStage = 'growing';
            tipDropGrow = 0.82;
            tipDropStageTime = 0;
            // Also show one freshly detached drop falling cleanly in view below the tip on scrub!
            const fd = tipDropFallPool[0];
            fd.active = true;
            fd.y = POPSICLE.stickBottomY - 0.16 - ((phaseT * 0.36) % 0.18);
            fd.velY = 1.4;
            fd.radius = 0.032 * (1.0 - phaseT * 0.32);
            fd.time = 0.18;
          } else {
            tipDropStage = m >= 0.875 ? 'done' : 'idle';
            tipDropGrow = 0;
            tipDropStageTime = 0;
            tipDropsEmitted = m >= 0.875 ? TIP_FINAL_DROPS_MAX : 0;
          }
        } else if (dt > 0) {
          if (inFinalDropWindow && tipDropStage === 'idle' && tipDropsEmitted < TIP_FINAL_DROPS_MAX) {
            tipDropStage = 'growing';
            tipDropGrow = 0.22;
            tipDropStageTime = 0;
          }
          const slowDecay = 1.0 - (tipDropsEmitted / TIP_FINAL_DROPS_MAX) * 0.48;
          if (tipDropStage === 'growing') {
            if (!inFinalDropWindow && tipDropGrow < 0.75) {
              // Supply ran completely out before drop could reach break-off size -> softly stop!
              tipDropGrow = Math.max(0, tipDropGrow - dt * 0.45);
              if (tipDropGrow <= 0.01) tipDropStage = 'done';
            } else {
              tipDropGrow += dt * (0.28 + 0.20 * slowDecay) * meltSpeedMul;
              if (tipDropGrow >= 1.0) {
                tipDropGrow = 1.0;
                tipDropStage = 'pinching';
                tipDropStageTime = 0;
              }
            }
          } else if (tipDropStage === 'pinching') {
            tipDropStageTime += dt * (0.95 + 0.25 * meltSpeedMul);
            if (tipDropStageTime >= 0.72) {
              // Emit a falling final drop from the rounded stick bottom tip!
              const dropScale = 1.08 - (tipDropsEmitted / TIP_FINAL_DROPS_MAX) * 0.44;
              const slot = tipDropFallPool.find((d) => !d.active) ?? tipDropFallPool[0];
              slot.active = true;
              slot.y = POPSICLE.stickBottomY - 0.088 * dropScale;
              slot.velY = 0.34;
              slot.radius = 0.033 * dropScale;
              slot.time = 0;
              tipDropsEmitted++;
              tipDropStage = 'recoiling';
              tipDropStageTime = 0;
            }
          } else if (tipDropStage === 'recoiling') {
            tipDropStageTime += dt * 1.1;
            if (tipDropStageTime >= 0.55) {
              if (inFinalDropWindow && tipDropsEmitted < TIP_FINAL_DROPS_MAX) {
                tipDropStage = 'growing';
                tipDropGrow = 0.05;
                tipDropStageTime = 0;
              } else {
                tipDropStage = 'done';
                tipDropGrow = 0;
              }
            }
          }
        }

        // Update hanging tip neck mesh during final-drop stages
        if (tipDropStage === 'growing' || tipDropStage === 'pinching' || tipDropStage === 'recoiling') {
          const dropScale = (1.10 - (Math.min(tipDropsEmitted, TIP_FINAL_DROPS_MAX - 1) / TIP_FINAL_DROPS_MAX) * 0.42) * (0.50 + 0.50 * supplyEnd);
          const pinchFrac = tipDropStage === 'pinching' ? clamp(tipDropStageTime / 0.72, 0, 1) : 0;
          const recoilFrac = tipDropStage === 'recoiling' ? clamp(tipDropStageTime / 0.55, 0, 1) : 0;
          const stageU = tipDropStage === 'pinching' ? pinchFrac : recoilFrac;
          updatePendantLatheGeometry(tipDropNeckGeo, tipDropStage, tipDropGrow, stageU, 1.0, -0.058);
          tipDropNeckMesh.position.set(0, POPSICLE.stickBottomY + 0.008, 0);
          tipDropNeckMesh.scale.setScalar(dropScale);
          tipDropNeckMesh.visible = dropScale > 0.14 && (tipDropStage !== 'growing' || tipDropGrow > 0.04);
        } else {
          tipDropNeckMesh.visible = false;
        }

        // Advance & render any falling final tip drops cleanly under gravity
        for (const fd of tipDropFallPool) {
          if (!fd.active) {
            fd.mesh.visible = false;
            continue;
          }
          if (dt > 0) {
            fd.time += dt;
            fd.velY += 5.4 * dt;
            fd.y -= fd.velY * dt;
            if (fd.y < POPSICLE.stickBottomY - 2.4 || fd.time > 1.8) {
              fd.active = false;
              fd.mesh.visible = false;
              continue;
            }
          }
          const stretchY = 1.15 + clamp(fd.velY * 0.22, 0, 0.75);
          const squeezeXZ = 1.0 / Math.sqrt(stretchY);
          fd.mesh.position.set(0, fd.y, 0);
          fd.mesh.scale.set(fd.radius * squeezeXZ, fd.radius * stretchY, fd.radius * squeezeXZ);
          fd.mesh.visible = true;
        }
      }
    }

    // Early-melt individual stick-edge drops: appear right after frost clears (melt ~ 0.14..0.34),
    // then smoothly transition into the continuous undulating syrup flow stream once heavy melting kicks in!
    const stickDripOnset = smoothstep(0.14, 0.23, state.melt) * frostGoneGate;
    const heavyFlowTakeover = 1.0 - smoothstep(0.28, 0.46, state.melt);
    const stickEdgeDropPresence = stickDripOnset * heavyFlowTakeover;
    const stickEdgeDripMul = Math.max(0.25, debugParams.dripRate);
    for (let i = 0; i < stickEdgeDrops.length; i++) {
      const sd = stickEdgeDrops[i];
      if (stickEdgeDropPresence <= 0.01 || (iceGone && sd.stage !== 'sliding')) {
        sd.mesh.visible = false;
        continue;
      }

      if (dt > 0) {
        if (sd.stage === 'dormant') {
          if (!iceGone && iceAmount > 0.08) {
            sd.stageTime += dt * (0.62 + state.melt * 1.10) * meltSpeedMul * stickEdgeDripMul * stickDripOnset;
            if (sd.stageTime >= sd.dormantDur) {
              sd.stage = 'swelling';
              sd.stageTime = 0;
              sd.radius = 0.001;
              sd.velY = 0;
              sd.y = Math.min(POPSICLE.stickTopY - 0.10, yBotLive - sd.spawnDropY);
            }
          }
        } else if (sd.stage === 'swelling') {
          const swellRate = (0.0058 + state.melt * 0.0072) * meltSpeedMul * stickEdgeDripMul;
          sd.radius = Math.min(sd.maxR, sd.radius + swellRate * dt);
          const anchorY = Math.min(POPSICLE.stickTopY - 0.10, yBotLive - sd.spawnDropY);
          sd.y += (anchorY - sd.y) * Math.min(1, dt * 2.2);
          sd.y -= sd.radius * 0.28 * dt * meltSpeedMul;
          if (sd.radius >= sd.maxR * 0.84) {
            sd.stage = 'sliding';
            sd.velY = 0.018;
          }
        } else if (sd.stage === 'sliding') {
          const yBotArch = POPSICLE.stickBottomY + POPSICLE.stickWidth * 0.5;
          if (sd.y >= POPSICLE.stickBottomY - 0.015) {
            // Deliberate, sticky viscous glide down the wooden stick edge and around its rounded bottom tip!
            const grainMod = 0.56 + 0.44 * Math.sin(sd.y * 19.0 + sd.phase);
            const targetVel = (0.026 + (sd.radius / 0.025) * 0.038) * (0.72 + state.melt * 0.50) * meltSpeedMul * grainMod;
            sd.velY += (targetVel - sd.velY) * Math.min(1, dt * 3.0);
            sd.y -= sd.velY * dt;
            sd.radius = Math.max(sd.maxR * 0.68, sd.radius - 0.00045 * dt);
          } else {
            // Free-fall drip cleanly off the rounded bottom tip of the stick under gravity!
            sd.velY += 4.6 * dt;
            sd.y -= sd.velY * dt;
          }

          // Recycle smoothly once fallen well below the rounded stick bottom!
          if (sd.y < POPSICLE.stickBottomY - 0.85) {
            sd.stage = 'dormant';
            sd.stageTime = 0;
            sd.radius = 0;
            sd.velY = 0;
            sd.dormantDur = 2.2 + ((i * 1.35 + state.time * 0.43) % 2.8);
          }
          void yBotArch;
        }
      }

      const effR = sd.radius * stickEdgeDropPresence;
      if (sd.stage === 'dormant' || effR < 0.0018 || sd.y > yBotLive + 0.015) {
        sd.mesh.visible = false;
      } else {
        const yBotArch = POPSICLE.stickBottomY + POPSICLE.stickWidth * 0.5;
        const fallingOff = sd.y < POPSICLE.stickBottomY - 0.015;
        const speedNorm = sd.stage === 'sliding' ? clamp(sd.velY / 0.085, 0, 1) : 0;
        const scaleX = effR * (fallingOff ? 0.96 : 1.14 - speedNorm * 0.10);
        const scaleY = effR * (fallingOff ? 1.85 + clamp(sd.velY * 0.35, 0, 0.8) : 2.05 + speedNorm * 1.15);
        const scaleZ = effR * 0.96;
        // Hug the outer wooden edge & curve smoothly inward around the semicircular bottom tip before dripping off!
        let dropX: number;
        if (sd.y >= yBotArch) {
          dropX = sd.side * (stickEdgeX + 0.0025);
        } else if (!fallingOff) {
          const dy = Math.min(stickEdgeX, Math.max(0, yBotArch - sd.y));
          const rCurve = Math.sqrt(Math.max(0, stickEdgeX * stickEdgeX - dy * dy));
          dropX = sd.side * (rCurve + 0.002);
        } else {
          dropX = sd.side * 0.012;
        }
        sd.mesh.position.set(dropX, sd.y, 0);
        sd.mesh.scale.set(scaleX, scaleY, scaleZ);
        sd.mesh.visible = true;
      }
    }

    // === PACK SURFACE DROPS & TRAILS ACCORDING TO DROP MODE ('minimal' | 'full' | 'off') ===
    // Completely dry out of the freezer (condensationOnset = 0 at melt = 0.035 -> ZERO ambient drops at start!)
    const condensationOnset = smoothstep(0.044, 0.16, state.melt);
    let slot = 0;

    if (dropMode === 'minimal' && condensationOnset > 0.005) {
      // Fade side-wall sweat beads cleanly to 0 at late melt (no lingering drops at the end of melt!)
      const minimalFade = clamp(1.0 - smoothstep(0.46, 0.72, state.melt), 0.0, 1.0);
      for (let i = 0; i < minimalDrops.length; i++) {
        const md = minimalDrops[i];
        if (!md.alive) continue;
        // Taper splats cleanly before the bottom bevel & underside overhang (normal.y < -0.46) at every melt stage
        const baseBevelTuck = smoothstep(0.026, 0.070, md.vNorm);
        const localThaw = 1.0 - smoothstep(0.24, 0.68, film.sampleRime(md.uNorm, md.vNorm));
        if (md.radius * activeIceScale * condensationOnset * minimalFade * baseBevelTuck * localThaw < 0.0014) continue;

        ice.sampleLiveSurface(md.uNorm, md.vNorm, md.pos, md.normal);
        const underTuck = smoothstep(-0.88, -0.46, md.normal.y);
        const effR = md.radius * activeIceScale * condensationOnset * minimalFade * baseBevelTuck * underTuck * localThaw;
        if (effR < 0.0014) continue;

        const o3 = slot * 3;
        const o4 = slot * 4;
        slot++;

        const speedNorm = md.slipping ? clamp(md.velV * 1.85, 0, 1.0) : 0;
        const sizeW = smoothstep(0.0052, 0.026, md.radius);
        let aspectY: number;
        let gravitySag: number;
        if (md.isRim) {
          // Side pearls hang heavier as they swell and stretch sleekly once racing down!
          aspectY = 1.12 + sizeW * 0.24 + speedNorm * 0.48;
          gravitySag = 0.58 + sizeW * 0.48 + speedNorm * 0.60;
        } else {
          // Face pearls sit round & crisp while pinned, stretching smoothly once heavy & running!
          aspectY = 1.04 + sizeW * 0.18 + speedNorm * 0.46;
          gravitySag = 0.26 + sizeW * 0.46 + speedNorm * 0.60;
        }
        const tilt = md.slipping ? clamp(Math.atan2(md.velU * 1.4, Math.max(0.02, md.velV)), -0.35, 0.35) : 0;
        const wobbleOsc = md.wobble * Math.sin(md.wobblePhase);

        centersArr[o3] = md.pos.x;
        centersArr[o3 + 1] = md.pos.y;
        centersArr[o3 + 2] = md.pos.z;

        normalsArr[o3] = md.normal.x;
        normalsArr[o3 + 1] = md.normal.y;
        normalsArr[o3 + 2] = md.normal.z;

        paramsArr[o4] = effR;
        paramsArr[o4 + 1] = aspectY;
        paramsArr[o4 + 2] = md.slipping ? 0.88 : 0.72;
        paramsArr[o4 + 3] = md.isRim ? 0.42 : 0.34;

        motionArr[o3] = tilt;
        motionArr[o3 + 1] = wobbleOsc;
        motionArr[o3 + 2] = gravitySag;
      }
    } else if (dropMode === 'full' && condensationOnset > 0.005) {
      // Compact ONLY active visible drops & trails (zero dead instances dispatched to GPU!)
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (!d.alive) continue;

        const baseBevelTuck = smoothstep(0.026, 0.068, d.vNorm);
        const localThaw = 1.0 - smoothstep(0.24, 0.68, film.sampleRime(d.uNorm, d.vNorm));
        if (d.radius * activeIceScale * condensationOnset * baseBevelTuck * localThaw < 0.001) continue;

        ice.sampleLiveSurface(d.uNorm, d.vNorm, d.pos, d.normal);
        const underTuck = smoothstep(-0.88, -0.46, d.normal.y);
        const effR = d.radius * activeIceScale * condensationOnset * baseBevelTuck * underTuck * localThaw;
        if (effR < 0.001) continue;

        const o3 = slot * 3;
        const o4 = slot * 4;
        slot++;

        const speedNorm = clamp(d.velV * 1.85, 0, 1);
        const sizeW = smoothstep(0.012, 0.042, effR);
        const aspectY = (d.isRim ? 1.12 : 1.05) + sizeW * 0.22 + speedNorm * 0.48;
        const gravitySag = (d.isRim ? 0.62 : 0.30) + sizeW * 0.46 + speedNorm * 0.60;
        const tilt = d.sliding ? clamp(Math.atan2(d.velU * 1.4, Math.max(0.02, d.velV)), -0.45, 0.45) : 0;
        const wobbleOsc = d.wobble * Math.sin(d.wobblePhase);

        centersArr[o3] = d.pos.x;
        centersArr[o3 + 1] = d.pos.y;
        centersArr[o3 + 2] = d.pos.z;

        normalsArr[o3] = d.normal.x;
        normalsArr[o3 + 1] = d.normal.y;
        normalsArr[o3 + 2] = d.normal.z;

        paramsArr[o4] = effR;
        paramsArr[o4 + 1] = aspectY;
        paramsArr[o4 + 2] = 1.0;
        paramsArr[o4 + 3] = d.isRim ? 0.34 : 0.24;

        motionArr[o3] = tilt;
        motionArr[o3 + 1] = wobbleOsc;
        motionArr[o3 + 2] = gravitySag;
      }

      if (activeIceScale >= 0.05) {
        for (let i = 0; i < trailPool.length; i++) {
          const tn = trailPool[i];
          if (tn.life <= 0.01) continue;

          const bevelTuck = smoothstep(0.025, 0.065, tn.vNorm);
          if (bevelTuck < 0.02) continue;

          const age = 1.0 - tn.life;
          const breakupAmt = smoothstep(0.28, 0.72, age);
          const rpWave = Math.sin(tn.arcPhase * 0.85);
          const pinchFactor = 1.0 - breakupAmt * (0.45 - 0.55 * rpWave);
          const lifeFade = smoothstep(0.0, 0.22, tn.life);
          const effR = tn.baseRadius * clamp(pinchFactor, 0, 1.15) * lifeFade * activeIceScale * bevelTuck;
          if (effR < 0.0018) continue;

          ice.sampleLiveSurface(tn.uNorm, tn.vNorm, tn.pos, tn.normal);
          const residualPlump = tn.plumpness + breakupAmt * Math.max(0, rpWave) * 0.42;

          const o3 = slot * 3;
          const o4 = slot * 4;
          slot++;

          centersArr[o3] = tn.pos.x;
          centersArr[o3 + 1] = tn.pos.y;
          centersArr[o3 + 2] = tn.pos.z;

          normalsArr[o3] = tn.normal.x;
          normalsArr[o3 + 1] = tn.normal.y;
          normalsArr[o3 + 2] = tn.normal.z;

          paramsArr[o4] = effR;
          paramsArr[o4 + 1] = 1.18 - breakupAmt * 0.14;
          paramsArr[o4 + 2] = clamp(residualPlump, 0.30, 0.88);
          paramsArr[o4 + 3] = tn.juiceTint;

          motionArr[o3] = 0;
          motionArr[o3 + 1] = 0;
          motionArr[o3 + 2] = 0.20;
        }
      }
    } else {
      // 'off': zero surface metaball droplets
      slot = 0;
    }

    // Pack glistening small condensation beads spawned instantly where the pointer melted freezer frost!
    if (dropMode !== 'off' && !iceGone && activeIceScale > 0.05) {
      for (let i = 0; i < frostMeltDrops.length && slot < TOTAL_METABALLS; i++) {
        const fd = frostMeltDrops[i];
        if (!fd.alive) continue;
        const baseBevelTuck = smoothstep(0.026, 0.070, fd.vNorm);
        if (fd.radius * activeIceScale * baseBevelTuck < 0.0014) continue;

        ice.sampleLiveSurface(fd.uNorm, fd.vNorm, fd.pos, fd.normal);
        const underTuck = smoothstep(-0.88, -0.46, fd.normal.y);
        const effR = fd.radius * activeIceScale * baseBevelTuck * underTuck;
        if (effR < 0.0014) continue;

        const o3 = slot * 3;
        const o4 = slot * 4;
        slot++;

        const speedNorm = fd.slipping ? clamp(fd.velV * 1.85, 0, 1.0) : 0;
        const sizeW = smoothstep(0.0048, 0.022, fd.radius);
        const aspectY = 1.04 + sizeW * 0.16 + speedNorm * 0.46;
        const gravitySag = 0.24 + sizeW * 0.44 + speedNorm * 0.60;
        const tilt = fd.slipping ? clamp(Math.atan2(fd.velU * 1.4, Math.max(0.02, fd.velV)), -0.35, 0.35) : 0;
        const wobbleOsc = fd.wobble * Math.sin(fd.wobblePhase);

        centersArr[o3] = fd.pos.x;
        centersArr[o3 + 1] = fd.pos.y;
        centersArr[o3 + 2] = fd.pos.z;

        normalsArr[o3] = fd.normal.x;
        normalsArr[o3 + 1] = fd.normal.y;
        normalsArr[o3 + 2] = fd.normal.z;

        paramsArr[o4] = effR;
        paramsArr[o4 + 1] = aspectY;
        paramsArr[o4 + 2] = fd.slipping ? 0.86 : 0.68;
        paramsArr[o4 + 3] = 0.32;

        motionArr[o3] = tilt;
        motionArr[o3 + 1] = wobbleOsc;
        motionArr[o3 + 2] = gravitySag;
      }
    }

    // Draw ONLY active metaball droplets (and skip Pass 6a completely when slot === 0!)
    activeDropInstances = slot;
    instGeo.instanceCount = slot;
    resolveMat.uniforms.uHasDropField.value = slot > 0 ? 1.0 : 0.0;
    if (slot > 0) {
      centersAttr.clearUpdateRanges();
      normalsAttr.clearUpdateRanges();
      paramsAttr.clearUpdateRanges();
      motionAttr.clearUpdateRanges();
      centersAttr.addUpdateRange(0, slot * 3);
      normalsAttr.addUpdateRange(0, slot * 3);
      paramsAttr.addUpdateRange(0, slot * 4);
      motionAttr.addUpdateRange(0, slot * 3);
      centersAttr.needsUpdate = true;
      normalsAttr.needsUpdate = true;
      paramsAttr.needsUpdate = true;
      motionAttr.needsUpdate = true;
    }

    // === UPDATE 3D RAYLEIGH-PLATEAU BOTTOM-RIM PENDANT DROPS (ANCHORED TO LIVE ACCUMULATION LOWS!) ===
    // Keep bottom drips & rim pearls completely dry until freezer frost has cleared and structural melt begins!
    const freezerThawProgress = clamp(
      smoothstep(0.15, 0.25, state.melt) * smoothstep(0.16, 0.01, film.avgRime),
      0,
      1,
    );
    const shouldRescanLow =
      !leftBottomScan.hasSmooth || dt > 0 || Math.abs(state.melt - lastLowScanMelt) > 1e-6;
    if (shouldRescanLow && !iceGone && activeIceScale > 0.05) {
      lastLowScanMelt = state.melt;
      scanSideBottom(ice, -1, stickClearX, leftBottomScan, dt);
      scanSideBottom(ice, 1, stickClearX, rightBottomScan, dt);
    }

    // Bind the concave pouch-to-stick meniscus bridge directly to each side's live translucent underside!
    if (!iceGone && activeIceScale > 0.05) {
      const leftOverhang = Math.max(0, leftBottomScan.maxRimAbsX - POPSICLE.stickEdgeX);
      const rightOverhang = Math.max(0, rightBottomScan.maxRimAbsX - POPSICLE.stickEdgeX);
      stickFlow.uniforms.uLeftFunnelW.value = clamp((leftOverhang - 0.045) * 0.19, 0, 0.056);
      stickFlow.uniforms.uRightFunnelW.value = clamp((rightOverhang - 0.045) * 0.19, 0, 0.056);
      stickFlow.uniforms.uLeftFunnelY.value = Number.isFinite(leftBottomScan.innerPouchY)
        ? clamp(leftBottomScan.innerPouchY + 0.004, yBotLive - 0.095, yBotLive)
        : yBotLive;
      stickFlow.uniforms.uRightFunnelY.value = Number.isFinite(rightBottomScan.innerPouchY)
        ? clamp(rightBottomScan.innerPouchY + 0.004, yBotLive - 0.095, yBotLive)
        : yBotLive;
    } else {
      stickFlow.uniforms.uLeftFunnelW.value = 0;
      stickFlow.uniforms.uRightFunnelW.value = 0;
      stickFlow.uniforms.uLeftFunnelY.value = yBotLive;
      stickFlow.uniforms.uRightFunnelY.value = yBotLive;
    }

    if (!state.pendantPull || state.pendantPull.length < 4) {
      state.pendantPull = [0, 0, 0, 0];
    } else {
      state.pendantPull[0] = 0;
      state.pendantPull[1] = 0;
      state.pendantPull[2] = 0;
      state.pendantPull[3] = 0;
    }

    for (let i = 0; i < pendants.length; i++) {
      const p = pendants[i];
      if (!iceGone && activeIceScale > 0.05) {
        if (shouldRescanLow) {
          const effPreviewScale = p.scale * activeIceScale;
          const scan = p.side < 0 ? leftBottomScan : rightBottomScan;
          const low = resolvePendantSlotFromScan(scan, p.side, p.slotFrac, effPreviewScale, stickClearX);
          p.maxSafeAbsX = low.maxSafeAbsX;
          p.minSafeAbsX = low.minSafeAbsX;
          p.slotFits = low.found && low.availSpan >= p.minSpan;

          if (low.found) {
            if (dt === 0 || p.stage === 'dormant') {
              p.anchorU = low.u;
              p.anchorV = low.v;
            } else {
              // Check whether the receding bottom corner is approaching this active drop!
              ice.sampleLiveSurface(p.anchorU, p.anchorV, tmpPos, tmpNorm);
              const curAbsX = Math.abs(tmpPos.x);
              const pushedOffCorner = curAbsX > p.maxSafeAbsX || curAbsX < p.minSafeAbsX || tmpNorm.y > -0.68;
              if (pushedOffCorner) {
                // Smoothly glide inward inside the receding flat bottom (never discrete snap/teleport!)
                const du = wrappedDeltaU(p.anchorU, low.u);
                const tuckRate =
                  curAbsX > p.maxSafeAbsX + 0.035 ? 1.0 - Math.exp(-dt * 24.0) : 1.0 - Math.exp(-dt * 12.0);
                p.anchorU = (p.anchorU + du * tuckRate + 1) % 1;
                p.anchorV += (low.v - p.anchorV) * tuckRate;
              } else if (p.stage === 'growing' && p.grow < 0.45) {
                const du = wrappedDeltaU(p.anchorU, low.u);
                const driftRate = 1.0 - Math.exp(-dt * 2.4);
                p.anchorU = (p.anchorU + clamp(du, -0.012, 0.012) * driftRate + 1) % 1;
                p.anchorV += (low.v - p.anchorV) * driftRate;
              }
            }
          }
        }
      } else {
        p.slotFits = false;
      }

      ice.sampleLiveSurface(p.anchorU, p.anchorV, tmpPos, tmpNorm);

      const curAx = Math.abs(tmpPos.x);
      const clearOfEdges = curAx >= p.minSafeAbsX - 0.008 && curAx <= p.maxSafeAbsX + 0.010 && tmpNorm.y <= -0.64;
      // Seat wide Young-Laplace bell aligned cleanly with the perspective bottom silhouette of the curved
      // lower ice bevel so even tiny emerging drops flare smoothly BELOW the underside rim with zero halo!
      p.neckMesh.position.set(tmpPos.x, tmpPos.y - 0.003 * activeIceScale, tmpPos.z * 0.12);

      const effScale = p.scale * activeIceScale * freezerThawProgress;
      const Rmax = 0.036 * effScale;

      if (dt > 0 && activeIceScale > 0.06 && clearOfEdges) {
        const localHeat = sampleLocalHeat(tmpPos.x, tmpPos.y, state);
        const liveDist = Math.hypot(tmpPos.x - state.pointerX, tmpPos.y - state.pointerY);
        const liveHeat = state.pointerHeat * Math.exp(-(liveDist * liveDist) / 0.35);
        // Calm when idle, immediately lively when warmed directly by your pointer!
        const heatFactor = 1.0 + localHeat * 3.2 + liveHeat * 6.5;

        const dripMul = debugParams.dripRate;
        if (p.stage === 'dormant') {
          if (p.slotFits && sideSupply > 0.08) {
            p.stageTime += dt * (0.72 + state.melt * 0.55) * sideSupply * meltSpeedMul * heatFactor * dripMul * freezerThawProgress;
            if (p.stageTime >= p.dormantDuration) {
              p.stage = 'growing';
              p.grow = 0;
              p.stageTime = 0;
            }
          }
        } else if (p.stage === 'growing') {
          // Serene passive tempo when idle (winding down at late melt), surging smoothly if warmed by pointer!
          const effPace = Math.max(liveHeat * 0.9, pendantMeltPace);
          const dGrow = Math.min(0.085 * Math.max(1, meltSpeedMul) * dt, p.growRate * effPace * heatFactor * dripMul * dt);
          p.grow += dGrow;
          if (dripMul <= 0.001) {
            p.grow = Math.min(p.grow, 0.94);
          } else if (p.grow >= 1.0) {
            p.grow = 1.0;
            p.stage = 'pinching';
            p.stageTime = 0;
          }
        } else if (p.stage === 'pinching') {
          // Real-time sugary-juice gravity draw & capillary pinch (~0.85s real time!)
          p.stageTime += dt;
          if (p.stageTime >= p.pinchDuration) {
            // Exact seamless handoff at snap instant: same world center, same radius, same downward velocity!
            const snapEval = updatePendantLatheGeometry(p.neckGeo, 'pinching', 1.0, 1.0, effScale, p.recoilStartY);
            p.fallActive = true;
            p.fallTime = 0;
            p.fallR = Rmax;
            p.fallPos.set(p.neckMesh.position.x, p.neckMesh.position.y + snapEval.yBulbCenter, p.neckMesh.position.z);
            p.fallVelY = (2.05 * 3.55 * Rmax) / p.pinchDuration;
            p.recoilStartY = snapEval.pinchY;
            p.fallMesh.visible = true;

            p.stage = 'recoiling';
            p.stageTime = 0;

            // Relieve the bottom pooling lobe right where the drop just detached!
            if (state.bottomLobes) {
              state.bottomLobes[p.lobeIndex] = Math.max(0.68, state.bottomLobes[p.lobeIndex] * 0.80);
            }
          }
        } else if (p.stage === 'recoiling') {
          // Viscous damped capillary snap-back of the residual upper rim cone (~0.42s real time!)
          p.stageTime += dt;
          if (p.stageTime >= p.recoilDuration) {
            p.stage = 'dormant';
            p.stageTime = 0;
            p.grow = 0;
            p.dormantDuration = 5.2 + ((i * 2.3 + state.time * 0.41) % 5.4);
          }
        }
      }

      // Subtle capillary gravity swell on the underside right above this forming drop, recoiling elastically on snap!
      const stageU =
        p.stage === 'pinching'
          ? clamp(p.stageTime / p.pinchDuration, 0, 1)
          : p.stage === 'recoiling'
            ? clamp(p.stageTime / p.recoilDuration, 0, 1)
            : 0;

      let pullVal = 0;
      if (activeIceScale > 0.05 && clearOfEdges && freezerThawProgress > 0.01) {
        if (p.stage === 'growing') {
          pullVal = smoothstep(0.0, 0.70, p.grow);
        } else if (p.stage === 'pinching') {
          pullVal = 1.0 + 0.16 * Math.sin(stageU * Math.PI * 0.72);
        } else if (p.stage === 'recoiling') {
          pullVal = Math.exp(-stageU * 5.2) * Math.cos(stageU * Math.PI * 1.55);
        }
      }
      const scaledPull = pullVal * freezerThawProgress * activeIceScale;
      if (Math.abs(scaledPull) > Math.abs(state.pendantPull[p.lobeIndex])) {
        state.pendantPull[p.lobeIndex] = scaledPull;
      }

      if (activeIceScale <= 0.05 || effScale <= 0.04 || !clearOfEdges || p.stage === 'dormant' || (p.stage === 'growing' && p.grow < 0.01)) {
        p.neckMesh.visible = false;
      } else {
        const evalRes = updatePendantLatheGeometry(p.neckGeo, p.stage, p.grow, stageU, effScale, p.recoilStartY);
        p.neckMesh.visible = evalRes.visible;
      }

      if (p.fallActive && p.fallMesh.visible) {
        p.fallTime += dt;
        const fallDist = p.fallVelY * p.fallTime + 0.5 * 8.2 * p.fallTime * p.fallTime;
        p.fallMesh.position.set(p.fallPos.x, p.fallPos.y - fallDist, p.fallPos.z);

        // Exact volume-preserving sugary-juice elongation rebound matching elongated pinch belly at t = 0!
        const osc = Math.exp(-p.fallTime * 5.2) * Math.cos(p.fallTime * 15.0) * 0.26;
        const sy = 1.0 + osc;
        const sxz = 1.0 / Math.sqrt(Math.max(0.5, sy));
        p.fallMesh.scale.set(p.fallR * sxz, p.fallR * sy, p.fallR * sxz);

        if (p.fallMesh.position.y < -3.6) {
          p.fallActive = false;
          p.fallMesh.visible = false;
        }
      }
    }

    // === UPDATE INSTANCED BOTTOM-RIM CRYSTAL PEARLS (ZERO CORNER OVERHANG, MERGE-AWARE!) ===
    // Controlled independently via `bottomDrops` (0..80), matching pendants & stick flow when surface sweat `drops === 'off'`!
    const maxBottomPearls = Math.round(clamp(debugParams.bottomDrops, 0, bottomRimPearls.length));
    if (maxBottomPearls <= 0 || iceGone || activeIceScale <= 0.05 || freezerThawProgress <= 0.01) {
      bottomPearlsMesh.count = 0;
      bottomPearlsMesh.visible = false;
    } else {
      const collapse = smoothstep(0.40, 0.975, structMelt);
      const liveHalfD =
        POPSICLE.halfDepth *
        (1.0 - structMelt * 0.34) *
        (1.0 - Math.pow(collapse, 1.50) * 0.88);
      const pearlMatArr = bottomPearlsMesh.instanceMatrix.array as Float32Array;
      let pSlot = 0;

      for (let i = 0; i < maxBottomPearls; i++) {
        const bp = bottomRimPearls[i];
        const scan = bp.side < 0 ? leftBottomScan : rightBottomScan;
        const bloom = smoothstep(bp.appearAt * 0.40, Math.min(1.0, bp.appearAt * 0.40 + 0.36), freezerThawProgress);
        if (bloom <= 0.02) continue;

        const breath = 0.90 + 0.10 * Math.sin(state.time * bp.freq + bp.phase);
        let effScale = bp.baseScale * (0.45 + 0.55 * activeIceScale) * bloom * breath;
        if (effScale < 0.08) continue;

        const pearlBulbR = 0.028 * effScale;
        const collarHalfW = pearlBulbR * 1.48;
        const minSafeX = POPSICLE.stickEdgeX + collarHalfW + 0.024;
        const maxSafeX = scan.flatEdgeAbsX - collarHalfW * 1.12 - 0.012;
        const availSpan = maxSafeX - minSafeX;
        const spanFade = smoothstep(bp.minSpan - 0.015, bp.minSpan + 0.045, availSpan);
        if (availSpan <= 0.002 || spanFade <= 0.02) continue;
        effScale *= spanFade;

        const absX = minSafeX + bp.slotFrac * availSpan;

        // Smoothly interpolate exact live bottom-rim surface Y between bracketing scan points (zero bin jumps!)
        const samp = sampleScanAtAbsX(scan, absX);
        if (!samp.found) continue;

        const px = bp.side * absX;
        const pz = bp.zFrac * Math.max(0.016, liveHalfD * 0.34);
        // Seat cleanly on the visible bottom silhouette so every pearl glistens clearly below the underside rim
        const py = samp.y - 0.0036 * activeIceScale;

        // Smoothly absorb any pearl directly overlapped by an actively swelling large pendant drop (allows close neighbors!)
        let mergeFade = 1.0;
        const curBulbR = 0.028 * effScale;
        for (let k = 0; k < pendants.length; k++) {
          const p = pendants[k];
          if (p.side !== bp.side || !p.neckMesh.visible || p.stage === 'dormant') continue;
          const pR = 0.036 * p.scale * activeIceScale * freezerThawProgress * (p.stage === 'growing' ? 0.35 + 0.65 * p.grow : 1.0);
          const dist = Math.hypot(px - p.neckMesh.position.x, pz - p.neckMesh.position.z);
          const minClear = pR * 0.92 + curBulbR * 0.85;
          if (dist < minClear) {
            mergeFade = Math.min(mergeFade, smoothstep(0.40, 1.0, dist / Math.max(1e-4, minClear)));
          }
        }
        effScale *= mergeFade;
        if (effScale < 0.08) continue;

        const sx = effScale;
        const sy = effScale * bp.elong;
        const o = pSlot * 16;
        pearlMatArr[o] = sx;
        pearlMatArr[o + 1] = 0;
        pearlMatArr[o + 2] = 0;
        pearlMatArr[o + 3] = 0;
        pearlMatArr[o + 4] = 0;
        pearlMatArr[o + 5] = sy;
        pearlMatArr[o + 6] = 0;
        pearlMatArr[o + 7] = 0;
        pearlMatArr[o + 8] = 0;
        pearlMatArr[o + 9] = 0;
        pearlMatArr[o + 10] = sx;
        pearlMatArr[o + 11] = 0;
        pearlMatArr[o + 12] = px;
        pearlMatArr[o + 13] = py;
        pearlMatArr[o + 14] = pz;
        pearlMatArr[o + 15] = 1;
        pSlot++;
      }

      bottomPearlsMesh.count = pSlot;
      bottomPearlsMesh.visible = pSlot > 0;
      if (pSlot > 0) {
        bottomPearlsMesh.instanceMatrix.needsUpdate = true;
      }
    }

    // Smoothly relax live bottom-lobe morph weights back toward 1.0 as hanging pendants slowly drain them
    if (dt > 0 && state.bottomLobes) {
      const relax = 1.0 - Math.exp(-dt * 0.28);
      for (let k = 0; k < 4; k++) {
        state.bottomLobes[k] += (1.0 - state.bottomLobes[k]) * relax;
      }
    }
  }

  function dispose() {
    for (const d of disposables) d.dispose();
  }

  return {
    fieldScene,
    resolveScene,
    pendantGroup,
    uniforms,
    setMode,
    getMode,
    setDebugParams,
    getDebugParams,
    hasDropField: () => activeDropInstances > 0,
    setRecipe,
    spawnFrostMeltDrops,
    clearFrostDrops,
    reset,
    update,
    dispose,
  };
}
