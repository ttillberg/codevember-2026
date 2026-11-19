# 02 / Shatter

2026-11-02

A pane of 8 mm glass standing in a channel, and a gun. Click the glass to shoot it. It takes a few bullets, then it gives way.

```sh
pnpm -C 02 dev
```

- **Click / tap** the glass: a bullet. **Wheel**: zoom in on the cracks. The pointer moves the head a little.
- **Space**, or the first button: break it now. While it falls, **hold** (pointer or Space) for slow motion.
- **R**, or the second button: a new pane. **M**: sound.
- `?seed=7` pins the pane, `?clean` hides the furniture.

## Two parts

**The cracks** (`src/cracks.ts`). The pane is a planar graph. A bullet starts twenty to thirty radial cracks at its impact; half of them die within centimetres, the others get a log-normal length, wander, kink and fork. Then tangential cracks hop from radial to radial, often near the hole and rarely far out, and a rim closes the hole. One rule keeps it all sound: a crack that meets another crack stops there, in a T. Nothing ever crosses, so the graph stays planar with no clean-up, and old cracks shield the glass behind them from new ones, as they do.

A crack that runs into something is there within a frame or two. One that runs out of energy in clear glass is as fast at first, then crawls: `time = (s / L)^4.5`. Those last centimetres are all the eye gets of the animation. A few tips give a little more a second or two later, with a tick.

Cracks are closed: there is no gap to see. What is drawn is the crack surface itself, a ribbon from the front of the glass to the back, slanted a little, different at every node. Light inside the glass that meets it is mirrored. Either it then leaves through a face, and the crack shows the room from somewhere else (nearly invisible, or a glint when that somewhere is a lamp), or it is sent along the pane beyond the critical angle and stays in the glass: that is the dark line. Only the bullet holes are open, cut out with a mask that also carries the crushed, white glass around them.

**The fall** (`src/shards.ts`, `src/sim.worker.ts`). When the cracks add up to more than the pane can take (13 to 21 m per m², drawn per pane), every open tip runs until it meets something, every piece larger than a hand is cut again, and the faces of the graph are the shards. Their side walls are the same quads the cracks were drawn with, so the cracked pane and the pile of shards are one picture at the moment it lets go.

A worker gets each shard as convex pieces (Douglas-Peucker, then triangles merged while they stay convex), lets them go in a wave from the last impact, and simulates them with Rapier in decimetres. It runs several times faster than real time, so the page starts playing 0.6 s after the last shot while the worker is still ahead of it. Frames are positions and quaternions in a float texture, blended between two baked frames, which is why the fall can be played slower than life, and slower still while held, and stay smooth.

Splinters under 1.5 cm² are boxes that only meet the floor. Some of the pieces standing in the channel stay there.

## Drawing it

Three steps a frame, WebGL2, no library:

1. The shadow of the glass on the floor, into a map: faces dim the light a little, crack surfaces a lot (min blending, so a pile does not go black).
2. The room (analytic: any shader can ask what a ray sees) and every crack surface, multisampled, into a texture.
3. The faces of the glass on screen. They look that texture up, shifted by their normal, so everything behind a face is seen through it, cracks and other shards included.

Sound is synthesised: noise and sines. The fall is one grain per shard that meets the floor, counted by the worker per frame.

## Learned

- "Stops at the first thing it meets" is the whole trick. Arbitrary crossings would need a real arrangement builder; T junctions need one segment test and one edge split.
- A closed crack seen straight on is nearly invisible in a uniform room. It needs the slant, and total internal reflection, to be dark.
- Rigid bodies this thin want other units: in metres an 8 mm shard is below the solver's tolerances. Times ten, with ten times the gravity, it is calm.
