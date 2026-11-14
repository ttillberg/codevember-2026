# 04 · Tangle

A drone parked over a stroad junction outside an American town: an arterial, a cross street, a big box lot, a strip mall, a gas station, a drive-through. Daylight, running at three times life.

Drag on the ground and a road follows the brush. Let go and it is built: cut into whatever it met, with junctions, stop lines and a signal where two big roads cross. The traffic moves over to the new network and thinks again.

- **Road** (drag): a four-lane road. It joins what its ends touch and makes a junction of what it crosses.
- **Bridge** (cmd or ctrl + drag): lands only at its two ends and flies over the rest.
- **Smear** (shift + drag): push the roads that are there, like wet paint. Everything within reach goes along, junctions and traffic included, less the further away it is. Parking lots and the far ends of the map stay put.
- **Yield** (alt + click): take a step of priority from a road, so it gives way where it went first. A fourth click gives it back.
- **Undo** (cmd + Z).
- Two fingers, the right button and the wheel move the drone.

## What is there

- `net.ts`: the road network. Roads become lanes, junctions get connector lanes and their conflict points, lots get stalls. Lane-level Dijkstra for routes.
- `sim.ts`: the traffic. Cars follow lanes, keep distance with IDM, obey signals, yield by road rank and turn, take the gaps their driver accepts, change lanes, park and leave. Seeded, so the same day replays.
- `vehicles.ts`: seven body types from tapered boxes, instanced, in the colours cars actually come in.
- `paint.ts`, `Painter.tsx`: the brush. A stroke is simplified, snapped and cut into the road list the network is built from.
- `World.tsx`, `geo.ts`: grass, asphalt, paint, buildings, trees, built from the network.

## Learned

- A parking lot as a grid of tiny junctions gridlocks at once. One road snaking through the aisles cannot.
- "Don't block the box" has to be a promise of room in the lane beyond, not a look at whether its last car is moving.

## Not yet

- Crash physics: a car whose lane is painted away just disappears.
- The network still clogs after some minutes of traffic, with or without help.
- A yielding road shows only by its stop lines.
