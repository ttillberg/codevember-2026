// Pieces: the connected regions of film, found by relabelling the id atlas (filmops.ts).

import { Vector3 } from 'three';
import type { Piece, World } from './state';
import type { Labels } from './filmops';

export function newPiece(id: number): Piece {
  return { id, centroid: new Vector3(0, 0, 1), area: 0 };
}

/** One whole film, id 1, as createFilm() makes it. */
export function initPieces(world: World): void {
  world.pieces.clear();
  const p = newPiece(1);
  p.area = 1;
  world.pieces.set(1, p);
}

/** Bring world.pieces in line with a relabel. A piece that is the largest part of what it
 *  was keeps its Piece object and id; other parts are new pieces. */
export function syncPieces(world: World, L: Labels): void {
  const old = new Map(world.pieces);
  world.pieces.clear();
  for (let c = 0; c < L.n; c++) {
    const id = L.id[c];
    const parent = old.get(L.old[c]);
    const pc = parent !== undefined && id === parent.id ? parent : newPiece(id);
    pc.area = L.area[c];
    const cx = L.centroid[c * 3], cy = L.centroid[c * 3 + 1], cz = L.centroid[c * 3 + 2];
    if (cx * cx + cy * cy + cz * cz > 0.5) pc.centroid.set(cx, cy, cz);
    world.pieces.set(id, pc);
  }
}
