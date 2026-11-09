# 08 / Tesseract

2026-11-08

TESSERAKT, a hypercube built for real. A tesseract cannot exist in three dimensions, but its shadow can: turned in 4D and seen in perspective, it is a 3D object whose edges change length and nothing else. So that is the machine. 32 telescopic struts in three stages, sleeve, stanchion, rod, on 16 ball joints, with one crank turning it a quarter at a time through the XW, YW or ZW plane, evenly, or, on M, a servo doing it in steps the way a first prototype moves: hold, snap, overshoot, settle. Radii are constant like on a real part, only the lengths move. Painted sand and graphite with decals, silver rods, black seals, a coloured ring here and there, six blinking LEDs, five LED drones living in the cells, on graph paper. Space stops the crank, the arrows turn it by hand, drag orbits and sets which way it turns, and it turns round on its own every 8 to 22 s, M swaps the even spin for a stepping servo. `?clean` hides the page furniture.

## How

- **One plane at a time** (`state.ts`): the machine turns in XW, YW or ZW, never two at once. Compose turns in two planes and an edge can point straight at the eye; its strut would have to shrink to nothing. But after a quarter turn the tesseract stands on itself again, a cell has moved to the next place, so the next quarter can go in any plane. The pose is a base of whole quarter turns, a signed permutation of the axes, and one live angle in one plane on top. In one plane the shortest strut is 0.73 and the longest 3.03 (`node` sweep over the whole turn), and no two joints that are not neighbours come closer than 1.0. Seeing it from other sides is a 3D job: orbit.
- **Servo** (`state.ts`): a stiff spring on the crank angle (ω ≈ 19, ζ 0.68), so a step lands with one small overshoot and no wobble. The program steps a quarter turn at a time, the tesseract's own period: every hold is the same shape with the colours moved on. Half the steps come whole, the rest stagger in two or three uneven lurches with a tenth of a second between, then a hold of 0.9 to 2.7 s. One in ten goes back. The arrows move the target, the spring does the rest.
- **Struts** (`Machine.tsx`): per edge, a sleeve sunk into each ball, a stanchion sliding out of each sleeve as far as the strut needs up to 0.8, and a rod between the stanchions taking the rest. Each stage overlaps the one round it by 0.1 so nothing shows daylight. Two sleeves fully compressed are 0.65 with the balls, under the shortest strut. Seals are short fat rings at every mouth.
- **Colour**: the eight edges along w are sand, the other 24 graphite, so you can follow which edges are which as the inner cube turns out and the outer turns in.
- **Decals** (`decals.ts`): canvas textures on the cylinder UVs, not `DecalGeometry`. One sleeve in three has one, the rest are plain paint; x runs round the tube the way a viewer outside reads it, y along it, the open end at the top; the far sleeve of a strut hangs the other way up, so its lettering is turned round. Each carries a few of: hazard band at the mouth, brand round the tube, serial along it, barcode, a coloured tab, a cube's net as pictogram. Seeded, so the same every load.
- **Assembly marks** (`Machine.tsx`): a parting line round every ball with two screws on it, a groove round every sleeve by the ball with a screw beside it. A screw is a steel disc flush with the surface and a darker hex socket in it; the eye reads the recess. All instanced, four draw calls for 272 marks.
- **Drones** (`Drones.tsx`): five LED drones live in the tesseract, on its boundary. A drone is inside one of the eight cells, a cube with one coordinate held at ±1 and three free, and can only leave through a square face into the neighbouring cell: cruise a while, fly to the face slowing down, hesitate at the threshold with a nervous hover and a fast blink, then get pulled through with a burst, and the held coordinate swaps with the face's. Never straight back out the way it came. Every position and the whole trail are points in 4D, seen through the same turn and perspective as the struts: what reads as speed is partly the warp of the cell the drone is in, and the trail bends as the machine turns.
- **LEDs** (`Machine.tsx`): six status lights on the balls, each with its own blink: heartbeat, breathe, a flash every five seconds, fast steady, slow square, tick. A pinhead emissive bead in a black collar, a few pixels, no glow.
- **Light**: drei `Environment` from four `Lightformer`s, no HDR download, plus one directional. `ContactShadows` on a transparent canvas, the graph paper is CSS.

## Learned

- Perspective along w is what gives the w-edges length at all; in parallel projection they vanish. The eye distance is a trade between long w-edges (near) and a tame length range (far).
- `setFromUnitVectors(Y, dir)` and the same quaternion times `(1,0,0,0)` gives the strut's two ends the same roll, so decals on both sleeves line up. The far end is upside down though, and upside-down lettering looks mirrored at a glance: check the UVs before flipping the canvas.

```sh
pnpm -C 08 dev
```
