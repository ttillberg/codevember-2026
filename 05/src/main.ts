// 05 / Moss — paint moss on a big M. Shell-textured undercoat plus instanced fronds.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildRock, type Surface } from './rock';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWord } from './objects';
import { FontLoader, type Font } from 'three/addons/loaders/FontLoader.js';
import { buildFronds, type Fronds } from './fronds';
import { fbm3 } from './noise';
import { shellVertex, shellFragment, groundVertex, groundFragment } from './shaders';
import { renderSwatches, renderEraser } from './swatches';
import { setupCarousel, type Carousel } from './carousel';

const coarse = matchMedia('(pointer: coarse)').matches;
const SHELLS = coarse ? 10 : 16;
const SPECIES = 4;
const BG = new THREE.Color(0xe6e6e3);

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(BG);

const scene = new THREE.Scene();
// a studio environment for the metal rock's reflections; the moss has its own shading
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
camera.position.set(3.6, 1.1, 6.6);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.45, 0);
controls.enableDamping = true;
controls.enableZoom = false; // orbit only, the framing is the framing
controls.enablePan = false;
controls.maxPolarAngle = Math.PI * 0.55;

const lightDir = new THREE.Vector3(1.2, 2.0, 1.0).normalize();
const shellMat = new THREE.ShaderMaterial({
  vertexShader: shellVertex,
  fragmentShader: shellFragment,
  defines: { SHELLS },
  uniforms: {
    uHeight: { value: 0.012 },
    uBulge: { value: 0.035 },
    uTime: { value: 0 },
    uLightDir: { value: lightDir },
    uHideRock: { value: 0 },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowOn: { value: 0 },
  },
});

// ---- shadow map: the scene from the light's point of view, rendered when the word changes.
// Letters shadow each other and the moss under overhangs; that is most of the contrast.
const SHADOW_SIZE = 2048;
const shadowRT = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, {
  depthTexture: new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE, THREE.UnsignedIntType),
});
const lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
const shadowMatrix = new THREE.Matrix4();
function renderShadow() {
  const bb = W.surface.geometry.boundingBox!;
  const center = new THREE.Vector3((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2);
  const radius = bb.min.distanceTo(bb.max) / 2 + 0.3;
  lightCam.left = -radius; lightCam.right = radius; lightCam.top = radius; lightCam.bottom = -radius;
  lightCam.near = 0.1; lightCam.far = radius * 4;
  lightCam.position.copy(center).addScaledVector(lightDir, radius * 2);
  lightCam.lookAt(center);
  lightCam.updateProjectionMatrix();
  lightCam.updateMatrixWorld();
  shadowMatrix.multiplyMatrices(lightCam.projectionMatrix, lightCam.matrixWorldInverse);

  // unbind the shadow map while rendering into it, or the GPU complains about a feedback loop
  const mats = [shellMat, W.fronds.mesh.material as THREE.ShaderMaterial];
  for (const mat of mats) { mat.uniforms.uShadowOn.value = 0; mat.uniforms.uShadowMap.value = null; }
  ground.visible = false;
  renderer.setRenderTarget(shadowRT);
  renderer.clear();
  renderer.render(scene, lightCam);
  renderer.setRenderTarget(null);
  ground.visible = true;

  for (const mat of mats) {
    mat.uniforms.uShadowMap.value = shadowRT.depthTexture;
    mat.uniforms.uShadowMatrix.value.copy(shadowMatrix);
    mat.uniforms.uShadowOn.value = 1;
  }
}

// ground with a fake contact shadow
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.ShaderMaterial({ vertexShader: groundVertex, fragmentShader: groundFragment, uniforms: { uBg: { value: BG } } }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.72;
scene.add(ground);

// ---- the thing being painted, and its moss state. Swappable.
interface World {
  surface: Surface;
  n: number;
  positions: THREE.BufferAttribute;
  normals: THREE.BufferAttribute;
  moss: Float32Array;
  cap: Float32Array; // how far each vertex may mature: set by the brush profile
  species: Float32Array; // 4 weights per vertex, soft mixes
  puff: Float32Array; // extra height from repeated brushing, a damped spring toward puffTarget
  puffVel: Float32Array;
  puffTarget: Float32Array;
  puffAttr: THREE.BufferAttribute;
  pillow: Float32Array; // live copy of the surface's pillow field, rearranged by the brush
  pillowAttr: THREE.BufferAttribute;
  mossAttr: THREE.BufferAttribute;
  speciesAttr: THREE.BufferAttribute;
  shells: THREE.InstancedMesh;
  fronds: Fronds;
  picker: THREE.Mesh;
  kind: 'word' | 'rock';
  metal: THREE.Mesh | null; // the silver rock body, drawn where there is no moss
}

function createWorld(text: string, kind: 'word' | 'rock' = 'word'): World {
  const surface = kind === 'rock' ? buildRock(7, 3, coarse ? 2 : 3) : buildWord(text, font, coarse ? 1 : 2);
  const geo = surface.geometry;
  const n = geo.attributes.position.count;
  const moss = new Float32Array(n);
  const cap = new Float32Array(n);
  const species = new Float32Array(n * SPECIES);
  const mossAttr = new THREE.BufferAttribute(moss, 1);
  mossAttr.setUsage(THREE.DynamicDrawUsage);
  const speciesAttr = new THREE.BufferAttribute(species, SPECIES);
  speciesAttr.setUsage(THREE.DynamicDrawUsage);
  const puff = new Float32Array(n);
  const puffVel = new Float32Array(n);
  const puffTarget = new Float32Array(n);
  const puffAttr = new THREE.BufferAttribute(puff, 1);
  puffAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('puff', puffAttr);
  geo.setAttribute('moss', mossAttr);
  geo.setAttribute('speciesW', speciesAttr);
  geo.setAttribute('dead', new THREE.BufferAttribute(surface.dead, 1));
  const pillow = Float32Array.from(surface.pillow);
  const pillowAttr = new THREE.BufferAttribute(pillow, 1);
  pillowAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('pillow', pillowAttr);

  const shells = new THREE.InstancedMesh(geo, shellMat, SHELLS);
  shells.frustumCulled = false;
  const fronds = buildFronds(geo, surface.fertility, coarse ? 40000 : 140000);
  const picker = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
  scene.add(shells, fronds.mesh, picker);
  let metal: THREE.Mesh | null = null;
  if (kind === 'rock') {
    metal = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xe4e4e2, metalness: 1, roughness: 0.22, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }),
    );
    scene.add(metal);
  }
  // with a metal body the shell base only draws under moss
  shellMat.uniforms.uHideRock.value = metal ? 1 : 0;

  return {
    surface, n,
    positions: geo.attributes.position as THREE.BufferAttribute,
    normals: geo.attributes.normal as THREE.BufferAttribute,
    moss, cap, species, puff, puffVel, puffTarget, puffAttr, pillow, pillowAttr, mossAttr, speciesAttr, shells, fronds, picker, kind, metal,
  };
}

function destroyWorld(w: World) {
  scene.remove(w.shells, w.fronds.mesh, w.picker);
  if (w.metal) { scene.remove(w.metal); (w.metal.material as THREE.Material).dispose(); }
  w.surface.geometry.dispose();
  w.fronds.mesh.geometry.dispose();
  (w.fronds.mesh.material as THREE.Material).dispose();
  w.fronds.ageTexture.dispose();
  w.fronds.puffTexture.dispose();
  (w.picker.material as THREE.Material).dispose();
}

// the font is tiny and local, load it before anything else
const font: Font = await new FontLoader().loadAsync(`${import.meta.env.BASE_URL}fonts/helvetiker_bold.typeface.json`);
// Helvetica's M runs its middle vertex all the way to the baseline, which turns into a heavy V once
// the letter is rounded. Lift the flat bottom of the V and the notch above it by the same amount.
{
  const lift = 300;
  const M = (font.data as { glyphs: Record<string, { o: string }> }).glyphs['M'];
  M.o = M.o
    .replace('l 618 0', `l 618 ${lift}`)
    .replace('l 402 0', `l 402 ${lift}`)
    .replace('l 510 241', `l 510 ${241 + lift}`);
}
let pillowDirty = true;
let W = createWorld('M');
let dirty = true;

// ---- species weights
function setOneHot(i: number, k: number) {
  for (let c = 0; c < SPECIES; c++) W.species[i * SPECIES + c] = c === k ? 1 : 0;
}
function addWeight(i: number, k: number, amount: number) {
  const o = i * SPECIES;
  let sum = 0;
  for (let c = 0; c < SPECIES; c++) sum += W.species[o + c];
  if (sum === 0) { setOneHot(i, k); return; }
  W.species[o + k] += amount;
  sum += amount;
  for (let c = 0; c < SPECIES; c++) W.species[o + c] /= sum;
}
function addWeights(i: number, wgt: Float32Array, amount: number) {
  const o = i * SPECIES;
  let sum = 0;
  for (let c = 0; c < SPECIES; c++) sum += W.species[o + c];
  let wsum = 0;
  for (let c = 0; c < SPECIES; c++) wsum += wgt[c];
  if (wsum <= 0) return;
  for (let c = 0; c < SPECIES; c++) W.species[o + c] += (wgt[c] / wsum) * amount;
  sum += amount;
  for (let c = 0; c < SPECIES; c++) W.species[o + c] /= sum;
}

// ---- auto brush: picks species by normal, speed, time and a bit of luck
let currentSpecies = -1; // -1 = auto
const strokeBias = new Float32Array(SPECIES); // rolled per stroke
const strokeShift = new THREE.Vector3(); // noise offset for rearranging mounds, rolled per stroke
let speed = 0; // smoothed pointer speed, px per second
let lastX = 0, lastY = 0, lastT = 0;
const autoW = new Float32Array(SPECIES);
const vn = new THREE.Vector3();
const tmp = new THREE.Vector3();

function autoWeights(i: number, out: Float32Array) {
  vn.fromBufferAttribute(W.normals, i);
  tmp.fromBufferAttribute(W.positions, i);
  const up = vn.y;
  const slow = 1 - Math.min(1, speed / 1400);
  const drift = Math.sin(performance.now() * 0.0003) * 0.5 + 0.5;
  const lichenField = THREE.MathUtils.smoothstep(fbm3(tmp.x * 2.5, tmp.y * 2.5, tmp.z * 2.5, 3, 77), 0.05, 0.35);
  // feather: the baseline, likes sides and medium speed
  out[0] = (0.5 + 0.5 * strokeBias[0]) * (0.6 + 0.4 * (1 - slow)) * (0.6 + 0.4 * (1 - drift));
  // star: shade lover, undersides and sides
  out[1] = (0.4 + 0.6 * strokeBias[1]) * THREE.MathUtils.smoothstep(0.6 - up, 0.2, 1.0);
  // lichen: exposed spots in its own field, favours fast light strokes
  out[2] = (0.3 + 0.7 * strokeBias[2]) * lichenField * (0.4 + 0.6 * (1 - slow)) * THREE.MathUtils.smoothstep(up, -0.2, 0.5);
  // cushion: tops, slow lingering strokes, and the time drift
  out[3] = (0.4 + 0.6 * strokeBias[3]) * THREE.MathUtils.smoothstep(up, 0.1, 0.8) * (0.3 + 0.7 * slow) * (0.5 + 0.5 * drift);
}

// ---- painting
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let painting = false;
let scraping = false;
let brushRadius = 0.24; // medium by default
const BRUSH_MIN = 0.06;
const BRUSH_MAX = 0.5;

function pick(e: PointerEvent) {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(W.picker, false)[0];
  return hit?.point ?? null;
}

function brush(point: THREE.Vector3, scrape: boolean) {
  const { moss, cap, positions, surface } = W;
  const r = scrape ? brushRadius * 1.35 : brushRadius;
  const r2 = r * r;
  for (let i = 0; i < W.n; i++) {
    tmp.fromBufferAttribute(positions, i);
    const d2 = tmp.distanceToSquared(point);
    if (d2 > r2) continue;
    const falloff = 1 - d2 / r2;
    if (scrape) {
      moss[i] = Math.max(0, moss[i] - falloff * 0.5);
      cap[i] = Math.max(0, cap[i] - falloff * 0.5);
      W.puffTarget[i] = Math.max(0, W.puffTarget[i] - falloff * 0.4);
      if (moss[i] < 0.03) { moss[i] = 0; cap[i] = 0; W.puffTarget[i] = 0; }
    } else if (surface.fertility[i] > 0.05) {
      // brushing over moss that is already there: the mounds rearrange a little under the brush
      // (a per-stroke noise offset shifts the pillow field) and the surface gives a small bounce
      if (moss[i] > 0.2) {
        const shift = fbm3(tmp.x * 9 + strokeShift.x, tmp.y * 9 + strokeShift.y, tmp.z * 9 + strokeShift.z, 2, 5);
        W.pillow[i] = THREE.MathUtils.clamp(W.pillow[i] + shift * falloff * 0.12, 0, 1);
        W.puffTarget[i] = Math.min(0.3, W.puffTarget[i] + falloff * 0.02);
        W.puffVel[i] += falloff * 0.5;
        pillowDirty = true;
      }
      // slow strokes press in thick moss, fast ones leave it thin
      const thick = currentSpecies < 0 ? 0.55 + 0.45 * (1 - Math.min(1, speed / 1400)) : 1;
      cap[i] = Math.max(cap[i], (0.1 + 0.9 * falloff) * thick);
      // start at 75% of the cap: skips the sparse seedling stage, only the last bit grows in
      moss[i] = Math.max(moss[i], cap[i] * 0.75);
      if (currentSpecies < 0) {
        autoWeights(i, autoW);
        addWeights(i, autoW, falloff * 0.5);
      } else {
        addWeight(i, currentSpecies, falloff * 0.5);
      }
    }
  }
  dirty = true;
}

// ---- brush size: cmd/ctrl + drag sideways, with a ring showing the size
const sizeRing = document.querySelector<HTMLElement>('.size-ring')!;
let sizing = false;
let sizeStartX = 0;
let sizeStartY = 0;
let sizeStartR = 0;
let sizeAnchor: THREE.Vector3 | null = null;
function showRing(point: THREE.Vector3, r: number, x: number, y: number) {
  const d = camera.position.distanceTo(point);
  const px = (r / (d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * (innerHeight / 2);
  sizeRing.style.display = 'block';
  sizeRing.style.width = sizeRing.style.height = `${px * 2}px`;
  sizeRing.style.left = `${x}px`;
  sizeRing.style.top = `${y}px`;
}

canvas.addEventListener('pointerdown', (e) => {
  const p = pick(e);
  if (e.metaKey || e.ctrlKey) {
    // brush size works anywhere; off the object the ring is sized at the orbit target's depth
    sizing = true;
    sizeStartX = e.clientX;
    sizeStartY = e.clientY;
    sizeStartR = brushRadius;
    sizeAnchor = p ? p.clone() : controls.target.clone();
    controls.enabled = false;
    showRing(sizeAnchor, brushRadius, e.clientX, e.clientY);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    return;
  }
  if (!p) return; // off the object: let OrbitControls have it
  painting = true;
  scraping = scrapeTool || e.shiftKey || e.button === 2;
  controls.enabled = false;
  for (let c = 0; c < SPECIES; c++) strokeBias[c] = 0.6 + 0.4 * Math.random(); // mild, so strokes do not stripe
  strokeShift.set(Math.random() * 100, Math.random() * 100, Math.random() * 100);
  speed = 0;
  lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
  brush(p, scraping);
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (sizing && sizeAnchor) {
    const k = Math.exp((e.clientX - sizeStartX) / 160); // exponential: same feel small and big
    brushRadius = THREE.MathUtils.clamp(sizeStartR * k, BRUSH_MIN, BRUSH_MAX);
    showRing(sizeAnchor, brushRadius, sizeStartX, sizeStartY); // ring stays put, only its size changes
    return;
  }
  if (!painting) return;
  const now = performance.now();
  const dt = Math.max(1, now - lastT) / 1000;
  const v = Math.hypot(e.clientX - lastX, e.clientY - lastY) / dt;
  speed += (v - speed) * 0.25;
  lastX = e.clientX; lastY = e.clientY; lastT = now;
  const p = pick(e);
  if (p) brush(p, scraping);
});
const stop = () => {
  painting = false;
  sizing = false;
  sizeRing.style.display = 'none';
  controls.enabled = true;
};
canvas.addEventListener('pointerup', stop);
canvas.addEventListener('pointercancel', stop);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- brush swatches
const swatchBar = document.querySelector<HTMLElement>('.swatches')!;
const swatches = Array.from(swatchBar.querySelectorAll<HTMLButtonElement>('.sw'));
let scrapeTool = false;
let carousel: Carousel | null = null;
const scrapeBtn = document.querySelector<HTMLButtonElement>('.scrape-btn')!;
const swatchIndex = () => swatches.findIndex((b) => Number(b.dataset.species) === currentSpecies);
function setBrush(species: number | null, scrape = false, fromCarousel = false) {
  scrapeTool = scrape;
  if (species !== null) currentSpecies = species;
  swatches.forEach((b) => b.classList.toggle('active', !scrape && Number(b.dataset.species) === currentSpecies));
  scrapeBtn.classList.toggle('active', scrape);
  scrapeBtn.setAttribute('aria-pressed', String(scrape));
  if (carousel && !fromCarousel) carousel.goTo(swatchIndex());
}
function selectSwatch(b: HTMLButtonElement, fromCarousel = false) {
  setBrush(Number(b.dataset.species), false, fromCarousel);
}
scrapeBtn.addEventListener('click', () => (scrapeTool ? setBrush(null, false) : setBrush(null, true)));
// phones: infinite swipe, centred item is the brush. Desktop: a plain row.
const useCarousel = coarse || innerWidth < 640;
if (useCarousel) {
  carousel = setupCarousel(swatchBar, swatches, 104, (i) => selectSwatch(swatches[i], true), 0);
} else {
  swatches.forEach((b) => b.addEventListener('click', () => selectSwatch(b)));
}
addEventListener('keydown', (e) => {
  if (e.key === '0' || e.key === 'a') setBrush(-1);
  if (e.key === '1') setBrush(0);
  if (e.key === '2') setBrush(1);
  if (e.key === '3') setBrush(2);
  if (e.key === '4') setBrush(3);
  if (e.key === 'x') setBrush(null, !scrapeTool);
  if (e.key === 'h') {
    const hidden = shellMat.uniforms.uHideRock.value === 1 && !W.metal ? 0 : 1;
    shellMat.uniforms.uHideRock.value = hidden;
    if (W.metal) W.metal.visible = hidden === 1 && W.metal.visible ? false : true;
  }
});
setBrush(-1);
renderSwatches(renderer, SHELLS, lightDir);
renderEraser(renderer);

// ---- framing
function frameWord() {
  // fit the word's height into 70% of the viewport
  const bb = W.surface.geometry.boundingBox!;
  const width = bb.max.x - bb.min.x;
  const height = bb.max.y - bb.min.y;
  const depth = bb.max.z - bb.min.z;
  const center = new THREE.Vector3((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2);
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const aspect = innerWidth / innerHeight;
  // height only: letters always the same size on screen, a wide word just runs past the edges
  const dH = (height * 1.08) / (0.7 * 2 * tanHalf);
  const dist = dH + depth; // the near face is half a depth closer than the centre
  void aspect; void width;
  camera.position.set(center.x + dist * 0.22, center.y + dist * 0.12, center.z + dist);
  controls.target.copy(center);
  // the contact shadow follows the word's footprint
  ground.scale.set(Math.max(1, width / 1.6), Math.max(1, depth / 1.2), 1);
  ground.position.x = center.x;
}
function rebuild(text: string, kind: 'word' | 'rock') {
  destroyWorld(W);
  W = createWorld(text, kind);
  pillowDirty = true;
  if (kind === 'rock') seedRock(); else seedWord();
  frameWord();
  dirty = true;
  shadowDirty = true;
}
// ---- object toggle: letters or the silver rock
const objectButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.objects button'));
objectButtons.forEach((b) =>
  b.addEventListener('click', () => {
    const kind = b.dataset.object as 'word' | 'rock';
    objectButtons.forEach((o) => o.classList.toggle('active', o === b));
    rebuild('M', kind);
  }),
);
let shadowDirty = true;

// ---- growth: painted moss ages up in place, it does not spread
const GROW = 0.12; // age per second
function grow(dt: number) {
  const { moss, cap, surface } = W;
  for (let i = 0; i < W.n; i++) {
    const a = moss[i];
    if (a <= 0 || a >= cap[i]) continue;
    moss[i] = Math.min(cap[i], a + GROW * dt * (0.3 + 0.7 * surface.fertility[i]));
  }
  dirty = true;
}

// the puff spring: stiff and critically damped, a firm push that settles without wobbling
const PUFF_K = 400;
const PUFF_DAMP = 40; // critically damped: a quick firm push, no wobble
let puffActive = false;
function springPuff(dt: number) {
  const { puff, puffVel, puffTarget } = W;
  let moving = false;
  for (let i = 0; i < W.n; i++) {
    const v = puffVel[i];
    const x = puff[i];
    const t = puffTarget[i];
    if (v === 0 && x === t) continue;
    const a = (t - x) * PUFF_K - v * PUFF_DAMP;
    let nv = v + a * dt;
    let nx = x + nv * dt;
    if (Math.abs(nv) < 0.002 && Math.abs(t - nx) < 0.002) { nx = t; nv = 0; }
    puff[i] = nx;
    puffVel[i] = nv;
    moving = true;
  }
  if (moving || puffActive || pillowDirty) {
    W.puffAttr.needsUpdate = true;
    W.pillowAttr.needsUpdate = true;
    const tex = W.fronds.puffTexture.image.data as Float32Array;
    const pil = W.pillow;
    for (let i = 0; i < W.n; i++) {
      tex[i * 2] = puff[i];
      tex[i * 2 + 1] = pil[i];
    }
    W.fronds.puffTexture.needsUpdate = true;
    pillowDirty = false;
  }
  puffActive = moving;
}

// slow blur of species weights across the moss, softens any hard edge
const BLEND = 0.15;
const acc = new Float32Array(SPECIES);
function blendSpecies(dt: number) {
  const { moss, species, surface } = W;
  const k = Math.min(1, BLEND * dt);
  for (let i = 0; i < W.n; i++) {
    if (moss[i] <= 0) continue;
    const nb = surface.adjacency[i];
    acc.fill(0);
    let cnt = 0;
    for (let q = 0; q < nb.length; q++) {
      const j = nb[q];
      if (moss[j] <= 0) continue;
      for (let c = 0; c < SPECIES; c++) acc[c] += species[j * SPECIES + c];
      cnt++;
    }
    if (cnt === 0) continue;
    const o = i * SPECIES;
    for (let c = 0; c < SPECIES; c++) species[o + c] += (acc[c] / cnt - species[o + c]) * k;
  }
}

// pre-grown patches so the word is not bare on load.
// Seeded from the surface vertex nearest a direction, limited to vertices facing roughly the same way,
// so a patch never wraps around an edge onto another face.
const tmpN = new THREE.Vector3();
const cN = new THREE.Vector3();
function seedPatch(dir: THREE.Vector3, r: number, kind: number) {
  const { positions, normals, moss, cap, surface } = W;
  dir.normalize();
  let c = 0, best = -Infinity;
  for (let i = 0; i < W.n; i++) {
    tmp.fromBufferAttribute(positions, i);
    const d = tmp.normalize().dot(dir);
    if (d > best) { best = d; c = i; }
  }
  const center = new THREE.Vector3().fromBufferAttribute(positions, c);
  cN.fromBufferAttribute(normals, c);
  const r2 = r * r;
  for (let i = 0; i < W.n; i++) {
    tmp.fromBufferAttribute(positions, i);
    const d2 = tmp.distanceToSquared(center);
    if (d2 > r2 || surface.fertility[i] < 0.15) continue;
    tmpN.fromBufferAttribute(normals, i);
    if (tmpN.dot(cN) < 0.25) continue;
    const ragged = fbm3(tmp.x * 6, tmp.y * 6, tmp.z * 6, 3, 99) * 0.5;
    const edge = 1 - Math.sqrt(d2 / r2) + ragged;
    if (edge <= 0.12) continue;
    const profile = Math.min(1, edge * 2.2) * (0.8 + 0.2 * surface.fertility[i]);
    moss[i] = Math.max(moss[i], profile);
    cap[i] = Math.max(cap[i], profile);
    setOneHot(i, kind);
  }
}
function seedRock() {
  seedPatch(new THREE.Vector3(0.3, 1.0, 0.5), 0.45, 0);
  seedPatch(new THREE.Vector3(-0.6, 0.8, 0.3), 0.32, 1);
  seedPatch(new THREE.Vector3(0.9, 0.5, -0.3), 0.3, 2);
  seedPatch(new THREE.Vector3(0.2, 0.5, 1.0), 0.3, 3);
}
function seedWord() {
  // a few patches along the top of the word and one on the front
  const bb = W.surface.geometry.boundingBox!;
  const w = bb.max.x - bb.min.x;
  const kinds = [0, 3, 0, 2, 3];
  for (let i = 0; i < Math.min(5, Math.ceil(w / 1.2)); i++) {
    const x = bb.min.x + (i + 0.5) * (w / Math.min(5, Math.ceil(w / 1.2)));
    seedPatch(new THREE.Vector3(x, 2.5, 0.3), 0.4, kinds[i % kinds.length]);
  }
  seedPatch(new THREE.Vector3(bb.min.x + w * 0.35, 0.2, 2.0), 0.35, 1);
}
seedWord();

// ---- loop
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  frameWord();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  shellMat.uniforms.uTime.value = clock.elapsedTime;
  grow(dt);
  blendSpecies(dt);
  springPuff(dt);
  if (dirty) {
    const { moss, species, fronds } = W;
    W.mossAttr.needsUpdate = true;
    W.speciesAttr.needsUpdate = true;
    const tex = fronds.ageTexture.image.data as Float32Array;
    for (let i = 0; i < W.n; i++) {
      tex[i * 4] = moss[i];
      // fourth weight is implied: 1 - (g + b + a)
      tex[i * 4 + 1] = species[i * SPECIES];
      tex[i * 4 + 2] = species[i * SPECIES + 1];
      tex[i * 4 + 3] = species[i * SPECIES + 2];
    }
    fronds.ageTexture.needsUpdate = true;
    dirty = false;
    if (shadowDirty) {
      renderShadow();
      shadowDirty = false;
    }
  }
  controls.update();
  renderer.render(scene, camera);
});
