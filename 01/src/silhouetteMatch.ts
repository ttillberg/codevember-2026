import * as THREE from 'three';
import { MM, type BuiltHouseNet, type V2 } from './origamiHouseNet';
import { PAPER_THICK, type OrigamiHouseRig } from './origamiPaperMesh';

export interface SilhouetteCameraPose {
  yaw: number;
  pitch: number;
  roll: number;
  dist: number;
  lookX: number;
  lookY: number;
  lookZ: number;
}

export interface SilhouetteFitOptions {
  fovDeg: number;
  aspect: number;
  /** Allow searching full 360° yaw around `basePose.yaw` to line up net wings with the 3D silhouette */
  allowYawSearch: boolean;
  /** Optional bounded yaw search half-range in radians when `allowYawSearch` is false (default `0`) */
  maxYawDeltaRad?: number;
  /** Minimum camera distance multiplier relative to `basePose.dist` (smaller = larger flat net; default `0.58`) */
  minScale?: number;
  /** Maximum camera distance multiplier relative to `basePose.dist` (default `1.08`) */
  maxScale?: number;
  /** Max horizontal pan offset as a fraction of the net's half-size (default `0`) */
  maxLookShiftRatio?: number;
  /**
   * Accepted coverage ratio `[0, 1]` (default `1.0`).
   * When `< 1.0`, if `basePose` already meets or exceeds `targetCoverage`, `basePose` is returned
   * untouched; otherwise the solver prefers the minimal zoom/yaw adjustment needed to reach it.
   */
  targetCoverage?: number;
}

export interface SilhouetteFitResult extends SilhouetteCameraPose {
  /** Fraction `[0, 1]` of 3D house silhouette samples covered by actual flat paper panels (1.0 = zero outer cutout!) */
  coverage: number;
  /** Fraction `[0, 1]` of silhouette samples landing on foldable walls/roofs (not just static base) */
  foldableRatio: number;
  /** Baseline coverage at `basePose` before optimization */
  baselineCoverage: number;
}

interface FlatPanelXZ {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  poly: V2[];
  foldable: boolean;
  area: number;
  cx: number;
  cz: number;
}

function pointInPoly2D(px: number, py: number, poly: readonly V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonAreaAndCentroid(poly: readonly V2[]): { area: number; cx: number; cz: number } {
  let a2 = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const x0 = poly[j][0];
    const y0 = poly[j][1];
    const x1 = poly[i][0];
    const y1 = poly[i][1];
    const cross = x0 * y1 - x1 * y0;
    a2 += cross;
    cx += (x0 + x1) * cross;
    cz += (y0 + y1) * cross;
  }
  const area = Math.abs(a2) * 0.5;
  if (Math.abs(a2) < 1e-9) {
    let sx = 0;
    let sz = 0;
    for (const [x, z] of poly) {
      sx += x;
      sz += z;
    }
    return { area: 0, cx: sx / Math.max(1, poly.length), cz: sz / Math.max(1, poly.length) };
  }
  return { area, cx: cx / (3 * a2), cz: cz / (3 * a2) };
}

function extractFlatNetPanelsXZ(net: BuiltHouseNet): {
  panels: FlatPanelXZ[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centroidX: number;
  centroidZ: number;
} {
  const cy = Math.cos(net.spec.yawOffset);
  const sy = Math.sin(net.spec.yawOffset);
  const panels: FlatPanelXZ[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let totalArea = 0;
  let sumCx = 0;
  let sumCz = 0;

  for (const def of net.panels) {
    const poly: V2[] = [];
    let pMinX = Infinity;
    let pMaxX = -Infinity;
    let pMinZ = Infinity;
    let pMaxZ = -Infinity;
    for (const [pxMm, pyMm] of def.poly) {
      const ux = pxMm * MM;
      const uz = -pyMm * MM;
      const wx = ux * cy + uz * sy;
      const wz = -ux * sy + uz * cy;
      poly.push([wx, wz]);
      if (wx < pMinX) pMinX = wx;
      if (wx > pMaxX) pMaxX = wx;
      if (wz < pMinZ) pMinZ = wz;
      if (wz > pMaxZ) pMaxZ = wz;
    }
    if (pMinX < minX) minX = pMinX;
    if (pMaxX > maxX) maxX = pMaxX;
    if (pMinZ < minZ) minZ = pMinZ;
    if (pMaxZ > maxZ) maxZ = pMaxZ;

    const { area, cx, cz } = polygonAreaAndCentroid(poly);
    totalArea += area;
    sumCx += cx * area;
    sumCz += cz * area;
    panels.push({
      minX: pMinX,
      maxX: pMaxX,
      minZ: pMinZ,
      maxZ: pMaxZ,
      poly,
      foldable: def.parent !== null,
      area,
      cx,
      cz,
    });
  }

  const centroidX = totalArea > 1e-6 ? sumCx / totalArea : (minX + maxX) * 0.5;
  const centroidZ = totalArea > 1e-6 ? sumCz / totalArea : (minZ + maxZ) * 0.5;
  return { panels, minX, maxX, minZ, maxZ, centroidX, centroidZ };
}

function buildTempCamera(pose: SilhouetteCameraPose, fovDeg: number, aspect: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(fovDeg, Math.max(0.25, aspect), 0.3, 650);
  cam.up.set(0, 1, 0);
  cam.position.set(
    pose.lookX + pose.dist * Math.cos(pose.pitch) * Math.sin(pose.yaw),
    pose.lookY + pose.dist * Math.sin(pose.pitch),
    pose.lookZ + pose.dist * Math.cos(pose.pitch) * Math.cos(pose.yaw),
  );
  cam.lookAt(pose.lookX, pose.lookY, pose.lookZ);
  if (Math.abs(pose.roll) > 1e-5) cam.rotateZ(pose.roll);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

/**
 * Sample the exact 2D screen-space silhouette (`NDC` coordinates in `[-1, 1]^2`) of a live 3D
 * origami house rig as viewed from `cam`. Uses exact projected panel polygons so concave roofs,
 * L-wings, stepped towers, and multi-house villages are captured accurately in `< 0.2ms` without
 * any GPU readback stall.
 */
export function sampleFoldedHouseSilhouetteNDC(
  rig: OrigamiHouseRig,
  cam: THREE.PerspectiveCamera,
  gridRes = 15,
): V2[] {
  rig.root.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);

  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const v = new THREE.Vector3();
  const projectedPolys: Array<{ minX: number; maxX: number; minY: number; maxY: number; poly: V2[] }> = [];
  const boundarySamples: V2[] = [];

  let gMinX = Infinity;
  let gMaxX = -Infinity;
  let gMinY = Infinity;
  let gMaxY = -Infinity;

  const projectPanel = (defPoly: readonly V2[], hingeOrigin: V2, matrixWorld: THREE.Matrix4) => {
    const poly: V2[] = [];
    let pMinX = Infinity;
    let pMaxX = -Infinity;
    let pMinY = Infinity;
    let pMaxY = -Infinity;

    for (const [pxMm, pyMm] of defPoly) {
      v.set((pxMm - hingeOrigin[0]) * MM, 0, -(pyMm - hingeOrigin[1]) * MM);
      v.applyMatrix4(matrixWorld);
      v.applyMatrix4(vp);
      const nx = v.x;
      const ny = v.y;
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
      poly.push([nx, ny]);
      if (nx < pMinX) pMinX = nx;
      if (nx > pMaxX) pMaxX = nx;
      if (ny < pMinY) pMinY = ny;
      if (ny > pMaxY) pMaxY = ny;
    }

    if (poly.length < 3) return;
    if (pMinX < gMinX) gMinX = pMinX;
    if (pMaxX > gMaxX) gMaxX = pMaxX;
    if (pMinY < gMinY) gMinY = pMinY;
    if (pMaxY > gMaxY) gMaxY = pMaxY;

    projectedPolys.push({ minX: pMinX, maxX: pMaxX, minY: pMinY, maxY: pMaxY, poly });

    // Also include vertices so sharp roof ridges & corners are always represented
    for (const pt of poly) {
      if (Math.abs(pt[0]) <= 0.98 && Math.abs(pt[1]) <= 0.98) {
        boundarySamples.push(pt);
      }
    }
  };

  for (const def of rig.net.panels) {
    if (def.parent === null) {
      if (rig.baseMesh) {
        projectPanel(def.poly, def.hingeOrigin, rig.baseMesh.matrixWorld);
      }
      continue;
    }
    const pv = rig.panels.get(def.id);
    if (pv) {
      projectPanel(def.poly, def.hingeOrigin, pv.mesh.matrixWorld);
    }
  }

  if (projectedPolys.length === 0 || !Number.isFinite(gMinX)) return [];

  const samples: V2[] = [];
  const cMinX = Math.max(-0.98, gMinX);
  const cMaxX = Math.min(0.98, gMaxX);
  const cMinY = Math.max(-0.98, gMinY);
  const cMaxY = Math.min(0.98, gMaxY);
  const spanX = cMaxX - cMinX;
  const spanY = cMaxY - cMinY;

  if (spanX > 1e-4 && spanY > 1e-4) {
    for (let ix = 0; ix < gridRes; ix++) {
      const nx = cMinX + ((ix + 0.5) / gridRes) * spanX;
      for (let iy = 0; iy < gridRes; iy++) {
        const ny = cMinY + ((iy + 0.5) / gridRes) * spanY;
        for (const p of projectedPolys) {
          if (nx < p.minX || nx > p.maxX || ny < p.minY || ny > p.maxY) continue;
          if (pointInPoly2D(nx, ny, p.poly)) {
            samples.push([nx, ny]);
            break;
          }
        }
      }
    }
  }

  // Fallback / supplement with sparse corner points if silhouette is very thin
  if (samples.length < 16) {
    for (const pt of boundarySamples) samples.push(pt);
  }
  return samples;
}

/**
 * Unproject 2D NDC screen points through `cam` onto the horizontal paper plane `y = planeY`.
 * Returns `null` if rays are near-parallel to the plane or hit behind the camera.
 */
export function unprojectNdcToPlaneY(
  ndcPts: readonly V2[],
  cam: THREE.PerspectiveCamera,
  planeY = PAPER_THICK,
): V2[] | null {
  const origin = cam.position;
  const invVP = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
  const nearPt = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const out: V2[] = [];

  for (const [nx, ny] of ndcPts) {
    nearPt.set(nx, ny, -1).applyMatrix4(invVP);
    dir.subVectors(nearPt, origin);
    if (Math.abs(dir.y) < 1e-4) return null;
    const t = (planeY - origin.y) / dir.y;
    if (t <= 0.1 || t > 1400) return null;
    const wx = origin.x + dir.x * t;
    const wz = origin.z + dir.z * t;
    if (!Number.isFinite(wx) || !Number.isFinite(wz)) return null;
    out.push([wx, wz]);
  }
  return out;
}

/**
 * Optimize a flat-sheet viewing camera pose (`yaw, dist, lookX, lookY, lookZ`) so the flat paper
 * net `net` covers as much of the 3D house silhouette `silhouetteNdc` as possible — dramatically
 * minimizing outer paper cutout waste while keeping the camera zoom & pan tasteful and smooth.
 */
export function fitFlatNetToSilhouetteNDC(
  silhouetteNdc: readonly V2[],
  net: BuiltHouseNet,
  basePose: SilhouetteCameraPose,
  opts: SilhouetteFitOptions,
): SilhouetteFitResult {
  const fallback: SilhouetteFitResult = {
    ...basePose,
    coverage: 0,
    foldableRatio: 0,
    baselineCoverage: 0,
  };
  if (silhouetteNdc.length === 0) return fallback;

  // Grazing near-horizon pitches (< 10°) cannot cleanly cover a vertical 3D house on a flat XZ plane
  if (Math.abs(basePose.pitch) < 0.17) return fallback;

  const flat = extractFlatNetPanelsXZ(net);
  if (flat.panels.length === 0) return fallback;
  const sheetHalfWorld = Math.max(2, net.sheetHalfMm * MM);
  const planeY = basePose.pitch < 0 ? 0 : PAPER_THICK;

  const evalPoints = (ptsXZ: readonly V2[]): { coverage: number; foldableRatio: number } => {
    let hitAny = 0;
    let hitFoldable = 0;
    const n = ptsXZ.length;
    for (let i = 0; i < n; i++) {
      const px = ptsXZ[i][0];
      const pz = ptsXZ[i][1];
      if (px < flat.minX || px > flat.maxX || pz < flat.minZ || pz > flat.maxZ) continue;
      for (let p = 0; p < flat.panels.length; p++) {
        const pan = flat.panels[p];
        if (px < pan.minX || px > pan.maxX || pz < pan.minZ || pz > pan.maxZ) continue;
        if (pointInPoly2D(px, pz, pan.poly)) {
          hitAny++;
          if (pan.foldable) hitFoldable++;
          break;
        }
      }
    }
    return {
      coverage: hitAny / Math.max(1, n),
      foldableRatio: hitFoldable / Math.max(1, n),
    };
  };

  // Measure baseline coverage at the unoptimized `basePose`
  const baseCam = buildTempCamera(basePose, opts.fovDeg, opts.aspect);
  const baseFootprint = unprojectNdcToPlaneY(silhouetteNdc, baseCam, planeY);
  const baseEval = baseFootprint ? evalPoints(baseFootprint) : { coverage: 0, foldableRatio: 0 };
  const baselineCoverage = baseEval.coverage;
  const targetCoverage = Math.max(0.1, Math.min(1.0, opts.targetCoverage ?? 1.0));

  // If natural pose already meets the accepted coverage threshold (e.g. 75% in Forward mode), keep it untouched!
  if (targetCoverage < 0.999 && baselineCoverage >= targetCoverage) {
    return {
      ...basePose,
      coverage: baselineCoverage,
      foldableRatio: baseEval.foldableRatio,
      baselineCoverage,
    };
  }

  // Canonical unprojection at `yaw = 0`, `look = (0, planeY, 0)`, `dist = basePose.dist`:
  // Changing `(yaw, scale, lx, lz)` is an EXACT 2D rotation + uniform scale + translation on `y = planeY`!
  const canonPose: SilhouetteCameraPose = {
    yaw: 0,
    pitch: basePose.pitch,
    roll: basePose.roll,
    dist: basePose.dist,
    lookX: 0,
    lookY: planeY,
    lookZ: 0,
  };
  const canonCam = buildTempCamera(canonPose, opts.fovDeg, opts.aspect);
  const f0 = unprojectNdcToPlaneY(silhouetteNdc, canonCam, planeY);
  if (!f0) {
    return { ...fallback, coverage: baselineCoverage, baselineCoverage };
  }

  // Precompute canonical footprint centroid
  let f0Cx = 0;
  let f0Cz = 0;
  for (const [x, z] of f0) {
    f0Cx += x;
    f0Cz += z;
  }
  f0Cx /= f0.length;
  f0Cz /= f0.length;

  const minScale = opts.minScale ?? 0.54;
  const maxScale = opts.maxScale ?? 1.08;
  const maxShift = sheetHalfWorld * (opts.maxLookShiftRatio ?? 0);

  // When horizontal shift is enabled, try smart net anchors; when 0, stay dead-center on (0, 0) with zero sideways drift!
  const anchors: V2[] = [];
  if (maxShift > 1e-4) {
    const netBboxCx = (flat.minX + flat.maxX) * 0.5;
    const netBboxCz = (flat.minZ + flat.maxZ) * 0.5;
    const sortedFoldables = flat.panels.filter((p) => p.foldable).sort((a, b) => b.area - a.area);
    anchors.push([flat.centroidX, flat.centroidZ], [netBboxCx, netBboxCz], [0, 0]);
    if (sortedFoldables[0]) {
      anchors.push([
        (flat.centroidX + sortedFoldables[0].cx) * 0.5,
        (flat.centroidZ + sortedFoldables[0].cz) * 0.5,
      ]);
    }
    if (sortedFoldables[1]) {
      anchors.push([
        (flat.centroidX + sortedFoldables[1].cx) * 0.5,
        (flat.centroidZ + sortedFoldables[1].cz) * 0.5,
      ]);
    }
  } else {
    anchors.push([0, 0]);
  }

  const evalCandidate = (
    yaw: number,
    scale: number,
    lx: number,
    lz: number,
  ): { score: number; coverage: number; foldableRatio: number } => {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    let hitAny = 0;
    let hitFoldable = 0;
    const n = f0.length;

    for (let i = 0; i < n; i++) {
      const x0 = f0[i][0];
      const z0 = f0[i][1];
      const px = lx + scale * (x0 * cy + z0 * sy);
      const pz = lz + scale * (-x0 * sy + z0 * cy);
      if (px < flat.minX || px > flat.maxX || pz < flat.minZ || pz > flat.maxZ) continue;
      for (let p = 0; p < flat.panels.length; p++) {
        const pan = flat.panels[p];
        if (px < pan.minX || px > pan.maxX || pz < pan.minZ || pz > pan.maxZ) continue;
        if (pointInPoly2D(px, pz, pan.poly)) {
          hitAny++;
          if (pan.foldable) hitFoldable++;
          break;
        }
      }
    }

    const coverage = hitAny / n;
    const foldableRatio = hitFoldable / n;
    const isThresholdMode = targetCoverage < 0.999;
    const cappedCov = isThresholdMode ? Math.min(coverage, targetCoverage) : coverage;
    const bonusCov = isThresholdMode ? coverage * 5 : 0;
    // In accepted-ratio mode (e.g. 75% forward), strongly prefer minimal zoom away from 1.0;
    // in 100% mode (reverse), push all the way to full coverage while gently avoiding needless over-zoom.
    const zoomCost = isThresholdMode
      ? Math.abs(1.0 - scale) * 28
      : scale < 0.86
        ? (0.86 - scale) * 12
        : (scale - 1.0) * 6;
    const shiftCost = (Math.hypot(lx, lz) / sheetHalfWorld) * 5.5;
    const score = cappedCov * 100 + bonusCov + foldableRatio * (isThresholdMode ? 6 : 10) - zoomCost - shiftCost;
    return { score, coverage, foldableRatio };
  };

  const clampShift = (lx: number, lz: number): V2 => {
    if (maxShift <= 1e-4) return [0, 0];
    const d = Math.hypot(lx, lz);
    if (d <= maxShift || d < 1e-6) return [lx, lz];
    const k = maxShift / d;
    return [lx * k, lz * k];
  };

  // Build candidate yaw list
  const yawCandidates: number[] = [];
  if (opts.allowYawSearch) {
    const steps = 36;
    for (let i = 0; i < steps; i++) {
      yawCandidates.push(basePose.yaw + (i / steps) * Math.PI * 2);
    }
  } else if (opts.maxYawDeltaRad && opts.maxYawDeltaRad > 0.01) {
    const steps = 9;
    for (let i = 0; i < steps; i++) {
      const frac = -1 + (2 * i) / (steps - 1);
      yawCandidates.push(basePose.yaw + frac * opts.maxYawDeltaRad);
    }
  } else {
    yawCandidates.push(basePose.yaw);
  }

  const scaleCandidates = [1.02, 0.90, 0.78, 0.68, minScale].filter(
    (s, idx, arr) => s >= minScale - 1e-4 && s <= maxScale + 1e-4 && arr.indexOf(s) === idx,
  );

  let bestYaw = basePose.yaw;
  let bestScale = 1;
  let bestLx = 0;
  let bestLz = 0;
  let bestScore = -Infinity;
  let bestCoverage = baselineCoverage;
  let bestFoldable = 0;

  for (const yaw of yawCandidates) {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const rotCx = f0Cx * cy + f0Cz * sy;
    const rotCz = -f0Cx * sy + f0Cz * cy;

    for (const scale of scaleCandidates) {
      for (const [ax, az] of anchors) {
        const [lx, lz] = clampShift(ax - scale * rotCx, az - scale * rotCz);
        const res = evalCandidate(yaw, scale, lx, lz);
        if (res.score > bestScore) {
          bestScore = res.score;
          bestYaw = yaw;
          bestScale = scale;
          bestLx = lx;
          bestLz = lz;
          bestCoverage = res.coverage;
          bestFoldable = res.foldableRatio;
        }
      }
    }
  }

  // Fast coordinate-descent polish around the winning pose
  const yawSteps = opts.allowYawSearch ? [0.08, 0.03] : opts.maxYawDeltaRad ? [0.04] : [];
  for (const step of yawSteps) {
    for (const dir of [-1, 1]) {
      const candYaw = bestYaw + dir * step;
      const res = evalCandidate(candYaw, bestScale, bestLx, bestLz);
      if (res.score > bestScore) {
        bestScore = res.score;
        bestYaw = candYaw;
        bestCoverage = res.coverage;
        bestFoldable = res.foldableRatio;
      }
    }
  }

  if (maxShift > 1e-4) {
    for (const step of [sheetHalfWorld * 0.14, sheetHalfWorld * 0.05]) {
      for (const [dx, dz] of [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
        [step * 0.7, step * 0.7],
        [-step * 0.7, step * 0.7],
        [step * 0.7, -step * 0.7],
        [-step * 0.7, -step * 0.7],
      ] as V2[]) {
        const [lx, lz] = clampShift(bestLx + dx, bestLz + dz);
        const res = evalCandidate(bestYaw, bestScale, lx, lz);
        if (res.score > bestScore) {
          bestScore = res.score;
          bestLx = lx;
          bestLz = lz;
          bestCoverage = res.coverage;
          bestFoldable = res.foldableRatio;
        }
      }
    }
  }

  for (const step of [0.05, 0.02]) {
    for (const dir of [-1, 1]) {
      const candScale = Math.max(minScale, Math.min(maxScale, bestScale + dir * step));
      const res = evalCandidate(bestYaw, candScale, bestLx, bestLz);
      if (res.score > bestScore) {
        bestScore = res.score;
        bestScale = candScale;
        bestCoverage = res.coverage;
        bestFoldable = res.foldableRatio;
      }
    }
  }

  // Wrap yaw delta cleanly to [-PI, PI] relative to basePose.yaw so orbital animations stay shortest-path
  let dYaw = (bestYaw - basePose.yaw) % (Math.PI * 2);
  if (dYaw > Math.PI) dYaw -= Math.PI * 2;
  if (dYaw < -Math.PI) dYaw += Math.PI * 2;
  const finalYaw = basePose.yaw + dYaw;

  return {
    yaw: finalYaw,
    pitch: basePose.pitch,
    roll: basePose.roll,
    dist: basePose.dist * bestScale,
    lookX: bestLx,
    lookY: planeY,
    lookZ: bestLz,
    coverage: bestCoverage,
    foldableRatio: bestFoldable,
    baselineCoverage,
  };
}
