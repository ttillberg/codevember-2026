import {
  MM,
  buildHouseNet,
  generateHouseSpec,
  polygonsOverlap,
  type BuildingLevels,
  type GableProfile,
  type HouseMixOptions,
  type HouseNetSpec,
  type RoofType,
  type V2,
} from './origamiHouseNet';

export const ISLAND_WORLD_EXTENT = 50;

export interface IslandCoastHarmonics {
  orientAng: number;
  bayAngle: number;
  a2: number;
  p2: number;
  a3: number;
  p3: number;
  a4: number;
  p4: number;
  a5: number;
  p5: number;
}

export interface IslandTerrainField {
  seed: number;
  /** Normalized topological relief (`0` = gentle island terrace, `1` = soaring Amalfi/Capri cliffs & peaks) */
  hills: number;
  coastHarmonics: IslandCoastHarmonics;
  /** Base island radius at world polar angle `angleRad = atan2(z, x)` */
  coastRadiusAt(angleRad: number): number;
  /** Signed inland distance (`> 0` on island land, `< 0` in Mediterranean sea) */
  signedInland(x: number, z: number): number;
  /** Continuous island topography elevation (`< 0` seabed, `> 0` cliffs, amphitheater & rocky peaks) */
  heightAt(x: number, z: number): number;
}

export interface IslandContourSegment {
  a: [number, number];
  b: [number, number];
  y: number;
  isMajor: boolean;
}

export interface IslandRoadPoint {
  x: number;
  z: number;
  y: number;
  /** Normalized progress along this road (`0..1`) */
  t: number;
}

export interface IslandRoad {
  id: string;
  kind: 'serpentine' | 'corniche' | 'terrace' | 'alley';
  width: number;
  /** True if the road closes into a full 360° contour loop */
  closed: boolean;
  points: IslandRoadPoint[];
}

export interface CityBuildingPlot {
  id: string;
  index: number;
  x: number;
  z: number;
  /** World Y where the house base rests level atop its hillside retaining wall */
  baseY: number;
  /** Lowest terrain elevation under footprint corners */
  groundMinY: number;
  /** Rotation around +Y so the facade faces the street or Mediterranean sea vista */
  yaw: number;
  /** Exact 2D world `(x, z)` footprint polygon (4 corners, CCW) */
  footprint: V2[];
  footprintW: number;
  footprintD: number;
  /** Miniature architectural diorama scale */
  scale: number;
  /** Deterministic architectural paper palette index (`0..7`) */
  colorIndex: number;
  /** Normalized elevation order (`0` = harbor/coast -> `1` = summit) for cascade choreography */
  elevOrder: number;
  /** Whether this plot crowns the hilltop summit piazza */
  isSummit: boolean;
  /** Exact generation + mix options */
  generation: number;
  mixOpts: HouseMixOptions;
  spec: HouseNetSpec;
}

export interface IslandTree {
  x: number;
  z: number;
  y: number;
  scale: number;
  rotY: number;
  /** `0` = slender Italian cypress, `1` = coastal pine, `2` = Mediterranean umbrella stone pine */
  variant: 0 | 1 | 2;
}

export interface IslandWorldOptions {
  seed: number;
  hills: number;
  consistency?: number | null;
  windowStyle?: HouseMixOptions['windowStyle'];
  windowOpening?: HouseMixOptions['windowOpening'];
  windowDetail?: HouseMixOptions['windowDetail'];
}

export interface IslandWorld {
  seed: number;
  hills: number;
  options: IslandWorldOptions;
  terrain: IslandTerrainField;
  harborPos: [number, number, number];
  summitPos: [number, number, number];
  roads: IslandRoad[];
  plots: CityBuildingPlot[];
  trees: IslandTree[];
  contours: IslandContourSegment[];
  rooftopCount: number;
}

// ---------------------------------------------------------------------------
// Deterministic Seeded PRNG & Smooth / Ridged Noise
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

function ridgedNoise2D(x: number, z: number, seed: number): number {
  const v = valueNoise2D(x, z, seed);
  const r = 1 - Math.abs(v * 2 - 1);
  return r * r;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function wrapAngleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---------------------------------------------------------------------------
// Sculpted Italian Mountain Island Topography (Capri / Ischia / Positano)
// ---------------------------------------------------------------------------

export function createIslandTerrain(seed: number, hills01: number): {
  terrain: IslandTerrainField;
  orientAng: number;
  mainPeakLocal: V2;
  harborLocal: V2;
  summitLocal: V2;
  localCoastRadius: (localAng: number) => number;
} {
  const s = Math.max(0, Math.round(seed));
  const hills = Math.max(0, Math.min(1, hills01));
  const rng = makeRng((s * 7919 + 4129) >>> 0);

  const orientAng = rng.range(-0.36, 0.36);
  const cosO = Math.cos(orientAng);
  const sinO = Math.sin(orientAng);
  const toLocal = (wx: number, wz: number): V2 => [wx * cosO + wz * sinO, -wx * sinO + wz * cosO];

  const coastHarmonics: IslandCoastHarmonics = {
    orientAng,
    bayAngle: Math.PI * 0.5,
    a2: rng.range(1.7, 2.9),
    p2: rng.range(0, Math.PI * 2),
    a3: rng.range(1.2, 2.2),
    p3: rng.range(0, Math.PI * 2),
    a4: rng.range(0.6, 1.4),
    p4: rng.range(0, Math.PI * 2),
    a5: rng.range(0.3, 0.8),
    p5: rng.range(0, Math.PI * 2),
  };

  // Sculpted asymmetric Italian island peaks & coastal headlands (in local coords)
  const mainOx = rng.range(-4.5, 4.5);
  const mainOz = rng.range(-10.5, -7.5);
  const mainPeakLocal: V2 = [mainOx, mainOz];

  const flankSide = rng.chance(0.5) ? 1 : -1;
  const shoulderLocal: V2 = [flankSide * rng.range(14.0, 18.0), rng.range(-4.5, 0.5)];
  const headlandLocal: V2 = [-flankSide * rng.range(14.5, 18.5), rng.range(2.0, 7.5)];
  const backCragLocal: V2 = [-flankSide * rng.range(7.5, 13.0), rng.range(-16.5, -13.0)];

  // 2 iconic Capri-style Faraglioni limestone sea stacks just off one rocky headland!
  const stackAngle = Math.PI * 0.5 + flankSide * rng.range(0.95, 1.42);
  const stackDist1 = rng.range(39.0, 42.5);
  const stack1Local: V2 = [Math.cos(stackAngle) * stackDist1, Math.sin(stackAngle) * stackDist1];
  const stack2Local: V2 = [
    Math.cos(stackAngle + flankSide * 0.14) * (stackDist1 + 3.6),
    Math.sin(stackAngle + flankSide * 0.14) * (stackDist1 + 3.6),
  ];

  const nSeed1 = (s * 131 + 17) >>> 0;
  const nSeed2 = (s * 521 + 97) >>> 0;
  const nSeed3 = (s * 997 + 211) >>> 0;

  const localCoastRadius = (localAng: number): number => {
    const baseR = 33.4 + 2.6 * Math.cos(2 * localAng);
    const dBay = wrapAngleDiff(localAng, Math.PI * 0.5);
    const bayNotch = -6.6 * Math.exp(-(dBay * dBay) / (0.40 * 0.40));
    const leftCape = 4.0 * Math.exp(-Math.pow(wrapAngleDiff(localAng, Math.PI * 0.5 - 0.72) / 0.34, 2));
    const rightCape = 3.6 * Math.exp(-Math.pow(wrapAngleDiff(localAng, Math.PI * 0.5 + 0.76) / 0.36, 2));
    const backSpur = 2.8 * Math.exp(-Math.pow(wrapAngleDiff(localAng, -Math.PI * 0.5 + flankSide * 0.35) / 0.45, 2));
    const organic =
      coastHarmonics.a2 * Math.sin(2 * localAng + coastHarmonics.p2) +
      coastHarmonics.a3 * Math.cos(3 * localAng + coastHarmonics.p3) +
      coastHarmonics.a4 * Math.sin(4 * localAng + coastHarmonics.p4) +
      coastHarmonics.a5 * Math.cos(5 * localAng + coastHarmonics.p5);
    return Math.max(21.5, baseR + bayNotch + leftCape + rightCape + backSpur + organic);
  };

  const coastRadiusAt = (worldAng: number): number => localCoastRadius(worldAng - orientAng);

  const signedInland = (x: number, z: number): number => {
    const [lx, lz] = toLocal(x, z);
    const r = Math.hypot(lx, lz);
    const a = Math.atan2(lz, lx);
    return localCoastRadius(a) - r;
  };

  const heightAt = (x: number, z: number): number => {
    const [lx, lz] = toLocal(x, z);
    const r = Math.hypot(lx, lz);
    const a = Math.atan2(lz, lx);
    const cR = localCoastRadius(a);
    const shoreDist = cR - r;

    if (shoreDist <= 0) {
      let seaY = -smoothstep(0, 7.2, -shoreDist) * 3.4 - 0.08;
      const ds1 = Math.hypot(lx - stack1Local[0], lz - stack1Local[1]);
      if (ds1 < 3.8) {
        const h1 = Math.pow(1 - ds1 / 3.8, 1.15) * (3.5 + hills * 3.8);
        seaY = Math.max(seaY, -0.5 + h1);
      }
      const ds2 = Math.hypot(lx - stack2Local[0], lz - stack2Local[1]);
      if (ds2 < 2.8) {
        const h2 = Math.pow(1 - ds2 / 2.8, 1.18) * (2.5 + hills * 2.6);
        seaY = Math.max(seaY, -0.5 + h2);
      }
      return seaY;
    }

    // Smooth Cartesian crescent-bay mask (100% C-infinity smooth everywhere including r=0!)
    const bayCalm = Math.exp(-(lx * lx) / (16.5 * 16.5)) * smoothstep(2.0, 19.0, lz);
    const harborApron = smoothstep(0, 4.4, shoreDist) * 0.92;
    const cliffWall = smoothstep(0, 4.8, shoreDist) * (1 - bayCalm * 0.86) * (1.3 + hills * 4.4);

    if (hills <= 1e-4) {
      return harborApron;
    }

    const amp = 0.25 + hills * 0.95;

    // 1. Primary sculpted Italian limestone mountain peak behind the amphitheater bay
    const d1x = lx - mainPeakLocal[0];
    const d1z = lz - mainPeakLocal[1];
    const r1Raw = Math.hypot(d1x, d1z);
    const ang1 = Math.atan2(d1z, d1x);
    const areteBlend = smoothstep(0.0, 5.5, r1Raw);
    const arete1 =
      1.0 +
      areteBlend *
        (0.18 * Math.cos(3.0 * ang1 + coastHarmonics.p2) + 0.12 * Math.sin(2.0 * ang1 + coastHarmonics.p3));
    const r1 = r1Raw / arete1;
    const peak1 = 18.2 * Math.pow(Math.max(0, 1 - r1 / 35.5), 1.22);

    // 2. Dramatic secondary headland ridges & rocky Mediterranean promontories
    const r2 = Math.hypot(lx - shoulderLocal[0], lz - shoulderLocal[1]);
    const peak2 = 11.8 * Math.pow(Math.max(0, 1 - r2 / 22.5), 1.30);

    const r3 = Math.hypot(lx - headlandLocal[0], lz - headlandLocal[1]);
    const peak3 = 8.4 * Math.pow(Math.max(0, 1 - r3 / 19.5), 1.36);

    const r4 = Math.hypot(lx - backCragLocal[0], lz - backCragLocal[1]);
    const peak4 = 12.6 * Math.pow(Math.max(0, 1 - r4 / 21.0), 1.26);

    const mainMass = Math.max(peak1, peak2, peak4) + Math.min(peak1, Math.max(peak2, peak4)) * 0.22 + peak3 * 0.58;

    // 3. Gentle amphitheater cove facing the front harbor bay
    const bowlDist = Math.hypot(lx * 0.80, lz - 14.0);
    const bowlCarve = 2.4 * Math.exp(-(bowlDist * bowlDist) / (11.5 * 11.5));

    // 4. Multi-octave ridged limestone geology & organic gullies
    const rn1 = ridgedNoise2D(lx * 0.045 + 4.3, lz * 0.045 - 7.1, nSeed1);
    const rn2 = ridgedNoise2D(lx * 0.10 - 9.2, lz * 0.10 + 11.4, nSeed2);
    const vn3 = valueNoise2D(lx * 0.18 + 15.1, lz * 0.18 - 6.7, nSeed3);
    const rockDetail = (rn1 * 0.52 + rn2 * 0.34 + vn3 * 0.14) * 2.5;

    const inlandRamp = smoothstep(0, 7.2, shoreDist);
    const total = harborApron + cliffWall + Math.max(0, (mainMass + rockDetail - bowlCarve) * amp * inlandRamp);
    return Math.max(0.06, total);
  };

  const harborR = localCoastRadius(Math.PI * 0.5) - 3.8;
  const harborLocal: V2 = [0, harborR];
  const summitLocal: V2 = [mainPeakLocal[0] * 0.72, mainPeakLocal[1] + 2.2];

  return {
    terrain: {
      seed: s,
      hills,
      coastHarmonics,
      coastRadiusAt,
      signedInland,
      heightAt,
    },
    orientAng,
    mainPeakLocal,
    harborLocal,
    summitLocal,
    localCoastRadius,
  };
}

// ---------------------------------------------------------------------------
// Marching Squares Topographic Contour Extractor (Whole Island)
// ---------------------------------------------------------------------------

export function extractIslandContours(
  terrain: IslandTerrainField,
  extent = 46,
  gridRes = 76,
  stepY = 0.78,
): IslandContourSegment[] {
  const minC = -extent;
  const step = (extent * 2) / gridRes;
  const stride = gridRes + 1;
  const heights = new Float32Array(stride * stride);

  let maxH = -Infinity;
  for (let j = 0; j <= gridRes; j++) {
    const z = minC + j * step;
    for (let i = 0; i <= gridRes; i++) {
      const x = minC + i * step;
      const h = terrain.heightAt(x, z);
      heights[j * stride + i] = h;
      if (h > maxH) maxH = h;
    }
  }
  if (maxH < 0.6) return [];

  const maxLv = Math.floor(maxH / stepY);
  const segs: IslandContourSegment[] = [];

  for (let lv = 1; lv <= maxLv; lv++) {
    const iso = lv * stepY;
    if (iso < 0.55) continue;
    const isMajor = lv % 4 === 0;
    for (let j = 0; j < gridRes; j++) {
      const z0 = minC + j * step;
      const z1 = z0 + step;
      for (let i = 0; i < gridRes; i++) {
        const x0 = minC + i * step;
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
// 2D Geometry & Full-Island Serpentine + Terraced Road Network
// ---------------------------------------------------------------------------

function distPointToSeg(px: number, pz: number, a: V2, b: V2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-8) return Math.hypot(px - a[0], pz - a[1]);
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
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

function extractFootprintSize(spec: HouseNetSpec, scale: number): { fpW: number; fpD: number } {
  if (spec.topology === 'village') {
    const net = buildHouseNet(spec);
    let minBx = Infinity;
    let maxBx = -Infinity;
    let minBz = Infinity;
    let maxBz = -Infinity;
    for (const p of net.panels) {
      if (p.stage !== 'base') continue;
      for (const [px, py] of p.poly) {
        const wx = px * MM * scale;
        const wz = -py * MM * scale;
        if (wx < minBx) minBx = wx;
        if (wx > maxBx) maxBx = wx;
        if (wz < minBz) minBz = wz;
        if (wz > maxBz) maxBz = wz;
      }
    }
    if (Number.isFinite(minBx)) {
      return { fpW: maxBx - minBx, fpD: maxBz - minBz };
    }
  }
  const W = spec.W * MM * scale;
  const D = spec.D * MM * scale;
  if (spec.topology === 'lwing') return { fpW: W * 1.62, fpD: D };
  if (spec.topology === 'setback') return { fpW: W, fpD: W };
  if (spec.topology === 'hex' || spec.topology === 'oct') {
    const dia = Math.max(W, D) * 0.96;
    return { fpW: dia, fpD: dia };
  }
  return { fpW: W, fpD: D };
}

/**
 * Build the island's hidden-until-built Italian road network covering all 360° of the mountain:
 *  1. Iconic serpentine switchback road winding from harbor cove up to the summit campanile,
 *  2. Perimeter coastal cliff corniche hugging the capes, harbor & rear cliffs,
 *  3. Mid-mountain terraced contour loop wrapping around the flanks & back mountain ridge,
 *  4. Short stepped cliffside alleys linking the coastal corniche to the upper terraces!
 */
function buildIslandRoads(
  terrain: IslandTerrainField,
  orientAng: number,
  harborLocal: V2,
  summitLocal: V2,
  localCoastRadius: (localAng: number) => number,
  seed: number,
): IslandRoad[] {
  const rng = makeRng((seed * 19937 + 311) >>> 0);
  const cosO = Math.cos(orientAng);
  const sinO = Math.sin(orientAng);
  const toWorld = (lx: number, lz: number): V2 => [lx * cosO - lz * sinO, lx * sinO + lz * cosO];

  const roads: IslandRoad[] = [];

  // 1. Primary Serpentine Switchback Road (harbor bay -> summit campanile)
  {
    const dirSign = rng.chance(0.5) ? 1 : -1;
    const halfWaves = 4.0;
    const SAMPLES = 176;
    const rawLocal: V2[] = [];

    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const baseLx = harborLocal[0] + (summitLocal[0] - harborLocal[0]) * t;
      const baseLz = harborLocal[1] + (summitLocal[1] - harborLocal[1]) * t;
      const env = Math.pow(Math.sin(Math.PI * t), 0.62);
      const sway = Math.sin(t * Math.PI * halfWaves) * dirSign * (15.5 * env);
      const organic = Math.sin(t * Math.PI * 2.0 + 0.6) * 1.3 * env;

      let lx = baseLx + sway + organic;
      let lz = baseLz;
      const [wx0, wz0] = toWorld(lx, lz);
      const inland = terrain.signedInland(wx0, wz0);
      if (inland < 4.4) {
        const r = Math.hypot(lx, lz) || 1;
        const pull = Math.min(r * 0.55, 4.4 - inland + 0.6);
        lx *= (r - pull) / r;
        lz *= (r - pull) / r;
      }
      rawLocal.push([lx, lz]);
    }

    for (let pass = 0; pass < 6; pass++) {
      const next: V2[] = [rawLocal[0]];
      for (let i = 1; i < rawLocal.length - 1; i++) {
        next.push([
          rawLocal[i - 1][0] * 0.24 + rawLocal[i][0] * 0.52 + rawLocal[i + 1][0] * 0.24,
          rawLocal[i - 1][1] * 0.24 + rawLocal[i][1] * 0.52 + rawLocal[i + 1][1] * 0.24,
        ]);
      }
      next.push(rawLocal[rawLocal.length - 1]);
      for (let i = 0; i < rawLocal.length; i++) rawLocal[i] = next[i];
    }

    const cumLen = new Float64Array(rawLocal.length);
    for (let i = 1; i < rawLocal.length; i++) {
      cumLen[i] = cumLen[i - 1] + Math.hypot(rawLocal[i][0] - rawLocal[i - 1][0], rawLocal[i][1] - rawLocal[i - 1][1]);
    }
    const totalLen = Math.max(1e-4, cumLen[cumLen.length - 1]);

    roads.push({
      id: 'main',
      kind: 'serpentine',
      width: 0.88,
      closed: false,
      points: rawLocal.map(([lx, lz], i) => {
        const [wx, wz] = toWorld(lx, lz);
        return { x: wx, z: wz, y: terrain.heightAt(wx, wz), t: cumLen[i] / totalLen };
      }),
    });
  }

  // 2. Coastal Cliffside Corniche looping all 360° around the island perimeter (`inland ≈ 5.2`)
  {
    const N = 128;
    const pts: IslandRoadPoint[] = [];
    for (let i = 0; i <= N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const rad = Math.max(14, localCoastRadius(ang) - 5.2);
      const [wx, wz] = toWorld(Math.cos(ang) * rad, Math.sin(ang) * rad);
      pts.push({ x: wx, z: wz, y: terrain.heightAt(wx, wz), t: i / N });
    }
    roads.push({
      id: 'corniche',
      kind: 'corniche',
      width: 0.78,
      closed: true,
      points: pts,
    });
  }

  // 3. Mid-Mountain Contour Terrace Loop wrapping around the flanks & rear ridge (`0.62 * coastR`)
  {
    const N = 104;
    const pts: IslandRoadPoint[] = [];
    for (let i = 0; i <= N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const rad = Math.max(11, localCoastRadius(ang) * 0.62);
      const [wx, wz] = toWorld(Math.cos(ang) * rad, Math.sin(ang) * rad);
      pts.push({ x: wx, z: wz, y: terrain.heightAt(wx, wz), t: i / N });
    }
    roads.push({
      id: 'mid_ring',
      kind: 'terrace',
      width: 0.72,
      closed: true,
      points: pts,
    });
  }

  // 4. Stepped Cliffside Alleys connecting the coastal corniche flush to the mid-mountain loop (zero overshoot stub!)
  const alleyAngles = [
    Math.PI * 0.5 - 0.82,
    Math.PI * 0.5 + 0.86,
    -Math.PI * 0.5 - 0.52,
    -Math.PI * 0.5 + 0.48,
    0.08,
    Math.PI - 0.12,
  ];
  alleyAngles.forEach((baseAng, aIdx) => {
    const rOuter = Math.max(14, localCoastRadius(baseAng) - 5.2);
    const rInner = Math.max(11, localCoastRadius(baseAng) * 0.62);
    const steps = 14;
    const pts: IslandRoadPoint[] = [];
    const wiggle = (aIdx % 2 === 0 ? 1 : -1) * 0.07;
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const rad = rOuter + (rInner - rOuter) * u;
      const ang = baseAng + Math.sin(u * Math.PI) * wiggle;
      const [wx, wz] = toWorld(Math.cos(ang) * rad, Math.sin(ang) * rad);
      pts.push({ x: wx, z: wz, y: terrain.heightAt(wx, wz), t: u });
    }
    roads.push({
      id: `alley_${aIdx}`,
      kind: 'alley',
      width: 0.62,
      closed: false,
      points: pts,
    });
  });

  return roads;
}

interface AABB2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function polyAABB(poly: V2[]): AABB2D {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const x = poly[i][0];
    const z = poly[i][1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

function aabbIntersects(a: AABB2D, b: AABB2D): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ);
}

// ---------------------------------------------------------------------------
// Complete Deterministic Italian Mountain Island World (Ultra-Dense Stacked Village!)
// ---------------------------------------------------------------------------

export function createIslandWorld(opts: IslandWorldOptions): IslandWorld {
  const seed = Math.max(0, Math.round(opts.seed));
  const hills = Math.max(0, Math.min(1, opts.hills));
  const normalizedOpts: IslandWorldOptions = { ...opts, seed, hills };

  const { terrain, orientAng, harborLocal, summitLocal, localCoastRadius } = createIslandTerrain(seed, hills);
  const cosO = Math.cos(orientAng);
  const sinO = Math.sin(orientAng);
  const toWorld = (lx: number, lz: number): V2 => [lx * cosO - lz * sinO, lx * sinO + lz * cosO];

  const [hx, hz] = toWorld(harborLocal[0], harborLocal[1]);
  const [sx, sz] = toWorld(summitLocal[0], summitLocal[1]);
  const harborPos: [number, number, number] = [hx, terrain.heightAt(hx, hz), hz];
  const summitPos: [number, number, number] = [sx, terrain.heightAt(sx, sz), sz];
  const maxElev = Math.max(4, summitPos[1]);

  const roads = buildIslandRoads(terrain, orientAng, harborLocal, summitLocal, localCoastRadius, seed);
  const contours = extractIslandContours(terrain, 44, 76, 0.78);

  interface RoadSeg {
    a: V2;
    b: V2;
    width: number;
  }
  const roadSegs: RoadSeg[] = [];
  for (const r of roads) {
    for (let i = 0; i < r.points.length - 1; i++) {
      const a: V2 = [r.points[i].x, r.points[i].z];
      const b: V2 = [r.points[i + 1].x, r.points[i + 1].z];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.14) {
        roadSegs.push({ a, b, width: r.width });
      }
    }
  }

  // Fast 2D spatial hash grids for road segments & placed buildings -> <25ms even at 950+ houses!
  const CELL = 3.2;
  const invCell = 1 / CELL;
  const cellKey = (cx: number, cz: number) => ((cx + 512) << 10) | (cz + 512);

  const roadBoxes: V2[][] = [];
  const roadAABBs: AABB2D[] = [];
  const roadGrid = new Map<number, number[]>();
  for (let i = 0; i < roadSegs.length; i++) {
    const seg = roadSegs[i];
    const box = buildStreetRect(seg.a, seg.b, seg.width * 0.5 + 0.02, 0.04);
    const aabb = polyAABB(box);
    roadBoxes.push(box);
    roadAABBs.push(aabb);
    const x0 = Math.floor(aabb.minX * invCell);
    const x1 = Math.floor(aabb.maxX * invCell);
    const z0 = Math.floor(aabb.minZ * invCell);
    const z1 = Math.floor(aabb.maxZ * invCell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = cellKey(cx, cz);
        let bucket = roadGrid.get(k);
        if (!bucket) {
          bucket = [];
          roadGrid.set(k, bucket);
        }
        bucket.push(i);
      }
    }
  }

  const rng = makeRng((seed * 6133 + 1091) >>> 0);
  const plots: CityBuildingPlot[] = [];
  const placedPaddedOBBs: V2[][] = [];
  const placedAABBs: AABB2D[] = [];
  const placedGrid = new Map<number, number[]>();
  const roadStamps = new Uint32Array(Math.max(1, roadBoxes.length));
  let plotStamps = new Uint32Array(1280);
  let stampCounter = 1;
  let rooftopCount = 0;

  const italianWinDetails = ['six', 'cross', 'transom', 'clean', 'six', 'triple'] as const;
  const italianWinStyles = ['arched', 'tall', 'pair', 'rect', 'arched', 'tall'] as const;
  const italianWinOpenings = ['shutters', 'awning', 'casement', 'shutters', 'louver'] as const;

  const overlapsAnyRoad = (poly: V2[], aabb: AABB2D): boolean => {
    const stamp = ++stampCounter;
    const x0 = Math.floor(aabb.minX * invCell);
    const x1 = Math.floor(aabb.maxX * invCell);
    const z0 = Math.floor(aabb.minZ * invCell);
    const z1 = Math.floor(aabb.maxZ * invCell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const bucket = roadGrid.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (let bi = 0; bi < bucket.length; bi++) {
          const idx = bucket[bi];
          if (roadStamps[idx] === stamp) continue;
          roadStamps[idx] = stamp;
          if (!aabbIntersects(aabb, roadAABBs[idx])) continue;
          if (polygonsOverlap(poly, roadBoxes[idx])) return true;
        }
      }
    }
    return false;
  };

  const overlapsAnyPlaced = (poly: V2[], aabb: AABB2D): boolean => {
    const stamp = ++stampCounter;
    const x0 = Math.floor(aabb.minX * invCell);
    const x1 = Math.floor(aabb.maxX * invCell);
    const z0 = Math.floor(aabb.minZ * invCell);
    const z1 = Math.floor(aabb.maxZ * invCell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const bucket = placedGrid.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (let bi = 0; bi < bucket.length; bi++) {
          const idx = bucket[bi];
          if (plotStamps[idx] === stamp) continue;
          plotStamps[idx] = stamp;
          if (!aabbIntersects(aabb, placedAABBs[idx])) continue;
          if (polygonsOverlap(poly, placedPaddedOBBs[idx])) return true;
        }
      }
    }
    return false;
  };

  /**
   * Measure how dramatically the mountain rises BEHIND a house at `(bx, bz)` facing `yaw`.
   * High elevation behind -> towering 4, 5, and 6-level stacked Italian cliffside palazzi!
   */
  const computeBackElevationScore = (bx: number, bz: number, yaw: number): number => {
    const backX = -Math.sin(yaw);
    const backZ = -Math.cos(yaw);
    const hHere = terrain.heightAt(bx, bz);
    const hB1 = terrain.heightAt(bx + backX * 2.5, bz + backZ * 2.5);
    const hB2 = terrain.heightAt(bx + backX * 5.8, bz + backZ * 5.8);
    const hB3 = terrain.heightAt(bx + backX * 11.0, bz + backZ * 11.0);

    // Also sample diagonal-back (±35°) so flanking mountain walls looming behind count cleanly!
    const cos35 = 0.819;
    const sin35 = 0.574;
    const bLx = backX * cos35 - backZ * sin35;
    const bLz = backX * sin35 + backZ * cos35;
    const bRx = backX * cos35 + backZ * sin35;
    const bRz = -backX * sin35 + backZ * cos35;
    const hBL = terrain.heightAt(bx + bLx * 5.5, bz + bLz * 5.5);
    const hBR = terrain.heightAt(bx + bRx * 5.5, bz + bRz * 5.5);

    const riseNear = Math.max(0, hB1 - hHere);
    const riseMid = Math.max(0, Math.max(hB2, hBL * 0.92, hBR * 0.92) - hHere);
    const riseFar = Math.max(0, hB3 - hHere);
    return riseNear * 0.55 + riseMid * 0.36 + riseFar * 0.22;
  };

  /** Pick authentic story count (`1..6`) strongly driven by mountain elevation behind the house! */
  const pickItalianLevels = (backScore: number): BuildingLevels => {
    const r = rng.next();
    if (backScore >= 2.85) {
      // Steep mountain / cliff rising sharply right behind -> towering 4-5-6 level palazzi!
      if (r < 0.44) return 6;
      if (r < 0.82) return 5;
      return 4;
    }
    if (backScore >= 1.80) {
      // Strong amphitheater / hillside backdrop behind -> dense 4-5-6 level cliff townhouses!
      if (r < 0.18) return 6;
      if (r < 0.58) return 5;
      if (r < 0.94) return 4;
      return 3;
    }
    if (backScore >= 0.95) {
      // Moderate slope rising behind -> mostly 3-4-5 level stacked hillside houses!
      if (r < 0.20) return 5;
      if (r < 0.66) return 4;
      if (r < 0.94) return 3;
      return 2;
    }
    if (backScore >= 0.40) {
      // Gentle rise behind -> mixed 2-3-4 level village houses
      if (r < 0.30) return 4;
      if (r < 0.72) return 3;
      if (r < 0.95) return 2;
      return 1;
    }
    // Summit crest / open promontory -> balanced 2-3 level cottages & occasional 4F accent tower
    if (r < 0.14) return 4;
    if (r < 0.54) return 3;
    if (r < 0.94) return 2;
    return 1;
  };

  const tryPlaceHouse = (
    bx: number,
    bz: number,
    yaw: number,
    isSummit: boolean,
    gen: number,
    mixOpts: HouseMixOptions,
    rawSpec: HouseNetSpec,
    plotScale: number,
    skipRoadCheck = false,
  ): boolean => {
    const spec: HouseNetSpec = { ...rawSpec, yawOffset: 0 };
    const { fpW, fpD } = extractFootprintSize(spec, plotScale);
    const halfW = fpW * 0.5;
    const halfD = fpD * 0.5;
    const footprint = makeBuildingOBB(bx, bz, yaw, halfW, halfD);

    // Every corner must sit cleanly atop the island cliff rim (never dangling down outer rock!)
    for (const [fx, fz] of footprint) {
      if (terrain.signedInland(fx, fz) < 3.15) return false;
    }

    // Tight shoulder-to-shoulder Mediterranean village spacing (still strictly zero overlap!)
    const padGap = 0.032;
    const paddedCheck = makeBuildingOBB(bx, bz, yaw, halfW + padGap, halfD + padGap);
    const paddedAABB = polyAABB(paddedCheck);

    if (!skipRoadCheck) {
      const roadCheck = makeBuildingOBB(bx, bz, yaw, halfW + 0.018, halfD + 0.018);
      if (overlapsAnyRoad(roadCheck, polyAABB(roadCheck))) return false;
    }
    if (overlapsAnyPlaced(paddedCheck, paddedAABB)) return false;

    const ys = [terrain.heightAt(bx, bz), ...footprint.map(([fx, fz]) => terrain.heightAt(fx, fz))];
    const groundMinY = Math.min(...ys);
    const groundMaxY = Math.max(...ys);
    const slopeDrop = groundMaxY - groundMinY;
    if (groundMinY < 0.36 || slopeDrop > 4.1) return false;

    // Ground the facade near the downhill / front street edge so tall 4-6 story windowed facades
    // cascade down the cliff while the uphill rear tucks cleanly into the rising hillside (no giant blank plinth!)
    const frontX = Math.sin(yaw);
    const frontZ = Math.cos(yaw);
    const frontEdgeY = terrain.heightAt(bx + frontX * halfD, bz + frontZ * halfD);
    const frontAnchor = Math.min(frontEdgeY, groundMinY + slopeDrop * 0.44);
    const baseY = Math.max(groundMinY + 0.04, Math.min(groundMaxY - 0.02, frontAnchor + 0.06));

    const idx = plots.length;
    if (idx >= plotStamps.length) {
      const grown = new Uint32Array(plotStamps.length * 2);
      plotStamps = grown;
    }
    const colorIndex = Math.floor(hash2i(idx * 17 + 3, Math.round(bz * 4), seed + 83) * 8) % 8;
    const elevOrder = Math.max(0, Math.min(1, (baseY - 0.8) / Math.max(1, maxElev - 0.8)));

    plots.push({
      id: `isl_p${idx}`,
      index: idx,
      x: bx,
      z: bz,
      baseY,
      groundMinY,
      yaw,
      footprint,
      footprintW: fpW,
      footprintD: fpD,
      scale: plotScale,
      colorIndex,
      elevOrder,
      isSummit,
      generation: gen,
      mixOpts,
      spec,
    });
    placedPaddedOBBs.push(paddedCheck);
    placedAABBs.push(paddedAABB);
    const x0 = Math.floor(paddedAABB.minX * invCell);
    const x1 = Math.floor(paddedAABB.maxX * invCell);
    const z0 = Math.floor(paddedAABB.minZ * invCell);
    const z1 = Math.floor(paddedAABB.maxZ * invCell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = cellKey(cx, cz);
        let bucket = placedGrid.get(k);
        if (!bucket) {
          bucket = [];
          placedGrid.set(k, bucket);
        }
        bucket.push(idx);
      }
    }
    rooftopCount += spec.topology === 'village' && spec.village ? spec.village.count : 1;
    return true;
  };

  const chooseItalianMix = (
    bx: number,
    bz: number,
    yaw: number,
    elev01: number,
    slotIdx: number,
    mode: 'full' | 'compact' | 'narrow' = 'full',
  ): { gen: number; mixOpts: HouseMixOptions; levels: BuildingLevels } => {
    const hSeed = ((hash2u32(slotIdx * 31 + 7, Math.round(bx * 5) ^ Math.round(bz * 7), seed + 29) % 99989) + 1);
    const gen = (slotIdx % 14) + 1;
    const backScore = computeBackElevationScore(bx, bz, yaw);
    const levels = pickItalianLevels(backScore);
    const heightScale = rng.range(0.88, 1.14);

    const baseGrammar: HouseMixOptions = {
      seed: hSeed,
      consistency: opts.consistency ?? 0.76,
      windowStyle: opts.windowStyle ?? rng.pick(italianWinStyles),
      windowOpening: opts.windowOpening ?? rng.pick(italianWinOpenings),
      windowDetail: opts.windowDetail ?? rng.pick(italianWinDetails),
      levels,
      heightScale,
    };

    // Tall 4-6 story cliffside palazzi & compact/narrow packed gap houses ALWAYS use crisp single-volume nets
    if (mode !== 'full' || levels >= 4) {
      const tallRoofPool: RoofType[] =
        levels >= 5
          ? ['gable', 'hip', 'flat', 'mansard', 'shed', 'gable', 'hip']
          : ['gable', 'gable', 'hip', 'mansard', 'flat', 'shed', 'spire'];
      const roofType = rng.pick(tallRoofPool);
      const gableProfile: GableProfile | null =
        roofType === 'gable' ? rng.pick(['classic', 'classic', 'stepped', 'saltbox', 'gambrel'] as const) : null;
      const topo =
        mode === 'full' && levels === 4 && elev01 > 0.65 && rng.chance(0.08)
          ? 'oct'
          : rng.chance(0.86)
            ? 'ribbon'
            : 'cross';
      return {
        gen: topo === 'oct' ? 3 : 1,
        levels,
        mixOpts: {
          ...baseGrammar,
          topology: topo,
          roofType,
          gableProfile,
        },
      };
    }

    const r = rng.next();
    if (elev01 < 0.25 && r < 0.26) {
      return { gen, levels, mixOpts: { ...baseGrammar, topology: 'village', houses: 2 } };
    }
    if (elev01 > 0.72 && r < 0.28) {
      const pick = rng.pick(['spire', 'mansard', 'stepped', 'oct'] as const);
      if (pick === 'spire') return { gen: 1, levels, mixOpts: { ...baseGrammar, topology: 'ribbon', roofType: 'spire' } };
      if (pick === 'oct') return { gen: 3, levels, mixOpts: { ...baseGrammar, topology: 'oct' } };
      if (pick === 'stepped') {
        return {
          gen: 1,
          levels,
          mixOpts: { ...baseGrammar, topology: 'ribbon', roofType: 'gable', gableProfile: 'stepped' },
        };
      }
      return { gen: 2, levels, mixOpts: { ...baseGrammar, topology: 'ribbon', roofType: 'mansard' } };
    }
    if (r < 0.16) {
      return { gen, levels, mixOpts: { ...baseGrammar, topology: 'village', houses: 2 } };
    }
    if (r < 0.24) {
      return { gen: 5, levels, mixOpts: { ...baseGrammar, topology: 'lwing' } };
    }
    const roofPool: RoofType[] = ['gable', 'gable', 'hip', 'mansard', 'flat', 'shed', 'spire'];
    const roofType = rng.pick(roofPool);
    const gableProfile: GableProfile | null =
      roofType === 'gable' ? rng.pick(['classic', 'classic', 'stepped', 'gambrel', 'saltbox'] as const) : null;
    return {
      gen,
      levels,
      mixOpts: {
        ...baseGrammar,
        topology: rng.chance(0.78) ? 'ribbon' : 'cross',
        roofType,
        gableProfile,
      },
    };
  };

  /** Clamp footprint cleanly into authentic slender Italian hillside palazzo proportions */
  const fitPalazzoSpec = (raw: HouseNetSpec, maxW: number, maxD: number, minW = 19): HouseNetSpec => {
    if (raw.topology === 'village' || raw.topology === 'lwing' || raw.topology === 'setback') return raw;
    const W = Math.max(minW, Math.min(raw.W, maxW));
    const D = Math.max(minW, Math.min(raw.D, maxD));
    return { ...raw, W, D };
  };

  // 1. Hero Summit Campanile / Hilltop Chapel crowning the top of the serpentine climb!
  {
    const summitSeed = ((seed * 37 + 101) % 99989) + 1;
    const summitMix: HouseMixOptions = {
      seed: summitSeed,
      topology: rng.chance(0.55) ? 'oct' : 'ribbon',
      roofType: 'spire',
      levels: 4,
      consistency: opts.consistency ?? 0.78,
      windowStyle: opts.windowStyle ?? 'arched',
      windowOpening: opts.windowOpening ?? 'shutters',
      windowDetail: opts.windowDetail ?? 'six',
    };
    const summitSpec: HouseNetSpec = { ...generateHouseSpec(1, summitMix), W: 30, D: 30 };
    const bayYaw = Math.atan2(hx - sx, hz - sz);
    const topDirX = Math.sin(bayYaw);
    const topDirZ = Math.cos(bayYaw);
    tryPlaceHouse(
      sx - topDirX * 1.9,
      sz - topDirZ * 1.9,
      bayYaw,
      true,
      1,
      summitMix,
      summitSpec,
      0.46,
      true,
    );
  }

  // 2. Pass 1: Shoulder-to-shoulder Italian street frontage along ALL island roads!
  interface FrontageCand {
    px: number;
    pz: number;
    nx: number;
    nz: number;
    roadHalfW: number;
    prio: number;
  }
  const candidates: FrontageCand[] = [];
  for (const r of roads) {
    const prioBase = r.kind === 'serpentine' ? 0 : r.kind === 'corniche' ? 1 : r.kind === 'terrace' ? 2 : 3;
    let accum = 0.45;
    for (let i = 0; i < r.points.length - 1; i++) {
      const a = r.points[i];
      const b = r.points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const tx = dx / len;
      const tz = dz / len;
      let cursor = accum;
      while (cursor < len) {
        const px = a.x + tx * cursor;
        const pz = a.z + tz * cursor;
        for (const side of [-1, 1]) {
          candidates.push({
            px,
            pz,
            nx: -tz * side,
            nz: tx * side,
            roadHalfW: r.width * 0.5,
            prio: prioBase + rng.next() * 0.45,
          });
        }
        cursor += rng.range(0.76, 1.18);
      }
      accum = cursor - len;
    }
  }
  candidates.sort((a, b) => a.prio - b.prio);

  const PASS1_MAX_PLOTS = 460;
  const PASS2_MAX_PLOTS = 920;
  const MAX_ISLAND_PLOTS = 1320;
  let attemptIdx = 0;

  for (const cand of candidates) {
    if (plots.length >= PASS1_MAX_PLOTS) break;
    attemptIdx++;

    // Keep house parallel to road, but orient front downhill toward the sea whenever there's a clear
    // hillside slope so tall 4-6F windowed facades always face outward with the mountain rising behind!
    const probeX = cand.px + cand.nx * (cand.roadHalfW + 0.9);
    const probeZ = cand.pz + cand.nz * (cand.roadHalfW + 0.9);
    const hOut = terrain.heightAt(probeX + cand.nx * 1.4, probeZ + cand.nz * 1.4);
    const hRoad = terrain.heightAt(cand.px, cand.pz);
    const faceDownhillSea = hOut < hRoad - 0.28;
    const yaw = faceDownhillSea ? Math.atan2(cand.nx, cand.nz) : Math.atan2(-cand.nx, -cand.nz);

    const estElev = Math.max(0, Math.min(1, hRoad / maxElev));
    const { gen, mixOpts, levels } = chooseItalianMix(probeX, probeZ, yaw, estElev, attemptIdx, 'full');
    const plotScale = rng.range(0.33, 0.42);
    const maxSpan = levels >= 4 ? 33 : 40;
    const primarySpec = fitPalazzoSpec(generateHouseSpec(gen, mixOpts), maxSpan, maxSpan + 4, 22);
    const { fpD } = extractFootprintSize(primarySpec, plotScale);
    const sidewalk = rng.range(0.04, 0.10);
    const bx = cand.px + cand.nx * (cand.roadHalfW + sidewalk + fpD * 0.5);
    const bz = cand.pz + cand.nz * (cand.roadHalfW + sidewalk + fpD * 0.5);

    if (tryPlaceHouse(bx, bz, yaw, false, gen, mixOpts, primarySpec, plotScale)) {
      continue;
    }

    // Compact slender Italian townhouse fallback
    const { mixOpts: cMix } = chooseItalianMix(probeX, probeZ, yaw, estElev, attemptIdx + 1000, 'compact');
    const cSpec = fitPalazzoSpec(generateHouseSpec(1, cMix), 25, 27, 19);
    const cScale = rng.range(0.31, 0.38);
    const { fpD: cFpD } = extractFootprintSize(cSpec, cScale);
    const cBx = cand.px + cand.nx * (cand.roadHalfW + 0.06 + cFpD * 0.5);
    const cBz = cand.pz + cand.nz * (cand.roadHalfW + 0.06 + cFpD * 0.5);
    if (tryPlaceHouse(cBx, cBz, yaw, false, 1, cMix, cSpec, cScale)) {
      continue;
    }

    // Ultra-narrow alley townhouse fallback to squeeze tight between street neighbors!
    const { mixOpts: nMix } = chooseItalianMix(probeX, probeZ, yaw, estElev, attemptIdx + 2000, 'narrow');
    const nSpec = fitPalazzoSpec(generateHouseSpec(1, nMix), 21, 22, 17);
    const nScale = rng.range(0.29, 0.35);
    const { fpD: nFpD } = extractFootprintSize(nSpec, nScale);
    const nBx = cand.px + cand.nx * (cand.roadHalfW + 0.05 + nFpD * 0.5);
    const nBz = cand.pz + cand.nz * (cand.roadHalfW + 0.05 + nFpD * 0.5);
    tryPlaceHouse(nBx, nBz, yaw, false, 1, nMix, nSpec, nScale);
  }

  // Helper to compute downhill sea-facing yaw at any hillside coordinate
  const epsG = 0.6;
  const downhillYawAt = (x: number, z: number, jitter: number): number => {
    const hL = terrain.heightAt(x - epsG, z);
    const hR = terrain.heightAt(x + epsG, z);
    const hD = terrain.heightAt(x, z - epsG);
    const hU = terrain.heightAt(x, z + epsG);
    const downX = hL - hR;
    const downZ = hD - hU;
    return Math.hypot(downX, downZ) > 0.08
      ? Math.atan2(downX, downZ) + jitter
      : Math.atan2(x, z) + jitter;
  };

  // 3. Pass 2: Dense Stacked Hillside Terraces across every amphitheater tier, headland & back slope!
  const infillSites: Array<{ x: number; z: number; sortKey: number }> = [];
  const LATTICE = 1.44;
  const gridN = 26;
  for (let gx = -gridN; gx <= gridN; gx++) {
    for (let gz = -gridN; gz <= gridN; gz++) {
      const ix = gx * LATTICE + (gz % 2 === 0 ? 0 : LATTICE * 0.5) + (hash2i(gx, gz, seed + 503) - 0.5) * 0.62;
      const iz = gz * LATTICE + (hash2i(gx, gz, seed + 709) - 0.5) * 0.62;
      if (terrain.signedInland(ix, iz) < 3.35) continue;
      infillSites.push({ x: ix, z: iz, sortKey: hash2i(gx, gz, seed + 919) });
    }
  }
  infillSites.sort((a, b) => a.sortKey - b.sortKey);

  const nudgeOffsets: ReadonlyArray<V2> = [
    [0, 0],
    [0.38, 0],
    [-0.38, 0],
    [0, 0.38],
    [0, -0.38],
  ];

  for (const site of infillSites) {
    if (plots.length >= PASS2_MAX_PLOTS) break;
    attemptIdx++;
    const yaw = downhillYawAt(site.x, site.z, (rng.next() - 0.5) * 0.20);
    const estElev = Math.max(0, Math.min(1, terrain.heightAt(site.x, site.z) / maxElev));
    const { gen, mixOpts, levels } = chooseItalianMix(site.x, site.z, yaw, estElev, attemptIdx, 'full');
    const plotScale = rng.range(0.32, 0.41);
    const maxSpan = levels >= 4 ? 32 : 38;
    const spec = fitPalazzoSpec(generateHouseSpec(gen, mixOpts), maxSpan, maxSpan + 3, 21);

    let placed = false;
    for (const [ox, oz] of nudgeOffsets) {
      if (tryPlaceHouse(site.x + ox, site.z + oz, yaw, false, gen, mixOpts, spec, plotScale)) {
        placed = true;
        break;
      }
    }
    if (placed) continue;

    const { mixOpts: cMix } = chooseItalianMix(site.x, site.z, yaw, estElev, attemptIdx + 3000, 'compact');
    const cSpec = fitPalazzoSpec(generateHouseSpec(1, cMix), 24, 26, 19);
    const cScale = rng.range(0.30, 0.37);
    for (const [ox, oz] of nudgeOffsets) {
      if (tryPlaceHouse(site.x + ox, site.z + oz, yaw, false, 1, cMix, cSpec, cScale)) {
        break;
      }
    }
  }

  // 4. Pass 3: Ultra-Tight Between-House Gap Packer!
  //    Packs slender vertical townhouses & 4-6F cliff towers directly into EVERY leftover pocket
  //    between existing houses so the village reads as one continuous cascading Positano cluster!
  const gapSites: Array<{ x: number; z: number; sortKey: number }> = [];
  const GAP_LATTICE = 1.02;
  const gapN = 36;
  for (let gx = -gapN; gx <= gapN; gx++) {
    for (let gz = -gapN; gz <= gapN; gz++) {
      const ix = gx * GAP_LATTICE + (gz % 2 === 0 ? 0 : GAP_LATTICE * 0.5) + (hash2i(gx, gz, seed + 1237) - 0.5) * 0.36;
      const iz = gz * GAP_LATTICE + (hash2i(gx, gz, seed + 1613) - 0.5) * 0.36;
      if (terrain.signedInland(ix, iz) < 3.45) continue;
      gapSites.push({ x: ix, z: iz, sortKey: hash2i(gx, gz, seed + 2089) });
    }
  }
  gapSites.sort((a, b) => a.sortKey - b.sortKey);

  const microNudges: ReadonlyArray<V2> = [
    [0, 0],
    [0.28, 0.14],
    [-0.28, -0.14],
    [-0.14, 0.28],
    [0.14, -0.28],
  ];

  for (const site of gapSites) {
    if (plots.length >= MAX_ISLAND_PLOTS) break;
    attemptIdx++;
    const yaw = downhillYawAt(site.x, site.z, (rng.next() - 0.5) * 0.16);
    const estElev = Math.max(0, Math.min(1, terrain.heightAt(site.x, site.z) / maxElev));
    const { mixOpts: nMix } = chooseItalianMix(site.x, site.z, yaw, estElev, attemptIdx + 5000, 'narrow');
    const nSpec = fitPalazzoSpec(generateHouseSpec(1, nMix), rng.range(20, 25), rng.range(21, 26), 17);
    const nScale = rng.range(0.28, 0.36);

    let placed = false;
    for (const [ox, oz] of microNudges) {
      if (tryPlaceHouse(site.x + ox, site.z + oz, yaw, false, 1, nMix, nSpec, nScale)) {
        placed = true;
        break;
      }
    }
    if (placed) continue;

    // Try a tiny vertical cliff tower (or rotated 90° to slide cleanly into a narrow side-alley slot!)
    const tinySpec = fitPalazzoSpec(generateHouseSpec(1, nMix), 19, 20, 16);
    const tinyScale = rng.range(0.27, 0.33);
    if (!tryPlaceHouse(site.x, site.z, yaw, false, 1, nMix, tinySpec, tinyScale)) {
      tryPlaceHouse(site.x, site.z, yaw + Math.PI * 0.5, false, 1, nMix, tinySpec, tinyScale);
    }
  }

  // 5. Mediterranean Cypresses & Umbrella Stone Pines tucked into cliff rims, ridges & garden pockets!
  const trees: IslandTree[] = [];
  const treeRng = makeRng((seed * 48271 + 911) >>> 0);
  const MAX_TREES = 96;

  for (let attempt = 0; attempt < 1200 && trees.length < MAX_TREES; attempt++) {
    const tx = treeRng.range(-39, 39);
    const tz = treeRng.range(-39, 39);
    const inland = terrain.signedInland(tx, tz);
    if (inland < 1.7) continue;
    const ty = terrain.heightAt(tx, tz);
    if (ty < 0.70) continue;

    let ok = true;
    for (const seg of roadSegs) {
      if (distPointToSeg(tx, tz, seg.a, seg.b) < seg.width * 0.5 + 0.38) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    const treeBox: V2[] = [
      [tx - 0.34, tz - 0.34],
      [tx + 0.34, tz - 0.34],
      [tx + 0.34, tz + 0.34],
      [tx - 0.34, tz + 0.34],
    ];
    if (overlapsAnyPlaced(treeBox, polyAABB(treeBox))) continue;

    for (const other of trees) {
      if (Math.hypot(tx - other.x, tz - other.z) < 1.20) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    const rV = treeRng.next();
    const variant: 0 | 1 | 2 = rV < 0.62 ? 0 : rV < 0.84 ? 2 : 1;
    trees.push({
      x: tx,
      z: tz,
      y: ty,
      scale: treeRng.range(0.48, 0.92),
      rotY: treeRng.range(0, Math.PI * 2),
      variant,
    });
  }

  return {
    seed,
    hills,
    options: normalizedOpts,
    terrain,
    harborPos,
    summitPos,
    roads,
    plots,
    trees,
    contours,
    rooftopCount,
  };
}
