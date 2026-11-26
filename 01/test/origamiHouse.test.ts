import { describe, expect, it } from 'vitest';
import {
  buildHouseNet,
  evaluateFoldedPoint,
  generateHouseSpec,
  polygonsOverlap,
  signedArea,
} from '../src/origamiHouseNet';

describe('Parametric flat-net paper houses (all 6 roof types)', () => {
  it('generates distinct valid non-overlapping flat nets across generations 1..12', () => {
    const seenRoofs = new Set<string>();
    for (let gen = 1; gen <= 12; gen++) {
      const spec = generateHouseSpec(gen);
      const net = buildHouseNet(spec);
      seenRoofs.add(spec.roofType);

      // Every panel has strictly positive CCW area
      for (const p of net.panels) {
        expect(signedArea(p.poly)).toBeGreaterThan(10);
      }

      // Zero flat-sheet overlaps between any pair of panels!
      for (let i = 0; i < net.panels.length; i++) {
        for (let j = i + 1; j < net.panels.length; j++) {
          expect(polygonsOverlap(net.panels[i].poly, net.panels[j].poly)).toBe(false);
        }
      }
    }

    // All 6 roof architectures appear across the first 7 layers
    expect(seenRoofs.size).toBe(6);
  });

  it('closes gable roofs to the exact center ridge and gable peaks', () => {
    const net = buildHouseNet(generateHouseSpec(1));
    const { W, D, H } = net.spec;
    const expectedY = H + net.roofRise;

    const leftRidge = evaluateFoldedPoint(net, 'roofL', [-(W * 0.5 + H + net.roofSlant), -D * 0.5], 1);
    const rightRidge = evaluateFoldedPoint(net, 'roofR', [W * 0.5 + H + net.roofSlant, -D * 0.5], 1);
    const frontPeak = evaluateFoldedPoint(net, 'front', [0, -(D * 0.5 + H + net.roofRise)], 1);

    expect(leftRidge[0]).toBeCloseTo(0, 5);
    expect(leftRidge[1]).toBeCloseTo(expectedY, 5);
    expect(rightRidge[0]).toBeCloseTo(0, 5);
    expect(rightRidge[1]).toBeCloseTo(expectedY, 5);
    expect(frontPeak[1]).toBeCloseTo(expectedY, 5);
    expect(frontPeak[2]).toBeCloseTo(D * 0.5, 5);
  });

  it('closes mansard flaps and hinged top cap deck flush at exact roof height', () => {
    const net = buildHouseNet(generateHouseSpec(2)); // mansard
    expect(net.spec.roofType).toBe('mansard');
    const { H } = net.spec;
    const expectedY = H + net.roofRise;

    const cap = net.panelMap.get('roofCap')!;
    // All 4 corners of the folded mansard cap must lie strictly horizontal at y = H + roofRise!
    for (const pt of cap.poly) {
      const world = evaluateFoldedPoint(net, 'roofCap', pt, 1);
      expect(world[1]).toBeCloseTo(expectedY, 5);
    }
  });

  it('closes all 4 spire petals to the exact central needle apex', () => {
    const net = buildHouseNet(generateHouseSpec(3)); // spire
    expect(net.spec.roofType).toBe('spire');
    const { W, D, H } = net.spec;
    const expectedY = H + net.roofRise;

    const tips = [
      evaluateFoldedPoint(net, 'roofF', [0, -(D * 0.5 + H + net.roofSlant)], 1),
      evaluateFoldedPoint(net, 'roofB', [0, D * 0.5 + H + net.roofSlant], 1),
      evaluateFoldedPoint(net, 'roofL', [-(W * 0.5 + H + net.roofSlant), 0], 1),
      evaluateFoldedPoint(net, 'roofR', [W * 0.5 + H + net.roofSlant, 0], 1),
    ];

    for (const tip of tips) {
      expect(tip[0]).toBeCloseTo(0, 5);
      expect(tip[1]).toBeCloseTo(expectedY, 5);
      expect(tip[2]).toBeCloseTo(0, 5);
    }
  });

  it('closes shed roof flush onto the high opposite wall top edge', () => {
    const net = buildHouseNet(generateHouseSpec(5)); // shed
    expect(net.spec.roofType).toBe('shed');
    const { W, H } = net.spec;

    const shedHighEdge = evaluateFoldedPoint(net, 'roofL', [-(W * 0.5 + H + net.roofSlant), 0], 1);
    expect(shedHighEdge[0]).toBeCloseTo(W * 0.5, 5);
    expect(shedHighEdge[1]).toBeCloseTo(H + net.roofRise, 5);
  });

  it('closes flat roof deck horizontally onto the opposite wall at height H', () => {
    const net = buildHouseNet(generateHouseSpec(6)); // flat
    expect(net.spec.roofType).toBe('flat');
    const { W, H } = net.spec;

    const farEdge = evaluateFoldedPoint(net, 'roofL', [-(W * 0.5 + H + W), 0], 1);
    expect(farEdge[0]).toBeCloseTo(W * 0.5, 5);
    expect(farEdge[1]).toBeCloseTo(H, 5);
  });

  it('expands the paper sheet cleanly when houses grow bigger and stays non-overlapping across generations 1..18', () => {
    const baseNet = buildHouseNet(generateHouseSpec(1));
    expect(baseNet.sheetHalfMm).toBe(75); // 150x150 mm baseline sheet

    let sawBiggerSheet = false;
    for (let gen = 2; gen <= 18; gen++) {
      const net = buildHouseNet(generateHouseSpec(gen));
      if (net.sheetHalfMm > baseNet.sheetHalfMm) sawBiggerSheet = true;

      // Every flat vertex stays strictly inside the allocated square sheet!
      for (const p of net.panels) {
        for (const [x, y] of p.poly) {
          expect(Math.abs(x)).toBeLessThanOrEqual(net.sheetHalfMm);
          expect(Math.abs(y)).toBeLessThanOrEqual(net.sheetHalfMm);
        }
      }

      // Zero flat overlaps even for large multi-story scales!
      for (let i = 0; i < net.panels.length; i++) {
        for (let j = i + 1; j < net.panels.length; j++) {
          expect(polygonsOverlap(net.panels[i].poly, net.panels[j].poly)).toBe(false);
        }
      }
    }
    expect(sawBiggerSheet).toBe(true);
  });
});
