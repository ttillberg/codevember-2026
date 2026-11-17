import type { Saved } from './game';
import type { Placed } from './hud';
import { modelById } from './models';
import type { Net } from './net';

// The saved record's shape, its version, and the steps that walk an older one up to now. Kept
// apart from the storage itself so it can be tried on old records without a browser. Bump
// VERSION and add a step whenever the shape changes.
//
// A sheet's save also carries its net's signature: when a building's net changes (a model
// rebuilt), its half-done sheet no longer fits and is dropped; what stands on the board only
// needs the model to still exist.

export const VERSION = 1;

interface Kept { sig: string; card: Saved }
export interface Store {
  v: number;
  at: string | null; // the sheet on the mat, 'board', or null: picking
  town: Placed[];
  cards: Record<string, Kept>;
}

export const fresh = (): Store => ({ v: VERSION, at: null, town: [], cards: {} });

// each step takes a record of version n to n + 1
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const migrations: ((s: any) => any)[] = [
  // 0 → 1: before there was a record the board alone was kept, under a key of its own (read
  // into `town` before this step)
  (s) => {
    const town = Array.isArray(s.town) ? s.town : [];
    return { v: 1, at: town.length ? 'board' : null, town, cards: {} };
  },
];

// a net's signature: its panels, their outlines and folds, hashed
const sigs = new Map<Net, string>();
export function signature(net: Net) {
  let s = sigs.get(net);
  if (!s) {
    const text = net.panels.map((p) => `${p.id}:${p.parent}:${p.fold.toFixed(3)}:${p.poly.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(';')}`).join('|');
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    s = h.toString(36);
    sigs.set(net, s);
  }
  return s;
}

// walk an old record up to now, keep only what still fits
export function upgrade(raw: unknown): Store {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let s: any = raw && typeof raw === 'object' && typeof (raw as Store).v === 'number' ? raw : { v: 0 };
  if (s.v > VERSION) return fresh(); // from a newer build: start over rather than misread it
  while (s.v < VERSION) s = migrations[s.v](s);
  const town = (Array.isArray(s.town) ? s.town : []).filter((p: Placed) => p && modelById(p.id));
  const cards: Record<string, Kept> = {};
  for (const [id, k] of Object.entries((s.cards ?? {}) as Record<string, Kept>)) {
    const m = modelById(id);
    if (m && k?.sig === signature(m.net) && k.card?.model === id) cards[id] = k;
  }
  const at = s.at === 'board' || modelById(s.at) ? s.at : null;
  return { v: VERSION, at, town, cards };
}
