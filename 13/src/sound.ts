/**
 * Subtle, tactile studio WebAudio engine:
 * - Soft muted steel-on-ABS wall clinks
 * - Quiet rolling resonance proportional to ball speed
 * - Clean minimalist Scandinavian harmonic chime on checkpoint LED activation
 */
export class LabyrinthSound {
  private ctx: AudioContext | null = null;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private enabled = true;
  private lastHitAt = 0;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.rollGain && this.ctx) {
      this.rollGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      this.ctx = ctx;

      // Continuous ultra-quiet filtered noise bed for rolling steel bearing on matte plastic
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = last * 0.88 + w * 0.12;
        data[i] = last;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 340;
      filter.Q.value = 2.6;

      const gain = ctx.createGain();
      gain.gain.value = 0;

      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start();

      this.rollFilter = filter;
      this.rollGain = gain;
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  updateRoll(speed: number) {
    if (!this.ctx || !this.rollGain || !this.rollFilter || !this.enabled || this.ctx.state !== 'running') return;
    const norm = Math.min(1, speed / 2.6);
    const targetGain = norm > 0.04 ? norm * norm * 0.032 : 0;
    const targetFreq = 220 + norm * 620;
    const now = this.ctx.currentTime;
    this.rollGain.gain.setTargetAtTime(targetGain, now, 0.04);
    this.rollFilter.frequency.setTargetAtTime(targetFreq, now, 0.05);
  }

  playWallHit(strength: number) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now - this.lastHitAt < 0.045) return;
    this.lastHitAt = now;

    // Crisp muted plastic + steel click (two short damped partials)
    const vol = 0.025 + strength * 0.095;
    const baseFreq = 920 + Math.random() * 220 + strength * 260;

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.58, now + 0.028);

    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(baseFreq * 2.42, now);
    osc2.frequency.exponentialRampToValueAtTime(baseFreq * 1.6, now + 0.018);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.038);

    const g2 = this.ctx.createGain();
    g2.gain.setValueAtTime(0.0001, now);
    g2.gain.linearRampToValueAtTime(vol * 0.45, now + 0.0015);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);

    osc.connect(g);
    osc2.connect(g2);
    g.connect(this.ctx.destination);
    g2.connect(this.ctx.destination);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + 0.045);
    osc2.stop(now + 0.028);
  }

  playCheckpoint(index: number, allCleared: boolean) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // Minimalist Scandinavian pentatonic chime notes (F4, G4, A4, C5, D5)
    const notes = [523.25, 587.33, 659.25, 783.99, 880.0];
    const freq = notes[index % notes.length];

    const playTone = (f: number, delay: number, dur: number, amp: number) => {
      if (!this.ctx) return;
      const t0 = now + delay;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t0);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    };

    playTone(freq, 0, 0.42, 0.085);
    playTone(freq * 2, 0.01, 0.24, 0.022);

    if (allCleared) {
      playTone(523.25, 0.14, 0.75, 0.055);
      playTone(659.25, 0.24, 0.75, 0.055);
      playTone(783.99, 0.34, 0.9, 0.06);
      playTone(1046.5, 0.46, 1.1, 0.05);
    }
  }

  /**
   * Subtle mechanical precision-actuator whirr & soft detent clicks when the sphere morphs between levels.
   */
  playMorph() {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // Soft pneumatic/servo glide sweep
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.38);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.78);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.028, now + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);

    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.88);

    // Delicate staggered mechanical detent ticks as blades lock into place
    const tickTimes = [0.06, 0.19, 0.34, 0.51, 0.66];
    for (let i = 0; i < tickTimes.length; i++) {
      const t0 = now + tickTimes[i];
      const tick = this.ctx.createOscillator();
      tick.type = 'triangle';
      const f = 760 + i * 75;
      tick.frequency.setValueAtTime(f, t0);
      tick.frequency.exponentialRampToValueAtTime(f * 0.65, t0 + 0.02);

      const tg = this.ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t0);
      tg.gain.linearRampToValueAtTime(0.018, t0 + 0.002);
      tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.024);

      tick.connect(tg);
      tg.connect(this.ctx.destination);
      tick.start(t0);
      tick.stop(t0 + 0.028);
    }
  }

  /** Hollow resonant steel clunk when dropping down through a diaphragm iris into the half-pipe below */
  playPortalDrop() {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(165, now + 0.16);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.085, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  /** Crisp upward mechanical pop when emerging back out of an open iris onto the upper track */
  playPortalEmerge() {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.12);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.065, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  }
}
