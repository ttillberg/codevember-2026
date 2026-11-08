# 08 / Tesseract

2026-11-08

Fold a hypercube, drawn like a flat-pack assembly manual. The tesseract's net, eight cubes in the cross Dalí painted, folds up through the fourth dimension in four numbered steps, the cubes about to move shaded grey with an arrow showing where they go. On page 5 it is done and turns in 4D. Space plays or pauses, 1 to 5 or the arrows go to a step, D toggles the 4D turn, drag orbits, shift and drag turns it in 4D yourself. `?step=N` opens on a page, `?clean` hides the page furniture.

## How

- **Net and hinges** (`fold.ts`): folded, the tesseract is [-1,1]³ × [0,2]. The net lies in w = 0, the base cell in the middle, one cell on each face, the far cell (w = 2) under the bottom arm. Each hinge is a square face; folding about it is a rotation in the plane of the arm's direction and w, about the hinge's hyperplane. A quarter turn stands an arm up along w. The far cell turns on its own hinge in the net's frame first, then rides the bottom arm's turn, which sends w into +y and lays it over the base. Checked: folded, the 64 corners land on exactly 16 points.
- **Steps**: ±x, ±z, +y, then the bottom arm and the far cell together. Done one after the other, the far cell stands straight out along w to w = 4 and runs into the eye at w = D; together it closes like a lid and never gets past w ≈ 2.4.
- **4D → 3D**: centred on the mean of all corners (so it turns about its middle whatever the fold), turned in XW, YW, ZW, perspective along w with the eye at D = 3, so the far cell comes out half the size of the near one. The 4D turn only lives in the folded tesseract; anywhere else it unwinds to the nearest whole turn before unfolding.
- **Drawing**: orthographic camera, no lights. Faces are opaque white, pushed back with polygon offset; edges are fat lines drawn twice from one geometry, solid black where depth passes, and thin grey dashes with the depth test reversed (`GreaterDepth`) where a face covers them. That's hidden line removal for free, and on the folded tesseract it leaves the outer cell solid and everything inside it dashed.
- **Arrows**: the path a point off the middle of the cell's outer face takes through the whole step, through the same fold and projection, so the arrow is exactly where the cube is going. Shown at rest before a step, faded out as it gets going.

## Learned

- `MeshBasicMaterial` white comes out grey under R3F's default ACES tone mapping. `flat` on the canvas.
- On a case-insensitive disk `tesseract.ts` and `Tesseract.tsx` are the same module to tsc.

```sh
pnpm -C 08 dev
```
