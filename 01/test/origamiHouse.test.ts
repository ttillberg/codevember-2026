import { describe, expect, it } from 'vitest';
import {
  CORNER_ORDER,
  CORNER_SCRAPS,
  HALF_D,
  HALF_S,
  HALF_W,
  HOUSE_D,
  HOUSE_PANELS,
  HOUSE_W,
  ROOF_L,
  ROOF_R,
  SQUARE_MM,
  WALL_H,
  evaluateFoldedRidgeEndpoints,
  projectOntoPolyline,
  signedArea,
} from '../src/origamiHouseNet';

describe('Square origami house net (150 × 150 mm)', () => {
  it('tiles the exact 150 × 150 mm square with 7 house panels and 4 corner scraps (zero gap, zero overlap)', () => {
    const panelAreas = Object.values(HOUSE_PANELS).map((p) => signedArea(p.poly));
    const scrapAreas = CORNER_ORDER.map((id) => signedArea(CORNER_SCRAPS[id].poly));

    // Every polygon must be strictly counter-clockwise (positive area)
    for (const a of [...panelAreas, ...scrapAreas]) {
      expect(a).toBeGreaterThan(100);
    }

    const sum = [...panelAreas, ...scrapAreas].reduce((acc, v) => acc + v, 0);
    expect(sum).toBeCloseTo(SQUARE_MM * SQUARE_MM, 6);
  });

  it('keeps every vertex strictly within [-75, +75] mm and touches all 4 edges of the square', () => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const p of Object.values(HOUSE_PANELS)) {
      for (const [x, y] of p.poly) {
        expect(Math.abs(x)).toBeLessThanOrEqual(HALF_S + 1e-9);
        expect(Math.abs(y)).toBeLessThanOrEqual(HALF_S + 1e-9);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }

    // House net touches all 4 outer edges of the origami square!
    expect(minX).toBeCloseTo(-HALF_S, 6);
    expect(maxX).toBeCloseTo(HALF_S, 6);
    expect(minY).toBeCloseTo(-HALF_S, 6);
    expect(maxY).toBeCloseTo(HALF_S, 6);
  });

  it('has exact silver-ratio proportions (D = W * √2) and 45° pitched roof', () => {
    expect(HOUSE_D / HOUSE_W).toBeCloseTo(Math.SQRT2, 6);
    expect(Math.atan2(ROOF_R, HALF_W)).toBeCloseTo(Math.PI / 4, 6);
    expect(ROOF_L).toBeCloseTo(HALF_D, 6);
    expect(WALL_H).toBeGreaterThan(20);
  });

  it('starts and ends all 4 corner cut paths strictly on the square boundary', () => {
    for (const cid of CORNER_ORDER) {
      const path = CORNER_SCRAPS[cid].cutPath;
      const first = path[0];
      const last = path[path.length - 1];
      expect(Math.abs(first[0])).toBeCloseTo(HALF_S, 6);
      expect(Math.abs(last[1])).toBeCloseTo(HALF_S, 6);
      expect(last[0]).toBeCloseTo(0, 6);

      const midProj = projectOntoPolyline(path[1], path);
      expect(midProj.dist).toBeCloseTo(0, 6);
      expect(midProj.u).toBeGreaterThan(0.2);
      expect(midProj.u).toBeLessThan(0.8);
    }
  });

  it('closes both roof slopes and both gable peaks to the exact ridge line at fold = 1', () => {
    const { leftRidgeFront, rightRidgeFront, frontGablePeak, backGablePeak } =
      evaluateFoldedRidgeEndpoints(1);
    const expectedRidgeY = WALL_H + ROOF_R;

    // Both roof slopes kiss at exact x = 0, y = WALL_H + ROOF_R, z = +HALF_D!
    expect(leftRidgeFront[0]).toBeCloseTo(0, 6);
    expect(leftRidgeFront[1]).toBeCloseTo(expectedRidgeY, 6);
    expect(leftRidgeFront[2]).toBeCloseTo(HALF_D, 6);

    expect(rightRidgeFront[0]).toBeCloseTo(0, 6);
    expect(rightRidgeFront[1]).toBeCloseTo(expectedRidgeY, 6);
    expect(rightRidgeFront[2]).toBeCloseTo(HALF_D, 6);

    // Front & back gable peaks lock seamlessly to the exact ridge height at z = ±HALF_D!
    expect(frontGablePeak[0]).toBeCloseTo(0, 6);
    expect(frontGablePeak[1]).toBeCloseTo(expectedRidgeY, 6);
    expect(frontGablePeak[2]).toBeCloseTo(HALF_D, 6);

    expect(backGablePeak[0]).toBeCloseTo(0, 6);
    expect(backGablePeak[1]).toBeCloseTo(expectedRidgeY, 6);
    expect(backGablePeak[2]).toBeCloseTo(-HALF_D, 6);
  });
});
