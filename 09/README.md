# 09 / Membrane

2026-11-09

A sphere of frosted jelly with an eye inside, wrapped in two thin films, one over the other. Cut the film on top, peel it off, then do the same to the one under it.

Three tools, bottom left or keys 1 / 2 / 3:

- `hand`: drag from an edge to peel. Let go and the film stays peeled as far as it got. Drag anywhere else to turn the sphere.
- `line`: drag a line, release to cut straight through the whole sphere.
- `free`: draw a cut on the surface.

How it works:

- Under the films the sphere is a jelly: a transmissive material, so three draws the eye inside to a texture first and the jelly samples it blurred by its own roughness. The eye is a painted ball that turns to the pointer. Other spheres (kraft, paper, ...) are solid and have no eye.

- The films are a stack. A cut only goes into the film on top where it lands, never through two; a hairline cut in the upper film is not an opening. Only one film is pulled at a time, and film with another film over it cannot let go: the lower one peels as far as the upper one has been removed, and parts along its edge.

- The film is a texture on the sphere, unwrapped onto a cube: one atlas says where film is left, one says which piece each texel belongs to. No mesh is ever cut, the fragment shader discards.
- A cut paints a hairline groove into the first atlas. Pieces are whatever is still connected, found by a flood fill each time something was cut or peeled.
- A peel is a sheet of particles on a coarse lattice over the same cube. Each one is stuck until the sheet asks too much of it, then it is loose for good. Loose ones are a verlet sheet, linked wherever the film between them is whole, and tied to the finger by a tether as long as the film from the grab to them, times how far the material stretches.
- A stuck particle lets go when a loose neighbour is linked to it and its tether would be overdrawn by more than the adhesion. Folded back over itself the film comes away easily, dragged flat it holds in shear. The pull is shared by the whole front, so a wide front needs a longer pull.
- So the front is not placed anywhere: it bends round the finger and hangs on the ends of cuts by itself. A straight open cut lifts as a lens.
- Letting go removes the film that is loose, flooded texel by texel so it never crosses a cut. Peeled film never lies back down.
- Each film has its own stretch and cling. The gear opens swatches for a few films and a few spheres, and sliders for how the film behaves in the hand (kept between visits). `bench` resets to a fixed test scene, undo and redo step through cuts and pulls.
- While pulling, a cross bent to the sphere shows where the finger really is, and the front is drawn with what it feels: blue slack, yellow taut, red about to let go.
- The grid is laid out per cube face with equal angles, so it never pinches at a pole.

What was tried and dropped: a peel as a page curl along one straight fold line (a straight cut could not lift, and a wide piece just stopped), cuts as planes and pieces as bitmasks of plane sides (fast and exact, but only straight cuts and a hard limit of 16), endless coloured layers with different finishes, a laser with sparks, cast shadows, a wet look on the uncovered surface, and film that rips with a ragged edge (it read as paper). All of it made the film read as something thick. A membrane has no thickness to shade.

```sh
pnpm -C 09 dev
```
