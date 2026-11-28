// The burrow: a graph of tunnels under a hillside, kept as one distance-like field on a grid ("air": negative in the
// open, positive in the ground), meshed once with surface nets. The same grid answers every question the scene asks
// later: where is the wall, where does a crumb land, how far does the beam reach.
import * as THREE from 'three';
import { Perlin, mulberry32 } from './noise';

export const CELL = 0.03;
const BIG = 0.5;

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);
export const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The ground lies in layers: height with the layers' own slow buckling in it. Mirrored in the soil shader (gfx.ts). */
export const strataY = (x: number, y: number, z: number) => y + 0.1 * Math.sin(x * 1.3 + 0.7 * Math.sin(z * 0.9)) + 0.07 * Math.sin(z * 1.7 + x * 0.6);
/** 1 inside a layer at height c, half-thickness w */
const band = (y: number, c: number, w: number) => 1 - sstep(w * 0.4, w, Math.abs(y - c));

export interface RailEdge {
  a: number;
  b: number;
  pts: THREE.Vector3[];
  rad: number[];
  cum: number[];
  len: number;
  /** the stretch in front of the hole, under the sky */
  open: boolean;
}

// name, x, y, z, radius. The hill is entered at E looking down -z.
const NODES: [string, number, number, number, number][] = [
  ['O', 0.04, 0.1, 0.98, 0.26],
  ['E', 0.0, 0.0, 0.0, 0.25],
  ['A', 0.18, -0.32, -1.55, 0.3],
  ['B', -0.05, -0.58, -3.05, 0.37],
  ['C', -1.35, -0.72, -4.25, 0.3],
  ['D', 1.2, -0.7, -4.35, 0.31],
  ['G', -0.05, -1.02, -5.7, 0.36],
  ['F', -2.1, -0.92, -5.85, 0.33],
  ['J', -2.55, -1.05, -7.45, 0.25],
  ['L', -1.1, -1.25, -7.35, 0.29],
  ['I', 0.25, -1.32, -7.3, 0.37],
  ['H', 2.0, -0.92, -5.95, 0.3],
  ['K', 1.55, -1.22, -7.55, 0.28],
  ['N', 0.35, -1.5, -8.7, 0.36],
  // the lower level: a long way down from J, round under the west of the den and back up to L
  ['P', -2.62, -1.62, -9.05, 0.29],
  ['Q', -1.55, -2.2, -11.45, 0.33],
];
/** the edges of the first level: they keep the dice they always had, whatever is dug after them */
const FIRST = 16;
const EDGES: [string, string][] = [
  ['O', 'E'], ['E', 'A'], ['A', 'B'], ['B', 'C'], ['B', 'D'], ['C', 'G'], ['D', 'G'], ['C', 'F'],
  ['F', 'J'], ['F', 'L'], ['L', 'I'], ['G', 'I'], ['D', 'H'], ['H', 'K'], ['K', 'I'], ['I', 'N'],
  ['J', 'P'], ['P', 'Q'], ['Q', 'L'],
];

const cubeEdges = new Int32Array(24);
const edgeTable = new Int32Array(256);
{
  let k = 0;
  for (let i = 0; i < 8; ++i)
    for (let j = 1; j <= 4; j <<= 1) {
      const p = i ^ j;
      if (i <= p) { cubeEdges[k++] = i; cubeEdges[k++] = p; }
    }
  for (let i = 0; i < 256; ++i) {
    let em = 0;
    for (let j = 0; j < 24; j += 2) {
      const a = !!(i & (1 << cubeEdges[j])), b = !!(i & (1 << cubeEdges[j + 1]));
      em |= a !== b ? 1 << (j >> 1) : 0;
    }
    edgeTable[i] = em;
  }
}

export class World {
  nodes: { name: string; p: THREE.Vector3; r: number }[] = [];
  edges: RailEdge[] = [];
  /** edge indices at each node */
  adj: number[][] = [];
  entrance = new THREE.Vector3();
  /** the nest chamber past the last node: its centre, the way further in (level), and its floor */
  den = { c: new THREE.Vector3(), back: new THREE.Vector3(), floor: 0 };
  /** where water stands: the middle of each shallow bowl in the floor, the level of its surface, how far it can reach */
  puddles: { x: number; y: number; z: number; r: number }[] = [];
  nx: number; ny: number; nz: number;
  x0: number; y0: number; z0: number;
  h = CELL;
  air: Float32Array;
  private P: Perlin;
  private hcol: Float32Array;

  constructor(seed = 27) {
    const rnd0 = mulberry32(seed), rnd2 = mulberry32(seed + 1000);
    let rnd = rnd0;
    const P = (this.P = new Perlin(seed));
    const idx = new Map<string, number>();
    for (const [name, x, y, z, r] of NODES) {
      idx.set(name, this.nodes.length);
      this.nodes.push({ name, p: new THREE.Vector3(x, y, z), r });
      this.adj.push([]);
    }
    this.entrance.copy(this.nodes[idx.get('E')!].p);

    const up = new THREE.Vector3(0, 1, 0);
    for (const [an, bn] of EDGES) {
      rnd = this.edges.length < FIRST ? rnd0 : rnd2;
      const a = idx.get(an)!, b = idx.get(bn)!;
      const pa = this.nodes[a].p, pb = this.nodes[b].p;
      const open = an === 'O';
      const dir = pb.clone().sub(pa);
      const L = dir.length();
      dir.normalize();
      const lat = new THREE.Vector3().crossVectors(dir, up).normalize();
      const ctrl = [pa.clone()];
      const mids = open || bn === 'N' || an === 'E' ? 0 : L > 2.1 ? 2 : 1;
      // (the long run up from Q is all but straight: from its top there is a clear look down the whole of it)
      const wander = an === 'Q' ? 0.12 : 0.62;
      for (let i = 0; i < mids; i++) {
        const t = (i + 1) / (mids + 1);
        ctrl.push(
          pa.clone().lerp(pb, t)
            .addScaledVector(lat, (rnd() - 0.5) * wander)
            .addScaledVector(up, (rnd() - 0.5) * 0.14),
        );
      }
      ctrl.push(pb.clone());
      const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
      const n = Math.max(2, Math.ceil(curve.getLength() / 0.12));
      const pts = curve.getSpacedPoints(n);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const len = cum[cum.length - 1];
      const squeeze = open ? 0 : rnd() * 0.07;
      const ph = rnd() * 50;
      const rad = pts.map((_, i) => {
        const t = cum[i] / len;
        const s = Math.sin(Math.PI * t);
        return this.nodes[a].r + (this.nodes[b].r - this.nodes[a].r) * t - squeeze * s * s + 0.03 * P.n(cum[i] * 1.3, ph, 0.5);
      });
      this.adj[a].push(this.edges.length);
      this.adj[b].push(this.edges.length);
      this.edges.push({ a, b, pts, rad, cum, len, open });
    }

    // grid bounds
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const n of this.nodes) {
      lo.min(n.p.clone().subScalar(n.r + 0.42));
      hi.max(n.p.clone().addScalar(n.r + 0.42));
    }
    {
      const I = this.nodes[idx.get('I')!].p, N = this.nodes[idx.get('N')!].p;
      this.den.back.set(N.x - I.x, 0, N.z - I.z).normalize();
      this.den.c.copy(N).addScaledVector(this.den.back, 0.8);
      this.den.c.y = N.y - 0.08;
      this.den.floor = this.den.c.y - 0.3;
      lo.min(this.den.c.clone().subScalar(1.5));
      hi.max(this.den.c.clone().addScalar(1.5));
    }
    lo.x = Math.min(lo.x, -3.3); hi.x = Math.max(hi.x, 3.1);
    hi.y = 1.3; hi.z = 1.75;
    const h = this.h;
    this.x0 = lo.x; this.y0 = lo.y; this.z0 = lo.z;
    const nx = (this.nx = Math.ceil((hi.x - lo.x) / h) + 1);
    const ny = (this.ny = Math.ceil((hi.y - lo.y) / h) + 1);
    const nz = (this.nz = Math.ceil((hi.z - lo.z) / h) + 1);
    const air = (this.air = new Float32Array(nx * ny * nz).fill(BIG));

    // 1. tunnels: capsules along every rail edge, floor trodden flat, walls faintly scraped in rings
    for (const e of this.edges) {
      const step = 2;
      for (let i = 0; i + 1 < e.pts.length; i += step) {
        const j = Math.min(i + step, e.pts.length - 1);
        this.stampTube(e.pts[i], e.pts[j], e.rad[i], e.rad[j], e.cum[i], e.cum[j] - e.cum[i], e.open);
      }
    }
    this.stampDen(1.05, 0.78, 0.5);

    // 2. hollows: pockets where something fell or was dug out, alcoves, and the holes of smaller lodgers
    const fr = { c: new THREE.Vector3(), T: new THREE.Vector3(), side: new THREE.Vector3(), up: new THREE.Vector3(), d: new THREE.Vector3() };
    const wallAt = (e: RailEdge, s: number, phi: number): number => {
      this.railPoint(e, s, fr.c);
      this.railTangent(e, s, fr.T);
      fr.side.crossVectors(fr.T, up).normalize();
      fr.up.crossVectors(fr.side, fr.T);
      fr.d.copy(fr.up).multiplyScalar(Math.cos(phi)).addScaledVector(fr.side, Math.sin(phi));
      return this.march(fr.c, fr.d, 1.2);
    };
    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
    for (const e of this.edges) {
      if (e.open) continue;
      rnd = this.edges.indexOf(e) < FIRST ? rnd0 : rnd2;
      const along = () => 0.3 + rnd() * Math.max(0.1, e.len - 0.6);
      const around = () => (rnd() < 0.5 ? -1 : 1) * (0.2 + rnd() * 1.9); // anywhere but the floor
      for (let i = Math.round(e.len * 2.4); i > 0; i--) {
        const t = wallAt(e, along(), around());
        if (t >= 1.2) continue;
        const r = 0.035 + rnd() * rnd() * 0.1;
        pa.copy(fr.c).addScaledVector(fr.d, t + r * (rnd() - 0.5));
        this.carve(pa, pa, r);
        // often two or three run together into one ragged hollow
        for (let k = rnd() < 0.35 ? 1 + Math.floor(rnd() * 2) : 0; k > 0; k--) {
          pb.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(r * 1.8).add(pa);
          this.carve(pb, pb, r * (0.6 + rnd() * 0.5));
        }
      }
      for (let i = Math.round(e.len * 0.32 + rnd() * 0.6); i > 0; i--) {
        const t = wallAt(e, along(), around());
        if (t >= 1.2) continue;
        const r = 0.15 + rnd() * 0.11;
        pa.copy(fr.c).addScaledVector(fr.d, t + r * 0.35);
        this.carve(pa, pa, r);
      }
      for (let i = Math.round(e.len * 0.5 + rnd() * 0.7); i > 0; i--) {
        const t = wallAt(e, along(), around());
        if (t >= 1.2) continue;
        // a narrow run going off into the ground, bending a little, ending in the dark
        pa.copy(fr.c).addScaledVector(fr.d, t - 0.03);
        pb.copy(fr.d).addScaledVector(fr.T, (rnd() - 0.5) * 0.9).addScaledVector(up, (rnd() - 0.5) * 0.5 - 0.1).normalize().multiplyScalar(0.22 + rnd() * 0.3).add(pa);
        this.carve(pa, pb, 0.045 + rnd() * 0.03);
      }
    }

    // 2b. what is neither tunnel nor room: cracks, chimneys, pits, low nooks. (Their own dice: the hollows stay put.)
    {
      const r2 = mulberry32(seed + 2000);
      const u = new THREE.Vector3(), v = new THREE.Vector3(), pc = new THREE.Vector3();
      const dn = new THREE.Vector3(0, -1, 0);
      /** may this be dug here: inside the grid with room to spare, and well under the hillside */
      const sound = (p: THREE.Vector3, m: number) =>
        p.x > lo.x + m && p.x < hi.x - m && p.y > lo.y + m && p.z > lo.z + m && p.z < hi.z - m && p.y + m < this.terrainH(p.x, p.z) - 0.3;
      const sgn = () => (r2() < 0.5 ? -1 : 1);
      const dug = [0, 0, 0, 0];
      for (const e of this.edges) {
        if (e.open) continue;
        const along = () => 0.3 + r2() * Math.max(0.1, e.len - 0.6);
        // cracks: the ground has parted. A hand wide, tall, leaning, running off into the dark and closing as it goes
        for (let i = Math.round(e.len * 0.45 + r2() * 0.8); i > 0; i--) {
          const t = wallAt(e, along(), sgn() * (0.7 + r2() * 1.2));
          if (t >= 1.2) continue;
          const w = 0.045 + r2() * 0.03, k = 3.5 + r2() * 4, L = 0.35 + r2() * 0.6;
          pa.copy(fr.c).addScaledVector(fr.d, t - 0.06);
          v.copy(fr.d).addScaledVector(fr.T, (r2() - 0.5) * 1.2).addScaledVector(up, (r2() - 0.5) * 0.5).normalize();
          pb.copy(pa).addScaledVector(v, L * 0.55);
          u.copy(up).addScaledVector(fr.T, (r2() - 0.5) * 0.8).addScaledVector(fr.d, (r2() - 0.5) * 0.3).normalize();
          // (it turns a little half way in)
          v.addScaledVector(fr.T, (r2() - 0.5) * 0.9).normalize();
          pc.copy(pb).addScaledVector(v, L * 0.45);
          if (!sound(pb, w * k + 0.15) || !sound(pc, w * k + 0.15)) continue;
          this.carve(pa, pb, w, 0.3, u, k);
          this.carve(pb, pc, w * 0.7, 0.75, u, k);
          dug[0]++;
        }
        // chimneys: where a root rotted out or water found its way down, a pipe up through the roof, out of sight
        for (let i = Math.round(e.len * 0.22 + r2() * 0.7); i > 0; i--) {
          const t = wallAt(e, along(), (r2() - 0.5) * 1.1);
          if (t >= 1.2) continue;
          const w = 0.065 + r2() * 0.05, L = 0.4 + r2() * 0.7;
          pa.copy(fr.c).addScaledVector(fr.d, t - 0.05);
          v.copy(up).addScaledVector(fr.side, (r2() - 0.5) * 0.7).addScaledVector(fr.T, (r2() - 0.5) * 0.7).normalize();
          pb.copy(pa).addScaledVector(v, L * 0.5);
          v.addScaledVector(fr.side, (r2() - 0.5) * 0.8).addScaledVector(fr.T, (r2() - 0.5) * 0.8).normalize();
          pc.copy(pb).addScaledVector(v, L * 0.5);
          if (!sound(pb, w + 0.15) || !sound(pc, w + 0.15)) continue;
          this.carve(pa, pb, w, 0.2);
          this.carve(pb, pc, w * 0.8, 0.6);
          dug[1]++;
        }
        // pits: the same going down, in the corner where the floor meets the wall
        for (let i = Math.round(e.len * 0.15 + r2() * 0.6); i > 0; i--) {
          const t = wallAt(e, along(), sgn() * (2.25 + r2() * 0.35));
          if (t >= 1.2) continue;
          const w = 0.07 + r2() * 0.05, L = 0.25 + r2() * 0.45;
          pa.copy(fr.c).addScaledVector(fr.d, t - 0.04);
          v.set(fr.d.x, -1.6, fr.d.z).addScaledVector(fr.T, (r2() - 0.5) * 0.7).normalize();
          pb.copy(pa).addScaledVector(v, L);
          if (!sound(pb, w + 0.15)) continue;
          this.carve(pa, pb, w, 0.5);
          dug[2]++;
        }
        // nooks: low and wide, the floor running on under an overhang for an arm's length. Not rooms
        for (let i = Math.round(e.len * 0.25 + r2() * 0.7); i > 0; i--) {
          const sg = sgn();
          const t = wallAt(e, along(), sg * (1.75 + r2() * 0.3));
          if (t >= 1.2) continue;
          const w = 0.14 + r2() * 0.08, k = 0.5 + r2() * 0.2, L = 0.18 + r2() * 0.28;
          const floorY = fr.c.y - this.march(fr.c, dn, 0.6);
          pa.copy(fr.c).addScaledVector(fr.d, t - 0.02);
          pa.y = floorY + w * k * 0.8;
          // level, off to the side and a little along the run
          v.copy(fr.side).multiplyScalar(sg).addScaledVector(fr.T, (r2() - 0.5) * 1.4).normalize();
          pb.copy(pa).addScaledVector(v, L);
          v.addScaledVector(fr.T, (r2() - 0.5) * 1.2).normalize();
          pc.copy(pb).addScaledVector(v, L * 0.8);
          pc.y -= 0.03;
          if (!sound(pb, w + 0.15) || !sound(pc, w + 0.15)) continue;
          this.carve(pa, pb, w, 0.15, up, k);
          this.carve(pb, pc, w * 0.85, 0.55, up, k);
          dug[3]++;
        }
      }
      console.log(`burrow: ${dug[0]} cracks, ${dug[1]} chimneys, ${dug[2]} pits, ${dug[3]} nooks`);
    }

    // 3. the hillside, and the lumps of real ground
    const hcol = (this.hcol = new Float32Array(nx * nz));
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) hcol[i + nx * k] = this.terrainH(this.x0 + i * h, this.z0 + k * h);
    let q = 0;
    for (let k = 0; k < nz; k++) {
      const pz = this.z0 + k * h;
      for (let j = 0; j < ny; j++) {
        const py = this.y0 + j * h;
        for (let i = 0; i < nx; i++, q++) {
          const ground = Math.max(-BIG, Math.min(BIG, (hcol[i + nx * k] - py) * 0.8));
          let a = smin(air[q], ground, 0.12);
          if (a > -0.14 && a < 0.14) {
            const px = this.x0 + i * h;
            a += 0.042 * P.n(px * 2.3, py * 2.3, pz * 2.3) + 0.022 * P.n(px * 6.1 + 7.3, py * 6.1, pz * 6.1) + 0.011 * P.n(px * 14.3, py * 14.3 + 3.1, pz * 14.3);
            // the layers weather differently: gravel stands proud, sand has run out from between
            const yy = strataY(px, py, pz);
            a += 0.02 * band(yy, -0.93, 0.11) + 0.012 * band(yy, -0.36, 0.05) - 0.028 * band(yy, -0.69, 0.04) - 0.028 * band(yy, -1.2, 0.045);
          }
          air[q] = a;
        }
      }
    }

    // 4. a few shallow bowls in the floor, well in and low down, for water to stand in. Not many
    const cand: { e: RailEdge; s: number; k: number }[] = [];
    for (const e of this.edges) {
      if (e.open) continue;
      const first = this.edges.indexOf(e) < FIRST;
      for (let s = 0.45; s < e.len - 0.45; s += 0.25) if (this.railPoint(e, s, pa).y < -0.6) cand.push({ e, s, k: first ? rnd0() : 2 + rnd2() });
    }
    // (the first level's come first, in the order they always did; the lower level, wetter, has the last two)
    cand.sort((a, b) => a.k - b.k);
    const down = new THREE.Vector3(0, -1, 0);
    for (const c of cand) {
      rnd = c.k < 2 ? rnd0 : rnd2;
      if (this.puddles.length >= (c.k < 2 ? 6 : 8)) { if (c.k < 2) continue; break; }
      this.railPoint(c.e, c.s, pa);
      this.railTangent(c.e, c.s, pb);
      // a little off the middle of the run, where feet have not levelled it
      const off = (rnd() - 0.5) * 0.2;
      pa.x += -pb.z * off; pa.z += pb.x * off;
      if (this.puddles.some((p) => Math.hypot(p.x - pa.x, p.z - pa.z) < 1.4)) continue;
      const t = this.march(pa, down, 0.6);
      if (t >= 0.6) continue;
      const fy = pa.y - t, r = 0.13 + rnd() * 0.11, deep = 0.03 + rnd() * 0.018;
      const m = r * 1.7;
      const i0 = Math.max(0, Math.floor((pa.x - m - this.x0) / h)), i1 = Math.min(nx - 1, Math.ceil((pa.x + m - this.x0) / h));
      const j0 = Math.max(0, Math.floor((fy - 0.1 - this.y0) / h)), j1 = Math.min(ny - 1, Math.ceil((fy + 0.1 - this.y0) / h));
      const k0 = Math.max(0, Math.floor((pa.z - m - this.z0) / h)), k1 = Math.min(nz - 1, Math.ceil((pa.z + m - this.z0) / h));
      for (let k = k0; k <= k1; k++)
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const dx = this.x0 + i * h - pa.x, dz = this.z0 + k * h - pa.z;
            air[i + nx * (j + ny * k)] -= deep * Math.exp((-2 * (dx * dx + dz * dz)) / (r * r));
          }
      // filled a little over half way up; but never so full that it floods the run: where the floor slopes away the
      // level comes down until no more than a fifth of the ground within reach is under it
      const R = r * 1.35, hs: number[] = [];
      for (let a = -1; a <= 1; a += 0.125)
        for (let b = -1; b <= 1; b += 0.125) {
          if (a * a + b * b > 1) continue;
          pb.set(pa.x + a * R, fy + 0.1, pa.z + b * R);
          if (this.sample(pb.x, pb.y, pb.z) > -0.01) continue;
          hs.push(pb.y - this.march(pb, down, 0.4));
        }
      hs.sort((u, v) => u - v);
      const level = Math.min(fy - deep * 0.45, hs[Math.floor(hs.length * 0.2)] ?? fy);
      if (level - hs[0] > 0.045 || level - hs[0] < 0.008) continue; // a drop, or a damp patch: not a puddle
      this.puddles.push({ x: pa.x, y: level, z: pa.z, r: R });
    }
  }

  /**
   * Dig a rounded run from a to b (a ball if they are the same point), narrowing by `taper` of its width as it goes in.
   * With an axis u it is k times as tall along it as it is wide: a slit (k > 1) or something low and flat (k < 1).
   */
  private carve(a: THREE.Vector3, b: THREE.Vector3, r: number, taper = 0.35, u?: THREE.Vector3, k = 1) {
    const { nx, ny, nz, x0, y0, z0, h, air } = this;
    const rm = r * Math.max(1, k) + 0.06;
    const ks = 1 / (k * k) - 1;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - rm - x0) / h)), i1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x) + rm - x0) / h));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - rm - y0) / h)), j1 = Math.min(ny - 1, Math.ceil((Math.max(a.y, b.y) + rm - y0) / h));
    const k0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - rm - z0) / h)), k1 = Math.min(nz - 1, Math.ceil((Math.max(a.z, b.z) + rm - z0) / h));
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const ll = Math.max(dx * dx + dy * dy + dz * dz, 1e-9);
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++) {
        let q = i0 + nx * (j + ny * k);
        for (let i = i0; i <= i1; i++, q++) {
          const px = x0 + i * h, py = y0 + j * h, pz = z0 + k * h;
          let t = ((px - a.x) * dx + (py - a.y) * dy + (pz - a.z) * dz) / ll;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const wx = px - a.x - dx * t, wy = py - a.y - dy * t, wz = pz - a.z - dz * t;
          let d2 = wx * wx + wy * wy + wz * wz;
          if (u) { const wu = wx * u.x + wy * u.y + wz * u.z; d2 += wu * wu * ks; }
          const d = Math.sqrt(Math.max(d2, 0)) - r * (1 - taper * t);
          air[q] = smin(air[q], d, 0.035);
        }
      }
  }

  terrainH(x: number, z: number): number {
    const P = this.P;
    const zz = z + 0.22 * P.n(x * 0.55, 3.3, 0.4) + 0.1 * P.n(x * 1.7, 8.1, 0.4);
    const bank = sstep(0.28, -0.72, zz);
    const hill = sstep(-1.5, -3.4, zz) * 2.4;
    let hgt = -0.27 + 1.18 * bank + hill - 0.07 * Math.max(z, 0);
    hgt += 0.09 * P.n(x * 0.8, 0.5, z * 0.8) + 0.03 * P.n(x * 2.7, 1.5, z * 2.7);
    return hgt;
  }

  /** The chamber: an ellipsoid lying along the way in, wider than it is high, its floor a step below the tunnel's. */
  private stampDen(ra: number, rl: number, rv: number) {
    const { nx, ny, nz, x0, y0, z0, h, air } = this;
    const { c, back, floor } = this.den;
    const rm = ra + 0.3;
    const i0 = Math.max(0, Math.floor((c.x - rm - x0) / h)), i1 = Math.min(nx - 1, Math.ceil((c.x + rm - x0) / h));
    const j0 = Math.max(0, Math.floor((c.y - rv - 0.3 - y0) / h)), j1 = Math.min(ny - 1, Math.ceil((c.y + rv + 0.3 - y0) / h));
    const k0 = Math.max(0, Math.floor((c.z - rm - z0) / h)), k1 = Math.min(nz - 1, Math.ceil((c.z + rm - z0) / h));
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++) {
        let q = i0 + nx * (j + ny * k);
        for (let i = i0; i <= i1; i++, q++) {
          const dx = x0 + i * h - c.x, dy = y0 + j * h - c.y, dz = z0 + k * h - c.z;
          const a = dx * back.x + dz * back.z, l = dx * back.z - dz * back.x;
          const d = smax((Math.hypot(a / ra, l / rl, dy / rv) - 1) * rv, floor - (y0 + j * h), 0.07);
          if (d < air[q]) air[q] = d;
        }
      }
  }

  private stampTube(pa: THREE.Vector3, pb: THREE.Vector3, ra: number, rb: number, s0: number, segLen: number, open: boolean) {
    const { nx, ny, nz, x0, y0, z0, h, air } = this;
    const rm = Math.max(ra, rb) + 0.27;
    const i0 = Math.max(0, Math.floor((Math.min(pa.x, pb.x) - rm - x0) / h)), i1 = Math.min(nx - 1, Math.ceil((Math.max(pa.x, pb.x) + rm - x0) / h));
    const j0 = Math.max(0, Math.floor((Math.min(pa.y, pb.y) - rm - y0) / h)), j1 = Math.min(ny - 1, Math.ceil((Math.max(pa.y, pb.y) + rm - y0) / h));
    const k0 = Math.max(0, Math.floor((Math.min(pa.z, pb.z) - rm - z0) / h)), k1 = Math.min(nz - 1, Math.ceil((Math.max(pa.z, pb.z) + rm - z0) / h));
    const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
    const ll = Math.max(dx * dx + dy * dy + dz * dz, 1e-9);
    const ridge = open ? 0 : 0.009;
    for (let k = k0; k <= k1; k++) {
      const pz = z0 + k * h;
      for (let j = j0; j <= j1; j++) {
        const py = y0 + j * h;
        let q = i0 + nx * (j + ny * k);
        for (let i = i0; i <= i1; i++, q++) {
          const px = x0 + i * h;
          let t = ((px - pa.x) * dx + (py - pa.y) * dy + (pz - pa.z) * dz) / ll;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cx = pa.x + dx * t, cy = pa.y + dy * t, cz = pa.z + dz * t;
          const r = ra + (rb - ra) * t;
          const dist = Math.hypot(px - cx, py - cy, pz - cz);
          const s = s0 + t * segLen;
          const rr = r + ridge * Math.sin(s * 52 + 2.2 * Math.sin(px * 4.7 + pz * 3.1) + 1.7 * Math.sin(py * 6.3));
          const d = smax(dist - rr, cy - 0.6 * r - py, 0.07);
          if (d < air[q]) air[q] = d;
        }
      }
    }
  }

  /** A stone in the wall: the soil closes around most of it, so the rock mesh sits in a matching mound. */
  stampRock(c: THREE.Vector3, R: number) {
    const { nx, ny, nz, x0, y0, z0, h, air } = this;
    const rm = R + 0.08;
    const i0 = Math.max(0, Math.floor((c.x - rm - x0) / h)), i1 = Math.min(nx - 1, Math.ceil((c.x + rm - x0) / h));
    const j0 = Math.max(0, Math.floor((c.y - rm - y0) / h)), j1 = Math.min(ny - 1, Math.ceil((c.y + rm - y0) / h));
    const k0 = Math.max(0, Math.floor((c.z - rm - z0) / h)), k1 = Math.min(nz - 1, Math.ceil((c.z + rm - z0) / h));
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++) {
        let q = i0 + nx * (j + ny * k);
        for (let i = i0; i <= i1; i++, q++) {
          const d = Math.hypot(x0 + i * h - c.x, y0 + j * h - c.y, z0 + k * h - c.z) - R * 0.8;
          air[q] = smax(air[q], -d, 0.05);
        }
      }
  }

  /** The field at a point, trilinear. Negative in the open. */
  sample(x: number, y: number, z: number): number {
    const { nx, ny, nz, h, air } = this;
    const fx = (x - this.x0) / h, fy = (y - this.y0) / h, fz = (z - this.z0) / h;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= nx - 1 || fy >= ny - 1 || fz >= nz - 1) {
      if (fy < 0) return BIG;
      return Math.max(-BIG, Math.min(BIG, (this.terrainH(x, z) - y) * 0.8));
    }
    const i = fx | 0, j = fy | 0, k = fz | 0;
    const u = fx - i, v = fy - j, w = fz - k;
    const q = i + nx * (j + ny * k), sy = nx, sz = nx * ny;
    const a00 = air[q] + (air[q + 1] - air[q]) * u;
    const a10 = air[q + sy] + (air[q + sy + 1] - air[q + sy]) * u;
    const a01 = air[q + sz] + (air[q + sz + 1] - air[q + sz]) * u;
    const a11 = air[q + sz + sy] + (air[q + sz + sy + 1] - air[q + sz + sy]) * u;
    const a0 = a00 + (a10 - a00) * v, a1 = a01 + (a11 - a01) * v;
    return a0 + (a1 - a0) * w;
  }

  /** Unit normal of the ground at a point, towards the open. */
  normalAt(x: number, y: number, z: number, out: THREE.Vector3, e = CELL): THREE.Vector3 {
    out.set(
      this.sample(x - e, y, z) - this.sample(x + e, y, z),
      this.sample(x, y - e, z) - this.sample(x, y + e, z),
      this.sample(x, y, z - e) - this.sample(x, y, z + e),
    );
    const l = out.length();
    return l > 1e-9 ? out.multiplyScalar(1 / l) : out.set(0, 1, 0);
  }

  /** Distance along a ray to the ground (tmax if none). */
  march(o: THREE.Vector3, d: THREE.Vector3, tmax = 12): number {
    let t = 0;
    for (let i = 0; i < 110; i++) {
      const a = this.sample(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
      if (a > -0.004) return t;
      t += Math.max(-a * 0.85, 0.012);
      if (t >= tmax) return tmax;
    }
    return t;
  }

  buildGeometry(): THREE.BufferGeometry {
    const { nx, ny, nz, h, air } = this;
    const dims = [nx, ny, nz];
    const pos: number[] = [];
    const index: number[] = [];
    const R = [1, nx + 1, (nx + 1) * (ny + 1)];
    const buffer = new Int32Array(R[2] * 2);
    const grid = new Float32Array(8);
    const x = [0, 0, 0];
    const v = [0, 0, 0];
    let n = 0, bufNo = 1, count = 0;
    for (x[2] = 0; x[2] < nz - 1; ++x[2], n += nx, bufNo ^= 1, R[2] = -R[2]) {
      let m = 1 + (nx + 1) * (1 + bufNo * (ny + 1));
      for (x[1] = 0; x[1] < ny - 1; ++x[1], n++, m += 2)
        for (x[0] = 0; x[0] < nx - 1; ++x[0], n++, m++) {
          let mask = 0, g = 0, q = n;
          for (let k = 0; k < 2; ++k, q += nx * (ny - 2))
            for (let j = 0; j < 2; ++j, q += nx - 2)
              for (let i = 0; i < 2; ++i, ++g, ++q) {
                const p = air[q];
                grid[g] = p;
                mask |= p < 0 ? 1 << g : 0;
              }
          if (mask === 0 || mask === 0xff) continue;
          const em = edgeTable[mask];
          v[0] = v[1] = v[2] = 0;
          let ec = 0;
          for (let i = 0; i < 12; ++i) {
            if (!(em & (1 << i))) continue;
            ++ec;
            const e0 = cubeEdges[i << 1], e1 = cubeEdges[(i << 1) + 1];
            const g0 = grid[e0], g1 = grid[e1];
            let t = g0 - g1;
            if (Math.abs(t) > 1e-6) t = g0 / t; else continue;
            for (let j = 0, k = 1; j < 3; ++j, k <<= 1) {
              const a = e0 & k, b = e1 & k;
              if (a !== b) v[j] += a ? 1 - t : t; else v[j] += a ? 1 : 0;
            }
          }
          const s = 1 / ec;
          buffer[m] = count++;
          pos.push(this.x0 + (x[0] + s * v[0]) * h, this.y0 + (x[1] + s * v[1]) * h, this.z0 + (x[2] + s * v[2]) * h);
          for (let i = 0; i < 3; ++i) {
            if (!(em & (1 << i))) continue;
            const iu = (i + 1) % 3, iv = (i + 2) % 3;
            if (x[iu] === 0 || x[iv] === 0) continue;
            const du = R[iu], dv = R[iv];
            const a = buffer[m], b = buffer[m - du], c = buffer[m - du - dv], d = buffer[m - dv];
            if (mask & 1) index.push(a, b, c, a, c, d); else index.push(a, d, c, a, c, b);
          }
        }
    }
    void dims;

    const position = new Float32Array(pos);
    const normal = new Float32Array(pos.length);
    const ao = new Float32Array(count);
    const sky = new Float32Array(count);
    const nrm = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const px = position[i * 3], py = position[i * 3 + 1], pz = position[i * 3 + 2];
      this.normalAt(px, py, pz, nrm, h);
      normal[i * 3] = nrm.x; normal[i * 3 + 1] = nrm.y; normal[i * 3 + 2] = nrm.z;
      let occ = 0;
      for (const [d, w] of [[0.05, 0.5], [0.12, 0.35], [0.26, 0.25]]) {
        const dist = -this.sample(px + nrm.x * d, py + nrm.y * d, pz + nrm.z * d);
        occ += (Math.max(0, d - dist) / d) * w;
      }
      ao[i] = Math.max(0.12, 1 - occ * 1.5);
      sky[i] = (1 - sstep(0.1, 0.3, this.terrainH(px, pz) - py)) * sstep(-0.35, 0.15, nrm.y);
    }
    // winding: make the faces look into the open
    {
      const a = index[0] * 3, b = index[1] * 3, c = index[2] * 3;
      const e1 = new THREE.Vector3(position[b] - position[a], position[b + 1] - position[a + 1], position[b + 2] - position[a + 2]);
      const e2 = new THREE.Vector3(position[c] - position[a], position[c + 1] - position[a + 1], position[c + 2] - position[a + 2]);
      const fn = e1.cross(e2);
      if (fn.x * normal[a] + fn.y * normal[a + 1] + fn.z * normal[a + 2] < 0)
        for (let i = 0; i < index.length; i += 3) { const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geo.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
    geo.setAttribute('aSky', new THREE.BufferAttribute(sky, 1));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
    geo.computeBoundingSphere();
    return geo;
  }

  // ---- the rail ----

  railPoint(e: RailEdge, s: number, out: THREE.Vector3): THREE.Vector3 {
    const { pts, cum } = e;
    s = Math.min(Math.max(s, 0), e.len);
    let i = Math.min(pts.length - 2, Math.floor((s / e.len) * (pts.length - 1)));
    while (i > 0 && cum[i] > s) i--;
    while (i < pts.length - 2 && cum[i + 1] < s) i++;
    const t = (s - cum[i]) / Math.max(cum[i + 1] - cum[i], 1e-6);
    return out.copy(pts[i]).lerp(pts[i + 1], t);
  }

  railRadius(e: RailEdge, s: number): number {
    const i = Math.min(e.pts.length - 1, Math.max(0, Math.round((s / e.len) * (e.pts.length - 1))));
    return e.rad[i];
  }

  /** Tangent from a to b. */
  railTangent(e: RailEdge, s: number, out: THREE.Vector3): THREE.Vector3 {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    this.railPoint(e, s - 0.12, a);
    this.railPoint(e, s + 0.12, b);
    return out.copy(b).sub(a).normalize();
  }
}
