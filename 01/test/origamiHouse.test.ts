import { describe, expect, it } from 'vitest';
import {
  buildHouseNet,
  evaluateFoldedPoint,
  generateHouseSpec,
  polygonsOverlap,
  signedArea,
  type RoofType,
} from '../src/origamiHouseNet';

describe('Parametric flat-net paper houses (cross, ribbon, hex & oct petal blooms)', () => {
  it('generates distinct valid non-overlapping flat nets across generations 1..14 (all 4 topologies & 6 roof types)', () => {
    const seenRoofs = new Set<string>();
    const seenTopologies = new Set<string>();
    for (let gen = 1; gen <= 14; gen++) {
      const spec = generateHouseSpec(gen);
      const net = buildHouseNet(spec);
      seenRoofs.add(spec.roofType);
      seenTopologies.add(spec.topology);

      for (const p of net.panels) {
        expect(signedArea(p.poly)).toBeGreaterThan(10);
      }

      for (let i = 0; i < net.panels.length; i++) {
        for (let j = i + 1; j < net.panels.length; j++) {
          expect(polygonsOverlap(net.panels[i].poly, net.panels[j].poly)).toBe(false);
        }
      }
    }

    expect(seenRoofs.size).toBe(6);
    expect(seenTopologies.size).toBe(4);
  });

  it('closes gable roofs to the exact center ridge and gable peaks (cross)', () => {
    const net = buildHouseNet({ ...generateHouseSpec(1), topology: 'cross' });
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

  it('closes mansard flaps and hinged top cap deck flush at exact roof height (both cross and ribbon)', () => {
    for (const topology of ['cross', 'ribbon'] as const) {
      const net = buildHouseNet({ ...generateHouseSpec(2), topology });
      expect(net.spec.roofType).toBe('mansard');
      const expectedY = net.spec.H + net.roofRise;

      const cap = net.panelMap.get('roofCap')!;
      for (const pt of cap.poly) {
        const world = evaluateFoldedPoint(net, 'roofCap', pt, 1);
        expect(world[1]).toBeCloseTo(expectedY, 5);
      }
    }
  });

  it('closes all 4 rectangular spire petals to the exact central needle apex (both cross and ribbon)', () => {
    const baseSpire = { ...generateHouseSpec(1), W: 36, D: 36, H: 52, roofType: 'spire' as const, pitch: 1.2 };
    for (const topology of ['cross', 'ribbon'] as const) {
      const net = buildHouseNet({ ...baseSpire, topology });
      const expectedY = net.spec.H + net.roofRise;

      for (const pid of ['roofF', 'roofB', 'roofL', 'roofR']) {
        const p = net.panelMap.get(pid)!;
        const folded = p.poly.map((pt) => evaluateFoldedPoint(net, pid, pt, 1));
        const apex = folded.reduce((best, cur) => (cur[1] > best[1] ? cur : best), folded[0]);
        expect(apex[0]).toBeCloseTo(0, 5);
        expect(apex[1]).toBeCloseTo(expectedY, 5);
        expect(apex[2]).toBeCloseTo(0, 5);
      }
    }
  });

  it('closes hexagonal (6-petal) and octagonal (8-petal) spires and crowned pavilions to 0.0000 mm', () => {
    // 1. Pointed spires (6-sided and 8-sided)
    for (const [topology, sides] of [
      ['hex', 6],
      ['oct', 8],
    ] as const) {
      const spec = { ...generateHouseSpec(3), topology, roofType: 'spire' as const, mansardRatio: 0 };
      const net = buildHouseNet(spec);
      const expectedY = spec.H + net.roofRise;

      // Zero flat-sheet overlap across all petals
      for (let i = 0; i < net.panels.length; i++) {
        for (let j = i + 1; j < net.panels.length; j++) {
          expect(polygonsOverlap(net.panels[i].poly, net.panels[j].poly)).toBe(false);
        }
      }

      // Every spire petal apex lands at exact (0, H + roofRise, 0)!
      for (let k = 0; k < sides; k++) {
        const pid = `roof${k}`;
        const p = net.panelMap.get(pid)!;
        const folded = p.poly.map((pt) => evaluateFoldedPoint(net, pid, pt, 1));
        const apex = folded.reduce((best, cur) => (cur[1] > best[1] ? cur : best), folded[0]);
        expect(apex[0]).toBeCloseTo(0, 5);
        expect(apex[1]).toBeCloseTo(expectedY, 5);
        expect(apex[2]).toBeCloseTo(0, 5);
      }
    }

    // 2. Crowned pavilions with regular N-gon hinged top deck (hex & oct)
    for (const [topology, sides] of [
      ['hex', 6],
      ['oct', 8],
    ] as const) {
      const spec = { ...generateHouseSpec(5), topology, roofType: 'mansard' as const, mansardRatio: 0.4 };
      const net = buildHouseNet(spec);
      const expectedY = spec.H + net.roofRise;

      // Zero flat-sheet overlap including N-gon roofCap!
      for (let i = 0; i < net.panels.length; i++) {
        for (let j = i + 1; j < net.panels.length; j++) {
          expect(polygonsOverlap(net.panels[i].poly, net.panels[j].poly)).toBe(false);
        }
      }

      // All N vertices of the hexagonal/octagonal roofCap sit strictly horizontal at y = H + roofRise!
      const cap = net.panelMap.get('roofCap')!;
      expect(cap.poly.length).toBe(sides);
      for (const pt of cap.poly) {
        const world = evaluateFoldedPoint(net, 'roofCap', pt, 1);
        expect(world[1]).toBeCloseTo(expectedY, 5);
      }
    }
  });

  it('wraps ribbon nets seamlessly around all 4 walls and closes all 6 roof types to 0.0000 mm', () => {
    const roofSpecs: Array<[RoofType, ReturnType<typeof generateHouseSpec>]> = [
      ['gable', { ...generateHouseSpec(1), topology: 'ribbon' }],
      ['mansard', { ...generateHouseSpec(2), topology: 'ribbon' }],
      ['spire', { ...generateHouseSpec(1), W: 36, D: 36, H: 52, roofType: 'spire', pitch: 1.2, topology: 'ribbon' }],
      ['hip', { ...generateHouseSpec(4), topology: 'ribbon' }],
      ['shed', { ...generateHouseSpec(8), topology: 'ribbon' }],
      ['flat', { ...generateHouseSpec(6), topology: 'ribbon' }],
    ];

    for (const [roofType, spec] of roofSpecs) {
      expect(spec.roofType).toBe(roofType);
      const net = buildHouseNet(spec);
      const { W, D, H } = spec;
      const hw = W * 0.5;
      const hd = D * 0.5;

      for (let i = 0; i < net.panels.length; i++) {
        for (let j = i + 1; j < net.panels.length; j++) {
          expect(polygonsOverlap(net.panels[i].poly, net.panels[j].poly)).toBe(false);
        }
      }

      const frontFarBottom = evaluateFoldedPoint(net, 'front', [hw + D + W, hd], 1);
      expect(frontFarBottom[0]).toBeCloseTo(-hw, 5);
      expect(frontFarBottom[1]).toBeCloseTo(0, 5);
      expect(frontFarBottom[2]).toBeCloseTo(hd, 5);

      const leftFarBottom = evaluateFoldedPoint(net, 'left', [-(hw + D), hd], 1);
      expect(leftFarBottom[0]).toBeCloseTo(-hw, 5);
      expect(leftFarBottom[1]).toBeCloseTo(0, 5);
      expect(leftFarBottom[2]).toBeCloseTo(hd, 5);

      if (roofType === 'gable') {
        const expectedY = H + net.roofRise;
        const rL = evaluateFoldedPoint(net, 'roofL', [-(hw + D), hd + H + net.roofSlant], 1);
        const rR = evaluateFoldedPoint(net, 'roofR', [hw + D, hd + H + net.roofSlant], 1);
        const fPeak = evaluateFoldedPoint(net, 'front', [hw + D + hw, hd + H + net.roofRise], 1);
        expect(rL[0]).toBeCloseTo(0, 5);
        expect(rL[1]).toBeCloseTo(expectedY, 5);
        expect(rR[0]).toBeCloseTo(0, 5);
        expect(rR[1]).toBeCloseTo(expectedY, 5);
        expect(fPeak[0]).toBeCloseTo(0, 5);
        expect(fPeak[1]).toBeCloseTo(expectedY, 5);
        expect(fPeak[2]).toBeCloseTo(hd, 5);
      } else if (roofType === 'shed') {
        const farEdge = evaluateFoldedPoint(net, 'roofL', [-(hw + hd), hd + H + net.roofSlant], 1);
        expect(farEdge[0]).toBeCloseTo(hw, 5);
        expect(farEdge[1]).toBeCloseTo(H + net.roofRise, 5);
      } else if (roofType === 'flat') {
        const farEdge = evaluateFoldedPoint(net, 'roofL', [-(hw + hd), hd + H + W], 1);
        expect(farEdge[0]).toBeCloseTo(hw, 5);
        expect(farEdge[1]).toBeCloseTo(H, 5);
      } else if (roofType === 'hip') {
        const expectedY = H + net.roofRise;
        const topF = evaluateFoldedPoint(net, 'roofF', [hw + D + hw, hd + H + net.roofSlant], 1);
        const topB = evaluateFoldedPoint(net, 'roofB', [0, hd + H + net.roofSlant], 1);
        expect(topF[1]).toBeCloseTo(expectedY, 5);
        expect(topB[1]).toBeCloseTo(expectedY, 5);
      }
    }
  });

  it('expands the paper sheet cleanly when houses grow bigger and stays non-overlapping across generations 1..18', () => {
    const baseNet = buildHouseNet(generateHouseSpec(1));
    expect(baseNet.sheetHalfMm).toBe(75);

    let sawBiggerSheet = false;
    for (let gen = 2; gen <= 18; gen++) {
      const net = buildHouseNet(generateHouseSpec(gen));
      if (net.sheetHalfMm > baseNet.sheetHalfMm) sawBiggerSheet = true;

      for (const p of net.panels) {
        for (const [x, y] of p.poly) {
          expect(Math.abs(x)).toBeLessThanOrEqual(net.sheetHalfMm);
          expect(Math.abs(y)).toBeLessThanOrEqual(net.sheetHalfMm);
        }
      }

      for (let i = 0; i < net.panels.length; i++) {
        for (let j = i + 1; j < net.panels.length; j++) {
          expect(polygonsOverlap(net.panels[i].poly, net.panels[j].poly)).toBe(false);
        }
      }
    }
    expect(sawBiggerSheet).toBe(true);
  });
});
