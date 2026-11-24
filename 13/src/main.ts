import * as THREE from 'three';
import { buildLabyrinthRig } from './labyrinthMesh';
import { createSphereGrid } from './maze';
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

// Build single persistent two-layer adaptive sphere grid + 5 morphing levels
const grid = createSphereGrid();
const rig = buildLabyrinthRig(grid);
floatGroup.add(rig.root);

const initialLevelNum = Math.max(1, Math.min(5, Number(params.get('level')) || 1));
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

let morphElapsed = 10;
const BLADE_DURATION = 0.56;
const WAVE_SPREAD = 0.42;

const physics = new SphereBallPhysics(grid, grid.levels[currentLevelIdx]);

// Hero pose frames the chrome ball prominently near center-top with the open shutter,
// transparent windows into the half-pipe, and MADE IN SWEDEN tape in view below
const initialQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.76, -0.34, 0.05, 'YXZ'));
const sphereQuat = initialQuat.clone();
const angVel = new THREE.Vector3(0, 0, 0);

// UI references
const ledDotsEl = document.getElementById('led-dots')!;
const statusTextEl = document.getElementById('status-text')!;
const btnReset = document.getElementById('btn-reset')!;
const btnSound = document.getElementById('btn-sound')!;
const btnHelp = document.getElementById('btn-help')!;
const helpCard = document.getElementById('help-card')!;
const btnSettings = document.getElementById('btn-settings')!;
const settingsPanel = document.getElementById('settings-panel')!;
const levelButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.lvl-btn'));

function updateStatusUI() {
  const level = grid.levels[currentLevelIdx];
  const count = physics.getClearedCount();
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

  const lvlTag = `LVL ${String(level.level).padStart(2, '0')}`;
  const deckTag = physics.layer === 'pipe' || physics.layer === 'dropping' ? ' · SUB-PIPE' : '';
  statusTextEl.textContent = physics.allCleared
    ? `${lvlTag} · COMPLETE`
    : `${lvlTag} · ${count} / ${total} LEDS${deckTag}`;

  for (const btn of levelButtons) {
    const n = Number(btn.dataset.level);
    btn.classList.toggle('active', n === level.level);
    btn.classList.toggle('done', completedLevels.has(n));
  }
}

function syncAoExclusions() {
  post.setAoExcluded([...rig.aoExcluded, studio.backdropMesh, studio.shadowPlane]);
}

function applyLevel(index: number, instant: boolean, resetBall = false) {
  if (autoAdvanceTimer !== null) {
    window.clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }

  const clamped = Math.max(0, Math.min(grid.levels.length - 1, index));
  const changed = clamped !== currentLevelIdx;
  currentLevelIdx = clamped;
  const level = grid.levels[currentLevelIdx];

  const waveDir = new THREE.Vector3(-0.6, 0.72, 0.35).normalize().applyQuaternion(sphereQuat.clone().invert());

  for (let i = 0; i < wallCount; i++) {
    const slot = grid.walls[i];
    const target = slot.locked || level.raisedWalls[i] ? 1.0 : 0.0;
    wallStartExt[i] = instant ? target : wallExt[i];
    wallTargetExt[i] = target;
    if (instant) {
      wallExt[i] = target;
      wallDelay[i] = 0;
    } else {
      const wave01 = 0.5 - 0.5 * slot.midDir.dot(waveDir);
      const retractLead = target < wallStartExt[i] ? 0.0 : 0.1;
      wallDelay[i] = wave01 * WAVE_SPREAD + retractLead;
    }
  }

  for (let i = 0; i < shutterCount; i++) {
    const port = grid.shutters[i];
    const target = level.openShutters[i] ? 1.0 : 0.0;
    shutterStartOpen[i] = instant ? target : shutterOpen[i];
    shutterTargetOpen[i] = target;
    if (instant) {
      shutterOpen[i] = target;
      shutterDelay[i] = 0;
    } else {
      const wave01 = 0.5 - 0.5 * port.dir.dot(waveDir);
      shutterDelay[i] = wave01 * WAVE_SPREAD * 0.8 + 0.05;
    }
  }

  morphElapsed = instant ? 10 : 0;

  if (instant) {
    rig.applyWallExtensions(wallExt);
    rig.applyShutterOpenings(shutterOpen);
  } else if (changed) {
    sound.playMorph();
  }

  rig.setLevelCheckpoints(level.checkpoints);
  syncAoExclusions();
  physics.setLevel(level, resetBall);
  updateStatusUI();
}

applyLevel(currentLevelIdx, true, true);
rig.root.quaternion.copy(sphereQuat);
rig.ballMesh.position.copy(physics.dir).multiplyScalar(physics.radius);

function easeMechanical(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// --- Direct, zero-twist camera-plane pointer rotation ---
// Dragging moves the front face of the sphere 1:1 under your pointer (no unwanted Z-roll wobble!),
// while overhead gravity pulls the ball cleanly toward 50% / 50% dead center of the screen.
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
  const angleY = dx / radiusPx; // drag right -> rotate front face right around camera up
  const angleX = dy / radiusPx; // drag down  -> rotate front face down around camera right

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
  } else if (k >= '1' && k <= '5') {
    sound.unlock();
    applyLevel(Number(k) - 1, false, false);
  } else if (k === 'r') {
    physics.reset();
    sphereQuat.copy(initialQuat);
    angVel.set(0, 0, 0);
    updateStatusUI();
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

btnReset.addEventListener('click', () => {
  sound.unlock();
  physics.reset();
  sphereQuat.copy(initialQuat);
  angVel.set(0, 0, 0);
  updateStatusUI();
});

btnSound.addEventListener('click', toggleSound);
btnHelp.addEventListener('click', () => toggleHelp());

for (const btn of levelButtons) {
  btn.addEventListener('click', () => {
    sound.unlock();
    const lvl = Number(btn.dataset.level);
    applyLevel(lvl - 1, false, false);
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
  camera.aspect = w / h;
  camera.fov = w < h ? 39 : 32;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Debug handle for verification & demo inspection
(window as unknown as Record<string, unknown>).__labyrinth = {
  setLevel: (n: number, instant = false) => applyLevel(n - 1, instant, false),
  enterPipe: (shutterId = 0) => {
    physics.enterPipeAtShutter(shutterId);
    updateStatusUI();
  },
  setShutterOpen: (id: number, val: number) => {
    if (id >= 0 && id < shutterCount) {
      shutterOpen[id] = val;
      shutterTargetOpen[id] = val;
      rig.applyShutterOpenings(shutterOpen);
    }
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
    layer: physics.layer,
    radius: physics.radius,
    cleared: physics.getClearedCount(),
    total: grid.levels[currentLevelIdx].checkpoints.length,
    ballDir: physics.dir.toArray(),
    openShutters: Array.from(shutterOpen).map((v) => Number(v.toFixed(2))),
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

  // Animate radial wall morphing wave + diaphragm shutter iris rotation
  const maxMorphTime = WAVE_SPREAD + BLADE_DURATION + 0.2;
  if (morphElapsed <= maxMorphTime) {
    morphElapsed += dt;
    for (let i = 0; i < wallCount; i++) {
      if (grid.walls[i].locked) {
        wallExt[i] = 1.0;
        continue;
      }
      const localT = (morphElapsed - wallDelay[i]) / BLADE_DURATION;
      wallExt[i] = wallStartExt[i] + (wallTargetExt[i] - wallStartExt[i]) * easeMechanical(localT);
    }
    for (let i = 0; i < shutterCount; i++) {
      const localT = (morphElapsed - shutterDelay[i]) / (BLADE_DURATION * 0.95);
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

  // Gravity points from the sphere center directly toward the camera (ball always seeks 50% / 50% of the screen!)
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
    onCheckpoint: (idx, allCleared) => {
      sound.playCheckpoint(idx, allCleared);
      if (allCleared) {
        completedLevels.add(currentLevelIdx + 1);
        if (currentLevelIdx < grid.levels.length - 1) {
          autoAdvanceTimer = window.setTimeout(() => {
            applyLevel(currentLevelIdx + 1, false, false);
          }, 2200);
        }
      }
      updateStatusUI();
    },
  });
  sound.updateRoll(physics.speed);

  rig.ballMesh.position.copy(physics.dir).multiplyScalar(physics.radius);
  rig.ballMesh.quaternion.copy(physics.ballQuat);
  rig.updateLeds(t, physics.cleared, physics.getNextCheckpointIndex(), physics.allCleared);

  post.render(t);
}

requestAnimationFrame(frame);
