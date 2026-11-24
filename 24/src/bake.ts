// The knot is made once, offline (bake/run.ts), not live: eight closed loops on the ground, each
// one a whole snake's track, piled together and let fall under hard physics (many iterations, all
// the time it needs, nobody waiting for a frame) until it is still. What is kept is where every loop
// came to rest, in three dimensions: its track. At run time the snakes only glide along their tracks
// (physics.ts), so nothing can shake or sink in.
// Many knots are tried, each scored: no body in another, the screen covered with skin, not too deep.
import { type Path, type Tangle, buildTangle, lissajous, loopDiff, undulate, rng } from './paths.ts';
import { FAMILIES } from './species.ts';

const TAU = Math.PI * 2;
/** the patch of ground the knot is packed onto (the camera sees about half of it) */
export const AREA = { w: 0.54, h: 0.36 };
/** what the camera covers, as a fraction of the area */
export const VIEW = 0.55;
export const LOOPS = 8;
/** python, corn: the thickest part of the body */
export const RADIUS = [FAMILIES.python.radius, FAMILIES.corn.radius];
/** how long a loop may be: eight of them on this patch make two or three layers */
const LEN = [0.9, 1.3];

export interface Candidate {
  seed: number;
  tangle: Tangle;
  radii: number[];
  species: number[];
}

// Lissajous figures a:b that make loops of a snake's length on this patch
const PAIRS: [number, number][] = [[1, 2], [2, 1], [2, 3], [3, 2], [1, 3], [3, 1], [3, 4], [4, 3]];

export function candidate(seed: number): Candidate {
  const r = rng(seed);
  const { w: W, h: H } = AREA;
  const paths: Path[] = [], radii: number[] = [], species: number[] = [];
  for (let k = 0; k < LOOPS; k++) {
    const sp = k % 2; // python, corn, python, corn…
    let path: Path | null = null;
    for (let tries = 0; tries < 200 && !path; tries++) {
      const [a, b] = PAIRS[Math.floor(r() * PAIRS.length)];
      let w = W * (0.5 + 0.5 * r()), h = H * (0.5 + 0.5 * r());
      const fx = r() - 0.5, fz = r() - 0.5;
      const ph = r() * TAU, s1 = Math.floor(r() * 1e6), wob = 0.1 + 0.08 * r(), rot = (r() - 0.5) * 0.8, s2 = Math.floor(r() * 1e6);
      const make = () => undulate(
        lissajous(a, b, ph, w, h, s1, wob, rot, (W - w) * fx, (H - h) * fz),
        sp ? 0.014 : 0.02, sp ? 0.17 : 0.23, s2,
      );
      let p = make();
      // too long or too short for a snake: drawn smaller or larger, once, if it still fits the patch
      const want = (LEN[0] + LEN[1]) / 2;
      if (p.len < LEN[0] || p.len > LEN[1]) {
        const f = want / p.len;
        if (w * f <= W && h * f <= H && w * f > W * 0.3 && h * f > H * 0.3) { w *= f; h *= f; p = make(); }
      }
      if (p.len > LEN[0] && p.len < LEN[1]) path = p;
    }
    paths.push(path!);
    radii.push(RADIUS[sp] * (0.88 + 0.18 * r()));
    species.push(sp);
  }
  const tangle = buildTangle(paths);
  // Which strand goes over: strict over-under-over along every loop can't be had with eight of them
  // (half the crossings fight, and fights build towers). Instead each loop gets a slow wave of height
  // along its length, and at a crossing the one higher on its wave goes over. Never a fight, and
  // every snake still weaves over and under the others
  const waves = paths.map((p) => {
    const k = [1 + Math.floor(r() * 2), 3 + Math.floor(r() * 3), 6 + Math.floor(r() * 4)];
    const ph = [r() * TAU, r() * TAU, r() * TAU];
    return (s: number) => {
      const u = (s / p.len) * TAU;
      return Math.sin(k[0] * u + ph[0]) * 0.5 + Math.sin(k[1] * u + ph[1]) + Math.sin(k[2] * u + ph[2]) * 0.6;
    };
  });
  for (const x of tangle.crossings) x.aOver = waves[x.a](x.sa) > waves[x.b](x.sb);
  return { seed, tangle, radii, species };
}

export interface Settled {
  /** every loop as a ring of spheres SEGB apart: offsets into the flat arrays */
  off: number[];
  cnt: number[];
  seg: number[];
  pos: Float32Array;
  rad: Float32Array;
}

const SEGB = 0.01;
const CELL = 0.05;

/** knobs: how firmly the loops are held to their drawing once the pile has formed (1/s), how much wider
 * than drawn the bodies collide (whatever a pile presses in, the solver never quite undoes; this way it
 * never shows, and the run time reads it back from tracks.json), and the tightest bend, in body radii */
export const BAKE = { pullLate: 0.2, inflate: 1.08, bend: 2 };

/** let the loops fall into one another until they are still */
export function settle(c: Candidate, seconds: number, substeps: number, iters: number): Settled {
  const { tangle, radii } = c;
  const paths = tangle.paths;
  const off: number[] = [], cnt: number[] = [], seg: number[] = [];
  let N = 0;
  for (const p of paths) {
    const n = Math.round(p.len / SEGB);
    off.push(N); cnt.push(n); seg.push(p.len / n); N += n;
  }
  const pos = new Float32Array(N * 3), prev = new Float32Array(N * 3), rad = new Float32Array(N);
  const tx = new Float32Array(N), tz = new Float32Array(N);
  const ring = new Uint8Array(N), idx = new Uint16Array(N);
  const xing = new Int32Array(N).fill(-1), xside = new Uint8Array(N), xw = new Float32Array(N);
  paths.forEach((p, k) => {
    for (let i = 0; i < cnt[k]; i++) {
      const g = off[k] + i;
      const s = (i * seg[k]) / p.step;
      const a = Math.floor(s) % p.n, b = (a + 1) % p.n, t = s - Math.floor(s);
      tx[g] = p.xz[a * 2] + (p.xz[b * 2] - p.xz[a * 2]) * t;
      tz[g] = p.xz[a * 2 + 1] + (p.xz[b * 2 + 1] - p.xz[a * 2 + 1]) * t;
      rad[g] = radii[k];
      ring[g] = k; idx[g] = i;
      pos[g * 3] = tx[g]; pos[g * 3 + 1] = radii[k] * (1 + 2 * k / LOOPS); pos[g * 3 + 2] = tz[g];
    }
  });
  prev.set(pos);
  // crossing tags: the knot never moves here, so once is enough
  tangle.crossings.forEach((x, ci) => {
    for (let side = 0; side < 2; side++) {
      const k = side ? x.b : x.a, sc = side ? x.sb : x.sa;
      const r = radii[k], wdt = 1.4 * r + 0.03;
      for (let i = 0; i < cnt[k]; i++) {
        const d = Math.abs(loopDiff(i * seg[k], sc, paths[k].len));
        if (d > wdt) continue;
        const g = off[k] + i;
        const w = 1 - Math.max(0, (d - wdt * 0.55) / (wdt * 0.45));
        if (xing[g] < 0 || w > xw[g]) { xing[g] = ci; xside[g] = side; xw[g] = w; }
      }
    }
  });

  // grid over the ground
  const cellOf = new Int32Array(N), sorted = new Int32Array(N);
  let start = new Int32Array(1), gx0 = 0, gz0 = 0, gnx = 1, gnz = 1;
  function grid() {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let g = 0; g < N; g++) {
      x0 = Math.min(x0, pos[g * 3]); x1 = Math.max(x1, pos[g * 3]);
      z0 = Math.min(z0, pos[g * 3 + 2]); z1 = Math.max(z1, pos[g * 3 + 2]);
    }
    gx0 = Math.max(x0, -2) - CELL; gz0 = Math.max(z0, -2) - CELL;
    gnx = Math.ceil((Math.min(x1, 2) - gx0) / CELL) + 2; gnz = Math.ceil((Math.min(z1, 2) - gz0) / CELL) + 2;
    const cells = gnx * gnz;
    if (start.length < cells + 1) start = new Int32Array(cells + 1);
    start.fill(0, 0, cells + 1);
    for (let g = 0; g < N; g++) {
      const ix = Math.min(gnx - 1, Math.max(0, Math.floor((pos[g * 3] - gx0) / CELL)));
      const iz = Math.min(gnz - 1, Math.max(0, Math.floor((pos[g * 3 + 2] - gz0) / CELL)));
      cellOf[g] = ix + iz * gnx;
      start[cellOf[g] + 1]++;
    }
    for (let q = 0; q < cells; q++) start[q + 1] += start[q];
    const fill = start.slice(0, cells);
    for (let g = 0; g < N; g++) sorted[fill[cellOf[g]]++] = g;
  }

  function pair(g: number, h: number) {
    const R = (rad[g] + rad[h]) * BAKE.inflate;
    if (ring[g] === ring[h]) {
      const n = cnt[ring[g]];
      let d = Math.abs(idx[g] - idx[h]);
      d = Math.min(d, n - d);
      if (d * seg[ring[g]] < R * 1.15) return;
    }
    const a = g * 3, b = h * 3;
    let dx = pos[a] - pos[b], dy = pos[a + 1] - pos[b + 1], dz = pos[a + 2] - pos[b + 2];
    if (dx * dx + dy * dy + dz * dz >= R * R) return;
    // at a crossing the strand that is over goes up (whoever is on top already stays there); anywhere
    // else bodies just push apart, so a pile can slump the way a heap does
    let o = 0, wv = 0;
    if (xing[g] >= 0 && xing[g] === xing[h] && xside[g] !== xside[h]) {
      const x = tangle.crossings[xing[g]];
      o = Math.abs(dy) > 0.2 * R ? Math.sign(dy) : (xside[g] === 0) === x.aOver ? 1 : -1;
      wv = Math.min(xw[g], xw[h]);
    }
    if (wv > 0) {
      const dh = Math.sqrt(dx * dx + dz * dz);
      if (dh < R) {
        const need = Math.sqrt(R * R - dh * dh), cur = dy * o;
        if (cur < need) {
          const c2 = (need - cur) * 0.5 * wv;
          pos[a + 1] += o * c2; pos[b + 1] -= o * c2;
        }
      }
      if (wv >= 1) return;
      dx = pos[a] - pos[b]; dy = pos[a + 1] - pos[b + 1]; dz = pos[a + 2] - pos[b + 2];
    }
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    if (d >= R) return;
    const c3 = ((R - d) / d) * 0.5 * (1 - wv);
    pos[a] += dx * c3; pos[a + 1] += dy * c3; pos[a + 2] += dz * c3;
    pos[b] -= dx * c3; pos[b + 1] -= dy * c3; pos[b + 2] -= dz * c3;
  }

  function collide() {
    grid();
    for (let g = 0; g < N; g++) {
      const c0 = cellOf[g], cx = c0 % gnx, cz = (c0 - cx) / gnx;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx, zz = cz + dz;
        if (xx < 0 || xx >= gnx || zz < 0 || zz >= gnz) continue;
        const q0 = xx + zz * gnx;
        for (let q = start[q0]; q < start[q0 + 1]; q++) { const h = sorted[q]; if (h > g) pair(g, h); }
      }
    }
  }

  function link(a: number, b: number, rest: number, k: number, min: boolean) {
    const A = a * 3, B = b * 3;
    const dx = pos[B] - pos[A], dy = pos[B + 1] - pos[A + 1], dz = pos[B + 2] - pos[A + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    if (min && d >= rest) return;
    const c = ((d - rest) / d) * 0.5 * k;
    pos[A] += dx * c; pos[A + 1] += dy * c; pos[A + 2] += dz * c;
    pos[B] -= dx * c; pos[B + 1] -= dy * c; pos[B + 2] -= dz * c;
  }

  const dt = 1 / 60, h = dt / substeps;
  const steps = Math.round(seconds / dt);
  for (let st = 0; st < steps; st++) {
    // gravity eases in, so the pile is laid down rather than dropped
    const gEase = Math.min(1, st / (steps * 0.3));
    // pulled back onto the drawing in x z: firmly at first, then let go a little so the pile can find its rest
    const pullRate = 1 - Math.exp(-(st < steps * 0.5 ? 6 : BAKE.pullLate) * h);
    for (let sub = 0; sub < substeps; sub++) {
      for (let g = 0; g < N; g++) {
        const k = g * 3;
        const vx = (pos[k] - prev[k]) * 0.9, vy = (pos[k + 1] - prev[k + 1]) * 0.8, vz = (pos[k + 2] - prev[k + 2]) * 0.9;
        prev[k] = pos[k]; prev[k + 1] = pos[k + 1]; prev[k + 2] = pos[k + 2];
        pos[k] += vx; pos[k + 1] += vy - 9.81 * gEase * h * h; pos[k + 2] += vz;
      }
      for (let it = 0; it < iters; it++) {
        for (let g = 0; g < N; g++) {
          pos[g * 3] += (tx[g] - pos[g * 3]) * pullRate;
          pos[g * 3 + 2] += (tz[g] - pos[g * 3 + 2]) * pullRate;
        }
        for (let k = 0; k < paths.length; k++) {
          const o = off[k], n = cnt[k], s = seg[k];
          for (let i = 0; i < n; i++) link(o + i, o + ((i + 1) % n), s, 1, false);
          for (let i = 0; i < n; i++) link(o + i, o + ((i + 2) % n), s * 1.7, 0.5, true);
          // no bend tighter than twice the body's radius, or the skin folds into itself
          const Rb = radii[k] * BAKE.bend;
          for (const q of [3, 6]) {
            const chord = 2 * Rb * Math.sin(Math.min(Math.PI / 2, (q * s) / (2 * Rb)));
            for (let i = 0; i < n; i++) link(o + i, o + ((i + q) % n), chord, 0.4, true);
          }
        }
        collide();
        for (let g = 0; g < N; g++) if (pos[g * 3 + 1] < rad[g] * BAKE.inflate) pos[g * 3 + 1] = rad[g] * BAKE.inflate;
      }
    }
  }
  return { off, cnt, seg, pos, rad };
}

/** relax every ring along its length, the loop closed */
export function smoothRings(s: Settled, passes = 2) {
  const { off, cnt, pos } = s;
  for (let k = 0; k < off.length; k++) {
    const o = off[k], n = cnt[k];
    const tmp = new Float32Array(n * 3);
    for (let p = 0; p < passes; p++) {
      for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) {
        const l = (i - 1 + n) % n, r = (i + 1) % n;
        tmp[i * 3 + a] = pos[(o + i) * 3 + a] * 0.5 + (pos[(o + l) * 3 + a] + pos[(o + r) * 3 + a]) * 0.25;
      }
      for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) pos[(o + i) * 3 + a] = tmp[i * 3 + a];
    }
    // never below the ground
    for (let i = 0; i < n; i++) pos[(o + i) * 3 + 1] = Math.max(pos[(o + i) * 3 + 1], s.rad[o + i]);
  }
}

export interface Score {
  score: number;
  maxPen: number; // mm, the deepest any body is in another
  sumPen: number; // mm summed over every pair of spheres
  coverage: number; // 0..1 of what the camera sees covered by a body
  layers: number; // the highest body, in python thicknesses
}

/** pairs of spheres from different parts of the knot, with how far they are in each other */
function eachOverlap(s: Settled, cb: (g: number, h: number, pen: number, dy: number, dh: number) => void) {
  const { off, cnt, seg, pos, rad } = s;
  const N = pos.length / 3;
  const ring = new Uint8Array(N), idx = new Uint16Array(N);
  off.forEach((o, k) => { for (let i = 0; i < cnt[k]; i++) { ring[o + i] = k; idx[o + i] = i; } });
  const cells = new Map<number, number[]>();
  const key = (x: number, z: number) => Math.floor(x / CELL + 1000) * 100000 + Math.floor(z / CELL + 1000);
  for (let g = 0; g < N; g++) {
    const k = key(pos[g * 3], pos[g * 3 + 2]);
    let l = cells.get(k);
    if (!l) cells.set(k, (l = []));
    l.push(g);
  }
  for (let g = 0; g < N; g++) {
    const cx = Math.floor(pos[g * 3] / CELL + 1000), cz = Math.floor(pos[g * 3 + 2] / CELL + 1000);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = cells.get((cx + dx) * 100000 + cz + dz);
      if (!l) continue;
      for (const h of l) {
        if (h === g) continue;
        if (ring[g] === ring[h]) {
          const n = cnt[ring[g]];
          let d = Math.abs(idx[g] - idx[h]);
          d = Math.min(d, n - d);
          if (d * seg[ring[g]] < (rad[g] + rad[h]) * 1.6) continue;
        }
        const ddx = pos[g * 3] - pos[h * 3], ddy = pos[g * 3 + 1] - pos[h * 3 + 1], ddz = pos[g * 3 + 2] - pos[h * 3 + 2];
        const dh = Math.hypot(ddx, ddz);
        cb(g, h, rad[g] + rad[h] - Math.hypot(dh, ddy), ddy, dh);
      }
    }
  }
}

export function score(s: Settled): Score {
  let maxPen = 0, sumPen = 0;
  eachOverlap(s, (g, h, pen) => {
    if (h < g || pen <= 0) return;
    maxPen = Math.max(maxPen, pen); sumPen += pen;
  });
  // coverage: a grid over what the camera sees, each point under a body or not
  const vw = AREA.w * VIEW, vh = AREA.h * VIEW, st = 0.003;
  const nx = Math.ceil(vw / st), nz = Math.ceil(vh / st);
  const hit = new Uint8Array(nx * nz);
  const { pos, rad } = s;
  for (let g = 0; g < pos.length / 3; g++) {
    const r = rad[g] * 0.92, x = pos[g * 3] + vw / 2, z = pos[g * 3 + 2] + vh / 2;
    for (let i = Math.max(0, Math.floor((x - r) / st)); i <= Math.min(nx - 1, Math.ceil((x + r) / st)); i++) {
      for (let j = Math.max(0, Math.floor((z - r) / st)); j <= Math.min(nz - 1, Math.ceil((z + r) / st)); j++) {
        if ((i * st - x) ** 2 + (j * st - z) ** 2 < r * r) hit[i + j * nx] = 1;
      }
    }
  }
  const coverage = hit.reduce((a, b) => a + b, 0) / hit.length;
  // how deep the pile is: the top of the bodies, all but the highest one in a hundred
  const tops: number[] = [];
  for (let g = 0; g < pos.length / 3; g++) tops.push(pos[g * 3 + 1] + rad[g]);
  tops.sort((a, b) => a - b);
  const layers = tops[Math.floor(tops.length * 0.99)] / (2 * RADIUS[0]);
  const mm = 1000;
  const scoreV = coverage * 100 - maxPen * mm * 3 - sumPen * mm * 0.05 - Math.max(0, layers - 3) * 40;
  return { score: scoreV, maxPen: maxPen * mm, sumPen: sumPen * mm, coverage, layers };
}

/** per sphere: 1 where nothing lies over the body (a head can come up there), 0 where something does */
export function clearance(s: Settled) {
  const N = s.pos.length / 3;
  const covered = new Uint8Array(N);
  eachOverlap(s, (g, h, _pen, dy, dh) => {
    if (dy < 0 && dh < (s.rad[g] + s.rad[h]) * 0.9) covered[g] = 1;
  });
  const out = new Float32Array(N);
  s.off.forEach((o, k) => {
    const n = s.cnt[k];
    // a head needs room for a while either side
    for (let i = 0; i < n; i++) {
      let c = 1;
      for (let d = -8; d <= 8 && c; d++) if (covered[o + ((i + d + n) % n)]) c = 0;
      out[o + i] = c;
    }
  });
  return out;
}
