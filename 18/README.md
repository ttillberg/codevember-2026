# 18 / Pendulum

2026-11-18

A pendulum as a drum machine, drawn in lines, black and white. (Or a colour a link, *Colour*
in the menu, `?colour` in a link: from a bluish purple down the chain to pink (it was
magenta, pink and neon green first, and loud; then magenta to pink, all one warmth); an arm and the joint at its end, its path, its rings
and its row in the panel are then all that colour. It was colour for a while, to tell the
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

- **Along the bottom**, two panels, dark frosted glass with a hairline round them that is all but not there, in the way of day 07's
  pills (a control with no border of its own, lit while it is on or held), everything in
  sections under their labels. (They were frosted glass like day 07's, lighter at the top;
  then one flat grey. Then black with an outline; frosted again once the chain had the
  whole page and swung behind them.)
  - **Instrument and mix**, one panel, a row each. Instrument: the four of them
    as pills side by side, the one that plays lit (tine, bones, square, TR-808), and its
    scale as a list, which shows only what is picked; pressed, the rest stand over it:
    press, slide and let go, or tap and tap. Under it Mix (volume, harmonics), Reverb (how much, the room's size,
    its damping), Delay, Distortion. Between the two, on one line, Notes and Pendulum mode
    (formula or physics).
  - **Tracks**, the other panel: the columns' names, a row a link
    with a hairline between, and *Add track* as the last row, on the rows' own columns: its plus in a ring the size
    of a knob, under the volume knobs (a row's remove is a minus in a ring too; it was
    `+ Arm`, a button in the middle under the rows). The row the pointer is on is a band of its colour from
    edge to edge of the panel.
  - The two stand side by side in the middle along the bottom, on the same line, a generous
    gap between them and the centre line running down the middle of it, the scene over
    them. The tracks' panel is only as tall as its rows (one track is a short panel, not a
    tall one with a hole in it); the instrument's grows to it when it is the taller, its
    rows spread out. The space under the last row of each is the space over its first label.
  - **An eye** in each panel's corner puts that panel away, down to its name in a pill, and
    brings it back: each on its own, remembered. With both away the chain has the page down
    to the foot. Where the window is not wide enough for both (and on a phone) the instrument's
    panel stands on the tracks'. (They were two pills over the tracks first, every track a
    pill of its own: seven pieces where two say the same. And for a moment a column up the
    left side with the chain the height of the page, swinging behind them: more chain, but
    the two side by side under it looked better.)
- **First, a card**, day 14's: a frosted square in the middle, headphones recommended. The
  chain swings behind it without a sound, since a browser plays nothing before a press; a
  click anywhere, or a key, takes the card away and starts the sound, and does nothing else.
  Every visit, since every visit starts silent. (It was "Tap for sound" in small caps under
  the title, easy to miss; that line is only for a sound the browser has put to sleep again.)
  `?nocard` in a link leaves it out.
- **The bar**, top right, another pill: play or pause, restart, sound, the tempo (a knob that
  is its number), and behind the `≡` a menu for what is set once: the timeline,
  colour, the tips (a switch each), save, save as, open, and Reset (a new piece from
  scratch: one arm swinging once a bar, everything else as it starts; what is saved is kept). Under the title on a phone.
  (Instrument, notes and mix were a panel of their own right over the pendulum, the tracks a
  workbench under it, and the rest a drawer down the right side: three places and three
  looks. Now the pendulum has the whole height over one panel.)
- **The timeline** (`T`, or its switch in the menu): beside each link's row, drawn to the
  screen's edge, its curve: what its joint crosses zero with, over the bar. In sum that is
  every arm above it added up, the partial sums of the series, each row one term more; in
  each it is the arm's own swing, row by row as its Σ says. A dot is a hit: where the curve
  crosses its line. With physics it is the bar behind as it went, wrapping at the playhead.
  Where there is no room beside the rows (a phone), one line under the chain instead. Put
  away to start with: the chain and its notes are the thing; `?timeline` in a link brings it.
- **A track**, a link's row in the panel, from the left: **solo** (only this track is heard,
  with any others soloed) and **mute** (silent whatever its volume; the arm still swings),
  its volume, Σ, then a knob with `×n` beside it for how many swings it makes in a bar, 1 to
  10 (the harmonic; it was a minus and a plus round the count, up to 16, at the front of the
  row), then how far it swings (0 to 180°), how long it is, and its phase: where in
  its swing it is when the bar starts (0° it crosses going right, 90° it is out at the right),
  how loud its joint's voice is (all the way down is muted, the arm still swings and still
  moves the ones under it, its row and its rings go dim), and its weight and its push, which
  count only with physics on.
  `✕` takes it away.
- **Add track** (or `+`, `-` takes the last one away): a new arm on the end, one harmonic up. It
  comes in at half volume: a new voice at full is a jolt, and it is easier turned up than down.
- **Σ**, in every row (`S` for all of them at once): what that joint crosses to sound. Lit, the
  sum: the centre line under the pivot, the Fourier picture. Not lit, each: the vertical under
  its own origin, its arm alone, an even pulse. Mixed, the low joints can keep time while the
  far ones play the sum. (It was one switch for the whole chain first.)
- **Restart** (`R`): the motion from the top, the setup as it is. The bar starts over, and with
  weight the chain is put back on the formula: the same chaos again, from the start.
- **Pause** (space), **Sound** (`M`), **Tempo**: four beats to the bar, so ×1 ticks on 1 and
  tocks on 3.
- **Pendulum mode**, formula or physics, in the instrument's panel. No key for it, and
  while physics is on its button is orange with a warning sign beside it (it drifts out of
  time, as its tip says):
  it changes everything, and should not be on by a slip of the finger or without being
  seen. (It was a switch in the menu with `W` for a key.) With the formula every arm goes exactly as it is set. With
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
- **Only the columns that do something** are in a row: an arm's sound when sounds go by arm,
  its weight and its push when the chain has physics. With the formula and by hit a row is the
  grip, the swings, Σ and four knobs.
- **Knobs**, everything that is an amount, as on day 07: press one and drag up, or to the
  right, to turn it up, and while it is held a tall gauge stands over it, filled as far as
  it is turned, its number at the foot (140 pixels is the whole way, the gauge's height, so
  the fill goes with the pointer). A click leaves the gauge open, to drag on; a press
  anywhere else puts it away. The knob itself is a ring and a hand, from seven o'clock round
  to five (the tempo's is its number), with three dots two pixels outside the ring: where
  its way starts, its middle, where it ends. The arrow keys step one that has the focus, ten steps
  with shift. A turned knob catches on its marks (the quarters of volume, weight, push and
  the mix, every 45° of swing and phase, every quarter of a length, the round tempos) and
  shift turns past them. (They were sliders, with a tick drawn at every mark: six of them an
  arm made a row 640 pixels wide, mostly track. Then knobs with their number said under the
  title while they turned, a long way from the hand.)
- **Tips** (in the menu, or the `?` key): what the control under the pointer does, in a card
  of its own over the panel that control is in, as wide as the panel; under the bar for the
  bar's, and beside the menu for its rows (under the title on a phone, where it shows for the control you
  press). Frosted like the card the page opens with: grey glass, no outline, a deep shadow;
  the control's name at that card's size, what it does under it, a little softer. On to
  start with, remembered. (It was a dark box with a border, its name in small caps.)
- **Keys**, wherever a control has one: drawn as keys, each cap in a fine outline with barely
  rounded corners, beside the control's name in its tip and beside its row in the menu
  (`⌘` `S`, `T`, `+` / `−`). The moves of the hand are there the same way, a line each:
  `Drag ↕` on its ring for an arm's length, `Drag ↔` for its swing, `⌘` `Drag ↕` for its
  volume, `Drag ↕` on the root for the key, `⇧` `Click` for the sound before, the digits
  for the ten presets. They were words at the end of a tip's sentence ("Key: S."),
  which nobody reads to the end of. The `≡` itself has no tip: it opens a list of things
  that each have their own.
- (The workbench was a block bottom right with everything in it, then a strip along the
  bottom with one long line of buttons and sliders under the rows. Then a row a link, and a drawer
  for the rest.)
- **Reorder**: drag a row by its grip, the dots at its left, up or down, and its link moves
  along the chain: where an arm hangs changes everything it adds up to. Its colour, its voice
  and its settings go with it (so the colours are no longer in order down the chain, and the
  low voice can be the last joint). With physics the chain starts again on the formula.
- **Which link is which**: rings round the root. The first arm's length out from where the
  chain hangs is the first link, the next arm's length beyond that the second, and so on:
  where the chain is has no say, so a link can be picked while it all moves, and the same
  place is always the same link. The pointer in a ring lights the ring, a soft bar round the
  arm, and its row in the panel, and only that link's path is drawn. The pointer on a row
  does the same the other way, but the ring is then only a light ground: on the chain it is
  filled as full as the link is loud, and from the row that fill sat over the chain for
  nothing, the knobs being right there. A click, or a finger, holds it lit until a click lands outside
  the rings. (First the arm itself had to be hit, then anywhere in the circle round where it
  hangs: both moved with the chain.)
- **The paths**: behind every joint a tail, the half of a bar it has just drawn (a quarter
  at first: gone before the eye had followed it),
  brightest where it has just been and gone by the end of that; the last joint's is the
  brightest. (They were whole closed curves at one brightness first: a picture, but not of
  anything moving. Then a whole bar's, fading: the picture again, only dimmer.)
- The chain hangs in the middle of the screen, the rows in the middle under it.
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
  octaves to the bottom (A5). It is not drawn: the centre line runs from the top of the page
  to the bottom with nothing marked on it, and where a joint is on it is heard. (There was a
  mark at every note of the scale and a longer one at every A: a ruler to read, in the
  middle of something to listen to.)
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
  row's knobs follow. An arm length is always the same stretch of the ruler (two of them
  are the whole of it), so a note stays where it is on the screen; only a chain too long for
  the ruler makes it all smaller.
- (First the four octaves were laid along the chain itself, however long it was: a longer arm
  moved every note, its own least of all. And low was at the far end, as a long string is
  low; but then the joint that keeps time was the squeak and the busy one the rumble.)
- **By hit or by arm** (Notes, in the instrument's pill, or `B`): what says which note, or which drum, a
  hit is. *By hit* is where the joint is when it hits: a joint far down the chain plays a
  different one each time, and the chain writes its own tune, or its own fill. *By arm* gives
  every arm one of its own, whatever it is doing, and then it has to be said which, in the
  arm's row, under *Sound*. On the drum machine and the bones that is a button: press it for
  the next of the eight sounds, shift for the one before; a new chain starts as a kit, bass
  drum, snare, closed hat, clap. On the tine and the square it is the note where the arm rests
  when the chain hangs straight, marked on the ruler: pull its ring longer or shorter. By arm
  is a drum kit played by a pendulum; by hit is the pendulum playing what it finds. And by
  arm, since every hit of an arm is the same sound, where it landed still counts for a
  little: each joint has a place it usually hits (the average of its last dozen or so), and
  a hit off that is softer, like a drum struck off its middle, down to a little over half as
  loud a third of an arm length away. Its ring is as much fainter. (On a
  phone there is no room in a row for the sound, and an arm keeps the one it has.)
  The drums (the machine and the bones) go by arm to start with: picking one switches to
  it, and going back to the tine or the square puts the notes back as they were. A drum that
  changes with where the joint happens to be is there to try, not to start from. And with
  the drums the list of scales is put away: there is no tune for it to set.
- **The scales** are day 14's, all on A: Tension (1 2 b3 5 b6, to start with), minor
  pentatonic, kumoi, major pentatonic, aeolian, hijaz. The list in the instrument's pill picks one (or
  `N` takes the next); `&scale=kumoi` in a link.
- **Four instruments**, picked from the list in the instrument's pill (or `I` for the next; `&instrument=bones`
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
  their names down the line say which (only then, by hit), so a joint can be put on the one that is wanted by
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
- **Volume, distortion, damping**, in the mix with the rest. Volume is the level of it all,
  80 where it was before there was a knob. Distortion is one soft clipper (tanh) on
  everything, before the room and the echo, so a fuzzed note still rings in a clean room; the
  curve never changes, the knob is how hard it is driven into it, from next to nothing (on the
  straight part: clean) to a fuzz, and what comes out is brought back to about the level it
  had. Damping is a low pass on what comes back from the room, 16 kHz open, 500 Hz at the
  top. One A3 on the tine, six strikes: peak 0.45 and RMS 0.136 clean, the same at 50, RMS up
  4 dB at 75 and 7 dB at 100 before the level at the top was brought down (not measured
  since); volume 40 is 0.36 of 80, 100 is 1.4 of it, and nothing clips. Not listened to: the
  curve of each knob is a guess until someone with ears turns it.
- First each link had a fixed note, the tock a fourth under the tick, a falling pitch and a
  partial that was no note at all (2.76 times it, a woodblock's): a drum kit. Then the note
  by position on one pentatonic, with the same drum voice: notes on paper, thuds to the ear.
- `__pendulum.sound()?.stats` in the dev console: how many hits went out, how far ahead.
  `__pendulum.energy()`: what should stay put with push at 0.

## Next

Ratios that are not whole (a bar that never quite repeats), easing the swing's shape, pulling
an arm aside by hand (with weight it can just be let go), and a push that is a kick at the
crossing, like a clock's, instead of a steady hand.
