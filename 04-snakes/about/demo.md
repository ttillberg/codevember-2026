---
ink: white
query: ?clean
warmup: 5000
seconds: 10
---
# 04 / Tangle (snakes), demo

`?clean`: the knot alone. Ten seconds: eight snakes crawling through the pile under a slow handheld camera, then a tap on one and its pixel animation goes off in its scales, then another held down till it gets away along its track.

```steps
wait 1800
# a tap: the scales play where it landed
drag 600,560 601,560 120ms
wait 2600
# held: after a moment the snake gets away, faster the longer it is held
drag 430,760 431,760 1700ms
wait 3600
```
