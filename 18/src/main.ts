import { ACID_START, type Acid, INSTRUMENTS, KIT, RULER, SCALES, SPAN, Sound, TREM_DIVS, TREM_START, noteAt, stepOf } from './audio';
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
// On a phone, under the bar: the track shown, in short (its number in its colour, its mute,
// its volume) and the way to the one before and the next. The rest of it is on the sheet.
const lead = Object.assign(document.createElement('div'), { className: 'lead pill ui' });
lead.setAttribute('role', 'group');
lead.setAttribute('aria-label', 'Track');
topBar.after(lead);
const hint = document.querySelector<HTMLElement>('#hint')!;
const tip = document.querySelector<HTMLElement>('#tip')!;

const INK = '244, 244, 242';
const BACK = '#0b0b0d';
/** a colour a link, down the chain: green, cyan, a bluish purple, pink; then the tones between them, and a paler pink */
const PALETTE = ['72, 232, 150', '64, 208, 255', '118, 96, 255', '255, 150, 205', '66, 222, 204', '92, 150, 255', '187, 123, 230', '255, 196, 226'];
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
const TAIL = 1;
/** as waves, the most bars a hit and a path can live: what is kept of them (the weighted chain keeps sixteen bars itself) */
const WAVE_MAX = 4;
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
  /** how much a hit's speed counts in how loud it is, 0..1: at 0 every hit is as loud as the next */
  velocity: number;
  /** the tremolo: how deep, 0..1 (0 is none), and how fast: its place in audio.ts's note values, locked to the bar */
  trem: number;
  tremRate: number;
  /** the TB-303's knobs: kept whichever instrument it is, for when it is the 303 again */
  acid: Acid;
  /** how many bars of the tempo one bar of this pendulum's own takes: 1, 2, 4 or 8 (slower, never faster) */
  slow: number;
  /** 2 since the push knob has its lock point in the middle: older setups have theirs moved to where it does the same */
  v?: number;
  /**
   * Every pendulum, side by side, each its own chain, instrument and mix (the tempo is
   * everyone's), and which of them is the one being set. That one's are the fields
   * above too, and those are what is live: its entry here is brought up to date when it is kept.
   */
  pens?: Pen[];
  at?: number;
  /** the pendulum silenced in the mix, whatever its tracks; and, when any has it, only those that do are heard */
  mute?: boolean;
  solo?: boolean;
}
/** what is a pendulum's own: its chain, its instrument and notes, and its mix (the tempo alone is everyone's) */
type Pen = Pick<State, 'arms' | 'physics' | 'scale' | 'instrument' | 'by' | 'root' | 'mute' | 'solo' | 'reverb' | 'room' | 'delay' | 'harm' | 'volume' | 'dist' | 'damp' | 'velocity' | 'trem' | 'tremRate' | 'acid' | 'slow'>;
const chainOf = (s: Pen): Pen => ({
  arms: s.arms, physics: s.physics, scale: s.scale, instrument: s.instrument, by: s.by, root: s.root, mute: !!s.mute, solo: !!s.solo,
  reverb: s.reverb, room: s.room, delay: s.delay, harm: s.harm, volume: s.volume, dist: s.dist, damp: s.damp, velocity: s.velocity, trem: s.trem, tremRate: s.tremRate, acid: s.acid, slow: s.slow,
});
/** the most pendulums side by side */
const MAX_PENS = 8;
/** a setup from before there were several: it is the one */
function withPens(s: State): State {
  if (!s.pens?.length) {
    s.pens = [chainOf(s)];
    s.at = 0;
  }
  return s;
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
  root: 0,
  reverb: 0.25,
  room: 0.7,
  delay: 0.2,
  harm: 0.5,
  volume: 0.8,
  dist: 0,
  damp: 0,
  velocity: 1,
  trem: 0,
  tremRate: TREM_START,
  acid: { ...ACID_START },
  slow: 1,
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

/** how much slower a pendulum can run than the tempo: its bar takes this many bars of the tempo */
const SLOWS = [1, 2, 4, 8];
/** what the speed knob says under it, for each of them */
const SLOW_LABELS = ['×1', '×½', '×¼', '×⅛'];
/** the 303's knobs from storage or a link, each kept to its range and a missing one as it starts */
const acidIn = (a: Partial<Acid> | undefined): Acid => ({
  wave: a?.wave === 1 ? 1 : 0,
  cutoff: unit01(a?.cutoff as number, ACID_START.cutoff),
  res: unit01(a?.res as number, ACID_START.res),
  env: unit01(a?.env as number, ACID_START.env),
  decay: unit01(a?.decay as number, ACID_START.decay),
  accent: unit01(a?.accent as number, ACID_START.accent),
  slide: unit01(a?.slide as number, ACID_START.slide),
  tune: Number.isFinite(a?.tune) ? within(Math.round(a!.tune!), -12, 12) : 0,
});

/** the root's place on the ruler, kept on it */
const rootIn = (v: number | undefined, or = 0) => (Number.isFinite(v) ? within(v!, 0, RULER - 0.2) : or);

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
  // each pendulum made safe as a setup of its own would be, the rest of this one round it
  const pens = Array.isArray(s.pens)
    ? s.pens
        .slice(0, MAX_PENS)
        .map((p) => sane({ ...s, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)), pens: undefined }))
        .filter((p): p is State => !!p)
        .map(chainOf)
    : [];
  const out: State = {
    arms: s.arms.slice(0, MAX_ARMS).map((a, k) => ({ n: within(Math.round(a.n), 1, MAX_N), swing: within(a.swing, 0, Math.PI), len: within(a.len, 0.1, 1.5), phase: within(a.phase, 0, TAU), vol: unit01(a.vol, 1), mute: !!a.mute, solo: !!a.solo, mass: massFor(a.mass, k, s.weight), mode: (a.mode ?? s.mode) === 'each' ? 'each' : 'sum', push: s.v === 2 ? unit01(a.push, 0.5) : pushFrom(unit01(a.push ?? s.push ?? 0.3, 0.3)), hue: hues[k], sound: soundIn(a.sound, hues[k]) })),
    bpm: s.bpm >= 40 && s.bpm <= 220 ? s.bpm : d.bpm,
    physics: typeof s.physics === 'boolean' ? s.physics : s.weight! > 0,
    scale: SCALES.some((c) => c.id === s.scale) ? s.scale : d.scale,
    // (the 303 was the square voice before it had its name)
    instrument: INSTRUMENTS.some((c) => c.id === s.instrument) ? s.instrument : (s.instrument as string) === 'square' ? '303' : d.instrument,
    by: s.by === 'arm' ? 'arm' : 'hit',
    root: rootIn(s.root, d.root),
    reverb: unit01(s.reverb, d.reverb),
    room: unit01(s.room, d.room),
    delay: unit01(s.delay, d.delay),
    harm: unit01(s.harm, d.harm),
    volume: unit01(s.volume, d.volume),
    dist: unit01(s.dist, d.dist),
    damp: unit01(s.damp, d.damp),
    velocity: unit01(s.velocity, d.velocity),
    trem: unit01(s.trem, d.trem),
    acid: acidIn(s.acid),
    slow: SLOWS.includes(s.slow) ? s.slow : 1,
    tremRate: Number.isInteger(s.tremRate) && s.tremRate >= 0 && s.tremRate < TREM_DIVS.length ? s.tremRate : d.tremRate,
    v: 2,
    mute: !!s.mute,
    solo: !!s.solo,
  };
  if (!pens.length) return withPens(out);
  const at = Number.isInteger(s.at) ? within(s.at!, 0, pens.length - 1) : 0;
  return Object.assign(out, pens[at], { pens, at });
}

/** the drums: a sound an arm, not a note */
const kit = (id: string | null) => id === '808' || id === 'bones';

/**
 * ?arms=1-34-1,2-52-0.62-90-50-30-1-40 (swings, swing in degrees, length, then if any the phase
 * in degrees, the volume and the weight in percent, 1 for each or 0 for sum, and the push in
 * percent), &bpm=, &physics=1, &scale=kumoi, &instrument=bones, &by=arm, &root=0.4, &reverb= &room= &damping= &delay= &distortion= &harmonics= &volume= &velocity= (0 to 1), and for every arm that does not say: &mode=each, &push=0.5. A
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
  const parse = (q: string) =>
    q
      .split(',')
      .map((a) => a.split('-').map(Number))
      .filter((a) => a.length >= 3 && a.every(Number.isFinite))
      .map(([n, swing, len, phase = 0, vol = 100, mass, each = all, push = pushAll]) => ({ n, swing: rad(swing), len, phase: rad(((phase % 360) + 360) % 360), vol: vol / 100, mass: mass === undefined ? undefined : mass / 100, mode: each ? 'each' : 'sum', push: push / 100 }));
  const arms = parse(q);
  if (!arms.length) return null;
  const instrument = query.get('instrument');
  // More pendulums: &arms2= &instrument2= &scale2= &root2= &physics2= &by2= and the mix (&reverb2=
  // &room2= &damping2= &delay2= &distortion2= &harmonics2= &volume2= &velocity2= &tremolo2= &tremrate2=), to 4; what
  // one does not say is the first's.
  const pens: unknown[] = [];
  for (let j = 2; j <= MAX_PENS; j++) {
    const more = parse(query.get(`arms${j}`) ?? '');
    if (!more.length) continue;
    const its = query.get(`instrument${j}`) ?? instrument;
    const pick = (name: string) => query.get(`${name}${j}`) ?? query.get(name);
    // (a number it does not say is the first's: left out, the setup fills it in)
    const own = (name: string) => (query.has(`${name}${j}`) ? Number(query.get(`${name}${j}`)) : undefined);
    pens.push({
      arms: more, instrument: its, scale: pick('scale'), root: own('root') ?? num('root'), physics: query.has(`physics${j}`) ? query.get(`physics${j}`) !== '0' : query.has('physics'), by: pick('by') ?? (kit(its) ? 'arm' : 'hit'),
      reverb: own('reverb'), room: own('room'), delay: own('delay'), harm: own('harmonics'), volume: own('volume'), dist: own('distortion'), damp: own('damping'), velocity: own('velocity'), trem: own('tremolo'), tremRate: own('tremrate') === undefined ? undefined : Math.round(own('tremrate')!), slow: own('slow'),
    });
  }
  // (the drums go by arm unless the link says otherwise)
  return sane({ pens: pens.length ? [{ arms, instrument, scale: query.get('scale'), root: num('root'), physics: query.has('physics') ? query.get('physics') !== '0' : weight > 0, by: query.get('by') ?? (kit(instrument) ? 'arm' : 'hit') }, ...pens] : undefined, arms, bpm: num('bpm'), physics: query.has('physics') ? query.get('physics') !== '0' : weight > 0, scale: query.get('scale'), instrument, by: query.get('by') ?? (kit(instrument) ? 'arm' : 'hit'), root: num('root'), reverb: num('reverb'), room: num('room'), delay: num('delay'), harm: num('harmonics'), volume: num('volume'), dist: num('distortion'), damp: num('damping'), velocity: num('velocity'), trem: num('tremolo'), tremRate: Math.round(num('tremrate') ?? NaN), slow: num('slow'), weight, v: 2 });
}

const load = (): State => withPens(fromQuery() ?? sane(readJson(KEY)) ?? fresh());

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

/** a pattern opened from a link is a visit: it never writes over the one remembered (a name still keeps it) */
const linked = query.has('arms');
/** the setup is kept a moment after it was last set, not at every step of a drag; and at once when the page goes */
let keeping = 0;
function keepNow() {
  window.clearTimeout(keeping);
  keeping = 0;
  if (!linked) write(KEY, JSON.stringify(packed()));
}
window.addEventListener('pagehide', () => keeping && keepNow());
document.addEventListener('visibilitychange', () => keeping && document.hidden && keepNow());

/** the setup as it is kept: every pendulum, the one being set as it is now */
const packed = (): State => ({ ...state, pens: state.pens!.map((p, i) => (i === state.at ? chainOf(state) : p)) });

/** every pendulum's mix told to its own channel of the sound, which has one a pendulum and no more */
function tellSound() {
  if (!sound) return;
  sound.keep(state.pens!.length);
  state.pens!.forEach((_, i) => {
    const p = penNow(i);
    sound!.set(i, { reverb: p.reverb, room: p.room, delay: p.delay, harm: p.harm, volume: p.volume, dist: p.dist, damp: p.damp, velocity: p.velocity, trem: p.trem, tremRate: p.tremRate, acid: p.acid, instrument: p.instrument, bpm: state.bpm });
  });
}

/** something was set: the bar is to be worked out again, the sound told, the setup kept */
function changed() {
  stale = true;
  tellSound();
  if (!keeping) keeping = window.setTimeout(keepNow, 300);
}

// --- the sound, and the hits handed to it a little ahead ---

let sound: Sound | null = null;

function unlock() {
  if (!sound) {
    try {
      sound = new Sound();
      sound.muted = muted;
      sound.bar = phaseAt;
      tellSound();
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
  /** it has left its mark, for the waves */
  marked?: boolean;
}
const flashes: Flash[] = [];
/** every hit of the bar behind, for the bar's rows when no two bars are the same */
let played: Hit[] = [];
let scanned = NaN;
let sim = new Sim();
const scaleNotes = (scale = state.scale) => (SCALES.find((c) => c.id === scale) ?? SCALES[0]).notes;
/** how far down the chain arm k ends when it all hangs straight: its own place on the ruler */
function rest(k: number, arms = state.arms): number {
  let y = 0;
  for (let j = 0; j <= k && j < arms.length; j++) y += arms[j].len;
  return y;
}
/** the instruments that are a set of sounds, not one sound at many pitches */
const isKit = () => kit(state.instrument);
/** how loud arm k is heard: its volume, or nothing while it is muted, or while another is soloed and it is not */
function heard(k: number, arms = state.arms): number {
  const a = arms[k];
  if (!a || a.mute || (!a.solo && arms.some((b) => b.solo))) return 0;
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
let usual: number[] = [];
function centred(h: Hit, by = state.by): number {
  if (by !== 'arm') return 1;
  const was = usual[h.k];
  usual[h.k] = was === undefined ? h.pos : was + (h.pos - was) * 0.12;
  if (was === undefined) return 1;
  return 1 - (1 - OFF_CENTRE) * Math.min(1, Math.abs(h.pos - was) / 0.33);
}
/** where the joints of pendulum p are at φ: its weighted chain's where it has been run, the formula's otherwise */
const angles: number[] = [];
function poseOf(p: Pen, run: Sim, phi: number, out: number[]): number[] {
  const arms = p.arms;
  if (!(p.physics && run.sample(phi, arms.length, angles))) {
    for (let k = 0; k < arms.length; k++) angles[k] = angle(arms[k], phi);
    angles.length = arms.length;
  }
  return place(arms, angles, out);
}
const pose = (phi: number, out: number[]) => poseOf(state, sim, phi, out);

/**
 * A pendulum that is not the one being set goes on all the same: its own motion, its hits
 * heard on its own instrument, lit on its own chain. What it keeps is this; the one being set
 * keeps the same in the page's own (sim, scanned, flashes, usual), and the two are swapped
 * when another is picked.
 */
interface Runner {
  sim: Sim;
  scanned: number;
  flashes: Flash[];
  usual: number[];
  /** its chain as it was last drawn: its root, then every joint */
  seen: number[];
  /** its waves: each joint's way over a bar (on the formula), the arms they were worked out for, and the hits that are still drifting */
  orbits: Float32Array[];
  orbitKey: string;
  marks: Mark[];
}
const runner = (): Runner => ({ sim: new Sim(), scanned: NaN, flashes: [], usual: [], seen: [], orbits: [], orbitKey: '', marks: [] });
/** a runner a pendulum, none for the one being set */
let runners: (Runner | null)[] = state.pens!.map((_, i) => (i === state.at ? null : runner()));

/** pendulum i as it is now: the page's own fields for the one being set */
const penNow = (i: number): Pen => (i === state.at ? state : state.pens![i]);
/** whether pendulum i is heard in the mix: not muted, and soloed if any is */
function penHeard(i: number): boolean {
  const p = penNow(i);
  return !p.mute && (!!p.solo || !state.pens!.some((_, j) => penNow(j).solo));
}

/** hit h of pendulum p, at clock time `at`, heard: its own voice on its own note, on its own instrument. How much of its loudness it kept. */
function voice(i: number, p: Pen, h: Hit, at: number, on: boolean): number {
  const kept = centred(h, p.by);
  const notes = scaleNotes(p.scale);
  // its own voice, wherever it is in the chain, on the note where it is (or where its arm rests)
  const midi = noteAt(notes, (p.root + (p.by === 'arm' ? rest(h.k, p.arms) : h.pos)) / RULER);
  // a kit's sound: the arm's own when sounds go by arm, else the one at the note it hit
  const step = p.by === 'arm' && kit(p.instrument) ? (p.arms[h.k]?.sound ?? 0) : stepOf(notes, midi);
  // the sound squares its volume: the root of what is kept, so the hit is that much softer and no more
  if (on) sound?.hit(i, p.instrument, p.arms[h.k]?.hue ?? h.k, h.dir, h.vel, at, heard(h.k, p.arms) * Math.sqrt(kept), midi, step);
  return kept;
}

/** the hits of a chain from `from` to `to`, bars: its weighted chain run on, or the formula's */
function hitsOf(p: Pen, run: Sim, from: number, to: number, here: number, out: Hit[]) {
  if (p.physics) {
    // run the weighted chain on to there; from the formula if it is new, or was left far behind
    if (!run.live || run.phi < here - 0.25) run.reset(p.arms, from);
    run.advance(p.arms, to, from, out);
  } else {
    run.live = false;
    crossings(p.arms, from, to, out);
  }
}

/**
 * Pendulum i is the one being set: what was the one being set goes back into the list as it
 * is now and gets a runner of its own, its motion going on where it is; i's comes into the
 * page's place. Nothing is restarted: they all go on in time.
 */
function pick(i: number) {
  const pens = state.pens!;
  if (i === state.at || !pens[i]) return;
  const r = runners[i] ?? runner();
  const old = state.at!;
  if (old >= 0 && old < pens.length) {
    pens[old] = chainOf(state);
    runners[old] = { sim, scanned, flashes: flashes.splice(0), usual, seen: [], orbits: [], orbitKey: '', marks };
  }
  sim = r.sim;
  scanned = r.scanned;
  usual = r.usual;
  flashes.push(...r.flashes);
  runners[i] = null;
  Object.assign(state, pens[i]);
  state.at = i;
  played = [];
  marks = r.marks;
  held = -1;
  hot = -1;
  focus = 0;
  melodicBy = 'hit';
  hazePrev.length = 0;
  changed();
  build();
}

/** a new pendulum, the last, and the one being set: one arm, as a new piece starts, on the next instrument */
function addPen() {
  const pens = state.pens!;
  if (pens.length >= MAX_PENS) return;
  const next = INSTRUMENTS[(INSTRUMENTS.findIndex((c) => c.id === state.instrument) + 1) % INSTRUMENTS.length].id;
  const d = fresh();
  pens.push({ ...chainOf(d), arms: blank().arms, scale: state.scale, instrument: next, by: kit(next) ? 'arm' : 'hit', root: state.root });
  runners.push(runner());
  pick(pens.length - 1);
  note(`Pendulum ${pens.length}`);
}

/** the pendulum being set, again, beside the last: its arms and all, on the same instrument, and that one is set */
function duplicatePen() {
  const pens = state.pens!;
  if (pens.length >= MAX_PENS) return;
  const copy = chainOf(state);
  pens.push({ ...copy, arms: copy.arms.map((a) => ({ ...a })), acid: { ...copy.acid }, solo: false });
  runners.push(runner());
  pick(pens.length - 1);
  note(`Pendulum ${pens.length}, a copy`);
}

/** the pendulum being set taken away (never the last one): the one before it is set instead */
function removePen() {
  const pens = state.pens!;
  if (pens.length < 2) return;
  const i = state.at!;
  pens.splice(i, 1);
  runners.splice(i, 1);
  // (nothing of it is kept: there is no one being set until the next is picked)
  state.at = -1;
  pick(Math.max(0, i - 1));
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
  sound?.relock();
  scanned = SEED;
  if (state.physics) sim.reset(state.arms, SEED);
  else sim.live = false;
  flashes.length = 0;
  played = [];
  state.pens!.forEach((p, i) => {
    const r = runners[i];
    if (!r) return;
    r.scanned = SEED;
    r.flashes.length = 0;
    if (p.physics) r.sim.reset(p.arms, SEED);
    else r.sim.live = false;
  });
}

function schedule() {
  if (!playing) return;
  const t = clock();
  const here = phaseAt(t);
  const end = phaseAt(t + lookahead());
  sound?.sync();
  // (Each pendulum goes by a bar of its own: a slower one is at a bar of the tempo over its `slow`. What is scanned, and where a hit falls, is in its own bars; the time of a hit is its bar times that.)
  const hits: Hit[] = [];
  const s = state.slow;
  // the first tick, or the timer was held back (a hidden tab): no burst of old hits
  if (!(scanned >= here / s)) scanned = here / s;
  if (end / s > scanned) {
    hitsOf(state, sim, scanned, end / s, here / s, hits);
    for (const h of hits) {
      played.push(h);
      const at = t0 + (h.phase * s - phi0) * barSeconds();
      flashes.push({ ...h, t: at, kept: voice(state.at!, state, h, at, penHeard(state.at!)) });
    }
    scanned = end / s;
  }
  // and every other pendulum, the same, in its own
  const keep = usual;
  state.pens!.forEach((p, i) => {
    const r = runners[i];
    if (!r) return;
    const sr = p.slow;
    if (!(r.scanned >= here / sr)) r.scanned = here / sr;
    if (!(end / sr > r.scanned)) return;
    usual = r.usual;
    hits.length = 0;
    const on = penHeard(i);
    hitsOf(p, r.sim, r.scanned, end / sr, here / sr, hits);
    for (const h of hits) {
      const at = t0 + (h.phase * sr - phi0) * barSeconds();
      r.flashes.push({ ...h, t: at, kept: voice(i, p, h, at, on) });
    }
    r.scanned = end / sr;
  });
  usual = keep;
}
window.setInterval(schedule, 25);

// --- the panels ---

/** where the scene can begin: the top of the ruler of notes, the highest the root can hang */
let sceneTop = 36;
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
/** how wide each panel is when it is open: one put away keeps that width, and stands on the same line along the bottom */
const WIDTH_KEY = `${KEY}-widths`;
const openWidth: Record<string, number> = {};
{
  const kept = readJson(WIDTH_KEY) as Record<string, unknown> | null;
  for (const [id, v] of Object.entries(kept ?? {})) if (typeof v === 'number' && v > 0 && v < 2000) openWidth[id] = v;
}
const shutWidth = (id: string) => (openWidth[id] ? ` style="min-width: ${openWidth[id]}px"` : '');
const FOLD_KEY = `${KEY}-panels`;
const folded: Record<string, boolean> = { pens: false, mix: false, inst: false, tracks: false, ...(readJson(FOLD_KEY) as Record<string, boolean> | null) };
function fold(id: string) {
  folded[id] = !folded[id];
  write(FOLD_KEY, JSON.stringify(folded));
}

// Full screen (the button at the end of the bar, or F): the page alone, the big title gone
// with it. Where the browser cannot fill the screen (an iPhone) the title still goes.
let full = false;
function setFull(on: boolean) {
  full = on;
  document.body.classList.toggle('full', on);
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (on && !(document.fullscreenElement ?? d.webkitFullscreenElement)) (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())?.catch?.(() => {});
    else if (!on && (document.fullscreenElement ?? d.webkitFullscreenElement)) (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.())?.catch?.(() => {});
  } catch {
    // (the title goes all the same)
  }
  build();
}
// left by the browser's own way out (esc): the title comes back
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && full) setFull(false);
});

/** where the bar ends, when it lies under the title and reaches the middle (a phone): the ruler of notes starts under it */
let topClear = 0;
/** where the sheet along the bottom begins, on a phone (0 where there is none): the chain hangs over it, all of it */
let sheetTop = 0;
/** where the panels' column ends, on a wide page (0 where there is none): several pendulums hang right of it */
let panelRight = 0;
/** where the panels along the bottom begin (the top of the highest of the mix, the instrument and the tracks; 0 where there are none): the ruler of notes ends a little under it, so the chains hang over the panels and only bleed under them */
let panelTop = 0;
/** how far the bottom of the ruler goes in under the panels, pixels */
const PANEL_BLEED = 48;
/** the bar's box: a pendulum hung under it hangs from under it */
let barBox = { left: 0, right: 0, bottom: 0 };

/** a knob's column in a track's row: at least a knob wide, and the same share of what the panel has over as its neighbours' (the tracks fill the line) */
const KNOB_COL = 'minmax(36px, 1fr)';
/** the smallest the panels are scaled to, to stand on one line: below it they wrap instead */
const PANELS_LEAST = 0.68;

function measure() {
  // (at its own width first: neither scaled nor filling the line)
  panel.style.zoom = '';
  panel.classList.remove('wrap', 'fill');
  // what each open panel is wide (kept for when it is put away)
  let widened = false;
  for (const el of panel.querySelectorAll<HTMLElement>('[data-panel]')) {
    const id = el.dataset.panel!;
    if (el.classList.contains('shut') || !el.offsetWidth || openWidth[id] === el.offsetWidth) continue;
    openWidth[id] = el.offsetWidth;
    widened = true;
  }
  if (widened) write(WIDTH_KEY, JSON.stringify(openWidth));
  // The panels stand on one line, all of them. Where that is wider than the window they are
  // scaled down to fit (CSS zoom), and where that is too small to read they wrap; where there
  // is room over, the tracks (the last) take it, out to the edge of the screen.
  if (!PHONE.matches) {
    const need = panel.scrollWidth;
    const room = window.innerWidth - 48;
    if (need > room) {
      if (room / need >= PANELS_LEAST) panel.style.zoom = String(room / need);
      else panel.classList.add('wrap');
    } else panel.classList.add('fill');
  }
  // The bar sits top right; where the title reaches under it (a phone) it goes below the title instead.
  topBar.style.top = '';
  const plate = document.querySelector<HTMLElement>('.plate .head')?.getBoundingClientRect();
  let box = topBar.getBoundingClientRect();
  hint.style.marginTop = '';
  if (plate && box.left < plate.right + 8) {
    topBar.style.top = `${plate.bottom + 10}px`;
    box = topBar.getBoundingClientRect();
  }
  // the line under the title goes under the bar where the bar is in its way (a phone; and full
  // screen, with no title over it)
  const line = hint.getBoundingClientRect();
  if (line.top < box.bottom && line.bottom > box.top - 30 && box.left < line.left + 160) hint.style.marginTop = `${box.bottom + 8 - line.top}px`;
  // the track in short, under the bar on a phone: the scene starts under it
  lead.style.top = `${box.bottom + 8}px`;
  const under = PHONE.matches && !clean ? lead.getBoundingClientRect().bottom : 0;
  const mid = window.innerWidth / 2;
  barBox = clean ? { left: 0, right: 0, bottom: 0 } : { left: box.left, right: box.right, bottom: box.bottom };
  topClear = !clean && box.left < mid + 30 ? Math.max(box.bottom, under) : 0;
  // The chain hangs from as high as the page lets it: right under the top edge where the middle
  // is free, under the title where the title reaches the middle (a phone).
  sceneTop = !clean && plate && plate.right + 24 >= mid ? plate.bottom + 54 : 36;
  sheetTop = PHONE.matches && !clean ? (panel.querySelector('.tracks')?.getBoundingClientRect().top ?? 0) : 0;
  // (only where the panels are a column up the left side: side by side along the bottom they leave the room above them, and the pendulums spread across it)
  const boxesOf = [...panel.querySelectorAll<HTMLElement>('.voice, .tracks')].map((p) => p.getBoundingClientRect());
  const column = boxesOf.length > 0 && boxesOf.every((b) => Math.abs(b.left - boxesOf[0].left) < 4);
  panelRight = PHONE.matches || clean || !column ? 0 : Math.max(0, ...boxesOf.map((b) => b.right));
  // (the pendulums' panel is left out: with a row for each of eight it is the tallest, and the chains would be squeezed for it)
  const tops = [...panel.querySelectorAll<HTMLElement>('[data-panel]:not([data-panel="pens"])')].map((p) => p.getBoundingClientRect().top);
  panelTop = PHONE.matches || clean || !tops.length ? 0 : Math.min(...tops);
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
  full: icon('<path class="s" d="M2.5 5.5v-3h3M8.5 2.5h3v3M11.5 8.5v3h-3M5.5 11.5h-3v-3"/>'),
  unfull: icon('<path class="s" d="M5.5 2.5v3h-3M11.5 5.5h-3v-3M8.5 11.5v-3h3M2.5 8.5h3v3"/>'),
  eye: icon('<path class="s" d="M1.4 7s2.1-3.7 5.6-3.7S12.6 7 12.6 7s-2.1 3.7-5.6 3.7S1.4 7 1.4 7z"/><circle cx="7" cy="7" r="1.7"/>'),
  eyeShut: icon('<path class="s" d="M1.4 6c1.3 1.8 3.2 2.9 5.6 2.9s4.3-1.1 5.6-2.9"/><path class="s" d="M3.4 8.2l-1 1.5M7 8.9v1.9M10.6 8.2l1 1.5"/>'),
  warn: icon('<path class="s" d="M7 2L12.6 11.6H1.4z"/><path class="s" d="M7 5.8v2.6"/><circle cx="7" cy="10" r="0.75"/>'),
  // the size of a knob: it stands under the volume knobs
  plus: '<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><circle class="s ring" cx="11" cy="11" r="10.5"/><path class="s" d="M11 7.2v7.6M7.2 11h7.6"/></svg>',
  dup: '<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><circle class="s ring" cx="11" cy="11" r="10.5"/><rect class="s" x="6.4" y="8.6" width="6.8" height="6.8" rx="1"/><path class="s" d="M8.8 6.4h5.8a1 1 0 0 1 1 1v5.8"/></svg>',
  minus: '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><circle class="s ring" cx="9" cy="9" r="8"/><path class="s" d="M5.6 9h6.8"/></svg>',
  caret: '<svg viewBox="0 0 8 8" width="7" height="7" aria-hidden="true"><path class="s" d="M1.4 2.8L4 5.4l2.6-2.6"/></svg>',
};
/** an instrument at a glance: tine, three tines; bones, two knocked together; the 303, a saw; the 808, a pad; chatter, a bubble */
const INST_ICONS: Record<string, string> = {
  tine: icon('<path class="s" d="M3.5 11.5v-6M7 11.5v-9M10.5 11.5v-4.5"/>'),
  bones: icon('<path class="s" d="M4.2 9.8l5.6-5.6"/><circle cx="3.6" cy="10.4" r="1.4"/><circle cx="10.4" cy="3.6" r="1.4"/>'),
  '303': icon('<path class="s" d="M1.8 10.5l4.6-6.5v6.5l5.8-6.5"/>'),
  '808': icon('<rect class="s" x="2.5" y="2.5" width="9" height="9" rx="2"/><circle cx="7" cy="7" r="1.8"/>'),
  chatter: icon('<path class="s" d="M2.5 3h9v6.2H7.3L4.8 11.4V9.2H2.5z"/>'),
};
/** a pendulum's own colour, by its place in the row: the palette's, or the ink where the page is in black and white */
const penColour = (i: number) => `rgb(${colour ? PALETTE[i % PALETTE.length] : INK})`;
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

// On a phone the tracks are one at a time, its knobs alone: the one shown is the link a finger
// last tapped or stretched on the chain, or the one swiped to on the sheet (up or left for the
// next, down or right for the one before, round and round). Its rings stay lit on the chain, so
// which link it is can be seen.
const PHONE = matchMedia('(max-width: 760px)');
/** the tracks are one at a time (a phone, and the panel open) */
const oneRow = () => PHONE.matches;
/** the track shown, when they are one at a time */
let focus = 0;
function setFocus(k: number) {
  const n = state.arms.length;
  focus = ((k % n) + n) % n;
  if (!oneRow()) return;
  held = focus;
  build();
  showHot();
}
PHONE.addEventListener('change', () => build());

function build() {
  showGauge(null);
  if (focus >= state.arms.length) focus = state.arms.length - 1;
  const many = state.arms.length > 1;
  // Only the columns that do something are there: an arm's sound when sounds go by arm, its
  // weight and its push when the chain has physics.
  const bySound = state.by === 'arm';
  const knobs = state.physics ? 6 : 4;
  // the grip, solo, mute, volume, sum, (sound,) swings and its count, then the rest of the knobs, remove
  panel.style.setProperty('--cols', `14px 26px 26px ${KNOB_COL} 28px ${bySound ? `${KNOB_COL} ` : ''}${KNOB_COL} 24px repeat(${knobs - 1}, ${KNOB_COL}) 26px`);
  // (on a phone the grip, mute and volume are not on the sheet: the last two are over the scene)
  panel.style.setProperty('--cols-phone', `24px 32px 1fr 24px repeat(${knobs - 1}, 1fr) 26px`);
  /** a section of the panel under its label */
  const part = (label: string, inner: string) => `<section><h3>${label}</h3><div class="ctl">${inner}</div></section>`;
  /** a section of the mix, placed on its grid (see .mixgrid) */
  const slot = (cls: string, label: string, inner: string) => `<section class="${cls}"><h3>${label}</h3><div class="ctl">${inner}</div></section>`;
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
  // Up the left side, two panels, one on the other: the instrument over the mix, each in
  // sections under their labels, and under it the tracks, a row a link.
  /** the eye in a panel's corner: open while the panel is out, shut while it is put away */
  const eye = (id: string, name: string) =>
    `<button class="eye" data-act="fold" data-id="${id}" data-tip="fold" aria-expanded="${!folded[id]}" aria-label="${folded[id] ? 'Show' : 'Hide'} ${name}">${folded[id] ? ICONS.eyeShut : ICONS.eye}</button>`;
  panel.innerHTML = `
    ${
      folded.pens
        ? `<div class="voice shut" data-panel="pens"${shutWidth('pens')}><h3>Pendulums</h3>${eye('pens', 'the pendulums panel')}</div>`
        : `<div class="voice pens" data-panel="pens">
      ${eye('pens', 'the pendulums panel')}
      <div class="group" role="group" aria-label="Pendulums">
        ${part(
          'Pendulums',
          `<div class="stack" role="radiogroup" aria-label="The pendulum being set">${state.pens!.map((p, i) => {
            const now = penNow(i);
            const name = `pendulum ${i + 1}`;
            return `<span class="strip${i === state.at ? ' on' : ''}" data-id="${i}" style="--pen: ${penColour(i)}" data-tip="pen">
              <button class="no" role="radio" data-act="pen" data-id="${i}" aria-checked="${i === state.at}" aria-pressed="${i === state.at}" aria-label="Set ${name}">${i + 1}</button>
              <span class="inst" aria-hidden="true">${INST_ICONS[now.instrument] ?? ''}</span>
              <i class="what">${INSTRUMENTS.find((c) => c.id === now.instrument)?.label ?? ''}</i>
              <button class="ms" data-act="pensolo" data-id="${i}" data-tip="pensolo" aria-pressed="${!!now.solo}" aria-label="Solo ${name}">S</button>
              <button class="ms" data-act="penmute" data-id="${i}" data-tip="penmute" aria-pressed="${!!now.mute}" aria-label="Mute ${name}">M</button>
            </span>`;
          }).join('')}</div>
          <div class="acts">
            <button class="icon" data-act="addpen" data-tip="addpen" aria-label="Add a pendulum" ${state.pens!.length < MAX_PENS ? '' : 'disabled'}>${ICONS.plus}</button>
            <button class="icon" data-act="duppen" data-tip="duppen" aria-label="Duplicate this pendulum" ${state.pens!.length < MAX_PENS ? '' : 'disabled'}>${ICONS.dup}</button>
            <button class="icon" data-act="rmpen" data-tip="rmpen" aria-label="Remove this pendulum" ${state.pens!.length > 1 ? '' : 'disabled'}>${ICONS.minus}</button>
          </div>`,
        )}
      </div>
    </div>`
    }
    <div class="rest">
    ${
      folded.mix
        ? `<div class="voice shut" data-panel="mix"${shutWidth('mix')}><h3>Mix</h3>${eye('mix', 'the mix panel')}</div>`
        : `<div class="voice mix" data-panel="mix">
      ${eye('mix', 'the mix panel')}
      <div class="mixgrid" role="group" aria-label="Mix">
        <span class="rule" aria-hidden="true"></span>
        ${slot('m-mix', 'Mix', mix('volume', 'Volume', state.volume, 'Volume') + mix('velocity', 'Velocity', state.velocity, 'Velocity') + mix('harm', 'Harmonics', state.harm, 'Harm') + cell(SLOW_LABELS[SLOWS.indexOf(state.slow)], knob('slow', SLOWS.indexOf(state.slow), 0, SLOWS.length - 1, 1, 'Speed against the tempo, slower')))}
        ${slot('m-trem', 'Tremolo', mix('trem', 'Tremolo depth', state.trem, 'Depth') + cell(TREM_DIVS[state.tremRate].label, knob('tremRate', state.tremRate, 0, TREM_DIVS.length - 1, 1, 'Tremolo rate, a note value')))}
        ${slot('m-rev', 'Reverb', mix('reverb', 'Reverb', state.reverb, 'Amount') + mix('room', 'Room', state.room, 'Room') + mix('damp', 'Damping', state.damp, 'Damp'))}
        ${slot('m-delay', 'Delay', mix('delay', 'Delay', state.delay, 'Amount'))}
        ${slot('m-dist', 'Dist', mix('dist', 'Distortion', state.dist, 'Drive'))}
      </div>
    </div>`
    }
    ${
      folded.inst
        ? `<div class="voice shut" data-panel="inst"${shutWidth('inst')}><h3>Instrument</h3>${eye('inst', 'the instrument panel')}</div>`
        : `<div class="voice inst" data-panel="inst">
      ${eye('inst', 'the instrument panel')}
      <div class="group" role="group" aria-label="Instrument">
        ${part(
          'Instrument',
          `<span class="seg" role="radiogroup" aria-label="Instrument" data-tip="instrument">${INSTRUMENTS.map((c) => `<button role="radio" data-act="pick" data-p="instrument" data-id="${c.id}" aria-checked="${c.id === state.instrument}" aria-pressed="${c.id === state.instrument}">${c.label}</button>`).join('')}</span>`,
        )}
        ${isKit() ? '' : part('Scale', pick('scale', 'Scale', SCALES))}
      </div>
      ${
        state.instrument === '303'
          ? `<div class="group again" role="group" aria-label="TB-303">
        ${part(
          'Wave',
          `<span class="seg" role="radiogroup" aria-label="The 303's wave" data-tip="wave">
            <button role="radio" data-act="wave" data-id="0" aria-checked="${!state.acid.wave}" aria-pressed="${!state.acid.wave}">Saw</button>
            <button role="radio" data-act="wave" data-id="1" aria-checked="${!!state.acid.wave}" aria-pressed="${!!state.acid.wave}">Square</button>
          </span>`,
        )}
        ${part('Filter', cell('Cutoff', knob('cutoff', pct(state.acid.cutoff), 0, 100, 1, 'Cutoff')) + cell('Reso', knob('res', pct(state.acid.res), 0, 100, 1, 'Resonance')) + cell('Env mod', knob('env', pct(state.acid.env), 0, 100, 1, 'Envelope mod')) + cell('Decay', knob('decay', pct(state.acid.decay), 0, 100, 1, 'Decay')))}
        ${part('Feel', cell('Accent', knob('accent', pct(state.acid.accent), 0, 100, 1, 'Accent')) + cell('Slide', knob('slide', pct(state.acid.slide), 0, 100, 1, 'Slide')) + cell('Tune', knob('tune', state.acid.tune, -12, 12, 1, 'Tune')))}
      </div>`
          : ''
      }
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
    </div>`
    }
    </div>
    ${
      folded.tracks && !PHONE.matches
        ? `<div class="tracks shut" data-panel="tracks"${shutWidth('tracks')}><h3>Tracks</h3>${eye('tracks', 'the tracks')}</div>`
        : `<div class="tracks" data-panel="tracks" role="group" aria-label="Tracks" style="--shown: ${tint(focus, 1)}">
    ${eye('tracks', 'the tracks')}
    <h3>Tracks</h3>
    <div class="cols"><span class="wide"></span><span>Solo</span><span class="wide">Mute</span><span class="wide">Volume</span><span>Sum</span>${bySound ? '<span class="snd">Sound</span>' : ''}<span>Swings</span><span></span><span>Swing</span><span>Length</span><span>Phase</span>${state.physics ? '<span>Weight</span><span>Push</span>' : ''}<span></span></div>
    ${state.arms
      .map(
        (a, k) => `
    <div class="arm${k === focus ? ' shown' : ''}" data-k="${k}" style="--arm: ${tint(k, 1)}">
      <span class="grip wide" data-tip="grip" aria-label="Move arm ${k + 1}">⋮⋮</span>
      <button class="ms" data-act="solo" data-tip="solo" aria-pressed="${!!a.solo}" aria-label="Solo arm ${k + 1}">S</button>
      <button class="ms wide" data-act="quiet" data-tip="quiet" aria-pressed="${!!a.mute}" aria-label="Mute arm ${k + 1}">M</button>
      <span class="wide">${knob('vol', pct(a.vol), 0, 100, 1, `Volume of arm ${k + 1}`)}</span>
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
        ${flip('waves', 'Waves', adrift, 'W')}
        ${flip('tips', 'Tips', tipsOn, '?')}
        <hr />
        ${does('addpen', 'Add pendulum', 'P')}
        ${does('duppen', 'Duplicate pendulum')}
        ${state.pens!.length > 1 ? does('nextpen', 'Next pendulum', '⇧ P') + does('rmpen', 'Remove pendulum') : ''}
        <hr />
        ${does('save', 'Save', `${CMD} S`)}
        ${does('saveas', 'Save as', `⇧ ${CMD} S`)}
        ${does('open', 'Open', `${CMD} O`)}
        <hr />
        ${does('reset', 'Reset')}
      </span>
    </span>    <button data-act="full" data-tip="full" aria-label="${full ? 'Leave full screen' : 'Full screen'}">${full ? ICONS.unfull : ICONS.full}</button>
  `;
  showHot();
  {
    const a = state.arms[focus];
    lead.style.setProperty('--arm', tint(focus, 1));
    lead.innerHTML = a
      ? `<button class="step" data-act="prev" aria-label="The track before">${ICONS.caret}</button>
    <b class="no">${focus + 1}</b>
    <span class="its" data-k="${focus}"><button class="ms" data-act="quiet" data-tip="quiet" aria-pressed="${!!a.mute}" aria-label="Mute arm ${focus + 1}">M</button>${knob('vol', pct(a.vol), 0, 100, 1, `Volume of arm ${focus + 1}`)}</span>
    <button class="step" data-act="next" aria-label="The next track">${ICONS.caret}</button>`
      : '';
  }
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
  pen: ['Pendulum', 'Its number: which pendulum the panels under it set; S and M beside it, its solo and its mute. Each is a chain of its own, hung beside the others, on its own instrument, with its own scale, notes, mode and mix; only the tempo is all of theirs. Press anywhere in another chain\'s column (what is nearest its centre line) to set it.', ['1–8 ~that_one', '⇧ P ~the_next', 'Click ~its_column']],
  pensolo: ['Solo pendulum', 'Only this pendulum is heard, with any others that are soloed too. Its chain goes on swinging, and so do theirs.'],
  penmute: ['Mute pendulum', 'Silences this pendulum, whatever its tracks. It goes on swinging, faint.'],
  duppen: ['Duplicate pendulum', 'Hangs a copy of the pendulum being set beside the others, its arms and its instrument and all, in time with it: change one and they part.'],
  addpen: ['Add pendulum', 'Hangs a new chain beside the others, one arm swinging once a bar, on the next instrument. Up to eight.', 'P'],
  rmpen: ['Remove pendulum', 'Takes the pendulum being set away, and the one before it is set instead.'],
  quiet: ['Mute', 'Silences this track, whatever its volume. The arm still swings and still moves the ones under it.'],
  solo: ['Solo', 'Only this track is heard, with any others that are soloed too.'],
  grip: ['Move', 'Drag up or down to move this link along the chain. Its colour, its voice and its settings go with it.', 'Drag_↕'],
  add: ['Add track', 'Hangs a new arm on the end, one harmonic up, at half volume. The other key takes the last one away.', '+ / −'],
  mode: ['Sum / Each', 'What this joint crosses to sound. Lit, the sum: the centre line under the pivot, every arm above it added up. Not lit, each: the vertical under its own origin, its arm alone. The key switches all of them at once.', 'S'],
  restart: ['Restart', 'The motion from the top, the setup as it is. With physics on, the same setup plays the same again.', 'R'],
  play: ['Pause / Play', 'Stops the motion where it is, and lets it go on.', 'Space'],
  mute: ['Sound', 'All sound on or off.', 'M'],
  mass: ['Weight', 'How hard this link pulls on what it hangs from, with physics on. At the bottom it rides the arm above and is shaken by it, and the arm above never knows. At the top it weighs as much as the arm it hangs from, and throws it about. The thick arc round the joint is this knob.'],
  physics: ['Pendulum mode', 'Formula: every arm goes exactly as it is set. Physics: every arm is a real swing hung in the swing above, with its weight, kept going by the push. The chain is then on its own: it drifts out of time, and that is said in orange for as long as it is on. No key for it: it is not to be switched by a slip of the finger.'],
  push: ['Push', 'What keeps this swing going, with physics on: a push in time with its own rhythm, and the air against it. High and it keeps its time whatever the others do; from about the middle the bar comes round; lower and it drifts; 0 lets it go. The thin outer arc round the joint is this knob; the arrow at it is the push right now: none when the swing is on its own time.'],
  instrument: ['Instrument', 'What is struck. Tine: a kalimba\'s, a note that rings on. Bones: a drum, two bones knocked together, like a soft rimshot; the same for a link wherever it is: rhythm, no tune. TB-303: the bass machine, a saw or a square through a filter every hit opens, with its knobs under the instruments. TR-808: the drum machine, a sound an arm, or by hit a sound a note: their names down the line say which. The key goes to the next.', 'I'],
  sound: ['Sound', 'What this arm sounds, when sounds go by arm (Notes, in the instrument panel). On the drum machine and the bones: press for the next of the eight, shift for the one before. On the others it is the note where the arm rests on the ruler: pull its ring longer or shorter.', ['Click ~the_next', '⇧ Click ~the_one_before']],
  by: ['By hit / By arm', 'What says which note, or which drum, a hit is. By hit: where the joint is when it hits, so a joint far down the chain plays a different one each time. By arm: where its arm ends when the chain hangs straight, so every arm has one of its own.', 'B'],
  scale: ['Scale', 'The notes the joints play: where a joint is when it hits is its note, low at the root and high far out, always the nearest one of this scale. Pick it from the list; the key goes to the next. The key it is all in is where the root hangs: lower on the page is higher.', ['N', 'Drag_↕ ~on_the_root']],
  reverb: ['Reverb', 'How much of what you hear is the room: none at the bottom; higher, the notes themselves go down as the room comes up; at the top, only the room.'],
  room: ['Room', 'How big the room is. Small, the walls are close and hard: it rings like metal, a pipe, a tin. Big, a hall. Turn Reverb up to hear it: all the way up with a small room is metal alone.'],
  delay: ['Delay', 'An echo in time, a dotted eighth apart, bouncing left then right: off at the bottom; higher, more goes in and more comes round again.'],
  velocity: ['Velocity', 'How much a hit\'s speed counts in how loud it is. At the top a joint that crawls over the line is a whisper and one that whips over it a shout; at the bottom every hit is as loud as the next, and only the track\'s volume says how loud.'],
  harm: ['Harmonics', 'The overtone over every note: none at the bottom (plain, round), each link\'s own in the middle, twice that at the top (bright).'],
  tempo: ['Tempo', 'Beats a minute, four to the bar.'],
  fold: ['Hide / Show', 'Puts this panel away, down to its name, and brings it back. With both away the chain has the page.'],
  reset: ['Reset', 'A new piece from scratch: one arm swinging once a bar, and the instrument, the notes, the mix and the tempo as they start. What is saved by name is kept. No key for it.'],
  volume: ['Volume', 'How loud this pendulum is. Each has its own mix: this panel sets the one that is lit.'],
  damp: ['Damping', 'How much of the room\'s top is taken off as it comes back: open at the bottom, a room hung with blankets at the top.'],
  trem: ['Tremolo depth', 'How far the level of this pendulum dips and comes back: none at the bottom, and at the top all the way down to silence, so the notes chop. It shakes the room\'s tail and the echo too.'],
  tremRate: ['Tremolo rate', 'How often the dip comes round, as a note value of the tempo, written under the knob: once a bar (1/1) to thirty-two times (1/32), and 1/8T the triplet. It is locked to the bar: the level is at its fullest on the beat and dips between, and follows the tempo knob.'],
  slow: ['Speed', 'How fast this pendulum runs against the tempo, never faster (the knob stands next to Harm, and says its speed under it): ×1 is the bar as it is, ×½ takes two bars of the tempo to go round once, ×¼ four, ×⅛ eight. Its arms keep their swings to its own bar, so the whole pattern is that much slower, and so are its hits. The others go on at their own. Its picture jumps to the new place when this is set.'],
  wave: ['Wave', 'What the 303 starts from: a saw (bright, buzzy) or a square (hollow). The filter does the rest.'],
  cutoff: ['Cutoff', 'Where the 303\'s filter sits, 80 Hz to 6 kHz: low is dull and round, high is open. Every note opens it from here, by Env mod.'],
  res: ['Resonance', 'How much the filter rings at its cutoff: none at the bottom, a squeal at the top, the sound the machine is known for.'],
  env: ['Env mod', 'How far every note throws the filter open above its cutoff, before it falls back: at the bottom it stays where it is, at the top it snaps.'],
  decay: ['Decay', 'How long the filter takes to close again after a note, 50 ms to 2 s: short is a pluck, long a wow.'],
  accent: ['Accent', 'How much more a hard hit counts: louder, with the filter thrown further open and shut sooner. A hit that crosses the line fast is an accent.'],
  slide: ['Slide', 'How slowly a note glides to the next, when the next starts before it has let go: 10 ms to 400 ms. Mono, as the machine was: those notes are not struck again.'],
  tune: ['Tune', 'The whole 303 up or down, in semitones, up to an octave either way.'],
  dist: ['Distortion', 'Everything driven into a soft clipper, before the room and the echo: clean at the bottom, warm in the middle, a fuzz at the top, where every tail is as loud as its note.'],
  save: ['Save', 'Keeps this setup under the name it has, and asks for one the first time.', `${CMD} S`],
  saveas: ['Save as', 'Asks for a name and keeps this setup under it, offering the last name with the next number.', `⇧ ${CMD} S`],
  open: ['Open', 'Everything saved by name, the newest first. Arrows and enter, or a click, open one; the cross deletes it.', `${CMD} O`],
  timeline: ['Timeline', 'Each link\'s curve beside its row: what its joint crosses zero with, over the bar, a dot where it hits. Put away to start with.', 'T'],
  colour: ['Colour', 'A colour a link, down the chain: green, cyan, a bluish purple, pink. Or all of it black and white, as it is to start with.'],
  waves: ['Waves', 'Every hit stays: a dot where its joint crossed, as big as it was hard and as bright as its link was loud, drifting off to the side it crossed to, two bars to the edge of the page. And thinly, with them, the way each joint went. So the last two bars stand written to the left and to the right. Muted links write nothing. Off, only the ring where each hit fell and the tail behind each joint.', 'W'],
  full: ['Full screen', 'The page alone, filling the screen, and the big title gone. Where the browser cannot fill the screen, the title goes all the same.', 'F'],
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
 * With its panel: to the right of the column, beside the instrument's panel for its controls
 * and beside the tracks' for theirs. The bar's hang under the bar, and the menu's rows' stand to the
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
  st.width = '320px';
  // side by side (or on its own): over the panel, from its left
  const mates = [...panel.querySelectorAll<HTMLElement>('.voice, .tracks')];
  if (mates.some((m) => m !== tipHost && Math.abs(m.getBoundingClientRect().left - r.left) > 4) || mates.length < 2) {
    st.left = `${r.left}px`;
    st.bottom = `${window.innerHeight - r.top + gap}px`;
    return;
  }
  // a panel's, in a column: beside it, level with the top of the instrument's or the foot of the tracks'
  st.left = `${r.right + gap}px`;
  if (tipHost.classList.contains('voice')) st.top = `${r.top}px`;
  else st.bottom = `${window.innerHeight - r.bottom}px`;
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
    sound?.relock();
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
  // a pendulum's row: a press anywhere on it (not on its solo or its mute) sets that pendulum, not only on its number
  const row = (e.target as HTMLElement).closest<HTMLElement>('.strip[data-id]');
  if (row && !(e.target as HTMLElement).closest('button')) {
    setPop('');
    pick(Number(row.dataset.id));
    return;
  }
  // a panel put away: a press anywhere on its bar opens it (the eye does the same on its own)
  const shut = (e.target as HTMLElement).closest<HTMLElement>('.shut[data-panel]');
  if (shut && !(e.target as HTMLElement).closest('button')) {
    fold(shut.dataset.panel!);
    build();
    return;
  }
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  if (!b) return;
  const act = b.dataset.act!;
  if (act === 'timeline' || act === 'colour' || act === 'waves' || act === 'tips') {
    if (act === 'timeline') setTimeline(!timeline);
    else if (act === 'colour') setColour(!colour);
    else if (act === 'waves') setAdrift(!adrift);
    else setTips(!tipsOn);
    build();
    return;
  }
  if (act === 'pensolo' || act === 'penmute') {
    const p = penNow(Number(b.dataset.id));
    if (act === 'pensolo') p.solo = !p.solo;
    else p.mute = !p.mute;
    changed();
    build();
    return;
  }
  if (act === 'addpen' || act === 'duppen' || act === 'rmpen' || act === 'nextpen' || act === 'pen') {
    setPop('');
    if (act === 'addpen') addPen();
    else if (act === 'duppen') duplicatePen();
    else if (act === 'rmpen') removePen();
    else pick(act === 'pen' ? Number(b.dataset.id) : (state.at! + 1) % state.pens!.length);
    return;
  }
  if (act === 'fold') {
    fold(b.dataset.id!);
    build();
    return;
  }
  if (act === 'reset') {
    // a new piece from scratch: one arm, the rest as it starts; what is saved by name is kept
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
  const k = Number(b.closest<HTMLElement>('[data-k]')?.dataset.k);
  if (act === 'own') state.arms[k].mode = state.arms[k].mode === 'sum' ? 'each' : 'sum';
  else if (act === 'quiet') state.arms[k].mute = !state.arms[k].mute;
  else if (act === 'solo') state.arms[k].solo = !state.arms[k].solo;
  else if (act === 'sound') state.arms[k].sound = (state.arms[k].sound + ((e as MouseEvent).shiftKey ? KIT.length - 1 : 1)) % KIT.length;
  else if (act === 'rm') removeArm(k);
  else if (act === 'add') {
    addArm();
    focus = state.arms.length - 1;
  } else if (act === 'prev' || act === 'next') return setFocus(focus + (act === 'next' ? 1 : -1));
  else if (act === 'pick') {
    if (b.dataset.p === 'scale') state.scale = b.dataset.id!;
    else setInstrument(b.dataset.id!);
    openPop = '';
  }
  else if (act === 'by') state.by = b.dataset.id === 'arm' ? 'arm' : 'hit';
  else if (act === 'wave') state.acid.wave = b.dataset.id === '1' ? 1 : 0;
  else if (act === 'motion') state.physics = b.dataset.id === 'physics';
  else if (act === 'restart') restart();
  else if (act === 'full') return setFull(!full);
  else toggle(act as 'play' | 'mute');
  changed();
  build();
};
panel.addEventListener('click', onClick);
lead.addEventListener('click', onClick);
topBar.addEventListener('click', onClick);

// --- one track at a time: a swipe on the panel (anywhere but on a control) goes to another ---

let swipe: { x: number; y: number } | null = null;
panel.addEventListener('pointerdown', (e) => {
  const t = e.target as HTMLElement;
  if (!oneRow() || !t.closest?.('.tracks') || t.closest('.knob, button')) return;
  swipe = { x: e.clientX, y: e.clientY };
});
for (const ev of ['pointerup', 'pointercancel']) {
  window.addEventListener(ev, (e) => {
    if (!swipe) return;
    const dx = (e as PointerEvent).clientX - swipe.x;
    const dy = (e as PointerEvent).clientY - swipe.y;
    swipe = null;
    if (ev === 'pointercancel' || Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
    setFocus(focus + ((Math.abs(dy) > Math.abs(dx) ? dy : dx) < 0 ? 1 : -1));
  });
}

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
  gauge.querySelector('b')!.textContent = p === 'swing' || p === 'phase' ? `${v}°` : p === 'n' ? `×${v}` : p === 'tremRate' ? TREM_DIVS[v]?.label ?? String(v) : p === 'slow' ? SLOW_LABELS[v] ?? String(v) : String(v);
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
  } else if (p === 'slow') {
    // its bar is another length: where it is in it is another place, so it is scanned from here again
    const to = SLOWS[Math.round(v)] ?? 1;
    if (to !== state.slow) {
      state.slow = to;
      scanned = NaN;
      sim.live = false;
      flashes.length = 0;
      played = [];
    }
    // its speed is written under it
    const name = el.nextElementSibling;
    if (name) name.textContent = SLOW_LABELS[Math.round(v)] ?? '';
  } else if (p in state.acid) {
    // a 303 knob: 0..1 as a percent, the tune as its semitones
    (state.acid as unknown as Record<string, number>)[p] = p === 'tune' ? v : v / 100;
  } else if (p === 'tremRate') {
    state.tremRate = v;
    // its note value is written under it
    const name = el.nextElementSibling;
    if (name) name.textContent = TREM_DIVS[v].label;
  } else if (p === 'reverb' || p === 'room' || p === 'delay' || p === 'harm' || p === 'volume' || p === 'dist' || p === 'damp' || p === 'velocity' || p === 'trem') {
    state[p] = v / 100;
  } else {
    const a = state.arms[Number(el.closest<HTMLElement>('[data-k]')!.dataset.k)];
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

// --- a word under the title ---

let noted = '';
let notedUntil = 0;
/** a word under the title for a moment */
function note(text: string) {
  noted = text;
  notedUntil = clock() + 1.6;
}

/** a whole setup put in place of this one, the motion going on where the bar is */
function apply(s: State) {
  anchor();
  sound?.relock();
  Object.assign(state, withPens(s));
  // with weight, the chain starts again from the formula: the arms are not the same ones
  sim.live = false;
  runners = state.pens!.map((_, i) => (i === state.at ? null : runner()));
  flashes.length = 0;
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
  if (keep([{ name, at: Date.now(), state: packed() }, ...saves().filter((s) => s.name !== name)], name)) note(`Saved ${name}`);
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
    const many = Array.isArray(s.state?.pens) ? s.state.pens.length : 1;
    open.append(el('span', `${many > 1 ? `${many} pendulums` : `${n} ${n === 1 ? 'arm' : 'arms'}`} · ${new Date(s.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`));
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
  if (e.metaKey || e.ctrlKey) return;
  // by the key's place, not its character: shift and 2 is " or @ depending on the keyboard
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code)?.[1];
  if (digit) {
    e.preventDefault();
    // a digit is a pendulum: 1 to 8 (there were presets on the digits: saving by name took their place)
    const i = Number(digit) - 1;
    if (!e.shiftKey && !e.altKey && i >= 0 && i < state.pens!.length) {
      pick(i);
      note(`Pendulum ${i + 1}`);
    }
    return;
  }
  if (e.altKey) return;
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
  else if (e.key === 'w') setAdrift(!adrift);
  else if (e.key === 'd') setDebug(!bench);
  else if (e.key === 'f') setFull(!full);
  else if (e.key === 'p') return addPen();
  else if (e.key === 'P') return pick((state.at! + 1) % state.pens!.length);
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
  // as big as the canvas is on the page, whatever the browser's bars are doing
  w = canvas.clientWidth || window.innerWidth;
  h = canvas.clientHeight || window.innerHeight;
  if (canvas.width === Math.round(w * dpr) && canvas.height === Math.round(h * dpr)) return measure();
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  if (haze) {
    haze.width = Math.max(1, Math.round(w / HAZE_SCALE));
    haze.height = Math.max(1, Math.round(h / HAZE_SCALE));
  }

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
/** how far round a joint its weight and its push are drawn: the sweep of a knob */
const KNOB_ARC = Math.PI * 1.5;
/** the chain on the screen, as it was last drawn: the pivot, then every joint */
const seen: number[] = [];
/** the link the pointer is on, or -1; and the one a click holds lit */
let hot = -1;
// Waves: every hit stays, and drifts off to the side it crossed to, and the joints' ways with
// them; or only the ring where a hit fell and the tail behind a joint. On to start with, on the
// page; a picture (`?clean`) has to ask for them.
const WAVES_KEY = `${KEY}-waves`;
let adrift = query.has('waves') || (!query.has('clean') && read(WAVES_KEY) !== 'off');
function setAdrift(on: boolean) {
  adrift = on;
  write(WAVES_KEY, on ? 'on' : 'off');
}
/** a hit that stays: where its joint was (arm lengths from the root), and how loud its link was then */
interface Mark {
  k: number;
  phase: number;
  dir: number;
  vel: number;
  loud: number;
  x: number;
  y: number;
}
let marks: Mark[] = [];

// The waves' numbers, to be tried by hand: `?debug`, or D, puts a panel of sliders on them.
// What is set there is kept, and is what the waves go by from then on.
type Tune = 'speed' | 'life' | 'fade' | 'path' | 'dots' | 'rise';
/** key, name, from, to, step, and what it is to start with */
const TUNES: [Tune, string, number, number, number, number][] = [
  // how far a wave goes in a bar, in halves of the page: at 0.5 it is at the edge in two bars
  ['speed', 'Speed', 0, 2, 0.01, 0],
  // how many bars it lives
  ['life', 'Life', 0.25, WAVE_MAX, 0.25, 4],
  // how it fades over that: 1 evenly, more goes sooner
  ['fade', 'Fade', 0.2, 4, 0.05, 0.2],
  // how bright a joint's way is, against its hits
  ['path', 'Path', 0, 1, 0.01, 0.14],
  // how big a hit's dot is, against what it was
  ['dots', 'Dots', 0, 4, 0.05, 0],
  // how far it all goes up in a bar, in pixels (down, under zero)
  ['rise', 'Rise', -200, 200, 1, -43],
];
const TUNE_KEY = `${KEY}-tune`;
const tune = Object.fromEntries(TUNES.map(([key, , , , , start]) => [key, start])) as Record<Tune, number>;
{
  const kept = readJson(TUNE_KEY) as Record<string, unknown> | null;
  for (const [key, , lo, hi] of TUNES) if (typeof kept?.[key] === 'number') tune[key] = within(kept[key] as number, lo, hi);
}
let bench: HTMLElement | null = null;
function setDebug(on: boolean) {
  bench?.remove();
  bench = null;
  if (!on) return;
  const el = document.createElement('div');
  bench = el;
  el.className = 'debug ui';
  const fill = () => {
    el.innerHTML = `<h3>Waves</h3>${TUNES.map(([key, name, lo, hi, step]) => `<label><span>${name}</span><input type="range" data-k="${key}" min="${lo}" max="${hi}" step="${step}" value="${tune[key]}" /><output>${tune[key]}</output></label>`).join('')}<button type="button">Reset</button>`;
  };
  fill();
  el.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    tune[input.dataset.k as Tune] = Number(input.value);
    input.nextElementSibling!.textContent = input.value;
    write(TUNE_KEY, JSON.stringify(tune));
  });
  el.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('button')) return;
    for (const [key, , , , , start] of TUNES) tune[key] = start;
    write(TUNE_KEY, JSON.stringify(tune));
    fill();
  });
  document.body.append(el);
}
if (query.has('debug')) setDebug(true);

// The haze, off unless a link asks for it (`?haze`): behind the picture, a dull, blurred trail of
// every pendulum's joints, not only the one being set. Each frame every heard joint draws a thick
// soft line from where it was to where it is, in its colour (mostly grey), onto a small canvas (a
// quarter the size) that fades between frames; the page stretches that back up and blurs it. A
// pendulum left out of the mix leaves a quarter of it. Without the flag there is no canvas, and
// none of this runs.
const haze = query.has('haze') ? Object.assign(document.createElement('canvas'), { className: 'haze' }) : null;
if (haze) canvas.before(haze);
const hx = haze?.getContext('2d') ?? null;
/** how much smaller than the page it is */
const HAZE_SCALE = 4;
/** how fast what it holds fades, per second, as an exponent */
const HAZE_FADE = 1.5;
/** how much of its colour a trail keeps: the rest is grey, so it fills the background and does not glow */
const HAZE_COLOUR = 0.22;
/** how much a trail adds in a second, of full strength: by the second and not by the frame, or a fast screen fills it up (it was blinding at 60 frames a second) */
const HAZE_GAIN = 0.3;
/** how strong the canvas is, and how thick a trail is on the page */
const HAZE_STRENGTH = 0.6;
const HAZE_WIDTH = 80;
/** how far a joint can move in a frame and still be drawn as moving (more is a jump: a restart, another pendulum picked) */
const HAZE_JUMP = 220;
/** a link's colour for the haze: dulled toward grey */
const hazeTint = (hue: number, a: number) => {
  const [r, g, b] = (colour ? PALETTE[hue % PALETTE.length] : INK).split(',').map(Number);
  const grey = ((r + g + b) / 3) * 0.8;
  const dull = (c: number) => Math.round(grey + (c - grey) * HAZE_COLOUR);
  return `rgba(${dull(r)}, ${dull(g)}, ${dull(b)}, ${a})`;
};
let hazed = 0;
let hazing = false;
/** where every pendulum's joints were on the last frame (the pivot, then each joint), on the screen */
const hazePrev: number[][] = [];

/** where the page's millimetre paper was last put (CSS variables on the body) */
let gridAt = { x: NaN, y: NaN };

/** it is lit from its track in the panel, not from the chain */
let hotRow = false;
let held = -1;
/** the link that is lit: the one the pointer is on, else the one a click holds */
const litArm = () => (hot >= 0 ? hot : held >= 0 ? held : oneRow() ? focus : -1);
const trail = new Float32Array((TRAIL + 1) * 2 * MAX_ARMS);
/** and as waves, the bars behind it, the newest first */
const wake = new Float32Array((TRAIL * WAVE_MAX + 1) * 2 * MAX_ARMS);
let hinted = '';
let drawn = 0;
// A finger on the scene holds the picture still, at the bar it was at, while the music goes
// on (the joints still light up on their hits): what is being stretched or turned is easier to
// see standing. Let go of it and it catches up. Only a finger: a mouse has the scene to itself.
/** the bar the picture is held at, or null */
let still: number | null = null;
const fingers = new Set<number>();

/** a colour by a link's own hue, wherever its pendulum is */
const hueTint = (hue: number, a: number) => `rgba(${colour ? PALETTE[hue % PALETTE.length] : INK}, ${a})`;
/** how much of a bar behind a joint its tail is drawn, on a pendulum not being set, in how many samples and pieces */
const TAILS = 288;
const TAIL_PIECES = 8;
const tails = new Float32Array((TAILS + 1) * 2 * MAX_ARMS);

/** each joint's way over a bar for a pendulum that is not being set: on the formula, worked out again only when its arms are not the ones it was worked out for */
function orbitsOf(p: Pen, r: Runner): Float32Array[] {
  if (p.physics) return r.orbits;
  const key = p.arms.map((a) => `${a.n}|${a.swing}|${a.len}|${a.phase}`).join(',');
  if (key !== r.orbitKey) {
    r.orbitKey = key;
    r.orbits = p.arms.map(() => new Float32Array((ORBIT + 1) * 2));
    const tmp: number[] = [];
    for (let i = 0; i <= ORBIT; i++) {
      place(p.arms, p.arms.map((a) => angle(a, i / ORBIT)), tmp);
      for (let k = 0; k < p.arms.length; k++) {
        r.orbits[k][2 * i] = tmp[2 * k];
        r.orbits[k][2 * i + 1] = tmp[2 * k + 1];
      }
    }
  }
  return r.orbits;
}

/**
 * The waves of one pendulum, the one being set or any other. Everything on them drifts sideways
 * as it ages, half the page in two bars, and fades on the way (those numbers, and the rest, are
 * `tune`'s: the debug panel sets them). Each joint's way goes off both ways at once, thinly, as
 * bright as its link is loud; each hit goes off to the side it crossed to (tick to the right,
 * tock to the left), a dot as big as it was hard. In bars, not seconds: a held chain holds its
 * waves. `stride` is how many of the points of a way are skipped between those drawn: the
 * others are drawn coarser, there being so many of them. Returns the hits still alive.
 */
function drawWaves(p: Pen, run: Sim, orb: Float32Array[], list: Mark[], phi: number, X: (x: number) => number, Y: (y: number) => number, stride: number): Mark[] {
  const arms = p.arms;
  const n = arms.length;
  const weighted = p.physics;
  const drift = ((w / 2 + 40) / unit) * tune.speed;
  const rate = weighted ? TRAIL : ORBIT;
  const late = weighted ? 0 : phi * ORBIT - Math.floor(phi * ORBIT);
  // (a multiple of the stride, rounded down so that it stays in what is kept; every point drawn is one that was worked out)
  const per = Math.max(stride, Math.floor(Math.round((rate * tune.life) / PIECES) / stride) * stride);
  const head = Math.floor((phi - Math.floor(phi)) * ORBIT);
  if (weighted && tune.path > 0) for (let i = 0; i <= per * PIECES; i += stride) wake.set(poseOf(p, run, phi - i / TRAIL, then), i * 2 * MAX_ARMS);
  for (let k = 0; k < n && tune.path > 0; k++) {
    const loud = heard(k, arms);
    if (!(loud > 0) || (!weighted && !orb[k])) continue;
    const o = orb[k];
    for (let c = 0; c < PIECES; c++) {
      ctx.strokeStyle = hueTint(arms[k].hue, tune.path * loud * Math.pow(1 - (c + 0.5) / PIECES, tune.fade));
      ctx.beginPath();
      for (const to of [-1, 1]) {
        for (let m = 0; m <= per; m += stride) {
          const j = c * per + m;
          const i = weighted ? (j * MAX_ARMS + k) * 2 : ((((head - j) % ORBIT) + ORBIT) % ORBIT) * 2;
          const age = (j + late) / rate;
          const sx = X((weighted ? wake[i] : o[i]) + to * drift * age);
          const sy = Y(weighted ? wake[i + 1] : o[i + 1]) - tune.rise * age;
          if (m) ctx.lineTo(sx, sy);
          else ctx.moveTo(sx, sy);
        }
      }
      ctx.stroke();
    }
  }
  // (a restart, or a bar gone back to: what has not happened yet is not written)
  list = list.filter((m) => m.phase <= phi && phi - m.phase < WAVE_MAX && m.k < n);
  for (const m of list) {
    const age = phi - m.phase;
    if (age >= tune.life) continue;
    ctx.fillStyle = hueTint(arms[m.k].hue, Math.min(1, m.loud * (0.4 + 0.6 * m.vel)) * Math.pow(1 - age / tune.life, tune.fade));
    ctx.beginPath();
    ctx.arc(X(m.x + m.dir * drift * age), Y(m.y) - tune.rise * age, (1.5 + 3.5 * m.vel) * tune.dots, 0, TAU);
    ctx.fill();
  }
  return list;
}
const other: number[] = [];
const otherThen: number[] = [];
/**
 * A pendulum that is not the one being set, hung at px: its centre line, its chain, a tail
 * behind each joint and a ring on each hit, all of it fainter than the one being set. No
 * waves, no knobs: pick it (its root, or a joint) and it has them.
 */
function drawPen(p: Pen, pi: number, r: Runner, px: number, y0: number, t: number, phi: number, on: boolean) {
  const arms = p.arms;
  const n = arms.length;
  const py = y0 + p.root * unit;
  const X = (x: number) => px + x * unit;
  const Y = (y: number) => py + y * unit;
  let total = 0;
  for (const a of arms) total += a.len;
  // pointed at, its column is lit, a very faint band: a press anywhere in it sets this pendulum
  if (penHot === r && colGap > 0 && !bare) {
    ctx.fillStyle = ink(0.03);
    ctx.fillRect(px - colGap / 2, 0, colGap, h);
  }
  ctx.save();
  ctx.globalAlpha = on ? 0.6 : 0.22;
  if (!bare) {
    line(px, 0, px, h, 0.07);
    if (arms.some((a) => a.mode === 'sum')) line(px, py, px, Y(total) + 14, 0.16);
  }
  // its waves, as the one being set has (through the same dimming): coarser
  if (adrift) r.marks = drawWaves(p, r.sim, orbitsOf(p, r), r.marks, phi, X, Y, 3);
  else if (r.marks.length) r.marks = [];
  // the tails: a bar behind each joint, fading
  for (let i = 0; i <= TAILS; i++) tails.set(poseOf(p, r.sim, phi - (i * TAIL) / TAILS, otherThen), i * 2 * MAX_ARMS);
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  const per = TAILS / TAIL_PIECES;
  for (let k = 0; k < n; k++) {
    for (let c = 0; c < TAIL_PIECES; c++) {
      ctx.strokeStyle = hueTint(arms[k].hue, (k === n - 1 ? 0.5 : 0.28) * Math.pow(1 - (c + 0.5) / TAIL_PIECES, 1.7));
      ctx.beginPath();
      for (let m = 0; m <= per; m++) {
        const i = (c * per + m) * MAX_ARMS + k;
        ctx.lineTo(X(tails[i * 2]), Y(tails[i * 2 + 1]));
      }
      ctx.stroke();
    }
  }
  // the hits: a ring where the joint crossed
  const lit = new Array<number>(n).fill(0);
  for (let i = r.flashes.length - 1; i >= 0; i--) {
    const f = r.flashes[i];
    const age = t - f.t;
    if (age < 0) continue;
    if (age > 0.4 || f.k >= n) {
      r.flashes.splice(i, 1);
      continue;
    }
    lit[f.k] = Math.max(lit[f.k], 1 - age / 0.14);
    poseOf(p, r.sim, f.phase, otherThen);
    // it stays, as a mark, for the waves: as loud as its link is now
    if (!f.marked) {
      f.marked = true;
      const loud = heard(f.k, arms) * f.kept;
      if (adrift && loud > 0) r.marks.push({ k: f.k, phase: f.phase, dir: f.dir, vel: f.vel, loud, x: otherThen[2 * f.k], y: otherThen[2 * f.k + 1] });
    }
    if (bare || still !== null) continue;
    ctx.strokeStyle = hueTint(arms[f.k].hue, (1 - age / 0.4) ** 2 * (0.25 + 0.75 * f.vel) * (0.15 + 0.85 * heard(f.k, arms)) * f.kept);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(X(otherThen[2 * f.k]), Y(otherThen[2 * f.k + 1]), 5 + age * (40 + 80 * f.vel), 0, TAU);
    ctx.stroke();
  }
  // the chain, and where it is for the pointer
  poseOf(p, r.sim, phi, other);
  r.seen.length = 0;
  r.seen.push(px, py);
  for (let k = 0; k < n; k++) r.seen.push(X(other[2 * k]), Y(other[2 * k + 1]));
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.5;
  for (let k = 0; k < n; k++) {
    ctx.strokeStyle = hueTint(arms[k].hue, 0.9);
    ctx.beginPath();
    ctx.moveTo(r.seen[2 * k], r.seen[2 * k + 1]);
    ctx.lineTo(r.seen[2 * k + 2], r.seen[2 * k + 3]);
    ctx.stroke();
  }
  ctx.fillStyle = BACK;
  ctx.strokeStyle = hueTint(pi, penHot === r ? 1 : 0.7);
  ctx.beginPath();
  ctx.arc(px, py, penHot === r ? 6 : 4.5, 0, TAU);
  ctx.fill();
  ctx.stroke();
  for (let k = 0; k < n; k++) {
    const hit = lit[k];
    ctx.beginPath();
    ctx.arc(r.seen[2 * k + 2], r.seen[2 * k + 3], 4 * (1 + 0.5 * hit), 0, TAU);
    ctx.fillStyle = hueTint(arms[k].hue, 1);
    ctx.fill();
    if (hit > 0) {
      ctx.fillStyle = ink(0.85 * hit);
      ctx.fill();
    }
  }
  ctx.restore();
}
/** the pendulum not being set that the pointer is on (its column, or one of its joints), to be picked */
let penHot: Runner | null = null;
/** where each pendulum's centre line is on the screen, and how wide a column is: a pendulum's column is what is nearer its centre line than any other's */
let penXs: number[] = [];
let colGap = 0;
/** whose column x is in: the pendulum whose centre line is nearest (the one being set, where there is only one) */
function columnAt(x: number): number {
  let best = state.at!;
  let near = Infinity;
  penXs.forEach((px, i) => {
    const d = Math.abs(x - px);
    if (d < near) {
      near = d;
      best = i;
    }
  });
  return best;
}
function penAt(x: number, y: number, finger: boolean): number {
  let best = -1;
  let near = finger ? 26 : 14;
  runners.forEach((r, i) => {
    if (!r) return;
    for (let j = 0; j + 1 < r.seen.length; j += 2) {
      const d = Math.hypot(x - r.seen[j], y - r.seen[j + 1]);
      if (d < near) {
        near = d;
        best = i;
      }
    }
  });
  return best;
}

function frame() {
  const t = clock();
  if (still !== null && !fingers.size) {
    still = null;
  }
  // the picture is held at a bar of the tempo, and each pendulum is at a bar of its own: that over its slowness
  const phiTempo = still ?? phaseAt(t);
  const phi = phiTempo / state.slow;
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
  // The chain hangs in the middle of the screen, the rows under it in the middle too. With more
  // than one pendulum they hang side by side about the middle, each in its own place, a little
  // closer than they reach: they swing through each other.
  const pens = state.pens!;
  const count = pens.length;
  // (one alone hangs in the middle, behind the panels where it reaches them; several, in what the panels leave)
  const left = count > 1 && panelRight > 0 && w - panelRight > 2 * 150 ? panelRight + 24 : edge;
  // (in steps of 16 px, twice the grid's, so that every pendulum's centre line stands on one of its lines)
  const gap = count > 1 ? Math.max(16, Math.floor(Math.min((w - edge - left) / count, Math.max(150, unit * 0.95)) / 16) * 16) : 0;
  const middle = count > 1 ? (left + w - edge) / 2 : w / 2;
  const pxOf = (i: number) => middle + (i - (count - 1) / 2) * gap;
  const px = pxOf(state.at!);
  penXs = pens.map((_, i) => pxOf(i));
  colGap = gap;
  // (one hung under the bar hangs from under it)
  let y0 = Math.max(sceneTop, topClear + 18);
  for (let i = 0; i < count; i++) if (pxOf(i) > barBox.left - 16 && pxOf(i) < barBox.right + 16) y0 = Math.max(y0, barBox.bottom + 18);
  // the millimetre paper behind it all starts at the middle of the pendulums and the top of the ruler, so the chains hang on its lines
  const gridX = Math.round(middle);
  const gridY = Math.round(y0);
  if (gridX !== gridAt.x || gridY !== gridAt.y) {
    gridAt = { x: gridX, y: gridY };
    document.body.style.setProperty('--grid-x', `${gridX}px`);
    document.body.style.setProperty('--grid-y', `${gridY}px`);
  }
  // and the ruler holds the longest of them
  let deepest = state.root + total;
  pens.forEach((p, i) => {
    if (i !== state.at) deepest = Math.max(deepest, p.root + p.arms.reduce((sum, a) => sum + a.len, 0));
  });
  // The ruler of notes stands still, from under the title to over the workbench, and the root
  // hangs where it is put on it. An arm length is always the same stretch of it, so where a
  // joint is says its note; only a chain too long for the ruler makes it all smaller.
  // The scene is the page's, not what the panels leave of it: from the top to the foot, the
  // chain swinging behind the panels where it reaches them. (Only the curves beside the rows,
  // when they are drawn, keep it over them.)

  const floor = clean ? h - 30 : curves ? rowBoxes[0].y - rowBoxes[0].h / 2 - 24 : panelTop > 0 ? panelTop + PANEL_BLEED + 28 : sheetTop > 0 ? sheetTop - 16 : h - 12;
  const y1 = Math.max(y0 + 120, floor - (timeline && !curves ? 80 : 28));
  const target = (y1 - y0) / Math.max(RULER, deepest + 0.05);
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

  // The ruler's notes, as lines across the page behind everything: one, very faint, at each note
  // of the scale of the pendulum being set, and a little more at the key's own note (the A) of
  // every octave. A joint's height is its note, so these are the lines it hits. Not by arm on the
  // drums, where a height is nothing; nor in a picture.
  if (!bare && !clean && !(isKit() && state.by === 'arm')) {
    const notes = scaleNotes();
    ctx.lineWidth = 1;
    for (let m = 0; m <= SPAN; m++) {
      if (!notes.includes(m % 12)) continue;
      const y = Math.round(y0 + (m / SPAN) * RULER * unit) + 0.5;
      ctx.strokeStyle = ink(m % 12 === 0 ? 0.1 : 0.05);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  // the others first, behind the one being set
  for (let i = 0; i < count; i++) if (runners[i]) drawPen(pens[i], i, runners[i]!, pxOf(i), y0, t, phiTempo / pens[i].slow, penHeard(i));

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

  // Every joint's path, the last one's a little brighter: a tail, a bar
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
  // with a link lit (the pointer in its ring, or held by a click), its path as bright as the last one's
  const only = litArm();
  for (let k = 0; k < n; k++) {
    const o = orbits[k];
    const bright = k === n - 1 || k === only ? 0.5 : 0.28;
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

  // The waves, of the one being set, in full (the others have theirs, coarser, in drawPen).
  if (adrift) marks = drawWaves(state, sim, orbits, marks, phi, X, Y, 1);
  else if (marks.length) marks = [];

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
    // it stays, as a mark, for the waves: as loud as its link is now
    if (!f.marked) {
      f.marked = true;
      const loud = heard(f.k) * f.kept;
      if (adrift && loud > 0) marks.push({ k: f.k, phase: f.phase, dir: f.dir, vel: f.vel, loud, x: then[2 * f.k], y: then[2 * f.k + 1] });
    }
    if (bare || still !== null) continue;
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
  // straight. The rings stand still: a link can be picked while it moves.
  const lit1 = only;
  if (lit1 >= 0 && lit1 < n) {
    let inner = 0;
    for (let k = 0; k < lit1; k++) inner += arms[k].len * unit;
    const outer = inner + arms[lit1].len * unit;
    // only the two circles, nothing filled: lighter when it is pointed at from its track, where
    // its knobs are right there under the pointer
    const fromTrack = hot >= 0 ? hotRow : moving >= 0;
    ctx.strokeStyle = tint(lit1, fromTrack ? 0.18 : 0.4);
    ctx.lineWidth = 1;
    for (const r of [inner, outer]) {
      if (r < 1) continue;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.stroke();
    }
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
  ctx.strokeStyle = hueTint(state.at!, onRoot || rooting ? 1 : 0.8);
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
    const jx = X(now[2 * k]);
    const jy = Y(now[2 * k + 1]);
    const size = state.physics ? 2.5 + 4.5 * Math.sqrt(arms[k].mass) : 5;
    ctx.beginPath();
    ctx.arc(jx, jy, size * (1 + 0.5 * hit), 0, TAU);
    ctx.fillStyle = tint(k, 1);
    ctx.fill();
    if (hit > 0) {
      ctx.fillStyle = ink(0.85 * hit);
      ctx.fill();
    }
    // With physics on, its two knobs round the joint, each the knob's own way (three quarters of
    // a turn, open at the bottom): fainter all the way, clearer as far as it is set. Lightly, and
    // in full on the lit link (pointed at on the chain or on its track, where the knobs are). The
    // weight close in and thick, the push outside it and thin.
    if (state.physics) {
      const full = k === only ? 1 : 0.45;
      const from = -Math.PI / 2 - KNOB_ARC / 2;
      for (const [r, width, to] of [[13, 3, arms[k].mass], [19, 1.5, arms[k].push]]) {
        ctx.lineWidth = width;
        for (const [end, a] of [[1, 0.18 * full], [to, 0.95 * full]]) {
          if (!(end > 0)) continue;
          ctx.strokeStyle = tint(k, a);
          ctx.beginPath();
          ctx.arc(jx, jy, r, from, from + KNOB_ARC * end);
          ctx.stroke();
        }
      }
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

  // the haze, when it is asked for (and the waves are on)
  if (haze && hx) {
    if (adrift) {
      hazing = true;
      haze.style.opacity = String(HAZE_STRENGTH);
      const dt = Math.min(0.05, Math.max(0, t - hazed));
      hx.globalCompositeOperation = 'destination-out';
      hx.fillStyle = `rgba(0, 0, 0, ${1 - Math.exp(-dt * HAZE_FADE)})`;
      hx.fillRect(0, 0, haze.width, haze.height);
      hx.globalCompositeOperation = 'source-over';
      hx.lineCap = 'round';
      hx.lineWidth = HAZE_WIDTH / HAZE_SCALE;
      for (let i = 0; i < count; i++) {
        const p = penNow(i);
        const pos = i === state.at ? seen : runners[i]?.seen;
        if (!pos || pos.length < 4) continue;
        const prev = (hazePrev[i] ??= []);
        const on = penHeard(i) ? 1 : 0.25;
        if (prev.length === pos.length) {
          for (let k = 0; k < p.arms.length; k++) {
            const loud = heard(k, p.arms) * on;
            const x0 = prev[2 * k + 2];
            const y0 = prev[2 * k + 3];
            const x1 = pos[2 * k + 2];
            const y1 = pos[2 * k + 3];
            if (!(loud > 0) || Math.hypot(x1 - x0, y1 - y0) > HAZE_JUMP) continue;
            hx.strokeStyle = hazeTint(p.arms[k].hue, HAZE_GAIN * loud * dt);
            hx.beginPath();
            hx.moveTo(x0 / HAZE_SCALE, y0 / HAZE_SCALE);
            hx.lineTo(x1 / HAZE_SCALE, y1 / HAZE_SCALE);
            hx.stroke();
          }
        }
        prev.length = pos.length;
        for (let j = 0; j < pos.length; j++) prev[j] = pos[j];
      }
    } else if (hazing) {
      hazing = false;
      hx.clearRect(0, 0, haze.width, haze.height);
      haze.style.opacity = '0';
    }
    hazed = t;
  }
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
/** it was a finger that pressed it */
let tapping = false;

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
  // in another pendulum's column, or on one of its joints: it is lit, to be picked
  const col = e.target === canvas ? columnAt(e.clientX) : state.at!;
  const pen = e.target === canvas ? (col !== state.at ? col : penAt(e.clientX, e.clientY, false)) : -1;
  penHot = pen >= 0 ? runners[pen] : null;
  if (pen >= 0) {
    heat(-1);
    onRoot = false;
    canvas.style.cursor = 'pointer';
    return;
  }
  onRoot = e.target === canvas && seen.length > 1 && fromRoot(e) <= 12;
  heat(row ? Number(row.dataset.k) : e.target === canvas && !onRoot ? armAt(e.clientX, e.clientY) : -1, !!row);
  if (onRoot) canvas.style.cursor = 'ns-resize';
});
// A press on the root takes hold of it. A press in a ring holds that link lit (until a press
// lands in none), and dragged from there pulls its arm longer or shorter.
window.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas || seen.length < 2) return;
  const finger = e.pointerType !== 'mouse';
  if (finger) {
    fingers.add(e.pointerId);
    still ??= phaseAt(clock());
  }
  // Another pendulum, pressed anywhere in its column (what is nearer its centre line than any other's), or on one of its joints where they reach over into this one's: it is the one being set. Nothing to grab in the column of the one being set is let go.
  const col = columnAt(e.clientX);
  const pen = col !== state.at ? col : penAt(e.clientX, e.clientY, finger);
  if (pen >= 0 && (col !== state.at || fromRoot(e) > (finger ? 22 : 12))) {
    penHot = null;
    pick(pen);
    return;
  }
  if (fromRoot(e) <= (finger ? 22 : 12)) {
    rooting = true;
    held = -1;
  } else {
    held = armAt(e.clientX, e.clientY, finger ? 18 : 10);
    tapping = finger;
    if (held >= 0) pull = { k: held, x: e.clientX, y: e.clientY, len: state.arms[held].len, swing: state.arms[held].swing, vol: state.arms[held].vol, way: '' };
  }
  canvas.setPointerCapture?.(e.pointerId);
  showHot();
});
for (const ev of ['pointerup', 'pointercancel']) {
  window.addEventListener(ev, (e) => {
    fingers.delete((e as PointerEvent).pointerId);
    if (!rooting && !pull) return;
    // a finger's tap on a link, or its stretch: its track is the one shown (where one is at a time)
    if (pull && tapping) setFocus(pull.k);
    tapping = false;
    rooting = false;
    pull = null;
    // the rows say each arm's note when sounds go by arm: it may have moved (a press alone moves nothing)
    if (moved) build();
    moved = false;
  });
}
document.addEventListener('pointerleave', () => heat(-1));
// a finger held on the scene is a hold, not a menu (Android's long press)
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('resize', resize);
// (and whenever its box changes without a resize: a phone's bar coming and going, the first layout)
new ResizeObserver(() => resize()).observe(canvas);
changed();
build();
resize();
requestAnimationFrame(frame);
