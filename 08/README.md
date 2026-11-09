# 08 / Tesseract

2026-11-08

TESSERAKT, a hypercube built for real. A tesseract cannot exist in three dimensions, but its shadow can: turned in 4D and seen in perspective, it is a 3D object whose edges change length and nothing else. So that is the machine. 32 telescopic struts in three stages, sleeve, stanchion, rod, on 16 ball joints, with one crank turning it evenly through the XW plane, or, on M, a servo doing it in steps the way a first prototype moves: hold, snap, overshoot, settle. Radii are constant like on a real part, only the lengths move. Painted sand and graphite with decals, silver rods, black seals, a coloured ring here and there, six blinking LEDs, on graph paper. Space stops the crank, the arrows or shift and drag turn it by hand, drag orbits, T stops the turntable, M swaps the even spin for a stepping servo. `?clean` hides the page furniture.

## How

- **One plane only** (`state.ts`): the machine turns in XW and nothing else. Compose turns in two planes and an edge can point straight at the eye; its strut would have to shrink to nothing. In one plane the shortest strut is 0.73 and the longest 3.03 (`node` sweep over the whole turn), and no two joints that are not neighbours come closer than 1.0. Seeing it from other sides is a 3D job: orbit, and a slow turntable.
- **Servo** (`state.ts`): an underdamped spring on the crank angle, stiff (ω ≈ 19) and bouncy (ζ 0.42), so a step lands with a visible overshoot and a short settle. A program picks the targets: mostly 15° and 30°, a 90° now and then, a twitch back one time in four for the small ones, a hold of 0.35 to 2.4 s after, one in four a quick second step. The turntable is a softer spring on the same idea, a step every few seconds. Keys and shift-drag move the target, the spring does the rest.
- **Struts** (`Machine.tsx`): per edge, a sleeve sunk into each ball, a stanchion sliding out of each sleeve as far as the strut needs up to 0.8, and a rod between the stanchions taking the rest. Each stage overlaps the one round it by 0.1 so nothing shows daylight. Two sleeves fully compressed are 0.65 with the balls, under the shortest strut. Seals are short fat rings at every mouth.
- **Colour**: the eight edges along w are sand, the other 24 graphite, so you can follow which edges are which as the inner cube turns out and the outer turns in.
- **Decals** (`decals.ts`): canvas textures on the cylinder UVs, not `DecalGeometry`. One sleeve in three has one, the rest are plain paint; x runs round the tube, y along it, the open end at the top. Each carries a few of: hazard band at the mouth, brand round the tube, serial along it, barcode, a coloured tab, a cube's net as pictogram. Seeded, so the same every load.
- **LEDs** (`Machine.tsx`): six status lights on the balls, each with its own blink: heartbeat, breathe, a flash every five seconds, fast steady, slow square, tick. An emissive bead in a black collar, and an additive halo sphere whose opacity follows the blink.
- **Light**: drei `Environment` from four `Lightformer`s, no HDR download, plus one directional. `ContactShadows` on a transparent canvas, the graph paper is CSS.

## Learned

- Perspective along w is what gives the w-edges length at all; in parallel projection they vanish. The eye distance is a trade between long w-edges (near) and a tame length range (far).
- `setFromUnitVectors(Y, dir)` and the same quaternion times `(1,0,0,0)` gives the strut's two ends the same roll, so decals on both sleeves line up.

```sh
pnpm -C 08 dev
```
