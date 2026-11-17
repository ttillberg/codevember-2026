# 01 / Fold

2026-11-01

Cut out a Malmö building and fold it up. Pick a sheet first, simplest first:

- **Korsvirkeshus, Lilla torg**: half-timbered, gable to the square. Base, a strip of four walls, two roof slopes, nine tabs.
- **Bo01, Västra Hamnen**: a tall box under one zinc slope, rust render on the street, glass balconies. Base, four walls (two of them trapezoids), the roof off the back wall, seven tabs.
- **Slottsmöllan**: a smock mill. An octagonal base, eight sides leaning in, a cap facet over each, sails on a shaft. 34 pieces: the folds come from the faces' normals (the sides' lean, the bends between neighbours), the front's cap facet hangs off its neighbour so the shaft can have the front's top edge, the sails hang print to the tower with their canvas printed on the back.

- **Fiskehoddorna, Banérskajen**: three fishing huts in a row, falu red and blue-grey with white corners, the sign on the end, a black canopy over the fish counters. The front is a pleat: shop front, the canopy's underside folding out, the canopy sloping back up to the wall, the wall on up to its saw-toothed gables (concave, so it lists convex parts). The end walls are notched where the canopy meets them so their tabs take each part. The roof is one strip of six slopes off the left wall, folding ridge, valley, ridge, held from under by a tab on every gable edge.
- **S:t Petri, Gamla staden**: the church's square brick tower and its tall copper spire.
- **Hyreshus, Möllevången**: five floors of brick under a hipped roof: trapezoids on the long walls, triangles on the ends, glued along the hips and the ridge.
- **Malmöhus, Slottsholmen**: a squat ten-sided rundel under a low slate cone.

- **Rikstelefon, Lilla torg**: the green telephone kiosk, its enamel sign; the smallest sheet.
- **Längor, Gamla Väster**: low houses in red, ochre and white under one long roof of orange tiles and moss.
- **Stadshus i rad, Gamla Väster**: three floors each in sky blue, yellow and red.
- **Mazetti, Gamla Väster**: the firewall with MAZETTI'S ÖGON-CACAO painted on it.
- **Röda huset, Lilla torg**: four red floors over a café; the awning is the same pleat as the huts', the bay's gable stands up above the eave, the ridge runs along the square (roof off the back wall, the front's eave tabs either side of the bay).
- **Kallbadhuset, Ribersborg**: pale boards and white trim on its pier over the water.
- **Malmö Live, Dockplatsen**: three sheets, hotel tower, concert hall, congress hall, on `shed.ts` (Bo01's net, any size, flat when front and back are as high).
- **Turning Torso, Västra Hamnen**: a square tower turning a quarter on its way up. A twisted wall isn't flat, so each side is a column of triangles, two to a band, unfolded from the 3D tower (`apex` puts each new corner at its true distances, away from the last). Each fold is the bend between its triangles' normals, its sign whichever lands the corner where the tower has it in fold space. Floors are printed as bands clipped at true heights, so they run on across the folds. 65 pieces, the hardest sheet.

The towers (S:t Petri, Malmöhus, the mill, the kiosk) come from one builder, `src/models/tower.ts`: n sides, a lean, a cap, sails if wanted.

Each sheet keeps where it was left while another is on the mat.

- **S:t Gertrud, Östergatan**: Kuntzegården, yellow ranges under tiled roofs round a cobbled yard, in through an arch from the street. The base is the whole block; off each edge a strip runs out: outer wall, the roof's two faces, the yard wall hanging down from the inner eave to stand on the base. One depth all round puts the hips and valleys at 45°. Only the outer corners carry tabs (one in a valley would hang free in the range behind it). The yard, cafe tables and all, is printed on the base's back, the side that faces up once built.
- **Västra skolan, Kungsparken**: three tall floors of brick, a clock in the bay's gable. The red house's net (`makeTorget` takes any size), its pleat shrunk to a stone ledge.
- **Slottet, Stadsbiblioteket**: the library's old part, red brick under slate, a stepped gable standing up above the roof at each end. The steps rise past the roof's line, so the gables carry no roof tabs: the roof hangs off the right wall, the left wall's eave tab holds it, its ends tuck inside the gables. The gables are concave (their parts are a column per step) and their backs, showing over the roof, are printed brick.
- **Ljusets kalender, Stadsbiblioteket**: the library's glass hall, the park and the old part in its panes.

**The board**: a big sheet of cardboard (1200 × 900 mm) printed with a town at the houses' own scale (`src/town.ts`): a square of cobbles in fans round a statue, granite curbs, flagstone pavements, four cobbled streets running out to the edges, lanes crossing them to make blocks, a small lawn with a row of trees in one block, packed gravel in the rest. Where streets cross, the cobbles run over the curbs. New buildings stand round the square, off the cobbles and the lawn, the nearest the middle with some room round them. The camera holds the square, the lawn and what stands on the board, not the whole sheet. Once a building is built and standing, *Put it on the board* takes it to a sheet of cardboard (kraft on top, the flutes along its edges) and the sheet starts over, so the same building can go on several times. On the board: drag one to move it, tap it to turn it a quarter, drag it off the edge and it falls away; a sideways drag on the mat turns the view, pinch and wheel zoom. The board is kept in this browser (`localStorage`). `src/board.ts`; the last card in the picker opens it.

- `src/net.ts` any net: panels in sheet mm, hinged into a tree from the base, each with its rest fold angle. Tabs glue behind a named panel. A concave panel (the sails) lists convex parts for the overlap check. `makeHouse` makes a gabled house.
- `src/models/` the buildings: each a net, its print (`art`, and `backArt` for the blank side) and a name for its card. `tabOff` puts a tab on the outside of an edge whichever way it runs; `foldOrder` is tabs first, then from the base out.
- `src/fold.ts` folds the tree into world matrices; `checkGlue` proves every tab lands flat inside its panel.
- `src/art.ts` shared print pieces (windows, doors, tiles, tabs, a panel's own frame) and the sheet as one SVG, rasterised once into the texture. The picker shows the same SVG small.
- React Three Fiber. `src/App.tsx` the canvas, the card and the page around it; `src/Desk.tsx` the cutting mat and the sun; `src/Effects.tsx` GTAO over a 4x MSAA target; `src/rig.ts` the orthographic iso camera, fitted, with the hand's zoom, pan and turn.
- `src/game.ts` the card and the hands on it (popping, seams, folding, turning, undo), plain three. On a hot update the scene asks the old game what it is (`save`), makes a new one with the new code and puts it back (`load`): an edit anywhere keeps the card where it was, history included. A full reload goes through `src/keep.ts` (session storage) to the same end. `src/hud.ts` is the zustand store the page reads: hint, undo, redo, the buttons' doings.
- `src/paper.ts` the card: extruded 0.35 mm, a printed skin on top; one group per panel, the waste is the sheet with the net as a hole. Panels and frame stop short of the cut line by a 1 mm groove.
- `src/cut.ts` press-out: the cut line is split into borders, each panel's unbroken stretch of cut edges (16). Each groove is bridged by a thin membrane that darkens under strain. A press right on a border pops it; a thumb on the face nearby bears on every border around it, more the closer and the longer it pushes. The piece rises a step above the sheet per pop; the last one frees it and the frame slides off.
- `src/folding.ts` folding by hand, at any time, by the fold lines only: each hinge belongs to the panel beyond it (away from the base). A tap near a fold line (about 7 mm, 12–26 px on touch, hidden lines excluded) folds that panel or opens it, the line drawn under the pointer; a drag from it folds by hand, the panel's middle traced along its arc from under the finger. A panel is pinned when anything that would move with it (it and all it carries) lies where a panel that stays lies (same plane give or take a card, its middle inside the other's outline) and would push into it, not slide along it: a tab glued behind its wall, the left wall whose eave tab is under the roof. A pinned seam is drawn red; a tap makes it give and spring back, the stuck part's seam pulsing red. Faces never fold, they take the thumb; a seam nearer than a cut border wins. Press and drag and it follows the pointer along its own arc. A panel still hanging in the sheet (it, or anything it carries, has a border left) gives a few degrees and no more, its borders flash. Let go past half way, or flung, and an under-damped spring shuts it; shut is a stop, like the mat, so it lands and taps back instead of swinging through what it shuts against. A pointer over a panel that can fold makes it give 5°, upwards whichever way that is. Seams, the camera's frame and the mat all read the pose without that give, so a peek never moves what is under the pointer (no flicker at the edge of a seam's reach). Glued tabs sink a card's thickness as they close, and they follow the panel they glue to: it shuts, they tuck in ahead of it; it opens, they come out. Folding the six big panels builds the house.
- Once free and settled, and once something is folded, a drag on a face tips the piece over that way (a thumb still sliding from the last pop never stands the flat sheet up): a quarter turn about the horizontal square to the drag, snapped to the mat's grid. Faces fold nothing, so the drag is free for it.
- A sideways drag on the bare mat takes the view a quarter round the card, the way the mat is dragged.
- Cmd/ctrl-click (two fingers on a phone) gives a quarter turn too: a side face spins it about y, the front tips it about x, a top rolls it about z, the way a push into the screen there would send it.
- `?debug` (or `d`) draws every border: blue still standing, green popped.
- Popping is generous: a border takes its neighbours either side with it (a quick run of snaps), and once only a few are left (two, or 15% of a big sheet) they go by themselves. All one step for undo.
- The piece keeps to its base: as it comes free it turns over by itself, base down, so everything folds up from the base. After that it only turns when it is turned (space, the button, a drag on a face, cmd-click). Should it still lie print up (an undo), a fold turns it over first.
- Undo / redo (cmd-z, shift-cmd-z, the buttons bottom centre): every pop, fold and turn is a step, a whole gesture one step. Folds spring back, turns ease back, a frame that had slid off comes back.
- Pinch zooms (up to 3×) about the fingers, two fingers pan, a twist turns the whole scene about the vertical, a quick two-finger tap turns the card; wheel and trackpad pinch zoom on a desktop. Nothing on the page selects or calls out on a long press.
- Turning over is a button (space). Whatever is lowest stands on the mat, so turned over by hand the house stands on its ridge, upside down, until it is flipped back.

`?cut` starts with the piece already out. Keys: `c` pops all, `f` pops, flips and folds everything in order, space flips, `r` starts over.

The canvas is sized to what is visible (100% of a fixed box, not 100vh), and every hit is measured from its rect: on a phone 100vh runs under the browser's bars and touches land off, worse the lower they are. 
Pointer moves are coalesced per frame: read `getCoalescedEvents()` or a fast slide skips borders.

Gable tabs that meet the roof hinge at a corner taper at `90 - pitch` so they never lean over the roof on the flat sheet.

```sh
pnpm -C 01 test   # vitest: the gabled net in depth (glue, borders, folding, pinning), and every building: lies flat, closes, one cut line, stands, prints, folds up
pnpm -C 01 dev
ngrok http 5173   # to play it on a phone anywhere; the dev server allows ngrok hosts
```
