---
warmup: 8000
seconds: 10
---
# 07 / Hollow, demo

A few short strokes of the bristle brush in light blue, lilac and pink, the balloon turning a little under them. Each stroke is a grab: it paints and it turns the balloon, and let go while still moving the balloon keeps turning, slowly.

The tool comes in through localStorage (bristle, gloss, a light blue, turntable off). The hue moves with C held and the mouse going sideways, 180 px for the whole wheel (up and down would change the shade): blue 0.55, lilac 0.76, pink 0.92.

```init
try {
  localStorage.setItem('codevember-07-tool', JSON.stringify({ brush: 'bristle', liquid: 0.6, size: 0.08, finish: 'gloss', auto: false, hue: 0.55, shade: 0.7, hex: '#66ccff' }));
} catch {}
```

```steps
drag 600,560 700,575 760,585 450ms        # light blue
wait 1100
move 760,585 798,585 150ms +c             # to lilac
drag 600,630 690,600 750,570 450ms
wait 1100
move 750,570 779,570 150ms +c             # to pink
drag 600,590 680,640 740,660 450ms
wait 1100
move 740,660 673,660 150ms +c             # back to light blue
drag 600,600 690,590 760,600 450ms
wait 1100
move 760,600 798,600 150ms +c             # lilac
drag 600,560 700,610 450ms
wait 1500
```
