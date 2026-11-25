import * as THREE from 'three';
import { clamp, fbm3, mulberry32, smoothstep } from './rng';
import { getMeltBounds, iceContainmentDepth, MeltFieldState, POPSICLE } from './shape';
import {
  createBlueberryTextures,
  createStrawberryTextures,
  createWoodTextures,
  strawberryBoundaryRadius,
} from './textures';

export interface FruitItem {
  kind: 'strawberry' | 'blueberry';
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
  /** Fraction exposed outside melting ice [0..1] */
  exposure: number;
  /** Extra melt margin before unsticking (keeps fruits embedded until well exposed) */
  holdStrength: number;
  /** Soft-thaw spring bend state (droop + gentle flutter / soft impact flex) */
  bendAmt: number;
  bendVel: number;
  bendPhase: number;
  bendUniform?: { value: THREE.Vector3 };
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
  };
  fruits: FruitItem[];
  /** True while any detached fruit is still actively falling through the visible frame */
  hasFallingFruitInView(): boolean;
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
          float bendMag = abs(uBend.x) + abs(uBend.y) * 0.6 + abs(uBend.z) * 0.6;
          transformed.xy *= 1.0 - clamp(bendMag * 0.14 * bR2, 0.0, 0.12);
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
 * Creates a macro blueberry material with dark glossy indigo skin, patchy waxy bloom,
 * and grazing-angle dusty-blue epicuticular bloom Fresnel.
 */
function createBlueberryMaterial(seed: number): {
  material: THREE.MeshPhysicalMaterial;
  textures: ReturnType<typeof createBlueberryTextures>;
} {
  const textures = createBlueberryTextures(seed);
  const material = new THREE.MeshPhysicalMaterial({
    map: textures.albedo,
    bumpMap: textures.bump,
    bumpScale: 0.022,
    roughnessMap: textures.roughness,
    roughness: 0.52,
    metalness: 0.0,
    clearcoat: 0.62,
    clearcoatRoughness: 0.22,
    envMapIntensity: 0.9,
  });

  material.onBeforeCompile = (shader) => {
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
        varying vec3 vBlueWorldPos;
        varying vec3 vBlueWorldNormal;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 vDir = normalize(cameraPosition - vBlueWorldPos);
          vec3 nDir = normalize(vBlueWorldNormal);
          float ndv = clamp(abs(dot(nDir, vDir)), 0.0, 1.0);
          float bloomRim = pow(1.0 - ndv, 2.2);
          // Dusty pale-lavender-blue epicuticular wax sheen + tiny warm backlit plum scatter
          reflectedLight.indirectDiffuse += vec3(0.24, 0.29, 0.44) * bloomRim * 0.55;
          reflectedLight.directDiffuse += vec3(0.18, 0.04, 0.14) * pow(1.0 - ndv, 3.0) * 0.45;
        }`,
      );
  };

  return { material, textures };
}

interface FruitSpec {
  kind: 'strawberry' | 'blueberry';
  x: number;
  y: number;
  z: number;
  scale: [number, number, number];
  rot: [number, number, number];
  radius: number;
}

/**
 * Generates deterministic fruit placement inside the popsicle.
 * Seed 1 reproduces the balanced studio composition of the backlit berry popsicle;
 * other seeds generate fresh harmonious botanical compositions!
 */
function buildFruitLayout(seed: number): FruitSpec[] {
  const rand = mulberry32(seed * 7919 + 13);

  if (seed === 1) {
    const j = (amt: number) => (rand() - 0.5) * amt;
    return [
      // === STRAWBERRY SLICES (organic 3D pitches & yaws — cleanly encased at t=0!) ===
      // 1. Hero large diagonal slice — upper right (tilted ~24° in 3D so crimson seed edge curves into depth!)
      {
        kind: 'strawberry',
        x: 0.18 + j(0.01),
        y: 0.45 + j(0.01),
        z: 0.010,
        scale: [0.34, 0.40, 0.33],
        rot: [0.36, -0.44, -0.62],
        radius: 0.27,
      },
      // 2. Hero glowing slice — mid left (stronger organic 3D pitch & yaw toward left wall)
      {
        kind: 'strawberry',
        x: -0.225 + j(0.012),
        y: -0.10 + j(0.012),
        z: 0.004,
        scale: [0.32, 0.36, 0.31],
        rot: [-0.42, 0.56, 0.38],
        radius: 0.26,
      },
      // 3. Fiery angled slice — bottom left (boldly tilted in 3D across bottom-left corner)
      {
        kind: 'strawberry',
        x: -0.265 + j(0.012),
        y: -0.73 + j(0.012),
        z: 0.008,
        scale: [0.28, 0.32, 0.27],
        rot: [0.46, 0.50, -0.98],
        radius: 0.22,
      },
      // 4. Warm ruby slice — mid-lower right (tumbled strongly in 3D behind blueberries)
      {
        kind: 'strawberry',
        x: 0.21 + j(0.015),
        y: -0.44 + j(0.015),
        z: -0.022,
        scale: [0.29, 0.33, 0.29],
        rot: [-0.50, -0.58, 0.78],
        radius: 0.24,
      },
      // 5. Ruby berry crown fragment — very top dome
      {
        kind: 'strawberry',
        x: -0.01 + j(0.01),
        y: 0.91 + j(0.01),
        z: -0.008,
        scale: [0.18, 0.14, 0.16],
        rot: [0.58, 0.28, 2.82],
        radius: 0.13,
      },
      // 6. Small ruby accent wedge — upper mid-left
      {
        kind: 'strawberry',
        x: -0.33 + j(0.015),
        y: 0.33 + j(0.015),
        z: -0.015,
        scale: [0.16, 0.19, 0.17],
        rot: [0.46, 0.62, -0.48],
        radius: 0.14,
      },
      // 7. Small warm wedge — bottom right corner
      {
        kind: 'strawberry',
        x: 0.33 + j(0.015),
        y: -0.81 + j(0.015),
        z: -0.010,
        scale: [0.17, 0.19, 0.17],
        rot: [-0.42, -0.54, 1.18],
        radius: 0.14,
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

  // Generative procedural layout for any other seed: balanced rejection sampling
  const specs: FruitSpec[] = [];
  const placed: Array<{ x: number; y: number; z: number; r: number }> = [];

  function tryPlace(kind: 'strawberry' | 'blueberry', radius: number, yMin: number, yMax: number, zBias: number): boolean {
    for (let attempt = 0; attempt < 90; attempt++) {
      const y = yMin + rand() * (yMax - yMin);
      const hNorm = clamp((y - POPSICLE.yBottom) / (POPSICLE.yTop - POPSICLE.yBottom), 0, 1);
      let maxW = POPSICLE.halfWidthBottom + (POPSICLE.halfWidthTop - POPSICLE.halfWidthBottom) * hNorm;
      if (hNorm > 0.735) {
        const t = clamp((hNorm - 0.735) / 0.265, 0, 1);
        maxW *= Math.sqrt(Math.max(0.01, 1 - t * t));
      }
      const xRange = Math.max(0.05, maxW - radius * 1.06);
      const x = (rand() * 2 - 1) * xRange;
      const halfThickZ = kind === 'strawberry' ? radius * 0.48 : radius * 0.96;
      const z = clamp(zBias + (rand() * 2 - 1) * 0.024, -0.045, Math.max(-0.025, POPSICLE.halfDepth - halfThickZ - 0.032));

      let ok = true;
      for (const p of placed) {
        const dx = x - p.x;
        const dy = y - p.y;
        const dz = (z - p.z) * 1.4;
        const minDist = (radius + p.r) * 0.76;
        if (dx * dx + dy * dy + dz * dz < minDist * minDist) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      placed.push({ x, y, z, r: radius });
      if (kind === 'strawberry') {
        const s = radius * 1.24;
        // Organic 3D pitch & yaw tilts (20°-42°) so slices tumble naturally in depth!
        const signX = rand() < 0.5 ? -1 : 1;
        const signY = rand() < 0.5 ? -1 : 1;
        specs.push({
          kind,
          x,
          y,
          z,
          scale: [s * (0.94 + rand() * 0.12), s * (1.04 + rand() * 0.14), s],
          rot: [
            signX * (0.28 + rand() * 0.36),
            signY * (0.32 + rand() * 0.42),
            (rand() - 0.5) * Math.PI * 1.8,
          ],
          radius,
        });
      } else {
        specs.push({
          kind,
          x,
          y,
          z,
          scale: [radius, radius, radius * 0.94],
          rot: [1.0 + rand() * 0.65, (rand() - 0.5) * 1.4, (rand() - 0.5) * 1.2],
          radius,
        });
      }
      return true;
    }
    return false;
  }

  // Place 6 strawberry slices spanning upper, mid, and lower zones (close enough to front for crisp veins!)
  tryPlace('strawberry', 0.31, 0.22, 0.68, 0.045);
  tryPlace('strawberry', 0.30, -0.25, 0.22, 0.042);
  tryPlace('strawberry', 0.25, -0.84, -0.44, 0.048);
  tryPlace('strawberry', 0.25, -0.62, -0.18, -0.025);
  tryPlace('strawberry', 0.18, 0.58, 0.92, -0.005);
  tryPlace('strawberry', 0.17, -0.86, -0.58, 0.01);

  // Place 7 blueberries (some close to front for razor-sharp calyx detail, some deeper for frosty depth!)
  tryPlace('blueberry', 0.165, -0.74, -0.32, 0.062);
  tryPlace('blueberry', 0.155, -0.66, -0.24, 0.052);
  tryPlace('blueberry', 0.16, 0.34, 0.78, -0.02);
  tryPlace('blueberry', 0.155, -0.18, 0.28, -0.012);
  tryPlace('blueberry', 0.14, -0.90, -0.62, 0.015);
  tryPlace('blueberry', 0.135, -0.80, -0.35, -0.02);
  tryPlace('blueberry', 0.135, -0.08, 0.45, -0.02);

  return specs;
}

export function createFruitAssembly(seed: number): FruitAssembly {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];

  // Shared botanical textures (2 strawberry & 2 blueberry variants; each strawberry gets its own bend uniform sharing 1 GPU shader program!)
  const strawTexA = createStrawberryTextures(seed * 31 + 103);
  const strawTexB = createStrawberryTextures(seed * 37 + 211);
  const blueSetA = createBlueberryMaterial(seed * 41 + 307);
  const blueSetB = createBlueberryMaterial(seed * 43 + 419);

  disposables.push(
    strawTexA.albedo,
    strawTexA.bump,
    strawTexA.translucency,
    strawTexB.albedo,
    strawTexB.bump,
    strawTexB.translucency,
    blueSetA.material,
    blueSetA.textures.albedo,
    blueSetA.textures.bump,
    blueSetA.textures.roughness,
    blueSetB.material,
    blueSetB.textures.albedo,
    blueSetB.textures.bump,
    blueSetB.textures.roughness,
  );

  // Birch wood popsicle stick with capillary damp wicking & deep glossy berry stain when bare
  const woodTex = createWoodTextures(seed * 19 + 503);
  const stickUniforms = {
    uIceBottomY: { value: POPSICLE.yBottom as number },
    uIceTopY: { value: POPSICLE.yTop as number },
    uIceAmount: { value: 1.0 as number },
    uStickWetness: { value: 0.0 as number },
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

          // Natural damp strawberry-stained birch wood (upper submerged half slightly richer crimson-rose!)
          float woodLuma = dot(diffuseColor.rgb, vec3(0.30, 0.59, 0.11));
          vec3 dampRoseWood = mix(
            diffuseColor.rgb * vec3(0.90, 0.52, 0.52),
            vec3(0.88, 0.27, 0.33) * woodLuma * 1.26,
            0.52 + 0.40 * fullSoak
          );
          vec3 deepStickyTip = vec3(0.82, 0.22, 0.29) * woodLuma * 1.20;
          vec3 targetStain = mix(dampRoseWood, deepStickyTip, wasSubmerged * (0.28 + 0.22 * revealedUpper));
          diffuseColor.rgb = mix(diffuseColor.rgb, targetStain, soakFront * (0.58 + 0.38 * fullSoak));
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
            float ndv = clamp(dot(sN, sV), 0.0, 1.0);
            // Natural damp-wood sticky satin sheen (preserves crisp birch wood grain without plastic glare!)
            float stickyFresnel = pow(1.0 - ndv, 4.2) * (0.08 + 0.10 * revealedUpper);
            vec3 sH1 = normalize(normalize(vec3(-0.52, 0.38, 0.76)) + sV);
            vec3 sH2 = normalize(normalize(vec3(0.55, 0.32, 0.77)) + sV);
            float wetSpec = pow(max(dot(sN, sH1), 0.0), 72.0) * (0.30 + 0.14 * revealedUpper)
                          + pow(max(dot(sN, sH2), 0.0), 58.0) * (0.22 + 0.10 * revealedUpper);
            reflectedLight.directSpecular += vec3(1.08, 0.94, 0.93) * (wetSpec + stickyFresnel) * dampMask;
          }
        }`,
      );
  };

  const stickGeo = createWoodStickGeometry();
  const stickMesh = new THREE.Mesh(stickGeo, stickMat);
  stickMesh.name = 'popsicle-stick';
  group.add(stickMesh);
  disposables.push(stickGeo, stickMat, woodTex.albedo, woodTex.bump);

  // Generate individual 3D botanical fruit meshes
  const specs = buildFruitLayout(seed);
  const fruits: FruitItem[] = [];
  const rand = mulberry32(seed * 97 + 7);

  specs.forEach((spec, idx) => {
    let geo: THREE.BufferGeometry;
    let mat: THREE.Material;
    let bendUniform: { value: THREE.Vector3 } | undefined;

    if (spec.kind === 'strawberry') {
      geo = createStrawberrySliceGeometry(seed * 131 + idx * 17 + 5, 0.16 + rand() * 0.04);
      const straw = createStrawberryMaterial(idx % 2 === 0 ? strawTexA : strawTexB);
      mat = straw.material;
      bendUniform = straw.uBend;
      disposables.push(mat);
    } else {
      geo = createBlueberryGeometry(seed * 149 + idx * 23 + 11);
      mat = idx % 2 === 0 ? blueSetA.material : blueSetB.material;
    }
    disposables.push(geo);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(spec.x, spec.y, spec.z);
    mesh.scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);
    mesh.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
    mesh.name = `${spec.kind}-${idx}`;
    group.add(mesh);

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
      exposure: 0,
      holdStrength: 0.22 + rand() * 0.14,
      bendAmt: 0,
      bendVel: 0,
      bendPhase: rand() * Math.PI * 2,
      bendUniform,
    });
  });

  function reset() {
    for (const f of fruits) {
      f.mesh.position.copy(f.basePos);
      f.mesh.quaternion.copy(f.baseQuat);
      f.mesh.scale.copy(f.baseScale);
      f.velocity.set(0, 0, 0);
      f.angVel.set(0, 0, 0);
      f.detached = false;
      f.detachTime = 0;
      f.glancedBody = false;
      f.exposure = 0;
      f.bendAmt = 0;
      f.bendVel = 0;
      f.bendUniform?.value.set(0, 0, 0);
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
    const sag = smoothstep(0.38, 1.0, f.exposure);
    const sideSign = Math.abs(f.basePos.x) > 0.03 ? Math.sign(f.basePos.x) : 1;

    // Graceful melt-shift: fruit gently loosens downward, slips slightly outward, tilts, and softens!
    f.mesh.position.set(f.basePos.x + sideSign * sag * 0.018, f.basePos.y - sag * 0.042, f.basePos.z);
    sagEuler.set(sag * 0.14, 0, -sideSign * sag * 0.22);
    sagQuat.setFromEuler(sagEuler);
    f.mesh.quaternion.copy(f.baseQuat).multiply(sagQuat);
    f.mesh.scale.copy(f.baseScale);

    // Subtle soft-thaw droop on exposed strawberry slices before peeling free
    const thawSoft = smoothstep(0.24, 1.0, f.exposure);
    f.bendAmt = thawSoft * 0.17;
    f.bendVel = 0;
    if (f.bendUniform) {
      f.bendUniform.value.set(f.bendAmt, thawSoft * 0.08, -sideSign * thawSoft * 0.11);
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
          f.mesh.visible = true;
          applyPreReleasePose(f, depth, releaseMargin);
          f.velocity.set(0, 0, 0);
        }
        continue;
      }

      if (!f.detached) {
        applyPreReleasePose(f, depth, releaseMargin);

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

          // Soft peel-off flex impulse as the thawed lightweight berry slips free
          f.bendVel = f.kind === 'strawberry' ? 1.55 : 1.1;
        }
      }
    }

    if (dt <= 0) return;

    // Pass 2: Quick, graceful falloff with at most ONE faked soft brush off the main body + soft berry flex!
    const substeps = 2;
    const subDt = dt / substeps;

    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      if (!f.detached || !f.mesh.visible) continue;

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
            f.bendVel += f.kind === 'strawberry' ? 2.4 : 1.5;
          }
        }
      }

      // Soft damped spring deformation in flight (soft thawed strawberry flex & subtle blueberry squish!)
      const restBend = f.kind === 'strawberry' ? 0.12 + 0.05 * Math.sin(f.detachTime * 8.5 + f.bendPhase) : 0.0;
      const springF = (restBend - f.bendAmt) * 28.0 - f.bendVel * 5.2;
      f.bendVel += springF * dt;
      f.bendAmt = clamp(f.bendAmt + f.bendVel * dt, -0.26, 0.32);

      if (f.bendUniform) {
        const flutter = Math.sin(f.detachTime * 7.2 + f.bendPhase) * 0.07;
        f.bendUniform.value.set(f.bendAmt, flutter, -sideX * f.bendAmt * 0.48);
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

  function hasFallingFruitInView(): boolean {
    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      if (f.detached && f.mesh.visible && f.mesh.position.y > -1.78 && f.detachTime < 1.8) {
        return true;
      }
    }
    return false;
  }

  function dispose() {
    for (const d of disposables) d.dispose();
  }

  return { group, stickMesh, stickUniforms, fruits, hasFallingFruitInView, reset, update, dispose };
}
