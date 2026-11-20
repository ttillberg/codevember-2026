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

  /** A foot on a ball. */
  kick() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.09, 'lowpass', 900, 120, 0.8, 0.9);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    g.gain.setValueAtTime(0.8, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.out!); o.start(t); o.stop(t + 0.2);
  }

  /** The ball goes through the pane. */
  smash(delay: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    this.burst(t, 0.2, 'lowpass', 500, 80, 0.7, 1.0);
    this.burst(t, 0.12, 'bandpass', 5200, 3000, 0.8, 1.1);
    this.burst(t + 0.01, 0.9, 'highpass', 4000, 7000, 0.6, 0.4);
    for (let i = 0; i < 30; i++) this.ping(t + Math.random() * Math.random() * 0.6, 2200 + Math.random() * 6500, 0.04 + Math.random() * 0.16, 0.06);
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

/** One contact from the simulation, as a sound. Every shard is about the same note: a large one is
   *  louder, a little longer and heavier; the harder they meet, the louder. Glass on glass is a clean ping, glass on the floor has grit in it.
   *  pan is where it happened, left to right; rate < 1 in slow motion. */
  clink(size: number, strength: number, kind: number, pan: number, rate = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + Math.random() * 0.012;
    const r = Math.min(0.2, Math.sqrt(size)); // metres across, roughly
    // glass is glass at any size: the pitch moves by a few notes only, never down into a bell. What a large
    // piece has more of is weight: it is louder, a touch longer, and has a dull clack under it
    const f = (5200 / (1 + r * 2.6)) * (0.75 + Math.random() * 0.5) * (0.45 + 0.55 * rate);
    const g = Math.min(0.3, (0.012 + strength * 0.022) * (0.45 + r * 9));
    const dur = (0.03 + r * 0.25) * (kind === 1 ? 1.25 : 1) / rate;
    const out = ctx.createStereoPanner();
    out.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(this.out!);
    // three partials that are not in tune with each other, each a little different every time: a chink, not a note
    for (const [mul, vol] of [[1, 1], [1.5 + Math.random() * 0.45, 0.6], [2.4 + Math.random() * 0.8, 0.35]]) {
      const o = ctx.createOscillator(), e = ctx.createGain();
      o.frequency.value = Math.min(16000, f * mul);
      e.gain.setValueAtTime(g * vol, t); e.gain.exponentialRampToValueAtTime(0.0001, t + dur / mul);
      o.connect(e).connect(out);
      o.start(t); o.stop(t + dur + 0.02);
    }
    if (r > 0.04) {
      const src = ctx.createBufferSource(), filt = ctx.createBiquadFilter(), e = ctx.createGain();
      src.buffer = this.noise; src.playbackRate.value = rate;
      filt.type = 'lowpass'; filt.frequency.value = 1400; filt.Q.value = 0.6;
      e.gain.setValueAtTime(g * (r - 0.04) * 22, t); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.035 / rate);
      src.connect(filt).connect(e).connect(out);
      src.start(t, Math.random() * 1.5); src.stop(t + 0.05 / rate);
    }
    if (kind !== 1) {
      // the floor: a short scrape of noise under the ring
      const src = ctx.createBufferSource(), filt = ctx.createBiquadFilter(), e = ctx.createGain();
      src.buffer = this.noise; src.playbackRate.value = rate;
      filt.type = 'bandpass'; filt.frequency.value = Math.min(12000, f * 0.7); filt.Q.value = 1.2;
      e.gain.setValueAtTime(g * 1.6, t); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.04 / rate);
      src.connect(filt).connect(e).connect(out);
      src.start(t, Math.random() * 1.5); src.stop(t + 0.06 / rate);
    }
  }
}
