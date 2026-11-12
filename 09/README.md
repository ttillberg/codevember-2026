# 09 / Membrane

2026-11-09

A frog's eye wrapped in two thin films, one over the other. A cross is cut into the top one as the page lands. Take hold of an edge and pull: the film comes off under the finger, then the one under it, then the eye is looking at you.

Four tools, one button in the bar under the sphere (hold T to open it at the cursor, or keys 1 to 4):

- `peel`: drag from an edge to peel. Let go and the film stays off as far as it got. Drag anywhere else to turn the sphere. With Cmd held it cuts instead: a knife from a press on the sphere, a ruler from a press off it. With Shift held it scratches.
- `knife`: a cut drawn by hand.
- `ruler`: drag a line, release to cut straight round the whole sphere.
- `scratch`: four cuts side by side like a paw, their gaps, directions and timing rolled anew each time.

On a touch screen there are no keys, so where the finger lands says what it does: off the sphere a ruler, on an edge a peel, anywhere else on the film a knife. Two fingers turn the sphere. The question mark top right lists all of it.

How it works:

- The films are a stack. A cut only goes into the film on top where it lands, never through two; a hairline cut in the upper film is not an opening. Only one film is pulled at a time, and film with another film over it cannot let go: the lower one peels as far as the upper one has been removed, and parts along its edge.
- A film is a texture on the sphere, unwrapped onto a cube: one atlas says where film is left, one says which piece each texel belongs to. No mesh is ever cut, the fragment shader discards. A cut paints a hairline groove into the first atlas. Pieces are whatever is still connected, found by a flood fill each time something was cut or peeled.
- A peel is a sheet of particles on a coarse lattice over the same cube. Each one is stuck until the sheet asks too much of it, then it is loose for good. A stuck particle lets go when a loose neighbour is linked to it and the film from the grab to it would be overdrawn by more than it clings. Folded back over itself the film comes away easily, dragged flat it holds in shear, and the pull is shared by the whole front. So the front is not placed anywhere: it bends round the finger and hangs on the ends of cuts by itself. Pulled too hard too wide, it tears.
- The loose film is not cloth. It is pulled taut between where it is still down and the finger, like a soap film: every loose particle goes to the mean of the ones it is joined to, never further from the hand than the film between them is long, never further from film still down than the film reaches, never under the sphere. No weight, no speed, no slack to wrinkle.
- Only the fan between the hand and the front being pulled is drawn. The rest of the loose film hangs from nothing any more and would trail as teeth and scraps; it is cut away along the fan's straight sides in the shader, and goes for good when the hand lets go. Right at the finger the film thins out to nothing, where a hand would be holding and hiding it.
- Letting go removes the film that is loose, flooded texel by texel so it never crosses a cut. Peeled film never lies back down.
- The eye is all shader: a red-eyed tree frog's, with a net of cells over the iris, a slit pupil that opens and closes, a tear film, and a gaze that follows the pointer in small jumps. Under a jelly base it is a smaller ball inside a transmissive sphere instead.
- The bar, the tool picker, the help and the title block are those of days 07 and 08, rebuilt here without a framework.

While developing (or with `?settings` in the address) a gear opens the workbench: the stack of films with their looks, the sphere, and sliders for how the film behaves in the hand, kept between visits. Keys `b` and `n` reset to two fixed test scenes. `debug` draws where the finger really is, what the front feels (blue slack, yellow taut, red about to let go) and where the sheet has been torn off a front that is no longer pulled. `?dark` gives the near-black backdrop.

What was tried and dropped: a peel as a page curl along one straight fold line (a straight cut could not lift, and a wide piece just stopped), cuts as planes and pieces as bitmasks of plane sides (fast and exact, but only straight cuts and a hard limit of 16), the loose film as a verlet cloth (it wrinkled, bunched and flew like a sail: it read as fabric, not film), easing the film off the sphere over a few cells at the front (folded back flat, those cells were drawn out into a row of teeth), endless coloured layers, a laser with sparks, cast shadows, a wet look on the uncovered surface, and film that rips with a ragged edge (it read as paper). A membrane has no thickness to shade.

```sh
pnpm -C 09 dev
```
