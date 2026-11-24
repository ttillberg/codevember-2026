import * as THREE from 'three';
import { clamp, fbm3, mulberry32, smoothstep } from './rng';
import { MeltFieldState, POPSICLE, sampleLocalHeat } from './shape';
import { PopsicleIceSystem } from './popsicleIce';
import { FILM_U, LiquidFilmSystem } from './liquidFilm';

export type DropMode = 'minimal' | 'full' | 'off';

export interface WaterDropUniforms {
  uSceneTex: { value: THREE.Texture | null };
  uDropFieldTex: { value: THREE.Texture | null };
  uResolution: { value: THREE.Vector2 };
  uTime: { value: number };
}

export interface WaterDropSystem {
  fieldScene: THREE.Scene;
  resolveScene: THREE.Scene;
  pendantGroup: THREE.Group;
  uniforms: WaterDropUniforms;
  setMode(mode: DropMode): void;
  getMode(): DropMode;
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
  anchorU: number;
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
}

const MAX_SURFACE_DROPS = 520;
const MAX_TRAIL_NODES = 1200;
const TOTAL_METABALLS = MAX_SURFACE_DROPS + MAX_TRAIL_NODES;

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
    },
    vertexShader: /* glsl */ `
      // aCenter = xyz world position on live ice surface
      // aNormal = xyz outward ice surface normal
      // aParams = (worldRadius, aspectY, plumpness, juiceTint)
      // aMotion = (tiltAngleRad, wobbleAmt, 0, 0)
      attribute vec3 aCenter;
      attribute vec3 aNormal;
      attribute vec4 aParams;
      attribute vec2 aMotion;

      uniform vec2 uResolution;

      varying vec2 vLocal;
      varying float vRadiusPx;
      varying float vPlumpness;
      varying float vJuiceTint;
      varying float vVisibility;

      void main() {
        float r = aParams.x;
        float aspectY = aParams.y;
        float plumpness = aParams.z;
        float juiceTint = aParams.w;
        float tilt = aMotion.x;
        float wobble = aMotion.y;

        vLocal = position.xy * 2.0; // [-1, 1]
        vPlumpness = plumpness;
        vJuiceTint = juiceTint;

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

        float rx = r * 1.48 * (1.0 - wobble * 0.14);
        float ry = r * 1.48 * aspectY * (1.0 + wobble * 0.14);

        vec2 localOff = vec2(position.x * 2.0 * rx, position.y * 2.0 * ry);
        // Align elongated sliding droplet & rivulet trail along its actual meandering flow direction!
        float ct = cos(tilt);
        float st = sin(tilt);
        vec2 rotOff = vec2(localOff.x * ct - localOff.y * st, localOff.x * st + localOff.y * ct);
        rotOff.y -= r * (aspectY - 1.0) * 0.20;

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

      void main() {
        vec2 p = vLocal;
        float topRound = 1.0 + 0.08 * smoothstep(0.0, 0.9, p.y);
        p.x *= topRound;

        float d2 = dot(p, p);
        if (d2 >= 1.0) discard;

        // C1-smooth cubic metaball kernel -> continuous liquid bridges & smooth tapering wet rivulets!
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
      uResolution: sharedUniforms.uResolution,
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
      uniform vec2 uResolution;

      varying vec2 vUv;

      const float ISO_THRESH = 0.34;

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
        vec3 baseScene = texture2D(uSceneTex, vUv).rgb;
        vec4 fC = texture2D(uDropFieldTex, vUv);
        float phi = fC.r;

        if (phi <= ISO_THRESH - 0.03) {
          gl_FragColor = vec4(baseScene, 1.0);
          return;
        }

        vec2 tx = 1.0 / uResolution;

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
        float slopeLen = length(slope);
        if (slopeLen > 3.6) {
          slope *= 3.6 / slopeLen;
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

        vec3 clearPinkTint = mix(vec3(1.0, 0.97, 0.96), vec3(1.02, 0.78, 0.76), juiceTint * (0.35 + 0.45 * plump));
        refrCol *= clearPinkTint;

        // Crisp dark optical glass contour: bold on plump drops, delicate glossy wet edge on thin trails!
        float darkContour = smoothstep(0.76, 0.34, ndv) * smoothstep(0.04, 0.28, ndv);
        vec3 darkRimTint = mix(vec3(0.28, 0.12, 0.12), vec3(0.40, 0.07, 0.10), juiceTint);
        vec3 col = mix(refrCol, refrCol * darkRimTint, darkContour * (0.38 + 0.48 * plump));

        // Luminous bottom caustic crescent
        float bottomCaustic = smoothstep(0.14, -0.76, N.y) * smoothstep(0.14, 0.72, ndv);
        col += vec3(0.74, 0.54, 0.48) * bottomCaustic * (0.28 + 0.52 * plump);

        // Glassy Fresnel studio sheen (makes thin wet trails glisten crisply when light grazes their edges!)
        float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 4.2);
        vec3 R = reflect(-V, N);
        float stripRefl = exp(-pow((abs(R.x) - 0.62) / 0.18, 2.0)) * smoothstep(-0.85, 0.85, R.y);
        float topRefl = smoothstep(0.50, 0.92, R.y);
        vec3 envSpec = vec3(1.22, 1.12, 1.08) * (0.30 + 1.45 * stripRefl + 0.80 * topRefl);
        col = mix(col, envSpec, clamp(fresnel * (0.55 + 0.18 * plump), 0.0, 0.74));

        // Razor-sharp studio pinpoint catchlights
        vec3 l1 = normalize(vec3(-0.48, 0.58, 0.66));
        vec3 l2 = normalize(vec3(0.54, 0.44, 0.71));
        vec3 h1 = normalize(l1 + V);
        vec3 h2 = normalize(l2 + V);
        float spec1 = pow(max(dot(N, h1), 0.0), 200.0);
        float spec2 = pow(max(dot(N, h2), 0.0), 155.0);
        col += vec3(2.8, 2.68, 2.62) * (spec1 * 1.22 + spec2 * 0.78) * (0.55 + 0.45 * plump);

        // Subtle wet-track gloss darkening right at contact edge
        float contactShadow = smoothstep(ISO_THRESH, ISO_THRESH - 0.028, phi) * smoothstep(0.0, -0.5, N.y) * plump;

        float aaWidth = max(0.010, gradPhi * 1.15);
        float mask = smoothstep(ISO_THRESH - aaWidth * 0.5, ISO_THRESH + aaWidth * 0.85, phi);

        vec3 shadowedBase = baseScene * (1.0 - contactShadow * 0.08);
        vec3 outCol = mix(shadowedBase, col, mask);
        gl_FragColor = vec4(outCol, 1.0);
      }
    `,
  });
}

/** Optical water shader for the 3D Rayleigh-Plateau bottom-rim hanging & pinching pendant drops. */
function createPendantDropMaterial(sharedUniforms: WaterDropUniforms, lensPower: number, juiceTint: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
    uniforms: {
      uSceneTex: sharedUniforms.uSceneTex,
      uResolution: sharedUniforms.uResolution,
      uTime: sharedUniforms.uTime,
      uLensPower: { value: lensPower },
      uJuiceTint: { value: juiceTint },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      varying float vLocalY;

      void main() {
        vLocalY = position.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform sampler2D uSceneTex;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform float uLensPower;
      uniform float uJuiceTint;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      varying float vLocalY;

      void main() {
        vec2 screenUv = gl_FragCoord.xy / uResolution;
        vec3 N = normalize(vWorldNormal);
        vec3 Nv = normalize(vViewNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);

        float ndv = clamp(dot(N, V), 0.0, 1.0);

        vec2 refrVec = -Nv.xy * uLensPower * (0.65 + 0.75 * pow(1.0 - ndv, 0.8));
        vec2 uvR = clamp(screenUv + refrVec * 0.94, vec2(0.002), vec2(0.998));
        vec2 uvG = clamp(screenUv + refrVec * 1.00, vec2(0.002), vec2(0.998));
        vec2 uvB = clamp(screenUv + refrVec * 1.07, vec2(0.002), vec2(0.998));

        vec3 refrCol;
        refrCol.r = texture2D(uSceneTex, uvR).r;
        refrCol.g = texture2D(uSceneTex, uvG).g;
        refrCol.b = texture2D(uSceneTex, uvB).b;

        float topJuice = smoothstep(-0.085, 0.018, vLocalY);
        float effTint = uJuiceTint * (0.68 + 0.52 * topJuice);
        vec3 clearPinkTint = mix(vec3(1.0, 0.95, 0.93), vec3(1.02, 0.62, 0.60), effTint);
        refrCol *= clearPinkTint;
        // Smooth warm strawberry-ice optical continuity right at the upper wetting collar!
        refrCol = mix(refrCol, vec3(0.92, 0.34, 0.35), smoothstep(-0.012, 0.024, vLocalY) * 0.42);

        float darkContour = smoothstep(0.68, 0.30, ndv) * smoothstep(0.03, 0.24, ndv);
        vec3 darkRimTint = mix(vec3(0.28, 0.12, 0.12), vec3(0.38, 0.06, 0.09), effTint);
        vec3 col = mix(refrCol, refrCol * darkRimTint, darkContour * (0.82 - 0.35 * smoothstep(-0.01, 0.022, vLocalY)));

        float bottomCaustic = smoothstep(0.16, -0.78, Nv.y) * smoothstep(0.12, 0.70, ndv);
        col += vec3(0.76, 0.56, 0.48) * bottomCaustic * 0.82;

        float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 4.4);
        vec3 R = reflect(-V, N);
        float stripRefl = exp(-pow((abs(R.x) - 0.64) / 0.16, 2.0)) * smoothstep(-0.85, 0.85, R.y);
        float topRefl = smoothstep(0.52, 0.92, R.y);
        vec3 envSpec = vec3(1.18, 1.06, 1.00) * (0.28 + 1.45 * stripRefl + 0.82 * topRefl);
        col = mix(col, envSpec, clamp(fresnel * 0.72, 0.0, 0.72));

        vec3 l1 = normalize(vec3(-0.50, 0.56, 0.66));
        vec3 l2 = normalize(vec3(0.56, 0.42, 0.71));
        vec3 h1 = normalize(l1 + V);
        vec3 h2 = normalize(l2 + V);
        float spec1 = pow(max(dot(N, h1), 0.0), 220.0);
        float spec2 = pow(max(dot(N, h2), 0.0), 170.0);
        col += vec3(2.8, 2.7, 2.62) * (spec1 * 1.25 + spec2 * 0.85);

        float topFade = smoothstep(0.024, -0.014, vLocalY);
        float alpha = smoothstep(0.0, 0.07, ndv) * (0.12 + 0.88 * topFade);
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
    uStickWetness: { value: number };
    uMelt: { value: number };
  };
  dispose(): void;
} {
  const segU = 64;
  const segV = 96;
  const vCount = (segU + 1) * (segV + 1);
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const uvs = new Float32Array(vCount * 2);
  const indices: number[] = [];

  // Exact outer cross-section of createWoodStickGeometry() plus ultra-tight clearance (+0.0010)
  // so subtle watery glaze wisps sit completely flush with ZERO silhouette halo along the wood edges!
  const woodBevelX = POPSICLE.stickDepth * 0.19 * 0.7;
  const hw = POPSICLE.stickWidth * 0.5 + woodBevelX + 0.0010;
  const hd = POPSICLE.stickDepth * 0.5 + 0.0010;
  const spanDown = 1.24;
  // Extend well up inside the popsicle bottom so the ice depth prepass cleanly occludes the top seam!
  const topOverlap = 0.090;

  for (let iv = 0; iv <= segV; iv++) {
    const vNorm = iv / segV;
    const y = topOverlap - vNorm * (spanDown + topOverlap);

    for (let iu = 0; iu <= segU; iu++) {
      const uNorm = iu / segU;
      const theta = iu === segU ? 0 : uNorm * Math.PI * 2;
      const sT = Math.sin(theta);
      const cT = Math.cos(theta);
      // Rounded-rectangle superellipse snugly matching the extruded beveled birch stick
      const sgnX = sT >= 0 ? 1 : -1;
      const sgnZ = cT >= 0 ? 1 : -1;
      const x = sgnX * Math.pow(Math.abs(sT), 0.34) * hw;
      const z = sgnZ * Math.pow(Math.abs(cT), 0.38) * hd;

      // Exact smooth analytical outward normal of the superellipse perimeter
      let nx = sgnX * Math.pow(Math.max(1e-4, Math.abs(sT)), 1.66) / hw;
      let nz = sgnZ * Math.pow(Math.max(1e-4, Math.abs(cT)), 1.62) / hd;
      const nLen = Math.hypot(nx, nz) || 1;
      nx /= nLen;
      nz /= nLen;

      const idx = iv * (segU + 1) + iu;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;

      normals[idx * 3] = nx;
      normals[idx * 3 + 1] = 0;
      normals[idx * 3 + 2] = nz;

      uvs[idx * 2] = uNorm;
      uvs[idx * 2 + 1] = vNorm;
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
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);

  const stickMeltUniforms = {
    uIceBottomY: { value: POPSICLE.yBottom as number },
    uStickWetness: { value: 0.0 as number },
    uMelt: { value: 0.0 as number },
  };

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
    uniforms: {
      uSceneTex: sharedUniforms.uSceneTex,
      uResolution: sharedUniforms.uResolution,
      uTime: sharedUniforms.uTime,
      uIceBottomY: stickMeltUniforms.uIceBottomY,
      uStickWetness: stickMeltUniforms.uStickWetness,
      uMelt: stickMeltUniforms.uMelt,
      uSeed: { value: seed * 3.17 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uIceBottomY;
      uniform float uStickWetness;
      uniform float uMelt;
      uniform float uSeed;

      varying vec3 vWorldPos;
      varying vec3 vBaseNormal;
      varying vec2 vUv;
      varying float vDistBelow;
      varying vec2 vLocalXZ;

      // Evaluates super-subtle overlapping translucent wet film layers building up on the wooden stick
      // AFTER the porous birch wood has absorbed berry juice!
      // Elongated organic downward-bowed film tongues (following the vertical wood grain — NEVER cartoon white bars!)
      // create delicate stacked tonal & glossy meniscus steps as each thin layer creeps slowly down over the previous one.
      float evalLiquidLayer(float x, float dSmooth, float reach, float speed, float phase, float xCenter, float xWidth) {
        float span = max(0.35, reach * 1.25);
        float front = mod(uTime * speed + phase, span);
        // Natural parabolic gravity tongue (leads deeper along grain channel, tapers softly toward stick edges)
        float dx = (x - xCenter) / xWidth;
        float lobeShape = exp(-dx * dx * 1.15);
        float grainRipple = sin(x * 11.5 + phase * 4.3 + uSeed) * 0.018 + cos(x * 23.0 - uSeed) * 0.008;
        float frontY = front * (0.38 + 0.78 * lobeShape) + grainRipple;

        // Smooth thin layered sheet behind the creeping front + crisp delicate capillary ridge right at its lip
        float sheet = smoothstep(frontY + 0.016, frontY - 0.030, dSmooth) * smoothstep(0.02, 0.10, front) * (0.35 + 0.65 * lobeShape);
        float softLip = exp(-pow((dSmooth - frontY) / 0.012, 2.0)) * lobeShape * smoothstep(0.03, 0.12, front) * smoothstep(span, span - 0.10, front);
        return sheet * 0.28 + softLip * 0.20;
      }

      float evalSyrupField(vec2 xzNorm, float distBelow) {
        float wet = clamp(uStickWetness, 0.0, 1.0);
        if (wet < 0.08) return 0.0;

        // Layers appear gently AFTER the wood itself has absorbed berry juice!
        float layerAmt = smoothstep(0.20, 0.80, wet);
        if (layerAmt < 0.005) return 0.0;

        float dSmooth = 0.5 * (distBelow + sqrt(distBelow * distBelow + 0.0006));
        float x = xzNorm.x;
        float z = xzNorm.y;

        float faceMask = smoothstep(0.18, 0.58, abs(z));
        float reach = smoothstep(0.15, 0.90, wet);

        // 4 overlapping elongated wet sheen layers creeping slowly at staggered speeds across different wood grain lanes
        float l1 = evalLiquidLayer(x, dSmooth, reach, 0.016, 0.12, -0.26, 0.68);
        float l2 = evalLiquidLayer(x, dSmooth, reach, 0.021, 0.44,  0.22, 0.64);
        float l3 = evalLiquidLayer(x, dSmooth, reach, 0.013, 0.72, -0.05, 0.82);
        float l4 = evalLiquidLayer(x, dSmooth, reach, 0.025, 0.91,  0.34, 0.54);

        // Subtle continuous upper collar feeding the stacked translucent glaze layers
        float collar = exp(-dSmooth / max(0.028, 0.055 * (0.5 + 0.6 * reach))) * 0.24;
        float layered = (l1 + l2 + l3 + l4) * layerAmt;

        float topFade = smoothstep(-0.075, 0.014, distBelow);
        return clamp((collar * smoothstep(0.12, 0.40, wet) + layered) * faceMask * topFade, 0.0, 0.95);
      }

      void main() {
        vUv = uv;
        float distBelow = -position.y;
        vDistBelow = distBelow;
        vec2 xzNorm = vec2(position.x / ${hw.toFixed(6)}, position.z / ${hd.toFixed(6)});
        vLocalXZ = xzNorm;

        float thick = evalSyrupField(xzNorm, distBelow);
        float dSmooth = 0.5 * (distBelow + sqrt(distBelow * distBelow + 0.0006));

        // Ultra-subtle paper-thin layered film relief hugging the soaked wood flush
        float tinyMeniscus = exp(-dSmooth * 36.0) * smoothstep(-0.04, 0.015, distBelow) * smoothstep(0.10, 0.45, uStickWetness) * 0.0012;
        float layerBulge = smoothstep(0.06, 0.90, thick) * (0.0010 + 0.0014 * uStickWetness);
        vec3 displaced = position + normal * (tinyMeniscus + layerBulge);
        displaced.y += uIceBottomY;

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
      uniform float uStickWetness;
      uniform float uMelt;
      uniform float uSeed;

      varying vec3 vWorldPos;
      varying vec3 vBaseNormal;
      varying vec2 vUv;
      varying float vDistBelow;
      varying vec2 vLocalXZ;

      float evalLiquidLayer(float x, float dSmooth, float reach, float speed, float phase, float xCenter, float xWidth) {
        float span = max(0.35, reach * 1.25);
        float front = mod(uTime * speed + phase, span);
        float dx = (x - xCenter) / xWidth;
        float lobeShape = exp(-dx * dx * 1.15);
        float grainRipple = sin(x * 11.5 + phase * 4.3 + uSeed) * 0.018 + cos(x * 23.0 - uSeed) * 0.008;
        float frontY = front * (0.38 + 0.78 * lobeShape) + grainRipple;

        float sheet = smoothstep(frontY + 0.016, frontY - 0.030, dSmooth) * smoothstep(0.02, 0.10, front) * (0.35 + 0.65 * lobeShape);
        float softLip = exp(-pow((dSmooth - frontY) / 0.012, 2.0)) * lobeShape * smoothstep(0.03, 0.12, front) * smoothstep(span, span - 0.10, front);
        return sheet * 0.28 + softLip * 0.20;
      }

      float evalSyrupField(vec2 xzNorm, float distBelow) {
        float wet = clamp(uStickWetness, 0.0, 1.0);
        if (wet < 0.08) return 0.0;

        float layerAmt = smoothstep(0.20, 0.80, wet);
        if (layerAmt < 0.005) return 0.0;

        float dSmooth = 0.5 * (distBelow + sqrt(distBelow * distBelow + 0.0006));
        float x = xzNorm.x;
        float z = xzNorm.y;

        float faceMask = smoothstep(0.18, 0.58, abs(z));
        float reach = smoothstep(0.15, 0.90, wet);

        float l1 = evalLiquidLayer(x, dSmooth, reach, 0.016, 0.12, -0.26, 0.68);
        float l2 = evalLiquidLayer(x, dSmooth, reach, 0.021, 0.44,  0.22, 0.64);
        float l3 = evalLiquidLayer(x, dSmooth, reach, 0.013, 0.72, -0.05, 0.82);
        float l4 = evalLiquidLayer(x, dSmooth, reach, 0.025, 0.91,  0.34, 0.54);

        float collar = exp(-dSmooth / max(0.028, 0.055 * (0.5 + 0.6 * reach))) * 0.24;
        float layered = (l1 + l2 + l3 + l4) * layerAmt;

        float topFade = smoothstep(-0.075, 0.014, distBelow);
        return clamp((collar * smoothstep(0.12, 0.40, wet) + layered) * faceMask * topFade, 0.0, 0.95);
      }

      void main() {
        float fC = evalSyrupField(vLocalXZ, vDistBelow);
        if (fC < 0.04) discard;

        vec3 N0 = normalize(vBaseNormal);
        vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N0));
        vec3 B = vec3(0.0, 1.0, 0.0);

        float epsS = 0.024;
        vec2 stepXZ = vec2(T.x * epsS, T.z * epsS * (${(hw / hd).toFixed(4)}));
        float dv = 0.007;
        float fR = evalSyrupField(vLocalXZ + stepXZ, vDistBelow);
        float fL = evalSyrupField(vLocalXZ - stepXZ, vDistBelow);
        float fD = evalSyrupField(vLocalXZ, vDistBelow + dv);
        float fU = evalSyrupField(vLocalXZ, vDistBelow - dv);

        float gradT = (fR - fL) / (2.0 * epsS);
        float gradV = (fD - fU) / (2.0 * dv);

        // Super subtle physical meniscus slope across the overlapping wet layers (NO neon white lines!)
        float topDamp = smoothstep(-0.01, 0.035, vDistBelow);
        vec3 N = normalize(N0 - T * clamp(gradT * 0.18, -0.44, 0.44) + B * clamp(gradV * 0.068 * topDamp, -0.44, 0.44));
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(N, V), 0.0, 1.0);

        vec2 screenUv = gl_FragCoord.xy / uResolution;
        vec2 refrOff = -N.xy * (0.0016 + 0.0044 * smoothstep(0.06, 0.85, fC));
        vec3 bgWood = texture2D(uSceneTex, clamp(screenUv + refrOff, vec2(0.002), vec2(0.998))).rgb;

        // Each overlapping wet film layer deepens & enriches the glossy berry-stained wood just enough to read!
        float optDepth = smoothstep(0.04, 0.85, fC);
        vec3 syrupTrans = exp(-vec3(0.10, 0.88, 0.92) * (0.20 + 0.80 * optDepth));
        vec3 col = bgWood * syrupTrans;

        // Delicate dark optical meniscus contour strictly along the curved leading edge of each added layer
        float lipContour = clamp(-gradV * 0.055 * topDamp, 0.0, 0.26);
        col *= (1.0 - lipContour);

        // Broken, organic studio specular highlights strictly where each curved ridge catches off-axis light
        float fresnel = 0.015 + 0.985 * pow(1.0 - ndv, 5.2);
        vec3 l1 = normalize(vec3(-0.42, 0.54, 0.73));
        vec3 l2 = normalize(vec3(0.48, 0.42, 0.77));
        vec3 h1 = normalize(l1 + V);
        vec3 h2 = normalize(l2 + V);
        float spec1 = pow(max(dot(N, h1), 0.0), 175.0);
        float spec2 = pow(max(dot(N, h2), 0.0), 135.0);
        col = mix(col, vec3(1.05, 0.97, 0.96), clamp(fresnel * 0.16, 0.0, 0.16));
        col += vec3(2.05, 1.92, 1.88) * (spec1 * 1.15 + spec2 * 0.80);

        float alpha = smoothstep(0.04, 0.22, fC) * smoothstep(-0.055, 0.014, vDistBelow);
        gl_FragColor = vec4(col, alpha * 0.72);
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

const PENDANT_SEG_U = 28;
const PENDANT_SEG_V = 28;

function createPendantLatheGeometry(): THREE.BufferGeometry {
  const vCount = (PENDANT_SEG_U + 1) * (PENDANT_SEG_V + 1);
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
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
  posAttr.setUsage(THREE.DynamicDrawUsage);
  normAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', normAttr);
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
  const Rmax = 0.043 * scale;
  if (Rmax < 0.002 || stage === 'dormant' || (stage === 'growing' && grow < 0.006)) {
    return { visible: false, yBulbCenter: 0, bulbR: 0, pinchY: 0 };
  }

  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const normAttr = geo.attributes.normal as THREE.BufferAttribute;
  const pos = posAttr.array as Float32Array;
  const norm = normAttr.array as Float32Array;

  const radiusProfile = new Float32Array(PENDANT_SEG_V + 1);
  const yProfile = new Float32Array(PENDANT_SEG_V + 1);

  const smax = (a: number, b: number, k: number) => {
    const h = clamp(0.5 + (0.5 * (b - a)) / Math.max(1e-5, k), 0, 1);
    return a + (b - a) * h + k * h * (1 - h);
  };

  const yTop = 0.032 * scale;
  let yBulbCenter = 0;
  let bulbR = Rmax;
  let pinchY = -Rmax;

  if (stage === 'recoiling') {
    const u = clamp(stageU, 0, 1);
    // Slightly viscous sugary-juice upper cone retracts smoothly upward into the wet ice rim
    const snap = Math.exp(-u * 4.8) * Math.cos(u * Math.PI * 1.15);
    const tipY = Math.min(yTop - 0.003, recoilStartY * Math.max(-0.06, snap));
    const tipR = Math.max(0.0012, Rmax * (0.20 + 0.14 * Math.sin(u * Math.PI)) * (1.0 - 0.68 * u));
    const collarR = Rmax * (1.18 - 0.48 * u);

    if (tipY >= yTop - 0.004) {
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
        const su = clamp((yTop - y) / Math.max(1e-4, yTop - tipCenterY), 0, 1);
        const cone = collarR * Math.exp(-su * 2.9);
        radiusProfile[iv] = smax(cone, tipR * (0.72 + 0.28 * su), tipR * 0.48);
      }
    }
    bulbR = tipR;
    yBulbCenter = tipCenterY;
  } else {
    let bulbVert: number;
    let collarR: number;
    let rNeck: number;
    let pinchSharp = 0;
    let sPinch = 0.54;
    let flareDecay = 2.9;

    if (stage === 'growing') {
      const g = clamp(grow, 0, 1);
      // TRUE ZERO-POP emergence: bulbR grows with gentle finite slope (g^0.88) from 0.000 right at the
      // visible ice underside (-0.013), eliminating any sudden hemisphere pop-in when crossing the bottom edge!
      bulbR = Rmax * Math.pow(g, 0.88);
      bulbVert = bulbR * (1.06 + 0.16 * smoothstep(0.30, 1.0, g));
      const yBottomTarget = -0.013 * scale * (1.0 - smoothstep(0.0, 0.35, g)) - Rmax * (2.98 * Math.pow(g, 1.04));
      yBulbCenter = yBottomTarget + bulbVert;
      collarR = bulbR * (1.68 - 0.14 * g);
      const waistFactor = 0.90 - 0.28 * smoothstep(0.50, 1.0, g);
      rNeck = bulbR * waistFactor;
      pinchSharp = smoothstep(0.58, 1.0, g) * 0.18;
      sPinch = 0.54;
      flareDecay = 2.9;
    } else {
      // 'pinching': sugary berry-juice viscous gravity draw — fuller glossy filament & elongated teardrop stretch!
      const u = clamp(stageU, 0, 1);
      bulbR = Rmax * (1.0 - 0.08 * Math.sin(u * Math.PI * 0.85));
      bulbVert = Rmax * (1.22 + 0.24 * Math.sin(u * Math.PI * 0.80) + 0.04 * u);
      const sagDist = 3.55 * Rmax * Math.pow(u, 2.05);
      yBulbCenter = -1.76 * Rmax - sagDist;
      collarR = Rmax * (1.54 - 0.24 * u);
      // Sugary juice (moderate Ohnesorge viscosity) keeps a visibly thicker filament before final capillary snap!
      rNeck = Rmax * 0.62 * Math.pow(Math.max(0, 1.0 - u), 0.44);
      pinchSharp = 0.18 + 0.78 * Math.pow(u, 1.45);
      sPinch = 0.54 + 0.24 * u;
      flareDecay = 2.9 + 1.5 * u;
    }

    const yBottom = yBulbCenter - bulbVert;
    pinchY = yBulbCenter + bulbVert * 1.14;

    if (yBottom >= yTop - 0.002) {
      return { visible: false, yBulbCenter, bulbR, pinchY };
    }

    for (let iv = 0; iv <= PENDANT_SEG_V; iv++) {
      const lin = iv / PENDANT_SEG_V;
      const s = lin < 0.7 ? lin : 0.7 + 0.3 * Math.sin(((lin - 0.7) / 0.3) * Math.PI * 0.5);
      const y = yTop + (yBottom - yTop) * s;
      yProfile[iv] = y;

      if (iv === PENDANT_SEG_V) {
        radiusProfile[iv] = 0;
        continue;
      }

      if (y <= yBulbCenter) {
        const t = clamp((yBulbCenter - y) / Math.max(1e-4, bulbVert), 0, 1);
        radiusProfile[iv] = bulbR * Math.sqrt(Math.max(0, 1.0 - t * t));
        continue;
      }

      const sUpper = clamp((yTop - y) / Math.max(1e-4, yTop - yBulbCenter), 0, 1);
      const collarFlare = collarR * Math.exp(-sUpper * flareDecay);
      const dyAbove = (y - yBulbCenter) / Math.max(1e-4, bulbVert * 1.16);
      const bulbUpper = dyAbove < 1.0 ? bulbR * Math.sqrt(Math.max(0, 1.0 - dyAbove * dyAbove)) : 0;

      const waistWidth = 0.32 - 0.08 * pinchSharp;
      const pinchDip = 1.0 - pinchSharp * Math.exp(-Math.pow((sUpper - sPinch) / waistWidth, 2.0));
      const filament = Math.max(0.004 * Rmax, rNeck * Math.max(0.05, pinchDip));
      const kCollar = Math.max(0.004 * Rmax, rNeck * 0.50);
      const kBulb = Math.max(0.004 * Rmax, rNeck * 0.46);

      const body = smax(collarFlare, filament, kCollar);
      radiusProfile[iv] = smax(body, bulbUpper, kBulb);
    }
  }

  const stride = PENDANT_SEG_U + 1;
  for (let iv = 0; iv <= PENDANT_SEG_V; iv++) {
    const r = radiusProfile[iv];
    const y = yProfile[iv];

    const ivPrev = Math.max(0, iv - 1);
    const ivNext = Math.min(PENDANT_SEG_V, iv + 1);
    const dr = radiusProfile[ivNext] - radiusProfile[ivPrev];
    const dy = yProfile[ivNext] - yProfile[ivPrev];
    let nr = -dy;
    let ny = dr;
    if (iv === PENDANT_SEG_V) {
      nr = 0;
      ny = -1;
    } else {
      const nLen = Math.hypot(nr, ny) || 1;
      nr /= nLen;
      ny /= nLen;
    }

    for (let iu = 0; iu <= PENDANT_SEG_U; iu++) {
      const ang = iu === PENDANT_SEG_U ? 0 : (iu / PENDANT_SEG_U) * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const o = (iv * stride + iu) * 3;
      pos[o] = ca * r;
      pos[o + 1] = y;
      pos[o + 2] = sa * r;

      norm[o] = ca * nr;
      norm[o + 1] = ny;
      norm[o + 2] = sa * nr;
    }
  }

  posAttr.needsUpdate = true;
  normAttr.needsUpdate = true;
  geo.computeBoundingSphere();
  return { visible: true, yBulbCenter, bulbR, pinchY };
}

export function createWaterDropSystem(seed: number, initialMode: DropMode = 'minimal'): WaterDropSystem {
  const disposables: Array<{ dispose(): void }> = [];
  let dropMode: DropMode = initialMode;

  const uniforms: WaterDropUniforms = {
    uSceneTex: { value: null },
    uDropFieldTex: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 720) },
    uTime: { value: 0 },
  };

  // === PASS 6a: INSTANCED LIQUID METABALL KERNEL SPLATS ===
  const baseQuad = new THREE.PlaneGeometry(1, 1);
  const instGeo = new THREE.InstancedBufferGeometry();
  instGeo.index = baseQuad.index;
  instGeo.attributes.position = baseQuad.attributes.position;

  const centersArr = new Float32Array(TOTAL_METABALLS * 3);
  const normalsArr = new Float32Array(TOTAL_METABALLS * 3);
  const paramsArr = new Float32Array(TOTAL_METABALLS * 4);
  const motionArr = new Float32Array(TOTAL_METABALLS * 2);

  const centersAttr = new THREE.InstancedBufferAttribute(centersArr, 3);
  const normalsAttr = new THREE.InstancedBufferAttribute(normalsArr, 3);
  const paramsAttr = new THREE.InstancedBufferAttribute(paramsArr, 4);
  const motionAttr = new THREE.InstancedBufferAttribute(motionArr, 2);
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

  // === PASS 6c: 3D BOTTOM-RIM HANGING PENDANT DROPS + 3D MELTED SYRUP GLAZE ON STICK ===
  const pendantGroup = new THREE.Group();
  const stickMelt = createStickMeltOverlay(uniforms, seed);
  pendantGroup.add(stickMelt.mesh);
  disposables.push(stickMelt);

  const pendantMat = createPendantDropMaterial(uniforms, 0.060, 0.56);
  // Pure unit sphere so detached fallMesh matches pinching bulb radius 1:1 with zero size jump!
  const fallGeo = new THREE.SphereGeometry(1, 24, 18);
  disposables.push(pendantMat, fallGeo);

  // === PERSISTENT 2D SURFACE WETNESS & FROST-ROUGHNESS FIELD ===
  const wetnessGrid = new Float32Array(WET_U * WET_V);
  const roughGrid = new Float32Array(WET_U * WET_V);
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
      vNorm = 0.03 + rand() * 0.91;
      const p = rand();
      initRadius = 0.008 + Math.pow(p, 2.25) * 0.031;
    } else {
      const isFront = rand() < 0.88;
      uNorm = isFront ? ((rand() - 0.5) * 0.44 + 1) % 1 : 0.5 + (rand() - 0.5) * 0.36;
      vNorm = 0.04 + rand() * 0.90;
      const p = rand();
      initRadius = 0.007 + Math.pow(p, 2.45) * 0.025;
    }

    drops.push({
      uNorm,
      vNorm,
      initU: uNorm,
      initV: vNorm,
      radius: initRadius,
      initRadius,
      maxRadius: 0.048 + rand() * 0.014,
      growRate: 0.00045 + rand() * 0.00125,
      velV: 0,
      velU: 0,
      sliding: false,
      pinBias: 0.88 + rand() * 0.44,
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

  // Hero prominent rim droplets + a few plump upper-face drops poised to break free naturally within seconds!
  if (drops.length > 5) {
    drops[0].uNorm = drops[0].initU = 0.754;
    drops[0].vNorm = drops[0].initV = 0.705;
    drops[0].radius = drops[0].initRadius = 0.042;
    drops[0].pinBias = 1.45; // iconic pinned heavy rim drop

    drops[1].uNorm = drops[1].initU = 0.246;
    drops[1].vNorm = drops[1].initV = 0.485;
    drops[1].radius = drops[1].initRadius = 0.034;
    drops[1].pinBias = 1.35;

    // 4 poised upper-body droplets that naturally unpin in staggered bursts during the first few seconds!
    drops[2].uNorm = drops[2].initU = 0.915;
    drops[2].vNorm = drops[2].initV = 0.78;
    drops[2].radius = drops[2].initRadius = 0.0315;
    drops[2].pinBias = 0.86;

    drops[3].uNorm = drops[3].initU = 0.095;
    drops[3].vNorm = drops[3].initV = 0.72;
    drops[3].radius = drops[3].initRadius = 0.0305;
    drops[3].pinBias = 0.90;

    drops[4].uNorm = drops[4].initU = 0.965;
    drops[4].vNorm = drops[4].initV = 0.62;
    drops[4].radius = drops[4].initRadius = 0.0295;
    drops[4].pinBias = 0.92;

    drops[5].uNorm = drops[5].initU = 0.165;
    drops[5].vNorm = drops[5].initV = 0.81;
    drops[5].radius = drops[5].initRadius = 0.029;
    drops[5].pinBias = 0.94;
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

  // 2 restrained, slow-forming bottom-rim hanging pendant sites (most meltwater drains down the wooden stick!)
  const pendantSpecs: Array<{
    anchorU: number;
    anchorV: number;
    initStage: PendantStage;
    initGrow: number;
    growRate: number;
    scale: number;
    dormantDur: number;
  }> = [
    // Hero bottom-left drop (poised at t=0 like reference.jpg, then long calm pauses between rare drops!)
    { anchorU: 0.875, anchorV: 0.016, initStage: 'growing', initGrow: 0.91, growRate: 0.018, scale: 1.04, dormantDur: 7.5 },
    // Subtle smaller bottom-right bead (rare & restrained so the stick carries most of the melt!)
    { anchorU: 0.108, anchorV: 0.016, initStage: 'growing', initGrow: 0.44, growRate: 0.013, scale: 0.66, dormantDur: 11.5 },
  ];

  const pRand = mulberry32(seed * 613 + 41);
  const pendants: PendantDrop[] = pendantSpecs.map((spec, idx) => {
    const jitterU = seed === 1 ? 0 : (pRand() - 0.5) * 0.04;
    const initStage: PendantStage = seed === 1 ? spec.initStage : idx < 2 ? 'growing' : 'dormant';
    const initGrow = seed === 1 ? spec.initGrow : initStage === 'growing' ? 0.35 + pRand() * 0.55 : 0.0;
    const neckGeo = createPendantLatheGeometry();
    const neckMesh = new THREE.Mesh(neckGeo, pendantMat);
    neckMesh.name = `pendant-neck-${idx}`;
    pendantGroup.add(neckMesh);

    const fallMesh = new THREE.Mesh(fallGeo, pendantMat);
    fallMesh.visible = false;
    fallMesh.name = `pendant-fall-${idx}`;
    pendantGroup.add(fallMesh);

    disposables.push(neckGeo);

    return {
      anchorU: (spec.anchorU + jitterU + 1) % 1,
      anchorV: spec.anchorV,
      stage: initStage,
      initStage,
      grow: initGrow,
      initGrow,
      stageTime: 0,
      dormantDuration: spec.dormantDur,
      pinchDuration: 0.72,
      recoilDuration: 0.40,
      growRate: spec.growRate,
      scale: spec.scale,
      neckGeo,
      neckMesh,
      fallMesh,
      fallActive: false,
      fallTime: 0,
      fallPos: new THREE.Vector3(),
      fallVelY: 0,
      fallR: 0.04 * spec.scale,
      recoilStartY: -0.08 * spec.scale,
    };
  });

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
            // Momentum conservation + bursty liquid surge when absorbing another drop!
            big.velV = Math.max(big.velV, small.velV) + (0.018 + massRatio * 0.048);
            // Gentle bounded lateral nudge toward absorbed drop (never violent horizontal whip!)
            big.velU = clamp(big.velU * (1 - massRatio) + small.velU * massRatio + du * 0.08, -0.025, 0.025);
            if (big.radius > 0.029 || a.sliding || b.sliding) {
              big.sliding = true;
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
      p.stage = p.initStage;
      p.grow = p.initGrow;
      p.stageTime = 0;
      p.fallActive = false;
      p.fallTime = 0;
      p.fallVelY = 0;
      p.fallMesh.visible = false;
    }
    resetMinimalDrops();
    stickMelt.uniforms.uIceBottomY.value = POPSICLE.yBottom;
    stickMelt.uniforms.uStickWetness.value = 0.0;
    stickMelt.uniforms.uMelt.value = 0.0;
    hasInitialized = false;
  }

  function stepLiquidPhysics(
    state: MeltFieldState,
    ice: PopsicleIceSystem,
    film: LiquidFilmSystem,
    dt: number,
    meltSpeedMul: number,
    updatePendants: boolean,
  ) {
    const meltRate = (1.0 + state.melt * 2.1) * meltSpeedMul;

    // 1. Gently evaporate/level surface wetness memory over ~12 seconds
    const wetDecay = Math.exp(-dt * 0.085);
    for (let k = 0; k < wetnessGrid.length; k++) {
      if (wetnessGrid[k] > 0.001) wetnessGrid[k] *= wetDecay;
      else wetnessGrid[k] = 0;
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
          d.radius = 0.0042;
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

      // Slow condensation swelling (gentle — beads swell & merge cohesively rather than flooding down linearly)
      d.radius = Math.min(d.maxRadius, d.radius + d.growRate * 0.65 * dt * meltRate * heatBoost);

      // === STICK-SLIP VISCOUS PINNING ===
      // Higher static threshold keeps 92%+ of beads calmly clinging; only heavy merged drops or pointer-warmed
      // drops break free and ooze viscously downward, dumping syrup straight into the shared liquid film!
      const roughPin = 0.84 + roughHere * 0.44;
      const wetLubrication = 1.0 - wetEff * 0.52;
      const heatLubrication = 1.0 / (1.0 + liveHeat * 0.65 + localHeat * 0.40);

      const breakFreeRadius = 0.0365 * d.pinBias * roughPin * wetLubrication * heatLubrication;
      const rePinRadius = 0.0255 * d.pinBias * (0.86 + roughHere * 0.34) * (1.0 - wetEff * 0.38);

      if (!d.sliding) {
        if (d.radius >= breakFreeRadius) {
          d.sliding = true;
          d.velV = 0.012 + (d.radius - breakFreeRadius) * 1.6;
          d.velU = 0;
          d.runArcLen = 0;
          d.trailDistAccum = 0;
        }
      } else {
        // Thick, syrupy, viscous berry-melt creep (slower & weightier than rain on smooth glass!)
        const massDrive = Math.max(0, d.radius - rePinRadius * 0.70) * 2.5 * (1.0 + wetEff * 1.8) * (1.0 + liveHeat * 1.4);
        const frostDrag = (0.55 + roughHere * 1.45) * (1.0 - wetEff * 0.60);
        d.velV += (massDrive - d.velV * (1.6 + frostDrag * 2.4)) * dt;
        d.velV = clamp(d.velV, 0, 0.16 * meltRate * (1.0 + liveHeat * 0.8));

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
        const stepV = d.velV * dt;
        const stepU = d.velU * dt;

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
          const volLoss = count * trailR * trailR * trailR * 0.055 * dryLossFactor;
          d.radius = Math.max(0.022, Math.cbrt(Math.max(1e-8, d.radius ** 3 - volLoss)));
        }

        if ((d.radius <= rePinRadius && d.velV < 0.012) || (d.velV < 0.003 && d.radius < breakFreeRadius * 0.92)) {
          d.sliding = false;
          d.velV = 0;
          d.velU = 0;
        }
      }

      if (d.wobble > 0.001) {
        d.wobble *= Math.exp(-dt * 5.0);
        d.wobblePhase += dt * 24.0;
      }

      if (d.vNorm < 0.032) {
        if (updatePendants) {
          let bestP = pendants[0];
          let bestDu = 999;
          for (let k = 0; k < pendants.length; k++) {
            const du = Math.abs(wrappedDeltaU(d.uNorm, pendants[k].anchorU));
            if (du < bestDu) {
              bestDu = du;
              bestP = pendants[k];
            }
          }
          if (bestP && bestP.stage === 'growing') {
            bestP.grow = Math.min(1.0, bestP.grow + (d.radius / 0.04) * 0.08);
          } else if (bestP && bestP.stage === 'dormant') {
            bestP.stageTime += 0.45;
          }
        }
        d.alive = false;
        d.radius = 0;
        d.velV = 0;
        d.velU = 0;
        d.sliding = false;
        d.respawnDelay = 2.5 + respawnRand() * 4.5;
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

  // Curated decorative eye-candy subset for 'minimal' mode:
  // ~140 SMALL, delicate sparkling droplets (NEVER large water globes!), distributed organically along
  // the silhouette rims & front face. Most stay calmly pinned; only a few gently glide down now and then!
  interface MinimalDrop {
    uNorm: number;
    vNorm: number;
    initU: number;
    initV: number;
    radius: number;
    initRadius: number;
    isRim: boolean;
    /** Countdown until this small droplet occasionally breaks pinning for a brief gentle glide */
    slipTimer: number;
    initSlipTimer: number;
    slipping: boolean;
    slipRemain: number;
    velV: number;
    velU: number;
    pos: THREE.Vector3;
    normal: THREE.Vector3;
  }

  const minRand = mulberry32(seed * 733 + 109);
  const MINIMAL_DROP_COUNT = 246;
  const BOTTOM_POOL_BEADS = 30;
  const minimalDrops: MinimalDrop[] = [];
  for (let i = 0; i < MINIMAL_DROP_COUNT; i++) {
    const isBottomPool = i >= MINIMAL_DROP_COUNT - BOTTOM_POOL_BEADS;
    const isRim = !isBottomPool && i < Math.floor((MINIMAL_DROP_COUNT - BOTTOM_POOL_BEADS) * 0.50);
    let uNorm: number;
    let vNorm: number;
    let radius: number;
    let initSlipTimer: number;
    if (isBottomPool) {
      // Sparkling tiny sticky pooling micro-beads clinging right along the swollen bottom rim (matches reference close-up!)
      const side = i % 2 === 0 ? 1 : -1;
      const uSigned = side * (0.058 + minRand() * 0.21);
      uNorm = (uSigned + 1) % 1;
      vNorm = 0.008 + minRand() * 0.036;
      radius = 0.0056 + Math.pow(minRand(), 1.65) * 0.0092;
      initSlipTimer = 9999; // stays calmly pooled on the sticky bottom lip
    } else if (isRim) {
      const side = i % 2 === 0 ? 0.25 : 0.75;
      const frontBias = side === 0.25 ? -0.022 : 0.022;
      uNorm = (side + frontBias + (minRand() - 0.5) * 0.095 + 1) % 1;
      vNorm = 0.04 + minRand() * 0.91;
      radius = 0.0052 + Math.pow(minRand(), 1.82) * 0.0104;
      initSlipTimer = 4.0 + minRand() * 62.0;
    } else {
      uNorm = ((minRand() - 0.5) * 0.45 + 1) % 1;
      vNorm = 0.05 + minRand() * 0.89;
      radius = 0.0052 + Math.pow(minRand(), 1.82) * 0.0104;
      initSlipTimer = 4.0 + minRand() * 62.0;
    }
    minimalDrops.push({
      uNorm,
      vNorm,
      initU: uNorm,
      initV: vNorm,
      radius,
      initRadius: radius,
      isRim: isRim || isBottomPool,
      slipTimer: initSlipTimer,
      initSlipTimer,
      slipping: false,
      slipRemain: 0,
      velV: 0,
      velU: 0,
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

  function resetMinimalDrops() {
    for (const md of minimalDrops) {
      md.uNorm = md.initU;
      md.vNorm = md.initV;
      md.radius = md.initRadius;
      md.slipTimer = md.initSlipTimer;
      md.slipping = false;
      md.slipRemain = 0;
      md.velV = 0;
      md.velU = 0;
    }
  }

  function stepMinimalDrops(state: MeltFieldState, ice: PopsicleIceSystem, film: LiquidFilmSystem, dt: number, meltSpeedMul: number) {
    const epsU = 1.0 / WET_U;
    const rate = (0.85 + state.melt * 1.4) * meltSpeedMul;

    for (let i = 0; i < minimalDrops.length; i++) {
      const md = minimalDrops[i];
      ice.sampleLiveSurface(md.uNorm, md.vNorm, md.pos, md.normal);

      const liveDist = Math.hypot(md.pos.x - state.pointerX, md.pos.y - state.pointerY);
      const liveHeat = state.pointerHeat * Math.exp(-(liveDist * liveDist) / 0.14);
      const localBoost = 1.0 + liveHeat * 6.5;

      // Very gentle slow condensation swell (capped strictly small!)
      md.radius = Math.min(0.0168, md.radius + 0.00018 * dt * rate * localBoost);

      if (!md.slipping) {
        md.slipTimer -= dt * rate * localBoost;
        if (md.slipTimer <= 0) {
          md.slipping = true;
          // Brief organic glide distance (10%-28% of popsicle height) before calmly re-pinning!
          md.slipRemain = 0.10 + ((i * 0.37) % 0.18);
          md.velV = 0.022 + ((i * 0.19) % 0.024);
          md.velU = 0;
        }
      } else {
        const roughL = sampleGrid(roughGrid, md.uNorm - epsU * 1.5, md.vNorm);
        const roughR = sampleGrid(roughGrid, md.uNorm + epsU * 1.5, md.vNorm);
        const steerU = -(roughR - roughL) * 0.018;
        md.velU += (steerU - md.velU * 5.0) * dt;
        md.velU = clamp(md.velU, -md.velV * 0.22, md.velV * 0.22);

        const stepV = md.velV * dt * (1.0 + liveHeat * 1.2);
        md.vNorm -= stepV;
        md.uNorm = (md.uNorm + md.velU * dt + 1) % 1;
        md.slipRemain -= stepV;

        // Subtly feed wet gloss into the underlying liquid film along its quiet path
        film.deposit(md.uNorm, md.vNorm, stepV * 0.95, 1);

        if (md.vNorm < 0.035) {
          // Reached bottom rim -> calmly respawn as a tiny fresh dew bead higher up
          md.vNorm = 0.62 + ((i * 0.6180339) % 0.30);
          md.radius = 0.0052;
          md.slipping = false;
          md.velV = 0;
          md.velU = 0;
          md.slipTimer = 10.0 + ((i * 1.73) % 36.0);
        } else if (md.slipRemain <= 0) {
          // Calmly re-pin in place and rest for a while!
          md.slipping = false;
          md.velV = 0;
          md.velU = 0;
          md.slipTimer = 9.0 + ((i * 2.17) % 38.0);
        }
      }
    }
  }

  function update(
    state: MeltFieldState,
    ice: PopsicleIceSystem,
    film: LiquidFilmSystem,
    dt: number,
    meltSpeedMul: number,
  ) {
    uniforms.uTime.value = state.time;

    if (!hasInitialized) {
      runCoalescence(ice, 0, true);
      hasInitialized = true;
    }

    const meltRate = (1.0 + state.melt * 2.1) * meltSpeedMul;
    const activeIceScale = clamp(1.0 - smoothstep(0.75, 0.98, state.melt), 0, 1);

    if (dt > 0) {
      if (dropMode === 'full') {
        stepLiquidPhysics(state, ice, film, dt, meltSpeedMul, true);
      } else if (dropMode === 'minimal') {
        stepMinimalDrops(state, ice, film, dt, meltSpeedMul);
      }

      // Feed real bottom drainage from the 2D viscous liquid film PDE directly into the nearest hanging pendant drops!
      for (let iu = 0; iu < FILM_U; iu++) {
        const q = film.bottomFlux[iu];
        if (q <= 0.0001) continue;
        const uNorm = (iu + 0.5) / FILM_U;
        let bestP = pendants[0];
        let bestDu = 999;
        for (let k = 0; k < pendants.length; k++) {
          const du = Math.abs(wrappedDeltaU(uNorm, pendants[k].anchorU));
          if (du < bestDu) {
            bestDu = du;
            bestP = pendants[k];
          }
        }
        if (bestP && bestP.stage === 'growing') {
          // Gentle capped flux feed (most drainage goes to the wooden stick; prevents sudden drop pop-in!)
          bestP.grow = Math.min(1.0, bestP.grow + Math.min(0.018 * dt, q * 0.028));
        } else if (bestP && bestP.stage === 'dormant') {
          bestP.stageTime += Math.min(0.12 * dt, q * 0.18);
        }
      }
    }

    // Update 3D melted-ice glossy syrup rivulets on the birch wooden stick!
    // Starts cleanly dry at t = 0 (like reference.jpg) and creeps organically down the wood as ice melts!
    const liveStickWet = clamp(
      Math.max(film.stickWetness * 1.15, smoothstep(0.012, 0.50, state.melt) * 0.96),
      0,
      1,
    );
    stickMelt.uniforms.uIceBottomY.value = POPSICLE.yBottom + clamp(state.melt, 0, 1) * 0.14;
    stickMelt.uniforms.uStickWetness.value = liveStickWet;
    stickMelt.uniforms.uMelt.value = state.melt;

    // === PACK SURFACE DROPS & TRAILS ACCORDING TO DROP MODE ('minimal' | 'full' | 'off') ===
    let slot = 0;

    if (dropMode === 'minimal') {
      // Render ~216 delicate, strictly SMALL sparkling eye-candy droplets (occasional gentle glides!)
      const minimalFade = clamp(1.0 - smoothstep(0.32, 0.78, state.melt), 0.18, 1.0);
      for (let i = 0; i < minimalDrops.length; i++) {
        const md = minimalDrops[i];
        const o2 = slot * 2;
        const o3 = slot * 3;
        const o4 = slot * 4;
        slot++;

        const effR = md.radius * activeIceScale * minimalFade;
        if (effR < 0.0014) {
          paramsArr[o4] = 0;
          continue;
        }

        ice.sampleLiveSurface(md.uNorm, md.vNorm, md.pos, md.normal);
        const speedNorm = md.slipping ? clamp(md.velV * 8.0, 0, 0.65) : 0;
        const aspectY = 1.04 + speedNorm * 0.22;
        const tilt = md.slipping ? clamp(Math.atan2(md.velU * 1.4, Math.max(0.01, md.velV)), -0.4, 0.4) : 0;

        centersArr[o3] = md.pos.x;
        centersArr[o3 + 1] = md.pos.y;
        centersArr[o3 + 2] = md.pos.z;

        normalsArr[o3] = md.normal.x;
        normalsArr[o3 + 1] = md.normal.y;
        normalsArr[o3 + 2] = md.normal.z;

        paramsArr[o4] = effR;
        paramsArr[o4 + 1] = aspectY;
        paramsArr[o4 + 2] = 0.98;
        paramsArr[o4 + 3] = md.isRim ? 0.34 : 0.25;

        motionArr[o2] = tilt;
        motionArr[o2 + 1] = 0;
      }
      // Zero out remaining metaball slots cleanly
      while (slot < TOTAL_METABALLS) {
        paramsArr[slot * 4] = 0;
        slot++;
      }
    } else if (dropMode === 'full') {
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        const o2 = slot * 2;
        const o3 = slot * 3;
        const o4 = slot * 4;
        slot++;

        if (!d.alive || d.radius * activeIceScale < 0.001) {
          paramsArr[o4] = 0;
          continue;
        }

        ice.sampleLiveSurface(d.uNorm, d.vNorm, d.pos, d.normal);

        const effR = d.radius * activeIceScale;
        const speedNorm = clamp(d.velV * 7.5, 0, 1);
        const aspectY = 1.03 + smoothstep(0.016, 0.044, effR) * 0.14 + speedNorm * 0.24;
        const tilt = d.sliding ? clamp(Math.atan2(d.velU * 1.4, Math.max(0.01, d.velV)), -0.65, 0.65) : 0;
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

        motionArr[o2] = tilt;
        motionArr[o2 + 1] = wobbleOsc;
      }

      for (let i = 0; i < trailPool.length; i++) {
        const tn = trailPool[i];
        const o2 = slot * 2;
        const o3 = slot * 3;
        const o4 = slot * 4;
        slot++;

        if (tn.life <= 0.01 || activeIceScale < 0.05) {
          paramsArr[o4] = 0;
          continue;
        }

        const age = 1.0 - tn.life;
        const breakupAmt = smoothstep(0.28, 0.72, age);
        const rpWave = Math.sin(tn.arcPhase * 0.85);
        const pinchFactor = 1.0 - breakupAmt * (0.45 - 0.55 * rpWave);
        const lifeFade = smoothstep(0.0, 0.22, tn.life);
        const effR = tn.baseRadius * clamp(pinchFactor, 0, 1.15) * lifeFade * activeIceScale;

        if (effR < 0.0018) {
          paramsArr[o4] = 0;
          continue;
        }

        ice.sampleLiveSurface(tn.uNorm, tn.vNorm, tn.pos, tn.normal);
        const residualPlump = tn.plumpness + breakupAmt * Math.max(0, rpWave) * 0.42;

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

        motionArr[o2] = 0;
        motionArr[o2 + 1] = 0;
      }
    } else {
      // 'off': zero surface metaball droplets
      while (slot < TOTAL_METABALLS) {
        paramsArr[slot * 4] = 0;
        slot++;
      }
    }

    centersAttr.needsUpdate = true;
    normalsAttr.needsUpdate = true;
    paramsAttr.needsUpdate = true;
    motionAttr.needsUpdate = true;

    // === UPDATE 3D RAYLEIGH-PLATEAU BOTTOM-RIM PENDANT DROPS (REAL-TIME PINCH-OFF & RECOIL!) ===
    const stickClearX = POPSICLE.stickWidth * 0.5 + POPSICLE.stickDepth * 0.19 * 0.7 + 0.055;
    for (let i = 0; i < pendants.length; i++) {
      const p = pendants[i];
      ice.sampleLiveSurface(p.anchorU, p.anchorV, tmpPos, tmpNorm);

      const clearOfStick = Math.abs(tmpPos.x) > stickClearX;
      // Seat drop directly beneath the thickest part of the bottom ice ridge (z * 0.22) so the upper
      // wetting collar merges cleanly behind the curved pink front lip with zero overlapping white halo!
      p.neckMesh.position.set(tmpPos.x, tmpPos.y + 0.014, tmpPos.z * 0.22);

      const effScale = p.scale * activeIceScale;
      const Rmax = 0.043 * effScale;

      if (dt > 0 && activeIceScale > 0.06 && clearOfStick) {
        const localHeat = sampleLocalHeat(tmpPos.x, tmpPos.y, state);
        const liveDist = Math.hypot(tmpPos.x - state.pointerX, tmpPos.y - state.pointerY);
        const liveHeat = state.pointerHeat * Math.exp(-(liveDist * liveDist) / 0.35);
        const heatFactor = 1.0 + localHeat * 2.6 + liveHeat * 4.2;

        if (p.stage === 'dormant') {
          p.stageTime += dt * (0.85 + state.melt * 1.2) * heatFactor;
          if (p.stageTime >= p.dormantDuration) {
            p.stage = 'growing';
            p.grow = 0;
            p.stageTime = 0;
          }
        } else if (p.stage === 'growing') {
          // Slow, silky-smooth melt-driven swelling from true zero (capped so drops NEVER lurch or pop!)
          const dGrow = Math.min(0.065 * dt, p.growRate * meltRate * heatFactor * dt);
          p.grow += dGrow;
          if (p.grow >= 1.0) {
            p.grow = 1.0;
            p.stage = 'pinching';
            p.stageTime = 0;
          }
        } else if (p.stage === 'pinching') {
          // Real-time sugary-juice gravity draw & capillary pinch (~0.72s real time!)
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
          }
        } else if (p.stage === 'recoiling') {
          // Viscous damped capillary snap-back of the residual upper rim cone (~0.40s real time!)
          p.stageTime += dt;
          if (p.stageTime >= p.recoilDuration) {
            p.stage = 'dormant';
            p.stageTime = 0;
            p.grow = 0;
            p.dormantDuration = 7.5 + ((i * 3.1 + state.time * 0.37) % 5.5);
          }
        }
      }

      const stageU =
        p.stage === 'pinching'
          ? clamp(p.stageTime / p.pinchDuration, 0, 1)
          : p.stage === 'recoiling'
            ? clamp(p.stageTime / p.recoilDuration, 0, 1)
            : 0;
      const evalRes = updatePendantLatheGeometry(p.neckGeo, p.stage, p.grow, stageU, effScale, p.recoilStartY);
      p.neckMesh.visible = activeIceScale > 0.05 && clearOfStick && evalRes.visible;

      if (p.fallActive && p.fallMesh.visible) {
        p.fallTime += dt;
        const fallDist = p.fallVelY * p.fallTime + 0.5 * 8.2 * p.fallTime * p.fallTime;
        p.fallMesh.position.set(p.fallPos.x, p.fallPos.y - fallDist, p.fallPos.z);

        // Exact volume-preserving sugary-juice elongation rebound matching elongated pinch belly at t = 0!
        const osc = Math.exp(-p.fallTime * 5.2) * Math.cos(p.fallTime * 15.0) * 0.26;
        const sy = 1.0 + osc;
        const sxz = 1.0 / Math.sqrt(Math.max(0.5, sy));
        p.fallMesh.scale.set(p.fallR * sxz, p.fallR * sy, p.fallR * sxz);

        if (p.fallMesh.position.y < -2.6) {
          p.fallActive = false;
          p.fallMesh.visible = false;
        }
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
    reset,
    update,
    dispose,
  };
}
