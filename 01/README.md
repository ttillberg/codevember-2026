# 01 / Fold

2026-11-01

Endless recursive duplex origami architecture: fold a white-on-white pre-cut sheet into a 3D paper house, project it live 1:1 from your camera angle onto a brand-new different house underneath with zero transition, and keep folding through an infinite chain of houses.

## Geometry & Projection

- **Multi-archetype flat-net grammar**: `cross`, `ribbon`, `hex`, `oct`, `lwing`, `setback`, and multi-house wall-to-wall `village` composites with `gable` (classic, gambrel, stepped ladder, barrel vault, saltbox), `mansard`, `spire`, `hip`, `shed`, `flat`, `butterfly`, and `sawtooth` roofs, multi-story punched windows/mullions, and flat-folded kirigami awnings, chimneys, and roof dormers.
- **Live dual-pass 115 BPM overlapping projection**: captures the outgoing house live into a `HalfFloatType` MSAA ring-buffer target during the overlap window so the next flat house starts folding up while carrying a live-moving projection of the previous house finishing its roof.
- **Drastic above-ground perspective cuts**: seamlessly shifts between overhead plan, low horizon, inverted, and rolled viewpoints strictly above ground while staying 1:1 pixel-locked on the swap frame.

## Interaction

- **Production view (`/`)**: shows the Fold experience only — click **Fold** (or press `Space`) to fold and project onto the next sheet, toggle **Auto** (`A`) for a continuous overlapping chain, or drag directly on flaps and orbit the camera.
- **Debug workbench (`?debug`)**: unlocks all settings & knobs (`D`), the **Generations Catalog Grid** (`G` / `?debug&grid`), the infinite **Coastal Paper City** flyover (`C` / `?debug&city`), and controls help (`?`).
- **Query params**: `?clean`, `?auto=1`, `?fold=0..1`, `?debug`.

```sh
pnpm -C 01 test
pnpm -C 01 dev
pnpm -C 01 build
```
