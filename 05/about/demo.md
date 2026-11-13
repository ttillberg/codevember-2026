---
warmup: 8000
seconds: 10
---
# 05 / Moss, demo

The letter M, covered in all five mosses. The alphabet is unlocked through localStorage and M picked before the clip; most of it is sown off camera with each species in turn, so it has grown in when the clip starts, and the last strokes are laid live while it settles.

```init
try { localStorage.setItem('codevember-05-alphabet', '1'); } catch {}
```

```setup
js document.querySelector('.letter-pop button[data-choice="M"]').click()
wait 3000
key 1
drag 350,280 640,290 920,280 350ms
drag 350,320 640,330 920,320 350ms
drag 350,360 640,370 920,360 350ms
key 2
drag 350,400 640,410 920,400 350ms
drag 350,440 640,450 920,440 350ms
drag 350,480 640,490 920,480 350ms
key 3
drag 350,520 640,530 920,520 350ms
drag 350,560 640,570 920,560 350ms
drag 350,600 640,610 920,600 350ms
key 4
drag 350,640 640,650 920,640 350ms
drag 350,680 640,690 920,680 350ms
drag 350,720 640,730 920,720 350ms
key 5
drag 350,760 640,770 920,760 350ms
drag 350,800 640,810 920,800 350ms
drag 350,840 640,850 920,840 350ms
key 1
drag 350,880 640,890 920,880 350ms
drag 350,920 640,930 920,920 350ms
wait 4000  # let it grow in
```

```steps
key 5
drag 350,300 640,560 920,300 700ms
key 2
drag 350,900 640,700 920,900 700ms
key 3
drag 360,600 360,300 600ms
drag 860,300 860,900 600ms
key 1
drag 350,450 640,700 920,450 700ms
```
