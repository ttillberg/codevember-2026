import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  FOLDABLE_ORDER,
  HOUSE_PANELS,
  type FoldablePanelId,
} from './origamiHouseNet';
import {
  buildOrigamiHouseRig,
  createOrigamiMaterials,
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
scene.fog = new THREE.Fog(BACKDROP, 42, 115);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.08;

// Telephoto architectural model camera (FOV 28°)
const camera = new THREE.PerspectiveCamera(28, 1, 0.2, 200);

// Pure luminous white-on-white gallery lighting: crisp raking sun carves minimal ridge & cast shadows!
const hemi = new THREE.HemisphereLight('#ffffff', '#e4e2dc', 1.55);
scene.add(hemi);

const sun = new THREE.DirectionalLight('#fffdf9', 1.85);
sun.position.set(17.5, 10.6, 10.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 4;
sun.shadow.camera.far = 52;
sun.shadow.camera.left = -13;
sun.shadow.camera.right = 13;
sun.shadow.camera.top = 13;
sun.shadow.camera.bottom = -13;
sun.shadow.bias = -0.00018;
sun.shadow.normalBias = 0.018;
sun.shadow.radius = 3.2;
scene.add(sun);

// Whisper-soft cool sky fill keeping leeward white facets crisp yet ethereal
const fill = new THREE.DirectionalLight('#f4f6fa', 0.26);
fill.position.set(-14, 9, -10);
scene.add(fill);

// Build pure white matching paper materials for both endless ground sheet & pre-cut house net!
const materials = createOrigamiMaterials(renderer.capabilities.getMaxAnisotropy());

// Endless seamless white paper ground melting identically into the flat paper net & horizon!
const deskMesh = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), materials.ground);
deskMesh.rotation.x = -Math.PI * 0.5;
deskMesh.position.y = -0.001;
deskMesh.receiveShadow = true;
scene.add(deskMesh);

const rig = buildOrigamiHouseRig(materials);
scene.add(rig.root);

// ----------------------------------------------------------------------------
// Direct Hand-Folding State (All 6 Creases Immediately Ready to Fold!)
// ----------------------------------------------------------------------------
interface PanelState {
  fold: number;
  target: number;
  vel: number;
  peek: number;
}

const panelState: Record<FoldablePanelId, PanelState> = {
  front: { fold: 0, target: 0, vel: 0, peek: 0 },
  back: { fold: 0, target: 0, vel: 0, peek: 0 },
  left: { fold: 0, target: 0, vel: 0, peek: 0 },
  right: { fold: 0, target: 0, vel: 0, peek: 0 },
  roofL: { fold: 0, target: 0, vel: 0, peek: 0 },
  roofR: { fold: 0, target: 0, vel: 0, peek: 0 },
};

let hoveredPanel: FoldablePanelId | null = null;
let isScrubbing = false;

// Generously zoomed-out architectural studio framing!
const defaultYaw = params.get('yaw') !== null ? Number(params.get('yaw')) : 0.44;
const defaultPitch = params.get('pitch') !== null ? Number(params.get('pitch')) : 0.64;
const defaultDist = params.get('dist') !== null ? Number(params.get('dist')) : 41.0;

let targetYaw = defaultYaw;
let targetPitch = defaultPitch;
let targetDist = defaultDist;
let targetLookY = 0.25;
let curYaw = targetYaw;
let curPitch = targetPitch;
let curDist = targetDist;
let curLookY = targetLookY;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function allPanelsFolded(): boolean {
  return FOLDABLE_ORDER.every((p) => panelState[p].target >= 0.99);
}

function computeFoldProgress(): number {
  const wallIds: FoldablePanelId[] = ['front', 'back', 'left', 'right'];
  const wallSum = wallIds.reduce((a, p) => a + panelState[p].fold, 0) / wallIds.length;
  const roofSum = (panelState.roofL.fold + panelState.roofR.fold) * 0.5;
  return wallSum * 0.66 + roofSum * 0.34;
}

/** Map scrubber `t ∈ [0, 1]` smoothly onto walls (0.00 -> 0.68) then 45° roof slopes (0.62 -> 1.00) */
function applyFoldScrub(t: number, snap = false): void {
  const v = clamp01(t);

  const wallIds: FoldablePanelId[] = ['front', 'back', 'left', 'right'];
  wallIds.forEach((pid, i) => {
    const start = i * 0.085;
    const span = 0.38;
    const f = clamp01((v - start) / span);
    const ps = panelState[pid];
    ps.target = f;
    if (snap) {
      ps.fold = f;
      ps.vel = 0;
    }
  });

  const roofIds: FoldablePanelId[] = ['roofL', 'roofR'];
  roofIds.forEach((pid, i) => {
    const start = 0.60 + i * 0.08;
    const span = 0.32;
    const f = clamp01((v - start) / span);
    const ps = panelState[pid];
    ps.target = f;
    if (snap) {
      ps.fold = f;
      ps.vel = 0;
    }
  });

  if (snap) {
    const avgWall =
      (panelState.front.fold + panelState.back.fold + panelState.left.fold + panelState.right.fold) * 0.25;
    targetLookY = curLookY = 0.25 + avgWall * 1.45;
  }
}

function resetFlat(): void {
  hoveredPanel = null;
  for (const pid of FOLDABLE_ORDER) {
    panelState[pid].target = 0;
  }
  targetYaw = defaultYaw;
  targetPitch = defaultPitch;
  targetDist = defaultDist;
  syncUI();
}

function triggerStepAction(): void {
  const walls: FoldablePanelId[] = ['front', 'back', 'left', 'right'];
  if (walls.some((w) => panelState[w].target < 0.99)) {
    for (const w of walls) panelState[w].target = 1;
    syncUI();
    return;
  }
  if (panelState.roofL.target < 0.99 || panelState.roofR.target < 0.99) {
    panelState.roofL.target = 1;
    panelState.roofR.target = 1;
    syncUI();
    return;
  }
  for (const pid of FOLDABLE_ORDER) panelState[pid].target = 0;
  syncUI();
}

function toggleFoldAll(): void {
  const next = allPanelsFolded() ? 0 : 1;
  for (const pid of FOLDABLE_ORDER) panelState[pid].target = next;
  syncUI();
}

function syncUI(): void {
  const wallsUp = (['front', 'back', 'left', 'right'] as FoldablePanelId[]).filter(
    (w) => panelState[w].target >= 0.99,
  ).length;
  const roofsUp = (panelState.roofL.target >= 0.99 ? 1 : 0) + (panelState.roofR.target >= 0.99 ? 1 : 0);

  if (wallsUp < 4) {
    btnAction.textContent = 'Fold walls';
    statusEl.textContent = hoveredPanel
      ? `Fold ${HOUSE_PANELS[hoveredPanel].label.toLowerCase()}`
      : 'Click or drag any flap to fold';
  } else if (roofsUp < 2) {
    btnAction.textContent = 'Close roof';
    statusEl.textContent = hoveredPanel
      ? `Fold ${HOUSE_PANELS[hoveredPanel].label.toLowerCase()}`
      : 'Fold both roof slopes to meet at the ridge';
  } else {
    btnAction.textContent = 'Unfold';
    statusEl.textContent = 'Click any face to unfold · drag desk to orbit';
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

  const targets = FOLDABLE_ORDER.map((id) => rig.panels[id].mesh);
  const hits = raycaster.intersectObjects(targets, false);
  if (hits.length === 0) return null;
  const ud = hits[0].object.userData as { kind?: string; id?: FoldablePanelId };
  return ud.kind === 'panel' && ud.id ? ud.id : null;
}

function updateHover(clientX: number, clientY: number): void {
  const next = pickPanel3D(clientX, clientY);
  if (next !== hoveredPanel) {
    hoveredPanel = next;
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
  const pv = rig.panels[pid];
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
    hoveredPanel = pHit;
    drag = {
      kind: 'fold',
      panel: pHit,
      startX: e.clientX,
      startY: e.clientY,
      startFold: panelState[pHit].fold,
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
      targetDist = Math.max(14, Math.min(68, targetDist * (lastPinchDist / Math.max(dist, 1))));
    }
    lastPinchDist = dist;
    return;
  }

  if (drag.kind === 'orbit') {
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    targetYaw -= dx * 0.0072;
    targetPitch = Math.max(0.16, Math.min(1.42, targetPitch + dy * 0.0068));
    return;
  }

  if (drag.kind === 'fold') {
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    if (drag.moved) {
      const delta = panelFoldDragSensitivity(drag.panel, dx, dy);
      const next = clamp01(drag.startFold + delta);
      const ps = panelState[drag.panel];
      ps.fold = next;
      ps.target = next;
      ps.vel = 0;
      syncUI();
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
    const ps = panelState[drag.panel];
    if (!drag.moved) {
      ps.target = ps.target > 0.5 ? 0 : 1;
    } else {
      ps.target = ps.fold >= 0.45 ? 1 : 0;
    }
    syncUI();
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
    targetDist = Math.max(14, Math.min(68, targetDist * Math.exp(e.deltaY * 0.0011)));
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
  resetFlat();
});

progressRange.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  isScrubbing = true;
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
    resetFlat();
  }
});

// Resize
function resize(): void {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Apply optional ?fold=0..1 preset
if (params.has('fold')) {
  applyFoldScrub(Number(params.get('fold')) || 0, true);
}
syncUI();

// Debug hook
(
  window as unknown as {
    __origami?: {
      progress: (v: number) => void;
      fold: (pid: FoldablePanelId, v: number) => void;
      view: (yaw: number, pitch: number, dist: number) => void;
    };
  }
).__origami = {
  progress(v: number) {
    applyFoldScrub(v, true);
    syncUI();
  },
  fold(pid: FoldablePanelId, v: number) {
    panelState[pid].fold = v;
    panelState[pid].target = v;
    panelState[pid].vel = 0;
    syncUI();
  },
  view(yaw: number, pitch: number, dist: number) {
    targetYaw = curYaw = yaw;
    targetPitch = curPitch = pitch;
    targetDist = curDist = dist;
  },
};

// Main animation loop (crisp paper-crease spring physics & serene studio framing)
let lastTime = performance.now();

function animate(now: number): void {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) * 0.001);
  lastTime = now;

  let foldChanged = false;
  for (const pid of FOLDABLE_ORDER) {
    const ps = panelState[pid];

    if (drag.kind !== 'fold' || drag.panel !== pid) {
      const diff = ps.target - ps.fold;
      if (Math.abs(diff) > 0.0005 || Math.abs(ps.vel) > 0.001) {
        const stiffness = 135;
        const damping = 18.5;
        ps.vel += (diff * stiffness - ps.vel * damping) * dt;
        ps.fold += ps.vel * dt;
        if (ps.fold >= 1 && ps.target >= 0.99) {
          ps.fold = 1;
          ps.vel = -Math.abs(ps.vel) * 0.16;
          if (Math.abs(ps.vel) < 0.04) ps.vel = 0;
        } else if (ps.fold <= 0 && ps.target <= 0.01) {
          ps.fold = 0;
          ps.vel = Math.abs(ps.vel) * 0.14;
          if (Math.abs(ps.vel) < 0.04) ps.vel = 0;
        }
        foldChanged = true;
      }
    }

    const wantPeek = hoveredPanel === pid && drag.kind === 'none' ? 1 : 0;
    ps.peek += (wantPeek - ps.peek) * (1 - Math.exp(-dt * 14));
    const peekRad = ps.peek * (ps.fold > 0.5 ? -0.055 : 0.085);

    rig.updatePanelVisual(pid, ps.fold, peekRad, hoveredPanel === pid);
  }

  if (foldChanged && !isScrubbing) {
    progressRange.value = computeFoldProgress().toFixed(3);
  }

  const liveWallAvg =
    (panelState.front.fold + panelState.back.fold + panelState.left.fold + panelState.right.fold) * 0.25;
  targetLookY = 0.25 + liveWallAvg * 1.45;

  const camAlpha = 1 - Math.exp(-dt * 7.5);
  curYaw += (targetYaw - curYaw) * camAlpha;
  curPitch += (targetPitch - curPitch) * camAlpha;
  curDist += (targetDist - curDist) * camAlpha;
  curLookY += (targetLookY - curLookY) * camAlpha;

  camera.position.set(
    curDist * Math.cos(curPitch) * Math.sin(curYaw),
    curLookY + curDist * Math.sin(curPitch),
    curDist * Math.cos(curPitch) * Math.cos(curYaw),
  );
  camera.lookAt(0, curLookY, 0);

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
