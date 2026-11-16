// Paper sounds, made up on the spot: a snap when a border pops through, a pop when
// the piece comes free. Nothing until the first touch.

let ctx: AudioContext | null = null;
let noise: AudioBuffer;

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new AudioContext();
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function burst(dur: number, freq: number, q: number, level: number, at = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t, Math.random() * 0.5, dur + 0.02);
}

// a border pops through: a crisp snap of card, a little higher each time (k: 0..1 of the way)
export function snap(k: number) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  const f = 420 + 380 * k + Math.random() * 30;
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.06);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.1);
  burst(0.025, 3600 + 1200 * k, 2, 0.45);
  navigator.vibrate?.(8);
}

export function pop() {
  if (!ctx) return;
  const t = ctx.currentTime;
  // a dull thump, card snapping out of its frame
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(260, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.2);
  burst(0.06, 1800, 1.2, 0.5);
  burst(0.25, 900, 0.7, 0.18, 0.12); // the frame sliding off
  navigator.vibrate?.([12, 40, 18]);
}

// a panel folds home: a soft crease, card on card
export function crease(big = false) {
  if (!ctx) return;
  burst(0.05, 1400, 0.8, big ? 0.5 : 0.32);
  burst(0.018, 5200, 3, 0.25, 0.012);
  navigator.vibrate?.(big ? 14 : 6);
}

// the piece turns over: air, then it lands
export function flip() {
  if (!ctx) return;
  burst(0.35, 700, 0.5, 0.12);
}

// a panel still held by the sheet: card straining against card
export function strain() {
  burst(0.09, 520, 1.6, 0.3);
  burst(0.04, 2400, 4, 0.12, 0.03);
  navigator.vibrate?.([4, 30, 4]);
}

// coming down after a flip
export function land() {
  burst(0.08, 500, 0.9, 0.42);
  navigator.vibrate?.(10);
}
