---
ink: white
crop: 760
query: ?clean
warmup: 3000
seconds: 10
---
# 18 / Pendulum, demo

How to show this day off in ten seconds: what the clip on the index plays. `pnpm grab 18 --clip` reads this file (see `scripts/clip.mjs`). Coordinates are in a 1200 × 1200 viewport.

The setup the page starts with, and nothing done to it: four arms on the formula, the scene alone (`?clean`, no panels). A bar is two seconds at 120, so ten seconds is five bars and the loop closes on itself: the chain is where it began. The chain hangs in the middle 760 pixels of the square, so the clip shows only those (`crop`).

```steps
wait 1000
```
