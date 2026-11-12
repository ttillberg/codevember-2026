// State and input. Owns every change to the world: the tools (peel, knife, ruler, scratch), orbiting,
// grabbing and peeling pieces, and what a peel leaves behind.
//
// Feel: a cut is a scalpel, instant and a hairline. The film is the skin of a boiled egg:
// thin, clingy, a little elastic (peel.ts). What comes off is gone for good.

import { Euler, Quaternion, Vector3, Vector4 } from 'three';
import { FILMS, FILMS_MAX, ROOTS, editLayer, makeLayer } from './layers';
import type { Layer, LayerEdit } from './layers';
import { createFilm } from './film';
import { createLift } from './lift';
import { R } from './state';
import type { Ctx, Module, Piece, Tool, World } from './state';
import { TEXEL, beginStroke, edgeNormal, endStroke, erasePiece, fillFilm, restoreFilm, idAt, paintArc, paintCircle, relabel } from './filmops';
import { initPieces, syncPieces } from './pieces';
import { TENSION_POINTS, createPeeler, tune } from './peel';
import type { Tune } from './peel';
import { createUi } from './ui';
import type { LayerView } from './ui';

// ---------------------------------------------------------------------------------- tuning

const MIN_DRAG = 28;            // px, a shorter line does not cut
const GRAB_PX_MOUSE = 40;       // px from an edge to grab it
const GRAB_PX_TOUCH = 28;       // a finger: closer than a mouse, since on touch the same press off an edge is a knife
const GRAZE = 0.97;             // a line's plane must pass closer than this to the centre
const TEAR_SPEED = 0.5;         // how much a fast pull (rad/s) adds to the load on the front
const STORE = 'codevember-2026-09-settings';
// What a first visit starts with, in the shape settings are kept in (and `copy` gives):
// a dull dark metal film over a glossy opaque milk one, on slate.
const DEFAULTS = {
  films: [
    { preset: 'smoke', color: 0x1a1c20, opacity: 0.8, roughness: 0.06, metalness: 0, print: 'label', ink: 0x0a2040 },
    { preset: 'white', color: 0xf6f6f4, opacity: 1, roughness: 0.2, metalness: 0, print: 'label', ink: 0x0a2040 },
  ],
  base: { preset: 'eye', color: 0xf3efe8, opacity: 1, roughness: 0.2, metalness: 0, print: 'label', ink: 0x0a2040 },
  tune: {
    elastic: 0.036, adhesion: 0, shear: 0.3, load: 0, lift: 0.13, ghost: 1, height: 0.5, rough: 0,
    tear: 2.3, grip: 4.74, edge: 0.16, straight: 1,
  },
  show: { debug: false, grid: false },
};
const FILMS_DEEP = 2;           // films on the sphere to start with, one over the other
const HISTORY = 5;              // steps back that are kept (a copy of every film each)
const FADE_TIME = 0.16;         // s, what was lifted fades where it is once let go
const STEP = 1.2 * TEXEL;       // grab search step, under a groove's width so none is jumped
const DIRS = 24;                // grab search directions

const TOOLS: Tool[] = ['combo', 'peel', 'knife', 'ruler', 'scratch'];
const OPEN_WAIT = 0.25;         // s after landing before the opening cross is begun
const OPEN_TIME = 0.75;         // s it takes to draw, both strokes
const OPEN_POINTS = 28;         // points along each of its strokes
const CLAWS = 4;                // cuts a scratch leaves, side by side
const CLAW_GAP = 0.05;          // between them, in radii, give or take
const CLAW_GAP_VARY = 0.45;     // how much of that gap each claw is off its even place, either way
const CLAW_FAN = 0.2;           // rad each claw may veer off the stroke, either way
const CLAW_LATE = 0.05;         // radii of travel by which a claw may come down after the first
const CLAW_SWAY = 0.012;        // radii each claw wanders sideways as it goes
const CLAW_STEP = 0.012;        // radii the pointer travels between two points of a scratch
const HOME = new Euler(0.38, -0.55, 0.12); // how the sphere is turned at the start


// ----------------------------------------------------------------------------------- world

export function createWorld(): World {
  const world: World = {
    films: Array.from({ length: FILMS_DEEP }, () => createFilm()),
    layers: Array.from({ length: FILMS_DEEP }, (_, k) => makeLayer(0, k)),
    next: makeLayer(1),
    lift: createLift(),
    pieces: Array.from({ length: FILMS_DEEP }, () => new Map()),
    rotation: new Quaternion().setFromEuler(HOME),
    tool: 'combo',
    aim: { active: false, x0: 0, y0: 0, x1: 0, y1: 0, valid: false },
    hover: { layer: 0, id: 0 },
    show: { debug: true, grid: true, films: true },
    look: { x: 0, y: 0, on: false },
    tension: { pos: new Float32Array(TENSION_POINTS * 3), col: new Float32Array(TENSION_POINTS * 3), count: 0 },
    finger: { active: false, from: new Vector3(0, 0, 1), at: new Vector3(0, 0, 1), height: 0 },
  };
  for (const pieces of world.pieces) initPieces(pieces);
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
    return world.pieces.some((p) => p.size > 0);
  }

  /** Relabel the films now, or as soon as nothing is being pulled. */
  function requestRelabel() {
    if (peeler.active) relabelDue = true;
    else relabelNow();
  }

  // The cover each film had when its pieces were last worked out.
  const labelled = new WeakMap<object, number>();
  function relabelNow() {
    relabelDue = false;
    world.films.forEach((film, k) => {
      if (film.coverVersion === labelled.get(film)) return;
      syncPieces(world.pieces[k], relabel(film, world.pieces[k].keys()));
      labelled.set(film, film.coverVersion); // relabel may have swept crumbs out of cover itself
    });
    world.hover.id = 0;
  }

  // ---------------------------------------------------------------------------- history

  // The film and how the sphere was turned, before each cut and each pull: a step back to
  // try the same thing again with other settings.
  type Step = { covers: Uint8Array[]; rotation: Quaternion };
  const history: Step[] = [];
  /** Steps undone, to take again. Any new step drops them. */
  const ahead: Step[] = [];

  const snapshot = (): Step => ({ covers: world.films.map((f) => f.cover.slice()), rotation: world.rotation.clone() });
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
    if (h.covers.length !== world.films.length) return; // from before a film was added or removed
    world.films.forEach((f, k) => restoreFilm(f, h.covers[k]));
    world.rotation.copy(h.rotation);
    relabelNow();
    showHistory();
  }

  let showHistory = () => {};

  // ------------------------------------------------------------------------------ ruler

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
    return world.show.films && Math.hypot(x1 - x0, y1 - y0) >= MIN_DRAG && hasLive() && planeWorld(x0, y0, x1, y1) < R * GRAZE;
  }

  /** The whole circle where the plane through the eye and the line meets the sphere, front
   *  and back, cut at once. */
  function lineCut(x0: number, y0: number, x1: number, y1: number): boolean {
    if (!aimValid(x0, y0, x1, y1)) return false;
    qInv.copy(world.rotation).invert();
    tA.set(plane.x, plane.y, plane.z).applyQuaternion(qInv);
    remember();
    beginStroke();
    paintCircle(world.films, tA.x, tA.y, tA.z, plane.w / R);
    if (endStroke()) requestRelabel();
    return true;
  }

  // -------------------------------------------------------------------- knife, scratch

  const stroke = {
    on: false, painted: false, last: new Vector3(),
    /** A scratch: how many cuts side by side (0: one, the knife), whether they have begun,
     *  which way is across the stroke, and where each of them has got to. */
    claws: 0, begun: false, side: new Vector3(),
    ends: Array.from({ length: CLAWS }, () => new Vector3()),
    /** No two scratches alike: how far the stroke has gone, and per claw where across the
     *  stroke it sits, how it veers off as it goes, how late it comes down, whether it is
     *  down yet, and the phase and pace of its sway. */
    travel: 0,
    off: new Float32Array(CLAWS), veer: new Float32Array(CLAWS), late: new Float32Array(CLAWS),
    down: new Uint8Array(CLAWS), phase: new Float32Array(CLAWS), pace: new Float32Array(CLAWS),
  };
  /** Roll a new paw for the scratch that is starting. */
  function rollClaws() {
    const n = stroke.claws, vary = () => Math.random() * 2 - 1;
    stroke.travel = 0;
    // the whole paw fans out or draws in a little, and each claw has its own mind on top
    const spread = vary() * CLAW_FAN * 0.6;
    for (let i = 0; i < n; i++) {
      const even = i - (n - 1) / 2;
      stroke.off[i] = (even + vary() * CLAW_GAP_VARY) * CLAW_GAP;
      stroke.veer[i] = Math.tan(spread * (even / Math.max(1, (n - 1) / 2)) + vary() * CLAW_FAN * 0.5);
      stroke.late[i] = Math.random() * Math.random() * CLAW_LATE;
      stroke.down[i] = 0;
      stroke.phase[i] = Math.random() * Math.PI * 2;
      stroke.pace[i] = 14 + Math.random() * 18;
    }
    stroke.late[(Math.random() * n) | 0] = 0; // one of them is first
  }
  const cA = new Vector3(), cB = new Vector3(), cP = new Vector3();

  /** Carry the stroke to CSS pixel (x, y): a groove from the last point if both are on the
   *  sphere's front, otherwise the stroke breaks there. */
  function drawTo(x: number, y: number) {
    ray(x, y);
    if (!world.show.films || !hit(tW)) { stroke.on = false; return; }
    tH.copy(tW).applyQuaternion(qInv);
    if (!stroke.on) stroke.begun = false;
    if (stroke.on && stroke.claws === 0) {
      // one stroke from press to release: it stays in the film it started in at each point
      if (!stroke.painted) { remember(); beginStroke(); }
      const a = stroke.last;
      paintArc(world.films, a.x, a.y, a.z, tH.x, tH.y, tH.z);
      stroke.painted = true;
    } else if (stroke.on) {
      // A scratch: the cuts run side by side across the way the pointer goes, so nothing is
      // laid until it has gone far enough to tell which way that is.
      const r = tH.length();
      cA.subVectors(tH, stroke.last);
      const step = cA.length() / r;
      if (step < CLAW_STEP) return;
      cB.crossVectors(tH, cA).normalize();
      if (stroke.begun) stroke.side.lerp(cB, 0.35).normalize();
      else { stroke.side.copy(cB); rollClaws(); }
      stroke.travel += step;
      const t = stroke.travel;
      for (let i = 0; i < stroke.claws; i++) {
        if (t < stroke.late[i]) continue; // not down yet
        const across = stroke.off[i] + stroke.veer[i] * t + Math.sin(stroke.phase[i] + t * stroke.pace[i]) * CLAW_SWAY;
        cP.copy(tH).addScaledVector(stroke.side, across * r).setLength(r);
        const a = stroke.ends[i];
        if (stroke.down[i]) {
          if (!stroke.painted) { remember(); beginStroke(); }
          paintArc(world.films, a.x, a.y, a.z, cP.x, cP.y, cP.z);
          stroke.painted = true;
        }
        a.copy(cP);
        stroke.down[i] = 1;
      }
      stroke.begun = true;
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
    if (!peeler.start(grab.layer, grab.piece!.id, grab.e, grab.n)) return false;
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
      peeler.step();
      if (fading <= 0 && peeler.commit()) relabelNow();
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
    peeler.step();
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

  const grab = { layer: 0, piece: null as Piece | null, g: new Vector3(), e: new Vector3(), n: new Vector3() };

  /** Point at angle rho from tH along the tangent tD, into out. */
  function march(rho: number, out: Vector3) {
    out.copy(tH).multiplyScalar(Math.cos(rho)).addScaledVector(tD, Math.sin(rho));
  }

  /** What is seen at a point: the film on top there and the piece of it, as
   *  film * 65536 + id, or -1 where the sphere is bare. */
  function seen(x: number, y: number, z: number): number {
    for (let k = 0; k < world.films.length; k++) {
      const id = idAt(world.films[k], x, y, z);
      if (id !== 0) return k * 65536 + id;
    }
    return -1;
  }

  /**
   * Is (x, y) on the sphere within reach of an edge of a piece? An edge is where the film
   * seen changes, found by marching out from the pointer over the atlases. What is grabbed
   * is the film that ends there: the piece under the pointer where the sphere or a lower
   * film shows beyond it, or the piece across the edge when that one lies on top (the rim
   * of an upper film, reached from the bare sphere or from the film under it).
   * Fills grab: the film, the piece, the point to hold, the edge point and the inward
   * direction there.
   */
  function findGrab(x: number, y: number): boolean {
    grab.piece = null;
    if (relabelDue || peeler.active || !world.show.films) return false;
    ray(x, y);
    if (!hit(tW)) return false;
    tH.copy(tW).applyQuaternion(qInv);
    const here = seen(tH.x, tH.y, tH.z);
    // Near the silhouette a pixel spans more of the surface: march further there.
    tA.copy(rayO).sub(tW).normalize();
    let best = touch ? GRAB_PX_TOUCH : GRAB_PX_MOUSE;
    const reach = best / rpx / Math.max(0.25, tA.dot(tW) / R);
    tU.set(-tH.y, tH.x, 0);
    if (tU.lengthSq() < 1e-6) tU.set(0, -tH.z, tH.y);
    tU.normalize();
    tV.crossVectors(tH, tU);
    let got = -1;
    for (let k = 0; k < DIRS; k++) {
      const phi = (k / DIRS) * 2 * Math.PI;
      tD.copy(tU).multiplyScalar(Math.cos(phi)).addScaledVector(tV, Math.sin(phi));
      for (let rho = STEP; rho <= reach; rho += STEP) {
        march(rho, tM);
        const there = seen(tM.x, tM.y, tM.z);
        if (there === here) continue;
        // To a fraction of a step: a stays on the pointer's side.
        let a = rho - STEP, b = rho;
        for (let it = 0; it < 6; it++) {
          const m = (a + b) / 2;
          march(m, tM);
          if (seen(tM.x, tM.y, tM.z) === here) a = m; else b = m;
        }
        // Whose edge is it: the film that lies on top of the other.
        const mine = here >= 0 && (there < 0 || there >> 16 > here >> 16 || there >> 16 === here >> 16);
        const key = mine ? here : there;
        if (key < 0) break;
        march(mine ? a : b, tM);
        tB.copy(tM).applyQuaternion(world.rotation);
        if (tC.copy(rayO).sub(tB).dot(tB) <= 0) break; // the camera does not see it
        toScreen(tB);
        const dpx = Math.hypot(sx - x, sy - y);
        if (dpx < best) {
          best = dpx;
          got = key;
          grab.e.copy(tM);
          if (mine) grab.g.copy(tH);
          else {
            march(b + 0.004, tM);
            grab.g.copy(seen(tM.x, tM.y, tM.z) === key ? tM : grab.e);
          }
          // In case the film cannot tell: into the piece, away from where the march crossed.
          grab.n.copy(tD).multiplyScalar(mine ? -1 : 1);
        }
        break;
      }
    }
    if (got < 0) return false;
    grab.layer = got >> 16;
    const piece = world.pieces[grab.layer].get(got & 65535);
    if (!piece) return false;
    grab.piece = piece;
    const e = grab.e;
    if (edgeNormal(world.films[grab.layer], piece.id, e.x, e.y, e.z, nOut)) grab.n.set(nOut[0], nOut[1], nOut[2]);
    grab.n.addScaledVector(e, -grab.n.dot(e)).normalize();
    return true;
  }

  // Hover: under the mouse, the piece a press would grab is flagged in world.hover and
  // membrane.ts outlines it. Nothing moves.
  let mouseIn = false;

  function updateHover() {
    const h = world.hover;
    h.id = 0;
    if (!mouseIn || pid !== -1 || drag !== 'none') return;
    const tool = world.tool;
    if (tool !== 'peel' && tool !== 'combo') {
      ray(px, py);
      setCursor(tool !== 'ruler' && !hit(tW) ? 'move' : 'crosshair');
      return;
    }
    if (findGrab(px, py)) {
      h.layer = grab.layer;
      h.id = grab.piece!.id;
      setCursor('grab');
    } else setCursor(tool === 'combo' ? 'crosshair' : 'move'); // the combo cuts wherever it does not peel
  }

  // Fingers on the screen, by pointer id, and the turn two of them make together.
  const fingers = new Map<number, { x: number; y: number }>();
  const two = { on: false, x: 0, y: 0, a: 0 };
  const zAxis = new Vector3(0, 0, 1);
  /** Where the two fingers are together: their middle and the angle of the line between them. */
  function twoAt() {
    const [p, q] = [...fingers.values()];
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, a: Math.atan2(q.y - p.y, q.x - p.x) };
  }
  /** What the first finger began is called off: a second one came down, so it was a turn. */
  function callOff() {
    if (drag === 'aim') { world.aim.active = false; world.aim.valid = false; }
    else if (drag === 'draw') {
      stroke.on = false;
      if (stroke.painted) { const h = history.pop(); if (h) restore(h); showHistory(); }
    } else if (drag === 'peel') { peeler.clear(); forget(); }
    drag = 'none';
  }

  function onDown(e: PointerEvent) {
    drawOpening(1); // a hand on it: the cross is there
    if (e.pointerType !== 'mouse') {
      fingers.set(e.pointerId, { x: e.clientX - left, y: e.clientY - top });
      if (fingers.size === 2 && pid !== -1 && !two.on) {
        // Two fingers turn the sphere, whatever the first one was about to do.
        e.preventDefault();
        callOff();
        try { canvas.setPointerCapture(e.pointerId); } catch { /* fine */ }
        omega.set(0, 0, 0);
        pid = -2; // taken: no other pointer starts anything
        Object.assign(two, twoAt(), { on: true });
        setCursor('');
        return;
      }
    }
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
    ray(px, py);
    const on = hit(tW);
    // The combo: where the press lands says what it does, on a mouse as under a finger. Off
    // the sphere it aims a ruler, on an edge that can be taken hold of it peels, anywhere
    // else on the film it is a knife. Shift makes it a paw. Cmd (or Ctrl) only turns the
    // sphere: with every press doing something, turning needs a key (two fingers on touch).
    let tool = world.tool, turn = false;
    if (tool === 'combo') {
      if (e.metaKey || e.ctrlKey) turn = true;
      else if (e.shiftKey && on) tool = 'scratch';
      else tool = !on ? 'ruler' : findGrab(px, py) ? 'peel' : 'knife';
    }
    if (tool === 'ruler' && !turn) {
      // The sphere holds still while a cut is aimed.
      omega.set(0, 0, 0);
      drag = 'aim';
      const a = world.aim;
      a.active = true; a.x0 = a.x1 = px; a.y0 = a.y1 = py; a.valid = false;
      setCursor('crosshair');
      return;
    }
    if (on && !turn) {
      if (tool === 'knife' || tool === 'scratch') {
        omega.set(0, 0, 0);
        drag = 'draw';
        stroke.on = false;
        stroke.painted = false;
        stroke.claws = tool === 'scratch' ? CLAWS : 0;
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
    const f = fingers.get(e.pointerId);
    if (f) { f.x = e.clientX - left; f.y = e.clientY - top; }
    if (two.on) {
      if (!f || fingers.size < 2) return;
      // their middle carried along turns the sphere as one finger off it would; the line
      // between them turned about itself turns it about the line of sight
      const now = twoAt();
      const dx = now.x - two.x, dy = now.y - two.y, len = Math.hypot(dx, dy);
      if (len > 0) {
        tA.set(dy / len, dx / len, 0);
        tQ.setFromAxisAngle(tA, len / rpx);
        world.rotation.premultiply(tQ);
      }
      let da = now.a - two.a;
      if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
      tQ.setFromAxisAngle(zAxis, -da);
      world.rotation.premultiply(tQ).normalize();
      two.x = now.x; two.y = now.y; two.a = now.a;
      return;
    }
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
    fingers.delete(e.pointerId);
    if (two.on) {
      // one finger off ends the turn; the other does nothing more until it too is lifted
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* fine */ }
      two.on = false;
      pid = -1;
      return;
    }
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
  const ui = createUi({
    tools: TOOLS,
    finishes: [FILMS, ROOTS],
    show: world.show,
    // every setting as text, to paste somewhere else
    settings: () => JSON.stringify(settings(), null, 2),
    maxFilms: FILMS_MAX,
    films: () => world.layers.map(view),
    base: () => view(world.next),
    onAddFilm: addFilm,
    onRemoveFilm: removeFilm,
    onEdit: editLook,
    onPreset: loadPreset,
    onTool: setTool,
    onBack: back,
    onRedo: redo,
    onReset: reset,
  });
  showHistory = () => ui.setHistory(history.length, ahead.length);
  showHistory();

  function setTool(t: Tool) {
    world.tool = t;
    ui.setTool(t);
  }
  setTool(world.tool);

  // The opening: the film is whole on landing, and within a second a cross is cut into it
  // by a hand nobody sees, two strokes that are never quite straight and never twice the
  // same. Somewhere to take hold, without a word of how. Not a step to undo: it is where
  // the piece starts. A press before it is done finishes it at once.
  const opening = { t: 0, done: false, begun: false, laid: [0, 0], paths: [[], []] as Vector3[][] };
  {
    const q = new Quaternion().copy(world.rotation).invert();
    const vary = () => Math.random() * 2 - 1;
    // each stroke from one end to the other as seen from the camera, in sphere radii, bowed
    // a little to one side and wavering as a hand does
    const ends: Array<[number, number, number, number]> = [
      [-0.3 + vary() * 0.04, 0.33 + vary() * 0.04, 0.34 + vary() * 0.04, -0.3 + vary() * 0.04],
      [0.36 + vary() * 0.04, 0.3 + vary() * 0.04, -0.28 + vary() * 0.04, -0.27 + vary() * 0.04],
    ];
    ends.forEach(([x0, y0, x1, y1], k) => {
      const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny);
      const bow = vary() * 0.035, wave = 0.006 + Math.random() * 0.008, f = 2 + Math.random() * 2, ph = Math.random() * 6.28;
      for (let i = 0; i < OPEN_POINTS; i++) {
        const t = i / (OPEN_POINTS - 1);
        const off = bow * Math.sin(t * Math.PI) + wave * Math.sin(ph + t * f * Math.PI);
        const x = x0 + (x1 - x0) * t + (nx / nl) * off, y = y0 + (y1 - y0) * t + (ny / nl) * off;
        opening.paths[k].push(new Vector3(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))).applyQuaternion(q));
      }
    });
  }
  /** Carry the opening on to `p` of the way (0..1); the first stroke takes the first half
   *  of it, the second the last, a beat between them. */
  function drawOpening(p: number) {
    if (opening.done) return;
    const ease = (u: number) => u * u * (3 - 2 * u);
    for (let k = 0; k < 2; k++) {
      const u = Math.min(1, Math.max(0, (p - k * 0.55) / 0.45));
      const upTo = Math.round(ease(u) * (OPEN_POINTS - 1));
      const path = opening.paths[k];
      for (let i = opening.laid[k]; i < upTo; i++) {
        if (!opening.begun) { beginStroke(); opening.begun = true; }
        paintArc(world.films, path[i].x, path[i].y, path[i].z, path[i + 1].x, path[i + 1].y, path[i + 1].z);
      }
      opening.laid[k] = Math.max(opening.laid[k], upTo);
    }
    if (p >= 1) { opening.done = true; if (opening.begun) requestRelabel(); }
  }
  /** Whatever comes instead of the opening (a bench, a step back) does without it. */
  const skipOpening = () => { opening.done = true; };

  // A fixed bench to compare feels on: whole film, the sphere turned as at the start, and
  // the same three cuts facing the camera: a line right round, a straight open cut and an
  // open U.
  /** Both benches start from here: whole films, the sphere turned as at the start, nothing
   *  in the hand. A step to undo. */
  function resetBench() {
    skipOpening();
    remember();
    peeler.clear();
    fading = 0;
    relabelDue = false;
    omega.set(0, 0, 0);
    world.rotation.setFromEuler(HOME);
    qInv.copy(world.rotation).invert();
    for (const film of world.films) fillFilm(film);
  }
  /** Start over: every film whole again and the sphere turned as at the start. No cross this
   *  time, that is only how the piece opens. A step to undo, so nothing is lost by it. */
  function reset() {
    resetBench();
    relabelNow();
  }
  /** (x, y) as seen from the camera, in sphere radii, to a point on the film. */
  const seenAt = (x: number, y: number, out: Vector3) =>
    out.set(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))).applyQuaternion(qInv);
  /** A cut through the points as seen. */
  function cutSeen(pts: Array<[number, number]>) {
    beginStroke();
    for (let i = 1; i < pts.length; i++) {
      seenAt(pts[i - 1][0], pts[i - 1][1], tA);
      seenAt(pts[i][0], pts[i][1], tB);
      paintArc(world.films, tA.x, tA.y, tA.z, tB.x, tB.y, tB.z);
    }
  }
  /** A cut right round: the plane with normal (nx, ny, 0) as seen, w from the centre. */
  function cutRound(nx: number, ny: number, w: number) {
    tC.set(nx, ny, 0).normalize().applyQuaternion(qInv);
    beginStroke();
    paintCircle(world.films, tC.x, tC.y, tC.z, w);
  }

  function bench() {
    resetBench();
    cutRound(0.12, 1, -0.42);
    cutSeen([[-0.5, 0.12], [-0.05, 0.12]]);
    cutSeen([[0.18, 0.5], [0.18, 0.08], [0.55, 0.08], [0.55, 0.5]]);
    relabelNow();
  }

  /**
   * A second bench, further in: the top film cut into bands and wedges and its middle
   * taken off, the film under it showing there with a hole of its own through to the
   * sphere and an open cut to start from. Always the same.
   */
  function bench2() {
    resetBench();
    /** Take off the piece of film `k` seen at (x, y). */
    const lift = (k: number, x: number, y: number) => {
      seenAt(x, y, tA);
      const id = idAt(world.films[k], tA.x, tA.y, tA.z);
      if (id) erasePiece(world.films[k], id);
    };
    // the top film: two bands across, two cuts down through them
    cutRound(0.1, 1, 0.34);
    cutRound(0.06, 1, -0.4);
    cutRound(1, 0.45, -0.3);
    cutRound(1, -0.55, 0.38);
    relabelNow();
    // its middle comes off, and one wedge beside it
    lift(0, 0.05, 0);
    lift(0, 0.6, 0.05);
    relabelNow();
    // the film under it, where it now shows: a closed cut, lifted out, and an open one
    cutSeen([[0.22, -0.3], [0.5, -0.24], [0.56, 0.02], [0.36, 0.2], [0.2, 0.02], [0.22, -0.3]]);
    relabelNow();
    if (world.films.length > 1) lift(1, 0.38, -0.08);
    cutSeen([[-0.2, 0.22], [-0.12, -0.05], [0.02, -0.3]]);
    relabelNow();
  }

  // ----------------------------------------------------------------------------- layers

  /** A layer as the list in the ui shows it. */
  function view(l: Layer): LayerView {
    return {
      name: l.name, color: l.color.getHex(), opacity: l.opacity, roughness: l.roughness, metalness: l.metalness,
      print: l.print, ink: l.ink.getHex(),
    };
  }

  /** The stack changed shape: nothing in the hand, no way back to before, new pieces. */
  function restack() {
    peeler.clear();
    fading = 0;
    relabelDue = false;
    history.length = 0;
    ahead.length = 0;
    showHistory();
    relabelNow();
  }

  /** A new whole film on top of the others, in a finish none of them has yet. */
  function addFilm() {
    if (world.films.length >= FILMS_MAX) return;
    let v = 0;
    while (v < FILMS.length - 1 && world.layers.some((l) => l.preset === v)) v++;
    const pieces = new Map<number, Piece>();
    initPieces(pieces);
    world.films.unshift(createFilm());
    world.layers.unshift(makeLayer(0, v));
    world.pieces.unshift(pieces);
    restack();
    ui.syncLayers();
  }

  /** Film `index` goes, whatever is left of it. The last one stays. */
  function removeFilm(index: number) {
    if (world.films.length <= 1 || index < 0 || index >= world.films.length) return;
    world.films.splice(index, 1);
    world.layers.splice(index, 1);
    world.pieces.splice(index, 1);
    restack();
    ui.syncLayers();
  }

  /** Change the look of film `index` (-1: the sphere). */
  function editLook(index: number, e: LayerEdit) {
    if (index < 0) world.next = editLayer(world.next, e);
    else if (index < world.layers.length) world.layers[index] = editLayer(world.layers[index], e);
    ui.syncLayers();
  }

  /** Load a recipe into film `index` (-1: the sphere). The top film brings its feel with it. */
  function loadPreset(index: number, variant: number) {
    if (index < 0) world.next = makeLayer(1, variant);
    else if (index < world.layers.length) {
      world.layers[index] = makeLayer(0, variant);
      if (index === 0) {
        tune.elastic = world.layers[0].elastic;
        tune.adhesion = world.layers[0].adhesion;
        ui.syncSliders();
      }
    }
    ui.syncLayers();
  }

  /** For capture scripts: recipe `variant` on top and the next ones under it (index 0), or
   *  the sphere (index 1). */
  function setFinish(index: number, variant: number) {
    if (index === 0) for (let k = world.layers.length - 1; k >= 0; k--) loadPreset(k, (variant + k) % FILMS.length);
    else loadPreset(-1, variant);
  }

  // Settings are kept between visits: the two finishes by name and every slider. A film's
  // own stretch and cling are only copied in when it is picked by hand, so what was saved
  // wins over them here.
  type Look = { preset?: string } & LayerEdit;
  const look = (l: Layer): Look => ({ preset: l.name, ...view(l) });
  const numbers = (o: unknown): LayerEdit => {
    const e: Record<string, unknown> = {}, src = (o ?? {}) as Record<string, unknown>;
    for (const k of ['color', 'opacity', 'roughness', 'metalness', 'ink']) if (typeof src[k] === 'number' && Number.isFinite(src[k])) e[k] = src[k];
    if (src.print === 'none' || src.print === 'label' || src.print === 'net') e.print = src.print;
    return e as LayerEdit;
  };
  const fromLook = (index: number, o: unknown): Layer => {
    const list = index === 0 ? FILMS : ROOTS;
    const name = (o as Look | null)?.preset;
    return editLayer(makeLayer(index, Math.max(0, list.findIndex((r) => r.name === name))), numbers(o));
  };

  /** Everything kept between visits: the stack of films with their looks, the sphere, every
   *  slider and the toggles. */
  function settings() {
    const { debug, grid } = world.show; // films hidden is a look, not a setting
    return { films: world.layers.map(look), base: look(world.next), tune, show: { debug, grid } };
  }
  function settingsNow(): string {
    return JSON.stringify(settings());
  }
  function loadSettings(): { films?: unknown; base?: unknown; film?: string; tune?: Partial<Record<keyof Tune, unknown>>; show?: { debug?: unknown; grid?: unknown } } | null {
    try { return JSON.parse(localStorage.getItem(STORE) ?? 'null'); } catch { return null; }
  }

  const saved: ReturnType<typeof loadSettings> = loadSettings() ?? DEFAULTS;
  if (Array.isArray(saved?.films) && saved.films.length >= 1) {
    // the stack as it was left: as many films, each with its look
    const want = Math.min(FILMS_MAX, saved.films.length);
    while (world.films.length < want) {
      const pieces = new Map<number, Piece>();
      initPieces(pieces);
      world.films.push(createFilm());
      world.layers.push(makeLayer(0, 0));
      world.pieces.push(pieces);
    }
    while (world.films.length > want) { world.films.pop(); world.layers.pop(); world.pieces.pop(); }
    for (let k = 0; k < want; k++) world.layers[k] = fromLook(0, saved.films[k]);
    relabelNow();
  } else if (typeof saved?.film === 'string') {
    // from before the films could be changed one by one: only the name of the top one
    setFinish(0, Math.max(0, FILMS.findIndex((f) => f.name === saved.film)));
  }
  if (saved?.base !== undefined) world.next = typeof saved.base === 'string' ? makeLayer(1, Math.max(0, ROOTS.findIndex((f) => f.name === saved.base))) : fromLook(1, saved.base);
  tune.elastic = world.layers[0].elastic;
  tune.adhesion = world.layers[0].adhesion;
  if (saved?.tune) {
    for (const k of Object.keys(tune) as Array<keyof Tune>) {
      const v = saved.tune[k];
      if (typeof v === 'number' && Number.isFinite(v)) tune[k] = v;
    }
  }
  ui.syncSliders();
  ui.syncLayers();
  if (typeof saved?.show?.debug === 'boolean') world.show.debug = saved.show.debug;
  if (typeof saved?.show?.grid === 'boolean') world.show.grid = saved.show.grid;
  ui.syncShow();
  let stored = settingsNow();
  let storeIn = 0;

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
    const i = '12345'.indexOf(e.key);
    if (i >= 0) setTool(TOOLS[i]);
    if (e.key === 'r') reset();
    if (e.key === 'b') bench();
    if (e.key === 'n') bench2();
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
    bench2,
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

      if (!opening.done) drawOpening(((opening.t += dt) - OPEN_WAIT) / OPEN_TIME);

      world.lift.ghost = tune.ghost;
      world.lift.band = tune.height;
      world.look.x = px; world.look.y = py; world.look.on = mouseIn || pid !== -1;
      if ((storeIn -= dt) <= 0) { storeIn = 0.5; storeSettings(); }
      updatePeel(dt);
      world.finger.active = peeler.active && fading <= 0;
      if (relabelDue && !peeler.active) relabelNow();
      updateHover();
    },
    resize() { measure(); },
  };
}
