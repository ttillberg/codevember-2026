// The snakes at run time. The knot was made offline (bake.ts): eight loops let fall into one another
// under hard physics until still, each kept as a track in three dimensions. Here every snake only
// glides along its track, a train on its rails, as a snake's body follows exactly where its head
// went: nothing can shake, nothing can sink into anything.
// Every snake goes once round its loop in PERIOD seconds, in slow pushes and pauses that add up to
// exactly one lap; its head comes up to look round where nothing lies over it. All of it periodic,
// so the whole knot loops seamlessly every PERIOD seconds.
// Hold one down and it gets away along its track: one smooth dash on top of its crawl, at full speed
// in a fraction of a second, back to a crawl over a few. The ones lying next to it start too, less.
// However far it runs it is still on its own track, so a scare never undoes the knot.
import data from './tracks.json';
import type { Species } from './species';

export const PERIOD = 90;
export const SEG = 0.018;
const CELL = 0.05;
/** bodies are drawn this much thinner than the track was baked with: the bake writes it down */
const INFLATE = data.inflate;
/** a scared snake: how fast it dashes at most (m/s), how fast it gets there (1/s), how fast it calms down (1/s) */
export const SCARE = { speed: 0.22, up: 10, calm: 0.38 };

export interface Track {
  species: number;
  radius: number;
  len: number;
  n: number;
  step: number;
  xyz: Float32Array;
  /** 0..1 along the track: how free the space above it is */
  clear: Float32Array;
}

export function loadTracks(portrait: boolean): Track[] {
  return data.tracks.map((t) => {
    const xyz = new Float32Array(t.xyz.length);
    for (let i = 0; i < t.n; i++) {
      const x = t.xyz[i * 3] / 1e5, y = t.xyz[i * 3 + 1] / 1e5, z = t.xyz[i * 3 + 2] / 1e5;
      // portrait screens get the knot turned a quarter
      xyz[i * 3] = portrait ? z : x;
      xyz[i * 3 + 1] = y;
      xyz[i * 3 + 2] = portrait ? -x : z;
    }
    // the free space above, softened along the track so a head eases up and down
    const clear = new Float32Array(t.n);
    const W = 10;
    for (let i = 0; i < t.n; i++) {
      let s = 0;
      for (let d = -W; d <= W; d++) s += t.clear[(i + d + t.n) % t.n];
      clear[i] = s / (2 * W + 1);
    }
    return { species: t.species, radius: t.radius, len: t.len, n: t.n, step: t.len / t.n, xyz, clear };
  });
}

const tp = { x: 0, y: 0, z: 0, tx: 0, tz: 0, clear: 0 };
/** the point s along a track, its direction on the ground and the room above it, into `tp` */
function trackAt(t: Track, s: number) {
  const out = tp;
  let f = (s % t.len) / t.step;
  if (f < 0) f += t.n;
  const i = Math.floor(f) % t.n, j = (i + 1) % t.n, u = f - Math.floor(f);
  const a = i * 3, b = j * 3, p = t.xyz;
  out.x = p[a] + (p[b] - p[a]) * u;
  out.y = p[a + 1] + (p[b + 1] - p[a + 1]) * u;
  out.z = p[a + 2] + (p[b + 2] - p[a + 2]) * u;
  const l = Math.hypot(p[b] - p[a], p[b + 2] - p[a + 2]) || 1;
  out.tx = (p[b] - p[a]) / l;
  out.tz = (p[b + 2] - p[a + 2]) / l;
  out.clear = t.clear[i] + (t.clear[j] - t.clear[i]) * u;
  return out;
}

export function radiusAt(sp: Species, t: number) {
  const ss = (a: number, b: number, x: number) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  let r = sp.neck + (sp.radius - sp.neck) * ss(0, 0.28, t);
  r *= 1 - 0.18 * ss(0.5, sp.vent, t);
  // the tail: tapering to a blunt point, not a string
  r *= 1 - 0.8 * Math.pow(ss(sp.vent - 0.03, 1, t), 1.1);
  return Math.max(r, 0.003);
}

export interface Snake {
  sp: Species;
  n: number;
  seg: number;
  /** spheres from the snout (0) to the tail tip, each where it belongs on the track this frame */
  pos: Float32Array;
  rad: Float32Array; // body radius, as drawn
  col: Float32Array; // as baked: the track's centre line runs this far up
  track: Track;
  pathIndex: number;
  /** arc length of the snout along the track */
  head: number;
  head0: number;
  clock: number;
  /** how far it has dashed when scared, on top of its crawl */
  dash: number;
  headK: number;
  lift: number;
  look: number;
  /** 0..1: how scared it is (jumps on a stroke, calms slowly), and how fast it is going about it
   * (follows the scare quickly: a sharp start, no jump) */
  scare: number;
  rush: number;
  /** its pushes and pauses, its looking about: whole numbers of them per lap */
  beat: { pushes: number; pushPh: number; looks: number; lookPh: number; sways: number; swayPh: number };
}

export function createSnake(sp: Species, track: Track, index: number, head0: number, seed: number): Snake {
  const seg = SEG;
  const headK = Math.max(2, Math.round(sp.headLength / seg));
  // each snake fills four fifths of its loop
  const bodyN = Math.round((track.len * 0.8 - sp.headLength) / seg) + 1;
  const n = headK + bodyN;
  const rad = new Float32Array(n), col = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.max(0, (i - headK) / (bodyN - 1));
    rad[i] = i < headK ? sp.headWidth * (0.55 + 0.45 * (i / headK)) : radiusAt(sp, t);
    col[i] = rad[i] * INFLATE;
  }
  const r = (k: number) => {
    const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const s: Snake = {
    sp, n, seg, pos: new Float32Array(n * 3), rad, col, track, pathIndex: index, head: head0, head0, clock: 0, dash: 0, headK,
    lift: 0, look: 0, scare: 0, rush: 0,
    beat: {
      pushes: 5 + Math.floor(r(1) * 5), pushPh: r(2) * Math.PI * 2,
      looks: 3 + Math.floor(r(3) * 3), lookPh: r(4) * Math.PI * 2,
      sways: 11 + Math.floor(r(5) * 6), swayPh: r(6) * Math.PI * 2,
    },
  };
  place(s);
  return s;
}

/** where the snout is at a time on the snake's clock: one lap per PERIOD, in pushes that add up to it */
function headAt(s: Snake, t: number) {
  const L = s.track.len, w = (2 * Math.PI * s.beat.pushes) / PERIOD, a = 0.75;
  return s.head0 + (L * t) / PERIOD - ((L / PERIOD) * a / w) * (Math.cos(w * t + s.beat.pushPh) - Math.cos(s.beat.pushPh));
}

/** the head lifting to look about and swaying: periodic on the snake's clock; a scared snake keeps its head down */
function behave(s: Snake) {
  const u = (s.clock / PERIOD) * Math.PI * 2;
  const up = Math.max(0, Math.sin(u * s.beat.looks + s.beat.lookPh) * 1.3 - 0.3) * (1 - s.rush);
  trackAt(s.track, s.head);
  // only where nothing lies over it
  s.lift = s.sp.lift * up * tp.clear;
  s.look = Math.sin(u * s.beat.sways + s.beat.swayPh) * 0.012 * (0.3 + up) * tp.clear;
}

/** every sphere's place on the track, the head raised and swaying */
function place(s: Snake) {
  const { pos, n, seg, headK } = s;
  const lookN = headK + 10;
  const R = s.track.radius * INFLATE;
  for (let i = 0; i < n; i++) {
    trackAt(s.track, s.head - i * seg);
    let x = tp.x, y = tp.y - (R - s.col[i]), z = tp.z;
    if (i < lookN) {
      const f = (1 - i / lookN) ** 1.6;
      y += s.lift * f;
      const g = (1 - i / lookN) ** 2;
      x += -tp.tz * s.look * g;
      z += tp.tx * s.look * g;
    }
    pos[i * 3] = x; pos[i * 3 + 1] = Math.max(y, s.col[i]); pos[i * 3 + 2] = z;
  }
}

export function createWorld(snakes: Snake[]) {
  // every sphere of every snake, on a grid over the ground (for the bodies' occlusion)
  const total = snakes.reduce((t, s) => t + s.n, 0);
  const gS = new Uint8Array(total), gI = new Uint16Array(total);
  {
    let g = 0;
    snakes.forEach((s, k) => { for (let i = 0; i < s.n; i++) { gS[g] = k; gI[g] = i; g++; } });
  }
  const cellOf = new Int32Array(total);
  const sorted = new Int32Array(total);
  let start = new Int32Array(1);
  let gx0 = 0, gz0 = 0, gnx = 1, gnz = 1;
  function buildGrid() {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let g = 0; g < total; g++) {
      const p = snakes[gS[g]].pos, k = gI[g] * 3;
      x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); z0 = Math.min(z0, p[k + 2]); z1 = Math.max(z1, p[k + 2]);
    }
    x0 = Math.max(x0, -3); z0 = Math.max(z0, -3); x1 = Math.min(x1, 3); z1 = Math.min(z1, 3);
    gx0 = x0 - CELL; gz0 = z0 - CELL;
    gnx = Math.ceil((x1 - gx0) / CELL) + 2; gnz = Math.ceil((z1 - gz0) / CELL) + 2;
    const cells = gnx * gnz;
    if (start.length < cells + 1) start = new Int32Array(cells + 1);
    start.fill(0, 0, cells + 1);
    for (let g = 0; g < total; g++) {
      const p = snakes[gS[g]].pos, k = gI[g] * 3;
      const ix = Math.min(gnx - 1, Math.max(0, Math.floor((p[k] - gx0) / CELL)));
      const iz = Math.min(gnz - 1, Math.max(0, Math.floor((p[k + 2] - gz0) / CELL)));
      const c = ix + iz * gnx;
      cellOf[g] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const fill = start.slice(0, cells);
    for (let g = 0; g < total; g++) sorted[fill[cellOf[g]]++] = g;
  }
  /** spheres within a cell of (x, z): calls back with snake index and sphere index */
  function near(x: number, z: number, cb: (s: number, i: number) => void) {
    const cx = Math.floor((x - gx0) / CELL), cz = Math.floor((z - gz0) / CELL);
    for (let dz = -1; dz <= 1; dz++) {
      const zz = cz + dz;
      if (zz < 0 || zz >= gnz) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= gnx) continue;
        const c = xx + zz * gnx;
        for (let q = start[c]; q < start[c + 1]; q++) cb(gS[sorted[q]], gI[sorted[q]]);
      }
    }
  }

  function step(dt: number) {
    dt = Math.min(dt, 1 / 30);
    for (const s of snakes) {
      s.scare *= Math.exp(-dt * SCARE.calm);
      s.rush += (s.scare - s.rush) * (1 - Math.exp(-dt * SCARE.up));
      s.clock += dt;
      s.dash += dt * SCARE.speed * s.rush * s.rush;
      s.head = headAt(s, s.clock) + s.dash;
      behave(s);
      place(s);
    }
    buildGrid();
  }

  return {
    snakes,
    step,
    near,
    /** snake `s` scared at sphere `i` (0..1 how much): it gets away, and the ones lying close by start too */
    stroke(s: Snake, i: number, amount: number) {
      s.scare = Math.max(s.scare, amount);
      const x = s.pos[i * 3], z = s.pos[i * 3 + 2];
      for (const o of snakes) {
        if (o === s) continue;
        let d = 1e9;
        for (let j = 0; j < o.n; j++) d = Math.min(d, Math.hypot(o.pos[j * 3] - x, o.pos[j * 3 + 2] - z) - o.rad[j]);
        o.scare = Math.max(o.scare, amount * 0.45 * Math.min(1, Math.max(0, 1 - d / 0.06)));
      }
    },
  };
}

export type World = ReturnType<typeof createWorld>;
