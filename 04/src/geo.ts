// Flat geometry for the ground plan: asphalt, kerbs, paint. Built from the network.
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { cumLen, deck, offset, pointOn, STALL_D, STALL_W, type Net, type Road, type V } from './net';

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
    for (let i = 0; i < pts.length - 1; i++) this.quad(l[i], l[i + 1], r[i + 1], r[i]);
  }
  dashed(pts: V[], off: number, w: number, on: number, gap: number) {
    const line = offset(pts, off);
    const cum = cumLen(line);
    const len = cum[cum.length - 1];
    for (let s = gap / 2; s + on < len; s += on + gap) {
      const seg = [pointOn(line, cum, s), pointOn(line, cum, s + on)];
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

/** Distance along a road's centreline of the point nearest p. */
function along(r: Road, cum: number[], p: V) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < r.pts.length - 1; i++) {
    const a = r.pts[i], b = r.pts[i + 1];
    const seg = cum[i + 1] - cum[i] || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (seg * seg)));
    const d = Math.hypot(a.x + (b.x - a.x) * t - p.x, a.y + (b.y - a.y) * t - p.y);
    if (d < bd) { bd = d; best = cum[i] + t * seg; }
  }
  return best;
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

/** How far a sidewalk reaches beyond the kerb. */
export const WALK = 3.4;

export function buildGround(net: Net) {
  const walk = new Flat(0.012);
  // what stands on the ground stands on concrete
  for (const b of net.buildings) walk.rect(b.x0 - 4, b.y0 - 4, b.x1 + 4, b.y1 + 4);
  for (const r of net.pads) walk.rect(r.x0 - 3, r.y0 - 3, r.x1 + 3, r.y1 + 3);
  const kerb = new Flat(0.02), pad = new Flat(0.035), road = new Flat(0.05), white = new Flat(0.07), yellow = new Flat(0.07), guide = new Flat(0.06);
  const SH = 0.45; // shoulder

  for (const r of net.pads) {
    kerb.rect(r.x0 - 0.5, r.y0 - 0.5, r.x1 + 0.5, r.y1 + 0.5);
    pad.rect(r.x0, r.y0, r.x1, r.y1);
  }

  const flats = [kerb, pad, road, white, yellow];
  for (const r of net.roads) {
    const hw = r.hw;
    const target = r.rank >= 1 ? road : pad;
    // a bridge is laid along a finer line, so its ribbons can climb
    const pts = r.bridge ? dense(r.pts, 4) : r.pts;
    const base = r.bridge ? dense(r.base, 4) : r.base;
    if (r.bridge) {
      const cum = cumLen(r.pts);
      for (const f of flats) f.hf = (p) => deck(r, along(r, cum, p));
    }
    // what is left of it between its two junctions. On a stub there is no room for paint: lines there are only clutter
    const run = cumLen(r.base).pop()!;
    const lined = run >= 20;
    target.ribbon(pts, -(hw + SH), hw + SH);
    if (r.rank >= 1 && !r.bridge) {
      kerb.ribbon(pts, -(hw + SH + 0.5), hw + SH + 0.5);
      walk.ribbon(pts, -(hw + SH + 0.5 + WALK), hw + SH + 0.5 + WALK);
      // the yellow line of studded tiles that every sidewalk here has, for those who walk by touch
      if (lined) for (const side of [-1, 1]) guide.ribbon(base, side * (hw + SH + 1.8), side * (hw + SH + 2.3));
    }
    if (!lined) {
      // bare
    } else if (r.ring || r.one) {
      white.ribbon(base, hw - 0.14, hw);
      white.ribbon(base, -hw, -hw + 0.14);
      for (let i = 1; i < r.lanes; i++) white.dashed(base, i * r.lw - hw, 0.13, 2, 4);
    } else if (r.rank >= 2) {
      yellow.ribbon(base, -0.28, -0.14);
      yellow.ribbon(base, 0.14, 0.28);
      white.ribbon(base, hw - 0.14, hw);
      white.ribbon(base, -hw, -hw + 0.14);
      for (let i = 1; i < r.lanes; i++) {
        white.dashed(base, i * r.lw, 0.13, 3, 9);
        white.dashed(base, -i * r.lw, 0.13, 3, 9);
      }
    } else if (r.rank === 1) yellow.dashed(base, 0, 0.12, 2, 4);
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
      const top = Math.max(...node.roads.map((q) => q.rank));
      if (!(node.signal || (r.rank < top && r.rank >= 1))) continue;
      const b = r.base;
      const p = end ? b[b.length - 1] : b[0];
      const q = end ? b[b.length - 2] : b[1];
      const L = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      const tx = (p.x - q.x) / L, ty = (p.y - q.y) / L; // towards the junction
      const nx = -ty, ny = tx; // right of travel
      const a0 = { x: p.x + nx * 0.25, y: p.y + ny * 0.25 }, a1 = { x: p.x + nx * hw, y: p.y + ny * hw };
      white.quad(a0, a1, { x: a1.x - tx * 0.5, y: a1.y - ty * 0.5 }, { x: a0.x - tx * 0.5, y: a0.y - ty * 0.5 });
      // which way each lane may go, painted on it before the line
      if (r.rank >= 2 && r.lanes > 1 && run >= 45 && !r.ring) {
        for (let i = 0; i < r.lanes; i++) {
          const turn = i === 0 ? -1 : i === r.lanes - 1 ? 1 : 0;
          // a point given along the lane (u, towards the junction) and across it (v, to the right)
          const at = (u: number, v: number) => ({ x: p.x + nx * ((i + 0.5) * r.lw + v) - tx * (9 - u), y: p.y + ny * ((i + 0.5) * r.lw + v) - ty * (9 - u) });
          const head = (u: number, v: number, du: number, dv: number) => {
            // a triangle pointing along (du, dv)
            const wu = -dv * 0.45, wv = du * 0.45;
            white.tri(at(u + wu, v + wv), at(u - wu, v - wv), at(u + du * 1.5, v + dv * 1.5));
          };
          white.quad(at(-3, -0.09), at(-3, 0.09), at(turn && r.lanes > 2 ? -0.4 : 0.6, 0.09), at(turn && r.lanes > 2 ? -0.4 : 0.6, -0.09));
          // the outer lanes of a wide road only turn; on a narrow one they also go straight on
          if (!turn || r.lanes <= 2) head(0.6, 0, 1, 0);
          if (turn) {
            white.quad(at(-0.5, 0), at(-0.32, 0), at(-0.32, turn * 0.75), at(-0.5, turn * 0.75));
            head(-0.41, turn * 0.7, 0, turn);
          }
        }
      }
      if ((node.signal || r.rank >= 1) && run >= 20) {
        // a zebra behind the line
        for (let k = -hw + 0.4; k < hw - 0.5; k += 1.2) {
          const c = { x: p.x + nx * k + tx * 1.2, y: p.y + ny * k + ty * 1.2 };
          white.quad(c, { x: c.x + nx * 0.6, y: c.y + ny * 0.6 }, { x: c.x + nx * 0.6 + tx * 3, y: c.y + ny * 0.6 + ty * 3 }, { x: c.x + tx * 3, y: c.y + ty * 3 });
        }
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
    const pts: V[] = [], wide: V[] = [];
    const top = Math.max(...n.roads.map((q) => q.rank));
    for (const r of n.roads) {
      const hw = r.hw + SH;
      const b = r.base;
      const p = r.a === n ? b[0] : b[b.length - 1];
      const q = r.a === n ? b[1] : b[b.length - 2];
      const L = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      const nx = -(p.y - q.y) / L, ny = (p.x - q.x) / L;
      pts.push({ x: p.x + nx * hw, y: p.y + ny * hw }, { x: p.x - nx * hw, y: p.y - ny * hw });
      const ww = hw + 0.5 + WALK;
      wide.push({ x: p.x + nx * ww, y: p.y + ny * ww }, { x: p.x - nx * ww, y: p.y - ny * ww });
    }
    // a junction on a bridge is laid at its height
    road.hf = pad.hf = n.z ? () => n.z : null;
    (top >= 1 ? road : pad).poly(hull(pts));
    road.hf = pad.hf = null;
    if (top >= 1 && !n.roads.some((q) => q.bridge)) walk.poly(hull(wide));
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

  return { walk: walk.build(), kerb: kerb.build(), pad: pad.build(), road: road.build(), white: white.build(), yellow: yellow.build(), guide: guide.build(), decks: buildDecks(net) };
}

/** Is this point clear of roads, lots and buildings? For planting trees. */
export function clearOf(net: Net, x: number, y: number, margin: number) {
  for (const list of [net.pads, net.buildings]) for (const r of list) if (x > r.x0 - margin && x < r.x1 + margin && y > r.y0 - margin && y < r.y1 + margin) return false;
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
