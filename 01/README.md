# 01 / Fold

2026-11-01

Cut out a Malmö building and fold it up. Pick a sheet first, simplest first:

- **Korsvirkeshus, Lilla torg**: half-timbered, gable to the square. Base, a strip of four walls, two roof slopes, nine tabs.
- **Bo01, Västra Hamnen**: a tall box under one zinc slope, rust render on the street, glass balconies. Base, four walls (two of them trapezoids), the roof off the back wall, seven tabs.
- **Slottsmöllan**: a smock mill. An octagonal base, eight sides leaning in, a cap facet over each, sails on a shaft. 34 pieces: the folds come from the faces' normals (the sides' lean, the bends between neighbours), the front's cap facet hangs off its neighbour so the shaft can have the front's top edge, the sails hang print to the tower with their canvas printed on the back.

Each sheet keeps where it was left while another is on the mat.

- `src/net.ts` any net: panels in sheet mm, hinged into a tree from the base, each with its rest fold angle. Tabs glue behind a named panel. A concave panel (the sails) lists convex parts for the overlap check. `makeHouse` makes a gabled house.
- `src/models/` the buildings: each a net, its print (`art`, and `backArt` for the blank side) and a name for its card. `tabOff` puts a tab on the outside of an edge whichever way it runs; `foldOrder` is tabs first, then from the base out.
- `src/fold.ts` folds the tree into world matrices; `checkGlue` proves every tab lands flat inside its panel.
- `src/art.ts` shared print pieces (windows, doors, tiles, tabs, a panel's own frame) and the sheet as one SVG, rasterised once into the texture. The picker shows the same SVG small.
- React Three Fiber. `src/App.tsx` the canvas, the card and the page around it; `src/Desk.tsx` the cutting mat and the sun; `src/Effects.tsx` GTAO over a 4x MSAA target; `src/rig.ts` the orthographic iso camera, fitted, with the hand's zoom, pan and turn.
- `src/game.ts` the card and the hands on it (popping, seams, folding, turning, undo), plain three. On a hot update the scene asks the old game what it is (`save`), makes a new one with the new code and puts it back (`load`): an edit anywhere keeps the card where it was, history included. A full reload goes through `src/keep.ts` (session storage) to the same end. `src/hud.ts` is the zustand store the page reads: hint, undo, redo, the buttons' doings.
- `src/paper.ts` the card: extruded 0.35 mm, a printed skin on top; one group per panel, the waste is the sheet with the net as a hole. Panels and frame stop short of the cut line by a 1 mm groove.
- `src/cut.ts` press-out: the cut line is split into borders, each panel's unbroken stretch of cut edges (16). Each groove is bridged by a thin membrane that darkens under strain. A press right on a border pops it; a thumb on the face nearby bears on every border around it, more the closer and the longer it pushes. The piece rises a step above the sheet per pop; the last one frees it and the frame slides off.
- `src/folding.ts` folding by hand, at any time, by the fold lines only: each hinge belongs to the panel beyond it (away from the base). A tap near a fold line (about 7 mm, 12–26 px on touch, hidden lines excluded) folds that panel or opens it, the line drawn under the pointer; a drag from it folds by hand, the panel's middle traced along its arc from under the finger. A panel is pinned when anything that would move with it (it and all it carries) lies where a panel that stays lies (same plane give or take a card, its middle inside the other's outline) and would push into it, not slide along it: a tab glued behind its wall, the left wall whose eave tab is under the roof. A pinned seam is drawn red; a tap makes it give and spring back, the stuck part's seam pulsing red. Faces never fold, they take the thumb; a seam nearer than a cut border wins. Press and drag and it follows the pointer along its own arc. A panel still hanging in the sheet (it, or anything it carries, has a border left) gives a few degrees and no more, its borders flash. Let go past half way, or flung, and an under-damped spring shuts it; shut is a stop, like the mat, so it lands and taps back instead of swinging through what it shuts against. A pointer over a panel that can fold makes it give 5°, upwards whichever way that is. Seams, the camera's frame and the mat all read the pose without that give, so a peek never moves what is under the pointer (no flicker at the edge of a seam's reach). Glued tabs sink a card's thickness as they close, and they follow the panel they glue to: it shuts, they tuck in ahead of it; it opens, they come out. Folding the six big panels builds the house.
- Once free, a drag on a face tips the piece over that way: a quarter turn about the horizontal square to the drag, snapped to the mat's grid. Faces fold nothing, so the drag is free for it.
- A sideways drag on the bare mat takes the view a quarter round the card, the way the mat is dragged.
- Cmd/ctrl-click (two fingers on a phone) gives a quarter turn too: a side face spins it about y, the front tips it about x, a top rolls it about z, the way a push into the screen there would send it.
- Folding from print up would send the panel into the mat and leave the base on top, so a fold there turns the card over first, base down, then folds up.
- Undo / redo (cmd-z, shift-cmd-z, the buttons bottom centre): every pop, fold and turn is a step, a whole gesture one step. Folds spring back, turns ease back, a frame that had slid off comes back.
- Pinch zooms (up to 3×) about the fingers, two fingers pan, a twist turns the whole scene about the vertical, a quick two-finger tap turns the card; wheel and trackpad pinch zoom on a desktop. Nothing on the page selects or calls out on a long press.
- Turning over is a button (space), never forced. Whatever is lowest stands on the mat, so folded print up the house stands on its ridge, upside down, until it is flipped.

`?cut` starts with the piece already out. Keys: `c` pops all, `f` pops, flips and folds everything in order, space flips, `r` starts over.

The canvas is sized to what is visible (100% of a fixed box, not 100vh), and every hit is measured from its rect: on a phone 100vh runs under the browser's bars and touches land off, worse the lower they are. 
Pointer moves are coalesced per frame: read `getCoalescedEvents()` or a fast slide skips borders.

Gable tabs that meet the roof hinge at a corner taper at `90 - pitch` so they never lean over the roof on the flat sheet.

```sh
pnpm -C 01 test   # vitest: the gabled net in depth (glue, borders, folding, pinning), and every building: lies flat, closes, one cut line, stands, prints, folds up
pnpm -C 01 dev
ngrok http 5173   # to play it on a phone anywhere; the dev server allows ngrok hosts
```
