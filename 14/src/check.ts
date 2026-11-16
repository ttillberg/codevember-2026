// Dev only: render a storm of plucks through the whole graph offline, every preset, with dot
// chords, flageolets, slides, the delay and an arpeggio, and report what came out: peaks, loudness, anything not a number. Run in the
// console: await __tension.offline()

import { Engine } from './audio';
import { Groove, PATTERNS } from './arp';
import { PRESETS, type Preset } from './presets';

/** the semitones above the root of scale degree `d` (0, 1, 2 … across octaves) */
function degreeSemis(p: Preset, d: number) {
  const n = p.scale.length;
  return p.scale[((d % n) + n) % n] + 12 * Math.floor(d / n);
}

export async function offlineCheck(seconds = 12, wav = false) {
  const sr = 48000;
  const report: Record<string, unknown>[] = [];
  for (const p of PRESETS) {
    const ctx = new OfflineAudioContext(2, sr * seconds, sr);
    const e = await Engine.create(ctx, p);
    e.setDelay(0.5);
    e.pad.setOn(true);
    // the messages go over a port, so they are timed by suspending the render
    const events: Array<[number, () => void]> = [];
    let x = 0;
    for (let t = 0.1; t < seconds - 2; t += 0.18 + (x++ % 4) * 0.12) {
      const i = x;
      events.push([t, () => {
        const deg = i % 6;
        const kind = i % 5 === 0 ? 'strike' : 'pluck';
        const note = p.root + degreeSemis(p, deg + (i % 7 === 0 ? 1 : 0));
        groove.feed(note, 0.8, ctx.currentTime);
        e.pluck({ note, pos: ((i * 0.37) % 0.94) + 0.03, kind, force: i % 3 === 0 ? 1 : 0.4 + (i % 4) * 0.15 });
        if (i % 4 === 0) e.chordNote(p.root + 12 + degreeSemis(p, deg + 2), 0.6, 0.4, ctx.currentTime);
        if (i % 5 === 2) e.harmonic(note, 2 + (i % 4), 0.7);
        if (i % 9 === 4) e.slide(i % 2 ? 2 : -3, 0.05);
      }]);
    }
    // the groove on (a different pattern per preset), fed by every pluck above, played by the
    // same scheduler as the page, ticked like a frame loop
    const groove = new Groove();
    groove.mode = PRESETS.indexOf(p) % PATTERNS.length;
    for (let t = 0.03; t < seconds; t += 0.05) {
      events.push([t, () => groove.tick(ctx.currentTime, 0.12, e.pad.notes, p.root, (h) => e.arpNote(h.note, h.force, 0.3, h.when))]);
    }
    events.sort((a, b) => a[0] - b[0]);
    const q = 128 / sr;
    for (const [t, fn] of events) {
      const at = Math.ceil(t / q) * q;
      ctx.suspend(at).then(() => {
        fn();
        ctx.resume();
      }).catch(() => fn());
    }
    const buf = await ctx.startRendering();
    let peak = 0;
    let sum = 0;
    let nan = 0;
    let over = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        const v = d[i];
        if (!Number.isFinite(v)) nan++;
        const a = Math.abs(v);
        if (a > peak) peak = a;
        if (a > 0.99) over++;
        sum += v * v;
      }
    }
    const rms = Math.sqrt(sum / (buf.length * buf.numberOfChannels));
    // the loudest 50 ms window, and the biggest jump between two samples (a click)
    const d = buf.getChannelData(0);
    let maxWin = 0;
    let jump = 0;
    const W = Math.floor(0.05 * sr);
    for (let i = 0; i + W < d.length; i += W) {
      let s = 0;
      for (let j = i; j < i + W; j++) s += d[j] * d[j];
      maxWin = Math.max(maxWin, Math.sqrt(s / W));
    }
    for (let i = 1; i < d.length; i++) jump = Math.max(jump, Math.abs(d[i] - d[i - 1]));
    let pcm = '';
    if (wav) {
      // interleaved 16 bit, base64, for listening outside the browser
      const L = buf.getChannelData(0);
      const R = buf.getChannelData(1);
      const b = new Int16Array(L.length * 2);
      for (let i = 0; i < L.length; i++) {
        b[2 * i] = Math.max(-1, Math.min(1, L[i])) * 32767;
        b[2 * i + 1] = Math.max(-1, Math.min(1, R[i])) * 32767;
      }
      const bytes = new Uint8Array(b.buffer);
      let str = '';
      for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      pcm = btoa(str);
    }
    report.push({ pcm, preset: p.id, peak: +peak.toFixed(3), rmsDb: +(20 * Math.log10(rms + 1e-12)).toFixed(1), loudestDb: +(20 * Math.log10(maxWin + 1e-12)).toFixed(1), over, nan, jump: +jump.toFixed(3) });
  }
  console.table(report.map(({ pcm, ...r }) => (void pcm, r)));
  return report;
}
