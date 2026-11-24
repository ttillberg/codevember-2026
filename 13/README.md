# 13 · Labyrinth

A minimalist Scandinavian two-layer adaptive sphere labyrinth suspended in soft studio light, wrapped in a thin scratched polycarbonate shell with recessed micro-screws and semi-transparent `MADE IN SWEDEN` seal tape.

- **Adaptive upper deck (5 morphing levels)**: An 8-band, 62-cell grid with 66 steady chamfered corner poles and 132 thin retractable wall blades that slide smoothly out of precision floor seams (leaving only neat panel seams when hidden) while locked structural walls stay anchored with etched padlock icons.
- **Mechanical diaphragm iris shutters & underneath half-pipe tubes**: Six 6-blade camera-aperture diaphragm shutters open and close across levels, revealing circular drop holes straight through the shell into a simpler, sculpted U-shaped half-pipe tube system running beneath transparent polycarbonate floor windows — complete with under-deck checkpoint LEDs. Drop down into the half-pipe tubes through an open iris, steer underneath the upper walls while watching the steel ball through the clear floor panels, and tilt an open shutter downward to emerge back up.

## What was tried & learned

- **Concave seams around steady poles**: Trimming every wall blade concavely to follow the circular contour of its steady corner poles (`POLE_SEAM_GAP = 0.0042`) eliminates corner overlap where multiple walls share a pole.
- **Per-cell perforated & windowed floor shell**: Replacing a single core sphere with 62 thickness-extruded curved panels lets solid beige panels frame flush transparent polycarbonate windows and mathematically smooth circular iris holes with real shell depth.
- **Two-layer SSAO**: Excluding both the outer plastic shell and the flush floor window panes from `GTAOPass`'s normal pre-pass lets light ambient occlusion shade both the upper maze corridors and the underneath U-shaped half-pipe troughs through the glass.
