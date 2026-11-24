import * as THREE from 'three';
import { clamp, mulberry32, smoothstep } from './rng';
import { evaluatePopsicleProfile, getMeltBounds, iceContainmentDepth, MeltFieldState, POPSICLE } from './shape';

export interface IceUniforms {
  uBgTex: { value: THREE.Texture | null };
  uBgBlur1: { value: THREE.Texture | null };
  uBgBlur2: { value: THREE.Texture | null };
  uBubblesTex: { value: THREE.Texture | null };
  uFilmTex: { value: THREE.Texture | null };
  uInteriorZ: { value: THREE.Texture | null };
  uBackIceZ: { value: THREE.Texture | null };
  uResolution: { value: THREE.Vector2 };
  uTime: { value: number };
  uMelt: { value: number };
  uFrost: { value: number };
  uSeedOffset: { value: number };
}

export interface PopsicleIceSystem {
  iceMesh: THREE.Mesh;
  backZMesh: THREE.Mesh;
  bubblesMesh: THREE.InstancedMesh;
  solidWorldZMat: THREE.ShaderMaterial;
  uniforms: IceUniforms;
  update(state: MeltFieldState, bubbleDensity: number): void;
  sampleLiveSurface(uNorm: number, vNorm: number, outPos: THREE.Vector3, outNormal: THREE.Vector3): void;
  dispose(): void;
}

const SEG_U = 128;
const SEG_V = 96;

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
function createOpticalIceMaterial(): { material: THREE.ShaderMaterial; uniforms: IceUniforms } {
  const uniforms: IceUniforms = {
    uBgTex: { value: null },
    uBgBlur1: { value: null },
    uBgBlur2: { value: null },
    uBubblesTex: { value: null },
    uFilmTex: { value: null },
    uInteriorZ: { value: null },
    uBackIceZ: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 720) },
    uTime: { value: 0 },
    uMelt: { value: 0.035 },
    uFrost: { value: 0.58 },
    uSeedOffset: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    side: THREE.FrontSide,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform sampler2D uBgTex;
      uniform sampler2D uBgBlur1;
      uniform sampler2D uBgBlur2;
      uniform sampler2D uBubblesTex;
      uniform sampler2D uFilmTex;
      uniform sampler2D uInteriorZ;
      uniform sampler2D uBackIceZ;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform float uMelt;
      uniform float uFrost;
      uniform float uSeedOffset;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec2 vUv;

      float hash31(vec3 p) {
        p = fract(p * vec3(0.1031, 0.1030, 0.0973));
        p += dot(p, p.yxz + 33.33);
        return fract((p.x + p.y) * p.z);
      }

      float vnoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);

        float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
        float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
        float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
        float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
        float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
        float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
        float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
        float n111 = hash31(i + vec3(1.0, 1.0, 1.0));

        float nx00 = mix(n000, n100, f.x);
        float nx10 = mix(n010, n110, f.x);
        float nx01 = mix(n001, n101, f.x);
        float nx11 = mix(n011, n111, f.x);

        float nxy0 = mix(nx00, nx10, f.y);
        float nxy1 = mix(nx01, nx11, f.y);
        return mix(nxy0, nxy1, f.z);
      }

      float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * vnoise(p);
          p = p * 2.04 + vec3(17.1, 31.7, 11.3);
          a *= 0.5;
        }
        return v;
      }

      vec3 hash33(vec3 p) {
        p = fract(p * vec3(0.1031, 0.1030, 0.0973));
        p += dot(p, p.yxz + 33.33);
        return fract((p.xxy + p.yxx) * p.zyx);
      }

      // True 3D Voronoi / cellular sugar-ice slush granules (infinite resolution, matching process/melt frame_0075-0108!)
      // Returns vec4(cellOutwardNormalXYZ, distToCenter)
      vec4 slushCells(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        float minD = 8.0;
        vec3 bestVec = vec3(0.0);
        for (int z = -1; z <= 1; z++) {
          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              vec3 g = vec3(float(x), float(y), float(z));
              vec3 rnd = hash33(i + g);
              vec3 diff = g + rnd - f;
              float d2 = dot(diff, diff);
              if (d2 < minD) {
                minD = d2;
                bestVec = -diff; // points outward from crystal bead center
              }
            }
          }
        }
        return vec4(bestVec, sqrt(minD));
      }

      // Tactile thawing ice micro-relief + spatially varied frozen crystal roughness + 3D Voronoi slush granules!
      vec3 perturbNormal(vec3 N, vec3 p, float glazeCover, float localFreezeRough, out float microGrain, out float slushBump) {
        vec3 sp = p * vec3(9.5, 4.5, 9.5) + vec3(uSeedOffset, uTime * 0.04, 0.0);
        float eps = 0.045;
        float h0 = fbm(sp);
        float hx = fbm(sp + vec3(eps, 0.0, 0.0));
        float hy = fbm(sp + vec3(0.0, eps, 0.0));
        float hz = fbm(sp + vec3(0.0, 0.0, eps));
        vec3 wetGrad = vec3(hx - h0, hy - h0, hz - h0) / eps;

        // Porous 3D Voronoi sugar-ice crystals: present heterogeneously in rough freeze zones at t=0,
        // and blooming across the surface as porous wet slush as the popsicle thaws!
        float slushAmt = smoothstep(0.045, 0.36, uMelt) * (1.0 - glazeCover * 0.72);
        vec4 cellMed = slushCells(p * 46.0 + vec3(uSeedOffset * 1.3));
        vec4 cellFine = slushCells(p * 96.0 + vec3(uSeedOffset * 2.9));

        vec3 cellPert = cellMed.xyz * 0.62 + cellFine.xyz * 0.58;
        float fineTooth = vnoise(p * 72.0 + vec3(uSeedOffset * 2.1));

        microGrain = clamp(fineTooth * 0.48 + (1.0 - cellFine.w) * 0.52, 0.0, 1.0);
        slushBump = slushAmt * clamp(1.0 - cellMed.w * 0.9, 0.0, 1.0);

        float domeFrost = 1.0 + smoothstep(0.45, 1.05, p.y) * 0.50;
        // Clear glassy pockets stay sleek (~0.025); rough freeze zones have crisp granular crystal micro-relief (~0.17)!
        float freezeCrystalRelief = (0.024 + 0.145 * localFreezeRough) * uFrost * domeFrost * (1.0 - glazeCover * 0.65);
        vec3 pert =
          wetGrad * (0.032 + uMelt * 0.018) * (1.0 - glazeCover * 0.55) +
          cellPert * (freezeCrystalRelief + 0.34 * slushAmt);

        pert -= N * dot(pert, N);
        return normalize(N - pert);
      }

      vec3 sampleFrostedBg(vec2 uv, float blurAmt) {
        vec2 cUv = clamp(uv, vec2(0.002), vec2(0.998));
        vec3 sharp = texture2D(uBgTex, cUv).rgb;
        vec3 mid = texture2D(uBgBlur1, cUv).rgb;
        vec3 deep = texture2D(uBgBlur2, cUv).rgb;
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

        // Overhead curved dome softbox highlight (subtle & crisp, never a wide plastic blotch!)
        float topBox = smoothstep(0.68 - roughness * 0.18, 0.94, r.y) *
                       exp(-pow(r.x / (0.38 + roughness * 0.22), 2.0));
        col += vec3(1.15, 1.02, 0.98) * topBox * (0.28 + 0.55 * sharp);

        return col;
      }

      void main() {
        vec2 screenUv = gl_FragCoord.xy / uResolution;
        vec3 N0 = normalize(vWorldNormal);

        // === SAMPLE CONTINUOUS 2D VISCOUS LIQUID GLAZE FILM (process/melt frames 0064-0071!) ===
        vec4 filmSample = texture2D(uFilmTex, vUv);
        float filmH = filmSample.r;
        vec2 filmSlope = (filmSample.gb - 0.5) * 2.0; // (dh/du, dh/dv) meniscus curvature
        float wetMem = filmSample.a;

        // Thick flowing glaze lobes + accumulated sticky bottom-rim pool cover & level frost into mirror-glossy syrup!
        float bottomPoolZone = smoothstep(0.14, 0.015, vUv.y) * (1.0 - smoothstep(0.60, 0.95, uMelt));
        float glazeCover = max(smoothstep(0.16, 0.46, filmH), bottomPoolZone * 0.78);
        float glazeEdge = length(filmSlope) * smoothstep(0.10, 0.34, filmH);

        // Pre-evaluate domain-warped spatial freeze-roughness field so surface crystal micro-relief AND
        // deep internal freeze pockets share the exact same organic freezing pattern!
        vec3 volPos = vWorldPos * vec3(2.9, 2.5, 3.4) + vec3(uSeedOffset, 0.0, 0.0);
        vec3 warpOff = vec3(
          fbm(volPos * 1.35 + vec3(4.1, 1.7, 2.9)),
          fbm(volPos * 1.35 + vec3(-3.4, 6.2, 1.1)),
          fbm(volPos * 1.35 + vec3(2.2, -5.1, 7.3))
        ) - 0.5;
        vec3 warpedVol = volPos + warpOff * 1.25;

        float nearFluteWall = exp(-pow((abs(vWorldPos.x) - 0.165) / 0.052, 2.0)) * smoothstep(0.32, 0.04, uMelt);
        float freezePatchRaw = fbm(warpedVol * 1.85 + vec3(-2.7, 3.8, 1.5));
        float freezeRoughBase = clamp(
          pow(smoothstep(0.28, 0.72, freezePatchRaw), 1.35) * 0.92 +
          nearFluteWall * 0.38 +
          smoothstep(0.55, 1.05, vWorldPos.y) * 0.22,
          0.06,
          1.0
        ) * uFrost;

        float microGrain = 0.0;
        float slushFacet = 0.0;
        vec3 N_ice = perturbNormal(N0, vWorldPos, glazeCover, freezeRoughBase, microGrain, slushFacet);

        // Build clean surface tangent basis for soft buttery liquid glaze meniscus curvature (ZERO jagged lines!)
        vec3 refUp = abs(N0.y) > 0.94 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
        vec3 T = normalize(cross(refUp, N0));
        vec3 B = normalize(cross(N0, T));
        vec3 meniscusBend = (T * filmSlope.x + B * filmSlope.y) * (0.18 * smoothstep(0.10, 0.40, filmH));

        // Fine glossy sticky-liquid pooling micro-relief along the swollen bottom rim (matches reference close-up!)
        if (bottomPoolZone > 0.01) {
          vec3 pPool = vWorldPos * vec3(24.0, 26.0, 22.0) + vec3(uSeedOffset * 1.9, 0.0, 0.0);
          float poolU = vnoise(pPool + vec3(0.35, 0.0, 0.0)) - vnoise(pPool - vec3(0.35, 0.0, 0.0));
          float poolV = vnoise(pPool + vec3(0.0, 0.35, 0.0)) - vnoise(pPool - vec3(0.0, 0.35, 0.0));
          meniscusBend += (T * poolU + B * poolV) * (0.28 * bottomPoolZone);
        }
        // Smooth macro liquid normal for broad studio softbox reflections (prevents jagged contour artifacts!)
        vec3 N_glaze = normalize(N0 - meniscusBend);
        // Full detailed normal with Voronoi wet sugar-ice granules for refraction & crisp 1-3px crystal glints!
        vec3 N = normalize(N_ice - meniscusBend);
        vec3 V = normalize(cameraPosition - vWorldPos);

        float NdotV = clamp(dot(N, V), 0.0, 1.0);
        float N0dotV = clamp(dot(N0, V), 0.0, 1.0);

        float zFront = vWorldPos.z;
        float zBackRaw = texture2D(uBackIceZ, screenUv).r;
        float zBack = (zBackRaw > -5.0) ? zBackRaw : (zFront - 0.36);
        float totalThickness = clamp(zFront - zBack, 0.03, 0.56);

        // Snell screen-space refraction (IOR = 1.31) + subtle RGB dispersion
        float edgeBend = mix(0.014, 0.040, pow(1.0 - N0dotV, 1.35));
        vec2 baseOffset = -N.xy * edgeBend * (0.72 + totalThickness * 1.15);

        vec2 uvR = screenUv + baseOffset * 0.94;
        vec2 uvG = screenUv + baseOffset * 1.00;
        vec2 uvB = screenUv + baseOffset * 1.07;

        // Exact front ice thickness to solid embedded fruits & stick (never bubbles!)
        vec2 interiorSample = texture2D(uInteriorZ, clamp(uvG, vec2(0.002), vec2(0.998))).rg;
        bool hitsSolid = (interiorSample.g > 0.5) && (interiorSample.r > zBack - 0.06) && (interiorSample.r <= zFront + 0.04);
        float frontIceDist = hitsSolid ? clamp(zFront - interiorSample.r, 0.0, totalThickness) : totalThickness;

        // === SPATIALLY VARYING 3D FREEZE-ZONE ROUGHNESS & CRYSTALLINE INTERNAL STRUCTURE ===
        // Real popsicles freeze unevenly from mold walls & around fruit surfaces, creating clear glassy windows
        // right next to crunchy, granular, cloudy-crystalline freeze pockets & feathery micro-fracture veins!
        float cloudMacro = fbm(warpedVol);
        float cloudMed = fbm(warpedVol * 2.5 + vec3(5.2, -2.1, 8.4));
        float freezeStreaks = fbm(vec3(vWorldPos.x * 13.5 + warpOff.x * 2.2 + uSeedOffset, vWorldPos.y * 2.6, vWorldPos.z * 11.0));

        float fruitNucleation = hitsSolid ? smoothstep(0.015, 0.075, frontIceDist) * smoothstep(0.24, 0.09, frontIceDist) : 0.0;
        float freezeRoughZone = clamp(freezeRoughBase + fruitNucleation * 0.32 * uFrost, 0.06, 1.0);

        // Two-depth parallax-shifted 3D internal volume sampling so crystalline roughness & fracture planes
        // visibly live INSIDE the translucent slab rather than painted flat on the outer skin!
        vec3 innerPosA = vWorldPos - V * clamp(frontIceDist * 0.36, 0.018, 0.095);
        vec3 innerPosB = vWorldPos - V * clamp(frontIceDist * 0.72, 0.040, 0.19);
        float innerGranuleCoarse = fbm(innerPosA * 18.0 + warpOff * 2.2 + vec3(uSeedOffset * 1.7));
        float innerGranuleFine = vnoise(innerPosA * 56.0 + vec3(uSeedOffset * 3.1));
        float innerGranuleMicro = vnoise(innerPosA * 118.0 + vec3(uSeedOffset * 5.3));
        float deepGranule = fbm(innerPosB * 24.0 + vec3(-3.1, 6.4, 2.2));

        // Feathery internal freeze-fracture planes & granular snow-ice pockets (high local micro-contrast!)
        float veinRawA = 1.0 - abs(vnoise(innerPosA * vec3(15.0, 11.0, 14.0) + warpOff * 1.9) - 0.5) * 2.0;
        float veinRawB = 1.0 - abs(vnoise(innerPosB * vec3(28.0, 20.0, 26.0) + vec3(7.3, -4.1, 2.8)) - 0.5) * 2.0;
        float freezeVeins = (pow(clamp(veinRawA, 0.0, 1.0), 4.0) * 0.68 + pow(clamp(veinRawB, 0.0, 1.0), 4.8) * 0.58) * freezeRoughZone;
        float crunchyPattern = (innerGranuleCoarse * 0.42 + innerGranuleFine * 0.36 + deepGranule * 0.22);
        // Signed internal crystal contrast [-0.5 .. +0.5]: creates BOTH deeper red-orange crystal crevices AND bright snow flecks!
        float crystalMod = (crunchyPattern - 0.5) * 2.0 * freezeRoughZone;

        float frostFactor = clamp(
          uFrost * (0.34 + 0.66 * freezeRoughZone + 0.24 * (cloudMacro - 0.5) + 0.18 * (freezeStreaks - 0.5)),
          0.10,
          1.0
        );

        // Extra rough micro-refraction scatter strictly inside rough crystalline freeze zones!
        vec2 roughJitter = vec2(innerGranuleFine - 0.5, innerGranuleMicro - 0.5) * (0.0072 * freezeRoughZone * (1.0 - glazeCover * 0.45));
        uvR += roughJitter;
        uvG += roughJitter;
        uvB += roughJitter;

        // Spatially varied depth-aware optical blur: clear glassy zones stay crisp, rough frozen pockets turn misty!
        float blurAmt = hitsSolid
          ? clamp(smoothstep(0.014, 0.22, frontIceDist) * (0.32 + 0.68 * frostFactor) + freezeRoughZone * 0.16, 0.0, 0.84)
          : clamp(0.18 + 0.64 * frostFactor + freezeRoughZone * 0.14, 0.14, 0.92);

        vec3 bgCol;
        bgCol.r = sampleFrostedBg(uvR, blurAmt).r;
        bgCol.g = sampleFrostedBg(uvG, blurAmt).g;
        bgCol.b = sampleFrostedBg(uvB, blurAmt).b;

        float grazingPath = 1.0 / max(0.34, N0dotV);
        float opticalDist = frontIceDist * mix(1.0, grazingPath, 0.50);

        // === VIVID STRAWBERRY-CORAL + SUBTLE WARM YELLOWISH / GOLDEN-APRICOT INTERNAL NUANCES ===
        // Keep green absorption rich (NEVER pale beige!), while raising blue absorption subtly in warm internal
        // & downward pockets so backlit channels glow juicy sunlit coral-apricot-amber against deep berry crimson!
        float bottomRichness = smoothstep(0.22, -0.98, vWorldPos.y);
        float topRuby = smoothstep(0.70, 1.08, vWorldPos.y);
        float edgeRichness = pow(1.0 - N0dotV, 1.32);
        float fluteOptical = smoothstep(0.10, 0.34, abs(N0.x)) * smoothstep(0.76, 0.38, abs(N0.x));

        // Organic warm golden-amber nuance field: subtle inside illuminated pockets & trending gently downward!
        float warmPocketNoise = fbm(warpedVol * 1.50 + vec3(9.4, -3.6, 4.2));
        float downwardWarmth = smoothstep(0.55, -0.82, vWorldPos.y);
        float warmNuance = clamp(
          (smoothstep(0.32, 0.76, warmPocketNoise) * 0.68 + downwardWarmth * 0.42) *
          (1.0 - edgeRichness * 0.75) *
          (1.0 - topRuby * 0.65),
          0.0,
          1.0
        );

        // Keep green absorption strong (~5.55) so ice stays juicy coral-red while elevated blue absorption (~8.1)
        // introduces authentic warm yellowish/golden-peach backlit nuances (matches macro crop without washing out!).
        vec3 baseSigma = mix(vec3(0.40, 6.15, 5.80), vec3(0.34, 5.45, 8.20), warmNuance * 0.64);
        // Internal freeze-crystal granularity directly modulates optical density (creates real volumetric dark+light crunch!)
        float densityRough = 1.0 - crystalMod * 0.34;
        vec3 juiceSigma = baseSigma * (0.84 + 0.44 * cloudMed) * densityRough;
        juiceSigma *= (1.0 + bottomRichness * 0.54 + topRuby * 0.54 + edgeRichness * 0.78 + fluteOptical * 0.24);

        float absorbScale = hitsSolid ? 1.48 : 1.82;
        vec3 transmittance = exp(-juiceSigma * opticalDist * absorbScale);
        vec3 transmitted = bgCol * transmittance;

        // === LUMINOUS BACKLIT STRAWBERRY-CORAL & GOLDEN-APRICOT SUBSURFACE SCATTERING ===
        float lightboxCore = exp(-dot(vWorldPos.xy * vec2(0.72, 0.48), vWorldPos.xy * vec2(0.72, 0.48)));
        float openChannel = hitsSolid ? smoothstep(0.030, 0.22, frontIceDist) * 0.52 : 1.0;

        vec3 sunlitRoseCore = vec3(1.48, 0.54, 0.40);
        vec3 goldenPeachNuance = vec3(1.62, 0.74, 0.22); // juicy warm golden-apricot-coral nuance (NEVER pale beige!)
        vec3 juicyBerryPink = vec3(1.20, 0.20, 0.19);
        vec3 deepRubyBerry = vec3(0.76, 0.03, 0.08);

        float cloudContrast = pow(clamp(cloudMacro * 1.15, 0.0, 1.0), 1.42);
        float centerGlow = clamp(lightboxCore * (0.46 + 0.76 * cloudContrast) * (1.0 - edgeRichness * 0.86), 0.0, 1.0);
        vec3 sunlitCore = mix(sunlitRoseCore, goldenPeachNuance, warmNuance * 0.58);
        vec3 baseGlow = mix(juicyBerryPink, sunlitCore, centerGlow);
        // Subtle warm golden-coral shift in lower-middle translucent internal channels
        baseGlow = mix(baseGlow, vec3(1.46, 0.64, 0.24), warmNuance * downwardWarmth * openChannel * 0.36);

        vec3 sssJuiceColor = mix(
          baseGlow,
          deepRubyBerry,
          clamp(bottomRichness * 0.50 + edgeRichness * 0.64 + topRuby * 0.48, 0.0, 0.94)
        );

        // Internal freeze roughness creates local dark-vs-bright crystalline scatter contrast inside the slab!
        float roughScatterMod = 1.0 + crystalMod * 0.32;
        float scatterStrength = (0.54 + 0.64 * lightboxCore) * (0.68 + 0.52 * cloudContrast) * (0.48 + 0.44 * frostFactor) * roughScatterMod;
        vec3 internalScatter = sssJuiceColor * (1.0 - transmittance) * openChannel * scatterStrength;

        // === INTERNAL FROZEN CRYSTALLINE SNOW-POCKETS, MICRO-VEINS & ROUGH FREEZE TOOTH ===
        // Crisp bright crystalline frost flecks & fracture planes inside rough freeze pockets (contrasting dark crevices!)
        float crystalSpeck = smoothstep(0.60, 0.95, innerGranuleMicro) * smoothstep(0.34, 0.80, freezeRoughZone);
        float snowPocket = smoothstep(0.54, 0.90, crunchyPattern) * smoothstep(0.36, 0.82, freezeRoughZone) * (1.0 - uMelt * 0.42);
        float creviceDark = smoothstep(0.46, 0.14, crunchyPattern) * smoothstep(0.34, 0.82, freezeRoughZone) * (1.0 - uMelt * 0.42);

        vec3 warmFrostCol = mix(vec3(1.48, 0.98, 0.92), vec3(1.58, 1.16, 0.78), warmNuance * 0.52);
        vec3 internalFreezeTex =
          warmFrostCol * (snowPocket * 0.24 + freezeVeins * 0.28) * (hitsSolid ? 0.65 : 1.0) +
          vec3(1.62, 1.46, 1.32) * crystalSpeck * 0.20 * (hitsSolid ? 0.68 : 1.0);

        // Tactile crisp frozen micro-crystal sparkle (stronger in rough freeze pockets & dome!)
        float grainSparkle = smoothstep(0.56, 0.94, microGrain) * frostFactor * (0.55 + 0.95 * freezeRoughZone) * (1.0 - uMelt * 0.45);
        float domeSparkle = 1.0 + smoothstep(0.50, 1.06, vWorldPos.y) * 1.25;
        vec3 frostTooth = mix(vec3(1.42, 0.78, 0.70), vec3(1.54, 0.98, 0.64), warmNuance * 0.45) *
                          grainSparkle * domeSparkle * (hitsSolid ? 0.09 : 0.17);

        // Combine transmitted + internal scatter, deepen crystalline crevices inside rough freeze pockets, then add bright frost veins!
        vec3 iceBody = (transmitted + internalScatter) * (1.0 - creviceDark * 0.24) + internalFreezeTex + frostTooth;

        // Deep juicy crimson-strawberry internal reflection rim just inside the rounded outer silhouette!
        float innerRubyRim = smoothstep(0.54, 0.16, N0dotV) * smoothstep(0.02, 0.16, N0dotV);
        iceBody = mix(iceBody, iceBody * vec3(1.06, 0.34, 0.36) + vec3(0.35, 0.01, 0.035), innerRubyRim * 0.54);

        // === GLOSSY VISCOUS MELT-SYRUP GLAZE ABSORPTION (process/melt frames 0065-0071!) ===
        // Thick creeping berry-juice glaze deepens & saturates the translucent frost underneath into rich wet ruby!
        vec3 glazeTint = exp(-vec3(0.16, 1.85, 2.05) * glazeCover * 0.46);
        iceBody *= mix(vec3(1.0), glazeTint, 0.78);
        // Subtle darker glossy wet trace where liquid flowed previously
        iceBody *= mix(vec3(1.0), vec3(0.98, 0.88, 0.87), wetMem * 0.26 * (1.0 - glazeCover));

        // === INTERNAL TRAPPED AIR MICRO-BUBBLES ===
        vec4 bub = texture2D(uBubblesTex, clamp(uvG, vec2(0.002), vec2(0.998)));
        iceBody = mix(iceBody, bub.rgb, clamp(bub.a * 0.92, 0.0, 0.92));

        // === WET GLAZE FRESNEL, SOFT SYRUPY SHEEN & SPARKLING VORONOI SLUSH PINPOINTS ===
        // Reflect studio strip-lights off smooth N_glaze (soft silky wet reflection, ZERO electric lightning lines!)
        // while crisp tiny crystal pinpoints sparkle off detailed Voronoi N!
        vec3 R_glaze = reflect(-V, N_glaze);
        vec3 R_smooth = reflect(-V, N0);

        float fresnel = 0.02 + 0.98 * pow(1.0 - clamp(dot(N_glaze, V), 0.0, 1.0), 4.8);
        float shoulderGlareTame = mix(1.0, 0.48, smoothstep(0.55, 0.95, vWorldPos.y));
        float filmRough = mix(0.10, 0.045, glazeCover);
        vec3 specWet = evalMacroStudioReflection(R_glaze, filmRough) * shoulderGlareTame;
        vec3 specSatin = evalMacroStudioReflection(R_smooth, 0.32) * shoulderGlareTame;

        float glazeSpecBoost = 1.0 + glazeCover * 0.45 + wetMem * 0.16;
        vec3 color =
          iceBody * (1.0 - fresnel * 0.38) +
          specWet * (fresnel * 0.72 * glazeSpecBoost) +
          specSatin * (fresnel * 0.14 * frostFactor * (1.0 - glazeCover * 0.75));

        // Organic, crystal-broken frosted specular ridges along the twin molded flutes
        // Uses crystal-perturbed reflection + granular freeze breakup so flutes look like REAL frozen mold edges
        // (matching the user's macro flute close-up instead of sterile vector hairlines!)
        vec3 R_flute = reflect(-V, normalize(mix(N0, N_ice, 0.55)));
        float nearFluteTrack = exp(-pow((abs(vWorldPos.x) - 0.165) / 0.064, 2.0));
        float fluteFade = smoothstep(0.28, 0.05, uMelt);
        float fluteBreakup = smoothstep(0.18, 0.82, fbm(vWorldPos * vec3(14.0, 10.5, 14.0) + vec3(uSeedOffset * 2.1)));
        float fluteCrystalSpark = smoothstep(0.45, 0.95, innerGranuleMicro) * 0.85;
        float fluteBand = exp(-pow((abs(R_flute.x) - 0.34) / 0.056, 2.0)) *
                          smoothstep(0.08, 0.24, abs(N0.x)) *
                          smoothstep(0.54, 0.24, abs(N0.x)) *
                          smoothstep(-0.86, -0.60, vWorldPos.y) *
                          smoothstep(0.88, 0.62, vWorldPos.y) *
                          nearFluteTrack * fluteFade;
        float fluteLine = fluteBand * (0.28 + 0.82 * fluteBreakup + fluteCrystalSpark + freezeVeins * 0.45);
        color += mix(vec3(1.56, 1.38, 1.34), vec3(1.68, 1.48, 1.24), warmNuance * 0.45) * fluteLine * 0.56;

        // Crisp scattered sparkling wet micro-crystal pinpoints across porous thawing sugar-ice
        // (inspired directly by process/melt frames 0075, 0082, 0085, 0108!)
        vec3 keyL = normalize(vec3(-0.66, 0.46, 0.59));
        vec3 keyR = normalize(vec3(0.66, 0.42, 0.62));
        vec3 keyTop = normalize(vec3(-0.18, 0.78, 0.60));
        vec3 hL = normalize(keyL + V);
        vec3 hR = normalize(keyR + V);
        vec3 hT = normalize(keyTop + V);

        float crystalGlint =
          pow(max(dot(N, hL), 0.0), 340.0) * 1.45 +
          pow(max(dot(N, hR), 0.0), 340.0) * 1.25 +
          pow(max(dot(N, hT), 0.0), 420.0) * 1.35;

        // Smooth buttery specular sheen on creeping thick liquid glaze domes + glossy sticky bottom-rim relief!
        float softGlazeSheen =
          (pow(max(dot(N_glaze, hL), 0.0), 110.0) * 0.55 + pow(max(dot(N_glaze, hR), 0.0), 110.0) * 0.42) *
          clamp(glazeCover * 0.65 + glazeEdge * 0.85, 0.0, 1.0);
        float bottomStickyGlint =
          (pow(max(dot(N_glaze, hL), 0.0), 210.0) * 1.15 +
           pow(max(dot(N_glaze, hR), 0.0), 210.0) * 1.05 +
           pow(max(dot(N_glaze, hT), 0.0), 180.0) * 0.85) *
          bottomPoolZone;

        // Extra glittering crystal-bead sparkle on exposed porous slush as melt advances!
        float slushPinpoints =
          (pow(max(dot(N_ice, hL), 0.0), 260.0) * 1.65 +
           pow(max(dot(N_ice, hR), 0.0), 260.0) * 1.35 +
           pow(max(dot(N_ice, hT), 0.0), 320.0) * 1.50) *
          slushFacet;

        color += vec3(1.85, 1.72, 1.68) * (crystalGlint + slushPinpoints * 1.35 + bottomStickyGlint * 0.72);
        color += vec3(1.65, 1.54, 1.50) * softGlazeSheen;

        // Luminous warm studio backlight rim wrap right on the silhouette contour
        float silhouetteRim = pow(1.0 - N0dotV, 5.4);
        color += vec3(1.36, 0.98, 0.94) * silhouetteRim * 0.48;

        gl_FragColor = vec4(color, 1.0);
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

export function createPopsicleIceSystem(seed: number): PopsicleIceSystem {
  const vertexCount = (SEG_U + 1) * (SEG_V + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  for (let iv = 0; iv <= SEG_V; iv++) {
    const vNorm = iv / SEG_V;
    for (let iu = 0; iu <= SEG_U; iu++) {
      const uNorm = iu / SEG_U;
      const idx = iv * (SEG_U + 1) + iu;
      uvs[idx * 2] = uNorm;
      uvs[idx * 2 + 1] = vNorm;
    }
  }

  for (let iv = 0; iv < SEG_V; iv++) {
    for (let iu = 0; iu < SEG_U; iu++) {
      const a = iv * (SEG_U + 1) + iu;
      const b = a + 1;
      const c = a + (SEG_U + 1);
      const d = c + 1;
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const normAttr = new THREE.BufferAttribute(normals, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  normAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('normal', normAttr);
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const { material: iceMat, uniforms } = createOpticalIceMaterial();
  const iceMesh = new THREE.Mesh(geometry, iceMat);
  iceMesh.name = 'popsicle-ice';

  const backZMat = createWorldZMaterial(0.0, THREE.BackSide);
  const backZMesh = new THREE.Mesh(geometry, backZMat);
  backZMesh.name = 'popsicle-ice-back-z';

  const solidWorldZMat = createWorldZMaterial(1.0, THREE.FrontSide);

  const bubbles = createInternalBubbles(seed);

  const tmpPos = { x: 0, y: 0, z: 0 };
  const dummy = new THREE.Object3D();

  const vTable = new Float32Array(SEG_V + 1);
  for (let iv = 0; iv <= SEG_V; iv++) {
    const t = iv / SEG_V;
    vTable[iv] = t * 0.55 + (0.5 - 0.5 * Math.cos(t * Math.PI)) * 0.45;
  }

  function update(state: MeltFieldState, bubbleDensity: number) {
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

    const stride = SEG_U + 1;

    for (let iv = 0; iv <= SEG_V; iv++) {
      const vNorm = vTable[iv];
      for (let iu = 0; iu <= SEG_U; iu++) {
        const theta = iu === SEG_U ? 0 : (iu / SEG_U) * Math.PI * 2;
        evaluatePopsicleProfile(vNorm, theta, state, tmpPos);
        const o = (iv * stride + iu) * 3;
        positions[o] = tmpPos.x;
        positions[o + 1] = tmpPos.y;
        positions[o + 2] = tmpPos.z;
      }
    }

    for (let iv = 0; iv <= SEG_V; iv++) {
      for (let iu = 0; iu <= SEG_U; iu++) {
        const o = (iv * stride + iu) * 3;
        if (iv === 0) {
          normals[o] = 0;
          normals[o + 1] = -1;
          normals[o + 2] = 0;
          continue;
        }
        if (iv === SEG_V) {
          normals[o] = 0;
          normals[o + 1] = 1;
          normals[o + 2] = 0;
          continue;
        }

        const iuPrev = iu === 0 ? SEG_U - 1 : iu - 1;
        const iuNext = iu === SEG_U ? 1 : iu + 1;
        const oL = (iv * stride + iuPrev) * 3;
        const oR = (iv * stride + iuNext) * 3;
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
          nx /= len;
          ny /= len;
          nz /= len;
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
    geometry.computeBoundingSphere();

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

  function sampleLiveSurface(uNorm: number, vNorm: number, outPos: THREE.Vector3, outNormal: THREE.Vector3) {
    const uWrapped = ((uNorm % 1) + 1) % 1;
    const vClamped = clamp(vNorm, 0, 1);

    const fu = uWrapped * SEG_U;
    const iu0 = Math.floor(fu);
    const iu1 = Math.min(SEG_U, iu0 + 1);
    const tu = fu - iu0;

    let lo = 0;
    let hi = SEG_V;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (vTable[mid] <= vClamped) lo = mid;
      else hi = mid;
    }
    const iv0 = lo;
    const iv1 = hi;
    const span = Math.max(1e-5, vTable[iv1] - vTable[iv0]);
    const tv = clamp((vClamped - vTable[iv0]) / span, 0, 1);

    const stride = SEG_U + 1;
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
    update,
    sampleLiveSurface,
    dispose,
  };
}
