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
  mass: number;
  velocity: THREE.Vector3;
  angVel: THREE.Vector3;
  detached: boolean;
  /** Elapsed seconds since detaching (guarantees clean brisk exit!) */
  detachTime: number;
  /** World position at the exact moment of detachment (anchors smooth local birth-cavity mask -> zero pop!) */
  detachOrigin: THREE.Vector3;
  /** Depth of the molded ice pocket right at detachment (decays smoothly to 0 as the fruit slips free) */
  cavityDepth: number;
  /** Initial stick overlap clearance for stick-adjacent fruits at detachment (prevents frame-0 stick pop!) */
  stickCavity: number;
  /** True while the user is actively grabbing / holding this fruit with their pointer */
  grabbed: boolean;
  /** Fraction exposed outside melting ice [0..1] */
  exposure: number;
  /** Wet-ice sliding contact intensity [0..1] (drives capillary adhesion & rolling torque) */
  wetContact: number;
  /** Accumulated knock-loose impact from upper falling berries hitting a nearly-free lower berry */
  knockAccum: number;
  /** Damped micro-recoil offset & velocity when an embedded fruit gets bumped by a falling berry */
  jostlePos: THREE.Vector3;
  jostleVel: THREE.Vector3;
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
 * Smooth minimum for gently beveled organic knife-cut edges (never harsh self-intersecting corners).
 */
function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Generates a watertight, beveled 3D strawberry piece geometry mapped seamlessly onto the
 * canonical procedural strawberry texture (`strawberryBoundaryRadius`):
 * - variant 0: full classic heart cross-section slice
 * - variant 1: cleanly halved slice (straight vertical or diagonal knife cut exposing juicy flesh)
 * - variant 2: chunky quarter wedge (2 intersecting knife cuts, thicker bite)
 * - variant 3: little diced strawberry piece (3–4 knife cuts, juicy bite-sized morsel)
 */
function createStrawberrySliceGeometry(seed: number, thickness = 0.16, variant = 0): THREE.BufferGeometry {
  const rand = mulberry32(seed + variant * 197);
  const off = rand() * 30;

  const isHalf = variant === 1;
  const isQuarter = variant === 2;
  const isLittlePiece = variant === 3;

  const segAng = isLittlePiece ? 36 : 54;
  const faceRings = [0.0, 0.22, 0.46, 0.68, 0.85, 0.955, 0.995];
  // Outer bevel rings transitioning from front (+halfT) around curved skin/cut rim to back (-halfT)
  const bevelProfile: Array<{ rMul: number; zFrac: number; uvR: number }> = [
    { rMul: 1.012, zFrac: 0.84, uvR: 0.975 },
    { rMul: 1.028, zFrac: 0.48, uvR: 0.985 },
    { rMul: 1.034, zFrac: 0.0, uvR: 0.992 },
    { rMul: 1.028, zFrac: -0.48, uvR: 0.985 },
    { rMul: 1.012, zFrac: -0.84, uvR: 0.975 },
  ];

  // Slight natural asymmetry & thickness taper (whole/half are thin slices; quarters & diced pieces are chunkier!)
  const asymX = (rand() - 0.5) * 0.08;
  const warpPhase = rand() * Math.PI * 2;
  const effThickness = isLittlePiece
    ? 0.44 + rand() * 0.14
    : isQuarter
      ? 0.26 + rand() * 0.08
      : isHalf
        ? thickness * (1.06 + rand() * 0.16)
        : thickness;

  // Define polar sweep origin (ox, oy) strictly inside the kept cut region + convex knife-cut half-planes
  // Each plane keeps points where (x - ox)*nx + (y - oy)*ny <= dist (dist > 0)
  let ox = 0;
  let oy = 0;
  const cutPlanes: Array<{ nx: number; ny: number; dist: number }> = [];

  if (isHalf) {
    // Vertical or tilted diagonal knife split right through the berry!
    const cutAng = (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.95;
    const dx = Math.cos(cutAng);
    const dy = Math.sin(cutAng);
    const cutShift = (rand() - 0.5) * 0.16;
    const inward = 0.34;
    ox = dx * (cutShift + inward);
    oy = dy * (cutShift + inward);
    // Outward normal of the knife plane points opposite to kept side (-dx, -dy) at distance `inward`
    cutPlanes.push({ nx: -dx, ny: -dy, dist: inward });
  } else if (isQuarter) {
    // Crisp ~95–125° triangular quarter wedge with 2 straight knife edges & 1 curved seed-skin edge!
    const midAng = rand() * Math.PI * 2;
    const halfSpan = 0.82 + rand() * 0.24; // ~47°–61° each side -> ~94°–122° wedge
    ox = Math.cos(midAng) * 0.36;
    oy = Math.sin(midAng) * 0.36;
    const a1 = midAng + halfSpan + Math.PI * 0.5;
    const a2 = midAng - halfSpan - Math.PI * 0.5;
    const d1 = 0.24 + rand() * 0.07;
    const d2 = 0.24 + rand() * 0.07;
    cutPlanes.push({ nx: Math.cos(a1), ny: Math.sin(a1), dist: d1 });
    cutPlanes.push({ nx: Math.cos(a2), ny: Math.sin(a2), dist: d2 });
  } else if (isLittlePiece) {
    // Bite-sized diced strawberry morsel sampled from ruby skin rim, tip, or juicy marbled interior!
    const sampAng = rand() * Math.PI * 2;
    const sampR = 0.16 + rand() * 0.36;
    ox = Math.cos(sampAng) * sampR;
    oy = Math.sin(sampAng) * sampR;
    const numCuts = rand() < 0.55 ? 4 : 3;
    const baseRot = rand() * Math.PI * 2;
    for (let c = 0; c < numCuts; c++) {
      const ca = baseRot + (c / numCuts) * Math.PI * 2 + (rand() - 0.5) * 0.42;
      cutPlanes.push({
        nx: Math.cos(ca),
        ny: Math.sin(ca),
        dist: 0.24 + rand() * 0.14,
      });
    }
  }

  function evalWholeRadius(angle: number): number {
    const base = strawberryBoundaryRadius(angle);
    const asym = 1.0 + asymX * Math.cos(angle);
    const organic = 1.0 + 0.025 * Math.sin(angle * 3.0 + warpPhase);
    const scallop = 1.0 + 0.012 * Math.cos(angle * 26.0);
    return base * asym * organic * scallop;
  }

  // Exact ray-distance from (ox, oy) along direction (ca, sa) to outer strawberry silhouette
  function rayToBerryBoundary(ca: number, sa: number): number {
    if (ox === 0 && oy === 0) {
      return evalWholeRadius(Math.atan2(sa, ca));
    }
    let lo = 0.02;
    let hi = 1.95;
    for (let it = 0; it < 12; it++) {
      const mid = 0.5 * (lo + hi);
      const px = ox + ca * mid;
      const py = oy + sa * mid;
      const dist = Math.hypot(px, py);
      const bound = evalWholeRadius(Math.atan2(py, px));
      if (dist < bound) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  // Ray distance from (ox, oy) clipped smoothly against all knife-cut planes
  function evalCutBoundary(ang: number): { r: number; isKnife: boolean } {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const rBerry = rayToBerryBoundary(ca, sa);
    if (cutPlanes.length === 0) return { r: rBerry, isKnife: false };

    let rKnife = 999;
    for (const pl of cutPlanes) {
      const proj = ca * pl.nx + sa * pl.ny;
      if (proj > 1e-4) {
        rKnife = Math.min(rKnife, pl.dist / proj);
      }
    }
    const bevelK = isLittlePiece ? 0.055 : 0.048;
    const rFinal = smoothMin(rBerry, rKnife, bevelK);
    return { r: Math.max(0.04, rFinal), isKnife: rKnife < rBerry + 0.03 };
  }

  // Precompute boundary contour around (ox, oy) so we can center & normalize cut pieces cleanly to radius ~1!
  const contourR = new Float32Array(segAng + 1);
  const contourKnife = new Uint8Array(segAng + 1);
  let sumX = 0;
  let sumY = 0;
  for (let ai = 0; ai < segAng; ai++) {
    const ang = (ai / segAng) * Math.PI * 2 - Math.PI;
    const cb = evalCutBoundary(ang);
    contourR[ai] = cb.r;
    contourKnife[ai] = cb.isKnife ? 1 : 0;
    sumX += ox + Math.cos(ang) * cb.r;
    sumY += oy + Math.sin(ang) * cb.r;
  }
  contourR[segAng] = contourR[0];
  contourKnife[segAng] = contourKnife[0];

  const meanX = cutPlanes.length > 0 ? sumX / segAng : 0;
  const meanY = cutPlanes.length > 0 ? sumY / segAng : 0;
  let maxExtent = 0.01;
  if (cutPlanes.length > 0) {
    for (let ai = 0; ai < segAng; ai++) {
      const ang = (ai / segAng) * Math.PI * 2 - Math.PI;
      const px = ox + Math.cos(ang) * contourR[ai] - meanX;
      const py = oy + Math.sin(ang) * contourR[ai] - meanY;
      maxExtent = Math.max(maxExtent, Math.hypot(px, py));
    }
  }
  // Normalize cut pieces to ~0.96 local radius so `spec.radius` cleanly controls final world size!
  const normScale = cutPlanes.length > 0 ? 0.96 / maxExtent : 1.0;
  const halfT = effThickness * 0.5;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  function pushVertex(wx: number, wy: number, z: number, ux: number, uy: number) {
    positions.push((wx - meanX) * normScale, (wy - meanY) * normScale, z);
    uvs.push(clamp(0.5 + 0.5 * ux, 0.002, 0.998), clamp(0.5 + 0.5 * uy, 0.002, 0.998));
  }

  // Helper: subtle cut-face undulation
  function faceZ(wx: number, wy: number, side: 1 | -1, rn: number): number {
    const taper = 1.0 + 0.16 * clamp(wy, -1, 1);
    const wave = (fbm3(wx * 3.6 + off, wy * 3.6, side * 1.7, 3) - 0.5) * 0.032;
    const dome = 1.0 - (isLittlePiece ? 0.16 : 0.10) * rn * rn;
    return side * (halfT * taper * dome + wave);
  }

  // Map canonical strawberry coordinates (wx, wy) cleanly to procedural strawberry UV space
  function toBerryUv(wx: number, wy: number, uvScale = 1.0): [number, number] {
    if (cutPlanes.length === 0) {
      const ang = Math.atan2(wy, wx);
      const br = evalWholeRadius(ang);
      const uvBr = strawberryBoundaryRadius(ang);
      const ratio = br > 1e-4 ? (uvBr / br) * uvScale : uvScale;
      return [wx * ratio, wy * ratio];
    }
    return [wx * uvScale, wy * uvScale];
  }

  const ringOffsets: number[] = [];

  // 1. Front center
  const frontCenterIdx = 0;
  const [cUx, cUy] = toBerryUv(ox, oy, 1.0);
  pushVertex(ox, oy, faceZ(ox, oy, 1, 0), cUx, cUy);

  // 2. Front concentric rings
  for (let ri = 1; ri < faceRings.length; ri++) {
    const rn = faceRings[ri];
    ringOffsets.push(positions.length / 3);
    for (let ai = 0; ai <= segAng; ai++) {
      const ang = (ai / segAng) * Math.PI * 2 - Math.PI;
      const r = contourR[ai] * rn;
      const wx = ox + Math.cos(ang) * r;
      const wy = oy + Math.sin(ang) * r;
      const [ux, uy] = toBerryUv(wx, wy, 1.0);
      pushVertex(wx, wy, faceZ(wx, wy, 1, rn), ux, uy);
    }
  }

  // 3. Bevel rim rings (outer curved crimson skin on uncut sides, crisp juicy cut edge on knife sides!)
  for (let bi = 0; bi < bevelProfile.length; bi++) {
    const bp = bevelProfile[bi];
    ringOffsets.push(positions.length / 3);
    for (let ai = 0; ai <= segAng; ai++) {
      const ang = (ai / segAng) * Math.PI * 2 - Math.PI;
      const isKnife = contourKnife[ai] === 1;
      const seedDimple = isKnife
        ? 1.0
        : 1.0 - 0.015 * Math.pow(0.5 + 0.5 * Math.cos(ang * 26.0), 4.0) * (1 - Math.abs(bp.zFrac));
      const r = contourR[ai] * (isKnife ? 1.0 + (bp.rMul - 1.0) * 0.55 : bp.rMul) * seedDimple;
      const wx = ox + Math.cos(ang) * r;
      const wy = oy + Math.sin(ang) * r;
      const taper = 1.0 + 0.16 * clamp(wy, -1, 1);
      const z = halfT * taper * 0.90 * bp.zFrac;
      const [ux, uy] = toBerryUv(wx, wy, isKnife ? 0.96 : bp.uvR);
      pushVertex(wx, wy, z, ux, uy);
    }
  }

  // 4. Back concentric rings (outer -> inner)
  for (let ri = faceRings.length - 1; ri >= 1; ri--) {
    const rn = faceRings[ri];
    ringOffsets.push(positions.length / 3);
    for (let ai = 0; ai <= segAng; ai++) {
      const ang = (ai / segAng) * Math.PI * 2 - Math.PI;
      const r = contourR[ai] * rn;
      const wx = ox + Math.cos(ang) * r;
      const wy = oy + Math.sin(ang) * r;
      const [ux, uy] = toBerryUv(wx, wy, 1.0);
      pushVertex(wx, wy, faceZ(wx, wy, -1, rn), ux, uy);
    }
  }

  // 5. Back center
  const backCenterIdx = positions.length / 3;
  pushVertex(ox, oy, faceZ(ox, oy, -1, 0), cUx, cUy);

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
 * a true 3D recessed 5-pointed star calyx crown at +Y pole, and natural squashed variants:
 * - variant 0: plump whole blueberry
 * - variant 1: gently squashed / pressed against mold wall (flat pressed cheek + wider bulge)
 * - variant 2: heavily squashed / pinched berry (compressed disc-oval with soft crease fold)
 */
function createBlueberryGeometry(seed: number, variant = 0): THREE.BufferGeometry {
  const rand = mulberry32(seed + variant * 151);
  const off = rand() * 40;
  const starPhase = rand() * Math.PI * 2;
  const isPressed = variant === 1;
  const isHeavilySquashed = variant === 2;
  const oblate = isHeavilySquashed
    ? 0.50 + rand() * 0.12
    : isPressed
      ? 0.66 + rand() * 0.10
      : 0.84 + rand() * 0.08;
  const latSpreadX = isHeavilySquashed ? 1.18 + rand() * 0.16 : isPressed ? 1.08 + rand() * 0.12 : 0.96 + rand() * 0.08;
  const latSpreadZ = isHeavilySquashed ? 1.12 + rand() * 0.16 : isPressed ? 1.04 + rand() * 0.12 : 0.96 + rand() * 0.08;

  // Random side-press direction for organic squashed cheek & soft crease fold
  let pressX = rand() * 2 - 1;
  let pressY = (rand() - 0.5) * 0.8;
  let pressZ = rand() * 2 - 1;
  const pLen = Math.hypot(pressX, pressY, pressZ) || 1;
  pressX /= pLen;
  pressY /= pLen;
  pressZ /= pLen;

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

    // Organic berry lumpiness (stronger soft wrinkling on squashed berries!)
    const lumpAmp = isHeavilySquashed ? 0.16 : isPressed ? 0.12 : 0.085;
    const lump = 1.0 + (fbm3(vx * 2.6 + off, vy * 2.6, vz * 2.6, 3) - 0.5) * lumpAmp;

    // 5-pointed star calyx crown at north pole (phi < 0.52)
    let rMod = lump;
    let yLift = 0;
    if (phi < 0.52) {
      const star = Math.pow(0.5 + 0.5 * Math.cos(theta * 5.0 + starPhase), 1.45);
      const pit = 1.0 - smoothstep(0.0, 0.24, phi);
      const crest = Math.exp(-Math.pow((phi - 0.27) / 0.085, 2.0)) * (0.45 + 0.85 * star);
      rMod *= 1.0 - pit * 0.20 + crest * 0.09;
      yLift += crest * 0.095 - pit * 0.14;
    }

    // Subtle stem dimple at south pole
    if (phi > Math.PI - 0.26) {
      const dimp = smoothstep(Math.PI - 0.26, Math.PI, phi);
      rMod *= 1.0 - dimp * 0.09;
    }

    let x = vx * rMod * latSpreadX;
    let y = vy * oblate * rMod + yLift;
    let z = vz * rMod * latSpreadZ;

    // Flatten a natural pressed cheek / subtle bruised dent on squashed berries
    if (isPressed || isHeavilySquashed) {
      const sideDot = vx * pressX + vy * pressY + vz * pressZ;
      if (sideDot > 0.28) {
        const flatAmt = smoothstep(0.28, 0.92, sideDot) * (isHeavilySquashed ? 0.34 : 0.20);
        x -= pressX * flatAmt;
        y -= pressY * flatAmt * oblate;
        z -= pressZ * flatAmt;
      }
      if (isHeavilySquashed) {
        // Subtle soft skin crease pinch along the squished lobe
        const crease = Math.exp(-Math.pow((sideDot - 0.15) / 0.18, 2.0)) * 0.085;
        x *= 1.0 - crease;
        z *= 1.0 - crease;
      }
    }

    pos.setXYZ(i, x, y, z);
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
 * - Organic form variants:
 *   0 = whole (gently irregular/pressed)
 *   1 = squashed/compressed
 *   2 = halved longitudinal cup (hollow pale-rose inner wall)
 *   3 = quarter wedge (~115° curved arc of drupelets + partial inner cup)
 *   4 = small broken bit (torn cluster of 3–6 plump drupelets)
 *   5 = loose drupelet ball(s) (1 single plump raspberry ball or a tiny pair of 2 balls)
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
  const isQuarter = variant === 3;
  const isSmallBit = variant === 4;
  const isLooseBall = variant === 5;

  // Organic global deformation per berry (applied primarily to drupelet layout so squashed berries stay plump!)
  const squashX = isSquashed ? 1.12 + rand() * 0.14 : 0.94 + rand() * 0.12;
  const squashY = isSquashed ? 0.90 + rand() * 0.12 : 0.96 + rand() * 0.10;
  const squashZ = isSquashed ? 0.54 + rand() * 0.12 : isHalved || isQuarter ? 0.92 + rand() * 0.08 : 0.86 + rand() * 0.14;
  // Local drupelet keeps plump roundness (only gently flattened by ~28% of berry squash)
  const localSqX = 1.0 + (squashX - 1.0) * 0.28;
  const localSqY = 1.0 + (squashY - 1.0) * 0.28;
  const localSqZ = 1.0 + (squashZ - 1.0) * 0.34;
  const bendX = isSmallBit || isLooseBall ? 0 : (rand() - 0.5) * 0.16;
  const bendZ = isSmallBit || isLooseBall ? 0 : (rand() - 0.5) * 0.12;

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

  if (isLooseBall) {
    // Individual loose raspberry drupelet ball (or cozy twin pair of 2 clinging balls!)
    const isPair = rand() < 0.36;
    if (isPair) {
      const colA = pickDrupeletColor(rand() < 0.14);
      const colB = pickDrupeletColor(rand() < 0.12);
      const rA = 0.64 + rand() * 0.08;
      const rB = 0.56 + rand() * 0.10;
      addDrupelet(-0.42, 0.05, 0.04, rA, 1.0, colA, true, false);
      addDrupelet(0.44, -0.06, -0.04, rB, 1.0, colB, true, false);
    } else {
      const col = pickDrupeletColor(rand() < 0.18);
      addDrupelet(0, 0, 0, 0.92, 1.0, col, true, false);
    }
  } else if (isSmallBit) {
    // Torn small raspberry fragment: organic tight cluster of 3–6 plump drupelets!
    const bitCount = 3 + Math.floor(rand() * 4); // 3..6 drupelets
    const anchors: Array<[number, number, number]> = [
      [0.0, 0.0, 0.06],
      [0.54, 0.16, -0.04],
      [-0.48, 0.24, -0.06],
      [0.12, -0.50, -0.05],
      [-0.42, -0.34, 0.08],
      [0.50, -0.36, 0.12],
    ];
    for (let b = 0; b < bitCount; b++) {
      const [ax, ay, az] = anchors[b];
      const jx = (rand() - 0.5) * 0.16;
      const jy = (rand() - 0.5) * 0.16;
      const jz = (rand() - 0.5) * 0.14;
      const dr = 0.40 + rand() * 0.12;
      const col = pickDrupeletColor(b === bitCount - 1 && rand() < 0.30);
      addDrupelet(ax + jx, ay + jy, az + jz, dr, 0.98, col, true, false);
    }
  } else {
    if (isHalved || isQuarter) {
      // Sculpted hollow inner receptacle cup wall (180° for half, ~110° curved arc for quarter!)
      const cupU = isQuarter ? 9 : 14;
      const cupV = 10;
      const cupStart = vertBase;
      const cupAngStart = Math.PI;
      const cupAngSpan = isQuarter ? Math.PI * 0.62 : Math.PI;
      for (let iv = 0; iv <= cupV; iv++) {
        const t = iv / cupV; // 0 = top stem opening (+0.58), 1 = rounded inner cup bottom (-0.60)
        const y = 0.58 - t * 1.18;
        const cupR = 0.44 * Math.pow(Math.max(0.02, 1.0 - t * t * 0.94), 0.56);
        for (let iu = 0; iu <= cupU; iu++) {
          const ang = cupAngStart + (iu / cupU) * cupAngSpan;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const lx = ca * cupR;
          const lz = sa * cupR * 0.92 + 0.05;
          const [dx, dy, dz] = deformCenter(lx, y, lz);
          positions.push(dx, dy, dz);

          // Inward-facing cup normal pointing toward open cavity
          let nx = -ca / squashX;
          let ny = (t * 0.55) / squashY;
          let nz = -sa / squashZ;
          const nLen = Math.hypot(nx, ny, nz) || 1;
          normals.push(nx / nLen, ny / nLen, nz / nLen);
          uvs.push(iu / cupU, t);

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
        if (isQuarter && (cz > 0.16 || cx > 0.20)) {
          drupIdx++;
          continue;
        }
        const dr = ring.drupR * (0.91 + rand() * 0.18);
        const col = pickDrupeletColor(drupIdx === oddTargetIdx);
        addDrupelet(cx, cy, cz, dr, 0.98, col, true, isHalved || isQuarter);
        drupIdx++;
      }
    }
    // Rounded apex tip drupelet
    addDrupelet(
      isQuarter ? -0.14 : (rand() - 0.5) * 0.06,
      -0.82,
      isHalved || isQuarter ? -0.12 : (rand() - 0.5) * 0.06,
      0.29,
      1.0,
      pickDrupeletColor(false),
      true,
      isHalved || isQuarter,
    );
  }

  // Re-center & normalize partial/cluster variants (quarter, small bit, loose ball) around (0,0,0) for clean 3D physics!
  if (isQuarter || isSmallBit || isLooseBall) {
    const vCount = positions.length / 3;
    if (vCount > 0) {
      let mx = 0, my = 0, mz = 0;
      for (let i = 0; i < vCount; i++) {
        mx += positions[i * 3];
        my += positions[i * 3 + 1];
        mz += positions[i * 3 + 2];
      }
      mx /= vCount; my /= vCount; mz /= vCount;
      let maxR = 0.01;
      for (let i = 0; i < vCount; i++) {
        const px = positions[i * 3] - mx;
        const py = positions[i * 3 + 1] - my;
        const pz = positions[i * 3 + 2] - mz;
        positions[i * 3] = px;
        positions[i * 3 + 1] = py;
        positions[i * 3 + 2] = pz;
        if (hairFlags[i] < 0.2) {
          maxR = Math.max(maxR, Math.hypot(px, py, pz));
        }
      }
      const norm = 0.96 / maxR;
      for (let i = 0; i < positions.length; i++) {
        positions[i] *= norm;
      }
    }
  }

  // Per-vertex translucency weight (aDrupThin): loose drupelet balls & torn bits glow intensely like sea glass,
  // while outer drupelet domes on whole/halved/quartered berries glow brighter than recessed inner crevices!
  const vCountTotal = positions.length / 3;
  const drupThin = new Float32Array(vCountTotal);
  const fragThinBase = isLooseBall ? 1.0 : isSmallBit ? 0.90 : isQuarter ? 0.78 : isHalved ? 0.68 : isSquashed ? 0.56 : 0.46;
  for (let i = 0; i < vCountTotal; i++) {
    const rad = Math.min(1.0, Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
    drupThin[i] = clamp(fragThinBase * (0.48 + 0.52 * rad), 0.15, 1.0);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aHair', new THREE.Float32BufferAttribute(hairFlags, 1));
  geo.setAttribute('aDrupThin', new THREE.Float32BufferAttribute(drupThin, 1));
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
  material.customProgramCacheKey = () => 'raspberry-seaglass-v5';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uThaw = uThaw;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aHair;
        attribute float aDrupThin;
        varying vec3 vRaspWorldPos;
        varying vec3 vRaspWorldNormal;
        varying float vHair;
        varying float vDrupThin;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vRaspWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRaspWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        vHair = aHair;
        vDrupThin = aDrupThin;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uThaw;
        varying vec3 vRaspWorldPos;
        varying vec3 vRaspWorldNormal;
        varying float vHair;
        varying float vDrupThin;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Preserve per-drupelet color diversity (rich ruby, pale blush-pink, peach, deep plum) while deepening slightly when wet!
          float thaw = clamp(uThaw, 0.0, 1.0);
          float hairMask = clamp(vHair, 0.0, 1.0);
          vec3 wetDeep = pow(max(diffuseColor.rgb, vec3(0.0001)), vec3(1.10));
          diffuseColor.rgb = mix(diffuseColor.rgb, wetDeep, (0.14 + thaw * 0.42) * (1.0 - hairMask));
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          float hairMask = clamp(vHair, 0.0, 1.0);
          float wetRough = mix(roughnessFactor, min(roughnessFactor, 0.20), clamp(uThaw, 0.0, 1.0) * 0.72);
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
          float dThin = clamp(vDrupThin, 0.15, 1.0);

          // Camera-aligned rear studio lightbox direction so backlit sea-glass glow works 360°!
          vec3 rCamH = normalize(vec3(cameraPosition.x, 0.0, cameraPosition.z) + vec3(0.0, 0.0, 1e-5));
          vec3 backL = normalize(-rCamH + vec3(0.0, 0.24, 0.0));

          // Keep individual drupelet edges clean (no white HDR plastic rings!)
          float rimMask = smoothstep(0.08, 0.58, ndv);
          reflectedLight.indirectSpecular *= mix(0.06, 0.42, rimMask) * fleshMask;
          reflectedLight.directSpecular *= mix(0.15, 0.85, rimMask) * fleshMask;

          // === FROSTED SEA-GLASS TRANSLUCENCY (Beer-Lambert + Henyey-Greenstein + Light-Piping + Frost Veil) ===
          vec3 baseCol = clamp(diffuseColor.rgb, vec3(0.025), vec3(0.98));
          // Optical path through each plump drupelet: thin & radiant along curved shoulders, deeper jewel core at center
          float drupThick = mix(0.16, 1.02, pow(ndv, 1.32)) * mix(1.20, 0.54, dThin);
          vec3 sigma = max(-log(max(baseCol, vec3(0.02))) * 1.75, vec3(0.28));
          vec3 beer = exp(-sigma * drupThick);
          vec3 volOpacity = vec3(1.0) - exp(-(sigma + vec3(0.62)) * drupThick * 0.88);

          // Henyey-Greenstein forward scattering + soft backlit & wrap transmission (warm carnelian sea-glass glow!)
          float cosL = dot(-vDir, backL);
          float g = 0.45;
          float hg = (1.0 - g * g) / (12.56637 * pow(max(0.08, 1.0 + g * g - 2.0 * g * cosL), 1.5));
          float backLit = pow(clamp(dot(-nDir, backL) * 0.5 + 0.5, 0.0, 1.0), 1.45);
          float frontWrap = pow(clamp(dot(nDir, backL) * 0.5 + 0.5, 0.0, 1.0), 1.35);
          float colLuma = dot(baseCol, vec3(0.30, 0.59, 0.11));
          // Prevent already-pale unripe pink drupelets from blowing out to white while boosting rich ruby backlit translucency!
          float paleTame = mix(1.0, 0.48, smoothstep(0.28, 0.68, colLuma));
          vec3 warmBack = vec3(1.58, 1.16, 0.94);
          vec3 keySss = warmBack * (hg * 0.50 + backLit * 0.48 + frontWrap * 0.30) * paleTame;

          // Subtle inner seed core depth at center of each drupelet so translucent glowing rims pop in 3D!
          float seedCore = pow(ndv, 2.3) * 0.22 * (1.0 - dThin * 0.35) * fleshMask;
          reflectedLight.directDiffuse *= (1.0 - seedCore);
          reflectedLight.indirectDiffuse *= (1.0 - seedCore * 0.65);

          // Backlit transmitted jewel glow + volumetric internal scatter
          vec3 solidAlb = baseCol * mix(vec3(0.46), vec3(1.22), beer);
          vec3 throughGlow = warmBack * beer * (0.34 + 0.48 * dThin) * paleTame;
          vec3 internalScatter = keySss * solidAlb * volOpacity * (0.60 + 0.28 * dThin);

          // Thin-edge rim glow & internal light-piping (luminous carnelian/ruby edges instead of dark silhouettes!)
          float thinness = 1.0 - smoothstep(0.14, 0.68, drupThick);
          vec3 rimGlow = warmBack * (0.40 + 0.48 * backLit) * baseCol * thinness * (0.66 + 0.48 * dThin) * paleTame;
          float pipe = pow(1.0 - ndv, 2.0) * smoothstep(0.04, 0.42, ndv);
          vec3 pipeCol = exp(-sigma * 0.32) * vec3(1.48, 1.08, 0.94) * (0.44 + 0.40 * dThin) * paleTame;

          vec3 transBody = throughGlow + internalScatter + rimGlow + pipeCol * pipe * 0.68;

          // Silky frosted velvet veil (softly tinted by berry hue, melting cleanly into glossy wet ruby as uThaw rises!)
          float frostAmt = 1.0 - thaw * 0.68;
          float veil = frostAmt * (0.10 + 0.28 * pow(1.0 - ndv, 1.55)) * fleshMask;
          vec3 veilCol = mix(vec3(0.96, 0.88, 0.86), baseCol * 1.28 + vec3(0.16, 0.05, 0.07), 0.56) * (0.64 + 0.36 * frontWrap);

          // Blend luminous sea-glass translucency cleanly into the lit drupelet surface
          vec3 combinedDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + transBody * fleshMask;
          combinedDiffuse = mix(combinedDiffuse, veilCol, veil * 0.72);
          reflectedLight.directDiffuse = combinedDiffuse;
          reflectedLight.indirectDiffuse = vec3(0.0);

          // Subtle soft backlit tint on each tiny protruding botanical hair (whisper-fine dusty rose-amber, never stark white!)
          if (hairMask > 0.05) {
            float hairBacklit = 0.48 + 0.52 * pow(1.0 - ndv, 1.4);
            reflectedLight.directDiffuse += mix(diffuseColor.rgb, vec3(0.74, 0.46, 0.44), 0.45) * hairBacklit * hairMask * 0.26;
          }

          // Soft velvety satin sheen + delicate wet pinpoint on each plump drupelet crown (never plastic marble!)
          vec3 rCamR = vec3(rCamH.z, 0.0, -rCamH.x);
          vec3 lA = normalize(-0.50 * rCamR + vec3(0.0, 0.54, 0.0) + 0.68 * rCamH);
          vec3 lB = normalize( 0.56 * rCamR + vec3(0.0, 0.38, 0.0) + 0.73 * rCamH);
          vec3 hA = lA + vDir;
          hA *= inversesqrt(max(dot(hA, hA), 1e-8));
          vec3 hB = lB + vDir;
          hB *= inversesqrt(max(dot(hB, hB), 1e-8));
          float softVelvet = pow(max(dot(nDir, hA), 0.0), 38.0) * 0.20 + pow(max(dot(nDir, hB), 0.0), 32.0) * 0.11;
          float spA = pow(max(dot(nDir, hA), 0.0), 115.0);
          float spB = pow(max(dot(nDir, hB), 0.0), 88.0);
          reflectedLight.directSpecular += vec3(1.36, 1.12, 1.18) * (softVelvet + (spA * 0.46 + spB * 0.24) * (0.24 + 0.76 * thaw)) * fleshMask;
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
      // === STRAWBERRY SLICES, CUT WEDGES & LITTLE PIECES (organic handmade variety!) ===
      // 1. Hero whole slice — upper right
      {
        kind: 'strawberry',
        x: 0.19 + j(0.01),
        y: 0.45 + j(0.01),
        z: 0.010,
        scale: [0.265, 0.31, 0.26],
        rot: [0.36, -0.44, -0.62],
        radius: 0.21,
        baseBend: [0.24, 0.16, -0.16],
        variant: 0,
      },
      // 2. Halved curved strawberry slice — mid left
      {
        kind: 'strawberry',
        x: -0.24 + j(0.012),
        y: -0.09 + j(0.012),
        z: 0.042,
        scale: [0.22, 0.245, 0.225],
        rot: [-0.38, 0.52, 0.38],
        radius: 0.195,
        baseBend: [-0.28, 0.18, 0.18],
        variant: 1,
      },
      // 3. Cut quarter wedge — bottom left
      {
        kind: 'strawberry',
        x: -0.26 + j(0.012),
        y: -0.73 + j(0.012),
        z: 0.008,
        scale: [0.185, 0.205, 0.19],
        rot: [0.44, 0.48, -0.92],
        radius: 0.165,
        baseBend: [0.12, -0.08, 0.08],
        variant: 2,
      },
      // 4. Whole ruby slice — mid-lower right
      {
        kind: 'strawberry',
        x: 0.21 + j(0.015),
        y: -0.44 + j(0.015),
        z: -0.022,
        scale: [0.225, 0.26, 0.225],
        rot: [-0.48, -0.56, 0.78],
        radius: 0.185,
        baseBend: [-0.14, 0.12, -0.10],
        variant: 0,
      },
      // 5. Little cut strawberry piece — very top dome
      {
        kind: 'strawberry',
        x: -0.01 + j(0.01),
        y: 0.90 + j(0.01),
        z: -0.008,
        scale: [0.115, 0.105, 0.11],
        rot: [0.58, 0.28, 2.82],
        radius: 0.098,
        baseBend: [0.06, 0.04, 0.04],
        variant: 3,
      },
      // 6. Small strawberry quarter wedge — upper mid-left
      {
        kind: 'strawberry',
        x: -0.32 + j(0.015),
        y: 0.33 + j(0.015),
        z: -0.015,
        scale: [0.125, 0.14, 0.13],
        rot: [0.46, 0.62, -0.48],
        radius: 0.115,
        baseBend: [-0.10, -0.06, 0.06],
        variant: 2,
      },
      // 7. Little diced strawberry piece — bottom right corner
      {
        kind: 'strawberry',
        x: 0.33 + j(0.015),
        y: -0.81 + j(0.015),
        z: -0.010,
        scale: [0.095, 0.105, 0.10],
        rot: [-0.42, -0.54, 1.18],
        radius: 0.088,
        baseBend: [0.04, 0.04, -0.04],
        variant: 3,
      },
      // 8. Extra tiny diced strawberry morsel — mid center-right
      {
        kind: 'strawberry',
        x: 0.14 + j(0.015),
        y: 0.08 + j(0.015),
        z: 0.044,
        scale: [0.082, 0.088, 0.086],
        rot: [0.35, -0.40, 1.85],
        radius: 0.075,
        baseBend: [0.04, -0.03, 0.03],
        variant: 3,
      },
      // 9. Extra little cut strawberry bite — lower-left shoulder
      {
        kind: 'strawberry',
        x: -0.06 + j(0.015),
        y: -0.24 + j(0.015),
        z: 0.048,
        scale: [0.076, 0.082, 0.08],
        rot: [-0.30, 0.42, -1.25],
        radius: 0.070,
        baseBend: [0.03, 0.03, -0.02],
        variant: 3,
      },

      // === SMALLER & ORGANICALLY SQUASHED BLUEBERRIES ===
      // 1. Upper-left pressed blueberry
      {
        kind: 'blueberry',
        x: -0.17 + j(0.012),
        y: 0.65 + j(0.012),
        z: -0.034,
        scale: [0.132, 0.132, 0.125],
        rot: [1.15, 0.35, -0.25],
        radius: 0.128,
        variant: 1,
      },
      // 2. Mid-right whole smaller blueberry
      {
        kind: 'blueberry',
        x: 0.36 + j(0.012),
        y: -0.07 + j(0.012),
        z: -0.022,
        scale: [0.118, 0.118, 0.112],
        rot: [1.28, -0.52, 0.35],
        radius: 0.114,
        variant: 0,
      },
      // 3. Lower center-left HERO squashed blueberry (pressed against front mold!)
      {
        kind: 'blueberry',
        x: -0.155 + j(0.01),
        y: -0.45 + j(0.01),
        z: 0.028,
        scale: [0.122, 0.122, 0.116],
        rot: [1.18, 0.22, -0.18],
        radius: 0.118,
        variant: 2,
      },
      // 4. Lower center-right HERO whole blueberry (crisp 5-point star calyx)
      {
        kind: 'blueberry',
        x: 0.075 + j(0.01),
        y: -0.63 + j(0.01),
        z: 0.034,
        scale: [0.136, 0.136, 0.128],
        rot: [1.46, -0.28, 0.38],
        radius: 0.132,
        variant: 0,
      },
      // 5. Bottom center-right small baby blueberry
      {
        kind: 'blueberry',
        x: 0.21 + j(0.01),
        y: -0.84 + j(0.01),
        z: -0.004,
        scale: [0.094, 0.094, 0.090],
        rot: [1.35, 0.55, 0.12],
        radius: 0.092,
        variant: 1,
      },
      // 6. Deep left-edge squashed blueberry
      {
        kind: 'blueberry',
        x: -0.42 + j(0.01),
        y: -0.53 + j(0.01),
        z: -0.030,
        scale: [0.104, 0.104, 0.098],
        rot: [1.22, 0.72, -0.4],
        radius: 0.100,
        variant: 2,
      },
      // 7. Lower-right edge small berry
      {
        kind: 'blueberry',
        x: 0.41 + j(0.01),
        y: -0.67 + j(0.01),
        z: -0.024,
        scale: [0.098, 0.098, 0.092],
        rot: [1.10, -0.65, 0.22],
        radius: 0.095,
        variant: 0,
      },
      // 8. Tiny wild blueberry tucked upper-mid right
      {
        kind: 'blueberry',
        x: 0.31 + j(0.012),
        y: 0.24 + j(0.012),
        z: 0.022,
        scale: [0.084, 0.084, 0.080],
        rot: [1.38, -0.40, 0.50],
        radius: 0.082,
        variant: 1,
      },
      // 9. Tiny squashed blueberry tucked upper-left
      {
        kind: 'blueberry',
        x: -0.34 + j(0.012),
        y: -0.26 + j(0.012),
        z: -0.018,
        scale: [0.088, 0.088, 0.084],
        rot: [1.24, 0.48, -0.35],
        radius: 0.085,
        variant: 2,
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
    const isSmallScatter =
      kind === 'shaved-lemon' ||
      (kind === 'kaksmulor' && variant >= 2) ||
      (kind === 'raspberry' && variant >= 4) ||
      (kind === 'strawberry' && variant === 3) ||
      (kind === 'blueberry' && radius < 0.096);
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
          ? variant >= 2
            ? radius * 0.62
            : radius * 0.44
          : kind === 'shaved-lemon'
            ? radius * 0.35
            : kind === 'kaksmulor' && variant < 2
              ? radius * 0.45
              : kind === 'chocolate'
                ? radius * 0.62
                : kind === 'blueberry' && variant >= 1
                  ? radius * 0.68
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

      // Gently nudge fruits/chunks forward or backward off the flat wooden stick so pieces never look bisected!
      if (
        y < POPSICLE.stickTopY + radius * 0.55 &&
        Math.abs(x) < POPSICLE.stickEdgeX + radius * 0.52 &&
        Math.abs(z) < POPSICLE.stickDepth * 0.5 + halfThickZ * 0.52
      ) {
        const pushZ = Math.min(Math.max(0.035, maxSafeZ), POPSICLE.stickDepth * 0.5 + halfThickZ * 0.62);
        z = (z >= 0 ? 1 : -1) * pushZ;
      }

      let ok = true;
      for (const p of placed) {
        const dx = x - p.x;
        const dy = y - p.y;
        const dz = (z - p.z) * 1.45;
        const minDist = (radius + p.r) * (isSmallScatter ? 0.60 : 0.78);
        if (dx * dx + dy * dy + dz * dz < minDist * minDist) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      placed.push({ x, y, z, r: radius });
      if (kind === 'strawberry') {
        const isCutChunk = variant >= 2;
        const s = isCutChunk ? radius * 1.08 : radius * 1.18;
        const signX = rand() < 0.5 ? -1 : 1;
        const signY = rand() < 0.5 ? -1 : 1;
        const bendSign = rand() < 0.5 ? -1 : 1;
        const bendAmp = isCutChunk ? 0.06 : rand() < 0.55 ? 0.22 + rand() * 0.14 : 0.08 + rand() * 0.10;
        const pitch = isCoconut
          ? signX * (0.08 + rand() * 0.22)
          : isCutChunk
            ? (rand() - 0.5) * 1.4
            : signX * (0.28 + rand() * 0.36);
        const yaw = isCoconut
          ? signY * (0.08 + rand() * 0.24)
          : isCutChunk
            ? (rand() - 0.5) * 1.6
            : signY * (0.32 + rand() * 0.42);
        specs.push({
          kind,
          x,
          y,
          z,
          scale: [s * (0.94 + rand() * 0.12), s * (1.02 + rand() * 0.14), s],
          rot: [pitch, yaw, (rand() - 0.5) * Math.PI * 1.9],
          radius,
          baseBend: [bendSign * bendAmp, (rand() - 0.5) * (isCutChunk ? 0.08 : 0.34), (rand() - 0.5) * (isCutChunk ? 0.08 : 0.30)],
          variant,
        });
      } else if (kind === 'blueberry') {
        specs.push({
          kind,
          x,
          y,
          z,
          scale: [radius, radius, radius * (variant >= 1 ? 0.90 : 0.94)],
          rot: [0.95 + rand() * 0.85, (rand() - 0.5) * 1.6, (rand() - 0.5) * 1.4],
          radius,
          variant,
        });
      } else if (kind === 'raspberry') {
        const isCutCup = variant === 2 || variant === 3;
        const isLoose = variant >= 4;
        specs.push({
          kind,
          x,
          y,
          z,
          scale: isLoose
            ? [radius * (0.94 + rand() * 0.14), radius * (0.94 + rand() * 0.14), radius * (0.94 + rand() * 0.14)]
            : [radius * 0.98, radius * 1.08, radius * 0.98],
          rot: isCutCup
            ? [(rand() - 0.5) * 0.95, (rand() - 0.5) * 1.15, (rand() - 0.5) * 2.6]
            : [(rand() - 0.5) * 2.4, (rand() - 0.5) * 2.8, (rand() - 0.5) * 2.4],
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
          // Natural mix of whole slices (0), halved slices (1), chunky quarter wedges (2), and little pieces (3)!
          const strawVariant = n === 0 ? 0 : n % 4 === 1 ? 1 : n % 4 === 2 ? 2 : n % 4 === 3 ? 3 : 0;
          const r =
            strawVariant === 0
              ? 0.20 + rand() * 0.038
              : strawVariant === 1
                ? 0.165 + rand() * 0.036
                : strawVariant === 2
                  ? 0.13 + rand() * 0.032
                  : 0.072 + rand() * 0.028;
          tryPlace(kind, r, yMin, yMax, n % 2 === 0 ? 0.042 : -0.015, strawVariant);
        } else if (kind === 'blueberry') {
          // Smaller, varied wild-blueberry sizing + squashed/pressed organic variants!
          const blueVariant = n % 3 === 1 ? 1 : n % 3 === 2 ? 2 : 0;
          const r = 0.088 + rand() * 0.044;
          tryPlace(kind, r, yMin, yMax, n % 3 === 0 ? 0.056 : -0.012, blueVariant);
        } else if (kind === 'raspberry') {
          // Mix whole (0), squashed (1), halved cup (2), and quarter wedge (3)!
          const raspVariant = n % 4;
          const r =
            raspVariant === 3
              ? 0.105 + rand() * 0.028
              : raspVariant === 2
                ? 0.13 + rand() * 0.03
                : 0.14 + rand() * 0.032;
          tryPlace(kind, r, yMin, yMax, n % 2 === 0 ? 0.045 : -0.015, raspVariant);
        } else if (kind === 'chocolate') {
          const r = 0.088 + rand() * 0.038;
          tryPlace(kind, r, yMin, yMax, n % 2 === 0 ? 0.052 : -0.010);
        }
      }
    }

    // Extra natural scatter of small broken fruit pieces, baby blueberries, and loose raspberry drupelet balls!
    if (largePool.includes('raspberry')) {
      const bitCount = largePool.length === 1 ? 6 : 4;
      for (let n = 0; n < bitCount; n++) {
        const r = 0.060 + rand() * 0.026;
        tryPlace('raspberry', r, -0.84, 0.82, 0.048, 4); // small 3-6 drupelet broken bits
      }
      const ballCount = largePool.length === 1 ? 8 : 5;
      for (let n = 0; n < ballCount; n++) {
        const r = 0.036 + rand() * 0.018;
        tryPlace('raspberry', r, -0.86, 0.84, 0.054, 5); // loose individual drupelet balls / pairs
      }
    }
    if (largePool.includes('strawberry')) {
      const morselCount = largePool.length === 1 ? 6 : 4;
      for (let n = 0; n < morselCount; n++) {
        const r = 0.058 + rand() * 0.032;
        tryPlace('strawberry', r, -0.84, 0.82, 0.046, 3); // little diced strawberry pieces
      }
    }
    if (largePool.includes('blueberry')) {
      const babyCount = largePool.length === 1 ? 5 : 3;
      for (let n = 0; n < babyCount; n++) {
        const r = 0.068 + rand() * 0.024;
        const v = rand() < 0.65 ? (rand() < 0.5 ? 1 : 2) : 0; // mostly squashed small baby blueberries
        tryPlace('blueberry', r, -0.86, 0.80, 0.048, v);
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
          // Mapped cleanly onto the flat embedded upper face below the rounded cap (revealed as the popsicle melts!)
          // Single 5-tap pass shared directly with lights_fragment_end (halves uCarveMap texture bandwidth!)
          float frontFace = smoothstep(0.45, 0.78, vStickWorldNormal.z);
          sSharedFrontFace = frontFace;
          vec2 carveUv = vec2((vStickWorldPos.y + 0.62) / 0.60, (-vStickWorldPos.x + 0.088) / 0.176);
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
            // Natural damp-wood sticky satin sheen (camera-aligned azimuth so 360° turntable catches light on both faces!)
            float stickyFresnel = pow(1.0 - ndv, 4.2) * (0.08 + 0.10 * sSharedRevealedUpper);
            vec3 sCamH = stickSafeNorm(vec3(cameraPosition.x, 0.0, cameraPosition.z));
            vec3 sCamR = vec3(sCamH.z, 0.0, -sCamH.x);
            vec3 sH1 = stickSafeNorm(normalize(-0.52 * sCamR + vec3(0.0, 0.38, 0.0) + 0.76 * sCamH) + sV);
            vec3 sH2 = stickSafeNorm(normalize( 0.55 * sCamR + vec3(0.0, 0.32, 0.0) + 0.77 * sCamH) + sV);
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
        geo = createStrawberrySliceGeometry(seed * 131 + idx * 17 + 5, 0.16 + rand() * 0.04, spec.variant ?? 0);
        const straw = createStrawberryMaterial(idx % 2 === 0 ? strawTexA : strawTexB);
        mat = straw.material;
        bendUniform = straw.uBend;
        disposables.push(mat);
        break;
      }
      case 'blueberry': {
        if (!blueTexA || !blueTexB) return;
        geo = createBlueberryGeometry(seed * 149 + idx * 23 + 11, spec.variant ?? 0);
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
    const matDensity =
      spec.kind === 'chocolate'
        ? 1.55
        : spec.kind === 'blueberry'
          ? 1.12
          : spec.kind === 'raspberry'
            ? 0.95
            : spec.kind === 'strawberry'
              ? 0.86
              : spec.kind === 'kaksmulor'
                ? 0.72
                : 0.44;
    const fruitMass = Math.max(0.001, matDensity * spec.radius * spec.radius * spec.radius * 420.0);

    fruits.push({
      kind: spec.kind,
      mesh,
      basePos: mesh.position.clone(),
      baseQuat: mesh.quaternion.clone(),
      baseScale: mesh.scale.clone(),
      radius: spec.radius,
      mass: fruitMass,
      velocity: new THREE.Vector3(),
      angVel: new THREE.Vector3(),
      detached: false,
      detachTime: 0,
      detachOrigin: mesh.position.clone(),
      cavityDepth: 0,
      stickCavity: 0,
      grabbed: false,
      exposure: 0,
      wetContact: 0,
      knockAccum: 0,
      jostlePos: new THREE.Vector3(),
      jostleVel: new THREE.Vector3(),
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
      f.detachOrigin.copy(f.basePos);
      f.cavityDepth = 0;
      f.stickCavity = 0;
      f.grabbed = false;
      f.exposure = 0;
      f.wetContact = 0;
      f.knockAccum = 0;
      f.jostlePos.set(0, 0, 0);
      f.jostleVel.set(0, 0, 0);
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

  interface FruitPhysicsProfile {
    gravity: number;
    restitution: number;
    wetDrag: number;
    adhesion: number;
    rollGain: number;
    airDragLin: number;
    airDragQuad: number;
    angDrag: number;
    maxSpin: number;
    flatAero: number;
    magnus: number;
    flexGain: number;
    isFlat: boolean;
  }

  const FRUIT_PHYSICS: Record<ToppingId, FruitPhysicsProfile> = {
    blueberry: {
      gravity: 8.2,
      restitution: 0.30,
      wetDrag: 1.35,
      adhesion: 0.24,
      rollGain: 1.15,
      airDragLin: 0.12,
      airDragQuad: 0.038,
      angDrag: 0.45,
      maxSpin: 9.8,
      flatAero: 0.0,
      magnus: 0.055,
      flexGain: 0.58,
      isFlat: false,
    },
    raspberry: {
      gravity: 7.7,
      restitution: 0.20,
      wetDrag: 1.95,
      adhesion: 0.32,
      rollGain: 1.25,
      airDragLin: 0.16,
      airDragQuad: 0.050,
      angDrag: 0.62,
      maxSpin: 8.8,
      flatAero: 0.0,
      magnus: 0.044,
      flexGain: 0.68,
      isFlat: false,
    },
    strawberry: {
      gravity: 7.3,
      restitution: 0.14,
      wetDrag: 2.15,
      adhesion: 0.38,
      rollGain: 0.60,
      airDragLin: 0.18,
      airDragQuad: 0.048,
      angDrag: 0.95,
      maxSpin: 5.4,
      flatAero: 1.05,
      magnus: 0.018,
      flexGain: 1.0,
      isFlat: true,
    },
    chocolate: {
      gravity: 9.4,
      restitution: 0.44,
      wetDrag: 0.95,
      adhesion: 0.14,
      rollGain: 0.90,
      airDragLin: 0.08,
      airDragQuad: 0.025,
      angDrag: 0.38,
      maxSpin: 10.2,
      flatAero: 0.14,
      magnus: 0.028,
      flexGain: 0.16,
      isFlat: false,
    },
    kaksmulor: {
      gravity: 7.8,
      restitution: 0.36,
      wetDrag: 1.25,
      adhesion: 0.20,
      rollGain: 1.0,
      airDragLin: 0.15,
      airDragQuad: 0.046,
      angDrag: 0.55,
      maxSpin: 11.0,
      flatAero: 0.22,
      magnus: 0.036,
      flexGain: 0.22,
      isFlat: false,
    },
    'shaved-lemon': {
      gravity: 6.2,
      restitution: 0.12,
      wetDrag: 2.05,
      adhesion: 0.34,
      rollGain: 0.48,
      airDragLin: 0.28,
      airDragQuad: 0.085,
      angDrag: 1.20,
      maxSpin: 6.8,
      flatAero: 1.40,
      magnus: 0.022,
      flexGain: 0.85,
      isFlat: true,
    },
  };

  const sagEuler = new THREE.Euler();
  const sagQuat = new THREE.Quaternion();
  const spinAxis = new THREE.Vector3();
  const spinQuat = new THREE.Quaternion();
  const physN = new THREE.Vector3();
  const physVt = new THREE.Vector3();
  const physRollAxis = new THREE.Vector3();
  const physStickN = new THREE.Vector3();
  const physFaceN = new THREE.Vector3();
  const physVpar = new THREE.Vector3();
  const physAeroTorque = new THREE.Vector3();
  const physMagnus = new THREE.Vector3();
  const physRelPos = new THREE.Vector3();
  const physRelVel = new THREE.Vector3();
  const physContInfo = { depth: 0, dx: 0, dz: 0, dyBot: 0, dyTop: 0 };

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

  /** Outward unit normal of the live melting popsicle SDF via central differences (zero-allocation). */
  function sampleIceSurfaceNormal(
    x: number,
    y: number,
    z: number,
    meltState: MeltFieldState,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const eps = 0.012;
    // iceContainmentDepth is positive inside, negative outside -> outward normal is -grad(depth)
    const gx = iceContainmentDepth(x - eps, y, z, meltState) - iceContainmentDepth(x + eps, y, z, meltState);
    const gy = iceContainmentDepth(x, y - eps, z, meltState) - iceContainmentDepth(x, y + eps, z, meltState);
    const gz = iceContainmentDepth(x, y, z - eps, meltState) - iceContainmentDepth(x, y, z + eps, meltState);
    const lenSq = gx * gx + gy * gy + gz * gz;
    if (lenSq > 1e-10) {
      const inv = 1 / Math.sqrt(lenSq);
      out.set(gx * inv, gy * inv, gz * inv);
    } else {
      const sx = Math.abs(x) > 0.02 ? Math.sign(x) : 0;
      const sz = z <= 0.004 ? -1 : 1;
      out.set(sx * 0.35, 0, sz).normalize();
    }
    return out;
  }

  /**
   * Exact 3D signed distance & outward normal to the birch wooden stick (beveled paddle + semicircular top cap).
   * Returns positive distance outside the stick, negative inside.
   */
  const STICK_HALF_W = POPSICLE.stickEdgeX;
  const STICK_HALF_D = POPSICLE.stickDepth * 0.5 + POPSICLE.stickBevelThickness;
  const STICK_ARCH_Y = POPSICLE.stickTopY - STICK_HALF_W;

  function sampleStickSDF(x: number, y: number, z: number, outN: THREE.Vector3): number {
    if (y > STICK_ARCH_Y) {
      // Semicircular rounded top cap (cylinder in XY, slab in Z)
      const dy = y - STICK_ARCH_Y;
      const rXY = Math.hypot(x, dy);
      const dXY = rXY - STICK_HALF_W;
      const dZ = Math.abs(z) - STICK_HALF_D;
      if (dXY > 0 || dZ > 0) {
        const ox = Math.max(0, dXY);
        const oz = Math.max(0, dZ);
        const dist = Math.hypot(ox, oz);
        const rx = rXY > 1e-5 ? x / rXY : 0;
        const ry = rXY > 1e-5 ? dy / rXY : 1;
        const sz = z >= 0 ? 1 : -1;
        if (dist > 1e-6) {
          outN.set((ox * rx) / dist, (ox * ry) / dist, (oz * sz) / dist);
        } else {
          outN.set(0, 1, 0);
        }
        return dist;
      }
      // Inside cap
      if (dZ > dXY) {
        outN.set(0, 0, z >= 0 ? 1 : -1);
        return dZ;
      }
      const invR = rXY > 1e-5 ? 1 / rXY : 0;
      outN.set(x * invR, dy * invR || 1, 0);
      return dXY;
    }

    // Rectangular beveled shaft (y <= STICK_ARCH_Y)
    const yClamped = clamp(y, POPSICLE.stickBottomY, STICK_ARCH_Y);
    const dx = Math.abs(x) - STICK_HALF_W;
    const dy = Math.abs(y - yClamped);
    const dz = Math.abs(z) - STICK_HALF_D;
    if (dx > 0 || dy > 0 || dz > 0) {
      const ox = Math.max(0, dx);
      const oy = Math.max(0, dy);
      const oz = Math.max(0, dz);
      const dist = Math.hypot(ox, oy, oz);
      if (dist > 1e-6) {
        outN.set(
          (ox * (x >= 0 ? 1 : -1)) / dist,
          (oy * (y >= yClamped ? 1 : -1)) / dist,
          (oz * (z >= 0 ? 1 : -1)) / dist,
        );
      } else {
        outN.set(0, 0, z >= 0 ? 1 : -1);
      }
      return dist;
    }
    // Inside shaft: push out along nearest face
    if (dz >= dx) {
      outN.set(0, 0, z >= 0 ? 1 : -1);
      return dz;
    }
    outN.set(x >= 0 ? 1 : -1, 0, 0);
    return dx;
  }

  /**
   * Physical mechanical ice-grip remaining around a fruit (>0 = gripped by ice, <=0 = slips free under gravity).
   * Evaluates 3D containment, lateral side-wall support (so slices/berries never dangle halfway out in mid-air),
   * front/back Z-slab thickness & face clearance (so plump berries release once the ice thins too far, without
   * false-loosening fresh or shallow coconut-base fruits while the popsicle is still thick & frozen),
   * bottom-lip undercut support, and domino knock-loose impulses from falling upper berries.
   */
  function evaluateFruitGrip(f: FruitItem, meltState: MeltFieldState, slideY = 0): number {
    const info = sampleIceContainment(f.basePos.x, f.basePos.y + slideY, f.basePos.z, meltState, physContInfo);
    const endgameBoost = smoothstep(0.60, 0.84, meltState.melt) * 0.06;
    const rZ = fruitCollisionRadius(f);
    const halfD = info.dz + Math.abs(f.basePos.z);
    const rawGrip = Math.min(
      info.depth - (f.radius * 0.20 + endgameBoost),
      info.dx - (f.radius * 0.54 + endgameBoost * 0.8),
      halfD - (rZ * 0.74 + endgameBoost * 0.7),
      info.dz - (rZ * 0.32 + endgameBoost * 0.5),
      info.dyBot - (f.radius * 0.36 + endgameBoost * 0.5),
    );
    return rawGrip - f.knockAccum;
  }

  function applyPreReleasePose(f: FruitItem, grip: number, slideY = 0) {
    const gripFull = Math.max(0.045, f.radius * 0.48);
    f.exposure = clamp(1.0 - smoothstep(0.0, gripFull, grip), 0, 1);
    const sagRaw = smoothstep(GRAB_EXPOSURE_MIN, 1.0, f.exposure);
    // Cubic-quadratic hybrid creep: firm while deeply frozen, noticeably yielding & tipping right before slipping free
    const sag = sagRaw * sagRaw * (0.65 + 0.35 * sagRaw);
    const sideSign = Math.abs(f.basePos.x) > 0.03 ? Math.sign(f.basePos.x) : 1;
    const zOutSign = f.basePos.z <= 0.004 ? -1 : 1;
    const isTopDome = f.basePos.y > 0.65;
    const isFlat = FRUIT_PHYSICS[f.kind].isFlat;

    // Flat slices peel top-edge first around their lower wet suction patch; plump berries settle & tip over the cavity lip!
    const peelOutZ = isFlat ? sag * (isTopDome ? 0.032 : 0.022) : sag * (isTopDome ? 0.026 : 0.016);
    const creepDownY = isFlat ? sag * (isTopDome ? 0.016 : 0.050) : sag * (isTopDome ? 0.014 : 0.048);

    f.mesh.position.set(
      f.basePos.x + sideSign * sag * 0.012 + f.jostlePos.x,
      f.basePos.y + slideY - creepDownY + f.jostlePos.y,
      f.basePos.z + zOutSign * peelOutZ + f.jostlePos.z,
    );
    const tipX = zOutSign * sag * (isFlat ? 0.24 : 0.16) + f.jostlePos.z * 2.4;
    const tipZ = -sideSign * sag * (isFlat ? 0.18 : 0.20) - f.jostlePos.x * 2.4;
    sagEuler.set(tipX, 0, tipZ);
    sagQuat.setFromEuler(sagEuler);
    f.mesh.quaternion.copy(f.baseQuat).multiply(sagQuat);
    f.mesh.scale.copy(f.baseScale);

    // Inherent organic slice curl + extra soft-thaw top-peel droop on exposed strawberry slices before slipping free
    const thawSoft = smoothstep(0.18, 1.0, f.exposure);
    const curlDir = f.baseBend.x >= 0 ? 1 : -1;
    f.bendAmt = f.baseBend.x + curlDir * thawSoft * 0.26;
    f.bendVel = 0;
    if (f.bendUniform) {
      f.bendUniform.value.set(
        f.bendAmt,
        f.baseBend.y + thawSoft * 0.16,
        f.baseBend.z - sideSign * thawSoft * 0.16,
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

    // Pass 1: Update still-attached fruits (smooth pre-release peel/jostle + endgame slide) and release seamlessly!
    if (dt === 0 && grabbedIdx >= 0) {
      clearGrabState();
    }
    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      if (dt === 0) {
        f.knockAccum = 0;
        f.jostlePos.set(0, 0, 0);
        f.jostleVel.set(0, 0, 0);
      } else if (!f.detached && !f.grabbed) {
        // Damped tactile recoil spring when an embedded fruit gets bumped by a falling berry above
        const springK = 140.0;
        const dampC = 14.0;
        const jDt = Math.min(0.033, dt);
        f.jostleVel.x += (-f.jostlePos.x * springK - f.jostleVel.x * dampC) * jDt;
        f.jostleVel.y += (-f.jostlePos.y * springK - f.jostleVel.y * dampC) * jDt;
        f.jostleVel.z += (-f.jostlePos.z * springK - f.jostleVel.z * dampC) * jDt;
        f.jostlePos.addScaledVector(f.jostleVel, jDt);
        if (f.jostlePos.lengthSq() > 0.045 * 0.045) {
          f.jostlePos.setLength(0.045);
        }
      }

      const grip = evaluateFruitGrip(f, meltState, slideY);
      const shouldRelease = iceGone || (meltState.melt > 0.14 && grip <= 0);

      if (dt === 0) {
        if (shouldRelease) {
          f.detached = true;
          f.mesh.visible = false;
        } else {
          f.detached = false;
          f.detachTime = 0;
          f.detachOrigin.copy(f.basePos);
          f.cavityDepth = 0;
          f.stickCavity = 0;
          f.wetContact = 0;
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
            f.detachOrigin.copy(f.mesh.position);
            f.cavityDepth = 0;
            f.stickCavity = 0;
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

        // Once ice grip reaches zero, transition seamlessly into 3D wet-slide & rigid-body physics (ZERO pop!)
        if (shouldRelease) {
          f.detached = true;
          f.detachTime = 0;
          f.detachOrigin.copy(f.mesh.position);
          const rCol = fruitCollisionRadius(f);
          const dHere = iceGone
            ? -1.0
            : iceContainmentDepth(f.mesh.position.x, f.mesh.position.y, f.mesh.position.z, meltState);
          // Capture exact birth-pocket nesting depth (ice + stick) so cavity masks eliminate ANY frame-0 outward pop!
          f.cavityDepth = iceGone ? 0 : Math.max(0, dHere + rCol);
          const dStickHere = sampleStickSDF(f.mesh.position.x, f.mesh.position.y, f.mesh.position.z, physStickN);
          f.stickCavity = Math.max(0, rCol - dStickHere);
          f.wetContact = iceGone ? 0 : 1.0;

          // Compute real local surface slope tangent so initial slip glides smoothly down the wet ice face
          sampleIceSurfaceNormal(f.mesh.position.x, f.mesh.position.y, f.mesh.position.z, meltState, physN);
          // Gravity projected onto local tangent plane: t = g_dir - (g_dir · N) N, where g_dir = (0, -1, 0)
          const gn = -physN.y;
          const tx = -gn * physN.x;
          const ty = -1.0 - gn * physN.y;
          const tz = -gn * physN.z;
          const tLen = Math.hypot(tx, ty, tz);
          const slipSpeed = 0.065 + (i % 3) * 0.012;
          if (tLen > 0.05 && !iceGone) {
            f.velocity.set(
              (tx / tLen) * slipSpeed + physN.x * 0.028 + f.jostleVel.x * 0.45,
              (ty / tLen) * slipSpeed + Math.min(0, physN.y * 0.02) + f.jostleVel.y * 0.45,
              (tz / tLen) * slipSpeed + physN.z * 0.032 + f.jostleVel.z * 0.45,
            );
          } else {
            const sideX = Math.abs(f.basePos.x) > 0.04 ? Math.sign(f.basePos.x) : i % 2 === 0 ? 1 : -1;
            const pushZ = f.basePos.z <= 0.004 ? -1 : 1;
            f.velocity.set(sideX * 0.03 + f.jostleVel.x * 0.5, -0.07 + f.jostleVel.y * 0.5, pushZ * 0.03 + f.jostleVel.z * 0.5);
          }

          // Natural rolling torque matching the outward normal & downward slip (ω ∝ N × v)
          physRollAxis.crossVectors(physN, f.velocity);
          const rollScale = FRUIT_PHYSICS[f.kind].rollGain / Math.max(0.06, rCol);
          f.angVel.copy(physRollAxis).multiplyScalar(rollScale * 0.35);
          f.angVel.y += (i % 2 === 0 ? 1 : -1) * 0.14;

          const curlDir = f.baseBend.x >= 0 ? 1 : -1;
          f.bendVel = FRUIT_PHYSICS[f.kind].isFlat ? curlDir * 0.75 : 0.30;
          if (f.thawUniform) f.thawUniform.value = 1.0;
        }
      }
    }

    if (dt <= 0) return;

    // Pass 2: 4-substep 3D Rigid-Body + Wet-Syrup Slide + Stick Bounce + Fruit-to-Fruit Collision + Aerodynamics!
    const substeps = 4;
    const subDt = Math.min(0.05, dt) / substeps;
    const iceHalfWBound = POPSICLE.halfWidthBottom + 0.28;
    const iceHalfDBound = POPSICLE.halfDepth + 0.28;

    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      if (!f.detached || !f.mesh.visible || f.grabbed) continue;
      f.detachTime += dt;
    }

    for (let s = 0; s < substeps; s++) {
      // 2a. Forces, integration, wet-ice SDF sliding/bouncing, wooden stick bounce, and embedded-fruit collisions
      for (let i = 0; i < fruits.length; i++) {
        const f = fruits[i];
        if (!f.detached || !f.mesh.visible || f.grabbed) continue;

        const prof = FRUIT_PHYSICS[f.kind];
        const rCol = fruitCollisionRadius(f);

        // Smooth suction-break ramp over first ~0.12s so detachment feels genuinely syrupy and weighty
        const peelRamp = 0.28 + 0.72 * smoothstep(0.0, 0.12, f.detachTime);
        f.velocity.y -= prof.gravity * peelRamp * subDt;

        // Shape-aware aerodynamics (anisotropic flat-blade lift/flutter on slices + quadratic drag + Magnus curve)
        const speedSq = f.velocity.lengthSq();
        if (speedSq > 1e-6) {
          const speed = Math.sqrt(speedSq);
          if (prof.flatAero > 0.01) {
            // World-space face normal of flat slice / lemon peel (local +Z)
            physFaceN.set(0, 0, 1).applyQuaternion(f.mesh.quaternion);
            const vPerp = f.velocity.dot(physFaceN);
            physVpar.copy(f.velocity).addScaledVector(physFaceN, -vPerp);

            // Strong broadside air resistance vs sleek edgewise slip -> creates authentic leaf/slice glide & flutter!
            const broadDrag = -vPerp * (1.25 + Math.abs(vPerp) * 0.55) * prof.flatAero;
            f.velocity.addScaledVector(physFaceN, broadDrag * subDt);
            f.velocity.addScaledVector(physVpar, -prof.airDragLin * subDt);

            // Aerodynamic pitching torque & rocking stability when falling tilted (center-of-pressure offset)
            physAeroTorque.crossVectors(physFaceN, physVpar);
            const torqueGain = clamp(vPerp * 2.1 * prof.flatAero, -5.5, 5.5);
            f.angVel.addScaledVector(physAeroTorque, torqueGain * subDt);
          } else {
            // Plump spheres & dense chunks: realistic linear + quadratic air drag + subtle Magnus curve from spin
            const dragFactor = Math.exp(-subDt * (prof.airDragLin + prof.airDragQuad * speed));
            f.velocity.multiplyScalar(dragFactor);
            if (prof.magnus > 0 && f.angVel.lengthSq() > 0.04) {
              physMagnus.crossVectors(f.angVel, f.velocity);
              f.velocity.addScaledVector(physMagnus, prof.magnus * subDt);
            }
          }
        }

        // Advance linear position
        f.mesh.position.addScaledVector(f.velocity, subDt);

        // --- CONTACT 1: Live 3D Melting Ice Surface (Birth-Cavity Mask + Capillary Wet Slide + Bounce + Rolling) ---
        let touchingIce = false;
        if (!iceGone) {
          const px = f.mesh.position.x;
          const py = f.mesh.position.y;
          const pz = f.mesh.position.z;
          if (
            py > yBotLive - rCol - 0.14 &&
            py < yTopLive + rCol + 0.14 &&
            Math.abs(px) < iceHalfWBound + rCol &&
            Math.abs(pz) < iceHalfDBound + rCol
          ) {
            const dIce = iceContainmentDepth(px, py, pz, meltState);
            // Smoothly fade out the molded birth cavity as the fruit slides clear of its original pocket!
            let effCavity = 0;
            if (f.cavityDepth > 1e-4) {
              const distFromOriginSq = f.mesh.position.distanceToSquared(f.detachOrigin);
              const cavRange = Math.max(0.08, f.radius * 1.05);
              effCavity = f.cavityDepth * Math.exp(-distFromOriginSq / (cavRange * cavRange));
              if (effCavity < 0.002) {
                f.cavityDepth = 0;
                effCavity = 0;
              }
            }
            // signedDistOut > 0 means surface of fruit is outside ice; < 0 means penetrating ice
            const signedDistOut = -(dIce + rCol - effCavity);
            const adhesionBand = 0.058 * prof.adhesion;

            if (signedDistOut < adhesionBand) {
              sampleIceSurfaceNormal(px, py, pz, meltState, physN);
              const vn = f.velocity.dot(physN);
              physVt.copy(f.velocity).addScaledVector(physN, -vn);
              const vtLen = physVt.length();

              if (signedDistOut < 0) {
                touchingIce = true;
                const pen = -signedDistOut;

                // Soft Baumgarte position projection keeps fruit outside the curved ice hull with zero jitter
                const pushFrac = f.cavityDepth > 0.002 ? 0.32 : 0.68;
                f.mesh.position.addScaledVector(physN, Math.min(pen * pushFrac, 0.06));

                // Normal bounce impulse when moving into the wet ice
                if (vn < 0) {
                  const impactSpeed = -vn;
                  const rest = impactSpeed > 0.35 ? prof.restitution : 0.0;
                  const jn = -(1.0 + rest) * vn;
                  f.velocity.addScaledVector(physN, jn);

                  // Impact squash / soft slice slap flex!
                  if (impactSpeed > 0.45) {
                    const curlDir = f.baseBend.x >= 0 ? 1 : -1;
                    f.bendVel += clamp(impactSpeed * 0.95, 0, 2.8) * prof.flexGain * (prof.isFlat ? curlDir : 1);
                  }
                }

                // Wet-ice shear drag & true no-slip rolling torque (ω += (N × v_t) / r)
                const wetFriction = Math.exp(-subDt * prof.wetDrag * (0.75 + 0.5 * clamp(pen / Math.max(0.02, rCol), 0, 1)));
                physVt.multiplyScalar(wetFriction);
                const newVn = f.velocity.dot(physN);
                f.velocity.copy(physVt).addScaledVector(physN, newVn);

                if (vtLen > 0.015) {
                  // Target rolling angular velocity along the wet ice surface: ω_roll = (N × v_t) / r
                  physRollAxis.crossVectors(physN, physVt).divideScalar(Math.max(0.055, rCol));
                  const rollAlpha = 1.0 - Math.exp(-subDt * 12.0 * prof.rollGain);
                  f.angVel.lerp(physRollAxis, rollAlpha);
                }
              }

              // Capillary syrup surface-tension hug: briefly holds sliding berries onto slick wet ice (~0.15-0.35s)
              // until gravity shear, speed, or curvature cleanly snaps suction and launches them into free fall!
              const overhangRelease = smoothstep(-0.18, 0.28, physN.y + 0.14);
              const speedBreak = 1.0 - smoothstep(0.65, 1.55, vtLen);
              const shearBreak = 1.0 - smoothstep(0.18, 0.46, f.detachTime);
              const peelStrength =
                overhangRelease * speedBreak * shearBreak * (1.0 - smoothstep(0.0, adhesionBand, Math.max(0, signedDistOut)));
              if (peelStrength > 0.01 && vn < 0.45) {
                touchingIce = true;
                const suctionAccel = prof.adhesion * 3.0 * peelStrength;
                f.velocity.addScaledVector(physN, -suctionAccel * subDt);
                // Mild watery syrup boundary shear
                f.velocity.addScaledVector(physVt, -prof.wetDrag * 0.28 * peelStrength * subDt);
                // Gently align flat slices tangent to the wet face only during the initial peel glide
                if (prof.isFlat && f.detachTime < 0.30) {
                  physFaceN.set(0, 0, 1).applyQuaternion(f.mesh.quaternion);
                  const alignDot = physFaceN.dot(physN);
                  if (alignDot < 0) physFaceN.negate();
                  physAeroTorque.crossVectors(physFaceN, physN);
                  f.angVel.addScaledVector(physAeroTorque, 4.2 * peelStrength * subDt);
                }
              }
            }
          }
        }
        f.wetContact += ((touchingIce ? 1 : 0) - f.wetContact) * Math.min(1, subDt * 14.0);

        // --- CONTACT 2: Birch Wooden Stick Collision (Crisp Clack-Bounce & Deflection Spin!) ---
        {
          const px = f.mesh.position.x;
          const py = f.mesh.position.y;
          const pz = f.mesh.position.z;
          if (
            py < POPSICLE.stickTopY + rCol + 0.05 &&
            py > POPSICLE.stickBottomY - rCol &&
            Math.abs(px) < STICK_HALF_W + rCol + 0.04 &&
            Math.abs(pz) < STICK_HALF_D + rCol + 0.04
          ) {
            const dStick = sampleStickSDF(px, py, pz, physStickN);
            let effStickCavity = 0;
            if (f.stickCavity > 1e-4) {
              const distFromOriginSq = f.mesh.position.distanceToSquared(f.detachOrigin);
              const stickRange = Math.max(0.07, f.radius * 0.9);
              effStickCavity = f.stickCavity * Math.exp(-distFromOriginSq / (stickRange * stickRange));
              if (effStickCavity < 0.002) {
                f.stickCavity = 0;
                effStickCavity = 0;
              }
            }
            const pen = rCol - effStickCavity - dStick;
            if (pen > 0) {
              const pushFrac = f.stickCavity > 0.002 ? 0.28 : 0.82;
              f.mesh.position.addScaledVector(physStickN, Math.min(pen * pushFrac, 0.06));
              const vn = f.velocity.dot(physStickN);
              if (vn < 0) {
                const impactSpeed = -vn;
                // Firm birch wood gives a livelier, crisper deflection than slushy wet ice!
                const woodRest = clamp(prof.restitution + 0.14, 0.16, 0.54);
                const jn = -(1.0 + woodRest) * vn;
                f.velocity.addScaledVector(physStickN, jn);

                // Tangential stick friction + rolling deflection spin
                physVt.copy(f.velocity).addScaledVector(physStickN, -f.velocity.dot(physStickN));
                const woodFriction = 0.22;
                const jtScale = Math.min(woodFriction * jn, physVt.length());
                if (physVt.lengthSq() > 1e-6) {
                  physVt.normalize();
                  f.velocity.addScaledVector(physVt, -jtScale);
                  physRollAxis.crossVectors(physStickN, physVt);
                  f.angVel.addScaledVector(physRollAxis, (jtScale / Math.max(0.05, rCol)) * 0.95);
                }

                // Tactile bounce squish/flex on stick impact!
                if (impactSpeed > 0.30) {
                  const curlDir = f.baseBend.x >= 0 ? 1 : -1;
                  f.bendVel += clamp(impactSpeed * 1.25, 0, 3.4) * prof.flexGain * (prof.isFlat ? curlDir : 1);
                }
              }
            }
          }
        }

        // --- CONTACT 3: Falling Fruit ↔ Protruding Embedded Fruits (Deflect, Wobble & Domino Knock-Loose!) ---
        for (let j = 0; j < fruits.length; j++) {
          if (j === i) continue;
          const other = fruits[j];
          if (other.detached || !other.mesh.visible || other.grabbed) continue;
          // Only collide with embedded fruits protruding near/outside the melting surface
          if (other.exposure < 0.06 && !iceGone) continue;

          const rOther = fruitCollisionRadius(other);
          const minDist = rCol + rOther;
          physRelPos.subVectors(f.mesh.position, other.mesh.position);
          const distSq = physRelPos.lengthSq();
          if (distSq >= minDist * minDist || distSq < 1e-9) continue;

          // Avoid artificial kick if two fruits started closely packed on the very first instant of release
          if (f.detachTime < 0.05 && f.detachOrigin.distanceToSquared(other.mesh.position) < minDist * minDist * 1.05) {
            continue;
          }

          const dist = Math.sqrt(distSq);
          physN.copy(physRelPos).divideScalar(dist);
          const pen = minDist - dist;
          f.mesh.position.addScaledVector(physN, Math.min(pen * 0.78, 0.06));

          const vn = f.velocity.dot(physN);
          if (vn < 0) {
            const impactSpeed = -vn;
            const avgRest = 0.5 * (prof.restitution + FRUIT_PHYSICS[other.kind].restitution);
            const jn = -(1.0 + avgRest) * vn;
            f.velocity.addScaledVector(physN, jn);

            // Tangential roll deflection around the protruding lower berry
            physVt.copy(f.velocity).addScaledVector(physN, -f.velocity.dot(physN));
            if (physVt.lengthSq() > 1e-6) {
              const vtMag = physVt.length();
              const slipLoss = Math.min(0.28 * jn, vtMag * 0.55);
              physVt.divideScalar(vtMag);
              f.velocity.addScaledVector(physVt, -slipLoss);
              physRollAxis.crossVectors(physN, physVt);
              f.angVel.addScaledVector(physRollAxis, (slipLoss / Math.max(0.05, rCol)) * 1.1);
            }

            // Impart tactile recoil wobble to the bumped embedded berry — and knock it loose if nearly free!
            const massRatio = clamp(f.mass / Math.max(0.001, other.mass), 0.3, 2.2);
            const jostleImpulse = clamp(impactSpeed * 0.14 * massRatio, 0, 0.42);
            other.jostleVel.addScaledVector(physN, -jostleImpulse);
            other.jostleVel.y -= jostleImpulse * 0.45;
            if (other.exposure > 0.65 && impactSpeed > 0.55) {
              other.knockAccum += clamp((impactSpeed - 0.45) * 0.022 * massRatio * other.exposure, 0, 0.06);
            }

            // Soft juicy squish on the bouncing falling fruit
            if (impactSpeed > 0.30) {
              const curlDir = f.baseBend.x >= 0 ? 1 : -1;
              f.bendVel += clamp(impactSpeed * 1.15, 0, 3.2) * prof.flexGain * (prof.isFlat ? curlDir : 1);
            }
          }
        }

        // Clamp speeds & integrate angular velocity cleanly
        const maxSpeed = 13.5;
        if (f.velocity.lengthSq() > maxSpeed * maxSpeed) {
          f.velocity.setLength(maxSpeed);
        }
        f.angVel.multiplyScalar(Math.exp(-subDt * prof.angDrag));
        if (f.angVel.lengthSq() > prof.maxSpin * prof.maxSpin) {
          f.angVel.setLength(prof.maxSpin);
        }
        const wMag = f.angVel.length();
        if (wMag > 1e-4) {
          spinAxis.copy(f.angVel).divideScalar(wMag);
          spinQuat.setFromAxisAngle(spinAxis, wMag * subDt);
          f.mesh.quaternion.premultiply(spinQuat);
          f.mesh.quaternion.normalize();
        }
      }

      // 2b. Pairwise Falling ↔ Falling 3D Rigid-Body Collisions (mass-weighted impulse + spin transfer!)
      for (let i = 0; i < fruits.length; i++) {
        const a = fruits[i];
        if (!a.detached || !a.mesh.visible || a.grabbed) continue;
        const rA = fruitCollisionRadius(a);
        const invMA = 1.0 / a.mass;

        for (let j = i + 1; j < fruits.length; j++) {
          const b = fruits[j];
          if (!b.detached || !b.mesh.visible || b.grabbed) continue;
          const rB = fruitCollisionRadius(b);
          const minDist = rA + rB;
          physRelPos.subVectors(b.mesh.position, a.mesh.position);
          const distSq = physRelPos.lengthSq();
          if (distSq >= minDist * minDist || distSq < 1e-9) continue;

          const dist = Math.sqrt(distSq);
          physN.copy(physRelPos).divideScalar(dist); // points A -> B
          const pen = minDist - dist;
          const invMB = 1.0 / b.mass;
          const invSum = invMA + invMB;

          // Mass-weighted separation
          const sep = Math.min(pen * 0.72, 0.06) / invSum;
          a.mesh.position.addScaledVector(physN, -sep * invMA);
          b.mesh.position.addScaledVector(physN, sep * invMB);

          // Relative velocity of B w.r.t A
          physRelVel.subVectors(b.velocity, a.velocity);
          const vn = physRelVel.dot(physN);
          if (vn < 0) {
            const profA = FRUIT_PHYSICS[a.kind];
            const profB = FRUIT_PHYSICS[b.kind];
            const e = 0.5 * (profA.restitution + profB.restitution);
            const jn = (-(1.0 + e) * vn) / invSum;
            a.velocity.addScaledVector(physN, -jn * invMA);
            b.velocity.addScaledVector(physN, jn * invMB);

            // Tangential spin exchange
            physVt.copy(physRelVel).addScaledVector(physN, -vn);
            const vtMag = physVt.length();
            if (vtMag > 1e-4) {
              physVt.divideScalar(vtMag);
              const jt = Math.min(0.24 * jn, (vtMag * 0.45) / invSum);
              a.velocity.addScaledVector(physVt, jt * invMA);
              b.velocity.addScaledVector(physVt, -jt * invMB);
              physRollAxis.crossVectors(physN, physVt);
              a.angVel.addScaledVector(physRollAxis, (jt * invMA) / Math.max(0.05, rA));
              b.angVel.addScaledVector(physRollAxis, (jt * invMB) / Math.max(0.05, rB));
            }

            const impactSpeed = -vn;
            if (impactSpeed > 0.30) {
              const dirA = a.baseBend.x >= 0 ? 1 : -1;
              const dirB = b.baseBend.x >= 0 ? 1 : -1;
              a.bendVel += clamp(impactSpeed * 0.9, 0, 2.8) * profA.flexGain * (profA.isFlat ? dirA : 1);
              b.bendVel += clamp(impactSpeed * 0.9, 0, 2.8) * profB.flexGain * (profB.isFlat ? dirB : 1);
            }
          }
        }
      }
    }

    // Pass 3: Soft damped spring deformation (airflow cupping + impact squish) & clean out-of-frame despawn
    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      if (!f.detached || !f.mesh.visible || f.grabbed) continue;

      const prof = FRUIT_PHYSICS[f.kind];
      const sideX = Math.abs(f.basePos.x) > 0.04 ? Math.sign(f.basePos.x) : i % 2 === 0 ? 1 : -1;
      const curlDir = f.baseBend.x >= 0 ? 1 : -1;

      let aeroCup = 0;
      if (prof.isFlat) {
        physFaceN.set(0, 0, 1).applyQuaternion(f.mesh.quaternion);
        aeroCup = clamp(-f.velocity.dot(physFaceN) * 0.085, -0.22, 0.22);
      }

      const restBend = prof.isFlat
        ? f.baseBend.x + curlDir * 0.14 + aeroCup + 0.05 * Math.sin(f.detachTime * 8.2 + f.bendPhase)
        : 0.0;
      const springF = (restBend - f.bendAmt) * 28.0 - f.bendVel * 5.2;
      f.bendVel += springF * dt;
      f.bendAmt = clamp(f.bendAmt + f.bendVel * dt, -0.56, 0.58);

      if (f.bendUniform) {
        const flutter = Math.sin(f.detachTime * 7.4 + f.bendPhase) * 0.075 + aeroCup * 0.45;
        f.bendUniform.value.set(f.bendAmt, f.baseBend.y + flutter, f.baseBend.z - sideX * Math.abs(f.bendAmt) * 0.30);
      } else {
        // Subtle juicy volume-preserving squash-and-stretch on impacts!
        const sq = clamp(f.bendAmt * 0.22, -0.09, 0.09);
        f.mesh.scale.set(
          f.baseScale.x * (1 + sq * 0.55),
          f.baseScale.y * (1 - sq),
          f.baseScale.z * (1 + sq * 0.55),
        );
      }

      // Despawn cleanly once well below camera frustum (extra lifetime accommodates wet-ice slide + stick bounce!)
      if (f.mesh.position.y < -5.2 || f.detachTime > 5.0) {
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
        f.cavityDepth = 0;
        f.stickCavity = 0;
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
      f.cavityDepth = 0;
      f.stickCavity = 0;
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
      if (f.detached && f.mesh.visible && (f.grabbed || (f.mesh.position.y > -1.95 && f.detachTime < 3.6))) {
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
