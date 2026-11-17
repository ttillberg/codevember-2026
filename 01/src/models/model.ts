import type { Art } from '../art';
import { centroid } from '../fold';
import { tab, type Net, type Panel, type V2 } from '../net';

// A building to cut out: its net, what is printed on it, a name for the card.
export interface Model {
  id: string;
  name: string;
  where: string;
  net: Net;
  art: Art;
  backArt?: Art;
}

// the order a scripted fold-up goes in: tabs first, then the rest from the base out
export function foldOrder(net: Net) {
  const rest = net.panels.filter((p) => p.parent);
  return [...rest.filter((p) => p.kind === 'tab'), ...rest.filter((p) => p.kind !== 'tab')].map((p) => p.id);
}

// a glue tab on edge a-b of a panel, on the side away from the panel, whichever way the edge runs
export function tabOff(panel: Pick<Panel, 'poly'>, a: V2, b: V2, depth: number, ta = 45, tb = 45): V2[] {
  const [cx, cy] = centroid(panel.poly);
  // tab() puts it on the right of a→b: the panel must be on the left
  const left = (b[0] - a[0]) * (cy - a[1]) - (b[1] - a[1]) * (cx - a[0]) > 0;
  return left ? tab(a, b, depth, ta, tb) : tab(b, a, depth, tb, ta);
}
