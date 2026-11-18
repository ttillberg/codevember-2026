# 18 / Pendulum

2026-11-18

A pendulum as a drum machine, drawn in lines. It starts as one arm swinging once a bar: a tick
where it crosses the centre line going right, a tock going left. A binary rhythm. Then more
arms, each hung from the end of the one before and swinging its own number of times a bar, and
every joint is a voice that sounds where *it* crosses the centre line.

A joint's sideways position is the sum of every arm above it, a sum of sines: a Fourier series.
So the first joint plays the fundamental, plain and binary, and each joint further down plays
the zero crossings of a longer partial sum. Small swings add up into a rhythm none of them has
alone: with ×1 and ×2 the second joint's hits fall at 0, 0.35, 0.5 and 0.65 of the bar, a swing
that comes only from how long the two arms are. How fast a joint crosses is how hard it hits.

Follows the sound track of day 14, turned to rhythm.

```sh
pnpm -C 18 dev
```

## How it plays

- **The workbench**, bottom right: a row an arm. `− ×n +` is how many swings it makes in a bar
  (the harmonic), then how far it swings (0 to 180°), how long it is, and its phase: where in
  its swing it is when the bar starts (0° it crosses going right, 90° it is out at the right).
  `✕` takes it away.
- **+ Arm** (or `+`, `-` takes the last one away): a new arm on the end, one harmonic up.
- **Sum / Each** (`S`): what a joint crosses to sound. *Sum* is the centre line under the pivot:
  the Fourier picture. *Each* is the vertical under the joint's own origin, its arm alone: a
  plain polyrhythm, every arm an even pulse.
- **Pause** (space), **Sound** (`M`), **Tempo**: four beats to the bar, so ×1 ticks on 1 and
  tocks on 3.
- **The bar** along the bottom: a row a joint, a tick a hit, up for tick and down for tock, as
  tall as it is hard.
- `?arms=1-34-1,2-52-0.62-90` is a pattern in a link (swings, swing in degrees, length, and the
  phase in degrees if any; `&bpm=`, `&mode=each`). Without it, the last pattern is remembered. `?clean` hides the furniture.

## How it works

- No physics yet, only trigonometry: an arm's angle is `swing · sin(2π n φ)`, φ the bar. So the
  future is known, and the hits are not found by watching frames: a scheduler steps a little
  ahead of now, bisects every zero crossing and starts it on the audio clock. The rhythm is as
  tight as the formula whatever the frame rate. (It looks ahead further than the output's own
  latency, bluetooth too: a hit that has to start in the past lands on the scheduler's tick.)
- The voices are plain Web Audio nodes: a sine with a falling pitch, one partial over it, a
  click of noise. Low for the first joint and higher down the chain, the tock a fourth under
  the tick, harder hits brighter. A short room, a compressor.
- `__pendulum.sound()?.stats` in the dev console: how many hits went out, how far ahead.

## Next

Ratios that are not whole (a bar that never
quite repeats), real physics with a knob from formula to chaos, easing the swing's shape, and
pulling an arm aside by hand.
