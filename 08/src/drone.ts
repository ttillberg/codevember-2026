import type { V4 } from './tesseract';

// The drone as the drone sees itself: the state the cell camera reads.
//
// Inside its cell the drone lives in a plain cube. Cell space is an affine map c = A p + b from 4D to 3D: each row
// takes one of the cell's three free axes. Through a face the neighbouring cell continues straight on, as in a net,
// so when the drone crosses a face the row that mapped the face's axis is remade to map the axis that was held,
// pointing inward, and shifted by two cells. The camera keeps looking the way it was going; nothing jumps.
export const drone = {
  p: [0, 0, 0, 0] as V4,
  held: 0, // the coordinate held at ±1 in the current cell
  sign: 1,
  A: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] as number[][],
  b: [0, 0, 0],
  axisOf: [1, 2, 3], // the 4D axis each cell-space row runs along
  centre: [0, 0, 0], // the current cell's centre in cell space
  crossings: 0,
  /** The corner camera: the drone's own eyes, or a chase camera behind it. A click on the frame swaps. */
  view: 'pov' as 'pov' | 'follow',
};

/** Start in the cell with `held` at `sign`: rows are the free axes in order. */
export function startCell(held: number, sign: number) {
  drone.held = held; drone.sign = sign;
  drone.axisOf = [0, 1, 2, 3].filter((a) => a !== held);
  drone.A = drone.axisOf.map((a) => [0, 1, 2, 3].map((i) => (i === a ? 1 : 0)));
  drone.b = [0, 0, 0];
  drone.centre = [0, 0, 0];
}

/** Cross the face on axis `f` at side `t`: the new cell holds f, and frees the axis that was held. */
export function crossInto(f: number, t: number) {
  const k = drone.axisOf.indexOf(f);
  const old = drone.held, s = drone.sign;
  drone.A[k] = [0, 1, 2, 3].map((i) => (i === old ? -t * s : 0));
  drone.b[k] += 2 * t;
  drone.centre[k] += 2 * t;
  drone.axisOf[k] = old;
  drone.held = f; drone.sign = t;
  drone.crossings++;
}

/** Where a 4D point is in cell space. */
export function toCell(p: V4, out: number[] = [0, 0, 0]): number[] {
  for (let k = 0; k < 3; k++) out[k] = drone.A[k][0] * p[0] + drone.A[k][1] * p[1] + drone.A[k][2] * p[2] + drone.A[k][3] * p[3] + drone.b[k];
  return out;
}
