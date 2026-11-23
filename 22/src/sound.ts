// Procedural Web Audio for the Commodore 1702 monitor & C64 keystrokes + basic SID Voice 1.

export class MonitorSound {
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private humGain: GainNode | null = null;
  private sidOsc: OscillatorNode | null = null;
  private sidGain: GainNode | null = null;
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
      this.humGain.gain.setTargetAtTime(on && this.powered ? 0.008 : 0, now, 0.06);
    }
    if (!on && this.sidGain && this.ctx) {
      this.sidGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
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
      if (this.sidGain) {
        this.sidGain.gain.setTargetAtTime(0, now, 0.02);
      }
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

  silenceSid() {
    if (this.sidGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.sidGain.gain.cancelScheduledValues(now);
      this.sidGain.gain.setTargetAtTime(0, now, 0.02);
    }
    this.sidRegs[4] &= ~0x01;
  }

  /** SID Voice 1 synthesizer for POKE 54272..54296 with authentic ADSR decay. */
  sidPoke(reg: number, val: number) {
    if (reg < 0 || reg >= 25) return;
    const prevCtrl = this.sidRegs[4];
    this.sidRegs[reg] = val & 0xff;
    const ctx = this.ensureContext();
    if (!ctx || !this.powered) return;

    const vol = (this.sidRegs[24] & 0x0f) / 15;
    const freqWord = this.sidRegs[0] | (this.sidRegs[1] << 8);
    const hz = Math.max(20, Math.min(8000, freqWord * 0.06097));
    const ctrl = this.sidRegs[4];
    const gate = (ctrl & 0x01) !== 0;
    const prevGate = (prevCtrl & 0x01) !== 0;

    if (!this.sidOsc || !this.sidGain) {
      this.sidOsc = ctx.createOscillator();
      this.sidGain = ctx.createGain();
      this.sidGain.gain.value = 0;
      this.sidOsc.connect(this.sidGain);
      this.sidGain.connect(ctx.destination);
      this.sidOsc.start();
    }

    if (ctrl & 0x40) this.sidOsc.type = 'square';
    else if (ctrl & 0x20) this.sidOsc.type = 'sawtooth';
    else if (ctrl & 0x10) this.sidOsc.type = 'triangle';
    else this.sidOsc.type = 'square';

    const now = ctx.currentTime;
    this.sidOsc.frequency.setTargetAtTime(hz, now, 0.004);

    if (reg === 4) {
      const ad = this.sidRegs[5];
      const sr = this.sidRegs[6];
      const decayNibble = ad & 0x0f;
      const sustainLevel = ((sr >> 4) & 0x0f) / 15;
      const releaseNibble = sr & 0x0f;
      const hasAdsr = ad !== 0 || sr !== 0;

      const peak = vol * 0.16;
      const decaySec = hasAdsr ? 0.06 + (decayNibble / 15) * 0.85 : 0.35;
      const sustainGain = hasAdsr ? peak * sustainLevel : peak * 0.85;
      const releaseSec = hasAdsr ? 0.04 + (releaseNibble / 15) * 0.6 : 0.05;

      this.sidGain.gain.cancelScheduledValues(now);
      if (gate && !prevGate) {
        // Fresh note trigger with SID Attack -> Decay -> Sustain envelope
        this.sidGain.gain.setValueAtTime(0.0001, now);
        this.sidGain.gain.linearRampToValueAtTime(Math.max(0.0001, peak), now + 0.01);
        this.sidGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustainGain), now + 0.01 + decaySec);
        if (hasAdsr && sustainLevel === 0) {
          this.sidGain.gain.setValueAtTime(0, now + 0.02 + decaySec);
        }
      } else if (!gate) {
        this.sidGain.gain.setTargetAtTime(0, now, releaseSec * 0.35);
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
