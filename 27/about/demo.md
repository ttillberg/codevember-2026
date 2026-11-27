---
ink: white
query: ?clean&auto
warmup: 1300
seconds: 10
xseconds: 30
---
# 27 / Burrow, demo

`?clean&auto`: opens on the hole in the bank and runs in by itself, at a badger's rolling trot. Ten seconds: the daylight falls away, the exposure opens up, the torch sweeps a root and the walls, and the first fork comes into the beam. Coordinates are in a 1200 × 1200 viewport; `move` aims the torch.

```steps
wait 2400
# inside now: sweep the beam up to the roots, then across the wall
move 760,470 900ms
wait 1300
move 420,660 1300ms
wait 1200
move 600,580 900ms
wait 1200
```

The den is at the far end (`?at=N,1.4` starts just short of it): eyes first, then the animal.

```x
wait 2400
move 760,470 900ms
wait 1500
move 420,660 1300ms
wait 1500
move 600,580 900ms
wait 4000
# take the left hole
drag 500,600 760,600 900ms
wait 5000
move 700,500 1200ms
wait 3000
move 480,640 1200ms
wait 6000
```
