// 05 / Moss — paint moss on a big M. Shell-textured undercoat plus instanced fronds.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildRock, type Surface } from './rock';
import { buildWord, fixGlyphs } from './objects';
import { FontLoader, type Font } from 'three/addons/loaders/FontLoader.js';
import { buildFronds, type Fronds } from './fronds';
import { fbm3 } from './noise';
import { shellVertex, shellFragment, groundVertex, groundFragment } from './shaders';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { TexturePass } from 'three/addons/postprocessing/TexturePass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { renderSwatches, renderEraser } from './swatches';
import { setupCarousel, type Carousel } from './carousel';

// ?clean: the scene alone, no furniture (docs/DESIGN.md)
if (new URLSearchParams(location.search).has('clean')) document.documentElement.classList.add('clean');
import { renderGlyphThumbs } from './glyphthumbs';
import { renderToDataURL } from './render';

const coarse = matchMedia('(pointer: coarse)').matches;
const SHELLS = coarse ? 10 : 16;
const SPECIES = 5; // feather, star, lichen, cushion, coral
const BG = new THREE.Color(0xe6e6e3);

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(BG);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
camera.position.set(3.6, 1.1, 6.6);

const content = new THREE.Group(); // the object's meshes
scene.add(content);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.45, 0);
controls.enableDamping = true;
controls.enableZoom = coarse; // desktop: orbit only. Touch: pinch to zoom in a bit (limits set in frameWord)
controls.enablePan = false;
// touch: one finger paints, two fingers orbit and pinch zooms
controls.touches = { ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };
const touchIds = new Set<number>();
const touchHint = document.querySelector<HTMLElement>('.touch-hint')!;
// the hint fades once the first two-finger turn is done
let touchTurned = false;
controls.addEventListener('change', () => { if (touchIds.size >= 2) touchTurned = true; });
controls.addEventListener('end', () => { if (touchTurned) touchHint.classList.add('done'); });
controls.maxPolarAngle = Math.PI * 0.55;

// the key light follows the camera around the vertical axis: same elevation, always from front right,
// so every side of the object looks lit the same way. Swatches and thumbnails keep the fixed base.
const LIGHT_BASE = new THREE.Vector3(1.2, 2.0, 1.0).normalize();
const lightDir = LIGHT_BASE.clone(); // turned in place each frame; the uniform holds this object
const UP = new THREE.Vector3(0, 1, 0);
let shadowAz = NaN; // camera azimuth the shadow map was last rendered for
let lastShadowMs = 0;
let mossShadowStale = false;
const shellMat = new THREE.ShaderMaterial({
  vertexShader: shellVertex,
  fragmentShader: shellFragment,
  defines: { SHELLS },
  uniforms: {
    uHeight: { value: 0.012 },
    uBulge: { value: 0.035 },
    uLightDir: { value: lightDir },
    uRimDir: { value: new THREE.Vector3(0, 1, 0) },
    uRim: { value: 1 },
    uHemi: { value: 1 },
    uTone: { value: 2 }, // ACES by default
    uCavityAO: { value: 1 },
    uExposure: { value: 1.1 },
    toneMappingExposure: { value: 1 },
    uHideRock: { value: 0 },
    uScale: { value: 1 },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowOn: { value: 0 },
  },
});

// ambient occlusion on or off: the SSAO pass and the baked darkening of moss in hollows
const AO_KEY = 'codevember-05-no-ao';
let aoOff = false;
try { aoOff = localStorage.getItem(AO_KEY) === '1'; } catch { /* private mode */ }
function setAO(on: boolean) {
  aoOff = !on;
  shellMat.uniforms.uCavityAO.value = on ? 1 : 0;
}
setAO(!aoOff);

const SHARED_UNIFORMS = ['uCavityAO', 'uLightDir', 'uRimDir', 'uRim', 'uHemi', 'uTone', 'uExposure', 'toneMappingExposure', 'uShadowMap', 'uShadowMatrix', 'uShadowOn'];

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
  const center = bb.getCenter(new THREE.Vector3());
  const radius = bb.min.distanceTo(bb.max) / 2 + 0.3;
  lightCam.left = -radius; lightCam.right = radius; lightCam.top = radius; lightCam.bottom = -radius;
  lightCam.far = radius * 4;
  lightCam.position.copy(center).addScaledVector(lightDir, radius * 2);
  lightCam.lookAt(center);
  lightCam.updateProjectionMatrix();
  lightCam.updateMatrixWorld();
  shadowMatrix.multiplyMatrices(lightCam.projectionMatrix, lightCam.matrixWorldInverse);

  // unbind the shadow map while rendering into it, or the GPU complains about a feedback loop.
  // The fronds share these uniform objects with the shells, so setting them once covers both.
  const u = shellMat.uniforms;
  u.uShadowOn.value = 0;
  u.uShadowMap.value = null;
  ground.visible = false;
  renderer.setRenderTarget(shadowRT);
  renderer.clear();
  renderer.render(scene, lightCam);
  renderer.setRenderTarget(null);
  ground.visible = true;

  u.uShadowMap.value = shadowRT.depthTexture;
  u.uShadowMatrix.value.copy(shadowMatrix);
  u.uShadowOn.value = 1;
}

// ground with a fake contact shadow
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.ShaderMaterial({
    vertexShader: groundVertex,
    fragmentShader: groundFragment,
    uniforms: { uBg: { value: BG } },
  }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.72; // moved under each object in frameWord
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
  // the fronds share the lighting uniform objects with the shells: the debug panel, the shadow pass and the
  // back light drive both, nothing has to be copied across
  const fu = (fronds.mesh.material as THREE.ShaderMaterial).uniforms;
  for (const k of SHARED_UNIFORMS) fu[k] = shellMat.uniforms[k];
  // letters: grass only in the straw-rich patches, not along every top edge
  if (kind === 'word') (fronds.mesh.material as THREE.ShaderMaterial).uniforms.uStrawBase.value = 0;
  const picker = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
  content.add(shells, fronds.mesh, picker);

  return {
    surface, n,
    positions: geo.attributes.position as THREE.BufferAttribute,
    normals: geo.attributes.normal as THREE.BufferAttribute,
    moss, cap, species, puff, puffVel, puffTarget, puffAttr, pillow, pillowAttr, settle, mossAttr, speciesAttr, shells, fronds, picker, kind,
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
  content.remove(w.shells, w.fronds.mesh, w.picker);
  w.surface.geometry.dispose();
  w.fronds.mesh.geometry.dispose();
  (w.fronds.mesh.material as THREE.Material).dispose();
  w.fronds.ageTexture.dispose();
  w.fronds.puffTexture.dispose();
  (w.picker.material as THREE.Material).dispose();
}

// the font is tiny and local, load it before anything else. Regular, not bold: the rounding and the moss
// thicken every stroke, and bold counters (A, e, 4) close up
const font: Font = await new FontLoader().loadAsync(`${import.meta.env.BASE_URL}fonts/helvetiker_regular.typeface.json`);
fixGlyphs(font);
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
let currentSpecies = 0; // feather, the leftmost swatch, by default; -1 = auto mix
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

const brushLocal = new THREE.Vector3();
function brush(worldPoint: THREE.Vector3, scrape: boolean) {
  const { moss, cap, positions, surface } = W;
  // the hit is in world space, the vertices in the mesh's own
  const point = W.picker.worldToLocal(brushLocal.copy(worldPoint));
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

// moss over the whole object at once with the current brush, handy for comparing looks
function fillAll() {
  const { moss, cap, surface } = W;
  for (let c = 0; c < SPECIES; c++) strokeBias[c] = 0.6 + 0.4 * Math.random();
  for (let i = 0; i < W.n; i++) {
    if (surface.fertility[i] <= 0.05) continue;
    cap[i] = 1;
    moss[i] = Math.max(moss[i], 0.75);
    if (currentSpecies < 0) { autoWeights(i, autoW); addWeights(i, autoW, 1); } else addWeight(i, currentSpecies, 1);
    W.settle[i] = 2.0;
  }
  dirty = true;
}

// ---- debug panel: lighting toggles and a fill button, collapsed by default
{
  const panel = document.querySelector<HTMLDetailsElement>('.debug')!;
  panel.hidden = false; // on everywhere, production too; it starts collapsed
  panel.querySelectorAll<HTMLInputElement>('input[data-uniform]').forEach((box) => {
    box.addEventListener('change', () => { shellMat.uniforms[box.dataset.uniform!].value = box.checked ? 1 : 0; });
  });
  panel.querySelector('[data-action="fill"]')!.addEventListener('click', fillAll);
  // tone mapping: each mode gets its own exposure, AgX and ACES darken differently
  const TONE_EXPOSURE = [1, 1.5, 1.1, 1.15];
  const toneSel = panel.querySelector<HTMLSelectElement>('select[data-tone]')!;
  toneSel.addEventListener('change', () => {
    const k = Number(toneSel.value);
    shellMat.uniforms.uTone.value = k;
    shellMat.uniforms.uExposure.value = TONE_EXPOSURE[k];
  });
  // AO: the SSAO pass and the baked darkening of moss in hollows, on when checked. Remembered across visits.
  const aoBox = panel.querySelector<HTMLInputElement>('input[data-toggle="ao"]')!;
  aoBox.checked = !aoOff;
  aoBox.addEventListener('change', () => {
    setAO(aoBox.checked);
    try { localStorage.setItem(AO_KEY, aoOff ? '1' : '0'); } catch { /* private mode: just not remembered */ }
  });
}

// ---- cursor (mouse only): a cross over the object where a drag paints, an open hand beside it where
// a drag rotates, a closed hand while rotating, a resize arrow with cmd/ctrl held.
const hover = { clientX: 0, clientY: 0, pending: false, over: false, mod: false };
let orbiting = false;
let spaceHeld = false; // see the space key handlers below
function setCursor() {
  canvas.style.cursor =
    orbiting ? 'grabbing' :
    sizing || hover.mod ? 'ew-resize' :
    hover.over && !spaceHeld ? 'crosshair' : 'grab';
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
// space held: a drag orbits wherever it starts, even on top of the object (like a hand tool)
const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || typing(e.target)) return;
  e.preventDefault(); // no page scroll, no "click" on a focused swatch
  if (!spaceHeld) { spaceHeld = true; setCursor(); }
});
addEventListener('keyup', (e) => {
  if (e.code !== 'Space') return;
  spaceHeld = false;
  setCursor();
});
addEventListener('blur', () => { spaceHeld = false; });

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
      // a second finger: stop painting and let the controls orbit
      painting = false;
      sizing = false;
      sizeRing.style.display = 'none';
      return;
    }
  }
  if (spaceHeld && e.pointerType === 'mouse') {
    // the controls are already orbiting: just do not paint
    orbiting = true;
    setCursor();
    return;
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
  if (touchIds.size >= 2 || orbiting) return;
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
    shellMat.uniforms.uHideRock.value = 1 - shellMat.uniforms.uHideRock.value;
  }
});
setBrush(0);
renderSwatches(renderer, SHELLS, LIGHT_BASE);
renderEraser(renderer);

// ---- framing
function frameWord() {
  // fit the word's height into 70% of the viewport
  const bb = W.surface.geometry.boundingBox!;
  const width = bb.max.x - bb.min.x;
  const height = bb.max.y - bb.min.y;
  const depth = bb.max.z - bb.min.z;
  const center = bb.getCenter(new THREE.Vector3());
  // everything floats: the ground sits a gap below the object's lowest point, more for the rock so the moss
  // around its belly never touches. The eye height below follows the ground.
  ground.position.y = bb.min.y - (W.kind === 'rock' ? 0.4 : 0.25);
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
  // the touch hint sits just under the object, on the screen point of its bottom front edge
  camera.lookAt(center);
  camera.updateMatrixWorld();
  const under = new THREE.Vector3(center.x, bb.min.y, bb.max.z).project(camera);
  touchHint.style.top = `${Math.round((1 - under.y) * 0.5 * innerHeight + 34)}px`; // below the contact shadow
}
function rebuild(text: string, kind: 'word' | 'rock') {
  destroyWorld(W);
  W = createWorld(text, kind);
  applyScale();
  pillowDirty = true;
  frameWord();
  dirty = true;
  shadowDirty = true;
}
// ---- moss size: scales fronds, straws, fuzz and bulge together
const BASE = { height: 0.012, bulge: 0.035, len: 0.032, star: 0.038, lichen: 0.07, width: 0.0042 };
const mossScale = 1.75; // moss size relative to the base numbers above
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
applyScale();

// ---- thumbnail of the current object, with its moss, from the framed view
const framedPos = new THREE.Vector3();
const framedTarget = new THREE.Vector3();
const THUMB = 128;
const thumbRT = new THREE.WebGLRenderTarget(THUMB, THUMB, { colorSpace: THREE.SRGBColorSpace, samples: 4 });
const thumbCam = new THREE.PerspectiveCamera(camera.fov, 1, 0.1, 50);
function snapshot(): string {
  // square frame: pull back a little so the widest side fits
  thumbCam.position.copy(framedTarget).add(framedPos.clone().sub(framedTarget).multiplyScalar(0.8));
  thumbCam.lookAt(framedTarget);
  ground.visible = false;
  const url = renderToDataURL(renderer, scene, thumbCam, thumbRT);
  ground.visible = true;
  return url;
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
    renderGlyphThumbs(renderer, font, CHARS, LIGHT_BASE, (c, url) => {
      const b = letterPop.querySelector<HTMLButtonElement>(`button[data-choice="${c}"]`);
      if (!b) return;
      b.style.backgroundImage = `url(${url})`;
      b.classList.add('thumb');
    });
  }
}

function updateMeter() {
  const c = coverage();
  ringFill.style.strokeDashoffset = `${RING_C * (1 - Math.min(1, c / UNLOCK_AT))}`;
  letterBtn.classList.toggle('full', c >= UNLOCK_AT);
  if (!unlocked && W.kind === 'rock' && c >= UNLOCK_AT) {
    unlocked = true;
    try { localStorage.setItem(UNLOCK_KEY, '1'); } catch { /* fine, it just will not be remembered */ }
    setLocked();
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

// every object starts bare: all the moss is yours

// ---- loop
// ---- SSAO: three's own GTAO, so it always matches the three version. It does not re-render the scene with
// its own normal material (that would drop the shells' and fronds' vertex shaders): it gets our depth and
// rebuilds normals from it. The scene renders into a multisampled target first, so MSAA stays.
// Switchable in the debug panel; off, the canvas renders directly.
const beautyRT = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  samples: 4,
  depthTexture: new THREE.DepthTexture(1, 1),
});
const composer = new EffectComposer(renderer);
composer.addPass(new TexturePass(beautyRT.texture));
const aoPass = new GTAOPass(scene, camera, 1, 1, { depthTexture: beautyRT.depthTexture! });
aoPass.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1, samples: 16 });
aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 8, samples: 16 });
aoPass.blendIntensity = 0.9;
composer.addPass(aoPass);
composer.addPass(new OutputPass());

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  const px = renderer.getDrawingBufferSize(new THREE.Vector2());
  beautyRT.setSize(px.x, px.y);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  frameWord();
}
addEventListener('resize', resize);
resize();

let meterTick = 0;
const clock = new THREE.Clock();
const rimDir = new THREE.Vector3();
shellMat.uniforms.uRimDir.value = rimDir;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  // the back light hangs behind the object and a bit above it, wherever the camera goes
  camera.getWorldDirection(rimDir);
  rimDir.y += 0.7;
  rimDir.normalize();
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
    mossShadowStale = true; // the moss grew or changed: its own shadows are out of date
  }
  if (++meterTick % 12 === 0) updateMeter();
  updateHover();
  controls.update();
  const az = controls.getAzimuthalAngle();
  lightDir.copy(LIGHT_BASE).applyAxisAngle(UP, az);
  // re-render the shadow map every couple of degrees while orbiting, and a few times a second while the
  // moss grows, so freshly painted moss casts its shadow without having to turn the view first
  const now = performance.now();
  if (shadowDirty || !(Math.abs(az - shadowAz) < 0.035) || (mossShadowStale && now - lastShadowMs > 150)) {
    renderShadow();
    shadowAz = az;
    lastShadowMs = now;
    shadowDirty = false;
    mossShadowStale = false;
  }
  if (!aoOff) {
    renderer.setRenderTarget(beautyRT);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    composer.render();
  } else renderer.render(scene, camera);
  if (thumbDirty > 0 && --thumbDirty === 0) updateThumb();
});
requestThumb(6);
