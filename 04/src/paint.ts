// The tools. Each one only changes the strokes; what the roads become is up to the rules in intent.ts.
import { arc, derive, NO_HOUSES, plan, RINGS, far, length, nearest, type Intent, type Stroke } from './intent';
import { cumLen, pointOn, type Rect, type Spec, type V } from './net';

const dist = (a: V, b: V) => Math.hypot(b.x - a.x, b.y - a.y);

function simplify(pts: V[], eps: number): V[] {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  const L = dist(a, b) || 1;
  let worst = 0, wi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i].x - a.x) * (b.y - a.y) - (pts[i].y - a.y) * (b.x - a.x)) / L;
    if (d > worst) { worst = d; wi = i; }
  }
  if (worst < eps) return [a, b];
  return [...simplify(pts.slice(0, wi + 1), eps).slice(0, -1), ...simplify(pts.slice(wi), eps)];
}

/** A hand is not steady and a road cannot kink: even out the stroke, ends held. */
function smooth(pts: V[]): V[] {
  let l = 0;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push((l += dist(pts[i - 1], pts[i])));
  const n = Math.max(2, Math.round(l / 8));
  let out: V[] = [];
  for (let k = 0, i = 0; k <= n; k++) {
    const s = (l * k) / n;
    while (i < pts.length - 2 && cum[i + 1] < s) i++;
    const t = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
    out.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t });
  }
  for (let it = 0; it < 6; it++) {
    out = out.map((p, i) => (i === 0 || i === n ? p : { x: (out[i - 1].x + 2 * p.x + out[i + 1].x) / 4, y: (out[i - 1].y + 2 * p.y + out[i + 1].y) / 4 }));
  }
  return simplify(out, 0.4);
}

/** The piece of a line between two distances along it. */
function piece(pts: V[], cum: number[], d0: number, d1: number): V[] {
  const at = (d: number) => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < d) i++;
    const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
  };
  return [at(d0), ...pts.filter((_, i) => cum[i] > d0 + 1 && cum[i] < d1 - 1), at(d1)];
}

/**
 * A road drawn across a big road, across two roads or more, or across a bridge does not cut through them:
 * it goes over. Where it only begins or ends on a road it joins it, as before.
 * Returns the stretch that has to be up in the air, as distances along the stroke.
 */
function goesOver(intent: Intent, pts: V[], cum: number[], houses: Rect[]): [number, number] | null {
  const END = 25, len = cum[cum.length - 1];
  const must: number[] = [], may: number[] = [];
  const over = new Set<number>();
  for (const r of derive(intent, houses)) {
    // parking aisles and yard lanes are not worth a bridge
    if (r.kind.rank < 2 && !r.bridge) continue;
    for (let m = 1; m < pts.length; m++) {
      for (let n = 1; n < r.raw.length; n++) {
        const a = pts[m - 1], b = pts[m], c = r.raw[n - 1], e = r.raw[n];
        const den = (b.x - a.x) * (e.y - c.y) - (b.y - a.y) * (e.x - c.x);
        if (Math.abs(den) < 1e-9) continue;
        const u = ((c.x - a.x) * (e.y - c.y) - (c.y - a.y) * (e.x - c.x)) / den, v = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const d = cum[m - 1] + u * (cum[m] - cum[m - 1]);
        if (d < END || d > len - END) continue;
        if (r.bridge || r.kind.rank >= 3) must.push(d);
        else { may.push(d); over.add(r.stroke); }
      }
    }
  }
  const ds = over.size >= 2 ? [...must, ...may] : must;
  if (!ds.length) return null;
  // room for the ramps either side; a stub of road too short to be one is bridge as well
  const RAMP = 70;
  let d0 = Math.min(...ds) - RAMP, d1 = Math.max(...ds) + RAMP;
  if (d0 < 22) d0 = 0;
  if (d1 > len - 22) d1 = len;
  return [d0, d1];
}

/** Does a stroke come right back to where it began, and is it big enough to be meant as a roundabout? */
const closes = (pts: V[], len: number) => RINGS && dist(pts[0], pts[pts.length - 1]) < 22 && len > 220;

/** Lay a stroke down. Null if the rules make nothing of it: too short, or a bridge that does not land. */
export function addStroke(intent: Intent, stroke: V[], bridge: boolean, houses: Rect[] = NO_HOUSES, air: [boolean, boolean] = [false, false]): Intent | null {
  if (!bridge && !air[0] && !air[1]) {
    const pts = smooth(stroke.map((p) => ({ x: p.x, y: p.y })));
    const cum = cumLen(pts);
    const len = cum[cum.length - 1];
    const ring = closes(pts, len);
    const up = ring ? null : goesOver(intent, pts, cum, houses);
    if (up) {
      // the road comes up to the bridge on the ground at either end, and the bridge stands on those two
      const next: Intent = [...intent];
      if (up[0] > 0) next.push({ pts: piece(pts, cum, 0, up[0]), w: 2, paint: true });
      if (up[1] < len) next.push({ pts: piece(pts, cum, up[1], len), w: 2, paint: true });
      next.push({ pts: piece(pts, cum, up[0], up[1]), w: 2, paint: true, bridge: true });
      const done = derive(next, houses).some((r) => r.bridge && r.stroke === next.length - 1) ? next : null;
      // if no span gets past the houses it is a road on the ground after all
      if (done) return done;
    }
  }
  return lay(intent, stroke, bridge, houses, air);
}

/**
 * A bridge that comes down on the side of a road does not ram into it. It stops short, up in the air, and two ramps
 * leave it there, one way each: the one on the right goes down and joins the road the way it runs, the other comes
 * up from it. Returns the strokes to lay instead of the one bridge, or null where an end has no road to fork onto.
 */
function forked(intent: Intent, pts: V[], air: [boolean, boolean], houses: Rect[]): Stroke[] | null {
  const BACK = 32, OUT = 30;
  let a = pts[0], b = pts[pts.length - 1];
  const open: [boolean, boolean] = [false, false];
  const ramps: Stroke[] = [];
  const ends = derive(intent, houses).filter((r) => !r.bridge).flatMap((r) => [r.raw[0], r.raw[r.raw.length - 1]]);
  for (const e of [0, 1]) {
    if (air[e]) continue;
    const p = e ? b : a, o = e ? a : b;
    let best: { t: Stroke; n: ReturnType<typeof nearest> } | null = null, bd = 18;
    for (const t of intent) {
      if (t.bridge || t.lot || t.ring) continue;
      const n = nearest(t.pts, p);
      if (n.d < bd) { bd = n.d; best = { t, n }; }
    }
    if (!best) continue;
    const { t, n } = best, cum = cumLen(t.pts), tl = cum[cum.length - 1];
    // where the road ends the bridge just carries it on
    if (n.s < OUT + 12 || n.s > tl - OUT - 12) continue;
    const q0 = t.pts[n.seg], q1 = t.pts[n.seg + 1], ql = dist(q0, q1) || 1;
    let tx = (q1.x - q0.x) / ql, ty = (q1.y - q0.y) / ql;
    const dl = dist(o, n.q) || 1, dx = (n.q.x - o.x) / dl, dy = (n.q.y - o.y) / dl;
    // one that comes in along the road already joins it well enough
    if (Math.abs(dx * tx + dy * ty) > 0.75) continue;
    // traffic keeps right: the way down is on the right of the bridge as it arrives
    if (-dy * tx + dx * ty < 0) { tx = -tx; ty = -ty; }
    const f = { x: n.q.x - dx * BACK, y: n.q.y - dy * BACK };
    const along = (d: number) => pointOn(t.pts, cum, d);
    const fwd = (q1.x - q0.x) * tx + (q1.y - q0.y) * ty > 0 ? 1 : -1;
    const down = along(n.s + fwd * OUT), up = along(n.s - fwd * OUT);
    // each bows towards the corner it cuts
    const side = (u: V, v: V) => (-(v.y - u.y) * (n.q.x - u.x) + (v.x - u.x) * (n.q.y - u.y) > 0 ? 1 : -1);
    const mk = (u: V, v: V, hang: [boolean, boolean]): Stroke => ({ pts: arc(u, v, 0.1 * side(u, v)), w: 1, paint: true, bridge: true, one: true, air: hang });
    // a ramp needs a clear stretch of road to join: next to a junction it would only make a knot of it
    if (ends.some((q) => dist(q, down) < 28 || dist(q, up) < 28)) continue;
    ramps.push(mk(f, down, [true, false]), mk(up, f, [false, true]));
    open[e] = true;
    if (e) b = f; else a = f;
  }
  if (!ramps.length || dist(a, b) < 50) return null;
  const main = pts.filter((q) => dist(q, pts[0]) > (open[0] ? BACK : -1) && dist(q, pts[pts.length - 1]) > (open[1] ? BACK : -1));
  return [{ pts: [a, ...main.slice(1, -1), b], w: 2, paint: true, bridge: true, air: air[0] || air[1] ? air : undefined, open }, ...ramps];
}

function lay(intent: Intent, stroke: V[], bridge: boolean, houses: Rect[] = NO_HOUSES, air: [boolean, boolean] = [false, false]): Intent | null {
  const pts = smooth(stroke.map((p) => ({ x: p.x, y: p.y })));
  // whatever starts or ends up on a deck is a bridge itself: a ramp down, or a link across
  const hung = air[0] || air[1];
  bridge ||= hung;
  if (length(pts) < (hung ? 30 : bridge ? 50 : 18)) return null;
  // a stroke that comes right back to where it began, and is big enough, is a roundabout: it has to be meant
  const ring = !bridge && closes(pts, length(pts));
  if (ring) pts[pts.length - 1] = { x: pts[0].x, y: pts[0].y };
  if (bridge) {
    const fork = forked(intent, pts, air, houses);
    if (fork) {
      const next: Intent = [...intent, ...fork];
      const made = derive(next, houses);
      // every piece has to stand, or it is the plain bridge after all
      if (fork.every((_, i) => made.some((r) => r.bridge && r.stroke === intent.length + i))) return next;
    }
    // a bridge does not come down into a junction: it lands on a stretch of plain road of its own, and that goes to the junction
    const FOOT = 34;
    const cum = cumLen(pts);
    const len = cum[cum.length - 1], d0 = air[0] ? 0 : FOOT, d1 = air[1] ? len : len - FOOT;
    if (d1 - d0 >= 50) {
      const next: Intent = [...intent];
      if (d0 > 0) next.push({ pts: piece(pts, cum, 0, d0), w: 2, paint: true });
      if (d1 < len) next.push({ pts: piece(pts, cum, d1, len), w: 2, paint: true });
      next.push({ pts: piece(pts, cum, d0, d1), w: 2, paint: true, bridge: true, air: hung ? air : undefined });
      if (derive(next, houses).some((r) => r.bridge && r.stroke === next.length - 1)) return next;
    }
  }
  const next: Intent = [...intent, { pts, w: 2, paint: true, bridge: bridge || undefined, air: hung ? air : undefined, ring: ring || undefined }];
  // it has to change something: a new road, or a bigger one
  const sig = (sp: Spec) => sp.map((r) => r.kind.rank + ':' + r.raw.length + ':' + r.raw[0].x.toFixed(1) + ':' + r.raw[0].y.toFixed(1)).join();
  const made = derive(next, houses);
  // a bridge that found no way past the houses is no bridge, whatever else its ends stirred up
  if (bridge && !made.some((r) => r.bridge && r.stroke === next.length - 1)) return null;
  return sig(made) === sig(derive(intent, houses)) ? null : next;
}

// ---------- smearing: push the paint that is there ----------

/**
 * The smear as it is set: how far it reaches in metres, and how its pull falls off from the grab to the edge of that
 * reach: the power the curve is raised to, 1 a broad dome, 2 a soft bell, 4 a sharp peak. Set through `smearSet` in wet.ts,
 * which keeps the shaders with it.
 */
export const SMEAR = { r: 82, fall: 2 };
/** How much of the pull is left this far from the grab. */
export const smearFall = (d: number) => (d >= SMEAR.r ? 0 : (1 - (d / SMEAR.r) ** 2) ** SMEAR.fall);

/** Give the strokes near p enough points to bend. Parking aisles stay as they are: their stalls need straight rows. */
export function smearStart(intent: Intent, p: V): Intent {
  return intent.map((s) => {
    if (s.lot || nearest(s.pts, p).d > SMEAR.r) return s;
    // a point every few metres, more of them the smaller the smear: it bends as finely as it is narrow
    const every = Math.max(5, Math.min(9, SMEAR.r / 8));
    const pts: V[] = [s.pts[0]];
    for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1], b = s.pts[i];
      const n = Math.max(1, Math.ceil(dist(a, b) / every));
      for (let k = 1; k <= n; k++) pts.push(k === n ? b : { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    return { ...s, pts };
  });
}

/** Drag everything within reach of `from` towards `to`, less the further away it is. Where strokes meet moves with them. */
export function smear(base: Intent, from: V, to: V): Intent {
  const dx = to.x - from.x, dy = to.y - from.y;
  // what must not move: the lots, and the far ends where traffic comes in
  // a road stays put where a lot hangs on to it, or the lot would be left behind
  const anchors: V[] = [];
  for (const s of base) if (s.lot) anchors.push(s.pts[0], s.pts[s.pts.length - 1]);
  const held = (p: V) => anchors.some((a) => dist(a, p) < 14);
  return base.map((s) => {
    if (s.lot) return s;
    let moved = false;
    const pts = s.pts.map((p) => {
      const d = dist(p, from);
      if (d >= SMEAR.r || far(p) || held(p)) return p;
      const w = smearFall(d);
      moved = true;
      return { x: p.x + dx * w, y: p.y + dy * w };
    });
    return moved ? { ...s, pts } : s;
  });
}

// ---------- tidying: a smear that made a mess of the paint is laid again as the roads it became ----------

/** A stroke the rules treat as plain road: not a lot, a bridge, a ramp or a roundabout. */
const plain = (s: Stroke) => !s.lot && !s.bridge && !s.ring && !s.one && !s.air && !s.open;

const crosses = (a: V, b: V, c: V, d: V) => {
  const o = (p: V, q: V, r: V) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
};

/**
 * Did the smear leave any of the strokes it moved in a knot: crossing itself, folded back along itself, or lying
 * on another for a stretch? A stroke that was only bent is not one.
 */
export function tangled(intent: Intent, moved: number[]): boolean {
  const LIE = 14, RUN = 45;
  for (const i of moved) {
    const s = intent[i];
    if (!plain(s) || s.pts.length < 2) continue;
    const cum = cumLen(s.pts), n = s.pts.length;
    for (let a = 1; a < n; a++) {
      for (let b = a + 2; b < n; b++) {
        // the last piece of a closed stroke meets the first, and that is no knot
        if (crosses(s.pts[a - 1], s.pts[a], s.pts[b - 1], s.pts[b]) && !(a === 1 && b === n - 1 && dist(s.pts[0], s.pts[n - 1]) < 1)) return true;
        if (cum[b] - cum[a] > 80 && dist(s.pts[a], s.pts[b]) < LIE && !(cum[a] < 20 && cum[n - 1] - cum[b] < 20)) return true;
      }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of s.pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    for (let j = 0; j < intent.length; j++) {
      const t = intent[j];
      if (j === i || !plain(t) || t.pts.every((p) => p.x < x0 - LIE || p.x > x1 + LIE) || t.pts.every((p) => p.y < y0 - LIE || p.y > y1 + LIE)) continue;
      let run = 0;
      for (let a = 0; a < n; a++) {
        if (nearest(t.pts, s.pts[a]).d < LIE) { if (a) run += cum[a] - cum[a - 1]; if (run > RUN) return true; }
        else run = 0;
      }
    }
  }
  return false;
}

/**
 * Lay the strokes a smear moved again, as the roads the rules made of them: one stroke from junction to junction,
 * evened out, where there was a knot. What lay on itself is one road, what was too short to be a road is gone.
 * Everything the smear did not touch is left as it was painted.
 */
export function tidy(intent: Intent, moved: number[], houses: Rect[] = NO_HOUSES): Intent {
  const mine = new Set(moved.filter((i) => plain(intent[i])));
  if (!mine.size) return intent;
  const out = intent.filter((_, i) => !mine.has(i));
  for (const r of plan(intent, houses)) {
    const by = r.by ?? [r.stroke];
    const ins = by.filter((i) => mine.has(i));
    if (!ins.length || r.bridge || r.ring || r.stalls.some(Boolean) || r.raw.length < 2) continue;
    // as big as it came out: the strokes that still lie along it each add a size of their own
    const w = Math.max(0, Math.min(3, r.kind.rank - (by.length - ins.length)));
    out.push({ pts: smooth(r.raw), w, ...(ins.some((i) => intent[i].paint) ? { paint: true } : {}) });
  }
  return out;
}

// ---------- erasing: one size off what the drag passes over ----------

/**
 * One drag takes one size off the road it passes over, along the stretch it passes: an arterial becomes a street,
 * a street a driveway, and a driveway goes. Each stroke is cut where the drag starts and stops over it, so only that
 * stretch changes. Bridges go whole on the first drag; a roundabout goes a size whole. Parking lots stay.
 * Each sample is tested once per drag, so a drag that doubles back still takes one size. Same array if nothing is hit.
 */
export function erase(intent: Intent, drag: V[], reach: number): Intent {
  return resize(intent, drag, reach, (w) => w - 1, false);
}

/**
 * Give the roads a drag passes over another size, along the stretch it passes: `to` says which, from the size they are.
 * With `keep` nothing goes: the size stays between a driveway and an arterial, and a bridge or a roundabout changes
 * size whole. Without it this is the eraser. `only`: the strokes it may touch. Same array if nothing changes.
 */
export function resize(intent: Intent, drag: V[], reach: number, to: (w: number) => number, keep: boolean, only?: Set<number>): Intent {
  if (drag.length < 2) return intent;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of drag) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  let changed = false;
  const out: Intent = [];
  for (let n = 0; n < intent.length; n++) {
    const s = intent[n];
    // only these strokes, if any are named: a road is resized, not what crosses it
    if (only && !only.has(n)) { out.push(s); continue; }
    // a lot stays, and so does anything well away from the drag
    let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
    for (const p of s.pts) { sx0 = Math.min(sx0, p.x); sy0 = Math.min(sy0, p.y); sx1 = Math.max(sx1, p.x); sy1 = Math.max(sy1, p.y); }
    if (s.lot || sx0 > x1 + reach || sx1 < x0 - reach || sy0 > y1 + reach || sy1 < y0 - reach) { out.push(s); continue; }
    const cum = cumLen(s.pts);
    const len = cum[cum.length - 1];
    // a sample every two units along the stroke, and whether the drag is within reach of it
    const N = Math.max(1, Math.ceil(len / 2));
    const on = Array.from({ length: N + 1 }, (_, k) => nearest(drag, pointOn(s.pts, cum, (len * k) / N)).d < reach);
    if (!on.some(Boolean)) { out.push(s); continue; }
    const w = keep ? Math.max(1, Math.min(3, to(s.w))) : to(s.w);
    // that size already
    if (w === s.w) { out.push(s); continue; }
    changed = true;
    // a bridge is taken whole, and a ring is one road: it cannot be cut
    if (s.bridge) { if (keep) out.push({ ...s, w }); continue; }
    if (s.ring) {
      if (w >= 1) out.push({ ...s, w });
      continue;
    }
    // the stretches the drag passes over, and the ones it does not
    let k0 = 0;
    for (let k = 1; k <= N; k++) {
      if (k < N && on[k] === on[k0]) continue;
      const a = (len * k0) / N, b = (len * k) / N;
      if (on[k0]) {
        // one size off this stretch; a driveway is taken altogether
        if (w >= 1 && b - a > 1) out.push({ ...s, pts: piece(s.pts, cum, a, b), w });
      } else if (b - a > 1) out.push({ ...s, pts: piece(s.pts, cum, a, b) });
      k0 = k;
    }
  }
  return changed ? out : intent;
}
