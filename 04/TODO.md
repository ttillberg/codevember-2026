# 04 todo

## Realism

Reference: drone pictures of the Huangjuewan interchange, Chongqing. First pass done: faded grade with haze, sidewalks and concrete aprons, footpaths, firs, bushes and street trees, slab blocks and towers with windows.

- People and bikes that obey the lights and the cars, and go somewhere: bus stops, shop doors, the yards.
- Day and night are in (`haze.ts`, `Sun` in `App.tsx`): low warm sun morning and evening, a moon, lamps with their glow on the ground, lit signs and rooms, head and tail lamps, beams on the road and long-exposure trails (`Cars.tsx`). No real lights, no new pass; a frame costs what it did (8.6 ms before and after in a build, 2 pixels to a point, M2 Pro). Left: whether the long shadows step is judged by sums, not by eye (they are drawn every third frame under 20 degrees of sun, every sixth otherwise); lamp glow and beams are laid over the ground and do not light cars, walls or trees; trails cut the corner on a tight turn and there are at most 2400 stretches of them; the screens are as bright by day as by night; people carry no light; the page background and `theme-color` stay day grey; night on a phone is not looked at; the share image and clip are still daytime.
- The same lights as a WebGPU long exposure, to be compared with the strips (`Glow.tsx`, Lights in the pane; the default on a desk where there is a WebGPU, the strips on a phone and everywhere else). Measured at night in headless Chrome on the M2 Pro, dev server, 1400 x 900 at 2 pixels to a point, sixty frames in a row with both pipelines drained: off 18.4 ms, strips 18.3, WebGPU 19.0. What the page's own adding of the two canvases costs is outside that number and is not measured. Left: the layer is not under the tilt shift, the bloom or the grade, so its trails are sharp where the picture is blurred and are not toned with it; trees, signs, lamp posts and vehicles do not hide it, only houses do, as plain boxes without what stands on the roof; a bridge deck does not hide the trails on the road under it; a trail on a bridge is put on the ground where the camera saw it, so a house under the bridge cuts it, and it slides if the drone is flown far within the second it lasts, and no picture was taken with traffic on a deck to see that it sits right; the lamp pools and the head lamp beams are still WebGL; the map is 32 MB of float texture and is faded whole every frame; not tried in Safari or Firefox, on a phone, or with a device that is lost half way; which of the two the day should ship with is not decided.
- Trees stand as thick woods with open ground between them (`forest()` in `World.tsx`), up to 12000 crowns. Left: the reference is nearly all canopy; what the woods cost on a phone is not measured; a wood ends at a road as if cut with a knife.
- Base map follows Xinpaifang, Chongqing (maps in `process/ref-chongqing-*.jpg`): a few straight streets and lanes winding inside the blocks. Left: lanes are all the same width and too tidy; the reference has twice as many, doubling back on themselves. ROOM (44 m) is what stops them sitting closer. Traffic on the lanes is not measured.
- Bridges stack and join: one that crosses an earlier bridge keeps clear of it, and a stroke that starts or ends on a deck hangs on it there, as a ramp or a link between levels (`layers()` in `intent.ts`, `onDeck()` in `Painter.tsx`). Left: traffic over the air junctions is not measured; no kerb or parapet fillet at an air junction; picking the deck under the finger is not tried on a phone; a short bridge that cannot get clear still cuts through the other; where bridges land, five arms turn the junction into a big roundabout.
- A road drawn with the road brush goes over by itself where it would cut a big road, two streets or more, or a bridge: the stroke is laid as road, bridge, road (`goesOver()` in `paint.ts`). A bridge takes down the town houses in its straight line (`standing()` in `intent.ts`); the sheds on the lots still stop it. Left: a house comes down even where the deck would clear it; the deck over one road is only about 7 m up; the stubs at either end grow parking courts; not tried by hand or on a phone.
- A bridge that comes down on the side of a road stops short in the air and forks into two one-way ramps, down on the right and up on the left (`forked()` in `paint.ts`, `one` and `open` on a stroke, `one` on a road). Left: the ramps are short and narrow, one lane of 3.2 m; they need 28 m of road clear of other junctions or the bridge lands the old way; whether cars use them well is not measured; an arrow on each but no signs; the squeeze brush has not met them.
- A painted bridge lands on 34 m of plain road of its own at each end, and that road goes on to the junction: no ramp comes down into a junction any more (`lay()` in `paint.ts`), the same way a road that goes over by itself already did. Left: the foot is a kink where the hand curved; a fifth arm still turns the junction into a roundabout; the forked ramps still come straight down onto their road.
- Bridges are one arc of a circle, bowed as the hand bowed (`arc()`, `bowOf()` in `intent.ts`), on piers, with short ramps (1 in 5) and a level deck, and go over houses that are low enough. Decks are kept clear of each other wherever they overlap, not only where their middles cross. Left: two decks still cut each other at their feet and where 45 m is not enough; a ramp over a ground road is not checked; an S drawn by hand becomes one arc. Left: a stroke that finds no way past the tall houses is refused without a word (3 of 9 in a test); abutment walls at the ramp foot; a bridge that follows the hand in two or three clean arcs.
- Facades: five drawn sheets in `facade.ts` (gallery slab, painted estate, striped tower, banded block, low house). Left: a ground floor of shops, window cages and awnings, a roughness map so glass shines.
- Autumn and street detail: leaf trees in yellow, orange and rust with their leaves under them, ginkgo rows along the streets, drifts of leaves in the ground shaders; roofs with parapets, stair heads, tin-roofed rooms, tubs, sun heaters and steel tanks; lane arrows before the stop lines, zebras on side roads, the yellow studded strip down every sidewalk; blue boards over the lanes before signals, a red sign where a road gives way (see "Road paint and junctions"). Left: bare trees, leaves blowing, bus stops and railings, signs on the bridges, and none of it measured on a phone.
- Firs are pines now: a stem and six ragged skirts of boughs, one instanced mesh (`pine()` in `World.tsx`). Not looked at on a phone.
- `?no=roundabout` keeps every junction a junction and a closed stroke a road; beside `?no=house,trees`. Not in the README.
- One house in three is kept and a quarter of those stand at an angle (`KEEP` in `App.tsx`, `turnSome()` in `Town.tsx`). A turned house is in the way as the straight box around it, so a road stops short of corners that look free; trees and lamps keep out of that box too; footpaths still lead to houses that are gone.
- The base map starts with three flyovers, laid through `addStroke` like painted ones (`BASE` in `App.tsx`). Left: where the west one lands on the north back street the junction is a big blob; two of them are out of the first frame; traffic over them is not measured.
- Roundabouts are harder to get: six arms, not five, and a painted circle has to close within 22 m and be 220 m round (`RING_ARMS` in `intent.ts`, `lay()` in `paint.ts`).
- Common ground is in (`Park.tsx`): a park with trodden walks and a cycle way, a pitch, a school, hedges round the little houses, scrub at the edge of the woods, and trees right up to the little houses (`World.tsx`). Nine draw calls, about 2450 instances (2200 of them bushes), no measurable frame cost (11.0 ms without, 11.2 with, in the noise). Left: the sites are three rectangles found by hand on the first map (`PARK`, `PITCH`, `SCHOOL`) and nothing is planted where they are no longer free; the pitch and school are at the left edge of the opening shot and the wide open ground north and south-east is out of it; on the `?debug` map the school is gone, a painted road runs through it; a road through the park that grows a parking court leaves the lawn under the court's paving but a tree or two beside the stalls; the park's own walkers turn round at its ends for ever and its bikes ride the cycle way up and down; players and children are boxes that run loops in the shader, cast no shadow and go home at dusk; the school is dark at night; the floodlights are on all night; bushes are faceted balls, not the leaf cards of the trees, and do not change with `?season=`; the hall's teal roof can read as a pool; not looked at on a phone.
- Terraced plots and construction sites in the open ground.
- Ground is flat. The reference is all hillside.
- A yard's parking can run into the wall of the house that stopped the road.

## Road paint and junctions

Done: lane arrows drawn from the turns each lane has (`arrow()` in `geo.ts`), an arrow in every lane of a roundabout and of a ramp, paint lifted a little off a deck so it is not buried in it, the studded strip under the asphalt so it no longer runs across another road, lines that stop where two arms of a junction still lie on each other, zebras as wide as the road, only where there is junction under them, never on a deck or a ramp. Signals are masts with an arm and heads (`lights` in `Cars.tsx`). A junction with flat arms is laid as its turns (`loose` in `buildGround`). People cross on the zebras (`link` in `People`).

- Islands: a gap between the turns stays only if it is about 14 m² with some body; in the maps so far every gap is smaller, so the junctions come out as curved asphalt and no island shows. Real triangles need the turns themselves to swing wider (`connect()` in `net.ts`), which changes the traffic.
- Where two roads lie between the same two junctions (paint on paint near a roundabout) an arm is a metre long and its corner is a ragged tooth of kerb.
- Zebras are still beyond the stop line, inside the junction, because cars stop at the end of their lane. To have them before the line the lanes would have to end earlier (`sim.ts`).
- A partly clipped zebra is dropped, but people still cross there.
- The lamp heads read as a pale bracket from above: the dark arm pokes through the head. Left alone.
- More ramps: a road that goes over by itself (`goesOver()` in `paint.ts`) has no way between the levels. It could hang two one-way ramps off its deck on each side of the road it crosses, the same pieces `forked()` makes, with air junctions on the deck. Not done: the traffic over air junctions is not measured yet.
- No yield triangles at roundabouts, no bike lanes or bike crossings.
- The signal lamps are a pixel wide from 800 m; whether they need to be bigger there has not been judged by eye in motion.

## Perks

In: emergency vehicles and road works (`sim.ts`, `Works.tsx`, the flashing in `Cars.tsx`, blue trails in both kinds of lights). Measured without a browser, twelve seeds, an hour of traffic time, 180 vehicles: vehicles through on the base map 2262 with neither, 2236 with emergency vehicles, 2296 with works, 2168 with both; on the `?debug` map 2307, 2381, 2394, 2321. One seed differs from the next by about 150, so none of it is a difference. The traffic costs about a tenth more to step (0.34 to 0.37 ms a second of its time); a frame costs what it did.

- An emergency vehicle is on screen for a second or two, one every 15 to 45 s (`CALL`). Whether that is too often has to be judged by watching, not from stills.
- Nobody pulls over. The signal goes its way (`rush` on a lane) and whoever would cross waits; it overtakes by changing lane. On one lane behind a queue it waits. The signal heads still show red while it drives through.
- In a jam it takes three times as long to cross (about 90 s of its time when the roads flow, 180 when they do not).
- Only back streets are closed (`roadOk`, rank 1): few vehicles have to go round, so the deviation is seldom seen. With the cross streets allowed too the `?debug` map lost a quarter of its traffic in three seeds of twelve, and choosing the busiest back street did the same. A closed road that shows needs the clog fixed first.
- A site whose road is painted over or smeared too far is dropped, not moved; undo does not bring it back, a new one opens in time.
- Lane closures are only on the kerb lane, on the ground, on stretches of 95 m and more with no parking. Nothing on bridges or roundabouts.
- People and bikes walk through the works.
- The beam of the head lamps in the WebGPU lights is one cone to a vehicle to a note (`REACH`, `SHINE` in `Glow.tsx`): about 2.7 million texels more to blend in a frame, not seen in the frame time (13.4 ms with or without, at night, M2 Pro). With the strips the WebGL beam is the old wedge, only longer.
- Not looked at on a phone.

## Reading the traffic

In: a set number of vehicles out, 60 on a phone and 180 on a desk (the ways in open and shut, `Sim.target`; the numbers are guesses), a heat map of every lane (`Heat` in `Traffic.tsx`), the Trace brush that shows the whole journey of every vehicle on the stretch that was clicked (`Journeys`), and four seasons from `?season=` (autumn unless it says otherwise).

- The heat map restarts whenever the roads change.
- Trace shows who is on the stretch now, not who has been; what a car drove before the roads last changed is lost.
- Winter has no snow on roofs or roads, and the same sun as autumn: every season keeps autumn's hours.
- None of it tried on a phone; the top right is getting crowded there.

## Heat

The fan was on. Measured in Chrome on an M2 Pro: the page is bound by pixels, not by triangles or script (the main thread idles nine tenths of the time). Now: thirty frames a second (`Pace` in `App.tsx`), the shadow map drawn every sixth frame with nothing that moves casting a shadow (`SHADOW_EVERY`), two samples of multisampling. `?debug` has the switches, and `window.three` to measure with.

- Still two canvas pixels to a point on a desk: about 13 to 15 ms a frame. A point and a quarter was 6.
- Not measured on a phone; a phone keeps 1.75 pixels to a point.
- Thirty frames a second while the drone is dragged has not been judged.
- Painting while the drone glides is not tried.
- The portrait shot is the old one; only the landscape shot was set by hand.
- The share image and the index clip still show the old shot and grade.

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
