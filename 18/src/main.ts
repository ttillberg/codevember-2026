import { Sound } from './audio';
import { crossings, joints, type Arm, type Hit, type Mode } from './rhythm';

// ?clean: no page furniture, the scene alone (screengrabs, clips)
const query = new URLSearchParams(location.search);
const clean = query.has('clean');
if (clean) document.body.classList.add('clean');

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const ctx = canvas.getContext('2d')!;
const panel = document.querySelector<HTMLElement>('#panel')!;
const hint = document.querySelector<HTMLElement>('#hint')!;

const INK = '244, 244, 242';
const BACK = '#0b0b0d';
const MAX_ARMS = 8;
const MAX_N = 16;
/**
 * How far ahead hits are worked out and handed to the audio clock, seconds: at least this, and
 * always past the output's own latency (bluetooth is a fifth of a second), or a hit would
 * have to start in the past and land on the scheduler's tick instead of its own time.
 */
const LOOK = 0.12;
/** points along a joint's path over one bar */
const ORBIT = 720;

// --- what is set ---

interface State {
  arms: Arm[];
  /** four beats to the bar: the first arm at ×1 ticks on 1 and tocks on 3 */
  bpm: number;
  mode: Mode;
}

const KEY = 'codevember-2026-18';
const fresh = (): State => ({ arms: [{ n: 1, swing: 0.6, len: 1, phase: 0 }], bpm: 120, mode: 'sum' });

/** ?arms=1-34-1,2-52-0.62-90 (swings, swing in degrees, length, phase in degrees if any), &bpm=, &mode=each: a pattern in a link, for clips too */
function fromQuery(): State | null {
  const q = query.get('arms');
  if (!q) return null;
  const arms = q
    .split(',')
    .map((a) => a.split('-').map(Number))
    .filter((a) => a.length >= 3 && a.every(Number.isFinite))
    .map(([n, deg, len, phase = 0]) => ({ n: Math.min(MAX_N, Math.max(1, Math.round(n))), swing: (Math.min(180, Math.max(0, deg)) * Math.PI) / 180, len: Math.min(1.5, Math.max(0.1, len)), phase: (((phase % 360) + 360) % 360) * (Math.PI / 180) }));
  if (!arms.length) return null;
  const bpm = Number(query.get('bpm'));
  return { arms: arms.slice(0, MAX_ARMS), bpm: bpm >= 40 && bpm <= 220 ? bpm : 120, mode: query.get('mode') === 'each' ? 'each' : 'sum' };
}

function load(): State {
  const q = fromQuery();
  if (q) return q;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as State | null;
    if (s && Array.isArray(s.arms) && s.arms.length && s.arms.every((a) => [a.n, a.swing, a.len, a.phase].every(Number.isFinite))) {
      return { arms: s.arms.slice(0, MAX_ARMS), bpm: Number.isFinite(s.bpm) ? s.bpm : 120, mode: s.mode === 'each' ? 'each' : 'sum' };
    }
  } catch {
    // no storage, or not ours: start over
  }
  return fresh();
}

const state = load();
let muted = false;

// --- time: the bar's phase, continuous through tempo changes and pauses ---

const clock = () => performance.now() / 1000;
const barSeconds = () => 240 / state.bpm;
let playing = true;
let phi0 = 0;
let t0 = clock();
const phaseAt = (t: number) => phi0 + (playing ? (t - t0) / barSeconds() : 0);
/** call before the tempo or `playing` changes */
function anchor() {
  const t = clock();
  phi0 = phaseAt(t);
  t0 = t;
}

// --- one bar of it, worked out whenever something is set: the rhythm and the paths ---

let bar: Hit[] = [];
let orbits: Float32Array[] = [];

function changed() {
  bar = crossings(state.arms, state.mode, -1e-6, 1 - 1e-6);
  const tmp: number[] = [];
  orbits = state.arms.map(() => new Float32Array((ORBIT + 1) * 2));
  for (let i = 0; i <= ORBIT; i++) {
    joints(state.arms, i / ORBIT, tmp);
    for (let k = 0; k < orbits.length; k++) {
      orbits[k][2 * i] = tmp[2 * k];
      orbits[k][2 * i + 1] = tmp[2 * k + 1];
    }
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // private window: nothing kept
  }
}

// --- the sound, and the hits handed to it a little ahead ---

let sound: Sound | null = null;

function unlock() {
  if (!sound) {
    try {
      sound = new Sound();
      sound.muted = muted;
    } catch {
      return;
    }
  }
  if (!sound.running && !document.hidden) sound.ac.resume().catch(() => {});
}
for (const ev of ['pointerdown', 'pointerup', 'keydown', 'click']) window.addEventListener(ev, unlock, { capture: true });
document.addEventListener('visibilitychange', () => {
  if (!sound) return;
  if (document.hidden) sound.ac.suspend().catch(() => {});
  else sound.ac.resume().catch(() => {});
});

interface Flash extends Hit {
  /** when it is seen and heard, clock seconds */
  t: number;
}
const flashes: Flash[] = [];
let scanned = NaN;

function schedule() {
  if (!playing) {
    scanned = NaN;
    return;
  }
  const t = clock();
  const here = phaseAt(t);
  const end = phaseAt(t + Math.min(0.8, Math.max(LOOK, (sound?.latency ?? 0) + 0.08)));
  // the first tick, or the timer was held back (a hidden tab): no burst of old hits
  if (!(scanned >= here)) scanned = here;
  if (!(end > scanned)) return;
  sound?.sync();
  for (const h of crossings(state.arms, state.mode, scanned, end)) {
    const at = t0 + (h.phase - phi0) * barSeconds();
    flashes.push({ ...h, t: at });
    sound?.hit(h.k, h.dir, h.vel, at);
  }
  scanned = end;
}
window.setInterval(schedule, 25);

// --- the workbench ---

let panelRect = { left: 0, top: 0 };

function build() {
  const many = state.arms.length > 1;
  panel.innerHTML = `
    <div class="cols"><span>Swings</span><span>Swing</span><span>Length</span><span>Phase</span></div>
    ${state.arms
      .map(
        (a, k) => `
    <div class="arm" data-k="${k}">
      <button data-act="dn" aria-label="Fewer swings per bar">−</button><output>×${a.n}</output><button data-act="up" aria-label="More swings per bar">+</button>
      <input type="range" data-p="swing" min="0" max="180" step="1" value="${Math.round((a.swing * 180) / Math.PI)}" aria-label="Swing of arm ${k + 1}" />
      <input type="range" data-p="len" min="0.1" max="1.5" step="0.01" value="${a.len}" aria-label="Length of arm ${k + 1}" />
      <input type="range" data-p="phase" min="0" max="360" step="1" value="${Math.round((a.phase * 180) / Math.PI)}" aria-label="Phase of arm ${k + 1}" />
      <button data-act="rm" aria-label="Remove arm ${k + 1}" ${many ? '' : 'disabled'}>✕</button>
    </div>`,
      )
      .join('')}
    <div class="row">
      <button data-act="add" ${state.arms.length < MAX_ARMS ? '' : 'disabled'}>+ Arm</button>
      <button data-act="mode" title="What a joint crosses to sound: the centre line (sum) or its own vertical (each)">${state.mode}</button>
      <button data-act="play">${playing ? 'Pause' : 'Play'}</button>
      <button data-act="mute">${muted ? 'Muted' : 'Sound'}</button>
    </div>
    <label class="row"><span>Tempo</span><input type="range" data-p="bpm" min="40" max="220" step="1" value="${state.bpm}" /><output id="bpm">${state.bpm}</output></label>`;
  const r = panel.getBoundingClientRect();
  panelRect = { left: r.left, top: r.top };
}

function addArm() {
  if (state.arms.length >= MAX_ARMS) return;
  const last = state.arms[state.arms.length - 1];
  state.arms.push({ n: Math.min(MAX_N, last.n + 1), swing: 0.9, len: Math.max(0.2, +(last.len * 0.62).toFixed(2)), phase: 0 });
}
function removeArm(k = state.arms.length - 1) {
  if (state.arms.length > 1) state.arms.splice(k, 1);
}
function toggle(what: 'mode' | 'play' | 'mute') {
  if (what === 'mode') state.mode = state.mode === 'sum' ? 'each' : 'sum';
  if (what === 'play') {
    anchor();
    playing = !playing;
  }
  if (what === 'mute') {
    muted = !muted;
    if (sound) sound.muted = muted;
  }
}

panel.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  if (!b) return;
  const act = b.dataset.act!;
  const k = Number(b.closest<HTMLElement>('.arm')?.dataset.k);
  if (act === 'up') state.arms[k].n = Math.min(MAX_N, state.arms[k].n + 1);
  else if (act === 'dn') state.arms[k].n = Math.max(1, state.arms[k].n - 1);
  else if (act === 'rm') removeArm(k);
  else if (act === 'add') addArm();
  else toggle(act as 'mode' | 'play' | 'mute');
  changed();
  build();
});

panel.addEventListener('input', (e) => {
  const r = e.target as HTMLInputElement;
  const v = Number(r.value);
  if (r.dataset.p === 'bpm') {
    anchor();
    state.bpm = v;
    panel.querySelector('#bpm')!.textContent = String(v);
  } else {
    const a = state.arms[Number(r.closest<HTMLElement>('.arm')!.dataset.k)];
    if (r.dataset.p === 'swing') a.swing = (v * Math.PI) / 180;
    else if (r.dataset.p === 'phase') a.phase = (v * Math.PI) / 180;
    else a.len = v;
  }
  changed();
});

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ') toggle('play');
  else if (e.key === '+' || e.key === '=') addArm();
  else if (e.key === '-' || e.key === '_') removeArm();
  else if (e.key === 'm') toggle('mute');
  else if (e.key === 's') toggle('mode');
  else return;
  e.preventDefault();
  changed();
  build();
});

// --- the drawing: lines ---

let w = 0;
let h = 0;
let dpr = 1;
/** pixels to an arm length, eased so adding an arm does not jump */
let unit = 0;

function resize() {
  dpr = Math.min(window.devicePixelRatio, 2);
  w = window.innerWidth;
  h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = panel.getBoundingClientRect();
  panelRect = { left: r.left, top: r.top };
}

const ink = (a: number) => `rgba(${INK}, ${a})`;
function line(x0: number, y0: number, x1: number, y1: number, a: number, width = 1) {
  ctx.strokeStyle = ink(a);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

const now: number[] = [];
const then: number[] = [];
let hinted = '';
let drawn = 0;

function frame() {
  const t = clock();
  const phi = phaseAt(t);
  const arms = state.arms;
  const n = arms.length;
  ctx.clearRect(0, 0, w, h);

  // where things go: the timeline along the bottom (over the workbench on a phone), the chain over it
  const wide = w > 760;
  const edge = wide ? 24 : 16;
  const rowH = 18;
  const tlX0 = edge;
  const tlX1 = clean || !wide ? w - edge : panelRect.left - 32;
  const tlBottom = clean || wide ? h - 30 : panelRect.top - 18;
  const tlTop = tlBottom - n * rowH;

  let total = 0;
  for (const a of arms) total += a.len;
  const px = w / 2;
  const py = Math.max(wide ? 150 : 112, h * 0.24);
  const reach = Math.max(40, Math.min(w * 0.46, tlTop - 40 - py));
  const target = reach / Math.max(1, total);
  unit = unit ? unit + (target - unit) * (1 - Math.exp(-(t - drawn) * 8)) : target;
  drawn = t;
  const X = (x: number) => px + x * unit;
  const Y = (y: number) => py + y * unit;

  joints(arms, phi, now);

  // what a joint has to cross: the centre line, or its own vertical
  if (state.mode === 'sum') line(px, py - 14, px, Y(total) + 14, 0.22);
  else for (let k = 0; k < n; k++) {
    const ox = k ? X(now[2 * k - 2]) : px;
    const oy = k ? Y(now[2 * k - 1]) : py;
    line(ox, oy, ox, oy + arms[k].len * unit, 0.2);
  }

  // every joint's path over the bar, the last one's a little brighter: the picture the swings add up to
  ctx.lineWidth = 1;
  for (let k = 0; k < n; k++) {
    const o = orbits[k];
    ctx.strokeStyle = ink(k === n - 1 ? 0.3 : 0.1);
    ctx.beginPath();
    ctx.moveTo(X(o[0]), Y(o[1]));
    for (let i = 1; i <= ORBIT; i++) ctx.lineTo(X(o[2 * i]), Y(o[2 * i + 1]));
    ctx.stroke();
  }

  // the hits: a ring where the joint crossed, and which joints just sounded
  const lit = new Array<number>(n).fill(0);
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const age = t - f.t;
    if (age < 0) continue;
    if (age > 0.4 || f.k >= n) {
      flashes.splice(i, 1);
      continue;
    }
    lit[f.k] = Math.max(lit[f.k], 1 - age / 0.14);
    joints(arms, f.phase, then);
    ctx.strokeStyle = ink((1 - age / 0.4) ** 2 * (0.25 + 0.75 * f.vel));
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(X(then[2 * f.k]), Y(then[2 * f.k + 1]), 5 + age * (40 + 80 * f.vel), 0, Math.PI * 2);
    ctx.stroke();
  }

  // the chain
  ctx.strokeStyle = ink(0.95);
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(px, py);
  for (let k = 0; k < n; k++) ctx.lineTo(X(now[2 * k]), Y(now[2 * k + 1]));
  ctx.stroke();
  ctx.fillStyle = ink(0.95);
  ctx.beginPath();
  ctx.arc(px, py, 2.5, 0, Math.PI * 2);
  ctx.fill();
  for (let k = 0; k < n; k++) {
    ctx.beginPath();
    ctx.arc(X(now[2 * k]), Y(now[2 * k + 1]), 4.5, 0, Math.PI * 2);
    ctx.fillStyle = BACK;
    ctx.fill();
    if (lit[k] > 0) {
      ctx.fillStyle = ink(lit[k]);
      ctx.fill();
    }
    ctx.stroke();
  }

  // the bar: a row a joint, a tick a hit, up for tick and down for tock, as tall as it is hard
  const tlW = tlX1 - tlX0;
  const at = phi - Math.floor(phi);
  for (let q = 0; q <= 4; q++) line(tlX0 + (tlW * q) / 4, tlBottom + 3, tlX0 + (tlW * q) / 4, tlBottom + 7, 0.35);
  for (let k = 0; k < n; k++) {
    const y = tlTop + k * rowH + rowH / 2;
    line(tlX0, y, tlX1, y, 0.16);
  }
  for (const b of bar) {
    const x = tlX0 + b.phase * tlW;
    const y = tlTop + b.k * rowH + rowH / 2;
    const since = (at - b.phase + 1) % 1;
    const glow = since < 0.03 ? 1 - since / 0.03 : 0;
    line(x, y, x, y - b.dir * (2.5 + 5.5 * b.vel + 2 * glow), 0.55 + 0.45 * glow, 1.5);
  }
  line(tlX0 + at * tlW, tlTop - 4, tlX0 + at * tlW, tlBottom + 2, 0.5);

  const say = sound?.running ? '' : 'Tap for sound';
  if (say !== hinted) hint.textContent = hinted = say;

  requestAnimationFrame(frame);
}

// the dev console: __pendulum.sound()?.stats says how many hits went out and how far ahead
if (import.meta.env.DEV) Object.assign(window, { __pendulum: { state, sound: () => sound, bar: () => bar } });

window.addEventListener('resize', resize);
changed();
build();
resize();
requestAnimationFrame(frame);
