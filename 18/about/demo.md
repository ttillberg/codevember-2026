---
ink: white
crop: 1000
query: ?clean&bare&colour&bpm=48&arms=1-50-0.5-60,2-55-0.35-220,3-60-0.25-100,5-50-0.18-250&root=0.3
warmup: 3000
seconds: 10
---
# 18 / Pendulum, demo

How to show this day off in ten seconds: what the clip on the index plays. `pnpm grab 18 --clip` reads this file (see `scripts/clip.mjs`). Coordinates are in a 1200 × 1200 viewport.

Just the pendulum, in action: four arms on the formula (×1, ×2, ×3, ×5, each shorter than the one it hangs from) and the tail each joint has just drawn. No panels (`?clean`), and no centre line or rings where it hits (`?bare`): on the index it is a picture of a thing swinging, not of an instrument.

In colour (`?colour`: green, cyan, a bluish purple and pink down the chain), and slow: 48 beats a minute, a bar every five seconds, so it is something to watch swing and not a blur. (At 120 it was five bars in the ten seconds, and hectic in a small square.)

The motion is started from the top (`R`), and the clip starts a third of a bar later: the first arm is then passing the middle of its swing, at its fastest, with the half bar it has just drawn trailing behind every joint. Ten seconds is two bars, so the loop closes on itself, and the still, which is the last frame, is that same moment: the chain in the middle of a swing, not at rest at the end of one.

```setup
key r
wait 1700
```

```steps
wait 1000
```
