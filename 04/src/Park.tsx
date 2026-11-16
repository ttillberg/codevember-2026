// What makes it a place and not only roads and houses: a park with trodden walks and a cycle way, a football pitch,
// a school with its yard, and hedges round the little houses. Planted once, on the place as it first stood.
// None of it is in the way of the brush: a road painted through takes away what it hits.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, MeshStandardMaterial, Object3D, ShaderMaterial } from 'three';
import { TIMELAPSE } from './Cars';
import { clearOf, onRoad, rectClear, WALK } from './geo';
import { FLOOD, HOUR, NIGHT } from './haze';
import { cumLen, offset, pointOn, rng, type Net, type Rect, type V } from './net';
import type { Block } from './Town';
import { grained } from './World';

// ---------- where it stands ----------

/** The open ground it is laid on, found by looking at the map: each is only planted if it is still free there. */
const PARK: Rect = { x0: 32, y0: 38, x1: 138, y1: 88 };
/** the playing field itself, 60 by 40: a little over half of a full one, which is all the room there is */
const PITCH: Rect = { x0: -264, y0: 86, x1: -204, y1: 126 };
/** the grass round it */
const RUN = 3;
const SCHOOL: Rect = { x0: -266, y0: 39, x1: -198, y1: 79 };
/** inside the school's fence: the yard, the court painted on it, the long house and the hall */
const YARD: Rect = { x0: -264, y0: 41, x1: -200, y1: 66 };
const COURT: Rect = { x0: -240, y0: 46, x1: -216, y1: 60 };
const HOP = { x: -203.6, y: 45, s: 1.5, n: 9 };
const BAR = { x0: -246, y0: 67, x1: -202, y1: 77, h: 7 };
const HALL = { x0: -264, y0: 49, x1: -249, y1: 77, h: 5.6 };

/** half the width of a walk, and of the cycle way */
const TRAIL = 1.3, CYCLE = 1.7;
const GRAVEL = 0xcbbb96, TARMAC = 0xa9684f;

type Part = 'park' | 'pitch' | 'school' | 'hedge';
/** A box: where its middle is, how big, turned how far, what colour. */
interface Thing { x: number; y: number; z: number; sx: number; sy: number; sz: number; rot: number; ink: number; part: Part }
interface Bush { x: number; z: number; s: number; h: number; ink: number; part: Part; home?: Block }
interface Glow { x: number; z: number; r: number; ink: [number, number, number]; part: Part }
/**
 * Somebody on the pitch or in the yard. `role`: 0 runs about, 1 keeps to a spot (a goalkeeper), 2 stands and shifts
 * (someone watching), 3 does not move at all (someone on a phone). `gate` is where they come in and go out,
 * `when` the hours they are there: two spells, each from and to.
 */
interface Figure { x: number; z: number; h: number; ink: number; part: Part; role: number; gate: V; when: [number, number, number, number] }
export interface Sapling { x: number; y: number; s: number; k: number }
interface Trail { pts: V[]; hw: number; ink: number; ride: boolean; part: Part }

export interface Commons {
  park: boolean; pitch: boolean; school: boolean;
  lawn: V[];
  trails: Trail[];
  things: Thing[]; heads: Thing[]; pools: Glow[]; bushes: Bush[]; figures: Figure[];
  trees: Sapling[];
}

/** What is left of it on the roads as they are now. */
export interface Green {
  park: boolean; pitch: boolean; school: boolean;
  lawn: V[];
  trails: Trail[];
  /** for the people: the walks, and the cycle way once in each direction */
  walks: V[][]; rides: V[][];
  things: Thing[]; heads: Thing[]; pools: Glow[]; bushes: Bush[]; figures: Figure[];
  trees: Sapling[];
  /** may a tree of the woods stand here */
  keep: (x: number, y: number) => boolean;
}

const grown = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m });
const inside = (r: Rect, x: number, y: number, m = 0) => x > r.x0 - m && x < r.x1 + m && y > r.y0 - m && y < r.y1 + m;
const hash = (x: number, y: number) => Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;

/** Does any road touch this rectangle, a bridge included? */
function roadIn(net: Net, b: Rect, margin: number) {
  if (!rectClear(net, b, margin)) return true;
  for (const r of net.roads) {
    if (!r.bridge) continue;
    const q = grown(b, r.hw + margin);
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], c = r.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.y - a.y) / 3));
      for (let k = 0; k <= n; k++) if (inside(q, a.x + ((c.x - a.x) * k) / n, a.y + ((c.y - a.y) * k) / n)) return true;
    }
  }
  return false;
}

/** How far a point is from a line of points. */
function away(pts: V[], x: number, y: number) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.y + dy * t - y));
  }
  return best;
}

/** The middle of every sidewalk, as points a few metres apart: where a walk can start. */
function kerbs(net: Net) {
  const out: V[] = [];
  for (const r of net.roads) {
    if (r.rank < 1 || r.bridge || r.ring || r.base.length < 2) continue;
    for (const side of [1, -1]) {
      const ln = offset(r.base, side * (r.hw + 0.95 + WALK / 2)), cum = cumLen(ln);
      for (let d = 4; d < cum[cum.length - 1] - 4; d += 5) out.push(pointOn(ln, cum, d));
    }
  }
  return out;
}

export function plantCommons(net: Net, town: Block[]): Commons {
  const r = rng(67);
  const c: Commons = { park: false, pitch: false, school: false, lawn: [], trails: [], things: [], heads: [], pools: [], bushes: [], figures: [], trees: [] };
  const clash = (b: Rect, gap: number) => town.some((o) => b.x0 < o.x1 + gap && b.x1 > o.x0 - gap && b.y0 < o.y1 + gap && b.y1 > o.y0 - gap);
  const free = (b: Rect) => !roadIn(net, b, 3) && !clash(b, 2);
  const housed = (x: number, y: number, m: number, but?: Block) => town.some((o) => o !== but && inside(o, x, y, m));
  const walkable = (p: V) => !housed(p.x, p.y, 2.4) && clearOf(net, p.x, p.y, 0.3) && !onRoad(net, p.x, p.y, undefined, 0.6);
  const box = (part: Part, x: number, z: number, sx: number, sy: number, sz: number, ink: number, rot = 0, up = 0): Thing => {
    const t = { x, y: up + sy / 2, z, sx, sy, sz, rot, ink, part };
    c.things.push(t);
    return t;
  };
  /** a bar from one point to another, so high and so thick */
  const rail = (part: Part, a: V, b: V, h: number, thick: number, ink: number, up = 0) =>
    box(part, (a.x + b.x) / 2, (a.y + b.y) / 2, Math.hypot(b.x - a.x, b.y - a.y), h, thick, ink, -Math.atan2(b.y - a.y, b.x - a.x), up);
  const GREENS = [0x31481f, 0x3a5223, 0x2c4420, 0x44592a, 0x39501f];
  const bush = (part: Part, x: number, z: number, s: number, home?: Block, tall = 0.8) => {
    const k = r();
    // most keep their green; one in six has turned
    c.bushes.push({ x, z, s, h: s * (tall + r() * 0.25), ink: k < 0.84 ? GREENS[(k * 97) % GREENS.length | 0] : k < 0.93 ? 0x8a5a1c : 0x7a2f18, part, home });
  };
  /** a clipped hedge: a row of them shoulder to shoulder */
  const hedge = (part: Part, a: V, b: V, ok: (x: number, y: number) => boolean, home?: Block, s = 1.35) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.round(len / (s * 1.15)));
    for (let i = 0; i <= n; i++) {
      const x = a.x + ((b.x - a.x) * i) / n + (r() - 0.5) * 0.3, y = a.y + ((b.y - a.y) * i) / n + (r() - 0.5) * 0.3;
      const size = s * (0.9 + r() * 0.25);
      if (ok(x, y)) bush(part, x, y, size, home, 0.75);
    }
  };
  /** a lamp on a low post, and the ground it lights */
  const lamp = (part: Part, x: number, z: number) => {
    box(part, x, z, 0.22, 4.4, 0.22, 0x3c4146);
    // white lamps in the park, greenish on the grass: not the amber of the streets
    c.heads.push({ x, y: 4.55, z, sx: 0.75, sy: 0.3, sz: 0.75, rot: 0, ink: 0xe6f3e0, part });
    c.pools.push({ x, z, r: 9, ink: [1.0, 1.3, 0.95], part });
  };
  const bench = (part: Part, x: number, z: number, rot: number) => {
    box(part, x, z, 2.1, 0.12, 0.6, 0x9b7a52, rot, 0.42);
    box(part, x + Math.sin(rot) * 0.3, z + Math.cos(rot) * 0.3, 2.1, 0.5, 0.1, 0x7d6040, rot, 0.5);
  };

  // ---------- the park: a mown green, and the ways people have trodden across it ----------
  if (free(PARK)) {
    c.park = true;
    const cx = (PARK.x0 + PARK.x1) / 2, cy = (PARK.y0 + PARK.y1) / 2, hx = (PARK.x1 - PARK.x0) / 2, hy = (PARK.y1 - PARK.y0) / 2;
    // the lawn: the free ground with its corners rounded off, and not quite even
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
      const k = 0.94 + 0.06 * Math.sin(a * 5 + 1) * Math.cos(a * 3);
      c.lawn.push({ x: cx + Math.sign(cs) * Math.pow(Math.abs(cs), 0.45) * hx * k, y: cy + Math.sign(sn) * Math.pow(Math.abs(sn), 0.45) * hy * k });
    }
    // the sidewalks round it, by the side they are on
    const edge = { n: [] as V[], s: [] as V[], w: [] as V[], e: [] as V[] };
    for (const p of kerbs(net)) {
      if (inside(PARK, p.x, p.y) || !inside(PARK, p.x, p.y, 48)) continue;
      const dx = Math.max(PARK.x0 - p.x, p.x - PARK.x1), dy = Math.max(PARK.y0 - p.y, p.y - PARK.y1);
      edge[dx > dy ? (p.x < cx ? 'w' : 'e') : p.y < cy ? 'n' : 's'].push(p);
    }
    /**
     * Nobody laid these out. A way across the green from one sidewalk to another, by way of wherever: the first one
     * drawn from the hat that gets past the houses. It bows, and wanders a little as it goes.
     */
    const tread = (from: V[], to: V[], hw: number, ink: number, ride: boolean) => {
      for (let tries = 0; tries < 400 && from.length && to.length; tries++) {
        const a = from[(r() * from.length) | 0], b = to[(r() * to.length) | 0];
        const m = { x: PARK.x0 + hx * (0.5 + r()), y: PARK.y0 + hy * (0.5 + r()) };
        const len = Math.hypot(m.x - a.x, m.y - a.y) + Math.hypot(b.x - m.x, b.y - m.y);
        const chord = Math.hypot(b.x - a.x, b.y - a.y);
        // not so far out of the way that it would have to hook back
        if (len < 60 || chord < 50 || Math.hypot(m.x - (a.x + b.x) / 2, m.y - (a.y + b.y) / 2) > chord * 0.3) continue;
        // through m, and off to either side by a few metres on the way
        const qx = 2 * m.x - (a.x + b.x) / 2, qy = 2 * m.y - (a.y + b.y) / 2, n = Math.ceil(len / 3);
        const waves = 2 + ((r() * 3) | 0), amp = ride ? 1.2 : 2 + r() * 2, ph = r() * 6;
        const pts: V[] = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n, u = 1 - t;
          const x = u * u * a.x + 2 * u * t * qx + t * t * b.x, y = u * u * a.y + 2 * u * t * qy + t * t * b.y;
          const tx = 2 * u * (qx - a.x) + 2 * t * (b.x - qx), ty = 2 * u * (qy - a.y) + 2 * t * (b.y - qy), tl = Math.hypot(tx, ty) || 1;
          const off = Math.sin(t * Math.PI) * Math.sin(t * Math.PI * waves + ph) * amp;
          pts.push({ x: x - (ty / tl) * off, y: y + (tx / tl) * off });
        }
        // one that turns back on itself is nobody's way anywhere
        const ux = (b.x - a.x) / Math.hypot(b.x - a.x, b.y - a.y), uy = (b.y - a.y) / Math.hypot(b.x - a.x, b.y - a.y);
        if (pts.some((p, i) => i > 0 && (p.x - pts[i - 1].x) * ux + (p.y - pts[i - 1].y) * uy < -0.4)) continue;
        if (!pts.every(walkable)) continue;
        // not along one that is there already
        if (c.trails.some((o) => pts.filter((p) => away(o.pts, p.x, p.y) < 5).length > pts.length * 0.3)) continue;
        c.trails.push({ pts, hw, ink, ride, part: 'park' });
        return pts;
      }
      return null;
    };
    // the cycle way first, the long way through; then what feet have made
    tread(edge.w, edge.e, CYCLE, TARMAC, true) ?? tread([...edge.w, ...edge.s], [...edge.e, ...edge.n], CYCLE, TARMAC, true);
    tread(edge.n, edge.s, TRAIL, GRAVEL, false);
    tread(edge.w, edge.n.filter((p) => p.x > cx), TRAIL, GRAVEL, false);
    tread(edge.s, edge.e, TRAIL, GRAVEL, false);

    const onTrail = (x: number, y: number, m: number) => c.trails.some((t) => away(t.pts, x, y) < t.hw + m);
    const open = (x: number, y: number, m: number) => !onTrail(x, y, m) && !housed(x, y, 2) && clearOf(net, x, y, 2);
    // along them: benches, lamps, and trees that line the way instead of standing in it
    for (const t of c.trails) {
      const cum = cumLen(t.pts), len = cum[cum.length - 1];
      let side = r() < 0.5 ? 1 : -1;
      for (let d = 9; d < len - 6; d += 11 + r() * 5, side = -side) {
        const p = pointOn(t.pts, cum, d), p2 = pointOn(t.pts, cum, d + 1), ang = Math.atan2(p2.y - p.y, p2.x - p.x);
        const nx = -Math.sin(ang) * side, ny = Math.cos(ang) * side, o = t.hw + 3.6 + r() * 1.5;
        const x = p.x + nx * o, y = p.y + ny * o;
        if (open(x, y, 2.6)) c.trees.push({ x, y, s: 2.3 + r() * 1.6, k: r() });
      }
      for (let d = 16 + r() * 8, i = 0; d < len - 12; d += 24 + r() * 8, i++) {
        const p = pointOn(t.pts, cum, d), p2 = pointOn(t.pts, cum, d + 1), ang = Math.atan2(p2.y - p.y, p2.x - p.x);
        const s = i % 2 ? 1 : -1, nx = -Math.sin(ang) * s, ny = Math.cos(ang) * s;
        const lx = p.x + nx * (t.hw + 0.9), ly = p.y + ny * (t.hw + 0.9);
        if (open(lx, ly, 0.5) && inside(PARK, lx, ly, 14)) lamp('park', lx, ly);
        const q = pointOn(t.pts, cum, d + 8), bx = q.x - nx * (t.hw + 1.1), by = q.y - ny * (t.hw + 1.1);
        if (!t.ride && open(bx, by, 0.6) && inside(PARK, bx, by, 4)) bench('park', bx, by, -ang + (s > 0 ? 0 : Math.PI));
      }
    }
    // shrubs round the edge of the lawn, in clumps, and a few loose on it
    c.lawn.forEach((p, i) => {
      if (hash(p.x, p.y) < 0.35) return;
      for (let k = 0, n = 2 + ((r() * 4) | 0); k < n; k++) {
        const x = p.x + (r() - 0.5) * 6, y = p.y + (r() - 0.5) * 6;
        if (open(x, y, 1.4)) bush('park', x, y, 1.1 + r() * 1.1);
      }
      if (i % 3 === 0) {
        const x = cx + (p.x - cx) * (1.03 + r() * 0.08), y = cy + (p.y - cy) * (1.03 + r() * 0.08);
        if (open(x, y, 3)) c.trees.push({ x, y, s: 2.6 + r() * 2, k: r() });
      }
    });
    for (let i = 0; i < 9; i++) {
      const x = PARK.x0 + 8 + r() * (hx * 2 - 16), y = PARK.y0 + 8 + r() * (hy * 2 - 16);
      if (!open(x, y, 3.5)) continue;
      c.trees.push({ x, y, s: 3 + r() * 2.2, k: r() });
      for (let k = 0; k < 3; k++) { const bx = x + (r() - 0.5) * 9, by = y + (r() - 0.5) * 9; if (open(bx, by, 1.4)) bush('park', bx, by, 1 + r()); }
    }
  }

  // ---------- the football pitch ----------
  const field = grown(PITCH, RUN);
  if (free(field)) {
    c.pitch = true;
    const cy = (PITCH.y0 + PITCH.y1) / 2, WHITE = 0xecebe4;
    // two goals: posts, a bar across, and the frame the net hangs on
    for (const [gx, out] of [[PITCH.x0, -1], [PITCH.x1, 1]] as const) {
      for (const s of [-1, 1]) {
        box('pitch', gx, cy + s * 2.6, 0.16, 2.2, 0.16, WHITE);
        box('pitch', gx + out * 1.5, cy + s * 2.6, 0.1, 1.5, 0.1, 0xc9c9c4);
        rail('pitch', { x: gx, y: cy + s * 2.6 }, { x: gx + out * 1.5, y: cy + s * 2.6 }, 0.08, 0.08, 0xc9c9c4, 1.5);
      }
      box('pitch', gx, cy, 0.16, 0.16, 5.36, WHITE, 0, 2.2);
      box('pitch', gx + out * 1.5, cy, 0.1, 0.1, 5.2, 0xc9c9c4, 0, 1.5);
      // the net, seen from above: a pale sheet
      box('pitch', gx + out * 0.75, cy, 1.5, 0.04, 5.2, 0xdcdcd6, 0, 1.9);
    }
    // a mast at each corner, and what the four of them throw on the grass
    for (const mx of [field.x0 - 0.5, field.x1 + 0.5]) for (const my of [field.y0 - 0.5, field.y1 + 0.5]) {
      box('pitch', mx, my, 0.5, 16, 0.5, 0x6d7276);
      const rot = -Math.atan2(cy - my, (PITCH.x0 + PITCH.x1) / 2 - mx) + Math.PI / 2;
      box('pitch', mx, my, 3.2, 1.2, 0.3, 0x55595d, rot, 15.4);
      c.heads.push({ x: mx + Math.sin(rot) * 0.22, y: 16, z: my + Math.cos(rot) * 0.22, sx: 2.8, sy: 0.9, sz: 0.25, rot, ink: 0xeaf1ff, part: 'pitch' });
    }
    for (const fx of [0.22, 0.5, 0.78]) for (const fy of [0.28, 0.72]) {
      c.pools.push({ x: PITCH.x0 + (PITCH.x1 - PITCH.x0) * fx, z: PITCH.y0 + (PITCH.y1 - PITCH.y0) * fy, r: 24, ink: [0.72, 0.84, 0.9], part: 'pitch' });
    }
    // benches for the two sides, on the school's touchline, and a rail to lean on along the other
    for (const bx of [-0.2, 0.2]) {
      const x = (PITCH.x0 + PITCH.x1) / 2 + bx * (PITCH.x1 - PITCH.x0);
      box('pitch', x, PITCH.y0 - 1.9, 5, 0.45, 0.5, 0x8e7250);
      box('pitch', x, PITCH.y0 - 2.4, 5.4, 0.08, 1.4, 0xc6ccd0, 0, 2);
    }
    rail('pitch', { x: field.x0, y: field.y1 }, { x: field.x1, y: field.y1 }, 0.1, 0.12, 0xd8d8d2, 1);
    for (let x = field.x0; x <= field.x1 + 0.1; x += (field.x1 - field.x0) / 12) box('pitch', x, field.y1, 0.1, 1, 0.1, 0xd8d8d2);
    // eleven a side would crowd it: six each and a keeper in either goal, one in black, and a few along the line who watch.
    // A game before noon and one into the evening, under the lights; nobody arrives or leaves on the same minute
    const KIT = [0xc8322c, 0x2b5fb0], way: V = { x: (PITCH.x0 + PITCH.x1) / 2, y: PITCH.y0 - 1 };
    const game = (late = 0): Figure['when'] => [10 + r() * 0.35 + late, 11.7 - r() * 0.3, 15.6 + r() * 0.4 + late, 20.4 - r() * 0.4];
    const mid = (PITCH.y0 + PITCH.y1) / 2;
    for (let i = 0; i < 12; i++) {
      c.figures.push({ x: PITCH.x0 + 9 + r() * (PITCH.x1 - PITCH.x0 - 18), z: PITCH.y0 + 7 + r() * (PITCH.y1 - PITCH.y0 - 14), h: 1.75, ink: KIT[i % 2], part: 'pitch', role: 0, gate: way, when: game() });
    }
    [field.x0 + 2.5, field.x1 - 2.5].forEach((x, i) => c.figures.push({ x, z: mid, h: 1.8, ink: i ? 0xe3c21f : 0x37a05a, part: 'pitch', role: 1, gate: way, when: game() }));
    c.figures.push({ x: (PITCH.x0 + PITCH.x1) / 2 + 4, z: mid + 3, h: 1.75, ink: 0x1c1c1e, part: 'pitch', role: 0, gate: way, when: game() });
    const COATS = [0x2c3340, 0x6b5b4a, 0x8a2f2a, 0xd9d6cf, 0x3d5a45, 0x24406b];
    for (let i = 0; i < 10; i++) {
      // most of them watch; three have found something better on a phone, a little apart
      const phone = i >= 7;
      c.figures.push({ x: field.x0 + 6 + r() * (field.x1 - field.x0 - 12), z: field.y0 - (phone ? 2.6 + r() * 1.5 : 1.2 + r() * 0.5), h: 1.6 + r() * 0.2, ink: COATS[(r() * COATS.length) | 0], part: 'pitch', role: phone ? 3 : 2, gate: way, when: game(0.15 + r() * 0.3) });
    }
    // a hedge behind each goal, where the ball goes
    const ok = (x: number, y: number) => !housed(x, y, 1.5) && clearOf(net, x, y, 1.5);
    hedge('pitch', { x: field.x0 - 1.6, y: field.y0 + 4 }, { x: field.x0 - 1.6, y: field.y1 - 4 }, ok, undefined, 1.5);
    hedge('pitch', { x: field.x1 + 1.6, y: field.y0 + 4 }, { x: field.x1 + 1.6, y: field.y1 - 4 }, ok, undefined, 1.5);
  }

  // ---------- the school ----------
  if (free(SCHOOL)) {
    c.school = true;
    const BRICK = 0xb9694a, CREAM = 0xdcd3bd, RIM = 0xe2dfd6;
    /** a house of it: walls, a flat roof inside a rim, and a row of glass down each long side */
    const house = (b: Rect & { h: number }, wall: number, roof: number) => {
      const w = b.x1 - b.x0, d = b.y1 - b.y0, x = (b.x0 + b.x1) / 2, z = (b.y0 + b.y1) / 2;
      box('school', x, z, w, b.h, d, wall);
      box('school', x, z, w - 0.8, 0.3, d - 0.8, roof, 0, b.h - 0.1);
      for (const [ax, az, sx, sz] of [[x, b.y0 + 0.2, w, 0.4], [x, b.y1 - 0.2, w, 0.4], [b.x0 + 0.2, z, 0.4, d], [b.x1 - 0.2, z, 0.4, d]]) box('school', ax, az, sx, 0.7, sz, RIM, 0, b.h);
      const long = w > d;
      for (let f = 0; f * 3.2 + 2.6 < b.h; f++) for (const s of [-1, 1]) {
        if (long) box('school', x, s < 0 ? b.y0 - 0.05 : b.y1 + 0.05, w - 3, 1.4, 0.12, 0x2f4252, 0, 1.2 + f * 3.2);
        else box('school', s < 0 ? b.x0 - 0.05 : b.x1 + 0.05, z, 0.12, 1.4, d - 3, 0x2f4252, 0, 1.2 + f * 3.2);
      }
    };
    house(BAR, BRICK, 0xcfccc2);
    house(HALL, CREAM, 0x4f8f8a);
    // skylights down the long roof, the way a school has them, and a covered way from the hall to the door
    for (let x = BAR.x0 + 5; x < BAR.x1 - 3; x += 6) box('school', x, (BAR.y0 + BAR.y1) / 2, 2.6, 0.5, 4.2, 0x9fc0d2, 0, BAR.h + 0.2);
    box('school', (HALL.x1 + BAR.x0) / 2, 66, BAR.x0 - HALL.x1 + 6, 0.2, 2.6, 0xd9a441, 0, 2.8);
    // the gate: wherever on the street side a straight way out to the sidewalk gets past the houses
    const walk = kerbs(net).filter((p) => p.y < SCHOOL.y0 && p.x > SCHOOL.x0 - 6 && p.x < SCHOOL.x1 + 6);
    let gate: V | null = null, out: V | null = null;
    for (const p of walk.sort((a, b) => Math.abs(a.x - (YARD.x1 - 12)) - Math.abs(b.x - (YARD.x1 - 12)))) {
      const g = { x: Math.max(YARD.x0 + 3, Math.min(YARD.x1 - 3, p.x)), y: SCHOOL.y0 };
      const n = Math.ceil(Math.hypot(p.x - g.x, p.y - g.y) / 2);
      const way = Array.from({ length: n + 1 }, (_, i) => ({ x: g.x + ((p.x - g.x) * i) / n, y: g.y + ((p.y - g.y) * i) / n }));
      if (!way.slice(1).every(walkable)) continue;
      gate = g; out = p;
      break;
    }
    if (gate && out) {
      const n = Math.ceil((out.y - YARD.y0 - 6) / -3), from = { x: gate.x, y: YARD.y0 + 6 }, to = out;
      c.trails.push({ pts: Array.from({ length: n + 1 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n })), hw: 1.5, ink: 0xb4b1a8, ride: false, part: 'school' });
    }
    // the fence: round the yard on the three sides the houses leave open, with the gate left out of it
    const FENCE = 0x55645c;
    const run = (a: V, b: V) => {
      rail('school', a, b, 0.08, 0.14, FENCE, 1.5);
      const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 3));
      for (let i = 0; i <= n; i++) box('school', a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n, 0.14, 1.6, 0.14, FENCE);
    };
    const nw = { x: SCHOOL.x0, y: SCHOOL.y0 }, ne = { x: SCHOOL.x1, y: SCHOOL.y0 }, gx = gate?.x ?? NaN;
    if (gate) {
      run(nw, { x: gx - 2, y: SCHOOL.y0 }); run({ x: gx + 2, y: SCHOOL.y0 }, ne);
      for (const s of [-1, 1]) box('school', gx + s * 2, SCHOOL.y0, 0.5, 2.2, 0.5, BRICK);
    } else run(nw, ne);
    run(nw, { x: SCHOOL.x0, y: HALL.y0 }); run(ne, { x: SCHOOL.x1, y: BAR.y1 });
    // a hedge outside the fence, clipped
    const ok = (x: number, y: number) => !housed(x, y, 1.5) && clearOf(net, x, y, 1.5) && !(gate && Math.abs(x - gx) < 3 && y < SCHOOL.y0 + 2);
    hedge('school', { x: SCHOOL.x0, y: SCHOOL.y0 - 1.2 }, { x: SCHOOL.x1, y: SCHOOL.y0 - 1.2 }, ok);
    hedge('school', { x: SCHOOL.x1 + 1.2, y: SCHOOL.y0 }, { x: SCHOOL.x1 + 1.2, y: BAR.y1 }, ok);
    hedge('school', { x: SCHOOL.x0 - 1.2, y: SCHOOL.y0 }, { x: SCHOOL.x0 - 1.2, y: HALL.y1 }, ok);
    // bike racks by the gate, with what is locked to them, and a flag
    const rx = (gate ? gx : YARD.x1 - 12) - 12;
    const BIKES = [0xc23a2a, 0x2a5ea0, 0xe2b33a, 0x1e2126, 0x3a7a5a, 0xe8e5dc];
    for (let i = 0; i < 8; i++) {
      box('school', rx + i * 0.9, YARD.y0 + 2.2, 0.08, 0.8, 1.6, 0x9aa0a4);
      if (r() < 0.75) box('school', rx + i * 0.9 + 0.3, YARD.y0 + 2.2 + (r() - 0.5) * 0.3, 0.22, 0.95, 1.7, BIKES[(r() * BIKES.length) | 0]);
    }
    box('school', rx - 0.6, YARD.y0 + 2.2, 8.6, 0.12, 2.6, 0xc9ced2, 0, 2.3);
    box('school', YARD.x1 - 3, YARD.y0 + 3, 0.14, 9, 0.14, 0xd5d7d8);
    box('school', YARD.x1 - 3, YARD.y0 + 3.75, 0.06, 1, 1.5, 0xd23a2e, 0, 7.8);
    // goals for the court, benches along the wall, a lamp or two by the door
    for (const hx of [COURT.x0 - 0.3, COURT.x1 + 0.3]) {
      box('school', hx, (COURT.y0 + COURT.y1) / 2, 0.14, 3, 0.14, 0x6d7276);
      box('school', hx + (hx < COURT.x0 ? 0.5 : -0.5), (COURT.y0 + COURT.y1) / 2, 0.1, 1, 1.7, 0xf0efe8, 0, 2.6);
    }
    for (let x = BAR.x0 + 4; x < BAR.x1 - 4; x += 9) bench('school', x, BAR.y0 - 0.9, Math.PI);
    lamp('school', BAR.x0 + 1, BAR.y0 - 1.5); lamp('school', BAR.x1 - 12, BAR.y0 - 1.5);
    if (gate) lamp('school', gx + 3.2, SCHOOL.y0 + 1.5);
    // the children, out between lessons
    const WEAR = [0xd23a2e, 0x2f5fa8, 0xe0b23a, 0xe9e6de, 0x3a8a5a, 0xd98aa0, 0x2c3340, 0xee7a1c];
    // out at the two breaks and back in at the bell, through the door of the long house
    const door: V = { x: (BAR.x0 + BAR.x1) / 2, y: BAR.y0 };
    const breaks = (): Figure['when'] => [9.6 + r() * 0.12, 10.2 - r() * 0.1, 12 + r() * 0.2, 13 - r() * 0.15];
    for (let i = 0; i < 26; i++) {
      // a few stand by the fence with a phone, or just stand
      const still = i >= 21;
      c.figures.push({ x: YARD.x0 + 20 + r() * (YARD.x1 - YARD.x0 - 26), z: YARD.y0 + 5 + r() * (YARD.y1 - YARD.y0 - 10), h: 1.25 + r() * 0.25, ink: WEAR[(r() * WEAR.length) | 0], part: 'school', role: still ? (i % 2 ? 3 : 2) : 0, gate: door, when: breaks() });
    }
    // and two grown-ups who watch them
    for (let i = 0; i < 2; i++) c.figures.push({ x: door.x - 6 + i * 12, z: BAR.y0 - 3, h: 1.75, ink: 0x2c3340, part: 'school', role: 2, gate: door, when: [9.55, 10.25, 11.95, 13.05] });
  }

  // ---------- hedges and bushes round the little houses ----------
  const taken = (x: number, y: number) => (c.pitch && inside(field, x, y, 2)) || (c.school && inside(SCHOOL, x, y, 2)) || c.trails.some((t) => away(t.pts, x, y) < t.hw + 1.2);
  for (const b of town) {
    if (!b.small || b.pumps || b.path.length < 2) continue;
    const q = b.inner ?? b, cx = (q.x0 + q.x1) / 2, cy = (q.y0 + q.y1) / 2;
    const cs = Math.cos(b.turn ?? 0), sn = Math.sin(b.turn ?? 0);
    // a point of its own plot, turned with it
    const at = (x: number, y: number): V => ({ x: cx + (x - cx) * cs + (y - cy) * sn, y: cy - (x - cx) * sn + (y - cy) * cs });
    const ok = (x: number, y: number) => !housed(x, y, 1.2, b) && !inside(b, x, y, 0.8) && clearOf(net, x, y, 1.6) && !taken(x, y);
    const G = 4.3, x0 = q.x0 - G, x1 = q.x1 + G, y0 = q.y0 - G, y1 = q.y1 + G;
    const sides: [V, V][] = [[at(x0, y0), at(x1, y0)], [at(x1, y0), at(x1, y1)], [at(x1, y1), at(x0, y1)], [at(x0, y1), at(x0, y0)]];
    // the back is the side furthest from the road
    const road = b.path[b.path.length - 1];
    const far = sides.map(([p, o]) => Math.hypot((p.x + o.x) / 2 - road.x, (p.y + o.y) / 2 - road.y));
    const back = far.indexOf(Math.max(...far)), k = r();
    if (k < 0.55) {
      // a hedge along the back and down one side, or both
      hedge('hedge', ...sides[back], ok, b);
      if (k < 0.3) hedge('hedge', ...sides[(back + 1) % 4], ok, b);
      if (k < 0.1) hedge('hedge', ...sides[(back + 3) % 4], ok, b);
    }
    // and whatever grows in the garden
    for (let i = (r() * 4) | 0; i > 0; i--) {
      const [p, o] = sides[(back + ((r() * 3) | 0) + 3) % 4], t = r();
      const x = p.x + (o.x - p.x) * t + (r() - 0.5) * 3, y = p.y + (o.y - p.y) * t + (r() - 0.5) * 3;
      if (ok(x, y)) bush('hedge', x, y, 1 + r() * 0.9, b, 0.9);
    }
  }
  return c;
}

/**
 * What still stands on the roads as they are now. The pitch and the school go as a whole when a road touches them;
 * in the park each thing goes by itself, and a walk is cut where the road crosses it. The lawn stays: it lies under the road.
 */
export function standingCommons(c: Commons, net: Net, blocks: Block[]): Green {
  const field = grown(PITCH, RUN);
  const pitch = c.pitch && !roadIn(net, field, 1), school = c.school && !roadIn(net, SCHOOL, 1);
  const up = new Set(blocks);
  const part = (p: Part) => (p === 'pitch' ? pitch : p === 'school' ? school : true);
  const free = (p: Part, x: number, z: number, m: number) => part(p) && (p === 'pitch' || p === 'school' || clearOf(net, x, z, m));
  // a walk keeps the stretches that are clear of every road
  const trails: Trail[] = [];
  for (const t of c.trails) {
    if (!part(t.part)) continue;
    let run: V[] = [];
    const close = () => { if (run.length > 2) trails.push({ ...t, pts: run }); run = []; };
    for (const p of t.pts) {
      if (clearOf(net, p.x, p.y, 0.3) && !onRoad(net, p.x, p.y, undefined, 0.6)) run.push(p);
      else close();
    }
    close();
  }
  // in the park each thing keeps well clear: a road may bring parking down both its sides
  const things = c.things.filter((t) => free(t.part, t.x, t.z, 4.5));
  const off: Rect[] = [];
  if (c.park) off.push(PARK);
  if (pitch) off.push(grown(field, 2.5));
  if (school) off.push(grown(SCHOOL, 2.5));
  // the box round each walk, as far out as it keeps the trees: a tree outside it is not near that walk
  const boxes = trails.map((t) => {
    const m = t.hw + 2.2, xs = t.pts.map((p) => p.x), ys = t.pts.map((p) => p.y);
    return { x0: Math.min(...xs) - m, y0: Math.min(...ys) - m, x1: Math.max(...xs) + m, y1: Math.max(...ys) + m };
  });
  return {
    park: c.park, pitch, school,
    lawn: c.lawn,
    trails,
    walks: trails.filter((t) => !t.ride).map((t) => t.pts),
    rides: trails.filter((t) => t.ride).flatMap((t) => [t.pts, [...t.pts].reverse()]),
    things: things.length === c.things.length ? c.things : things,
    heads: c.heads.filter((t) => free(t.part, t.x, t.z, 4.5)),
    pools: c.pools.filter((t) => free(t.part, t.x, t.z, 4.5)),
    bushes: c.bushes.filter((b) => free(b.part, b.x, b.z, 1.4) && (!b.home || up.has(b.home))),
    figures: c.figures.filter((f) => part(f.part)),
    trees: c.trees,
    keep: (x, y) => {
      for (const q of off) if (inside(q, x, y)) return false;
      for (let i = 0; i < trails.length; i++) {
        const b = boxes[i], t = trails[i];
        if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && away(t.pts, x, y) < t.hw + 2.2) return false;
      }
      return true;
    },
  };
}

// ---------- how it is drawn ----------

/** Flat things laid on the grass, under every sidewalk and road: whatever is painted over them covers them. */
function laid(y: number) {
  const pos: number[] = [], col: number[] = [], idx: number[] = [], c = new Color();
  // each wound to face up by itself: the other side of a sheet takes no sun
  const tri = (a: V, b: V, d: V) => {
    if ((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x) > 0) [b, d] = [d, b];
    for (const p of [a, b, d]) { idx.push(pos.length / 3); pos.push(p.x, y, p.y); col.push(c.r, c.g, c.b); }
  };
  const quad = (a: V, b: V, d: V, e: V) => { tri(a, b, d); tri(a, d, e); };
  return {
    ink(hex: number) { c.setHex(hex); return this; },
    rect(q: Rect) { quad({ x: q.x0, y: q.y0 }, { x: q.x1, y: q.y0 }, { x: q.x1, y: q.y1 }, { x: q.x0, y: q.y1 }); return this; },
    ribbon(pts: V[], hw: number) {
      const l = offset(pts, -hw), r = offset(pts, hw);
      for (let i = 0; i < pts.length - 1; i++) quad(l[i], l[i + 1], r[i + 1], r[i]);
      return this;
    },
    fan(pts: V[]) { for (let k = 1; k < pts.length - 1; k++) tri(pts[0], pts[k], pts[k + 1]); return this; },
    build() {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      g.setAttribute('color', new Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      return g;
    },
  };
}

const f1 = (n: number) => n.toFixed(2);
/** A lawn somebody mows: greener than the scrub, in stripes, worn where it is walked on. */
const LAWN = `
  float fine = vn(p * 2.3), mid = fbm(p * 0.08 + 5.0);
  float stripe = step(0.5, fract((p.x * 0.8 + p.y * 0.6) / 7.0));
  diffuseColor.rgb *= (0.9 + 0.1 * stripe) * (0.86 + 0.16 * mid + 0.12 * fine);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.78, 0.46, 0.06), vec3(0.6, 0.16, 0.04), vn(p * 0.3 + 9.0)), smoothstep(0.55, 0.75, fbm(p * 0.07 + 23.0)) * smoothstep(0.4, 0.7, vn(p * 1.6 + 4.0)) * 0.5);
`;
/** The pitch: mown in bands across, and its lines, all drawn where they lie. */
const TURF = (() => {
  const cx = (PITCH.x0 + PITCH.x1) / 2, cy = (PITCH.y0 + PITCH.y1) / 2, hx = (PITCH.x1 - PITCH.x0) / 2, hy = (PITCH.y1 - PITCH.y0) / 2;
  return `
  vec2 q = p - vec2(${f1(cx)}, ${f1(cy)}), h = vec2(${f1(hx)}, ${f1(hy)});
  float fine = vn(p * 2.3), band = step(0.5, fract((q.x + h.x) / 10.0));
  vec3 turf = mix(vec3(0.17, 0.33, 0.11), vec3(0.23, 0.41, 0.14), band) * (0.9 + 0.2 * fine);
  // worn to earth in the goal mouths and round the middle
  float worn = smoothstep(4.5, 0.5, length((abs(q) - vec2(h.x - 2.0, 0.0)) * vec2(1.0, 0.6))) + 0.5 * smoothstep(4.0, 0.0, length(q));
  turf = mix(turf, vec3(0.42, 0.36, 0.2), clamp(worn, 0.0, 1.0) * (0.3 + 0.5 * vn(p * 0.9)));
  vec2 a = abs(q) - h;
  float edge = max(a.x, a.y);
  // the touchlines and goal lines, the halfway line, the circle and its spot
  float d = min(abs(edge), min(abs(q.x), min(abs(length(q) - 5.2), length(q) - 0.15)));
  // at each end the box, the small box, the spot and the arc
  vec2 e = vec2(h.x - abs(q.x), abs(q.y));
  d = min(d, abs(max(e.x - 9.4, e.y - 11.5)));
  d = min(d, abs(max(e.x - 3.2, e.y - 5.2)));
  d = min(d, length(e - vec2(6.3, 0.0)) - 0.15);
  d = min(d, e.x > 9.4 ? abs(length(e - vec2(6.3, 0.0)) - 5.2) : 9.0);
  // the corner arcs
  d = min(d, abs(length(abs(q) - h) - 0.9));
  float line = (1.0 - smoothstep(0.2, 0.34, d)) * step(edge, 0.3);
  // outside the lines the grass is left longer
  turf *= mix(0.86, 1.0, step(edge, 0.0));
  diffuseColor.rgb = mix(turf, vec3(0.93, 0.93, 0.88) * (0.85 + 0.15 * fine), line * 0.92);
`;
})();
/** The school yard: tarmac gone pale, a court painted on it, a hopscotch, a snake of numbers nobody uses. */
const PLAY = (() => {
  const cx = (COURT.x0 + COURT.x1) / 2, cy = (COURT.y0 + COURT.y1) / 2, hx = (COURT.x1 - COURT.x0) / 2, hy = (COURT.y1 - COURT.y0) / 2;
  return `
  float w = fbm(p * 0.07 + 3.0), fine = vn(p * 2.6);
  diffuseColor.rgb *= 0.86 + 0.2 * w + 0.1 * fine;
  // the court: a blue floor with a margin of green, white lines, the keys in orange
  vec2 q = p - vec2(${f1(cx)}, ${f1(cy)}), h = vec2(${f1(hx)}, ${f1(hy)});
  vec2 a = abs(q) - h;
  float edge = max(a.x, a.y);
  vec3 court = mix(vec3(0.16, 0.36, 0.56), vec3(0.2, 0.46, 0.34), step(-1.2, edge));
  vec2 e = vec2(h.x - abs(q.x), abs(q.y));
  court = mix(court, vec3(0.82, 0.42, 0.16), step(e.x, 4.6) * step(e.y, 1.9) * step(edge, -1.2));
  float d = min(abs(edge + 1.2), min(abs(q.x), abs(length(q) - 1.9)));
  d = min(d, abs(max(e.x - 5.8, e.y - 1.9)));
  d = min(d, e.x > 5.8 ? abs(length(e - vec2(5.8, 0.0)) - 1.9) : 9.0);
  d = min(d, e.x > 1.2 ? abs(length(e - vec2(2.6, 0.0)) - 5.6) + step(5.8, e.y) * 9.0 : 9.0);
  court = mix(court, vec3(0.95), (1.0 - smoothstep(0.1, 0.2, d)) * step(edge, -1.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, court * (0.82 + 0.2 * fine), step(edge, 0.0) * 0.92);
  // the hopscotch: squares in chalk colours, one and two abreast
  vec2 g = (p - vec2(${f1(HOP.x)}, ${f1(HOP.y)})) / ${f1(HOP.s)};
  float row = floor(g.y), two = mod(row, 3.0) > 1.5 ? 1.0 : 0.0;
  float inx = two > 0.5 ? step(-1.0, g.x) * step(g.x, 1.0) : step(-0.5, g.x) * step(g.x, 0.5);
  float cell = inx * step(0.0, g.y) * step(g.y, ${f1(HOP.n)});
  vec2 f = fract(vec2(two > 0.5 ? g.x : g.x + 0.5, g.y));
  float rim = step(f.x, 0.08) + step(0.92, f.x) + step(f.y, 0.08) + step(0.92, f.y);
  vec3 chalk = clamp(abs(fract(h21(vec2(row, floor(g.x + 2.0) * two)) + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(mix(vec3(0.9), chalk, 0.55), vec3(0.96), clamp(rim, 0.0, 1.0)), cell * 0.85);
  // and a ring painted for whatever game needs a ring
  vec2 o = p - vec2(${f1(COURT.x0 - 11)}, ${f1(cy)});
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.78, 0.2), (1.0 - smoothstep(0.12, 0.24, abs(length(o) - 4.0))) * 0.8);
`;
})();
/** A walk nobody paved: gravel and trodden earth, paler down the middle where the feet go. */
const TROD = `
  float fine = vn(p * 3.1), mid = fbm(p * 0.21 + 7.0);
  diffuseColor.rgb *= 0.8 + 0.22 * mid + 0.16 * fine;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.4, 0.22), smoothstep(0.55, 0.8, fbm(p * 0.5 + 13.0)) * 0.4);
`;

/** A bush: a ball with dents in it. */
function clump() {
  const g = new IcosahedronGeometry(1, 1), p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // the same push for every corner that shares a point, so it stays whole
    const k = 0.78 + 0.44 * hash(Math.round(x * 50) + Math.round(z * 50) * 3.1, Math.round(y * 50));
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A lamp head or a floodlight: pale by day, and after dark it shines in its own colour and blooms. */
function shining() {
  const m = new MeshStandardMaterial({ roughness: 0.4 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = NIGHT;
    s.uniforms.uFlood = FLOOD;
    // the high ones are the floodlights, and those go out at eleven
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFlood;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFlood = 0.0;
        #ifdef USE_INSTANCING
          vFlood = step(10.0, instanceMatrix[3].y);
        #endif`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight; uniform float uFlood; varying float vFlood;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (0.2 + 6.5 * uNight * mix(1.0, uFlood, vFlood));');
  };
  m.customProgramCacheKey = () => 'commons-head';
  return m;
}

/** What a lamp throws on the ground: no light, a round glow laid over it in the lamp's colour, there when it is dark. */
function thrown() {
  return new ShaderMaterial({
    uniforms: { uNight: NIGHT, uFlood: FLOOD },
    vertexShader: /* glsl */ `
      uniform float uFlood;
      varying vec2 vP; varying vec3 vInk;
      void main() {
        vP = position.xy; vInk = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vInk = instanceColor;
        #endif
        // the wide ones are what the floodlights throw, and those go out at eleven
        #ifdef USE_INSTANCING
          vInk *= mix(1.0, uFlood, step(15.0, length(instanceMatrix[0].xyz)));
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying vec2 vP; varying vec3 vInk;
      void main() {
        float a = max(0.0, 1.0 - length(vP));
        gl_FragColor = vec4(vInk * a * a * (0.25 + 0.75 * a) * uNight * 0.34, 1.0);
      }`,
    blending: AdditiveBlending, transparent: true, depthWrite: false,
  });
}

/**
 * Players, children and whoever watches: nobody steers them, it is all in the shader. They walk in from their gate when their
 * hour comes and out again when it is over. In between, seen at sixty times life, they hardly go anywhere: a player is a
 * jitter round a spot that drifts, a keeper a jitter in his goal, someone watching shifts a little, someone on a phone not at all.
 */
function playing(clock: { value: number }) {
  const m = new MeshStandardMaterial({ roughness: 0.9 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uHour = HOUR;
    s.uniforms.uPlay = clock;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uHour; uniform float uPlay;
        attribute vec4 aWho; attribute vec4 aWhen;
        float there(vec2 w) { return smoothstep(w.x, w.x + 0.22, uHour) * (1.0 - smoothstep(w.y - 0.22, w.y, uHour)); }
        // a value that changes smoothly from one step of time to the next
        float fidget(float t, float s) { float i = floor(t), f = fract(t); f = f * f * (3.0 - 2.0 * f);
          return mix(fract(sin((i + s) * 91.7) * 43758.5), fract(sin((i + 1.0 + s) * 91.7) * 43758.5), f) - 0.5; }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          float role = aWho.x, sd = aWho.w;
          float here = max(there(aWhen.xy), there(aWhen.zw));
          // how far the jitter goes, and how far the spot itself wanders; the small ones keep closer
          float small = sc.y > 1.6 ? 1.0 : 0.5;
          float amp = (role < 0.5 ? 1.5 : role < 1.5 ? 0.7 : role < 2.5 ? 0.14 : 0.0) * small;
          float roam = (role < 0.5 ? 5.0 : role < 1.5 ? 1.2 : 0.0) * small;
          // at sixty times life nobody is seen to move: they are somewhere else every frame, and the spot they keep to
          // is itself across the pitch and back in a second
          vec2 at = vec2(fidget(uPlay * 9.0, sd), fidget(uPlay * 9.0, sd + 17.0)) * amp * 2.0
                  + vec2(fidget(uPlay * 1.1, sd + 3.0), fidget(uPlay * 1.1, sd + 29.0)) * roam * 2.0;
          // on the way in and out: along the line from the gate, with a little of the jitter
          vec2 off = mix(aWho.yz - instanceMatrix[3].xz + at * 0.2, at, here);
          transformed.xz += off / sc.xz;
          transformed *= step(0.03, here);
        #endif`);
  };
  m.customProgramCacheKey = () => 'commons-play';
  return m;
}

const THINGS = 900, HEADS = 64, POOLS = 64, BUSHES = 3200, FIGURES = 72;

export function Commons({ green, speed }: { green: Green; speed: number }) {
  const things = useRef<InstancedMesh>(null), heads = useRef<InstancedMesh>(null), pools = useRef<InstancedMesh>(null), bushes = useRef<InstancedMesh>(null), figures = useRef<InstancedMesh>(null);
  const clock = useMemo(() => ({ value: 0 }), []);
  const mats = useMemo(() => {
    const trod = grained(0xffffff, TROD, 'trod', 1, 0.16);
    trod.vertexColors = true;
    return {
      lawn: grained(0x577f2b, LAWN, 'lawn', 1),
      turf: grained(0xffffff, TURF, 'turf', 1),
      play: grained(0x8f9092, PLAY, 'play', 0.95, 0.12),
      trod,
      head: shining(), pool: thrown(), figure: playing(clock),
    };
  }, [clock]);
  const blob = useMemo(clump, []);

  // the lawn does not change; the rest is laid again when a road has taken some of it
  const lawn = useMemo(() => (green.lawn.length ? laid(0.003).ink(0xffffff).fan(green.lawn).build() : null), [green.lawn]);
  const turf = useMemo(() => laid(0.005).ink(0xffffff).rect(grown(PITCH, RUN)).build(), []);
  const play = useMemo(() => laid(0.005).ink(0xffffff).rect(YARD).build(), []);
  const trod = useMemo(() => {
    const f = laid(0.009);
    for (const t of green.trails) f.ink(t.ink).ribbon(t.pts, t.hw);
    return f.build();
  }, [green.trails]);
  useEffect(() => () => trod.dispose(), [trod]);

  useLayoutEffect(() => {
    const o = new Object3D(), c = new Color();
    const put = (m: InstancedMesh, list: Thing[]) => {
      list.forEach((t, i) => {
        o.position.set(t.x, t.y, t.z); o.scale.set(t.sx, t.sy, t.sz); o.rotation.set(0, t.rot, 0);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        m.setColorAt(i, c.setHex(t.ink));
      });
      m.count = list.length;
    };
    put(things.current!, green.things.slice(0, THINGS));
    put(heads.current!, green.heads.slice(0, HEADS));
    green.pools.slice(0, POOLS).forEach((p, i) => {
      o.position.set(p.x, 0.2, p.z); o.scale.set(p.r, p.r, 1); o.rotation.set(-Math.PI / 2, 0, 0);
      o.updateMatrix();
      pools.current!.setMatrixAt(i, o.matrix);
      pools.current!.setColorAt(i, c.setRGB(...p.ink));
    });
    pools.current!.count = Math.min(POOLS, green.pools.length);
    green.bushes.slice(0, BUSHES).forEach((b, i) => {
      o.position.set(b.x, b.h * 0.55, b.z); o.scale.set(b.s, b.h, b.s); o.rotation.set(0, b.x * 7 + b.z * 3, 0);
      o.updateMatrix();
      bushes.current!.setMatrixAt(i, o.matrix);
      bushes.current!.setColorAt(i, c.setHex(b.ink));
    });
    bushes.current!.count = Math.min(BUSHES, green.bushes.length);
    const who = new Float32Array(FIGURES * 4), when = new Float32Array(FIGURES * 4);
    green.figures.slice(0, FIGURES).forEach((f, i) => {
      o.position.set(f.x, f.h / 2 + 0.05, f.z); o.scale.set(0.5, f.h, 0.5); o.rotation.set(0, 0, 0);
      o.updateMatrix();
      figures.current!.setMatrixAt(i, o.matrix);
      figures.current!.setColorAt(i, c.setHex(f.ink));
      who.set([f.role, f.gate.x, f.gate.y, (f.x * 0.371 + f.z * 0.737) % 97], i * 4);
      when.set(f.when, i * 4);
    });
    const fg = figures.current!.geometry;
    fg.setAttribute('aWho', new InstancedBufferAttribute(who, 4));
    fg.setAttribute('aWhen', new InstancedBufferAttribute(when, 4));
    figures.current!.count = Math.min(FIGURES, green.figures.length);
    for (const m of [things.current!, heads.current!, pools.current!, bushes.current!, figures.current!]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }, [green]);

  useFrame((_, delta) => {
    // their own time: six times ours while the day runs, still in a still
    clock.value += Math.min(delta, 0.05) * (speed / TIMELAPSE) * 6;
    pools.current!.visible = NIGHT.value > 0.01;
  });

  return (
    <group name="commons">
      {lawn && <mesh geometry={lawn} material={mats.lawn} receiveShadow />}
      {green.pitch && <mesh geometry={turf} material={mats.turf} receiveShadow />}
      {green.school && <mesh geometry={play} material={mats.play} receiveShadow />}
      <mesh geometry={trod} material={mats.trod} receiveShadow />
      <instancedMesh ref={things} args={[undefined, undefined, THINGS]} castShadow receiveShadow frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, HEADS]} material={mats.head} frustumCulled={false}>
        <boxGeometry />
      </instancedMesh>
      <instancedMesh ref={pools} args={[undefined, undefined, POOLS]} material={mats.pool} frustumCulled={false}>
        <circleGeometry args={[1, 20]} />
      </instancedMesh>
      <instancedMesh ref={bushes} args={[blob, undefined, BUSHES]} castShadow receiveShadow frustumCulled={false}>
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={figures} args={[undefined, undefined, FIGURES]} material={mats.figure} frustumCulled={false}>
        <boxGeometry />
      </instancedMesh>
    </group>
  );
}
