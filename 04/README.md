# 04 · Tangle

A drone parked over a junction at the edge of a big city: an arterial, a cross street, two back streets, a strip mall, a gas station, and blocks of housing with lanes winding through them, after Xinpaifang in Chongqing. Daylight through haze, running at sixty times life.

The look is taken from drone pictures of the Huangjuewan interchange in Chongqing: sun-bleached concrete, scrub and red earth, pale slab blocks with blue roofs, everything flattened by the haze.

Drag on the ground and paint follows the brush. Only the strokes are kept. Every time they change, rules make the town again from nothing. Each stroke is walked in small steps and takes the node that is already near, or lays a new one where there is room. So two roads never lie on each other, paint on paint is the same road again, and the arms of a junction stay well apart. Then each run between junctions gets its road style, stop lines, stalls or signal. The place itself is nine strokes painted in advance. The traffic moves over to the new network and thinks again.

- **Road** (drag): a four-lane road. It joins what its ends touch and makes a junction of what it crosses. Paint along a road that is there and it grows a size instead. One that ends in the open is a two-lane cul-de-sac with a yard at its end: room to turn, parking either side, and paving up to the houses beside it. One painted out into the haze is a way in: traffic starts coming down it. None goes through a parking lot. Houses are in the way and nothing takes them down: the road bends round them and squeezes between them, and where it cannot, it ends.
- **Roundabout**: draw a circle with the road brush, back to where it began. It has to close on itself and be big enough to be meant. It is as big as it was drawn, one way round, and everything it crosses joins it. A junction that ends up with six arms or more turns into a roundabout by itself.
- **Bridge** (cmd or ctrl + drag): one straight span, or one even arc where a house is in the line, on piers. It lands only at its two ends and flies over roads, parking and low houses. One that crosses an earlier bridge goes over it. Start or end a stroke on a deck, with either brush, and it hangs on that bridge there: a ramp down to the ground, or a link from one level to another, with a junction up in the air.
- **Smear** (shift + drag): push the roads that are there, like wet paint. Everything within reach goes along, junctions and traffic included, less the further away it is. Parking lots and the far ends of the map stay put.
- **Undo** (cmd + Z).
- **P** (or space) pauses. It is always a timelapse, sixty times life. Painting works in a still too.
- Two fingers and the right button move the drone. It keeps its height: there is no zoom.

## What is there

- `net.ts`: the road network. Roads become lanes, junctions get connector lanes and their conflict points, lots get stalls. Lane-level Dijkstra for routes.
- `sim.ts`: the traffic. Cars follow lanes, keep distance with IDM, obey signals, yield by road rank and turn, take the gaps their driver accepts, change lanes, park and leave. Seeded, so the same day replays.
- `vehicles.ts`: seven body types from tapered boxes, instanced, in the colours cars actually come in.
- `intent.ts`: the strokes, and the rules that derive roads between junctions from them. The base map lives here as strokes.
- `paint.ts`, `Painter.tsx`: the tools. They only add, move or mark strokes.
- `haze.ts`: the place fades out with distance from its middle, not from the camera, so its edges are lost from every angle. Cars come and go only out there.
- `World.tsx`, `geo.ts`: scrub, asphalt, sidewalks, paint, buildings, trees, built from the network. Street trees follow whatever roads there are.
- `Life.tsx`: people on the sidewalks and footpaths, bikes along the kerb, and signs on everything: hoardings on roofs and on poles by the road, banners down the ends of the blocks, shop fronts. The writing is made up in the shader. Lamp posts stand down both sides of every proper road, and video screens at the big junctions and along the arterial, each running its own adverts.
- `facade.ts`: the faces of sixties housing, drawn on a canvas: four bays by four floors a sheet, one layer a style.
- `Town.tsx`: slab blocks in rows and a few towers, each wearing a sheet from `facade.ts` in its own paint, their concrete and footpaths, and what people keep on a roof. Planted once, and in the way of everything painted or smeared after.

## Learned

- A roundabout needs no code of its own in the traffic: it is one-way roads that outrank their arms. The one exception is the box rule, which must not hold cars already on the ring, or a full ring never moves again.
- A parking lot as a grid of tiny junctions gridlocks at once. One road snaking through the aisles cannot.
- "Don't block the box" has to be a promise of room in the lane beyond, not a look at whether its last car is moving.
- Cutting strokes where they cross and merging what is near does not survive a scribble: flat angles and stacked roads. Walking strokes over shared nodes with a minimum distance does, with far less code.

## Not yet

- Crash physics: a car whose lane is painted away just disappears.
- People and bikes are set dressing. They cross on red, the cars do not see them, and nobody goes anywhere in particular.
- The network still clogs after some minutes of traffic, with or without help.
- A road cannot be painted closer than 44 m to another: it becomes that road. Coarse, but it is what keeps a scribble from turning into shards.
- A painted roundabout ignores parking lots and lies straight over them.
- A roundabout made from a crowded junction locks up when the roads leaving it are full. On an open one the traffic keeps going round.
- Size reads little from the network: only dead ends. No attribute layer.
