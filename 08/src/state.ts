// Shared mutable state between the scene and the page. Read every frame, no React in the loop.
//
// One crank, one plane: the machine turns in XW only. Composing turns in two planes can point an edge straight at the
// eye, and a strut would have to shrink to nothing. In one plane the shortest strut is 0.73, the longest 3.03.
export const st = {
  angle: 0.3, // XW, radians
  spin: true,
  crank: 0, // held key, -1 0 1
  shift: false, // shift held: drag cranks instead of orbiting
  turntable: true, // slow turn of the whole object in 3D, so it is seen from all sides
  /** Longest and shortest strut right now, for the readout. */
  lengths: { min: 0, max: 0 },
};

export const SPIN = 0.22; // rad/s
export const CRANK = 1.3; // rad/s with a key held
export const TURNTABLE = 0.08; // rad/s
