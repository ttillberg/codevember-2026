// Sounds, made on the spot with Web Audio (no files): a whoosh when you fling a pinch of spores, a soft puff where
// it lands, where you sow, and out of a pressed puffball. All noise, filtered: a band sweeping up and down for the
// whoosh, a muffled low burst with a little thump under it for the puff. Quieter further off and panned to where
// it happens. The browser lets sound start only after a tap or a key, so the context is made on the first one.
import * as THREE from 'three';

export class Sound {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private out: GainNode | null = null;
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
    this.out.connect(ctx.destination);
    this.ctx = ctx;
    this.noise = buf;
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
    s.start(t, Math.random() * 1.5);
    s.stop(t + len + 0.05);
  }

  /** A soft puff of spores at p (landing, sowing, a pressed puffball): `size` 0..1, a burst bigger than a sowing. */
  puff(p?: THREE.Vector3, size = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.out) return;
    const { gain, pan } = this.place(p);
    const t = ctx.currentTime, len = 0.22 + 0.25 * size;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.out);
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
}
