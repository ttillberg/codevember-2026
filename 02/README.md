# 02 / Shatter

2026-11-02

A wall of frosted 8 mm glass, wider and taller than the view, with three targets taped on it. Shoot it as often as you like: every bullet is a hole and a web of cracks. Or make it tempered glass, and one hit turns all of it to dice. Then swipe: a shock, and everything that is loose blows out at once, while the rest stays standing.

```sh
pnpm -C 02 dev
```

- **Click / tap** the glass: a bullet, through every pane in its way, as many as you want. **Wheel**: zoom in on the cracks.
- **Swipe / drag** across the glass, or **Space**: the shock. Which way does not matter. Only what is broken goes.
- **Click / tap by a fresh bullet hole** (within 6 cm), once the bake is done: the bullet, and the shock with it. Once per spot: near a hole a shock has already had, a tap is only a bullet. The taped circle of a target is safe, shoot it at will; with a hole in it, it is a tap just around the circle that breaks.
- **Click / tap below the glass**, on the floor: the shock for all of it, like a swipe. Once for every new bullet: with no hole since the last shock, it is a shot at the floor.
- While glass falls, **hold** a press where it is for slow motion (Space too, when there is nothing to break). A thin bar at the bottom shows how far the worker is with the bake.
- As long as glass is standing, carry on, at once: more bullets, another swipe, while the last pieces are still in the air. With none left, a click is a new pane.
- **S**, or the camera button: the latest fall again, in slow motion, from the side. A bar at the bottom has play and pause (Space), a chart of the fall's contacts over time (floor in full, glass on glass lighter), a playhead to drag, and the speed (0.05× to 1×). **Esc** to leave.
- **T**, or the tape button, then a drag across the glass: a strip of tape along it, from edge to edge, on every pane. A click instead lays one straight across at that height. What is under tape stays with the pane as long as some of the pane stands; with none left, the strip comes down in one piece, glass and all.
- **C**, or the bolt button (also `?realtime`): the simulation live, not cached. The worker then steps the fall at the pace it is shown and each frame is drawn as it comes; nothing is worked out before the swipe. A fall too heavy for the machine runs slow instead of smooth, which is the point of comparing.
- **G**, or the glass button: classic glass, which cracks, or tempered, which goes to dice. A new pane either way.
- **R**: a new pane. **M**: sound.
- The pointer never moves the camera: it has a slow sway of its own (`Camera sway` in the workbench, down to none), and the wheel zooms.
- `?seed=7` pins the pane, `?clean` hides the furniture.
- The fall plays at the speed of life (`Fall speed` in the workbench, to slow it for good).
- `?debug` (or `#debug`): the workbench, a gear bottom right. Three folding sections, the scene (light, glass, pace), the cracks (from the next bullet) and the simulation (from the next break). Every value, and what is folded, is kept in localStorage; double click a name to put its value back.

## Two parts

**The cracks** (`src/cracks.ts`). The pane is a planar graph. A bullet starts twenty to thirty radial cracks at its impact; half of them die within centimetres, the others get a log-normal length, wander, kink and fork. Then tangential cracks hop from radial to radial, often near the hole and rarely far out, and a rim closes the hole. One rule keeps it all sound: a crack that meets another crack stops there, in a T. Nothing ever crosses, so the graph stays planar with no clean-up, and old cracks shield the glass behind them from new ones, as they do.

A crack that runs into something is there within a frame or two. One that runs out of energy in clear glass is as fast at first, then crawls: `time = (s / L)^4.5`. Those last centimetres are all the eye gets of the animation. A few tips give a little more a second or two later, with a tick.

Cracks are closed: there is no gap to see. What is drawn is the crack surface itself, a ribbon from the front of the glass to the back, slanted a little, different at every node. Light inside the glass that meets it is mirrored. Either it then leaves through a face, and the crack shows the room from somewhere else (nearly invisible, or a glint when that somewhere is a lamp), or it is sent along the pane beyond the critical angle and stays in the glass: that is the dark line. Only the bullet holes are open, cut out with a mask that also carries the crushed, white glass around them.

**The fall** (`src/shards.ts`, `src/sim.worker.ts`). The faces of the crack graph are the shards. Their side walls are the same quads the cracks were drawn with, so the cracked pane and the shards are one picture at the moment they let go.

A worker gets each shard as convex pieces (Douglas-Peucker, then triangles merged while they stay convex) and simulates them with Rapier in decimetres. What is nearest a blow is loose at once, the rest lets go within a few frames, each piece with a push: out the back in a cone near the impact, outwards at the rim. Frames are positions and quaternions in a float texture, blended between two baked frames, so it stays smooth at any pace: the pace of life by default, far slower while held.

**The shock.** Only what is already broken goes. Nothing runs on and nothing new is cracked: the faces of the graph as it stands are the pieces, which means every cell the cracks have closed. The largest face, the pane around them, is not a shard: it stays. The pieces are cut smaller, and it is as if a ball nobody sees went through every bullet hole at the same instant: one heavy sphere per hole goes into the simulation, never drawn. None of this waits for the swipe. A moment after every bullet, what a shock would do now is worked out on a copy of the pane (the real one can still be shot, and must not meet cuts nobody sees) and the worker bakes that fall. A swipe only has to play it: the copy becomes the pane. Another bullet, or another number in the workbench, and it is prepared again.

Whatever is left standing can be shot again, and shocked again, without waiting: falls play side by side, each with its own baked frames and its own playhead, and the worker bakes several at once. The pane goes in as many falls as it takes, and the shards of each stay where they came to rest. Faces that already left are told apart by the mask. A bullet through an opening hits nothing.

What stays is still drawn as the pane it was: one quad, cut out where the pieces left (their outlines are painted into the mask), and its cracks rebuilt from the graph, without those that had a leaving piece on both sides. A crack that ends in clear glass stays where it is.

Splinters under 1.5 cm² are boxes that only meet the floor. Some of the pieces standing in the channel stay there.

**Two panes.** Each pane is its own graph, with its own part of one mask texture; which pane a vertex belongs to rides in the tens of its `kind`. A bullet is the ray from the eye, so it meets the second pane a little off from where it met the first. Everything else is one: one set of shards per fall with both panes' pieces in it, one simulation, so what is blown out of the front pane flies through, or into, what leaves the back one. `Panes` (1 to 3) and `Gap` are in the workbench.

**Tempered.** The second pane does not grow cracks. Tempered glass lets go everywhere at once, so the first hit throws its graph away and builds it again as the cells of scattered points (a shaken honeycomb, finer by the impact, Voronoi through `d3-delaunay`): about two thousand dice of 2.4 cm. The cracks appear as the wave from the impact reaches them, at 22 m/s as shown. Nothing stands on its own after that, so the next swipe takes the whole pane. Every die is a body, but one that only meets the floor: two thousand hulls leaning on each other would not bake in any time worth waiting for. A later bullet takes the die it hits with it. `2nd tempered` and `Tempered dice` are in the workbench.

**Tape.** A strip is a line across the pane and a width, and a face of the graph whose middle is under one is held. Held by what depends on what is left. While the pane still has its large standing face, the held pieces stay part of it: not cut, not shards, not in the simulation, still there to be shot. When nothing of the pane stands (the tempered one after any shock), tape has nothing to hang from: the held pieces of one strip go to the worker as a group, which makes one rigid body of them, each shard's shape where it sits, and the strip drops and tumbles as one, a little after the rest. The tape itself is drawn riding one of those shards.

**The wall, its frost and its targets.** The pane is sized from the camera: wider than what is seen at the distance it stands, taller than the top of the view, so there is only glass and a strip of floor. One pane by default (`Panes` in the workbench brings back two or three, one behind the other).

Frosted glass blurs what is behind it but not what is in it: a crack is at the surface and stays sharp. So the room is kept as a picture of its own, without the glass, next to the usual one with every crack surface in it. A face of the glass blurs the first (sixteen taps on a disc, turned by a hash per pixel, which is the grain) and puts back the second wherever the two differ: that is where a crack is. Where glass has left, the room behind is sharp.

The targets are dark matt tape: a small circle with a dot in its empty middle and four long strokes around it, with a gap between each stroke and the circle, so nothing touches. They are drawn in the face shader, by pane coordinates, so a shard carries its part of one wherever it goes. `Frosted` and `Target size` are in the workbench.

## Drawing it

Three steps a frame, WebGL2, no library:

1. The shadow of the glass on the floor, into a map: faces dim the light a little, crack surfaces a lot (min blending, so a pile does not go black).
2. The room (analytic: any shader can ask what a ray sees) and every crack surface, multisampled, into a texture.
3. The faces of the glass on screen. They look that texture up, shifted by their normal, so everything behind a face is seen through it, cracks and other shards included.

Sound is synthesised: noise and sines. The fall is not scored by hand: the simulation notes every contact as it bakes (Rapier's collision events), with the frame, the place, the size of the shard (the smaller of two) and the speed they met at, and whether it was glass on the floor or on glass. The loudest few of each frame go back with the frames, and the playback sounds each as its playhead passes: every shard close to the same pitch (glass is glass: a large piece that rings low sounds like a clock), a large one louder, a little longer and with a dull clack under it, harder is louder, panned to where it landed, grit under it if it was the floor. `shatter.contacts` in the console lists them.

## Learned

- "Stops at the first thing it meets" is the whole trick. Arbitrary crossings would need a real arrangement builder; T junctions need one segment test and one edge split.
- A closed crack seen straight on is nearly invisible in a uniform room. It needs the slant, and total internal reflection, to be dark.
- Rigid bodies this thin want other units: in metres an 8 mm shard is below the solver's tolerances. Times ten, with ten times the gravity, it is calm.
