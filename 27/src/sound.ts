// The sound of day 27: what the burrow is like to the ear. A small WebAudio engine. A browser plays nothing before
// a press, so it starts on the first one (or the first key); it sleeps while the tab is hidden; ?mute leaves it out.
//
// Two kinds of sound, and they are kept apart on purpose:
// - Texture is sampled. Nine short takes made with ElevenLabs' sound effects model live in public/audio (the README
//   has the prompt of each): the meadow outside, the room inside, our own breath, the breath of the other lodger, a
//   paw on packed earth, dirt coming down, pebbles, a drip, a splash. A take is never played the same way twice: a slice of it, at its own pitch.
// - What answers us is synthesised from two oscillators' worth of parts: the weight of each paw, the heart, the drone
//   and the slow pulse of the thing as it nears, its lunge and its jaws, the torch's tired electronics, the wind at
//   the mouth. Every sample has a synthetic stand-in as well, so a file that is missing costs texture and nothing else.
//
// main.ts hands over the live objects once (bind) and then calls update(dt) at the end of every frame; step, crumble
// and stone are the three things that happen at a moment. Nothing is allocated per frame: update only reads numbers
// and moves AudioParams, and at a third of the frame rate at that.
//
// The place itself is one short convolver: a third of a second of noise that goes dull as it dies, behind a handful of
// reflections a few milliseconds out, which is what walls an arm's length away do. Dry, close, and gone outside.

type V3 = { x: number; y: number; z: number };
type Q4 = V3 & { w: number };

/** What the engine reads, every frame, from the scene. All of it exists in main.ts already. */
export interface SoundScene {
  /** how fast we are going (m/s), whether we are in the hole yet, and where we are on the rails */
  nav: { v: number; entered: boolean; e: number; s: number };
  /** the speed of a full run, m/s */
  speed: number;
  camPos: V3;
  camQ: Q4;
  /** the other lodger (beast.ts): what it is doing, where it is, and what it does to us */
  beast: {
    state: string; group: { position: V3; visible: boolean }; shake: number; lamp: number; fall: number;
    /** it has had us: black, until it all begins again; and for how long so far, seconds */
    dead?: boolean; deadFor?: number;
    /** its egg has been taken */
    angry?: boolean;
    /** how far it is from us through the tunnels, metres: three metres of earth is not three of air */
    tunnelDistance?(where: { e: number; s: number }): number;
  };
  /** the game: we have the egg; we are out with it, and that is the end */
  game?: { carrying: boolean; won: boolean };
  /** the torch: 1 as it should be, sagging and stuttering now and then, 0 when it is out */
  light: { value: number };
  /** how much our running shivers the water */
  ripple: { value: number };
  /** where the hole is */
  mouth: V3;
  puddles: { x: number; y: number; z: number; r: number }[];
}

const MUTE = new URLSearchParams(location.search).has('mute');
const NAMES = ['outside', 'room', 'breath', 'presence', 'steps', 'dirt', 'pebbles', 'drip', 'splash'] as const;
type Name = (typeof NAMES)[number];

/**
 * How loud each thing is. Guesses, every one: set by reading meters, not by ear. They can be turned while it runs
 * from the console (burrowSound.mix.breath = 0.5).
 */
const MIX = {
  master: 0.8, verb: 0.8,
  outside: 0.8, room: 0.15, wind: 0.2, ambient: 0.9,
  breath: 0.12, gasp: 0.12, heart: 0.16,
  steps: 0.45, dirt: 0.7, stone: 0.9, water: 0.55,
  presence: 0.6, drone: 0.25, beast: 0.9,
  torch: 0.5,
};

/** where the single paws are in steps.mp3: start, length (s), and what brings each up to the level of the others */
const STEPS = [0.7, 0.36, 0.8, 2.0, 0.48, 2.6, 3.88, 0.46, 1.5, 5.14, 0.44, 1.25];
/** and the single stones in pebbles.mp3: start, length */
const STONES = [0.56, 0.36, 0.95, 0.45, 1.48, 0.55, 2.4, 0.22];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const rnd = Math.random;

/** the tunnel: packed earth an arm's length away on every side. Short, and the top of it goes first */
function tunnel(ac: BaseAudioContext): AudioBuffer {
  const sr = ac.sampleRate, n = Math.floor(sr * 0.32);
  const buf = ac.createBuffer(2, n, sr);
  // the walls, by how long the sound takes there and back: never the same for the two ears
  const walls = [[0.0017, 0.0031, 0.0046, 0.0068, 0.0093], [0.0021, 0.0035, 0.0052, 0.0074, 0.0101]];
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      lp += (rnd() * 2 - 1 - lp) * (0.55 * Math.exp(-t / 0.05) + 0.06);
      d[i] = lp * Math.exp(-t / 0.046) * Math.min(1, t / 0.004);
    }
    for (let k = 0; k < walls[c].length; k++) d[Math.floor(walls[c][k] * sr)] += (k % 2 ? -0.9 : 0.9) * Math.pow(0.72, k);
  }
  return buf;
}

/**
 * A take made into a loop with no seam: an mp3 decodes with a little silence at either end, so that is cut off, and
 * the end is folded over the start.
 */
function loopOf(ac: BaseAudioContext, src: AudioBuffer, fade: number): AudioBuffer {
  const sr = src.sampleRate, cut = Math.floor(0.04 * sr);
  const n = src.length - 2 * cut, f = Math.min(Math.floor(fade * sr), n >> 2), m = n - f;
  const out = ac.createBuffer(src.numberOfChannels, m, sr);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const a = src.getChannelData(c), d = out.getChannelData(c);
    for (let i = 0; i < m; i++) {
      if (i >= f) { d[i] = a[cut + i]; continue; }
      const k = (i / f) * Math.PI * 0.5;
      d[i] = a[cut + i] * Math.sin(k) + a[cut + m + i] * Math.cos(k);
    }
  }
  return out;
}

class Sound {
  /** the levels, for turning from the console */
  mix = MIX;
  /** the samples that could not be had: those sounds are synthesised */
  missing: string[] = [];
  /** the samples are in (or given up on) */
  loaded = false;

  private ac: AudioContext | null = null;
  private scene: SoundScene | null = null;
  private dead = false;
  private raw: Promise<(ArrayBuffer | null)[]> | null = null;
  private buf: Partial<Record<Name, AudioBuffer>> = {};
  private noise!: AudioBuffer;
  private scope = new Float32Array(1024);
  /** one-shots sounding now: past a certain number no more are started */
  private live = 0;

  // the way out: everything of the place goes through `world` (shut while the torch is out); our own body and the
  // torch go round it
  private out!: GainNode;
  private pre!: GainNode;
  private world!: GainNode;
  /** what is near, a little of it into the tunnel; what is further off, dulled, and more of it */
  private fx!: GainNode;
  private far!: GainNode;
  private ret!: GainNode;
  private meter!: AnalyserNode;

  private roomG!: GainNode;
  private windG!: GainNode;
  private windLP!: BiquadFilterNode;
  private breathG!: GainNode;
  private breathSrc: AudioBufferSourceNode | null = null;
  private breathBP: BiquadFilterNode | null = null;
  private heartOsc!: OscillatorNode;
  private heartEnv!: GainNode;
  private heartG!: GainNode;
  private whine!: OscillatorNode;
  private whineG!: GainNode;
  private presSrc: AudioBufferSourceNode | null = null;
  private presLP!: BiquadFilterNode;
  private presG!: GainNode;
  private presPan: StereoPannerNode | null = null;
  private droneG!: GainNode;

  // where a thing is to the ears: set by place()
  private pan = 0;
  private att = 1;
  private dist = 0;
  private front = 1;

  // what is remembered from frame to frame
  private acc = 0;
  private clock = 0;
  private open = 1;
  private effort = 0;
  private fear = 0;
  private hold = 0;
  private dark = false;
  private sighted = false;
  private was = 'away';
  private shook = 0;
  private lit = -1;
  private pres = 0;
  private pulse = 0;
  private gust = 0;
  private breathPhase = 0;
  private nextBeat = 0;
  private nextAmbient = 3;
  private nextDrip = 2;
  private nextScrape = 0;
  private lastStep = -1;
  private lastPaw = -1;
  private lastStone = -1;
  private lastDirt = 0;
  private lastRock = 0;
  private lastTick = 0;
  private bx = 0;
  private bz = 0;
  private unseen = 0;
  private td = Infinity;
  private tdTick = 0;
  private outG!: GainNode;
  private outLP!: BiquadFilterNode;
  private lampWas = 1;
  private ended = false;

  constructor() {
    if (MUTE) return;
    // the samples are fetched straight away and decoded once there is a context to decode them
    this.raw = Promise.all(
      NAMES.map((n) =>
        fetch(`${import.meta.env.BASE_URL}audio/${n}.mp3`)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null),
      ),
    );
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchend']) window.addEventListener(ev, this.unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ac) return;
      if (document.hidden) this.ac.suspend().catch(() => {});
      else this.ac.resume().catch(() => {});
    });
  }

  /** the live objects of the scene, once */
  bind(scene: SoundScene) {
    this.scene = scene;
  }

  /** 'muted', 'waiting' (no press yet), or the context's own state */
  get state(): string {
    return MUTE ? 'muted' : this.ac ? this.ac.state : 'waiting';
  }

  /** what is going out now, RMS, after the limiter: for the console and for checks */
  level(): number {
    if (!this.ac) return 0;
    this.meter.getFloatTimeDomainData(this.scope);
    let s = 0;
    for (let i = 0; i < this.scope.length; i++) s += this.scope[i] * this.scope[i];
    return Math.sqrt(s / this.scope.length);
  }

  private unlock = () => {
    if (this.dead) return;
    if (!this.ac) {
      try {
        this.build();
      } catch (err) {
        this.dead = true;
        console.warn('sound: no audio here', err);
        return;
      }
    }
    const ac = this.ac!;
    if (ac.state !== 'running' && !document.hidden) ac.resume().catch(() => {});
  };

  // ---- the graph ----

  private build() {
    const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC({ latencyHint: 'interactive' });
    const gain = (v: number, to?: AudioNode) => {
      const g = ac.createGain();
      g.gain.value = v;
      if (to) g.connect(to);
      return g;
    };
    const filter = (type: BiquadFilterType, f: number, q: number, to: AudioNode) => {
      const b = ac.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      b.connect(to);
      return b;
    };

    // a gentle limiter last of all: the jaws are far louder than the rest. (A compressor makes up its own gain, some
    // 5 dB at these settings: `master` allows for it.) The whole thing fades up, it does not start with a bang
    this.out = gain(0, ac.destination);
    this.out.gain.setTargetAtTime(MIX.master, ac.currentTime, 0.5);
    const lim = ac.createDynamicsCompressor();
    lim.threshold.value = -10;
    lim.knee.value = 8;
    lim.ratio.value = 12;
    lim.attack.value = 0.004;
    lim.release.value = 0.2;
    lim.connect(this.out);
    this.meter = ac.createAnalyser();
    this.meter.fftSize = 1024;
    lim.connect(this.meter);
    this.pre = gain(1, lim);
    this.world = gain(1, this.pre);

    // the tunnel
    this.ret = gain(0, this.world);
    const conv = ac.createConvolver();
    conv.buffer = tunnel(ac);
    conv.connect(filter('lowpass', 2600, 0.5, this.ret));
    const send = gain(1, conv);
    this.fx = gain(1, this.world);
    const fxSend = gain(0.3, send);
    this.fx.connect(fxSend);
    const farLP = filter('lowpass', 2400, 0.5, this.world);
    this.far = gain(1, farLP);
    const farSend = gain(0.85, send);
    this.far.connect(farSend);

    // three seconds of noise, for everything that hisses
    this.noise = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;

    // the beds: the room (when it has loaded), the wind over the hole
    this.roomG = gain(0, this.world);
    this.outG = gain(0, this.world);
    this.outLP = filter('lowpass', 16000, 0.5, this.outG);
    this.windG = gain(0, this.world);
    this.windLP = filter('lowpass', 500, 0.4, this.windG);
    this.loop(ac, this.noise, this.windLP);

    // us: the breath (when it has loaded) and the heart, a low triangle that is struck twice a beat
    this.breathG = gain(0, this.pre);
    this.heartG = gain(0, this.pre);
    this.heartEnv = gain(0, filter('lowpass', 170, 0.5, this.heartG));
    this.heartOsc = ac.createOscillator();
    this.heartOsc.type = 'triangle';
    this.heartOsc.frequency.value = 50;
    this.heartOsc.connect(this.heartEnv);
    this.heartOsc.start();

    // the torch: a thin whine that is only there while its cells sag
    this.whineG = gain(0, this.pre);
    this.whine = ac.createOscillator();
    this.whine.frequency.value = 3400;
    this.whine.connect(this.whineG);
    this.whine.start();

    // the other lodger: its breath (when it has loaded) through a filter that opens as it nears, over a drone of two
    // low voices a hair apart, all of it on one panner so that it is somewhere
    let to: AudioNode = this.far;
    if (ac.createStereoPanner) {
      this.presPan = ac.createStereoPanner();
      this.presPan.connect(this.far);
      to = this.presPan;
    }
    this.presG = gain(0, to);
    this.presLP = filter('lowpass', 200, 0.7, this.presG);
    this.droneG = gain(0, to);
    const droneLP = filter('lowpass', 170, 0.8, this.droneG);
    for (const [type, f] of [['sawtooth', 41], ['sine', 43.3]] as const) {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(droneLP);
      o.start();
    }

    this.ac = ac;
    this.load(ac);
  }

  private async load(ac: AudioContext) {
    const raws = await this.raw!;
    await Promise.all(
      NAMES.map(async (n, i) => {
        const r = raws[i];
        try {
          if (!r) throw new Error('not found');
          this.buf[n] = await new Promise<AudioBuffer>((res, rej) => {
            (ac.decodeAudioData(r, res, rej) as Promise<AudioBuffer> | undefined)?.catch?.(rej);
          });
        } catch {
          this.missing.push(n);
        }
      }),
    );
    if (this.missing.length) console.warn(`sound: no sample for ${this.missing.join(', ')}: synthesised instead`);
    // the loops, or what stands in for them
    const { outside, room, breath, presence } = this.buf;
    // the meadow: twenty seconds of it, in stereo, round and round (without it there is only the wind)
    if (outside) this.loop(ac, loopOf(ac, outside, 1), this.outLP);
    if (room) this.loop(ac, loopOf(ac, room, 0.5), this.roomG);
    else {
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 110;
      lp.connect(this.roomG);
      this.loop(ac, this.noise, lp);
    }
    if (breath) this.breathSrc = this.loop(ac, loopOf(ac, breath, 0.3), this.breathG);
    else {
      // no take of it: noise through a mouth that opens and shuts (update draws the breaths)
      const bp = (this.breathBP = ac.createBiquadFilter());
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.9;
      bp.connect(this.breathG);
      this.loop(ac, this.noise, bp);
    }
    if (presence) {
      this.presSrc = this.loop(ac, loopOf(ac, presence, 0.6), this.presLP);
      this.presSrc.playbackRate.value = 0.82;
    }
    this.loaded = true;
  }

  private loop(ac: AudioContext, buf: AudioBuffer, to: AudioNode) {
    const s = ac.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(to);
    s.start(0, rnd() * buf.duration);
    return s;
  }

  // ---- one-shots ----

  /** the end of every one-shot's chain: placed left or right, sent to its bus, and taken apart when it has sounded */
  private send(last: AudioNode, pan: number, bus: AudioNode, src: AudioScheduledSourceNode, end: number) {
    const ac = this.ac!;
    let tail = last;
    if (pan !== 0 && ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      last.connect(p);
      tail = p;
    }
    tail.connect(bus);
    this.live++;
    src.onended = () => {
      this.live--;
      tail.disconnect();
    };
    src.stop(end);
  }

  /** a gain that opens in `attack` and dies away over the rest of `dur`: the shape of everything struck */
  private env(t: number, attack: number, dur: number, peak: number) {
    const g = this.ac!.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, t + attack, Math.max(0.002, (dur - attack) / 4));
    return g;
  }

  /** a piece of a sample: from `at`, `dur` seconds of it, at its own pitch */
  private shot(buf: AudioBuffer, at: number, dur: number, rate: number, gain: number, pan: number, bus: AudioNode, t: number) {
    if (this.live > 28 || gain < 0.002) return;
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const real = Math.min(dur, buf.duration - at) / rate, rel = Math.min(0.12, real * 0.4);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.setValueAtTime(gain, t + real - rel);
    g.gain.linearRampToValueAtTime(0, t + real);
    src.connect(g);
    src.start(t, at);
    this.send(g, pan, bus, src, t + real + 0.02);
  }

  /** a sine that falls: a weight landing */
  private thump(t: number, f0: number, f1: number, dur: number, gain: number, pan: number, bus: AudioNode) {
    if (this.live > 28 || gain < 0.002) return;
    const o = this.ac!.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.env(t, 0.004, dur, gain);
    o.connect(g);
    o.start(t);
    this.send(g, pan, bus, o, t + dur * 1.6);
  }

  /** noise through one filter that may move: grit, a hiss of air, a click */
  private burst(t: number, type: BiquadFilterType, f0: number, f1: number, q: number, dur: number, attack: number, gain: number, pan: number, bus: AudioNode) {
    if (this.live > 28 || gain < 0.002) return;
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = this.noise;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.env(t, attack, dur, gain);
    src.connect(f);
    f.connect(g);
    src.start(t, rnd() * 2);
    this.send(g, pan, bus, src, t + dur * 1.6 + 0.01);
  }

  /** an oscillator that slides, through one band: a voice of sorts */
  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, attack: number, gain: number, band: number, q: number, pan: number, bus: AudioNode) {
    if (this.live > 28 || gain < 0.002) return;
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = band;
    f.Q.value = q;
    const g = this.env(t, attack, dur, gain);
    o.connect(f);
    f.connect(g);
    o.start(t);
    this.send(g, pan, bus, o, t + dur * 1.6);
  }

  /** Where p is to the ears: how far left or right, how much of it reaches us, whether it is in front. */
  private place(p: V3) {
    const s = this.scene!, c = s.camPos, q = s.camQ;
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4;
    // the head's own right and forward, out of its quaternion
    const side = (dx * (1 - 2 * (q.y * q.y + q.z * q.z)) + dy * 2 * (q.x * q.y + q.w * q.z) + dz * 2 * (q.x * q.z - q.w * q.y)) / d;
    this.front = -(dx * 2 * (q.x * q.z + q.w * q.y) + dy * 2 * (q.y * q.z - q.w * q.x) + dz * (1 - 2 * (q.x * q.x + q.y * q.y))) / d;
    this.dist = d;
    // (right on top of us it is in the middle; behind us a little less of it)
    this.pan = side * 0.85 * Math.min(1, d / 0.4);
    this.att = (1 / (1 + 0.9 * d)) * (0.8 + 0.2 * clamp01(this.front + 1));
  }

  private get on() {
    return !!this.ac && !!this.scene && this.ac.state === 'running';
  }

  // ---- what happens at a moment (called from main.ts) ----

  /** A forepaw comes down: side -1 left, +1 right. */
  step(side: number) {
    if (!this.on) return;
    const ac = this.ac!, s = this.scene!;
    const pace = Math.min(1, Math.abs(s.nav.v) / s.speed);
    const t = ac.currentTime;
    if (pace < 0.12 || t - this.lastStep < 0.11) return;
    const gap = t - this.lastStep;
    this.lastStep = t;
    const g = MIX.steps * (0.3 + 0.7 * pace * pace), pan = side * 0.22;
    // the weight: felt more than heard
    this.thump(t, 88 + 24 * rnd(), 44, 0.09, 0.55 * g, pan, this.fx);
    // and the hind paw of that side comes down behind it, softer
    if (gap < 0.6) this.thump(t + gap * 0.5, 66 + 10 * rnd(), 40, 0.07, 0.22 * g, -pan * 0.6, this.fx);
    let wet = false;
    for (const p of s.puddles) if (Math.hypot(p.x - s.camPos.x, p.z - s.camPos.z) < p.r * 0.85 && Math.abs(p.y - s.camPos.y) < 0.5) wet = true;
    if (wet) {
      const w = this.buf.splash, gw = MIX.water * (0.45 + 0.55 * pace);
      if (w) this.shot(w, 0.1 + 0.08 * rnd(), 1.2, 0.9 + 0.4 * rnd(), gw, pan, this.fx, t);
      else this.burst(t, 'bandpass', 1700, 500, 0.8, 0.3, 0.008, gw * 0.6, pan, this.fx);
      return;
    }
    const inside = s.nav.entered;
    // grit under it in the hole; out on the bank the grass gives, and hisses
    if (inside) this.burst(t, 'bandpass', 1100 + 700 * rnd(), 700, 0.7, 0.07 + 0.04 * rnd(), 0.003, 0.2 * g, pan, this.fx);
    else this.burst(t, 'highpass', 2400, 3600, 0.5, 0.16, 0.03, 0.09 * g, pan, this.fx);
    const b = this.buf.steps;
    if (b) {
      let i = Math.floor(rnd() * 4);
      if (i === this.lastPaw) i = (i + 1) % 4;
      this.lastPaw = i;
      this.shot(b, STEPS[i * 3], STEPS[i * 3 + 1], (inside ? 0.92 : 1.1) + 0.22 * rnd(), g * STEPS[i * 3 + 2] * (inside ? 0.55 : 0.3), pan, this.fx, t);
    }
  }

  /** Dirt comes down at p: a trickle (amount 0.1) to a clod (1.5 and over). */
  crumble(p: V3, amount: number) {
    if (!this.on) return;
    const t = this.ac!.currentTime;
    if (t - this.lastDirt < 0.09) return;
    this.lastDirt = t;
    this.place(p);
    const a = Math.min(1.6, amount), g = MIX.dirt * (0.25 + 0.5 * a) * this.att, bus = this.dist > 2.2 ? this.far : this.fx;
    const b = this.buf.dirt;
    if (b) {
      const dur = 0.45 + 0.5 * a + 0.3 * rnd();
      this.shot(b, rnd() * Math.max(0, b.duration - dur - 0.1), dur, 0.8 + 0.5 * rnd(), g, this.pan, bus, t);
    } else this.burst(t, 'highpass', 2800, 2200, 0.5, 0.35 + 0.3 * a, 0.03, g * 0.5, this.pan, bus);
    // a proper clod: it lands
    if (a > 1.1) this.thump(t + 0.22 + 0.1 * rnd(), 130, 60, 0.08, g * 0.7, this.pan, bus);
  }

  /** A stone shifts at p: it knocks against its neighbours. */
  stone(p: V3, amount: number) {
    if (!this.on) return;
    const t = this.ac!.currentTime;
    if (t - this.lastRock < 0.12) return;
    this.lastRock = t;
    this.place(p);
    this.knock(t, MIX.stone * (0.35 + 0.65 * clamp01(amount)) * this.att, this.pan, this.dist > 2.2 ? this.far : this.fx);
  }

  private knock(t: number, g: number, pan: number, bus: AudioNode) {
    const b = this.buf.pebbles;
    if (b) {
      let i = Math.floor(rnd() * 4);
      if (i === this.lastStone) i = (i + 1) % 4;
      this.lastStone = i;
      this.shot(b, STONES[i * 2], STONES[i * 2 + 1], 0.8 + 0.5 * rnd(), g, pan, bus, t);
    } else {
      // two or three pings a few hundredths apart
      let at = t;
      for (let k = 0, n = 2 + Math.floor(rnd() * 2); k < n; k++) {
        this.tone(at, 'sine', 1900 + 1500 * rnd(), 1700, 0.02, 0.001, g * 0.6, 2400, 0.5, pan, bus);
        at += 0.03 + 0.07 * rnd();
      }
    }
  }

  private drip(t: number, g: number, pan: number, bus: AudioNode) {
    const b = this.buf.drip;
    if (b) this.shot(b, 0.04, 1.3, 0.8 + 0.55 * rnd(), g, pan, bus, t);
    else {
      // the plink of a drop: a pitch that climbs as the hollow it made closes over
      const f = 900 + 700 * rnd();
      this.tone(t, 'sine', f, f * 2.1, 0.05, 0.002, g * 0.6, f * 1.5, 0.4, pan, bus);
    }
  }

  /** the breath caught: one short, quiet gasp in */
  private gasp(t: number) {
    this.burst(t, 'bandpass', 700, 1800, 1.2, 0.24, 0.1, MIX.gasp, 0, this.pre);
  }

  /** the torch comes on for an instant in the black: the spark of it */
  private zap(t: number) {
    this.burst(t, 'highpass', 3200, 3200, 0.7, 0.03, 0.001, MIX.torch * 0.7, 0.2, this.pre);
    this.tone(t, 'sawtooth', 2600, 600, 0.06, 0.002, MIX.torch * 0.35, 1800, 0.8, 0.2, this.pre);
  }

  /** Something in the earth, ahead or behind, out of the light: so the place is never silent. */
  private ambient(t: number) {
    const pan = (rnd() * 2 - 1) * 0.9, g = MIX.ambient * (0.35 + 0.65 * rnd()), r = rnd();
    if (r < 0.4) {
      // a crackle: a root giving, dry earth parting. A handful of ticks, no two alike
      let at = t;
      for (let k = 0, n = 3 + Math.floor(rnd() * 6); k < n; k++) {
        this.burst(at, 'bandpass', 2200 + 3200 * rnd(), 2200, 2.5, 0.012, 0.001, g * (1 + 1.5 * rnd()), pan, this.fx);
        at += 0.015 + 0.1 * rnd() * rnd();
      }
    } else if (r < 0.65) this.knock(t, g * 0.7, pan, this.far);
    else if (r < 0.9) {
      const b = this.buf.dirt;
      if (b) this.shot(b, rnd() * 1.2, 0.5 + 0.6 * rnd(), 0.75 + 0.4 * rnd(), g * 0.8, pan, this.far, t);
      else this.burst(t, 'highpass', 2600, 2000, 0.5, 0.5, 0.05, g * 0.4, pan, this.far);
    } else {
      // the ground settling: low, slow, from no direction in particular
      this.thump(t, 58, 36, 0.5, g * 1.5, pan * 0.4, this.far);
      this.burst(t, 'lowpass', 220, 120, 0.5, 0.7, 0.18, g * 1.2, pan * 0.4, this.far);
    }
  }

  /** The beast changes what it is doing. */
  private turn(t: number, from: string, to: string) {
    const s = this.scene!;
    if (to === 'away') this.sighted = false;
    else if (to === 'stalk' && from === 'lurk') this.hold = Math.max(this.hold, 0.9); // it has started towards us
    else if (to === 'crouch') {
      // it gathers itself: a growl that rises, and the air it draws
      this.place(s.beast.group.position);
      const g = MIX.beast;
      this.tone(t, 'sawtooth', 33, 58, 0.5, 0.3, 0.6 * g, 300, 1.4, this.pan, this.fx);
      this.burst(t, 'bandpass', 280, 1300, 1, 0.45, 0.3, 0.22 * g, this.pan, this.fx);
      this.hold = Math.max(this.hold, 0.6);
    } else if (to === 'leap') {
      // through the air at us: the rush of it, and its voice coming up
      this.place(s.beast.group.position);
      const g = MIX.beast;
      this.burst(t, 'bandpass', 450, 2600, 0.8, 0.5, 0.3, 0.5 * g, this.pan * 0.6, this.fx);
      this.tone(t, 'sawtooth', 70, 190, 0.5, 0.36, 0.5 * g, 900, 2, this.pan * 0.6, this.fx);
    }
  }

  /** It lands on us. */
  private hit(t: number) {
    const g = MIX.beast;
    this.thump(t, 95, 32, 0.3, g, 0, this.pre);
    this.burst(t, 'lowpass', 520, 260, 0.6, 0.14, 0.004, 0.55 * g, 0, this.pre);
  }

  /** The jaws shut: the crack of it, the teeth meeting a moment later, the snarl behind them. */
  private snap(t: number) {
    const g = MIX.beast;
    this.burst(t, 'highpass', 1800, 1800, 0.6, 0.04, 0.001, 0.8 * g, 0.1, this.pre);
    this.burst(t + 0.022, 'bandpass', 2700, 2300, 3, 0.03, 0.001, 0.7 * g, -0.1, this.pre);
    this.thump(t, 140, 45, 0.18, 0.85 * g, 0, this.pre);
    this.tone(t, 'sawtooth', 190, 80, 0.24, 0.01, 0.5 * g, 700, 1.6, 0, this.pre);
  }

  // ---- every frame ----

  /** Called at the end of the frame. Reads the scene, moves the mix. */
  update(dt: number) {
    const ac = this.ac, s = this.scene;
    if (!ac || !s || ac.state !== 'running') return;
    const t = ac.currentTime, b = s.beast, st = b.state;

    // what cannot wait for the slower pass below: the beast's moves, its jaws, and the torch's stutter
    if (st !== this.was) {
      this.turn(t, this.was, st);
      this.was = st;
    }
    if (b.shake > this.shook + 0.25) {
      if (b.shake > 0.9) this.snap(t);
      else this.hit(t);
    }
    this.shook = b.shake;
    const I = s.light.value, dead = !!b.dead;
    // dead, in the black: each time the lamp flashes there is the spark of it
    if (dead && b.lamp > 0.05 && this.lampWas <= 0.05) this.zap(t);
    this.lampWas = b.lamp;
    // the torch's electronics: every jump in what it gives is a tick, a little to the right, where it is held
    if (!dead && this.lit >= 0 && Math.abs(I - this.lit) > 0.05 && t - this.lastTick > 0.035) {
      this.lastTick = t;
      this.burst(t, 'bandpass', 3600 + 2600 * rnd(), 3600, 2, 0.006, 0.0005, MIX.torch * 0.5 * Math.min(1, Math.abs(I - this.lit) * 3), 0.25, this.pre);
    }
    this.lit = I;

    // the rest thirty times a second is plenty
    if ((this.acc += dt) < 0.033) return;
    const h = this.acc;
    this.acc = 0;
    this.clock += h;
    const pace = Math.min(1.2, Math.abs(s.nav.v) / s.speed);
    // out under the sky with the egg: that is the end, and it all goes quiet for good
    if (s.game?.won && !this.ended) {
      this.ended = true;
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setTargetAtTime(0, t, 0.8);
    }

    // ---- the place: open air on the bank, the tunnel inside, a little of the day for the first metres in ----
    const c = s.camPos, m = s.mouth;
    const dm = Math.sqrt((c.x - m.x) ** 2 + (c.y - m.y) ** 2 + (c.z - m.z) ** 2);
    const openTo = s.nav.entered ? 0.4 * clamp01(1 - dm / 3) : 1;
    this.open += (openTo - this.open) * (1 - Math.exp(-h / 0.6));
    const open = this.open;
    // the torch is out, or we are dead: the place is gone. Only what is ours is left: the heart, and no breath at all
    const dark = dead || (b.lamp < 0.02 && (st === 'bite' || st === 'gone'));
    if (dark !== this.dark) {
      this.dark = dark;
      // the light comes back, or it all begins again
      if (!dark) { this.hold = 0; this.effort = 0; this.fear = Math.min(this.fear, 0.3); }
    }
    // (back up over a second or so)
    this.world.gain.setTargetAtTime(dark ? 0.03 : 1, t, dark ? 0.03 : 0.35);
    this.ret.gain.setTargetAtTime(MIX.verb * (1 - open), t, 0.2);
    this.roomG.gain.setTargetAtTime(MIX.room * (1 - open) * (this.loaded ? 1 : 0), t, 0.3);
    // the wind comes in gusts that no two sines agree on
    this.gust = 0.6 + 0.25 * Math.sin(this.clock * 0.37) + 0.15 * Math.sin(this.clock * 0.83 + 1.3);
    // the meadow: all of it on the bank, dulled and going for the first metres in, none of it further down. Where
    // there is a take of it the made wind only fills in under it
    this.outG.gain.setTargetAtTime(MIX.outside * open, t, 0.3);
    this.outLP.frequency.setTargetAtTime(500 + 15500 * open * open, t, 0.3);
    this.windG.gain.setTargetAtTime(MIX.wind * open * this.gust * (this.buf.outside ? 0.4 : 1), t, 0.3);
    this.windLP.frequency.setTargetAtTime(220 + 620 * open * this.gust, t, 0.3);

    // ---- the other lodger ----
    // How near it is, for the nerves and for the ear, is how far it is through the tunnels (asked a few times a second,
    // not every pass): clearly more of it at a metre and a half than at five, a trace at eight, none past nine or once
    // it has been out of the picture for a while; and from out on the bank none unless it is all but at the mouth.
    // Where it is, left or right, is the straight line to it, and only once it is near enough to be somewhere:
    // further off it is in the middle, and dull. Behind us it is duller too, and a little less
    let prox = 0, near = 0, back = 0, where = 0;
    const angry = !!b.angry;
    if (st !== 'away' && st !== 'gone' && !dead) {
      this.place(b.group.position);
      this.unseen = b.group.visible ? 0 : this.unseen + h;
      if ((this.tdTick = (this.tdTick + 1) & 3) === 0 || this.td === Infinity) this.td = b.tunnelDistance ? b.tunnelDistance(s.nav) : this.dist;
      const td = Math.max(this.td, this.dist);
      prox = clamp01((10 - td) / 9);
      near = (1 / (1 + (td * td) / 4)) * clamp01((9 - td) / 2) * clamp01(1 - (this.unseen - 0.5) / 1.5);
      if (!s.nav.entered) near *= clamp01((5 - td) / 1.5);
      where = clamp01((5 - td) / 2.5);
      back = clamp01(-this.front) * where;
      // the first sight of it, down the tunnel with the lamp on it: the breath stops
      if (st === 'lurk' && !this.sighted && b.group.visible && this.dist < 5.5 && this.front > 0.75 && I > 0.3) {
        this.sighted = true;
        this.gasp(t);
        this.hold = 2.4;
      }
      this.presPan?.pan.setTargetAtTime(this.pan * where, t, 0.12);
    } else this.td = Infinity;
    // felt before it is seen. Waiting it breathes slow; after us quicker; with its egg gone, harsher and nearer
    const presTo = Math.min(1, near * (st === 'lurk' ? 0.6 : st === 'stalk' ? 0.85 : 1) * (angry ? 1.25 : 1));
    this.pres += (presTo - this.pres) * (1 - Math.exp(-h / (presTo > this.pres ? 0.4 : st === 'gone' || dead ? 0.08 : 1.2)));
    const pres = this.pres;
    this.presG.gain.setTargetAtTime(MIX.presence * pres * (1 - 0.3 * back), t, 0.1);
    this.presLP.frequency.setTargetAtTime((250 + 3000 * Math.pow(pres, 0.7) + (angry ? 900 : 0)) * (1 - 0.6 * back), t, 0.15);
    this.presSrc?.playbackRate.setTargetAtTime(angry ? 1.08 : st === 'stalk' ? 0.95 : 0.82, t, 1);
    // its pulse: slow while it waits, quicker the nearer it is
    this.pulse += h * (0.5 + 1.4 * prox);
    const beat = Math.pow(0.5 + 0.5 * Math.sin(this.pulse * 2 * Math.PI), 3);
    this.droneG.gain.setTargetAtTime(MIX.drone * Math.pow(pres, 0.7) * (0.55 + 0.45 * beat), t, 0.04);
    // on its way to us its claws are on the floor
    if (st === 'stalk') {
      const p = b.group.position, moved = Math.hypot(p.x - this.bx, p.z - this.bz) / h;
      if (moved > 0.05 && (this.nextScrape -= h) < 0) {
        this.nextScrape = 0.42 + 0.2 * rnd();
        this.burst(t, 'bandpass', 1000 + 500 * rnd(), 520, 1, 0.12, 0.02, MIX.beast * 0.3 * Math.min(1, near * 2), this.pan * where, this.td > 2.2 ? this.far : this.fx);
      }
    }
    this.bx = b.group.position.x;
    this.bz = b.group.position.z;

    // ---- us ----
    let fearTo = st === 'away' ? 0 : st === 'lurk' ? (this.sighted ? 0.35 + 0.25 * prox : 0.12 * prox) : st === 'stalk' ? 0.55 + 0.45 * prox : 1;
    // with the egg in our hand we are not easy, and less so once it knows
    if (s.game?.carrying) fearTo = Math.max(fearTo, angry ? 0.5 : 0.32);
    this.fear += (fearTo - this.fear) * (1 - Math.exp(-h / (fearTo > this.fear ? 0.8 : 9)));
    const fear = this.fear;
    // our own breath is discreet, or it would get tiresome: none of it at rest, and at a run only a hint, well under
    // the paws, that comes after a few seconds of running and goes a few seconds after we stop
    const effTo = Math.min(1, pace);
    this.effort += (effTo - this.effort) * (1 - Math.exp(-h / (effTo > this.effort ? 3 : 4)));
    const effort = this.effort;
    const held = dark || (this.hold > 0 && (this.hold -= h) > 0);
    const rate = 0.95 + 0.4 * effort;
    let breath = held ? 0 : MIX.breath * effort * effort;
    if (this.breathBP) {
      // no take of it: in (short, higher), a pause, out (longer, lower), a pause
      this.breathPhase = (this.breathPhase + (h * rate) / 2.6) % 1;
      const p = this.breathPhase, air = p < 0.36 ? Math.sin((p / 0.36) * Math.PI) : p > 0.46 && p < 0.92 ? 0.8 * Math.sin(((p - 0.46) / 0.46) * Math.PI) : 0;
      this.breathBP.frequency.setTargetAtTime(p < 0.4 ? 1300 : 780, t, 0.05);
      breath *= 0.5 * air * air;
    } else this.breathSrc?.playbackRate.setTargetAtTime(rate, t, 0.5);
    this.breathG.gain.setTargetAtTime(breath, t, held ? 0.05 : this.breathBP ? 0.04 : 0.4);
    // the heart: not heard until there is something to fear, then quicker and nearer, and in the dark all there is
    const heart = dark ? 1 : clamp01((fear - 0.2) / 0.7);
    this.heartG.gain.setTargetAtTime(MIX.heart * heart * (dark ? 1.5 : held ? 1.2 : 1), t, 0.3);
    if (heart > 0.01) {
      if (this.nextBeat < t) this.nextBeat = t + 0.03;
      if (this.nextBeat < t + 0.08) {
        // (dead, it is all there is: racing at first, and slowing all the while until it begins again)
        const ebb = clamp01(1 - (b.deadFor ?? 0) / 7);
        const t0 = this.nextBeat, gapB = 60 / (dead ? 54 + 100 * ebb * ebb : 58 + 92 * fear + (held ? 14 : 0)), t1 = t0 + Math.min(0.3, gapB * 0.36);
        const e = this.heartEnv.gain, f = this.heartOsc.frequency;
        e.setValueAtTime(0, t0); e.linearRampToValueAtTime(1, t0 + 0.012); e.setTargetAtTime(0, t0 + 0.012, 0.045);
        f.setValueAtTime(64, t0); f.exponentialRampToValueAtTime(42, t0 + 0.09);
        e.setValueAtTime(0, t1); e.linearRampToValueAtTime(0.7, t1 + 0.012); e.setTargetAtTime(0, t1 + 0.012, 0.04);
        f.setValueAtTime(74, t1); f.exponentialRampToValueAtTime(46, t1 + 0.08);
        this.nextBeat = t0 + gapB;
      }
    }

    // ---- the torch: while its cells sag it whines, lower the less it gives ----
    const sag = I > 0.03 ? clamp01((0.92 - I) / 0.6) : 0;
    this.whineG.gain.setTargetAtTime(MIX.torch * 0.008 * sag, t, 0.03);
    this.whine.frequency.setTargetAtTime(2300 + 1500 * I, t, 0.03);

    // ---- the place is never quite still ----
    if (s.nav.entered && !dark) {
      if ((this.nextAmbient -= h) < 0) {
        this.nextAmbient = 2.5 + 6 * rnd();
        this.ambient(t);
      }
      // water drips where there is water: off the roof into the nearest pool, more of them while we shake the place
      let pool = -1, best = 8;
      for (let i = 0; i < s.puddles.length; i++) {
        const p = s.puddles[i], d = Math.sqrt((p.x - c.x) ** 2 + (p.y - c.y) ** 2 + (p.z - c.z) ** 2);
        if (d < best) { best = d; pool = i; }
      }
      if (pool >= 0 && (this.nextDrip -= h * (1 + (best < 2.5 ? 1.5 * s.ripple.value : 0))) < 0) {
        this.nextDrip = 0.9 + 4.5 * rnd() * rnd() + best * 0.25;
        this.place(s.puddles[pool]);
        // (a pool we are standing in is all round us)
        this.drip(t, MIX.water * (0.5 + 0.5 * rnd()) * this.att * 1.6, this.pan + (rnd() - 0.5) * 0.3, this.dist > 2.2 ? this.far : this.fx);
      }
    }
  }
}

/** the one engine of the page; also `burrowSound` in the console */
export const sound = new Sound();
Object.assign(window, { burrowSound: sound });
