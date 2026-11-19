# 02 / Shatter

2026-11-02

A pane of 8 mm glass standing in a channel. Shoot it as often as you like: every bullet is a hole and a web of cracks. Then swipe: a shock, and every bullet hole blows out at once. Or kick a football through it.

```sh
pnpm -C 02 dev
```

- **Click / tap** the glass: a bullet, as many as you want. **Wheel**: zoom in on the cracks.
- **Swipe / drag** across the glass: the shock. Which way does not matter.
- **Space**, or the first button: a football through the middle, at 30 m/s. **B**, or the ball button: hide the ball itself (also `?noball`).
- While the glass falls, **hold** (pointer or Space) for slow motion.
- **R**: a new pane. **M**: sound.
- A mouse moves the head a little. A finger does not: under a touch the glass stays put.
- `?seed=7` pins the pane, `?clean` hides the furniture.
- `?debug` (or `#debug`): the workbench, a gear bottom right. Three folding sections, the scene (light, glass, pace), the cracks (from the next bullet) and the simulation (from the next break). Every value, and what is folded, is kept in localStorage; double click a name to put its value back.

## Two parts

**The cracks** (`src/cracks.ts`). The pane is a planar graph. A bullet starts twenty to thirty radial cracks at its impact; half of them die within centimetres, the others get a log-normal length, wander, kink and fork. Then tangential cracks hop from radial to radial, often near the hole and rarely far out, and a rim closes the hole. One rule keeps it all sound: a crack that meets another crack stops there, in a T. Nothing ever crosses, so the graph stays planar with no clean-up, and old cracks shield the glass behind them from new ones, as they do.

A crack that runs into something is there within a frame or two. One that runs out of energy in clear glass is as fast at first, then crawls: `time = (s / L)^4.5`. Those last centimetres are all the eye gets of the animation. A few tips give a little more a second or two later, with a tick.

Cracks are closed: there is no gap to see. What is drawn is the crack surface itself, a ribbon from the front of the glass to the back, slanted a little, different at every node. Light inside the glass that meets it is mirrored. Either it then leaves through a face, and the crack shows the room from somewhere else (nearly invisible, or a glint when that somewhere is a lamp), or it is sent along the pane beyond the critical angle and stays in the glass: that is the dark line. Only the bullet holes are open, cut out with a mask that also carries the crushed, white glass around them.

**The football** (`src/shards.ts`, `src/sim.worker.ts`). It leaves the foot at 30 m/s, and from that moment where and how it hits is known, so everything is prepared while it flies: a blunt impact is added to the graph (forty radials, most of them long), every open tip runs until it meets something, every piece larger than a few fingers is cut again, and the faces of the graph are the shards, about a thousand. Their side walls are the same quads the cracks were drawn with, so the cracked pane and the shards are one picture at the moment of impact.

A worker gets each shard as convex pieces (Douglas-Peucker, then triangles merged while they stay convex) and the ball as a sphere with its velocity and spin, and simulates them with Rapier in decimetres. What the ball is about to go through is loose at once, the rest lets go within a few frames, each piece with a push: out the back in a cone near the impact, outwards at the rim. The flight is shown in slow motion (at 30 m/s it would be three frames), which is also the time the worker needs to get ahead: the fall starts at that same pace on impact and picks up to 0.6 of life. Frames are positions and quaternions in a float texture, blended between two baked frames, so it stays smooth at any pace, and slower still while held.

**The shock.** Same preparation, another cause: it is as if a ball nobody sees went through every bullet hole at the same instant. Each hole gets a blunt blow in the graph, everything is cut small, and one heavy sphere per hole goes into the simulation, never drawn. It is at once: the pane is its shards 60 ms after the swipe, the time the worker needs for its first frames, and the fall starts very slow and picks up. With no bullet in the pane, the one blow is where the swipe was.

Splinters under 1.5 cm² are boxes that only meet the floor. Some of the pieces standing in the channel stay there.

## Drawing it

Three steps a frame, WebGL2, no library:

1. The shadow of the glass on the floor, into a map: faces dim the light a little, crack surfaces a lot (min blending, so a pile does not go black).
2. The room (analytic: any shader can ask what a ray sees) and every crack surface, multisampled, into a texture.
3. The faces of the glass on screen. They look that texture up, shifted by their normal, so everything behind a face is seen through it, cracks and other shards included.

The ball is a sphere with twelve dark patches, drawn into the same texture, so it is seen through the glass too.

Sound is synthesised: noise and sines. The fall is one grain per shard that meets the floor, counted by the worker per frame.

## Learned

- "Stops at the first thing it meets" is the whole trick. Arbitrary crossings would need a real arrangement builder; T junctions need one segment test and one edge split.
- A closed crack seen straight on is nearly invisible in a uniform room. It needs the slant, and total internal reflection, to be dark.
- Rigid bodies this thin want other units: in metres an 8 mm shard is below the solver's tolerances. Times ten, with ten times the gravity, it is calm.
