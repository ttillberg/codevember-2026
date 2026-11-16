// The pad: a soft dark bed under the wire, in two layers, through a slow breathing low pass and
// a slow phaser.
//
// The bass: the key's root, two saws (or triangles) a few cents apart, left and right. It stays
// as long as the pad is on, whatever you play: the floor everything stands on.
//
// Over it, the colour: three voices on the note played, an open voicing in the scale (a fifth or
// a fourth, the octave, a ninth or a third up high: never a third down low). They float in with
// each note and out again when you stop: they hold a moment after the last note, then fade.
// A new note crossfades them: a second set comes in on its chord as the first fades, nothing
// slides. A run of quick notes doesn't churn them: the note has to stay the last one for a
// moment. It all swells a little with a pull.

import { inScale, midiHz, pc, type Preset } from './presets';

/** the colour's voices over the bass */
const VOICES = 3;
/** seconds the colour holds after a note, then the time constant of its fade to nothing */
const HOLD = 1.5;
const FADE = 2.5;
/** how long a note must stay the last one before the colour goes there (s) */
const SETTLE = 0.35;
/** the bass against the colour */
const BASS = 0.75;

const pair = (ctx: BaseAudioContext, wave: OscillatorType, cents: number, spread: number, to: AudioNode) =>
  [-1, 1].map((side) => {
    const o = ctx.createOscillator();
    o.type = wave;
    o.detune.value = side * cents;
    const pan = ctx.createStereoPanner();
    pan.pan.value = side * spread;
    o.connect(pan).connect(to);
    o.start();
    return o;
  });

export class Pad {
  private ctx: BaseAudioContext;
  out: GainNode;
  private filter: BiquadFilterNode;
  private lfoGain: GainNode;
  private preset: Preset;
  private on = false;
  /** the user's level (settings) */
  amount = 1;
  /** the voicing it is on now (midi), the bass first, for the arpeggiator */
  notes: number[] = [];
  private swell = 0;
  /** the bass: its pair of oscillators and its level */
  private bass: OscillatorNode[];
  private bassLevel: GainNode;
  /** the colour: two sets of voices, crossfaded, and its level (it floats in and out) */
  private banks: { oscs: OscillatorNode[][]; gain: GainNode }[] = [];
  private live = 0;
  private colour: GainNode;
  private last = -1e9;
  /** the colour's note now, and the one it was asked to go to */
  private at = -1;
  private want = -1;
  private timer = 0;

  constructor(ctx: BaseAudioContext, preset: Preset) {
    this.ctx = ctx;
    this.preset = preset;
    this.out = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.7;
    this.filter.frequency.value = preset.pad.cutoff;
    // the breathing: the cut-off rises and falls once every fifteen seconds or so
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.065;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = preset.pad.cutoff * 0.35;
    lfo.connect(this.lfoGain).connect(this.filter.frequency);
    lfo.start();
    // the phaser: six all-passes swept slowly (once every eight seconds or so) and mixed back
    // with the dry pad, so notches wander up and down through it, a slow swirl
    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    const wet = ctx.createGain();
    wet.gain.value = 0.7;
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.12;
    sweep.start();
    let ap: AudioNode = this.filter;
    for (let i = 0; i < 6; i++) {
      const f = ctx.createBiquadFilter();
      f.type = 'allpass';
      f.Q.value = 0.6;
      const base = 260 * Math.pow(1.6, i);
      f.frequency.value = base;
      const depth = ctx.createGain();
      depth.gain.value = base * 0.75;
      sweep.connect(depth).connect(f.frequency);
      ap.connect(f);
      ap = f;
    }
    ap.connect(wet).connect(this.out);
    this.filter.connect(dry).connect(this.out);

    this.bassLevel = ctx.createGain();
    this.bassLevel.gain.value = 0;
    this.bassLevel.connect(this.filter);
    this.bass = pair(ctx, preset.pad.wave, 4, 0.3, this.bassLevel);

    this.colour = ctx.createGain();
    this.colour.gain.value = 0;
    this.colour.connect(this.filter);
    for (let b = 0; b < 2; b++) {
      const gain = ctx.createGain();
      gain.gain.value = b === 0 ? 1 : 0;
      gain.connect(this.colour);
      const oscs: OscillatorNode[][] = [];
      // each voice a little apart, and each side apart again: a slow chorus
      for (let v = 0; v < VOICES; v++) oscs.push(pair(ctx, preset.pad.wave, 6 + v * 1.5, 0.4 + 0.15 * (v % 2), gain));
      this.banks.push({ oscs, gain });
    }
    this.tuneBass();
    this.voice(preset.root, true);
  }

  /** the key's root, an octave under the colour, but no lower than a phone can play (E2) */
  private bassNote() {
    let m = this.preset.root + this.preset.pad.oct - 12;
    while (m < 40) m += 12;
    return m;
  }

  private tuneBass() {
    const t = this.ctx.currentTime;
    for (const o of this.bass) o.frequency.setTargetAtTime(midiHz(this.bassNote()), t, 0.3);
  }

  /** the colour over a note (midi): its fifth (or fourth), its octave, and a ninth or third on top */
  private voicing(note: number) {
    const p = this.preset;
    const base = p.root + p.pad.oct + pc(note, p.root);
    const first = (ivs: number[]) => base + (ivs.find((iv) => inScale(p, base + iv)) ?? 12);
    return [first([7, 5]), base + 12, first([14, 15, 16, 17, 19])];
  }

  private voice(note: number, now = false) {
    const t = this.ctx.currentTime;
    const notes = this.voicing(note);
    this.at = this.want = note;
    this.notes = [this.bassNote(), ...notes];
    // the new chord on the quiet set, then a crossfade (or at once)
    const next = now ? this.live : 1 - this.live;
    for (let v = 0; v < VOICES; v++) {
      for (const o of this.banks[next].oscs[v]) {
        o.frequency.cancelScheduledValues(t);
        o.frequency.setValueAtTime(midiHz(notes[v]), t);
      }
    }
    if (now) return;
    const was = this.banks[this.live].gain.gain;
    const is = this.banks[next].gain.gain;
    was.cancelScheduledValues(t);
    was.setValueAtTime(was.value, t);
    was.setTargetAtTime(0, t, 0.5);
    is.cancelScheduledValues(t);
    is.setValueAtTime(is.value, t);
    is.setTargetAtTime(1, t, 0.35);
    this.live = next;
  }

  setPreset(p: Preset) {
    this.preset = p;
    const t = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(p.pad.cutoff, t, 1);
    this.lfoGain.gain.setTargetAtTime(p.pad.cutoff * 0.35, t, 1);
    for (const o of this.bass) o.type = p.pad.wave;
    for (const b of this.banks) for (const two of b.oscs) for (const o of two) o.type = p.pad.wave;
    this.tuneBass();
    this.voice(this.at >= 0 && p.pad.follow ? this.at : p.root);
    this.apply(1.2);
  }

  setOn(on: boolean) {
    this.on = on;
    this.apply(on ? 1.2 : 0.5);
  }

  /** a note was played (midi): the colour floats in, and goes there in its own time */
  played(note: number) {
    this.last = this.ctx.currentTime;
    this.apply(0.6);
    // a drone pad's colour stays on the tonic; the others follow the music
    const to = this.preset.pad.follow ? note : this.preset.root;
    // the same note in another octave: the same colour
    if ((to - this.at) % 12 === 0) {
      this.want = this.at;
      return;
    }
    this.want = to;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.want >= 0 && this.want !== this.at) this.voice(this.want);
    }, SETTLE * 1000) as unknown as number;
  }

  /** a pull, 0..1: it swells a little */
  pull(x: number) {
    const s = Math.round(x * 10) / 10;
    if (s === this.swell) return;
    this.swell = s;
    this.apply(0.6);
  }

  private apply(tc: number) {
    const t = this.ctx.currentTime;
    const level = this.on ? 0.009 * this.preset.pad.level * this.amount * (1 + 0.35 * this.swell) : 0;
    // the bass: there while the pad is on
    const b = this.bassLevel.gain;
    b.cancelScheduledValues(t);
    b.setValueAtTime(b.value, t);
    b.setTargetAtTime(level * BASS, t, tc);
    // the colour: up with a note, held a moment after the last one, then a fade to nothing
    const g = this.colour.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    else {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
    }
    const fadeAt = this.last + HOLD;
    if (t >= fadeAt + FADE * 5) return void g.setTargetAtTime(0, t, 0.5);
    g.setTargetAtTime(level, t, tc);
    g.setTargetAtTime(0, Math.max(t + tc, fadeAt), FADE);
  }
}
