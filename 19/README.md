# 19 / Erosion

2026-11-19

A cube of layered sandstone, 128 voxels a side, worn down with three tools: rain, a water jet and wind. Reference: Horseshoe Bend, red beds over teal water.

```sh
pnpm -C 19 dev
```

`1` rain, `2` water, `3` wind, `R` a new block. Drag beside the rock to turn it, arrows for a quarter turn, wheel to zoom.

## How

WebGPU, everything on the GPU, one `u32` per voxel in a storage buffer (`src/world.ts` has the bit layout).

- **Moving things** (`sim` in `src/sim.wgsl`): Margolus blocks. The grid is cut in 2×2×2 blocks and the cut shifts every step, so each block only touches its own eight cells and all of them run at once, in place, nothing lost or doubled. Inside a block: the heavier sinks, loose things slide down a slope, water spreads sideways.
- **Wearing**: water carries an energy, 15 when it just fell, counting down while it lies still. Rock next to it wears with the square of the energy in the block (the stream power law): a stream cuts a gully where the same drops one by one would only pit the wall. Each layer has a softness, thin hard beds make the ledges, and vertical joints wear four times as fast.
- **Collapse** (`support`): every rock cell keeps its distance to the ground through rock, one more than its nearest neighbour. Cut a piece loose and its numbers climb with nothing to hold them; past a limit it is rubble.
- **The picture** (`src/render.wgsl`): one orthographic ray per pixel walked through the grid, at a low resolution shown in whole pixels. Light, shadow and corners are asked per voxel face, not per pixel, so a face is one flat tone.

## URL

- `?seed=19` the block
- `?px=3` device pixels per picture pixel
- `?hold=0.42,0.3,1` a tool (1 rain, 2 water, 3 wind) held from the start on a point of the screen, for captures
- `?clean` the scene alone

`window.P` holds the rates, `window.erosion.stats()` reads the grid back.
