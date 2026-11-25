// Procedural Web Audio for the Commodore 1702 monitor & C64 keystrokes + basic SID Voice 1.

export class MonitorSound {
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private humGain: GainNode | null = null;
  private sidVoices: ({
    osc: OscillatorNode;
    filter: BiquadFilterNode;
    gain: GainNode;
    routedToGlobalFilter: boolean;
    lastPwBucket: number;
  } | null)[] = [null, null, null];
  private sidBus: GainNode | null = null;
  private sidGlobalFilter: BiquadFilterNode | null = null;
  private sidEchoWet: GainNode | null = null;
  private sidPulseWaves: PeriodicWave[] | null = null;
  private sidRegs = new Uint8Array(25);

  enabled = true;
  private powered = true;

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.noiseBuf = this.makeNoiseBuffer(this.ctx);
      this.setupHum(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.25);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private setupHum(ctx: AudioContext) {
    // Very subtle warm 100Hz/50Hz transformer hum
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 100;
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = 50;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;

    const gain = ctx.createGain();
    gain.gain.value = this.powered && this.enabled ? 0.008 : 0;

    osc.connect(lp);
    osc2.connect(lp);
    lp.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc2.start();
    this.humGain = gain;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ctx && this.humGain) {
      const now = this.ctx.currentTime;
      this.humGain.gain.cancelScheduledValues(now);
      this.humGain.gain.setTargetAtTime(on && this.powered ? 0.008 : 0, now, 0.04);
    }
    if (!on && this.ctx) {
      const now = this.ctx.currentTime;
      for (const v of this.sidVoices) {
        if (!v) continue;
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime(0, now, 0.02);
      }
    }
    if (this.ctx) {
      if (!on && this.ctx.state === 'running') {
        this.ctx.suspend().catch(() => {});
      } else if (on && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }
  }

  /** Pause/resume Web Audio when browser tab visibility changes to save CPU/battery. */
  setPageVisible(visible: boolean) {
    if (!this.ctx) return;
    if (!visible && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    } else if (visible && this.enabled && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  setPowered(on: boolean) {
    this.powered = on;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Mechanical power switch clunk
    this.playSwitchClick(ctx, now, on ? 1.0 : 0.85);

    if (on) {
      // Warm CRT degauss coil thump & brief tube bloom
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(58, now);
      osc.frequency.exponentialRampToValueAtTime(50, now + 0.55);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(240, now);
      lp.frequency.exponentialRampToValueAtTime(75, now + 0.55);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.11, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

      osc.connect(lp);
      lp.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.65);

      // Soft static crackle of high-voltage anode charging
      if (this.noiseBuf) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'bandpass';
        hp.frequency.value = 4200;
        hp.Q.value = 1.8;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.0001, now + 0.04);
        ng.gain.linearRampToValueAtTime(0.025, now + 0.08);
        ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
        src.connect(hp);
        hp.connect(ng);
        ng.connect(ctx.destination);
        src.start(now + 0.04);
      }

      if (this.humGain) {
        this.humGain.gain.setTargetAtTime(0.008, now + 0.25, 0.2);
      }
    } else {
      // Classic CRT high-voltage collapse chirp
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(6200, now);
      osc.frequency.exponentialRampToValueAtTime(1400, now + 0.14);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.018, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);

      if (this.humGain) {
        this.humGain.gain.setTargetAtTime(0, now, 0.04);
      }
      this.silenceSid();
    }
  }

  private playSwitchClick(ctx: AudioContext, now: number, pitch = 1.0) {
    if (!this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100 * pitch;
    bp.Q.value = 2.0;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);

    src.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.032);
  }

  /** Tactile C64 breadbin mechanical key clack. */
  playKey(key: string) {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuf) return;
    const now = ctx.currentTime;

    const isSpace = key === ' ';
    const isReturn = key === 'Enter';
    const jitter = 0.92 + Math.random() * 0.16;

    // Sharp top-out plastic click
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (isSpace ? 950 : isReturn ? 1250 : 1750) * jitter;
    bp.Q.value = 1.6;

    const g = ctx.createGain();
    g.gain.setValueAtTime(isReturn ? 0.065 : isSpace ? 0.055 : 0.042, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);

    src.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.022);

    // Subtle hollow breadbin plastic case resonance
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime((isSpace ? 150 : isReturn ? 185 : 240) * jitter, now);
    body.frequency.exponentialRampToValueAtTime(85, now + 0.025);

    const bg = ctx.createGain();
    bg.gain.setValueAtTime(isSpace ? 0.045 : 0.025, now);
    bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);

    body.connect(bg);
    bg.connect(ctx.destination);
    body.start(now);
    body.stop(now + 0.03);
  }

  playHatch(open: boolean) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.playSwitchClick(ctx, ctx.currentTime, open ? 1.35 : 0.9);
  }

  /** Soft paper page-turn brush sound for the cheat sheet. */
  playPageFlip() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuf) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1600, now);
    bp.frequency.exponentialRampToValueAtTime(3400, now + 0.09);
    bp.Q.value = 1.2;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.055, now + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

    src.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.14);
  }

  /** Snappy double-snap spring click of a 4-colour BIC ballpoint pen! */
  playBicClick() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuf) return;
    const now = ctx.currentTime;

    // 1. Old slider snaps back up (sharp high plastic tick)
    const snap = (t: number, freq: number, vol: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf!;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 3.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
      src.connect(bp);
      bp.connect(g);
      g.connect(ctx.destination);
      src.start(t);
      src.stop(t + 0.018);
    };

    snap(now, 3100, 0.11);        // old tab releases
    snap(now + 0.032, 2250, 0.14); // new tab locks down
  }

  /** Crisp vintage inline rocker-switch clack for the orange desk lamp. */
  playLampSwitch(on: boolean) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.playSwitchClick(ctx, ctx.currentTime, on ? 1.45 : 1.05);
  }

  /** Unlock Web Audio cleanly on first user interaction so ambient sounds (CRT hum & clock tick) start. */
  unlock() {
    this.ensureContext();
  }

  /** Soft authentic plastic-cased 1980s quartz bedroom wall-clock tick-tock. */
  playClockTick(second = 0, forceUnlock = false) {
    if (!this.enabled) return;
    if (forceUnlock) this.ensureContext();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.noiseBuf) return;

    const now = ctx.currentTime;
    const isTick = second % 2 === 0;

    // 1. Crisp escapement/stepper click
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = isTick ? 3300 : 2850;
    bp.Q.value = 3.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(isTick ? 0.024 : 0.020, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.011);
    src.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.014);

    // 2. Tiny hollow plastic-casing resonance thud
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(isTick ? 690 : 610, now);
    body.frequency.exponentialRampToValueAtTime(240, now + 0.014);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(isTick ? 0.014 : 0.011, now);
    bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);
    body.connect(bg);
    bg.connect(ctx.destination);
    body.start(now);
    body.stop(now + 0.018);
  }

  /** Mechanical 1541 floppy latch click + sleeve slide. */
  playFloppyLatch(inserted: boolean) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playSwitchClick(ctx, now, inserted ? 0.72 : 1.15);
    this.playSwitchClick(ctx, now + 0.06, inserted ? 1.2 : 0.85);
  }

  /** Classic Commodore 1541 floppy stepper-head chug & spindle whirr! */
  playDiskSeek(mode: 'read' | 'write' | 'error') {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuf) return;
    const now = ctx.currentTime;

    // Gentle spindle motor hum
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 62;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const hg = ctx.createGain();
    const dur = mode === 'error' ? 0.45 : 0.88;
    hg.gain.setValueAtTime(0.0001, now);
    hg.gain.linearRampToValueAtTime(0.028, now + 0.06);
    hg.gain.setValueAtTime(0.026, now + dur - 0.1);
    hg.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    hum.connect(lp);
    lp.connect(hg);
    hg.connect(ctx.destination);
    hum.start(now);
    hum.stop(now + dur + 0.02);

    // Stepper head track-step ticks (iconic 1541 tk-tk-tk-brrrt!)
    const ticks = mode === 'error'
      ? [0.02, 0.05, 0.08, 0.11, 0.14, 0.17, 0.20] // classic head bump rattle!
      : mode === 'write'
      ? [0.04, 0.10, 0.15, 0.26, 0.34, 0.41, 0.52, 0.60, 0.68]
      : [0.03, 0.09, 0.14, 0.22, 0.33, 0.42, 0.50, 0.62, 0.72, 0.78];

    for (let i = 0; i < ticks.length; i++) {
      const t = now + ticks[i];
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(mode === 'error' ? 110 : 145 + (i % 3) * 18, t);
      osc.frequency.exponentialRampToValueAtTime(75, t + 0.024);

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = mode === 'error' ? 420 : 620;
      bp.Q.value = 2.4;

      const g = ctx.createGain();
      g.gain.setValueAtTime(mode === 'error' ? 0.085 : 0.048, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.026);

      osc.connect(bp);
      bp.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.03);
    }
  }

  /** Silence all 3 SID voices cleanly (on reset, RUN/STOP, or mute). */
  silenceSid() {
    if (this.ctx) {
      const now = this.ctx.currentTime;
      for (const v of this.sidVoices) {
        if (!v) continue;
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime(0, now, 0.015);
      }
      if (this.sidEchoWet) {
        this.sidEchoWet.gain.cancelScheduledValues(now);
        this.sidEchoWet.gain.setTargetAtTime(0, now, 0.03);
      }
    }
    this.sidRegs[4] &= ~0x01;
    this.sidRegs[11] &= ~0x01;
    this.sidRegs[18] &= ~0x01;
  }

  private ensureSidBus(ctx: AudioContext): GainNode {
    if (!this.sidBus) {
      const bus = ctx.createGain();
      bus.gain.value = 1.0;
      bus.connect(ctx.destination);

      // Warm analog tape-echo send (classic 1984 nostalgic space + Day 22 Echo motif)
      const delay = ctx.createDelay(0.6);
      delay.delayTime.value = 0.27;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1450;
      const fb = ctx.createGain();
      fb.gain.value = 0.34;
      const wet = ctx.createGain();
      wet.gain.value = 0.28;

      bus.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(wet);
      wet.connect(ctx.destination);

      this.sidBus = bus;
      this.sidEchoWet = wet;

      // Programmable global MOS 6581 resonant filter ($D415-$D417, $D418 bits 4-6)
      const gf = ctx.createBiquadFilter();
      gf.type = 'lowpass';
      gf.frequency.value = 2400;
      gf.Q.value = 1.4;
      gf.connect(bus);
      this.sidGlobalFilter = gf;
    }
    return this.sidBus;
  }

  /** Build cached Fourier PeriodicWaves for 16 SID variable pulse-width duty cycles (6%..50%). */
  private getSidPulseWave(ctx: AudioContext, duty: number): PeriodicWave {
    if (!this.sidPulseWaves) {
      this.sidPulseWaves = [];
      const harmonics = 32;
      for (let b = 0; b < 16; b++) {
        const d = 0.06 + (b / 15) * 0.44;
        const real = new Float32Array(harmonics + 1);
        const imag = new Float32Array(harmonics + 1);
        for (let n = 1; n <= harmonics; n++) {
          // Exact Fourier pulse wave: (2 / (n*pi)) * sin(n*pi*d)
          imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * d);
        }
        this.sidPulseWaves.push(ctx.createPeriodicWave(real, imag));
      }
    }
    const sym = duty > 0.5 ? 1 - duty : duty;
    const bucket = Math.max(0, Math.min(15, Math.round(((sym - 0.06) / 0.44) * 15)));
    return this.sidPulseWaves[bucket];
  }

  private updateSidGlobalFilter(ctx: AudioContext) {
    this.ensureSidBus(ctx);
    const gf = this.sidGlobalFilter;
    if (!gf) return;
    const now = ctx.currentTime;
    const fc = (this.sidRegs[21] & 0x07) | (this.sidRegs[22] << 3); // 0..2047
    const hz = 40 * Math.pow(300, fc / 2047); // ~40 Hz .. 12 kHz exponential 6581 curve
    const res = (this.sidRegs[23] >> 4) & 0x0f;
    const modeBits = this.sidRegs[24] & 0x70;
    if (modeBits & 0x10) gf.type = 'lowpass';
    else if (modeBits & 0x20) gf.type = 'bandpass';
    else if (modeBits & 0x40) gf.type = 'highpass';
    else gf.type = 'lowpass';
    gf.frequency.setTargetAtTime(Math.max(40, Math.min(12000, hz)), now, 0.01);
    gf.Q.setTargetAtTime(0.7 + res * 0.75, now, 0.01);

    // Route voices according to $D417 bits 0..2
    const routing = this.sidRegs[23] & 0x07;
    for (let i = 0; i < 3; i++) {
      const v = this.sidVoices[i];
      if (!v || !this.sidBus) continue;
      const wantGlobal = (routing & (1 << i)) !== 0;
      if (wantGlobal !== v.routedToGlobalFilter) {
        v.gain.disconnect();
        v.gain.connect(wantGlobal ? gf : this.sidBus);
        v.routedToGlobalFilter = wantGlobal;
      }
    }
  }

  private ensureSidVoice(ctx: AudioContext, voiceIdx: number) {
    let v = this.sidVoices[voiceIdx];
    if (!v) {
      const bus = this.ensureSidBus(ctx);
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      // Warm MOS 6581 analog filter character (softer on bass/pads, clear on lead)
      filter.frequency.value = voiceIdx === 1 ? 1100 : 2200;
      filter.Q.value = 1.6;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const routed = ((this.sidRegs[23] & (1 << voiceIdx)) !== 0) && Boolean(this.sidGlobalFilter);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(routed && this.sidGlobalFilter ? this.sidGlobalFilter : bus);
      osc.start();
      v = { osc, filter, gain, routedToGlobalFilter: routed, lastPwBucket: -1 };
      this.sidVoices[voiceIdx] = v;
    }
    return v;
  }

  private triggerSidNoise(ctx: AudioContext, hz: number, peak: number, decaySec: number) {
    if (!this.noiseBuf) return;
    const bus = this.ensureSidBus(ctx);
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.max(350, Math.min(4200, hz * 1.1));
    bp.Q.value = 0.85;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, peak * 0.72), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.04, Math.min(0.26, decaySec)));
    src.connect(bp);
    bp.connect(g);
    g.connect(bus);
    src.start(now);
    src.stop(now + Math.max(0.05, Math.min(0.28, decaySec)) + 0.01);
  }

  /** 3-Voice MOS 6581 SID synthesizer for $D400..$D418 (54272..54296) with ADSR + noise percussion. */
  sidPoke(reg: number, val: number) {
    if (reg < 0 || reg >= 25) return;
    const prevReg = this.sidRegs[reg];
    this.sidRegs[reg] = val & 0xff;
    const ctx = this.ensureContext();
    if (!ctx || !this.powered) return;

    const now = ctx.currentTime;
    const vol = (this.sidRegs[24] & 0x0f) / 15;
    if (this.sidEchoWet && vol > 0) {
      this.sidEchoWet.gain.setTargetAtTime(0.28, now, 0.05);
    }

    // Global filter registers ($D415-$D417 / regs 21..23)
    if (reg >= 21 && reg <= 23) {
      this.updateSidGlobalFilter(ctx);
      return;
    }

    // Master volume & filter mode register ($D418 / reg 24)
    if (reg === 24) {
      this.updateSidGlobalFilter(ctx);
      for (let i = 0; i < 3; i++) {
        const base = i * 7;
        const ctrl = this.sidRegs[base + 4];
        const v = this.sidVoices[i];
        if (v && (ctrl & 0x01) && !(ctrl & 0x80)) {
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setTargetAtTime(vol * 0.11, now, 0.015);
        }
      }
      return;
    }

    // Voice registers: Voice 0 = 0..6, Voice 1 = 7..13, Voice 2 = 14..20
    const voiceIdx = Math.floor(reg / 7);
    const base = voiceIdx * 7;
    const localReg = reg - base;

    const freqWord = this.sidRegs[base] | (this.sidRegs[base + 1] << 8);
    const hz = Math.max(24, Math.min(8000, freqWord * 0.06097));
    const ctrl = this.sidRegs[base + 4];
    const gate = (ctrl & 0x01) !== 0;
    const isNoise = (ctrl & 0x80) !== 0;

    const voice = this.ensureSidVoice(ctx, voiceIdx);
    if (!isNoise) {
      if (ctrl & 0x40) {
        // Variable pulse width (12-bit $D402/$D403 -> Fourier PeriodicWave when PW != 0)
        const pw = this.sidRegs[base + 2] | ((this.sidRegs[base + 3] & 0x0f) << 8);
        if (pw > 0 && pw < 4095) {
          const duty = pw / 4096;
          const sym = duty > 0.5 ? 1 - duty : duty;
          const bucket = Math.max(0, Math.min(15, Math.round(((sym - 0.06) / 0.44) * 15)));
          if (voice.lastPwBucket !== bucket) {
            voice.osc.setPeriodicWave(this.getSidPulseWave(ctx, duty));
            voice.lastPwBucket = bucket;
          }
        } else if (voice.lastPwBucket !== -2) {
          voice.osc.type = 'square';
          voice.lastPwBucket = -2;
        }
      } else {
        voice.lastPwBucket = -1;
        if (ctrl & 0x20) voice.osc.type = 'sawtooth';
        else if (ctrl & 0x10) voice.osc.type = 'triangle';
        else voice.osc.type = 'square';
      }
      voice.osc.frequency.setTargetAtTime(hz, now, 0.003);
    }

    if (localReg === 4) {
      const prevGate = (prevReg & 0x01) !== 0;
      const ad = this.sidRegs[base + 5];
      const sr = this.sidRegs[base + 6];
      const attackNibble = (ad >> 4) & 0x0f;
      const decayNibble = ad & 0x0f;
      const sustainLevel = ((sr >> 4) & 0x0f) / 15;
      const releaseNibble = sr & 0x0f;
      const hasAdsr = ad !== 0 || sr !== 0;

      // Balanced 3-voice mix headroom so chords + bass + lead stay punchy without clipping
      const voiceScale = voiceIdx === 0 ? 0.11 : voiceIdx === 1 ? 0.10 : 0.075;
      const peak = vol * voiceScale;
      const attackSec = 0.005 + (attackNibble / 15) * 0.18;
      const decaySec = hasAdsr ? 0.045 + (decayNibble / 15) * 0.72 : 0.32;
      const sustainGain = hasAdsr ? peak * sustainLevel : peak * 0.8;
      const releaseSec = hasAdsr ? 0.035 + (releaseNibble / 15) * 0.5 : 0.045;

      voice.gain.gain.cancelScheduledValues(now);
      if (isNoise) {
        voice.gain.gain.setTargetAtTime(0, now, 0.005);
        if (gate && !prevGate && peak > 0.0005) {
          this.triggerSidNoise(ctx, hz, peak, decaySec);
        }
      } else if (gate && !prevGate) {
        voice.gain.gain.setValueAtTime(0.0001, now);
        voice.gain.gain.linearRampToValueAtTime(Math.max(0.0001, peak), now + attackSec);
        voice.gain.gain.exponentialRampToValueAtTime(
          Math.max(0.0001, sustainGain),
          now + attackSec + decaySec,
        );
        if (hasAdsr && sustainLevel === 0) {
          voice.gain.gain.setValueAtTime(0, now + attackSec + decaySec + 0.01);
        }
      } else if (!gate) {
        voice.gain.gain.setTargetAtTime(0, now, releaseSec * 0.3);
      }
    }
  }

  /** Crisp metallic ball-contact micro-switch clack for the Suncom TAC-2 joystick. */
  playJoystickClick(isFire = false) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isFire ? 920 : 540, now);
    osc.frequency.exponentialRampToValueAtTime(isFire ? 260 : 150, now + 0.028);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(isFire ? 0.095 : 0.075, now + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);

    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.036);

    if (this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = isFire ? 2900 : 1850;
      bp.Q.value = 2.4;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, now);
      ng.gain.linearRampToValueAtTime(isFire ? 0.065 : 0.05, now + 0.002);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(ctx.destination);
      src.start(now);
      src.stop(now + 0.026);
    }
  }

  /** Joyful 1984 Commodore 64 SID-style chiptune arpeggio fanfare when an Echo program succeeds! */
  playEchoFanfare() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Classic upbeat C64 major-9th celebration arpeggio (C5 - E5 - G5 - B5 - C6 - E6 - G6)
    const notes = [523.25, 659.25, 783.99, 987.77, 1046.5, 1318.51, 1567.98];
    notes.forEach((hz, i) => {
      const t = now + i * 0.072;
      const isFinal = i === notes.length - 1;
      const dur = isFinal ? 0.42 : 0.12;

      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'square' : 'triangle';
      osc.frequency.setValueAtTime(hz, t);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2800, t);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(isFinal ? 0.075 : 0.06, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(lp);
      lp.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    });
  }

  /** Crisp celebratory firework burst pop + delicate sparkle crackle. */
  playFireworkPop() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.noiseBuf) return;
    const now = ctx.currentTime;

    // Soft bass thump of the burst
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(140 + Math.random() * 45, now);
    thump.frequency.exponentialRampToValueAtTime(42, now + 0.14);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.08, now);
    tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    thump.connect(tg);
    tg.connect(ctx.destination);
    thump.start(now);
    thump.stop(now + 0.17);

    // Filtered crackle burst
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400 + Math.random() * 1400;
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.065, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.20);
  }
}
