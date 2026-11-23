// Sounds, made on the spot with Web Audio (no files): a whoosh when you fling a pinch of spores, a soft puff where
// it lands and where you sow, and the creaks of fungi growing, a voice per kind. All noise, filtered: a band sweeping up and down for the
// whoosh, a muffled low burst with a little thump under it for the puff. Quieter further off and panned to where
// it happens. The browser lets sound start only after a tap or a key, so the context is made on the first one.
import * as THREE from 'three';

export class Sound {
  ctx: AudioContext | null = null; // read by the forest's sounds too
  private noise: AudioBuffer | null = null;
  out: GainNode | null = null;
  /** The mute: a gain after out, so the soundboard's master stays as it was. Remembered between visits. */
  muted = (() => { try { return localStorage.getItem('16-muted') === '1'; } catch { return false; } })();
  private hush: GainNode | null = null;
  send: AudioNode | null = null; // into the wood's reverb (forest.ts sets it), a little of each sound
  private v = new THREE.Vector3();

  constructor(private camera: THREE.Camera) {
    const wake = () => this.wake();
    addEventListener('pointerdown', wake, { capture: true });
    addEventListener('keydown', wake, { capture: true });
  }

  private wake() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    // two seconds of white noise, looped from a random place each time
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.out = ctx.createGain();
    this.out.gain.value = 0.7;
    this.hush = ctx.createGain();
    this.hush.gain.value = this.muted ? 0 : 1;
    this.out.connect(this.hush).connect(ctx.destination);
    this.ctx = ctx;
    this.noise = buf;
  }

  mute(on: boolean) {
    this.muted = on;
    try { localStorage.setItem('16-muted', on ? '1' : '0'); } catch { /* no storage */ }
    if (this.ctx && this.hush) this.hush.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  /** How loud and which side, for a sound at p: quieter with distance, panned by where it is from you. */
  private place(p?: THREE.Vector3) {
    if (!p) return { gain: 1, pan: 0 };
    const cam = this.camera;
    this.v.copy(p).sub(cam.position);
    const d = this.v.length();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const pan = THREE.MathUtils.clamp(this.v.normalize().dot(right), -1, 1) * 0.8;
    return { gain: 1 / (1 + d * 0.9), pan };
  }

  private source(ctx: AudioContext) {
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  /** A pinch flung: a breathy whoosh over the flight, rising then falling as it passes. */
  whoosh(dur: number) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.out) return;
    const t = ctx.currentTime, len = Math.min(1.2, Math.max(0.35, dur * 0.8));
    const s = this.source(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + len * 0.3);
    bp.frequency.exponentialRampToValueAtTime(700, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + len * 0.22);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(bp).connect(g).connect(this.out);
    if (this.send) g.connect(this.send);
    s.start(t, Math.random() * 1.5);
    s.stop(t + len + 0.05);
  }

  /** Spores landing on a puddle: a rising water-drop plip and a tiny splash, spatialised to p. */
  plop(p?: THREE.Vector3, size = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.out) return;
    const { gain, pan } = this.place(p);
    const t = ctx.currentTime, amp = gain * (0.55 + 0.45 * size);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.out);
    if (this.send) panner.connect(this.send);
    // primary Minnaert bubble chirp
    const osc = ctx.createOscillator(), og = ctx.createGain();
    const f0 = 560 + Math.random() * 360;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * (1.55 + Math.random() * 0.35), t + 0.034);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.22 * amp, t + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.042);
    osc.connect(og).connect(panner);
    osc.start(t); osc.stop(t + 0.05);
    // small scatter of secondary droplets
    for (let i = 0; i < (size > 0.6 ? 3 : 2); i++) {
      const dt = 0.025 + Math.random() * 0.09, o2 = ctx.createOscillator(), g2 = ctx.createGain();
      const f2 = 950 + Math.random() * 1100;
      o2.type = 'sine';
      o2.frequency.setValueAtTime(f2, t + dt);
      o2.frequency.exponentialRampToValueAtTime(f2 * 1.5, t + dt + 0.02);
      g2.gain.setValueAtTime(0.0001, t + dt);
      g2.gain.linearRampToValueAtTime((0.05 + Math.random() * 0.06) * amp, t + dt + 0.002);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.026);
      o2.connect(g2).connect(panner);
      o2.start(t + dt); o2.stop(t + dt + 0.032);
    }
    // brief splash hiss
    const s = this.source(ctx), bp = ctx.createBiquadFilter(), sg = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 1800 + Math.random() * 700; bp.Q.value = 1.1;
    const len = 0.08 + 0.07 * size;
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(0.16 * amp, t + 0.006);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(bp).connect(sg).connect(panner);
    s.start(t, Math.random() * 1.5); s.stop(t + len + 0.03);
  }

  /** A soft puff of spores at p (landing, sowing): `size` 0..1, a burst bigger than a sowing. */
  puff(p?: THREE.Vector3, size = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.out) return;
    const { gain, pan } = this.place(p);
    const t = ctx.currentTime, len = 0.22 + 0.25 * size;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.out);
    if (this.send) panner.connect(this.send);
    // the breath of it: noise, low-passed and closing down
    const s = this.source(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(1400 + 1200 * size, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * gain * (0.5 + 0.5 * size), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(lp).connect(g).connect(panner);
    s.start(t, Math.random() * 1.5);
    s.stop(t + len + 0.05);
    // a little thump under it
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110 + 40 * size, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.14);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.35 * gain * size, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(og).connect(panner);
    o.start(t);
    o.stop(t + 0.2);
  }

  /**
   * A fungus growing creaks the way a stalk does when it bends: stick-slip, a run of sharp little ticks, uneven
   * in spacing and strength, the gaps closing as the strain builds and opening as it lets go, each tick rung
   * through a couple of narrow bands, the body of the thing. Written sample by sample into a short buffer. Each kind
   * its own voice; a puffball a single soft pop, a morel a dry scatter of crackles, a slippery jack wetter.
   */
  creak(p: THREE.Vector3, kind: string) {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const { gain, pan } = this.place(p);
    if (gain < 0.25) return; // too far to hear
    const v = CREAK[kind] ?? CREAK.funnel;
    const sr = ctx.sampleRate, j = 0.7 + 0.6 * Math.random(); // never twice the same
    const len = v.len * (0.4 + 1.2 * Math.random());
    const n = Math.ceil(len * sr) + Math.ceil(0.03 * sr);
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    // the ticks: each a sharp edge decaying in a millisecond or two
    const tick = (at: number, amp: number) => {
      const i0 = Math.floor(at * sr), dec = v.decay * sr;
      for (let i = 0; i < dec * 5 && i0 + i < n; i++) d[i0 + i] += amp * Math.exp(-i / dec) * (i < 2 ? 1 : 0.6 + 0.8 * (Math.random() - 0.5));
    };
    if (v.scatter) {
      // a crackle or a pop: ticks at random in the span
      for (let k = 0; k < v.scatter; k++) tick(Math.random() * len, 0.4 + 0.6 * Math.random());
    } else {
      // stick-slip, and very uneven: the gap from rate to rateEnd and back a little, but each one drawn wide (a
      // log-normal spread), now and then the strain holds and there is a pause, now and then it slips twice at once
      let at = 0;
      while (at < len) {
        const u = at / len;
        const rate = v.rate * j * (u < 0.6 ? 1 + (v.rateEnd - 1) * (u / 0.6) : v.rateEnd + (1 - v.rateEnd) * 0.4 * ((u - 0.6) / 0.4));
        const swell = Math.sin(Math.PI * Math.min(1, u * 1.15)); // grows, then fades
        const amp = Math.pow(Math.random(), 1.8) * (0.25 + 0.75 * swell) * (Math.random() < 0.12 ? 2.2 : 1); // a harder catch now and then
        tick(at, amp);
        if (Math.random() < 0.18) tick(at + (0.002 + 0.006 * Math.random()), amp * (0.4 + 0.6 * Math.random())); // a double
        const gauss = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(Math.PI * 2 * Math.random());
        let gap = (1 / rate) * Math.exp(gauss * 0.7);
        if (Math.random() < 0.14) gap *= 2.5 + 4 * Math.random(); // it holds
        at += gap;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    const g = ctx.createGain();
    g.gain.value = v.vol * gain;
    g.connect(panner).connect(this.out);
    if (this.send) panner.connect(this.send);
    // the body: two resonances, the second higher and weaker; and a little of the dry tick itself
    for (const [f, q, w] of [[v.band * j, v.q, 1], [v.band * j * v.band2, v.q * 0.8, 0.5]] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const bg = ctx.createGain();
      bg.gain.value = w * (v.q / 4);
      src.connect(bp).connect(bg).connect(g);
    }
    const dry = ctx.createGain();
    dry.gain.value = v.dry;
    src.connect(dry).connect(g);
    src.start(ctx.currentTime);
  }
}

interface CreakVoice { rate: number; rateEnd: number; band: number; band2: number; q: number; len: number; vol: number; decay: number; dry: number; scatter?: number }
// a voice per kind (slower and much lower than at first, which crackled like static rather than creaked): ticks a second at the start and how far that closes up; the band that rings, a second one (times
// the first), how narrow; how long, how loud; how fast a tick dies (seconds); how much of the bare tick; or a
// scatter of so many ticks at random instead of stick-slip
const CREAK: Record<string, CreakVoice> = {
  funnel: { rate: 35, rateEnd: 1.8, band: 440, band2: 2.3, q: 9, len: 0.374, vol: 0.5, decay: 0.00144, dry: 0.15 }, // a thin creak
  finger: { rate: 60, rateEnd: 1.5, band: 1040, band2: 1.9, q: 6, len: 0.153, vol: 0.4, decay: 0.0009, dry: 0.2 }, // tiny ticks
  chanterelle: { rate: 22.5, rateEnd: 2.0, band: 280, band2: 2.1, q: 8, len: 0.51, vol: 0.55, decay: 0.0018, dry: 0.12 }, // a soft creak
  puffball: { rate: 0, rateEnd: 1, band: 168, band2: 2.6, q: 3, len: 0.065, vol: 0.9, decay: 0.0072, dry: 0.4, scatter: 1 }, // a pop
  agaric: { rate: 16, rateEnd: 2.2, band: 192, band2: 2.4, q: 10, len: 0.68, vol: 0.6, decay: 0.00252, dry: 0.1 }, // a deep creak
  porcini: { rate: 12, rateEnd: 2.4, band: 136, band2: 2.7, q: 11, len: 0.765, vol: 0.65, decay: 0.00324, dry: 0.12 }, // woody
  slippery: { rate: 19, rateEnd: 1.6, band: 248, band2: 1.7, q: 4, len: 0.34, vol: 0.55, decay: 0.0054, dry: 0.3 }, // wet, soft-edged
  morel: { rate: 0, rateEnd: 1, band: 1200, band2: 1.6, q: 3, len: 0.325, vol: 0.55, decay: 0.00072, dry: 0.5, scatter: 14 }, // dry crackle
  waxcap: { rate: 42.5, rateEnd: 1.7, band: 600, band2: 2.2, q: 8, len: 0.255, vol: 0.45, decay: 0.00126, dry: 0.15 }, // a high creak
};
