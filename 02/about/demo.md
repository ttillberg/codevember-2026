---
query: ?clean&seed=7
warmup: 3000
seconds: 10
xseconds: 30
ink: white
---
# 02 / Shatter, demo

How to show this day off: what the clip on the index plays, and the half minute for X. `pnpm grab 02 --clip` and `pnpm grab 02 --x` read this file (see `scripts/clip.mjs`). Coordinates are in a 1200 × 1200 viewport; the pane (0.9 × 0.8 m at this aspect) fills its middle. A press on the glass is a bullet, so a shot is a drag that goes nowhere.

The pane is always the same one (`?seed=7`).

## The index clip: three bullets, then it goes

One idea: the whole arc. Three shots a second apart, each web stopped by the ones before; Space, and every crack runs to its end; the pane holds for a beat, then falls, with a second of slow motion in the middle of the fall.

```steps
wait 500
drag 520,500 521,500 60ms
wait 1100
drag 760,640 761,640 60ms
wait 1100
drag 430,760 431,760 60ms
wait 1200
key Space
wait 1250
# slow motion: a press held while it falls
drag 600,600 601,600 1400ms
```

## The half minute for X

1. **Close up, 0–9 s.** Zoomed in on the first impact: the web, the tips creeping, the ticks. A second bullet next to it.
2. **Back out, 9–16 s.** Three more over the pane.
3. **The fall, 16–30 s.** Space; held in slow motion for most of the fall, then let go.

```x
wait 600
drag 520,520 521,520 60ms
wait 400
wheel -900 520,520
wait 3500
drag 700,560 701,560 60ms
wait 3000
wheel 2000 600,600
wait 1500
drag 800,700 801,700 60ms
wait 1200
drag 400,780 401,780 60ms
wait 1200
drag 640,380 641,380 60ms
wait 1500
key Space
wait 1300
drag 600,600 601,600 6000ms
```
