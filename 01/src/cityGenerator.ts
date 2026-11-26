import {
  MM,
  buildHouseNet,
  generateHouseSpec,
  polygonsOverlap,
  type GableProfile,
  type HouseMixOptions,
  type HouseNetSpec,
  type RoofType,
  type V2,
} from './origamiHouseNet';

export const CITY_CHUNK_SIZE = 44;

export type CityStreetStyle = 'mix' | 'organic' | 'grid' | 'radial';
export type ConcreteStreetStyle = 'organic' | 'grid' | 'radial';

export const ALL_CITY_STREET_STYLES: readonly CityStreetStyle[] = ['mix', 'organic', 'grid', 'radial'];

/**
 * Analytic seeded coastal harmonics shared 1:1 between CPU terrain/chunk generation
 * and the GPU paper sea shader for exact shoreline ripples and cove depth tinting.
 */
export interface CoastHarmonics {
  a1: number;
  f1: number;
  p1: number;
  a2: number;
  f2: number;
  p2: number;
  a3: number;
  f3: number;
  p3: number;
  a4: number;
  f4: number;
  p4: number;
}

export interface CityTerrainField {
  seed: number;
  /** Normalized relief amplitude (`0` = flat coastal quay, `1` = dramatic terraced cliffs) */
  hills: number;
  coastHarmonics: CoastHarmonics;
  /** Deterministic shoreline X coordinate at world Z (`x < coastX(z)` is sea, `x > coastX(z)` is city) */
  coastX(z: number): number;
  /** Analytical derivative `d(coastX)/dz` for aligning promenades, piers, and seawalls */
  coastSlopeZ(z: number): number;
  /** Signed inland distance (`> 0` land, `< 0` sea) */
  signedInland(x: number, z: number): number;
  /** Evaluate continuous infinite elevation (`< 0` seafloor, `0` shoreline, `> 0` coastal city & hills) */
  heightAt(x: number, z: number): number;
  /** Resolve deterministic district topology at world `(x, z)` */
  districtStyleAt(x: number, z: number, styleOverride: CityStreetStyle): ConcreteStreetStyle;
}

export interface CityContourSegment {
  a: [number, number];
  b: [number, number];
  y: number;
  isMajor: boolean;
}

export interface CityStreet {
  id: string;
  kind: 'promenade' | 'avenue' | 'street' | 'lane';
  width: number;
  /** Ordered 2D world `(x, z)` polyline vertices */
  points: V2[];
}

export interface CityPlaza {
  x: number;
  z: number;
  radius: number;
}

export interface CityPier {
  x: number;
  z: number;
  yaw: number;
  length: number;
  width: number;
  deckY: number;
}

export interface CityBoat {
  x: number;
  z: number;
  yaw: number;
  scale: number;
  phase: number;
}

/**
 * Lightweight local-space architectural wing summary used by LOD1 & LOD2 merged chunk builders
 * so distant buildings match LOD0 origami silhouettes (gable, stepped, mansard, spire, composite wings)
 * without running `buildHouseNet` or creating per-building meshes.
 */
export interface CityWingMassing {
  /** Center offset in building-local world units `(x, z)` */
  cx: number;
  cz: number;
  /** Footprint extents in world units */
  W: number;
  D: number;
  /** Wall eave height in world units */
  H: number;
  roofType: RoofType;
  gableProfile: GableProfile;
  pitch: number;
  mansardRatio: number;
  /** Palette slot offset (0..3) for multi-colored wall-to-wall composites */
  colorSlot: number;
}

export interface CityBuildingPlot {
  id: string;
  chunkKey: string;
  /** Local index inside chunk (`0..27`) for GPU LOD0/LOD1 visibility handoff */
  index: number;
  x: number;
  z: number;
  /** World Y where the house base rests level (top of its architectural retaining plinth) */
  baseY: number;
  /** Lowest terrain elevation under the footprint (plinth extends cleanly below this) */
  groundMinY: number;
  /** Rotation around +Y so the building's street/sea-facing front (`+Z`) faces the curb */
  yaw: number;
  /** Exact 2D world `(x, z)` footprint polygon (4 corners, CCW) */
  footprint: V2[];
  /** Unrotated local `(W, D)` footprint extents in world units */
  footprintW: number;
  footprintD: number;
  /** Uniform architectural miniature scale applied to footprint, LOD massing, and LOD0 origami rig */
  scale: number;
  /** Simplified architectural massing wings for GPU LOD1/LOD2 rendering */
  wings: CityWingMassing[];
  /** Deterministic paper palette index (`0..7`) */
  colorIndex: number;
  /** Deterministic wave phase jitter (world units) for organic cascading fold motion */
  foldJitter: number;
  /** Exact generation + mix options so clicking any house loads it 1:1 in Fold View! */
  generation: number;
  mixOpts: HouseMixOptions;
  spec: HouseNetSpec;
  /** Normalized coastal proximity order (`0..1`) */
  foldOrder: number;
}

export interface CityTree {
  x: number;
  z: number;
  y: number;
  scale: number;
  rotY: number;
  variant: 0 | 1 | 2;
}

export interface CityChunkData {
  cx: number;
  cz: number;
  key: string;
  centerX: number;
  centerZ: number;
  districtStyle: ConcreteStreetStyle;
  hasLand: boolean;
  hasSea: boolean;
  hasCoast: boolean;
  streets: CityStreet[];
  plazas: CityPlaza[];
  plots: CityBuildingPlot[];
  trees: CityTree[];
  piers: CityPier[];
  boats: CityBoat[];
  rooftopCount: number;
}

export interface FlightSample {
  pos: [number, number, number];
  lookAt: [number, number, number];
  /** Normalized horizontal flight forward vector `(fx, fz)` */
  forward: [number, number];
  /** Glider bank roll in radians (`+` right bank, `-` left bank) */
  bankRoll: number;
  /** Sweeping fold-wave anchor slightly ahead of the lens */
  focusX: number;
  focusZ: number;
}

export interface CoastalWorldOptions {
  seed: number;
  style: CityStreetStyle;
  hills: number;
  consistency?: number | null;
  windowStyle?: HouseMixOptions['windowStyle'];
  windowOpening?: HouseMixOptions['windowOpening'];
  windowDetail?: HouseMixOptions['windowDetail'];
}

export interface CoastalWorld {
  seed: number;
  style: CityStreetStyle;
  hills: number;
  options: CoastalWorldOptions;
  terrain: CityTerrainField;
  generateChunk(cx: number, cz: number): CityChunkData;
  extractChunkContours(cx: number, cz: number, gridRes?: number, stepY?: number): CityContourSegment[];
  sampleFlight(s: number): FlightSample;
}

// ---------------------------------------------------------------------------
// Deterministic Seeded PRNG & Smooth Noise Primitives
// ---------------------------------------------------------------------------

function makeRng(seed: number) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a: number, b: number) => a + (b - a) * next(),
    int: (a: number, b: number) => Math.floor(a + (b - a + 1) * next()),
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
  };
}

function hash1i(i: number, seed: number): number {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(seed | 1, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash2i(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 1, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash2u32(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 1, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) || 1;
}

function valueNoise2D(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2i(ix, iz, seed);
  const b = hash2i(ix + 1, iz, seed);
  const c = hash2i(ix, iz + 1, seed);
  const d = hash2i(ix + 1, iz + 1, seed);
  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Infinite Deterministic Coastal Terrain & Coastline Field
// ---------------------------------------------------------------------------

/**
 * Create a continuous, infinite, deterministic coastal paper topography:
 *  - `x < coastX(z)` is the folded paper sea (with occasional sculptural offshore islets),
 *  - `x ≈ coastX(z)` rises via a crisp architectural seawall quay shelf above `y = 0`,
 *  - `x > coastX(z)` climbs into tiered rolling hills, valleys, and coastal headlands.
 */
export function createTerrainField(seed: number, hills01: number): CityTerrainField {
  const s = Math.max(0, Math.round(seed));
  const hills = Math.max(0, Math.min(1, hills01));
  const rng = makeRng((s * 7919 + 4129) >>> 0);

  // 4 incommensurate seeded coastal harmonics — identical on CPU and GPU sea shader!
  const coastHarmonics: CoastHarmonics = {
    a1: rng.range(18.0, 25.0),
    f1: 0.0041,
    p1: rng.range(0, Math.PI * 2),
    a2: rng.range(10.5, 16.0),
    f2: 0.0097,
    p2: rng.range(0, Math.PI * 2),
    a3: rng.range(5.2, 8.8),
    f3: 0.0183,
    p3: rng.range(0, Math.PI * 2),
    a4: rng.range(2.0, 3.8),
    f4: 0.0317,
    p4: rng.range(0, Math.PI * 2),
  };

  const nSeed1 = (s * 131 + 17) >>> 0;
  const nSeed2 = (s * 521 + 97) >>> 0;
  const nSeed3 = (s * 997 + 211) >>> 0;
  const isletSeed = (s * 1613 + 389) >>> 0;

  const coastX = (z: number): number =>
    coastHarmonics.a1 * Math.sin(z * coastHarmonics.f1 + coastHarmonics.p1) +
    coastHarmonics.a2 * Math.sin(z * coastHarmonics.f2 + coastHarmonics.p2) +
    coastHarmonics.a3 * Math.cos(z * coastHarmonics.f3 + coastHarmonics.p3) +
    coastHarmonics.a4 * Math.sin(z * coastHarmonics.f4 + coastHarmonics.p4);

  const coastSlopeZ = (z: number): number =>
    coastHarmonics.a1 * coastHarmonics.f1 * Math.cos(z * coastHarmonics.f1 + coastHarmonics.p1) +
    coastHarmonics.a2 * coastHarmonics.f2 * Math.cos(z * coastHarmonics.f2 + coastHarmonics.p2) -
    coastHarmonics.a3 * coastHarmonics.f3 * Math.sin(z * coastHarmonics.f3 + coastHarmonics.p3) +
    coastHarmonics.a4 * coastHarmonics.f4 * Math.cos(z * coastHarmonics.f4 + coastHarmonics.p4);

  const signedInland = (x: number, z: number): number => x - coastX(z);

  const heightAt = (x: number, z: number): number => {
    const cx = coastX(z);
    const d = x - cx;

    if (d <= 0) {
      // Gentle sloping seabed + occasional sculptural coastal paper islets offshore!
      const seaDepth = -smoothstep(0, 14, -d) * 2.2 - 0.06;
      if (d < -16 && d > -95) {
        const isl = valueNoise2D(x * 0.026 + 4.2, z * 0.026 - 9.1, isletSeed);
        if (isl > 0.77) {
          const mound = smoothstep(0.77, 0.94, isl) * (2.6 + hills * 4.4);
          return seaDepth + mound;
        }
      }
      return seaDepth;
    }

    // Gently sloping sandy paper beach rising cleanly from the water's edge to the waterfront promenade!
    const quayRise = smoothstep(0, 6.2, d) * 0.84;
    if (hills <= 1e-4) {
      return quayRise;
    }

    // Headland factor: promontories jutting seaward (lower coastX) rise slightly bolder into cliffs
    const headlandBoost = smoothstep(14, -22, cx) * 0.36;

    // Multi-octave smooth coastal hills & amphitheater rising gently inland
    const n1 = valueNoise2D(x * 0.0135 + 11.3, z * 0.0135 - 7.1, nSeed1);
    const n2 = valueNoise2D(x * 0.030 - 3.7, z * 0.030 + 19.2, nSeed2);
    const n3 = valueNoise2D(x * 0.064 + 23.5, z * 0.064 - 14.8, nSeed3);

    const fbm = n1 * 0.62 + n2 * 0.27 + n3 * 0.11;
    // Keep the sandy beach, waterfront promenade & first row of harbor houses gently sloped before rolling up into hills!
    const coastalTerrace = smoothstep(7.5, 29, d) * (0.36 + headlandBoost * 0.85);
    const inlandRamp = smoothstep(14, 108, d);
    const relief =
      (coastalTerrace * (0.48 + fbm * 0.72) + inlandRamp * (0.44 + fbm * 1.28 + headlandBoost * 0.45)) *
      (hills * 10.6);

    return quayRise + relief;
  };

  const districtStyleAt = (_x: number, z: number, styleOverride: CityStreetStyle): ConcreteStreetStyle => {
    if (styleOverride !== 'mix') return styleOverride;
    // Deterministic coastal districts every ~132 world units (3 chunks) along the coastline!
    const distIdx = Math.floor(z / (CITY_CHUNK_SIZE * 3));
    const r = hash1i(distIdx, s * 313 + 71);
    if (r < 0.44) return 'organic';
    if (r < 0.74) return 'grid';
    return 'radial';
  };

  return {
    seed: s,
    hills,
    coastHarmonics,
    coastX,
    coastSlopeZ,
    signedInland,
    heightAt,
    districtStyleAt,
  };
}

// ---------------------------------------------------------------------------
// Marching Squares Chunk Contour Extractor (Seam-Free Across Chunks!)
// ---------------------------------------------------------------------------

export function extractChunkContours(
  terrain: CityTerrainField,
  cx: number,
  cz: number,
  gridRes = 24,
  stepY = 0.65,
): CityContourSegment[] {
  const xStart = cx * CITY_CHUNK_SIZE;
  const zStart = cz * CITY_CHUNK_SIZE;
  const step = CITY_CHUNK_SIZE / gridRes;
  const stride = gridRes + 1;
  const heights = new Float32Array(stride * stride);

  let maxH = -Infinity;
  let minH = Infinity;
  for (let j = 0; j <= gridRes; j++) {
    const z = zStart + j * step;
    for (let i = 0; i <= gridRes; i++) {
      const x = xStart + i * step;
      const h = terrain.heightAt(x, z);
      heights[j * stride + i] = h;
      if (h > maxH) maxH = h;
      if (h < minH) minH = h;
    }
  }
  if (maxH < 0.35) return [];

  const minLv = Math.max(1, Math.floor(Math.max(0.45, minH) / stepY));
  const maxLv = Math.floor(maxH / stepY);
  const segs: CityContourSegment[] = [];

  for (let lv = minLv; lv <= maxLv; lv++) {
    const iso = lv * stepY;
    if (iso < 0.65) continue;
    const isMajor = lv % 4 === 0;
    for (let j = 0; j < gridRes; j++) {
      const z0 = zStart + j * step;
      const z1 = z0 + step;
      for (let i = 0; i < gridRes; i++) {
        const x0 = xStart + i * step;
        const x1 = x0 + step;
        const h00 = heights[j * stride + i];
        const h10 = heights[j * stride + (i + 1)];
        const h11 = heights[(j + 1) * stride + (i + 1)];
        const h01 = heights[(j + 1) * stride + i];

        const m =
          (h00 >= iso ? 1 : 0) |
          (h10 >= iso ? 2 : 0) |
          (h11 >= iso ? 4 : 0) |
          (h01 >= iso ? 8 : 0);
        if (m === 0 || m === 15) continue;

        const interp = (a: number, b: number, ha: number, hb: number) =>
          Math.abs(hb - ha) < 1e-6 ? (a + b) * 0.5 : a + ((iso - ha) / (hb - ha)) * (b - a);

        const e0: [number, number] = [interp(x0, x1, h00, h10), z0];
        const e1: [number, number] = [x1, interp(z0, z1, h10, h11)];
        const e2: [number, number] = [interp(x0, x1, h01, h11), z1];
        const e3: [number, number] = [x0, interp(z0, z1, h00, h01)];

        const push = (a: [number, number], b: [number, number]) => {
          segs.push({ a, b, y: iso, isMajor });
        };

        switch (m) {
          case 1:
          case 14:
            push(e3, e0);
            break;
          case 2:
          case 13:
            push(e0, e1);
            break;
          case 3:
          case 12:
            push(e3, e1);
            break;
          case 4:
          case 11:
            push(e1, e2);
            break;
          case 5:
            push(e3, e0);
            push(e1, e2);
            break;
          case 6:
          case 9:
            push(e0, e2);
            break;
          case 7:
          case 8:
            push(e3, e2);
            break;
          case 10:
            push(e0, e1);
            push(e3, e2);
            break;
        }
      }
    }
  }
  return segs;
}

// ---------------------------------------------------------------------------
// 2D Geometry & Street Helpers
// ---------------------------------------------------------------------------

function distPointToSeg(px: number, pz: number, a: V2, b: V2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-8) return Math.hypot(px - a[0], pz - a[1]);
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
}

function subdividePolyline(pts: V2[], maxSegLen = 2.4): V2[] {
  if (pts.length < 2) return pts;
  const out: V2[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(dist / maxSegLen));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function buildStreetRect(a: V2, b: V2, halfW: number, padEnd = 0): V2[] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const tx = dx / len;
  const tz = dz / len;
  const nx = -tz * halfW;
  const nz = tx * halfW;
  const ax = a[0] - tx * padEnd;
  const az = a[1] - tz * padEnd;
  const bx = b[0] + tx * padEnd;
  const bz = b[1] + tz * padEnd;
  return [
    [ax - nx, az - nz],
    [bx - nx, bz - nz],
    [bx + nx, bz + nz],
    [ax + nx, az + nz],
  ];
}

function makeBuildingOBB(cx: number, cz: number, yaw: number, halfW: number, halfD: number): V2[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pt = (lx: number, lz: number): V2 => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  return [pt(-halfW, -halfD), pt(halfW, -halfD), pt(halfW, halfD), pt(-halfW, halfD)];
}

/** Clip an arbitrary polyline to inland terrain (`signedInland >= minInland`) and chunk bounds */
function clipPolylineToLandAndBox(
  pts: V2[],
  terrain: CityTerrainField,
  minInland: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): V2[][] {
  const sub = subdividePolyline(pts, 2.2);
  const runs: V2[][] = [];
  let cur: V2[] = [];

  for (let i = 0; i < sub.length; i++) {
    const p = sub[i];
    const inLand = terrain.signedInland(p[0], p[1]) >= minInland;
    const inBox = p[0] >= minX && p[0] <= maxX && p[1] >= minZ && p[1] <= maxZ;
    if (inLand && inBox) {
      cur.push(p);
    } else {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

interface RawSegment {
  a: V2;
  b: V2;
  width: number;
  kind: CityStreet['kind'];
}

/**
 * Generate seamless, infinite, cross-chunk deterministic street networks for chunk `(cx, cz)`
 * according to the resolved district topology (`organic`, `grid`, or `radial`), plus the continuous
 * waterfront corniche promenade, coastal piers, and bay sailboats!
 */
function generateChunkStreets(
  cx: number,
  cz: number,
  districtStyle: ConcreteStreetStyle,
  terrain: CityTerrainField,
): {
  streets: CityStreet[];
  plazas: CityPlaza[];
  rawSegments: RawSegment[];
  piers: CityPier[];
  boats: CityBoat[];
} {
  const x0 = cx * CITY_CHUNK_SIZE;
  const x1 = x0 + CITY_CHUNK_SIZE;
  const z0 = cz * CITY_CHUNK_SIZE;
  const z1 = z0 + CITY_CHUNK_SIZE;
  const pad = 2.6;
  const seed = terrain.seed;

  const streets: CityStreet[] = [];
  const plazas: CityPlaza[] = [];
  const rawSegments: RawSegment[] = [];
  const piers: CityPier[] = [];
  const boats: CityBoat[] = [];
  let sid = 0;

  const commitRun = (kind: CityStreet['kind'], width: number, pts: V2[]) => {
    if (pts.length < 2) return;
    const id = `s_${cx}_${cz}_${sid++}`;
    for (let i = 0; i < pts.length - 1; i++) {
      if (Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) > 0.25) {
        rawSegments.push({ a: pts[i], b: pts[i + 1], width, kind });
      }
    }
    streets.push({ id, kind, width, points: pts });
  };

  // 1. Intimate Waterfront Corniche + Parallel Terraced Coastal Back-Alleys behind the warm sand beach!
  const emitCoastalRibbon = (offsetInland: number, kind: CityStreet['kind'], width: number) => {
    const ribbonPts: V2[] = [];
    const zSteps = 18;
    for (let i = 0; i <= zSteps; i++) {
      const z = z0 - 2 + (i / zSteps) * (CITY_CHUNK_SIZE + 4);
      const px = terrain.coastX(z) + offsetInland;
      if (px >= x0 - pad && px <= x1 + pad) {
        ribbonPts.push([px, z]);
      } else if (ribbonPts.length >= 2) {
        commitRun(kind, width, ribbonPts.slice());
        ribbonPts.length = 0;
      } else {
        ribbonPts.length = 0;
      }
    }
    if (ribbonPts.length >= 2) {
      commitRun(kind, width, ribbonPts);
    }
  };
  emitCoastalRibbon(6.4, 'promenade', 1.7);
  emitCoastalRibbon(13.4, 'lane', 1.0);
  emitCoastalRibbon(21.0, 'street', 1.18);

  // 2. Deterministic Coastal Piers & Folded Paper Sailboats in sheltered coves!
  const coastRng = makeRng(hash2u32(cx, cz, seed * 29 + 503));
  for (let pTry = 0; pTry < 2; pTry++) {
    const pz = z0 + 9 + pTry * 22 + coastRng.range(-4, 4);
    const edgeX = terrain.coastX(pz);
    if (edgeX >= x0 + 3 && edgeX <= x1 - 3 && Math.abs(terrain.coastSlopeZ(pz)) < 0.72) {
      if (coastRng.chance(0.58)) {
        const slope = terrain.coastSlopeZ(pz);
        // Seaward normal of `x = coastX(z)` points roughly `-X`: `(-1, slope)` normalized
        const nx = -1 / Math.hypot(1, slope);
        const nz = slope / Math.hypot(1, slope);
        const yaw = Math.atan2(nx, nz);
        const length = coastRng.range(10.5, 16.5);
        piers.push({
          x: edgeX + 5.1,
          z: pz,
          yaw,
          length,
          width: coastRng.range(1.45, 1.95),
          deckY: 0.80,
        });
      }
    }
  }

  // Deterministic folded origami sailboats anchored offshore in the bay
  for (let bTry = 0; bTry < 5; bTry++) {
    const bx = x0 + coastRng.range(4, CITY_CHUNK_SIZE - 4);
    const bz = z0 + coastRng.range(4, CITY_CHUNK_SIZE - 4);
    const inland = terrain.signedInland(bx, bz);
    if (inland < -7 && inland > -96 && terrain.heightAt(bx, bz) < -0.25 && coastRng.chance(0.55)) {
      boats.push({
        x: bx,
        z: bz,
        yaw: coastRng.range(0, Math.PI * 2),
        scale: coastRng.range(0.95, 1.65),
        phase: coastRng.range(0, Math.PI * 2),
      });
    }
  }

  // Early exit if the entire chunk is deep open sea (no land streets needed)
  let anyLand = false;
  for (let gz = z0; gz <= z1; gz += CITY_CHUNK_SIZE * 0.5) {
    if (x1 > terrain.coastX(gz) + 2) {
      anyLand = true;
      break;
    }
  }
  if (!anyLand) {
    return { streets, plazas, rawSegments, piers, boats };
  }

  // 3. District-specific deterministic infinite street topology (narrow intimate European/Japanese coastal blocks!)
  if (districtStyle === 'organic') {
    // Tight warped lattice (cell = 13.5) -> intimate curved coastal lanes & pocket plazas, ZERO seams!
    const CELL = 13.5;
    const nodePos = (ix: number, iz: number): V2 => {
      const jx = (hash2i(ix, iz, seed * 17 + 31) - 0.5) * 4.4;
      const jz = (hash2i(ix, iz, seed * 17 + 97) - 0.5) * 4.4;
      return [ix * CELL + jx, iz * CELL + jz];
    };

    const ix0 = Math.floor((x0 - 10) / CELL);
    const ix1 = Math.ceil((x1 + 10) / CELL);
    const iz0 = Math.floor((z0 - 10) / CELL);
    const iz1 = Math.ceil((z1 + 10) / CELL);

    const emitCurvedEdge = (a: V2, b: V2, edgeHash: number, isAve: boolean) => {
      const midX = (a[0] + b[0]) * 0.5;
      const midZ = (a[1] + b[1]) * 0.5;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      const bow = (edgeHash - 0.5) * Math.min(3.4, len * 0.22);
      const ctrl: V2 = [midX + (-dz / len) * bow, midZ + (dx / len) * bow];
      const curvePts: V2[] = [];
      const steps = 5;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const inv = 1 - t;
        curvePts.push([
          inv * inv * a[0] + 2 * inv * t * ctrl[0] + t * t * b[0],
          inv * inv * a[1] + 2 * inv * t * ctrl[1] + t * t * b[1],
        ]);
      }
      const clipped = clipPolylineToLandAndBox(curvePts, terrain, 6.2, x0 - pad, x1 + pad, z0 - pad, z1 + pad);
      const kind: CityStreet['kind'] = isAve ? 'avenue' : edgeHash > 0.72 ? 'lane' : 'street';
      const width = kind === 'avenue' ? 1.62 : kind === 'street' ? 1.18 : 0.86;
      for (const run of clipped) commitRun(kind, width, run);
    };

    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const p = nodePos(ix, iz);
        // Occasional intimate hilltop / neighborhood plazas at inland intersections
        if (
          p[0] >= x0 + 3 &&
          p[0] <= x1 - 3 &&
          p[1] >= z0 + 3 &&
          p[1] <= z1 - 3 &&
          terrain.signedInland(p[0], p[1]) > 14 &&
          hash2i(ix, iz, seed * 53 + 19) > 0.88
        ) {
          plazas.push({ x: p[0], z: p[1], radius: 2.0 + hash2i(ix, iz, seed + 7) * 0.8 });
        }

        const hE = hash2i(ix, iz, seed * 101 + 11);
        if (hE > 0.14) {
          emitCurvedEdge(p, nodePos(ix + 1, iz), hE, iz % 3 === 0);
        }
        const hN = hash2i(ix, iz, seed * 101 + 43);
        if (hN > 0.14) {
          emitCurvedEdge(p, nodePos(ix, iz + 1), hN, ix % 3 === 0);
        }
      }
    }
  } else if (districtStyle === 'grid') {
    // Tight deterministic rotated coastal townhouse grid with narrow alleys!
    const rot = (hash1i(7, seed + 41) - 0.5) * 0.42;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const U_STEP = 12.0;
    const V_STEP = 13.0;

    const toUV = (wx: number, wz: number): V2 => [wx * c + wz * s, -wx * s + wz * c];
    const toWorld = (u: number, v: number): V2 => [u * c - v * s, u * s + v * c];

    const corners: V2[] = [
      toUV(x0 - 8, z0 - 8),
      toUV(x1 + 8, z0 - 8),
      toUV(x1 + 8, z1 + 8),
      toUV(x0 - 8, z1 + 8),
    ];
    const uMin = Math.floor(Math.min(...corners.map((p) => p[0])) / U_STEP) - 1;
    const uMax = Math.ceil(Math.max(...corners.map((p) => p[0])) / U_STEP) + 1;
    const vMin = Math.floor(Math.min(...corners.map((p) => p[1])) / V_STEP) - 1;
    const vMax = Math.ceil(Math.max(...corners.map((p) => p[1])) / V_STEP) + 1;

    const gNode = (iu: number, iv: number): V2 => {
      const ju = (hash2i(iu, iv, seed * 31 + 5) - 0.5) * 0.85;
      const jv = (hash2i(iu, iv, seed * 31 + 19) - 0.5) * 0.85;
      return toWorld(iu * U_STEP + ju, iv * V_STEP + jv);
    };

    for (let iu = uMin; iu <= uMax; iu++) {
      for (let iv = vMin; iv <= vMax; iv++) {
        const a = gNode(iu, iv);
        if (
          a[0] >= x0 + 4 &&
          a[0] <= x1 - 4 &&
          a[1] >= z0 + 4 &&
          a[1] <= z1 - 4 &&
          terrain.signedInland(a[0], a[1]) > 14 &&
          iu % 4 === 0 &&
          iv % 4 === 0
        ) {
          plazas.push({ x: a[0], z: a[1], radius: 2.3 });
        }

        const bU = gNode(iu + 1, iv);
        const isAveU = ((iv % 3) + 3) % 3 === 0;
        for (const run of clipPolylineToLandAndBox([a, bU], terrain, 6.2, x0 - pad, x1 + pad, z0 - pad, z1 + pad)) {
          commitRun(isAveU ? 'avenue' : 'street', isAveU ? 1.62 : 1.18, run);
        }

        const bV = gNode(iu, iv + 1);
        const isAveV = ((iu % 3) + 3) % 3 === 0;
        for (const run of clipPolylineToLandAndBox([a, bV], terrain, 6.2, x0 - pad, x1 + pad, z0 - pad, z1 + pad)) {
          commitRun(isAveV ? 'avenue' : 'street', isAveV ? 1.62 : 1.18, run);
        }
      }
    }
  } else {
    // Tight radial chain of deterministic star-ring hilltop acropolis hubs (`HUB_STEP = 64`)!
    const HUB_STEP = 64;
    const hx0 = Math.floor((x0 - 44) / HUB_STEP);
    const hx1 = Math.ceil((x1 + 44) / HUB_STEP);
    const hz0 = Math.floor((z0 - 44) / HUB_STEP);
    const hz1 = Math.ceil((z1 + 44) / HUB_STEP);

    for (let hx = hx0; hx <= hx1; hx++) {
      for (let hz = hz0; hz <= hz1; hz++) {
        const hubRng = makeRng(hash2u32(hx, hz, seed * 73 + 29));
        let px = (hx + 0.5) * HUB_STEP + hubRng.range(-10, 10);
        const pz = (hz + 0.5) * HUB_STEP + hubRng.range(-10, 10);
        const minLandX = terrain.coastX(pz) + 18;
        if (px < minLandX - 24) continue; // deep-sea macro cell has no inland hub
        if (px < minLandX) px = minLandX + hubRng.range(0, 10);

        const pRad = hubRng.range(2.3, 3.1);
        if (px >= x0 - 4 && px <= x1 + 4 && pz >= z0 - 4 && pz <= z1 + 4) {
          plazas.push({ x: px, z: pz, radius: pRad });
        }

        const spokes = 8;
        const baseAng = hubRng.range(0, Math.PI * 2);
        const ellip = hubRng.range(0.88, 1.12);
        const ringRadii = [11.5, 22.0, 32.5];

        for (let rIdx = 0; rIdx < ringRadii.length; rIdx++) {
          const rad = ringRadii[rIdx];
          const ringPts: V2[] = [];
          const steps = 28;
          for (let k = 0; k <= steps; k++) {
            const ang = (k / steps) * Math.PI * 2;
            ringPts.push([px + Math.cos(ang) * rad, pz + Math.sin(ang) * rad * ellip]);
          }
          for (const run of clipPolylineToLandAndBox(ringPts, terrain, 6.4, x0 - pad, x1 + pad, z0 - pad, z1 + pad)) {
            commitRun(rIdx === 0 ? 'avenue' : 'street', rIdx === 0 ? 1.60 : 1.16, run);
          }
        }

        for (let k = 0; k < spokes; k++) {
          const ang = baseAng + (k / spokes) * Math.PI * 2 + hubRng.range(-0.1, 0.1);
          const spokePts: V2[] = [
            [px + Math.cos(ang) * (pRad - 0.3), pz + Math.sin(ang) * (pRad - 0.3)],
            [px + Math.cos(ang) * 38, pz + Math.sin(ang) * 38],
          ];
          for (const run of clipPolylineToLandAndBox(spokePts, terrain, 6.2, x0 - pad, x1 + pad, z0 - pad, z1 + pad)) {
            commitRun(k % 2 === 0 ? 'avenue' : 'street', k % 2 === 0 ? 1.60 : 1.16, run);
          }
        }
      }
    }
  }

  return { streets, plazas, rawSegments, piers, boats };
}

// ---------------------------------------------------------------------------
// Fast Deterministic Footprint & Multi-Wing Massing Extraction
// ---------------------------------------------------------------------------

function extractFootprintAndWings(
  spec: HouseNetSpec,
  scale = 1,
): {
  fpW: number;
  fpD: number;
  wings: CityWingMassing[];
} {
  // For multi-house flush composites (`village`), extract exact base-panel sub-footprints so
  // LOD1/LOD2 massing matches LOD0 wall-to-wall rowhouses cleanly!
  if (spec.topology === 'village') {
    const net = buildHouseNet(spec);
    let minBx = Infinity;
    let maxBx = -Infinity;
    let minBz = Infinity;
    let maxBz = -Infinity;
    const basePanels = net.panels.filter((p) => p.stage === 'base');
    const wings: CityWingMassing[] = [];
    const roofCycle: RoofType[] = ['gable', 'mansard', 'gable', 'spire'];
    const profileCycle: GableProfile[] = ['classic', 'stepped', 'gambrel', 'classic'];

    basePanels.forEach((p, idx) => {
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const [px, py] of p.poly) {
        const wx = px * MM * scale;
        const wz = -py * MM * scale;
        if (wx < x0) x0 = wx;
        if (wx > x1) x1 = wx;
        if (wz < z0) z0 = wz;
        if (wz > z1) z1 = wz;
      }
      if (x0 < minBx) minBx = x0;
      if (x1 > maxBx) maxBx = x1;
      if (z0 < minBz) minBz = z0;
      if (z1 > maxBz) maxBz = z1;
      const wW = Math.max(0.75, x1 - x0);
      const wD = Math.max(0.75, z1 - z0);
      const hScale = idx === 0 ? 1.0 : idx === 1 ? 1.12 : idx === 2 ? 0.92 : 1.06;
      wings.push({
        cx: (x0 + x1) * 0.5,
        cz: (z0 + z1) * 0.5,
        W: wW,
        D: wD,
        H: Math.max(1.1, spec.H * MM * scale * hScale),
        roofType: idx === 0 ? spec.roofType : roofCycle[(idx + (spec.village?.seed ?? 0)) % roofCycle.length],
        gableProfile: idx === 0 ? (spec.gableProfile ?? 'classic') : profileCycle[idx % profileCycle.length],
        pitch: spec.pitch,
        mansardRatio: spec.mansardRatio || 0.34,
        colorSlot: idx % 4,
      });
    });

    if (Number.isFinite(minBx) && wings.length > 0) {
      return { fpW: maxBx - minBx, fpD: maxBz - minBz, wings };
    }
  }

  // O(1) exact footprints for single-house topologies (zero `buildHouseNet` overhead during far chunk streaming!)
  const W = spec.W * MM * scale;
  const D = spec.D * MM * scale;
  const H = spec.H * MM * scale;

  if (spec.topology === 'lwing') {
    const Ww = W * 0.62;
    const Dw = D * 0.52;
    const ox = Ww * 0.22;
    return {
      fpW: W + Ww,
      fpD: D,
      wings: [
        {
          cx: -ox,
          cz: 0,
          W,
          D,
          H,
          roofType: 'gable',
          gableProfile: spec.gableProfile ?? 'classic',
          pitch: spec.pitch,
          mansardRatio: 0,
          colorSlot: 0,
        },
        {
          cx: W * 0.5 + Ww * 0.5 - ox,
          cz: D * 0.5 - Dw * 0.5,
          W: Ww,
          D: Dw,
          H: H * 0.68,
          roofType: 'shed',
          gableProfile: 'classic',
          pitch: 0.38,
          mansardRatio: 0,
          colorSlot: 0,
        },
      ],
    };
  }

  if (spec.topology === 'setback') {
    return {
      fpW: W,
      fpD: W,
      wings: [
        {
          cx: 0,
          cz: 0,
          W,
          D: W,
          H: H * 0.52,
          roofType: 'flat',
          gableProfile: 'classic',
          pitch: 0,
          mansardRatio: 0,
          colorSlot: 0,
        },
        {
          cx: 0,
          cz: 0,
          W: W * 0.58,
          D: W * 0.58,
          H,
          roofType: spec.roofType === 'mansard' ? 'mansard' : 'spire',
          gableProfile: 'classic',
          pitch: spec.pitch,
          mansardRatio: spec.mansardRatio || 0.35,
          colorSlot: 0,
        },
      ],
    };
  }

  if (spec.topology === 'hex' || spec.topology === 'oct') {
    const dia = Math.max(W, D) * 0.96;
    return {
      fpW: dia,
      fpD: dia,
      wings: [
        {
          cx: 0,
          cz: 0,
          W: dia * 0.88,
          D: dia * 0.88,
          H,
          roofType: spec.roofType === 'flat' ? 'flat' : 'spire',
          gableProfile: 'classic',
          pitch: Math.max(0.55, spec.pitch),
          mansardRatio: spec.mansardRatio,
          colorSlot: 0,
        },
      ],
    };
  }

  return {
    fpW: W,
    fpD: D,
    wings: [
      {
        cx: 0,
        cz: 0,
        W,
        D,
        H,
        roofType: spec.roofType,
        gableProfile: spec.gableProfile ?? 'classic',
        pitch: spec.pitch,
        mansardRatio: spec.mansardRatio,
        colorSlot: 0,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Deterministic Infinite Chunk Generator
// ---------------------------------------------------------------------------

/**
 * Generate a 100% deterministic, zero-overlap chunk `(cx, cz)` of the infinite coastal paper city.
 * Building footprints are strictly contained inside `[x0+0.35, x1-0.35] x [z0+0.35, z1-0.35]`,
 * mathematically guaranteeing zero overlaps both within and across adjacent chunks in any visit order.
 */
export function generateCityChunk(
  cx: number,
  cz: number,
  terrain: CityTerrainField,
  opts: CoastalWorldOptions,
): CityChunkData {
  const x0 = cx * CITY_CHUNK_SIZE;
  const x1 = x0 + CITY_CHUNK_SIZE;
  const z0 = cz * CITY_CHUNK_SIZE;
  const z1 = z0 + CITY_CHUNK_SIZE;
  const centerX = x0 + CITY_CHUNK_SIZE * 0.5;
  const centerZ = z0 + CITY_CHUNK_SIZE * 0.5;
  const key = `${cx},${cz}`;
  const districtStyle = terrain.districtStyleAt(centerX, centerZ, opts.style);

  // Sample land/sea presence across the chunk
  let hasLand = false;
  let hasSea = false;
  for (let j = 0; j <= 4; j++) {
    const z = z0 + (j / 4) * CITY_CHUNK_SIZE;
    const cX = terrain.coastX(z);
    if (x1 > cX - 1) hasLand = true;
    if (x0 < cX + 1) hasSea = true;
  }
  const hasCoast = hasLand && hasSea;

  const { streets, plazas, rawSegments, piers, boats } = generateChunkStreets(cx, cz, districtStyle, terrain);
  const chunkSeed = hash2u32(cx, cz, terrain.seed * 613 + (districtStyle === 'organic' ? 11 : districtStyle === 'grid' ? 37 : 73));
  const rng = makeRng(chunkSeed);

  const plots: CityBuildingPlot[] = [];
  const placedPaddedOBBs: V2[][] = [];
  let rooftopCount = 0;

  // Dense Mediterranean/Japanese coastal packing: 3–4× richer density packed right against the coastline!
  const avgInland = terrain.signedInland(centerX, centerZ);
  const maxPlotsInChunk =
    !hasLand || avgInland > 185
      ? 0
      : avgInland < 32
        ? 56
        : avgInland < 85
          ? 38
          : 20;

  if (maxPlotsInChunk > 0 && streets.length > 0) {
    const roadBoxes: V2[][] = rawSegments.map((seg) => buildStreetRect(seg.a, seg.b, seg.width * 0.5 + 0.14, 0.12));

    interface FrontageCandidate {
      px: number;
      pz: number;
      nx: number;
      nz: number;
      roadHalfW: number;
      roadKind: CityStreet['kind'];
      inlandDist: number;
    }

    const candidates: FrontageCandidate[] = [];
    for (const st of streets) {
      let accum = rng.range(0.7, 1.5);
      for (let i = 0; i < st.points.length - 1; i++) {
        const a = st.points[i];
        const b = st.points[i + 1];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 1e-4) continue;
        const tx = dx / len;
        const tz = dz / len;
        let cursor = accum;
        while (cursor < len) {
          const px = a[0] + tx * cursor;
          const pz = a[1] + tz * cursor;
          const inlandDist = terrain.signedInland(px, pz);
          if (px >= x0 + 1.2 && px <= x1 - 1.2 && pz >= z0 + 1.2 && pz <= z1 - 1.2) {
            // On the coastal promenade, only place houses on the INLAND side facing the sea (`nx > 0`)!
            const sides = st.kind === 'promenade' ? [1, -1] : [-1, 1];
            for (const side of sides) {
              const nx = -tz * side;
              const nz = tx * side;
              if (st.kind === 'promenade' && nx < 0.1) continue;
              candidates.push({
                px,
                pz,
                nx,
                nz,
                roadHalfW: st.width * 0.5,
                roadKind: st.kind,
                inlandDist,
              });
            }
          }
          cursor += inlandDist < 34 ? rng.range(1.5, 2.3) : rng.range(2.3, 3.4);
        }
        accum = cursor - len;
      }
    }

    // Prioritize dense coastal frontage & narrow waterfront lanes first!
    candidates.sort((a, b) => {
      const coastA = a.inlandDist < 28 ? 0 : 1;
      const coastB = b.inlandDist < 28 ? 0 : 1;
      if (coastA !== coastB) return coastA - coastB;
      const rank = (k: CityStreet['kind']) => (k === 'promenade' ? 0 : k === 'lane' ? 1 : k === 'avenue' ? 2 : 3);
      const rk = rank(a.roadKind) - rank(b.roadKind);
      if (rk !== 0) return rk;
      return a.inlandDist - b.inlandDist;
    });

    const richWinDetails = ['six', 'cross', 'transom', 'triple', 'six', 'twelve', 'clean'] as const;

    const chooseMixForSite = (cand: FrontageCandidate, slotIdx: number): { gen: number; mixOpts: HouseMixOptions } => {
      const hSeed = ((hash2u32(cx * 31 + slotIdx, cz * 37 + Math.round(cand.px * 2), terrain.seed + 19) % 99989) + 1);
      const gen = ((Math.abs(cx * 7 + cz * 13) + slotIdx) % 14) + 1;
      const pickedDetail = opts.windowDetail ?? rng.pick(richWinDetails);
      const baseGrammar: HouseMixOptions = {
        seed: hSeed,
        consistency: opts.consistency ?? null,
        windowStyle: opts.windowStyle ?? null,
        windowOpening: opts.windowOpening ?? null,
        windowDetail: pickedDetail,
      };
      const r = rng.next();
      const isWaterfront = cand.roadKind === 'promenade' || cand.inlandDist < 26;
      const isHilltop = terrain.heightAt(cand.px, cand.pz) > 4.0;

      // Dense waterfront strip: tightly packed wall-to-wall coastal rowhouses, stepped gables, mansards & towers!
      if (isWaterfront) {
        if (r < 0.34) {
          return { gen, mixOpts: { ...baseGrammar, topology: 'village', houses: rng.chance(0.45) ? 3 : 2 } };
        }
        if (r < 0.50) {
          return { gen: 1, mixOpts: { ...baseGrammar, topology: 'ribbon', roofType: 'gable', gableProfile: 'stepped' } };
        }
        if (r < 0.60) {
          return { gen: 1, mixOpts: { ...baseGrammar, topology: 'ribbon', roofType: 'spire' } };
        }
        if (r < 0.76) {
          return { gen: 2, mixOpts: { ...baseGrammar, topology: 'ribbon', roofType: 'mansard' } };
        }
      }

      // Coastal ridges & headlands: belvederes, setback towers, octagonal pavilions & spires!
      if (isHilltop && r < 0.42) {
        const pick = rng.pick(['spire', 'setback', 'oct', 'hex', 'mansard', 'stepped'] as const);
        if (pick === 'setback') return { gen: 4, mixOpts: { ...baseGrammar, topology: 'setback' } };
        if (pick === 'oct') return { gen: 3, mixOpts: { ...baseGrammar, topology: 'oct' } };
        if (pick === 'hex') return { gen: 7, mixOpts: { ...baseGrammar, topology: 'hex' } };
        if (pick === 'spire') return { gen: 1, mixOpts: { ...baseGrammar, topology: 'ribbon', roofType: 'spire' } };
        if (pick === 'stepped') {
          return { gen: 1, mixOpts: { ...baseGrammar, topology: 'ribbon', roofType: 'gable', gableProfile: 'stepped' } };
        }
        return { gen: 2, mixOpts: { ...baseGrammar, topology: 'ribbon', roofType: 'mansard' } };
      }

      if (cand.roadKind === 'avenue' && r < 0.24) {
        return { gen, mixOpts: { ...baseGrammar, topology: 'village', houses: 2 } };
      }
      if (r < 0.28) {
        return { gen: 5, mixOpts: { ...baseGrammar, topology: 'lwing' } };
      }

      const roofPool: RoofType[] = ['gable', 'gable', 'mansard', 'hip', 'shed', 'flat', 'butterfly', 'sawtooth'];
      const roofType = rng.pick(roofPool);
      const gableProfile =
        roofType === 'gable' ? rng.pick(['classic', 'gambrel', 'stepped', 'barrel', 'saltbox'] as const) : null;
      return {
        gen,
        mixOpts: {
          ...baseGrammar,
          topology: rng.chance(0.66) ? 'ribbon' : 'cross',
          roofType,
          gableProfile,
        },
      };
    };

    const tryPlaceSpecAt = (
      cand: FrontageCandidate,
      gen: number,
      mixOpts: HouseMixOptions,
      rawSpec: HouseNetSpec,
    ): boolean => {
      const spec: HouseNetSpec = { ...rawSpec, yawOffset: 0 };
      const isCoastal = cand.inlandDist < 34;
      // Finer miniature architectural scale (~0.52–0.64× along coast) packs 3–4× more houses with FULL window detail!
      const plotScale = isCoastal ? rng.range(0.52, 0.63) : rng.range(0.56, 0.72);
      const { fpW, fpD, wings } = extractFootprintAndWings(spec, plotScale);
      const halfW = fpW * 0.5;
      const halfD = fpD * 0.5;

      const sidewalk = isCoastal ? rng.range(0.10, 0.24) : rng.range(0.20, 0.42);
      const bx = cand.px + cand.nx * (cand.roadHalfW + sidewalk + halfD);
      const bz = cand.pz + cand.nz * (cand.roadHalfW + sidewalk + halfD);
      const yaw = Math.atan2(-cand.nx, -cand.nz);

      const footprint = makeBuildingOBB(bx, bz, yaw, halfW, halfD);

      // Strict chunk containment + beach clearance => mathematically ZERO cross-chunk overlaps & ZERO wet buildings!
      for (const [fx, fz] of footprint) {
        if (fx < x0 + 0.22 || fx > x1 - 0.22 || fz < z0 + 0.22 || fz > z1 - 0.22) return false;
        if (terrain.signedInland(fx, fz) < 7.2) return false;
      }

      const padGap = isCoastal ? 0.12 : 0.22;
      const paddedCheck = makeBuildingOBB(bx, bz, yaw, halfW + padGap, halfD + padGap);
      const roadCheck = makeBuildingOBB(bx, bz, yaw, halfW + 0.06, halfD + 0.06);

      for (const pl of plazas) {
        if (Math.hypot(bx - pl.x, bz - pl.z) < pl.radius + Math.max(halfW, halfD) * 0.58) return false;
      }
      for (const rBox of roadBoxes) {
        if (polygonsOverlap(roadCheck, rBox)) return false;
      }
      for (const other of placedPaddedOBBs) {
        if (polygonsOverlap(paddedCheck, other)) return false;
      }

      const ys = [terrain.heightAt(bx, bz), ...footprint.map(([fx, fz]) => terrain.heightAt(fx, fz))];
      const groundMinY = Math.min(...ys);
      const groundMaxY = Math.max(...ys);
      if (groundMinY < 0.25 || groundMaxY - groundMinY > 2.8) return false;
      const baseY = groundMaxY + 0.04;

      const localIdx = plots.length;
      const colorIndex = Math.floor(hash2i(cx * 17 + localIdx, cz * 29 + Math.round(bz), terrain.seed + 83) * 8) % 8;
      // Rich organic per-house fold-wave randomization: wide per-plot scatter + soft hillside cluster swells
      // so houses blossom organically across the coast instead of rising along a rigid straight line!
      const plotScatter = (hash2i(cx * 41 + localIdx * 7, cz * 19 + Math.round(bx), terrain.seed + 211) - 0.5) * 44;
      const clusterSwell =
        Math.sin(bx * 0.044 + terrain.seed * 1.13) * 6.5 +
        Math.cos(bz * 0.036 - bx * 0.024 + terrain.seed * 0.71) * 6.5;
      const foldJitter = Math.max(-26, Math.min(24, plotScatter + clusterSwell));

      plots.push({
        id: `c${cx}_${cz}_p${localIdx}`,
        chunkKey: key,
        index: localIdx,
        x: bx,
        z: bz,
        baseY,
        groundMinY,
        yaw,
        footprint,
        footprintW: fpW,
        footprintD: fpD,
        scale: plotScale,
        wings,
        colorIndex,
        foldJitter,
        generation: gen,
        mixOpts,
        spec,
        foldOrder: Math.max(0, Math.min(1, terrain.signedInland(bx, bz) / 90)),
      });
      placedPaddedOBBs.push(paddedCheck);
      rooftopCount += spec.topology === 'village' && spec.village ? spec.village.count : 1;
      return true;
    };

    let attemptIdx = 0;
    for (const cand of candidates) {
      if (plots.length >= maxPlotsInChunk) break;
      attemptIdx++;
      const { gen, mixOpts } = chooseMixForSite(cand, attemptIdx);
      const primarySpec = generateHouseSpec(gen, mixOpts);
      if (tryPlaceSpecAt(cand, gen, mixOpts, primarySpec)) continue;

      // Compact coastal townhouse fallback for tight alley pockets (keeps rich window muntins!)
      const compactMix: HouseMixOptions = {
        seed: mixOpts.seed,
        topology: 'ribbon',
        roofType: rng.pick(['gable', 'gable', 'mansard', 'hip', 'flat', 'shed'] as const),
        gableProfile: rng.pick(['classic', 'gambrel', 'stepped', 'barrel', 'saltbox'] as const),
        consistency: opts.consistency ?? null,
        windowStyle: opts.windowStyle ?? null,
        windowOpening: opts.windowOpening ?? null,
        windowDetail: mixOpts.windowDetail ?? null,
      };
      const compactRaw = generateHouseSpec(1, compactMix);
      const compactSpec: HouseNetSpec =
        compactRaw.roofType === 'spire'
          ? { ...compactRaw, W: 28, D: 28 }
          : { ...compactRaw, W: Math.min(compactRaw.W, 30), D: Math.min(compactRaw.D, 34) };
      tryPlaceSpecAt(cand, 1, compactMix, compactSpec);
    }
  }

  // 4. Occasional solitary folded coastal lighthouse/pavilion on offshore paper islets!
  if (hasSea && plots.length < 60) {
    const isletX = x0 + rng.range(10, CITY_CHUNK_SIZE - 10);
    const isletZ = z0 + rng.range(10, CITY_CHUNK_SIZE - 10);
    if (terrain.signedInland(isletX, isletZ) < -20 && terrain.heightAt(isletX, isletZ) > 0.9) {
      const hSeed = ((chunkSeed % 99989) + 1);
      const mixOpts: HouseMixOptions = {
        seed: hSeed,
        topology: rng.chance(0.55) ? 'oct' : 'ribbon',
        roofType: 'spire',
      };
      const spec: HouseNetSpec = { ...generateHouseSpec(1, mixOpts), W: 28, D: 28, yawOffset: 0 };
      const isletScale = 0.68;
      const { fpW, fpD, wings } = extractFootprintAndWings(spec, isletScale);
      const yaw = rng.range(0, Math.PI * 2);
      const footprint = makeBuildingOBB(isletX, isletZ, yaw, fpW * 0.5, fpD * 0.5);
      const ys = [terrain.heightAt(isletX, isletZ), ...footprint.map(([fx, fz]) => terrain.heightAt(fx, fz))];
      if (Math.min(...ys) > 0.2) {
        const localIdx = plots.length;
        plots.push({
          id: `c${cx}_${cz}_islet`,
          chunkKey: key,
          index: localIdx,
          x: isletX,
          z: isletZ,
          baseY: Math.max(...ys) + 0.05,
          groundMinY: Math.min(...ys),
          yaw,
          footprint,
          footprintW: fpW,
          footprintD: fpD,
          scale: isletScale,
          wings,
          colorIndex: localIdx % 8,
          foldJitter: -22 + hash2i(cx * 13, cz * 29, terrain.seed + 409) * 20,
          generation: 1,
          mixOpts,
          spec,
          foldOrder: 0,
        });
        placedPaddedOBBs.push(makeBuildingOBB(isletX, isletZ, yaw, fpW * 0.5 + 0.35, fpD * 0.5 + 0.35));
        rooftopCount += 1;
      }
    }
  }

  // 5. Grounded Minimalist Folded Origami Trees tucked into hillside clearings, pocket courtyards & offshore islets!
  const trees: CityTree[] = [];
  if (hasLand || hasSea) {
    const treeRng = makeRng(hash2u32(cx, cz, terrain.seed * 48271 + 911));
    const maxTrees = avgInland > 65 ? 26 : 16;
    for (let attempt = 0; attempt < 84 && trees.length < maxTrees; attempt++) {
      const tx = x0 + treeRng.range(1.6, CITY_CHUNK_SIZE - 1.6);
      const tz = z0 + treeRng.range(1.6, CITY_CHUNK_SIZE - 1.6);
      const ty = terrain.heightAt(tx, tz);
      if (ty < 0.45) continue;
      // Keep the sandy beige beach open & uncluttered (trees grow behind the promenade or on offshore islets!)
      const tInland = terrain.signedInland(tx, tz);
      if (tInland > -10 && tInland < 6.8) continue;

      let ok = true;
      for (const seg of rawSegments) {
        if (distPointToSeg(tx, tz, seg.a, seg.b) < seg.width * 0.5 + 0.55) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      const treeBox: V2[] = [
        [tx - 0.48, tz - 0.48],
        [tx + 0.48, tz - 0.48],
        [tx + 0.48, tz + 0.48],
        [tx - 0.48, tz + 0.48],
      ];
      for (const b of placedPaddedOBBs) {
        if (polygonsOverlap(treeBox, b)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      for (const other of trees) {
        if (Math.hypot(tx - other.x, tz - other.z) < 1.55) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      trees.push({
        x: tx,
        z: tz,
        y: ty,
        scale: treeRng.range(0.56, 1.04),
        rotY: treeRng.range(0, Math.PI * 2),
        variant: (attempt % 3) as 0 | 1 | 2,
      });
    }
  }

  return {
    cx,
    cz,
    key,
    centerX,
    centerZ,
    districtStyle,
    hasLand,
    hasSea,
    hasCoast,
    streets,
    plazas,
    plots,
    trees,
    piers,
    boats,
    rooftopCount,
  };
}

// ---------------------------------------------------------------------------
// Deterministic Infinite Coastal World + Sweeping Curved Flight Spline
// ---------------------------------------------------------------------------

/**
 * Create an infinite deterministic coastal paper world:
 *  - Deterministic shoreline, multi-octave hills, and district topologies from `seed`,
 *  - On-demand deterministic chunk generation (`generateChunk(cx, cz)`),
 *  - Smooth curved glider flight trajectory (`sampleFlight(s)`) weaving gracefully between sea and hills!
 */
export function createCoastalWorld(opts: CoastalWorldOptions): CoastalWorld {
  const seed = Math.max(0, Math.round(opts.seed));
  const style = opts.style;
  const hills = Math.max(0, Math.min(1, opts.hills));
  const normalizedOpts: CoastalWorldOptions = { ...opts, seed, style, hills };
  const terrain = createTerrainField(seed, hills);

  // Deterministic flight curve phase offsets — starts framing the shoreline & harbor cinematically at s = 0!
  const fRng = makeRng((seed * 1299709 + 773) >>> 0);
  const fp1 = fRng.range(-0.35, 0.35);
  const fp2 = fRng.range(-0.45, 0.45);
  const fp3 = fRng.range(0, Math.PI * 2);

  // Smoothly averaged coastline center so the curved glider anticipates sweeping headlands and coves
  const smoothCoastX = (z: number): number =>
    (terrain.coastX(z - 42) +
      terrain.coastX(z - 21) * 1.6 +
      terrain.coastX(z) * 2.2 +
      terrain.coastX(z + 21) * 1.6 +
      terrain.coastX(z + 42)) /
    7.4;

  // Intimate coastline-hugging S-curves gliding right along the paper-blue water & beige sand beach!
  const flightXAt = (s: number): number => {
    const z = -s;
    const base = smoothCoastX(z);
    const curve1 = Math.sin(s * 0.017 + fp1 - 0.45) * 7.2;
    const curve2 = Math.cos(s * 0.0085 + fp2 + 1.0) * 3.5;
    return base + curve1 + curve2 - 8.5;
  };

  const sampleFlight = (s: number): FlightSample => {
    const z = -s;
    const camX = flightXAt(s);

    // Intimate low coastal glider vista showcasing the densely packed waterfront facades, narrow alleys & rolling hills!
    const g0 = Math.max(0, terrain.heightAt(camX, z));
    const g1 = Math.max(0, terrain.heightAt(camX, z - 14));
    const g2 = Math.max(0, terrain.heightAt(camX + 8, z - 8));
    const groundClear = Math.max(g0, g1, g2);
    const camY = Math.max(16.2, groundClear + 12.4) + Math.sin(s * 0.013 + fp3) * 1.8;

    // Look ahead along the densely packed coastal ribbon framing blue sea + beige beach on left, terraced town right!
    const lookLead = 54;
    const zLook = -(s + lookLead);
    const lookX =
      smoothCoastX(zLook) +
      16.5 +
      Math.sin((s + lookLead) * 0.012 + fp1) * 5.0 +
      (camX - smoothCoastX(z)) * 0.12;
    const lookY = Math.max(1.8, terrain.heightAt(lookX, zLook) * 0.48 + 1.8);

    // Normalized horizontal forward direction (along flight tangent)
    const ds = 2.0;
    const xPrev = flightXAt(s - ds);
    const xNext = flightXAt(s + ds);
    const dx = xNext - xPrev;
    const dz = -2 * ds;
    const fLen = Math.hypot(dx, dz) || 1;
    const fx = dx / fLen;
    const fz = dz / fLen;

    // Subtle aircraft banking into horizontal turns (`±5.8°`)
    const d2x = (xNext - 2 * camX + xPrev) / (ds * ds);
    const bankRoll = Math.max(-0.105, Math.min(0.105, -d2x * 16.0));

    // Focus point for the origami fold wave — anchored right on the dense coastal strip ahead!
    const focusX = smoothCoastX(z - 26) + 17.0;
    const focusZ = z - 26;

    return {
      pos: [camX, camY, z],
      lookAt: [lookX, lookY, zLook],
      forward: [fx, fz],
      bankRoll,
      focusX,
      focusZ,
    };
  };

  return {
    seed,
    style,
    hills,
    options: normalizedOpts,
    terrain,
    generateChunk: (cx: number, cz: number) => generateCityChunk(cx, cz, terrain, normalizedOpts),
    extractChunkContours: (cx: number, cz: number, gridRes = 24, stepY = 0.65) =>
      extractChunkContours(terrain, cx, cz, gridRes, stepY),
    sampleFlight,
  };
}
