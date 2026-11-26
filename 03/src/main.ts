import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { clamp } from './rng';
import {
  DEFAULT_INITIAL_MELT,
  evaluatePopsicleVertex,
  FROST_CLEAR_MELT,
  getMeltBounds,
  mapPopsicleVNorm,
  MeltFieldState,
  POPSICLE,
  prepareProfileFrame,
  prepareProfileRow,
} from './shape';
import { getSharedNoise3DTexture } from './noise3d';
import { createMacroStudioEnv, disposeSeedTextureCache } from './textures';
import {
  createFruitAssembly,
  createToppingDebugStage,
  FruitAssembly,
  RASPBERRY_LIGHT_UNIFORMS,
  ToppingDebugFilter,
  ToppingDebugMode,
  ToppingDebugStage,
} from './fruits';
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
import { getCustomizeIcons } from './customizeIcons';
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
  updatePresetPeekShift();
  renderDirty = true;
});

// === MACRO STUDIO CAMERA (~90mm telephoto portrait framing with subtle underside perspective) ===
const camera = new THREE.PerspectiveCamera(27, initVP.w / initVP.h, 0.1, 30);
const DESKTOP_CAM_POS = new THREE.Vector3(0, -1.56, 7.09);
const DESKTOP_TARGET = new THREE.Vector3(0, -0.22, 0);
// On portrait mobile screens, bring the popsicle slightly closer (~9% larger) and higher above the persistent dock!
const MOBILE_CAM_POS = new THREE.Vector3(0, -1.58, 6.52);
const MOBILE_TARGET = new THREE.Vector3(0, -0.35, 0);
const BASE_CAM_POS = new THREE.Vector3();
const BASE_TARGET = new THREE.Vector3();
let lastMobileFraming = false;

function syncBaseFraming(vp: { w: number; h: number }): boolean {
  const portraitMobile = vp.w <= 860 && vp.h > vp.w;
  BASE_CAM_POS.copy(portraitMobile ? MOBILE_CAM_POS : DESKTOP_CAM_POS);
  BASE_TARGET.copy(portraitMobile ? MOBILE_TARGET : DESKTOP_TARGET);
  return portraitMobile;
}

lastMobileFraming = syncBaseFraming(initVP);
camera.position.copy(BASE_CAM_POS);
camera.lookAt(BASE_TARGET);

// Subtle cinematic telephoto dolly-back as the popsicle melts
const MELT_ZOOM_OUT_MAX = 1.15;
let appliedMeltZoom = 0;
let initialBootDone = false;
const _zoomOffsetVec = new THREE.Vector3();

function evalMeltZoomOffset(melt: number): number {
  const t = clamp((melt - 0.05) / 0.72, 0, 1);
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
orbit.maxDistance = 9.8;
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

// === STUDIO MACRO LIGHTING & ENVIRONMENT (built async during wireframe loading unless paused!) ===
let studioEnv: THREE.Texture | null = null;
function ensureStudioEnv(): THREE.Texture {
  if (!studioEnv) {
    studioEnv = createMacroStudioEnv(renderer);
    solidScene.environment = studioEnv;
  }
  return studioEnv;
}

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
      vec4 sum = texture2D(uTex, vUv) * 0.227027;
      sum += texture2D(uTex, clamp(vUv + stepUv * 1.3846, vec2(0.002), vec2(0.998))) * 0.316216;
      sum += texture2D(uTex, clamp(vUv - stepUv * 1.3846, vec2(0.002), vec2(0.998))) * 0.316216;
      sum += texture2D(uTex, clamp(vUv + stepUv * 3.2307, vec2(0.002), vec2(0.998))) * 0.070270;
      sum += texture2D(uTex, clamp(vUv - stepUv * 3.2307, vec2(0.002), vec2(0.998))) * 0.070270;
      gl_FragColor = sum;
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

/** Final photographic display pass: warm AgX-inspired highlight rolloff + NEST-style wireframe loading reveal */
const displayUniforms = {
  uTex: { value: null as THREE.Texture | null },
  uWireTex: { value: null as THREE.Texture | null },
  uReveal: { value: 0 },
  uBg: { value: new THREE.Vector3(213, 197, 188).divideScalar(255) }, // #d5c5bc page backdrop
  uInk: { value: new THREE.Vector3(28, 28, 28).divideScalar(255) }, // #1c1c1c title ink
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
    uniform sampler2D uWireTex;
    uniform float uReveal;
    uniform vec3 uBg;
    uniform vec3 uInk;
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
      if (uReveal <= 0.0001 && uMaskOnly <= 0.5) {
        vec3 drawing = mix(uBg, uInk, texture2D(uWireTex, vUv).a * 0.38);
        gl_FragColor = vec4(drawing, 1.0);
        return;
      }

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

      if (uReveal < 1.0) {
        vec3 drawing = mix(uBg, uInk, texture2D(uWireTex, vUv).a * 0.38);
        col = mix(drawing, col, uReveal);
      }

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
// Multisampled target for the NEST-style hidden-line wireframe drawing during boot; freed once revealed!
let wireRT: THREE.WebGLRenderTarget | null = null;
let wireFreed = false;

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
  const intZW = isMobile ? Math.max(2, Math.floor(rtWidth * 0.75)) : rtWidth;
  const intZH = isMobile ? Math.max(2, Math.floor(rtHeight * 0.75)) : rtHeight;
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
  wireRT?.dispose();

  // NearestFilter on camera-depth targets guarantees far clear sentinel (100.0) NEVER interpolates across edges!
  // Full-res interiorZRT eliminates 2x2 stair-stepped depth mismatches along shallow topping silhouettes!
  backIceZRT = makeRT(zW, zH, true, false);
  interiorZRT = makeRT(intZW, intZH, true, false);
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
  if (!wireFreed) {
    wireRT = new THREE.WebGLRenderTarget(rtWidth, rtHeight, {
      samples: renderer.capabilities.isWebGL2 ? (isMobile ? 2 : 4) : 0,
      depthBuffer: true,
      stencilBuffer: false,
    });
    displayUniforms.uWireTex.value = wireRT.texture;
  } else {
    wireRT = null;
    displayUniforms.uWireTex.value = null;
  }

  backdropUniforms.uAspect.value = rtWidth / rtHeight;
  bubblesRtHasContent = true;
}

rebuildRenderTargets();

// === SUB-SCENES FOR CLEAN LAYER SEPARATION ===
const solidScene = new THREE.Scene();
const solidLights = buildStudioLights();
solidScene.add(solidLights);
// Dedicated warm grazing side-back key light synchronized with raspberry side-translucency direction
const sideKeyLight = new THREE.DirectionalLight(0xfff1e4, 1.35);
sideKeyLight.position.set(-3.5, 0.9, -1.6);
solidScene.add(sideKeyLight);

const backZScene = new THREE.Scene();
const bubblesScene = new THREE.Scene();
const iceScene = new THREE.Scene();
const dropsScene = new THREE.Scene();

// === SIMULATION & GENERATIVE POPSICLE STATE ===
let fruitAssembly: FruitAssembly | null = null;
let iceSystem: PopsicleIceSystem | null = null;
let waterDrops: WaterDropSystem | null = null;
let liquidFilm: LiquidFilmSystem | null = null;
let toppingDebugStage: ToppingDebugStage | null = null;

// === LOCAL-DEV TOPPING DEBUG STAGE STATE ===
const rawToppingsParam = params.get('toppings');
let toppingDebugMode: ToppingDebugMode =
  rawToppingsParam === 'outside' || rawToppingsParam === 'both' || rawToppingsParam === 'inside'
    ? rawToppingsParam
    : params.has('toppings')
      ? 'both'
      : 'off';
const rawToppingFilter = params.get('topping');
let toppingDebugFilter: ToppingDebugFilter =
  rawToppingFilter && TOPPING_LIST.some((t) => t.id === rawToppingFilter)
    ? (rawToppingFilter as ToppingId)
    : 'all';
let floatAirRaspberry = params.has('air_raspberry');
let toppingDebugLightDeg = -112;
let toppingDebugSpin = false;
let savedNormalRecipe: PopsicleRecipe | null = null;

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

const CUSTOMIZE_PREVIEW_MELT = 0.105;

function syncSystemsToMelt(targetMelt: number, resetTransient = false) {
  releaseActiveGrab();
  meltState.melt = clamp(Number.isFinite(targetMelt) ? targetMelt : DEFAULT_INITIAL_MELT, 0, 1.0);
  fallFocusBlend = 0;
  if (resetTransient || meltState.melt <= DEFAULT_INITIAL_MELT + 0.005) {
    meltState.heatSpots = [];
    meltState.pointerHeat = 0;
    meltState.bottomLobes = [1, 1, 1, 1];
    meltState.pendantPull = [0, 0, 0, 0];
    fruitAssembly?.reset();
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

  ensureStudioEnv();
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
  syncCustomizeUI();
  if (toppingDebugMode !== 'off' || floatAirRaspberry) {
    applyToppingDebugVisibility();
  }
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
  if (reveal < 0.85 || toppingDebugMode === 'outside') return false;
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

  // While wireframe loader or outside-ice debug stage is showing, dragging anywhere orbits cleanly
  if (reveal < 0.85 || toppingDebugMode === 'outside') {
    pointerActive = false;
    prevFrostU = null;
    prevFrostV = null;
    if (!pointerPressed && activeTouchIds.size === 0) {
      hoveringOutsideIce = true;
      syncPointerCursor();
    }
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
const customizeStudio = document.getElementById('customize-studio') as HTMLDivElement;
const custFlavorsEl = document.getElementById('cust-flavors') as HTMLDivElement;
const custToppingsEl = document.getElementById('cust-toppings') as HTMLDivElement;
const imgBaseWater = document.getElementById('img-base-water') as HTMLImageElement;
const imgBaseCoconut = document.getElementById('img-base-coconut') as HTMLImageElement;
const baseBtns = Array.from(customizeStudio.querySelectorAll<HTMLButtonElement>('[data-base]'));

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
  btn.addEventListener('click', (e) => {
    // On touch/peeking state, tapping the active popsicle expands the full bar; tapping another switches immediately!
    if (presetDock.classList.contains('is-peeking') && recipesMatch(currentRecipe, preset.recipe)) {
      e.preventDefault();
      expandPresetDock(2800);
      return;
    }
    applyPreset(preset);
    if (!dockHovered && customizeStudio.hidden) expandPresetDock(1800);
  });
  presetDock.appendChild(btn);
  presetButtons.set(preset.id, btn);
}

// Etched glass vertical separator + Customize trigger on the main preset selector dock!
const presetSep = document.createElement('span');
presetSep.className = 'preset-sep';
presetSep.setAttribute('aria-hidden', 'true');
presetDock.appendChild(presetSep);

const btnCustomize = document.createElement('button');
btnCustomize.id = 'btn-dock-customize';
btnCustomize.type = 'button';
btnCustomize.className = 'preset-btn preset-customize-btn';
btnCustomize.dataset.label = 'Customize';
btnCustomize.title = 'Customize popsicle (C)';
btnCustomize.setAttribute('aria-label', 'Customize popsicle');
btnCustomize.setAttribute('aria-expanded', 'false');
btnCustomize.setAttribute('aria-controls', 'customize-studio');
const custDockImg = document.createElement('img');
custDockImg.src = `${ASSET_BASE}presets/customize-raspberry.webp`;
custDockImg.alt = '';
custDockImg.width = 96;
custDockImg.height = 96;
custDockImg.draggable = false;
custDockImg.decoding = 'async';
btnCustomize.appendChild(custDockImg);
presetDock.appendChild(btnCustomize);

let dockHideTimer: number | null = null;
let dockHovered = false;
let customizeIconsLoaded = false;

function ensureCustomizeIcons() {
  if (customizeIconsLoaded) return;
  const icons = getCustomizeIcons(renderer, ensureStudioEnv());
  imgBaseWater.src = icons.bases.water;
  imgBaseCoconut.src = icons.bases.coconut;
  for (const [id, img] of flavorImages) {
    img.src = icons.flavors[id];
  }
  for (const [id, img] of toppingImages) {
    img.src = icons.toppings[id];
  }
  customizeIconsLoaded = true;
}

function setCustomizeOpen(open: boolean) {
  if (open) {
    ensureCustomizeIcons();
    clearPresetDockTimer();
    setPresetDockPeeking(false);
    // Present the popsicle fresh out of the fridge with some frost cleared so colors & toppings read clearly!
    syncSystemsToMelt(CUSTOMIZE_PREVIEW_MELT, true);
  }
  customizeStudio.hidden = !open;
  btnCustomize.setAttribute('aria-expanded', String(open));
  if (!open && !dockHovered && !paused) {
    schedulePresetDockHide(1100);
  }
}

function updatePresetPeekShift() {
  const activeBtn = presetDock.querySelector<HTMLButtonElement>('.preset-btn[aria-pressed="true"]');
  if (!activeBtn || presetDock.clientWidth <= 0) {
    presetDock.style.setProperty('--peek-shift', '0px');
    return;
  }
  const btnCenter = activeBtn.offsetLeft + activeBtn.offsetWidth * 0.5;
  const dockCenter = presetDock.clientWidth * 0.5;
  presetDock.style.setProperty('--peek-shift', `${(dockCenter - btnCenter).toFixed(1)}px`);
}

function clearPresetDockTimer() {
  if (dockHideTimer !== null) {
    window.clearTimeout(dockHideTimer);
    dockHideTimer = null;
  }
}

const mobileDockMQ = window.matchMedia('(max-width: 860px), (hover: none) and (pointer: coarse)');
function shouldKeepPresetDockVisible(): boolean {
  return mobileDockMQ.matches;
}

function setPresetDockPeeking(peeking: boolean) {
  clearPresetDockTimer();
  if (peeking && customizeStudio.hidden && !shouldKeepPresetDockVisible()) {
    updatePresetPeekShift();
    presetDock.classList.add('is-peeking');
  } else {
    presetDock.classList.remove('is-peeking');
  }
}

function schedulePresetDockHide(delayMs = 1150) {
  if (paused || dockHovered || !customizeStudio.hidden || shouldKeepPresetDockVisible()) return;
  clearPresetDockTimer();
  dockHideTimer = window.setTimeout(() => {
    dockHideTimer = null;
    if (!dockHovered && customizeStudio.hidden && !shouldKeepPresetDockVisible() && !presetDock.matches(':focus-within')) {
      setPresetDockPeeking(true);
    }
  }, delayMs);
}

mobileDockMQ.addEventListener('change', () => {
  if (shouldKeepPresetDockVisible()) {
    setPresetDockPeeking(false);
  } else if (!dockHovered && customizeStudio.hidden && !paused) {
    schedulePresetDockHide(1100);
  }
});

function expandPresetDock(autoHideMs?: number) {
  setPresetDockPeeking(false);
  if (autoHideMs !== undefined && customizeStudio.hidden) {
    schedulePresetDockHide(autoHideMs);
  }
}

presetDock.addEventListener('pointerenter', () => {
  dockHovered = true;
  clearPresetDockTimer();
  setPresetDockPeeking(false);
});

presetDock.addEventListener('pointerleave', () => {
  dockHovered = false;
  schedulePresetDockHide(1100);
});

presetDock.addEventListener('focusin', () => {
  clearPresetDockTimer();
  setPresetDockPeeking(false);
});

presetDock.addEventListener('focusout', () => {
  schedulePresetDockHide(1100);
});

// Tapping the canvas collapses an expanded desktop dock right away (unless Customize studio is open)
canvas.addEventListener(
  'pointerdown',
  () => {
    if (!dockHovered && !paused && customizeStudio.hidden && !presetDock.classList.contains('is-peeking')) {
      setPresetDockPeeking(true);
    }
  },
  { passive: true },
);

// Tapping/clicking anywhere outside the Customize controls (without dragging to orbit/scroll) closes Customize!
let custOutsideTap: { id: number; x: number; y: number } | null = null;
window.addEventListener(
  'pointerdown',
  (e) => {
    if (customizeStudio.hidden || !e.isPrimary) {
      custOutsideTap = null;
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('.float-obj, #cust-mobile-tabs, #preset-dock, .plate a')) {
      custOutsideTap = null;
      return;
    }
    custOutsideTap = { id: e.pointerId, x: e.clientX, y: e.clientY };
  },
  { passive: true },
);
window.addEventListener(
  'pointerup',
  (e) => {
    if (!custOutsideTap || e.pointerId !== custOutsideTap.id) return;
    const dist = Math.hypot(e.clientX - custOutsideTap.x, e.clientY - custOutsideTap.y);
    custOutsideTap = null;
    if (dist < 8 && !customizeStudio.hidden) {
      setCustomizeOpen(false);
    }
  },
  { passive: true },
);
window.addEventListener(
  'pointercancel',
  () => {
    custOutsideTap = null;
  },
  { passive: true },
);

function applyPreset(preset: PopsiclePreset) {
  const isSamePreset = recipesMatch(currentRecipe, preset.recipe);
  currentRecipe = normalizeRecipe(preset.recipe);
  // Always start a fresh melt cycle (lightly defrosted if Customize view is open, fresh freezer frost otherwise)
  const nextSeed = isSamePreset ? currentSeed + 1 : preset.seed;
  const startMelt = customizeStudio.hidden ? DEFAULT_INITIAL_MELT : CUSTOMIZE_PREVIEW_MELT;
  buildPopsicle(nextSeed, startMelt);
}

function syncPresetUI() {
  let matchedAnyPreset = false;
  for (let i = 0; i < POPSICLE_PRESETS.length; i++) {
    const preset = POPSICLE_PRESETS[i];
    const btn = presetButtons.get(preset.id);
    if (!btn) continue;
    const active = recipesMatch(currentRecipe, preset.recipe);
    if (active) matchedAnyPreset = true;
    btn.setAttribute('aria-pressed', String(active));
    btn.title = active
      ? `${preset.name} — click for new mix (${i + 1})`
      : `${preset.name} (${i + 1})`;
  }
  btnCustomize.dataset.customActive = String(!matchedAnyPreset);
  updatePresetPeekShift();
}

// Organic hand-drawn fine-liner ink loop paths so every selected floating item feels individually sketched!
const OBJ_PEN_PATHS = [
  'M22 21 C44 8, 86 11, 100 31 C111 49, 103 80, 79 90 C50 100, 17 92, 11 68 C5 44, 21 19, 49 14',
  'M89 19 C65 7, 25 13, 13 35 C3 56, 14 85, 42 92 C72 99, 103 85, 107 61 C110 37, 92 16, 65 13',
  'M27 16 C56 6, 95 16, 105 40 C113 62, 96 89, 68 94 C38 99, 10 83, 9 57 C8 32, 28 14, 57 12',
  'M84 15 C55 7, 19 18, 11 44 C4 68, 22 92, 51 95 C81 98, 107 80, 108 55 C109 30, 88 12, 60 11',
];

// Clean, organized 3×3 organic constellation for the 9 uniform-size 3D juice droplets (left wing)
const TASTE_FLOAT_LAYOUT: Array<{ x: number; y: number; size: number; rot: number }> = [
  { x: 18, y: 8, size: 68, rot: -4 },       // mango
  { x: 110, y: 4, size: 68, rot: 4 },       // lemon
  { x: 202, y: 10, size: 68, rot: -3 },     // orange
  { x: 14, y: 102, size: 68, rot: 3 },      // watermelon
  { x: 108, y: 98, size: 68, rot: -4 },     // strawberry
  { x: 200, y: 104, size: 68, rot: 4 },     // raspberry
  { x: 18, y: 196, size: 68, rot: -3 },     // blueberry
  { x: 110, y: 192, size: 68, rot: 4 },     // banana
  { x: 202, y: 198, size: 68, rot: -4 },    // chocolate
];

// Clean, balanced 2×3 organic constellation for the 6 real 3D toppings (right wing; harmonized sizes!)
const TOPPING_FLOAT_LAYOUT: Array<{ x: number; y: number; size: number; rot: number }> = [
  { x: 18, y: 14, size: 92, rot: -4 },      // blueberry
  { x: 148, y: 20, size: 84, rot: 5 },      // chocolate
  { x: 22, y: 132, size: 86, rot: 3 },      // shaved-lemon
  { x: 144, y: 126, size: 94, rot: -5 },    // strawberry
  { x: 16, y: 244, size: 96, rot: 4 },      // raspberry
  { x: 148, y: 252, size: 84, rot: -3 },    // kaksmulor
];

const flavorButtons = new Map<FlavorId, HTMLButtonElement>();
const flavorImages = new Map<FlavorId, HTMLImageElement>();
for (let i = 0; i < FLAVOR_LIST.length; i++) {
  const flv = FLAVOR_LIST[i];
  const lay = TASTE_FLOAT_LAYOUT[i % TASTE_FLOAT_LAYOUT.length];
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'float-obj taste-chunk-btn';
  btn.dataset.flavor = flv.id;
  btn.dataset.tip = flv.label;
  btn.setAttribute('aria-label', flv.label);
  btn.setAttribute('aria-pressed', 'false');
  btn.style.setProperty('--fx', `${lay.x}px`);
  btn.style.setProperty('--fy', `${lay.y}px`);
  btn.style.setProperty('--size', `${lay.size}px`);
  btn.style.setProperty('--rot', `${lay.rot}deg`);
  btn.style.setProperty('--float-delay', `${(-0.5 - i * 0.67).toFixed(2)}s`);
  btn.style.setProperty('--float-dur', `${(4.7 + (i % 4) * 0.45).toFixed(2)}s`);
  const penPath = OBJ_PEN_PATHS[(i + 1) % OBJ_PEN_PATHS.length];
  btn.innerHTML = `<svg class="pen-ring" viewBox="0 0 116 102" fill="none" aria-hidden="true"><path pathLength="1" d="${penPath}" /></svg><span class="obj-stage"></span>`;
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  btn.querySelector('.obj-stage')!.appendChild(img);
  btn.addEventListener('click', () => {
    const cur = [...currentRecipe.flavors];
    const idx = cur.indexOf(flv.id);
    if (idx >= 0) {
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
  flavorImages.set(flv.id, img);
}

const toppingButtons = new Map<ToppingId, HTMLButtonElement>();
const toppingImages = new Map<ToppingId, HTMLImageElement>();
for (let i = 0; i < TOPPING_LIST.length; i++) {
  const top = TOPPING_LIST[i];
  const lay = TOPPING_FLOAT_LAYOUT[i % TOPPING_FLOAT_LAYOUT.length];
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'float-obj topping-card';
  btn.dataset.topping = top.id;
  btn.dataset.tip = top.label;
  btn.setAttribute('aria-label', top.label);
  btn.setAttribute('aria-pressed', 'false');
  btn.style.setProperty('--fx', `${lay.x}px`);
  btn.style.setProperty('--fy', `${lay.y}px`);
  btn.style.setProperty('--size', `${lay.size}px`);
  btn.style.setProperty('--rot', `${lay.rot}deg`);
  btn.style.setProperty('--float-delay', `${(-0.8 - i * 0.92).toFixed(2)}s`);
  btn.style.setProperty('--float-dur', `${(4.9 + (i % 3) * 0.52).toFixed(2)}s`);
  const penPath = OBJ_PEN_PATHS[i % OBJ_PEN_PATHS.length];
  btn.innerHTML = `<svg class="pen-ring" viewBox="0 0 116 102" fill="none" aria-hidden="true"><path pathLength="1" d="${penPath}" /></svg><span class="obj-stage"></span>`;
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  btn.querySelector('.obj-stage')!.appendChild(img);
  btn.addEventListener('click', () => {
    const cur = [...currentRecipe.toppings];
    const idx = cur.indexOf(top.id);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(top.id);
    applyRecipe({ ...currentRecipe, toppings: cur });
  });
  custToppingsEl.appendChild(btn);
  toppingButtons.set(top.id, btn);
  toppingImages.set(top.id, img);
}

// Mobile bottom category switcher (Base · Taste · Toppings): shows one clean floating row at a time
const custMobileTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#cust-mobile-tabs .cust-tab-btn'));
function setMobileCustomizeTab(tab: 'base' | 'taste' | 'toppings') {
  customizeStudio.dataset.mobileTab = tab;
  for (const tBtn of custMobileTabs) {
    tBtn.setAttribute('aria-selected', String(tBtn.dataset.tab === tab));
  }
}
for (const tBtn of custMobileTabs) {
  tBtn.addEventListener('click', () => {
    const tab = tBtn.dataset.tab as 'base' | 'taste' | 'toppings' | undefined;
    if (tab) setMobileCustomizeTab(tab);
  });
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
  for (const [id, btn] of flavorButtons) {
    btn.setAttribute('aria-pressed', String(currentRecipe.flavors.includes(id)));
  }
  for (const [id, btn] of toppingButtons) {
    btn.setAttribute('aria-pressed', String(currentRecipe.toppings.includes(id)));
  }
  syncPresetUI();
}

function ensureToppingDebugStage(): ToppingDebugStage {
  if (!toppingDebugStage) {
    toppingDebugStage = createToppingDebugStage(currentSeed);
    solidScene.add(toppingDebugStage.group);
  }
  return toppingDebugStage;
}

function applyToppingDebugVisibility() {
  const activeStage = toppingDebugMode !== 'off' || floatAirRaspberry;
  if (activeStage) {
    ensureToppingDebugStage().setLayout(toppingDebugMode, toppingDebugFilter, floatAirRaspberry);
  } else if (toppingDebugStage) {
    toppingDebugStage.setLayout('off', toppingDebugFilter, false);
  }

  const hidePopsicle = toppingDebugMode === 'outside';
  if (fruitAssembly) fruitAssembly.group.visible = !hidePopsicle;
  if (iceSystem) {
    iceSystem.iceMesh.visible = !hidePopsicle;
    iceSystem.backZMesh.visible = !hidePopsicle;
  }
  if (waterDrops) waterDrops.pendantGroup.visible = !hidePopsicle;
  orbit.minDistance = toppingDebugMode !== 'off' ? 1.35 : 3.2;
}

function applyToppingDebugState(syncRecipe = true) {
  if (syncRecipe) {
    if (toppingDebugMode === 'both' || toppingDebugMode === 'inside') {
      if (!savedNormalRecipe) {
        savedNormalRecipe = {
          base: currentRecipe.base,
          flavors: [...currentRecipe.flavors],
          toppings: [...currentRecipe.toppings],
        };
      }
      const nextToppings: ToppingId[] =
        toppingDebugFilter === 'all' ? TOPPING_LIST.map((t) => t.id) : [toppingDebugFilter];
      const nextFlavors: FlavorId[] =
        toppingDebugFilter === 'raspberry'
          ? ['raspberry']
          : toppingDebugFilter === 'blueberry'
            ? ['blueberry']
            : toppingDebugFilter === 'shaved-lemon'
              ? ['lemon']
              : currentRecipe.flavors.length > 0
                ? currentRecipe.flavors
                : ['strawberry'];
      applyRecipe({ base: currentRecipe.base, flavors: nextFlavors, toppings: nextToppings }, false);
    } else if (toppingDebugMode === 'off' && savedNormalRecipe) {
      const restore = savedNormalRecipe;
      savedNormalRecipe = null;
      applyRecipe(restore, false);
    }
  }
  applyToppingDebugVisibility();
  renderDirty = true;
}

btnCustomize.addEventListener('click', () => {
  setCustomizeOpen(customizeStudio.hidden);
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
  renderDirty = true;
}

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
    if (!customizeStudio.hidden) setCustomizeOpen(false);
    return;
  }
  if (e.code === 'Space') {
    if (target instanceof HTMLElement && target.closest('button, summary, a')) return;
    e.preventDefault();
    paused = !paused;
    renderDirty = true;
  } else if (!revealing) {
    return;
  } else if (e.key === 'r' || e.key === 'R') {
    resetMelt();
  } else if (e.key === 'n' || e.key === 'N') {
    buildPopsicle(currentSeed + 1, DEFAULT_INITIAL_MELT);
  } else if (e.key === 'c' || e.key === 'C') {
    setCustomizeOpen(customizeStudio.hidden);
  } else if (e.key >= '1' && e.key <= '9') {
    const preset = POPSICLE_PRESETS[Number(e.key) - 1];
    if (preset) {
      applyPreset(preset);
      expandPresetDock(1800);
    }
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

// === NEST-STYLE WIREFRAME LOADING DRAWING & SMOOTH REVEAL ===
const REVEAL_DURATION = isMobile ? 1.0 : 1.45; // seconds (smoothstep crossfade from wireframe drawing into photorealistic picture)
const holdLoader = params.has('loader');
let reveal = 0;
let revealing = false;

interface WireLoader {
  draw(cam: THREE.Camera): void;
  dispose(): void;
}

/**
 * Lightweight architectural wireframe drawing of the fluted popsicle + wooden stick,
 * rendered with hidden-line depth occlusion (matching Day 24 NEST) in <1ms on frame 0
 * while procedural textures and WebGL2 optical pipelines warm up off-frame!
 */
function createWireLoader(seed: number, startMelt: number): WireLoader {
  const segU = 40;
  const segV = 26;
  const stride = segU + 1;
  const vCount = stride * (segV + 1);
  const posArr = new Float32Array(vCount * 3);
  const triIdx: number[] = [];
  const linePos: number[] = [];

  const wireState: MeltFieldState = {
    melt: clamp(startMelt, 0, 1.0),
    time: 0,
    seedOffset: seed * 13.7,
    heatSpots: [],
    pointerHeat: 0,
    pointerX: 0,
    pointerY: 0,
    bottomPool: dropDebug.bottomPool,
    bottomLobes: [1, 1, 1, 1],
    pendantPull: [0, 0, 0, 0],
  };

  const frame = prepareProfileFrame(wireState);
  const tmp = { x: 0, y: 0, z: 0 };
  for (let iv = 0; iv <= segV; iv++) {
    const vNorm = mapPopsicleVNorm(iv / segV);
    const row = prepareProfileRow(vNorm, frame);
    for (let iu = 0; iu <= segU; iu++) {
      const theta = iu === segU ? 0 : (iu / segU) * Math.PI * 2;
      evaluatePopsicleVertex(Math.sin(theta), Math.cos(theta), frame, row, wireState, tmp);
      const idx = iv * stride + iu;
      posArr[idx * 3] = tmp.x;
      posArr[idx * 3 + 1] = tmp.y;
      posArr[idx * 3 + 2] = tmp.z;
    }
  }

  // Occlusion triangles + clean quad contour segments (latitude rings & sculpted vertical flute ribs — zero diagonal clutter!)
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      triIdx.push(a, b, d, a, d, c);
      // Horizontal latitude edge (includes iv === 0 bottom seam so vertical meridians close cleanly!)
      linePos.push(
        posArr[a * 3], posArr[a * 3 + 1], posArr[a * 3 + 2],
        posArr[b * 3], posArr[b * 3 + 1], posArr[b * 3 + 2],
      );
      // Vertical meridian edge
      linePos.push(
        posArr[a * 3], posArr[a * 3 + 1], posArr[a * 3 + 2],
        posArr[c * 3], posArr[c * 3 + 1], posArr[c * 3 + 2],
      );
    }
  }

  const occludeIceGeo = new THREE.BufferGeometry();
  occludeIceGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  occludeIceGeo.setIndex(triIdx);

  const iceLinesGeo = new THREE.BufferGeometry();
  iceLinesGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));

  // Clean beveled birch stick silhouette for occlusion + outline
  const hw = POPSICLE.stickWidth * 0.5;
  const topY = POPSICLE.stickTopY;
  const botY = POPSICLE.stickBottomY;
  const stickShape = new THREE.Shape();
  stickShape.absarc(0, botY + hw, hw, Math.PI, Math.PI * 2, false);
  stickShape.lineTo(hw, topY - hw);
  stickShape.absarc(0, topY - hw, hw, 0, Math.PI, false);
  stickShape.closePath();
  const stickDepth = POPSICLE.stickDepth * 0.62;
  const occludeStickGeo = new THREE.ExtrudeGeometry(stickShape, {
    depth: stickDepth,
    bevelEnabled: true,
    bevelThickness: POPSICLE.stickBevelThickness,
    bevelSize: POPSICLE.stickBevelSize,
    bevelSegments: 2,
    curveSegments: 14,
  });
  occludeStickGeo.translate(0, 0, -stickDepth * 0.5);
  const stickEdgesGeo = new THREE.EdgesGeometry(occludeStickGeo, 24);

  // Hidden-line occlusion pass (pushes solid surfaces a hair back in depth so front ink lines never z-fight!)
  const hideMat = new THREE.MeshBasicMaterial({
    colorWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const stickXrayMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
  });

  const occludeScene = new THREE.Scene();
  occludeScene.add(new THREE.Mesh(occludeIceGeo, hideMat), new THREE.Mesh(occludeStickGeo, hideMat));

  const lineScene = new THREE.Scene();
  lineScene.add(new THREE.LineSegments(iceLinesGeo, lineMat), new THREE.LineSegments(stickEdgesGeo, lineMat));

  // Second pass reveals the embedded upper birch stick cleanly THROUGH the translucent popsicle wireframe
  // while still self-occluding the stick's own back edges cleanly from any 360° orbit angle!
  const stickOccludeScene = new THREE.Scene();
  stickOccludeScene.add(new THREE.Mesh(occludeStickGeo, hideMat));

  const stickXrayScene = new THREE.Scene();
  stickXrayScene.add(new THREE.LineSegments(stickEdgesGeo, stickXrayMat));

  return {
    draw(cam: THREE.Camera) {
      if (!wireRT) return;
      renderer.setRenderTarget(wireRT);
      renderer.setClearColor(clearColorDark, 0);
      renderer.clear(true, true, false);
      renderer.render(occludeScene, cam);
      renderer.render(lineScene, cam);
      // Clear depth only so the embedded stick renders softly through the ice grid without erasing front lines
      renderer.clear(false, true, false);
      renderer.render(stickOccludeScene, cam);
      renderer.render(stickXrayScene, cam);
    },
    dispose() {
      occludeIceGeo.dispose();
      iceLinesGeo.dispose();
      occludeStickGeo.dispose();
      stickEdgesGeo.dispose();
      hideMat.dispose();
      lineMat.dispose();
      stickXrayMat.dispose();
    },
  };
}

let wireLoader: WireLoader | null = createWireLoader(currentSeed, initialMelt);

function endWire() {
  if (wireFreed) return;
  wireFreed = true;
  wireLoader?.dispose();
  wireLoader = null;
  wireRT?.dispose();
  wireRT = null;
  displayUniforms.uWireTex.value = null;
}

function renderPicturePasses() {
  if (contextLost || !fruitAssembly || !iceSystem || !waterDrops) return;
  const gl = renderer.getContext();

  // Keep studio key lights & rear lightbox locked to the viewer's azimuth so 360° turntable stays evenly backlit!
  const camAzimuth = Math.atan2(camera.position.x - orbit.target.x, camera.position.z - orbit.target.z);
  solidLights.rotation.y = camAzimuth;

  // Synchronize grazing side-back key light & raspberry side-translucency direction!
  // In Topping Debug View, anchor in world space at `toppingDebugLightDeg` so orbiting sweeps around the side beam;
  // in normal popsicle view, lock at -112° relative to the camera so exposed raspberries always catch dramatic side light!
  const sideAz =
    toppingDebugMode !== 'off' || floatAirRaspberry
      ? (toppingDebugLightDeg * Math.PI) / 180
      : camAzimuth + (-112 * Math.PI) / 180;
  RASPBERRY_LIGHT_UNIFORMS.uSideLightDir.value.set(Math.sin(sideAz), 0.24, Math.cos(sideAz)).normalize();
  sideKeyLight.position.copy(RASPBERRY_LIGHT_UNIFORMS.uSideLightDir.value).multiplyScalar(4.0);
  sideKeyLight.intensity = toppingDebugMode !== 'off' ? 1.75 : 1.25;

  // Sync camera.matrixWorldInverse after turntable/setCamera lookAt() before projecting the studio halo!
  camera.updateMatrixWorld();

  // Project popsicle center into screen UV so studio lightbox halo tracks subtly when orbiting!
  _centerProj.set(0, 0.08, 0).project(camera);
  backdropUniforms.uHaloCenter.value.set(_centerProj.x * 0.5 + 0.5, _centerProj.y * 0.5 + 0.5);

  // Fast direct studio render when inspecting toppings strictly outside the ice!
  if (toppingDebugMode === 'outside') {
    renderer.setRenderTarget(compositeRT);
    renderer.setClearColor(clearColorDark, 1);
    renderer.clear(true, true, false);
    renderer.render(backdropScene, fsCam);
    renderer.render(solidScene, camera);
    return;
  }

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
}

function renderFrame() {
  if (contextLost) return;
  const smoothReveal = reveal >= 1 ? 1 : reveal <= 0 ? 0 : THREE.MathUtils.smoothstep(reveal, 0, 1);

  if (smoothReveal < 1 && wireLoader && wireRT) {
    camera.updateMatrixWorld();
    wireLoader.draw(camera);
  }
  if (smoothReveal > 0 && fruitAssembly && iceSystem && waterDrops) {
    renderPicturePasses();
  }

  // --- PASS 7: Final Photographic Tone-Mapping + Smooth Wireframe-to-Picture Reveal ---
  displayUniforms.uTex.value = compositeRT.texture;
  displayUniforms.uReveal.value = smoothReveal;
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

  // Pause ambient melting while Customize studio is open so the popsicle stays fresh & lightly frosted while editing!
  const dt = paused || !customizeStudio.hidden ? 0 : rawDt;

  // Advance smooth NEST-style crossfade from wireframe drawing into the warmed photorealistic popsicle!
  if (revealing && reveal < 1) {
    reveal = Math.min(1, reveal + rawDt / REVEAL_DURATION);
    renderDirty = true;
    if (reveal >= 1) {
      endWire();
    }
  }

  // Smooth live pointer heat ramp (pause warming while dragging to orbit or before reveal finishes)
  const warmingActive = reveal >= 0.85 && pointerActive && !orbitDragging && !twoFingerOrbiting && rightOrbitPointerId === null;
  const targetHeat = warmingActive ? (pointerPressed ? 1.0 : 0.42) : 0.0;
  meltState.pointerHeat += (targetHeat - meltState.pointerHeat) * Math.min(1, rawDt * 8.0);

  if (dt > 0 && toppingDebugStage && toppingDebugStage.group.visible && toppingDebugSpin) {
    toppingDebugStage.update(dt, true);
    renderDirty = true;
  }

  if (dt > 0 && reveal >= 0.85 && toppingDebugMode !== 'outside' && fruitAssembly && iceSystem && waterDrops && liquidFilm) {
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
  const nextMobileFraming = syncBaseFraming(vp);
  if (nextMobileFraming !== lastMobileFraming) {
    lastMobileFraming = nextMobileFraming;
    camera.position.copy(BASE_CAM_POS);
    orbit.target.copy(BASE_TARGET);
    camera.lookAt(BASE_TARGET);
    orbit.update();
    appliedMeltZoom = 0;
    applyMeltCameraZoom(0, true);
  }
  camera.aspect = vp.w / vp.h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(targetPixelRatio());
  renderer.setSize(vp.w, vp.h);
  rebuildRenderTargets();
  updatePresetPeekShift();
  renderDirty = true;
});

// === STAGGERED ASYNC LOADING & BOOT (NEST-style zero-jank wireframe -> picture reveal) ===
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function warmCompileAndTextures() {
  // Bind live render-target textures up front so shaders compile against non-null samplers
  blurUniforms.uTex.value = bgRT.texture;
  displayUniforms.uTex.value = compositeRT.texture;
  if (iceSystem) {
    iceSystem.uniforms.uBgTex.value = bgRT.texture;
    iceSystem.uniforms.uBgBlur1.value = bgBlur1RT.texture;
    iceSystem.uniforms.uBgBlur2.value = bgBlur2RT.texture;
    iceSystem.uniforms.uBgBlur3.value = bgBlur3RT.texture;
    iceSystem.uniforms.uBubblesTex.value = bubblesRT.texture;
    iceSystem.uniforms.uInteriorZ.value = interiorZRT.texture;
    iceSystem.uniforms.uBackIceZ.value = backIceZRT.texture;
    iceSystem.uniforms.uResolution.value.set(rtWidth, rtHeight);
  }
  if (waterDrops) {
    waterDrops.uniforms.uSceneTex.value = postIceRT.texture;
    waterDrops.uniforms.uDropFieldTex.value = dropFieldRT.texture;
    waterDrops.uniforms.uResolution.value.set(rtWidth, rtHeight);
  }

  const prevRT = renderer.getRenderTarget();
  const compileJobs: Promise<unknown>[] = [];
  const queueCompile = (sceneObj: THREE.Object3D, cam: THREE.Camera, rt: THREE.WebGLRenderTarget | null) => {
    renderer.setRenderTarget(rt);
    compileJobs.push(renderer.compileAsync(sceneObj, cam));
  };

  // Compile every shader against the exact render target format it draws into (off-thread via KHR_parallel_shader_compile)
  queueCompile(backZScene, camera, backIceZRT);
  queueCompile(backdropScene, fsCam, bgRT);
  queueCompile(solidScene, camera, bgRT);
  queueCompile(bubblesScene, camera, bubblesRT);
  queueCompile(blurScene, fsCam, blurTemp1RT);
  queueCompile(iceScene, camera, postIceRT);
  if (waterDrops) {
    queueCompile(waterDrops.fieldScene, camera, dropFieldRT);
    queueCompile(waterDrops.resolveScene, fsCam, compositeRT);
  }
  queueCompile(dropsScene, camera, compositeRT);
  queueCompile(displayScene, fsCam, null);
  renderer.setRenderTarget(prevRT);
  await Promise.all(compileJobs);

  // Batch procedural 2D & 3D texture uploads (6 per frame) so mobile boot finishes fast without stalling the wireframe!
  const textures = new Set<THREE.Texture>();
  const addUploadTex = (t: unknown) => {
    if (t instanceof THREE.Texture && !(t as { isRenderTargetTexture?: boolean }).isRenderTargetTexture) {
      textures.add(t);
    }
  };
  addUploadTex(studioEnv);
  if (liquidFilm) {
    addUploadTex(liquidFilm.texture);
    addUploadTex(liquidFilm.rimeTexture);
  }
  const collectSceneTextures = (root: THREE.Object3D) => {
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        for (const v of Object.values(mat)) {
          addUploadTex(v);
        }
        const uniforms = (mat as THREE.ShaderMaterial).uniforms;
        if (uniforms) {
          for (const u of Object.values(uniforms)) {
            if (u) addUploadTex(u.value);
          }
        }
      }
    });
  };
  collectSceneTextures(solidScene);
  collectSceneTextures(iceScene);
  collectSceneTextures(dropsScene);
  let uploaded = 0;
  for (const t of textures) {
    renderer.initTexture(t);
    uploaded++;
    if (uploaded % 6 === 0) await nextFrame();
  }

  // Prime all offscreen picture passes once unseen into compositeRT so Metal/ANGLE finishes pipeline state before reveal!
  await nextFrame();
  renderPicturePasses();
}

async function bootAsync() {
  // Let the browser paint 1 live wireframe frame immediately so the page stands on the drawing, never blank!
  renderDirty = true;
  await nextFrame();

  // ?loader: stay on the wireframe drawing for inspection
  if (holdLoader) return;

  try {
    // Spread heavy procedural CPU work (studio env, 3D noise, procedural fruit/wood textures, ice & drops) across frames
    ensureStudioEnv();
    getSharedNoise3DTexture();
    await nextFrame();

    buildPopsicle(currentSeed, initialMelt);
    await nextFrame();

    await warmCompileAndTextures();
  } catch {
    if (!fruitAssembly || !iceSystem || !waterDrops) {
      buildPopsicle(currentSeed, initialMelt);
    }
  }

  revealing = true;
  document.body.classList.remove('loading');
  updatePresetPeekShift();
  schedulePresetDockHide(2600);
  renderDirty = true;
}

if (paused && !holdLoader) {
  // Deterministic paused boot (headless verification & preset icon prerendering): ready on frame 0!
  buildPopsicle(currentSeed, initialMelt);
  if (toppingDebugMode !== 'off' || floatAirRaspberry) {
    applyToppingDebugState(true);
  }
  reveal = 1;
  revealing = true;
  endWire();
  document.body.classList.remove('loading');
  renderFrame();
} else {
  // Interactive boot: instant wireframe drawing + staggered GPU warm-up + smooth 1.6s reveal!
  applyMeltCameraZoom(0, true);
  renderFrame();
  void bootAsync().then(() => {
    if (toppingDebugMode !== 'off' || floatAirRaspberry) {
      applyToppingDebugState(true);
    }
  });
}

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
    waterDrops?.setMode(mode);
    if (iceSystem && waterDrops && liquidFilm) {
      waterDrops.update(meltState, iceSystem, liquidFilm, 0, simParams.speed);
    }
    renderFrame();
  },
  setFallMode(mode: FallFocusMode) {
    currentFallMode = mode;
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
  setToppingDebug(opts: {
    mode?: ToppingDebugMode;
    filter?: ToppingDebugFilter;
    airRaspberry?: boolean;
    lightDeg?: number;
    transBoost?: number;
    spin?: boolean;
    openPanel?: boolean;
  }) {
    if (opts.mode !== undefined) toppingDebugMode = opts.mode;
    if (opts.filter !== undefined) toppingDebugFilter = opts.filter;
    if (opts.airRaspberry !== undefined) floatAirRaspberry = opts.airRaspberry;
    if (opts.lightDeg !== undefined) toppingDebugLightDeg = opts.lightDeg;
    if (opts.transBoost !== undefined) RASPBERRY_LIGHT_UNIFORMS.uTransBoost.value = opts.transBoost;
    if (opts.spin !== undefined) toppingDebugSpin = opts.spin;
    applyToppingDebugState(true);
    renderFrame();
  },
  setDockPeeking(on: boolean) {
    setPresetDockPeeking(on);
  },
  setCustomizeOpen(on: boolean) {
    setCustomizeOpen(on);
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
      reveal,
      wireFreed,
      loading: document.body.classList.contains('loading'),
      grab: fruitAssembly?.getGrabState() ?? null,
    };
  },
};

requestAnimationFrame(tick);
