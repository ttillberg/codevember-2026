// The hall's sound, made as it plays (no files), and deep: nothing in the middle, all of it under 200 Hz but the
// beeps far off. And dark, industrial: the drone has a minor second and a tritone in it, the mains hum under
// everything, a press somewhere thumping slowly. And the hall's machines heard as they go: the fans' wind and a
// gust as each blade comes by; the roof's shutter dragging, dull; a hoist's cage groaning where it stops. (The
// groan is made after a recording given as the sound wanted, the fans' wind after another; neither is played.) Under it
// all, big machines running: three, each a low tone and a band of noise, throbbing at its own rate (a tremolo, as
// a great rotor does), the rate itself drifting. a drone of harmonics, the air of the hall and its fans, the pod's
// own hum breathing with the red light in it, a beep now and then far off, and all of it in a long hall's reverb.
// It follows the eye: close on the pod, the hum is near and dry and the drone is bright; drawn back, the hum is
// small and to one side as the pod is in the picture, and more of everything is the hall's tail; looking up into
// the roof, the air opens up. (main.ts starts it on the first press: a page cannot make a sound before that.)

/** what the eye is doing, each frame */
export type Ear = {
  /** metres from the eye to the pod */
  dist: number;
  /** where the pod is across the picture: -1 left edge, 1 right */
  pan: number;
  /** how far up the eye looks: -1 straight down, 1 straight up */
  up: number;
  /** the red light's breath, 0 out, 1 in */
  beat: number;
  /** the daylight let in by the roof, 0 shut, 0.75 open */
  day: number;
  /** the end wall's fans, 0 shut, 1 open */
  fans: number;
  /** how fast the roof's shutter is rolling, 0 still, 1 at full speed */
  roll: number;
  /** how fast the fans' leaf shutters are moving, 0 still, 1 at full speed */
  leaf: number;
  /** how open the pod's door is, 0 shut, 1 wide */
  door: number;
  /** how near the eye is to the door's opening, 1 looking in, 0 well away */
  inside: number;
  /** where the eye is, and which way it looks (forward and right, unit), in the world */
  eye: V3;
  fwd: V3;
  right: V3;
  /** the things in the hall that make a sound of their own where they are */
  places: Place[];
  /** the hoists' cages: where, and how fast they ride (metres a second) */
  cages: { at: V3; speed: number }[];
  /** how fast the pod's door swings, radians a second */
  doorSpeed: number;
  /** how far each end-wall fan has turned, radians */
  fanTurns: number[];
};
type V3 = { x: number; y: number; z: number };
/** a thing that hisses where it is: the fans (in a rhythm, a gust a blade), the hoists' cages, the pod, the roof */
export type Place = { kind: 'fan' | 'cage' | 'pod' | 'roof'; at: V3 };
// how each sounds: its band of noise, how far it carries (the distance at which it is half as loud), how loud
const VOICE: Record<Place['kind'], { hp: number; bp?: number; ref: number; loud: number; gust?: number }> = {
  fan: { hp: 1800, bp: 3200, ref: 30, loud: 0.11, gust: 1 },
  cage: { hp: 4500, ref: 7, loud: 0.05 },
  pod: { hp: 6500, ref: 2.5, loud: 0.035 },
  roof: { hp: 2200, bp: 4200, ref: 35, loud: 0.06 },
};

// Upbeat, as it was first (it was made sad and slow for a while, and is back): 112 BPM, four bars round, A minor,
// F, C, G (as roots and the chords over them)
const BPM = 112;
const STEP = 60 / BPM / 4; // a sixteenth
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const ARP = [0, 1, 2, 1, 2, 0, 1, 2, 0, 2, 1, 0, 1, 2, 1, 2];

const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** a long hall: seconds of soft noise dying away, a few early echoes off far walls, a little different each side */
function hall(ac: BaseAudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // darker as it goes: the air takes the highs first
      lp += (Math.random() * 2 - 1 - lp) * (0.6 - 0.5 * t);
      d[i] = lp * Math.pow(1 - t, 2.4) * Math.min(1, i / (ac.sampleRate * 0.03));
    }
    for (const [ms, g] of [[61, 0.5], [97, 0.35], [143, 0.3], [211, 0.22], [287, 0.15]]) {
      const at = Math.floor(((ms * (c ? 1.07 : 1)) / 1000) * ac.sampleRate);
      if (at < n) d[at] += g * (c ? -1 : 1);
    }
  }
  return buf;
}

/** a few seconds of noise, brown (the low rumble of a big space) or white, to loop */
function noise(ac: BaseAudioContext, brown: boolean): AudioBuffer {
  const n = ac.sampleRate * 4;
  const buf = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5; } else d[i] = w;
    }
    // (the loop's seam: the last 50 ms faded into the first)
    const f = Math.floor(ac.sampleRate * 0.05);
    for (let i = 0; i < f; i++) { const t = i / f; d[n - f + i] = d[n - f + i] * (1 - t) + d[i] * t; }
  }
  return buf;
}

const LOUD = 0.4; // (all of it, into a limiter: louder hit it all the time)

export class Sound {
  readonly ac: AudioContext;
  private master: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private air: { gain: GainNode; filter: BiquadFilterNode };
  private fan: { gain: GainNode; filter: BiquadFilterNode };
  private drone: { gain: GainNode; tone: BiquadFilterNode; partials: GainNode[] };
  private hum: { gain: GainNode; pan: StereoPannerNode; tone: BiquadFilterNode };
  private drag!: { gain: GainNode; scrape: BiquadFilterNode };
  private leaf: { gain: GainNode };
  private vent: { gain: GainNode };
  private leafWas = 0;
  private far: ConvolverNode;
  private machines: GainNode[] = [];
  private spots: { gain: GainNode; tone: BiquadFilterNode; pan: StereoPannerNode }[] = [];
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private music: null | { bus: GainNode; tone: BiquadFilterNode; level: GainNode; hall: GainNode; next: number; step: number; noise: AudioBuffer } = null;
  private nextPress = 1.5;
  private pressBeat = 0;
  private nextVent = 4;
  /** each fan's blades going round: its wind, and the turns it had got to, to know when a blade comes by */
  private blades: { gain: GainNode; tone: BiquadFilterNode; pan: StereoPannerNode; passed: number }[] = [];
  private lifts: { motor: GainNode; pitch: OscillatorNode; cable: GainNode; pan: StereoPannerNode; moving: boolean }[] = [];
  private creak!: { low: GainNode; squeak: GainNode; pitch: OscillatorNode };
  private doorWas = 0;
  private nextBeep = 3;
  private on = true;

  constructor() {
    const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = (this.ac = new AC({ latencyHint: 'playback' }));
    const t = ac.currentTime;
    this.master = ac.createGain();
    this.master.gain.setValueAtTime(0, t);
    this.master.gain.linearRampToValueAtTime(LOUD, t + 5); // (it comes up slowly: no sound is switched on)
    const limit = ac.createDynamicsCompressor();
    limit.threshold.value = -10;
    limit.ratio.value = 4;
    this.master.connect(limit).connect(ac.destination);
    // deep: a steep low-pass over all of it, 24 dB an octave from 190 Hz (the beeps go round it)
    const deep = ac.createBiquadFilter();
    deep.type = 'lowpass';
    deep.frequency.value = 190;
    deep.Q.value = 0.54;
    const deep2 = ac.createBiquadFilter();
    deep2.type = 'lowpass';
    deep2.frequency.value = 190;
    deep2.Q.value = 1.3;
    deep.connect(deep2).connect(this.master);
    // the hall: everything is sent into it, the drier the nearer the eye is to what is making it
    const verb = ac.createConvolver();
    const room = hall(ac, 8);
    verb.buffer = room;
    this.wet = ac.createGain();
    this.wet.gain.value = 0.5;
    this.wet.connect(verb).connect(deep);
    this.dry = ac.createGain();
    this.dry.gain.value = 0.6;
    this.dry.connect(deep);
    // (the beeps: the same hall, not through the low-pass)
    this.far = ac.createConvolver();
    this.far.buffer = room;
    this.far.connect(this.master);
    const both = (node: AudioNode, wet = 1) => {
      node.connect(this.dry);
      if (wet === 1) node.connect(this.wet);
      else { const g = ac.createGain(); g.gain.value = wet; node.connect(g).connect(this.wet); }
    };
    const loop = (buf: AudioBuffer) => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

    // the air of the hall: a low rumble, opening up as the eye looks up into the roof and the daylight comes in
    {
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 90;
      filter.Q.value = 0.4;
      const gain = ac.createGain();
      gain.gain.value = 0.4;
      loop(noise(ac, true)).connect(filter).connect(gain);
      both(gain, 0.6);
      this.air = { gain, filter };
    }
    // the end wall's fans: a hiss through their blades, the blades' beat in it
    {
      const filter = ac.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 110;
      filter.Q.value = 0.9;
      const gain = ac.createGain();
      gain.gain.value = 0;
      const beat = ac.createGain();
      beat.gain.value = 0.7;
      const lfo = ac.createOscillator();
      lfo.frequency.value = 2.1; // five blades at a little under half a turn a second
      const depth = ac.createGain();
      depth.gain.value = 0.3;
      lfo.connect(depth).connect(beat.gain);
      lfo.start();
      loop(noise(ac, true)).connect(filter).connect(beat).connect(gain);
      both(gain);
      this.fan = { gain, filter };
    }
    // the fans' motors: a low hum under the hiss, two of them a little apart
    {
      const gain = ac.createGain();
      gain.gain.value = 0;
      const tone = ac.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 140;
      for (const [f, a] of [[49, 0.6], [50.3, 0.5], [98, 0.2]]) {
        const o = ac.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        const g = ac.createGain();
        g.gain.value = a;
        o.connect(g).connect(tone);
        o.start();
      }
      tone.connect(gain);
      both(gain);
      this.vent = { gain };
    }
    // the mains: 50 Hz and its second, a little dirty, under everything, never stopping
    {
      const gain = ac.createGain();
      gain.gain.value = 0.07;
      const shape = ac.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = (i / 255) * 2 - 1; curve[i] = Math.tanh(3 * x) * 0.8; }
      shape.curve = curve;
      for (const [f, a] of [[50, 0.6], [100, 0.3], [150, 0.08]]) {
        const o = ac.createOscillator();
        o.frequency.value = f;
        const g = ac.createGain();
        g.gain.value = a;
        o.connect(g).connect(shape);
        o.start();
      }
      shape.connect(gain);
      both(gain, 0.4);
    }
    // the machines: somewhere in the hall, big, running. Each a low saw and a band of brown noise, together
    // through a gain that throbs (a tremolo), its rate wandering a little on a slow cycle of its own
    for (const [f, rate, band, pan, level] of [
      [32.7, 3.3, 70, -0.5, 0.5],   // a great rotor, slow
      [46.2, 6.1, 110, 0.6, 0.35],  // a pump
      [58, 11.5, 160, 0.1, 0.22],   // something small and fast, a compressor
    ]) {
      const body = ac.createGain();
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = f * 2.5;
      o.connect(lp).connect(body);
      o.start();
      const nb = ac.createBiquadFilter();
      nb.type = 'bandpass';
      nb.frequency.value = band;
      nb.Q.value = 1.2;
      const ng = ac.createGain();
      ng.gain.value = 1.4;
      loop(noise(ac, true)).connect(nb).connect(ng).connect(body);
      // the throb: deep, nearly to nothing and back
      const trem = ac.createGain();
      trem.gain.value = 0.5;
      const lfo = ac.createOscillator();
      lfo.frequency.value = rate;
      const depth = ac.createGain();
      depth.gain.value = 0.45;
      lfo.connect(depth).connect(trem.gain);
      const drift = ac.createOscillator();
      drift.frequency.value = 0.03 + rate * 0.004;
      const dd = ac.createGain();
      dd.gain.value = rate * 0.08;
      drift.connect(dd).connect(lfo.frequency);
      lfo.start();
      drift.start();
      const lev = ac.createGain();
      lev.gain.value = level;
      const p = ac.createStereoPanner();
      p.pan.value = pan;
      body.connect(trem).connect(lev).connect(p);
      both(p, 0.8);
      this.machines.push(lev);
    }
    // the roof's shutter: a dull drag, as of something heavy pulled over steel. Low noise, a wide band and a
    // narrower one under it that wanders a little in pitch, and its loudness catching and slipping (two slow
    // swells out of step, never to nothing: it drags, it does not knock). No clicks, no clatter, no blows
    {
      const gain = ac.createGain();
      gain.gain.value = 0;
      const grip = ac.createGain();
      grip.gain.value = 0.75;
      for (const [f, a] of [[0.7, 0.15], [1.9, 0.1]]) {
        const lfo = ac.createOscillator();
        lfo.frequency.value = f;
        const d = ac.createGain();
        d.gain.value = a;
        lfo.connect(d).connect(grip.gain);
        lfo.start();
      }
      const wide = ac.createBiquadFilter();
      wide.type = 'lowpass';
      wide.frequency.value = 220;
      wide.Q.value = 0.6;
      const scrape = ac.createBiquadFilter();
      scrape.type = 'bandpass';
      scrape.frequency.value = 110;
      scrape.Q.value = 2.2;
      const wander = ac.createOscillator();
      wander.frequency.value = 0.27;
      const wd = ac.createGain();
      wd.gain.value = 18;
      wander.connect(wd).connect(scrape.frequency);
      wander.start();
      const src = loop(noise(ac, true));
      const sg = ac.createGain();
      sg.gain.value = 1.6;
      src.connect(wide).connect(grip);
      src.connect(scrape).connect(sg).connect(grip);
      grip.connect(gain);
      both(gain, 0.9);
      this.drag = { gain, scrape };
    }
    // the pod's door on its hinge: a low groan with how fast it swings, and a thin squeak of the knuckles over it
    {
      const low = ac.createGain();
      low.gain.value = 0;
      const lb = ac.createBiquadFilter();
      lb.type = 'bandpass';
      lb.frequency.value = 85;
      lb.Q.value = 7;
      loop(noise(ac, true)).connect(lb).connect(low);
      both(low, 0.5);
      const squeak = ac.createGain();
      squeak.gain.value = 0;
      const pitch = ac.createOscillator();
      pitch.type = 'sawtooth';
      pitch.frequency.value = 1150;
      const wob = ac.createOscillator();
      wob.frequency.value = 13;
      const wd = ac.createGain();
      wd.gain.value = 60;
      wob.connect(wd).connect(pitch.frequency);
      wob.start();
      const sb = ac.createBiquadFilter();
      sb.type = 'bandpass';
      sb.frequency.value = 2300;
      sb.Q.value = 4;
      pitch.connect(sb).connect(squeak);
      pitch.start();
      squeak.connect(this.master);
      const sw = ac.createGain();
      sw.gain.value = 0.4;
      squeak.connect(sw).connect(this.far);
      this.creak = { low, squeak, pitch };
    }
    // the fans' leaf shutters: blades grinding round on their pivots
    {
      const gain = ac.createGain();
      gain.gain.value = 0;
      const grind = ac.createBiquadFilter();
      grind.type = 'bandpass';
      grind.frequency.value = 130;
      grind.Q.value = 6;
      const g2 = ac.createBiquadFilter();
      g2.type = 'bandpass';
      g2.frequency.value = 70;
      g2.Q.value = 4;
      const src = loop(noise(ac, true));
      src.connect(grind).connect(gain);
      src.connect(g2).connect(gain);
      both(gain, 1.2);
      this.leaf = { gain };
    }
    this.white = noise(ac, false);
    this.brown = noise(ac, true);
    // the drone: a low A and its harmonics, steady, each leaning a little on its own slow swell, a pair of each a hair
    // apart so they beat; through a filter the eye opens and shuts
    {
      const tone = ac.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 120;
      tone.Q.value = 0.8;
      const gain = ac.createGain();
      gain.gain.value = 0.32;
      tone.connect(gain);
      both(gain, 1);
      const F = 27.5; // (A0: felt more than heard, its harmonics carry it)
      const partials: GainNode[] = [];
      // (a minor second over the root and a tritone over its octave: they grind against it, slowly)
      [1, 1.0595, 2, 2.828, 3, 4, 6].forEach((h, i) => {
        const g = ac.createGain();
        g.gain.value = 0;
        const swell = ac.createOscillator();
        swell.frequency.value = 0.013 + 0.011 * ((i * 7) % 5); // (minutes to come round, none in step)
        // (always there, all of them: the swell only leans on each a little. They came and went, from nothing to
        // full, and the drone was gone for stretches)
        const depth = ac.createGain();
        depth.gain.value = 0.15 / Math.sqrt(h);
        const rest = ac.createConstantSource();
        rest.offset.value = 0.6 / Math.sqrt(h);
        swell.connect(depth).connect(g.gain);
        rest.connect(g.gain);
        swell.start(t + i * 3.1);
        rest.start();
        for (const cents of [-4, 4]) {
          const o = ac.createOscillator();
          o.type = h === 1 ? 'triangle' : 'sine';
          o.frequency.value = F * h;
          o.detune.value = cents + (i % 3) - 1;
          o.connect(g);
          o.start();
        }
        g.connect(tone);
        partials.push(g);
      });
      this.drone = { gain, tone, partials };
    }
    // the pod's hum: something running in it, low, a little rough, swelling as the red light breathes; where the
    // pod is in the picture
    {
      const tone = ac.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 110;
      const shape = ac.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = (i / 255) * 2 - 1; curve[i] = Math.tanh(2.2 * x); }
      shape.curve = curve;
      const gain = ac.createGain();
      gain.gain.value = 0;
      const pan = ac.createStereoPanner();
      for (const [f, a] of [[41.2, 0.7], [82.4, 0.25], [61.7, 0.12]]) {
        const o = ac.createOscillator();
        o.frequency.value = f;
        const g = ac.createGain();
        g.gain.value = a;
        o.connect(g).connect(shape);
        o.start();
      }
      shape.connect(tone).connect(gain).connect(pan);
      both(pan, 0.5);
      this.hum = { gain, pan, tone };
    }
  }

  get running() {
    return this.ac.state === 'running';
  }

  /** on or off: faded, not cut */
  set muted(m: boolean) {
    this.on = !m;
    this.master.gain.cancelScheduledValues(this.ac.currentTime);
    this.master.gain.setTargetAtTime(m ? 0 : LOUD, this.ac.currentTime, 0.4);
  }

  /** the leaf shutters coming to the end of their travel, or starting off: a heavy metal clack, mostly the hall's */
  private clack(at: number, loud: number) {
    const ac = this.ac;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.25), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.04));
    const s = ac.createBufferSource();
    s.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 90 + Math.random() * 40;
    f.Q.value = 3;
    const g = ac.createGain();
    g.gain.value = loud * 3;
    s.connect(f).connect(g);
    g.connect(this.wet);
    const d2 = ac.createGain();
    d2.gain.value = 0.3;
    g.connect(d2).connect(this.dry);
    s.start(at);
  }

  /** a knock of metal: a low thud (into the hall's deep sound) and a sharp click on top (round it), at a side
   * and a loudness; `ring` gives the click a short metallic ring, as a latch or a gate has */
  private knock(at: number, loud: number, side = 0, ring = 0) {
    const ac = this.ac;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.4), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.02));
    const pan = ac.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, side));
    // the thud
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(95, at);
    o.frequency.exponentialRampToValueAtTime(38, at + 0.12);
    const og = ac.createGain();
    og.gain.setValueAtTime(0, at);
    og.gain.linearRampToValueAtTime(loud, at + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    o.connect(og);
    og.connect(this.dry);
    og.connect(this.wet);
    o.start(at);
    o.stop(at + 0.4);
    // the click, and its ring
    const src = ac.createBufferSource();
    src.buffer = buf;
    const hp = ac.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 2600 + Math.random() * 1400;
    hp.Q.value = 1 + ring * 12;
    const cg = ac.createGain();
    cg.gain.value = loud * (0.35 + ring * 0.8);
    src.connect(hp).connect(cg).connect(pan);
    pan.connect(this.master);
    const w = ac.createGain();
    w.gain.value = 0.5;
    pan.connect(w).connect(this.far);
    src.start(at);
  }

  /** a hiss of air let out, short (the door's seal, a lift's brake) */
  private puff(at: number, loud: number, len: number, side = 0) {
    const ac = this.ac;
    const src = ac.createBufferSource();
    src.buffer = this.white;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(loud, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, at + len);
    const pan = ac.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, side));
    src.connect(hp).connect(g).connect(pan);
    pan.connect(this.master);
    const w = ac.createGain();
    w.gain.value = 0.4;
    pan.connect(w).connect(this.far);
    src.start(at, Math.random());
    src.stop(at + len + 0.1);
  }

  /** the door's latch letting go: a hard click, a knock, and the seal's air out */
  latch() {
    if (!this.running) return;
    const t = this.ac.currentTime + 0.01;
    this.knock(t, 0.5, 0, 1);
    this.knock(t + 0.07, 0.3, 0, 0.3);
    this.puff(t + 0.05, 0.06, 0.9);
  }

  /** the door's lamp gone green: two short square beeps, the second higher, as a machine says yes */
  ok() {
    if (!this.running) return;
    const ac = this.ac, t = ac.currentTime + 0.02;
    [[880, 0], [1319, 0.11]].forEach(([f, dt]) => {
      const o = ac.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5000;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(0.035, t + dt + 0.003);
      g.gain.setValueAtTime(0.035, t + dt + 0.07);
      g.gain.linearRampToValueAtTime(0, t + dt + 0.075);
      o.connect(lp).connect(g);
      g.connect(this.master);
      const w = ac.createGain();
      w.gain.value = 0.3;
      g.connect(w).connect(this.far);
      o.start(t + dt);
      o.stop(t + dt + 0.1);
    });
  }

  /** the door caught open by its stay: a ratchet's click and a knock */
  caught() {
    if (!this.running) return;
    const t = this.ac.currentTime + 0.01;
    this.knock(t, 0.35, 0, 0.8);
  }

  /** an arrival chime, as a lift has: two notes falling, soft, ringing */
  private chime(at: number, loud: number, side: number) {
    const ac = this.ac;
    const pan = ac.createStereoPanner();
    pan.pan.value = side;
    pan.connect(this.master);
    const w = ac.createGain();
    w.gain.value = 0.7;
    pan.connect(w).connect(this.far);
    [[1319, 0], [1047, 0.32]].forEach(([f, dt]) => {
      for (const [h, a] of [[1, 1], [2.76, 0.25]]) {
        const o = ac.createOscillator();
        o.frequency.value = f * h;
        const g = ac.createGain();
        g.gain.setValueAtTime(0, at + dt);
        g.gain.linearRampToValueAtTime(loud * a, at + dt + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dt + 1.4);
        o.connect(g).connect(pan);
        o.start(at + dt);
        o.stop(at + dt + 1.5);
      }
    });
  }

  /** a voice for a hoist's cage: its motor, low (pitch up with its speed), and the cable running over its sheave */
  private lift(i: number) {
    const ac = this.ac;
    const pan = ac.createStereoPanner();
    const motor = ac.createGain();
    motor.gain.value = 0;
    const pitch = ac.createOscillator();
    pitch.type = 'sawtooth';
    pitch.frequency.value = 40;
    const ml = ac.createBiquadFilter();
    ml.type = 'lowpass';
    ml.frequency.value = 160;
    pitch.connect(ml).connect(motor);
    pitch.start();
    motor.connect(pan);
    // (the motor into the deep sound, panned; the cable's ticks round it)
    pan.connect(this.dry);
    pan.connect(this.wet);
    const cable = ac.createGain();
    cable.gain.value = 0;
    const ticks = ac.createGain();
    ticks.gain.value = 0;
    const tk = ac.createOscillator();
    tk.type = 'square';
    tk.frequency.value = 5 + i;
    const tkd = ac.createGain();
    tkd.gain.value = 0.5;
    tk.connect(tkd).connect(ticks.gain);
    const tkc = ac.createConstantSource();
    tkc.offset.value = 0.5;
    tkc.connect(ticks.gain);
    tk.start();
    tkc.start();
    const cb = ac.createBiquadFilter();
    cb.type = 'bandpass';
    cb.frequency.value = 3400;
    cb.Q.value = 4;
    const src = ac.createBufferSource();
    src.buffer = this.white;
    src.loop = true;
    src.start(ac.currentTime, Math.random() * 3);
    const cp = ac.createStereoPanner();
    src.connect(cb).connect(ticks).connect(cable).connect(cp);
    cp.connect(this.master);
    const cw = ac.createGain();
    cw.gain.value = 0.5;
    cp.connect(cw).connect(this.far);
    // (the two panners kept as one: the cable's follows the motor's)
    pan.pan.value = 0;
    const v = { motor, pitch, cable, pan, moving: false };
    (v as unknown as { cp: StereoPannerNode }).cp = cp;
    return (this.lifts[i] = v);
  }

  /** a fan's wind: a bed of air through its blades, low and broad, as a big turbine has; its gusts (one a blade,
   * as each comes by: update) laid over it */
  private blade(k: number) {
    const ac = this.ac;
    const src = ac.createBufferSource();
    src.buffer = this.brown;
    src.loop = true;
    src.start(ac.currentTime, k * 1.3);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 300;
    bp.Q.value = 0.5;
    const tone = ac.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 600;
    const gain = ac.createGain();
    gain.gain.value = 0;
    const pan = ac.createStereoPanner();
    src.connect(bp).connect(tone).connect(gain).connect(pan);
    pan.connect(this.master);
    const w = ac.createGain();
    w.gain.value = 0.4;
    pan.connect(w).connect(this.far);
    return (this.blades[k] = { gain, tone, pan, passed: NaN });
  }

  /** a blade of a fan coming by: a gust, as a turbine's, swelling and falling over two or three seconds, its band
   * rising as the blade comes and falling as it goes */
  private gust(at: number, loud: number, side: number, bright: number) {
    const ac = this.ac;
    const src = ac.createBufferSource();
    src.buffer = this.brown;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(220, at);
    bp.frequency.linearRampToValueAtTime(380 + 400 * bright, at + 1.1);
    bp.frequency.linearRampToValueAtTime(200, at + 2.8);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(loud, at + 1.1);
    g.gain.linearRampToValueAtTime(0, at + 2.8);
    const pan = ac.createStereoPanner();
    pan.pan.value = side;
    src.connect(bp).connect(g).connect(pan);
    pan.connect(this.master);
    const w = ac.createGain();
    w.gain.value = 0.5;
    pan.connect(w).connect(this.far);
    src.start(at, Math.random() * 3);
    src.stop(at + 3);
  }

  /** a bus for the vibrating metal: a little of it straight, most of it into the hall, and a second, longer and
   * darker tail on top of that, so it hangs in the air after it has stopped */
  private shaken(at: number, side: number, dry: number, len: number, wet = 1.1) {
    const ac = this.ac;
    const pan = ac.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, side));
    const d = ac.createGain();
    d.gain.value = dry;
    pan.connect(d).connect(this.master);
    const w = ac.createGain();
    w.gain.value = wet;
    pan.connect(w).connect(this.far);
    // (the tail on the tail: the hall again, through a low-pass, a little later)
    const dl = ac.createDelay(0.5);
    dl.delayTime.value = 0.18;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const w2 = ac.createGain();
    w2.gain.value = wet * 0.5;
    pan.connect(dl).connect(lp).connect(w2).connect(this.far);
    void at; void len;
    return pan;
  }

  /** Great metal under strain, after the reference (a gigantic metal groan), made of vibration: the modes of a big
   * steel plate as tones, crowded and out of tune with each other, each trembling (a quick vibrato, a quicker
   * tremor in its loudness, more as the strain comes on), all of them sliding down as the steel gives, and the
   * hall's reverb laid thick on top. A strained build for a third of it, low modes only; then it gives with a bang
   * and all of them ring; the top ones die first. `size` scales it (1, the shutter's frame; less, a hoist's cage) */
  groan(at: number, loud: number, side: number, size = 1) {
    const ac = this.ac;
    const len = 5 + 10 * size, give = at + 0.37 * len, hold = at + 0.72 * len;
    const out = this.shaken(at, side, 0.8, len, 0.55);
    // the whole plate shaking, in bursts with gaps between: one gate for all of it, square, all the way to nothing
    // and back, a few times a second; the gaps wider as the steel lets go
    const shake = ac.createGain();
    shake.gain.value = 0.5;
    const sh = ac.createOscillator();
    sh.type = 'square';
    sh.frequency.setValueAtTime(3.2 + Math.random(), at);
    sh.frequency.linearRampToValueAtTime(5 + Math.random(), give);
    sh.frequency.linearRampToValueAtTime(2.5, at + len);
    const shd = ac.createGain();
    shd.gain.value = 0.5;
    sh.connect(shd).connect(shake.gain);
    shake.connect(out);
    sh.start(at);
    sh.stop(at + len + 0.1);
    const f0 = 34 / Math.pow(size, 0.8); // (the shutter's frame: deep; a hoist's cage, higher)
    const top = 900 + 2400 * (1 - size); // (and the frame's modes kept low)
    const N = 26;
    for (let i = 0; i < N; i++) {
      const f = f0 * Math.pow(i + 1, 1.32) * (0.96 + Math.random() * 0.08);
      if (f > top) break;
      const hi = Math.min(1, Math.log2(f / f0) / 6);
      const o = ac.createOscillator();
      o.type = i < 3 ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(f * 1.012, at);
      o.frequency.linearRampToValueAtTime(f, give);
      o.frequency.linearRampToValueAtTime(f * (0.95 - 0.02 * Math.random()), at + len);
      // the vibrato: a few cents, faster up the modes, wider as it strains
      const vib = ac.createOscillator();
      vib.frequency.value = 4 + Math.random() * 4 + hi * 5;
      const vd = ac.createGain();
      vd.gain.setValueAtTime(f * 0.002, at);
      vd.gain.linearRampToValueAtTime(f * 0.009, give);
      vd.gain.linearRampToValueAtTime(f * 0.003, at + len);
      vib.connect(vd).connect(o.frequency);
      // (and a quick roughness of its own in each, slight)
      const trem = ac.createGain();
      trem.gain.value = 0.85;
      const tl = ac.createOscillator();
      tl.frequency.value = 11 + Math.random() * 9;
      const td = ac.createGain();
      td.gain.value = 0.15;
      tl.connect(td).connect(trem.gain);
      const a = (loud * 1.3 * (0.5 + Math.random())) / (1 + i * 0.22);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(a * (0.4 - 0.38 * hi), give - 0.05);
      g.gain.linearRampToValueAtTime(a, give + 0.03);
      g.gain.linearRampToValueAtTime(a * (0.75 - 0.3 * hi), hold);
      g.gain.exponentialRampToValueAtTime(a * 0.001, hold + (at + len - hold) * (1 - 0.6 * hi));
      o.connect(trem).connect(g).connect(shake);
      for (const x of [o, vib, tl]) { x.start(at); x.stop(at + len + 0.1); }
    }
    // the floor shaking under it: a low tone, throbbing, into the deep sound
    const sub = ac.createOscillator();
    sub.frequency.setValueAtTime(f0 * 0.5, at);
    sub.frequency.linearRampToValueAtTime(f0 * 0.46, at + len);
    const st = ac.createGain();
    st.gain.value = 0.5;
    const sl = ac.createOscillator();
    sl.type = 'square';
    sl.frequency.value = 5;
    const sld = ac.createGain();
    sld.gain.value = 0.5;
    sl.connect(sld).connect(st.gain);
    const sg = ac.createGain();
    sg.gain.setValueAtTime(0, at);
    sg.gain.linearRampToValueAtTime(loud * 1.5, give);
    sg.gain.exponentialRampToValueAtTime(0.0005, at + len);
    sub.connect(st).connect(sg);
    sg.connect(this.dry);
    sg.connect(this.wet);
    for (const x of [sub, sl]) { x.start(at); x.stop(at + len + 0.1); }
    // where it gives: a bang
    this.knock(give, Math.min(0.7, loud * 3), side, 1);
  }

  /** a voice for a place in the hall: a band of noise, filtered brighter as the eye turns to it, panned to where
   * it is; a fan's gusts in a rhythm, a gust a blade (round the low-pass: a hiss is all top) */
  private spot(i: number, kind: Place['kind']) {
    const ac = this.ac, v = VOICE[kind];
    const src = ac.createBufferSource();
    src.buffer = this.white;
    src.loop = true;
    src.start(ac.currentTime, Math.random() * 3);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = v.hp;
    let head: AudioNode = src.connect(hp);
    if (v.bp) { const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = v.bp; bp.Q.value = 0.6; head = head.connect(bp); }
    if (v.gust) {
      // a gust a blade: a ramp up and a sharp fall, the blades going by
      const gate = ac.createGain();
      gate.gain.value = 0.35;
      const lfo = ac.createOscillator();
      lfo.type = 'sawtooth';
      lfo.frequency.value = 1.1 + 0.27 * i;
      const d = ac.createGain();
      d.gain.value = 0.35;
      lfo.connect(d).connect(gate.gain);
      lfo.start(ac.currentTime + i * 0.31);
      head = head.connect(gate);
    }
    const tone = ac.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3000;
    const gain = ac.createGain();
    gain.gain.value = 0;
    const pan = ac.createStereoPanner();
    head.connect(tone).connect(gain).connect(pan);
    pan.connect(this.master);
    const w = ac.createGain();
    w.gain.value = 0.35;
    pan.connect(w).connect(this.far);
    return (this.spots[i] = { gain, tone, pan });
  }

  /** Something playing in there: synth pop, muffled through the pod's steel. Started by the first press on the pod;
   * it plays on from then, and how much of it comes out is the door's and the eye's (update) */
  startMusic() {
    if (this.music) return;
    const ac = this.ac;
    const bus = ac.createGain();
    const tone = ac.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 180;
    tone.Q.value = 0.9;
    const level = ac.createGain();
    level.gain.value = 0;
    bus.connect(tone).connect(level);
    // (round the hall's low-pass: it is the one thing in here with a top to it, when the door lets it out)
    level.connect(this.master);
    const hall = ac.createGain();
    hall.gain.value = 0.2;
    level.connect(hall).connect(this.far);
    const nb = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.music = { bus, tone, level, hall, next: ac.currentTime + 0.1, step: 0, noise: nb };
  }

  /** one sixteenth of it, at time `at` */
  private play(step: number, at: number) {
    const m = this.music!, ac = this.ac;
    const s16 = step % 16, bar = Math.floor(step / 16) % 4;
    const chord = CHORDS[bar];
    const env = (g: GainNode, peak: number, a: number, d: number) => {
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + a);
      g.gain.exponentialRampToValueAtTime(0.0001, at + a + d);
    };
    const osc = (type: OscillatorType, f: number, peak: number, a: number, d: number, cut = 0, detune = 0) => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      const g = ac.createGain();
      env(g, peak, a, d);
      if (cut) { const l = ac.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = cut; o.connect(l).connect(g); } else o.connect(g);
      g.connect(m.bus);
      o.start(at);
      o.stop(at + a + d + 0.05);
    };
    const hiss = (peak: number, d: number, type: BiquadFilterType, f: number) => {
      const src = ac.createBufferSource();
      src.buffer = m.noise;
      const b = ac.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      const g = ac.createGain();
      env(g, peak, 0.002, d);
      src.connect(b).connect(g).connect(m.bus);
      src.start(at, Math.random() * 0.5);
      src.stop(at + d + 0.05);
    };
    // the kick: four to the floor
    if (s16 % 4 === 0) {
      const o = ac.createOscillator();
      o.frequency.setValueAtTime(150, at);
      o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      const g = ac.createGain();
      env(g, 0.9, 0.002, 0.3);
      o.connect(g).connect(m.bus);
      o.start(at);
      o.stop(at + 0.35);
    }
    // the snare on two and four, a clap's worth of noise and a little tone
    if (s16 === 4 || s16 === 12) { hiss(0.45, 0.18, 'bandpass', 1800); osc('triangle', 190, 0.2, 0.001, 0.08); }
    // the hats, on the offbeats, and a quiet one on every other sixteenth
    if (s16 % 4 === 2) hiss(0.18, 0.05, 'highpass', 7000);
    else if (s16 % 2 === 1) hiss(0.05, 0.03, 'highpass', 9000);
    // the bass: eighths, the root, up an octave on the offbeat
    if (s16 % 2 === 0) osc('sawtooth', midi(chord[0] - 24 + (s16 % 4 === 2 ? 12 : 0)), 0.35, 0.005, 0.2, 700);
    // the arpeggio: sixteenths up and down the chord, two octaves up, a square
    osc('square', midi(chord[ARP[s16]] + 12), 0.07, 0.003, 0.12, 3200);
    // the pad: the chord at the bar's start, slow in, held, two detuned saws a note
    if (s16 === 0) for (const n of chord) for (const c of [-8, 8]) osc('sawtooth', midi(n), 0.035, 0.4, STEP * 16 + 0.6, 1400, c);
    // and the hook, every other bar: a few notes over it
    if (bar % 2 === 1 && [0, 3, 6, 10].includes(s16)) osc('triangle', midi(chord[[2, 1, 2, 0][[0, 3, 6, 10].indexOf(s16)]] + 24), 0.09, 0.01, 0.25);
  }

  /** a press somewhere in the hall, working: a heavy thump, the pitch dropping as it lands, and its echo */
  private press(at: number, loud: number) {
    const ac = this.ac;
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(70, at);
    o.frequency.exponentialRampToValueAtTime(28, at + 0.25);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(loud, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
    o.connect(g);
    g.connect(this.wet);
    const d = ac.createGain();
    d.gain.value = 0.4;
    g.connect(d).connect(this.dry);
    o.start(at);
    o.stop(at + 0.8);
  }

  /** a pressure vent letting go somewhere in the hall: a hiss that comes on hard, holds, and dies away; now and
   * then a short one first. High (round the low-pass), from a side, much of it the hall's */
  private release(at: number) {
    const ac = this.ac;
    const pan = ac.createStereoPanner();
    pan.pan.value = Math.random() * 1.8 - 0.9;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500 + Math.random() * 2500;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000 + Math.random() * 5000;
    const g = ac.createGain();
    g.gain.value = 0;
    const loud = 0.04 + Math.random() * 0.07;
    let s0 = at;
    if (Math.random() < 0.35) { // a short one first: pff
      g.gain.setValueAtTime(0, s0);
      g.gain.linearRampToValueAtTime(loud * 0.7, s0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0005, s0 + 0.18);
      s0 += 0.35;
    }
    const hold = 0.4 + Math.random() * 1.6;
    g.gain.setValueAtTime(0.0005, s0);
    g.gain.linearRampToValueAtTime(loud, s0 + 0.04);
    g.gain.setValueAtTime(loud, s0 + 0.04 + hold);
    g.gain.exponentialRampToValueAtTime(0.0005, s0 + 0.04 + hold + 0.5 + Math.random() * 0.6);
    const src = ac.createBufferSource();
    src.buffer = this.white;
    src.connect(hp).connect(lp).connect(g).connect(pan);
    pan.connect(this.far);
    const d = ac.createGain();
    d.gain.value = 0.4;
    pan.connect(d).connect(this.master);
    src.start(at, Math.random() * 2);
    src.stop(s0 + hold + 1.4);
  }

  /** a beep, far off somewhere in the hall: a machine done, a hoist come to a floor. Short, high, mostly the
   * hall's tail, from a side */
  private beep(at: number) {
    // as a monitor by a bed beeps: a square, short and flat, the one note; one, or two close, or now and then the
    // three of an alarm
    const ac = this.ac;
    const f = 988; // (B5, always: a machine's note, not a tune)
    const r = Math.random();
    const n = r < 0.55 ? 1 : r < 0.85 ? 2 : 3;
    const gap = n === 3 ? 0.16 : 0.13;
    const pan = ac.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const far = ac.createBiquadFilter();
    far.type = 'lowpass';
    far.frequency.value = 4500 + Math.random() * 2500; // (enough top left for it to be a square)
    const g = ac.createGain();
    g.gain.value = 0;
    const loud = 0.018 + Math.random() * 0.018;
    for (let k = 0; k < n; k++) {
      const s = at + k * gap;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(loud, s + 0.002);
      g.gain.setValueAtTime(loud, s + 0.055);
      g.gain.linearRampToValueAtTime(0, s + 0.06);
    }
    const o = ac.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(g).connect(far).connect(pan);
    pan.connect(this.far);
    const d = ac.createGain();
    d.gain.value = 0.25; // (little of it reaches the eye straight)
    pan.connect(d).connect(this.master);
    o.start(at);
    o.stop(at + n * gap + 0.1);
  }

  /** each frame: where the eye is and what it sees */
  update(dt: number, e: Ear) {
    if (!this.running || !this.on) return;
    const ac = this.ac, t = ac.currentTime, k = 0.25; // (eased towards, a quarter of a second)
    const near = 1 - smooth(e.dist, 2.5, 18); // 1 close on the pod, 0 out in the hall
    const up = smooth(e.up, 0.1, 0.8);
    // the room: drier close in, the hall's tail when drawn back
    this.dry.gain.setTargetAtTime(0.45 + 0.35 * near, t, k);
    this.wet.gain.setTargetAtTime(0.75 - 0.35 * near, t, k);
    // the air: brighter and a little louder looking up, more with the roof open
    this.air.filter.frequency.setTargetAtTime(70 + 60 * up + 50 * e.day, t, k);
    this.air.gain.gain.setTargetAtTime(0.35 + 0.15 * up + 0.1 * e.day, t, k);
    this.fan.gain.gain.setTargetAtTime(0.16 * e.fans * (0.4 + 0.6 * up), t, k);
    this.fan.filter.frequency.setTargetAtTime(90 + 50 * up, t, k);
    // the drone: its higher harmonics come through near the pod, and with the light from the roof
    this.drone.tone.frequency.setTargetAtTime(70 + 90 * near + 40 * e.day * up, t, 0.6);
    // and the bass swells with the end wall's middle fan: a slow tremolo in step with its blades, up as each blade
    // comes round to the top and down between (a blade every six seconds or so, as slow as they turn); deeper
    // with the fans open
    const turn = e.fanTurns[1] ?? e.fanTurns[0] ?? 0;
    const swell = 0.5 + 0.5 * Math.cos(turn * 5);
    // and over that it breathes, slowly: it comes up over some ten seconds, stays a while, goes down to almost
    // nothing and is gone for a few seconds before it comes back. Never quite the same length twice (two slow
    // cycles, out of step, decide)
    const ph = t / 26 + 0.15 * Math.sin(t / 61);
    const breath = Math.pow(0.5 - 0.5 * Math.cos(ph * Math.PI * 2), 1.5);
    this.drone.gain.gain.setTargetAtTime(0.36 * (0.04 + 0.96 * breath) * (1 - 0.6 * e.fans * (1 - swell)), t, 0.1);
    // the hum: loud close in and where the pod is, breathing; a murmur from far
    this.hum.gain.gain.setTargetAtTime((0.02 + 0.2 * near * near) * (0.45 + 0.55 * e.beat), t, 0.08);
    this.hum.tone.frequency.setTargetAtTime(70 + 70 * near + 40 * e.beat, t, 0.1);
    this.hum.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, e.pan)) * (0.3 + 0.5 * (1 - near)), t, k);
    // the fans: their motors, louder looking towards them (up), and the leaf shutters as they move
    this.vent.gain.gain.setTargetAtTime(0.14 * e.fans * (0.5 + 0.5 * up), t, k);
    // the shutter, dragging: with how fast it goes, more looking up; a little deeper as it slows
    const roll = Math.min(1, e.roll);
    this.drag.gain.gain.setTargetAtTime(1.1 * roll * (0.55 + 0.45 * up), t, 0.3);
    this.drag.scrape.Q.setTargetAtTime(1.6 + roll, t, 0.3);
    this.leaf.gain.gain.setTargetAtTime(0.5 * Math.min(1, e.leaf), t, 0.08);
    // (a clack where the blades set off and where they stop)
    const moving = e.leaf > 0.05 ? 1 : 0;
    if (moving !== this.leafWas) { this.clack(t + 0.02, moving ? 0.25 : 0.45); this.leafWas = moving; }
    // the press: a thump every 2.6 s, now and then a double, a bar now and then left out; louder drawn back,
    // where the hall is
    this.nextPress -= dt;
    if (this.nextPress <= 0) {
      const n = this.pressBeat++ % 8;
      const loud = 0.12 + 0.12 * (1 - near);
      if (n !== 7) this.press(t + 0.05, loud);
      if (n === 3) this.press(t + 0.38, loud * 0.6);
      this.nextPress = 2.6;
    }
    // the places: each louder as the eye comes to it and turns to it, brighter facing it, panned where it is
    let fanK = 0;
    e.places.forEach((pl, i) => {
      if (pl.kind === 'fan') {
        // the fan's wind, and a gust each time one of its five blades comes round: as it turns, not on a clock
        const b = this.blades[fanK] ?? this.blade(fanK);
        const dx = pl.at.x - e.eye.x, dy = pl.at.y - e.eye.y, dz = pl.at.z - e.eye.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const facing = Math.max(0, (dx * e.fwd.x + dy * e.fwd.y + dz * e.fwd.z) / d);
        const side = Math.max(-1, Math.min(1, ((dx * e.right.x + dy * e.right.y + dz * e.right.z) / d) * 1.2));
        const near = ((0.45 + 0.55 * facing) / (1 + (d / 45) * (d / 45))) * e.fans;
        b.gain.gain.setTargetAtTime(0.35 * near, t, 0.2);
        b.tone.frequency.setTargetAtTime(350 + 900 * facing / (1 + d / 60), t, 0.2);
        b.pan.pan.setTargetAtTime(side, t, 0.2);
        const passed = Math.floor(((e.fanTurns[fanK] ?? 0) * 5) / (Math.PI * 2));
        if (b.passed === b.passed && passed !== b.passed && near > 0.01) this.gust(t + 0.02, 0.5 * near, side, facing);
        b.passed = passed;
        fanK++;
      }
      const v = VOICE[pl.kind];
      const s = this.spots[i] ?? this.spot(i, pl.kind);
      const dx = pl.at.x - e.eye.x, dy = pl.at.y - e.eye.y, dz = pl.at.z - e.eye.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const facing = (dx * e.fwd.x + dy * e.fwd.y + dz * e.fwd.z) / d;
      const side = (dx * e.right.x + dy * e.right.y + dz * e.right.z) / d;
      const k2 = pl.kind === 'roof' ? e.day + 0.15 : pl.kind === 'fan' ? e.fans : 1;
      const loud = (v.loud * k2 * (0.35 + 0.65 * Math.max(0, facing))) / (1 + (d / v.ref) * (d / v.ref));
      s.gain.gain.setTargetAtTime(loud, t, 0.15);
      s.tone.frequency.setTargetAtTime(1800 + 9000 * Math.max(0, facing) / (1 + d / (v.ref * 2)), t, 0.15);
      s.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, side * 1.2)), t, 0.15);
    });
    // the hoists' cages, where they are: the motor and the cable as they ride, louder near and facing; a clunk and
    // the gate's rattle where one stops, its chime as it arrives, a clunk where it sets off
    e.cages.forEach((c, i) => {
      const v = this.lifts[i] ?? this.lift(i);
      const dx = c.at.x - e.eye.x, dy = c.at.y - e.eye.y, dz = c.at.z - e.eye.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const facing = Math.max(0, (dx * e.fwd.x + dy * e.fwd.y + dz * e.fwd.z) / d);
      const side = Math.max(-1, Math.min(1, ((dx * e.right.x + dy * e.right.y + dz * e.right.z) / d) * 1.2));
      const near = (0.4 + 0.6 * facing) / (1 + (d / 12) * (d / 12));
      const sp = Math.min(1, Math.abs(c.speed) / 1.2);
      v.motor.gain.setTargetAtTime(0.5 * sp * near, t, 0.2);
      v.pitch.frequency.setTargetAtTime(32 + 26 * sp, t, 0.3);
      v.cable.gain.setTargetAtTime(0.06 * sp * near, t, 0.2);
      v.pan.pan.setTargetAtTime(side, t, 0.15);
      (v as unknown as { cp: StereoPannerNode }).cp.pan.setTargetAtTime(side, t, 0.15);
      const moving = sp > 0.03;
      if (moving !== v.moving) {
        v.moving = moving;
        const loud = Math.min(0.6, 0.9 * near);
        if (loud > 0.01) {
          this.knock(t + 0.02, loud, side, 0.6);
          if (!moving) {
            this.knock(t + 0.35, loud * 0.5, side, 1); // the gate
            this.knock(t + 0.5, loud * 0.35, side, 1);
            this.chime(t + 0.9, Math.min(0.05, 0.1 * near), side);
            this.groan(t + 0.1, Math.min(0.12, 0.25 * near), side, 0.45);
          } else this.puff(t + 0.05, 0.03 * near, 0.5, side); // the brake let off
        }
      }
    });
    // the door on its hinge, as it swings; a knock where it comes to a stop after swinging
    const ds = Math.min(1, Math.abs(e.doorSpeed) / 1.5);
    const dn = 0.4 + 0.6 * near;
    this.creak.low.gain.setTargetAtTime(0.9 * ds * dn, t, 0.05);
    this.creak.squeak.gain.setTargetAtTime(0.012 * Math.max(0, ds - 0.1) * dn, t, 0.05);
    this.creak.pitch.frequency.setTargetAtTime(950 + 500 * ds, t, 0.1);
    if (this.doorWas > 0.4 && ds < 0.05) this.knock(t + 0.01, 0.35 * this.doorWas * dn, e.pan * 0.4, 0.3);
    this.doorWas = ds < 0.05 ? 0 : Math.max(this.doorWas * 0.9, ds);
    // the music in the pod: through its steel, low and dull, and opening up with the door and as the eye comes to
    // the opening; panned with the pod
    if (this.music) {
      const m = this.music;
      while (m.next < t + 0.25) { this.play(m.step, m.next); m.step++; m.next += STEP; }
      const out = Math.max(Math.min(1, e.door), 0);
      const clear = out * (0.55 + 0.45 * e.inside);
      m.tone.frequency.setTargetAtTime(170 + 9000 * Math.pow(clear, 1.6), t, 0.12);
      m.level.gain.setTargetAtTime((0.1 + 0.35 * out + 0.35 * e.inside * out) * (0.4 + 0.6 * near), t, 0.12);
      m.hall.gain.setTargetAtTime(0.15 + 0.5 * out * (1 - e.inside), t, 0.2);
    }
    // a pressure vent letting go, every six to eighteen seconds
    this.nextVent -= dt;
    if (this.nextVent <= 0) {
      this.release(t + 0.05);
      this.nextVent = 6 + Math.random() * 12;
    }
    // a beep now and then, far off
    this.nextBeep -= dt;
    if (this.nextBeep <= 0) {
      this.beep(t + 0.05);
      this.nextBeep = 4 + Math.random() * 9;
    }
  }
}
