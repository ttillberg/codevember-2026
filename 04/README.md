# 04 · Tangle

A drone parked over a stroad junction outside an American town: an arterial, a cross street, a big box lot, a strip mall, a gas station, a drive-through. Daylight, running at twelve times life.

Drag on the ground and paint follows the brush. Only the strokes are kept. Every time they change, rules make the town again from nothing. Each stroke is walked in small steps and takes the node that is already near, or lays a new one where there is room. So two roads never lie on each other, paint on paint is the same road again, and the arms of a junction stay well apart. Then each run between junctions gets its road style, stop lines, stalls or signal. The place itself is nine strokes painted in advance. The traffic moves over to the new network and thinks again.

- **Road** (drag): a four-lane road. It joins what its ends touch and makes a junction of what it crosses. Paint along a road that is there and it grows a size instead. One that ends in the grass is a two-lane cul-de-sac. None goes through a parking lot.
- **Roundabout**: draw a circle with the road brush, back to where it began. It is as big as it was drawn, one way round, and everything it crosses joins it. A junction that ends up with five arms or more turns into a roundabout by itself.
- **Bridge** (cmd or ctrl + drag): lands only at its two ends and flies over the rest.
- **Smear** (shift + drag): push the roads that are there, like wet paint. Everything within reach goes along, junctions and traffic included, less the further away it is. Parking lots and the far ends of the map stay put.
- **Yield** (alt + click): take a step of priority from a stroke, the whole length of it, so it gives way where it went first. A fourth click gives it back.
- **Undo** (cmd + Z).
- **Timelapse / Normal / Pause** (space pauses): twelve times life, life size, or a still. The sun keeps the same pace. Painting works in all three.
- Two fingers, the right button and the wheel move the drone.

## What is there

- `net.ts`: the road network. Roads become lanes, junctions get connector lanes and their conflict points, lots get stalls. Lane-level Dijkstra for routes.
- `sim.ts`: the traffic. Cars follow lanes, keep distance with IDM, obey signals, yield by road rank and turn, take the gaps their driver accepts, change lanes, park and leave. Seeded, so the same day replays.
- `vehicles.ts`: seven body types from tapered boxes, instanced, in the colours cars actually come in.
- `intent.ts`: the strokes, and the rules that derive roads between junctions from them. The base map lives here as strokes.
- `paint.ts`, `Painter.tsx`: the tools. They only add, move or mark strokes.
- `World.tsx`, `geo.ts`: grass, asphalt, paint, buildings, trees, built from the network.

## Learned

- A roundabout needs no code of its own in the traffic: it is one-way roads that outrank their arms. The one exception is the box rule, which must not hold cars already on the ring, or a full ring never moves again.
- A parking lot as a grid of tiny junctions gridlocks at once. One road snaking through the aisles cannot.
- "Don't block the box" has to be a promise of room in the lane beyond, not a look at whether its last car is moving.
- Cutting strokes where they cross and merging what is near does not survive a scribble: flat angles and stacked roads. Walking strokes over shared nodes with a minimum distance does, with far less code.

## Not yet

- Crash physics: a car whose lane is painted away just disappears.
- The network still clogs after some minutes of traffic, with or without help.
- A yielding road shows only by its stop lines.
- A road cannot be painted closer than 44 m to another: it becomes that road. Coarse, but it is what keeps a scribble from turning into shards.
- A painted roundabout ignores parking lots and lies straight over them.
- A roundabout made from a crowded junction locks up when the roads leaving it are full. On an open one the traffic keeps going round.
- Size reads little from the network: only dead ends. No attribute layer.
