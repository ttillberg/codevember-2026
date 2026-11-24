# 13 · Labyrinth

A minimalist Scandinavian two-layer adaptive sphere puzzle suspended in soft studio light, wrapped in a thin scratched polycarbonate shell with recessed micro-screws and semi-transparent `MADE IN SWEDEN` seal tape.

- **Tighter 82-cell adaptive grid**: An 8-band spherical grid (`1–8–16–16–16–16–8–1`) with 96 steady chamfered corner poles and 176 thin retractable wall blades that slide smoothly out of precision floor seams (concavely sculpted around each steady pole), while locked structural walls stay anchored with etched padlocks.
- **10 solver-verified progressive puzzles (`01` → `10`)**:
  - **01 · First Roll** (dead easy) — gentle intro to overhead center-screen gravity.
  - **02 · Iris Portal** — introduces the 6-blade diaphragm shutters, transparent floor windows, and underneath U-shaped half-pipe tubes.
  - **03 · First Switch** — introduces tactile Braun-inspired Coral (`SW A`) & Cobalt (`SW B`) floor toggle switches that open one color-striped passage while closing another or flipping diaphragm shutters.
  - **04–07** — split-equator underpasses, shutter locks, counterweights, and dual circuits requiring real route planning.
  - **08–10** — winding vault, paradox, and the 6-checkpoint dual-switch Master Sphere finale.
- **Strict sequential checkpoints**: Checkpoints must be lit in exact order (`01 → U2 → 03 → … → 13 END`), with only the active next checkpoint pulsing brightly while future checkpoints stay dimmed.

## What was tried & learned

- **Overhead / center-screen gravity**: Pointing gravity along the camera view ray makes the steel bearing always seek 50% / 50% dead center of the viewport, turning navigation into direct no-twist 1:1 dragging of the maze underneath the ball.
- **State-space BFS verification**: Every level is checked by a full `(layer, location, toggleMask, checkpointIndex)` state-space BFS solver to guarantee 100% solvability and calibrate exact step/portal/toggle difficulty across all 10 levels.
- **Two-layer SSAO**: Excluding the outer clear plastic shell and flush floor window panes from `GTAOPass`'s normal pre-pass lets light ambient occlusion shade both the upper maze tracks and the underneath half-pipe tubes through the windows.
