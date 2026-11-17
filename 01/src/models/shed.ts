import { DEG, rect, type Net, type Panel, type V2 } from '../net';
import { tabOff } from './model';

// A box under a single slope (flat when front and back are as high): walls in a strip front |
// right | back | left, the base under the front, the roof off the back wall's top, tabs along
// every wall top to hold it from under. Bo01's net, any size.

export function makeShed(W: number, D: number, HF: number, HB: number, T = 7): Net {
  const L = Math.hypot(D, HB - HF);
  const slope = Math.atan2(HB - HF, D) * DEG;
  const xR = W, xB = W + D, xL = 2 * W + D, xE = 2 * W + 2 * D;
  const panels: Panel[] = [];
  const add = (p: Omit<Panel, 'origin'>) => panels.push({ origin: p.poly[0], ...p });

  const base = { poly: rect(0, -D, W, D) };
  const front = { poly: rect(0, 0, W, HF) };
  const right = { poly: [[xR, 0], [xR + D, 0], [xR + D, HB], [xR, HF]] as V2[] };
  const left = { poly: [[xL, 0], [xL + D, 0], [xL + D, HF], [xL, HB]] as V2[] };
  add({ id: 'base', kind: 'base', face: 'base', poly: base.poly, parent: null, hinge: null, fold: 0 });
  add({ id: 'front', kind: 'wall', face: 'front', poly: front.poly, parent: 'base', hinge: [[0, 0], [W, 0]], fold: 90 });
  add({ id: 'right', kind: 'wall', face: 'side', poly: right.poly, parent: 'front', hinge: [[xR, 0], [xR, HF]], fold: 90 });
  add({ id: 'back', kind: 'wall', face: 'back', poly: rect(xB, 0, W, HB), parent: 'right', hinge: [[xB, 0], [xB, HB]], fold: 90 });
  add({ id: 'left', kind: 'wall', face: 'side', poly: left.poly, parent: 'back', hinge: [[xL, 0], [xL, HB]], fold: 90 });
  add({ id: 'roof', kind: 'roof', face: 'roof', poly: rect(xB, HB, W, L), parent: 'back', hinge: [[xB, HB], [xB + W, HB]], fold: 90 + slope });

  add({ id: 'tab-base-left', kind: 'tab', face: 'tab', poly: tabOff(base, [0, 0], [0, -D], T), parent: 'base', hinge: [[0, 0], [0, -D]], fold: 90, glue: 'left' });
  add({ id: 'tab-base-back', kind: 'tab', face: 'tab', poly: tabOff(base, [0, -D], [W, -D], T), parent: 'base', hinge: [[0, -D], [W, -D]], fold: 90, glue: 'back' });
  add({ id: 'tab-base-right', kind: 'tab', face: 'tab', poly: tabOff(base, [W, -D], [W, 0], T), parent: 'base', hinge: [[W, -D], [W, 0]], fold: 90, glue: 'right' });
  add({ id: 'tab-seam', kind: 'tab', face: 'tab', poly: tabOff(left, [xE, 0], [xE, HF], T), parent: 'left', hinge: [[xE, 0], [xE, HF]], fold: 90, glue: 'front' });
  add({ id: 'tab-eave', kind: 'tab', face: 'tab', poly: tabOff(front, [0, HF], [W, HF], T, 40, 40), parent: 'front', hinge: [[0, HF], [W, HF]], fold: 90 - slope, glue: 'roof' });
  add({ id: 'tab-right', kind: 'tab', face: 'tab', poly: tabOff(right, [xR, HF], [xR + D, HB], T, 40, 40), parent: 'right', hinge: [[xR, HF], [xR + D, HB]], fold: 90, glue: 'roof' });
  add({ id: 'tab-left', kind: 'tab', face: 'tab', poly: tabOff(left, [xL, HB], [xE, HF], T, 40, 40), parent: 'left', hinge: [[xL, HB], [xE, HF]], fold: 90, glue: 'roof' });
  return { panels };
}
