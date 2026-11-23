// The wood's own sounds, made on the spot with Web Audio like the rest (no files): a bed of wind in the spruces,
// in stereo, breathing in gusts, and birds of a northern spruce wood on an autumn evening, each calling from a
// place of its own round you, placed in 3D (HRTF) so they stay where they are as you turn your head, the far ones
// duller (the air takes the highs first) as well as quieter.
//
// Robin (rödhake), the autumn singer: a thin, wistful warble of slides and trills. Wren (gärdsmyg): loud and fast,
// a trill in the middle. Goldcrest (kungsfågel): a few very high thin zii's, close, up in the spruce. Great tit
// (talgoxe): ti-ta ti-ta. Blackbird (koltrast): the dusk alarm, a run of chinks. Tawny owl (kattuggla): the
// male's long hoot, a pause, then the tremulous one; or the female's ke-wick. Great spotted woodpecker (större hackspett): a sharp kik, or a drum
// roll on a dead trunk. And, out of season, the cuckoo (gök) far off, and the nightingale (näktergal).
//
// Now and then a branch cracks off in the wood, loud, ringing through it. And the ground close round you: dry crackles in the needles and leaves, a rustle, now and then a twig snapping,
// as if something small were moving about; more often than the birds, and near.
//
// Each bird a few oscillators with frequency and gain envelopes, scheduled at a start time, so they can be
// rendered offline too.
import * as THREE from 'three';

type Dst = AudioNode;
type Bird = (ctx: BaseAudioContext, dst: Dst, t: number, noise: AudioBuffer) => void;
const R = Math.random;
const rr = (a: number, b: number) => a + (b - a) * R();

interface ToneOpts { type?: OscillatorType; attack?: number; vib?: number; vibRate?: number; harm?: number; trem?: number; tremRate?: number; lin?: boolean }
/** One note: a frequency gliding from f0 to f1 over dur, a quick swell and a fall, a vibrato, a second harmonic. */
function tone(ctx: BaseAudioContext, dst: Dst, t: number, dur: number, f0: number, f1: number, amp: number, o: ToneOpts = {}) {
  const g = ctx.createGain();
  const a = Math.min(o.attack ?? 0.012, dur * 0.4);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(amp, t + a);
  g.gain.setValueAtTime(amp, t + Math.max(a, dur * 0.6));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(dst);
  const voices: [number, number][] = [[1, 1]];
  if (o.harm) voices.push([2, o.harm]);
  for (const [k, w] of voices) {
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(f0 * k, t);
    if (o.lin) osc.frequency.linearRampToValueAtTime(f1 * k, t + dur);
    else osc.frequency.exponentialRampToValueAtTime(f1 * k, t + dur);
    if (o.vib) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = o.vibRate ?? 30;
      lg.gain.value = o.vib * k;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t); lfo.stop(t + dur + 0.02);
    }
    let out: AudioNode = osc;
    if (w !== 1) { const wg = ctx.createGain(); wg.gain.value = w; out = osc.connect(wg); }
    if (o.trem) {
      // amplitude flutter: the gain itself wobbled
      const tg = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      tg.gain.value = 1 - o.trem;
      lfo.frequency.value = o.tremRate ?? 20;
      lg.gain.value = o.trem;
      lfo.connect(lg).connect(tg.gain);
      lfo.start(t); lfo.stop(t + dur + 0.02);
      out = out.connect(tg);
    }
    out.connect(g);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
}
/** A burst of noise through a band: knocks, rasps. */
function rasp(ctx: BaseAudioContext, dst: Dst, t: number, dur: number, f: number, q: number, amp: number, noise: AudioBuffer, attack = 0.003) {
  const s = ctx.createBufferSource();
  s.buffer = noise; s.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(amp, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(bp).connect(g).connect(dst);
  s.start(t, R() * 1.5); s.stop(t + dur + 0.02);
}

const robin: Bird = (ctx, dst, t) => {
  // a phrase of slides and trills, high and thin, wandering down more than up, the notes a little apart
  const n = 7 + Math.floor(R() * 8);
  let f = rr(4200, 6800);
  for (let i = 0; i < n; i++) {
    const kind = R();
    if (kind < 0.22) {
      const d = rr(0.12, 0.26);
      tone(ctx, dst, t, d, f, f * rr(0.8, 1.1), rr(0.18, 0.32), { vib: rr(300, 700), vibRate: rr(40, 70) });
      t += d;
    } else if (kind < 0.35) {
      for (let k = 0; k < 3 + Math.floor(R() * 3); k++) { tone(ctx, dst, t, 0.025, f * 1.15, f, 0.25); t += 0.04; }
    } else {
      const d = rr(0.05, 0.16);
      tone(ctx, dst, t, d, f, f * rr(0.65, 1.35), rr(0.2, 0.42), { harm: 0.08 });
      t += d;
    }
    t += rr(0.02, 0.09);
    f = THREE.MathUtils.clamp(f * rr(0.8, 1.2), 2600, 7800);
  }
};

const wren: Bird = (ctx, dst, t) => {
  // loud and fast: a run of sharp notes, a trill, another run
  const run = (k: number) => {
    for (let i = 0; i < k; i++) {
      const f = rr(4200, 8000), d = rr(0.035, 0.06);
      tone(ctx, dst, t, d, f, f * rr(0.75, 1.2), rr(0.35, 0.55), { harm: 0.1, attack: 0.004 });
      t += d + 0.012;
    }
  };
  run(8 + Math.floor(R() * 6));
  const tf = rr(4500, 6000);
  for (let i = 0; i < 14 + Math.floor(R() * 10); i++) { tone(ctx, dst, t, 0.018, tf * 1.1, tf * 0.9, 0.45, { attack: 0.003 }); t += 0.026; }
  run(5 + Math.floor(R() * 5));
};

const goldcrest: Bird = (ctx, dst, t) => {
  // very high and thin: zii zii zii
  const f = rr(7200, 8400);
  for (let i = 0; i < 3 + Math.floor(R() * 3); i++) { tone(ctx, dst, t, rr(0.07, 0.1), f, f * 0.95, 0.22, { attack: 0.01 }); t += rr(0.11, 0.15); }
};

const greatTit: Bird = (ctx, dst, t) => {
  // ti-ta ti-ta ti-ta: a high note and a lower one, over and over
  const hi = rr(5200, 6200), lo = hi * rr(0.6, 0.7);
  for (let i = 0; i < 3 + Math.floor(R() * 4); i++) {
    tone(ctx, dst, t, 0.09, hi, hi * 0.96, 0.38, { harm: 0.08 });
    tone(ctx, dst, t + 0.12, 0.11, lo, lo * 0.94, 0.4, { harm: 0.08 });
    t += 0.33;
  }
};

const blackbird: Bird = (ctx, dst, t) => {
  // the dusk alarm: chink chink chink, quickening
  let gap = 0.22;
  for (let i = 0; i < 4 + Math.floor(R() * 7); i++) {
    const f = rr(2700, 3100);
    tone(ctx, dst, t, 0.035, f * 1.05, f * 0.92, 0.5, { harm: 0.45, attack: 0.002 });
    tone(ctx, dst, t, 0.03, f * 2.2, f * 2.0, 0.12, { attack: 0.002 });
    t += gap;
    gap = Math.max(0.11, gap * 0.92);
  }
};

/**
 * One hoot of a tawny owl: a soft, breathy, round note that slides up into its pitch, holds, and sags at the end;
 * `quaver` the wavering of the long last one, coming on as it goes (a slow, deep wobble of pitch and loudness).
 */
function hoot(ctx: BaseAudioContext, dst: Dst, t: number, dur: number, f: number, amp: number, noise: AudioBuffer, quaver = 0) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(amp, t + Math.min(0.09, dur * 0.3));
  g.gain.setValueAtTime(amp, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  // softened: no edge to it
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = f * 3.2; lp.Q.value = 0.5;
  g.connect(lp).connect(dst);
  let wob: GainNode | null = null;
  if (quaver) {
    // the waver: a slow wobble that comes on over the note, in pitch and in loudness both
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(rr(8, 10), t);
    lfo.frequency.linearRampToValueAtTime(rr(10, 12.5), t + dur);
    wob = ctx.createGain();
    wob.gain.setValueAtTime(0, t);
    wob.gain.linearRampToValueAtTime(f * 0.045 * quaver, t + dur * 0.5);
    lfo.connect(wob);
    const am = ctx.createGain(), amd = ctx.createGain();
    am.gain.value = 1;
    amd.gain.setValueAtTime(0, t);
    amd.gain.linearRampToValueAtTime(0.35 * quaver, t + dur * 0.5);
    lfo.connect(amd).connect(am.gain);
    lp.disconnect(); g.disconnect();
    g.connect(am).connect(lp).connect(dst);
    lfo.start(t); lfo.stop(t + dur + 0.05);
  }
  for (const [k, w] of [[1, 1], [2, 0.07], [3, 0.025]]) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 0.9 * k, t);
    o.frequency.linearRampToValueAtTime(f * k, t + Math.min(0.14, dur * 0.3));
    o.frequency.linearRampToValueAtTime(f * 0.97 * k, t + dur * 0.75);
    o.frequency.linearRampToValueAtTime(f * (quaver ? 0.86 : 0.9) * k, t + dur);
    if (wob) { const wk = ctx.createGain(); wk.gain.value = k; wob.connect(wk).connect(o.frequency); }
    const og = ctx.createGain();
    og.gain.value = w;
    o.connect(og).connect(g);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // breath: air through it, a narrow band of noise on the note
  rasp(ctx, dst, t, dur, f, 7, amp * 0.18, noise, Math.min(0.09, dur * 0.3));
}

const owl: Bird = (ctx, dst, t, noise) => {
  if (R() < 0.35) {
    // the female: ke-wick, a sharp nasal ke and a rising, squeezed wick, rough but not a buzz
    const nasal = ctx.createBiquadFilter();
    nasal.type = 'lowpass'; nasal.frequency.value = 3000; nasal.Q.value = 0.7;
    nasal.connect(dst);
    tone(ctx, nasal, t, 0.08, 1550, 1450, 0.35, { type: 'triangle', attack: 0.005, harm: 0.3 });
    tone(ctx, nasal, t + 0.13, 0.32, 1250, 2000, 0.4, { type: 'triangle', attack: 0.015, harm: 0.35, vib: 40, vibRate: 30 });
    rasp(ctx, dst, t + 0.13, 0.3, 1700, 3, 0.08, noise, 0.02);
    return;
  }
  // the male: a long hoot; a pause; a short hu, a quick hu-hu-hu, and the long wavering huuuuu
  const f = rr(600, 700);
  hoot(ctx, dst, t, rr(0.8, 1.0), f, 0.55, noise);
  t += 1 + rr(2.5, 4);
  hoot(ctx, dst, t, 0.18, f * 0.97, 0.4, noise);
  t += 0.55;
  const n = 3 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) { hoot(ctx, dst, t, 0.1, f * (0.95 + 0.02 * i), 0.35 + 0.04 * i, noise); t += 0.17 - 0.015 * i; }
  hoot(ctx, dst, t + 0.03, rr(1.3, 1.8), f, 0.55, noise, 1);
};

const woodpecker: Bird = (ctx, dst, t, noise) => {
  if (R() < 0.45) {
    // a drum roll on a dead trunk, quick and slowing a hair at the end
    const n = 12 + Math.floor(R() * 6), body = rr(700, 1100);
    for (let i = 0; i < n; i++) {
      const amp = 0.7 * (1 - 0.4 * (i / n));
      rasp(ctx, dst, t, 0.025, body, 5, amp, noise, 0.001);
      tone(ctx, dst, t, 0.03, 320, 180, amp * 0.5, { attack: 0.001 });
      t += 0.038 + 0.012 * Math.pow(i / n, 2);
    }
    return;
  }
  // kik
  for (let i = 0; i < 1 + Math.floor(R() * 3); i++) {
    tone(ctx, dst, t, 0.045, 3400, 2900, 0.5, { harm: 0.3, attack: 0.002 });
    t += rr(0.6, 1.4);
  }
};

const crackle: Bird = (ctx, dst, t, noise) => {
  // a cluster of dry ticks, uneven in spacing and strength: a needle, a leaf, a bit of bark giving
  const n = 2 + Math.floor(Math.pow(R(), 1.5) * 12);
  for (let i = 0; i < n; i++) {
    rasp(ctx, dst, t, rr(0.004, 0.014), rr(1800, 6500), rr(1, 3), Math.pow(R(), 1.6) * 0.9 + 0.1, noise, 0.0008);
    const gauss = Math.sqrt(-2 * Math.log(1 - R())) * Math.cos(Math.PI * 2 * R());
    t += 0.045 * Math.exp(gauss * 0.9);
  }
};

const rustle: Bird = (ctx, dst, t, noise) => {
  // leaves shifted: a few soft swells of hiss, with crackles in them
  for (let i = 0; i < 1 + Math.floor(R() * 3); i++) {
    const d = rr(0.12, 0.4);
    rasp(ctx, dst, t, d, rr(2800, 5000), 0.8, rr(0.15, 0.3), noise, d * 0.4);
    crackle(ctx, dst, t + d * 0.2, noise);
    t += d + rr(0.05, 0.3);
  }
};

const twig: Bird = (ctx, dst, t, noise) => {
  // a twig snapping: a sharp crack, a short woody ring, and the broken end giving a moment later
  rasp(ctx, dst, t, 0.012, 3500, 0.7, 1, noise, 0.0005);
  rasp(ctx, dst, t, 0.06, rr(900, 1500), 6, 0.6, noise, 0.001);
  tone(ctx, dst, t, 0.05, rr(1200, 1700), 900, 0.2, { attack: 0.001 });
  if (R() < 0.6) rasp(ctx, dst, t + rr(0.04, 0.12), 0.01, 3000, 1, 0.5, noise, 0.0005);
};

const cuckoo: Bird = (ctx, dst, t) => {
  // ko-ko, as measured off a recording: the first note short (0.16 s) and arched, sliding up from about 575 Hz to
  // a peak of 600 a third of the way in and down to 530; the second, a third of a second after the first began,
  // a flat 490 for a quarter second; both nearly pure (the overtones some 45 dB down); one ko-ko every 1.6 to
  // 1.8 seconds. (It had been a little high, half as slow again as it is, and coloured with overtones.)
  const f = rr(585, 615);
  const note = (at: number, dur: number, pts: [number, number][], amp: number) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(pts[0][1] * f, at);
    for (const [u, k] of pts.slice(1)) o.frequency.linearRampToValueAtTime(k * f, at + u * dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(amp, at + 0.03);
    g.gain.setValueAtTime(amp, at + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dst);
    o.start(at); o.stop(at + dur + 0.02);
  };
  for (let i = 0; i < 3 + Math.floor(R() * 5); i++) {
    note(t, 0.16, [[0, 0.95], [0.35, 1], [0.6, 0.98], [1, 0.88]], 0.5);
    note(t + 0.32, 0.25, [[0, 0.815], [0.2, 0.825], [0.85, 0.815], [1, 0.8]], 0.55);
    t += rr(1.6, 1.85);
  }
};

const nightingale: Bird = (ctx, dst, t) => {
  // phrases, each a different kind, with pauses: the slow swelling whistles, a fast rattle of chucks, the deep
  // jug-jug, a buzzing trill, a run of sweet slides
  for (let p = 0; p < 2 + Math.floor(R() * 3); p++) {
    const kind = Math.floor(R() * 5);
    if (kind === 0) {
      const f = rr(2200, 3200), n = 4 + Math.floor(R() * 5);
      for (let i = 0; i < n; i++) { tone(ctx, dst, t, 0.22, f, f * 1.02, 0.12 + 0.4 * (i / n), { attack: 0.06 }); t += 0.34; }
    } else if (kind === 1) {
      for (let i = 0; i < 12 + Math.floor(R() * 12); i++) { tone(ctx, dst, t, 0.018, 3800, 2600, 0.45, { harm: 0.4, attack: 0.002 }); t += 0.045; }
    } else if (kind === 2) {
      for (let i = 0; i < 4 + Math.floor(R() * 5); i++) { tone(ctx, dst, t, 0.06, 1500, 1200, 0.5, { harm: 0.5, attack: 0.004 }); t += 0.11; }
    } else if (kind === 3) {
      const d = rr(0.5, 1.0), f = rr(3500, 5000);
      tone(ctx, dst, t, d, f, f * 0.9, 0.35, { vib: rr(500, 900), vibRate: rr(50, 80), attack: 0.02 });
      t += d;
    } else {
      for (let i = 0; i < 5 + Math.floor(R() * 5); i++) { const f = rr(2500, 6000), d = rr(0.06, 0.14); tone(ctx, dst, t, d, f, f * rr(0.7, 1.4), 0.4, { harm: 0.1 }); t += d + 0.02; }
    }
    t += rr(0.35, 0.9);
  }
};

const crack: Bird = (ctx, dst, t, noise) => {
  // a branch giving way somewhere off in the wood. First the fibres start to tear, a run of small cracks closing
  // up; then it breaks, one dry crack, all noise, no note in it (a ring under it sounded like a spring); the
  // splinters after; and sometimes the limb coming down through the branches below and onto the moss
  let at = t;
  const tear = 6 + Math.floor(R() * 10);
  for (let i = 0; i < tear; i++) {
    const u = i / tear;
    rasp(ctx, dst, at, rr(0.003, 0.009), rr(1500, 4000), rr(0.8, 2), (0.12 + 0.35 * u) * rr(0.5, 1), noise, 0.0004);
    at += rr(0.02, 0.07) * (1 - 0.7 * u); // closing up as it gives
  }
  // the break: a broadband crack, a body under it, a second crack a hair later as the other side goes
  rasp(ctx, dst, at, 0.03, 2200, 0.3, 1, noise, 0.0003);
  rasp(ctx, dst, at, 0.06, 700, 0.8, 0.55, noise, 0.0006);
  rasp(ctx, dst, at + rr(0.015, 0.04), 0.02, 3000, 0.4, 0.7, noise, 0.0003);
  // splinters
  let sp = at + 0.03;
  for (let i = 0; i < 6 + Math.floor(R() * 12); i++) { rasp(ctx, dst, sp, rr(0.003, 0.012), rr(1200, 5000), 1.5, rr(0.1, 0.45), noise, 0.0004); sp += rr(0.008, 0.05); }
  if (R() < 0.55) {
    // coming down: rattling through the twigs below, then onto the moss
    const fall = at + rr(0.5, 1.0);
    rasp(ctx, dst, at + 0.15, fall - at - 0.1, 3200, 0.5, 0.1, noise, 0.2);
    let tw = at + 0.2;
    while (tw < fall) { rasp(ctx, dst, tw, rr(0.004, 0.01), rr(1500, 4500), 1.5, rr(0.08, 0.3), noise, 0.0005); tw += rr(0.02, 0.09); }
    rasp(ctx, dst, fall, 0.22, 220, 0.8, 0.7, noise, 0.005);
    rasp(ctx, dst, fall, 0.3, 2500, 0.6, 0.15, noise, 0.01);
  }
};

// who sings, how often (a weight), how far off and how high (metres), how loud at the source
const SPECIES: Record<string, { fn: Bird; w: number; d: [number, number]; h: [number, number]; gain: number }> = {
  robin: { fn: robin, w: 4, d: [10, 26], h: [0.3, 3], gain: 1 },
  goldcrest: { fn: goldcrest, w: 3.5, d: [6, 16], h: [2, 8], gain: 0.8 },
  wren: { fn: wren, w: 2, d: [9, 22], h: [0, 1.5], gain: 1 },
  greatTit: { fn: greatTit, w: 2, d: [12, 30], h: [2, 8], gain: 1 },
  blackbird: { fn: blackbird, w: 2, d: [15, 35], h: [0, 4], gain: 2.2 },
  woodpecker: { fn: woodpecker, w: 1.5, d: [20, 45], h: [3, 10], gain: 4 },
  owl: { fn: owl, w: 0.7, d: [35, 60], h: [6, 14], gain: 4 },
  // (summer birds, gone south by autumn; too much of a Swedish wood to leave out, so rare and far)
  cuckoo: { fn: cuckoo, w: 0.5, d: [40, 80], h: [5, 15], gain: 4 },
  nightingale: { fn: nightingale, w: 0.6, d: [20, 40], h: [0.5, 3], gain: 2 },
};
export const BIRDS = Object.keys(SPECIES); // (the birds only: the ground's and the loud are added after)
// the ground's: near, low, often
const GROUND: Record<string, { fn: Bird; w: number; d: [number, number]; h: [number, number]; gain: number }> = {
  crackle: { fn: crackle, w: 5, d: [0.8, 6], h: [-0.1, 0.1], gain: 0.9 },
  rustle: { fn: rustle, w: 2, d: [1, 6], h: [-0.1, 0.1], gain: 0.8 },
  twig: { fn: twig, w: 0.8, d: [2, 9], h: [-0.1, 0.2], gain: 1.2 },
};
Object.assign(SPECIES, GROUND);
// and now and then something loud, off in the wood, ringing through it
const LOUD: Record<string, { fn: Bird; w: number; d: [number, number]; h: [number, number]; gain: number }> = {
  crack: { fn: crack, w: 1, d: [15, 40], h: [0, 8], gain: 3 },
};
Object.assign(SPECIES, LOUD);
export const LOUD_KINDS = Object.keys(LOUD);
export const GROUND_KINDS = Object.keys(GROUND);

/** Pinkish noise, two channels apart, for the wind; long enough that its loop does not show. */
function windNoise(ctx: BaseAudioContext, secs: number) {
  const sr = ctx.sampleRate, buf = ctx.createBuffer(2, sr * secs, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = R() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
    }
  }
  return buf;
}

/**
 * The wood's echo, as an impulse response: a few early reflections off the nearest trunks, then a sparse, soft
 * tail, the highs dying first (bark and needles soak them up), about two seconds to silence. Two channels apart,
 * so it is wide. Made once, here, from noise.
 */
function forestIR(ctx: BaseAudioContext) {
  const sr = ctx.sampleRate, len = Math.floor(sr * 2.2), buf = ctx.createBuffer(2, len, sr);
  const RT60 = 1.6;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.pow(10, (-3 * t) / RT60) * Math.min(1, t / 0.012); // a short build: no echo at once
      const a = 0.08 + 0.75 * Math.exp(-t / 0.25); // the one-pole's opening: bright early, dark late
      y += a * ((R() * 2 - 1) - y);
      d[i] = y * env * (R() < 0.35 ? 1 : 0.35); // sparse: trunks, not a hall
    }
    // the first trunks: a handful of distinct reflections in the first 80 ms
    for (let k = 0; k < 6; k++) {
      const i = Math.floor(sr * rr(0.008, 0.08));
      d[i] += rr(-0.5, 0.5) * (1 - i / (sr * 0.1));
    }
  }
  return buf;
}

export class Forest {
  private started = false;
  /** How loud each part is and whether it plays by itself (the debug soundboard turns these). The birds well down
   * and well off: the wood round you, not birds at your ear (they were). */
  levels = { wind: 1, birds: 0.4, ground: 1, loud: 1, body: 1, wet: 0.38 };
  auto = { birds: true, ground: true, loud: true };
  private bed: GainNode | null = null;
  private wet: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private birdBus: GainNode | null = null;
  private wind: { low: GainNode; lowF: BiquadFilterNode; high: GainNode } | null = null;
  private gustIn = 0;
  private next = 2.5; // seconds to the first bird
  private nextGround = 1;
  private nextLoud = rr(12, 30);
  private home = new Map<string, THREE.Vector3>(); // where each kind sings from, for a while
  private f = new THREE.Vector3();
  private u = new THREE.Vector3();

  private verb: GainNode | null = null; // the send into the wood's echo

  constructor(private audio: { ctx: AudioContext | null; out: GainNode | null; send?: AudioNode | null }, private camera: THREE.Camera) {}

  private start(ctx: AudioContext, out: GainNode) {
    this.started = true;
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = R() * 2 - 1;
    // the wind: a low roar of the whole wood, and the hiss of the needles over it, each breathing with the gusts
    const src = ctx.createBufferSource();
    src.buffer = windNoise(ctx, 12);
    src.loop = true;
    const lowF = ctx.createBiquadFilter(); lowF.type = 'lowpass'; lowF.frequency.value = 450; lowF.Q.value = 0.5;
    const low = ctx.createGain(); low.gain.value = 0.25;
    const hiF = ctx.createBiquadFilter(); hiF.type = 'bandpass'; hiF.frequency.value = 4200; hiF.Q.value = 0.6;
    const high = ctx.createGain(); high.gain.value = 0.04;
    const bed = ctx.createGain(); bed.gain.value = 0;
    bed.gain.setTargetAtTime(0.16 * this.levels.wind, ctx.currentTime, 2); // fades in; low, under the rest (louder, it was a gale)
    this.bed = bed;
    src.connect(lowF).connect(low).connect(bed);
    src.connect(hiF).connect(high).connect(bed);
    bed.connect(out);
    src.start();
    this.wind = { low, lowF, high };
    this.birdBus = ctx.createGain();
    this.birdBus.gain.value = 1.0;
    this.birdBus.connect(out);
    // the echo: everything sends some in (the far birds more), it comes back wide and dark
    const conv = ctx.createConvolver();
    conv.buffer = forestIR(ctx);
    const wet = ctx.createGain();
    wet.gain.value = this.levels.wet;
    this.wet = wet;
    this.verb = ctx.createGain();
    this.verb.connect(conv).connect(wet).connect(out);
    const fx = ctx.createGain();
    fx.gain.value = 0.3; // the throws, puffs and creaks, a little
    fx.connect(this.verb);
    this.audio.send = fx;
  }

  /** Somewhere for a bird of this kind to sing from: kept for a while, so a robin sings again from its tree. */
  private where(kind: string) {
    const s = SPECIES[kind];
    let p = this.home.get(kind);
    if (!p || R() < 0.3 || kind in GROUND) { // (the ground's sounds anywhere round you, each time)
      const a = R() * Math.PI * 2, d = rr(...s.d);
      p = new THREE.Vector3(this.camera.position.x + Math.cos(a) * d, this.camera.position.y + rr(...s.h), this.camera.position.z + Math.sin(a) * d);
      this.home.set(kind, p);
    }
    return p;
  }

  /** A bird of `kind` calls from p at time t (now, if left out). */
  call(kind: string, p?: THREE.Vector3, t?: number) {
    const ctx = this.audio.ctx;
    if (!ctx || !this.ready() || !this.noise) return;
    const s = SPECIES[kind];
    p ??= this.where(kind);
    const d = p.distanceTo(this.camera.position);
    // placed in 3D, and dulled with distance as the air takes the highs
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = 3;
    pan.rolloffFactor = 1;
    if (pan.positionX) { pan.positionX.value = p.x; pan.positionY.value = p.y; pan.positionZ.value = p.z; } else pan.setPosition(p.x, p.y, p.z);
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = Math.max(1800, 16000 * Math.exp(-d / 28));
    const g = ctx.createGain();
    g.gain.value = s.gain * (kind in GROUND ? this.levels.ground : kind in LOUD ? this.levels.loud : this.levels.birds);
    g.connect(air).connect(pan).connect(this.birdBus!);
    // into the echo: more the further off (a far bird is mostly echo), the ground's crackles a little
    const send = ctx.createGain();
    send.gain.value = kind in LOUD ? 1.1 : kind in GROUND ? 0.15 : 0.2 + 0.6 * Math.min(1, d / 35); // a crack rings through the wood
    air.connect(send).connect(this.verb!);
    s.fn(ctx, g, t ?? ctx.currentTime + 0.05, this.noise);
  }

  /** Your own body's sounds, not placed: in the middle, close, the steps a hair left and right in turn. */
  private self(pan: number) {
    const ctx = this.audio.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.birdBus!);
    // your own body: hardly any echo, just enough to sit in the wood
    const send = ctx.createGain();
    send.gain.value = 0.05;
    p.connect(send).connect(this.verb!);
    return p;
  }

  /** A footfall on the moss — or in a puddle when `wet` > 0 (0 dry moss .. 1 open water). On moss: a soft hiss
   * of fronds brushed, a faint pad, dry stalk crackles. In a puddle: a wet surface slap, water wash and rising
   * Minnaert bubble blips. `k` how hard (a landing more). */
  step(k: number, crouch: number, left: boolean, wet = 0) {
    const ctx = this.audio.ctx;
    if (!ctx || !this.ready() || !this.noise) return;
    const t = ctx.currentTime + 0.01, a = k * (1 - 0.55 * crouch) * this.levels.body, dst = this.self(left ? -0.18 : 0.18);
    const dry = Math.max(0, 1 - wet);
    if (dry > 0.02) {
      const s = ctx.createBufferSource();
      s.buffer = this.noise; s.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = rr(500, 900); lp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.1 * a * dry, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + rr(0.07, 0.11));
      s.connect(lp).connect(g).connect(dst);
      s.start(t, R() * 1.5); s.stop(t + 0.15);
      tone(ctx, dst, t, 0.07, 110, 60, 0.05 * a * dry, { attack: 0.01 });
      rasp(ctx, dst, t, rr(0.14, 0.22), rr(3200, 5200), 0.7, 0.16 * a * dry, this.noise, 0.03); // the hiss of the fronds
      for (let i = 0; i < 1 + Math.floor(R() * 4); i++) rasp(ctx, dst, t + rr(0, 0.06), rr(0.003, 0.008), rr(2500, 6000), 2, rr(0.025, 0.07) * a * dry, this.noise, 0.0006);
    }
    if (wet > 0.02) {
      const w = a * wet;
      // surface slap: bandpass noise sweeping upward as the foot breaks the water
      const sl = ctx.createBufferSource();
      sl.buffer = this.noise; sl.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 1.3;
      const dur = rr(0.07, 0.12) * (k > 1 ? 1.35 : 1);
      bp.frequency.setValueAtTime(rr(500, 760), t);
      bp.frequency.exponentialRampToValueAtTime(rr(1450, 2150), t + dur * 0.65);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(0.16 * w, t + 0.006);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      sl.connect(bp).connect(sg).connect(dst);
      sl.start(t, R() * 1.5); sl.stop(t + dur + 0.03);
      // hollow shallow-water thump
      tone(ctx, dst, t, 0.055, rr(170, 210), rr(85, 110), 0.045 * w, { attack: 0.005 });
      // fine spray & wash tail
      rasp(ctx, dst, t + 0.008, rr(0.14, 0.24) * (k > 1 ? 1.3 : 1), rr(2300, 3600), 0.8, 0.13 * w, this.noise, 0.015);
      // rising Minnaert bubble chirps (air pockets shrinking as they surface)
      const nb = 4 + Math.floor(R() * 4) + (k > 1 ? 3 : 0);
      for (let i = 0; i < nb; i++) {
        const dt = rr(0.006, k > 1 ? 0.18 : 0.13);
        const f0 = rr(480, 1750);
        tone(ctx, dst, t + dt, rr(0.014, 0.032), f0, f0 * rr(1.45, 1.9), rr(0.018, 0.052) * w, { attack: 0.002 });
      }
      // a couple of late falling drops landing back on the puddle
      for (let i = 0; i < 1 + Math.floor(R() * 2); i++) {
        const f0 = rr(1300, 2500);
        tone(ctx, dst, t + rr(0.11, 0.24), rr(0.013, 0.022), f0, f0 * rr(1.35, 1.65), rr(0.012, 0.03) * w, { attack: 0.0015 });
      }
    }
  }

  /** A breath, in or out: air through the nose, rising as it fills, lower and longer going out. `k` how deep. */
  breathe(inhale: boolean, k: number) {
    const ctx = this.audio.ctx;
    if (!ctx || !this.ready() || !this.noise) return;
    const t = ctx.currentTime + 0.01, d = inhale ? 1.1 : 1.5, dst = this.self(0);
    const s = ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(inhale ? 1100 : 1300, t);
    bp.frequency.linearRampToValueAtTime(inhale ? 1900 : 750, t + d);
    const g = ctx.createGain(), a = (inhale ? 0.032 : 0.025) * k * this.levels.body; // quiet: felt more than heard
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(a, t + d * (inhale ? 0.6 : 0.25));
    g.gain.linearRampToValueAtTime(0.0001, t + d);
    s.connect(bp).connect(g).connect(dst);
    s.start(t, R() * 1.5); s.stop(t + d + 0.05);
  }

  /** Started, if the sound is awake: a button on the soundboard can call before the first frame has. */
  private ready() {
    const { ctx, out } = this.audio;
    if (ctx && out && !this.started) this.start(ctx, out);
    return this.started;
  }

  /** The levels, after the soundboard changed them. */
  apply() {
    const ctx = this.audio.ctx;
    if (!ctx) return;
    this.bed?.gain.setTargetAtTime(0.16 * this.levels.wind, ctx.currentTime, 0.1);
    this.wet?.gain.setTargetAtTime(this.levels.wet, ctx.currentTime, 0.1);
  }

  update(dt: number) {
    const { ctx, out } = this.audio;
    if (!ctx || !out) return;
    if (!this.started) this.start(ctx, out);
    // the ears are the eye
    const l = ctx.listener, c = this.camera;
    c.getWorldDirection(this.f);
    this.u.set(0, 1, 0).applyQuaternion(c.quaternion);
    if (l.positionX) {
      l.positionX.value = c.position.x; l.positionY.value = c.position.y; l.positionZ.value = c.position.z;
      l.forwardX.value = this.f.x; l.forwardY.value = this.f.y; l.forwardZ.value = this.f.z;
      l.upX.value = this.u.x; l.upY.value = this.u.y; l.upZ.value = this.u.z;
    } else {
      l.setPosition(c.position.x, c.position.y, c.position.z);
      l.setOrientation(this.f.x, this.f.y, this.f.z, this.u.x, this.u.y, this.u.z);
    }
    // a gust now and then: the roar swells and opens, the needles hiss louder, and it falls away again
    if ((this.gustIn -= dt) <= 0 && this.wind) {
      const k = Math.pow(R(), 1.5), t = ctx.currentTime, tau = rr(1.2, 3);
      this.wind.low.gain.setTargetAtTime(0.15 + 0.45 * k, t, tau);
      this.wind.lowF.frequency.setTargetAtTime(300 + 700 * k, t, tau);
      this.wind.high.gain.setTargetAtTime(0.015 + 0.09 * k, t, tau);
      this.gustIn = rr(2.5, 8);
    }
    // the birds: one every few seconds, by weight
    if ((this.next -= dt) <= 0 && this.auto.birds) {
      let pick = R() * BIRDS.reduce((a, k) => a + SPECIES[k].w, 0), kind = BIRDS[0];
      for (const k of BIRDS) { pick -= SPECIES[k].w; if (pick <= 0) { kind = k; break; } }
      this.call(kind);
      this.next = rr(1.8, 6.5);
    }
    // and the ground, more often
    if ((this.nextGround -= dt) <= 0 && this.auto.ground) {
      let pick = R() * GROUND_KINDS.reduce((a, k) => a + GROUND[k].w, 0), kind = GROUND_KINDS[0];
      for (const k of GROUND_KINDS) { pick -= GROUND[k].w; if (pick <= 0) { kind = k; break; } }
      this.call(kind);
      this.nextGround = rr(0.25, 2.2);
    }
    // a branch cracking somewhere, rarely
    if ((this.nextLoud -= dt) <= 0 && this.auto.loud) { this.call('crack'); this.nextLoud = rr(15, 50); }
  }
}
