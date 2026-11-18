# 18 / Pendulum

2026-11-18

A pendulum as a drum machine, drawn in lines, black and white. (Or a colour a link, *Colour*
in the drawer's View, `?colour` in a link: magenta, pink, neon green, and the same three again
down the chain, deeper, paler, yellower; an arm and the joint at its end, its path, its rings
and its row in the workbench are then all that colour. It was colour for a while, to tell the
rows apart; pointing at a link does that now.) Take it down to one arm swinging once a bar: a
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

- **The drawer**, right, behind the `≡` top right: everything that is not a link's own, a
  section each. *Transport*: play and pause, restart, tempo. *Motion*: formula or physics.
  *Notes*: the scale, sound on or off. *Mix*: reverb, room, delay, harmonics. *View*: the
  timeline. *Setups*: save, save as, open. Open to start with where there is room. On a phone
  it lies over the scene, shut until asked for. Remembered.
- **The timeline** (`T`, or its button in the drawer): beside each link's row, drawn to the
  drawer's edge, its curve: what its joint crosses zero with, over the bar. In sum that is
  every arm above it added up, the partial sums of the series, each row one term more; in
  each it is the arm's own swing, row by row as its Σ says. A dot is a hit: where the curve
  crosses its line. With physics it is the bar behind as it went, wrapping at the playhead.
  Where there is no room beside the rows (a phone), one line under the chain instead. Put
  away to start with: the chain and its notes are the thing; `?timeline` in a link brings it.
- **The workbench**, along the bottom, in the middle under the chain: a row a link, and
  `+ Arm` under them. In a row: `− ×n +` is how many swings it makes in a bar
  (the harmonic), then how far it swings (0 to 180°), how long it is, and its phase: where in
  its swing it is when the bar starts (0° it crosses going right, 90° it is out at the right),
  how loud its joint's voice is (all the way down is muted, the arm still swings and still
  moves the ones under it, its row and its rings go dim), and its weight and its push, which
  count only with physics on.
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
- **Push**, in every row: what keeps that swing going, the force you give a swing: a push
  along the way it should be moving, in its own rhythm, and the air against the way it is.
  Nothing holds it in place. High and it keeps its time whatever the others do; around the
  middle the bar still comes round, bent by the weight; lower and it drifts; at 0 it is let go. So the
  first arm can keep strict time while the far ones run loose. (It was one knob for the whole
  chain first.)
  The push never kicks in at one place: it is a steady hand, at every moment as hard as the
  arm's speed is off the formula's, and nothing at all when the swing is on its own time. So
  it is drawn: an arrow at each joint, along the way its motor pushes right now, as long as
  the push is hard. Watch a first arm with heavy links under it: the arrow points one way
  through half its swing, then the other.
- **Presets**: shift and a digit (0 to 9) keeps the whole setup under it (the arms, sum or
  each, tempo, weight, push); the digit alone brings it back, the motion going on where the bar
  is. A word under the title says which. 0 is the default until something is saved over it.
  Remembered per viewer.
- **Saved by name** (ctrl where there is no cmd): **cmd+shift+S** asks for a name and saves the
  setup under it, offering the last name with the next number (groove, groove 2, groove 3);
  **cmd+S** saves over the name it has (and asks for one the first time); **cmd+O** lists
  everything saved, the newest first: arrows and enter, or a click, opens one, `✕` deletes it.
  Remembered per viewer, beside the digits' presets.
- **Snap**: a slider being dragged catches on its marks, the ticks drawn on it: the quarters
  of volume, weight and push, every 45° of swing and phase, every quarter of a length, the
  round tempos. Shift slides past them, and so do the arrow keys.
- **Tips** (the `?` top right, or the `?` key): what the control under the pointer does, in a
  box of its own over the workbench (under the title on a phone, where it shows for the
  control you press). On to start with, remembered.
- (The workbench was a block bottom right with everything in it, then a strip along the
  bottom with one long line of buttons and sliders under the rows. A row a link and a drawer
  for the rest is two things that each do one.)
- **Reorder**: drag a row by its grip, the dots at its left, up or down, and its link moves
  along the chain: where an arm hangs changes everything it adds up to. Its colour, its voice
  and its settings go with it (so the colours are no longer in order down the chain, and the
  low voice can be the last joint). With physics the chain starts again on the formula.
- **Which link is which**: rings round the root. The first arm's length out from where the
  chain hangs is the first link, the next arm's length beyond that the second, and so on:
  where the chain is has no say, so a link can be picked while it all moves, and the same
  place is always the same link. The pointer in a ring lights the ring, a soft bar round the
  arm, and its row in the workbench, and only that link's path is drawn. The pointer on a row
  does the same the other way. A click, or a finger, holds it lit until a click lands outside
  the rings. (First the arm itself had to be hit, then anywhere in the circle round where it
  hangs: both moved with the chain.)
- **The paths**: behind every joint, the bar it has just drawn, in its colour, brightest where
  it has just been and gone by the time it is a bar old; the last joint's is the brightest.
  (They were whole closed curves at one brightness first: a picture, but not of anything
  moving.)
- The chain hangs in the middle of the screen, the rows in the middle under it, the drawer to
  one side.
- `?arms=1-34-1,2-52-0.62-90-50-30` is a pattern in a link (swings, swing in degrees, length,
  and if any the phase in degrees, the volume and the weight in percent; `&bpm=`,
  `&physics=1`, `&root=0.4` (where the root hangs, in arm lengths down the ruler), and `&mode=each`, `&push=0.5` for every arm that does not say; a seventh value
  in an arm, 1 or 0, is each or sum for that arm alone, an eighth its push in percent). Without it, the last pattern is remembered; a
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
  59 and weights 1, 0.5, 0.25, 0.12: 82°, and the bar repeats. With nothing pushing, 128 bars
  of any weights stay finite, the arms going round and round at the speed the air allows; so
  do eight arms at ×16 swinging 180°.
  Three arms (×1, ×2, ×3), pushed 100, 59 and 0: within 9°, 30° and 108° of the formula.
- The push knob is a curve, `4 · knob^3.47`, as one over the swing's Q: nothing at the
  bottom, 4 at the top, and 0.36 in the middle, about where a chain starts coming round every
  bar. (It was `4 · knob²` first, and that point sat at 30: most of the knob did nearly the
  same thing. Setups kept from then have their push moved to where it does the same.)
- Weight was first the real thing, a mass a joint, only their ratios counting. Honest, and
  not what a knob called weight should do: all the way down on every arm was the same as all
  the way up.
- Tried first: one knob that blended the physical acceleration with a pull to the formula,
  gravity fading in as the pull faded out. Neither one thing nor the other: half way it was
  the formula with a limp, at the top chaos with no pulse. Weight that is always there, and a
  push, is a thing you can picture.
- It was black and white, lines only. The colour is not decoration: with five arms, which row
  is which joint was a count from the top every time.
- **The note is where the joint is when it hits**, as on day 14's string. The notes are laid
  down a ruler that stands still on the screen, down the middle: low at the top (A1), four
  octaves to the bottom (A5), a mark at every note of the scale and a longer one at every A.
  The root hangs somewhere on it, and a joint plays the note at its own height on the screen
  when it hits, the nearest one of the scale, so whatever the chain does it is in tune. (It
  was how far the joint was from the root, whichever way: the same thing where it crosses
  the centre line under the root, but a joint on *each*, out to one side when it hits, or one
  thrown up over the root, played a note that was not where it was.) The bass is
  at the top: the first joint, the one that keeps time, is the low one. A first joint always
  crosses at the same place and plays one note; a joint far down the chain crosses at a
  different height each time, and plays a tune: on Tension the default's last joint goes C4
  F4 F4 B4 F4 F4 C4 E4 round the bar, over a first joint on E3.
- **Played by hand, on the chain itself.** *The root* is a handle: drag it up the ruler and
  the whole key goes down, down and it goes up; nothing else changes. *A link's ring*,
  dragged: down pulls its arm longer and up shorter (as far as the pointer goes), so its
  joint and all under it move down the ruler to higher notes; left and right is its swing,
  narrower and wider (three pixels a degree). With cmd held (ctrl where there is none), up
  and down is how loud the link is instead; and cmd with the up and down keys does the same
  for the link that is lit. The lit ring shows it: fuller the louder, never solid, all but
  clear when the link is muted. Whichever way a drag sets off, it keeps to. The
  row's sliders follow. An arm length is always the same stretch of the ruler (two of them
  are the whole of it), so a note stays where it is on the screen; only a chain too long for
  the ruler makes it all smaller.
- (First the four octaves were laid along the chain itself, however long it was: a longer arm
  moved every note, its own least of all. And low was at the far end, as a long string is
  low; but then the joint that keeps time was the squeak and the busy one the rumble.)
- **By hit or by arm** (Notes, in the drawer, or `B`): what says which note, or which drum, a
  hit is. *By hit* is where the joint is when it hits: a joint far down the chain plays a
  different one each time, and the chain writes its own tune, or its own fill. *By arm* gives
  every arm one of its own, whatever it is doing, and then it has to be said which, in the
  arm's row, under *Sound*. On the drum machine and the bones that is a button: press it for
  the next of the eight sounds, shift for the one before; a new chain starts as a kit, bass
  drum, snare, closed hat, clap. On the tine and the square it is the note where the arm rests
  when the chain hangs straight, marked on the ruler: pull its ring longer or shorter. By arm
  is a drum kit played by a pendulum; by hit is the pendulum playing what it finds. (On a
  phone there is no room in a row for the sound, and an arm keeps the one it has.)
- **The scales** are day 14's, all on A: Tension (1 2 b3 5 b6, to start with), minor
  pentatonic, kumoi, major pentatonic, aeolian, hijaz. The scale button in the workbench (or
  `N`) takes the next; `&scale=kumoi` in a link.
- **Four instruments**, picked right under the chain (or `I` for the next; `&instrument=bones`
  in a link). What differs is the thing struck.
  *Tine*: a kalimba's. A sine that rings on (a second for the lowest, a fifth of one for the
  highest), one pure overtone over it that dies sooner, a click. *Bones*: a drum, two
  bones knocked together, which is to say a soft rimshot, low: most of it a thud around a
  hundred hertz, a trace of tone over that (a few hundredths of a second, with what rings
  with it as on a rim, 1.59 and 2.3 times it, no notes), and a little dull wood in the strike. There is no tune in it: there are eight pairs of
  bones, eight sizes, taken like the drum machine's sounds, a pair a note down the ruler or a
  pair an arm; tick a little higher than tock, and what is left is the rhythm and how hard. (It was
  a note first, a triangle that died at once, a xylophone of bone; then a clack tuned to the
  note; then a sharp dry click, high and gone in 30 thousandths of a second. What was wanted
  was the two in the hand.) *Square*: electronic, as on day 14. Two square waves a few cents
  apart through a filter the hit opens and that closes again, a sine an octave under: harder
  is not louder so much as more open. *TR-808*: the drum
  machine, and different in kind: not one sound tuned to the note but a sound a note. Going
  down the ruler every note of the scale is the next of eight, round and round: bass drum,
  rimshot, snare, closed hat, clap, low tom, open hat, cowbell (BD RS SD CH CP LT OH CB), and
  the marks down the ruler say which, so a joint can be put on the one that is wanted by
  dragging the root or pulling an arm longer. Each is made the way the machine made it, near
  enough: a sine that falls for the drums, six squares that agree on nothing for the metal,
  noise through a band for the snare and the clap. On Tension the default plays a bass drum
  on its first joint and a snare on its second, and its last goes CP OH OH BD OH OH CP LT
  round the bar. Harmonics in the mix is, for each, how much there is over the note: the
  tine's overtone, the bones' knock, how far the square's filter opens, how much hiss and
  metal the machine has.
- The voices are plain Web Audio nodes. The pitch does not move, but for the tine's very
  lowest, which get a thump; the lowest notes of all have an octave over them for small
  speakers. A link's own, with its colour, is a small difference in each: which overtone
  rings, where the knock sits, how sharp the filter is. Tick and tock are the same note,
  heard on either side; harder hits are brighter. A short room, a compressor.
- Checked by ear's stand-in: single notes struck with the chain paused, and the loudest
  frequency coming out read off an analyser: 109.9 Hz for A2 (110), 219.7 for A3, 329.6 for
  E4, 439.5 for A4, 880.4 for A5. And every note of the default's bar is in the scale, on all
  six.
  Tine and square, A2 to A5 struck on each: the loudest frequency is the note asked for
  every time (within the 3 Hz the reading is good to), and they are within 3 dB of each
  other. The bones: a link's knock is the same wherever its joint is.
  The mix the same way, one A4 struck: its octave is at -98 dB with harmonics at 0, -54 in the
  middle, -50 at the top; 1.1 s after the strike there is nothing dry, -57 dB with delay at
  50 and -50 at 100, -46 dB with reverb at 50 and -37 at 100. Everything at the top and six
  strikes in a row peaks at half of full scale.
  The room: a burst of noise into it, and the level after: at size 0 it is gone in a second
  and what is left rings at a few frequencies (1.2, 1.3, 1.4, 2.7, 2.9 kHz, 18 dB over the
  rest); at size 100 it is still there after two, and nothing rings. The mix, read off the two
  branches: at 0 the note alone, at 50 the note 3 dB down, at 75 it 9 dB down, at 100 the
  room alone.
- First each link had a fixed note, the tock a fourth under the tick, a falling pitch and a
  partial that was no note at all (2.76 times it, a woodblock's): a drum kit. Then the note
  by position on one pentatonic, with the same drum voice: notes on paper, thuds to the ear.
- `__pendulum.sound()?.stats` in the dev console: how many hits went out, how far ahead.
  `__pendulum.energy()`: what should stay put with push at 0.

## Next

Ratios that are not whole (a bar that never quite repeats), easing the swing's shape, pulling
an arm aside by hand (with weight it can just be let go), and a push that is a kick at the
crossing, like a clock's, instead of a steady hand.
