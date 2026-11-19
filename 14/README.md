# 14 / Tension

2026-11-14

One string, the whole height of the screen, taut in the dark. Take it anywhere: where along it
you take it is the pitch, on the scale. Pull it aside and let go, and it sounds, played live in the browser by
modal synthesis, and draws its own vibration. Dots stand on both sides of it, set in four
groups, each group a chord: drag the string through them and it catches on every dot and slips
off it with that dot's note, a broken chord like a harp. Slide a finger along a ringing string
and its pitch goes with it, gliding from note to note of the scale, with soft flageolets
ringing out at the nodes. More
fingers are more players: pluck with one while another holds, and both ring.

```sh
pnpm -C 14 dev                       # https://localhost:5114, so a phone on the LAN gets AudioWorklet; NOHMR=1 while playing on one
```

## How it plays

- **Where along it is the pitch, always a note of the scale.** Low at the bottom (an octave under
  the string's key: A0 on Tension and Doom, A1 on Wood and Square, A2 on Glass), four octaves
  up at the top, no frets you can see, but every pluck, strike and strum lands on the note of
  the scale nearest the finger: whatever you do, it's in tune. Marked like a fretless neck: a faint dot
  at every note of the scale, a tick at every octave, and the one the finger reaches lights up.
  The lowest note sits just over the bar, so a finger on the string is never on a button.
- **Pull it aside and let go**: a pluck. How far is how hard, and harder is brighter, with more
  partials, not only louder: pulled from far, half as loud again and ringing half as long again
  as a pull by the string. The string follows the finger all the way to the edge. Moving up
  or down while you hold it glides the pitch (magnetic, below), flageolets at the nodes.
  A quick tap strikes it.
- **Pull it back over** where it rests instead of letting go: a pluck right there, as hard as
  the pull was, and the finger keeps the string, pulled the other way now. Back and forth, a
  pluck at every crossing, and up or down while you hold it slides what rings; let go and it
  plucks once more (unless it's barely pulled, just past
  a crossing: then that one rings on). A sweep across it from off it is a strum, as hard as the
  sweep is fast.
- **Up or down the background**: a wah, a resonant peak swept by the finger's height (350 Hz at
  the bottom to 2.8 kHz at the top), the string a little under it; let go and it's gone. Across
  the string from the background, a strum.
- **A tap on the background** does nothing (it used to change the scale, then the string: both
  are in the bar).
- **The scale** (its picker in the bar, or S; Tension to start with): for every string at once: Tension (1 2 b3 5 b6), minor pentatonic, kumoi,
  major pentatonic, aeolian, hijaz, April (after Aphex Twin's Avril 14th: natural minor like
  aeolian, but its dots are the piece's chords, all minor, i, iv, v, and a VI). The dots glide to their new chords.
- **Before the first pluck** the string sways a little and a ring pulses on it, as if a finger
  were testing it: an invitation. Gone with the first note.
- **A finger on the string makes no sound by itself**: it waits to see which way it goes. Aside
  it's a pull, nowhere (a tap) a strike, along the string a slide. Held still on it for a
  quarter of a second, it's a hand laid on the string: what rings stops (the string, the dots'
  notes, the sympathetic strings, the flageolets), and the lift makes no sound.
- **Slide along it**: no frets, no sound of its own; what still rings goes along with it, and
  soft flageolets ring at the nodes (below).
  Then go aside and it takes the string there: a pull, let go and it plucks.
- **A mouse moving over the string without a click** plucks it at each crossing, as hard as it
  was fast: a slow drift a soft touch, a flick a hard pluck (once the sound is up: a browser
  wants one click first).
- **With a mouse** the same, one hand: no second finger, but a drag along a ringing string is
  the slide.
- **P**: the pad on or off. **A**: the arp (the groove), each press the next pattern (Pulse, Drift,
  Cascade, Ostinato), then off; while it's on, the wire plays along with you (see below).
- **S**: the next scale. **Shift and a digit** (0 to 9) saves a snapshot of everything the bar
  sets (the string, the scale, the delay, the arp, the four levels) under it; **the digit
  alone** brings it back, its name in the middle for a moment. Remembered per viewer.
- **Cmd+C** (ctrl+C; when no text is selected) copies the same settings as JSON to the
  clipboard; **cmd+P** (or a plain paste, cmd+V) applies JSON settings from it: the string, the
  scale, the arp, the five levels; anything missing stays as it is.
- **No sound?** Browsers keep it locked until a tap they accept. If a gesture didn't open it
  (or iOS locked it again after a call), a *Tap for sound* button comes up; one tap and it plays.

## The bar

As on day 07: icons in a frosted pill, nothing written. Three pickers show only their current
choice: the string (an icon each), the scale (a clock of the twelve semitones, its notes lit)
and the arp, the groove (its sixteen steps as bars, accents tall, ghosts short). Press one and the
choices stack up over it, the name beside the one under your finger: slide up to one and let
go, or tap and tap one. (The coin and the rattle, latched modifiers for a step up and a
choked buzz, are gone: one less thing to wonder about.)

Beside the bar, a button of its own, Mix (three faders): tap it and five sliders open over it,
one under the other, a name on the left and the number on the right: sustain, reverb, the pad
(a whisper to start with), the harmonics (the flageolets' level: none at the bottom, their own in
the middle, twice at the top) and the delay (the string's own echo in the arp's time, dotted
eighths at 90 BPM bouncing left and right, more of the string going in and more feeding back
the higher it is; half way to start with; the arp keeps its own echo, untouched; D steps it
off, light, medium, deep). Press anywhere on one and it goes there and follows the finger; tap
Mix again, or anywhere else, and they close. All five are remembered.

On a phone every button in the bar has its name written over it, outside the bar (String,
Scale, Arp, Mix), gone while its popover is up; with a mouse the names are hover tips. (The levels were knobs first, then labelled sliders
over the bar, then upright faders in it, then four Hollow-style knobs with tall gauges: one
button that opens them all keeps the bar short.)

On a wide screen with a mouse the bar sits bottom right, out of the string's way; on a phone
it's bottom centre. The string is always in the middle.

When the page goes away (another app, the lock screen, a hidden tab, the window losing focus,
on a desktop too) the sound stops at once and the audio is paused; back, it comes up again softly
(on iOS a tap may be needed first: the start button).

- **Sustain** is a factor on how long every string rings, the dots, the groove and the
  sympathetic strings with it (and the drawn vibration, which uses the same decays): a quarter
  at the bottom, the string's own in the middle, four times at the top.
- **Reverb** is the room's level (none at the bottom, the preset's own in the middle, two and a
  half times at the top) and its length (half to one and a half times the preset's). A new
  length is made once the knob rests a quarter of a second, and crossfaded in.

## The dots

They show only while the string is held aside (in quickly, out slowly after you let go): the
dark stays empty until you play. Like constellations: six chords (the four, and a iv and a VII or so where the scale has them),
every dot at its note's height, but scattered sideways like stars, near to far, left and right
in turn, faintly joined chord by chord (the same scatter for the same chord and note, so they
don't jump). On a wide screen they stay within reach of a pull, not out at the edges. When the
string catches on a dot the light answers: a faint touch as it catches, a bright swell out from
the dot's height as it slips off.

Four chords of the scale, two on each side of the string, built on the note the finger is at
(the nearest note of the scale): its own chord close on the left, a VI (or a iv) over it close
on the right, a v further out on the left, a III further out on the right, whichever the scale
has; what would go past the top comes down an octave. Take the string somewhere else, or slide
or move up and down while you hold it, and the dots glide to the chords of that note (they sat
still for a while, on the key; moving felt more alive). Before the first touch they sit on the
key. And where the finger holds the string colours them a little: at each note of the scale, a
different tone of every chord, never its root, moves a step of the scale (up, else down, else
two up), the first that rubs a semitone against none of the others in any octave: a sus, an
add9, a seventh. Every dot sits at the height of its note on the string, so a chord is a column of
dots. Each chord is an open voicing: root, a perfect fifth (or a fourth where the scale has no
fifth there, never the tritone), the octave, a third (major or minor, whichever the scale has;
else a sus fourth or second) and a ninth on top, and nothing that would rub a semitone against
another tone. On A in hijaz, the default, that's A major, an F with a sus fourth and a ninth,
an E with a sus fourth and a seventh, and a C sharp.

Pull the string aside through a column and it catches on each dot, bends round it for ten
pixels and slips off with that dot's note, as hard as the string was moving: a broken chord,
rolling out from the height of your finger, since that's where the string is pulled furthest.
Pull further and it goes on into the far chord: a change of chord in one gesture. Coming back,
the string lets go of the dots it passed without a sound. The dots' notes are voices of their
own: they ring on together under the string's next pluck.

(Tried first: the chords fixed on the key. Rooting them on the finger makes every height its
own little progression.)

## More fingers

While one finger is down (on the string, or sweeping), every other finger is a player of its
own, as many as the screen takes:

- **Aside and let go**: a pluck at its height, as hard as it was pulled; **back over the
  string**: a pluck right there, every crossing; **a tap**: a strike. Each note is a voice of its
  own (the dots' kind), so it rings on with the others and with what the first finger plays:
  hold one note, pluck another, a chord with two hands. A ring shows where each finger is, a
  thread to the string while it pulls.
- **Along the string**: the slide (below), if no other finger is sliding.

(The second finger used to bend what rang, up to the next note of the scale. Playing more notes
is more fun than bending one.)

## The slide, and its flageolets

A finger along the string makes no sound of its own: one finger along it, a second finger
along it, a pull moved up or down. If the string is still ringing, that goes along with it (a
spring of a few tens of milliseconds), and the dots' notes let go softly (they'd leave the
scale). No pluck at the touch.

The slide is magnetic: no steps, but between two notes of the scale it clings to the nearer one
(t⁴ against (1-t)⁴) and crosses over in the middle, quickly, a glissando from note to note. Where
the finger rests (140 ms still) or lifts, it settles right on the nearest note in 70 ms. (Before: truly fretless, every height its own
pitch, and a pluck landed wherever the finger was: 45.58, a quarter tone off, against a pad and
dots on the scale. It sounded out of tune whatever the instrument.)

Where the finger passes a node of the string (1/2, 1/3, 2/3, 1/4, 3/4, 1/5 … of the way), a
flageolet, soft, the way a guitar's rings when a finger rests lightly over the twelfth fret: that
harmonic (the octave, the twelfth, two octaves, two octaves and a third) of what rings, or of the
nearest note of the scale when nothing does. Tempered, not pure: the interval rounded to whole
semitones (a pure fifth harmonic is 14 cents flat of the pad's third, and beat against it). Near a sine with a breath of
its own octave, a soft touch to start (14 ms) and a long, quiet ring (10 s, a little shorter up
high, longer with more sustain), a seventh to a fifteenth as loud as a pluck, and deep in the room: a
send of their own (the worklet's third output), three and a half times the string's. A quick
sweep runs down them like a harp's and they hang there, a cloud of the chord. A small light follows the finger on the string and flares at each node.

(Before: a bottleneck, a sustained voice made from the string's partials that sang while the
finger moved, with a scrape of glass on wire. It droned; the harmonics alone are prettier.
Before that: a wet finger round a glass, a soft sine following the nearest node. Pretty, but it
didn't touch what rang.)

## Elastic

The pitch is rubbery. Let go and the string starts sharp (up to about a semitone on a hard
pull) and springs back to the note in a fifth of a second, then wobbles around it a little
(5 Hz, dying out). `Elastic` in the settings scales it, 0 is a stiff wire.

## Presets

- **Tension**: a long low steel wire (A1) in a big dark wooden room, a sad
  pentatonic (1 2 b3 5 b6), sympathetic strings, a dark saw pad following the note.
- **Glass**: luminous. Bell partials (not harmonic, every one a consonant interval), high,
  an airy triangle pad and a long bright hall.
- **Wood**, the default: warm gut plucked with a finger, a round body (140 and 320 Hz), a small room.
- **Square**: synthetic. A square wave, odd harmonics only, the same wherever along the string
  it's taken, two copies wide apart (9 cents) and a sine an octave under. How hard you pull is
  the filter: a soft pull is round and closed, a hard one opens up to 7 kHz. A2, a mid room.

- **Doom**: a low guitar (A1) through a fuzz driven into a near square, oversampled, and a big
  closed cabinet (off above 3 kHz and under 60 Hz, a hump at 110 Hz). The fuzz holds every note
  long after it'd have died, a cathedral of a room (8 s), a low saw pad on the tonic, a drone.
  Only the string goes through the fuzz, not the pad or the room. Pull hard and let it ring.

(Jawari and Vast are gone: the buzz and the half-minute wire were too much next to the rest.)

## One key, one scale

Every string is in A (A1, A2 or A3) and they all share the one scale the S button picks. So a
string can change while the pad, the groove and the tails ring and nothing lands out of tune:
the groove's memory moves to the new string's octave, the pad re-voices, and every groove note
is snapped to the scale on its way out. A new scale snaps what the groove remembers into it,
re-voices the pad, lets what still rings in the old one go over half a second, and dips the
echoes out until they've passed.

## The sound

An AudioWorklet runs damped sine partials, each a complex rotator (exact frequency and decay,
two multiplies and two adds a sample), up to 64 of them, in stereo:

- a pluck at position p is a triangle let go, so the bridge hears `sin(kπp)/k`; a strike is a
  speed given, `sin(kπp)`; the pull's force tilts the whole spectrum and moves where a
  finger's width rolls the top off (from ~600 Hz on a soft pull to ~5 kHz on a hard one);
- each partial dies at `σ = σ0 + c·f²` (the classic string losses); the wires are a little
  stiff (`f_k = k f0 √(1 + B k²)`), so the partials shimmer;
- every voice runs twice, a few cents apart, one copy left and one right: a slow beating and a
  wide stereo string;
- the upper partials come in a few tens of milliseconds after the lower ones, so the attack
  blooms instead of snapping (slower on a soft pull);
- a sine an octave under the note, dying faster: the sub;
- the buzz is the wire hitting something: whatever swings past a gap is clipped off, band
  passed and added back, so it buzzes only while the swing is wide;
- sympathetic strings are worked out, not simulated: every string tuned to the scale that
  shares a partial with the note swells in slowly and rings on, quietly.

Then a body (two low peaks, around 100 and 200 Hz), a warm low pass, a room made on the fly
(early reflections, then a long tail of noise darkening as it dies; each preset has its own
length, crossfaded when you change), and the pad.

The pad, in two layers through a slow breathing low pass and a phaser (six all-passes swept
once every eight seconds or so, mixed back with the dry pad: notches wandering through it). The bass: the key's root, an octave
under the colour (A2 mostly, never under E2, what a phone can still play), two saws (or
triangles) a few cents apart, left and right, there as long as the pad is on, whatever you
play. Over it the colour: three voices on the note played, an open voicing in the scale (a fifth
or a fourth, never a tritone, the octave, up top a ninth, third or fourth, never a minor ninth).
They float in with each note (a note has to stay the last one for 0.35 s), hold 1.5 s after the
last one and fade out; a new note crossfades them, a second set coming in on its chord as the
first fades, nothing slides. A pull swells it all a little. (Before: the whole chord followed
every note and glided there, a vibrato's wobble, and all of it faded when you stopped.) Half way
up its knob the colour sits 15 to 18 dB under a medium pluck, the bass a little under that.

## The groove

With Arp on, every note you play (a pluck or a strike, still sounding at once as always) goes
into a short memory of the last six, and the wire keeps playing a rhythmic pattern over them,
by itself, at 90 BPM, following you: each pluck is a beat, the grid shifts so a beat falls right
on it and the groove carries on from the sixteenth after (before, it kept its own grid and
often answered a few ms after your pluck, which made the pluck feel late). It plays the
memory, the newest note's octave and fifth, and the pad's voicing brought down into the wire's
register. Your notes go into the memory and set the beat; they're never moved in time.

The patterns are sixteen sixteenths of accents, plain notes, ghosts and rests, each with which
note to play where (the newest, its octave or fifth, the lowest, the highest, a walk up or
down):

- **Pulse**: 3-3-2, accents on 1, the "and" of 1 and 2; ghosts in between, walking up.
- **Drift**: sparse and spacious: a note, a long breath, an answer a fifth up, a far ghost.
- **Cascade**: falling sixteenths with holes in them.
- **Ostinato**: a low figure going round in 3-3-2, the newest and highest notes over it.

The newest note is the one it answers with (a little louder too), and an accent now and then
jumps an octave. Light swing on the off sixteenths, a little looseness in time and touch.
How hard you last played sets how busy (ghosts only when it's hard) and how loud it is. Stop
playing and it holds two seconds, then thins out and fades over nine; play again and it comes
back in on the next beat. Its notes ring over each other into the pad, and only they go into a
dotted-eighth delay (bouncing left and right, low passed, a quarter fed back). They are
scheduled a little ahead on the audio clock, they ripple the drawn wire lightly (your own
plucks stay readable), and they have a cap of their own: eight sounding, the quietest fading to
make room.

It started as an arpeggio played while you held the wire pulled. That made holding the wire
mean two things; a groove that answers what you play is more fun, and plucking stays plucking.

## Pärlemor

The sound, drawn as mother of pearl, filling the dark behind the string: a WebGL layer under the
drawing. The layers of a shell's inside, thin bright growth lines with dark between, following
the contours of a slow, warped field, mirrored either side of the string, drawn as their
contour lines, not too many of them: half a rendered pixel wide wherever they are,
antialiased, drawn at up to two and a half pixels per CSS pixel, so on a phone a fifth of a CSS
pixel (the shader's derivatives keep the width;
without them, softer lines), a little wider where the sound passes, fading where they crowd closer than
a few pixels. Black and white, like everything (one near-black ground for every scale, every string's glow
the same light grey, the glass greys neutral): a light grey on the dark, each layer a little lighter or deeper
by its thickness. (It was a thin-film rainbow first, then one colour per scale: the lines alone
read best.)

Time and rhythm move it up and down: the layers drift slowly upward, and on every beat they
give a small vertical kick and a little light that settles, on the arp's beat (your plucks'
grid) when it plays, a quieter 90 BPM when it doesn't. Kept dim: grey lines, never bold white.

`Pärlemor detail` in the settings (or `?viz=soft`) blends the lines into a soft, almost-gradient
shading of the film; the lines are the default. Both are soft and dark: a glow in the dark, not
a light show.

What moves it is what comes out: an analyser reads the output's spectrum, laid along the string
the way the pitch is (every height is a pitch, so a note lights its own height and its
overtones the heights of theirs), and kept as a history, a new column every frame at the string,
the older ones further out. So the sound goes out from the string as light: the film thickens
where it passes, the layers curl into rings round a note's height and its overtones, ripples run
outward, the whole shell lifts with the level (quickly up, slowly down), and the string's own
swing bends the layers next to it. Silence leaves a faint, slow sheen. Without sound to listen
to (before the first tap, or a headless page making a clip) it takes the spectrum the drawing
knows the note should have. It's rendered at three quarters of the screen's pixels: it's soft
anyway. `Pärlemor (nacre)` in the settings scales it.

(Tried first: wavefronts drawn as lines, copies of the string travelling out with the spectrum
bulging them. Readable, but thin; the shell fills the space.)

The drawing uses the same modes, decays and pluck point as the sound: at the moment of release
the sum of the modes is exactly the pulled shape (its Fourier series), then each mode turns at
a few hertz instead of a few hundred. Around it, a faint blur as wide as the swing: what an eye
actually sees of a real wire.

## Always sounding good

- every pluck, strike and strum takes the nearest note of the scale; a slide is magnetic and
  settles on one, a flageolet is a harmonic of one. Everything
  around it is on the scale too: the dots, the pad and the groove
  (they take the nearest note of the scale), the sympathetic strings; the rubbery pitch
  (Elastic, Pitch glide) is at half what it was, so a note is on its pitch sooner;
- one wire: a new pluck stops the last one (in 40 ms, never with a click); every other kind of
  voice has a cap and the quietest fades out to make room;
- every voice comes in over at least 1.5 ms and leaves on a ramp; no partial above 7 kHz;
- the master: a high pass at 24 Hz, the body, the low pass, the room, a little drive into
  tanh, a shelf off the top, a compressor and a limiter.

`await __tension.offline()` in the dev console renders ten busy seconds of every preset offline
(every modifier, the pad on, the groove fed by every pluck, a different pattern per preset) and prints peaks, loudness and NaNs. With the defaults the peak
stays under −3 dB and the loudest 50 ms is around −9 to −11 dB. Forty hits a second with every
setting maxed gives no NaN and stays at full scale.

## What I tried, what I learned

- It started as a berimbau: a bow, a gourd on a cord, the gourd opening as a wah. Then one
  wire across the screen, pulled for the note; then one held by a finger like a fret. Then a
  rope from the ceiling, slack until one hand stretched it (the stretch the note) while the
  other played it, with chords by where you plucked and pegs the swung rope snagged on. Lovely
  to look at, but two hands for every note. Back to one string top to bottom, where a single finger does it all,
  with the pegs turned into chords and the second hand free to bend and to slide.
- Sympathetic strings as a bank of resonators fed by the wire, first. Physically right and
  useless: a resonator that rings for nine seconds is a quarter of a hertz wide, and the wire's
  pitch glide alone is wider, so they never woke up. Deciding which strings would answer, and
  plucking them softly with a slow swell, is cheap and always in tune.
- Dropping the roots an octave made it deep and also dull: a `1/k` spectrum from 55 Hz has
  almost nothing above 1 kHz. Making force tilt the spectrum (soft below `1/k`, hard well
  above it) brought it back and made a pull expressive. Measured on a pluck of Tension:
  centroid 111 Hz soft, 130 medium, 253 hard; 1 to 5 kHz energy 0.1 %, 0.6 %, 5 %.
- Offline renders of messages sent to a worklet are racy: a few came in late and made a
  sympathetic string look silent. Checking how many voices were live caught it.

Settings (the gear, only with `?settings`, in dev too): volume, buzz,
sympathetic strings, pitch glide, body, sub, chorus, bloom, pad level and the speed of
the drawn vibration. `?auto` plays it by itself (a virtual finger takes the string at a height and pulls it, now and then far through a chord of dots: for clips), `?preset=glass` starts on a
preset, `?scale=tension` on a scale, `?clean` hides the furniture.
