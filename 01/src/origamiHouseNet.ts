/**
 * Pure geometry of the simplest cut-and-fold 3D gabled house inside a 150 × 150 mm square of origami paper.
 *
 * Exact silver-ratio (1 : √2) tiling with zero overlap and 4 clean symmetric corner off-cuts:
 *   - Square sheet: [-75, +75] × [-75, +75] mm (22,500 mm²)
 *   - Central floor (`base`): W = 42 mm × D = 42√2 ≈ 59.40 mm
 *   - 4 walls hinged on the 4 floor edges (fold 90° up): H = 75 - 21 - 21√2 ≈ 24.30 mm
 *   - Front & back walls carry exact 45° gable triangles (R = 21 mm) whose peaks touch y = ±75 mm!
 *   - Left & right walls carry exact 45° roof slopes (L = 21√2 ≈ 29.70 mm) whose ridge edges touch x = ±75 mm!
 *   - The remaining 4 corners are 4 identical symmetric L-notched scraps, each freed by a single 3-segment cut!
 */

export type V2 = [number, number];

export const SQUARE_MM = 150;
export const HALF_S = SQUARE_MM * 0.5; // 75 mm
export const MM = 0.1; // World scale: 1 mm = 0.1 Three.js units (15 × 15 unit origami square)

export const HOUSE_W = 42;
export const HALF_W = HOUSE_W * 0.5; // 21 mm
export const ROOF_R = HALF_W; // 21 mm -> exact 45° gable & roof pitch!
export const ROOF_L = HALF_W * Math.SQRT2; // 29.6984848... mm
export const HALF_D = ROOF_L; // 29.6984848... mm
export const HOUSE_D = HALF_D * 2; // 59.3969696... mm (exact W * √2!)
export const WALL_H = HALF_S - HALF_W - ROOF_L; // 24.3015151... mm

export type HousePanelId = 'base' | 'front' | 'back' | 'left' | 'right' | 'roofL' | 'roofR';
export type FoldablePanelId = Exclude<HousePanelId, 'base'>;
export type CornerId = 'tl' | 'tr' | 'br' | 'bl';

export interface PanelDef {
  id: HousePanelId;
  parent: HousePanelId | null;
  /** Counter-clockwise polygon in sheet space (mm, origin at square center, +y up) */
  poly: V2[];
  /** Target fold angle in radians when completely folded (positive magnitude) */
  targetAngle: number;
  /** Which corner cuts must be completed before this panel is completely free to fold */
  requiredCuts: CornerId[];
  /** Human label for crisp minimal UI feedback */
  label: string;
}

export interface CornerScrapDef {
  id: CornerId;
  label: string;
  /** Counter-clockwise polygon in sheet space (mm) */
  poly: V2[];
  /** Ordered 3-segment cut path in sheet space (mm), starting on left/right square edge and ending at gable peak */
  cutPath: V2[];
  /** Outward glide direction in sheet space (mm unit vector) when detached */
  escapeDir: V2;
  /** Total length of cutPath in mm */
  cutLength: number;
}

export const FOLDABLE_ORDER: FoldablePanelId[] = ['front', 'back', 'left', 'right', 'roofL', 'roofR'];
export const CORNER_ORDER: CornerId[] = ['tl', 'tr', 'br', 'bl'];

const yEave = HALF_D + WALL_H; // 54.0 mm exact!
const xEave = HALF_W + WALL_H; // 45.3015... mm

export const HOUSE_PANELS: Record<HousePanelId, PanelDef> = {
  base: {
    id: 'base',
    parent: null,
    poly: [
      [-HALF_W, -HALF_D],
      [HALF_W, -HALF_D],
      [HALF_W, HALF_D],
      [-HALF_W, HALF_D],
    ],
    targetAngle: 0,
    requiredCuts: [],
    label: 'Floor',
  },
  // Front wall + gable extends along sheet -y (world +Z, facing viewer!)
  front: {
    id: 'front',
    parent: 'base',
    poly: [
      [-HALF_W, -HALF_D],
      [-HALF_W, -yEave],
      [0, -HALF_S],
      [HALF_W, -yEave],
      [HALF_W, -HALF_D],
    ],
    targetAngle: Math.PI * 0.5,
    requiredCuts: ['bl', 'br'],
    label: 'Front gable',
  },
  // Back wall + gable extends along sheet +y (world -Z)
  back: {
    id: 'back',
    parent: 'base',
    poly: [
      [-HALF_W, HALF_D],
      [HALF_W, HALF_D],
      [HALF_W, yEave],
      [0, HALF_S],
      [-HALF_W, yEave],
    ],
    targetAngle: Math.PI * 0.5,
    requiredCuts: ['tl', 'tr'],
    label: 'Back gable',
  },
  // Left wall extends along sheet -x (world -X)
  left: {
    id: 'left',
    parent: 'base',
    poly: [
      [-xEave, -HALF_D],
      [-HALF_W, -HALF_D],
      [-HALF_W, HALF_D],
      [-xEave, HALF_D],
    ],
    targetAngle: Math.PI * 0.5,
    requiredCuts: ['tl', 'bl'],
    label: 'Left wall',
  },
  // Right wall extends along sheet +x (world +X)
  right: {
    id: 'right',
    parent: 'base',
    poly: [
      [HALF_W, -HALF_D],
      [xEave, -HALF_D],
      [xEave, HALF_D],
      [HALF_W, HALF_D],
    ],
    targetAngle: Math.PI * 0.5,
    requiredCuts: ['tr', 'br'],
    label: 'Right wall',
  },
  // Left roof slope extends from left wall eave out to left edge of square (x = -75)
  roofL: {
    id: 'roofL',
    parent: 'left',
    poly: [
      [-HALF_S, -HALF_D],
      [-xEave, -HALF_D],
      [-xEave, HALF_D],
      [-HALF_S, HALF_D],
    ],
    targetAngle: Math.PI * 0.25, // 45° exact inward pitch!
    requiredCuts: ['tl', 'bl'],
    label: 'Left roof',
  },
  // Right roof slope extends from right wall eave out to right edge of square (x = +75)
  roofR: {
    id: 'roofR',
    parent: 'right',
    poly: [
      [xEave, -HALF_D],
      [HALF_S, -HALF_D],
      [HALF_S, HALF_D],
      [xEave, HALF_D],
    ],
    targetAngle: Math.PI * 0.25, // 45° exact inward pitch!
    requiredCuts: ['tr', 'br'],
    label: 'Right roof',
  },
};

function polylineLength(pts: V2[]): number {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  return len;
}

function makeCorner(
  id: CornerId,
  label: string,
  sx: 1 | -1,
  sy: 1 | -1,
): CornerScrapDef {
  // Cut path runs from the left/right square edge inward along the roof+wall edge, turns out along the gable wall,
  // and finishes diagonally at the gable peak on the top/bottom square edge!
  const cutPath: V2[] = [
    [sx * HALF_S, sy * HALF_D],
    [sx * HALF_W, sy * HALF_D],
    [sx * HALF_W, sy * yEave],
    [0, sy * HALF_S],
  ];

  // Outer square corner vertices close the scrap polygon cleanly
  const rawPoly: V2[] = [
    ...cutPath,
    [sx * HALF_S, sy * HALF_S],
  ];

  // Ensure counter-clockwise winding
  const poly = signedArea(rawPoly) < 0 ? [...rawPoly].reverse() : rawPoly;
  const invLen = Math.SQRT1_2;
  return {
    id,
    label,
    poly,
    cutPath,
    escapeDir: [sx * invLen, sy * invLen],
    cutLength: polylineLength(cutPath),
  };
}

export const CORNER_SCRAPS: Record<CornerId, CornerScrapDef> = {
  tl: makeCorner('tl', 'Top-left corner', -1, 1),
  tr: makeCorner('tr', 'Top-right corner', 1, 1),
  br: makeCorner('br', 'Bottom-right corner', 1, -1),
  bl: makeCorner('bl', 'Bottom-left corner', -1, -1),
};

export function signedArea(poly: V2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a * 0.5;
}

export function pointInPoly(p: V2, poly: V2[]): boolean {
  let inside = false;
  const [px, py] = p;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const hit = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/**
 * Project a 2D sheet point onto a cut polyline.
 * Returns minimum perpendicular distance (mm) and normalized arc-length progress `u ∈ [0, 1]`.
 */
export function projectOntoPolyline(p: V2, path: V2[]): { dist: number; u: number; point: V2 } {
  const total = polylineLength(path);
  let bestDist = Infinity;
  let bestArc = 0;
  let bestPt: V2 = path[0];
  let acc = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const segLen = Math.hypot(dx, dy);
    const t =
      segLen > 1e-9
        ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (segLen * segLen)))
        : 0;
    const qx = a[0] + dx * t;
    const qy = a[1] + dy * t;
    const d = Math.hypot(p[0] - qx, p[1] - qy);
    if (d < bestDist) {
      bestDist = d;
      bestArc = acc + segLen * t;
      bestPt = [qx, qy];
    }
    acc += segLen;
  }

  return { dist: bestDist, u: total > 0 ? bestArc / total : 0, point: bestPt };
}

/** Sample a sub-polyline from normalized arc-length `u0` to `u1` (`0..1`) */
export function slicePolyline(path: V2[], u0: number, u1: number): V2[] {
  const total = polylineLength(path);
  const startD = Math.max(0, Math.min(1, u0)) * total;
  const endD = Math.max(0, Math.min(1, u1)) * total;
  if (endD <= startD + 1e-6) return [];

  const out: V2[] = [];
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const segEnd = acc + segLen;

    if (segEnd >= startD && acc <= endD && segLen > 1e-9) {
      const t0 = Math.max(0, (startD - acc) / segLen);
      const t1 = Math.min(1, (endD - acc) / segLen);
      const p0: V2 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const p1: V2 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      if (out.length === 0) out.push(p0);
      out.push(p1);
    }
    acc = segEnd;
  }
  return out;
}

/** Evaluate exact 3D world-mm coordinates of key ridge/corner points at fold progress [0..1] for mathematical verification */
export function evaluateFoldedRidgeEndpoints(fold: number): {
  leftRidgeFront: [number, number, number];
  rightRidgeFront: [number, number, number];
  frontGablePeak: [number, number, number];
  backGablePeak: [number, number, number];
} {
  const f = Math.max(0, Math.min(1, fold));
  const wallAng = f * Math.PI * 0.5;
  const roofAng = f * Math.PI * 0.25;

  // Front gable peak starts at (0, 0, +HALF_S), hinged at (0, 0, +HALF_D), rotating around +X by -wallAng
  const dzFront = HALF_S - HALF_D; // WALL_H + ROOF_R
  const frontGablePeak: [number, number, number] = [
    0,
    dzFront * Math.sin(wallAng),
    HALF_D + dzFront * Math.cos(wallAng),
  ];
  const backGablePeak: [number, number, number] = [
    0,
    dzFront * Math.sin(wallAng),
    -(HALF_D + dzFront * Math.cos(wallAng)),
  ];

  // Left wall hinged at (-HALF_W, 0, z), rotating around +Z by -wallAng; roofL hinged at local (-WALL_H, 0, z), total angle -(wallAng + roofAng)
  const leftEaveX = -HALF_W - WALL_H * Math.cos(wallAng);
  const leftEaveY = WALL_H * Math.sin(wallAng);
  const leftTotal = wallAng + roofAng;
  const leftRidgeFront: [number, number, number] = [
    leftEaveX - ROOF_L * Math.cos(leftTotal),
    leftEaveY + ROOF_L * Math.sin(leftTotal),
    HALF_D,
  ];

  const rightEaveX = HALF_W + WALL_H * Math.cos(wallAng);
  const rightEaveY = WALL_H * Math.sin(wallAng);
  const rightRidgeFront: [number, number, number] = [
    rightEaveX + ROOF_L * Math.cos(leftTotal),
    rightEaveY + ROOF_L * Math.sin(leftTotal),
    HALF_D,
  ];

  return { leftRidgeFront, rightRidgeFront, frontGablePeak, backGablePeak };
}
