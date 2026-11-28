// The sound of day 27: what the burrow is like to the ear. A small WebAudio engine. A browser plays nothing before
// a press, so it starts on the first one (or the first key); it sleeps while the tab is hidden; ?mute leaves it out.
//
// Two kinds of sound, and they are kept apart on purpose:
// - Texture is sampled. Fourteen short takes made with ElevenLabs' sound effects model live in public/audio (the README
//   has the prompt of each): the meadow outside, the room inside, our own breath, the other lodger's breath, growl,
//   snarl, groan and its two calls, a paw on packed earth, dirt coming down, pebbles, a drip, a splash. A take is never played the
//   same way twice: a slice of it, at its own pitch.
// - What answers us is synthesised from two oscillators' worth of parts: the weight of each paw, the heart, the drone
//   and the slow pulse of the thing as it nears, its lunge and its jaws, the torch's tired electronics, the wind at
//   the mouth. Every sample has a synthetic stand-in as well, so a file that is missing costs texture and nothing else.
//
// main.ts hands over the live objects once (bind) and then calls update(dt) at the end of every frame; step, crumble
// and stone are the three things that happen at a moment; setMuted is the sound button's. Nothing is allocated per frame: update only reads numbers
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
    /** how much it is walking, 0 to 1, and where it is in its walk's cycle, 0 to 1 */
    moving?: number; cycle?: number;
    /** how far it is from us through the tunnels, metres: three metres of earth is not three of air */
    tunnelDistance?(where: { e: number; s: number }): number;
    /** the place on the rails nearest a point, and the metres of tunnel between two such places */
    nearest?(p: V3): { e: number; s: number };
    between?(a: { e: number; s: number }, b: { e: number; s: number }): number;
    /** which way along the tunnel from a place the short way to another (or to the beast) leads: a unit vector */
    toward?(from: { e: number; s: number }, to?: { e: number; s: number }): V3;
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
/** the takes are re-cut now and then under the same names: this goes up with them, so no browser plays an old one */
const TAKES = 4;
const NAMES = ['outside', 'room', 'breath', 'presence', 'growl', 'snarl', 'groan', 'warn', 'alarm', 'steps', 'dirt', 'pebbles', 'drip', 'splash'] as const;
type Name = (typeof NAMES)[number];

/**
 * How loud each thing is. Guesses, every one: set by reading meters, not by ear. They can be turned while it runs
 * from the console (burrowSound.mix.breath = 0.5).
 */
const MIX = {
  master: 0.8, verb: 0.8,
  // (outside: the take of wind in grass is played as it came, never re-encoded, and it came very quiet: hence the 4)
  outside: 4.4, crickets: 0.5, room: 0.15, wind: 0.2, ambient: 0.5,
  breath: 0.12, gasp: 0.12, heart: 0.16,
  steps: 0.45, dirt: 0.7, stone: 0.9, water: 0.55,
  presence: 2, drone: 0.18, growl: 0.12, snarl: 0.25, groan: 0.1, cry: 1.2, pads: 0.7, beast: 0.9,
  torch: 0.5,
};

/** where the single paws are in steps.mp3: start, length (s), and what brings each up to the level of the others */
const STEPS = [0.7, 0.36, 0.8, 2.0, 0.48, 2.6, 3.88, 0.46, 1.5, 5.14, 0.44, 1.25];
/** and the single stones in pebbles.mp3: start, length */
const STONES = [0.56, 0.36, 0.95, 0.45, 1.48, 0.55, 2.4, 0.22];
/** where in its walk's cycle the beast's paws come down: hind right, fore left, hind left, fore right */
const PAWS = [0.4, 0.46, 0.9, 0.96];

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
  /** every pool's own clock, and where on the rails it is (looked up the first time it is wanted) */
  private poolNext = new Float32Array(0);
  private poolAt: ({ e: number; s: number } | null)[] = [];
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
  private snarlG!: GainNode;
  private verbIn!: GainNode;
  private echoIn!: GainNode;
  private nextCry = 12;
  private wasAngry = false;
  private cyc = 0;
  private lastPad = 0;
  private padNear = 0;
  private padPan = 0;
  private chase = 0;
  private nextGrowl = 2;
  private nextGroan = 6;
  private tdTick = 0;
  private outG!: GainNode;
  private outPan: StereoPannerNode | null = null;
  /** where the mouth is on the rails, once it has been looked up */
  private mouthAt: { e: number; s: number } | null = null;
  /** the crickets in the grass: made here, each one a sine that is let through in short pulses */
  private crikG!: GainNode;
  private crik: { g: GainNode; next: number; amp: number; every: number; pulses: number }[] = [];
  private outLP!: BiquadFilterNode;
  private ended = false;

  constructor() {
    if (MUTE) return;
    // the samples are fetched straight away and decoded once there is a context to decode them
    this.raw = Promise.all(
      NAMES.map((n) =>
        fetch(`${import.meta.env.BASE_URL}audio/${n}.mp3?v=${TAKES}`)
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
    const n = scene.puddles.length;
    this.poolNext = new Float32Array(n);
    for (let i = 0; i < n; i++) this.poolNext[i] = 2 + 12 * rnd();
    this.poolAt = new Array(n).fill(null);
  }

  /** the sound button's wish: off or on. It may come before there is anything to switch */
  private off = false;
  get muted(): boolean {
    return this.off;
  }

  /**
   * The sound off (true) or on again (false), from the button in the furniture. Not the same as ?mute, which leaves
   * the engine out altogether: this one only shuts the way out, so it all carries on unheard and is there at once
   * when asked for. Safe before the first press: the wish is kept, and the engine starts silent.
   */
  setMuted(on: boolean) {
    this.off = on;
    const ac = this.ac;
    if (!ac) return;
    const g = this.out.gain, t = ac.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(on || this.ended ? 0 : MIX.master, t, 0.05);
  }

  /** 'muted', 'waiting' (no press yet), or the context's own state */
  get state(): string {
    return MUTE ? 'muted' : this.ac ? this.ac.state : 'waiting';
  }

  /** what is going out now, RMS, after everything: for the console and for checks */
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
    this.out.gain.setTargetAtTime(this.off ? 0 : MIX.master, ac.currentTime, 0.5);
    const lim = ac.createDynamicsCompressor();
    lim.threshold.value = -10;
    lim.knee.value = 8;
    lim.ratio.value = 12;
    lim.attack.value = 0.004;
    lim.release.value = 0.2;
    lim.connect(this.out);
    this.meter = ac.createAnalyser();
    this.meter.fftSize = 1024;
    this.out.connect(this.meter);
    this.pre = gain(1, lim);
    this.world = gain(1, this.pre);

    // the tunnel
    this.ret = gain(0, this.world);
    const conv = ac.createConvolver();
    conv.buffer = tunnel(ac);
    conv.connect(filter('lowpass', 2600, 0.5, this.ret));
    const send = (this.verbIn = gain(1, conv));
    // and from further off the tunnel answers: one slap back, and what is left of that again (gone outside, like the rest)
    const slap = ac.createDelay(0.5);
    slap.delayTime.value = 0.21;
    const slapLP = filter('lowpass', 1900, 0.5, this.ret);
    slap.connect(slapLP);
    slapLP.connect(gain(0.36, slap));
    this.echoIn = gain(1, slap);
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
    // (everything of the outside goes through one panner: from inside, the day is heard from the mouth's side)
    this.outPan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    this.outPan?.connect(this.world);
    const outTo: AudioNode = this.outPan ?? this.world;
    this.outG = gain(0, outTo);
    this.outLP = filter('lowpass', 20000, 0.707, this.outG);
    this.windG = gain(0, outTo);
    this.windLP = filter('lowpass', 500, 0.4, this.windG);
    this.loop(ac, this.noise, this.windLP);
    // crickets: no take of them survives being turned up (they come as quiet as the wind, and coded), so they are
    // made: five of them about the bank, each its own pitch, place and pace, a chirp being three or four quick pulses
    this.crikG = gain(0, outTo);
    for (let i = 0; i < 5; i++) {
      const pan = ac.createStereoPanner();
      pan.pan.value = (i / 4) * 1.7 - 0.85 + (rnd() - 0.5) * 0.2;
      pan.connect(this.crikG);
      const g = gain(0, pan);
      const o = ac.createOscillator();
      o.frequency.value = 4100 + 1300 * rnd();
      o.connect(g);
      o.start();
      this.crik.push({ g, next: 0, amp: 0.25 + 0.75 * rnd() * rnd(), every: 0.42 + 0.5 * rnd(), pulses: rnd() < 0.5 ? 3 : 4 });
    }

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
    this.snarlG = gain(0, this.presLP);
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
    const { outside, room, breath, presence, snarl } = this.buf;
    if (snarl) this.loop(ac, loopOf(ac, snarl, 0.3), this.snarlG);
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

  /**
   * Something the beast says: a stretch of a take, eased in and out, put through the same filter, level and place as
   * its breath, so it is as far off, as dull and as much to one side as that is.
   */
  private voice(buf: AudioBuffer, at: number, dur: number, rate: number, gain: number, t: number) {
    if (this.live > 28) return;
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const real = Math.max(0.7, Math.min(dur, buf.duration - at) / rate);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.18);
    g.gain.setValueAtTime(gain, t + real - 0.4);
    g.gain.linearRampToValueAtTime(0, t + real);
    src.connect(g);
    src.start(t, at);
    this.send(g, 0, this.presLP, src, t + real + 0.02);
  }

  /**
   * Its call: thin, high, and the one thing of it that carries, out to twenty metres of tunnel. It is there to say
   * where it is. So it is all the way to one side when the beast is to that side (the straight line to it), and by
   * how far off it is through the tunnels it is quieter, duller, and has more of the tunnel in it: less of the call
   * itself, more of the walls and of the slap coming back. `floor`: how much of it gets through however far.
   */
  private cry(name: 'warn' | 'alarm', t: number, gain: number, rate: number, floor: number, at: number, dur: number) {
    const ac = this.ac!, s = this.scene!, b = s.beast;
    if (this.live > 28) return;
    this.place(b.group.position);
    const td = Math.max(b.tunnelDistance ? b.tunnelDistance(s.nav) : this.dist, this.dist);
    this.bend(td);
    const lvl = Math.max(floor, (1 / (1 + Math.pow(td / 5, 1.3))) * clamp01((20 - td) / 4));
    if (lvl < 0.004) return;
    const off = clamp01(td / 14);
    const inp = ac.createGain(), lp = ac.createBiquadFilter(), dry = ac.createGain(), wet = ac.createGain(), echo = ac.createGain();
    inp.gain.value = MIX.cry * gain * lvl;
    lp.type = 'lowpass';
    // (behind us it is a little duller still: left from right is plain to the ear, front from back is not)
    lp.frequency.value = (2000 + 5000 / (1 + (td * td) / 81)) * (1 - 0.35 * clamp01(-this.front));
    inp.connect(lp);
    let tail: AudioNode = lp;
    if (ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, this.pan * 1.2));
      lp.connect(p);
      tail = p;
    }
    dry.gain.value = 1 - 0.5 * off;
    wet.gain.value = 0.25 + 0.9 * off;
    echo.gain.value = 0.15 + 0.75 * off;
    tail.connect(dry).connect(this.world);
    tail.connect(wet).connect(this.verbIn);
    tail.connect(echo).connect(this.echoIn);
    const buf = this.buf[name];
    if (buf) this.shot(buf, at, dur, rate, 1, 0, inp, t);
    else {
      // no take of it: a hiss through a tight band that climbs, and two high voices a hair apart that beat as they rise
      const d = dur / rate;
      this.burst(t, 'bandpass', 2400, 5200, 5, d, d * 0.6, 1.4, 0, inp);
      this.tone(t, 'sine', 3000, 3900, d, d * 0.6, 0.25, 3500, 0.7, 0, inp);
      this.tone(t, 'sine', 3170, 4120, d, d * 0.6, 0.25, 3600, 0.7, 0, inp);
    }
    // (taken apart once it and its echoes are over)
    setTimeout(() => { dry.disconnect(); wet.disconnect(); echo.disconnect(); }, (dur / rate + 3) * 1000);
  }

  /**
   * One of the beast's paws comes down (0 hind right, 1 fore left, 2 hind left, 3 fore right): a heavy soft pad, grit
   * under it, and from the fore paws the click of the claws. The hind ones are duller. Scuttling, they come lighter
   * the closer together they come.
   */
  private pad(t: number, k: number) {
    const gap = t - this.lastPad;
    if (gap < 0.055) return;
    this.lastPad = t;
    const fore = k === 1 || k === 3, quick = gap < 0.14;
    const g = MIX.pads * this.padNear * Math.min(1, 0.3 + gap / 0.35) * (fore ? 1 : 0.7);
    const pan = this.padPan + (k === 0 || k === 3 ? 0.06 : -0.06), bus = this.td > 2.5 ? this.far : this.fx;
    this.thump(t, fore ? 96 : 72, fore ? 44 : 36, 0.1, g, pan, bus);
    this.burst(t, 'bandpass', fore ? 950 : 620, 480, 0.8, 0.06, 0.004, g * 0.4, pan, bus);
    if (fore) this.burst(t + 0.012, 'bandpass', 2600 + 900 * rnd(), 2600, 4, 0.012, 0.001, g * 0.6, pan, this.td > 6 ? this.far : this.fx);
    // (our own paw, an octave down, for the weight of it)
    const b = this.buf.steps;
    if (b && fore && !quick) this.shot(b, STEPS[0], 0.3, 0.5 + 0.12 * rnd(), g * 0.5, pan, bus, t);
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

  /**
   * What is more than a couple of metres of tunnel off is not heard from where it is through the earth, but from
   * where its tunnel comes in: the way the short way round to it leads from here. Call after place(); `td` the
   * metres of tunnel to it, `to` its place on the rails (left out: the beast). So there is always a side to it:
   * turn a shoulder to the tunnel it is down, and it is in that ear.
   */
  private bend(td: number, to?: { e: number; s: number }) {
    const s = this.scene!, b = s.beast;
    if (!b.toward) return;
    const w = clamp01((td - 1.5) / 2);
    if (w <= 0) return;
    const v = b.toward(s.nav, to), q = s.camQ;
    const side = v.x * (1 - 2 * (q.y * q.y + q.z * q.z)) + v.y * 2 * (q.x * q.y + q.w * q.z) + v.z * 2 * (q.x * q.z - q.w * q.y);
    const front = -(v.x * 2 * (q.x * q.z + q.w * q.y) + v.y * 2 * (q.y * q.z - q.w * q.x) + v.z * (1 - 2 * (q.x * q.x + q.y * q.y)));
    this.pan += (side * 0.85 - this.pan) * w;
    this.front += (front - this.front) * w;
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

  /** A drop into a pool. `echo`: how much of it also goes down the tunnel and comes back (the far ones). */
  private drip(t: number, g: number, pan: number, bus: AudioNode, echo: number) {
    const b = this.buf.drip;
    if (b) {
      const rate = 0.8 + 0.55 * rnd();
      this.shot(b, 0.04, 1.3, rate, g, pan, bus, t);
      if (echo > 0) this.shot(b, 0.04, 1.3, rate, g * echo, pan, this.echoIn, t);
    } else {
      // the plink of a drop: a pitch that climbs as the hollow it made closes over
      const f = 900 + 700 * rnd();
      this.tone(t, 'sine', f, f * 2.1, 0.05, 0.002, g * 0.6, f * 1.5, 0.4, pan, bus);
      if (echo > 0) this.tone(t, 'sine', f, f * 2.1, 0.05, 0.002, g * 0.6 * echo, f * 1.5, 0.4, pan, this.echoIn);
    }
  }

  /** the breath caught: one short, quiet gasp in */
  private gasp(t: number) {
    this.burst(t, 'bandpass', 700, 1800, 1.2, 0.24, 0.1, MIX.gasp, 0, this.pre);
  }


  /** Something in the earth, ahead or behind, out of the light: so the place is never silent. */
  private ambient(t: number) {
    const pan = (rnd() * 2 - 1) * 0.9, g = MIX.ambient * (0.35 + 0.65 * rnd()), r = rnd();
    if (r < 0.4) {
      // a crackle: a root giving, dry earth parting. A handful of ticks, no two alike
      let at = t;
      for (let k = 0, n = 3 + Math.floor(rnd() * 6); k < n; k++) {
        this.burst(at, 'bandpass', 2200 + 3200 * rnd(), 2200, 2.5, 0.012, 0.001, g * (0.5 + 0.8 * rnd()), pan, this.fx);
        at += 0.015 + 0.1 * rnd() * rnd();
      }
    } else if (r < 0.65) this.knock(t, g * 0.7, pan, this.far);
    else if (r < 0.9) {
      const b = this.buf.dirt;
      if (b) this.shot(b, rnd() * 1.2, 0.5 + 0.6 * rnd(), 0.75 + 0.4 * rnd(), g * 0.8, pan, this.far, t);
      else this.burst(t, 'highpass', 2600, 2000, 0.5, 0.5, 0.05, g * 0.4, pan, this.far);
    } else {
      // the ground settling: low, slow, from no direction in particular
      this.thump(t, 58, 36, 0.5, g * 0.5, pan * 0.4, this.far);
      this.burst(t, 'lowpass', 220, 120, 0.5, 0.7, 0.18, g * 0.8, pan * 0.4, this.far);
    }
  }

  /** The beast changes what it is doing. */
  private turn(t: number, from: string, to: string) {
    const s = this.scene!;
    if (to === 'away') this.sighted = false;
    else if (to === 'stalk' && from === 'lurk') {
      // it has started towards us, and says so
      this.hold = Math.max(this.hold, 0.9);
      this.cry('warn', t, 0.9, 1.08, 0, 0.9, 1.1);
      this.nextCry = Math.max(this.nextCry, 8);
    }
    else if (to === 'crouch') {
      // it gathers itself: a growl that rises, and the air it draws
      this.place(s.beast.group.position);
      const g = MIX.beast;
      this.tone(t, 'sawtooth', 33, 58, 0.5, 0.3, 0.6 * g, 300, 1.4, this.pan, this.fx);
      this.burst(t, 'bandpass', 280, 1300, 1, 0.45, 0.3, 0.22 * g, this.pan, this.fx);
      this.hold = Math.max(this.hold, 0.6);
      // and one sharp call
      this.cry('warn', t, 1, 1.3, 0, 1.2, 0.9);
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
    // its paws, each at its own point of the walk's cycle (the cycle may go round more than once a frame when it
    // scuttles: two paws a frame at the most)
    const cyc = b.cycle;
    if (cyc !== undefined) {
      const prev = this.cyc;
      if (cyc !== prev && (b.moving ?? 0) > 0.1 && !dead && this.padNear > 0.004) {
        const wrapped = prev - cyc > 0.5;
        for (let k = 0, n = 0; k < 4 && n < 2; k++) {
          const m = PAWS[k];
          if (wrapped ? m > prev || m <= cyc : prev < m && cyc >= m) { n++; this.pad(t, k); }
        }
      }
      this.cyc = cyc;
    }
    // (the torch says nothing when the beast is on us, nor in the black after: its sparks and ticks there were tried,
    // and they were bad. Only the heart then)
    const onUs = st === 'crouch' || st === 'leap' || st === 'bite' || st === 'gone';
    // the torch's electronics: every jump in what it gives is a tick, a little to the right, where it is held
    if (!dead && !onUs && this.lit >= 0 && Math.abs(I - this.lit) > 0.05 && t - this.lastTick > 0.035) {
      this.lastTick = t;
      this.burst(t, 'bandpass', 3600 + 2600 * rnd(), 3600, 2, 0.006, 0.0005, MIX.torch * Math.min(1, Math.abs(I - this.lit) * 3), 0.25, this.pre);
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
    // Out on the bank it is all round us. Inside it comes in at the mouth: from in front if we look back at it, from
    // one side if we turn a shoulder to it, and further in from whichever way the tunnel leads back out
    if (this.outPan) {
      let side = 0;
      if (s.nav.entered) {
        this.place(s.mouth);
        if (b.nearest && b.between) this.bend(b.between(s.nav, this.mouthAt ?? (this.mouthAt = b.nearest(s.mouth))), this.mouthAt ?? undefined);
        side = this.pan * 0.9;
      }
      this.outPan.pan.setTargetAtTime(side, t, 0.12);
    }
    // (wide open on the bank: nothing of the take's top is shaved there)
    this.outLP.frequency.setTargetAtTime(Math.min(20000, 500 + 21500 * open * open), t, 0.3);
    this.windG.gain.setTargetAtTime(MIX.wind * open * this.gust * (this.buf.outside ? 0.12 : 1), t, 0.3);
    // the crickets: each chirps on its own time, and stops for a while now and then
    this.crikG.gain.setTargetAtTime(MIX.crickets * open * open, t, 0.4);
    if (open > 0.05) {
      for (const c of this.crik) {
        if (c.next < t) c.next = t + rnd() * c.every;
        while (c.next < t + 0.25) {
          for (let k = 0; k < c.pulses; k++) {
            const ts = c.next + k * 0.031;
            c.g.gain.setValueAtTime(0, ts);
            c.g.gain.linearRampToValueAtTime(c.amp * (0.7 + 0.3 * rnd()), ts + 0.007);
            c.g.gain.linearRampToValueAtTime(0, ts + 0.021);
          }
          c.next += c.every * (0.92 + 0.16 * rnd()) + (rnd() < 0.06 ? 1.5 + 5 * rnd() : 0);
        }
      }
    }
    this.windLP.frequency.setTargetAtTime(220 + 620 * open * this.gust, t, 0.3);

    // ---- the other lodger ----
    // How near it is, for the nerves and for the ear, is how far it is through the tunnels (asked a few times a second,
    // not every pass): clearly more of it at a metre and a half than at five, a trace at eight, none past nine and a half or once
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
      near = (1 / (1 + (td * td) / 4)) * clamp01((9.5 - td) / 1.5) * clamp01(1 - (this.unseen - 0.5) / 1.5);
      if (!s.nav.entered) near *= clamp01((5 - td) / 1.5);
      // (a side to it at any distance: near, where it is; further, the tunnel it is down)
      this.bend(td);
      where = 1;
      back = clamp01(-this.front);
      // its steps carry a little further than its breath: round a corner it is heard coming before it is seen
      this.padNear = (1 / (1 + (td * td) / 9)) * clamp01((13 - td) / 3) * (s.nav.entered ? 1 : clamp01((5 - td) / 1.5));
      this.padPan = this.pan;
      // the first sight of it, down the tunnel with the lamp on it: the breath stops
      if (st === 'lurk' && !this.sighted && b.group.visible && this.dist < 5.5 && this.front > 0.75 && I > 0.3) {
        this.sighted = true;
        this.gasp(t);
        this.hold = 2.4;
      }
      this.presPan?.pan.setTargetAtTime(this.pan * where, t, 0.12);
    } else { this.td = Infinity; this.padNear = 0; }
    // Its calls. With its egg gone, one long one that the whole burrow hears: it tells us what we have done. And every
    // ten or twenty seconds while it is anywhere down here with us, sooner when it is after us, a short one: not an
    // alarm, the way to tell where it is
    if (angry && !this.wasAngry && !dead && st !== 'away') {
      this.cry('alarm', t, 1, 1, 0.15, 0, 3.3);
      this.nextCry = 9 + 6 * rnd();
    }
    this.wasAngry = angry;
    if (s.nav.entered && !dead && st !== 'away' && st !== 'gone' && st !== 'crouch' && st !== 'leap' && st !== 'bite' && (this.nextCry -= h * (st === 'stalk' || angry ? 1.5 : 1)) < 0) {
      this.nextCry = 10 + 10 * rnd();
      this.cry('warn', t, 0.75 + 0.25 * rnd(), 0.9 + 0.2 * rnd(), 0, 0.1 + 0.5 * rnd(), 1.3);
    }
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
    const bp = b.group.position;
    const moving = st === 'stalk' && (b.moving !== undefined ? b.moving > 0.2 : Math.hypot(bp.x - this.bx, bp.z - this.bz) / h > 0.05);
    this.bx = bp.x;
    this.bz = bp.z;
    // (a beast that does not say where its paws are gets a scrape now and then instead)
    if (moving && b.cycle === undefined && (this.nextScrape -= h) < 0) {
      this.nextScrape = 0.42 + 0.2 * rnd();
      this.burst(t, 'bandpass', 1000 + 500 * rnd(), 520, 1, 0.12, 0.02, MIX.beast * 0.3 * Math.min(1, near * 2), this.pan * where, this.td > 2.2 ? this.far : this.fx);
    }
    // Its voice, all of it through its breath's filter, level and place (so: by the tunnel, to one side, and gone when
    // we are dead or it is out of range). After us the growl is hard and does not stop: some of it while it comes,
    // all of it with its egg gone and as it gathers itself
    const chaseTo = st === 'crouch' || st === 'leap' ? 1 : st === 'stalk' ? (angry ? 1 : moving ? 0.55 : 0.1) : 0;
    this.chase += (chaseTo - this.chase) * (1 - Math.exp(-h / (chaseTo > this.chase ? 0.35 : 1.2)));
    this.snarlG.gain.setTargetAtTime(MIX.snarl * this.chase, t, 0.1);
    if (near > 0.01 && (st === 'lurk' || st === 'stalk')) {
      // waiting and watching (we have seen it, or it stands in front of us) it growls low, now and then, never the
      // same stretch twice running
      if ((st === 'lurk' ? this.sighted : !moving && !angry) && (this.nextGrowl -= h) < 0) {
        this.nextGrowl = 4 + 6 * rnd();
        const g = this.buf.growl;
        if (g) this.voice(g, rnd() * 1.2, 1.4 + 1.2 * rnd(), 0.85 + 0.2 * rnd(), MIX.growl * (0.6 + 0.4 * rnd()), t);
        else this.tone(t, 'sawtooth', 34, 28, 1.6, 0.5, MIX.growl * 0.8, 320, 1.2, 0, this.presLP);
      }
      // and every so often it groans: long, low, tired. More often the nearer it is
      if ((this.nextGroan -= h * (0.6 + prox)) < 0) {
        this.nextGroan = 7 + 9 * rnd();
        const g = this.buf.groan;
        if (g) this.voice(g, rnd() * 1.5, 2.6 + 2 * rnd(), 0.8 + 0.2 * rnd(), MIX.groan * (0.6 + 0.4 * rnd()), t);
        else this.tone(t, 'sawtooth', 72, 46, 2, 0.6, MIX.groan * 0.7, 400, 1, 0, this.presLP);
      }
    }

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
        // (standing still the place settles: a sound of it now and then, not a patter)
        this.nextAmbient = (2.5 + 6 * rnd()) * (s.nav.v > 0.1 ? 1 : 5);
        this.ambient(t);
      }
    }
    // Water drips where there is water. Every pool keeps its own slow, uneven time (quicker while we run through it
    // and shake the place), and each drop is heard from its pool: all of it within a metre, clearly less by three,
    // a faint plink with the tunnel in it at six or eight, none past nine. The metres are the tunnel's (asked once a
    // drop, not every pass), the side is the straight line to the pool, and only once it is near enough to have one.
    // So going past a pool it comes up on one side, passes, and falls away behind
    const P = s.puddles;
    for (let i = 0; i < this.poolNext.length && i < P.length; i++) {
      const p = P[i], d = Math.sqrt((p.x - c.x) ** 2 + (p.y - c.y) ** 2 + (p.z - c.z) ** 2);
      if ((this.poolNext[i] -= h * (1 + (d < 2.5 ? 1.5 * s.ripple.value : 0))) > 0) continue;
      // (a drop now and then, not a dripping tap: with several pools in earshot it was a patter)
      this.poolNext[i] = 5 + 4 * rnd() + 10 * rnd() * rnd();
      if (d > 6 || !s.nav.entered || dark) continue;
      const td = b.nearest && b.between ? Math.max(d, b.between(s.nav, this.poolAt[i] ?? (this.poolAt[i] = b.nearest(p)))) : d;
      if (td > 6) continue;
      this.place(p);
      this.bend(td, this.poolAt[i] ?? undefined);
      const lvl = clamp01((6 - td) / 2) / (1 + Math.pow(Math.max(0, td - 1) / 1.8, 2)), off = clamp01((td - 2) / 4);
      const g = MIX.water * (0.6 + 0.4 * rnd()) * lvl * 1.3;
      // (a pool we are standing in is all round us)
      // (no echo sent after it: one drop heard twice read as a fault)
      this.drip(t, g, this.pan + (rnd() - 0.5) * 0.2 * (1 - off), td > 2.2 ? this.far : this.fx, 0);
    }
  }
}

/** the one engine of the page; also `burrowSound` in the console */
export const sound = new Sound();
Object.assign(window, { burrowSound: sound });
