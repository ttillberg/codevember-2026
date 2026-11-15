# 04 todo

## Realism

Reference: drone pictures of the Huangjuewan interchange, Chongqing. First pass done: faded grade with haze, sidewalks and concrete aprons, footpaths, firs, bushes and street trees, slab blocks and towers with windows.

- People and bikes that obey the lights and the cars, and go somewhere: bus stops, shop doors, the yards.
- Signs at night: they are the light of the place. No night yet.
- Much denser green: the reference is nearly all canopy. Needs a cheaper tree, or it costs frames on a phone.
- Base map follows Xinpaifang, Chongqing (maps in `process/ref-chongqing-*.jpg`): a few straight streets and lanes winding inside the blocks. Left: lanes are all the same width and too tidy; the reference has twice as many, doubling back on themselves. ROOM (44 m) is what stops them sitting closer. Traffic on the lanes is not measured.
- Bridges stack and join: one that crosses an earlier bridge keeps clear of it, and a stroke that starts or ends on a deck hangs on it there, as a ramp or a link between levels (`layers()` in `intent.ts`, `onDeck()` in `Painter.tsx`). Left: traffic over the air junctions is not measured; no kerb or parapet fillet at an air junction; picking the deck under the finger is not tried on a phone; a short bridge that cannot get clear still cuts through the other; where bridges land, five arms turn the junction into a big roundabout.
- A road drawn with the road brush goes over by itself where it would cut a big road, two streets or more, or a bridge: the stroke is laid as road, bridge, road (`goesOver()` in `paint.ts`). A bridge takes down the town houses in its straight line (`standing()` in `intent.ts`); the sheds on the lots still stop it. Left: a house comes down even where the deck would clear it; the deck over one road is only about 7 m up; the stubs at either end grow parking courts; not tried by hand or on a phone.
- Bridges are one straight span or one arc, on piers, with filled ramps, and go over houses that are low enough. Left: a stroke that finds no way past the tall houses is refused without a word (3 of 9 in a test); abutment walls at the ramp foot; a bridge that follows the hand in two or three clean arcs.
- Facades: five drawn sheets in `facade.ts` (gallery slab, painted estate, striped tower, banded block, low house). Left: a ground floor of shops, window cages and awnings, lit rooms at night, a roughness map so glass shines.
- Autumn and street detail: leaf trees in yellow, orange and rust with their leaves under them, ginkgo rows along the streets, drifts of leaves in the ground shaders; roofs with parapets, stair heads, tin-roofed rooms, tubs, sun heaters and steel tanks; lane arrows before the stop lines, zebras on side roads, the yellow studded strip down every sidewalk; blue boards over the lanes before signals, a red sign where a road gives way. Left: bare trees, leaves blowing, bus stops and railings, signs on the bridges, a lower sun, and none of it measured on a phone.
- Terraced plots and construction sites in the open ground.
- Ground is flat. The reference is all hillside.
- A yard's parking can run into the wall of the house that stopped the road.

## Reading the traffic

In: a field for roughly how many vehicles are out (the ways in open and shut, `Sim.target`), a heat map of every lane (`Heat` in `Traffic.tsx`), the Trace brush that shows the whole journey of every vehicle on the stretch that was clicked (`Journeys`), and four seasons from a button or `?season=`.

- Asking for fewer only shuts the ways in: the ones already out have to drive home first.
- The heat map restarts whenever the roads change.
- Trace shows who is on the stretch now, not who has been; what a car drove before the roads last changed is lost.
- Winter has no snow on roofs or roads, and the same sun as autumn.
- None of it tried on a phone; the top right is getting crowded there.

## Letting go of a stroke

Laying a stroke froze the frame for about 200 ms on a desktop. Now the brush leaves a ghost, the rules run after the frame is shown, and the ground, the trees, the traffic and the people are rebuilt in a frame each (`useLater` in `App.tsx`); routes are planned with a heap and `derive()` answers the same question once. Longest task measured after: about 130 ms.

- What the 130 ms is has not been found. Not measured on a phone.
- The rules still run on the main thread. A worker would take `derive` and `buildNet` off it, but the network is full of object references and would have to be rebuilt on this side.

## Squeezing

Smearing roads together is where the tangle comes from. It should come out dense but whole. Counted in a headless squeeze test (two rounds of dragging eight points towards the middle): about 16 of 71 roads end up too short for their junctions, and 7 pairs lie partly on each other.

- The too-short ones are mostly at roundabouts and parking lots, which do not merge with each other.
- Bridges land in the middle of crowded junctions and are still low there.
- A twist and a pinch brush.

## Model

Done: strokes are the only state, `derive()` in `intent.ts` walks them over shared nodes and picks the styles, the base map is strokes. Paint on paint thickens per stretch. Lots are obstacles. Signals one to a block.

- Roundabouts are in: painted circles, and junctions with five arms or more. Left: yield triangles, a kerbed island, signs.
- A painted roundabout should push parking lots aside, or stop at them, not lie on top.
- More blocks: slip lane, ramp, one-way.
- Rules that read more of the network: size from what connects and how far it goes.
- A layer of attributes on the nodes or on a map beside them ("large road", "bridge").
- ROOM (44 m) is one number for every road size. Small roads could sit closer.
- The network clogs: base map after about ten minutes of traffic time, a scribbled one sooner. Measure it by running `Sim` without a browser (throughput, where cars stand and why); the script for that is not in the repo yet.
