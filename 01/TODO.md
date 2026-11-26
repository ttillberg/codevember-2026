# 01 · TODO

Ideas for making the origami folding itself more varied and intricate across layers while preserving true flat-sheet geometry and the zero-transition 1:1 camera projection.

## Flat-net topologies (beyond the `+` cross)

- [x] **Wrap-around ribbon net.** Hinge one wall to `base` and chain the other three side-to-side (`left ← back → right → front`) so the walls unroll and wrap horizontally around the floor like a folding screen before the roof closes on top. Generalized `origamiHouseNet.ts` & `origamiPaperMesh.ts` to arbitrary 2D crease-vector hinges (`hingeAxis: V2`) and universal wall/roof local frames (`wallFrame`, `roofFrame`), with dedicated ribbon-wrap choreography in `main.ts` and 0.0000 mm Vitest closure proofs across all 6 roof types.
- [x] **Hexagonal / octagonal petal nets.** 6- and 8-sided pavilions, gazebos, and lighthouses whose walls and roof petals radiate from a polygonal floor and close like a lotus bloom (`buildPolygonPetalNet` with arbitrary outward crease vectors `[+sin φ, -cos φ]`, circular Pantheon oculus skylights on polygonal top decks, radial far-to-near lotus choreography, and 0.0000 mm Vitest closure proofs).
- [x] **L-shaped & twin-wing compound nets.** Main house plus an attached side wing unfolding as an asymmetric tree (`lwing` topology) combining an unbroken L-shaped floor, valley outer wing corner, reverse **mountain re-entrant courtyard corner fold**, waterfall gable ridge fold, and sloping shed wing roof — proven to 0.0000 mm in Vitest.

## Multi-stage mountain + valley folds

- [x] **Setback / stepped towers.** Ground podium walls fold up (`+90°` valley) → mitered horizontal terrace ledges fold inward (`+90°` valley) → narrower upper tower walls fold back upright (`-90°` mountain) → upper spire or crowned skylight pagoda closes on top (4–5 hinges deep, `setback` topology), with tiered setback choreography and 0.0000 mm Vitest closure proofs.
- [x] **Pleated / sawtooth / butterfly roofs.** Alternating valley-and-mountain 2-bay factory sawtooth concertina roofs (with punched north-light skylight bays & falling skylight chads) and inward V-shaped mid-century butterfly roofs on both `cross` and `ribbon` nets, proven to 0.0000 mm in Vitest.
- [ ] **Uncut corner gussets (Masu-box fold).** Keep diagonal-creased triangular paper at the 4 wall corners on select houses so corners pinch and tuck cleanly inside as the walls rise.

## Linked kirigami pop-up details

- [ ] **Hinged opening shutters & doors.** Leave select window and door cutouts hinged along one vertical edge instead of discarding them, swinging open in a quiet delayed ripple right as the host wall finishes rising.
- [ ] **Pop-up balconies, stoops & bay windows.** Chatani-style parallel cuts inside a wall driven by a 3-hinge linkage (`valley → mountain → valley`) that push forward into cantilevered balconies, recessed porticos, or exterior entry steps.
- [ ] **Fold-out roof cupolas / lanterns.** A miniature 4-wall roof lantern unfolding out of the top deck of mansard and flat roofs.

## Folding choreographies & polish

- [ ] **Per-house folding dances.** Pair each net topology with its own choreography: far-to-near curved wave (current), clockwise ribbon wrap, opposing clamshell pairs, radial petal bloom (6/8-sided towers), and tiered setback rise with secondary detail settle.
- [ ] **Update `01/about/demo.md` & share image.** Refresh the demo script and screengrab to showcase the single-wave staggered fold, colored duplex palette, zoom-out, and zero-transition recursive projection across multiple layers.
