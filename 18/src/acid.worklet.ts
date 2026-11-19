// The TB-303, in an AudioWorklet: ported from the soundbox's Rust voice (the same oscillator,
// the same four-pole ladder, the same envelopes), so it sounds the same and has the same knobs.
// One voice a channel, and it is mono, as the machine was: a note that starts while the last is
// still held does not strike again but glides (slide), and an accent shuts the filter's decay
// short and opens it wider. The main thread says what to play and when, a little ahead, in
// context time; here the notes are only run, to the sample.

declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

/** what the knobs say, in the units the voice runs on */
export interface AcidParams {
  /** 0 saw, 1 square */
  wave: number;
  /** Hz */
  cutoff: number;
  res: number;
  envmod: number;
  /** seconds, of the filter's fall */
  decay: number;
  accent: number;
  /** seconds, of the glide between notes */
  slide: number;
  /** semitones */
  tune: number;
}

export type AcidMsg =
  | ({ type: 'params' } & AcidParams)
  /** a note starts at context time t: which, how loud, how hard (accent), glided to (slide), how far left or right; `gen` names it, for the end to say which it ends */
  | { type: 'on'; t: number; note: number; gain: number; accent: boolean; slide: boolean; pan: number; gen: number }
  | { type: 'off'; t: number; gen: number };

const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
/** the share of the way to the end that an exponential fall covers each sample, for a time in seconds */
const tc = (seconds: number, sr: number) => (seconds <= 0 ? 1 : 1 - Math.exp(-1 / (seconds * sr)));
const noteHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** the correction that takes the edge off a saw or square's jump, so it does not fold back as hiss */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

class Ladder {
  private y = [0, 0, 0, 0];
  private old = [0, 0, 0, 0];
  private oldx = 0;
  /** four poles, with the resonance fed back from the last, and a little of the cubic's bend on the way out */
  tick(input: number, cutoff: number, res: number, sr: number): number {
    const f = clamp((2 * cutoff) / sr, 0.001, 0.99);
    const k = 3.6 * f - 1.6 * f * f - 1;
    const p = (k + 1) * 0.5;
    const scale = Math.exp((1 - p) * 1.386249);
    const r = clamp(res, 0, 1) * 0.98 * scale;
    const x = input - r * this.y[3];
    let y0 = x * p + this.oldx * p - k * this.y[0];
    y0 = clamp(y0, -2, 2);
    const y1 = y0 * p + this.old[0] * p - k * this.y[1];
    const y2 = y1 * p + this.old[1] * p - k * this.y[2];
    let y3 = y2 * p + this.old[2] * p - k * this.y[3];
    y3 -= (y3 * y3 * y3) / 6;
    this.oldx = x;
    this.old = [y0, y1, y2, y3];
    this.y = [y0, y1, y2, y3];
    return y3;
  }
}

class AcidProcessor extends AudioWorkletProcessor {
  private p: AcidParams = { wave: 0, cutoff: 800, res: 0.6, envmod: 0.5, decay: 0.3, accent: 0.5, slide: 0.06, tune: 0 };
  private queue: AcidMsg[] = [];
  private ladder = new Ladder();
  private phase = 0;
  private noteCur = 36;
  private noteTarget = 36;
  private gate = false;
  /** the note the gate belongs to: an end for another is old news */
  private gen = -1;
  private amp = 0;
  private fenv = 0;
  private accent = 0;
  private gain = 1;
  private pan = 0;
  /** the one pole that takes the rumble off (30 Hz) */
  private lp = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<AcidMsg>) => {
      const m = e.data;
      if (m.type === 'params') this.p = m;
      else {
        this.queue.push(m);
        this.queue.sort((a, b) => ('t' in a ? a.t : 0) - ('t' in b ? b.t : 0));
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] ?? out[0];
    const sr = sampleRate;
    // nothing playing, nothing waiting: nothing to run
    if (!this.gate && this.amp < 1e-5 && !this.queue.length) {
      for (const channel of out) channel.fill(0);
      return true;
    }
    const { wave, cutoff, res, envmod, decay, accent: accentAmount, slide, tune } = this.p;
    const slideCoef = tc(Math.max(slide, 0.005), sr);
    const attack = tc(0.003, sr);
    const release = tc(0.012, sr);
    const ampDecay = tc(3, sr);
    const hpA = clamp(1 - Math.exp((-TAU * 30) / sr), 0, 1);
    const start = currentTime;
    for (let f = 0; f < left.length; f++) {
      // the notes whose time has come (a late one, at once)
      while (this.queue.length && (this.queue[0] as { t: number }).t <= start + f / sr) {
        const e = this.queue.shift()!;
        if (e.type === 'on') {
          this.noteTarget = e.note;
          if (!(e.slide && this.gate)) {
            this.noteCur = e.note;
            this.accent = e.accent ? accentAmount : 0;
            this.fenv = 1;
            this.amp = 0;
          }
          this.gain = e.gain;
          this.pan = e.pan;
          this.gate = true;
          this.gen = e.gen;
        } else if (e.type === 'off' && e.gen === this.gen) this.gate = false;
      }
      this.noteCur += (this.noteTarget - this.noteCur) * slideCoef;
      const hz = noteHz(this.noteCur + tune);
      // the oscillator
      const dt = hz / sr;
      const t = this.phase;
      let x: number;
      if (wave >= 0.5) {
        x = (t < 0.5 ? 1 : -1) + polyBlep(t, dt) - polyBlep((t + 0.5) % 1, dt);
      } else x = 2 * t - 1 - polyBlep(t, dt);
      this.phase += dt;
      if (this.phase >= 1) this.phase -= 1;
      // the filter, opened by the envelope, and shut sooner on an accent
      this.fenv -= this.fenv * tc(this.accent > 0 ? decay * 0.5 : decay, sr);
      const envAmount = envmod * (1 + this.accent * 1.5);
      const fc = cutoff * Math.pow(2, envAmount * 4.5 * this.fenv);
      const y = this.ladder.tick(x * 0.6, fc, res + this.accent * 0.2, sr);
      // the amplitude: up fast, held, down on release
      if (this.gate) {
        if (this.amp < 1) {
          this.amp += attack * (1.3 - this.amp);
          if (this.amp > 1) this.amp = 1;
        } else this.amp -= this.amp * ampDecay;
      } else this.amp -= this.amp * release;
      this.lp += hpA * (y - this.lp);
      const v = (y - this.lp) * this.amp * this.gain * (1 + this.accent) * 1.4;
      // a place between the ears, equal power
      const a = ((this.pan + 1) * Math.PI) / 4;
      left[f] = v * Math.cos(a);
      right[f] = v * Math.sin(a);
    }
    return true;
  }
}

registerProcessor('acid', AcidProcessor);
