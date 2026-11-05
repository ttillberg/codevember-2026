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
import { renderGlyphThumbs } from './glyphthumbs';

const coarse = matchMedia('(pointer: coarse)').matches;
const SHELLS = coarse ? 10 : 16;
const SPECIES = 5; // feather, star, lichen, cushion, coral
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
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(1.2, 2.0, 1.0).multiplyScalar(5);
scene.add(key);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
camera.position.set(3.6, 1.1, 6.6);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.45, 0);
controls.enableDamping = true;
controls.enableZoom = coarse; // desktop: orbit only. Touch: pinch to zoom in a bit (limits set in frameWord)
controls.enablePan = false;
// touch: one finger paints, two fingers turn the object (zoom is off, so dolly-rotate is just rotate)
controls.touches = { ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };
const touchIds = new Set<number>();
const touchHint = document.querySelector<HTMLElement>('.touch-hint')!;
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
    uScale: { value: 1 },
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

const METAL = false; // true: brushed black metal body on the rock; false: plain white like the letters

// ---- the metal: physically based, brushed. Roughness varies with a small noise texture so the
// reflections break up instead of reading like chrome, plus a thin clearcoat for the sharp highlight.
function noiseTexture(size: number, scale: number, lo: number, hi: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = fbm3(x * scale, y * scale * 0.25, 0.5, 4, 3) * 0.5 + 0.5; // stretched: a brushed grain
      const g = Math.round(255 * (lo + (hi - lo) * v));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}
let roughnessTex: THREE.Texture | null = null;
function metalMaterial() {
  roughnessTex ??= noiseTexture(256, 0.12, 0.2, 0.55);
  return new THREE.MeshPhysicalMaterial({
    color: 0x1c1c1e,
    metalness: 1,
    roughness: 1,
    roughnessMap: roughnessTex,
    envMapIntensity: 1.0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.18,
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4,
  });
}

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
  settle: Float32Array; // seconds left of species blending after a brush touch
  pillowAttr: THREE.BufferAttribute;
  mossAttr: THREE.BufferAttribute;
  speciesAttr: THREE.InterleavedBuffer;
  shells: THREE.InstancedMesh;
  fronds: Fronds;
  picker: THREE.Mesh;
  kind: 'word' | 'rock';
  reach: Float32Array; // area of each vertex that counts towards the moss meter (0 where you cannot paint)
  reachTotal: number;
  metal: THREE.Mesh | null; // the silver rock body, drawn where there is no moss
}

function createWorld(text: string, kind: 'word' | 'rock' = 'word'): World {
  // rock: mostly midpoint passes and a single Loop pass, so the facets keep some sharp edges
  const surface = kind === 'rock' ? buildRock(7, coarse ? 3 : 4, 1) : buildWord(text, font, coarse ? 1 : 2);
  const geo = surface.geometry;
  const n = geo.attributes.position.count;
  const moss = new Float32Array(n);
  const cap = new Float32Array(n);
  const species = new Float32Array(n * SPECIES);
  const mossAttr = new THREE.BufferAttribute(moss, 1);
  mossAttr.setUsage(THREE.DynamicDrawUsage);
  // five weights per vertex, read by the shells as a vec4 plus a float off one interleaved buffer
  const speciesAttr = new THREE.InterleavedBuffer(species, SPECIES);
  speciesAttr.setUsage(THREE.DynamicDrawUsage);
  const puff = new Float32Array(n);
  const puffVel = new Float32Array(n);
  const puffTarget = new Float32Array(n);
  const puffAttr = new THREE.BufferAttribute(puff, 1);
  puffAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('puff', puffAttr);
  geo.setAttribute('moss', mossAttr);
  geo.setAttribute('speciesW', new THREE.InterleavedBufferAttribute(speciesAttr, 4, 0));
  geo.setAttribute('speciesW2', new THREE.InterleavedBufferAttribute(speciesAttr, 1, 4));
  geo.setAttribute('dead', new THREE.BufferAttribute(surface.dead, 1));
  const settle = new Float32Array(n);
  const pillow = Float32Array.from(surface.pillow);
  const pillowAttr = new THREE.BufferAttribute(pillow, 1);
  pillowAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('pillow', pillowAttr);

  const shells = new THREE.InstancedMesh(geo, shellMat, SHELLS);
  shells.frustumCulled = false;
  const fronds = buildFronds(geo, surface.fertility, coarse ? 40000 : 140000);
  // letters: grass only in the straw-rich patches, not along every top edge
  if (kind === 'word') (fronds.mesh.material as THREE.ShaderMaterial).uniforms.uStrawBase.value = 0;
  const picker = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
  scene.add(shells, fronds.mesh, picker);
  let metal: THREE.Mesh | null = null;
  if (kind === 'rock' && METAL) {
    // the hull has no uvs; a planar projection is plenty for a noise roughness map
    if (!geo.attributes.uv) {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { uv[i * 2] = pos.getX(i) + pos.getZ(i) * 0.5; uv[i * 2 + 1] = pos.getY(i) + pos.getZ(i) * 0.3; }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    metal = new THREE.Mesh(geo, metalMaterial());
    scene.add(metal);
  }
  // with a metal body the shell base only draws under moss
  shellMat.uniforms.uHideRock.value = metal ? 1 : 0;

  return {
    surface, n,
    positions: geo.attributes.position as THREE.BufferAttribute,
    normals: geo.attributes.normal as THREE.BufferAttribute,
    moss, cap, species, puff, puffVel, puffTarget, puffAttr, pillow, pillowAttr, settle, mossAttr, speciesAttr, shells, fronds, picker, kind, metal,
    ...reachOf(surface, geo.attributes.normal as THREE.BufferAttribute),
  };
}

// the moss meter counts what you can actually cover: fertile surface facing sideways or up, nothing facing down
function reachOf(surface: Surface, normals: THREE.BufferAttribute) {
  const n = normals.count;
  const reach = new Float32Array(n);
  let reachTotal = 0;
  for (let i = 0; i < n; i++) {
    if (surface.fertility[i] <= 0.05 || normals.getY(i) < -0.15) continue;
    reach[i] = surface.area[i];
    reachTotal += reach[i];
  }
  return { reach, reachTotal };
}
function coverage() {
  let covered = 0;
  // only mature, visible moss counts: the thin young rim of a stroke should not fill the meter
  for (let i = 0; i < W.n; i++) if (W.reach[i] > 0 && W.moss[i] > 0.55) covered += W.reach[i];
  return W.reachTotal > 0 ? covered / W.reachTotal : 0;
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
let W = createWorld('M', 'rock');
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
let currentSpecies = 4; // coral by default; -1 = auto mix
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
  // coral: round clumps in its own field, sides and tops
  const coralField = THREE.MathUtils.smoothstep(fbm3(tmp.x * 2.2, tmp.y * 2.2, tmp.z * 2.2, 3, 91), 0.0, 0.3);
  out[4] = (0.3 + 0.7 * strokeBias[4]) * coralField * THREE.MathUtils.smoothstep(up, -0.4, 0.4);
}

// ---- painting
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let painting = false;
let scraping = false;
let brushRadius = 0.24; // medium by default
const BRUSH_MIN = 0.06;
const BRUSH_MAX = 0.5;

function pick(e: { clientX: number; clientY: number }) {
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
        W.puffVel[i] = Math.min(W.puffVel[i] + falloff * 0.5, 1.5);
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
      W.settle[i] = 2.0; // blend with the neighbours for a couple of seconds, then hold still
    }
  }
  dirty = true;
}

// ---- cursor (mouse only): a cross over the object where a drag paints, an open hand beside it where
// a drag rotates, a closed hand while rotating, a resize arrow with cmd/ctrl held.
const hover = { clientX: 0, clientY: 0, pending: false, over: false, mod: false };
let orbiting = false;
function setCursor() {
  canvas.style.cursor =
    orbiting ? 'grabbing' :
    sizing || hover.mod ? 'ew-resize' :
    hover.over ? 'crosshair' : 'grab';
}
function updateHover() {
  if (!hover.pending || painting || sizing || orbiting) return;
  hover.pending = false;
  hover.over = pick(hover) !== null;
  setCursor();
}
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  hover.clientX = e.clientX; hover.clientY = e.clientY;
  hover.mod = e.metaKey || e.ctrlKey;
  hover.pending = true;
});
canvas.addEventListener('pointerleave', () => { hover.pending = false; });
addEventListener('keydown', (e) => { if (e.key === 'Meta' || e.key === 'Control') { hover.mod = true; setCursor(); } });
addEventListener('keyup', (e) => { if (e.key === 'Meta' || e.key === 'Control') { hover.mod = false; setCursor(); } });

// ---- brush size: cmd/ctrl + drag sideways, with a ring showing the size
const sizeRing = document.querySelector<HTMLElement>('.size-ring')!;
let sizing = false;
let sizeStartX = 0;
let sizeStartY = 0;
let sizeStartR = 0;
let sizeAnchor: THREE.Vector3 | null = null;
setCursor();
function showRing(point: THREE.Vector3, r: number, x: number, y: number) {
  const d = camera.position.distanceTo(point);
  const px = (r / (d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * (innerHeight / 2);
  sizeRing.style.display = 'block';
  sizeRing.style.width = sizeRing.style.height = `${px * 2}px`;
  sizeRing.style.left = `${x}px`;
  sizeRing.style.top = `${y}px`;
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') {
    touchIds.add(e.pointerId);
    if (touchIds.size >= 2) {
      // a second finger: stop painting and let the controls rotate; the hint has done its job
      touchHint.classList.add('done');
      painting = false;
      sizing = false;
      sizeRing.style.display = 'none';
      return;
    }
  }
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
    setCursor();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    return;
  }
  if (!p) {
    // off the object: let OrbitControls have it
    if (e.pointerType === 'mouse') { orbiting = true; setCursor(); }
    return;
  }
  painting = true;
  scraping = scrapeTool || e.shiftKey || e.button === 2;
  // mouse: keep the controls out of a paint drag. Touch: leave them on so a second finger can rotate.
  if (e.pointerType !== 'touch') controls.enabled = false;
  for (let c = 0; c < SPECIES; c++) strokeBias[c] = 0.6 + 0.4 * Math.random(); // mild, so strokes do not stripe
  strokeShift.set(Math.random() * 100, Math.random() * 100, Math.random() * 100);
  speed = 0;
  lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
  brush(p, scraping);
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (touchIds.size >= 2) return;
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
const release = (e: PointerEvent) => {
  touchIds.delete(e.pointerId);
  if (painting) requestThumb(45); // after the stroke has grown in a bit
  stop();
  orbiting = false;
  hover.pending = true;
  setCursor();
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
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
  carousel = setupCarousel(swatchBar, swatches, 104, (i) => selectSwatch(swatches[i], true), swatchIndex());
} else {
  swatches.forEach((b) => b.addEventListener('click', () => selectSwatch(b)));
}
addEventListener('keydown', (e) => {
  // keys follow the swatch order: feather, star, cushion, lichen, coral, mix
  if (e.key === '1') setBrush(0);
  if (e.key === '2') setBrush(1);
  if (e.key === '3') setBrush(3);
  if (e.key === '4') setBrush(2);
  if (e.key === '5') setBrush(4);
  if (e.key === '6' || e.key === 'a') setBrush(-1);
  if (e.key === 'x') setBrush(null, !scrapeTool);
  if (e.key === 'h') {
    const hidden = shellMat.uniforms.uHideRock.value === 1 && !W.metal ? 0 : 1;
    shellMat.uniforms.uHideRock.value = hidden;
    if (W.metal) W.metal.visible = hidden === 1 && W.metal.visible ? false : true;
  }
});
setBrush(4);
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
  // letters: height only, a wide word just runs past the edges.
  // rock: height and width, so it fits a portrait phone too (90% of the width).
  // The rock is seen from the side as well, so its width uses the larger of x and z.
  const dH = (height * 1.08) / (0.7 * 2 * tanHalf);
  const span = W.kind === 'rock' ? Math.max(width, depth) : width;
  const dW = span / (0.95 * 2 * tanHalf * aspect);
  const dist = W.kind === 'rock' ? Math.max(dH + depth, dW + depth * 0.5) : dH + depth; // the near face is closer than the centre
  // default view: from the front, the eye almost down on the ground, looking slightly up at the object
  const eye = new THREE.Vector3(center.x + dist * 0.08, ground.position.y + 0.18, center.z + dist).sub(center).setLength(dist);
  camera.position.copy(center).add(eye);
  // touch zoom: in to about half the framed distance, never further out than the framing.
  // The brush radius is in world units, so it keeps its size on the surface while zooming.
  framedPos.copy(camera.position);
  framedTarget.copy(center);
  const framed = camera.position.distanceTo(center);
  controls.minDistance = framed * 0.5;
  controls.maxDistance = framed;
  controls.target.copy(center);
  // the contact shadow follows the word's footprint
  ground.scale.set(Math.max(1, width / 1.6), Math.max(1, depth / 1.2), 1);
  ground.position.x = center.x;
}
function rebuild(text: string, kind: 'word' | 'rock') {
  destroyWorld(W);
  W = createWorld(text, kind);
  applyScale();
  pillowDirty = true;
  if (kind === 'rock') seedRock(); else seedWord();
  frameWord();
  dirty = true;
  shadowDirty = true;
}
// ---- moss size slider: scales fronds, straws, fuzz and bulge together
const BASE = { height: 0.012, bulge: 0.035, len: 0.032, star: 0.038, lichen: 0.07, width: 0.0042 };
let mossScale = 1.75;
function applyScale() {
  shellMat.uniforms.uHeight.value = BASE.height * mossScale;
  shellMat.uniforms.uBulge.value = BASE.bulge * mossScale;
  shellMat.uniforms.uScale.value = mossScale;
  const fu = (W.fronds.mesh.material as THREE.ShaderMaterial).uniforms;
  fu.uLen.value = BASE.len * mossScale;
  fu.uStarLen.value = BASE.star * mossScale;
  fu.uLichenLen.value = BASE.lichen * mossScale;
  fu.uWidth.value = BASE.width * mossScale;
  fu.uBulge.value = BASE.bulge * mossScale;
}
const scaleInput = document.querySelector<HTMLInputElement>('.scale input')!;
const scaleLabel = document.querySelector<HTMLElement>('.scale span')!;
scaleInput.addEventListener('input', () => {
  mossScale = Number(scaleInput.value) / 100;
  scaleLabel.textContent = `moss ${scaleInput.value}%`;
  applyScale();
});
scaleInput.addEventListener('keydown', (e) => e.stopPropagation());
applyScale(); // start at the default size

// ---- thumbnail of the current object, with its moss, from the framed view
const framedPos = new THREE.Vector3();
const framedTarget = new THREE.Vector3();
const THUMB = 128;
const thumbRT = new THREE.WebGLRenderTarget(THUMB, THUMB, { colorSpace: THREE.SRGBColorSpace, samples: 4 });
const thumbCam = new THREE.PerspectiveCamera(camera.fov, 1, 0.1, 50);
const thumbPixels = new Uint8Array(THUMB * THUMB * 4);
const thumbCanvas = document.createElement('canvas');
thumbCanvas.width = thumbCanvas.height = THUMB;
const thumbCtx = thumbCanvas.getContext('2d')!;
const thumbImg = thumbCtx.createImageData(THUMB, THUMB);
function snapshot(): string {
  // square frame: pull back a little so the widest side fits
  thumbCam.position.copy(framedTarget).add(framedPos.clone().sub(framedTarget).multiplyScalar(0.8));
  thumbCam.lookAt(framedTarget);
  const prevClear = renderer.getClearAlpha();
  ground.visible = false;
  renderer.setClearAlpha(0);
  renderer.setRenderTarget(thumbRT);
  renderer.clear();
  renderer.render(scene, thumbCam);
  renderer.readRenderTargetPixels(thumbRT, 0, 0, THUMB, THUMB, thumbPixels);
  renderer.setRenderTarget(null);
  renderer.setClearAlpha(prevClear);
  ground.visible = true;
  const row = THUMB * 4;
  for (let y = 0; y < THUMB; y++) thumbImg.data.set(thumbPixels.subarray((THUMB - 1 - y) * row, (THUMB - y) * row), y * row);
  thumbCtx.putImageData(thumbImg, 0, 0);
  return thumbCanvas.toDataURL('image/png');
}
let thumbDirty = 0; // frames to wait before the next snapshot, 0 = nothing pending
function requestThumb(delayFrames = 2) { thumbDirty = Math.max(thumbDirty, delayFrames); }
function updateThumb() {
  const url = snapshot();
  (letterBtn.querySelector('i') as HTMLElement).style.backgroundImage = `url(${url})`;
  if (W.kind === 'rock') {
    const rockItem = letterPop.querySelector<HTMLElement>('button.rock i');
    if (rockItem) rockItem.style.backgroundImage = `url(${url})`;
  }
}

// ---- letter picker: one glyph at a time, from the three.js typeface, or the rock
const letterBtn = document.querySelector<HTMLButtonElement>('.letter-btn')!;
const letterPop = document.querySelector<HTMLElement>('.letter-pop')!;
const glyphs = (font.data as { glyphs: Record<string, unknown> }).glyphs;
const CHARS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].filter((c) => c in glyphs);
function pickObject(choice: string) {
  letterPop.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.choice === choice));
  if (choice === 'rock') rebuild('rock', 'rock');
  else rebuild(choice, 'word');
  requestThumb(4); // let the moss settle a frame or two first
}
function setPop(open: boolean) {
  letterPop.hidden = !open;
  letterBtn.setAttribute('aria-expanded', String(open));
}

// ---- moss meter: a ring around the miniature fills as you cover the object; a full rock unlocks the alphabet
const UNLOCK_AT = 0.8;
const UNLOCK_KEY = 'codevember-05-alphabet';
let unlocked = false;
try { unlocked = localStorage.getItem(UNLOCK_KEY) === '1'; } catch { /* private mode: start locked */ }
const ringFill = letterBtn.querySelector<SVGCircleElement>('.ring .fill')!;
const RING_C = 2 * Math.PI * 30;
ringFill.style.strokeDasharray = `${RING_C}`;
// locked: the alphabet is hidden and the miniature is just the meter; unlocked: it opens the picker
let glyphThumbsStarted = false;
function setLocked() {
  letterPop.querySelectorAll<HTMLButtonElement>('button:not(.rock)').forEach((b) => { b.hidden = !unlocked; b.disabled = !unlocked; });
  letterBtn.classList.toggle('unlocked', unlocked);
  letterBtn.setAttribute('aria-label', unlocked ? 'choose a letter' : 'moss meter');
  if (!unlocked) setPop(false);
  if (unlocked && !glyphThumbsStarted) {
    glyphThumbsStarted = true;
    // mossy miniatures of every glyph, one per frame; the green text stands in until each one lands
    renderGlyphThumbs(renderer, font, CHARS, lightDir, (c, url) => {
      const b = letterPop.querySelector<HTMLButtonElement>(`button[data-choice="${c}"]`);
      if (!b) return;
      b.style.backgroundImage = `url(${url})`;
      b.classList.add('thumb');
    });
  }
}

// ---- moss confetti: the palette's moss balls burst out of the miniature and tumble down
function mossConfetti() {
  const sprites = Array.from(document.querySelectorAll<HTMLElement>('.sw i'))
    .map((el) => el.style.backgroundImage)
    .filter(Boolean);
  if (!sprites.length) return;
  const r = letterBtn.getBoundingClientRect();
  const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  document.body.appendChild(layer);
  const bits = Array.from({ length: 56 }, () => {
    const el = document.createElement('i');
    const size = 10 + Math.random() * 22;
    el.style.width = el.style.height = `${size}px`;
    el.style.backgroundImage = sprites[Math.floor(Math.random() * sprites.length)];
    layer.appendChild(el);
    const a = Math.random() * Math.PI * 0.9 - 0.15; // mostly out to the right and down from the corner
    const v = 260 + Math.random() * 520;
    return { el, x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 320, rot: Math.random() * 360, vr: (Math.random() - 0.5) * 720 };
  });
  let last = performance.now();
  const t0 = last;
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const age = (now - t0) / 1000;
    for (const b of bits) {
      b.vy += 900 * dt;
      b.vx *= 1 - 0.6 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt;
      b.el.style.transform = `translate(${b.x}px, ${b.y}px) translate(-50%, -50%) rotate(${b.rot}deg)`;
      b.el.style.opacity = String(Math.max(0, 1 - Math.max(0, age - 1.6) / 0.8));
    }
    if (age < 2.4) requestAnimationFrame(tick);
    else layer.remove();
  };
  requestAnimationFrame(tick);
}
function updateMeter() {
  const c = coverage();
  ringFill.style.strokeDashoffset = `${RING_C * (1 - Math.min(1, c / UNLOCK_AT))}`;
  letterBtn.classList.toggle('full', c >= UNLOCK_AT);
  if (!unlocked && W.kind === 'rock' && c >= UNLOCK_AT) {
    unlocked = true;
    try { localStorage.setItem(UNLOCK_KEY, '1'); } catch { /* fine, it just will not be remembered */ }
    setLocked();
    mossConfetti();
    letterBtn.classList.add('just-unlocked');
    setTimeout(() => letterBtn.classList.remove('just-unlocked'), 2400);
  }
}
{
  const rockBtn = document.createElement('button');
  rockBtn.className = 'rock active';
  rockBtn.dataset.choice = 'rock';
  rockBtn.setAttribute('aria-label', 'rock');
  rockBtn.innerHTML = '<i></i>';
  letterPop.appendChild(rockBtn);
  for (const c of CHARS) {
    const b = document.createElement('button');
    b.dataset.choice = c;
    b.textContent = c;
    letterPop.appendChild(b);
  }
  setLocked();
}
letterBtn.addEventListener('click', (e) => { e.stopPropagation(); if (unlocked) setPop(letterPop.hidden); });
letterPop.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!b?.dataset.choice || b.disabled) return;
  e.stopPropagation();
  setPop(false);
  pickObject(b.dataset.choice);
});
addEventListener('pointerdown', (e) => {
  if (!letterPop.hidden && !letterPop.contains(e.target as Node) && e.target !== letterBtn) setPop(false);
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') setPop(false); });

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
  let changed = false;
  for (let i = 0; i < W.n; i++) {
    const a = moss[i];
    if (a <= 0 || a >= cap[i]) continue;
    moss[i] = Math.min(cap[i], a + GROW * dt * (0.3 + 0.7 * surface.fertility[i]));
    changed = true;
  }
  if (changed) dirty = true;
}

// the puff spring: stiff and critically damped, a firm push that settles without wobbling
const PUFF_K = 400;
const PUFF_DAMP = 40; // critically damped: a quick firm push, no wobble
let puffActive = false;
function springPuff(dt: number) {
  const { puff, puffVel, puffTarget } = W;
  const puffSteps = Math.min(16, Math.max(1, Math.ceil(dt * 240)));
  const puffH = dt / puffSteps;
  let moving = false;
  for (let i = 0; i < W.n; i++) {
    const v = puffVel[i];
    const x = puff[i];
    const t = puffTarget[i];
    if (v === 0 && x === t) continue;
    // fixed sub-steps: explicit Euler with damping 40 goes unstable once dt reaches ~1/20 s,
    // which a slow, battery-saving CPU easily hits. Small steps keep it stable at any frame rate.
    let nv = v;
    let nx = x;
    for (let k = 0; k < puffSteps; k++) {
      const a = (t - nx) * PUFF_K - nv * PUFF_DAMP;
      nv += a * puffH;
      nx += nv * puffH;
    }
    nx = Math.min(Math.max(nx, -0.2), 1.2); // belt and braces: never let a vertex run off
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
      tex[i * 4] = puff[i];
      tex[i * 4 + 1] = pil[i];
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
  const { moss, species, surface, settle } = W;
  const k = Math.min(1, BLEND * dt);
  for (let i = 0; i < W.n; i++) {
    if (moss[i] <= 0 || settle[i] <= 0) continue;
    settle[i] -= dt;
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
    dirty = true;
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
seedRock();

// ---- loop
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  frameWord();
}
addEventListener('resize', resize);
resize();

let meterTick = 0;
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
      // feather, star, lichen here; cushion in the puff texture; coral is implied
      tex[i * 4 + 1] = species[i * SPECIES];
      tex[i * 4 + 2] = species[i * SPECIES + 1];
      tex[i * 4 + 3] = species[i * SPECIES + 2];
    }
    fronds.ageTexture.needsUpdate = true;
    // cushion weight rides in the puff texture's B channel; coral is whatever is left
    const ptex = fronds.puffTexture.image.data as Float32Array;
    for (let i = 0; i < W.n; i++) ptex[i * 4 + 2] = species[i * SPECIES + 3];
    fronds.puffTexture.needsUpdate = true;
    dirty = false;
    if (shadowDirty) {
      renderShadow();
      shadowDirty = false;
    }
  }
  if (++meterTick % 12 === 0) updateMeter();
  updateHover();
  controls.update();
  renderer.render(scene, camera);
  if (thumbDirty > 0 && --thumbDirty === 0) updateThumb();
});
requestThumb(6);
