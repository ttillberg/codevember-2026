# 08 / Tesseract

2026-11-08

TESSERAKTA, a wardrobe in four dimensions, with its assembly manual. It comes flat-packed as the tesseract's net, eight boxes in the cross Dalí painted, and folds up through w over four numbered pages, each with the parts it needs in a box in the corner (letters, counts, screws), the boxes being fitted shaded grey, lettered, and an arrow showing where they go. Page 5 puts on the hinges and the handle, and the closed wardrobe turns in 4D for a while; on page 6 the door opens on rails of shirts and coats. Stuck? The ? calls customer service. Space plays or pauses, 1 to 6 or the arrows go to a page, D toggles the 4D turn, drag walks round it, shift and drag turns it in 4D. `?step=N` opens on a page, `?clean` hides the page furniture.

## How

- **Net and hinges** (`fold.ts`): folded, the wardrobe is [-A,A] × [-B,B] × [-C,C] × [0,L], tall and shallow in 3D, L deep in w. The net lies in w = 0, the base in the middle, an L-thick box on each face, the far box (w = L) under the bottom arm. A hinge is a rotation in a plane about a square face; the fold hinges turn in the plane of the arm's direction and w, a quarter turn standing the arm up along w. The far box turns on its own hinge in the net's frame first, then rides the bottom arm's turn, which sends w into +y and lays it over the base. Checked: folded, the 64 corners land on exactly 16 points.
- **Steps**: ±x, then the back and the door, then the top, then the bottom and the far box together. One after the other, the far box stands straight out along w and runs into the eye at w = D; together it closes like a lid.
- **The door** is the +z box. Folded, it hangs on its face with the +x box and swings in the zx plane like any door, but a door of a 4D wardrobe is a whole cube, so it opens as a frustum. Every square face is shared by two boxes: the six the door shares are drawn by the door only, from the moment each is joined (two coplanar faces, one white one grey, fight), and go with it when it opens.
- **Parts**: same size, same letter. Screws are counted, not written in: per step, the pairs of boxes that newly meet on a face, four screws a joint, none for the door's (it has to open). 0 + 8 + 12 + 28, 48 screws for 12 joints; with the door's 5 that's 17, the tesseract's 24 faces less the 7 hinges in the flat pack.
- **Inside**: three rails at three depths in w, hangers and shirts on each, all in 4D, through the same projection. Perspective along w scales them towards the base, so the inside runs back further than the box it's in.
- **4D → 3D**: centred on the mean of the carcass's corners, turned in XW, YW, ZW, perspective along w with the eye at D = 3. The 4D turn only lives on page 5, after a rest so the page is seen as printed: with the door open, it swings far enough out to cross the eye. Anywhere else the turn unwinds to the nearest whole turn before anything folds on.
- **Drawing**: orthographic camera, no lights. Faces are opaque white, pushed back with polygon offset; edges and contents are fat lines drawn twice from one geometry, solid black where depth passes, thin grey dashes with the depth test reversed (`GreaterDepth`) where a face covers them. Hidden line removal for free.
- **Arrows**: the path a point off the box's outer face (the door's free edge, for the door) takes through the whole step, through the same fold and projection, so the arrow is exactly where it's going.

## Learned

- `MeshBasicMaterial` white comes out grey under R3F's default ACES tone mapping. `flat` on the canvas.
- On a case-insensitive disk `tesseract.ts` and `Tesseract.tsx` are the same module to tsc.
- Keying faces by their centre with `toFixed` splits `-0.000` from `0.000`. Add 0 after rounding.

```sh
pnpm -C 08 dev
```
