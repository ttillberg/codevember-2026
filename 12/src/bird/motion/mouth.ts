import type { Pose } from '../pose';
import { rand, smoothstep } from '../util';
import type { Layer, Mind } from './mind';

// Small business of the bill and tongue outside of feeding: the quick lick a
// calm hummingbird gives now and then (tongue out and back in a fifth of a
// second), a clean-up lick after eating, and singing: the bill held open and
// pulsing with the tongue showing. Nothing makes it sing yet except sing().
export class MouthLayer implements Layer {
  readonly name = 'mouth';
  enabled = true;
  /** seconds between idle licks, min and max */
  lickEvery: [number, number] = [14, 34];
  private lickAt = -10;
  private lickAmp = 0.6;
  private nextLick: number;
  private singFrom = -10;
  private singFor = 0;

  constructor(mind: Mind) {
    this.nextLick = rand(mind.rng, 6, 16);
    mind.on('ate', () => {
      // wipe the bill afterwards, most times
      if (mind.rng() < 0.7) this.nextLick = mind.t + rand(mind.rng, 0.25, 0.6);
    });
    mind.on('startle', () => {
      this.singFor = 0;
      this.nextLick = mind.t + rand(mind.rng, 8, 16);
    });
  }

  lick(m: Mind, amount = rand(m.rng, 0.45, 0.85)) {
    this.lickAt = m.t;
    this.lickAmp = amount;
    this.nextLick = m.t + rand(m.rng, this.lickEvery[0], this.lickEvery[1]);
  }

  /** Sing for a while: open bill, trilling, tongue showing. */
  sing(m: Mind, seconds = 1.6) {
    this.singFrom = m.t;
    this.singFor = seconds;
  }

  get singing() {
    return this.singFor > 0;
  }

  update(m: Mind, p: Pose) {
    if (!m.quiet && m.t >= this.nextLick && !m.gazeLock && !m.focus && m.freeze <= 0 && m.arousal < 0.6) this.lick(m);
    const x = (m.t - this.lickAt) / 0.22;
    if (x >= 0 && x <= 1) {
      const k = Math.sin(Math.PI * smoothstep(0, 1, x));
      p.tongueOut += k * this.lickAmp;
      p.tongueCurl += k * 0.25;
      p.jaw += k * 0.14;
    }
    const s = m.t - this.singFrom;
    if (this.singFor > 0 && s >= 0) {
      if (s > this.singFor) {
        this.singFor = 0;
        return;
      }
      // phrases of fast notes: the bill pulses on each, the throat swells, the head lifts
      const env = smoothstep(0, 0.12, s) * (1 - smoothstep(this.singFor - 0.18, this.singFor, s));
      const phrase = 0.5 + 0.5 * Math.sin(s * 5.2);
      const note = 0.5 + 0.5 * Math.sin(s * 9.5 * Math.PI * 2);
      p.jaw += env * (0.35 + 0.5 * phrase * note);
      p.tongueOut += env * (0.12 + 0.2 * phrase * (1 - note));
      p.headPitch += env * 0.16;
      p.gorget += env * (0.12 + 0.1 * note);
      p.crest += env * 0.1;
      p.addLift(0.2, 0.12, env * 0.1 * note);
    }
  }
}
