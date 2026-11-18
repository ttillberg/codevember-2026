// The sound: one small struck voice per joint, low for the first and higher down the chain,
// made of plain nodes (a sine with a falling pitch, one partial over it, a click of noise).
// Tick (crossing to the right) is the voice's note, tock (to the left) a fourth under it.
// Hits are given in performance time and started on the audio clock, so the rhythm is as
// tight as the formula, whatever the frame rate does.

interface Voice {
  /** hertz, the tick */
  f: number;
  /** the tock, a factor on f */
  tock: number;
  /** the pitch starts this many times higher and falls to f in `sweep` seconds */
  drop: number;
  sweep: number;
  /** seconds to die */
  dur: number;
  /** the partial over it: its ratio and level */
  ratio: number;
  bright: number;
  click: number;
  gain: number;
}

const VOICES: Voice[] = [
  { f: 55, tock: 0.84, drop: 3.2, sweep: 0.05, dur: 0.34, ratio: 2, bright: 0.18, click: 0.25, gain: 1 },
  { f: 147, tock: 0.75, drop: 1.6, sweep: 0.03, dur: 0.2, ratio: 2.4, bright: 0.2, click: 0.2, gain: 0.7 },
  { f: 330, tock: 0.75, drop: 1.08, sweep: 0.01, dur: 0.1, ratio: 2.76, bright: 0.35, click: 0.3, gain: 0.5 },
  { f: 494, tock: 0.75, drop: 1.06, sweep: 0.01, dur: 0.08, ratio: 2.76, bright: 0.35, click: 0.3, gain: 0.42 },
  { f: 740, tock: 0.75, drop: 1.05, sweep: 0.008, dur: 0.06, ratio: 2.76, bright: 0.4, click: 0.35, gain: 0.36 },
  { f: 988, tock: 0.75, drop: 1.04, sweep: 0.008, dur: 0.05, ratio: 2.76, bright: 0.4, click: 0.35, gain: 0.3 },
  { f: 1480, tock: 0.75, drop: 1.03, sweep: 0.006, dur: 0.04, ratio: 2.76, bright: 0.4, click: 0.4, gain: 0.26 },
  { f: 1976, tock: 0.75, drop: 1.03, sweep: 0.006, dur: 0.035, ratio: 2.76, bright: 0.4, click: 0.4, gain: 0.22 },
];

/** a short room: noise dying, a little darker as it goes */
function room(ac: AudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      lp += (Math.random() * 2 - 1 - lp) * (0.9 - 0.7 * t);
      d[i] = lp * Math.pow(1 - t, 3);
    }
  }
  return buf;
}

export class Sound {
  readonly ac: AudioContext;
  private bus: GainNode;
  private out: GainNode;
  private noise: AudioBuffer;
  /** context time minus performance time, for what is heard now */
  private off = NaN;
  /** seconds between a sound being started and being heard */
  latency = 0;
  private level = 0.8;
  /** for the dev console: how many hits, and how late the latest one had to start (seconds, 0 is on time) */
  stats = { hits: 0, late: 0, lead: 0 };

  constructor() {
    const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = (this.ac = new AC({ latencyHint: 'interactive' }));
    this.bus = ac.createGain();
    const conv = ac.createConvolver();
    conv.buffer = room(ac, 0.7);
    const wet = ac.createGain();
    wet.gain.value = 0.14;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    this.out = ac.createGain();
    this.out.gain.value = this.level;
    this.bus.connect(comp);
    this.bus.connect(conv).connect(wet).connect(comp);
    comp.connect(this.out).connect(ac.destination);

    this.noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.05), ac.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  get running() {
    return this.ac.state === 'running';
  }

  set muted(m: boolean) {
    this.out.gain.setTargetAtTime(m ? 0 : this.level, this.ac.currentTime, 0.015);
  }

  /** Line the two clocks up. Once per scheduler tick: smoothed, so a jittery reading does not move the beat. */
  sync() {
    const ac = this.ac;
    const ts = ac.getOutputTimestamp?.();
    const latency = (ac.baseLatency || 0) + ((ac as unknown as { outputLatency?: number }).outputLatency || 0);
    const o =
      ts && ts.performanceTime && ts.contextTime
        ? ts.contextTime - ts.performanceTime / 1000
        : ac.currentTime - performance.now() / 1000 - latency;
    if (!Number.isFinite(this.off) || Math.abs(o - this.off) > 0.03) this.off = o;
    else this.off += (o - this.off) * 0.05;
    this.latency = Math.max(0, ac.currentTime - (performance.now() / 1000 + this.off));
  }

  /** joint k crosses at performance time t (seconds), going dir, as hard as vel (0..1), its voice at vol (0..1) */
  hit(k: number, dir: number, vel: number, t: number, vol = 1) {
    const ac = this.ac;
    if (!this.running || !Number.isFinite(this.off) || !(vol > 0)) return;
    const when = Math.max(ac.currentTime + 0.002, t + this.off);
    this.stats = { hits: this.stats.hits + 1, late: when - (t + this.off), lead: when - ac.currentTime };
    const v = VOICES[Math.min(k, VOICES.length - 1)];
    const f = v.f * (dir > 0 ? 1 : v.tock);
    const level = v.gain * vol * vol * (0.18 + 0.82 * Math.pow(vel, 1.6));

    const pan = ac.createStereoPanner();
    pan.pan.value = dir * (k ? 0.25 : 0.08);
    pan.connect(this.bus);

    const strike = (freq: number, from: number, amp: number, dur: number) => {
      const o = ac.createOscillator();
      o.frequency.setValueAtTime(freq * from, when);
      o.frequency.exponentialRampToValueAtTime(freq, when + v.sweep);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(amp, when + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(g).connect(pan);
      o.start(when);
      o.stop(when + dur + 0.02);
    };
    strike(f, v.drop, level, v.dur);
    // harder is brighter, not only louder
    strike(f * v.ratio, 1, level * v.bright * (0.3 + 0.7 * vel), v.dur * 0.5);

    const n = ac.createBufferSource();
    n.buffer = this.noise;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800 + 500 * k;
    const g = ac.createGain();
    g.gain.setValueAtTime(level * v.click * vel, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.014);
    n.connect(hp).connect(g).connect(pan);
    n.start(when);
    n.stop(when + 0.03);
  }
}
