// The wire's voice, in an AudioWorklet: modal synthesis. A pluck is a set of damped sine
// partials (each one a complex rotator, cheap and exact), run twice a few cents apart and
// spread left and right (a string is never one perfect thing: the two copies beat, slowly),
// plus a buzz (the wire hitting something when it swings wide). Upper partials come in a
// little after the lower ones, so the attack blooms instead of snapping. The main thread works
// out the partials and which sympathetic strings answer; here they are only run.

declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

export interface PluckMsg {
  type: 'pluck';
  /** 'main' is the one wire (a new pluck stops the last); the others are other strings */
  group: Group;
  freqs: number[];
  amps: number[];
  sigmas: number[];
  gain: number;
  /** start this much sharp (ratio), falling with the energy */
  glide: number;
  /** buzz amount, and where it starts (fraction of the size of the first swing) */
  buzz: number;
  gap: number;
  /** seconds for the voice to come up: a pluck is instant, a sympathetic string swells */
  attack: number;
  /** extra seconds the top partials take to come in (the bloom) */
  bloom: number;
  /** cents between the two copies (0: one copy, in the middle) */
  detune: number;
  /** audio time to start at (the arpeggiator schedules ahead); absent = now */
  when?: number;
  /**
   * elastic: start this much sharp (ratio) and spring back in a fifth of a second, like a
   * stretched band let go; then wobble around the note by `wobble` (ratio), dying out
   */
  boing?: number;
  wobble?: number;
}
export type Group = 'main' | 'sym' | 'arp' | 'chord' | 'harm';
export type WireMsg =
  | PluckMsg
  | { type: 'damp'; group: Group | 'all'; time: number }
  | { type: 'slide'; ratio: number; time: number }
  | { type: 'level' };

const MAX_PARTIALS = 64;
const SLOTS = 36;
/** voices of each kind allowed to sound at once: past it, the quietest fades out */
const CAP: Record<Group, number> = { main: 2, sym: 12, arp: 8, chord: 8, harm: 18 };
const TAU = Math.PI * 2;
/** how loud the buzz is against what makes it */
const BUZZ = 11;
/** the pan of the two copies: each mostly on its side, a little on the other */
const NEAR = 0.82;
const FAR = 0.42;

class Voice {
  on = false;
  group: Group = 'main';
  n = 0;
  copies = 1;
  freq = new Float64Array(MAX_PARTIALS);
  sig = new Float64Array(MAX_PARTIALS);
  r = new Float64Array(MAX_PARTIALS);
  /** per copy states: copy c, partial i at c * MAX + i */
  re = new Float64Array(MAX_PARTIALS * 2);
  im = new Float64Array(MAX_PARTIALS * 2);
  /** each partial's own fade in (the bloom): its rate, and where it is */
  inRate = new Float64Array(MAX_PARTIALS);
  inEnv = new Float64Array(MAX_PARTIALS);
  detune = [1, 1];
  gain = 0;
  target = 0;
  rate = 0;
  attack = 0;
  glide = 0;
  buzz = 0;
  gap = 0;
  age = 0;
  releasing = false;
  hpX = 0;
  hpY = 0;
  lp = 0;
  lp2 = 0;
  peak = 0;
  /** samples to wait before it starts */
  wait = 0;
  /** a slide: the pitch now and where it goes (ratios to the note it was plucked at) */
  pitch = 1;
  pitchTo = 1;
  pitchTime = 0.09;
  /** the slide is a spring: its speed (it overshoots a little and settles, elastic) */
  pitchV = 0;
  boing = 0;
  wobble = 0;

  start(m: PluckMsg) {
    this.wait = m.when ? Math.max(0, Math.round((m.when - currentTime) * sampleRate)) : 0;
    this.pitch = this.pitchTo = 1;
    this.pitchV = 0;
    this.boing = m.boing ?? 0;
    this.wobble = m.wobble ?? 0;
    this.on = true;
    this.group = m.group;
    this.n = Math.min(MAX_PARTIALS, m.freqs.length);
    this.copies = m.detune > 0 ? 2 : 1;
    const half = m.detune / 2400;
    this.detune[0] = Math.pow(2, -half);
    this.detune[1] = Math.pow(2, half);
    let e = 0;
    for (let i = 0; i < this.n; i++) {
      this.freq[i] = m.freqs[i];
      this.sig[i] = m.sigmas[i];
      // (each partial's decay per sample: fixed for the voice's life)
      this.r[i] = Math.exp(-m.sigmas[i] / sampleRate);
      for (let c = 0; c < 2; c++) {
        this.re[c * MAX_PARTIALS + i] = m.amps[i];
        this.im[c * MAX_PARTIALS + i] = 0;
      }
      // the higher the partial, the longer it takes to come in
      const tIn = 0.0015 + m.bloom * Math.min(1, m.freqs[i] / 2500);
      this.inRate[i] = 1 - Math.exp(-128 / (tIn * sampleRate));
      this.inEnv[i] = 0;
      e += m.amps[i] * m.amps[i];
    }
    this.peak = Math.sqrt(e);
    this.gain = 0;
    this.target = m.gain;
    this.attack = Math.max(0.0015, m.attack);
    this.rate = 1 - Math.exp(-1 / (this.attack * sampleRate));
    this.glide = m.glide;
    this.buzz = m.buzz;
    this.gap = m.gap;
    this.age = 0;
    this.releasing = false;
    this.hpX = this.hpY = this.lp = this.lp2 = 0;
  }

  release(seconds: number) {
    this.target = 0;
    this.releasing = true;
    this.rate = 1 - Math.exp(-1 / (Math.max(0.004, seconds) * sampleRate));
  }

  level() {
    if (!this.on) return 0;
    // not started yet: as loud as it will be
    if (this.wait > 0) return this.target;
    return this.gain * Math.exp((-this.sig[0] * this.age) / sampleRate);
  }
}

class WireProcessor extends AudioWorkletProcessor {
  voices = Array.from({ length: SLOTS }, () => new Voice());
  hpA = 0;
  lpA = 0;
  peakOut = 0;
  bufA = new Float64Array(128);
  bufB = new Float64Array(128);

  constructor() {
    super();
    this.hpA = Math.exp((-TAU * 600) / sampleRate);
    this.lpA = 1 - Math.exp((-TAU * 3800) / sampleRate);
    this.port.onmessage = (e: MessageEvent<WireMsg>) => this.onMsg(e.data);
  }

  onMsg(m: WireMsg) {
    if (m.type === 'pluck') {
      // one wire: a new pluck stops the last one (quickly, never with a click)
      // (the dots' notes ring on under it: they have a cap of their own)
      if (m.group === 'main') for (const v of this.voices) if (v.on && v.group === 'main' && !v.releasing) v.release(0.04);
      // too many of a kind sounding: the quietest fades out to make room
      const live = this.voices.filter((v) => v.on && !v.releasing && v.group === m.group);
      if (live.length >= CAP[m.group]) live.reduce((a, b) => (a.level() < b.level() ? a : b)).release(0.08);
      let slot = this.voices.find((v) => !v.on);
      if (!slot) slot = this.voices.reduce((a, b) => (a.level() < b.level() ? a : b));
      slot.start(m);
    } else if (m.type === 'slide') {
      for (const v of this.voices) {
        if (v.on && v.group === 'main' && !v.releasing) {
          v.pitchTo = m.ratio;
          v.pitchTime = Math.max(0.02, m.time);
        }
      }
    } else if (m.type === 'damp') {
      for (const v of this.voices) if (v.on && (m.group === 'all' || v.group === m.group)) v.release(m.time);
    } else if (m.type === 'level') {
      this.port.postMessage({ type: 'level', peak: this.peakOut });
      this.peakOut = 0;
    }
  }

  process(_in: Float32Array[][], outputs: Float32Array[][]) {
    const L = outputs[0][0];
    const R = outputs[0][1] ?? outputs[0][0];
    if (!L) return true;
    // the second output: the arpeggio alone, for its delay
    const AL = outputs[1]?.[0];
    const AR = outputs[1]?.[1] ?? AL;
    // the third: the flageolets alone, for a room of their own
    const HL = outputs[2]?.[0];
    const HR = outputs[2]?.[1] ?? HL;
    const N = L.length;
    if (this.bufA.length !== N) {
      this.bufA = new Float64Array(N);
      this.bufB = new Float64Array(N);
    }
    L.fill(0);
    if (R !== L) R.fill(0);
    AL?.fill(0);
    if (AR && AR !== AL) AR.fill(0);
    const A = this.bufA;
    const B = this.bufB;

    for (const v of this.voices) {
      if (!v.on) continue;
      if (v.wait >= N) {
        v.wait -= N;
        continue;
      }
      v.wait = 0;
      const send = v.group === 'arp' && AL ? AL : v.group === 'harm' && HL ? HL : null;
      const sendR = send === HL ? HR : AR;
      const t = v.age / sampleRate;
      // tension modulation: a wide swing stretches the wire, the pitch falls as it calms
      const env = Math.exp(-v.sig[0] * t);
      // the slide, a damped spring block by block: it overshoots a touch and settles (the
      // faster the slide asked for, the stiffer the spring)
      {
        const dt = N / sampleRate / 4;
        const w0 = 2.4 / Math.max(0.03, v.pitchTime);
        for (let s = 0; s < 4; s++) {
          v.pitchV += ((v.pitchTo - v.pitch) * w0 * w0 - 2 * 0.42 * w0 * v.pitchV) * dt;
          v.pitch += v.pitchV * dt;
        }
      }
      // elastic: the snap back from sharp, and the wobble after it
      const elastic = v.boing * Math.exp(-t / 0.2) + v.wobble * Math.exp(-t / 0.7) * Math.sin(TAU * 5.2 * t) * Math.min(1, t / 0.08);
      const bend = (1 + v.glide * env * env + elastic) * v.pitch;
      A.fill(0);
      B.fill(0);
      for (let i = 0; i < v.n; i++) {
        const r = v.r[i];
        // the bloom: this partial's fade in, linear across the block
        const e0 = v.inEnv[i];
        const e1 = e0 + (1 - e0) * v.inRate[i];
        v.inEnv[i] = e1;
        const de = (e1 - e0) / N;
        for (let c = 0; c < v.copies; c++) {
          const w = (TAU * v.freq[i] * bend * v.detune[c]) / sampleRate;
          if (w >= Math.PI * 0.9) continue;
          const cc = r * Math.cos(w);
          const ss = r * Math.sin(w);
          const k = c * MAX_PARTIALS + i;
          let re = v.re[k];
          let im = v.im[k];
          const buf = c === 0 ? A : B;
          let g = e0;
          for (let j = 0; j < N; j++) {
            const nre = cc * re - ss * im;
            im = ss * re + cc * im;
            re = nre;
            g += de;
            buf[j] += im * g;
          }
          v.re[k] = re;
          v.im[k] = im;
        }
      }
      // the top partials die long before the fundamental: past hearing, they stop being run
      // (they're in order of frequency, and the higher, the faster they die)
      while (v.n > 1) {
        const k = v.n - 1;
        const k2 = MAX_PARTIALS + k;
        const e2 = v.re[k] * v.re[k] + v.im[k] * v.im[k] + (v.copies === 2 ? v.re[k2] * v.re[k2] + v.im[k2] * v.im[k2] : 0);
        if (e2 > 1e-12 || v.inEnv[k] < 0.99) break;
        v.n--;
      }
      const two = v.copies === 2;
      const gap = v.gap * v.peak;
      for (let j = 0; j < N; j++) {
        v.gain += (v.target - v.gain) * v.rate;
        const a = A[j];
        const b = two ? B[j] : a;
        // the middle of the two, for the buzz
        const m = (a + b) * 0.5;
        let z = 0;
        if (v.buzz > 0) {
          // the wire touching: whatever swings past the gap is clipped off, and that edge is
          // the sizzle, band passed so it sits in the middle and never screams
          const e = (m > gap ? m - gap : m < -gap ? m + gap : 0) * v.gain;
          const hp = this.hpA * (v.hpY + e - v.hpX);
          v.hpX = e;
          v.hpY = hp;
          v.lp += (hp - v.lp) * this.lpA;
          v.lp2 += (v.lp - v.lp2) * this.lpA;
          z = v.lp2 * v.buzz * BUZZ;
        }
        const g = v.gain;
        let l: number;
        let r: number;
        if (two) {
          // normalised so the two copies in phase make the level of one
          l = ((a * NEAR + b * FAR) / (NEAR + FAR)) * g + z;
          r = ((b * NEAR + a * FAR) / (NEAR + FAR)) * g + z;
        } else {
          l = r = a * g + z;
        }
        L[j] += l;
        if (R !== L) R[j] += r;
        if (send) {
          send[j] += l;
          if (sendR && sendR !== send) sendR[j] += r;
        }
      }
      v.age += N;
      if (!v.releasing && v.gain > v.target * 0.98 && v.attack < 0.02) v.rate = 1 - Math.exp(-1 / (0.02 * sampleRate));
      if ((v.releasing && v.gain < 1e-4) || (t > v.attack * 3 && env * v.gain < 2e-5) || t > 40) v.on = false;
    }

    for (let j = 0; j < N; j++) {
      const a = Math.max(Math.abs(L[j]), Math.abs(R[j]));
      if (a > this.peakOut) this.peakOut = a;
    }
    return true;
  }
}

registerProcessor('wire', WireProcessor);
