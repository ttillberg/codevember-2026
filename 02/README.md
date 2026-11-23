# 02 / Shatter

2026-11-02

A wall of frosted 8 mm glass, wider and taller than the view, with three targets taped on it. Shoot it as often as you like: every bullet is a hole and a web of cracks. What its cracks cut loose is blown out as it hits, and the rest stays standing. Or make it tempered glass, and one hit takes all of it, as dice. Or three clear panes, one behind the other, each with a painting on it.

```sh
pnpm -C 02 dev
```

- **Click / tap** the glass: a bullet, through every pane in its way, as many as you want. What it cuts loose goes a moment later, when it has been worked out. **Wheel**: zoom in on the cracks.
- **Swipe / drag** across the glass, or **Space**: another shock, for whatever is still loose.
- **1, 2, 3**, or the first button: what is in the hand. A **bullet** goes through every pane in its way. A load of **shot** is seven small pellets over a hand's width, each through every pane, their webs running into each other. A **sledge** is one blunt blow: a star of long cracks and no hole, and it stops at the first pane it meets, so panes standing behind each other go one at a time.
- While glass falls, **hold** a press where it is for slow motion (Space too, when there is nothing to break). A thin bar at the bottom shows how far the worker is with the fall, and over it how many pieces still move.
- As long as glass is standing, carry on, at once: more bullets while the last pieces are still in the air. With none left, a click is a new pane.
- **S**, or the camera button: the latest fall again, in slow motion, from the side. A bar at the bottom has play and pause (Space), a chart of the fall's contacts over time (floor in full, glass on glass lighter), a playhead to drag, and the speed (0.05× to 1×). **Esc** to leave.
- **T**, or the tape button, then a drag across the glass: a strip of tape along it, from edge to edge, on every pane. A click instead lays one straight across at that height. What is under tape stays with the pane as long as some of the pane stands; with none left, the strip comes down in one piece, glass and all.
- **G**, or the glass button: classic glass, which cracks, or tempered, which goes to dice. A new pane either way.
- **K**, or the layers button (also `?layers`): three clear panes one behind the other, 7 cm apart, in place of the frosted wall: a thin one of 4 mm, a thick one of 12 mm and one of 6 mm. Each has a handful of flat forms painted on it, circles, triangles, bars and a half circle, so that it is not one plain colour: cyan and blue in front, magenta and red on the thick pane, yellow and orange behind. Where forms of two panes overlap, what comes through is a third colour. Every pane breaks its own way, a shard keeps its part of the painting, and a hole in one pane shows the other two. `?seed=11` pins the forms with the panes. It comes with the studio's light.
- **L**, or the sun button: the room dark, where the glass, its dust and its glints are what is lit, or a studio with a bright wall behind it, where the cracks and the dust are dark against the light.
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

A worker gets each shard as convex pieces (Douglas-Peucker, then triangles merged while they stay convex) and simulates them with Rapier in decimetres. What is nearest a blow is loose at once, the rest lets go within a few frames, each piece with a push: out the back in a cone near the impact, outwards at the rim. Frames are positions and quaternions in a float texture, blended between two frames, so it stays smooth at any pace: the pace of life by default, far slower while held. The worker steps the fall at the pace it is shown and every frame is drawn as it comes; nothing is worked out ahead, and a fall too heavy for the machine runs slow instead of jerking. (It was baked ahead once, faster than it played. That bought no realism, it is the same simulation, only a smooth start on a slow machine, and it cost a wait before every break.) It ends when nothing can be seen to move any more, bar a few pieces rocking where they lie: a pile never goes to sleep in the solver's sense, and what is thrown off the edge of the floor falls for ever, so both are left out of the count.

**Breaking again.** A shard that lands hard breaks once more. The graph is cut twice on the copy: once into the shards that leave, then finer inside each of them. The fine faces are the bodies, but those of one shard share a single rigid body until it meets the floor, a wall or another shard at more than 3 m/s; then that body is taken out and each piece gets one of its own, where it is and going as it went. The cuts between them are crack surfaces like any other, of a kind that is not drawn while the shard is whole: a flag per piece and frame says so, which is why it also holds in slow motion and in the replay. What a simulation costs goes by the number of pieces far more than by anything else (four thousand took about five times as long to work out as their fall lasts), so there is a ceiling, 1400: with a lot of glass loose the pieces are larger, and with very much there is no second break at all. What costs is glass meeting glass, so there is a second ceiling, 900, on the pieces that have a hull of their own: past it the smallest become boxes that meet the floor and the walls but not each other, as the dice of tempered glass already are.

The simulation takes some care: six passes of the solver, nothing passes through anything between two steps, a little drag so a pile comes to rest. The unseen balls are taken away half a metre behind the glass: left in, they came back off the wall, threw glass at the lens and nudged what lay still. And the room has its side walls in the simulation too, where they are drawn.

**The shock.** Only what is already broken goes. Nothing runs on and nothing new is cracked: the faces of the graph as it stands are the pieces, which means every cell the cracks have closed. The largest face, the pane around them, is not a shard: it stays. The pieces are cut smaller, and it is as if a ball nobody sees went through every bullet hole at the same instant: one heavy sphere per hole goes into the simulation, never drawn. It is worked out on a copy of the pane, and that is a tenth of a second of work for one pane and two for three: in one frame it was a pause between the hit and the burst. So it comes in steps, a few milliseconds in each frame after the bullet (the cutting and the building of the shards are generators that stop between passes), and the picture never stops for it: the glass holds for some ten frames and then gives. Then the copy becomes the pane. A load of shot arrives one pellet a frame for the same reason, and the mask is sent to the renderer once a frame however many holes were drawn on it.

Whatever is left standing can be shot again, and shocked again, without waiting: falls play side by side, each with its own frames and its own playhead, and the worker steps several at once. The pane goes in as many falls as it takes, and the shards of each stay where they came to rest. Faces that already left are told apart by the mask. A bullet through an opening hits nothing.

What stays is still drawn as the pane it was: one quad, cut out where the pieces left (their outlines are painted into the mask), and its cracks rebuilt from the graph, without those that had a leaving piece on both sides. A crack that ends in clear glass stays where it is.

Splinters under 1.5 cm² are boxes that only meet the floor. Some of the pieces standing in the channel stay there.

**Two panes.** Each pane is its own graph, with its own part of one mask texture; which pane a vertex belongs to rides in the tens of its `kind`. A bullet is the ray from the eye, so it meets the second pane a little off from where it met the first. Everything else is one: one set of shards per fall with both panes' pieces in it, one simulation, so what is blown out of the front pane flies through, or into, what leaves the back one. `Panes` (1 to 3) and `Gap` are in the workbench.

**Tempered.** The second pane does not grow cracks. Tempered glass lets go everywhere at once, so the first hit throws its graph away and builds it again as the cells of scattered points (a shaken honeycomb, finer by the impact, Voronoi through `d3-delaunay`): about two thousand dice of 2.4 cm. The cracks appear as the wave from the impact reaches them, at 22 m/s as shown. Nothing stands on its own after that, so the shock that follows takes the whole pane. Every die is a body, but one that only meets the floor: two thousand hulls leaning on each other would not bake in any time worth waiting for. A later bullet takes the die it hits with it. `2nd tempered` and `Tempered dice` are in the workbench.

**Tape.** A strip is a line across the pane and a width, and a face of the graph whose middle is under one is held. Held by what depends on what is left. While the pane still has its large standing face, the held pieces stay part of it: not cut, not shards, not in the simulation, still there to be shot. When nothing of the pane stands (the tempered one after any shock), tape has nothing to hang from: the held pieces of one strip go to the worker as a group, which makes one rigid body of them, each shard's shape where it sits, and the strip drops and tumbles as one, a little after the rest. The tape itself is drawn riding one of those shards.

**The wall, its frost and its targets.** The pane is sized from the camera: wider than what is seen at the distance it stands, taller than the top of the view, so there is only glass and a strip of floor. One pane by default (`Panes` in the workbench brings back two or three, one behind the other).

Frosted glass blurs what is behind it but not what is in it: a crack is at the surface and stays sharp. So the room is kept as a picture of its own, without the glass, next to the usual one with every crack surface in it. A face of the glass blurs the first (sixteen taps on a disc, turned by a hash per pixel, which is the grain) and puts back the second wherever the two differ: that is where a crack is. Where glass has left, the room behind is sharp.

The targets are dark matt tape: a small circle with a dot in its empty middle and four long strokes around it, with a gap between each stroke and the circle, so nothing touches. They are drawn in the face shader, by pane coordinates, so a shard carries its part of one wherever it goes. `Frosted` and `Target size` are in the workbench.

## Drawing it

Three steps a frame, WebGL2, no library:

1. The shadow of the glass on the floor, into a map: faces dim the light a little, crack surfaces a lot (min blending, so a pile does not go black).
2. The room (analytic: any shader can ask what a ray sees) and every crack surface, multisampled, into a texture.
3. The faces of the glass on screen. They look that texture up, shifted by their normal, so everything behind a face is seen through it, cracks and other shards included.

The air is two sets of points. Glass in grains and splinters: nine thousand, each with its own drag, so a splinter falls and powder hangs; each turns as it flies and is dull most of the time, then flashes; what lands glitters on the floor a good while. And glass ground to powder: a few hundred soft puffs, thrown out the back of every hole, stopped by the air within tenths of a second, after which they hang, spread and thin for seconds. The puffs are drawn into the picture of the room, so frosted glass in front of them blurs them, and through an opening they are sharp.

Glass is coloured by the way through it, and colours multiply. Before the faces are drawn, every face of every pane and shard is drawn into a picture of its own, each multiplying in what its glass lets through: the product, along every line of sight, of all the glass on the way, in any order. A face then shows what is behind it times that picture. What is painted on a pane is one more factor: a texture laid out as the mask is, white where the glass is bare, sampled by the pane's own coordinates, which a shard keeps. So a shard behind a pane colours what is seen through the pane, two panes make a third colour, and a hole in one shows the other. Window glass is green, and greener the longer the way through it: a pane from the front is nearly clear, a shard seen on edge is not, and a loose shard glows bottle green along its edges. The lamp has a small hot bulb in it, which is what a turning shard flashes with. Clear glass also carries a faint, soft reflection of a window behind the eye, which slides over it as the eye moves: without it a clear pane is only a colour.

Sound is synthesised: noise and sines. The fall is not scored by hand: the simulation notes every contact as it goes (Rapier's collision events), with the frame, the place, the size of the shard (the smaller of two) and the speed they met at, and whether it was glass on the floor or on glass. The loudest few of each frame go back with the frames, and the playback sounds each as its playhead passes: every shard close to the same pitch (glass is glass: a large piece that rings low sounds like a clock), a large one louder, a little longer and with a dull clack under it, harder is louder, panned to where it landed, grit under it if it was the floor. `shatter.contacts` in the console lists them.

## Learned

- "Stops at the first thing it meets" is the whole trick. Arbitrary crossings would need a real arrangement builder; T junctions need one segment test and one edge split.
- A closed crack seen straight on is nearly invisible in a uniform room. It needs the slant, and total internal reflection, to be dark.
- Rigid bodies this thin want other units: in metres an 8 mm shard is below the solver's tolerances. Times ten, with ten times the gravity, it is calm.
