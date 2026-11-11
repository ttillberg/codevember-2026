// State and input. Owns every change to the world: the tools (hand, line, free), orbiting,
// grabbing and peeling pieces, and what a peel leaves behind.
//
// Feel: a cut is a scalpel, instant and a hairline. The film is the skin of a boiled egg:
// thin, clingy, a little elastic (peel.ts). What comes off is gone for good.

import { Euler, Quaternion, Vector3, Vector4 } from 'three';
import { FILMS, ROOTS, makeLayer } from './layers';
import { createFilm } from './film';
import { createLift } from './lift';
import { R } from './state';
import type { Ctx, Listener, Module, Piece, Tool, World, WorldEvents } from './state';
import { TEXEL, edgeNormal, fillFilm, flushFilm, restoreFilm, idAt, paintArc, paintCircle, relabel } from './filmops';
import { initPieces, syncPieces } from './pieces';
import { TENSION_POINTS, createPeeler, tune } from './peel';
import type { Tune } from './peel';
import { createUi } from './ui';

// ---------------------------------------------------------------------------------- tuning

const MIN_DRAG = 28;            // px, a shorter line does not cut
const GRAB_PX_MOUSE = 40;       // px from an edge to grab it
const GRAB_PX_TOUCH = 56;
const GRAZE = 0.97;             // a line's plane must pass closer than this to the centre
const TEAR_SPEED = 0.5;         // how much a fast pull (rad/s) adds to the load on the front
const STORE = 'codevember-2026-09-settings';
const HISTORY = 8;              // steps back that are kept (a copy of the film each)
const FADE_TIME = 0.16;         // s, what was lifted fades where it is once let go
const STEP = 1.2 * TEXEL;       // grab search step, under a groove's width so none is jumped
const DIRS = 24;                // grab search directions

const TOOLS: Tool[] = ['hand', 'line', 'free'];
const HOME = new Euler(0.38, -0.55, 0.12); // how the sphere is turned at the start


// ----------------------------------------------------------------------------------- world

export function createWorld(): World {
  const subs = new Map<keyof WorldEvents, Array<(e: unknown) => void>>();
  const world: World = {
    layer: makeLayer(0),
    next: makeLayer(1),
    film: createFilm(),
    lift: createLift(),
    pieces: new Map(),
    rotation: new Quaternion().setFromEuler(HOME),
    tool: 'hand',
    aim: { active: false, x0: 0, y0: 0, x1: 0, y1: 0, valid: false },
    hover: { id: 0, ok: true },
    tension: { pos: new Float32Array(TENSION_POINTS * 3), col: new Float32Array(TENSION_POINTS * 3), count: 0 },
    finger: { active: false, from: new Vector3(0, 0, 1), at: new Vector3(0, 0, 1), height: 0 },
    time: 0,
    on<K extends keyof WorldEvents>(type: K, fn: Listener<K>) {
      let l = subs.get(type);
      if (!l) subs.set(type, (l = []));
      l.push(fn as unknown as (e: unknown) => void);
    },
    emit<K extends keyof WorldEvents>(type: K, e: WorldEvents[K]) {
      const l = subs.get(type);
      if (l) for (let i = 0; i < l.length; i++) l[i](e);
    },
  };
  initPieces(world);
  return world;
}

// ------------------------------------------------------------------------------------- sim

export function createSim(ctx: Ctx): Module {
  const { world, camera, canvas } = ctx;
  canvas.style.touchAction = 'none';

  // temps, never escape a function
  const qInv = new Quaternion();
  const tQ = new Quaternion();
  const tA = new Vector3(), tB = new Vector3(), tC = new Vector3(), tD = new Vector3();
  const tH = new Vector3(), tW = new Vector3(), tP = new Vector3(), tM = new Vector3();
  const tU = new Vector3(), tV = new Vector3();
  const hit0 = new Vector3(), rot = new Quaternion();
  const rayO = new Vector3(), rayD = new Vector3(), d0 = new Vector3(), nW = new Vector3();
  const plane = new Vector4();
  const nOut = [0, 0, 0];
  let sx = 0, sy = 0;

  const peeler = createPeeler(world);
  /** Seconds left of the fade after letting go, 0 while held. */
  let fading = 0;
  let lastTravel = 0, pullSpeed = 0;
  const omega = new Vector3();
  /** A cut is waiting for the pieces in motion to settle before it is relabelled. */
  let relabelDue = false;
  let bare = false;

  // ------------------------------------------------------------------------------- view

  let vw = 1, vh = 1, left = 0, top = 0, rpx = 200;
  function measure() {
    const r = canvas.getBoundingClientRect();
    left = r.left; top = r.top;
    vw = r.width || window.innerWidth;
    vh = r.height || window.innerHeight;
    const D = camera.position.length();
    rpx = (vh / 2) * (R / Math.sqrt(Math.max(1e-6, D * D - R * R))) / Math.tan((camera.fov * Math.PI) / 360);
  }
  measure();

  /** Ray through CSS pixel (x, y), world space, into rayO / rayD. */
  function ray(x: number, y: number) {
    camera.updateMatrixWorld();
    rayO.setFromMatrixPosition(camera.matrixWorld);
    rayD.set((x / vw) * 2 - 1, -(y / vh) * 2 + 1, 0.5).unproject(camera).sub(rayO).normalize();
  }

  /** Front hit of the current ray with the sphere, world space. */
  function hit(out: Vector3): boolean {
    const b = rayO.dot(rayD);
    const disc = b * b - (rayO.lengthSq() - R * R);
    if (disc < 0) return false;
    out.copy(rayO).addScaledVector(rayD, -b - Math.sqrt(disc));
    return true;
  }

  /** Like hit, but off the silhouette it keeps rolling over the back of the sphere, so a
   *  finger dragged past the edge keeps pulling. World space, on the sphere. */
  function virtualHit(out: Vector3) {
    if (hit(out)) return;
    out.copy(rayO).addScaledVector(rayD, -rayO.dot(rayD));
    const rho = out.length();
    out.divideScalar(rho);
    tC.copy(rayD).addScaledVector(out, -rayD.dot(out)).normalize();
    const a = Math.min(2.6, ((rho - R) / R) * 3);
    out.multiplyScalar(Math.cos(a)).addScaledVector(tC, Math.sin(a)).multiplyScalar(R);
  }

  function toScreen(v: Vector3) {
    tP.copy(v).project(camera);
    sx = ((tP.x + 1) / 2) * vw;
    sy = ((1 - tP.y) / 2) * vh;
  }

  // ------------------------------------------------------------------------------- film

  function hasLive() {
    return world.pieces.size > 0;
  }

  /** Relabel the film now, or as soon as nothing is being pulled. */
  function requestRelabel() {
    if (peeler.active) relabelDue = true;
    else relabelNow();
  }

  function relabelNow() {
    relabelDue = false;
    syncPieces(world, relabel(world.film, world.pieces.keys()));
    world.hover.id = 0;
    if (!bare && world.pieces.size === 0) { bare = true; world.emit('filmGone', {}); }
  }

  // ---------------------------------------------------------------------------- history

  // The film and how the sphere was turned, before each cut and each pull: a step back to
  // try the same thing again with other settings.
  type Step = { cover: Uint8Array; rotation: Quaternion };
  const history: Step[] = [];
  /** Steps undone, to take again. Any new step drops them. */
  const ahead: Step[] = [];

  const snapshot = (): Step => ({ cover: world.film.cover.slice(), rotation: world.rotation.clone() });
  function push(stack: Step[], s: Step) {
    if (stack.length === HISTORY) stack.shift();
    stack.push(s);
  }

  function remember() {
    push(history, snapshot());
    ahead.length = 0;
    showHistory();
  }

  /** Drop the last step: nothing came of it. */
  function forget() {
    history.pop();
    showHistory();
  }

  function back() {
    const h = history.pop();
    if (!h) return;
    push(ahead, snapshot());
    restore(h);
  }

  function redo() {
    const h = ahead.pop();
    if (!h) return;
    push(history, snapshot());
    restore(h);
  }

  function restore(h: Step) {
    peeler.clear();
    fading = 0;
    omega.set(0, 0, 0);
    restoreFilm(world.film, h.cover);
    world.rotation.copy(h.rotation);
    bare = false;
    relabelNow();
    showHistory();
  }

  let showHistory = () => {};

  // ------------------------------------------------------------------------------- line

  /** Plane through the eye and the two pointer rays, world space, into `plane`. Returns
   *  its distance from the centre (Infinity if degenerate). */
  function planeWorld(x0: number, y0: number, x1: number, y1: number): number {
    ray(x0, y0); d0.copy(rayD);
    ray(x1, y1);
    nW.crossVectors(d0, rayD);
    const l = nW.length();
    if (l < 1e-9) return Infinity;
    nW.divideScalar(l);
    const w = nW.dot(rayO);
    plane.set(nW.x, nW.y, nW.z, w);
    return Math.abs(w);
  }

  function aimValid(x0: number, y0: number, x1: number, y1: number) {
    return Math.hypot(x1 - x0, y1 - y0) >= MIN_DRAG && hasLive() && planeWorld(x0, y0, x1, y1) < R * GRAZE;
  }

  /** The whole circle where the plane through the eye and the line meets the sphere, front
   *  and back, cut at once. */
  function lineCut(x0: number, y0: number, x1: number, y1: number): boolean {
    if (!aimValid(x0, y0, x1, y1)) return false;
    qInv.copy(world.rotation).invert();
    tA.set(plane.x, plane.y, plane.z).applyQuaternion(qInv);
    remember();
    paintCircle(world.film, tA.x, tA.y, tA.z, plane.w / R);
    requestRelabel();
    return true;
  }

  // ------------------------------------------------------------------------------- free

  const stroke = { on: false, painted: false, last: new Vector3() };

  /** Carry the stroke to CSS pixel (x, y): a groove from the last point if both are on the
   *  sphere's front, otherwise the stroke breaks there. */
  function drawTo(x: number, y: number) {
    ray(x, y);
    if (!hit(tW)) { stroke.on = false; return; }
    tH.copy(tW).applyQuaternion(qInv);
    if (stroke.on) {
      if (!stroke.painted) remember();
      const a = stroke.last;
      paintArc(world.film, a.x, a.y, a.z, tH.x, tH.y, tH.z);
      stroke.painted = true;
    }
    stroke.last.copy(tH);
    stroke.on = true;
  }

  // ------------------------------------------------------------------------------- peel

  /** Where the pointer is on the sphere (or rolled over its back), unit, sphere-local. */
  function finger(out: Vector3) {
    ray(px, py);
    virtualHit(out);
    out.applyQuaternion(qInv).normalize();
  }

  /** Where the pointer's ray (set by finger) meets the sphere of radius r, or the point of
   *  that sphere nearest the ray if it passes outside. Unit direction, sphere-local. */
  function lifted(r: number, out: Vector3) {
    const b = rayO.dot(rayD);
    const disc = b * b - (rayO.lengthSq() - r * r);
    out.copy(rayO).addScaledVector(rayD, disc >= 0 ? -b - Math.sqrt(disc) : -b);
    out.applyQuaternion(qInv).normalize();
  }

  /** Take hold of the film at the grab. */
  function startPull(): boolean {
    if (!peeler.start(grab.piece!.id, grab.e, grab.n)) return false;
    remember();
    finger(hit0);
    fading = 0;
    world.finger.from.copy(grab.e).normalize();
    world.finger.at.copy(world.finger.from);
    lastTravel = pullSpeed = 0;
    return true;
  }

  /** Out of the hand: what is lifted fades where it is, then is cut away for good. A grab
   *  that never got anything loose just lets the film lie. */
  function letGo() {
    if (peeler.peeled === 0) { peeler.clear(); forget(); }
    else fading = FADE_TIME;
  }

  function updatePeel(dt: number) {
    if (!peeler.active) return;
    if (fading > 0) {
      fading -= dt;
      world.lift.fade = Math.max(0, fading / FADE_TIME);
      peeler.step(dt);
      if (fading <= 0 && peeler.commit()) { relabelNow(); world.emit('peeled', {}); }
      return;
    }
    finger(tH);
    const travel = hit0.angleTo(tH);
    // The hand lifts as it pulls. The finger is on the pointer's ray, as high above the
    // sphere as the pull has earned: over the place where the film comes off, not dragged
    // flat along the surface. Past the silhouette that ray still meets the raised shell.
    lifted(R + peeler.rise(travel), tH);
    rot.setFromUnitVectors(hit0, tH);
    pullSpeed += (Math.abs(travel - lastTravel) / dt - pullSpeed) * (1 - Math.exp(-12 * dt));
    lastTravel = travel;
    peeler.carry(rot, travel);
    peeler.step(dt);
    world.finger.at.copy(world.finger.from).applyQuaternion(rot);
    world.finger.height = peeler.height;
    // Nothing of it is stuck any more: it is off, and there is no use holding on to it.
    if (peeler.peeled > 0 && peeler.front === 0) {
      letGo();
      drag = 'torn';
      return;
    }
    // Too much asked of it: the film breaks off along the front, out of the hand.
    if (tune.tear > 0 && peeler.front * (1 + TEAR_SPEED * pullSpeed) > tune.tear * 40) {
      letGo();
      drag = 'torn';
    }
  }

  // ------------------------------------------------------------------------------ input

  type Drag = 'none' | 'orbit' | 'peel' | 'torn' | 'aim' | 'draw';
  let drag: Drag = 'none';
  let pid = -1;
  let touch = false;
  let px = 0, py = 0;
  let lastMoveT = 0;
  let cursor = '';
  const setCursor = (c: string) => { if (c !== cursor) { cursor = c; canvas.style.cursor = c; } };

  const grab = { piece: null as Piece | null, g: new Vector3(), e: new Vector3(), n: new Vector3() };
  function grabbable(pc: Piece | undefined): pc is Piece {
    return pc !== undefined && !peeler.active;
  }

  /** Point at angle rho from tH along the tangent tD, into out. */
  function march(rho: number, out: Vector3) {
    out.copy(tH).multiplyScalar(Math.cos(rho)).addScaledVector(tD, Math.sin(rho));
  }

  /**
   * Is (x, y) on the sphere within reach of an edge of a grabbable piece? An edge is where
   * film ends (a groove, or film peeled away), found by marching out from the pointer over
   * the atlas. On a piece it grabs that piece; on bare sphere, the nearest piece across.
   * Fills grab: the piece, the point to hold, the edge point and the inward direction there.
   */
  function findGrab(x: number, y: number): boolean {
    grab.piece = null;
    if (relabelDue || peeler.active) return false;
    ray(x, y);
    if (!hit(tW)) return false;
    tH.copy(tW).applyQuaternion(qInv);
    const film = world.film;
    const under = world.pieces.get(idAt(film, tH.x, tH.y, tH.z));
    const on = grabbable(under) ? under : null;
    // Near the silhouette a pixel spans more of the surface: march further there.
    tA.copy(rayO).sub(tW).normalize();
    let best = touch ? GRAB_PX_TOUCH : GRAB_PX_MOUSE;
    const reach = best / rpx / Math.max(0.25, tA.dot(tW) / R);
    tU.set(-tH.y, tH.x, 0);
    if (tU.lengthSq() < 1e-6) tU.set(0, -tH.z, tH.y);
    tU.normalize();
    tV.crossVectors(tH, tU);
    for (let k = 0; k < DIRS; k++) {
      const phi = (k / DIRS) * 2 * Math.PI;
      tD.copy(tU).multiplyScalar(Math.cos(phi)).addScaledVector(tV, Math.sin(phi));
      for (let rho = STEP; rho <= reach; rho += STEP) {
        march(rho, tM);
        const id = idAt(film, tM.x, tM.y, tM.z);
        const pc = on ?? world.pieces.get(id);
        if (on ? id === on.id : !grabbable(pc)) continue;
        // To a fraction of a step: a stays on the side the march came from.
        const target = on ? on.id : id;
        let a = rho - STEP, b = rho;
        for (let it = 0; it < 6; it++) {
          const m = (a + b) / 2;
          march(m, tM);
          if ((idAt(film, tM.x, tM.y, tM.z) === target) === (on !== null)) a = m; else b = m;
        }
        // The edge point on the piece's side, if the camera sees it.
        march(on ? a : b, tM);
        tB.copy(tM).applyQuaternion(world.rotation);
        if (tC.copy(rayO).sub(tB).dot(tB) <= 0) break;
        toScreen(tB);
        const dpx = Math.hypot(sx - x, sy - y);
        if (dpx < best) {
          best = dpx;
          grab.piece = pc!;
          grab.e.copy(tM);
          if (on) grab.g.copy(tH);
          else {
            march(b + 0.004, tM);
            grab.g.copy(idAt(film, tM.x, tM.y, tM.z) === id ? tM : grab.e);
          }
          // In case the film cannot tell: into the piece, away from where the march crossed.
          grab.n.copy(tD).multiplyScalar(on ? -1 : 1);
        }
        break;
      }
    }
    if (!grab.piece) return false;
    const e = grab.e;
    if (edgeNormal(film, grab.piece.id, e.x, e.y, e.z, nOut)) grab.n.set(nOut[0], nOut[1], nOut[2]);
    grab.n.addScaledVector(e, -grab.n.dot(e)).normalize();
    return true;
  }

  // Hover: under the mouse, the piece a press would grab is flagged in world.hover and
  // membrane.ts outlines it. Nothing moves.
  let mouseIn = false;

  function updateHover() {
    const h = world.hover;
    h.id = 0;
    h.ok = true;
    if (!mouseIn || pid !== -1 || drag !== 'none') return;
    if (world.tool !== 'hand') {
      ray(px, py);
      setCursor(world.tool === 'free' && !hit(tW) ? 'move' : 'crosshair');
      return;
    }
    if (findGrab(px, py)) {
      h.id = grab.piece!.id;
      setCursor('grab');
    } else setCursor('move');
  }

  function onDown(e: PointerEvent) {
    if (pid !== -1) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    pid = e.pointerId;
    try { canvas.setPointerCapture(pid); } catch { /* fine */ }
    touch = e.pointerType !== 'mouse';
    px = e.clientX - left; py = e.clientY - top;
    lastMoveT = e.timeStamp;
    if (touch) mouseIn = false;
    qInv.copy(world.rotation).invert();
    const tool = world.tool;
    if (tool === 'line') {
      // The sphere holds still while a cut is aimed.
      omega.set(0, 0, 0);
      drag = 'aim';
      const a = world.aim;
      a.active = true; a.x0 = a.x1 = px; a.y0 = a.y1 = py; a.valid = false;
      setCursor('crosshair');
      return;
    }
    ray(px, py);
    if (hit(tW)) {
      if (tool === 'free') {
        omega.set(0, 0, 0);
        drag = 'draw';
        stroke.on = false;
        stroke.painted = false;
        drawTo(px, py);
        setCursor('crosshair');
        return;
      }
      if (findGrab(px, py) && startPull()) {
        drag = 'peel';
        setCursor('grabbing');
        return;
      }
    }
    drag = 'orbit';
    omega.set(0, 0, 0);
    setCursor('grabbing');
  }

  function onMove(e: PointerEvent) {
    if (e.pointerId !== pid) {
      if (pid === -1 && e.pointerType === 'mouse') { px = e.clientX - left; py = e.clientY - top; mouseIn = true; touch = false; }
      return;
    }
    const ox = px, oy = py;
    px = e.clientX - left; py = e.clientY - top;
    if (drag === 'aim') {
      const a = world.aim;
      a.x1 = px; a.y1 = py;
      a.valid = aimValid(a.x0, a.y0, a.x1, a.y1);
    } else if (drag === 'draw') {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (evs.length > 0) for (const c of evs) drawTo(c.clientX - left, c.clientY - top);
      else drawTo(px, py);
    } else if (drag === 'orbit') {
      const dx = px - ox, dy = py - oy;
      const len = Math.hypot(dx, dy);
      const dte = Math.max(1 / 240, (e.timeStamp - lastMoveT) / 1000);
      lastMoveT = e.timeStamp;
      if (len > 0) {
        tA.set(dy / len, dx / len, 0);
        const ang = len / rpx;
        tQ.setFromAxisAngle(tA, ang);
        world.rotation.premultiply(tQ).normalize();
        tA.multiplyScalar(ang / dte);
        omega.lerp(tA, 0.5);
      }
    }
  }

  function onUp(e: PointerEvent) {
    if (e.pointerId !== pid) return;
    px = e.clientX - left; py = e.clientY - top;
    if (drag === 'aim') {
      const a = world.aim;
      a.active = false;
      a.valid = false;
      if (e.type === 'pointerup') lineCut(a.x0, a.y0, px, py);
    } else if (drag === 'draw') {
      if (stroke.painted) requestRelabel();
      stroke.on = false;
    } else if (drag === 'orbit') {
      if (e.timeStamp - lastMoveT > 70) omega.set(0, 0, 0);
    } else if (drag === 'peel') {
      letGo();
    }
    drag = 'none';
    try { canvas.releasePointerCapture(pid); } catch { /* fine */ }
    pid = -1;
    if (e.pointerType !== 'mouse') setCursor('');
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && pid === -1) mouseIn = false; });

  // ------------------------------------------------------------------------------ tools

  // Finishes to try, one each for the film and the sphere, picked by swatch.
  const pick = [0, 0];
  const ui = createUi({
    tools: TOOLS,
    finishes: [FILMS, ROOTS],
    onTool: setTool,
    onFinish: setFinish,
    onBench: bench,
    onBack: back,
    onRedo: redo,
  });
  showHistory = () => ui.setHistory(history.length, ahead.length);
  showHistory();

  function setTool(t: Tool) {
    world.tool = t;
    ui.setTool(t);
  }
  setTool(world.tool);

  // A fixed bench to compare feels on: whole film, the sphere turned as at the start, and
  // the same three cuts facing the camera: a line right round, a straight open cut and an
  // open U.
  function bench() {
    remember();
    peeler.clear();
    fading = 0;
    relabelDue = false;
    omega.set(0, 0, 0);
    world.rotation.setFromEuler(HOME);
    qInv.copy(world.rotation).invert();
    const film = world.film;
    fillFilm(film);
    // (x, y) as seen from the camera, in sphere radii, to a point on the film
    const at = (x: number, y: number, out: Vector3) =>
      out.set(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))).applyQuaternion(qInv);
    const stroke = (pts: Array<[number, number]>) => {
      for (let i = 1; i < pts.length; i++) {
        at(pts[i - 1][0], pts[i - 1][1], tA);
        at(pts[i][0], pts[i][1], tB);
        paintArc(film, tA.x, tA.y, tA.z, tB.x, tB.y, tB.z);
      }
    };
    tC.set(0.12, 1, 0).normalize().applyQuaternion(qInv);
    paintCircle(film, tC.x, tC.y, tC.z, -0.42);
    stroke([[-0.5, 0.12], [-0.05, 0.12]]);
    stroke([[0.18, 0.5], [0.18, 0.08], [0.55, 0.08], [0.55, 0.5]]);
    bare = false;
    relabelNow();
  }

  function setFinish(index: number, variant: number) {
    const count = index === 0 ? FILMS.length : ROOTS.length;
    pick[index] = ((variant % count) + count) % count;
    const layer = makeLayer(index, pick[index]);
    if (index === 0) {
      world.layer = layer;
      tune.elastic = layer.elastic;
      tune.adhesion = layer.adhesion;
      ui.syncSliders();
    } else world.next = layer;
    ui.setFinish(index, pick[index]);
  }
  // Settings are kept between visits: the two finishes by name and every slider. A film's
  // own stretch and cling are only copied in when it is picked by hand, so what was saved
  // wins over them here.
  const saved = loadSettings();
  setFinish(0, Math.max(0, FILMS.findIndex((f) => f.name === saved?.film)));
  setFinish(1, Math.max(0, ROOTS.findIndex((f) => f.name === saved?.base)));
  if (saved?.tune) {
    for (const k of Object.keys(tune) as Array<keyof Tune>) {
      const v = saved.tune[k];
      if (typeof v === 'number' && Number.isFinite(v)) tune[k] = v;
    }
    ui.syncSliders();
  }
  let stored = settingsNow();
  let storeIn = 0;

  function settingsNow(): string {
    return JSON.stringify({ film: world.layer.name, base: world.next.name, tune });
  }
  function loadSettings(): { film?: string; base?: string; tune?: Partial<Record<keyof Tune, unknown>> } | null {
    try { return JSON.parse(localStorage.getItem(STORE) ?? 'null'); } catch { return null; }
  }
  /** Write the settings out if they changed. Storage can be missing or full: then not. */
  function storeSettings() {
    const now = settingsNow();
    if (now === stored) return;
    stored = now;
    try { localStorage.setItem(STORE, now); } catch { /* fine */ }
  }
  window.addEventListener('pagehide', storeSettings);

  window.addEventListener('keydown', (e) => {
    if (e.altKey) return;
    // Cmd/Ctrl+Z undo, with Shift (or Ctrl+Y) redo. Held down, they repeat.
    if (e.metaKey || e.ctrlKey) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else back(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
      return;
    }
    if (e.repeat) return;
    const i = '123'.indexOf(e.key);
    if (i >= 0) setTool(TOOLS[i]);
    if (e.key === 'b') bench();
    if (e.key === 'z') back();
    if (e.key === 'Z' || e.key === 'y') redo();
  });

  // For capture scripts, in CSS pixels.
  const api = {
    tool: (t: Tool) => setTool(t),
    finish: (index: number, variant: number) => setFinish(index, variant),
    peel: peeler,
    tune,
    bench,
    back,
    redo,
    cut: (x0: number, y0: number, x1: number, y1: number) => lineCut(x0, y0, x1, y1),
    draw: (points: Array<[number, number]>) => {
      qInv.copy(world.rotation).invert();
      stroke.on = false;
      stroke.painted = false;
      for (const [x, y] of points) drawTo(x, y);
      stroke.on = false;
      if (stroke.painted) requestRelabel();
      return stroke.painted;
    },
  };
  (window as unknown as { sim: typeof api }).sim = api;

  // ----------------------------------------------------------------------------- update

  return {
    update(dt: number) {
      if (dt <= 0) return;

      // Orbit inertia. While held but still, it bleeds off so a pause then release does not fling.
      if (drag === 'orbit') {
        if (performance.now() - lastMoveT > 50) omega.multiplyScalar(Math.exp(-20 * dt));
      } else if (omega.lengthSq() > 1e-6) {
        const w = omega.length();
        tA.copy(omega).divideScalar(w);
        tQ.setFromAxisAngle(tA, w * dt);
        world.rotation.premultiply(tQ).normalize();
        omega.multiplyScalar(Math.exp(-3.5 * dt));
      } else omega.set(0, 0, 0);
      qInv.copy(world.rotation).invert();

      world.lift.ghost = tune.ghost;
      if ((storeIn -= dt) <= 0) { storeIn = 0.5; storeSettings(); }
      updatePeel(dt);
      world.finger.active = peeler.active && fading <= 0;
      if (relabelDue && !peeler.active) relabelNow();
      updateHover();
      flushFilm(world.film);
    },
    resize() { measure(); },
  };
}
