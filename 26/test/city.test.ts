import { describe, expect, it } from 'vitest';
import { buildHouseNet, polygonsOverlap } from '../src/origamiHouseNet';
import { createIslandTerrain, createIslandWorld } from '../src/cityGenerator';

describe('Italian Mountain Island diorama generator (topography, serpentine & hillside roads, dense zero-overlap plots)', () => {
  it('generates a bounded high-topology Italian mountain island with sea (<0), steep cliffs, summit peak, and seed diversity', () => {
    const flat = createIslandTerrain(7, 0);
    expect(flat.terrain.heightAt(0, 0)).toBeGreaterThan(0.5);
    expect(flat.terrain.heightAt(48, 0)).toBeLessThan(0);

    const a = createIslandTerrain(7, 0.72);
    const b = createIslandTerrain(7, 0.72);
    const other = createIslandTerrain(42, 0.72);

    for (const ang of [0, 1.2, 2.5, 3.8, 5.1]) {
      expect(a.terrain.heightAt(Math.cos(ang) * 49, Math.sin(ang) * 49)).toBeLessThan(0);
    }

    const summitW = a.terrain.heightAt(0, -8);
    expect(summitW).toBeGreaterThan(9);
    expect(a.terrain.heightAt(5, -6)).toBeCloseTo(b.terrain.heightAt(5, -6), 6);
    expect(a.terrain.heightAt(5, -6)).not.toBeCloseTo(other.terrain.heightAt(5, -6), 2);
  });

  it('builds a serpentine switchback road plus surrounding hillside contour roads staying strictly on island land', () => {
    for (const seed of [0, 7, 19, 42]) {
      const world = createIslandWorld({ seed, hills: 0.72 });
      const mainRoad = world.roads.find((r) => r.kind === 'serpentine');
      expect(mainRoad).toBeDefined();
      expect(mainRoad!.points.length).toBeGreaterThan(100);
      expect(world.roads.length).toBeGreaterThanOrEqual(5);

      const start = mainRoad!.points[0];
      const end = mainRoad!.points[mainRoad!.points.length - 1];
      expect(start.t).toBeCloseTo(0, 4);
      expect(end.t).toBeCloseTo(1, 4);
      expect(end.y).toBeGreaterThan(start.y + 8);

      for (const r of world.roads) {
        for (const p of r.points) {
          expect(world.terrain.signedInland(p.x, p.z)).toBeGreaterThan(1.5);
          expect(p.y).toBeGreaterThan(0.3);
        }
      }

      const xs = mainRoad!.points.map((p) => p.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(14);
    }
  });

  it('populates ultra-dense stacked hillside houses with 4-6 level palazzi on steep backdrops and valid origami nets', () => {
    const worldA = createIslandWorld({ seed: 7, hills: 0.72 });
    const worldB = createIslandWorld({ seed: 7, hills: 0.72 });
    const worldOther = createIslandWorld({ seed: 99, hills: 0.72 });

    expect(worldA.plots.length).toBe(worldB.plots.length);
    // Ultra-dense stacked village packed between houses across the entire island!
    expect(worldA.plots.length).toBeGreaterThanOrEqual(550);
    expect(worldA.plots[0].x).toBeCloseTo(worldB.plots[0].x, 5);
    expect(worldA.plots[0].x).not.toBeCloseTo(worldOther.plots[0].x, 2);

    // Houses densely packed across all 4 quadrants (front harbor, left cape, right headland, rear ridge!)
    const q1 = worldA.plots.filter((p) => p.x > 4 && p.z > 4).length;
    const q2 = worldA.plots.filter((p) => p.x < -4 && p.z > 4).length;
    const q3 = worldA.plots.filter((p) => p.x < -4 && p.z < -4).length;
    const q4 = worldA.plots.filter((p) => p.x > 4 && p.z < -4).length;
    expect(q1).toBeGreaterThan(60);
    expect(q2).toBeGreaterThan(60);
    expect(q3).toBeGreaterThan(60);
    expect(q4).toBeGreaterThan(60);

    // Abundant 4, 5, and 6-story cliffside palazzi wherever mountain elevation rises behind!
    const l4 = worldA.plots.filter((p) => p.spec.levels === 4).length;
    const l5 = worldA.plots.filter((p) => p.spec.levels === 5).length;
    const l6 = worldA.plots.filter((p) => p.spec.levels === 6).length;
    expect(l4).toBeGreaterThan(50);
    expect(l5).toBeGreaterThan(40);
    expect(l6).toBeGreaterThan(20);

    // Houses backed by steep upslope elevation average substantially more stories than flat-backdrop houses!
    const steepLevels: number[] = [];
    const gentleLevels: number[] = [];
    for (const p of worldA.plots) {
      const bx = p.x - Math.sin(p.yaw) * 5.5;
      const bz = p.z - Math.cos(p.yaw) * 5.5;
      const backRise = worldA.terrain.heightAt(bx, bz) - worldA.terrain.heightAt(p.x, p.z);
      if (backRise > 3.2) steepLevels.push(p.spec.levels);
      else if (backRise < 0.4) gentleLevels.push(p.spec.levels);
    }
    const avgSteep = steepLevels.reduce((a, b) => a + b, 0) / Math.max(1, steepLevels.length);
    const avgGentle = gentleLevels.reduce((a, b) => a + b, 0) / Math.max(1, gentleLevels.length);
    expect(avgSteep).toBeGreaterThan(avgGentle + 0.9);

    // Zero overlapping footprints & every plot grounded on dry cliffs
    for (let i = 0; i < worldA.plots.length; i++) {
      const p = worldA.plots[i];
      expect(p.groundMinY).toBeGreaterThan(0.35);
      expect(p.baseY).toBeGreaterThanOrEqual(p.groundMinY);
      for (let j = i + 1; j < worldA.plots.length; j++) {
        expect(polygonsOverlap(p.footprint, worldA.plots[j].footprint)).toBe(false);
      }
    }

    // Spot-check that 1-3F AND tall 4-6F origami nets have zero flat-net self-overlap
    const samplePlots = [
      ...worldA.plots.slice(0, 8),
      ...worldA.plots.filter((p) => p.spec.levels === 4).slice(0, 4),
      ...worldA.plots.filter((p) => p.spec.levels === 5).slice(0, 4),
      ...worldA.plots.filter((p) => p.spec.levels === 6).slice(0, 4),
    ];
    for (const plot of samplePlots) {
      const net = buildHouseNet(plot.spec);
      expect(plot.spec.architecture?.facades.front.levels.length).toBe(plot.spec.levels);
      for (let a = 0; a < net.panels.length; a++) {
        for (let b = a + 1; b < net.panels.length; b++) {
          expect(polygonsOverlap(net.panels[a].poly, net.panels[b].poly)).toBe(false);
        }
      }
    }
  });
});
