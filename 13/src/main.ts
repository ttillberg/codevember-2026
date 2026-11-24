import * as THREE from 'three';
import { buildLabyrinthRig } from './labyrinthMesh';
import { computeEffectiveShutters, computeEffectiveWalls, createSphereGrid } from './maze';
import { SphereBallPhysics } from './physics';
import { StudioPost } from './post';
import { LabyrinthSound } from './sound';
import { setupStudio } from './studio';

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
camera.position.set(0, 0.24, camDist);
camera.lookAt(0, -0.02, 0);

const studio = setupStudio(renderer, scene);
const post = new StudioPost(renderer, scene, camera);
const sound = new LabyrinthSound();

const floatGroup = new THREE.Group();
scene.add(floatGroup);

// Build single persistent two-layer 82-cell adaptive sphere grid + 10 solver-verified puzzle levels
const grid = createSphereGrid();
const rig = buildLabyrinthRig(grid);
floatGroup.add(rig.root);

const initialLevelNum = Math.max(1, Math.min(grid.levels.length, Number(params.get('level')) || 1));
let currentLevelIdx = initialLevelNum - 1;
const completedLevels = new Set<number>();
let autoAdvanceTimer: number | null = null;

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

// Toggle press visual depression bounce [0..1]
const togglePulse = new Float32Array(4);

let morphElapsed = 10;
let activeBladeDuration = 0.54;
let activeWaveSpread = 0.4;

const physics = new SphereBallPhysics(grid, grid.levels[currentLevelIdx]);

// Hero pose frames start chrome ball prominently near center-top with diaphragm shutters, clear windows & SWEDEN tape below
const initialQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.76, -0.34, 0.05, 'YXZ'));
const sphereQuat = initialQuat.clone();
const angVel = new THREE.Vector3(0, 0, 0);

// UI references
const ledDotsEl = document.getElementById('led-dots')!;
const statusTextEl = document.getElementById('status-text')!;
const substatusEl = document.getElementById('substatus')!;
const btnReset = document.getElementById('btn-reset')!;
const btnGyro = document.getElementById('btn-gyro') as HTMLButtonElement;
const btnSound = document.getElementById('btn-sound')!;
const btnHelp = document.getElementById('btn-help')!;
const helpCard = document.getElementById('help-card')!;
const btnSettings = document.getElementById('btn-settings')!;
const settingsPanel = document.getElementById('settings-panel')!;
const levelButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.lvl-btn'));

function updateStatusUI() {
  const level = grid.levels[currentLevelIdx];
  const total = level.checkpoints.length;
  const nextIdx = physics.getNextCheckpointIndex();

  if (ledDotsEl.childElementCount !== total) {
    ledDotsEl.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const span = document.createElement('span');
      span.className = 'dot';
      ledDotsEl.appendChild(span);
    }
  }

  for (let i = 0; i < total; i++) {
    const dot = ledDotsEl.children[i] as HTMLElement;
    dot.classList.toggle('pipe-dot', level.checkpoints[i].layer === 'pipe');
    dot.classList.toggle('cleared', physics.cleared[i]);
    dot.classList.toggle('next', !physics.cleared[i] && i === nextIdx);
  }

  const lvlTag = `LVL ${String(level.level).padStart(2, '0')} · ${level.name}`;
  if (physics.allCleared) {
    statusTextEl.textContent = `${lvlTag} · COMPLETE`;
  } else {
    const nextCp = nextIdx >= 0 ? level.checkpoints[nextIdx] : null;
    const nextLabel = nextCp ? `NEXT ${nextCp.label}${nextCp.layer === 'pipe' ? ' (PIPE)' : ''}` : '';
    const deckTag = physics.layer === 'pipe' || physics.layer === 'dropping' ? ' · IN PIPE' : '';
    statusTextEl.textContent = `${lvlTag} · ${nextLabel}${deckTag}`;
  }

  // Quiet secondary line: difficulty + live switch state chips when the level has toggles
  const parts: string[] = [level.difficulty];
  for (const tg of level.toggles) {
    const on = (physics.toggleMask & (1 << tg.id)) !== 0;
    const cls = tg.colorId === 0 ? 'coral' : 'cobalt';
    parts.push(`<span class="sw-chip ${cls}${on ? ' on' : ''}"><span>SW ${tg.label} ${on ? 'ON' : 'OFF'}</span></span>`);
  }
  substatusEl.innerHTML = parts.join(' ');

  for (const btn of levelButtons) {
    const n = Number(btn.dataset.level);
    btn.classList.toggle('active', n === level.level);
    btn.classList.toggle('done', completedLevels.has(n));
  }
}

function syncAoExclusions() {
  post.setAoExcluded([...rig.aoExcluded, studio.backdropMesh, studio.shadowPlane]);
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

function applyLevel(index: number, instant: boolean, resetBall = true) {
  if (autoAdvanceTimer !== null) {
    window.clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }

  const clamped = Math.max(0, Math.min(grid.levels.length - 1, index));
  const changed = clamped !== currentLevelIdx;
  currentLevelIdx = clamped;
  const level = grid.levels[currentLevelIdx];

  const waveDir = new THREE.Vector3(-0.6, 0.72, 0.35).normalize().applyQuaternion(sphereQuat.clone().invert());

  physics.setLevel(level, resetBall);
  const effWalls = computeEffectiveWalls(level, physics.toggleMask, wallCount);
  const effShutters = computeEffectiveShutters(level, physics.toggleMask, shutterCount);

  startMorphToState(effWalls, effShutters, waveDir, instant, 0.54, 0.4);
  if (!instant && changed) {
    sound.playMorph();
  }

  if (resetBall) {
    sphereQuat.copy(initialQuat);
    angVel.set(0, 0, 0);
  }

  rig.setLevelVisuals(level);
  rig.applyShutterOpenings(shutterOpen);
  syncAoExclusions();
  updateStatusUI();
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

function easeMechanical(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// --- Direct, zero-twist camera-plane pointer rotation ---
let activePointerId: number | null = null;
let lastPointerX = 0;
let lastPointerY = 0;
const camUp = new THREE.Vector3();
const camRight = new THREE.Vector3();
const dragQuatX = new THREE.Quaternion();
const dragQuatY = new THREE.Quaternion();
const dragVelVec = new THREE.Vector3();

let lastMoveTime = performance.now();

canvas.addEventListener('pointerdown', (e) => {
  if (activePointerId !== null) return;
  sound.unlock();
  activePointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  angVel.set(0, 0, 0);
  lastMoveTime = performance.now();
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activePointerId) return;
  const dx = e.clientX - lastPointerX;
  const dy = e.clientY - lastPointerY;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;

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
  if (e.pointerId !== activePointerId) return;
  activePointerId = null;
  canvas.classList.remove('dragging');
  if (canvas.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
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
  } else if (k === 'r') {
    resetCurrentLevel();
  } else if (k === 'm') {
    toggleSound();
  } else if (k === '?' || k === 'h') {
    toggleHelp();
  } else if (k === 'escape' && !helpCard.hidden) {
    toggleHelp(false);
  }
});
window.addEventListener('keyup', (e) => {
  keysDown.delete(e.key.toLowerCase());
});

function resetCurrentLevel() {
  sound.unlock();
  const level = grid.levels[currentLevelIdx];
  const hadToggle = physics.toggleMask !== 0;
  physics.reset();
  sphereQuat.copy(initialQuat);
  angVel.set(0, 0, 0);
  if (hadToggle) {
    const effWalls = computeEffectiveWalls(level, 0, wallCount);
    const effShutters = computeEffectiveShutters(level, 0, shutterCount);
    startMorphToState(effWalls, effShutters, new THREE.Vector3(0, 1, 0), false, 0.42, 0.25);
    sound.playMorph();
  }
  updateStatusUI();
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
}

btnReset.addEventListener('click', resetCurrentLevel);
btnSound.addEventListener('click', toggleSound);
btnHelp.addEventListener('click', () => toggleHelp());

// --- Mobile gyroscope / device orientation tilt toggle (same pattern as Day 12 Feather & Day 16 Spore) ---
const isTouchDevice =
  matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouchDevice || params.has('gyro')) {
  document.body.classList.add('touch');
}

let gyroOn = false;
let gyroRef: { x: number; y: number } | null = null;
const gyroTilt = new THREE.Vector2(0, 0); // smoothed relative screen-space tilt (-1..1)
const gyroEuler = new THREE.Euler();
const gyroQ = new THREE.Quaternion();
const gyroTurn = new THREE.Quaternion();
const gyroInvQ = new THREE.Quaternion();
const GYRO_BACK = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const GYRO_Z = new THREE.Vector3(0, 0, 1);
const gyroDownScreen = new THREE.Vector3();

function onDeviceTilt(e: DeviceOrientationEvent) {
  if (e.alpha === null || e.beta === null || e.gamma === null) return;
  const D = THREE.MathUtils.DEG2RAD;
  gyroEuler.set(e.beta * D, e.alpha * D, -e.gamma * D, 'YXZ');
  gyroQ.setFromEuler(gyroEuler).multiply(GYRO_BACK);
  const screenAngle =
    screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  gyroQ.multiply(gyroTurn.setFromAxisAngle(GYRO_Z, -screenAngle * D));

  // Project Earth's real downward gravity vector (-Y) into screen space (zero gimbal lock, zero compass drift!)
  gyroInvQ.copy(gyroQ).invert();
  gyroDownScreen.set(0, -1, 0).applyQuaternion(gyroInvQ);

  if (!gyroRef) {
    gyroRef = { x: gyroDownScreen.x, y: gyroDownScreen.y };
  }

  const rawX = gyroDownScreen.x - gyroRef.x;
  const rawY = gyroDownScreen.y - gyroRef.y;

  // Small deadzone (~3°) around the user's calibrated holding posture so holding steady stays crisp
  const deadzone = 0.05;
  const shape = (v: number) => {
    const a = Math.abs(v);
    if (a <= deadzone) return 0;
    return Math.sign(v) * Math.min(1, (a - deadzone) / 0.42);
  };

  gyroTilt.x = gyroTilt.x * 0.65 + shape(rawX) * 0.35;
  gyroTilt.y = gyroTilt.y * 0.65 + shape(rawY) * 0.35;
}

btnGyro.addEventListener('click', async () => {
  sound.unlock();
  if (gyroOn) {
    window.removeEventListener('deviceorientation', onDeviceTilt);
    gyroOn = false;
    gyroRef = null;
    gyroTilt.set(0, 0);
  } else {
    const ask = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (ask) {
      try {
        if ((await ask()) !== 'granted') return;
      } catch {
        return;
      }
    }
    gyroRef = null;
    gyroTilt.set(0, 0);
    window.addEventListener('deviceorientation', onDeviceTilt);
    gyroOn = true;
  }
  btnGyro.classList.toggle('on', gyroOn);
  btnGyro.setAttribute('aria-pressed', String(gyroOn));
});

for (const btn of levelButtons) {
  btn.addEventListener('click', () => {
    sound.unlock();
    const lvl = Number(btn.dataset.level);
    applyLevel(lvl - 1, false, true);
  });
}

if (import.meta.env.DEV || params.has('settings')) {
  btnSettings.hidden = false;
  btnSettings.addEventListener('click', () => {
    settingsPanel.hidden = !settingsPanel.hidden;
  });

  const optSsao = document.getElementById('opt-ssao') as HTMLInputElement;
  const optGrade = document.getElementById('opt-grade') as HTMLInputElement;
  const optPlastic = document.getElementById('opt-plastic') as HTMLInputElement;
  const optScratches = document.getElementById('opt-scratches') as HTMLInputElement;

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
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  post.setSize(w, h);
  const aspect = w / h;
  camera.aspect = aspect;
  if (aspect < 1) {
    // Keep the full sphere cleanly framed horizontally with studio breathing room on narrow mobile portraits
    const halfFovRad = Math.atan(Math.tan(THREE.MathUtils.degToRad(16)) / Math.max(0.45, aspect * 0.92));
    camera.fov = Math.min(58, THREE.MathUtils.radToDeg(halfFovRad * 2));
  } else {
    camera.fov = 32;
  }
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
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
  setRotation: (rx: number, ry: number, rz = 0) => {
    sphereQuat.setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
    angVel.set(0, 0, 0);
  },
  setZoom: (d: number) => {
    targetCamDist = d;
    camDist = d;
  },
  getState: () => ({
    level: currentLevelIdx + 1,
    name: grid.levels[currentLevelIdx].name,
    layer: physics.layer,
    radius: physics.radius,
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
const gravityWorldDir = new THREE.Vector3();

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) * 0.001, 0.05);
  lastFrame = now;
  const t = now * 0.001;

  // Decay toggle button tactile depress bounce
  for (let i = 0; i < togglePulse.length; i++) {
    if (togglePulse[i] > 0) togglePulse[i] = Math.max(0, togglePulse[i] - dt * 4.2);
  }

  // Animate radial wall morphing wave + diaphragm shutter iris rotation
  const maxMorphTime = activeWaveSpread + activeBladeDuration + 0.2;
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
    rig.applyShutterOpenings(shutterOpen);
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
  } else if (gyroOn && activePointerId === null && gyroTilt.lengthSq() > 1e-4) {
    // Tilting phone right edge down -> roll sphere left so ball glides right; top down -> roll sphere down so ball glides up
    const gSpeed = 2.35;
    camUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    camRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    dragVelVec
      .copy(camUp)
      .multiplyScalar(-gyroTilt.x * gSpeed)
      .addScaledVector(camRight, gyroTilt.y * gSpeed);
    angVel.lerp(dragVelVec, Math.min(1, dt * 10));
  }

  if (activePointerId === null) {
    const wMag = angVel.length();
    if (wMag > 1e-4) {
      stepAxis.copy(angVel).multiplyScalar(1 / wMag);
      stepQuat.setFromAxisAngle(stepAxis, wMag * dt);
      sphereQuat.premultiply(stepQuat).normalize();
      angVel.multiplyScalar(Math.exp(-6.5 * dt));
    }
  }

  camDist += (targetCamDist - camDist) * Math.min(1, dt * 9);
  camera.position.set(0, 0.24 * (camDist / 4.55), camDist);
  camera.lookAt(0, -0.02, 0);

  const bob = Math.sin(t * 1.15) * 0.018;
  floatGroup.position.y = bob;
  studio.shadowPlane.scale.setScalar(1.0 - bob * 1.4);

  // Gravity points from the sphere center directly toward the camera (ball seeks 50% / 50% of screen!)
  gravityWorldDir.copy(camera.position).sub(floatGroup.position).normalize();

  rig.root.quaternion.copy(sphereQuat);
  physics.step(dt, sphereQuat, gravityWorldDir, wallExt, shutterOpen, {
    onWallHit: (strength) => sound.playWallHit(strength),
    onDropIntoPipe: () => {
      sound.playPortalDrop();
      updateStatusUI();
    },
    onEmergeFromPipe: () => {
      sound.playPortalEmerge();
      updateStatusUI();
    },
    onToggle: (toggleId, active) => {
      sound.playToggle(active);
      triggerToggleMorph(toggleId);
      updateStatusUI();
    },
    onCheckpoint: (idx, allCleared) => {
      sound.playCheckpoint(idx, allCleared);
      if (allCleared) {
        completedLevels.add(currentLevelIdx + 1);
        if (currentLevelIdx < grid.levels.length - 1) {
          autoAdvanceTimer = window.setTimeout(() => {
            applyLevel(currentLevelIdx + 1, false, true);
          }, 2200);
        }
      }
      updateStatusUI();
    },
  });
  sound.updateRoll(physics.speed);

  rig.ballMesh.position.copy(physics.dir).multiplyScalar(physics.radius);
  rig.ballMesh.quaternion.copy(physics.ballQuat);
  rig.updateLeds(t, physics.cleared, physics.getNextCheckpointIndex(), physics.allCleared, physics.toggleMask, togglePulse);

  post.render(t);
}

requestAnimationFrame(frame);
