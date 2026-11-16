// 14 Tension: one string, the whole height of the screen. Where along it a finger takes it is
// the pitch, always a note of the scale, no frets to see (an octave under the key at the
// bottom, four octaves up at the top; the scale's notes are marked on it); pull it aside and let
// go to pluck. Dots stand in the dark beside it, set so that each group is a chord: drag the
// string through them and it catches on each one and slips off with its note. A finger sliding along a ringing string takes its pitch along, soft
// flageolets at the nodes; a second finger bends what rings. Once played, the string draws
// its own modes, dying with the sound.

import { Engine, tune } from './audio';
import { PRESETS, SCALES, applyScale, inScale as inScaleOf, midiHz, pc, ring as decay, snap, type Partials } from './presets';
import { createSettings } from './settings';
import { Groove, PATTERNS, type Hit } from './arp';
import { createUi, LEVELS, TOUCH, type LevelKey } from './ui';
import { Nacre } from './nacre';

const params = new URLSearchParams(location.search);
// ?clean: no page furniture, the scene alone (screengrabs, clips)
if (params.has('clean')) document.body.classList.add('clean');
if (TOUCH) document.body.classList.add('touch');
const AUTO = params.has('auto');

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const ctx = canvas.getContext('2d')!;
const hint = document.querySelector<HTMLElement>('.hint');

/** what the drawing is allowed to tweak (settings) */
const look = { speed: 1 };

let presetIdx = 0;
const preset = () => PRESETS[presetIdx];

// ------------------------------------------------------------------ audio, on first gesture

// iOS: play through the silent switch, like a media player, not a ringtone
try {
  const s = (navigator as { audioSession?: { type: string } }).audioSession;
  if (s) s.type = 'playback';
} catch {}

let engine: Engine | null = null;
let ac: AudioContext | null = null;
let starting: Promise<Engine | null> | null = null;
function audio(): Promise<Engine | null> {
  // resume on every gesture: iOS only counts touchend/click, not pointerdown
  if (ac && ac.state !== 'running') ac.resume();
  if (engine) return Promise.resolve(engine);
  starting ??= (async () => {
    try {
      ac = new AudioContext({ latencyHint: 'interactive' });
      ac.resume();
      // running: the button goes; locked again later (a call, the lock screen): it comes back
      // with the next gesture
      ac.addEventListener('statechange', () => ac?.state === 'running' && showStart(false));
      const e = await Engine.create(ac, preset());
      e.setPreset(preset());
      applyPad(e);
      e.setDelay(level.delay);
      engine = e;
      return e;
    } catch (err) {
      console.warn('no audio', err);
      // say it on the page: a phone has no console
      if (hint) {
        hint.textContent = `No sound: ${(err as Error)?.message ?? err}`;
        hint.style.opacity = '1';
      }
      return null;
    }
  })();
  return starting;
}
// the gestures iOS accepts to unlock audio
for (const type of ['touchend', 'click']) window.addEventListener(type, () => (audio(), checkAudio()), { capture: true, passive: true });

// When a gesture didn't unlock it (a browser that wants a plain tap, iOS after a call or the
// lock screen), a button says so: one tap on it and the sound is on.
const startBtn = document.createElement('button');
startBtn.type = 'button';
startBtn.className = 'start';
startBtn.innerHTML =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>Tap for sound';
startBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
startBtn.addEventListener('click', async () => {
  const e = await audio();
  await ac?.resume().catch(() => {});
  showStart(!e || ac?.state !== 'running');
});
document.body.append(startBtn);
function showStart(on: boolean) {
  startBtn.classList.toggle('show', on);
}
// On a desktop, a frosted card first: headphones recommended. A click anywhere takes it away
// (and, being a click, starts the sound); that click plucks nothing. Once seen, it's remembered.
const SEEN = 'codevember-14-headphones';
let seen = false;
try {
  seen = localStorage.getItem(SEEN) === '1';
} catch {}
if (!seen && !params.has('clean') && matchMedia('(hover: hover) and (pointer: fine)').matches) {
  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.innerHTML =
    '<div class="card"><svg width="72" height="72" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 13.6V11.6a7.5 7.5 0 0 1 15 0v2" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round"/><g fill="currentColor"><rect x="3" y="13.2" width="3.1" height="6.6" rx="1.55"/><rect x="5.2" y="12.4" width="2.7" height="8.6" rx="1.35"/><rect x="17.9" y="13.2" width="3.1" height="6.6" rx="1.55"/><rect x="16.1" y="12.4" width="2.7" height="8.6" rx="1.35"/></g></svg>' +
    '<button type="button" class="x" aria-label="Close"><svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>' +
    '<b>Headphones recommended</b><i lang="ja">ヘッドホン推奨</i></div>';
  veil.addEventListener('pointerdown', (e) => e.stopPropagation());
  veil.addEventListener('click', () => {
    veil.classList.add('gone');
    try {
      localStorage.setItem(SEEN, '1');
    } catch {}
    window.setTimeout(() => veil.remove(), 500);
  }, { once: true });
  document.body.append(veil);
}

let checkT = 0;
/** a moment after a gesture: is it playing? */
function checkAudio() {
  clearTimeout(checkT);
  checkT = window.setTimeout(() => {
    if (starting && !engine) return checkAudio(); // still loading the worklet
    showStart(!!ac && ac.state !== 'running' && !!engine);
  }, 500);
}

/**
 * Away (another app, the lock screen, a hidden tab, the window losing focus):
 * the sound stops at once and the audio is paused, nothing plays on in a pocket. Back, it comes
 * up again softly (iOS may want a tap first: the start button).
 */
let hidden = false;
function pageAway() {
  if (hidden) return;
  hidden = true;
  if (!ac || !engine) return;
  engine.hush();
  window.setTimeout(() => hidden && ac?.suspend(), 90);
}
function pageBack() {
  if (!hidden) return;
  hidden = false;
  if (!ac || !engine) return;
  ac.resume().catch(() => {});
  engine.unhush();
  checkAudio();
}
document.addEventListener('visibilitychange', () => (document.hidden ? pageAway() : pageBack()));
window.addEventListener('pagehide', pageAway);
window.addEventListener('pageshow', pageBack);
// (on a desktop too: another window in front is away)
window.addEventListener('blur', pageAway);
window.addEventListener('focus', pageBack);

// ------------------------------------------------------------------ the string

let w = 0;
let h = 0;
let dpr = 1;
/** the string as a line: from the top (u = 0) to the bottom (u = 1), its normal, its length */
const A = { x: 0, y: 0 };
const ax = { x: 0, y: 1 };
const nr = { x: 1, y: 0 };
let L = 1;
/** a pull this far aside is a full one (as hard and as bright as it gets) */
let maxPull = 100;
/** how far aside the string follows the finger */
let maxDrag = 200;
/** how far the drawn vibration swings at most */
let reach = 35;
/** how near the string a press has to be to take it */
const HIT = () => (TOUCH ? Math.max(40, w * 0.09) : Math.max(28, w * 0.04));

function resize() {
  dpr = Math.min(window.devicePixelRatio, 2);
  w = window.innerWidth;
  h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  // exactly the window, in pixels: 100vh on a phone is taller than what shows (the address
  // bar), and the drawing would be stretched to fill it
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  nacre.resize(w, h, dpr);
  // top to bottom, centred
  A.x = Math.round(w * 0.5) + 0.5;
  A.y = 0;
  L = h;
  // the notes stop over the bar (a finger there is on a control)
  const bar = document.querySelector('.bar')?.getBoundingClientRect();
  const floor = bar && bar.height > 0 ? bar.top - 28 : h * 0.95;
  lowU = Math.min(0.95, Math.max(0.6, floor / h));
  const side = Math.min(A.x, w - A.x);
  maxPull = Math.min(w * 0.3, h * 0.26, side * 0.6);
  maxDrag = side - 8;
  reach = maxPull * 0.32;
  placeDots(true);
}

const toScreen = (u: number, v: number) => ({ x: A.x + ax.x * u * L + nr.x * v, y: A.y + ax.y * u * L + nr.y * v });
function fromScreen(x: number, y: number) {
  const dx = x - A.x;
  const dy = y - A.y;
  return { u: (dx * ax.x + dy * ax.y) / L, v: dx * nr.x + dy * nr.y };
}
const clampS = (u: number) => Math.min(0.97, Math.max(0.03, u));

// ------------------------------------------------------------------ the note: where along it

/** how many octaves the string spans, bottom to top */
const OCTAVES = 4;
/**
 * The bottom of the string, an octave under the string's root (the key's A): the fourth octave
 * goes down, not up, for more low notes. Everything else (the pad, the groove, the scale) stays
 * on the root.
 */
const BELOW = 12;
const bottom = () => preset().root - BELOW;
/** the highest note sits a little under the top, the lowest just over the bar (set in resize) */
const TOP = 0.05;
let lowU = 0.95;
/** the string's span in semitones: no frets, every height its own pitch */
const SPAN = 12 * OCTAVES;

/** a place along the string to a pitch, in semitones over the bottom (low at the bottom), fretless */
function semisAt(u: number) {
  return Math.max(0, Math.min(SPAN, ((lowU - u) / (lowU - TOP)) * SPAN));
}
/** where along the string a pitch is */
const uAt = (semis: number) => lowU - (semis / SPAN) * (lowU - TOP);

/** the note of the scale nearest midi `m` (a tie goes down, the sadder way) */
const scaleNear = (m: number) => snap(preset(), m);
/** the next note of the scale above midi note `m` */
function stepUp(m: number) {
  let u = Math.floor(m) + 1;
  while (!inScale(u)) u++;
  return u;
}

/**
 * The pitch played at `semis` over the bottom: always a note of the scale, the nearest one (the
 * string has no frets, but every pluck, strike and strum lands on the scale: whatever you do, it
 * sounds good).
 */
function noteFor(semis: number) {
  return scaleNear(bottom() + semis);
}

/**
 * A slide's pitch: no steps, but magnetic. Between two notes of the scale it clings to the one
 * it's nearer and only crosses over in the middle, quickly (t⁴ against (1-t)⁴), so a slide sings
 * the scale with a glissando between its notes, and where the finger rests it settles right on
 * one (settle()).
 */
function glide(semis: number) {
  const m = bottom() + semis;
  let a = Math.floor(m);
  while (!inScale(a)) a--;
  const b = stepUp(a);
  const t = Math.min(1, Math.max(0, (m - a) / (b - a)));
  const k = Math.pow(t, 4) / (Math.pow(t, 4) + Math.pow(1 - t, 4));
  return a + (b - a) * k;
}
/** the nearest note of the scale to a pitch, in semitones over the bottom */
function nearestScale(semis: number) {
  const base = bottom();
  return scaleNear(base + semis) - base;
}

const inScale = (m: number) => inScaleOf(preset(), m);

/**
 * An open chord over `note`, all in the scale: a perfect fifth (or a fourth where the scale has
 * no fifth there: never the tritone a sad scale would hand you), the octave, a third (major or
 * minor, whichever the scale has; else a sus fourth or second) and a ninth on top. Nothing that
 * rubs a semitone against another tone goes in.
 */
function chordTones(note: number) {
  const fifth = inScale(note + 7) ? note + 7 : inScale(note + 5) ? note + 5 : null;
  const third = [4, 3, 5, 2].map((i) => note + 12 + i).find((m) => inScale(m) && m !== (fifth ?? 0) + 12);
  const ninthOk = inScale(note + 14) && (third == null || Math.abs(third - (note + 14)) > 1);
  const top = ninthOk ? note + 14 : fifth ? fifth + 12 : null;
  const out: number[] = [];
  for (const m of [fifth, note + 12, third, top]) {
    if (m == null || !inScale(m) || out.includes(m)) continue;
    if ([note, ...out].some((o) => Math.abs(o - m) === 1)) continue;
    out.push(m);
  }
  return out.sort((x, y) => x - y);
}

// ------------------------------------------------------------------ the sound and its drawing

interface Mode {
  k: number;
  a: number;
  sigma: number;
  hz: number;
  /** a pluck starts from a shape (cos), a strike from a speed (sin) */
  sine: boolean;
}

/** the vibration since the last pluck or strike */
let ring: { modes: Mode[]; t0: number; buzz: number; hushed?: number } | null = null;
/** the dots' notes and the groove's: light ripples on the drawn string, over your own */
let ripple: { modes: Mode[]; t0: number } | null = null;
/** the note it was plucked at, where a slide has taken it since, and the last pitch played (the keys strike that) */
let sounding = { note: 0, slid: 0 };
let lastPitch = 0;
/** what was ringing when the finger came, fading under it */
let residue = 0;
let lastT = 0;
/** a JSON value in localStorage, best effort (private mode, blocked storage: the default) */
function stored<T>(key: string, dflt: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? dflt;
  } catch {
    return dflt;
  }
}
function store(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode: kept for nothing */
  }
}

/**
 * The mixer's levels, 0..1 each, remembered per viewer. The defaults (with wood, tension, no
 * arp): sustain a bit long, a big room, a whisper of pad, the flageolets up, the delay half way.
 * - sustain: a quarter of each string's ring time at the bottom, four times at the top
 * - room: the reverb's level (none at the bottom, the preset's own in the middle, two and a half
 *   times at the top) and the length of the room (half to one and a half times)
 * - pad: 0 is off; half way is its own level
 * - harm: the flageolets, none at the bottom, their own level in the middle, twice at the top
 * - delay: the string's own echo, none at the bottom
 */
const LEVELS_KEY = 'codevember-14-bar';
const level: Record<LevelKey, number> = { sustain: 0.675, room: 0.86, pad: 0.18, harm: 0.77, delay: 0.5, ...stored(LEVELS_KEY, {}) };
let roomTimer = 0;
let saveTimer = 0;
const applyLevel: Record<LevelKey, (t: number) => void> = {
  sustain: (t) => (decay.sustain = Math.pow(4, 2 * t - 1)),
  room: (t) => {
    tune.wet = t <= 0.5 ? 2 * t : 1 + (t - 0.5) * 3;
    tune.size = 0.5 + t;
    engine?.applyMix();
    // a new length once the knob rests a moment (a room is a few seconds of noise to make)
    clearTimeout(roomTimer);
    roomTimer = window.setTimeout(() => engine?.resizeRoom(), 250);
  },
  pad: () => engine && applyPad(engine),
  harm: (t) => (tune.harm = 2 * t),
  delay: (t) => engine?.setDelay(t),
};
/** a level set: applied, remembered (once it rests), and shown on the mixer unless it came from there */
function setLevel(key: LevelKey, t: number, fromMixer = false) {
  level[key] = Math.min(1, Math.max(0, t));
  applyLevel[key](level[key]);
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => store(LEVELS_KEY, level), 300);
  if (!fromMixer) ui?.showLevel(key, level[key]);
}
for (const key of Object.keys(applyLevel) as LevelKey[]) applyLevel[key](level[key]);
/** P: the pad off, or back where it was */
let padWas = level.pad || 0.5;
function togglePad() {
  if (level.pad > 0) (padWas = level.pad), setLevel('pad', 0);
  else setLevel('pad', padWas);
}
/** D: the delay's next step: off, then echoes, fewer or more */
const DELAYS = [
  { label: 'Off', t: 0 },
  { label: 'Light', t: 0.25 },
  { label: 'Medium', t: 0.5 },
  { label: 'Deep', t: 0.85 },
];
function nextDelay() {
  const near = DELAYS.reduce((best, d, j) => (Math.abs(d.t - level.delay) < Math.abs(DELAYS[best].t - level.delay) ? j : best), 0);
  const next = DELAYS[(near + 1) % DELAYS.length];
  setLevel('delay', next.t);
  return next.label;
}
/** 0 is off; half way is its own level */
function applyPad(e: Engine) {
  e.pad.amount = level.pad * 2 * tune.pad;
  e.pad.setOn(level.pad > 0);
}
/** a strike's light, a moment after it */
let stick: { u: number; t: number } | null = null;

let ui: ReturnType<typeof createUi> | null = null;

/** the visible modes, from the partials the sound got */
function modesFrom(parts: Partials, shape: (k: number) => number, sine: boolean): Mode[] {
  const f0 = parts.freqs[0] ?? 100;
  // fast enough to read as a taut wire: the frame rate turns the overtones into a shimmer
  const base = 9 * Math.sqrt(f0 / midiHz(preset().root)) * look.speed;
  const out: Mode[] = [];
  for (let k = 1; k <= 14; k++) {
    const i = Math.min(k, parts.freqs.length) - 1;
    const ratio = parts.freqs[i] / f0 || k;
    out.push({ k, a: shape(k), sigma: parts.sigmas[i] ?? 3, hz: base * Math.pow(ratio, 0.9), sine });
  }
  return out;
}

/** `s`: where along the string it was let go; `d`: how far aside; `deg`: the pitch (semitones over the bottom) */
function pluck(s: number, d: number, deg: number, force: number) {
  const note = noteFor(deg);
  s = clampS(s);
  const parts = engine?.pluck({ note, pos: s, kind: 'pluck', force }) ?? localPartials(note);
  // a triangle let go: its Fourier sine series (the drawing swings no wider than the reach)
  const dd = Math.sign(d) * Math.min(Math.abs(d), reach * 1.5);
  rang(note, deg, force, s, modesFrom(parts, (k) => (2 * dd * Math.sin(k * Math.PI * s)) / (k * k * Math.PI * Math.PI * s * (1 - s)), false));
}

/** the string rang: what the drawing shows, what sounds now, the groove fed, the hint gone */
function rang(note: number, deg: number, force: number, s: number, modes: Mode[]) {
  ring = { modes, t0: performance.now() / 1000, buzz: preset().buzz * tune.buzz };
  sounding = { note, slid: 0 };
  lastPitch = deg;
  played(note, force, s);
  hideHint();
}

function strike(s: number, deg: number, force = 0.65) {
  const note = noteFor(deg);
  s = clampS(s);
  const parts = engine?.pluck({ note, pos: s, kind: 'strike', force }) ?? localPartials(note);
  const amp = reach * 0.45 * (0.4 + 0.6 * force);
  const raw = (k: number) => (Math.sin(k * Math.PI * s) * Math.exp(-k / 9)) / k;
  let n = 0;
  for (let k = 1; k <= 14; k++) n += Math.abs(raw(k));
  stick = { u: s, t: performance.now() / 1000 };
  rang(note, deg, force, s, modesFrom(parts, (k) => (amp * raw(k)) / (n || 1), true));
}

/** a light re-pluck of the drawn string (a dot's note, the groove's), on top of your own */
function rippleAt(s: number, parts: Partials, f: number, scale = 0.1) {
  const amp = reach * scale * (0.4 + 0.6 * f);
  const raw = (k: number) => Math.sin(k * Math.PI * s) / k;
  let n = 0;
  for (let k = 1; k <= 10; k++) n += Math.abs(raw(k));
  ripple = { modes: modesFrom(parts, (k) => (k <= 10 ? (amp * raw(k)) / (n || 1) : 0), true), t0: performance.now() / 1000 };
}

/** every note played feeds the groove (when it's on) */
function played(note: number, force: number, s: number) {
  lastPos = s;
  // (it remembers notes of the scale: a pitch between them goes to the nearest)
  if (engine) groove.feed(snap(preset(), note), force, engine.ctx.currentTime);
}

/** before the sound is up (or without it): the same partials, for the drawing alone */
function localPartials(note: number): Partials {
  const f0 = midiHz(note);
  const pr = preset();
  const freqs: number[] = [];
  const sigmas: number[] = [];
  for (let k = 1; k <= 14; k++) {
    const r = pr.ratios ? (pr.ratios[k - 1] ?? k) : k;
    freqs.push(f0 * r);
    const t60 = pr.t60 * decay.sustain;
    const sg = 6.91 / t60 + (6.91 / (pr.t60hi * decay.sustain) - 6.91 / t60) * ((f0 * r) / 3000) ** 2;
    sigmas.push(sg);
  }
  return { freqs, amps: [], sigmas, modes: [] };
}

let hinted = false;
/** where the call to action sits on the string, before the first pluck, and how far it sways (px) */
const CTA_U = 0.55;
const ctaSway = (t: number) => 5 * Math.sin(t * 1.7) * Math.min(1, t / 1.5);
/** a string held aside at `s`: how far along the way it is at `x` (two straight lines, 1 at `s`) */
const tri = (x: number, s: number) => (x < s ? x / s : (1 - x) / (1 - s));
/** before the first pluck: a ring pulsing on the string where it sways, an invitation to take it */
function drawCta(t: number) {
  if (grab.on || pend.on) return;
  const p = toScreen(CTA_U, ctaSway(t));
  const k = (t * 0.7) % 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(244, 244, 242, ${0.55 * (1 - k)})`;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 8 + 22 * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = `rgba(244, 244, 242, ${0.5 + 0.25 * Math.sin(t * 4.4)})`;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function hideHint() {
  if (hinted) return;
  hinted = true;
  hint?.classList.add('gone');
}

// ------------------------------------------------------------------ the dots

/**
 * Dots in the dark on both sides of the string, in four groups: each group is a chord of the
 * scale (i, then a VI or iv, a v, a III, whichever the scale has), every dot at the height of its
 * note on the string. Drag the string aside through a group and it catches on each dot, bends
 * round it for a few pixels and slips off with that dot's note: a broken chord, like a harp.
 */
interface Dot {
  x: number;
  y: number;
  /** where it's going (a new scale moves them) */
  tx: number;
  ty: number;
  note: number;
  chord: number;
  /** 0 free, 1 caught (the string bends round it), 2 passed (the string is beyond it) */
  state: 0 | 1 | 2;
  /** the string's place against it last frame: + beyond it, − not there yet (NaN: no string) */
  rel: number;
  flash: number;
}
const dots: Dot[] = [];
/** how far the string bends round a dot before it slips off */
const SNAG_PX = 10;
/** the chords' roots, in semitones over the first one: the first that the scale has from each group */
const ROOTS = [[0], [8, 9, 5], [7, 5], [3, 4, 10, 2], [5, 4, 2], [10, 11, 1]];
/**
 * The note the chords are built on (semitones over the bottom, a note of the scale): where the
 * finger is on the string. Take it, or slide, somewhere else and the dots glide to that note's
 * chords.
 */
let dotRoot = 0;
/** a stable scatter, 0..1, from a number */
function starHash(n: number) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function setDotRoot(semis: number) {
  const r = nearestScale(semis);
  if (r === dotRoot) return;
  dotRoot = r;
  placeDots();
}

/**
 * And where the finger holds the string colours those chords a little: at each note of the scale along it, a different tone of every chord (never its root)
 * moves a step of the scale, a sus, an add9, a sixth, a seventh, whichever rubs a semitone
 * against none of the rest. Move along and the same sweep is a slightly different chord.
 */
function vary(d: Dot) {
  if (!grab.on) return d.note;
  const tones = dots.filter((x) => x.chord === d.chord).map((x) => x.note).sort((a, b) => a - b);
  const i = tones.indexOf(d.note);
  if (i <= 0) return d.note;
  // which note of the scale the finger is at, counted from the bottom
  const low = bottom();
  const near = low + nearestScale(grab.deg);
  let zone = 0;
  for (let m = low; m < near; m++) if (inScale(m)) zone++;
  if ((zone + i) % tones.length !== 0) return d.note;
  // a step of the scale up, else down, else two up: the first that rubs against none of the
  // others in any octave (no b9, no major seventh, no doubling)
  const step = (m: number, n: number) => {
    const dir = Math.sign(n);
    for (let k = 0; k < Math.abs(n); k++) {
      m += dir;
      while (!inScale(m)) m += dir;
    }
    return m;
  };
  const others = tones.filter((o) => o !== d.note);
  const rubs = (m: number) => others.some((o) => [0, 1, 11].includes(pc(o - m)));
  return [step(d.note, 1), step(d.note, -1), step(d.note, 2)].find((m) => !rubs(m) && m > tones[0]) ?? d.note;
}

function placeDots(jump = false) {
  if (!w) return;
  // (on a wide screen they stay near the string, within reach of a pull, not out at the edges)
  const half = Math.min(A.x, w - A.x, 340) - 20;
  const out: Omit<Dot, 'state' | 'rel' | 'flash' | 'x' | 'y'>[] = [];
  const used: number[] = [];
  const p = preset();
  const low = bottom();
  const top = low + SPAN;
  (SCALES[scaleIdx].roots ?? ROOTS).forEach((alts, c) => {
    const r = alts.find((x) => inScale(low + dotRoot + x) && !used.includes(x));
    if (r == null) return;
    used.push(r);
    let root = low + dotRoot + r;
    while (root > top - 7) root -= 12;
    // what would go past the top comes down an octave
    const tones = [root, ...chordTones(root)]
      .map((m) => (m > top ? m - 12 * Math.ceil((m - top) / 12) : m))
      .filter((m, i, a) => m >= low && a.indexOf(m) === i)
      .sort((x, y) => x - y);
    // left and right in turn, near to far; every dot at its note's height, but scattered
    // sideways like stars (the same scatter for the same chord and note, so they don't jump)
    const side = c % 2 ? 1 : -1;
    const band = [0.24, 0.24, 0.5, 0.5, 0.76, 0.76][c] ?? 0.5;
    tones.forEach((m, i) => {
      const u = uAt(m - bottom());
      const r = starHash(c * 131 + m * 7 + i);
      const off = Math.max(34, Math.min(half, (band + (r - 0.5) * 0.34) * half));
      out.push({ tx: A.x + side * off, ty: u * h, note: m, chord: c });
    });
  });
  // the same dots move to their new places; a new count starts over
  if (out.length !== dots.length) {
    dots.length = 0;
    for (const o of out) dots.push({ ...o, x: o.tx, y: o.ty, state: 0, rel: NaN, flash: -10 });
    return;
  }
  out.forEach((o, i) => {
    Object.assign(dots[i], o);
    if (jump) {
      dots[i].x = o.tx;
      dots[i].y = o.ty;
    }
  });
}

/** the held string's place (aside) at `u`: two straight lines to the finger */
const triAt = (u: number) => (grab.on ? grab.d * tri(u, grab.s) : 0);

function updateDots(dt: number, t: number) {
  const k = 1 - Math.exp(-dt / 0.35);
  for (const d of dots) {
    d.x += (d.tx - d.x) * k;
    d.y += (d.ty - d.y) * k;
  }
  if (!grab.on) {
    for (const d of dots) {
      d.state = 0;
      d.rel = NaN;
    }
    return;
  }
  for (const d of dots) {
    const u = d.y / h;
    const dv = d.x - A.x;
    // the string against the dot, along the way it was going: beyond it is the same side as it
    const rel = (triAt(u) - dv) * Math.sign(dv);
    if (d.state === 1) {
      if (rel < 0) d.state = 0;
      else if (rel > SNAG_PX) {
        // it slips off: that dot's note, as hard as the string was moving
        const speed = Math.abs(rel - d.rel) / Math.max(0.004, dt);
        const force = Math.min(0.9, Math.max(0.3, 0.3 + speed / 900));
        d.state = 2;
        d.flash = t;
        // the light answers: a swell out from the dot's height
        nacre.poke(clampS(u), 0.9 + 0.6 * force, t);
        const note = vary(d);
        audio().then((e) => {
          if (!e) return;
          // (its own voice: it rings on under the string's next pluck, and with the others)
          e.chordNote(note, force, clampS(u), e.ctx.currentTime);
          rippleAt(clampS(u), localPartials(note), force, 0.16);
        });
        sounding = { note, slid: 0 };
        played(note, force, u);
        navigator.vibrate?.(5);
      }
    } else if (d.state === 2) {
      // the string came back past it: it lets go of it the way it came, without a sound
      if (rel < 0) d.state = 0;
    } else if (!Number.isNaN(d.rel) && d.rel < 0 && rel >= 0) {
      // the string just swept onto it: it catches (a faint touch of light already)
      d.state = 1;
      nacre.poke(clampS(u), 0.35, t);
    }
    d.rel = rel;
  }
}

// ------------------------------------------------------------------ pointer

/** the finger on the string: where along it (0..1), the pull now, the pull wanted, the note */
const grab = { on: false, s: 0.5, d: 0, want: 0, raw: 0, deg: 0, crossed: false, id: -1, t0: 0, x0: 0, y0: 0, fx: 0, fy: 0, moved: 0, auto: false, peak: 0, lastS: 0.5, lastT: 0 };
/** a press on the string waits to see which way it goes: aside a pull, along a slide, nowhere a tap */
const pend = { on: false, id: -1, x0: 0, y0: 0, u: 0, v: 0, t0: 0, muted: false };
/** how far aside a sliding finger goes before it takes the string */
const SIDE = 16;
/** how long a finger rests still on the string before it stops what rings (a tap is quicker) */
const MUTE_MS = 260;
/** a press off the string: a tap there is the next scale, a sweep across it a strum */
const away = { on: false, id: -1, x0: 0, y0: 0, v: NaN, u: 0, t: 0, wah: false, fy: 0 };
/** a finger sliding along the string (what rings goes with it, flageolets at the nodes) */
const mod = { on: false, id: -1, fx: 0, fy: 0, lastS: 0.5, glint: -10, solo: false };
/**
 * More fingers, down while another one is: each its own player. Aside and let go, a pluck; a
 * tap, a strike; back over the string, a pluck there. Each note rings on its own (with the
 * others, and with what the first finger plays): chords with two hands. Along the string, a
 * finger slides what rings instead.
 */
const extras = new Map<number, { x0: number; y0: number; u: number; v: number; peak: number; mode: 'wait' | 'pull'; fx: number; fy: number }>();
const ringing = () => !!ring && !!sounding.note;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  audio();
  const { u, v } = fromScreen(e.clientX, e.clientY);
  const busy = (grab.on && !grab.auto) || away.on || pend.on;
  if (e.pointerType !== 'mouse' && (busy || mod.on)) {
    // another finger: a player of its own
    canvas.setPointerCapture(e.pointerId);
    extras.set(e.pointerId, { x0: e.clientX, y0: e.clientY, u, v, peak: Math.abs(v), mode: 'wait', fx: e.clientX, fy: e.clientY });
    return;
  }
  if (grab.on || pend.on || away.on) return;
  canvas.setPointerCapture(e.pointerId);
  if (Math.abs(v) > HIT()) {
    Object.assign(away, { on: true, id: e.pointerId, x0: e.clientX, y0: e.clientY, v, u, t: performance.now(), wah: false, fy: e.clientY });
    return;
  }
  // a finger on the string makes no sound yet: it waits to see which way it goes (aside a pull,
  // along a slide, nowhere a tap)
  Object.assign(pend, { on: true, id: e.pointerId, x0: e.clientX, y0: e.clientY, u, v, t0: performance.now(), muted: false });
});

/** `u`: where along the string (0 the top, 1 the bottom) */
function startGrab(u: number, v: number, id: number, auto: boolean) {
  // a hand on a ringing string: it stops (the drawing keeps a ghost of it for a moment)
  if (ring) residue = 1;
  engine?.damp(0.05);
  grab.on = true;
  grab.auto = auto;
  grab.s = clampS(u);
  grab.deg = semisAt(u);
  setDotRoot(grab.deg);
  grab.lastS = grab.s;
  grab.lastT = performance.now();
  lastNode = -1;
  grab.id = id;
  grab.t0 = performance.now();
  grab.moved = 0;
  grab.crossed = false;
  grab.peak = Math.abs(v);
  setPull(v);
  // starts where the string is, not where the finger is: it's taken up in a few ms
  grab.d = 0;
  navigator.vibrate?.(4);
}

/** the pull is how hard (and where along it, the colour); where along it is the note */
function setPull(v: number) {
  grab.raw = v;
  // the string follows the finger aside, all the way to the edge
  grab.want = Math.max(-maxDrag, Math.min(maxDrag, v));
  if (!grab.auto) engine?.pad.pull(Math.min(1, Math.abs(v) / maxPull));
}

// (on the window: a finger whose capture iOS drops still gets here)
window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' && e.buttons === 0) {
    hoverStrum(e);
    return;
  }
  if (mod.on && e.pointerId === mod.id) {
    moveMod(e);
    return;
  }
  if (extras.has(e.pointerId)) {
    moveExtra(e);
    return;
  }
  if (pend.on && e.pointerId === pend.id) {
    const dx = e.clientX - pend.x0;
    const dy = e.clientY - pend.y0;
    if (Math.abs(dy) > 14 && Math.abs(dy) > 1.4 * Math.abs(dx)) {
      // along the string: a slide (what rings goes with the finger, flageolets at the nodes)
      pend.on = false;
      startSlide(e, pend.u, true);
    } else if (Math.abs(dx) > 8) {
      // aside: a new pull, from where the finger came down
      pend.on = false;
      startGrab(pend.u, pend.v, pend.id, false);
      grab.x0 = pend.x0;
      grab.y0 = pend.y0;
      grab.t0 = pend.t0;
      moveGrab(e);
    }
    return;
  }
  if (away.on && e.pointerId === away.id) {
    // up or down the background: the wah, the finger's height its sweep; across: a strum
    const dx = e.clientX - away.x0;
    const dy = e.clientY - away.y0;
    if (!away.wah && Math.abs(dy) > 14 && Math.abs(dy) > 1.4 * Math.abs(dx)) away.wah = true;
    if (away.wah) {
      away.fy = e.clientY;
      engine?.wah(1 - e.clientY / h);
    } else strum(e);
    return;
  }
  if (grab.on && !grab.auto && e.pointerId === grab.id) moveGrab(e);
});

function moveGrab(e: PointerEvent) {
  grab.moved = Math.max(grab.moved, Math.hypot(e.clientX - grab.x0, e.clientY - grab.y0));
  grab.fx = e.clientX;
  grab.fy = e.clientY;
  const q = fromScreen(e.clientX, e.clientY);
  // up and down it: the pitch goes with the finger, no frets; flageolets at the nodes
  grab.s = clampS(q.u);
  grab.deg = semisAt(q.u);
  const now = performance.now();
  const ds = Math.abs(grab.s - grab.lastS);
  if (ds * L > 1.5) {
    const note = glide(grab.deg);
    // plucked by a crossing and still held: what rings slides with the finger
    if (grab.crossed && ringing()) slideTo(note);
    passNodes(grab.lastS, grab.s, (ds * L) / Math.max(4, now - grab.lastT));
    setDotRoot(grab.deg);
    grab.lastS = grab.s;
    grab.lastT = now;
  }
  const uc = grab.peak > 12 ? crossAt(grab.s, grab.raw, q.u, q.v) : null;
  if (uc != null) {
    // pulled, then back over the string: it slips off the finger, a pluck right there, and the
    // finger keeps it: it's pulled the other way now, and every crossing after plucks again
    const force = pullForce(grab.peak, 0.2);
    const sgn = Math.sign(grab.raw);
    const deg = grab.deg;
    audio().then(() => pluckAt(clampS(uc), sgn, force, deg));
    navigator.vibrate?.(4);
    grab.crossed = true;
    grab.peak = Math.abs(q.v);
    setPull(q.v);
    return;
  }
  grab.peak = Math.max(grab.peak, Math.abs(q.v));
  setPull(q.v);
}

/** a finger sweeping across the string: each crossing plucks it there, as hard as it was fast */
function strum(e: PointerEvent) {
  const q = fromScreen(e.clientX, e.clientY);
  const now = performance.now();
  const uc = crossAt(away.u, away.v, q.u, q.v);
  if (uc != null && uc > 0.01 && uc < 0.99) {
    const speed = Math.abs(q.v - away.v) / Math.max(4, now - away.t);
    const force = Math.min(1, Math.max(0.15, speed / 1.6));
    const sgn = Math.sign(away.v);
    audio().then(() => {
      pluckAt(clampS(uc), sgn, force);
      engine?.pad.pull(0);
    });
    navigator.vibrate?.(4);
  }
  away.v = q.v;
  away.u = q.u;
  away.t = now;
}

/**
 * A mouse moving over the string without a click (once the sound is up: a browser wants a click
 * first): each crossing plucks it there, as hard as the mouse was fast, like a finger brushing it.
 */
const hover = { v: NaN, u: 0, t: 0 };
function hoverStrum(e: PointerEvent) {
  const q = fromScreen(e.clientX, e.clientY);
  const now = performance.now();
  const over = e.target === canvas && !grab.on && !away.on && !pend.on && engine && ac?.state === 'running';
  const uc = over && now - hover.t < 120 ? crossAt(hover.u, hover.v, q.u, q.v) : null;
  if (uc != null && uc > 0.01 && uc < lowU + 0.01) {
    // px per ms: a slow drift is a soft touch, a flick a hard pluck
    const speed = Math.abs(q.v - hover.v) / Math.max(4, now - hover.t);
    pluckAt(clampS(uc), Math.sign(hover.v), Math.min(1, Math.max(0.12, speed / 2.2)));
  }
  hover.v = over ? q.v : NaN;
  hover.u = q.u;
  hover.t = now;
}

/** another finger moving: along the string it slides (if nothing else does), aside it pulls */
function moveExtra(e: PointerEvent) {
  const x = extras.get(e.pointerId)!;
  x.fx = e.clientX;
  x.fy = e.clientY;
  const dx = e.clientX - x.x0;
  const dy = e.clientY - x.y0;
  const q = fromScreen(e.clientX, e.clientY);
  if (x.mode === 'wait') {
    if (!mod.on && Math.abs(dy) > 14 && Math.abs(dy) > 1.6 * Math.abs(dx) && Math.abs(q.v) < HIT() * 1.6) {
      extras.delete(e.pointerId);
      startSlide(e, x.u, false);
      return;
    }
    if (Math.abs(dx) > 8) x.mode = 'pull';
  }
  if (x.mode !== 'pull') return;
  const uc = x.peak > 12 ? crossAt(x.u, x.v, q.u, q.v) : null;
  if (uc != null) {
    // back over the string: a pluck right there, and it keeps going
    extraNote(clampS(uc), pullForce(x.peak, 0.2));
    x.peak = 0;
  }
  x.v = q.v;
  x.u = q.u;
  x.peak = Math.max(x.peak, Math.abs(q.v));
}

/** another finger's note: its own voice, ringing along with everything else */
function extraNote(u: number, force: number) {
  const note = noteFor(semisAt(u));
  audio().then((e) => {
    if (!e) return;
    e.chordNote(note, force, u, e.ctx.currentTime);
    rippleAt(u, localPartials(note), force, 0.3);
  });
  played(note, force, u);
  navigator.vibrate?.(4);
}

function moveMod(e: PointerEvent) {
  mod.fx = e.clientX;
  mod.fy = e.clientY;
  const q = fromScreen(mod.fx, mod.fy);
  if (mod.solo && !grab.on && Math.abs(q.v) > SIDE) {
    // sliding, then aside: it takes the string there, a pull (let go and it plucks)
    const id = mod.id;
    endMod();
    startGrab(clampS(q.u), q.v, id, false);
    grab.x0 = grab.fx = e.clientX;
    grab.y0 = grab.fy = e.clientY;
    return;
  }
  slide(clampS(q.u), e.timeStamp);
}

/** a finger starts sliding along the string at `u` (solo: the only one, so aside it takes the string) */
function startSlide(e: PointerEvent, u: number, solo: boolean) {
  Object.assign(mod, { on: true, id: e.pointerId, fx: e.clientX, fy: e.clientY, lastS: clampS(u), solo });
  lastSlideT = e.timeStamp;
  lastNode = -1;
  moveMod(e);
}

/** where a move from (u0, v0) to (u1, v1) crossed the string (v changed side), along it; else null */
function crossAt(u0: number, v0: number, u1: number, v1: number) {
  if (!v0 || !v1 || Math.sign(v0) === Math.sign(v1)) return null;
  return u0 + (u1 - u0) * (v0 / (v0 - v1));
}
/** a pluck at `u`, let go from side `sgn`, as hard as `force` (at the pitch `deg`, by default the place's) */
const pluckAt = (u: number, sgn: number, force: number, deg = semisAt(u)) => pluck(u, sgn * reach * (0.25 + 0.5 * force), deg, force);
/** a pull of `px` aside as a force, never under `min` */
const pullForce = (px: number, min = 0) => Math.min(1, Math.max(min, Math.abs(px) / maxPull));

/**
 * The harmonic nodes along the string: k/n for n up to 5 (k and n with no common factor): the
 * octave, the twelfth, two octaves, two octaves and a third over what rings.
 */
const NODES: Array<{ at: number; n: number }> = [];
for (let n = 2; n <= 5; n++) {
  for (let k = 1; k < n; k++) {
    let a = k;
    let b = n;
    while (b) [a, b] = [b, a % b];
    if (a === 1) NODES.push({ at: k / n, n });
  }
}
let lastSlideT = 0;

/**
 * A finger sliding along the string: no sound of its own, no frets. What rings goes along with
 * it, and where it passes a node, a flageolet, soft, like a guitar's: that harmonic of what rings
 * (or of the nearest note of the scale, when nothing does).
 */
function slide(s: number, tms: number) {
  const was = mod.lastS;
  const speed = (Math.abs(s - was) * L) / Math.max(4, tms - lastSlideT);
  lastSlideT = tms;
  mod.lastS = s;
  const note = glide(semisAt(s));
  lastPitch = semisAt(s);
  if (ringing()) slideTo(note);
  setDotRoot(semisAt(s));
  if (passNodes(was, s, speed)) mod.glint = performance.now() / 1000;
}

/** what rings, taken to `note` by the finger (it settles on the scale once the finger rests) */
let slideAt = 0;
let settled = true;
function slideTo(note: number) {
  sounding.slid = note - sounding.note;
  engine?.slide(sounding.slid, 0.05);
  slideAt = performance.now();
  settled = false;
}
/** the finger rests or lifts: what it slid settles onto the nearest note of the scale */
function settle() {
  settled = true;
  if (!ringing()) return;
  const at = sounding.note + sounding.slid;
  const to = scaleNear(at);
  if (Math.abs(to - at) < 0.005) return;
  sounding.slid = to - sounding.note;
  engine?.slide(sounding.slid, 0.07);
}

/** the node last passed, so a finger that wobbles on one doesn't ring it again and again */
let lastNode = -1;
/** a slide from `was` to `s` (along, 0..1): a flageolet at each node it passes; true when one rang */
function passNodes(was: number, s: number, speed: number) {
  let rang = false;
  NODES.forEach((nd, i) => {
    if (i === lastNode || (nd.at - was) * (nd.at - s) > 0) return;
    lastNode = i;
    rang = true;
    // (of the note of the scale nearest what rings, or under the finger: always in tune)
    const base = scaleNear(ringing() ? sounding.note + sounding.slid : bottom() + semisAt(s));
    const force = Math.min(1, 0.3 + speed / 3);
    audio().then((e) => e?.harmonic(base, nd.n, force));
    navigator.vibrate?.(3);
  });
  return rang;
}

function endMod() {
  settle();
  mod.on = false;
  mod.id = -1;
}

/** the held string let go of (no pluck: that's the caller's) */
function releaseGrab() {
  grab.on = false;
  grab.id = -1;
  engine?.pad.pull(0);
}

function endPointer(e: PointerEvent, cancel: boolean) {
  if (mod.on && e.pointerId === mod.id) {
    endMod();
    return;
  }
  const x = extras.get(e.pointerId);
  if (x) {
    extras.delete(e.pointerId);
    if (cancel || Math.abs(x.v) > HIT() * 6) return;
    // pulled and let go: a pluck, as hard as it was pulled (just past a crossing, barely pulled,
    // the crossing's note rings on); never moved: a strike
    if (x.mode === 'pull') {
      if (x.peak > 14) extraNote(clampS(x.u), pullForce(x.v, 0.2));
    } else if (Math.abs(x.v) < HIT() * 1.6) extraNote(clampS(x.u), 0.55);
    return;
  }
  if (away.on && e.pointerId === away.id) {
    away.on = false;
    // (a tap on the background does nothing: the string and the scale are in the bar)
    if (away.wah) engine?.wah(null);
    away.wah = false;
    return;
  }
  if (pend.on && e.pointerId === pend.id) {
    // it never went anywhere: a tap, a strike (held still, it only stopped what rang)
    pend.on = false;
    if (cancel || pend.muted) return;
    const { u } = pend;
    const deg = semisAt(u);
    audio().then(() => strike(u, deg, 0.6));
    return;
  }
  if (!grab.on || grab.auto || e.pointerId !== grab.id) return;
  releaseGrab();
  if (cancel) return;
  const quick = performance.now() - grab.t0 < 230 && grab.moved < 8;
  const { s, d, raw, deg } = grab;
  // just past a crossing, barely pulled: let the crossing's pluck ring, no soft one over it
  if (grab.crossed && Math.abs(raw) < 14) return;
  // (the very first press waits for the sound to come up: a few ms)
  audio().then(() => {
    if (quick) strike(s, deg, 0.6);
    else pluck(s, d, deg, pullForce(raw));
  });
}
window.addEventListener('pointerup', (e) => endPointer(e, false));
window.addEventListener('pointercancel', (e) => endPointer(e, true));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// the last finger up and something still thinks it's held: a lift that never came (iOS loses
// one now and then, a button pressed at the same time). Let go of it all, after the pointer
// events of that lift have had their turn
let fingers = 0;
window.addEventListener('touchstart', (e) => (fingers = e.touches.length), { passive: true });
const lifted = (e: TouchEvent) => {
  fingers = e.touches.length;
  if (fingers) return;
  setTimeout(() => {
    if (fingers) return;
    if (away.wah) engine?.wah(null);
    away.on = away.wah = pend.on = false;
    if (mod.on) endMod();
    extras.clear();
    if (grab.on && !grab.auto) releaseGrab();
  }, 120);
};
window.addEventListener('touchend', lifted, { passive: true });
window.addEventListener('touchcancel', lifted, { passive: true });

// ------------------------------------------------------------------ keys

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.code === 'KeyC' && !String(getSelection() ?? '')) {
    e.preventDefault();
    void copySettings();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.code === 'KeyP') {
    e.preventDefault();
    navigator.clipboard?.readText().then(pasteSettings, () => ui?.toast('Paste with cmd+V'));
    return;
  }
  if (e.metaKey || e.ctrlKey) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (e.repeat) return;
    audio().then(() => strike(uAt(lastPitch), lastPitch, 0.7));
  } else if (e.code === 'KeyA') {
    arpCycle();
  } else if (e.code === 'KeyD') {
    ui?.toast(`Delay ${nextDelay()}`);
  } else if (e.code === 'KeyS') {
    scaleCycle();
  } else if (e.code === 'KeyP') {
    togglePad();
  } else if (/^Digit[0-9]$/.test(e.code)) {
    const n = Number(e.code.slice(5));
    // with shift: save a snapshot; alone: recall one (with cmd, ctrl or alt: the browser's)
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.shiftKey) saveSlot(n);
    else recallSlot(n);
  } else return;
  audio();
});

function setPreset(i: number) {
  const was = preset();
  presetIdx = (i + PRESETS.length) % PRESETS.length;
  // same key, another octave maybe: what the groove remembers moves with it
  const shift = preset().root - was.root;
  if (shift) groove.retune((n) => n + shift);
  engine?.setPreset(preset());
  ui?.setPreset(presetIdx);
  placeDots();
}

// ------------------------------------------------------------------ the arpeggiator

const groove = new Groove();
/** where the last note was played: the groove plays there too (the same brightness) */
let lastPos = 0.3;
/** the groove's notes waiting for their time, to re-pluck the drawn wire */
const hits: { t: number; parts: Partials; f: number }[] = [];

let scaleIdx = 0;
function scaleCycle() {
  setScale((scaleIdx + 1) % SCALES.length);
}
function setScale(i: number) {
  scaleIdx = i;
  applyScale(scaleIdx);
  ui?.setScale(scaleIdx);
  // everything moves into the new scale: the groove's notes, the pad, the dots (they glide to
  // their new chords); what still rings in the old one lets go softly
  groove.retune((n) => snap(preset(), n));
  dotRoot = nearestScale(dotRoot);
  placeDots();
  if (engine) {
    engine.pad.setPreset(preset());
    engine.rescale();
  }
}

/** off → each pattern → off */
/**
 * Snapshots: shift and a digit saves everything the bar sets (the string, the scale, the delay,
 * the arp, the four levels) under that digit; the digit alone brings it back. Remembered per
 * viewer.
 */
type Snapshot = { preset: string; scale: string; arp: number } & Record<LevelKey, number>;
const SLOTS = 'codevember-14-slots';
const slots = () => stored<Record<string, Snapshot>>(SLOTS, {});
/** everything the bar and the mix set, now */
const snapshot = (): Snapshot => ({ preset: preset().id, scale: SCALES[scaleIdx].id, arp: groove.mode, ...level });
function saveSlot(n: number) {
  store(SLOTS, { ...slots(), [n]: snapshot() });
  ui?.toast(`Saved ${n}`);
}
function recallSlot(n: number) {
  const s = slots()[n];
  if (!s) return void ui?.toast(`${n} is empty`);
  applySnapshot(s);
  ui?.toast(`${n} · ${preset().label} · ${SCALES[scaleIdx].label}`);
}
function applySnapshot(s: Snapshot) {
  const pi = PRESETS.findIndex((p) => p.id === s.preset);
  if (pi >= 0) setPreset(pi);
  const si = SCALES.findIndex((x) => x.id === s.scale);
  if (si >= 0) setScale(si);
  setArp(Math.max(-1, Math.min(PATTERNS.length - 1, s.arp)));
  for (const [key] of LEVELS) setLevel(key, s[key]);
}

/** cmd+C: the settings as JSON on the clipboard (unless text is selected); cmd+P (or a paste): back */
async function copySettings() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(snapshot(), null, 2));
    ui?.toast('Settings copied');
  } catch {
    ui?.toast('Could not copy');
  }
}
function pasteSettings(text: string) {
  try {
    const v = JSON.parse(text) as Partial<Snapshot>;
    const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);
    if (typeof v !== 'object' || !v || (!v.preset && !v.scale)) throw new Error('not settings');
    const levels = Object.fromEntries(LEVELS.map(([key]) => [key, num(v[key], level[key])])) as Record<LevelKey, number>;
    applySnapshot({
      preset: String(v.preset ?? preset().id),
      scale: String(v.scale ?? SCALES[scaleIdx].id),
      arp: typeof v.arp === 'number' ? Math.round(v.arp) : groove.mode,
      ...levels,
    });
    ui?.toast(`Settings applied · ${preset().label} · ${SCALES[scaleIdx].label}`);
  } catch {
    ui?.toast('No settings on the clipboard');
  }
}
window.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text') ?? '';
  if (text.trim().startsWith('{')) pasteSettings(text);
});

function arpCycle() {
  setArp(groove.mode >= PATTERNS.length - 1 ? -1 : groove.mode + 1);
}
function setArp(mode: number) {
  groove.mode = mode;
  ui?.setArp(mode);
}

/** every frame: schedule the next notes a little ahead, and ripple the drawn wire on time */
function arpTick() {
  const e = engine;
  if (!e) return;
  const now = e.ctx.currentTime;
  while (hits.length && hits[0].t <= now) {
    const hh = hits.shift()!;
    // subtle, so your own plucks stay readable
    rippleAt(lastPos, hh.parts, hh.f);
  }
  // (scheduled only a little ahead: a pluck re-times what comes after it)
  groove.tick(now, 0.05, e.pad.notes, preset().root, (hit: Hit) => {
    // whatever happened since, it only ever plays in the scale
    const note = snap(preset(), hit.note);
    hits.push({ t: hit.when, parts: e.arpNote(note, hit.force, lastPos, hit.when), f: hit.force });
  });
}

// ------------------------------------------------------------------ drawing

/** black and white: the string's light, the same light grey whatever it is */
const TINT = '236, 236, 234';
const N = 160;
const ys = new Float32Array(N + 1);
const env = new Float32Array(N + 1);
/** the held shape alone, for the blur to sit on */
const held = new Float32Array(N + 1);
/** the sound as mother of pearl, filling the dark behind the string (nacre.ts) */
const nacre = new Nacre(document.querySelector<HTMLCanvasElement>('#nacre')!);
/** the nacre's two looks, to compare: ?viz=soft (almost a gradient) or ?viz=fine (hair-thin lines, the default) */
const VIZ_DETAIL = params.get('viz') === 'soft' ? 0 : 1;
nacre.detail = VIZ_DETAIL;
/** without sound to listen to: the ringing note and its overtones, as loud as the drawing swings */
function guessSpectrum(u: number, glow: number) {
  if (!ring || u < TOP || u > lowU || glow < 0.02) return 0;
  const s0 = sounding.note + sounding.slid - bottom();
  const s = semisAt(u);
  let v = 0;
  for (let k = 1; k <= 6; k++) v += Math.exp(-(((s - s0 - 12 * Math.log2(k)) / 0.45) ** 2)) / Math.pow(k, 0.7);
  return Math.min(1, v * glow * 1.4);
}
/** the pitch (Hz) at a place along the string, for the nacre; none past the notes' ends */
const hzAt = (u: number) => (u < TOP || u > lowU ? 0 : midiHz(bottom() + semisAt(u)));

function frame(tms: number) {
  step(tms);
  requestAnimationFrame(frame);
}

function step(tms: number) {
  const t = tms / 1000;
  const dt = Math.min(0.033, lastT ? t - lastT : 0.016);
  lastT = t;
  if (AUTO) autoplay(t);
  // a finger held still on the string: it stops what rings, like a hand laid on it
  if (pend.on && !pend.muted && performance.now() - pend.t0 > MUTE_MS) {
    pend.muted = true;
    // (the drawing lets it go as fast, and nothing slides it any more)
    if (ring) ring.hushed = performance.now() / 1000;
    sounding.note = 0;
    engine?.mute(0.06);
    navigator.vibrate?.(3);
  }
  // a slide the finger rests on settles onto the scale
  if (!settled && performance.now() - slideAt > 140) settle();
  // the finger takes the string up fast but not at once
  if (grab.on) grab.d += (grab.want - grab.d) * (1 - Math.exp(-dt / 0.025));
  else grab.d = 0;
  residue *= Math.exp(-dt / 0.07);
  updateDots(dt, t);
  // the dots show only while the string is held aside (in quickly, out slowly after)
  let dotsWant = grab.on ? 1 : 0;
  for (const x of extras.values()) if (x.mode === 'pull') dotsWant = 1;
  dotsShow += (dotsWant - dotsShow) * (1 - Math.exp(-dt / (dotsWant ? 0.12 : 0.6)));
  arpTick();

  ctx.clearRect(0, 0, w, h);

  let energy = 0;
  ys.fill(0);
  env.fill(0);
  held.fill(0);
  if (ring) {
    const tt = t - ring.t0;
    let alive = false;
    // held, the string shows only a ghost of its last swing
    const keep = (grab.on ? residue : 1) * (ring.hushed ? Math.exp(-(t - ring.hushed) / 0.07) : 1);
    for (const m of ring.modes) {
      // the big swing goes almost at once; a fine tremor stays as long as the sound
      const a = m.a * (0.12 + 0.88 * Math.exp(-7 * tt)) * Math.exp(-m.sigma * tt) * keep;
      if (Math.abs(a) < 0.02) continue;
      alive = true;
      const ph = 2 * Math.PI * m.hz * tt;
      const o = m.sine ? Math.sin(ph) : Math.cos(ph);
      energy += a * a;
      for (let i = 0; i <= N; i++) {
        const sm = Math.sin((m.k * Math.PI * i) / N);
        ys[i] += a * o * sm;
        env[i] += a * a * sm * sm;
      }
    }
    for (let i = 0; i <= N; i++) env[i] = Math.sqrt(env[i]) * 1.25;
    if (!alive && !(grab.on && residue > 0.01 && !ring.hushed)) ring = null;
    if (ring && ring.buzz > 0) {
      const j = Math.min(3, Math.sqrt(energy) * 0.03) * ring.buzz;
      for (let i = 1; i < N; i++) ys[i] += (Math.random() - 0.5) * j * Math.sin((Math.PI * i) / N);
    }
  }
  if (ripple) {
    const tt = t - ripple.t0;
    let alive = false;
    for (const m of ripple.modes) {
      const a = m.a * Math.exp(-m.sigma * tt * 1.5);
      if (Math.abs(a) < 0.02) continue;
      alive = true;
      const o = Math.sin(2 * Math.PI * m.hz * tt);
      for (let i = 0; i <= N; i++) ys[i] += a * o * Math.sin((m.k * Math.PI * i) / N);
    }
    if (!alive) ripple = null;
  }
  if (grab.on) {
    // two straight lines to the finger, and round every dot it's caught on
    const pts: Array<[number, number]> = [[0, 0], [grab.s, grab.d], [1, 0]];
    for (const d of dots) if (d.state === 1) pts.push([d.y / h, d.x - A.x]);
    pts.sort((a, b) => a[0] - b[0]);
    let j = 0;
    for (let i = 0; i <= N; i++) {
      const x = i / N;
      while (j < pts.length - 2 && x > pts[j + 1][0]) j++;
      const [x0, y0] = pts[j];
      const [x1, y1] = pts[j + 1];
      held[i] = y0 + ((y1 - y0) * (x - x0)) / Math.max(1e-6, x1 - x0);
    }
  }
  // before the first pluck: the string sways a little, as if a finger were testing it
  if (!hinted && !grab.on) {
    const a = ctaSway(t);
    for (let i = 0; i <= N; i++) held[i] += a * tri(i / N, CTA_U);
  }
  for (let i = 0; i <= N; i++) ys[i] += held[i];
  const glow = Math.min(1, Math.sqrt(energy) / (reach * 0.5));

  // what it hears (or, with nothing to listen to, what the drawing knows it should)
  if (!nacre.listen(engine?.scope ?? null, hzAt)) {
    const n = nacre.spec.length;
    for (let i = 0; i < n; i++) nacre.spec[i] = guessSpectrum(i / (n - 1), glow);
  }
  // the beat: the groove's (on your plucks' grid) when it plays, strong; else a quiet one
  const at = engine?.ctx.currentTime ?? t;
  nacre.beat = groove.phase(at);
  nacre.pulse += ((groove.playing ? 1 : 0.3) - nacre.pulse) * (1 - Math.exp(-dt / 0.5));
  nacre.render(t, A.x, w, h, ys, reach);
  drawMarks();
  if (dotsShow > 0.01) {
    ctx.globalAlpha = dotsShow;
    drawDots(t);
    ctx.globalAlpha = 1;
  }
  drawWire(glow);
  if (grab.on && !grab.auto) drawFinger();
  if (mod.on) drawMod(t);
  drawExtras();
  if (away.on && away.wah) drawWah();
  drawStick(t);
  if (!hinted) drawCta(t);
}

/**
 * No frets, but marks like a fretless neck's: a dot of light at every note of the scale, a tick
 * at every octave; the one nearest the finger (held or sliding) lights up as it's reached.
 */
function drawMarks() {
  const base = bottom();
  const at = grab.on ? grab.deg : mod.on ? semisAt(mod.lastS) : -99;
  for (let k = 0; k <= SPAN; k++) {
    if (!inScale(base + k)) continue;
    const y = uAt(k) * h;
    const near = Math.max(0, 1 - Math.abs(at - k) / 0.5);
    if (k % 12 === 0 || near > 0) {
      const r = 6 + 3 * near;
      ctx.strokeStyle = `rgba(244, 244, 242, ${0.2 + 0.45 * near})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(A.x - r, y);
      ctx.lineTo(A.x - 3, y);
      ctx.moveTo(A.x + 3, y);
      ctx.lineTo(A.x + r, y);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(244, 244, 242, 0.16)';
      ctx.fillRect(A.x - 5.5, y - 0.5, 1.5, 1);
      ctx.fillRect(A.x + 4, y - 0.5, 1.5, 1);
    }
  }
}

/** how much the dots show, 0..1: only while the string is held */
let dotsShow = 0;

function drawDots(t: number) {
  // each chord's dots, faintly joined: a constellation
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(244, 244, 242, 0.06)';
  // (the dots are in chord order: one path, a new subpath at each chord)
  ctx.beginPath();
  dots.forEach((d, i) => (i && dots[i - 1].chord === d.chord ? ctx.lineTo(d.x, d.y) : ctx.moveTo(d.x, d.y)));
  ctx.stroke();
  for (const d of dots) {
    const caught = d.state === 1;
    const age = t - d.flash;
    const f = age >= 0 && age < 0.6 ? 1 - age / 0.6 : 0;
    ctx.beginPath();
    ctx.arc(d.x, d.y, caught ? 3 : 2.3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(244, 244, 242, ${caught ? 0.95 : 0.36 + 0.6 * f})`;
    ctx.fill();
    if (f > 0) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, 3 + 18 * (1 - f), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(244, 244, 242, ${0.45 * f * f})`;
      ctx.stroke();
    }
  }
}

function drawWire(glow: number) {
  const tint = TINT;
  const sg = (i: number, v: number) => toScreen(i / N, v);
  // what the eye would see of a real one: a blur as wide as the swing
  if (ring) {
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const p = sg(i, held[i] + env[i]);
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    }
    for (let i = N; i >= 0; i--) {
      const p = sg(i, held[i] - env[i]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(${tint}, ${0.035 + 0.06 * glow})`;
    ctx.fill();
  }
  // taut: thin and bright, brighter while it rings or is pulled
  const pull = grab.on ? Math.min(1, Math.abs(grab.d) / maxPull) : 0;
  ctx.save();
  ctx.shadowColor = `rgba(${tint}, ${Math.min(1, 0.35 + 0.9 * glow + 0.4 * pull)})`;
  ctx.shadowBlur = 6 + 14 * glow + 6 * pull;
  ctx.strokeStyle = 'rgba(244, 244, 242, 0.92)';
  ctx.lineWidth = 1.2 + 0.5 * glow - 0.3 * pull;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const p = sg(i, ys[i]);
    if (i) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

/** the finger on the string: a ring on the finger itself, and a strain line past the edge */
function drawFinger() {
  const tip = toScreen(grab.s, grab.d);
  const k = Math.min(1, Math.abs(grab.raw) / maxPull);
  if (Math.hypot(tip.x - grab.fx, tip.y - grab.fy) > 6) {
    ctx.strokeStyle = `rgba(244, 244, 242, ${0.12 + 0.3 * k})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(grab.fx, grab.fy);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.arc(grab.fx, grab.fy, 5, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(244, 244, 242, ${0.35 + 0.4 * k})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** the wah: a level line across the screen at the finger, and its word */
let wahLine: { w: number; g: CanvasGradient } | null = null;
function drawWah() {
  const y = away.fy;
  // (the line's gradient only changes with the width)
  if (wahLine?.w !== w) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(244, 244, 242, 0)');
    g.addColorStop(0.5, 'rgba(244, 244, 242, 0.35)');
    g.addColorStop(1, 'rgba(244, 244, 242, 0)');
    wahLine = { w, g };
  }
  ctx.fillStyle = wahLine.g;
  ctx.fillRect(0, y - 0.5, w, 1);
  ctx.fillStyle = 'rgba(244, 244, 242, 0.75)';
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.fillText(WAH, away.x0, y - 14);
}

/** the other fingers: a ring where each one is, a thread to the string while it pulls */
function drawExtras() {
  for (const x of extras.values()) {
    ctx.strokeStyle = 'rgba(244, 244, 242, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x.fx, x.fy, 7, 0, Math.PI * 2);
    ctx.stroke();
    if (x.mode !== 'pull') continue;
    const p = toScreen(clampS(x.u), 0);
    ctx.strokeStyle = 'rgba(244, 244, 242, 0.18)';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(x.fx, x.fy);
    ctx.stroke();
  }
}

/** a sliding finger: a light on the string that flares at a node */
function drawMod(t: number) {
  const u = clampS(fromScreen(mod.fx, mod.fy).u);
  const p = toScreen(u, 0);
  const f = Math.max(0, 1 - (t - mod.glint) / 0.35);
  const r = 10 + 14 * f;
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  g.addColorStop(0, `rgba(244, 244, 242, ${0.35 + 0.5 * f})`);
  g.addColorStop(1, 'rgba(244, 244, 242, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  if (f > 0) {
    ctx.fillStyle = `rgba(244, 244, 242, ${0.8 * f})`;
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    const lp = toScreen(u, 24);
    ctx.fillText(HARMONIC, lp.x, lp.y);
  }
}
/** the small labels on the canvas: spaced capitals */
const LABEL_FONT = '600 10px Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
const spaced = (s: string) => s.toUpperCase().split('').join(String.fromCharCode(8202));
const HARMONIC = spaced('Harmonic');
const WAH = spaced('Wah');

function drawStick(t: number) {
  if (!stick) return;
  const age = t - stick.t;
  if (age > 0.35) {
    stick = null;
    return;
  }
  // where it was hit: a small light that opens and fades
  const a = 1 - age / 0.35;
  const p = toScreen(stick.u, 0);
  const tint = TINT;
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 6 + 26 * (1 - a));
  g.addColorStop(0, `rgba(${tint}, ${0.7 * a})`);
  g.addColorStop(1, `rgba(${tint}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6 + 26 * (1 - a), 0, Math.PI * 2);
  ctx.fill();
}

// ------------------------------------------------------------------ ?auto: it plays itself (clips)

// a virtual finger takes the string at a height, pulls it aside (now and then far, through a
// chord of dots) and lets go: [along, pull (−1..1 of the way to the edge), hold s]
const SCRIPT: Array<[number, number, number]> = [
  [0.62, 0.3, 0.45],
  [0.4, -0.25, 0.4],
  [0.72, -0.85, 1.1],
  [0.3, 0.2, 0.4],
  [0.55, 0.9, 1.2],
  [0.8, 0.25, 0.45],
  [0.48, -0.95, 1.2],
];
let autoNext = 1.2;
let autoStep = 0;
let autoRelease = 0;
function autoplay(t: number) {
  const [at, pull, hold] = SCRIPT[autoStep % SCRIPT.length];
  // (on a note of the scale: no frets, so it aims)
  const along = uAt(nearestScale(semisAt(at)));
  if (grab.on && grab.auto) {
    const k = Math.min(1, (t - (autoRelease - hold)) / (hold * 0.85));
    setPull(pull * maxDrag * (1 - (1 - k) * (1 - k)));
    grab.fx = toScreen(grab.s, grab.raw).x;
    grab.fy = toScreen(grab.s, grab.raw).y;
    if (t >= autoRelease) {
      grab.on = false;
      pluck(grab.s, grab.d, grab.deg, Math.min(1, Math.abs(grab.raw) / maxPull));
      autoStep++;
      autoNext = t + 0.9 + (autoStep % 3) * 0.35;
    }
    return;
  }
  if (!grab.on && t >= autoNext) {
    startGrab(along, 0, -2, true);
    autoRelease = t + hold;
  }
}

// ------------------------------------------------------------------ furniture

if (!params.has('clean')) {
  ui = createUi({
    preset: (i) => {
      audio();
      setPreset(i);
    },
    arp: (mode) => {
      audio();
      setArp(mode);
    },
    scale: (i) => {
      audio();
      setScale(i);
    },
    level: (key, t) => {
      audio();
      setLevel(key, t, true);
    },
  }, { scales: SCALES, patterns: PATTERNS, levels: level });
  // (only with ?settings, in dev too: the wheel stays out of the way)
  if (params.has('settings')) {
    createSettings(
      [
        { key: 'volume', label: 'Volume', value: 0.8, min: 0, max: 1, step: 0.01, set: (v) => ((tune.volume = v), engine?.applyMix()) },
        { key: 'elastic', label: 'Elastic', value: 0.5, min: 0, max: 2.5, step: 0.01, set: (v) => (tune.elastic = v) },
        { key: 'buzz', label: 'Buzz', value: 1, min: 0, max: 2, step: 0.01, set: (v) => (tune.buzz = v) },
        { key: 'sym', label: 'Sympathetic strings', value: 1, min: 0, max: 2.5, step: 0.01, set: (v) => (tune.sym = v) },
        { key: 'glide', label: 'Pitch glide', value: 0.5, min: 0, max: 4, step: 0.01, set: (v) => (tune.glide = v) },
        { key: 'body', label: 'Body resonance', value: 1, min: 0, max: 2, step: 0.01, set: (v) => ((tune.body = v), engine?.applyMix()) },
        { key: 'sub', label: 'Sub octave', value: 1, min: 0, max: 2, step: 0.01, set: (v) => (tune.sub = v) },
        { key: 'detune', label: 'Chorus (detune)', value: 1, min: 0, max: 3, step: 0.01, set: (v) => (tune.detune = v) },
        { key: 'bloom', label: 'Attack bloom', value: 1, min: 0, max: 3, step: 0.01, set: (v) => (tune.bloom = v) },
        { key: 'pad', label: 'Pad level', value: 1, min: 0, max: 3, step: 0.01, set: (v) => ((tune.pad = v), engine && applyPad(engine)) },
        { key: 'nacre', label: 'Pärlemor (nacre)', value: 1, min: 0, max: 2, step: 0.01, set: (v) => (nacre.amount = v) },
        { key: 'nacreDetail', label: 'Pärlemor detail (soft … fine)', value: VIZ_DETAIL, min: 0, max: 1, step: 0.01, set: (v) => (nacre.detail = v) },
        { key: 'speed', label: 'Drawn vibration speed', value: 1, min: 0.2, max: 3, step: 0.01, set: (v) => (look.speed = v) },
      ],
      () => {
        engine?.askLevel();
        return engine ? `peak ${(engine.peak || 0).toFixed(2)}` : 'no sound yet';
      },
    );
  }
}

window.addEventListener('resize', resize);
resize();
// the bar's height is only right once its font is in
document.fonts?.ready.then(resize);
// it starts on wood, in hijaz (?preset= and ?scale= start elsewhere)
function pick<T extends { id: string }>(list: T[], id: string | null, dflt: string) {
  const i = list.findIndex((x) => x.id === id);
  return i >= 0 ? i : Math.max(0, list.findIndex((x) => x.id === dflt));
}
setPreset(pick(PRESETS, params.get('preset'), 'wood'));
setScale(pick(SCALES, params.get('scale'), 'tension'));
placeDots(true);
requestAnimationFrame(frame);
// ?auto plays by itself: the sound too, where the browser lets it start without a tap (a
// headless one for clips does; a phone waits for the tap)
if (AUTO) audio();

// dev: render a busy minute offline and report the levels (see README)
if (import.meta.env.DEV) {
  (window as unknown as { __tension: unknown }).__tension = {
    get engine() {
      return engine;
    },
    get state() {
      return {
        grab: { on: grab.on, s: grab.s, d: grab.d, want: grab.want, raw: grab.raw, id: grab.id, auto: grab.auto, pitch: grab.deg, note: grab.on ? noteFor(grab.deg) : null },
        mod: { on: mod.on },
        dots: dots.map((d) => ({ x: Math.round(d.x), y: Math.round(d.y), note: d.note, chord: d.chord, state: d.state })),
        sounding,
        string: { x: A.x, h },
      };
    },
    /** one frame by hand (a hidden page gets none) */
    step: (dtMs = 16) => step(lastT * 1000 + dtMs),
    async offline(seconds = 12, wav = false) {
      const { offlineCheck } = await import('./check');
      return offlineCheck(seconds, wav);
    },
  };
}
