import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBackdrop } from './env/backdrop';
import { createBranch, GRIP_X, loadBranch, PERCH_RANGE, perchFrames } from './env/branch';
import { createSway } from './env/sway';
import { createBird, type GazeLayer, type HopLayer } from './bird';
import type { Food } from './bird/types';
import { PALETTES, paletteMatrices } from './bird/palettes';
import { createPost } from './post';
import { createSeeds } from './seeds';
import { createInsects } from './insects';
import { createAmbient } from './ambient';
import { createSettings } from './settings';
import { damp } from './bird/util';
import { phone } from './device';

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const query = new URLSearchParams(location.search);
const usePost = !query.has('nopost');
// with the post pass the MSAA lives in the scene target, not the canvas
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !usePost, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, phone ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 120);
camera.position.set(1.55, 0.85, 3.0); // a little right of front, at the bird's height: the buds big in the foreground

const controls = new OrbitControls(camera, canvas);
controls.target.set(GRIP_X - 0.04, 0.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
// a camera on a tripod in front of the perch: some room to move, never round the back or underneath
controls.minDistance = 1.4;
controls.maxDistance = 4.4;
controls.minPolarAngle = 1.2;
controls.maxPolarAngle = 1.78;
controls.minAzimuthAngle = -0.45;
controls.maxAzimuthAngle = 0.85;
controls.enablePan = false;
controls.rotateSpeed = 0.6;
// on a touch screen a finger is the pointer: it brushes the flowers, steps the bird along,
// catches its eye, as a mouse does by hovering. It never drags the camera round (pinch
// still zooms, and the tilt button moves the camera)
controls.touches.ONE = null;

// --- environment --------------------------------------------------------------
const backdrop = createBackdrop();
{
  // bake the same backdrop, brighter from above, into the env map
  const envScene = new THREE.Scene();
  const envBackdrop = createBackdrop();
  envBackdrop.material.uniforms.uEnv.value = 1;
  envScene.add(envBackdrop.mesh);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 1.6;
  pmrem.dispose();
}
scene.add(backdrop.mesh);

// procedural twig first, swapped for the Blender one once it's in
const branch = createBranch();
scene.add(branch.group);
// the twig gives under the bird: it bends in the vertex shader, the bird rides along
const sway = createSway();
sway.use(branch.group);
// loading: the bird and the procedural twig drawn in ink on millimetre paper
// while the Blender twig comes down; then the picture fades in over it
const loadLabel = document.querySelector<HTMLElement>('.loading-label span');
let reveal = 0;
let revealing = false;
let firstReveal = true;
// W: the live drawing (ink wireframe on millimetre paper) instead of the picture
let drawing = query.has('drawing');
function setDrawing(on: boolean) {
  drawing = on;
  // a cut, not a fade (the title's colour too)
  document.body.classList.add('snap');
  document.body.classList.toggle('drawing', on);
  requestAnimationFrame(() => document.body.classList.remove('snap'));
  if (revealing && !firstReveal) reveal = on ? 0 : 1;
}
setDrawing(drawing);
function startReveal(instant = false) {
  if (instant) reveal = 1;
  revealing = true;
  document.body.classList.remove('loading');
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
// the picture's first frames shouldn't stall on shaders or uploads: it all happens here, a
// piece a frame, while the drawing still shows. The scene, then what isn't in it yet (a
// seed, a gnat, a wisp of down), then the textures, one a frame,
// then one frame of the picture itself
async function ready() {
  const compile = usePost ? post.compile : (jobs: () => Promise<unknown>[]) => Promise.all(jobs());
  try {
    await compile(() => [renderer.compileAsync(scene, camera)]);
    await nextFrame();
    await compile(() => [renderer.compileAsync(warm, camera, scene)]);
    await nextFrame();
    // three asks the GPU about a program the first time it draws with it, a round trip that
    // waits on the frame in flight (up to 100 ms): ask now, for the ones not drawn yet (the
    // hidden wing blur)
    for (const m of materialsIn([scene, warm])) {
      const programs = (renderer.properties.get(m) as { programs?: Map<string, THREE.WebGLProgram> }).programs;
      programs?.forEach((p) => p.getUniforms());
    }
    for (const tex of texturesIn([scene, warm])) {
      await nextFrame();
      renderer.initTexture(tex);
    }
    // and one picture, unseen: the shadow pass only meets the feathers here (the drawing hides them)
    await nextFrame();
    if (usePost) post.prerender(scene, camera);
  } catch {
    /* compile on first draw then */
  }
  startReveal();
}
function materialsIn(roots: THREE.Object3D[]) {
  const out = new Set<THREE.Material>();
  for (const root of roots) {
    root.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (mat) for (const m of Array.isArray(mat) ? mat : [mat]) out.add(m);
    });
  }
  return out;
}
function texturesIn(roots: THREE.Object3D[]) {
  const out = new Set<THREE.Texture>();
  for (const m of materialsIn(roots)) {
    for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture && !(v as THREE.Texture).isRenderTargetTexture) out.add(v);
  }
  return out;
}
const branchLoad = query.has('procbranch')
  ? Promise.resolve()
  : loadBranch(`${import.meta.env.BASE_URL}branch.glb`, (e) => {
      // (a gzipped response counts its unpacked bytes against the packed length: never past 100)
      if (loadLabel && e.lengthComputable) loadLabel.textContent = `${Math.min(100, Math.round((e.loaded / e.total) * 100))}%`;
    })
      .then((b) => {
        scene.remove(branch.group);
        disposeTree(branch.group);
        scene.add(b.group);
        sway.use(b.group);
        usePerch(b.group);
        branchFuzz = b.fuzz;
        applyFuzz();
      })
      .catch(() => {
        /* no glb: keep the procedural twig */
      });

const hemi = new THREE.HemisphereLight(0xeef2e6, 0x3a3826, 0.6);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
key.position.set(-1.3, 3.6, 1.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -1.2;
key.shadow.camera.right = key.shadow.camera.top = 1.2;
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 8;
key.shadow.bias = -0.0015;
key.shadow.normalBias = 0.025;
key.shadow.radius = 4;
key.target.position.set(0, 0.5, 0);
if (phone) {
  // a quarter of the map, its box drawn in round what casts and catches the shadows that show:
  // the bird anywhere along its stretch of twig, the twig under it, the flowers
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -0.85, right: 1.42, bottom: -1.0, top: 1.15 });
}
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xf2fae8, 1.4);
rim.position.set(1.5, 1.8, -2.5);
rim.target.position.set(0, 0.5, 0);
scene.add(rim, rim.target);

// --- bird ---------------------------------------------------------------------
const bird = createBird();
// it sits a little right of the twig's middle and drifts back there
bird.root.position.x = GRIP_X;
bird.layer<HopLayer>('hop').home = GRIP_X;
// (the bird stands in a rider that moves with the twig under its feet)
const rider = new THREE.Group();
rider.add(bird.root);
scene.add(rider);
let ride = 1;
const rideAt = new THREE.Vector3();
bird.mind.on('perch', (e) => {
  sway.push(e.x, e.push, e.side);
  sway.load(e.on ? e.x : null);
});
sway.load(GRIP_X);
sway.settle();
// the lens focuses on the head, but stays on the twig while the bird is off it:
// a photographer doesn't rack focus to the sky after it, the flowers stay sharp
const focusAt = new THREE.Vector3();
const focusHold = new THREE.Vector3();
let focusSet = false;
function updateFocus(dt: number) {
  if (bird.perched || !focusSet) focusHold.copy(headPos);
  if (!focusSet) focusAt.copy(focusHold);
  focusSet = true;
  focusAt.lerp(focusHold, 1 - Math.exp(-dt * 8));
}
function updateSway(dt: number) {
  sway.update(dt);
  // on the twig (also gathering itself to go, and landing) it moves with it; in the air it doesn't
  ride = damp(ride, bird.perched ? 1 : 0, 25, dt);
  sway.at(bird.root.position.x, rideAt);
  rider.position.copy(rideAt).multiplyScalar(ride);
}
const gaze = bird.layer<GazeLayer>('gaze');
const billTip = bird.billTip.bind(bird);
// on phones the contour feathers skip the shadow pass (most of its triangles)
if (phone) bird.feathers.contour.castShadow = false;

// attention: the pointer when it moves, else the camera
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pointerTarget = new THREE.Vector3();
let pointerAt = -1e9;
const plane = new THREE.Plane();
const toCam = new THREE.Vector3();
const planeAt = new THREE.Vector3();
// a plane facing the camera, `ahead` in front of the bird's head
function toNdc(x: number, y: number) {
  const r = canvas.getBoundingClientRect();
  return ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
}
/** the pointer's ray into the scene */
function pointerRay(x: number, y: number) {
  ray.setFromCamera(toNdc(x, y), camera);
  return ray.ray;
}
function pointerOnPlane(x: number, y: number, ahead: number, out: THREE.Vector3) {
  pointerRay(x, y);
  camera.getWorldDirection(toCam).negate();
  plane.setFromNormalAndCoplanarPoint(toCam, planeAt.set(bird.root.position.x, 0.8, 0).addScaledVector(toCam, ahead));
  return ray.ray.intersectPlane(plane, out);
}
// the pointer at its head: it doesn't go cross-eyed after it, it sings, once (again
// only after the pointer has been away). The head and the base of the bill, a wide round
// patch around the face, not the far bill tip
const billA = new THREE.Vector3();
let atBill = false;
function nearBill(r: THREE.Ray) {
  if (bird.away || bird.fleeing) return false;
  // (centred a little below the head, over the throat)
  bird.headPosition(billA).y -= 0.05;
  // (a wider ring to leave than to enter, so the edge doesn't flicker it on and off)
  const d = atBill ? 0.46 : 0.4;
  return r.distanceSqToPoint(billA) < d * d;
}

// seeds: click drops one in the air in front of the bird
const seeds = createSeeds(scene);
// and now and then a gnat, which the bird may catch (it mostly gets away)
const insects = createInsects(scene, () => bird.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.85, 0)));
bird.onPick = (id) => (insects.owns(id) ? insects.pick(id) : seeds.pick(id));
bird.onSwallow = (id) => (insects.owns(id) ? insects.swallowed(id) : seeds.swallowed(id));
// it winds up to strike: the gnats near the bill may see it coming
bird.mind.on('strike', () => insects.strike());
// dust, a passing fly, a seed on the breeze, a wisp of down after a ruffle
const ambient = createAmbient({ scene, camera, renderer, center: new THREE.Vector3(GRIP_X, 0.55, 0), dof: () => post.dof, passSeed: (at, wind) => seeds.spawn(at, wind) });
// what only comes into the scene later, for compiling while loading (never drawn)
const warm = new THREE.Group();
warm.add(...seeds.warm, ...insects.warm, ...ambient.warm);
let flySeenAt = -1;
const flyLast = new THREE.Vector3();
// the bug button (and G): a gnat or a fly, at random
function letOneIn() {
  if (Math.random() < 0.5) insects.spawn();
  else ambient.flyBy();
}
document.querySelector('.bug')?.addEventListener('click', letOneIn);
const shedAt = new THREE.Vector3();
const shedOut = new THREE.Vector3();
bird.mind.on('ruffle', (e) => {
  if (e.kind === 'throat' || bird.away) return;
  // off a flank, out to one side as we see it, so it floats clear of the bird
  const a = Math.atan2(camera.position.x - bird.root.position.x, camera.position.z - bird.root.position.z) + (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.6);
  shedOut.set(Math.sin(a), 0, Math.cos(a));
  bird.root.getWorldPosition(shedAt).addScaledVector(shedOut, 0.16).y += 0.22 + Math.random() * 0.2;
  ambient.shed(shedAt, shedOut, Math.random() < 0.45);
});
const allFood: Food[] = [];
function pushAll(out: Food[], items: ReadonlyArray<Food>) {
  for (let i = 0; i < items.length; i++) out.push(items[i]);
}
const seedAt = new THREE.Vector3();
let downAt = 0;
let downX = 0;
let downY = 0;
canvas.addEventListener('pointerdown', (e) => {
  downAt = performance.now();
  downX = e.clientX;
  downY = e.clientY;
});
// the feet: a pointer at them and the bird steps away along the twig, the other way.
// Not every time: a hop at most every 3 s
const feetA = new THREE.Vector3();
const feetB = new THREE.Vector3();
const feetHit = new THREE.Vector3();
const FEET_EVERY = 3;
let feetNext = 0;
function nearFeet(r: THREE.Ray) {
  if (bird.away || bird.fleeing) return;
  const now = performance.now() / 1000;
  if (now < feetNext) return;
  bird.root.getWorldPosition(feetA);
  feetB.copy(feetA);
  feetA.x -= 0.06;
  feetB.x += 0.06;
  feetA.y = feetB.y = feetA.y + 0.02;
  if (r.distanceSqToSegment(feetA, feetB, undefined, feetHit) > 0.07 * 0.07) return;
  // away from the side the pointer came in on (where on the feet it is now)
  const away = feetHit.x < (feetA.x + feetB.x) / 2 ? 1 : -1;
  const d = 0.12 + Math.random() * 0.1;
  if (bird.hopBy(away * d) || bird.hopBy(-away * d)) feetNext = now + FEET_EVERY;
}
// the flowers: a pointer passing over them brushes them, barely
const brushPlane = new THREE.Plane();
const brushOn = new THREE.Vector3();
const brushAt = new THREE.Vector3();
const brushPrev = new THREE.Vector3();
const brushV = new THREE.Vector3();
let brushT = -1;
function brushFlowers(r: THREE.Ray) {
  const now = performance.now();
  if (!sway.reach(r, brushOn)) return void (brushT = -1);
  // how fast the pointer moves, there, across the view
  camera.getWorldDirection(toCam).negate();
  brushPlane.setFromNormalAndCoplanarPoint(toCam, brushOn);
  if (!r.intersectPlane(brushPlane, brushAt)) return;
  const dt = (now - brushT) / 1000;
  if (brushT > 0 && dt < 0.1) sway.brush(brushOn, brushV.copy(brushAt).sub(brushPrev).divideScalar(Math.max(dt, 1 / 240)), dt);
  brushPrev.copy(brushAt);
  brushT = now;
}
// the pointer over the scene: one ray for all of it. At the head the bird sings and looks
// out at the camera; anywhere else it is what the bird follows
window.addEventListener('pointermove', (e) => {
  document.body.classList.toggle('near', e.clientX > window.innerWidth - 140 && e.clientY < 120);
  const onCanvas = e.target === canvas;
  const r = pointerRay(e.clientX, e.clientY);
  const bill = onCanvas && nearBill(r);
  if (bill && !atBill && !bird.singing) bird.sing(1.6);
  atBill = bill;
  if (onCanvas) {
    nearFeet(r);
    brushFlowers(r);
  }
  if (!bill && pointerOnPlane(e.clientX, e.clientY, 0.8, pointerTarget)) pointerAt = performance.now();
});
// is the bird under this point? A capsule from the belly to the head is plenty
const capA = new THREE.Vector3();
const capB = new THREE.Vector3();
function tapsBird(x: number, y: number) {
  if (bird.away) return false;
  bird.root.getWorldPosition(capA).y += 0.25;
  bird.headPosition(capB);
  return pointerRay(x, y).distanceSqToSegment(capA, capB) < 0.22 * 0.22;
}
// full screen + clean: no title, no hint, the bird alone (?clean starts there, without full screen)
const fsButton = document.querySelector<HTMLButtonElement>('.fs');
const setClean = (on: boolean) => document.body.classList.toggle('clean', on);
if (query.has('clean')) setClean(true);
fsButton?.addEventListener('click', async () => {
  const on = !document.body.classList.contains('clean');
  setClean(on);
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* no Fullscreen API (iPhone): clean mode alone */
  }
  fsButton.blur();
});
// leaving full screen with Esc brings the text back
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('fullscreen', !!document.fullscreenElement);
  if (!document.fullscreenElement) setClean(false);
});
canvas.addEventListener('pointerup', (e) => {
  if (settings.isOpen()) return settings.open(false);
  // a click, not a drag
  if (performance.now() - downAt < 250 && Math.hypot(e.clientX - downX, e.clientY - downY) < 6) {
    // on a phone, a tap on the bird turns it into another bird; anywhere else drops a seed
    if (phone && tapsBird(e.clientX, e.clientY)) changePalette();
    else if (pointerOnPlane(e.clientX, e.clientY, 0.6, seedAt)) seeds.spawn(seedAt);
  }
});

// --- post: depth of field on the head, colour grade -----------------------------
const post = createPost(renderer, { samples: 4 });
const headPos = new THREE.Vector3();
{
  // graded by eye against the footage: a touch cool, plum in the shadows
  // (exposure, contrast, saturation and the depth of field come from the settings)
  const g = post.grade;
  g.uWhite.value.set(1.0, 1.0, 1.04);
  g.uLift.value.set(0.015, 0.005, 0.022);
  g.uGamma.value.set(1.0, 1.04, 1.0);
  g.uVignette.value = 0.22;
}

// --- the perch, for hopping along it (the rays are in env/branch.ts) -----------
function usePerch(root: THREE.Object3D) {
  bird.setPerch(perchFrames(root), PERCH_RANGE);
}
function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
  });
}
usePerch(branch.group);

// --- another bird: the feathers turn to new colours ----------------------------
let paletteIndex = 0;
let paletteT = 1;
let paletteDelay = 0;
const paletteFrom = bird.plumage.uPal.value.map((m) => m.clone());
let paletteTo = paletteMatrices(PALETTES[0]);
function changePalette() {
  paletteIndex = (paletteIndex + 1) % PALETTES.length;
  // just the slightest lift of the throat and crown as the colours turn
  bird.ruffle('throat', 0.25);
  bird.plumage.uPal.value.forEach((m, i) => paletteFrom[i].copy(m));
  paletteTo = paletteMatrices(PALETTES[paletteIndex]);
  paletteDelay = 0.05;
  paletteT = 0;
}
function updatePalette(dt: number) {
  if (paletteT >= 1) return;
  if (paletteDelay > 0) {
    paletteDelay -= dt;
    return;
  }
  paletteT = Math.min(1, paletteT + dt / 0.55);
  const k = THREE.MathUtils.smoothstep(paletteT, 0, 1);
  bird.plumage.uPal.value.forEach((m, i) => {
    for (let e = 0; e < 9; e++) m.elements[e] = paletteFrom[i].elements[e] + (paletteTo[i].elements[e] - paletteFrom[i].elements[e]) * k;
  });
}
document.querySelector('.palette')?.addEventListener('click', changePalette);

// --- B: round to the back and again to the front ------------------------------
// The orbit keeps to a slice in front (or, after the turn, behind): the camera
// swings round the bird on a slow arc, the limits follow once it is there.
const FRONT: [number, number] = [-0.45, 0.85];
const BACK: [number, number] = [Math.PI - 0.6, -Math.PI + 0.55];
let behind = false;
let turnT = -1;
let turnFrom = 0;
let turnTo = 0;
const turnSph = new THREE.Spherical();
const turnOff = new THREE.Vector3();
function turnAround() {
  if (turnT >= 0) return;
  behind = !behind;
  turnOff.copy(camera.position).sub(controls.target);
  turnSph.setFromVector3(turnOff);
  turnFrom = turnSph.theta;
  // a three-quarter view from behind, the wing tips over the tail; back to the default front
  const goal = behind ? Math.PI + 0.35 : 0.41;
  // always round the side where the twig runs on out of frame, never past its cut end
  const d = THREE.MathUtils.euclideanModulo(goal - turnFrom, Math.PI * 2);
  turnTo = turnFrom + (behind ? d - Math.PI * 2 : d);
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  turnT = 0;
}
function updateTurn(dt: number) {
  if (turnT < 0) return;
  turnT = Math.min(1, turnT + dt / 1.6);
  turnOff.copy(camera.position).sub(controls.target);
  turnSph.setFromVector3(turnOff);
  turnSph.theta = turnFrom + (turnTo - turnFrom) * THREE.MathUtils.smootherstep(turnT, 0, 1);
  camera.position.copy(controls.target).add(turnOff.setFromSpherical(turnSph));
  if (turnT === 1) {
    turnT = -1;
    [controls.minAzimuthAngle, controls.maxAzimuthAngle] = behind ? BACK : FRONT;
  }
}

// --- H: the head alone as a wireframe, the bird and the scene as they are -----
// A plane across the neck, following the head bone: above it the feathers are
// cut away and the skin, bill and eyes draw as lines; below it all is as usual.
renderer.localClippingEnabled = true;
let headWire = false;
const keepBody = new THREE.Plane(); // keeps what's below the cut
const keepHead = new THREE.Plane(); // keeps what's above it
const neckAt = new THREE.Vector3();
const headAt = new THREE.Vector3();
const cutN = new THREE.Vector3();
const headWireMat = new THREE.MeshBasicMaterial({ color: 0xeef3e8, wireframe: true, transparent: true, opacity: 0.8, clippingPlanes: [keepHead] });
const headParts = ['bird.skin', 'bird.bare', 'bird.bill', 'bird.eyes', 'bird.nict']
  .map((n) => bird.root.getObjectByName(n) as THREE.Mesh | undefined)
  .filter((m): m is THREE.Mesh => !!m);
const headPartMats = headParts.map((m) => m.material);
const plumageMat = bird.feathers.contour.material as THREE.Material;
function setHeadWire(on: boolean) {
  headWire = on;
  plumageMat.clippingPlanes = on ? [keepBody] : null;
  plumageMat.needsUpdate = true;
  headParts.forEach((m, i) => (m.material = on ? headWireMat : headPartMats[i]));
}
function updateHeadCut() {
  if (!headWire) return;
  bird.rig.bones.neck2.getWorldPosition(neckAt);
  bird.rig.bones.head.getWorldPosition(headAt);
  cutN.copy(headAt).sub(neckAt).normalize();
  neckAt.lerp(headAt, 0.35);
  keepHead.setFromNormalAndCoplanarPoint(cutN, neckAt);
  keepBody.copy(keepHead).negate();
}

// --- settings wheel, bottom right ---------------------------------------------
let followPointer = true;
let wasRecent = false;
// (set from the settings list below: its values are the defaults)
let shakeAmt = 0;
let fuzzVisible = true;
let branchFuzz: THREE.Object3D | null = null;
// ?nofuzz and ?skin (bird/index.ts) take the bird's down off: the setting doesn't put it back
const birdFuzz = !query.has('nofuzz') && !query.has('skin');
function applyFuzz() {
  bird.feathers.fuzz.visible = fuzzVisible && birdFuzz;
  if (branchFuzz) branchFuzz.visible = fuzzVisible;
}
const flash0 = bird.plumage.uFlash.value;
const glint0 = bird.plumage.uGlint.value;
const seedAhead = () => {
  // a seed somewhere in reach, in front of the head, a little to one side
  camera.getWorldDirection(toCam).negate();
  const side = new THREE.Vector3().crossVectors(toCam, camera.up).normalize();
  return new THREE.Vector3(bird.root.position.x, 0.95 + Math.random() * 0.2, 0).addScaledVector(toCam, 0.6).addScaledVector(side, (Math.random() - 0.5) * 0.5);
};
// --- D: demo, half a minute of what it does --------------------------------
// A script on the scene clock (so P pauses it): a ruffle, a gnat that doesn't get
// away, song, the tongue, a hop each way, a fly past the head, a seed. Steps that
// can't happen yet (the bird's verbs say no: mid-hop, still eating) wait their turn,
// up to a few seconds.
type DemoStep = [at: number, run: () => boolean | void];
const inReach = () => {
  bird.headPosition(demoAt);
  camera.getWorldDirection(toCam).negate();
  return demoAt.addScaledVector(toCam, 0.24).add(new THREE.Vector3(0, -0.06, 0));
};
const demoAt = new THREE.Vector3();
const DEMO: DemoStep[] = [
  [0.4, () => bird.ruffle('shake')],
  [3, () => insects.spawn(inReach(), true)],
  [10.5, () => bird.sing(2.2)],
  [13.5, () => bird.lick(0.65, 3)],
  [15, () => bird.hopBy(0.26)],
  [17.5, () => bird.sing(1.6)],
  [20, () => ambient.flyBy(true)],
  [22.5, () => bird.hopTo(GRIP_X)],
  [24.5, () => seeds.spawn(seedAhead())],
  [30, () => !bird.busy && (bird.ruffle('puff', 0.6), true)],
  [32, () => bird.sing(1.4)],
];
const DEMO_END = 35;
let demoT = -1;
let demoNext = 0;
function setDemo(on: boolean) {
  demoT = on ? 0 : -1;
  demoNext = 0;
  document.body.classList.toggle('demo', on);
}
function updateDemo(dt: number) {
  if (demoT < 0) return;
  demoT += dt;
  while (demoNext < DEMO.length && demoT >= DEMO[demoNext][0]) {
    const [at, run] = DEMO[demoNext];
    // not now: try again next frame, give up after a few seconds
    if (run() === false && demoT - at < 4) break;
    demoNext++;
  }
  if (demoT > DEMO_END) setDemo(false);
}

const TONE: Record<string, THREE.ToneMapping> = {
  Neutral: THREE.NeutralToneMapping,
  AgX: THREE.AgXToneMapping,
  ACES: THREE.ACESFilmicToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
  None: THREE.NoToneMapping,
};
const settings = createSettings([
  { kind: 'heading', label: 'Camera' },
  { kind: 'range', key: 'shake', label: 'Handheld', value: 2.05, min: 0, max: 3.5, step: 0.05, set: (v) => (shakeAmt = v) },
  { kind: 'range', key: 'dof', label: 'Depth of field', value: 85, min: 0, max: 260, step: 5, set: (v) => (post.dof.uAperture.value = v) },
  { kind: 'range', key: 'exposure', label: 'Exposure', value: 1.15, min: 0.8, max: 2.4, step: 0.05, set: (v) => (post.grade.uExposure.value = v) },
  { kind: 'heading', label: 'Look' },
  // (also the renderer's tone mapping, with or without the post pass)
  { kind: 'select', key: 'tonemap', label: 'Tone mapping', value: 'Neutral', options: Object.keys(TONE), set: (v) => post.setToneMapping(TONE[v]) },
  { kind: 'range', key: 'contrast', label: 'Contrast', value: 0.87, min: 0.6, max: 1.4, step: 0.01, set: (v) => (post.grade.uContrast.value = v) },
  { kind: 'range', key: 'sat', label: 'Saturation', value: 0.97, min: 0.3, max: 1.4, step: 0.01, set: (v) => (post.grade.uSat.value = v) },
  { kind: 'heading', label: 'Bird' },
  { kind: 'toggle', key: 'follow', label: 'Follows the pointer', value: true, set: (v) => (followPointer = v) },
  { kind: 'range', key: 'mood', label: 'Calm · alert', value: 0.32, min: 0, max: 1, step: 0.01, set: (v) => (bird.mind.baseline = v) },
  { kind: 'range', key: 'flash', label: 'Gorget flash', value: 1, min: 0, max: 2, step: 0.05, set: (v) => { bird.plumage.uFlash.value = flash0 * v; bird.plumage.uGlint.value = glint0 * v; } },
  { kind: 'toggle', key: 'fuzz', label: 'Down and felt', value: true, set: (v) => { fuzzVisible = v; applyFuzz(); } },
  { kind: 'range', key: 'give', label: 'Twig give', value: 1, min: 0, max: 3, step: 0.05, set: (v) => (sway.give = v) },
  { kind: 'heading', label: 'Do' },
  { kind: 'action', label: 'Drop a seed', run: () => seeds.spawn(seedAhead()) },
  { kind: 'action', label: 'A gnat', run: () => insects.spawn() },
  { kind: 'action', label: 'A fly', run: () => ambient.flyBy() },
  { kind: 'action', label: 'Demo (D)', run: () => setDemo(demoT < 0) },
  { kind: 'action', label: 'Sing', run: () => bird.sing(2.2) },
  { kind: 'action', label: 'Ruffle (R)', run: () => bird.ruffle('shake') },
  { kind: 'action', label: 'Another bird (C)', run: changePalette },
  { kind: 'action', label: 'Startle', run: () => bird.startle(1) },
  { kind: 'action', label: 'Fly off (F)', run: () => bird.flee() },
  { kind: 'action', label: 'Pause (P)', run: () => setPaused(!paused) },
  { kind: 'action', label: 'Drawing (W)', run: () => setDrawing(!drawing) },
  { kind: 'action', label: 'Head wireframe (H)', run: () => setHeadWire(!headWire) },
  // URL flags win over what was saved: ?still is a camera on a tripod even if Handheld was turned up
], query.has('still') ? { shake: 0 } : {});

// --- keys ---------------------------------------------------------------------
const KEYS: Record<string, () => void> = {
  KeyF: () => bird.flee(),
  // a ruffle now (the one-a-minute limit is only for the ones it does by itself)
  KeyR: () => bird.ruffle('shake'),
  KeyB: turnAround,
  KeyC: changePalette,
  KeyG: letOneIn,
  KeyD: () => setDemo(demoT < 0),
  KeyH: () => setHeadWire(!headWire),
  KeyP: () => setPaused(!paused),
  KeyW: () => setDrawing(!drawing),
};
window.addEventListener('keydown', (e) => {
  // Space startles, modifiers or not; the letters leave the browser's shortcuts (cmd-R, ctrl-W) alone
  if (e.code === 'Space') bird.startle(1);
  else if (!e.metaKey && !e.ctrlKey) KEYS[e.code]?.();
});

// --- loop ---------------------------------------------------------------------
function resize() {
  // the size the canvas is laid out at, not the window's: on a phone they differ while the bars show
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  post.setSize(w, h, renderer.getPixelRatio());
  camera.aspect = w / h;
  // keep the bird framed on portrait screens
  camera.fov = w / h < 1 ? 30 / Math.max(w / h, 0.55) : 30;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(canvas);
resize();

branchLoad.then(() => requestAnimationFrame(() => ready()));
if (!usePost) startReveal(true);
let paused = false;
function setPaused(on: boolean) {
  paused = on;
  document.body.classList.toggle('paused', on);
}
const timer = new THREE.Timer();
timer.connect(document);
let t = 0;
renderer.setAnimationLoop((now) => {
  timer.update(now);
  // P: time stands still (the bird, the seeds, the camera's hands); the view can still be turned
  const dt = paused ? 0 : Math.min(timer.getDelta(), 1 / 20);
  if (paused) timer.getDelta();
  t += dt;
  // the turn runs on wall time, so it still swings round while paused
  updateTurn(paused ? 1 / 60 : dt);
  controls.update();
  backdrop.material.uniforms.uTime.value = t;
  backdrop.mesh.position.copy(camera.position);
  // the pointer is interesting only while it moves; the moment it stops the bird goes
  // back to its own business, looking here and there (the camera now and then, so the
  // gorget still flashes): it never stares at a pointer that has stopped
  const recent = followPointer && !atBill && performance.now() - pointerAt < 300;
  if (wasRecent && !recent) gaze.moveOn(bird.mind);
  wasRecent = recent;
  gaze.interest = recent ? 0.95 : 0.35;
  // a bird looks with one eye as often as with both; at the pointer, mostly bill-on so it reads
  gaze.billOn = recent ? 0.8 : 0.46;
  // and follows it, a mix of gliding after it and snapping to catch up
  gaze.pursuit = recent ? 1 : 0;
  // a fly zipping past close by gets a look (one, not a stare)
  // (only while it moves: a fly hanging in the air is not worth a look)
  let near = recent ? null : ambient.flyNear(headPos, 1.1);
  if (near && dt > 0) {
    const flying = flyLast.distanceTo(near) / dt > 0.1;
    flyLast.copy(near);
    if (!flying) near = null;
  }
  if (!near) flySeenAt = -1;
  else if (flySeenAt < 0) flySeenAt = t;
  const fly = near && t - flySeenAt < 0.8 ? near : null;
  if (fly) gaze.interest = 0.95;
  bird.setAttention(recent ? pointerTarget : (fly ?? camera.position));
  tilt.lerp(tiltOn ? tiltGoal : tiltZero, 1 - Math.exp(-dt * 6));
  // the picture fades in over the drawing once, after loading (W cuts between them after that)
  if (revealing && firstReveal && !drawing) {
    reveal = Math.min(1, reveal + dt / 1.6);
    if (reveal === 1) firstReveal = false;
  }
  // picture alone: free the drawing's target and material until W asks again
  if (reveal === 1 && wireLive) {
    wireLive = false;
    post.endDrawing();
    wireMat.dispose();
  }
  updatePalette(dt);
  // (filled in place: no arrays spread every frame)
  allFood.length = 0;
  pushAll(allFood, seeds.food());
  pushAll(allFood, insects.food());
  bird.setFood(allFood);
  updateSway(dt);
  bird.update(dt);
  bird.headPosition(headPos);
  updateFocus(dt);
  updateHeadCut();
  seeds.update(dt, t, billTip, headPos);
  insects.update(dt, t, billTip);
  ambient.update(dt);
  updateDemo(dt);
  frame();
});

// handheld long lens: a slow sway, a fine tremor, now and then a small bump.
// Angles only (that's what shows through a tele), applied for the render and
// taken off again so the orbit controls never see it.
const shakeQ = new THREE.Quaternion();
const shakeE = new THREE.Euler();
const restQ = new THREE.Quaternion();
let bumpAt = 3;
const bump = new THREE.Vector2();
function wobble(t: number, f: number, seed: number) {
  return Math.sin(t * f + seed) * 0.6 + Math.sin(t * f * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * f * 5.13 + seed * 2.9) * 0.1;
}
function shakeAngles(t: number, dt: number) {
  if (t > bumpAt) {
    bump.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.09);
    bumpAt = t + 4 + Math.random() * 9;
  }
  bump.multiplyScalar(Math.exp(-dt * 5));
  // sway (breathing, the arms), tremor (the hands), the bump settling
  const k = shakeAmt * THREE.MathUtils.DEG2RAD;
  const yaw = (wobble(t, 0.35, 1.3) * 0.16 + wobble(t, 7.3, 4.1) * 0.018 + bump.x) * k;
  const pitch = (wobble(t, 0.27, 2.7) * 0.12 + wobble(t, 8.1, 5.9) * 0.016 + bump.y) * k;
  const roll = wobble(t, 0.22, 0.4) * 0.1 * k;
  return shakeE.set(pitch, yaw, roll, 'YXZ');
}

// tilt parallax (phones): leaning the phone swings the camera a little round
// the bird, so it stays put and the twig and the bokeh slide behind it
const gyroButton = document.querySelector<HTMLButtonElement>('.gyro');
if (phone) document.body.classList.add('touch');
let tiltOn = false;
let tiltBase: { x: number; y: number } | null = null;
const tiltGoal = new THREE.Vector2(); // yaw, pitch in radians
const tilt = new THREE.Vector2();
const tiltZero = new THREE.Vector2();
function onTilt(e: DeviceOrientationEvent) {
  if (e.beta === null || e.gamma === null) return;
  // in the screen's terms: x left/right, y toward/away, whichever way the phone is turned
  const angle = screen.orientation?.angle ?? 0;
  const [x, y] = angle === 90 ? [e.beta, -e.gamma] : angle === 270 ? [-e.beta, e.gamma] : angle === 180 ? [-e.gamma, -e.beta] : [e.gamma, e.beta];
  // however it's held when switched on is the rest pose
  tiltBase ??= { x, y };
  const D = THREE.MathUtils.DEG2RAD;
  tiltGoal.set(THREE.MathUtils.clamp((x - tiltBase.x) * 0.5, -12, 12) * D, THREE.MathUtils.clamp((y - tiltBase.y) * 0.4, -8, 8) * D);
}
gyroButton?.addEventListener('click', async () => {
  if (tiltOn) {
    window.removeEventListener('deviceorientation', onTilt);
    tiltOn = false;
  } else {
    // iOS asks, and only from a tap
    const ask = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (ask) {
      try {
        if ((await ask()) !== 'granted') return;
      } catch {
        return;
      }
    }
    tiltBase = null;
    window.addEventListener('deviceorientation', onTilt);
    tiltOn = true;
  }
  if (!tiltOn) tiltGoal.set(0, 0);
  gyroButton.classList.toggle('on', tiltOn);
  gyroButton.setAttribute('aria-pressed', String(tiltOn));
});

const restPos = new THREE.Vector3();
const orbit = new THREE.Vector3();
const right = new THREE.Vector3();
function frame() {
  restPos.copy(camera.position);
  restQ.copy(camera.quaternion);
  if (tilt.lengthSq() > 1e-8) {
    orbit.copy(camera.position).sub(controls.target);
    orbit.applyAxisAngle(camera.up, -tilt.x);
    right.crossVectors(camera.up, orbit).normalize();
    orbit.applyAxisAngle(right, tilt.y);
    camera.position.copy(controls.target).add(orbit);
    camera.lookAt(controls.target);
  }
  if (shakeAmt > 0) camera.quaternion.multiply(shakeQ.setFromEuler(shakeAngles(t, 1 / 60)));
  camera.updateMatrixWorld();
  render();
  camera.position.copy(restPos);
  camera.quaternion.copy(restQ);
  camera.updateMatrixWorld();
}
const wireMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
// the drawing: the bird's skin, bill and eyes and the twig, not the feathers or the sky
const wireHide = [backdrop.mesh, ambient.group, bird.feathers.contour, bird.feathers.flight, bird.feathers.fuzz];
const wasVisible: boolean[] = [];
let wireLive = true;
function drawWire() {
  wireLive = true;
  wireHide.forEach((o, i) => {
    wasVisible[i] = o.visible;
    o.visible = false;
  });
  scene.overrideMaterial = wireMat;
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  wireHide.forEach((o, i) => (o.visible = wasVisible[i]));
}
let firstFrame = true;
function render() {
  if (firstFrame) {
    firstFrame = false;
    canvas.classList.remove('pending');
  }
  if (!usePost) return renderer.render(scene, camera);
  post.focusOn(focusAt);
  post.grade.uReveal.value = THREE.MathUtils.smoothstep(reveal, 0, 1);
  post.render(scene, camera, t, revealing && reveal === 1 ? null : drawWire);
  if (edgeDue && reveal === 1 && !drawing) sampleEdge();
}

// Phone browsers draw their bars over the page and, depending on the browser, show the
// page's own background below the canvas. Paint it the colour of the picture's bottom
// edge so it reads as more of the scene: read the bottom row once the picture is up,
// and again after a resize.
let edgeDue = true;
let edgePx = new Uint8Array(4);
let edgeBuf: WebGLBuffer | null = null;
let edgeSync: WebGLSync | null = null;
const themeMeta = document.querySelector('meta[name="theme-color"]');
function sampleEdge() {
  // (still waiting on the last one: ask again next frame)
  if (edgeSync) return;
  edgeDue = false;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  renderer.setRenderTarget(null);
  const w = gl.drawingBufferWidth;
  // one read of the whole row, into a buffer, picked up once the GPU is past it: a plain
  // readPixels waits for the frame to finish, a long stall the moment the picture is up
  if (edgePx.length !== w * 4) edgePx = new Uint8Array(w * 4);
  edgeBuf ??= gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, edgeBuf);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, edgePx.byteLength, gl.STREAM_READ);
  gl.readPixels(0, 1, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) return;
  edgeSync = sync;
  gl.flush();
  const px = edgePx;
  const poll = () => {
    const s = gl.clientWaitSync(sync, 0, 0);
    if (s === gl.TIMEOUT_EXPIRED) return void setTimeout(poll, 8);
    gl.deleteSync(sync);
    edgeSync = null;
    if (s === gl.WAIT_FAILED) return;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, edgeBuf);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    paintEdge(px, w);
  };
  setTimeout(poll, 8);
}
function paintEdge(px: Uint8Array, w: number) {
  let r = 0, g = 0, b = 0;
  const n = 9;
  for (let i = 0; i < n; i++) {
    const k = Math.round(((i + 0.5) / n) * (w - 1)) * 4;
    r += px[k]; g += px[k + 1]; b += px[k + 2];
  }
  const col = `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
  document.documentElement.style.background = col;
  themeMeta?.setAttribute('content', col);
}
let edgeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(edgeTimer);
  edgeTimer = window.setTimeout(() => (edgeDue = true), 400);
});

Object.assign(window as unknown as Record<string, unknown>, { __scene: scene, __camera: camera, __renderer: renderer, __controls: controls, __post: post, __frame: frame, __seeds: seeds, __insects: insects, __ambient: ambient, __sway: sway });
