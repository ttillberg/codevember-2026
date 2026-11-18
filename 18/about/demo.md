---
ink: white
crop: 1000
query: ?clean&bare&arms=1-50-0.5-60,2-55-0.35-220,3-60-0.25-100,5-50-0.18-250&root=0.3
warmup: 3000
seconds: 10
---
# 18 / Pendulum, demo

How to show this day off in ten seconds: what the clip on the index plays. `pnpm grab 18 --clip` reads this file (see `scripts/clip.mjs`). Coordinates are in a 1200 × 1200 viewport.

Just the pendulum, in action: four arms on the formula (×1, ×2, ×3, ×5, each shorter than the one it hangs from) and the tail each joint has just drawn. No panels (`?clean`), and no centre line or rings where it hits (`?bare`): on the index it is a picture of a thing swinging, not of an instrument.

The motion is started from the top as the clip starts (`R`). A bar is two seconds at 120, so ten seconds is five bars: the loop closes on itself, and the still, which is the last frame, is the top of a bar. Every arm starts the bar somewhere in its swing (its phase: right, left, right, left), so that frame catches the chain bent, not hanging straight.

```setup
key r
```

```steps
wait 1000
```
