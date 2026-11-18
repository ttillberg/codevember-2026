# 18 / Pendulum

2026-11-18

A pendulum as a drum machine, drawn in lines, a colour a link: magenta, pink, neon green, and
the same three again down the chain, deeper, paler, yellower. An arm and the joint at its end,
its path, its rings, its row in the bar and its row in the workbench are all that colour. Take it down to one arm swinging once a bar: a
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

- **The workbench**, along the bottom: a row a link on the left, and beside each row, drawn to
  the right edge, **its curve**: what its joint crosses zero with, over the bar. In sum that
  is every arm above it added up, the partial sums of the series, each row one term more; in
  each it is the arm's own swing, row by row as its Σ says. A dot is a hit: where the curve crosses its line. With
  physics it is the bar behind as it went, wrapping at the playhead. Under the rows, one line
  of everything else. (On a phone there is no room beside the rows: no curves.) In a row: `− ×n +` is how many swings it makes in a bar
  (the harmonic), then how far it swings (0 to 180°), how long it is, and its phase: where in
  its swing it is when the bar starts (0° it crosses going right, 90° it is out at the right),
  how loud its joint's voice is (all the way down is muted, the arm still swings and still
  moves the ones under it, its row and its rings go dim), and its weight, which counts only
  with physics on.
  `✕` takes it away.
- **+ Arm** (or `+`, `-` takes the last one away): a new arm on the end, one harmonic up.
- **Σ**, in every row (`S` for all of them at once): what that joint crosses to sound. Lit, the
  sum: the centre line under the pivot, the Fourier picture. Not lit, each: the vertical under
  its own origin, its arm alone, an even pulse. Mixed, the low joints can keep time while the
  far ones play the sum. (It was one switch for the whole chain first.)
- **Restart** (`R`): the motion from the top, the setup as it is. The bar starts over, and with
  weight the chain is put back on the formula: the same chaos again, from the start.
- **Pause** (space), **Sound** (`M`), **Tempo**: four beats to the bar, so ×1 ticks on 1 and
  tocks on 3.
- **Formula / Physics** (`W`): with the formula every arm goes exactly as it is set. With
  physics every arm is a real swing hung in the swing above. Its **weight** is how hard it
  pulls on what it hangs from, and the joint is drawn as big as that. At the bottom the link
  rides the arm above and is shaken by it, and the arm above never knows: with every weight
  down, the first arm does its own swing undisturbed. At the top the link weighs as much as
  the arm it hangs from, and throws it about: with every weight up it is the real chain of
  equal weights, and a short first arm gets thrown over the top.
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
- **The bar**, one line right under the chain, only where the rows have no curves beside
  them (a phone, `?clean`): a tick a hit in its link's colour, up for tick and down for tock,
  as tall as it is hard; hits that fall together stand on each other. (It was a row a joint
  along the bottom, then this line everywhere; beside the curves it said the same thing
  twice.)
- The chain takes the middle of what is over the workbench. (The workbench was a block
  bottom right first, the chain beside it; along the bottom, the rows have their curves and
  the chain has the width.)
- `?arms=1-34-1,2-52-0.62-90-50-30` is a pattern in a link (swings, swing in degrees, length,
  and if any the phase in degrees, the volume and the weight in percent; `&bpm=`,
  `&mode=each`, `&physics=1`, `&push=0.4`; a seventh value in an arm, 1 or 0, is each or sum for
  that arm alone). Without it, the last pattern is remembered; a
  pattern opened from a link is a visit and never writes over it (a preset or a name keeps it).
  `?clean` hides the furniture.

## How it works

- Under it all, only trigonometry: an arm's angle is `swing · sin(2π n φ)`, φ the bar. So the
  future is known, and the hits are not found by watching frames: a scheduler steps a little
  ahead of now, bisects every zero crossing and starts it on the audio clock. The rhythm is as
  tight as the formula whatever the frame rate. (It looks ahead further than the output's own
  latency, bluetooth too: a hit that has to start in the past lands on the scheduler's tick.)
- The weight (`physics.ts`) is a pendulum of n arms, a point mass at every joint, solved for
  the angles' accelerations (an n by n system a step) and stepped with RK4, 4096 steps a bar.
  Three things are not as in nature. Each arm has a gravity of its own, set so that alone it
  swings its ×n a bar whatever its length: its own rhythm. At each joint a motor gives the
  push, `(θ'* − θ') ω / Q`: the formula's speed against the arm's own, so on the formula it is
  nothing, and the formula's motion is what every swing does by itself. And the weights are
  one-sided: a joint weighs 1 to its own arm and its weight (0 to 1) to the arms above. In
  nature a chain of equal weights swings the same whether they are grams or kilos, so "no
  weight" means nothing there; here it means a link that takes and does not give.
- One-sided forces can feed an arm for ever, so the air goes thick past a speed no swing
  gets to by itself (three times its own rate; let go from the very top it passes the bottom
  at twice). Nothing runs away, and if it ever came apart it would start again on the formula.
- It runs in bars, not seconds, so tempo only says how fast a bar goes by. And it runs ahead
  of what is seen, as far as the formula's crossings are looked up, so the hits are still
  known before they are heard; the drawing reads the kept states behind it.
- Checked, four arms (×1, ×2, ×2, ×4), the first set to swing 23°: with every weight down
  and push 100 it swings 23°; with every weight up, 92° (and with every weight up and nothing
  pushing, a calm chain keeps its energy to six digits over 16 bars: that one is real). Push
  40 and weights 1, 0.5, 0.25, 0.12: 82°, and the bar repeats. With nothing pushing, 128 bars
  of any weights stay finite, the arms going round and round at the speed the air allows; so
  do eight arms at ×16 swinging 180°.
- Weight was first the real thing, a mass a joint, only their ratios counting. Honest, and
  not what a knob called weight should do: all the way down on every arm was the same as all
  the way up.
- Tried first: one knob that blended the physical acceleration with a pull to the formula,
  gravity fading in as the pull faded out. Neither one thing nor the other: half way it was
  the formula with a limp, at the top chaos with no pulse. Weight that is always there, and a
  push, is a thing you can picture.
- It was black and white, lines only. The colour is not decoration: with five arms, which row
  is which joint was a count from the top every time.
- The voices are plain Web Audio nodes: a sine with a falling pitch, one partial over it, a
  click of noise. Low for the first joint and higher down the chain, the tock a fourth under
  the tick, harder hits brighter. A short room, a compressor.
- `__pendulum.sound()?.stats` in the dev console: how many hits went out, how far ahead.
  `__pendulum.energy()`: what should stay put with push at 0.

## Next

Ratios that are not whole (a bar that never quite repeats), easing the swing's shape, pulling
an arm aside by hand (with weight it can just be let go), and a push that is a kick at the
crossing, like a clock's, instead of a steady hand.
