import * as THREE from 'three';
import { clamp, fbm3, mulberry32, smoothstep } from './rng';
import {
  baseHalfWidthAt,
  evaluatePopsicleVertex,
  ExactIceSurfaceInfo,
  getMeltBounds,
  iceContainmentDepth,
  MeltFieldState,
  POPSICLE,
  prepareProfileFrame,
  prepareProfileRow,
  ProfileFrameCache,
  ProfileRowCache,
  sampleExactIceSurface,
  sampleIceContainment,
  sampleLocalHeat,
} from './shape';
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
  /** Initial frozen seat offset so shallow milk-mode inlays stay firmly embedded until actually melted loose */
  seatOffset: number;
  /** True while a small light bit is clinging to & gliding down the viscous melt flow instead of free-falling */
  flowRiding: boolean;
  /** Elapsed seconds spent riding the melt flow (separate from free-fall detachTime so riding bits never vanish!) */
  flowTime: number;
  /** Per-piece deterministic meander phase for organic rivulet paths along the melting surface */
  flowPhase: number;
  /** Per-piece capillary stickiness [0..1] staggering release clearance, startup lag & stick-slip hesitation */
  flowStickiness: number;
  /** Per-piece natural melt-flow speed personality (slow syrupy creepers to slick rivulet riders) */
  flowSpeedBias: number;
  /** Exact frozen signed protrusion outside the rendered ice surface at melt=0 */
  baseSignedOut0: number;
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

/**
 * Shared live side-back lighting & translucency exaggeration uniforms for all raspberries
 * (both inside/protruding from the popsicle and floating in the Topping Debug Studio).
 */
export const RASPBERRY_LIGHT_UNIFORMS = {
  /** World-space unit direction pointing TOWARD the dominant grazing side-back key light */
  uSideLightDir: { value: new THREE.Vector3(-0.88, 0.22, -0.42).normalize() },
  /** Exaggerated side-lit translucency gain (tunable live in local-dev Topping Debug view) */
  uTransBoost: { value: 1.45 },
};

export type ToppingDebugMode = 'off' | 'outside' | 'both' | 'inside';
export type ToppingDebugFilter = 'all' | ToppingId;

export interface ToppingDebugStage {
  group: THREE.Group;
  setLayout(mode: ToppingDebugMode, filter: ToppingDebugFilter, floatAirRaspberry: boolean): void;
  update(dt: number, spin: boolean): void;
  dispose(): void;
}

export interface FruitAssembly {
  /** Group containing all interior solid fruits + wooden stick */
  group: THREE.Group;
  /** Group containing superficial surface-only toppings (e.g. Tajín) rendered post-ice with hardware depth test */
  surfaceGroup: THREE.Group;
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
 * Generates a plump, sculpted 3D blueberry with natural slightly oblate roundness,
 * subtle organic lumpiness, and a recessed 5-pointed star calyx crown at the +Y pole.
 */
function createBlueberryGeometry(seed: number, variant = 0): THREE.BufferGeometry {
  const rand = mulberry32(seed + variant * 151);
  const off = rand() * 40;
  const starPhase = rand() * Math.PI * 2;
  const oblate = 0.85 + rand() * 0.08;
  const latSpreadX = 0.96 + rand() * 0.07;
  const latSpreadZ = 0.96 + rand() * 0.07;

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

    const lump = 1.0 + (fbm3(vx * 2.6 + off, vy * 2.6, vz * 2.6, 3) - 0.5) * 0.08;

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

    const x = vx * rMod * latSpreadX;
    const y = vy * oblate * rMod + yLift;
    const z = vz * rMod * latSpreadZ;

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
  shape.absarc(0, botY + r, r, Math.PI, Math.PI * 2, false);
  shape.lineTo(hw, topY - r);
  shape.absarc(0, topY - r, r, 0, Math.PI, false);
  shape.closePath();

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
  uThaw: { value: number };
} {
  const uBend = { value: new THREE.Vector3(0, 0, 0) };
  const uThaw = { value: 0.0 };
  const material = new THREE.MeshPhysicalMaterial({
    map: textures.albedo,
    bumpMap: textures.bump,
    bumpScale: 0.016,
    // Fresh natural matte-satin cut berry flesh when dry; turns glossier only as watery melt coats it!
    roughness: 0.56,
    metalness: 0.0,
    clearcoat: 0.16,
    clearcoatRoughness: 0.36,
    specularIntensity: 0.38,
    envMapIntensity: 0.24,
  });

  material.customProgramCacheKey = () => 'strawberry-softbend-v2';

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTranslucencyMap = { value: textures.translucency };
    shader.uniforms.uBacklightDir = { value: new THREE.Vector3(0.0, 0.08, -1.0).normalize() };
    shader.uniforms.uBend = uBend;
    shader.uniforms.uThaw = uThaw;

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
        uniform float uThaw;
        varying vec2 vBerryUv;
        varying vec3 vBerryWorldNormal;
        varying vec3 vBerryWorldPos;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.22, clamp(uThaw, 0.0, 1.0) * 0.72);`,
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

  return { material, uBend, uThaw };
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
    // Predominantly velvety powdery-matte dusty-blue bloom when dry; transitions to watery sheen only as uThaw rises!
    roughness: 0.90,
    metalness: 0.0,
    clearcoat: 0.0,
    specularIntensity: 0.16,
    envMapIntensity: 0.06,
  });

  material.customProgramCacheKey = () => 'blueberry-wetthaw-v5';

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
          // Wetting uncovered blueberry skin deepens & saturates its indigo skin while keeping subtle dusty-blue bloom
          vec3 wetRich = pow(max(diffuseColor.rgb, vec3(0.0001)), vec3(1.16)) * vec3(0.68, 0.74, 0.92);
          diffuseColor.rgb = mix(diffuseColor.rgb, wetRich, clamp(uThaw, 0.0, 1.0) * 0.58);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // Dry berry stays softly matte-powdery; watery meltwater fills the waxy bloom and turns skin glossier!
        roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.28), clamp(uThaw, 0.0, 1.0) * 0.76);`,
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
          reflectedLight.indirectSpecular *= mix(0.06, 0.65, rimMask);
          reflectedLight.directSpecular *= mix(0.08, 0.85, rimMask);
          reflectedLight.indirectDiffuse *= mix(0.72, 1.0, smoothstep(0.04, 0.45, ndv));

          // Watery wet catchlights appear ONLY when meltwater coats the emerging berry (zero shiny blobs when dry!)
          float wetGloss = thaw * thaw;
          if (wetGloss > 0.01) {
            vec3 lA = normalize(vec3(-0.52, 0.54, 0.66));
            vec3 lB = normalize(vec3(0.56, 0.38, 0.73));
            vec3 hA = lA + vDir;
            hA *= inversesqrt(max(dot(hA, hA), 1e-8));
            vec3 hB = lB + vDir;
            hB *= inversesqrt(max(dot(hB, hB), 1e-8));
            float spA = pow(max(dot(nDir, hA), 0.0), 140.0);
            float spB = pow(max(dot(nDir, hB), 0.0), 105.0);
            reflectedLight.directSpecular += vec3(1.18, 1.24, 1.38) * (spA * 0.65 + spB * 0.34) * wetGloss;
          }
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
  const drupCrevices: number[] = [];
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
        drupCrevices.push(1.0);
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

  const segU = 12;
  const segV = 8;

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
        let lx = cx + nx0 * r * locSqX * squish;
        const ly = cy + ny0 * r * locSqY * squish;
        let lz = cz + nz0 * r * locSqZ * squish;

        let isCutFace = false;
        const cutZ = 0.055 * squashZ;
        if (cutHalfPlane && lz > cutZ) {
          lz = cutZ + (lz - cutZ) * 0.14;
          isCutFace = true;
        }
        // Keep outer drupelets cleanly wrapped around the soft recessed hollow cavity on halved/quartered berries
        if (cutHalfPlane) {
          const tCup = clamp((0.50 * squashY - ly) / (1.02 * squashY), 0, 1);
          const cupRMin = 0.34 * Math.pow(Math.max(0.02, 1.0 - tCup * tCup * 0.92), 0.62);
          const ux = lx / squashX;
          const uz = (lz - 0.02 * squashZ) / (squashZ * 0.88);
          const rHoriz = Math.hypot(ux, uz);
          if (rHoriz < cupRMin && ly > -0.54 * squashY && ly < 0.54 * squashY) {
            const pushR = cupRMin + 0.01;
            if (rHoriz > 1e-4) {
              lx = (ux / rHoriz) * pushR * squashX;
              lz = (uz / rHoriz) * pushR * squashZ * 0.88 + 0.02 * squashZ;
            } else {
              lz = -pushR * squashZ * 0.88 + 0.02 * squashZ;
            }
          }
        }

        positions.push(lx, ly, lz);

        let nx = isCutFace ? nx0 * 0.25 : nx0 / locSqX;
        let ny = isCutFace ? ny0 * 0.25 : ny0 / locSqY;
        let nz = isCutFace ? 0.94 : nz0 / locSqZ;
        const nLen = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / nLen, ny / nLen, nz / nLen);
        uvs.push(iu / segU, iv / segV);

        // Rich crevice AO between packed drupelets; on halved/quartered berries keep hollow inner backs warm velvet crimson (never pitch black!)
        const outDot = clamp((lx * nx0 + ly * ny0 + lz * nz0) / Math.max(0.15, Math.hypot(lx, ly, lz)), 0, 1);
        const shade = isCutFace
          ? clamp(0.84 + 0.16 * rand(), 0.72, 1.04)
          : cutHalfPlane
            ? clamp(ao * (0.50 + 0.56 * Math.pow(outDot, 0.82)), 0.42, 1.06)
            : clamp(ao * (0.30 + 0.78 * Math.pow(outDot, 0.88)), 0.20, 1.06);
        const rr = isCutFace ? Math.min(1, srgbCol[0] * 1.12 + 0.07) : srgbCol[0];
        const gg = isCutFace ? Math.min(1, srgbCol[1] * 1.30 + 0.08) : srgbCol[1];
        const bb = isCutFace ? Math.min(1, srgbCol[2] * 1.15 + 0.08) : srgbCol[2];
        colors.push(srgbToLin(rr * shade), srgbToLin(gg * shade * 0.95), srgbToLin(bb * shade * 0.96));
        hairFlags.push(0.0);
        // Crevice exposure [0=deep core/gap between drupelets, 1=outer protruding drupelet dome]
        const rawCrevice = isCutFace
          ? 0.88
          : clamp(ao * smoothstep(-0.18, 0.82, outDot), 0.0, 1.0);
        const crevice = cutHalfPlane ? Math.max(0.42, rawCrevice) : rawCrevice;
        drupCrevices.push(crevice);
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
      // Soft pillowed inner drupelet-back lining inside the hollow cavity (organic berry cup, zero hard geometric cone!)
      const cupRows = [
        { y: 0.32, r: 0.28, dr: 0.21, n: isQuarter ? 2 : 4 },
        { y: -0.04, r: 0.30, dr: 0.22, n: isQuarter ? 2 : 4 },
        { y: -0.38, r: 0.20, dr: 0.20, n: isQuarter ? 1 : 3 },
      ];
      for (const cr of cupRows) {
        for (let k = 0; k < cr.n; k++) {
          const frac = cr.n === 1 ? 0.5 : k / (cr.n - 1);
          const ang = isQuarter
            ? Math.PI + 0.22 + frac * Math.PI * 0.42
            : Math.PI + 0.24 + frac * (Math.PI - 0.48);
          addDrupelet(
            Math.cos(ang) * cr.r,
            cr.y,
            Math.sin(ang) * cr.r - 0.04,
            cr.dr,
            0.78,
            [0.64, 0.14, 0.20],
            false,
            true,
          );
        }
      }
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

  // Per-vertex translucency weight (aDrupThin) & normalized local berry position (aBerryPos)
  // so the fragment shader knows exact side-light entry, cross-berry thickness, and outer drupelet domes!
  const vCountTotal = positions.length / 3;
  const drupThin = new Float32Array(vCountTotal);
  const berryPos = new Float32Array(vCountTotal * 3);
  const fragThinBase = isLooseBall ? 1.0 : isSmallBit ? 0.94 : isQuarter ? 0.86 : isHalved ? 0.78 : isSquashed ? 0.68 : 0.60;
  for (let i = 0; i < vCountTotal; i++) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];
    const rad = Math.min(1.0, Math.hypot(px, py, pz));
    berryPos[i * 3] = px;
    berryPos[i * 3 + 1] = py;
    berryPos[i * 3 + 2] = pz;
    drupThin[i] = clamp(fragThinBase * (0.42 + 0.58 * rad), 0.18, 1.0);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aHair', new THREE.Float32BufferAttribute(hairFlags, 1));
  geo.setAttribute('aDrupThin', new THREE.Float32BufferAttribute(drupThin, 1));
  geo.setAttribute('aDrupCrevice', new THREE.Float32BufferAttribute(drupCrevices, 1));
  geo.setAttribute('aBerryPos', new THREE.Float32BufferAttribute(berryPos, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * Generates a smooth, plump rounded dark-chocolate chip / pearl / button drop
 * with gentle organic tempered-cocoa contours (no harsh jagged flat cuts).
 */
function createChocolateChunkGeometry(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed * 101 + 37);
  const geo = new THREE.SphereGeometry(1.0, 22, 16);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  const off = rand() * 25;
  // Mix of classic rounded chocolate pearls/pebbles and softly flattened chocolate button drops!
  const isDropButton = rand() < 0.55;
  const sx = 0.94 + rand() * 0.16;
  const sy = isDropButton ? 0.78 + rand() * 0.16 : 0.90 + rand() * 0.18;
  const sz = 0.88 + rand() * 0.16;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    if (isDropButton) {
      // Gently rounded domed button / chocolate chip drop (softly flattened underside, plump rounded crown)
      if (y < 0) {
        y *= 0.68;
      } else {
        const tipTaper = 1.0 - 0.18 * y * y;
        x *= tipTaper;
        z *= tipTaper;
      }
    }
    const organic = 1.0 + (fbm3(x * 2.6 + off, y * 2.6, z * 2.6, 2) - 0.5) * 0.08;
    pos.setXYZ(i, x * sx * organic, y * sy * organic, z * sz * organic);
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

function createRaspberryMaterial(
  tex: ToppingTextureSet,
  initialThaw = 0.0,
): {
  material: THREE.MeshPhysicalMaterial;
  uThaw: { value: number };
} {
  const uThaw = { value: initialThaw };
  const material = new THREE.MeshPhysicalMaterial({
    map: tex.albedo,
    bumpMap: tex.bump,
    bumpScale: 0.024,
    roughnessMap: tex.roughness,
    // Velvety downy berry skin when dry; watery melt gloss builds smoothly with uThaw
    roughness: 0.70,
    metalness: 0.0,
    clearcoat: 0.0,
    specularIntensity: 0.22,
    vertexColors: true,
    envMapIntensity: 0.05,
  });
  material.customProgramCacheKey = () => 'raspberry-sideglass-v8';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uThaw = uThaw;
    shader.uniforms.uSideLightDir = RASPBERRY_LIGHT_UNIFORMS.uSideLightDir;
    shader.uniforms.uTransBoost = RASPBERRY_LIGHT_UNIFORMS.uTransBoost;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aHair;
        attribute float aDrupThin;
        attribute float aDrupCrevice;
        attribute vec3 aBerryPos;
        varying vec3 vRaspWorldPos;
        varying vec3 vRaspWorldNormal;
        varying vec3 vBerryWorldDir;
        varying float vBerryRad;
        varying float vHair;
        varying float vDrupThin;
        varying float vCrevice;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vRaspWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRaspWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        vBerryRad = clamp(length(aBerryPos), 0.0, 1.0);
        vec3 bDirObj = aBerryPos / max(length(aBerryPos), 1e-4);
        vBerryWorldDir = normalize(mat3(modelMatrix) * bDirObj);
        vHair = aHair;
        vDrupThin = aDrupThin;
        vCrevice = aDrupCrevice;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uThaw;
        uniform vec3 uSideLightDir;
        uniform float uTransBoost;
        varying vec3 vRaspWorldPos;
        varying vec3 vRaspWorldNormal;
        varying vec3 vBerryWorldDir;
        varying float vBerryRad;
        varying float vHair;
        varying float vDrupThin;
        varying float vCrevice;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Rich deep jewel-ruby raspberry base color (lush berry magenta-crimson!)
          float thaw = clamp(uThaw, 0.0, 1.0);
          float hairMask = clamp(vHair, 0.0, 1.0);
          vec3 deepRuby = pow(max(diffuseColor.rgb, vec3(0.0001)), vec3(1.26)) * vec3(0.92, 0.46, 0.68);
          diffuseColor.rgb = mix(diffuseColor.rgb, deepRuby, (0.32 + thaw * 0.48) * (1.0 - hairMask));
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          // Silky frosted sea-glass / velvety berry skin roughness (eliminates shiny plastic marble dots!)
          float hairMask = clamp(vHair, 0.0, 1.0);
          float frostedSkin = mix(max(roughnessFactor, 0.46), 0.42, clamp(uThaw, 0.0, 1.0) * 0.45);
          roughnessFactor = mix(frostedSkin, 0.88, hairMask);
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 vDir = normalize(cameraPosition - vRaspWorldPos);
          vec3 nDir = normalize(vRaspWorldNormal);
          vec3 bDir = normalize(vBerryWorldDir);
          vec3 sideL = normalize(uSideLightDir);
          float ndv = clamp(abs(dot(nDir, vDir)), 0.0, 1.0);
          float thaw = clamp(uThaw, 0.0, 1.0);
          float hairMask = clamp(vHair, 0.0, 1.0);
          float fleshMask = 1.0 - hairMask;
          float dThin = clamp(vDrupThin, 0.18, 1.0);
          float crevice = clamp(vCrevice, 0.0, 1.0);
          float outerDome = smoothstep(0.14, 0.90, crevice);
          float bRad = clamp(vBerryRad, 0.0, 1.0);

          // Outside-the-ice exaggeration factor (dramatic side-lit sea-glass glow when outside ice / in air!)
          float outsideIce = smoothstep(0.04, 0.72, thaw);
          float boost = uTransBoost * mix(0.58, 1.32, outsideIce);

          // Suppress hard plastic white speculars so the frosted translucent jelly glow is the hero!
          reflectedLight.indirectSpecular *= 0.08 * outerDome * fleshMask;
          reflectedLight.directSpecular *= 0.22 * outerDome * fleshMask;

          // === EXAGGERATED DAY-19 CARNELIAN-RUBY SIDE-LIT TRANSLUCENCY ===
          vec3 baseCol = clamp(diffuseColor.rgb, vec3(0.015), vec3(0.95));

          // 1. Directional side-light alignment across the WHOLE berry:
          //    +1 = side facing incoming light, 0 = grazing rim, -1 = far shadowed side
          float sideEntry = dot(bDir, sideL);
          float sideBand = smoothstep(-0.28, 0.86, sideEntry);
          float litSideCore = smoothstep(-0.02, 0.92, sideEntry);
          // Grazing silhouette of the whole berry relative to view ray (thin outer drupelets!)
          float berryEdge = 1.0 - clamp(abs(dot(bDir, vDir)), 0.0, 1.0);
          float grazingEdge = pow(berryEdge, 1.45) * smoothstep(0.36, 0.92, bRad);

          // 2. Sculpt deep dark velvet-wine shadow contrast on the unlit side, crevices & inner drupelet seed core!
          //    Deep shadow + glowing fiery side-transmitted light = unmistakable frosted-glass translucency!
          float darkSideShade = mix(0.18, 0.78, smoothstep(-0.80, 0.45, sideEntry));
          float creviceShade = mix(0.10, 1.0, smoothstep(0.08, 0.80, crevice));
          // Subtle darker seed pip inside the center of each plump drupelet so translucent walls glow around it!
          float seedPip = pow(ndv, 2.4) * 0.46 * outerDome;
          float surfaceKeep = mix(0.68, 0.44, outsideIce) * darkSideShade * creviceShade * (1.0 - seedPip * 0.55);
          reflectedLight.directDiffuse *= mix(1.0, surfaceKeep, fleshMask);
          reflectedLight.indirectDiffuse *= mix(1.0, darkSideShade * creviceShade * 0.28, fleshMask);

          // 3. True optical path thickness through the berry & each drupelet:
          //    - Thin along the lit side & curved translucent walls of each drupelet (away from seed core!)
          //    - Thick & dark through the shadowed half, berry center, and crevices between drupelets!
          float coreThick = mix(2.60, 0.22, sideBand) * mix(1.16, 0.42, grazingEdge);
          float drupPath = mix(0.10, 1.18, pow(ndv, 1.15));
          float optThick = clamp(
            coreThick * (0.34 + 0.66 * drupPath) * mix(1.25, 0.48, dThin) * mix(1.95, 0.62, outerDome),
            0.09,
            3.20
          );

          // True Raspberry-Ruby Beer-Lambert spectral absorption:
          // Deep wine shadows -> lush ripe crimson -> blazing luminous translucent ruby-scarlet -> warm glowing coral-rose edge (zero yellow/white wash!)
          vec3 carnelianSigma = vec3(0.32, 3.10, 3.35);
          vec3 beer = exp(-carnelianSigma * optThick);

          // 4. Henyey-Greenstein forward scatter + side-through-drupelet exit radiance:
          float cosL = dot(-vDir, sideL);
          float g = 0.60;
          float hg = (1.0 - g * g) / (12.56637 * pow(max(0.08, 1.0 + g * g - 2.0 * g * cosL), 1.5));
          // Light punching through each drupelet from sideL out toward the camera:
          float exitWrap = pow(clamp(dot(-nDir, sideL) * 0.55 + 0.45, 0.0, 1.0), 1.35);
          float entryWrap = pow(clamp(dot(nDir, sideL) * 0.65 + 0.35, 0.0, 1.0), 1.15);
          // Curved translucent wall around each individual drupelet (preserves crisp dark seed center & dark crevices!)
          float drupWall = pow(1.0 - ndv, 1.38) * smoothstep(0.02, 0.32, ndv) * outerDome;
          float drupBelly = (1.0 - seedPip * 0.72) * outerDome;

          // Intense sunlit ruby-crimson light streaming through the side (vivid raspberry-scarlet -> warm glowing coral-rose at thinnest edge!)
          vec3 sideSun = vec3(2.25, 0.24, 0.22);
          float sideGate = mix(0.05, 1.36, sideBand) + grazingEdge * (0.14 + 0.85 * litSideCore);

          // Primary light punching through the lit side of the raspberry!
          vec3 sidePunch = sideSun * beer * (exitWrap * 0.82 + entryWrap * 0.58 + hg * 0.55) * sideGate * drupBelly;

          // Exaggerated Day-19 light-piping along curved drupelet walls & grazing side silhouette (molten glowing raspberry-ruby!)
          vec3 pipeSpectrum = exp(-carnelianSigma * mix(0.85, 0.18, litSideCore));
          vec3 pipeSun = vec3(2.65, 0.30, 0.25);
          vec3 sidePipe = pipeSun * pipeSpectrum * (drupWall * (0.14 + 1.25 * litSideCore) + grazingEdge * (0.10 + 0.95 * litSideCore) * outerDome) * (0.55 + 0.50 * dThin);

          // Deep ruby-magenta internal bounce on the shaded side so shadow drupelets stay rich velvet-berry, never flat black
          vec3 shadowJewel = vec3(0.32, 0.012, 0.036) * (0.32 + 0.68 * drupWall) * outerDome;

          // Subtle per-drupelet ripeness modulation
          vec3 drupHueTint = mix(vec3(1.0), clamp(baseCol * 3.0 + vec3(0.36, 0.08, 0.12), vec3(0.45), vec3(1.22)), 0.28);
          vec3 transTotal = (sidePunch + sidePipe * 0.90) * drupHueTint * boost + shadowJewel;

          // Soft frosted sea-glass velvet sheen on curved rims (luminous raspberry-coral on the lit side, deep velvet on shadow side!)
          float frostRim = pow(1.0 - ndv, 2.2) * outerDome * fleshMask;
          vec3 frostTint = mix(vec3(0.34, 0.03, 0.08), vec3(1.55, 0.26, 0.26), litSideCore) * (0.16 + 0.22 * outsideIce);

          vec3 combinedDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + transTotal * fleshMask + frostTint * frostRim;
          // Inside ice: gentle frost veil softens the berry under frozen rime; outside ice: pure glowing frosted sea glass!
          float iceFrost = (1.0 - outsideIce) * 0.24 * (0.35 + 0.65 * pow(1.0 - ndv, 1.5)) * fleshMask;
          vec3 iceVeilCol = mix(vec3(0.86, 0.66, 0.70), baseCol * 1.45 + vec3(0.14, 0.02, 0.04), 0.68);
          combinedDiffuse = mix(combinedDiffuse, iceVeilCol, iceFrost);

          reflectedLight.directDiffuse = combinedDiffuse;
          reflectedLight.indirectDiffuse = vec3(0.0);

          // Delicate warm golden-crimson glow on tiny botanical hairs along the lit side silhouette!
          if (hairMask > 0.05) {
            float hairLit = (0.18 + 1.25 * litSideCore + 0.45 * grazingEdge) * (0.40 + 0.60 * pow(1.0 - ndv, 1.2));
            vec3 hairGlowCol = mix(vec3(0.42, 0.10, 0.10), vec3(1.85, 0.68, 0.34), litSideCore * outsideIce);
            reflectedLight.directDiffuse += hairGlowCol * hairLit * hairMask * (0.28 + 0.34 * outsideIce);
          }

          // Soft velvety micro-frosted satin sheen (wide gentle lobe, zero hard marble dots!)
          vec3 hSide = normalize(sideL + vDir);
          float softSatin = pow(max(dot(nDir, hSide), 0.0), 18.0) * (0.18 + 0.24 * litSideCore);
          float microGlint = pow(max(dot(nDir, hSide), 0.0), 64.0) * 0.14 * outsideIce;
          reflectedLight.directSpecular += vec3(1.45, 0.78, 0.62) * (softSatin + microGlint) * outerDome * fleshMask;
        }`,
      );
  };
  return { material, uThaw };
}

function createChocolateMaterial(tex: ToppingTextureSet): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: tex.albedo,
    bumpMap: tex.bump,
    bumpScale: 0.016,
    roughnessMap: tex.roughness,
    // Velvety cold-tempered cocoa: warm low-glare specular prevents stark white grazing Fresnel rims in milk!
    roughness: 0.68,
    metalness: 0.0,
    specularIntensity: 0.24,
    specularColor: new THREE.Color(0x8e604a),
    envMapIntensity: 0.12,
  });
}

function createLemonZestMaterial(tex: ToppingTextureSet): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: tex.albedo,
    bumpMap: tex.bump,
    bumpScale: 0.018,
    roughnessMap: tex.roughness,
    roughness: 0.56,
    metalness: 0.0,
    specularIntensity: 0.34,
    specularColor: new THREE.Color(0xfff0a6),
    side: THREE.DoubleSide,
    envMapIntensity: 0.22,
  });
}

/**
 * Compact 20-triangle irregular crushed chili-flake / coarse salt crystal geometry for instanced superficial Tajín.
 */
function createTajinFlakeGeometry(seed = 911): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const rand = mulberry32(seed);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const jitter = 0.78 + rand() * 0.44;
    // Slightly angular flattened chili flake profile (local +Z aligns with popsicle outward normal)
    pos.setXYZ(i, v.x * jitter * 1.15, v.y * jitter * 0.92, v.z * jitter * 0.48);
  }
  geo.computeVertexNormals();
  return geo;
}

function createTajinMaterial(forSurfacePass = true): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0.0,
    flatShading: true,
    envMapIntensity: 0.14,
  });
  if (forSurfacePass) {
    // Write postIceRT.a = 0.25 (open-surface tag) so Pass 6b's berry-ice capillary seam blur
    // never blurs crisp superficial Tajín flakes sitting over the buried wooden stick or embedded fruits!
    mat.customProgramCacheKey = () => 'tajin-surface-tag-v1';
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
      gl_FragColor.a = 0.25;`,
      );
    };
  }
  return mat;
}

/**
 * Picks authentic 5-part Tajín seasoning grain species (fiery guajillo/árbol chili flakes,
 * warm paprika-amber shreds, dehydrated lime-chili flecks, coarse sea-salt crystals, and
 * dark toasted chili skin specks) with matching per-instance RGB color & anisotropic grain scale.
 */
function pickTajinGrainStyle(
  rand: () => number,
  outColor: THREE.Color,
  outScale: THREE.Vector3,
  scaleMul = 1.0,
): void {
  // ~80% ultra-fine chili-lime-salt powder specks (50% smaller!) + ~20% crisp coarse crushed chili flakes & salt crystals!
  const isPowder = rand() < 0.80;
  const sizeMul = isPowder ? 0.21 + rand() * 0.14 : 0.90 + Math.pow(rand(), 1.35) * 0.46;
  const mul = scaleMul * sizeMul;

  const roll = rand();
  if (roll < 0.44) {
    // Rich fiery red-orange guajillo & árbol chili flakes / powder
    const t = rand();
    outColor.setRGB(
      (178 + t * 44) / 255,
      (34 + t * 34) / 255,
      (6 + t * 10) / 255,
      THREE.SRGBColorSpace,
    );
    const w = (0.0085 + rand() * 0.0095) * mul;
    const h = w * (isPowder ? 0.78 + rand() * 0.36 : 0.56 + rand() * 0.64);
    outScale.set(w, h, (0.0038 + rand() * 0.003) * mul);
  } else if (roll < 0.72) {
    // Warm paprika / toasted ancho burnt-orange flakes / powder
    const t = rand();
    outColor.setRGB(
      (204 + t * 30) / 255,
      (76 + t * 44) / 255,
      (10 + t * 12) / 255,
      THREE.SRGBColorSpace,
    );
    const w = (0.008 + rand() * 0.009) * mul;
    const h = w * (isPowder ? 0.78 + rand() * 0.36 : 0.60 + rand() * 0.58);
    outScale.set(w, h, (0.0038 + rand() * 0.003) * mul);
  } else if (roll < 0.85) {
    // Dehydrated lime zest & golden chili powder flecks
    const t = rand();
    outColor.setRGB(
      (222 + t * 22) / 255,
      (138 + t * 38) / 255,
      (26 + t * 22) / 255,
      THREE.SRGBColorSpace,
    );
    const w = (0.007 + rand() * 0.007) * mul;
    const h = w * (0.72 + rand() * 0.45);
    outScale.set(w, h, (0.0034 + rand() * 0.0028) * mul);
  } else if (roll < 0.93) {
    // Sparkling sea-salt & citric acid crystals / fine salt dust
    const t = rand();
    outColor.setRGB(
      (236 + t * 16) / 255,
      (214 + t * 22) / 255,
      (178 + t * 28) / 255,
      THREE.SRGBColorSpace,
    );
    const s = (0.0062 + rand() * 0.0055) * mul;
    outScale.set(s * (0.85 + rand() * 0.35), s * (0.85 + rand() * 0.35), s * 0.88);
  } else {
    // Dark toasted chili skin & charred seed specks (crucial macro contrast!)
    const t = rand();
    outColor.setRGB(
      (52 + t * 30) / 255,
      (16 + t * 12) / 255,
      (7 + t * 8) / 255,
      THREE.SRGBColorSpace,
    );
    const w = (0.0068 + rand() * 0.0068) * mul;
    const h = w * (0.68 + rand() * 0.50);
    outScale.set(w, h, (0.0034 + rand() * 0.0028) * mul);
  }
}

function createKaksmulorMaterial(tex: ToppingTextureSet): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: tex.albedo,
    bumpMap: tex.bump,
    bumpScale: 0.028,
    roughnessMap: tex.roughness,
    roughness: 0.94,
    metalness: 0.0,
    specularIntensity: 0.14,
    specularColor: new THREE.Color(0xc8a484),
    envMapIntensity: 0.08,
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
      // 1. Hero whole slice — upper right (tucked cleanly inside ice & beside the raised upper birch stick!)
      {
        kind: 'strawberry',
        x: 0.26 + j(0.01),
        y: 0.45 + j(0.01),
        z: 0.014,
        scale: [0.255, 0.295, 0.25],
        rot: [0.36, -0.44, -0.62],
        radius: 0.20,
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
      kind === 'chocolate' ||
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
          : kind === 'chocolate'
            ? 1.42
            : kind === 'kaksmulor' && variant < 2
              ? 1.24
              : isSmallScatter
                ? 1.12
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
                ? radius * 0.78
                : radius * 0.92;

      const isFineInlay = kind === 'shaved-lemon' || kind === 'kaksmulor' || kind === 'chocolate';
      // Account for the recessed vertical flute valleys & dome taper so shallow milk inlays never spawn outside the ice!
      const fluteIndent = 0.032 * Math.exp(-Math.pow((Math.abs(x) - POPSICLE.fluteX) / 0.085, 2));
      const domeIndent = smoothstep(0.66, 1.0, hNorm) * 0.055;
      const localHalfDepth = POPSICLE.halfDepth - fluteIndent - domeIndent;
      const maxSafeZ = Math.max(
        -0.02,
        localHalfDepth - halfThickZ - (isCoconut ? (isFineInlay ? 0.006 : 0.014) : 0.028),
      );
      let z: number;
      if (isCoconut) {
        // Keep ~68% near the front creamy surface so fine crumbs, chips & zest peek vividly on frame 0,
        // while seating ~32% slightly deeper so new hidden bits emerge organically mid-melt!
        const frontSide = rand() < 0.78 ? 1 : -1;
        const deeperLayer = isFineInlay && rand() < 0.32;
        const depthSpread = deeperLayer ? 0.020 + rand() * 0.038 : rand() * (isFineInlay ? 0.018 : 0.026);
        const shallowZ = Math.max(0.015, maxSafeZ - depthSpread);
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
        const minDist =
          (radius + p.r) *
          (kind === 'shaved-lemon' || (kind === 'kaksmulor' && variant >= 2) ? 0.46 : isSmallScatter ? 0.56 : 0.78);
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
          scale: [radius, radius, radius * 0.96],
          rot: [0.95 + rand() * 0.85, (rand() - 0.5) * 1.6, (rand() - 0.5) * 1.4],
          radius,
          variant: 0,
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
          scale: [radius * (0.94 + rand() * 0.14), radius * (0.94 + rand() * 0.14), radius * (0.86 + rand() * 0.18)],
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
    (t) => t === 'strawberry' || t === 'blueberry' || t === 'raspberry',
  );
  const hasChocolate = activeToppings.includes('chocolate');
  const hasLemon = activeToppings.includes('shaved-lemon');
  const hasKaksmulor = activeToppings.includes('kaksmulor');

  // Distribute large hero berries harmoniously across upper, mid, and lower zones
  if (largePool.length > 0) {
    const perKind = largePool.length === 1 ? 10 : largePool.length === 2 ? 6 : 4;
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

  // Chocolate: 50% chunky dark-chocolate drops/pearls (too heavy to ride syrup -> cleanly drop under gravity)
  // and 50% finely divided chocolate bits (divided by 2, 3, or 4 -> tiny flecks that ride the melt flow to the floor!).
  if (hasChocolate) {
    const totalChoc = largePool.length === 0 ? 72 : 50;
    const chunkyCount = Math.floor(totalChoc * 0.5);
    const fineCount = totalChoc - chunkyCount;
    for (let n = 0; n < chunkyCount; n++) {
      const yMin = -0.84 + (n / chunkyCount) * 1.56;
      const yMax = Math.min(0.82, yMin + 0.22);
      const r = n % 2 === 0 ? 0.038 + rand() * 0.018 : 0.028 + rand() * 0.014;
      tryPlace('chocolate', r, yMin, yMax, n % 3 === 0 ? -0.012 : 0.056);
    }
    for (let n = 0; n < fineCount; n++) {
      const baseR = 0.024 + rand() * 0.030;
      const divisor = rand() < 0.34 ? 2 : rand() < 0.67 ? 3 : 4;
      const r = Math.min(0.022, baseR / divisor);
      tryPlace('chocolate', r, -0.86, 0.84, n % 3 === 0 ? -0.014 : 0.060);
    }
  }

  // Kaksmulor: crisp smaller broken dark-wafer biscuit pieces + rich abundant scatter of fine cookie crumbs!
  if (hasKaksmulor) {
    const chunkCount = largePool.length === 0 ? 14 : 9;
    for (let n = 0; n < chunkCount; n++) {
      const yMin = -0.82 + (n / chunkCount) * 1.48;
      const yMax = Math.min(0.74, yMin + 0.24);
      const r = largePool.length === 0 ? 0.064 + rand() * 0.032 : 0.058 + rand() * 0.024;
      // 80% dark cocoa wafer chunks (classic cookies & cream!), 20% golden butter biscuit chunks
      const variant = rand() < 0.80 ? 0 : 1;
      tryPlace('kaksmulor', r, yMin, yMax, 0.056, variant);
    }
    const crumbCount = largePool.length === 0 ? 54 : 34;
    for (let n = 0; n < crumbCount; n++) {
      const r = 0.018 + rand() * 0.024;
      const variant = rand() < 0.78 ? 2 : 3;
      tryPlace('kaksmulor', r, -0.86, 0.82, n % 3 === 0 ? -0.014 : 0.062, variant);
    }
  }

  // Shaved lemon: abundant delicate fine bright-yellow curled citrus zest bits suspended throughout!
  if (hasLemon) {
    const zestCount = largePool.length === 0 && !hasKaksmulor ? 56 : 42;
    for (let n = 0; n < zestCount; n++) {
      const r = 0.031 + rand() * 0.014;
      tryPlace('shaved-lemon', r, -0.86, 0.82, n % 3 === 0 ? -0.014 : 0.054, n % 2);
    }
  }

  return specs;
}

export function createFruitAssembly(seed: number, recipe: PopsicleRecipe = DEFAULT_RECIPE): FruitAssembly {
  const group = new THREE.Group();
  const surfaceGroup = new THREE.Group();
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
          vec2 carveUv = vec2((vStickWorldPos.y + 0.32) / 0.64, (-vStickWorldPos.x + 0.088) / 0.176);
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
        thawUniform = straw.uThaw;
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
      case 'tajin':
        return;
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
      seatOffset: 0,
      flowRiding: false,
      flowTime: 0,
      flowPhase: rand() * Math.PI * 2,
      flowStickiness: rand(),
      flowSpeedBias: 0.35 + Math.pow(rand(), 1.35) * 1.45,
      baseSignedOut0: -0.05,
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
      f.flowRiding = false;
      f.flowTime = 0;
      f.jostlePos.set(0, 0, 0);
      f.jostleVel.set(0, 0, 0);
      f.bendAmt = f.baseBend.x;
      f.bendVel = 0;
      f.bendUniform?.value.copy(f.baseBend);
      if (f.thawUniform) f.thawUniform.value = 0;
      f.mesh.visible = true;
    }
    resetTajin?.();
    stickUniforms.uIceBottomY.value = POPSICLE.yBottom;
    stickUniforms.uIceTopY.value = POPSICLE.yTop;
    stickUniforms.uIceAmount.value = 1.0;
    stickUniforms.uStickWetness.value = 0.0;
  }

  // Forward-declared hooks wired right below once the exact surface & stick helpers are ready
  let resetTajin: (() => void) | null = null;
  let updateTajin: ((meltState: MeltFieldState, dt: number) => void) | null = null;

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
    tajin: {
      gravity: 6.8,
      restitution: 0.10,
      wetDrag: 2.2,
      adhesion: 0.36,
      rollGain: 0.40,
      airDragLin: 0.34,
      airDragQuad: 0.12,
      angDrag: 1.4,
      maxSpin: 7.5,
      flatAero: 0.8,
      magnus: 0.015,
      flexGain: 0.0,
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
      case 'tajin':
        return f.radius * 0.45;
      case 'kaksmulor':
        return f.radius * 0.50;
      case 'chocolate':
        return f.radius * 0.62;
      default:
        return f.radius * 0.84;
    }
  }

  /** Small, lightweight bits where capillary surface tension & syrup viscosity keep them riding the melt flow! */
  function isSmallFlowBit(f: FruitItem): boolean {
    if (f.kind === 'shaved-lemon') return true;
    if (f.kind === 'chocolate') return f.radius <= 0.023;
    if (f.kind === 'kaksmulor') return f.radius <= 0.056;
    if (f.kind === 'raspberry') return f.radius <= 0.056;
    if (f.kind === 'strawberry') return f.radius <= 0.072;
    return false;
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
  const STICK_BOT_ARCH_Y = POPSICLE.stickBottomY + STICK_HALF_W;

  function sampleStickSDF(x: number, y: number, z: number, outN: THREE.Vector3): number {
    if (y > STICK_ARCH_Y || y < STICK_BOT_ARCH_Y) {
      // Semicircular rounded top or bottom cap (cylinder in XY, slab in Z)
      const isTop = y > STICK_ARCH_Y;
      const dy = y - (isTop ? STICK_ARCH_Y : STICK_BOT_ARCH_Y);
      const rXY = Math.hypot(x, dy);
      const dXY = rXY - STICK_HALF_W;
      const dZ = Math.abs(z) - STICK_HALF_D;
      if (dXY > 0 || dZ > 0) {
        const ox = Math.max(0, dXY);
        const oz = Math.max(0, dZ);
        const dist = Math.hypot(ox, oz);
        const rx = rXY > 1e-5 ? x / rXY : 0;
        const ry = rXY > 1e-5 ? dy / rXY : isTop ? 1 : -1;
        const sz = z >= 0 ? 1 : -1;
        if (dist > 1e-6) {
          outN.set((ox * rx) / dist, (ox * ry) / dist, (oz * sz) / dist);
        } else {
          outN.set(0, isTop ? 1 : -1, 0);
        }
        return dist;
      }
      // Inside cap
      if (dZ > dXY) {
        outN.set(0, 0, z >= 0 ? 1 : -1);
        return dZ;
      }
      const invR = rXY > 1e-5 ? 1 / rXY : 0;
      outN.set(x * invR, dy * invR || (isTop ? 1 : -1), 0);
      return dXY;
    }

    // Rectangular beveled shaft (STICK_BOT_ARCH_Y <= y <= STICK_ARCH_Y)
    const yClamped = clamp(y, STICK_BOT_ARCH_Y, STICK_ARCH_Y);
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
  function evaluateRawFruitGrip(f: FruitItem, meltState: MeltFieldState, slideY = 0): number {
    const info = sampleIceContainment(f.basePos.x, f.basePos.y + slideY, f.basePos.z, meltState, physContInfo);
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

  // Calibrate each topping's initial frozen seat at melt=0: deeply buried water-mode fruits keep seatOffset=0,
  // while shallow milk-mode inlays pressed near the mold wall start firmly frozen until real melting releases them!
  const frozenBaselineState: MeltFieldState = {
    melt: 0,
    time: 0,
    seedOffset: seed * 13.7,
    heatSpots: [],
    pointerHeat: 0,
    pointerX: 0,
    pointerY: 0,
    bottomPool: 0.4,
    bottomLobes: [1, 1, 1, 1],
    pendantPull: [0, 0, 0, 0],
  };
  const liveProfileFrame: ProfileFrameCache = prepareProfileFrame(frozenBaselineState);
  const physExactSurf: ExactIceSurfaceInfo = {
    sx: 0,
    sy: 0,
    sz: 0,
    nx: 0,
    ny: 0,
    nz: 1,
    signedOut: 0,
    iceGone: false,
  };
  for (const f of fruits) {
    const rawGrip0 = evaluateRawFruitGrip(f, frozenBaselineState, 0);
    const minFrozenSeat = 0.044 + f.radius * 0.36;
    f.seatOffset = Math.max(0, minFrozenSeat - rawGrip0);
    sampleExactIceSurface(f.basePos.x, f.basePos.y, f.basePos.z, liveProfileFrame, frozenBaselineState, physExactSurf);
    f.baseSignedOut0 = physExactSurf.signedOut;
  }

  // === SUPERFICIAL TAJÍN SPICE COATING (Single InstancedMesh, exact outer-skin cling + viscous melt-flow!) ===
  if (activeSet.has('tajin')) {
    interface TajinGrain {
      vNorm0: number;
      sinT0: number;
      cosT0: number;
      px: number;
      py: number;
      pz: number;
      vx: number;
      vy: number;
      vz: number;
      sx: number;
      sy: number;
      sz: number;
      rideOut: number;
      spin: number;
      tiltX: number;
      tiltY: number;
      releaseMelt: number;
      speedBias: number;
      stickiness: number;
      flowPhase: number;
      flowTime: number;
      fallTime: number;
      /** 0 = clinging on surface, 1 = gliding in melt flow / stick runoff, 2 = dripping fall, 3 = hidden */
      state: number;
    }

    const isCompactDevice =
      typeof window !== 'undefined' &&
      (window.matchMedia('(max-width: 860px)').matches || navigator.maxTouchPoints > 0);
    const grainCount = isCompactDevice ? 1700 : 3400;
    const tRand = mulberry32(seed * 977 + 431);
    const tGeo = createTajinFlakeGeometry(seed * 313 + 71);
    const tMat = createTajinMaterial();
    const tMesh = new THREE.InstancedMesh(tGeo, tMat, grainCount);
    tMesh.name = 'tajin-coating';
    tMesh.frustumCulled = false;
    disposables.push(tGeo, tMat);
    surfaceGroup.add(tMesh);

    const tColor = new THREE.Color();
    const tScale = new THREE.Vector3();
    const tPos = new THREE.Vector3();
    const tQuat = new THREE.Quaternion();
    const tAlignQuat = new THREE.Quaternion();
    const tTwistQuat = new THREE.Quaternion();
    const tTiltEuler = new THREE.Euler();
    const tTiltQuat = new THREE.Quaternion();
    const tNorm = new THREE.Vector3();
    const tMat4 = new THREE.Matrix4();
    const Z_AXIS = new THREE.Vector3(0, 0, 1);
    const tRowCache: ProfileRowCache = prepareProfileRow(0.5, liveProfileFrame);
    const tPt = { x: 0, y: 0, z: 0 };
    const tPtP = { x: 0, y: 0, z: 0 };
    const tPtM = { x: 0, y: 0, z: 0 };
    const tRowP: ProfileRowCache = { ...tRowCache };
    const tRowM: ProfileRowCache = { ...tRowCache };
    const tSurf: ExactIceSurfaceInfo = {
      sx: 0,
      sy: 0,
      sz: 0,
      nx: 0,
      ny: 0,
      nz: 1,
      signedOut: 0,
      iceGone: false,
    };
    const tStickN = new THREE.Vector3();
    const clumpOff = tRand() * 30;
    const grains: TajinGrain[] = [];

    for (let i = 0; i < grainCount; i++) {
      // Uniform arc-length surface sampling (invert superellipse X/Z exponents so there is ZERO bald stripe at x=0!)
      // with lush shaken-on chili clustering across the upper & center body tapering gently toward the golden bottom!
      let vNorm0 = 0.5;
      let sinT0 = 0;
      let cosT0 = 1;
      for (let attempt = 0; attempt < 24; attempt++) {
        vNorm0 = 0.06 + Math.pow(tRand(), 0.72) * 0.90;
        prepareProfileRow(vNorm0, liveProfileFrame, tRowCache);
        if (tRand() < 0.84) {
          // Broad front (+Z) & back (-Z) faces: uniform X across [-0.98..+0.98] -> dense even coat right across center!
          const uX = (tRand() * 2 - 1) * 0.985;
          sinT0 = Math.sign(uX) * Math.pow(Math.abs(uX), 1.0 / tRowCache.invExpX);
          cosT0 = (tRand() < 0.56 ? 1 : -1) * Math.sqrt(Math.max(0, 1.0 - sinT0 * sinT0));
        } else {
          // Rounded left/right side edges: uniform Z across [-0.95..+0.95]
          const uZ = (tRand() * 2 - 1) * 0.95;
          cosT0 = Math.sign(uZ) * Math.pow(Math.abs(uZ), 1.0 / tRowCache.invExpZ);
          sinT0 = (tRand() < 0.5 ? 1 : -1) * Math.sqrt(Math.max(0, 1.0 - cosT0 * cosT0));
        }
        evaluatePopsicleVertex(sinT0, cosT0, liveProfileFrame, tRowCache, frozenBaselineState, tPt);

        // Organic shaken-on clumping: lush dense chili blanket across upper/mid face + subtle golden mango windows near bottom
        const upperWeight = 0.14 + 0.86 * smoothstep(0.08, 0.42, vNorm0);
        const clump = fbm3(tPt.x * 2.4 + clumpOff, tPt.y * 1.8 - clumpOff * 0.5, tPt.z * 2.4);
        const acceptProb = upperWeight * (0.42 + 0.88 * smoothstep(0.20, 0.72, clump));
        if (tRand() < acceptProb) break;
      }

      pickTajinGrainStyle(tRand, tColor, tScale, 1.0);
      tMesh.setColorAt(i, tColor);

      prepareProfileRow(vNorm0, liveProfileFrame, tRowCache);
      evaluatePopsicleVertex(sinT0, cosT0, liveProfileFrame, tRowCache, frozenBaselineState, tPt);
      sampleExactIceSurface(tPt.x, tPt.y, tPt.z, liveProfileFrame, frozenBaselineState, tSurf);

      const rideOut = tScale.z * 0.85 + 0.009;
      const px = tPt.x + tSurf.nx * rideOut;
      const py = tPt.y + tSurf.ny * rideOut;
      const pz = tPt.z + tSurf.nz * rideOut;

      // Coherent vertical melt-rivulet release channels + wide individual grain jitter so fiery streaks break loose organically!
      const rivuletNoise = fbm3(tPt.x * 5.2 + clumpOff * 1.7, tPt.y * 1.15, tPt.z * 5.2);
      const releaseMelt = clamp(0.075 + rivuletNoise * 0.24 + Math.pow(tRand(), 1.15) * 0.30, 0.07, 0.62);

      grains.push({
        vNorm0,
        sinT0,
        cosT0,
        px,
        py,
        pz,
        vx: 0,
        vy: 0,
        vz: 0,
        sx: tScale.x,
        sy: tScale.y,
        sz: tScale.z,
        rideOut,
        spin: tRand() * Math.PI * 2,
        tiltX: (tRand() - 0.5) * 0.46,
        tiltY: (tRand() - 0.5) * 0.46,
        releaseMelt,
        speedBias: 0.32 + Math.pow(tRand(), 1.3) * 1.58,
        stickiness: tRand(),
        flowPhase: tRand() * Math.PI * 2,
        flowTime: 0,
        fallTime: 0,
        state: 0,
      });

      tNorm.set(tSurf.nx, tSurf.ny, tSurf.nz).normalize();
      tAlignQuat.setFromUnitVectors(Z_AXIS, tNorm);
      tTwistQuat.setFromAxisAngle(Z_AXIS, grains[i].spin);
      tTiltEuler.set(grains[i].tiltX, grains[i].tiltY, 0);
      tTiltQuat.setFromEuler(tTiltEuler);
      tQuat.copy(tAlignQuat).multiply(tTwistQuat).multiply(tTiltQuat);
      tPos.set(px, py, pz);
      tMat4.compose(tPos, tQuat, tScale);
      tMesh.setMatrixAt(i, tMat4);
    }
    if (tMesh.instanceColor) tMesh.instanceColor.needsUpdate = true;
    tMesh.instanceMatrix.needsUpdate = true;

    const writeGrainMatrix = (idx: number, g: TajinGrain, nx: number, ny: number, nz: number) => {
      if (g.state === 3) {
        tScale.set(0, 0, 0);
        tPos.set(0, -10, 0);
        tMat4.compose(tPos, tQuat.identity(), tScale);
        tMesh.setMatrixAt(idx, tMat4);
        return;
      }
      tNorm.set(nx, ny, nz);
      const nLen = tNorm.length();
      if (nLen > 1e-4) tNorm.divideScalar(nLen);
      else tNorm.set(0, 0, 1);
      tAlignQuat.setFromUnitVectors(Z_AXIS, tNorm);
      tTwistQuat.setFromAxisAngle(Z_AXIS, g.spin);
      tTiltEuler.set(g.tiltX, g.tiltY, 0);
      tTiltQuat.setFromEuler(tTiltEuler);
      tQuat.copy(tAlignQuat).multiply(tTwistQuat).multiply(tTiltQuat);
      tPos.set(g.px, g.py, g.pz);
      tScale.set(g.sx, g.sy, g.sz);
      tMat4.compose(tPos, tQuat, tScale);
      tMesh.setMatrixAt(idx, tMat4);
    };

    const placeClingingGrain = (idx: number, g: TajinGrain, frame: ProfileFrameCache, meltState: MeltFieldState) => {
      prepareProfileRow(g.vNorm0, frame, tRowCache);
      evaluatePopsicleVertex(g.sinT0, g.cosT0, frame, tRowCache, meltState, tPt);
      // Fast lightweight outward normal estimate (horizontal + vertical slope)
      const vP = Math.min(0.998, g.vNorm0 + 0.015);
      const vM = Math.max(0.002, g.vNorm0 - 0.015);
      prepareProfileRow(vP, frame, tRowP);
      prepareProfileRow(vM, frame, tRowM);
      evaluatePopsicleVertex(g.sinT0, g.cosT0, frame, tRowP, meltState, tPtP);
      evaluatePopsicleVertex(g.sinT0, g.cosT0, frame, tRowM, meltState, tPtM);
      const vy = tPtP.y - tPtM.y;
      const vx = tPtP.x - tPtM.x;
      const vz = tPtP.z - tPtM.z;
      // Tangent around theta is roughly (cosT0, 0, -sinT0); cross with dP/dv gives outward normal
      let nx = -g.sinT0 * vy;
      let ny = -g.sinT0 * vx - g.cosT0 * vz;
      let nz = -g.cosT0 * vy;
      // Ensure outward sign matches (sinT0, 0, cosT0)
      if (nx * g.sinT0 + nz * g.cosT0 < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;

      g.px = tPt.x + nx * g.rideOut;
      g.py = tPt.y + ny * g.rideOut;
      g.pz = tPt.z + nz * g.rideOut;
      writeGrainMatrix(idx, g, nx, ny, nz);
    };

    resetTajin = () => {
      prepareProfileFrame(frozenBaselineState, liveProfileFrame);
      tMat.roughness = 0.86;
      for (let i = 0; i < grains.length; i++) {
        const g = grains[i];
        g.state = 0;
        g.vx = g.vy = g.vz = 0;
        g.flowTime = 0;
        g.fallTime = 0;
        placeClingingGrain(i, g, liveProfileFrame, frozenBaselineState);
      }
      tMesh.instanceMatrix.needsUpdate = true;
    };

    updateTajin = (meltState: MeltFieldState, dt: number) => {
      const { yBot: yBotLive, iceGone } = getMeltBounds(meltState.melt);
      // Powdery dry matte chili when frozen -> juicy glossy wet chili-oil sheen as mango melts!
      tMat.roughness = 0.86 - smoothstep(0.06, 0.36, meltState.melt) * 0.46;

      if (dt <= 0) {
        for (let i = 0; i < grains.length; i++) {
          const g = grains[i];
          if (iceGone || meltState.melt > g.releaseMelt + 0.24) {
            g.state = 3;
            writeGrainMatrix(i, g, 0, 0, 1);
          } else {
            g.state = 0;
            g.vx = g.vy = g.vz = 0;
            g.flowTime = 0;
            g.fallTime = 0;
            placeClingingGrain(i, g, liveProfileFrame, meltState);
          }
        }
        tMesh.instanceMatrix.needsUpdate = true;
        return;
      }

      const stepDt = Math.min(0.033, dt);
      const iceHalfWBound = POPSICLE.halfWidthBottom + 0.24;
      const iceHalfDBound = POPSICLE.halfDepth + 0.24;
      let anyUpdated = false;

      for (let i = 0; i < grains.length; i++) {
        const g = grains[i];
        if (g.state === 3) continue;
        anyUpdated = true;

        if (g.state === 0) {
          if (iceGone) {
            g.state = 2;
            g.fallTime = 0;
            g.vy = -0.06;
            continue;
          }
          placeClingingGrain(i, g, liveProfileFrame, meltState);
          const localHeat = sampleLocalHeat(g.px, g.py, meltState);
          const effMelt = meltState.melt + localHeat * 0.42;
          if (meltState.melt > 0.06 && effMelt >= g.releaseMelt) {
            g.state = 1;
            g.flowTime = 0;
            g.vx = 0;
            g.vy = -0.008 * g.speedBias;
            g.vz = 0;
          }
          continue;
        }

        if (g.state === 1) {
          g.flowTime += stepDt;

          // 1. BELOW STICK TIP: Ride strictly inside/on the golden vertical drip filament off-screen (never scatter in air!)
          if (g.py <= POPSICLE.stickBottomY + 0.008 && Math.abs(g.px) < STICK_HALF_W + 0.08) {
            const dBelow = Math.max(0, POPSICLE.stickBottomY - g.py);
            const swayAmp = smoothstep(0.05, 0.65, dBelow) * 0.0045;
            const cx = Math.sin(dBelow * 4.0 - meltState.time * 1.4) * swayAmp;
            const cz = Math.cos(dBelow * 3.2 - meltState.time * 1.1) * swayAmp * 0.65;
            // Smooth V-meniscus collar funnel (0.020 at stick tip -> sleek 0.010 core inside the 0.017 drip filament!)
            const filRad = 0.010 + 0.012 * Math.exp(-dBelow / 0.045);
            const rx = g.px - cx;
            const rz = g.pz - cz;
            const rDist = Math.hypot(rx, rz);
            const pullRate = 1.0 - Math.exp(-stepDt * 14.0);
            if (rDist > filRad) {
              const targetScale = filRad / Math.max(1e-5, rDist);
              g.px += (cx + rx * targetScale - g.px) * Math.min(1, pullRate * 1.35);
              g.pz += (cz + rz * targetScale - g.pz) * Math.min(1, pullRate * 1.35);
            } else {
              // Subtle gentle centering inside the flowing syrup thread
              g.px += (cx - g.px) * pullRate * 0.18;
              g.pz += (cz - g.pz) * pullRate * 0.18;
            }
            // Viscous gravity-stretched drip-filament stream speed (smooth, syrupy, continuous down the thread!)
            const filSpeed = (0.34 + 0.48 * smoothstep(0.0, 0.85, dBelow)) * (0.72 + g.speedBias * 0.36);
            const vDamp = 1.0 - Math.exp(-stepDt * 9.0);
            g.vx *= Math.exp(-stepDt * 12.0);
            g.vz *= Math.exp(-stepDt * 12.0);
            g.vy += (-filSpeed - g.vy) * vDamp;
            g.py += g.vy * stepDt;
            g.spin += (2.4 + filSpeed * 3.2) * (g.flowPhase > Math.PI ? 1 : -1) * stepDt;
            if (g.py < -4.2) {
              g.state = 3;
            }
            writeGrainMatrix(i, g, 0, 0, 1);
            continue;
          }

          // 2. ON WET BIRCH WOODEN STICK: Only hand off once the grain has actually crept to the stick collar,
          // then hug smoothly with dt-scaled meniscus attraction (zero sudden multi-frame horizontal snap!).
          const onStickBand =
            g.py <= yBotLive + 0.014 &&
            Math.abs(g.px) < STICK_HALF_W + 0.024 &&
            Math.abs(g.pz) < STICK_HALF_D + 0.036;

          if (onStickBand) {
            const dStick = sampleStickSDF(g.px, g.py, g.pz, tStickN);
            const stickPulse = 0.5 + 0.45 * Math.sin(g.py * 6.8 + g.flowPhase + g.flowTime * 1.15);
            const stickSpeed =
              (0.09 + 0.18 * smoothstep(0.14, 0.78, meltState.melt)) *
              g.speedBias *
              (0.26 + 0.92 * stickPulse * stickPulse);
            const damp = 1.0 - Math.exp(-stepDt * 8.5);
            // Smooth semicircular bottom-tip funnel: glide naturally down the full stick width, converging gently near the tip!
            const nearArch = smoothstep(STICK_BOT_ARCH_Y + 0.14, POPSICLE.stickBottomY + 0.008, g.py);
            const dyArc = clamp(STICK_BOT_ARCH_Y - g.py, 0, STICK_HALF_W);
            const woodHalfW = Math.sqrt(Math.max(0, STICK_HALF_W * STICK_HALF_W - dyArc * dyArc));
            const maxXAtY = Math.max(0.012, woodHalfW * (1.0 - nearArch * 0.45) + g.rideOut * 0.6);

            const targetVx =
              Math.sin(g.py * 11.5 + g.flowPhase) * 0.010 * (1.0 - nearArch * 0.9) -
              g.px * (0.14 + nearArch * 5.6) * Math.max(0.14, stickSpeed);
            const targetVz = -g.pz * (0.65 + nearArch * 4.8) * Math.max(0.14, stickSpeed);
            g.vx += (targetVx - g.vx) * damp;
            g.vy += (-stickSpeed - g.vy) * damp;
            g.vz += (targetVz - g.vz) * damp;
            g.px += g.vx * stepDt;
            g.py += g.vy * stepDt;
            g.pz += g.vz * stepDt;

            // Clamp tightly onto the curved semicircular stick tip so nothing slips off the rounded sides!
            if (g.py < STICK_BOT_ARCH_Y && Math.abs(g.px) > maxXAtY) {
              g.px = Math.sign(g.px) * maxXAtY;
            }
            const errS = g.rideOut - dStick;
            if (errS > 0) {
              g.px += tStickN.x * errS;
              g.py += tStickN.y * errS;
              g.pz += tStickN.z * errS;
            } else {
              // Smooth dt-scaled viscous meniscus hug onto the wood (never teleports across the collar!)
              const pullAlpha = 1.0 - Math.exp(-stepDt * 5.5);
              const pull = Math.max(errS * pullAlpha, -0.22 * stepDt);
              g.px += tStickN.x * pull;
              g.py += tStickN.y * pull;
              g.pz += tStickN.z * pull;
            }
            g.spin += stickSpeed * 1.4 * stepDt;
            writeGrainMatrix(i, g, tStickN.x, tStickN.y, tStickN.z);
            continue;
          }

          // 3. ON POPSICLE BODY & STICKY UNDERSIDE RIM: Never fall off outer bottom edges while ice remains!
          // Instead, cling tightly to the sticky pooled underside and creep smoothly inward straight onto the wooden stick!
          if (!iceGone && Math.abs(g.px) < iceHalfWBound + 0.06 && Math.abs(g.pz) < iceHalfDBound + 0.06) {
            sampleExactIceSurface(g.px, g.py, g.pz, liveProfileFrame, meltState, tSurf);
            if (!tSurf.iceGone) {
              const nx = tSurf.nx;
              const ny = tSurf.ny;
              const nz = tSurf.nz;

              // Strictly outside the exact rendered surface (never sinks inside the ice!)
              if (tSurf.signedOut < g.rideOut) {
                const push = g.rideOut - tSurf.signedOut;
                g.px += nx * push;
                g.py += ny * push;
                g.pz += nz * push;
              } else {
                const pull = Math.min(tSurf.signedOut - g.rideOut, 0.045) * 0.72;
                g.px -= nx * pull;
                g.py -= ny * pull;
                g.pz -= nz * pull;
              }

              // Detect sticky bottom rim / underside pouch (outer corners stay super sticky and creep smoothly inward to the stick!)
              const onStickyUnderside = g.py <= yBotLive + 0.032 || ny <= -0.62;
              if (onStickyUnderside) {
                const targetX = clamp(g.px, -STICK_HALF_W * 0.88, STICK_HALF_W * 0.88);
                const dirX = clamp((targetX - g.px) * 14.0, -1, 1);
                const dirZ = clamp(-g.pz * 9.0, -1, 1);
                const pulse = 0.5 + 0.42 * Math.sin(g.px * 12.0 + g.flowPhase + g.flowTime * 1.3);
                const creepSpeed = (0.068 + 0.125 * smoothstep(0.14, 0.78, meltState.melt)) * g.speedBias * (0.35 + 0.85 * pulse * pulse);
                const damp = 1.0 - Math.exp(-stepDt * 7.5);
                // Creep smoothly inward along the sticky underside meniscus directly into the wooden stick collar!
                g.vx += (dirX * creepSpeed - g.vx) * damp;
                g.vz += (dirZ * creepSpeed * 0.85 - g.vz) * damp;
                // Keep y tucked snugly right along the sticky bottom rim until reaching the stick!
                const rimTargetY = Math.min(tSurf.sy - g.rideOut * 0.6, yBotLive + 0.008);
                g.vy += (clamp((rimTargetY - g.py) * 7.5, -0.09, 0.06) - g.vy) * damp;
                g.px += g.vx * stepDt;
                g.py += g.vy * stepDt;
                g.pz += g.vz * stepDt;
                g.spin += creepSpeed * 2.2 * stepDt;
                writeGrainMatrix(i, g, nx, ny, nz);
                continue;
              }

              // Downward surface tangent t = g - (g · N) N
              const gn = -ny;
              let tx = -gn * nx;
              let ty = -1.0 - gn * ny;
              let tz = -gn * nz;
              const tLen = Math.hypot(tx, ty, tz);
              if (tLen > 1e-4) {
                tx /= tLen;
                ty /= tLen;
                tz /= tLen;
              } else {
                tx = 0;
                ty = -1;
                tz = 0;
              }

              // Horizontal tangent for organic meandering rivulet streaks + flute funneling + gentle lower-body inward funnel
              let hx = nz;
              let hz = -nx;
              const hLen = Math.hypot(hx, hz);
              if (hLen > 1e-4) {
                hx /= hLen;
                hz /= hLen;
              } else {
                hx = 1;
                hz = 0;
              }
              const meander =
                Math.sin(g.py * 6.8 + g.flowPhase + meltState.time * (0.26 + g.speedBias * 0.16)) * 0.20 +
                Math.cos(g.px * 10.5 - g.py * 4.4 + g.flowPhase * 1.5) * 0.13;
              const nearestFluteX = g.px >= 0 ? POPSICLE.fluteX : -POPSICLE.fluteX;
              const flutePull = clamp((nearestFluteX - g.px) * 1.25, -0.16, 0.16) * (1.0 - smoothstep(0.35, 0.72, meltState.melt));

              // Smooth bottom-zone capillary funneling across the ENTIRE width so grains naturally curve toward the stick!
              const botZone = smoothstep(yBotLive + 0.30, yBotLive + 0.02, g.py);
              const stickTargetX = clamp(g.px, -STICK_HALF_W * 0.85, STICK_HALF_W * 0.85);
              const stickFunnelX = clamp((stickTargetX - g.px) * 2.8, -0.82, 0.82) * botZone;
              const stickFunnelZ = -Math.sign(g.pz || 1) * 0.48 * botZone;
              const sideDrift = (meander + flutePull * (nz >= 0 ? 1 : -1)) * (1.0 - botZone * 0.72);

              // Varied viscous syrup speed: smooth startup ramp + wide per-grain bias + stick-slip surges + pointer warmth!
              const startup = 0.08 + 0.92 * smoothstep(0.0, 0.45 + g.stickiness * 0.90, g.flowTime);
              const pulse =
                0.5 +
                0.30 * Math.sin(g.py * 5.2 + g.flowPhase + meltState.time * (0.35 + g.speedBias * 0.32)) +
                0.24 * Math.sin(g.flowTime * (0.90 + g.stickiness * 0.85) + g.flowPhase * 2.1);
              const pC = clamp(pulse, 0, 1);
              const stickSlip = 0.15 + 1.20 * pC * pC;
              const slopeEase = 0.42 + 0.58 * Math.abs(ty);
              const warmth = sampleLocalHeat(g.px, g.py, meltState);
              const baseRunoff = 0.085 + 0.27 * smoothstep(0.10, 0.78, meltState.melt) + warmth * 0.26;
              const speed = baseRunoff * g.speedBias * slopeEase * startup * stickSlip;

              const damp = 1.0 - Math.exp(-stepDt * 7.5);
              g.vx += ((tx + hx * sideDrift + stickFunnelX) * speed - g.vx) * damp;
              g.vy += (ty * speed - g.vy) * damp;
              g.vz += ((tz + hz * sideDrift + stickFunnelZ) * speed - g.vz) * damp;

              g.px += g.vx * stepDt;
              g.py += g.vy * stepDt;
              g.pz += g.vz * stepDt;
              g.spin += (g.vx * 5.5 + (g.flowPhase > Math.PI ? 1 : -1) * speed * 1.8) * stepDt;

              writeGrainMatrix(i, g, nx, ny, nz);
              continue;
            }
          }

          // Ice completely gone -> cleanly drip off into gravity fall!
          g.state = 2;
          g.fallTime = 0;
          g.vx *= 0.28;
          g.vz *= 0.28;
          g.vy = Math.min(g.vy, -0.07);
        }

        // state === 2: final drip fall off bottom lip / stick tip
        g.fallTime += stepDt;
        g.vy -= 5.8 * stepDt;
        const drag = Math.exp(-stepDt * 1.2);
        g.vx *= drag;
        g.vz *= drag;
        g.px += g.vx * stepDt;
        g.py += g.vy * stepDt;
        g.pz += g.vz * stepDt;
        g.spin += 4.2 * stepDt;
        if (g.py < -5.2 || g.fallTime > 4.2) {
          g.state = 3;
        }
        writeGrainMatrix(i, g, 0, 0, 1);
      }

      if (anyUpdated) {
        tMesh.instanceMatrix.needsUpdate = true;
      }
    };
  }

  function evaluateFruitGrip(f: FruitItem, meltState: MeltFieldState, slideY = 0): number {
    const rawGrip = evaluateRawFruitGrip(f, meltState, slideY);
    const seatHold = f.seatOffset * (1.0 - smoothstep(0.52, 0.86, meltState.melt));
    return rawGrip + seatHold - f.knockAccum;
  }

  /**
   * Exact full-detachment test for small flow-riding bits against the live rendered ice surface:
   * stays firmly frozen (>0) until the ice skin genuinely melts past the bit's body so it sits
   * completely freed outside the surface — with organic per-bit stagger via `flowStickiness`.
   */
  function evaluateSmallBitGrip(
    f: FruitItem,
    frame: ProfileFrameCache,
    meltState: MeltFieldState,
    slideY: number,
  ): number {
    const rCol = fruitCollisionRadius(f);
    const isFlat = FRUIT_PHYSICS[f.kind].isFlat;
    sampleExactIceSurface(f.basePos.x, f.basePos.y + slideY, f.basePos.z, frame, meltState, physExactSurf);
    if (physExactSurf.iceGone) return -1.0;

    // Require the bit to be genuinely protruding OUTSIDE the exact live surface (not half-buried in solid fudge!)
    const releaseOut = isFlat
      ? 0.005 + f.flowStickiness * 0.012
      : rCol * (0.42 + f.flowStickiness * 0.46);
    const clearanceLeft = releaseOut - physExactSurf.signedOut;

    // Also require real melt erosion from this bit's frozen frame-0 seat so shallow milk inlays never pop early
    const surfaceRetreat = physExactSurf.signedOut - f.baseSignedOut0;
    const minRetreat =
      (isFlat ? 0.010 + f.flowStickiness * 0.018 : rCol * (0.46 + f.flowStickiness * 0.54)) *
      (1.0 - smoothstep(0.68, 0.88, meltState.melt));
    const retreatLeft = minRetreat - surfaceRetreat;

    // Falling heavy berries knocking an already-exposed small bit can break its capillary cling early
    const knockRelief = physExactSurf.signedOut > rCol * 0.12 ? f.knockAccum : 0;
    return Math.max(clearanceLeft, retreatLeft) - knockRelief;
  }

  function applyPreReleasePose(f: FruitItem, grip: number, slideY = 0) {
    const gripFull = Math.max(0.045, f.radius * 0.48);
    f.exposure = clamp(1.0 - smoothstep(0.0, gripFull, grip), 0, 1);

    // Small melt-flow bits stay completely frozen in place until fully detached — never creeping inside solid ice!
    if (isSmallFlowBit(f)) {
      f.mesh.position.set(
        f.basePos.x + f.jostlePos.x * 0.4,
        f.basePos.y + slideY + f.jostlePos.y * 0.4,
        f.basePos.z + f.jostlePos.z * 0.4,
      );
      f.mesh.quaternion.copy(f.baseQuat);
      f.mesh.scale.copy(f.baseScale);
      if (f.thawUniform) {
        f.thawUniform.value = smoothstep(0.15, 0.85, f.exposure);
      }
      return;
    }

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
    prepareProfileFrame(meltState, liveProfileFrame);
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

      const smallBit = isSmallFlowBit(f);
      const grip = smallBit
        ? evaluateSmallBitGrip(f, liveProfileFrame, meltState, slideY)
        : evaluateFruitGrip(f, meltState, slideY);
      const shouldRelease = iceGone || (meltState.melt > (smallBit ? 0.10 : 0.14) && grip <= 0);

      if (dt === 0) {
        if (shouldRelease) {
          f.detached = true;
          f.flowRiding = false;
          f.flowTime = 0;
          f.mesh.visible = false;
        } else {
          f.detached = false;
          f.detachTime = 0;
          f.flowRiding = false;
          f.flowTime = 0;
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
          f.flowRiding = !iceGone && smallBit;
          f.flowTime = 0;
          const rCol = fruitCollisionRadius(f);
          if (f.flowRiding) {
            // Start gently from rest on the wet surface so bits ooze into motion instead of snapping to cruise speed!
            f.cavityDepth = 0;
            f.stickCavity = 0;
            f.wetContact = 1.0;
            f.velocity.set(0, -0.012 * f.flowSpeedBias, 0);
            f.angVel.set(0, 0, 0);
            f.bendVel = 0;
            if (f.thawUniform) f.thawUniform.value = 1.0;
            continue;
          }
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

    if (dt <= 0) {
      updateTajin?.(meltState, 0);
      return;
    }

    // Pass 2: 4-substep 3D Rigid-Body + Wet-Syrup Slide + Stick Bounce + Fruit-to-Fruit Collision + Aerodynamics!
    const substeps = 4;
    const subDt = Math.min(0.05, dt) / substeps;
    const iceHalfWBound = POPSICLE.halfWidthBottom + 0.28;
    const iceHalfDBound = POPSICLE.halfDepth + 0.28;

    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      if (!f.detached || !f.mesh.visible || f.grabbed) continue;
      if (f.flowRiding) {
        f.flowTime += dt;
      } else {
        f.detachTime += dt;
      }
    }

    for (let s = 0; s < substeps; s++) {
      // 2a. Forces, integration, wet-ice SDF sliding/bouncing, wooden stick bounce, and embedded-fruit collisions
      for (let i = 0; i < fruits.length; i++) {
        const f = fruits[i];
        if (!f.detached || !f.mesh.visible || f.grabbed) continue;

        const prof = FRUIT_PHYSICS[f.kind];
        const rCol = fruitCollisionRadius(f);

        // === VISCOUS MELT-FLOW RIDING FOR SMALL BITS (shaved lemon, chocolate pearls, fine cookie crumbs, tiny bits) ===
        // Once completely released outside the exact live ice surface, bits ooze & meander down the wet syrup film
        // with natural per-bit speed & stick-slip variation, strictly OUTSIDE the rendered ice cream mesh (never re-entering!).
        if (f.flowRiding) {
          const px = f.mesh.position.x;
          const py = f.mesh.position.y;
          const pz = f.mesh.position.z;

          // 1. BELOW STICK TIP: Follow the vertical dripping syrup filament cleanly off-screen!
          if (py <= POPSICLE.stickBottomY + 0.008 && Math.abs(px) < STICK_HALF_W + 0.08 + rCol) {
            const dBelow = Math.max(0, POPSICLE.stickBottomY - py);
            const swayAmp = smoothstep(0.05, 0.65, dBelow) * 0.0045;
            const cx = Math.sin(dBelow * 4.0 - meltState.time * 1.4) * swayAmp;
            const cz = Math.cos(dBelow * 3.2 - meltState.time * 1.1) * swayAmp * 0.65;
            const filRad = Math.max(0.010, rCol * 0.32) + 0.012 * Math.exp(-dBelow / 0.045);
            const rx = px - cx;
            const rz = pz - cz;
            const rDist = Math.hypot(rx, rz);
            const pullRate = 1.0 - Math.exp(-subDt * 14.0);
            if (rDist > filRad) {
              const targetScale = filRad / Math.max(1e-5, rDist);
              f.mesh.position.x += (cx + rx * targetScale - px) * Math.min(1, pullRate * 1.35);
              f.mesh.position.z += (cz + rz * targetScale - pz) * Math.min(1, pullRate * 1.35);
            } else {
              f.mesh.position.x += (cx - px) * pullRate * 0.18;
              f.mesh.position.z += (cz - pz) * pullRate * 0.18;
            }
            const filSpeed = (0.34 + 0.48 * smoothstep(0.0, 0.85, dBelow)) * (0.72 + f.flowSpeedBias * 0.36);
            const vDamp = 1.0 - Math.exp(-subDt * 9.0);
            f.velocity.x *= Math.exp(-subDt * 12.0);
            f.velocity.z *= Math.exp(-subDt * 12.0);
            f.velocity.y += (-filSpeed - f.velocity.y) * vDamp;
            f.mesh.position.y += f.velocity.y * subDt;
            const wMagF = f.angVel.length();
            if (wMagF > 1e-4) {
              spinAxis.copy(f.angVel).divideScalar(wMagF);
              spinQuat.setFromAxisAngle(spinAxis, wMagF * subDt);
              f.mesh.quaternion.premultiply(spinQuat);
              f.mesh.quaternion.normalize();
            }
            f.wetContact += (1.0 - f.wetContact) * Math.min(1, subDt * 12.0);
            continue;
          }

          // 2. ON WET BIRCH STICK: Only hand off once the bit has crept right to the stick collar,
          // then hug smoothly with dt-scaled meniscus attraction (zero sudden multi-frame horizontal snap!).
          const onStickBand =
            py <= yBotLive + 0.014 &&
            Math.abs(px) < STICK_HALF_W + 0.024 + rCol * 0.8 &&
            Math.abs(pz) < STICK_HALF_D + 0.036 + rCol * 0.8;

          if (onStickBand) {
            const dStick = sampleStickSDF(px, py, pz, physStickN);
            const stickPulse = 0.5 + 0.45 * Math.sin(py * 6.5 + f.flowPhase + f.flowTime * 1.1);
            const stickSpeed =
              (0.085 + 0.17 * smoothstep(0.16, 0.80, meltState.melt)) *
              f.flowSpeedBias *
              (0.26 + 0.92 * stickPulse * stickPulse);
            const damp = 1.0 - Math.exp(-subDt * 8.5);
            const nearArch = smoothstep(STICK_BOT_ARCH_Y + 0.14, POPSICLE.stickBottomY + 0.008, py);
            const dyArc = clamp(STICK_BOT_ARCH_Y - py, 0, STICK_HALF_W);
            const woodHalfW = Math.sqrt(Math.max(0, STICK_HALF_W * STICK_HALF_W - dyArc * dyArc));
            const maxXAtY = Math.max(0.014, woodHalfW * (1.0 - nearArch * 0.45) + rCol * 0.45);

            f.velocity.x +=
              (Math.sin(py * 11.0 + f.flowPhase) * 0.010 * (1.0 - nearArch * 0.9) -
                px * (0.14 + nearArch * 5.6) * Math.max(0.14, stickSpeed) -
                f.velocity.x) *
              damp;
            f.velocity.y += (-stickSpeed - f.velocity.y) * damp;
            f.velocity.z += (-pz * (0.65 + nearArch * 4.8) * Math.max(0.14, stickSpeed) - f.velocity.z) * damp;
            f.mesh.position.addScaledVector(f.velocity, subDt);

            if (f.mesh.position.y < STICK_BOT_ARCH_Y && Math.abs(f.mesh.position.x) > maxXAtY) {
              f.mesh.position.x = Math.sign(f.mesh.position.x) * maxXAtY;
            }
            const targetStickDist = prof.isFlat ? 0.008 : rCol * 0.60;
            const errS = targetStickDist - dStick;
            if (errS > 0) {
              f.mesh.position.addScaledVector(physStickN, errS);
            } else {
              // Smooth dt-scaled viscous meniscus hug onto the wood (never teleports across the collar!)
              const pullAlpha = 1.0 - Math.exp(-subDt * 5.5);
              f.mesh.position.addScaledVector(physStickN, Math.max(errS * pullAlpha, -0.22 * subDt));
            }
            physRollAxis.crossVectors(physStickN, f.velocity).divideScalar(Math.max(0.04, rCol));
            f.angVel.lerp(physRollAxis.multiplyScalar(0.32), 1.0 - Math.exp(-subDt * 6.0));
            const wMagS = f.angVel.length();
            if (wMagS > 1e-4) {
              spinAxis.copy(f.angVel).divideScalar(wMagS);
              spinQuat.setFromAxisAngle(spinAxis, wMagS * subDt);
              f.mesh.quaternion.premultiply(spinQuat);
              f.mesh.quaternion.normalize();
            }
            f.wetContact += (1.0 - f.wetContact) * Math.min(1, subDt * 12.0);
            continue;
          }

          // 3. ON POPSICLE BODY & STICKY UNDERSIDE RIM: Cling tightly along sticky underside & creep smoothly inward to the stick!
          if (!iceGone && Math.abs(px) < iceHalfWBound + rCol + 0.06 && Math.abs(pz) < iceHalfDBound + rCol + 0.06) {
            sampleExactIceSurface(px, py, pz, liveProfileFrame, meltState, physExactSurf);
            physN.set(physExactSurf.nx, physExactSurf.ny, physExactSurf.nz);

            if (!physExactSurf.iceGone) {
              const rideOut = prof.isFlat ? 0.009 : rCol * 0.62;
              const onStickyUnderside = py <= yBotLive + 0.032 || physN.y <= -0.62;
              if (onStickyUnderside) {
                const targetX = clamp(px, -STICK_HALF_W * 0.88, STICK_HALF_W * 0.88);
                const dirX = clamp((targetX - px) * 14.0, -1, 1);
                const dirZ = clamp(-pz * 9.0, -1, 1);
                const pulse = 0.5 + 0.42 * Math.sin(px * 12.0 + f.flowPhase + f.flowTime * 1.3);
                const creepSpeed = (0.068 + 0.125 * smoothstep(0.14, 0.78, meltState.melt)) * f.flowSpeedBias * (0.35 + 0.85 * pulse * pulse);
                const damp = 1.0 - Math.exp(-subDt * 7.5);
                f.velocity.x += (dirX * creepSpeed - f.velocity.x) * damp;
                f.velocity.z += (dirZ * creepSpeed * 0.85 - f.velocity.z) * damp;
                const rimTargetY = Math.min(physExactSurf.sy - rideOut * 0.55, yBotLive + 0.008);
                f.velocity.y += (clamp((rimTargetY - py) * 7.5, -0.09, 0.06) - f.velocity.y) * damp;
                f.mesh.position.addScaledVector(f.velocity, subDt);
                sampleExactIceSurface(f.mesh.position.x, f.mesh.position.y, f.mesh.position.z, liveProfileFrame, meltState, physExactSurf);
                physN.set(physExactSurf.nx, physExactSurf.ny, physExactSurf.nz);
                if (physExactSurf.signedOut < rideOut) {
                  f.mesh.position.addScaledVector(physN, rideOut - physExactSurf.signedOut);
                }
                f.wetContact += (1.0 - f.wetContact) * Math.min(1, subDt * 12.0);
                continue;
              }

              // Local downward tangent along the exact curved melting ice face: t = g - (g · N) N
              const gn = -physN.y;
              let tx = -gn * physN.x;
              let ty = -1.0 - gn * physN.y;
              let tz = -gn * physN.z;
              const tLen = Math.hypot(tx, ty, tz);
              if (tLen > 1e-4) {
                tx /= tLen;
                ty /= tLen;
                tz /= tLen;
              } else {
                tx = 0;
                ty = -1;
                tz = 0;
              }

              // Horizontal surface tangent for gentle meandering rivulet paths + flute valleys + full-width bottom stick funnel!
              let sx = physN.z;
              let sz = -physN.x;
              const sLen = Math.hypot(sx, sz);
              if (sLen > 1e-4) {
                sx /= sLen;
                sz /= sLen;
              } else {
                sx = 1;
                sz = 0;
              }
              const meander =
                Math.sin(py * 7.4 + f.flowPhase + meltState.time * (0.28 + f.flowSpeedBias * 0.18)) * 0.22 +
                Math.cos(px * 9.5 - py * 4.8 + f.flowPhase * 1.7) * 0.13;
              const nearestFluteX = px >= 0 ? POPSICLE.fluteX : -POPSICLE.fluteX;
              const flutePull = clamp((nearestFluteX - px) * 1.15, -0.15, 0.15) * (1.0 - smoothstep(0.35, 0.72, meltState.melt));

              const botZone = smoothstep(yBotLive + 0.30, yBotLive + 0.02, py);
              const stickTargetX = clamp(px, -STICK_HALF_W * 0.85, STICK_HALF_W * 0.85);
              const stickFunnelX = clamp((stickTargetX - px) * 2.8, -0.82, 0.82) * botZone;
              const stickFunnelZ = -Math.sign(pz || 1) * 0.48 * botZone;
              const sideDrift = (meander + flutePull * (physN.z >= 0 ? 1 : -1)) * (1.0 - botZone * 0.72);

              // Natural per-bit viscous creep: gentle break-away ramp + wide speed personality + organic stick-slip surges + heat!
              const startupRamp = 0.08 + 0.92 * smoothstep(0.0, 0.55 + f.flowStickiness * 0.95, f.flowTime);
              const pulse =
                0.5 +
                0.30 * Math.sin(py * 5.0 + f.flowPhase + meltState.time * (0.38 + f.flowSpeedBias * 0.34)) +
                0.24 * Math.sin(f.flowTime * (0.95 + f.flowStickiness * 0.85) + f.flowPhase * 2.3);
              const pClamped = clamp(pulse, 0, 1);
              const stickSlip = 0.16 + 1.18 * pClamped * pClamped;
              const sizeEase = clamp(0.036 / Math.max(0.016, f.radius), 0.58, 1.42);
              const slopeEase = 0.42 + 0.58 * Math.abs(ty);
              const localWarmth = sampleLocalHeat(px, py, meltState);
              const baseRunoff = 0.08 + 0.26 * smoothstep(0.14, 0.78, meltState.melt) + localWarmth * 0.24;
              const targetSpeed = baseRunoff * f.flowSpeedBias * sizeEase * slopeEase * startupRamp * stickSlip;

              const vTargetX = (tx + sx * sideDrift + stickFunnelX) * targetSpeed;
              const vTargetY = ty * targetSpeed;
              const vTargetZ = (tz + sz * sideDrift + stickFunnelZ) * targetSpeed;

              const damp = 1.0 - Math.exp(-subDt * 7.5);
              f.velocity.x += (vTargetX - f.velocity.x) * damp;
              f.velocity.y += (vTargetY - f.velocity.y) * damp;
              f.velocity.z += (vTargetZ - f.velocity.z) * damp;
              f.mesh.position.addScaledVector(f.velocity, subDt);

              // Strict one-way outer surface hug against the EXACT rendered popsicle mesh
              sampleExactIceSurface(f.mesh.position.x, f.mesh.position.y, f.mesh.position.z, liveProfileFrame, meltState, physExactSurf);
              physN.set(physExactSurf.nx, physExactSurf.ny, physExactSurf.nz);
              if (physExactSurf.signedOut < rideOut) {
                f.mesh.position.addScaledVector(physN, rideOut - physExactSurf.signedOut);
              } else {
                const pullIn = Math.min(physExactSurf.signedOut - rideOut, 0.045) * 0.70;
                f.mesh.position.addScaledVector(physN, -pullIn);
              }

              // Gentle rolling & alignment along the wet syrup flow
              physRollAxis.crossVectors(physN, f.velocity).divideScalar(Math.max(0.04, rCol));
              const rollAlpha = 1.0 - Math.exp(-subDt * 6.5);
              f.angVel.lerp(physRollAxis.multiplyScalar(prof.isFlat ? 0.18 : 0.42), rollAlpha);
              if (prof.isFlat) {
                physFaceN.set(0, 0, 1).applyQuaternion(f.mesh.quaternion);
                if (physFaceN.dot(physN) < 0) physFaceN.negate();
                physAeroTorque.crossVectors(physFaceN, physN);
                f.angVel.addScaledVector(physAeroTorque, 5.5 * subDt);
              }
              const wMagF = f.angVel.length();
              if (wMagF > 1e-4) {
                spinAxis.copy(f.angVel).divideScalar(wMagF);
                spinQuat.setFromAxisAngle(spinAxis, wMagF * subDt);
                f.mesh.quaternion.premultiply(spinQuat);
                f.mesh.quaternion.normalize();
              }
              f.wetContact += (1.0 - f.wetContact) * Math.min(1, subDt * 12.0);
              continue;
            }
          }

          // Ice completely gone -> cleanly release into gravity fall!
          f.flowRiding = false;
          f.flowTime = 0;
          f.detachTime = 0;
          f.velocity.x *= 0.28;
          f.velocity.z *= 0.28;
          f.velocity.y = Math.min(f.velocity.y, -0.06);
        }

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
          if (a.flowRiding && b.flowRiding) continue;
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

      // Despawn cleanly once well below camera frustum (never hide slow flow-riding bits mid-glide!)
      if (f.mesh.position.y < -5.2 || (!f.flowRiding && f.detachTime > 5.0)) {
        f.mesh.visible = false;
      }
    }

    updateTajin?.(meltState, dt);
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
    f.flowRiding = false;
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
      if (f.detached && !f.flowRiding && f.mesh.visible && (f.grabbed || (f.mesh.position.y > -1.95 && f.detachTime < 3.6))) {
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
    surfaceGroup,
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

/**
 * Local-dev Topping Debug Studio: builds reusable floating 3D specimens of every topping & variant
 * (reusing the exact same geometries & shaders as the live popsicle!) so toppings can be inspected
 * in mid-air outside the ice, side-by-side with the optical ice popsicle, or strictly inside the ice.
 */
export function createToppingDebugStage(seed = 1): ToppingDebugStage {
  const group = new THREE.Group();
  group.name = 'topping-debug-stage';
  group.visible = false;

  const disposables: Array<{ dispose(): void }> = [];
  interface StageItem {
    kind: ToppingId;
    variant: number;
    mesh: THREE.Mesh;
    baseRot: THREE.Euler;
    spinPhase: number;
    isAirHero?: boolean;
  }
  const items: StageItem[] = [];

  const raspTex = getCachedRaspberryTextures(seed);
  const strawTexA = getCachedStrawberryTextures(seed);
  const strawTexB = getCachedStrawberryTextures(seed + 1);
  const blueTexA = getCachedBlueberryTextures(seed);
  const blueTexB = getCachedBlueberryTextures(seed + 1);
  const chocTex = getCachedChocolateChunkTextures(seed);
  const lemonTex = getCachedLemonZestTextures(seed);
  const kakaDarkTex = getCachedKaksmulorTextures(seed, 'dark');
  const kakaButterTex = getCachedKaksmulorTextures(seed, 'butter');

  const raspMat = createRaspberryMaterial(raspTex, 1.0).material;
  const strawMatA = createStrawberryMaterial(strawTexA).material;
  const strawMatB = createStrawberryMaterial(strawTexB).material;
  const blueExposedA = createBlueberryMaterial(blueTexA);
  blueExposedA.uThaw.value = 1.0;
  const blueExposedB = createBlueberryMaterial(blueTexB);
  blueExposedB.uThaw.value = 1.0;
  const chocMat = createChocolateMaterial(chocTex);
  const lemonMat = createLemonZestMaterial(lemonTex);
  const kakaDarkMat = createKaksmulorMaterial(kakaDarkTex);
  const kakaButterMat = createKaksmulorMaterial(kakaButterTex);
  disposables.push(
    raspMat,
    strawMatA,
    strawMatB,
    blueExposedA.material,
    blueExposedB.material,
    chocMat,
    lemonMat,
    kakaDarkMat,
    kakaButterMat,
  );

  function addSpecimen(
    kind: ToppingId,
    variant: number,
    rot: [number, number, number],
    seedOffset: number,
    isAirHero = false,
  ): StageItem {
    let geo: THREE.BufferGeometry;
    let mat: THREE.Material;
    switch (kind) {
      case 'raspberry':
        geo = createRaspberryGeometry(seed * 157 + seedOffset, variant);
        mat = raspMat;
        break;
      case 'strawberry':
        geo = createStrawberrySliceGeometry(seed * 131 + seedOffset, 0.17, variant);
        mat = variant % 2 === 0 ? strawMatA : strawMatB;
        break;
      case 'blueberry':
        geo = createBlueberryGeometry(seed * 149 + seedOffset, variant);
        mat = variant % 2 === 0 ? blueExposedA.material : blueExposedB.material;
        break;
      case 'chocolate':
        geo = createChocolateChunkGeometry(seed * 163 + seedOffset);
        mat = chocMat;
        break;
      case 'shaved-lemon':
        geo = createLemonZestGeometry(seed * 173 + seedOffset);
        mat = lemonMat;
        break;
      case 'kaksmulor':
        geo = createKaksmulorGeometry(seed * 179 + seedOffset, variant < 2);
        mat = variant % 2 === 1 ? kakaButterMat : kakaDarkMat;
        break;
      case 'tajin':
        geo = createTajinFlakeGeometry(seed * 313 + seedOffset);
        mat = createTajinMaterial(false);
        (mat as THREE.MeshStandardMaterial).color.set('#c83c0c');
        disposables.push(mat);
        break;
    }
    disposables.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    const baseRot = new THREE.Euler(rot[0], rot[1], rot[2]);
    mesh.rotation.copy(baseRot);
    mesh.visible = false;
    group.add(mesh);
    const item: StageItem = { kind, variant, mesh, baseRot, spinPhase: seedOffset * 0.37, isAirHero };
    items.push(item);
    return item;
  }

  // Create curated specimens for every topping & key organic variant
  const raspWhole = addSpecimen('raspberry', 0, [0.16, 0.35, -0.10], 11, true);
  const raspHalf = addSpecimen('raspberry', 2, [0.12, -0.45, 0.18], 23);
  const raspQuarter = addSpecimen('raspberry', 3, [0.24, 0.52, -0.22], 37);
  const raspBit = addSpecimen('raspberry', 4, [0.35, -0.25, 0.32], 51);
  const raspBall = addSpecimen('raspberry', 5, [0.18, 0.42, 0.10], 67);

  const strawWhole = addSpecimen('strawberry', 0, [0.14, -0.22, -0.18], 19);
  const strawHalf = addSpecimen('strawberry', 1, [-0.16, 0.28, 0.22], 31);
  const strawQuarter = addSpecimen('strawberry', 2, [0.22, -0.35, -0.28], 43);
  const strawPiece = addSpecimen('strawberry', 3, [0.38, 0.44, 0.18], 59);

  const bluePlump = addSpecimen('blueberry', 0, [0.42, 0.28, -0.18], 13);
  const bluePressed = addSpecimen('blueberry', 1, [0.58, -0.42, 0.25], 29);
  const blueSquashed = addSpecimen('blueberry', 2, [0.28, 0.65, -0.35], 47);

  const chocA = addSpecimen('chocolate', 0, [0.32, 0.48, -0.22], 17);
  const chocB = addSpecimen('chocolate', 1, [-0.45, -0.32, 0.38], 41);

  const lemonA = addSpecimen('shaved-lemon', 0, [0.24, 0.42, -0.26], 21);
  const lemonB = addSpecimen('shaved-lemon', 1, [-0.32, -0.58, 0.34], 53);

  const kakaDark = addSpecimen('kaksmulor', 0, [0.28, -0.36, 0.18], 27);
  const kakaButter = addSpecimen('kaksmulor', 1, [-0.24, 0.52, -0.28], 61);
  const kakaCrumb = addSpecimen('kaksmulor', 2, [0.46, 0.18, 0.40], 73);

  function place(item: StageItem, x: number, y: number, z: number, scale: number) {
    item.mesh.visible = true;
    item.mesh.position.set(x, y, z);
    item.mesh.scale.setScalar(scale);
  }

  let spinTime = 0;

  function setLayout(mode: ToppingDebugMode, filter: ToppingDebugFilter, floatAirRaspberry: boolean) {
    for (const it of items) {
      it.mesh.visible = false;
    }

    if (mode === 'off' || mode === 'inside') {
      if (floatAirRaspberry) {
        group.visible = true;
        place(raspWhole, 1.06, 0.22, 0.08, 0.30);
        place(raspHalf, 1.06, -0.36, 0.06, 0.22);
        place(raspBall, 1.06, -0.76, 0.08, 0.12);
      } else {
        group.visible = false;
      }
      return;
    }

    group.visible = true;

    if (mode === 'both') {
      // Side-by-side comparison: popsicle sits at X = 0 while matching air specimens float beside it!
      if (filter === 'all') {
        // Right column: Raspberries (hero whole + half + loose ball) & Chocolate/Cookie
        place(raspWhole, 1.06, 0.44, 0.08, 0.30);
        place(raspHalf, 1.08, -0.08, 0.06, 0.22);
        place(raspBall, 1.46, 0.12, 0.08, 0.12);
        place(chocA, 1.04, -0.56, 0.04, 0.20);
        place(kakaDark, 1.46, -0.44, 0.04, 0.18);
        // Left column: Strawberry slice + cut wedge, Blueberry plump + squashed, Lemon curl
        place(strawWhole, -1.06, 0.44, 0.06, 0.28);
        place(strawQuarter, -1.46, 0.08, 0.06, 0.20);
        place(bluePlump, -1.04, -0.08, 0.06, 0.18);
        place(blueSquashed, -1.44, -0.36, 0.06, 0.17);
        place(lemonA, -1.04, -0.56, 0.06, 0.22);
      } else if (filter === 'raspberry') {
        place(raspWhole, 1.04, 0.48, 0.08, 0.33);
        place(raspHalf, 1.04, -0.04, 0.06, 0.22);
        place(raspQuarter, -1.06, 0.38, 0.06, 0.24);
        place(raspBit, -1.06, -0.14, 0.06, 0.20);
        place(raspBall, -1.04, -0.56, 0.08, 0.14);
      } else if (filter === 'strawberry') {
        place(strawWhole, 1.08, 0.34, 0.06, 0.32);
        place(strawHalf, 1.08, -0.28, 0.06, 0.26);
        place(strawQuarter, -1.08, 0.28, 0.06, 0.25);
        place(strawPiece, -1.06, -0.30, 0.06, 0.20);
      } else if (filter === 'blueberry') {
        place(bluePlump, 1.06, 0.30, 0.06, 0.24);
        place(bluePressed, 1.06, -0.28, 0.06, 0.22);
        place(blueSquashed, -1.06, 0.04, 0.06, 0.24);
      } else if (filter === 'chocolate') {
        place(chocA, 1.06, 0.22, 0.06, 0.26);
        place(chocB, -1.06, -0.10, 0.06, 0.24);
      } else if (filter === 'shaved-lemon') {
        place(lemonA, 1.06, 0.22, 0.06, 0.28);
        place(lemonB, -1.06, -0.10, 0.06, 0.26);
      } else if (filter === 'kaksmulor') {
        place(kakaDark, 1.06, 0.28, 0.06, 0.24);
        place(kakaButter, -1.06, 0.18, 0.06, 0.24);
        place(kakaCrumb, 1.06, -0.30, 0.06, 0.18);
      }
      return;
    }

    // mode === 'outside': unobstructed macro studio stage in mid-air (kept clear of bottom-right debug panel!)
    if (filter === 'all') {
      // Top row: Raspberry family + Hero Strawberry
      place(raspWhole, -1.20, 0.40, 0.04, 0.31);
      place(raspHalf, -0.54, 0.42, 0.04, 0.25);
      place(raspQuarter, 0.04, 0.42, 0.04, 0.22);
      place(raspBit, 0.50, 0.46, 0.04, 0.17);
      place(raspBall, 0.50, 0.18, 0.06, 0.12);
      place(strawWhole, 1.02, 0.38, 0.02, 0.29);

      // Bottom row: kept cleanly clear of the open bottom-right Topping Debug panel!
      place(strawQuarter, -1.32, -0.32, 0.04, 0.22);
      place(bluePlump, -0.90, -0.32, 0.04, 0.19);
      place(blueSquashed, -0.50, -0.32, 0.04, 0.18);
      place(chocA, -0.10, -0.32, 0.04, 0.19);
      place(lemonA, 0.26, -0.32, 0.04, 0.20);
      place(kakaDark, 0.60, -0.32, 0.04, 0.18);
    } else if (filter === 'raspberry') {
      // Macro hero showcase for inspecting side-lit translucency on every drupelet!
      place(raspWhole, -0.26, 0.04, 0.06, 0.48);
      place(raspHalf, 0.74, 0.42, 0.04, 0.28);
      place(raspQuarter, 0.80, -0.08, 0.04, 0.24);
      place(raspBit, 0.64, -0.54, 0.04, 0.21);
      place(raspBall, 0.14, -0.56, 0.06, 0.16);
    } else if (filter === 'strawberry') {
      place(strawWhole, -0.56, 0.14, 0.04, 0.40);
      place(strawHalf, 0.34, 0.28, 0.04, 0.32);
      place(strawQuarter, 0.36, -0.32, 0.04, 0.28);
      place(strawPiece, -0.52, -0.44, 0.06, 0.22);
    } else if (filter === 'blueberry') {
      place(bluePlump, -0.62, 0.04, 0.04, 0.32);
      place(bluePressed, 0.04, 0.06, 0.04, 0.30);
      place(blueSquashed, 0.68, 0.02, 0.04, 0.30);
    } else if (filter === 'chocolate') {
      place(chocA, -0.44, 0.04, 0.04, 0.34);
      place(chocB, 0.46, 0.02, 0.04, 0.32);
    } else if (filter === 'shaved-lemon') {
      place(lemonA, -0.44, 0.04, 0.04, 0.36);
      place(lemonB, 0.46, 0.02, 0.04, 0.34);
    } else if (filter === 'kaksmulor') {
      place(kakaDark, -0.58, 0.04, 0.04, 0.30);
      place(kakaButter, 0.08, 0.06, 0.04, 0.30);
      place(kakaCrumb, 0.66, 0.00, 0.04, 0.24);
    }
  }

  function update(dt: number, spin: boolean) {
    if (!group.visible) return;
    if (spin && dt > 0) {
      spinTime += dt;
    }
    for (const it of items) {
      if (!it.mesh.visible) continue;
      if (spin) {
        it.mesh.rotation.set(
          it.baseRot.x + Math.sin(spinTime * 0.45 + it.spinPhase) * 0.14,
          it.baseRot.y + spinTime * 0.55,
          it.baseRot.z,
        );
      } else {
        it.mesh.rotation.copy(it.baseRot);
      }
    }
  }

  function dispose() {
    for (const d of disposables) d.dispose();
  }

  return { group, setLayout, update, dispose };
}

/**
 * Builds a centered studio-scaled 3D specimen for rendering high-DPI Customize topping thumbnails
 * using the exact procedural fruit/chunk meshes and materials from inside the popsicle.
 */
export function createToppingThumbSpecimen(
  kind: ToppingId,
  seed = 1,
): { object: THREE.Group; dispose(): void } {
  const object = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];

  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    rot: [number, number, number],
    scale: number,
  ) => {
    disposables.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.set(rot[0], rot[1], rot[2]);
    m.scale.setScalar(scale);
    object.add(m);
  };

  switch (kind) {
    case 'strawberry': {
      const mat = createStrawberryMaterial(getCachedStrawberryTextures(seed)).material;
      disposables.push(mat);
      add(createStrawberrySliceGeometry(seed * 131 + 19, 0.19, 0), mat, [0, -0.02, 0], [0.24, -0.34, -0.22], 0.68);
      break;
    }
    case 'blueberry': {
      const blueA = createBlueberryMaterial(getCachedBlueberryTextures(seed));
      blueA.uThaw.value = 0.0;
      const blueB = createBlueberryMaterial(getCachedBlueberryTextures(seed + 1));
      blueB.uThaw.value = 0.0;
      disposables.push(blueA.material, blueB.material);
      add(createBlueberryGeometry(seed * 149 + 13, 0), blueA.material, [-0.14, 0.05, 0.08], [0.46, 0.34, -0.18], 0.44);
      add(createBlueberryGeometry(seed * 149 + 29, 0), blueB.material, [0.24, -0.14, -0.04], [0.62, -0.45, 0.24], 0.34);
      break;
    }
    case 'raspberry': {
      const mat = createRaspberryMaterial(getCachedRaspberryTextures(seed), 1.0).material;
      disposables.push(mat);
      add(createRaspberryGeometry(seed * 157 + 11, 0), mat, [0, -0.02, 0], [0.26, 0.42, -0.14], 0.72);
      break;
    }
    case 'shaved-lemon': {
      const mat = createLemonZestMaterial(getCachedLemonZestTextures(seed));
      disposables.push(mat);
      add(createLemonZestGeometry(seed * 173 + 21), mat, [-0.08, 0.08, 0.06], [0.42, 0.34, -0.38], 0.74);
      add(createLemonZestGeometry(seed * 173 + 53), mat, [0.16, -0.14, -0.02], [-0.36, -0.44, 0.52], 0.64);
      add(createLemonZestGeometry(seed * 173 + 89), mat, [-0.14, -0.18, 0.12], [0.22, 0.68, 0.26], 0.48);
      break;
    }
    case 'chocolate': {
      const mat = createChocolateMaterial(getCachedChocolateChunkTextures(seed));
      disposables.push(mat);
      add(createChocolateChunkGeometry(seed * 163 + 17), mat, [-0.18, 0.14, 0.06], [0.42, 0.36, -0.18], 0.34);
      add(createChocolateChunkGeometry(seed * 163 + 41), mat, [0.22, -0.04, -0.02], [-0.38, -0.44, 0.32], 0.30);
      add(createChocolateChunkGeometry(seed * 163 + 73), mat, [-0.04, -0.26, 0.12], [0.55, -0.22, 0.44], 0.24);
      break;
    }
    case 'kaksmulor': {
      const darkMat = createKaksmulorMaterial(getCachedKaksmulorTextures(seed, 'dark'));
      const butterMat = createKaksmulorMaterial(getCachedKaksmulorTextures(seed, 'butter'));
      disposables.push(darkMat, butterMat);
      add(createKaksmulorGeometry(seed * 179 + 27, true), darkMat, [-0.16, 0.08, 0.05], [0.32, -0.38, 0.22], 0.44);
      add(createKaksmulorGeometry(seed * 179 + 61, true), butterMat, [0.20, -0.10, 0.02], [-0.26, 0.48, -0.24], 0.38);
      add(createKaksmulorGeometry(seed * 179 + 73, false), darkMat, [0.04, -0.28, 0.14], [0.46, 0.18, 0.40], 0.24);
      break;
    }
    case 'tajin': {
      // Sculptural floating mid-air Tajín chili-spice mound/pinch burst matching the bold visual weight of other toppings!
      const tGeo = createTajinFlakeGeometry(seed * 313 + 17);
      const tMat = createTajinMaterial(false);
      tMat.roughness = 0.72;
      const count = 340;
      const inst = new THREE.InstancedMesh(tGeo, tMat, count);
      disposables.push(tGeo, tMat);
      const rand = mulberry32(seed * 521 + 89);
      const col = new THREE.Color();
      const scl = new THREE.Vector3();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const eul = new THREE.Euler();
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < count; i++) {
        // Lush dense conical/organic Tajín spice pinch core (33% coarse flakes + 66% fine powder!) + airy outer dust
        const isCore = i < 255;
        const rRad = isCore ? Math.pow(rand(), 0.58) * 0.44 : 0.38 + Math.pow(rand(), 0.85) * 0.24;
        const th = rand() * Math.PI * 2;
        const ph = Math.acos(2 * rand() - 1);
        const cx = Math.sin(ph) * Math.cos(th) * rRad * 1.15;
        const cy = Math.cos(ph) * rRad * 0.86;
        const cz = Math.sin(ph) * Math.sin(th) * rRad * 0.65;
        pickTajinGrainStyle(rand, col, scl, isCore ? 5.2 : 3.8);
        inst.setColorAt(i, col);
        pos.set(cx, cy, cz);
        eul.set(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2);
        quat.setFromEuler(eul);
        m4.compose(pos, quat, scl);
        inst.setMatrixAt(i, m4);
      }
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.instanceMatrix.needsUpdate = true;
      object.add(inst);
      break;
    }
  }

  return {
    object,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
