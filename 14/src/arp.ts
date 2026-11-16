// The groove: when Arp is on, every note you play goes into a short memory, and the wire keeps
// playing a rhythmic pattern over it by itself, in time. Your own plucks sound at once as
// always, and the groove follows them: each pluck is a beat, the groove's grid shifts so its
// next sixteenth comes a sixteenth after you (it never lands a hair after your note, which
// sounds like your pluck came late). The newest note is the one it answers with.
// How hard you played sets how busy and how loud it is; stop, and it thins out and fades;
// play again, and it comes back in on the next beat.

import { ARP_BPM } from './audio';

/**
 * A pattern is sixteen sixteenths. `vel`: X accent, x normal, g ghost, anything else a rest
 * (the last note rings on through it). `role`, which note: N the newest, O the newest an
 * octave up, F a fifth over the newest, L the lowest, l the next lowest, H the highest,
 * U a walk up, D a walk down.
 */
export const PATTERNS = [
  // 3-3-2: accents on 1, the "and" of 1 and 2, then again; ghosts in between, walking up
  { id: 'pulse', label: 'Pulse', vel: 'X.gx.gx.X.gx.gxg', role: 'N.UU.UU.N.UU.UOU' },
  // sparse and spacious: a note, a long breath, an answer a fifth up, a ghost far away
  { id: 'drift', label: 'Drift', vel: 'X......x...g....', role: 'N......F...U....' },
  // falling sixteenths with holes in them
  { id: 'cascade', label: 'Cascade', vel: 'XxgxX.gxXxg.Xxgx', role: 'HDDDDDDDHDDDDDDD' },
  // a low figure going round in 3-3-2, the newest and highest notes over it
  { id: 'ostinato', label: 'Ostinato', vel: 'X.xx.xx.X.xx.xg.', role: 'L.Nl.Ll.L.Hl.LU.' },
] as const;

const BEAT = 60 / ARP_BPM;
const STEP = BEAT / 4;
/** seconds of silence it keeps full, then fades over */
const HOLD = 2;
const FADE = 9;
/** how many played notes it remembers */
const MEMORY = 6;

export interface Hit {
  note: number;
  force: number;
  when: number;
}

export class Groove {
  mode = -1;
  /** the notes played, oldest first */
  private memory: number[] = [];
  private force = 0;
  private lastPlay = -1e9;
  private running = false;
  /** the next sixteenth to schedule: its index on the beat grid, from `offset` (audio time) */
  private nextStep = 0;
  private offset = 0;
  private up = 0;
  private down = 0;

  /** a note was played: into the memory (quantised to the memory, not to time) */
  feed(note: number, force: number, now: number) {
    this.memory.push(note);
    if (this.memory.length > MEMORY) this.memory.shift();
    this.force = Math.max(0.15, Math.min(1, force));
    this.lastPlay = now;
    // your pluck is a beat: the grid moves so a beat falls right on it, the groove carries on
    // from the sixteenth after it (what's already scheduled is only a few ms ahead)
    const beat = Math.ceil(this.nextStep / 4) * 4;
    this.offset = now - beat * STEP;
    this.nextStep = beat + 1;
  }

  /** the strings or the scale changed: what it remembers moves over (register and scale) */
  retune(map: (note: number) => number) {
    this.memory = this.memory.map(map);
  }

  /** where in its beat the groove is now, 0..1 (on your plucks' grid), and whether it plays */
  phase(now: number) {
    const b = (now - this.offset) / BEAT;
    return b - Math.floor(b);
  }
  get playing() {
    return this.running;
  }

  /** how present it is now, 0..1: the last pull, held a moment, then fading */
  intensity(now: number) {
    const since = now - this.lastPlay;
    const fade = since < HOLD ? 1 : Math.max(0, 1 - (since - HOLD) / FADE);
    return this.force * fade;
  }

  /** the notes it has to play with: the memory, the newest's octave and fifth, the pad's voicing */
  private pool(voicing: number[], low: number) {
    const set = new Set<number>(this.memory);
    const newest = this.memory[this.memory.length - 1];
    if (newest !== undefined) set.add(newest + 12);
    // the pad's voicing, brought down into the wire's two octaves
    for (const m of voicing) {
      let x = m;
      while (x >= low + 24) x -= 12;
      while (x < low) x += 12;
      set.add(x);
    }
    return [...set].sort((a, b) => a - b);
  }

  /**
   * Schedule what falls within the next `ahead` seconds. `play` gets each note with its audio
   * time; `voicing` is the pad's; `low` the wire's open note.
   */
  tick(now: number, ahead: number, voicing: number[], low: number, play: (h: Hit) => void) {
    const pat = PATTERNS[this.mode];
    const I = this.intensity(now);
    if (!pat || !this.memory.length || I < 0.04) {
      this.running = false;
      return;
    }
    if (!this.running) {
      // back in on the next beat
      this.running = true;
      // (unless the pluck that woke it has just set where it goes on from)
      if (this.offset + this.nextStep * STEP < now) this.nextStep = Math.ceil((now + 0.02 - this.offset) / BEAT) * 4;
    }
    // nothing due this frame (most frames): nothing to work out
    if (this.offset + this.nextStep * STEP >= now + ahead) return;
    const notes = this.pool(voicing, low);
    const newest = this.memory[this.memory.length - 1];
    const nearest = (target: number) => notes.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    while (this.offset + this.nextStep * STEP < now + ahead) {
      const n = this.nextStep++;
      const i = n % 16;
      const v = pat.vel[i];
      // how busy: the ghosts only when played hard, the plain notes unless it's nearly gone
      const level = v === 'X' ? 1 : v === 'x' ? 0.7 : v === 'g' ? 0.32 : 0;
      if (!level || (v === 'g' && I < 0.45) || (v === 'x' && I < 0.15)) continue;
      const r = pat.role[i];
      let note =
        r === 'N' ? newest
        : r === 'O' ? newest + 12
        : r === 'F' ? nearest(newest + 7)
        : r === 'L' ? notes[0]
        : r === 'l' ? notes[Math.min(1, notes.length - 1)]
        : r === 'H' ? notes[notes.length - 1]
        : r === 'D' ? notes[(notes.length - 1 - (this.down++ % notes.length) + notes.length) % notes.length]
        : notes[this.up++ % notes.length];
      if (r === 'H') this.down = 1;
      // now and then an accent jumps an octave
      if (v === 'X' && r !== 'O' && Math.random() < 0.12 && note + 12 <= low + 30) note += 12;
      // light swing on the off sixteenths, and a little looseness
      const swing = n % 2 === 1 ? STEP * 0.1 : 0;
      const when = Math.max(now + 0.005, this.offset + n * STEP + swing + (Math.random() - 0.5) * 0.014);
      const emph = note === newest || note === newest + 12 ? 1.1 : 1;
      const force = Math.min(1, level * (0.35 + 0.65 * I) * emph * (0.92 + Math.random() * 0.16));
      play({ note, force, when });
    }
  }
}
