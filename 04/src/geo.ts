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
  quad(a: V, b: V, c: V, d: V) {
    // wind it to face up
    if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0) { const t = b; b = d; d = t; }
    const i = this.v(a);
    this.v(b); this.v(c); this.v(d);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
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

/** The concrete of a bridge: parapets, soffit and piers. */
function buildDecks(net: Net) {
  const pos: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const r of net.roads) {
    if (!r.bridge) continue;
    const D = dense(r.pts, 4);
    const cum = cumLen(D);
    const w = r.lanes * r.lw + 0.9;
    const L = offset(D, -w), R = offset(D, w);
    const h = cum.map((d) => deck(r, d));
    for (let i = 0; i < D.length - 1; i++) {
      const j = i + 1;
      for (const S of [L, R]) {
        quad([S[i].x, h[i] - 1, S[i].y], [S[j].x, h[j] - 1, S[j].y], [S[j].x, h[j] + 1.1, S[j].y], [S[i].x, h[i] + 1.1, S[i].y]);
      }
      quad([L[i].x, h[i] - 1, L[i].y], [L[j].x, h[j] - 1, L[j].y], [R[j].x, h[j] - 1, R[j].y], [R[i].x, h[i] - 1, R[i].y]);
    }
    for (let d = 14; d < r.len - 10; d += 26) {
      const top = deck(r, d) - 1;
      if (top < 2) continue;
      const c = pointOn(D, cum, d);
      const k = 0.9;
      const x0 = c.x - k, x1 = c.x + k, z0 = c.y - k, z1 = c.y + k;
      quad([x0, 0, z0], [x1, 0, z0], [x1, top, z0], [x0, top, z0]);
      quad([x1, 0, z0], [x1, 0, z1], [x1, top, z1], [x1, top, z0]);
      quad([x1, 0, z1], [x0, 0, z1], [x0, top, z1], [x1, top, z1]);
      quad([x0, 0, z1], [x0, 0, z0], [x0, top, z0], [x0, top, z1]);
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

export function buildGround(net: Net) {
  const kerb = new Flat(0.02), pad = new Flat(0.035), road = new Flat(0.05), white = new Flat(0.07), yellow = new Flat(0.07);
  const SH = 0.45; // shoulder

  for (const r of net.pads) {
    kerb.rect(r.x0 - 0.5, r.y0 - 0.5, r.x1 + 0.5, r.y1 + 0.5);
    pad.rect(r.x0, r.y0, r.x1, r.y1);
  }

  const flats = [kerb, pad, road, white, yellow];
  for (const r of net.roads) {
    const hw = r.lanes * r.lw;
    const target = r.look >= 1 ? road : pad;
    // a bridge is laid along a finer line, so its ribbons can climb
    const pts = r.bridge ? dense(r.pts, 4) : r.pts;
    const base = r.bridge ? dense(r.base, 4) : r.base;
    if (r.bridge) {
      const cum = cumLen(r.pts);
      for (const f of flats) f.hf = (p) => deck(r, along(r, cum, p));
    }
    target.ribbon(pts, -(hw + SH), hw + SH);
    if (r.look >= 1 && !r.bridge) kerb.ribbon(pts, -(hw + SH + 0.5), hw + SH + 0.5);
    if (r.look >= 2) {
      yellow.ribbon(base, -0.28, -0.14);
      yellow.ribbon(base, 0.14, 0.28);
      white.ribbon(base, hw - 0.14, hw);
      white.ribbon(base, -hw, -hw + 0.14);
      for (let i = 1; i < r.lanes; i++) {
        white.dashed(base, i * r.lw, 0.13, 3, 9);
        white.dashed(base, -i * r.lw, 0.13, 3, 9);
      }
    } else if (r.look === 1) yellow.dashed(base, 0, 0.12, 2, 4);
    for (const f of flats) f.hf = null;

    // stop lines where this road gives way or meets the signal
    for (const end of [0, 1]) {
      const node = end ? r.b : r.a;
      if (node.stub) continue;
      const top = Math.max(...node.roads.map((q) => q.rank));
      if (!(node.signal || (r.rank < top && r.look >= 1))) continue;
      const b = r.base;
      const p = end ? b[b.length - 1] : b[0];
      const q = end ? b[b.length - 2] : b[1];
      const L = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      const tx = (p.x - q.x) / L, ty = (p.y - q.y) / L; // towards the junction
      const nx = -ty, ny = tx; // right of travel
      const a0 = { x: p.x + nx * 0.25, y: p.y + ny * 0.25 }, a1 = { x: p.x + nx * hw, y: p.y + ny * hw };
      white.quad(a0, a1, { x: a1.x - tx * 0.5, y: a1.y - ty * 0.5 }, { x: a0.x - tx * 0.5, y: a0.y - ty * 0.5 });
      if (node.signal) {
        // a zebra behind the line
        for (let k = -hw + 0.4; k < hw - 0.5; k += 1.2) {
          const c = { x: p.x + nx * k + tx * 1.2, y: p.y + ny * k + ty * 1.2 };
          white.quad(c, { x: c.x + nx * 0.6, y: c.y + ny * 0.6 }, { x: c.x + nx * 0.6 + tx * 3, y: c.y + ny * 0.6 + ty * 3 }, { x: c.x + tx * 3, y: c.y + ty * 3 });
        }
      }
    }
  }

  // junction aprons
  for (const n of net.nodes) {
    if (n.stub) continue;
    const pts: V[] = [];
    const top = Math.max(...n.roads.map((q) => q.look));
    for (const r of n.roads) {
      const hw = r.lanes * r.lw + SH;
      const b = r.base;
      const p = r.a === n ? b[0] : b[b.length - 1];
      const q = r.a === n ? b[1] : b[b.length - 2];
      const L = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      const nx = -(p.y - q.y) / L, ny = (p.x - q.x) / L;
      pts.push({ x: p.x + nx * hw, y: p.y + ny * hw }, { x: p.x - nx * hw, y: p.y - ny * hw });
    }
    (top >= 1 ? road : pad).poly(hull(pts));
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

  return { kerb: kerb.build(), pad: pad.build(), road: road.build(), white: white.build(), yellow: yellow.build(), decks: buildDecks(net) };
}

/** Is this point clear of roads, lots and buildings? For planting trees. */
export function clearOf(net: Net, x: number, y: number, margin: number) {
  for (const r of [...net.pads, ...net.buildings]) if (x > r.x0 - margin && x < r.x1 + margin && y > r.y0 - margin && y < r.y1 + margin) return false;
  for (const r of net.roads) {
    const m = r.lanes * r.lw + margin + 1;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(a.x + dx * t - x, a.y + dy * t - y) < m) return false;
    }
  }
  return true;
}
