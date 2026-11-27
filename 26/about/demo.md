---
query: ?clean&seed=246
warmup: 1200
seconds: 10
xseconds: 24
crop: 820
---
# 26 / Anamorph, demo

`?clean&seed=246`: opens directly on a folded, matte-paper architectural house with separate wall, roof, window-pane, and door colors plus subtle watercolor gradients. Each fold projects the standing 3D house live 1:1 onto a new flat house net underneath, sheds the previous silhouette cutout, and folds seamlessly through an endless chain of architectures.

```steps
wait 500
key Space
wait 2100
key Space
wait 2100
key Space
wait 5300
```

```x
wait 700
key a
wait 11500
key a
wait 3200
drag 460,620 760,540 2600ms
wait 800
js document.querySelector('[data-mode="reverse"]').click()
wait 600
key Space
wait 4600
```
