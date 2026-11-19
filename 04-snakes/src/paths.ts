// The drawing of the knot: closed paths on the ground, one per snake, and where they cross, which one
// goes over. Heights are not drawn here: bake.ts lets the loops fall into one another under physics
// and keeps where they come to rest.

export interface Path {
  len: number;
  /** samples every `step` metres along the loop, x z pairs */
  xz: Float32Array;
  step: number;
  n: number;
}

export interface Crossing {
  a: number; // path index of the first strand
  b: number; // path index of the second (same as a for a self crossing)
  sa: number; // arc length along a
  sb: number; // arc length along b
  aOver: boolean;
}

const TAU = Math.PI * 2;

function closedCurve(f: (t: number) => [number, number], n = 16000, step = 0.004): Path {
  const raw: [number, number][] = [];
  for (let i = 0; i < n; i++) raw.push(f((i / n) * TAU));
  const cum = [0];
  for (let i = 1; i <= n; i++) {
    const p = raw[i - 1], q = raw[i % n];
    cum.push(cum[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const len = cum[n];
  const m = Math.floor(len / step);
  const st = len / m;
  const xz = new Float32Array(m * 2);
  let k = 0;
  for (let i = 0; i < m; i++) {
    const s = i * st;
    while (cum[k + 1] < s) k++;
    const t = (s - cum[k]) / (cum[k + 1] - cum[k]);
    const p = raw[k], q = raw[(k + 1) % n];
    xz[i * 2] = p[0] + (q[0] - p[0]) * t;
    xz[i * 2 + 1] = p[1] + (q[1] - p[1]) * t;
  }
  return { len, xz, step: st, n: m };
}

/** signed shortest difference a - b on a loop */
export function loopDiff(a: number, b: number, len: number) {
  let d = (a - b) % len;
  if (d > len / 2) d -= len;
  if (d < -len / 2) d += len;
  return d;
}

function crossings(paths: Path[]): Crossing[] {
  const out: Crossing[] = [];
  const seg = (p: Path, i: number) => {
    const a = i % p.n, b = (i + 1) % p.n;
    return [p.xz[a * 2], p.xz[a * 2 + 1], p.xz[b * 2], p.xz[b * 2 + 1]];
  };
  for (let A = 0; A < paths.length; A++) {
    for (let B = A; B < paths.length; B++) {
      const pa = paths[A], pb = paths[B];
      // every sample a segment: at 4 mm apart, close enough
      for (let i = 0; i < pa.n; i++) {
        const [x1, y1, x2, y2] = seg(pa, i);
        for (let j = A === B ? i + 2 : 0; j < pb.n; j++) {
          if (A === B && i === 0 && j === pb.n - 1) continue;
          const [x3, y3, x4, y4] = seg(pb, j);
          const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
          if (Math.abs(d) < 1e-12) continue;
          const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
          const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
          if (t >= 0 && t < 1 && u >= 0 && u < 1) {
            out.push({ a: A, b: B, sa: (i + t) * pa.step, sb: (j + u) * pb.step, aOver: true });
          }
        }
      }
    }
  }
  return out;
}

export interface Tangle {
  paths: Path[];
  crossings: Crossing[];
}

export function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** two strands that touch and cross straight back make two crossings a few centimetres apart.
 * No body can be over, then under, then over in that space: drop both (a Reidemeister II move,
 * the knot is the same without them) */
function dropKisses(paths: Path[], cr: Crossing[]) {
  const gone = new Set<Crossing>();
  for (let i = 0; i < cr.length; i++) {
    for (let j = i + 1; j < cr.length; j++) {
      const p = cr[i], q = cr[j];
      if (gone.has(p) || gone.has(q) || p.a !== q.a || p.b !== q.b) continue;
      const da = Math.abs(loopDiff(p.sa, q.sa, paths[p.a].len));
      const db = Math.abs(loopDiff(p.sb, q.sb, paths[p.b].len));
      if (da < 0.12 && db < 0.12) { gone.add(p); gone.add(q); }
    }
  }
  return cr.filter((c) => !gone.has(c));
}

/** the loops and where they cross; which strand goes over is left to the caller (bake.ts) */
export function buildTangle(paths: Path[]): Tangle {
  return { paths, crossings: dropKisses(paths, crossings(paths)) };
}

/** a Lissajous figure a:b, stretched to w by h, bent off true by a little low noise so it reads as a body
 * and not as a plot. Turned by `rot` (radians) before stretching */
export function lissajous(a: number, b: number, phase: number, w: number, h: number, seed: number, wob: number, rot = 0, ox = 0, oz = 0): Path {
  const r = rng(seed);
  const n: number[][] = [];
  for (let k = 0; k < 4; k++) n.push([r() * TAU, r() * TAU, (0.5 + r()) / (k + 1)]);
  const f = (t: number): [number, number] => {
    let x = Math.sin(a * t + phase), z = Math.sin(b * t);
    for (let k = 0; k < 4; k++) {
      x += wob * n[k][2] * Math.sin((k + 2) * t + n[k][0]);
      z += wob * n[k][2] * Math.cos((k + 3) * t + n[k][1]);
    }
    const c = Math.cos(rot), s = Math.sin(rot);
    return [x * c - z * s, x * s + z * c];
  };
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < 4000; i++) {
    const [x, z] = f((i / 4000) * TAU);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return closedCurve((t) => {
    const [x, z] = f(t);
    return [((x - x0) / (x1 - x0) - 0.5) * w + ox, ((z - z0) / (z1 - z0) - 0.5) * h + oz];
  });
}

/** an S-wave laid along a path, as a snake's body lies: `amp` metres to the side, every `wave` metres,
 * the amplitude swelling and fading so it never reads as a sine */
export function undulate(p: Path, amp: number, wave: number, seed: number): Path {
  const r = rng(seed);
  const ph = [r() * TAU, r() * TAU, r() * TAU];
  const out = new Float32Array(p.n * 2);
  for (let i = 0; i < p.n; i++) {
    const a = (i - 3 + p.n) % p.n, b = (i + 3) % p.n;
    let nx = -(p.xz[b * 2 + 1] - p.xz[a * 2 + 1]), nz = p.xz[b * 2] - p.xz[a * 2];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    const s = i * p.step;
    // whole numbers of waves round the loop, so it closes
    const k = Math.round(p.len / wave);
    const u = (s / p.len) * TAU;
    const swell = 0.55 + 0.45 * Math.sin(u * 3 + ph[0]) * Math.sin(u * 7 + ph[1]);
    const o = amp * swell * Math.sin(u * k + 0.6 * Math.sin(u * 5 + ph[2]));
    out[i * 2] = p.xz[i * 2] + nx * o;
    out[i * 2 + 1] = p.xz[i * 2 + 1] + nz * o;
  }
  return closedCurve((t) => {
    const f = (t / TAU) * p.n;
    const i = Math.floor(f) % p.n, j = (i + 1) % p.n, q = f - Math.floor(f);
    return [out[i * 2] + (out[j * 2] - out[i * 2]) * q, out[i * 2 + 1] + (out[j * 2 + 1] - out[i * 2 + 1]) * q];
  });
}
