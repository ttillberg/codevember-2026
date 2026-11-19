---
query: ?clean&seed=19
warmup: 3000
seconds: 10
xseconds: 30
---
# 19 / Erosion, demo

How to show this day off: what the clip on the index plays, and the half minute for X. `pnpm grab 19 --clip` and `pnpm grab 19 --x` read this file (see `scripts/clip.mjs`). Coordinates are in a 1200 × 1200 viewport. In `?clean` the block sits in the middle of it: the top face is around 600,330, the left wall around 400,660, the right wall around 800,660, and the mammoth is in the right wall at 750,650.

The block is always the same one (`?seed=19`), and the tools are set here, not left to whatever was last used: the `init` block writes their sizes and forces where the page keeps them.

## The index clip: a shower over a block already cut up

One idea: what rain does to it. It opens on a block that is well hollowed out already: the `setup` block is eleven seconds of hard rain off camera, from a cloud nearly as wide as the block, so the water reaches every edge and the whole top comes apart into canyons, ledges and what is left standing between them. Then the water is given a moment to run off, and the tool is turned down.

What the clip itself shows is not a flood: a narrow, lighter shower drawn slowly across the top, the water finding its way down through what is already cut, over the lips and off the sides, and taking a little more with it. It does not loop: wearing only goes one way, the clip jumps back to the start. The still is the last frame.

```init
localStorage.setItem('codevember-19-brush', JSON.stringify({ force: [0, 0.7, 0.4, 0.7, 0.4], radius: [0, 42, 7, 50, 6] }));
```

```setup
# hard rain held on the middle of the top (a slow drag of a few pixels is a hold), then let it drain
drag 600,330 606,333 11000ms
wait 1800
# and for the clip a narrower, lighter shower
js erosion.brush(1, 15); erosion.level(1, 0.5)
```

```steps
# the shower, drawn slowly across the top
drag 500,330 600,300 700,340 4900ms
```

## The half minute for X

Thirty seconds, all four tools, all of them hard: everything at full force (the `x-setup` block turns them up, through the page's own `erosion.level`; the index clip keeps its gentler rain). No sound: the day has none.

1. **Rain, 0–7 s.** It is already raining when it starts (two seconds of it off camera), from a cloud nearly as wide as the block, so the water reaches every edge: at full force the falls eat in at once and the top comes apart. (A narrow cloud at that force only digs itself a pond.)
2. **The hose, 7–12 s.** `2`, swept down and across the left wall: a trench washed out of it.
3. **The wind, 12–19 s.** `3`, the hair dryer on the right wall, where the mammoth lies pressed in the surface: the wall goes, the bones stay.
4. **The scratch, 19–22 s.** `4`: four quick strokes over the skeleton and the wall beside it.
5. **Round the back, 22–30 s.** Two quarter turns, and from behind a last burst of rain (`1`), so it ends on water running through what was cut.

```x-setup
js erosion.level(1, 1); erosion.level(2, 1); erosion.level(3, 1); erosion.level(4, 1); erosion.brush(1, 42)
drag 600,330 606,333 2000ms
```

```x
# 1. rain, held on the middle of the top
drag 606,333 600,330 7000ms
# 2. the hose, swept over the left wall
key 2
drag 320,540 470,700 380,610 2500ms
# 3. wind on the right wall
key 3
drag 790,640 796,644 7000ms
# 4. scratch: over the mammoth and beside it
key 4
drag 680,610 840,690 500ms
wait 150
drag 840,610 680,700 500ms
wait 150
drag 690,660 830,650 500ms
wait 150
drag 860,560 700,720 500ms
# 5. round the back, and a last burst of rain
key ArrowRight
wait 2300
key ArrowRight
wait 2300
key 1
drag 600,330 606,333 2800ms
```
