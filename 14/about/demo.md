---
ink: white
crop: 600
query: ?clean
warmup: 6000
seconds: 10
xseconds: 60
---
# 14 / Tension, demo

`?clean`: the string alone, top to bottom, in the dark. The clip, zoomed in on the middle 600 px: a mouse brushes over the string
without a click, at different heights and both ways, slow and fast: each crossing plucks it, soft or
hard, and the light runs out from it. The X video (with its sound): that pull as the hook,
plucks climbing the scale, a pluck and a magnetic slide with its flageolets, the arp following the
plucks with the delay behind, and Doom, heavy, to end on.

Defaults pinned: no remembered levels; snapshot 9 is Doom (recalled with the 9 key, off camera of
anything else). Coordinates are in a 1200 × 1200 viewport: the string is at x 600, from y 60 to 1140.

```init
try {
  localStorage.removeItem('codevember-14-bar');
  localStorage.setItem('codevember-14-slots', JSON.stringify({
    9: { preset: 'doom', scale: 'tension', arp: -1, delay: 0.5, sustain: 0.68, room: 0.86, pad: 0.18, harm: 0.77 },
  }));
} catch {}
```

```setup
# a soft tap off camera: the sound wakes, the call to action goes
drag 600,1000 600,1000 60ms
wait 1800
```

```steps
# zoomed in on the middle (crop: 600, so x and y 300 to 900 are what shows): a mouse brushing
# over the string, no click; each crossing plucks it, as hard as the brush was fast (slow drifts
# soft, flicks hard), at different heights, both ways
wait 300
move 520,380 680,395 220ms
wait 650
move 690,560 510,545 120ms
wait 600
move 500,780 700,795 300ms
wait 750
move 700,450 500,465 90ms
wait 400
move 500,490 700,475 110ms
wait 850
move 530,660 670,675 260ms
wait 650
move 690,340 510,355 100ms
wait 800
move 500,840 700,825 140ms
wait 700
move 700,600 500,615 200ms
wait 600
```

```x-setup
drag 600,1000 600,1000 60ms
wait 2200
```

```x
# 0-3 s, the hook: far aside through the constellation, let go
drag 600,560 700,550 860,535 1010,520 300ms
wait 1600
# 3-15 s, plucks climbing the scale, each on a note of it
drag 600,1030 690,1030 260ms
wait 1300
drag 600,930 700,930 260ms
wait 1300
drag 600,830 710,830 260ms
wait 1300
drag 600,730 720,730 260ms
wait 1300
drag 600,630 730,630 260ms
wait 1300
drag 600,520 760,520 300ms
wait 2000
# 15-28 s, a pluck, then a finger slides up it: the pitch glides note to note, flageolets at the nodes
drag 600,980 720,980 300ms
drag 600,980 600,760 600,420 1300ms
wait 1200
drag 600,360 720,360 300ms
drag 600,360 600,700 600,1000 1300ms
wait 1500
# 28-45 s, the arp on: it follows the plucks, the delay behind
key KeyA
drag 600,820 710,820 260ms
wait 1400
drag 600,700 720,700 260ms
wait 1400
drag 600,880 700,880 260ms
wait 1400
drag 600,600 740,600 280ms
wait 1400
drag 600,760 500,750 380,740 350ms
wait 1800
drag 600,650 720,650 260ms
wait 1500
wait 600
# 45-60 s, Doom (snapshot 9 turns the arp off too): heavy pulls through the dots, ending on the biggest
key Digit9
wait 500
drag 600,820 760,810 950,800 450ms
wait 2600
drag 600,640 470,630 250,620 450ms
wait 2600
drag 600,560 720,550 880,535 1060,520 367ms
wait 4000
```
