import { INSTRUMENTS, KIT, RULER, SCALES, SPAN, Sound, noteAt, stepOf } from './audio';
import { PUSH_CURVE, Sim } from './physics';
import { MAX_ARMS, TAU, angle, crossings, place, signal, type Arm, type Hit, type Mode } from './rhythm';

// ?clean: no page furniture, the scene alone (screengrabs, clips)
const query = new URLSearchParams(location.search);
const clean = query.has('clean');
/** `?bare`, with `?clean`: the chain alone, in action: no centre line and no rings where it hits (the index's picture) */
const bare = query.has('bare');
if (clean) document.body.classList.add('clean');

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const ctx = canvas.getContext('2d')!;
const panel = document.querySelector<HTMLElement>('#panel')!;
const topBar = document.querySelector<HTMLElement>('#bar')!;
const hint = document.querySelector<HTMLElement>('#hint')!;
const tip = document.querySelector<HTMLElement>('#tip')!;

const INK = '244, 244, 242';
const BACK = '#0b0b0d';
/** a colour a link, from a bluish purple to pink: the first four in even steps down the chain, the next four the tones between and a paler pink */
const PALETTE = ['118, 96, 255', '164, 114, 238', '209, 132, 222', '255, 150, 205', '141, 105, 247', '187, 123, 230', '232, 141, 213', '255, 196, 226'];
const MAX_N = 10;
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
/** the pieces a path is drawn in, each fainter than the one before, and how much of a bar the path is: both counts above, times that, divide by the pieces */
const PIECES = 36;
const TAIL = 0.5;
/** points along a link's curve */
const WAVE = 480;

// --- what is set ---

interface State {
  arms: Arm[];
  /** four beats to the bar: the first arm at ×1 ticks on 1 and tocks on 3 */
  bpm: number;
  /** off the formula; on, the arms are real swings with the weights they have (physics.ts) */
  physics: boolean;
  /** which scale the notes are on, one of audio.ts's */
  scale: string;
  /** what is struck, one of audio.ts's instruments */
  instrument: string;
  /**
   * What says which note (or which drum) a hit is. `hit`: where the joint is when it hits, so a
   * joint far down the chain plays a different one each time. `arm`: where its arm ends when
   * the chain hangs straight, so every arm has one of its own, whatever it is doing.
   */
  by: 'hit' | 'arm';
  /** where the root hangs on the ruler of notes, in arm lengths from its top: higher is a lower key */
  root: number;
  /** the mix, each 0..1: the room, the echo, and the overtone over every note (the middle is as designed) */
  reverb: number;
  /** the room's size, 0..1: small rings like metal, big is a hall */
  room: number;
  delay: number;
  harm: number;
  /** the volume of it all, 0..1: 0.8 is where it was before there was a knob */
  volume: number;
  /** the distortion on everything, before the room: 0 is clean */
  dist: number;
  /** the room's damping, 0..1: how much of its top is taken off */
  damp: number;
  /** 2 since the push knob has its lock point in the middle: older setups have theirs moved to where it does the same */
  v?: number;
}

const KEY = 'codevember-2026-18';
/** storage that may not be there (a private window): then nothing is read, and nothing kept */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
/** what was kept under a key, parsed; null if there is nothing or it is not ours */
function readJson(key: string): unknown {
  try {
    return JSON.parse(read(key) ?? 'null');
  } catch {
    return null;
  }
}
/** degrees to radians and back (to the whole degree a knob shows), and 0..1 as the percent a knob shows */
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => Math.round((r * 180) / Math.PI);
const pct = (v: number) => Math.round(v * 100);
const within = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** what the page opens with, and what 0 brings back: four short arms, two of them half a swing late */
const fresh = (): State => ({
  arms: [
    { n: 2, swing: rad(35), len: 0.38, phase: rad(175), vol: 0.54, mass: 1, mode: 'sum', push: 0.5, hue: 0, sound: 0 },
    { n: 2, swing: rad(36), len: 0.26, phase: 0, vol: 0.15, mass: 0.5, mode: 'sum', push: 0.5, hue: 1, sound: 2 },
    { n: 4, swing: 0.9, len: 0.37, phase: 0, vol: 1, mass: 0.25, mode: 'sum', push: 0.5, hue: 2, sound: 3 },
    { n: 5, swing: rad(125), len: 0.17, phase: rad(176), vol: 1, mass: 0.12, mode: 'sum', push: 0.5, hue: 3, sound: 4 },
  ],
  bpm: 120,
  physics: false,
  scale: 'tension',
  instrument: 'tine',
  by: 'hit',
  root: 0.4,
  reverb: 0.25,
  room: 0.7,
  delay: 0.2,
  harm: 0.5,
  volume: 0.8,
  dist: 0,
  damp: 0,
  v: 2,
});

/** a new piece from scratch: one arm swinging once a bar, tick and tock, everything else as it starts */
const blank = (): State => ({ ...fresh(), arms: [{ n: 1, swing: rad(52), len: 1, phase: 0, vol: 1, mass: 1, mode: 'sum', push: 0.5, hue: 0, sound: 0 }] });

const unit01 = (v: number, or: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : or);

/**
 * A joint's weight where none was given: half the one above. And for a setup from when one
 * knob set them all (`weight`, each joint that many times the one above), what it gave.
 */
const massFor = (mass: number | undefined, k: number, weight = 0) => unit01(mass as number, Math.pow(weight > 0 ? Math.min(1, weight) : 0.5, k));

/** a push set on the old knob (4·p², the lock point at 30), as the place on the new one that pushes as hard */
const pushFrom = (old: number) => Math.pow(old, 2 / PUSH_CURVE);

/** the root's place on the ruler, kept on it */
const rootIn = (v: number | undefined, or = 0.4) => (Number.isFinite(v) ? within(v!, 0, RULER - 0.2) : or);

/** the kit sound a link starts with, by its colour: bass drum, snare, closed hat, clap, open hat, tom, rim, cowbell */
const FIRST_SOUND = [0, 2, 3, 4, 6, 5, 1, 7];
const soundIn = (v: number | undefined, hue: number) => (Number.isInteger(v) && v! >= 0 && v! < KIT.length ? v! : FIRST_SOUND[hue % FIRST_SOUND.length]);

/**
 * A setup from storage or from a link, made safe: every number within what its knob allows,
 * whatever is missing as the page starts (fresh, above). null if it is not a setup at all.
 */
function sane(given: unknown): State | null {
  // `weight`, and one `mode` and one `push` for all: how setups were kept before each arm had its own
  const s = given as (State & { weight?: number; mode?: Mode; push?: number }) | null | undefined;
  if (!s || !Array.isArray(s.arms) || !s.arms.length || !s.arms.every((a) => a && [a.n, a.swing, a.len, a.phase].every(Number.isFinite))) return null;
  const d = fresh();
  // every arm its own colour: as kept if they are all different, else down the chain
  const kept = s.arms.slice(0, MAX_ARMS).map((a) => a.hue);
  const hues = kept.every((h, k) => Number.isInteger(h) && h >= 0 && h < PALETTE.length && kept.indexOf(h) === k) ? kept : kept.map((_, k) => k);
  return {
    arms: s.arms.slice(0, MAX_ARMS).map((a, k) => ({ n: within(Math.round(a.n), 1, MAX_N), swing: within(a.swing, 0, Math.PI), len: within(a.len, 0.1, 1.5), phase: within(a.phase, 0, TAU), vol: unit01(a.vol, 1), mute: !!a.mute, solo: !!a.solo, mass: massFor(a.mass, k, s.weight), mode: (a.mode ?? s.mode) === 'each' ? 'each' : 'sum', push: s.v === 2 ? unit01(a.push, 0.5) : pushFrom(unit01(a.push ?? s.push ?? 0.3, 0.3)), hue: hues[k], sound: soundIn(a.sound, hues[k]) })),
    bpm: s.bpm >= 40 && s.bpm <= 220 ? s.bpm : d.bpm,
    physics: typeof s.physics === 'boolean' ? s.physics : s.weight! > 0,
    scale: SCALES.some((c) => c.id === s.scale) ? s.scale : d.scale,
    instrument: INSTRUMENTS.some((c) => c.id === s.instrument) ? s.instrument : d.instrument,
    by: s.by === 'arm' ? 'arm' : 'hit',
    root: rootIn(s.root, d.root),
    reverb: unit01(s.reverb, d.reverb),
    room: unit01(s.room, d.room),
    delay: unit01(s.delay, d.delay),
    harm: unit01(s.harm, d.harm),
    volume: unit01(s.volume, d.volume),
    dist: unit01(s.dist, d.dist),
    damp: unit01(s.damp, d.damp),
    v: 2,
  };
}

/** the drums: a sound an arm, not a note */
const kit = (id: string | null) => id === '808' || id === 'bones';

/**
 * ?arms=1-34-1,2-52-0.62-90-50-30-1-40 (swings, swing in degrees, length, then if any the phase
 * in degrees, the volume and the weight in percent, 1 for each or 0 for sum, and the push in
 * percent), &bpm=, &physics=1, &scale=kumoi, &instrument=bones, &by=arm, &root=0.4, &reverb= &room= &damping= &delay= &distortion= &harmonics= &volume= (0 to 1), and for every arm that does not say: &mode=each, &push=0.5. A
 * pattern in a link, for clips too. &weight=0.3 is the old way to say physics, each joint that
 * many times the one above.
 */
function fromQuery(): State | null {
  const q = query.get('arms');
  if (!q) return null;
  /** a number the link gives, or nothing where it does not say */
  const num = (name: string) => (query.has(name) ? Number(query.get(name)) : undefined);
  const weight = num('weight') || 0;
  const all = query.get('mode') === 'each' ? 1 : 0;
  const pushAll = (num('push') ?? 0.5) * 100;
  const arms = q
    .split(',')
    .map((a) => a.split('-').map(Number))
    .filter((a) => a.length >= 3 && a.every(Number.isFinite))
    .map(([n, swing, len, phase = 0, vol = 100, mass, each = all, push = pushAll]) => ({ n, swing: rad(swing), len, phase: rad(((phase % 360) + 360) % 360), vol: vol / 100, mass: mass === undefined ? undefined : mass / 100, mode: each ? 'each' : 'sum', push: push / 100 }));
  if (!arms.length) return null;
  const instrument = query.get('instrument');
  // (the drums go by arm unless the link says otherwise)
  return sane({ arms, bpm: num('bpm'), physics: query.has('physics') ? query.get('physics') !== '0' : weight > 0, scale: query.get('scale'), instrument, by: query.get('by') ?? (kit(instrument) ? 'arm' : 'hit'), root: num('root'), reverb: num('reverb'), room: num('room'), delay: num('delay'), harm: num('harmonics'), volume: num('volume'), dist: num('distortion'), damp: num('damping'), weight, v: 2 });
}

const load = (): State => fromQuery() ?? sane(readJson(KEY)) ?? fresh();

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

// --- one bar of it on the formula: the rhythm and the paths ---
// Worked out when it is next drawn, not every time something is set (a knob being turned sets
// things a hundred times a second), and not at all while the chain has weight: it draws what it
// did then, not the formula.

let bar: Hit[] = [];
let orbits: Float32Array[] = [];
/** what each joint crosses zero with, over the bar, and the furthest it gets from zero */
let waves: Float32Array[] = [];
let waveTop: number[] = [];
/** something was set since the bar was last worked out */
let stale = true;

function shape() {
  if (!stale) return;
  stale = false;
  bar = crossings(state.arms, -1e-6, 1 - 1e-6);
  const tmp: number[] = [];
  orbits = state.arms.map(() => new Float32Array((ORBIT + 1) * 2));
  waves = state.arms.map(() => new Float32Array(WAVE + 1));
  waveTop = state.arms.map((_, k) => {
    let top = 0;
    for (let i = 0; i <= WAVE; i++) top = Math.max(top, Math.abs((waves[k][i] = signal(state.arms, k, i / WAVE))));
    return top;
  });
  for (let i = 0; i <= ORBIT; i++) {
    place(state.arms, state.arms.map((a) => angle(a, i / ORBIT)), tmp);
    for (let k = 0; k < orbits.length; k++) {
      orbits[k][2 * i] = tmp[2 * k];
      orbits[k][2 * i + 1] = tmp[2 * k + 1];
    }
  }
}

/** a pattern opened from a link is a visit: it never writes over the one remembered (presets and names still keep it) */
const linked = query.has('arms');
/** the setup is kept a moment after it was last set, not at every step of a drag; and at once when the page goes */
let keeping = 0;
function keepNow() {
  window.clearTimeout(keeping);
  keeping = 0;
  if (!linked) write(KEY, JSON.stringify(state));
}
window.addEventListener('pagehide', () => keeping && keepNow());
document.addEventListener('visibilitychange', () => keeping && document.hidden && keepNow());

/** something was set: the bar is to be worked out again, the sound told, the setup kept */
function changed() {
  stale = true;
  sound?.set(state);
  if (!keeping) keeping = window.setTimeout(keepNow, 300);
}

// --- the sound, and the hits handed to it a little ahead ---

let sound: Sound | null = null;

function unlock() {
  if (!sound) {
    try {
      sound = new Sound();
      sound.muted = muted;
      sound.set(state);
    } catch {
      return;
    }
  }
  if (!sound.running && !document.hidden) sound.ac.resume().catch(() => {});
}
for (const ev of ['pointerdown', 'pointerup', 'keydown', 'click']) window.addEventListener(ev, unlock, { capture: true });

// First, day 14's card: a frosted square in the middle, headphones recommended. The chain
// swings behind it without a sound (a browser plays nothing before a press); a click anywhere,
// or a key, takes the card away and, being a press, starts the sound. That click does nothing
// else: it holds no link and turns no knob. Every visit, since every visit starts silent.
// (`?nocard` in a link leaves it out: for the grabs.)
let veil: HTMLElement | null = null;
if (!clean && !query.has('nocard')) {
  const card = (veil = document.createElement('div'));
  card.className = 'veil';
  card.innerHTML =
    '<div class="card"><svg width="72" height="72" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 13.6V11.6a7.5 7.5 0 0 1 15 0v2" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round"/><g fill="currentColor"><rect x="3" y="13.2" width="3.1" height="6.6" rx="1.55"/><rect x="5.2" y="12.4" width="2.7" height="8.6" rx="1.35"/><rect x="17.9" y="13.2" width="3.1" height="6.6" rx="1.55"/><rect x="16.1" y="12.4" width="2.7" height="8.6" rx="1.35"/></g></svg>' +
    '<button type="button" class="x" aria-label="Close"><svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>' +
    '<b>Headphones recommended</b><i lang="ja">ヘッドホン推奨</i></div>';
  const lift = () => {
    if (!veil) return;
    veil = null;
    card.classList.add('gone');
    window.removeEventListener('keydown', lift);
    window.setTimeout(() => card.remove(), 500);
  };
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  card.addEventListener('click', lift);
  window.addEventListener('keydown', lift);
  document.body.append(card);
}
document.addEventListener('visibilitychange', () => {
  if (!sound) return;
  if (document.hidden) sound.ac.suspend().catch(() => {});
  else sound.ac.resume().catch(() => {});
});

interface Flash extends Hit {
  /** when it is seen and heard, clock seconds */
  t: number;
  /** how much of its loudness it kept, 0..1: by arm, a hit off where its joint usually hits is a little softer */
  kept: number;
}
const flashes: Flash[] = [];
/** every hit of the bar behind, for the bar's rows when no two bars are the same */
let played: Hit[] = [];
let scanned = NaN;
const sim = new Sim();
const scaleNotes = () => (SCALES.find((c) => c.id === state.scale) ?? SCALES[0]).notes;
/** how far down the chain arm k ends when it all hangs straight: its own place on the ruler */
function rest(k: number): number {
  let y = 0;
  for (let j = 0; j <= k && j < state.arms.length; j++) y += state.arms[j].len;
  return y;
}
/** the instruments that are a set of sounds, not one sound at many pitches */
const isKit = () => kit(state.instrument);
/** how loud arm k is heard: its volume, or nothing while it is muted, or while another is soloed and it is not */
function heard(k: number): number {
  const a = state.arms[k];
  if (!a || a.mute || (!a.solo && state.arms.some((b) => b.solo))) return 0;
  return a.vol;
}
/** what said the note before the drums took over, to go back to after them */
let melodicBy: State['by'] = 'hit';
/**
 * Another instrument. The drums go by arm to start with (a kick on one arm, a snare on the
 * next: a drum that changes with where the joint happens to be is a mess), and coming back from
 * them the notes go as they did before.
 */
function setInstrument(id: string) {
  if (kit(id) && !isKit()) {
    melodicBy = state.by;
    state.by = 'arm';
  } else if (!kit(id) && isKit()) state.by = melodicBy;
  state.instrument = id;
}
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** what arm k sounds when sounds go by arm: its drum, its pair of bones, or the note where it rests */
function soundName(k: number): string {
  const a = state.arms[k];
  if (state.instrument === '808') return KIT[a.sound % KIT.length];
  if (state.instrument === 'bones') return `B${(a.sound % KIT.length) + 1}`;
  const midi = noteAt(scaleNotes(), (state.root + rest(k)) / RULER);
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}
/**
 * By arm every hit of an arm is the same sound, so something else has to say they are not the
 * same hit: where it landed. Each joint has a place it usually hits (a running average of how
 * far down it was, the last dozen or so hits), and a hit off that is a little softer, like a
 * drum struck off its middle: down to OFF_CENTRE of its loudness, a third of an arm length
 * away and beyond. By hit it does nothing: there, where it landed is already the note.
 */
const OFF_CENTRE = 0.55;
const usual: number[] = [];
function centred(h: Hit): number {
  if (state.by !== 'arm') return 1;
  const was = usual[h.k];
  usual[h.k] = was === undefined ? h.pos : was + (h.pos - was) * 0.12;
  if (was === undefined) return 1;
  return 1 - (1 - OFF_CENTRE) * Math.min(1, Math.abs(h.pos - was) / 0.33);
}
/** how far under the root a hit counts as being, for its note: where it was, or where its arm rests */
const depthOf = (h: Hit) => (state.by === 'arm' ? rest(h.k) : h.pos);

/** where the joints are at φ: the weighted chain's where it has been run, the formula's otherwise */
const angles: number[] = [];
function pose(phi: number, out: number[]): number[] {
  const arms = state.arms;
  if (!(state.physics && sim.sample(phi, arms.length, angles))) {
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
  if (state.physics) sim.reset(state.arms, SEED);
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
  if (state.physics) {
    // run the weighted chain on to there; from the formula if it is new, or was left far behind
    if (!sim.live || sim.phi < here - 0.25) sim.reset(state.arms, scanned);
    sim.advance(state.arms, end, scanned, hits);
  } else {
    sim.live = false;
    crossings(state.arms, scanned, end, hits);
  }
  for (const h of hits) {
    played.push(h);
    const at = t0 + (h.phase - phi0) * barSeconds();
    const kept = centred(h);
    flashes.push({ ...h, t: at, kept });
    // its own voice, wherever it is in the chain, on the note where it is
    const midi = noteAt(scaleNotes(), (state.root + depthOf(h)) / RULER);
    // a kit's sound: the arm's own when sounds go by arm, else the one at the note it hit
    const step = state.by === 'arm' && isKit() ? (state.arms[h.k]?.sound ?? 0) : stepOf(scaleNotes(), midi);
    // the sound squares its volume: the root of what is kept, so the hit is that much softer and no more
    sound?.hit(state.arms[h.k]?.hue ?? h.k, h.dir, h.vel, at, heard(h.k) * Math.sqrt(kept), midi, step);
  }
  scanned = end;
}
window.setInterval(schedule, 25);

// --- the panels ---

/** where the panels begin: the scene ends over them */
let panelTop = 0;
/** where each link's row is, and where the rows end: its curve is drawn beside it */
let rowBoxes: { y: number; h: number }[] = [];
let rowsRight = 0;

// --- what is shown, each remembered under its own key ---

// The timeline (each link's curve beside its row; one line under the chain where there is no
// room for those): put away to start with, there when asked for.
const TIMELINE_KEY = `${KEY}-timeline`;
let timeline = query.has('timeline') || read(TIMELINE_KEY) === 'on';
function setTimeline(on: boolean) {
  timeline = on;
  write(TIMELINE_KEY, on ? 'on' : 'off');
}

// Colour: a colour a link, or all of it in the one ink (to start with).
const COLOUR_KEY = `${KEY}-colour`;
let colour = query.has('colour') || read(COLOUR_KEY) === 'on';
function setColour(on: boolean) {
  colour = on;
  write(COLOUR_KEY, on ? 'on' : 'off');
}

// The two panels, each put away or out: down to its name, behind the eye in its corner.
const FOLD_KEY = `${KEY}-panels`;
const folded: Record<string, boolean> = { voice: false, tracks: false, ...(readJson(FOLD_KEY) as Record<string, boolean> | null) };
function fold(id: string) {
  folded[id] = !folded[id];
  write(FOLD_KEY, JSON.stringify(folded));
}

/** where the bar ends, when it lies under the title and reaches the middle (a phone): the ruler of notes starts under it */
let topClear = 0;

function measure() {
  // The instrument's panel and the tracks' stand side by side from the left, as tall as each
  // other, and the scene is over them. Where the window is not wide enough for that, the
  // instrument's stands on the tracks'.
  panel.classList.remove('over');
  panel.style.paddingLeft = panel.style.paddingRight = '';
  const head = panel.querySelector<HTMLElement>('.voice');
  const rows = panel.querySelector<HTMLElement>('.tracks');
  if (head && rows) {
    const room = panel.clientWidth;
    // (32: the gap between them, as the stylesheet has it)
    const pair = head.offsetWidth + rows.offsetWidth + 32;
    // The two are not as wide as each other, and the centre line runs between them: the
    // narrower one is given the difference as room beside it, so the gap is on the line.
    // (Where there is no room for that, the pair is in the middle as it is.)
    const more = rows.offsetWidth - head.offsetWidth;
    if (pair > room) panel.classList.add('over');
    else if (pair + Math.abs(more) <= room) panel.style[more > 0 ? 'paddingLeft' : 'paddingRight'] = `${Math.abs(more)}px`;
  }
  panelTop = panel.getBoundingClientRect().top;
  // The bar sits top right; where the title reaches under it (a phone) it goes below the title instead.
  topBar.style.top = '';
  const plate = document.querySelector<HTMLElement>('.plate .head')?.getBoundingClientRect();
  let box = topBar.getBoundingClientRect();
  if (plate && box.left < plate.right + 8) {
    topBar.style.top = `${plate.bottom + 10}px`;
    box = topBar.getBoundingClientRect();
  }
  topClear = !clean && box.left < window.innerWidth / 2 + 30 ? box.bottom : 0;
  const boxes = [...panel.querySelectorAll('.arm')].map((row) => row.getBoundingClientRect());
  rowBoxes = boxes.map((b) => ({ y: b.top + b.height / 2, h: b.height }));
  if (boxes.length) rowsRight = boxes[boxes.length - 1].right;
  placeTip();
}

/** a knob's turn for a value: from seven o'clock round to five */
const turnOf = (v: number, min: number, max: number) => -135 + (270 * (v - min)) / (max - min || 1);
/**
 * A knob, as on day 07: press it and drag up (or to the right) and it turns up, a tall gauge
 * over it showing where it is while it is held; a click leaves the gauge open, to drag on.
 * It is a ring and a hand, or (`num`) its number alone. The arrow keys step it.
 */
const knob = (p: string, value: number, min: number, max: number, step: number, label: string, num = false) =>
  `<span class="knob${num ? ' num' : ''}" role="slider" tabindex="0" data-p="${p}" data-tip="${p === 'bpm' ? 'tempo' : p === 'n' ? 'swings' : p}" data-min="${min}" data-max="${max}" data-step="${step}" data-value="${value}" aria-label="${label}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" style="--turn: ${turnOf(value, min, max).toFixed(1)}deg">${num ? value : ''}</span>`;
function setKnob(el: HTMLElement, v: number) {
  el.dataset.value = String(v);
  el.setAttribute('aria-valuenow', String(v));
  el.style.setProperty('--turn', `${turnOf(v, Number(el.dataset.min), Number(el.dataset.max)).toFixed(1)}deg`);
  if (el.classList.contains('num')) el.textContent = String(v);
}

const icon = (d: string) => `<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">${d}</svg>`;
const ICONS = {
  play: icon('<path d="M4.2 2.4v9.2l7.4-4.6z"/>'),
  pause: icon('<path d="M3.4 2.6h2.6v8.8H3.4zM8 2.6h2.6v8.8H8z"/>'),
  restart: icon('<path class="s" d="M2.6 7.4a4.4 4.4 0 1 0 1.3-3.5"/><path class="s" d="M3.6 1.4v2.8h2.8"/>'),
  sound: icon('<path d="M1.8 5.2h2.3l2.9-2.5v8.6L4.1 8.8H1.8z"/><path class="s" d="M9 5.2a2.6 2.6 0 0 1 0 3.6M10.7 3.5a5 5 0 0 1 0 7"/>'),
  muted: icon('<path d="M1.8 5.2h2.3l2.9-2.5v8.6L4.1 8.8H1.8z"/><path class="s" d="M9.3 5.3l3.2 3.4M12.5 5.3L9.3 8.7"/>'),
  menu: icon('<path class="s" d="M2.5 4h9M2.5 7h9M2.5 10h9"/>'),
  eye: icon('<path class="s" d="M1.4 7s2.1-3.7 5.6-3.7S12.6 7 12.6 7s-2.1 3.7-5.6 3.7S1.4 7 1.4 7z"/><circle cx="7" cy="7" r="1.7"/>'),
  eyeShut: icon('<path class="s" d="M1.4 6c1.3 1.8 3.2 2.9 5.6 2.9s4.3-1.1 5.6-2.9"/><path class="s" d="M3.4 8.2l-1 1.5M7 8.9v1.9M10.6 8.2l1 1.5"/>'),
  warn: icon('<path class="s" d="M7 2L12.6 11.6H1.4z"/><path class="s" d="M7 5.8v2.6"/><circle cx="7" cy="10" r="0.75"/>'),
  // the size of a knob: it stands under the volume knobs
  plus: '<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><circle class="s ring" cx="11" cy="11" r="10.5"/><path class="s" d="M11 7.2v7.6M7.2 11h7.6"/></svg>',
  minus: '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><circle class="s ring" cx="9" cy="9" r="8"/><path class="s" d="M5.6 9h6.8"/></svg>',
  caret: '<svg viewBox="0 0 8 8" width="7" height="7" aria-hidden="true"><path class="s" d="M1.4 2.8L4 5.4l2.6-2.6"/></svg>',
};
const CMD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
/**
 * Keys, and what the hand does, each drawn as a key: its cap in a fine outline. Written as
 * words with spaces between: 'S' is a key, '⌘ S' two held together, '+ / −' either of two.
 * A `_` is a space inside a cap ('Drag_↕'), and a word led by `~` is said beside the caps,
 * not on one ('~on_its_ring').
 */
const keycaps = (keys: string) =>
  `<span class="keys">${keys
    .split(' ')
    .map((k) => (k === '/' ? '<i>/</i>' : k[0] === '~' ? `<i>${k.slice(1).replace(/_/g, ' ')}</i>` : `<kbd>${k.replace(/_/g, ' ')}</kbd>`))
    .join('')}</span>`;

/** which list is open: the scale's, the menu, or none. It lives through the panels being made again. */
let openPop = '';

function build() {
  showGauge(null);
  const many = state.arms.length > 1;
  // Only the columns that do something are there: an arm's sound when sounds go by arm, its
  // weight and its push when the chain has physics.
  const bySound = state.by === 'arm';
  const knobs = state.physics ? 6 : 4;
  // the grip, solo, mute, volume, sum, (sound,) swings and its count, then the rest of the knobs, remove
  panel.style.setProperty('--cols', `14px 26px 26px 36px 28px ${bySound ? '36px ' : ''}36px 24px repeat(${knobs - 1}, 36px) 26px`);
  panel.style.setProperty('--cols-phone', `14px 22px 22px 1fr 26px 1fr 22px repeat(${knobs - 1}, 1fr) 24px`);
  /** a section of the panel under its label */
  const part = (label: string, inner: string) => `<section><h3>${label}</h3><div class="ctl">${inner}</div></section>`;
  /** a knob over its name, where a section has more than one */
  const cell = (label: string, inner: string) => `<span class="cell">${inner}<i>${label}</i></span>`;
  /** a list, as on day 07: only what is picked shows; pressed, the rest stand over it (press, slide and let go, or tap and tap) */
  const pick = (p: 'scale', label: string, list: { id: string; label: string }[]) => {
    const cur = list.find((c) => c.id === state[p]) ?? list[0];
    return `<span class="pick" data-pop="${p}">
        <button class="cur" data-tip="${p}" aria-haspopup="listbox" aria-expanded="${openPop === p}" aria-label="${label}">${cur.label}${ICONS.caret}</button>
        <span class="pop" role="listbox" ${openPop === p ? '' : 'hidden'}>${list.map((c) => `<button role="option" data-act="pick" data-p="${p}" data-id="${c.id}" aria-selected="${c.id === cur.id}">${c.label}</button>`).join('')}</span>
      </span>`;
  };
  const mix = (p: string, name: string, v: number, label = '') => (label ? cell(label, knob(p, pct(v), 0, 100, 1, name)) : knob(p, pct(v), 0, 100, 1, name));
  // Along the bottom, two panels side by side, as tall as each other: the instrument over the
  // mix, each in sections under their labels, and the tracks, a row a link.
  /** the eye in a panel's corner: open while the panel is out, shut while it is put away */
  const eye = (id: string, name: string) =>
    `<button class="eye" data-act="fold" data-id="${id}" data-tip="fold" aria-expanded="${!folded[id]}" aria-label="${folded[id] ? 'Show' : 'Hide'} ${name}">${folded[id] ? ICONS.eyeShut : ICONS.eye}</button>`;
  panel.innerHTML = `
    ${
      folded.voice
        ? `<div class="voice shut"><h3>Instrument</h3>${eye('voice', 'the instrument panel')}</div>`
        : `<div class="voice">
      ${eye('voice', 'the instrument panel')}
      <div class="group" role="group" aria-label="Instrument">
        ${part(
          'Instrument',
          `<span class="seg" role="radiogroup" aria-label="Instrument" data-tip="instrument">${INSTRUMENTS.map((c) => `<button role="radio" data-act="pick" data-p="instrument" data-id="${c.id}" aria-checked="${c.id === state.instrument}" aria-pressed="${c.id === state.instrument}">${c.label}</button>`).join('')}</span>`,
        )}
        ${isKit() ? '' : part('Scale', pick('scale', 'Scale', SCALES))}
      </div>
      <div class="group" role="group" aria-label="Notes and pendulum mode">
        ${part(
          'Notes',
          `<span class="seg" role="radiogroup" aria-label="What says which note a hit is" data-tip="by">
            <button role="radio" data-act="by" data-id="hit" aria-checked="${state.by === 'hit'}" aria-pressed="${state.by === 'hit'}">By hit</button>
            <button role="radio" data-act="by" data-id="arm" aria-checked="${state.by === 'arm'}" aria-pressed="${state.by === 'arm'}">By arm</button>
          </span>`,
        )}
        ${part(
          'Pendulum mode',
          `<span class="seg" role="radiogroup" aria-label="How the chain moves" data-tip="physics">
            <button role="radio" data-act="motion" data-id="formula" aria-checked="${!state.physics}" aria-pressed="${!state.physics}">Formula</button>
            <button role="radio" data-act="motion" data-id="physics" aria-checked="${state.physics}" aria-pressed="${state.physics}">Physics</button>
          </span>${state.physics ? `<span class="warning" role="status" data-tip="physics" aria-label="Physics is on: the chain drifts out of time">${ICONS.warn}</span>` : ''}`,
        )}
      </div>
      <div class="group" role="group" aria-label="Mix">
        ${part('Mix', mix('volume', 'Volume', state.volume, 'Volume') + mix('harm', 'Harmonics', state.harm, 'Harm'))}
        ${part('Reverb', mix('reverb', 'Reverb', state.reverb, 'Amount') + mix('room', 'Room', state.room, 'Room') + mix('damp', 'Damping', state.damp, 'Damp'))}
        ${part('Delay', mix('delay', 'Delay', state.delay))}
        ${part('Distortion', mix('dist', 'Distortion', state.dist))}
      </div>
    </div>`
    }
    ${
      folded.tracks
        ? `<div class="tracks shut"><h3>Tracks</h3>${eye('tracks', 'the tracks')}</div>`
        : `<div class="tracks" role="group" aria-label="Tracks">
    ${eye('tracks', 'the tracks')}
    <h3>Tracks</h3>
    <div class="cols"><span></span><span>Solo</span><span>Mute</span><span>Volume</span><span>Sum</span>${bySound ? '<span class="snd">Sound</span>' : ''}<span>Swings</span><span></span><span>Swing</span><span>Length</span><span>Phase</span>${state.physics ? '<span>Weight</span><span>Push</span>' : ''}<span></span></div>
    ${state.arms
      .map(
        (a, k) => `
    <div class="arm" data-k="${k}" style="--arm: ${tint(k, 1)}">
      <span class="grip" data-tip="grip" aria-label="Move arm ${k + 1}">⋮⋮</span>
      <button class="ms" data-act="solo" data-tip="solo" aria-pressed="${!!a.solo}" aria-label="Solo arm ${k + 1}">S</button>
      <button class="ms" data-act="quiet" data-tip="quiet" aria-pressed="${!!a.mute}" aria-label="Mute arm ${k + 1}">M</button>
      ${knob('vol', pct(a.vol), 0, 100, 1, `Volume of arm ${k + 1}`)}
      <button data-act="own" data-tip="mode" aria-pressed="${a.mode === 'sum'}" aria-label="Arm ${k + 1} sounds on the sum">Σ</button>
      ${bySound ? `<button class="snd" data-act="sound" data-tip="sound" aria-label="Sound of arm ${k + 1}" ${isKit() ? '' : 'disabled'}>${soundName(k)}</button>` : ''}
      ${knob('n', a.n, 1, MAX_N, 1, `Swings per bar of arm ${k + 1}`)}<output data-tip="swings">×${a.n}</output>
      ${knob('swing', deg(a.swing), 0, 180, 1, `Swing of arm ${k + 1}`)}
      ${knob('len', a.len, 0.1, 1.5, 0.01, `Length of arm ${k + 1}`)}
      ${knob('phase', deg(a.phase), 0, 360, 1, `Phase of arm ${k + 1}`)}
      ${state.physics ? knob('mass', pct(a.mass), 0, 100, 1, `Weight of arm ${k + 1}`) + knob('push', pct(a.push), 0, 100, 1, `Push of arm ${k + 1}`) : ''}
      <button data-act="rm" data-tip="rm" aria-label="Remove arm ${k + 1}" ${many ? '' : 'disabled'}>${ICONS.minus}</button>
    </div>`,
      )
      .join('')}
    <button class="add" data-act="add" data-tip="add" ${state.arms.length < MAX_ARMS ? '' : 'disabled'}>${ICONS.plus}<span>Add track</span></button>
    </div>`
    }`;
  // The bar, top right: the transport, and behind the ≡ what is set once (what is shown, the
  // tips, the setups).
  const flip = (act: string, label: string, on: boolean, key = '') =>
    `<button class="row" role="menuitemcheckbox" data-act="${act}" data-tip="${act}" aria-checked="${on}"><span>${label}</span>${key ? keycaps(key) : ''}<i class="switch${on ? ' on' : ''}"></i></button>`;
  const does = (act: string, label: string, key = '') => `<button class="row" role="menuitem" data-act="${act}" data-tip="${act}"><span>${label}</span>${key ? keycaps(key) : ''}</button>`;
  topBar.innerHTML = `
    <button data-act="play" data-tip="play" aria-label="${playing ? 'Pause' : 'Play'}">${playing ? ICONS.pause : ICONS.play}</button>
    <button data-act="restart" data-tip="restart" aria-label="Restart">${ICONS.restart}</button>
    <button data-act="mute" data-tip="mute" aria-label="${muted ? 'Sound on' : 'Sound off'}">${muted ? ICONS.muted : ICONS.sound}</button>
    ${knob('bpm', state.bpm, 40, 220, 1, 'Tempo', true)}
    <span class="sep"></span>
    <span class="pick" data-pop="menu">
      <button class="cur" aria-haspopup="menu" aria-expanded="${openPop === 'menu'}" aria-label="Menu">${ICONS.menu}</button>
      <span class="pop menu" role="menu" ${openPop === 'menu' ? '' : 'hidden'}>
        ${flip('timeline', 'Timeline', timeline, 'T')}
        ${flip('colour', 'Colour', colour)}
        ${flip('tips', 'Tips', tipsOn, '?')}
        <hr />
        ${does('save', 'Save', `${CMD} S`)}
        ${does('saveas', 'Save as', `⇧ ${CMD} S`)}
        ${does('open', 'Open', `${CMD} O`)}
        <hr />
        ${does('reset', 'Reset')}
      </span>
    </span>`;
  showHot();
  measure();
}

// --- the lists and the menu: one open at a time, shut by a press anywhere else ---

function setPop(id: string) {
  openPop = id;
  for (const p of document.querySelectorAll<HTMLElement>('.pick')) {
    const on = p.dataset.pop === id;
    p.querySelector<HTMLElement>('.pop')!.hidden = !on;
    p.querySelector('.cur')!.setAttribute('aria-expanded', String(on));
  }
  if (id === 'scale') showTip(undefined);
}
/** pressed on a list's button and not let go yet: letting go over a choice takes it */
let sliding = false;
const choiceAt = (e: PointerEvent) => {
  const b = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.pop button');
  return b && !b.closest<HTMLElement>('.pop')!.hidden ? b : null;
};
const unmark = () => document.querySelector('.pop button.at')?.classList.remove('at');
window.addEventListener('pointerdown', (e) => {
  const t = e.target as HTMLElement;
  const cur = t.closest?.<HTMLElement>('.pick > .cur');
  if (cur) {
    e.preventDefault();
    const id = cur.parentElement!.dataset.pop!;
    setPop(openPop === id ? '' : id);
    sliding = openPop !== '';
  } else if (openPop && !t.closest?.('.pop')) setPop('');
});
window.addEventListener('pointermove', (e) => {
  if (!sliding) return;
  unmark();
  choiceAt(e)?.classList.add('at');
});
for (const ev of ['pointerup', 'pointercancel']) {
  window.addEventListener(ev, (e) => {
    if (!sliding) return;
    sliding = false;
    unmark();
    if (ev === 'pointerup') choiceAt(e as PointerEvent)?.click();
  });
}

// --- tips: what the control under the pointer does, in a card of its own by its panel ---

/** a control's name, what it does, and the keys and the moves of the hand for it where there are any (drawn as keys beside the name, a line each) */
const TIPS: Record<string, [string, string, (string | string[])?]> = {
  swings: ['Swings', 'How many times the arm swings in a bar, 1 to 10: its harmonic. ×1 crosses the line twice a bar, ×2 four times.'],
  swing: ['Swing', 'How far the arm swings to each side, 0 to 180°. Wider and it counts for more in the sum; with physics on, wider is also slower.', 'Drag_↔ ~on_its_ring'],
  len: ['Length', 'How long the arm is: how far it carries the joints under it.', 'Drag_↕ ~on_its_ring'],
  phase: ['Phase', 'Where in its swing the arm is when the bar starts. 0° it crosses going right, 90° it is out at the right.'],
  vol: ['Volume', 'How loud this joint is. All the way down is muted: the arm still swings and still moves the ones under it. The keys turn the lit link up and down.', [`${CMD} ↑ / ${CMD} ↓`, `${CMD} Drag_↕ ~on_its_ring`]],
  rm: ['Remove', 'Takes this arm away.'],
  quiet: ['Mute', 'Silences this track, whatever its volume. The arm still swings and still moves the ones under it.'],
  solo: ['Solo', 'Only this track is heard, with any others that are soloed too.'],
  grip: ['Move', 'Drag up or down to move this link along the chain. Its colour, its voice and its settings go with it.', 'Drag_↕'],
  add: ['Add track', 'Hangs a new arm on the end, one harmonic up, at half volume. The other key takes the last one away.', '+ / −'],
  mode: ['Sum / Each', 'What this joint crosses to sound. Lit, the sum: the centre line under the pivot, every arm above it added up. Not lit, each: the vertical under its own origin, its arm alone. The key switches all of them at once.', 'S'],
  restart: ['Restart', 'The motion from the top, the setup as it is. With physics on, the same setup plays the same again.', 'R'],
  play: ['Pause / Play', 'Stops the motion where it is, and lets it go on.', 'Space'],
  mute: ['Sound', 'All sound on or off.', 'M'],
  mass: ['Weight', 'How hard this link pulls on what it hangs from, with physics on. At the bottom it rides the arm above and is shaken by it, and the arm above never knows. At the top it weighs as much as the arm it hangs from, and throws it about.'],
  physics: ['Pendulum mode', 'Formula: every arm goes exactly as it is set. Physics: every arm is a real swing hung in the swing above, with its weight, kept going by the push. The chain is then on its own: it drifts out of time, and that is said in orange for as long as it is on. No key for it: it is not to be switched by a slip of the finger.'],
  push: ['Push', 'What keeps this swing going, with physics on: a push in time with its own rhythm, and the air against it. High and it keeps its time whatever the others do; from about the middle the bar comes round; lower and it drifts; 0 lets it go. The arrow at the joint is the push right now: none when the swing is on its own time.'],
  instrument: ['Instrument', 'What is struck. Tine: a kalimba\'s, a note that rings on. Bones: a drum, two bones knocked together, like a soft rimshot; the same for a link wherever it is: rhythm, no tune. Square: electronic, a filter every hit opens. TR-808: the drum machine, a sound an arm, or by hit a sound a note: their names down the line say which. The key goes to the next.', 'I'],
  sound: ['Sound', 'What this arm sounds, when sounds go by arm (Notes, in the instrument panel). On the drum machine and the bones: press for the next of the eight, shift for the one before. On the others it is the note where the arm rests on the ruler: pull its ring longer or shorter.', ['Click ~the_next', '⇧ Click ~the_one_before']],
  by: ['By hit / By arm', 'What says which note, or which drum, a hit is. By hit: where the joint is when it hits, so a joint far down the chain plays a different one each time. By arm: where its arm ends when the chain hangs straight, so every arm has one of its own.', 'B'],
  scale: ['Scale', 'The notes the joints play: where a joint is when it hits is its note, low at the root and high far out, always the nearest one of this scale. Pick it from the list; the key goes to the next. The key it is all in is where the root hangs: lower on the page is higher.', ['N', 'Drag_↕ ~on_the_root']],
  reverb: ['Reverb', 'How much of what you hear is the room: none at the bottom; higher, the notes themselves go down as the room comes up; at the top, only the room.'],
  room: ['Room', 'How big the room is. Small, the walls are close and hard: it rings like metal, a pipe, a tin. Big, a hall. Turn Reverb up to hear it: all the way up with a small room is metal alone.'],
  delay: ['Delay', 'An echo in time, a dotted eighth apart, bouncing left then right: off at the bottom; higher, more goes in and more comes round again.'],
  harm: ['Harmonics', 'The overtone over every note: none at the bottom (plain, round), each link\'s own in the middle, twice that at the top (bright).'],
  tempo: ['Tempo', 'Beats a minute, four to the bar.'],
  fold: ['Hide / Show', 'Puts this panel away, down to its name, and brings it back. With both away the chain has the page.'],
  reset: ['Reset', 'A new piece from scratch: one arm swinging once a bar, and the instrument, the notes, the mix and the tempo as they start. What is saved by name and on the digits is kept. No key for it.'],
  volume: ['Volume', 'How loud it all is.'],
  damp: ['Damping', 'How much of the room\'s top is taken off as it comes back: open at the bottom, a room hung with blankets at the top.'],
  dist: ['Distortion', 'Everything driven into a soft clipper, before the room and the echo: clean at the bottom, warm in the middle, a fuzz at the top, where every tail is as loud as its note.'],
  save: ['Save', 'Keeps this setup under the name it has, and asks for one the first time.', `${CMD} S`],
  saveas: ['Save as', 'Asks for a name and keeps this setup under it, offering the last name with the next number.', `⇧ ${CMD} S`],
  open: ['Open', 'Everything saved by name, the newest first. Ten more live on the digits: shift and a digit keeps, the digit brings back.', [`${CMD} O`, '0–9 ~bring_back', '⇧ 0–9 ~keep']],
  timeline: ['Timeline', 'Each link\'s curve beside its row: what its joint crosses zero with, over the bar, a dot where it hits. Put away to start with.', 'T'],
  colour: ['Colour', 'A colour a link, from a bluish purple down the chain to pink, or all of it black and white, as it is to start with.'],
  tips: ['Tips', 'These cards, on or off. And the knobs: press one and drag up (or to the right) to turn it up, the gauge over it shows where it is; a click leaves the gauge open, to drag on. It catches on the quarters and the round numbers, shift turns past them; the arrow keys step it.', ['?', 'Drag_↕ ~a_knob', '⇧ Drag_↕ ~past_its_marks', '← → ~step_it']],
};

const TIPS_KEY = `${KEY}-tips`;
let tipsOn = read(TIPS_KEY) !== 'off';

/** the panel (or the bar) the control with the tip is in: the tip stands beside it */
let tipHost: HTMLElement | null = null;

function showTip(key: string | undefined, from?: HTMLElement | null) {
  // not while a list stands open over where the box goes
  const t = tipsOn && key && openPop !== 'scale' ? TIPS[key] : undefined;
  tip.hidden = !t;
  if (!t) return;
  tipHost = from?.closest<HTMLElement>('.pop.menu, .voice, .tracks, .bar') ?? topBar;
  const name = el('b', t[0]);
  if (t[2]) name.insertAdjacentHTML('beforeend', `<span class="keyrows">${[t[2]].flat().map(keycaps).join('')}</span>`);
  tip.replaceChildren(name, el('span', t[1]));
  placeTip();
}

/**
 * With its panel: over the instrument's for the instrument's controls, over the tracks' for
 * theirs, as wide as the panel. The bar's hang under the bar, and the menu's rows' stand to the
 * left of the menu. On a phone the stylesheet puts it under the title.
 */
function placeTip() {
  const st = tip.style;
  st.left = st.right = st.top = st.bottom = st.width = '';
  if (window.innerWidth <= 760 || !tipHost?.isConnected) return;
  const r = tipHost.getBoundingClientRect();
  const gap = 12;
  // a row of the menu: beside the menu, to its left, never over it
  if (tipHost.classList.contains('pop')) {
    st.top = `${r.top}px`;
    st.right = `${window.innerWidth - r.left + gap}px`;
    st.width = `${Math.max(180, Math.min(320, r.left - gap - 24))}px`;
    return;
  }
  if (tipHost === topBar) {
    st.top = `${r.bottom + gap}px`;
    st.right = `${window.innerWidth - r.right}px`;
    st.width = '320px';
    return;
  }
  // a panel's: over that panel, as wide as it is
  st.left = `${r.left}px`;
  st.width = `${Math.max(280, r.width)}px`;
  st.bottom = `${window.innerHeight - r.top + gap}px`;
}

function setTips(on: boolean) {
  tipsOn = on;
  showTip(on ? 'tips' : undefined);
  write(TIPS_KEY, on ? 'on' : 'off');
}

const tipAt = (e: Event) => (e.target as HTMLElement).closest?.<HTMLElement>('[data-tip]');
for (const el of [panel, topBar]) {
  el.addEventListener('pointerover', (e) => showTip(tipAt(e)?.dataset.tip, tipAt(e)));
  el.addEventListener('focusin', (e) => showTip(tipAt(e)?.dataset.tip, tipAt(e)));
  // a mouse leaving takes the tip away; a finger's stays until the next press somewhere else
  el.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && showTip(undefined));
}
window.addEventListener('pointerdown', (e) => {
  if (!(e.target as HTMLElement).closest?.('[data-tip]')) showTip(undefined);
});

function addArm() {
  if (state.arms.length >= MAX_ARMS) return;
  const last = state.arms[state.arms.length - 1];
  state.arms.push({ n: Math.min(MAX_N, last.n + 1), swing: 0.9, len: Math.max(0.2, +(last.len * 0.62).toFixed(2)), phase: 0, vol: 0.5, mass: +(last.mass / 2).toFixed(2), mode: last.mode, push: last.push, hue: -1, sound: 0 });
  const made = state.arms[state.arms.length - 1];
  made.hue = PALETTE.findIndex((_, h) => !state.arms.some((a) => a.hue === h));
  made.sound = FIRST_SOUND[made.hue % FIRST_SOUND.length];
  if (sim.live) sim.added(state.arms);
}
function removeArm(k = state.arms.length - 1) {
  if (state.arms.length < 2) return;
  state.arms.splice(k, 1);
  usual.length = 0;
  held = -1;
  if (sim.live) sim.removed(k);
}
/** what a key does, and for play and sound their buttons too */
function toggle(what: 'mode' | 'play' | 'mute' | 'scale' | 'instrument' | 'by') {
  if (what === 'by') {
    state.by = state.by === 'arm' ? 'hit' : 'arm';
    note(state.by === 'arm' ? 'A note an arm' : 'A note where it hits');
  }
  if (what === 'instrument') {
    setInstrument(INSTRUMENTS[(INSTRUMENTS.findIndex((c) => c.id === state.instrument) + 1) % INSTRUMENTS.length].id);
    note(INSTRUMENTS.find((c) => c.id === state.instrument)!.label);
  }
  if (what === 'scale') {
    state.scale = SCALES[(SCALES.findIndex((c) => c.id === state.scale) + 1) % SCALES.length].id;
    note(SCALES.find((c) => c.id === state.scale)!.label);
  }
  if (what === 'mode') {
    // all of them: to each if any is on the sum, else back to the sum
    const to: Mode = state.arms.some((a) => a.mode === 'sum') ? 'each' : 'sum';
    for (const a of state.arms) a.mode = to;
  }
  if (what === 'play') {
    anchor();
    playing = !playing;
  }
  if (what === 'mute') {
    muted = !muted;
    if (sound) sound.muted = muted;
  }
}

const onClick = (e: Event) => {
  // a list's button reached by the keyboard (a pointer opens it as it goes down)
  const cur = (e.target as HTMLElement).closest<HTMLElement>('.pick > .cur');
  if (cur && (e as MouseEvent).detail === 0) return setPop(openPop === cur.parentElement!.dataset.pop ? '' : cur.parentElement!.dataset.pop!);
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  if (!b) return;
  const act = b.dataset.act!;
  if (act === 'timeline' || act === 'colour' || act === 'tips') {
    if (act === 'timeline') setTimeline(!timeline);
    else if (act === 'colour') setColour(!colour);
    else setTips(!tipsOn);
    build();
    return;
  }
  if (act === 'fold') {
    fold(b.dataset.id!);
    build();
    return;
  }
  if (act === 'reset') {
    // a new piece from scratch: one arm, the rest as it starts; what is saved by name and on the digits is kept
    setPop('');
    usual.length = 0;
    held = -1;
    melodicBy = 'hit';
    apply(blank());
    restart();
    note('Reset');
    return;
  }
  if (act === 'save' || act === 'saveas' || act === 'open') {
    setPop('');
    if (act === 'open') showSaved();
    else if (act === 'saveas' || !current) askName();
    else saveAs(current);
    return;
  }
  const k = Number(b.closest<HTMLElement>('.arm')?.dataset.k);
  if (act === 'own') state.arms[k].mode = state.arms[k].mode === 'sum' ? 'each' : 'sum';
  else if (act === 'quiet') state.arms[k].mute = !state.arms[k].mute;
  else if (act === 'solo') state.arms[k].solo = !state.arms[k].solo;
  else if (act === 'sound') state.arms[k].sound = (state.arms[k].sound + ((e as MouseEvent).shiftKey ? KIT.length - 1 : 1)) % KIT.length;
  else if (act === 'rm') removeArm(k);
  else if (act === 'add') addArm();
  else if (act === 'pick') {
    if (b.dataset.p === 'scale') state.scale = b.dataset.id!;
    else setInstrument(b.dataset.id!);
    openPop = '';
  }
  else if (act === 'by') state.by = b.dataset.id === 'arm' ? 'arm' : 'hit';
  else if (act === 'motion') state.physics = b.dataset.id === 'physics';
  else if (act === 'restart') restart();
  else toggle(act as 'play' | 'mute');
  changed();
  build();
};
panel.addEventListener('click', onClick);
topBar.addEventListener('click', onClick);

// --- reorder: a row dragged by its grip moves its link along the chain ---

/** the row being moved, as it is now, or -1 */
let moving = -1;

panel.addEventListener('pointerdown', (e) => {
  const grip = (e.target as HTMLElement).closest?.<HTMLElement>('.grip');
  if (!grip) return;
  e.preventDefault();
  moving = held = Number(grip.closest<HTMLElement>('.arm')!.dataset.k);
  panel.classList.add('moving');
  showHot();
});
window.addEventListener('pointermove', (e) => {
  if (moving < 0) return;
  // the row the pointer is over takes it: the rows between move one place the other way
  const to = rowBoxes.findIndex((b) => Math.abs(e.clientY - b.y) <= b.h / 2 + 3);
  if (to < 0 || to === moving || to >= state.arms.length) return;
  state.arms.splice(to, 0, ...state.arms.splice(moving, 1));
  usual.length = 0;
  moving = held = to;
  // with weight the arms are not where they were: the chain starts again on the formula
  sim.live = false;
  flashes.length = 0;
  played = [];
  changed();
  build();
});
for (const ev of ['pointerup', 'pointercancel']) {
  window.addEventListener(ev, () => {
    if (moving < 0) return;
    moving = held = -1;
    panel.classList.remove('moving');
    showHot();
  });
}

// --- the knobs: turned by dragging, catching on their marks (the middle, the quarters, the round numbers) ---

/** the quarters, for every knob that goes from 0 to 100; and the marks of those that do not */
const QUARTERS = [0, 25, 50, 75, 100];
const SNAPS: Record<string, number[]> = {
  volume: [0, 25, 50, 75, 80, 100],
  swing: [0, 45, 90, 135, 180],
  len: [0.25, 0.5, 0.75, 1, 1.25, 1.5],
  phase: [0, 45, 90, 135, 180, 225, 270, 315, 360],
  bpm: [60, 80, 90, 100, 120, 140, 160, 180, 200],
};
/** how near a mark catches, of the knob's whole way */
const CATCH = 0.035;
/** pixels of drag to the whole of a knob's way: the gauge's height, so its fill goes with the pointer */
const TURN_PX = 140;
/**
 * The knob being turned, where the pointer took it and what it was then. `on`: the press is on
 * its gauge, left open, and the value is where the pointer is on it. `moved`: it was dragged,
 * not clicked. `was`: its gauge was open already.
 */
let turning: { el: HTMLElement; x: number; y: number; from: number; on: boolean; moved: boolean; was: boolean } | null = null;

// The gauge, as on day 07: one tall pill over the knob that is held, filled as far as the knob
// is turned, its number at the foot. A click on a knob leaves it open, and it is dragged on.
const gauge = document.createElement('div');
gauge.className = 'gauge';
gauge.innerHTML = '<div class="track"><div class="fill"></div><b></b></div>';
document.body.append(gauge);
let gaugeFor: HTMLElement | null = null;
let gaugeUntil = 0;
const pinned = () => gauge.classList.contains('pinned');

function fillGauge() {
  const el = gaugeFor;
  if (!el) return;
  const min = Number(el.dataset.min);
  const v = Number(el.dataset.value);
  const p = el.dataset.p;
  gauge.style.setProperty('--t', ((v - min) / (Number(el.dataset.max) - min || 1)).toFixed(4));
  gauge.querySelector('b')!.textContent = p === 'swing' || p === 'phase' ? `${v}°` : p === 'n' ? `×${v}` : String(v);
}
function showGauge(el: HTMLElement | null, pin = false) {
  window.clearTimeout(gaugeUntil);
  gaugeFor?.classList.remove('on');
  gaugeFor = el;
  gauge.classList.toggle('open', !!el);
  gauge.classList.toggle('pinned', !!el && pin);
  if (!el) return;
  el.classList.add('on');
  const r = el.getBoundingClientRect();
  // over the knob, or under it where there is no room over it (the tempo, at the top)
  const below = r.top < 190;
  gauge.classList.toggle('below', below);
  gauge.style.left = `${Math.min(window.innerWidth - 26, Math.max(26, r.left + r.width / 2))}px`;
  gauge.style.top = `${below ? r.bottom + 10 : r.top - 10}px`;
  gauge.style.setProperty('--arm', getComputedStyle(el).getPropertyValue('--arm').trim() || ink(1));
  fillGauge();
}

/** a knob's new value, put where it belongs: the tempo, the mix, or an arm's own */
function setParam(el: HTMLElement, v: number) {
  const p = el.dataset.p!;
  setKnob(el, v);
  if (p === 'bpm') {
    anchor();
    state.bpm = v;
  } else if (p === 'reverb' || p === 'room' || p === 'delay' || p === 'harm' || p === 'volume' || p === 'dist' || p === 'damp') {
    state[p] = v / 100;
  } else {
    const a = state.arms[Number(el.closest<HTMLElement>('.arm')!.dataset.k)];
    if (p === 'n') {
      a.n = v;
      // its count is written beside the knob
      el.closest('.arm')!.querySelector('output')!.textContent = `×${v}`;
    } else if (p === 'swing') a.swing = rad(v);
    else if (p === 'phase') a.phase = rad(v);
    else if (p === 'vol') a.vol = v / 100;
    else if (p === 'mass') a.mass = v / 100;
    else if (p === 'push') a.push = v / 100;
    else a.len = v;
  }
  if (gaugeFor === el) fillGauge();
  changed();
}

/** v brought onto the knob's steps and within its ends */
function stepped(el: HTMLElement, v: number): number {
  const min = Number(el.dataset.min);
  const max = Number(el.dataset.max);
  const step = Number(el.dataset.step) || 1;
  return Math.min(max, Math.max(min, Math.round((Math.round((v - min) / step) * step + min) * 100) / 100));
}

window.addEventListener('pointerdown', (e) => {
  const t = e.target as HTMLElement;
  // a gauge left open: a press on it turns its knob to where the press is, a press anywhere else puts it away
  if (gaugeFor && pinned() && gauge.contains(t)) {
    e.preventDefault();
    turning = { el: gaugeFor, x: e.clientX, y: e.clientY, from: Number(gaugeFor.dataset.value), on: true, moved: true, was: true };
    turn(e);
    return;
  }
  const k = t.closest?.<HTMLElement>('.knob');
  const was = !!k && gaugeFor === k && pinned();
  if (gaugeFor && gaugeFor !== k) showGauge(null);
  if (!k) return;
  e.preventDefault();
  k.focus();
  turning = { el: k, x: e.clientX, y: e.clientY, from: Number(k.dataset.value), on: false, moved: false, was };
  showGauge(k);
});
// the arrow keys step a knob that has the focus (ten steps with shift); no mark holds them
window.addEventListener('keydown', (e) => {
  const k = (e.target as HTMLElement).closest?.<HTMLElement>('.knob');
  if (!k || e.metaKey || e.ctrlKey || e.altKey) return;
  const way = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
  if (!way) return;
  e.preventDefault();
  e.stopPropagation();
  const open = gaugeFor === k && pinned();
  if (!open) showGauge(k);
  setParam(k, stepped(k, Number(k.dataset.value) + way * (Number(k.dataset.step) || 1) * (e.shiftKey ? 10 : 1)));
  if (!open) gaugeUntil = window.setTimeout(() => showGauge(null), 900);
});
function turn(e: PointerEvent) {
  if (!turning) return;
  const { el } = turning;
  const min = Number(el.dataset.min);
  const span = Number(el.dataset.max) - min;
  if (Math.abs(e.clientX - turning.x) + Math.abs(e.clientY - turning.y) > 3) turning.moved = true;
  let v: number;
  if (turning.on) {
    // on the gauge: where the pointer is on it
    const r = gauge.querySelector('.track')!.getBoundingClientRect();
    v = stepped(el, min + Math.min(1, Math.max(0, (r.bottom - 9 - e.clientY) / (r.height - 18))) * span);
  } else {
    // up, or to the right, is more
    v = stepped(el, turning.from + ((turning.y - e.clientY + e.clientX - turning.x) / TURN_PX) * span);
  }
  // shift turns past the marks
  if (!e.shiftKey) for (const m of SNAPS[el.dataset.p ?? ''] ?? (el.dataset.max === '100' ? QUARTERS : [])) if (Math.abs(v - m) <= span * CATCH) v = m;
  if (v !== Number(el.dataset.value)) setParam(el, v);
}
window.addEventListener('pointermove', turn);
for (const ev of ['pointerup', 'pointercancel']) {
  window.addEventListener(ev, () => {
    if (!turning) return;
    // dragged: the gauge goes with the finger. Clicked: it stays, or goes if it was there already.
    if (!turning.on) showGauge(turning.moved || turning.was ? null : turning.el, true);
    turning = null;
  });
}

// --- presets: shift and a digit keeps the whole setup under it, the digit alone brings it back ---

const PRESETS_KEY = 'codevember-2026-18-presets';
let noted = '';
let notedUntil = 0;
/** a word under the title for a moment */
function note(text: string) {
  noted = text;
  notedUntil = clock() + 1.6;
}

const presets = () => (readJson(PRESETS_KEY) ?? {}) as Record<string, State>;

function savePreset(digit: string) {
  note(write(PRESETS_KEY, JSON.stringify({ ...presets(), [digit]: state })) ? `Saved ${digit}` : 'Nowhere to save');
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
const SAVES_KEY = `${KEY}-saves`;
const NAME_KEY = `${KEY}-name`;
/** the name this setup was last saved or opened under: what cmd+S writes to */
let current = read(NAME_KEY) ?? '';

function saves(): Saved[] {
  const all = readJson(SAVES_KEY);
  return Array.isArray(all) ? all.filter((s) => s && typeof s.name === 'string' && s.name) : [];
}

function keep(all: Saved[], name: string): boolean {
  if (write(SAVES_KEY, JSON.stringify(all)) && write(NAME_KEY, name)) {
    current = name;
    return true;
  }
  note('Nowhere to save');
  return false;
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
  // cmd (or ctrl) and up or down: the lit link (the one the pointer is in the ring of, or held) louder or quieter
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && sheet.hidden) {
    const k = litArm();
    if (k < 0 || k >= state.arms.length) return;
    e.preventDefault();
    const a = state.arms[k];
    a.vol = Math.round(Math.min(1, Math.max(0, a.vol + (e.key === 'ArrowUp' ? 0.05 : -0.05))) * 100) / 100;
    note(`Volume ${pct(a.vol)}`);
    changed();
    build();
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
  else if (e.key === 'n') toggle('scale');
  else if (e.key === 'i') toggle('instrument');
  else if (e.key === 'b') toggle('by');
  else if (e.key === 't') setTimeline(!timeline);
  else return;
  e.preventDefault();
  changed();
  build();
});

// --- the drawing: lines ---

let w = 0;
let h = 0;
let dpr = 1;
/** pixels to an arm length, eased so a chain outgrowing the ruler does not jump */
let unit = 0;
/** the ruler as it was last drawn: its top, and its pixels to an arm length */
let ruler = { y0: 0, unit: 1 };
/** the pointer is on the root; it is moving the root; it is pulling an arm longer (which, and from where) */
let onRoot = false;
let rooting = false;
let pull: { k: number; x: number; y: number; len: number; swing: number; vol: number; way: '' | 'len' | 'swing' | 'vol' } | null = null;

function resize() {
  dpr = Math.min(window.devicePixelRatio, 2);
  w = window.innerWidth;
  h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  measure();
}

const ink = (a: number) => `rgba(${INK}, ${a})`;
/** link k's colour, its own wherever it is in the chain: the arm and the joint at its end, its path, its rings, its row in the tracks' panel */
const tint = (k: number, a: number) => `rgba(${colour ? PALETTE[(state.arms[k]?.hue ?? k) % PALETTE.length] : INK}, ${a})`;
/** a line in the ink, or in link k's colour */
function line(x0: number, y0: number, x1: number, y1: number, a: number, width = 1, k = -1) {
  ctx.strokeStyle = k < 0 ? ink(a) : tint(k, a);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

const now: number[] = [];
const then: number[] = [];
const pushes: number[] = [];
/** the chain on the screen, as it was last drawn: the pivot, then every joint */
const seen: number[] = [];
/** the link the pointer is on, or -1; and the one a click holds lit */
let hot = -1;
/** it is lit from its track in the panel, not from the chain */
let hotRow = false;
let held = -1;
/** the link that is lit: the one the pointer is on, else the one a click holds */
const litArm = () => (hot >= 0 ? hot : held);
const trail = new Float32Array((TRAIL + 1) * 2 * MAX_ARMS);
let hinted = '';
let drawn = 0;

function frame() {
  const t = clock();
  const phi = phaseAt(t);
  const arms = state.arms;
  const n = arms.length;
  ctx.clearRect(0, 0, w, h);

  // where things go: the workbench along the bottom, the chain in the middle of what is over
  // it. Where the rows have no curves beside them (a phone, or no workbench at all) the hits
  // go on one line right under the chain instead.
  const wide = w > 760;
  const edge = wide ? 24 : 16;
  let total = 0;
  for (const a of arms) total += a.len;
  const wall = w - edge;
  const cx0 = rowsRight + 28;
  const cw = wall - cx0;
  const curves = timeline && !clean && wide && cw > 120 && rowBoxes.length >= n;
  // the chain hangs in the middle of the screen, the rows under it in the middle too
  const px = w / 2;
  // The ruler of notes stands still, from under the title to over the workbench, and the root
  // hangs where it is put on it. An arm length is always the same stretch of it, so where a
  // joint is says its note; only a chain too long for the ruler makes it all smaller.
  const y0 = Math.max(wide ? 84 : 124, topClear + 18);
  const y1 = Math.max(y0 + 120, (clean ? h - 30 : panelTop - 18) - (timeline && !curves ? 80 : 28));
  const target = (y1 - y0) / Math.max(RULER, state.root + total + 0.05);
  // while an arm is being pulled longer the scale holds still, or the ring would slide from under the pointer
  if (!pull) unit = unit ? unit + (target - unit) * (1 - Math.exp(-(t - drawn) * 8)) : target;
  drawn = t;
  const py = y0 + state.root * unit;
  const reach = Math.max(40, Math.min(px - edge, (RULER * unit) / 2));
  const tlY = y1 + 44;
  const tlX0 = px - reach;
  const tlX1 = px + reach;
  const X = (x: number) => px + x * unit;
  const Y = (y: number) => py + y * unit;
  ruler = { y0, unit };

  pose(phi, now);

  // The centre line, from the top of the page to the bottom: one line, nothing marked on it.
  // The stretch of it under the root is what a joint on the sum has to cross, a little brighter.
  // Where a joint is on it when it hits is still its note (low at the top), the nearest one of
  // the scale: that is heard, not drawn.
  if (!bare) {
    line(px, 0, px, h, 0.1);
    if (arms.some((a) => a.mode === 'sum')) line(px, py, px, Y(total) + 14, 0.25);
  }
  // Only on the drum machine by hit, where a height is a sound and not a pitch, each one is
  // named beside the line (they go round, a sound a note of the scale, down the ruler), so a
  // joint can be put on the one that is wanted.
  if (state.instrument === '808' && state.by === 'hit') {
    const marks = scaleNotes();
    ctx.font = '600 8px Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = ink(0.5);
    let step = 0;
    for (let m = 0; m <= SPAN; m++) {
      if (!marks.includes(m % 12)) continue;
      ctx.fillText(KIT[step % KIT.length], px + 9, y0 + (m / SPAN) * RULER * unit + 0.5);
      step++;
    }
  }
  // by arm: where each arm rests on the ruler is its note, so that is marked, in its colour
  if (state.by === 'arm' && !isKit()) {
    for (let k = 0; k < n; k++) {
      const y = Y(rest(k));
      ctx.fillStyle = tint(k, 0.95);
      ctx.beginPath();
      ctx.moveTo(px - 6, y);
      ctx.lineTo(px - 13, y - 4);
      ctx.lineTo(px - 13, y + 4);
      ctx.fill();
    }
  }
  for (let k = 0; k < n; k++) {
    if (arms[k].mode !== 'each') continue;
    const ox = k ? X(now[2 * k - 2]) : px;
    const oy = k ? Y(now[2 * k - 1]) : py;
    line(ox, oy, ox, oy + arms[k].len * unit, 0.35, 1, k);
  }

  // Every joint's path, the last one's a little brighter: a tail, the half of a bar
  // behind it, brightest where it has just been and gone by the end of that. One stroke has one
  // colour, so it is drawn in pieces, each a little fainter.
  const weighted = state.physics;
  if (!weighted) shape();
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  if (weighted) {
    for (let i = 0; i <= TRAIL; i++) trail.set(pose(phi - 1 + i / TRAIL, then), i * 2 * MAX_ARMS);
  }
  const head = Math.floor((phi - Math.floor(phi)) * ORBIT);
  // with a link lit (the pointer in its ring, or held by a click), its path alone
  const only = litArm();
  for (let k = 0; k < n; k++) {
    if (only >= 0 && only < n && k !== only) continue;
    const o = orbits[k];
    const bright = k === n - 1 || k === only ? 0.9 : 0.5;
    for (let c = 0; c < PIECES; c++) {
      ctx.strokeStyle = tint(k, bright * Math.pow(1 - (c + 0.5) / PIECES, 1.7));
      ctx.beginPath();
      if (weighted) {
        const per = (TRAIL * TAIL) / PIECES;
        for (let m = 0; m <= per; m++) {
          const i = TRAIL - c * per - m;
          ctx.lineTo(X(trail[(i * MAX_ARMS + k) * 2]), Y(trail[(i * MAX_ARMS + k) * 2 + 1]));
        }
      } else {
        const per = (ORBIT * TAIL) / PIECES;
        for (let m = 0; m <= per; m++) {
          const i = (((head - c * per - m) % ORBIT) + ORBIT) % ORBIT;
          ctx.lineTo(X(o[2 * i]), Y(o[2 * i + 1]));
        }
      }
      ctx.stroke();
    }
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
    if (bare) continue;
    pose(f.phase, then);
    ctx.strokeStyle = tint(f.k, (1 - age / 0.4) ** 2 * (0.25 + 0.75 * f.vel) * (0.15 + 0.85 * heard(f.k)) * f.kept);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(X(then[2 * f.k]), Y(then[2 * f.k + 1]), 5 + age * (40 + 80 * f.vel), 0, TAU);
    ctx.stroke();
  }

  // the chain
  ctx.lineCap = 'round';
  // where it is on the screen, for the pointer: the pivot, then every joint
  seen[0] = px;
  seen[1] = py;
  for (let k = 0; k < n; k++) {
    seen[2 * k + 2] = X(now[2 * k]);
    seen[2 * k + 3] = Y(now[2 * k + 1]);
  }
  seen.length = 2 * n + 2;
  // The link that is lit (the pointer in its ring, or on its row, or held by a click): its ring
  // round the root, from where the arms above it end to where it ends when the chain hangs
  // straight, and a soft rounded bar round the arm itself. The rings stand still: a link can be
  // picked while it moves.
  const lit1 = only;
  if (lit1 >= 0 && lit1 < n) {
    let inner = 0;
    for (let k = 0; k < lit1; k++) inner += arms[k].len * unit;
    const outer = inner + arms[lit1].len * unit;
    ctx.beginPath();
    ctx.arc(px, py, outer, 0, TAU);
    ctx.arc(px, py, inner, 0, TAU, true);
    // Pointed at on the chain, how loud the link is, to be seen: the ring fuller the louder,
    // never solid, all but clear when it is muted. Pointed at from its track, only a light
    // ground to say which one it is: its knobs are right there under the pointer.
    const fromTrack = hot >= 0 ? hotRow : moving >= 0;
    ctx.fillStyle = tint(lit1, fromTrack ? 0.05 : 0.025 + 0.3 * heard(lit1));
    ctx.fill('evenodd');
    ctx.strokeStyle = tint(lit1, fromTrack ? 0.18 : 0.4);
    ctx.lineWidth = 1;
    for (const r of [inner, outer]) {
      if (r < 1) continue;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.stroke();
    }
    line(seen[2 * lit1], seen[2 * lit1 + 1], seen[2 * lit1 + 2], seen[2 * lit1 + 3], 0.22, 16, lit1);
  }
  // a link is all one colour: the arm and the joint at its end
  for (let k = 0; k < n; k++) line(k ? X(now[2 * k - 2]) : px, k ? Y(now[2 * k - 1]) : py, X(now[2 * k]), Y(now[2 * k + 1]), 1, 2, k);
  // The push, where it can be seen: at each joint an arrow along the way its motor is pushing
  // it right now, as long as the push is hard (against the hardest its own swing ever turns).
  // On the formula there is none.
  if (state.physics && sim.pushAt(arms, phi, pushes)) {
    for (let k = 0; k < n; k++) {
      const wn = TAU * arms[k].n;
      const long = Math.max(-70, Math.min(70, (pushes[k] / (wn * wn * Math.max(arms[k].swing, 0.2))) * 44));
      if (Math.abs(long) < 2) continue;
      const jx = X(now[2 * k]);
      const jy = Y(now[2 * k + 1]);
      // along the joint's own way round its origin
      const dx = now[2 * k] - (k ? now[2 * k - 2] : 0);
      const dy = now[2 * k + 1] - (k ? now[2 * k - 1] : 0);
      const l = Math.hypot(dx, dy) || 1;
      const tx = (dy / l) * Math.sign(long);
      const ty = (-dx / l) * Math.sign(long);
      const ex = jx + tx * Math.abs(long);
      const ey = jy + ty * Math.abs(long);
      line(jx, jy, ex, ey, 0.9, 1.25, k);
      const head = Math.min(6, Math.abs(long) * 0.5);
      line(ex, ey, ex - (tx * 0.9 + ty * 0.45) * head, ey - (ty * 0.9 - tx * 0.45) * head, 0.9, 1.25, k);
      line(ex, ey, ex - (tx * 0.9 - ty * 0.45) * head, ey - (ty * 0.9 + tx * 0.45) * head, 0.9, 1.25, k);
    }
  }
  // the root: a handle, to be put higher or lower on the ruler
  ctx.fillStyle = BACK;
  ctx.strokeStyle = ink(onRoot || rooting ? 1 : 0.7);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(px, py, onRoot || rooting ? 7 : 5.5, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ink(0.95);
  ctx.beginPath();
  ctx.arc(px, py, 2, 0, TAU);
  ctx.fill();
  for (let k = 0; k < n; k++) {
    // all its colour, as big as it is heavy with physics on; when it sounds it swells and goes white for a moment
    const hit = Math.max(0, lit[k]);
    ctx.beginPath();
    ctx.arc(X(now[2 * k]), Y(now[2 * k + 1]), (state.physics ? 2.5 + 4.5 * Math.sqrt(arms[k].mass) : 5) * (1 + 0.5 * hit), 0, TAU);
    ctx.fillStyle = tint(k, 1);
    ctx.fill();
    if (hit > 0) {
      ctx.fillStyle = ink(0.85 * hit);
      ctx.fill();
    }
  }

  // the bar, one line: a tick a hit in its link's colour, up for tick and down for tock, as tall
  // as it is hard; hits that fall together stand on each other
  const tlW = tlX1 - tlX0;
  const at = phi - Math.floor(phi);
  // with weight no bar is the next one: the hits as they fell, the playhead writing over the bar before
  if (played.length && played[0].phase < phi - 1.5) played = played.filter((b) => b.phase > phi - 1);
  if (timeline && !curves) {
    line(tlX0, tlY, tlX1, tlY, 0.25);
    for (let q = 0; q <= 4; q++) line(tlX0 + (tlW * q) / 4, tlY - 2, tlX0 + (tlW * q) / 4, tlY + 2, 0.35);
    const stood = new Map<number, number>();
    for (const b of weighted ? played : bar) {
      const since = weighted ? phi - b.phase : (at - b.phase + 1) % 1;
      if (since < 0 || since >= 1 || b.k >= n) continue;
      const x = tlX0 + (b.phase - Math.floor(b.phase)) * tlW;
      const glow = since < 0.03 ? 1 - since / 0.03 : 0;
      const key = (Math.round(x) + 1) * b.dir;
      const from = stood.get(key) ?? 2;
      const tall = 2.5 + 5 * b.vel + 2 * glow;
      stood.set(key, from + tall + 2);
      line(x, tlY - b.dir * from, x, tlY - b.dir * (from + tall), ((weighted ? 0.9 - 0.6 * since : 0.8) + 0.2 * glow) * (0.2 + 0.8 * heard(b.k)), 1.5, b.k);
    }
    line(tlX0 + at * tlW, tlY - 14, tlX0 + at * tlW, tlY + 14, 0.5);
  }

  // Beside each link's row, its curve: what its joint crosses zero with, over the bar (in sum
  // every arm above it added up, in each its own swing). A hit is where the curve crosses the
  // line. With physics it is the bar behind, as it went, wrapping at the playhead.
  if (curves) {
    for (let k = 0; k < n; k++) {
      const { y, h: rh } = rowBoxes[k];
      const amp = rh / 2 + 3;
      line(cx0, y, cx0 + cw, y, 0.2, 1, k);
      ctx.strokeStyle = tint(k, 0.35 + 0.6 * heard(k));
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      if (weighted) {
        const own = arms[k].mode === 'each' && k > 0;
        const val = (i: number) => trail[(i * MAX_ARMS + k) * 2] - (own ? trail[(i * MAX_ARMS + k - 1) * 2] : 0);
        // as tall as the row whatever it does, but never blown up from next to nothing
        let top = 0.05 * arms[k].len;
        for (let i = 0; i <= TRAIL; i++) top = Math.max(top, Math.abs(val(i)));
        let last = -1;
        for (let i = 0; i <= TRAIL; i++) {
          const p = phi - 1 + i / TRAIL;
          const f = p - Math.floor(p);
          const v = val(i);
          if (f < last) ctx.moveTo(cx0 + f * cw, y - (v / top) * amp);
          else ctx.lineTo(cx0 + f * cw, y - (v / top) * amp);
          last = f;
        }
      } else {
        const top = waveTop[k] || 1;
        for (let i = 0; i <= WAVE; i++) ctx.lineTo(cx0 + (i / WAVE) * cw, y - (waves[k][i] / top) * amp);
      }
      ctx.stroke();
    }
    for (const b of weighted ? played : bar) {
      const since = weighted ? phi - b.phase : (at - b.phase + 1) % 1;
      if (since < 0 || since >= 1 || b.k >= n) continue;
      const glow = since < 0.03 ? 1 - since / 0.03 : 0;
      ctx.fillStyle = tint(b.k, (0.25 + 0.75 * heard(b.k)) * (weighted ? 1 - 0.6 * since : 1));
      ctx.beginPath();
      ctx.arc(cx0 + (b.phase - Math.floor(b.phase)) * cw, rowBoxes[b.k].y, 1.5 + 1.5 * b.vel + 2 * glow, 0, TAU);
      ctx.fill();
    }
    line(cx0 + at * cw, rowBoxes[0].y - rowBoxes[0].h / 2 - 2, cx0 + at * cw, rowBoxes[n - 1].y + rowBoxes[n - 1].h / 2 + 2, 0.5);
  }

  // under the title: a word for a moment, or, should the browser have put the sound to sleep again after the card, how to wake it
  const say = t < notedUntil ? noted : veil || sound?.running ? '' : 'Tap for sound';
  if (say !== hinted) hint.textContent = hinted = say;

  requestAnimationFrame(frame);
}

// the dev console: __pendulum.sound()?.stats says how many hits went out and how far ahead
if (import.meta.env.DEV) Object.assign(window, { __pendulum: { state, sim, energy: () => sim.energy(state.arms), sound: () => sound, bar: () => (shape(), bar), played: () => played } });

// --- the link under the pointer: lit on the chain and in the tracks' panel, from either side ---

function showHot() {
  const k = litArm();
  panel.querySelectorAll('.arm').forEach((row, i) => row.classList.toggle('hot', i === k));
}

/** `row`: the pointer is on the link's track, not on the chain */
function heat(k: number, row = false) {
  hotRow = row && k >= 0;
  if (k === hot) return;
  hot = k;
  canvas.style.cursor = k >= 0 ? 'pointer' : '';
  showHot();
}

/**
 * Which link the point belongs to, by how far it is from the root alone: the first arm's length
 * out is the first link, the next arm's length beyond that the second, and so on (and a little
 * over the last). Where the chain is has no say, so the same place is always the same link:
 * one can be picked while it all moves.
 */
function armAt(x: number, y: number, over = 10): number {
  if (seen.length < 4) return -1;
  const d = Math.hypot(x - seen[0], y - seen[1]);
  let r = 0;
  for (let k = 0; k < state.arms.length; k++) {
    r += state.arms[k].len * unit;
    if (d <= r) return k;
  }
  return d <= r + over ? state.arms.length - 1 : -1;
}

/** pixels of a sideways drag to a degree of swing, and of a drag up or down to the whole of a volume */
const SWING_PX = 3;
const VOL_PX = 160;
const fromRoot = (e: PointerEvent) => Math.hypot(e.clientX - seen[0], e.clientY - seen[1]);
/** the root or a ring was dragged somewhere since it was pressed */
let moved = false;

window.addEventListener('pointermove', (e) => {
  // the root, held: it goes up and down the ruler with the pointer, and the key with it
  if (rooting) {
    const to = rootIn((e.clientY - ruler.y0) / ruler.unit);
    if (to === state.root) return;
    state.root = to;
    moved = true;
    changed();
    return;
  }
  // A ring, held. Up and down is the arm's length (down, longer: as far as the pointer goes).
  // Left and right is its swing (right, wider). Whichever way it sets off, it keeps to.
  if (pull) {
    const dx = e.clientX - pull.x;
    const dy = e.clientY - pull.y;
    if (!pull.way) {
      if (Math.hypot(dx, dy) < 5) return;
      // with cmd (or ctrl) held, up and down is how loud the link is instead
      pull.way = Math.abs(dx) > Math.abs(dy) ? 'swing' : e.metaKey || e.ctrlKey ? 'vol' : 'len';
    }
    const a = state.arms[pull.k];
    const way = pull.way as 'len' | 'swing' | 'vol';
    canvas.style.cursor = way === 'swing' ? 'ew-resize' : 'ns-resize';
    // (to the steps its knob has: most moves of the pointer change nothing)
    const to = way === 'len' ? Math.round(within(pull.len + dy / ruler.unit, 0.1, 1.5) * 100) / 100 : way === 'vol' ? Math.round(unit01(pull.vol - dy / VOL_PX, 0) * 100) / 100 : rad(Math.round(within((pull.swing * 180) / Math.PI + dx / SWING_PX, 0, 180)));
    if (to === a[way]) return;
    a[way] = to;
    moved = true;
    if (way === 'vol') note(`Volume ${pct(to)}`);
    const its = panel.querySelector<HTMLElement>(`.arm[data-k="${pull.k}"] .knob[data-p="${way}"]`);
    if (its) setKnob(its, way === 'len' ? to : way === 'vol' ? pct(to) : deg(to));
    changed();
    return;
  }
  const row = (e.target as HTMLElement).closest?.<HTMLElement>('.arm');
  onRoot = e.target === canvas && seen.length > 1 && fromRoot(e) <= 12;
  heat(row ? Number(row.dataset.k) : e.target === canvas && !onRoot ? armAt(e.clientX, e.clientY) : -1, !!row);
  if (onRoot) canvas.style.cursor = 'ns-resize';
});
// A press on the root takes hold of it. A press in a ring holds that link lit (until a press
// lands in none), and dragged from there pulls its arm longer or shorter.
window.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas || seen.length < 2) return;
  const finger = e.pointerType !== 'mouse';
  if (fromRoot(e) <= (finger ? 22 : 12)) {
    rooting = true;
    held = -1;
  } else {
    held = armAt(e.clientX, e.clientY, finger ? 18 : 10);
    if (held >= 0) pull = { k: held, x: e.clientX, y: e.clientY, len: state.arms[held].len, swing: state.arms[held].swing, vol: state.arms[held].vol, way: '' };
  }
  canvas.setPointerCapture?.(e.pointerId);
  showHot();
});
for (const ev of ['pointerup', 'pointercancel']) {
  window.addEventListener(ev, () => {
    if (!rooting && !pull) return;
    rooting = false;
    pull = null;
    // the rows say each arm's note when sounds go by arm: it may have moved (a press alone moves nothing)
    if (moved) build();
    moved = false;
  });
}
document.addEventListener('pointerleave', () => heat(-1));

window.addEventListener('resize', resize);
changed();
build();
resize();
requestAnimationFrame(frame);
