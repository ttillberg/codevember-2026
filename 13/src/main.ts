import * as THREE from 'three';
import { buildLabyrinthRig } from './labyrinthMesh';
import { R_BALL_CENTER, R_FLOOR, R_SHELL, computeEffectiveShutters, computeEffectiveWalls, createSphereGrid } from './maze';
import { SphereBallPhysics } from './physics';
import { StudioPost } from './post';
import { LabyrinthSound } from './sound';
import { createAimReticle, setupStudio } from './studio';
import { TelemetryOverlay } from './telemetryHud';

const params = new URLSearchParams(location.search);
if (params.has('clean')) document.body.classList.add('clean');

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false, // 4x MSAA handled inside StudioPost HDR target
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 60);
let camDist = 4.55;
let targetCamDist = 4.55;
const DEFAULT_CAM_YAW = 0;
const DEFAULT_CAM_PITCH = 0.053;
let camYaw = DEFAULT_CAM_YAW;
let camPitch = DEFAULT_CAM_PITCH;
let targetCamYaw = DEFAULT_CAM_YAW;
let targetCamPitch = DEFAULT_CAM_PITCH;
camera.position.set(0, 0.24, camDist);
camera.lookAt(0, -0.02, 0);

const studio = setupStudio(renderer, scene);
const post = new StudioPost(renderer, scene, camera);
const sound = new LabyrinthSound();
const telemetry = new TelemetryOverlay(document.getElementById('telemetry-canvas') as HTMLCanvasElement);

const floatGroup = new THREE.Group();
scene.add(floatGroup);

// Build single persistent two-layer 82-cell adaptive sphere grid + 10 solver-verified puzzle levels
const grid = createSphereGrid();
const rig = buildLabyrinthRig(grid);
floatGroup.add(rig.root);

// Curved 3D optical aiming target hugging the outer polycarbonate shell at the gravity center
const aimReticle = createAimReticle(R_SHELL + 0.0055);
floatGroup.add(aimReticle.group);

const initialLevelNum = Math.max(1, Math.min(grid.levels.length, Number(params.get('level')) || 1));
let currentLevelIdx = initialLevelNum - 1;
const completedLevels = new Set<number>();
let levelElapsedSec = 0;
let levelTimerStarted = false;

interface LevelTransition {
  kind: 'complete' | 'switch' | 'reset';
  phase: 'drop' | 'morph' | 'rise';
  t: number;
  targetLevelIdx: number;
  dropStartDir: THREE.Vector3;
  dropTargetDir: THREE.Vector3;
  dropStartRadius: number;
  dropDuration: number;
  dropSoundPlayed: boolean;
  morphDuration: number;
  startQuat: THREE.Quaternion;
  startCamYaw: number;
  startCamPitch: number;
  orbitSweepYaw: number;
  riseDuration: number;
}

const NORTH_POLE_DIR = new THREE.Vector3(0, 1, 0);
const SOUTH_POLE_DIR = new THREE.Vector3(0, -1, 0);
const BALL_WELL_DEPTH = R_FLOOR - 0.115;
let transition: LevelTransition | null = null;

// Per-wall live extension state [0..1]
const wallCount = grid.walls.length;
const wallExt = new Float32Array(wallCount);
const wallStartExt = new Float32Array(wallCount);
const wallTargetExt = new Float32Array(wallCount);
const wallDelay = new Float32Array(wallCount);

// Per-shutter diaphragm iris opening state [0..1]
const shutterCount = grid.shutters.length;
const shutterOpen = new Float32Array(shutterCount);
const shutterStartOpen = new Float32Array(shutterCount);
const shutterTargetOpen = new Float32Array(shutterCount);
const shutterDelay = new Float32Array(shutterCount);
const shutterSnap = new Float32Array(shutterCount);
const effectiveShutterOpen = new Float32Array(shutterCount);

// Polar diaphragm iris opening state [0..1] (0 = closed, 1 = open)
let northIrisOpen = 0;
let southIrisOpen = 0;

// Toggle press visual depression bounce [0..1]
const togglePulse = new Float32Array(4);

let morphElapsed = 10;
let activeBladeDuration = 0.54;
let activeWaveSpread = 0.4;

const physics = new SphereBallPhysics(grid, grid.levels[currentLevelIdx]);

// Hero top-down North Pole pose: chrome ball rests dead-center inside the aiming reticle on 00 START with NORTH POLE tape upright below
const initialQuat = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2 - DEFAULT_CAM_PITCH)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.34))
  .normalize();
const sphereQuat = initialQuat.clone();
const angVel = new THREE.Vector3(0, 0, 0);

// UI references
const levelHudEl = document.getElementById('level-hud')!;
const levelNumBtn = document.getElementById('level-num') as HTMLButtonElement;
const levelTitleEl = document.getElementById('level-title')!;
const levelPicker = document.getElementById('level-picker')!;
const btnReset = document.getElementById('btn-reset')!;
const btnSound = document.getElementById('btn-sound')!;
const btnHelp = document.getElementById('btn-help')!;
const tapCueBtn = document.getElementById('tap-cue') as HTMLButtonElement;
const helpCard = document.getElementById('help-card')!;
const btnSettings = document.getElementById('btn-settings')!;
const settingsPanel = document.getElementById('settings-panel')!;
const levelButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.lvl-btn'));
const isDevControls = import.meta.env.DEV || params.has('settings');

function updateStatusUI() {
  const level = grid.levels[currentLevelIdx];

  // Bottom-left level caption
  levelNumBtn.textContent = `LEVEL ${level.level}`;
  levelTitleEl.textContent = physics.allCleared ? `${level.name} · CLEAR` : level.name;

  for (const btn of levelButtons) {
    const n = Number(btn.dataset.level);
    btn.classList.toggle('active', n === level.level);
    btn.classList.toggle('done', completedLevels.has(n));
  }
}

function syncAoExclusions() {
  post.setAoExcluded([...rig.aoExcluded, aimReticle.group, studio.backdropMesh, studio.shadowPlane]);
}

function startMorphToState(
  targetWalls: boolean[],
  targetShutters: boolean[],
  originDir: THREE.Vector3,
  instant: boolean,
  duration = 0.54,
  spread = 0.4,
) {
  activeBladeDuration = duration;
  activeWaveSpread = spread;

  for (let i = 0; i < wallCount; i++) {
    const slot = grid.walls[i];
    const target = slot.locked || targetWalls[i] ? 1.0 : 0.0;
    wallStartExt[i] = instant ? target : wallExt[i];
    wallTargetExt[i] = target;
    if (instant) {
      wallExt[i] = target;
      wallDelay[i] = 0;
    } else {
      const wave01 = 0.5 - 0.5 * slot.midDir.dot(originDir);
      const retractLead = target < wallStartExt[i] ? 0.0 : 0.08;
      wallDelay[i] = wave01 * spread + retractLead;
    }
  }

  for (let i = 0; i < shutterCount; i++) {
    const port = grid.shutters[i];
    const target = targetShutters[i] ? 1.0 : 0.0;
    shutterStartOpen[i] = instant ? target : shutterOpen[i];
    shutterTargetOpen[i] = target;
    if (instant) {
      shutterOpen[i] = target;
      shutterDelay[i] = 0;
    } else {
      const wave01 = 0.5 - 0.5 * port.dir.dot(originDir);
      shutterDelay[i] = wave01 * spread * 0.7 + 0.04;
    }
  }

  morphElapsed = instant ? 10 : 0;

  if (instant) {
    rig.applyWallExtensions(wallExt);
    rig.applyShutterOpenings(shutterOpen);
  }
}

function loadLevelNow(
  index: number,
  instant: boolean,
  resetCameraAndQuat: boolean,
  morphDuration = 0.92,
  morphSpread = 0.68,
) {
  const clamped = Math.max(0, Math.min(grid.levels.length - 1, index));
  currentLevelIdx = clamped;
  const level = grid.levels[currentLevelIdx];

  const waveDir = new THREE.Vector3(-0.6, 0.72, 0.35).normalize().applyQuaternion(sphereQuat.clone().invert());

  physics.setLevel(level, true);
  levelElapsedSec = 0;
  levelTimerStarted = false;
  const effWalls = computeEffectiveWalls(level, physics.toggleMask, wallCount);
  const effShutters = computeEffectiveShutters(level, physics.toggleMask, shutterCount);

  startMorphToState(effWalls, effShutters, waveDir, instant, morphDuration, morphSpread);
  if (!instant) {
    sound.playMorph();
  }

  if (resetCameraAndQuat) {
    sphereQuat.copy(initialQuat);
    angVel.set(0, 0, 0);
    targetCamYaw = DEFAULT_CAM_YAW;
    targetCamPitch = DEFAULT_CAM_PITCH;
    if (instant) {
      camYaw = DEFAULT_CAM_YAW;
      camPitch = DEFAULT_CAM_PITCH;
    }
  }

  rig.setLevelVisuals(level);
  rig.applyShutterOpenings(shutterOpen);
  if (instant) {
    northIrisOpen = 0;
    southIrisOpen = 0;
    shutterSnap.fill(0);
    rig.applyPoleShutters(0, 0);
  }
  syncAoExclusions();
  updateStatusUI();
}

function startLevelTransition(kind: 'complete' | 'switch' | 'reset', targetIndex: number) {
  const clamped = Math.max(0, Math.min(grid.levels.length - 1, targetIndex));
  const alreadyTucked = transition !== null && transition.phase === 'morph';

  const curBallDir = physics.dir.clone().normalize();
  let dropTargetDir = curBallDir.clone();
  if (kind === 'complete') {
    dropTargetDir = SOUTH_POLE_DIR.clone();
  } else if (curBallDir.y > 0.85) {
    dropTargetDir = NORTH_POLE_DIR.clone();
  } else if (curBallDir.y < -0.85) {
    dropTargetDir = SOUTH_POLE_DIR.clone();
  }

  // Normalize startCamYaw into [-PI, PI] so circulation always sweeps cleanly forward
  const normYaw = Math.atan2(Math.sin(camYaw), Math.cos(camYaw));
  camYaw = normYaw;
  targetCamYaw = normYaw;
  angVel.set(0, 0, 0);

  const isComplete = kind === 'complete';
  const isReset = kind === 'reset';

  transition = {
    kind,
    phase: alreadyTucked ? 'morph' : 'drop',
    t: 0,
    targetLevelIdx: clamped,
    dropStartDir: curBallDir,
    dropTargetDir,
    dropStartRadius: physics.radius,
    dropDuration: isComplete ? 0.84 : 0.34,
    dropSoundPlayed: false,
    morphDuration: isComplete ? 1.95 : isReset ? 1.15 : 1.65,
    startQuat: sphereQuat.clone(),
    startCamYaw: normYaw,
    startCamPitch: camPitch,
    orbitSweepYaw: isComplete ? Math.PI * 2 : isReset ? 0 : Math.PI * 2,
    riseDuration: isComplete ? 0.56 : 0.48,
  };

  if (alreadyTucked) {
    rig.ballMesh.visible = false;
    loadLevelNow(clamped, false, false, isComplete ? 1.05 : 0.9, isComplete ? 0.78 : 0.66);
  }
}

function applyLevel(index: number, instant: boolean, _resetBall = true) {
  if (instant) {
    transition = null;
    rig.ballMesh.visible = true;
    loadLevelNow(index, true, true);
  } else {
    startLevelTransition('switch', index);
  }
}

function triggerToggleMorph(toggleId: number) {
  const level = grid.levels[currentLevelIdx];
  const tg = level.toggles[toggleId];
  const origin = tg ? tg.dir : new THREE.Vector3(0, 1, 0);
  const effWalls = computeEffectiveWalls(level, physics.toggleMask, wallCount);
  const effShutters = computeEffectiveShutters(level, physics.toggleMask, shutterCount);
  // Snappy, responsive ripple radiating outward from the pressed floor switch!
  startMorphToState(effWalls, effShutters, origin, false, 0.42, 0.24);
  togglePulse[toggleId] = 1.0;
}

applyLevel(currentLevelIdx, true, true);
rig.root.quaternion.copy(sphereQuat);
rig.ballMesh.position.copy(physics.dir).multiplyScalar(physics.radius);

function easeOutBack(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  const c1 = 1.55;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeMechanical(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// --- Direct, zero-twist camera-plane pointer rotation + Cmd+drag / 2-finger touch camera & center orbit ---
const activePointers = new Map<number, { x: number; y: number }>();
let primaryPointerId: number | null = null;
let dragMode: 'sphere' | 'camera' = 'sphere';
let twoFingerActive = false;
let suppressSingleUntilAllUp = false;
let prevTwoMidX = 0;
let prevTwoMidY = 0;
let prevTwoDist = 0;
let cmdHeld = false;
let lastPointerX = 0;
let lastPointerY = 0;
let tapStartX = 0;
let tapStartY = 0;
let tapStartTime = 0;
let tapMoved = false;
const camUp = new THREE.Vector3();
const camRight = new THREE.Vector3();
const dragQuatX = new THREE.Quaternion();
const dragQuatY = new THREE.Quaternion();
const dragVelVec = new THREE.Vector3();

let lastMoveTime = performance.now();

function getTwoPointerMetrics() {
  const pts = Array.from(activePointers.values());
  const a = pts[0];
  const b = pts[1];
  return {
    midX: (a.x + b.x) * 0.5,
    midY: (a.y + b.y) * 0.5,
    dist: Math.hypot(b.x - a.x, b.y - a.y),
  };
}

canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // Some touch browsers reject pointer capture on rapid multi-touch transitions
  }

  if (activePointers.size === 1) {
    primaryPointerId = e.pointerId;
    dragMode = e.metaKey || e.ctrlKey ? 'camera' : 'sphere';
    twoFingerActive = false;
    suppressSingleUntilAllUp = false;
    canvas.classList.add(dragMode === 'camera' ? 'aiming' : 'dragging');
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    tapStartX = e.clientX;
    tapStartY = e.clientY;
    tapStartTime = performance.now();
    tapMoved = false;
    if (dragMode === 'sphere') angVel.set(0, 0, 0);
    lastMoveTime = performance.now();
  } else if (activePointers.size === 2) {
    // Two fingers on touch: orbit the camera & gravity center (and pinch to zoom)
    twoFingerActive = true;
    suppressSingleUntilAllUp = true;
    tapMoved = true;
    dragMode = 'camera';
    angVel.set(0, 0, 0);
    canvas.classList.remove('dragging');
    canvas.classList.add('aiming');
    const m = getTwoPointerMetrics();
    prevTwoMidX = m.midX;
    prevTwoMidY = m.midY;
    prevTwoDist = m.dist;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (transition !== null) return;

  if (activePointers.size >= 2 && twoFingerActive) {
    const m = getTwoPointerMetrics();
    const dx = m.midX - prevTwoMidX;
    const dy = m.midY - prevTwoMidY;
    prevTwoMidX = m.midX;
    prevTwoMidY = m.midY;

    targetCamYaw -= dx * 0.0075;
    targetCamPitch = THREE.MathUtils.clamp(targetCamPitch + dy * 0.0075, -1.24, 1.24);

    if (prevTwoDist > 12 && m.dist > 12) {
      targetCamDist = THREE.MathUtils.clamp(targetCamDist * (prevTwoDist / m.dist), 2.45, 5.6);
    }
    prevTwoDist = m.dist;
    return;
  }

  if (suppressSingleUntilAllUp || e.pointerId !== primaryPointerId) return;

  const dx = e.clientX - lastPointerX;
  const dy = e.clientY - lastPointerY;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;

  if (!tapMoved && Math.hypot(e.clientX - tapStartX, e.clientY - tapStartY) > 10) {
    tapMoved = true;
  }

  if (dragMode === 'camera') {
    // Cmd + drag orbits the camera around the sphere — moving the viewing angle & gravity pull center!
    targetCamYaw -= dx * 0.0068;
    targetCamPitch = THREE.MathUtils.clamp(targetCamPitch + dy * 0.0068, -1.24, 1.24);
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const radiusPx = Math.max(120, Math.min(rect.width, rect.height) * 0.36);
  const angleY = dx / radiusPx;
  const angleX = dy / radiusPx;

  if (Math.abs(angleX) > 1e-5 || Math.abs(angleY) > 1e-5) {
    camUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    camRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();

    dragQuatY.setFromAxisAngle(camUp, angleY);
    dragQuatX.setFromAxisAngle(camRight, angleX);
    sphereQuat.premultiply(dragQuatY).premultiply(dragQuatX).normalize();

    const now = performance.now();
    const dt = Math.max(0.008, (now - lastMoveTime) * 0.001);
    lastMoveTime = now;
    dragVelVec
      .copy(camUp)
      .multiplyScalar(angleY / dt)
      .addScaledVector(camRight, angleX / dt);
    const mag = dragVelVec.length();
    if (mag > 6.5) dragVelVec.multiplyScalar(6.5 / mag);
    angVel.lerp(dragVelVec, 0.45);
  }
});

function endDrag(e: PointerEvent) {
  if (!activePointers.has(e.pointerId)) return;
  const wasPrimaryTap =
    e.type === 'pointerup' &&
    e.pointerId === primaryPointerId &&
    activePointers.size === 1 &&
    !twoFingerActive &&
    !suppressSingleUntilAllUp &&
    dragMode === 'sphere' &&
    !tapMoved &&
    performance.now() - tapStartTime < 340;

  activePointers.delete(e.pointerId);
  if (canvas.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }

  if (activePointers.size < 2) {
    twoFingerActive = false;
  }

  if (activePointers.size === 0) {
    primaryPointerId = null;
    dragMode = 'sphere';
    suppressSingleUntilAllUp = false;
    canvas.classList.remove('dragging');
    canvas.classList.toggle('aiming', cmdHeld);
  } else if (activePointers.size === 1) {
    const [remId, remPos] = activePointers.entries().next().value!;
    primaryPointerId = remId;
    lastPointerX = remPos.x;
    lastPointerY = remPos.y;
  }

  if (wasPrimaryTap) {
    tryActivatePortal();
  }
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    targetCamDist = Math.max(2.45, Math.min(5.6, targetCamDist + e.deltaY * 0.0024));
  },
  { passive: false },
);

const keysDown = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (e.key === 'Meta' || e.key === 'Control') {
    cmdHeld = true;
    if (activePointers.size === 0) canvas.classList.add('aiming');
  }
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'q', 'e'].includes(k)) {
    sound.unlock();
    keysDown.add(k);
  } else if (k >= '1' && k <= '9') {
    sound.unlock();
    applyLevel(Number(k) - 1, false, true);
  } else if (k === '0') {
    sound.unlock();
    applyLevel(9, false, true);
  } else if (k === '[') {
    sound.unlock();
    applyLevel(Math.max(0, currentLevelIdx - 1), false, true);
  } else if (k === ']') {
    sound.unlock();
    applyLevel(Math.min(grid.levels.length - 1, currentLevelIdx + 1), false, true);
  } else if (k === ' ' || k === 'enter') {
    if (transition === null && physics.readyPortal.kind !== 'none') {
      e.preventDefault();
      sound.unlock();
      tryActivatePortal();
    }
  } else if (k === 'r') {
    resetCurrentLevel();
  } else if (k === 'm') {
    toggleSound();
  } else if (k === 't') {
    const next = !telemetry.isEnabled();
    telemetry.setEnabled(next);
    const cb = document.getElementById('opt-telemetry') as HTMLInputElement | null;
    if (cb) cb.checked = next;
  } else if (k === '?' || k === 'h') {
    toggleHelp();
  } else if (k === 'escape') {
    if (!helpCard.hidden) toggleHelp(false);
    if (!levelPicker.hidden) toggleLevelPicker(false);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Meta' || e.key === 'Control') {
    cmdHeld = false;
    if (activePointers.size === 0) canvas.classList.remove('aiming');
  }
  keysDown.delete(e.key.toLowerCase());
});
window.addEventListener('blur', () => {
  cmdHeld = false;
  keysDown.clear();
  canvas.classList.remove('aiming');
  sound.setBackgrounded(true);
});
window.addEventListener('focus', () => {
  if (!document.hidden) sound.setBackgrounded(false);
});
document.addEventListener('visibilitychange', () => {
  sound.setBackgrounded(document.hidden);
});

function resetCurrentLevel() {
  sound.unlock();
  startLevelTransition('reset', currentLevelIdx);
}

function toggleSound() {
  const next = !sound.isEnabled();
  sound.setEnabled(next);
  btnSound.setAttribute('aria-pressed', String(next));
  if (next) sound.unlock();
}

function toggleHelp(force?: boolean) {
  const open = force !== undefined ? force : helpCard.hidden;
  helpCard.hidden = !open;
  btnHelp.setAttribute('aria-expanded', String(open));
  if (open) settingsPanel.hidden = true;
}

const physicsEvents = {
  onWallHit: (strength: number) => sound.playWallHit(strength),
  onDropIntoPipe: (shutterId: number) => {
    shutterSnap[shutterId] = 1.0;
    sound.playPortalDrop();
    updateStatusUI();
  },
  onEmergeFromPipe: (shutterId: number) => {
    shutterSnap[shutterId] = 1.0;
    sound.playPortalEmerge();
    updateStatusUI();
  },
  onToggle: (toggleId: number, active: boolean) => {
    sound.playToggle(active);
    triggerToggleMorph(toggleId);
    updateStatusUI();
  },
  onCheckpoint: (idx: number, allCleared: boolean) => {
    sound.playCheckpoint(idx, allCleared);
    if (allCleared) {
      completedLevels.add(currentLevelIdx + 1);
      const nextIdx = currentLevelIdx < grid.levels.length - 1 ? currentLevelIdx + 1 : currentLevelIdx;
      startLevelTransition('complete', nextIdx);
    }
    updateStatusUI();
  },
};

function tryActivatePortal(): boolean {
  if (transition !== null) return false;
  return physics.activateReadyPortal(shutterOpen, physicsEvents);
}

let lastLevelHudPos = '';
function syncLevelHudPosition() {
  const { cx, cy, radius } = telemetry.sphereScreen;
  if (radius < 40) return;
  const w = lastCanvasW || window.innerWidth;
  const h = lastCanvasH || window.innerHeight;
  const isCompact = w < 640;
  const idealOffset = isCompact ? 16 : Math.max(20, Math.min(32, radius * 0.068));
  const arcR = Math.min(radius + idealOffset, Math.max(90, w - cx - (isCompact ? 18 : 26)));

  const leftAnchorAng = (138 * Math.PI) / 180;
  const anchorX = cx + Math.cos(leftAnchorAng) * arcR;
  const anchorY = cy + Math.sin(leftAnchorAng) * arcR;

  let mode: 'beside' | 'below';
  let x: number;
  let y: number;

  if (!isCompact && anchorX > 185) {
    // Hug the lower-left orbital contour of the globe, right-aligned cleanly toward the sphere!
    mode = 'beside';
    x = Math.round(anchorX - 16);
    y = Math.round(Math.max(96, Math.min(h - 46, anchorY)));
  } else {
    // Portrait / tight viewport: hug directly beneath the lower-left curve of the globe
    mode = 'below';
    x = Math.round(Math.max(18, cx - radius * 0.88));
    y = Math.round(Math.max(96, Math.min(h - 68, cy + radius + 16)));
  }

  const key = `${mode}:${x}:${y}`;
  if (key === lastLevelHudPos) return;
  lastLevelHudPos = key;

  levelHudEl.classList.toggle('beside-globe', mode === 'beside');
  levelHudEl.style.left = `${x}px`;
  levelHudEl.style.top = `${y}px`;
}

let lastTapCueText = '';
let lastTapCueDwell = -1;
function syncTapCue() {
  if (transition !== null || physics.readyPortal.kind === 'none') {
    if (!tapCueBtn.hidden) tapCueBtn.hidden = true;
    if (lastTapCueDwell !== 0) {
      tapCueBtn.style.setProperty('--dwell', '0');
      lastTapCueDwell = 0;
    }
    return;
  }
  const label =
    physics.readyPortal.kind === 'shutter-enter'
      ? 'TAP TO ENTER'
      : physics.readyPortal.kind === 'shutter-exit'
        ? 'TAP TO EXIT'
        : physics.readyPortal.kind === 'toggle'
          ? 'TAP TO SWITCH'
          : 'TAP TO FINISH';
  if (label !== lastTapCueText) {
    tapCueBtn.textContent = label;
    lastTapCueText = label;
  }
  const dwell = Math.round(physics.readyPortalDwell * 200) / 200;
  if (dwell !== lastTapCueDwell) {
    tapCueBtn.style.setProperty('--dwell', String(dwell));
    lastTapCueDwell = dwell;
  }
  if (tapCueBtn.hidden) tapCueBtn.hidden = false;
}

btnReset.addEventListener('click', resetCurrentLevel);
btnSound.addEventListener('click', toggleSound);
btnHelp.addEventListener('click', () => toggleHelp());
tapCueBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sound.unlock();
  tryActivatePortal();
});

function toggleLevelPicker(force?: boolean) {
  if (!isDevControls) return;
  const open = force !== undefined ? force : levelPicker.hidden;
  levelPicker.hidden = !open;
  levelNumBtn.setAttribute('aria-expanded', String(open));
}

if (isDevControls) {
  levelNumBtn.disabled = false;
  levelNumBtn.classList.add('dev-select');
  levelNumBtn.title = 'Select level (dev)';
  levelNumBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    sound.unlock();
    toggleLevelPicker();
  });

  for (const btn of levelButtons) {
    btn.addEventListener('click', () => {
      sound.unlock();
      const lvl = Number(btn.dataset.level);
      applyLevel(lvl - 1, false, true);
      toggleLevelPicker(false);
    });
  }

  window.addEventListener('pointerdown', (e) => {
    if (!levelPicker.hidden && !levelPicker.contains(e.target as Node) && e.target !== levelNumBtn) {
      toggleLevelPicker(false);
    }
  });

  btnSettings.hidden = false;
  btnSettings.addEventListener('click', () => {
    const open = settingsPanel.hidden;
    settingsPanel.hidden = !open;
    if (open) toggleHelp(false);
  });

  const optSsao = document.getElementById('opt-ssao') as HTMLInputElement;
  const optGrade = document.getElementById('opt-grade') as HTMLInputElement;
  const optPlastic = document.getElementById('opt-plastic') as HTMLInputElement;
  const optScratches = document.getElementById('opt-scratches') as HTMLInputElement;
  const optTelemetry = document.getElementById('opt-telemetry') as HTMLInputElement;

  optSsao.addEventListener('input', () => {
    post.aoPass.blendIntensity = Number(optSsao.value);
  });
  optGrade.addEventListener('input', () => {
    post.gradePass.material.uniforms.uGradeStrength.value = Number(optGrade.value);
  });
  optPlastic.addEventListener('input', () => {
    rig.setPlasticOpacity(Number(optPlastic.value));
  });
  optScratches.addEventListener('input', () => {
    rig.setScratchStrength(Number(optScratches.value));
  });
  optTelemetry.addEventListener('change', () => {
    telemetry.setEnabled(optTelemetry.checked);
  });
}

let lastCanvasW = 0;
let lastCanvasH = 0;
let portraitDistScale = 1;

function resize() {
  const w = Math.max(1, Math.round(canvas.clientWidth || window.innerWidth));
  const h = Math.max(1, Math.round(canvas.clientHeight || window.innerHeight));
  lastCanvasW = w;
  lastCanvasH = h;
  renderer.setSize(w, h, false);
  post.setSize(w, h);
  telemetry.resize(w, h);
  const aspect = w / h;
  camera.aspect = aspect;
  camera.fov = 32;
  // Keep a true undistorted 32° studio lens on narrow mobile portraits by scaling distance instead of widening FOV
  portraitDistScale = aspect < 1 ? Math.max(1, 0.94 / Math.max(0.42, aspect)) : 1;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
new ResizeObserver(resize).observe(canvas);
resize();

// Debug handle for verification & demo inspection
(window as unknown as Record<string, unknown>).__labyrinth = {
  setLevel: (n: number, instant = false) => applyLevel(n - 1, instant, true),
  flipToggle: (id = 0) => {
    physics.toggleMask ^= 1 << id;
    triggerToggleMorph(id);
    updateStatusUI();
  },
  enterPipe: (shutterId = 0) => {
    physics.enterPipeAtShutter(shutterId);
    updateStatusUI();
  },
  tapPortal: () => tryActivatePortal(),
  seatOnShutter: (shutterId = 0) => {
    const sh = grid.shutters[shutterId];
    if (!sh) return;
    physics.layer = 'upper';
    physics.dir.copy(sh.dir);
    physics.vel.set(0, 0, 0);
    physics.radius = R_BALL_CENTER;
    sphereQuat.setFromUnitVectors(sh.dir, WORLD_GRAVITY_DIR);
    angVel.set(0, 0, 0);
  },
  setFinishReady: () => {
    const total = grid.levels[currentLevelIdx].checkpoints.length;
    for (let i = 0; i < total - 1; i++) physics.cleared[i] = true;
    physics.allCleared = false;
    updateStatusUI();
  },
  seatOnSouthPole: () => {
    physics.layer = 'upper';
    physics.dir.copy(SOUTH_POLE_DIR);
    physics.vel.set(0, 0, 0);
    physics.radius = R_BALL_CENTER;
    sphereQuat.setFromUnitVectors(SOUTH_POLE_DIR, WORLD_GRAVITY_DIR);
    angVel.set(0, 0, 0);
  },
  seatOnToggle: (toggleId = 0) => {
    const tg = grid.levels[currentLevelIdx].toggles[toggleId];
    if (!tg) return;
    physics.layer = 'upper';
    physics.dir.copy(tg.dir);
    physics.vel.set(0, 0, 0);
    physics.radius = R_BALL_CENTER;
    sphereQuat.setFromUnitVectors(tg.dir, WORLD_GRAVITY_DIR);
    angVel.set(0, 0, 0);
  },
  setRotation: (rx: number, ry: number, rz = 0) => {
    sphereQuat.setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
    angVel.set(0, 0, 0);
  },
  setZoom: (d: number) => {
    targetCamDist = d;
    camDist = d;
  },
  setCamera: (yaw: number, pitch: number, instant = true) => {
    targetCamYaw = yaw;
    targetCamPitch = THREE.MathUtils.clamp(pitch, -1.24, 1.24);
    if (instant) {
      camYaw = targetCamYaw;
      camPitch = targetCamPitch;
    }
  },
  triggerComplete: () => {
    completedLevels.add(currentLevelIdx + 1);
    const nextIdx = currentLevelIdx < grid.levels.length - 1 ? currentLevelIdx + 1 : currentLevelIdx;
    startLevelTransition('complete', nextIdx);
  },
  getState: () => ({
    level: currentLevelIdx + 1,
    name: grid.levels[currentLevelIdx].name,
    layer: physics.layer,
    radius: physics.radius,
    readyPortal: physics.readyPortal,
    readyPortalDwell: physics.readyPortalDwell,
    northIrisOpen,
    southIrisOpen,
    toggleMask: physics.toggleMask,
    cleared: physics.getClearedCount(),
    total: grid.levels[currentLevelIdx].checkpoints.length,
    nextCp: grid.levels[currentLevelIdx].checkpoints[physics.getNextCheckpointIndex()]?.label ?? 'DONE',
    stats: grid.levels[currentLevelIdx].stats,
  }),
};

// Main loop
let lastFrame = performance.now();
const stepAxis = new THREE.Vector3();
const stepQuat = new THREE.Quaternion();
const keyTilt = new THREE.Vector3();
const WORLD_GRAVITY_DIR = new THREE.Vector3(
  Math.cos(DEFAULT_CAM_PITCH) * Math.sin(DEFAULT_CAM_YAW),
  Math.sin(DEFAULT_CAM_PITCH),
  Math.cos(DEFAULT_CAM_PITCH) * Math.cos(DEFAULT_CAM_YAW),
).normalize();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const gravityWorldDir = WORLD_GRAVITY_DIR.clone();
let aimActive = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) * 0.001, 0.05);
  lastFrame = now;
  const t = now * 0.001;

  // Decay toggle button tactile depress bounce
  for (let i = 0; i < togglePulse.length; i++) {
    if (togglePulse[i] > 0) togglePulse[i] = Math.max(0, togglePulse[i] - dt * 4.2);
  }

  // Animate radial wall morphing wave + diaphragm shutter iris rotation (+ crisp passage snap)
  let anyShutterSnap = false;
  for (let i = 0; i < shutterCount; i++) {
    if (shutterSnap[i] > 0) {
      shutterSnap[i] = Math.max(0, shutterSnap[i] - dt / 0.42);
      anyShutterSnap = true;
    }
  }
  const maxMorphTime = activeWaveSpread + activeBladeDuration + 0.2;
  if (morphElapsed <= maxMorphTime || anyShutterSnap) {
    if (morphElapsed <= maxMorphTime) {
      morphElapsed += dt;
      for (let i = 0; i < wallCount; i++) {
        if (grid.walls[i].locked) {
          wallExt[i] = 1.0;
          continue;
        }
        const localT = (morphElapsed - wallDelay[i]) / activeBladeDuration;
        wallExt[i] = wallStartExt[i] + (wallTargetExt[i] - wallStartExt[i]) * easeMechanical(localT);
      }
      for (let i = 0; i < shutterCount; i++) {
        const localT = (morphElapsed - shutterDelay[i]) / (activeBladeDuration * 0.95);
        shutterOpen[i] = shutterStartOpen[i] + (shutterTargetOpen[i] - shutterStartOpen[i]) * easeMechanical(localT);
      }
      rig.applyWallExtensions(wallExt);
    }
    for (let i = 0; i < shutterCount; i++) {
      const snapDip = shutterSnap[i] > 0 ? Math.sin(shutterSnap[i] * Math.PI) * 0.42 : 0;
      effectiveShutterOpen[i] = Math.max(0, shutterOpen[i] - snapDip);
    }
    rig.applyShutterOpenings(effectiveShutterOpen);
  }

  keyTilt.set(0, 0, 0);
  const kSpeed = 1.85;
  if (keysDown.has('arrowup') || keysDown.has('w')) keyTilt.x += kSpeed;
  if (keysDown.has('arrowdown') || keysDown.has('s')) keyTilt.x -= kSpeed;
  if (keysDown.has('arrowleft') || keysDown.has('a')) keyTilt.y += kSpeed;
  if (keysDown.has('arrowright') || keysDown.has('d')) keyTilt.y -= kSpeed;
  if (keysDown.has('q')) keyTilt.z += kSpeed;
  if (keysDown.has('e')) keyTilt.z -= kSpeed;
  if (keyTilt.lengthSq() > 0) {
    angVel.lerp(keyTilt, Math.min(1, dt * 8));
  }

  if (activePointers.size === 0) {
    const wMag = angVel.length();
    if (wMag > 1e-4) {
      stepAxis.copy(angVel).multiplyScalar(1 / wMag);
      stepQuat.setFromAxisAngle(stepAxis, wMag * dt);
      sphereQuat.premultiply(stepQuat).normalize();
      angVel.multiplyScalar(Math.exp(-6.5 * dt));
    }
  }

  const curW = Math.round(canvas.clientWidth);
  const curH = Math.round(canvas.clientHeight);
  if (curW > 0 && curH > 0 && (curW !== lastCanvasW || curH !== lastCanvasH)) {
    resize();
  }

  floatGroup.position.y = 0;
  studio.shadowPlane.scale.setScalar(1);

  if (transition !== null) {
    // Choreographed polar hole drop -> slow wall morph + circulating studio camera -> North Pole pop-up!
    const tr = transition;
    tr.t += dt;
    sound.updateRoll(0);

    if (tr.phase === 'drop') {
      const u = Math.min(1, tr.t / tr.dropDuration);
      const alignU = Math.min(1, u / 0.34);
      const dropU = Math.max(0, (u - 0.3) / 0.7);
      if (dropU > 0.02 && !tr.dropSoundPlayed) {
        tr.dropSoundPlayed = true;
        sound.playPortalDrop();
      }
      const dir = tr.dropStartDir.clone().lerp(tr.dropTargetDir, easeMechanical(alignU)).normalize();
      const rad = tr.dropStartRadius + (BALL_WELL_DEPTH - tr.dropStartRadius) * (dropU * dropU);
      rig.ballMesh.visible = u < 0.94;
      rig.ballMesh.position.copy(dir).multiplyScalar(rad);

      if (u >= 1) {
        rig.ballMesh.visible = false;
        tr.phase = 'morph';
        tr.t = 0;
        const wallDur = tr.kind === 'complete' ? 1.06 : tr.kind === 'reset' ? 0.72 : 0.92;
        const wallSpread = tr.kind === 'complete' ? 0.78 : tr.kind === 'reset' ? 0.4 : 0.68;
        loadLevelNow(tr.targetLevelIdx, false, false, wallDur, wallSpread);
      }
    } else if (tr.phase === 'morph') {
      const u = Math.min(1, tr.t / tr.morphDuration);
      const e = easeMechanical(u);
      sphereQuat.copy(tr.startQuat).slerp(initialQuat, e).normalize();

      if (tr.orbitSweepYaw > 0.01) {
        // Smooth full 360° studio circulation while the labyrinth morphs into its new layout
        camYaw = tr.startCamYaw + e * (DEFAULT_CAM_YAW + tr.orbitSweepYaw - tr.startCamYaw);
        camPitch = tr.startCamPitch + (DEFAULT_CAM_PITCH - tr.startCamPitch) * e + 0.24 * Math.sin(Math.PI * u);
      } else {
        // Crisp curved studio sweep on level reset
        camYaw = tr.startCamYaw + (DEFAULT_CAM_YAW - tr.startCamYaw) * e + 0.58 * Math.sin(Math.PI * u);
        camPitch = tr.startCamPitch + (DEFAULT_CAM_PITCH - tr.startCamPitch) * e + 0.16 * Math.sin(Math.PI * u);
      }
      targetCamYaw = camYaw;
      targetCamPitch = camPitch;

      if (u >= 1) {
        camYaw = targetCamYaw = DEFAULT_CAM_YAW;
        camPitch = targetCamPitch = DEFAULT_CAM_PITCH;
        sphereQuat.copy(initialQuat);
        rig.ballMesh.visible = true;
        rig.ballMesh.position.copy(NORTH_POLE_DIR).multiplyScalar(BALL_WELL_DEPTH);
        sound.playPortalEmerge();
        tr.phase = 'rise';
        tr.t = 0;
      }
    } else if (tr.phase === 'rise') {
      const u = Math.min(1, tr.t / tr.riseDuration);
      const pop = easeOutBack(u);
      const rad = BALL_WELL_DEPTH + (R_BALL_CENTER - BALL_WELL_DEPTH) * pop;
      rig.ballMesh.visible = true;
      rig.ballMesh.position.copy(NORTH_POLE_DIR).multiplyScalar(rad);

      if (u >= 1) {
        physics.dir.copy(NORTH_POLE_DIR);
        physics.radius = R_BALL_CENTER;
        physics.vel.set(0, 0, 0);
        rig.ballMesh.position.copy(NORTH_POLE_DIR).multiplyScalar(R_BALL_CENTER);
        transition = null;
      }
    }

    camDist += (targetCamDist - camDist) * Math.min(1, dt * 9);
    const effCamDist = camDist * portraitDistScale;
    const cosPitch = Math.cos(camPitch);
    camera.position.set(
      effCamDist * cosPitch * Math.sin(camYaw),
      effCamDist * Math.sin(camPitch),
      effCamDist * cosPitch * Math.cos(camYaw),
    );
    camera.lookAt(0, -0.02 * cosPitch, 0);

    const shadowVis = THREE.MathUtils.smoothstep(Math.sin(camPitch), -0.22, 0.18);
    (studio.shadowPlane.material as THREE.MeshBasicMaterial).opacity = shadowVis;

    gravityWorldDir.copy(WORLD_GRAVITY_DIR);
    aimActive += (0 - aimActive) * Math.min(1, dt * 10);
    aimReticle.setPose(WORLD_GRAVITY_DIR, WORLD_UP, aimActive);

    // Polar diaphragms during transitions: open smoothly for drop/pop-up, then close crisply once used!
    let northTarget = 0;
    let southTarget = 0;
    if (transition !== null) {
      const ctr = transition;
      if (ctr.phase === 'drop') {
        const du = Math.min(1, ctr.t / ctr.dropDuration);
        if (ctr.dropTargetDir.y > 0.5) northTarget = du < 0.78 ? 1 : 0;
        if (ctr.dropTargetDir.y < -0.5) southTarget = du < 0.78 ? 1 : 0;
      } else if (ctr.phase === 'morph') {
        const mu = Math.min(1, ctr.t / ctr.morphDuration);
        northTarget = mu > 0.84 ? 1 : 0;
      } else if (ctr.phase === 'rise') {
        const ru = Math.min(1, ctr.t / ctr.riseDuration);
        northTarget = ru < 0.72 ? 1 : 0;
      }
    }
    const irisEase = 1 - Math.exp(-11 * dt);
    northIrisOpen += (northTarget - northIrisOpen) * irisEase;
    southIrisOpen += (southTarget - southIrisOpen) * irisEase;
    rig.applyPoleShutters(northIrisOpen, southIrisOpen);
    rig.setReadyHole(-1, false);
    syncTapCue();

    rig.root.quaternion.copy(sphereQuat);
    rig.updateLeds(t, physics.cleared, physics.getNextCheckpointIndex(), physics.allCleared, physics.toggleMask, togglePulse);
    post.render(t);
    telemetry.render({
      time: t,
      elapsedSec: levelElapsedSec,
      camera,
      sphereRoot: rig.root,
      grid,
      level: grid.levels[currentLevelIdx],
      ballDir: physics.dir,
      ballRadius: physics.radius,
      ballLayer: physics.layer,
      gravityWorldDir,
      clearedMask: physics.cleared,
      nextCpIdx: physics.getNextCheckpointIndex(),
      allCleared: physics.allCleared,
      readyPortal: physics.readyPortal,
      readyDwell: physics.readyPortalDwell,
      toggleMask: physics.toggleMask,
      togglePulse,
      wallExt,
      shutterOpen,
      inTransition: true,
    });
    syncLevelHudPosition();
    return;
  }

  const camEase = 1 - Math.exp(-11 * dt);
  camDist += (targetCamDist - camDist) * Math.min(1, dt * 9);
  camYaw += (targetCamYaw - camYaw) * camEase;
  camPitch += (targetCamPitch - camPitch) * camEase;

  const effCamDist = camDist * portraitDistScale;
  const cosPitch = Math.cos(camPitch);
  camera.position.set(
    effCamDist * cosPitch * Math.sin(camYaw),
    effCamDist * Math.sin(camPitch),
    effCamDist * cosPitch * Math.cos(camYaw),
  );
  camera.lookAt(0, -0.02 * cosPitch, 0);

  // Gently fade floor contact shadow if the user Cmd+drags the camera underneath the sphere
  const shadowVis = THREE.MathUtils.smoothstep(Math.sin(camPitch), -0.22, 0.18);
  (studio.shadowPlane.material as THREE.MeshBasicMaterial).opacity = shadowVis;

  // Fixed world gravity center (Cmd+drag / 2-finger touch orbits ONLY the camera so you can inspect the sphere without moving gravity!)
  gravityWorldDir.copy(WORLD_GRAVITY_DIR);
  const targetAimActive = cmdHeld || twoFingerActive || (activePointers.size > 0 && dragMode === 'camera') ? 1 : 0;
  aimActive += (targetAimActive - aimActive) * Math.min(1, dt * 12);
  aimReticle.setPose(WORLD_GRAVITY_DIR, WORLD_UP, aimActive);

  rig.root.quaternion.copy(sphereQuat);
  physics.step(dt, sphereQuat, gravityWorldDir, wallExt, shutterOpen, physicsEvents);
  if (!physics.allCleared) {
    if (!levelTimerStarted && (activePointers.size > 0 || keysDown.size > 0 || physics.speed > 0.08)) {
      levelTimerStarted = true;
    }
    if (levelTimerStarted) {
      levelElapsedSec += dt;
    }
  }
  sound.updateRoll(physics.speed);
  sound.updateAmbience(physics.layer === 'pipe' || physics.layer === 'dropping');

  // Polar diaphragms during play: North stays closed once used; South opens smoothly once 13 END is ready to exit!
  const curLevel = grid.levels[currentLevelIdx];
  const nextIdx = physics.getNextCheckpointIndex();
  const southReady = !physics.allCleared && nextIdx >= 0 && curLevel.checkpoints[nextIdx]?.isFinish === true;
  const irisEase = 1 - Math.exp(-10 * dt);
  northIrisOpen += (0 - northIrisOpen) * irisEase;
  southIrisOpen += ((southReady ? 1 : 0) - southIrisOpen) * irisEase;
  rig.applyPoleShutters(northIrisOpen, southIrisOpen);

  const rp = physics.readyPortal;
  const readySid = rp.kind === 'shutter-enter' || rp.kind === 'shutter-exit' ? rp.shutterId : -1;
  const readyTid = rp.kind === 'toggle' ? rp.toggleId : -1;
  rig.setReadyHole(readySid, rp.kind === 'finish-drop', physics.readyPortalDwell, readyTid);
  syncTapCue();

  rig.ballMesh.position.copy(physics.dir).multiplyScalar(physics.radius);
  rig.ballMesh.quaternion.copy(physics.ballQuat);
  rig.updateLeds(t, physics.cleared, nextIdx, physics.allCleared, physics.toggleMask, togglePulse);

  post.render(t);
  telemetry.render({
    time: t,
    elapsedSec: levelElapsedSec,
    camera,
    sphereRoot: rig.root,
    grid,
    level: curLevel,
    ballDir: physics.dir,
    ballRadius: physics.radius,
    ballLayer: physics.layer,
    gravityWorldDir,
    clearedMask: physics.cleared,
    nextCpIdx: nextIdx,
    allCleared: physics.allCleared,
    readyPortal: physics.readyPortal,
    readyDwell: physics.readyPortalDwell,
    toggleMask: physics.toggleMask,
    togglePulse,
    wallExt,
    shutterOpen,
    inTransition: false,
  });
  syncLevelHudPosition();
}

requestAnimationFrame(frame);
