// 16 / Spore — crawl over an endless moss carpet with a worm's eye. Day 05's moss (shell undercoat plus
// instanced fronds) on a forest floor built in chunks around you, under a low sun through the canopy.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { TexturePass } from 'three/addons/postprocessing/TexturePass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { shellVertex, shellFragment, mossLighting } from './shaders';
import { World, groundHeight, mossAt, type WorldHooks } from './world';
import { Props } from './props';
import { Ferns } from './ferns';
import { Trees } from './trees';
import { makeDewMaterial } from './dew';
import { makeAtmosPass, makeLensPass } from './post';
import { Fungi, type FungusKind } from './fungi';
import { Spores } from './spores';
import { Fungarium } from './fungarium';
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
const lightDir = new THREE.Vector3(0.45, 0.16, -0.88).normalize();
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
    uShadowFloor: { value: 0.14 },
    uTime: { value: 0 },
  },
});
const SHARED_UNIFORMS = ['uCavityAO', 'uLightDir', 'uLightDirC', 'uRimDir', 'uRim', 'uHemi', 'uTone', 'uExposure', 'toneMappingExposure', 'uShadowMap', 'uShadowMatrix', 'uShadowOn', 'uShadowFloor', 'uTime'];
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
const fungi = new Fungi(share);
scene.add(fungi.group);
// the spore smoke is drawn after the atmosphere, in a scene of its own (see the render chain)
const spores = new Spores(share);
const fxScene = new THREE.Scene();
fxScene.add(spores.mesh);
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
    p.setXYZ(i, x, groundHeight(x, z) - 0.03, z);
  }
  p.needsUpdate = true;
  farGeo.computeVertexNormals();
}

// ---- shadow map: the patch ahead of you from the sun. Re-rendered as you crawl, without the fronds and spore
// stalks, which are too small to matter in it and most of its cost.
const SHADOW_SIZE = 4096;
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
  world.forShadow(true, centre.x, centre.z, 4.3);
  ferns.forShadow(true, centre.x, centre.z, 6);
  farFloor.visible = false;
  renderer.setRenderTarget(shadowRT);
  renderer.clear();
  renderer.render(scene, lightCam);
  renderer.setRenderTarget(null);
  world.forShadow(false);
  ferns.forShadow(false);
  farFloor.visible = true;
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
// thick forest air: a worm cannot see far anyway
atmosMat.uniforms.uFog.value = 0.3; // the air: trunks fade out a few steps away
atmosMat.uniforms.uMist.value = 0.9; // and a mist lying on the moss, glowing towards the sun
const atmos = new ShaderPass(atmosMat);
composer.addPass(atmos);
// spore smoke into the finished, hazy image: its own lighter haze keeps a column visible from far off
spores.material.uniforms.tDepth.value = beautyRT.depthTexture;
spores.material.uniforms.cameraNear.value = camera.near;
const fx = new RenderPass(fxScene, camera);
fx.clear = false;
composer.addPass(fx);
const lensMat = makeLensPass(coarse);
lensMat.uniforms.uAperture.value = 0.22; // macro: a thin slice in focus, but the moss right in front still reads
const lens = new ShaderPass(lensMat);
composer.addPass(lens);
composer.addPass(new OutputPass());

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
  (dewMaterial as THREE.ShaderMaterial).uniforms.uPx.value = px.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}
addEventListener('resize', resize);
resize();

// ---- crawling and looking. Drag to turn your head, hold still to crawl where you look (drag while holding
// to steer), tap anywhere to throw spores at the sight in the middle of the screen. Space throws too. Keys: W or up crawls, S or down backs off, A D or left right
// turn your head.
const me = { x: 0, z: 0, y: 0, speed: 0, bob: 0 };
const look = { yaw: 0, pitch: 0.12, tYaw: 0, tPitch: 0.12 }; // a little up: the fern over you
const PITCH_MIN = -0.6, PITCH_MAX = 0.85; // up far enough to see under a cap, not past it
let holding = false;
const autoWalk = params.has('walk'); // ?walk: crawls by itself, for clips
const keys = new Set<string>();
const target = document.querySelector<HTMLElement>('.target')!;
let down = false, dragging = false;
let downAt = 0, downX = 0, downY = 0, lastX = 0, lastY = 0;
let holdTimer = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  down = true; dragging = false;
  downAt = performance.now(); downX = lastX = e.clientX; downY = lastY = e.clientY;
  clearTimeout(holdTimer);
  // held without sliding: crawl
  holdTimer = window.setTimeout(() => { if (down && !dragging) holding = true; }, 220);
});
canvas.addEventListener('pointermove', (e) => {
  if (!down) return;
  if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) > 8) dragging = true;
  if (dragging) {
    // turn the head: about a screen height of drag for a field of view of turn
    const k = THREE.MathUtils.degToRad(camera.fov) / innerHeight * 1.2;
    // just looking you drag the world round; crawling you steer, so drag left and you turn left
    look.tYaw += (e.clientX - lastX) * k * (holding ? -1 : 1);
    look.tPitch = THREE.MathUtils.clamp(look.tPitch + (e.clientY - lastY) * k, PITCH_MIN, PITCH_MAX);
  }
  lastX = e.clientX; lastY = e.clientY;
});
const release = (e: PointerEvent) => {
  clearTimeout(holdTimer);
  const tap = !holding && !dragging && performance.now() - downAt < 350;
  down = false; holding = false; dragging = false;
  if (tap && e.type === 'pointerup') throwAt();
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
// gyro (phones): turning and tilting the phone turns your head, on top of dragging. iOS asks first, from a tap.
const gyroButton = document.querySelector<HTMLButtonElement>('.gyro')!;
if (coarse) document.body.classList.add('touch');
let gyroOn = false;
let gyroLast: { yaw: number; pitch: number } | null = null;
function onTilt(e: DeviceOrientationEvent) {
  if (e.alpha === null || e.beta === null || e.gamma === null) return;
  // pitch in the screen's terms, whichever way the phone is turned; yaw from the compass heading
  const angle = screen.orientation?.angle ?? 0;
  const pitch = angle === 90 ? -e.gamma : angle === 270 ? e.gamma : angle === 180 ? -e.beta : e.beta;
  const yaw = e.alpha;
  if (gyroLast) {
    let dYaw = yaw - gyroLast.yaw;
    if (dYaw > 180) dYaw -= 360;
    if (dYaw < -180) dYaw += 360;
    let dPitch = pitch - gyroLast.pitch;
    if (Math.abs(dPitch) > 90) dPitch = 0; // a flip through the vertical, not a real move
    look.tYaw += dYaw * THREE.MathUtils.DEG2RAD;
    look.tPitch = THREE.MathUtils.clamp(look.tPitch + dPitch * THREE.MathUtils.DEG2RAD, PITCH_MIN, PITCH_MAX);
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

// the fungarium: pick what your spores grow, and watch it grow up close (the button top right, or F)
let throwKind: FungusKind = 'funnel';
const fungarium = new Fungarium((kind) => { throwKind = kind; });
function dropOldest() {
  // only so many: the oldest thrown ones go
  const thrown = fungi.list.filter((c) => !c.key);
  for (const c of thrown.slice(0, Math.max(0, thrown.length - 24))) fungi.remove(c);
}
document.querySelector('.book')!.addEventListener('click', () => { keys.clear(); fungarium.toggle(); });
addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') { keys.clear(); fungarium.toggle(); }
  if (e.code === 'Space' && !fungarium.isOpen && !e.repeat) { e.preventDefault(); throwAt(); }
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
function throwAt() {
  const hit = aimAt();
  target.classList.remove('fire');
  void target.offsetWidth; // restart the pulse
  target.classList.add('fire');
  // tapping a ripe puffball presses it, and it puffs its spores, instead of throwing
  const pressed = fungi.press(hit.x, hit.z, 0.03);
  if (pressed) { spores.puff(pressed); return; }
  // not right at your own feet
  const fromCam = new THREE.Vector3(hit.x - camera.position.x, 0, hit.z - camera.position.z);
  if (fromCam.length() < 0.22) {
    fromCam.setLength(0.22);
    hit.set(camera.position.x + fromCam.x, 0, camera.position.z + fromCam.z);
    hit.y = groundHeight(hit.x, hit.z);
  }
  const from = camera.position.clone().add(new THREE.Vector3(0, -0.03, 0)).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 0.15);
  const kind = throwKind;
  spores.throw(from, hit, (p) => {
    // the cloud settles first; then, one after another, they push up
    setTimeout(() => {
      fungi.spawn(kind, p.x, fungusFoot(p.x, p.z), p.z);
      dropOldest();
    }, 1200);
  });
}

/** Distance to the first thing the view ray hits: the moss or a mushroom. The lens focuses there. */
const ray = new THREE.Vector3();
function focusDistance() {
  camera.getWorldDirection(ray);
  const o = camera.position;
  for (let t = 0.03; t < 8; t += t < 1 ? 0.01 : 0.04) {
    const x = o.x + ray.x * t, y = o.y + ray.y * t, z = o.z + ray.z * t;
    if (y < groundHeight(x, z) + 0.05) return t;
    if (fungi.hit(x, y, z) || trees.hit(x, y, z)) return t;
  }
  return 8;
}

function crawl(dt: number) {
  const fwd = (keys.has('KeyW') || keys.has('ArrowUp') || holding || autoWalk ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 0.5 : 0);
  const turn = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  look.tYaw += turn * dt * 1.1;
  me.speed += (fwd * 0.36 - me.speed) * Math.min(1, dt * 4);
  const fx = -Math.sin(look.yaw), fz = -Math.cos(look.yaw); // you crawl where you look
  // six legs, three down at a time (a tripod gait): no lumbering, a quick even patter, each set of three
  // giving a little shove forward as it pushes off
  const walking = Math.min(1, Math.abs(me.speed) / 0.2);
  me.bob += dt * (5 + 30 * Math.abs(me.speed));
  const shove = 1 + 0.35 * Math.sin(me.bob * 2) * walking;
  me.x += fx * me.speed * shove * dt;
  me.z += fz * me.speed * shove * dt;
  // the tight bunch of stipes at a fern's crown is solid; the fronds you crawl under; small fungi you crawl over,
  // and a puffball you crawl into puffs
  const bumped = fungi.press(me.x + fx * 0.06, me.z + fz * 0.06, 0.02);
  if (bumped) spores.puff(bumped);
  [me.x, me.z] = trees.collide(me.x, me.z, 0.05);
  for (const c of ferns.crowns) {
    const dx = me.x - c.x, dz = me.z - c.z, d = Math.hypot(dx, dz), min = 0.05;
    if (d < min && d > 1e-6) { me.x = c.x + (dx / d) * min; me.z = c.z + (dz / d) * min; }
  }
  // a worm's eye: just over the moss, rising and falling with it, a slow heave while crawling
  const g = groundHeight(me.x, me.z);
  const ground = g + 0.055 * mossAt(me.x, g, me.z) + 0.11; // just over the frond tips
  me.y += (ground - me.y) * Math.min(1, dt * 6);
  // eased a little: a head turning, not a mouse
  look.yaw += (look.tYaw - look.yaw) * Math.min(1, dt * 10);
  look.pitch += (look.tPitch - look.pitch) * Math.min(1, dt * 10);
  // a body slung between six legs: a small quick tick up each push-off, a slight rock from one tripod to the other
  const heave = (Math.abs(Math.sin(me.bob)) - 0.64) * 0.0018 * walking;
  camera.position.set(me.x, me.y + heave, me.z);
  camera.rotation.set(look.pitch + Math.sin(me.bob * 2 + 0.6) * 0.0035 * walking, look.yaw, Math.sin(me.bob) * 0.004 * walking);
  camera.updateMatrixWorld();
  return { fx, fz };
}

// first build: everything in range before the first frame, so you do not start in a void
me.y = groundHeight(0, 0) + 0.055 * mossAt(0, groundHeight(0, 0), 0) + 0.11;
crawl(0);
while (world.update(me.x, me.z, 0, -1, 64) > 0);
for (let i = 0; i < 200 && props.update(me.x, me.z); i++);
for (let i = 0; i < 200 && ferns.update(me.x, me.z); i++);
trees.update(me.x, me.z);
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
if (import.meta.env.DEV) Object.assign(window, { trees, ferns, props, fungi, spores, throwAt, shellMat, lensMat, atmosMat, camera, aoPass, lens, atmos, beautyRT, scene, renderer, composer, world, me, look });
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  shellMat.uniforms.uTime.value = clock.elapsedTime;
  const { fx, fz } = crawl(dt);
  fungi.update(dt, clock.elapsedTime);
  spores.update(dt, clock.elapsedTime);
  world.update(me.x, me.z, fx, fz, 1);
  props.update(me.x, me.z);
  ferns.update(me.x, me.z);
  trees.update(me.x, me.z);
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
  lensMat.uniforms.uFocus.value = focus;
  atmosMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
  atmosMat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
  atmosMat.uniforms.uTime.value = shellMat.uniforms.uTime.value;
  // where the sun is on screen, for the shafts; they fade out as it goes behind you
  sunScreen.copy(camera.position).addScaledVector(lightDir, 50).project(camera);
  atmosMat.uniforms.uSunUv.value.set(sunScreen.x * 0.5 + 0.5, sunScreen.y * 0.5 + 0.5);
  atmosMat.uniforms.uSunOn.value = THREE.MathUtils.smoothstep(camera.getWorldDirection(camDir).dot(lightDir), 0.0, 0.5);
  atmosMat.uniforms.uAspect.value = camera.aspect;
  renderer.setRenderTarget(beautyRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  composer.render();
});
