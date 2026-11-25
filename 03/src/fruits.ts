import * as THREE from 'three';
import { clamp, fbm3, mulberry32, smoothstep } from './rng';
import { getMeltBounds, iceContainmentDepth, MeltFieldState, POPSICLE } from './shape';
import {
  DEFAULT_RECIPE,
  PopsicleRecipe,
  resolveOpticalPalette,
  ToppingId,
} from './recipe';
import {
  createBlueberryTextures,
  createChocolateChunkTextures,
  createKaksmulorTextures,
  createLemonZestTextures,
  createRaspberryTextures,
  createStrawberryTextures,
  createWoodTextures,
  strawberryBoundaryRadius,
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
  /** True once this falling fruit has performed its single soft glancing deflection off the popsicle body */
  glancedBody: boolean;
  /** True while the user is actively grabbing / holding this fruit with their pointer */
  grabbed: boolean;
  /** Fraction exposed outside melting ice [0..1] */
  exposure: number;
  /** Extra melt margin before unsticking (keeps fruits embedded until well exposed) */
  holdStrength: number;
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
  const bevel = POPSICLE.stickDepth * 0.19;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.7,
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
function createStrawberryMaterial(textures: ReturnType<typeof createStrawberryTextures>): {
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
function createBlueberryMaterial(textures: ReturnType<typeof createBlueberryTextures>): {
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
          float spA = pow(max(dot(nDir, normalize(lA + vDir)), 0.0), 175.0);
          float spB = pow(max(dot(nDir, normalize(lB + vDir)), 0.0), 130.0);
          reflectedLight.directSpecular += vec3(1.55, 1.58, 1.68) * (spA * 1.15 + spB * 0.60) * (0.28 + 0.72 * thaw);
        }`,
      );
  };

  return { material, uThaw };
}

/**
 * Generates a true sculpted 3D aggregate drupelet raspberry (conical cluster of ~34 plump ruby drupelets
 * around a subtle recessed hollow crown, baked with crevice ambient occlusion in vertex colors!).
 */
function createRaspberryGeometry(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed * 73 + 19);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const segU = 10;
  const segV = 7;
  let vertBase = 0;

  function addDrupelet(cx: number, cy: number, cz: number, r: number, ao: number) {
    for (let iv = 0; iv <= segV; iv++) {
      const phi = (iv / segV) * Math.PI;
      const sp = Math.sin(phi);
      const cp = Math.cos(phi);
      for (let iu = 0; iu <= segU; iu++) {
        const th = (iu / segU) * Math.PI * 2;
        const nx = sp * Math.cos(th);
        const ny = cp;
        const nz = sp * Math.sin(th);
        const px = cx + nx * r;
        const py = cy + ny * r * 0.96;
        const pz = cz + nz * r;

        positions.push(px, py, pz);
        normals.push(nx, ny, nz);
        uvs.push(iu / segU, iv / segV);

        // Crevice darkening where drupelets nestle against the berry core!
        const outDot = clamp((px * nx + py * ny + pz * nz) / Math.max(0.15, Math.hypot(px, py, pz)), 0, 1);
        const shade = clamp(ao * (0.42 + 0.68 * outDot), 0.25, 1.05);
        colors.push(shade, shade * 0.92, shade * 0.95);
      }
    }
    const stride = segU + 1;
    for (let iv = 0; iv < segV; iv++) {
      for (let iu = 0; iu < segU; iu++) {
        const a = vertBase + iv * stride + iu;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }
    vertBase += (segV + 1) * stride;
  }

  // Dark recessed core cap so the hollow stem cavity reads deep ruby-maroon
  addDrupelet(0, -0.04, 0, 0.56, 0.34);

  // 4 staggered organic drupelet rings forming the classic conical raspberry silhouette
  const rings: Array<{ y: number; ringR: number; count: number; drupR: number; phase: number }> = [
    { y: 0.56, ringR: 0.44, count: 8, drupR: 0.27, phase: rand() * 6.28 },
    { y: 0.16, ringR: 0.62, count: 10, drupR: 0.30, phase: rand() * 6.28 },
    { y: -0.28, ringR: 0.56, count: 9, drupR: 0.29, phase: rand() * 6.28 },
    { y: -0.66, ringR: 0.34, count: 6, drupR: 0.27, phase: rand() * 6.28 },
  ];

  for (const ring of rings) {
    for (let k = 0; k < ring.count; k++) {
      const ang = ring.phase + (k / ring.count) * Math.PI * 2 + (rand() - 0.5) * 0.16;
      const rr = ring.ringR * (0.93 + rand() * 0.14);
      const yy = ring.y + (rand() - 0.5) * 0.08;
      const dr = ring.drupR * (0.92 + rand() * 0.16);
      addDrupelet(Math.cos(ang) * rr, yy, Math.sin(ang) * rr, dr, 0.96);
    }
  }
  // Rounded apex tip drupelet
  addDrupelet((rand() - 0.5) * 0.06, -0.84, (rand() - 0.5) * 0.06, 0.27, 1.0);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
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
  const geo = new THREE.IcosahedronGeometry(1.0, isChunk ? 3 : 2);
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
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.0,
    vertexColors: true,
    envMapIntensity: 0.28,
  });
  material.customProgramCacheKey = () => 'raspberry-wetthaw-v2';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uThaw = uThaw;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vRaspWorldPos;
        varying vec3 vRaspWorldNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vRaspWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRaspWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uThaw;
        varying vec3 vRaspWorldPos;
        varying vec3 vRaspWorldNormal;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Rich saturated wet ruby-crimson drupelets when uncovered (no chalky haze!)
          vec3 deepRuby = pow(max(diffuseColor.rgb, vec3(0.0001)), vec3(1.16)) * vec3(1.06, 0.72, 0.80);
          diffuseColor.rgb = mix(diffuseColor.rgb, deepRuby, 0.55 + clamp(uThaw, 0.0, 1.0) * 0.40);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.26), clamp(uThaw, 0.0, 1.0) * 0.72);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 vDir = normalize(cameraPosition - vRaspWorldPos);
          vec3 nDir = normalize(vRaspWorldNormal);
          float ndv = clamp(abs(dot(nDir, vDir)), 0.0, 1.0);
          float thaw = clamp(uThaw, 0.0, 1.0);

          // Suppress grazing HDR lightbox rings around individual drupelets so raspberries stay juicy ruby-red!
          float rimMask = smoothstep(0.08, 0.62, ndv);
          reflectedLight.indirectSpecular *= mix(0.04, 0.48, rimMask);
          reflectedLight.directSpecular *= mix(0.12, 0.90, rimMask);
          reflectedLight.indirectDiffuse *= mix(0.72, 1.0, smoothstep(0.05, 0.45, ndv));

          // Warm backlit translucent crimson subsurface glow + delicate wet drupelet pinpoint glints
          reflectedLight.directDiffuse += diffuseColor.rgb * vec3(0.62, 0.06, 0.16) * (0.45 + 0.35 * rimMask);
          vec3 lA = normalize(vec3(-0.50, 0.54, 0.68));
          vec3 lB = normalize(vec3(0.56, 0.38, 0.73));
          float spA = pow(max(dot(nDir, normalize(lA + vDir)), 0.0), 150.0);
          float spB = pow(max(dot(nDir, normalize(lB + vDir)), 0.0), 115.0);
          reflectedLight.directSpecular += vec3(1.45, 1.24, 1.28) * (spA * 0.85 + spB * 0.42) * (0.28 + 0.72 * thaw);
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
      let maxW = POPSICLE.halfWidthBottom + (POPSICLE.halfWidthTop - POPSICLE.halfWidthBottom) * hNorm;
      if (hNorm > 0.735) {
        const t = clamp((hNorm - 0.735) / 0.265, 0, 1);
        maxW *= Math.sqrt(Math.max(0.01, 1 - t * t));
      }
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
        specs.push({
          kind,
          x,
          y,
          z,
          scale: [radius * 0.98, radius * 1.12, radius * 0.98],
          rot: [(rand() - 0.5) * 2.2, (rand() - 0.5) * 2.8, (rand() - 0.5) * 2.4],
          radius,
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
          tryPlace(kind, r, yMin, yMax, n % 2 === 0 ? 0.045 : -0.015);
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

  // Lazy-create shared procedural textures ONLY for active toppings (keeps build instant & VRAM lean!)
  const activeSet = new Set(recipe.toppings);
  const strawTexA = activeSet.has('strawberry') ? createStrawberryTextures(seed * 31 + 103) : null;
  const strawTexB = activeSet.has('strawberry') ? createStrawberryTextures(seed * 37 + 211) : null;
  const blueTexA = activeSet.has('blueberry') ? createBlueberryTextures(seed * 41 + 307) : null;
  const blueTexB = activeSet.has('blueberry') ? createBlueberryTextures(seed * 43 + 419) : null;
  const raspTex = activeSet.has('raspberry') ? createRaspberryTextures(seed * 47 + 521) : null;
  const chocTex = activeSet.has('chocolate') ? createChocolateChunkTextures(seed * 53 + 613) : null;
  const lemonTex = activeSet.has('shaved-lemon') ? createLemonZestTextures(seed * 59 + 709) : null;
  const kakaDarkTex = activeSet.has('kaksmulor') ? createKaksmulorTextures(seed * 61 + 811, 'dark') : null;
  const kakaButterTex = activeSet.has('kaksmulor') ? createKaksmulorTextures(seed * 67 + 907, 'butter') : null;

  for (const t of [strawTexA, strawTexB]) {
    if (t) disposables.push(t.albedo, t.bump, t.translucency);
  }
  for (const t of [blueTexA, blueTexB, raspTex, chocTex, lemonTex, kakaDarkTex, kakaButterTex]) {
    if (t) disposables.push(t.albedo, t.bump, t.roughness);
  }

  // Birch wood popsicle stick with capillary damp wicking & dynamic flavor-colored stain!
  const woodTex = createWoodTextures(seed * 19 + 503);
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
        varying vec3 vStickWorldNormal;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Continuous seamless berry-stain along the entire stick (ZERO blonde seam at yBot or yTop!)
          float effRefY = mix(${POPSICLE.yBottom.toFixed(3)}, uIceBottomY, uIceAmount);
          float distBelow = effRefY - vStickWorldPos.y;
          float collarShadow = exp(-max(0.0, distBelow) * 16.0) * smoothstep(-0.08, 0.02, distBelow) * uIceAmount;
          float insideIce = smoothstep(0.04, -0.10, distBelow) * smoothstep(uIceTopY + 0.04, uIceTopY - 0.04, vStickWorldPos.y) * uIceAmount;

          // Upper stick (y > -1.02) has been soaking inside frozen berry ice the whole time -> seamless deep berry stain!
          float wasSubmerged = smoothstep(-1.14, -0.96, vStickWorldPos.y);
          float upperSoak = wasSubmerged * smoothstep(0.08, 0.36, uStickWetness);
          float revealedUpper = wasSubmerged * max(1.0 - uIceAmount, smoothstep(uIceTopY - 0.04, uIceTopY + 0.03, vStickWorldPos.y));

          // Porous birch fibers progressively capillary-wick melted berry juice down the ENTIRE lower handle!
          float grainWick =
            0.50 + 0.30 * sin(vStickWorldPos.x * 58.0 + 1.1) +
            0.20 * sin(vStickWorldPos.x * 134.0 - 0.6);
          float progress = smoothstep(0.04, 0.78, uStickWetness);
          float edgeIrreg = (clamp(grainWick, 0.0, 1.0) - 0.5) * 0.20 * (1.0 - smoothstep(0.55, 0.88, uStickWetness));
          float wickReach = progress * 1.55 + edgeIrreg;
          // Overlap generously upward past effRefY so lowerSoak + upperSoak weld at 1.000 with ZERO band!
          float lowerSoak = smoothstep(wickReach + 0.14, wickReach - 0.18, max(0.0, distBelow)) *
                            smoothstep(-0.30, -0.10, distBelow) *
                            smoothstep(0.02, 0.18, uStickWetness);
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
          float frontFace = smoothstep(0.45, 0.78, vStickWorldNormal.z);
          vec2 carveUv = vec2((vStickWorldPos.y + 0.99) / 0.53, (-vStickWorldPos.x + 0.088) / 0.176);
          if (frontFace > 0.01 && carveUv.x > 0.005 && carveUv.x < 0.995 && carveUv.y > 0.005 && carveUv.y < 0.995) {
            vec2 cTex = texture2D(uCarveMap, carveUv).rg;
            float depth = cTex.r * frontFace;
            float halo = cTex.g * frontFace;
            if (halo > 0.01 || depth > 0.01) {
              vec2 cStep = vec2(1.0 / 1024.0, 1.0 / 340.0) * 2.0;
              float cUp = texture2D(uCarveMap, carveUv + vec2(cStep.x, 0.0)).r;
              float cDn = texture2D(uCarveMap, carveUv - vec2(cStep.x, 0.0)).r;
              float cLt = texture2D(uCarveMap, carveUv + vec2(0.0, cStep.y)).r;
              float cRt = texture2D(uCarveMap, carveUv - vec2(0.0, cStep.y)).r;
              // Screen-space light comes from upper-left (-X, +Y): upper-left groove wall sits in shadow, lower-right catches warm rim!
              float bevelShade = ((cDn - cUp) * 0.72 + (cLt - cRt) * 0.68) * frontFace;

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
          float effRefY = mix(${POPSICLE.yBottom.toFixed(3)}, uIceBottomY, uIceAmount);
          float distBelow = effRefY - vStickWorldPos.y;
          float wasSubmerged = smoothstep(-1.14, -0.96, vStickWorldPos.y);
          float revealedUpper = wasSubmerged * max(1.0 - uIceAmount, smoothstep(uIceTopY - 0.04, uIceTopY + 0.03, vStickWorldPos.y));

          float grainWick =
            0.50 + 0.30 * sin(vStickWorldPos.x * 58.0 + 1.1) +
            0.20 * sin(vStickWorldPos.x * 134.0 - 0.6);
          float progress = smoothstep(0.04, 0.78, uStickWetness);
          float edgeIrreg = (clamp(grainWick, 0.0, 1.0) - 0.5) * 0.20 * (1.0 - smoothstep(0.55, 0.88, uStickWetness));
          float wickReach = progress * 1.55 + edgeIrreg;
          float lowerDamp = smoothstep(wickReach + 0.12, wickReach - 0.16, max(0.0, distBelow)) *
                            smoothstep(-0.30, -0.10, distBelow) *
                            smoothstep(0.03, 0.20, uStickWetness);
          float dampMask = clamp(max(lowerDamp, revealedUpper), 0.0, 1.0);
          if (dampMask > 0.01) {
            vec3 sV = normalize(cameraPosition - vStickWorldPos);
            vec3 sN = normalize(vStickWorldNormal);
            // Tilt specular normal subtly across the carved letter bevel walls so studio light glints on the indentation!
            float frontFace = smoothstep(0.45, 0.78, sN.z);
            vec2 carveUv = vec2((vStickWorldPos.y + 0.99) / 0.53, (-vStickWorldPos.x + 0.088) / 0.176);
            float groovePool = 0.0;
            if (frontFace > 0.01 && carveUv.x > 0.005 && carveUv.x < 0.995 && carveUv.y > 0.005 && carveUv.y < 0.995) {
              float cC = texture2D(uCarveMap, carveUv).r;
              if (cC > 0.01) {
                vec2 cStep = vec2(1.0 / 1024.0, 1.0 / 340.0) * 2.0;
                float gx = (texture2D(uCarveMap, carveUv + vec2(0.0, cStep.y)).r - texture2D(uCarveMap, carveUv - vec2(0.0, cStep.y)).r);
                float gy = (texture2D(uCarveMap, carveUv + vec2(cStep.x, 0.0)).r - texture2D(uCarveMap, carveUv - vec2(cStep.x, 0.0)).r);
                sN = normalize(sN + vec3(gx * 0.42, -gy * 0.42, 0.0) * frontFace);
                groovePool = cC * frontFace;
              }
            }
            float ndv = clamp(dot(sN, sV), 0.0, 1.0);
            // Natural damp-wood sticky satin sheen (preserves crisp birch wood grain without plastic glare!)
            float stickyFresnel = pow(1.0 - ndv, 4.2) * (0.08 + 0.10 * revealedUpper);
            vec3 sH1 = normalize(normalize(vec3(-0.52, 0.38, 0.76)) + sV);
            vec3 sH2 = normalize(normalize(vec3(0.55, 0.32, 0.77)) + sV);
            float wetSpec = pow(max(dot(sN, sH1), 0.0), 72.0) * (0.30 + 0.14 * revealedUpper)
                          + pow(max(dot(sN, sH2), 0.0), 58.0) * (0.22 + 0.10 * revealedUpper);
            // Recessed groove holds slightly darker shadowed cavity while its chamfered rim catches gloss
            reflectedLight.directSpecular += vec3(1.08, 0.94, 0.93) * (wetSpec + stickyFresnel) * dampMask * (1.0 - groovePool * 0.32);
          }
        }`,
      );
  };

  const stickGeo = createWoodStickGeometry();
  const stickMesh = new THREE.Mesh(stickGeo, stickMat);
  stickMesh.name = 'popsicle-stick';
  group.add(stickMesh);
  disposables.push(stickGeo, stickMat, woodTex.albedo, woodTex.bump, woodTex.carving);

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
    let mat: THREE.Material;
    let bendUniform: { value: THREE.Vector3 } | undefined;
    let thawUniform: { value: number } | undefined;

    if (spec.kind === 'strawberry' && strawTexA && strawTexB) {
      geo = createStrawberrySliceGeometry(seed * 131 + idx * 17 + 5, 0.16 + rand() * 0.04);
      const straw = createStrawberryMaterial(idx % 2 === 0 ? strawTexA : strawTexB);
      mat = straw.material;
      bendUniform = straw.uBend;
      disposables.push(mat);
    } else if (spec.kind === 'blueberry' && blueTexA && blueTexB) {
      geo = createBlueberryGeometry(seed * 149 + idx * 23 + 11);
      const blue = createBlueberryMaterial(idx % 2 === 0 ? blueTexA : blueTexB);
      mat = blue.material;
      thawUniform = blue.uThaw;
      disposables.push(mat);
    } else if (spec.kind === 'raspberry' && raspTex) {
      geo = createRaspberryGeometry(seed * 157 + idx * 29 + 13);
      const rasp = createRaspberryMaterial(raspTex);
      mat = rasp.material;
      thawUniform = rasp.uThaw;
      disposables.push(mat);
    } else if (spec.kind === 'chocolate' && sharedChocMat) {
      geo = createChocolateChunkGeometry(seed * 163 + idx * 31 + 17);
      mat = sharedChocMat;
    } else if (spec.kind === 'shaved-lemon' && sharedLemonMat) {
      geo = createLemonZestGeometry(seed * 173 + idx * 37 + 19);
      mat = sharedLemonMat;
    } else {
      const isChunk = (spec.variant ?? 0) < 2;
      const isButter = (spec.variant ?? 0) % 2 === 1;
      geo = createKaksmulorGeometry(seed * 179 + idx * 41 + 23, isChunk);
      mat = (isButter ? sharedKakaButterMat : sharedKakaDarkMat) || sharedKakaDarkMat!;
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
      glancedBody: false,
      grabbed: false,
      exposure: 0,
      holdStrength: 0.22 + rand() * 0.14,
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
  const grabSmoothAccel = new THREE.Vector3();
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
    grabSmoothAccel.set(0, 0, 0);
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
      f.glancedBody = false;
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
    // Tilted strawberry slices have thinner effective cross-section than whole spherical blueberries
    return f.kind === 'strawberry' ? f.radius * 0.44 : f.radius * 0.80;
  }

  function applyPreReleasePose(f: FruitItem, depth: number, releaseMargin: number) {
    f.exposure = clamp(1.0 - smoothstep(releaseMargin, f.radius * 0.62, depth), 0, 1);
    const sag = smoothstep(GRAB_EXPOSURE_MIN, 1.0, f.exposure);
    const sideSign = Math.abs(f.basePos.x) > 0.03 ? Math.sign(f.basePos.x) : 1;

    // Graceful melt-shift: fruit gently loosens downward, slips slightly outward, tilts, and softens!
    f.mesh.position.set(f.basePos.x + sideSign * sag * 0.018, f.basePos.y - sag * 0.042, f.basePos.z);
    sagEuler.set(sag * 0.14, 0, -sideSign * sag * 0.22);
    sagQuat.setFromEuler(sagEuler);
    f.mesh.quaternion.copy(f.baseQuat).multiply(sagQuat);
    f.mesh.scale.copy(f.baseScale);

    // Inherent organic slice curl + extra soft-thaw droop on exposed strawberry slices before peeling free
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
      // As soon as any part of a blueberry breaches the melting ice (exposure > 0.04), wet-thaw it cleanly!
      f.thawUniform.value = smoothstep(0.02, 0.38, f.exposure);
    }
  }

  function update(meltState: MeltFieldState, dt: number, stickWetness?: number) {
    const { yTop: yTopLive, yBot: yBotLive, iceAmount, iceGone } = getMeltBounds(meltState.melt);
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

    // Pass 1: Update still-attached fruits (stunning melt-shift & thaw softening) and trigger clean release!
    const endgameReleaseBoost = smoothstep(0.72, 0.90, meltState.melt) * 0.07;
    if (dt === 0 && grabbedIdx >= 0) {
      clearGrabState();
    }
    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      const depth = iceContainmentDepth(f.basePos.x, f.basePos.y, f.basePos.z, meltState);
      const releaseMargin = (f.kind === 'strawberry' ? f.radius * 0.11 : f.radius * 0.09) + endgameReleaseBoost;

      if (dt === 0) {
        if (iceGone || (meltState.melt > 0.14 && depth < releaseMargin)) {
          f.detached = true;
          f.mesh.visible = false;
        } else {
          f.detached = false;
          f.detachTime = 0;
          f.glancedBody = false;
          f.grabbed = false;
          f.mesh.visible = true;
          applyPreReleasePose(f, depth, releaseMargin);
          f.velocity.set(0, 0, 0);
        }
        continue;
      }

      if (!f.detached) {
        if (f.grabbed) {
          // While user is gently tugging an almost-released fruit, update exposure & auto-pop if ice melts past release
          f.exposure = clamp(1.0 - smoothstep(releaseMargin, f.radius * 0.62, depth), 0, 1);
          if (f.thawUniform) f.thawUniform.value = Math.max(f.thawUniform.value, smoothstep(0.02, 0.38, f.exposure));
          if (iceGone || (meltState.melt > 0.14 && depth < releaseMargin)) {
            f.detached = true;
            f.detachTime = 0;
            f.glancedBody = false;
            grabBaseQuat.copy(f.mesh.quaternion);
            grabNeedsLift = true;
            grabLiftProgress = 0;
            if (f.thawUniform) f.thawUniform.value = 1.0;
          }
          continue;
        }

        applyPreReleasePose(f, depth, releaseMargin);

        // Subtle organic "ready to pluck" micro-wiggle when pointer hovers a loosened fruit
        if (i === hoveredIdx && f.exposure >= GRAB_EXPOSURE_MIN) {
          hoverTime += dt;
          const wig = Math.sin(hoverTime * 9.5) * 0.0055 * smoothstep(GRAB_EXPOSURE_MIN, 0.85, f.exposure);
          f.mesh.position.y -= Math.abs(wig) * 0.55;
          sagEuler.set(wig * 3.0, 0, wig * 6.5);
          sagQuat.setFromEuler(sagEuler);
          f.mesh.quaternion.multiply(sagQuat);
        }

        // Once melted down enough to loosen, release cleanly & decisively outward away from the popsicle!
        if (iceGone || (meltState.melt > 0.14 && depth < releaseMargin)) {
          f.detached = true;
          f.detachTime = 0;
          f.glancedBody = false;

          // Outward horizontal direction away from the popsicle spine (guarantees it arcs clear instead of wedging!)
          const sideX = Math.abs(f.basePos.x) > 0.04 ? Math.sign(f.basePos.x) : i % 2 === 0 ? 1 : -1;
          const isBackHalf = f.basePos.z <= 0.004;
          const pushZ = isBackHalf ? -1 : 1;

          // Gently clear the live surface on the correct front/back side so it never starts stuck inside ice
          if (!iceGone) {
            const rCol = fruitCollisionRadius(f);
            const curDepth = iceContainmentDepth(f.mesh.position.x, f.mesh.position.y, f.mesh.position.z, meltState);
            if (curDepth > -rCol * 0.35) {
              const clearPush = Math.min(0.14, curDepth + rCol * 0.45);
              f.mesh.position.x += sideX * clearPush * 0.65;
              f.mesh.position.z += pushZ * clearPush * 0.85;
            }
          }

          // Light, effortless outward peel arc (strawberries slightly floatier/wider, blueberries slightly brisker)
          const horizKick = (f.kind === 'strawberry' ? 0.46 : 0.38) + (i % 3) * 0.07;
          const zKick = isBackHalf ? -(0.38 + (i % 2) * 0.08) : 0.26 + (i % 2) * 0.06;
          f.velocity.set(sideX * horizKick, -0.34, zKick);

          // Gentle lazy tumble (never frantic coin-spinning!)
          f.angVel.set(pushZ * 0.75, (i % 2 === 0 ? 1 : -1) * 0.55, -sideX * 1.15);

          // Soft peel-off flex impulse matching each slice's natural curl direction
          const curlDir = f.baseBend.x >= 0 ? 1 : -1;
          f.bendVel = f.kind === 'strawberry' ? curlDir * 1.85 : 1.1;
          if (f.thawUniform) f.thawUniform.value = 1.0;
        }
      }
    }

    if (dt <= 0) return;

    // Pass 2: Quick, graceful falloff with at most ONE faked soft brush off the main body + soft berry flex!
    const substeps = 2;
    const subDt = dt / substeps;

    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      if (!f.detached || !f.mesh.visible || f.grabbed) continue;

      f.detachTime += dt;
      const rCol = fruitCollisionRadius(f);
      const sideX = Math.abs(f.basePos.x) > 0.04 ? Math.sign(f.basePos.x) : i % 2 === 0 ? 1 : -1;
      const isBackHalf = f.basePos.z <= 0.004;

      for (let s = 0; s < substeps; s++) {
        // Lightweight crisp gravity + subtle air drag on lateral drift
        const grav = f.kind === 'strawberry' ? 5.6 : 6.4;
        f.velocity.y -= grav * subDt;
        const airDrag = Math.exp(-subDt * (f.kind === 'strawberry' ? 0.55 : 0.25));
        f.velocity.x *= airDrag;
        f.velocity.z *= airDrag;
        f.mesh.position.addScaledVector(f.velocity, subDt);

        // Smooth, gently damped tumble (bounded low so slices NEVER spin wildly on themselves!)
        f.angVel.multiplyScalar(Math.exp(-subDt * 0.9));
        const maxSpin = f.kind === 'strawberry' ? 2.5 : 3.2;
        if (f.angVel.lengthSq() > maxSpin * maxSpin) {
          f.angVel.setLength(maxSpin);
        }
        const wMag = f.angVel.length();
        if (wMag > 1e-4) {
          spinAxis.copy(f.angVel).divideScalar(wMag);
          spinQuat.setFromAxisAngle(spinAxis, wMag * subDt);
          f.mesh.quaternion.premultiply(spinQuat);
        }

        // At most ONE faked soft glancing brush with the main popsicle body / protruding berry ->
        // kicks cleanly FURTHER AWAY horizontally while NEVER slowing or trapping downward fall!
        if (!f.glancedBody && !iceGone && f.detachTime < 0.65) {
          const px = f.mesh.position.x;
          const py = f.mesh.position.y;
          const pz = f.mesh.position.z;
          let grazed = false;

          const dIce = iceContainmentDepth(px, py, pz, meltState);
          if (dIce > -rCol * 0.55 && py > yBotLive - 0.08) {
            grazed = true;
            const pen = dIce + rCol * 0.60;
            f.mesh.position.x += sideX * Math.max(0, pen * 0.75);
            f.mesh.position.z += (isBackHalf ? -1 : 1) * Math.max(0, pen * 0.55);
          }

          if (!grazed) {
            const grazeR = f.kind === 'strawberry' ? f.radius * 0.68 : rCol;
            for (let j = 0; j < fruits.length; j++) {
              if (j === i) continue;
              const other = fruits[j];
              if (other.detached || !other.mesh.visible || other.exposure < 0.12) continue;
              const dx = px - other.mesh.position.x;
              const dy = py - other.mesh.position.y;
              const dz = pz - other.mesh.position.z;
              const otherR = other.kind === 'strawberry' ? other.radius * 0.62 : other.radius * 0.86;
              const minDist = (grazeR + otherR) * 0.96;
              const distSq = dx * dx + dy * dy + dz * dz;
              if (distSq < minDist * minDist) {
                grazed = true;
                const pen = minDist - Math.sqrt(Math.max(1e-6, distSq));
                f.mesh.position.x += sideX * Math.min(0.06, pen * 0.48);
                break;
              }
            }
          }

          if (grazed) {
            f.glancedBody = true;
            // Faked soft glancing kick: arcs smoothly further away from the body & keeps falling briskly!
            f.velocity.x = sideX * Math.max(Math.abs(f.velocity.x) + 0.44, 0.74);
            f.velocity.z += isBackHalf ? -0.26 : 0.22;
            f.velocity.y = Math.min(f.velocity.y, -0.78);
            // Gentle visual deflection spin + soft flex bend on brush
            f.angVel.z -= sideX * 0.85;
            f.angVel.x += (isBackHalf ? -0.5 : 0.5);
            f.bendVel += f.kind === 'strawberry' ? (f.baseBend.x >= 0 ? 2.6 : -2.6) : 1.5;
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
    grabSmoothAccel.set(0, 0, 0);

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
        f.glancedBody = false;
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
      // Allow a single cheeky soft bounce if the user tosses the fruit back into the popsicle!
      f.glancedBody = false;
      const curlDir = f.baseBend.x >= 0 ? 1 : -1;
      f.bendVel += clamp(f.velocity.length() * 0.55, 0.3, 2.4) * (f.kind === 'strawberry' ? curlDir : 0.7);
    }

    grabbedIdx = -1;
    grabThrowVel.set(0, 0, 0);
    grabSmoothAccel.set(0, 0, 0);
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
      // Elastic sticky-ice give while user holds/tugs before popping free
      const depth = iceContainmentDepth(f.basePos.x, f.basePos.y, f.basePos.z, meltState);
      const endgameReleaseBoost = smoothstep(0.72, 0.90, meltState.melt) * 0.07;
      const releaseMargin = (f.kind === 'strawberry' ? f.radius * 0.11 : f.radius * 0.09) + endgameReleaseBoost;
      applyPreReleasePose(f, depth, releaseMargin);
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

    // Track smoothed instantaneous velocity & acceleration for realistic toss + soft slice swoosh flex!
    const instVx = (f.mesh.position.x - grabPrevPos.x) / dt;
    const instVy = (f.mesh.position.y - grabPrevPos.y) / dt;
    const instVz = (f.mesh.position.z - grabPrevPos.z) / dt;
    const prevVx = grabThrowVel.x;
    const prevVy = grabThrowVel.y;
    const velAlpha = 1.0 - Math.exp(-dt * 18.0);
    grabThrowVel.x += (instVx - grabThrowVel.x) * velAlpha;
    grabThrowVel.y += (instVy - grabThrowVel.y) * velAlpha;
    grabThrowVel.z += (instVz - grabThrowVel.z) * velAlpha;

    const accAlpha = 1.0 - Math.exp(-dt * 12.0);
    grabSmoothAccel.x += ((grabThrowVel.x - prevVx) / dt - grabSmoothAccel.x) * accAlpha;
    grabSmoothAccel.y += ((grabThrowVel.y - prevVy) / dt - grabSmoothAccel.y) * accAlpha;

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
