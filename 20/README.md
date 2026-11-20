# 20 / Cocoon

2026-11-20

A preservation pod hanging by its cables in a hall. Push it and it swings, the cables follow, the door that never quite shut knocks on its hinge, and now and then a drop of blood lets go.

- **Model** (`model/build.py` → `model/cocoon.blend` → `public/cocoon.glb`): built from a turnaround sheet by a script (the sheet lives in `model/ref/`, kept out of the repo; `compare.py` needs it there), in Blender or without its window, two minutes with the bake:

  ```sh
  cd 20/model && /Applications/Blender.app/Contents/MacOS/Blender -b cocoon.blend --python build.py
  COCOON_STAGE=look Blender -b cocoon.blend --python build.py --python compare.py -- out.png   # no bake, held up against the sheet
  ```
  - `sheet.py` is what the sheet says, read off it by hand on a numbered grid: where each view sits on the sheet and its scale (the shell is 2.6 m tall without the cables, which sets it), the outline of the body in the front, back and both side views, and every plate traced as an outline in the view it is seen best in.
  - The form: the front and side outlines stood up as prisms and intersected (the front one made even first, the same half-width both sides at every height: the sheet's front is lopsided and the pod leaned like a parallelogram from behind, where the sheet has it even), then cut by a few slanted planes through points measured on the sheet: the ridge down the front where the seam is, the strip beside it, the 03 shield looking down 11 degrees so the line between them runs on the slant as the sheet draws it, the hatch, the right flank, the back corners, a ring round the top and one round the bottom. Everything comes in by a plate's thickness, so the plates' outsides are the outline.
  - The plates: every traced outline cuts the surface along the line of sight of its view, and each piece of surface belongs to the view it faces most. Its plate is the first traced outline it falls in; `open` is no plate. Where a side view sees machinery and the front sees plates, on a face turned well to the front, the front wins: the sheet does not agree with itself there. The 03 shield's own facet behind its stepped edge is turned more to the side, so there the side view wins and it is machinery, as the side view has it. Each plate is pulled in from its edges for the seams and given 6 to 8 cm of thickness, folding where the form folds.
  - Everything else is placed by pointing at a pixel of a view: a ray from that pixel finds the surface. The open back (a spine with lighter plates on it: the block with two lamps, the middle plate, the maker's plate, the foot; two heavy hoses down it in clamps, bending in at the foot and going on up to the ceiling as cables; thinner ones down the pockets either side, brackets, a bar across, the manifold, small lamps at the steps of the shell), the machinery behind the shields (a heavy hose down each flank bending forward at the foot, a thin one by it, boxes, clamps, lamps), hoses laid along the surface's own normal so they never stand off an edge, the latch and blocks in the seam, the deck on top with nine brass-collared ports, the runs of blood down the seam.
  - Markings (03, TYPE-A, STASIS PRESERVATION, the stasis mark and bars, RETECH HUMAN FURTHER, CONTAIN PRESERVE ITERATE, UEC, crosses, the split disc) the same way: each one shot along its view's line of sight and laid flat on the face it lands on, 1.5 mm above the plate. The left shield's group sits a little back from where the side view has it, halfway to where the front view has it; the right shield's further back, so it does not show from the front, which the front view says it does not.
  - Wear is baked: noise in object space for dirt, runs, specks and scratches, chips along the edges found with the Bevel node, an AO bake for dirt in the corners. Two 2k textures, colour and roughness + metal, for the plates only.
  - Inside: something wrapped, strapped to a cradle on the back wall.
  - `compare.py` renders the model at the sheet's own scale and angle, draws its outline over the sheet's picture with the traced one, and prints how much they overlap: front 94 %, sides 93 and 92, back 92. The sheet's views do not quite agree with each other, so that is about as high as it goes.

  The web side knows nothing of the shape, only names:
  - `pod`: the body, everything that swings is its child
  - `door`: child of `pod`, origin on the hinge, hinge along its local Z
  - `plug.NNN`: empties on the pod, local Z the way the cable leaves, custom props `radius` and `slack`
  - `socket.NNN`: empties in the ceiling, one per plug
  - `hang`: empty, the point it all swings from
  - `drip.NNN`: empties where it bleeds

  Export the `cocoon` collection as glb with modifiers applied and custom properties on.
- **Pod**: a pendulum under `hang` (two leans and a twist), not a rigid body. Drag it and a stiff spring holds it to the hand.
- **Cables** (`cables.ts`): verlet ropes, both ends pinned, the plug end by two points so the cable leaves the way the plug points. Bending is a soft link to the point two and four further on, which spreads a bend out instead of kinking. They are pushed out of the pod taken as an ellipsoid. The pod moves the cables, never the reverse.
- **Door**: a plate on a hinge under gravity, less the acceleration of the hinge, so it flaps when the pod is thrown about; a tired strut pulls it to, a dry hinge holds it where the pull is small, a stop keeps it from shutting. It rests a few degrees open whichever way the pod hangs. Drag it open: the drag follows the way the grabbed point would move on screen.
- **Blood** (`blood.ts`): a bead swells at each drip point, lets go with the speed the pod has there, falls. A hard swing shakes it loose early.
- **Debug panel** (bottom right, in dev or with `?settings` / `?debug`; open unless you folded it away last time: a chevron in its head folds it to a gear): views as on the turnaround sheet, front `1`, side `3` (again for the other side), back `9`, the usual perspective `0`, each easing round to the pod however it hangs; in the sheet's views it hangs straight and still, as the sheet draws it. Iso or perspective `5`. The reference `R`: the screen split beside or below, with the sheet's matching view, or the hall picture in perspective (from `model/ref/`, so only on the dev server). Hold still `H`, and a readout of the door and the swing.
- `?clean` hides the title and the panel. `?silk` is the first take on the word: one thread of silk spun around a glow (`silk.ts`).

```sh
pnpm -C 20 dev
```
