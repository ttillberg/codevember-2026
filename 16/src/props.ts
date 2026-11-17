// Small fungi standing about in the moss, by hash on a grid of cells around you, fully grown: funnel
// chanterelles and finger fungi in clusters. Placed when their cell comes in range, one cell per frame, taken
// away when it falls out.
import { mulberry32 } from './noise';
import type { Fungi, FungusKind } from './fungi';

const CELL = 1.6;
const RANGE = 5; // cells whose centre is this close are placed
const DROP = 7; // and taken away past this

interface Cell { keys: string[] }

function hashCell(ix: number, iz: number, salt: number) {
  return mulberry32((Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ salt) >>> 0);
}

export class Props {
  private cells = new Map<string, Cell>();

  constructor(private fungi: Fungi, private foot: (x: number, z: number) => number) {}

  private build(ix: number, iz: number): Cell {
    const keys: string[] = [];
    const r = hashCell(ix, iz, 3);
    const n = r() < 0.6 ? 1 + Math.floor(r() * 2) : 0;
    for (let i = 0; i < n; i++) {
      const k = r();
      const kind: FungusKind = k < 0.3 ? 'funnel' : k < 0.55 ? 'finger' : k < 0.8 ? 'chanterelle' : 'puffball';
      const x = (ix + 0.1 + 0.8 * r()) * CELL, z = (iz + 0.1 + 0.8 * r()) * CELL;
      const seed = Math.floor(r() * 1e9), scale = 0.8 + 0.5 * r();
      if (Math.hypot(x, z) < 0.6) continue; // the start has its own
      const key = `${ix},${iz}:${i}`;
      this.fungi.spawn(kind, x, this.foot(x, z), z, { grown: true, key, seed, scale });
      keys.push(key);
    }
    return { keys };
  }

  /** Place the cells coming into range (one per call), take away the ones gone out. True if anything changed. */
  update(px: number, pz: number) {
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
      for (const k of c.keys) {
        const f = this.fungi.list.find((q) => q.key === k);
        if (f) this.fungi.remove(f);
      }
      this.cells.delete(key);
      changed = true;
    }
    return changed;
  }
}
