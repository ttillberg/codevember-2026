# 01 / Fold

2026-11-01

Endless recursive duplex origami architecture: fold a white-on-white pre-cut sheet into a matte black 3D house, project it 1:1 from your camera angle onto a brand-new different house underneath with zero transition, and repeat.

## Geometry & Projection

- **6 watertight flat-net archetypes**: `gable`, `mansard` (with hinged skylight deck + French cornice lip), `spire` (4-petal needle bell tower with belfry louvers), `hip`, `shed`, and `flat` (recessed modernist parapet), each varying size, story count, punched windows/doors, rotation, and flat-folded kirigami details (awnings, 3D L-corner chimneys, dormers).
- **Dynamic sheet & final-stage zoom-out**: larger houses automatically expand the underlying paper sheet & noon shadow frustum, holding the camera locked on swap (zero transition) and smoothly zooming out as the new house approaches its final folded stage.
- **Zero-transition 1:1 camera projection**: live `HalfFloatType` MSAA capture projected strictly onto the new flat sheet at `fold = 0`, dissolving cleanly off the surrounding ground paper the moment you fold or orbit so the projection stays strictly on the paper house.

## Interaction

- **Single-wave staggered fold**: press `Space` / click **Fold** to fold walls and roof together in one continuous staggered wave, or scrub the progress slider / click and drag individual flaps by hand.
- **Keys**: `Space` / `Enter` fold wave, `F` toggle fold/unfold, `R` reset to Layer 1, `?` help.
- **Query params**: `?clean`, `?fold=0..1`.

```sh
pnpm -C 01 test
pnpm -C 01 dev
pnpm -C 01 build
```
