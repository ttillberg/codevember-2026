// Every sound is made here, from noise and a few sines: the shot, the crack of the glass, the ticks of a
// crack that creeps on, and the fall, one grain of glass on concrete at a time.
export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** Call from a press: browsers only start audio on a gesture. */
  wake() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.8;
    this.out.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }

  private burst(at: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, gain: number, rate = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true; src.playbackRate.value = rate;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, at); filt.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filt).connect(g).connect(this.out!);
    src.start(at, Math.random() * 1.5); src.stop(at + dur + 0.02);
  }

  private ping(at: number, freq: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.setValueAtTime(freq, at);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.out!);
    o.start(at); o.stop(at + dur + 0.02);
  }

  shot() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.32, 'lowpass', 5200, 160, 0.7, 1.1);
    this.burst(t, 0.9, 'lowpass', 700, 90, 0.5, 0.35); // the room
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.out!); o.start(t); o.stop(t + 0.25);
    // the glass, a few milliseconds behind the shot
    this.burst(t + 0.012, 0.07, 'bandpass', 6200, 3800, 1.2, 0.9);
    this.burst(t + 0.02, 0.22, 'highpass', 5000, 7500, 0.7, 0.22);
    for (let i = 0; i < 5; i++) this.ping(t + 0.015 + Math.random() * 0.08, 2600 + Math.random() * 5200, 0.05 + Math.random() * 0.1, 0.07);
  }

  /** A crack gives a little more. */
  tick(delay: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + Math.max(0, delay);
    this.burst(t, 0.018, 'bandpass', 4500 + Math.random() * 3000, 3000, 2, 0.28);
    this.ping(t, 3000 + Math.random() * 4000, 0.04, 0.03);
  }

  /** The pane as it goes: a long tearing crackle. */
  give(delay: number, dur: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    this.burst(t, dur, 'bandpass', 3200, 5200, 0.9, 0.5);
    for (let i = 0; i < 22; i++) this.tick(delay + Math.random() * dur);
  }

  /** Glass meets the floor. strength is roughly how many shards did during one frame; rate < 1 in slow motion. */
  tinkle(strength: number, rate = 1) {
    if (!this.ctx || strength <= 0.01) return;
    const t = this.ctx.currentTime;
    const n = Math.min(5, Math.ceil(strength * 1.5));
    const g = Math.min(0.2, 0.035 + strength * 0.03);
    for (let i = 0; i < n; i++) {
      const at = t + Math.random() * 0.016;
      this.ping(at, (2200 + Math.random() * Math.random() * 7000) * (0.4 + 0.6 * rate), (0.03 + Math.random() * 0.14) / rate, g);
    }
    this.burst(t, 0.05 / rate, 'bandpass', (3500 + Math.random() * 3000) * rate, 2500 * rate, 1.1, Math.min(0.5, 0.06 + strength * 0.07), rate);
  }
}
