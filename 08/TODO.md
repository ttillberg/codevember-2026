# 08 · TODO

What the cleanup review (/simplify) left on the table, to go through one by one.

## Hand-over at a wall

- [ ] **The hand-over as its own object.** One `handover: { from, to, corners, t, crossed } | null`. A wall ahead creates it, and a different face just replaces it. The crossing sets `crossed`. It ends on its own `done`, not on `s.wall`. Copy A stays bound to `from` and copy B to `to` for its whole life, so pose, clip side and colour carry through the crossing. That removes `lastWall`, `linger`/`LINGER`, `inT`, the "another wall ahead" check and the `tintHex*` caches. (`Drones.tsx`, hand-over block)
- [ ] **A wall as a pair of cells** `{(h1,s1),(h2,s2)}` instead of `{axis, sign}` seen from the current cell. Then it is never renamed at a crossing: no `came`, no `was`, no `s.came!`. The "other" cell is whichever of the pair it isn't in. It also makes `from`/`to` above free.
- [ ] **Swing after a crossing.** `heading`/`heading2` are slerped, and `q`/`q2` swap roles at the crossing. Each half probably swings between the two poses for ~0.1–0.2 s. Check it, and if so it is fixed by binding the copies as above.

## Flight

- [ ] **Who spawns the next piece.** `newTarget` is called from the flight and from the phase machine (catch → turn), with `if (!target.up)` arbitrating. In auto the flight always wins, so the phase machine's call only fires at the controls. Make the ownership explicit.
- [ ] **Probably dead guards.** Plans are only laid from the current cell now. The replan in the flight ("a wall on the held axis is no wall of this cell") and `k < 0` in `crossInto` may never fire. Log them for a while, then drop them.

## Feel / look (each one changes what you see)

- [ ] **Frame-rate-independent easing.** About 12 places use `x += (t - x) * Math.min(1, dt * k)`. Use `THREE.MathUtils.damp(x, t, k, dt)`, or alpha `1 - Math.exp(-k * dt)` for lerp/slerp. Same at 60 fps, different at 20.
- [ ] **ContactShadows `resolution={1024}`** re-renders the scene into 1024² every frame. With `blur={2.6}`, 256–512 probably looks the same. Compare.
- [ ] **Decal canvases at 2×** (`sharp(W, H)` defaults to k = 2). About 28 sleeves at 1024×832 is ~125 MB of VRAM. Try k = 1. Also: pass the height canvas as `bumpMap` and drop the JS normal-map bake (~7M pixels on the main thread when the logos land).
- [ ] **Nodes in the eye's view** are `SphereGeometry(R_NODE, 20, 14)`, ~520 triangles each, ×6 cube faces per frame. 12×8 is probably enough. Also skip lattice points beyond the fog (5.2).

## Performance, bigger jobs

- [ ] **Machine instancing.** Nodes, LED bezels, black seals and wipers are ~137 separate meshes that share `cyl`/`sph` and `black`. Make them one InstancedMesh per geometry, accent seals via `setColorAt`. ContactShadows pays for these twice.
- [ ] **Smoke on the GPU.** Up to 900 puffs are projected on the CPU every frame, and the buffer is re-uploaded. Instead: a 4D position as a `vec4` attribute, the pose as a `mat4` uniform, the projection in the vertex shader.
- [ ] **Dress the device once.** Every `device()` builds its decals again (9 DecalGeometry, 5 raycasts) and Drones makes two copies. Dress a template and `clone(true)` it, then clone only the materials.
- [ ] **One cached pose per frame.** Machine and Drones each call `pose()` (≈15 arrays). Have `tick()` write it once.
- [ ] **Allocations left per frame:** the V4 helpers in Drones (`add4`, `sub4`, `unit4`, `path`) and the closures `take`/`pose3`/`curve`; in Machine `side.clone()`/`from.clone()`, constant arrays in loops, the `putScrew`/`place` closures.
- [ ] **DOM writes in DroneCam.** The lock bracket's style is written every frame. Write only on change, and compute `CAM.w()` on resize.

## Small cleanups

- [ ] `ALL_CE = true` in Machine is a debug flag: decide. While it is on, `silver` (a 256×2048 canvas, 3600 strokes) is built for nothing.
- [ ] `canvasTex` (device.ts), the texture tail in `decals.ts` (repeated 3×) and the bare canvases in logos/smoke all do the same thing. One helper.
- [ ] `logo()` and `sheet()` in logos.ts share the cache → canvas → draw → store sequence.
- [ ] `toCell`/`toCellWith` return `number[]`, and Drones/DroneCam rebuild Vector3s and `Math.hypot` by hand. Give them a Vector3 out-param.
- [ ] `projectDir(m, p, d4)` in tesseract.ts, for the finite-difference trick in `stopBefore` and `pose3`.
- [ ] Hand-rolled clamps everywhere: `THREE.MathUtils.clamp`.
- [ ] The default `gripAt` 1.83 is still in `drone.ts` and is otherwise passed around. Check whether it is needed.
- [ ] "Bank the leftover quarters" is copied in `step()`, at the end of a glide and in `turnGlide`: one `bank()`.
