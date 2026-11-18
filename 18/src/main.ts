import { Sound } from './audio';
import { Sim } from './physics';
import { angle, crossings, place, type Arm, type Hit, type Mode } from './rhythm';

// ?clean: no page furniture, the scene alone (screengrabs, clips)
const query = new URLSearchParams(location.search);
const clean = query.has('clean');
if (clean) document.body.classList.add('clean');

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const ctx = canvas.getContext('2d')!;
const panel = document.querySelector<HTMLElement>('#panel')!;
const hint = document.querySelector<HTMLElement>('#hint')!;
const tip = document.querySelector<HTMLElement>('#tip')!;
const tipsButton = document.querySelector<HTMLButtonElement>('#tips')!;

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
/** and along its trail, the bar behind it, when it has weight */
const TRAIL = 288;

// --- what is set ---

interface State {
  arms: Arm[];
  /** four beats to the bar: the first arm at ×1 ticks on 1 and tocks on 3 */
  bpm: number;
  mode: Mode;
  /** 0 the formula. Over it the arms are real swings, and this is how heavy each joint is against the one above (physics.ts) */
  weight: number;
  /** 0..1, how hard every swing is pushed in time, and how thick the air is */
  push: number;
}

const KEY = 'codevember-2026-18';
const rad = (deg: number) => (deg * Math.PI) / 180;
/** what the page opens with, and what 0 brings back: four short arms, two of them half a swing late */
const fresh = (): State => ({
  arms: [
    { n: 2, swing: rad(35), len: 0.38, phase: rad(175), vol: 0.54 },
    { n: 2, swing: rad(36), len: 0.26, phase: 0, vol: 0.15 },
    { n: 4, swing: 0.9, len: 0.37, phase: 0, vol: 1 },
    { n: 5, swing: rad(125), len: 0.17, phase: rad(176), vol: 1 },
  ],
  bpm: 120,
  mode: 'sum',
  weight: 0,
  push: 1,
});

const unit01 = (v: number, or: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : or);

/** a setup read back from storage, made safe; null if it is not one */
function sane(s: State | null | undefined): State | null {
  if (!s || !Array.isArray(s.arms) || !s.arms.length || !s.arms.every((a) => a && [a.n, a.swing, a.len, a.phase].every(Number.isFinite))) return null;
  return {
    arms: s.arms.slice(0, MAX_ARMS).map((a) => ({ n: Math.min(MAX_N, Math.max(1, Math.round(a.n))), swing: a.swing, len: a.len, phase: a.phase, vol: unit01(a.vol, 1) })),
    bpm: s.bpm >= 40 && s.bpm <= 220 ? s.bpm : 120,
    mode: s.mode === 'each' ? 'each' : 'sum',
    weight: unit01(s.weight, 0),
    push: unit01(s.push, 0.3),
  };
}

/** ?arms=1-34-1,2-52-0.62-90-50 (swings, swing in degrees, length, then if any the phase in degrees and the volume in percent), &bpm=, &mode=each, &weight=0.3, &push=0.3: a pattern in a link, for clips too */
function fromQuery(): State | null {
  const q = query.get('arms');
  if (!q) return null;
  const arms = q
    .split(',')
    .map((a) => a.split('-').map(Number))
    .filter((a) => a.length >= 3 && a.every(Number.isFinite))
    .map(([n, deg, len, phase = 0, vol = 100]) => ({ n: Math.min(MAX_N, Math.max(1, Math.round(n))), swing: (Math.min(180, Math.max(0, deg)) * Math.PI) / 180, len: Math.min(1.5, Math.max(0.1, len)), phase: (((phase % 360) + 360) % 360) * (Math.PI / 180), vol: unit01(vol / 100, 1) }));
  if (!arms.length) return null;
  const bpm = Number(query.get('bpm'));
  const weight = Number(query.get('weight'));
  const push = Number(query.get('push'));
  return { arms: arms.slice(0, MAX_ARMS), bpm: bpm >= 40 && bpm <= 220 ? bpm : 120, mode: query.get('mode') === 'each' ? 'each' : 'sum', weight: unit01(weight, 0), push: query.has('push') ? unit01(push, 0.3) : 0.3 };
}

function load(): State {
  const q = fromQuery();
  if (q) return q;
  try {
    return sane(JSON.parse(localStorage.getItem(KEY) ?? 'null')) ?? fresh();
  } catch {
    // no storage, or not ours: start over
    return fresh();
  }
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

/** `keep` false when nothing was set by hand: a pattern opened from a link does not write over the one remembered */
function changed(keep = true) {
  bar = crossings(state.arms, state.mode, -1e-6, 1 - 1e-6);
  const tmp: number[] = [];
  orbits = state.arms.map(() => new Float32Array((ORBIT + 1) * 2));
  for (let i = 0; i <= ORBIT; i++) {
    place(state.arms, state.arms.map((a) => angle(a, i / ORBIT)), tmp);
    for (let k = 0; k < orbits.length; k++) {
      orbits[k][2 * i] = tmp[2 * k];
      orbits[k][2 * i + 1] = tmp[2 * k + 1];
    }
  }
  if (!keep) return;
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
/** every hit of the bar behind, for the bar's rows when no two bars are the same */
let played: Hit[] = [];
let scanned = NaN;
const sim = new Sim();
/** the push's knob as one over the swing's Q: a whisper at the bottom, at the top the air is syrup and the push rules */
const pushOf = () => 4 * state.push * state.push;

/** where the joints are at φ: the weighted chain's where it has been run, the formula's otherwise */
const angles: number[] = [];
function pose(phi: number, out: number[]): number[] {
  const arms = state.arms;
  if (!(state.weight > 0 && sim.sample(phi, arms.length, angles))) {
    for (let k = 0; k < arms.length; k++) angles[k] = angle(arms[k], phi);
    angles.length = arms.length;
  }
  return place(arms, angles, out);
}

/** how far ahead the hits are worked out now, seconds */
const lookahead = () => Math.min(0.8, Math.max(LOOK, (sound?.latency ?? 0) + 0.08));

/** where a restart picks the motion up, bars: just before the bar, so its first crossing counts */
const SEED = -1 / 64;

/**
 * The motion from the top, the setup as it is: the bar starts over, and with weight the chain
 * is put back on the formula, always at the same point, so the same setup gives the same
 * chaos again. It starts a lookahead before the bar, silent, so the first hit is on time.
 */
function restart() {
  phi0 = Math.min(SEED, -lookahead() / barSeconds());
  t0 = clock();
  scanned = SEED;
  if (state.weight > 0) sim.reset(state.arms, SEED);
  else sim.live = false;
  flashes.length = 0;
  played = [];
}

function schedule() {
  if (!playing) return;
  const t = clock();
  const here = phaseAt(t);
  const end = phaseAt(t + lookahead());
  // the first tick, or the timer was held back (a hidden tab): no burst of old hits
  if (!(scanned >= here)) scanned = here;
  if (!(end > scanned)) return;
  sound?.sync();
  const hits: Hit[] = [];
  if (state.weight > 0) {
    // run the weighted chain on to there; from the formula if it is new, or was left far behind
    if (!sim.live || sim.phi < here - 0.25) sim.reset(state.arms, scanned);
    sim.advance(state.arms, state.mode, pushOf(), state.weight, end, scanned, hits);
    scanned = Math.max(end, sim.phi);
  } else {
    sim.live = false;
    crossings(state.arms, state.mode, scanned, end, hits);
    scanned = end;
  }
  for (const h of hits) {
    played.push(h);
    const at = t0 + (h.phase - phi0) * barSeconds();
    flashes.push({ ...h, t: at });
    sound?.hit(h.k, h.dir, h.vel, at, state.arms[h.k]?.vol);
  }
  scanned = end;
}
window.setInterval(schedule, 25);

// --- the workbench ---

let panelRect = { left: 0, top: 0 };

function build() {
  const many = state.arms.length > 1;
  panel.innerHTML = `
    <div class="cols"><span>Swings</span><span>Swing</span><span>Length</span><span>Phase</span><span>Volume</span></div>
    ${state.arms
      .map(
        (a, k) => `
    <div class="arm" data-k="${k}">
      <button data-act="dn" data-tip="swings" aria-label="Fewer swings per bar">−</button><output data-tip="swings">×${a.n}</output><button data-act="up" data-tip="swings" aria-label="More swings per bar">+</button>
      <input type="range" data-p="swing" data-tip="swing" min="0" max="180" step="1" value="${Math.round((a.swing * 180) / Math.PI)}" aria-label="Swing of arm ${k + 1}" />
      <input type="range" data-p="len" data-tip="len" min="0.1" max="1.5" step="0.01" value="${a.len}" aria-label="Length of arm ${k + 1}" />
      <input type="range" data-p="phase" data-tip="phase" min="0" max="360" step="1" value="${Math.round((a.phase * 180) / Math.PI)}" aria-label="Phase of arm ${k + 1}" />
      <input type="range" data-p="vol" data-tip="vol" min="0" max="100" step="1" value="${Math.round(a.vol * 100)}" aria-label="Volume of arm ${k + 1}, 0 is muted" />
      <button data-act="rm" data-tip="rm" aria-label="Remove arm ${k + 1}" ${many ? '' : 'disabled'}>✕</button>
    </div>`,
      )
      .join('')}
    <div class="row">
      <button data-act="add" data-tip="add" ${state.arms.length < MAX_ARMS ? '' : 'disabled'}>+ Arm</button>
      <button data-act="mode" data-tip="mode">${state.mode}</button>
    </div>
    <div class="row">
      <button data-act="restart" data-tip="restart">Restart</button>
      <button data-act="play" data-tip="play">${playing ? 'Pause' : 'Play'}</button>
      <button data-act="mute" data-tip="mute">${muted ? 'Muted' : 'Sound'}</button>
    </div>
    <label class="row" data-tip="weight"><span>Weight</span><input type="range" data-p="weight" min="0" max="100" step="1" value="${Math.round(state.weight * 100)}" /><output id="weight">${Math.round(state.weight * 100)}</output></label>
    <label class="row" data-tip="push"><span>Push</span><input type="range" data-p="push" min="0" max="100" step="1" value="${Math.round(state.push * 100)}" /><output id="push">${Math.round(state.push * 100)}</output></label>
    <label class="row" data-tip="tempo"><span>Tempo</span><input type="range" data-p="bpm" min="40" max="220" step="1" value="${state.bpm}" /><output id="bpm">${state.bpm}</output></label>`;
  const r = panel.getBoundingClientRect();
  panelRect = { left: r.left, top: r.top };
  placeTip();
}

// --- tips: what the control under the pointer does, in a box of its own over the workbench ---

const TIPS: Record<string, [string, string]> = {
  swings: ['Swings', 'How many times the arm swings in a bar: its harmonic. ×1 crosses the line twice a bar, ×2 four times.'],
  swing: ['Swing', 'How far the arm swings to each side, 0 to 180°. Wider and it counts for more in the sum; with weight, wider is also slower.'],
  len: ['Length', 'How long the arm is: how far it carries the joints under it.'],
  phase: ['Phase', 'Where in its swing the arm is when the bar starts. 0° it crosses going right, 90° it is out at the right.'],
  vol: ['Volume', 'How loud this joint is. All the way down is muted: the arm still swings and still moves the ones under it.'],
  rm: ['Remove', 'Takes this arm away.'],
  add: ['+ Arm', 'Hangs a new arm on the end, one harmonic up. Keys: + and −.'],
  mode: ['Sum / Each', 'What a joint crosses to sound. Sum: the centre line under the pivot, every arm above it added up. Each: the vertical under its own origin, its arm alone. Key: S.'],
  restart: ['Restart', 'The motion from the top, the setup as it is. With weight, the same setup plays the same again. Key: R.'],
  play: ['Pause / Play', 'Stops the motion where it is, and lets it go on. Key: space.'],
  mute: ['Sound', 'All sound on or off. Key: M.'],
  weight: ['Weight', '0 is the formula. Over it every arm is a real swing hung in the swing above, and this is how heavy each joint is against the one above it.'],
  push: ['Push', 'What keeps a swing going: a push in time with its own rhythm, and the air against it. From about 30 the bar comes round; lower and the swings drift; 0 lets go.'],
  tempo: ['Tempo', 'Beats a minute, four to the bar.'],
  tips: ['Tips', 'These boxes, on or off. Key: ?'],
};

const TIPS_KEY = 'codevember-2026-18-tips';
let tipsOn = true;
try {
  tipsOn = localStorage.getItem(TIPS_KEY) !== 'off';
} catch {
  // no storage: on
}

function showTip(key: string | undefined) {
  const t = tipsOn && key ? TIPS[key] : undefined;
  tip.hidden = !t;
  if (!t) return;
  tip.replaceChildren(Object.assign(document.createElement('b'), { textContent: t[0] }), Object.assign(document.createElement('span'), { textContent: t[1] }));
}

/** over the workbench on a wide screen; on a phone the stylesheet puts it under the title */
function placeTip() {
  tip.style.bottom = window.innerWidth > 760 ? `${window.innerHeight - panelRect.top + 12}px` : '';
}

function setTips(on: boolean) {
  tipsOn = on;
  tipsButton.setAttribute('aria-pressed', String(on));
  showTip(on ? 'tips' : undefined);
  try {
    localStorage.setItem(TIPS_KEY, on ? 'on' : 'off');
  } catch {
    // nothing kept
  }
}
tipsButton.setAttribute('aria-pressed', String(tipsOn));
tipsButton.addEventListener('click', () => setTips(!tipsOn));

const tipOf = (e: Event) => (e.target as HTMLElement).closest?.<HTMLElement>('[data-tip]')?.dataset.tip;
for (const el of [panel, tipsButton]) {
  el.addEventListener('pointerover', (e) => showTip(tipOf(e)));
  el.addEventListener('focusin', (e) => showTip(tipOf(e)));
  // a mouse leaving takes the tip away; a finger's stays until the next press somewhere else
  el.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && showTip(undefined));
}
window.addEventListener('pointerdown', (e) => {
  if (!(e.target as HTMLElement).closest?.('[data-tip]')) showTip(undefined);
});

function addArm() {
  if (state.arms.length >= MAX_ARMS) return;
  const last = state.arms[state.arms.length - 1];
  state.arms.push({ n: Math.min(MAX_N, last.n + 1), swing: 0.9, len: Math.max(0.2, +(last.len * 0.62).toFixed(2)), phase: 0, vol: 1 });
  if (sim.live) sim.added(state.arms);
}
function removeArm(k = state.arms.length - 1) {
  if (state.arms.length < 2) return;
  state.arms.splice(k, 1);
  if (sim.live) sim.removed(k);
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
  else if (act === 'restart') restart();
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
  } else if (r.dataset.p === 'weight' || r.dataset.p === 'push') {
    state[r.dataset.p] = v / 100;
    panel.querySelector('#' + r.dataset.p)!.textContent = String(v);
  } else {
    const a = state.arms[Number(r.closest<HTMLElement>('.arm')!.dataset.k)];
    if (r.dataset.p === 'swing') a.swing = (v * Math.PI) / 180;
    else if (r.dataset.p === 'phase') a.phase = (v * Math.PI) / 180;
    else if (r.dataset.p === 'vol') a.vol = v / 100;
    else a.len = v;
  }
  changed();
});

// --- presets: shift and a digit keeps the whole setup under it, the digit alone brings it back ---

const PRESETS_KEY = 'codevember-2026-18-presets';
let noted = '';
let notedUntil = 0;
/** a word under the title for a moment */
function note(text: string) {
  noted = text;
  notedUntil = clock() + 1.6;
}

function presets(): Record<string, State> {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function savePreset(digit: string) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify({ ...presets(), [digit]: state }));
    note(`Saved ${digit}`);
  } catch {
    note('Nowhere to save');
  }
}

/** 0 is the default until something is saved over it */
function recallPreset(digit: string) {
  const s = sane(presets()[digit]) ?? (digit === '0' ? fresh() : null);
  if (!s) return note(`${digit} is empty`);
  apply(s);
  note(`Preset ${digit}`);
}

/** a whole setup put in place of this one, the motion going on where the bar is */
function apply(s: State) {
  anchor();
  Object.assign(state, s);
  // with weight, the chain starts again from the formula: the arms are not the same ones
  sim.live = false;
  changed();
  build();
}

// --- saved by name: cmd+S saves, cmd+shift+S asks for a name, cmd+O lists them (ctrl where there is no cmd) ---

interface Saved {
  name: string;
  at: number;
  state: State;
}
const SAVES_KEY = 'codevember-2026-18-saves';
const NAME_KEY = 'codevember-2026-18-name';
/** the name this setup was last saved or opened under: what cmd+S writes to */
let current = '';
try {
  current = localStorage.getItem(NAME_KEY) ?? '';
} catch {
  // no storage: no name
}

function saves(): Saved[] {
  try {
    const all = JSON.parse(localStorage.getItem(SAVES_KEY) ?? '[]');
    return Array.isArray(all) ? all.filter((s) => s && typeof s.name === 'string' && s.name) : [];
  } catch {
    return [];
  }
}

function keep(all: Saved[], name: string): boolean {
  try {
    localStorage.setItem(SAVES_KEY, JSON.stringify(all));
    localStorage.setItem(NAME_KEY, (current = name));
    return true;
  } catch {
    note('Nowhere to save');
    return false;
  }
}

/** under that name, the newest first; one already there is written over */
function saveAs(name: string) {
  name = name.trim().slice(0, 40);
  if (!name) return;
  if (keep([{ name, at: Date.now(), state }, ...saves().filter((s) => s.name !== name)], name)) note(`Saved ${name}`);
}

/** the name to offer: the last one and the next number (groove, groove 2, groove 3), the first not taken */
function nextName(): string {
  const taken = new Set(saves().map((s) => s.name));
  const [, stem, num] = /^(.*?)(?:\s+(\d+))?$/.exec(current || 'Pattern')!;
  let i = num ? Number(num) + 1 : current ? 2 : 1;
  while (taken.has(`${stem} ${i}`)) i++;
  return `${stem} ${i}`;
}

const sheet = document.createElement('div');
sheet.className = 'sheet';
sheet.hidden = true;
document.body.append(sheet);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => Object.assign(document.createElement(tag), { textContent: text, className: cls });

function closeSheet() {
  sheet.hidden = true;
  sheet.replaceChildren();
}

function askName() {
  const input = Object.assign(el('input'), { type: 'text', value: nextName(), maxLength: 40, spellcheck: false, autocomplete: 'off' });
  input.setAttribute('aria-label', 'Name');
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    saveAs(input.value);
    closeSheet();
  });
  sheet.replaceChildren(el('b', 'Save as'), input, el('i', 'Enter saves, esc leaves'));
  sheet.hidden = false;
  input.focus();
  input.select();
}

function showSaved() {
  const all = saves();
  const rows = all.map((s) => {
    const open = el('button', s.name, 'open');
    const n = Array.isArray(s.state?.arms) ? s.state.arms.length : 0;
    open.append(el('span', `${n} ${n === 1 ? 'arm' : 'arms'} · ${new Date(s.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`));
    if (s.name === current) open.setAttribute('aria-current', 'true');
    open.addEventListener('click', () => {
      const st = sane(s.state);
      if (!st) return note(`${s.name} is broken`);
      apply(st);
      keep(all, s.name);
      note(`Opened ${s.name}`);
      closeSheet();
    });
    const del = el('button', '✕', 'del');
    del.setAttribute('aria-label', `Delete ${s.name}`);
    del.addEventListener('click', () => {
      if (keep(all.filter((o) => o !== s), s.name === current ? '' : current)) showSaved();
    });
    const row = el('div', '', 'saved');
    row.append(open, del);
    return row;
  });
  sheet.replaceChildren(el('b', 'Saved'), ...rows, el('i', rows.length ? 'Enter opens, esc leaves' : 'Nothing saved yet. Cmd+S saves this one.'));
  sheet.hidden = false;
  (sheet.querySelector<HTMLElement>('[aria-current]') ?? sheet.querySelector<HTMLElement>('.open'))?.focus();
}

window.addEventListener('pointerdown', (e) => {
  if (!sheet.hidden && !sheet.contains(e.target as Node)) closeSheet();
});

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.code === 'KeyS' || e.code === 'KeyO')) {
    e.preventDefault();
    if (e.code === 'KeyO') showSaved();
    else if (e.shiftKey || !current) askName();
    else saveAs(current);
    return;
  }
  // a sheet is up: the keys are its own (a name being typed, the list walked)
  if (!sheet.hidden) {
    if (e.key === 'Escape') closeSheet();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const rows = [...sheet.querySelectorAll<HTMLElement>('.open')];
      const at = rows.indexOf(document.activeElement as HTMLElement);
      rows[(at + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
      e.preventDefault();
    }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // by the key's place, not its character: shift and 2 is " or @ depending on the keyboard
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code)?.[1];
  if (digit) {
    e.preventDefault();
    if (e.shiftKey) savePreset(digit);
    else recallPreset(digit);
    return;
  }
  if (e.key === ' ') toggle('play');
  else if (e.key === '+' || e.key === '=') addArm();
  else if (e.key === '-' || e.key === '_') removeArm();
  else if (e.key === 'm') toggle('mute');
  else if (e.key === 'r') restart();
  else if (e.key === '?') setTips(!tipsOn);
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
  placeTip();
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
const trail = new Float32Array((TRAIL + 1) * 2 * MAX_ARMS);
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

  pose(phi, now);

  // what a joint has to cross: the centre line, or its own vertical
  if (state.mode === 'sum') line(px, py - 14, px, Y(total) + 14, 0.22);
  else for (let k = 0; k < n; k++) {
    const ox = k ? X(now[2 * k - 2]) : px;
    const oy = k ? Y(now[2 * k - 1]) : py;
    line(ox, oy, ox, oy + arms[k].len * unit, 0.2);
  }

  // every joint's path over the bar, the last one's a little brighter: the picture the swings add up to
  // With weight there is no such closed path: the bar behind it instead, a trail.
  const weighted = state.weight > 0;
  ctx.lineWidth = 1;
  if (weighted) {
    for (let i = 0; i <= TRAIL; i++) trail.set(pose(phi - 1 + i / TRAIL, then), i * 2 * MAX_ARMS);
  }
  for (let k = 0; k < n; k++) {
    const o = orbits[k];
    ctx.strokeStyle = ink(k === n - 1 ? 0.3 : 0.1);
    ctx.beginPath();
    if (weighted) for (let i = 0; i <= TRAIL; i++) ctx.lineTo(X(trail[(i * MAX_ARMS + k) * 2]), Y(trail[(i * MAX_ARMS + k) * 2 + 1]));
    else for (let i = 0; i <= ORBIT; i++) ctx.lineTo(X(o[2 * i]), Y(o[2 * i + 1]));
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
    pose(f.phase, then);
    ctx.strokeStyle = ink((1 - age / 0.4) ** 2 * (0.25 + 0.75 * f.vel) * (0.15 + 0.85 * arms[f.k].vol));
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
    line(tlX0, y, tlX1, y, 0.05 + 0.11 * arms[k].vol);
  }
  // with weight no bar is the next one: the hits as they fell, the playhead writing over the bar before
  if (played.length && played[0].phase < phi - 1.5) played = played.filter((b) => b.phase > phi - 1);
  for (const b of weighted ? played : bar) {
    const since = weighted ? phi - b.phase : (at - b.phase + 1) % 1;
    if (since < 0 || since >= 1 || b.k >= n) continue;
    const x = tlX0 + (b.phase - Math.floor(b.phase)) * tlW;
    const y = tlTop + b.k * rowH + rowH / 2;
    const glow = since < 0.03 ? 1 - since / 0.03 : 0;
    line(x, y, x, y - b.dir * (2.5 + 5.5 * b.vel + 2 * glow), ((weighted ? 0.75 - 0.6 * since : 0.55) + 0.45 * glow) * (0.2 + 0.8 * arms[b.k].vol), 1.5);
  }
  line(tlX0 + at * tlW, tlTop - 4, tlX0 + at * tlW, tlBottom + 2, 0.5);

  const say = t < notedUntil ? noted : sound?.running ? '' : 'Tap for sound';
  if (say !== hinted) hint.textContent = hinted = say;

  requestAnimationFrame(frame);
}

// the dev console: __pendulum.sound()?.stats says how many hits went out and how far ahead
if (import.meta.env.DEV) Object.assign(window, { __pendulum: { state, sim, energy: () => sim.energy(state.arms, state.weight), sound: () => sound, bar: () => bar, played: () => played } });

window.addEventListener('resize', resize);
changed(!query.has('arms'));
build();
resize();
requestAnimationFrame(frame);
