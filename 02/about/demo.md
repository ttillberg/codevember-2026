---
query: ?clean&seed=7
warmup: 3000
seconds: 10
xseconds: 30
ink: white
---
# 02 / Shatter, demo

How to show this day off: what the clip on the index plays, and the half minute for X. `pnpm grab 02 --clip` and `pnpm grab 02 --x` read this file (see `scripts/clip.mjs`). Coordinates are in a 1200 × 1200 viewport; the glass fills all of it, and the three targets are side by side across the middle. A press that stays put is a bullet (a drag that goes nowhere), one that travels is the shock.

The pane is always the same one (`?seed=7`).

## The index clip: four bullets, then the shock

One idea: the whole arc. Four shots, each web stopped by the ones before, a beat, then a swipe and everything the cracks have cut loose blows out at once, the rest of the pane left standing, with a second of slow motion while the shards are in the air.

```steps
wait 400
drag 420,480 421,480 60ms
wait 700
drag 760,620 761,620 60ms
wait 700
drag 560,740 561,740 60ms
wait 700
drag 820,400 821,400 60ms
wait 1500
# the shock
drag 250,600 950,580 250ms
wait 1100
# slow motion: a press held, where it is, while it falls
drag 600,900 601,900 1500ms
```

## The half minute for X

1. **Close up, 0–8 s.** Zoomed in on a bullet hole: the web, the tips creeping, the ticks.
2. **Back out, more bullets, 8–15 s.**
3. **The shock, 15–30 s.** A swipe; held in slow motion for most of the fall, then let go.

```x
wait 600
drag 520,520 521,520 60ms
wait 400
wheel -900 520,520
wait 6000
wheel 2000 600,600
wait 1500
drag 800,700 801,700 60ms
wait 900
drag 400,780 401,780 60ms
wait 900
drag 700,380 701,380 60ms
wait 1500
drag 250,600 950,580 250ms
wait 900
drag 600,600 601,600 7000ms
```
