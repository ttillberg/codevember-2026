// The peel: film as a sheet of particles (lattice and atlas in lift.ts).
//
// A particle is stuck to the sphere until the sheet pulling on it asks for too much, then
// it is loose for good. Particles are linked to their neighbours where the film between
// them is whole (read from the film atlas, so cuts and peeled edges are free edges by
// themselves), and each has a tether to the finger as long as the film from the grab to it.
// A stuck particle lets go when a loose one is linked to it and its own tether would be
// overdrawn by more than the adhesion (release). The pull is shared: the more particles sit
// on the front, the more each one needs. Where the loose ones are drawn is a separate
// matter and only for the eye: a film pulled taut between the front and the hand (sheet).
//
// So the front is not a line that is put somewhere. It is wherever the sheet has let go:
// round the finger, wider where it is free, hung on the ends of cuts.

import { Quaternion, Vector3 } from 'three';
import { FILM_N, dirToFace, faceToDir } from './film';
import { FAN_MAX, LIFT_M, CELL, liftIndex, liftRead } from './lift';
import { TEXEL, coveredOver, eraseFlood, idAt, texelAt } from './filmops';
import { R } from './state';
import type { World } from './state';

/** How the film behaves in the hand. Live: the sliders write here, a film's own stretch
 *  and cling are copied in when it is chosen. */
export const tune = {
  /** How far the sheet stretches before it passes the pull on: 0 none, 0.3 rubbery. */
  elastic: 0.12,
  /** How hard it clings: the length (in cells) a tether is overdrawn before a particle lets go. */
  adhesion: 1.2,
  /** How much film dragged flat along the sphere holds out, against film folded back and
   *  peeled: 0 no difference, 5 it takes its own length again in stretch. */
  shear: 5,
  /** How much a long front weighs: 0 not at all, 1 doubles the pull needed every 40 cells of front. */
  load: 1,
  /** How the hand pulls: height the finger gains per length it has travelled. 0 drags the
   *  film flat back over itself, so the front follows at half the finger's pace. 1 pulls it
   *  up and away as it goes, the way one peels a sticker: the finger stays over the place
   *  where the film is coming off. */
  lift: 1,
  /** How solid lifted film stays far behind the front (lift.ghost). 0.08 is the look. */
  ghost: 0.6,
  /** How much of the lifted film is shown: what is no higher than this over the sphere, in
   *  radii (lift.band). The rest of what is in the hand is cut off. */
  height: 2,
  /** How unevenly the film clings from spot to spot: 0 a clean front, 1 a stuttering one. */
  rough: 0.1,
  /** Strength: the film breaks off along the front when the front gets this wide (in units
   *  of 40 cells), sooner on a fast pull. 0 never breaks. */
  tear: 3,
  /** Half the width of film the finger holds along the edge, in cells. A wide grip pulls
   *  the sheet off flat, a narrow one gathers it to a point. */
  grip: 4,
  /** How much more easily film lets go along a free edge (a cut, or film already gone)
   *  than in the middle of the sheet: 0 no difference, 1 it runs along the edge freely. With
   *  it the front comes out to the edge as an arc. */
  edge: 0.7,
  /** The taut sheet: above 0.5, stuck film lying under the flat sheet between finger and
   *  front lets go, so the front runs straight from edge to edge. Below, it does not. */
  straight: 1,
};
export type Tune = typeof tune;

/** Room in world.tension, in points. */
export const TENSION_POINTS = 40000;
const TETHER_SEGS = 8;                // pieces a drawn tether is bent round the sphere in

const M = LIFT_M;
const COUNT = 6 * M * M;
const CELL_RAD = Math.PI / (2 * M);   // a cell's angle at a face centre
const SUB = 3;                        // times a frame the front may let go: one ring each
const WEB = 3;                        // debug: a join to film that is down is drawn once it spans this many cells
const IRON = 3;                       // extra passes that even the drawn sheet out among its loose cells
const SWEEPS = 12;                    // times a frame the loose sheet is pulled taut
const OVER = 1.5;
const STACK = 0.12;                   // skins of height gained per cell behind the front
const SKIN = 0.004 * R;               // loose film rides this far above the sphere
const SHARE = 40;                     // front particles that double the pull needed at load 1
const HOLD = 1.7;                     // cells round the grab that the finger holds
const LIFT_MAX = 0.4 * R;                 // as high as the finger ever holds the film: higher, and a big sheet stands out in space like a sail
const SHEAR_STRETCH = 0.2;            // extra stretch film dragged flat takes, per unit of the shear setting
const ROUND = 3;                      // passes that round the front off, and rings of film they reach
const FAIR = 0.6;                     // how much the front evens itself out: a stuck point sticking into loose film gives sooner, a bay later
const HULL_MAX = 15000;                // loose cells beyond which the taut-sheet hull is not worked out
const SPECK = 6;                      // a stretch of front shorter than this (cells) is a leftover, not a front of its own
const CROWD = 5;                      // a stuck particle with this many loose neighbours goes with them

// ---- the lattice, once

const rest = new Float32Array(COUNT * 3);
const nb = new Int32Array(COUNT * 8).fill(-1);
const nbLen = new Float32Array(COUNT * 8);
const jitter = new Float32Array(COUNT);
const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
const OPP = [1, 0, 3, 2, 7, 6, 5, 4]; // the neighbour straight across
const tmp = new Float64Array(3), tmpF = new Float64Array(3);

function cellOf(x: number, y: number, z: number): number {
  dirToFace(x, y, z, tmpF);
  const i = Math.min(M - 1, (tmpF[1] / CELL) | 0), j = Math.min(M - 1, (tmpF[2] / CELL) | 0);
  return (tmpF[0] * M + j) * M + i;
}
/** The cell at (i, j) of face f, i and j one past the face allowed: the neighbour's. */
function cellAt(f: number, i: number, j: number): number {
  if (i >= 0 && i < M && j >= 0 && j < M) return (f * M + j) * M + i;
  faceToDir(f, (i + 0.5) * CELL, (j + 0.5) * CELL, tmp);
  return cellOf(tmp[0], tmp[1], tmp[2]);
}

for (let f = 0; f < 6; f++) for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
  const c = (f * M + j) * M + i;
  faceToDir(f, (i + 0.5) * CELL, (j + 0.5) * CELL, tmp);
  rest[c * 3] = tmp[0] * R; rest[c * 3 + 1] = tmp[1] * R; rest[c * 3 + 2] = tmp[2] * R;
  // how much harder or softer this spot clings: a slow wander, -1..1
  jitter[c] = 0.7 * Math.sin(tmp[0] * 23 + tmp[1] * 11) * Math.sin(tmp[1] * 19 - tmp[2] * 29) + 0.3 * Math.sin(tmp[2] * 61 + tmp[0] * 47);
}
for (let f = 0; f < 6; f++) for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
  const c = (f * M + j) * M + i;
  for (let k = 0; k < 8; k++) {
    const n = cellAt(f, i + DI[k], j + DJ[k]);
    let dup = n === c;
    for (let q = 0; q < k; q++) if (nb[c * 8 + q] === n) dup = true; // at a cube corner
    if (dup) continue;
    nb[c * 8 + k] = n;
    nbLen[c * 8 + k] = Math.hypot(rest[c * 3] - rest[n * 3], rest[c * 3 + 1] - rest[n * 3 + 1], rest[c * 3 + 2] - rest[n * 3 + 2]);
  }
}
// Padding of the atlas: which cell each padded texel shows.
const padDst: number[] = [], padSrc: number[] = [];
for (let f = 0; f < 6; f++) for (let j = -1; j <= M; j++) for (let i = -1; i <= M; i++) {
  if (i >= 0 && i < M && j >= 0 && j < M) continue;
  padDst.push(liftIndex(f, i, j));
  padSrc.push(cellAt(f, i, j));
}
const cellIndex = new Int32Array(COUNT);
for (let f = 0; f < 6; f++) for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) cellIndex[(f * M + j) * M + i] = liftIndex(f, i, j);

/** Length of the great-circle arc between two points on the sphere (both at radius R). */
function arc(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const c = (ax * bx + ay * by + az * bz) / (R * R);
  return R * Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
}

// ---- one peel

const STUCK = 0, LOOSE = 1, HELD = 2;

export function createPeeler(world: World) {
  const films = world.films, lift = world.lift;
  /** The film being pulled, and where it is in the stack (0 on top). */
  let film = films[0], layer = 0;
  const st = new Uint8Array(COUNT);
  const has = new Uint8Array(COUNT);        // film of the piece at the cell: 0 unknown, 1 yes, 2 no
  const linkKnown = new Uint8Array(COUNT);  // bit k: link k looked at
  const linkOk = new Uint8Array(COUNT);     // bit k: film is whole along link k
  const pos = new Float32Array(COUNT * 3);
  const depth = new Float32Array(COUNT);
  const tether = new Float32Array(COUNT);
  // Where the film to a particle last turns a corner (the grab, or the end of a cut), and
  // how much film lies before that corner: the tether is that plus a straight run.
  const corner = new Float32Array(COUNT * 3);
  const cornerLen = new Float32Array(COUNT);
  /** The cell that corner is at, and per stuck cell the last corner its straight run was
   *  checked from and what came of it: the film does not change while it is being pulled. */
  const cornerCell = new Int32Array(COUNT);
  const runFrom = new Int32Array(COUNT).fill(-1);
  const runOk = new Uint8Array(COUNT);
  /** The held particle each loose one hangs from: its tether runs to that point of the grip. */
  const root = new Int32Array(COUNT);
  const acc = new Float32Array(COUNT * 4);
  const accN = new Uint8Array(COUNT);
  const mask = new Float32Array(COUNT), mask2 = new Float32Array(COUNT);
  const even = new Float32Array(COUNT * 3);
  const iron = new Float32Array(COUNT * 3);
  const evenFar = new Float32Array(COUNT);
  const inRegion = new Uint8Array(COUNT);
  let region: number[] = [];
  let loose = new Int32Array(1 << 12);
  /** Loose cells that may still have stuck film next to them: the front. */
  let edge = new Int32Array(1 << 12);
  let nEdge = 0;
  let nLoose = 0, nHeld = 0, nFront = 0;
  const spill: number[] = [];
  let id = 0;
  let on = false;
  const G = new Vector3(), F = new Vector3(), q = new Quaternion(), v = new Vector3();
  let height = 0;

  function hasFilm(c: number): boolean {
    if (has[c] === 0) has[c] = idAt(film, rest[c * 3], rest[c * 3 + 1], rest[c * 3 + 2]) === id ? 1 : 2;
    return has[c] === 1;
  }

  /** Is there film of an upper layer over this cell? Then it can never let go: the film on
   *  top holds it down, and its edge is where this one parts. */
  const pin = new Uint8Array(COUNT); // 0 unknown, 1 free, 2 held down
  function pinned(c: number): boolean {
    if (layer === 0) return false;
    if (pin[c] === 0) pin[c] = coveredOver(films, layer, rest[c * 3], rest[c * 3 + 1], rest[c * 3 + 2]) ? 2 : 1;
    return pin[c] === 2;
  }

  /** Is the film whole from cell c to its neighbour k? */
  function link(c: number, k: number): boolean {
    const bit = 1 << k;
    if (linkKnown[c] & bit) return (linkOk[c] & bit) !== 0;
    linkKnown[c] |= bit;
    const n = nb[c * 8 + k];
    if (n < 0 || !hasFilm(c) || !hasFilm(n)) return false;
    const steps = Math.ceil(nbLen[c * 8 + k] / (TEXEL * 0.7));
    const ax = rest[c * 3], ay = rest[c * 3 + 1], az = rest[c * 3 + 2];
    const bx = rest[n * 3] - ax, by = rest[n * 3 + 1] - ay, bz = rest[n * 3 + 2] - az;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (idAt(film, ax + bx * t, ay + by * t, az + bz * t) !== id) return false;
    }
    linkOk[c] |= bit;
    return true;
  }

  /** Is the film whole along the straight run from (x, y, z) to cell n? */
  function clearRun(x: number, y: number, z: number, n: number): boolean {
    const p = n * 3;
    const dx = rest[p] - x, dy = rest[p + 1] - y, dz = rest[p + 2] - z;
    const steps = Math.ceil(Math.hypot(dx, dy, dz) / (TEXEL * 1.4));
    for (let q = 1; q < steps; q++) {
      const t = q / steps;
      if (idAt(film, x + dx * t, y + dy * t, z + dz * t) !== id) return false;
    }
    return true;
  }

  /** clearRun from the corner of loose cell c to stuck cell n, remembered. */
  function runClear(c: number, n: number): boolean {
    const from = cornerCell[c];
    if (runFrom[n] !== from) {
      runFrom[n] = from;
      runOk[n] = clearRun(corner[c * 3], corner[c * 3 + 1], corner[c * 3 + 2], n) ? 1 : 0;
    }
    return runOk[n] === 1;
  }

  /** `from`: the cell whose corner this one shares, -1 for a particle in the hand (it is its
   *  own corner), or -2 - c when the film turns a corner at cell c. */
  function loosen(c: number, state: number, through: number, from = -1) {
    if (nLoose === loose.length) { const g = new Int32Array(nLoose * 2); g.set(loose); loose = g; }
    loose[nLoose++] = c;
    if (nEdge === edge.length) { const g = new Int32Array(nEdge * 2); g.set(edge); edge = g; }
    edge[nEdge++] = c;
    st[c] = state;
    depth[c] = 1;
    const o = c * 3;
    pos[o] = rest[o]; pos[o + 1] = rest[o + 1]; pos[o + 2] = rest[o + 2];
    tether[c] = through;
    const q = c * 3;
    if (from === -1) { corner[q] = rest[q]; corner[q + 1] = rest[q + 1]; corner[q + 2] = rest[q + 2]; cornerLen[c] = 0; root[c] = c; cornerCell[c] = c; }
    else if (from >= 0) { const f = from * 3; corner[q] = corner[f]; corner[q + 1] = corner[f + 1]; corner[q + 2] = corner[f + 2]; cornerLen[c] = cornerLen[from]; root[c] = root[from]; cornerCell[c] = cornerCell[from]; }
    else { const w = -2 - from, f = w * 3; corner[q] = rest[f]; corner[q + 1] = rest[f + 1]; corner[q + 2] = rest[f + 2]; cornerLen[c] = tether[w]; root[c] = root[w]; cornerCell[c] = w; }
  }

  function clear() {
    runFrom.fill(-1);
    pin.fill(0);
    st.fill(0); has.fill(0); linkKnown.fill(0); linkOk.fill(0);
    nLoose = nHeld = nFront = nEdge = 0;
    world.tension.count = 0;
    for (const c of region) inRegion[c] = 0;
    region = [];
    on = false;
    lift.id = 0;
    lift.fade = 1;
    lift.fan.n = 0;
    lift.data.fill(0);
    lift.version++;
  }

  /** Take hold of piece `pieceId` of film `which` at the edge point e (unit, sphere-local), on the side
   *  the unit tangent `into` points to. */
  function start(which: number, pieceId: number, e: Vector3, into: Vector3): boolean {
    clear();
    layer = which;
    film = films[which];
    id = pieceId;
    G.copy(e).normalize();
    F.copy(G).multiplyScalar(R);
    q.identity();
    height = 0;
    // The finger holds the film cells round the grab that hang together with the one just
    // inside the edge: never the other lip of a cut.
    const near = (x: number, y: number, z: number) => {
      let best = -1, bestD = 3.2 * CELL_RAD * R;
      const ring = [cellOf(x, y, z)];
      for (let m = 0; m < ring.length && ring.length < 90; m++) {
        const c = ring[m];
        const d = Math.hypot(rest[c * 3] - x * R, rest[c * 3 + 1] - y * R, rest[c * 3 + 2] - z * R);
        if (d < bestD && hasFilm(c) && !pinned(c)) { bestD = d; best = c; }
        if (d < 3.2 * CELL_RAD * R) for (let k = 0; k < 8; k++) { const n = nb[c * 8 + k]; if (n >= 0 && !ring.includes(n)) ring.push(n); }
      }
      return best;
    };
    v.copy(G).addScaledVector(into, 1.2 * CELL_RAD).normalize();
    const c0 = near(v.x, v.y, v.z);
    // The grip is a short segment along the edge, not a point: the film cells within
    // tune.grip cells either way along it, hanging together with the one under the finger.
    v.crossVectors(G, into).normalize();
    const half = Math.max(HOLD, tune.grip) * CELL_RAD * R, cellLen = CELL_RAD * R;
    const inGrip = (n: number) => {
      const dx = rest[n * 3] - G.x * R, dy = rest[n * 3 + 1] - G.y * R, dz = rest[n * 3 + 2] - G.z * R;
      const along = dx * v.x + dy * v.y + dz * v.z, inward = dx * into.x + dy * into.y + dz * into.z;
      return Math.abs(along) <= half && inward >= -1.5 * cellLen && inward <= HOLD * cellLen;
    };
    if (c0 >= 0) {
      loosen(c0, HELD, 0);
      for (let m = 0; m < nLoose; m++) {
        const c = loose[m];
        for (let k = 0; k < 8; k++) {
          if (!link(c, k)) continue;
          const n = nb[c * 8 + k];
          if (st[n] === STUCK && inGrip(n) && !pinned(n)) loosen(n, HELD, 0);
        }
      }
    }
    if (nLoose === 0) { clear(); return false; }
    nHeld = nLoose;
    on = true;
    lift.layer = layer;
    lift.id = id;
    return true;
  }

  /** The finger: how the grabbed point has been carried over the sphere since the grab
   *  (a rotation, sphere-local), and by how many rad. */
  /** How high the finger is after `travel` rad over the sphere. */
  function rise(travel: number) {
    // At lift 1 the finger is exactly as high as it takes for the film to come off right
    // under it: the length it has travelled, plus what the film stretches over that length,
    // plus what its cling holds out for. Further away, it would be peeled that much further.
    const cling = tune.adhesion * CELL_RAD * R * (1 + (tune.load * nFront) / SHARE) * Math.min(1, travel / 0.05);
    return Math.min(LIFT_MAX, tune.lift * (travel * R * (1 + tune.elastic) + cling));
  }

  function carry(rot: Quaternion, travel: number) {
    q.copy(rot);
    height = rise(travel);
    F.copy(G).applyQuaternion(q).multiplyScalar(R + height);
  }

  /** The loose sheet, one step. Not cloth: a film pulled taut between where it is still down
   *  and the finger, like a soap film. Every loose particle goes to the mean of the particles
   *  it is joined to (stuck ones where they rest, held ones in the hand), over-relaxed so a
   *  few sweeps a frame keep up, and never under the sphere: there it lies on the ball and
   *  leaves it at a tangent. No weight, no speed, no slack to wrinkle. */
  function sheet() {
    const k1 = 1 + tune.elastic;
    for (let m = 0; m < nLoose; m++) {
      const c = loose[m], o = c * 3;
      if (st[c] !== HELD) continue;
      v.set(rest[o], rest[o + 1], rest[o + 2]).applyQuaternion(q).multiplyScalar((R + height) / R);
      pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
    }
    for (let it = 0; it < SWEEPS; it++) {
      // there and back, so no side of the sheet lags the other
      const back = (it & 1) === 1;
      for (let i = 0; i < nLoose; i++) {
        const c = loose[back ? nLoose - 1 - i : i], o = c * 3;
        if (st[c] !== LOOSE) continue;
        let x = 0, y = 0, z = 0, sum = 0;
        for (let k = 0; k < 8; k++) {
          if (!link(c, k)) continue;
          const n = nb[c * 8 + k], p = n * 3, w = k < 4 ? 1 : 0.5;
          if (st[n] === STUCK) {
            if (torn(n)) continue;
            x += rest[p] * w; y += rest[p + 1] * w; z += rest[p + 2] * w;
          }
          else { x += pos[p] * w; y += pos[p + 1] * w; z += pos[p + 2] * w; }
          sum += w;
        }
        if (sum === 0) continue;
        x = pos[o] + (x / sum - pos[o]) * OVER;
        y = pos[o + 1] + (y / sum - pos[o + 1]) * OVER;
        z = pos[o + 2] + (z / sum - pos[o + 2]) * OVER;
        // Film does not grow: a particle is never further from its point of the grip than
        // the film between them is long. Without it the mean alone lets a narrow grip draw
        // a thread out of the sheet while the rest stays behind; with it the pull fans out
        // from the hand in straight lines.
        const r3 = root[c] * 3;
        const tx = x - pos[r3], ty = y - pos[r3 + 1], tz = z - pos[r3 + 2];
        const td = Math.sqrt(tx * tx + ty * ty + tz * tz), max = tether[c] * k1;
        if (td > max) { const s = max / td; x = pos[r3] + tx * s; y = pos[r3 + 1] + ty * s; z = pos[r3 + 2] + tz * s; }
        // And where it still joins film that is down, that wins: the sheet stays within
        // the film's length of the film it is one with, however far the hand has gone.
        // The front lets go by its own rule (release), which gives the film more than the
        // limit above does; until it has, the sheet may not be torn away from it: that
        // shows as a row of teeth from the sheet back to the film it came from.
        for (let k = 0; k < 8; k++) {
          if (!link(c, k)) continue;
          const n = nb[c * 8 + k], p = n * 3, sn = st[n];
          if (sn === STUCK && torn(n)) continue;
          const nx = sn === STUCK ? rest[p] : pos[p], ny = sn === STUCK ? rest[p + 1] : pos[p + 1], nz = sn === STUCK ? rest[p + 2] : pos[p + 2];
          const dx = nx - x, dy = ny - y, dz = nz - z, d = Math.sqrt(dx * dx + dy * dy + dz * dz), r = nbLen[c * 8 + k] * k1;
          if (d <= r) continue;
          const f = ((d - r) / d) * (sn === LOOSE ? 0.5 : 1);
          x += dx * f; y += dy * f; z += dz * f;
        }
        // Film further from the front rides a hair higher: folded back, it lies on top of
        // the film it came from instead of in it.
        const floor = R + SKIN * (1 + STACK * Math.min(depth[c], 60));
        const l = Math.sqrt(x * x + y * y + z * z);
        if (l < floor) { const s = floor / l; x *= s; y *= s; z *= s; }
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      }
    }
  }

  /** Letting go: stuck particles next to loose ones whose tether would be overdrawn. The
   *  pull is shared by the whole front, so a long front needs a longer pull. Only reads
   *  where things rest, so it runs over the front alone, several times a frame. */
  // ---- debug: the pull, drawn

  const tension = world.tension;
  function point(x: number, y: number, z: number, r: number, cr: number, cg: number, cb: number) {
    const k = tension.count * 3, s = r / Math.hypot(x, y, z);
    tension.pos[k] = x * s; tension.pos[k + 1] = y * s; tension.pos[k + 2] = z * s;
    tension.col[k] = cr; tension.col[k + 1] = cg; tension.col[k + 2] = cb;
    tension.count++;
  }
  /**
   * One spot of the front: loose cell c, stuck cell n. `taut` is the film's length to the
   * finger over the length it may have (1 = pulled tight), `give` how far past that it is
   * towards letting go (0..1). A tick across the front in that colour, and for every third
   * spot the tether it hangs by: from the stuck film back to the last corner and on to the
   * grip, laid over the sphere.
   */
  function note(c: number, n: number, taut: number, give: number, withTether: boolean) {
    if (tension.count + 2 + (withTether ? TETHER_SEGS * 4 : 0) > TENSION_POINTS) return;
    // blue slack, yellow taut, red about to go
    const v = taut < 1 ? 0.5 * Math.max(0, (taut - 0.6) / 0.4) : 0.5 + 0.5 * Math.min(1, give);
    const cr = Math.min(1, v * 2), cg = v < 0.5 ? 0.35 + 1.3 * v : 2 - 2 * v, cb = Math.max(0, 1 - v * 2);
    const o = c * 3, p = n * 3;
    point(rest[o], rest[o + 1], rest[o + 2], R * 1.012, cr, cg, cb);
    point(rest[p], rest[p + 1], rest[p + 2], R * 1.012, cr, cg, cb);
    if (!withTether) return;
    const r3 = root[c] * 3, f = 0.55;
    const run = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      for (let i = 0; i < TETHER_SEGS; i++) {
        const u = i / TETHER_SEGS, w = (i + 1) / TETHER_SEGS;
        point(ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u, R * 1.008, cr * f, cg * f, cb * f);
        point(ax + (bx - ax) * w, ay + (by - ay) * w, az + (bz - az) * w, R * 1.008, cr * f, cg * f, cb * f);
      }
    };
    run(rest[p], rest[p + 1], rest[p + 2], corner[o], corner[o + 1], corner[o + 2]);
    run(corner[o], corner[o + 1], corner[o + 2], pos[r3], pos[r3 + 1], pos[r3 + 2]);
  }

  /** Is stuck cell n on a front that is not being pulled? The sheet is torn off along
   *  such a front: what is in the hand no longer hangs from the film left there. Without
   *  that the sheet, carried on, stays sewn to where it once left the sphere and trails
   *  a row of teeth back to it. (As of the last findFronts.) */
  function torn(n: number): boolean {
    if (frontSeen[n] !== frontGen) return false;
    const fo = frontOf[n];
    return fo >= 0 && fo !== liveFront; // a speck left behind too: it would hold one tooth
  }

  /** Debug: where the lifted sheet is still one film with film that is down. A line from
   *  the stuck cell n to where its loose neighbour c has been carried, when that is more
   *  than WEB cells away: magenta on a front that is not being pulled, cyan under the film
   *  above, white on the front that is. */
  function web(c: number, n: number) {
    if (tension.count + 2 > TENSION_POINTS) return;
    const o = c * 3, p = n * 3;
    const far = Math.hypot(pos[o] - rest[p], pos[o + 1] - rest[p + 1], pos[o + 2] - rest[p + 2]);
    if (far < WEB * CELL_RAD * R) return;
    const cr = pinned(n) ? 0 : 1, cg = pinned(n) || !torn(n) ? 1 : 0, cb = 1;
    point(rest[p], rest[p + 1], rest[p + 2], R * 1.012, cr, cg, cb);
    point(pos[o], pos[o + 1], pos[o + 2], Math.hypot(pos[o], pos[o + 1], pos[o + 2]) + R * 0.012, cr, cg, cb);
  }

  // Fronts: stretches of stuck film along the loose sheet that hang together. When the
  // peel runs right across a strip there are two, one either side of the gap. Only the one
  // nearest the finger is being pulled; the other is left where it stands.
  const frontOf = new Int32Array(COUNT);
  const frontSeen = new Int32Array(COUNT);
  let frontGen = 0, liveFront = -1;
  let frontCells = new Int32Array(1 << 10);
  const frontSize: number[] = [];
  function findFronts() {
    frontGen++;
    let ns = 0;
    for (let m = 0; m < nEdge; m++) {
      const c = edge[m];
      for (let k = 0; k < 8; k++) {
        if (!link(c, k)) continue;
        const n = nb[c * 8 + k];
        if (st[n] !== STUCK || frontSeen[n] === frontGen) continue;
        frontSeen[n] = frontGen;
        frontOf[n] = -1;
        if (ns === frontCells.length) { const g = new Int32Array(ns * 2); g.set(frontCells); frontCells = g; }
        frontCells[ns++] = n;
      }
    }
    let count = 0;
    liveFront = -1;
    let best = -Infinity;
    const stack: number[] = [];
    for (let i = 0; i < ns; i++) {
      if (frontOf[frontCells[i]] >= 0) continue;
      let size = 0, near = -Infinity;
      stack.push(frontCells[i]);
      frontOf[frontCells[i]] = count;
      while (stack.length) {
        const n = stack.pop()!, p = n * 3;
        size++;
        const dot = rest[p] * F.x + rest[p + 1] * F.y + rest[p + 2] * F.z; // larger is nearer the finger
        if (dot > near) near = dot;
        for (let k = 0; k < 8; k++) {
          if (!link(n, k)) continue;
          const w = nb[n * 8 + k];
          if (frontSeen[w] === frontGen && frontOf[w] < 0) { frontOf[w] = count; stack.push(w); }
        }
      }
      frontSize[count] = size;
      if (size >= SPECK && near > best) { best = near; liveFront = count; }
      count++;
    }
  }

  // ---- a flat map and convex hulls on it, for the taut sheet and for the fan

  /** A flat (gnomonic) map of part of the sphere, where great circles are straight lines:
   *  its centre and its two axes, unit, sphere-local. */
  interface Flat { c: Vector3; u: Vector3; v: Vector3 }
  const flat = (): Flat => ({ c: new Vector3(), u: new Vector3(), v: new Vector3() });
  /** Centre the map on the middle of cells[0..n). False if they have none. */
  function centreOn(f: Flat, cells: ArrayLike<number>, n: number): boolean {
    let cx = 0, cy = 0, cz = 0;
    for (let m = 0; m < n; m++) { const o = cells[m] * 3; cx += rest[o]; cy += rest[o + 1]; cz += rest[o + 2]; }
    f.c.set(cx, cy, cz);
    if (f.c.lengthSq() < 1e-12) return false;
    f.c.normalize();
    f.u.set(-f.c.y, f.c.x, 0);
    if (f.u.lengthSq() < 1e-6) f.u.set(0, -f.c.z, f.c.y);
    f.u.normalize();
    f.v.crossVectors(f.c, f.u);
    return true;
  }
  /** Where cell c is on the map, into (mapX, mapY). False if it is too far round the ball
   *  for a flat map. */
  let mapX = 0, mapY = 0;
  function onMap(f: Flat, c: number): boolean {
    const o = c * 3;
    const w = (rest[o] * f.c.x + rest[o + 1] * f.c.y + rest[o + 2] * f.c.z) / R;
    if (w < 0.2) return false;
    mapX = (rest[o] * f.u.x + rest[o + 1] * f.u.y + rest[o + 2] * f.u.z) / (R * w);
    mapY = (rest[o] * f.v.x + rest[o + 1] * f.v.y + rest[o + 2] * f.v.z) / (R * w);
    return true;
  }
  let px = new Float64Array(1 << 10), py = new Float64Array(1 << 10);
  let order = new Int32Array(1 << 10);
  /** The convex hull of cells[0..n) on the map, counter-clockwise, into (hx, hy). False, and
   *  nothing in them, if a cell is off the map or there are fewer than three corners. */
  function hullOf(f: Flat, cells: ArrayLike<number>, n: number, hx: number[], hy: number[]): boolean {
    hx.length = hy.length = 0;
    if (px.length < n) { px = new Float64Array(n * 2); py = new Float64Array(n * 2); order = new Int32Array(n * 2); }
    for (let m = 0; m < n; m++) {
      if (!onMap(f, cells[m])) return false;
      px[m] = mapX; py[m] = mapY; order[m] = m;
    }
    const idx = order.subarray(0, n).sort((a, b) => px[a] - px[b] || py[a] - py[b]);
    // monotone chain
    const turn = (k: number) => {
      const h = hx.length;
      return (hx[h - 1] - hx[h - 2]) * (py[k] - hy[h - 2]) - (hy[h - 1] - hy[h - 2]) * (px[k] - hx[h - 2]);
    };
    for (let i = 0; i < n; i++) {
      const k = idx[i];
      while (hx.length >= 2 && turn(k) <= 0) { hx.pop(); hy.pop(); }
      hx.push(px[k]); hy.push(py[k]);
    }
    const lower = hx.length + 1;
    for (let i = n - 2; i >= 0; i--) {
      const k = idx[i];
      while (hx.length >= lower && turn(k) <= 0) { hx.pop(); hy.pop(); }
      hx.push(px[k]); hy.push(py[k]);
    }
    hx.pop(); hy.pop();
    if (hx.length < 3) { hx.length = hy.length = 0; return false; }
    return true;
  }

  // The taut sheet. Film held up by the finger is flat between where it leaves the sphere,
  // so the line it comes off along is straight from one free edge to the other: what is
  // loose is convex. Each frame the convex hull of the loose cells is taken, and stuck film
  // inside it lets go.
  const hull = flat();
  const hx: number[] = [], hy: number[] = [];
  let rim = new Int32Array(1 << 10);
  function buildHull() {
    hx.length = hy.length = 0;
    if (tune.straight < 0.5 || nLoose < 3 || nLoose > HULL_MAX) return;
    if (!centreOn(hull, loose, nLoose)) return;
    // Every loose cell has to be on the map, but only the ones on the rim of the loose film
    // (a neighbour that is not loose) can be a corner of its hull: a few hundred to sort,
    // not all of them.
    if (rim.length < nLoose) rim = new Int32Array(nLoose * 2);
    let nRim = 0;
    for (let m = 0; m < nLoose; m++) {
      const c = loose[m];
      if (!onMap(hull, c)) return; // spread too far round the ball for a flat map
      for (let k = 0; k < 8; k++) {
        const n = nb[c * 8 + k];
        if (n < 0 || st[n] === STUCK) { rim[nRim++] = c; break; }
      }
    }
    hullOf(hull, rim, nRim, hx, hy);
  }
  /** Is stuck cell n under the taut sheet: inside the hull by more than half a cell? */
  function underSheet(n: number): boolean {
    const h = hx.length;
    if (h === 0 || !onMap(hull, n)) return false;
    const x = mapX, y = mapY, margin = 0.6 * CELL_RAD;
    for (let i = 0, j = h - 1; i < h; j = i++) {
      const ex = hx[i] - hx[j], ey = hy[i] - hy[j];
      if (ex * (y - hy[j]) - ey * (x - hx[j]) < margin * Math.hypot(ex, ey)) return false;
    }
    return true;
  }

  // The fan: the film between the hand and the front that is being pulled. That is the
  // sheet worth seeing. Loose film outside it hangs from nothing any more (a front left
  // behind, a free edge) and is not drawn while the pull goes on: it only trails.
  // The convex hull of the cells in the hand and the loose cells along the live front,
  // handed to the shader (lift.fan), which cuts along it.
  const fanMap = flat();
  const fx: number[] = [], fy: number[] = [];
  const fanCells: number[] = [];
  function buildFan() {
    lift.fan.n = 0;
    if (liveFront < 0) return;
    fanCells.length = 0;
    for (let m = 0; m < nLoose; m++) if (st[loose[m]] === HELD) fanCells.push(loose[m]);
    const held = fanCells.length;
    for (let m = 0; m < nEdge; m++) {
      const c = edge[m];
      for (let k = 0; k < 8; k++) {
        if (!link(c, k)) continue;
        const n = nb[c * 8 + k];
        if (st[n] === STUCK && frontSeen[n] === frontGen && frontOf[n] === liveFront) { fanCells.push(c); break; }
      }
    }
    const count = fanCells.length;
    if (count - held < 2) return;
    // off the map (spread too far round the ball): all of the film is shown
    if (!centreOn(fanMap, fanCells, count) || !hullOf(fanMap, fanCells, count, fx, fy)) return;
    const h = fx.length, fanC = fanMap.c, fanU = fanMap.u, fanV = fanMap.v;
    // for the shader: at most FAN_MAX corners, evenly thinned (the polygon only shrinks by it)
    const fan = lift.fan, step = Math.max(1, Math.ceil(h / FAN_MAX));
    let n = 0;
    for (let i = 0; i < h && n < FAN_MAX; i += step) { fan.pts[n * 2] = fx[i]; fan.pts[n * 2 + 1] = fy[i]; n++; }
    fan.c[0] = fanC.x; fan.c[1] = fanC.y; fan.c[2] = fanC.z;
    fan.u[0] = fanU.x; fan.u[1] = fanU.y; fan.u[2] = fanU.z;
    fan.v[0] = fanV.x; fan.v[1] = fanV.y; fan.v[2] = fanV.z;
    fan.n = n >= 3 ? n : 0;
  }

  /** `watch`: the pass of the frame that is also drawn. With the debug lines on, it writes
   *  what the front feels to world.tension. */
  function release(watch: boolean) {
    const draw = watch && world.show.debug;
    findFronts();
    if (watch) tension.count = 0;
    let spot = 0;
    const k1 = 1 + tune.elastic;
    const need = tune.adhesion * CELL_RAD * R * (1 + (tune.load * nFront) / SHARE);
    const fr = R / (R + height);
    const held = pos; // held particles sit where the finger has carried them
    const n0 = nEdge;
    let front = 0, keep = 0;
    for (let m = 0; m < n0; m++) {
      const c = edge[m];
      let left = false;
      for (let k = 0; k < 8; k++) {
        if (!link(c, k)) continue;
        const n = nb[c * 8 + k];
        if (st[n] !== STUCK) continue;
        left = true;
        if (draw) web(c, n);
        if (pinned(n)) continue; // under the film above: it stays
        // not the front being pulled (and not just a leftover speck): it stays as it is
        const fo = frontSeen[n] === frontGen ? frontOf[n] : -1;
        if (fo >= 0 && fo !== liveFront && frontSize[fo] >= SPECK) continue;
        if (k < 4) front++;
        const p = n * 3;
        // the film runs from the grab to c and on to n: round the end of a cut, not across it
        const o = c * 3, len = nbLen[c * 8 + k];
        const ax = rest[o] - rest[p], ay = rest[o + 1] - rest[p + 1], az = rest[o + 2] - rest[p + 2];
        const r3 = root[c] * 3, Fx = held[r3], Fy = held[r3 + 1], Fz = held[r3 + 2];
        const bx = Fx - rest[p], by = Fy - rest[p + 1], bz = Fz - rest[p + 2];
        // Lengths run over the sphere, not through it: the arc to the point under the
        // finger, and the finger's height on top.
        const d = Math.hypot(arc(rest[p], rest[p + 1], rest[p + 2], Fx * fr, Fy * fr, Fz * fr), height);
        // straight from the last corner if the film is whole that way, else round by c
        const straight = cornerLen[c] + arc(rest[p], rest[p + 1], rest[p + 2], corner[o], corner[o + 1], corner[o + 2]);
        const slack = d - straight * k1 <= 0;
        const under = underSheet(n);
        if (slack && !watch && !under) continue;
        const direct = (slack && !under) || runClear(c, n);
        const t = direct ? straight : tether[c] + len;
        // Peel angle, measured on the surface: which way the finger lies from here, against
        // which way the loose film lies. Finger back over the stuck film: it folds over and
        // peels. Finger out beyond the loose film: the pull runs flat along the sphere, and
        // film held in shear takes a lot more stretch before it gives, the more of it there
        // is. So film round the far side of the ball stays put instead of sliding off.
        const fn = (bx * rest[p] + by * rest[p + 1] + bz * rest[p + 2]) / (R * R);
        const tx = bx - rest[p] * fn, ty = by - rest[p + 1] * fn, tz = bz - rest[p + 2] * fn;
        const tl = Math.hypot(tx, ty, tz);
        // The loose film lies towards the corner it runs from. (Not towards whichever
        // neighbour happens to be loose: that only has eight directions, and the front
        // would grow eight corners.)
        let ux = corner[o] - rest[p], uy = corner[o + 1] - rest[p + 1], uz = corner[o + 2] - rest[p + 2];
        const un = (ux * rest[p] + uy * rest[p + 1] + uz * rest[p + 2]) / (R * R);
        ux -= rest[p] * un; uy -= rest[p + 1] * un; uz -= rest[p + 2] * un;
        let ul = Math.hypot(ux, uy, uz);
        if (!direct || ul < 1e-5) { ux = ax; uy = ay; uz = az; ul = len; }
        // How much of the pull runs flat along the film, as a share of the whole pull in
        // space: along the loose film counts in full, sideways half, back over the stuck
        // film and straight up off the sphere not at all. Lifted clear, film just peels.
        const along = tl > 1e-5 ? (ux * tx + uy * ty + uz * tz) / ul : 0;
        const side = Math.sqrt(Math.max(0, tl * tl - along * along));
        const bl3 = Math.hypot(bx, by, bz);
        const flat = bl3 > 1e-6 ? (Math.max(0, along) + 0.5 * side) / bl3 : 0;
        // On a free edge there is no film on one side to hold it: it gives sooner.
        let ease = 1;
        for (let q = 0; q < 8; q++) if (!link(n, q)) { ease = 1 - tune.edge; break; }
        // The front shares its load along itself: stuck film that sticks out into loose
        // film carries more than its share and gives sooner, a bay is sheltered and gives
        // later. Read from how much of the film two cells round n is loose (about 0.4 on a
        // straight front). This is what pulls the front into an even curve.
        let looseNear = 0, filmNear = 0;
        for (let q = 0; q < 8; q++) {
          const w = nb[n * 8 + q];
          if (w < 0 || !link(n, q)) continue;
          filmNear++; if (st[w] !== STUCK) looseNear++;
          for (let r = 0; r < 8; r++) {
            const x = nb[w * 8 + r];
            if (x < 0 || x === n || !link(w, r)) continue;
            filmNear++; if (st[x] !== STUCK) looseNear++;
          }
        }
        const share = filmNear > 0 ? looseNear / filmNear : 0.4;
        const fair = Math.min(1.8, Math.max(0.3, 1 - FAIR * (share - 0.4) / 0.4));
        const may = t * (1 + (tune.elastic + SHEAR_STRETCH * tune.shear * flat * ease) * fair);
        const over = d - may;
        const limit = need * ease * fair * (1 + tune.rough * jitter[n]);
        if (draw) note(c, n, d / Math.max(may, 1e-9), limit > 1e-9 ? over / limit : 1, spot++ % 3 === 0);
        // under the taut sheet: it comes away whatever it feels itself
        if (under) { loosen(n, LOOSE, t, direct ? c : -2 - c); continue; }
        if (over <= 0) continue;
        let crowd = 0;
        for (let q = 0; q < 8; q++) { const w = nb[n * 8 + q]; if (w >= 0 && st[w] !== STUCK) crowd++; }
        if (crowd >= CROWD || over > limit) loosen(n, LOOSE, t, direct ? c : -2 - c);
      }
      if (left) edge[keep++] = c; // still has stuck film next to it
    }
    // the ones that let go just now are the new front
    for (let m = n0; m < nEdge; m++) edge[keep++] = edge[m];
    nEdge = keep;
    nFront = front;
  }

  /** Cells behind the front, relaxed a step a frame. A sheet with nothing stuck left just
   *  keeps counting and fades out. */
  function deepen() {
    for (let m = 0; m < nLoose; m++) {
      const c = loose[m];
      let dmin = Infinity;
      for (let k = 0; k < 8; k++) {
        if (!link(c, k)) continue;
        const n = nb[c * 8 + k];
        const dn = st[n] === STUCK ? 0 : depth[n];
        if (dn < dmin) dmin = dn;
      }
      depth[c] = Math.min(999, (dmin < Infinity ? dmin : depth[c]) + 1);
    }
  }

  /** The loose cells as a soft mask, rounded off: a few passes of averaging each cell with
   *  the cells it is linked to, so the 0.5 line is an even curve and never blurs across a
   *  cut. Fills `mask` over `region` (the loose cells and ROUND rings of film round them). */
  function soften() {
    for (const c of region) inRegion[c] = 0;
    region = [];
    for (let m = 0; m < nLoose; m++) { const c = loose[m]; inRegion[c] = 1; mask[c] = 1; region.push(c); }
    let from = 0;
    for (let r = 0; r < ROUND; r++) {
      const to = region.length;
      for (let m = from; m < to; m++) {
        const c = region[m];
        for (let k = 0; k < 8; k++) {
          if (!link(c, k)) continue;
          const n = nb[c * 8 + k];
          if (!inRegion[n]) { inRegion[n] = 1; mask[n] = 0; region.push(n); }
        }
      }
      from = to;
    }
    let a = mask, b = mask2;
    for (let pass = 0; pass < ROUND; pass++) {
      for (const c of region) {
        let sum = a[c], cnt = 1;
        for (let k = 0; k < 8; k++) {
          if (!link(c, k)) continue;
          const n = nb[c * 8 + k];
          if (st[c] !== STUCK && st[n] === STUCK && torn(n)) continue;
          cnt++;
          if (inRegion[n]) sum += a[n];
        }
        b[c] = sum / cnt;
      }
      const t = a; a = b; b = t;
    }
    if (a !== mask) for (const c of region) mask[c] = a[c];
  }

  function write() {
    const data = lift.data;
    data.fill(0);
    buildFan();
    soften();
    // Displacement, evened out over each cell and the cells it is linked to: the sheet
    // leaves the sphere over a couple of cells instead of in one step at the front.
    for (const c of region) {
      const o = c * 3;
      let x = 0, y = 0, z = 0, cnt = 1, far = 0;
      if (st[c] !== STUCK) { x = pos[o] - rest[o]; y = pos[o + 1] - rest[o + 1]; z = pos[o + 2] - rest[o + 2]; far = depth[c]; }
      for (let k = 0; k < 8; k++) {
        if (!link(c, k)) continue;
        const n = nb[c * 8 + k], p = n * 3;
        if (st[n] === STUCK && torn(n)) continue;
        cnt++;
        if (st[n] !== STUCK) { x += pos[p] - rest[p]; y += pos[p + 1] - rest[p + 1]; z += pos[p + 2] - rest[p + 2]; far += depth[n]; }
      }
      // and how far from film that is down, evened out the same way: counted in whole
      // cells it would step along the lattice
      evenFar[c] = far / cnt;
      even[o] = x / cnt; even[o + 1] = y / cnt; even[o + 2] = z / cnt;
    }
    // Ironed: a few more passes among the loose cells alone. One cell out of line with
    // the sheet round it (held back by a speck, or just late) is a tooth on its edge.
    for (let pass = 0; pass < IRON; pass++) {
      for (const c of region) {
        if (st[c] === STUCK) continue;
        const o = c * 3;
        let x = even[o], y = even[o + 1], z = even[o + 2], cnt = 1, atFront = false;
        for (let k = 0; k < 8; k++) {
          if (!link(c, k)) continue;
          const n = nb[c * 8 + k], p = n * 3;
          if (st[n] === STUCK) { if (!torn(n)) atFront = true; continue; }
          cnt++; x += even[p]; y += even[p + 1]; z += even[p + 2];
        }
        // not the first row at the front that is pulled: there the film is creased, and
        // ironing the crease draws it out into teeth of its own
        if (atFront) { iron[o] = even[o]; iron[o + 1] = even[o + 1]; iron[o + 2] = even[o + 2]; continue; }
        iron[o] = x / cnt; iron[o + 1] = y / cnt; iron[o + 2] = z / cnt;
      }
      for (const c of region) {
        if (st[c] === STUCK) continue;
        const o = c * 3;
        even[o] = iron[o]; even[o + 1] = iron[o + 1]; even[o + 2] = iron[o + 2];
      }
    }
    // Film that is down stays on the sphere, so the lifted mesh meets it there. Loose film is
    // where it is, right from the first cell: folded back flat over the film still down it
    // is already cells away there, and easing it in over a few cells would draw those cells
    // out between the front and the sheet as a row of teeth.
    for (const c of region) {
      if (st[c] !== STUCK) continue;
      const o = c * 3;
      even[o] = even[o + 1] = even[o + 2] = 0;
    }
    for (const c of region) {
      const a = cellIndex[c], loosed = st[c] !== STUCK, o = c * 3;
      // w: the soft mask at the front, plus the cells behind it further in
      const w = mask[c] + (loosed ? Math.max(0, evenFar[c] - 1) : 0);
      // stuck cells stay on the sphere, so the lifted mesh meets the film that is down
      const dx = even[o], dy = even[o + 1], dz = even[o + 2];
      data[a] = dx; data[a + 1] = dy; data[a + 2] = dz; data[a + 3] = w;
      if (!loosed) continue;
      // Cells across a cut from a loose one (no film there, or film this sheet is not
      // joined to) carry its displacement, so the mesh does not sag back over the cut.
      for (let k = 0; k < 8; k++) {
        const n = nb[c * 8 + k];
        if (n < 0 || st[n] !== STUCK) continue;
        // ... and so do cells of a front the sheet is torn off along
        const tear = link(c, k);
        if (tear && !torn(n)) continue;
        if (accN[n] === 0) {
          // not if it sits on the front itself, joined to some other loose cell
          let onFront = false;
          if (!tear && !torn(n)) for (let q = 0; q < 8; q++) if (link(n, q) && st[nb[n * 8 + q]] !== STUCK) { onFront = true; break; }
          if (onFront) continue;
          spill.push(n);
        }
        accN[n]++;
        // carried on in a straight line from the cell behind this one: stretched film is
        // far from level, and a plain copy would leave a tooth at every cell of the edge
        const b = nb[c * 8 + OPP[k]];
        let ex = dx, ey = dy, ez = dz;
        if (b >= 0 && st[b] !== STUCK && link(c, OPP[k])) { ex += dx - even[b * 3]; ey += dy - even[b * 3 + 1]; ez += dz - even[b * 3 + 2]; }
        acc[n * 4] += ex; acc[n * 4 + 1] += ey; acc[n * 4 + 2] += ez; acc[n * 4 + 3] += w;
      }
    }
    for (const n of spill) {
      const a = cellIndex[n], s = 1 / accN[n];
      // where there is film it is someone else's and stays down: only the mesh moves
      for (let k = 0; k < (hasFilm(n) ? 3 : 4); k++) data[a + k] = acc[n * 4 + k] * s;
      acc[n * 4] = acc[n * 4 + 1] = acc[n * 4 + 2] = acc[n * 4 + 3] = 0;
      accN[n] = 0;
    }
    spill.length = 0;
    for (let m = 0; m < padDst.length; m++) {
      const a = padDst[m], b = cellIndex[padSrc[m]];
      data[a] = data[b]; data[a + 1] = data[b + 1]; data[a + 2] = data[b + 2]; data[a + 3] = data[b + 3];
    }
    lift.version++;
  }

  return {
    get active() { return on; },
    /** Particles that let go, beyond the ones in the hand. */
    get peeled() { return nLoose - nHeld; },
    get front() { return nFront; },
    /** How high the finger holds the film above the sphere. */
    get height() { return height; },
    start,
    rise,
    carry,
    clear,
    step() {
      if (!on) return;
      sheet();
      buildHull();
      for (let s = 0; s < SUB; s++) release(s === SUB - 1);
      deepen();
      write();
    },
    /**
     * What has let go leaves the film for good: film texels of the piece reachable from a
     * loose particle without crossing a cut, as far as the peel front (the w = 0.5 line of
     * the atlas, the same one the shader draws). Returns texels removed.
     */
    commit(): number {
      if (!on) return 0;
      write();
      // The new edge is the front as it was drawn: the 0.5 line of the atlas. Along a cut
      // the lattice cannot say which side a texel is on, so there a lifted cell goes whole:
      // the flood cannot cross the cut anyway.
      // Where the film above holds this one down the cells never let go, so the drawn front
      // stops half a cell short of that film's edge. There the film parts along the edge
      // itself: a held-down cell next to loose film goes as far as it is not covered.
      const data = lift.data, seeds: number[] = [], whole = accN;
      for (const c of region) {
        if (mask[c] > 0.5 && st[c] !== STUCK) seeds.push(texelAt(rest[c * 3], rest[c * 3 + 1], rest[c * 3 + 2]));
        if (st[c] === STUCK && pinned(c)) {
          for (let q = 0; q < 8; q++) if (link(c, q) && st[nb[c * 8 + q]] !== STUCK) { whole[c] = 1; break; }
          if (whole[c]) continue;
        }
        for (let q = 0; q < 8; q++) {
          const w = nb[c * 8 + q];
          if (w >= 0 && hasFilm(w) && !link(c, q) && (mask[c] > 0.5 || (inRegion[w] && mask[w] > 0.5))) { whole[c] = 1; break; }
        }
      }
      const W3 = 3 * FILM_N;
      const n = eraseFlood(film, id, seeds, (k) => {
        const col = k % W3, row = (k / W3) | 0;
        const fc = (col / FILM_N) | 0, fr = (row / FILM_N) | 0;
        const f = fr * 3 + fc, x = (col - fc * FILM_N + 0.5) / CELL, y = (row - fr * FILM_N + 0.5) / CELL;
        // never under the film above: this is exact, to the texel
        for (let q = 0; q < layer; q++) if (films[q].cover[k] >= 128) return false;
        return whole[(f * M + (y | 0)) * M + (x | 0)] === 1 || liftRead(data, f, x, y, 3) > 0.5;
      });
      for (const c of region) whole[c] = 0;
      clear();
      return n;
    },
  };
}

export type Peeler = ReturnType<typeof createPeeler>;
