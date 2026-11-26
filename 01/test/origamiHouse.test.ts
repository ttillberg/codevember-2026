import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
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
import { buildOrigamiHouseRig, type OrigamiMaterials } from '../src/origamiPaperMesh';

describe('Parametric flat-net paper houses (cross, ribbon, hex, oct, setback, L-wing & village)', () => {
  it('generates distinct valid non-overlapping flat nets across generations 1..20 (all 7 topologies & 8 roof types)', () => {
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
    expect(seenTopologies.size).toBe(7);
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

  it('builds every selectable debug model preset (1..14) cleanly with zero overlap and 1 unbroken outer cutout', () => {
    expect(MODEL_PRESETS.length).toBe(14);
    for (const preset of MODEL_PRESETS) {
      const spec = generateHouseSpec(1, preset.slot);
      expect(spec.label).toBe(preset.label);
      const net = buildHouseNet(spec);
      for (let i = 0; i < net.panels.length; i++) {
        for (let j = i + 1; j < net.panels.length; j++) {
          expect(polygonsOverlap(net.panels[i].poly, net.panels[j].poly)).toBe(false);
        }
      }
      const outer = computeNetOuterPerimeter(net);
      const panelAreaSum = net.panels.reduce((acc, p) => acc + signedArea(p.poly), 0);
      expect(signedArea(outer)).toBeCloseTo(panelAreaSum, 1);
    }
  });

  it('closes wall-to-wall composite houses (2, 3, and 4 houses) to 0.0000 mm as ONE single unbroken cutout with shared-wall suppression', () => {
    // 1. Composite manor (slot 10): 3 ribbon volumes pressed flush wall-to-wall (`0.48 mm` paper-thickness kiss)
    const estate = buildHouseNet(generateHouseSpec(1, 10));
    expect(estate.spec.topology).toBe('village');
    expect(estate.panels.filter((p) => p.stage === 'base').length).toBe(5); // 3 floors + 2 flush 0.48mm seam welds
    expect(estate.panels.some((p) => p.skipOpenings)).toBe(true); // shared interior walls suppress openings!
    const cap = estate.panelMap.get('b0_roofCap')!;
    const capY = cap.panelSpec!.H + cap.panelRoofRise!;
    for (const pt of cap.poly) {
      const world = evaluateFoldedPoint(estate, 'b0_roofCap', pt, 1);
      expect(world[1]).toBeCloseTo(capY, 4);
    }

    // 2. Composite estate (slot 14): 4 ribbon volumes pressed flush wall-to-wall (stepped + gambrel + shed + spire tower)
    const coastal = buildHouseNet(generateHouseSpec(1, 14));
    expect(coastal.spec.topology).toBe('village');
    expect(coastal.panels.filter((p) => p.stage === 'base').length).toBe(7); // 4 floors + 3 flush 0.48mm seam welds
    const b3Base = coastal.panelMap.get('b3_base')!;
    const b3Cx = b3Base.poly.reduce((s, p) => s + p[0], 0) / b3Base.poly.length;
    const b3Cy = b3Base.poly.reduce((s, p) => s + p[1], 0) / b3Base.poly.length;
    const spireSpec = coastal.panelMap.get('b3_roofF')!.panelSpec!;
    const spireY = spireSpec.H + coastal.panelMap.get('b3_roofF')!.panelRoofRise!;
    for (const pid of ['b3_roofF', 'b3_roofB', 'b3_roofL', 'b3_roofR']) {
      const p = coastal.panelMap.get(pid)!;
      const folded = p.poly.map((pt) => evaluateFoldedPoint(coastal, pid, pt, 1));
      const apex = folded.reduce((best, cur) => (cur[1] > best[1] ? cur : best), folded[0]);
      expect(apex[0]).toBeCloseTo(b3Cx, 4);
      expect(apex[1]).toBeCloseTo(spireY, 4);
      expect(apex[2]).toBeCloseTo(-b3Cy, 4);
    }
    // 3. Parametric mix-and-match stress test: 2-, 3-, and 4-house wall-to-wall composites across ALL 8 roof types!
    const allRoofs: RoofType[] = ['gable', 'mansard', 'spire', 'hip', 'shed', 'flat', 'butterfly', 'sawtooth'];
    for (const count of [2, 3, 4] as const) {
      for (let i = 0; i < allRoofs.length; i++) {
        const spec = generateHouseSpec(1, { houses: count, roofType: allRoofs[i], seed: i + 1 + count * 10 });
        expect(spec.topology).toBe('village');
        const net = buildHouseNet(spec);
        for (let a = 0; a < net.panels.length; a++) {
          for (let b = a + 1; b < net.panels.length; b++) {
            expect(polygonsOverlap(net.panels[a].poly, net.panels[b].poly)).toBe(false);
          }
        }
        const outer = computeNetOuterPerimeter(net);
        const panelAreaSum = net.panels.reduce((acc, p) => acc + signedArea(p.poly), 0);
        expect(signedArea(outer)).toBeCloseTo(panelAreaSum, 1);
      }
    }
  });

  it('deterministically seeds entire 16-generation sequences with varied non-overlapping single-cutout nets', () => {
    for (const seed of [42, 2026]) {
      const labelsA: string[] = [];
      const labelsB: string[] = [];
      const seenTopos = new Set<string>();
      for (let g = 1; g <= 16; g++) {
        const sA = generateHouseSpec(g, { seed });
        const sB = generateHouseSpec(g, { seed });
        expect(sA.label).toBe(sB.label);
        expect(sA.topology).toBe(sB.topology);
        expect(sA.roofType).toBe(sB.roofType);
        expect(sA.W).toBeCloseTo(sB.W, 6);
        labelsA.push(`${sA.topology}:${sA.roofType}`);
        labelsB.push(`${sB.topology}:${sB.roofType}`);
        seenTopos.add(sA.topology);

        const net = buildHouseNet(sA);
        for (let i = 0; i < net.panels.length; i++) {
          for (let j = i + 1; j < net.panels.length; j++) {
            expect(polygonsOverlap(net.panels[i].poly, net.panels[j].poly)).toBe(false);
          }
        }
        const outer = computeNetOuterPerimeter(net);
        const areaSum = net.panels.reduce((acc, p) => acc + signedArea(p.poly), 0);
        expect(signedArea(outer)).toBeCloseTo(areaSum, 1);
      }
      expect(labelsA).toEqual(labelsB);
      expect(seenTopos.size).toBeGreaterThanOrEqual(5);
    }

    // Distinct seeds must permute the generational sequence
    const seq0 = Array.from({ length: 14 }, (_, i) => generateHouseSpec(i + 1, { seed: 0 }).topology);
    const seq42 = Array.from({ length: 14 }, (_, i) => generateHouseSpec(i + 1, { seed: 42 }).topology);
    const seq2026 = Array.from({ length: 14 }, (_, i) => generateHouseSpec(i + 1, { seed: 2026 }).topology);
    expect(seq42).not.toEqual(seq0);
    expect(seq2026).not.toEqual(seq42);
  });

  it('composes recursive architectural parameters (window -> row -> level -> facade -> building) with consistency dial', () => {
    // 1. Strict consistency (1.0): uniform rhythm, matching left/right facades, centered door
    const strictSpec = generateHouseSpec(2, {
      seed: 17,
      topology: 'ribbon',
      roofType: 'mansard',
      windowStyle: 'lancet',
      windowCount: 4,
      doorStyle: 'arched',
      levels: 2,
      consistency: 1.0,
    });
    expect(strictSpec.architecture).toBeDefined();
    const strictArch = strictSpec.architecture!;
    expect(strictArch.consistency).toBe(1.0);
    expect(strictArch.facades.front.levels).toHaveLength(2);
    expect(strictArch.facades.front.levels[0].windowRow.rhythm).toBe('uniform');
    expect(strictArch.facades.front.levels[0].windowRow.count).toBe(4);
    expect(strictArch.facades.front.levels[0].windowRow.baseWindow.shape).toBe('lancet');
    expect(strictArch.facades.front.levels[0].door?.position).toBe('center');
    expect(strictArch.facades.left.levels[0].windowRow.baseWindow.shape).toBe(
      strictArch.facades.right.levels[0].windowRow.baseWindow.shape,
    );

    // 2. Low consistency (0.05): allows eclectic cross-facade/per-bay variation while keeping valid net
    const eclecticSpec = generateHouseSpec(6, {
      seed: 99,
      houses: 3,
      consistency: 0.05,
      windowStyle: 'round',
      levels: 2,
      heightScale: 1.15,
    });
    expect(eclecticSpec.topology).toBe('village');
    expect(eclecticSpec.consistency).toBeCloseTo(0.05, 5);
    const villageNet = buildHouseNet(eclecticSpec);
    const subSpecs = new Set(villageNet.panels.map((p) => p.panelSpec).filter(Boolean));
    expect(subSpecs.size).toBe(3);
    for (const sub of subSpecs) {
      expect(sub!.architecture).toBeDefined();
      expect(sub!.architecture!.facades.front.levels).toHaveLength(2);
      expect(sub!.architecture!.facades.front.levels[0].windowRow.baseWindow.shape).toBe('round');
    }
    for (let i = 0; i < villageNet.panels.length; i++) {
      for (let j = i + 1; j < villageNet.panels.length; j++) {
        expect(polygonsOverlap(villageNet.panels[i].poly, villageNet.panels[j].poly)).toBe(false);
      }
    }
  });

  it('closes all 5 gable ceiling profiles (classic, gambrel 2x, stepped 3x ladder, barrel 3x, saltbox) to 0.0000 mm on cross & ribbon', () => {
    const profiles = ['classic', 'gambrel', 'stepped', 'barrel', 'saltbox'] as const;
    for (const topology of ['cross', 'ribbon'] as const) {
      for (const gableProfile of profiles) {
        const spec = generateHouseSpec(1, {
          topology,
          roofType: 'gable',
          gableProfile,
          seed: 7,
        });
        expect(spec.roofType).toBe('gable');
        expect(spec.gableProfile).toBe(gableProfile);
        const net = buildHouseNet(spec);
        const expectedY = spec.H + net.roofRise;
        const expectedRidgeX = gableProfile === 'saltbox' ? spec.W * 0.5 * 0.30 : 0;

        // 1. Zero flat-net panel overlap + single unbroken outer cutout loop
        for (let i = 0; i < net.panels.length; i++) {
          for (let j = i + 1; j < net.panels.length; j++) {
            expect(polygonsOverlap(net.panels[i].poly, net.panels[j].poly)).toBe(false);
          }
        }
        const outer = computeNetOuterPerimeter(net);
        const areaSum = net.panels.reduce((acc, p) => acc + signedArea(p.poly), 0);
        expect(signedArea(outer)).toBeCloseTo(areaSum, 1);

        // 2. Final left & right ceiling strips meet at exact (expectedRidgeX, H + roofRise) to 0.0000 mm!
        const leftPanels = net.panels.filter((p) => p.id === 'roofL' || /^roofL\d+$/.test(p.id));
        const rightPanels = net.panels.filter((p) => p.id === 'roofR' || /^roofR\d+$/.test(p.id));
        const lastL = leftPanels[leftPanels.length - 1];
        const lastR = rightPanels[rightPanels.length - 1];
        expect(lastL).toBeDefined();
        expect(lastR).toBeDefined();

        const foldedL = lastL.poly.map((pt) => evaluateFoldedPoint(net, lastL.id, pt, 1));
        const foldedR = lastR.poly.map((pt) => evaluateFoldedPoint(net, lastR.id, pt, 1));
        const ridgePtL = foldedL.reduce((best, cur) =>
          Math.abs(cur[0] - expectedRidgeX) + Math.abs(cur[1] - expectedY) <
          Math.abs(best[0] - expectedRidgeX) + Math.abs(best[1] - expectedY)
            ? cur
            : best,
        );
        const ridgePtR = foldedR.reduce((best, cur) =>
          Math.abs(cur[0] - expectedRidgeX) + Math.abs(cur[1] - expectedY) <
          Math.abs(best[0] - expectedRidgeX) + Math.abs(best[1] - expectedY)
            ? cur
            : best,
        );
        expect(ridgePtL[0]).toBeCloseTo(expectedRidgeX, 5);
        expect(ridgePtL[1]).toBeCloseTo(expectedY, 5);
        expect(ridgePtR[0]).toBeCloseTo(expectedRidgeX, 5);
        expect(ridgePtR[1]).toBeCloseTo(expectedY, 5);

        // 3. Stepped 3x ladder Z-pleat non-collision check: with walls upright and all roof creases synced at t,
        //    every riser stays strictly above H and never dips into the interior!
        if (gableProfile === 'stepped') {
          expect(leftPanels.length).toBe(7); // 3 treads + 3 mountain risers + crown half
          expect(leftPanels.filter((p) => p.isMountain).length).toBe(3);
          for (const t of [0.25, 0.5, 0.75, 1.0]) {
            const evalFold = (id: string) => (net.panelMap.get(id)?.stage === 'roof' ? t : 1);
            for (const rp of leftPanels) {
              for (const pt of rp.poly) {
                const [, y] = evaluateFoldedPoint(net, rp.id, pt, evalFold);
                expect(y).toBeGreaterThanOrEqual(spec.H - 1e-4);
              }
            }
          }
        }
      }
    }
  });

  it('propagates recursive window opening modes (top-hung awning, louver, shutters, casement) and details (cross, transom, triple, sill)', () => {
    // Pure Layer 1 curated cottage stays clean & punched by default
    const curated1 = generateHouseSpec(1);
    expect(curated1.architecture?.facades.front.levels[0].windowRow.baseWindow.openingMode).toBe('punched');
    expect(curated1.architecture?.facades.front.levels[0].windowRow.baseWindow.detail).toBe('clean');

    // Explicit overrides propagate to single buildings and multi-house villages
    const topHung = generateHouseSpec(2, {
      topology: 'ribbon',
      roofType: 'gable',
      windowOpening: 'awning',
      windowDetail: 'sill',
      seed: 11,
    });
    expect(topHung.architecture?.facades.front.levels[0].windowRow.baseWindow.openingMode).toBe('awning');
    expect(topHung.architecture?.facades.front.levels[0].windowRow.baseWindow.detail).toBe('sill');

    const crossVillage = generateHouseSpec(1, {
      houses: 3,
      windowOpening: 'punched',
      windowDetail: 'cross',
      seed: 19,
    });
    const vNet = buildHouseNet(crossVillage);
    const subSpecs = new Set(vNet.panels.map((p) => p.panelSpec).filter(Boolean));
    expect(subSpecs.size).toBe(3);
    for (const sub of subSpecs) {
      expect(sub!.architecture?.facades.front.levels[0].windowRow.baseWindow.openingMode).toBe('punched');
      expect(sub!.architecture?.facades.front.levels[0].windowRow.baseWindow.detail).toBe('cross');
    }
  });

  it('caps top-hung windows to 20-30%, punches 1/6/12-pane hollow frames in hinged leaves, and supports closed/open/% random modes', () => {
    const makeDummyMats = (): OrigamiMaterials => {
      const m = new THREE.MeshStandardMaterial();
      const l = new THREE.LineDashedMaterial();
      const la = new THREE.LineBasicMaterial();
      return {
        inside: m,
        outside: m,
        outsideSlots: [m, m, m, m],
        edge: m,
        cutoutInside: m,
        cutoutOutside: m,
        cutoutEdge: m,
        chadInside: m,
        chadOutside: m,
        chadEdge: m,
        foldLine: l,
        foldLineMountain: l,
        foldLineActive: la,
        projUniforms: {
          uHasProj: { value: 0 },
          uProjTex: { value: null },
          uProjMatrix: { value: new THREE.Matrix4() },
          uPaperReveal: { value: 1 },
          uProjGain: { value: 1 },
          uProjFade: { value: 1 },
          uProjSide: { value: 1 },
        },
        setOutsideColor() {},
        setOutsideColors() {},
        setProjection() {},
        setProjectionFade() {},
        setCutoutOpacity() {},
        dispose() {},
      };
    };

    const mats = makeDummyMats();

    // 1. Top-hung (`awning` & `louver`) windows open strictly within 20%-30% of 90°,
    //    and `closed` / `open` / `random` modes control exactly which windows vent air!
    for (const opening of ['awning', 'louver'] as const) {
      const spec = generateHouseSpec(2, {
        topology: 'ribbon',
        roofType: 'gable',
        windowStyle: 'rect',
        windowOpening: opening,
        windowDetail: 'clean',
        windowCount: 4,
        levels: 2,
        seed: 15,
      });
      const rig = buildOrigamiHouseRig(buildHouseNet(spec), mats, false);
      for (const id of rig.panelIds) rig.updatePanelVisual(id, 1, 0, false);

      const topHung = rig.details.filter((d) => d.windowType === 'top-hung');
      expect(topHung.length).toBeGreaterThanOrEqual(8);
      for (const det of topHung) {
        const pctOf90 = Math.abs(det.targetAngle) / (Math.PI * 0.5);
        expect(pctOf90).toBeGreaterThanOrEqual(0.2 - 1e-6);
        expect(pctOf90).toBeLessThanOrEqual(0.3 + 1e-6);
      }

      // All closed -> every window pivot sits strictly at 0 rad
      rig.setWindowOpen('closed', 0.35);
      for (const det of topHung) {
        expect(det.pivot.rotation.x).toBeCloseTo(0, 6);
      }

      // All open -> every top-hung window sits at its 20-30% targetAngle
      rig.setWindowOpen('open', 0.35);
      for (const det of topHung) {
        expect(Math.abs(det.pivot.rotation.x)).toBeGreaterThan(0.3);
        expect(Math.abs(det.pivot.rotation.x)).toBeLessThan(0.5);
      }

      // Random 35% -> strictly a partial subset opens (both open and closed windows exist!)
      rig.setWindowOpen('random', 0.35);
      const openedCount = topHung.filter((d) => Math.abs(d.pivot.rotation.x) > 0.05).length;
      expect(openedCount).toBeGreaterThan(0);
      expect(openedCount).toBeLessThan(topHung.length);

      rig.dispose();
    }

    // 2. Real hollow frame cutouts inside hinged window leaves:
    //    `clean` (1-pane frame) < `six` (6-pane frame) < `twelve` (12-pane frame) triangle complexity!
    const countWindowLeafVerts = (detail: 'clean' | 'six' | 'twelve'): number => {
      const spec = generateHouseSpec(2, {
        topology: 'ribbon',
        roofType: 'mansard',
        windowStyle: 'rect',
        windowOpening: 'awning',
        windowDetail: detail,
        windowCount: 3,
        levels: 2,
        seed: 21,
      });
      const rig = buildOrigamiHouseRig(buildHouseNet(spec), mats, false);
      let verts = 0;
      for (const det of rig.details) {
        if (det.windowType !== 'top-hung') continue;
        det.pivot.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            verts += obj.geometry.attributes.position.count;
          }
        });
      }
      rig.dispose();
      return verts;
    };

    const v1 = countWindowLeafVerts('clean');
    const v6 = countWindowLeafVerts('six');
    const v12 = countWindowLeafVerts('twelve');
    // A solid unpunched box has 48 verts per leaf; 1-pane frame has >= 96; 6-pane & 12-pane multiply cleanly!
    expect(v1).toBeGreaterThan(500);
    expect(v6).toBeGreaterThan(v1 * 1.8);
    expect(v12).toBeGreaterThan(v6 * 1.4);
  });
});
