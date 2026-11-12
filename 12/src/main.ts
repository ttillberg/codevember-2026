import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBackdrop } from './env/backdrop';
import { createBranch, GRIP_X, loadBranch, perchRadiusAt } from './env/branch';
import { createBird, type ForageLayer, type GazeLayer, type HopLayer, type MouthLayer, type RuffleLayer } from './bird';
import type { Food, PerchFrame } from './bird/types';
import { PALETTES, paletteMatrices } from './bird/palettes';
import { createPost } from './post';
import { createSeeds } from './seeds';
import { createInsects } from './insects';
import { createSettings } from './settings';

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const query = new URLSearchParams(location.search);
const usePost = !query.has('nopost');
// with the post pass the MSAA lives in the scene target, not the canvas
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !usePost, powerPreference: 'high-performance' });
const phone = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, phone ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
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
async function ready() {
  try {
    await renderer.compileAsync(scene, camera);
  } catch {
    /* compile on first draw then */
  }
  startReveal();
}
const branchLoad = query.has('procbranch')
  ? Promise.resolve()
  : loadBranch(`${import.meta.env.BASE_URL}branch.glb`, (e) => {
      if (loadLabel && e.lengthComputable) loadLabel.textContent = `${Math.round((e.loaded / e.total) * 100)}%`;
    })
      .then((b) => {
        scene.remove(branch.group);
        disposeTree(branch.group);
        scene.add(b.group);
        usePerch(b.group);
        useMaskOccluders(b.group);
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
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xf2fae8, 1.4);
rim.position.set(1.5, 1.8, -2.5);
rim.target.position.set(0, 0.5, 0);
scene.add(rim, rim.target);

// --- bird ---------------------------------------------------------------------
const bird = createBird({ renderer, scene, camera });
// it sits a little right of the twig's middle and drifts back there
bird.root.position.x = GRIP_X;
bird.layer<HopLayer>('hop').home = GRIP_X;
scene.add(bird.root);
// the fade lifts the bird alone: its meshes also sit on a mask layer, drawn white
// (feathers through their own shader, so the mask has their exact outline)
const MASK_LAYER = 5;
bird.root.traverse((o) => o.layers.enable(MASK_LAYER));
const maskWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
// the twig goes into the mask black, so the bird behind it stays unlifted there
const maskBlack = new THREE.MeshBasicMaterial({ color: 0x000000 });
const maskOccluders: THREE.Mesh[] = [];
function useMaskOccluders(root: THREE.Object3D) {
  maskOccluders.length = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && /^(perch|shoot|buds|twiglets)$/.test(o.name)) {
      o.layers.enable(MASK_LAYER);
      maskOccluders.push(o as THREE.Mesh);
    }
  });
}
const plumageBase = bird.feathers.contour.material as THREE.MeshStandardMaterial;
const maskPlumage = plumageBase.clone();
maskPlumage.onBeforeCompile = (shader, r) => {
  plumageBase.onBeforeCompile.call(plumageBase, shader, r);
  shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor = vec4(1.0, 1.0, 1.0, gl_FragColor.a);');
};
maskPlumage.customProgramCacheKey = () => 'plumage-mask';
const maskMeshes: THREE.Mesh[] = [];
bird.root.traverse((o) => (o as THREE.Mesh).isMesh && maskMeshes.push(o as THREE.Mesh));
const maskSaved: (THREE.Material | THREE.Material[])[] = [];
function drawMask() {
  const feathers: THREE.Object3D[] = [bird.feathers.contour, bird.feathers.flight, bird.feathers.fuzz];
  maskMeshes.forEach((m, i) => {
    maskSaved[i] = m.material;
    m.material = feathers.includes(m) ? maskPlumage : maskWhite;
  });
  const occSaved = maskOccluders.map((m) => m.material);
  maskOccluders.forEach((m) => (m.material = maskBlack));
  const layers = camera.layers.mask;
  camera.layers.set(MASK_LAYER);
  // the shadow map from the main pass is fine as it is
  renderer.shadowMap.autoUpdate = false;
  renderer.render(scene, camera);
  renderer.shadowMap.autoUpdate = true;
  camera.layers.mask = layers;
  maskMeshes.forEach((m, i) => (m.material = maskSaved[i]));
  maskOccluders.forEach((m, i) => (m.material = occSaved[i]));
}
const gaze = bird.layer<GazeLayer>('gaze');
const forage = bird.layer<ForageLayer>('forage');
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
function pointerOnPlane(x: number, y: number, ahead: number, out: THREE.Vector3) {
  toNdc(x, y);
  ray.setFromCamera(ndc, camera);
  camera.getWorldDirection(toCam).negate();
  plane.setFromNormalAndCoplanarPoint(toCam, planeAt.set(bird.root.position.x, 0.8, 0).addScaledVector(toCam, ahead));
  return ray.ray.intersectPlane(plane, out);
}
window.addEventListener('pointermove', (e) => {
  if (pointerOnPlane(e.clientX, e.clientY, 0.8, pointerTarget)) pointerAt = performance.now();
});

// seeds: click drops one in the air in front of the bird
const seeds = createSeeds(scene);
// and now and then a gnat, which the bird may catch (it mostly gets away)
const insects = createInsects(scene, () => bird.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.85, 0)));
bird.onPick = (id) => (insects.owns(id) ? insects.pick(id) : seeds.pick(id));
bird.onSwallow = (id) => (insects.owns(id) ? insects.swallowed(id) : seeds.swallowed(id));
const allFood: Food[] = [];
const seedAt = new THREE.Vector3();
let downAt = 0;
let downX = 0;
let downY = 0;
canvas.addEventListener('pointerdown', (e) => {
  downAt = performance.now();
  downX = e.clientX;
  downY = e.clientY;
});
// is the bird under this point? A capsule from the belly to the head is plenty
const capA = new THREE.Vector3();
const capB = new THREE.Vector3();
function tapsBird(x: number, y: number) {
  toNdc(x, y);
  ray.setFromCamera(ndc, camera);
  bird.root.getWorldPosition(capA).y += 0.25;
  bird.headPosition(capB);
  return ray.ray.distanceSqToSegment(capA, capB) < 0.22 * 0.22;
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
window.addEventListener('pointermove', (e) => document.body.classList.toggle('near', e.clientX > window.innerWidth - 140 && e.clientY < 120));
canvas.addEventListener('pointerup', (e) => {
  if (settings.isOpen()) return settings.open(false);
  // a click, not a drag
  if (performance.now() - downAt < 250 && Math.hypot(e.clientX - downX, e.clientY - downY) < 6) {
    // on a phone, a tap on the bird turns it into another bird; anywhere else drops a seed
    if (phone && tapsBird(e.clientX, e.clientY)) changePalette();
    else if (pointerOnPlane(e.clientX, e.clientY, 0.6, seedAt)) seeds.spawn(seedAt);
  }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') bird.startle(1);
  if (e.code === 'KeyW' && !e.metaKey && !e.ctrlKey) setDrawing(!drawing);
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

// --- the perch, for hopping along it -------------------------------------------
// a ray straight down at world x finds the top of the twig; the tangent and
// up come from two neighbours. The twig never moves, so each x is cast once:
// the hop's search asks the same handful of spots over and over.
const perchRay = new THREE.Raycaster();
perchRay.ray.direction.set(0, -1, 0);
const perchHits: THREE.Intersection[] = [];
let perchMesh: THREE.Object3D | null = null;
const perchCache = new Map<number, PerchFrame | null>();
const pa = new THREE.Vector3();
const pb = new THREE.Vector3();
function perchTop(x: number, out: THREE.Vector3) {
  if (!perchMesh) return null;
  perchRay.ray.origin.set(x, 2, 0);
  perchHits.length = 0;
  perchRay.intersectObject(perchMesh, false, perchHits);
  const h = perchHits[0];
  return h ? out.copy(h.point) : null;
}
function perchAt(x: number, out: PerchFrame) {
  const key = Math.round(x * 1000);
  let f = perchCache.get(key);
  if (f === undefined) {
    f = { point: new THREE.Vector3(), up: new THREE.Vector3(), tangent: new THREE.Vector3(), radius: perchRadiusAt(x) };
    if (perchTop(x, f.point) && perchTop(x - 0.03, pa) && perchTop(x + 0.03, pb)) {
      f.tangent.copy(pb).sub(pa).normalize();
      f.up.set(0, 1, 0).addScaledVector(f.tangent, -f.tangent.y).normalize();
    } else f = null;
    perchCache.set(key, f);
  }
  if (!f) return null;
  out.point.copy(f.point);
  out.up.copy(f.up);
  out.tangent.copy(f.tangent);
  out.radius = f.radius;
  return out;
}
function usePerch(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  perchMesh = root.getObjectByName('perch') ?? null;
  perchCache.clear();
  bird.setPerch(perchAt, [GRIP_X - 0.45, GRIP_X + 0.45]);
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
useMaskOccluders(branch.group);

// --- another bird: the feathers turn to new colours ----------------------------
let paletteIndex = 0;
let paletteT = 1;
let paletteDelay = 0;
const paletteFrom = bird.plumage.uPal.value.map((m) => m.clone());
let paletteTo = paletteMatrices(PALETTES[0]);
function changePalette() {
  paletteIndex = (paletteIndex + 1) % PALETTES.length;
  // just the slightest lift of the throat and crown as the colours turn
  bird.layer<RuffleLayer>('ruffle').trigger(bird.mind, 'throat', 0.25);
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
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyC' && !e.metaKey && !e.ctrlKey) changePalette();
});

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
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyH' && !e.metaKey && !e.ctrlKey) setHeadWire(!headWire);
});

// --- settings wheel, bottom right ---------------------------------------------
let followPointer = true;
let shakeAmt = query.has('still') ? 0 : 1.8;
let fuzzVisible = true;
let branchFuzz: THREE.Object3D | null = null;
function applyFuzz() {
  bird.feathers.fuzz.visible = fuzzVisible;
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
const TONE: Record<string, THREE.ToneMapping> = {
  Neutral: THREE.NeutralToneMapping,
  AgX: THREE.AgXToneMapping,
  ACES: THREE.ACESFilmicToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
  None: THREE.NoToneMapping,
};
const settings = createSettings([
  { kind: 'heading', label: 'Camera' },
  { kind: 'range', key: 'shake', label: 'Handheld', value: shakeAmt, min: 0, max: 3.5, step: 0.05, set: (v) => (shakeAmt = v) },
  { kind: 'range', key: 'dof', label: 'Depth of field', value: 120, min: 0, max: 260, step: 5, set: (v) => (post.dof.uAperture.value = v) },
  { kind: 'range', key: 'exposure', label: 'Exposure', value: 1.3, min: 0.8, max: 2.4, step: 0.05, set: (v) => (post.grade.uExposure.value = v) },
  { kind: 'heading', label: 'Look' },
  { kind: 'select', key: 'tonemap', label: 'Tone mapping', value: 'ACES', options: Object.keys(TONE), set: (v) => post.setToneMapping(TONE[v]) },
  { kind: 'range', key: 'contrast', label: 'Contrast', value: 0.98, min: 0.6, max: 1.4, step: 0.01, set: (v) => (post.grade.uContrast.value = v) },
  { kind: 'range', key: 'sat', label: 'Saturation', value: 1.12, min: 0.3, max: 1.4, step: 0.01, set: (v) => (post.grade.uSat.value = v) },
  { kind: 'range', key: 'fade', label: 'Fade', value: 0, min: 0, max: 0.6, step: 0.01, set: (v) => (post.grade.uFade.value = v) },
  { kind: 'heading', label: 'Bird' },
  { kind: 'toggle', key: 'follow', label: 'Follows the pointer', value: true, set: (v) => (followPointer = v) },
  { kind: 'range', key: 'mood', label: 'Calm · alert', value: bird.mind.baseline, min: 0, max: 1, step: 0.01, set: (v) => (bird.mind.baseline = v) },
  { kind: 'range', key: 'flash', label: 'Gorget flash', value: 1, min: 0, max: 2, step: 0.05, set: (v) => { bird.plumage.uFlash.value = flash0 * v; bird.plumage.uGlint.value = glint0 * v; } },
  { kind: 'toggle', key: 'fuzz', label: 'Down and felt', value: true, set: (v) => { fuzzVisible = v; applyFuzz(); } },
  { kind: 'heading', label: 'Do' },
  { kind: 'action', label: 'Drop a seed', run: () => seeds.spawn(seedAhead()) },
  { kind: 'action', label: 'A gnat', run: () => insects.spawn() },
  { kind: 'action', label: 'Sing', run: () => bird.layer<MouthLayer>('mouth').sing(bird.mind, 2.2) },
  { kind: 'action', label: 'Ruffle', run: () => bird.layer<RuffleLayer>('ruffle').trigger(bird.mind, 'shake') },
  { kind: 'action', label: 'Another bird (C)', run: changePalette },
  { kind: 'action', label: 'Startle', run: () => bird.startle(1) },
  { kind: 'action', label: 'Drawing (W)', run: () => setDrawing(!drawing) },
  { kind: 'action', label: 'Head wireframe (H)', run: () => setHeadWire(!headWire) },
]);

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
const timer = new THREE.Timer();
timer.connect(document);
let t = 0;
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 1 / 20);
  t += dt;
  controls.update();
  backdrop.material.uniforms.uTime.value = t;
  backdrop.mesh.position.copy(camera.position);
  // the pointer is interesting while it moves; 2 s of stillness and the bird
  // goes back to its own business (the camera now and then, so the gorget still flashes)
  const recent = followPointer && performance.now() - pointerAt < 2000;
  gaze.interest = recent ? 0.95 : 0.5;
  // a bird looks with one eye as often as with both; at the pointer, mostly bill-on so it reads
  gaze.billOn = recent ? 0.8 : 0.46;
  // and follows it, a mix of gliding after it and snapping to catch up
  gaze.pursuit = recent && performance.now() - pointerAt < 700 ? 1 : 0;
  bird.setAttention(recent ? pointerTarget : camera.position);
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
  allFood.length = 0;
  allFood.push(...seeds.food(), ...insects.food());
  bird.setFood(allFood);
  bird.update(dt, t);
  bird.headPosition(headPos);
  updateHeadCut();
  seeds.update(dt, t, billTip, headPos);
  insects.update(dt, t, billTip, forage.state === 'windup' || forage.state === 'strike');
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
const wireHide = [backdrop.mesh, bird.feathers.contour, bird.feathers.flight, bird.feathers.fuzz];
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
  post.focusOn(headPos);
  post.grade.uReveal.value = THREE.MathUtils.smoothstep(reveal, 0, 1);
  post.render(scene, camera, t, revealing && reveal === 1 ? null : drawWire, drawMask);
}

Object.assign(window as unknown as Record<string, unknown>, { __scene: scene, __camera: camera, __renderer: renderer, __controls: controls, __post: post, __frame: frame, __seeds: seeds, __insects: insects });
