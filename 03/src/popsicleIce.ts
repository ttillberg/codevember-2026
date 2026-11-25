import * as THREE from 'three';
import { clamp, mulberry32, smoothstep } from './rng';
import { getSharedNoise3DTexture } from './noise3d';
import { evaluatePopsicleProfile, getMeltBounds, iceContainmentDepth, MeltFieldState, POPSICLE } from './shape';
import { DEFAULT_RECIPE, PopsicleRecipe, resolveOpticalPalette } from './recipe';

export interface IceUniforms {
  uBgTex: { value: THREE.Texture | null };
  uBgBlur1: { value: THREE.Texture | null };
  uBgBlur2: { value: THREE.Texture | null };
  uBubblesTex: { value: THREE.Texture | null };
  uFilmTex: { value: THREE.Texture | null };
  uRimeTex: { value: THREE.Texture | null };
  uInteriorZ: { value: THREE.Texture | null };
  uBackIceZ: { value: THREE.Texture | null };
  uNoise3D: { value: THREE.Data3DTexture };
  uResolution: { value: THREE.Vector2 };
  uTime: { value: number };
  uMelt: { value: number };
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

function createWorldZMaterial(tag: number, side: THREE.Side): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side,
    depthTest: true,
    depthWrite: true,
    uniforms: {
      uTag: { value: tag },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTag;
      varying vec3 vWorldPos;
      void main() {
        gl_FragColor = vec4(vWorldPos.z, uTag, 0.0, 1.0);
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
    uBubblesTex: { value: null },
    uFilmTex: { value: null },
    uRimeTex: { value: null },
    uInteriorZ: { value: null },
    uBackIceZ: { value: null },
    uNoise3D: { value: getSharedNoise3DTexture() },
    uResolution: { value: new THREE.Vector2(1280, 720) },
    uTime: { value: 0 },
    uMelt: { value: 0.035 },
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

      void main() {
        vUv = uv;
        vHang = aHang;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler3D;

      uniform sampler2D uBgTex;
      uniform sampler2D uBgBlur1;
      uniform sampler2D uBgBlur2;
      uniform sampler2D uBubblesTex;
      uniform sampler2D uFilmTex;
      uniform sampler2D uRimeTex;
      uniform sampler2D uInteriorZ;
      uniform sampler2D uBackIceZ;
      uniform sampler3D uNoise3D;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform float uMelt;
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

      out vec4 fragColor;

      // Single-cycle hardware-trilinear 3D texture lookups replacing 15x 4-octave FBM & 54-iter Voronoi loops!
      // Channels: R = 2-oct FBM (period 6), G = independent 2-oct FBM (period 6),
      //           B = 3D Voronoi cell height (period 8), A = fine 2-oct detail noise (period 12)
      const float INV_P6 = 1.0 / 6.0;
      const float INV_P8 = 1.0 / 8.0;
      const float INV_P12 = 1.0 / 12.0;

      float fbm3Tex(vec3 p) {
        vec4 s = texture(uNoise3D, p * INV_P6);
        return s.r * 0.72 + s.a * 0.28;
      }

      float vnoiseTex(vec3 p) {
        return texture(uNoise3D, p * INV_P12).a;
      }

      // Tactile thawing ice micro-relief + spatially varied frozen crystal roughness + baked 3D Voronoi slush beads!
      // Uses only 7 hardware texture3D fetches instead of 128 hashes + 54 nested Voronoi loop iterations (~12x faster!)
      vec3 perturbNormal(vec3 N, vec3 p, float glazeCover, float localFreezeRough, float sweatMask, out float microGrain, out float slushBump) {
        vec3 sp = (p * vec3(9.5, 4.5, 9.5) + vec3(uSeedOffset, uTime * 0.04, 0.0)) * INV_P6;
        float eW = 0.008;
        float h0 = texture(uNoise3D, sp).r;
        float hx = texture(uNoise3D, sp + vec3(eW, 0.0, 0.0)).r;
        float hy = texture(uNoise3D, sp + vec3(0.0, eW, 0.0)).r;
        float hz = texture(uNoise3D, sp + vec3(0.0, 0.0, eW)).r;
        vec3 wetGrad = vec3(hx - h0, hy - h0, hz - h0) / 0.048;

        // Two-scale fine sweaty wet crystalline micro-pebbling & granita slush (matching real macro melt photos!):
        // - Outside thick flowing syrup sheets, thawed ice looks intensely sweaty & finely pebbled right away;
        // - Thick creeping sticky glaze layers (glazeCover) level those pebbles into smooth mirror-glossy syrup;
        // - In mid-to-late melt (uMelt -> 0.35..0.78), dense sparkling granular slush breaks through across the whole body!
        float earlySweat = (0.34 + 0.38 * smoothstep(0.05, 0.32, uMelt)) * sweatMask;
        float deepSlush = smoothstep(0.28, 0.72, uMelt) * 1.05;
        float glazeLeveling = mix(0.88, 0.38, smoothstep(0.32, 0.72, uMelt));
        float slushAmt = clamp((earlySweat + deepSlush) * (1.0 - glazeCover * glazeLeveling), 0.0, 1.35);

        vec3 cmP = (p * 116.0 + vec3(uSeedOffset * 1.3)) * INV_P8;
        float eC = 0.022;
        vec4 cm0 = texture(uNoise3D, cmP);
        float cmX = texture(uNoise3D, cmP + vec3(eC, 0.0, 0.0)).b;
        float cmY = texture(uNoise3D, cmP + vec3(0.0, eC, 0.0)).b;
        float cmZ = texture(uNoise3D, cmP + vec3(0.0, 0.0, eC)).b;
        vec3 cellPert = vec3(cm0.b - cmX, cm0.b - cmY, cm0.b - cmZ) * 5.2;

        // Ultra-fine sparkling wet sweat & sugar-ice micro-facets
        vec4 cf = texture(uNoise3D, (p * 192.0 + vec3(uSeedOffset * 2.9)) * INV_P12);
        vec3 microFacetPert = vec3(cf.r - 0.5, cf.g - 0.5, cf.a - 0.5) * (0.48 * slushAmt);
        microGrain = clamp(cf.a * 0.46 + cm0.b * 0.54, 0.0, 1.0);
        slushBump = slushAmt * smoothstep(0.26, 0.90, cm0.b * 0.60 + cf.a * 0.40);

        float domeFrost = 1.0 + smoothstep(0.45, 1.05, p.y) * 0.45;
        float freezeCrystalRelief = (0.022 + 0.135 * localFreezeRough) * uFrost * domeFrost * (1.0 - glazeCover * 0.72);
        vec3 pert =
          wetGrad * (0.030 + uMelt * 0.018) * (1.0 - glazeCover * 0.65) +
          cellPert * (freezeCrystalRelief + 0.34 * slushAmt) +
          microFacetPert;

        pert -= N * dot(pert, N);
        return normalize(N - pert);
      }

      vec3 sampleFrostedBg(vec2 uv, float blurAmt) {
        vec2 cUv = clamp(uv, vec2(0.002), vec2(0.998));
        vec3 sharp = texture(uBgTex, cUv).rgb;
        vec3 mid = texture(uBgBlur1, cUv).rgb;
        vec3 deep = texture(uBgBlur2, cUv).rgb;
        if (blurAmt < 0.5) {
          return mix(sharp, mid, blurAmt * 2.0);
        }
        return mix(mid, deep, (blurAmt - 0.5) * 2.0);
      }

      // Crisp backlit macro studio reflections: dark front fill so coral-ruby ice stays deeply saturated!
      vec3 evalMacroStudioReflection(vec3 R, float roughness) {
        vec3 r = normalize(R);
        vec3 col = vec3(0.06, 0.03, 0.03);
        float sharp = mix(1.0, 0.20, roughness);

        // Narrow twin vertical strip-lights (silky thin reflection ribbons!)
        float stripY = smoothstep(-0.90, -0.58, r.y) * smoothstep(0.92, 0.62, r.y);
        float wNarrow = 0.034 + roughness * 0.13;
        float leftStrip = exp(-pow((r.x + 0.56) / wNarrow, 2.0));
        float rightStrip = exp(-pow((r.x - 0.56) / wNarrow, 2.0));
        float stripZ = smoothstep(-0.18, 0.45, r.z);
        col += vec3(2.1, 1.95, 1.88) * (leftStrip + rightStrip) * stripY * stripZ * (0.35 + 0.85 * sharp);

        // Crisp grazing outer wall rim strip
        float rimStrip = exp(-pow((abs(r.x) - 0.89) / (0.048 + roughness * 0.12), 2.0)) * stripY;
        col += vec3(2.25, 2.06, 1.98) * rimStrip * (0.42 + 0.78 * sharp);

        // Overhead curved dome softbox highlight
        float topBox = smoothstep(0.68 - roughness * 0.18, 0.94, r.y) *
                       exp(-pow(r.x / (0.38 + roughness * 0.22), 2.0));
        col += vec3(1.15, 1.02, 0.98) * topBox * (0.28 + 0.55 * sharp);

        return col;
      }

      void main() {
        vec2 screenUv = gl_FragCoord.xy / uResolution;
        vec3 N0 = normalize(vWorldNormal);

        // === SAMPLE CONTINUOUS 2D VISCOUS LIQUID GLAZE FILM & FREEZER HOARFROST RIME ===
        vec4 filmSample = texture(uFilmTex, vUv);
        float filmH = filmSample.r;
        vec2 filmSlope = (filmSample.gb - 0.5) * 2.0;
        float wetMem = filmSample.a;
        float rimeRaw = texture(uRimeTex, vUv).r;

        // Multi-scale crystalline hoarfrost needles & tiny snowy crystal tufts (inspired by freezer-fresh macro!)
        vec4 rFine = texture(uNoise3D, (vWorldPos * 96.0 + vec3(uSeedOffset * 2.1)) * INV_P12);
        vec4 rMicro = texture(uNoise3D, (vWorldPos * 235.0 + vec3(-4.2, uSeedOffset * 3.7, 2.8)) * INV_P12);
        vec4 rTuft = texture(uNoise3D, (vWorldPos * 32.0 + vec3(uSeedOffset * 1.1, 3.3, -1.7)) * INV_P8);
        float rimeGrain = rFine.a * 0.48 + rMicro.a * 0.52;
        float frostScale = clamp(uFrost / 0.58, 0.25, 1.45);
        float rimeMaskPre = smoothstep(0.10, 0.64, rimeRaw * (0.86 + 0.26 * frostScale) + (rimeGrain - 0.5) * 0.42);

        // Sleek bottom-edge transparency band (keeps glowing cloudy pink rim & rich backlit body above,
        // while the thinning bottom meniscus turns crystal-clear like the drops breaking away from it!)
        float hangLiquid = smoothstep(0.08, 0.55, vHang);
        float meltClearGate = smoothstep(0.045, 0.18, uMelt) * (1.0 - rimeMaskPre * 0.92);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float N0dotV = clamp(dot(N0, V), 0.0, 1.0);
        float bottomEdgeClear = smoothstep(0.145, 0.014, vUv.y) * meltClearGate;
        float hangTipClear = smoothstep(0.24, 0.72, vHang);
        float hangClear = clamp(max(hangTipClear, bottomEdgeClear * 0.95), 0.0, 1.0) * (1.0 - uOpacity * 0.88);

        // Thick flowing sticky glaze lobes + accumulated sticky bottom-rim puddles level frost into mirror-glossy syrup!
        float sweatMask = (1.0 - rimeMaskPre) * (1.0 - max(hangLiquid, hangClear) * 0.94);
        float bottomPoolZone = max(
          smoothstep(0.16, 0.015, vUv.y) * (1.0 - smoothstep(0.62, 0.95, uMelt)) * smoothstep(0.04, 0.14, uMelt) * (1.0 - rimeMaskPre * 0.85),
          hangLiquid
        );
        float glazeWave = smoothstep(0.16, 0.52, filmH) * (1.0 - rimeMaskPre * 0.88);
        float glazeThick = smoothstep(0.30, 0.82, filmH) * (1.0 - rimeMaskPre * 0.88);
        float glazeCover = max(glazeWave, max(bottomPoolZone * 0.85, max(hangLiquid, hangClear) * 0.98));
        float lipSlope = length(filmSlope);
        float glazeEdge = smoothstep(0.06, 0.44, lipSlope) * smoothstep(0.11, 0.36, filmH) * (1.0 - rimeMaskPre * 0.82);

        // Domain-warped spatial freeze-roughness field (2 texture fetches instead of 4x4-octave FBM!)
        vec3 volPos = vWorldPos * vec3(2.9, 2.5, 3.4) + vec3(uSeedOffset, 0.0, 0.0);
        vec4 wSampA = texture(uNoise3D, (volPos * 1.35 + vec3(4.1, 1.7, 2.9)) * INV_P6);
        float wSampB = texture(uNoise3D, (volPos * 1.35 + vec3(2.2, -5.1, 7.3)) * INV_P6).r;
        vec3 warpOff = vec3(wSampA.r, wSampA.g, wSampB) - 0.5;
        vec3 warpedVol = volPos + warpOff * 1.25;

        float nearFluteWall = exp(-pow((abs(vWorldPos.x) - 0.165) / 0.052, 2.0)) * smoothstep(0.32, 0.04, uMelt);
        vec4 patchSamp = texture(uNoise3D, (warpedVol * 1.85 + vec3(-2.7, 3.8, 1.5)) * INV_P6);
        float freezePatchRaw = patchSamp.r * 0.72 + patchSamp.a * 0.28;
        float freezeRoughBase = clamp(
          pow(smoothstep(0.28, 0.72, freezePatchRaw), 1.35) * 0.92 +
          nearFluteWall * 0.38 +
          smoothstep(0.55, 1.05, vWorldPos.y) * 0.22,
          0.06,
          1.0
        ) * uFrost;

        float microGrain = 0.0;
        float slushFacet = 0.0;
        vec3 N_ice = perturbNormal(N0, vWorldPos, glazeCover, freezeRoughBase, sweatMask, microGrain, slushFacet);

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

        float NdotV = clamp(dot(N, V), 0.0, 1.0);

        float zFront = vWorldPos.z;
        float zBackRaw = texture(uBackIceZ, screenUv).r;
        float zBack = (zBackRaw > -5.0) ? zBackRaw : (zFront - 0.36);
        float totalThickness = clamp(zFront - zBack, 0.03, 0.56);

        // Check exact un-refracted solid depth first so shallow/emerging fruits don't refract 15px off into white backdrop!
        vec2 rawIntSample = texture(uInteriorZ, screenUv).rg;
        bool rawHitsSolid = (rawIntSample.g > 0.5) && (rawIntSample.r > zBack - 0.06) && (rawIntSample.r <= zFront + 0.05);
        float rawFrontDist = rawHitsSolid ? clamp(zFront - rawIntSample.r, 0.0, totalThickness) : totalThickness;
        // Physically, Snell screen displacement scales with actual ice thickness above the fruit (Δx ∝ d -> 0 at emergence!)
        float refrDepthScale = rawHitsSolid ? smoothstep(0.002, 0.115, rawFrontDist) : 1.0;

        // Snell screen-space refraction (IOR = 1.31); keep clear bottom liquid edge gentle so it never drags
        // upward strawberry core smears or crimson grazing slivers down onto the transparent underside silhouette!
        float edgeBend = mix(0.014, 0.042, pow(1.0 - N0dotV, 1.30)) * (1.0 - hangClear * 0.34);
        vec2 refrN = vec2(N.x, N.y * (1.0 - hangClear * 0.45));
        vec2 baseOffset = (-refrN * edgeBend * (0.72 + totalThickness * 1.15) - filmSlope * (0.0085 * glazeWave)) * refrDepthScale;

        vec2 uvR = screenUv + baseOffset * 0.94;
        vec2 uvG = screenUv + baseOffset * 1.00;
        vec2 uvB = screenUv + baseOffset * 1.07;

        // Exact front ice thickness to solid embedded fruits & stick
        vec2 interiorSample = texture(uInteriorZ, clamp(uvG, vec2(0.002), vec2(0.998))).rg;
        bool hitsSolid = (interiorSample.g > 0.5) && (interiorSample.r > zBack - 0.06) && (interiorSample.r <= zFront + 0.04);
        float frontIceDist = hitsSolid ? clamp(zFront - interiorSample.r, 0.0, totalThickness) : totalThickness;
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
        float freezeStreaks = fbm3Tex(vec3(vWorldPos.x * 13.5 + warpOff.x * 2.2 + uSeedOffset, vWorldPos.y * 2.6, vWorldPos.z * 11.0));

        float fruitNucleation = hitsSolid ? smoothstep(0.024, 0.085, frontIceDist) * smoothstep(0.24, 0.095, frontIceDist) : 0.0;
        float freezeRoughZone = clamp(freezeRoughBase + fruitNucleation * 0.32 * uFrost, 0.06, 1.0);

        // Two-depth parallax-shifted 3D internal volume sampling (3 fetches total!)
        vec3 innerPosA = vWorldPos - V * clamp(frontIceDist * 0.36, 0.018, 0.095);
        vec3 innerPosB = vWorldPos - V * clamp(frontIceDist * 0.72, 0.040, 0.19);
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

        vec2 roughJitter = vec2(innerGranuleFine - 0.5, innerGranuleMicro - 0.5) * (0.0072 * freezeRoughZone * (1.0 - glazeCover * 0.45) * thinIceFade);
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

        vec3 bgCol;
        bgCol.r = sampleFrostedBg(uvR, blurAmt).r;
        bgCol.g = sampleFrostedBg(uvG, blurAmt).g;
        bgCol.b = sampleFrostedBg(uvB, blurAmt).b;

        float grazingPath = 1.0 / max(0.34, N0dotV);
        float opticalDist = frontIceDist * mix(1.0, grazingPath, 0.50);

        // === DYNAMIC FLAVOR PALETTE (1 OR 2 ORGANICALLY SWIRLED TASTES) + WATER vs OPAQUE COCONUT BASE ===
        float bottomRichness = smoothstep(0.22, -0.98, vWorldPos.y);
        float topRuby = smoothstep(0.70, 1.08, vWorldPos.y);
        float edgeRichness = pow(1.0 - N0dotV, 1.32);
        float fluteOptical = smoothstep(0.10, 0.34, abs(N0.x)) * smoothstep(0.76, 0.38, abs(N0.x));

        // Organic dual-flavor layered/marbled swirl (Flavor A upper half -> Flavor B lower half)
        float swirlWave = (cloudMacro - 0.5) * 0.46 + (cloudMed - 0.5) * 0.24 + sin(vWorldPos.x * 4.4 + uSeedOffset) * 0.08;
        float dualMix = uIsDual > 0.5 ? smoothstep(-0.34, 0.34, -vWorldPos.y + swirlWave) : 0.0;

        vec3 flvSigma = mix(uSigmaA, uSigmaB, dualMix);
        vec3 flvCore = mix(uCoreA, uCoreB, dualMix);
        vec3 flvMid = mix(uMidA, uMidB, dualMix);
        vec3 flvDeep = mix(uDeepA, uDeepB, dualMix);
        vec3 flvCreamAlb = mix(uCreamAlbA, uCreamAlbB, dualMix);
        vec3 flvCreamSss = mix(uCreamSssA, uCreamSssB, dualMix);
        vec3 flvCreamDeep = mix(uCreamDeepA, uCreamDeepB, dualMix);

        // Reuses baked G channel of cloudSamp (zero extra texture fetches!) for subtle internal sunlit pockets
        float warmPocketNoise = cloudSamp.g * 0.72 + wSampA.a * 0.28;
        float downwardWarmth = smoothstep(0.55, -0.82, vWorldPos.y);
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
        float lightboxCore = exp(-dot(vWorldPos.xy * vec2(0.72, 0.48), vWorldPos.xy * vec2(0.72, 0.48)));
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
        float creviceDark = smoothstep(0.46, 0.14, crunchyPattern) * smoothstep(0.34, 0.82, freezeRoughZone) * (1.0 - uMelt * 0.42);

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

        float innerRubyRim = smoothstep(0.54, 0.16, N0dotV) * smoothstep(0.02, 0.16, N0dotV) * thinIceFade * (1.0 - uOpacity * 0.82) * (1.0 - hangClear * 0.88);
        iceBody = mix(iceBody, iceBody * clamp(flvMid * 0.85, vec3(0.15), vec3(1.15)) + flvDeep * 0.40, innerRubyRim * 0.54);

        // === OPAQUE CREAMY COCONUT-MILK BASE (and natural pulp opacity for banana/chocolate!) ===
        if (uOpacity > 0.01) {
          vec3 cKeyL = normalize(vec3(-0.62, 0.46, 0.64));
          vec3 cKeyR = normalize(vec3(0.64, 0.40, 0.65));
          vec3 cKeyT = normalize(vec3(-0.14, 0.80, 0.58));

          // Soft half-Lambert creamy wrap diffuse + warm backlit milky subsurface rim glow
          float wL = clamp((dot(N, cKeyL) + 0.62) / 1.62, 0.0, 1.0);
          float wR = clamp((dot(N, cKeyR) + 0.62) / 1.62, 0.0, 1.0);
          float wT = clamp((dot(N, cKeyT) + 0.50) / 1.50, 0.0, 1.0);
          float creamLight = 0.42 + 0.34 * wL + 0.22 * wR + 0.14 * wT;
          float creamGrain = 0.94 + 0.10 * (crunchyPattern - 0.5) + 0.05 * (cloudMed - 0.5) - creviceDark * 0.07;

          float rimSss = pow(1.0 - N0dotV, 2.05) * (0.30 + 0.28 * lightboxCore);
          vec3 creamBase = mix(flvCreamDeep, flvCreamAlb, clamp(creamLight, 0.0, 1.0)) * creamGrain;
          // Gentle warm backlit milky translucency around the edges & subtle center glow
          creamBase += flvCreamSss * (rimSss * 0.42 + lightboxCore * 0.10);

          // Toppings pressed close to the mold wall softly peek through a thin milky coconut veil
          // (just like real strawberry-coconut & cookies-and-cream paletas!)
          if (hitsSolid) {
            float creamPeek = exp(-frontIceDist * 26.0) * smoothstep(0.105, 0.0, frontIceDist);
            vec3 peekTint = mix(bgCol, bgCol * mix(vec3(1.0), flvCreamAlb, 0.22), 0.45);
            creamBase = mix(creamBase, peekTint, clamp(creamPeek * 0.90, 0.0, 0.96));
          }

          // Glossy wet melted cream slightly deepens & saturates where liquid glaze flows
          creamBase *= mix(vec3(1.0), vec3(0.92, 0.90, 0.88), glazeCover * 0.28);

          iceBody = mix(iceBody, creamBase, clamp(uOpacity * thinIceFade, 0.0, 0.96));
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
        float hangGlassRim = smoothstep(0.62, 0.14, N0dotV) * hangClear;
        vec3 dropRimTint = mix(vec3(0.46, 0.22, 0.24), uStainCol * 0.48, 0.65);
        iceBody = mix(iceBody, iceBody * dropRimTint, clamp(hangGlassRim * 0.64, 0.0, 0.66));

        // === INTERNAL TRAPPED AIR MICRO-BUBBLES (hidden inside opaque coconut & clear hanging liquid syrup!) ===
        vec4 bub = texture(uBubblesTex, clamp(uvG, vec2(0.002), vec2(0.998)));
        float bubVis = clamp(bub.a * 0.92 * thinIceFade * (1.0 - uOpacity * 0.92) * (1.0 - hangLiquid * 0.94), 0.0, 0.92);
        iceBody = mix(iceBody, bub.rgb, bubVis);

        // === WET GLAZE FRESNEL, SOFT SYRUPY SHEEN & SPARKLING VORONOI SLUSH PINPOINTS ===
        vec3 R_glaze = reflect(-V, N_glaze);
        vec3 R_smooth = reflect(-V, N0);

        float fresnel = (0.02 + 0.98 * pow(1.0 - clamp(dot(N_glaze, V), 0.0, 1.0), 4.8)) * edgeMeltFade * (0.35 + 0.65 * thinIceFade);
        float shoulderGlareTame = mix(1.0, 0.48, smoothstep(0.55, 0.95, vWorldPos.y));
        float filmRough = mix(0.10, 0.045, glazeCover);
        vec3 specWet = evalMacroStudioReflection(R_glaze, filmRough) * shoulderGlareTame;
        vec3 specSatin = evalMacroStudioReflection(R_smooth, 0.32) * shoulderGlareTame;

        // Dry powdery hoarfrost damps mirror-glossy studio reflections so freshly melted streaks pop as wet glass!
        float dryFrostMatte = 1.0 - rimeMask * 0.84;
        float glazeSpecBoost = (1.0 + glazeCover * 0.45 + wetMem * 0.16) * dryFrostMatte;
        vec3 color =
          iceBody * (1.0 - fresnel * 0.38 * dryFrostMatte) +
          specWet * (fresnel * 0.72 * glazeSpecBoost) +
          specSatin * (fresnel * 0.14 * frostFactor * (1.0 - glazeCover * 0.75) * thinIceFade * dryFrostMatte);

        // Organic, crystal-broken frosted specular ridges along the twin molded flutes
        vec3 R_flute = reflect(-V, normalize(mix(N0, N_ice, 0.55)));
        float nearFluteTrack = exp(-pow((abs(vWorldPos.x) - 0.165) / 0.064, 2.0));
        float fluteFade = smoothstep(0.28, 0.05, uMelt);
        float fluteBreakup = smoothstep(0.18, 0.82, innerGranuleCoarse);
        float fluteCrystalSpark = smoothstep(0.45, 0.95, innerGranuleMicro) * 0.85;
        float fluteBand = exp(-pow((abs(R_flute.x) - 0.34) / 0.056, 2.0)) *
                          smoothstep(0.08, 0.24, abs(N0.x)) *
                          smoothstep(0.54, 0.24, abs(N0.x)) *
                          smoothstep(-0.86, -0.60, vWorldPos.y) *
                          smoothstep(0.88, 0.62, vWorldPos.y) *
                          nearFluteTrack * fluteFade;
        float fluteLine = fluteBand * (0.28 + 0.82 * fluteBreakup + fluteCrystalSpark + freezeVeins * 0.45);
        color += mix(vec3(1.56, 1.38, 1.34), vec3(1.68, 1.48, 1.24), warmNuance * 0.45) * fluteLine * 0.34 * edgeMeltFade * dryFrostMatte;

        // Crisp scattered sparkling wet micro-crystal pinpoints across porous thawing sugar-ice
        vec3 keyL = normalize(vec3(-0.66, 0.46, 0.59));
        vec3 keyR = normalize(vec3(0.66, 0.42, 0.62));
        vec3 keyTop = normalize(vec3(-0.18, 0.78, 0.60));
        vec3 hL = normalize(keyL + V);
        vec3 hR = normalize(keyR + V);
        vec3 hT = normalize(keyTop + V);

        float crystalGlint =
          pow(max(dot(N, hL), 0.0), 460.0) * 1.55 +
          pow(max(dot(N, hR), 0.0), 460.0) * 1.35 +
          pow(max(dot(N, hT), 0.0), 540.0) * 1.45;

        float softGlazeSheen =
          (pow(max(dot(N_glaze, hL), 0.0), 135.0) * 0.82 +
           pow(max(dot(N_glaze, hR), 0.0), 135.0) * 0.68 +
           pow(max(dot(N_glaze, hT), 0.0), 175.0) * 0.62) *
          clamp(glazeCover * 0.68 + glazeEdge * 1.15, 0.0, 1.35);
        // Sharp glossy curved liquid gleam riding along the advancing lip of each creeping sticky syrup wave!
        float glazeLipGlint =
          (pow(max(dot(N_glaze, hL), 0.0), 280.0) * 1.45 +
           pow(max(dot(N_glaze, hR), 0.0), 280.0) * 1.25 +
           pow(max(dot(N_glaze, hT), 0.0), 320.0) * 1.35) *
          glazeEdge;
        float bottomStickyGlint =
          (pow(max(dot(N_glaze, hL), 0.0), 210.0) * 1.25 +
           pow(max(dot(N_glaze, hR), 0.0), 210.0) * 1.15 +
           pow(max(dot(N_glaze, hT), 0.0), 180.0) * 0.92) *
          bottomPoolZone;

        // Crisp 1-2px diamond specular sweat & wet granular slush pinpoints (like Temponaut / macro melt photos!)
        float slushPinpoints =
          (pow(max(dot(N_ice, hL), 0.0), 520.0) * 2.55 +
           pow(max(dot(N_ice, hR), 0.0), 480.0) * 2.15 +
           pow(max(dot(N_ice, hT), 0.0), 620.0) * 2.40) *
          slushFacet;

        // Tactile sweaty granular crystalline depth across wet melting ice (damped on coconut & pure liquid hanging bellies)
        float creamSmoothSpec = 1.0 - uOpacity * 0.80;
        float solidIceSpec = (1.0 - hangLiquid * 0.88);
        color *= 1.0 + (microGrain - 0.48) * 0.22 * slushFacet * thinIceFade * creamSmoothSpec * solidIceSpec * dryFrostMatte;
        color += vec3(1.96, 1.85, 1.80) * (crystalGlint * creamSmoothSpec * solidIceSpec + slushPinpoints * 1.65 * thinIceFade * creamSmoothSpec * solidIceSpec + glazeLipGlint * 1.05 + bottomStickyGlint * 0.95) * edgeMeltFade * (0.38 + 0.62 * thinIceFade) * dryFrostMatte;
        color += vec3(1.72, 1.60, 1.56) * softGlazeSheen * edgeMeltFade * (0.42 + 0.58 * thinIceFade) * dryFrostMatte;

        // Luminous clear glass bottom caustic crescent & crisp droplet-style pinpoint catchlights on hanging pouches!
        float hangCaustic = smoothstep(0.16, -0.78, N_glaze.y) * smoothstep(0.12, 0.72, N0dotV) * max(hangLiquid, hangClear) * (1.0 - uOpacity * 0.68);
        color += mix(vec3(0.82, 0.72, 0.68), uStainCol * 0.82 + vec3(0.26), 0.52) * hangCaustic * 0.62;
        float hangPinSpec = (pow(max(dot(N_glaze, hL), 0.0), 220.0) * 1.15 + pow(max(dot(N_glaze, hR), 0.0), 180.0) * 0.82) * hangClear;
        color += vec3(2.4, 2.3, 2.24) * hangPinSpec * edgeMeltFade;

        // Keep the luminous cloudy pink rim glow alive across the silhouette (only softly tapered right at razor tips)
        float silhouetteRim = pow(1.0 - N0dotV, 5.4) * thinIceFade * (1.0 - hangClear * 0.28);
        color += vec3(1.36, 0.98, 0.94) * silhouetteRim * 0.48 * dryFrostMatte;

        // === FREEZER-FRESH POWDERY HOARFROST RIME LAYER (instant melt under pointer!) ===
        if (rimeMask > 0.005 || rimeWetEdge > 0.005) {
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

          // Subtle wet dark-meniscus transition border right along an active melted frost shoreline
          color *= mix(1.0, 0.85, rimeWetEdge * 0.55);
          color = mix(color, frostSnowCol, totalFrostCov);
          color += vec3(1.75, 1.70, 1.66) * (frostTuft * rimeMask * 0.62 + snowFlakeSpeck * 0.85 + frostSparkle * 0.58);
        }

        // Tag postIceRT.a so Pass 6b can apply a continuous capillary surface-tension blur & contact shadow
        // strictly where uncovered berries/strawberries physically emerge from melting ice (zero effect on
        // mid-air falling fruits or studio silhouettes!):
        //   0.00 = backdrop air, 0.25 = open ice, 0.55 = contact-zone ice hugging an emerging fruit, 1.00 = solid
        float isContactIce = (hitsSolid && frontIceDist < 0.15) ? 0.55 : 0.25;
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
  data: Array<{ pos: THREE.Vector3; radius: number; stretchY: number; rotZ: number }>;
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
        // Shallow front bubbles are crisper; deeper bubbles slightly softer
        vDepthFront = clamp((wp.z + 0.14) / 0.34, 0.0, 1.0);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      varying float vDepthFront;

      void main() {
        vec3 N = normalize(vNormalView);
        vec3 V = normalize(vViewDir);
        float ndv = clamp(dot(N, V), 0.0, 1.0);

        // Air bubble inside crimson-coral ice:
        // 1) Crisp dark ruby-espresso TIR contour ring around the rim
        float darkRing = smoothstep(0.68, 0.36, ndv) * smoothstep(0.05, 0.30, ndv);
        // 2) Subtle bright coral-peach inner caustic on lower hemisphere
        float innerCaustic = smoothstep(0.2, -0.75, N.y) * smoothstep(0.22, 0.72, ndv);
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

  const data: Array<{ pos: THREE.Vector3; radius: number; stretchY: number; rotZ: number }> = [];
  const baseState: MeltFieldState = {
    melt: 0.035,
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
      rotZ,
    });
    created++;
  }

  while (data.length < count) {
    data.push({
      pos: new THREE.Vector3(0, 0, 0),
      radius: 0.0001,
      stretchY: 1,
      rotZ: 0,
    });
  }

  return {
    mesh,
    data,
    dispose() {
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
  const segU = isMobile ? 80 : 96;
  const segV = isMobile ? 52 : 72;
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

  const backZMat = createWorldZMaterial(0.0, THREE.BackSide);
  const backZMesh = new THREE.Mesh(geometry, backZMat);
  backZMesh.name = 'popsicle-ice-back-z';

  const solidWorldZMat = createWorldZMaterial(1.0, THREE.FrontSide);

  const bubbles = createInternalBubbles(seed);

  const tmpPos: { x: number; y: number; z: number; hang?: number } = { x: 0, y: 0, z: 0, hang: 0 };
  const dummy = new THREE.Object3D();

  const vTable = new Float32Array(segV + 1);
  for (let iv = 0; iv <= segV; iv++) {
    const t = iv / segV;
    vTable[iv] = t * 0.55 + (0.5 - 0.5 * Math.cos(t * Math.PI)) * 0.45;
  }

  const thetaTable = new Float32Array(segU + 1);
  for (let iu = 0; iu <= segU; iu++) {
    thetaTable[iu] = iu === segU ? 0 : (iu / segU) * Math.PI * 2;
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

  function update(state: MeltFieldState, bubbleDensity: number, forceMesh = false) {
    uniforms.uTime.value = state.time;
    uniforms.uMelt.value = state.melt;
    uniforms.uSeedOffset.value = state.seedOffset;

    const { iceGone } = getMeltBounds(state.melt);
    if (iceGone) {
      iceMesh.visible = false;
      backZMesh.visible = false;
      bubbles.mesh.visible = false;
      return;
    }
    iceMesh.visible = true;
    backZMesh.visible = true;
    bubbles.mesh.visible = true;

    const curPull0 = state.pendantPull ? state.pendantPull[0] : 0;
    const curPull1 = state.pendantPull ? state.pendantPull[1] : 0;
    const curPull2 = state.pendantPull ? state.pendantPull[2] : 0;
    const curPull3 = state.pendantPull ? state.pendantPull[3] : 0;

    // Smart dirty-skip: rebuild geometry immediately on melt/pull/pool/heat change, or ~35Hz for silky hanging recoil!
    const needsMesh =
      forceMesh ||
      state.seedOffset !== lastMeshSeed ||
      Math.abs(state.melt - lastMeshMelt) > 0.00025 ||
      Math.abs((state.bottomPool ?? 1.25) - lastMeshPool) > 0.005 ||
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
      lastMeshPool = state.bottomPool ?? 1.25;
      lastPull0 = curPull0;
      lastPull1 = curPull1;
      lastPull2 = curPull2;
      lastPull3 = curPull3;

      const stride = segU + 1;

      for (let iv = 0; iv <= segV; iv++) {
        const vNorm = vTable[iv];
        const rowOff = iv * stride;
        for (let iu = 0; iu <= segU; iu++) {
          evaluatePopsicleProfile(vNorm, thetaTable[iu], state, tmpPos);
          const vIdx = rowOff + iu;
          const o = vIdx * 3;
          positions[o] = tmpPos.x;
          positions[o + 1] = tmpPos.y;
          positions[o + 2] = tmpPos.z;
          hangs[vIdx] = tmpPos.hang ?? 0;
        }
      }

      for (let iv = 0; iv <= segV; iv++) {
        const rowOff = iv * stride;
        for (let iu = 0; iu <= segU; iu++) {
          const o = (rowOff + iu) * 3;
          if (iv === 0) {
            // Compute true tangent-tilted underside normal along the morphed scalloped bottom curtain!
            const iuPrev = iu === 0 ? segU - 1 : iu - 1;
            const iuNext = iu === segU ? 1 : iu + 1;
            const oL = (rowOff + iuPrev) * 3;
            const oR = (rowOff + iuNext) * 3;
            const dx = positions[oR] - positions[oL];
            const dy = positions[oR + 1] - positions[oL + 1];
            const slopeX = Math.abs(dx) > 1e-4 ? clamp(dy / dx, -1.65, 1.65) : 0;
            const nLen = Math.hypot(slopeX, 1.0);
            normals[o] = slopeX / nLen;
            normals[o + 1] = -1.0 / nLen;
            normals[o + 2] = 0;
            continue;
          }
          if (iv === segV) {
            normals[o] = 0;
            normals[o + 1] = 1;
            normals[o + 2] = 0;
            continue;
          }

          const iuPrev = iu === 0 ? segU - 1 : iu - 1;
          const iuNext = iu === segU ? 1 : iu + 1;
          const oL = (rowOff + iuPrev) * 3;
          const oR = (rowOff + iuNext) * 3;
          const oD = ((iv - 1) * stride + iu) * 3;
          const oU = ((iv + 1) * stride + iu) * 3;

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

      posAttr.needsUpdate = true;
      normAttr.needsUpdate = true;
      hangAttr.needsUpdate = true;
      if (forceMesh || lastBubbleMelt < -100) {
        geometry.computeBoundingSphere();
      }
    }

    // Only re-evaluate 760 internal bubble matrices when melt or pointer heat meaningfully changes!
    const needsBubbles =
      forceMesh ||
      bubbleDensity !== lastBubbleDensity ||
      Math.abs(state.melt - lastBubbleMelt) > 0.0018 ||
      state.pointerHeat > 0.02;

    if (needsBubbles) {
      lastBubbleMelt = state.melt;
      lastBubbleDensity = bubbleDensity;

      const activeCount = Math.floor(bubbles.data.length * clamp(bubbleDensity, 0, 1));
      for (let i = 0; i < bubbles.data.length; i++) {
        const b = bubbles.data[i];
        if (i >= activeCount) {
          dummy.scale.set(0, 0, 0);
          dummy.updateMatrix();
          bubbles.mesh.setMatrixAt(i, dummy.matrix);
          continue;
        }
        const depth = iceContainmentDepth(b.pos.x, b.pos.y, b.pos.z, state);
        const vis = smoothstep(0.010, 0.045, depth);
        if (vis <= 0.001) {
          dummy.scale.set(0, 0, 0);
        } else {
          const s = b.radius * vis;
          dummy.position.copy(b.pos);
          dummy.rotation.set(0, 0, b.rotZ);
          dummy.scale.set(s, s * b.stretchY, s);
        }
        dummy.updateMatrix();
        bubbles.mesh.setMatrixAt(i, dummy.matrix);
      }
      bubbles.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function sampleLiveSurface(uNorm: number, vNorm: number, outPos: THREE.Vector3, outNormal: THREE.Vector3) {
    const uWrapped = ((uNorm % 1) + 1) % 1;
    const vClamped = clamp(vNorm, 0, 1);

    const fu = uWrapped * segU;
    const iu0 = Math.floor(fu);
    const iu1 = Math.min(segU, iu0 + 1);
    const tu = fu - iu0;

    let lo = 0;
    let hi = segV;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (vTable[mid] <= vClamped) lo = mid;
      else hi = mid;
    }
    const iv0 = lo;
    const iv1 = hi;
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
