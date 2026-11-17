import * as THREE from 'three';
import { centroid, foldMatrices } from './fold';
import { outline, sheetOf } from './net';
import { makePaper, printTexture, THICK } from './paper';
import { modelById, type Model } from './models';
import { setTown, useHud, type Placed } from './hud';
import type { Rig } from './rig';
import * as sound from './sound';
import { drawMap, MAP, OPEN, PARK, SQUARE } from './town';

// The board: a sheet of cardboard on the mat where what was built stands, folded and glued.
// Drag one to move it, drag it off the edge to take it away. Tap one and a little cube of
// corners comes round it with a ring on the board: drag the ring to turn it, any way (it
// settles square when close). A sideways drag on the mat takes the view round a quarter, pinch
// and wheel zoom.

export const BOARD = { w: MAP.w, d: MAP.d, t: 4 };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// sheet → standing on the board: x stays, sheet y comes towards you (the front), the walls
// (folded to sheet -z) go up. The base's middle on the origin.
const STAND = new THREE.Matrix4().makeBasis(V(1, 0, 0), V(0, 0, 1), V(0, -1, 0));
const stands = new Map<string, { matrix: THREE.Matrix4; folds: Map<string, THREE.Matrix4>; box: THREE.Box3 }>();
function standing(model: Model) {
  let s = stands.get(model.id);
  if (!s) {
    const net = model.net;
    const folds = foldMatrices(net);
    const base = net.panels.find((p) => !p.parent)!;
    const [bx, by] = centroid(base.poly);
    const matrix = STAND.clone().multiply(new THREE.Matrix4().makeTranslation(-bx, -by, 0));
    const box = new THREE.Box3();
    for (const p of net.panels) for (const [x, y] of p.poly) box.expandByPoint(V(x, y, 0).applyMatrix4(folds.get(p.id)!).applyMatrix4(matrix));
    s = { matrix, folds, box };
    stands.set(model.id, s);
  }
  return s;
}

// a building's footprint on the board, turned (turn in quarters, any part of one): the box
// round it, square to the board
function footprint(p: Pick<Placed, 'id' | 'x' | 'z' | 'turn'>) {
  const { box } = standing(modelById(p.id)!);
  const a = (p.turn * Math.PI) / 2;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const w = box.max.x - box.min.x, d = box.max.z - box.min.z;
  const hx = (c * w + s * d) / 2, hz = (s * w + c * d) / 2;
  return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz, hx, hz };
}

// the focus round a picked building, in its holder's frame: a bracket at each corner of the
// box round it, and on the board a ring to turn it by, a knob at its front, arrows either side
// drawn with depth: the corners behind the building stay hidden behind it
const LIT = new THREE.MeshBasicMaterial({ color: '#f4f4f2', side: THREE.DoubleSide });
const DARK = new THREE.MeshBasicMaterial({ color: '#20352c', side: THREE.DoubleSide });
function focus(model: Model) {
  const { box } = standing(model);
  const g = new THREE.Group();
  const m = 2.5;
  const x0 = box.min.x - m, x1 = box.max.x + m, z0 = box.min.z - m, z1 = box.max.z + m, y0 = 0, y1 = box.max.y - box.min.y + m;
  const L = Math.min(8, 0.3 * Math.min(x1 - x0, y1 - y0, z1 - z0));
  const T = 0.7;
  // a bar from a to b (a box along z, turned to face b; no parent yet, so that is in g's frame)
  const bar = (a: THREE.Vector3, b: THREE.Vector3) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(T, T, a.distanceTo(b) + T), LIT);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.lookAt(b);
    mesh.renderOrder = 10;
    return mesh;
  };
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
    const c = V(x, y, z);
    const dx = x === x0 ? 1 : -1, dy = y === y0 ? 1 : -1, dz = z === z0 ? 1 : -1;
    for (const d of [V(dx * L, 0, 0), V(0, dy * L, 0), V(0, 0, dz * L)]) g.add(bar(c, c.clone().add(d)));
  }
  // the ring, round the turning point (the base's middle, the holder's origin)
  const R = Math.max(...[[x0, z0], [x0, z1], [x1, z0], [x1, z1]].map(([x, z]) => Math.hypot(x, z))) + 6;
  const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.6, R + 0.6, 128), LIT);
  const flat = (o: THREE.Object3D) => { o.rotation.x = -Math.PI / 2; o.position.y = 0.4; o.renderOrder = 10; return o; };
  g.add(flat(ring));
  // the knob, at the front (+z), and an arrow along the ring either side of it
  const knob = new THREE.Group();
  knob.add(new THREE.Mesh(new THREE.CircleGeometry(6.5, 40), LIT));
  const dot = new THREE.Mesh(new THREE.CircleGeometry(2.6, 24), DARK);
  dot.position.z = 0.05;
  dot.renderOrder = 11;
  knob.add(dot);
  flat(knob);
  knob.position.set(0, 0.4, R);
  for (const c of knob.children) c.renderOrder = 11;
  g.add(knob);
  for (const side of [-1, 1]) {
    const a = side * (10 / R); // past the knob
    const tip = side * (17 / R);
    const tri = new THREE.Shape();
    // laid flat face up, shape y runs to board -z: the front (+z) is shape -y
    const at = (ang: number, r: number) => [Math.sin(ang) * r, -Math.cos(ang) * r] as const;
    tri.moveTo(...at(tip, R));
    tri.lineTo(...at(a, R + 3.6));
    tri.lineTo(...at(a, R - 3.6));
    g.add(flat(new THREE.Mesh(new THREE.ShapeGeometry(tri), LIT)));
  }
  return { group: g, R };
}

// put a new one on the board: round the square, by the streets, clear of the others, the
// nearest the middle such spot with a little room round it
export function placeNew(id: string) {
  const town = useHud.getState().town;
  const taken = town.map(footprint);
  const { hx, hz } = footprint({ id, x: 0, z: 0, turn: 0 });
  const spots: [number, number][] = [];
  for (let x = -BOARD.w / 2 + hx + 4; x <= BOARD.w / 2 - hx - 4; x += 3) for (let z = -BOARD.d / 2 + hz + 4; z <= BOARD.d / 2 - hz - 4; z += 3) spots.push([x, z]);
  const clear = (x: number, z: number, m: number, r: { x0: number; z0: number; x1: number; z1: number }) => x + hx + m < r.x0 || x - hx - m > r.x1 || z + hz + m < r.z0 || z - hz - m > r.z1;
  // the gap to the nearest neighbour, edge to edge
  const gap = (x: number, z: number) => Math.min(40, ...taken.map((t) => Math.max(t.x0 - (x + hx), (x - hx) - t.x1, t.z0 - (z + hz), (z - hz) - t.z1)));
  let best: [number, number] = [0, 0];
  let score = Infinity;
  for (const [x, z] of spots) {
    if (!taken.every((t) => clear(x, z, 3, t))) continue;
    // off the cobbles, unless there is no room left anywhere else
    const paved = !OPEN.every((o) => clear(x, z, 2, o));
    const s = Math.hypot(x, z) - 1.1 * Math.min(gap(x, z), 22) + (paved ? 1000 : 0);
    if (s < score) { score = s; best = [x, z]; }
  }
  const [x, z] = best;
  setTown((t) => [...t, { key: `${id}-${Date.now().toString(36)}`, id, x: Math.round(x), z: Math.round(z), turn: 0 }]);
}

// preview: the board small, an island on the table beside the folder of sheets; nothing on it
// moves, a tap on it opens it
export function createBoard(camera: THREE.OrthographicCamera, canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer, rig: Rig, preview?: { open(): void }) {
  const world = new THREE.Group();
  const top = BOARD.t;

  // the cardboard: kraft on top, the flutes along its cut edges
  const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD.w, BOARD.t, BOARD.d), cardboard());
  board.position.y = BOARD.t / 2;
  board.castShadow = board.receiveShadow = true;
  world.add(board);

  // the buildings' prints, one set per kind, shared by every copy on the board
  const prints = new Map<string, { tex: THREE.Texture; back: THREE.Texture }>();
  const printOf = (m: Model) => {
    let p = prints.get(m.id);
    if (!p) {
      const sheet = sheetOf(m.net);
      p = { tex: printTexture(m.net, m.art, sheet, renderer), back: printTexture(m.net, m.art, sheet, renderer, true, m.backArt) };
      prints.set(m.id, p);
    }
    return p;
  };

  interface Sprite { key: string; id: string; holder: THREE.Group; pos: THREE.Vector3; rot: number; lift: number; fall?: { at: number; v: THREE.Vector3 } }
  const sprites = new Map<string, Sprite>();
  const leaving: Sprite[] = [];

  function build(p: Placed): Sprite {
    const model = modelById(p.id)!;
    const net = model.net;
    const { matrix, folds, box } = standing(model);
    const { tex, back } = printOf(model);
    const paper = makePaper(net, sheetOf(net), outline(net), tex, back);
    paper.waste.visible = false;
    const sink = new THREE.Matrix4().makeTranslation(0, 0, -THICK * 1.05);
    for (const q of net.panels) {
      const g = paper.panels.get(q.id)!;
      g.matrix.copy(folds.get(q.id)!);
      if (q.kind === 'tab') g.matrix.multiply(sink);
    }
    paper.root.matrix.copy(matrix).premultiply(new THREE.Matrix4().makeTranslation(0, -box.min.y, 0));
    const holder = new THREE.Group();
    holder.add(paper.root);
    holder.position.set(p.x, top, p.z);
    holder.rotation.y = -p.turn * Math.PI / 2;
    world.add(holder);
    return { key: p.key, id: p.id, holder, pos: holder.position.clone(), rot: holder.rotation.y, lift: 0 };
  }

  function drop(s: Sprite) {
    if (lit?.s === s) unpick();
    s.holder.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of [o.material].flat()) if (m !== undefined) m.dispose();
      }
    });
    world.remove(s.holder);
  }

  // the picked one, its focus round it
  let lit: { s: Sprite; group: THREE.Group; R: number } | null = null;
  function unpick() {
    if (!lit) return;
    lit.s.holder.remove(lit.group);
    lit.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    lit = null;
  }
  function pickOne(s: Sprite) {
    unpick();
    const f = focus(modelById(s.id)!);
    s.holder.add(f.group);
    lit = { s, ...f };
  }

  // the store says what stands where; sprites follow it
  function sync() {
    const town = useHud.getState().town;
    const keys = new Set(town.map((p) => p.key));
    for (const [k, s] of sprites) if (!keys.has(k)) { sprites.delete(k); if (!s.fall) drop(s); }
    for (const p of town) if (!sprites.has(p.key)) sprites.set(p.key, build(p));
  }
  sync();
  const unsub = useHud.subscribe((s, was) => { if (s.town !== was.town) sync(); });

  // --- the hand ---
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(V(0, 1, 0), -top);
  const at = (cx: number, cy: number) => {
    ray.setFromCamera(rig.ndc(cx, cy), camera);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  };
  function pick(cx: number, cy: number): Sprite | null {
    ray.setFromCamera(rig.ndc(cx, cy), camera);
    world.updateMatrixWorld(true);
    const hit = ray.intersectObjects([...sprites.values()].map((s) => s.holder), true)[0];
    if (!hit) return null;
    for (const s of sprites.values()) {
      let o: THREE.Object3D | null = hit.object;
      while (o && o !== s.holder) o = o.parent;
      if (o) return s;
    }
    return null;
  }
  const placedOf = (key: string) => useHud.getState().town.find((p) => p.key === key)!;
  const onBoard = (x: number, z: number) => Math.abs(x) < BOARD.w / 2 && Math.abs(z) < BOARD.d / 2;

  let press: { x: number; y: number; touch: boolean; s: Sprite | null; off: THREE.Vector3 | null; moved: boolean; spent: boolean; ring?: { a: number } } | null = null;
  let spin: { from: number; to: number; at: number } | null = null;
  // the view a quarter round: +1 the way a drag to the right takes the board
  function turnView(dir: number) {
    const from = spin ? spin.to : rig.view.azimuth;
    spin = { from: rig.view.azimuth, to: from - dir * 90, at: performance.now() };
    sound.unlock();
    sound.flip();
  }
  // the picked one's ring under the pointer: the angle round its middle there
  function onRing(cx: number, cy: number, touch: boolean) {
    if (!lit) return null;
    const p = at(cx, cy);
    if (!p) return null;
    const c = lit.s.holder.position;
    const r = Math.hypot(p.x - c.x, p.z - c.z);
    const reach = Math.max(5, (touch ? 22 : 12) * rig.mmPerPx);
    return Math.abs(r - lit.R) < reach ? Math.atan2(p.z - c.z, p.x - c.x) : null;
  }
  // settles square when within a few degrees of it
  const settle = (rot: number) => {
    const q = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
    return Math.abs(rot - q) < THREE.MathUtils.degToRad(4) ? q : rot;
  };
  useHud.setState({ zoom: (f) => rig.zoomBy(f) });
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; x: number; y: number; a: number } | null = null;
  const two = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a: Math.atan2(b.y - a.y, b.x - a.x) };
  };

  function down(e: PointerEvent) {
    sound.unlock();
    if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) { cancel(); pinch = two(); return; }
    const touch = e.pointerType === 'touch';
    const a = onRing(e.clientX, e.clientY, touch);
    if (a !== null && lit) {
      press = { x: e.clientX, y: e.clientY, touch, s: lit.s, off: null, moved: true, spent: false, ring: { a } };
      canvas.style.cursor = 'grabbing';
      sound.snap(0.3);
      return;
    }
    const s = pick(e.clientX, e.clientY);
    const p = s && at(e.clientX, e.clientY);
    press = { x: e.clientX, y: e.clientY, touch, s, off: p ? p.sub(s!.pos) : null, moved: false, spent: false };
    if (s) canvas.style.cursor = 'grabbing';
  }
  function cancel() {
    if (press?.s && press.moved) { const p = placedOf(press.s.key); press.s.pos.set(p.x, top, p.z); press.s.lift = 0; }
    press = null;
  }
  function move(e: PointerEvent) {
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
        pinch = t;
        return;
      }
    }
    if (!press) { canvas.style.cursor = onRing(e.clientX, e.clientY, false) !== null || pick(e.clientX, e.clientY) ? 'grab' : ''; return; }
    if (press.ring && press.s) {
      // round the ring: the building follows the pointer's angle round its middle
      const p = at(e.clientX, e.clientY);
      if (!p) return;
      const c = press.s.holder.position;
      const a = Math.atan2(p.z - c.z, p.x - c.x);
      let da = a - press.ring.a;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      press.ring.a = a;
      press.s.rot -= da; // rotation about up runs from +x towards -z
      return;
    }
    if (press.spent) return;
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    if (!press.s) {
      // the bare mat: a sideways drag takes the view a quarter round
      if (Math.abs(dx) > (press.touch ? 30 : 20) && Math.abs(dx) > 1.5 * Math.abs(dy)) {
        turnView(Math.sign(dx));
        press.spent = true;
      }
      return;
    }
    if (!press.moved && Math.hypot(dx, dy) > (press.touch ? 10 : 6)) { press.moved = true; sound.snap(0.3); }
    if (press.moved) {
      const p = at(e.clientX, e.clientY);
      if (p && press.off) { press.s.pos.set(p.x - press.off.x, top, p.z - press.off.z); press.s.lift = 8; }
    }
  }
  function up(e: PointerEvent) {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (!press) return;
    const { s, moved, ring, spent } = press;
    press = null;
    canvas.style.cursor = '';
    if (ring && s) {
      s.rot = settle(s.rot);
      const turn = Math.round((-s.rot / (Math.PI / 2)) * 1000) / 1000;
      setTown((t) => t.map((p) => (p.key === s.key ? { ...p, turn } : p)));
      sound.land();
      return;
    }
    if (!s) {
      // a tap on the board lets the picked one go
      if (!spent) unpick();
      return;
    }
    if (!moved) {
      // a tap: picked, or let go
      if (lit?.s === s) unpick();
      else pickOne(s);
      sound.snap(0.5);
      return;
    }
    s.lift = 0;
    if (onBoard(s.pos.x, s.pos.z)) {
      const x = Math.round(s.pos.x / 2) * 2, z = Math.round(s.pos.z / 2) * 2;
      setTown((t) => t.map((p) => (p.key === s.key ? { ...p, x, z } : p)));
      sound.land();
    } else {
      // off the edge: it falls away
      s.fall = { at: performance.now(), v: V(0, 0, 0) };
      leaving.push(s);
      setTown((t) => t.filter((p) => p.key !== s.key));
      sound.pop();
    }
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    rig.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0015)), e.clientX, e.clientY);
  }
  const noGesture = (e: Event) => e.preventDefault();
  // the preview's own hand: a tap on the island opens it
  let tapAt: { x: number; y: number } | null = null;
  const onIsland = (cx: number, cy: number) => {
    ray.setFromCamera(rig.ndc(cx, cy), camera);
    world.updateMatrixWorld(true);
    return ray.intersectObject(world, true).length > 0;
  };
  const tapDown = (e: PointerEvent) => { tapAt = { x: e.clientX, y: e.clientY }; };
  const tapMove = (e: PointerEvent) => { canvas.style.cursor = onIsland(e.clientX, e.clientY) ? 'pointer' : ''; };
  const tapUp = (e: PointerEvent) => {
    const t = tapAt;
    tapAt = null;
    if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10 && onIsland(e.clientX, e.clientY)) {
      sound.unlock();
      sound.snap(0.5);
      canvas.style.cursor = '';
      preview!.open();
    }
  };
  if (preview) {
    canvas.addEventListener('pointerdown', tapDown);
    canvas.addEventListener('pointermove', tapMove);
    canvas.addEventListener('pointerup', tapUp);
  } else {
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
  }
  document.addEventListener('gesturestart', noGesture);

  const frame = new THREE.Box3(V(SQUARE.x0 - 30, 0, SQUARE.z0 - 30), V(SQUARE.x1 + 30, 40, SQUARE.z1 + 30));
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function animate(now: number, dt: number) {
    if (spin) {
      const t = Math.min(1, (now - spin.at) / 550);
      rig.view.azimuth = spin.from + (spin.to - spin.from) * ease(t);
      if (t >= 1) spin = null;
    }
    // the square, the lawn and what stands on the board, not the whole board: it is big
    const want = new THREE.Box3(V(Math.min(SQUARE.x0, PARK.x0) - 30, 0, Math.min(SQUARE.z0, PARK.z0) - 30), V(Math.max(SQUARE.x1, PARK.x1) + 30, 40, Math.max(SQUARE.z1, PARK.z1) + 30));
    for (const sp of sprites.values()) {
      const p = useHud.getState().town.find((q) => q.key === sp.key);
      if (!p || (press?.s === sp && press.moved && !press.ring)) continue;
      const f = footprint(p);
      const st = standing(modelById(p.id)!);
      want.expandByPoint(V(f.x0 - 12, 0, f.z0 - 12)).expandByPoint(V(f.x1 + 12, st.box.max.y - st.box.min.y + top, f.z1 + 12));
    }
    const k4 = 1 - Math.exp(-dt * 3);
    frame.min.lerp(want.min, k4);
    frame.max.lerp(want.max, k4);
    rig.view.room = 1.05;
    if (preview) {
      // the whole board, small, to the right of the folder (below it on a phone)
      const phone = canvas.clientWidth < 640;
      frame.set(V(-BOARD.w / 2, 0, -BOARD.d / 2), V(BOARD.w / 2, 60, BOARD.d / 2));
      Object.assign(rig.view, phone ? { room: 1.3, offX: 0, offY: -0.6 } : { room: 2.15, offX: 0.62, offY: -0.08 });
    }
    rig.fit(frame);
    rig.tick(dt);
    const k = 1 - Math.exp(-dt * 14);
    for (const s of sprites.values()) {
      const p = useHud.getState().town.find((q) => q.key === s.key);
      if (!p) continue;
      const dragging = press?.s === s && press.moved && !press.ring;
      if (!dragging) s.pos.lerp(V(p.x, top, p.z), k);
      // eased round to where it is turned, unless the ring has it
      if (!(press?.ring && press.s === s)) {
        const want = -p.turn * Math.PI / 2;
        s.rot += (want - s.rot) * k;
      }
      s.holder.position.set(s.pos.x, s.pos.y + THREE.MathUtils.lerp(s.holder.position.y - s.pos.y, s.lift, k), s.pos.z);
      s.holder.rotation.y = s.rot;
    }
    for (let i = leaving.length - 1; i >= 0; i--) {
      const s = leaving[i];
      const t = (now - s.fall!.at) / 1000;
      s.holder.position.y = s.pos.y + 8 - 400 * t * t;
      s.holder.rotation.z = t * 2;
      if (t > 0.6) { leaving.splice(i, 1); drop(s); }
    }
  }

  function dispose() {
    unpick();
    unsub();
    canvas.removeEventListener('pointerdown', tapDown);
    canvas.removeEventListener('pointermove', tapMove);
    canvas.removeEventListener('pointerup', tapUp);
    canvas.style.cursor = '';
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('wheel', wheel);
    document.removeEventListener('gesturestart', noGesture);
    for (const s of [...sprites.values(), ...leaving]) drop(s);
    board.geometry.dispose();
    for (const m of [board.material].flat()) { (m as THREE.MeshStandardMaterial).map?.dispose(); m.dispose(); }
    for (const p of prints.values()) { p.tex.dispose(); p.back.dispose(); }
  }

  if (import.meta.env.DEV) {
    Object.assign(window as any, {
      __town: () => useHud.getState().town,
      // the picked one's knob on screen, and at an angle further round the ring
      __knob: (turn = 0) => {
        if (!lit) return null;
        world.updateMatrixWorld(true);
        const a = -turn; // radians, the way the building turns
        const p = V(Math.sin(a) * lit.R, 0.4, Math.cos(a) * lit.R).applyMatrix4(lit.s.holder.matrixWorld).project(camera);
        const q = rig.screen(p);
        return [q.x, q.y];
      },
      __where: (key: string) => {
        world.updateMatrixWorld(true);
        const s = sprites.get(key)!;
        const v = s.holder.position.clone().add(V(0, 15, 0)).project(camera);
        const q = rig.screen(v);
        return [q.x, q.y];
      },
    });
  }

  return { world, animate, dispose };
}
export type Board = ReturnType<typeof createBoard>;

// the board: the square printed on top, the flutes showing along the cut edges
function cardboard() {
  // the top: the square and its streets, printed on the board
  const px = Math.min(4, 4096 / Math.max(MAP.w, MAP.d)); // a phone takes 4096 at most
  const top = document.createElement('canvas');
  top.width = MAP.w * px;
  top.height = MAP.d * px;
  drawMap(top.getContext('2d')!, px);
  const kraft = new THREE.CanvasTexture(top);
  kraft.colorSpace = THREE.SRGBColorSpace;
  kraft.anisotropy = 8;

  const edge = document.createElement('canvas');
  edge.width = 256;
  edge.height = 16;
  const e = edge.getContext('2d')!;
  e.fillStyle = '#b8935f';
  e.fillRect(0, 0, 256, 16);
  e.fillStyle = '#d7b88a';
  e.fillRect(0, 0, 256, 2);
  e.fillRect(0, 14, 256, 2);
  e.strokeStyle = '#8f6c40';
  e.lineWidth = 1.5;
  e.beginPath();
  for (let x = 0; x <= 256; x += 1) e.lineTo(x, 8 + 4.5 * Math.sin((x / 256) * Math.PI * 2 * 32));
  e.stroke();
  const flutes = new THREE.CanvasTexture(edge);
  flutes.colorSpace = THREE.SRGBColorSpace;
  flutes.wrapS = THREE.RepeatWrapping;
  flutes.repeat.set(6, 1);

  const side = new THREE.MeshStandardMaterial({ map: flutes, roughness: 0.95 });
  const face = new THREE.MeshStandardMaterial({ map: kraft, roughness: 0.93 });
  return [side, side, face, face, side, side];
}
