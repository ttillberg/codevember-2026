// 16 / Spore — crawl over an endless moss carpet with a worm's eye. Day 05's moss (shell undercoat plus
// instanced fronds) on a forest floor built in chunks around you, under a low sun through the canopy.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { TexturePass } from 'three/addons/postprocessing/TexturePass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { shellVertex, shellFragment, mossLighting } from './shaders';
import { World, groundHeight, baseHeight, mossAt, type WorldHooks } from './world';
import { Props } from './props';
import { Ferns } from './ferns';
import { Trees, trunkFoot, trunkRadius, type Trunk } from './trees';
import { makeDewMaterial } from './dew';
import { makeAtmosPass, makeLensPass } from './post';
import { Fungi, type FungusKind } from './fungi';
import { loadModels } from './models';
import { Spores } from './spores';
import { Dust } from './dust';
import { Floor } from './floor';
import { Boulders } from './boulders';
import { Foliage } from './foliage';
import { Slingshot } from './slingshot';
import { Forest } from './forest';
import { soundboard } from './soundboard';
import { reference } from './reference';
import { lookboard } from './lookboard';
import { vegboard } from './vegboard';
import { Oaks } from './oak';
import { Fungarium, type Species } from './fungarium';
import { Pouch } from './pouch';
import { Sound } from './sound';
import { Ants } from './ants';
import { mulberry32 } from './noise';

// ?clean: the scene alone, no furniture (docs/DESIGN.md)
const params = new URLSearchParams(location.search);
if (params.has('clean')) document.body.classList.add('clean');

const coarse = matchMedia('(pointer: coarse)').matches;
const SHELLS = coarse ? 8 : 10; // the fronds carry the top; fewer layers is the biggest saving there is
const BG = new THREE.Color(0x14100a);

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
// 1 by default: the shells are layers of overdraw with discard, every pixel counts, and the lens softens
// most of the frame anyway. ?dpr=1.5 or 2 for sharper stills.
const DPR = Number(params.get('dpr')) || 1;
renderer.setPixelRatio(Math.min(devicePixelRatio, DPR));
renderer.setClearColor(BG);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 80);
camera.rotation.order = 'YXZ';

// dusk: the sun nine degrees over the horizon, ahead and to the right, so you crawl into it. Everything is
// backlit, every frond tip and blade catches it, and anything standing up throws a long shadow your way.
// the sun, ahead and to the right, SUN_UP degrees over the horizon: a morning sun at 45, its rays coming down from
// above through the crowns (?sun=9 for the dusk the day began with, a low sun straight through the trunks)
const SUN_UP = THREE.MathUtils.degToRad(Number(params.get('sun')) || 45);
const SUN_FLAT = new THREE.Vector2(0.45, -0.88).normalize();
const lightDir = new THREE.Vector3(SUN_FLAT.x * Math.cos(SUN_UP), Math.sin(SUN_UP), SUN_FLAT.y * Math.cos(SUN_UP));
/** the sun to another height, live (the look panel): every uniform holds this same vector */
function setSunHeight(deg: number) {
  const a = THREE.MathUtils.degToRad(Math.min(deg, 88));
  lightDir.set(SUN_FLAT.x * Math.cos(a), Math.sin(a), SUN_FLAT.y * Math.cos(a));
  shadowCentre.set(Infinity, 0, 0); // the shadow map drawn again
  foliage.canopyDirty = true; // and the crowns' shade, moved along the new sun
}
// (the look panel can hold the focus by hand)
const focusHold = { hold: false, at: 1.6 };
/** 0 at dusk (nine degrees) .. 1 with a morning sun (forty five): the light whiter, the air paler */
const MORNING = THREE.MathUtils.smoothstep(SUN_UP, THREE.MathUtils.degToRad(9), THREE.MathUtils.degToRad(45));
const shellMat = new THREE.ShaderMaterial({
  vertexShader: shellVertex,
  fragmentShader: shellFragment,
  defines: { SHELLS },
  uniforms: {
    uHeight: { value: 0 },
    uBulge: { value: 0 },
    uScale: { value: 1 },
    uLightDir: { value: lightDir },
    uLightDirC: { value: lightDir },
    uRimDir: { value: lightDir },
    uRim: { value: 2.2 },
    uHemi: { value: 1 },
    uTone: { value: 2 }, // ACES
    uCavityAO: { value: 1 },
    uExposure: { value: 1.45 },
    toneMappingExposure: { value: 1 },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowOn: { value: 0 },
    uDepthOnly: { value: 0 },
    uShadowFloor: { value: 0.2 },
    uTime: { value: 0 },
    uCanopyMap: { value: null as THREE.Texture | null },
    uCanopyBox: { value: new THREE.Vector3(0, 0, 1) },
    uCanopyAmt: { value: 1 },
  },
});
const SHARED_UNIFORMS = ['uCavityAO', 'uLightDir', 'uLightDirC', 'uRimDir', 'uRim', 'uHemi', 'uTone', 'uExposure', 'toneMappingExposure', 'uShadowMap', 'uShadowMatrix', 'uShadowOn', 'uDepthOnly', 'uShadowFloor', 'uTime', 'uCanopyMap', 'uCanopyBox', 'uCanopyAmt'];
const share = (m: THREE.ShaderMaterial) => { for (const k of SHARED_UNIFORMS) m.uniforms[k] = shellMat.uniforms[k]; };

// ---- moss size: day 05's numbers at 175 %
const BASE = { height: 0.012, bulge: 0.035, len: 0.032, star: 0.038, lichen: 0.07, width: 0.0042 };
const mossScale = 1.75;
shellMat.uniforms.uHeight.value = BASE.height * mossScale;
shellMat.uniforms.uBulge.value = BASE.bulge * mossScale;
shellMat.uniforms.uScale.value = mossScale;

// ---- the endless floor
// dew drops, one material for all of them
const dewMaterial = makeDewMaterial(share);
const hooks: WorldHooks = {
  dewMaterial,
  shellMat,
  shells: SHELLS,
  setupFronds(m) {
    share(m);
    m.uniforms.uLen.value = BASE.len * mossScale;
    m.uniforms.uStarLen.value = BASE.star * mossScale;
    m.uniforms.uLichenLen.value = BASE.lichen * mossScale;
    m.uniforms.uWidth.value = BASE.width * mossScale;
    m.uniforms.uBulge.value = BASE.bulge * mossScale;
    // no grass straws: moss only
    m.uniforms.uStrawBase.value = 0.0;
    m.uniforms.uStrawMax.value = 0.0;
  },
};
const world = new World(hooks, coarse);
scene.add(world.root);

// ---- small fungi, thrown or found, and the spores that make them
const fungi = new Fungi(share, dewMaterial);
scene.add(fungi.group);
// the spore smoke is drawn after the atmosphere, in a scene of its own (see the render chain)
const spores = new Spores(share);
// a whoosh when you fling, a puff where it lands and where you sow
const sound = new Sound(camera);
// the wood's own: wind in the spruces and birds round you
const forest = new Forest(sound, camera);
// ?debug: a soundboard to try them one by one
if (params.has('debug')) soundboard(forest, sound, camera);
// and the splash as a reference to work toward, in a window (R: big, hidden, small)
if (params.has('debug')) reference(`${import.meta.env.BASE_URL}splash.webp`);
const creakAt = new THREE.Vector3();
const creakNext = new WeakMap<object, number>(); // when each growing cluster creaks next
const fxScene = new THREE.Scene();
fxScene.add(spores.mesh);
// dust hanging in the air, showing only in the sun's beams
const dust = new Dust(share);
fxScene.add(dust.mesh);
// and glowing motes, fewer and bigger, rising in the light (the splash's gold orbs)
const motes = new Dust(share, { motes: true, count: coarse ? 60 : 140, box: new THREE.Vector3(9, 2.4, 9) });
fxScene.add(motes.mesh);
// the slingshot in hand, drawn over the finished picture
const sling = new Slingshot();
let slingKind = '';
// where a cluster stands: its foot down in the moss, stems coming up through it
const fungusFoot = (x: number, z: number) => { const g = groundHeight(x, z); return g + 0.03 * mossAt(x, g, z); };

// ---- the floor running out under everything, past the chunks
const farVertex = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vN;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const farFragment = /* glsl */ `
precision highp float;
uniform vec3 uLightDir;
${mossLighting}
varying vec3 vWorldPos;
varying vec3 vN;
float h31(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float n3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  vec3 N = normalize(vN);
  vec3 L = normalize(uLightDir);
  // dark green carpet with patches of brown humus
  vec3 base = mix(vec3(0.016, 0.03, 0.008), vec3(0.05, 0.03, 0.012), smoothstep(0.35, 0.65, n3(vWorldPos * 1.5)));
  float sun = max(dot(N, L), 0.0) * mix(uShadowFloor, 1.0, canopyAt(vWorldPos));
  vec3 c = base * (0.45 * skyTint(N, 1.0) + 2.2 * sun);
  gl_FragColor = vec4(tonemap(grade(c)), 1.0);
  #include <colorspace_fragment>
}
`;
const farMat = new THREE.ShaderMaterial({ vertexShader: farVertex, fragmentShader: farFragment, uniforms: {} });
share(farMat);
// fungi standing about in the moss
const props = new Props(fungi, fungusFoot);
// ferns, towering over you
const ferns = new Ferns(share, dewMaterial);
scene.add(ferns.root);
// spruce trunks, three levels of detail
const trees = new Trees(share);
scene.add(trees.root);
// fallen leaves and wood sorrel on the moss
const floorBits = new Floor(share);
scene.add(floorBits.root);
// boulders grown over with the ground's moss
const boulders = new Boulders(hooks);
scene.add(boulders.root);
// the crowns: spruce boughs and birch leaves on the trunks, the light coming down through them
const foliage = new Foliage(share, lightDir);
scene.add(foliage.root);
// old oaks in the clearings (a Blender model, loaded on its own)
const oaks = new Oaks(share);
scene.add(oaks.root);
shellMat.uniforms.uCanopyMap.value = foliage.canopyMap;
shellMat.uniforms.uCanopyBox.value = foliage.canopyBox;
// wood ants on trails from a nest in the moss up the trunks
const ants = new Ants(share, camera);
scene.add(ants.mesh);

// the floor beyond the chunks: a big plane a hair under the moss, following the swells, recentred as you go
const farGeo = new THREE.PlaneGeometry(60, 60, 90, 90);
farGeo.rotateX(-Math.PI / 2);
const farBase = Float32Array.from((farGeo.attributes.position as THREE.BufferAttribute).array as Float32Array);
const farFloor = new THREE.Mesh(farGeo, farMat);
farFloor.frustumCulled = false;
scene.add(farFloor);
const farCentre = new THREE.Vector2(Infinity, Infinity);
function placeFarFloor(px: number, pz: number) {
  if (Math.hypot(px - farCentre.x, pz - farCentre.y) < 2) return;
  const sx = Math.round(px / 2) * 2, sz = Math.round(pz / 2) * 2;
  farCentre.set(sx, sz);
  const p = farGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = farBase[i * 3] + sx, z = farBase[i * 3 + 2] + sz;
    p.setXYZ(i, x, baseHeight(x, z) - 0.03, z); // not the hills at the trunks: on this coarse grid they were tents through the trunks' feet
  }
  p.needsUpdate = true;
  farGeo.computeVertexNormals();
}

// ---- shadow map: the patch ahead of you from the sun. Re-rendered as you crawl, without the fronds and spore
// stalks, which are too small to matter in it and most of its cost.
// (2048, as shaders.ts's penumbra reckons: at 4096 the 6 m patch was 1.5 mm a texel, and each re-render as you
// crawled shaded 17 million pixels with the full materials, a third of a second, every quarter second)
const SHADOW_SIZE = 2048;
const shadowRT = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, {
  depthTexture: new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE, THREE.UnsignedIntType),
});
const lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
const shadowCentre = new THREE.Vector3(Infinity, 0, 0);
let lastShadow = 0;
function renderShadow(centre: THREE.Vector3) {
  const radius = 3;
  // snap to whole shadow texels so the shadows do not crawl as the map follows you
  const texel = (radius * 2) / SHADOW_SIZE;
  lightCam.left = -radius; lightCam.right = radius; lightCam.top = radius; lightCam.bottom = -radius;
  lightCam.far = 40;
  lightCam.position.set(0, 0, 0).addScaledVector(lightDir, 16);
  lightCam.lookAt(0, 0, 0);
  lightCam.updateMatrixWorld();
  const local = centre.clone().applyMatrix4(lightCam.matrixWorldInverse);
  local.x = Math.round(local.x / texel) * texel;
  local.y = Math.round(local.y / texel) * texel;
  const snapped = local.applyMatrix4(lightCam.matrixWorld);
  lightCam.position.copy(snapped).addScaledVector(lightDir, 16);
  lightCam.lookAt(snapped);
  lightCam.updateProjectionMatrix();
  lightCam.updateMatrixWorld();
  const u = shellMat.uniforms;
  u.uShadowOn.value = 0;
  u.uShadowMap.value = null;
  u.uDepthOnly.value = 1;
  world.forShadow(true, centre.x, centre.z, 4.3);
  ferns.forShadow(true, centre.x, centre.z, 6);
  boulders.forShadow(true);
  foliage.forShadow(true);
  farFloor.visible = false;
  ants.mesh.visible = false; // too small to cast anything worth the map
  renderer.setRenderTarget(shadowRT);
  renderer.clear();
  renderer.render(scene, lightCam);
  renderer.setRenderTarget(null);
  world.forShadow(false);
  ferns.forShadow(false);
  boulders.forShadow(false);
  foliage.forShadow(false);
  farFloor.visible = true;
  ants.mesh.visible = true;
  u.uDepthOnly.value = 0;
  u.uShadowMap.value = shadowRT.depthTexture;
  u.uShadowMatrix.value.multiplyMatrices(lightCam.projectionMatrix, lightCam.matrixWorldInverse);
  u.uShadowOn.value = 1;
  shadowCentre.copy(centre);
}

// ---- render chain: the scene into a multisampled target with depth, then AO, atmosphere (haze, sky),
// lens (DOF, grade), sRGB out
const beautyRT = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  samples: 4,
  depthTexture: new THREE.DepthTexture(1, 1),
});
const composer = new EffectComposer(renderer);
composer.addPass(new TexturePass(beautyRT.texture));
const aoPass = new GTAOPass(scene, camera, 1, 1, { depthTexture: beautyRT.depthTexture! });
aoPass.updateGtaoMaterial({ radius: 0.12, distanceExponent: 1, thickness: 1, scale: 1, samples: 12 });
aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, samples: 8 });
aoPass.blendIntensity = 0.8;
// AO at half resolution: at full size it cost as much as all the moss together. It is soft anyway, and
// the blend upsamples it. ?noao turns it off
{
  const setSize = aoPass.setSize.bind(aoPass);
  aoPass.setSize = (w: number, h: number) => setSize(Math.ceil(w / 2), Math.ceil(h / 2));
}
aoPass.enabled = !params.has('noao') && !coarse; // phones: the moss's own hollows are enough
composer.addPass(aoPass);
const atmosMat = makeAtmosPass(beautyRT.depthTexture!, coarse);
atmosMat.uniforms.cameraNear.value = camera.near;
atmosMat.uniforms.uSunDir.value = lightDir;
atmosMat.uniforms.uCanopyMap.value = foliage.canopyMap; // the beams through the same gaps the floor is lit by
atmosMat.uniforms.uCanopyBox.value = foliage.canopyBox;
atmosMat.uniforms.uCanopyAmt = shellMat.uniforms.uCanopyAmt; // one value: the floor and the beams together
// a morning sun is whiter than a dusk one, the air paler and a little cooler
atmosMat.uniforms.uSunCol.value.lerp(new THREE.Color(1.0, 0.86, 0.62), MORNING);
atmosMat.uniforms.uHaze.value.lerp(new THREE.Color(0.092, 0.084, 0.064), MORNING);
// thick forest air: a worm cannot see far anyway
// the air: light, so the trunks stand in layers a long way back, paler and paler, the sun coming through between
// them (it was thick and golden, 0.22 and 0.9: past two metres everything melted into one yellow wall)
atmosMat.uniforms.uFog.value = 0.035; // (thinner: at 0.06 the depth of the wood went grey and the sun on the trunks was lost)
atmosMat.uniforms.uMistStart.value = 2.5; // the mist from a few steps off, so the near trunks' feet stand clear
atmosMat.uniforms.uMist.value = 0.55; // and a mist lying on the moss, glowing towards the sun, the beams lighting it
const atmos = new ShaderPass(atmosMat);
composer.addPass(atmos);
// spore smoke into the finished, hazy image: its own lighter haze keeps a column visible from far off
spores.material.uniforms.tDepth.value = beautyRT.depthTexture;
spores.material.uniforms.cameraNear.value = camera.near;
for (const d of [dust, motes]) {
  d.material.uniforms.tDepth.value = beautyRT.depthTexture;
  d.material.uniforms.cameraNear.value = camera.near;
  d.material.uniforms.cameraFar.value = camera.far;
}
const fx = new RenderPass(fxScene, camera);
fx.clear = false;
composer.addPass(fx);
const lensMat = makeLensPass(coarse);
lensMat.uniforms.uAperture.value = 0.22; // macro: a thin slice in focus, but the moss right in front still reads
const lens = new ShaderPass(lensMat);
composer.addPass(lens); // the last: it writes the screen in sRGB itself (no OutputPass)

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  const px = renderer.getDrawingBufferSize(new THREE.Vector2());
  beautyRT.setSize(px.x, px.y);
  lensMat.uniforms.uRes.value.copy(px);
  lensMat.uniforms.uMaxBlur.value = 10 * renderer.getPixelRatio() * Math.max(1, innerWidth / 1400);
  camera.aspect = innerWidth / innerHeight;
  // a portrait phone sees as much to the sides: widen the lens
  camera.fov = camera.aspect < 1 ? 58 : 40;
  camera.updateProjectionMatrix();
  spores.setSize(px.x, px.y, camera.fov);
  dust.setSize(px.x, px.y, camera.fov);
  motes.setSize(px.x, px.y, camera.fov);
  sling.setSize(px.x, px.y, camera.fov, camera.aspect);
  (dewMaterial as THREE.ShaderMaterial).uniforms.uPx.value = px.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}
addEventListener('resize', resize);
resize();

// ---- crawling and looking. Drag to turn your head, hold still to crawl where you look (drag while holding
// to steer; crawl straight into a trunk and you climb it), tap anywhere to throw spores at the sight in the middle of the screen. Keys: W or up crawls (shift runs, C crouches, space hops), S or down backs off, A D or left right
// turn your head.
// climbing: the trunk you are on, the angle round it (atan2 of z, x) and the height over its foot
const me = { x: 0, z: 0, y: 0, speed: 0, side: 0, bob: 0, hop: 0, vy: 0, dip: 0, dipV: 0, crouch: 0, climb: null as null | { t: Trunk; phi: number; h: number } };
const CLIMB_MAX = 2; // a bit up the trunk: high enough to look down on the moss and the ferns, not into the haze
const look = { yaw: 0, pitch: 0.12, tYaw: 0, tPitch: 0.12 }; // a little up: the fern over you
const PITCH_MIN = -0.6, PITCH_MAX = 0.85; // up far enough to see under a cap, not past it
// on a trunk you can look straight down past your feet
const clampPitch = (v: number) => THREE.MathUtils.clamp(v, me.climb ? -1.45 : PITCH_MIN, PITCH_MAX);
let holding = false;
let backing = false; // a finger held low on the screen: crawl backwards
const autoWalk = params.has('walk'); // ?walk: crawls by itself, for clips
const keys = new Set<string>();
const target = document.querySelector<HTMLElement>('.target')!;
let down = false, dragging = false;
let downAt = 0, downX = 0, downY = 0, lastX = 0, lastY = 0;
let holdTimer = 0;
let charging = false; // a mouse held down: a throw wound up
let look0 = { yaw: 0, pitch: 0 }; // where you looked when the finger went down: a flick up gives the look back
// the pointer lock (desktop, the pill bottom centre or L): the mouse itself is the look, no drag; click throws,
// hold the button to fling at the sight
const locked = () => document.pointerLockElement === canvas;
const lockPill = document.querySelector<HTMLButtonElement>('.lockpill')!;
const lock = () => { if (!fungarium.isOpen) canvas.requestPointerLock?.(); };
lockPill.addEventListener('click', lock);
document.addEventListener('pointerlockchange', () => document.body.classList.toggle('locked', locked()));
// turning: a screen height of drag turns about twice the field of view; held and dragged off the spot where the
// finger went down, you also keep turning that way, faster the further out, so a hairpin needs no second swipe
const HOP = 1.3; // m/s up off the moss: about nine centimetres high
const DRAG_TURN = 2.2, STEER_RATE = 2.4, STEER_DEAD = 14;
canvas.addEventListener('pointerdown', (e) => {
  if (!locked()) try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
  down = true; dragging = false;
  downAt = performance.now(); downX = lastX = e.clientX; downY = lastY = e.clientY;
  look0 = { yaw: look.tYaw, pitch: look.tPitch };
  clearTimeout(holdTimer);
  // held without sliding: a finger crawls; a mouse winds up a throw at the sight, let go to fling it (the keys crawl)
  const mouse = e.pointerType === 'mouse';
  holdTimer = window.setTimeout(() => {
    if (!down || dragging) return;
    if (mouse) { charging = true; target.classList.add('charge'); } else { holding = true; backing = downY > innerHeight * 0.78; }
  }, 220);
});
canvas.addEventListener('pointermove', (e) => {
  if (locked()) {
    // locked: mouse right looks right, up looks up, as in a shooter
    const k = THREE.MathUtils.degToRad(camera.fov) / innerHeight * 1.6;
    look.tYaw -= e.movementX * k;
    look.tPitch = clampPitch(look.tPitch - e.movementY * k);
    return;
  }
  if (!down) return;
  if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) > 8) dragging = true;
  if (dragging) {
    const k = THREE.MathUtils.degToRad(camera.fov) / innerHeight * DRAG_TURN;
    // just looking you drag the world round; crawling you steer, so drag left and you turn left
    look.tYaw += (e.clientX - lastX) * k * (holding ? -1 : 1);
    // up and down the same as across: just looking, finger or mouse, you drag the world (up looks down; a mouse
    // pointing, up looking up, went against its own sideways drag); crawling, a finger steers: up looks up, as left
    // turns left
    const tilt = holding ? -1 : 1;
    look.tPitch = clampPitch(look.tPitch + (e.clientY - lastY) * k * tilt);
  }
  lastX = e.clientX; lastY = e.clientY;
});
const release = (e: PointerEvent) => {
  clearTimeout(holdTimer);
  const quick = performance.now() - downAt < 350;
  const tap = !holding && !dragging && !charging && quick;
  // a finger flicked up, quick and mostly straight: fling at the sight (and the look it dragged goes back)
  const dx = e.clientX - downX, dy = e.clientY - downY;
  const flick = e.pointerType !== 'mouse' && !holding && quick && dy < -40 && -dy > 1.5 * Math.abs(dx);
  if (flick) { look.tYaw = look0.yaw; look.tPitch = look0.pitch; }
  const fling = (charging || flick) && e.type === 'pointerup';
  down = false; holding = false; dragging = false; charging = false;
  target.classList.remove('charge');
  if (fling) throwAt();
  // a pinch sown where you clicked (locked, there is no pointer: at the sight)
  else if (tap && e.type === 'pointerup') { if (locked()) throwNear(); else throwNear(e.clientX, e.clientY); }
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
// gyro (phones): turning and tilting the phone turns your head, on top of dragging. iOS asks first, from a tap.
// the mute, top right (or M)
const muteButton = document.querySelector<HTMLButtonElement>('.mute')!;
const showMute = () => { muteButton.classList.toggle('muted', sound.muted); muteButton.setAttribute('aria-pressed', String(sound.muted)); muteButton.ariaLabel = sound.muted ? 'Unmute' : 'Mute'; };
const toggleMute = () => { sound.mute(!sound.muted); showMute(); };
muteButton.addEventListener('click', toggleMute);
addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat) toggleMute(); });
showMute();
const gyroButton = document.querySelector<HTMLButtonElement>('.gyro')!;
if (coarse) document.body.classList.add('touch');
let gyroOn = false;
let gyroLast: { yaw: number; pitch: number } | null = null;
// The phone's orientation as a quaternion (as three's old DeviceOrientationControls did), then the way its back
// camera points, and the heading and tilt of that. Read straight off the angles instead, the compass heading
// swung back and forth when the phone was held upright (gimbal lock), turning the view to and fro by itself.
const gyroEuler = new THREE.Euler(), gyroQ = new THREE.Quaternion(), gyroTurn = new THREE.Quaternion();
const GYRO_BACK = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // the camera looks out of the back, not the top
const gyroF = new THREE.Vector3();
function onTilt(e: DeviceOrientationEvent) {
  if (e.alpha === null || e.beta === null || e.gamma === null) return;
  const D = THREE.MathUtils.DEG2RAD;
  gyroEuler.set(e.beta * D, e.alpha * D, -e.gamma * D, 'YXZ');
  gyroQ.setFromEuler(gyroEuler).multiply(GYRO_BACK);
  gyroQ.multiply(gyroTurn.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -(screen.orientation?.angle ?? 0) * D));
  gyroF.set(0, 0, -1).applyQuaternion(gyroQ);
  const pitch = Math.asin(THREE.MathUtils.clamp(gyroF.y, -1, 1));
  const yaw = Math.atan2(-gyroF.x, -gyroF.z); // as look.yaw: forward is (-sin, -cos)
  if (gyroLast) {
    let dYaw = yaw - gyroLast.yaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    // looking near straight up or down the heading is undefined: let it go there
    if (Math.abs(pitch) < 1.35) look.tYaw += dYaw;
    look.tPitch = clampPitch(look.tPitch + (pitch - gyroLast.pitch));
  }
  gyroLast = { yaw, pitch };
}
gyroButton.addEventListener('click', async () => {
  if (gyroOn) {
    removeEventListener('deviceorientation', onTilt);
    gyroOn = false;
  } else {
    const ask = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (ask) {
      try { if ((await ask()) !== 'granted') return; } catch { return; }
    }
    gyroLast = null;
    addEventListener('deviceorientation', onTilt);
    gyroOn = true;
  }
  gyroButton.classList.toggle('on', gyroOn);
  gyroButton.setAttribute('aria-pressed', String(gyroOn));
});
addEventListener('keydown', (e) => { if (!fungarium.isOpen) keys.add(e.code); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); holding = false; down = false; });

/** Where a screen point's ray first meets the moss, or null. */
const ndc = new THREE.Vector2();
const rc = new THREE.Raycaster();
function groundAt(cx: number, cy: number) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  rc.setFromCamera(ndc, camera);
  const o = rc.ray.origin, d = rc.ray.direction;
  for (let t = 0.03; t < 7; t += t < 1 ? 0.008 : 0.03) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const g = groundHeight(x, z);
    if (y < g + 0.055 * mossAt(x, g, z)) return new THREE.Vector3(x, g, z);
  }
  return null;
}

// the fungarium: pick what your spores grow, and watch it grow up close (tap the packet, or F)
let throwKind: FungusKind = 'funnel';
const fungarium = new Fungarium((kind) => { throwKind = kind; pouch.pick(kind, false); });
// the pouch in hand: the same choice, with number keys, the wheel or a tap on it; shift and a number plants one
// tapped, the packet opens the fungarium (a little notebook sat bottom left for that, for a while)
const pouch = new Pouch((kind) => { throwKind = kind; fungarium.select(kind); }, plantAt, () => fungarium.isOpen, () => { keys.clear(); fungarium.toggle(); });
// the specimens are drawn once things have settled, on the fungarium's own little renderer
setTimeout(() => pouch.setThumbs(fungarium.drawThumbs()), 1500);
fungarium.onThumbs = () => pouch.setThumbs(fungarium.thumbs);
/** Shift and a number: that species' specimen pushes up where you aim (the middle of the screen without a mouse). */
function plantAt(s: Species) {
  const hit = aimAt(0.45);
  pouch.pick(s.kind, true);
  fungi.spawn(s.kind, hit.x, fungusFoot(hit.x, hit.z), hit.z, { seed: s.seed, scale: s.scale });
  dropOldest();
}
// What you grow stays, up to so many; past that the oldest withers away (back into the moss over sixteen seconds),
// one for each new one. (They withered on a timer for a while, a minute or two after growing.)
const KEEP = coarse ? 100 : 300;
function dropOldest() {
  const standing = fungi.list.filter((c) => !c.key && c.wither === undefined);
  for (const c of standing.slice(0, Math.max(0, standing.length - KEEP))) c.wither = c.age;
}
addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') { keys.clear(); if (locked()) document.exitPointerLock(); fungarium.toggle(); }
  if (e.code === 'KeyL' && !fungarium.isOpen && !coarse) { if (locked()) document.exitPointerLock(); else lock(); }
  // a hop: up off the moss and down again (from the moss, not off the bark)
  if (e.code === 'Space' && !fungarium.isOpen && !e.repeat) { e.preventDefault(); if (!me.climb && me.hop <= 0) me.vy = HOP; }
  if (e.code === 'Escape' && fungarium.isOpen) fungarium.close();
});
/** Where the sight in the middle of the screen lands: on the moss, or aimed over it, a couple of steps that way. */
function aimAt(far = 2.2) {
  const hit = groundAt(innerWidth / 2, innerHeight / 2);
  if (hit) return hit;
  const d = rc.ray.direction;
  const l = Math.hypot(d.x, d.z) || 1;
  const x = camera.position.x + (d.x / l) * far, z = camera.position.z + (d.z / l) * far;
  return new THREE.Vector3(x, groundHeight(x, z), z);
}
/** A pinch of spores sown where you click or tap: where that point's ray meets the moss, so they come up right
 * there; but never nearer than 45 cm (closer, they grew up out of focus) nor further than 1.6 m (not across the
 * forest): pulled in or pushed out along the same line of sight, so they stay under the pointer on screen. Into
 * the air it goes 1.6 m that way. */
function throwNear(cx = innerWidth / 2, cy = innerHeight / 2) {
  const hit = groundAt(cx, cy);
  const o = camera.position, r = rc.ray.direction; // groundAt aimed the ray through the point
  const h = Math.hypot(r.x, r.z) || 1;
  // how far along the line of sight, measured flat
  const d = hit ? Math.hypot(hit.x - o.x, hit.z - o.z) : Infinity;
  const D = THREE.MathUtils.clamp(d, 0.45, 1.6);
  const x = o.x + (r.x / h) * D, z = o.z + (r.z / h) * D;
  throwTo(new THREE.Vector3(x, groundHeight(x, z), z), false);
}
/** Flung at the sight, arcing over the moss like a grenade. */
function throwAt() { throwTo(aimAt(), true); }
function throwTo(hit: THREE.Vector3, far: boolean) {
  if (far) {
    target.classList.remove('fire');
    void target.offsetWidth; // restart the pulse
    target.classList.add('fire');
  }
  // not right at your own feet
  const fromCam = new THREE.Vector3(hit.x - camera.position.x, 0, hit.z - camera.position.z);
  if (fromCam.length() < 0.22) {
    fromCam.setLength(0.22);
    hit.set(camera.position.x + fromCam.x, 0, camera.position.z + fromCam.z);
    hit.y = groundHeight(hit.x, hit.z);
  }
  pouch.kick();
  // the slingshot lets fly either way; flung, the pinch leaves from its pouch, sown, it is let go in front of you
  sling.fire();
  const from = far ? sling.pouchWorld(camera) : camera.position.clone().add(new THREE.Vector3(0, -0.03, 0)).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 0.15);
  const kind = throwKind;
  const land = (p: THREE.Vector3, size: number) => {
    sound.puff(p, size);
    // the cloud settles first; then, one after another, they push up
    setTimeout(() => {
      fungi.spawn(kind, p.x, fungusFoot(p.x, p.z), p.z);
      dropOldest();
    }, 1200);
  };
  // sown: no throw, just a cloud let go there; flung: an arc over the moss and a burst where it lands
  if (far) {
    spores.throw(from, hit, (p) => land(p, 1));
    sound.whoosh(0.5 + from.distanceTo(hit) * 0.3); // as long as the flight
  }
  else {
    // the cloud is let go over the moss's top, not in it: down among the fronds it was hidden
    const g = groundHeight(hit.x, hit.z);
    spores.sow(new THREE.Vector3(hit.x, g + 0.055 * mossAt(hit.x, g, hit.z) + 0.035, hit.z));
    land(hit, 0.45);
  }
}

/** Distance to the first thing the view ray hits: the moss or a mushroom. The lens focuses there. */
const ray = new THREE.Vector3();
const FOCUS_FUNGI = 3; // only fungi this near are tried: past that the moss or a trunk is found anyway, and with
// hundreds sown, trying them all at every step of the ray was the cost
function focusDistance() {
  camera.getWorldDirection(ray);
  const o = camera.position;
  const nearFungi = fungi.list.filter((c) => Math.hypot(c.x - o.x, c.z - o.z) < FOCUS_FUNGI + c.radius);
  const nearTrunks = trees.trunks.filter((t) => Math.hypot(t.x - o.x, t.z - o.z) < 8 + t.r * 1.6);
  for (let t = 0.03; t < 8; t += t < 1 ? 0.01 : 0.04) {
    const x = o.x + ray.x * t, y = o.y + ray.y * t, z = o.z + ray.z * t;
    if (y < groundHeight(x, z) + 0.05) return t;
    if ((t < FOCUS_FUNGI && fungi.hit(x, y, z, nearFungi)) || trees.hit(x, y, z, nearTrunks)) return t;
  }
  return 8;
}

// Never quite still: a slow breath, the eye rising and falling a little and the head with it. Walking, the head
// looks about on its own, slowly this way and that and a little up and down, as one does going through a
// wood. Only the eye moves, not where you are or aim; none of it for those who ask for less motion.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
let breath = 0, roam = Math.random() * 100, roamW = 0;
let puffed = 0; // out of breath after a hop, fading
let stepAt = 0; // which footfall the gait is on
function alive(dt: number, walking: number) {
  if (still) return { yaw: 0, pitch: 0, up: 0 };
  const b0 = Math.sin(breath * 1.7);
  breath += dt;
  roam += dt;
  // heard too: in as the eye rises, out as it falls; deeper walking and for a while after a hop
  const b1 = Math.sin(breath * 1.7);
  if ((b0 < 0) !== (b1 < 0)) forest.breathe(b1 > 0, 0.6 + 0.6 * walking + puffed);
  roamW += (walking - roamW) * Math.min(1, dt * 1.5); // eases in and out, no snap when you stop
  const w = 1 - 0.5 * walking; // the breath is less with the walk carrying you
  return {
    yaw: (Math.sin(roam * 0.37) * 0.035 + Math.sin(roam * 0.17 + 2.0) * 0.025) * roamW,
    pitch: Math.sin(breath * 1.7) * 0.004 * w + Math.sin(roam * 0.29 + 1.0) * 0.015 * roamW,
    up: Math.sin(breath * 1.7 + 0.8) * 0.0006 * w,
  };
}

function crawl(dt: number) {
  const fwd = (keys.has('KeyW') || keys.has('ArrowUp') || (holding && !backing) || autoWalk ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') || (holding && backing) ? 0.5 : 0);
  const turn = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  // with the pointer locked the mouse turns, so A and D (and the side arrows) step sideways, as in a shooter
  const strafe = locked() && !me.climb ? -turn : 0;
  if (!strafe && !locked()) look.tYaw += turn * dt * 2.2;
  // held and dragged out sideways: keep turning that way, like a stick
  if (holding && !locked()) {
    const off = lastX - downX, out = Math.max(0, Math.abs(off) - STEER_DEAD) / (Math.min(innerWidth, innerHeight) * 0.3);
    look.tYaw -= Math.sign(off) * Math.min(1, out) * STEER_RATE * dt;
  }
  // C held: crouch, the eye down among the frond tips, creeping at half the pace; shift held: run, twice the pace
  const crouching = keys.has('KeyC') && !me.climb;
  me.crouch += ((crouching ? 1 : 0) - me.crouch) * Math.min(1, dt * 7);
  const run = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2 : 1) * (1 - 0.5 * me.crouch);
  me.speed += (fwd * 0.36 * run - me.speed) * Math.min(1, dt * 4);
  me.side += (strafe * 0.26 * run - me.side) * Math.min(1, dt * 4);
  const fx = -Math.sin(look.yaw), fz = -Math.cos(look.yaw); // you crawl where you look
  // two feet, a step each side: slower than an ant's patter, each step a little shove forward as it pushes off
  const pace = Math.hypot(me.speed, me.side);
  const walking = Math.min(1, pace / 0.2);
  me.bob += dt * (2 + 16 * pace);
  // a footfall each time the eye comes down, heard
  const stepNow = Math.floor(me.bob / Math.PI);
  if (stepNow !== stepAt) { if (walking > 0.25 && !me.climb && me.hop <= 0) forest.step(0.5 + 0.5 * walking, me.crouch, stepNow % 2 === 0); stepAt = stepNow; }
  puffed = Math.max(0, puffed - dt * 0.12);
  const shove = 1 + 0.35 * Math.sin(me.bob * 2) * walking;
  if (me.climb) climb(dt, fx, fz, me.speed * shove);
  else walk(dt, fx, fz, me.speed * shove);
  // eased a little: a head turning, not a mouse
  look.yaw += (look.tYaw - look.yaw) * Math.min(1, dt * 10);
  look.pitch += (look.tPitch - look.pitch) * Math.min(1, dt * 10);
  // on two feet: the eye lifts over each step and dips as the foot comes down (twice a stride), sways to the
  // side the weight is on and rolls a little with it, and the head nods with each footfall
  const heave = (Math.abs(Math.sin(me.bob)) - 0.64) * 0.005 * walking;
  const lean = Math.sin(me.bob) * walking;
  const a = alive(dt, walking);
  // a hop: thrown up, falling back; landing, the knees give a little and spring back
  if (me.hop > 0 || me.vy > 0) {
    me.vy -= 9.8 * dt;
    me.hop += me.vy * dt;
    if (me.hop <= 0) { me.dipV -= Math.min(0.35, -me.vy * 0.3); me.hop = 0; me.vy = 0; forest.step(1.6, me.crouch, true); forest.step(1.2, me.crouch, false); puffed = Math.min(1, puffed + 0.5); }
  }
  me.dipV += (-me.dip * 260 - me.dipV * 22) * dt;
  me.dip += me.dipV * dt;
  const sx = -fz, sz = fx; // your right
  const y = me.y + heave + a.up + me.hop + me.dip * 0.5 - me.crouch * 0.055;
  camera.position.set(me.x + sx * lean * 0.0025, y, me.z + sz * lean * 0.0025);
  camera.rotation.set(look.pitch + Math.sin(me.bob * 2 + 0.6) * 0.006 * walking + a.pitch, look.yaw + a.yaw, -lean * 0.012);
  camera.updateMatrixWorld();
  return { fx, fz };
}

/** On the ground: over the moss, round the stipes, and up a trunk if you crawl straight into one. */
function walk(dt: number, fx: number, fz: number, v: number) {
  me.x += fx * v * dt - fz * me.side * dt;
  me.z += fz * v * dt + fx * me.side * dt;
  // the tight bunch of stipes at a fern's crown is solid; the fronds you crawl under; small fungi you crawl over
  const [tx, tz] = trees.collide(me.x, me.z, 0.05);
  const [ox, oz] = oaks.collide(tx, tz, 0.05);
  const [cx, cz] = boulders.collide(ox, oz, 0.05);
  if (v > 0.05 && (cx !== me.x || cz !== me.z)) {
    // pushed off a trunk while crawling at it head on: start up it
    const t = trees.trunks.reduce((a, b) => (Math.hypot(b.x - me.x, b.z - me.z) - b.r < Math.hypot(a.x - me.x, a.z - me.z) - a.r ? b : a));
    const ox = cx - t.x, oz = cz - t.z, d = Math.hypot(ox, oz);
    // (not looking down: climbing down facing the bark lets you off without catching you again)
    if (-(fx * ox + fz * oz) / d > 0.75 && look.pitch > -0.35) me.climb = { t, phi: Math.atan2(oz, ox), h: me.y - trunkFoot(t) };
  }
  me.x = cx; me.z = cz;
  for (const c of ferns.crowns) {
    const dx = me.x - c.x, dz = me.z - c.z, d = Math.hypot(dx, dz), min = 0.05;
    if (d < min && d > 1e-6) { me.x = c.x + (dx / d) * min; me.z = c.z + (dz / d) * min; }
  }
  // a worm's eye: just over the moss, rising and falling with it, a slow heave while crawling
  const g = groundHeight(me.x, me.z);
  const ground = g + 0.055 * mossAt(me.x, g, me.z) + 0.11; // just over the frond tips
  me.y += (ground - me.y) * Math.min(1, dt * 6);
}

/**
 * On a trunk: you crawl over the bark where you look. Facing the trunk, forward is up; facing away, down; to
 * the side, round it. Looking up or down adds to it. Climb down to the moss and you are on the ground again.
 */
function climb(dt: number, fx: number, fz: number, v: number) {
  const c = me.climb!;
  const nx = Math.cos(c.phi), nz = Math.sin(c.phi); // out of the bark
  const cp = Math.cos(look.pitch), sp = Math.sin(look.pitch);
  let up = -(fx * nx + fz * nz) * cp + sp, round = (-fx * nz + fz * nx) * cp;
  const l = Math.hypot(up, round);
  if (l > 1) { up /= l; round /= l; }
  v *= 0.7; // slower up a trunk than over the moss
  c.h = Math.min(CLIMB_MAX, c.h + up * v * dt);
  const R = trunkRadius(c.t, c.phi, c.h) + 0.11; // the eye a worm's height off the bark
  c.phi += (round * v * dt) / R;
  const x = c.t.x + Math.cos(c.phi) * R, z = c.t.z + Math.sin(c.phi) * R, y = trunkFoot(c.t) + c.h;
  // eased onto the bark, so getting on is a move and not a jump
  const k = Math.min(1, dt * 10);
  me.x += (x - me.x) * k; me.z += (z - me.z) * k; me.y += (y - me.y) * k;
  // down at the moss: off the trunk
  const g = groundHeight(x, z);
  if (up * v < 0 && y < g + 0.055 * mossAt(x, g, z) + 0.11) {
    me.climb = null;
    look.tPitch = clampPitch(look.tPitch);
  }
}

// first build: everything in range before the first frame, so you do not start in a void
me.y = groundHeight(0, 0) + 0.055 * mossAt(0, groundHeight(0, 0), 0) + 0.11;
crawl(0);
while (world.update(me.x, me.z, 0, -1, 64) > 0);
for (let i = 0; i < 200 && props.update(me.x, me.z); i++);
for (let i = 0; i < 200 && ferns.update(me.x, me.z); i++);
trees.update(me.x, me.z);
for (let i = 0; i < 300 && floorBits.update(me.x, me.z); i++);
for (let i = 0; i < 40 && boulders.update(me.x, me.z); i++);
placeFarFloor(me.x, me.z);
// a few already standing in front of you when you arrive
fungi.spawn('funnel', 0.05, fungusFoot(0.05, -0.38), -0.38, { grown: true, seed: 11, scale: 1.1 });
fungi.spawn('finger', -0.16, fungusFoot(-0.16, -0.5), -0.5, { grown: true, seed: 5 });
renderShadow(new THREE.Vector3(0, 0, -1.5));

const clock = new THREE.Clock();
const sunScreen = new THREE.Vector3();
const camDir = new THREE.Vector3();
let focus = 1;
// dev: tuning handles in the console
if (import.meta.env.DEV) Object.assign(window, { renderShadow, foliage, oaks, boulders, floorBits, sound, forest, trees, ants, ferns, props, fungi, fungarium, spores, throwAt, shellMat, lensMat, atmosMat, camera, aoPass, lens, atmos, beautyRT, scene, renderer, composer, world, me, look });
// loading (as day 12's ink drawing): the splash, a card in the middle, over the forest drawn as a golden wire mesh
// (everything in its plain geometry, the moss's shells one sheet). Once the models are in and the picture's
// shaders compiled, and the card has been up two seconds and a half, the card goes and the picture fades in over
// the mesh's last frame. A tap on the card lets you in at once.
const splash = document.querySelector<HTMLElement>('.splash');
let loading = !!splash && !document.body.classList.contains('clean');
let revealNow = false;
const wireMat = new THREE.MeshBasicMaterial({ color: 0xe0b56c, wireframe: true, transparent: true, opacity: 0.08, depthWrite: true });
const WIRE_BG = new THREE.Color(0x120e08);
// (the mesh goes into the dark with distance, so it has depth)
const wireFog = new THREE.Fog(WIRE_BG, 0.4, 9);
if (!loading) { document.body.classList.remove('loading'); splash?.remove(); }
else {
  const shown = performance.now();
  splash!.addEventListener('pointerdown', (e) => { e.stopPropagation(); revealNow = true; });
  Promise.all([loadModels(), renderer.compileAsync(scene, camera).catch(() => {})])
    .then(() => setTimeout(() => { revealNow = true; }, Math.max(0, 2500 - (performance.now() - shown))));
}
/** the mesh drawn instead of the picture; on the last one, kept in a canvas over the page and faded out */
function drawWire() {
  scene.overrideMaterial = wireMat;
  scene.fog = wireFog;
  renderer.setClearColor(WIRE_BG);
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  scene.fog = null;
  renderer.setClearColor(BG);
  if (!revealNow) return;
  const snap = document.createElement('canvas');
  snap.className = 'wiresnap';
  snap.width = canvas.width; snap.height = canvas.height;
  snap.getContext('2d')!.drawImage(canvas, 0, 0); // (now, before the frame is handed on: no preserved buffer needed)
  document.body.append(snap);
  loading = false;
  document.body.classList.remove('loading');
  splash!.classList.add('gone');
  setTimeout(() => splash!.remove(), 1000);
  // the picture's first frames underneath first, then the mesh fades off them
  requestAnimationFrame(() => requestAnimationFrame(() => snap.classList.add('gone')));
  setTimeout(() => snap.remove(), 2000);
}

// the look panel: grade, depth of field, light and air
if (params.has('debug')) lookboard({ lens: lensMat, atmos: atmosMat, focus: focusHold, sun: { deg: THREE.MathUtils.radToDeg(SUN_UP), set: setSunHeight }, canopy: { canvas: foliage.canopyCanvas, box: foliage.canopyBox, camera, light: lightDir } });
// the vegetation panel: each kind taken away to see what it does
if (params.has('debug')) vegboard([
  { name: 'pine, spruce trunks', objects: trees.levels },
  { name: 'pine, spruce boughs', objects: [foliage.boughs, foliage.model] },
  { name: 'birch trunks', objects: trees.birches },
  { name: 'birch leaves', objects: [foliage.leaves] },
  { name: 'oaks', objects: [oaks.root] },
  { name: 'ferns', objects: [ferns.root] },
  { name: 'fungi', objects: [fungi.group] },
  { name: 'boulders', objects: [boulders.root] },
  { name: 'leaves, sorrel', objects: [floorBits.root] },
], () => shadowCentre.set(Infinity, 0, 0), [
  // to the nearest oak, a crown's width off on its sunny side, looking up at it
  { label: 'go to oak', run: () => {
    const o = oaks.oaks.slice().sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
    if (!o) return;
    const a = Math.atan2(lightDir.z, lightDir.x);
    me.x = o.x + Math.cos(a) * 12 * o.s; me.z = o.z + Math.sin(a) * 12 * o.s;
    look.yaw = look.tYaw = Math.atan2(-(o.x - me.x), -(o.z - me.z)); look.pitch = look.tPitch = 0.4;
  } },
]);

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  shellMat.uniforms.uTime.value = clock.elapsedTime;
  const { fx, fz } = crawl(dt);
  pouch.update(dt, me.bob, Math.min(1, Math.abs(me.speed) / 0.2));
  fungi.update(dt, clock.elapsedTime, me.x, me.z);
  // the ones growing near you creak now and then, each kind in its own voice
  // (unevenly: each waits a random while, long or short, and now and then two or three come in a run)
  const tNow = clock.elapsedTime;
  for (const c of fungi.list) {
    if (c.grown || c.age <= 0) continue;
    const g = c.age / c.end;
    if (g < 0.03 || g > 0.97) continue;
    const next = creakNext.get(c);
    if (next === undefined) { creakNext.set(c, tNow + Math.random() * 1.5); continue; }
    if (tNow < next) continue;
    creakAt.set(c.x, c.y + c.height * 0.5, c.z);
    sound.creak(creakAt, c.kind);
    const burst = Math.random() < 0.3;
    creakNext.set(c, tNow + (burst ? 0.12 + 0.3 * Math.random() : -Math.log(1 - Math.random()) * 1.3 + 0.15));
  }
  spores.update(dt, clock.elapsedTime);
  dust.update(groundHeight(me.x, me.z));
  motes.update(groundHeight(me.x, me.z));
  world.update(me.x, me.z, fx, fz, 1);
  props.update(me.x, me.z);
  ferns.update(me.x, me.z, dt);
  trees.update(me.x, me.z);
  oaks.update(me.x, me.z);
  foliage.update(trees.trunks, camera.position);
  floorBits.update(me.x, me.z);
  boulders.update(me.x, me.z);
  ants.update(dt, me.x, me.z, trees.trunks);
  placeFarFloor(me.x, me.z);
  // the shadow map follows a point ahead of you
  const centre = new THREE.Vector3(me.x + fx * 1.4, me.y, me.z + fz * 1.4);
  const now = performance.now();
  // only when you have moved, or something near grew or arrived: new moss far off does not change it
  if ((centre.distanceTo(shadowCentre) > 0.35 || fungi.changed || ferns.changed) && now - lastShadow > (coarse ? 450 : 250)) {
    renderShadow(centre);
    world.changed = false;
    fungi.changed = false;
    ferns.changed = false;
    trees.changed = false;
    lastShadow = now;
  }
  // autofocus on whatever is straight ahead, eased like a lens hunting a little
  focus += (focusDistance() - focus) * Math.min(1, dt * 5);
  lensMat.uniforms.uFocus.value = focusHold.hold ? focusHold.at : focus;
  atmosMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
  atmosMat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
  atmosMat.uniforms.uTime.value = shellMat.uniforms.uTime.value;
  // where the sun is on screen, for the shafts; they fade out as it goes behind you
  sunScreen.copy(camera.position).addScaledVector(lightDir, 50).project(camera);
  atmosMat.uniforms.uSunUv.value.set(sunScreen.x * 0.5 + 0.5, sunScreen.y * 0.5 + 0.5);
  atmosMat.uniforms.uSunOn.value = THREE.MathUtils.smoothstep(camera.getWorldDirection(camDir).dot(lightDir), 0.0, 0.5);
  atmosMat.uniforms.uAspect.value = camera.aspect;
  atmosMat.uniforms.uGroundY.value = groundHeight(me.x, me.z);
  if (loading) { drawWire(); forest.update(dt); return; }
  renderer.setRenderTarget(beautyRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  composer.render();
  sling.visible = !fungarium.isOpen && !document.body.classList.contains('clean');
  if (throwKind !== slingKind) { slingKind = throwKind; sling.swap(); } // other spores: down and up with them
  sling.update(dt, camera, lightDir, charging, me.bob, Math.min(1, Math.hypot(me.speed, me.side) / 0.2), look.yaw, look.pitch);
  sling.render(renderer);
  forest.update(dt);
});
