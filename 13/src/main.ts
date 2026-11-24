import * as THREE from 'three';
import { buildLabyrinthRig, type LabyrinthRig } from './labyrinthMesh';
import { R_BALL_CENTER, generateSphereMaze, type SphereMaze } from './maze';
import { SphereBallPhysics } from './physics';
import { StudioPost } from './post';
import { LabyrinthSound } from './sound';
import { setupStudio } from './studio';

const params = new URLSearchParams(location.search);
if (params.has('clean')) document.body.classList.add('clean');

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false, // MSAA handled inside StudioPost HDR target
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// StudioPost handles filmic tone mapping & sRGB output
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

// Container that floats subtly in the studio and holds the rotatable labyrinth sphere
const floatGroup = new THREE.Group();
scene.add(floatGroup);

let seed = Number(params.get('seed')) || 1307;
let maze: SphereMaze;
let rig: LabyrinthRig;
let physics: SphereBallPhysics;

// Initial studio hero pose: showcases the gleaming steel ball, sculpted white/beige tracks,
// prominent MADE IN SWEDEN tape across the front-lower equator, recessed screws, and glowing LEDs
const initialQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.56, -0.34, 0.06, 'YXZ'));
const sphereQuat = initialQuat.clone();

// Smooth angular velocity for silky inertia after pointer release
const angVel = new THREE.Vector3(0, 0, 0);

// UI elements
const ledDotsEl = document.getElementById('led-dots')!;
const statusTextEl = document.getElementById('status-text')!;
const btnReset = document.getElementById('btn-reset')!;
const btnSeed = document.getElementById('btn-seed')!;
const btnSound = document.getElementById('btn-sound')!;
const btnHelp = document.getElementById('btn-help')!;
const helpCard = document.getElementById('help-card')!;
const btnSettings = document.getElementById('btn-settings')!;
const settingsPanel = document.getElementById('settings-panel')!;

function updateStatusUI() {
  const count = physics.getClearedCount();
  const total = maze.checkpoints.length;
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
    dot.classList.toggle('cleared', physics.cleared[i]);
    dot.classList.toggle('next', !physics.cleared[i] && i === nextIdx);
  }

  statusTextEl.textContent = physics.allCleared ? 'COMPLETE · ALL LEDS LIT' : `${count} / ${total} CHECKPOINTS`;
}

function mountMaze(newSeed: number) {
  if (rig) {
    floatGroup.remove(rig.root);
    rig.dispose();
  }
  seed = newSeed;
  maze = generateSphereMaze(seed);
  rig = buildLabyrinthRig(maze);
  floatGroup.add(rig.root);

  // Exclude transparent plastic shell, scratches, tape, decals, halos, backdrop, shadow plane from GTAO normal pass
  post.setAoExcluded([...rig.aoExcluded, studio.backdropMesh, studio.shadowPlane]);

  if (!physics) {
    physics = new SphereBallPhysics(maze);
  } else {
    physics.setMaze(maze);
  }

  sphereQuat.copy(initialQuat);
  angVel.set(0, 0, 0);
  rig.root.quaternion.copy(sphereQuat);
  rig.ballMesh.position.copy(physics.dir).multiplyScalar(R_BALL_CENTER);
  updateStatusUI();
}

mountMaze(seed);

// --- Shoemake Arcball 3-DOF pointer rotation ---
let activePointerId: number | null = null;
const lastArcVec = new THREE.Vector3();
const curArcVec = new THREE.Vector3();
const dragAxis = new THREE.Vector3();
const dragQuat = new THREE.Quaternion();

function projectToArcball(clientX: number, clientY: number, out: THREE.Vector3): THREE.Vector3 {
  const rect = canvas.getBoundingClientRect();
  const radius = Math.min(rect.width, rect.height) * 0.42;
  const x = (clientX - (rect.left + rect.width * 0.5)) / radius;
  const y = -(clientY - (rect.top + rect.height * 0.5)) / radius;
  const r2 = x * x + y * y;
  if (r2 <= 1.0) {
    out.set(x, y, Math.sqrt(1.0 - r2));
  } else {
    const inv = 1.0 / Math.sqrt(r2);
    out.set(x * inv, y * inv, 0);
  }
  return out.normalize();
}

let lastMoveTime = performance.now();

canvas.addEventListener('pointerdown', (e) => {
  if (activePointerId !== null) return;
  sound.unlock();
  activePointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
  projectToArcball(e.clientX, e.clientY, lastArcVec);
  angVel.set(0, 0, 0);
  lastMoveTime = performance.now();
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activePointerId) return;
  projectToArcball(e.clientX, e.clientY, curArcVec);

  const dot = Math.max(-1, Math.min(1, lastArcVec.dot(curArcVec)));
  const angle = Math.acos(dot) * 1.18;
  if (angle > 1e-5) {
    dragAxis.crossVectors(lastArcVec, curArcVec);
    if (dragAxis.lengthSq() > 1e-10) {
      dragAxis.normalize();
      // Transform arcball axis from camera space into world space
      dragAxis.applyQuaternion(camera.quaternion).normalize();
      dragQuat.setFromAxisAngle(dragAxis, angle);
      sphereQuat.premultiply(dragQuat).normalize();

      const now = performance.now();
      const dt = Math.max(0.008, (now - lastMoveTime) * 0.001);
      lastMoveTime = now;
      // Blend rotational velocity for tactile inertial coasting on release
      angVel.lerp(dragAxis.clone().multiplyScalar(Math.min(angle / dt, 7.0)), 0.45);
    }
  }
  lastArcVec.copy(curArcVec);
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

// Smooth scroll-to-zoom for admiring screws, scratches & tape up close
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    targetCamDist = Math.max(2.55, Math.min(5.6, targetCamDist + e.deltaY * 0.0024));
  },
  { passive: false },
);

// Keyboard support (WASD / Arrows for fine tilting, R reset, N new maze, M mute, ? help)
const keysDown = new Set<string>();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'q', 'e'].includes(k)) {
    sound.unlock();
    keysDown.add(k);
  } else if (k === 'r') {
    physics.reset();
    sphereQuat.copy(initialQuat);
    angVel.set(0, 0, 0);
    updateStatusUI();
  } else if (k === 'n') {
    mountMaze((seed + 97) % 9999);
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

// UI Actions
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

btnSeed.addEventListener('click', () => {
  sound.unlock();
  mountMaze((seed + 97) % 9999);
});

btnSound.addEventListener('click', toggleSound);
btnHelp.addEventListener('click', () => toggleHelp());

// Settings workbench (only in dev or ?settings per docs/DESIGN.md)
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

// Responsive sizing (fits mobile portrait gracefully too)
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

// Expose lightweight debug handle for inspection & demo captures
(window as unknown as Record<string, unknown>).__labyrinth = {
  setRotation: (rx: number, ry: number, rz = 0) => {
    sphereQuat.setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
    angVel.set(0, 0, 0);
  },
  setZoom: (d: number) => {
    targetCamDist = d;
    camDist = d;
  },
  getState: () => ({
    seed,
    cleared: physics.getClearedCount(),
    total: maze.checkpoints.length,
    ballDir: physics.dir.toArray(),
  }),
};

// Main loop
let lastFrame = performance.now();
const stepAxis = new THREE.Vector3();
const stepQuat = new THREE.Quaternion();
const keyTilt = new THREE.Vector3();

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) * 0.001, 0.05);
  lastFrame = now;
  const t = now * 0.001;

  // Keyboard gentle tilt controls
  keyTilt.set(0, 0, 0);
  const kSpeed = 1.85;
  if (keysDown.has('arrowup') || keysDown.has('w')) keyTilt.x -= kSpeed;
  if (keysDown.has('arrowdown') || keysDown.has('s')) keyTilt.x += kSpeed;
  if (keysDown.has('arrowleft') || keysDown.has('a')) keyTilt.y -= kSpeed;
  if (keysDown.has('arrowright') || keysDown.has('d')) keyTilt.y += kSpeed;
  if (keysDown.has('q')) keyTilt.z += kSpeed;
  if (keysDown.has('e')) keyTilt.z -= kSpeed;
  if (keyTilt.lengthSq() > 0) {
    angVel.lerp(keyTilt, Math.min(1, dt * 8));
  }

  // Apply inertial coasting when not dragging
  if (activePointerId === null) {
    const wMag = angVel.length();
    if (wMag > 1e-4) {
      stepAxis.copy(angVel).multiplyScalar(1 / wMag);
      stepQuat.setFromAxisAngle(stepAxis, wMag * dt);
      sphereQuat.premultiply(stepQuat).normalize();
      angVel.multiplyScalar(Math.exp(-4.2 * dt));
    }
  }

  // Smooth zoom easing
  camDist += (targetCamDist - camDist) * Math.min(1, dt * 9);
  camera.position.set(0, 0.24 * (camDist / 4.55), camDist);
  camera.lookAt(0, -0.02, 0);

  // Subtle floating breath in the studio + reactive floor contact shadow
  const bob = Math.sin(t * 1.15) * 0.018;
  floatGroup.position.y = bob;
  studio.shadowPlane.scale.setScalar(1.0 - bob * 1.4);

  // Step spherical metal ball physics
  rig.root.quaternion.copy(sphereQuat);
  physics.step(dt, sphereQuat, {
    onWallHit: (strength) => sound.playWallHit(strength),
    onCheckpoint: (idx, allCleared) => {
      sound.playCheckpoint(idx, allCleared);
      updateStatusUI();
    },
  });
  sound.updateRoll(physics.speed);

  // Update ball transform & checkpoint LEDs
  rig.ballMesh.position.copy(physics.dir).multiplyScalar(R_BALL_CENTER);
  rig.ballMesh.quaternion.copy(physics.ballQuat);
  rig.updateLeds(t, physics.cleared, physics.getNextCheckpointIndex(), physics.allCleared);

  // Render through 4x MSAA + Light GTAO + Studio Color Grade
  post.render(t);
}

requestAnimationFrame(frame);
