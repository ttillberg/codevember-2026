---
query: ?clean
warmup: 9000
seconds: 10
---
# 16 / Spore, demo

`?clean`: the moss alone at dusk, no slingshot, no pouch, no buttons. The clip ends on the screengrab: the same spot,
into the low sun under a fern, and the fungi in it pushing up out of the moss (planted growing just before the
clip starts: they take ten seconds and more), while a few pinches are sown and one flung, the dust going up, and
the look drifts a little. The setup uses the dev globals (`me`, `look`, `fungi`), so record from the dev server:
`pnpm grab 16 --clip --url https://localhost:5116/`. Coordinates are in a 1200 × 1200 viewport.

```setup
# to the screengrab's spot: five metres off, facing a little right of the sun
js (async () => { const w = window; w.me.x += 5; w.me.z += 5; await new Promise((r) => setTimeout(r, 2500)); const L = w.shellMat.uniforms.uLightDir.value; w.look.tYaw = w.look.yaw = Math.atan2(-L.x, -L.z) + 0.2; w.look.tPitch = w.look.pitch = -0.07; })()
wait 1500
# the screengrab's fungi, planted growing
js (async () => { const w = window, { groundHeight: G, mossAt: M } = await import('/src/world.ts'); const y = w.look.yaw, fx = -Math.sin(y), fz = -Math.cos(y), rx = Math.cos(y), rz = -Math.sin(y); for (const c of w.fungi.list) c.wither = c.age; for (const [k, a, s, seed, sc] of [['puffball', 0.8, 0.06, 11, 1.3], ['puffball', 0.95, 0.16, 12, 1.2], ['puffball', 1.05, 0.02, 15, 0.9], ['morel', 0.78, -0.1, 13, 1.3], ['morel', 0.92, -0.18, 14, 1.1], ['chanterelle', 0.72, -0.02, 16, 1.4], ['puffball', 0.88, -0.03, 17, 1.0]]) { const x = w.me.x + fx * a + rx * s, z = w.me.z + fz * a + rz * s, g = G(x, z); w.fungi.spawn(k, x, g + 0.03 * M(x, g, z), z, { seed, scale: sc }); } })()
wait 7000
```

```steps
# a pinch sown where you click (a quick tap), the dust goes up between them
wait 500
drag 780,880 780,880 60ms
wait 1500
drag 400,900 400,900 60ms
wait 1500
# held: flung at the sight, it arcs over the moss into the light
drag 600,560 600,560 320ms
wait 1600
drag 700,920 700,920 60ms
wait 2500
```
