# 27 / Burrow

2026-11-27

Into a burrow with a torch. It opens on the hole in a grassy bank under an overcast sky; inside, a small labyrinth of tunnels, roots through the roof, stones in the walls, and a hand-held beam that is never quite the right tool in a place this narrow.

Drag to look, hold to crawl (or `W`/`↑`, the wheel, a tap for one shuffle). At a fork you go where you look. With a mouse the torch follows the pointer.

## How it is made

- **One field, one mesh.** The tunnels are capsules along a hand-drawn graph, stamped into a 3 cm grid together with the hillside and a few octaves of lumps, then meshed once with surface nets (`world.ts`). The same grid answers everything later: where the wall is for a root, where a crumb lands, how far the beam reaches.
- **The torch.** A cookie (hotspot, corona, faint reflector rings), inverse square, one 2048 shadow map from a lamp held beside the head, and a fake bounce light where the hotspot lands. The exposure is metered on the CPU like a camera would, nine rays, centre-weighted: point it at a wall close by and everything else falls into black; look back at the mouth and the day burns out.
- **Matter without textures.** One baked 64³ noise volume that stores its own gradient, so every octave of bump is a single fetch. Soil, stone, bark all read it at their own scales (`gfx.ts`). Octaves finer than a pixel are faded out instead of left to sparkle.
- **What our passing does.** Fine roots are verlet strands with a memory of their shape; the head is a ball they cannot enter and they swing back after it. Loose stones on the floor get shoved along, set stones rock in their sockets, and the roof lets dirt go: over the path now and then, and wherever a root was tugged (`flora.ts`, `rocks.ts`, `dust.ts`).
- **The den.** Past the last node the field opens into a low chamber with a bed of straw and leaves (instanced bent strips). Whoever dug the place lies at the back with a young one: an icosphere shrunk onto melted ellipsoids, 44 000 short fur ribbons, and eyes with a tapetum term, light that arrives along the line of sight goes straight back, so with the torch beside the lens they are seen long before the animal is. They breathe and blink; she starts when we come in, the roof answers, the young one ducks (`den.ts`).
- **The lens.** HDR frame, bloom, a little softness and falloff towards the corners, ACES, grain (`post.ts`).

## Learned

- A depth pre-pass for the ground more than halved the frame: the tunnels overlap on screen far more than it looks.
- The pre-pass must run the very same vertex expression as the lit pass (`invariant gl_Position`), or the two disagree by a hair and leave black pinholes.
- Metering only the ground made the animals burn out: the meter has to know what the hotspot lands on, and the pool of light gets a ceiling of its own.
- A torch next to the lens burns everything near it to white. Fine roots get a softened falloff, a cheat that reads as more real than the real thing.

`?clean` hides the furniture, `?auto` crawls in by itself, `?at=N,1.4` starts 1.4 m short of a node (`N` is the den), `?flat` shows the blockout shading.

```sh
pnpm -C 27 dev
```
