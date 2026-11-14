# 04 todo

## Realism

Reference: the frames from `road.mov` (soft, hazy drone footage of a European block).

- Colour grading: faded, lifted blacks, low saturation, bluish haze. Drone view.
- Fill the space between roads: more concrete, sidewalks, walking paths.
- Different trees and greens: conifers, round crowns, bushes, hedges, varied grass.
- Houses: multi-storey blocks with windows, flat roofs with parapets and roof clutter.

## Model

Done: strokes are the only state, `derive()` in `intent.ts` walks them over shared nodes and picks the styles, the base map is strokes. Paint on paint thickens per stretch. Lots are obstacles. Signals one to a block.

- Roundabouts are in: painted circles, and junctions with five arms or more. Left: yield triangles, a kerbed island, signs.
- A painted roundabout should push parking lots aside, or stop at them, not lie on top.
- More blocks: slip lane, ramp, one-way.
- Rules that read more of the network: size from what connects and how far it goes.
- A layer of attributes on the nodes or on a map beside them ("large road", "bridge").
- ROOM (44 m) is one number for every road size. Small roads could sit closer.
- The network clogs: base map after about ten minutes of traffic time, a scribbled one sooner. Measure it by running `Sim` without a browser (throughput, where cars stand and why); the script for that is not in the repo yet.
