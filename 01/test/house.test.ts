import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { makeHouse, overlaps, outline, sheetOf, isFold } from '../src/net';
import { checkGlue } from '../src/fold';
import { makePaper } from '../src/paper';
import { makeBorders } from '../src/cut';
import { makeFolding } from '../src/folding';

const house = makeHouse();
const BIG = ['front', 'right', 'back', 'left', 'roof1', 'roof2'];
const TABS = house.panels.filter((p) => p.kind === 'tab').map((p) => p.id);

describe('the net', () => {
  it('lies flat on the sheet: no two pieces overlap', () => {
    expect(overlaps(house)).toEqual([]);
  });

  it('closes: every tab, fully folded, lies flat inside the panel it glues to', () => {
    expect(checkGlue(house)).toEqual([]);
  });

  it('has one cut line, a closed loop as long as all the cut edges', () => {
    const loop = outline(house);
    let perimeter = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    let cuts = 0;
    for (const p of house.panels) for (let i = 0; i < p.poly.length; i++) {
      const a = p.poly[i];
      const b = p.poly[(i + 1) % p.poly.length];
      if (!isFold(house, p, a, b)) cuts += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    expect(perimeter).toBeCloseTo(cuts, 6);
  });

  it('every panel but the base hangs on a hinge, every tab glues to something', () => {
    for (const p of house.panels) {
      if (p.kind === 'base') expect(p.parent).toBeNull();
      else expect(p.hinge).not.toBeNull();
      if (p.kind === 'tab') expect(p.glue).toBeTruthy();
    }
  });
});

describe('the borders', () => {
  it('split the cut line into 16, each a stretch of one panel', () => {
    const { borders } = makeBorders(house);
    expect(borders).toHaveLength(16);
    const total = borders.flatMap((b) => b.runs).reduce((s, r) => s + r.len, 0);
    const loop = outline(house);
    const perimeter = loop.reduce((s, a, i) => {
      const b = loop[(i + 1) % loop.length];
      return s + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }, 0);
    expect(total).toBeCloseTo(perimeter, 6);
  });
});

// folding without a screen: a camera that is never used to pick, a view that maps nothing
function fold() {
  const sheet = sheetOf(house);
  const tex = new THREE.Texture();
  const paper = makePaper(house, sheet, outline(house), tex, tex);
  const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 1, 4000);
  const view = { ndc: () => new THREE.Vector2(), screen: () => new THREE.Vector2() };
  const pinned: [string, string][] = [];
  const folding = makeFolding(house, paper, camera, view, () => {}, () => false, () => {}, (id, stuck) => pinned.push([id, stuck]));
  const settle = () => {
    for (let i = 0; i < 400; i++) folding.update(1 / 60);
    paper.root.updateMatrixWorld(true);
  };
  return { paper, folding, settle, pinned };
}

describe('folding', () => {
  let f: ReturnType<typeof fold>;
  beforeEach(() => { f = fold(); });

  it('nothing is pinned while it lies flat', () => {
    f.settle();
    expect(house.panels.filter((p) => f.folding.covered(p.id))).toEqual([]);
  });

  it('folding the six big panels tucks every tab in and builds the house', () => {
    for (const id of BIG) f.folding.shut(id);
    f.settle();
    for (const id of TABS) expect(f.folding.amount(id)).toBeCloseTo(1, 2);
    expect(f.folding.allShut()).toBe(true);
  });

  it('a tab comes back out when its panel opens', () => {
    for (const id of BIG) f.folding.shut(id);
    f.settle();
    f.folding.toggle('roof2');
    f.settle();
    for (const t of ['tab-eave', 'tab-front-l', 'tab-back-r']) expect(f.folding.amount(t)).toBeCloseTo(0, 2);
    expect(f.folding.amount('tab-front-r')).toBeCloseTo(1, 2); // under roof1, still shut
  });

  describe('pinning, built', () => {
    beforeEach(() => {
      for (const id of BIG) f.folding.shut(id);
      f.settle();
    });

    it('every tab is pinned behind its panel', () => {
      for (const id of TABS) expect(f.folding.covered(id), id).toBe(true);
    });

    it('the roofs, the front and the right wall open', () => {
      for (const id of ['roof1', 'roof2', 'front', 'right']) expect(f.folding.covered(id), id).toBe(false);
    });

    it('the left wall is pinned by its eave tab under the roof, not by the seam tab that slides out', () => {
      expect(f.folding.pinnedBy('left')).toEqual({ stuck: 'tab-eave', into: 'roof2' });
      f.folding.toggle('roof2');
      f.settle();
      expect(f.folding.covered('left')).toBe(false);
    });

    it('a pinned seam only gives and springs back', () => {
      f.folding.nudge('tab-seam');
      for (let i = 0; i < 4; i++) f.folding.update(1 / 60);
      expect(f.folding.amount('tab-seam')).toBeLessThan(1);
      f.settle();
      expect(f.folding.amount('tab-seam')).toBeCloseTo(1, 2);
      expect(f.pinned[0]).toEqual(['tab-seam', 'tab-seam']);
    });
  });

  it('restore takes every hinge back where it was headed', () => {
    const before = f.folding.targets();
    for (const id of BIG) f.folding.shut(id);
    f.settle();
    f.folding.restore(before);
    f.settle();
    for (const p of house.panels) expect(f.folding.amount(p.id), p.id).toBeCloseTo(0, 2);
  });
});
