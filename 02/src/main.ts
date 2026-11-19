// 02 Shatter. A pane of 8 mm glass and a gun.
//
// Two parts. First the cracks: each bullet grows a web from its impact (cracks.ts), drawn as the crack surfaces
// inside the glass. Then, once the pane has taken too much, it is cut into shards along those same cracks
// (shards.ts), a worker bakes the fall with rigid bodies (sim.worker.ts) and the page plays it back.
import { Pane, type Impact } from './cracks';
import { buildShards, type ShardSet } from './shards';
import { Renderer, lookAt, perspective } from './render';
import { Sound } from './audio';
import type { BakeRequest, FramesMessage } from './sim.worker';

const params = new URLSearchParams(location.search);
// ?clean: no page furniture, the scene alone (screengrabs, clips)
if (params.has('clean')) document.body.classList.add('clean');

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const hint = document.querySelector<HTMLElement>('#hint')!;
const renderer = new Renderer(canvas);
const sound = new Sound();
const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });

const T = 0.008; // the glass is 8 mm thick
const Y0 = 0.03; // and stands in a channel this high
const FOV = (30 * Math.PI) / 180;

type State = 'intact' | 'doomed' | 'falling' | 'fallen';
let state: State = 'intact';
let pane!: Pane;
let seed = Number(params.get('seed')) || (Math.random() * 1e9) | 0;
let limit = 0; // metres of crack the pane can take
let lastImpact: Impact | null = null;
let shots = 0;

let set: ShardSet | null = null;
let run = 0;
let frames: Float32Array[] = [];
let hits: number[] = [];
let bakeDone = false;
let fallAt = 0;
let playhead = 0; // seconds into the baked fall
let lastHitFrame = 0;
let slow = false;
const PACE = 0.6; // the fall plays a little slower than life: it is over in half a second otherwise
let speed = PACE;
let held = -1; // a playhead to hold, for stills

let now = 0; // seconds, the clock of the scene
let flash = 0;
let recoil = 0;
let fade = 0;
let fadeTo = 1;
let resetAt = -1;

// the mask over the pane: holes and crushed glass
const mask = document.createElement('canvas');
const mctx = mask.getContext('2d')!;

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
  const [W, H] = aspect > 1.15 ? [1.2, 0.8] : aspect < 0.8 ? [0.62, 0.95] : [0.9, 0.8];
  seed = (seed * 1664525 + 1013904223) >>> 0;
  pane = new Pane(W, H, T, seed);
  limit = W * H * (13 + pane.rand() * 8);
  lastImpact = null;
  shots = 0;
  state = 'intact';
  set = null;
  ball.on = false; shocked = false;
  frames = []; hits = []; bakeDone = false;
  run++;
  const s = 2048 / Math.max(W, H);
  mask.width = Math.round(W * s); mask.height = Math.round(H * s);
  mctx.globalCompositeOperation = 'source-over';
  mctx.fillStyle = '#000'; mctx.fillRect(0, 0, mask.width, mask.height);
  renderer.setPane(pane, Y0);
  dPos.fill(0); dLife.fill(0); dUsed = 0;
  setHint();
}

function setHint() {
  const touch = matchMedia('(pointer: coarse)').matches;
  hint.textContent =
    state === 'fallen' ? (touch ? 'Tap for a new pane' : 'Click for a new pane')
    : state === 'falling' ? (touch ? 'Hold to slow it down' : 'Hold to slow it down')
    : state === 'doomed' ? ''
    : shots === 0 ? (touch ? 'Tap the glass to shoot' : 'Click the glass to shoot')
    : shots < 3 ? (touch ? 'Swipe: every hole blows out' : 'Drag: every hole blows out. Space: a football')
    : '';
}

function drawMask(im: Impact) {
  const s = mask.width / pane.W;
  const X = (x: number) => x * s, Y = (y: number) => (pane.H - y) * s;
  mctx.globalCompositeOperation = 'lighter';
  // crushed glass: dense by the hole, in ragged petals
  const rand = pane.rand;
  const petals = 9 + Math.floor(rand() * 6);
  for (let i = 0; i < petals; i++) {
    const a = rand() * Math.PI * 2, r = im.r * (2 + rand() * rand() * 5.5);
    const g = mctx.createRadialGradient(X(im.x), Y(im.y), im.r * s * 0.8, X(im.x), Y(im.y), r * s);
    g.addColorStop(0, 'rgba(0,255,0,0.75)'); g.addColorStop(0.45, 'rgba(0,255,0,0.3)'); g.addColorStop(1, 'rgba(0,255,0,0)');
    mctx.fillStyle = g;
    mctx.beginPath(); mctx.moveTo(X(im.x), Y(im.y));
    mctx.arc(X(im.x), Y(im.y), r * s, a, a + 0.5 + rand() * 1.2);
    mctx.closePath(); mctx.fill();
  }
  // the hole, a little inside its rim so the rim keeps a lip of glass
  mctx.fillStyle = 'rgb(255,0,0)';
  mctx.beginPath();
  im.rim.forEach((n, i) => {
    const x = im.x + (pane.nx[n] - im.x) * 0.9, y = im.y + (pane.ny[n] - im.y) * 0.9;
    if (i) mctx.lineTo(X(x), Y(y)); else mctx.moveTo(X(x), Y(y));
  });
  mctx.closePath(); mctx.fill();
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

function shoot(x: number, y: number) {
  if (state !== 'intact') return;
  sound.shot();
  flash = 1; recoil = 1;
  if (x < 0 || y < 0 || x > pane.W || y > pane.H || pane.inHole(x, y)) return; // through a hole, or wide
  const res = pane.shoot(x, y, now, 0.75 + Math.random() * 0.6);
  renderer.addCracks(pane, res.segs);
  drawMask(res.impact);
  lastImpact = res.impact;
  shots++;
  for (const t of res.ticks) sound.tick(t - now);
  const wx = x - pane.W / 2, wy = y + Y0;
  for (let i = 0; i < 420; i++) {
    const back = Math.random() < 0.72;
    const sp = back ? 1.5 + Math.random() * Math.random() * 11 : 0.5 + Math.random() * 3.5;
    const cone = back ? 0.32 : 0.6;
    dust(wx + gauss() * 0.004, wy + gauss() * 0.004, back ? -T : 0, gauss() * sp * cone, gauss() * sp * cone + 0.3, back ? -sp : sp, 0.7 + Math.random() * 2.2);
  }
  setHint();
}

/** The football, kicked hard: 30 m/s. Where and how it hits is known the moment it leaves the foot, so the
 *  pane is cracked, cut and baked while it flies. The flight is shown in slow motion (it would be over in three
 *  frames), and the fall starts at that same pace, then picks up. */
const BALL_R = 0.11;
const FLIGHT = 0.42;
const KICK = 30; // m/s
let ballSlow = 1; // how much slower than life the flight is shown
const ball = { on: false, at: 0, p: [0, 0, 0], v: [0, 0, 0], w: [0, 0, 0] }; // p, v: as it reaches the glass, at time `at`
function kick(x: number, y: number) {
  if (state !== 'intact') return;
  x = Math.min(pane.W - 0.02, Math.max(0.02, x)); y = Math.min(pane.H - 0.02, Math.max(0.05, y));
  state = 'doomed';
  sound.kick();
  const at = now + FLIGHT;
  const hit = [x - pane.W / 2, y + Y0, BALL_R + 0.012];
  const from = [cam.eye[0] * 0.5, 0.12, cam.eye[2] * 0.82];
  const len = Math.hypot(hit[0] - from[0], hit[1] - from[1], hit[2] - from[2]);
  const v = [((hit[0] - from[0]) / len) * KICK, ((hit[1] - from[1]) / len) * KICK, ((hit[2] - from[2]) / len) * KICK];
  ballSlow = len / FLIGHT / KICK;
  ball.on = true; ball.at = at; ball.p = hit; ball.v = v; ball.w = [-40, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16];
  // the cracks of the impact: a blunt blow, radials all over the pane, then everything cut small
  const res = pane.shoot(x, y, at, 2.4, true);
  res.impact.r = 0; // a ball leaves no hole of its own
  renderer.addCracks(pane, res.segs);
  renderer.addCracks(pane, pane.finish(at, 0.0022, 0.1));
  lastImpact = res.impact;
  sound.smash(FLIGHT);
  set = buildShards(pane, Y0);
  renderer.setShards(set);
  frames = []; hits = []; bakeDone = false;
  fallAt = at;
  const req: BakeRequest = { type: 'bake', run: ++run, bodies: set.bodies, impacts: [[hit[0], hit[1]]], width: pane.W, y0: Y0, seed, balls: [{ p: hit, v, w: ball.w, r: BALL_R }] };
  shockAt = [[hit[0], hit[1]]];
  worker.postMessage(req);
  setHint();
}

/** A swipe: a shock, at once. It is as if a ball nobody sees went through every bullet hole at the same
 *  instant: each hole gets a blunt blow, the pane is cut small, and one heavy sphere per hole goes into the sim. */
function shock(ax: number, ay: number, bx: number, by: number) {
  if (state !== 'intact') return;
  state = 'doomed';
  // where the bullets went; with none, where the swipe was
  const at = pane.impacts.length ? pane.impacts.map((im) => [im.x, im.y]) : [[(ax + bx) / 2, (ay + by) / 2]];
  const lead = 0.06; // just long enough for the worker to hand back its first frames
  sound.smash(lead);
  const never = 1e9; // the pane is replaced by its shards before any of this would be drawn
  const energy = Math.max(0.9, 2.4 / Math.sqrt(at.length));
  for (const [x, y] of at) {
    const cx = Math.min(pane.W - 0.02, Math.max(0.02, x)), cy = Math.min(pane.H - 0.02, Math.max(0.02, y));
    pane.shoot(cx, cy, never, energy, true).impact.r = 0;
  }
  pane.finish(never, 0.0022, 0);
  set = buildShards(pane, Y0);
  renderer.setShards(set);
  frames = []; hits = []; bakeDone = false;
  fallAt = now + lead;
  shocked = true;
  const impacts = at.map(([x, y]) => [x - pane.W / 2, y + Y0] as [number, number]);
  const balls = impacts.map(([x, y]) => ({ p: [x, y, BALL_R + 0.012], v: [(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, -KICK], w: [0, 0, 0], r: BALL_R }));
  shockAt = impacts;
  const req: BakeRequest = { type: 'bake', run: ++run, bodies: set.bodies, impacts, width: pane.W, y0: Y0, seed, balls };
  worker.postMessage(req);
  setHint();
}
let shocked = false;
let shockAt: [number, number][] = [];

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
  if (m.type !== 'frames' || m.run !== run || !set) return;
  const n = (set.count + 1) * 7;
  for (let i = 0; i < m.count; i++) { frames.push(m.data.subarray(i * n, (i + 1) * n)); hits.push(m.hits[i]); }
  if (m.done) bakeDone = true;
};

function startFall() {
  if (!set) return;
  state = 'falling';
  playhead = 0; lastHitFrame = 0;
  if (ball.on) { speed = ballSlow; recoil = 1.6; playhead = Math.max(0, now - ball.at) * ballSlow; }
  if (shocked) { speed = 0.2; recoil = 1.6; flash = 0.35; }
  renderer.shards = true;
  renderer.setPose(frames[0], frames[0], 0);
  // dust comes off every crack as the pane lets go
  for (let i = 0; i < 3200; i++) {
    const b = set.bodies[(Math.random() * set.count) | 0];
    let d = Infinity;
    for (const [ix, iy] of shockAt) d = Math.min(d, Math.hypot(b.c[0] - ix, b.c[1] - iy));
    dust(b.c[0] + gauss() * 0.02, b.c[1] + gauss() * 0.02, -T / 2, gauss() * 0.5, gauss() * 0.5, gauss() * 0.8 - 1.2 * Math.exp(-d / 0.25) * 4, 1 + Math.random() * 2.5, d / 7 + Math.random() * 0.1);
  }
  setHint();
}

// ---------------------------------------------------------------- camera
let w = 0, h = 0;
const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
let zoom = 1, zoomTo = 1;
const focus = [0, 0.4, 0];
const cam: { eye: number[]; view: Float32Array; proj: Float32Array } = { eye: [0, 0.5, 2], view: new Float32Array(16), proj: new Float32Array(16) };

function updateCamera(t: number) {
  const aspect = w / h;
  const tan = Math.tan(FOV / 2);
  const dist = Math.max((pane.H * 1.38) / (2 * tan), (pane.W * 1.22) / (2 * tan * aspect));
  const home = [0, Y0 + pane.H * 0.43, 0];
  const k = 1 - 1 / zoom;
  const target = [home[0] + (focus[0] - home[0]) * k, home[1] + (focus[1] - home[1]) * k, 0];
  const d = dist / zoom;
  // the pointer moves the head a little; with none, a slow sway
  const yaw = ptr.sx * 0.2 + Math.sin(t * 0.21) * 0.035;
  const pitch = 0.1 - ptr.sy * 0.07 + Math.sin(t * 0.17 + 1) * 0.012 + recoil * recoil * 0.012;
  cam.eye = [target[0] + Math.sin(yaw) * Math.cos(pitch) * d, Math.max(0.04, target[1] + Math.sin(pitch) * d), Math.cos(yaw) * Math.cos(pitch) * d];
  cam.view = lookAt(cam.eye, target, [recoil * 0.004, 1, 0]);
  cam.proj = perspective(FOV, aspect, 0.03, 40);
}

/** Where the ray through a point of the page meets the front of the glass, in pane space. */
function pick(px: number, py: number): [number, number] {
  const v = cam.view;
  const tan = Math.tan(FOV / 2);
  const nx = ((px / w) * 2 - 1) * tan * (w / h), ny = (1 - (py / h) * 2) * tan;
  const dx = v[0] * nx + v[1] * ny - v[2], dy = v[4] * nx + v[5] * ny - v[6], dz = v[8] * nx + v[9] * ny - v[10];
  const t = -cam.eye[2] / dz;
  return [cam.eye[0] + dx * t + pane.W / 2, cam.eye[1] + dy * t - Y0];
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

canvas.addEventListener('pointerdown', (e) => {
  sound.wake();
  mouse = e.pointerType === 'mouse';
  if (mouse) { ptr.x = (e.clientX / w) * 2 - 1; ptr.y = (e.clientY / h) * 2 - 1; } else { ptr.x = 0; ptr.y = 0; }
  if (state === 'intact') { down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; canvas.setPointerCapture(e.pointerId); }
  else if (state === 'falling') { slow = true; canvas.setPointerCapture(e.pointerId); }
  else if (state === 'fallen') reset();
});
// a press that stays put is a bullet, one that travels is a shock wave the way it went
let down: { x: number; y: number; t: number; id: number } | null = null;
let mouse = true;
const release = (e: PointerEvent) => {
  slow = false;
  if (!down || down.id !== e.pointerId) return;
  const d = down;
  down = null;
  if (e.type !== 'pointerup' || state !== 'intact') return;
  const far = Math.hypot(e.clientX - d.x, e.clientY - d.y);
  if (far < 14) { const [x, y] = pick(d.x, d.y); shoot(x, y); }
  else if (far > 40) { const [ax, ay] = pick(d.x, d.y), [bx, by] = pick(e.clientX, e.clientY); shock(ax, ay, bx, by); }
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
window.addEventListener('pointermove', (e) => {
  // only a mouse moves the head, and not while it is pressed: under a finger the glass stays put
  if (e.pointerType !== 'mouse' || down) return;
  ptr.x = (e.clientX / w) * 2 - 1; ptr.y = (e.clientY / h) * 2 - 1;
  if (zoom < 1.02) { const [x, y] = pick(e.clientX, e.clientY); focus[0] = x - pane.W / 2; focus[1] = y + Y0; }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (zoomTo <= 1.001 && e.deltaY < 0) { const [x, y] = pick(e.clientX, e.clientY); focus[0] = Math.max(-pane.W / 2, Math.min(pane.W / 2, x - pane.W / 2)); focus[1] = Math.max(0, Math.min(pane.H + Y0, y + Y0)); }
  zoomTo = Math.max(1, Math.min(7, zoomTo * Math.exp(-e.deltaY * 0.0015)));
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey) return;
  if (e.code === 'Space') {
    e.preventDefault();
    sound.wake();
    if (state === 'intact') kick(pane.W * 0.5, pane.H * 0.5);
    else if (state === 'falling') slow = true;
    else if (state === 'fallen') reset();
  } else if (e.code === 'KeyR') reset();
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
  if (state === 'intact') kick(pane.W * 0.5, pane.H * 0.5);
});

// ---------------------------------------------------------------- frame
let prev = 0;
function frame(ms: number) {
  const dt = Math.min(0.05, (ms - prev) / 1000 || 0.016);
  prev = ms;
  now += dt;
  flash *= Math.exp(-dt / 0.045);
  recoil *= Math.exp(-dt / 0.09);
  ptr.sx += (ptr.x - ptr.sx) * Math.min(1, dt * 5); ptr.sy += (ptr.y - ptr.sy) * Math.min(1, dt * 5);
  zoom += (zoomTo - zoom) * Math.min(1, dt * 9);
  fade += (fadeTo - fade) * Math.min(1, dt * 12);
  if (resetAt >= 0 && now > resetAt) { resetAt = -1; newPane(); fadeTo = 1; zoomTo = 1; }

  if (state === 'doomed' && now >= fallAt && (bakeDone || frames.length > 5)) startFall();
  renderer.ball.on = ball.on && showBall;
  if (ball.on && state === 'doomed') flyBall();
  if (state === 'falling') {
    speed += ((slow ? 0.07 : PACE) - speed) * Math.min(1, dt * (slow || speed > PACE ? 10 : 1.6));
    playhead += dt * speed;
    if (held >= 0) playhead = held;
    const lastFrame = frames.length - 1;
    let f = playhead * 60;
    if (f > lastFrame) { f = lastFrame; playhead = lastFrame / 60; }
    const i = Math.floor(f);
    const fa = frames[i], fb = frames[Math.min(lastFrame, i + 1)], k = f - i, o = set!.count * 7;
    renderer.setPose(fa, fb, k);
    for (let c = 0; c < 3; c++) renderer.ball.p[c] = fa[o + c] + (fb[o + c] - fa[o + c]) * k;
    for (let c = 0; c < 4; c++) renderer.ball.q[c] = fa[o + 3 + c];
    for (; lastHitFrame <= i; lastHitFrame++) sound.tinkle(hits[lastHitFrame], Math.max(0.25, speed / PACE));
    if (bakeDone && i >= lastFrame) { state = 'fallen'; setHint(); }
  }
  stepDust(state === 'falling' ? dt * speed : dt);
  renderer.setDust(dPos, dUsed);

  updateCamera(now);
  renderer.draw(cam.view, cam.proj, cam.eye, renderer.shards ? playhead : now, flash, fade, dUsed);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
newPane();
resize();
requestAnimationFrame(frame);

// for the console, and for whoever films it
Object.assign(window, {
  shatter: {
    shoot: (u: number, v: number) => shoot(u * pane.W, v * pane.H),
    kick: (u: number, v: number) => kick(u * pane.W, v * pane.H), reset,
    shock: (ax: number, ay: number, bx: number, by: number) => shock(ax, ay, bx, by),
    seek: (t: number) => { held = t; },
    get state() { return state; },
    get info() { return { state, shots, crack: pane.crackLen, limit, shards: set?.count, low: set?.bodies.filter((b) => b.low).length, frames: frames.length, bakeDone }; },
  },
});
