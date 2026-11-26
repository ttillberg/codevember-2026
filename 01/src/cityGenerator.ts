import {
  MM,
  buildHouseNet,
  generateHouseSpec,
  polygonsOverlap,
  type HouseMixOptions,
  type HouseNetSpec,
  type RoofType,
  type V2,
} from './origamiHouseNet';

export type CityStreetStyle = 'organic' | 'grid' | 'radial';

export const ALL_CITY_STREET_STYLES: readonly CityStreetStyle[] = ['organic', 'grid', 'radial'];

export interface CityTerrainField {
  seed: number;
  /** Normalized relief amplitude (`0` = flat, `1` = steep dramatic hillside) */
  hills: number;
  /** Active city radius where full elevation applies (world units) */
  cityRadius: number;
  /** Outer radius where terrain blends seamlessly back to `y = 0` studio paper */
  fadeRadius: number;
  /** Primary hilltop world coordinates `(x, z)` */
  summit: [number, number];
  /** Evaluate continuous paper elevation `y >= 0` at world `(x, z)` */
  heightAt(x: number, z: number): number;
}

export interface CityContourSegment {
  a: [number, number];
  b: [number, number];
  y: number;
  isMajor: boolean;
}

export interface CityStreet {
  id: string;
  kind: 'avenue' | 'street' | 'lane';
  width: number;
  /** Ordered 2D world `(x, z)` polyline vertices */
  points: V2[];
}

export interface CityPlaza {
  x: number;
  z: number;
  radius: number;
}

export interface CityBuildingPlot {
  id: string;
  index: number;
  x: number;
  z: number;
  /** World Y where the house base rests level (top of its architectural retaining plinth) */
  baseY: number;
  /** Lowest terrain elevation under the footprint (plinth extends cleanly below this) */
  groundMinY: number;
  /** Rotation around +Y so the building's street-facing front (`+Z`) faces its street curb */
  yaw: number;
  /** Exact 2D world `(x, z)` footprint polygon (4 corners, CCW) */
  footprint: V2[];
  /** Unrotated local `(W, D)` footprint extents in world units */
  footprintW: number;
  footprintD: number;
  /** Exact generation + mix options so clicking this house loads it 1:1 in Fold View! */
  generation: number;
  mixOpts: HouseMixOptions;
  spec: HouseNetSpec;
  /** Radial/street wave delay order (`0..1`) for the city-wide origami fold bloom */
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

export interface CityLayout {
  seed: number;
  style: CityStreetStyle;
  hills: number;
  terrain: CityTerrainField;
  streets: CityStreet[];
  plazas: CityPlaza[];
  plots: CityBuildingPlot[];
  trees: CityTree[];
  contours: CityContourSegment[];
  /** Total distinct architectural rooftops (counting each wing inside composite houses!) */
  rooftopCount: number;
}

export interface CityBuildOptions {
  seed: number;
  style: CityStreetStyle;
  hills: number;
  consistency?: number | null;
  windowStyle?: HouseMixOptions['windowStyle'];
  windowOpening?: HouseMixOptions['windowOpening'];
  windowDetail?: HouseMixOptions['windowDetail'];
}

function makeCityRng(seed: number) {
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
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed | 1, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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

/**
 * Create a smooth, architectural seeded elevation field (`heightAt(x, z) >= 0`) featuring a sculptural
 * hilltop crown, gentle meandering valley, and smooth outer blend back to `y = 0` studio paper.
 */
export function createTerrainField(seed: number, hills01: number): CityTerrainField {
  const hills = Math.max(0, Math.min(1, hills01));
  const rng = makeCityRng((seed * 7919 + 4129) >>> 0);
  const cityRadius = 42;
  const fadeRadius = 60;

  // Place primary acropolis hill slightly off-center + opposing gentle valley for dramatic skyline silhouette
  const hillAng = rng.range(0, Math.PI * 2);
  const hillDist = rng.range(5, 14);
  const hillX = Math.cos(hillAng) * hillDist;
  const hillZ = Math.sin(hillAng) * hillDist;
  const hillSigma = rng.range(17, 23);

  const valAng = hillAng + Math.PI + rng.range(-0.65, 0.65);
  const valDist = rng.range(10, 18);
  const valX = Math.cos(valAng) * valDist;
  const valZ = Math.sin(valAng) * valDist;
  const valSigma = rng.range(15, 21);

  const ridgeAng = rng.range(0, Math.PI);
  const ridgeCos = Math.cos(ridgeAng);
  const ridgeSin = Math.sin(ridgeAng);

  const nSeed1 = (seed * 131 + 17) >>> 0;
  const nSeed2 = (seed * 521 + 97) >>> 0;
  const maxAmp = hills * 8.6;

  const heightAt = (x: number, z: number): number => {
    if (hills <= 1e-4) return 0;
    const r = Math.hypot(x, z);
    if (r >= fadeRadius) return 0;
    const fade = 1 - smoothstep(cityRadius - 2, fadeRadius, r);

    const dh2 = (x - hillX) * (x - hillX) + (z - hillZ) * (z - hillZ);
    const primaryHill = Math.exp(-dh2 / (2 * hillSigma * hillSigma));

    const dv2 = (x - valX) * (x - valX) + (z - valZ) * (z - valZ);
    const valleyDip = Math.exp(-dv2 / (2 * valSigma * valSigma)) * 0.42;

    const along = x * ridgeCos + z * ridgeSin;
    const across = -x * ridgeSin + z * ridgeCos;
    const ridgeWave = Math.sin(along * 0.095 + 0.6) * Math.exp(-(across * across) / (2 * 24 * 24)) * 0.22;

    const n1 = (valueNoise2D(x * 0.048 + 11.3, z * 0.048 - 7.1, nSeed1) - 0.35) * 0.48;
    const n2 = (valueNoise2D(x * 0.105 - 3.7, z * 0.105 + 19.2, nSeed2) - 0.5) * 0.16;

    const raw = Math.max(0, 0.22 + primaryHill * 0.78 - valleyDip + ridgeWave + n1 + n2);
    return raw * maxAmp * fade;
  };

  return {
    seed,
    hills,
    cityRadius,
    fadeRadius,
    summit: [hillX, hillZ],
    heightAt,
  };
}

/**
 * Extract crisp Marching Squares architectural contour polylines from `terrain` for subtle laser-etched
 * elevation rings across the rolling white paper landscape.
 */
export function extractContourSegments(
  terrain: CityTerrainField,
  gridRes = 76,
  extent = 54,
  stepY = 0.55,
): CityContourSegment[] {
  if (terrain.hills <= 0.02) return [];
  const step = (extent * 2) / gridRes;
  const heights = new Float32Array((gridRes + 1) * (gridRes + 1));
  let maxH = 0;
  for (let j = 0; j <= gridRes; j++) {
    const z = -extent + j * step;
    for (let i = 0; i <= gridRes; i++) {
      const x = -extent + i * step;
      const h = terrain.heightAt(x, z);
      heights[j * (gridRes + 1) + i] = h;
      if (h > maxH) maxH = h;
    }
  }

  const levels = Math.floor(maxH / stepY);
  const segs: CityContourSegment[] = [];

  for (let lv = 1; lv <= levels; lv++) {
    const iso = lv * stepY;
    const isMajor = lv % 4 === 0;
    for (let j = 0; j < gridRes; j++) {
      const z0 = -extent + j * step;
      const z1 = z0 + step;
      for (let i = 0; i < gridRes; i++) {
        const x0 = -extent + i * step;
        const x1 = x0 + step;
        const h00 = heights[j * (gridRes + 1) + i];
        const h10 = heights[j * (gridRes + 1) + (i + 1)];
        const h11 = heights[(j + 1) * (gridRes + 1) + (i + 1)];
        const h01 = heights[(j + 1) * (gridRes + 1) + i];

        const m =
          (h00 >= iso ? 1 : 0) |
          (h10 >= iso ? 2 : 0) |
          (h11 >= iso ? 4 : 0) |
          (h01 >= iso ? 8 : 0);
        if (m === 0 || m === 15) continue;

        const interp = (a: number, b: number, ha: number, hb: number) =>
          Math.abs(hb - ha) < 1e-6 ? (a + b) * 0.5 : a + ((iso - ha) / (hb - ha)) * (b - a);

        const e0: [number, number] = [interp(x0, x1, h00, h10), z0]; // top
        const e1: [number, number] = [x1, interp(z0, z1, h10, h11)]; // right
        const e2: [number, number] = [interp(x0, x1, h01, h11), z1]; // bottom
        const e3: [number, number] = [x0, interp(z0, z1, h00, h01)]; // left

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

function segmentIntersection(a: V2, b: V2, c: V2, d: V2): { t: number; u: number; pt: V2 } | null {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const denom = rx * sz - rz * sx;
  if (Math.abs(denom) < 1e-6) return null;
  const qpx = c[0] - a[0];
  const qpz = c[1] - a[1];
  const t = (qpx * sz - qpz * sx) / denom;
  const u = (qpx * rz - qpz * rx) / denom;
  if (t > 0.02 && t <= 1.0 && u >= -0.02 && u <= 1.02) {
    return { t, u, pt: [a[0] + t * rx, a[1] + t * rz] };
  }
  return null;
}

function distPointToSeg(px: number, pz: number, a: V2, b: V2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-8) return Math.hypot(px - a[0], pz - a[1]);
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
}

function subdividePolyline(pts: V2[], maxSegLen = 1.65): V2[] {
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

interface RawSegment {
  a: V2;
  b: V2;
  width: number;
  kind: CityStreet['kind'];
  streetId: string;
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
  // Local +X -> (cos(yaw), -sin(yaw)), Local +Z -> (sin(yaw), cos(yaw))
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pt = (lx: number, lz: number): V2 => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  return [pt(-halfW, -halfD), pt(halfW, -halfD), pt(halfW, halfD), pt(-halfW, halfD)];
}

/**
 * Generate randomized planar street topologies (`organic`, `grid`, or `radial`) with plazas and terrain-aware curves.
 */
function generateStreetNetwork(
  seed: number,
  style: CityStreetStyle,
  terrain: CityTerrainField,
): { streets: CityStreet[]; plazas: CityPlaza[]; rawSegments: RawSegment[] } {
  const rng = makeCityRng((seed * 104729 + (style === 'organic' ? 11 : style === 'grid' ? 37 : 73)) >>> 0);
  const streets: CityStreet[] = [];
  const plazas: CityPlaza[] = [];
  const rawSegments: RawSegment[] = [];
  const R_MAX = 39.5;

  const commitStreet = (id: string, kind: CityStreet['kind'], width: number, rawPts: V2[]) => {
    if (rawPts.length < 2) return;
    for (let i = 0; i < rawPts.length - 1; i++) {
      if (Math.hypot(rawPts[i + 1][0] - rawPts[i][0], rawPts[i + 1][1] - rawPts[i][1]) > 0.25) {
        rawSegments.push({ a: rawPts[i], b: rawPts[i + 1], width, kind, streetId: id });
      }
    }
    streets.push({ id, kind, width, points: subdividePolyline(rawPts, 1.55) });
  };

  if (style === 'organic') {
    // 1. Central plaza slightly shifted toward summit or city center
    const px = terrain.summit[0] * 0.35 + rng.range(-2.8, 2.8);
    const pz = terrain.summit[1] * 0.35 + rng.range(-2.8, 2.8);
    const pRad = rng.range(3.8, 4.8);
    plazas.push({ x: px, z: pz, radius: pRad });

    // 2. 4–5 gently meandering main avenues radiating out from the plaza & hugging terrain contours!
    const aveCount = rng.chance(0.55) ? 5 : 4;
    const baseAngle = rng.range(0, Math.PI * 2);
    const avenuePoints: Array<{ pt: V2; dir: number; streetIdx: number }> = [];

    for (let a = 0; a < aveCount; a++) {
      let ang = baseAngle + (a / aveCount) * Math.PI * 2 + rng.range(-0.22, 0.22);
      const pts: V2[] = [[px + Math.cos(ang) * (pRad - 0.6), pz + Math.sin(ang) * (pRad - 0.6)]];
      const stepLen = 5.2;
      let drift = rng.range(-0.11, 0.11);

      for (let s = 0; s < 9; s++) {
        const prev = pts[pts.length - 1];
        // Subtle terrain-contour gentle steering so avenues wind organically around hills
        const hL = terrain.heightAt(prev[0] + Math.cos(ang + 0.5) * 4, prev[1] + Math.sin(ang + 0.5) * 4);
        const hR = terrain.heightAt(prev[0] + Math.cos(ang - 0.5) * 4, prev[1] + Math.sin(ang - 0.5) * 4);
        const contourNudge = Math.max(-0.08, Math.min(0.08, (hR - hL) * 0.035));
        ang += drift + contourNudge + rng.range(-0.09, 0.09);
        drift *= 0.86;

        const next: V2 = [prev[0] + Math.cos(ang) * stepLen, prev[1] + Math.sin(ang) * stepLen];
        if (Math.hypot(next[0], next[1]) > R_MAX) {
          const rCur = Math.hypot(prev[0], prev[1]);
          const scale = Math.max(0.25, (R_MAX - rCur) / stepLen);
          pts.push([prev[0] + Math.cos(ang) * stepLen * scale, prev[1] + Math.sin(ang) * stepLen * scale]);
          break;
        }
        pts.push(next);
        if (s >= 1 && s <= 6) {
          avenuePoints.push({ pt: next, dir: ang, streetIdx: a });
        }
      }
      commitStreet(`ave_${a}`, 'avenue', 3.1, pts);
    }

    // 3. Branching organic secondary cross-streets & alleys terminating cleanly on intersections!
    let branchIdx = 0;
    for (const node of avenuePoints) {
      for (const side of [-1, 1]) {
        if (!rng.chance(0.68)) continue;
        let ang = node.dir + side * (Math.PI * 0.5 + rng.range(-0.26, 0.26));
        const pts: V2[] = [node.pt];
        const stepLen = 4.4;
        const maxSteps = rng.int(3, 6);
        let tooClose = false;

        // Don't sprout a branch almost on top of an existing street in the same direction
        const probe: V2 = [node.pt[0] + Math.cos(ang) * 3.8, node.pt[1] + Math.sin(ang) * 3.8];
        for (const seg of rawSegments) {
          if (seg.streetId === `ave_${node.streetIdx}`) continue;
          if (distPointToSeg(probe[0], probe[1], seg.a, seg.b) < 3.4) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        for (let st = 0; st < maxSteps; st++) {
          const prev = pts[pts.length - 1];
          ang += rng.range(-0.14, 0.14);
          let next: V2 = [prev[0] + Math.cos(ang) * stepLen, prev[1] + Math.sin(ang) * stepLen];
          if (Math.hypot(next[0], next[1]) > R_MAX - 1.5) break;

          // Stop cleanly at first intersection with any existing street (creates real T-junctions & blocks!)
          let hit: { t: number; pt: V2 } | null = null;
          for (const seg of rawSegments) {
            if (st === 0 && seg.streetId === `ave_${node.streetIdx}`) continue;
            const inter = segmentIntersection(prev, next, seg.a, seg.b);
            if (inter && (!hit || inter.t < hit.t)) {
              hit = { t: inter.t, pt: inter.pt };
            }
          }
          if (hit) {
            pts.push(hit.pt);
            break;
          }
          pts.push(next);
        }

        if (pts.length >= 2) {
          const isLane = rng.chance(0.32);
          commitStreet(`st_${branchIdx++}`, isLane ? 'lane' : 'street', isLane ? 1.75 : 2.25, pts);
        }
      }
    }
  } else if (style === 'grid') {
    // Warped European/San-Francisco grid with randomized block spacings + diagonal grand boulevard!
    const rot = rng.range(-0.42, 0.42);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const toWorld = (u: number, v: number): V2 => [u * c - v * s, u * s + v * c];

    const xs: number[] = [];
    let curX = -35;
    while (curX <= 35) {
      xs.push(curX);
      curX += rng.range(13.2, 16.5);
    }
    const zs: number[] = [];
    let curZ = -35;
    while (curZ <= 35) {
      zs.push(curZ);
      curZ += rng.range(13.0, 16.2);
    }

    // Slightly jitter each grid intersection organically so blocks feel historic rather than sterile
    const nodes: V2[][] = xs.map((ux, ix) =>
      zs.map((vz, iz) => {
        const jx = ix === 0 || ix === xs.length - 1 ? 0 : rng.range(-0.95, 0.95);
        const jz = iz === 0 || iz === zs.length - 1 ? 0 : rng.range(-0.95, 0.95);
        return toWorld(ux + jx, vz + jz);
      }),
    );

    const midI = Math.floor(xs.length / 2);
    const midJ = Math.floor(zs.length / 2);
    const pNode = nodes[midI]?.[midJ] ?? [0, 0];
    plazas.push({ x: pNode[0], z: pNode[1], radius: rng.range(3.6, 4.6) });

    let idx = 0;
    // Horizontal grid streets (prune occasional outer edge segments for organic boundary)
    for (let j = 0; j < zs.length; j++) {
      const isAve = j === midJ;
      let run: V2[] = [];
      for (let i = 0; i < xs.length; i++) {
        const pt = nodes[i][j];
        if (Math.hypot(pt[0], pt[1]) <= R_MAX + 2) {
          run.push(pt);
        } else if (run.length >= 2) {
          commitStreet(`gx_${idx++}`, isAve ? 'avenue' : 'street', isAve ? 3.1 : 2.25, run);
          run = [];
        } else {
          run = [];
        }
      }
      if (run.length >= 2) commitStreet(`gx_${idx++}`, isAve ? 'avenue' : 'street', isAve ? 3.1 : 2.25, run);
    }
    // Vertical grid streets
    for (let i = 0; i < xs.length; i++) {
      const isAve = i === midI;
      let run: V2[] = [];
      for (let j = 0; j < zs.length; j++) {
        const pt = nodes[i][j];
        if (Math.hypot(pt[0], pt[1]) <= R_MAX + 2) {
          run.push(pt);
        } else if (run.length >= 2) {
          commitStreet(`gz_${idx++}`, isAve ? 'avenue' : 'street', isAve ? 3.1 : 2.25, run);
          run = [];
        } else {
          run = [];
        }
      }
      if (run.length >= 2) commitStreet(`gz_${idx++}`, isAve ? 'avenue' : 'street', isAve ? 3.1 : 2.25, run);
    }

    // Dramatic diagonal Haussmann boulevard cutting across the central square!
    const diagAng = rot + Math.PI * 0.25 + rng.range(-0.18, 0.18);
    const diagPts: V2[] = [];
    for (let t = -32; t <= 32; t += 8) {
      const pt: V2 = [pNode[0] + Math.cos(diagAng) * t, pNode[1] + Math.sin(diagAng) * t];
      if (Math.hypot(pt[0], pt[1]) <= R_MAX) diagPts.push(pt);
    }
    if (diagPts.length >= 2) {
      commitStreet('diag_0', 'avenue', 3.2, diagPts);
    }
  } else {
    // Radial hilltop star-ring town (`radial`)
    const px = terrain.summit[0] * 0.45;
    const pz = terrain.summit[1] * 0.45;
    const pRad = rng.range(4.4, 5.4);
    plazas.push({ x: px, z: pz, radius: pRad });

    const spokes = rng.int(6, 7);
    const baseAng = rng.range(0, Math.PI * 2);
    const spokeAngles: number[] = [];
    for (let k = 0; k < spokes; k++) {
      spokeAngles.push(baseAng + (k / spokes) * Math.PI * 2 + rng.range(-0.14, 0.14));
    }

    // Concentric slightly elliptical ring roads
    const ringRadii = [rng.range(15.2, 17.4), rng.range(29.0, 31.8)];
    const ellipScale = rng.range(0.88, 1.12);
    const ellipRot = rng.range(0, Math.PI);
    const ec = Math.cos(ellipRot);
    const es = Math.sin(ellipRot);
    const ringPt = (rad: number, ang: number): V2 => {
      const lx = Math.cos(ang) * rad;
      const lz = Math.sin(ang) * rad * ellipScale;
      return [px + lx * ec - lz * es, pz + lx * es + lz * ec];
    };

    for (let rIdx = 0; rIdx < ringRadii.length; rIdx++) {
      const rad = ringRadii[rIdx];
      const pts: V2[] = [];
      const steps = 20;
      for (let i = 0; i <= steps; i++) {
        const pt = ringPt(rad, (i / steps) * Math.PI * 2);
        if (Math.hypot(pt[0], pt[1]) <= R_MAX + 1.5) pts.push(pt);
      }
      if (pts.length >= 3) {
        commitStreet(`ring_${rIdx}`, rIdx === 0 ? 'avenue' : 'street', rIdx === 0 ? 2.8 : 2.2, pts);
      }
    }

    // Radiating boulevards from central plaza out to rim
    for (let k = 0; k < spokeAngles.length; k++) {
      const ang = spokeAngles[k];
      const pts: V2[] = [];
      for (let r = pRad - 0.5; r <= R_MAX; r += 5.5) {
        const pt: V2 = [px + Math.cos(ang) * r, pz + Math.sin(ang) * r];
        if (Math.hypot(pt[0], pt[1]) > R_MAX) break;
        pts.push(pt);
      }
      if (pts.length >= 2) {
        commitStreet(`spoke_${k}`, k % 2 === 0 ? 'avenue' : 'street', k % 2 === 0 ? 3.0 : 2.25, pts);
      }
    }
  }

  return { streets, plazas, rawSegments };
}

/**
 * Generate a complete, zero-overlap, street-aligned architectural paper city layout with hills,
 * contours, randomized streets, plazas, single + wall-to-wall composite buildings, and origami trees.
 */
export function generateCityLayout(opts: CityBuildOptions): CityLayout {
  const seed = Math.max(0, Math.round(opts.seed));
  const style = opts.style;
  const hills = Math.max(0, Math.min(1, opts.hills));

  const terrain = createTerrainField(seed, hills);
  const { streets, plazas, rawSegments } = generateStreetNetwork(seed, style, terrain);
  const contours = extractContourSegments(terrain, 76, 56, 0.55);

  const rng = makeCityRng((seed * 2654435761 + (style === 'organic' ? 101 : style === 'grid' ? 211 : 307)) >>> 0);

  // Precompute inflated street collision rectangles for ultra-fast OBB clearance checks
  const roadBoxes: V2[][] = rawSegments.map((seg) => buildStreetRect(seg.a, seg.b, seg.width * 0.5 + 0.34, 0.2));

  // Build candidate street-frontage sites prioritized: avenues -> streets -> lanes
  interface FrontageCandidate {
    px: number;
    pz: number;
    nx: number;
    nz: number;
    roadHalfW: number;
    roadKind: CityStreet['kind'];
    distToSummit: number;
  }
  const candidates: FrontageCandidate[] = [];

  for (const st of streets) {
    // Accumulate arc length and sample frontage sites every ~3.4–4.6 units for rich continuous streetscapes
    let accum = rng.range(1.2, 2.4);
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
        if (Math.hypot(px, pz) <= 37.5) {
          for (const side of [-1, 1]) {
            candidates.push({
              px,
              pz,
              nx: -tz * side,
              nz: tx * side,
              roadHalfW: st.width * 0.5,
              roadKind: st.kind,
              distToSummit: Math.hypot(px - terrain.summit[0], pz - terrain.summit[1]),
            });
          }
        }
        cursor += rng.range(3.4, 4.6);
      }
      accum = cursor - len;
    }
  }

  // Sort avenues & hilltop sites earlier so landmark towers & wall-to-wall composite manors claim prime lots!
  candidates.sort((a, b) => {
    const ka = a.roadKind === 'avenue' ? 0 : a.roadKind === 'street' ? 1 : 2;
    const kb = b.roadKind === 'avenue' ? 0 : b.roadKind === 'street' ? 1 : 2;
    if (ka !== kb) return ka - kb;
    return a.distToSummit - b.distToSummit;
  });

  const plots: CityBuildingPlot[] = [];
  const placedPaddedOBBs: V2[][] = [];
  const MAX_PLOTS = 36;
  let rooftopCount = 0;

  const chooseMixForSite = (cand: FrontageCandidate, slotIdx: number): { gen: number; mixOpts: HouseMixOptions } => {
    const houseSeed = ((seed * 977 + slotIdx * 131 + 19) % 99989) + 1;
    const gen = (slotIdx % 14) + 1;
    const baseGrammar: HouseMixOptions = {
      seed: houseSeed,
      consistency: opts.consistency ?? null,
      windowStyle: opts.windowStyle ?? null,
      windowOpening: opts.windowOpening ?? null,
      windowDetail: opts.windowDetail ?? null,
    };

    const nearSummit = cand.distToSummit < 13;
    const r = rng.next();

    // Prime avenues get rich wall-to-wall 2- & 3-house composite rowhouses (~34%)!
    if (cand.roadKind === 'avenue' && r < 0.34) {
      const hCount: 2 | 3 = rng.chance(0.52) ? 3 : 2;
      return {
        gen,
        mixOpts: {
          ...baseGrammar,
          topology: 'village',
          houses: hCount,
        },
      };
    }

    // Hilltop / plaza crown sites favor landmark spires, setbacks, octagonal/hexagonal pavilions, and stepped gables!
    if (nearSummit && r < 0.56) {
      const landmarkChoice = rng.pick(['spire', 'setback', 'oct', 'mansard', 'stepped', 'hex', 'mansard'] as const);
      if (landmarkChoice === 'setback') return { gen: 4, mixOpts: { ...baseGrammar, topology: 'setback' } };
      if (landmarkChoice === 'oct') return { gen: 3, mixOpts: { ...baseGrammar, topology: 'oct' } };
      if (landmarkChoice === 'hex') return { gen: 7, mixOpts: { ...baseGrammar, topology: 'hex' } };
      if (landmarkChoice === 'stepped') {
        return { gen: 1, mixOpts: { ...baseGrammar, topology: 'ribbon', roofType: 'gable', gableProfile: 'stepped' } };
      }
      if (landmarkChoice === 'spire') {
        return { gen: 1, mixOpts: { ...baseGrammar, topology: 'ribbon', roofType: 'spire' } };
      }
      return { gen: 2, mixOpts: { ...baseGrammar, topology: 'ribbon', roofType: 'mansard' } };
    }

    // Secondary streets occasionally get 2-house twin composites or L-wings!
    if (cand.roadKind === 'street' && r < 0.18) {
      return {
        gen,
        mixOpts: {
          ...baseGrammar,
          topology: 'village',
          houses: 2,
        },
      };
    }
    if (r < 0.28) {
      return { gen: 5, mixOpts: { ...baseGrammar, topology: 'lwing' } };
    }

    // Diverse single architectural typologies across every street block
    const roofPool: RoofType[] = ['gable', 'gable', 'mansard', 'hip', 'shed', 'flat', 'butterfly', 'sawtooth'];
    const roofType = rng.pick(roofPool);
    const gableProfile =
      roofType === 'gable' ? rng.pick(['classic', 'gambrel', 'stepped', 'barrel', 'saltbox'] as const) : null;
    return {
      gen,
      mixOpts: {
        ...baseGrammar,
        topology: rng.chance(0.6) ? 'ribbon' : 'cross',
        roofType,
        gableProfile,
      },
    };
  };

  let attemptIdx = 0;
  const tryPlaceSpecAt = (
    cand: FrontageCandidate,
    gen: number,
    mixOpts: HouseMixOptions,
    rawSpec: HouseNetSpec,
  ): boolean => {
    const spec: HouseNetSpec = { ...rawSpec, yawOffset: 0 };
    const net = buildHouseNet(spec);

    // Compute exact folded 3D footprint extents from all `base` panels in `net` (world units!)
    let minBx = Infinity;
    let maxBx = -Infinity;
    let minBz = Infinity;
    let maxBz = -Infinity;
    for (const p of net.panels) {
      if (p.stage !== 'base') continue;
      for (const [px, py] of p.poly) {
        const wx = px * MM;
        const wz = -py * MM;
        if (wx < minBx) minBx = wx;
        if (wx > maxBx) maxBx = wx;
        if (wz < minBz) minBz = wz;
        if (wz > maxBz) maxBz = wz;
      }
    }
    if (!Number.isFinite(minBx)) return false;
    const fpW = maxBx - minBx;
    const fpD = maxBz - minBz;
    const halfW = fpW * 0.5;
    const halfD = fpD * 0.5;

    // Position building behind the curb so its street-facing front (`+Z`) aligns cleanly along the sidewalk!
    const sidewalk = rng.range(0.42, 0.78);
    const cx = cand.px + cand.nx * (cand.roadHalfW + sidewalk + halfD);
    const cz = cand.pz + cand.nz * (cand.roadHalfW + sidewalk + halfD);
    if (Math.hypot(cx, cz) + Math.hypot(halfW, halfD) > 40.0) return false;

    // Face local `+Z` directly toward the street (`-nx, -nz`)!
    const yaw = Math.atan2(-cand.nx, -cand.nz);
    const footprint = makeBuildingOBB(cx, cz, yaw, halfW, halfD);
    const paddedCheck = makeBuildingOBB(cx, cz, yaw, halfW + 0.34, halfD + 0.34);
    const roadCheck = makeBuildingOBB(cx, cz, yaw, halfW + 0.14, halfD + 0.14);

    // 1. Check plaza clearance
    for (const pl of plazas) {
      for (const [fx, fz] of paddedCheck) {
        if (Math.hypot(fx - pl.x, fz - pl.z) < pl.radius + 0.35) return false;
      }
      if (Math.hypot(cx - pl.x, cz - pl.z) < pl.radius + Math.max(halfW, halfD) * 0.62) return false;
    }

    // 2. Check zero overlap with ALL road segments
    for (const rBox of roadBoxes) {
      if (polygonsOverlap(roadCheck, rBox)) return false;
    }

    // 3. Check zero overlap with ALL already-placed buildings
    for (const other of placedPaddedOBBs) {
      if (polygonsOverlap(paddedCheck, other)) return false;
    }

    // 4. Sample terrain elevation under all 4 footprint corners + center for exact retaining-plinth grounding
    const ys = [terrain.heightAt(cx, cz), ...footprint.map(([fx, fz]) => terrain.heightAt(fx, fz))];
    const groundMinY = Math.min(...ys);
    const groundMaxY = Math.max(...ys);
    const baseY = groundMaxY + 0.06;

    const plotIndex = plots.length;
    const distFromCenter = Math.hypot(cx, cz);
    plots.push({
      id: `plot_${plotIndex}`,
      index: plotIndex,
      x: cx,
      z: cz,
      baseY,
      groundMinY,
      yaw,
      footprint,
      footprintW: fpW,
      footprintD: fpD,
      generation: gen,
      mixOpts,
      spec,
      foldOrder: Math.min(1, distFromCenter / 40),
    });
    placedPaddedOBBs.push(paddedCheck);
    rooftopCount += spec.topology === 'village' && spec.village ? spec.village.count : 1;
    return true;
  };

  for (const cand of candidates) {
    if (plots.length >= MAX_PLOTS) break;
    attemptIdx++;

    const { gen, mixOpts } = chooseMixForSite(cand, attemptIdx);
    const primarySpec = generateHouseSpec(gen, mixOpts);
    if (tryPlaceSpecAt(cand, gen, mixOpts, primarySpec)) continue;

    // Compact corner-lot fallback: if a wide composite or mansion clips a cross-street, try a sleek townhouse!
    const compactMix: HouseMixOptions = {
      seed: mixOpts.seed,
      topology: 'ribbon',
      roofType: rng.pick(['gable', 'gable', 'mansard', 'hip', 'flat', 'shed'] as const),
      gableProfile: rng.pick(['classic', 'gambrel', 'stepped', 'barrel', 'saltbox'] as const),
      consistency: opts.consistency ?? null,
      windowStyle: opts.windowStyle ?? null,
      windowOpening: opts.windowOpening ?? null,
      windowDetail: opts.windowDetail ?? null,
    };
    const compactRaw = generateHouseSpec(1, compactMix);
    const compactSpec: HouseNetSpec =
      compactRaw.roofType === 'spire'
        ? { ...compactRaw, W: 28, D: 28 }
        : { ...compactRaw, W: Math.min(compactRaw.W, 32), D: Math.min(compactRaw.D, 36) };
    tryPlaceSpecAt(cand, 1, compactMix, compactSpec);
  }

  // Scatter minimalist origami paper trees in plazas, pocket parks, and open hillside clearings!
  const trees: CityTree[] = [];
  const treeRng = makeCityRng((seed * 48271 + 911) >>> 0);
  const MAX_TREES = 46;
  for (let attempt = 0; attempt < 260 && trees.length < MAX_TREES; attempt++) {
    const r = Math.sqrt(treeRng.next()) * 33.5;
    const a = treeRng.range(0, Math.PI * 2);
    const tx = Math.cos(a) * r;
    const tz = Math.sin(a) * r;

    // Clear all roads
    let ok = true;
    for (const seg of rawSegments) {
      if (distPointToSeg(tx, tz, seg.a, seg.b) < seg.width * 0.5 + 0.85) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    // Clear all buildings
    const treeBox: V2[] = [
      [tx - 0.65, tz - 0.65],
      [tx + 0.65, tz - 0.65],
      [tx + 0.65, tz + 0.65],
      [tx - 0.65, tz + 0.65],
    ];
    for (const b of placedPaddedOBBs) {
      if (polygonsOverlap(treeBox, b)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    // Don't stack trees right on top of each other
    for (const other of trees) {
      if (Math.hypot(tx - other.x, tz - other.z) < 2.2) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    trees.push({
      x: tx,
      z: tz,
      y: terrain.heightAt(tx, tz),
      scale: treeRng.range(0.72, 1.32),
      rotY: treeRng.range(0, Math.PI * 2),
      variant: (attempt % 3) as 0 | 1 | 2,
    });
  }

  return {
    seed,
    style,
    hills,
    terrain,
    streets,
    plazas,
    plots,
    trees,
    contours,
    rooftopCount,
  };
}
