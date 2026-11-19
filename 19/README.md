# 19 / Erosion

2026-11-19

A cube of layered sandstone, 128 voxels a side, worn down with three tools: rain, a water jet and wind. Reference: Horseshoe Bend, red beds over teal water.

```sh
pnpm -C 19 dev   # https://localhost:5119, self-signed: WebGPU on a phone needs a secure context
```

`1` scratch, `2` rain, `3` hose, `4` wind, `R` a new block. The scratch is in hand from the start. The bar is `SCRATCH RAIN HOSE WIND | SIZE FORCE` (day 07's, `src/bar.ts`): four tools, then two knobs, the same two for every tool, each showing and setting the value of the tool in hand. Each tool keeps its own size and force, from one visit to the next.

- **Size**: the brush. Hold the knob and drag, up or right, a gauge shows while you hold; or tap it to pin the gauge and drag on that. Or hold cmd (ctrl) and drag sideways on the scene: a ring shows the brush and stays where the drag began, only its size changes (day 05's).
- **Force**: how hard the tool works. The knob, or hold shift and cmd (ctrl) and drag sideways on the scene, and the knob's gauge shows while you drag. It starts on 75 (the scratch on 60); 100 is ten times what 40 is. For rain the hard work is the wearing, not the amount of water (ten times the water only drowns the rock), so its force sets how fast running water wears.

The gear, top right: the detail (how big a picture pixel is: low, medium, high) and a new block.

Drag beside the rock to turn it, arrows for a quarter turn, wheel to zoom. On a touch screen the brush sits a little above the finger, which would hide it otherwise. Two fingers are the camera's, wherever they land: moved together or twisted they turn the rock, a pinch zooms.

The scratch is nothing but a point dragged over the rock: it takes what is under it, there and then, hard bed or soft, and what comes loose falls. It works in pulses, like a nail on a wall: a bite, a gap, a bite, each a little bigger or smaller than the last. A drag is a run of short marks, holding still a slow pecking at one spot.

The wind is a hair dryer in your hand, the same way round as the hose: it blows straight in along the line of sight, at where the pointer is. It is wide, it takes in most of the block, and strongest where it is aimed, falling off with the distance from the pointer and a little with depth. It only reaches the surface, what you can see from where you are: what has anything between it and your eye, rock or a tree, is in the lee. It finds the rotten pockets first, and carries what is loose away from you; dashes run outward over the rock from where it is aimed. Rain is the one thing that comes from above.

## How

WebGPU, everything on the GPU. Two models, one on top of the other.

**The rock** is a voxel grid, one `u32` per voxel in a storage buffer (`src/world.ts` has the bit layout).

- **Falling things** (`sim` in `src/sim.wgsl`): Margolus blocks. The grid is cut in 2×2×2 blocks and the cut shifts every step, so each block only touches its own eight cells and all of them run at once, in place, nothing lost or doubled. Inside a block sediment falls and slides down a slope, and the wind and the hose wear what faces them.
- **Collapse** (`support`): every rock cell keeps its distance to the ground through rock, one more than its nearest neighbour. Cut a piece loose and its numbers climb with nothing to hold them; past a limit it is rubble.

**The water** is not voxels. It is a depth per column, standing on the height map of the rock (`skyline` keeps that map: each column's highest rock, and its bed with the sediment lying on it).

- **Flow** (`flow`, `settle`): virtual pipes (Mei, Decaudin and Hu 2007). Every column is joined to its four neighbours, and what pushes water through a pipe is the difference between the two water surfaces. So from one rule it runs downhill, fills a hollow to its lowest rim and spills there, and levels out. It keeps some of its flow from step to step, and a film clings before it runs.
- **Wearing**: running water wears the top voxel of its bed, by how much goes through and by how far it drops there. Where a little more runs the bed sinks a little faster, so more runs there: a sheet of rain gathers into watercourses. It is the drop that does the work: rain does not dig where it lands, on level ground it runs off as a sheet and leaves it be. A lip the water falls over wears fastest, so a fall eats its way back from the edge of the block, and a flat top is taken apart from its edges inward. Deep water shelters its bed, and a column can only sink so fast, however hard it rains. Only a film dries: water with any depth to it stays, so a hollow that has filled is a lake until something lets it out.
- **When the rain stops**, so does the wearing. How hard water wears is the rain's force while it rains and dies away over a couple of seconds after, to a tenth of plain; banks only come down beside water that runs or has just run, and rot is only eaten out under it. A pond that lies still wears nothing. Each layer has a softness and vertical joints wear four times as fast.
- **Rot**: the rock is not even. Every voxel has a weakness baked in (`src/world.ts`): most is sound, here and there is a pocket of rotten rock, a lens a few voxels across lying along the beds. Sound rock wears at a third of its layer's rate, a pocket at six times it, and a wet pocket is eaten out where it lies, on level ground too. That is where it starts: a pit, whose rim is a bank and a lip, and it gnaws on from there. The wind finds the same pockets.
- **Banks**: left at that, every column would be cut on its own: slots a voxel wide, spikes standing between them, holes with walls straight down. So a column that stands more than two steps above a neighbour where water stands or has just run wears too, and that "has just run" spreads a few columns sideways, fading: the bank of a bank is still a bank. How high a bank can stand is the rock's business: rotten rock slumps to a slope, sound rock stands as a wall, a hard bed holds a ledge. A channel opens into a valley whose sides step and bulge with what they are cut through.
- **From above**: water only ever takes the top voxel of a column. It cuts down, never sideways, and never runs under an overhang. Only water that goes on wears: the bottom of a hollow takes water in, passes none on, and stays as it is.
- **Over the side**: there is no water off the block. What goes over the edge is drawn falling down the wall, and is gone.
- **Drawing it** (`stamp`): the depth is stamped into the grid as water voxels every frame, a faint one for a film, with a curtain of drops where it falls over an edge and streaks where it rains. Nothing reads those voxels back as water.

**How it starts** (`landscape` in `src/world.ts`): not a bare block. A lake on top with a river winding out of it both ways, cut into the rock and full to just under the brim, one level for all of it so it lies still until something disturbs it; a wood along the water and grass further off. The river stops short of the edges: over the side it would be gone.

**What lies buried** (`bury` in `src/world.ts`): skeletons, standing in the rock as they stood. Mammoths, long-necked dinosaurs and one tyrannosaur behind the faces of the block, a few voxels in or a good way, and ammonites lying in the beds. One mammoth is in one of the two faces a first look shows, pressed flat: a slab of it lying in the surface of the wall, all of it to be seen from the side from the start, the way a fossil is found. Bone is rock of its own layer, a thousand times as hard as plain sandstone: the weather, the hose and the scratch take what is round it and leave it, so digging one out, the skeleton is what is left. It holds itself up too, and what hangs on it: dug free, it stands where it stood. The models are drawn large, with two tools, a bone (every voxel within a radius of a line) and a knob (the skull), and set in the rock at half that.

**What grows** (`grow`, and `stamp` again) is a third thing per column: how far along its cover is.

- **Where**: where water has been and the ground is then left alone. A column has moisture, filled while water is on it or runs past and a minute or so in drying. On moist ground that is level enough to stand on (a flat, or a ledge on a steep side), that has soil (sediment, or rock rotten enough to root in) and that nothing disturbs, the cover grows: grass, then bushes, then a tree getting taller. Flood it, scour it or take the ground from under it and it is gone; left dry it dies back slowly.
- **Moisture** is full where water is, runs, or lies alongside, and seeps out sideways from there, a little less each column: standing water keeps a belt round it green. Dry, the trees and bushes die back and the grass holds on.
- **Cactus**: more than twelve voxels below the top of the block it is desert, and what grows there asks for neither soil nor water, only somewhere to stand and to be left alone. Cactus has its own, closer lattice of sites, and the further down the more of them have one: quite a few, by the floor of a canyon.
- **Trees** stand on a loose lattice of sites, one per 8×8 columns, and every column draws the part of each nearby tree that passes through it, so no column writes outside itself.
- **Walls**: tufts take root in the rotten pockets of a wall, below ground that has been wet, so they follow the beds along a cliff.
- Like the water, plants are stamped into the grid as voxels for the picture and nothing reads them back.

A first try moved the water as voxels in the same blocks as the sediment. It fills a hollow and finds its level, but it has no pressure and creeps half a cell a step, so rain piled up into a hill instead of running off, and nothing ever gathered into a stream.

**The picture** (`src/render.wgsl`): one orthographic ray per pixel walked through the grid, at a low resolution shown in whole pixels. Light, shadow and corners are asked per voxel face, not per pixel, so a face is one flat tone.

## URL

- `?seed=19` the block
- `?px=3` device pixels per picture pixel
- `?hold=0.42,0.3,1,0.4,10` a tool (by its number in the code, not its key: 1 rain, 2 hose, 3 wind, 4 scratch) held from the start on a point of the screen, at a level, let go after so many seconds, for captures
- `?clean` the scene alone

`window.P` holds the rates, `window.erosion.stats()` reads the grid and the water back.
