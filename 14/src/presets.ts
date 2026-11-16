// The characters of the wire. Each preset is a string (its partials and how they die), a
// body it rings in, a scale the pull snaps to, and what rings along with it. Everything a
// visitor can do lands on a note of the scale, and everything that rings along is tuned to the
// same scale: that is most of "it always sounds good". All of them low and in a sad mode.

export interface Preset {
  id: string;
  label: string;
  /** midi note of the open wire */
  root: number;
  /** semitones of the scale, one octave, from 0 */
  scale: number[];
  /** partial ratios; when absent, harmonic with stiffness `stiff` (f_k = k f0 sqrt(1 + B k²)) */
  ratios?: number[];
  /** a synthetic square: odd harmonics only, 1/k, the same wherever it's taken */
  odd?: boolean;
  /** through a fuzz and a speaker cabinet, 0..1 (the doom one) */
  fuzz?: number;
  stiff: number;
  /** seconds for the fundamental to fall 60 dB, and for a partial at 3 kHz */
  t60: number;
  t60hi: number;
  /** extra tilt on the partials, 0 = a bare string (1/k), 1 = a dark one, below 0 brighter */
  tilt: number;
  /** the wire buzzing against something (jawari, a loose coin): amount and how early it starts */
  buzz: number;
  /** the gap it buzzes across, against the size of the first swing: small = buzzes longer */
  gap: number;
  /** how far the pitch starts sharp after a hard pull, as a ratio (tension modulation) */
  glide: number;
  /** cents between the wire's two copies (they beat, and spread left and right) */
  detune: number;
  /** a sine an octave under the note, against the wire, dying faster */
  sub: number;
  /** the body: two low resonances, [Hz, dB] each */
  body: [number, number, number, number];
  /** sympathetic strings: how strongly they hear the wire, and what they are tuned to */
  sym: number;
  symNotes: number[];
  /** the room: reverb send, and how long its tail is (seconds) */
  wet: number;
  room: number;
  /** a warm low pass on everything (Hz) */
  lp: number;
  /**
   * the pad under it all: level, low pass cut-off (Hz), wave, its register above the root
   * (semitones), and whether it follows the note played or stays on the tonic (a drone)
   */
  pad: { level: number; cutoff: number; wave: 'sawtooth' | 'triangle'; oct: number; follow: boolean };
}

export const PRESETS: Preset[] = [
  {
    // the first, the dark one: a long low steel wire (A1) in a big wooden room, a sad
    // pentatonic (1 2 b3 5 b6), a dark pad following the note
    id: 'tension', label: 'Tension',
    root: 33, scale: [0, 2, 3, 7, 8],
    stiff: 0.00012, t60: 9, t60hi: 1.6, tilt: -0.25,
    buzz: 0.12, gap: 0.8, glide: 0.014,
    detune: 4, sub: 0.35, body: [98, 5, 210, 3],
    sym: 0.5, symNotes: [0, 7, 12, 15, 19, 20, 24],
    wet: 0.42, room: 5.5, lp: 5200,
    pad: { level: 0.6, cutoff: 650, wave: 'sawtooth', oct: 12, follow: true },
  },
  {
    // luminous: a bell's partials (not harmonic, every one a consonant interval), high (A3),
    // an airy triangle pad up top and a long bright hall
    id: 'glass', label: 'Glass',
    root: 57, scale: [0, 2, 4, 7, 9],
    ratios: [1, 2, 2.4, 3, 4, 5.04, 6, 8, 9.6, 12],
    stiff: 0, t60: 10, t60hi: 3.5, tilt: -0.1,
    buzz: 0, gap: 1, glide: 0.002,
    detune: 6, sub: 0, body: [180, 1, 420, 1.5],
    sym: 0.35, symNotes: [0, 7, 12, 16, 19, 24],
    wet: 0.62, room: 6.5, lp: 8500,
    pad: { level: 0.35, cutoff: 1500, wave: 'triangle', oct: 12, follow: true },
  },
  {
    // warm and woody: gut, plucked with a finger (A2), a round body that rings at 140 and
    // 320 Hz, a small room, a soft pad close in
    id: 'wood', label: 'Wood',
    root: 45, scale: [0, 2, 3, 7, 9],
    stiff: 0.00003, t60: 5, t60hi: 0.8, tilt: 0.25,
    buzz: 0, gap: 1, glide: 0.005,
    detune: 2.5, sub: 0.25, body: [140, 6, 320, 4.5],
    sym: 0.35, symNotes: [0, 7, 12, 14, 19],
    wet: 0.28, room: 1.8, lp: 4200,
    pad: { level: 0.5, cutoff: 750, wave: 'triangle', oct: 12, follow: true },
  },
  {
    // synthetic: a square wave, odd harmonics only and the same wherever it's taken (no string
    // to pluck at a point), two copies wide apart, a sine an octave under. A soft pull is a
    // closed filter, a hard one opens it. A2, a mid room, a triangle pad
    id: 'square', label: 'Square',
    root: 45, scale: [0, 2, 3, 7, 8], odd: true,
    stiff: 0, t60: 4.5, t60hi: 0.9, tilt: 0.05,
    buzz: 0, gap: 1, glide: 0.004,
    detune: 9, sub: 0.4, body: [120, 0, 300, 0],
    sym: 0.3, symNotes: [0, 7, 12, 19],
    wet: 0.36, room: 3, lp: 4600,
    pad: { level: 0.45, cutoff: 700, wave: 'triangle', oct: 12, follow: true },
  },
  {
    // doom: a low guitar (A1) through a fuzz driven into a near square and a big closed
    // cabinet, every note held by the fuzz long after it'd have died, slow and heavy, a
    // cathedral of a room and a low saw pad that stays on the tonic (a drone). Slow on purpose:
    // pull hard and let it ring
    id: 'doom', label: 'Doom',
    root: 33, scale: [0, 2, 3, 7, 8], fuzz: 1,
    stiff: 0.00008, t60: 16, t60hi: 2.4, tilt: 0.1,
    buzz: 0, gap: 1, glide: 0.01,
    detune: 7, sub: 0.3, body: [90, 3, 220, 2],
    sym: 0.25, symNotes: [0, 7, 12, 19],
    wet: 0.55, room: 8, lp: 5000,
    pad: { level: 0.7, cutoff: 420, wave: 'sawtooth', oct: 0, follow: false },
  },
];

export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export interface Partials {
  freqs: number[];
  amps: number[];
  /** decay rates, 1/s (amplitude falls as e^(-σt)) */
  sigmas: number[];
  /** the mode index each partial belongs to (for the drawing: sin(kπu)) */
  modes: number[];
}

/** highest partial we ever let through: no harsh highs */
const FMAX = 7000;

/**
 * The partials of the wire set going at relative position p (0..1 along it) by a pluck (a
 * triangle let go: the bridge hears sin(kπp)/k) or a strike (the stick gives a velocity:
 * sin(kπp), soft at the top because a stick is not a point). Normalised to unit energy.
 *
 * `force` is how hard (0..1), and it is the spectrum as much as the level: a soft pull is dark
 * and round (the top rolls off from ~500 Hz and stops near 2.5 kHz), a hard one is bright and
 * reaches up to 7 kHz.
 */
/** how long everything rings: a factor on every string's ring time (the bar's sustain knob) */
export const ring = { sustain: 1 };

export function partialsFor(pr: Preset, f0: number, p: number, kind: 'pluck' | 'strike', force = 0.7, tiltAdd = 0, rollMul = 1): Partials {
  const out: Partials = { freqs: [], amps: [], sigmas: [], modes: [] };
  const s0 = 6.91 / (pr.t60 * ring.sustain);
  const sHi = 6.91 / (pr.t60hi * ring.sustain);
  const c2 = Math.max(0, (sHi - s0) / (3000 * 3000));
  const K = pr.ratios ? pr.ratios.length : 64;
  const fz = Math.max(0, Math.min(1, force));
  // where a finger's width (and a soft pull) starts rolling the top off, and the last partial
  const roll = (600 + 4400 * Math.pow(fz, 1.2)) * rollMul;
  // and the slope of the whole spectrum: soft leans dark, hard leans bright
  const tilt = pr.tilt + 0.8 * (0.55 - fz) + tiltAdd;
  const top = 2500 + (FMAX - 2500) * fz;
  p = Math.min(0.97, Math.max(0.03, p));
  for (let k = 1; k <= K; k++) {
    const ratio = pr.ratios ? pr.ratios[k - 1] : (k * Math.sqrt(1 + pr.stiff * k * k)) / Math.sqrt(1 + pr.stiff);
    const f = f0 * ratio;
    if (f > top) break;
    if (pr.odd && k % 2 === 0) continue;
    const sh = pr.odd ? 1 : Math.sin(k * Math.PI * p);
    let a = kind === 'pluck' ? sh / k : sh * Math.exp(-k / 12);
    a *= Math.pow(k, -tilt);
    a /= Math.sqrt(1 + (f / roll) ** 2);
    // the last stretch before the top fades out, so there's no edge
    if (f > top * 0.7) a *= 1 - ((f - top * 0.7) / (top * 0.3)) * 0.8;
    out.freqs.push(f);
    out.amps.push(a);
    out.sigmas.push(s0 + c2 * f * f);
    out.modes.push(k);
  }
  let e = 0;
  for (const a of out.amps) e += a * a;
  const n = e > 1e-12 ? 1 / Math.sqrt(e) : 0;
  for (let i = 0; i < out.amps.length; i++) out.amps[i] *= n;
  return out;
}

/**
 * One key for every string (A, in different octaves) and one scale for all of them, so
 * switching strings or scales while the pad, the groove and the tails ring never leaves
 * anything out of tune. Every scale keeps the root and the fifth (the pad leans
 * on them). The first is the sad one Tension was made in; it's the default (main.ts).
 */
/** `roots`: the dots' four chords, in semitones over the key (the first the scale has from each group), when not the usual i, VI, v, III */
export const SCALES: Array<{ id: string; label: string; notes: number[]; roots?: number[][] }> = [
  { id: 'tension', label: 'Tension', notes: [0, 2, 3, 7, 8] },
  { id: 'minor', label: 'Minor pent', notes: [0, 3, 5, 7, 10] },
  { id: 'kumoi', label: 'Kumoi', notes: [0, 2, 3, 7, 9] },
  { id: 'major', label: 'Major pent', notes: [0, 2, 4, 7, 9] },
  { id: 'aeolian', label: 'Aeolian', notes: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'hijaz', label: 'Hijaz', notes: [0, 1, 4, 5, 7, 8, 10] },
  // Aphex Twin's Avril 14th: natural minor, its three chords all minor (i, iv, v), and the VI
  // for a fourth; on A like everything else (the piece is in F minor)
  { id: 'avril', label: 'April', notes: [0, 2, 3, 5, 7, 8, 10], roots: [[0], [5], [7], [8]] },
];

const OWN = PRESETS.map((p) => ({ symNotes: p.symNotes }));

/** every string over scale `i`: the sympathetic strings keep only what fits */
export function applyScale(i: number) {
  const notes = SCALES[i].notes;
  PRESETS.forEach((p, j) => {
    p.scale = notes;
    p.symNotes = OWN[j].symNotes.filter((n) => notes.includes(pc(n)));
  });
}

/** the pitch class of midi `m` over `root`, 0..11 */
export const pc = (m: number, root = 0) => (((m - root) % 12) + 12) % 12;
/** is midi `m` a note of `p`'s scale */
export const inScale = (p: Preset, m: number) => p.scale.includes(pc(m, p.root));

/** the nearest note of `p`'s scale to `note` (midi, rounded first); a tie goes down, the sadder way */
export function snap(p: Preset, note: number) {
  const r = Math.round(note);
  for (let k = 0; k <= 6; k++) {
    for (const m of [r - k, r + k]) if (inScale(p, m)) return m;
  }
  return r;
}

applyScale(0);
