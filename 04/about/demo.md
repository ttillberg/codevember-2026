---
query: ?hour=16.35&hold&day=110
warmup: 8000
seconds: 10
ink: white
---
# 04 / Tangle, demo

How to show this day off in ten seconds: what the clip on the index plays. It opens in the last low sun on the town already knotted up, four flyovers and two scribbled streets laid over the base map off camera with the clock held. Then the clock runs: the sun goes, the lamps and the windows come on, the traffic turns into trails of light, and two more bridges land on top of it all. `pnpm grab 04 --clip` reads this file (see `scripts/clip.mjs`).

The strokes are laid with `window.paint(points, bridge)` in map metres, not with a hand on the screen: there is no ghost of the brush in the clip, the roads are simply there from one frame to the next. Houses in the way of a bridge come down.

```setup
# the hour waits while the knot is tied: the page opens with the clock held (?hold)
# the knot it opens on: four long bridges across the middle, then two streets wound between them
js window.paint([{x:-190,y:-150},{x:-60,y:-60},{x:90,y:40},{x:200,y:150}], true)
wait 1500
js window.paint([{x:170,y:-185},{x:70,y:-70},{x:-50,y:50},{x:-150,y:160}], true)
wait 1500
js window.paint([{x:-130,y:-195},{x:30,y:-150},{x:150,y:-90},{x:250,y:-20}], true)
wait 1500
js window.paint([{x:-230,y:70},{x:-90,y:130},{x:40,y:150},{x:150,y:205}], true)
wait 1500
js window.paint([{x:-150,y:-120},{x:-70,y:-175},{x:30,y:-115},{x:110,y:-165},{x:190,y:-120}], false)
wait 1500
js window.paint([{x:40,y:30},{x:90,y:70},{x:60,y:130},{x:110,y:170},{x:60,y:215}], false)
wait 1500
# and on it goes
js document.querySelector('button[aria-label="Run time"]')?.click()
```

```steps
# two more bridges while the light goes
wait 2500
js window.paint([{x:-100,y:-20},{x:0,y:-100},{x:110,y:-30}], true)
wait 3000
js window.paint([{x:-40,y:200},{x:30,y:90},{x:130,y:20},{x:230,y:60}], true)
wait 3500
```
