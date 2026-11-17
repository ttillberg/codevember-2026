import * as THREE from 'three';
import { overlaps, outline, sheetOf, type V2 } from './net';
import { foldOrder, type Model } from './models';
import { checkGlue } from './fold';
import { makePaper, printTexture, THICK } from './paper';
import { makeBorders, borderAt, bearing, tint, distance, type Border } from './cut';
import { makeFolding } from './folding';
import type { Rig } from './rig';
import { useHud } from './hud';
import * as sound from './sound';

// The card and the hands on it: popping it out, folding it up, turning it over, undoing.
// Not React: the scene mounts `world`, calls `animate` each frame, and on a hot update saves
// what it is (`save`), makes a fresh one and puts it back (`load`).

export interface Saved {
  model: string;
  byHand?: boolean;
  done: boolean[];
  folds: Record<string, number>;
  rest: number[];
  view: { zoom: number; panX: number; panY: number; azimuth: number };
  undos: SavedSnap[];
  redos: SavedSnap[];
}
interface SavedSnap { done: boolean[]; folds: Record<string, number>; rest: number[] }

export function createGame(model: Model, camera: THREE.OrthographicCamera, canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer, rig: Rig) {
  const house = model.net;
  if (import.meta.env.DEV) {
    const o = overlaps(house);
    const g = checkGlue(house);
    if (o.length) console.warn('net overlaps', o);
    if (g.length) console.warn('glue problems', g);
  }
  const sheet = sheetOf(house);
  const loop = outline(house);
  const world = new THREE.Group();
  const tex = printTexture(house, model.art, sheet, renderer);
  const back = printTexture(house, model.art, sheet, renderer, true, model.backArt);
  const paper = makePaper(house, sheet, loop, tex, back);
  world.add(paper.root);
  const hud = useHud.setState;

  // what each panel carries when it folds: itself and everything hinged on beyond it
  const children = new Map<string, string[]>();
  for (const p of house.panels) if (p.parent) children.set(p.parent, [...(children.get(p.parent) ?? []), p.id]);
  const carried = (id: string): string[] => [id, ...(children.get(id) ?? []).flatMap(carried)];

  let borders: Border[] = [];
  let near = new Map<Border, Border[]>();
  let membranes = new THREE.Group();
  // a panel still hangs in the sheet while a border of it, or of anything it carries, holds
  const held = (id: string) => {
    const ids = new Set(carried(id));
    return borders.some((b) => !b.done && ids.has(b.panel));
  };
  let heldIds = new Set<string>();
  let heldAt = -1e9;
  let stuckSeam: { id: string; at: number } | null = null;

  const folding = makeFolding(
    house, paper, camera, rig,
    () => sound.crease(),
    held,
    (id) => { heldIds = new Set(carried(id)); heldAt = performance.now(); sound.strain(); },
    // pinned: the part that would push through flashes, its seam drawn red a moment
    (_id, stuck) => { stuckSeam = { id: stuck, at: performance.now() }; sound.strain(); },
  );

  // --- state ---
  const LIFT = 1.3; // mm the piece stands proud of the sheet once every border is through
  let lift = 0;
  let poppedAt = -1e9;
  let freed = false; // the frame has let go
  let freedAt = 0;
  let byHand = false; // turned by hand since it came free: then it is left the way it is
  let built = false;
  // turning the whole thing over or round: about an axis through the middle of what is there
  let turning: { at: number; pivot: THREE.Vector3; axis: THREE.Vector3; angle: number; height: number; dur: number } | null = null;
  let afterTurn: (() => void) | null = null; // what to do once a turn lands
  let ground = 0; // how far the root is raised to stand on the mat
  const framed = new THREE.Box3();

  const px = () => rig.mmPerPx;
  // which way the print faces: the sheet's +z, in the world
  const printUp = () => paper.root.matrix.elements[9] > 0;

  // --- history: every step that changes the card, as it was before. A whole gesture is one step.
  interface Snap { done: boolean[]; folds: Record<string, number>; rest: THREE.Matrix4 }
  let undos: Snap[] = [];
  let redos: Snap[] = [];
  let gestureSaved = false;
  let timers: number[] = [];
  let restTween: { from: THREE.Matrix4; to: THREE.Matrix4; at: number } | null = null;
  // the view going round the card a quarter, from a drag on the bare mat
  let spin: { from: number; to: number; at: number } | null = null;
  const snap = (): Snap => ({ done: borders.map((b) => b.done), folds: folding.targets(), rest: paper.getRest() });
  function save() {
    if (gestureSaved) return;
    undos.push(snap());
    if (undos.length > 200) undos.shift();
    redos = [];
    if (press) gestureSaved = true;
    showHistory();
  }
  function restore(s: Snap) {
    timers.forEach(clearTimeout);
    timers = [];
    turning = null;
    afterTurn = null;
    setBorders(s.done);
    poppedAt = performance.now();
    if (s.done.every(Boolean) && !freed) free();
    // going back through history is a hand on it: it stays the way it is put
    byHand = true;
    folding.restore(s.folds);
    restTween = { from: paper.getRest(), to: s.rest.clone(), at: performance.now() };
    built = false;
    sound.unlock();
    sound.crease();
    say();
    showHistory();
  }
  // borders as given, the lift and the frame to match (the frame back at once if any holds)
  function setBorders(done: boolean[]) {
    borders.forEach((b, i) => {
      b.done = done[i];
      b.mesh.visible = !b.done;
      b.pressure = b.done ? 1 : 0;
    });
    const n = done.filter(Boolean).length;
    lift = n ? LIFT * (0.25 + 0.75 * (n / borders.length)) : 0;
    if (n < borders.length && freed) {
      freed = false;
      paper.waste.visible = true;
      paper.waste.matrix.identity();
    }
  }
  function undo() {
    const s = undos.pop();
    if (!s) return;
    redos.push(snap());
    restore(s);
  }
  function redo() {
    const s = redos.pop();
    if (!s) return;
    undos.push(snap());
    restore(s);
  }
  function showHistory() {
    hud({ canUndo: undos.length > 0, canRedo: redos.length > 0 });
  }

  function reset() {
    byHand = false;
    rig.unzoom();
    undos = [];
    redos = [];
    timers.forEach(clearTimeout);
    timers = [];
    afterTurn = null;
    restTween = null;
    paper.root.remove(membranes);
    const made = makeBorders(house);
    borders = made.borders;
    membranes = made.group;
    near = neighbours(borders);
    paper.root.add(membranes);
    lift = 0;
    poppedAt = -1e9;
    freed = false;
    built = false;
    turning = null;
    ground = 0;
    paper.resetRest();
    paper.waste.visible = true;
    paper.waste.matrixAutoUpdate = false;
    paper.waste.matrix.identity();
    paper.piece.matrixAutoUpdate = false;
    paper.piece.matrix.identity();
    folding.reset();
    framed.makeEmpty();
    showHistory();
    say();
  }

  let said = '';
  let ready = false;
  function say() {
    const n = borders.filter((b) => b.done).length;
    let t;
    if (built) t = printUp() ? 'Built, upside down. Flip it' : 'Built. Put it on the board';
    else if (!n) t = 'Press along the borders to pop them';
    else if (!freed) t = `${n} / ${borders.length} popped. Tap a fold line to fold what is free`;
    else t = 'Tap a fold line to fold. Drag a face to tip it over';
    // every frame: cheap when nothing changed
    if (t !== said) hud({ hint: (said = t) });
    // built and standing: it can go on the board
    const ok = built && !printUp();
    if (ok !== ready) hud({ ready: (ready = ok) });
  }

  // A pop takes the borders either side of it along with it, a quick run of snaps; and once
  // only a few are left (two, or 15% of a big sheet), they go too. All one step for undo.
  function pop(b: Border) {
    if (b.done) return;
    save();
    const go = [b, ...(near.get(b) ?? []).filter((x) => !x.done)];
    for (const x of go) { x.done = true; x.pressure = 1; }
    const left = borders.filter((x) => !x.done);
    if (left.length <= Math.max(2, Math.round(borders.length * 0.15))) for (const x of left) { x.done = true; x.pressure = 1; go.push(x); }
    b.mesh.visible = false;
    go.slice(1).forEach((x, i) => timers.push(window.setTimeout(() => {
      // undone meanwhile: leave it be
      if (!x.done) return;
      x.mesh.visible = false;
      sound.snap(0.4 + 0.5 * Math.random());
    }, 70 * (i + 1))));
    const n = borders.filter((x) => x.done).length;
    lift = LIFT * (0.25 + 0.75 * (n / borders.length));
    poppedAt = performance.now();
    if (n === borders.length) free();
    else sound.snap(n / borders.length);
    say();
  }

  // borders that meet end to end
  function neighbours(list: Border[]) {
    const ends = (b: Border) => b.runs.flatMap((r) => [r.a, [r.a[0] + r.dx * r.len, r.a[1] + r.dy * r.len] as V2]);
    const m = new Map<Border, Border[]>();
    for (const b of list) {
      const eb = ends(b);
      m.set(b, list.filter((o) => o !== b && ends(o).some((p) => eb.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05))));
    }
    return m;
  }

  // the last one: the frame lets go, lifts and slides off; then the piece turns over by itself
  // so it lies base down, everything to fold standing up from there (see animate). Until it is
  // turned by hand: after that it turns when it is turned.
  function free() {
    freed = true;
    freedAt = performance.now();
    byHand = false;
    sound.pop();
  }

  function turn(axis: THREE.Vector3, angle: number) {
    if (turning) return;
    save();
    restTween = null;
    const box = panelsBox();
    const big = Math.abs(angle) > 2;
    turning = {
      at: performance.now(), pivot: box.getCenter(new THREE.Vector3()), axis, angle,
      height: big ? Math.max(45, box.max.y - box.min.y + 20) : 12, dur: big ? 0.95 : 0.55,
    };
    sound.unlock();
    sound.flip();
  }
  const flip = () => turn(new THREE.Vector3(1, 0, 0), Math.PI);

  // fold a free panel, from a tap or the start of a drag. Print up, a fold would go into the
  // mat and leave the base on top: so it turns over first, base down, and folds up from there
  function fold(id: string) {
    save();
    if (printUp() && folding.amount(id) < 0.5) {
      flip();
      afterTurn = () => folding.toggle(id);
    } else folding.toggle(id);
  }

  // cmd-click (two fingers on a phone): a quarter turn. The face says which axis: a side face
  // spins it about y, the front tips it about x, a top rolls it about z; the turn goes the way a
  // push into the screen at that spot would send it
  const NEXT: Record<string, THREE.Vector3> = { x: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 0, 1) };
  function turnAt(cx: number, cy: number) {
    ray.setFromCamera(rig.ndc(cx, cy), camera);
    paper.root.updateMatrixWorld(true);
    const targets = [...paper.panels.values(), ...(paper.waste.visible ? [paper.waste] : [])];
    const h = ray.intersectObjects(targets, true)[0];
    if (!h?.face) return;
    byHand = true;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    const a = Math.abs(n.x) > Math.abs(n.y) ? (Math.abs(n.x) > Math.abs(n.z) ? 'x' : 'z') : Math.abs(n.y) > Math.abs(n.z) ? 'y' : 'z';
    const axis = NEXT[a].clone();
    const r = h.point.clone().sub(panelsBox().getCenter(new THREE.Vector3()));
    const sign = Math.sign(r.cross(ray.ray.direction).dot(axis)) || 1;
    turn(axis, (sign * Math.PI) / 2);
  }

  // a drag on a face of the free piece tips it over that way, a quarter turn about the
  // horizontal square to the drag; snapped to the grid's axes so it stays square to the mat
  function tip(dx: number, dy: number) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
    const away = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
    const d = right.multiplyScalar(dx).addScaledVector(away, -dy);
    const dir = Math.abs(d.x) > Math.abs(d.z) ? new THREE.Vector3(Math.sign(d.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(d.z));
    // about up × dir: up goes to dir, the top falls the way it is pushed
    byHand = true;
    turn(new THREE.Vector3(0, 1, 0).cross(dir), Math.PI / 2);
  }

  // --- pointer ---
  // A press is a thumb on the card: it bears on the borders around it until they go, right on a
  // border at once. Folding is by the fold lines only: a press near one folds the panel beyond
  // it, a drag from it folds by hand. The seam under the pointer is drawn.
  const ray = new THREE.Raycaster();
  // the card itself under the pointer (the piece, or the sheet while it is there), not the plane
  function onCard(cx: number, cy: number) {
    ray.setFromCamera(rig.ndc(cx, cy), camera);
    paper.root.updateMatrixWorld(true);
    const targets = [...paper.panels.values(), ...(paper.waste.visible ? [paper.waste] : [])];
    return ray.intersectObjects(targets, true).length > 0;
  }
  function sheetAt(cx: number, cy: number): V2 | null {
    ray.setFromCamera(rig.ndc(cx, cy), camera);
    return paper.hit(ray.ray);
  }
  const reach = (touch: boolean) => Math.max(1.5, (touch ? 22 : 11) * px());
  const thumbR = () => Math.min(26, Math.max(14, 70 * px()));
  // about 7 mm of card (4 for a mouse), never under a fingertip's 12 px or over 26: zoomed out on a
  // phone the panels are small and a wide reach would find a seam wherever it lands
  const seamReach = (touch: boolean) => (touch ? Math.min(26, Math.max(12, 7 / px())) : Math.min(12, Math.max(6, 4 / px())));

  // pinned seams (they cannot open yet: something would push through) are drawn red
  let lit: { id: string; pressed: boolean; pinned: boolean } | null = null;
  const INK = new THREE.Color('#16211c');
  const PINNED = new THREE.Color('#c4432a');
  const line = () => {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 10),
      new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0, depthTest: false }),
    );
    m.renderOrder = 4;
    world.add(m);
    return m;
  };
  const seamLine = line();
  const stuckLine = line();
  function place(m: THREE.Mesh, id: string, r: number) {
    const [A, B] = folding.seamEnds(id);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    m.scale.set(r, A.distanceTo(B), r);
  }
  function drawSeam(now: number) {
    const m = seamLine.material as THREE.MeshBasicMaterial;
    const want = lit ? (lit.pressed ? 0.95 : 0.6) : 0;
    m.opacity += (want - m.opacity) * 0.35;
    if (lit) {
      m.color.copy(lit.pinned ? PINNED : INK);
      place(seamLine, lit.id, Math.max(0.3, px() * (lit.pressed ? 2.2 : 1.5)));
    }
    // the stuck part: a red pulse on its seam
    const sm = stuckLine.material as THREE.MeshBasicMaterial;
    const f = stuckSeam ? Math.max(0, 1 - (now - stuckSeam.at) / 900) : 0;
    sm.color.copy(PINNED);
    sm.opacity = f * Math.abs(Math.sin(f * 10));
    if (stuckSeam && f > 0) place(stuckLine, stuckSeam.id, Math.max(0.3, px() * 2));
  }

  // up for a flat panel is against its fold when the print faces up; a folded one opens a touch
  function peekSeam(id: string | null) {
    if (!id) { folding.peek(null); return; }
    folding.peek(id, folding.amount(id) > 0.5 || printUp() ? -1 : 1);
  }

  // a seam or a border, whichever is nearer the pointer (borders only while the sheet holds)
  function nearest(cx: number, cy: number, touch: boolean) {
    const seam = folding.seamAt(cx, cy, seamReach(touch));
    const p = sheetAt(cx, cy);
    const b = p && !freed ? borderAt(borders, p, reach(touch)) : null;
    // both in reach: the nearer, in mm
    if (seam && b && p && distance(b, p) < seam.d * px()) return { seam: null, border: b, p, pinned: false };
    return { seam: seam?.id ?? null, border: seam ? null : b, p, pinned: !!seam?.pinned };
  }

  let press: { x: number; y: number; touch: boolean; p: V2 | null; at: number; mode: 'thumb' | 'seam' | 'fold' | 'spent'; seam: string | null; card: boolean; free: boolean } | null = null;
  let hovered: Border | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  // two fingers: pinch zooms, together they pan, a twist turns the scene about the vertical; a
  // quick tap of two, barely moving, turns the card. After a pinch nothing until every finger is off.
  let pinch: { d: number; x: number; y: number; a: number; at: number; travel: number } | null = null;
  let pinched = false;
  const two = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a: Math.atan2(b.y - a.y, b.x - a.x) };
  };

  function down(e: PointerEvent) {
    sound.unlock();
    gestureSaved = false;
    canvas.setPointerCapture(e.pointerId);
    const touch = e.pointerType === 'touch';
    if (touch) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) {
      if (touches.size === 2) {
        if (press?.mode === 'fold') folding.release();
        press = null;
        lit = null;
        folding.peek(null);
        pinch = { ...two(), at: performance.now(), travel: 0 };
        pinched = true;
      }
      return;
    }
    if (pinched) return;
    // mid-turn the card is in the air: hands off until it lands
    if (turning) return;
    if (e.metaKey || e.ctrlKey) { turnAt(e.clientX, e.clientY); return; }
    const n = nearest(e.clientX, e.clientY, touch);
    // press is set before any pop, so the whole gesture saves as one step
    press = { x: e.clientX, y: e.clientY, touch, p: n.p, at: performance.now(), mode: n.seam ? 'seam' : 'thumb', seam: n.seam, card: !!n.seam || onCard(e.clientX, e.clientY), free: freed && performance.now() - freedAt > 900 };
    if (n.seam) {
      lit = { id: n.seam, pressed: true, pinned: n.pinned };
      peekSeam(n.seam);
      return;
    }
    lit = null;
    if (!n.p || freed) return;
    if (n.border) pop(n.border);
    // the thumb lands: a first push on everything around
    for (const o of borders) if (!o.done) o.pressure += 0.45 * bearing(o, n.p, thumbR());
  }

  function moved(e: PointerEvent) {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size >= 2) {
        const t = two();
        let da = t.a - pinch.a;
        if (da > Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        rig.view.azimuth += THREE.MathUtils.radToDeg(da);
        rig.zoomAt(t.d / Math.max(1, pinch.d), t.x, t.y);
        rig.panBy(t.x - pinch.x, t.y - pinch.y);
        pinch.travel += Math.abs(t.d - pinch.d) + Math.hypot(t.x - pinch.x, t.y - pinch.y) + Math.abs(da) * t.d * 0.5;
        Object.assign(pinch, { d: t.d, x: t.x, y: t.y, a: t.a });
        return;
      }
      if (pinched) return;
    }
    const all = e.getCoalescedEvents?.() ?? [];
    for (const c of all.length > 1 ? all : [e]) move(c);
  }
  function move(e: PointerEvent) {
    if (!press) { hover(e); return; }
    if (press.mode === 'fold') { folding.move(e.clientX, e.clientY); return; }
    if (press.mode === 'spent') return;
    // on the bare mat: a sideways drag takes the view a quarter round the card, the way the mat goes
    if (!press.card && press.mode === 'thumb') {
      const dx = e.clientX - press.x, dy = e.clientY - press.y;
      if (Math.abs(dx) > (press.touch ? 30 : 20) && Math.abs(dx) > 1.5 * Math.abs(dy)) {
        const from = spin ? spin.to : rig.view.azimuth;
        spin = { from: rig.view.azimuth, to: from - Math.sign(dx) * 90, at: performance.now() };
        sound.unlock();
        sound.flip();
        press.mode = 'spent';
      }
      return;
    }
    const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) > (press.touch ? 10 : 6);
    if (press.mode === 'seam') {
      if (!far) return;
      const id = press.seam!;
      folding.peek(null);
      if (printUp() && folding.amount(id) < 0.5 && !held(id) && !folding.covered(id)) {
        // print up: over it goes first, then the panel folds by itself
        fold(id);
        press.mode = 'spent';
        return;
      }
      save();
      folding.grab(id, press.x, press.y);
      press.mode = 'fold';
      canvas.style.cursor = 'grabbing';
      folding.move(e.clientX, e.clientY);
      return;
    }
    // free of the sheet, a face dragged a little way tips the piece over that way
    // (only a press that began on the piece once it was free and settled, and only once it has
    // something folded: the thumb still sliding from the last pop mustn't stand a flat sheet up)
    if (freed) {
      if (press.free && folding.folded() && Math.hypot(e.clientX - press.x, e.clientY - press.y) > (press.touch ? 24 : 14)) {
        tip(e.clientX - press.x, e.clientY - press.y);
        press.mode = 'spent';
      }
      return;
    }
    // the thumb: sliding along a border pops it
    const p = sheetAt(e.clientX, e.clientY);
    press.p = p;
    if (p && !freed) {
      const b = borderAt(borders, p, reach(press.touch));
      if (b) pop(b);
    }
  }
  function hover(e: PointerEvent) {
    if (e.pointerType === 'touch' || turning) return;
    const n = nearest(e.clientX, e.clientY, false);
    hovered = n.border;
    lit = n.seam ? { id: n.seam, pressed: false, pinned: n.pinned } : null;
    peekSeam(n.seam);
    canvas.style.cursor = hovered || n.seam ? 'pointer' : freed && onCard(e.clientX, e.clientY) ? 'grab' : '';
  }
  function up(e: PointerEvent) {
    touches.delete(e.pointerId);
    if (pinch && touches.size < 2) {
      if (performance.now() - pinch.at < 350 && pinch.travel < 14) { gestureSaved = false; turnAt(pinch.x, pinch.y); }
      pinch = null;
    }
    if (!touches.size) pinched = false;
    if (!press) return;
    if (press.mode === 'fold') folding.release();
    // a tap on a seam: its panel folds, or opens; still in the sheet or pinned, it only gives
    else if (press.mode === 'seam' && performance.now() - press.at < 500) {
      if (held(press.seam!) || folding.covered(press.seam!)) folding.nudge(press.seam!);
      else fold(press.seam!);
    }
    folding.peek(null);
    if (press.touch || press.mode !== 'seam') lit = null;
    else if (lit) lit.pressed = false;
    press = null;
    canvas.style.cursor = '';
  }
  // wheel and trackpad pinch (the browser sends that as a wheel with ctrl) zoom about the pointer
  function wheel(e: WheelEvent) {
    e.preventDefault();
    rig.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0015)), e.clientX, e.clientY);
  }
  function leave() {
    if (!press) { hovered = null; lit = null; folding.peek(null); }
  }
  // iOS: no page zoom on top of ours
  const noGesture = (e: Event) => e.preventDefault();

  // the thumb's print on the card while it pushes
  const thumb = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(30, 24, 16, 0.32)');
    grad.addColorStop(0.55, 'rgba(30, 24, 16, 0.12)');
    grad.addColorStop(1, 'rgba(30, 24, 16, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0 }),
    );
    m.renderOrder = 3;
    paper.root.add(m);
    return m;
  })();

  // --- every frame ---
  const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e3 = new THREE.Euler();
  const mid = new THREE.Vector3(sheet.x + sheet.w / 2, sheet.y + sheet.h / 2, 0);

  function panelsBox() {
    paper.root.updateMatrixWorld(true);
    const b = new THREE.Box3();
    for (const g of paper.panels.values()) b.expandByObject(g, true);
    return b;
  }

  function pressure(now: number, dt: number) {
    const r = thumbR();
    const holding = press?.mode === 'thumb' && press.p && !freed;
    if (holding) {
      // the longer it pushes, the harder
      const k = dt * (0.9 + Math.min(1.2, (now - press!.at) / 1000));
      for (const b of borders) if (!b.done) {
        b.pressure += k * bearing(b, press!.p!, r);
        if (b.pressure >= 1) pop(b);
      }
    }
    // what is not pushed relaxes, a little
    const flash = Math.max(0, 1 - (now - heldAt) / 600);
    for (const b of borders) if (!b.done) {
      if (!holding) b.pressure = Math.max(0, b.pressure - dt * 0.15);
      tint(b, (b === hovered ? 0.3 : 0) + (heldIds.has(b.panel) ? flash * Math.abs(Math.sin(flash * 9)) : 0));
    }
    // the print of the thumb
    const tm = thumb.material as THREE.MeshBasicMaterial;
    const show = holding ? Math.min(1, (now - press!.at) / 250) : 0;
    tm.opacity += (show - tm.opacity) * 0.3;
    if (holding) {
      thumb.position.set(press!.p![0], press!.p![1], printUp() ? 0.1 : -0.5);
      thumb.scale.setScalar(r * (0.8 + 0.2 * show));
    }
  }

  // debug (?debug or d): every border drawn, blue still standing, green popped
  let debug = new URLSearchParams(location.search).has('debug');
  const debugLines = new THREE.Group();
  debugLines.renderOrder = 5;
  paper.root.add(debugLines);
  const BLUE = new THREE.Color('#2f7cff');
  const GREEN = new THREE.Color('#2fd36b');
  function drawDebug() {
    debugLines.visible = debug && !freed;
    if (!debugLines.visible) return;
    if (debugLines.userData.for !== borders) {
      debugLines.traverse((c) => { if (c instanceof THREE.Mesh) { c.geometry.dispose(); (c.material as THREE.Material).dispose(); } });
      debugLines.clear();
      // a wide strip along each border, flat over the print, one material per border
      for (const b of borders) {
        const g = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.9 });
        for (const r of b.runs) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(r.len, 3.5), mat);
          m.rotation.z = Math.atan2(r.dy, r.dx);
          m.position.set(r.a[0] + (r.dx * r.len) / 2, r.a[1] + (r.dy * r.len) / 2, THICK);
          m.renderOrder = 5;
          g.add(m);
        }
        debugLines.add(g);
      }
      debugLines.userData.for = borders;
    }
    borders.forEach((b, i) => (((debugLines.children[i] as THREE.Group).children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.copy(b.done ? GREEN : BLUE));
  }

  function animate(now: number, dt: number) {
    pressure(now, dt);
    drawDebug();
    drawSeam(now);
    folding.update(dt);

    // the piece: proud of the sheet by its lift, a bounce after each pop, a hop when it comes free
    const tp = (now - poppedAt) / 1000;
    let z = lift + 0.5 * Math.exp(-9 * tp) * Math.sin(Math.min(tp * 34, Math.PI * 6));
    if (freed) {
      const tf = (now - freedAt) / 1000;
      z = lift + 2.6 * Math.exp(-6 * tf) * Math.abs(Math.sin(tf * 15));
    }
    paper.piece.matrix.makeTranslation(0, 0, z);

    // the frame: a lift, then off towards the bottom right, turning
    if (freed && paper.waste.visible) {
      const u = Math.max(0, (now - freedAt) / 1000 - 0.08);
      const rise = 9 * easeOut(Math.min(1, u * 2.2));
      const go = 520 * Math.pow(u, 2.1);
      e3.set(0.5 * Math.pow(u, 1.5), -0.25 * u, -0.35 * Math.pow(u, 1.6));
      q.setFromEuler(e3);
      m4.compose(new THREE.Vector3(mid.x + go * 0.45, mid.y - go * 0.9, rise), q, new THREE.Vector3(1, 1, 1));
      m4.multiply(new THREE.Matrix4().makeTranslation(-mid.x, -mid.y, 0));
      paper.waste.matrix.copy(m4);
      if (u > 1.6) paper.waste.visible = false;
    }

    // turning over or round, about the middle of what is there, up in an arc
    let theta = 0;
    let arc = 0;
    const pivot = turning?.pivot ?? new THREE.Vector3();
    const axis = turning?.axis;
    if (turning) {
      const t = Math.min(1, (now - turning.at) / 1000 / turning.dur);
      const e = easeInOut(t);
      theta = turning.angle * e;
      arc = turning.height * Math.sin(Math.PI * e);
      if (t >= 1) {
        paper.place(turning.angle, pivot, 0, turning.axis);
        paper.settleRest();
        turning = null;
        theta = 0;
        sound.land();
        const then = afterTurn;
        afterTurn = null;
        then?.();
      }
    }

    // undo / redo of a turn: ease the orientation back
    if (restTween && !turning) {
      const t = Math.min(1, (now - restTween.at) / 450);
      const e = easeInOut(t);
      const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(), sc = new THREE.Vector3();
      restTween.from.decompose(p0, q0, sc);
      restTween.to.decompose(p1, q1, sc);
      paper.setRest(new THREE.Matrix4().compose(p0.lerp(p1, e), q0.slerp(q1, e), sc));
      if (t >= 1) restTween = null;
    }

    // free and never turned by hand: it keeps to its base
    if (freed && !byHand && !turning && !press && !paper.waste.visible && printUp() && now - freedAt > 650) {
      gestureSaved = false;
      flip();
    }
    if (spin) {
      const t = Math.min(1, (now - spin.at) / 550);
      rig.view.azimuth = spin.from + (spin.to - spin.from) * easeInOut(t);
      if (t >= 1) spin = null;
    }

    // stand on the mat: whatever is lowest touches it. Up at once, down like it falls.
    paper.place(theta, pivot, arc + ground, axis);
    const low = folding.unpeeked(() => {
      const b = new THREE.Box3();
      for (const g of paper.panels.values()) b.expandByObject(g, true);
      if (paper.waste.visible && !freed) b.expandByObject(paper.waste, true);
      return b;
    });
    const want = ground - low.min.y;
    ground = want > ground ? want : ground + (want - ground) * (1 - Math.exp(-dt * 14));
    paper.place(theta, pivot, arc + ground, axis);

    // the camera eases to hold what there is, still while a hand is on it
    if (press?.mode !== 'fold') {
      const box = folding.unpeeked(panelsBox);
      box.min.y = Math.min(box.min.y, 0);
      if (framed.isEmpty()) framed.copy(box);
      const k = 1 - Math.exp(-dt * 2.5);
      framed.min.lerp(box.min, k);
      framed.max.lerp(box.max, k);
      // the taller it stands, the more air around it
      rig.view.room = 1.12 + 0.28 * Math.min(1, Math.max(0, (framed.max.y - framed.min.y) / 80));
      rig.fit(framed);
    }

    if (!built && freed && !paper.waste.visible && folding.allShut()) {
      built = true;
      sound.crease(true);
    }
    // undone back out of built
    if (built && !folding.allShut()) built = false;
    say();
  }

  // --- keys: c pops everything, f folds it all up, space flips (dev and demos), r starts over,
  // d shows the borders (blue standing, green popped) ---
  const ORDER = foldOrder(house);
  function popAll() {
    sound.unlock();
    gestureSaved = false;
    save();
    gestureSaved = true;
    for (const b of borders) pop(b);
    gestureSaved = false;
  }
  function foldAll() {
    const gap = Math.min(260, 5000 / ORDER.length);
    ORDER.forEach((id, i) => timers.push(window.setTimeout(() => folding.shut(id), 250 + i * gap)));
  }
  function key(e: KeyboardEvent) {
    // cmd-z undoes, shift-cmd-z (or ctrl-y) redoes; nothing else with a modifier
    if (e.metaKey || e.ctrlKey) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if (k === 'y') { e.preventDefault(); redo(); }
      return;
    }
    if (e.key === 'r') reset();
    if (e.key === 'd') debug = !debug;
    if (e.key === 'c') popAll();
    if (e.key === ' ') { e.preventDefault(); gestureSaved = false; byHand = true; flip(); }
    if (e.key === 'f') {
      if (!freed) popAll();
      gestureSaved = false;
      save();
      gestureSaved = true;
      // print down first, then up it goes
      if (printUp()) { flip(); afterTurn = foldAll; } else foldAll();
      gestureSaved = false;
    }
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', moved);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('wheel', wheel, { passive: false });
  document.addEventListener('gesturestart', noGesture);
  addEventListener('keydown', key);
  hud({ ready: false, actions: { undo, redo, flip: () => { gestureSaved = false; byHand = true; flip(); }, reset } });

  reset();
  // ?cut: start with the piece already out (debug, demos)
  if (new URLSearchParams(location.search).has('cut')) {
    for (const b of borders) { b.done = true; b.mesh.visible = false; }
    freed = true;
    freedAt = -1e9;
    paper.waste.visible = false;
    say();
    // base down, as when it pops out
    flip();
    undos = [];
    showHistory();
  }

  // --- what it is, to carry over a hot update or a reload ---
  const pack = (s: Snap): SavedSnap => ({ done: s.done, folds: s.folds, rest: s.rest.toArray() });
  const unpack = (s: SavedSnap): Snap => ({ done: s.done, folds: s.folds, rest: new THREE.Matrix4().fromArray(s.rest) });
  function saveAll(): Saved {
    const s = snap();
    const v = rig.view;
    return {
      model: model.id,
      byHand,
      ...pack(s),
      view: { zoom: v.zoom, panX: v.panX, panY: v.panY, azimuth: v.azimuth },
      undos: undos.map(pack),
      redos: redos.map(pack),
    };
  }
  // put back as it was, at once, no animation
  function load(s: Saved) {
    if (s.model !== model.id || s.done.length !== borders.length) return;
    setBorders(s.done);
    if (s.done.every(Boolean)) { freed = true; freedAt = -1e9; paper.waste.visible = false; }
    folding.jump(s.folds);
    paper.setRest(new THREE.Matrix4().fromArray(s.rest));
    Object.assign(rig.view, s.view);
    // older saves never said: count it as not turned, so it keeps to its base
    byHand = s.byHand ?? false;
    undos = s.undos.map(unpack);
    redos = s.redos.map(unpack);
    framed.makeEmpty();
    rig.aim();
    showHistory();
    say();
  }

  function dispose() {
    timers.forEach(clearTimeout);
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', moved);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('pointerleave', leave);
    canvas.removeEventListener('wheel', wheel);
    document.removeEventListener('gesturestart', noGesture);
    removeEventListener('keydown', key);
    world.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of [o.material].flat()) m.dispose();
      }
    });
    tex.dispose();
    back.dispose();
  }

  // dev hooks for scripted runs
  if (import.meta.env.DEV) {
    const screen = (v: THREE.Vector3) => {
      const p = rig.screen(v.project(camera));
      return [p.x, p.y];
    };
    Object.assign(window as any, {
      __borders: () => {
        paper.root.updateMatrixWorld(true);
        return borders.map((b) => {
          const run = b.runs[Math.floor(b.runs.length / 2)];
          const m = run.len / 2;
          return screen(new THREE.Vector3(run.a[0] + run.dx * m, run.a[1] + run.dy * m, 0).applyMatrix4(paper.root.matrixWorld));
        });
      },
      __panel: (id: string) => {
        paper.root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(paper.panels.get(id)!);
        return screen(box.getCenter(new THREE.Vector3()));
      },
      __left: () => borders.map((b, i) => (b.done ? -1 : i)).filter((i) => i >= 0),
      __heights: () => {
        paper.root.updateMatrixWorld(true);
        const out: Record<string, number> = {};
        for (const [id, g] of paper.panels) out[id] = +new THREE.Box3().setFromObject(g, true).min.y.toFixed(2);
        return { ground: +ground.toFixed(2), lift, low: Math.min(...Object.values(out)), base: out.base, worst: Object.entries(out).sort((a, b) => a[1] - b[1]).slice(0, 3) };
      },
      __save: () => saveAll(),
      __load: (x: Saved) => load(x),
      __foldAll: foldAll,
      __undo: undo,
      __redo: redo,
      __covered: () => house.panels.filter((p) => folding.covered(p.id)).map((p) => p.id),
      __seamAt: (x: number, y: number) => folding.seamAt(x, y, 26),
      __seam: (id: string) => { paper.root.updateMatrixWorld(true); const [A, B] = folding.seamEnds(id); return screen(A.add(B).multiplyScalar(0.5)); },
      __zoom: () => [rig.view.zoom, rig.view.azimuth],
      __amounts: () => Object.fromEntries(house.panels.map((p) => [p.id, +folding.amount(p.id).toFixed(2)])),
      __state: () => ({ popped: borders.filter((b) => b.done).length, freed, built, printUp: printUp(), hint: useHud.getState().hint }),
    });
  }

  return { world, animate, save: saveAll, load, dispose };
}
export type Game = ReturnType<typeof createGame>;
