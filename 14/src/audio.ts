// The sound: the wire's worklet (stereo), then a body (two low resonances, like a big wooden
// box), a warm low pass, a big dark room (early reflections, then a long tail made of noise
// that darkens as it dies), and a master that cannot be pushed into anything ugly: soft
// saturation, a shelf off the top, a compressor and a limiter.

import workletUrl from './wire.worklet.ts?worker&url';
import type { PluckMsg, WireMsg } from './wire.worklet';
import { Pad } from './pad';
import { PRESETS, midiHz, partialsFor, ring, snap, type Partials, type Preset } from './presets';

export interface Tune {
  volume: number;
  wet: number;
  /** a factor on the preset's room length */
  size: number;
  buzz: number;
  sym: number;
  glide: number;
  /** body resonances, sub and chorus, scaled */
  body: number;
  sub: number;
  detune: number;
  bloom: number;
  pad: number;
  /** how rubbery the pitch is: the snap back from sharp and the wobble after a pluck */
  elastic: number;
  /** the flageolets' level (the bar's knob): 1 as designed, 0 none, 2 twice */
  harm: number;
}

/** the arpeggiator's tempo (its delay is synced to it) */
export const ARP_BPM = 90;

export const tune: Tune = { volume: 0.8, wet: 1, size: 1, buzz: 1, sym: 1, glide: 0.5, body: 1, sub: 1, detune: 1, bloom: 1, pad: 1, elastic: 0.5, harm: 1 };

export interface PluckOpts {
  /** the note, midi */
  note: number;
  /** where along the wire, 0..1 */
  pos: number;
  kind: 'pluck' | 'strike';
  /** 0..1, how hard */
  force: number;
  /** the coin touching lightly: a damped buzz */
  chiado: boolean;
  /**
   * how the playing hand plays it: 'harm' a flageolet (a finger touching the middle: only the
   * even partials, an octave up, ringing long), 'snap' pulled hard against the wire (bright,
   * buzzing, a big pitch drop at the start); none, a plain pluck
   */
  tech?: 'harm' | 'snap';
}

/**
 * A made-up big room, stereo: a handful of early reflections (different on each side), then a
 * long tail of noise that falls off exponentially and darkens as it goes.
 */
function impulse(ctx: BaseAudioContext, seconds: number) {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, n, sr);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const pre = 0.018;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    let lp2 = 0;
    const p0 = Math.floor(pre * sr);
    for (let i = p0; i < n; i++) {
      const t = (i - p0) / sr;
      // brightness falls with time: a two pole low pass sliding from ~5 kHz to ~350 Hz
      const fc = 350 + 4650 * Math.exp(-t * 2.6);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += (rnd() - lp) * a;
      lp2 += (lp - lp2) * a;
      // the tail swells in over the first 80 ms, under the reflections
      const swell = Math.min(1, t / 0.08);
      d[i] = lp2 * Math.exp((-6.91 * t) / seconds) * swell * 1.6;
    }
    // early reflections: walls and floor of a large hall, 12 to 90 ms, one side a little later
    for (let r = 0; r < 9; r++) {
      const t = 0.012 + r * 0.0095 + (rnd() * 0.004) + c * 0.0031 * ((r % 3) - 1);
      const i = Math.floor(t * sr);
      const g = 0.55 * Math.exp(-t * 18) * (r % 2 ? -1 : 1);
      // each one a short blur, not a click
      for (let j = 0; j < 24; j++) if (i + j < n) d[i + j] += g * Math.sin((Math.PI * j) / 24) * 0.5;
    }
  }
  let e = 0;
  for (let c = 0; c < 2; c++) for (const x of buf.getChannelData(c)) e += x * x;
  const g = 1 / Math.sqrt(e / 2);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= g;
  }
  return buf;
}

function softClip(k: number) {
  const n = 2048;
  const curve = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

export class Engine {
  ctx: BaseAudioContext;
  node: AudioWorkletNode;
  preset: Preset = PRESETS[0];
  private body1: BiquadFilterNode;
  private body2: BiquadFilterNode;
  private lp: BiquadFilterNode;
  private wahPeak: BiquadFilterNode;
  private delaySend: GainNode;
  private delayFb: GainNode;
  private wahTrim: GainNode;
  /** a fuzz on the string alone, for the presets that want one: the clean way, the fuzz way */
  private clean: GainNode;
  private fuzzIn: GainNode;
  private fuzzOut: GainNode;
  private wetGain: GainNode;
  /** two rooms, so a preset's room can come in while the last one dies away */
  private verbs: { conv: ConvolverNode; gain: GainNode; seconds: number }[] = [];
  private verbOn = 0;
  private master: GainNode;
  /** the output, listened to for the waves drawn off the string */
  scope: AnalyserNode;
  private echo: GainNode;
  /** last peak level the worklet saw (for the settings readout) */
  peak = 0;
  pad: Pad;

  private constructor(ctx: BaseAudioContext, node: AudioWorkletNode) {
    this.ctx = ctx;
    this.node = node;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 24;
    hp.Q.value = 0.6;
    // the body: two broad low resonances (the air and the wood of something big)
    this.body1 = ctx.createBiquadFilter();
    this.body1.type = 'peaking';
    this.body1.Q.value = 1.3;
    this.body2 = ctx.createBiquadFilter();
    this.body2.type = 'peaking';
    this.body2.Q.value = 1.6;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 0.6;
    // the string, clean, or through a fuzz into a speaker cabinet (the doom one): the fuzz is
    // hard, a stack of tanh driven into a near square, oversampled; the cabinet cuts the fizz
    // above 3 kHz and the mud under 60 Hz, with the hump of a big closed box at 110 Hz
    this.clean = ctx.createGain();
    this.fuzzIn = ctx.createGain();
    this.fuzzIn.gain.value = 0;
    this.fuzzOut = ctx.createGain();
    this.fuzzOut.gain.value = 0;
    const fuzzPre = ctx.createBiquadFilter();
    fuzzPre.type = 'highpass';
    fuzzPre.frequency.value = 50;
    const fuzz = ctx.createWaveShaper();
    fuzz.curve = softClip(28);
    fuzz.oversample = '4x';
    const fuzz2 = ctx.createWaveShaper();
    fuzz2.curve = softClip(3);
    const cab1 = ctx.createBiquadFilter();
    cab1.type = 'lowpass';
    cab1.frequency.value = 3000;
    cab1.Q.value = 0.9;
    const cab2 = ctx.createBiquadFilter();
    cab2.type = 'lowpass';
    cab2.frequency.value = 4200;
    cab2.Q.value = 0.5;
    const cab3 = ctx.createBiquadFilter();
    cab3.type = 'peaking';
    cab3.frequency.value = 110;
    cab3.Q.value = 1.1;
    cab3.gain.value = 5;
    const cabHp = ctx.createBiquadFilter();
    cabHp.type = 'highpass';
    cabHp.frequency.value = 60;
    node.connect(hp);
    hp.connect(this.clean).connect(this.body1);
    hp.connect(this.fuzzIn).connect(fuzzPre).connect(fuzz).connect(fuzz2).connect(cab1).connect(cab2).connect(cab3).connect(cabHp).connect(this.fuzzOut).connect(this.body1);
    this.body1.connect(this.body2).connect(this.lp);
    // the wah: a resonant peak swept by a finger up and down the background, and the string a
    // little under it while it's on (off: flat, nothing)
    this.wahPeak = ctx.createBiquadFilter();
    this.wahPeak.type = 'peaking';
    this.wahPeak.Q.value = 4.5;
    this.wahPeak.frequency.value = 800;
    this.wahPeak.gain.value = 0;
    this.wahTrim = ctx.createGain();
    this.lp.connect(this.wahPeak).connect(this.wahTrim);

    const bus = ctx.createGain();
    this.wahTrim.connect(bus);
    // the room hears a little less of the low end, so the tail stays clear
    const send = ctx.createBiquadFilter();
    send.type = 'highpass';
    send.frequency.value = 90;
    this.wetGain = ctx.createGain();
    this.wahTrim.connect(send);
    for (let i = 0; i < 2; i++) {
      const conv = ctx.createConvolver();
      conv.normalize = false;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      send.connect(conv).connect(gain).connect(this.wetGain);
      this.verbs.push({ conv, gain, seconds: 0 });
    }
    this.wetGain.connect(bus);
    this.room(this.roomSeconds(), true);
    // the arpeggio's delay: dotted eighths at the arp's tempo, bouncing left and right, dark,
    // a quarter fed back. Only the arpeggio goes in (the worklet's second output)
    const dIn = ctx.createGain();
    dIn.gain.value = 0.55;
    const dHp = ctx.createBiquadFilter();
    dHp.type = 'highpass';
    dHp.frequency.value = 160;
    const dLp = ctx.createBiquadFilter();
    dLp.type = 'lowpass';
    dLp.frequency.value = 1700;
    const time = (60 / ARP_BPM) * 0.75;
    const dL = ctx.createDelay(2);
    dL.delayTime.value = time;
    const dR = ctx.createDelay(2);
    dR.delayTime.value = time;
    const fb = ctx.createGain();
    fb.gain.value = 0.25;
    const merge = ctx.createChannelMerger(2);
    node.connect(dIn, 1);
    dIn.connect(dHp).connect(dLp).connect(dL);
    dL.connect(dR);
    dR.connect(fb).connect(dL);
    dL.connect(merge, 0, 0);
    dR.connect(merge, 0, 1);
    // (a gain after it, to clear old echoes when the scale changes)
    this.echo = ctx.createGain();
    merge.connect(this.echo);
    this.echo.connect(bus);
    this.echo.connect(send);
    // the string's own delay (the Mix's): the same dotted eighths, bouncing the same way, apart
    // from the arpeggio's, as much in and as long as the knob says
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0;
    const sHp = ctx.createBiquadFilter();
    sHp.type = 'highpass';
    sHp.frequency.value = 160;
    const sLp = ctx.createBiquadFilter();
    sLp.type = 'lowpass';
    sLp.frequency.value = 2200;
    const sL = ctx.createDelay(2);
    sL.delayTime.value = time;
    const sR = ctx.createDelay(2);
    sR.delayTime.value = time;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.25;
    const sMerge = ctx.createChannelMerger(2);
    this.wahTrim.connect(this.delaySend).connect(sHp).connect(sLp).connect(sL);
    sL.connect(sR);
    sR.connect(this.delayFb).connect(sL);
    sL.connect(sMerge, 0, 0);
    sR.connect(sMerge, 0, 1);
    sMerge.connect(this.echo);
    // the flageolets: deep in the room, far more than the string (the worklet's third output)
    const harmSend = ctx.createGain();
    harmSend.gain.value = 3.5;
    node.connect(harmSend, 2).connect(send);

    // the pad: straight into the bus (before the limiter), and generously into the room
    this.pad = new Pad(ctx, this.preset);
    this.pad.amount = tune.pad;
    this.pad.out.connect(bus);
    const padSend = ctx.createGain();
    padSend.gain.value = 1.4;
    this.pad.out.connect(padSend).connect(send);

    const drive = ctx.createGain();
    drive.gain.value = 1.1;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(1.4);
    shaper.oversample = '2x';
    const post = ctx.createGain();
    post.gain.value = 0.8;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 5000;
    shelf.gain.value = -5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 14;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.3;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -4;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.12;
    this.master = ctx.createGain();
    this.master.gain.value = tune.volume;
    bus.connect(drive).connect(shaper).connect(post).connect(shelf).connect(comp).connect(limit).connect(this.master).connect(ctx.destination);
    // what comes out, for the drawing (before the volume, so the drawing doesn't care how loud
    // the phone is): fine enough to tell the low notes apart
    this.scope = ctx.createAnalyser();
    this.scope.fftSize = 8192;
    this.scope.smoothingTimeConstant = 0.5;
    limit.connect(this.scope);

    node.port.onmessage = (e) => {
      if (e.data?.type === 'level') this.peak = e.data.peak;
    };
    this.setPreset(this.preset);
  }

  static async create(ctx: BaseAudioContext) {
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, 'wire', { numberOfInputs: 0, numberOfOutputs: 3, outputChannelCount: [2, 2, 2] });
    return new Engine(ctx, node);
  }

  private post(m: WireMsg) {
    this.node.port.postMessage(m);
  }

  setPreset(p: Preset) {
    const was = this.preset;
    this.preset = p;
    if (was !== p) {
      this.pad?.setPreset(p);
      this.room(this.roomSeconds());
    }
    this.applyMix();
  }

  /** the preset's room times the reverb knob's size, in quarter seconds (so a turn reuses buffers) */
  private roomSeconds() {
    return Math.max(0.5, Math.round(this.preset.room * tune.size * 4) / 4);
  }

  /** the reverb knob moved: a longer or shorter room, crossfaded */
  resizeRoom() {
    this.room(this.roomSeconds());
  }

  /** a room of this many seconds: made in the idle convolver, crossfaded in over a second */
  private room(seconds: number, now = false) {
    const cur = this.verbs[this.verbOn];
    if (cur.seconds === seconds && cur.conv.buffer) return;
    const t = this.ctx.currentTime;
    const next = this.verbs[1 - this.verbOn];
    if (next.seconds !== seconds) {
      next.conv.buffer = impulse(this.ctx, seconds);
      next.seconds = seconds;
    }
    next.gain.gain.cancelScheduledValues(t);
    cur.gain.gain.cancelScheduledValues(t);
    if (now) {
      next.gain.gain.value = 1;
      cur.gain.gain.value = 0;
    } else {
      next.gain.gain.setTargetAtTime(1, t, 0.35);
      cur.gain.gain.setTargetAtTime(0, t, 0.6);
    }
    this.verbOn = 1 - this.verbOn;
  }

  applyMix() {
    const t = this.ctx.currentTime;
    const p = this.preset;
    this.wetGain.gain.setTargetAtTime(p.wet * tune.wet * 0.6, t, 0.1);
    this.master.gain.setTargetAtTime(tune.volume, t, 0.05);
    this.body1.frequency.setTargetAtTime(p.body[0], t, 0.05);
    this.body1.gain.setTargetAtTime(p.body[1] * tune.body, t, 0.05);
    this.body2.frequency.setTargetAtTime(p.body[2], t, 0.05);
    this.body2.gain.setTargetAtTime(p.body[3] * tune.body, t, 0.05);
    this.lp.frequency.setTargetAtTime(p.lp, t, 0.05);
    // the fuzz: driven hard in (the quiet tail of a note too, so it holds), out at about the
    // level of the clean string
    const fz = p.fuzz ?? 0;
    this.clean.gain.setTargetAtTime(1 - fz, t, 0.05);
    this.fuzzIn.gain.setTargetAtTime(fz * 6, t, 0.05);
    this.fuzzOut.gain.setTargetAtTime(fz * 0.065, t, 0.05);
  }

  /**
   * The scale changed: what still rings in the old one lets go softly (the wire, the strings
   * along, the groove's notes) and the echoes dip out until they've passed.
   */
  rescale() {
    for (const group of ['main', 'chord', 'sym', 'arp'] as const) this.post({ type: 'damp', group, time: 0.45 });
    const t = this.ctx.currentTime;
    const g = this.echo.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(0, t, 0.08);
    g.setTargetAtTime(1, t + 1.6, 0.3);
  }

  /** the stop slid: what rings on the wire glides to `semis` from the note it was plucked at */
  slide(semis: number, time: number) {
    this.post({ type: 'slide', ratio: Math.pow(2, semis / 12), time });
    // the chord over it doesn't follow (it would leave the scale): it lets go softly
    this.post({ type: 'damp', group: 'chord', time: 0.25 });
  }

  /**
   * A harmonic, a flageolet: a finger resting lightly on a node at k/n as the string sounds, and
   * the n-th harmonic of the note rings out on its own, like a guitar's at the twelfth fret. Near
   * a sine, a breath of its own octave over it, a soft touch to start and a long, quiet ring
   * (the sustain slider too), deep in the room.
   */
  harmonic(note: number, n: number, force: number) {
    const f = Math.min(1, Math.max(0, force));
    // tempered, not pure: the n-th harmonic's interval rounded to whole semitones (an octave, a
    // twelfth, two octaves, two octaves and a third), so it sits on the same notes as everything
    // else (a pure fifth harmonic is 14 cents flat of the pad's third, and beats against it)
    const f1 = midiHz(note + Math.round(12 * Math.log2(n)));
    if (f1 > 7000) return;
    const freqs: number[] = [];
    const amps: number[] = [];
    const sigmas: number[] = [];
    // the high ones ring shorter, as on a string
    const t60 = 10 * ring.sustain * Math.min(1, Math.pow(900 / f1, 0.3));
    [1, 0.1, 0.03].forEach((a, i) => {
      const hz = f1 * (i + 1);
      if (hz > 9000) return;
      freqs.push(hz);
      amps.push(a);
      sigmas.push(6.91 / (t60 / (1 + i)));
    });
    this.post({
      type: 'pluck', group: 'harm', freqs, amps, sigmas,
      // soft: the low ones a little louder, the high ones a glint
      gain: 0.02 * tune.harm * (0.55 + 0.45 * f) * Math.min(1, 1.5 / Math.sqrt(n)),
      glide: 0, boing: 0, wobble: 0, buzz: 0, gap: 1, attack: 0.014, bloom: 0, detune: 0.02,
    });
  }

  /** one note of a chord rolled over the wire's note: the same string, a little softer */
  chordNote(note: number, force: number, pos: number, when: number) {
    const p = this.preset;
    const f = Math.min(1, Math.max(0, force));
    const x = Math.min(1, Math.max(0, (pos - 0.22) / 0.5));
    const parts = partialsFor(p, midiHz(note), pos, 'pluck', f, -0.75 + 1.6 * x, 2 - 1.55 * x);
    const n = Math.min(32, parts.freqs.length);
    // (pulled from far, louder and longer, like the string's own pluck)
    const far = 1 + 0.5 * Math.pow(f, 1.5);
    this.post({
      type: 'pluck', group: 'chord',
      freqs: parts.freqs.slice(0, n), amps: parts.amps.slice(0, n), sigmas: parts.sigmas.slice(0, n).map((s) => s / far),
      gain: 0.062 * (0.45 + 0.55 * f) * far, glide: p.glide * tune.glide * f * f * 0.5,
      boing: tune.elastic * (0.01 + 0.03 * f * f), wobble: tune.elastic * (0.002 + 0.004 * f),
      buzz: p.buzz * tune.buzz * 0.5, gap: p.gap, attack: 0.002, bloom: 0.02 * tune.bloom,
      detune: p.detune * tune.detune, when,
    });
  }

  /** a second finger pressing the string aside: what rings on it bent by `semis` (0: let go) */
  bend(semis: number) {
    this.post({ type: 'bend', ratio: Math.pow(2, semis / 12) });
  }

  /**
   * The wah, 0..1 up the screen (a resonant peak from 350 Hz to 2.8 kHz), or null: off, back to
   * flat over a moment.
   */
  wah(t: number | null) {
    const now = this.ctx.currentTime;
    if (t == null) {
      this.wahPeak.gain.setTargetAtTime(0, now, 0.12);
      this.wahTrim.gain.setTargetAtTime(1, now, 0.12);
      return;
    }
    const k = Math.min(1, Math.max(0, t));
    this.wahPeak.frequency.setTargetAtTime(350 * Math.pow(8, k), now, 0.03);
    this.wahPeak.gain.setTargetAtTime(16, now, 0.05);
    this.wahTrim.gain.setTargetAtTime(0.45, now, 0.05);
  }

  /** the delay, 0..1 (the Mix's): how much of the string goes in, and how long it repeats */
  setDelay(t: number) {
    const now = this.ctx.currentTime;
    const k = Math.min(1, Math.max(0, t));
    this.delaySend.gain.setTargetAtTime(0.75 * k, now, 0.05);
    this.delayFb.gain.setTargetAtTime(0.25 + 0.3 * k, now, 0.05);
  }

  /** the page is hidden: everything stops at once (the master down, every voice damped) */
  hush() {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.015);
    for (const group of ['main', 'tick', 'sym', 'arp', 'chord', 'harm'] as const) this.post({ type: 'damp', group, time: 0.03 });
  }

  /** back: the master comes up again, softly */
  unhush() {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.setTargetAtTime(tune.volume, t + 0.15, 0.25);
  }

  /** a hand laid on the string: it and everything ringing along with it stops (softly) */
  mute(seconds = 0.06) {
    for (const group of ['main', 'chord', 'sym', 'harm'] as const) this.post({ type: 'damp', group, time: seconds });
  }

  /** the finger on the wire: it stops ringing (softly) */
  damp(seconds = 0.08) {
    this.post({ type: 'damp', group: 'main', time: seconds });
    this.post({ type: 'damp', group: 'chord', time: seconds });
  }

  pluck(o: PluckOpts): Partials {
    const p = this.preset;
    const f0 = midiHz(o.note);
    const harm = o.tech === 'harm';
    const snapped = o.tech === 'snap';
    const force = Math.min(1, Math.max(0, o.force + (snapped ? 0.35 : 0)));
    // where it's plucked is a big part of the sound: across the plain middle it goes from thin
    // and glassy up by the snap zone to round and hollow down by the harmonic one; the snap is
    // all edge, the harmonic all bell
    const x = Math.min(1, Math.max(0, (o.pos - 0.22) / 0.5));
    const tiltAdd = snapped ? -0.9 : harm ? 0.5 : -0.75 + 1.6 * x;
    const rollMul = snapped ? 2.2 : harm ? 0.8 : 2 - 1.55 * x;
    // a harder pull is a brighter spectrum, not only a louder one; a strike is a touch brighter
    let parts = partialsFor(p, f0, snapped ? 0.06 : harm ? 0.25 : o.pos, o.kind, o.kind === 'strike' ? Math.min(1, force + 0.15) : force, tiltAdd, rollMul);
    if (harm) parts = flageolet(parts);
    let sigmas = parts.sigmas;
    // the snap rings shorter and harder; the round middle a little longer
    if (snapped) sigmas = sigmas.map((s, i) => s * (1.3 + 0.04 * i));
    else if (!harm) sigmas = sigmas.map((s) => s * (1.15 - 0.3 * x));
    // pulled from far, it rings longer and louder: up to half as much again (by the string, as before)
    const far = 1 + 0.5 * Math.pow(force, 1.5);
    sigmas = sigmas.map((s) => s / far);
    let buzz = p.buzz * tune.buzz;
    let gap = p.gap;
    if (snapped) {
      // against the wire: it rattles while the swing is wide
      buzz = Math.max(buzz, 0.9);
      gap = 0.25;
    }
    if (o.chiado) {
      // the coin only touching: most of the ring is choked, and what's left rattles
      sigmas = sigmas.map((s) => s * 5 + 5);
      buzz = 1;
      gap = 0.12;
    }
    // the sub: a sine an octave under, dying three times as fast as the fundamental
    const sub = p.sub * tune.sub * (o.chiado ? 0.3 : 1) * (harm ? 0 : 1);
    const freqs = [...parts.freqs];
    const amps = [...parts.amps];
    const sig = [...sigmas];
    if (sub > 0 && f0 / 2 > 26) {
      freqs.push(f0 / 2);
      amps.push(sub * (0.6 + 0.4 * (1 - force)));
      sig.push(sigmas[0] * 3 + 0.4);
    }
    // the level only moves inside a pleasant window
    const gain = 0.1 * (0.45 + 0.55 * Math.pow(force, 0.9)) * far * (o.kind === 'strike' ? 0.85 : 1) * (harm ? 0.8 : 1);
    const m: PluckMsg = {
      type: 'pluck', group: 'main',
      freqs, amps, sigmas: sig, gain,
      glide: p.glide * tune.glide * force * force * (snapped ? 3 : harm ? 0.3 : 1),
      // elastic: let go, it springs back from sharp (up to about a semitone on a hard pull)
      // and wobbles a little around the note before it settles
      boing: tune.elastic * (0.012 + 0.05 * force * force) * (snapped ? 1.4 : harm ? 0.4 : 1),
      wobble: tune.elastic * (0.002 + 0.007 * force) * (harm ? 0.5 : 1),
      buzz: buzz * (0.4 + 0.6 * force), gap, attack: 0,
      // a soft pull blooms slower
      bloom: 0.025 * tune.bloom * (1.4 - 0.8 * force) * (harm ? 1.8 : snapped ? 0.4 : 1),
      detune: p.detune * tune.detune,
    };
    this.post(m);
    if (!o.chiado) this.sympathy(parts, gain);
    // (a pitch between the notes: the pad goes to the nearest one)
    this.pad.played(snap(p, Math.round(o.note)));
    return { ...parts, sigmas };
  }

  /**
   * The sympathetic strings: each one that shares a partial with what was just played swells
   * up slowly and rings on, quietly. Worked out here, not simulated: a string tuned to the
   * scale only ever answers in the scale.
   */
  private sympathy(parts: Partials, gain: number) {
    const p = this.preset;
    const amount = p.sym * tune.sym;
    if (amount <= 0) return;
    for (const sn of p.symNotes) {
      const fs = midiHz(p.root + sn);
      let c = 0;
      for (let i = 0; i < parts.freqs.length; i++) {
        for (let hh = 1; hh <= 4; hh++) {
          const cents = 1200 * Math.log2(parts.freqs[i] / (fs * hh));
          if (Math.abs(cents) < 40) c += (Math.abs(parts.amps[i]) * Math.exp(-((cents / 15) ** 2))) / hh;
        }
      }
      if (c < 0.04) continue;
      const sp = partialsFor(p, fs, 0.27, 'pluck', 0.45);
      const n = Math.min(8, sp.freqs.length);
      this.post({
        type: 'pluck', group: 'sym',
        freqs: sp.freqs.slice(0, n), amps: sp.amps.slice(0, n), sigmas: sp.sigmas.slice(0, n).map((x) => x * 0.7),
        gain: gain * 0.8 * amount * Math.min(1, c), glide: 0, buzz: 0, gap: 1,
        attack: 0.45, bloom: 0.05, detune: 0,
      });
    }
  }

  /**
   * One note of the arpeggio, at audio time `when`: a lighter pluck of the wire that rings on
   * (they don't stop each other: they bloom into the pad), and the only thing sent to the delay.
   */
  arpNote(note: number, force: number, pos: number, when: number): Partials {
    const p = this.preset;
    const f = Math.min(1, Math.max(0, force));
    const parts = partialsFor(p, midiHz(note), pos, 'pluck', f);
    const n = Math.min(28, parts.freqs.length);
    this.post({
      type: 'pluck', group: 'arp',
      freqs: parts.freqs.slice(0, n), amps: parts.amps.slice(0, n), sigmas: parts.sigmas.slice(0, n),
      gain: 0.07 * (0.4 + 0.6 * f), glide: p.glide * tune.glide * 0.3 * f * f,
      boing: tune.elastic * 0.015 * f, wobble: tune.elastic * 0.002 * f,
      buzz: p.buzz * tune.buzz * 0.6, gap: p.gap, attack: 0.002, bloom: 0.015 * tune.bloom,
      detune: p.detune * tune.detune, when,
    });
    return parts;
  }

  /**
   * A slack rope knocked: a dull, pitchless thump. A handful of low partials that belong to no
   * note, choked within a tenth of a second, falling a little as they go.
   */
  thump(force: number) {
    const f = Math.min(1, Math.max(0, force));
    const base = [52, 83, 127, 181, 259];
    const freqs = base.map((x) => x * (0.92 + Math.random() * 0.16));
    const raw = [1, 0.6, 0.38, 0.22, 0.12];
    const n = Math.hypot(...raw);
    this.post({
      type: 'pluck', group: 'tick',
      freqs, amps: raw.map((a) => a / n), sigmas: [16, 22, 30, 38, 48],
      gain: 0.09 * (0.35 + 0.65 * f), glide: 0.12, buzz: 0, gap: 1, attack: 0.004, bloom: 0, detune: 0,
    });
  }

  /** the ratchet of the tension, one soft tick per step: the note it will be */
  tick(note: number) {
    const f0 = midiHz(note);
    const parts = partialsFor(this.preset, f0, 0.3, 'pluck', 0.4);
    const n = Math.min(6, parts.freqs.length);
    this.post({
      type: 'pluck', group: 'tick',
      freqs: parts.freqs.slice(0, n), amps: parts.amps.slice(0, n), sigmas: parts.sigmas.slice(0, n).map((s) => s + 14),
      gain: 0.03, glide: 0, buzz: 0, gap: 1, attack: 0.002, bloom: 0, detune: 0,
    });
  }

  askLevel() {
    this.post({ type: 'level' });
  }
}

/** a flageolet: a finger lightly at the middle keeps only the even partials, which ring longer */
function flageolet(parts: Partials): Partials {
  const out: Partials = { freqs: [], amps: [], sigmas: [], modes: [] };
  parts.modes.forEach((k, i) => {
    if (k % 2) return;
    out.freqs.push(parts.freqs[i]);
    // a bell: the first few of them, the rest falling away fast, ringing long
    out.amps.push(parts.amps[i] * Math.exp(-(k / 2 - 1) / 2.2));
    out.sigmas.push(parts.sigmas[i] * 0.55);
    out.modes.push(k / 2);
  });
  let e = 0;
  for (const a of out.amps) e += a * a;
  const n = e > 1e-12 ? 1 / Math.sqrt(e) : 0;
  for (let i = 0; i < out.amps.length; i++) out.amps[i] *= n;
  return out.freqs.length ? out : parts;
}
