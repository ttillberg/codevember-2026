import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Rays } from './rays';
import { Post } from './post';
import { Dof } from './dof';
import { Cable } from './cables';
import { Blood } from './blood';
import { Screen } from './screen';
import { buildHall, SCENE_TARGETS } from './hall';
import { dress, GLOWING, instances, rubber, SHADE, shareCover, wire as wireSteel } from './materials';

// A pod hanging in a hall. The model comes from Blender (model/cocoon.blend → public/cocoon.glb) and says by
// name what is what:
//   pod          the body, everything that swings is its child
//   door         child of pod, origin on the hinge, hinge along its local Z (Blender)
//   plug.NNN     empties on the pod, local Z the way the cable leaves; custom props radius, slack
//   socket.NNN   empties in the ceiling, one per plug
//   hang         empty, the point the whole thing swings from
//   lift.000     empty on the pod, the pin of the mount at its back: the hoist block locks on there
//   drip.NNN     empties where it bleeds
// Nothing here knows the shape of the pod: remodel it, keep the names.

const query = new URLSearchParams(location.search);
// ?no=scaffolding (a list, with commas): what to leave out, for debugging
const NO = new Set((query.get('no') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
// ?clean: no page furniture, the scene alone (screengrabs, clips)
if (query.has('clean')) document.body.classList.add('clean');
// ?silk: the first take on the word, a silk cocoon spun from one thread
if (query.has('silk')) import('./silk');
else start();

function start() {
  const FOG = 0x0a0c11; // the hall, dark, a little cold: the haze a grey with some steel blue in it
  const G = 9.8;
  const STEP = 1 / 120;

  const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // the hatch's frosted window draws the scene again to see through: at a third of the size, as frosted as it
  // is that looks the same, and it costs a ninth
  renderer.transmissionResolutionScale = 0.35;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG);
  const FOG_GAIN = 9;
  scene.fog = new THREE.Fog(FOG, 0.08, FOG_GAIN); // not linear: near is the density, far the haze's gain up high (hall.ts)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.18;
  // ---------- the controls, bottom left: the hall's machines and the eye, one symbol each, in white. The roof first
  let roofWanted = query.has('debug'); // (the hall starts with the roof shut: only the fans let light in; ?debug open)
  let railOn = false; // the crane's round along the girder: off until asked for
  const controls = (() => {
    const list = document.querySelector<HTMLElement>('.controls')!;
    const roofBtn = list.querySelector<HTMLButtonElement>('[data-ctl="roof"]')!;
    const light = roofBtn.querySelector<SVGGElement>('.light')!;
    roofBtn.addEventListener('click', () => { roofWanted = !roofWanted; hall?.roofOpen(roofWanted); watch('roof'); });
    // the fans, a button for each wall's: their leaf shutters open or shut, the light through them with them
    const fanBtns = (['end'] as const).map((w) => {
      const btn = list.querySelector<HTMLButtonElement>(`[data-ctl="fans-${w}"]`)!;
      const blades = btn.querySelector<SVGGElement>('.blades')!;
      let wanted = true; // (the fans are open from the start: the light the hall starts in)
      const set = (on: boolean) => { wanted = on; hall?.fanShutter(false, wanted); btn.setAttribute('aria-pressed', String(wanted)); };
      btn.addEventListener('click', () => { set(!wanted); watch('fans'); });
      return { show: (s: number) => { blades.style.opacity = (0.18 + 0.82 * s).toFixed(2); }, set };
    });
    // the crane: off it stands where it is, on it goes its round along the girder, hoisting at each end
    const railBtn = list.querySelector<HTMLButtonElement>('[data-ctl="rail"]')!;
    const car = railBtn.querySelector<SVGGElement>('.car')!;
    railBtn.addEventListener('click', () => {
      railOn = !railOn;
      railBtn.setAttribute('aria-pressed', String(railOn));
      if (railOn) craneTime = Math.max(craneTime, MOVES[1][0]); // (its round starts with a wait: not when asked to go)
      watch('rail');
    });
    // the eye: yours (drag, pinch), or on its own, a new shot every few seconds
    const eyeBtn = list.querySelector<HTMLButtonElement>('[data-ctl="eye"]')!;
    eyeBtn.addEventListener('click', () => { if (cine || auto) cine = auto = null; else play(); });
    let eyeWas: boolean | null = null;
    return {
      /** the trolley's symbol goes along its line with the trolley */
      rail(along: number) { car.setAttribute('transform', `translate(${(along * 6).toFixed(2)} 0)`); },
      /** pressed while the eye is on its own (the opening, or the shots after) */
      eye(own: boolean) { if (own !== eyeWas) eyeBtn.setAttribute('aria-pressed', String((eyeWas = own))); },
      /** the fan's symbol follows the shutters: its blades fade as they shut */
      fans(end: number) { fanBtns[0].show(end); },
      /** the fans' shutters open, whatever they were */
      fansOpen() { fanBtns[0].set(true); },
      /** the symbol follows the shutter: the rays under the roof's line come as it opens */
      roof(open: number, wanted: boolean) {
        light.style.opacity = (0.22 + 0.78 * open).toFixed(2);
        roofBtn.setAttribute('aria-pressed', String(wanted));
      },
    };
  })();
  const hemi = new THREE.HemisphereLight(0xc8d0d8, 0x050506, 0.22); // a little fill, no more
  scene.add(hemi);
  // the rest of the light, from the roof and the sides, comes with the hall (hall.ts)

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 140); // little past 90 m shows through the haze, but the fans up in the far corner do

  // ambient occlusion in screen space: the dark in the machinery's corners, under the boxes, between the hoses.
  // The light shafts and the dome are not surfaces, they are left out of what it sees.
  // the frame (post.ts): the scene once, with its depth, then the AO, the light in the haze, the output
  const post = new Post(renderer, scene);
  SCENE_TARGETS.add(post.target); // (the hall's steel is drawn into this and no other: hall.ts)
  const sceneDepth = post.depth;
  const ao = new GTAOPass(scene, camera, 1, 1, { depthTexture: sceneDepth });
  let aoOn = false; // the debug panel's AO (O), screen space, off: the pod has its own baked in, the hall does without (a third of a frame on a big screen)
  ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.5, scale: 1.7, samples: 16 });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  ao.blendIntensity = 0.85;
  // the AO at half the drawing buffer (on a retina screen: one sample a CSS pixel): it is soft and denoised as
  // it is, and it was a quarter of the frame
  {
    const set = ao.setSize.bind(ao);
    ao.setSize = (w: number, h: number) => set(Math.ceil(w / 2), Math.ceil(h / 2));
  }
  post.insert(ao, 0);
  post.insert(new OutputPass(), 1);
  // depth of field for the close shots, when the eye is on its own: after the light in the haze (which is put in
  // before it, further down), before the output. ?dof=0 off, ?dof=2 twice as much
  const DOF = Math.max(0, +(query.get('dof') ?? 1));
  const dof = new Dof(camera, () => sceneDepth);
  dof.enabled = false;
  post.insert(dof, 1);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100); // the debug panel's iso: same eye, no perspective
  let eye: THREE.Camera = camera;
  // the opening: from well below and off to the side, looking up at the pod and past it into the dark of a hall
  // shut down, as it fades in; a moment, and the roof's shutter rolls up, the eye turning slowly. A touch, a drag or the
  // wheel and the eye is yours
  type Shot = { yaw: number; pitch: number; radius: number; target: THREE.Vector3 };
  const SHOT: Shot = { yaw: -0.52, pitch: -0.77, radius: 16, target: new THREE.Vector3(1.08, 2.1, -1.14) };
  // [seconds, the view there]; eased from each to the next; and what happens when
  // and all the while, until the roof is open (some 22 s), the eye turns slowly round it, 20 degrees. Then a few
  // cuts, each shot drifting round the pod, slow and even, and the last landing where the eye is left
  const deg = THREE.MathUtils.degToRad;
  const turn = (v: Shot, d: number): Shot => ({ ...v, yaw: v.yaw + deg(d) });
  const DOOR: Shot = { yaw: 0.15, pitch: -0.12, radius: 3.4, target: new THREE.Vector3(0.35, 0.55, 0.1) }; // close on the door, the red in its seams
  // (two that were here are gone: up the cables from below, which was cables and little else, and the flank from
  // the side, low, which came right before the landing and was nearly the landing's own angle)
  const BACK: Shot = { yaw: Math.PI + 0.7, pitch: -0.45, radius: 6.5, target: new THREE.Vector3(0, 1.2, 0) }; // its back, the machinery and its lamps
  const ABOVE: Shot = { yaw: 2.4, pitch: 0.6, radius: 6.5, target: new THREE.Vector3(0, 0.9, -0.2) }; // from above, down on its top and the mount: the opposite of where it lands
  // where a tap on the pod sends the eye: in front of it, a little to the door's side, level, all of the pod in the
  // picture with room round it (not close on the door: you want to see what you are about to pull at)
  const FRONT: Shot = { yaw: 0.26, pitch: 0.05, radius: 6.3, target: new THREE.Vector3(0.1, 0.22, 0) };
  const LAND: Shot = { yaw: -0.51, pitch: -0.38, radius: 9, target: new THREE.Vector3(0.9, 0.64, -0.8) };
  // each a shot: from, to, how long, eased at both ends (the opening), even (the cuts) or eased only into its end
  type Take = { from: Shot; to: Shot; s: number; ease: 'both' | 'even' | 'end'; fit?: boolean };
  const TAKES: Take[] = [
    { from: SHOT, to: turn(SHOT, 20), s: 22, ease: 'both' },
    { from: DOOR, to: turn(DOOR, 7), s: 4.5, ease: 'even' },
    { from: BACK, to: turn(BACK, -7), s: 4.5, ease: 'even', fit: true },
    { from: turn(ABOVE, -3), to: turn(ABOVE, 3), s: 4.5, ease: 'even', fit: true },
    { from: turn(LAND, -9), to: LAND, s: 6, ease: 'end' },
  ];
  const CUES: [number, () => void][] = [[4.5, () => { roofWanted = true; hall?.roofOpen(true); }]];
  // the eye on its own, after the opening or whenever asked for: cuts through these, and a rhythm to them. A beat
  // is CUT seconds (3; ?cut=5): the wide ones are held a beat or more, the close ones about half of one, two close
  // ones in a row before the next wide one. No two alike after each other: round the pod, below it and above, near
  // and far, and several lenses (the usual 40 degrees, a wide one from below, longer ones that stack the hall
  // up behind it; not from far off, the haze takes the pod at 20 m). Each drifts a little round the pod, one way then the other.
  const CUT = Math.max(0.5, +(query.get('cut') ?? 3) || 3);
  // (`wide`: made to show what is over the pod, tall as it is: not stood back from on an upright screen. `fixed`:
  // the eye does not go along with the crane, the pod travels through the picture)
  // `fly`: the eye is out in the hall and moves, from a to b (world, metres), looking at the pod all the while;
  // `walk`: and is held in the hand as it goes)
  type Auto = Shot & { s: number; fov?: number; wide?: boolean; fixed?: boolean; fly?: { a: THREE.Vector3; b: THREE.Vector3 }; walk?: boolean };
  const at = (yaw: number, pitch: number, radius: number, x: number, y: number, z: number, s: number, fov?: number): Auto => ({ yaw, pitch, radius, target: new THREE.Vector3(x, y, z), s, fov });
  // from out in the hall, the eye moving past steel that stands between it and the pod: that is what gives the
  // picture its depth. Not from far: the haze takes the pod at 20 m
  const fly = (a: number[], b: number[], look: number[], s: number, fov?: number, walk = false): Auto => ({ yaw: 0, pitch: 0, radius: 12, target: new THREE.Vector3().fromArray(look), s, fov, wide: true, walk, fly: { a: new THREE.Vector3().fromArray(a), b: new THREE.Vector3().fromArray(b) } });
  const AUTO: Auto[] = [
    at(0.05, 0.04, 2.9, 0.45, 0.9, 0.1, 0.55), // the window
    at(0.4, -0.35, 3.3, 0.3, -0.5, 0.2, 0.6), // the seam low down, the latch, the blood
    fly([9.8, -5.2, 7.5], [9.8, -5.2, 3.2], [0, 0.6, 0], 1.4, 40, true), // walking the low catwalk, crouched under its rail, looking up at it
    at(-Math.PI / 2, 0.0, 11.5, 0, 0.4, 0, 1.15, 30), // from the side, a longer lens: the pod flat on as the sheet draws it, the hall stacked up behind
    at(-0.3, 0.5, 2.7, 0, 1.1, 0.1, 0.55), // its top from in front and above: the deck, its lamps
    { ...ABOVE, s: 0.9 }, // from above, down on its top and the mount, the depth under it
    fly([15.6, -3.2, -1.2], [15.6, 3.2, -1.2], [0, 0.6, 0], 1.4, 36), // up the hoist's mast, through its lattice
    at(Math.PI / 2 + 0.1, 0.1, 3.4, 0, 0.95, -0.2, 0.55), // the mount and the hoist's block from the side, the pod's head under them
    { ...SHOT, s: 1.35 }, // the first view: from well below, the roof and the fans over it
    at(-0.95, -0.18, 3.5, -0.35, 0.45, 0.25, 0.55), // the markings on its flank
    at(-0.12, 0.02, 2.2, 0.15, 0.45, 0.6, 0.5), // the latch across the seam, its lamp
    fly([-4.5, -7, 3], [2.5, -7, 4.5], [0, 0.3, 0], 1.3, 46), // passing under it, looking up
    { ...BACK, s: 0.95 }, // its back, the machinery
    at(Math.PI - 0.3, -0.15, 2.7, 0, 0.3, -0.5, 0.55), // the machinery of its back, close: the lamps in it
    at(0.85, -0.08, 15, 0, 0.2, 0, 1.1, 24), // from the front right, a longer lens, the steel stacked up behind it
    fly([-14.4, -0.4, -4.05], [-10.6, -0.4, -4.05], [0, 0.5, 0], 1.4, 38, true), // along the boards of the staging on its other side, its tubes going by
    at(0.95, 0.12, 2.5, 0.5, 0.15, 0.3, 0.5), // the door's edge, close, from its hinge side
    at(0.6, -0.5, 5.5, 0, 0.1, 0, 0.8), // from under its door side, half way in
    fly([10.5, 11.8, 2.2], [6.5, 11.8, 2.2], [0, 2.6, 0], 1.35, 44), // over the girder it hangs from, along it towards the trolley: the wire down to it
    at(0.35, 0.5, 11, 0, -0.8, 0, 1.3, 45), // high up in front of it, looking down past it into the dark
    at(1.2, -0.5, 2.9, 0, -1.1, 0, 0.55), // the frame under it and its lamps, from the side
    at(0.3, -0.85, 3.6, 0, -0.7, 0, 0.6, 55), // right under it, a wide lens: the lamps of its underside, the cables going up
    fly([2.5, -6.5, 9], [2.5, 1.5, 9], [0, 0.5, 0], 1.4, 40), // rising in front of it, from under it to level with it
    at(2.6, 0.3, 10, 0, 0, 0, 1.15, 35), // from behind it on the right, a little above
    at(1.45, -0.05, 3.2, 0.6, 0.2, 0, 0.55), // its right flank, close
    at(-0.7, -0.3, 5.2, 0, 0.3, 0, 0.8), // from its front left, half way in
    at(0.0, -0.05, 13, 0, 0.2, 0, 1.1, 20), // straight on, a long lens
    fly([-9.8, -5.2, -8.5], [-9.8, -5.2, -3.6], [0, 0.6, 0], 1.4, 40, true), // the low catwalk on the other side, out of the staging round the tower there
    at(-1.3, -0.75, 3.2, -0.3, -0.3, 0, 0.6, 55), // from under its left flank, a wide lens, up along it
    fly([3.4, 7.5, 1.7], [1.3, 7.5, 2.0], [0, 0.8, 0], 1.3, 48), // under the girder, along it: down the wire on its head, the dark under it
    at(-2.3, -0.5, 9, 0, 0.8, 0, 1.15), // from behind it on the left, below
    fly([12, -2.5, -6], [12, 3, -6], [0, 0.5, 0], 1.4, 40), // up inside the tower beside it, through its lattice and the staging round it
    at(0.6, 0.35, 5.5, 0, 0.3, 0, 0.8), // from its front right, above, half way in
    fly([4.5, -2, -11], [-1.5, -1.5, -11.5], [0, 0.6, 0], 1.35, 40), // passing behind it, low
  ];
  // The moving ones and the far ones are slower and longer: the same way gone in half as long again, a far view
  // held a third longer. (Close, a shot is over in a second and a half and that is right; far off or on the
  // move, three or four seconds was a glimpse.)
  for (const a of AUTO) a.s *= a.fly ? 1.5 : a.radius >= 9 ? 1.35 : 1;
  // And the hall on its own, the pod not in it: the roof, the fans, a hoist, the steel going off into the dark.
  // Slow, six or seven seconds each, spread through the round
  const HALL: [number, Auto][] = [
    // (from well back, not close on them: the thing small in the hall, the eye kept on it all the same)
    [4, fly([-8, 0, -8], [8, 0, -8], [0, 50, -72], 2.2, 42)], // across the hall, the eye on the end wall's fans high up
    [9, fly([6, -2, 16], [6, -2, 2], [-10, 75, -20], 2.3, 55)], // from low down, looking up at the roof: the glass in its bands, the trusses
    [14, fly([30, -8, 12], [30, 0, 12], [15.7, -2, -1.2], 2.2, 40)], // rising, off to one side of a hoist's mast, its cage on it
    // (one down into the dark under everything was tried, twice: a black picture)
    [21, fly([-18, 6, 12], [-18, 6, 2], [-60, 14, -34], 2.2, 38)], // drifting, the eye into the steel: tower behind tower, the lamps far off
    [26, fly([-6, 14, 10], [6, 14, 10], [-40, 78, -10], 2.3, 48)], // along under the roof, far below it, towards the shutter's end
    [31, fly([5, -6, -10], [-5, -6, -10], [0, 53, -72], 2.0, 34)], // the middle fan from under the pod's height, the blades going round
  ];
  const OF_HALL = new Set(HALL.map(([, a]) => a)); // (and while one of these is on, the hall's fine steel is drawn)
  HALL.reverse().forEach(([i, a]) => AUTO.splice(i, 0, a));
  // And when one of the hall's machines is set going while the eye is on its own, it looks: a cut at once, and
  // the next three shots have it in the picture, before the round goes on. Not close on it, the other way: wide,
  // the pod still there, so that what happens is seen and no more is made of it than that.
  const SEE: Record<'roof' | 'fans' | 'rail', Auto[]> = {
    // the roof: from below, the shutter and the light coming or going over the pod (six of each of these, three
    // shown at a time: the ones not seen for longest)
    roof: [
      { ...at(0.3, -0.85, 4.2, 0, -0.4, 0, 1.1, 55), wide: true },
      { ...at(2.6, -0.8, 9, 0, 2.6, 0, 1.1, 50), wide: true }, // (no further out: with the pod along the rail the eye would stand in a staging)
      { ...SHOT, s: 1.2, wide: true },
      { ...at(-1.2, -0.8, 7, 0, 1.5, 0, 1.1, 50), wide: true },
      { ...at(0.9, -0.7, 13, 0, 2.5, 0, 1.2, 44), wide: true },
      { ...at(-2.6, -0.82, 5.5, 0, 0.5, 0, 1.1, 55), wide: true },
    ],
    // the fans, high in the end wall: from in front of the pod and under it, the wall over its head
    fans: [
      { ...at(0.0, -0.42, 13, 0, 0.6, 0, 1.1), wide: true },
      { ...at(-0.24, -0.58, 15, 0.3, 1.6, -0.4, 1.1), wide: true },
      { ...at(0.4, -0.5, 9.5, 0, 2.2, 0, 1.1, 50), wide: true },
      { ...at(0.2, -0.36, 8, 0, 1.2, 0, 1.1, 46), wide: true },
      { ...at(0.3, -0.62, 11.5, 0, 1.2, 0, 1.1, 46), wide: true },
      { ...at(-0.35, -0.3, 6.5, 0, 1.6, 0, 1.0, 50), wide: true },
    ],
    // the crane: the girder, the trolley and the wire over the pod, the eye standing still so the pod travels
    rail: [
      { ...at(0.15, -0.22, 14, 0, 4.4, 0, 1.3, 46), wide: true, fixed: true },
      { ...at(-0.6, -0.3, 13, 0, 3.3, 0, 1.3), wide: true, fixed: true },
      { ...at(Math.PI / 2 - 0.3, -0.18, 13, 0, 4.2, 0, 1.3, 46), wide: true, fixed: true },
      { ...at(0.5, -0.4, 11, 0, 3.5, 0, 1.3, 50), wide: true, fixed: true },
      { ...at(-0.2, -0.1, 15.5, 0, 4.2, 0, 1.3, 40), wide: true, fixed: true },
      { ...at(-Math.PI / 2 + 0.35, -0.3, 11, 0, 3.6, 0, 1.3, 48), wide: true, fixed: true },
    ],
  };
  // on an upright screen the picture is narrow and a shot made for a wide one cuts the pod off, or shows the
  // cables and no pod: the eye stands back, up to 1.6 times as far
  const fit = () => (camera.aspect < 0.85 ? Math.min(1.6, (0.85 / camera.aspect) ** 0.6) : 1);
  // t into the shot, i which of the round's, n how many cuts so far (which way it drifts), q a shot put in before
  // the round's next one
  let auto: null | { t: number; i: number; n: number; q: Auto | null } = null;
  let queue: Auto[] = [];
  const anchor = new THREE.Vector3(); // where the crane had the pod at the cut, for the shots that stand still
  const shown = () => auto!.q ?? AUTO[auto!.i];
  // No shot twice within half a minute, nor one much like it: each is known by where it looks from, roughly (a
  // quarter of a radian, a metre, half a metre of target), so the opening's takes, the round's and the ones that
  // look at a machine are all one to this, and a shot a few degrees off another is the same shot.
  const AGAIN = 30;
  const seen = new Map<string, number>();
  const coarse = (x: number, step: number) => Math.round(x / step);
  const key = (s: Auto | Shot) => {
    const f = (s as Auto).fly;
    if (f) return `f${coarse(f.a.x, 1.5)},${coarse(f.a.y, 1.5)},${coarse(f.a.z, 1.5)},${coarse(f.b.x, 1.5)},${coarse(f.b.y, 1.5)},${coarse(f.b.z, 1.5)}`;
    const yaw = Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw));
    return `${coarse(yaw, 0.25)},${coarse(s.pitch, 0.2)},${coarse(s.radius, 1)},${coarse(s.target.x, 0.5)},${coarse(s.target.y, 0.5)},${coarse(s.target.z, 0.5)}`;
  };
  const clock = () => performance.now() / 1000;
  const last = (s: Auto | Shot) => seen.get(key(s)) ?? -1e9;
  const fresh = (s: Auto | Shot) => clock() - last(s) > AGAIN;
  /** on from i to the round's next shot not seen lately (i itself if it is one) */
  const next = (i: number) => {
    for (let k = 0; k < AUTO.length && !fresh(AUTO[i]); k++) i = (i + 1) % AUTO.length;
    return i;
  };
  let roundAt = -1; // where the round had got to when the eye was last on its own
  const cut = () => {
    if (!auto) return;
    if (queue.length) auto.q = queue.shift()!;
    else if (auto.q) { auto.q = null; auto.i = next(auto.i); } // (back to the round, at the shot it was to show next)
    else auto.i = next((auto.i + 1) % AUTO.length);
    auto.t = 0;
    auto.n++;
    anchor.copy(carry);
    cutNow = true;
  };
  // (it goes on from where the round had got to, not from its first shot again)
  // (and from a clean start: whatever had the eye is let go of. Pressed while the eye was looking in, the look in
  // went on under the shots, its long lens and its focus on the screen with it; pressed while it was on its way to
  // the door after a tap, that move ended the shots again the next frame)
  const play = () => {
    peek = null;
    goal = null;
    vyaw = vpitch = 0;
    queue = [];
    auto = { t: 0, i: next((roundAt + 1) % AUTO.length), n: 0, q: null };
    anchor.copy(carry);
    cutNow = true;
  };
  const watch = (what: keyof typeof SEE) => {
    if (!auto) return; // (the eye is yours, or the opening is on: it is not taken)
    // three of them: the ones not seen for longest
    queue = [...SEE[what]].sort((a, b) => last(a) - last(b)).slice(0, 3);
    if (!auto.q) auto.i = (auto.i + 1) % AUTO.length; // the shot cut away from is not come back to
    cut();
  };
  // ---------- the look in. The door held open far enough catches; a tap on the pod then and the eye goes to look, in
  // one move, no cuts (cuts were tried: the eye jumping about was odd): from wherever it is it turns round to the
  // door's side, drawing back a little and dipping under where it was, then comes up and in, slower and slower,
  // through a longer and longer lens, and stops short of the opening and a little to one side. A glance in, not the
  // whole of it. In there a screen is on. Where it ends is written in the frame of the pod at rest (metres).
  const PEEK_S = 9; // seconds, all of it
  const PEEK_FROM = new THREE.Vector3(0.74, 0.2, 1.8); // where the eye ends up
  const SCREEN_AT = new THREE.Vector3(0.06, 0.2, -0.08); // where the screen is, stood on end: a metre tall
  const PEEK_AT = new THREE.Vector3(0.06, -0.02, -0.05); // what the eye looks at: low on it, over the line being typed
  let peek: null | { t: number; yaw: number; pitch: number; radius: number; target: THREE.Vector3; fov: number } = null;
  const peekStart = () => { cine = auto = null; goal = null; peek = { t: 0, yaw, pitch, radius, target: target.clone(), fov: camera.fov }; };
  // held in the hand, the close shots: the eye wanders a little and breathes (?hand=0 off, ?hand=2 twice as much)
  const HAND = Math.max(0, +(query.get('hand') ?? 1));
  let sway = 0;
  // (?debug skips it: the roof open, the eye on the pod, no fade)
  const QUICK = query.has('debug');
  let cine: null | { t: number; on: boolean } = QUICK ? null : { t: 0, on: false }; // (on once the scene is there)
  // how many of the opening's cues have been given. They are not the opening's to lose: cut it short, with a
  // press before it has begun even, and what it had still to set going is set going at once (the roof opens,
  // the fans run): the hall is not left shut and dark because you were quick
  let cuesDone = QUICK ? CUES.length : 0;
  const target = (QUICK ? LAND : SHOT).target.clone();
  // the view people get, as the hall picture has it: from below, looking up at the pod's left side and front
  const home = new THREE.Vector3(0.1, 0.15, 0);
  const YAW0 = -0.6;
  const PITCH0 = -0.55;
  let yaw = QUICK ? LAND.yaw : SHOT.yaw;
  let pitch = QUICK ? LAND.pitch : SHOT.pitch;
  let vyaw = 0;
  let vpitch = 0;
  let radius = QUICK ? LAND.radius : SHOT.radius;
  let homeRadius = 7.5;
  // a view the camera is easing to (the debug panel's), null while it is yours
  // (`rate`: how fast the eye goes there, per second; 6 unless said, which is the debug panel's snap)
  let goal: null | { yaw: number; pitch: number; radius: number; target: THREE.Vector3; rate?: number } = null;
  const NUDGE = 0.06; // it is heavy: how far a hand can lean it, radians
  let still = true; // the debug panel's hold still: no swing, no crane round; on from the start
  const podRest = new THREE.Quaternion(); // how the pod hangs, askew, as it comes from Blender

  // ---------- the pod: a pendulum under `hang`, with a twist of its own

  const swing = new THREE.Group(); // at the hang point, leans two ways
  const twist = new THREE.Group(); // at the pod, turns about the vertical
  swing.add(twist);
  scene.add(swing);
  let L = 8;
  let ax = 0; // lean about x: towards and away from the eye
  let az = 0.04; // lean about z: left and right
  let tw = 0;
  let vax = 0;
  let vaz = 0;
  let vtw = 0.03;

  // ---------- the crane: a trolley runs the pod along the girder above, a hoist winds it up and lets it down.
  // Slowly, as something this heavy is moved, with long waits; it swings as the trolley starts and stops
  const REACH = 5; // how far along the girder either way, metres
  const LIFT = 2; // how far up
  const MOVES: [number, number, number][] = [
    // [seconds, along, up]: from each to the next, eased, standing still at each
    [0, 0, 0], [8, 0, 0], [22, REACH, 0], [28, REACH, 0], [37, REACH, LIFT], [44, REACH, LIFT], [53, REACH, 0], [58, REACH, 0],
    [84, -REACH, 0], [90, -REACH, 0], [99, -REACH, LIFT], [106, -REACH, LIFT], [115, -REACH, 0], [120, -REACH, 0], [134, 0, 0],
  ];
  const crane = (t: number, out: THREE.Vector3) => {
    const u = t % MOVES[MOVES.length - 1][0];
    let i = 0;
    while (MOVES[i + 1][0] < u) i++;
    const [t0, x0, y0] = MOVES[i], [t1, x1, y1] = MOVES[i + 1];
    const k = THREE.MathUtils.smootherstep(u, t0, t1);
    return out.set(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, 0);
  };
  let craneTime = 0;
  // the hand on it, once the hologram has linked the crane (game.ts): a lever that pushes the trolley one way or
  // the other, heavy, against the girder's ends; the hoist lets the pod back down to its rest as you go
  const END = 10; // the trolley's travel along the girder, either way
  const DOCK = 9;
  let hand = null as null | { push: number; v: number }; // (nothing links it now: it was linked through pods.ts, which is gone with the twin)
  let doorFree = false; // in the dock: the door opens on its own
  const carry = new THREE.Vector3(); // where the crane has the pod: along the girder (x), up (y)
  let carryWas = 0, carryWas2 = 0; // along, the steps before: how hard the trolley pulls
  const hangAt = new THREE.Vector3(); // the hang point, the trolley at the middle
  const hangDown = new THREE.Vector3(); // from the hang point to the pod, unit
  let L0 = 8;
  let mainWire: THREE.Group | null = null;
  const socketsAt: { at: THREE.Vector3; live: THREE.Vector3 }[] = []; // the hoses' tops, on the trolley

  let pod: THREE.Object3D | null = null;
  const podInverse = new THREE.Matrix4();
  const podCentre = new THREE.Vector3();
  const podRadii = new THREE.Vector3(1, 1, 1);

  // the door: a plate on a hinge under gravity, in a pod that swings, with a strut that pulls it to. It cannot quite shut.
  const AJAR = 0.06; // as shut as it gets
  const WIDE = 1.9;
  const STICK = 0.5; // rad/s² the hinge holds against
  const STRUT = 7; // rad/s² per radian open, the pull back to
  let door: THREE.Object3D | null = null;
  const doorRest = new THREE.Quaternion();
  const doorCom = new THREE.Vector3(); // door local
  let doorSign = 1; // which way round the hinge is open
  let doorArm2 = 0.2; // (distance of its centre from the hinge) squared
  let open = 0;
  // shut and latched to start with; a press on it and the latch lets go: it pops a crack open, and the blood comes
  let latched = true;
  // held open far enough and let go, it catches and stays: HOLD and beyond, it settles at STAY
  const HOLD = 1.1, STAY = 1.32;
  let stuck = false;
  const m4 = new THREE.Matrix4();
  let cutNow = false; // a cut this frame: the focus jumps with it, it is not pulled
  let downAt: null | { x: number; y: number; t: number; stuck: boolean; onPod: boolean } = null; // the press, to tell a tap from a drag
  let vopen = 0;
  const hinge = new THREE.Vector3();
  const hingeWas = new THREE.Vector3();
  const hingeVel = new THREE.Vector3();
  const hingeAcc = new THREE.Vector3();
  let hingeKnown = false;

  const cables: Cable[] = [];
  let hall: ReturnType<typeof buildHall> | null = null;

  // what it hangs by: the hoist's block, locked onto the pin of the mount at the pod's back, one wire from the
  // block up to the trolley. (It was a ring and four slings to lugs on its shoulders.)
  const wireMat = wireSteel;
  const rodGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  rodGeo.translate(0, 0.5, 0);
  const HEAD = 0.8; // from the pin up to where the wire goes into the block
  const block = new THREE.Group(); // in the twist, at the pin: it turns and leans with the pod
  {
    const part = (geo: THREE.BufferGeometry, y: number, x = 0) => {
      const m = new THREE.Mesh(geo, wireMat);
      m.position.set(x, y, 0);
      m.castShadow = true;
      block.add(m);
      return m;
    };
    const acrossX = (r: number, len: number, seg = 20) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
    part(new THREE.BoxGeometry(0.07, 0.32, 0.14), 0.1); // the tongue between the cheeks, the pin through it
    part(new THREE.CylinderGeometry(0.085, 0.085, 0.07, 20), 0.29); // a swivel
    part(new THREE.BoxGeometry(0.2, 0.05, 0.2), 0.345);
    for (const x of [-0.085, 0.085]) part(new THREE.BoxGeometry(0.028, 0.42, 0.3), 0.56, x); // the block's cheeks
    part(acrossX(0.13, 0.1, 28), 0.56); // the sheave
    part(acrossX(0.045, 0.24), 0.56); // its axle
    part(new THREE.BoxGeometry(0.2, 0.04, 0.14), 0.77);
  }
  const wire = (r: number) => {
    const g = new THREE.Group();
    const rod = new THREE.Mesh(rodGeo, wireMat);
    rod.scale.set(r, 1, r);
    const f0 = new THREE.Mesh(rodGeo, wireMat); // a pressed sleeve at each end
    f0.scale.set(r * 1.9, 0.13, r * 1.9);
    f0.position.y = 0.04;
    const f1 = f0.clone();
    rod.castShadow = f0.castShadow = f1.castShadow = true;
    g.add(rod, f0, f1);
    g.userData = { rod, f1 };
    return g;
  };
  const stretch = (w: THREE.Group, a: THREE.Vector3, b: THREE.Vector3) => {
    const d = b.clone().sub(a);
    const len = d.length();
    w.position.copy(a);
    w.quaternion.setFromUnitVectors(Y, d.divideScalar(len));
    w.userData.rod.scale.y = len;
    w.userData.f1.position.y = len - 0.17;
  };
  let blood: Blood | null = null;
  let screen: Screen | null = null; // what is in there (screen.ts)
  const restInverse = new THREE.Matrix4(); // the pod as it hangs at rest, inverted: the look in is written in that frame
  let bloodAt: THREE.Object3D | null = null; // where it drips from: the lowest point of the pod's edge under the door's corner
  let raysPass: Rays | null = null;
  const inside = new THREE.PointLight(0xff2410, 1.6, 2.4, 2);
  // the lamp it comes from: a red bar under the pod's ceiling (it was a light at the pod's middle with nothing to see)
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.025, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.6, emissive: 0xff2410, emissiveIntensity: 0 }),
  );
  GLOWING.push({ material: lamp.material, gain: 2.5 });
  /** something in there breathing, slowly: in for two and a half seconds, out for four; 0 out, 1 in */
  const heart = (t: number) => {
    const u = (t % 6.5) / 6.5;
    const w = u < 0.38 ? (u / 0.38) * 0.5 : 0.5 + ((u - 0.38) / 0.62) * 0.5;
    return (0.5 - 0.5 * Math.cos(2 * Math.PI * w)) ** 1.4;
  };
  const GLOW = { rest: 0.06, beat: 2.2 }; // how bright the window and the lamp in there, breathed out and in

  const Y = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();

  /** bounds of everything under `root`, in root's own space */
  function localBox(root: THREE.Object3D) {
    root.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const box = new THREE.Box3();
    const m = new THREE.Matrix4();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld)));
    });
    return box;
  }

  function setDoor() {
    if (!door) return;
    door.quaternion.copy(doorRest).multiply(q.setFromAxisAngle(Y, doorSign * open));
  }

  // (the glb is packed after Blender writes it: `pnpm -C 20 glb`, its meshes meshopt-compressed and quantized, its
  // textures webp; 1.6 MB where it was 6.4)
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(`${import.meta.env.BASE_URL}cocoon.glb`, (gltf) => {
    const root = gltf.scene;
    dress(root);
    instances(root); // the bolts and the hoses' collars, from where they go
    scene.add(root);
    root.updateWorldMatrix(true, true);
    const named = (re: RegExp) => {
      const out: THREE.Object3D[] = [];
      root.traverse((o) => re.test(o.name) && out.push(o));
      return out.sort((a, b) => a.name.localeCompare(b.name));
    };
    pod = root.getObjectByName('pod')!;
    door = root.getObjectByName('door') ?? null;
    const hang = root.getObjectByName('hang');
    const plugs = named(/^plug[._]?\d+$/);
    const sockets = named(/^socket[._]?\d+$/);
    const drips = named(/^drip[._]?\d+$/);
    const lifts = named(/^lift[._]?\d+$/);

    const box = localBox(pod);
    box.getCenter(podCentre);
    box.getSize(podRadii).multiplyScalar(0.5 * 1.04).addScalar(0.07);

    // hang the pod: swing at the hang point, twist at the mount's pin, the pod keeps its place and its tilt
    const at = pod.getWorldPosition(new THREE.Vector3());
    if (hang) hang.getWorldPosition(swing.position);
    else swing.position.set(at.x, at.y + 8, at.z);
    // (twist at the pin it hangs by, straight under the hang point: the pod turns about its mount, not its middle)
    const held = lifts.length ? lifts[0].getWorldPosition(new THREE.Vector3()) : at;
    L = L0 = swing.position.distanceTo(held);
    hangAt.copy(swing.position);
    twist.position.copy(held).sub(swing.position);
    hangDown.copy(twist.position).normalize();
    swing.updateWorldMatrix(true, true);
    twist.attach(pod);
    podRest.copy(pod.quaternion);
    // under the ceiling: straight up from the pod's middle to the first of its own shell
    {
      pod.updateWorldMatrix(true, true);
      const from = podCentre.clone().applyMatrix4(pod.matrixWorld);
      const up = new THREE.Vector3(0, 1, 0).transformDirection(pod.matrixWorld);
      const shell = (o: THREE.Object3D) => o === pod || (o.parent === pod && /^pod/.test(o.name));
      const hit = new THREE.Raycaster(from, up, 0.05, 3).intersectObject(pod, true).find((h) => shell(h.object));
      const top = hit ? pod.worldToLocal(hit.point.clone()) : podCentre.clone().setY(podCentre.y + podRadii.y * 0.6);
      lamp.position.copy(top).setY(top.y - 0.03);
      inside.position.copy(top).setY(top.y - 0.14);
      pod.add(lamp, inside);
    }
    // nobody in there: the wrapped thing and its straps are in the model still, and not shown
    pod.traverse((o) => { if (/^(body|strap[._]?\d+)$/.test(o.name)) o.visible = false; });
    // the screen in there, on what held it, turned a little towards the door's opening (placed in the world, then hung on the pod)
    restInverse.copy(pod.matrixWorld).invert();
    screen = new Screen();
    screen.mesh.position.copy(SCREEN_AT);
    screen.mesh.rotation.y = 0.3;
    scene.add(screen.mesh);
    pod.attach(screen.mesh);

    hall = buildHall(scene, swing.position.clone(), renderer.capabilities.maxTextureSize, query.get('steel'));
    if (NO.has('scaffolding')) hall.scaffolding(false);
    // the sun's light in the haze, marched against its shadow map, after the AO and before the tone mapping
    const rays = new Rays(camera, hall.sun, hall.podSun, () => (eye === camera ? sceneDepth : null), { roof: hall.roofY, box: hall.air, density: 0.04, fans: hall.fans });
    post.insert(rays, 1);
    raysPass = rays;
    if (import.meta.env.DEV) Object.assign(window, { rays, sun: hall.sun, hall });
    // ?debug: colours and render settings by hand
    if (query.has('debug')) { const h = hall; import('./tweaks').then(({ tweaks }) => tweaks({ renderer, scene, hemi, ao, rays, hall: h })); }
    pod.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
    if (lifts.length) {
      twist.add(block);
      const main = wire(0.032);
      swing.add(main);
      mainWire = main;
      stretch(main, new THREE.Vector3(0, 0.15, 0), twist.position.clone().addScaledVector(hangDown, -HEAD));
    }

    if (door) {
      doorRest.copy(door.quaternion);
      localBox(door).getCenter(doorCom);
      doorArm2 = Math.max(0.01, doorCom.x * doorCom.x + doorCom.z * doorCom.z);
      // open is the way that takes the door away from the pod
      const far = (sign: number) => {
        door!.quaternion.copy(doorRest).multiply(q.setFromAxisAngle(Y, sign * 0.4));
        door!.updateWorldMatrix(true, false);
        return v1.copy(doorCom).applyMatrix4(door!.matrixWorld).distanceTo(v2.copy(podCentre).applyMatrix4(pod!.matrixWorld));
      };
      doorSign = far(1) > far(-1) ? 1 : -1;
      setDoor();
    }

    plugs.forEach((plug, i) => {
      const socket = sockets[i];
      if (!socket) return;
      const top = socket.getWorldPosition(new THREE.Vector3());
      socketsAt.push({ at: top.clone(), live: top });
      const cable = new Cable(top, plug, plug.userData.radius ?? 0.045, plug.userData.slack ?? 1.1, rubber);
      cable.mesh.castShadow = true;
      cables.push(cable);
      scene.add(cable.mesh);
    });
    // (this is the only pod in the hall: its twin, which hung from a trolley under the next girder, is gone)
    // the roof's shutter darkens the sun wherever it is: every lit material takes its uniforms
    shareCover(scene, hall.spare);
    // the page comes up black; once all of it is there and drawn (two frames, the shaders built), it fades in
    if (QUICK) { hall.roofSet(true); document.querySelector('.fade')?.remove(); }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector('.fade')?.classList.add('in');
      if (cine) cine.on = true;
    }));
    // (one run only, at the door: the other point, under the pod, is left dry)
    bloodAt = drips[0] ?? null;
    if (bloodAt) blood = new Blood(bloodAt);
    if (blood) scene.add(blood.mesh);

    // let the cables fall into place before anyone looks
    for (let i = 0; i < 400; i++) physics(STEP, 0);
  });

  /** push a rope point out of the pod, taken as an ellipsoid */
  function collide(p: Float32Array, i: number) {
    v1.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(podInverse).sub(podCentre).divide(podRadii);
    const d = v1.lengthSq();
    if (d >= 1 || d < 1e-8) return;
    v1.divideScalar(Math.sqrt(d)).multiply(podRadii).add(podCentre).applyMatrix4(pod!.matrixWorld);
    p[i] = v1.x;
    p[i + 1] = v1.y;
    p[i + 2] = v1.z;
  }

  // ---------- hands

  type Grab = null | 'orbit' | 'pan' | 'pod' | 'door';
  let grab: Grab = null;
  let px = 0;
  let py = 0;
  let axTo = 0; // where the hand holds the pod
  let azTo = 0;
  let openTo = 0; // where the hand holds the door
  const doorPull = new THREE.Vector2(); // px on screen per radian of door, where it was grabbed
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const toScreen = (v: THREE.Vector3) => {
    v.project(eye);
    return new THREE.Vector2((v.x * 0.5 + 0.5) * canvas.clientWidth, (-v.y * 0.5 + 0.5) * canvas.clientHeight);
  };

  // two fingers: a pinch, nearer or farther, and nothing else while it lasts
  const fingers = new Map<number, { x: number; y: number }>();
  let pinch: null | { d: number; r: number } = null;
  const spread = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  let wasIn = false; // the press came while the eye was looking in: it takes the eye back, it does not start it again
  // While the eye is on its own, only a press on the pod takes it: a press on the hall is let go by. (Any press
  // took it, and a stray click during a shot of the roof left you holding the eye, looking at the roof.) Once
  // it is yours, the hall is yours to drag round as before. And the pointer shows which: a hand over the pod
  const overPod = (x: number, y: number) => {
    if (!pod) return false;
    ndc.set((x / canvas.clientWidth) * 2 - 1, -(y / canvas.clientHeight) * 2 + 1);
    ray.setFromCamera(ndc, eye);
    return ray.intersectObject(pod, true).length > 0;
  };
  let missed = false; // this press was on the hall while the eye was on its own: nothing comes of it
  canvas.addEventListener('pointerdown', (e) => {
    missed = !!(cine || auto) && !overPod(e.clientX, e.clientY);
    if (missed) return;
    wasIn = !!peek;
    cine = auto = peek = null; // (the eye is yours)
  });
  canvas.addEventListener('wheel', (e) => {
    missed = !!(cine || auto) && !overPod(e.clientX, e.clientY);
    if (!missed) cine = auto = peek = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && !e.buttons) canvas.classList.toggle('on-pod', overPod(e.clientX, e.clientY));
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (missed) return;
    if (e.pointerType === 'touch') {
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size === 2) {
        pinch = { d: spread(), r: radius };
        vyaw = vpitch = 0;
        if (grab === 'door' || grab === 'pod') { axTo = ax; azTo = az; openTo = open; }
        grab = null;
        goal = null;
        return;
      }
      if (fingers.size > 2) return;
    }
    px = e.clientX;
    py = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    goal = null;
    downAt = { x: e.clientX, y: e.clientY, t: performance.now(), stuck, onPod: false };
    // right drag or shift drag moves the camera sideways, anywhere
    if (e.button === 2 || e.shiftKey) { grab = 'pan'; return; }
    grab = 'orbit';
    if (!pod) return;
    ndc.set((e.clientX / canvas.clientWidth) * 2 - 1, -(e.clientY / canvas.clientHeight) * 2 + 1);
    ray.setFromCamera(ndc, eye);
    const hit = ray.intersectObject(pod, true)[0];
    if (!hit) return;
    downAt.onPod = true;
    let o: THREE.Object3D | null = hit.object;
    while (o && o !== door) o = o.parent;
    if (o && door && latched) {
      latched = false;
      open = AJAR;
      vopen = 0.7; // (a pop: it springs out and settles a crack open, the strut holding it)
      blood?.start();
      grab = null;
      return;
    }
    if (o && door) {
      // how the grabbed point moves on screen as the door opens: drag along that
      grab = 'door';
      openTo = open;
      const local = door.worldToLocal(hit.point.clone());
      const a = toScreen(hit.point.clone());
      door.quaternion.copy(doorRest).multiply(q.setFromAxisAngle(Y, doorSign * (open + 0.05)));
      door.updateWorldMatrix(false, false);
      const b = toScreen(local.applyMatrix4(door.matrixWorld));
      setDoor();
      door.updateWorldMatrix(false, true);
      doorPull.subVectors(b, a).divideScalar(0.05);
      if (doorPull.length() < 60) doorPull.setLength(60);
    } else {
      grab = 'pod';
      axTo = ax;
      azTo = az;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (fingers.size >= 2) radius = THREE.MathUtils.clamp((pinch.r * pinch.d) / spread(), 2, 16);
      return;
    }
    const dx = e.clientX - px;
    const dy = e.clientY - py;
    px = e.clientX;
    py = e.clientY;
    if (grab === 'orbit') {
      vyaw = -dx * 0.004;
      vpitch = -dy * 0.004;
      yaw += vyaw;
      pitch += vpitch;
    } else if (grab === 'pan') {
      // the point under the hand stays under it, at the target's distance
      const wpp = (2 * radius * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / canvas.clientHeight;
      target.addScaledVector(v1.setFromMatrixColumn(camera.matrixWorld, 0), -dx * wpp);
      target.addScaledVector(v1.setFromMatrixColumn(camera.matrixWorld, 1), dy * wpp);
    } else if (grab === 'pod') {
      // the drag as a push in the world: sideways along the screen, down the screen is towards the eye
      const wpp = (2 * radius * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / canvas.clientHeight;
      const wx = (Math.cos(yaw) * dx + Math.sin(yaw) * dy) * wpp;
      const wz = (-Math.sin(yaw) * dx + Math.cos(yaw) * dy) * wpp;
      // it is heavy: a long drag is a nudge, it gives a few degrees at most
      azTo = THREE.MathUtils.clamp(azTo + (0.3 * wx) / L, -NUDGE, NUDGE);
      axTo = THREE.MathUtils.clamp(axTo - (0.3 * wz) / L, -NUDGE, NUDGE);
    } else if (grab === 'door') {
      stuck = false; // (in the hand again)
      openTo = THREE.MathUtils.clamp(openTo + (dx * doorPull.x + dy * doorPull.y) / doorPull.lengthSq(), AJAR, WIDE);
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (missed) return;
    goal = null;
    radius = THREE.MathUtils.clamp(radius * Math.exp(e.deltaY * 0.001), 2, 16);
  }, { passive: false });
  const release = (e: PointerEvent) => {
    // let go of the door far enough open: it catches
    if (grab === 'door' && open >= HOLD) stuck = true;
    // a tap on the pod: the eye goes to the door, wherever it was and whoever had it (it is not just left where
    // the shot had it, for you to turn); and if the door stands open, caught, it goes to look in. A tap while it
    // is looking in brings it back out to the door.
    const tap = downAt && performance.now() - downAt.t < 400 && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8;
    if (tap && downAt!.onPod && e.type === 'pointerup') {
      if (downAt!.stuck && !wasIn) { stuck = true; lookIn(); }
      else goal = { yaw: FRONT.yaw, pitch: FRONT.pitch, radius: FRONT.radius * fit(), target: FRONT.target.clone(), rate: 2.4 };
    }
    downAt = null;
    grab = null;
    fingers.delete(e.pointerId);
    if (fingers.size < 2) pinch = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  const lookIn = () => peekStart();
  // dev only: a look at the state from the console
  if (import.meta.env.DEV) Object.assign(window, { cocoon: () => ({ grab, open, vopen, ax, az, tw, doorSign, cables: cables.length, carry: carry.x, hand, doorFree }), __x: () => carry.x, look: (y: number, p: number, r: number) => { goal = null; yaw = y; pitch = p; radius = r; vyaw = vpitch = 0; }, craneAt: (t: number) => { craneTime = t; }, doorAt: (v: number) => { latched = false; open = v; vopen = 0; stuck = v >= HOLD; }, peekAt: (t: number) => { if (!peek) peekStart(); peek!.t = t; }, shotKey: () => (auto ? key(shown()) : cine?.on ? 'cine' : null), shot: (i: number, x = 0.5) => { play(); auto!.i = i; auto!.t = CUT * AUTO[i].s * x; }, see: (what: 'roof' | 'fans' | 'rail', k: number) => { play(); auto!.q = SEE[what][k]; auto!.t = (CUT * auto!.q.s) / 2; }, cineAt: (t: number) => { if (cine) cine.t = t; }, view: (s: { yaw: number; pitch: number; radius: number; target: number[] }) => { goal = null; yaw = s.yaw; pitch = s.pitch; radius = s.radius; target.fromArray(s.target); vyaw = vpitch = 0; }, scene, camera, ao, renderer, post });

  // ---------- physics, in fixed steps

  function physics(h: number, time: number) {
    if (!pod) return;
    // the crane: the hang point along the girder, the pod up the line; the pendulum feels the trolley's pull
    if (hand) {
      hand.v += (hand.push * 0.22 - 0.35 * hand.v) * h;
      carry.x += hand.v * h;
      if (Math.abs(carry.x) > END) { carry.x = Math.sign(carry.x) * END; hand.v *= -0.15; } // it knocks at the end
      carry.y += (0 - carry.y) * Math.min(1, h * 0.6);
    } else {
      if (railOn) craneTime += h;
      crane(craneTime, carry);
    }
    // (no more than a trolley this slow can pull: a jump, the debug panel's or a frame that took long, is not a kick)
    const pull = THREE.MathUtils.clamp((carry.x - 2 * carryWas + carryWas2) / (h * h), -0.3, 0.3);
    carryWas2 = carryWas;
    carryWas = carry.x;
    swing.position.set(hangAt.x + carry.x, hangAt.y, hangAt.z);
    L = L0 - carry.y;
    twist.position.copy(hangDown).multiplyScalar(L);
    if (mainWire) stretch(mainWire, v1.set(0, 0.15, 0), v2.copy(twist.position).addScaledVector(hangDown, -HEAD));
    for (const s of socketsAt) s.live.set(s.at.x + carry.x, s.at.y, s.at.z);
    if (hall) hall.trolley.position.x = carry.x;
    const w2 = G / L;
    if (grab === 'pod') {
      // the hand on something heavy: a soft spring, it comes slowly and keeps going a little
      vax += (22 * (axTo - ax) - 7 * vax) * h;
      vaz += (22 * (azTo - az) - 7 * vaz) * h;
    } else if (still) {
      // held still: no air moving it, and a push dies out: let go, it swings back once, heavily, and settles
      vax += (-w2 * ax - 1.2 * vax) * h;
      vaz += (-w2 * az - 1.2 * vaz) * h;
    } else {
      // free: gravity, a little loss, and the air of the hall never quite still
      vax += (-w2 * ax - 0.12 * vax + 0.004 * Math.sin(time * 0.47 + 2)) * h;
      vaz += (-w2 * az - 0.12 * vaz + 0.005 * Math.sin(time * 0.31) + 0.003 * Math.sin(time * 0.73 + 1)) * h;
    }
    // (left behind as the trolley sets off, thrown on as it stops)
    if (!still || railOn) vaz -= (pull / L) * h;
    vtw += (still ? -0.3 * tw - 0.8 * vtw : -0.3 * tw - 0.15 * vtw + 0.004 * Math.sin(time * 0.19) - 0.5 * vaz * vax) * h;
    ax += vax * h;
    az += vaz * h;
    tw += vtw * h;
    swing.rotation.set(ax, 0, az);
    twist.rotation.y = tw;
    swing.updateMatrixWorld(true);
    podInverse.copy(pod.matrixWorld).invert();

    if (door) {
      // gravity as the door feels it: less whatever the hinge is being thrown about with
      door.getWorldPosition(hinge);
      if (hingeKnown) {
        v1.subVectors(hinge, hingeWas).divideScalar(h);
        v2.subVectors(v1, hingeVel).divideScalar(h);
        hingeVel.copy(v1);
        hingeAcc.lerp(v2, 0.15);
      }
      hingeWas.copy(hinge);
      hingeKnown = true;
      if (latched) {
        open = vopen = 0;
      } else if (grab === 'door') {
        vopen += (220 * (openTo - open) - 30 * vopen) * h;
      } else {
        v1.copy(doorCom).applyMatrix4(door.matrixWorld).sub(hinge); // arm
        v2.set(0, -G, 0).sub(hingeAcc); // pull
        v3.set(0, 1, 0).transformDirection(door.matrixWorld); // hinge
        // gravity and the swing throw it about, a tired strut pulls it to: whichever way the pod hangs it
        // comes to rest nearly shut
        const pull = stuck ? 14 * (STAY - open) - 2.4 * vopen : doorFree ? 3 * (1.45 - open) : doorSign * v1.cross(v2).dot(v3) * (3 / (4 * doorArm2)) * 0.35 - STRUT * (open - AJAR);
        // a dry hinge: it stays where it is left until the pull is more than the hinge holds, and drags while it moves
        if (stuck) vopen += pull * h;
        else if (!doorFree && Math.abs(vopen) < 0.02 && Math.abs(pull) < STICK) vopen = 0;
        else vopen += (pull - Math.sign(vopen || pull) * STICK * 0.6 - 0.6 * vopen) * h;
      }
      open += vopen * h;
      if (latched) {
        open = 0;
      } else if (open < AJAR) {
        open = AJAR;
        vopen = Math.abs(vopen) * 0.25; // it knocks, it does not latch
      } else if (open > WIDE) {
        open = WIDE;
        vopen = -Math.abs(vopen) * 0.2;
      }
      setDoor();
      door.updateMatrixWorld(true);
    }
    for (const c of cables) c.step(h, collide);
  }

  // ---------- the debug panel: views as on a turnaround sheet, iso or perspective, hold still

  const panel = document.querySelector<HTMLElement>('.debug');
  const showDebug = query.has('settings') || query.has('debug'); // (hidden otherwise, in dev too)
  type View = 'front' | 'side' | 'back' | 'persp';
  let side = -1; // which flank Side shows: -1 the 03 shield's (the sheet's right view), 1 the other
  const debug = panel && showDebug ? (() => {
    panel.hidden = false;
    const gear = panel.querySelector<HTMLButtonElement>('.gear')!;
    const menu = panel.querySelector<HTMLElement>('.menu')!;
    const readout = panel.querySelector<HTMLElement>('.readout')!;
    const views = [...panel.querySelectorAll<HTMLButtonElement>('[data-view]')];
    const projs = [...panel.querySelectorAll<HTMLButtonElement>('[data-proj]')];
    const stillBtn = panel.querySelector<HTMLButtonElement>('[data-still]')!;
    const aoBtn = panel.querySelector<HTMLButtonElement>('[data-ao]')!;
    const shadeBtn = panel.querySelector<HTMLButtonElement>('[data-shade]')!;
    const stepBtns = [...panel.querySelectorAll<HTMLButtonElement>('[data-steps]')];
    const steelBtns = [...panel.querySelectorAll<HTMLButtonElement>('[data-steel]')];
    let steelMode = NO.has('scaffolding') ? 'off' : 'grit';
    const copyBtn = panel.querySelector<HTMLButtonElement>('[data-copy]')!;
    // Blood: the eye goes close in on where it drips, and it is set dripping without the door being pressed
    panel.querySelector<HTMLButtonElement>('[data-blood]')!.addEventListener('click', () => {
      if (!bloodAt) return;
      blood?.start();
      goal = { yaw: 0.45, pitch: -0.1, radius: 0.5, target: bloodAt.getWorldPosition(new THREE.Vector3()).sub(carry).add(new THREE.Vector3(0, -0.07, 0)) };
      mark();
    });
    // the view and what the scene is doing, as text to paste back to whoever is working on it
    const copyView = async () => {
      const r = (v: number, n = 2) => +v.toFixed(n);
      const v3 = (v: THREE.Vector3) => [r(v.x), r(v.y), r(v.z)];
      const podAt = pod ? v3(podCentre.clone().applyMatrix4(pod.matrixWorld)) : null;
      const snap = {
        eye: { yaw: r(yaw), pitch: r(pitch), radius: r(radius), target: v3(target), camera: v3(camera.position), look: v3(camera.getWorldDirection(new THREE.Vector3())), fov: camera.fov, projection: eye === ortho ? 'iso' : 'pers' },
        pod: { at: podAt, swing: r(THREE.MathUtils.radToDeg(Math.hypot(ax, az)), 1), twist: r(THREE.MathUtils.radToDeg(tw), 1), door: r(THREE.MathUtils.radToDeg(open), 0), doorFree, still },
        crane: { along: r(carry.x), up: r(carry.y), time: r(craneTime, 1), hand: hand ? { push: hand.push, v: r(hand.v) } : null },
        screen: { css: [canvas.clientWidth, canvas.clientHeight], dpr: devicePixelRatio, fps: r(1000 / frameMs, 0), ms: r(frameMs, 1) },
        at: new Date().toISOString(),
        ua: navigator.userAgent,
      };
      const text = '```json\n' + JSON.stringify(snap, null, 1) + '\n```\n' + `look(${r(yaw)}, ${r(pitch)}, ${r(radius)})`;
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch { /* not a secure page (the phone on the local net): the old way */ }
      if (!ok) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0', userSelect: 'text', webkitUserSelect: 'text' });
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        ok = document.execCommand('copy');
        ta.remove();
      }
      copyBtn.firstChild!.textContent = ok ? 'Copied' : 'No clipboard';
      setTimeout(() => { copyBtn.firstChild!.textContent = 'Copy view'; }, 1400);
    };
    copyBtn.addEventListener('click', copyView);
    const refs = [...panel.querySelectorAll<HTMLButtonElement>('[data-ref]')];
    const pane = document.querySelector<HTMLCanvasElement>('.ref')!;
    // the reference: the turnaround sheet's view for front, flanks and back, the hall picture for perspective.
    // It lives in model/ref, out of the repo, so only the dev server has it.
    const load = (name: string) => { const i = new Image(); i.src = `${import.meta.env.BASE_URL}model/ref/${name}.webp`; i.onload = () => drawRef(); return i; };
    const sheet = load('sheet');
    const hallPic = load('hall');
    // where each view sits on the sheet, in its pixels (model/sheet.py)
    const CROPS: Record<string, [number, number, number, number]> = {
      front: [40, 0, 280, 300], 'side-1': [315, 0, 560, 300], side1: [805, 0, 1045, 300], back: [585, 0, 780, 300],
    };
    let split: 'off' | 'side' | 'down' = 'off';
    const drawRef = () => {
      if (split === 'off') return;
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = pane.clientWidth, h = pane.clientHeight;
      pane.width = w * dpr; pane.height = h * dpr;
      const g = pane.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#16181b'; g.fillRect(0, 0, w, h);
      const key = current === 'side' ? `side${side}` : current ?? 'persp';
      const crop = CROPS[key];
      const img = crop ? sheet : hallPic;
      if (!img.complete || !img.naturalWidth) {
        g.fillStyle = '#f4f4f2'; g.font = '600 11px Inter, sans-serif'; g.textAlign = 'center';
        g.fillText('NO REFERENCE: MODEL/REF IS ONLY ON THE DEV SERVER', w / 2, h / 2);
        return;
      }
      const [sx, sy, sx1, sy1] = crop ?? [0, 0, img.naturalWidth, img.naturalHeight];
      const sw = sx1 - sx, sh = sy1 - sy;
      const k = Math.min((w - 32) / sw, (h - 32) / sh);
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, sx, sy, sw, sh, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k);
    };
    const setSplit = (s: typeof split) => {
      split = s;
      document.body.classList.toggle('split-side', s === 'side');
      document.body.classList.toggle('split-down', s === 'down');
      pane.hidden = s === 'off';
      resize();
      drawRef();
      mark();
    };
    window.addEventListener('resize', () => drawRef());
    let current: View | null = 'persp';
    // open unless it was folded away last time
    const FOLDED = 'day20.debug.folded';
    const fold = panel.querySelector<HTMLButtonElement>('.fold')!;
    const setOpen = (o: boolean) => {
      menu.hidden = !o;
      gear.hidden = o;
      gear.setAttribute('aria-expanded', String(o));
      try { localStorage.setItem(FOLDED, o ? '0' : '1'); } catch { /* no storage */ }
    };
    let folded = false;
    try { folded = localStorage.getItem(FOLDED) === '1'; } catch { /* no storage */ }
    setOpen(!folded);
    const mark = () => {
      views.forEach((b) => b.classList.toggle('on', goal !== null && b.dataset.view === current));
      projs.forEach((b) => b.classList.toggle('on', (b.dataset.proj === 'ortho') === (eye === ortho)));
      stillBtn.classList.toggle('on', still);
      aoBtn.classList.toggle('on', aoOn);
      shadeBtn.classList.toggle('on', SHADE.value > 0.5);
      for (const b of stepBtns) b.classList.toggle('on', +b.dataset.steps! === (raysPass?.steps ?? 24));
      for (const b of steelBtns) b.classList.toggle('on', b.dataset.steel === steelMode);
      refs.forEach((b) => b.classList.toggle('on', b.dataset.ref === split));
      drawRef();
    };
    const look = (view: View) => {
      if (view === 'side' && current === 'side' && goal) side = -side;
      current = view;
      if (view === 'persp' || !pod) {
        // back to the pod as it hangs (still, unless hold still was let go)
        if (pod) pod.quaternion.copy(podRest);
        goal = { yaw: YAW0, pitch: PITCH0, radius: homeRadius, target: home.clone() };
      } else {
        // the sheet draws it hanging straight and still: so does this, while you compare
        pod.quaternion.identity();
        pod.updateWorldMatrix(true, false); // the view is worked out from the pod straightened, not as it hung last frame
        still = true;
        ax = az = tw = vax = vaz = vtw = 0; // (and hanging dead still, as the sheet draws it)
        // straight at the pod's own front, flank or back, however it hangs, its middle in the middle
        const local = view === 'front' ? new THREE.Vector3(0, 0, 1) : view === 'back' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(side, 0, 0);
        const d = local.transformDirection(pod.matrixWorld);
        const c = podCentre.clone().applyMatrix4(pod.matrixWorld).sub(carry); // (the eye goes where the crane takes it)
        goal = { yaw: Math.atan2(d.x, d.z), pitch: 0, radius: 5.8 / Math.min(1, camera.aspect / 0.85), target: c };
      }
      mark();
    };
    const project = (o: boolean) => { eye = o ? ortho : camera; mark(); };
    gear.addEventListener('pointerdown', (e) => e.preventDefault());
    gear.addEventListener('click', () => setOpen(true));
    fold.addEventListener('pointerdown', (e) => e.preventDefault());
    fold.addEventListener('click', () => setOpen(false));
    views.forEach((b) => b.addEventListener('click', () => look(b.dataset.view as View)));
    projs.forEach((b) => b.addEventListener('click', () => project(b.dataset.proj === 'ortho')));
    stillBtn.addEventListener('click', () => { still = !still; mark(); });
    aoBtn.addEventListener('click', () => { aoOn = !aoOn; mark(); });
    // the baked AO (the paint's, and the colour on the other parts' vertices): on or off, to see what it does
    shadeBtn.addEventListener('click', () => { SHADE.value = SHADE.value > 0.5 ? 0 : 1; mark(); });
    stepBtns.forEach((b) => b.addEventListener('click', () => { if (raysPass) raysPass.steps = +b.dataset.steps!; mark(); }));
    steelBtns.forEach((b) => b.addEventListener('click', () => {
      steelMode = b.dataset.steel!;
      hall?.plainSteel(steelMode === 'plain');
      hall?.scaffolding(steelMode !== 'off');
      mark();
    }));
    refs.forEach((b) => b.addEventListener('click', () => setSplit(b.dataset.ref as typeof split)));
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '1') look('front');
      else if (e.key === '3') look('side');
      else if (e.key === '9') look('back');
      else if (e.key === '0') look('persp');
      else if (e.key === '5') project(eye !== ortho);
      else if (e.key === 'h' || e.key === 'H') { still = !still; mark(); }
      else if (e.key === 'o' || e.key === 'O') { aoOn = !aoOn; mark(); }
      else if (e.key === 'm' || e.key === 'M') { SHADE.value = SHADE.value > 0.5 ? 0 : 1; mark(); }
      else if (e.key === 'c' || e.key === 'C') copyView();
      else if (e.key === 'r' || e.key === 'R') setSplit(split === 'off' ? 'side' : split === 'side' ? 'down' : 'off');
    });
    canvas.addEventListener('pointerdown', () => queueMicrotask(mark));
    mark();
    return {
      tick() {
        if (menu.hidden) return;
        const deg = THREE.MathUtils.radToDeg;
        readout.textContent = `${(1000 / frameMs).toFixed(0)} fps  ${frameMs.toFixed(1)} ms  ${renderer.domElement.width}×${renderer.domElement.height}  css ${canvas.clientWidth}×${canvas.clientHeight} of ${innerWidth}×${innerHeight}\n` +
          `door ${deg(open).toFixed(0)}°  swing ${deg(Math.hypot(ax, az)).toFixed(1)}°  ${eye === ortho ? 'iso' : 'pers'}\n` +
          `eye yaw ${yaw.toFixed(2)} pitch ${pitch.toFixed(2)} r ${radius.toFixed(1)} at ${target.x.toFixed(2)} ${target.y.toFixed(2)} ${target.z.toFixed(2)}`;
      },
    };
  })() : null;

  // ---------- frame

  function resize() {
    const w = canvas.clientWidth; // the whole window, or half of it with the reference beside
    const h = canvas.clientHeight;
    if (!w || !h) return; // not laid out yet, or hidden
    // a budget of pixels: a big retina screen full has 7.5 million, and every pass pays for each; 4.5 million is
    // sharp still, at about half the cost
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2, Math.sqrt(4.5e6 / (w * h))));
    renderer.setSize(w, h, false);
    post.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const wasHome = radius === homeRadius && target.equals(home);
    homeRadius = 7.5 / Math.min(1, camera.aspect / 0.85); // step back on a narrow screen
    home.x = 0.1 + 0.75 * THREE.MathUtils.clamp((camera.aspect - 1) / 0.7, 0, 1); // on a wide one the pod hangs left of centre, the hall to its right
    if (wasHome) { radius = homeRadius; target.copy(home); }
  }
  window.addEventListener('resize', resize);
  // (a phone does not always say: the toolbars sliding away, a turn, the canvas changes size without a resize)
  new ResizeObserver(() => resize()).observe(canvas);
  resize();

  let then = performance.now();
  let owed = 0;
  let time = 0;
  let frameMs = 16.7; // smoothed, for the debug readout
  function frame(now: number) {
    // no more than 60 a second: a 120 Hz screen would draw all of it twice as often, for nothing seen
    if (now - then < 1000 / 62) { requestAnimationFrame(frame); return; }
    frameMs += (now - then - frameMs) * 0.05;
    const dt = Math.min(0.05, (now - then) / 1000);
    then = now;

    if (grab !== 'orbit') {
      yaw += vyaw;
      pitch += vpitch;
      vyaw *= 0.92;
      vpitch *= 0.92;
    }
    // the opening shot, eased from one view to the next (a view from the debug panel ends it)
    if (goal) cine = auto = peek = null;
    if (cine?.on) {
      cine.t += dt;
      while (cuesDone < CUES.length && CUES[cuesDone][0] <= cine.t) CUES[cuesDone++][1]();
      // which take, and how far into it; a new take is a cut
      let start = 0, k = 0;
      while (k < TAKES.length - 1 && cine.t > start + TAKES[k].s) start += TAKES[k++].s;
      const tk = TAKES[k];
      if (cine.t - dt <= start && k > 0) cutNow = true;
      seen.set(key(tk.from), clock());
      const x = THREE.MathUtils.clamp((cine.t - start) / tk.s, 0, 1);
      const u = tk.ease === 'both' ? THREE.MathUtils.smootherstep(x, 0, 1) : tk.ease === 'end' ? 1 - (1 - x) * (1 - x) : x;
      yaw = THREE.MathUtils.lerp(tk.from.yaw, tk.to.yaw, u);
      pitch = THREE.MathUtils.lerp(tk.from.pitch, tk.to.pitch, u);
      radius = THREE.MathUtils.lerp(tk.from.radius, tk.to.radius, u) * (tk.fit ? fit() : 1);
      target.lerpVectors(tk.from.target, tk.to.target, u);
      vyaw = vpitch = 0;
      // the opening over, the eye stays on its own: on into the shots (a touch and it is yours)
      if (cine.t > start + tk.s && k === TAKES.length - 1 && cuesDone >= CUES.length) { cine = null; play(); }
    }
    if (!cine && hall && cuesDone < CUES.length) {
      while (cuesDone < CUES.length) CUES[cuesDone++][1]();
      controls.fansOpen();
    }
    let stood: THREE.Vector3 | null = null; // the shot stands still: where the crane had the pod at its cut
    let lens = 40;
    if (peek && pod) {
      peek.t += dt;
      const x = THREE.MathUtils.clamp(peek.t / PEEK_S, 0, 1);
      const e = (a: number, b: number) => THREE.MathUtils.smoothstep(x, a, b);
      // where it ends, from the pod's frame at rest to where it hangs now
      m4.multiplyMatrices(pod.matrixWorld, restInverse);
      v2.copy(PEEK_AT).applyMatrix4(m4); // what it looks at
      v1.copy(PEEK_FROM).applyMatrix4(m4).sub(v2); // from where, seen from there
      const rEnd = v1.length(), yawEnd = Math.atan2(v1.x, v1.z), pitchEnd = Math.asin(v1.y / rEnd);
      // the pan: round to the door's side, the short way, and the look moves from the pod to the screen in it
      yaw = peek.yaw + Math.atan2(Math.sin(yawEnd - peek.yaw), Math.cos(yawEnd - peek.yaw)) * e(0, 0.7);
      target.lerpVectors(peek.target, v2.sub(carry), e(0, 0.65));
      // the flight: it dips under where it was on the way round, and comes up to where it ends
      pitch = THREE.MathUtils.lerp(peek.pitch, pitchEnd, e(0.1, 0.9)) - 0.2 * Math.sin(Math.PI * e(0.05, 0.85));
      // and the way in: back a little first, then in, slower and slower, the lens longer and longer
      const out = THREE.MathUtils.lerp(peek.radius, Math.max(peek.radius, 4.4), e(0, 0.3));
      radius = THREE.MathUtils.lerp(out, rEnd, 1 - (1 - e(0.22, 1)) ** 2);
      lens = THREE.MathUtils.lerp(peek.fov, 28, e(0.3, 1));
      vyaw = vpitch = 0;
    }
    if (auto) {
      auto.t += dt;
      if (auto.t >= CUT * shown().s) cut();
      const s = shown();
      // (nearer, or through a longer lens, the same turn is a faster picture: less of it)
      const rate = (s.radius < 6 ? 0.9 : s.radius >= 9 ? 0.9 : 1.3) * Math.min(1, (s.fov ?? 40) / 40);
      const x = auto.t / (CUT * s.s); // 0 at the cut, 1 at the next
      seen.set(key(s), clock());
      if (!auto.q) roundAt = auto.i;
      target.copy(s.target);
      if (s.fly) {
        // out in the hall, moving at an even pace, the eye on the pod wherever the crane has it
        v1.lerpVectors(s.fly.a, s.fly.b, x).sub(v2.copy(target).add(carry));
        radius = v1.length();
        yaw = Math.atan2(v1.x, v1.z);
        pitch = Math.asin(v1.y / radius);
      } else {
        yaw = s.yaw + deg(rate) * (auto.t - (CUT * s.s) / 2) * (auto.n % 2 ? -1 : 1);
        pitch = s.pitch;
        // (the wide ones go in a little all the while, 6 %: nothing stands quite still)
        radius = s.radius * (s.wide ? 1 : fit()) * (s.radius >= 6 ? 1.03 - 0.06 * x : 1);
      }
      vyaw = vpitch = 0;
      if (s.fixed) stood = anchor;
    }
    hall?.detail(!!auto && OF_HALL.has(shown()));
    if (hall && pod) hall.eyeAt(camera.position.distanceTo(v1.copy(podCentre).applyMatrix4(pod.matrixWorld)));
    // the lens: each shot's own while the eye is on its own, back to the usual one after (eased, not a jump)
    {
      const fov = peek ? lens : auto ? shown().fov ?? 40 : 40;
      const next = peek || auto ? fov : camera.fov + (fov - camera.fov) * Math.min(1, dt * 4);
      if (Math.abs(next - camera.fov) > 1e-3) { camera.fov = Math.abs(next - fov) < 0.02 ? fov : next; camera.updateProjectionMatrix(); }
    }
    controls.eye(!!(cine?.on || auto || peek));
    if (goal) {
      const k = 1 - Math.exp(-dt * (goal.rate ?? 6));
      yaw += Math.atan2(Math.sin(goal.yaw - yaw), Math.cos(goal.yaw - yaw)) * k;
      pitch += (goal.pitch - pitch) * k;
      radius += (goal.radius - radius) * k;
      target.lerp(goal.target, k);
      vyaw = vpitch = 0;
    }
    if (!auto && !peek) pitch = THREE.MathUtils.clamp(pitch, -0.85, 0.6); // (on its own it may look straight down, from the girder)
    // the eye goes along with the pod, wherever the crane takes it
    v3.copy(target).add(stood ?? carry);
    camera.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(radius).add(v3);
    camera.lookAt(v3);
    // held in the hand, when the eye is on its own and close: it wanders slowly, breathes, shakes a very little
    {
      const want = cine?.on || auto || peek ? HAND * Math.max(THREE.MathUtils.clamp((7 - radius) / 3.5, 0, 1), auto && shown().walk ? 0.5 : 0) : 0;
      sway += (want - sway) * Math.min(1, dt * 3);
      if (sway > 1e-3) {
        const t = now / 1000;
        const n = (a: number, b: number, c: number) => 0.6 * Math.sin(t * a + c) + 0.4 * Math.sin(t * b + c * 1.7);
        camera.rotateY(sway * (0.011 * n(0.83, 1.9, 0.3) + 0.0016 * Math.sin(t * 7.1)));
        camera.rotateX(sway * (0.009 * n(0.67, 2.3, 1.9) + 0.0016 * Math.sin(t * 8.3 + 1)));
        camera.rotateZ(sway * 0.006 * n(0.41, 1.3, 4.1));
        camera.translateX(sway * 0.02 * n(0.5, 1.1, 2.2));
        camera.translateY(sway * 0.015 * n(0.37, 0.9, 5));
      }
    }
    // and the lens: close, what is not the pod goes soft. The focus is where the eye's line meets the pod, taken
    // as an ellipsoid (smooth, and nothing to read back); pulled over a moment, but for a cut
    {
      const want = eye === camera && pod && (cine?.on || auto || peek) ? DOF * THREE.MathUtils.clamp((7 - radius) / 3.5, 0, 1) : 0;
      dof.amount = cutNow ? want : dof.amount + (want - dof.amount) * Math.min(1, dt * 3);
      dof.enabled = dof.amount > 0.01;
      if (dof.enabled && pod) {
        camera.updateMatrixWorld();
        const o = v1.copy(camera.position).applyMatrix4(podInverse).sub(podCentre).divide(podRadii);
        const d = v2.set(0, 0, -1).transformDirection(camera.matrixWorld).transformDirection(podInverse).divide(podRadii);
        const a = d.dot(d), b = 2 * o.dot(d), c = o.dot(o) - 1;
        const disc = b * b - 4 * a * c;
        let f = Math.max(0.6, disc > 0 ? (-b - Math.sqrt(disc)) / (2 * a) : -b / (2 * a));
        // (looking in, on its last way up to the opening: what is in there is sharp, the door's edge is not)
        if (peek && screen && peek.t > PEEK_S * 0.45) f = camera.position.distanceTo(screen.mesh.getWorldPosition(v3));
        dof.focus = cutNow ? f : dof.focus + (f - dof.focus) * Math.min(1, dt * 8);
      }
      cutNow = false;
    }
    if (eye === ortho) {
      // as big as the perspective one shows things at the target
      const h = radius * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      ortho.top = h; ortho.bottom = -h; ortho.left = -h * camera.aspect; ortho.right = h * camera.aspect;
      ortho.position.copy(camera.position); ortho.quaternion.copy(camera.quaternion);
      ortho.updateProjectionMatrix();
    }
    debug?.tick();

    owed += dt;
    while (owed >= STEP) {
      owed -= STEP;
      time += STEP;
      physics(STEP, time);
    }
    for (const c of cables) c.skin();
    if (pod) hall?.follow(v1.copy(podCentre).applyMatrix4(pod.matrixWorld));
    hall?.update(time, dt);
    screen?.update(dt, open > 0.2, now / 1000);
    blood?.update(dt, camera.position, (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / canvas.clientHeight);
    // the daylight in the haze and the fill come with the open roof (a little of each when shut: the windows)
    if (hall) {
      const day = hall.open;
      (scene.fog as THREE.Fog).far = 1 + (FOG_GAIN - 1) * (0.08 + 0.92 * day);
      hemi.intensity = 0.22 * (0.15 + 0.85 * day);
      scene.environmentIntensity = 0.18 * (0.15 + 0.85 * day);
      controls.roof(day, roofWanted);
      controls.fans(hall.fans.shutter.end);
      controls.rail(carry.x / END);
      // and the daylight through the fans and windows a little less while the roof is shut, for a dark start
      if (raysPass) raysPass.fan = 3 * (0.3 + 0.7 * day);
      hall.left.intensity = 1.6 * (0.12 + 0.88 * day);
      hall.right.intensity = 0.9 * (0.12 + 0.88 * day);
    }
    // the red light inside, breathing: on what it lights in there (through the open door) and out of the window
    const beat = heart(time);
    inside.intensity = 1.2 + 7 * beat;
    for (const g of GLOWING) g.material.emissiveIntensity = g.gain * (GLOW.rest + GLOW.beat * beat);

    ao.enabled = eye === camera && aoOn; // the debug panel's iso goes without, and it can be switched off
    hall?.prepare(renderer, camera);
    post.render(eye);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
