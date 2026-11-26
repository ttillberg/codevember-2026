# 01 / Fold

2026-11-01

Fold the simplest pure white 3D gabled house pre-cut from a single 150 × 150 mm square of origami paper.

## Geometry

- A symmetric 7-panel cross net inscribed inside the exact `150 × 150 mm` origami square (`[-75, +75]² mm`) with the four symmetric corner off-cuts pre-removed.
- Exact silver-ratio (`1 : √2`) floor proportions (`W = 42 mm`, `D = 42√2 ≈ 59.4 mm`, `H ≈ 24.3 mm`, `45°` pitched roof `R = 21 mm`, `L = 21√2 ≈ 29.7 mm`), only **6 fold creases**, zero glue tabs, and real punched openings (arched door, flanking windows, side windows, and circular attic oculi).

## Interaction

- **Fold by hand**: click or drag any wall or roof flap directly up into place, or scrub the fold slider.
- **Keys**: `Space` step through walls / roof / unfold, `F` fold or unfold all, `R` unfold flat & reset view, `?` help.
- **Query params**: `?clean`, `?fold=0..1`.

```sh
pnpm -C 01 test
pnpm -C 01 dev
pnpm -C 01 build
```
