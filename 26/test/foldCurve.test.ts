import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_FOLD_CURVE,
  buildDualFoldCurveSvg,
  buildFoldCurveSvgPath,
  evaluateFoldCurve,
} from '../src/foldCurve';

describe('Auto-fold easing curve (`evaluateFoldCurve`)', () => {
  it('preserves exact endpoints and strict monotonicity across the full (in%, out%, curve%) grid', () => {
    const steps = [0, 25, 50, 75, 100];
    for (const inPct of steps) {
      for (const outPct of steps) {
        for (const curvePct of steps) {
          expect(evaluateFoldCurve(0, inPct, outPct, curvePct)).toBe(0);
          expect(evaluateFoldCurve(1, inPct, outPct, curvePct)).toBe(1);
          let prev = 0;
          for (let i = 1; i <= 40; i++) {
            const u = i / 40;
            const y = evaluateFoldCurve(u, inPct, outPct, curvePct);
            expect(y).toBeGreaterThanOrEqual(prev - 1e-6);
            expect(y).toBeLessThanOrEqual(1 + 1e-6);
            prev = y;
          }
        }
      }
    }
  });

  it('reduces cleanly to pure linear motion when curve is 0% or both in/out are 0%', () => {
    for (const u of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(evaluateFoldCurve(u, 60, 80, 0)).toBeCloseTo(u, 5);
      expect(evaluateFoldCurve(u, 0, 0, 85)).toBeCloseTo(u, 5);
    }
  });

  it('shapes start ramp via % in, end deceleration via % out, and steepness via curve%', () => {
    const lowInEarly = evaluateFoldCurve(0.2, 5, 50, 60);
    const highInEarly = evaluateFoldCurve(0.2, 90, 50, 60);
    expect(highInEarly).toBeLessThan(lowInEarly - 0.12);

    const lowOutLate = evaluateFoldCurve(0.8, 40, 5, 60);
    const highOutLate = evaluateFoldCurve(0.8, 40, 90, 60);
    expect(highOutLate).toBeGreaterThan(lowOutLate + 0.12);

    const slopeAt = (c: number) =>
      evaluateFoldCurve(0.55, 50, 50, c) - evaluateFoldCurve(0.45, 50, 50, c);
    expect(slopeAt(50)).toBeGreaterThan(slopeAt(0) * 1.25);
    expect(slopeAt(100)).toBeGreaterThan(slopeAt(50) * 1.2);
  });

  it('produces a symmetrical S-curve default and dual-curve handoff overlap SVG geometry', () => {
    // Symmetric default S-curve: f(0.5) ≈ 0.5 and f(u) + f(1-u) ≈ 1
    expect(
      evaluateFoldCurve(
        0.5,
        DEFAULT_AUTO_FOLD_CURVE.inPct,
        DEFAULT_AUTO_FOLD_CURVE.outPct,
        DEFAULT_AUTO_FOLD_CURVE.curvePct,
      ),
    ).toBeCloseTo(0.5, 4);

    const single = buildFoldCurveSvgPath(
      DEFAULT_AUTO_FOLD_CURVE.inPct,
      DEFAULT_AUTO_FOLD_CURVE.outPct,
      DEFAULT_AUTO_FOLD_CURVE.curvePct,
    );
    expect(single.startsWith('M')).toBe(true);

    const overlap = buildDualFoldCurveSvg(
      { inPct: 40, outPct: 40, curvePct: 100 },
      { inPct: 10, outPct: 85, curvePct: 75 },
      70,
    );
    expect(overlap.path1.startsWith('M')).toBe(true);
    expect(overlap.path2.startsWith('M')).toBe(true);
    expect(overlap.handoffX).toBeLessThan(overlap.end1X);
    expect(overlap.overlapW).toBeGreaterThan(10);

    const gap = buildDualFoldCurveSvg(
      { inPct: 40, outPct: 40, curvePct: 100 },
      { inPct: 80, outPct: 20, curvePct: 90 },
      120,
    );
    expect(gap.handoffX).toBeGreaterThan(gap.end1X);
    expect(gap.overlapW).toBe(0);
    // Changing Curve 2 changes path2 while leaving path1 unchanged
    const alt = buildDualFoldCurveSvg(
      { inPct: 40, outPct: 40, curvePct: 100 },
      { inPct: 5, outPct: 95, curvePct: 100 },
      120,
    );
    expect(alt.path1).toBe(gap.path1);
    expect(alt.path2).not.toBe(gap.path2);
  });
});
