import * as THREE from 'three';
import { clamp, mulberry32, smoothstep } from './rng';
import { getSharedNoise3DTexture } from './noise3d';
import {
  DEFAULT_BOTTOM_POOL,
  DEFAULT_INITIAL_MELT,
  evaluatePopsicleVertex,
  getMeltBounds,
  iceContainmentDepth,
  mapPopsicleVNorm,
  MeltFieldState,
  POPSICLE,
  prepareProfileFrame,
  prepareProfileRow,
} from './shape';
import { DEFAULT_RECIPE, PopsicleRecipe, resolveOpticalPalette } from './recipe';

export interface IceUniforms {
  uBgTex: { value: THREE.Texture | null };
  uBgBlur1: { value: THREE.Texture | null };
  uBgBlur2: { value: THREE.Texture | null };
  uBgBlur3: { value: THREE.Texture | null };
  uBubblesTex: { value: THREE.Texture | null };
  uFilmTex: { value: THREE.Texture | null };
  uRimeTex: { value: THREE.Texture | null };
  uInteriorZ: { value: THREE.Texture | null };
  uBackIceZ: { value: THREE.Texture | null };
  uNoise3D: { value: THREE.Data3DTexture };
  uResolution: { value: THREE.Vector2 };
  uTime: { value: number };
  uMelt: { value: number };
  uSlideY: { value: number };
  uFrost: { value: number };
  uSeedOffset: { value: number };
  // Custom base (water vs opaque coconut) & max-2 flavor optical uniforms
  uOpacity: { value: number };
  uIsDual: { value: number };
  uSigmaA: { value: THREE.Vector3 };
  uCoreA: { value: THREE.Vector3 };
  uMidA: { value: THREE.Vector3 };
  uDeepA: { value: THREE.Vector3 };
  uCreamAlbA: { value: THREE.Vector3 };
  uCreamSssA: { value: THREE.Vector3 };
  uCreamDeepA: { value: THREE.Vector3 };
  uSigmaB: { value: THREE.Vector3 };
  uCoreB: { value: THREE.Vector3 };
  uMidB: { value: THREE.Vector3 };
  uDeepB: { value: THREE.Vector3 };
  uCreamAlbB: { value: THREE.Vector3 };
  uCreamSssB: { value: THREE.Vector3 };
  uCreamDeepB: { value: THREE.Vector3 };
  uStainCol: { value: THREE.Vector3 };
}

export interface PopsicleIceSystem {
  iceMesh: THREE.Mesh;
  backZMesh: THREE.Mesh;
  bubblesMesh: THREE.InstancedMesh;
  solidWorldZMat: THREE.ShaderMaterial;
  uniforms: IceUniforms;
  setRecipe(recipe: PopsicleRecipe): void;
  update(state: MeltFieldState, bubbleDensity: number, forceMesh?: boolean): void;
  sampleLiveSurface(uNorm: number, vNorm: number, outPos: THREE.Vector3, outNormal: THREE.Vector3): void;
  dispose(): void;
}

function createCameraDepthMaterial(tag: number, side: THREE.Side): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side,
    depthTest: true,
    depthWrite: true,
    uniforms: {
      uTag: { value: tag },
    },
    vertexShader: /* glsl */ `
      varying float vCamDepth;
      void main() {
        vec4 mvPos = viewMatrix * modelMatrix * vec4(position, 1.0);
        vCamDepth = -mvPos.z;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTag;
      varying float vCamDepth;
      void main() {
        gl_FragColor = vec4(vCamDepth, uTag, 0.0, 1.0);
      }
    `,
  });
}

/**
 * Photorealistic backlit strawberry-juice popsicle ice shader (v3):
 * - Warm sunlit coral-apricot translucent center -> rich saturated crimson-ruby edges & base
 * - Clean organic cloudy frozen-juice density (no synthetic worm patterns) + micro-crystalline sparkle
 * - Dedicated crisp refracted internal air micro-bubbles layered INSIDE the coral ice (never punching white holes!)
 * - Delicate silky twin vertical flute highlight hairlines + wet thawing micro-ripples
 */
function createOpticalIceMaterial(initialRecipe: PopsicleRecipe): { material: THREE.ShaderMaterial; uniforms: IceUniforms } {
  const pal = resolveOpticalPalette(initialRecipe);
  const uniforms: IceUniforms = {
    uBgTex: { value: null },
    uBgBlur1: { value: null },
    uBgBlur2: { value: null },
    uBgBlur3: { value: null },
    uBubblesTex: { value: null },
    uFilmTex: { value: null },
    uRimeTex: { value: null },
    uInteriorZ: { value: null },
    uBackIceZ: { value: null },
    uNoise3D: { value: getSharedNoise3DTexture() },
    uResolution: { value: new THREE.Vector2(1280, 720) },
    uTime: { value: 0 },
    uMelt: { value: DEFAULT_INITIAL_MELT },
    uSlideY: { value: 0 },
    uFrost: { value: 0.58 },
    uSeedOffset: { value: 0 },
    uOpacity: { value: pal.opacity },
    uIsDual: { value: pal.isDual ? 1.0 : 0.0 },
    uSigmaA: { value: new THREE.Vector3(...pal.sigmaA) },
    uCoreA: { value: new THREE.Vector3(...pal.coreA) },
    uMidA: { value: new THREE.Vector3(...pal.midA) },
    uDeepA: { value: new THREE.Vector3(...pal.deepA) },
    uCreamAlbA: { value: new THREE.Vector3(...pal.creamAlbedoA) },
    uCreamSssA: { value: new THREE.Vector3(...pal.creamSssA) },
    uCreamDeepA: { value: new THREE.Vector3(...pal.creamDeepA) },
    uSigmaB: { value: new THREE.Vector3(...pal.sigmaB) },
    uCoreB: { value: new THREE.Vector3(...pal.coreB) },
    uMidB: { value: new THREE.Vector3(...pal.midB) },
    uDeepB: { value: new THREE.Vector3(...pal.deepB) },
    uCreamAlbB: { value: new THREE.Vector3(...pal.creamAlbedoB) },
    uCreamSssB: { value: new THREE.Vector3(...pal.creamSssB) },
    uCreamDeepB: { value: new THREE.Vector3(...pal.creamDeepB) },
    uStainCol: { value: new THREE.Vector3(...pal.stainColor) },
  };

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    side: THREE.FrontSide,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      in float aHang;
      out vec3 vWorldPos;
      out vec3 vWorldNormal;
      out vec2 vUv;
      out float vHang;
      out float vCamDepth;

      void main() {
        vUv = uv;
        vHang = aHang;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec4 mvPos = viewMatrix * wp;
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vCamDepth = -mvPos.z;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler3D;

      uniform sampler2D uBgTex;
      uniform sampler2D uBgBlur1;
      uniform sampler2D uBgBlur2;
      uniform sampler2D uBgBlur3;
      uniform sampler2D uBubblesTex;
      uniform sampler2D uFilmTex;
      uniform sampler2D uRimeTex;
      uniform sampler2D uInteriorZ;
      uniform sampler2D uBackIceZ;
      uniform sampler3D uNoise3D;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform float uMelt;
      uniform float uSlideY;
      uniform float uFrost;
      uniform float uSeedOffset;
      uniform float uOpacity;
      uniform float uIsDual;
      uniform vec3 uSigmaA;
      uniform vec3 uCoreA;
      uniform vec3 uMidA;
      uniform vec3 uDeepA;
      uniform vec3 uCreamAlbA;
      uniform vec3 uCreamSssA;
      uniform vec3 uCreamDeepA;
      uniform vec3 uSigmaB;
      uniform vec3 uCoreB;
      uniform vec3 uMidB;
      uniform vec3 uDeepB;
      uniform vec3 uCreamAlbB;
      uniform vec3 uCreamSssB;
      uniform vec3 uCreamDeepB;
      uniform vec3 uStainCol;

      in vec3 vWorldPos;
      in vec3 vWorldNormal;
      in vec2 vUv;
      in float vHang;
      in float vCamDepth;

      out vec4 fragColor;

      // Single-cycle hardware-trilinear 3D texture lookups replacing 15x 4-octave FBM & 54-iter Voronoi loops!
      // Channels: R = 2-oct FBM (period 6), G = independent 2-oct FBM (period 6),
      //           B = 3D Voronoi cell height (period 8), A = fine 2-oct detail noise (period 12)
      const float INV_P6 = 1.0 / 6.0;
      const float INV_P8 = 1.0 / 8.0;
      const float INV_P12 = 1.0 / 12.0;

      // Strict WebGL2/Metal/Adreno portable math helpers (no pow(negative,2.0), no inverted smoothstep, no zero normalize)
      float sq(float x) { return x * x; }
      float revStep(float hi, float lo, float x) { return 1.0 - smoothstep(lo, hi, x); }
      vec3 safeNorm(vec3 v) { return v * inversesqrt(max(dot(v, v), 1e-8)); }

      float fbm3Tex(vec3 p) {
        vec4 s = texture(uNoise3D, p * INV_P6);
        return s.r * 0.72 + s.a * 0.28;
      }

      float vnoiseTex(vec3 p) {
        return texture(uNoise3D, p * INV_P12).a;
      }

      // Fast deterministic 3D cell hash -> [0, 1]^3 for razor-sharp condensed-milk holes & micro-shards (zero loops!)
      vec3 hash33(vec3 p) {
        p = fract(p * vec3(0.1031, 0.1030, 0.0973));
        p += dot(p, p.yxz + 33.33);
        return fract((p.xxy + p.yxx) * p.zyx);
      }

      // Single-cell jittered 3D frozen air-pocket crater (organic chipped edges, directional cavity normal, NO cartoon white ring!)
      vec2 evalAirPocketCell(vec3 p, float invScale, float probBoost, float minR, float maxR, out vec3 outPitDir) {
        vec3 cell = floor(p);
        vec3 f = fract(p);
        vec3 h1 = hash33(cell);
        outPitDir = vec3(0.0);

        // Evaluate organic cluster density at the constant cell center so holes never half-clip across boundaries!
        vec3 cellWorld = (cell + 0.5) * invScale;
        float clusterN = texture(uNoise3D, (cellWorld * vec3(2.8, 2.4, 3.0) + vec3(uSeedOffset * 0.7, 1.3, -0.9)) * INV_P6).g;
        float fluteBias = exp(-sq((abs(cellWorld.x) - ${POPSICLE.fluteX.toFixed(4)}) / 0.10));
        float cellProb = clamp(smoothstep(0.26, 0.74, clusterN) * 0.60 + fluteBias * 0.28, 0.06, 0.88) * probBoost;
        if (h1.x > cellProb) return vec2(0.0);

        vec3 h2 = hash33(cell + 19.37);
        vec3 ctr = vec3(0.28) + h2 * 0.44;
        float rad = mix(minR, maxR, h1.y * h1.y);
        vec3 d = f - ctr;
        // Organic irregular chipped-ice cavity silhouette (gentle Z-stretch yields realistic varied surface cross-sections!)
        float chipWarp = (texture(uNoise3D, (p * 0.55 + vec3(h1.z * 3.1)) * INV_P12).a - 0.5) * 0.30;
        vec3 stretched = d * vec3(1.0 + (h1.z - 0.5) * 0.40, 1.0 + (h2.y - 0.5) * 0.36, 0.68);
        float dist = length(stretched) * (1.0 + chipWarp);
        if (dist > rad * 1.32) return vec2(0.0);

        float u = dist / max(rad, 1e-4);
        // Smooth concave bowl interior -> crisp micro-cavity shadow & wall slope
        float pit = revStep(1.0, 0.32, u);
        // Soft outer shoulder slope for directional key-light catch (NOT a uniform white halo!)
        float wallSlope = smoothstep(0.28, 0.88, u) * revStep(1.28, 0.92, u);
        outPitDir = d * inversesqrt(max(dot(d, d), 1e-6));
        return vec2(pit, wallSlope);
      }

      // Single-cell jittered 3D angular ice/sugar micro-shard (crisp flaky crystal splinters in organic frost drifts!)
      vec2 evalMicroShardCell(vec3 p, float invScale, float probBoost, float minSize, float maxSize) {
        vec3 cell = floor(p);
        vec3 f = fract(p);
        vec3 h1 = hash33(cell + 7.13);

        // Organic drifting frost-shard clouds across the whole paleta face (patches of dense crystal flecks + clean zones!)
        vec3 cellWorld = (cell + 0.5) * invScale;
        vec3 driftW = cellWorld * vec3(2.4, 1.9, 2.4) + vec3(-2.1 + uSeedOffset * 0.6, 0.9, 3.7);
        vec4 dSamp = texture(uNoise3D, driftW * INV_P6);
        float driftN = dSamp.r * 0.62 + dSamp.g * 0.38;
        float cellProb = clamp(pow(smoothstep(0.20, 0.72, driftN), 1.25) * 0.92 + 0.08, 0.08, 0.96) * probBoost;
        if (h1.x > cellProb) return vec2(0.0);

        vec3 h2 = hash33(cell + 41.91);
        vec3 ctr = vec3(0.27) + h2 * 0.46;
        vec3 d = f - ctr;

        float ang = h1.y * 6.2831853;
        float ca = cos(ang);
        float sa = sin(ang);
        vec3 dr = vec3(d.x * ca - d.y * sa, d.x * sa + d.y * ca, d.z);
        float baseS = mix(minSize, maxSize, h1.z);
        // Irregular angular ice-crystal flake / splinter proportions (generous Z depth so shards populate naturally on curved faces!)
        float elong = mix(1.15, 2.15, h2.x);
        vec3 q = abs(dr) / vec3(baseS * elong, baseS, min(0.24, baseS * 2.4));
        float facetD = (q.x + q.y + q.z) * 0.66 + max(q.x, max(q.y, q.z)) * 0.40;
        float mask = revStep(1.04, 0.52, facetD);
        // Varied translucency per shard: some faintly frosted in cream, some bright crisp white crystals on top!
        float intensity = mix(0.32, 1.12, h2.z * h2.z * 0.55 + h2.y * 0.45);
        return vec2(mask, intensity);
      }

      // Tactile thawing ice micro-relief + spatially varied frozen crystal roughness + baked 3D Voronoi slush beads!
      // Uses only 7 hardware texture3D fetches instead of 128 hashes + 54 nested Voronoi loop iterations (~12x faster!)
      vec3 perturbNormal(
        vec3 N,
        vec3 p,
        float glazeCover,
        float localFreezeRough,
        float sweatMask,
        float postThirdTex,
        out float microGrain,
        out float slushBump,
        out float slushCavity
      ) {
        vec3 sp = (p * vec3(9.5, 4.5, 9.5) + vec3(uSeedOffset, uTime * 0.04, 0.0)) * INV_P6;
        float eW = 0.008;
        float h0 = texture(uNoise3D, sp).r;
        float hx = texture(uNoise3D, sp + vec3(eW, 0.0, 0.0)).r;
        float hy = texture(uNoise3D, sp + vec3(0.0, eW, 0.0)).r;
        float hz = texture(uNoise3D, sp + vec3(0.0, 0.0, eW)).r;
        vec3 wetGrad = vec3(hx - h0, hy - h0, hz - h0) / 0.048;

        // Clean multi-scale wet porous ice-pebble relief emerging smoothly after 1/3 melt:
        // Keeps normals physically bounded (never chaotic white static!) so rich juicy color dominates
        // while tiny pebble crests catch crisp sparse 1-2px wet glints (matching real half-melted popsicles!).
        float earlySweat = (0.24 + 0.30 * smoothstep(0.14, 0.34, uMelt)) * sweatMask * (1.0 - glazeCover * 0.85);
        float deepSlush = postThirdTex * (0.95 - glazeCover * 0.16);
        float slushAmt = clamp(earlySweat + deepSlush, 0.0, 1.15);

        // Subtle organic eroded melt dimples (~8mm scale) — gentle undulation without big white blotches
        vec3 coarsePert = vec3(0.0);
        float coarseDimple = 0.5;
        if (postThirdTex > 0.005) {
          vec3 cp = (p * 26.0 + vec3(uSeedOffset * 1.9, -2.4, 1.3)) * INV_P6;
          float eD = 0.020;
          vec4 cd0 = texture(uNoise3D, cp);
          float cdX = texture(uNoise3D, cp + vec3(eD, 0.0, 0.0)).b;
          float cdY = texture(uNoise3D, cp + vec3(0.0, eD, 0.0)).b;
          float cdZ = texture(uNoise3D, cp + vec3(0.0, 0.0, eD)).b;
          coarsePert = vec3(cd0.b - cdX, cd0.b - cdY, cd0.b - cdZ) * 2.4;
          coarseDimple = cd0.b * 0.65 + cd0.g * 0.35;
        }

        // Primary porous icy-granita pebbles (~2.5mm scale — crisp tactile bumps & recessed wet pores!)
        vec3 medPert = vec3(0.0);
        float medCell = 0.5;
        if (postThirdTex > 0.005) {
          vec3 mp = (p * 62.0 + vec3(uSeedOffset * 2.7, 4.1, -1.9)) * INV_P8;
          float eM = 0.022;
          vec4 md0 = texture(uNoise3D, mp);
          float mdX = texture(uNoise3D, mp + vec3(eM, 0.0, 0.0)).b;
          float mdY = texture(uNoise3D, mp + vec3(0.0, eM, 0.0)).b;
          float mdZ = texture(uNoise3D, mp + vec3(0.0, 0.0, eM)).b;
          medPert = vec3(md0.b - mdX, md0.b - mdY, md0.b - mdZ) * 3.6;
          medCell = md0.b;
        }

        // Fine sparkling wet micro-pebbles (~1mm scale)
        vec3 cmP = (p * 116.0 + vec3(uSeedOffset * 1.3)) * INV_P8;
        float eC = 0.024;
        vec4 cm0 = texture(uNoise3D, cmP);
        float cmX = texture(uNoise3D, cmP + vec3(eC, 0.0, 0.0)).b;
        float cmY = texture(uNoise3D, cmP + vec3(0.0, eC, 0.0)).b;
        float cmZ = texture(uNoise3D, cmP + vec3(0.0, 0.0, eC)).b;
        vec3 cellPert = vec3(cm0.b - cmX, cm0.b - cmY, cm0.b - cmZ) * 3.2;

        vec4 cf = texture(uNoise3D, (p * 188.0 + vec3(uSeedOffset * 2.9)) * INV_P12);
        vec3 microFacetPert = vec3(cf.r - 0.5, cf.g - 0.5, cf.a - 0.5) * (0.16 * slushAmt);
        microGrain = clamp(mix(cf.a * 0.46 + cm0.b * 0.54, medCell * 0.56 + cm0.b * 0.30 + cf.a * 0.14, postThirdTex), 0.0, 1.0);
        slushBump = slushAmt * smoothstep(0.32, 0.90, microGrain);
        slushCavity = postThirdTex * clamp(
          revStep(0.50, 0.14, medCell) * 0.68 +
          revStep(0.46, 0.14, cm0.b) * 0.22 +
          revStep(0.46, 0.16, coarseDimple) * 0.20,
          0.0,
          1.0
        );

        float domeFrost = 1.0 + smoothstep(0.45, 1.05, p.y) * 0.45;
        // Damp sharp Voronoi blister relief on cold opaque milk shoulders so they stay velvety matte instead of bumpy plastic!
        float milkReliefDamp = 1.0 - smoothstep(0.76, 0.98, uOpacity) * 0.68;
        float freezeCrystalRelief = (0.022 + 0.125 * localFreezeRough) * uFrost * domeFrost * (1.0 - glazeCover * 0.72) * milkReliefDamp;
        vec3 pert =
          wetGrad * (0.028 + uMelt * 0.016) * (1.0 - glazeCover * 0.65) +
          coarsePert * (0.20 * postThirdTex) +
          medPert * (0.34 * postThirdTex) +
          cellPert * (freezeCrystalRelief + 0.18 * slushAmt * milkReliefDamp) +
          microFacetPert;

        pert -= N * dot(pert, N);
        // Clamp tangential perturbation magnitude so wet pebbles stay crisp & glossy without scrambling normals!
        float pertLen = length(pert);
        if (pertLen > 0.46) {
          pert *= 0.46 / pertLen;
        }
        return normalize(N - pert);
      }

      vec3 sampleFrostedBg(vec2 uv, float blurAmt) {
        vec2 cUv = clamp(uv, vec2(0.002), vec2(0.998));
        if (blurAmt <= 0.001) {
          return texture(uBgTex, cUv).rgb;
        }
        float lvl = clamp(blurAmt, 0.0, 1.0) * 3.0;
        if (lvl < 1.0) {
          return mix(texture(uBgTex, cUv).rgb, texture(uBgBlur1, cUv).rgb, lvl);
        }
        if (lvl < 2.0) {
          return mix(texture(uBgBlur1, cUv).rgb, texture(uBgBlur2, cUv).rgb, lvl - 1.0);
        }
        return mix(texture(uBgBlur2, cUv).rgb, texture(uBgBlur3, cUv).rgb, lvl - 2.0);
      }

      // Crisp backlit macro studio reflections: dark front fill so coral-ruby ice stays deeply saturated!
      vec3 evalMacroStudioReflection(vec3 R, float roughness) {
        vec3 r = normalize(R);
        vec3 col = vec3(0.06, 0.03, 0.03);
        float sharp = mix(1.0, 0.20, roughness);

        // Narrow twin vertical strip-lights (silky thin reflection ribbons!)
        float stripY = smoothstep(-0.90, -0.58, r.y) * revStep(0.92, 0.62, r.y);
        float wNarrow = 0.034 + roughness * 0.13;
        float leftStrip = exp(-sq((r.x + 0.56) / wNarrow));
        float rightStrip = exp(-sq((r.x - 0.56) / wNarrow));
        float stripZ = smoothstep(-0.18, 0.45, r.z);
        col += vec3(2.1, 1.95, 1.88) * (leftStrip + rightStrip) * stripY * stripZ * (0.35 + 0.85 * sharp);

        // Crisp grazing outer wall rim strip
        float rimStrip = exp(-sq((abs(r.x) - 0.89) / (0.048 + roughness * 0.12))) * stripY;
        col += vec3(2.25, 2.06, 1.98) * rimStrip * (0.42 + 0.78 * sharp);

        // Overhead curved dome softbox highlight
        float topBox = smoothstep(0.68 - roughness * 0.18, 0.94, r.y) *
                       exp(-sq(r.x / (0.38 + roughness * 0.22)));
        col += vec3(1.15, 1.02, 0.98) * topBox * (0.28 + 0.55 * sharp);

        return col;
      }

      void main() {
        vec2 screenUv = gl_FragCoord.xy / uResolution;
        vec3 N0 = normalize(vWorldNormal);

        // Camera-aligned horizontal studio basis so 360° turntable rotates the popsicle through fixed studio lights!
        vec3 camH = safeNorm(vec3(cameraPosition.x, 0.0, cameraPosition.z));
        vec3 camR = vec3(camH.z, 0.0, -camH.x);

        // === SAMPLE CONTINUOUS 2D VISCOUS LIQUID GLAZE FILM & FREEZER HOARFROST RIME ===
        vec4 filmSample = texture(uFilmTex, vUv);
        float filmH = filmSample.r;
        vec2 filmSlope = (filmSample.gb - 0.5) * 2.0;
        float wetMem = filmSample.a;
        float rimeRaw = texture(uRimeTex, vUv).r;

        // Multi-scale crystalline hoarfrost needles & tiny snowy crystal tufts (inspired by freezer-fresh macro!)
        vec4 rFine = texture(uNoise3D, (vWorldPos * 96.0 + vec3(uSeedOffset * 2.1)) * INV_P12);
        vec4 rMicro = texture(uNoise3D, (vWorldPos * 235.0 + vec3(-4.2, uSeedOffset * 3.7, 2.8)) * INV_P12);
        float rimeGrain = rFine.a * 0.48 + rMicro.a * 0.52;
        float frostScale = clamp(uFrost / 0.58, 0.25, 1.45);
        float rimeMaskPre = smoothstep(0.10, 0.64, rimeRaw * (0.86 + 0.26 * frostScale) + (rimeGrain - 0.5) * 0.42);

        // Sleek bottom-edge transparency band (keeps glowing cloudy pink rim & rich backlit body above,
        // while the thinning bottom meniscus turns crystal-clear like the drops breaking away from it!)
        float hangLiquid = smoothstep(0.08, 0.55, vHang);
        float meltClearGate = smoothstep(0.045, 0.18, uMelt) * (1.0 - rimeMaskPre * 0.92);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float N0dotV = clamp(dot(N0, V), 0.0, 1.0);
        float isMilkBase = smoothstep(0.76, 0.98, uOpacity);
        float bottomEdgeClear = revStep(0.145, 0.014, vUv.y) * meltClearGate;
        float hangTipClear = smoothstep(0.24, 0.72, vHang);
        // Opaque condensed milk keeps thick opaque cream right down to its melting bottom edge (zero glass clarity!)
        float hangClear = clamp(max(hangTipClear, bottomEdgeClear * 0.95), 0.0, 1.0) * (1.0 - uOpacity * 0.96) * (1.0 - isMilkBase);

        // Thick flowing sticky glaze lobes + accumulated sticky bottom-rim puddles level frost into mirror-glossy syrup!
        float sweatMask = (1.0 - rimeMaskPre) * (1.0 - max(hangLiquid, hangClear) * 0.94);
        float bottomPoolZone = max(
          revStep(0.16, 0.015, vUv.y) * (1.0 - smoothstep(0.62, 0.95, uMelt)) * smoothstep(0.04, 0.14, uMelt) * (1.0 - rimeMaskPre * 0.85),
          hangLiquid
        );
        float glazeWave = smoothstep(0.16, 0.52, filmH) * (1.0 - rimeMaskPre * 0.88);
        float glazeThick = smoothstep(0.30, 0.82, filmH) * (1.0 - rimeMaskPre * 0.88);
        float glazeCover = max(glazeWave, max(bottomPoolZone * 0.85, max(hangLiquid, hangClear) * 0.98));
        float lipSlope = length(filmSlope);
        float glazeEdge = smoothstep(0.06, 0.44, lipSlope) * smoothstep(0.11, 0.36, filmH) * (1.0 - rimeMaskPre * 0.82);

        // Anchor internal frozen texture, crystalline streaks, frost grain, and dual-flavor gradient to the sliding ice body!
        vec3 icePos = vec3(vWorldPos.x, vWorldPos.y - uSlideY, vWorldPos.z);

        // Domain-warped spatial freeze-roughness field (2 texture fetches instead of 4x4-octave FBM!)
        vec3 volPos = icePos * vec3(2.9, 2.5, 3.4) + vec3(uSeedOffset, 0.0, 0.0);
        vec4 wSampA = texture(uNoise3D, (volPos * 1.35 + vec3(4.1, 1.7, 2.9)) * INV_P6);
        float wSampB = texture(uNoise3D, (volPos * 1.35 + vec3(2.2, -5.1, 7.3)) * INV_P6).r;
        vec3 warpOff = vec3(wSampA.r, wSampA.g, wSampB) - 0.5;
        vec3 warpedVol = volPos + warpOff * 1.25;

        float nearFluteWall = exp(-sq((abs(icePos.x) - ${POPSICLE.fluteX.toFixed(4)}) / 0.052)) * revStep(0.32, 0.04, uMelt);
        vec4 patchSamp = texture(uNoise3D, (warpedVol * 1.85 + vec3(-2.7, 3.8, 1.5)) * INV_P6);
        float freezePatchRaw = patchSamp.r * 0.72 + patchSamp.a * 0.28;
        float freezeRoughBase = clamp(
          pow(smoothstep(0.28, 0.72, freezePatchRaw), 1.35) * 0.92 +
          nearFluteWall * 0.38 +
          smoothstep(0.55, 1.05, icePos.y) * 0.22,
          0.06,
          1.0
        ) * uFrost;

        // Pre-query unrefracted depth to solid emerging fruits so porous slush bumps & refraction fade cleanly
        // to zero right where a berry breaks the surface (eliminates peppery speckle halos around emerging berries!)
        // Checking bgCenter.a > 0.5 guarantees studio backdrop air pixels NEVER falsely match a shallow solid!
        vec4 bgCenter = texture(uBgTex, clamp(screenUv, vec2(0.002), vec2(0.998)));
        float dFront = vCamDepth;
        float dBackRaw = texture(uBackIceZ, screenUv).r;
        float dBack = (dBackRaw < 50.0 && dBackRaw > dFront - 0.02) ? dBackRaw : (dFront + 0.36);
        float totalThickness = clamp(dBack - dFront, 0.03, 0.56);
        vec2 rawIntSample = texture(uInteriorZ, screenUv).rg;
        bool rawHitsSolid = (bgCenter.a > 0.5) && (rawIntSample.g > 0.5) && (rawIntSample.r < dBack + 0.06) && (rawIntSample.r >= dFront - 0.05);
        float rawFrontDist = rawHitsSolid ? clamp(rawIntSample.r - dFront, 0.0, totalThickness) : totalThickness;
        float rawThinFade = rawHitsSolid ? smoothstep(0.010, 0.085, rawFrontDist) : 1.0;

        // Tactile porous wet ice-crystal texture ramps in richly after 1/3 melt (keeping crystal bottom pouches & berry rims clean!)
        float postThirdTex = smoothstep(0.30, 0.56, uMelt) * (1.0 - rimeMaskPre * 0.90) * (1.0 - max(hangLiquid, hangClear) * 0.94) * rawThinFade;

        float microGrain = 0.0;
        float slushFacet = 0.0;
        float slushCavity = 0.0;
        vec3 N_ice = perturbNormal(N0, icePos, glazeCover, freezeRoughBase, sweatMask, postThirdTex, microGrain, slushFacet, slushCavity);

        vec3 refUp = abs(N0.y) > 0.94 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
        vec3 T = normalize(cross(refUp, N0));
        vec3 B = normalize(cross(N0, T));
        // Distinct curved liquid meniscus normal along advancing sticky syrup wave fronts!
        vec3 meniscusBend = (T * filmSlope.x + B * filmSlope.y) * (0.46 * smoothstep(0.09, 0.44, filmH) * (1.0 - rimeMaskPre * 0.80));

        if (bottomPoolZone > 0.01) {
          vec3 pPool = vWorldPos * vec3(24.0, 26.0, 22.0) + vec3(uSeedOffset * 1.9, 0.0, 0.0);
          float poolU = vnoiseTex(pPool + vec3(0.35, 0.0, 0.0)) - vnoiseTex(pPool - vec3(0.35, 0.0, 0.0));
          float poolV = vnoiseTex(pPool + vec3(0.0, 0.35, 0.0)) - vnoiseTex(pPool - vec3(0.0, 0.35, 0.0));
          // Keep hanging liquid pouches taut & surface-tension smooth like real clear droplets (no crinkly ripple noise!)
          meniscusBend += (T * poolU + B * poolV) * (0.24 * bottomPoolZone * (1.0 - hangClear * 0.86));
        }
        // Smooth out meniscus noise inside crystal-clear hanging drop pouches so they curve like taut glass drops!
        meniscusBend *= (1.0 - hangClear * 0.65);
        vec3 N_glaze = normalize(N0 - meniscusBend);
        vec3 N = normalize(mix(N_ice - meniscusBend, N_glaze, max(hangLiquid, hangClear) * 0.96));

        // Physically, Snell screen displacement scales with actual ice thickness above the fruit (Δx ∝ d -> 0 at emergence!)
        float refrDepthScale = rawHitsSolid ? smoothstep(0.002, 0.115, rawFrontDist) : 1.0;

        // View-space Snell screen refraction (IOR = 1.31): accurate from front, side, and 180° back orbit!
        // Scale horizontal UV bend proportionally on the narrow 90° side profile so refraction never overshoots across the slab.
        // Opaque condensed milk does NOT refract or disperse light like clear glass (prevents orange/red chromatic fringes around crumbs!).
        float sideProfile = abs(camH.x);
        vec3 Nview = mat3(viewMatrix) * N;
        float edgeBend = mix(0.014, 0.042, pow(1.0 - N0dotV, 1.30)) * (1.0 - hangClear * 0.34);
        vec2 refrN = vec2(Nview.x * mix(1.0, 0.34, sideProfile * sideProfile), Nview.y * (1.0 - hangClear * 0.45));
        vec2 baseOffset = (-refrN * edgeBend * (0.72 + totalThickness * 1.15) - filmSlope * (0.0085 * glazeWave)) * refrDepthScale * (1.0 - isMilkBase);

        float dispScale = 1.0 - isMilkBase;
        vec2 uvR = screenUv + baseOffset * mix(1.0, 0.94, dispScale);
        vec2 uvG = screenUv + baseOffset;
        vec2 uvB = screenUv + baseOffset * mix(1.0, 1.07, dispScale);

        // Exact front ice thickness to solid embedded fruits & stick
        vec2 clampedUvG = clamp(uvG, vec2(0.002), vec2(0.998));
        vec2 interiorSample = texture(uInteriorZ, clampedUvG).rg;
        bool refrBgIsSolid = (isMilkBase > 0.5) ? (bgCenter.a > 0.5) : (texture(uBgTex, clampedUvG).a > 0.5);
        bool hitsSolid = refrBgIsSolid && (interiorSample.g > 0.5) && (interiorSample.r < dBack + 0.06) && (interiorSample.r >= dFront - 0.04);
        float frontIceDist = hitsSolid ? clamp(interiorSample.r - dFront, 0.0, totalThickness) : totalThickness;
        if (rawHitsSolid) {
          hitsSolid = true;
          frontIceDist = min(frontIceDist, rawFrontDist);
        }
        // Where melting ice thins to zero around an emerging fruit, melt all frost/snow crystals & surface reflections
        // smoothly to zero so the ice converges seamlessly to the exact uncovered fruit surface (zero sharp cutoff step!).
        float thinIceFade = hitsSolid ? smoothstep(0.005, 0.072, frontIceDist) : 1.0;
        float edgeMeltFade = hitsSolid ? smoothstep(0.002, 0.036, frontIceDist) : 1.0;

        // === SPATIALLY VARYING 3D FREEZE-ZONE ROUGHNESS & CRYSTALLINE INTERNAL STRUCTURE ===
        vec4 cloudSamp = texture(uNoise3D, warpedVol * INV_P6);
        float cloudMacro = cloudSamp.r * 0.72 + cloudSamp.a * 0.28;
        float cloudMed = patchSamp.g * 0.70 + patchSamp.a * 0.30;
        float freezeStreaks = fbm3Tex(vec3(icePos.x * 13.5 + warpOff.x * 2.2 + uSeedOffset, icePos.y * 2.6, icePos.z * 11.0));

        // Suppress internal fruit/stick nucleation halo on opaque condensed milk so the buried wooden stick never ghosts!
        float fruitNucleation = hitsSolid ? smoothstep(0.024, 0.085, frontIceDist) * revStep(0.24, 0.095, frontIceDist) * (1.0 - isMilkBase) : 0.0;
        float freezeRoughZone = clamp(freezeRoughBase + fruitNucleation * 0.32 * uFrost, 0.06, 1.0);

        // Two-depth parallax-shifted 3D internal volume sampling (3 fetches total!)
        // On opaque condensed milk, anchor directly near the outer skin so deep buried stick depth never creates a seam!
        float parallaxDist = mix(frontIceDist, 0.025, isMilkBase);
        vec3 innerPosA = icePos - V * clamp(parallaxDist * 0.36, 0.018, 0.095);
        vec3 innerPosB = icePos - V * clamp(parallaxDist * 0.72, 0.040, 0.19);
        vec4 inSampA = texture(uNoise3D, (innerPosA * 18.0 + warpOff * 2.2 + vec3(uSeedOffset * 1.7)) * INV_P6);
        vec4 inSampFine = texture(uNoise3D, (innerPosA * 56.0 + vec3(uSeedOffset * 3.1)) * INV_P12);
        vec4 inSampB = texture(uNoise3D, (innerPosB * 24.0 + vec3(-3.1, 6.4, 2.2)) * INV_P6);

        float innerGranuleCoarse = inSampA.r * 0.72 + inSampA.a * 0.28;
        float innerGranuleFine = inSampFine.r;
        float innerGranuleMicro = inSampFine.a;
        float deepGranule = inSampB.g * 0.72 + inSampB.a * 0.28;

        // Feathery internal freeze-fracture planes & granular snow-ice pockets
        float veinRawA = 1.0 - abs(inSampA.g - 0.5) * 2.0;
        float veinRawB = 1.0 - abs(inSampB.r - 0.5) * 2.0;
        float freezeVeins = (pow(clamp(veinRawA, 0.0, 1.0), 4.0) * 0.68 + pow(clamp(veinRawB, 0.0, 1.0), 4.8) * 0.58) * freezeRoughZone;
        float crunchyPattern = (innerGranuleCoarse * 0.42 + innerGranuleFine * 0.36 + deepGranule * 0.22);
        float crystalMod = (crunchyPattern - 0.5) * 2.0 * freezeRoughZone;

        float frostFactor = clamp(
          uFrost * (0.34 + 0.66 * freezeRoughZone + 0.24 * (cloudMacro - 0.5) + 0.18 * (freezeStreaks - 0.5)),
          0.10,
          1.0
        );

        vec2 roughJitter = vec2(innerGranuleFine - 0.5, innerGranuleMicro - 0.5) * (0.0072 * freezeRoughZone * (1.0 - glazeCover * 0.45) * thinIceFade * (1.0 - isMilkBase));
        uvR += roughJitter;
        uvG += roughJitter;
        uvB += roughJitter;

        // Fresh out of the freezer (uMelt <= 0.08), keep full continuous frost over shallow berries too;
        // once melting progresses, thinIceFade ensures emerging bare berries never wear frost, and pure
        // liquid hanging bellies (hangLiquid) are always 100% frost-free crystal-clear syrup!
        float frostThinGate = mix(1.0, thinIceFade, smoothstep(0.06, 0.16, uMelt)) * (1.0 - hangLiquid * 0.96);
        float rimeMask = rimeMaskPre * frostThinGate;
        float rimeWetEdge = smoothstep(0.02, 0.20, rimeRaw) * (1.0 - smoothstep(0.20, 0.52, rimeRaw)) * frostThinGate;

        float blurAmt = hitsSolid
          ? clamp((smoothstep(0.048, 0.24, frontIceDist) * (0.32 + 0.68 * frostFactor) + freezeRoughZone * 0.14) * thinIceFade, 0.0, 0.84)
          : clamp(0.18 + 0.64 * frostFactor + freezeRoughZone * 0.14, 0.14, 0.92);
        // Hanging liquid pouches & melting lower rim edges are 100% optically crystal-clear like real water drops!
        blurAmt = max(blurAmt * (1.0 - max(hangLiquid, hangClear)), rimeMask * 0.72);

        // Day 19 frosted sea-glass rotated 4-tap scatter disk sampling across 4-level blur pyramid for silky frosted diffusion!
        vec3 bgCol;
        float glassScatter = (1.0 - isMilkBase) * (1.0 - hangClear * 0.92) * (1.0 - glazeCover * 0.58) * thinIceFade;
        float scatterRad = blurAmt * (0.0036 + 0.0068 * pow(1.0 - N0dotV, 1.6) + 0.0045 * totalThickness) * glassScatter;
        if (scatterRad > 0.0018) {
          float angJ = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
          vec2 j0 = vec2(cos(angJ), sin(angJ)) * scatterRad;
          vec2 j1 = vec2(-j0.y, j0.x);
          vec3 s0 = vec3(sampleFrostedBg(uvR + j0, blurAmt).r, sampleFrostedBg(uvG + j0, blurAmt).g, sampleFrostedBg(uvB + j0, blurAmt).b);
          vec3 s1 = vec3(sampleFrostedBg(uvR - j0, blurAmt).r, sampleFrostedBg(uvG - j0, blurAmt).g, sampleFrostedBg(uvB - j0, blurAmt).b);
          vec3 s2 = vec3(sampleFrostedBg(uvR + j1, blurAmt).r, sampleFrostedBg(uvG + j1, blurAmt).g, sampleFrostedBg(uvB + j1, blurAmt).b);
          vec3 s3 = vec3(sampleFrostedBg(uvR - j1, blurAmt).r, sampleFrostedBg(uvG - j1, blurAmt).g, sampleFrostedBg(uvB - j1, blurAmt).b);
          bgCol = (s0 + s1 + s2 + s3) * 0.25;
        } else {
          bgCol.r = sampleFrostedBg(uvR, blurAmt).r;
          bgCol.g = sampleFrostedBg(uvG, blurAmt).g;
          bgCol.b = sampleFrostedBg(uvB, blurAmt).b;
        }

        float grazingPath = 1.0 / max(0.34, N0dotV);
        float opticalDist = frontIceDist * mix(1.0, grazingPath, 0.50);

        // === DYNAMIC FLAVOR PALETTE (1 OR 2 ORGANICALLY SWIRLED TASTES) + WATER vs OPAQUE COCONUT BASE ===
        float bottomRichness = revStep(0.22, -0.98, icePos.y);
        float topRuby = smoothstep(0.70, 1.08, icePos.y);
        float edgeRichness = pow(1.0 - N0dotV, 1.32);
        float fluteOptical = smoothstep(0.10, 0.34, abs(N0.x)) * revStep(0.76, 0.38, abs(N0.x));

        // Organic dual-flavor layered/marbled swirl (Flavor A upper half -> Flavor B lower half)
        float swirlWave = (cloudMacro - 0.5) * 0.46 + (cloudMed - 0.5) * 0.24 + sin(icePos.x * 4.4 + uSeedOffset) * 0.08;
        float dualMix = uIsDual > 0.5 ? smoothstep(-0.34, 0.34, -icePos.y + swirlWave) : 0.0;

        vec3 flvSigma = mix(uSigmaA, uSigmaB, dualMix);
        vec3 flvCore = mix(uCoreA, uCoreB, dualMix);
        vec3 flvMid = mix(uMidA, uMidB, dualMix);
        vec3 flvDeep = mix(uDeepA, uDeepB, dualMix);
        vec3 flvCreamAlb = mix(uCreamAlbA, uCreamAlbB, dualMix);
        vec3 flvCreamSss = mix(uCreamSssA, uCreamSssB, dualMix);
        vec3 flvCreamDeep = mix(uCreamDeepA, uCreamDeepB, dualMix);

        // Reuses baked G channel of cloudSamp (zero extra texture fetches!) for subtle internal sunlit pockets
        float warmPocketNoise = cloudSamp.g * 0.72 + wSampA.a * 0.28;
        float downwardWarmth = revStep(0.55, -0.82, vWorldPos.y);
        float warmNuance = clamp(
          (smoothstep(0.32, 0.76, warmPocketNoise) * 0.68 + downwardWarmth * 0.42) *
          (1.0 - edgeRichness * 0.75) *
          (1.0 - topRuby * 0.65),
          0.0,
          1.0
        );

        vec3 baseSigma = flvSigma * mix(vec3(1.0), vec3(0.92, 0.90, 1.12), warmNuance * 0.38);
        float densityRough = 1.0 - crystalMod * 0.34;
        vec3 juiceSigma = baseSigma * (0.84 + 0.44 * cloudMed) * densityRough;
        juiceSigma *= (1.0 + bottomRichness * 0.54 + topRuby * 0.54 + edgeRichness * 0.78 + fluteOptical * 0.24);

        float absorbScale = hitsSolid ? 1.48 : 1.82;
        vec3 solidTrans = exp(-juiceSigma * opticalDist * absorbScale);
        // Crystal-clear drop-like liquid transparency right across the lower pouch edge band:
        // lets bright studio light shine straight through with only a light jewel-like rose/flavor tint!
        vec3 dropLikeTrans = exp(-flvSigma * (0.055 + 0.13 * clamp(opticalDist * 1.2, 0.0, 1.0) + 0.14 * (1.0 - N0dotV)));
        vec3 transmittance = mix(solidTrans, dropLikeTrans, hangClear * 0.96);
        vec3 transmitted = bgCol * transmittance;

        // === LUMINOUS BACKLIT WATER-BASE SUBSURFACE SCATTERING ===
        float screenHoriz = dot(vWorldPos.xz, camR.xz);
        float lightboxCore = exp(-dot(vec2(screenHoriz, vWorldPos.y) * vec2(0.72, 0.48), vec2(screenHoriz, vWorldPos.y) * vec2(0.72, 0.48)));
        float openChannel = hitsSolid ? smoothstep(0.030, 0.22, frontIceDist) * 0.52 : 1.0;

        float cloudContrast = pow(clamp(cloudMacro * 1.15, 0.0, 1.0), 1.42);
        float centerGlow = clamp(lightboxCore * (0.46 + 0.76 * cloudContrast) * (1.0 - edgeRichness * 0.86), 0.0, 1.0);
        vec3 baseGlow = mix(flvMid, flvCore, centerGlow);
        baseGlow *= (1.0 + warmNuance * openChannel * 0.12);

        vec3 sssJuiceColor = mix(
          baseGlow,
          flvDeep,
          clamp(bottomRichness * 0.50 + edgeRichness * 0.64 + topRuby * 0.48, 0.0, 0.94)
        );

        float roughScatterMod = 1.0 + crystalMod * 0.32;
        float scatterStrength = (0.54 + 0.64 * lightboxCore) * (0.68 + 0.52 * cloudContrast) * (0.48 + 0.44 * frostFactor) * roughScatterMod;
        // Liquid hanging edges & pouches have virtually zero milky internal scatter -> crystal-clear transparency!
        vec3 internalScatter = sssJuiceColor * (1.0 - solidTrans) * openChannel * scatterStrength * (1.0 - hangClear * 0.97);

        // === INTERNAL FROZEN CRYSTALLINE SNOW-POCKETS, MICRO-VEINS & ROUGH FREEZE TOOTH ===
        float crystalSpeck = smoothstep(0.60, 0.95, innerGranuleMicro) * smoothstep(0.34, 0.80, freezeRoughZone);
        float snowPocket = smoothstep(0.54, 0.90, crunchyPattern) * smoothstep(0.36, 0.82, freezeRoughZone) * (1.0 - uMelt * 0.42);
        float creviceDark = revStep(0.46, 0.14, crunchyPattern) * smoothstep(0.34, 0.82, freezeRoughZone) * (1.0 - uMelt * 0.42);

        vec3 warmFrostCol = mix(vec3(1.36, 1.30, 1.26), flvCore * 1.05 + vec3(0.45), 0.42);
        vec3 internalFreezeTex = (
          warmFrostCol * (snowPocket * 0.24 + freezeVeins * 0.28) * (hitsSolid ? 0.65 : 1.0) +
          vec3(1.56, 1.48, 1.40) * crystalSpeck * 0.20 * (hitsSolid ? 0.68 : 1.0)
        ) * thinIceFade * (1.0 - uOpacity * 0.62) * (1.0 - hangLiquid * 0.92);

        float grainSparkle = smoothstep(0.56, 0.94, microGrain) * frostFactor * (0.55 + 0.95 * freezeRoughZone) * (1.0 - uMelt * 0.45);
        float domeSparkle = 1.0 + smoothstep(0.50, 1.06, vWorldPos.y) * 1.25;
        vec3 frostTooth = mix(vec3(1.32, 1.24, 1.20), flvCore + vec3(0.35), 0.48) *
                          grainSparkle * domeSparkle * (hitsSolid ? 0.09 : 0.17) * thinIceFade * (1.0 - uOpacity * 0.58) * (1.0 - hangLiquid * 0.92);

        vec3 iceBody = (transmitted + internalScatter) * (1.0 - creviceDark * 0.24 * thinIceFade * (1.0 - hangClear * 0.92)) + internalFreezeTex + frostTooth;

        // === DAY 19 FROSTED SEA-GLASS TRANSLUCENCY FOR WATER BASE (HG forward scatter + internal light-piping + silky frost veil!) ===
        float waterSeaGlass = (1.0 - isMilkBase) * (1.0 - uOpacity * 0.72) * (1.0 - hangClear * 0.94);
        if (waterSeaGlass > 0.01) {
          vec3 backSunL = normalize(-camH + vec3(0.0, 0.24, 0.0));
          float cosL = dot(-V, backSunL);
          float gHG = 0.45;
          float hgPhase = (1.0 - gHG * gHG) / (12.56637 * pow(max(0.08, 1.0 + gHG * gHG - 2.0 * gHG * cosL), 1.5));
          float backLitIce = pow(clamp(dot(-N, backSunL) * 0.5 + 0.5, 0.0, 1.0), 1.45);
          float frontWrapIce = pow(clamp(dot(N, backSunL) * 0.5 + 0.5, 0.0, 1.0), 1.35);

          // Thin-edge sunlit glow (where dome/bevel thins out) + saturated internal light-piping along curved outer rims!
          float iceThinness = revStep(0.36, 0.06, totalThickness) * (0.45 + 0.55 * lightboxCore);
          vec3 pipeTint = exp(-flvSigma * 0.34);
          vec3 warmStudioBack = vec3(1.38, 1.22, 1.12);
          vec3 seaRimGlow = warmStudioBack * (0.34 + 0.42 * backLitIce) * mix(flvCore, pipeTint * 1.35, 0.45) * iceThinness * thinIceFade;

          float pipeMask = pow(1.0 - N0dotV, 2.0) * smoothstep(0.03, 0.34, N0dotV) * thinIceFade;
          vec3 pipeGlowCol = pipeTint * warmStudioBack * (0.58 + 0.48 * lightboxCore);
          vec3 hgBoost = mix(flvMid, flvCore, 0.55) * warmStudioBack * (hgPhase * 0.30 + backLitIce * 0.16) * (1.0 - solidTrans) * openChannel;

          iceBody += (seaRimGlow * 0.52 + hgBoost * 0.48) * waterSeaGlass;
          iceBody = mix(iceBody, max(iceBody, pipeGlowCol * 0.88), pipeMask * 0.58 * waterSeaGlass);

          // Silky color-tinted frosted sea-glass surface veil (thickens softly at grazing curves, clears where wet/melted!)
          float seaFrostWet = 1.0 - glazeCover * 0.68;
          float seaVeil = clamp(frostFactor * seaFrostWet * (0.07 + 0.24 * pow(1.0 - N0dotV, 1.55)) * thinIceFade * waterSeaGlass, 0.0, 0.34);
          vec3 seaVeilCol = mix(vec3(0.98, 0.94, 0.91), clamp(flvCore * 0.72 + vec3(0.26), vec3(0.0), vec3(1.25)), 0.54) * (0.72 + 0.36 * frontWrapIce + 0.18 * lightboxCore);
          iceBody = mix(iceBody, seaVeilCol, seaVeil);
        }

        float innerRubyRim = revStep(0.54, 0.16, N0dotV) * smoothstep(0.02, 0.16, N0dotV) * thinIceFade * (1.0 - uOpacity * 0.82) * (1.0 - hangClear * 0.88);
        iceBody = mix(iceBody, iceBody * clamp(flvMid * 0.85, vec3(0.15), vec3(1.15)) + flvDeep * 0.40, innerRubyRim * 0.36);

        // === OPAQUE CONDENSED-MILK PALETA BASE (and natural pulp opacity for banana/chocolate!) ===
        vec3 milkSheenTint = vec3(1.04, 1.01, 0.97);
        float milkShardSpark = 0.0;
        if (uOpacity > 0.01) {
          vec3 cKeyL = normalize(-0.68 * camR + vec3(0.0, 0.44, 0.0) + 0.58 * camH);
          vec3 cKeyR = normalize( 0.64 * camR + vec3(0.0, 0.36, 0.0) + 0.68 * camH);
          vec3 cKeyT = normalize(-0.14 * camR + vec3(0.0, 0.82, 0.0) + 0.55 * camH);

          // Velvety matte-granular frozen-cream normal relief (multi-scale tactile tooth + subtle irregular mold texture!)
          float coldMilkAmt = revStep(0.58, 0.06, uMelt) * (1.0 - glazeCover * 0.55);
          vec3 milkMedUndul = (vec3(inSampA.r, inSampA.g, inSampA.a) - 0.5) * (0.20 * isMilkBase * (0.35 + 0.65 * coldMilkAmt));
          vec3 milkFineTooth = (vec3(inSampFine.r, inSampFine.g, inSampFine.a) - 0.5) * (0.30 * isMilkBase * (0.35 + 0.65 * coldMilkAmt));
          vec3 N_milk = normalize(mix(N0, N_ice, 0.48) + milkMedUndul + milkFineTooth);

          // --- 1. FROZEN AIR-POCKET HOLES, TINY PINHOLES & SHALLOW MOLD POCKMARKS ---
          float holePit = 0.0;
          float holeWall = 0.0;
          float moldDimple = 0.0;
          vec3 holeDir = vec3(0.0);
          if (isMilkBase > 0.01) {
            float holeMeltFade = revStep(0.62, 0.14, uMelt) * (1.0 - glazeCover * 0.55) * edgeMeltFade;
            if (holeMeltFade > 0.01) {
              // Broad shallow irregular mold-wall dimples (sculpt organic pockets along flutes & face without dark dots!)
              vec3 dirD;
              vec2 hd = evalAirPocketCell(
                icePos * 10.5 + vec3(-1.4, uSeedOffset * 0.9, 2.3),
                1.0 / 10.5,
                0.60,
                0.15,
                0.24,
                dirD
              );
              moldDimple = hd.x * holeMeltFade * isMilkBase;
              if (moldDimple > 0.01) {
                vec3 tangD = dirD - N0 * dot(dirD, N0);
                N_milk = normalize(N_milk - tangD * (moldDimple * 0.46));
              }

              // Medium trapped air-bubble craters (clearly legible sculpted irregular cavities!)
              vec3 dirM;
              vec2 hm = evalAirPocketCell(
                icePos * 14.5 + vec3(uSeedOffset * 1.3, 2.1, -0.7),
                1.0 / 14.5,
                0.62,
                0.125,
                0.235,
                dirM
              );
              // Rotated crisp tiny pinholes (creates natural 2-3 hole clusters along flutes & face!)
              vec3 rotIceS = vec3(icePos.x * 0.80 - icePos.y * 0.60, icePos.x * 0.60 + icePos.y * 0.80, icePos.z);
              vec3 dirS;
              vec2 hs = evalAirPocketCell(
                rotIceS * 29.0 + vec3(-3.4, uSeedOffset * 2.1, 4.7),
                1.0 / 29.0,
                0.64,
                0.115,
                0.205,
                dirS
              );
              holePit = clamp(max(hm.x, hs.x * 0.90), 0.0, 1.0) * holeMeltFade * isMilkBase;
              holeWall = clamp(max(hm.y, hs.y * 0.85), 0.0, 1.0) * holeMeltFade * isMilkBase;
              holeDir = hm.x >= hs.x ? dirM : dirS;
              if (holePit > 0.01 || holeWall > 0.01) {
                vec3 tangDir = holeDir - N0 * dot(holeDir, N0);
                // Concave crater wall normal tilts inward -> dark upper-left interior, naturally lit lower-right edge!
                N_milk = normalize(N_milk - tangDir * ((holePit * 0.95 + holeWall * 0.38)));
              }
            }
          }

          float wL = clamp((dot(N_milk, cKeyL) + 0.32) / 1.32, 0.0, 1.0);
          float wR = clamp((dot(N_milk, cKeyR) + 0.40) / 1.40, 0.0, 1.0);
          float wT = clamp((dot(N_milk, cKeyT) + 0.34) / 1.34, 0.0, 1.0);

          // Deep sculpted twin vertical flutes + organic wavy matte frost along flute shoulders (NEVER straight neon lines!)
          float fluteWarp = (warpOff.x * 0.042 + (inSampA.r - 0.5) * 0.028);
          float fluteAbsD = abs(abs(icePos.x) - ${POPSICLE.fluteX.toFixed(4)});
          float fluteSpanY = smoothstep(-0.86, -0.54, icePos.y) * revStep(0.84, 0.52, icePos.y) * revStep(0.56, 0.14, uMelt);
          float fluteTrack = exp(-sq(fluteAbsD / 0.044)) * fluteSpanY;
          float fluteRidgeWavy = exp(-sq((abs(abs(icePos.x + fluteWarp) - ${POPSICLE.fluteX.toFixed(4)}) - 0.064) / 0.030)) * fluteSpanY;
          float fluteAO = 1.0 - fluteTrack * (0.38 + 0.18 * (1.0 - wL));

          // Soft ambient wrap on edges + sculpted key-to-shadow gradient (kept <= 1.0 so ACES preserves deep chroma!)
          float edgeForm = 0.80 + 0.20 * smoothstep(0.06, 0.56, N0dotV);
          float creamLight = clamp((0.18 + 0.56 * wL + 0.16 * wR + 0.10 * wT) * fluteAO * edgeForm, 0.0, 1.0);

          // --- 2. RICH ORGANIC COLOR & TEXTURE VARIATION (cloudy frozen-milk mottling + fine sugary velvety grain, NO caustic webs!) ---
          vec3 grainCoord = icePos * vec3(15.0, 4.8, 14.0) + warpOff * 1.1 + vec3(uSeedOffset * 1.4, -1.2, 0.8);
          vec4 fgSamp = texture(uNoise3D, grainCoord * INV_P6);
          float verticalFreezeGrain = fgSamp.r * 0.60 + fgSamp.a * 0.40;
          float mottleCoarse = texture(uNoise3D, (icePos * vec3(5.0, 4.0, 5.0) + warpOff * 0.7 + vec3(-1.8, uSeedOffset * 1.1, 2.4)) * INV_P6).g;
          float mottleMed = texture(uNoise3D, (icePos * vec3(12.5, 9.5, 12.5) + vec3(2.3, -1.7, uSeedOffset * 1.9)) * INV_P6).r;
          float mottleFine = inSampA.g * 0.48 + inSampFine.r * 0.52;
          float velvetSugarTooth = rFine.a * 0.45 + rMicro.a * 0.55;

          // Concentrated dark fruit-pigment blotches vs soft cloudy frozen-milk marbling patches!
          float pigmentPocket = smoothstep(0.36, 0.82, mottleCoarse * 0.52 + (1.0 - cloudMacro) * 0.30 + (1.0 - mottleMed) * 0.18) * isMilkBase;
          float milkSwirlRaw = clamp(cloudMacro * 0.44 + cloudMed * 0.32 + (mottleMed - 0.5) * 0.28 + (verticalFreezeGrain - 0.5) * 0.24, 0.0, 1.0);
          float milkRibbon = smoothstep(0.46, 0.84, milkSwirlRaw) * isMilkBase;
          float microMottle = (mottleFine - 0.5) * 0.30 + (velvetSugarTooth - 0.5) * 0.24 + (verticalFreezeGrain - 0.5) * 0.14;

          // Distinct organic light/dark tonal richness without washing vibrant fruit hues into chalky pastel!
          vec3 paleMilkTint = mix(flvCreamAlb * 1.24 + vec3(0.14, 0.12, 0.11), vec3(0.94, 0.89, 0.80), 0.32);
          vec3 deepJuiceTint = mix(flvCreamDeep * 0.66, flvCreamAlb * 0.52, 0.30);
          vec3 swirledAlb = mix(flvCreamAlb, deepJuiceTint, pigmentPocket * 0.44);
          swirledAlb = mix(swirledAlb, paleMilkTint, milkRibbon * 0.34);
          vec3 swirledDeep = mix(flvCreamDeep, flvCreamDeep * 0.64, pigmentPocket * 0.36);
          swirledDeep = mix(swirledDeep, mix(flvCreamDeep, vec3(0.60, 0.50, 0.38), 0.20), milkRibbon * 0.24);
          milkSheenTint = mix(vec3(1.04, 1.00, 0.96), swirledAlb * 1.12 + vec3(0.30), 0.48);

          // Tactile velvety frozen-cream grain + shallow mold-dimple shading
          float creamGrain = clamp(0.92 + 0.18 * (crunchyPattern - 0.5) + 0.14 * (microGrain - 0.5) + microMottle * isMilkBase - creviceDark * 0.14 - moldDimple * 0.18, 0.60, 1.26);
          vec3 creamBase = mix(swirledDeep, swirledAlb, creamLight) * creamGrain;

          // Subtle, organically broken matte-velvet frost dusting across cold crests & wavy flute shoulders
          vec3 frostDustCol = mix(swirledAlb * 1.26 + vec3(0.18, 0.16, 0.15), vec3(0.95, 0.92, 0.89), 0.42);
          float wavyRidgePatch = smoothstep(0.38, 0.80, mottleMed * 0.52 + velvetSugarTooth * 0.48);
          float ridgeFrostAmt = fluteRidgeWavy * wavyRidgePatch * coldMilkAmt * isMilkBase;
          float coldVelvetDust = smoothstep(0.54, 0.90, velvetSugarTooth * 0.55 + mottleFine * 0.45) * coldMilkAmt * isMilkBase;
          creamBase = mix(creamBase, frostDustCol, clamp(ridgeFrostAmt * 0.28 + coldVelvetDust * 0.20, 0.0, 0.44));

          // Apply crisp organic air-pocket cavities (deep rich pigment pit shadow + subtle directional lit lip — zero white ring!)
          if (holePit > 0.005 || holeWall > 0.005) {
            vec3 pitDarkCol = swirledDeep * (0.18 + 0.20 * wL);
            creamBase = mix(creamBase, pitDarkCol, clamp(holePit * 0.86, 0.0, 0.88));
            float dirLip = pow(clamp(dot(-holeDir, cKeyL), 0.0, 1.0), 1.8);
            creamBase = mix(creamBase, mix(swirledAlb * 1.18, frostDustCol, 0.45), clamp(holeWall * dirLip * 0.30, 0.0, 0.32));
          }

          // --- 3. CRISP SCATTERED ICE/SUGAR MICRO-SHARDS (faceted frosty crystal flakes & organic drifts on cold milk!) ---
          if (isMilkBase > 0.01) {
            float shardMeltFade = revStep(0.52, 0.06, uMelt) * (1.0 - glazeCover * 0.72) * edgeMeltFade;
            if (shardMeltFade > 0.01) {
              // Coarse flaky frosted sugar/ice shards (visible ~2-5px irregular crystalline flecks in organic drifts!)
              vec2 shA = evalMicroShardCell(
                icePos * 24.0 + vec3(uSeedOffset * 1.7, -1.9, 3.1),
                1.0 / 24.0,
                0.86,
                0.082,
                0.175
              );
              // Medium angular micro-splinters (rotated 51 deg so shards layer into crisp frosty crystal drifts!)
              vec3 rotIceSh1 = vec3(icePos.x * 0.63 + icePos.y * 0.78, -icePos.x * 0.78 + icePos.y * 0.63, icePos.z);
              vec2 shB = evalMicroShardCell(
                rotIceSh1 * 48.0 + vec3(5.2, uSeedOffset * 2.9, -2.3),
                1.0 / 48.0,
                0.90,
                0.075,
                0.160
              );
              // Fine sparkling frozen sugar-frost micro-crystals (rotated -32 deg)
              vec3 rotIceSh2 = vec3(icePos.x * 0.85 - icePos.y * 0.53, icePos.x * 0.53 + icePos.y * 0.85, icePos.z);
              vec2 shC = evalMicroShardCell(
                rotIceSh2 * 86.0 + vec3(-4.1, 2.7, uSeedOffset * 3.3),
                1.0 / 86.0,
                0.86,
                0.070,
                0.145
              );
              float wA = shA.x * shA.y * 0.92;
              float wB = shB.x * shB.y * 0.86;
              float wC = shC.x * shC.y * 0.74;
              float shardCov = clamp(max(wA, max(wB, wC)), 0.0, 1.0) * shardMeltFade * isMilkBase;
              vec3 shardCol = mix(vec3(1.04, 1.01, 0.97), swirledAlb * 0.50 + vec3(0.66), 0.22);
              creamBase = mix(creamBase, shardCol, clamp(shardCov * 0.86, 0.0, 0.88));
              milkShardSpark = shardCov * smoothstep(0.60, 1.0, max(shA.y, shB.y));
            }
          }

          // Very soft subsurface warm scatter strictly along thin rim bevels (never washes out body!)
          float rimSss = pow(1.0 - N0dotV, 3.0) * (0.14 + 0.14 * lightboxCore);
          creamBase += flvCreamSss * rimSss * (0.24 - 0.12 * isMilkBase);

          // Pressed-in toppings right against the outer 1-3mm mold skin integrate organically into opaque milk
          // with ZERO bright white studio-backdrop border or halo: any gather tap outside the topping silhouette
          // (s.a <= 0.5) substitutes creamBase (the actual flavored milk) instead of white lightbox air!
          if (isMilkBase > 0.01) {
            float peekMaxD = 0.066;
            float nearSolidAlpha = max(bgCenter.a, texture(uBgBlur1, clamp(screenUv, vec2(0.002), vec2(0.998))).a);
            if (nearSolidAlpha > 0.008) {
              float milkSolidDist = (rawHitsSolid && bgCenter.a > 0.5) ? rawFrontDist : 99.0;
              if (milkSolidDist >= peekMaxD) {
                vec2 pStep = (2.4 * clamp(uResolution.y / 1000.0, 0.75, 2.0)) / uResolution;
                vec2 z0 = texture(uInteriorZ, clamp(screenUv + vec2( pStep.x, 0.0), vec2(0.002), vec2(0.998))).rg;
                vec2 z1 = texture(uInteriorZ, clamp(screenUv + vec2(-pStep.x, 0.0), vec2(0.002), vec2(0.998))).rg;
                vec2 z2 = texture(uInteriorZ, clamp(screenUv + vec2(0.0,  pStep.y), vec2(0.002), vec2(0.998))).rg;
                vec2 z3 = texture(uInteriorZ, clamp(screenUv + vec2(0.0, -pStep.y), vec2(0.002), vec2(0.998))).rg;
                if (z0.g > 0.5 && z0.r >= dFront - 0.05 && z0.r < dBack + 0.06) milkSolidDist = min(milkSolidDist, max(0.0, z0.r - dFront));
                if (z1.g > 0.5 && z1.r >= dFront - 0.05 && z1.r < dBack + 0.06) milkSolidDist = min(milkSolidDist, max(0.0, z1.r - dFront));
                if (z2.g > 0.5 && z2.r >= dFront - 0.05 && z2.r < dBack + 0.06) milkSolidDist = min(milkSolidDist, max(0.0, z2.r - dFront));
                if (z3.g > 0.5 && z3.r >= dFront - 0.05 && z3.r < dBack + 0.06) milkSolidDist = min(milkSolidDist, max(0.0, z3.r - dFront));
              }

              if (milkSolidDist < peekMaxD) {
                float creamPeek = exp(-milkSolidDist * 38.0) * revStep(peekMaxD, 0.0, milkSolidDist);
                float veilDepth = smoothstep(0.002, peekMaxD, milkSolidDist);
                float pxScale = clamp(uResolution.y / 1000.0, 0.75, 2.0);
                vec2 radUv = (mix(0.65, 3.6, veilDepth) * pxScale) / uResolution;
                vec2 dRad = radUv * 0.7071;

                vec3 c0 = bgCenter.a > 0.5 ? bgCenter.rgb : creamBase;
                vec4 t1 = texture(uBgTex, clamp(screenUv + vec2( radUv.x, 0.0), vec2(0.002), vec2(0.998)));
                vec4 t2 = texture(uBgTex, clamp(screenUv + vec2(-radUv.x, 0.0), vec2(0.002), vec2(0.998)));
                vec4 t3 = texture(uBgTex, clamp(screenUv + vec2(0.0,  radUv.y), vec2(0.002), vec2(0.998)));
                vec4 t4 = texture(uBgTex, clamp(screenUv + vec2(0.0, -radUv.y), vec2(0.002), vec2(0.998)));
                vec4 t5 = texture(uBgTex, clamp(screenUv + vec2( dRad.x,  dRad.y), vec2(0.002), vec2(0.998)));
                vec4 t6 = texture(uBgTex, clamp(screenUv + vec2(-dRad.x,  dRad.y), vec2(0.002), vec2(0.998)));
                vec4 t7 = texture(uBgTex, clamp(screenUv + vec2( dRad.x, -dRad.y), vec2(0.002), vec2(0.998)));
                vec4 t8 = texture(uBgTex, clamp(screenUv + vec2(-dRad.x, -dRad.y), vec2(0.002), vec2(0.998)));

                vec3 s1 = t1.a > 0.5 ? t1.rgb : creamBase;
                vec3 s2 = t2.a > 0.5 ? t2.rgb : creamBase;
                vec3 s3 = t3.a > 0.5 ? t3.rgb : creamBase;
                vec3 s4 = t4.a > 0.5 ? t4.rgb : creamBase;
                vec3 s5 = t5.a > 0.5 ? t5.rgb : creamBase;
                vec3 s6 = t6.a > 0.5 ? t6.rgb : creamBase;
                vec3 s7 = t7.a > 0.5 ? t7.rgb : creamBase;
                vec3 s8 = t8.a > 0.5 ? t8.rgb : creamBase;

                vec3 gathered = (c0 * 2.0 + s1 + s2 + s3 + s4 + (s5 + s6 + s7 + s8) * 0.75) / 9.0;
                vec3 peekSrc = mix(c0, gathered, smoothstep(0.0, 0.22, veilDepth));
                vec3 peekTint = mix(peekSrc, mix(peekSrc * 0.70 + swirledAlb * 0.30, creamBase, 0.40), veilDepth * 0.85);
                float emergeMix = clamp(creamPeek * mix(1.0, 0.94, veilDepth), 0.0, 1.0);
                creamBase = mix(creamBase, peekTint, emergeMix);
              }
            }
          } else if (hitsSolid) {
            float creamPeek = exp(-frontIceDist * 26.0) * revStep(0.105, 0.0, frontIceDist);
            float veilDepth = smoothstep(0.002, 0.105, frontIceDist);
            vec3 peekTint = mix(bgCol, mix(bgCol * 0.68 + swirledAlb * 0.32, creamBase, 0.42), veilDepth * 0.45);
            creamBase = mix(creamBase, peekTint, clamp(creamPeek * 0.92, 0.0, 0.96));
          }

          // Melted wet condensed milk deepens & turns lush velvety satin where liquid glaze flows
          creamBase *= mix(vec3(1.0), vec3(0.90, 0.86, 0.84), glazeCover * (0.24 + 0.16 * isMilkBase));

          // True 100% opaque coverage on condensed-milk base: creamBase already converges smoothly
          // to uncovered toppings as depth -> 0, so NEVER fall back to translucent water iceBody!
          float milkCoverage = mix(uOpacity * thinIceFade, uOpacity, isMilkBase);
          iceBody = mix(iceBody, creamBase, clamp(milkCoverage, 0.0, mix(0.96, 1.0, isMilkBase)));
        }

        // === GLOSSY VISCOUS MELT-SYRUP GLAZE LAYERING & BOTTOM PUDDLE ABSORPTION ===
        // Thick creeping sticky syrup layers deepen flavor saturation on the body;
        // inside crystal-clear hanging drop pouches (hangClear), keep clarity crisp & luminous like real drops!
        vec3 glazeAbsorb = mix(flvSigma * 0.42, vec3(0.24), uOpacity * 0.78);
        float glazeOpticalDepth = (glazeWave * 0.56 + glazeThick * 0.42 + bottomPoolZone * 0.40) * (1.0 - hangClear * 0.92);
        vec3 glazeTint = exp(-glazeAbsorb * glazeOpticalDepth * thinIceFade);
        iceBody *= mix(vec3(1.0), glazeTint, 0.86 * (1.0 - uOpacity * 0.50));
        // Subtle darker meniscus contour right underneath the curved leading lip of an advancing syrup wave
        float lipShade = clamp(max(0.0, -filmSlope.y) * 1.25 * glazeEdge * thinIceFade, 0.0, 0.24);
        iceBody *= (1.0 - lipShade * (1.0 - uOpacity * 0.55));
        iceBody *= mix(vec3(1.0), mix(vec3(0.92), uStainCol, 0.24), wetMem * 0.24 * (1.0 - glazeCover) * thinIceFade * (1.0 - hangClear * 0.92));

        // Jewel-clear optical water-drop refractive contour rim along the transparent lower edge (matching hanging drops!)
        float hangGlassRim = revStep(0.62, 0.14, N0dotV) * hangClear;
        vec3 dropRimTint = mix(vec3(0.46, 0.22, 0.24), uStainCol * 0.48, 0.65);
        iceBody = mix(iceBody, iceBody * dropRimTint, clamp(hangGlassRim * 0.64, 0.0, 0.66));

        // Rich colored porous pebble shading after 1/3 melt (studio lights stay locked to viewer azimuth for 360° turntable!)
        vec3 keyL = normalize(-0.66 * camR + vec3(0.0, 0.46, 0.0) + 0.59 * camH);
        vec3 keyR = normalize( 0.66 * camR + vec3(0.0, 0.42, 0.0) + 0.62 * camH);
        vec3 keyTop = normalize(-0.18 * camR + vec3(0.0, 0.78, 0.0) + 0.60 * camH);
        vec3 keyFront = normalize( 0.14 * camR + vec3(0.0, 0.34, 0.0) + 0.93 * camH);

        if (postThirdTex > 0.005) {
          // Pure colored micro-bump diffuse relief: lit upper pebble bevels glow richer, shadowed troughs deepen!
          float lIce = dot(N_ice, keyL) * 0.48 + dot(N_ice, keyTop) * 0.34 + dot(N_ice, keyR) * 0.18;
          float lBase = dot(N0, keyL) * 0.48 + dot(N0, keyTop) * 0.34 + dot(N0, keyR) * 0.18;
          float bumpRelief = clamp(lIce - lBase, -0.34, 0.34);
          iceBody *= 1.0 + bumpRelief * mix(0.88, 0.44, uOpacity) * postThirdTex * thinIceFade;

          // Rich saturated flavor darkening inside tiny melted ice-crystal pores
          float wetSlushDepth = slushCavity * thinIceFade * (1.0 - hangClear * 0.94);
          vec3 creviceTint = mix(flvDeep * 0.58 + vec3(0.12), vec3(0.86, 0.83, 0.81), uOpacity * 0.82);
          iceBody = mix(iceBody, iceBody * creviceTint, clamp(wetSlushDepth * 0.42, 0.0, 0.44));
        }

        // === INTERNAL TRAPPED AIR MICRO-BUBBLES (hidden inside opaque coconut & clear hanging liquid syrup!) ===
        vec4 bub = texture(uBubblesTex, clamp(uvG, vec2(0.002), vec2(0.998)));
        float bubVis = clamp(bub.a * 0.92 * thinIceFade * (1.0 - uOpacity * 0.92) * (1.0 - hangLiquid * 0.94), 0.0, 0.92);
        iceBody = mix(iceBody, bub.rgb, bubVis);

        // === WET GLAZE FRESNEL, SOFT SYRUPY SHEEN & SPARSE CRISP WET CRYSTAL PINPOINTS ===
        // Gently ripple glaze reflections over the wet porous pebbles (bounded blend avoids huge white blotches!)
        vec3 N_refl = normalize(mix(N_glaze, N_ice, clamp(postThirdTex * 0.36 * (1.0 - uOpacity * 0.35), 0.0, 0.40)));
        vec3 R_glaze = reflect(-V, N_refl);
        vec3 R_smooth = reflect(-V, N0);
        vec3 R_glazeStudio = vec3(dot(R_glaze, camR), R_glaze.y, dot(R_glaze, camH));
        vec3 R_smoothStudio = vec3(dot(R_smooth, camR), R_smooth.y, dot(R_smooth, camH));

        float fresnel = (0.02 + 0.98 * pow(1.0 - clamp(dot(N_glaze, V), 0.0, 1.0), 4.8)) * edgeMeltFade * (0.35 + 0.65 * thinIceFade);
        float shoulderGlareTame = mix(1.0, 0.48, smoothstep(0.55, 0.95, vWorldPos.y));
        float dryFrostMatte = 1.0 - rimeMask * 0.84;
        // Keep cold condensed milk truly velvety matte (zero glossy plastic shoulder glare until melting warms the surface!)
        float milkWetness = smoothstep(0.18, 0.48, uMelt) * 0.74 + glazeCover * smoothstep(0.14, 0.34, uMelt) * 0.26;
        float filmRough = mix(mix(0.10, 0.045, glazeCover) + postThirdTex * 0.165, 0.42 - 0.16 * milkWetness, isMilkBase);
        vec3 specWet = evalMacroStudioReflection(R_glazeStudio, filmRough) * shoulderGlareTame;
        vec3 specSatin = evalMacroStudioReflection(R_smoothStudio, 0.32) * shoulderGlareTame;

        // Dry powdery hoarfrost damps mirror-glossy studio reflections; cold condensed milk is velvety matte,
        // warming gently into a soft, micro-grain-broken wet-cream satin sheen as it melts (never plastic wrap!)
        float milkSpecScale = mix(1.0, 0.025 + 0.16 * milkWetness, isMilkBase);
        float glazeSpecBoost = (1.0 + glazeCover * 0.45 + wetMem * 0.16) * (1.0 - postThirdTex * 0.56) * dryFrostMatte * milkSpecScale;
        vec3 color =
          iceBody * (1.0 - fresnel * 0.38 * dryFrostMatte * mix(1.0, 0.08, isMilkBase)) +
          specWet * (fresnel * 0.70 * glazeSpecBoost) +
          specSatin * (fresnel * 0.14 * frostFactor * (1.0 - glazeCover * 0.75) * thinIceFade * dryFrostMatte * mix(1.0, 0.18, isMilkBase));

        // Soft, slightly granular wet-cream sheen when condensed milk melts + sparse crisp micro-shard twinkle
        if (isMilkBase > 0.01) {
          float milkGrainBreak = 0.72 + 0.56 * innerGranuleFine;
          float milkBroadSheen =
            (pow(max(dot(N_glaze, safeNorm(keyL + V)), 0.0), 34.0) * 0.11 +
             pow(max(dot(N_glaze, safeNorm(keyR + V)), 0.0), 42.0) * 0.06 +
             pow(1.0 - N0dotV, 3.2) * 0.07) * milkGrainBreak;
          color += milkSheenTint * milkBroadSheen * milkWetness * isMilkBase * dryFrostMatte * edgeMeltFade;
          color += vec3(1.36, 1.32, 1.28) * milkShardSpark * 0.24 * dryFrostMatte * edgeMeltFade;
        }

        // Organic, crystal-broken frosted specular ridges along the twin molded flutes (suppressed on matte milk!)
        float fluteFade = revStep(0.36, 0.14, uMelt) * (1.0 - isMilkBase * 0.96);
        if (fluteFade > 0.002) {
          vec3 R_flute = reflect(-V, normalize(mix(N0, N_ice, 0.55)));
          float nearFluteTrack = exp(-sq((abs(vWorldPos.x) - ${POPSICLE.fluteX.toFixed(4)}) / 0.064));
          float fluteBreakup = smoothstep(0.18, 0.82, innerGranuleCoarse);
          float fluteCrystalSpark = smoothstep(0.45, 0.95, innerGranuleMicro) * 0.85;
          float fluteBand = exp(-sq((abs(R_flute.x) - 0.34) / 0.056)) *
                            smoothstep(0.08, 0.24, abs(N0.x)) *
                            revStep(0.54, 0.24, abs(N0.x)) *
                            smoothstep(-0.86, -0.60, vWorldPos.y) *
                            revStep(0.88, 0.62, vWorldPos.y) *
                            nearFluteTrack * fluteFade;
          float fluteLine = fluteBand * (0.28 + 0.82 * fluteBreakup + fluteCrystalSpark + freezeVeins * 0.45);
          color += mix(vec3(1.56, 1.38, 1.34), vec3(1.68, 1.48, 1.24), warmNuance * 0.45) * fluteLine * 0.34 * edgeMeltFade * dryFrostMatte;
        }

        // Crisp sparse sparkling wet micro-crystal pinpoints across porous thawing sugar-ice
        vec3 hL = safeNorm(keyL + V);
        vec3 hR = safeNorm(keyR + V);
        vec3 hT = safeNorm(keyTop + V);
        vec3 hF = safeNorm(keyFront + V);

        float creamSmoothSpec = (1.0 - uOpacity * 0.78) * (1.0 - isMilkBase * 0.96);
        float solidIceSpec = 1.0 - hangLiquid * 0.88;
        float solidSpecScale = creamSmoothSpec * solidIceSpec;

        float crystalGlint = 0.0;
        if (solidSpecScale > 0.002) {
          crystalGlint =
            pow(max(dot(N, hL), 0.0), 460.0) * 1.35 +
            pow(max(dot(N, hR), 0.0), 460.0) * 1.20 +
            pow(max(dot(N, hT), 0.0), 540.0) * 1.25;
        }

        float ndhL_g = max(dot(N_glaze, hL), 0.0);
        float ndhR_g = max(dot(N_glaze, hR), 0.0);
        float ndhT_g = max(dot(N_glaze, hT), 0.0);

        float softGlazeW = clamp(glazeCover * 0.68 + glazeEdge * 1.15, 0.0, 1.35);
        float softGlazeSheen = softGlazeW > 0.002
          ? (pow(ndhL_g, 135.0) * 0.82 + pow(ndhR_g, 135.0) * 0.68 + pow(ndhT_g, 175.0) * 0.62) * softGlazeW * (1.0 - postThirdTex * 0.55)
          : 0.0;
        // Sharp glossy curved liquid gleam riding along the advancing lip of each creeping sticky syrup wave!
        float glazeLipGlint = glazeEdge > 0.002
          ? (pow(ndhL_g, 280.0) * 1.45 + pow(ndhR_g, 280.0) * 1.25 + pow(ndhT_g, 320.0) * 1.35) * glazeEdge * (1.0 - postThirdTex * 0.62)
          : 0.0;
        float bottomStickyGlint = bottomPoolZone > 0.002
          ? (pow(ndhL_g, 210.0) * 1.25 + pow(ndhR_g, 210.0) * 1.15 + pow(ndhT_g, 180.0) * 0.92) * bottomPoolZone
          : 0.0;

        // Crisp sparse 1-2px wet white specular pinpoints on the sharpest pebble bevels (NEVER chalky white static!)
        float ndhL_i = max(dot(N_ice, hL), 0.0);
        float ndhR_i = max(dot(N_ice, hR), 0.0);
        float ndhT_i = max(dot(N_ice, hT), 0.0);
        float ndhF_i = max(dot(N_ice, hF), 0.0);
        float pebbleCrest = smoothstep(0.48, 0.88, microGrain);
        float slushPinpoints = (slushFacet > 0.002 && solidSpecScale > 0.002)
          ? (pow(ndhL_i, 460.0) * 2.10 +
             pow(ndhR_i, 460.0) * 1.85 +
             pow(ndhT_i, 520.0) * 1.95 +
             pow(ndhF_i, 380.0) * 1.45 * postThirdTex) * slushFacet * (0.35 + 0.65 * pebbleCrest)
          : 0.0;

        // Suppress hard glossy plastic glaze bands on velvety matte condensed milk (keep subtle soft wet luster when melting!)
        float milkGlazeSpec = mix(1.0, 0.02 + 0.14 * milkWetness, isMilkBase);
        color *= 1.0 + (microGrain - 0.50) * (0.18 + 0.14 * postThirdTex) * slushFacet * thinIceFade * solidSpecScale * dryFrostMatte;
        color += vec3(1.96, 1.85, 1.80) * (crystalGlint * solidSpecScale + slushPinpoints * 1.35 * thinIceFade * solidSpecScale + (glazeLipGlint * 1.05 + bottomStickyGlint * 0.95) * milkGlazeSpec) * edgeMeltFade * (0.38 + 0.62 * thinIceFade) * dryFrostMatte;
        color += vec3(1.72, 1.60, 1.56) * softGlazeSheen * milkGlazeSpec * edgeMeltFade * (0.42 + 0.58 * thinIceFade) * dryFrostMatte;

        // Luminous clear glass bottom caustic crescent & crisp droplet-style pinpoint catchlights on hanging pouches!
        float hangCaustic = revStep(0.16, -0.78, N_glaze.y) * smoothstep(0.12, 0.72, N0dotV) * max(hangLiquid, hangClear) * (1.0 - uOpacity * 0.68);
        color += mix(vec3(0.82, 0.72, 0.68), uStainCol * 0.82 + vec3(0.26), 0.52) * hangCaustic * 0.62;
        if (hangClear > 0.002) {
          float hangPinSpec = (pow(ndhL_g, 220.0) * 1.15 + pow(ndhR_g, 180.0) * 0.82) * hangClear;
          color += vec3(2.4, 2.3, 2.24) * hangPinSpec * edgeMeltFade;
        }

        // Keep the luminous cloudy pink rim glow alive across translucent water ice (suppressed on opaque condensed milk!)
        float silhouetteRim = pow(1.0 - N0dotV, 5.4) * thinIceFade * (1.0 - hangClear * 0.28) * (1.0 - isMilkBase * 0.88);
        color += vec3(1.36, 0.98, 0.94) * silhouetteRim * 0.48 * dryFrostMatte;

        // === FREEZER-FRESH POWDERY HOARFROST RIME LAYER (instant melt under pointer!) ===
        if (rimeMask > 0.005 || rimeWetEdge > 0.005) {
          vec4 rTuft = texture(uNoise3D, (vWorldPos * 32.0 + vec3(uSeedOffset * 1.1, 3.3, -1.7)) * INV_P8);
          float rimEdgeFuzz = pow(1.0 - N0dotV, 1.48);
          float topSnow = smoothstep(0.62, 1.04, vWorldPos.y) * 0.22;

          // Crisp spiky crystalline frost needles & high-contrast micro-fuzz (vivid popsicle glows richly underneath!)
          float needleRaw = rMicro.a * 0.58 + rFine.b * 0.42;
          float needleSpikes = pow(smoothstep(0.38, 0.92, needleRaw), 1.65);
          float microFuzz = smoothstep(0.46, 0.94, rMicro.b * 0.65 + rFine.a * 0.35);

          // Scattered crisp bright snow-crystal star-tufts heaviest along cold grazing right/left edges & shoulders!
          float tuftRaw = rTuft.b * 0.55 + rFine.b * 0.45;
          float frostTuft = pow(smoothstep(0.60, 0.91, tuftRaw), 2.35) *
                            (0.42 + 1.85 * rimEdgeFuzz + topSnow * 1.8);
          // Occasional tiny bright crisp snowflake specks across the face (matches macro hoarfrost photo!)
          float snowFlakeSpeck = pow(smoothstep(0.76, 0.96, rTuft.a * 0.52 + rFine.a * 0.48), 2.8) * rimeMask;

          // Warm backlit icy-white micro-crystals on face -> pure luminous snowy white along fuzzy grazing silhouette!
          vec3 frostSnowCol = mix(
            vec3(1.26, 1.14, 1.11),
            vec3(1.56, 1.52, 1.48),
            clamp(rimEdgeFuzz * 1.20 + needleSpikes * 0.45 + topSnow, 0.0, 1.0)
          );

          // Delicate translucent frosty base (lets vibrant strawberry-coral & berries shine vividly through!)
          // + crisp dense white needle fibers + thick snowy fuzzy rim halo!
          float faceCov = rimeMask * (0.11 + 0.36 * needleSpikes + 0.16 * microFuzz + topSnow * 0.38);
          float rimCov = rimeMask * rimEdgeFuzz * (0.58 + 0.50 * needleSpikes + 0.25 * microFuzz);
          float totalFrostCov = clamp(max(faceCov, rimCov), 0.0, 0.92);

          // Crisp twinkling dry micro-crystal pinpoints across the hoarfrost needles
          float frostSparkle = pow(smoothstep(0.76, 0.98, rMicro.a * rFine.b * 1.64), 1.9) * rimeMask;

          // Subtle wet dark-meniscus transition border right along an active melted frost shoreline.
          // On opaque condensed milk, damp the straight flute-valley rime stripe so milk's own micro-shards & frost shine!
          float milkRimeCalm = mix(1.0, 0.08, isMilkBase);
          color *= mix(1.0, 0.85, rimeWetEdge * 0.55 * milkRimeCalm);
          color = mix(color, frostSnowCol, totalFrostCov * milkRimeCalm);
          color += vec3(1.75, 1.70, 1.66) * (frostTuft * rimeMask * 0.62 + snowFlakeSpeck * 0.85 + frostSparkle * 0.58) * milkRimeCalm;
        }

        // Tag postIceRT.a so Pass 6b can apply a continuous capillary surface-tension blur & contact shadow
        // strictly where uncovered berries/strawberries physically emerge from melting ice (zero effect on
        // mid-air falling fruits or studio silhouettes!):
        //   0.00 = backdrop air, 0.25 = open ice, 0.55 = contact-zone ice hugging an emerging fruit, 1.00 = solid
        float isContactIce = ((hitsSolid && frontIceDist < 0.15) || texture(uBgBlur1, clamp(screenUv, vec2(0.002), vec2(0.998))).a > 0.02) ? 0.55 : 0.25;
        fragColor = vec4(color, isContactIce);
      }
    `,
  });

  return { material, uniforms };
}

/**
 * Creates 760 delicate trapped internal air micro-bubbles inside the frozen popsicle volume.
 * Rendered into a dedicated transparent `bubblesRT` (over alpha 0) so each bubble shows:
 * - Hollow transparent center (lets rich coral-pink ice shine straight through — ZERO white dots!)
 * - Razor-crisp dark ruby-brown TIR ring around its outer rim
 * - Tiny sparkling white specular pinpoint!
 */
function createInternalBubbles(seed: number): {
  mesh: THREE.InstancedMesh;
  data: Array<{ pos: THREE.Vector3; radius: number; stretchY: number; cosR: number; sinR: number }>;
  dispose(): void;
} {
  const count = 760;
  const rand = mulberry32(seed * 251 + 89);

  const geo = new THREE.SphereGeometry(1, 14, 10);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexShader: /* glsl */ `
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      varying float vDepthFront;

      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec4 mvPos = viewMatrix * wp;
        vNormalView = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        vViewDir = normalize(-mvPos.xyz);
        // Camera-relative frontness (works from front, side, and 180° back orbit!)
        float centerDepth = -(viewMatrix * vec4(0.0, wp.y, 0.0, 1.0)).z;
        float relFront = centerDepth - (-mvPos.z);
        vDepthFront = clamp((relFront + 0.14) / 0.34, 0.0, 1.0);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      varying float vDepthFront;

      float revStep(float hi, float lo, float x) { return 1.0 - smoothstep(lo, hi, x); }

      void main() {
        vec3 N = normalize(vNormalView);
        vec3 V = normalize(vViewDir);
        float ndv = clamp(dot(N, V), 0.0, 1.0);

        // Air bubble inside crimson-coral ice:
        // 1) Crisp dark ruby-espresso TIR contour ring around the rim
        float darkRing = revStep(0.68, 0.36, ndv) * smoothstep(0.05, 0.30, ndv);
        // 2) Subtle bright coral-peach inner caustic on lower hemisphere
        float innerCaustic = revStep(0.2, -0.75, N.y) * smoothstep(0.22, 0.72, ndv);
        // 3) Tiny razor-sharp white studio pinpoint catchlight on upper curve
        float spec = pow(max(dot(N, normalize(vec3(-0.46, 0.62, 0.63))), 0.0), 72.0);
        float spec2 = pow(max(dot(N, normalize(vec3(0.52, 0.44, 0.73))), 0.0), 90.0);

        // Rich dark crimson-maroon TIR ring + glowing apricot-peach caustic + crisp white sparkle!
        vec3 ringCol = vec3(0.24, 0.02, 0.035);
        vec3 causticCol = vec3(1.55, 0.88, 0.68);
        vec3 specCol = vec3(2.2, 2.05, 1.95);

        float ringW = darkRing * (0.58 + 0.36 * vDepthFront);
        float causW = innerCaustic * 0.32;
        float specW = (spec * 1.15 + spec2 * 0.65) * (0.55 + 0.45 * vDepthFront);

        float alpha = clamp(ringW + causW + specW, 0.0, 0.94);
        if (alpha < 0.01) discard;

        vec3 col = (ringCol * ringW + causticCol * causW + specCol * specW) / max(0.001, ringW + causW + specW);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;

  const data: Array<{ pos: THREE.Vector3; radius: number; stretchY: number; cosR: number; sinR: number }> = [];
  const baseState: MeltFieldState = {
    melt: DEFAULT_INITIAL_MELT,
    time: 0,
    seedOffset: seed * 13.7,
    heatSpots: [],
    pointerHeat: 0,
    pointerX: 0,
    pointerY: 0,
  };

  let created = 0;
  let tries = 0;
  while (created < count && tries < count * 14) {
    tries++;
    const y = POPSICLE.yBottom + 0.06 + rand() * (POPSICLE.yTop - POPSICLE.yBottom - 0.12);
    const x = (rand() * 2 - 1) * (POPSICLE.halfWidthBottom - 0.035);
    const zU = rand();
    const z = -0.06 + Math.pow(zU, 0.68) * 0.245;

    const depth = iceContainmentDepth(x, y, z, baseState);
    if (depth < 0.022) continue;

    // Realistic champagne-scale micro-bubbles (lots of tiny pinpricks 0.003..0.009 + occasional 0.015 bead!)
    const u = rand();
    const radius = 0.0028 + Math.pow(u, 3.6) * 0.0155;
    const stretchY = 1.0 + rand() * 0.32;
    const rotZ = (rand() - 0.5) * 0.45;

    data.push({
      pos: new THREE.Vector3(x, y, z),
      radius,
      stretchY,
      cosR: Math.cos(rotZ),
      sinR: Math.sin(rotZ),
    });
    created++;
  }

  return {
    mesh,
    data,
    dispose() {
      mesh.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}

export function createPopsicleIceSystem(
  seed: number,
  isMobile = false,
  initialRecipe: PopsicleRecipe = DEFAULT_RECIPE,
): PopsicleIceSystem {
  const segU = isMobile ? 84 : 112;
  const segV = isMobile ? 56 : 96;
  const vertexCount = (segU + 1) * (segV + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const hangs = new Float32Array(vertexCount);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const vNorm = iv / segV;
    for (let iu = 0; iu <= segU; iu++) {
      const uNorm = iu / segU;
      const idx = iv * (segU + 1) + iu;
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
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const normAttr = new THREE.BufferAttribute(normals, 3);
  const hangAttr = new THREE.BufferAttribute(hangs, 1);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  normAttr.setUsage(THREE.DynamicDrawUsage);
  hangAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('normal', normAttr);
  geometry.setAttribute('aHang', hangAttr);
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const { material: iceMat, uniforms } = createOpticalIceMaterial(initialRecipe);

  function setRecipe(nextRecipe: PopsicleRecipe) {
    const pal = resolveOpticalPalette(nextRecipe);
    uniforms.uOpacity.value = pal.opacity;
    uniforms.uIsDual.value = pal.isDual ? 1.0 : 0.0;
    uniforms.uSigmaA.value.set(...pal.sigmaA);
    uniforms.uCoreA.value.set(...pal.coreA);
    uniforms.uMidA.value.set(...pal.midA);
    uniforms.uDeepA.value.set(...pal.deepA);
    uniforms.uCreamAlbA.value.set(...pal.creamAlbedoA);
    uniforms.uCreamSssA.value.set(...pal.creamSssA);
    uniforms.uCreamDeepA.value.set(...pal.creamDeepA);
    uniforms.uSigmaB.value.set(...pal.sigmaB);
    uniforms.uCoreB.value.set(...pal.coreB);
    uniforms.uMidB.value.set(...pal.midB);
    uniforms.uDeepB.value.set(...pal.deepB);
    uniforms.uCreamAlbB.value.set(...pal.creamAlbedoB);
    uniforms.uCreamSssB.value.set(...pal.creamSssB);
    uniforms.uCreamDeepB.value.set(...pal.creamDeepB);
    uniforms.uStainCol.value.set(...pal.stainColor);
  }
  const iceMesh = new THREE.Mesh(geometry, iceMat);
  iceMesh.name = 'popsicle-ice';
  iceMesh.frustumCulled = false;

  const backZMat = createCameraDepthMaterial(0.0, THREE.BackSide);
  const backZMesh = new THREE.Mesh(geometry, backZMat);
  backZMesh.name = 'popsicle-ice-back-z';
  backZMesh.frustumCulled = false;

  // DoubleSide so thin curved toppings (e.g. shaved-lemon ribbons) write valid interior depth from both sides
  const solidWorldZMat = createCameraDepthMaterial(1.0, THREE.DoubleSide);

  const bubbles = createInternalBubbles(seed);
  bubbles.mesh.frustumCulled = false;

  const tmpPos: { x: number; y: number; z: number; hang?: number } = { x: 0, y: 0, z: 0, hang: 0 };

  const vTable = new Float32Array(segV + 1);
  for (let iv = 0; iv <= segV; iv++) {
    vTable[iv] = mapPopsicleVNorm(iv / segV);
  }

  // O(1) inverse LUT for vTable in `sampleLiveSurface`
  const V_INV_SIZE = 256;
  const vInvLUT = new Uint16Array(V_INV_SIZE + 1);
  {
    let ivCur = 0;
    for (let k = 0; k <= V_INV_SIZE; k++) {
      const target = k / V_INV_SIZE;
      while (ivCur + 1 < segV && vTable[ivCur + 1] <= target) ivCur++;
      vInvLUT[k] = ivCur;
    }
  }

  const sinThetaTable = new Float32Array(segU + 1);
  const cosThetaTable = new Float32Array(segU + 1);
  for (let iu = 0; iu <= segU; iu++) {
    const theta = iu === segU ? 0 : (iu / segU) * Math.PI * 2;
    sinThetaTable[iu] = Math.sin(theta);
    cosThetaTable[iu] = Math.cos(theta);
  }

  let lastMeshMelt = -999;
  let lastMeshTime = -999;
  let lastMeshSeed = -999;
  let lastMeshPool = -999;
  let lastPull0 = -999;
  let lastPull1 = -999;
  let lastPull2 = -999;
  let lastPull3 = -999;
  let lastBubbleMelt = -999;
  let lastBubbleDensity = -999;
  let visibleBubbleCount = 0;

  function update(state: MeltFieldState, bubbleDensity: number, forceMesh = false) {
    uniforms.uTime.value = state.time;
    uniforms.uMelt.value = state.melt;
    uniforms.uSeedOffset.value = state.seedOffset;

    const { slideY, iceGone } = getMeltBounds(state.melt);
    uniforms.uSlideY.value = slideY;
    if (iceGone) {
      iceMesh.visible = false;
      backZMesh.visible = false;
      bubbles.mesh.visible = false;
      return;
    }
    iceMesh.visible = true;
    backZMesh.visible = true;

    const curPull0 = state.pendantPull ? state.pendantPull[0] : 0;
    const curPull1 = state.pendantPull ? state.pendantPull[1] : 0;
    const curPull2 = state.pendantPull ? state.pendantPull[2] : 0;
    const curPull3 = state.pendantPull ? state.pendantPull[3] : 0;
    const curBottomPool = state.bottomPool ?? DEFAULT_BOTTOM_POOL;

    // Smart dirty-skip: rebuild geometry immediately on melt/pull/pool/heat change, or ~35Hz for silky hanging recoil!
    const needsMesh =
      forceMesh ||
      state.seedOffset !== lastMeshSeed ||
      Math.abs(state.melt - lastMeshMelt) > 0.00025 ||
      Math.abs(curBottomPool - lastMeshPool) > 0.005 ||
      Math.abs(curPull0 - lastPull0) > 0.004 ||
      Math.abs(curPull1 - lastPull1) > 0.004 ||
      Math.abs(curPull2 - lastPull2) > 0.004 ||
      Math.abs(curPull3 - lastPull3) > 0.004 ||
      Math.abs(state.time - lastMeshTime) > 0.028 ||
      state.pointerHeat > 0.015;

    if (needsMesh) {
      lastMeshMelt = state.melt;
      lastMeshTime = state.time;
      lastMeshSeed = state.seedOffset;
      lastMeshPool = curBottomPool;
      lastPull0 = curPull0;
      lastPull1 = curPull1;
      lastPull2 = curPull2;
      lastPull3 = curPull3;

      const stride = segU + 1;
      const frame = prepareProfileFrame(state);

      for (let iv = 0; iv <= segV; iv++) {
        const row = prepareProfileRow(vTable[iv], frame);
        const rowOff = iv * stride;
        for (let iu = 0; iu < segU; iu++) {
          evaluatePopsicleVertex(sinThetaTable[iu], cosThetaTable[iu], frame, row, state, tmpPos);
          const vIdx = rowOff + iu;
          const o = vIdx * 3;
          positions[o] = tmpPos.x;
          positions[o + 1] = tmpPos.y;
          positions[o + 2] = tmpPos.z;
          hangs[vIdx] = tmpPos.hang ?? 0;
        }
        // Duplicate seam vertex iu = segU directly from iu = 0 (zero redundant evaluation!)
        const o0 = rowOff * 3;
        const oSeam = (rowOff + segU) * 3;
        positions[oSeam] = positions[o0];
        positions[oSeam + 1] = positions[o0 + 1];
        positions[oSeam + 2] = positions[o0 + 2];
        hangs[rowOff + segU] = hangs[rowOff];
      }

      for (let iv = 0; iv <= segV; iv++) {
        const rowOff = iv * stride;
        if (iv === 0) {
          for (let iu = 0; iu < segU; iu++) {
            const o = (rowOff + iu) * 3;
            const iuPrev = iu === 0 ? segU - 1 : iu - 1;
            const iuNext = iu + 1;
            const oL = (rowOff + iuPrev) * 3;
            const oR = (rowOff + iuNext) * 3;
            const dx = positions[oR] - positions[oL];
            const dy = positions[oR + 1] - positions[oL + 1];
            const slopeX = Math.abs(dx) > 1e-4 ? clamp(dy / dx, -1.65, 1.65) : 0;
            const invLen = 1.0 / Math.hypot(slopeX, 1.0);
            normals[o] = slopeX * invLen;
            normals[o + 1] = -invLen;
            normals[o + 2] = 0;
          }
        } else if (iv === segV) {
          for (let iu = 0; iu < segU; iu++) {
            const o = (rowOff + iu) * 3;
            normals[o] = 0;
            normals[o + 1] = 1;
            normals[o + 2] = 0;
          }
        } else {
          const rowD = (iv - 1) * stride;
          const rowU = (iv + 1) * stride;
          for (let iu = 0; iu < segU; iu++) {
            const o = (rowOff + iu) * 3;
            const iuPrev = iu === 0 ? segU - 1 : iu - 1;
            const iuNext = iu + 1;
            const oL = (rowOff + iuPrev) * 3;
            const oR = (rowOff + iuNext) * 3;
            const oD = (rowD + iu) * 3;
            const oU = (rowU + iu) * 3;

            const dux = positions[oR] - positions[oL];
            const duy = positions[oR + 1] - positions[oL + 1];
            const duz = positions[oR + 2] - positions[oL + 2];

            const dvx = positions[oU] - positions[oD];
            const dvy = positions[oU + 1] - positions[oD + 1];
            const dvz = positions[oU + 2] - positions[oD + 2];

            let nx = duy * dvz - duz * dvy;
            let ny = duz * dvx - dux * dvz;
            let nz = dux * dvy - duy * dvx;
            const len = Math.hypot(nx, ny, nz);
            if (len > 1e-7) {
              const invL = 1.0 / len;
              nx *= invL;
              ny *= invL;
              nz *= invL;
            } else {
              nx = 0;
              ny = 0;
              nz = 1;
            }
            normals[o] = nx;
            normals[o + 1] = ny;
            normals[o + 2] = nz;
          }
        }
        // Copy seam normal iu = segU from iu = 0
        const o0 = rowOff * 3;
        const oSeam = (rowOff + segU) * 3;
        normals[oSeam] = normals[o0];
        normals[oSeam + 1] = normals[o0 + 1];
        normals[oSeam + 2] = normals[o0 + 2];
      }

      posAttr.needsUpdate = true;
      normAttr.needsUpdate = true;
      hangAttr.needsUpdate = true;
      if (forceMesh || lastBubbleMelt < -100) {
        geometry.computeBoundingSphere();
      }
    }

    // Only re-evaluate internal bubble matrices when melt or pointer heat meaningfully changes!
    // Compact visible instances into `bubbles.mesh.count` so opaque coconut / melted stages skip dead draws.
    const needsBubbles =
      forceMesh ||
      bubbleDensity !== lastBubbleDensity ||
      Math.abs(state.melt - lastBubbleMelt) > 0.0018 ||
      state.pointerHeat > 0.02;

    if (needsBubbles) {
      lastBubbleMelt = state.melt;
      lastBubbleDensity = bubbleDensity;

      const activeCount = Math.floor(bubbles.data.length * clamp(bubbleDensity, 0, 1));
      const matArr = bubbles.mesh.instanceMatrix.array as Float32Array;
      let writeSlot = 0;
      for (let i = 0; i < activeCount; i++) {
        const b = bubbles.data[i];
        const by = b.pos.y + slideY;
        const depth = iceContainmentDepth(b.pos.x, by, b.pos.z, state);
        const vis = smoothstep(0.010, 0.045, depth);
        if (vis <= 0.001) continue;

        const sx = b.radius * vis;
        const sy = sx * b.stretchY;
        const o = writeSlot * 16;
        // Direct column-major TRS matrix (rotation Z + scale + translation) — zero Object3D overhead!
        matArr[o] = b.cosR * sx;
        matArr[o + 1] = b.sinR * sx;
        matArr[o + 2] = 0;
        matArr[o + 3] = 0;
        matArr[o + 4] = -b.sinR * sy;
        matArr[o + 5] = b.cosR * sy;
        matArr[o + 6] = 0;
        matArr[o + 7] = 0;
        matArr[o + 8] = 0;
        matArr[o + 9] = 0;
        matArr[o + 10] = sx;
        matArr[o + 11] = 0;
        matArr[o + 12] = b.pos.x;
        matArr[o + 13] = by;
        matArr[o + 14] = b.pos.z;
        matArr[o + 15] = 1;
        writeSlot++;
      }
      visibleBubbleCount = writeSlot;
      bubbles.mesh.count = writeSlot;
      bubbles.mesh.instanceMatrix.needsUpdate = true;
    }
    bubbles.mesh.visible = visibleBubbleCount > 0 && uniforms.uOpacity.value < 0.96;
  }

  function sampleLiveSurface(uNorm: number, vNorm: number, outPos: THREE.Vector3, outNormal: THREE.Vector3) {
    const uWrapped = ((uNorm % 1) + 1) % 1;
    const vClamped = clamp(vNorm, 0, 1);

    const fu = uWrapped * segU;
    const iu0 = Math.floor(fu);
    const iu1 = Math.min(segU, iu0 + 1);
    const tu = fu - iu0;

    let iv0 = vInvLUT[(vClamped * V_INV_SIZE) | 0];
    while (iv0 + 1 < segV && vTable[iv0 + 1] <= vClamped) iv0++;
    while (iv0 > 0 && vTable[iv0] > vClamped) iv0--;
    const iv1 = iv0 + 1;
    const span = Math.max(1e-5, vTable[iv1] - vTable[iv0]);
    const tv = clamp((vClamped - vTable[iv0]) / span, 0, 1);

    const stride = segU + 1;
    const i00 = (iv0 * stride + iu0) * 3;
    const i10 = (iv0 * stride + iu1) * 3;
    const i01 = (iv1 * stride + iu0) * 3;
    const i11 = (iv1 * stride + iu1) * 3;

    const w00 = (1 - tu) * (1 - tv);
    const w10 = tu * (1 - tv);
    const w01 = (1 - tu) * tv;
    const w11 = tu * tv;

    outPos.set(
      positions[i00] * w00 + positions[i10] * w10 + positions[i01] * w01 + positions[i11] * w11,
      positions[i00 + 1] * w00 + positions[i10 + 1] * w10 + positions[i01 + 1] * w01 + positions[i11 + 1] * w11,
      positions[i00 + 2] * w00 + positions[i10 + 2] * w10 + positions[i01 + 2] * w01 + positions[i11 + 2] * w11,
    );

    outNormal
      .set(
        normals[i00] * w00 + normals[i10] * w10 + normals[i01] * w01 + normals[i11] * w11,
        normals[i00 + 1] * w00 + normals[i10 + 1] * w10 + normals[i01 + 1] * w01 + normals[i11 + 1] * w11,
        normals[i00 + 2] * w00 + normals[i10 + 2] * w10 + normals[i01 + 2] * w01 + normals[i11 + 2] * w11,
      )
      .normalize();
  }

  function dispose() {
    geometry.dispose();
    iceMat.dispose();
    backZMat.dispose();
    solidWorldZMat.dispose();
    bubbles.dispose();
  }

  return {
    iceMesh,
    backZMesh,
    bubblesMesh: bubbles.mesh,
    solidWorldZMat,
    uniforms,
    setRecipe,
    update,
    sampleLiveSurface,
    dispose,
  };
}
