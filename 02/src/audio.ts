// Pre-baked procedural WebAudio studio synthesizer for 02 / Shatter:
// Synthesizes variation banks once into AudioBuffers at wake() (using direct-form II
// transposed RBJ biquads + physical modal oscillators) so runtime playback on mobile &
// desktop is just 1 AudioBufferSourceNode + GainNode (+ StereoPanner) — zero live
// oscillator/filter storms, zero iOS audio-thread starvation, and instant swoosh response.

type FilterKind = 'lowpass' | 'highpass' | 'bandpass';

/** Deterministic fast xorshift32 PRNG for reproducible variation banks. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Add a frequency-swept filtered white-noise burst into mono or stereo PCM buffer(s). */
function renderNoiseBurst(
  chL: Float32Array,
  chR: Float32Array | null,
  sr: number,
  startSec: number,
  durSec: number,
  type: FilterKind,
  f0: number,
  f1: number,
  q: number,
  peakGain: number,
  attackSec: number,
  pan: number,
  rng: () => number,
) {
  const i0 = Math.max(0, Math.floor(startSec * sr));
  const totalN = Math.max(1, Math.floor(durSec * sr));
  const i1 = Math.min(chL.length, i0 + totalN);
  const atkN = Math.max(1, Math.floor(attackSec * sr));
  const decN = Math.max(1, totalN - atkN);
  const fRatio = Math.max(1e-4, f1 / Math.max(20, f0));
  const fBlockStep = Math.pow(fRatio, 16 / totalN);
  const envStep = Math.exp(Math.log(0.0005) / decN);

  const clampedPan = Math.max(-1, Math.min(1, pan));
  const panAngle = (clampedPan + 1) * Math.PI * 0.25;
  const gL = chR ? Math.cos(panAngle) : 1;
  const gR = chR ? Math.sin(panAngle) : 0;

  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  let z1 = 0, z2 = 0;
  const maxFreq = sr * 0.44;
  const Q = Math.max(0.5, q);

  const setFreq = (freq: number) => {
    const fc = Math.max(20, Math.min(maxFreq, freq));
    const w0 = (2 * Math.PI * fc) / sr;
    const cosW = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const invA0 = 1 / (1 + alpha);
    if (type === 'lowpass') {
      const k = (1 - cosW) * 0.5;
      b0 = k * invA0;
      b1 = (1 - cosW) * invA0;
      b2 = b0;
    } else if (type === 'highpass') {
      const k = (1 + cosW) * 0.5;
      b0 = k * invA0;
      b1 = -(1 + cosW) * invA0;
      b2 = b0;
    } else {
      // Bandpass (constant 0 dB peak gain, matches WebAudio BiquadFilterNode)
      b0 = alpha * invA0;
      b1 = 0;
      b2 = -alpha * invA0;
    }
    a1 = -2 * cosW * invA0;
    a2 = (1 - alpha) * invA0;
  };

  let curFreq = f0;
  let decEnv = 1.0;
  setFreq(curFreq);
  for (let i = i0; i < i1; i++) {
    const n = i - i0;
    if ((n & 15) === 0 && n > 0 && f0 !== f1) {
      curFreq *= fBlockStep;
      setFreq(curFreq);
    }
    const x = rng() * 2 - 1;
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;

    let env: number;
    if (n < atkN) {
      env = n / atkN;
    } else {
      env = decEnv;
      decEnv *= envStep;
    }
    const s = y * peakGain * env;
    chL[i] += s * gL;
    if (chR) chR[i] += s * gR;
  }
}

/** Add a damped modal sine or triangle partial into mono or stereo PCM buffer(s). */
function renderPartial(
  chL: Float32Array,
  chR: Float32Array | null,
  sr: number,
  startSec: number,
  durSec: number,
  f0: number,
  f1: number,
  peakGain: number,
  attackSec: number,
  wave: 'sine' | 'triangle',
  pan: number,
  holdSec = 0,
) {
  const i0 = Math.max(0, Math.floor(startSec * sr));
  const totalN = Math.max(1, Math.floor(durSec * sr));
  const i1 = Math.min(chL.length, i0 + totalN);
  const atkN = Math.max(1, Math.floor(attackSec * sr));
  const holdN = Math.max(0, Math.floor(holdSec * sr));
  const decStart = atkN + holdN;
  const decN = Math.max(1, totalN - decStart);
  const fRatio = Math.max(1e-4, f1 / Math.max(20, f0));
  const fStep = f0 === f1 ? 1 : Math.pow(fRatio, 1 / totalN);
  const envStep = Math.exp(Math.log(0.0005) / decN);

  const clampedPan = Math.max(-1, Math.min(1, pan));
  const panAngle = (clampedPan + 1) * Math.PI * 0.25;
  const gL = chR ? Math.cos(panAngle) : 1;
  const gR = chR ? Math.sin(panAngle) : 0;

  const twoPiOverSr = (2 * Math.PI) / sr;
  const invTwoPi = 1 / (2 * Math.PI);
  let phase = 0;
  let curFreq = f0;
  let decEnv = holdN > 0 ? 0.88 : 1.0;

  for (let i = i0; i < i1; i++) {
    const n = i - i0;
    phase += curFreq * twoPiOverSr;
    if (fStep !== 1) curFreq *= fStep;

    let sample: number;
    if (wave === 'sine') {
      sample = Math.sin(phase);
    } else {
      const cyc = (phase * invTwoPi) % 1;
      sample = 1 - 4 * Math.abs(Math.round(cyc - 0.25) - (cyc - 0.25));
    }

    let env: number;
    if (n < atkN) {
      env = n / atkN;
    } else if (n < decStart) {
      env = 1.0 - 0.12 * ((n - atkN) / Math.max(1, holdN));
    } else {
      env = decEnv;
      decEnv *= envStep;
    }

    const s = sample * peakGain * env;
    chL[i] += s * gL;
    if (chR) chR[i] += s * gR;
  }
}

/** Run an in-place lowpass filter over a mono buffer (used to warm woodblock / bomb bodies). */
function applyLowpassInPlace(buf: Float32Array, sr: number, f0: number, f1: number, q: number) {
  const N = buf.length;
  const fRatio = Math.max(1e-4, f1 / Math.max(20, f0));
  const maxFreq = sr * 0.44;
  const Q = Math.max(0.5, q);
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  let z1 = 0, z2 = 0;

  const setFreq = (freq: number) => {
    const fc = Math.max(20, Math.min(maxFreq, freq));
    const w0 = (2 * Math.PI * fc) / sr;
    const cosW = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const invA0 = 1 / (1 + alpha);
    const k = (1 - cosW) * 0.5;
    b0 = k * invA0;
    b1 = (1 - cosW) * invA0;
    b2 = b0;
    a1 = -2 * cosW * invA0;
    a2 = (1 - alpha) * invA0;
  };

  setFreq(f0);
  for (let i = 0; i < N; i++) {
    if ((i & 31) === 0 && i > 0 && f0 !== f1) {
      setFreq(f0 * Math.pow(fRatio, i / N));
    }
    const x = buf[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    buf[i] = y;
  }
}

interface SoundBanks {
  gemPop: AudioBuffer[];
  blackWarn: AudioBuffer;
  bombExplode: AudioBuffer;
  failFreeze: AudioBuffer;
  cleave: AudioBuffer[];
  cleavePlain: AudioBuffer;
  shatter: AudioBuffer[];
  miniShatter: AudioBuffer[];
  clinkFloor: AudioBuffer[];
  clinkGlass: AudioBuffer[];
}

export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private banks: SoundBanks | null = null;
  private activeVoices = 0;
  private readonly maxVoices = 32;
  muted = false;

  wake() {
    if (this.ctx) {
      // iOS Safari uses both 'suspended' and 'interrupted' (e.g. after app switch / screen lock)
      if (this.ctx.state !== 'running') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    let ctx: AudioContext;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      ctx = new AC();
    }
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 10;
    comp.ratio.value = 4.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.14;

    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.80;
    this.out.connect(comp).connect(ctx.destination);

    // 1-sample silent kick reliably unlocks iOS hardware audio output inside the first user gesture
    try {
      const unlockBuf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const uSrc = ctx.createBufferSource();
      uSrc.buffer = unlockBuf;
      uSrc.connect(ctx.destination);
      uSrc.start(0);
    } catch {
      // ignore
    }

    if (ctx.state !== 'running') {
      ctx.resume().catch(() => {});
    }

    const noiseLen = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;

    this.banks = this.bakeBanks(ctx);

    // Auto-resume cleanly if iOS Safari interrupts audio when switching apps / notifications
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.ctx && this.ctx.state !== 'running') {
        this.ctx.resume().catch(() => {});
      }
    });
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.out && this.ctx) {
      this.out.gain.setTargetAtTime(m ? 0 : 0.80, this.ctx.currentTime, 0.02);
    }
  }

  /** Synchronously pre-bake all procedural studio variations once into lightweight AudioBuffers (~5ms). */
  private bakeBanks(ctx: AudioContext): SoundBanks {
    const sr = ctx.sampleRate;
    const rng = makeRng(20260202);

    const makeMono = (sec: number) => ctx.createBuffer(1, Math.max(1, Math.ceil(sec * sr)), sr);
    const makeStereo = (sec: number) => ctx.createBuffer(2, Math.max(1, Math.ceil(sec * sr)), sr);

    // 1) Dry hardwood woodblock ("tok!") launch cue variations
    const gemPop: AudioBuffer[] = [];
    for (let v = 0; v < 4; v++) {
      const buf = makeMono(0.10);
      const d = buf.getChannelData(0);
      const f0 = 660 + v * 42;
      renderNoiseBurst(d, null, sr, 0, 0.018, 'bandpass', 1750, 920, 1.6, 0.58, 0.0015, 0, rng);
      renderPartial(d, null, sr, 0, 0.072, f0 * 1.04, f0, 0.56, 0.0015, 'triangle', 0, 0.005);
      renderPartial(d, null, sr, 0, 0.032, f0 * 2.32 * 1.04, f0 * 2.32, 0.28, 0.0015, 'triangle', 0, 0.004);
      applyLowpassInPlace(d, sr, 2600, 2600, 0.8);
      gemPop.push(buf);
    }

    // 3) Ominous Black Diamond pre-launch warning cue
    const blackWarn = makeMono(0.28);
    {
      const d = blackWarn.getChannelData(0);
      renderPartial(d, null, sr, 0, 0.25, 210, 310, 0.30, 0.04, 'triangle', 0);
      renderNoiseBurst(d, null, sr, 0, 0.25, 'bandpass', 1400, 3100, 2.6, 0.22, 0.045, 0, rng);
    }

    // 4) Cinematic 2.35s sub-bass game-over boom (pre-saturated tanh harmonic body + sub drop + roar)
    const bombExplode = makeMono(2.40);
    {
      const d = bombExplode.getChannelData(0);
      const harmBuf = new Float32Array(d.length);
      // Warm driven 2x harmonic body -> tanh saturator -> sweeping lowpass
      renderPartial(harmBuf, null, sr, 0, 2.05, 184, 52, 0.58, 0.010, 'triangle', 0);
      for (let i = 0; i < harmBuf.length; i++) harmBuf[i] = Math.tanh(harmBuf[i] * 2.4);
      applyLowpassInPlace(harmBuf, sr, 420, 62, 0.85);

      // Pure sub-bass drop (92 -> 24 Hz) + tight 65ms cannon punch + roaring pressure tail
      renderPartial(d, null, sr, 0, 2.35, 92, 24, 0.92, 0.010, 'sine', 0, 0.065);
      renderPartial(d, null, sr, 0, 0.075, 220, 46, 0.65, 0.003, 'sine', 0);
      renderNoiseBurst(d, null, sr, 0, 1.85, 'lowpass', 680, 62, 0.8, 0.74, 0.006, 0, rng);
      renderNoiseBurst(d, null, sr, 0, 0.16, 'bandpass', 2100, 420, 1.0, 0.46, 0.004, 0, rng);
      for (let i = 0; i < d.length; i++) d[i] += harmBuf[i];
    }

    // 5) Dramatic freeze-tension crack + reverse-suction swell
    const failFreeze = makeMono(0.41);
    {
      const d = failFreeze.getChannelData(0);
      renderNoiseBurst(d, null, sr, 0, 0.16, 'bandpass', 1900, 580, 2.2, 0.48, 0.003, 0, rng);
      renderPartial(d, null, sr, 0, 0.36, 195, 195, 0.16, 0.003, 'sine', 0);
      renderPartial(d, null, sr, 0.015, 0.34, 208, 208, 0.13, 0.003, 'sine', 0);
      // Reverse-suction swell cutting dead at 0.385s
      const swellTmp = new Float32Array(d.length);
      renderNoiseBurst(swellTmp, null, sr, 0, 0.36, 'bandpass', 160, 1250, 1.6, 0.36, 0.34, 0, rng);
      for (let i = 0; i < d.length; i++) d[i] += swellTmp[i];
    }

    // 6) Diamond cleave (plain snap for instant toss-mode slicing + ticking variant for pedestal mode)
    const cleavePlain = makeStereo(0.20);
    {
      const L = cleavePlain.getChannelData(0);
      const R = cleavePlain.getChannelData(1);
      renderNoiseBurst(L, R, sr, 0, 0.08, 'highpass', 5800, 9200, 1.4, 0.50, 0.002, 0.15, rng);
      renderNoiseBurst(L, R, sr, 0.005, 0.06, 'bandpass', 4200, 2600, 2.2, 0.62, 0.002, 0.15, rng);
      renderPartial(L, R, sr, 0, 0.14, 3850, 3850, 0.14, 0.001, 'sine', 0.25);
      renderPartial(L, R, sr, 0.004, 0.11, 5750, 5750, 0.09, 0.001, 'sine', 0.30);
    }
    const cleave: AudioBuffer[] = [];
    for (let v = 0; v < 2; v++) {
      const buf = makeStereo(0.65);
      const L = buf.getChannelData(0);
      const R = buf.getChannelData(1);
      L.set(cleavePlain.getChannelData(0));
      R.set(cleavePlain.getChannelData(1));
      for (let i = 0; i < 14; i++) {
        const frac = Math.pow(i / 14, 1.3);
        const at = 0.03 + frac * 0.50 + rng() * 0.025;
        const p = 0.10 + rng() * 0.40;
        renderNoiseBurst(L, R, sr, at, 0.014, 'bandpass', 4800 + rng() * 3400, 3200, 2.4, 0.18 + frac * 0.14, 0.001, p, rng);
        renderPartial(L, R, sr, at, 0.035 + rng() * 0.03, 3200 + rng() * 4400, 3200 + rng() * 4400, 0.035, 0.001, 'sine', p);
      }
      cleave.push(buf);
    }

    // 7) Full stereo crystal shatter variations (all 24 crystalline pings + 3 bursts baked into ONE buffer!)
    const shatter: AudioBuffer[] = [];
    for (let v = 0; v < 4; v++) {
      const buf = makeStereo(0.68);
      const L = buf.getChannelData(0);
      const R = buf.getChannelData(1);
      renderNoiseBurst(L, R, sr, 0, 0.14, 'lowpass', 620, 110, 0.7, 0.62, 0.002, 0, rng);
      renderNoiseBurst(L, R, sr, 0, 0.11, 'bandpass', 5400, 2900, 0.9, 0.80, 0.002, 0, rng);
      renderNoiseBurst(L, R, sr, 0.008, 0.54, 'highpass', 4400, 7600, 0.6, 0.30, 0.004, 0, rng);
      for (let i = 0; i < 24; i++) {
        const dSec = rng() * rng() * 0.30;
        const freq = 2600 + rng() * 6200;
        const dur = 0.035 + rng() * 0.12;
        const pan = -0.55 + rng() * 1.10;
        renderPartial(L, R, sr, dSec, dur, freq, freq, 0.045, 0.001, 'sine', pan);
      }
      shatter.push(buf);
    }

    // 8) Secondary shard mini-shatter variations
    const miniShatter: AudioBuffer[] = [];
    for (let v = 0; v < 4; v++) {
      const buf = makeMono(0.24);
      const d = buf.getChannelData(0);
      renderNoiseBurst(d, null, sr, 0, 0.055, 'bandpass', 5800, 3200, 1.3, 0.40, 0.0015, 0, rng);
      renderNoiseBurst(d, null, sr, 0.005, 0.16, 'highpass', 4800, 8200, 0.8, 0.16, 0.002, 0, rng);
      for (let i = 0; i < 6; i++) {
        const freq = 3400 + rng() * 5600;
        renderPartial(d, null, sr, rng() * 0.045, 0.025 + rng() * 0.065, freq, freq, 0.04, 0.001, 'sine', 0);
      }
      miniShatter.push(buf);
    }

    // 9) Rapier glass-on-floor & glass-on-glass clink banks across shard sizes (small -> large)
    const clinkFloor: AudioBuffer[] = [];
    const clinkGlass: AudioBuffer[] = [];
    for (let v = 0; v < 6; v++) {
      const r = 0.02 + (v / 5) * 0.14;
      const baseF = 5400 / (1 + r * 2.8);
      const durF = 0.032 + r * 0.22;

      // Floor clink (3 inharmonic crystal modes + crisp surface tap)
      const bf = makeMono(durF + 0.03);
      const df = bf.getChannelData(0);
      const m2 = 1.48 + rng() * 0.45;
      const m3 = 2.35 + rng() * 0.80;
      renderPartial(df, null, sr, 0, durF, baseF, baseF, 0.55, 0.001, 'sine', 0);
      renderPartial(df, null, sr, 0, durF / m2, Math.min(15500, baseF * m2), Math.min(15500, baseF * m2), 0.32, 0.001, 'sine', 0);
      renderPartial(df, null, sr, 0, durF / m3, Math.min(15500, baseF * m3), Math.min(15500, baseF * m3), 0.18, 0.001, 'sine', 0);
      renderNoiseBurst(df, null, sr, 0, 0.036, 'bandpass', Math.min(12000, baseF * 0.72), Math.min(12000, baseF * 0.68), 1.2, 0.72, 0.001, 0, rng);
      clinkFloor.push(bf);

      // Glass-on-glass clink (pure resonant crystal ring, slightly longer decay)
      const durG = durF * 1.25;
      const bg = makeMono(durG + 0.03);
      const dg = bg.getChannelData(0);
      const g2 = 1.52 + rng() * 0.42;
      const g3 = 2.40 + rng() * 0.75;
      renderPartial(dg, null, sr, 0, durG, baseF, baseF, 0.58, 0.001, 'sine', 0);
      renderPartial(dg, null, sr, 0, durG / g2, Math.min(15500, baseF * g2), Math.min(15500, baseF * g2), 0.34, 0.001, 'sine', 0);
      renderPartial(dg, null, sr, 0, durG / g3, Math.min(15500, baseF * g3), Math.min(15500, baseF * g3), 0.20, 0.001, 'sine', 0);
      clinkGlass.push(bg);
    }

    return {
      gemPop,
      blackWarn,
      bombExplode,
      failFreeze,
      cleave,
      cleavePlain,
      shatter,
      miniShatter,
      clinkFloor,
      clinkGlass,
    };
  }

  /** Play a pre-baked AudioBuffer with 1–3 ultra-light WebAudio nodes and voice-cap protection. */
  private playBuf(
    buf: AudioBuffer,
    gainVal: number,
    rate = 1,
    pan?: number,
    panTo?: number,
    panDur = 0.14,
    priority = true,
  ) {
    if (!this.ctx || !this.out) return;
    if (!priority && this.activeVoices >= this.maxVoices) return;
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
    }
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.003;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.max(0.2, Math.min(2.5, rate));

    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);

    if (pan !== undefined) {
      const p = ctx.createStereoPanner();
      const p0 = Math.max(-0.94, Math.min(0.94, pan));
      p.pan.setValueAtTime(p0, t);
      if (panTo !== undefined) {
        p.pan.linearRampToValueAtTime(Math.max(-0.94, Math.min(0.94, panTo)), t + panDur);
      }
      src.connect(g).connect(p).connect(this.out);
    } else {
      src.connect(g).connect(this.out);
    }

    this.activeVoices++;
    src.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    src.start(t);
  }

  private ping(at: number, freq: number, dur: number, gain: number, pan = 0) {
    if (!this.ctx || !this.out) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(Math.min(16000, freq), at);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    o.connect(g).connect(p).connect(this.out);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  /** Original native WebAudio directional katana swoosh — smooth per-sample Biquad sweep, pans LTR/RTL! */
  swoosh(panFrom: number, panTo: number, intensity = 0.65) {
    if (!this.ctx || !this.out || !this.noise) return;
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
    }
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.003;
    const k = Math.max(0.25, Math.min(1, intensity));
    const dur = 0.14 + k * 0.045;

    const p = ctx.createStereoPanner();
    const p0 = Math.max(-0.94, Math.min(0.94, panFrom));
    const p1 = Math.max(-0.94, Math.min(0.94, panTo));
    p.pan.setValueAtTime(p0, t);
    p.pan.linearRampToValueAtTime(p1, t + dur);
    p.connect(this.out);

    // Higher, crisper blade air sweep (clean katana sheen, never shrill)
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.Q.value = 1.35;
    filt.frequency.setValueAtTime(680 + k * 240, t);
    filt.frequency.exponentialRampToValueAtTime(2250 + k * 750, t + dur * 0.24);
    filt.frequency.exponentialRampToValueAtTime(560, t + dur);
    const g = ctx.createGain();
    const peak = 0.36 + k * 0.22;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.16);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(p);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);

    // Light airy high-blade whisper layer for crispness on laptop/phone speakers
    const hiSrc = ctx.createBufferSource();
    hiSrc.buffer = this.noise;
    hiSrc.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.Q.value = 1.8;
    hp.frequency.setValueAtTime(1850 + k * 450, t);
    hp.frequency.exponentialRampToValueAtTime(3400 + k * 600, t + dur * 0.28);
    hp.frequency.exponentialRampToValueAtTime(1400, t + dur);
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, t);
    hg.gain.linearRampToValueAtTime(0.12 + k * 0.09, t + dur * 0.18);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    hiSrc.connect(hp).connect(hg).connect(p);
    hiSrc.start(t, Math.random() * 1.5);
    hiSrc.stop(t + dur + 0.02);
  }

  /** Crisp, dry hardwood woodblock ("tok!") cue right before a colored gem launches from below! */
  gemPop(pan = 0) {
    if (!this.banks) return;
    const bank = this.banks.gemPop;
    const buf = bank[Math.floor(Math.random() * bank.length)];
    const rate = 0.95 + Math.random() * 0.12;
    this.playBuf(buf, 0.95, rate, Math.max(-0.85, Math.min(0.85, pan)), undefined, 0, true);
  }

  /** Distinct ominous pre-launch telegraph cue right before a Poisoned Black Diamond rises from below. */
  blackWarning(pan = 0) {
    if (!this.banks) return;
    const rate = 0.96 + Math.random() * 0.08;
    this.playBuf(this.banks.blackWarn, 0.95, rate, Math.max(-0.85, Math.min(0.85, pan)), undefined, 0, true);
  }

  /** Cinematic trailer sub-bass boom (THWOOOM impact drop + 2.3s chest-rattling sub tail)! */
  bombExplode() {
    if (!this.banks) return;
    this.playBuf(this.banks.bombExplode, 1.0, 1.0, undefined, undefined, 0, true);
  }

  /** Airy studio whoosh + subtle crystal bell as a new glass block launches from below. */
  launch(pan = 0, poisoned = false) {
    if (!this.ctx || !this.banks) return;
    const t = this.ctx.currentTime + 0.004;
    if (poisoned) {
      this.playBuf(this.banks.blackWarn, 0.65, 0.85, pan, undefined, 0, true);
      this.ping(t + 0.02, 520 + Math.random() * 60, 0.22, 0.075, pan);
    } else {
      this.swoosh(pan - 0.15, pan + 0.15, 0.30);
      this.ping(t + 0.02, 1680 + Math.random() * 240, 0.16, 0.045, pan);
    }
  }

  /** Sparkling rising crystal chime for multi-hit combos (2x, 3x...) & Jewel Cutter extra cuts! */
  comboChime(tier: number, pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.004;
    const scale = [1046.5, 1318.5, 1568.0, 2093.0, 2637.0, 3136.0];
    const base = scale[Math.min(scale.length - 1, Math.max(0, tier - 1))];
    this.ping(t, base, 0.26, 0.09, pan);
    this.ping(t + 0.04, base * 1.25, 0.24, 0.065, pan);
  }

  /** Dramatic freeze-tension crack + brief reverse-suction swell right before the cinematic sub-bass boom! */
  failFreeze() {
    if (!this.banks) return;
    this.playBuf(this.banks.failFreeze, 1.0, 1.0, undefined, undefined, 0, true);
  }

  /** Crisp luminous 3-note crystal triad on Level Clear! */
  levelClear() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.004;
    this.ping(t, 1046.5, 0.30, 0.08, -0.2);
    this.ping(t + 0.075, 1318.5, 0.32, 0.085, 0.0);
    this.ping(t + 0.15, 1568.0, 0.42, 0.10, 0.2);
    this.ping(t + 0.22, 2093.0, 0.48, 0.09, 0.0);
  }

  /** Step 1: The cutting plane cleaves the glass block & optionally creeps cracks through the severed piece. */
  cleave(_crackDur = 0.55, withTicks = true) {
    if (!this.banks) return;
    const rate = 0.94 + Math.random() * 0.12;
    if (!withTicks) {
      this.playBuf(this.banks.cleavePlain, 0.95, rate, undefined, undefined, 0, true);
      return;
    }
    const bank = this.banks.cleave;
    const buf = bank[Math.floor(Math.random() * bank.length)];
    this.playBuf(buf, 0.95, rate, undefined, undefined, 0, true);
  }

  /** Step 2: The fractured piece explodes into shards & splinters (pre-baked stereo buffer!). */
  shatter(rate = 1) {
    if (!this.banks) return;
    const bank = this.banks.shatter;
    const buf = bank[Math.floor(Math.random() * bank.length)];
    const r = Math.max(0.22, rate * (0.92 + Math.random() * 0.16));
    this.playBuf(buf, 0.95, r, undefined, undefined, 0, true);
  }

  /** Secondary fracture when a falling shard breaks again on hitting the studio floor! */
  miniShatter(pan: number, rate = 1) {
    if (!this.banks) return;
    const bank = this.banks.miniShatter;
    const buf = bank[Math.floor(Math.random() * bank.length)];
    const r = Math.max(0.22, rate * (0.90 + Math.random() * 0.20));
    this.playBuf(buf, 0.90, r, pan, undefined, 0, false);
  }

  /** One contact from the Rapier simulation (kind 0 = studio floor, 1 = glass on glass). */
  clink(size: number, strength: number, kind: number, pan: number, rate = 1) {
    if (!this.banks) return;
    const r = Math.min(0.18, Math.sqrt(Math.max(1e-6, size)));
    const gain = Math.min(0.42, (0.02 + strength * 0.045) * (0.45 + r * 8));
    if (gain < 0.025) return;
    const bank = kind === 1 ? this.banks.clinkGlass : this.banks.clinkFloor;
    const idx = Math.min(bank.length - 1, Math.max(0, Math.floor((r / 0.16) * bank.length)));
    const pitch = Math.max(0.25, rate * (0.86 + Math.random() * 0.28));
    this.playBuf(bank[idx], gain, pitch, pan, undefined, 0, false);
  }
}
