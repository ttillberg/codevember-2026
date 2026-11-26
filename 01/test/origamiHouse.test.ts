import { describe, expect, it } from 'vitest';
import {
  MODEL_PRESETS,
  buildHouseNet,
  computeNetOuterPerimeter,
  evaluateFoldedPoint,
  generateHouseSpec,
  polygonsOverlap,
  signedArea,
  type RoofType,
} from '../src/origamiHouseNet';

describe('Parametric flat-net paper houses (cross, ribbon, hex, oct, setback & L-wing)', () => {
  it('generates distinct valid non-overlapping flat nets across generations 1..20 (all 6 topologies & 8 roof types)', () => {
    const seenRoofs = new Set<string>();
    const seenTopologies = new Set<string>();
    for (let gen = 1; gen <= 20; gen++) {
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

    expect(seenRoofs.size).toBe(8);
    expect(seenTopologies.size).toBe(6);
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
      ['hip', { ...generateHouseSpec(1), W: 44, D: 56, H: 28, roofType: 'hip', pitch: 0.65, topology: 'ribbon' }],
      ['shed', { ...generateHouseSpec(1), W: 40, D: 50, H: 28, roofType: 'shed', pitch: 0.34, topology: 'ribbon' }],
      ['flat', { ...generateHouseSpec(1), W: 42, D: 48, H: 36, roofType: 'flat', pitch: 0, parapetH: 4, topology: 'ribbon' }],
      ['butterfly', { ...generateHouseSpec(8), topology: 'ribbon' }],
      ['sawtooth', { ...generateHouseSpec(6), topology: 'ribbon' }],
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

  it('closes multi-stage mountain+valley setback towers (spire & 5-hinge crowned pagoda) to 0.0000 mm', () => {
    // 1. 4-tier Setback Spire Tower (Gen 4)
    const spireSpec = generateHouseSpec(4);
    expect(spireSpec.topology).toBe('setback');
    expect(spireSpec.roofType).toBe('spire');
    const spireNet = buildHouseNet(spireSpec);
    const spireTopY = spireSpec.H + spireNet.roofRise;
    const hw2 = spireSpec.W * 0.56 * 0.5;
    const H1 = spireSpec.H * 0.5;

    for (let k = 0; k < 4; k++) {
      // Every upper tower wall stands strictly vertical from y = H1 to y = H1 + H2 along ±hw2!
      const up = spireNet.panelMap.get(`upper${k}`)!;
      expect(up.isMountain).toBe(true);
      const foldedUp = up.poly.map((pt) => evaluateFoldedPoint(spireNet, `upper${k}`, pt, 1));
      const ys = foldedUp.map((v) => v[1]);
      expect(Math.min(...ys)).toBeCloseTo(H1, 5);
      expect(Math.max(...ys)).toBeCloseTo(spireSpec.H, 5);
      for (const v of foldedUp) {
        expect(Math.max(Math.abs(v[0]), Math.abs(v[2]))).toBeCloseTo(hw2, 5);
      }

      // Every upper spire petal apex lands at exact (0, H + roofRise, 0)!
      const rf = spireNet.panelMap.get(`roof${k}`)!;
      const foldedRf = rf.poly.map((pt) => evaluateFoldedPoint(spireNet, `roof${k}`, pt, 1));
      const apex = foldedRf.reduce((best, cur) => (cur[1] > best[1] ? cur : best), foldedRf[0]);
      expect(apex[0]).toBeCloseTo(0, 5);
      expect(apex[1]).toBeCloseTo(spireTopY, 5);
      expect(apex[2]).toBeCloseTo(0, 5);
    }

    // 2. 5-hinges-deep Stepped Pagoda with horizontal skylight crown deck (Gen 9)
    const pagodaSpec = generateHouseSpec(9);
    expect(pagodaSpec.topology).toBe('setback');
    expect(pagodaSpec.roofType).toBe('mansard');
    const pagodaNet = buildHouseNet(pagodaSpec);
    const cap = pagodaNet.panelMap.get('roofCap')!;
    for (const pt of cap.poly) {
      const world = evaluateFoldedPoint(pagodaNet, 'roofCap', pt, 1);
      expect(world[1]).toBeCloseTo(pagodaSpec.H + pagodaNet.roofRise, 5);
    }

    // 3. Mid-fold kinematic non-intersection proof: whenever `fold(upper) >= fold(terrace)` (Z-pleat),
    //    every arm stays strictly inside its own 90° diagonal quadrant throughout the entire fold!
    const quadrantCheck: Array<(x: number, z: number) => boolean> = [
      (x, z) => z >= Math.abs(x) - 1e-3, // front arm (+Z world)
      (x, z) => x >= Math.abs(z) - 1e-3, // right arm (+X world)
      (x, z) => -z >= Math.abs(x) - 1e-3, // back arm (-Z world)
      (x, z) => -x >= Math.abs(z) - 1e-3, // left arm (-X world)
    ];
    for (const net of [spireNet, pagodaNet]) {
      for (const t of [0.15, 0.35, 0.55, 0.75, 0.9, 1.0]) {
        const foldById = (id: string) => {
          const st = net.panelMap.get(id)?.stage;
          if (st === 'wall') return Math.min(1, t / 0.5);
          if (st === 'upperWall') return Math.max(0, Math.min(1, (t - 0.12) / 0.45));
          if (st === 'terrace') return Math.max(0, Math.min(1, (t - 0.20) / 0.48));
          if (st === 'roof') return Math.max(0, Math.min(1, (t - 0.48) / 0.44));
          return Math.max(0, Math.min(1, (t - 0.68) / 0.32));
        };
        for (let k = 0; k < 4; k++) {
          for (const prefix of ['wall', 'terrace', 'upper', 'roof']) {
            const p = net.panelMap.get(`${prefix}${k}`)!;
            for (const pt of p.poly) {
              const [wx, , wz] = evaluateFoldedPoint(net, p.id, pt, foldById);
              expect(quadrantCheck[k](wx, wz)).toBe(true);
            }
          }
        }
      }
    }
  });

  it('closes L-shaped compound villa (mountain re-entrant corner + waterfall gable + shed wing) to 0.0000 mm', () => {
    const spec = generateHouseSpec(5);
    expect(spec.topology).toBe('lwing');
    const net = buildHouseNet(spec);
    const { W, D, H } = spec;
    const hw = W * 0.5;
    const hd = D * 0.5;
    const Ww = W * 0.62;
    const Dw = D * 0.52;
    const ox = Ww * 0.22;
    const x1 = hw - ox;
    const ySplit = -hd + Dw;

    // Re-entrant courtyard wall (`rightLower`, mountain fold!) sits flush at x = x1, z ∈ [-hd, -ySplit], y ∈ [0, H]!
    const rl = net.panelMap.get('rightLower')!;
    expect(rl.isMountain).toBe(true);
    const foldedRL = rl.poly.map((pt) => evaluateFoldedPoint(net, 'rightLower', pt, 1));
    for (const [x, y, z] of foldedRL) {
      expect(x).toBeCloseTo(x1, 5);
      expect(y === 0 || Math.abs(y) < 1e-4 || Math.abs(y - H) < 1e-4).toBe(true);
      expect(z).toBeGreaterThanOrEqual(-hd - 1e-4);
      expect(z).toBeLessThanOrEqual(-ySplit + 1e-4);
    }

    // Waterfall right roof (`roofR` hinged off `roofL`'s ridge!) lands its lower eave at exact (x1, H)!
    const rr = net.panelMap.get('roofR')!;
    const foldedRR = rr.poly.map((pt) => evaluateFoldedPoint(net, 'roofR', pt, 1));
    const lowEaveRR = foldedRR.filter((v) => Math.abs(v[1] - H) < 1e-3);
    expect(lowEaveRR.length).toBe(2);
    for (const v of lowEaveRR) expect(v[0]).toBeCloseTo(x1, 5);

    // Side wing shed roof (`wingRoof`) meets the main house's right eave at exact (x1, H)!
    const wr = net.panelMap.get('wingRoof')!;
    const foldedWR = wr.poly.map((pt) => evaluateFoldedPoint(net, 'wingRoof', pt, 1));
    const topEdgeWR = foldedWR.filter((v) => Math.abs(v[1] - H) < 1e-3);
    expect(topEdgeWR.length).toBe(2);
    for (const v of topEdgeWR) expect(v[0]).toBeCloseTo(x1, 5);
  });

  it('closes butterfly V-roofs and alternating mountain+valley sawtooth accordion roofs on both cross & ribbon to 0.0000 mm', () => {
    for (const topology of ['cross', 'ribbon'] as const) {
      // Butterfly V-roof: both wings kiss at center trough x = 0, y = H - R!
      const bSpec = { ...generateHouseSpec(8), topology };
      const bNet = buildHouseNet(bSpec);
      const R = Math.min(bSpec.H * 0.36, bSpec.W * 0.5 * Math.tan(bSpec.pitch));
      for (const pid of ['roofL', 'roofR']) {
        const folded = bNet.panelMap.get(pid)!.poly.map((pt) => evaluateFoldedPoint(bNet, pid, pt, 1));
        const valley = folded.filter((v) => Math.abs(v[0]) < 1e-3);
        expect(valley.length).toBe(2);
        for (const v of valley) expect(v[1]).toBeCloseTo(bSpec.H - R, 5);
      }

      // Sawtooth concertina roof: 4 pleated panels (`roofS2` is mountain!) land final edge on right wall `(hw, H)`!
      const sSpec = { ...generateHouseSpec(6), topology };
      const sNet = buildHouseNet(sSpec);
      expect(sNet.panelMap.get('roofS2')!.isMountain).toBe(true);
      const foldedEnd = sNet.panelMap.get('roofS3')!.poly.map((pt) => evaluateFoldedPoint(sNet, 'roofS3', pt, 1));
      const rightEdge = foldedEnd.filter((v) => Math.abs(v[0] - sSpec.W * 0.5) < 1e-3);
      expect(rightEdge.length).toBe(2);
      for (const v of rightEdge) expect(v[1]).toBeCloseTo(sSpec.H, 5);
    }
  });

  it('traces an exact single outer cutout perimeter whose area equals the sum of all panels across generations 1..20', () => {
    for (let gen = 1; gen <= 20; gen++) {
      const net = buildHouseNet(generateHouseSpec(gen));
      const outer = computeNetOuterPerimeter(net);
      const panelAreaSum = net.panels.reduce((acc, p) => acc + signedArea(p.poly), 0);
      expect(outer.length).toBeGreaterThanOrEqual(4);
      expect(signedArea(outer)).toBeCloseTo(panelAreaSum, 1);
    }
  });

  it('builds every selectable debug model preset (1..12) cleanly with zero overlap', () => {
    expect(MODEL_PRESETS.length).toBe(12);
    for (const preset of MODEL_PRESETS) {
      const spec = generateHouseSpec(1, preset.slot);
      expect(spec.label).toBe(preset.label);
      const net = buildHouseNet(spec);
      for (let i = 0; i < net.panels.length; i++) {
        for (let j = i + 1; j < net.panels.length; j++) {
          expect(polygonsOverlap(net.panels[i].poly, net.panels[j].poly)).toBe(false);
        }
      }
    }
  });
});
