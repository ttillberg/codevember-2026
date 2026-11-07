# 07 / Hollow

2026-11-07

Paint on a hollow, clear balloon. WebGPU through three's node materials (TSL) in React Three Fiber. Drag on the balloon to paint, drag off it to orbit. Four tools: a round brush, spray, a bristle brush and a scraper; three finishes: matte, gloss and metal. Thick wet paint runs down the balloon, evens out sideways and dries where it stops.

## How

- **Paint layer**: two half-float MRT targets in the balloon's UV space, ping-pong. `color` holds premultiplied rgb and coverage, `props` holds thickness, wetness, roughness and metalness (the last two times coverage, so they move with the colour). Dabs are queued through the frame and splatted in one instanced draw of quads, One / OneMinusSrcAlpha into both targets, so a dab sets its finish where it lands and leaves the rest. The scraper is a second draw with Zero / OneMinusSrcAlpha: everything under the blade is scaled down. MRT outputs default to no blending in three; `setBlendMode` with `MaterialBlending` on each output is what makes them take the material's.
- **Run pass**: a full-screen quad reads the current target and writes the next. A texel above a per-column threshold (hashed, so sheets break into drips) sends its excess down one texel per frame, scaled by its wetness; colour, roughness and metalness travel with the thickness as fractions. Arriving paint is wet, resting paint dries at a constant rate, wet paint is blended a little with its neighbours sideways so runs round off. Thickness is capped.
- **Balloon**: a sphere with a front mesh and a back mesh (BackSide, drawn first) so the paint on the far side shows through. Clear rubber has no diffuse at all: black colour, 5% opacity plus a cubed fresnel rim, a faint pale emissive rim as a stand-in for the room. Paint coverage is the larger of the dab coverage and thickness × 2.5, so runs read as paint. Wet paint is glossier. A tiny procedural equirect studio (gradient plus two soft boxes in a data texture) is the environment, so gloss and metal have something to reflect.
- **Relief**: the normal comes from the paint's height, thickness plus a fine noise grain scaled by thickness, differenced one texel each way in the target (not screen-space derivatives, which are resolution dependent and noisy) and fed through `normalMap` as a tangent-space normal. Dabs lay the paint in ridges along the stroke (noise on the load), so round strokes get orange peel, bristle strokes get furrows, and runs get a lip.
- **UV mapping**: dab width is divided by sin(πv) so dabs stay round near the poles, dabs within reach of the u seam are drawn again a turn over, and strokes take the short way round the seam.

## Learned

- `renderer.clear()` on an MRT target leaves alpha 1 on the second attachment. Clear with your own quad.
- An orthographic pass into a WebGPU render target comes out mirrored in v against the sphere's uv. Mirror the quads, and make them double sided, since the mirror turns their winding.
- `readRenderTargetPixelsAsync` returns raw half-float bits for HalfFloatType targets. Decode them yourself.
- The paint looked washed out for an hour until a probe showed the numbers were right: 60% coverage of red over a light page *is* pink. Measure before theorising.
- Bright lights on a white, nearly transparent diffuse read as milk, because 5% of a 3× overexposed white is still a lot. Clear materials want a black diffuse.
- R3F 9 takes an async `gl` factory, so `WebGPURenderer` + `await init()` just works. Three's TSL typings are thin around `vec4(vec3, float)` and attributes; a few `as any` keep `tsc` quiet.

```sh
pnpm -C 07 dev
```
