import { INSTRUMENTS, KIT, RULER, SCALES, SPAN, Sound, noteAt, stepOf } from './audio';
import { PUSH_CURVE, Sim } from './physics';
import { angle, crossings, place, signal, type Arm, type Hit, type Mode } from './rhythm';

// ?clean: no page furniture, the scene alone (screengrabs, clips)
const query = new URLSearchParams(location.search);
const clean = query.has('clean');
if (clean) document.body.classList.add('clean');

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const ctx = canvas.getContext('2d')!;
const panel = document.querySelector<HTMLElement>('#panel')!;
const drawer = document.querySelector<HTMLElement>('#drawer')!;
const drawerToggle = document.querySelector<HTMLButtonElement>('#drawerToggle')!;
const hint = document.querySelector<HTMLElement>('#hint')!;
const tip = document.querySelector<HTMLElement>('#tip')!;
const tipsButton = document.querySelector<HTMLButtonElement>('#tips')!;

const INK = '244, 244, 242';
const BACK = '#0b0b0d';
/** a colour a link, down the chain: magenta, pink, neon green, then the same three again, deeper, paler, yellower */
const PALETTE = ['255, 43, 209', '255, 158, 196', '57, 255, 20', '214, 0, 170', '255, 200, 228', '182, 255, 58', '255, 79, 154', '45, 255, 160'];
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
/** the pieces a path is drawn in, each fainter than the one before: both counts above divide by it */
const PIECES = 36;
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
  /** 2 since the push knob has its lock point in the middle: older setups have theirs moved to where it does the same */
  v?: number;
}

const KEY = 'codevember-2026-18';
const rad = (deg: number) => (deg * Math.PI) / 180;
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
  v: 2,
});

const unit01 = (v: number, or: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : or);

/**
 * A joint's weight where none was given: half the one above. And for a setup from when one
 * knob set them all (`weight`, each joint that many times the one above), what it gave.
 */
const massFor = (mass: number | undefined, k: number, weight = 0) => (Number.isFinite(mass) ? Math.min(1, Math.max(0, mass!)) : Math.pow(weight > 0 ? Math.min(1, weight) : 0.5, k));

/** a push set on the old knob (4·p², the lock point at 30), as the place on the new one that pushes as hard */
const pushFrom = (old: number) => Math.pow(old, 2 / PUSH_CURVE);

/** the root's place on the ruler, kept on it */
const rootIn = (v: number | undefined) => (Number.isFinite(v) ? Math.min(RULER - 0.2, Math.max(0, v!)) : 0.4);

/** the kit sound a link starts with, by its colour: bass drum, snare, closed hat, clap, open hat, tom, rim, cowbell */
const FIRST_SOUND = [0, 2, 3, 4, 6, 5, 1, 7];
const soundIn = (v: number | undefined, hue: number) => (Number.isInteger(v) && v! >= 0 && v! < KIT.length ? v! : FIRST_SOUND[hue % FIRST_SOUND.length]);

/** a setup read back from storage, made safe; null if it is not one */
function sane(given: State | null | undefined): State | null {
  // `weight`, and one `mode` and one `push` for all: how setups were kept before each arm had its own
  const s = given as (State & { weight?: number; mode?: Mode; push?: number }) | null | undefined;
  if (!s || !Array.isArray(s.arms) || !s.arms.length || !s.arms.every((a) => a && [a.n, a.swing, a.len, a.phase].every(Number.isFinite))) return null;
  // every arm its own colour: as kept if they are all different, else down the chain
  const kept = s.arms.slice(0, MAX_ARMS).map((a) => a.hue);
  const hues = kept.every((h, k) => Number.isInteger(h) && h >= 0 && h < PALETTE.length && kept.indexOf(h) === k) ? kept : kept.map((_, k) => k);
  return {
    arms: s.arms.slice(0, MAX_ARMS).map((a, k) => ({ n: Math.min(MAX_N, Math.max(1, Math.round(a.n))), swing: a.swing, len: a.len, phase: a.phase, vol: unit01(a.vol, 1), mass: massFor(a.mass, k, s.weight), mode: (a.mode ?? s.mode) === 'each' ? 'each' : 'sum', push: s.v === 2 ? unit01(a.push, 0.5) : pushFrom(unit01(a.push ?? s.push ?? 0.3, 0.3)), hue: hues[k], sound: soundIn(a.sound, hues[k]) })),
    bpm: s.bpm >= 40 && s.bpm <= 220 ? s.bpm : 120,
    physics: typeof s.physics === 'boolean' ? s.physics : s.weight! > 0,
    scale: SCALES.some((c) => c.id === s.scale) ? s.scale : 'tension',
    instrument: INSTRUMENTS.some((c) => c.id === s.instrument) ? s.instrument : 'tine',
    by: s.by === 'arm' ? 'arm' : 'hit',
    root: rootIn(s.root),
    reverb: unit01(s.reverb, 0.25),
    room: unit01(s.room, 0.7),
    delay: unit01(s.delay, 0.2),
    harm: unit01(s.harm, 0.5),
    v: 2,
  };
}

/**
 * ?arms=1-34-1,2-52-0.62-90-50-30-1-40 (swings, swing in degrees, length, then if any the phase
 * in degrees, the volume and the weight in percent, 1 for each or 0 for sum, and the push in
 * percent), &bpm=, &physics=1, &scale=kumoi, &instrument=bones, &by=arm, &root=0.4, &reverb= &room= &delay= &harmonics= (0 to 1), and for every arm that does not say: &mode=each, &push=0.5. A
 * pattern in a link, for clips too. &weight=0.3 is the old way to say physics, each joint that
 * many times the one above.
 */
function fromQuery(): State | null {
  const q = query.get('arms');
  if (!q) return null;
  const weight = Number(query.get('weight')) || 0;
  const fx = (name: string, or: number) => (query.has(name) ? unit01(Number(query.get(name)), or) : or);
  const all = query.get('mode') === 'each' ? 1 : 0;
  const pushAll = query.has('push') ? Number(query.get('push')) * 100 : 50;
  const arms = q
    .split(',')
    .map((a) => a.split('-').map(Number))
    .filter((a) => a.length >= 3 && a.every(Number.isFinite))
    .map(([n, deg, len, phase = 0, vol = 100, mass, each = all, push = pushAll], k): Arm => ({ n: Math.min(MAX_N, Math.max(1, Math.round(n))), swing: (Math.min(180, Math.max(0, deg)) * Math.PI) / 180, len: Math.min(1.5, Math.max(0.1, len)), phase: (((phase % 360) + 360) % 360) * (Math.PI / 180), vol: unit01(vol / 100, 1), mass: massFor(mass === undefined ? undefined : mass / 100, k, weight), mode: each ? 'each' : 'sum', push: unit01(push / 100, 0.5), hue: k, sound: FIRST_SOUND[k % FIRST_SOUND.length] }));
  if (!arms.length) return null;
  const bpm = Number(query.get('bpm'));
  return { arms: arms.slice(0, MAX_ARMS), bpm: bpm >= 40 && bpm <= 220 ? bpm : 120, physics: query.has('physics') ? query.get('physics') !== '0' : weight > 0, scale: SCALES.find((c) => c.id === query.get('scale'))?.id ?? 'tension', instrument: INSTRUMENTS.find((c) => c.id === query.get('instrument'))?.id ?? 'tine', by: query.get('by') === 'arm' ? 'arm' : 'hit', root: rootIn(query.has('root') ? Number(query.get('root')) : undefined), reverb: fx('reverb', 0.25), room: fx('room', 0.7), delay: fx('delay', 0.2), harm: fx('harmonics', 0.5), v: 2 };
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
/** what each joint crosses zero with, over the bar, and the furthest it gets from zero */
let waves: Float32Array[] = [];
let waveTop: number[] = [];

/** a pattern opened from a link is a visit: it never writes over the one remembered (presets and names still keep it) */
const linked = query.has('arms');

function changed() {
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
  sound?.set(state);
  if (linked) return;
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
      sound.set(state);
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
const scaleNotes = () => (SCALES.find((c) => c.id === state.scale) ?? SCALES[0]).notes;
/** how far down the chain arm k ends when it all hangs straight: its own place on the ruler */
function rest(k: number): number {
  let y = 0;
  for (let j = 0; j <= k && j < state.arms.length; j++) y += state.arms[j].len;
  return y;
}
/** the instruments that are a set of sounds, not one sound at many pitches */
const isKit = () => state.instrument === '808' || state.instrument === 'bones';
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** what arm k sounds when sounds go by arm: its drum, its pair of bones, or the note where it rests */
function soundName(k: number): string {
  const a = state.arms[k];
  if (state.instrument === '808') return KIT[a.sound % KIT.length];
  if (state.instrument === 'bones') return `B${(a.sound % KIT.length) + 1}`;
  const midi = noteAt(scaleNotes(), (state.root + rest(k)) / RULER);
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
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
    scanned = Math.max(end, sim.phi);
  } else {
    sim.live = false;
    crossings(state.arms, scanned, end, hits);
    scanned = end;
  }
  for (const h of hits) {
    played.push(h);
    const at = t0 + (h.phase - phi0) * barSeconds();
    flashes.push({ ...h, t: at });
    // its own voice, wherever it is in the chain, on the note where it is
    const midi = noteAt(scaleNotes(), (state.root + depthOf(h)) / RULER);
    // a kit's sound: the arm's own when sounds go by arm, else the one at the note it hit
    const step = state.by === 'arm' && isKit() ? (state.arms[h.k]?.sound ?? 0) : stepOf(scaleNotes(), midi);
    sound?.hit(state.arms[h.k]?.hue ?? h.k, h.dir, h.vel, at, state.arms[h.k]?.vol, midi, step);
  }
  scanned = end;
}
window.setInterval(schedule, 25);

// --- the workbench ---

let panelRect = { left: 0, top: 0 };
/** where each link's row is, and where the rows end: its curve is drawn beside it */
let rowBoxes: { y: number; h: number }[] = [];
let rowsRight = 0;

// --- the timeline (each link's curve beside its row; one line under the chain where there is no room for those): put away to start with, there when asked for ---

const TIMELINE_KEY = 'codevember-2026-18-timeline';
let timeline = query.has('timeline');
try {
  if (!timeline) timeline = localStorage.getItem(TIMELINE_KEY) === 'on';
} catch {
  // no storage: put away
}
function setTimeline(on: boolean) {
  timeline = on;
  try {
    localStorage.setItem(TIMELINE_KEY, on ? 'on' : 'off');
  } catch {
    // nothing kept
  }
}

// --- colour: a colour a link, or all of it in the one ink (to start with) ---

const COLOUR_KEY = 'codevember-2026-18-colour';
let colour = query.has('colour');
try {
  if (!colour) colour = localStorage.getItem(COLOUR_KEY) === 'on';
} catch {
  // no storage: the ink
}
function setColour(on: boolean) {
  colour = on;
  try {
    localStorage.setItem(COLOUR_KEY, on ? 'on' : 'off');
  } catch {
    // nothing kept
  }
}

// --- the drawer: open to start with where there is room, shut on a phone; remembered ---

const DRAWER_KEY = 'codevember-2026-18-drawer';
let drawerOpen = window.innerWidth > 760;
try {
  const kept = localStorage.getItem(DRAWER_KEY);
  if (kept) drawerOpen = kept === 'open';
} catch {
  // no storage: as the screen says
}
/** where the drawer begins: the scene and the curves stop short of it. Infinity while it is shut. */
let drawerLeft = Infinity;

/** `keep`: it was asked for by hand, so it is remembered (how the page happens to open is not) */
function setDrawer(open: boolean, keep = false) {
  drawerOpen = open;
  drawer.hidden = !open;
  drawerToggle.setAttribute('aria-pressed', String(open));
  if (keep) {
    try {
      localStorage.setItem(DRAWER_KEY, open ? 'open' : 'shut');
    } catch {
      // nothing kept
    }
  }
  measure();
}
drawerToggle.addEventListener('click', () => setDrawer(!drawerOpen, true));

function measure() {
  const r = panel.getBoundingClientRect();
  panelRect = { left: r.left, top: r.top };
  drawerLeft = drawerOpen && !clean ? drawer.getBoundingClientRect().left : Infinity;
  rowBoxes = [...panel.querySelectorAll('.arm')].map((row) => {
    const b = row.getBoundingClientRect();
    rowsRight = b.right;
    return { y: b.top + b.height / 2, h: b.height };
  });
  placeTip();
}

function build() {
  const many = state.arms.length > 1;
  panel.classList.toggle('weightless', !state.physics);
  queueMicrotask(() => {
    document.querySelectorAll<HTMLInputElement>('.ui input[type="range"]').forEach(mark);
    showHot();
  });
  panel.innerHTML = `
    <div class="picker" data-tip="instrument">
      ${INSTRUMENTS.map((c) => `<button data-act="pick" data-id="${c.id}" aria-pressed="${c.id === state.instrument}">${c.label}</button>`).join('')}
    </div>
    <div class="cols"><span>Swings</span><span>Sum</span><span class="snd">Sound</span><span>Swing</span><span>Length</span><span>Phase</span><span>Volume</span><span>Weight</span><span>Push</span></div>
    ${state.arms
      .map(
        (a, k) => `
    <div class="arm" data-k="${k}" style="--arm: rgb(${colour ? PALETTE[a.hue % PALETTE.length] : INK})">
      <span class="grip" data-tip="grip" aria-label="Move arm ${k + 1}">⋮⋮</span>
      <button data-act="dn" data-tip="swings" aria-label="Fewer swings per bar">−</button><output data-tip="swings">×${a.n}</output><button data-act="up" data-tip="swings" aria-label="More swings per bar">+</button>
      <button data-act="own" data-tip="mode" aria-pressed="${a.mode === 'sum'}" aria-label="Arm ${k + 1} sounds on the sum">Σ</button>
      <button class="snd" data-act="sound" data-tip="sound" aria-label="Sound of arm ${k + 1}" ${state.by === 'arm' && isKit() ? '' : 'disabled'}>${state.by === 'arm' ? soundName(k) : '·'}</button>
      <input type="range" data-p="swing" data-tip="swing" min="0" max="180" step="1" value="${Math.round((a.swing * 180) / Math.PI)}" aria-label="Swing of arm ${k + 1}" />
      <input type="range" data-p="len" data-tip="len" min="0.1" max="1.5" step="0.01" value="${a.len}" aria-label="Length of arm ${k + 1}" />
      <input type="range" data-p="phase" data-tip="phase" min="0" max="360" step="1" value="${Math.round((a.phase * 180) / Math.PI)}" aria-label="Phase of arm ${k + 1}" />
      <input type="range" data-p="vol" data-tip="vol" min="0" max="100" step="1" value="${Math.round(a.vol * 100)}" aria-label="Volume of arm ${k + 1}, 0 is muted" />
      <input type="range" data-p="mass" data-tip="mass" min="0" max="100" step="1" value="${Math.round(a.mass * 100)}" aria-label="Weight of arm ${k + 1}" />
      <input type="range" data-p="push" data-tip="push" min="0" max="100" step="1" value="${Math.round(a.push * 100)}" aria-label="Push of arm ${k + 1}" />
      <button data-act="rm" data-tip="rm" aria-label="Remove arm ${k + 1}" ${many ? '' : 'disabled'}>✕</button>
    </div>`,
      )
      .join('')}
    <div class="globals">
      <button data-act="add" data-tip="add" ${state.arms.length < MAX_ARMS ? '' : 'disabled'}>+ Arm</button>
    </div>`;
  const slider = (p: string, label: string, value: number, min = 0, max = 100) =>
    `<label class="row" data-tip="${p === 'bpm' ? 'tempo' : p}"><span>${label}</span><input type="range" data-p="${p}" min="${min}" max="${max}" step="1" value="${value}" /><output id="${p}">${value}</output></label>`;
  const pct = (v: number) => Math.round(v * 100);
  drawer.innerHTML = `
    <section><h2>Transport</h2>
      <div class="pair">
        <button data-act="play" data-tip="play">${playing ? 'Pause' : 'Play'}</button>
        <button data-act="restart" data-tip="restart">Restart</button>
        <button data-act="mute" data-tip="mute">${muted ? 'Muted' : 'Sound'}</button>
      </div>
      ${slider('bpm', 'Tempo', state.bpm, 40, 220)}
    </section>
    <section><h2>Motion</h2>
      <div class="pair"><button data-act="physics" data-tip="physics" aria-pressed="${state.physics}">${state.physics ? 'Physics' : 'Formula'}</button></div>
    </section>
    <section><h2>Notes</h2>
      <div class="pair">
        <button data-act="scale" data-tip="scale">${(SCALES.find((c) => c.id === state.scale) ?? SCALES[0]).label}</button>
        <button data-act="by" data-tip="by">${state.by === 'arm' ? 'By arm' : 'By hit'}</button>
      </div>
    </section>
    <section><h2>Mix</h2>
      ${slider('reverb', 'Reverb', pct(state.reverb))}
      ${slider('room', 'Room', pct(state.room))}
      ${slider('delay', 'Delay', pct(state.delay))}
      ${slider('harm', 'Harmonics', pct(state.harm))}
    </section>
    <section><h2>View</h2>
      <div class="pair">
        <button data-act="timeline" data-tip="timeline" aria-pressed="${timeline}">Timeline</button>
        <button data-act="colour" data-tip="colour" aria-pressed="${colour}">Colour</button>
      </div>
    </section>
    <section><h2>Setups</h2>
      <div class="pair">
        <button data-act="save" data-tip="save">Save</button>
        <button data-act="saveas" data-tip="saveas">Save as</button>
        <button data-act="open" data-tip="open">Open</button>
      </div>
    </section>`;
  measure();
}

// --- tips: what the control under the pointer does, in a box of its own over the workbench ---

const TIPS: Record<string, [string, string]> = {
  swings: ['Swings', 'How many times the arm swings in a bar: its harmonic. ×1 crosses the line twice a bar, ×2 four times.'],
  swing: ['Swing', 'How far the arm swings to each side, 0 to 180°. Wider and it counts for more in the sum; with physics on, wider is also slower.'],
  len: ['Length', 'How long the arm is: how far it carries the joints under it.'],
  phase: ['Phase', 'Where in its swing the arm is when the bar starts. 0° it crosses going right, 90° it is out at the right.'],
  vol: ['Volume', 'How loud this joint is. All the way down is muted: the arm still swings and still moves the ones under it.'],
  rm: ['Remove', 'Takes this arm away.'],
  grip: ['Move', 'Drag up or down to move this link along the chain. Its colour, its voice and its settings go with it.'],
  add: ['+ Arm', 'Hangs a new arm on the end, one harmonic up. Keys: + and −.'],
  mode: ['Sum / Each', 'What this joint crosses to sound. Lit, the sum: the centre line under the pivot, every arm above it added up. Not lit, each: the vertical under its own origin, its arm alone. Key: S, for all of them.'],
  restart: ['Restart', 'The motion from the top, the setup as it is. With physics on, the same setup plays the same again. Key: R.'],
  play: ['Pause / Play', 'Stops the motion where it is, and lets it go on. Key: space.'],
  mute: ['Sound', 'All sound on or off. Key: M.'],
  mass: ['Weight', 'How hard this link pulls on what it hangs from, with physics on. At the bottom it rides the arm above and is shaken by it, and the arm above never knows. At the top it weighs as much as the arm it hangs from, and throws it about.'],
  physics: ['Formula / Physics', 'Formula: every arm goes exactly as it is set. Physics: every arm is a real swing hung in the swing above, with its weight, kept going by the push. Key: W.'],
  push: ['Push', 'What keeps this swing going, with physics on: a push in time with its own rhythm, and the air against it. High and it keeps its time whatever the others do; from about the middle the bar comes round; lower and it drifts; 0 lets it go. The arrow at the joint is the push right now: none when the swing is on its own time.'],
  instrument: ['Instrument', 'What is struck. Tine: a kalimba\'s, a note that rings on. Bones: a drum, two bones knocked together, like a soft rimshot; the same for a link wherever it is: rhythm, no tune. Square: electronic, a filter every hit opens. TR-808: the drum machine, a sound a note: the marks down the ruler say which. Key: I, for the next.'],
  sound: ['Sound', 'What this arm sounds, when sounds go by arm (Notes, in the drawer). On the drum machine and the bones: press for the next of the eight, shift for the one before. On the others it is the note where the arm rests on the ruler: pull its ring longer or shorter.'],
  by: ['By hit / By arm', 'What says which note, or which drum, a hit is. By hit: where the joint is when it hits, so a joint far down the chain plays a different one each time. By arm: where its arm ends when the chain hangs straight, so every arm has one of its own. Key: B.'],
  scale: ['Scale', 'The notes the joints play: where a joint is when it hits is its note, low at the root and high far out, always the nearest one of this scale. Press for the next. The marks down the centre line are its notes. Key: N.'],
  reverb: ['Reverb', 'How much of what you hear is the room: none at the bottom; higher, the notes themselves go down as the room comes up; at the top, only the room.'],
  room: ['Room', 'How big the room is. Small, the walls are close and hard: it rings like metal, a pipe, a tin. Big, a hall. Turn Reverb up to hear it: all the way up with a small room is metal alone.'],
  delay: ['Delay', 'An echo in time, a dotted eighth apart, bouncing left then right: off at the bottom; higher, more goes in and more comes round again.'],
  harm: ['Harmonics', 'The overtone over every note: none at the bottom (plain, round), each link\'s own in the middle, twice that at the top (bright).'],
  tempo: ['Tempo', 'Beats a minute, four to the bar.'],
  drawer: ['Controls', 'The drawer: play and tempo, physics, the scale, the mix, the setups. Shut it and the chain has the whole width.'],
  save: ['Save', 'Keeps this setup under the name it has, and asks for one the first time. Key: cmd+S.'],
  saveas: ['Save as', 'Asks for a name and keeps this setup under it, offering the last name with the next number. Key: cmd+shift+S.'],
  open: ['Open', 'Everything saved by name, the newest first. Key: cmd+O. Ten more live on the digits: shift and a digit keeps, the digit brings back.'],
  timeline: ['Timeline', 'Each link\'s curve beside its row: what its joint crosses zero with, over the bar, a dot where it hits. Put away to start with. Key: T.'],
  colour: ['Colour', 'A colour a link (magenta, pink, neon green, and on), or all of it black and white, as it is to start with.'],
  tips: ['Tips', 'These boxes, on or off. Key: ?. And the sliders: a dragged one catches on its marks, shift slides past them.'],
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
  // faded while the formula runs: say why, and what turns it on
  const off = (key === 'mass' || key === 'push') && !state.physics ? ' Off now: the formula is running. Press Formula (or W) for physics.' : '';
  tip.replaceChildren(Object.assign(document.createElement('b'), { textContent: t[0] }), Object.assign(document.createElement('span'), { textContent: t[1] + off }));
}

/** over the workbench's rows on a wide screen; on a phone the stylesheet puts it under the title */
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
for (const el of [panel, drawer, tipsButton, drawerToggle]) {
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
  state.arms.push({ n: Math.min(MAX_N, last.n + 1), swing: 0.9, len: Math.max(0.2, +(last.len * 0.62).toFixed(2)), phase: 0, vol: 1, mass: +(last.mass / 2).toFixed(2), mode: last.mode, push: last.push, hue: -1, sound: 0 });
  const made = state.arms[state.arms.length - 1];
  made.hue = PALETTE.findIndex((_, h) => !state.arms.some((a) => a.hue === h));
  made.sound = FIRST_SOUND[made.hue % FIRST_SOUND.length];
  if (sim.live) sim.added(state.arms);
}
function removeArm(k = state.arms.length - 1) {
  if (state.arms.length < 2) return;
  state.arms.splice(k, 1);
  held = -1;
  if (sim.live) sim.removed(k);
}
function toggle(what: 'mode' | 'play' | 'mute' | 'physics' | 'scale' | 'instrument' | 'by') {
  if (what === 'by') {
    state.by = state.by === 'arm' ? 'hit' : 'arm';
    note(state.by === 'arm' ? 'A note an arm' : 'A note where it hits');
  }
  if (what === 'instrument') {
    state.instrument = INSTRUMENTS[(INSTRUMENTS.findIndex((c) => c.id === state.instrument) + 1) % INSTRUMENTS.length].id;
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
  if (what === 'physics') state.physics = !state.physics;
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
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  if (!b) return;
  const act = b.dataset.act!;
  if (act === 'timeline' || act === 'colour') {
    if (act === 'timeline') setTimeline(!timeline);
    else setColour(!colour);
    build();
    return;
  }
  if (act === 'save' || act === 'saveas' || act === 'open') {
    if (act === 'open') showSaved();
    else if (act === 'saveas' || !current) askName();
    else saveAs(current);
    return;
  }
  const k = Number(b.closest<HTMLElement>('.arm')?.dataset.k);
  if (act === 'up') state.arms[k].n = Math.min(MAX_N, state.arms[k].n + 1);
  else if (act === 'dn') state.arms[k].n = Math.max(1, state.arms[k].n - 1);
  else if (act === 'own') state.arms[k].mode = state.arms[k].mode === 'sum' ? 'each' : 'sum';
  else if (act === 'sound') state.arms[k].sound = (state.arms[k].sound + ((e as MouseEvent).shiftKey ? KIT.length - 1 : 1)) % KIT.length;
  else if (act === 'rm') removeArm(k);
  else if (act === 'add') addArm();
  else if (act === 'pick') state.instrument = b.dataset.id!;
  else if (act === 'restart') restart();
  else toggle(act as 'mode' | 'play' | 'mute' | 'physics' | 'scale' | 'instrument' | 'by');
  changed();
  build();
};
panel.addEventListener('click', onClick);
drawer.addEventListener('click', onClick);

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

// --- snap: a slider being dragged catches on its marks (the middle, the quarters, the round numbers) ---

const SNAPS: Record<string, number[]> = {
  swing: [0, 45, 90, 135, 180],
  len: [0.25, 0.5, 0.75, 1, 1.25, 1.5],
  phase: [0, 45, 90, 135, 180, 225, 270, 315, 360],
  vol: [0, 25, 50, 75, 100],
  mass: [0, 25, 50, 75, 100],
  push: [0, 25, 50, 75, 100],
  reverb: [0, 25, 50, 75, 100],
  room: [0, 25, 50, 75, 100],
  delay: [0, 25, 50, 75, 100],
  harm: [0, 25, 50, 75, 100],
  bpm: [60, 80, 90, 100, 120, 140, 160, 180, 200],
};
/** how near a mark catches, of the slider's whole way */
const CATCH = 0.025;
/** a pointer is dragging a slider (keys step freely: a mark would never let go of them), and shift slides past the marks */
let dragging = false;
let past = false;

for (const el of [panel, drawer]) {
  el.addEventListener('pointerdown', (e) => {
    dragging = (e.target as HTMLElement).matches?.('input[type="range"]') ?? false;
    past = e.shiftKey;
  });
}
window.addEventListener('pointermove', (e) => dragging && (past = e.shiftKey));
for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, () => (dragging = false));
for (const ev of ['keydown', 'keyup'] as const) window.addEventListener(ev, (e) => e.key === 'Shift' && (past = ev === 'keydown'));

/** the slider's value, on a mark if it is being dragged near one */
function snapped(r: HTMLInputElement): number {
  let v = Number(r.value);
  const marks = SNAPS[r.dataset.p ?? ''];
  if (!marks || !dragging || past) return v;
  const reach = (Number(r.max) - Number(r.min)) * CATCH;
  for (const m of marks) {
    if (Math.abs(v - m) <= reach && Math.abs(v - m) > 0) {
      v = m;
      r.value = String(m);
      break;
    }
  }
  return v;
}

/** the marks, drawn on the slider: a tick where it catches */
function mark(r: HTMLInputElement) {
  const marks = SNAPS[r.dataset.p ?? ''];
  if (!marks) return;
  const min = Number(r.min);
  const span = Number(r.max) - min;
  // the thumb's middle travels from half a thumb in to half a thumb from the end
  r.style.background = marks
    .filter((m) => m >= min && m <= min + span)
    .map((m) => `linear-gradient(rgba(${INK}, 0.4), rgba(${INK}, 0.4)) calc(4px + ${((m - min) / span).toFixed(4)} * (100% - 9px)) 50% / 1px 7px no-repeat`)
    .join(', ');
}

const onInput = (e: Event) => {
  const r = e.target as HTMLInputElement;
  const v = snapped(r);
  if (r.dataset.p === 'bpm') {
    anchor();
    state.bpm = v;
    drawer.querySelector('#bpm')!.textContent = String(v);
  } else if (r.dataset.p === 'reverb' || r.dataset.p === 'room' || r.dataset.p === 'delay' || r.dataset.p === 'harm') {
    state[r.dataset.p] = v / 100;
    drawer.querySelector('#' + r.dataset.p)!.textContent = String(v);
  } else {
    const a = state.arms[Number(r.closest<HTMLElement>('.arm')!.dataset.k)];
    if (r.dataset.p === 'swing') a.swing = (v * Math.PI) / 180;
    else if (r.dataset.p === 'phase') a.phase = (v * Math.PI) / 180;
    else if (r.dataset.p === 'vol') a.vol = v / 100;
    else if (r.dataset.p === 'mass') a.mass = v / 100;
    else if (r.dataset.p === 'push') a.push = v / 100;
    else a.len = v;
  }
  changed();
};
panel.addEventListener('input', onInput);
drawer.addEventListener('input', onInput);

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
  // cmd (or ctrl) and up or down: the lit link (the one the pointer is in the ring of, or held) louder or quieter
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && sheet.hidden) {
    const k = hot >= 0 ? hot : held;
    if (k < 0 || k >= state.arms.length) return;
    e.preventDefault();
    const a = state.arms[k];
    a.vol = Math.round(Math.min(1, Math.max(0, a.vol + (e.key === 'ArrowUp' ? 0.05 : -0.05))) * 100) / 100;
    note(`Volume ${Math.round(a.vol * 100)}`);
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
  else if (e.key === 'w') toggle('physics');
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
/** link k's colour, its own wherever it is in the chain: the arm and the joint at its end, its path, its rings, its row in the bar and in the workbench */
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
let held = -1;
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
  // the drawer, when it is open beside the scene (on a phone it lies over it): nothing is drawn under it
  const wall = wide && Number.isFinite(drawerLeft) ? drawerLeft - 24 : w - edge;
  const cx0 = rowsRight + 28;
  const cw = wall - cx0;
  const curves = timeline && !clean && wide && cw > 120 && rowBoxes.length >= n;
  // the chain hangs in the middle of the screen, the rows under it in the middle too
  const px = w / 2;
  // The ruler of notes stands still, from under the title to over the workbench, and the root
  // hangs where it is put on it. An arm length is always the same stretch of it, so where a
  // joint is says its note; only a chain too long for the ruler makes it all smaller.
  const y0 = wide ? 84 : 124;
  const y1 = Math.max(y0 + 120, (clean ? h - 30 : panelRect.top - 18) - (timeline && !curves ? 80 : 28));
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

  // what a joint has to cross: the centre line, or its own vertical
  // the ruler, the whole of it: the line the joints cross is the stretch of it under the root
  line(px, y0, px, y0 + RULER * unit, 0.1);
  if (arms.some((a) => a.mode === 'sum')) line(px, py, px, Y(total) + 14, 0.25);
  // its notes: a mark at every note of the scale, a longer one at every A, low at the top. Where
  // a joint is when it hits is the note it plays, the nearest of these.
  const marks = scaleNotes();
  // On the drum machine a note is a sound, not a pitch: every mark says which (they go round, a
  // sound a mark, down the ruler), so a joint can be put on the one that is wanted.
  const kit = state.instrument === '808' && state.by === 'hit';
  if (kit) {
    ctx.font = '600 8px Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = ink(0.5);
  }
  let step = 0;
  for (let m = 0; m <= SPAN; m++) {
    if (!marks.includes(m % 12)) continue;
    const y = y0 + (m / SPAN) * RULER * unit;
    const half = kit ? 3 : m % 12 === 0 ? 5 : 1.5;
    line(px - half, y, px + half, y, 0.4);
    if (kit) ctx.fillText(KIT[step % KIT.length], px + 9, y + 0.5);
    step++;
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

  // Every joint's path, the last one's a little brighter: the picture the swings add up to. It
  // is the bar behind the joint, brightest where it has just been and gone by the time it is a
  // bar old. (With the formula the path is a closed one and comes round; with weight it never
  // does.) One stroke has one colour, so it is drawn in pieces, each a little fainter.
  const weighted = state.physics;
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  if (weighted) {
    for (let i = 0; i <= TRAIL; i++) trail.set(pose(phi - 1 + i / TRAIL, then), i * 2 * MAX_ARMS);
  }
  const head = Math.floor((phi - Math.floor(phi)) * ORBIT);
  // with a link lit (the pointer in its ring, or held by a click), its path alone
  const only = hot >= 0 ? hot : held;
  for (let k = 0; k < n; k++) {
    if (only >= 0 && only < n && k !== only) continue;
    const o = orbits[k];
    const bright = k === n - 1 || k === only ? 0.9 : 0.5;
    for (let c = 0; c < PIECES; c++) {
      ctx.strokeStyle = tint(k, bright * Math.pow(1 - (c + 0.5) / PIECES, 1.7));
      ctx.beginPath();
      if (weighted) {
        const per = TRAIL / PIECES;
        for (let m = 0; m <= per; m++) {
          const i = TRAIL - c * per - m;
          ctx.lineTo(X(trail[(i * MAX_ARMS + k) * 2]), Y(trail[(i * MAX_ARMS + k) * 2 + 1]));
        }
      } else {
        const per = ORBIT / PIECES;
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
    pose(f.phase, then);
    ctx.strokeStyle = tint(f.k, (1 - age / 0.4) ** 2 * (0.25 + 0.75 * f.vel) * (0.15 + 0.85 * arms[f.k].vol));
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(X(then[2 * f.k]), Y(then[2 * f.k + 1]), 5 + age * (40 + 80 * f.vel), 0, Math.PI * 2);
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
  const lit1 = hot >= 0 ? hot : held;
  if (lit1 >= 0 && lit1 < n) {
    let inner = 0;
    for (let k = 0; k < lit1; k++) inner += arms[k].len * unit;
    const outer = inner + arms[lit1].len * unit;
    ctx.beginPath();
    ctx.arc(px, py, outer, 0, Math.PI * 2);
    ctx.arc(px, py, inner, 0, Math.PI * 2, true);
    // how loud the link is, to be seen: the ring fuller the louder, never solid, all but clear when it is muted
    ctx.fillStyle = tint(lit1, 0.025 + 0.3 * arms[lit1].vol);
    ctx.fill('evenodd');
    ctx.strokeStyle = tint(lit1, 0.4);
    ctx.lineWidth = 1;
    for (const r of [inner, outer]) {
      if (r < 1) continue;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
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
      const wn = Math.PI * 2 * arms[k].n;
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
  ctx.arc(px, py, onRoot || rooting ? 7 : 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ink(0.95);
  ctx.beginPath();
  ctx.arc(px, py, 2, 0, Math.PI * 2);
  ctx.fill();
  for (let k = 0; k < n; k++) {
    // all its colour, as big as it is heavy with physics on; when it sounds it swells and goes white for a moment
    const hit = Math.max(0, lit[k]);
    ctx.beginPath();
    ctx.arc(X(now[2 * k]), Y(now[2 * k + 1]), (state.physics ? 2.5 + 4.5 * Math.sqrt(arms[k].mass) : 5) * (1 + 0.5 * hit), 0, Math.PI * 2);
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
      line(x, tlY - b.dir * from, x, tlY - b.dir * (from + tall), ((weighted ? 0.9 - 0.6 * since : 0.8) + 0.2 * glow) * (0.2 + 0.8 * arms[b.k].vol), 1.5, b.k);
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
      ctx.strokeStyle = tint(k, 0.35 + 0.6 * arms[k].vol);
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
      ctx.fillStyle = tint(b.k, (0.25 + 0.75 * arms[b.k].vol) * (weighted ? 1 - 0.6 * since : 1));
      ctx.beginPath();
      ctx.arc(cx0 + (b.phase - Math.floor(b.phase)) * cw, rowBoxes[b.k].y, 1.5 + 1.5 * b.vel + 2 * glow, 0, Math.PI * 2);
      ctx.fill();
    }
    line(cx0 + at * cw, rowBoxes[0].y - rowBoxes[0].h / 2 - 2, cx0 + at * cw, rowBoxes[n - 1].y + rowBoxes[n - 1].h / 2 + 2, 0.5);
  }

  const say = t < notedUntil ? noted : sound?.running ? '' : 'Tap for sound';
  if (say !== hinted) hint.textContent = hinted = say;

  requestAnimationFrame(frame);
}

// the dev console: __pendulum.sound()?.stats says how many hits went out and how far ahead
if (import.meta.env.DEV) Object.assign(window, { __pendulum: { state, sim, energy: () => sim.energy(state.arms), sound: () => sound, bar: () => bar, played: () => played } });

// --- the link under the pointer: lit on the chain and in the workbench, from either side ---

function showHot() {
  const k = hot >= 0 ? hot : held;
  panel.querySelectorAll('.arm').forEach((row, i) => row.classList.toggle('hot', i === k));
}

function heat(k: number) {
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

window.addEventListener('pointermove', (e) => {
  // the root, held: it goes up and down the ruler with the pointer, and the key with it
  if (rooting) {
    state.root = Math.min(RULER - 0.2, Math.max(0, (e.clientY - ruler.y0) / ruler.unit));
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
    if (pull.way === 'len') a.len = Math.round(Math.min(1.5, Math.max(0.1, pull.len + dy / ruler.unit)) * 100) / 100;
    else if (pull.way === 'vol') {
      a.vol = Math.round(Math.min(1, Math.max(0, pull.vol - dy / VOL_PX)) * 100) / 100;
      note(`Volume ${Math.round(a.vol * 100)}`);
    } else a.swing = (Math.round(Math.min(180, Math.max(0, (pull.swing * 180) / Math.PI + dx / SWING_PX))) * Math.PI) / 180;
    const slider = panel.querySelector<HTMLInputElement>(`.arm[data-k="${pull.k}"] [data-p="${pull.way}"]`);
    if (slider) slider.value = String(pull.way === 'len' ? a.len : pull.way === 'vol' ? Math.round(a.vol * 100) : Math.round((a.swing * 180) / Math.PI));
    canvas.style.cursor = pull.way === 'swing' ? 'ew-resize' : 'ns-resize';
    changed();
    return;
  }
  const row = (e.target as HTMLElement).closest?.<HTMLElement>('.arm');
  onRoot = e.target === canvas && seen.length > 1 && fromRoot(e) <= 12;
  heat(row ? Number(row.dataset.k) : e.target === canvas && !onRoot ? armAt(e.clientX, e.clientY) : -1);
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
    // the rows say each arm's note when sounds go by arm: it may have moved
    build();
  });
}
document.addEventListener('pointerleave', () => heat(-1));

window.addEventListener('resize', resize);
changed();
build();
setDrawer(drawerOpen);
resize();
requestAnimationFrame(frame);
