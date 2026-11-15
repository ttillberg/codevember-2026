# 13 / Labyrinth

2026-11-13

An animated ink-wash magpie perched before a clean vermilion background. The bird and white plum blossoms remain procedural, while the scene keeps the paper grain and pigment bleed available through the optional ink pass.

## A small tribute

I am still a beginner and do not have a formal programming background. I came across this project, loved the bird, animation and ink-wash feeling, and used it as a learning base to make a version closer to the scene I had in mind: a magpie, white plum blossoms, a vermilion backdrop, deeper branch growth, snow and a few controls for experimenting with the composition.

There are certainly many rough edges in my changes. This is a small tribute and a learning exercise built on top of the original work, and I would be grateful for any advice or corrections.

## How

- **Rig** (`bird/rig.ts`): 79 named `THREE.Bone`s. Spine, neck chain, head, bill and jaw, eyes, lids and nictitating membranes, wings down to each primary and secondary, a ten-feather tail fan, legs and toes wrapped round the perch. Wings keep a folded and a spread pose already.
- **Body** (`bird/loft.ts`): one parametric loft from tail root to bill base, skinned. A throat pull binds the front of the neck to the head so the gorget turns with the bill.
- **Motion** (`bird/motion/*`, `bird/pose.ts`): layers write a `Pose`, a solver turns it into bones and feather uniforms. Posture, breath, gaze, blink, ruffle, tail, wings, startle. The gaze does min-jerk saccades of 40 to 95 ms, a bit of ringing on arrival, then dead-still holds with micro-tremor, the head held still in world space against the body. A new behaviour is one more layer.
- **Feathers** (`bird/plumageGeometry.ts`, `bird/plumageMaterial.ts`): about 11k contour feathers plus wing and tail feathers, two skinned meshes, one material. Each feather hinges at its root in the vertex shader, so a ruffle is feathers lifting off the skin in a wave, not a fatter body. Barbs, shaft and combed edges in the fragment shader, alpha to coverage. The gorget and crown flash comes from a narrow lobe round each feather's own platelet normal, art-directed rather than a thin-film model. The shadow pass hinges the same way. Each kind of feather has a `loose` value, from crisp gorget scales to velvety face, loose belly and flank feathers with open barbs, and a down tuft at the wing. Soft ones get jitter, clumps and partings, matte barbs with split vanes, and glitter on single barbs rather than whole feathers. Folded wings are placed by a clearance solve against the body, so they lie on it instead of through it.
- **Forage** (`bird/motion/forage.ts`, `seeds.ts`): click drops a seed on the air. A seed in view gets watched; one in reach gets taken: a beat of hesitation, a small wind-up, a 120 to 200 ms strike at where the seed will be, bill open on the way and shut on contact, then three licks of the forked tongue draw it down the bill, a chew, a gulp and a toss. The tongue (three bones under the jaw) also flicks out now and then, and `?sing` shows the singing pose. The reach is analytic IK in the solver: the head pivot slides along the line to the target until the bill tip lands on it, the translation shared down the neck so it reads as the neck unfolding.
- **Wings at rest** are part of the body: a raised strip on the loft covered by covert and remex tracts, skinned like any contour feather, so they can't come loose. Only the outer primary tips are free blades. The real arm and blades are still there, collapsed, and grow out as `spread` rises.
- **Species** (`bird/species.ts`): proportions, tracts, colours and tempo as data, so another bird is a new object.
- **Perch** (`model/branch.blend` → `public/branch.glb`): modelled in Blender, a felted young stem (mottled rust, tan, a purple bruise, olive going green toward the shoot) baked to 4k colour, normal and ORM, with Cycles AO from everything on it baked in, under ten shells of curly brown felt drawn in three (`env/branch.ts`, the baked straw cards read too straight), moss tufts, and a side shoot with hairy nodding star-shaped flowers. It keeps the procedural twig's contract: radius 0.09 and top surface through the origin at the grip, so the toes fit. The procedural one stays as a fallback (`?procbranch`).
- **Pointer**: while it moves, most fixations go bill-on to it and the head glides after it with a lag between saccades, snapping to catch up; 2 s still and it is back to its own business.
- **Scene** (`main.ts`, `env/*`): an out-of-focus forest on a sphere round the camera, baked into the env map too (at half the saturation) so the feathers reflect the same green without turning green.
- **Post** (`post.ts`): scene into a 4x MSAA half-float target, a depth-of-field gather focused on the head, then Neutral tone mapping and a grade matched by eye and by sampled colours against the footage: brighter, a touch cool, plum in the shadows, grain and vignette. `?nopost` skips it.

Debug: `?nopost`, `?procbranch`, `?nofuzz`, `?pose=front|profile|up|back|three`, `?gaze=yaw,pitch,roll`, `?quiet`, `?arousal=0..1`, `?fluff=`, `?spread=0..1`, `?fan=0..1`, `?bones`, `?skin`, `?wire`, `?noflash`. `window.__bird` for poking.

## Learned

- The flash is everything. Per-feather normals and a tight lobe read as structural colour. A body-wide tint never did.
- A perched hummingbird is a still body under a head that teleports. Get the saccade timing right and it is alive before a single feather moves.
- Folded wings are the weak part: the belly hides most of them from the front.

Built with Fable 5.2 on the bird and the Blender perch, Opus 5.5 on the scene, post and glue.

```sh
pnpm -C 13 dev
```
