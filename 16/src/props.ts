// Small fungi standing about in the moss, by hash on a grid of cells around you, fully grown: funnel
// chanterelles and finger fungi in clusters. Placed when their cell comes in range, one cell per frame, taken
// away when it falls out. And further out, on a coarser grid, groups of the big ones (fly agarics, now and then
// porcini), so the wood has fungi standing in it a long way back, paler in the haze, as in the splash.
import { mulberry32 } from './noise';
import type { Fungi, FungusKind } from './fungi';
import { clearing, puddleAt } from './world';

// how often each kind stands about in the forest, by weight
const MIX: [FungusKind, number][] = [['funnel', 0.24], ['finger', 0.2], ['chanterelle', 0.18], ['puffball', 0.16], ['agaric', 0.1], ['porcini', 0.12], ['slippery', 0.1], ['morel', 0.06], ['waxcap', 0.1]];
const MIX_SUM = MIX.reduce((a, [, w]) => a + w, 0);
function pickKind(k: number): FungusKind {
  let acc = 0;
  for (const [kind, w] of MIX) { acc += w / MIX_SUM; if (k < acc) return kind; }
  return MIX[MIX.length - 1][0];
}

const CELL = 1.6;
const RANGE = 5; // cells whose centre is this close are placed
const DROP = 7; // and taken away past this
// the groups out in the wood: only the kinds that are models (drawing one costs no building)
const GROUP_CELL = 2.5;
const GROUP_RANGE = matchMedia('(pointer: coarse)').matches ? 8 : 11;
const GROUP_DROP = GROUP_RANGE + 3;

interface Cell { keys: string[] }

function hashCell(ix: number, iz: number, salt: number) {
  return mulberry32((Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ salt) >>> 0);
}

export class Props {
  private cells = new Map<string, Cell>();
  private groups = new Map<string, Cell>();

  constructor(private fungi: Fungi, private foot: (x: number, z: number) => number) {}

  private build(ix: number, iz: number): Cell {
    const keys: string[] = [];
    const r = hashCell(ix, iz, 3);
    const n = r() < 0.6 ? 1 + Math.floor(r() * 2) : 0;
    for (let i = 0; i < n; i++) {
      const k = r();
      const kind = pickKind(k);
      const x = (ix + 0.1 + 0.8 * r()) * CELL, z = (iz + 0.1 + 0.8 * r()) * CELL;
      const seed = Math.floor(r() * 1e9), scale = 0.8 + 0.5 * r();
      if (Math.hypot(x, z) < 0.6) continue; // the start has its own
      const pd = puddleAt(x, z);
      if (pd && pd.u < 1.04) continue; // no fungi underwater
      const key = `${ix},${iz}:${i}`;
      this.fungi.spawn(kind, x, this.foot(x, z), z, { grown: true, key, seed, scale });
      keys.push(key);
    }
    return { keys };
  }

  /** A group of the big ones: two to six fly agarics in two or three clusters a step apart, or porcini. */
  private buildGroup(ix: number, iz: number): Cell {
    const keys: string[] = [];
    const r = hashCell(ix, iz, 9);
    const p = r();
    const kind: FungusKind = r() < 0.85 ? 'agaric' : 'porcini';
    const cx = (ix + 0.2 + 0.6 * r()) * GROUP_CELL, cz = (iz + 0.2 + 0.6 * r()) * GROUP_CELL;
    // in the clearings, mostly: out in the open, where you can see them from down in the moss
    if (p > 0.05 + 0.6 * clearing(cx, cz)) return { keys };
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, d = i === 0 ? 0 : 0.25 + 0.45 * r();
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (Math.hypot(x, z) < 2) continue; // not on top of the start
      const pd = puddleAt(x, z);
      if (pd && pd.u < 1.04) continue;
      const key = `g${ix},${iz}:${i}`;
      // giants, as in the splash: from down in the moss they stand over the ferns, caps a hand to half a metre
      // across (a fairy tale's, not a field guide's)
      this.fungi.spawn(kind, x, this.foot(x, z), z, { grown: true, key, seed: Math.floor(r() * 1e9), scale: (kind === 'agaric' ? 2.2 : 1.6) * (0.8 + 0.7 * r() * r()) + (i === 0 ? 0.6 : 0) });
      keys.push(key);
    }
    return { keys };
  }

  private drop(c: Cell) {
    for (const k of c.keys) {
      const f = this.fungi.list.find((q) => q.key === k);
      if (f) this.fungi.remove(f);
    }
  }

  /** Place the cells coming into range (one per call), take away the ones gone out. True if anything changed. */
  update(px: number, pz: number) {
    this.updateGroups(px, pz);
    const i0 = Math.floor(px / CELL), k0 = Math.floor(pz / CELL);
    const R = Math.ceil(RANGE / CELL);
    let changed = false;
    for (let dz = -R; dz <= R && !changed; dz++) for (let dx = -R; dx <= R && !changed; dx++) {
      const ix = i0 + dx, iz = k0 + dz;
      if (Math.hypot((ix + 0.5) * CELL - px, (iz + 0.5) * CELL - pz) > RANGE) continue;
      const key = `${ix},${iz}`;
      if (this.cells.has(key)) continue;
      this.cells.set(key, this.build(ix, iz));
      changed = true;
    }
    for (const [key, c] of this.cells) {
      const [ix, iz] = key.split(',').map(Number);
      if (Math.hypot((ix + 0.5) * CELL - px, (iz + 0.5) * CELL - pz) < DROP) continue;
      this.drop(c);
      this.cells.delete(key);
      changed = true;
    }
    return changed;
  }

  private updateGroups(px: number, pz: number) {
    const i0 = Math.floor(px / GROUP_CELL), k0 = Math.floor(pz / GROUP_CELL);
    const R = Math.ceil(GROUP_RANGE / GROUP_CELL);
    let placed = false;
    for (let dz = -R; dz <= R && !placed; dz++) for (let dx = -R; dx <= R && !placed; dx++) {
      const ix = i0 + dx, iz = k0 + dz;
      if (Math.hypot((ix + 0.5) * GROUP_CELL - px, (iz + 0.5) * GROUP_CELL - pz) > GROUP_RANGE) continue;
      const key = `${ix},${iz}`;
      if (this.groups.has(key)) continue;
      this.groups.set(key, this.buildGroup(ix, iz));
      placed = true;
    }
    for (const [key, c] of this.groups) {
      const [ix, iz] = key.split(',').map(Number);
      if (Math.hypot((ix + 0.5) * GROUP_CELL - px, (iz + 0.5) * GROUP_CELL - pz) < GROUP_DROP) continue;
      this.drop(c);
      this.groups.delete(key);
    }
  }
}
