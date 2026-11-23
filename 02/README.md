# 02 / Shatter

2026-11-02

Swipe across a layered Sommerso glass block to slice off facets in 3D, watch inner-Voronoi surface crackles race away from the cut, and shatter each severed chunk into translucent refractive shards that bounce and split again across the studio floor over dispersive fake caustics. Raw WebGPU + WGSL, with Rapier for rigid-body scatter.

```sh
pnpm -C 02 dev
```

- **1,000-level Diamond Cutter game (default `Game` mode)**: deterministic, pre-planned levels (`1–1000`, `src/levels.ts`) that scale progressively from a single rising crystal through simultaneous fans, staggered cascades, crossing X-salvos, and rapid fountains.
  - **Swipe / drag across clear crystals**: sweep cleanly through rising faceted optical crystals along your exact 3D slash plane with a tapered katana ribbon. Severed halves tumble intact under gravity and shatter only on impact with the studio floor, scattering refractive diamond shards and dispersive rainbow caustics.
  - **Poisoned Black Diamonds**: jet-obsidian faceted diamonds mixed into waves — dodge them and let them fall untouched. Slicing a Black Diamond (or letting a clear crystal fall unhit) triggers a dramatic loss sequence: everything freezes mid-air, the screen shakes, and every crystal and tumbling half explodes simultaneously into clear and obsidian shards.
  - **Fruit Ninja scoring**: `+1` per gem hit, **Combos** (`3+` gems in a single same-direction stroke award `+N` bonus points, doubling the combo), **Blitz streaks** (`+5` → `+10` → `+15` → `+20` → `+30` for chaining combos across waves), **Precision Critical** (`+10` for a dead-center cleave), and the **Jewel Cutter bonus** (`+1` for each extra cut carved off the same juggled gem in mid-air).
  - **Responsive mobile stage**: portrait viewports automatically pull the camera back and clamp horizontal throw lanes so every crystal stays cleanly inside narrow phone screens.
- **Level stepper (`‹ N / 1000 ›` or `[` / `]`)**: jump between any of the 1,000 deterministic levels; press **Space** or **Retry** after a loss to replay the current level.
- **Game / Pedestal (`T`, on by default in Free mode)**: switch between the 1,000-level arcade game and steady studio pedestal slicing (`?toss=0` starts on the pedestal).
- **Shape / Letter picker (`Free`, `Gem`, `Vase`, `Crystal`, `Prism`, `A S O V X H T M K E C Z 2`)**: pause Toss and carve architectural crystal forms and multi-convex letters step by step (swipe, click, or **Space**).
- **2× Sym** (`B`): mirror each slice symmetrically across the block's center so both opposite sides cleave and shatter together.
- **Auto** (`A`, on by default): automatically shatters each severed piece after slicing. Turn off to inspect the cleaved piece before clicking or pressing **Space** to shatter.
- **Shift** (hold) / **S** / **Slow**: slow-motion shatter and splinters (`0.22×`).
- **P**: cycle optical crystal & Sommerso colourways (`Crystal` clear diamond default, `Sommerso`, `Solstice`, `Verdigris`, `Cobalt`).
- **C**: sweep fallen floor shards. **R**: fresh glass cube. **M**: sound. **?**: controls.
- `?clean` hides all page furniture. `?debug` (or `#debug`) opens the workbench gear bottom-right.

## How it works

- **Exact 3D convex clipping & Voronoi shatter (`src/poly.ts`, `src/carve.ts`)**: The glass block is a closed convex polyhedron (or multi-convex assembly for carved letters). Each swipe projects a 3D cutting plane through the camera ray and splits every intersecting convex part cleanly into watertight halves. Severed chunks are partitioned by 3D Voronoi half-space clipping (up to 140 shards, seeded denser along the cleave face), and shared bisector boundaries are extracted on the outer shell so surface crackle seams match the exact inner fracture planes and unzip directionally away from the cut.
- **Multi-bounce Sommerso glass & refractive shards (`src/shaders.ts`, `src/gpu.ts`)**: The block and cracking chunks are raytraced in local cube space (up to 4 internal TIR bounces, separate R/G/B chromatic dispersion, and Beer-Lambert integration through the 3D Sommerso colour volume). Fallen shards render in two passes — an offscreen back-face depth/normal buffer (`shardBackTex`) and a resolved scene background (`bgTex`) — for true double refraction, geometric thickness tinting, back-face TIR, and conchoidal normal micro-ripples while keeping their original Sommerso colour coordinates.
- **WebGPU cracks & compute splinters**: Inner Voronoi fracture planes and double-walled surface crackles animate along a directional wave with grazing TIR flashes. A 4,096-particle WebGPU compute shader simulates tumbling micro-splinters with gravity, drag, and grounded floor rest stabilization, triggered along the cut seam, on shatter, and on secondary floor impacts.
- **Fake dispersive caustics**: An offscreen `1024 × 1024` `rgba16float` floor pass projects both the glass block and every shard along the studio key light — once for soft shadow occlusion and three times (`R`, `G`, `B` with separate IORs) along refracted facet normals so overlapping facets cast luminous prismatic caustic bands across the white cyclorama.
- **Baked Rapier scatter & secondary breaking (`src/sim.worker.ts`)**: A Web Worker simulates each cut's exact convex-hull shards in decimetres (`×10` scale, `6` solver iterations, CCD enabled) against the studio floor and previously settled piles, dynamically splitting high-speed impact shards into child fragments on floor contact and emitting collision events for procedural WebAudio glass clinks (`src/audio.ts`).
