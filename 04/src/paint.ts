// The tools. Each one only changes the strokes; what the roads become is up to the rules in intent.ts.
import { derive, far, length, nearest, type Intent } from './intent';
import { halfWidth, type Rect, type Spec } from './net';
import type { V } from './net';

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

/** The stroke whose road is under a point, or -1. */
export function findStroke(intent: Intent, p: V, houses: Rect[]): number {
  let best = -1, bd = Infinity;
  for (const r of derive(intent, houses)) {
    const d = nearest(r.raw, p).d - halfWidth(r.kind, r.ring);
    if (d < 4 && d < bd) { bd = d; best = r.stroke; }
  }
  return best;
}

/** Lay a stroke down. Null if the rules make nothing of it: too short, or a bridge that does not land. */
export function addStroke(intent: Intent, stroke: V[], bridge: boolean, houses: Rect[] = [], air: [boolean, boolean] = [false, false]): Intent | null {
  const pts = smooth(stroke.map((p) => ({ x: p.x, y: p.y })));
  // whatever starts or ends up on a deck is a bridge itself: a ramp down, or a link across
  const hung = air[0] || air[1];
  bridge ||= hung;
  if (length(pts) < (hung ? 30 : bridge ? 50 : 18)) return null;
  // a stroke that comes back to where it began is a roundabout, as big as it was drawn
  const ring = !bridge && dist(pts[0], pts[pts.length - 1]) < 45 && length(pts) > 170;
  if (ring) pts[pts.length - 1] = { x: pts[0].x, y: pts[0].y };
  const next: Intent = [...intent, { pts, w: 2, paint: true, bridge: bridge || undefined, air: hung ? air : undefined, ring: ring || undefined }];
  // it has to change something: a new road, or a bigger one
  const sig = (sp: Spec) => sp.map((r) => r.kind.rank + ':' + r.raw.length + ':' + r.raw[0].x.toFixed(1) + ':' + r.raw[0].y.toFixed(1)).join();
  const made = derive(next, houses);
  // a bridge that found no way past the houses is no bridge, whatever else its ends stirred up
  if (bridge && !made.some((r) => r.bridge && r.stroke === next.length - 1)) return null;
  return sig(made) === sig(derive(intent, houses)) ? null : next;
}

// ---------- smearing: push the paint that is there ----------

export const SMEAR_R = 65;

/** Give the strokes near p enough points to bend. Parking aisles stay as they are: their stalls need straight rows. */
export function smearStart(intent: Intent, p: V): Intent {
  return intent.map((s) => {
    if (s.lot || nearest(s.pts, p).d > SMEAR_R) return s;
    const pts: V[] = [s.pts[0]];
    for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1], b = s.pts[i];
      const n = Math.max(1, Math.ceil(dist(a, b) / 12));
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
      if (d >= SMEAR_R || far(p) || held(p)) return p;
      const w = (1 - (d / SMEAR_R) ** 2) ** 2;
      moved = true;
      return { x: p.x + dx * w, y: p.y + dy * w };
    });
    return moved ? { ...s, pts } : s;
  });
}
