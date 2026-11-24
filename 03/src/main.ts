import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { clamp } from './rng';
import { MeltFieldState, POPSICLE } from './shape';
import { createMacroStudioEnv } from './textures';
import { createFruitAssembly, FruitAssembly } from './fruits';
import { createPopsicleIceSystem, PopsicleIceSystem } from './popsicleIce';
import { createWaterDropSystem, DropMode, WaterDropSystem } from './waterDrops';
import { createLiquidFilmSystem, LiquidFilmSystem } from './liquidFilm';

// === URL QUERY FLAGS ===
const params = new URLSearchParams(window.location.search);
if (params.has('clean')) document.documentElement.classList.add('clean');

const showSettings = import.meta.env.DEV || params.has('settings');
let currentSeed = Math.max(1, Math.floor(Number(params.get('seed')) || 1));
const initialMelt = clamp(params.has('melt') ? Number(params.get('melt')) : 0.035, 0, 0.98);
let paused = params.has('paused');
const rawDropParam = params.get('drops');
let currentDropMode: DropMode =
  rawDropParam === 'full' || rawDropParam === 'off' || rawDropParam === 'minimal' ? rawDropParam : 'minimal';

// === RENDERER ===
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// Keep intermediate HDR targets linear; perform single photographic film curve in final display pass!
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;

// === MACRO STUDIO CAMERA (~90mm telephoto portrait framing) ===
const camera = new THREE.PerspectiveCamera(27, window.innerWidth / window.innerHeight, 0.1, 30);
const BASE_CAM_POS = new THREE.Vector3(0, -0.05, 5.75);
const BASE_TARGET = new THREE.Vector3(0, -0.08, 0);
camera.position.copy(BASE_CAM_POS);
camera.lookAt(BASE_TARGET);

const orbit = new OrbitControls(camera, canvas);
orbit.target.copy(BASE_TARGET);
orbit.enableDamping = true;
orbit.dampingFactor = 0.07;
orbit.enablePan = false;
orbit.minDistance = 3.2;
orbit.maxDistance = 9.0;
orbit.minPolarAngle = 0.45;
orbit.maxPolarAngle = Math.PI - 0.45;
orbit.enabled = false;
orbit.update();

// === STUDIO MACRO LIGHTING & ENVIRONMENT ===
const studioEnv = createMacroStudioEnv(renderer);

function buildStudioLights(): THREE.Group {
  const lightGroup = new THREE.Group();

  // Warm backlit softbox transmission fill
  const hemi = new THREE.HemisphereLight(0xfff4eb, 0xd8b6ab, 0.95);
  lightGroup.add(hemi);

  // Key front-left grazing studio strip (sculpts blueberry calyxes & wet strawberry cut flesh)
  const keyL = new THREE.DirectionalLight(0xfff9f3, 1.45);
  keyL.position.set(-2.6, 2.2, 3.2);
  lightGroup.add(keyL);

  // Soft right rim strip
  const keyR = new THREE.DirectionalLight(0xfff3ec, 1.15);
  keyR.position.set(2.8, 1.4, 2.4);
  lightGroup.add(keyR);

  // Strong rear studio lightbox (-Z)
  const backLight = new THREE.DirectionalLight(0xfff6ea, 2.4);
  backLight.position.set(0.0, 0.4, -4.0);
  lightGroup.add(backLight);

  return lightGroup;
}

// === FULLSCREEN QUAD HELPERS ===
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsQuadGeo = new THREE.PlaneGeometry(2, 2);

/** Backlit Macro Studio Lightbox Backdrop (linear HDR!) */
const backdropUniforms = {
  uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  uHaloCenter: { value: new THREE.Vector2(0.5, 0.54) },
  uAspect: { value: window.innerWidth / window.innerHeight },
};

const backdropMat = new THREE.ShaderMaterial({
  depthTest: false,
  depthWrite: false,
  uniforms: backdropUniforms,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform vec2 uHaloCenter;
    uniform float uAspect;
    varying vec2 vUv;

    void main() {
      // Aspect-corrected oval studio lightbox halo sitting directly behind & wrapping the popsicle!
      vec2 d = vUv - uHaloCenter;
      d.x *= uAspect * 1.24;
      d.y *= 0.88;
      float r = length(d);

      // Luminous warm creamy-ivory studio lightbox peak right behind the translucent ice (linear HDR!)
      vec3 centerGlow = vec3(1.62, 1.44, 1.22);
      // Warm peach-cream halo aura visibly hugging the popsicle silhouette
      vec3 haloWarm = vec3(0.96, 0.82, 0.70);
      // Warm muted taupe-blush studio sweep toward edges & corners (matches reference photo!)
      vec3 edgeTaupe = vec3(0.41, 0.31, 0.28);
      vec3 cornerDeep = vec3(0.30, 0.22, 0.20);

      float coreMask = exp(-r * r * 5.8);
      float haloMask = exp(-r * r * 2.15);
      float vig = smoothstep(0.48, 1.32, r);

      vec3 col = mix(edgeTaupe, haloWarm, haloMask);
      col = mix(col, centerGlow, coreMask);
      col = mix(col, cornerDeep, vig * 0.72);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const backdropScene = new THREE.Scene();
backdropScene.add(new THREE.Mesh(fsQuadGeo, backdropMat));

/** Fast 9-tap separable Gaussian blur shader for multi-mip optical frost */
const blurUniforms = {
  uTex: { value: null as THREE.Texture | null },
  uDir: { value: new THREE.Vector2(1, 0) },
  uTexelSize: { value: new THREE.Vector2(1 / 640, 1 / 360) },
};
const blurMat = new THREE.ShaderMaterial({
  depthTest: false,
  depthWrite: false,
  uniforms: blurUniforms,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D uTex;
    uniform vec2 uDir;
    uniform vec2 uTexelSize;
    varying vec2 vUv;

    void main() {
      vec2 stepUv = uDir * uTexelSize;
      vec3 sum = texture2D(uTex, vUv).rgb * 0.227027;
      sum += texture2D(uTex, clamp(vUv + stepUv * 1.3846, vec2(0.002), vec2(0.998))).rgb * 0.316216;
      sum += texture2D(uTex, clamp(vUv - stepUv * 1.3846, vec2(0.002), vec2(0.998))).rgb * 0.316216;
      sum += texture2D(uTex, clamp(vUv + stepUv * 3.2307, vec2(0.002), vec2(0.998))).rgb * 0.070270;
      sum += texture2D(uTex, clamp(vUv - stepUv * 3.2307, vec2(0.002), vec2(0.998))).rgb * 0.070270;
      gl_FragColor = vec4(sum, 1.0);
    }
  `,
});
const blurScene = new THREE.Scene();
blurScene.add(new THREE.Mesh(fsQuadGeo, blurMat));

/** Depth-only prepass material so separate water drops clip accurately against live ice & exposed fruits */
const depthOnlyMat = new THREE.MeshBasicMaterial({
  colorWrite: false,
  depthWrite: true,
  depthTest: true,
});

/** Final photographic display pass: warm AgX-inspired highlight rolloff + subtle studio film grain */
const displayUniforms = {
  uTex: { value: null as THREE.Texture | null },
  uTime: { value: 0 },
};
const displayMat = new THREE.ShaderMaterial({
  depthTest: false,
  depthWrite: false,
  uniforms: displayUniforms,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D uTex;
    uniform float uTime;
    varying vec2 vUv;

    // Clean ACES-fitted filmic curve preserving warm coral-reds and silky highlight desaturation!
    vec3 acesFilmic(vec3 x) {
      const float a = 2.51;
      const float b = 0.03;
      const float c = 2.43;
      const float d = 0.59;
      const float e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec3 hdr = texture2D(uTex, vUv).rgb;

      // Photographic exposure calibration
      hdr *= 1.08;

      // Filmic tone-mapping
      vec3 col = acesFilmic(hdr);

      // Gentle photographic micro-contrast S-curve
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.14);

      // Linear -> sRGB encoding
      col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));

      // Ultra-subtle macro studio sensor grain (eliminates gradient banding on soft studio halo)
      float grain = (hash12(gl_FragCoord.xy + fract(uTime) * 37.0) - 0.5) * 0.011;
      col = clamp(col + grain, 0.0, 1.0);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const displayScene = new THREE.Scene();
displayScene.add(new THREE.Mesh(fsQuadGeo, displayMat));

// === RENDER TARGETS ===
function makeRT(w: number, h: number, withDepth: boolean, linear = true): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
    magFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
    depthBuffer: withDepth,
    stencilBuffer: false,
  });
}

let rtWidth = 2;
let rtHeight = 2;
let backIceZRT: THREE.WebGLRenderTarget;
let interiorZRT: THREE.WebGLRenderTarget;
let bgRT: THREE.WebGLRenderTarget;
let bubblesRT: THREE.WebGLRenderTarget;
let blurTemp1RT: THREE.WebGLRenderTarget;
let bgBlur1RT: THREE.WebGLRenderTarget;
let blurTemp2RT: THREE.WebGLRenderTarget;
let bgBlur2RT: THREE.WebGLRenderTarget;
let postIceRT: THREE.WebGLRenderTarget;
let dropFieldRT: THREE.WebGLRenderTarget;
let compositeRT: THREE.WebGLRenderTarget;

function rebuildRenderTargets() {
  const dpr = renderer.getPixelRatio();
  rtWidth = Math.max(2, Math.floor(window.innerWidth * dpr));
  rtHeight = Math.max(2, Math.floor(window.innerHeight * dpr));
  const halfW = Math.max(2, rtWidth >> 1);
  const halfH = Math.max(2, rtHeight >> 1);
  const qtrW = Math.max(2, rtWidth >> 2);
  const qtrH = Math.max(2, rtHeight >> 2);

  backIceZRT?.dispose();
  interiorZRT?.dispose();
  bgRT?.dispose();
  bubblesRT?.dispose();
  blurTemp1RT?.dispose();
  bgBlur1RT?.dispose();
  blurTemp2RT?.dispose();
  bgBlur2RT?.dispose();
  postIceRT?.dispose();
  dropFieldRT?.dispose();
  compositeRT?.dispose();

  backIceZRT = makeRT(halfW, halfH, true, true);
  interiorZRT = makeRT(halfW, halfH, true, true);
  bgRT = makeRT(rtWidth, rtHeight, true, true);
  bubblesRT = makeRT(rtWidth, rtHeight, true, true);
  blurTemp1RT = makeRT(halfW, halfH, false, true);
  bgBlur1RT = makeRT(halfW, halfH, false, true);
  blurTemp2RT = makeRT(qtrW, qtrH, false, true);
  bgBlur2RT = makeRT(qtrW, qtrH, false, true);
  postIceRT = makeRT(rtWidth, rtHeight, true, true);
  dropFieldRT = makeRT(rtWidth, rtHeight, true, true);
  compositeRT = makeRT(rtWidth, rtHeight, true, true);

  backdropUniforms.uResolution.value.set(rtWidth, rtHeight);
  backdropUniforms.uAspect.value = rtWidth / rtHeight;
}

rebuildRenderTargets();

// === SUB-SCENES FOR CLEAN LAYER SEPARATION ===
const solidScene = new THREE.Scene();
solidScene.environment = studioEnv;
solidScene.add(buildStudioLights());

const backZScene = new THREE.Scene();
const bubblesScene = new THREE.Scene();
const iceScene = new THREE.Scene();
const dropsScene = new THREE.Scene();

// === SIMULATION & GENERATIVE POPSICLE STATE ===
let fruitAssembly: FruitAssembly | null = null;
let iceSystem: PopsicleIceSystem | null = null;
let waterDrops: WaterDropSystem | null = null;
let liquidFilm: LiquidFilmSystem | null = null;

const simParams = {
  speed: 1.0,
  frost: 0.58,
  bubbles: 0.92,
};

const meltState: MeltFieldState = {
  melt: initialMelt,
  time: 0,
  seedOffset: currentSeed * 13.7,
  heatSpots: [],
  pointerHeat: 0,
  pointerX: 0,
  pointerY: 0,
};

const MAX_HEAT_SPOTS = 24;

function buildPopsicle(seed: number) {
  currentSeed = seed;

  if (fruitAssembly) {
    solidScene.remove(fruitAssembly.group);
    fruitAssembly.dispose();
  }
  if (iceSystem) {
    iceScene.remove(iceSystem.iceMesh);
    backZScene.remove(iceSystem.backZMesh);
    bubblesScene.remove(iceSystem.bubblesMesh);
    iceSystem.dispose();
  }
  if (waterDrops) {
    dropsScene.remove(waterDrops.pendantGroup);
    waterDrops.dispose();
  }
  if (liquidFilm) {
    liquidFilm.dispose();
  }

  meltState.melt = initialMelt;
  meltState.time = 0;
  meltState.seedOffset = seed * 13.7;
  meltState.heatSpots = [];
  meltState.pointerHeat = 0;

  fruitAssembly = createFruitAssembly(seed);
  solidScene.add(fruitAssembly.group);

  iceSystem = createPopsicleIceSystem(seed);
  iceScene.add(iceSystem.iceMesh);
  backZScene.add(iceSystem.backZMesh);
  bubblesScene.add(iceSystem.bubblesMesh);

  liquidFilm = createLiquidFilmSystem(seed);
  iceSystem.uniforms.uFilmTex.value = liquidFilm.texture;

  waterDrops = createWaterDropSystem(seed, currentDropMode);
  dropsScene.add(waterDrops.pendantGroup);

  // Sync initial geometry & droplet anchors at frame 0!
  iceSystem.uniforms.uFrost.value = simParams.frost;
  iceSystem.update(meltState, simParams.bubbles);
  fruitAssembly.update(meltState, 0, liquidFilm.stickWetness);
  waterDrops.update(meltState, iceSystem, liquidFilm, 0, simParams.speed);
  syncWorkbenchUI();
}

function resetMelt() {
  meltState.melt = 0.035;
  meltState.time = 0;
  meltState.heatSpots = [];
  meltState.pointerHeat = 0;
  fruitAssembly?.reset();
  liquidFilm?.reset();
  waterDrops?.reset();
  if (iceSystem && fruitAssembly && waterDrops && liquidFilm) {
    iceSystem.update(meltState, simParams.bubbles);
    fruitAssembly.update(meltState, 0, liquidFilm.stickWetness);
    waterDrops.update(meltState, iceSystem, liquidFilm, 0, simParams.speed);
  }
  syncWorkbenchUI();
}

// === POINTER-ACCELERATED MELT INTERACTION ===
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const zPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const hitPoint = new THREE.Vector3();

let pointerActive = false;
let pointerPressed = false;
let orbitMode = false;

function updatePointerWorld(clientX: number, clientY: number) {
  pointerNdc.x = (clientX / window.innerWidth) * 2 - 1;
  pointerNdc.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  if (raycaster.ray.intersectPlane(zPlane, hitPoint)) {
    meltState.pointerX = hitPoint.x;
    meltState.pointerY = hitPoint.y;
    const onPopsicle =
      Math.abs(hitPoint.x) < POPSICLE.halfWidthBottom * 1.28 &&
      hitPoint.y > POPSICLE.yBottom - 0.18 &&
      hitPoint.y < POPSICLE.yTop + 0.18;
    pointerActive = onPopsicle;
  } else {
    pointerActive = false;
  }
}

function depositHeatSpot(x: number, y: number, dose: number) {
  const spots = meltState.heatSpots;
  // Merge into closest existing spot within 0.16 units to keep array compact & smooth
  for (let i = 0; i < spots.length; i++) {
    const dx = spots[i].x - x;
    const dy = spots[i].y - y;
    if (dx * dx + dy * dy < 0.026) {
      spots[i].heat = clamp(spots[i].heat + dose, 0, 0.95);
      return;
    }
  }
  if (spots.length < MAX_HEAT_SPOTS) {
    spots.push({ x, y, heat: clamp(dose, 0, 0.95) });
  } else {
    // Replace weakest spot
    let minIdx = 0;
    for (let i = 1; i < spots.length; i++) {
      if (spots[i].heat < spots[minIdx].heat) minIdx = i;
    }
    spots[minIdx].x = x;
    spots[minIdx].y = y;
    spots[minIdx].heat = clamp(dose, 0, 0.95);
  }
}

canvas.addEventListener('pointermove', (e) => {
  updatePointerWorld(e.clientX, e.clientY);
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 2) {
    // Right-drag temporarily enables orbit smoothly!
    orbit.enabled = true;
    return;
  }
  if (!orbitMode && e.button === 0) {
    pointerPressed = true;
    updatePointerWorld(e.clientX, e.clientY);
  }
});

window.addEventListener('pointerup', () => {
  pointerPressed = false;
  if (!orbitMode) orbit.enabled = false;
});

canvas.addEventListener('pointerleave', () => {
  pointerActive = false;
  pointerPressed = false;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// === UI CONTROLS ===
const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;
const btnSeed = document.getElementById('btn-seed') as HTMLButtonElement;
const btnOrbit = document.getElementById('btn-orbit') as HTMLButtonElement;
const btnHelp = document.getElementById('btn-help') as HTMLButtonElement;
const helpCard = document.getElementById('help-card') as HTMLDivElement;

const devDock = document.getElementById('dev-dock') as HTMLDivElement;
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const settingsPanel = document.getElementById('settings-panel') as HTMLDivElement;
const slMelt = document.getElementById('sl-melt') as HTMLInputElement;
const slSpeed = document.getElementById('sl-speed') as HTMLInputElement;
const slFrost = document.getElementById('sl-frost') as HTMLInputElement;
const slBubbles = document.getElementById('sl-bubbles') as HTMLInputElement;
const selDrops = document.getElementById('sel-drops') as HTMLSelectElement;
const valMelt = document.getElementById('val-melt') as HTMLOutputElement;
const valSpeed = document.getElementById('val-speed') as HTMLOutputElement;
const valFrost = document.getElementById('val-frost') as HTMLOutputElement;
const valBubbles = document.getElementById('val-bubbles') as HTMLOutputElement;

if (showSettings) {
  devDock.hidden = false;
}

// Dev-only top-left reference photo overlay (click image to enlarge/shrink, × to collapse)
const refCard = document.getElementById('ref-card') as HTMLElement | null;
const refImg = document.getElementById('ref-img') as HTMLImageElement | null;
const btnRefClose = document.getElementById('btn-ref-close') as HTMLButtonElement | null;
const btnRefOpen = document.getElementById('btn-ref-open') as HTMLButtonElement | null;

if (import.meta.env.DEV && !params.has('clean') && refCard && refImg && btnRefClose && btnRefOpen) {
  refImg.src = '/process/reference.jpg';
  refCard.hidden = false;
  refImg.addEventListener('error', () => {
    refCard.hidden = true;
    btnRefOpen.hidden = true;
  });
  refImg.addEventListener('click', () => {
    refCard.classList.toggle('expanded');
  });
  btnRefClose.addEventListener('click', () => {
    refCard.hidden = true;
    btnRefOpen.hidden = false;
  });
  btnRefOpen.addEventListener('click', () => {
    refCard.hidden = false;
    btnRefOpen.hidden = true;
  });
}

function updatePlayIcon() {
  btnPlay.innerHTML = paused
    ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>`
    : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>`;
  btnPlay.setAttribute('aria-pressed', String(paused));
}

function syncWorkbenchUI() {
  slMelt.value = meltState.melt.toFixed(3);
  valMelt.textContent = meltState.melt.toFixed(2);
  slSpeed.value = simParams.speed.toFixed(1);
  valSpeed.textContent = `${simParams.speed.toFixed(1)}×`;
  slFrost.value = simParams.frost.toFixed(2);
  valFrost.textContent = simParams.frost.toFixed(2);
  slBubbles.value = simParams.bubbles.toFixed(2);
  valBubbles.textContent = simParams.bubbles.toFixed(2);
  selDrops.value = currentDropMode;
}

btnPlay.addEventListener('click', () => {
  paused = !paused;
  updatePlayIcon();
});

btnReset.addEventListener('click', () => {
  resetMelt();
});

btnSeed.addEventListener('click', () => {
  buildPopsicle(currentSeed + 1);
});

btnOrbit.addEventListener('click', () => {
  orbitMode = !orbitMode;
  orbit.enabled = orbitMode;
  btnOrbit.setAttribute('aria-pressed', String(orbitMode));
  if (!orbitMode) {
    // Smoothly snap back to hero macro portrait view
    camera.position.copy(BASE_CAM_POS);
    orbit.target.copy(BASE_TARGET);
    orbit.update();
  }
});

btnHelp.addEventListener('click', () => {
  const open = helpCard.hidden;
  helpCard.hidden = !open;
  btnHelp.setAttribute('aria-expanded', String(open));
});

btnSettings.addEventListener('click', () => {
  const open = settingsPanel.hidden;
  settingsPanel.hidden = !open;
  btnSettings.setAttribute('aria-expanded', String(open));
});

slMelt.addEventListener('input', () => {
  meltState.melt = Number(slMelt.value);
  valMelt.textContent = meltState.melt.toFixed(2);
  if (iceSystem && fruitAssembly && waterDrops && liquidFilm) {
    iceSystem.update(meltState, simParams.bubbles);
    fruitAssembly.update(meltState, 0, Math.max(liquidFilm.stickWetness, meltState.melt * 1.15));
    waterDrops.update(meltState, iceSystem, liquidFilm, 0, simParams.speed);
  }
});

slSpeed.addEventListener('input', () => {
  simParams.speed = Number(slSpeed.value);
  valSpeed.textContent = `${simParams.speed.toFixed(1)}×`;
});

slFrost.addEventListener('input', () => {
  simParams.frost = Number(slFrost.value);
  valFrost.textContent = simParams.frost.toFixed(2);
  if (iceSystem) iceSystem.uniforms.uFrost.value = simParams.frost;
});

slBubbles.addEventListener('input', () => {
  simParams.bubbles = Number(slBubbles.value);
  valBubbles.textContent = simParams.bubbles.toFixed(2);
  if (iceSystem) iceSystem.update(meltState, simParams.bubbles);
});

selDrops.addEventListener('change', () => {
  const mode = selDrops.value as DropMode;
  currentDropMode = mode;
  waterDrops?.setMode(mode);
  if (iceSystem && waterDrops && liquidFilm) {
    waterDrops.update(meltState, iceSystem, liquidFilm, 0, simParams.speed);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
    updatePlayIcon();
  } else if (e.key === 'r' || e.key === 'R') {
    resetMelt();
  } else if (e.key === 'n' || e.key === 'N') {
    buildPopsicle(currentSeed + 1);
  } else if (e.key === 'o' || e.key === 'O') {
    btnOrbit.click();
  } else if (e.key === '?') {
    btnHelp.click();
  }
});

// === MULTI-PASS OPTICAL RENDER FUNCTION ===
const clearColorDark = new THREE.Color(0x000000);
const clearDepthVal = new THREE.Color(-10, 0, 0);

function renderSeparableBlur(
  srcTex: THREE.Texture,
  tempRT: THREE.WebGLRenderTarget,
  dstRT: THREE.WebGLRenderTarget,
  spread: number,
) {
  blurUniforms.uTexelSize.value.set(spread / dstRT.width, spread / dstRT.height);

  // Horizontal pass
  blurUniforms.uTex.value = srcTex;
  blurUniforms.uDir.value.set(1, 0);
  renderer.setRenderTarget(tempRT);
  renderer.clear(true, false, false);
  renderer.render(blurScene, fsCam);

  // Vertical pass
  blurUniforms.uTex.value = tempRT.texture;
  blurUniforms.uDir.value.set(0, 1);
  renderer.setRenderTarget(dstRT);
  renderer.clear(true, false, false);
  renderer.render(blurScene, fsCam);
}

function renderFrame() {
  if (!fruitAssembly || !iceSystem || !waterDrops) return;

  // Project popsicle center into screen UV so studio lightbox halo tracks subtly when orbiting!
  const centerProj = new THREE.Vector3(0, 0.08, 0).project(camera);
  backdropUniforms.uHaloCenter.value.set(centerProj.x * 0.5 + 0.5, centerProj.y * 0.5 + 0.5);

  // --- PASS 1: Back-Face Ice World-Z (measures exact optical slab thickness!) ---
  renderer.setRenderTarget(backIceZRT);
  renderer.setClearColor(clearDepthVal, 1);
  renderer.clear(true, true, false);
  renderer.render(backZScene, camera);

  // --- PASS 2: Solid Interior Fruits & Wood Stick World-Z (measures exact front-layer ice thickness!) ---
  renderer.setRenderTarget(interiorZRT);
  renderer.setClearColor(clearDepthVal, 1);
  renderer.clear(true, true, false);
  solidScene.overrideMaterial = iceSystem.solidWorldZMat;
  renderer.render(solidScene, camera);
  solidScene.overrideMaterial = null;

  // --- PASS 3: Interior Scene behind front ice surface (Lightbox + Solid Fruits) ---
  renderer.setRenderTarget(bgRT);
  renderer.setClearColor(clearColorDark, 1);
  renderer.clear(true, true, false);
  renderer.render(backdropScene, fsCam);
  renderer.render(solidScene, camera);

  // --- PASS 3b: Dedicated Crisp Internal Air Micro-Bubbles (depth-occluded by solid fruits!) ---
  renderer.setRenderTarget(bubblesRT);
  renderer.setClearColor(clearColorDark, 0);
  renderer.clear(true, true, false);
  solidScene.overrideMaterial = depthOnlyMat;
  renderer.render(solidScene, camera);
  solidScene.overrideMaterial = null;
  renderer.render(bubblesScene, camera);

  // --- PASS 4: Multi-Mip Separable Optical Frost Blur ---
  renderSeparableBlur(bgRT.texture, blurTemp1RT, bgBlur1RT, 1.45);
  renderSeparableBlur(bgBlur1RT.texture, blurTemp2RT, bgBlur2RT, 2.25);

  // --- PASS 5: Post-Ice Scene (Lightbox + Protruding/Exposed Solids + Hero Optical Refractive Ice) ---
  iceSystem.uniforms.uBgTex.value = bgRT.texture;
  iceSystem.uniforms.uBgBlur1.value = bgBlur1RT.texture;
  iceSystem.uniforms.uBgBlur2.value = bgBlur2RT.texture;
  iceSystem.uniforms.uBubblesTex.value = bubblesRT.texture;
  iceSystem.uniforms.uInteriorZ.value = interiorZRT.texture;
  iceSystem.uniforms.uBackIceZ.value = backIceZRT.texture;
  iceSystem.uniforms.uResolution.value.set(rtWidth, rtHeight);

  renderer.setRenderTarget(postIceRT);
  renderer.clear(true, true, false);
  renderer.render(backdropScene, fsCam);
  renderer.render(solidScene, camera);
  renderer.render(iceScene, camera);

  // --- PASS 6: Separate Water Drops (Additive Metaball Liquid Field + Optical Resolve + 3D Pendant Drops!) ---
  waterDrops.uniforms.uSceneTex.value = postIceRT.texture;
  waterDrops.uniforms.uDropFieldTex.value = dropFieldRT.texture;
  waterDrops.uniforms.uResolution.value.set(rtWidth, rtHeight);

  // 6a. Accumulate smooth additive liquid metaball potential field (depth-tested against live ice & solids!)
  renderer.setRenderTarget(dropFieldRT);
  renderer.setClearColor(clearColorDark, 0);
  renderer.clear(true, true, false);
  solidScene.overrideMaterial = depthOnlyMat;
  iceScene.overrideMaterial = depthOnlyMat;
  renderer.render(solidScene, camera);
  renderer.render(iceScene, camera);
  solidScene.overrideMaterial = null;
  iceScene.overrideMaterial = null;
  renderer.render(waterDrops.fieldScene, camera);

  // 6b. Resolve merged liquid droplets optically over postIceRT with C2 Sobel liquid normals & refraction!
  renderer.setRenderTarget(compositeRT);
  renderer.clear(true, true, false);
  renderer.render(waterDrops.resolveScene, fsCam);

  // 6c. Depth prepass + 3D Rayleigh-Plateau bottom-rim hanging & pinching pendant drops
  solidScene.overrideMaterial = depthOnlyMat;
  iceScene.overrideMaterial = depthOnlyMat;
  renderer.render(solidScene, camera);
  renderer.render(iceScene, camera);
  solidScene.overrideMaterial = null;
  iceScene.overrideMaterial = null;
  renderer.render(dropsScene, camera);

  // --- PASS 7: Final Photographic Tone-Mapping + Subtle Macro Grain to Screen ---
  displayUniforms.uTex.value = compositeRT.texture;
  displayUniforms.uTime.value = meltState.time;
  renderer.setRenderTarget(null);
  renderer.clear(true, false, false);
  renderer.render(displayScene, fsCam);
}

// === ANIMATION LOOP ===
let lastTime = performance.now();

function tick(now: number) {
  requestAnimationFrame(tick);

  const rawDt = Math.min(0.05, Math.max(0, (now - lastTime) * 0.001));
  lastTime = now;
  const dt = paused ? 0 : rawDt;

  // Smooth live pointer heat ramp
  const targetHeat = pointerActive ? (pointerPressed ? 1.0 : 0.42) : 0.0;
  meltState.pointerHeat += (targetHeat - meltState.pointerHeat) * Math.min(1, rawDt * 8.0);

  if (dt > 0 && fruitAssembly && iceSystem && waterDrops && liquidFilm) {
    meltState.time += dt;

    // Slow deterministic ambient melt + pointer-accelerated warmth!
    const pointerGlobalBoost = pointerActive ? (pointerPressed ? 11.5 : 3.2) : 1.0;
    const baseMeltRate = 0.0028;
    meltState.melt = clamp(meltState.melt + dt * baseMeltRate * simParams.speed * pointerGlobalBoost, 0, 0.98);

    // Deposit localized warmth where pointer rests on the popsicle
    if (pointerActive && !orbitMode) {
      const localDose = dt * (pointerPressed ? 0.34 : 0.075) * simParams.speed;
      depositHeatSpot(meltState.pointerX, meltState.pointerY, localDose);
    }

    // Update 2D viscous liquid glaze PDE, live melting geometry, solid fruits/wet stick, and surface/pendant drops!
    liquidFilm.update(meltState, dt, simParams.speed);
    iceSystem.update(meltState, simParams.bubbles);
    fruitAssembly.update(meltState, dt, liquidFilm.stickWetness);
    waterDrops.update(meltState, iceSystem, liquidFilm, dt, simParams.speed);

    if (showSettings && !settingsPanel.hidden) {
      slMelt.value = meltState.melt.toFixed(3);
      valMelt.textContent = meltState.melt.toFixed(2);
    }
  }

  if (orbit.enabled) {
    orbit.update();
  }

  renderFrame();
}

// === RESIZE HANDLER ===
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  rebuildRenderTargets();
});

// === BOOT & VERIFICATION HOOK ===
updatePlayIcon();
buildPopsicle(currentSeed);

// Expose deterministic inspection API for Playwright verification captures
(window as unknown as Record<string, unknown>).__day03 = {
  setMelt(m: number) {
    meltState.melt = clamp(m, 0, 0.98);
    if (iceSystem && fruitAssembly && waterDrops && liquidFilm) {
      iceSystem.update(meltState, simParams.bubbles);
      fruitAssembly.update(meltState, 0, Math.max(liquidFilm.stickWetness, meltState.melt * 1.15));
      waterDrops.update(meltState, iceSystem, liquidFilm, 0, simParams.speed);
    }
    renderFrame();
  },
  step(seconds: number) {
    const steps = Math.max(1, Math.ceil(seconds / 0.033));
    const dt = seconds / steps;
    for (let i = 0; i < steps; i++) {
      meltState.time += dt;
      meltState.melt = clamp(meltState.melt + dt * 0.0028 * simParams.speed, 0, 0.98);
      if (iceSystem && fruitAssembly && waterDrops && liquidFilm) {
        liquidFilm.update(meltState, dt, simParams.speed);
        iceSystem.update(meltState, simParams.bubbles);
        fruitAssembly.update(meltState, dt, liquidFilm.stickWetness);
        waterDrops.update(meltState, iceSystem, liquidFilm, dt, simParams.speed);
      }
    }
    renderFrame();
  },
  warmAt(x: number, y: number, dose: number) {
    depositHeatSpot(x, y, dose);
    meltState.pointerX = x;
    meltState.pointerY = y;
    meltState.pointerHeat = 1.0;
    if (iceSystem && fruitAssembly && waterDrops && liquidFilm) {
      liquidFilm.update(meltState, 0.033, simParams.speed);
      iceSystem.update(meltState, simParams.bubbles);
      fruitAssembly.update(meltState, 0.033, liquidFilm.stickWetness);
      waterDrops.update(meltState, iceSystem, liquidFilm, 0.033, simParams.speed);
    }
    renderFrame();
  },
  setSeed(s: number) {
    buildPopsicle(s);
    renderFrame();
  },
  setDropMode(mode: DropMode) {
    currentDropMode = mode;
    selDrops.value = mode;
    waterDrops?.setMode(mode);
    if (iceSystem && waterDrops && liquidFilm) {
      waterDrops.update(meltState, iceSystem, liquidFilm, 0, simParams.speed);
    }
    renderFrame();
  },
  setCamera(x: number, y: number, z: number) {
    camera.position.set(x, y, z);
    camera.lookAt(BASE_TARGET);
    renderFrame();
  },
  getState() {
    return { melt: meltState.melt, time: meltState.time, seed: currentSeed };
  },
};

requestAnimationFrame(tick);
