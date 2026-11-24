# 13 · Labyrinth

A minimalist Scandinavian sphere labyrinth suspended in soft studio light. The track wraps around the entire 360° surface of a matte warm-white and beige core, enclosed inside a thin clear polycarbonate shell with faint handling scratches, recessed micro-screws, semi-transparent `MADE IN SWEDEN` seal tape, and miniature checkpoint LEDs embedded inside the corridors.

Drag anywhere to turn the sphere in 3D (drag near the rim to roll around the view axis) and guide the chrome bearing ball under gravity through all five checkpoint LEDs.

## What was tried & learned

- **Full-sphere variable-band topology**: 7 latitude bands (`1–6–12–12–12–6–1`, 50 cells total) keep every corridor nearly square from pole to pole without polar pinching, keeping the maze clean and not overly complex.
- **Exact analytical spherical collision**: Every wall arc (latitude ring or longitude meridian) is resolved analytically on the unit sphere with 8 physics substeps per frame and 2 corner relaxation passes, so the steel bearing glides smoothly around rounded corners without snagging.
- **SSAO through transparent plastic**: Rendering the scene into a 4× MSAA HDR HalfFloat target and hiding the thin clear shell, scratches, and tape during the `GTAOPass` normal/depth pre-pass lets light ambient occlusion shade the interior labyrinth tracks and screw recesses cleanly without being blocked by the outer shell.
- **Studio reflection balance**: Using a bespoke PMREM softbox + negative-fill studio lightbox with moderate global environment intensity and elevated per-material `envMapIntensity` keeps the matte bone-white/beige walls softly sculpted while giving the chrome ball and thin plastic shell crisp studio reflections.
