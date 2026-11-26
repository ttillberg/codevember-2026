import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  MM,
  buildHouseNet,
  generateHouseSpec,
  type BuiltHouseNet,
  type FoldablePanelId,
} from './origamiHouseNet';
import {
  buildOrigamiHouseRig,
  createOrigamiMaterials,
  type OrigamiHouseRig,
} from './origamiPaperMesh';

// URL query parameters
const params = new URLSearchParams(window.location.search);
if (params.has('clean')) {
  document.documentElement.classList.add('clean');
}

// DOM references
const canvas = document.getElementById('c') as HTMLCanvasElement;
const btnNext = document.getElementById('btn-next') as HTMLButtonElement;
const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;
const btnHelp = document.getElementById('btn-help') as HTMLButtonElement;
const helpModal = document.getElementById('help-modal') as HTMLDivElement;
const helpClose = document.getElementById('help-close') as HTMLButtonElement;
const btnAction = document.getElementById('btn-action') as HTMLButtonElement;
const progressRange = document.getElementById('progress-range') as HTMLInputElement;
const statusEl = document.getElementById('status-label') as HTMLSpanElement;

// Minimal line icons (top-right buttons)
const ICON_PLAY = `<svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>`;
const ICON_RESET = `<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`;
btnNext.innerHTML = ICON_PLAY;
btnReset.innerHTML = ICON_RESET;

// Renderer (pure white-on-white gallery daylight: paper & ground melt seamlessly, only minimal ridge shadows!)
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Seamless white-on-white studio backdrop & fog matched to lit horizontal white paper luminance!
const BACKDROP = '#f5f4f0';
const scene = new THREE.Scene();
scene.background = new THREE.Color(BACKDROP);
const studioFog = new THREE.Fog(BACKDROP, 52, 134);
scene.fog = studioFog;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.08;

// Telephoto architectural model camera (FOV 28°, generous far plane for zoomed-out large houses!)
const camera = new THREE.PerspectiveCamera(28, 1, 0.3, 650);

// Pure luminous white-on-white gallery lighting: high-noon sun (~72° elevation) avoids long cast shadows
// while matching horizontal white paper warmth 1:1 with the #f5f4f0 studio backdrop!
const hemi = new THREE.HemisphereLight('#fffdf8', '#e0ddd6', 1.50);
scene.add(hemi);

const SUN_DIR = new THREE.Vector3(5.8, 21.0, 3.6).normalize();
const sun = new THREE.DirectionalLight('#fffdf9', 1.18);
sun.position.copy(SUN_DIR).multiplyScalar(28);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 72;
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 14;
sun.shadow.camera.bottom = -14;
sun.shadow.bias = -0.00018;
sun.shadow.normalBias = 0.016;
sun.shadow.radius = 2.8;
scene.add(sun);

const fill = new THREE.DirectionalLight('#f8f7f2', 0.24);
fill.position.set(-14, 9, -10);
scene.add(fill);

// Build duplex pastel/white paper materials for the floating pre-cut nets & falling cutout sheets!
// No static ground floor — the open #f5f4f0 studio void lets each cutout sheet fall freely downward!
const materials = createOrigamiMaterials(renderer.capabilities.getMaxAnisotropy());

let curShadowExtent = 14;
let swapShadowExtent = 14;
let finalShadowExtent = 14;

function applyShadowFrustum(extent: number): void {
  const e = Math.max(14, extent);
  const sunDist = Math.max(28, e * 1.75);
  sun.position.copy(SUN_DIR).multiplyScalar(sunDist);
  sun.shadow.camera.left = -e;
  sun.shadow.camera.right = e;
  sun.shadow.camera.top = e;
  sun.shadow.camera.bottom = -e;
  sun.shadow.camera.near = Math.max(2, sunDist - e * 2.2);
  sun.shadow.camera.far = sunDist + e * 2.6;
  sun.shadow.normalBias = 0.016 * (e / 14);
  sun.shadow.camera.updateProjectionMatrix();
}
applyShadowFrustum(curShadowExtent);

// ----------------------------------------------------------------------------
// Camera Orbit & Dynamic Final-Stage Zoom-Out Framing
// ----------------------------------------------------------------------------
const BASE_LOOK_Y = 1.2;
const defaultYaw = params.get('yaw') !== null ? Number(params.get('yaw')) : 0.44;
const defaultPitch = params.get('pitch') !== null ? Number(params.get('pitch')) : 0.60;
const defaultDist = params.get('dist') !== null ? Number(params.get('dist')) : 42.0;

let targetYaw = defaultYaw;
let targetPitch = defaultPitch;
let targetDist = defaultDist;
let targetLookY = BASE_LOOK_Y;

let curYaw = targetYaw;
let curPitch = targetPitch;
let curDist = targetDist;
let curLookY = targetLookY;

// Locked at the exact swap frame so 1:1 projection NEVER shifts; zooms smoothly as we approach final stage!
let swapDist = defaultDist;
let swapLookY = BASE_LOOK_Y;
let finalDist = defaultDist;
let finalLookY = BASE_LOOK_Y;
let userZoomDelta = 0;

function computeIdealFraming(net: BuiltHouseNet): { dist: number; lookY: number; shadowExtent: number } {
  const sheetHalfW = net.sheetHalfMm * MM;
  const hWorld = net.foldedHeightMm * MM;
  const rWorld = net.foldedRadiusMm * MM;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  const aspect = Math.max(0.65, Math.min(camera.aspect || 1.6, 1.38));
  const tanH = tanV * aspect;

  // Keep the same calm zoomed-out gallery margin (~24% screen height of the FOLDED 3D house) at ANY scale!
  const distForHeight = hWorld / (0.24 * 2 * tanV);
  const distForWidth = rWorld / (0.25 * tanH);
  const dist = Math.max(defaultDist, distForHeight, distForWidth);
  const lookY = Math.max(BASE_LOOK_Y, (hWorld - 0.6) * 0.30);
  // Noon sun casts tight, short shadows (~0.32x height), allowing an even crisper shadow frustum!
  const shadowExtent = Math.max(14, sheetHalfW * 1.35, rWorld + hWorld * 0.90);

  return { dist, lookY, shadowExtent };
}

function syncCameraFromOrbit(): void {
  camera.position.set(
    curDist * Math.cos(curPitch) * Math.sin(curYaw),
    curLookY + curDist * Math.sin(curPitch),
    curDist * Math.cos(curPitch) * Math.cos(curYaw),
  );
  camera.lookAt(0, curLookY, 0);

  // Keep white-on-white studio fog scaled strictly from `curDist` so big zoomed-out houses stay crisp
  // and fog NEVER shifts on the exact swap frame!
  studioFog.near = Math.max(44, curDist * 1.25);
  studioFog.far = Math.max(120, curDist * 3.15);
}

// ----------------------------------------------------------------------------
// Dynamic House Rig + Per-Panel Fold State
// ----------------------------------------------------------------------------
interface PanelState {
  fold: number;
  target: number;
  startFold: number;
  animElapsed: number;
  animDuration: number;
  animating: boolean;
  peek: number;
  delay: number;
}

let generation = 1;
let rig: OrigamiHouseRig;
let preparedNext: { generation: number; rig: OrigamiHouseRig } | null = null;
let prepareTimerId: number | null = null;
const panelState = new Map<FoldablePanelId, PanelState>();
let hoveredPanel: FoldablePanelId | null = null;
let isScrubbing = false;
let justProjected = false;
let curPaperRelief = 1;
let targetPaperRelief = 1;
let cutoutDropState: 'none' | 'waiting' | 'falling' | 'done' = 'none';
let cutoutDropElapsed = 0;

function clearPreparedNext(): void {
  if (prepareTimerId !== null) {
    window.clearTimeout(prepareTimerId);
    prepareTimerId = null;
  }
  if (preparedNext) {
    preparedNext.rig.dispose();
    preparedNext = null;
  }
}

/**
 * Pre-build the next generation's complete flat-net + cutout + punched window chad rig ahead of time!
 * Because `aFlatPos` depends only on the house's own flat geometry (not the live camera angle),
 * pre-building removes ALL synchronous `ExtrudeGeometry` / earcut CPU work from the JIT cut frame!
 */
function prepareNextGenerationNow(gen: number): OrigamiHouseRig {
  if (preparedNext && preparedNext.generation === gen) {
    return preparedNext.rig;
  }
  clearPreparedNext();
  const spec = generateHouseSpec(gen);
  const net = buildHouseNet(spec);
  const nextRig = buildOrigamiHouseRig(net, materials, true);
  preparedNext = { generation: gen, rig: nextRig };
  return nextRig;
}

function schedulePrepareNext(gen: number, delayMs = 90): void {
  if (preparedNext && preparedNext.generation === gen) return;
  if (prepareTimerId !== null) window.clearTimeout(prepareTimerId);
  prepareTimerId = window.setTimeout(() => {
    prepareTimerId = null;
    if (cutoutDropState === 'falling') {
      schedulePrepareNext(gen, 220);
      return;
    }
    prepareNextGenerationNow(gen);
  }, delayMs);
}

function mountHouseGeneration(gen: number, fromSwap = false): void {
  if (rig) {
    scene.remove(rig.root);
    rig.dispose();
  }
  if (fromSwap && preparedNext && preparedNext.generation === gen) {
    rig = preparedNext.rig;
    preparedNext = null;
    materials.setOutsideColor(rig.net.spec.outsideColor);
  } else {
    const spec = generateHouseSpec(gen);
    materials.setOutsideColor(spec.outsideColor);
    const net = buildHouseNet(spec);
    rig = buildOrigamiHouseRig(net, materials, fromSwap);
  }
  const net = rig.net;
  scene.add(rig.root);

  panelState.clear();
  for (const id of rig.panelIds) {
    panelState.set(id, {
      fold: 0,
      target: 0,
      startFold: 0,
      animElapsed: 0,
      animDuration: 0,
      animating: false,
      peek: 0,
      delay: 0,
    });
    rig.updatePanelVisual(id, 0, 0, false);
  }
  hoveredPanel = null;

  const ideal = computeIdealFraming(net);
  if (fromSwap) {
    // Freeze exact camera, shadow anchor, and flat relief on JIT swap so the 1:1 projection has ZERO transition!
    // The complementary outer sheet & punched chads sit flush until triggered to cut out & fall!
    rig.setFoldLinesVisible(false);
    curPaperRelief = 0;
    targetPaperRelief = 0;
    rig.setPaperRelief(0);
    cutoutDropState = rig.hasCutout ? 'waiting' : 'none';
    cutoutDropElapsed = 0;
    if (rig.hasCutout) rig.updateCutoutDrop(0);

    swapDist = curDist;
    swapLookY = curLookY;
    finalDist = ideal.dist;
    finalLookY = ideal.lookY;
    userZoomDelta = 0;
    targetDist = curDist;
    targetLookY = curLookY;

    swapShadowExtent = curShadowExtent;
    finalShadowExtent = ideal.shadowExtent;
  } else {
    curPaperRelief = 1;
    targetPaperRelief = 1;
    rig.setPaperRelief(1);
    cutoutDropState = 'none';
    cutoutDropElapsed = 0;

    swapDist = defaultDist;
    swapLookY = BASE_LOOK_Y;
    finalDist = ideal.dist;
    finalLookY = ideal.lookY;
    userZoomDelta = 0;
    targetDist = curDist = defaultDist;
    targetLookY = curLookY = BASE_LOOK_Y;

    curShadowExtent = swapShadowExtent = finalShadowExtent = ideal.shadowExtent;
    applyShadowFrustum(curShadowExtent);
  }
}

mountHouseGeneration(1, false);

// ----------------------------------------------------------------------------
// Zero-Transition Live-Camera GPU Projection (Ping-Pong HalfFloat RenderTargets!)
// ----------------------------------------------------------------------------
function makeProjTarget(w: number, h: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: true,
    samples: 4,
  });
  rt.texture.wrapS = THREE.ClampToEdgeWrapping;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  return rt;
}

let rtA = makeProjTarget(2, 2);
let rtB = makeProjTarget(2, 2);
let activeRTIndex: 0 | 1 = 0;
const snapVP = new THREE.Matrix4();

function ensureProjTargetsSized(): { tw: number; th: number } {
  const drawSize = new THREE.Vector2();
  renderer.getDrawingBufferSize(drawSize);
  const tw = Math.max(2, Math.round(drawSize.x));
  const th = Math.max(2, Math.round(drawSize.y));
  if (rtA.width !== tw || rtA.height !== th) {
    rtA.dispose();
    rtA = makeProjTarget(tw, th);
  }
  if (rtB.width !== tw || rtB.height !== th) {
    rtB.dispose();
    rtB = makeProjTarget(tw, th);
  }
  return { tw, th };
}

/**
 * Upfront GPU & geometry warmup run once at startup (before first composite):
 * 1. Allocates & warms BOTH 4x-MSAA HalfFloat ping-pong FBOs at exact drawing-buffer resolution.
 * 2. Pre-builds Gen 2 (with full silhouette-clipped cutout + punched window chads) and renders
 *    one microscopic hidden frame to BOTH the HalfFloat FBO and the main canvas swapchain so
 *    WebGL/Metal compiles all 9 material pipelines & uploads Gen 2 VBOs upfront — zero first-cut hitch!
 */
function warmupCutoutPipeline(): void {
  ensureProjTargetsSized();
  syncCameraFromOrbit();
  camera.updateMatrixWorld(true);
  rig.root.updateMatrixWorld(true);

  const nextRig = prepareNextGenerationNow(generation + 1);
  snapVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

  const prevToneMapping = renderer.toneMapping;
  const prevTarget = renderer.getRenderTarget();

  // 1. Warm BOTH 4x-MSAA HalfFloat FBOs + resolve blit pipelines
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rtA);
  renderer.render(scene, camera);
  renderer.setRenderTarget(rtB);
  renderer.render(scene, camera);
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevToneMapping;

  // 2. Warm ALL 9 material pipelines (cutout clip-tint, clip-mask, chads, paper reveal) on the main canvas
  //    in both full-opacity (`depthWrite = true`) and fading (`depthWrite = false`) states using a microscopic
  //    temporary pass (immediately overwritten by the clean Gen 1 frame before paint!)
  nextRig.root.scale.set(0.0005, 0.0005, 0.0005);
  nextRig.setFoldLinesVisible(false);
  nextRig.updateCutoutDrop(0);
  scene.add(nextRig.root);
  materials.setProjection(rtA.texture, snapVP);
  materials.projUniforms.uPaperReveal.value = 0;

  renderer.render(scene, camera);
  materials.setCutoutOpacity(0.5);
  renderer.render(scene, camera);

  // 3. Cleanly restore Gen 1 state while keeping `nextRig` hot & ready in `preparedNext`!
  scene.remove(nextRig.root);
  nextRig.root.scale.set(1, 1, 1);
  nextRig.setPaperRelief(1);
  materials.setProjection(null);
  materials.setCutoutOpacity(1);
  rig.setPaperRelief(curPaperRelief);
  renderer.render(scene, camera);
}

/**
 * Just-In-Time (JIT) 1:1 camera projection:
 * Captures the EXACT current 3D view from the user's live camera angle into the inactive ping-pong
 * HalfFloat render target and spawns the next DIFFERENT house flat underneath with its exact
 * complementary cutout sheet & punched window chads — ZERO transition!
 */
function projectAndSpawnUnderneath(): void {
  const drawSize = new THREE.Vector2();
  renderer.getDrawingBufferSize(drawSize);
  const tw = Math.max(2, Math.round(drawSize.x));
  const th = Math.max(2, Math.round(drawSize.y));
  const nextIdx: 0 | 1 = activeRTIndex === 0 ? 1 : 0;
  let targetRT = nextIdx === 0 ? rtA : rtB;
  if (targetRT.width !== tw || targetRT.height !== th) {
    targetRT.dispose();
    targetRT = makeProjTarget(tw, th);
    if (nextIdx === 0) rtA = targetRT;
    else rtB = targetRT;
  }

  syncCameraFromOrbit();
  camera.updateMatrixWorld(true);
  rig.root.updateMatrixWorld(true);

  rig.setFoldLinesVisible(false);

  const prevTarget = renderer.getRenderTarget();
  const prevToneMapping = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(targetRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevToneMapping;

  snapVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  activeRTIndex = nextIdx;

  // INSTANT JIT SWAP: spawn the next DIFFERENT house flat + complementary cutout sheet with 1:1 projection!
  generation += 1;
  justProjected = true;

  mountHouseGeneration(generation, true);
  materials.setProjection(targetRT.texture, snapVP);
  syncUI();
}

function triggerCutoutDrop(): void {
  revealCreasesAfterSwap();
  if (cutoutDropState === 'waiting') {
    cutoutDropState = 'falling';
    cutoutDropElapsed = 0;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function getZoomBounds(): { minDist: number; maxDist: number } {
  return { minDist: 14, maxDist: Math.max(135, finalDist * 1.9) };
}

function computeAutoZoom(foldProg: number): { autoDist: number; autoLookY: number; shadowExtent: number } {
  // Smoothly zoom out as we approach the final folded stage (stays 100% locked at fold=0 for zero-transition swap!)
  const zRaw = clamp01((foldProg - 0.16) / 0.78);
  const zoomEase = zRaw * zRaw * (3 - 2 * zRaw);
  const autoDist = swapDist + (finalDist - swapDist) * zoomEase;
  const autoLookY = swapLookY + (finalLookY - swapLookY) * zoomEase;

  // Expand shadow box ahead of tall walls rising so cast shadows never clip mid-fold!
  const sRaw = clamp01(foldProg / 0.42);
  const sEase = sRaw * sRaw * (3 - 2 * sRaw);
  const shadowExtent = swapShadowExtent + (finalShadowExtent - swapShadowExtent) * sEase;
  return { autoDist, autoLookY, shadowExtent };
}

function revealCreasesAfterSwap(): void {
  if (justProjected) {
    justProjected = false;
    targetPaperRelief = 1;
    rig.setFoldLinesVisible(true);
  }
}

function allPanelsFoldedTarget(): boolean {
  return rig.panelIds.every((id) => (panelState.get(id)?.target ?? 0) >= 0.99);
}

function allPanelsSettledFolded(): boolean {
  return rig.panelIds.every((id) => {
    const ps = panelState.get(id);
    return ps && !ps.animating && ps.delay <= 0 && ps.fold >= 0.999 && ps.target >= 0.99;
  });
}

function computeFoldProgress(): number {
  if (rig.panelIds.length === 0) return 0;
  let sum = 0;
  for (const id of rig.panelIds) {
    sum += panelState.get(id)?.fold ?? 0;
  }
  return sum / rig.panelIds.length;
}

/**
 * Silky architectural cubic-bezier easing `(0.45, 0.0, 0.16, 1.0)`:
 * unhurried lift off the flat paper, fluid arc, long cushioned settle with zero harsh bounce.
 */
function easePaperFold(x: number): number {
  const u = clamp01(x);
  if (u <= 0 || u >= 1) return u;
  const x1 = 0.45;
  const x2 = 0.16;
  let t = u;
  for (let i = 0; i < 6; i++) {
    const inv = 1 - t;
    const bx = 3 * inv * inv * t * x1 + 3 * inv * t * t * x2 + t * t * t;
    const dx = 3 * inv * inv * x1 + 6 * inv * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (Math.abs(dx) < 1e-6) break;
    t = clamp01(t - (bx - u) / dx);
  }
  const inv = 1 - t;
  // y1 = 0.0, y2 = 1.0 -> 3*(1-t)*t^2 + t^3
  return 3 * inv * t * t + t * t * t;
}

function startPanelCurve(ps: PanelState, target: number, durationSec: number, delaySec = 0): void {
  ps.startFold = ps.fold;
  ps.target = clamp01(target);
  ps.delay = Math.max(0, delaySec);
  ps.animElapsed = 0;
  ps.animDuration = Math.max(0.05, durationSec);
  ps.animating = Math.abs(ps.target - ps.fold) > 0.0005 || ps.delay > 0;
}

/**
 * Slower, curved stagger timing table sorted dynamically from the walls FURTHEST AWAY
 * from the current camera angle to the walls CLOSEST to the camera!
 * That way the far walls rise first (keeping the white interior & projected graphic visible),
 * roofs trail smoothly behind their parent walls, and the nearest facade closes last.
 */
function getStaggerOrder(referenceYaw = curYaw): Array<{
  id: FoldablePanelId;
  delaySec: number;
  durationSec: number;
  scrubStart: number;
  scrubSpan: number;
}> {
  const camX = Math.sin(referenceYaw);
  const camZ = Math.cos(referenceYaw);
  const houseYaw = rig.net.spec.yawOffset;
  const cy = Math.cos(houseYaw);
  const sy = Math.sin(houseYaw);

  // Outward XZ normal for ANY wall (cross, ribbon, hex, or oct!)
  const wallOutwardDot = (id: FoldablePanelId): number => {
    const def = rig.net.panelMap.get(id);
    let nx = 0;
    let nz = 0;
    if (rig.net.spec.topology === 'ribbon') {
      const localN: Record<string, [number, number]> = {
        front: [0, 1],
        back: [0, -1],
        left: [-1, 0],
        right: [1, 0],
      };
      [nx, nz] = localN[id] ?? [0, 0];
    } else if (def?.wallFrame) {
      // Sheet vAxis (vx, vy) maps directly to flat 3D outward normal (vx, -vy)!
      nx = def.wallFrame.vAxis[0];
      nz = -def.wallFrame.vAxis[1];
    }
    const wx = nx * cy + nz * sy;
    const wz = -nx * sy + nz * cy;
    return wx * camX + wz * camZ;
  };

  const wallIds = rig.panelIds.filter((id) => rig.net.panelMap.get(id)?.stage === 'wall');
  // Sort ascending by outward dot product: most negative = furthest away from camera -> folds FIRST!
  const sortedWalls = [...wallIds].sort((a, b) => wallOutwardDot(a) - wallOutwardDot(b));

  const wallRank = new Map<FoldablePanelId, number>();
  sortedWalls.forEach((id, i) => wallRank.set(id, i));

  // Curved progressive spacing across walls (0.00 -> ... -> 1.00)
  const wallCount = Math.max(1, sortedWalls.length - 1);
  const wallCurve = (rank: number) => Math.pow(rank / wallCount, 1.28);

  const hasCap = rig.panels.has('roofCap');
  const isSingleSpanRoof = rig.net.spec.roofType === 'shed' || rig.net.spec.roofType === 'flat';
  const isRibbon = rig.net.spec.topology === 'ribbon';
  const isPolygon = rig.net.spec.topology === 'hex' || rig.net.spec.topology === 'oct';

  const wallDelay = new Map<FoldablePanelId, number>();
  const wallScrub = new Map<FoldablePanelId, number>();
  const items: Array<{
    id: FoldablePanelId;
    delaySec: number;
    durationSec: number;
    scrubStart: number;
    scrubSpan: number;
  }> = [];

  if (isRibbon) {
    // Wrap-around ribbon dance: `back` lifts the entire strip off the paper first, then `left` & `right`
    // curl inward like embracing arms (farther wing slightly ahead), and `front` wraps smoothly around the front!
    const leftFurther = wallOutwardDot('left') <= wallOutwardDot('right');
    const ribbonTiming: Record<string, { d: number; s: number; dur: number }> = {
      back: { d: 0.0, s: 0.0, dur: 1.32 },
      left: { d: leftFurther ? 0.22 : 0.40, s: leftFurther ? 0.10 : 0.18, dur: 1.28 },
      right: { d: leftFurther ? 0.40 : 0.22, s: leftFurther ? 0.18 : 0.10, dur: 1.28 },
      front: { d: (leftFurther ? 0.40 : 0.22) + 0.30, s: (leftFurther ? 0.18 : 0.10) + 0.16, dur: 1.28 },
    };

    for (const id of wallIds) {
      const t = ribbonTiming[id] ?? { d: 0.3, s: 0.14, dur: 1.28 };
      wallDelay.set(id, t.d);
      wallScrub.set(id, t.s);
      items.push({
        id,
        delaySec: t.d,
        durationSec: t.dur,
        scrubStart: t.s,
        scrubSpan: hasCap ? 0.42 : 0.46,
      });
    }
  } else if (isPolygon) {
    // Radial lotus-bloom choreography: furthest petals rise first around both flanks with a gentle shimmer,
    // blooming upward around the projected interior before the front entrance petal closes last!
    for (const id of sortedWalls) {
      const rank = wallRank.get(id) ?? 0;
      const c = wallCurve(rank);
      const d = c * 0.78;
      const s = c * 0.30;
      wallDelay.set(id, d);
      wallScrub.set(id, s);
      items.push({
        id,
        delaySec: d,
        durationSec: 1.26,
        scrubStart: s,
        scrubSpan: hasCap ? 0.42 : 0.46,
      });
    }
  } else {
    for (const id of sortedWalls) {
      const rank = wallRank.get(id) ?? 0;
      const c = wallCurve(rank);
      const d = c * 0.62;
      const s = c * 0.26;
      wallDelay.set(id, d);
      wallScrub.set(id, s);
      items.push({
        id,
        delaySec: d,
        durationSec: 1.28,
        scrubStart: s,
        scrubSpan: hasCap ? 0.44 : 0.48,
      });
    }
  }

  let maxRoofDelay = 0;
  let capParentDelay = 0;
  const capParentId = rig.net.panelMap.get('roofCap')?.parent ?? 'roofB';
  for (const id of rig.panelIds) {
    const def = rig.net.panelMap.get(id)!;
    if (def.stage !== 'roof') continue;
    const pId = (def.parent as FoldablePanelId) ?? 'left';
    let d = (wallDelay.get(pId) ?? 0.35) + 0.44;
    let s = (wallScrub.get(pId) ?? 0.14) + 0.22;
    if (isSingleSpanRoof && id === 'roofL') {
      const oppD = wallDelay.get('right') ?? 0;
      const oppS = wallScrub.get('right') ?? 0;
      d = Math.max(d, oppD + 0.26);
      s = Math.max(s, oppS + 0.18);
    }
    if (d > maxRoofDelay) maxRoofDelay = d;
    if (id === capParentId) capParentDelay = d;
    items.push({
      id,
      delaySec: d,
      durationSec: 1.24,
      scrubStart: Math.min(s, hasCap ? 0.56 : 0.56),
      scrubSpan: hasCap ? 0.38 : 0.44,
    });
  }

  for (const id of rig.panelIds) {
    const def = rig.net.panelMap.get(id)!;
    if (def.stage !== 'cap') continue;
    items.push({
      id,
      delaySec: Math.max(capParentDelay + 0.44, maxRoofDelay + 0.16),
      durationSec: 1.18,
      scrubStart: 0.58,
      scrubSpan: 0.42,
    });
  }

  return items;
}

let latchedScrubYaw = defaultYaw;

function launchStaggeredFold(toFold: 0 | 1, leadDelaySec = 0): void {
  revealCreasesAfterSwap();
  latchedScrubYaw = curYaw;
  const schedule = getStaggerOrder(curYaw);
  const maxDelay = schedule.reduce((m, s) => Math.max(m, s.delaySec), 0);

  for (const s of schedule) {
    const ps = panelState.get(s.id);
    if (!ps) continue;
    // When unfolding, reverse the curved stagger wave so roof cap & slopes bloom open ahead of the walls!
    const delay =
      toFold === 1 ? leadDelaySec + s.delaySec : Math.max(0, maxDelay - s.delaySec);
    startPanelCurve(ps, toFold, s.durationSec, delay);
  }
  syncUI();
}

function applyFoldScrub(t: number, snap = false): void {
  revealCreasesAfterSwap();
  const v = clamp01(t);
  if (v > 0.01) {
    triggerCutoutDrop();
  }
  const schedule = getStaggerOrder(latchedScrubYaw);

  for (const s of schedule) {
    const ps = panelState.get(s.id);
    if (!ps) continue;
    const raw = clamp01((v - s.scrubStart) / s.scrubSpan);
    const f = easePaperFold(raw);
    ps.delay = 0;
    ps.animating = false;
    ps.target = f;
    if (snap) {
      ps.fold = f;
      ps.startFold = f;
    }
  }
}

function resetAll(): void {
  generation = 1;
  justProjected = false;
  clearPreparedNext();
  materials.setProjection(null);
  mountHouseGeneration(1, false);
  targetYaw = defaultYaw;
  targetPitch = defaultPitch;
  schedulePrepareNext(2, 120);
  syncUI();
}

function triggerStepAction(): void {
  // If the current 3D house is already folded & settled, run JIT projection from the live camera angle,
  // cut out & drop the surrounding waste sheet + window chads first, then fold the new house!
  if (allPanelsSettledFolded()) {
    projectAndSpawnUnderneath();
    triggerCutoutDrop();
    launchStaggeredFold(1, 0.44);
    return;
  }
  if (!allPanelsFoldedTarget()) {
    const lead = cutoutDropState === 'waiting' ? 0.44 : 0;
    if (cutoutDropState === 'waiting') triggerCutoutDrop();
    launchStaggeredFold(1, lead);
  }
}

function toggleFoldAll(): void {
  if (!allPanelsFoldedTarget() && cutoutDropState === 'waiting') {
    triggerCutoutDrop();
    launchStaggeredFold(1, 0.44);
    return;
  }
  launchStaggeredFold(allPanelsFoldedTarget() ? 0 : 1);
}

function syncUI(): void {
  const allTargetFolded = allPanelsFoldedTarget();
  const settledFolded = allPanelsSettledFolded();
  const houseName = rig.net.spec.label;
  const prefix = generation > 1 ? `Layer ${generation} · ${houseName} · ` : '';

  btnAction.textContent = 'Fold';
  if (!allTargetFolded) {
    const hoveredDef = hoveredPanel ? rig.net.panelMap.get(hoveredPanel) : null;
    statusEl.textContent = hoveredDef
      ? `${prefix}Fold ${hoveredDef.label.toLowerCase()}`
      : `${prefix}Click Fold or drag any flap`;
  } else if (!settledFolded) {
    statusEl.textContent = `${prefix}Folding`;
  } else {
    statusEl.textContent = `${prefix}Folded`;
  }

  if (!isScrubbing) {
    progressRange.value = computeFoldProgress().toFixed(3);
  }
}

// ----------------------------------------------------------------------------
// Raycasting & Direct Hand-Folding Pointer Interaction
// ----------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pickPanel3D(clientX: number, clientY: number): FoldablePanelId | null {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  const targets: THREE.Object3D[] = [];
  for (const id of rig.panelIds) {
    const pv = rig.panels.get(id);
    if (pv) targets.push(pv.mesh);
  }
  const hits = raycaster.intersectObjects(targets, false);
  if (hits.length === 0) return null;
  const ud = hits[0].object.userData as { kind?: string; id?: FoldablePanelId };
  return ud.kind === 'panel' && ud.id ? ud.id : null;
}

function updateHover(clientX: number, clientY: number): void {
  const next = pickPanel3D(clientX, clientY);
  if (next !== hoveredPanel) {
    hoveredPanel = next;
    if (next) revealCreasesAfterSwap();
    canvas.classList.toggle('can-fold', hoveredPanel !== null);
    syncUI();
  }
}

type DragMode =
  | { kind: 'none' }
  | { kind: 'orbit'; lastX: number; lastY: number }
  | { kind: 'fold'; panel: FoldablePanelId; startX: number; startY: number; startFold: number; moved: boolean };

let drag: DragMode = { kind: 'none' };
const activePointers = new Map<number, { x: number; y: number }>();
let lastPinchDist = 0;

function panelFoldDragSensitivity(pid: FoldablePanelId, dx: number, dy: number): number {
  const pv = rig.panels.get(pid);
  if (!pv) return -dy / 120;
  const worldPos = new THREE.Vector3();
  pv.pivot.getWorldPosition(worldPos);
  const inward = new THREE.Vector3(-worldPos.x, 3.2, -worldPos.z).normalize();

  const p0 = worldPos.clone().project(camera);
  const p1 = worldPos.clone().addScaledVector(inward, 1.5).project(camera);
  const sx = (p1.x - p0.x) * canvas.clientWidth * 0.5;
  const sy = -(p1.y - p0.y) * canvas.clientHeight * 0.5;
  const sLen = Math.hypot(sx, sy);
  if (sLen < 1e-3) return -dy / 120;
  return (dx * (sx / sLen) + dy * (sy / sLen)) / 115;
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  canvas.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    drag = { kind: 'none' };
    return;
  }

  const pHit = pickPanel3D(e.clientX, e.clientY);
  if (pHit) {
    triggerCutoutDrop();
    hoveredPanel = pHit;
    drag = {
      kind: 'fold',
      panel: pHit,
      startX: e.clientX,
      startY: e.clientY,
      startFold: panelState.get(pHit)?.fold ?? 0,
      moved: false,
    };
    return;
  }

  drag = { kind: 'orbit', lastX: e.clientX, lastY: e.clientY };
  canvas.classList.add('orbiting');
});

canvas.addEventListener('pointermove', (e) => {
  const prevPtr = activePointers.get(e.pointerId);
  if (!prevPtr) {
    if (e.pointerType === 'mouse') updateHover(e.clientX, e.clientY);
    return;
  }
  prevPtr.x = e.clientX;
  prevPtr.y = e.clientY;

  if (activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    if (lastPinchDist > 0) {
      const { minDist, maxDist } = getZoomBounds();
      const { autoDist } = computeAutoZoom(computeFoldProgress());
      const desired = Math.max(minDist, Math.min(maxDist, (autoDist + userZoomDelta) * (lastPinchDist / Math.max(dist, 1))));
      userZoomDelta = desired - autoDist;
    }
    lastPinchDist = dist;
    return;
  }

  if (drag.kind === 'orbit') {
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (Math.hypot(dx, dy) > 1.5) revealCreasesAfterSwap();
    targetYaw -= dx * 0.0072;
    targetPitch = Math.max(0.16, Math.min(1.42, targetPitch + dy * 0.0068));
    return;
  }

  if (drag.kind === 'fold') {
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    if (drag.moved) {
      const ps = panelState.get(drag.panel);
      if (ps) {
        const delta = panelFoldDragSensitivity(drag.panel, dx, dy);
        const next = clamp01(drag.startFold + delta);
        ps.delay = 0;
        ps.animating = false;
        ps.fold = next;
        ps.startFold = next;
        ps.target = next;
        syncUI();
      }
    }
  }
});

function endPointer(e: PointerEvent, isCancel: boolean): void {
  activePointers.delete(e.pointerId);
  if (activePointers.size === 0) {
    canvas.classList.remove('orbiting');
    lastPinchDist = 0;
  }

  if (!isCancel && drag.kind === 'fold') {
    const ps = panelState.get(drag.panel);
    if (ps) {
      if (!drag.moved) {
        startPanelCurve(ps, ps.target > 0.5 ? 0 : 1, 0.95, 0);
      } else {
        startPanelCurve(ps, ps.fold >= 0.45 ? 1 : 0, 0.65, 0);
      }
      syncUI();
    }
  }

  drag = { kind: 'none' };
  if (e.pointerType === 'mouse') updateHover(e.clientX, e.clientY);
}

canvas.addEventListener('pointerup', (e) => endPointer(e, false));
canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
canvas.addEventListener('pointerleave', () => {
  if (drag.kind === 'none') {
    hoveredPanel = null;
    canvas.classList.remove('can-fold');
    syncUI();
  }
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const { minDist, maxDist } = getZoomBounds();
    const { autoDist } = computeAutoZoom(computeFoldProgress());
    const desired = Math.max(minDist, Math.min(maxDist, (autoDist + userZoomDelta) * Math.exp(e.deltaY * 0.0011)));
    userZoomDelta = desired - autoDist;
  },
  { passive: false },
);

// UI Controls
btnAction.addEventListener('click', (e) => {
  e.stopPropagation();
  triggerStepAction();
});
btnNext.addEventListener('click', (e) => {
  e.stopPropagation();
  triggerStepAction();
});
btnReset.addEventListener('click', (e) => {
  e.stopPropagation();
  resetAll();
});

progressRange.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  isScrubbing = true;
  latchedScrubYaw = curYaw;
});
progressRange.addEventListener('pointerup', () => {
  isScrubbing = false;
  syncUI();
});
progressRange.addEventListener('input', () => {
  applyFoldScrub(Number(progressRange.value) || 0, false);
  syncUI();
});

const setHelpOpen = (open: boolean) => {
  helpModal.hidden = !open;
};
btnHelp.addEventListener('click', (e) => {
  e.stopPropagation();
  setHelpOpen(helpModal.hidden);
});
helpClose.addEventListener('click', () => setHelpOpen(false));
helpModal.addEventListener('click', (e) => {
  if (e.target === helpModal) setHelpOpen(false);
});

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape' && !helpModal.hidden) {
    setHelpOpen(false);
    return;
  }
  if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
    e.preventDefault();
    setHelpOpen(helpModal.hidden);
    return;
  }
  if (!helpModal.hidden) return;

  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    triggerStepAction();
  } else if (e.key === 'f' || e.key === 'F') {
    toggleFoldAll();
  } else if (e.key === 'r' || e.key === 'R') {
    resetAll();
  }
});

// Resize
let resizeTargetTimer: number | null = null;
function resize(): void {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (rig) {
    const ideal = computeIdealFraming(rig.net);
    finalDist = ideal.dist;
    finalLookY = ideal.lookY;
    finalShadowExtent = ideal.shadowExtent;
  }
  if (resizeTargetTimer !== null) window.clearTimeout(resizeTargetTimer);
  resizeTargetTimer = window.setTimeout(() => {
    resizeTargetTimer = null;
    ensureProjTargetsSized();
  }, 240);
}
window.addEventListener('resize', resize);
resize();

// Apply optional ?fold=0..1 preset
if (params.has('fold')) {
  applyFoldScrub(Number(params.get('fold')) || 0, true);
  const z = computeAutoZoom(computeFoldProgress());
  targetDist = curDist = z.autoDist;
  targetLookY = curLookY = z.autoLookY;
  curShadowExtent = z.shadowExtent;
  applyShadowFrustum(curShadowExtent);
}
syncCameraFromOrbit();
warmupCutoutPipeline();
syncUI();

// Debug hook
(
  window as unknown as {
    __origami?: {
      progress: (v: number) => void;
      fold: (pid: FoldablePanelId, v: number) => void;
      projectNow: () => void;
      dropCutout: (atSec?: number) => void;
      view: (yaw: number, pitch: number, dist: number) => void;
      info: () => {
        generation: number;
        label: string;
        topology: string;
        roofType: string;
        W: number;
        D: number;
        H: number;
        sheetMm: number;
        foldedHeightMm: number;
        curDist: number;
        finalDist: number;
      };
    };
  }
).__origami = {
  progress(v: number) {
    applyFoldScrub(v, true);
    if (v > 0.001) {
      curPaperRelief = targetPaperRelief = 1;
      rig.setPaperRelief(1);
      if (rig.hasCutout) {
        cutoutDropState = 'done';
        rig.updateCutoutDrop(99);
      }
    }
    const fp = computeFoldProgress();
    const z = computeAutoZoom(fp);
    const { minDist, maxDist } = getZoomBounds();
    targetDist = curDist = Math.max(minDist, Math.min(maxDist, z.autoDist + userZoomDelta));
    targetLookY = curLookY = z.autoLookY;
    curShadowExtent = z.shadowExtent;
    applyShadowFrustum(curShadowExtent);
    syncCameraFromOrbit();
    if (fp >= 0.999) {
      schedulePrepareNext(generation + 1, 80);
    }
    syncUI();
  },
  fold(pid: FoldablePanelId, v: number) {
    triggerCutoutDrop();
    const ps = panelState.get(pid);
    if (ps) {
      ps.delay = 0;
      ps.animating = false;
      ps.fold = v;
      ps.startFold = v;
      ps.target = v;
      syncUI();
    }
  },
  projectNow() {
    projectAndSpawnUnderneath();
  },
  dropCutout(atSec?: number) {
    if (atSec !== undefined) {
      revealCreasesAfterSwap();
      curPaperRelief = targetPaperRelief = 1;
      rig.setPaperRelief(1);
      cutoutDropState = 'falling';
      cutoutDropElapsed = atSec;
      const alive = rig.updateCutoutDrop(atSec);
      if (!alive) cutoutDropState = 'done';
    } else {
      triggerCutoutDrop();
    }
  },
  view(yaw: number, pitch: number, dist: number) {
    targetYaw = curYaw = yaw;
    targetPitch = curPitch = pitch;
    swapDist = finalDist = targetDist = curDist = dist;
    userZoomDelta = 0;
    syncCameraFromOrbit();
  },
  info() {
    const s = rig.net.spec;
    return {
      generation,
      label: s.label,
      topology: s.topology,
      roofType: s.roofType,
      W: Math.round(s.W * 10) / 10,
      D: Math.round(s.D * 10) / 10,
      H: Math.round(s.H * 10) / 10,
      sheetMm: rig.net.sheetHalfMm * 2,
      foldedHeightMm: Math.round(rig.net.foldedHeightMm * 10) / 10,
      curDist: Math.round(curDist * 10) / 10,
      finalDist: Math.round(finalDist * 10) / 10,
    };
  },
};

// Main animation loop (crisp paper-crease spring physics + smooth final-stage zoom-out + zero-transition projection!)
let lastTime = performance.now();

function animate(now: number): void {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) * 0.001);
  lastTime = now;

  // 1. Update panel folds (slower cubic-bezier curved stagger wave + gentle scrub follow!)
  let foldChanged = false;
  for (const pid of rig.panelIds) {
    const ps = panelState.get(pid)!;

    if (drag.kind !== 'fold' || drag.panel !== pid) {
      if (ps.animating) {
        if (ps.delay > 0) {
          ps.delay = Math.max(0, ps.delay - dt);
        } else {
          ps.animElapsed += dt;
          const u = clamp01(ps.animElapsed / ps.animDuration);
          const eased = easePaperFold(u);
          ps.fold = ps.startFold + (ps.target - ps.startFold) * eased;
          if (u >= 1) {
            ps.fold = ps.target;
            ps.animating = false;
          }
        }
        foldChanged = true;
      } else {
        const diff = ps.target - ps.fold;
        if (Math.abs(diff) > 0.0004) {
          ps.fold += diff * (1 - Math.exp(-dt * 7.5));
          if (Math.abs(ps.target - ps.fold) <= 0.0008) ps.fold = ps.target;
          foldChanged = true;
        }
      }
    }

    const wantPeek = hoveredPanel === pid && drag.kind === 'none' ? 1 : 0;
    ps.peek += (wantPeek - ps.peek) * (1 - Math.exp(-dt * 14));
    const peekRad = ps.peek * (ps.fold > 0.5 ? -0.055 : 0.085);

    rig.updatePanelVisual(pid, ps.fold, peekRad, hoveredPanel === pid);
  }

  const foldProg = computeFoldProgress();
  if (foldChanged && !isScrubbing) {
    progressRange.value = foldProg.toFixed(3);
  }

  // 2. Animate falling outer cutout sheet + punched window chads (drops cleanly just before folding!)
  if (cutoutDropState === 'falling') {
    cutoutDropElapsed += dt;
    const stillFalling = rig.updateCutoutDrop(cutoutDropElapsed);
    if (!stillFalling) {
      cutoutDropState = 'done';
    }
  }

  // 3. Smooth camera orbit & unhurried final-stage zoom-out for bigger houses (locked on JIT swap!)
  const { autoDist, autoLookY, shadowExtent } = computeAutoZoom(foldProg);
  const { minDist, maxDist } = getZoomBounds();
  targetDist = Math.max(minDist, Math.min(maxDist, autoDist + userZoomDelta));
  targetLookY = autoLookY;

  const camAlpha = 1 - Math.exp(-dt * 4.2);
  curYaw += (targetYaw - curYaw) * camAlpha;
  curPitch += (targetPitch - curPitch) * camAlpha;
  curDist += (targetDist - curDist) * camAlpha;
  curLookY += (targetLookY - curLookY) * camAlpha;
  syncCameraFromOrbit();

  if (Math.abs(targetPaperRelief - curPaperRelief) > 0.002) {
    curPaperRelief += (targetPaperRelief - curPaperRelief) * (1 - Math.exp(-dt * 16));
    if (Math.abs(targetPaperRelief - curPaperRelief) <= 0.004) curPaperRelief = targetPaperRelief;
    rig.setPaperRelief(curPaperRelief);
  }

  if (Math.abs(shadowExtent - curShadowExtent) > 0.04) {
    curShadowExtent += (shadowExtent - curShadowExtent) * camAlpha;
    applyShadowFrustum(curShadowExtent);
  }

  // Keep status caption updated & quietly pre-build the next house once settled into 3D!
  if (foldChanged && allPanelsSettledFolded()) {
    schedulePrepareNext(generation + 1, 80);
    syncUI();
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
