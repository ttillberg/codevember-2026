import * as THREE from 'three';
import { clamp, fbm3, mulberry32, smoothstep } from './rng';
import { baseHalfWidthAt, getMeltBounds, iceContainmentDepth, MeltFieldState, POPSICLE, sampleIceContainment } from './shape';
import {
  DEFAULT_RECIPE,
  PopsicleRecipe,
  resolveOpticalPalette,
  ToppingId,
} from './recipe';
import {
  CARVE_TEX_H,
  CARVE_TEX_W,
  getCachedBlueberryTextures,
  getCachedChocolateChunkTextures,
  getCachedKaksmulorTextures,
  getCachedLemonZestTextures,
  getCachedRaspberryTextures,
  getCachedStrawberryTextures,
  getCachedWoodTextures,
  strawberryBoundaryRadius,
  StrawberryTextures,
  BlueberryTextures,
  ToppingTextureSet,
} from './textures';

export interface FruitItem {
  kind: ToppingId;
  mesh: THREE.Mesh;
  basePos: THREE.Vector3;
  baseQuat: THREE.Quaternion;
  baseScale: THREE.Vector3;
  radius: number;
  velocity: THREE.Vector3;
  angVel: THREE.Vector3;
  detached: boolean;
  /** Elapsed seconds since detaching (guarantees clean brisk exit!) */
  detachTime: number;
  /** True while the user is actively grabbing / holding this fruit with their pointer */
  grabbed: boolean;
  /** Fraction exposed outside melting ice [0..1] */
  exposure: number;
  /** Soft-thaw spring bend state (droop + gentle flutter / soft impact flex) */
  bendAmt: number;
  bendVel: number;
  bendPhase: number;
  /** Inherent natural curl/cup resting bend per strawberry slice (x=cup, y=S-curl, z=asymmetric tilt) */
  baseBend: THREE.Vector3;
  bendUniform?: { value: THREE.Vector3 };
  thawUniform?: { value: number };
}

export interface FruitGrabState {
  hoveredIndex: number;
  grabbedIndex: number;
  grabbedFreed: boolean;
}

export interface FruitAssembly {
  /** Group containing all solid fruits + wooden stick */
  group: THREE.Group;
  stickMesh: THREE.Mesh;
  stickUniforms: {
    uIceBottomY: { value: number };
    uIceTopY: { value: number };
    uIceAmount: { value: number };
    uStickWetness: { value: number };
    uStainColor: { value: THREE.Vector3 };
  };
  fruits: FruitItem[];
  /** Live-updates stick stain & carved groove tint when user changes base or flavors */
  setRecipeColors(recipe: PopsicleRecipe): void;
  /** True while any detached fruit is still actively falling through the visible frame */
  hasFallingFruitInView(): boolean;
  /** Returns index of closest loose (almost-released / moving) or falling fruit under ray, or -1 */
  pickGrabbableFruit(raycaster: THREE.Raycaster): number;
  /** Updates currently hovered loose fruit for subtle organic give */
  setHoveredFruit(index: number): void;
  /** Begins grabbing a loose or falling fruit at the exact pointer ray intersection */
  beginGrab(index: number, raycaster: THREE.Raycaster, camera: THREE.Camera): boolean;
  /** Updates pointer drag target for the currently held fruit */
  moveGrab(raycaster: THREE.Raycaster, meltState: MeltFieldState): void;
  /** Releases the held fruit with natural pointer toss velocity and soft tumble */
  endGrab(): void;
  /** Advances smooth spring follow, sticky-peel resistance, banking, and soft flex on raw real-time dt */
  updateGrab(rawDt: number, meltState: MeltFieldState): void;
  getGrabState(): FruitGrabState;
  reset(): void;
  update(meltState: MeltFieldState, dt: number, stickWetness?: number): void;
  dispose(): void;
}

/**
 * Generates a watertight, beveled 3D sliced strawberry wedge/slab geometry
 * matching `strawberryBoundaryRadius(angle)` with sculpted scalloped seed edge.
 */
function createStrawberrySliceGeometry(seed: number, thickness = 0.16): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const off = rand() * 30;

  const segAng = 54;
  const faceRings = [0.0, 0.22, 0.46, 0.68, 0.85, 0.955, 0.995];
  // Outer bevel rings transitioning from front (+halfT) around curved crimson skin to back (-halfT)
  const bevelProfile: Array<{ rMul: number; zFrac: number; uvR: number }> = [
    { rMul: 1.012, zFrac: 0.84, uvR: 0.975 },
    { rMul: 1.028, zFrac: 0.48, uvR: 0.985 },
    { rMul: 1.034, zFrac: 0.0, uvR: 0.992 },
    { rMul: 1.028, zFrac: -0.48, uvR: 0.985 },
    { rMul: 1.012, zFrac: -0.84, uvR: 0.975 },
  ];

  const halfT = thickness * 0.5;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Slight natural asymmetry & thickness taper (strawberry slice is slightly thicker at crown than tip)
  const asymX = (rand() - 0.5) * 0.08;
  const warpPhase = rand() * Math.PI * 2;

  function evalRadius(angle: number): number {
    const base = strawberryBoundaryRadius(angle);
    // Subtle natural organic irregularity + scalloped achene dimples along perimeter
    const asym = 1.0 + asymX * Math.cos(angle);
    const organic = 1.0 + 0.025 * Math.sin(angle * 3.0 + warpPhase);
    const scallop = 1.0 + 0.012 * Math.cos(angle * 26.0);
    return base * asym * organic * scallop;
  }

  function pushVertex(x: number, y: number, z: number, ux: number, uy: number) {
    positions.push(x, y, z);
    uvs.push(clamp(0.5 + 0.5 * ux, 0.002, 0.998), clamp(0.5 + 0.5 * uy, 0.002, 0.998));
  }

  // Helper: subtle cut-face undulation
  function faceZ(x: number, y: number, side: 1 | -1, rn: number): number {
    const taper = 1.0 + 0.18 * y; // thicker near crown
    const wave = (fbm3(x * 3.6 + off, y * 3.6, side * 1.7, 3) - 0.5) * 0.032;
    const dome = 1.0 - 0.10 * rn * rn;
    return side * (halfT * taper * dome + wave);
  }

  // Ring layout from front center -> front outer -> bevel -> back outer -> back center
  const ringOffsets: number[] = [];

  // 1. Front center (1 vertex)
  const frontCenterIdx = 0;
  pushVertex(0, 0, faceZ(0, 0, 1, 0), 0, 0);

  // 2. Front concentric rings
  for (let ri = 1; ri < faceRings.length; ri++) {
    const rn = faceRings[ri];
    ringOffsets.push(positions.length / 3);
    for (let ai = 0; ai <= segAng; ai++) {
      const ang = (ai / segAng) * Math.PI * 2 - Math.PI;
      const br = evalRadius(ang);
      const r = br * rn;
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      // Map UV using canonical strawberryBoundaryRadius so seeds align cleanly with geometry rim
      const uvBr = strawberryBoundaryRadius(ang);
      const ux = Math.cos(ang) * uvBr * rn;
      const uy = Math.sin(ang) * uvBr * rn;
      pushVertex(x, y, faceZ(x, y, 1, rn), ux, uy);
    }
  }

  // 3. Bevel skin rings
  for (let bi = 0; bi < bevelProfile.length; bi++) {
    const bp = bevelProfile[bi];
    ringOffsets.push(positions.length / 3);
    for (let ai = 0; ai <= segAng; ai++) {
      const ang = (ai / segAng) * Math.PI * 2 - Math.PI;
      const br = evalRadius(ang);
      // Extra subtle 3D dimple sculpting right along outer skin equator
      const seedDimple = 1.0 - 0.015 * Math.pow(0.5 + 0.5 * Math.cos(ang * 26.0), 4.0) * (1 - Math.abs(bp.zFrac));
      const r = br * bp.rMul * seedDimple;
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      const taper = 1.0 + 0.18 * y;
      const z = halfT * taper * 0.90 * bp.zFrac;
      const uvBr = strawberryBoundaryRadius(ang);
      const ux = Math.cos(ang) * uvBr * bp.uvR;
      const uy = Math.sin(ang) * uvBr * bp.uvR;
      pushVertex(x, y, z, ux, uy);
    }
  }

  // 4. Back concentric rings (outer -> inner)
  for (let ri = faceRings.length - 1; ri >= 1; ri--) {
    const rn = faceRings[ri];
    ringOffsets.push(positions.length / 3);
    for (let ai = 0; ai <= segAng; ai++) {
      const ang = (ai / segAng) * Math.PI * 2 - Math.PI;
      const br = evalRadius(ang);
      const r = br * rn;
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      const uvBr = strawberryBoundaryRadius(ang);
      const ux = Math.cos(ang) * uvBr * rn;
      const uy = Math.sin(ang) * uvBr * rn;
      pushVertex(x, y, faceZ(x, y, -1, rn), ux, uy);
    }
  }

  // 5. Back center
  const backCenterIdx = positions.length / 3;
  pushVertex(0, 0, faceZ(0, 0, -1, 0), 0, 0);

  // Triangulate front cap fan (CCW facing +Z)
  const firstRing = ringOffsets[0];
  for (let ai = 0; ai < segAng; ai++) {
    indices.push(frontCenterIdx, firstRing + ai, firstRing + ai + 1);
  }

  // Triangulate consecutive rings
  for (let r = 0; r < ringOffsets.length - 1; r++) {
    const a0 = ringOffsets[r];
    const b0 = ringOffsets[r + 1];
    for (let ai = 0; ai < segAng; ai++) {
      const a = a0 + ai;
      const a1 = a0 + ai + 1;
      const b = b0 + ai;
      const b1 = b0 + ai + 1;
      indices.push(a, b, a1);
      indices.push(a1, b, b1);
    }
  }

  // Triangulate back cap fan (CCW facing -Z)
  const lastRing = ringOffsets[ringOffsets.length - 1];
  for (let ai = 0; ai < segAng; ai++) {
    indices.push(backCenterIdx, lastRing + ai + 1, lastRing + ai);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates a sculpted 3D blueberry with oblate shape, organic lumpiness,
 * and a true 3D recessed 5-pointed star calyx crown at +Y pole.
 */
function createBlueberryGeometry(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const off = rand() * 40;
  const starPhase = rand() * Math.PI * 2;
  const oblate = 0.85 + rand() * 0.06;

  const segU = 32;
  const segV = 24;
  const geo = new THREE.SphereGeometry(1, segU, segV);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);

    const phi = Math.acos(clamp(vy, -1, 1)); // 0 at +Y calyx pole, PI at -Y stem pole
    const theta = Math.atan2(vz, vx);

    // Subtle organic berry lumpiness
    const lump = 1.0 + (fbm3(vx * 2.6 + off, vy * 2.6, vz * 2.6, 3) - 0.5) * 0.085;

    // 5-pointed star calyx crown at north pole (phi < 0.52)
    let rMod = lump;
    let yLift = 0;
    if (phi < 0.52) {
      const star = Math.pow(0.5 + 0.5 * Math.cos(theta * 5.0 + starPhase), 1.45);
      // Sunken central crater
      const pit = 1.0 - smoothstep(0.0, 0.24, phi);
      // Raised 5-point serrated sepal crest right around phi ~ 0.28
      const crest = Math.exp(-Math.pow((phi - 0.27) / 0.085, 2.0)) * (0.45 + 0.85 * star);
      // Slight outer shoulder ring around calyx
      rMod *= 1.0 - pit * 0.20 + crest * 0.09;
      yLift += crest * 0.095 - pit * 0.14;
    }

    // Subtle stem dimple at south pole
    if (phi > Math.PI - 0.26) {
      const dimp = smoothstep(Math.PI - 0.26, Math.PI, phi);
      rMod *= 1.0 - dimp * 0.09;
    }

    pos.setXYZ(i, vx * rMod, vy * oblate * rMod + yLift, vz * rMod);
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates a realistic beveled blonde-birch wooden popsicle stick.
 */
function createWoodStickGeometry(): THREE.BufferGeometry {
  const hw = POPSICLE.stickWidth * 0.5;
  const topY = POPSICLE.stickTopY;
  const botY = POPSICLE.stickBottomY;
  const r = hw;

  const shape = new THREE.Shape();
  shape.moveTo(-hw, botY);
  shape.lineTo(hw, botY);
  shape.lineTo(hw, topY - r);
  shape.absarc(0, topY - r, r, 0, Math.PI, false);
  shape.lineTo(-hw, botY);

  const depth = POPSICLE.stickDepth * 0.62;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: POPSICLE.stickBevelThickness,
    bevelSize: POPSICLE.stickBevelSize,
    bevelSegments: 4,
    curveSegments: 20,
  });

  // Center stick cleanly along Z = 0
  geo.translate(0, 0, -depth * 0.5);

  // Normalize UVs cleanly across the stick bounds so birch grain runs vertically
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const spanY = topY - botY;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const u = clamp(0.5 + (x + z * 0.35) / (POPSICLE.stickWidth * 1.08), 0.01, 0.99);
    const v = clamp((y - botY) / spanY, 0.0, 1.0);
    uv.setXY(i, u, v);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates a physical strawberry slice material enhanced with backlit translucent SSS
 * AND per-slice GPU soft-thaw vertex bending (`uBend`) so warmed slices gently droop
 * and flex organically as they loosen and fall!
 * Shares compiled shader program across all slices via `customProgramCacheKey`.
 */
function createStrawberryMaterial(textures: StrawberryTextures): {
  material: THREE.MeshPhysicalMaterial;
  uBend: { value: THREE.Vector3 };
} {
  const uBend = { value: new THREE.Vector3(0, 0, 0) };
  const material = new THREE.MeshPhysicalMaterial({
    map: textures.albedo,
    bumpMap: textures.bump,
    bumpScale: 0.016,
    roughness: 0.28,
    metalness: 0.0,
    clearcoat: 0.78,
    clearcoatRoughness: 0.16,
    envMapIntensity: 0.85,
  });

  material.customProgramCacheKey = () => 'strawberry-softbend-v1';

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTranslucencyMap = { value: textures.translucency };
    shader.uniforms.uBacklightDir = { value: new THREE.Vector3(0.0, 0.08, -1.0).normalize() };
    shader.uniforms.uBend = uBend;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uBend;
        varying vec2 vBerryUv;
        varying vec3 vBerryWorldNormal;
        varying vec3 vBerryWorldPos;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        {
          float dBdx = 2.0 * uBend.x * position.x + 2.0 * uBend.z * abs(position.x);
          float dBdy = 2.0 * uBend.x * position.y + 2.0 * uBend.y * abs(position.y);
          objectNormal = normalize(vec3(
            objectNormal.x - objectNormal.z * dBdx,
            objectNormal.y - objectNormal.z * dBdy,
            objectNormal.z
          ));
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float bR2 = position.x * position.x + position.y * position.y;
          float bendZ = uBend.x * bR2 + uBend.y * position.y * abs(position.y) + uBend.z * position.x * abs(position.x);
          transformed.z += bendZ;
          // Subtle length-preserving inward draw so soft berry tissue curls naturally without stretching
          float bendMag = abs(uBend.x) + abs(uBend.y) * 0.65 + abs(uBend.z) * 0.65;
          transformed.xy *= 1.0 - clamp(bendMag * 0.16 * bR2, 0.0, 0.22);
        }`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vBerryUv = uv;
        vec4 berryWp = modelMatrix * vec4(transformed, 1.0);
        vBerryWorldPos = berryWp.xyz;
        vBerryWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uTranslucencyMap;
        uniform vec3 uBacklightDir;
        varying vec2 vBerryUv;
        varying vec3 vBerryWorldNormal;
        varying vec3 vBerryWorldPos;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 bViewDir = normalize(cameraPosition - vBerryWorldPos);
          vec3 bNorm = normalize(vBerryWorldNormal);
          float sssMask = texture2D(uTranslucencyMap, vBerryUv).r;
          // Strong studio lightbox transmission through thin strawberry slice!
          float viewBack = pow(clamp(dot(bViewDir, -uBacklightDir), 0.0, 1.0), 1.4) * 0.65 + 0.35;
          float faceWrap = 0.55 + 0.45 * abs(dot(bNorm, uBacklightDir));
          // Luminous fiery scarlet-crimson to warm coral-peach backlit core transmission
          vec3 sssTint = mix(vec3(1.22, 0.14, 0.06), vec3(1.42, 0.62, 0.42), smoothstep(0.50, 0.96, sssMask));
          vec3 sssGlow = diffuseColor.rgb * sssTint * (0.55 + 1.05 * sssMask) * viewBack * faceWrap;
          reflectedLight.directDiffuse += sssGlow * 0.78;
        }`,
      );
  };

  return { material, uBend };
}

/**
 * Creates a macro blueberry material with deep dark glossy wet indigo skin.
 * Shares a single compiled GPU shader program across all blueberries via `customProgramCacheKey`
 * while driving per-berry wet-thaw richness (`uThaw`) so uncovered berries look cleanly wet and
 * ice-free (ZERO chalky white frost halo or frozen haze!).
 */
function createBlueberryMaterial(textures: BlueberryTextures): {
  material: THREE.MeshPhysicalMaterial;
  uThaw: { value: number };
} {
  const uThaw = { value: 0.0 };
  const material = new THREE.MeshPhysicalMaterial({
    map: textures.albedo,
    bumpMap: textures.bump,
    bumpScale: 0.022,
    roughnessMap: textures.roughness,
    roughness: 0.28,
    metalness: 0.0,
    // Keep clearcoat at 0 so Three.js clearcoatSpecularIndirect NEVER paints a blinding white Fresnel ring
    // around spherical blueberry silhouettes! Crisp wet gloss is shaded explicitly below.
    clearcoat: 0.0,
    specularIntensity: 0.32,
    envMapIntensity: 0.12,
  });

  material.customProgramCacheKey = () => 'blueberry-wetthaw-v3';

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uThaw = uThaw;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vBlueWorldPos;
        varying vec3 vBlueWorldNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vBlueWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vBlueWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uThaw;
        varying vec3 vBlueWorldPos;
        varying vec3 vBlueWorldNormal;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Wetting uncovered blueberry skin deepens & saturates its midnight-indigo color (zero frosted haze!)
          vec3 wetRich = pow(max(diffuseColor.rgb, vec3(0.0001)), vec3(1.18)) * vec3(0.60, 0.62, 0.84);
          diffuseColor.rgb = mix(diffuseColor.rgb, wetRich, clamp(uThaw, 0.0, 1.0) * 0.85);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.16), clamp(uThaw, 0.0, 1.0) * 0.85);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 vDir = normalize(cameraPosition - vBlueWorldPos);
          vec3 nDir = normalize(vBlueWorldNormal);
          float ndv = clamp(abs(dot(nDir, vDir)), 0.0, 1.0);
          float thaw = clamp(uThaw, 0.0, 1.0);

          // Suppress grazing backlight & studio-env Fresnel wash at spherical rims so berries NEVER wear a white frozen halo!
          float rimMask = smoothstep(0.04, 0.56, ndv);
          reflectedLight.indirectSpecular *= mix(0.08, 0.85, rimMask);
          reflectedLight.directSpecular *= mix(0.10, 1.0, rimMask);
          reflectedLight.indirectDiffuse *= mix(0.68, 1.0, smoothstep(0.04, 0.45, ndv));

          // Crisp localized wet studio pinpoint catchlights on fresh glossy uncovered blueberry skin
          vec3 lA = normalize(vec3(-0.52, 0.54, 0.66));
          vec3 lB = normalize(vec3(0.56, 0.38, 0.73));
          vec3 hA = lA + vDir;
          hA *= inversesqrt(max(dot(hA, hA), 1e-8));
          vec3 hB = lB + vDir;
          hB *= inversesqrt(max(dot(hB, hB), 1e-8));
          float spA = pow(max(dot(nDir, hA), 0.0), 175.0);
          float spB = pow(max(dot(nDir, hB), 0.0), 130.0);
          reflectedLight.directSpecular += vec3(1.55, 1.58, 1.68) * (spA * 1.15 + spB * 0.60) * (0.28 + 0.72 * thaw);
        }`,
      );
  };

  return { material, uThaw };
}

/**
 * Generates a realistic sculpted 3D aggregate drupelet raspberry:
 * - Properly outward-wound solid plump drupelets packed tightly around a deep ruby core (never hollow/transparent!)
 * - A tiny delicate curved botanical hair (style) emerging from each outer drupelet ball
 * - Organic form variants: 0 = whole (gently irregular/pressed), 1 = squashed/compressed, 2 = halved longitudinal cup
 * - Natural per-drupelet color variation plus occasional odd-colored drupelets (pale blush-pink, peach-coral, deep wine)
 */
function createRaspberryGeometry(seed: number, variant = 0): THREE.BufferGeometry {
  const rand = mulberry32(seed * 73 + 19 + variant * 131);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const hairFlags: number[] = [];
  const indices: number[] = [];

  const isSquashed = variant === 1;
  const isHalved = variant === 2;

  // Organic global deformation per berry (applied primarily to drupelet layout so squashed berries stay plump, never jellybean-stretched!)
  const squashX = isSquashed ? 1.12 + rand() * 0.14 : 0.94 + rand() * 0.12;
  const squashY = isSquashed ? 0.90 + rand() * 0.12 : 0.96 + rand() * 0.10;
  const squashZ = isSquashed ? 0.54 + rand() * 0.12 : isHalved ? 0.92 + rand() * 0.08 : 0.82 + rand() * 0.14;
  // Local drupelet keeps plump roundness (only gently flattened by ~28% of berry squash)
  const localSqX = 1.0 + (squashX - 1.0) * 0.28;
  const localSqY = 1.0 + (squashY - 1.0) * 0.28;
  const localSqZ = 1.0 + (squashZ - 1.0) * 0.34;
  const bendX = (rand() - 0.5) * 0.16;
  const bendZ = (rand() - 0.5) * 0.12;

  function srgbToLin(c: number): number {
    const v = clamp(c, 0, 1);
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function deformCenter(x: number, y: number, z: number): [number, number, number] {
    const y2 = y * y;
    return [(x + bendX * y2) * squashX, y * squashY, (z + bendZ * y2) * squashZ];
  }

  function pushOutwardTri(i0: number, i1: number, i2: number) {
    const x0 = positions[i0 * 3], y0 = positions[i0 * 3 + 1], z0 = positions[i0 * 3 + 2];
    const x1 = positions[i1 * 3], y1 = positions[i1 * 3 + 1], z1 = positions[i1 * 3 + 2];
    const x2 = positions[i2 * 3], y2 = positions[i2 * 3 + 1], z2 = positions[i2 * 3 + 2];
    const ex1 = x1 - x0, ey1 = y1 - y0, ez1 = z1 - z0;
    const ex2 = x2 - x0, ey2 = y2 - y0, ez2 = z2 - z0;
    const cx = ey1 * ez2 - ez1 * ey2;
    const cy = ez1 * ex2 - ex1 * ez2;
    const cz = ex1 * ey2 - ey1 * ex2;
    const nx = normals[i0 * 3] + normals[i1 * 3] + normals[i2 * 3];
    const ny = normals[i0 * 3 + 1] + normals[i1 * 3 + 1] + normals[i2 * 3 + 1];
    const nz = normals[i0 * 3 + 2] + normals[i1 * 3 + 2] + normals[i2 * 3 + 2];
    if (cx * nx + cy * ny + cz * nz >= 0) {
      indices.push(i0, i1, i2);
    } else {
      indices.push(i0, i2, i1);
    }
  }

  let vertBase = 0;
  let oddCount = 0;

  function pickDrupeletColor(forceOdd: boolean): [number, number, number] {
    // Keep odd-colored drupelets natural & occasional (1-2 per berry, never big beige clumps!)
    const canOdd = oddCount < 2;
    const oddRoll = forceOdd && canOdd ? rand() : canOdd && rand() < 0.045 ? rand() : -1;
    if (oddRoll >= 0) {
      oddCount++;
      if (oddRoll < 0.44) {
        // Overripe deep burgundy-plum / dark wine drupelet
        return [0.27 + rand() * 0.08, 0.025 + rand() * 0.025, 0.11 + rand() * 0.05];
      }
      if (oddRoll < 0.78) {
        // Unripe translucent pale rose-pink drupelet (still juicy berry-tinted, never opaque beige!)
        return [0.85 + rand() * 0.07, 0.36 + rand() * 0.12, 0.42 + rand() * 0.12];
      }
      // Sun-blushed warm coral-apricot odd drupelet
      return [0.86 + rand() * 0.06, 0.44 + rand() * 0.12, 0.30 + rand() * 0.10];
    }
    // Natural juicy raspberry ruby-magenta palette with organic ball-to-ball ripeness variation
    const tone = rand();
    return [
      0.56 + tone * 0.22,
      0.038 + tone * 0.062,
      0.13 + tone * 0.125,
    ];
  }

  function addDrupeletHair(
    rootX: number,
    rootY: number,
    rootZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    drupR: number,
    baseCol: [number, number, number],
  ) {
    // Whisper-fine, gracefully curled tiny botanical hair (style) emerging from each drupelet ball
    const len = drupR * (0.38 + rand() * 0.24);
    const curlX = (rand() - 0.5) * 0.85;
    const curlY = -0.45 - rand() * 0.45;
    const curlZ = (rand() - 0.5) * 0.85;

    const refX = Math.abs(dirY) < 0.9 ? 0 : 1;
    const refY = Math.abs(dirY) < 0.9 ? 1 : 0;
    const refZ = 0;
    let tx = dirY * refZ - dirZ * refY;
    let ty = dirZ * refX - dirX * refZ;
    let tz = dirX * refY - dirY * refX;
    const tLen = Math.hypot(tx, ty, tz) || 1;
    tx /= tLen; ty /= tLen; tz /= tLen;
    const bx = dirY * tz - dirZ * ty;
    const by = dirZ * tx - dirX * tz;
    const bz = dirX * ty - dirY * tx;

    const sides = 3;
    const rings = [
      { t: 0.0, rad: 0.0115, hFlag: 0.35 },
      { t: 0.38, rad: 0.0075, hFlag: 0.72 },
      { t: 0.74, rad: 0.0042, hFlag: 0.92 },
      { t: 1.0, rad: 0.0018, hFlag: 1.0 },
    ];

    // Delicate dusty rose-amber botanical hair tint (soft & organic, never bright white cactus spines!)
    const tipCol: [number, number, number] = [0.66, 0.38, 0.36];
    const startVert = vertBase;

    for (let rIdx = 0; rIdx < rings.length; rIdx++) {
      const { t, rad, hFlag } = rings[rIdx];
      const curve = t * t * len * 0.52;
      const px = rootX + dirX * (t * len) + curlX * curve;
      const py = rootY + dirY * (t * len) + curlY * curve;
      const pz = rootZ + dirZ * (t * len) + curlZ * curve;

      const mixC = smoothstep(0.0, 0.78, t);
      const cr = srgbToLin(baseCol[0] * (1 - mixC) + tipCol[0] * mixC);
      const cg = srgbToLin(baseCol[1] * (1 - mixC) + tipCol[1] * mixC);
      const cb = srgbToLin(baseCol[2] * (1 - mixC) + tipCol[2] * mixC);

      for (let s = 0; s <= sides; s++) {
        const ang = (s / sides) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const nx = tx * ca + bx * sa;
        const ny = ty * ca + by * sa;
        const nz = tz * ca + bz * sa;

        positions.push(px + nx * rad, py + ny * rad, pz + nz * rad);
        normals.push(nx, ny, nz);
        uvs.push(s / sides, t);
        colors.push(cr, cg, cb);
        hairFlags.push(hFlag);
      }
    }

    const stride = sides + 1;
    for (let rIdx = 0; rIdx < rings.length - 1; rIdx++) {
      for (let s = 0; s < sides; s++) {
        const a = startVert + rIdx * stride + s;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        pushOutwardTri(a, b, c);
        pushOutwardTri(b, d, c);
      }
    }
    vertBase += rings.length * stride;
  }

  const segU = 10;
  const segV = 7;

  function addDrupelet(
    cxRaw: number,
    cyRaw: number,
    czRaw: number,
    r: number,
    ao: number,
    srgbCol: [number, number, number],
    withHair: boolean,
    cutHalfPlane = false,
  ) {
    const startVert = vertBase;
    const [cx, cy, cz] = deformCenter(cxRaw, cyRaw, czRaw);
    const cLen = Math.hypot(cx, cy, cz) || 1;
    const outX = cx / cLen;
    const outY = cy / cLen;
    const outZ = cz / cLen;
    // Plump natural drupelet roundness with gentle organic squish against neighbors (never stretched jellybeans!)
    const locSqX = localSqX * (0.94 + rand() * 0.12);
    const locSqY = localSqY * (0.92 + rand() * 0.12);
    const locSqZ = localSqZ * (0.94 + rand() * 0.12);

    for (let iv = 0; iv <= segV; iv++) {
      const phi = (iv / segV) * Math.PI;
      const sp = Math.sin(phi);
      const cp = Math.cos(phi);
      for (let iu = 0; iu <= segU; iu++) {
        const th = (iu / segU) * Math.PI * 2;
        const nx0 = sp * Math.cos(th);
        const ny0 = cp;
        const nz0 = sp * Math.sin(th);

        // Gently pillow the inner contact face against the core so drupelets pack seamlessly
        const faceDot = nx0 * outX + ny0 * outY + nz0 * outZ;
        const squish = faceDot < 0 ? 1.0 + faceDot * 0.16 : 1.0 + faceDot * 0.04;
        const lx = cx + nx0 * r * locSqX * squish;
        const ly = cy + ny0 * r * locSqY * squish;
        let lz = cz + nz0 * r * locSqZ * squish;

        let isCutFace = false;
        const cutZ = 0.055 * squashZ;
        if (cutHalfPlane && lz > cutZ) {
          lz = cutZ + (lz - cutZ) * 0.14;
          isCutFace = true;
        }

        positions.push(lx, ly, lz);

        let nx = isCutFace ? nx0 * 0.25 : nx0 / locSqX;
        let ny = isCutFace ? ny0 * 0.25 : ny0 / locSqY;
        let nz = isCutFace ? 0.94 : nz0 / locSqZ;
        const nLen = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / nLen, ny / nLen, nz / nLen);
        uvs.push(iu / segU, iv / segV);

        // Rich crevice AO between packed drupelets; cut faces show slightly brighter juicy inner flesh
        const outDot = clamp((lx * nx0 + ly * ny0 + lz * nz0) / Math.max(0.15, Math.hypot(lx, ly, lz)), 0, 1);
        const shade = isCutFace
          ? clamp(0.84 + 0.16 * rand(), 0.72, 1.04)
          : clamp(ao * (0.30 + 0.78 * Math.pow(outDot, 0.88)), 0.20, 1.06);
        const rr = isCutFace ? Math.min(1, srgbCol[0] * 1.12 + 0.07) : srgbCol[0];
        const gg = isCutFace ? Math.min(1, srgbCol[1] * 1.30 + 0.08) : srgbCol[1];
        const bb = isCutFace ? Math.min(1, srgbCol[2] * 1.15 + 0.08) : srgbCol[2];
        colors.push(srgbToLin(rr * shade), srgbToLin(gg * shade * 0.95), srgbToLin(bb * shade * 0.96));
        hairFlags.push(0.0);
      }
    }

    const stride = segU + 1;
    for (let iv = 0; iv < segV; iv++) {
      for (let iu = 0; iu < segU; iu++) {
        const a = startVert + iv * stride + iu;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        pushOutwardTri(a, b, c);
        pushOutwardTri(b, d, c);
      }
    }
    vertBase += (segV + 1) * stride;

    if (withHair && (!cutHalfPlane || czRaw < 0.02)) {
      const hDirX = outX + (rand() - 0.5) * 0.28;
      const hDirY = outY * 0.75 - 0.14 + (rand() - 0.5) * 0.22;
      const hDirZ = outZ + (rand() - 0.5) * 0.28;
      const hLen = Math.hypot(hDirX, hDirY, hDirZ) || 1;
      const hx = hDirX / hLen, hy = hDirY / hLen, hz = hDirZ / hLen;
      addDrupeletHair(
        cx + hx * r * 0.94 * locSqX,
        cy + hy * r * 0.94 * locSqY,
        cz + hz * r * 0.94 * locSqZ,
        hx,
        hy,
        hz,
        r,
        srgbCol,
      );
    }
  }

  if (isHalved) {
    // Sculpted hollow inner receptacle cup wall (the iconic velvety pale-rose arch inside a halved raspberry!)
    const cupU = 14;
    const cupV = 10;
    const cupStart = vertBase;
    for (let iv = 0; iv <= cupV; iv++) {
      const t = iv / cupV; // 0 = top stem opening (+0.58), 1 = rounded inner cup bottom (-0.60)
      const y = 0.58 - t * 1.18;
      const cupR = 0.44 * Math.pow(Math.max(0.02, 1.0 - t * t * 0.94), 0.56);
      for (let iu = 0; iu <= cupU; iu++) {
        // Semicircle in -Z (back concave wall facing +Z viewer!)
        const ang = Math.PI + (iu / cupU) * Math.PI; // PI..2*PI -> sin(ang) <= 0 (-Z)
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const lx = ca * cupR;
        const lz = sa * cupR * 0.92 + 0.05;
        const [dx, dy, dz] = deformCenter(lx, y, lz);
        positions.push(dx, dy, dz);

        // Inward-facing cup normal pointing toward +Z open cavity
        let nx = -ca / squashX;
        let ny = (t * 0.55) / squashY;
        let nz = -sa / squashZ;
        const nLen = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / nLen, ny / nLen, nz / nLen);
        uvs.push(iu / cupU, t);

        // Velvety pale rose-crimson hollow core wall, deeper ruby-maroon deep inside the cup!
        const rimGlow = smoothstep(0.15, 1.0, Math.abs(ca));
        const depthAO = 0.42 + 0.46 * rimGlow + 0.14 * (1 - t);
        colors.push(
          srgbToLin(clamp((0.76 + 0.12 * rimGlow) * depthAO, 0, 1)),
          srgbToLin(clamp((0.24 + 0.20 * rimGlow) * depthAO, 0, 1)),
          srgbToLin(clamp((0.30 + 0.18 * rimGlow) * depthAO, 0, 1)),
        );
        hairFlags.push(0.0);
      }
    }
    const cupStride = cupU + 1;
    for (let iv = 0; iv < cupV; iv++) {
      for (let iu = 0; iu < cupU; iu++) {
        const a = cupStart + iv * cupStride + iu;
        const b = a + 1;
        const c = a + cupStride;
        const d = c + 1;
        pushOutwardTri(a, b, c);
        pushOutwardTri(b, d, c);
      }
    }
    vertBase += (cupV + 1) * cupStride;
  } else {
    // Solid deep burgundy-ruby core underneath drupelets so ZERO background can ever peek between packed balls!
    addDrupelet(0, -0.04, 0, 0.62, 0.34, [0.40, 0.025, 0.095], false, false);
  }

  // Staggered organic drupelet rings forming the lush conical aggregate raspberry silhouette
  const rings: Array<{ y: number; ringR: number; count: number; drupR: number; phase: number }> = [
    { y: 0.56, ringR: 0.44, count: 8, drupR: 0.295, phase: rand() * 6.28 },
    { y: 0.18, ringR: 0.61, count: 10, drupR: 0.325, phase: rand() * 6.28 },
    { y: -0.24, ringR: 0.56, count: 9, drupR: 0.315, phase: rand() * 6.28 },
    { y: -0.62, ringR: 0.36, count: 6, drupR: 0.290, phase: rand() * 6.28 },
  ];

  // Give ~58% of berries one intentional odd-colored drupelet (subtle & natural, never overdone!)
  const oddTargetIdx = rand() < 0.58 ? Math.floor(rand() * 26) : -1;
  let drupIdx = 0;

  for (const ring of rings) {
    for (let k = 0; k < ring.count; k++) {
      const ang = ring.phase + (k / ring.count) * Math.PI * 2 + (rand() - 0.5) * 0.16;
      const rr = ring.ringR * (0.93 + rand() * 0.13);
      const cx = Math.cos(ang) * rr;
      const cz = Math.sin(ang) * rr;
      const cy = ring.y + (rand() - 0.5) * 0.08;
      if (isHalved && cz > 0.18) {
        drupIdx++;
        continue;
      }
      const dr = ring.drupR * (0.91 + rand() * 0.18);
      const col = pickDrupeletColor(drupIdx === oddTargetIdx);
      addDrupelet(cx, cy, cz, dr, 0.98, col, true, isHalved);
      drupIdx++;
    }
  }
  // Rounded apex tip drupelet
  addDrupelet(
    (rand() - 0.5) * 0.06,
    -0.82,
    isHalved ? -0.10 : (rand() - 0.5) * 0.06,
    0.29,
    1.0,
    pickDrupeletColor(false),
    true,
    isHalved,
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aHair', new THREE.Float32BufferAttribute(hairFlags, 1));
  geo.setIndex(indices);
  return geo;
}

/**
 * Generates an artisanal hand-chopped faceted dark chocolate chunk / shard.
 */
function createChocolateChunkGeometry(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed * 101 + 37);
  const geo = new THREE.IcosahedronGeometry(1.0, 3);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  // Generate 5 soft planar cleavage cuts for hand-chopped artisan dark chocolate chunks (smooth bevels, never low-poly!)
  const planes: Array<{ nx: number; ny: number; nz: number; d: number }> = [];
  for (let p = 0; p < 5; p++) {
    let nx = rand() * 2 - 1;
    let ny = rand() * 2 - 1;
    let nz = rand() * 2 - 1;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    planes.push({ nx, ny, nz, d: 0.56 + rand() * 0.24 });
  }
  const off = rand() * 25;
  const sx = 0.88 + rand() * 0.34;
  const sy = 0.72 + rand() * 0.34;
  const sz = 0.50 + rand() * 0.28;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    for (const pl of planes) {
      const proj = x * pl.nx + y * pl.ny + z * pl.nz;
      if (proj > pl.d) {
        // Smooth chamfered bevel near the cut plane instead of a harsh razor triangle seam
        const excess = proj - pl.d;
        const softCut = excess * (0.76 + 0.16 * smoothstep(0.0, 0.22, excess));
        x -= pl.nx * softCut;
        y -= pl.ny * softCut;
        z -= pl.nz * softCut;
      }
    }
    const chip = 1.0 + (fbm3(x * 3.8 + off, y * 3.8, z * 3.8, 2) - 0.5) * 0.09;
    pos.setXYZ(i, x * sx * chip, y * sy * chip, z * sz * chip);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates a delicate curled microplaned lemon zest ribbon (thin arched citrus peel curl).
 */
function createLemonZestGeometry(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed * 89 + 43);
  const segLen = 14;
  const segW = 2;
  const arcSpan = (1.1 + rand() * 1.45) * (rand() < 0.5 ? 1 : -1);
  const curlRadius = 0.72 + rand() * 0.38;
  const helixPitch = (rand() - 0.5) * 0.65;
  const twistSpan = (rand() - 0.5) * 1.6;
  const halfWidth = 0.22 + rand() * 0.08;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segLen; i++) {
    const t = i / segLen;
    const s = t - 0.5;
    const ang = s * arcSpan;
    const cx = Math.sin(ang) * curlRadius;
    const cz = (Math.cos(ang) - 1.0) * curlRadius;
    const cy = s * helixPitch;

    // Taper smoothly to pointed microplane ends
    const taper = Math.sin(t * Math.PI);
    const w = halfWidth * (0.28 + 0.72 * Math.pow(taper, 0.55));
    const twist = s * twistSpan;
    const ct = Math.cos(twist);
    const st = Math.sin(twist);

    const radX = Math.sin(ang);
    const radZ = Math.cos(ang);

    for (let j = 0; j <= segW; j++) {
      const v = j / segW;
      const lat = (v - 0.5) * 2.0 * w;
      const arch = (1.0 - (v - 0.5) * (v - 0.5) * 4.0) * 0.06;
      const px = cx + radX * (arch + lat * st);
      const py = cy + lat * ct;
      const pz = cz + radZ * (arch + lat * st);
      positions.push(px, py, pz);
      uvs.push(t * 2.0, v);
    }
  }

  const stride = segW + 1;
  for (let i = 0; i < segLen; i++) {
    for (let j = 0; j < segW; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates crunchy broken cookie chunks & jagged kaksmulor crumbs (inspired by cookies & cream paletas!).
 */
function createKaksmulorGeometry(seed: number, isChunk: boolean): THREE.BufferGeometry {
  const rand = mulberry32(seed * 137 + 61);
  const geo = new THREE.IcosahedronGeometry(1.0, isChunk ? 2 : 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const off = rand() * 30;
  // Flat crisp broken cookie wafer chunks vs chunky bite-sized irregular biscuit crumbs!
  const flatZ = isChunk ? 0.24 + rand() * 0.12 : 0.48 + rand() * 0.28;
  const stretchX = 0.86 + rand() * 0.38;
  const stretchY = 0.78 + rand() * 0.36;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const crag = 0.70 + fbm3(x * 3.4 + off, y * 3.4, z * 3.4, 3) * 0.54;
    const fineCrumble = fbm3(x * 11.5 - off, y * 11.5, z * 11.5, 2);
    const rMod = crag * (0.86 + fineCrumble * 0.26);
    pos.setXYZ(i, x * stretchX * rMod, y * stretchY * rMod, z * flatZ * rMod);
  }
  geo.computeVertexNormals();
  return geo;
}

function createRaspberryMaterial(tex: ToppingTextureSet): {
  material: THREE.MeshPhysicalMaterial;
  uThaw: { value: number };
} {
  const uThaw = { value: 0.0 };
  const material = new THREE.MeshPhysicalMaterial({
    map: tex.albedo,
    bumpMap: tex.bump,
    bumpScale: 0.022,
    roughnessMap: tex.roughness,
    roughness: 0.54,
    metalness: 0.0,
    clearcoat: 0.0,
    vertexColors: true,
    envMapIntensity: 0.18,
  });
  material.customProgramCacheKey = () => 'raspberry-wetthaw-v4';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uThaw = uThaw;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aHair;
        varying vec3 vRaspWorldPos;
        varying vec3 vRaspWorldNormal;
        varying float vHair;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vRaspWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRaspWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        vHair = aHair;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uThaw;
        varying vec3 vRaspWorldPos;
        varying vec3 vRaspWorldNormal;
        varying float vHair;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Preserve per-drupelet color diversity (rich ruby, pale blush-pink, peach, deep plum) while deepening slightly when wet!
          float thaw = clamp(uThaw, 0.0, 1.0);
          float hairMask = clamp(vHair, 0.0, 1.0);
          vec3 wetDeep = pow(max(diffuseColor.rgb, vec3(0.0001)), vec3(1.12));
          diffuseColor.rgb = mix(diffuseColor.rgb, wetDeep, (0.20 + thaw * 0.48) * (1.0 - hairMask));
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          float hairMask = clamp(vHair, 0.0, 1.0);
          float wetRough = mix(roughnessFactor, min(roughnessFactor, 0.22), clamp(uThaw, 0.0, 1.0) * 0.72);
          roughnessFactor = mix(wetRough, 0.86, hairMask);
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 vDir = normalize(cameraPosition - vRaspWorldPos);
          vec3 nDir = normalize(vRaspWorldNormal);
          float ndv = clamp(dot(nDir, vDir), 0.0, 1.0);
          float thaw = clamp(uThaw, 0.0, 1.0);
          float hairMask = clamp(vHair, 0.0, 1.0);
          float fleshMask = 1.0 - hairMask;

          // Keep individual drupelet edges clean (no white HDR plastic rings!)
          float rimMask = smoothstep(0.08, 0.58, ndv);
          reflectedLight.indirectSpecular *= mix(0.06, 0.42, rimMask) * fleshMask;
          reflectedLight.directSpecular *= mix(0.15, 0.85, rimMask) * fleshMask;

          // Slightly translucent (NOT transparent!) juicy drupelet subsurface scattering:
          // - Subtle darker inner seed depth right at drupelet center (ndv^2)
          // - Luminous warm backlit translucent ruby/blush glow through the thinner rounded drupelet shoulders!
          float seedCore = pow(ndv, 2.2) * 0.20 * fleshMask;
          reflectedLight.directDiffuse *= (1.0 - seedCore);
          reflectedLight.indirectDiffuse *= (1.0 - seedCore * 0.65);

          float thinGlow = pow(1.0 - ndv, 1.65) * smoothstep(0.04, 0.44, ndv);
          vec3 sssTint = max(diffuseColor.rgb, vec3(0.035)) * vec3(1.52, 0.54, 0.68) + diffuseColor.rgb * vec3(0.28, 0.08, 0.12);
          reflectedLight.directDiffuse += sssTint * (0.30 + 0.84 * thinGlow) * fleshMask;

          // Signature microscopic peach-fuzz velvety halo on fresh raspberry skin (softens when wet/thawed!)
          float velvetFuzz = pow(1.0 - ndv, 3.0) * (1.0 - thaw * 0.58) * fleshMask;
          vec3 fuzzCol = mix(diffuseColor.rgb * 1.45 + vec3(0.16, 0.07, 0.10), vec3(0.94, 0.72, 0.76), 0.52);
          reflectedLight.indirectDiffuse += fuzzCol * velvetFuzz * 0.24;

          // Subtle soft backlit tint on each tiny protruding botanical hair (whisper-fine dusty rose-amber, never stark white!)
          if (hairMask > 0.05) {
            float hairBacklit = 0.48 + 0.52 * pow(1.0 - ndv, 1.4);
            reflectedLight.directDiffuse += mix(diffuseColor.rgb, vec3(0.74, 0.46, 0.44), 0.45) * hairBacklit * hairMask * 0.26;
          }

          // Soft velvety satin sheen + delicate wet pinpoint on each plump drupelet crown (never plastic marble!)
          vec3 lA = normalize(vec3(-0.50, 0.54, 0.68));
          vec3 lB = normalize(vec3(0.56, 0.38, 0.73));
          vec3 hA = lA + vDir;
          hA *= inversesqrt(max(dot(hA, hA), 1e-8));
          vec3 hB = lB + vDir;
          hB *= inversesqrt(max(dot(hB, hB), 1e-8));
          float softVelvet = pow(max(dot(nDir, hA), 0.0), 42.0) * 0.22 + pow(max(dot(nDir, hB), 0.0), 34.0) * 0.12;
          float spA = pow(max(dot(nDir, hA), 0.0), 115.0);
          float spB = pow(max(dot(nDir, hB), 0.0), 88.0);
          reflectedLight.directSpecular += vec3(1.32, 1.08, 1.16) * (softVelvet + (spA * 0.48 + spB * 0.24) * (0.24 + 0.76 * thaw)) * fleshMask;
        }`,
      );
  };
  return { material, uThaw };
}

function createChocolateMaterial(tex: ToppingTextureSet): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: tex.albedo,
    bumpMap: tex.bump,
    bumpScale: 0.014,
    roughnessMap: tex.roughness,
    roughness: 0.48,
    metalness: 0.0,
    envMapIntensity: 0.32,
  });
}

function createLemonZestMaterial(tex: ToppingTextureSet): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: tex.albedo,
    bumpMap: tex.bump,
    bumpScale: 0.018,
    roughnessMap: tex.roughness,
    roughness: 0.46,
    metalness: 0.0,
    side: THREE.DoubleSide,
    envMapIntensity: 0.50,
  });
}

function createKaksmulorMaterial(tex: ToppingTextureSet): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: tex.albedo,
    bumpMap: tex.bump,
    bumpScale: 0.028,
    roughnessMap: tex.roughness,
    roughness: 0.90,
    metalness: 0.0,
    envMapIntensity: 0.14,
  });
}

interface FruitSpec {
  kind: ToppingId;
  x: number;
  y: number;
  z: number;
  scale: [number, number, number];
  rot: [number, number, number];
  radius: number;
  /** Optional inherent 3D slice curl [cupZ, curlY, asymX] for organically bent strawberry bites */
  baseBend?: [number, number, number];
  /** Variant flag (e.g. dark vs golden butter cookie crumb, or chunk vs fine crumb) */
  variant?: number;
}

/**
 * Generates deterministic topping placement inside the popsicle for any recipe.
 * Default seed-1 strawberry+blueberry water recipe reproduces the exact iconic hero composition;
 * custom toppings, other seeds, and opaque coconut bases adapt placement & surface peek depth automatically!
 */
function buildFruitLayout(seed: number, recipe: PopsicleRecipe): FruitSpec[] {
  const activeToppings = recipe.toppings;
  if (activeToppings.length === 0) return [];

  const isCoconut = recipe.base === 'coconut';
  const isDefaultHeroMix =
    seed === 1 &&
    !isCoconut &&
    activeToppings.length === 2 &&
    activeToppings.includes('strawberry') &&
    activeToppings.includes('blueberry');

  const rand = mulberry32(seed * 7919 + 13 + activeToppings.length * 97);

  if (isDefaultHeroMix) {
    const j = (amt: number) => (rand() - 0.5) * amt;
    return [
      // === STRAWBERRY SLICES (bite-sized, organic 3D pitches/curls — cleanly encased at t=0!) ===
      // 1. Hero diagonal bite — upper right (noticeably cupped & bent along its seed rim!)
      {
        kind: 'strawberry',
        x: 0.19 + j(0.01),
        y: 0.45 + j(0.01),
        z: 0.010,
        scale: [0.275, 0.325, 0.27],
        rot: [0.36, -0.44, -0.62],
        radius: 0.22,
        baseBend: [0.26, 0.18, -0.18],
      },
      // 2. Hero glowing curved bite — mid left (pronounced soft arch/curl!)
      {
        kind: 'strawberry',
        x: -0.22 + j(0.012),
        y: -0.09 + j(0.012),
        z: 0.006,
        scale: [0.26, 0.295, 0.255],
        rot: [-0.42, 0.56, 0.38],
        radius: 0.21,
        baseBend: [-0.34, 0.22, 0.22],
      },
      // 3. Fiery angled bite — bottom left (soft cupped curve across bottom-left corner)
      {
        kind: 'strawberry',
        x: -0.26 + j(0.012),
        y: -0.73 + j(0.012),
        z: 0.008,
        scale: [0.23, 0.265, 0.225],
        rot: [0.46, 0.50, -0.98],
        radius: 0.185,
        baseBend: [0.28, -0.16, 0.20],
      },
      // 4. Warm ruby bite — mid-lower right (gentler natural bend for visual variety)
      {
        kind: 'strawberry',
        x: 0.21 + j(0.015),
        y: -0.44 + j(0.015),
        z: -0.022,
        scale: [0.24, 0.275, 0.24],
        rot: [-0.50, -0.58, 0.78],
        radius: 0.195,
        baseBend: [-0.14, 0.12, -0.10],
      },
      // 5. Ruby berry crown fragment — very top dome
      {
        kind: 'strawberry',
        x: -0.01 + j(0.01),
        y: 0.91 + j(0.01),
        z: -0.008,
        scale: [0.155, 0.125, 0.14],
        rot: [0.58, 0.28, 2.82],
        radius: 0.115,
        baseBend: [0.22, 0.10, 0.12],
      },
      // 6. Small ruby accent wedge — upper mid-left (playful curled wedge)
      {
        kind: 'strawberry',
        x: -0.32 + j(0.015),
        y: 0.33 + j(0.015),
        z: -0.015,
        scale: [0.138, 0.162, 0.145],
        rot: [0.46, 0.62, -0.48],
        radius: 0.12,
        baseBend: [-0.26, -0.14, 0.16],
      },
      // 7. Small warm wedge — bottom right corner
      {
        kind: 'strawberry',
        x: 0.33 + j(0.015),
        y: -0.81 + j(0.015),
        z: -0.010,
        scale: [0.145, 0.165, 0.145],
        rot: [-0.42, -0.54, 1.18],
        radius: 0.12,
        baseBend: [0.16, 0.12, -0.12],
      },

      // === WHOLE SCULPTED BLUEBERRIES ===
      // 1. Upper-left blueberry (deeper -> softly frosted through ice!)
      {
        kind: 'blueberry',
        x: -0.17 + j(0.012),
        y: 0.65 + j(0.012),
        z: -0.034,
        scale: [0.155, 0.155, 0.146],
        rot: [1.15, 0.35, -0.25],
        radius: 0.15,
      },
      // 2. Mid-right blueberry (moderate depth -> velvety hazy contrast!)
      {
        kind: 'blueberry',
        x: 0.36 + j(0.012),
        y: -0.07 + j(0.012),
        z: -0.022,
        scale: [0.152, 0.152, 0.144],
        rot: [1.28, -0.52, 0.35],
        radius: 0.148,
      },
      // 3. Lower center-left HERO blueberry (just under glossy front ice -> crisp calyx!)
      {
        kind: 'blueberry',
        x: -0.155 + j(0.01),
        y: -0.45 + j(0.01),
        z: 0.028,
        scale: [0.146, 0.146, 0.138],
        rot: [1.18, 0.22, -0.18],
        radius: 0.142,
      },
      // 4. Lower center-right HERO blueberry (closest under thin front ice -> iconic 5-point star crown!)
      {
        kind: 'blueberry',
        x: 0.075 + j(0.01),
        y: -0.63 + j(0.01),
        z: 0.034,
        scale: [0.162, 0.162, 0.152],
        rot: [1.46, -0.28, 0.38],
        radius: 0.158,
      },
      // 5. Bottom center-right nestled blueberry
      {
        kind: 'blueberry',
        x: 0.21 + j(0.01),
        y: -0.84 + j(0.01),
        z: -0.004,
        scale: [0.128, 0.128, 0.122],
        rot: [1.35, 0.55, 0.12],
        radius: 0.124,
      },
      // 6. Deep left-edge berry peeking darkly at bottom-left
      {
        kind: 'blueberry',
        x: -0.43 + j(0.01),
        y: -0.53 + j(0.01),
        z: -0.032,
        scale: [0.128, 0.128, 0.122],
        rot: [1.22, 0.72, -0.4],
        radius: 0.124,
      },
      // 7. Lower-right edge berry
      {
        kind: 'blueberry',
        x: 0.42 + j(0.01),
        y: -0.67 + j(0.01),
        z: -0.026,
        scale: [0.132, 0.132, 0.124],
        rot: [1.10, -0.65, 0.22],
        radius: 0.128,
      },
    ];
  }

  // Generative recipe-aware layout for custom toppings, coconut base, or any seed!
  const specs: FruitSpec[] = [];
  const placed: Array<{ x: number; y: number; z: number; r: number }> = [];

  // On opaque coconut milk, tuck toppings closer to front/back mold walls so they peek gorgeously through
  // the thin creamy veil (just like real strawberry-coconut & cookies-and-cream paletas!)
  function tryPlace(
    kind: ToppingId,
    radius: number,
    yMin: number,
    yMax: number,
    zBias: number,
    variant = 0,
  ): boolean {
    const isSmallScatter = kind === 'shaved-lemon' || (kind === 'kaksmulor' && variant >= 2);
    for (let attempt = 0; attempt < 95; attempt++) {
      const y = yMin + rand() * (yMax - yMin);
      const hNorm = clamp((y - POPSICLE.yBottom) / (POPSICLE.yTop - POPSICLE.yBottom), 0, 1);
      const maxW = Math.max(0.05, baseHalfWidthAt(hNorm));
      const marginMul =
        kind === 'shaved-lemon'
          ? 1.55
          : kind === 'kaksmulor' && variant < 2
            ? 1.24
            : isSmallScatter
              ? 1.10
              : 1.08;
      const xRange = Math.max(0.04, maxW - radius * marginMul);
      const x = (rand() * 2 - 1) * xRange;

      const halfThickZ =
        kind === 'strawberry'
          ? radius * 0.44
          : kind === 'shaved-lemon'
            ? radius * 0.35
            : kind === 'kaksmulor' && variant < 2
              ? radius * 0.45
              : kind === 'chocolate'
                ? radius * 0.62
                : radius * 0.92;

      const maxSafeZ = Math.max(-0.02, POPSICLE.halfDepth - halfThickZ - (isCoconut ? 0.018 : 0.032));
      let z: number;
      if (isCoconut) {
        // Place most pieces right near the front creamy surface (+Z), a few on the back (-Z) for 3D orbit!
        const frontSide = rand() < 0.78 ? 1 : -1;
        const shallowZ = Math.max(0.02, maxSafeZ - rand() * 0.035);
        z = frontSide * shallowZ;
      } else {
        z = clamp(zBias + (rand() * 2 - 1) * 0.026, -0.05, maxSafeZ);
      }

      let ok = true;
      for (const p of placed) {
        const dx = x - p.x;
        const dy = y - p.y;
        const dz = (z - p.z) * 1.45;
        const minDist = (radius + p.r) * (isSmallScatter ? 0.62 : 0.78);
        if (dx * dx + dy * dy + dz * dz < minDist * minDist) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      placed.push({ x, y, z, r: radius });
      if (kind === 'strawberry') {
        const s = radius * 1.22;
        const signX = rand() < 0.5 ? -1 : 1;
        const signY = rand() < 0.5 ? -1 : 1;
        const bendSign = rand() < 0.5 ? -1 : 1;
        const extraCurl = rand() < 0.55 ? 0.22 + rand() * 0.16 : 0.08 + rand() * 0.10;
        // On coconut base, orient strawberry slices slightly flatter toward the front face like real paletas!
        const pitch = isCoconut ? signX * (0.08 + rand() * 0.18) : signX * (0.28 + rand() * 0.36);
        const yaw = isCoconut ? signY * (0.08 + rand() * 0.22) : signY * (0.32 + rand() * 0.42);
        specs.push({
          kind,
          x,
          y,
          z,
          scale: [s * (0.94 + rand() * 0.12), s * (1.04 + rand() * 0.14), s],
          rot: [pitch, yaw, (rand() - 0.5) * Math.PI * 1.8],
          radius,
          baseBend: [bendSign * extraCurl, (rand() - 0.5) * 0.36, (rand() - 0.5) * 0.34],
        });
      } else if (kind === 'blueberry') {
        specs.push({
          kind,
          x,
          y,
          z,
          scale: [radius, radius, radius * 0.94],
          rot: [1.0 + rand() * 0.65, (rand() - 0.5) * 1.4, (rand() - 0.5) * 1.2],
          radius,
        });
      } else if (kind === 'raspberry') {
        const isHalved = variant === 2;
        specs.push({
          kind,
          x,
          y,
          z,
          scale: [radius * 0.98, radius * 1.10, radius * 0.98],
          // Halved berries angle slightly toward the viewer so their hollow cut cup peeks organically through the ice
          rot: isHalved
            ? [(rand() - 0.5) * 0.95, (rand() - 0.5) * 1.15, (rand() - 0.5) * 2.6]
            : [(rand() - 0.5) * 2.2, (rand() - 0.5) * 2.8, (rand() - 0.5) * 2.4],
          radius,
          variant,
        });
      } else if (kind === 'chocolate') {
        specs.push({
          kind,
          x,
          y,
          z,
          scale: [radius * (0.95 + rand() * 0.35), radius * (0.85 + rand() * 0.32), radius * (0.80 + rand() * 0.28)],
          rot: [rand() * 3.14, rand() * 3.14, rand() * 3.14],
          radius,
        });
      } else if (kind === 'shaved-lemon') {
        specs.push({
          kind,
          x,
          y,
          z,
          scale: [radius * 1.35, radius * 1.35, radius * 1.2],
          rot: [(rand() - 0.5) * 1.2, (rand() - 0.5) * 1.4, rand() * Math.PI * 2],
          radius,
        });
      } else {
        // kaksmulor: variant 0/1 = larger broken cookie chunk, variant 2/3 = crunchy crumb scatter
        const isChunk = variant < 2;
        const s = isChunk ? radius * 1.12 : radius * 1.05;
        specs.push({
          kind,
          x,
          y,
          z,
          scale: [s, s * (0.88 + rand() * 0.24), s],
          rot: isChunk
            ? [(rand() - 0.5) * 0.55, (rand() - 0.5) * 0.65, rand() * Math.PI * 2]
            : [rand() * 3.14, rand() * 3.14, rand() * 3.14],
          radius,
          variant,
        });
      }
      return true;
    }
    return false;
  }

  const largePool: ToppingId[] = activeToppings.filter(
    (t) => t === 'strawberry' || t === 'blueberry' || t === 'raspberry' || t === 'chocolate',
  );
  const hasLemon = activeToppings.includes('shaved-lemon');
  const hasKaksmulor = activeToppings.includes('kaksmulor');

  // Distribute large hero chunks/berries harmoniously across upper, mid, and lower zones
  if (largePool.length > 0) {
    const perKind = largePool.length === 1 ? 10 : largePool.length === 2 ? 6 : largePool.length === 3 ? 4 : 3;
    const zones: Array<[number, number]> = [
      [0.32, 0.88],
      [-0.22, 0.34],
      [-0.86, -0.20],
    ];
    for (let k = 0; k < largePool.length; k++) {
      const kind = largePool[k];
      for (let n = 0; n < perKind; n++) {
        const [yMin, yMax] = zones[(n + k) % zones.length];
        if (kind === 'strawberry') {
          const r = n < 2 ? 0.235 : n < 4 ? 0.195 : 0.15;
          tryPlace(kind, r, yMin, yMax, n % 2 === 0 ? 0.042 : -0.015);
        } else if (kind === 'blueberry') {
          const r = 0.132 + rand() * 0.032;
          tryPlace(kind, r, yMin, yMax, n % 3 === 0 ? 0.056 : -0.012);
        } else if (kind === 'raspberry') {
          const r = 0.155 + rand() * 0.035;
          // Mix whole (gently pressed), squashed, and halved raspberries for natural organic variety!
          const raspVariant = n % 3 === 1 ? 1 : n % 3 === 2 ? 2 : 0;
          tryPlace(kind, r, yMin, yMax, n % 2 === 0 ? 0.045 : -0.015, raspVariant);
        } else if (kind === 'chocolate') {
          const r = 0.088 + rand() * 0.038;
          tryPlace(kind, r, yMin, yMax, n % 2 === 0 ? 0.052 : -0.010);
        }
      }
    }
  }

  // Kaksmulor: crisp broken dark-wafer biscuit pieces + rich scatter of fine cookie crumbs (cookies & cream!)
  if (hasKaksmulor) {
    const chunkCount = largePool.length === 0 ? 9 : 6;
    for (let n = 0; n < chunkCount; n++) {
      const yMin = -0.80 + (n / chunkCount) * 1.38;
      const yMax = Math.min(0.66, yMin + 0.28);
      const r = largePool.length === 0 ? 0.095 + rand() * 0.046 : 0.082 + rand() * 0.034;
      // 80% dark cocoa wafer chunks (classic cookies & cream!), 20% golden butter biscuit chunks
      const variant = rand() < 0.80 ? 0 : 1;
      tryPlace('kaksmulor', r, yMin, yMax, 0.056, variant);
    }
    const crumbCount = largePool.length === 0 ? 34 : 20;
    for (let n = 0; n < crumbCount; n++) {
      const r = 0.026 + rand() * 0.032;
      const variant = rand() < 0.78 ? 2 : 3;
      tryPlace('kaksmulor', r, -0.86, 0.74, 0.062, variant);
    }
  }

  // Shaved lemon: generous delicate bright-yellow curled citrus zest ribbons suspended cleanly inside!
  if (hasLemon) {
    const zestCount = largePool.length === 0 && !hasKaksmulor ? 26 : 18;
    for (let n = 0; n < zestCount; n++) {
      const r = 0.062 + rand() * 0.028;
      tryPlace('shaved-lemon', r, -0.84, 0.74, 0.052, n % 2);
    }
  }

  return specs;
}

export function createFruitAssembly(seed: number, recipe: PopsicleRecipe = DEFAULT_RECIPE): FruitAssembly {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];
  const palette = resolveOpticalPalette(recipe);

  // Reuse per-seed cached procedural textures ONLY for active toppings (instant Customize toggles, zero leak!)
  // Owned by `textures.ts` seed cache and freed via `disposeSeedTextureCache()` when seed changes.
  const activeSet = new Set(recipe.toppings);
  const strawTexA = activeSet.has('strawberry') ? getCachedStrawberryTextures(seed * 31 + 103) : null;
  const strawTexB = activeSet.has('strawberry') ? getCachedStrawberryTextures(seed * 37 + 211) : null;
  const blueTexA = activeSet.has('blueberry') ? getCachedBlueberryTextures(seed * 41 + 307) : null;
  const blueTexB = activeSet.has('blueberry') ? getCachedBlueberryTextures(seed * 43 + 419) : null;
  const raspTex = activeSet.has('raspberry') ? getCachedRaspberryTextures(seed * 47 + 521) : null;
  const chocTex = activeSet.has('chocolate') ? getCachedChocolateChunkTextures(seed * 53 + 613) : null;
  const lemonTex = activeSet.has('shaved-lemon') ? getCachedLemonZestTextures(seed * 59 + 709) : null;
  const kakaDarkTex = activeSet.has('kaksmulor') ? getCachedKaksmulorTextures(seed * 61 + 811, 'dark') : null;
  const kakaButterTex = activeSet.has('kaksmulor') ? getCachedKaksmulorTextures(seed * 67 + 907, 'butter') : null;

  // Birch wood popsicle stick with capillary damp wicking & dynamic flavor-colored stain!
  const woodTex = getCachedWoodTextures(seed * 19 + 503);
  const stickUniforms = {
    uIceBottomY: { value: POPSICLE.yBottom as number },
    uIceTopY: { value: POPSICLE.yTop as number },
    uIceAmount: { value: 1.0 as number },
    uStickWetness: { value: 0.0 as number },
    uStainColor: { value: new THREE.Vector3(palette.stainColor[0], palette.stainColor[1], palette.stainColor[2]) },
  };
  const stickMat = new THREE.MeshPhysicalMaterial({
    map: woodTex.albedo,
    bumpMap: woodTex.bump,
    bumpScale: 0.008,
    roughness: 0.72,
    metalness: 0.0,
    clearcoat: 0.0,
    clearcoatRoughness: 0.12,
    envMapIntensity: 0.62,
  });
  stickMat.customProgramCacheKey = () => 'wood-stick-v2';
  const carveStepX = (2.0 / CARVE_TEX_W).toFixed(7);
  const carveStepY = (2.0 / CARVE_TEX_H).toFixed(7);
  stickMat.onBeforeCompile = (shader) => {
    shader.uniforms.uIceBottomY = stickUniforms.uIceBottomY;
    shader.uniforms.uIceTopY = stickUniforms.uIceTopY;
    shader.uniforms.uIceAmount = stickUniforms.uIceAmount;
    shader.uniforms.uStickWetness = stickUniforms.uStickWetness;
    shader.uniforms.uStainColor = stickUniforms.uStainColor;
    shader.uniforms.uCarveMap = { value: woodTex.carving };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vStickWorldPos;
        varying vec3 vStickWorldNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vStickWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vStickWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uIceBottomY;
        uniform float uIceTopY;
        uniform float uIceAmount;
        uniform float uStickWetness;
        uniform vec3 uStainColor;
        uniform sampler2D uCarveMap;
        varying vec3 vStickWorldPos;
        varying vec3 vStickWorldNormal;
        float stickRevStep(float hi, float lo, float x) { return 1.0 - smoothstep(lo, hi, x); }
        vec3 stickSafeNorm(vec3 v) { return v * inversesqrt(max(dot(v, v), 1e-8)); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float sSharedDampMask = 0.0;
        float sSharedRevealedUpper = 0.0;
        float sSharedCarveGx = 0.0;
        float sSharedCarveGy = 0.0;
        float sSharedGroovePool = 0.0;
        float sSharedFrontFace = 0.0;
        {
          // Continuous seamless berry-stain along the entire stick (ZERO blonde seam at yBot or yTop!)
          float effRefY = mix(${POPSICLE.yBottom.toFixed(3)}, uIceBottomY, uIceAmount);
          float distBelow = effRefY - vStickWorldPos.y;
          float collarShadow = exp(-max(0.0, distBelow) * 16.0) * smoothstep(-0.08, 0.02, distBelow) * uIceAmount;
          float insideIce = stickRevStep(0.04, -0.10, distBelow) * stickRevStep(uIceTopY + 0.04, uIceTopY - 0.04, vStickWorldPos.y) * uIceAmount;

          // Upper stick (y > -1.02) has been soaking inside frozen berry ice the whole time -> seamless deep berry stain!
          float wasSubmerged = smoothstep(-1.14, -0.96, vStickWorldPos.y);
          float upperSoak = wasSubmerged * smoothstep(0.08, 0.36, uStickWetness);
          float revealedUpper = wasSubmerged * max(1.0 - uIceAmount, smoothstep(uIceTopY - 0.04, uIceTopY + 0.03, vStickWorldPos.y));
          sSharedRevealedUpper = revealedUpper;

          // Porous birch fibers progressively capillary-wick melted berry juice down the ENTIRE lower handle!
          float grainWick =
            0.50 + 0.30 * sin(vStickWorldPos.x * 58.0 + 1.1) +
            0.20 * sin(vStickWorldPos.x * 134.0 - 0.6);
          float progress = smoothstep(0.04, 0.78, uStickWetness);
          float edgeIrreg = (clamp(grainWick, 0.0, 1.0) - 0.5) * 0.20 * (1.0 - smoothstep(0.55, 0.88, uStickWetness));
          float wickReach = progress * 1.55 + edgeIrreg;
          // Overlap generously upward past effRefY so lowerSoak + upperSoak weld at 1.000 with ZERO band!
          float distPos = max(0.0, distBelow);
          float topOverlap = smoothstep(-0.30, -0.10, distBelow);
          float lowerSoak = stickRevStep(wickReach + 0.14, wickReach - 0.18, distPos) *
                            topOverlap *
                            smoothstep(0.02, 0.18, uStickWetness);
          float lowerDamp = stickRevStep(wickReach + 0.12, wickReach - 0.16, distPos) *
                            topOverlap *
                            smoothstep(0.03, 0.20, uStickWetness);
          sSharedDampMask = clamp(max(lowerDamp, revealedUpper), 0.0, 1.0);
          float soakFront = clamp(max(lowerSoak, upperSoak), 0.0, 1.0);
          float fullSoak = clamp(max(smoothstep(0.30, 0.90, uStickWetness) * lowerSoak, upperSoak * 0.95), 0.0, 1.0);

          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.82, 0.66, 0.64), collarShadow * 0.52);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.92, 0.76, 0.74), insideIce * 0.32 * (1.0 - upperSoak));

          // Natural damp flavor-stained birch wood (dynamically tints to match mango, berry, chocolate, coconut, etc.!)
          float woodLuma = dot(diffuseColor.rgb, vec3(0.30, 0.59, 0.11));
          vec3 lightTint = mix(vec3(0.88), uStainColor, 0.58);
          vec3 dampStainedWood = mix(
            diffuseColor.rgb * lightTint,
            uStainColor * woodLuma * 1.24,
            0.52 + 0.40 * fullSoak
          );
          vec3 deepStickyTip = uStainColor * 0.90 * woodLuma * 1.18;
          vec3 targetStain = mix(dampStainedWood, deepStickyTip, wasSubmerged * (0.28 + 0.22 * revealedUpper));
          diffuseColor.rgb = mix(diffuseColor.rgb, targetStain, soakFront * (0.58 + 0.38 * fullSoak));

          // Hidden carved signature on the front face of the upper stick underneath the ice cream!
          // Mapped cleanly to y in [-0.99, -0.46] (100% hidden while frozen, revealed as the popsicle melts!)
          // Single 5-tap pass shared directly with lights_fragment_end (halves uCarveMap texture bandwidth!)
          float frontFace = smoothstep(0.45, 0.78, vStickWorldNormal.z);
          sSharedFrontFace = frontFace;
          vec2 carveUv = vec2((vStickWorldPos.y + 0.99) / 0.53, (-vStickWorldPos.x + 0.088) / 0.176);
          if (frontFace > 0.01 && carveUv.x > 0.005 && carveUv.x < 0.995 && carveUv.y > 0.005 && carveUv.y < 0.995) {
            vec2 cTex = texture2D(uCarveMap, carveUv).rg;
            float depth = cTex.r * frontFace;
            float halo = cTex.g * frontFace;
            if (halo > 0.01 || depth > 0.01) {
              vec2 cStep = vec2(${carveStepX}, ${carveStepY});
              float cUp = texture2D(uCarveMap, carveUv + vec2(cStep.x, 0.0)).r;
              float cDn = texture2D(uCarveMap, carveUv - vec2(cStep.x, 0.0)).r;
              float cLt = texture2D(uCarveMap, carveUv + vec2(0.0, cStep.y)).r;
              float cRt = texture2D(uCarveMap, carveUv - vec2(0.0, cStep.y)).r;
              // Screen-space light comes from upper-left (-X, +Y): upper-left groove wall sits in shadow, lower-right catches warm rim!
              float bevelShade = ((cDn - cUp) * 0.72 + (cLt - cRt) * 0.68) * frontFace;
              sSharedCarveGx = cLt - cRt;
              sSharedCarveGy = cUp - cDn;
              sSharedGroovePool = depth;

              // Pressed/carved inner birch darkened by open wood grain + pooled flavor syrup inside the groove!
              vec3 carvedTint = mix(vec3(0.46, 0.28, 0.19), uStainColor * 0.48, soakFront);
              diffuseColor.rgb *= mix(1.0, 0.88, halo * 0.45);
              diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * carvedTint, clamp(depth * 0.84, 0.0, 0.84));
              // Subtle physical V-groove shadow & chamfer catchlight
              diffuseColor.rgb *= 1.0 + clamp(bevelShade * 0.48, -0.30, 0.22);
            }
          }
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          if (sSharedDampMask > 0.01) {
            vec3 sV = normalize(cameraPosition - vStickWorldPos);
            vec3 sN = normalize(vStickWorldNormal);
            // Reuse carved letter gradient computed in color_fragment so studio light glints on the indentation!
            if (sSharedGroovePool > 0.01) {
              sN = normalize(sN + vec3(sSharedCarveGx * 0.42, -sSharedCarveGy * 0.42, 0.0) * sSharedFrontFace);
            }
            float ndv = clamp(dot(sN, sV), 0.0, 1.0);
            // Natural damp-wood sticky satin sheen (preserves crisp birch wood grain without plastic glare!)
            float stickyFresnel = pow(1.0 - ndv, 4.2) * (0.08 + 0.10 * sSharedRevealedUpper);
            vec3 sH1 = stickSafeNorm(normalize(vec3(-0.52, 0.38, 0.76)) + sV);
            vec3 sH2 = stickSafeNorm(normalize(vec3(0.55, 0.32, 0.77)) + sV);
            float wetSpec = pow(max(dot(sN, sH1), 0.0), 72.0) * (0.30 + 0.14 * sSharedRevealedUpper)
                          + pow(max(dot(sN, sH2), 0.0), 58.0) * (0.22 + 0.10 * sSharedRevealedUpper);
            // Recessed groove holds slightly darker shadowed cavity while its chamfered rim catches gloss
            reflectedLight.directSpecular += vec3(1.08, 0.94, 0.93) * (wetSpec + stickyFresnel) * sSharedDampMask * (1.0 - sSharedGroovePool * 0.32);
          }
        }`,
      );
  };

  const stickGeo = createWoodStickGeometry();
  const stickMesh = new THREE.Mesh(stickGeo, stickMat);
  stickMesh.name = 'popsicle-stick';
  group.add(stickMesh);
  disposables.push(stickGeo, stickMat);

  // Generate individual 3D botanical & culinary topping meshes
  const specs = buildFruitLayout(seed, recipe);
  const fruits: FruitItem[] = [];
  const rand = mulberry32(seed * 97 + 7);

  // Share stateless PBR materials across multiple pieces of chocolate, lemon zest, and kaksmulor!
  const sharedChocMat = chocTex ? createChocolateMaterial(chocTex) : null;
  const sharedLemonMat = lemonTex ? createLemonZestMaterial(lemonTex) : null;
  const sharedKakaDarkMat = kakaDarkTex ? createKaksmulorMaterial(kakaDarkTex) : null;
  const sharedKakaButterMat = kakaButterTex ? createKaksmulorMaterial(kakaButterTex) : null;
  for (const m of [sharedChocMat, sharedLemonMat, sharedKakaDarkMat, sharedKakaButterMat]) {
    if (m) disposables.push(m);
  }

  specs.forEach((spec, idx) => {
    let geo: THREE.BufferGeometry;
    let mat: THREE.Material | null = null;
    let bendUniform: { value: THREE.Vector3 } | undefined;
    let thawUniform: { value: number } | undefined;

    switch (spec.kind) {
      case 'strawberry': {
        if (!strawTexA || !strawTexB) return;
        geo = createStrawberrySliceGeometry(seed * 131 + idx * 17 + 5, 0.16 + rand() * 0.04);
        const straw = createStrawberryMaterial(idx % 2 === 0 ? strawTexA : strawTexB);
        mat = straw.material;
        bendUniform = straw.uBend;
        disposables.push(mat);
        break;
      }
      case 'blueberry': {
        if (!blueTexA || !blueTexB) return;
        geo = createBlueberryGeometry(seed * 149 + idx * 23 + 11);
        const blue = createBlueberryMaterial(idx % 2 === 0 ? blueTexA : blueTexB);
        mat = blue.material;
        thawUniform = blue.uThaw;
        disposables.push(mat);
        break;
      }
      case 'raspberry': {
        if (!raspTex) return;
        geo = createRaspberryGeometry(seed * 157 + idx * 29 + 13, spec.variant ?? 0);
        const rasp = createRaspberryMaterial(raspTex);
        mat = rasp.material;
        thawUniform = rasp.uThaw;
        disposables.push(mat);
        break;
      }
      case 'chocolate': {
        if (!sharedChocMat) return;
        geo = createChocolateChunkGeometry(seed * 163 + idx * 31 + 17);
        mat = sharedChocMat;
        break;
      }
      case 'shaved-lemon': {
        if (!sharedLemonMat) return;
        geo = createLemonZestGeometry(seed * 173 + idx * 37 + 19);
        mat = sharedLemonMat;
        break;
      }
      case 'kaksmulor': {
        const isChunk = (spec.variant ?? 0) < 2;
        const isButter = (spec.variant ?? 0) % 2 === 1;
        mat = isButter ? sharedKakaButterMat : sharedKakaDarkMat;
        if (!mat) return;
        geo = createKaksmulorGeometry(seed * 179 + idx * 41 + 23, isChunk);
        break;
      }
    }
    disposables.push(geo);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(spec.x, spec.y, spec.z);
    mesh.scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);
    mesh.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
    mesh.name = `${spec.kind}-${idx}`;
    group.add(mesh);

    const bb = spec.baseBend ? new THREE.Vector3(spec.baseBend[0], spec.baseBend[1], spec.baseBend[2]) : new THREE.Vector3();
    if (bendUniform) bendUniform.value.copy(bb);

    fruits.push({
      kind: spec.kind,
      mesh,
      basePos: mesh.position.clone(),
      baseQuat: mesh.quaternion.clone(),
      baseScale: mesh.scale.clone(),
      radius: spec.radius,
      velocity: new THREE.Vector3(),
      angVel: new THREE.Vector3(),
      detached: false,
      detachTime: 0,
      grabbed: false,
      exposure: 0,
      bendAmt: bb.x,
      bendVel: 0,
      bendPhase: rand() * Math.PI * 2,
      baseBend: bb,
      bendUniform,
      thawUniform,
    });
  });

  // === TACTILE POINTER GRAB / PEEL / TOSS STATE ===
  const GRAB_EXPOSURE_MIN = 0.28; // matches exact onset of melt-shift movement ("almost released / start moving")
  let hoveredIdx = -1;
  let grabbedIdx = -1;
  let hoverTime = 0;
  const grabPlane = new THREE.Plane();
  const grabPlaneNormal = new THREE.Vector3(0, 0, 1);
  const grabAnchorPos = new THREE.Vector3();
  const grabOffset = new THREE.Vector3();
  const grabTargetPos = new THREE.Vector3();
  const grabHitTmp = new THREE.Vector3();
  const grabPrevPos = new THREE.Vector3();
  const grabThrowVel = new THREE.Vector3();
  const grabPullDelta = new THREE.Vector3();
  const grabClearLift = new THREE.Vector3();
  const grabBankQuat = new THREE.Quaternion();
  const grabBankEuler = new THREE.Euler();
  const grabBaseQuat = new THREE.Quaternion();
  const rayClosestTmp = new THREE.Vector3();
  let grabLiftProgress = 0;
  let grabNeedsLift = false;
  let grabHoldTime = 0;

  function isGrabbable(f: FruitItem): boolean {
    if (!f.mesh.visible) return false;
    return f.detached || f.exposure >= GRAB_EXPOSURE_MIN;
  }

  function clearGrabState() {
    if (grabbedIdx >= 0 && grabbedIdx < fruits.length) {
      fruits[grabbedIdx].grabbed = false;
    }
    grabbedIdx = -1;
    hoveredIdx = -1;
    grabThrowVel.set(0, 0, 0);
    grabNeedsLift = false;
    grabLiftProgress = 0;
    grabHoldTime = 0;
  }

  function reset() {
    clearGrabState();
    for (const f of fruits) {
      f.mesh.position.copy(f.basePos);
      f.mesh.quaternion.copy(f.baseQuat);
      f.mesh.scale.copy(f.baseScale);
      f.velocity.set(0, 0, 0);
      f.angVel.set(0, 0, 0);
      f.detached = false;
      f.detachTime = 0;
      f.grabbed = false;
      f.exposure = 0;
      f.bendAmt = f.baseBend.x;
      f.bendVel = 0;
      f.bendUniform?.value.copy(f.baseBend);
      if (f.thawUniform) f.thawUniform.value = 0;
      f.mesh.visible = true;
    }
    stickUniforms.uIceBottomY.value = POPSICLE.yBottom;
    stickUniforms.uIceTopY.value = POPSICLE.yTop;
    stickUniforms.uIceAmount.value = 1.0;
    stickUniforms.uStickWetness.value = 0.0;
  }

  const sagEuler = new THREE.Euler();
  const sagQuat = new THREE.Quaternion();
  const spinAxis = new THREE.Vector3();
  const spinQuat = new THREE.Quaternion();

  function fruitCollisionRadius(f: FruitItem): number {
    // Tilted strawberry slices & thin peels have thinner effective Z cross-section than plump spherical berries
    switch (f.kind) {
      case 'strawberry':
        return f.radius * 0.42;
      case 'shaved-lemon':
        return f.radius * 0.35;
      case 'kaksmulor':
        return f.radius * 0.50;
      case 'chocolate':
        return f.radius * 0.62;
      default:
        return f.radius * 0.84;
    }
  }

  /**
   * Physical mechanical ice-grip remaining around a fruit (>0 = gripped by ice, <=0 = slips free under gravity).
   * Evaluates 3D containment, lateral side-wall support (so slices/berries never dangle halfway out in mid-air),
   * front/back Z-slab thickness & face clearance (so plump berries release once the ice thins too far, without
   * false-loosening fresh or shallow coconut-base fruits while the popsicle is still thick & frozen),
   * and bottom-lip undercut support.
   */
  function evaluateFruitGrip(f: FruitItem, meltState: MeltFieldState, slideY = 0): number {
    const info = sampleIceContainment(f.basePos.x, f.basePos.y + slideY, f.basePos.z, meltState);
    const endgameBoost = smoothstep(0.60, 0.84, meltState.melt) * 0.06;
    const rZ = fruitCollisionRadius(f);
    const halfD = info.dz + Math.abs(f.basePos.z);
    return Math.min(
      info.depth - (f.radius * 0.20 + endgameBoost),
      info.dx - (f.radius * 0.54 + endgameBoost * 0.8),
      halfD - (rZ * 0.74 + endgameBoost * 0.7),
      info.dz - (rZ * 0.32 + endgameBoost * 0.5),
      info.dyBot - (f.radius * 0.36 + endgameBoost * 0.5),
    );
  }

  function applyPreReleasePose(f: FruitItem, grip: number, slideY = 0) {
    const gripFull = Math.max(0.045, f.radius * 0.48);
    f.exposure = clamp(1.0 - smoothstep(0.0, gripFull, grip), 0, 1);
    const sagRaw = smoothstep(GRAB_EXPOSURE_MIN, 1.0, f.exposure);
    // Quadratic ease-in creep: steady while gripped, gently beginning to slip downward right before letting go
    const sag = sagRaw * sagRaw;
    const sideSign = Math.abs(f.basePos.x) > 0.03 ? Math.sign(f.basePos.x) : 1;
    const zOutSign = f.basePos.z <= 0.004 ? -1 : 1;
    const isTopDome = f.basePos.y > 0.65;

    // Smooth wet-ice creep downward & fractionally outward (100% continuous with release — ZERO pop or jump!)
    // Top-dome fruits gently tip off the rounded peak toward the sloped front/back face instead of sinking into the ice
    f.mesh.position.set(
      f.basePos.x + sideSign * sag * 0.010,
      f.basePos.y + slideY - sag * (isTopDome ? 0.012 : 0.046),
      f.basePos.z + zOutSign * sag * (isTopDome ? 0.026 : 0.014),
    );
    sagEuler.set(zOutSign * sag * 0.12, 0, -sideSign * sag * 0.16);
    sagQuat.setFromEuler(sagEuler);
    f.mesh.quaternion.copy(f.baseQuat).multiply(sagQuat);
    f.mesh.scale.copy(f.baseScale);

    // Inherent organic slice curl + extra soft-thaw droop on exposed strawberry slices before slipping free
    const thawSoft = smoothstep(0.20, 1.0, f.exposure);
    const curlDir = f.baseBend.x >= 0 ? 1 : -1;
    f.bendAmt = f.baseBend.x + curlDir * thawSoft * 0.22;
    f.bendVel = 0;
    if (f.bendUniform) {
      f.bendUniform.value.set(
        f.bendAmt,
        f.baseBend.y + thawSoft * 0.12,
        f.baseBend.z - sideSign * thawSoft * 0.14,
      );
    }
    if (f.thawUniform) {
      // As soon as any part of a berry breaches the melting ice (exposure > 0.04), wet-thaw it cleanly!
      f.thawUniform.value = smoothstep(0.02, 0.38, f.exposure);
    }
  }

  function update(meltState: MeltFieldState, dt: number, stickWetness?: number) {
    const { yTop: yTopLive, yBot: yBotLive, slideY, iceAmount, iceGone } = getMeltBounds(meltState.melt);
    stickUniforms.uIceBottomY.value = yBotLive;
    stickUniforms.uIceTopY.value = yTopLive;
    stickUniforms.uIceAmount.value = iceAmount;
    if (stickWetness !== undefined) {
      stickUniforms.uStickWetness.value = clamp(
        Math.max(stickWetness * 1.1, smoothstep(0.012, 0.50, meltState.melt) * 0.96),
        0,
        1,
      );
    }

    // Pass 1: Update still-attached fruits (smooth pre-release creep + endgame ice slide) and let them slip free naturally!
    if (dt === 0 && grabbedIdx >= 0) {
      clearGrabState();
    }
    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      const grip = evaluateFruitGrip(f, meltState, slideY);
      const shouldRelease = iceGone || (meltState.melt > 0.14 && grip <= 0);

      if (dt === 0) {
        if (shouldRelease) {
          f.detached = true;
          f.mesh.visible = false;
        } else {
          f.detached = false;
          f.detachTime = 0;
          f.grabbed = false;
          f.mesh.visible = true;
          applyPreReleasePose(f, grip, slideY);
          f.velocity.set(0, 0, 0);
        }
        continue;
      }

      if (!f.detached) {
        if (f.grabbed) {
          // While user is gently tugging an almost-released fruit, update exposure & smoothly release if ice melts past grip
          const gripFull = Math.max(0.045, f.radius * 0.48);
          f.exposure = clamp(1.0 - smoothstep(0.0, gripFull, grip), 0, 1);
          if (f.thawUniform) f.thawUniform.value = Math.max(f.thawUniform.value, smoothstep(0.02, 0.38, f.exposure));
          if (shouldRelease) {
            f.detached = true;
            f.detachTime = 0;
            grabBaseQuat.copy(f.mesh.quaternion);
            grabNeedsLift = true;
            grabLiftProgress = 0;
            if (f.thawUniform) f.thawUniform.value = 1.0;
          }
          continue;
        }

        applyPreReleasePose(f, grip, slideY);

        // Subtle organic "ready to pluck" micro-wiggle when pointer hovers a loosened fruit
        if (i === hoveredIdx && f.exposure >= GRAB_EXPOSURE_MIN) {
          hoverTime += dt;
          const wig = Math.sin(hoverTime * 9.5) * 0.0055 * smoothstep(GRAB_EXPOSURE_MIN, 0.85, f.exposure);
          f.mesh.position.y -= Math.abs(wig) * 0.55;
          sagEuler.set(wig * 3.0, 0, wig * 6.5);
          sagQuat.setFromEuler(sagEuler);
          f.mesh.quaternion.multiply(sagQuat);
        }

        // Once ice grip reaches zero, slip naturally downward from the EXACT current position — ZERO jump or pop!
        if (shouldRelease) {
          f.detached = true;
          f.detachTime = 0;

          const sideX = Math.abs(f.basePos.x) > 0.04 ? Math.sign(f.basePos.x) : i % 2 === 0 ? 1 : -1;
          const pushZ = f.basePos.z <= 0.004 ? -1 : 1;

          // Continuous slow initial slip velocity (no outward pop-kick, no position teleport!)
          f.velocity.set(sideX * (0.028 + (i % 3) * 0.010), -0.055, pushZ * 0.028);

          // Gentle gravity roll as it lets go
          f.angVel.set(pushZ * 0.22, (i % 2 === 0 ? 1 : -1) * 0.12, -sideX * 0.30);

          const curlDir = f.baseBend.x >= 0 ? 1 : -1;
          f.bendVel = f.kind === 'strawberry' ? curlDir * 0.45 : 0.25;
          if (f.thawUniform) f.thawUniform.value = 1.0;
        }
      }
    }

    if (dt <= 0) return;

    // Pass 2: Smooth natural gravity fall with gentle continuous wet-surface glide (ZERO jump, ZERO sideways pop!)
    const substeps = 2;
    const subDt = dt / substeps;

    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      if (!f.detached || !f.mesh.visible || f.grabbed) continue;

      f.detachTime += dt;
      const rCol = fruitCollisionRadius(f);
      const sideX = Math.abs(f.basePos.x) > 0.04 ? Math.sign(f.basePos.x) : i % 2 === 0 ? 1 : -1;

      // Soft suction-break gravity ramp over the first ~0.16s so release looks genuinely heavy & slippery
      const peelRamp = 0.24 + 0.76 * smoothstep(0.0, 0.16, f.detachTime);
      const grav = (f.kind === 'strawberry' ? 4.8 : 5.6) * peelRamp;

      for (let s = 0; s < substeps; s++) {
        f.velocity.y -= grav * subDt;
        const airDrag = Math.exp(-subDt * (f.kind === 'strawberry' ? 0.55 : 0.25));
        f.velocity.x *= airDrag;
        f.velocity.z *= airDrag;
        f.mesh.position.addScaledVector(f.velocity, subDt);

        // Smooth, gently damped tumble
        f.angVel.multiplyScalar(Math.exp(-subDt * 0.9));
        const maxSpin = f.kind === 'strawberry' ? 2.2 : 2.8;
        if (f.angVel.lengthSq() > maxSpin * maxSpin) {
          f.angVel.setLength(maxSpin);
        }
        const wMag = f.angVel.length();
        if (wMag > 1e-4) {
          spinAxis.copy(f.angVel).divideScalar(wMag);
          spinQuat.setFromAxisAngle(spinAxis, wMag * subDt);
          f.mesh.quaternion.premultiply(spinQuat);
        }

        // Gentle continuous wet-surface glide if a falling fruit slides past the lower popsicle curve
        // (NO position teleport and NO sudden horizontal kick!)
        if (!iceGone) {
          const px = f.mesh.position.x;
          const py = f.mesh.position.y;
          const pz = f.mesh.position.z;
          if (py > yBotLive - 0.04 && py < yTopLive + 0.05) {
            const dIce = iceContainmentDepth(px, py, pz, meltState);
            const pen = dIce + rCol * 0.26;
            if (pen > 0) {
              const hitSideX = Math.abs(px) > 0.04 ? Math.sign(px) : sideX;
              const hitBackHalf = pz <= 0.004;
              const slideAccel = clamp(pen * 5.6, 0, 1.55);
              f.velocity.x += hitSideX * slideAccel * 0.30 * subDt;
              f.velocity.z += (hitBackHalf ? -1 : 1) * slideAccel * 1.15 * subDt;
              // Mild wet-surface glide friction while touching ice so top-released pieces slide over the face cleanly
              if (dIce > 0.02) {
                f.velocity.y *= Math.exp(-subDt * 2.2);
              }
              f.angVel.z -= hitSideX * slideAccel * 0.36 * subDt;
              f.angVel.x += (hitBackHalf ? -1 : 1) * slideAccel * 0.34 * subDt;
            }
          }
        }
      }

      // Soft damped spring deformation in flight (preserving each slice's organic curl + soft flutter!)
      const curlDir = f.baseBend.x >= 0 ? 1 : -1;
      const restBend =
        f.kind === 'strawberry'
          ? f.baseBend.x + curlDir * 0.15 + 0.07 * Math.sin(f.detachTime * 8.5 + f.bendPhase)
          : 0.0;
      const springF = (restBend - f.bendAmt) * 26.0 - f.bendVel * 5.0;
      f.bendVel += springF * dt;
      f.bendAmt = clamp(f.bendAmt + f.bendVel * dt, -0.54, 0.56);

      if (f.bendUniform) {
        const flutter = Math.sin(f.detachTime * 7.2 + f.bendPhase) * 0.09;
        f.bendUniform.value.set(f.bendAmt, f.baseBend.y + flutter, f.baseBend.z - sideX * Math.abs(f.bendAmt) * 0.34);
      } else {
        // Subtle soft wet-berry squish on blueberries
        const sq = clamp(f.bendAmt * 0.22, -0.07, 0.07);
        f.mesh.scale.set(
          f.baseScale.x * (1 + sq * 0.5),
          f.baseScale.y * (1 - sq),
          f.baseScale.z * (1 + sq * 0.5),
        );
      }

      // Floor / despawn sits far below the camera frustum so fruits fall cleanly out of sight
      if (f.mesh.position.y < -6.5 || f.detachTime > 3.0) {
        f.mesh.visible = false;
      }
    }
  }

  function pickGrabbableFruit(raycaster: THREE.Raycaster): number {
    const candidates: THREE.Object3D[] = [];
    const candidateIdx: number[] = [];
    for (let i = 0; i < fruits.length; i++) {
      if (isGrabbable(fruits[i])) {
        fruits[i].mesh.updateWorldMatrix(true, false);
        candidates.push(fruits[i].mesh);
        candidateIdx.push(i);
      }
    }
    if (candidates.length === 0) return -1;

    // 1. Exact 3D mesh raycast (closest surface hit wins)
    const hits = raycaster.intersectObjects(candidates, false);
    if (hits.length > 0) {
      const hitObj = hits[0].object;
      for (let k = 0; k < candidates.length; k++) {
        if (candidates[k] === hitObj) return candidateIdx[k];
      }
    }

    // 2. Forgiving ray-to-sphere proximity fallback so fast-falling / small berries are effortless to catch!
    let bestIdx = -1;
    let bestCamDist = Infinity;
    const ray = raycaster.ray;
    for (let k = 0; k < candidateIdx.length; k++) {
      const idx = candidateIdx[k];
      const f = fruits[idx];
      const distSq = ray.distanceSqToPoint(f.mesh.position);
      const pickR = f.radius * (f.detached ? 1.38 : 1.12);
      if (distSq <= pickR * pickR) {
        ray.closestPointToPoint(f.mesh.position, rayClosestTmp);
        const camDist = ray.origin.distanceToSquared(rayClosestTmp);
        if (camDist < bestCamDist) {
          bestCamDist = camDist;
          bestIdx = idx;
        }
      }
    }
    return bestIdx;
  }

  function setHoveredFruit(index: number) {
    if (index !== hoveredIdx) {
      hoveredIdx = index >= 0 && index < fruits.length && isGrabbable(fruits[index]) ? index : -1;
      hoverTime = 0;
    }
  }

  function beginGrab(index: number, raycaster: THREE.Raycaster, camera: THREE.Camera): boolean {
    if (index < 0 || index >= fruits.length) return false;
    const f = fruits[index];
    if (!isGrabbable(f)) return false;

    clearGrabState();
    grabbedIdx = index;
    f.grabbed = true;
    f.velocity.set(0, 0, 0);
    f.angVel.set(0, 0, 0);
    grabHoldTime = 0;

    // Camera-facing drag plane passing through the fruit so 1:1 pointer tracking works from ANY orbit angle!
    camera.getWorldDirection(grabPlaneNormal);
    grabPlane.setFromNormalAndCoplanarPoint(grabPlaneNormal, f.mesh.position);
    grabAnchorPos.copy(f.mesh.position);
    grabPrevPos.copy(f.mesh.position);
    grabBaseQuat.copy(f.mesh.quaternion);
    grabThrowVel.set(0, 0, 0);

    if (raycaster.ray.intersectPlane(grabPlane, grabHitTmp)) {
      grabOffset.copy(f.mesh.position).sub(grabHitTmp);
      // Clamp offset inside fruit radius so edge-grabs never feel off-center
      if (grabOffset.lengthSq() > f.radius * f.radius * 0.72) {
        grabOffset.setLength(f.radius * 0.85);
      }
      grabTargetPos.copy(grabHitTmp).add(grabOffset);
    } else {
      grabOffset.set(0, 0, 0);
      grabTargetPos.copy(f.mesh.position);
    }

    // If catching a falling fruit, gently glide it slightly clear of the ice surface if needed
    grabNeedsLift = f.detached && f.mesh.position.z < 0.28;
    grabLiftProgress = grabNeedsLift ? 0 : 1;
    if (f.detached) {
      f.detachTime = 0;
      if (f.thawUniform) f.thawUniform.value = 1.0;
    }
    return true;
  }

  function moveGrab(raycaster: THREE.Raycaster, meltState: MeltFieldState) {
    if (grabbedIdx < 0 || grabbedIdx >= fruits.length) return;
    const f = fruits[grabbedIdx];
    if (!raycaster.ray.intersectPlane(grabPlane, grabHitTmp)) return;

    grabTargetPos.copy(grabHitTmp).add(grabOffset);

    if (!f.detached) {
      // Sticky-suction peel threshold: almost-gone fruits pluck effortlessly, newly-shifting fruits take a tiny tug!
      const pullThresh = 0.048 - smoothstep(GRAB_EXPOSURE_MIN, 0.90, f.exposure) * 0.036;
      const pullDist = grabTargetPos.distanceTo(grabAnchorPos);
      if (pullDist >= pullThresh) {
        f.detached = true;
        f.detachTime = 0;
        grabBaseQuat.copy(f.mesh.quaternion);

        // Compute gentle lift toward camera so plucked berries clear the front ice cleanly while dragged!
        const { iceGone } = getMeltBounds(meltState.melt);
        const rCol = fruitCollisionRadius(f);
        const curDepth = iceGone ? -1 : iceContainmentDepth(f.mesh.position.x, f.mesh.position.y, f.mesh.position.z, meltState);
        grabNeedsLift = !iceGone && (curDepth > -rCol || f.mesh.position.z < 0.30);
        grabLiftProgress = grabNeedsLift ? 0 : 1;

        // Soft tactile peel-off flex impulse!
        const curlDir = f.baseBend.x >= 0 ? 1 : -1;
        f.bendVel += f.kind === 'strawberry' ? curlDir * 2.4 : 1.4;
        if (f.thawUniform) f.thawUniform.value = 1.0;
      }
    }
  }

  function endGrab() {
    if (grabbedIdx < 0 || grabbedIdx >= fruits.length) return;
    const f = fruits[grabbedIdx];
    f.grabbed = false;

    if (f.detached) {
      // Release with smoothed pointer toss velocity (clamped to crisp natural throw speed!)
      const maxThrow = 6.2;
      if (grabThrowVel.lengthSq() > maxThrow * maxThrow) {
        grabThrowVel.setLength(maxThrow);
      }
      f.velocity.copy(grabThrowVel);
      // Slight gentle downward nudge if dropped from rest so release feels immediate & weighty
      if (f.velocity.lengthSq() < 0.08) {
        f.velocity.y = Math.min(f.velocity.y, -0.22);
      }
      // Natural lazy tumble matching throw direction (clamped low so slices never spin frantically!)
      f.angVel.set(
        clamp(f.velocity.y * 0.45, -2.0, 2.0),
        clamp(f.velocity.x * 0.35, -1.8, 1.8),
        clamp(-f.velocity.x * 0.62, -2.4, 2.4),
      );
      f.detachTime = 0;
      const curlDir = f.baseBend.x >= 0 ? 1 : -1;
      f.bendVel += clamp(f.velocity.length() * 0.55, 0.3, 2.4) * (f.kind === 'strawberry' ? curlDir : 0.7);
    }

    grabbedIdx = -1;
    grabThrowVel.set(0, 0, 0);
    grabNeedsLift = false;
    grabLiftProgress = 0;
    grabHoldTime = 0;
  }

  function updateGrab(rawDt: number, meltState: MeltFieldState) {
    if (grabbedIdx < 0 || grabbedIdx >= fruits.length || rawDt <= 0) return;
    const f = fruits[grabbedIdx];
    if (!f.grabbed || !f.mesh.visible) {
      clearGrabState();
      return;
    }

    const dt = Math.min(0.05, rawDt);
    grabHoldTime += dt;

    if (!f.detached) {
      // Elastic sticky-ice give while user holds/tugs before slipping free
      const { slideY } = getMeltBounds(meltState.melt);
      const grip = evaluateFruitGrip(f, meltState, slideY);
      applyPreReleasePose(f, grip, slideY);
      grabAnchorPos.copy(f.mesh.position);

      grabPullDelta.copy(grabTargetPos).sub(grabAnchorPos);
      const pullLen = grabPullDelta.length();
      const maxStretch = 0.036;
      const stretch = Math.min(maxStretch, pullLen * 0.58);
      if (pullLen > 1e-4) {
        f.mesh.position.addScaledVector(grabPullDelta, stretch / pullLen);
      }
      // Subtle tilt & flex toward the user's pull!
      grabBankEuler.set(clamp(-grabPullDelta.y * 2.2, -0.18, 0.18), clamp(grabPullDelta.x * 1.8, -0.16, 0.16), clamp(-grabPullDelta.x * 2.4, -0.22, 0.22));
      grabBankQuat.setFromEuler(grabBankEuler);
      f.mesh.quaternion.multiply(grabBankQuat);
      if (f.bendUniform) {
        const tugFlex = clamp(pullLen * 3.8, 0, 0.16);
        const curlDir = f.baseBend.x >= 0 ? 1 : -1;
        f.bendUniform.value.set(
          f.bendAmt + curlDir * tugFlex,
          f.baseBend.y + clamp(grabPullDelta.y * 2.2, -0.14, 0.14),
          f.baseBend.z + clamp(grabPullDelta.x * 2.6, -0.18, 0.18),
        );
      }
      return;
    }

    // Freed & held in pointer: crisp responsive spring-follow + gentle camera-ward clearance over the popsicle!
    f.detachTime = 0;
    if (grabNeedsLift && grabLiftProgress < 1) {
      grabLiftProgress = Math.min(1, grabLiftProgress + dt * 7.5);
    }
    const liftAmt = grabNeedsLift ? smoothstep(0, 1, grabLiftProgress) * 0.24 : 0;
    // grabPlaneNormal points away from camera, so -grabPlaneNormal lifts cleanly toward camera!
    grabClearLift.copy(grabTargetPos).addScaledVector(grabPlaneNormal, -liftAmt);

    grabPrevPos.copy(f.mesh.position);
    const followAlpha = 1.0 - Math.exp(-dt * 28.0);
    f.mesh.position.lerp(grabClearLift, followAlpha);

    // Track smoothed instantaneous velocity for realistic toss + soft slice swoosh flex!
    const instVx = (f.mesh.position.x - grabPrevPos.x) / dt;
    const instVy = (f.mesh.position.y - grabPrevPos.y) / dt;
    const instVz = (f.mesh.position.z - grabPrevPos.z) / dt;
    const velAlpha = 1.0 - Math.exp(-dt * 18.0);
    grabThrowVel.x += (instVx - grabThrowVel.x) * velAlpha;
    grabThrowVel.y += (instVy - grabThrowVel.y) * velAlpha;
    grabThrowVel.z += (instVz - grabThrowVel.z) * velAlpha;

    // Velocity-reactive tactile banking (feels light, wet, and alive in your hand!)
    const bankZ = clamp(-grabThrowVel.x * 0.14, -0.42, 0.42);
    const bankX = clamp(grabThrowVel.y * 0.12, -0.34, 0.34);
    const bankY = clamp(grabThrowVel.x * 0.09, -0.28, 0.28);
    grabBankEuler.set(bankX, bankY, bankZ);
    grabBankQuat.setFromEuler(grabBankEuler);
    f.mesh.quaternion.copy(grabBaseQuat).premultiply(grabBankQuat);

    // Soft springy berry flex driven by drag swoosh & gentle idle float
    const curlDir = f.baseBend.x >= 0 ? 1 : -1;
    const swoosh = clamp(Math.hypot(grabThrowVel.x, grabThrowVel.y) * 0.085, 0, 0.24);
    const restBend =
      f.kind === 'strawberry'
        ? f.baseBend.x + curlDir * (0.14 + swoosh) + 0.03 * Math.sin(grabHoldTime * 5.2 + f.bendPhase)
        : clamp(swoosh * 0.45, 0, 0.12);
    const springF = (restBend - f.bendAmt) * 32.0 - f.bendVel * 5.8;
    f.bendVel += springF * dt;
    f.bendAmt = clamp(f.bendAmt + f.bendVel * dt, -0.54, 0.56);

    if (f.bendUniform) {
      const dragSkew = clamp(-grabThrowVel.x * 0.09, -0.24, 0.24);
      const dragCurl = clamp(grabThrowVel.y * 0.08, -0.20, 0.20);
      f.bendUniform.value.set(f.bendAmt, f.baseBend.y + dragCurl, f.baseBend.z + dragSkew);
    } else {
      const sq = clamp(f.bendAmt * 0.24, -0.06, 0.06);
      f.mesh.scale.set(
        f.baseScale.x * (1 + sq * 0.5),
        f.baseScale.y * (1 - sq),
        f.baseScale.z * (1 + sq * 0.5),
      );
    }
  }

  function getGrabState(): FruitGrabState {
    return {
      hoveredIndex: hoveredIdx,
      grabbedIndex: grabbedIdx,
      grabbedFreed: grabbedIdx >= 0 && fruits[grabbedIdx].detached,
    };
  }

  function hasFallingFruitInView(): boolean {
    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      if (f.detached && f.mesh.visible && (f.grabbed || (f.mesh.position.y > -1.78 && f.detachTime < 1.8))) {
        return true;
      }
    }
    return false;
  }

  function setRecipeColors(nextRecipe: PopsicleRecipe) {
    const p = resolveOpticalPalette(nextRecipe);
    stickUniforms.uStainColor.value.set(p.stainColor[0], p.stainColor[1], p.stainColor[2]);
  }

  function dispose() {
    clearGrabState();
    for (const d of disposables) d.dispose();
  }

  return {
    group,
    stickMesh,
    stickUniforms,
    fruits,
    setRecipeColors,
    hasFallingFruitInView,
    pickGrabbableFruit,
    setHoveredFruit,
    beginGrab,
    moveGrab,
    endGrab,
    updateGrab,
    getGrabState,
    reset,
    update,
    dispose,
  };
}
