// The sound: a small struck voice per link, made of plain nodes (a sine, one pure overtone
// over it, a click of noise). The note is where the joint is when it hits, the bass at the
// root, on a scale; the link's own is the timbre.
// Hits are given in performance time and started on the audio clock, so the rhythm is as
// tight as the formula, whatever the frame rate does.

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
 * - square: electronic, as on day 14. Two square waves a few cents apart through a filter the
 *   hit opens and that closes again: harder is not louder so much as more open.
 * - 808: the drum machine. Not one sound tuned to the note but a sound a note (KIT, below):
 *   bass drum, rimshot, snare, hats, clap, tom, cowbell, each made the way the machine made
 *   it, near enough: a sine that falls for the drums, six squares that agree on nothing for
 *   the metal, noise through a band for the rest.
 */
export const INSTRUMENTS: Array<{ id: string; label: string }> = [
  { id: 'tine', label: 'Tine' },
  { id: 'bones', label: 'Bones' },
  { id: 'square', label: 'Square' },
  { id: '808', label: 'TR-808' },
];

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
/** the level at the top of the volume knob: 80 on it is 0.8, where it was before there was a knob */
const VOLUME_TOP = 0.8 / Math.pow(0.8, 1.5);

export class Sound {
  readonly ac: AudioContext;
  private bus: GainNode;
  private out: GainNode;
  private noise: AudioBuffer;
  /** context time minus performance time, for what is heard now */
  private off = NaN;
  /** seconds between a sound being started and being heard */
  latency = 0;
  private level = 0.8;
  private quiet = false;
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
  private harm = 1;
  private instrument = 'tine';
  /** the mix as it was last set, to know when there is nothing new */
  private said = '';
  /** for the dev console: how many hits, and how late the latest one had to start (seconds, 0 is on time) */
  stats = { hits: 0, late: 0, lead: 0 };

  constructor() {
    const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = (this.ac = new AC({ latencyHint: 'interactive' }));
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
    comp.connect(this.out).connect(ac.destination);

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

    // a second of it: the short knocks take a sliver, the snare and the clap loop it without it being heard as a loop
    this.noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  get running() {
    return this.ac.state === 'running';
  }

  set muted(m: boolean) {
    this.quiet = m;
    this.out.gain.setTargetAtTime(m ? 0 : this.level, this.ac.currentTime, 0.015);
  }

  /**
   * The mix: volume, distortion, reverb, room, damping, delay and harmonics, each 0..1, and the tempo the echo keeps (a
   * dotted eighth of it). Reverb is how much of what is heard is the room (at the top, only the room) and room its size; delay is how much goes into the echo and how
   * much of it comes round again; harmonics is the overtone over every note, none at 0, as
   * designed in the middle, twice at the top.
   */
  set(mix: { reverb: number; room: number; delay: number; harm: number; bpm: number; instrument: string; volume: number; dist: number; damp: number }) {
    // told again with nothing new (a track's knob being turned says so a hundred times a second): nothing to do
    const said = [mix.reverb, mix.room, mix.delay, mix.harm, mix.bpm, mix.instrument, mix.volume, mix.dist, mix.damp].join();
    if (said === this.said) return;
    this.said = said;
    this.instrument = mix.instrument;
    const now = this.ac.currentTime;
    // the volume of it all: 80 is where it was before there was a knob
    const level = VOLUME_TOP * Math.pow(mix.volume, 1.5);
    if (level !== this.level) {
      this.level = level;
      if (!this.quiet) this.out.gain.setTargetAtTime(level, now, 0.02);
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
    this.harm = 2 * mix.harm;
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
  }

  /**
   * A joint crosses at performance time t (seconds), going dir, as hard as vel (0..1), and
   * sounds the note `midi` with the voice `hue` at vol (0..1). Tick and tock are the same
   * note: the way it goes is only which side it is heard on.
   *
   * What is struck is the instrument (INSTRUMENTS, above). The tine: the note as a sine that
   * rings on long enough to be heard as a note (longer the lower it is), one pure overtone
   * over it that dies sooner, a click for the strike. The pitch does not move, but for the
   * very lowest, which get a thump.
   */
  hit(hue: number, dir: number, vel: number, t: number, vol: number, midi: number, step: number) {
    const ac = this.ac;
    if (!this.running || !Number.isFinite(this.off) || !(vol > 0)) return;
    const when = Math.max(ac.currentTime + 0.002, t + this.off);
    this.stats = { hits: this.stats.hits + 1, late: when - (t + this.off), lead: when - ac.currentTime };
    const f = hertz(midi);
    const which = hue % TIMBRES.length;
    const v = TIMBRES[which];
    // how hard, as a level: its volume, and how fast it crossed
    const dyn = vol * vol * (0.18 + 0.82 * Math.pow(vel, 1.6));
    // and a note's own loudness: low ones need more of it to be heard as loud
    const loud = Math.min(1, Math.pow(55 / f, 0.42)) * dyn;

    const pan = ac.createStereoPanner();
    pan.pan.value = dir * Math.min(0.25, f / 1200);
    pan.connect(this.bus);

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

    if (this.instrument === '808') {
      this.drum(KIT[step % KIT.length], when, 0.9 * dyn, vel, pan);
      return;
    }

    if (this.instrument === 'bones') {
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
      ring(bone * 1.59, 1, level * 0.25 * (0.5 + 0.5 * this.harm), 0.055);
      if (this.harm > 0) ring(bone * 2.3, 1, level * 0.14 * this.harm * hard, 0.035);
      // the knock itself: soft and dull, wood, no hiss (a Burial rim, not a studio one)
      knock('bandpass', 1100 + 90 * which, level * 0.9 * hard, 0.016, 1.2);
      return;
    }

    if (this.instrument === 'square') {
      const dur = Math.min(0.7, Math.max(0.15, 0.4 * Math.sqrt(220 / f)));
      const level = loud * 0.3;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2 + (which % 4) * 1.5;
      // the hit opens it, as far as it is hard (and as harmonics says); then it closes on the note
      const open = Math.min(9000, f * (2 + 14 * vel * this.harm));
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
    if (this.harm > 0) ring(f * v.over, 1, loud * v.bright * this.harm * (0.3 + 0.7 * vel), dur * 0.45);
    // what a small speaker cannot play, an octave up
    if (f < 110) ring(f * 2, 1, loud * 0.45, dur * 0.7);
    knock('highpass', 1800 + 400 * which, loud * v.click * vel, 0.014);
  }

  /** one of the drum machine's sounds, at `when`, as loud as `level`, as hard as `vel`, into `out` */
  private drum(kind: string, when: number, level: number, vel: number, out: AudioNode) {
    const ac = this.ac;
    const bright = 0.5 + 0.5 * this.harm;
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
