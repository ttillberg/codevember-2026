import { describe, expect, it } from 'vitest';
import { buildHouseNet, polygonsOverlap } from '../src/origamiHouseNet';
import {
  ALL_CITY_STREET_STYLES,
  createTerrainField,
  generateCityLayout,
} from '../src/cityGenerator';

describe('Paper City generator (topography, randomized streets & zero-overlap building plots)', () => {
  it('generates smooth non-negative paper terrain that fades seamlessly to y=0 at the studio rim', () => {
    const flat = createTerrainField(7, 0);
    expect(flat.heightAt(0, 0)).toBe(0);
    expect(flat.heightAt(12, -8)).toBe(0);

    const hilly = createTerrainField(7, 0.75);
    let maxH = 0;
    for (let x = -34; x <= 34; x += 4) {
      for (let z = -34; z <= 34; z += 4) {
        const h = hilly.heightAt(x, z);
        expect(h).toBeGreaterThanOrEqual(0);
        if (h > maxH) maxH = h;
      }
    }
    expect(maxH).toBeGreaterThan(2.5);
    // Seamless outer fade back to infinite studio paper
    expect(hilly.heightAt(60, 0)).toBe(0);
    expect(hilly.heightAt(0, -60)).toBe(0);
  });

  it('generates deterministic, zero-overlap building plots across organic, grid, and radial street styles', () => {
    for (const style of ALL_CITY_STREET_STYLES) {
      const cityA = generateCityLayout({ seed: 12, style, hills: 0.6 });
      const cityB = generateCityLayout({ seed: 12, style, hills: 0.6 });
      const cityOther = generateCityLayout({ seed: 99, style, hills: 0.6 });

      // Deterministic repeatability & seed diversity
      expect(cityA.plots.length).toBe(cityB.plots.length);
      expect(cityA.streets.length).toBe(cityB.streets.length);
      expect(cityA.plots.length).toBeGreaterThanOrEqual(16);
      expect(cityA.rooftopCount).toBeGreaterThanOrEqual(cityA.plots.length);
      expect(cityA.contours.length).toBeGreaterThan(20);
      expect(cityA.plots[0].x).toBeCloseTo(cityB.plots[0].x, 5);
      expect(cityA.plots[0].x).not.toBeCloseTo(cityOther.plots[0].x, 2);

      // Zero overlapping building footprints!
      for (let i = 0; i < cityA.plots.length; i++) {
        const p = cityA.plots[i];
        expect(p.baseY).toBeGreaterThanOrEqual(p.groundMinY);
        for (let j = i + 1; j < cityA.plots.length; j++) {
          expect(polygonsOverlap(p.footprint, cityA.plots[j].footprint)).toBe(false);
        }
      }

      // Spot-check that every placed building folds from a valid non-overlapping flat net
      for (const plot of cityA.plots.slice(0, 8)) {
        const net = buildHouseNet(plot.spec);
        for (let a = 0; a < net.panels.length; a++) {
          for (let b = a + 1; b < net.panels.length; b++) {
            expect(polygonsOverlap(net.panels[a].poly, net.panels[b].poly)).toBe(false);
          }
        }
      }
    }
  });
});
