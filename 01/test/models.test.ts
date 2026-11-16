import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { overlaps, outline, sheetOf, isFold } from '../src/net';
import { checkGlue, foldMatrices } from '../src/fold';
import { makePaper } from '../src/paper';
import { makeBorders } from '../src/cut';
import { makeFolding } from '../src/folding';
import { sheetSvg } from '../src/art';
import { MODELS, foldOrder } from '../src/models';

// Every card on the mat: a net that lies flat, closes, cuts in one line and folds up.
describe.each(MODELS.map((m) => [m.id, m] as const))('%s', (_, model) => {
  const net = model.net;

  it('lies flat on the sheet: no two pieces overlap', () => {
    expect(overlaps(net)).toEqual([]);
  });

  it('closes: every tab, fully folded, lies flat inside the panel it glues to', () => {
    expect(checkGlue(net)).toEqual([]);
  });

  it('has one cut line as long as all the cut edges', () => {
    const loop = outline(net);
    const around = loop.reduce((s, a, i) => {
      const b = loop[(i + 1) % loop.length];
      return s + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }, 0);
    let cuts = 0;
    for (const p of net.panels) for (let i = 0; i < p.poly.length; i++) {
      const a = p.poly[i];
      const b = p.poly[(i + 1) % p.poly.length];
      if (!isFold(net, p, a, b)) cuts += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    expect(around).toBeCloseTo(cuts, 6);
    expect(makeBorders(net).borders.length).toBeGreaterThan(0);
  });

  it('has one base, every other panel on a hinge, every tab glued to a panel that exists', () => {
    const ids = new Set(net.panels.map((p) => p.id));
    expect(ids.size).toBe(net.panels.length);
    expect(net.panels.filter((p) => !p.parent)).toHaveLength(1);
    for (const p of net.panels) {
      if (p.parent) expect(ids.has(p.parent), p.id).toBe(true);
      if (p.kind === 'tab') expect(ids.has(p.glue!), p.id).toBe(true);
    }
  });

  it('stands on its base when folded: nothing below it', () => {
    const mats = foldMatrices(net);
    // the base is z = 0 and the walls go to -z
    let low = Infinity;
    for (const p of net.panels) for (const [x, y] of p.poly) low = Math.min(low, -new THREE.Vector3(x, y, 0).applyMatrix4(mats.get(p.id)!).z);
    expect(low).toBeGreaterThan(-1e-6);
  });

  it('prints', () => {
    const { svg } = sheetSvg(net, model.art, sheetOf(net), 1);
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('undefined');
  });

  it('folds up: shut every panel, the tabs tuck in after them, it is built; nothing pinned while flat', () => {
    const tex = new THREE.Texture();
    const paper = makePaper(net, sheetOf(net), outline(net), tex, tex);
    const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 1, 4000);
    const view = { ndc: () => new THREE.Vector2(), screen: () => new THREE.Vector2() };
    const folding = makeFolding(net, paper, camera, view, () => {}, () => false, () => {});
    const settle = () => { for (let i = 0; i < 400; i++) folding.update(1 / 60); paper.root.updateMatrixWorld(true); };
    settle();
    expect(net.panels.filter((p) => folding.covered(p.id)).map((p) => p.id)).toEqual([]);
    for (const id of foldOrder(net)) if (!id.startsWith('tab')) folding.shut(id);
    settle();
    expect(folding.allShut()).toBe(true);
    // built, the tabs are held behind their panels
    for (const p of net.panels) if (p.kind === 'tab') expect(folding.covered(p.id), p.id).toBe(true);
  });
});
