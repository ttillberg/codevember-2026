// The sound: a small struck voice per link, made of plain nodes (a sine, one pure overtone
// over it, a click of noise). The note is where the joint is when it hits, the bass at the
// root, on a scale; the link's own is the timbre.
// Hits are given in performance time and started on the audio clock, so the rhythm is as
// tight as the formula, whatever the frame rate does.
import acidUrl from './acid.worklet.ts?worker&url';
import type { AcidMsg } from './acid.worklet';

/**
 * Where a joint is when it hits is its note, as on day 14's string: the notes are laid down a
 * ruler that stands still, low at the top, four octaves up from A1 to the bottom. The root
 * hangs somewhere on it, and a joint plays the note at its own height on the screen.
 * And always a real note: the nearest one of the scale, so whatever the chain does it is in
 * tune. The scales are day 14's, all on A, all with the root and the fifth.
 */
export const SCALES: Array<{ id: string; label: string; notes: number[] }> = [
  { id: 'tension', label: 'Tension', notes: [0, 2, 3, 7, 8] },
  { id: 'minor', label: 'Minor pent', notes: [0, 3, 5, 7, 10] },
  { id: 'kumoi', label: 'Kumoi', notes: [0, 2, 3, 7, 9] },
  { id: 'major', label: 'Major pent', notes: [0, 2, 4, 7, 9] },
  { id: 'aeolian', label: 'Aeolian', notes: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'hijaz', label: 'Hijaz', notes: [0, 1, 4, 5, 7, 8, 10] },
];
/** the note at the top of the ruler (A1), how many semitones it spans, and how long it is, in arm lengths */
const LOWEST = 33;
export const SPAN = 48;
export const RULER = 2;

/** the nearest note of the scale to a pitch (midi); a tie goes down */
function snap(notes: number[], pitch: number): number {
  const r = Math.round(pitch);
  for (let k = 0; k <= 6; k++) {
    for (const m of [r - k, r + k]) if (notes.includes((((m - LOWEST) % 12) + 12) % 12)) return m;
  }
  return r;
}
/** the note at pos (0 the top of the ruler, 1 its bottom), midi */
export const noteAt = (notes: number[], pos: number) => snap(notes, LOWEST + Math.min(1, Math.max(0, pos)) * SPAN);
const hertz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * The instruments: what every hit is made of. Tine and square sound the note asked for; the
 * bones are a drum, and take none.
 * - tine: a kalimba's tine. A sine that rings on, one pure overtone over it, a click.
 * - bones: a drum, two bones knocked together: a soft rimshot. A round knock with some tone
 *   in it, a tenth of a second, and what rings with it as on a rim. Rhythm only: every link
 *   has its own pair, and the note asked for does not come into it.
 * - TB-303: the bass machine (Roland's, from the soundbox's voice, ported): a saw or a square
 *   through a four-pole ladder filter that every note opens and that closes again, with its
 *   knobs: cutoff, resonance, how far the envelope opens it, how long it takes to close, how
 *   much an accent counts, how slowly a slide glides, and its tune. Mono, as it was: a note
 *   that starts while the last is still held glides to its pitch instead of striking again, and
 *   a hard hit is an accent. Runs in an AudioWorklet (acid.worklet.ts); where a page has none
 *   (a phone over plain http) it is the plain square voice it was, without the knobs.
 * - 808: the drum machine. Not one sound tuned to the note but a sound a note (KIT, below):
 *   bass drum, rimshot, snare, hats, clap, tom, cowbell, each made the way the machine made
 *   it, near enough: a sine that falls for the drums, six squares that agree on nothing for
 *   the metal, noise through a band for the rest.
 * - chatter: a voice saying a syllable on the note (VEINS, below): a buzz through three
 *   formants that make the vowel, the consonant before it made of where they start from and
 *   a little noise.
 */
export const INSTRUMENTS: Array<{ id: string; label: string }> = [
  { id: 'tine', label: 'Tine' },
  { id: 'bones', label: 'Bones' },
  { id: '303', label: 'TB-303' },
  { id: '808', label: 'TR-808' },
  { id: 'chatter', label: 'Chatter' },
];

/** the vowels, by their first three formants (Hz) */
const VOWELS: Record<string, [number, number, number]> = {
  a: [780, 1200, 2700],
  e: [450, 1900, 2600],
  i: [300, 2250, 3000],
  o: [480, 820, 2650],
  u: [330, 740, 2450],
};
/**
 * The consonants, by what they do to the vowel after them: where its first two formants start
 * from (the mouth's shape before it opens), how long until the voice comes in (s), and the
 * noise at the start: its band, how long, how loud, and whether it is a hiss (s) or a burst.
 * A hum (m, n) is the voice through a shut mouth first: only the lowest formant.
 */
type Consonant = { f1: number; f2: number; gap: number; noise?: [number, number, number]; hiss?: boolean; hum?: boolean };
const CONSONANTS: Record<string, Consonant> = {
  b: { f1: 240, f2: 850, gap: 0.006, noise: [600, 0.008, 0.25] },
  d: { f1: 250, f2: 1750, gap: 0.008, noise: [3200, 0.01, 0.3] },
  k: { f1: 300, f2: 2100, gap: 0.04, noise: [2400, 0.03, 0.5] },
  t: { f1: 300, f2: 1800, gap: 0.045, noise: [4800, 0.035, 0.5] },
  p: { f1: 260, f2: 800, gap: 0.035, noise: [900, 0.025, 0.45] },
  m: { f1: 250, f2: 1000, gap: 0, hum: true },
  n: { f1: 250, f2: 1600, gap: 0, hum: true },
  l: { f1: 340, f2: 1100, gap: 0 },
  s: { f1: 300, f2: 1700, gap: 0.07, noise: [5500, 0.07, 0.22], hiss: true },
};
/**
 * Each link's vein: four syllables alike, one consonant and the vowels round it, and the size
 * of the mouth that says them (its formants times this: over 1 a smaller one). A hit says one
 * of the four, never the one before it.
 */
const VEINS = [
  { says: ['ba', 'bi', 'bo', 'bu'], mouth: 1 },
  { says: ['da', 'de', 'di', 'do'], mouth: 1.1 },
  { says: ['ka', 'ke', 'ki', 'ko'], mouth: 0.94 },
  { says: ['ma', 'me', 'mi', 'mo'], mouth: 1.16 },
  { says: ['la', 'le', 'li', 'lu'], mouth: 1.05 },
  { says: ['ta', 'te', 'ti', 'tu'], mouth: 0.9 },
  { says: ['na', 'ne', 'no', 'nu'], mouth: 1.2 },
  { says: ['pa', 'pe', 'pi', 'po'], mouth: 0.97 },
];

/**
 * The 303's knobs as they are kept: each 0..1 (the wave 0 for a saw, 1 for a square; the tune in
 * semitones, -12 to 12). The ones that are times and pitches go along a log from their lowest
 * to their highest (acidParams), as a knob over such a range should.
 */
export interface Acid {
  wave: number;
  cutoff: number;
  res: number;
  env: number;
  decay: number;
  accent: number;
  slide: number;
  tune: number;
}
/** where they start: the soundbox's own (800 Hz, 0.6 resonance, 0.5 env mod, 0.3 s, 0.5 accent, 60 ms) */
export const ACID_START: Acid = { wave: 0, cutoff: 0.533, res: 0.6, env: 0.5, decay: 0.486, accent: 0.5, slide: 0.486, tune: 0 };
const along = (x: number, from: number, to: number) => from * Math.pow(to / from, Math.min(1, Math.max(0, x)));
/** a note's gate: how long a note is held before it lets go, seconds (a note inside it glides) */
const ACID_GATE = 0.16;
/** how much the 303 is turned down to sit with the others */
const ACID_LEVEL = 1.4;

/**
 * The drum machine's sounds, one to a note: going down the ruler, every note of the scale is
 * the next of these, round and round. So what a joint plays is where it is, as with the
 * others, but what is there is a drum and not a pitch.
 */
export const KIT = ['BD', 'RS', 'SD', 'CH', 'CP', 'LT', 'OH', 'CB'];
/** which note of the scale a midi note is, counted up from the top of the ruler */
export function stepOf(notes: number[], midi: number): number {
  let step = 0;
  for (let m = LOWEST; m < midi; m++) if (notes.includes((m - LOWEST) % 12)) step++;
  return step;
}

/** where each link's pair of bones rings, hertz: none a note of anything, eight sizes of bone */
const BONES = [250, 300, 360, 220, 410, 275, 330, 470];

/**
 * What a link's own voice keeps wherever it plays: which overtone rings over the note, and how
 * loud, and its click. Only octaves and fifths over the note (2, 3, 4, 6 times it): nothing in
 * the voice is outside the scale.
 */
const TIMBRES = [
  { over: 2, bright: 0.3, click: 0.2 },
  { over: 3, bright: 0.22, click: 0.15 },
  { over: 4, bright: 0.2, click: 0.25 },
  { over: 2, bright: 0.5, click: 0.1 },
  { over: 3, bright: 0.38, click: 0.25 },
  { over: 6, bright: 0.12, click: 0.3 },
  { over: 4, bright: 0.32, click: 0.15 },
  { over: 2, bright: 0.16, click: 0.3 },
];

/**
 * The room, by its size (0..1). A big one is a wash: noise dying over seconds, darker as it
 * goes. A small one is hard walls close together: the sound comes back at a few short, even
 * intervals, over and over, and that is what rings like metal, a pipe, a tin. In between,
 * some of each. All of them as loud, whatever the size.
 */
function room(ac: AudioContext, size: number): AudioBuffer {
  const metal = Math.pow(1 - size, 1.5);
  // a hall takes seconds to die; metal is small but hard, and rings on for one
  const seconds = 0.25 + 2.75 * size * size + 0.95 * metal;
  const n = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, n, ac.sampleRate);
  // the walls' distances: a few milliseconds in a tin, tens in a hall, never a round ratio of each other
  const base = (0.0022 + 0.012 * size) * ac.sampleRate;
  const walls = [
    [1, 1.37, 1.83, 2.41],
    [1.09, 1.51, 1.93, 2.63],
  ];
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      lp += (Math.random() * 2 - 1 - lp) * (0.9 - 0.7 * t);
      d[i] = (1 - metal) * lp * Math.pow(1 - t, 3);
    }
    for (const wall of walls[c]) {
      const gap = base * wall;
      // each bounce a little weaker, and gone by the end
      for (let b = 1; b * gap < n; b++) {
        const at = Math.floor(b * gap);
        d[at] += metal * 4 * Math.pow(0.975, b) * Math.pow(1 - at / n, 2) * (b % 2 ? 1 : -0.8);
      }
    }
    let energy = 0;
    for (let i = 0; i < n; i++) energy += d[i] * d[i];
    const even = Math.sqrt((600 * (0.4 + 0.6 * size)) / (energy || 1));
    for (let i = 0; i < n; i++) d[i] *= even;
  }
  return buf;
}

/** the clipper's curve is tanh(CLIP·x) over -1..1: how hard it is driven is the gain before it times this */
const CLIP = 4;
/** the drive at the bottom of the distortion knob (on the straight part of the curve: clean) and at its top (a fuzz) */
const DRIVE_MIN = 0.06;
const DRIVE_MAX = 24;
/** the low pass on the room, Hz: with no damping and with all of it */
const DAMP_OPEN = 16000;
const DAMP_SHUT = 500;
/**
 * The tremolo's speed is a note value of the tempo, not a number of hertz: how many times it
 * dips and comes back in a bar. (The knob's value is the place in this list.) It is locked to
 * the bar, at its fullest on the beat, and dips between.
 */
export const TREM_DIVS: Array<{ label: string; perBar: number }> = [
  { label: '1/1', perBar: 1 },
  { label: '1/2', perBar: 2 },
  { label: '1/4', perBar: 4 },
  { label: '1/8', perBar: 8 },
  { label: '1/8T', perBar: 12 },
  { label: '1/16', perBar: 16 },
  { label: '1/32', perBar: 32 },
];
/** it starts on the eighths */
export const TREM_START = 3;
/** how long a channel's tremolo is trusted to be in step with the bar before it is put right again, seconds (the two clocks drift apart, a hair) */
const TREM_RELOCK = 8;
/** a hit's level when its speed does not count: that of a fairly hard one (vel about 0.68), so the knob does not turn the whole mix up */
const EVEN = 0.6;
/** the level at the top of the volume knob: 80 on it is 0.8, where it was before there was a knob */
const VOLUME_TOP = 0.8 / Math.pow(0.8, 1.5);
/** the chatter's buzz before the mouth: most of a sawtooth is lost in its formants, so it goes in hot to come out as loud as a tine */
const CHAT_LEVEL = 2.4;

/** what one pendulum's mix is: each knob 0..1, and the tempo the echo keeps (a dotted eighth of it) */
export interface Mix {
  reverb: number;
  room: number;
  delay: number;
  harm: number;
  bpm: number;
  volume: number;
  dist: number;
  damp: number;
  velocity: number;
  /** the tremolo: how deep it is (0 none, 1 down to silence), and how fast: its place in TREM_DIVS */
  trem: number;
  tremRate: number;
  /** the 303's knobs (what a 303 on this channel sounds like), and whether it is what is struck: its voice is made ahead, as soon as it is */
  acid: Acid;
  instrument: string;
}

/**
 * One pendulum's own channel, the whole way to the master: the distortion, the room, the echo,
 * a compressor and its level. Every pendulum has one, so each is mixed on its own (a tine
 * with no room beside a chatter drowned in one).
 */
class Strip {
  /** where its hits go in */
  readonly bus: GainNode;
  private out: GainNode;
  private level = 0.8;
  /** the tremolo: a gain that a sine moves, after everything the channel does (the room's tail shakes too) */
  private flutter: GainNode;
  private lfo: OscillatorNode;
  private swing: GainNode;
  /** the 303 on this channel: made at its first note (where the page can run a worklet), and what its knobs say */
  private voice: AudioWorkletNode | null = null;
  private knobs: Acid | null = null;
  private wantsVoice = false;
  private knobsSaid = '';
  private gateEnd = -Infinity;
  private gen = 0;
  /** what the tremolo is locked for: the tempo and the note value, and whether there is any; and when it was last put in step */
  private lockKey = '';
  private lockOn = false;
  private div = TREM_START;
  private bpm = 120;
  /** it is out of step with the bar (new, or the tempo or the note value moved) and is to be locked again */
  unlocked = true;
  lockedAt = -Infinity;
  /** the distortion, before the room and the echo: how hard it is driven, and brought back down after */
  private pre: GainNode;
  private post: GainNode;
  /** the room's damping: a low pass on what comes back from it */
  private damp: BiquadFilterNode;
  /** the room's level, and the echo: what goes into it, what comes round again, and its two taps */
  private dry: GainNode;
  private wet: GainNode;
  private send: GainNode;
  private again: GainNode;
  private taps: DelayNode[];
  private conv: ConvolverNode;
  /** the room's size as it is built, and the one asked for, built once the knob rests */
  private size = 0.7;
  private resting = 0;
  /** how loud the overtone over every note is: 1 as designed, 0 none (plain sines), 2 twice */
  harm = 1;
  /** how much a hit's speed counts in its level: 1 all of it, 0 none (every hit at EVEN) */
  touch = 1;
  /** the mix as it was last set, to know when there is nothing new */
  private said = '';

  constructor(private ac: AudioContext, to: AudioNode) {
    this.bus = ac.createGain();
    const conv = (this.conv = ac.createConvolver());
    conv.buffer = room(ac, this.size);
    this.wet = ac.createGain();
    this.wet.gain.value = 0;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    this.out = ac.createGain();
    this.out.gain.value = this.level;
    this.dry = ac.createGain();
    // The distortion: everything through one soft clipper (tanh). The curve never changes: the
    // knob is how hard it is driven into it. At the bottom it is driven so little that it is on
    // the straight part (clean), and the gain after it brings the level back to what it was.
    this.pre = ac.createGain();
    this.pre.gain.value = DRIVE_MIN / CLIP;
    const clip = ac.createWaveShaper();
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(CLIP * ((2 * i) / (curve.length - 1) - 1));
    clip.curve = curve;
    clip.oversample = '2x';
    this.post = ac.createGain();
    this.post.gain.value = 1 / DRIVE_MIN;
    this.bus.connect(this.pre).connect(clip).connect(this.post);
    // the damping: the room's top taken off as it comes back, open to start with
    this.damp = ac.createBiquadFilter();
    this.damp.type = 'lowpass';
    this.damp.Q.value = 0.5;
    this.damp.frequency.value = DAMP_OPEN;
    this.post.connect(this.dry).connect(comp);
    this.post.connect(conv).connect(this.damp).connect(this.wet).connect(comp);
    // the tremolo: the gain sits at 1 - depth/2 and the sine moves it by depth/2 either way, so it swings between 1 - depth and 1
    this.flutter = ac.createGain();
    this.lfo = ac.createOscillator();
    this.swing = ac.createGain();
    this.swing.gain.value = 0;
    this.lfo.connect(this.swing).connect(this.flutter.gain);
    this.lfo.start();
    // (until it is locked it sways at the bar's pace on the eighths, from nowhere in particular)
    this.lfo.frequency.value = (TREM_DIVS[TREM_START].perBar * this.bpm) / 240;
    comp.connect(this.flutter).connect(this.out).connect(to);

    // The echo, as on day 14: a dotted eighth apart, bouncing left then right, dark (a band from
    // 180 Hz to 2.8 kHz) so it sits behind the notes, and a little of it into the room.
    this.send = ac.createGain();
    this.send.gain.value = 0;
    this.again = ac.createGain();
    this.again.gain.value = 0.3;
    const low = ac.createBiquadFilter();
    low.type = 'highpass';
    low.frequency.value = 180;
    const high = ac.createBiquadFilter();
    high.type = 'lowpass';
    high.frequency.value = 2800;
    this.taps = [ac.createDelay(2.5), ac.createDelay(2.5)];
    const echo = ac.createGain();
    this.post.connect(this.send).connect(low).connect(high).connect(this.taps[0]).connect(this.taps[1]).connect(this.again).connect(this.taps[0]);
    this.taps.forEach((tap, i) => {
      const side = ac.createStereoPanner();
      side.pan.value = i ? 0.7 : -0.7;
      tap.connect(side).connect(echo);
    });
    echo.connect(comp);
    echo.connect(conv);
  }

  /**
   * The mix: volume, distortion, reverb, room, damping, delay and harmonics, each 0..1, and the tempo the echo keeps (a
   * dotted eighth of it). Reverb is how much of what is heard is the room (at the top, only the room) and room its size; delay is how much goes into the echo and how
   * much of it comes round again; harmonics is the overtone over every note, none at 0, as
   * designed in the middle, twice at the top.
   */
  set(mix: Mix) {
    // told again with nothing new (a track's knob being turned says so a hundred times a second): nothing to do
    const said = [mix.reverb, mix.room, mix.delay, mix.harm, mix.bpm, mix.volume, mix.dist, mix.damp, mix.velocity, mix.trem, mix.tremRate, mix.instrument, Object.values(mix.acid).join()].join();
    if (said === this.said) return;
    this.said = said;
    const now = this.ac.currentTime;
    // the volume of it all: 80 is where it was before there was a knob
    const level = VOLUME_TOP * Math.pow(mix.volume, 1.5);
    if (level !== this.level) {
      this.level = level;
      this.out.gain.setTargetAtTime(level, now, 0.02);
    }
    // The distortion: how hard everything is driven into the clipper, from next to nothing (clean)
    // to a fuzz. What comes out is brought back to about the level it had, a little under at the
    // top, where every tail is as loud as its note.
    const dist = mix.dist;
    const drive = DRIVE_MIN * Math.pow(DRIVE_MAX / DRIVE_MIN, dist);
    this.pre.gain.setTargetAtTime(drive / CLIP, now, 0.03);
    this.post.gain.setTargetAtTime(((0.5 / Math.tanh(drive * 0.5)) * (1 - 0.6 * dist * dist)), now, 0.03);
    // the damping: from open down to a room hung with blankets
    this.damp.frequency.setTargetAtTime(DAMP_OPEN * Math.pow(DAMP_SHUT / DAMP_OPEN, mix.damp), now, 0.03);
    // a mix, not a send: as the room comes up the notes themselves go down, and at the top there is only the room
    const wet = 4 * Math.pow(Math.sin((mix.reverb * Math.PI) / 2), 2);
    this.wet.gain.setTargetAtTime(wet, now, 0.03);
    this.dry.gain.setTargetAtTime(Math.cos((mix.reverb * Math.PI) / 2), now, 0.03);
    // a new room is made once the knob has rested a moment, and swapped in under a dip of its level
    if (mix.room !== this.size) {
      this.size = mix.room;
      window.clearTimeout(this.resting);
      this.resting = window.setTimeout(() => {
        const t = this.ac.currentTime;
        this.wet.gain.setTargetAtTime(0, t, 0.012);
        window.setTimeout(() => {
          this.conv.buffer = room(this.ac, this.size);
          this.wet.gain.setTargetAtTime(wet, this.ac.currentTime, 0.03);
        }, 70);
      }, 160);
    }
    this.send.gain.setTargetAtTime(0.7 * mix.delay, now, 0.03);
    this.again.gain.setTargetAtTime(mix.delay > 0 ? 0.2 + 0.45 * mix.delay : 0, now, 0.03);
    for (const tap of this.taps) tap.delayTime.setTargetAtTime((0.75 * 60) / mix.bpm, now, 0.05);
    this.knobs = mix.acid;
    this.wantsVoice = mix.instrument === '303';
    this.ready();
    this.tellKnobs();
    this.flutter.gain.setTargetAtTime(1 - 0.5 * mix.trem, now, 0.03);
    this.swing.gain.setTargetAtTime(0.5 * mix.trem, now, 0.03);
    // its pace is the tempo's: the bar a second's worth of cycles long, as many to it as the note value says
    this.div = Math.min(TREM_DIVS.length - 1, Math.max(0, Math.round(mix.tremRate)));
    this.bpm = mix.bpm;
    const key = `${this.bpm}|${this.div}`;
    const on = mix.trem > 0;
    if (key !== this.lockKey || on !== this.lockOn) {
      this.lockKey = key;
      this.lockOn = on;
      this.unlocked = true;
    }
    this.harm = 2 * mix.harm;
    this.touch = mix.velocity;
  }

  /**
   * Put the tremolo in step with the bar: a fresh sine, started at `at` (context time) at the
   * pace of the tempo and the note value, turned so that at `at` it is where the bar is (`bars`,
   * how far into it): at its fullest on the beat. A sine turned a quarter of a cycle is a cosine,
   * and a cosine and a sine added are a sine of any turn: a table of two numbers says it. Where the
   * old one stops, this one takes up, at the same level, so nothing is heard of the change.
   */
  lock(at: number, bars: number) {
    this.unlocked = false;
    this.lockedAt = this.ac.currentTime;
    if (!this.lockOn) return;
    const per = TREM_DIVS[this.div].perBar;
    const turn = 2 * Math.PI * ((per * bars) % 1) + Math.PI / 2;
    const next = this.ac.createOscillator();
    next.setPeriodicWave(this.ac.createPeriodicWave([0, Math.sin(turn)], [0, Math.cos(turn)], { disableNormalization: true }));
    next.frequency.value = (per * this.bpm) / 240;
    next.connect(this.swing);
    next.start(at);
    const old = this.lfo;
    old.stop(at);
    old.onended = () => old.disconnect();
    this.lfo = next;
  }

  /** the 303's knobs, in the units it runs on, told to its voice when they are new */
  private tellKnobs() {
    const a = this.knobs;
    if (!this.voice || !a) return;
    const params = {
      type: 'params' as const,
      wave: a.wave,
      cutoff: along(a.cutoff, 80, 6000),
      res: a.res,
      envmod: a.env,
      decay: along(a.decay, 0.05, 2),
      accent: a.accent,
      slide: along(a.slide, 0.01, 0.4),
      tune: a.tune,
    };
    const said = JSON.stringify(params);
    if (said === this.knobsSaid) return;
    this.knobsSaid = said;
    this.voice.port.postMessage(params satisfies AcidMsg);
  }

  /** the page can run its 303 now (or the channel wants it now): made ahead of the first note, which a voice takes a moment to be ready for */
  ready() {
    if (this.wantsVoice) this.acidVoice();
  }

  /** the 303 of this channel, made the first time it is wanted; null where there is no worklet to run it in */
  private acidVoice(): AudioWorkletNode | null {
    if (this.voice) return this.voice;
    if (!acidReady.has(this.ac)) return null;
    const node = new AudioWorkletNode(this.ac, 'acid', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.connect(this.bus);
    this.voice = node;
    this.tellKnobs();
    return node;
  }

  /**
   * A note of the 303, at context time `when`: the note (midi), how loud, whether it is an
   * accent, and how far to either side. One held while this starts makes it a slide: it glides
   * there, and the end that was set for the one before is called off. False where there is
   * no 303 to play it.
   */
  note(when: number, midi: number, gain: number, accent: boolean, pan: number): boolean {
    const node = this.acidVoice();
    if (!node) return false;
    const gen = ++this.gen;
    node.port.postMessage({ type: 'on', t: when, note: midi, gain: gain * ACID_LEVEL, accent, slide: when < this.gateEnd, pan, gen } satisfies AcidMsg);
    this.gateEnd = when + ACID_GATE;
    node.port.postMessage({ type: 'off', t: this.gateEnd, gen } satisfies AcidMsg);
    return true;
  }

  /** the pendulum is gone: what was in it dies where it is (the echo's loop cut, so it does not ring on unheard) */
  dispose() {
    window.clearTimeout(this.resting);
    this.send.gain.value = 0;
    this.again.gain.value = 0;
    this.lfo.stop();
    this.voice?.disconnect();
    this.out.disconnect();
  }
}

/** the contexts that have the 303's worklet loaded: a page without one (plain http) runs the old square voice */
const acidReady = new WeakSet<BaseAudioContext>();

export class Sound {
  readonly ac: AudioContext;
  /** everything's way out: shut by the sound being off */
  private master: GainNode;
  /** a channel a pendulum, made when first asked for */
  private strips: Strip[] = [];
  private noise: AudioBuffer;
  /** context time minus performance time, for what is heard now */
  private off = NaN;
  /** seconds between a sound being started and being heard */
  latency = 0;
  /** for the dev console: how many hits, and how late the latest one had to start (seconds, 0 is on time) */
  stats = { hits: 0, late: 0, lead: 0 };
  /** how far into the bar (in bars) it is at a time on the page's clock, seconds: what the tremolos are locked to */
  bar: ((t: number) => number) | null = null;
  private relocking = false;

  constructor() {
    const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = (this.ac = new AC({ latencyHint: 'interactive' }));
    this.master = ac.createGain();
    this.master.connect(ac.destination);
    this.strip(0);
    // the 303's worklet: a moment to load (its first note may be the old voice's), and not at all on a page that cannot
    ac.audioWorklet?.addModule(acidUrl).then(
      () => {
        acidReady.add(ac);
        for (const strip of this.strips) strip.ready();
      },
      () => {},
    );

    // a second of it: the short knocks take a sliver, the snare and the clap loop it without it being heard as a loop
    this.noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  get running() {
    return this.ac.state === 'running';
  }

  set muted(m: boolean) {
    this.master.gain.setTargetAtTime(m ? 0 : 1, this.ac.currentTime, 0.015);
  }

  private strip(i: number): Strip {
    while (this.strips.length <= i) this.strips.push(new Strip(this.ac, this.master));
    return this.strips[i];
  }

  /** the mix of pendulum i */
  set(i: number, mix: Mix) {
    this.strip(i).set(mix);
  }

  /** the bar has started over, or been held or let go: every tremolo is to be put in step with it again */
  relock() {
    this.relocking = true;
  }

  /** only n pendulums are left: the channels of the others go */
  keep(n: number) {
    while (this.strips.length > Math.max(1, n)) this.strips.pop()!.dispose();
  }

  /** Line the two clocks up. Once per scheduler tick: smoothed, so a jittery reading does not move the beat. */
  sync() {
    const ac = this.ac;
    const ts = ac.getOutputTimestamp?.();
    const latency = (ac.baseLatency || 0) + ((ac as unknown as { outputLatency?: number }).outputLatency || 0);
    const o =
      ts && ts.performanceTime && ts.contextTime
        ? ts.contextTime - ts.performanceTime / 1000
        : ac.currentTime - performance.now() / 1000 - latency;
    if (!Number.isFinite(this.off) || Math.abs(o - this.off) > 0.03) this.off = o;
    else this.off += (o - this.off) * 0.05;
    this.latency = Math.max(0, ac.currentTime - (performance.now() / 1000 + this.off));
    // the tremolos, in step with the bar: those that were put out of it, all of them when the bar moved, and every so often against drift
    const bar = this.bar;
    if (!bar) return;
    const at = ac.currentTime + 0.03;
    for (const strip of this.strips) {
      if (this.relocking || strip.unlocked || ac.currentTime - strip.lockedAt > TREM_RELOCK) strip.lock(at, bar(at - this.off));
    }
    this.relocking = false;
  }

  /**
   * A joint of pendulum `pen` crosses at performance time t (seconds), going dir, as hard as vel (0..1), and
   * sounds the note `midi` with the voice `hue` at vol (0..1), on `instrument` (each pendulum has its own). Tick and tock are the same
   * note: the way it goes is only which side it is heard on.
   *
   * What is struck is the instrument (INSTRUMENTS, above). The tine: the note as a sine that
   * rings on long enough to be heard as a note (longer the lower it is), one pure overtone
   * over it that dies sooner, a click for the strike. The pitch does not move, but for the
   * very lowest, which get a thump.
   */
  hit(pen: number, instrument: string, hue: number, dir: number, vel: number, t: number, vol: number, midi: number, step: number) {
    const ac = this.ac;
    if (!this.running || !Number.isFinite(this.off) || !(vol > 0)) return;
    const chan = this.strip(pen);
    const harm = chan.harm;
    const when = Math.max(ac.currentTime + 0.002, t + this.off);
    this.stats = { hits: this.stats.hits + 1, late: when - (t + this.off), lead: when - ac.currentTime };
    const f = hertz(midi);
    const which = hue % TIMBRES.length;
    const v = TIMBRES[which];
    // how hard, as a level: its volume, and how fast it crossed
    const fast = 0.18 + 0.82 * Math.pow(vel, 1.6);
    const dyn = vol * vol * (EVEN + (fast - EVEN) * chan.touch);
    // and a note's own loudness: low ones need more of it to be heard as loud
    const loud = Math.min(1, Math.pow(55 / f, 0.42)) * dyn;

    // the 303 plays its own notes, in the worklet; where there is none, the square voice below
    if (instrument === '303' && chan.note(when, midi, dyn, vel >= 0.75, dir * Math.min(0.25, f / 1200))) return;

    const pan = ac.createStereoPanner();
    pan.pan.value = dir * Math.min(0.25, f / 1200);
    pan.connect(chan.bus);

    const ring = (freq: number, from: number, amp: number, long: number) => {
      const o = ac.createOscillator();
      o.frequency.setValueAtTime(freq * from, when);
      if (from !== 1) o.frequency.exponentialRampToValueAtTime(freq, when + 0.03);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(amp, when + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, when + long);
      o.connect(g).connect(pan);
      o.start(when);
      o.stop(when + long + 0.02);
    };
    /** the strike: a burst of noise through a filter, `long` seconds */
    const knock = (type: BiquadFilterType, freq: number, amp: number, long: number, q = 0.7) => {
      const n = ac.createBufferSource();
      n.buffer = this.noise;
      const band = ac.createBiquadFilter();
      band.type = type;
      band.frequency.value = freq;
      band.Q.value = q;
      const g = ac.createGain();
      g.gain.setValueAtTime(amp, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + long);
      n.connect(band).connect(g).connect(pan);
      n.start(when);
      n.stop(when + Math.min(0.045, long + 0.01));
    };

    if (instrument === '808') {
      this.drum(KIT[step % KIT.length], when, 0.9 * dyn, vel, pan, harm);
      return;
    }

    if (instrument === 'chatter') {
      this.say(which, when, f, dir, vel, loud, pan, harm);
      return;
    }

    if (instrument === 'bones') {
      // A drum: two bones knocked together, and what that sounds like is a soft rimshot. A
      // round knock with some tone in it, a tenth of a second of it, not a tune: there are
      // eight pairs of bones, a pair a note down the ruler, round and round, as the drum
      // machine has its sounds. The way it crosses is which way they knock: tick a little
      // higher than tock.
      const bone = BONES[step % BONES.length] * (dir > 0 ? 1 : 0.89);
      // a small pair is no quieter than a big one
      const level = 0.6 * dyn * Math.pow(320 / bone, 0.2);
      const hard = 0.4 + 0.6 * vel;
      // The weight of it is the thud: low, the hand and the hollow, a twelfth of a second.
      ring(bone / 2.2, 1.35, level * 1.1, 0.085);
      // The tone is only a trace over that: half of what it was, starting a little sharp as
      // anything struck does, and down in a moment.
      ring(bone, 1.12, level * 0.5, 0.075 + 0.025 * vel);
      // what rings with it, as on a rim: no notes over the tone (1.59 and 2.3 times it), and shorter
      ring(bone * 1.59, 1, level * 0.25 * (0.5 + 0.5 * harm), 0.055);
      if (harm > 0) ring(bone * 2.3, 1, level * 0.14 * harm * hard, 0.035);
      // the knock itself: soft and dull, wood, no hiss (a Burial rim, not a studio one)
      knock('bandpass', 1100 + 90 * which, level * 0.9 * hard, 0.016, 1.2);
      return;
    }

    if (instrument === '303') {
      const dur = Math.min(0.7, Math.max(0.15, 0.4 * Math.sqrt(220 / f)));
      const level = loud * 0.3;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2 + (which % 4) * 1.5;
      // the hit opens it, as far as it is hard (and as harmonics says); then it closes on the note
      const open = Math.min(9000, f * (2 + 14 * vel * harm));
      filter.frequency.setValueAtTime(open, when);
      filter.frequency.exponentialRampToValueAtTime(Math.max(120, f * 1.2), when + dur * 0.7);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(level, when + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      filter.connect(g).connect(pan);
      for (const cents of [-4.5, 4.5]) {
        const o = ac.createOscillator();
        o.type = 'square';
        o.frequency.value = f * Math.pow(2, cents / 1200);
        o.connect(filter);
        o.start(when);
        o.stop(when + dur + 0.02);
      }
      // a sine an octave under, for the body a square has none of
      ring(f / 2, 1, level * 1.4, dur * 0.8);
      return;
    }

    const dur = Math.min(1, Math.max(0.2, 0.6 * Math.sqrt(220 / f)));
    ring(f, f < 120 ? 1 + ((120 - f) / 120) * 1.2 : 1, loud, dur);
    // harder is brighter, not only louder
    if (harm > 0) ring(f * v.over, 1, loud * v.bright * harm * (0.3 + 0.7 * vel), dur * 0.45);
    // what a small speaker cannot play, an octave up
    if (f < 110) ring(f * 2, 1, loud * 0.45, dur * 0.7);
    knock('highpass', 1800 + 400 * which, loud * v.click * vel, 0.014);
  }

  /** the syllable each link said last, so that the next is another */
  private last: number[] = [];

  /**
   * One syllable of the chatter, on the note f, at `when`: one of the four of the link's vein
   * (VEINS), at random. The voice is a buzz (a sawtooth, and a breath of noise in it) through
   * three formants side by side, and those are the vowel. Before it the consonant: the formants
   * start where it puts them and slide to the vowel's, after a gap and a burst of noise if it
   * has them. The pitch slides onto the note as speech does, tick from under it, tock from over.
   */
  private say(which: number, when: number, f: number, dir: number, vel: number, loud: number, out: AudioNode, harm: number) {
    const ac = this.ac;
    const vein = VEINS[which % VEINS.length];
    const n = vein.says.length;
    const k = ((this.last[which] ?? 0) + 1 + Math.floor(Math.random() * (n - 1))) % n;
    this.last[which] = k;
    const word = vein.says[k];
    const c = CONSONANTS[word[0]];
    const vowel = VOWELS[word[1]];
    // a higher note is a smaller mouth, a little: chatter, not a chipmunk
    const mouth = vein.mouth * Math.pow(Math.max(1, f / 220), 0.12);
    const on = when + c.gap;
    const dur = Math.min(0.3, Math.max(0.13, 0.22 * Math.pow(220 / f, 0.2)));
    const end = on + dur;
    const level = loud * CHAT_LEVEL;
    // a hum holds the mouth shut a moment before it opens; an l slides slower
    const shut = c.hum ? 0.045 : 0;
    const slide = word[0] === 'l' ? 0.07 : 0.045;

    // the mouth: three formants side by side, wider for a high voice (whose harmonics are far apart)
    const mouthIn = ac.createGain();
    const wide = [80, 100, 140];
    const gains = [1, 0.55 * (0.5 + 0.5 * harm), 0.3 * harm * (0.4 + 0.6 * vel)];
    const from = [c.f1, c.f2, vowel[2]];
    for (let i = 0; i < 3; i++) {
      const band = ac.createBiquadFilter();
      band.type = 'bandpass';
      const to = vowel[i] * mouth;
      band.Q.value = to / Math.max(wide[i], f * 0.5);
      band.frequency.setValueAtTime(from[i] * mouth, when);
      band.frequency.setValueAtTime(from[i] * mouth, on + shut);
      band.frequency.exponentialRampToValueAtTime(to, on + shut + slide);
      const g = ac.createGain();
      g.gain.setValueAtTime(c.hum && i > 0 ? 0.06 * gains[i] : gains[i], when);
      if (c.hum && i > 0) {
        g.gain.setValueAtTime(0.06 * gains[i], on + shut);
        g.gain.linearRampToValueAtTime(gains[i], on + shut + 0.03);
      }
      mouthIn.connect(band).connect(g).connect(out);
    }

    // the voice
    const buzz = ac.createOscillator();
    buzz.type = 'sawtooth';
    buzz.frequency.setValueAtTime(f * Math.pow(2, (dir > 0 ? -1.5 : 1.5) / 12), on);
    buzz.frequency.exponentialRampToValueAtTime(f, on + 0.07);
    const voice = ac.createGain();
    voice.gain.setValueAtTime(0, on);
    voice.gain.linearRampToValueAtTime(level * (c.hum ? 0.6 : 1), on + (c.hum ? 0.02 : 0.01));
    voice.gain.linearRampToValueAtTime(level, on + shut + 0.03);
    voice.gain.setValueAtTime(level, on + dur * 0.4);
    voice.gain.exponentialRampToValueAtTime(0.0001, end);
    buzz.connect(voice).connect(mouthIn);
    buzz.start(on);
    buzz.stop(end + 0.03);

    // the breath: through the mouth too, a puff of it before the vowel after a k, t or p
    const breath = ac.createBufferSource();
    breath.buffer = this.noise;
    const air = ac.createGain();
    const puff = c.gap > 0.02 && !c.hiss;
    air.gain.setValueAtTime(0, when);
    if (puff) {
      air.gain.linearRampToValueAtTime(level * 0.9, when + 0.01);
      air.gain.setValueAtTime(level * 0.9, on);
    }
    air.gain.linearRampToValueAtTime(level * 0.05, on + 0.02);
    air.gain.exponentialRampToValueAtTime(0.0001, end);
    breath.connect(air).connect(mouthIn);
    breath.start(when);
    breath.stop(end + 0.03);

    // the consonant's own noise: a burst at the lips or the teeth, or a hiss
    if (c.noise) {
      const [freq, long, amp] = c.noise;
      const src = ac.createBufferSource();
      src.buffer = this.noise;
      const band = ac.createBiquadFilter();
      band.type = c.hiss ? 'highpass' : 'bandpass';
      band.frequency.value = freq * mouth;
      band.Q.value = c.hiss ? 0.7 : 1.4;
      const g = ac.createGain();
      const peak = amp * level * (0.6 + 0.4 * vel);
      if (c.hiss) {
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(peak, when + long * 0.5);
        g.gain.linearRampToValueAtTime(0, when + long);
      } else {
        g.gain.setValueAtTime(peak, when);
        g.gain.exponentialRampToValueAtTime(0.0001, when + long);
      }
      src.connect(band).connect(g).connect(out);
      src.start(when);
      src.stop(when + long + 0.02);
    }
  }

  /** one of the drum machine's sounds, at `when`, as loud as `level`, as hard as `vel`, into `out` */
  private drum(kind: string, when: number, level: number, vel: number, out: AudioNode, harmonics: number) {
    const ac = this.ac;
    const bright = 0.5 + 0.5 * harmonics;
    /** an oscillator that falls from `from` times its pitch, and dies in `long` */
    const tone = (type: OscillatorType, freq: number, from: number, fall: number, amp: number, long: number, to: AudioNode = out) => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq * from, when);
      if (from !== 1) o.frequency.exponentialRampToValueAtTime(freq, when + fall);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(amp, when + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, when + long);
      o.connect(g).connect(to);
      o.start(when);
      o.stop(when + long + 0.02);
    };
    /** noise through a filter, from `at`, dying in `long` (looped: the buffer is short) */
    const hiss = (type: BiquadFilterType, freq: number, q: number, amp: number, long: number, at = when) => {
      const n = ac.createBufferSource();
      n.buffer = this.noise;
      n.loop = true;
      const f = ac.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ac.createGain();
      g.gain.setValueAtTime(amp, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + long);
      n.connect(f).connect(g).connect(out);
      n.start(at);
      n.stop(at + long + 0.02);
    };
    /** the machine's metal: six squares at frequencies that share nothing, through a high band */
    const metal = (amp: number, long: number) => {
      const band = ac.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 10000;
      band.Q.value = 0.6;
      const high = ac.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 7000;
      const g = ac.createGain();
      g.gain.setValueAtTime(amp, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + long);
      band.connect(high).connect(g).connect(out);
      for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) {
        const o = ac.createOscillator();
        o.type = 'square';
        o.frequency.value = f * 4;
        o.connect(band);
        o.start(when);
        o.stop(when + long + 0.02);
      }
    };

    switch (kind) {
      case 'BD':
        tone('sine', 48, 3.2, 0.06, level * 1.1, 0.5 + 0.25 * vel);
        hiss('lowpass', 1200, 0.7, level * 0.25 * vel, 0.01);
        break;
      case 'SD':
        tone('sine', 185, 1.4, 0.02, level * 0.55, 0.14);
        tone('sine', 330, 1.2, 0.02, level * 0.3, 0.09);
        hiss('highpass', 1400, 0.7, level * 0.55 * bright, 0.17 + 0.06 * vel);
        break;
      case 'LT':
        tone('sine', 96, 1.9, 0.05, level * 0.95, 0.32);
        hiss('lowpass', 900, 0.7, level * 0.12, 0.03);
        break;
      case 'RS':
        tone('triangle', 455, 1, 0, level * 0.55, 0.035);
        tone('triangle', 1667, 1, 0, level * 0.45, 0.02);
        hiss('highpass', 2500, 0.7, level * 0.3 * bright, 0.012);
        break;
      case 'CP':
        // three hands a hundredth of a second apart, then the room
        for (const late of [0, 0.011, 0.022]) hiss('bandpass', 1150, 1.6, level * 2.4, 0.012, when + late);
        hiss('bandpass', 1150, 1.2, level * 2 * bright, 0.2, when + 0.03);
        break;
      case 'CH':
        metal(level * 0.4 * bright, 0.05);
        break;
      case 'OH':
        metal(level * 0.36 * bright, 0.38);
        break;
      default: {
        // CB: two squares, the cowbell's fifth that is not one, through its own band
        const band = ac.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 2640;
        band.Q.value = 1;
        band.connect(out);
        tone('square', 540, 1, 0, level * 0.42, 0.32, band);
        tone('square', 800, 1, 0, level * 0.42, 0.32, band);
      }
    }
  }
}
