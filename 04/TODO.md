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

Laying a stroke froze the frame for about 200 ms on a desktop. Then the brush left a ghost, the rules ran after the frame was shown, and the town was rebuilt a piece a frame (`useLater` in `App.tsx`). The town grew and that was 300 to 360 ms again. Now: the rules in a task of their own, then the ground, the trees, the traffic and the people two frames apart; trees, bushes, lamps and walks ask a grid of the road stretches near them instead of every road (`clearOf`, `onRoad` in `geo.ts`), the traffic only looks for lanes within reach when the roads change (`setNet` in `sim.ts`), and the deck height of a bridge starts from the stretch it found last (`along` in `geo.ts`). All give the same answers as before. Longest task after a road or a bridge is laid, M2 Pro, headless Chrome, dev server: none over 50 ms on either map (it was 314 ms on the first map and 357 on `?debug`).

- The longest piece left is the rules themselves, about 35 ms of the 60 on `?debug`, and the ground at about 45. A worker would take `derive` and `buildNet` off the main thread, but the network is full of object references and would have to be rebuilt on this side; `buildGround` gives back plain arrays and could go with them.
- Not measured on a phone.

## Smearing

A smear rebuilt the whole town at every move of the hand: about 400 ms each, two pictures a second at best (measured in a headless drag: 9.6 s of long tasks for 20 moves on `?debug`). Two thirds of it was the trees asking every road whether they stood clear of it, then the common ground, the traffic moving over, and the ground.

Now nothing is built while the hand moves (`wet.ts`). The grab and the hand are uniforms, and everything that lies on the roads is pushed in its vertex shader by the falloff `smear()` gives the strokes: the ground (its ribbons are laid in pieces of 6 m so they can bend), the traffic, the signals, the works, the street trees, the lamps, the people, and the WebGPU lights. Houses, lots, the woods and the park stay, as they do when the smear is laid. When the hand rests for 140 ms the ground is made of the paint where it is, so what merges shows, and only what the hand did since is pushed. When it lets go the town is made again as for a stroke; until each piece is, it stays pushed. The painting that is laid is the same as before. Measured on the M2 Pro, 40 moves in two seconds: the picture changes with every move (about 20 a second, as fast as the moves came, at 30 frames a second) on both maps, where it was about 2 a second; the longest task after letting go is 51 ms on the first map and 59 on `?debug` (it was about 300 and 330), and none at all when the hand rested before letting go.

- The push is not the rules: a road pushed onto another merges only when the hand rests or lets go. Measured over the road within reach of a junction pushed 15, 30, 60 and 100 m, the preview is off from the road that is laid by 1, 2, 4 and 5 m at the median, 5, 8, 15 and 22 m for one point in ten; more where roads merge, dodge a house or are dropped.
- Roads are pushed over the houses and lots, and dodge them only when they are made again.
- Pushed further than about 40 m the falloff folds over itself: the paint overlaps itself like real paint, and the WebGPU lights, which go back through the push, smudge there.
- The signs and hoardings (`Signs` in `Life.tsx`), the park and its bushes stay put and are put up again on release.
- Shadows are not pushed: the ground under a pushed road keeps its shadows, a pushed street tree leaves its own behind until the next shadow update.
- Not tried by hand with a mouse or a finger, only with a headless drag; not tried on a phone.

## Squeezing

Smearing roads together is where the tangle comes from. It should come out dense but whole. Counted in a headless squeeze test (two rounds of dragging eight points towards the middle): about 16 of 71 roads end up too short for their junctions, and 7 pairs lie partly on each other.

- The too-short ones are mostly at roundabouts and parking lots, which do not merge with each other.
- Bridges land in the middle of crowded junctions and are still low there.
- A twist and a pinch brush.

## Endless: tiles

`tiles.ts` makes the strokes of any tile of an endless grid from a seed; `?tile=i,j&detail=0|1|2` looks at one. Counted headless over 9 x 9, 25 x 25 and 41 x 41 tiles: every border crossing agrees with the neighbour's, nothing merges, no road is pulled off its stroke, grown a size or too short for its junctions, every lane is reached from the ways in and reaches a way out, 0.6 ms a tile.

- `?endless` is the treadmill, as a first cut: a window of two tiles by two, laid together as one place where they lie in the grid (`place` in `net.ts`), and moved on when the drone passes the middle of a tile (`Drone`, `onWindow` in `App.tsx`). Nothing is shifted back to the origin. Houses and woods are planted a tile at a time by the tile's own number and kept, the strokes of a tile that is left are put away and taken out again (`holdStrokes`), the shadows follow the drone, the two light maps follow the window. Flown two tiles north and back by script: the same woods, houses and roads, a painted bridge still there, no errors, day and night. Measured headless on the M2 Pro: a frame 10 to 12 ms where one tile is 2, up after 2.7 s where one tile is 0.7, 540 vehicles. Left: a move of the window is about seven long tasks in a row, 130 to 360 ms the first and up to 240 after (new tiles are planted then; nothing is made ahead of time); undo does not reach back past a move; the park, pitch and school are only in the hand-drawn tile; the corners of the tiles are nearly empty; the people cost about 5 ms a frame, four times as many being walked; the WebGPU light map has half the texels to a metre; the vehicle count is three times one tile's, not by length of road; a tile that comes into the window has parked cars but no traffic until it drives in; a stroke across a border goes with the tile its middle is in; not flown by hand, not on a phone.
- The treadmill as first thought: a window of tiles round the drone, shifted back to the origin as it moves. It needs the strokes of several tiles laid together (each offset by `TILE`), and then `far()` in `net.ts` no longer says where the ways in are: it is a circle of 400 m round the middle of one tile. The generator avoids it by never letting a lane stop outside that circle; with a moving window the ways in are where a stroke leaves the window.
- A stroke that crosses a border is two strokes, one in each tile, that end on the same point. Laid together they have to be joined into one (same point, same `w`), or the rules see two ends meeting, which also works but pins a node there.
- Houses, trees, parks and the fixed buildings per tile. `BUILDINGS` and `PADS` in `net.ts` stand in every tile: in 9 x 9, 77 of 81 tiles have a road through at least one of them (median 2 of the 7). The planting runs on whatever is loaded, so a tile planted at detail 1 and again at 2 gets other houses.
- Detail: a tile further off is asked for with less. The levels nest (the strokes of 0 are the first of 1, and so on), so the big roads do not move; but a lane that joins a street puts a junction on it, so the street's own nodes shift a little when the level goes up.
- The lanes are tidier than the hand-drawn ones: every one meets its road squarely and keeps 50 m from the next, because that is what is known to come through the rules. Twice as many, doubling back, is the reference; that needs ROOM to be less than 44 first.
- All tiles are alike in the middle: the same crossing of the same two roads. The roundabout is only ever on a street corner, because a ring laid over a road that is already there (the grid is at the level below) keeps that road as a chord through its middle.
- Traffic, 180 vehicles for an hour on each of the 80 tiles round the hand-drawn one, two seeds: 2,520 through at the median against 1,925 and 2,214 on the hand-drawn map, and every way in is used. But the woods tiles clog: half of their runs end with a vehicle that has stood five minutes, 6 of 22 with ten or more, 2 locked solid (-4,-3 and 3,-3; -4,-3 already with only its streets). 180 is too many for 4 to 6 km of road: the count should follow the length of road in the window.
- A map with no parking at all crashed the traffic (`setRoute` picked from an empty list): guarded, one line in `sim.ts`.

## Model

Done: strokes are the only state, `derive()` in `intent.ts` walks them over shared nodes and picks the styles, the base map is strokes. Paint on paint thickens per stretch. Lots are obstacles. Signals one to a block.

- Roundabouts are in: painted circles, and junctions with five arms or more. Left: yield triangles, a kerbed island, signs.
- A painted roundabout should push parking lots aside, or stop at them, not lie on top.
- More blocks: slip lane, ramp, one-way.
- Rules that read more of the network: size from what connects and how far it goes.
- A layer of attributes on the nodes or on a map beside them ("large road", "bridge").
- ROOM (44 m) is one number for every road size. Small roads could sit closer.
- The network clogs: base map after about ten minutes of traffic time, a scribbled one sooner. Measure it by running `Sim` without a browser (throughput, where cars stand and why); the script for that is not in the repo yet.
