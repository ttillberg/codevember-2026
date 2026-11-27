# 26 / Anamorph

2026-11-26

Derived from `day-01`. Endless recursive duplex origami architecture: fold a pre-cut sheet into a 3D paper house, project it live 1:1 from your camera angle onto a brand-new different house underneath with zero transition, and keep folding through an infinite chain of houses.

## Geometry & Projection

- **Multi-archetype flat-net grammar**: `cross`, `ribbon`, `hex`, `oct`, `lwing`, `setback`, and multi-house wall-to-wall `village` composites with `gable` (classic, gambrel, stepped ladder, barrel vault, saltbox), `mansard`, `spire`, `hip`, `shed`, `flat`, `butterfly`, and `sawtooth` roofs, multi-story punched windows/mullions, and flat-folded kirigami awnings, chimneys, and roof dormers.
- **Live dual-pass 115 BPM overlapping projection**: captures the outgoing house live into a `HalfFloatType` MSAA ring-buffer target during the overlap window so the next flat house starts folding up while carrying a live-moving projection of the previous house finishing its roof.
- **Drastic above-ground perspective cuts**: seamlessly shifts between overhead plan, low horizon, inverted, and rolled viewpoints strictly above ground while staying 1:1 pixel-locked on the swap frame.

## Interaction

- **Production view (`/`)**: four playback modes in the bottom bar — **Fold** (manual; tapping the house or pressing `Space` kicks in manual mode and folds to the next sheet), **Slow** (default; auto-folds cleanly with a 3s pause on each house), **Fast** (continuous overlapping auto-fold chain), and **Reverse** (continuous reverse unfold illusion) — plus ambient synth toggle (`M`) and drag-to-orbit / pinch-to-zoom.
- **Debug workbench (`?debug`)**: unlocks all settings & knobs (`D`), the **Generations Catalog Grid** (`G` / `?debug&grid`), the infinite **Coastal Paper City** flyover (`C` / `?debug&city`), and controls help (`?`).
- **Query params**: `?clean`, `?mode=fold|slow|fast|reverse`, `?fold=0..1`, `?debug`.

```sh
pnpm -C 26 test
pnpm -C 26 dev
pnpm -C 26 build
```
