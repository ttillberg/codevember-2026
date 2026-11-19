---
query: ?clean&seed=7
warmup: 3000
seconds: 10
xseconds: 30
ink: white
---
# 02 / Shatter, demo

How to show this day off: what the clip on the index plays, and the half minute for X. `pnpm grab 02 --clip` and `pnpm grab 02 --x` read this file (see `scripts/clip.mjs`). Coordinates are in a 1200 × 1200 viewport; the pane (0.9 × 0.8 m at this aspect) fills its middle. The first press on the glass is a bullet, the second the football; either is a drag that goes nowhere.

The pane is always the same one (`?seed=7`).

## The index clip: a bullet, then the football

One idea: the whole arc. A bullet and its web, a beat to look at it, then the football through the middle of the pane, with a second of slow motion while the shards are in the air.

```steps
wait 600
drag 520,500 521,500 60ms
wait 2600
# the football
drag 640,560 641,560 60ms
wait 900
# slow motion: a press held while it falls
drag 600,600 601,600 1500ms
```

## The half minute for X

1. **Close up, 0–8 s.** Zoomed in on the bullet hole: the web, the tips creeping, the ticks.
2. **Back out, 8–11 s.**
3. **The football, 11–30 s.** Through the pane; held in slow motion for most of the fall, then let go.

```x
wait 600
drag 520,520 521,520 60ms
wait 400
wheel -900 520,520
wait 6000
wheel 2000 600,600
wait 2500
drag 660,560 661,560 60ms
wait 700
drag 600,600 601,600 7000ms
```
