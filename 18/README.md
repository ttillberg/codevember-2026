# 18 / Pendulum

2026-11-18

A pendulum as a drum machine, drawn in lines. Take it down to one arm swinging once a bar: a
tick where it crosses the centre line going right, a tock going left. A binary rhythm. Then more
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
  its swing it is when the bar starts (0° it crosses going right, 90° it is out at the right),
  and how loud its joint's voice is: all the way down is muted, the arm still swings and still
  moves the ones under it, its row and its rings go dim.
  `✕` takes it away.
- **+ Arm** (or `+`, `-` takes the last one away): a new arm on the end, one harmonic up.
- **Sum / Each** (`S`): what a joint crosses to sound. *Sum* is the centre line under the pivot:
  the Fourier picture. *Each* is the vertical under the joint's own origin, its arm alone: a
  plain polyrhythm, every arm an even pulse.
- **Restart** (`R`): the motion from the top, the setup as it is. The bar starts over, and with
  weight the chain is put back on the formula: the same chaos again, from the start.
- **Pause** (space), **Sound** (`M`), **Tempo**: four beats to the bar, so ×1 ticks on 1 and
  tocks on 3.
- **Weight**: 0 is the formula. Over it every arm is a real swing hung in the swing above, a
  weight at each joint, and the knob is how heavy each joint is against the one above it. Light
  ones ride the swing over them and are shaken by it; heavy ones throw it about.
- **Push**: what keeps a swing going, the force you give a swing: a push along the way it
  should be moving, in its own rhythm, and the air against the way it is. Nothing holds it in
  place. High and the rhythm is kept close to the formula; around 30 the bar still comes
  round, bent by the weight; lower and the swings drift against each other; at 0 they are let
  go.
- **Presets**: shift and a digit (0 to 9) keeps the whole setup under it (the arms, sum or
  each, tempo, weight, push); the digit alone brings it back, the motion going on where the bar
  is. A word under the title says which. 0 is the default until something is saved over it.
  Remembered per viewer.
- **Saved by name** (ctrl where there is no cmd): **cmd+shift+S** asks for a name and saves the
  setup under it, offering the last name with the next number (groove, groove 2, groove 3);
  **cmd+S** saves over the name it has (and asks for one the first time); **cmd+O** lists
  everything saved, the newest first: arrows and enter, or a click, opens one, `✕` deletes it.
  Remembered per viewer, beside the digits' presets.
- **Tips** (the `?` top right, or the `?` key): what the control under the pointer does, in a
  box of its own over the workbench (under the title on a phone, where it shows for the
  control you press). On to start with, remembered.
- **The bar** along the bottom: a row a joint, a tick a hit, up for tick and down for tock, as
  tall as it is hard. With weight it shows what was played, the playhead writing over the bar
  before, and the paths become the trail of the last bar.
- `?arms=1-34-1,2-52-0.62-90-50` is a pattern in a link (swings, swing in degrees, length, and
  if any the phase in degrees and the volume in percent; `&bpm=`, `&mode=each`, `&weight=0.3`, `&push=0.4`). Without it, the last pattern is remembered; a
  pattern opened from a link is not, until something in it is changed. `?clean` hides the furniture.

## How it works

- No physics yet, only trigonometry: an arm's angle is `swing · sin(2π n φ)`, φ the bar. So the
  future is known, and the hits are not found by watching frames: a scheduler steps a little
  ahead of now, bisects every zero crossing and starts it on the audio clock. The rhythm is as
  tight as the formula whatever the frame rate. (It looks ahead further than the output's own
  latency, bluetooth too: a hit that has to start in the past lands on the scheduler's tick.)
- The weight (`physics.ts`) is a real pendulum of n arms, a point mass at every joint, solved
  for the angles' accelerations (an n by n system a step) and stepped with RK4, 4096 steps a
  bar. Two things are not as in nature. Each arm has a gravity of its own, set so that alone
  it swings its ×n a bar whatever its length: its own rhythm. And at each joint a motor gives
  the push, `(θ'* − θ') ω / Q`: the formula's speed against the arm's own, so on the formula it
  is nothing, and the formula's motion is what every swing does by itself. The motor pushes
  back on the arm above as hard as it pushes its own. What bends the rhythm is then only what
  is real: a wide swing is slower than a small one, the joint an arm hangs from is moving, and
  the arms under it pull.
- It runs in bars, not seconds, so tempo only says how fast a bar goes by. And it runs ahead
  of what is seen, as far as the formula's crossings are looked up, so the hits are still
  known before they are heard; the drawing reads the kept states behind it.
- Checked: with nothing pushing the energy stays put to six digits over 16 bars at any
  weight; an arm alone at 34° takes 1.023 of its own period, ×1 and ×3 alike. With the default
  three arms, bar 10 is bar 11 from push 30 up at every weight, and never under it; at weight
  30 the arms are within 20°, 29° and 76° of the formula at push 30, and 6°, 13°, 14° at 100.
- Tried first: one knob that blended the physical acceleration with a pull to the formula,
  gravity fading in as the pull faded out. Neither one thing nor the other: half way it was
  the formula with a limp, at the top chaos with no pulse. Weight that is always there, and a
  push, is a thing you can picture.
- The voices are plain Web Audio nodes: a sine with a falling pitch, one partial over it, a
  click of noise. Low for the first joint and higher down the chain, the tock a fourth under
  the tick, harder hits brighter. A short room, a compressor.
- `__pendulum.sound()?.stats` in the dev console: how many hits went out, how far ahead.
  `__pendulum.energy()`: what should stay put with push at 0.

## Next

Ratios that are not whole (a bar that never quite repeats), easing the swing's shape, pulling
an arm aside by hand (with weight it can just be let go), and a push that is a kick at the
crossing, like a clock's, instead of a steady hand.
