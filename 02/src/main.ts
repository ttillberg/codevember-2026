// 02 Shatter. Panes of 8 mm glass, one behind the other, and a gun.
//
// Two parts. First the cracks: each bullet grows a web from its impact (cracks.ts), drawn as the crack surfaces
// inside the glass. Then, once the pane has taken too much, it is cut into shards along those same cracks
// (shards.ts), a worker bakes the fall with rigid bodies (sim.worker.ts) and the page plays it back.
import { CRACKS, Pane, type Impact } from './cracks';
import { defaults, mountPanel, setValue } from './settings';
import { STRIDE, buildShards, mergeSets, type ShardSet } from './shards';
import { Renderer, lookAt, perspective } from './render';
import { Sound } from './audio';
import { CONTACT, type BakeRequest, type FramesMessage, type SimConfig } from './sim.worker';

const params = new URLSearchParams(location.search);
// ?clean: no page furniture, the scene alone (screengrabs, clips)
if (params.has('clean')) document.body.classList.add('clean');

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const hint = document.querySelector<HTMLElement>('#hint')!;
const bakeBar = document.querySelector<HTMLElement>('#bake')!;
const bakeFill = bakeBar.querySelector<HTMLElement>('i')!;
const renderer = new Renderer(canvas);
const sound = new Sound();
const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });

// every number the workbench can turn (?debug): the scene at once, cracks from the next bullet, the sim from the next break
const V = defaults();
let settled = false; // the page is up: before that there is no pane to prepare anything for
function applySettings() {
  for (const k of Object.keys(CRACKS) as (keyof typeof CRACKS)[]) CRACKS[k] = V[k];
  CRACKS.hole = V.hole / 1000;
  const L = renderer.look;
  for (const k of Object.keys(L) as (keyof typeof L)[]) L[k] = V[k];
  if (settled) { placeTargets(); liveBtn.classList.toggle('live', V.live >= 0.5); bakeBar.querySelector('span')!.textContent = V.live >= 0.5 ? 'Simulating' : 'Baking the fall'; }
  if (settled && (V.panes !== layers.length || Math.abs(V.gap / 100 - gap) > 1e-6 || layers[layers.length - 1].tempered !== V.temper >= 0.5)) reset(); // another set-up: new panes
  else if (settled) prepareSoon(400); // the break that was got ready was for other numbers
}
const simCfg = (): SimConfig => ({ live: V.live >= 0.5 ? V.pace : 0, contacts: V.contacts, gravity: V.gravity, ballDensity: V.ballDensity, pushBack: V.pushBack, pushOut: V.pushOut, reach: V.reach, spin: V.spin, front: V.front, bounce: V.bounce, friction: V.friction, stuck: V.stuck, seconds: V.seconds });
if (params.has('realtime') || params.has('live')) V.live = 1;
if (params.has('debug') || params.has('settings') || location.hash === '#debug') mountPanel(V, applySettings);

const T = 0.008; // the glass is 8 mm thick
const Y0 = 0.03; // and stands in a channel this high
const FOV = (30 * Math.PI) / 180;
const DIST = 1.9; // how far the camera stands from the glass
const EYE_AT = 0.47; // the height it looks at

// intact: there is glass to shoot. doomed: the football is in the air. fallen: no glass is left standing.
// Falls play on their own whatever the state: a pane can lose pieces while it is being shot.
// intact: there is glass to shoot. doomed: the football is in the air. fallen: no glass is left standing.
// Falls play on their own whatever the state: a pane can lose pieces while it is being shot.
type State = 'intact' | 'doomed' | 'fallen';
let state: State = 'intact';
let seed = Number(params.get('seed')) || (Math.random() * 1e9) | 0;
let shots = 0;

/** One pane. They stand one behind the other, the first nearest: a bullet goes through all of them. */
interface Layer {
  i: number;
  z: number; // where its front stands
  pane: Pane;
  standing: boolean;
  tapes: { ax: number; ay: number; bx: number; by: number; w: number; fell: boolean }[]; // strips across it, in pane space: what is under one stays up
  tempered: boolean; // it does not crack: the first hit turns all of it to dice
  maskData: Uint8ClampedArray | null; // its part of the mask as it was when pieces last left: blue is gone
}
let layers: Layer[] = [];
let W = 1.2, H = 0.8; // the size of a pane
let gap = 0.25; // between two panes

/** What the worker sends back for one request: the frames of one fall, as they come. */
interface Bake { run: number; count: number; frames: Float32Array[]; contacts: number[]; done: boolean; total: number }
/** One fall: a set of shards, their baked frames and where the playback is. Several can play at once. */
interface Fall {
  bake: Bake; set: ShardSet; base: number; // id of its first shard in the renderer
  at: number; // when it starts, on the scene's clock
  started: boolean; over: boolean;
  playhead: number; lastHit: number; speed: number;
  ball: boolean; // the football is in this one
  near: [number, number, number][]; // where it was hit, for the dust
}
const bakes = new Map<number, Bake>();
const falls: Fall[] = [];
let run = 0;
let slow = false;
let held = -1; // a playhead to hold, for stills
const active = () => falls.some((f) => !f.over);

function bakeFall(set: ShardSet, req: Pick<BakeRequest, 'impacts' | 'balls' | 'standing'>): Bake {
  const bake: Bake = { run: ++run, count: set.count, frames: [], contacts: [], done: false, total: 1 };
  bakes.set(bake.run, bake);
  worker.postMessage({ type: 'bake', run: bake.run, bodies: set.bodies, width: W, y0: Y0, seed, cfg: simCfg(), zs: layers.map((l) => l.z), ...req } satisfies BakeRequest);
  return bake;
}
function dropBake(bake: Bake) {
  bakes.delete(bake.run);
  if (!bake.done) worker.postMessage({ type: 'cancel', run: bake.run });
}

let now = 0; // seconds, the clock of the scene
let flash = 0;
let recoil = 0;
let fade = 0;
let fadeTo = 1;
let resetAt = -1;

// the mask: holes, crushed glass and what has left, every pane's one under the other
const mask = document.createElement('canvas');
const mctx = mask.getContext('2d', { willReadFrequently: true })!;
let mw = 1, mh = 1; // one pane's part of it, in pixels

// glass dust
const DUST = Renderer.DUST;
const dPos = new Float32Array(DUST * 4);
const dVel = new Float32Array(DUST * 3);
const dLife = new Float32Array(DUST);
const dWait = new Float32Array(DUST);
let dNext = 0;
let dUsed = 0;

function newPane() {
  const aspect = innerWidth / innerHeight;
  // a wall of glass: wider than the view at the distance the camera stands, and taller than its top
  const tan = Math.tan(FOV / 2);
  W = Math.min(2.6, 2 * DIST * tan * aspect * 1.1);
  H = (EYE_AT + DIST * tan) * 1.06 - Y0;
  seed = (seed * 1664525 + 1013904223) >>> 0;
  gap = V.gap / 100;
  layers = [];
  for (let i = 0; i < Math.round(V.panes); i++) layers.push({ i, z: -i * gap, pane: new Pane(W, H, T, (seed + i * 7919) >>> 0), standing: true, tapes: [], tempered: i === Math.round(V.panes) - 1 && V.temper >= 0.5, maskData: null });
  shots = 0;
  state = 'intact';
  ball.on = false;
  clearTimeout(readyTimer); readyTimer = 0; ready = null;
  if (replay.on) setReplay(false);
  for (const b of [...bakes.values()]) dropBake(b);
  falls.length = 0;
  const s = Math.min(2048, 4096 / layers.length) / Math.max(W, H);
  mw = Math.round(W * s); mh = Math.round(H * s);
  mask.width = mw; mask.height = mh * layers.length;
  mctx.globalCompositeOperation = 'source-over';
  mctx.fillStyle = '#000'; mctx.fillRect(0, 0, mask.width, mask.height);
  renderer.setPanes(W, H, T, Y0, layers.map((l) => l.z));
  placeTargets();
  glassBtn.classList.toggle('tempered', V.temper >= 0.5);
  dPos.fill(0); dLife.fill(0); dUsed = 0;
  setHint();
}

/** Three targets on the glass: side by side on a wide wall, one over the other on a tall one. */
function placeTargets() {
  const r = Math.min(V.targets / 100, W * 0.3), wide = W > H * 0.9;
  for (let i = 0; i < 3; i++) {
    const k = (i - 1) * 0.29;
    renderer.targets.set(wide ? [W * (0.5 + k), EYE_AT - Y0 + (i === 1 ? 0.08 : 0.02), r] : [W * 0.5, EYE_AT - Y0 + k * 1.05, r], i * 3);
  }
}
// classic glass, which cracks, or tempered, which goes to dice: a new pane either way
const glassBtn = document.querySelector<HTMLButtonElement>('#glass')!;
function toggleGlass() {
  V.temper = V.temper >= 0.5 ? 0 : 1;
  setValue('temper', V.temper);
  modeTag.textContent = V.temper >= 0.5 ? 'Glass: tempered' : 'Glass: classic';
  modeTag.hidden = false;
  clearTimeout(modeTimer);
  modeTimer = window.setTimeout(() => { modeTag.hidden = true; }, 1600);
  reset();
}
glassBtn.addEventListener('click', () => { sound.wake(); toggleGlass(); });

function setHint() {
  const touch = matchMedia('(pointer: coarse)').matches;
  hint.textContent =
    replay.on ? 'Replay'
    : taping ? (touch ? 'Tape: drag across the glass, or tap' : 'Tape: drag across the glass, or click for one straight across')
    : state === 'fallen' ? (active() ? 'Hold to slow it down' : touch ? 'Tap for a new pane' : 'Click for a new pane')
    : state === 'doomed' ? ''
    : shots === 0 ? (touch ? 'Tap the glass to shoot' : 'Click the glass to shoot')
    : shots < 4 ? (touch ? 'Swipe: what is broken blows out' : 'Drag or space: what is broken blows out')
    : '';
}

// pane space to the pixels of that pane's part of the mask
const MX = (x: number) => (x / W) * mw;
const MY = (L: Layer, y: number) => L.i * mh + (1 - y / H) * mh;

function drawMask(L: Layer, im: Impact) {
  const s = mw / W, cx = MX(im.x), cy = MY(L, im.y);
  mctx.save();
  mctx.beginPath(); mctx.rect(0, L.i * mh, mw, mh); mctx.clip();
  mctx.globalCompositeOperation = 'lighter';
  // crushed glass: dense by the hole, in ragged petals
  const rand = L.pane.rand;
  const petals = 9 + Math.floor(rand() * 6);
  for (let i = 0; i < petals; i++) {
    const a = rand() * Math.PI * 2, r = im.r * (2 + rand() * rand() * 5.5);
    const g = mctx.createRadialGradient(cx, cy, im.r * s * 0.8, cx, cy, r * s);
    g.addColorStop(0, 'rgba(0,255,0,0.75)'); g.addColorStop(0.45, 'rgba(0,255,0,0.3)'); g.addColorStop(1, 'rgba(0,255,0,0)');
    mctx.fillStyle = g;
    mctx.beginPath(); mctx.moveTo(cx, cy);
    mctx.arc(cx, cy, r * s, a, a + 0.5 + rand() * 1.2);
    mctx.closePath(); mctx.fill();
  }
  // the hole, a little inside its rim so the rim keeps a lip of glass
  mctx.fillStyle = 'rgb(255,0,0)';
  mctx.beginPath();
  im.rim.forEach((n, i) => {
    const x = im.x + (L.pane.nx[n] - im.x) * 0.9, y = im.y + (L.pane.ny[n] - im.y) * 0.9;
    if (i) mctx.lineTo(MX(x), MY(L, y)); else mctx.moveTo(MX(x), MY(L, y));
  });
  mctx.closePath(); mctx.fill();
  mctx.restore();
  renderer.setMask(mask);
}

function dust(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, wait = 0) {
  const i = dNext; dNext = (dNext + 1) % DUST; dUsed = Math.max(dUsed, i + 1);
  dPos[i * 4] = x; dPos[i * 4 + 1] = y; dPos[i * 4 + 2] = z; dPos[i * 4 + 3] = 0;
  dVel[i * 3] = vx; dVel[i * 3 + 1] = vy; dVel[i * 3 + 2] = vz;
  dLife[i] = life; dWait[i] = wait;
}
const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.73;

function stepDust(dt: number) {
  const drag = Math.exp(-2.2 * dt);
  for (let i = 0; i < dUsed; i++) {
    if (dLife[i] <= 0) { dPos[i * 4 + 3] = 0; continue; }
    if (dWait[i] > 0) { dWait[i] -= dt; continue; }
    const p = i * 4, v = i * 3;
    dLife[i] -= dt * (dPos[p + 1] <= 0.003 ? 0.35 : 1);
    dVel[v] *= drag; dVel[v + 1] = dVel[v + 1] * drag - 6.5 * dt; dVel[v + 2] *= drag;
    dPos[p] += dVel[v] * dt; dPos[p + 1] += dVel[v + 1] * dt; dPos[p + 2] += dVel[v + 2] * dt;
    if (dPos[p + 1] < 0.003) { dPos[p + 1] = 0.003; dVel[v] = dVel[v + 1] = dVel[v + 2] = 0; }
    dPos[p + 3] = Math.min(1, dLife[i] * 1.5);
  }
}

/** Is there glass of this pane at x, y? Not in a bullet hole, not where pieces left. */
function glassAt(L: Layer, x: number, y: number) {
  return L.standing && x >= 0 && y >= 0 && x <= W && y <= H && !L.pane.inHole(x, y) && !goneAt(L, x, y);
}

/** A bullet along the ray through a point of the page. It goes through every pane in its way. */
function shoot(px: number, py: number) {
  if (state !== 'intact') return;
  sound.shot();
  flash = 1; recoil = 1;
  let hit = false;
  for (const L of layers) {
    const [x, y] = pick(px, py, L.z);
    if (!glassAt(L, x, y)) continue; // through a hole, or wide
    const at = now + L.i * 0.012;
    if (L.tempered) {
      // tempered: all of it goes to dice at the first hit; after that a bullet only takes a die with it
      if (!L.pane.diced) {
        const res = L.pane.dice(x, y, at, V.dice / 100);
        renderer.addCracks(L.i, L.pane, res.segs);
        drawMask(L, res.impact);
        sound.give(0.01, 0.3);
      } else {
        const im = L.pane.punch(x, y, at);
        if (im) drawMask(L, im);
      }
    } else {
      const res = L.pane.shoot(x, y, at, 0.75 + Math.random() * 0.6);
      renderer.addCracks(L.i, L.pane, res.segs);
      drawMask(L, res.impact);
      for (const t of res.ticks) sound.tick(t - now);
    }
    hit = true;
    const wx = x - W / 2, wy = y + Y0;
    for (let i = 0; i < (420 * V.dust) / layers.length; i++) {
      const back = Math.random() < 0.72;
      const sp = back ? 1.5 + Math.random() * Math.random() * 11 : 0.5 + Math.random() * 3.5;
      const cone = back ? 0.32 : 0.6;
      dust(wx + gauss() * 0.004, wy + gauss() * 0.004, L.z + (back ? -T : 0), gauss() * sp * cone, gauss() * sp * cone + 0.3, back ? -sp : sp, 0.7 + Math.random() * 2.2);
    }
  }
  if (!hit) return;
  shots++;
  setHint();
  prepareSoon();
}

/** The football, kicked hard: 30 m/s. Where and how it hits is known the moment it leaves the foot, so the
 *  panes are cracked, cut and baked while it flies. The flight is shown in slow motion (it would be over in
 *  three frames); at the glass it is back to the pace of the fall almost at once. */
const FLIGHT = 0.42;

let ballSlow = 1; // how much slower than life the flight is shown
let kickedSet: { set: ShardSet; base: number } | null = null;
let kicked: { L: Layer; set: ShardSet }[] = []; // what the ball is about to take out of each pane
const ball = { on: false, at: 0, p: [0, 0, 0], v: [0, 0, 0], w: [0, 0, 0] }; // p, v: as it reaches the glass, at time `at`
function kick(x: number, y: number) {
  if (state !== 'intact') return;
  x = Math.min(W - 0.02, Math.max(0.02, x)); y = Math.min(H - 0.02, Math.max(0.05, y));
  state = 'doomed';
  clearTimeout(readyTimer); readyTimer = 0;
  if (ready) { dropBake(ready.bake); ready = null; }
  sound.kick();
  const at = now + FLIGHT;
  const r = V.ballSize / 100;
  const hit = [x - W / 2, y + Y0, r + 0.012];
  const from = [cam.eye[0] * 0.5, 0.12, cam.eye[2] * 0.82];
  const len = Math.hypot(hit[0] - from[0], hit[1] - from[1], hit[2] - from[2]);
  const v = [((hit[0] - from[0]) / len) * V.kick, ((hit[1] - from[1]) / len) * V.kick, ((hit[2] - from[2]) / len) * V.kick];
  ballSlow = len / FLIGHT / V.kick;
  ball.on = true; ball.at = at; ball.p = hit; ball.v = v; ball.w = [-40, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16];
  // on every pane still up: a blunt blow where the ball goes through, radials all over, then everything cut small
  const parts: ShardSet[] = [];
  const impacts: [number, number, number][] = [];
  kicked = [];
  for (const L of layers) {
    if (!L.standing) continue;
    // where the ball's line meets this pane
    const k = (L.z - hit[2]) / v[2];
    const lx = Math.min(W - 0.02, Math.max(0.02, hit[0] + v[0] * k + W / 2)), ly = Math.min(H - 0.02, Math.max(0.02, hit[1] + v[1] * k - Y0));
    const gone = (loop: number[]) => loopGone(L, loop);
    if (L.tempered) {
      if (!L.pane.diced) { const res = L.pane.dice(lx, ly, at, V.dice / 100); res.impact.r = 0; renderer.addCracks(L.i, L.pane, res.segs); }
    } else {
      const res = L.pane.shoot(lx, ly, at, V.blow, true);
      res.impact.r = 0; // a ball leaves no hole of its own
      renderer.addCracks(L.i, L.pane, res.segs);
      renderer.addCracks(L.i, L.pane, L.pane.finish(at, V.shardArea / 1e4, 0.1, false, gone));
    }
    const part = buildShards(L.pane, Y0, false, gone, L.i, L.z, L.tempered, (loop) => taped(L, loop), L.i * 100);
    parts.push(part);
    kicked.push({ L, set: part });
    impacts.push([lx - W / 2, ly + Y0, L.z]);
  }
  sound.smash(FLIGHT);
  const set = mergeSets(parts);
  // cut now, seen at the impact: until then the panes are still the panes
  for (const arr of [set.walls, set.faces]) for (let i = 9; i < arr.length; i += STRIDE) arr[i] = at;
  const base = renderer.addShards(set);
  renderer.shards = true;
  kickedSet = { set, base };
  const bake = bakeFall(set, { impacts, balls: [{ p: hit, v, w: ball.w, r }] });
  setReplay(false);
  falls.push({ bake, set, base, at, started: false, over: false, playhead: 0, lastHit: 0, speed: ballSlow, ball: true, near: impacts });
  trimFrames();
  setHint();
}

// what has left a pane in an earlier fall, read off its part of the mask (blue)
function goneAt(L: Layer, x: number, y: number) {
  if (!L.maskData) return false;
  const px = Math.floor(MX(x)), py = Math.floor((1 - y / H) * mh);
  if (px < 0 || py < 0 || px >= mw || py >= mh) return true;
  return L.maskData[(py * mw + px) * 4 + 2] > 127;
}
/** Is this face of a pane's crack graph one that already fell? Asked just inside a few of its edges. */
function loopGone(L: Layer, loop: number[], p: Pane = L.pane) {
  if (!L.maskData) return false;
  const n = loop.length, step = Math.max(1, Math.floor(n / 7));
  let yes = 0, all = 0;
  for (let i = 0; i < n; i += step) {
    const a = loop[i], b = loop[(i + 1) % n];
    const ax = p.nx[a], ay = p.ny[a], bx = p.nx[b], by = p.ny[b];
    const l = Math.hypot(bx - ax, by - ay);
    if (l < 1e-5) continue;
    // the inside of a counter-clockwise loop is on the left
    if (goneAt(L, (ax + bx) / 2 - ((by - ay) / l) * 0.0015, (ay + by) / 2 + ((bx - ax) / l) * 0.0015)) yes++;
    all++;
  }
  return all > 0 && yes * 2 > all;
}

/** Which strip of tape is this face under, if any? Under one it is held: with the pane, or with the strip. */
function taped(L: Layer, loop: number[], p: Pane = L.pane) {
  if (!L.tapes.length) return -1;
  let cx = 0, cy = 0;
  for (const n of loop) { cx += p.nx[n]; cy += p.ny[n]; }
  cx /= loop.length; cy /= loop.length;
  for (let k = 0; k < L.tapes.length; k++) {
    const t = L.tapes[k];
    if (t.fell) continue;
    const dx = t.bx - t.ax, dy = t.by - t.ay;
    if (Math.abs((cx - t.ax) * dy - (cy - t.ay) * dx) / Math.hypot(dx, dy) < t.w / 2) return k;
  }
  return -1;
}
/** The four corners of a strip, in the world and in pane space: its line, cut to the pane. */
function tapeQuad(L: Layer, t: Layer['tapes'][number]) {
  const dx = t.bx - t.ax, dy = t.by - t.ay, l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l;
  let t0 = -1e9, t1 = 1e9;
  if (Math.abs(ux) > 1e-6) { const a = (0 - t.ax) / ux, b = (W - t.ax) / ux; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b)); }
  if (Math.abs(uy) > 1e-6) { const a = (0 - t.ay) / uy, b = (H - t.ay) / uy; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b)); }
  if (t1 <= t0) return null;
  const nx = (-uy * t.w) / 2, ny = (ux * t.w) / 2;
  const q: number[] = [], uv: number[] = [];
  for (const [k, s] of [[t0, -1], [t1, -1], [t1, 1], [t0, 1]]) {
    const x = t.ax + ux * k + nx * s, y = t.ay + uy * k + ny * s;
    q.push(x - W / 2, y + Y0, L.z + 0.0008); uv.push(x, y);
  }
  return { q, uv };
}
function showTapes() {
  const strips: { q: number[]; uv: number[] }[] = [];
  for (const L of layers) for (const t of L.tapes) { const s = t.fell ? null : tapeQuad(L, t); if (s) strips.push(s); }
  renderer.setTapes(strips);
}
/** The strips that go down in a fall: from now on each rides one of its shards. */
function dropTapes(set: ShardSet, base: number) {
  for (const g of set.groups) {
    const L = layers[Math.floor(g.group / 100)], t = L?.tapes[g.group % 100];
    if (!t || t.fell) continue;
    const s = tapeQuad(L, t);
    t.fell = true;
    if (s) renderer.addFallenTape(s.q.map((v, i) => v - g.c[i % 3]), s.uv, base + g.id);
  }
  showTapes();
}
/** A strip of tape straight across every pane that stands, along the line through two points of the glass. */
function layTape(ax: number, ay: number, bx: number, by: number) {
  if (state !== 'intact' || Math.hypot(bx - ax, by - ay) < 1e-4) return;
  for (const L of layers) if (L.standing && L.tapes.length < 99) L.tapes.push({ ax, ay, bx, by, w: V.tape / 100, fell: false });
  showTapes();
  sound.tick(0);
  prepareSoon(60);
}

/** The break, got ready ahead. As soon as a bullet has hit, what a shock would do now is worked out on copies
 *  of the panes (the real ones can still be shot) and the worker starts baking that fall. A swipe then only
 *  has to play it. Another bullet, or another setting, and it is thrown away and prepared again. */
interface Ready { parts: { L: Layer; pane: Pane; set: ShardSet }[]; set: ShardSet; impacts: [number, number, number][]; shots: number; bake: Bake }
let ready: Ready | null = null;
let readyTimer = 0;
function prepare() {
  clearTimeout(readyTimer);
  readyTimer = 0;
  if (ready) { dropBake(ready.bake); ready = null; }
  if (state !== 'intact') return;
  const parts: Ready['parts'] = [];
  const impacts: [number, number, number][] = [];
  const never = 1e9; // the new cuts are inside pieces that leave: they are only ever seen as shard edges
  for (const L of layers) {
    if (!L.standing || !L.pane.impacts.length) continue;
    const copy = L.pane.clone();
    const gone = (loop: number[]) => loopGone(L, loop, copy);
    const held = (loop: number[]) => taped(L, loop, copy);
    if (!L.tempered) copy.finish(never, V.shardArea / 1e4, 0, true, (loop) => gone(loop) || held(loop) >= 0); // (dice are small enough as they are)
    const set = buildShards(copy, Y0, true, gone, L.i, L.z, L.tempered, held, L.i * 100);
    if (!set.count) continue;
    parts.push({ L, pane: copy, set });
    for (const im of L.pane.impacts) impacts.push([im.x - W / 2, im.y + Y0, L.z]);
  }
  if (!parts.length) return;
  const r = V.ballSize / 100;
  const balls = impacts.map(([x, y, z]) => ({ p: [x, y, z + r + 0.012], v: [(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, -V.kick], w: [0, 0, 0], r }));
  const set = mergeSets(parts.map((p) => p.set));
  ready = { parts, set, impacts, shots, bake: bakeFall(set, { impacts, balls, standing: true }) };
}
/** A moment after the bullet, not in its frame: the crack must not stutter for it. */
function prepareSoon(ms = 140) {
  clearTimeout(readyTimer);
  readyTimer = 0;
  if (ready) { dropBake(ready.bake); ready = null; }
  if (V.live >= 0.5) return; // live: nothing is worked out before it happens
  readyTimer = window.setTimeout(prepare, ms);
}

/** A swipe: a shock, at once. Only what is already broken goes: the pieces the cracks have cut out of the
 *  panes are cut smaller and blown out the back, as if a ball nobody sees went through every bullet hole at the
 *  same instant. The glass around them, cracked or not, stays standing. */
function shock(): boolean {
  if (state !== 'intact') return false;
  if (!ready || ready.shots !== shots || readyTimer) prepare(); // swiped before it was got ready
  if (!ready) return false; // nothing is broken yet
  const r = ready;
  ready = null;
  sound.smash(0);
  const base = renderer.addShards(r.set);
  renderer.shards = true;
  dropTapes(r.set, base);
  for (const part of r.parts) {
    // the copy, with its pieces cut, is the pane from here on
    part.L.pane = part.pane;
    cutPane(part.L, part.set);
    part.L.standing = part.set.kept;
    renderer.setStanding(part.L.i, part.set.kept);
  }
  // with glass still standing it can all be done again at once: more bullets, another shock
  state = layers.some((l) => l.standing) ? 'intact' : 'fallen';
  setReplay(false);
  falls.push({ bake: r.bake, set: r.set, base, at: now, started: false, over: false, playhead: 0, lastHit: 0, speed: V.pace, ball: false, near: r.impacts });
  trimFrames();
  setHint();
  return true;
}

/** The moment the pieces leave: they are cut out of the pane that stays (blue in the mask), and of its cracks
 *  only those with standing glass on one side at least are kept. */
function cutPane(L: Layer, set: ShardSet) {
  const p = L.pane;
  mctx.save();
  mctx.beginPath(); mctx.rect(0, L.i * mh, mw, mh); mctx.clip();
  mctx.globalCompositeOperation = 'lighter';
  mctx.fillStyle = 'rgb(0,0,255)';
  for (const loop of set.cut) {
    mctx.beginPath();
    for (let i = 0; i < loop.length; i += 2) { const x = MX(loop[i]), y = MY(L, loop[i + 1]); if (i) mctx.lineTo(x, y); else mctx.moveTo(x, y); }
    mctx.closePath(); mctx.fill();
  }
  mctx.restore();
  renderer.setMask(mask);
  // a crack stays only if there is standing glass on one side of it at least. Asked of the mask itself, a
  // millimetre and a half to each side: that also takes the cracks that ended inside a piece that left
  const img = L.maskData = mctx.getImageData(0, L.i * mh, mw, mh).data;
  const left = (x: number, y: number) => {
    const px = Math.floor(MX(x)), py = Math.floor((1 - y / H) * mh);
    if (px < 0 || py < 0 || px >= mw || py >= mh) return true;
    const i = (py * mw + px) * 4;
    return img[i] > 127 || img[i + 2] > 127;
  };
  renderer.rebuildCracks(L.i, p, (a, b) => {
    const ax = p.nx[a], ay = p.ny[a], bx = p.nx[b], by = p.ny[b];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    const ox = (-(by - ay) / l) * 0.0015, oy = ((bx - ax) / l) * 0.0015;
    for (const k of [0.5, 0.2, 0.8]) {
      const mx = ax + (bx - ax) * k, my = ay + (by - ay) * k;
      if (!left(mx + ox, my + oy) || !left(mx - ox, my - oy)) return false;
    }
    return true;
  });
}

/** The ball before it hits: a throw, backwards from where it will land. */
function flyBall() {
  // not clamped at the glass: if the bake is a few frames late the ball carries on rather than wait for it
  const t = (now - ball.at) * ballSlow;
  const p = renderer.ball.p, q = renderer.ball.q;
  p[0] = ball.p[0] + ball.v[0] * t; p[1] = ball.p[1] + ball.v[1] * t; p[2] = ball.p[2] + ball.v[2] * t;
  const a = ball.w[0] * t * 0.5;
  q[0] = Math.sin(a); q[1] = 0; q[2] = 0; q[3] = Math.cos(a);
}

worker.onmessage = (e: MessageEvent<FramesMessage>) => {
  const m = e.data;
  const bake = bakes.get(m.run);
  if (m.type !== 'frames' || !bake) return;
  const n = (bake.count + 1) * 7;
  for (let i = 0; i < m.count; i++) bake.frames.push(m.data.subarray(i * n, (i + 1) * n));
  for (let i = 0; i < m.contacts.length; i++) bake.contacts.push(m.contacts[i]);
  bake.total = m.total;
  if (m.done) bake.done = true;
};

function startFall(f: Fall) {
  f.started = true;
  recoil = 1.6;
  // the ball did not wait for the bake: the fall catches up with it
  if (f.ball) f.playhead = Math.max(0, now - f.at) * ballSlow; else flash = 0.35;
  // dust comes off every crack as the glass lets go
  for (let i = 0; i < 3200 * V.dust * Math.min(1, f.set.count / 400); i++) {
    const b = f.set.bodies[(Math.random() * f.set.count) | 0];
    let d = Infinity;
    for (const [ix, iy] of f.near) d = Math.min(d, Math.hypot(b.c[0] - ix, b.c[1] - iy));
    dust(b.c[0] + gauss() * 0.02, b.c[1] + gauss() * 0.02, b.c[2], gauss() * 0.5, gauss() * 0.5, gauss() * 0.8 - 1.2 * Math.exp(-d / 0.25) * 4, 1 + Math.random() * 2.5, d / 7 + Math.random() * 0.1);
  }
}

/** A fall that rests needs its frames no more, but for the latest one: that is the one a replay plays. */
function trimFrames() {
  for (let i = 0; i < falls.length - 1; i++) if (falls[i].over) falls[i].bake.frames = [];
}

// ---------------------------------------------------------------- replay
// On demand: the latest fall again, slowly, seen from the side, with its contacts over time as a chart and
// the playhead on it to drag.
const SPEEDS = [0.05, 0.1, 0.2, 0.5, 1];
const replay = { on: false, t: 0, playing: true, speed: 0.2, scrub: false, next: 0, side: 0, bins: 0, drawn: -1 };
const rpBox = document.querySelector<HTMLElement>('#replay')!;
const rpTrack = document.querySelector<HTMLElement>('#rp-track')!;
const rpChart = document.querySelector<HTMLCanvasElement>('#rp-chart')!;
const rpHead = document.querySelector<HTMLElement>('#rp-head')!;
const rpPlay = document.querySelector<HTMLButtonElement>('#rp-play')!;
const rpSpeed = document.querySelector<HTMLButtonElement>('#rp-speed')!;
const rpTime = document.querySelector<HTMLElement>('#rp-time')!;
const filmBtn = document.querySelector<HTMLButtonElement>('#film')!;

/** The fall a replay shows: the latest one that has started and still has its frames. */
function replayFall(): Fall | null {
  for (let i = falls.length - 1; i >= 0; i--) if (falls[i].started && falls[i].bake.frames.length > 1) return falls[i];
  return null;
}
function setReplay(on: boolean) {
  const f = replayFall();
  if (on && !f) return;
  replay.on = on;
  filmBtn.classList.toggle('on', on);
  rpBox.hidden = !on;
  if (on) { replay.t = 0; replay.next = 0; replay.playing = true; replay.drawn = -1; rpPlay.classList.remove('paused'); }
  else if (f) {
    // back to where it was: at rest if it had come to rest, else on with the fall from here
    const frames = f.bake.frames, last = frames.length - 1;
    if (f.over) { renderer.setPose(frames[last], frames[last], 0, f.base, f.set.count); if (f.ball) placeBall(f, frames[last], frames[last], 0); }
    else { f.playhead = replay.t; f.lastHit = contactAt(f, replay.t * 60); }
  }
  setHint();
}
/** Index of the first contact at or after a frame. */
function contactAt(f: Fall, frame: number) {
  const c = f.bake.contacts;
  let i = 0;
  while (i < c.length && c[i] < frame) i += CONTACT;
  return i;
}
function placeBall(f: Fall, fa: Float32Array, fb: Float32Array, k: number) {
  const o = f.set.count * 7;
  for (let c = 0; c < 3; c++) renderer.ball.p[c] = fa[o + c] + (fb[o + c] - fa[o + c]) * k;
  for (let c = 0; c < 4; c++) renderer.ball.q[c] = fa[o + 3 + c];
}
/** The contacts of a fall as bars over time: how much glass met something, how hard. Floor light, glass on glass lighter. */
function drawChart(f: Fall) {
  const frames = f.bake.frames.length, c = f.bake.contacts;
  const dpr = Math.min(window.devicePixelRatio, 2);
  const cw = Math.max(1, Math.round(rpTrack.clientWidth * dpr)), ch = Math.max(1, Math.round(rpTrack.clientHeight * dpr));
  if (rpChart.width !== cw || rpChart.height !== ch) { rpChart.width = cw; rpChart.height = ch; }
  const g = rpChart.getContext('2d')!;
  g.clearRect(0, 0, cw, ch);
  const bw = Math.max(2, Math.round(3 * dpr)), n = Math.floor(cw / bw);
  const floor = new Float32Array(n), glass = new Float32Array(n);
  let max = 1e-6;
  for (let i = 0; i < c.length; i += CONTACT) {
    const b = Math.min(n - 1, Math.floor((c[i] / Math.max(1, frames)) * n));
    const v = c[i + 5] * Math.sqrt(c[i + 4]);
    if (c[i + 6] === 1) glass[b] += v; else floor[b] += v;
  }
  for (let b = 0; b < n; b++) max = Math.max(max, floor[b] + glass[b]);
  g.fillStyle = 'rgba(244,244,242,0.14)';
  g.fillRect(0, ch - Math.max(1, dpr), cw, Math.max(1, dpr));
  for (let b = 0; b < n; b++) {
    // (a root: one loud frame must not flatten the rest of the chart)
    const hf = Math.sqrt(floor[b] / max) * (ch - 2), hg = Math.sqrt((floor[b] + glass[b]) / max) * (ch - 2) - hf;
    g.fillStyle = 'rgba(244,244,242,0.85)';
    g.fillRect(b * bw, ch - hf, bw - Math.max(1, dpr * 0.75), hf);
    g.fillStyle = 'rgba(244,244,242,0.4)';
    g.fillRect(b * bw, ch - hf - hg, bw - Math.max(1, dpr * 0.75), hg);
  }
  replay.drawn = c.length + frames * 1e-6;
}
/** The replay drives its fall: time runs at the chosen speed, or goes where the playhead is dragged. */
function stepReplay(f: Fall, dt: number) {
  const frames = f.bake.frames, contacts = f.bake.contacts;
  const last = frames.length - 1, dur = last / 60;
  const before = replay.t;
  if (replay.playing && !replay.scrub) { replay.t += dt * replay.speed; if (replay.t > dur) { replay.t = 0; replay.next = 0; } }
  replay.t = Math.max(0, Math.min(dur, replay.t));
  const fr = replay.t * 60, i = Math.min(last, Math.floor(fr));
  const fa = frames[i], fb = frames[Math.min(last, i + 1)], k = fr - i;
  renderer.setPose(fa, fb, k, f.base, f.set.count);
  if (f.ball) placeBall(f, fa, fb, k);
  // its sounds, as time passes them forwards; a jump is silent
  if (replay.t < before || replay.t - before > 0.2) replay.next = contactAt(f, fr);
  let played = 0;
  for (; replay.next < contacts.length && contacts[replay.next] <= i; replay.next += CONTACT) {
    if (played++ >= 12) continue;
    const c = replay.next;
    sound.clink(contacts[c + 4], contacts[c + 5], contacts[c + 6], contacts[c + 1] / (W * 0.6), Math.max(0.25, replay.speed));
  }
  if (replay.drawn !== contacts.length + frames.length * 1e-6) drawChart(f);
  rpHead.style.left = `${(replay.t / Math.max(1e-6, dur)) * 100}%`;
  rpTime.textContent = `${replay.t.toFixed(2)} s`;
}
const scrubTo = (e: PointerEvent) => {
  const f = replayFall();
  if (!f) return;
  const r = rpTrack.getBoundingClientRect();
  replay.t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * ((f.bake.frames.length - 1) / 60);
};
rpTrack.addEventListener('pointerdown', (e) => { sound.wake(); replay.scrub = true; rpTrack.setPointerCapture(e.pointerId); scrubTo(e); });
rpTrack.addEventListener('pointermove', (e) => { if (replay.scrub) scrubTo(e); });
rpTrack.addEventListener('pointerup', () => { replay.scrub = false; });
rpTrack.addEventListener('pointercancel', () => { replay.scrub = false; });
rpPlay.addEventListener('click', () => { replay.playing = !replay.playing; rpPlay.classList.toggle('paused', !replay.playing); });
rpSpeed.addEventListener('click', () => {
  replay.speed = SPEEDS[(SPEEDS.indexOf(replay.speed) + 1) % SPEEDS.length];
  rpSpeed.textContent = `${replay.speed}×`;
});
filmBtn.addEventListener('click', () => { sound.wake(); setReplay(!replay.on); });

/** Every fall that is under way, one step on. */
function stepFalls(dt: number) {
  const shown = replay.on ? replayFall() : null;
  if (replay.on && !shown) setReplay(false);
  for (const f of falls) {
    if (f === shown) { stepReplay(f, dt); continue; }
    if (f.over) continue;
    const { frames, contacts } = f.bake;
    if (!f.started) { if (now >= f.at && (f.bake.done || frames.length > (V.live >= 0.5 ? 0 : 5))) startFall(f); else continue; }
    f.speed += ((slow ? V.slow : V.pace) - f.speed) * Math.min(1, dt * 10);
    f.playhead += dt * f.speed;
    if (held >= 0 && f === falls[falls.length - 1]) f.playhead = held;
    const last = frames.length - 1;
    let fr = f.playhead * 60;
    if (fr > last) { fr = last; f.playhead = last / 60; }
    const i = Math.floor(fr);
    const fa = frames[i], fb = frames[Math.min(last, i + 1)], k = fr - i;
    renderer.setPose(fa, fb, k, f.base, f.set.count);
    if (f.ball) placeBall(f, fa, fb, k);
    // the contacts the simulation noted, as the playhead passes them: each is a sound of its own size, strength and place
    let played = 0;
    for (; f.lastHit < contacts.length && contacts[f.lastHit] <= i; f.lastHit += CONTACT) {
      if (played++ >= 12) continue; // (a jump of the playhead: do not play a second's worth at once)
      const c = f.lastHit;
      sound.clink(contacts[c + 4], contacts[c + 5], contacts[c + 6], contacts[c + 1] / (W * 0.6), Math.max(0.25, f.speed / V.pace));
    }
    if (f.bake.done && i >= last && held < 0) { f.over = true; bakes.delete(f.bake.run); trimFrames(); setHint(); }
  }
}

// ---------------------------------------------------------------- camera
let w = 0, h = 0;
let zoom = 1, zoomTo = 1;
const focus = [0, 0.4, 0];
const cam: { eye: number[]; view: Float32Array; proj: Float32Array } = { eye: [0, 0.5, 2], view: new Float32Array(16), proj: new Float32Array(16) };

function updateCamera(t: number, dt: number) {
  const aspect = w / h;
  const tan = Math.tan(FOV / 2);
  const dist = DIST;
  const home = [0, EYE_AT, 0];
  const k = 1 - 1 / zoom;
  const target = [home[0] + (focus[0] - home[0]) * k, home[1] + (focus[1] - home[1]) * k, 0];
  const d = dist / zoom;
  // the pointer never moves the camera: only a slow sway of its own, and the wheel
  const yaw = Math.sin(t * 0.21) * 0.035 * V.sway;
  const pitch = 0.04 + Math.sin(t * 0.17 + 1) * 0.012 * V.sway + recoil * recoil * 0.012;
  cam.eye = [target[0] + Math.sin(yaw) * Math.cos(pitch) * d, Math.max(0.04, target[1] + Math.sin(pitch) * d), Math.cos(yaw) * Math.cos(pitch) * d];
  // the replay is watched from the side: the panes edge on, and the room behind them where the glass goes
  replay.side += ((replay.on ? 1 : 0) - replay.side) * Math.min(1, dt * 5);
  if (replay.side > 0.001) {
    const e = replay.side * replay.side * (3 - 2 * replay.side);
    const back = layers.length ? layers[layers.length - 1].z : 0;
    const st = [0, Y0 + H * 0.42, back - 0.55];
    // far enough to see the glass land, but inside the room: on a tall screen the view is cropped instead
    const sd = Math.min(4.2, Math.max((H * 1.5) / (2 * tan), 2.9 / (2 * tan * aspect)));
    const se = [sd, Y0 + H * 0.5, st[2] + 0.25];
    for (let c = 0; c < 3; c++) { cam.eye[c] += (se[c] - cam.eye[c]) * e; target[c] += (st[c] - target[c]) * e; }
  }
  cam.view = lookAt(cam.eye, target, [recoil * 0.004, 1, 0]);
  cam.proj = perspective(FOV, aspect, 0.03, 40);
}

/** Where the ray through a point of the page meets a pane standing at z, in pane space. */
function pick(px: number, py: number, z = 0): [number, number] {
  const v = cam.view;
  const tan = Math.tan(FOV / 2);
  const nx = ((px / w) * 2 - 1) * tan * (w / h), ny = (1 - (py / h) * 2) * tan;
  const dx = v[0] * nx + v[1] * ny - v[2], dy = v[4] * nx + v[5] * ny - v[6], dz = v[8] * nx + v[9] * ny - v[10];
  const t = (z - cam.eye[2]) / dz;
  return [cam.eye[0] + dx * t + W / 2, cam.eye[1] + dy * t - Y0];
}

/** A point of the front pane, in pane space, to where it is on the page. */
function toPage(x: number, y: number): [number, number] {
  const m = cam.view, p = cam.proj;
  const wx = x - W / 2, wy = y + Y0;
  const vx = m[0] * wx + m[4] * wy + m[12], vy = m[1] * wx + m[5] * wy + m[13], vz = m[2] * wx + m[6] * wy + m[14];
  return [((p[0] * vx) / -vz * 0.5 + 0.5) * w, (0.5 - (p[5] * vy) / -vz * 0.5) * h];
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 2);
  w = window.innerWidth; h = window.innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  renderer.resize(canvas.width, canvas.height);
}

// ---------------------------------------------------------------- input
function reset() {
  if (resetAt >= 0) return;
  fadeTo = 0; resetAt = now + 0.28;
}

// The simulation either way. Cached: the fall is baked ahead, as fast as the worker will go, and played from
// memory. Live: the worker steps it at the pace it is shown, and every frame is drawn as it comes: nothing is
// known before it happens, and a fall too heavy for the machine runs slow instead of smooth.
const liveBtn = document.querySelector<HTMLButtonElement>('#live')!;
const modeTag = document.querySelector<HTMLElement>('#mode')!;
let modeTimer = 0;
function setLive(on: boolean, say = true) {
  V.live = on ? 1 : 0;
  setValue('live', V.live);
  liveBtn.classList.toggle('live', on);
  bakeBar.querySelector('span')!.textContent = on ? 'Simulating' : 'Baking the fall';
  if (say) {
    modeTag.textContent = on ? 'Simulation: live' : 'Simulation: cached';
    modeTag.hidden = false;
    clearTimeout(modeTimer);
    modeTimer = window.setTimeout(() => { modeTag.hidden = true; }, 1600);
  }
  if (settled) prepareSoon(60);
}
liveBtn.addEventListener('click', () => { sound.wake(); setLive(V.live < 0.5); });

let taping = false; // the next press on the glass lays tape
const tapeBtn = document.querySelector<HTMLButtonElement>('#tape')!;
function setTaping(on: boolean) { taping = on && state === 'intact'; tapeBtn.classList.toggle('on', taping); canvas.style.cursor = taping ? 'cell' : ''; setHint(); }
tapeBtn.addEventListener('click', () => { sound.wake(); setTaping(!taping); });

// A press that stays put is a bullet, one that travels is the shock. While glass is falling, a press that is
// held, without moving, slows it down instead.
let down: { x: number; y: number; id: number; far: number; held: boolean; timer: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  sound.wake();
  if (state === 'doomed' || replay.on) return;
  if (state === 'fallen' && !active()) { reset(); return; }
  canvas.setPointerCapture(e.pointerId);
  const d: NonNullable<typeof down> = { x: e.clientX, y: e.clientY, id: e.pointerId, far: 0, held: false, timer: 0 };
  down = d;
  if (state === 'fallen') { d.held = true; slow = true; }
  else if (active()) d.timer = window.setTimeout(() => { if (down === d && d.far < 14 && active()) { d.held = true; slow = true; } }, 240);
});
canvas.addEventListener('pointermove', (e) => {
  if (down && down.id === e.pointerId) down.far = Math.max(down.far, Math.hypot(e.clientX - down.x, e.clientY - down.y));
});
const release = (e: PointerEvent) => {
  if (!down || down.id !== e.pointerId) return;
  const d = down;
  down = null;
  clearTimeout(d.timer);
  slow = false;
  if (e.type !== 'pointerup' || state !== 'intact') return;
  const far = Math.max(d.far, Math.hypot(e.clientX - d.x, e.clientY - d.y));
  if (taping) {
    // a drag is a strip along it; a tap, one straight across at that height
    const [ax, ay] = pick(d.x, d.y);
    const [bx, by] = far < 14 ? [ax + 1, ay] : pick(e.clientX, e.clientY);
    layTape(ax, ay, bx, by);
    setTaping(false);
    return;
  }
  if (d.held && far < 40) return; // it was a hold. (A slow start to a swipe is still a swipe.)
  if (far < 14) shoot(d.x, d.y);
  else if (far > 40) shock();
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
window.addEventListener('pointermove', (e) => {
  // (the pointer only says where a zoom will go)
  if (e.pointerType !== 'mouse' || down) return;
  if (zoom < 1.02) { const [x, y] = pick(e.clientX, e.clientY); focus[0] = x - W / 2; focus[1] = y + Y0; }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (zoomTo <= 1.001 && e.deltaY < 0) { const [x, y] = pick(e.clientX, e.clientY); focus[0] = Math.max(-W / 2, Math.min(W / 2, x - W / 2)); focus[1] = Math.max(0, Math.min(H + Y0, y + Y0)); }
  zoomTo = Math.max(1, Math.min(7, zoomTo * Math.exp(-e.deltaY * 0.0015)));
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey) return;
  if (e.code === 'Space') {
    e.preventDefault();
    sound.wake();
    // space is the swipe; with nothing to break, it slows what is falling
    if (replay.on) { rpPlay.click(); return; }
    if (state === 'intact') { if (!shock() && active()) slow = true; }
    else if (state === 'fallen') { if (active()) slow = true; else reset(); }
  } else if (e.code === 'KeyR') reset();
  else if (e.code === 'KeyS') setReplay(!replay.on);
  else if (e.code === 'KeyT') setTaping(!taping);
  else if (e.code === 'KeyC') setLive(V.live < 0.5);
  else if (e.code === 'KeyG') toggleGlass();
  else if (e.code === 'Escape') setReplay(false);
  else if (e.code === 'KeyM') toggleSound();
  else if (e.code === 'KeyB') toggleBall();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') slow = false; });

// the ball can be left out of the picture: the glass then bursts by itself
let showBall = !params.has('noball');
try { if (localStorage.getItem('codevember-02-ball') === '0') showBall = false; } catch { /* no storage */ }
const ballBtn = document.querySelector<HTMLButtonElement>('#ball')!;
function toggleBall() {
  showBall = !showBall;
  ballBtn.classList.toggle('off', !showBall);
  try { localStorage.setItem('codevember-02-ball', showBall ? '1' : '0'); } catch { /* no storage */ }
}
ballBtn.classList.toggle('off', !showBall);
ballBtn.addEventListener('click', toggleBall);

const soundBtn = document.querySelector<HTMLButtonElement>('#sound')!;
function toggleSound() {
  sound.wake();
  sound.setMuted(!sound.muted);
  soundBtn.classList.toggle('off', sound.muted);
}
soundBtn.addEventListener('click', toggleSound);
document.querySelector<HTMLButtonElement>('#again')!.addEventListener('click', () => { sound.wake(); reset(); });
document.querySelector<HTMLButtonElement>('#break')!.addEventListener('click', () => {
  sound.wake();
  if (state === 'intact') kick(W * 0.5, H * 0.5);
});

// ---------------------------------------------------------------- frame
let prev = 0;
function frame(ms: number) {
  const dt = Math.min(0.05, (ms - prev) / 1000 || 0.016);
  prev = ms;
  now += dt;
  flash *= Math.exp(-dt / 0.045);
  recoil *= Math.exp(-dt / 0.09);
  zoom += (zoomTo - zoom) * Math.min(1, dt * 9);
  fade += (fadeTo - fade) * Math.min(1, dt * 12);
  if (resetAt >= 0 && now > resetAt) { resetAt = -1; newPane(); fadeTo = 1; zoomTo = 1; }

  // the football arrives: the pane is its shards from this frame on, whether the bake is there yet or not
  if (state === 'doomed' && now >= ball.at) {
    for (const k of kicked) {
      // what tape holds is still pane: the rest is cut out of it. With no tape the pane is gone
      if (k.set.kept) cutPane(k.L, k.set);
      k.L.standing = k.set.kept; renderer.setStanding(k.L.i, k.set.kept);
    }
    kicked = [];
    if (kickedSet) { dropTapes(kickedSet.set, kickedSet.base); kickedSet = null; }
    state = layers.some((l) => l.standing) ? 'intact' : 'fallen';
    setHint();
  }
  renderer.ball.on = ball.on && showBall;
  renderer.ball.r = V.ballSize / 100;
  if (ball.on && !falls.some((f) => f.ball && f.started)) flyBall();
  stepFalls(dt);
  stepDust(slow && active() ? dt * (V.slow / V.pace) : dt);
  renderer.setDust(dPos, dUsed);

  // how far the bake is, while it runs
  const baking = [...bakes.values()].find((b) => !b.done);
  bakeBar.hidden = !baking || replay.on;
  if (baking) bakeFill.style.transform = `scaleX(${Math.min(1, baking.frames.length / baking.total)})`;

  updateCamera(now, dt);
  renderer.draw(cam.view, cam.proj, cam.eye, now, now, flash, fade, dUsed);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
newPane();
settled = true;
setLive(V.live >= 0.5, false);
resize();
requestAnimationFrame(frame);

// for the console, and for whoever films it
Object.assign(window, {
  shatter: {
    /** a bullet through a point of the front pane, 0…1 across and up */
    shoot: (u: number, v: number) => { const p = toPage(u * W, v * H); shoot(p[0], p[1]); },
    kick: (u: number, v: number) => kick(u * W, v * H), reset,
    shock,
    replay: (on = true) => setReplay(on),
    get replayAt() { return replay.t; }, set replayAt(t: number) { replay.t = t; replay.playing = false; },
    seek: (t: number) => { held = t; },
    get state() { return state; },
    get info() {
      const b = ready?.bake ?? falls[falls.length - 1]?.bake;
      return { live: V.live >= 0.5, state, shots, panes: layers.map((l) => (l.standing ? l.pane.impacts.length : -1)), falls: falls.length, active: falls.filter((f) => !f.over).length, ready: !!ready, shards: b?.count, frames: b?.frames.length, bakeDone: b?.done, contacts: (b?.contacts.length ?? 0) / CONTACT };
    },
    /** the contacts of the latest bake, for a look: [frame, x, y, z, size, strength, kind] each */
    get contacts() {
      const c = (ready?.bake ?? falls[falls.length - 1]?.bake)?.contacts ?? [];
      const out: number[][] = [];
      for (let i = 0; i < c.length; i += CONTACT) out.push(c.slice(i, i + CONTACT));
      return out;
    },
  },
});
