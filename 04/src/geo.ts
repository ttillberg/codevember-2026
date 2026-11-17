// Flat geometry for the ground plan: asphalt, kerbs, paint. Built from the network.
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { cumLen, deck, offset, pointOn, STALL_D, STALL_W, trim, type Lane, type Net, type Node, type Road, type V } from './net';

/** Metres: no piece of a ribbon is longer than this, so the ground can bend under a smear (wet.ts). */
const BEND = 6;

class Flat {
  pos: number[] = [];
  idx: number[] = [];
  /** extra height at a point: a bridge deck */
  hf: ((p: V) => number) | null = null;
  constructor(public y: number) {}
  private v(p: V) {
    this.pos.push(p.x, this.y + (this.hf ? this.hf(p) : 0), p.y);
    return this.pos.length / 3 - 1;
  }
  /** Wound to face up on its own, so a folded quad cannot show its dark side. */
  tri(a: V, b: V, c: V) {
    if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0) { const t = b; b = c; c = t; }
    const i = this.v(a);
    this.v(b); this.v(c);
    this.idx.push(i, i + 1, i + 2);
  }
  quad(a: V, b: V, c: V, d: V) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  ribbon(pts: V[], o0: number, o1: number) {
    const l = offset(pts, o0), r = offset(pts, o1);
    for (let i = 0; i < pts.length - 1; i++) {
      // a long straight stretch is laid in short pieces: a smear being dragged bends the ground in the shader, at its corners
      const n = this.hf ? 1 : Math.ceil(Math.max(Math.hypot(l[i + 1].x - l[i].x, l[i + 1].y - l[i].y), Math.hypot(r[i + 1].x - r[i].x, r[i + 1].y - r[i].y)) / BEND);
      if (n <= 1) { this.quad(l[i], l[i + 1], r[i + 1], r[i]); continue; }
      const on = (a: V, b: V, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      for (let k = 0; k < n; k++) this.quad(on(l[i], l[i + 1], k / n), on(l[i], l[i + 1], (k + 1) / n), on(r[i], r[i + 1], (k + 1) / n), on(r[i], r[i + 1], k / n));
    }
  }
  /** A ribbon `w` to either side at its two ends and `more` wider than that in its middle. */
  swell(pts: V[], w: number, more: number) {
    const u = offset(pts, 1), n = pts.length - 1;
    const edge = (s: number) => {
      const e = pts.map((p, i) => {
        const k = s * (w + more * Math.sin((Math.PI * i) / n));
        return { x: p.x + (u[i].x - p.x) * k, y: p.y + (u[i].y - p.y) * k };
      });
      // on the inside of a bend tighter than the ribbon is wide the edge would run backwards: it waits there instead
      for (let i = 1; i <= n; i++) if ((e[i].x - e[i - 1].x) * (pts[i].x - pts[i - 1].x) + (e[i].y - e[i - 1].y) * (pts[i].y - pts[i - 1].y) < 0) e[i] = e[i - 1];
      return e;
    };
    const l = edge(-1), r = edge(1);
    for (let i = 0; i < n; i++) this.quad(l[i], l[i + 1], r[i + 1], r[i]);
  }
  dashed(pts: V[], off: number, w: number, on: number, gap: number) {
    const line = offset(pts, off);
    const cum = cumLen(line);
    const len = cum[cum.length - 1];
    for (let s = gap / 2; s + on < len; s += on + gap) {
      // a dash bends with its line, and on a bridge climbs with it
      const seg = [pointOn(line, cum, s)];
      for (let i = 1; i < line.length - 1; i++) if (cum[i] > s + 0.05 && cum[i] < s + on - 0.05) seg.push(line[i]);
      seg.push(pointOn(line, cum, s + on));
      this.ribbon(seg, -w / 2, w / 2);
    }
  }
  poly(pts: V[]) {
    let area = 0;
    for (let k = 0; k < pts.length; k++) { const a = pts[k], b = pts[(k + 1) % pts.length]; area += a.x * b.y - b.x * a.y; }
    if (area > 0) pts = [...pts].reverse();
    const i = this.v(pts[0]);
    for (let k = 1; k < pts.length; k++) this.v(pts[k]);
    for (let k = 1; k < pts.length - 1; k++) this.idx.push(i, i + k, i + k + 1);
  }
  rect(x0: number, y0: number, x1: number, y1: number) {
    this.quad({ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 });
  }
  build() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(new Float32Array(this.pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(this.idx);
    return g;
  }
}

function hull(pts: V[]): V[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: V, a: V, b: V) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: V[] = [], up: V[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** A polyline with a point at least every `step` metres, so a ribbon can follow a height profile. */
function dense(pts: V[], step: number): V[] {
  const cum = cumLen(pts);
  const len = cum[cum.length - 1];
  const n = Math.max(1, Math.ceil(len / step));
  const out: V[] = [];
  for (let i = 0; i <= n; i++) out.push(pointOn(pts, cum, (len * i) / n));
  return out;
}

/** The box round each stretch of a road's centreline, and the stretch the last point asked about was nearest to. */
const stretches = new WeakMap<Road, { box: Float64Array; last: number }>();
/** Distance along a road's centreline of the point nearest p. */
function along(r: Road, cum: number[], p: V) {
  const n = r.pts.length - 1;
  let sb = stretches.get(r);
  if (!sb) {
    const box = new Float64Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      box.set([Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)], i * 4);
    }
    stretches.set(r, (sb = { box, last: 0 }));
  }
  const dist = (i: number) => {
    const a = r.pts[i], b = r.pts[i + 1];
    const seg = cum[i + 1] - cum[i] || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (seg * seg)));
    return { d: Math.hypot(a.x + (b.x - a.x) * t - p.x, a.y + (b.y - a.y) * t - p.y), s: cum[i] + t * seg };
  };
  // points are asked about in order along the deck: the stretch of the last one is near, and rules out the far ones
  const ub = sb.last < n ? dist(sb.last).d : Infinity;
  const box = sb.box;
  let best = 0, bd = Infinity;
  for (let i = 0; i < n; i++) {
    const bx = Math.max(box[i * 4] - p.x, p.x - box[i * 4 + 2], 0), by = Math.max(box[i * 4 + 1] - p.y, p.y - box[i * 4 + 3], 0);
    if (Math.hypot(bx, by) > ub) continue;
    const { d, s } = dist(i);
    if (d < bd) { bd = d; best = s; sb.last = i; }
  }
  return best;
}

/** How far a point is from a polyline. */
function away(pts: V[], p: V) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
  }
  return best;
}

/** Is p inside a convex outline, whichever way round it is given? */
function within(poly: V[], p: V) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(c) < 1e-9) continue;
    if (sign && Math.sign(c) !== sign) return false;
    sign = Math.sign(c);
  }
  return true;
}

/** The concrete of a bridge: a thick slab, a parapet with a top you can see from the air, and piers under it. */
function buildDecks(net: Net) {
  const pos: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const SLAB = 1.5, RAIL = 1.15, CAP = 0.7;
  for (const r of net.roads) {
    if (!r.bridge) continue;
    const D = dense(r.pts, 4);
    const cum = cumLen(D);
    const w = r.hw + 0.5;
    const h = cum.map((d) => deck(r, d));
    // no parapet across the mouth of a road that joins it, on the ground or in the air
    const joins = [...r.a.roads, ...r.b.roads].filter((q) => q !== r);
    const mouth = (p: V, q: V) => {
      const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      return joins.some((t) => {
        for (let n = 1; n < t.pts.length; n++) {
          const a = t.pts[n - 1], b = t.pts[n], dx = b.x - a.x, dy = b.y - a.y;
          const u = Math.max(0, Math.min(1, ((m.x - a.x) * dx + (m.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
          if (Math.hypot(a.x + dx * u - m.x, a.y + dy * u - m.y) < t.hw + 0.45) return true;
        }
        return false;
      });
    };
    for (const side of [-1, 1]) {
      const I = offset(D, side * w), O = offset(D, side * (w + CAP));
      for (let i = 0; i < D.length - 1; i++) {
        const j = i + 1;
        if (mouth(I[i], I[j])) continue;
        // nor inside the junction it lands in
        const mid = (cum[i] + cum[j]) / 2;
        if ((!r.a.z && r.a.roads.length > 2 && mid < r.a.trim) || (!r.b.z && r.b.roads.length > 2 && mid > r.len - r.b.trim)) continue;
        // the parapet: inner face, its top, and the outer face that runs down past the slab
        quad([I[i].x, h[i], I[i].y], [I[j].x, h[j], I[j].y], [I[j].x, h[j] + RAIL, I[j].y], [I[i].x, h[i] + RAIL, I[i].y]);
        quad([I[i].x, h[i] + RAIL, I[i].y], [I[j].x, h[j] + RAIL, I[j].y], [O[j].x, h[j] + RAIL, O[j].y], [O[i].x, h[i] + RAIL, O[i].y]);
        quad([O[i].x, h[i] - SLAB, O[i].y], [O[j].x, h[j] - SLAB, O[j].y], [O[j].x, h[j] + RAIL, O[j].y], [O[i].x, h[i] + RAIL, O[i].y]);
      }
    }
    const L = offset(D, -(w + CAP)), R = offset(D, w + CAP);
    for (let i = 0; i < D.length - 1; i++) {
      const j = i + 1;
      quad([L[i].x, h[i] - SLAB, L[i].y], [L[j].x, h[j] - SLAB, L[j].y], [R[j].x, h[j] - SLAB, R[j].y], [R[i].x, h[i] - SLAB, R[i].y]);
    }
    // the ramps are filled in down to the ground; past them the deck is in the air
    const FILL = 2;
    for (const O of [L, R]) {
      for (let i = 0; i < D.length - 1; i++) {
        const j = i + 1, ui = h[i] - SLAB, uj = h[j] - SLAB;
        if (Math.max(ui, uj) <= 0 || Math.min(ui, uj) > FILL) continue;
        quad([O[i].x, 0, O[i].y], [O[j].x, 0, O[j].y], [O[j].x, Math.max(0, uj), O[j].y], [O[i].x, Math.max(0, ui), O[i].y]);
      }
    }
    // and stands on piers: a column under each edge, where they show from the air, and a beam across their heads.
    // A column does not stand in a road; the pier moves along until it has ground, or stands on one leg
    const COL = 0.9, BEAM = 1.1;
    const at = (d: number) => {
      const c = pointOn(D, cum, d), c2 = pointOn(D, cum, d + 1);
      const tl = Math.hypot(c2.x - c.x, c2.y - c.y) || 1;
      const tx = (c2.x - c.x) / tl, ty = (c2.y - c.y) / tl, e = w + CAP - COL;
      const legs = [-1, 1].map((k) => ({ x: c.x - ty * e * k, y: c.y + tx * e * k })).filter((q) => !onRoad(net, q.x, q.y, r, COL + 0.6));
      return { d, c, tx, ty, legs };
    };
    const box = (c: V, tx: number, ty: number, along: number, across: number, y0: number, y1: number) => {
      const ax = tx * along, ay = ty * along, nx = -ty * across, ny = tx * across;
      const P = [[c.x - nx - ax, c.y - ny - ay], [c.x + nx - ax, c.y + ny - ay], [c.x + nx + ax, c.y + ny + ay], [c.x - nx + ax, c.y - ny + ay]];
      for (let k = 0; k < 4; k++) {
        const p = P[k], q = P[(k + 1) % 4];
        quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]);
      }
      quad([P[0][0], y0, P[0][1]], [P[3][0], y0, P[3][1]], [P[2][0], y0, P[2][1]], [P[1][0], y0, P[1][1]]);
    };
    for (let d = 10; d < r.len - 8; d += 17) {
      if (deck(r, d) - SLAB < FILL) continue;
      let best = at(d);
      for (const o of [4, -4, 8, -8]) {
        if (best.legs.length === 2) break;
        const t = at(d + o);
        if (t.legs.length > best.legs.length && deck(r, d + o) - SLAB >= FILL) best = t;
      }
      if (!best.legs.length) continue;
      const top = deck(r, best.d) - SLAB;
      for (const q of best.legs) box(q, best.tx, best.ty, COL, COL, 0, top - BEAM);
      box(best.c, best.tx, best.ty, COL + 0.2, w + CAP, top - BEAM, top);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** The brush stroke while it is being drawn. */
export function strokeGeometry(pts: V[], hw: number) {
  const f = new Flat(0.12);
  if (pts.length > 1) f.ribbon(pts, -hw, hw);
  return f.build();
}

/** Concrete laid on the grass: aprons as rectangles, paths as ribbons. */
export function pavingGeometry(rects: { x0: number; y0: number; x1: number; y1: number }[], paths: { pts: V[]; hw: number }[]) {
  const f = new Flat(0.008);
  for (const r of rects) f.rect(r.x0, r.y0, r.x1, r.y1);
  for (const p of paths) f.ribbon(p.pts, -p.hw, p.hw);
  return f.build();
}

/**
 * A lane arrow, as long as a car: its tail at o, t along the lane and n to its right. Straight on, with a branch
 * that bends off to either side, or only the bend. Laid in short pieces, so that it follows a ramp.
 */
function arrow(f: Flat, o: V, t: V, n: V, left: boolean, on: boolean, right: boolean) {
  const at = (u: number, v: number) => ({ x: o.x + t.x * u + n.x * v, y: o.y + t.y * u + n.y * v });
  const head = (u: number, v: number, du: number, dv: number, half: number, len: number) => {
    const l = Math.hypot(du, dv);
    du /= l; dv /= l;
    f.tri(at(u - dv * half, v + du * half), at(u + dv * half, v - du * half), at(u + du * len, v + dv * len));
  };
  const sides = [left ? -1 : 0, right ? 1 : 0].filter((s) => s);
  // a stem that turns one way only stands to the other side of its lane, so the bend has room
  const v0 = sides.length === 1 ? -sides[0] * (on ? 0.3 : 0.45) : 0;
  const fork = on ? 1.3 : 3.1, top = on ? 3.5 : fork;
  const stem: V[] = [];
  for (let u = 0; u < top; u++) stem.push(at(u, v0));
  stem.push(at(top, v0));
  f.ribbon(stem, -0.18, 0.18);
  if (on) head(3.4, v0, 1, 0, 0.65, 2);
  for (const s of sides) {
    f.ribbon([at(fork - 0.18, v0), at(fork + 0.75, v0 + s * 0.5), at(fork + 0.95, v0 + s * 0.8)], -0.18, 0.18);
    head(fork + 0.9, v0 + s * 0.7, 0.22, s, 0.6, 1.15);
  }
}

/** Is there a zebra across this end of a road? Where it gives way or meets the lights; not up on a deck or across a ramp, where nobody walks. */
export function zebraAt(r: Road, end: number) {
  const node = end ? r.b : r.a;
  if (node.stub || r.bridge || r.ring || r.one || r.rank < 1) return false;
  return (node.signal || r.rank < Math.max(...node.roads.map((q) => q.rank))) && cumLen(r.base).pop()! >= 20;
}

/** How far a sidewalk reaches beyond the kerb. */
export const WALK = 3.4;

export function buildGround(net: Net) {
  const walk = new Flat(0.012);
  // what stands on the ground stands on concrete. It is kept apart from the sidewalks, with the kerb round a lot:
  // the lots and the sheds stay put while a smear is dragged, and what lies along the roads goes with them
  const yard = new Flat(0.012), rim = new Flat(0.028);
  for (const b of net.buildings) yard.rect(b.x0 - 4, b.y0 - 4, b.x1 + 4, b.y1 + 4);
  for (const r of net.pads) yard.rect(r.x0 - 3, r.y0 - 3, r.x1 + 3, r.y1 + 3);
  // from the ground up: slabs, the studded strip, kerbs, lots, asphalt, paint. Whatever lies higher hides what it crosses,
  // so a sidewalk that runs into another road goes under it, strip and all
  const guide = new Flat(0.02), kerb = new Flat(0.028), pad = new Flat(0.037), road = new Flat(0.05), white = new Flat(0.07), yellow = new Flat(0.07);
  const SH = 0.45; // shoulder

  for (const r of net.pads) {
    rim.rect(r.x0 - 0.5, r.y0 - 0.5, r.x1 + 0.5, r.y1 + 0.5);
    pad.rect(r.x0, r.y0, r.x1, r.y1);
  }

  // the lanes of each road, and the turns through each junction
  const lanesOf = new Map<Road, Lane[]>(), turnsAt = new Map<Node, Lane[]>();
  for (const l of net.lanes) {
    if (l.road) (lanesOf.get(l.road) ?? lanesOf.set(l.road, []).get(l.road)!).push(l);
    else if (l.conn) (turnsAt.get(l.conn.node) ?? turnsAt.set(l.conn.node, []).get(l.conn.node)!).push(l);
  }
  /** Half the width of the asphalt under one turn. */
  const reach = (l: Lane) => Math.max(l.conn!.src.road!.lw, l.conn!.dst.road!.lw) / 2 + SH;
  /** The two corners of every arm's mouth, `more` metres beyond the shoulder. */
  const mouths = (n: Node, more = 0) => n.roads.flatMap((r) => {
    const b = r.base, p = r.a === n ? b[0] : b[b.length - 1], q = r.a === n ? b[1] : b[b.length - 2];
    const L = Math.hypot(p.x - q.x, p.y - q.y) || 1, w = r.hw + SH + more;
    const nx = (-(p.y - q.y) / L) * w, ny = ((p.x - q.x) / L) * w;
    return [{ x: p.x + nx, y: p.y + ny }, { x: p.x - nx, y: p.y - ny }];
  });
  // A junction whose arms leave at flat angles keeps them far back from its middle. Paved from mouth to mouth that is
  // a field of asphalt. It is laid as its turns instead, a slip road each, and what no turn crosses is left as an island
  const loose = new Set(net.nodes.filter((n) => !n.stub && n.z === 0 && n.roads.length >= 3 && turnsAt.has(n)
    && !n.roads.some((q) => q.ring || q.rank < 1) && n.trim >= Math.max(...n.roads.map((q) => q.hw)) + 8));
  const aprons = new Map<Node, V[]>();
  for (const n of net.nodes) if (!n.stub && !loose.has(n)) aprons.set(n, hull(mouths(n)));
  /** Is there junction under this point? */
  const paved = (n: Node, p: V) => (loose.has(n) ? turnsAt.get(n)!.some((l) => away(l.pts, p) < reach(l)) : within(aprons.get(n)!, p));

  const flats = [kerb, pad, road, white, yellow];
  for (const r of net.roads) {
    const hw = r.hw;
    const target = r.rank >= 1 ? road : pad;
    const single = r.ring || r.one;
    // an arm runs on to the middle of its junction, but stops at its mouth where the junction is laid as slip roads
    const fit = Math.min(1, (r.len - 1) / (r.a.trim + r.b.trim || 1));
    // (a bridge keeps its deck under it all the way)
    const body = r.bridge ? r.pts : trim(r.pts, loose.has(r.a) ? r.a.trim * fit : 0, loose.has(r.b) ? r.b.trim * fit : 0);
    // what is left of it between its two junctions. On a stub there is no room for paint: lines there are only clutter
    const run = cumLen(r.base).pop()!;
    // and where another arm of the same junction still lies on it there is none either: the lines begin where the roads part
    const L = offset(r.base, -hw), R = offset(r.base, hw), cl = cumLen(L), cr = cumLen(R);
    const shared = [r.a, r.b].map((n, end) => {
      const others = n.roads.filter((q) => q !== r && q.bridge === r.bridge);
      let s = 0;
      for (; s < Math.min(40, run / 2); s += 2) {
        const ends = [pointOn(L, cl, end ? cl[cl.length - 1] - s : s), pointOn(R, cr, end ? cr[cr.length - 1] - s : s)];
        if (!ends.some((p) => others.some((q) => away(q.base, p) < q.hw + SH - 0.3))) break;
      }
      return s;
    });
    const marked = run - shared[0] - shared[1];
    const lined = marked >= 20;
    // a bridge is laid along a finer line, so its ribbons can climb
    const pts = r.bridge ? dense(body, 4) : body;
    const base = r.bridge ? dense(r.base, 4) : r.base;
    const mark = shared[0] || shared[1] ? trim(base, shared[0], shared[1]) : base;
    if (r.bridge) {
      const cum = cumLen(r.pts);
      for (const f of flats) f.hf = (p) => deck(r, along(r, cum, p));
      // paint lies a little proud of a deck: the deck is flat between its own points, the paint between others
      white.hf = yellow.hf = (p) => deck(r, along(r, cum, p)) + 0.07;
    }
    target.ribbon(pts, -(hw + SH), hw + SH);
    if (r.rank >= 1 && !r.bridge) {
      kerb.ribbon(pts, -(hw + SH + 0.5), hw + SH + 0.5);
      walk.ribbon(pts, -(hw + SH + 0.5 + WALK), hw + SH + 0.5 + WALK);
      // the yellow line of studded tiles that every sidewalk here has, for those who walk by touch
      if (run >= 20) for (const side of [-1, 1]) guide.ribbon(base, side * (hw + SH + 1.8), side * (hw + SH + 2.3));
    }
    if (!lined) {
      // bare
    } else if (single) {
      white.ribbon(mark, hw - 0.14, hw);
      white.ribbon(mark, -hw, -hw + 0.14);
      for (let i = 1; i < r.lanes; i++) white.dashed(mark, i * r.lw - hw, 0.13, 2, 4);
      // one way: an arrow in every lane says which
      const cum = cumLen(mark), at = cum[cum.length - 1] / 2 - 2.7;
      const o = pointOn(mark, cum, at), o2 = pointOn(mark, cum, at + 2.7);
      const d = Math.hypot(o2.x - o.x, o2.y - o.y) || 1, t = { x: (o2.x - o.x) / d, y: (o2.y - o.y) / d }, n = { x: -t.y, y: t.x };
      for (let i = 0; i < r.lanes; i++) {
        const v = (i + 0.5) * r.lw - hw;
        arrow(white, { x: o.x + n.x * v, y: o.y + n.y * v }, t, n, false, true, false);
      }
    } else if (r.rank >= 2) {
      yellow.ribbon(mark, -0.28, -0.14);
      yellow.ribbon(mark, 0.14, 0.28);
      white.ribbon(mark, hw - 0.14, hw);
      white.ribbon(mark, -hw, -hw + 0.14);
      for (let i = 1; i < r.lanes; i++) {
        white.dashed(mark, i * r.lw, 0.13, 3, 9);
        white.dashed(mark, -i * r.lw, 0.13, 3, 9);
      }
    } else if (r.rank === 1) yellow.dashed(mark, 0, 0.12, 2, 4);
    // a yard at a dead end: parking either side of the last stretch
    if (r.rank >= 1) {
      for (const si of r.stallSegs) {
        const seg = [r.raw[si], r.raw[si + 1]], w = hw + 0.4 + STALL_D + 0.6;
        pad.ribbon(seg, -w, w);
        kerb.ribbon(seg, -(w + 0.5), w + 0.5);
        walk.ribbon(seg, -(w + 3), w + 3);
      }
    }

    // stop lines where this road gives way or meets the signal
    for (const end of [0, 1]) {
      const node = end ? r.b : r.a;
      if (node.stub || run < 12) continue;
      // nobody arrives at the start of a one-way road
      if (single && !end) continue;
      const top = Math.max(...node.roads.map((q) => q.rank));
      if (!(node.signal || (r.rank < top && r.rank >= 1))) continue;
      const b = mark;
      const p = end ? b[b.length - 1] : b[0];
      const q = end ? b[b.length - 2] : b[1];
      const L = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      const tx = (p.x - q.x) / L, ty = (p.y - q.y) / L; // towards the junction
      const nx = -ty, ny = tx; // right of travel
      // the line lies across the lanes that arrive: the right half of a road, all of a ramp
      const from = single ? -hw : 0.25;
      const a0 = { x: p.x + nx * from, y: p.y + ny * from }, a1 = { x: p.x + nx * hw, y: p.y + ny * hw };
      white.quad(a0, a1, { x: a1.x - tx * 0.5, y: a1.y - ty * 0.5 }, { x: a0.x - tx * 0.5, y: a0.y - ty * 0.5 });
      // which way each lane may go, painted on it before the line: the turns the traffic in it really has
      if (r.rank >= 2 && marked >= 45) {
        for (const l of lanesOf.get(r) ?? []) {
          if (l.to !== node || !l.next.length) continue;
          const ways = new Set(l.next.map((c) => c.conn!.turn));
          const v = (single ? -hw : 0) + (l.idx + 0.5) * r.lw;
          arrow(white, { x: p.x + nx * v - tx * 11.5, y: p.y + ny * v - ty * 11.5 }, { x: tx, y: ty }, { x: nx, y: ny }, ways.has('L'), ways.has('T'), ways.has('R'));
        }
      }
      // a zebra beyond the line, as wide as the road; not where the lines stopped short of the junction
      if (zebraAt(r, end) && !shared[end]) {
        // an arm of a roundabout has only so much room before the ring
        const ring = node.roads.find((k) => k.ring);
        const deep = ring ? Math.min(3, node.trim - ring.hw - 1.6) : 3;
        const n = Math.floor((2 * hw + 0.2) / 1.2);
        const stripes: V[][] = [];
        for (let i = 0; i < n && deep >= 1.5; i++) {
          const k = i * 1.2 - (n * 1.2 - 0.6) / 2;
          const c = { x: p.x + nx * k + tx * 1.2, y: p.y + ny * k + ty * 1.2 };
          const f0 = { x: c.x + tx * deep, y: c.y + ty * deep }, f1 = { x: f0.x + nx * 0.6, y: f0.y + ny * 0.6 };
          // a stripe that would end on the kerb or the grass is left out
          if (paved(node, f0) && paved(node, f1)) stripes.push([c, { x: c.x + nx * 0.6, y: c.y + ny * 0.6 }, f1, f0]);
        }
        // and a zebra that would not reach across is no zebra
        if (stripes.length >= n - 1) for (const q of stripes) white.quad(q[0], q[1], q[2], q[3]);
      }
    }
    for (const f of flats) f.hf = null;
  }

  // and room to turn where a road ends
  const round = (p: V, R: number) => Array.from({ length: 18 }, (_, k) => ({ x: p.x + R * Math.cos((k / 18) * 6.2832), y: p.y + R * Math.sin((k / 18) * 6.2832) }));
  for (const n of net.nodes) {
    const r = n.roads[0];
    if (!n.stub || n.edge || r.rank < 1 || r.bridge) continue;
    road.poly(round(n.p, r.hw + 5));
    kerb.poly(round(n.p, r.hw + 5.5));
    walk.poly(round(n.p, r.hw + 8.5));
  }

  // junction aprons
  for (const n of net.nodes) {
    if (n.stub) continue;
    if (loose.has(n)) {
      const turns = turnsAt.get(n)!;
      for (const l of turns) {
        // a little wider in the bend, as a slip road is, which also closes the hairline between two turns side by side
        const w = reach(l), more = 0.5;
        road.swell(l.pts, w, more);
        // a turn onto or off a bridge has the deck's own edge, not a kerb
        if (l.conn!.src.road!.bridge || l.conn!.dst.road!.bridge) continue;
        kerb.swell(l.pts, w + 0.5, more);
        walk.swell(l.pts, w + 0.5 + WALK, more);
      }
      // What the turns leave open between them, on a grid of one metre: every turn stamps the squares under it, whatever
      // the open ground outside can reach is outside, and the rest are the gaps. A gap with some body to it stays,
      // as an island; slivers and specks are paved over
      const R = n.trim + 8, N = Math.ceil(2 * R) + 2, x0 = n.p.x - R - 1, y0 = n.p.y - R - 1;
      const cell = new Uint8Array(N * N);
      for (const l of turns) {
        const w = reach(l);
        for (let d = 0; d <= l.len; d += 0.5) {
          const p = pointOn(l.pts, l.cum, d);
          for (let j = Math.max(0, Math.floor(p.y - w - y0)); j <= Math.min(N - 1, Math.ceil(p.y + w - y0)); j++) {
            for (let i = Math.max(0, Math.floor(p.x - w - x0)); i <= Math.min(N - 1, Math.ceil(p.x + w - x0)); i++) {
              if (Math.hypot(x0 + i + 0.5 - p.x, y0 + j + 0.5 - p.y) <= w) cell[j * N + i] = 1;
            }
          }
        }
      }
      const flood = (from: number, mark: number) => {
        const got = [from];
        cell[from] = mark;
        for (let k = 0; k < got.length; k++) {
          const c = got[k], i = c % N;
          for (const q of [i > 0 ? c - 1 : -1, i < N - 1 ? c + 1 : -1, c - N, c + N]) if (q >= 0 && q < N * N && !cell[q]) { cell[q] = mark; got.push(q); }
        }
        return got;
      };
      flood(0, 2);
      for (let c = 0; c < N * N; c++) {
        if (cell[c]) continue;
        const gap = flood(c, 3);
        // body: squares with gap on all four sides of them
        const body = gap.filter((q) => cell[q - 1] === 3 && cell[q + 1] === 3 && cell[q - N] === 3 && cell[q + N] === 3).length;
        for (const q of gap) cell[q] = 4;
        if (gap.length >= 14 && body >= 3) continue;
        for (const q of gap) road.rect(x0 + (q % N) - 0.4, y0 + Math.floor(q / N) - 0.4, x0 + (q % N) + 1.4, y0 + Math.floor(q / N) + 1.4);
      }
      continue;
    }
    const top = Math.max(...n.roads.map((q) => q.rank));
    // a junction on a bridge is laid at its height
    road.hf = pad.hf = n.z ? () => n.z : null;
    (top >= 1 ? road : pad).poly(aprons.get(n)!);
    road.hf = pad.hf = null;
    if (top >= 1 && !n.roads.some((q) => q.bridge)) walk.poly(hull(mouths(n, 0.5 + WALK)));
  }

  // stall lines
  for (const s of net.stalls) {
    const nx = Math.cos(s.ang), ny = Math.sin(s.ang);
    const tx = -ny, ty = nx;
    for (const side of [-1, 1]) {
      const c = { x: s.p.x + tx * side * (STALL_W / 2), y: s.p.y + ty * side * (STALL_W / 2) };
      const a = { x: c.x - nx * (STALL_D / 2), y: c.y - ny * (STALL_D / 2) };
      const b = { x: c.x + nx * (STALL_D / 2), y: c.y + ny * (STALL_D / 2) };
      white.ribbon([a, b], -0.06, 0.06);
    }
  }

  return { walk: walk.build(), yard: yard.build(), kerb: kerb.build(), rim: rim.build(), pad: pad.build(), road: road.build(), white: white.build(), yellow: yellow.build(), guide: guide.build(), decks: buildDecks(net) };
}

/**
 * The stretches of every road filed by the square of a grid they come near, so that a question about one point
 * only looks at the roads around it. Asked thousands of times for every tree and bush whenever the roads change.
 */
const CELL = 16;
/** how far beyond its edge a stretch is filed: the grid answers for margins up to this */
const FILED = 8;
type Cells = Map<number, { r: Road; i: number }[]>;
const grids = new WeakMap<Road[], Cells>();
const cellKey = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
function cells(roads: Road[]): Cells {
  let g = grids.get(roads);
  if (g) return g;
  g = new Map();
  for (const r of roads) {
    const m = r.hw + FILED + 1;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const i0 = Math.floor((Math.min(a.x, b.x) - m) / CELL), i1 = Math.floor((Math.max(a.x, b.x) + m) / CELL);
      const j0 = Math.floor((Math.min(a.y, b.y) - m) / CELL), j1 = Math.floor((Math.max(a.y, b.y) + m) / CELL);
      for (let ci = i0; ci <= i1; ci++) for (let cj = j0; cj <= j1; cj++) {
        const k = cellKey(ci, cj);
        (g.get(k) ?? g.set(k, []).get(k)!).push({ r, i });
      }
    }
  }
  grids.set(roads, g);
  return g;
}
const NOTHING: { r: Road; i: number }[] = [];
/** The stretches of road that may lie within FILED metres of their edge from a point. */
const filed = (net: Net, x: number, y: number) => cells(net.roads).get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) ?? NOTHING;

/** Is this point clear of roads, lots and buildings? For planting trees. */
export function clearOf(net: Net, x: number, y: number, margin: number) {
  for (const list of [net.pads, net.buildings]) for (const r of list) if (x > r.x0 - margin && x < r.x1 + margin && y > r.y0 - margin && y < r.y1 + margin) return false;
  if (margin <= FILED) {
    for (const { r, i } of filed(net, x, y)) {
      const a = r.pts[i], b = r.pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(a.x + dx * t - x, a.y + dy * t - y) < r.hw + margin + 1) return false;
    }
    return true;
  }
  for (const r of net.roads) {
    const m = r.hw + margin + 1;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(a.x + dx * t - x, a.y + dy * t - y) < m) return false;
    }
  }
  return true;
}

/** Is this rectangle clear of roads, lots and buildings, with `margin` to spare? For standing a house. */
export function rectClear(net: Net, b: { x0: number; y0: number; x1: number; y1: number }, margin: number) {
  for (const r of [...net.pads, ...net.buildings]) if (b.x0 < r.x1 + margin && b.x1 > r.x0 - margin && b.y0 < r.y1 + margin && b.y1 > r.y0 - margin) return false;
  for (const r of net.roads) {
    if (r.bridge) continue;
    const m = r.hw + margin + 1;
    const x0 = b.x0 - m, x1 = b.x1 + m, y0 = b.y0 - m, y1 = b.y1 + m;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const p = r.pts[i], q = r.pts[i + 1];
      if (Math.max(p.x, q.x) < x0 || Math.min(p.x, q.x) > x1 || Math.max(p.y, q.y) < y0 || Math.min(p.y, q.y) > y1) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 3));
      for (let k = 0; k <= n; k++) {
        const x = p.x + ((q.x - p.x) * k) / n, y = p.y + ((q.y - p.y) * k) / n;
        if (x > x0 && x < x1 && y > y0 && y < y1) return false;
      }
    }
  }
  return true;
}

/** Is this point on the tarmac of a road or inside a junction? `skip` is the road it belongs to. For what stands beside a road. */
export function onRoad(net: Net, x: number, y: number, skip?: Road, pad = 0.6) {
  for (const n of net.nodes) if (!n.stub && Math.hypot(n.p.x - x, n.p.y - y) < n.trim + pad) return true;
  if (pad <= FILED) {
    for (const { r, i } of filed(net, x, y)) {
      if (r === skip || r.bridge) continue;
      const a = r.pts[i], b = r.pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(a.x + dx * t - x, a.y + dy * t - y) < r.hw + pad) return true;
    }
    return false;
  }
  for (const r of net.roads) {
    if (r === skip || r.bridge) continue;
    const m = r.hw + pad;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(a.x + dx * t - x, a.y + dy * t - y) < m) return true;
    }
  }
  return false;
}

export { boxed } from './net';
