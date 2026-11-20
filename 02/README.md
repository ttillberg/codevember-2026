# 02 / Shatter

2026-11-02

Two panes of 8 mm glass, each standing in a channel, one 25 cm behind the other. Shoot them as often as you like: a bullet goes through both, and in each it is a hole and a web of cracks. Then swipe: a shock, and everything the cracks have cut loose blows out at once, while the rest of the pane stays standing. Or kick a football through all of it.

```sh
pnpm -C 02 dev
```

- **Click / tap** the glass: a bullet, through every pane in its way, as many as you want. **Wheel**: zoom in on the cracks.
- **Swipe / drag** across the glass, or **Space**: the shock. Which way does not matter. Only what is broken goes.
- The first button: a football through the middle, at 30 m/s. **B**, or the ball button: hide the ball itself (also `?noball`).
- While glass falls, **hold** a press where it is for slow motion (Space too, when there is nothing to break). A thin bar at the bottom shows how far the worker is with the bake.
- As long as glass is standing, carry on, at once: more bullets, another swipe, while the last pieces are still in the air. With none left, a click is a new pane.
- **S**, or the camera button: the latest fall again, in slow motion, from the side. A bar at the bottom has play and pause (Space), a chart of the fall's contacts over time (floor in full, glass on glass lighter), a playhead to drag, and the speed (0.05× to 1×). **Esc** to leave.
- **R**: a new pane. **M**: sound.
- The pointer never moves the camera: it has a slow sway of its own (`Camera sway` in the workbench, down to none), and the wheel zooms.
- `?seed=7` pins the pane, `?clean` hides the furniture.
- The fall plays at the speed of life (`Fall speed` in the workbench, to slow it for good).
- `?debug` (or `#debug`): the workbench, a gear bottom right. Three folding sections, the scene (light, glass, pace), the cracks (from the next bullet) and the simulation (from the next break). Every value, and what is folded, is kept in localStorage; double click a name to put its value back.

## Two parts

**The cracks** (`src/cracks.ts`). The pane is a planar graph. A bullet starts twenty to thirty radial cracks at its impact; half of them die within centimetres, the others get a log-normal length, wander, kink and fork. Then tangential cracks hop from radial to radial, often near the hole and rarely far out, and a rim closes the hole. One rule keeps it all sound: a crack that meets another crack stops there, in a T. Nothing ever crosses, so the graph stays planar with no clean-up, and old cracks shield the glass behind them from new ones, as they do.

A crack that runs into something is there within a frame or two. One that runs out of energy in clear glass is as fast at first, then crawls: `time = (s / L)^4.5`. Those last centimetres are all the eye gets of the animation. A few tips give a little more a second or two later, with a tick.

Cracks are closed: there is no gap to see. What is drawn is the crack surface itself, a ribbon from the front of the glass to the back, slanted a little, different at every node. Light inside the glass that meets it is mirrored. Either it then leaves through a face, and the crack shows the room from somewhere else (nearly invisible, or a glint when that somewhere is a lamp), or it is sent along the pane beyond the critical angle and stays in the glass: that is the dark line. Only the bullet holes are open, cut out with a mask that also carries the crushed, white glass around them.

**The football** (`src/shards.ts`, `src/sim.worker.ts`). It leaves the foot at 30 m/s, and from that moment where and how it hits is known, so everything is prepared while it flies: a blunt impact is added to the graph (forty radials, most of them long), every open tip runs until it meets something, every piece larger than a few fingers is cut again, and the faces of the graph are the shards, about a thousand. Their side walls are the same quads the cracks were drawn with, so the cracked pane and the shards are one picture at the moment of impact.

A worker gets each shard as convex pieces (Douglas-Peucker, then triangles merged while they stay convex) and the ball as a sphere with its velocity and spin, and simulates them with Rapier in decimetres. What the ball is about to go through is loose at once, the rest lets go within a few frames, each piece with a push: out the back in a cone near the impact, outwards at the rim. The flight is shown in slow motion (at 30 m/s it would be three frames), which is also the time the worker needs to get ahead: the fall starts at that same pace on impact and picks up to 0.6 of life. Frames are positions and quaternions in a float texture, blended between two baked frames, so it stays smooth at any pace: the pace of life by default, far slower while held.

**The shock.** Only what is already broken goes. Nothing runs on and nothing new is cracked: the faces of the graph as it stands are the pieces, which means every cell the cracks have closed. The largest face, the pane around them, is not a shard: it stays. The pieces are cut smaller, and it is as if a ball nobody sees went through every bullet hole at the same instant: one heavy sphere per hole goes into the simulation, never drawn. None of this waits for the swipe. A moment after every bullet, what a shock would do now is worked out on a copy of the pane (the real one can still be shot, and must not meet cuts nobody sees) and the worker bakes that fall. A swipe only has to play it: the copy becomes the pane. Another bullet, or another number in the workbench, and it is prepared again.

Whatever is left standing can be shot again, and shocked again, without waiting: falls play side by side, each with its own baked frames and its own playhead, and the worker bakes several at once. The pane goes in as many falls as it takes, and the shards of each stay where they came to rest. Faces that already left are told apart by the mask. A bullet through an opening hits nothing.

What stays is still drawn as the pane it was: one quad, cut out where the pieces left (their outlines are painted into the mask), and its cracks rebuilt from the graph, without those that had a leaving piece on both sides. A crack that ends in clear glass stays where it is.

Splinters under 1.5 cm² are boxes that only meet the floor. Some of the pieces standing in the channel stay there.

**Two panes.** Each pane is its own graph, with its own part of one mask texture; which pane a vertex belongs to rides in the tens of its `kind`. A bullet is the ray from the eye, so it meets the second pane a little off from where it met the first. Everything else is one: one set of shards per fall with both panes' pieces in it, one simulation, so what is blown out of the front pane flies through, or into, what leaves the back one. `Panes` (1 to 3) and `Gap` are in the workbench.

## Drawing it

Three steps a frame, WebGL2, no library:

1. The shadow of the glass on the floor, into a map: faces dim the light a little, crack surfaces a lot (min blending, so a pile does not go black).
2. The room (analytic: any shader can ask what a ray sees) and every crack surface, multisampled, into a texture.
3. The faces of the glass on screen. They look that texture up, shifted by their normal, so everything behind a face is seen through it, cracks and other shards included.

The ball is a sphere with twelve dark patches, drawn into the same texture, so it is seen through the glass too.

Sound is synthesised: noise and sines. The fall is not scored by hand: the simulation notes every contact as it bakes (Rapier's collision events), with the frame, the place, the size of the shard (the smaller of two) and the speed they met at, and whether it was glass on the floor, on glass or on the ball. The loudest few of each frame go back with the frames, and the playback sounds each as its playhead passes: every shard close to the same pitch (glass is glass: a large piece that rings low sounds like a clock), a large one louder, a little longer and with a dull clack under it, harder is louder, panned to where it landed, grit under it if it was the floor. `shatter.contacts` in the console lists them.

## Learned

- "Stops at the first thing it meets" is the whole trick. Arbitrary crossings would need a real arrangement builder; T junctions need one segment test and one edge split.
- A closed crack seen straight on is nearly invisible in a uniform room. It needs the slant, and total internal reflection, to be dark.
- Rigid bodies this thin want other units: in metres an 8 mm shard is below the solver's tolerances. Times ten, with ten times the gravity, it is calm.
