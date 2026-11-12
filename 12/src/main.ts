import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBackdrop } from './env/backdrop';
import { createBranch, loadBranch } from './env/branch';
import { createBird } from './bird';
import { createPost } from './post';
import { createSeeds } from './seeds';
import { createSettings } from './settings';

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const query = new URLSearchParams(location.search);
const usePost = !query.has('nopost');
// with the post pass the MSAA lives in the scene target, not the canvas
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !usePost, powerPreference: 'high-performance' });
const phone = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, phone ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 120);
camera.position.set(1.6, 0.3, 2.9); // from the right, a touch low: the buds big in the foreground

const controls = new OrbitControls(camera, canvas);
controls.target.set(-0.08, 0.46, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 0.7;
controls.maxDistance = 6;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = 2.1;
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
async function ready() {
  try {
    await renderer.compileAsync(scene, camera);
  } catch {
    /* compile on first draw then */
  }
  revealing = true;
  document.body.classList.remove('loading');
}
const branchLoad = query.has('procbranch')
  ? Promise.resolve()
  : loadBranch(`${import.meta.env.BASE_URL}branch.glb`, (e) => {
      if (loadLabel && e.lengthComputable) loadLabel.textContent = `${Math.round((e.loaded / e.total) * 100)}%`;
    })
      .then((b) => {
        scene.remove(branch.group);
        scene.add(b.group);
        usePerch(b.group);
        // the felt arrives after the settings: give it the fuzz choice
        b.group.traverse((o) => o.name === 'fuzz' && (o.visible = fuzzVisible));
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
scene.add(bird.root);
const gaze = bird.layer<{ interest: number; billOn: number; pursuit: number } & import('./bird').Layer>('gaze');
// on phones the contour feathers skip the shadow pass (most of its triangles)
if (phone) bird.root.traverse((o) => o.name === 'bird.contour' && (o.castShadow = false));

// attention: the pointer when it moves, else the camera
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pointerTarget = new THREE.Vector3();
let pointerAt = -1e9;
const plane = new THREE.Plane();
// a plane facing the camera, `ahead` in front of the bird's head
function pointerOnPlane(x: number, y: number, ahead: number, out: THREE.Vector3) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const n = camera.getWorldDirection(new THREE.Vector3()).negate();
  plane.setFromNormalAndCoplanarPoint(n, new THREE.Vector3(0, 0.8, 0).addScaledVector(n, ahead));
  return ray.ray.intersectPlane(plane, out);
}
window.addEventListener('pointermove', (e) => {
  if (pointerOnPlane(e.clientX, e.clientY, 0.8, pointerTarget)) pointerAt = performance.now();
});

// seeds: click drops one in the air in front of the bird
const seeds = createSeeds(scene);
bird.onPick = (id) => seeds.pick(id);
(bird as { onSwallow?: ((id: number) => void) | null }).onSwallow = (id) => seeds.swallowed(id);
const seedAt = new THREE.Vector3();
let downAt = 0;
let downX = 0;
let downY = 0;
canvas.addEventListener('pointerdown', (e) => {
  downAt = performance.now();
  downX = e.clientX;
  downY = e.clientY;
});
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
const hint = document.querySelector('.hint');
setTimeout(() => hint?.classList.add('gone'), 9000);
canvas.addEventListener('pointerup', (e) => {
  hint?.classList.add('gone');
  if (settings.isOpen()) return settings.open(false);
  // a click, not a drag
  if (performance.now() - downAt < 250 && Math.hypot(e.clientX - downX, e.clientY - downY) < 6) {
    if (pointerOnPlane(e.clientX, e.clientY, 0.6, seedAt)) seeds.spawn(seedAt);
  }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') bird.startle(1);
});

// --- post: depth of field on the head, colour grade -----------------------------
const post = createPost(renderer, { samples: 4 });
const head = bird.root.getObjectByName('head');
const headPos = new THREE.Vector3();
{
  // graded by eye against the footage: brighter, a touch cool, plum in the shadows
  const g = post.grade;
  g.uExposure.value = 1.45;
  g.uWhite.value.set(1.0, 1.0, 1.04);
  g.uLift.value.set(0.015, 0.005, 0.022);
  g.uGamma.value.set(1.0, 1.04, 1.0);
  g.uContrast.value = 1.06;
  g.uSat.value = 0.98;
  g.uVignette.value = 0.22;
  post.dof.uAperture.value = 120;
}

// --- the perch, for hopping along it -------------------------------------------
// a ray straight down at world x finds the top of the twig; the tangent and
// up come from two neighbours. Radius from the twig's taper (0.09 at x = 0).
const perchRay = new THREE.Raycaster();
const perchHits: THREE.Intersection[] = [];
let perchMesh: THREE.Object3D | null = null;
const pa = new THREE.Vector3();
const pb = new THREE.Vector3();
function perchTop(x: number, out: THREE.Vector3) {
  if (!perchMesh) return null;
  perchRay.set(new THREE.Vector3(x, 2, 0), new THREE.Vector3(0, -1, 0));
  perchHits.length = 0;
  perchRay.intersectObject(perchMesh, false, perchHits);
  const h = perchHits[0];
  return h ? out.copy(h.point) : null;
}
function perchAt(x: number, out: import('./bird/types').PerchFrame) {
  if (!perchTop(x, out.point) || !perchTop(x - 0.03, pa) || !perchTop(x + 0.03, pb)) return null;
  out.tangent.copy(pb).sub(pa).normalize();
  out.up.set(0, 1, 0).addScaledVector(out.tangent, -out.tangent.y).normalize();
  out.radius = 0.09 * Math.min(1 - 0.18 * x, 2.2);
  return out;
}
function usePerch(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  perchMesh = root.getObjectByName('perch') ?? (root.children[0] as THREE.Object3D) ?? null;
  bird.setPerch?.(perchAt, [-0.45, 0.45]);
}
usePerch(branch.group);

// --- settings wheel, top right ------------------------------------------------
let followPointer = true;
let shakeAmt = query.has('still') ? 0 : 1.8;
let fuzzVisible = true;
const flash0 = bird.plumage.uFlash.value;
const glint0 = bird.plumage.uGlint.value;
const byName = (n: string) => {
  const out: THREE.Object3D[] = [];
  scene.traverse((o) => o.name === n && out.push(o));
  return out;
};
const seedAhead = () => {
  // a seed somewhere in reach, in front of the head, a little to one side
  const n = camera.getWorldDirection(new THREE.Vector3()).negate();
  const side = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize();
  return new THREE.Vector3(0, 0.95 + Math.random() * 0.2, 0).addScaledVector(n, 0.6).addScaledVector(side, (Math.random() - 0.5) * 0.5);
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
  { kind: 'range', key: 'exposure', label: 'Exposure', value: 1.45, min: 0.8, max: 2.4, step: 0.05, set: (v) => (post.grade.uExposure.value = v) },
  { kind: 'heading', label: 'Look' },
  { kind: 'select', key: 'tonemap', label: 'Tone mapping', value: 'Neutral', options: Object.keys(TONE), set: (v) => post.setToneMapping(TONE[v] ?? THREE.NeutralToneMapping) },
  { kind: 'range', key: 'contrast', label: 'Contrast', value: 1.06, min: 0.6, max: 1.4, step: 0.01, set: (v) => (post.grade.uContrast.value = v) },
  { kind: 'range', key: 'sat', label: 'Saturation', value: 0.98, min: 0.3, max: 1.4, step: 0.01, set: (v) => (post.grade.uSat.value = v) },
  { kind: 'range', key: 'fade', label: 'Fade', value: 0, min: 0, max: 0.6, step: 0.01, set: (v) => (post.grade.uFade.value = v) },
  { kind: 'heading', label: 'Bird' },
  { kind: 'toggle', key: 'follow', label: 'Follows the pointer', value: true, set: (v) => (followPointer = v) },
  { kind: 'range', key: 'mood', label: 'Calm · alert', value: bird.mind.baseline, min: 0, max: 1, step: 0.01, set: (v) => (bird.mind.baseline = v) },
  { kind: 'range', key: 'flash', label: 'Gorget flash', value: 1, min: 0, max: 2, step: 0.05, set: (v) => { bird.plumage.uFlash.value = flash0 * v; bird.plumage.uGlint.value = glint0 * v; } },
  { kind: 'toggle', key: 'fuzz', label: 'Down and felt', value: true, set: (v) => { fuzzVisible = v; for (const n of ['bird.fuzz', 'fuzz']) byName(n).forEach((o) => (o.visible = v)); } },
  { kind: 'heading', label: 'Do' },
  { kind: 'action', label: 'Drop a seed', run: () => seeds.spawn(seedAhead()) },
  { kind: 'action', label: 'Sing', run: () => bird.layer<{ sing(m: unknown, s?: number): void } & import('./bird').Layer>('mouth').sing(bird.mind, 2.2) },
  { kind: 'action', label: 'Ruffle', run: () => bird.layer<{ trigger(m: unknown, k?: string): void } & import('./bird').Layer>('ruffle').trigger(bird.mind, 'shake') },
  { kind: 'action', label: 'Startle', run: () => bird.startle(1) },
]);

// --- loop ---------------------------------------------------------------------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  post.setSize(w, h, renderer.getPixelRatio());
  camera.aspect = w / h;
  // keep the bird framed on portrait screens
  camera.fov = w / h < 1 ? 30 / Math.max(w / h, 0.55) : 30;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

branchLoad.then(() => requestAnimationFrame(() => ready()));
if (!usePost) {
  reveal = 1;
  revealing = true;
  document.body.classList.remove('loading');
}
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
  if (revealing && reveal < 1) reveal = Math.min(1, reveal + dt / 1.6);
  bird.setFood?.(seeds.food());
  bird.update(dt, t);
  seeds.update(dt, t, bird.billTip?.bind(bird), head?.getWorldPosition(headPos));
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
  const D = Math.PI / 180;
  if (t > bumpAt) {
    bump.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.09);
    bumpAt = t + 4 + Math.random() * 9;
  }
  bump.multiplyScalar(Math.exp(-dt * 5));
  // sway (breathing, the arms), tremor (the hands), the bump settling
  const k = shakeAmt * D;
  const yaw = (wobble(t, 0.35, 1.3) * 0.16 + wobble(t, 7.3, 4.1) * 0.018 + bump.x) * k;
  const pitch = (wobble(t, 0.27, 2.7) * 0.12 + wobble(t, 8.1, 5.9) * 0.016 + bump.y) * k;
  const roll = wobble(t, 0.22, 0.4) * 0.1 * k;
  return shakeE.set(pitch, yaw, roll, 'YXZ');
}

function frame() {
  const shake = shakeAmt > 0;
  if (shake) {
    restQ.copy(camera.quaternion);
    camera.quaternion.multiply(shakeQ.setFromEuler(shakeAngles(t, 1 / 60)));
    camera.updateMatrixWorld();
  }
  render();
  if (shake) {
    camera.quaternion.copy(restQ);
    camera.updateMatrixWorld();
  }
}
const wireMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
const wireHide = ['bird.contour', 'bird.flight', 'bird.fuzz'];
function drawWire() {
  const hidden: THREE.Object3D[] = [];
  backdrop.mesh.visible = false;
  scene.traverse((o) => {
    if (o.visible && wireHide.includes(o.name)) {
      o.visible = false;
      hidden.push(o);
    }
  });
  scene.overrideMaterial = wireMat;
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  backdrop.mesh.visible = true;
  for (const o of hidden) o.visible = true;
}
function render() {
  if (!usePost) return renderer.render(scene, camera);
  if (head) post.focusOn(head.getWorldPosition(headPos));
  post.grade.uReveal.value = reveal * reveal * (3 - 2 * reveal);
  post.render(scene, camera, t, revealing ? null : drawWire);
  if (canvas.classList.contains('pending')) canvas.classList.remove('pending');
}

Object.assign(window as unknown as Record<string, unknown>, { __scene: scene, __camera: camera, __renderer: renderer, __controls: controls, __post: post, __frame: frame, __seeds: seeds });
