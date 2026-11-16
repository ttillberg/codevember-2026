import * as THREE from 'three';
import { foldMatrices, centroid } from './fold';
import type { House } from './net';
import { THICK, type Paper } from './paper';

// Folding by hand. Every hinge has an amount, 0 flat to 1 at its rest fold. Grab a panel
// and it follows the pointer along its own arc; let go and a spring snaps it shut or open.

const STEPS = 72;
const K = 260; // spring stiffness
const C = 2 * Math.sqrt(K) * 0.42; // under damped: a little overshoot, a little bounce
const PEEK = 5; // degrees a foldable panel gives when a pointer comes over it

// held(id): the panel, or something it carries, still hangs in the sheet. It bends a little, no more.
// view: screen ↔ ndc for the canvas (the stage's)
export function makeFolding(
  house: House, paper: Paper, camera: THREE.Camera,
  view: { ndc(cx: number, cy: number): THREE.Vector2; screen(p: THREE.Vector3): THREE.Vector2 },
  onShut: (id: string) => void, held: (id: string) => boolean, onHeld: (id: string) => void,
  onPinned: (id: string, stuck: string) => void = () => {},
) {
  const ids = house.panels.map((p) => p.id);
  const kind = new Map(house.panels.map((p) => [p.id, p.kind]));
  const rest = new Map(house.panels.map((p) => [p.id, p.fold]));
  // the tabs glued behind each panel: they go in as it shuts, out as it opens
  const tucked = new Map<string, string[]>();
  for (const p of house.panels) if (p.glue) tucked.set(p.glue, [...(tucked.get(p.glue) ?? []), p.id]);
  function follow(id: string) {
    const to = target.get(id)!;
    for (const t of tucked.get(id) ?? []) {
      if (target.get(t) === to) continue;
      target.set(t, to);
      v.set(t, to ? 4 : -4); // a tab is quick, ahead of the panel that presses it
    }
  }
  // a peek: degrees on top of the fold, eased, not part of the spring
  const hint = new Map<string, number>();
  let peeking: { id: string; deg: number } | null = null;
  const x = new Map<string, number>();
  const v = new Map<string, number>();
  const target = new Map<string, number>();
  const groups = [...paper.panels.values()];
  const tabShift = new THREE.Matrix4();

  function reset() {
    for (const id of ids) { x.set(id, 0); v.set(id, 0); target.set(id, 0); hint.set(id, 0); }
    drag = null;
    peeking = null;
    apply();
  }

  // bare: the pose without the peeks. Seams are found on it, so a peek can't move what is
  // under the pointer (the panel giving would carry the seam off, let go, come back, give...)
  let bare = false;
  const amount = (id: string) => x.get(id)! + (bare ? 0 : hint.get(id)! / rest.get(id)!);
  const matsAt = (id?: string, t = 0) => foldMatrices(house, (p) => (p.id === id ? t : amount(p.id)));

  function apply() {
    const mats = matsAt();
    for (const id of ids) {
      const g = paper.panels.get(id)!;
      g.matrix.copy(mats.get(id)!);
      // a glued tab sits behind its panel, not in it: sink it a card's thickness as it closes
      if (kind.get(id) === 'tab') g.matrix.multiply(tabShift.makeTranslation(0, 0, -THICK * 1.05 * Math.min(1, Math.max(0, x.get(id)!))));
    }
  }

  // --- the hand ---
  let drag: { id: string; arc: THREE.Vector2[]; t: number; t0: number; vt: number; at: number; held: boolean } | null = null;
  const ray = new THREE.Raycaster();

  const toScreen = (w: THREE.Vector3) => {
    return view.screen(w.clone().project(camera));
  };

  // --- seams: a fold is taken by its fold line, never by a face. Each hinge belongs to the
  // panel beyond it (away from the base); a press near the line folds that panel.
  const hinge = new Map(house.panels.filter((p) => p.hinge).map((p) => [p.id, p.hinge!]));
  const parentOf = new Map(house.panels.map((p) => [p.id, p.parent]));
  const middle = new Map(house.panels.map((p) => [p.id, centroid(p.poly)]));

  // a seam's ends in the world, as things stand now
  function seamEnds(id: string): [THREE.Vector3, THREE.Vector3] {
    const [a, b] = hinge.get(id)!;
    const m = paper.panels.get(id)!.matrixWorld;
    return [new THREE.Vector3(a[0], a[1], 0).applyMatrix4(m), new THREE.Vector3(b[0], b[1], 0).applyMatrix4(m)];
  }

  // is a point on a seam behind something else, from the camera?
  function hidden(w: THREE.Vector3, id: string) {
    const sp = w.clone().project(camera);
    ray.setFromCamera(new THREE.Vector2(sp.x, sp.y), camera);
    const along = w.clone().sub(ray.ray.origin).dot(ray.ray.direction);
    const near = new Set([id, parentOf.get(id)]);
    const things = [...groups, ...(paper.waste.visible ? [paper.waste] : [])];
    for (const h of ray.intersectObjects(things, true)) {
      if (h.distance > along - 1) return false;
      let o: THREE.Object3D | null = h.object;
      while (o && !paper.panels.has(o.name)) o = o.parent;
      if (o && near.has(o.name)) continue;
      return true;
    }
    return false;
  }

  // Pinned: P cannot open if anything that moves with it (P and all it carries) lies where a
  // panel that stays lies (same plane, give or take a card, its middle inside the other's
  // outline) and would move into it as P opens. A tab glued behind its wall is pinned; so is the
  // gable carrying a tab tucked under the roof. The wall over a tab is not: it opens away.
  const polyOf = new Map(house.panels.map((p) => [p.id, p.poly]));
  const kids = new Map<string, string[]>();
  for (const p of house.panels) if (p.parent) kids.set(p.parent, [...(kids.get(p.parent) ?? []), p.id]);
  const carried = (id: string): string[] => [id, ...(kids.get(id) ?? []).flatMap(carried)];
  const Z = new THREE.Vector3(0, 0, 1);
  // what pins it: the part that would push in, and the panel it would push into
  function pinnedBy(id: string): { stuck: string; into: string } | null {
    const xp = x.get(id)!;
    if (xp < 0.5) return null;
    const moving = new Set(carried(id));
    const outer = paper.piece.matrixWorld;
    const now = matsAt();
    const open = matsAt(id, xp - 0.05);
    // what stays and is there: shut panels, and the base
    const staying = ids.filter((o) => !moving.has(o) && (kind.get(o) === 'base' || x.get(o)! > 0.5));
    for (const a of moving) {
      const [mx, my] = middle.get(a)!;
      const mid = new THREE.Vector3(mx, my, 0);
      // where it really is (a tab sits a card's thickness behind its panel), and which way it goes
      const here = paper.panels.get(a)!.localToWorld(mid.clone());
      const step = mid.clone().applyMatrix4(open.get(a)!).applyMatrix4(outer)
        .sub(mid.clone().applyMatrix4(now.get(a)!).applyMatrix4(outer));
      const na = Z.clone().transformDirection(paper.panels.get(a)!.matrixWorld);
      for (const b of staying) {
        const g = paper.panels.get(b)!;
        const nb = Z.clone().transformDirection(g.matrixWorld);
        if (Math.abs(na.dot(nb)) < 0.99) continue;
        const onB = new THREE.Vector3(...polyOf.get(b)![0], 0).applyMatrix4(g.matrixWorld);
        const gap = onB.sub(here).dot(nb);
        if (Math.abs(gap) > 1.5) continue;
        const local = g.worldToLocal(here.clone());
        if (!inside(polyOf.get(b)!, local.x, local.y)) continue;
        // pushing in, not sliding along: a tab drawn out sideways from behind a wall is free
        const towards = step.dot(nb);
        if (Math.sign(towards) === Math.sign(gap) && Math.abs(towards) > 0.3 * step.length()) return { stuck: a, into: b };
      }
    }
    return null;
  }
  const covered = (id: string) => !!pinnedBy(id);

  // the seam nearest a screen point, within reach (px), that can be seen
  // run f on the pose without the peeks (seams, the camera's frame, the mat: none of them may
  // follow a peek, or it feeds back)
  function unpeeked<T>(f: () => T): T {
    const peeked = ids.some((id) => Math.abs(hint.get(id)!) > 1e-3);
    if (peeked) { bare = true; apply(); }
    paper.root.updateMatrixWorld(true);
    try {
      return f();
    } finally {
      if (peeked) { bare = false; apply(); paper.root.updateMatrixWorld(true); }
    }
  }
  const seamAt = (cx: number, cy: number, reach: number) => unpeeked(() => seamOn(cx, cy, reach));
  function seamOn(cx: number, cy: number, reach: number) {
    const p = new THREE.Vector2(cx, cy);
    let best: { id: string; d: number; pinned: boolean } | null = null;
    for (const id of hinge.keys()) {
      const [A, B] = seamEnds(id);
      const sa = toScreen(A);
      const ab = toScreen(B).sub(sa);
      const l2 = ab.lengthSq();
      const s = l2 > 1e-6 ? Math.min(1, Math.max(0, p.clone().sub(sa).dot(ab) / l2)) : 0;
      const d = sa.clone().addScaledVector(ab, s).distanceTo(p);
      if (d >= (best?.d ?? reach)) continue;
      if (hidden(A.clone().lerp(B, s), id)) continue;
      best = { id, d, pinned: false };
    }
    // a pinned seam is still found, and drawn as such: it says what cannot open yet
    if (best) best.pinned = covered(best.id);
    return best;
  }

  // a pointer near a seam that can fold: its panel gives a few degrees. sign: which way is up
  function peek(id: string | null, sign = 1) {
    if (id && (drag || held(id) || covered(id))) id = null;
    peeking = id ? { id, deg: sign * PEEK } : null;
  }

  // take a seam by hand: the panel's middle traced along its arc, shifted to start under the pointer
  function grab(id: string, cx: number, cy: number) {
    peeking = null;
    const [mx, my] = middle.get(id)!;
    const local = new THREE.Vector3(mx, my, 0);
    const outer = paper.piece.matrixWorld;
    const arc: THREE.Vector2[] = [];
    for (let i = 0; i <= STEPS; i++) arc.push(toScreen(local.clone().applyMatrix4(matsAt(id, i / STEPS).get(id)!).applyMatrix4(outer)));
    const shift = new THREE.Vector2(cx, cy).sub(arc[Math.round(x.get(id)! * STEPS)]);
    for (const a of arc) a.add(shift);
    const pin = pinnedBy(id);
    drag = { id, arc, t: x.get(id)!, t0: x.get(id)!, vt: 0, at: performance.now(), held: held(id) || !!pin };
    if (pin) onPinned(id, pin.stuck);
    else if (drag.held) onHeld(id);
    v.set(id, 0);
  }

  // a seam that cannot go: still in the sheet, or pinned. It starts, and springs back
  function nudge(id: string) {
    const pin = pinnedBy(id);
    v.set(id, x.get(id)! > 0.5 ? -1.6 : 1.6);
    if (pin) onPinned(id, pin.stuck);
    else onHeld(id);
  }

  // follow the pointer along the arc, near where it is now so it never jumps branches
  function move(cx: number, cy: number) {
    if (!drag) return;
    const p = new THREE.Vector2(cx, cy);
    const i0 = Math.round(drag.t * STEPS);
    const win = Math.round(STEPS * 0.3);
    let best = drag.t;
    let bd = Infinity;
    for (let i = Math.max(0, i0 - win); i < Math.min(STEPS, i0 + win); i++) {
      const a = drag.arc[i];
      const b = drag.arc[i + 1];
      const ab = b.clone().sub(a);
      const l2 = ab.lengthSq();
      const s = l2 > 1e-6 ? Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / l2)) : 0;
      const d = a.clone().addScaledVector(ab, s).distanceToSquared(p);
      if (d < bd) { bd = d; best = (i + s) / STEPS; }
    }
    // still in the sheet: it gives a few degrees, stiffer the further it is pulled
    if (drag.held) {
      const d = best - drag.t0;
      best = drag.t0 + Math.sign(d) * 0.06 * (1 - Math.exp(-Math.abs(d) / 0.06));
    }
    const now = performance.now();
    const dt = Math.max(8, now - drag.at) / 1000;
    drag.vt = drag.vt * 0.6 + ((best - drag.t) / dt) * 0.4;
    drag.at = now;
    cross(drag.id, drag.t, best);
    drag.t = best;
    x.set(drag.id, best);
  }

  // let go: shut if it is more than half way, or flung that way
  function release() {
    if (!drag) return;
    const { id, t, vt } = drag;
    target.set(id, drag.held ? (drag.t0 > 0.5 ? 1 : 0) : t + vt * 0.15 > 0.5 ? 1 : 0);
    v.set(id, vt);
    follow(id);
    drag = null;
  }

  // reaching the fold: a crease
  // once per shut: the tap back off the stop doesn't crease it again
  const creased = new Set<string>();
  function cross(id: string, from: number, to: number) {
    if (to < 0.6) creased.delete(id);
    if (from < 0.985 && to >= 0.985 && !creased.has(id)) { creased.add(id); onShut(id); }
  }

  function update(dt: number) {
    dt = Math.min(dt, 1 / 30);
    const k = 1 - Math.exp(-dt * 18);
    for (const id of ids) {
      const want = peeking?.id === id ? peeking.deg : 0;
      hint.set(id, hint.get(id)! + (want - hint.get(id)!) * k);
    }
    for (const id of ids) {
      if (drag?.id === id) continue;
      let xi = x.get(id)!;
      let vi = v.get(id)!;
      const ti = target.get(id)!;
      if (Math.abs(ti - xi) < 1e-4 && Math.abs(vi) < 1e-3) { x.set(id, ti); v.set(id, 0); continue; }
      vi += (K * (ti - xi) - C * vi) * dt;
      const before = xi;
      xi += vi * dt;
      // the mat stops a panel going flat any further, and what it shuts against stops it going
      // past shut: it lands and taps back, never through
      if (xi < 0) { xi = 0; vi = -vi * 0.25; }
      if (xi > 1) { xi = 1; vi = -vi * 0.25; }
      cross(id, before, xi);
      x.set(id, xi);
      v.set(id, vi);
    }
    apply();
  }

  function shut(id: string) { target.set(id, 1); follow(id); }
  // history: where every hinge is headed, and going back there (the springs carry it)
  const targets = () => Object.fromEntries(ids.map((id) => [id, target.get(id)!]));
  // straight there, no spring: for picking up where a reload left off
  function jump(t: Record<string, number>) {
    for (const id of ids) { const to = t[id] ?? 0; target.set(id, to); x.set(id, to); v.set(id, 0); hint.set(id, 0); }
    drag = null;
    peeking = null;
    apply();
  }
  function restore(t: Record<string, number>) {
    drag = null;
    peeking = null;
    for (const id of ids) target.set(id, t[id] ?? 0);
  }
  // a click: shut if open, open if shut, with a kick so the spring sings
  function toggle(id: string) {
    const to = x.get(id)! > 0.5 ? 0 : 1;
    target.set(id, to);
    v.set(id, to ? 2.5 : -2.5);
    peeking = null;
    follow(id);
  }
  const allShut = () => ids.every((id) => kind.get(id) === 'base' || (target.get(id) === 1 && x.get(id)! > 0.97 && drag?.id !== id));

  reset();
  const folded = () => ids.some((id) => x.get(id)! > 0.01);
  return { reset, jump, seamAt, unpeeked, seamEnds, covered, pinnedBy, nudge, peek, toggle, targets, restore, grab, move, release, update, shut, allShut, folded, amount: (id: string) => x.get(id)!, get dragging() { return !!drag; } };
}

function inside(poly: [number, number][], px: number, py: number) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]) < -1e-3) return false;
  }
  return true;
}
