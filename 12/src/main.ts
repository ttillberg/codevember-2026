import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBackdrop } from './env/backdrop';
import { createBranch, loadBranch } from './env/branch';
import { createBird } from './bird';
import { createPost } from './post';
import { createSeeds } from './seeds';

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
camera.position.set(0, 0.5, 3.3);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.42, 0);
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
if (!query.has('procbranch')) {
  loadBranch(`${import.meta.env.BASE_URL}branch.glb`)
    .then((b) => {
      scene.remove(branch.group);
      scene.add(b.group);
    })
    .catch(() => {
      /* no glb yet: keep the procedural twig */
    });
}

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
const gaze = bird.layer<{ interest: number } & import('./bird').Layer>('gaze');
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
const seedAt = new THREE.Vector3();
let downAt = 0;
let downX = 0;
let downY = 0;
canvas.addEventListener('pointerdown', (e) => {
  downAt = performance.now();
  downX = e.clientX;
  downY = e.clientY;
});
const hint = document.querySelector('.hint');
setTimeout(() => hint?.classList.add('gone'), 9000);
canvas.addEventListener('pointerup', (e) => {
  hint?.classList.add('gone');
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
  const recent = performance.now() - pointerAt < 2000;
  gaze.interest = recent ? 0.95 : 0.5;
  bird.setAttention(recent ? pointerTarget : camera.position);
  bird.setFood?.(seeds.food());
  bird.update(dt, t);
  seeds.update(dt, t, bird.billTip?.bind(bird));
  frame();
});

function frame() {
  if (!usePost) return renderer.render(scene, camera);
  if (head) post.focusOn(head.getWorldPosition(headPos));
  post.render(scene, camera, t);
}

Object.assign(window as unknown as Record<string, unknown>, { __scene: scene, __camera: camera, __renderer: renderer, __controls: controls, __post: post, __frame: frame, __seeds: seeds });
