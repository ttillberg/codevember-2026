import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { clamp } from './rng';
import { DEFAULT_INITIAL_MELT, FROST_CLEAR_MELT, getMeltBounds, MeltFieldState, POPSICLE } from './shape';
import { createMacroStudioEnv, disposeSeedTextureCache } from './textures';
import { createFruitAssembly, FruitAssembly } from './fruits';
import { createPopsicleIceSystem, PopsicleIceSystem } from './popsicleIce';
import {
  createWaterDropSystem,
  DEFAULT_DROP_DEBUG,
  DropDebugParams,
  DropMode,
  MAX_BOTTOM_DROPS,
  WaterDropSystem,
} from './waterDrops';
import { createLiquidFilmSystem, LiquidFilmSystem } from './liquidFilm';
import {
  BaseKind,
  DEFAULT_RECIPE,
  FLAVOR_LIST,
  FlavorId,
  normalizeRecipe,
  POPSICLE_PRESETS,
  PopsiclePreset,
  PopsicleRecipe,
  recipesMatch,
  TOPPING_LIST,
  ToppingId,
} from './recipe';

// === URL QUERY FLAGS ===
const params = new URLSearchParams(window.location.search);
if (params.has('clean')) document.documentElement.classList.add('clean');

const showSettings = import.meta.env.DEV || params.has('settings');
const rawSeed = Number(params.get('seed'));
let currentSeed = Number.isFinite(rawSeed) && rawSeed >= 1 ? Math.floor(rawSeed) : 1;
const rawMelt = params.has('melt') ? Number(params.get('melt')) : DEFAULT_INITIAL_MELT;
const initialMelt = clamp(Number.isFinite(rawMelt) ? rawMelt : DEFAULT_INITIAL_MELT, 0, 1.0);
let paused = params.has('paused');
type FallFocusMode = 'pause' | 'slow' | 'off';

const SETTINGS_STORAGE_KEY = 'codevember-03-melt-settings-v2';
const LEGACY_SETTINGS_STORAGE_KEY = 'codevember-03-melt-settings-v1';

const DEFAULT_SIM_PARAMS = {
  speed: 1.0,
  turntable: 0.0,
  frost: 0.8,
  bubbles: 0.55,
} as const;
const DEFAULT_DROP_MODE: DropMode = 'off';
const DEFAULT_FALL_MODE: FallFocusMode = 'off';

interface PersistedSettings {
  speed: number;
  turntable: number;
  frost: number;
  bubbles: number;
  drops: DropMode;
  onFall: FallFocusMode;
  dropDebug: DropDebugParams;
}

function readFinite(val: unknown, fallback: number, min: number, max: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? clamp(val, min, max) : fallback;
}

function loadPersistedSettings(): Partial<PersistedSettings> | null {
  try {
    let raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    let fromLegacy = false;
    if (!raw) {
      raw = window.localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
      fromLegacy = Boolean(raw);
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    const out: Partial<PersistedSettings> = {
      speed: readFinite(parsed.speed, DEFAULT_SIM_PARAMS.speed, 0.2, 6.0),
      turntable: fromLegacy
        ? DEFAULT_SIM_PARAMS.turntable
        : readFinite(parsed.turntable, DEFAULT_SIM_PARAMS.turntable, 0, 1.0),
      frost: readFinite(parsed.frost, DEFAULT_SIM_PARAMS.frost, 0.1, 1.0),
      bubbles: readFinite(parsed.bubbles, DEFAULT_SIM_PARAMS.bubbles, 0, 1.0),
    };
    if (parsed.drops === 'minimal' || parsed.drops === 'full' || parsed.drops === 'off') {
      out.drops = parsed.drops;
    }
    if (parsed.onFall === 'pause' || parsed.onFall === 'slow' || parsed.onFall === 'off') {
      out.onFall = parsed.onFall;
    }
    const dd = parsed.dropDebug as Record<string, unknown> | undefined;
    if (dd && typeof dd === 'object') {
      out.dropDebug = {
        sag: readFinite(dd.sag, DEFAULT_DROP_DEBUG.sag, 0, 1.6),
        stretch: readFinite(dd.stretch, DEFAULT_DROP_DEBUG.stretch, 0.85, 1.8),
        edgeBlur: readFinite(dd.edgeBlur, DEFAULT_DROP_DEBUG.edgeBlur, 0, 1.5),
        shadow: readFinite(dd.shadow, DEFAULT_DROP_DEBUG.shadow, 0, 1.5),
        shadowBlur: readFinite(dd.shadowBlur, DEFAULT_DROP_DEBUG.shadowBlur, 0.2, 2.0),
        rimDark: readFinite(dd.rimDark, DEFAULT_DROP_DEBUG.rimDark, 0, 1.5),
        size: readFinite(dd.size, DEFAULT_DROP_DEBUG.size, 0.5, 1.8),
        bottomPool: readFinite(dd.bottomPool, DEFAULT_DROP_DEBUG.bottomPool, 0, 2.0),
        dripRate: readFinite(dd.dripRate, DEFAULT_DROP_DEBUG.dripRate, 0, 2.0),
        bottomDrops: Math.round(readFinite(dd.bottomDrops, DEFAULT_DROP_DEBUG.bottomDrops, 0, MAX_BOTTOM_DROPS)),
      };
    }
    return out;
  } catch {
    return null;
  }
}

const storedSettings = loadPersistedSettings();

const rawDropParam = params.get('drops');
let currentDropMode: DropMode =
  rawDropParam === 'full' || rawDropParam === 'off' || rawDropParam === 'minimal'
    ? rawDropParam
    : (storedSettings?.drops ?? DEFAULT_DROP_MODE);

const rawFallParam = params.get('fall');
let currentFallMode: FallFocusMode =
  rawFallParam === 'pause' || rawFallParam === 'slow' || rawFallParam === 'off'
    ? rawFallParam
    : (storedSettings?.onFall ?? DEFAULT_FALL_MODE);
/** Smoothly eased blend [0..1] when a detached fruit is falling through frame */
let fallFocusBlend = 0;

// Detect mobile / touch devices to keep 60fps smooth on mobile GPUs without sacrificing crispness
const isMobile =
  (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
  /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function targetPixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, isMobile ? 1.35 : 2);
}

function safeViewportSize(): { w: number; h: number } {
  return {
    w: Math.max(1, window.innerWidth),
    h: Math.max(1, window.innerHeight),
  };
}

// === RENDERER ===
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({
  canvas,
  // All 3D scenes render to offscreen targets and composite via fullscreen Pass 7, so default-backbuffer MSAA is wasted tile bandwidth!
  antialias: false,
  powerPreference: 'high-performance',
  alpha: false,
});
const initVP = safeViewportSize();
renderer.setPixelRatio(targetPixelRatio());
renderer.setSize(initVP.w, initVP.h);
// Keep intermediate HDR targets linear; perform single photographic film curve in final display pass!
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;

let contextLost = false;
let renderDirty = true;
let bubblesRtHasContent = true;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLost = true;
});
canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  rebuildRenderTargets();
  renderDirty = true;
});

// === MACRO STUDIO CAMERA (~90mm telephoto portrait framing with subtle underside perspective) ===
const camera = new THREE.PerspectiveCamera(27, initVP.w / initVP.h, 0.1, 30);
const BASE_CAM_POS = new THREE.Vector3(0, -1.16, 5.66);
const BASE_TARGET = new THREE.Vector3(0, -0.09, 0);
camera.position.copy(BASE_CAM_POS);
camera.lookAt(BASE_TARGET);

// Subtle cinematic telephoto dolly-back as the popsicle melts (+1.75 units ≈ 30% wider framing by bare stick)
const MELT_ZOOM_OUT_MAX = 1.75;
let appliedMeltZoom = 0;
let initialBootDone = false;
const _zoomOffsetVec = new THREE.Vector3();

function evalMeltZoomOffset(melt: number): number {
  const t = clamp((melt - 0.05) / 0.93, 0, 1);
  return t * t * (3 - 2 * t) * MELT_ZOOM_OUT_MAX;
}

function applyMeltCameraZoom(dt: number, immediate = false) {
  const targetZoom = evalMeltZoomOffset(meltState.melt);
  const diff = targetZoom - appliedMeltZoom;
  if (Math.abs(diff) < 1e-4) {
    appliedMeltZoom = targetZoom;
    return;
  }
  const stepZoom = immediate ? diff : diff * (1 - Math.exp(-dt * 3.8));
  _zoomOffsetVec.copy(camera.position).sub(orbit.target);
  const curDist = _zoomOffsetVec.length();
  if (curDist < 1e-4) return;
  const nextDist = clamp(curDist + stepZoom, orbit.minDistance, orbit.maxDistance);
  const actualDelta = nextDist - curDist;
  if (Math.abs(actualDelta) > 1e-5) {
    _zoomOffsetVec.multiplyScalar(nextDist / curDist);
    camera.position.copy(orbit.target).add(_zoomOffsetVec);
    camera.updateMatrixWorld();
    renderDirty = true;
  }
  appliedMeltZoom += immediate ? diff : actualDelta;
}

const orbit = new OrbitControls(camera, canvas);
orbit.target.copy(BASE_TARGET);
orbit.enableDamping = true;
orbit.dampingFactor = 0.065;
orbit.rotateSpeed = 0.72;
orbit.enablePan = false;
// Desktop: left-drag outside the ice cream (or right-drag anywhere) rotates 360°; scroll zooms.
// Mobile/touch: 1 finger melts/rubs frost/grabs berries; 2 fingers rotate + pinch-zoom!
orbit.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE,
};
orbit.touches = {
  ONE: null,
  TWO: THREE.TOUCH.DOLLY_ROTATE,
};
orbit.minDistance = 3.2;
orbit.maxDistance = 9.0;
// Curated macro studio vertical tilt band (~20° above to ~17.5° below horizontal) with full 360° spin
orbit.minPolarAngle = Math.PI * 0.5 - 0.35;
orbit.maxPolarAngle = Math.PI * 0.5 + 0.31;
orbit.enabled = true;
orbit.update();
orbit.saveState();
let userOrbiting = false;
orbit.addEventListener('start', () => {
  userOrbiting = true;
  syncPointerCursor();
});
orbit.addEventListener('end', () => {
  userOrbiting = false;
  syncPointerCursor();
});
orbit.addEventListener('change', () => {
  renderDirty = true;
});

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
  uHaloCenter: { value: new THREE.Vector2(0.5, 0.54) },
  uAspect: { value: initVP.w / initVP.h },
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

      // Alpha = 0.0 tags studio backdrop air (solids write 1.0, ice writes 0.25 / 0.55 near fruit contact)
      gl_FragColor = vec4(col, 0.0);
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

/** Depth-only prepass material so separate water drops clip accurately against live ice & exposed fruits (including DoubleSide ribbons) */
const depthOnlyMat = new THREE.MeshBasicMaterial({
  colorWrite: false,
  depthWrite: true,
  depthTest: true,
  side: THREE.DoubleSide,
});

/** Final photographic display pass: warm AgX-inspired highlight rolloff + subtle studio film grain */
const displayUniforms = {
  uTex: { value: null as THREE.Texture | null },
  uTime: { value: 0 },
  uMaskOnly: { value: 0 },
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
    uniform float uMaskOnly;
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
      vec4 tex = texture2D(uTex, vUv);
      if (uMaskOnly > 0.5) {
        float m = smoothstep(0.015, 0.22, tex.a);
        gl_FragColor = vec4(vec3(m), 1.0);
        return;
      }
      vec3 hdr = tex.rgb;

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
function makeRT(
  w: number,
  h: number,
  withDepth: boolean,
  linear = true,
  type: THREE.TextureDataType = THREE.HalfFloatType,
): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
    type,
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
let blurTemp3RT: THREE.WebGLRenderTarget;
let bgBlur3RT: THREE.WebGLRenderTarget;
let postIceRT: THREE.WebGLRenderTarget;
let dropFieldRT: THREE.WebGLRenderTarget;
let compositeRT: THREE.WebGLRenderTarget;

function rebuildRenderTargets() {
  const dpr = renderer.getPixelRatio();
  const vp = safeViewportSize();
  rtWidth = Math.max(2, Math.floor(vp.w * dpr));
  rtHeight = Math.max(2, Math.floor(vp.h * dpr));
  const halfW = Math.max(2, rtWidth >> 1);
  const halfH = Math.max(2, rtHeight >> 1);
  const qtrW = Math.max(2, rtWidth >> 2);
  const qtrH = Math.max(2, rtHeight >> 2);
  const eighthW = Math.max(2, rtWidth >> 3);
  const eighthH = Math.max(2, rtHeight >> 3);
  const zW = isMobile ? Math.max(2, Math.floor(rtWidth * 0.4)) : halfW;
  const zH = isMobile ? Math.max(2, Math.floor(rtHeight * 0.4)) : halfH;
  const bubW = isMobile ? Math.max(2, Math.floor(rtWidth * 0.75)) : rtWidth;
  const bubH = isMobile ? Math.max(2, Math.floor(rtHeight * 0.75)) : rtHeight;

  backIceZRT?.dispose();
  interiorZRT?.dispose();
  bgRT?.dispose();
  bubblesRT?.dispose();
  blurTemp1RT?.dispose();
  bgBlur1RT?.dispose();
  blurTemp2RT?.dispose();
  bgBlur2RT?.dispose();
  blurTemp3RT?.dispose();
  bgBlur3RT?.dispose();
  postIceRT?.dispose();
  dropFieldRT?.dispose();
  compositeRT?.dispose();

  // NearestFilter on camera-depth targets guarantees far clear sentinel (100.0) NEVER interpolates across edges!
  backIceZRT = makeRT(zW, zH, true, false);
  interiorZRT = makeRT(zW, zH, true, false);
  bgRT = makeRT(rtWidth, rtHeight, true, true);
  bubblesRT = makeRT(bubW, bubH, true, true, isMobile ? THREE.UnsignedByteType : THREE.HalfFloatType);
  blurTemp1RT = makeRT(halfW, halfH, false, true);
  bgBlur1RT = makeRT(halfW, halfH, false, true);
  blurTemp2RT = makeRT(qtrW, qtrH, false, true);
  bgBlur2RT = makeRT(qtrW, qtrH, false, true);
  blurTemp3RT = makeRT(eighthW, eighthH, false, true);
  bgBlur3RT = makeRT(eighthW, eighthH, false, true);
  postIceRT = makeRT(rtWidth, rtHeight, true, true);
  dropFieldRT = makeRT(rtWidth, rtHeight, true, true);
  compositeRT = makeRT(rtWidth, rtHeight, true, true);

  backdropUniforms.uAspect.value = rtWidth / rtHeight;
  bubblesRtHasContent = true;
}

rebuildRenderTargets();

// === SUB-SCENES FOR CLEAN LAYER SEPARATION ===
const solidScene = new THREE.Scene();
solidScene.environment = studioEnv;
const solidLights = buildStudioLights();
solidScene.add(solidLights);

const backZScene = new THREE.Scene();
const bubblesScene = new THREE.Scene();
const iceScene = new THREE.Scene();
const dropsScene = new THREE.Scene();

// === SIMULATION & GENERATIVE POPSICLE STATE ===
let fruitAssembly: FruitAssembly | null = null;
let iceSystem: PopsicleIceSystem | null = null;
let waterDrops: WaterDropSystem | null = null;
let liquidFilm: LiquidFilmSystem | null = null;

const rawTurntableParam = params.has('turntable') ? Number(params.get('turntable')) : NaN;
const simParams = {
  speed: storedSettings?.speed ?? DEFAULT_SIM_PARAMS.speed,
  turntable: Number.isFinite(rawTurntableParam)
    ? clamp(rawTurntableParam, 0, 1.0)
    : (storedSettings?.turntable ?? DEFAULT_SIM_PARAMS.turntable),
  frost: storedSettings?.frost ?? DEFAULT_SIM_PARAMS.frost,
  bubbles: storedSettings?.bubbles ?? DEFAULT_SIM_PARAMS.bubbles,
};

const dropDebug: DropDebugParams = {
  ...DEFAULT_DROP_DEBUG,
  ...(storedSettings?.dropDebug ?? {}),
};

function serializeSettings(): PersistedSettings {
  return {
    speed: Number(simParams.speed.toFixed(2)),
    turntable: Number(simParams.turntable.toFixed(2)),
    frost: Number(simParams.frost.toFixed(2)),
    bubbles: Number(simParams.bubbles.toFixed(2)),
    drops: currentDropMode,
    onFall: currentFallMode,
    dropDebug: {
      sag: Number(dropDebug.sag.toFixed(2)),
      stretch: Number(dropDebug.stretch.toFixed(2)),
      edgeBlur: Number(dropDebug.edgeBlur.toFixed(2)),
      shadow: Number(dropDebug.shadow.toFixed(2)),
      shadowBlur: Number(dropDebug.shadowBlur.toFixed(2)),
      rimDark: Number(dropDebug.rimDark.toFixed(2)),
      size: Number(dropDebug.size.toFixed(2)),
      bottomPool: Number(dropDebug.bottomPool.toFixed(2)),
      bottomDrops: Math.round(dropDebug.bottomDrops),
      dripRate: Number(dropDebug.dripRate.toFixed(2)),
    },
  };
}

function savePersistedSettings() {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(serializeSettings()));
  } catch {
    // Ignore storage errors (private mode / quota / disabled storage)
  }
}

function clearPersistedSettings() {
  try {
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_SETTINGS_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy textarea copy (needed on plain HTTP LAN origins)
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const meltState: MeltFieldState = {
  melt: initialMelt,
  time: 0,
  seedOffset: currentSeed * 13.7,
  heatSpots: [],
  pointerHeat: 0,
  pointerX: 0,
  pointerY: 0,
  bottomPool: dropDebug.bottomPool,
  bottomLobes: [1, 1, 1, 1],
  pendantPull: [0, 0, 0, 0],
};

const MAX_HEAT_SPOTS = 24;

let currentRecipe: PopsicleRecipe = {
  base: DEFAULT_RECIPE.base,
  flavors: [...DEFAULT_RECIPE.flavors],
  toppings: [...DEFAULT_RECIPE.toppings],
};

let pointerActive = false;
let pointerPressed = false;
let orbitDragging = false;
let hoveringOutsideIce = false;
let twoFingerOrbiting = false;
let meltDragPointerId: number | null = null;
let activeGrabPointerId: number | null = null;
let rightOrbitPointerId: number | null = null;
const activeTouchIds = new Set<number>();
let prevFrostU: number | null = null;
let prevFrostV: number | null = null;
let pendingPointerMove = false;
let pendingPointerX = 0;
let pendingPointerY = 0;

function syncSystemsToMelt(targetMelt: number) {
  releaseActiveGrab();
  meltState.melt = clamp(Number.isFinite(targetMelt) ? targetMelt : DEFAULT_INITIAL_MELT, 0, 1.0);
  fallFocusBlend = 0;
  if (meltState.melt <= DEFAULT_INITIAL_MELT + 0.005) {
    meltState.heatSpots = [];
    meltState.pointerHeat = 0;
    meltState.bottomLobes = [1, 1, 1, 1];
    meltState.pendantPull = [0, 0, 0, 0];
    waterDrops?.reset();
  }
  if (iceSystem && fruitAssembly && waterDrops && liquidFilm) {
    liquidFilm.syncRimeToMelt(meltState.melt);
    waterDrops.clearFrostDrops();
    iceSystem.update(meltState, simParams.bubbles, true);
    fruitAssembly.update(meltState, 0, liquidFilm.stickWetness);
    waterDrops.update(meltState, iceSystem, liquidFilm, 0, simParams.speed);
  }
  applyMeltCameraZoom(0, true);
  renderDirty = true;
}

function buildPopsicle(seed: number, startMelt = initialMelt) {
  if (activeGrabPointerId !== null) {
    releaseActiveGrab();
  }
  if (seed !== currentSeed) {
    // Free cached CanvasTextures belonging to the previous seed so VRAM never grows across `New mix`!
    disposeSeedTextureCache();
  }
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

  meltState.melt = clamp(startMelt, 0, 1.0);
  meltState.time = 0;
  meltState.seedOffset = seed * 13.7;
  meltState.heatSpots = [];
  meltState.pointerHeat = 0;
  meltState.bottomPool = dropDebug.bottomPool;
  meltState.bottomLobes = [1, 1, 1, 1];
  meltState.pendantPull = [0, 0, 0, 0];
  fallFocusBlend = 0;

  fruitAssembly = createFruitAssembly(seed, currentRecipe);
  solidScene.add(fruitAssembly.group);

  iceSystem = createPopsicleIceSystem(seed, isMobile, currentRecipe);
  iceScene.add(iceSystem.iceMesh);
  backZScene.add(iceSystem.backZMesh);
  bubblesScene.add(iceSystem.bubblesMesh);

  liquidFilm = createLiquidFilmSystem(seed);
  if (Math.abs(meltState.melt - DEFAULT_INITIAL_MELT) > 0.001) {
    liquidFilm.syncRimeToMelt(meltState.melt);
  }
  iceSystem.uniforms.uFilmTex.value = liquidFilm.texture;
  iceSystem.uniforms.uRimeTex.value = liquidFilm.rimeTexture;

  waterDrops = createWaterDropSystem(seed, currentDropMode, currentRecipe);
  waterDrops.setDebugParams(dropDebug);
  dropsScene.add(waterDrops.pendantGroup);

  // Sync initial geometry & droplet anchors at frame 0!
  iceSystem.uniforms.uFrost.value = simParams.frost;
  iceSystem.update(meltState, simParams.bubbles, true);
  fruitAssembly.update(meltState, 0, liquidFilm.stickWetness);
  waterDrops.update(meltState, iceSystem, liquidFilm, 0, simParams.speed);
  if (paused || !initialBootDone) {
    applyMeltCameraZoom(0, true);
    initialBootDone = true;
  }
  syncWorkbenchUI();
  syncCustomizeUI();
  renderDirty = true;
}

function applyRecipe(nextRaw: PopsicleRecipe, forceRefreezeIfMelted = true) {
  const prevBase = currentRecipe.base;
  const prevToppingsKey = currentRecipe.toppings.join(',');
  const next = normalizeRecipe(nextRaw);
  currentRecipe = next;

  const baseChanged = next.base !== prevBase;
  const toppingsChanged = next.toppings.join(',') !== prevToppingsKey;

  // If the popsicle is already mostly melted away, refreeze fresh (DEFAULT_INITIAL_MELT, not URL initialMelt!)
  if (forceRefreezeIfMelted && meltState.melt > 0.78) {
    buildPopsicle(currentSeed, DEFAULT_INITIAL_MELT);
    return;
  }

  if (baseChanged || toppingsChanged) {
    if (activeGrabPointerId !== null) {
      releaseActiveGrab();
    }
    if (fruitAssembly) {
      solidScene.remove(fruitAssembly.group);
      fruitAssembly.dispose();
    }
    fruitAssembly = createFruitAssembly(currentSeed, currentRecipe);
    solidScene.add(fruitAssembly.group);
    if (liquidFilm) {
      fruitAssembly.update(meltState, 0, liquidFilm.stickWetness);
    }
  } else {
    fruitAssembly?.setRecipeColors(currentRecipe);
  }

  iceSystem?.setRecipe(currentRecipe);
  waterDrops?.setRecipe(currentRecipe);
  if (iceSystem) iceSystem.update(meltState, simParams.bubbles);
  syncCustomizeUI();
  renderDirty = true;
}

function resetMelt() {
  releaseActiveGrab();
  meltState.melt = DEFAULT_INITIAL_MELT;
  meltState.time = 0;
  meltState.heatSpots = [];
  meltState.pointerHeat = 0;
  meltState.bottomPool = dropDebug.bottomPool;
  meltState.bottomLobes = [1, 1, 1, 1];
  meltState.pendantPull = [0, 0, 0, 0];
  fallFocusBlend = 0;
  fruitAssembly?.reset();
  liquidFilm?.reset();
  waterDrops?.reset();
  if (iceSystem && fruitAssembly && waterDrops && liquidFilm) {
    iceSystem.update(meltState, simParams.bubbles, true);
    fruitAssembly.update(meltState, 0, liquidFilm.stickWetness);
    waterDrops.update(meltState, iceSystem, liquidFilm, 0, simParams.speed);
  }
  syncWorkbenchUI();
  renderDirty = true;
}

// === POINTER-ACCELERATED MELT & LOOSE-FRUIT GRAB INTERACTION ===
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const zPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const hitPoint = new THREE.Vector3();

function syncPointerCursor() {
  const gs = fruitAssembly?.getGrabState();
  if ((gs && gs.grabbedIndex >= 0) || orbitDragging || userOrbiting) {
    canvas.style.cursor = 'grabbing';
  } else if ((gs && gs.hoveredIndex >= 0) || hoveringOutsideIce) {
    canvas.style.cursor = 'grab';
  } else {
    canvas.style.cursor = '';
  }
}

function updatePointerRay(clientX: number, clientY: number) {
  const vp = safeViewportSize();
  pointerNdc.x = (clientX / vp.w) * 2 - 1;
  pointerNdc.y = -(clientY / vp.h) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
}

/** Exact 3D raycast test against the live melted ice body & attached protruding fruits. */
function hitEmbeddedFruit(): boolean {
  if (!fruitAssembly) return false;
  for (let i = 0; i < fruitAssembly.fruits.length; i++) {
    const f = fruitAssembly.fruits[i];
    if (!f.detached && f.mesh.visible && raycaster.intersectObject(f.mesh, false).length > 0) {
      return true;
    }
  }
  return false;
}

function isPointerOnIceCream(): boolean {
  if (iceSystem && iceSystem.iceMesh.visible) {
    if (raycaster.intersectObject(iceSystem.iceMesh, false).length > 0) return true;
  }
  return hitEmbeddedFruit();
}

const _camPlaneNorm = new THREE.Vector3(0, 0, 1);
const _camPlaneRight = new THREE.Vector3(1, 0, 0);
function updatePointerWorld(clientX: number, clientY: number) {
  updatePointerRay(clientX, clientY);

  if (activeGrabPointerId !== null && fruitAssembly) {
    fruitAssembly.moveGrab(raycaster, meltState);
    pointerActive = false;
    hoveringOutsideIce = false;
    syncPointerCursor();
    return;
  }

  if (orbitDragging || twoFingerOrbiting || rightOrbitPointerId !== null) {
    pointerActive = false;
    prevFrostU = null;
    prevFrostV = null;
    syncPointerCursor();
    return;
  }

  // Check if pointer is hovering an almost-released (moving) or falling fruit ready to grab!
  let hoveringGrabbable = false;
  if (fruitAssembly && !pointerPressed) {
    const hoverIdx = fruitAssembly.pickGrabbableFruit(raycaster);
    fruitAssembly.setHoveredFruit(hoverIdx);
    hoveringGrabbable = hoverIdx >= 0;
  }

  // Single 3D ice raycast shared by both hoarfrost-rubbing and outside-ice grab cursor affordance!
  const iceHits =
    iceSystem && iceSystem.iceMesh.visible ? raycaster.intersectObject(iceSystem.iceMesh, false) : [];
  const onIce = iceHits.length > 0 || hitEmbeddedFruit();

  if (!pointerPressed && activeTouchIds.size === 0) {
    hoveringOutsideIce = !hoveringGrabbable && !onIce;
    syncPointerCursor();
  }

  // Direct 3D surface raycast on live melting ice: melts freezer hoarfrost right under the pointer
  // while hovering or dragging across the ice cream (paused cleanly during camera orbit!)
  if (iceSystem && liquidFilm && waterDrops && !hoveringGrabbable && liquidFilm.avgRime > 0.002) {
    if (iceHits.length > 0 && iceHits[0].uv) {
      const u = iceHits[0].uv.x;
      const v = iceHits[0].uv.y;
      const seamWrap = prevFrostU !== null && Math.abs(u - prevFrostU) > 0.35;
      const u0 = prevFrostU !== null && !seamWrap ? prevFrostU : u;
      const v0 = prevFrostV !== null && !seamWrap ? prevFrostV : v;
      const brushRadius = pointerPressed ? 0.072 : 0.046;
      const brushStrength = pointerPressed ? 1.0 : 0.92;
      const samples = liquidFilm.meltFrostSegment(u0, v0, u, v, brushStrength, brushRadius);
      if (samples.length > 0) {
        for (let i = 0; i < samples.length; i++) {
          const s = samples[i];
          waterDrops.spawnFrostMeltDrops(s.u, s.v, s.melted, liquidFilm);
        }
        // If paused, refresh drop buffers immediately so newly beaded droplets appear right away!
        if (paused) {
          waterDrops.update(meltState, iceSystem, liquidFilm, 0, simParams.speed);
        }
        renderDirty = true;
      }
      prevFrostU = u;
      prevFrostV = v;
    } else {
      prevFrostU = null;
      prevFrostV = null;
    }
  } else {
    prevFrostU = null;
    prevFrostV = null;
  }

  // Orient pointer-warmth plane horizontally toward the live turntable camera angle so hover melting works 360°!
  _camPlaneNorm.set(camera.position.x - orbit.target.x, 0, camera.position.z - orbit.target.z);
  if (_camPlaneNorm.lengthSq() > 1e-6) {
    _camPlaneNorm.normalize();
  } else {
    _camPlaneNorm.set(0, 0, 1);
  }
  _camPlaneRight.set(_camPlaneNorm.z, 0, -_camPlaneNorm.x);
  zPlane.set(_camPlaneNorm, 0);

  if (raycaster.ray.intersectPlane(zPlane, hitPoint)) {
    meltState.pointerX = hitPoint.x;
    meltState.pointerY = hitPoint.y;
    const { yBot, yTop } = getMeltBounds(meltState.melt);
    const horizSpan = Math.abs(hitPoint.x * _camPlaneRight.x + hitPoint.z * _camPlaneRight.z);
    const onPopsicle =
      horizSpan < POPSICLE.halfWidthBottom * 1.28 &&
      hitPoint.y > Math.min(POPSICLE.yBottom, yBot) - 0.18 &&
      hitPoint.y < Math.max(POPSICLE.yTop, yTop) + 0.18;
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

function releaseActiveGrab() {
  if (activeGrabPointerId !== null) {
    try {
      canvas.releasePointerCapture(activeGrabPointerId);
    } catch {
      // Ignore if pointer capture already released
    }
    activeGrabPointerId = null;
  }
  fruitAssembly?.endGrab();
  orbit.enabled = meltDragPointerId === null;
  syncPointerCursor();
  renderDirty = true;
}

function clearTransientInput() {
  if (activeGrabPointerId !== null) {
    releaseActiveGrab();
  }
  activeTouchIds.clear();
  twoFingerOrbiting = false;
  meltDragPointerId = null;
  rightOrbitPointerId = null;
  pointerPressed = false;
  orbitDragging = false;
  hoveringOutsideIce = false;
  pointerActive = false;
  prevFrostU = null;
  prevFrostV = null;
  pendingPointerMove = false;
  orbit.enabled = true;
  fruitAssembly?.setHoveredFruit(-1);
  syncPointerCursor();
}

// Coalesce high-frequency pointermove events (240–1000Hz mice) to once per animation frame!
canvas.addEventListener('pointermove', (e) => {
  if (twoFingerOrbiting || orbitDragging || rightOrbitPointerId !== null) return;
  if (activeGrabPointerId !== null && e.pointerId !== activeGrabPointerId) return;
  if (meltDragPointerId !== null && e.pointerId !== meltDragPointerId) return;
  pendingPointerX = e.clientX;
  pendingPointerY = e.clientY;
  pendingPointerMove = true;
});

// Capture phase decides cleanly BEFORE OrbitControls' bubble listener runs:
// - Touch: 1 finger melts/rubs frost/grabs berries (OrbitControls tracks it with touches.ONE=null);
//          2 fingers rotate + pinch-zoom (touches.TWO=DOLLY_ROTATE).
// - Mouse/Pen: dragging ON the ice cream (or grabbing a loose berry) disables OrbitControls for that press;
//              dragging OUTSIDE the ice cream (or right-dragging anywhere) orbits 360° immediately!
canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (e.pointerType === 'touch') {
      activeTouchIds.add(e.pointerId);
      if (activeGrabPointerId !== null) return;
      if (activeTouchIds.size >= 2) {
        twoFingerOrbiting = true;
        orbitDragging = true;
        orbit.enabled = true;
        pointerPressed = false;
        pointerActive = false;
        prevFrostU = null;
        prevFrostV = null;
        renderDirty = true;
        return;
      }
      // Single-finger touch: keep orbit.enabled = true so OrbitControls tracks finger 1 if finger 2 lands!
      orbit.enabled = true;
      updatePointerRay(e.clientX, e.clientY);
      if (fruitAssembly) {
        const hitIdx = fruitAssembly.pickGrabbableFruit(raycaster);
        if (hitIdx >= 0 && fruitAssembly.beginGrab(hitIdx, raycaster, camera)) {
          activeGrabPointerId = e.pointerId;
          try {
            canvas.setPointerCapture(e.pointerId);
          } catch {
            // Safe fallback if synthetic pointer event has no native pointerId
          }
          orbit.enabled = false;
          pointerPressed = false;
          orbitDragging = false;
          pointerActive = false;
          prevFrostU = null;
          prevFrostV = null;
          syncPointerCursor();
          renderDirty = true;
          return;
        }
      }
      pointerPressed = true;
      orbitDragging = false;
      pendingPointerX = e.clientX;
      pendingPointerY = e.clientY;
      prevFrostU = null;
      prevFrostV = null;
      updatePointerWorld(e.clientX, e.clientY);
      renderDirty = true;
      return;
    }

    if (e.button === 2) {
      rightOrbitPointerId = e.pointerId;
      orbitDragging = true;
      orbit.enabled = true;
      pointerActive = false;
      prevFrostU = null;
      prevFrostV = null;
      syncPointerCursor();
      renderDirty = true;
      return;
    }

    if (e.button === 0) {
      if (activeGrabPointerId !== null) return;
      updatePointerRay(e.clientX, e.clientY);
      if (fruitAssembly) {
        const hitIdx = fruitAssembly.pickGrabbableFruit(raycaster);
        if (hitIdx >= 0 && fruitAssembly.beginGrab(hitIdx, raycaster, camera)) {
          activeGrabPointerId = e.pointerId;
          try {
            canvas.setPointerCapture(e.pointerId);
          } catch {
            // Safe fallback if synthetic pointer event has no native pointerId
          }
          orbit.enabled = false;
          pointerPressed = false;
          orbitDragging = false;
          pointerActive = false;
          prevFrostU = null;
          prevFrostV = null;
          syncPointerCursor();
          renderDirty = true;
          return;
        }
      }

      if (isPointerOnIceCream()) {
        // Grabbing / rubbing ON the ice cream -> melt & wipe frost without moving the camera!
        meltDragPointerId = e.pointerId;
        orbit.enabled = false;
        pointerPressed = true;
        orbitDragging = false;
        hoveringOutsideIce = false;
        pendingPointerX = e.clientX;
        pendingPointerY = e.clientY;
        prevFrostU = null;
        prevFrostV = null;
        updatePointerWorld(e.clientX, e.clientY);
        syncPointerCursor();
        renderDirty = true;
      } else {
        // Grabbing OUTSIDE the ice cream -> turn the camera smoothly 360°!
        orbit.enabled = true;
        orbitDragging = true;
        pointerPressed = false;
        pointerActive = false;
        prevFrostU = null;
        prevFrostV = null;
        syncPointerCursor();
        renderDirty = true;
      }
    }
  },
  { capture: true },
);

window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') {
    activeTouchIds.delete(e.pointerId);
  }
  if (activeGrabPointerId !== null && (e.pointerId === activeGrabPointerId || e.pointerId === 0)) {
    releaseActiveGrab();
  }
  if (meltDragPointerId !== null && (e.pointerId === meltDragPointerId || e.pointerId === 0)) {
    meltDragPointerId = null;
  }
  if (rightOrbitPointerId !== null && (e.pointerId === rightOrbitPointerId || e.pointerId === 0)) {
    rightOrbitPointerId = null;
  }
  if (e.pointerType === 'touch') {
    if (activeTouchIds.size === 0) {
      twoFingerOrbiting = false;
      orbitDragging = false;
      pointerPressed = false;
      pointerActive = false;
    }
  } else {
    pointerPressed = false;
    orbitDragging = false;
  }
  orbit.enabled = activeGrabPointerId === null && meltDragPointerId === null;
  prevFrostU = null;
  prevFrostV = null;
  syncPointerCursor();
});

window.addEventListener('pointercancel', clearTransientInput);
window.addEventListener('blur', clearTransientInput);

canvas.addEventListener('pointerleave', () => {
  if (activeGrabPointerId !== null || orbitDragging || meltDragPointerId !== null) return;
  pointerActive = false;
  pointerPressed = false;
  hoveringOutsideIce = false;
  prevFrostU = null;
  prevFrostV = null;
  pendingPointerMove = false;
  fruitAssembly?.setHoveredFruit(-1);
  syncPointerCursor();
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// === UI CONTROLS ===
const btnCustomize = document.getElementById('btn-customize') as HTMLButtonElement;
const customizePanel = document.getElementById('customize-panel') as HTMLDivElement;
const btnCustRandom = document.getElementById('btn-cust-random') as HTMLButtonElement;
const btnCustReset = document.getElementById('btn-cust-reset') as HTMLButtonElement;
const custBaseNote = document.getElementById('cust-base-note') as HTMLSpanElement;
const custFlavorNote = document.getElementById('cust-flavor-note') as HTMLSpanElement;
const custToppingNote = document.getElementById('cust-topping-note') as HTMLSpanElement;
const custFlavorsEl = document.getElementById('cust-flavors') as HTMLDivElement;
const custToppingsEl = document.getElementById('cust-toppings') as HTMLDivElement;
const baseBtns = Array.from(customizePanel.querySelectorAll<HTMLButtonElement>('[data-base]'));

const presetDock = document.getElementById('preset-dock') as HTMLElement;

const ASSET_BASE = import.meta.env.BASE_URL ?? '/';
const presetButtons = new Map<string, HTMLButtonElement>();
for (let i = 0; i < POPSICLE_PRESETS.length; i++) {
  const preset = POPSICLE_PRESETS[i];
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'preset-btn';
  btn.dataset.preset = preset.id;
  btn.dataset.label = preset.name;
  btn.title = `${preset.name} (${i + 1})`;
  btn.setAttribute('aria-label', preset.name);
  btn.setAttribute('aria-pressed', 'false');
  const img = document.createElement('img');
  img.src = `${ASSET_BASE}presets/${preset.id}.webp`;
  img.alt = '';
  img.width = 80;
  img.height = 112;
  img.draggable = false;
  img.decoding = 'async';
  btn.appendChild(img);
  btn.addEventListener('click', () => {
    applyPreset(preset);
  });
  presetDock.appendChild(btn);
  presetButtons.set(preset.id, btn);
}

function applyPreset(preset: PopsiclePreset) {
  const isSamePreset = recipesMatch(currentRecipe, preset.recipe);
  currentRecipe = normalizeRecipe(preset.recipe);
  if (isSamePreset) {
    // Clicking the currently active popsicle generates a brand-new frozen mix with a fresh seed
    buildPopsicle(currentSeed + 1, DEFAULT_INITIAL_MELT);
    return;
  }
  const nextMelt = meltState.melt > 0.65 ? DEFAULT_INITIAL_MELT : meltState.melt;
  buildPopsicle(preset.seed, nextMelt);
}

function syncPresetUI() {
  for (let i = 0; i < POPSICLE_PRESETS.length; i++) {
    const preset = POPSICLE_PRESETS[i];
    const btn = presetButtons.get(preset.id);
    if (!btn) continue;
    const active = recipesMatch(currentRecipe, preset.recipe);
    btn.setAttribute('aria-pressed', String(active));
    btn.title = active
      ? `${preset.name} — click for new mix (${i + 1})`
      : `${preset.name} (${i + 1})`;
  }
}

const devDock = document.getElementById('dev-dock') as HTMLDivElement;
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const settingsPanel = document.getElementById('settings-panel') as HTMLDivElement;
const btnSettingsCopy = document.getElementById('btn-settings-copy') as HTMLButtonElement;
const btnSettingsReset = document.getElementById('btn-settings-reset') as HTMLButtonElement;
const slMelt = document.getElementById('sl-melt') as HTMLInputElement;
const slSpeed = document.getElementById('sl-speed') as HTMLInputElement;
const slTurntable = document.getElementById('sl-turntable') as HTMLInputElement;
const slFrost = document.getElementById('sl-frost') as HTMLInputElement;
const slBubbles = document.getElementById('sl-bubbles') as HTMLInputElement;
const selDrops = document.getElementById('sel-drops') as HTMLSelectElement;
const selFall = document.getElementById('sel-fall') as HTMLSelectElement;
const valMelt = document.getElementById('val-melt') as HTMLOutputElement;
const valSpeed = document.getElementById('val-speed') as HTMLOutputElement;
const valTurntable = document.getElementById('val-turntable') as HTMLOutputElement;
const valFrost = document.getElementById('val-frost') as HTMLOutputElement;
const valBubbles = document.getElementById('val-bubbles') as HTMLOutputElement;

const btnDropReset = document.getElementById('btn-drop-reset') as HTMLButtonElement;
const dropControls: Array<{
  key: keyof DropDebugParams;
  input: HTMLInputElement;
  output: HTMLOutputElement;
  repack?: boolean;
  decimals?: number;
}> = [
  { key: 'sag', input: document.getElementById('sl-drop-sag') as HTMLInputElement, output: document.getElementById('val-drop-sag') as HTMLOutputElement },
  { key: 'stretch', input: document.getElementById('sl-drop-stretch') as HTMLInputElement, output: document.getElementById('val-drop-stretch') as HTMLOutputElement },
  { key: 'edgeBlur', input: document.getElementById('sl-drop-blur') as HTMLInputElement, output: document.getElementById('val-drop-blur') as HTMLOutputElement },
  { key: 'shadow', input: document.getElementById('sl-drop-shadow') as HTMLInputElement, output: document.getElementById('val-drop-shadow') as HTMLOutputElement },
  { key: 'shadowBlur', input: document.getElementById('sl-drop-shblur') as HTMLInputElement, output: document.getElementById('val-drop-shblur') as HTMLOutputElement },
  { key: 'rimDark', input: document.getElementById('sl-drop-rim') as HTMLInputElement, output: document.getElementById('val-drop-rim') as HTMLOutputElement },
  { key: 'size', input: document.getElementById('sl-drop-size') as HTMLInputElement, output: document.getElementById('val-drop-size') as HTMLOutputElement },
  { key: 'bottomPool', input: document.getElementById('sl-drop-pool') as HTMLInputElement, output: document.getElementById('val-drop-pool') as HTMLOutputElement, repack: true },
  { key: 'bottomDrops', input: document.getElementById('sl-drop-botcount') as HTMLInputElement, output: document.getElementById('val-drop-botcount') as HTMLOutputElement, repack: true, decimals: 0 },
  { key: 'dripRate', input: document.getElementById('sl-drop-drip') as HTMLInputElement, output: document.getElementById('val-drop-drip') as HTMLOutputElement },
];

if (showSettings) {
  devDock.hidden = false;
}

function syncWorkbenchUI() {
  slMelt.value = meltState.melt.toFixed(3);
  valMelt.textContent = meltState.melt.toFixed(2);
  slSpeed.value = simParams.speed.toFixed(1);
  valSpeed.textContent = `${simParams.speed.toFixed(1)}×`;
  slTurntable.value = simParams.turntable.toFixed(2);
  valTurntable.textContent = simParams.turntable <= 0.001 ? 'Off' : simParams.turntable.toFixed(2);
  slFrost.value = simParams.frost.toFixed(2);
  valFrost.textContent = simParams.frost.toFixed(2);
  slBubbles.value = simParams.bubbles.toFixed(2);
  valBubbles.textContent = simParams.bubbles.toFixed(2);
  selDrops.value = currentDropMode;
  selFall.value = currentFallMode;
  for (const c of dropControls) {
    const dec = c.decimals ?? 2;
    c.input.value = dropDebug[c.key].toFixed(dec);
    c.output.textContent = dropDebug[c.key].toFixed(dec);
  }
}

// Build Customize taste & topping chips deterministically from recipe lists
const flavorButtons = new Map<FlavorId, HTMLButtonElement>();
for (const flv of FLAVOR_LIST) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip';
  btn.dataset.flavor = flv.id;
  btn.innerHTML = `<span class="swatch" style="background:${flv.swatch}"></span><span>${flv.label}</span>`;
  btn.addEventListener('click', () => {
    const cur = [...currentRecipe.flavors];
    const idx = cur.indexOf(flv.id);
    if (idx >= 0) {
      // On water base keep at least 1 flavor; on coconut allow 0 for pure coconut cream!
      if (currentRecipe.base === 'coconut' || cur.length > 1) {
        cur.splice(idx, 1);
      }
    } else {
      if (cur.length >= 2) cur.shift();
      cur.push(flv.id);
    }
    applyRecipe({ ...currentRecipe, flavors: cur });
  });
  custFlavorsEl.appendChild(btn);
  flavorButtons.set(flv.id, btn);
}

const toppingButtons = new Map<ToppingId, HTMLButtonElement>();
for (const top of TOPPING_LIST) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip';
  btn.dataset.topping = top.id;
  btn.innerHTML = `<span class="swatch" style="background:${top.swatch}"></span><span>${top.label}</span>`;
  btn.addEventListener('click', () => {
    const cur = [...currentRecipe.toppings];
    const idx = cur.indexOf(top.id);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(top.id);
    applyRecipe({ ...currentRecipe, toppings: cur });
  });
  custToppingsEl.appendChild(btn);
  toppingButtons.set(top.id, btn);
}

for (const btn of baseBtns) {
  btn.addEventListener('click', () => {
    const nextBase = btn.dataset.base as BaseKind;
    if (nextBase !== currentRecipe.base) {
      applyRecipe({ ...currentRecipe, base: nextBase });
    }
  });
}

function syncCustomizeUI() {
  for (const btn of baseBtns) {
    btn.setAttribute('aria-pressed', String(btn.dataset.base === currentRecipe.base));
  }
  custBaseNote.textContent = currentRecipe.base === 'coconut' ? 'Opaque condensed milk' : 'Translucent ice';

  for (const [id, btn] of flavorButtons) {
    btn.setAttribute('aria-pressed', String(currentRecipe.flavors.includes(id)));
  }
  if (currentRecipe.flavors.length === 0) {
    custFlavorNote.textContent = 'Pure condensed milk';
  } else {
    custFlavorNote.textContent = `${currentRecipe.flavors.length} / 2 max`;
  }

  for (const [id, btn] of toppingButtons) {
    btn.setAttribute('aria-pressed', String(currentRecipe.toppings.includes(id)));
  }
  custToppingNote.textContent =
    currentRecipe.toppings.length === 0
      ? 'None'
      : `${currentRecipe.toppings.length} selected`;
  syncPresetUI();
}

btnCustomize.addEventListener('click', () => {
  const open = customizePanel.hidden;
  customizePanel.hidden = !open;
  btnCustomize.setAttribute('aria-expanded', String(open));
  if (open && !settingsPanel.hidden) {
    settingsPanel.hidden = true;
    btnSettings.setAttribute('aria-expanded', 'false');
  }
});

btnCustRandom.addEventListener('click', () => {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const base: BaseKind = Math.random() < 0.45 ? 'coconut' : 'water';
  const flavorCount = base === 'coconut' && Math.random() < 0.28 ? 0 : Math.random() < 0.55 ? 2 : 1;
  const flavors: FlavorId[] = [];
  while (flavors.length < flavorCount) {
    const f = pick(FLAVOR_LIST).id;
    if (!flavors.includes(f)) flavors.push(f);
  }
  const toppingCount = Math.random() < 0.16 ? 0 : Math.random() < 0.52 ? 1 : 2;
  const toppings: ToppingId[] = [];
  while (toppings.length < toppingCount) {
    const t = pick(TOPPING_LIST).id;
    if (!toppings.includes(t)) toppings.push(t);
  }
  applyRecipe({ base, flavors, toppings });
});

btnCustReset.addEventListener('click', () => {
  applyRecipe({
    base: DEFAULT_RECIPE.base,
    flavors: [...DEFAULT_RECIPE.flavors],
    toppings: [...DEFAULT_RECIPE.toppings],
  });
});

btnSettings.addEventListener('click', () => {
  const open = settingsPanel.hidden;
  settingsPanel.hidden = !open;
  btnSettings.setAttribute('aria-expanded', String(open));
  if (open && !customizePanel.hidden) {
    customizePanel.hidden = true;
    btnCustomize.setAttribute('aria-expanded', 'false');
  }
});

slMelt.addEventListener('input', () => {
  syncSystemsToMelt(Number(slMelt.value));
  valMelt.textContent = meltState.melt.toFixed(2);
});

slSpeed.addEventListener('input', () => {
  simParams.speed = Number(slSpeed.value);
  valSpeed.textContent = `${simParams.speed.toFixed(1)}×`;
  savePersistedSettings();
});

slTurntable.addEventListener('input', () => {
  simParams.turntable = Number(slTurntable.value);
  valTurntable.textContent = simParams.turntable <= 0.001 ? 'Off' : simParams.turntable.toFixed(2);
  savePersistedSettings();
});

slFrost.addEventListener('input', () => {
  simParams.frost = Number(slFrost.value);
  valFrost.textContent = simParams.frost.toFixed(2);
  if (iceSystem) iceSystem.uniforms.uFrost.value = simParams.frost;
  savePersistedSettings();
  renderDirty = true;
});

slBubbles.addEventListener('input', () => {
  simParams.bubbles = Number(slBubbles.value);
  valBubbles.textContent = simParams.bubbles.toFixed(2);
  if (iceSystem) iceSystem.update(meltState, simParams.bubbles);
  savePersistedSettings();
  renderDirty = true;
});

selDrops.addEventListener('change', () => {
  const mode = selDrops.value as DropMode;
  currentDropMode = mode;
  waterDrops?.setMode(mode);
  if (iceSystem && waterDrops && liquidFilm) {
    waterDrops.update(meltState, iceSystem, liquidFilm, 0, simParams.speed);
  }
  savePersistedSettings();
  renderDirty = true;
});

selFall.addEventListener('change', () => {
  currentFallMode = selFall.value as FallFocusMode;
  if (currentFallMode === 'off') fallFocusBlend = 0;
  savePersistedSettings();
});

function applyDropDebug(partial: Partial<DropDebugParams>, forceRepack = false, persist = true) {
  Object.assign(dropDebug, partial);
  if (partial.bottomPool !== undefined) {
    meltState.bottomPool = dropDebug.bottomPool;
  }
  waterDrops?.setDebugParams(partial);
  if (waterDrops) {
    Object.assign(dropDebug, waterDrops.getDebugParams());
  }
  if ((forceRepack || partial.bottomDrops !== undefined) && iceSystem && waterDrops && liquidFilm) {
    if (partial.bottomPool !== undefined) {
      iceSystem.update(meltState, simParams.bubbles, true);
    }
    waterDrops.update(meltState, iceSystem, liquidFilm, 0, simParams.speed);
  }
  if (persist) {
    savePersistedSettings();
  }
  syncWorkbenchUI();
  renderDirty = true;
}

for (const c of dropControls) {
  c.input.addEventListener('input', () => {
    const val = Number(c.input.value);
    applyDropDebug({ [c.key]: val }, Boolean(c.repack));
  });
}

btnDropReset.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  applyDropDebug({ ...DEFAULT_DROP_DEBUG }, true);
});

let copyFlashTimer: number | null = null;
btnSettingsCopy.addEventListener('click', () => {
  const json = JSON.stringify(serializeSettings(), null, 2);
  void copyTextToClipboard(json).then((ok) => {
    btnSettingsCopy.textContent = ok ? 'Copied' : 'Failed';
    if (copyFlashTimer !== null) window.clearTimeout(copyFlashTimer);
    copyFlashTimer = window.setTimeout(() => {
      btnSettingsCopy.textContent = 'Copy';
      copyFlashTimer = null;
    }, 1400);
  });
});

function factoryResetSettings() {
  clearPersistedSettings();
  simParams.speed = DEFAULT_SIM_PARAMS.speed;
  simParams.turntable = DEFAULT_SIM_PARAMS.turntable;
  simParams.frost = DEFAULT_SIM_PARAMS.frost;
  simParams.bubbles = DEFAULT_SIM_PARAMS.bubbles;
  currentDropMode = DEFAULT_DROP_MODE;
  currentFallMode = DEFAULT_FALL_MODE;
  fallFocusBlend = 0;
  Object.assign(dropDebug, DEFAULT_DROP_DEBUG);
  meltState.bottomPool = dropDebug.bottomPool;
  waterDrops?.setMode(currentDropMode);
  waterDrops?.setDebugParams(dropDebug);
  if (iceSystem) {
    iceSystem.uniforms.uFrost.value = simParams.frost;
    iceSystem.update(meltState, simParams.bubbles, true);
  }
  if (iceSystem && waterDrops && liquidFilm) {
    waterDrops.update(meltState, iceSystem, liquidFilm, 0, simParams.speed);
  }
  syncWorkbenchUI();
  renderDirty = true;
}

btnSettingsReset.addEventListener('click', () => {
  factoryResetSettings();
});

window.addEventListener('keydown', (e) => {
  // Never hijack browser shortcuts (Cmd/Ctrl/Alt+R/N/C/etc.)
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  ) {
    return;
  }
  if (e.key === 'Escape') {
    if (!customizePanel.hidden) {
      customizePanel.hidden = true;
      btnCustomize.setAttribute('aria-expanded', 'false');
    }
    if (!settingsPanel.hidden) {
      settingsPanel.hidden = true;
      btnSettings.setAttribute('aria-expanded', 'false');
    }
    return;
  }
  if (e.code === 'Space') {
    if (target instanceof HTMLElement && target.closest('button, summary, a')) return;
    e.preventDefault();
    paused = !paused;
    renderDirty = true;
  } else if (e.key === 'r' || e.key === 'R') {
    resetMelt();
  } else if (e.key === 'n' || e.key === 'N') {
    buildPopsicle(currentSeed + 1, DEFAULT_INITIAL_MELT);
  } else if (e.key === 'c' || e.key === 'C') {
    if (showSettings) btnCustomize.click();
  } else if (e.key >= '1' && e.key <= '9') {
    const preset = POPSICLE_PRESETS[Number(e.key) - 1];
    if (preset) applyPreset(preset);
  }
});

// === MULTI-PASS OPTICAL RENDER FUNCTION ===
const clearColorDark = new THREE.Color(0x000000);
// Far positive view-space depth sentinel (100.0 > 50.0) for camera-relative slab thickness across 360° orbit
const clearDepthVal = new THREE.Color(100, 0, 0);
const _centerProj = new THREE.Vector3();
const _fallDilation = { meltScale: 1, fluidScale: 1, fruitScale: 1 };

let blitEnabled = renderer.capabilities.isWebGL2;
let blitVerified = false;

/**
 * Fast WebGL2 hardware framebuffer blit (color and/or depth) between same-size RTs.
 * Replaces 5 redundant `solidScene` / `iceScene` passes per frame (~35-45% GPU frame speedup)
 * with automatic runtime verification & seamless fallback if any driver rejects the blit.
 */
function tryBlitRT(srcRT: THREE.WebGLRenderTarget, dstRT: THREE.WebGLRenderTarget, mask: number): boolean {
  if (!blitEnabled || srcRT.width !== dstRT.width || srcRT.height !== dstRT.height) return false;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  // Ensure dstRT's framebuffer is allocated before looking up its WebGLFramebuffer handle
  renderer.setRenderTarget(dstRT);
  const srcFbo = (renderer.properties.get(srcRT) as { __webglFramebuffer?: WebGLFramebuffer } | undefined)?.__webglFramebuffer;
  const dstFbo = (renderer.properties.get(dstRT) as { __webglFramebuffer?: WebGLFramebuffer } | undefined)?.__webglFramebuffer;
  if (!srcFbo || !dstFbo) return false;

  const w = srcRT.width;
  const h = srcRT.height;
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFbo);
  gl.disable(gl.SCISSOR_TEST);
  gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, mask, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFbo);

  if (!blitVerified) {
    blitVerified = true;
    if (gl.getError() !== gl.NO_ERROR) {
      blitEnabled = false;
      return false;
    }
  }
  return true;
}

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
  if (contextLost || !fruitAssembly || !iceSystem || !waterDrops) return;
  const gl = renderer.getContext();

  // Keep studio key lights & rear lightbox locked to the viewer's azimuth so 360° turntable stays evenly backlit!
  solidLights.rotation.y = Math.atan2(camera.position.x - orbit.target.x, camera.position.z - orbit.target.z);

  // Sync camera.matrixWorldInverse after turntable/setCamera lookAt() before projecting the studio halo!
  camera.updateMatrixWorld();

  // Project popsicle center into screen UV so studio lightbox halo tracks subtly when orbiting!
  _centerProj.set(0, 0.08, 0).project(camera);
  backdropUniforms.uHaloCenter.value.set(_centerProj.x * 0.5 + 0.5, _centerProj.y * 0.5 + 0.5);

  // --- PASS 1: Back-Face Ice Camera Depth (measures exact optical slab thickness from any 3D angle!) ---
  renderer.setRenderTarget(backIceZRT);
  renderer.setClearColor(clearDepthVal, 1);
  renderer.clear(true, true, false);
  renderer.render(backZScene, camera);

  // --- PASS 2: Solid Interior Fruits & Wood Stick Camera Depth (measures exact front-layer ice thickness!) ---
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

  // --- PASS 3b: Dedicated Crisp Internal Air Micro-Bubbles (skip completely when hidden / coconut / melted!) ---
  if (iceSystem.bubblesMesh.visible) {
    renderer.setRenderTarget(bubblesRT);
    renderer.setClearColor(clearColorDark, 0);
    if (tryBlitRT(bgRT, bubblesRT, gl.DEPTH_BUFFER_BIT)) {
      renderer.clear(true, false, false);
    } else {
      renderer.clear(true, true, false);
      solidScene.overrideMaterial = depthOnlyMat;
      renderer.render(solidScene, camera);
      solidScene.overrideMaterial = null;
    }
    renderer.render(bubblesScene, camera);
    bubblesRtHasContent = true;
  } else if (bubblesRtHasContent) {
    renderer.setRenderTarget(bubblesRT);
    renderer.setClearColor(clearColorDark, 0);
    renderer.clear(true, false, false);
    bubblesRtHasContent = false;
  }

  // --- PASS 4: Multi-Mip Separable Optical Frost Blur Pyramid (full -> 1/2 -> 1/4 -> 1/8) ---
  renderSeparableBlur(bgRT.texture, blurTemp1RT, bgBlur1RT, 1.45);
  renderSeparableBlur(bgBlur1RT.texture, blurTemp2RT, bgBlur2RT, 2.25);
  renderSeparableBlur(bgBlur2RT.texture, blurTemp3RT, bgBlur3RT, 2.85);

  // --- PASS 5: Post-Ice Scene (Blit Lightbox + Solids color & depth from bgRT -> render Hero Optical Ice!) ---
  iceSystem.uniforms.uBgTex.value = bgRT.texture;
  iceSystem.uniforms.uBgBlur1.value = bgBlur1RT.texture;
  iceSystem.uniforms.uBgBlur2.value = bgBlur2RT.texture;
  iceSystem.uniforms.uBgBlur3.value = bgBlur3RT.texture;
  iceSystem.uniforms.uBubblesTex.value = bubblesRT.texture;
  iceSystem.uniforms.uInteriorZ.value = interiorZRT.texture;
  iceSystem.uniforms.uBackIceZ.value = backIceZRT.texture;
  iceSystem.uniforms.uResolution.value.set(rtWidth, rtHeight);

  if (!tryBlitRT(bgRT, postIceRT, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)) {
    renderer.setRenderTarget(postIceRT);
    renderer.clear(true, true, false);
    renderer.render(backdropScene, fsCam);
    renderer.render(solidScene, camera);
  }
  renderer.render(iceScene, camera);

  // --- PASS 6: Separate Water Drops (Additive Metaball Liquid Field + Optical Resolve + 3D Pendant Drops!) ---
  waterDrops.uniforms.uSceneTex.value = postIceRT.texture;
  waterDrops.uniforms.uDropFieldTex.value = dropFieldRT.texture;
  waterDrops.uniforms.uResolution.value.set(rtWidth, rtHeight);

  // 6a. Accumulate smooth additive liquid metaball potential field (skip entire pass when zero surface splats!)
  if (waterDrops.hasDropField()) {
    renderer.setRenderTarget(dropFieldRT);
    renderer.setClearColor(clearColorDark, 0);
    if (tryBlitRT(postIceRT, dropFieldRT, gl.DEPTH_BUFFER_BIT)) {
      renderer.clear(true, false, false);
    } else {
      renderer.clear(true, true, false);
      solidScene.overrideMaterial = depthOnlyMat;
      iceScene.overrideMaterial = depthOnlyMat;
      renderer.render(solidScene, camera);
      renderer.render(iceScene, camera);
      solidScene.overrideMaterial = null;
      iceScene.overrideMaterial = null;
    }
    renderer.render(waterDrops.fieldScene, camera);
  }

  // 6b. Resolve merged liquid droplets + berry-ice capillary seam optically over postIceRT!
  renderer.setRenderTarget(compositeRT);
  renderer.clear(true, false, false);
  renderer.render(waterDrops.resolveScene, fsCam);

  // 6c. Reuse postIceRT depth buffer + render 3D Rayleigh-Plateau bottom pendants & stick flow streams!
  if (!tryBlitRT(postIceRT, compositeRT, gl.DEPTH_BUFFER_BIT)) {
    renderer.clear(false, true, false);
    solidScene.overrideMaterial = depthOnlyMat;
    iceScene.overrideMaterial = depthOnlyMat;
    renderer.render(solidScene, camera);
    renderer.render(iceScene, camera);
    solidScene.overrideMaterial = null;
    iceScene.overrideMaterial = null;
  }
  renderer.render(dropsScene, camera);

  // --- PASS 7: Final Photographic Tone-Mapping + Subtle Macro Grain to Screen ---
  displayUniforms.uTex.value = compositeRT.texture;
  displayUniforms.uTime.value = meltState.time;
  renderer.setRenderTarget(null);
  renderer.clear(true, false, false);
  renderer.render(displayScene, fsCam);
  renderDirty = false;
}

function computeFallDilation(dt: number, falling: boolean): { meltScale: number; fluidScale: number; fruitScale: number } {
  const target = currentFallMode !== 'off' && falling ? 1.0 : 0.0;
  // Fast engage (~45ms) the moment a fruit detaches; velvety smooth resume (~220ms) once it exits frame!
  const k = target > fallFocusBlend ? 22.0 : 4.8;
  fallFocusBlend += (target - fallFocusBlend) * (1.0 - Math.exp(-dt * k));
  if (fallFocusBlend < 0.001) fallFocusBlend = 0;

  if (currentFallMode === 'pause') {
    _fallDilation.meltScale = 1.0 - fallFocusBlend;
    _fallDilation.fluidScale = 1.0 - fallFocusBlend * 0.86;
    _fallDilation.fruitScale = 1.0 - fallFocusBlend * 0.16;
    return _fallDilation;
  }
  if (currentFallMode === 'slow') {
    _fallDilation.meltScale = 1.0 - fallFocusBlend * 0.92;
    _fallDilation.fluidScale = 1.0 - fallFocusBlend * 0.78;
    _fallDilation.fruitScale = 1.0 - fallFocusBlend * 0.52;
    return _fallDilation;
  }
  _fallDilation.meltScale = 1;
  _fallDilation.fluidScale = 1;
  _fallDilation.fruitScale = 1;
  return _fallDilation;
}

function advanceAmbientMelt(dtMelt: number, pointerGlobalBoost: number) {
  if (dtMelt <= 0 || !liquidFilm) return;
  const baseMeltRate = 0.0028;
  const dMelt = dtMelt * baseMeltRate * simParams.speed * pointerGlobalBoost;

  if (meltState.melt < FROST_CLEAR_MELT) {
    if (liquidFilm.avgRime > 0.015) {
      // Phase 1: thaw freezer frost first while holding the full molded silhouette!
      meltState.melt = Math.min(FROST_CLEAR_MELT - 0.003, meltState.melt + dMelt * 2.4);
    } else {
      // Frost completely cleared (e.g. wiped off with pointer) -> glide smoothly into active melt-down!
      meltState.melt = Math.min(FROST_CLEAR_MELT, meltState.melt + Math.max(dMelt * 2.4, dtMelt * 0.14 * simParams.speed));
    }
  } else {
    meltState.melt = clamp(meltState.melt + dMelt, 0, 1.0);
  }
}

// === ANIMATION LOOP ===
let lastTime = performance.now();

function tick(now: number) {
  requestAnimationFrame(tick);

  const rawDt = Math.min(0.05, Math.max(0, (now - lastTime) * 0.001));
  lastTime = now;

  // Flush at most one coalesced pointer raycast per display frame
  if (pendingPointerMove) {
    pendingPointerMove = false;
    updatePointerWorld(pendingPointerX, pendingPointerY);
  }

  const dt = paused ? 0 : rawDt;

  // Smooth live pointer heat ramp (pause warming while dragging to orbit around the popsicle)
  const warmingActive = pointerActive && !orbitDragging && !twoFingerOrbiting && rightOrbitPointerId === null;
  const targetHeat = warmingActive ? (pointerPressed ? 1.0 : 0.42) : 0.0;
  meltState.pointerHeat += (targetHeat - meltState.pointerHeat) * Math.min(1, rawDt * 8.0);

  if (dt > 0 && fruitAssembly && iceSystem && waterDrops && liquidFilm) {
    const { meltScale, fluidScale, fruitScale } = computeFallDilation(dt, fruitAssembly.hasFallingFruitInView());
    const dtMelt = dt * meltScale;
    const dtFluid = dt * fluidScale;
    const dtFruit = dt * fruitScale;

    meltState.time += dtFluid;

    // Slow deterministic ambient melt + pointer-accelerated warmth (never melts down before frost is gone!)
    if (dtMelt > 0) {
      const pointerGlobalBoost = warmingActive ? (pointerPressed ? 11.5 : 3.2) : 1.0;
      advanceAmbientMelt(dtMelt, pointerGlobalBoost);

      // Deposit structural ice-carving warmth once frost has cleared (before then, pointer melts frost cleanly!)
      if (warmingActive && (meltState.melt >= FROST_CLEAR_MELT - 0.01 || liquidFilm.avgRime < 0.05)) {
        const localDose = dtMelt * (pointerPressed ? 0.34 : 0.075) * simParams.speed;
        depositHeatSpot(meltState.pointerX, meltState.pointerY, localDose);
      }
    }

    // Update 2D viscous liquid glaze PDE, live melting geometry, solid fruits/wet stick, and surface/pendant drops!
    liquidFilm.update(meltState, dtFluid, simParams.speed);
    iceSystem.update(meltState, simParams.bubbles);
    fruitAssembly.update(meltState, dtFruit, liquidFilm.stickWetness);
    waterDrops.update(meltState, iceSystem, liquidFilm, dtFluid, simParams.speed);
    renderDirty = true;

    if (showSettings && !settingsPanel.hidden) {
      slMelt.value = meltState.melt.toFixed(3);
      valMelt.textContent = meltState.melt.toFixed(2);
    }

    // Superslow museum-grade 360° studio turntable (~2.3°/s at 0.20 default; yields only to right-drag or fruit grab!)
    if (
      simParams.turntable > 0.001 &&
      !userOrbiting &&
      rightOrbitPointerId === null &&
      activeGrabPointerId === null
    ) {
      const dAngle = dt * simParams.turntable * 0.2;
      const ox = camera.position.x - orbit.target.x;
      const oz = camera.position.z - orbit.target.z;
      const cosA = Math.cos(dAngle);
      const sinA = Math.sin(dAngle);
      camera.position.x = orbit.target.x + ox * cosA + oz * sinA;
      camera.position.z = orbit.target.z - ox * sinA + oz * cosA;
      camera.lookAt(orbit.target);
      camera.updateMatrixWorld();
      if (pointerPressed && !pendingPointerMove) {
        updatePointerWorld(pendingPointerX, pendingPointerY);
      }
    }
  }

  if (dt > 0 && !userOrbiting && !orbitDragging && !twoFingerOrbiting) {
    applyMeltCameraZoom(dt, false);
  }

  // Always drive grabbed fruit spring & soft flex in real time (even during Pause or Slow-Mo!)
  if (fruitAssembly && activeGrabPointerId !== null) {
    fruitAssembly.updateGrab(rawDt, meltState);
    renderDirty = true;
  }

  if (orbit.enabled) {
    orbit.update();
  }

  // Skip all 11 GPU render passes when paused & completely idle (0% idle GPU!)
  if (renderDirty) {
    renderFrame();
  }
}

// === RESIZE HANDLER ===
window.addEventListener('resize', () => {
  const vp = safeViewportSize();
  camera.aspect = vp.w / vp.h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(targetPixelRatio());
  renderer.setSize(vp.w, vp.h);
  rebuildRenderTargets();
  renderDirty = true;
});

// === BOOT & VERIFICATION HOOK ===
buildPopsicle(currentSeed, initialMelt);

// Expose deterministic inspection API for Playwright verification captures
(window as unknown as Record<string, unknown>).__day03 = {
  setMelt(m: number) {
    syncSystemsToMelt(m);
    renderFrame();
  },
  step(seconds: number) {
    const steps = Math.max(1, Math.ceil(seconds / 0.033));
    const dt = seconds / steps;
    for (let i = 0; i < steps; i++) {
      if (iceSystem && fruitAssembly && waterDrops && liquidFilm) {
        const { meltScale, fluidScale, fruitScale } = computeFallDilation(dt, fruitAssembly.hasFallingFruitInView());
        meltState.time += dt * fluidScale;
        advanceAmbientMelt(dt * meltScale, 1.0);
        liquidFilm.update(meltState, dt * fluidScale, simParams.speed);
        iceSystem.update(meltState, simParams.bubbles);
        fruitAssembly.update(meltState, dt * fruitScale, liquidFilm.stickWetness);
        waterDrops.update(meltState, iceSystem, liquidFilm, dt * fluidScale, simParams.speed);
        applyMeltCameraZoom(dt, false);
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
    buildPopsicle(s, DEFAULT_INITIAL_MELT);
    renderFrame();
  },
  setRecipe(partial: Partial<PopsicleRecipe>) {
    applyRecipe(
      {
        base: partial.base ?? currentRecipe.base,
        flavors: partial.flavors ?? currentRecipe.flavors,
        toppings: partial.toppings ?? currentRecipe.toppings,
      },
      false,
    );
    renderFrame();
  },
  getRecipe() {
    return {
      base: currentRecipe.base,
      flavors: [...currentRecipe.flavors],
      toppings: [...currentRecipe.toppings],
    };
  },
  applyPreset(id: string) {
    const preset = POPSICLE_PRESETS.find((p) => p.id === id);
    if (!preset) return false;
    currentRecipe = normalizeRecipe(preset.recipe);
    buildPopsicle(preset.seed, DEFAULT_INITIAL_MELT);
    renderFrame();
    return true;
  },
  getPresets() {
    return POPSICLE_PRESETS.map((p) => ({ id: p.id, name: p.name, seed: p.seed, recipe: p.recipe }));
  },
  setMaskMode(on: boolean) {
    displayUniforms.uMaskOnly.value = on ? 1.0 : 0.0;
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
  setFallMode(mode: FallFocusMode) {
    currentFallMode = mode;
    selFall.value = mode;
    if (mode === 'off') fallFocusBlend = 0;
  },
  setDropDebug(partial: Partial<DropDebugParams>) {
    applyDropDebug(partial, partial.bottomPool !== undefined || partial.bottomDrops !== undefined, false);
    renderFrame();
  },
  getDropDebug() {
    return { ...dropDebug };
  },
  setCamera(x: number, y: number, z: number) {
    const prevDamp = orbit.enableDamping;
    orbit.enableDamping = false;
    camera.position.set(x, y, z);
    orbit.target.copy(BASE_TARGET);
    camera.lookAt(BASE_TARGET);
    orbit.update();
    orbit.enableDamping = prevDamp;
    appliedMeltZoom = evalMeltZoomOffset(meltState.melt);
    renderFrame();
  },
  getCamera() {
    return [camera.position.x, camera.position.y, camera.position.z];
  },
  getGrabbableFruits() {
    if (!fruitAssembly) return [];
    const vp = safeViewportSize();
    const proj = new THREE.Vector3();
    return fruitAssembly.fruits
      .map((f, index) => {
        proj.copy(f.mesh.position).project(camera);
        return {
          index,
          kind: f.kind,
          exposure: f.exposure,
          detached: f.detached,
          grabbed: f.grabbed,
          visible: f.mesh.visible,
          x: (proj.x * 0.5 + 0.5) * vp.w,
          y: (-proj.y * 0.5 + 0.5) * vp.h,
          world: [f.mesh.position.x, f.mesh.position.y, f.mesh.position.z],
        };
      })
      .filter((item) => item.visible && (item.detached || item.exposure >= 0.28));
  },
  getState() {
    return {
      melt: meltState.melt,
      time: meltState.time,
      seed: currentSeed,
      avgRime: liquidFilm?.avgRime ?? 0,
      stickWetness: liquidFilm?.stickWetness ?? 0,
      falling: fruitAssembly?.hasFallingFruitInView() ?? false,
      fallFocusBlend,
      blitEnabled,
      grab: fruitAssembly?.getGrabState() ?? null,
    };
  },
};

requestAnimationFrame(tick);
