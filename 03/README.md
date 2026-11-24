# 03 / Melt

2026-11-03

A backlit generative berry popsicle melting slowly in real time. Built as a multi-method hybrid optical pipeline rather than a single unified representation:

- **Solid botanical fruits & birch stick** (`src/fruits.ts`, `src/textures.ts`): Procedural 3D beveled strawberry slices with radiating vascular filaments, translucent backlit hearts, and recessed perimeter achenes; sculpted 3D blueberries with recessed 5-pointed star calyx crowns and waxy epicuticular bloom; and a beveled honey-birch wooden stick. All generated deterministically from a seed with zero external image assets.
- **Melting refractive ice & internal micro-bubbles** (`src/popsicleIce.ts`, `src/shape.ts`): High-resolution parametric twin-fluted molded ice mesh smoothly deformed by a deterministic + pointer-heated melt field. Rendered through a multi-pass HDR linear WebGL2 pipeline with depth-aware front-layer optical thickness (fruits right behind the front wall stay razor-sharp while deeper berries frost softly), chromatic dispersion, Beer-Lambert strawberry-coral absorption, backlit subsurface glow, and 760 trapped internal air micro-bubbles with total internal reflection rims.
- **Separate water droplets** (`src/waterDrops.ts`): Rendered in their own post-ice refractive pass sampling the rendered ice & fruit buffer — 680 clinging/sliding condensation beads lining the wet surface & silhouette rims, plus parametric Rayleigh-Plateau hanging & pinching pendant drops dangling from the bottom corners.

Move or press the pointer across the popsicle to warm the ice and accelerate local & global melting. As the ice recedes, embedded fruits emerge wet and detach under gravity.

```sh
pnpm -C 03 dev
```
