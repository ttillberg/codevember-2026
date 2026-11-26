import { describe, expect, it } from 'vitest';
import { buildHouseNet, polygonsOverlap } from '../src/origamiHouseNet';
import {
  ALL_CITY_STREET_STYLES,
  createCoastalWorld,
  createTerrainField,
} from '../src/cityGenerator';
import { evaluateFoldWave } from '../src/cityView';

describe('Infinite Coastal Paper City generator (deterministic chunks, sea, topologies, LOD & curved flight)', () => {
  it('generates a continuous infinite coastal elevation field with sea (<0), quay (>0), hills, and seed diversity', () => {
    const flat = createTerrainField(7, 0);
    const coast0 = flat.coastX(0);
    expect(flat.heightAt(coast0 - 15, 0)).toBeLessThan(0);
    expect(flat.heightAt(coast0 + 8, 0)).toBeGreaterThan(0.5);
    expect(flat.heightAt(coast0 + 8, 0)).toBeLessThan(1.0);

    const hillyA = createTerrainField(7, 0.75);
    const hillyB = createTerrainField(7, 0.75);
    const hillyOther = createTerrainField(42, 0.75);

    // Deterministic & continuous far down the infinite coastline
    for (const z of [0, -120, -480, 260]) {
      const cA = hillyA.coastX(z);
      expect(cA).toBeCloseTo(hillyB.coastX(z), 6);
      expect(hillyA.heightAt(cA - 6, z)).toBeLessThan(0);
      expect(hillyA.heightAt(cA + 35, z)).toBeGreaterThan(1.5);
      expect(hillyA.heightAt(cA + 35, z)).toBeCloseTo(hillyB.heightAt(cA + 35, z), 6);
    }
    expect(hillyA.coastX(-120)).not.toBeCloseTo(hillyOther.coastX(-120), 2);
  });

  it('generates deterministic, zero-overlap building plots across chunks and street topologies with zero wet buildings', () => {
    for (const style of ALL_CITY_STREET_STYLES) {
      const worldA = createCoastalWorld({ seed: 12, style, hills: 0.6 });
      const worldB = createCoastalWorld({ seed: 12, style, hills: 0.6 });
      const worldOther = createCoastalWorld({ seed: 99, style, hills: 0.6 });

      // Generate a 2x2 coastal block of chunks around the shoreline at z = -88..0
      const coastMidX = worldA.terrain.coastX(-44);
      const cxBase = Math.floor((coastMidX + 12) / 44);
      const chunksA = [
        worldA.generateChunk(cxBase, -2),
        worldA.generateChunk(cxBase + 1, -2),
        worldA.generateChunk(cxBase, -1),
        worldA.generateChunk(cxBase + 1, -1),
      ];
      const chunksB = [
        worldB.generateChunk(cxBase, -2),
        worldB.generateChunk(cxBase + 1, -2),
        worldB.generateChunk(cxBase, -1),
        worldB.generateChunk(cxBase + 1, -1),
      ];
      const otherChunk = worldOther.generateChunk(cxBase, -1);

      const allPlotsA = chunksA.flatMap((c) => c.plots);
      const allPlotsB = chunksB.flatMap((c) => c.plots);

      expect(allPlotsA.length).toBe(allPlotsB.length);
      expect(allPlotsA.length).toBeGreaterThanOrEqual(18);
      expect(allPlotsA[0].x).toBeCloseTo(allPlotsB[0].x, 5);
      expect(allPlotsA[0].spec.roofType).toBe(allPlotsB[0].spec.roofType);
      if (otherChunk.plots.length > 0 && chunksA[2].plots.length > 0) {
        expect(chunksA[2].plots[0].x).not.toBeCloseTo(otherChunk.plots[0].x, 2);
      }

      // Zero overlapping footprints BOTH intra-chunk AND across adjacent chunk borders!
      for (let i = 0; i < allPlotsA.length; i++) {
        const p = allPlotsA[i];
        expect(p.groundMinY).toBeGreaterThan(0.15);
        expect(p.baseY).toBeGreaterThanOrEqual(p.groundMinY);
        expect(p.wings.length).toBeGreaterThanOrEqual(1);
        for (let j = i + 1; j < allPlotsA.length; j++) {
          expect(polygonsOverlap(p.footprint, allPlotsA[j].footprint)).toBe(false);
        }
      }

      // Spot-check that LOD0 origami nets fold with zero flat-net self-overlap
      for (const plot of allPlotsA.slice(0, 6)) {
        const net = buildHouseNet(plot.spec);
        for (let a = 0; a < net.panels.length; a++) {
          for (let b = a + 1; b < net.panels.length; b++) {
            expect(polygonsOverlap(net.panels[a].poly, net.panels[b].poly)).toBe(false);
          }
        }
      }
    }
  });

  it('produces a deterministic curved coastal flight spline and monotonic flyover fold wave', () => {
    const worldA = createCoastalWorld({ seed: 5, style: 'mix', hills: 0.55 });
    const worldB = createCoastalWorld({ seed: 5, style: 'mix', hills: 0.55 });

    const s0 = worldA.sampleFlight(0);
    const s1 = worldA.sampleFlight(90);
    const s2 = worldA.sampleFlight(240);
    const s1Repeat = worldB.sampleFlight(90);

    expect(s1.pos[0]).toBeCloseTo(s1Repeat.pos[0], 5);
    expect(s1.bankRoll).toBeCloseTo(s1Repeat.bankRoll, 5);

    // Advances along -Z and genuinely curves in X with non-zero banking!
    expect(s1.pos[2]).toBeLessThan(s0.pos[2]);
    expect(s2.pos[2]).toBeLessThan(s1.pos[2]);
    const xs = [0, 30, 60, 90, 120, 150, 180, 210].map((s) => worldA.sampleFlight(s).pos[0]);
    const xSpan = Math.max(...xs) - Math.min(...xs);
    expect(xSpan).toBeGreaterThan(18);
    // Safely above terrain & sea everywhere
    for (let s = 0; s <= 400; s += 25) {
      const f = worldA.sampleFlight(s);
      const ground = Math.max(0, worldA.terrain.heightAt(f.pos[0], f.pos[2]));
      expect(f.pos[1]).toBeGreaterThan(ground + 10);
    }

    // Fold wave monotonically sweeps from 1 (behind/near) -> mid-fold -> 0 (far ahead)
    const fBehind = evaluateFoldWave(0, 10, 0, 0, -40, 'wave');
    const fMid = evaluateFoldWave(0, -90, 0, 0, -40, 'wave');
    const fFar = evaluateFoldWave(0, -180, 0, 0, -40, 'wave');
    expect(fBehind).toBe(1);
    expect(fMid).toBeGreaterThan(0.05);
    expect(fMid).toBeLessThan(0.95);
    expect(fFar).toBe(0);
    expect(evaluateFoldWave(0, -180, 0, 0, -40, 'folded')).toBe(1);
    expect(evaluateFoldWave(0, 10, 0, 0, -40, 'flat')).toBe(0);
  });
});
