/**
 * Parameterized, strictly monotonic paper-fold easing envelope for Auto Fold:
 *   - `speed` (`0.25..3.0`): overall speed multiplier
 *   - `inPct` (`0..100`): ease-in ramp weight at the start (`u -> 0`)
 *   - `outPct` (`0..100`): ease-out deceleration tail at the end (`u -> 1`)
 *   - `curvePct` (`0..100`): curve steepness (`0` = linear, `50` = smooth cubic-bezier, `100` = crisp S-curve)
 *   - `handoffPct` (`35..140`): when the next house starts folding relative to the current house's fold
 *
 * Supports independent curves for alternating folds (`Fold 1` = odd layers, `Fold 2` = even layers)!
 */

export interface FoldCurveShape {
  /** Ease-in strength percentage (`0..100`) */
  inPct: number;
  /** Ease-out strength percentage (`0..100`) */
  outPct: number;
  /** Curve steepness percentage (`0..100`) */
  curvePct: number;
}

export interface AutoFoldCurveParams extends FoldCurveShape {
  /** Overall auto-fold speed multiplier (`0.25..3.0`, default `1.0`) */
  speed: number;
  /** Next-fold trigger timing as % of House 1's fold duration (`35..140`, default `60`) */
  handoffPct: number;
}

export const DEFAULT_AUTO_FOLD_CURVE: Readonly<AutoFoldCurveParams> = {
  speed: 1.0,
  inPct: 40,
  outPct: 40,
  curvePct: 75,
  handoffPct: 60,
};

export const DEFAULT_NEXT_FOLD_CURVE: Readonly<FoldCurveShape> = {
  inPct: 40,
  outPct: 40,
  curvePct: 75,
};

export const DUAL_CURVE_MAX_T = 2.4;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Evaluate exact 1D cubic Bézier `y(t)` at `x(t) = u` for control points `(0,0), (x1,y1), (x2,y2), (1,1)` */
export function evaluateCubicBezier(u: number, x1: number, y1: number, x2: number, y2: number): number {
  const x = clamp01(u);
  if (x <= 0 || x >= 1) return x;
  if (Math.abs(x1 - y1) < 1e-6 && Math.abs(x2 - y2) < 1e-6) return x;

  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;

  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;

  let t = x;
  for (let i = 0; i < 6; i++) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-6) break;
    const dx = sampleDX(t);
    if (Math.abs(dx) < 1e-6) break;
    const next = t - err / dx;
    if (next < 0 || next > 1) break;
    t = next;
  }

  if (Math.abs(sampleX(t) - x) > 1e-5) {
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 16; i++) {
      const mid = 0.5 * (lo + hi);
      if (sampleX(mid) < x) lo = mid;
      else hi = mid;
      t = mid;
    }
  }

  return clamp01(sampleY(t));
}

/**
 * Evaluate the continuous `[0, 1] -> [0, 1]` auto-fold motion envelope.
 * Guaranteed exact endpoints (`0 -> 0`, `1 -> 1`) and strict monotonicity across all parameter combinations.
 */
export function evaluateFoldCurve(u: number, inPct: number, outPct: number, curvePct: number): number {
  const x = clamp01(u);
  if (x <= 0 || x >= 1) return x;

  const inAmt = clamp01(inPct / 100);
  const outAmt = clamp01(outPct / 100);
  const c01 = clamp01(curvePct / 100);

  if (c01 <= 1e-4 || (inAmt <= 1e-4 && outAmt <= 1e-4)) {
    return x;
  }

  const x1 = inAmt * 0.96;
  const x2 = 1 - outAmt * 0.96;

  if (c01 <= 0.5) {
    const s = c01 * 2;
    const y1 = x1 * (1 - s);
    const y2 = x2 + (1 - x2) * s;
    return evaluateCubicBezier(x, x1, y1, x2, y2);
  }

  const extra = (c01 - 0.5) * 2;
  const first = evaluateCubicBezier(x, x1, 0, x2, 1);
  const second = evaluateCubicBezier(first, x1, 0, x2, 1);
  return first + (second - first) * extra;
}

/** Build an SVG path string (`M ... L ...`) previewing a single fold curve shifted by `startT` on a `[0..maxT]` timeline */
export function buildFoldCurveSvgPath(
  inPct: number,
  outPct: number,
  curvePct: number,
  width = 220,
  height = 58,
  padX = 8,
  padY = 7,
  samples = 36,
  startT = 0,
  maxT = 1,
): string {
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const denom = Math.max(0.1, maxT);
  let d = '';
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const y = evaluateFoldCurve(u, inPct, outPct, curvePct);
    const sx = padX + ((startT + u) / denom) * innerW;
    const sy = padY + (1 - y) * innerH;
    d += `${i === 0 ? 'M' : 'L'}${sx.toFixed(2)} ${sy.toFixed(2)}`;
  }
  return d;
}

/** Build Fold 1 + Fold 2 independent curve SVG geometry on a fixed `[0..2.4]` timeline */
export function buildDualFoldCurveSvg(
  curve1: FoldCurveShape,
  curve2: FoldCurveShape,
  handoffPct: number,
  width = 220,
  height = 58,
  padX = 8,
  padY = 7,
): {
  path1: string;
  path2: string;
  handoffX: number;
  end1X: number;
  overlapX: number;
  overlapW: number;
} {
  const innerW = width - padX * 2;
  const handoffT = Math.max(0.35, Math.min(1.4, handoffPct / 100));
  const tToX = (t: number) => padX + (t / DUAL_CURVE_MAX_T) * innerW;
  const path1 = buildFoldCurveSvgPath(
    curve1.inPct,
    curve1.outPct,
    curve1.curvePct,
    width,
    height,
    padX,
    padY,
    32,
    0,
    DUAL_CURVE_MAX_T,
  );
  const path2 = buildFoldCurveSvgPath(
    curve2.inPct,
    curve2.outPct,
    curve2.curvePct,
    width,
    height,
    padX,
    padY,
    32,
    handoffT,
    DUAL_CURVE_MAX_T,
  );
  const handoffX = tToX(handoffT);
  const end1X = tToX(1.0);
  const overlapX = handoffT < 1.0 ? handoffX : end1X;
  const overlapW = handoffT < 1.0 ? Math.max(0, end1X - handoffX) : 0;
  return { path1, path2, handoffX, end1X, overlapX, overlapW };
}
