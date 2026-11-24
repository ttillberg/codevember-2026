// Procedural WebAudio studio synthesizer: woodblock launch cue, directional blade swoosh,
// diamond cleave, cinematic sub-bass boom, explosive shatter, and Rapier contact clinks.
export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  wake() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.78;
    this.out.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.out && this.ctx) {
      this.out.gain.setTargetAtTime(m ? 0 : 0.78, this.ctx.currentTime, 0.02);
    }
  }

  private burst(at: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, gain: number, rate = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = rate;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, at);
    filt.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filt).connect(g).connect(this.out!);
    src.start(at, Math.random() * 1.5);
    src.stop(at + dur + 0.02);
  }

  private ping(at: number, freq: number, dur: number, gain: number, pan = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(Math.min(16000, freq), at);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    o.connect(g).connect(p).connect(this.out!);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  /** Crisp, airy, higher-pitched directional blade swoosh — pans cleanly LTR or RTL matching your cut! */
  swoosh(panFrom: number, panTo: number, intensity = 0.65) {
    if (!this.ctx || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const k = Math.max(0.25, Math.min(1, intensity));
    const dur = 0.14 + k * 0.045;

    const p = ctx.createStereoPanner();
    const p0 = Math.max(-0.94, Math.min(0.94, panFrom));
    const p1 = Math.max(-0.94, Math.min(0.94, panTo));
    p.pan.setValueAtTime(p0, t);
    p.pan.linearRampToValueAtTime(p1, t + dur);
    p.connect(this.out!);

    // Higher, crisper blade air sweep (clean katana sheen, never shrill)
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.Q.value = 1.35;
    filt.frequency.setValueAtTime(680 + k * 240, t);
    filt.frequency.exponentialRampToValueAtTime(2250 + k * 750, t + dur * 0.30);
    filt.frequency.exponentialRampToValueAtTime(560, t + dur);
    const g = ctx.createGain();
    const peak = 0.36 + k * 0.22;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.22);
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
    hp.frequency.exponentialRampToValueAtTime(3400 + k * 600, t + dur * 0.35);
    hp.frequency.exponentialRampToValueAtTime(1400, t + dur);
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, t);
    hg.gain.linearRampToValueAtTime(0.12 + k * 0.09, t + dur * 0.24);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    hiSrc.connect(hp).connect(hg).connect(p);
    hiSrc.start(t, Math.random() * 1.5);
    hiSrc.stop(t + dur + 0.02);
  }

  /** Crisp, dry hardwood woodblock ("tok!") cue right before a colored gem launches from below! */
  gemPop(pan = 0) {
    if (!this.ctx || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    const clampedPan = Math.max(-0.85, Math.min(0.85, pan));

    const p = ctx.createStereoPanner();
    p.pan.value = clampedPan;
    p.connect(this.out!);

    // Warm hollow hardwood cavity filter
    const woodLP = ctx.createBiquadFilter();
    woodLP.type = 'lowpass';
    woodLP.frequency.setValueAtTime(2600, t);
    woodLP.Q.value = 0.8;
    woodLP.connect(p);

    // 1) Dry wooden mallet knock transient (~12ms)
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const knockBP = ctx.createBiquadFilter();
    knockBP.type = 'bandpass';
    knockBP.Q.value = 1.6;
    knockBP.frequency.setValueAtTime(1750, t);
    knockBP.frequency.exponentialRampToValueAtTime(920, t + 0.014);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.001, t);
    ng.gain.linearRampToValueAtTime(0.58, t + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
    src.connect(knockBP).connect(ng).connect(woodLP);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.025);

    // 2) Hollow hardwood body modes (fundamental + dry 2.32x woodblock overtone, subtle pitch drop on impact)
    const f0 = 660 + Math.random() * 140;
    const modes: Array<[number, number, number]> = [
      [1.0, 0.56, 0.072],
      [2.32, 0.28, 0.032],
    ];
    for (const [ratio, peak, dur] of modes) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const freq = f0 * ratio;
      // Tiny realistic mallet-compression pitch settle (-4% in 10ms)
      osc.frequency.setValueAtTime(freq * 1.04, t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + 0.012);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.002);
      g.gain.setValueAtTime(peak * 0.88, t + 0.007);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g).connect(woodLP);
      osc.start(t);
      osc.stop(t + dur + 0.01);
    }
  }

  /** Distinct ominous pre-launch telegraph cue right before a Poisoned Black Diamond rises from below. */
  blackWarning(pan = 0) {
    if (!this.ctx || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const clampedPan = Math.max(-0.85, Math.min(0.85, pan));

    const p = ctx.createStereoPanner();
    p.pan.value = clampedPan;
    p.connect(this.out!);

    // Audible low-mid rising obsidian tension pulse (clear on phone/laptop speakers)
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, t);
    osc.frequency.exponentialRampToValueAtTime(310, t + 0.22);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.30, t + 0.045);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(og).connect(p);
    osc.start(t);
    osc.stop(t + 0.27);

    // Crisp rising fuse-sizzle shimmer
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.Q.value = 2.6;
    filt.frequency.setValueAtTime(1400, t);
    filt.frequency.exponentialRampToValueAtTime(3100, t + 0.23);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.20, t + 0.05);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    src.connect(filt).connect(ng).connect(p);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.27);
  }

  /** Cinematic trailer sub-bass boom (THWOOOM impact drop + 2.3s chest-rattling sub tail + warm harmonic drive)! */
  bombExplode() {
    if (!this.ctx || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Soft analog tanh saturator so the sub-bass hits huge & warm on both headphones and laptop/phone speakers
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 127.5) - 1;
      curve[i] = Math.tanh(x * 2.4);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';

    const boomLP = ctx.createBiquadFilter();
    boomLP.type = 'lowpass';
    boomLP.Q.value = 0.85;
    boomLP.frequency.setValueAtTime(420, t);
    boomLP.frequency.exponentialRampToValueAtTime(110, t + 0.65);
    boomLP.frequency.exponentialRampToValueAtTime(58, t + 2.2);
    shaper.connect(boomLP).connect(this.out!);

    // 1) Pure cinematic sub-bass drop: 92 Hz -> 42 Hz (fast impact) -> 24 Hz (long ominous tail!)
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(92, t);
    sub.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    sub.frequency.exponentialRampToValueAtTime(24, t + 2.15);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.0001, t);
    subG.gain.linearRampToValueAtTime(0.95, t + 0.012);
    subG.gain.setValueAtTime(0.88, t + 0.08);
    subG.gain.exponentialRampToValueAtTime(0.0001, t + 2.35);
    sub.connect(subG).connect(this.out!);
    sub.start(t);
    sub.stop(t + 2.40);

    // 2) Warm driven harmonic body (2x octave + slight detune) -> psychoacoustic sub presence on phone/laptop speakers!
    const harm = ctx.createOscillator();
    harm.type = 'triangle';
    harm.frequency.setValueAtTime(184, t);
    harm.frequency.exponentialRampToValueAtTime(84, t + 0.16);
    harm.frequency.exponentialRampToValueAtTime(48, t + 1.95);
    const harmG = ctx.createGain();
    harmG.gain.setValueAtTime(0.0001, t);
    harmG.gain.linearRampToValueAtTime(0.55, t + 0.01);
    harmG.gain.exponentialRampToValueAtTime(0.0001, t + 2.05);
    harm.connect(harmG).connect(shaper);
    harm.start(t);
    harm.stop(t + 2.10);

    // 3) Tight impact cannon transient (first 65ms punch)
    const punch = ctx.createOscillator();
    punch.type = 'sine';
    punch.frequency.setValueAtTime(220, t);
    punch.frequency.exponentialRampToValueAtTime(46, t + 0.055);
    const punchG = ctx.createGain();
    punchG.gain.setValueAtTime(0.68, t);
    punchG.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
    punch.connect(punchG).connect(this.out!);
    punch.start(t);
    punch.stop(t + 0.09);

    // 4) Wide cinematic air-pressure roar & slow reverberant rumble tail
    this.burst(t, 1.85, 'lowpass', 680, 62, 0.8, 0.78);
    this.burst(t, 0.16, 'bandpass', 2100, 420, 1.0, 0.48);
  }

  /** Airy studio whoosh + subtle crystal bell as a new glass block launches from below. */
  launch(pan = 0, poisoned = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (poisoned) {
      // Darker obsidian whoosh + subtle low warning undertone for a Poisoned Black Diamond
      this.burst(t, 0.24, 'bandpass', 160, 720, 2.1, 0.28);
      this.ping(t + 0.02, 520 + Math.random() * 60, 0.22, 0.075, pan);
    } else {
      this.burst(t, 0.22, 'bandpass', 240, 1450, 1.8, 0.22);
      this.ping(t + 0.02, 1680 + Math.random() * 240, 0.16, 0.045, pan);
    }
  }

  /** Sparkling rising crystal chime for multi-hit combos (2x, 3x...) & Jewel Cutter extra cuts! */
  comboChime(tier: number, pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const scale = [1046.5, 1318.5, 1568.0, 2093.0, 2637.0, 3136.0];
    const base = scale[Math.min(scale.length - 1, Math.max(0, tier - 1))];
    this.ping(t, base, 0.26, 0.09, pan);
    this.ping(t + 0.04, base * 1.25, 0.24, 0.065, pan);
  }

  /** Dramatic freeze-tension crack + brief reverse-suction swell right before the cinematic sub-bass boom! */
  failFreeze() {
    if (!this.ctx || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // Sharp freeze glass crack + eerie minor-second ring
    this.burst(t, 0.16, 'bandpass', 1900, 580, 2.2, 0.48);
    this.ping(t, 195, 0.36, 0.16, 0);
    this.ping(t + 0.015, 208, 0.34, 0.13, 0);

    // Rising reverse-suction swell that cuts dead 35ms before the 0.42s boom drop!
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.Q.value = 1.6;
    filt.frequency.setValueAtTime(160, t);
    filt.frequency.exponentialRampToValueAtTime(1250, t + 0.36);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.385);
    src.connect(filt).connect(g).connect(this.out!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.40);
  }

  /** Crisp luminous 3-note crystal triad on Level Clear! */
  levelClear() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.ping(t, 1046.5, 0.30, 0.08, -0.2);
    this.ping(t + 0.075, 1318.5, 0.32, 0.085, 0.0);
    this.ping(t + 0.15, 1568.0, 0.42, 0.10, 0.2);
    this.ping(t + 0.22, 2093.0, 0.48, 0.09, 0.0);
  }

  /** Step 1: The cutting plane cleaves the glass block & optionally creeps cracks through the severed piece. */
  cleave(crackDur = 0.55, withTicks = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Crisp diamond score + sharp glassy snap
    this.burst(t, 0.08, 'highpass', 5800, 9200, 1.4, 0.52);
    this.burst(t + 0.006, 0.06, 'bandpass', 4200, 2600, 2.2, 0.65);
    this.ping(t, 3600 + Math.random() * 600, 0.14, 0.14, 0.25);
    this.ping(t + 0.004, 5400 + Math.random() * 900, 0.11, 0.09, 0.3);

    if (!withTicks) return;

    // Creeping stress cracks spidering through the cut piece
    const ticks = 14;
    for (let i = 0; i < ticks; i++) {
      const frac = Math.pow(i / ticks, 1.3);
      const at = t + 0.03 + frac * crackDur * 0.92 + Math.random() * 0.03;
      this.burst(at, 0.014, 'bandpass', 4800 + Math.random() * 3400, 3200, 2.4, 0.18 + frac * 0.14);
      this.ping(at, 3200 + Math.random() * 4400, 0.035 + Math.random() * 0.03, 0.035, 0.15 + Math.random() * 0.35);
    }
  }

  /** Step 2: The fractured piece explodes into shards & splinters. */
  shatter(rate = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const inv = 1 / Math.max(0.15, rate);
    this.burst(t, 0.14 * inv, 'lowpass', 620 * rate, 110 * rate, 0.7, 0.65, rate);
    this.burst(t, 0.11 * inv, 'bandpass', 5400 * rate, 2900 * rate, 0.9, 0.85, rate);
    this.burst(t + 0.008, 0.55 * inv, 'highpass', 4400 * rate, 7600 * rate, 0.6, 0.32, rate);
    for (let i = 0; i < 24; i++) {
      const d = Math.random() * Math.random() * 0.32 * inv;
      this.ping(
        t + d,
        (2600 + Math.random() * 6200) * (0.45 + 0.55 * rate),
        (0.035 + Math.random() * 0.12) * inv,
        0.045,
        -0.3 + Math.random() * 0.9,
      );
    }
  }

  /** Secondary fracture when a falling shard breaks again on hitting the studio floor! */
  miniShatter(pan: number, rate = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const inv = 1 / Math.max(0.18, rate);
    this.burst(t, 0.055 * inv, 'bandpass', 5800 * rate, 3200 * rate, 1.3, 0.42, rate);
    this.burst(t + 0.005, 0.16 * inv, 'highpass', 4800 * rate, 8200 * rate, 0.8, 0.16, rate);
    for (let i = 0; i < 6; i++) {
      this.ping(
        t + Math.random() * 0.045 * inv,
        (3400 + Math.random() * 5600) * (0.45 + 0.55 * rate),
        (0.025 + Math.random() * 0.065) * inv,
        0.04,
        pan + (Math.random() - 0.5) * 0.2,
      );
    }
  }

  /** One contact from the Rapier simulation (kind 0 = studio floor, 1 = glass on glass). */
  clink(size: number, strength: number, kind: number, pan: number, rate = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + Math.random() * 0.01;
    const r = Math.min(0.18, Math.sqrt(Math.max(1e-6, size)));
    const f = (5400 / (1 + r * 2.8)) * (0.78 + Math.random() * 0.44) * (0.45 + 0.55 * rate);
    const g = Math.min(0.24, (0.01 + strength * 0.024) * (0.45 + r * 8));
    const dur = ((0.028 + r * 0.22) * (kind === 1 ? 1.25 : 1)) / Math.max(0.15, rate);
    const out = ctx.createStereoPanner();
    out.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(this.out!);

    for (const [mul, vol] of [
      [1, 1],
      [1.48 + Math.random() * 0.45, 0.58],
      [2.35 + Math.random() * 0.8, 0.32],
    ]) {
      const o = ctx.createOscillator();
      const e = ctx.createGain();
      o.frequency.value = Math.min(16000, f * mul);
      e.gain.setValueAtTime(g * vol, t);
      e.gain.exponentialRampToValueAtTime(0.0001, t + dur / mul);
      o.connect(e).connect(out);
      o.start(t);
      o.stop(t + dur + 0.02);
    }

    if (kind === 0) {
      const src = ctx.createBufferSource();
      const filt = ctx.createBiquadFilter();
      const e = ctx.createGain();
      src.buffer = this.noise;
      src.playbackRate.value = Math.max(0.2, rate);
      filt.type = 'bandpass';
      filt.frequency.value = Math.min(12000, f * 0.72);
      filt.Q.value = 1.2;
      e.gain.setValueAtTime(g * 1.4, t);
      e.gain.exponentialRampToValueAtTime(0.0001, t + 0.036 / Math.max(0.2, rate));
      src.connect(filt).connect(e).connect(out);
      src.start(t, Math.random() * 1.5);
      src.stop(t + 0.055 / Math.max(0.2, rate));
    }
  }
}
