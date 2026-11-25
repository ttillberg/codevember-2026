import * as THREE from 'three';
import { C64_PALETTE_RGB } from './c64/charset';
import { C64Screen } from './c64/screen';
import { C64Basic } from './c64/basic';
import { C64FloppyDisk } from './c64/disk';
import { Commodore1702, type MonitorHit, type MonitorKnobs } from './monitor';
import { Commodore1541 } from './drive1541';
import { DeskCheatPaper } from './cheatsheet';
import { Bic4ColorPen } from './bicpen';
import { OrangeDeskLamp } from './lamp';
import { RetroWallClock } from './clock';
import { buildKidSketches } from './sketches';
import { Commodore64Breadbin } from './c64breadbin';
import { Tac2Joystick } from './tac2';
import { EchoFireworks } from './fireworks';
import { FilmColorGrade } from './post';
import { buildSwedishRoom } from './room';
import { MonitorSound } from './sound';

// ?clean: no page furniture, the scene alone (screengrabs, clips)
const params = new URLSearchParams(location.search);
if (params.has('clean')) document.body.classList.add('clean');

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const crtFsEl = document.querySelector<HTMLElement>('#crt-fullscreen')!;
const crtFsCanvas = document.querySelector<HTMLCanvasElement>('#crt-fs-canvas')!;
const crtFsCtx = crtFsCanvas.getContext('2d')!;
const touchInput = document.querySelector<HTMLInputElement>('#touch-kbd')!;
const btnEsc = document.querySelector<HTMLButtonElement>('#btn-esc')!;
const btnFocus = document.querySelector<HTMLButtonElement>('#btn-focus')!;
const btnSound = document.querySelector<HTMLButtonElement>('#btn-sound')!;
const btnPaper = document.querySelector<HTMLButtonElement>('#btn-paper')!;
const paperViewEl = document.querySelector<HTMLElement>('#paper-view')!;
const paperImgEl = document.querySelector<HTMLImageElement>('#paper-img')!;
const paperCloseBtn = document.querySelector<HTMLButtonElement>('#paper-close')!;
const toastEl = document.querySelector<HTMLElement>('#toast')!;

let toastTimer: number | null = null;
function showToast(msg: string, durationMs = 1600) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('show');
    toastTimer = null;
  }, durationMs);
}

// ---- C64 Machine, 1541 Disk & Audio ----
const sound = new MonitorSound();
const fireworks = new EchoFireworks(() => sound.playFireworkPop());
const screen = new C64Screen();
const disk = new C64FloppyDisk();
const drive = new Commodore1541();
const basic = new C64Basic(screen, {
  disk,
  onSidPoke: (reg, val) => sound.sidPoke(reg, val),
  onSidSilence: () => sound.silenceSid(),
  onDiskActivity: (state) => {
    drive.setActivity(state);
    if (state !== 'idle') sound.playDiskSeek(state);
  },
  onEchoAchieved: (echoed) => {
    fireworks.celebrate();
    sound.playEchoFanfare();
    const preview = echoed.length > 18 ? `${echoed.slice(0, 18)}…` : echoed;
    showToast(`ECHO! "${preview}" — nice work!`, 3400);
  },
});

// ---- Three.js Scene ----
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
// PCFShadowMap honors shadow.radius for smooth soft penumbra without stair-step jaggies
renderer.shadowMap.type = THREE.PCFShadowMap;
// Tone mapping & 1984 35mm film color grade are handled in the post-processing pass
renderer.toneMapping = THREE.NoToneMapping;

const filmGrade = new FilmColorGrade(
  window.innerWidth,
  window.innerHeight,
  Math.min(window.devicePixelRatio, 2),
);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0c0b);
scene.fog = new THREE.FogExp2(0x0d0c0b, 0.026);

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.1, 60);

// Camera presets + gentle pointer parallax (no orbit tumble!)
let focusedMode = false;
const camGoalPos = new THREE.Vector3();
const camGoalTarget = new THREE.Vector3();
const camCurPos = new THREE.Vector3();
const camCurTarget = new THREE.Vector3();
const parallaxTarget = { x: 0, y: 0 };
const parallax = { x: 0, y: 0 };
const desiredPos = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();

let mobileKbdOpen = false;

function computePreset(focused: boolean) {
  const fullW = Math.max(1, window.innerWidth);
  const fullH = Math.max(1, window.innerHeight);
  const aspect = fullW / fullH;
  const isPhonePortraitWidth = fullW < 640;
  const portraitMobile = !focused && aspect < 0.85;

  if (focused) {
    // Zoom straight into the CRT screen while the full-viewport C64 blue screen fades in
    camGoalTarget.set(0, 1.98, 1.0);
    camGoalPos.set(0, 2.02, 4.2);
  } else if (mobileKbdOpen && isPhonePortraitWidth) {
    // Portrait mobile keyboard open: fit the 1702 CRT cleanly inside the exact usable visualViewport
    // strip between the top title plate (22 ECHO) and the top of the iOS/Android keyboard!
    const vv = window.visualViewport;
    const visH = vv?.height ?? fullH;
    const vvTop = vv?.offsetTop ?? 0;
    const tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const screenZ = 1.15;
    const screenCenterY = 2.02;

    // Reserve clean clearance for top "22 ECHO" header (~84px) and bottom ESC pill + bezel (~52px)
    const topSafePx = 84;
    const bottomSafePx = 52;
    const usableH = Math.max(140, visH - topSafePx - bottomSafePx);
    const usableFrac = usableH / fullH;

    // Exact distance using Three.js camera.aspect (fullW / fullH):
    // fits 3.24u width (blue CRT 2.86u + tidy side margin) and 2.38u height inside usableH
    const distForWidth = 1.62 / (tanHalfV * aspect);
    const distForHeight = 1.19 / (tanHalfV * usableFrac);
    const dist = Math.max(distForWidth, distForHeight);

    // Project CRT center (y = 2.02) to the exact vertical midpoint of [vvTop + topSafePx .. vvTop + visH - bottomSafePx]
    const targetPxFromTop = vvTop + topSafePx + usableH * 0.5;
    const ndcY = 1 - (2 * targetPxFromTop) / fullH;
    const camY = screenCenterY - ndcY * dist * tanHalfV;

    camGoalTarget.set(0.0, camY, screenZ);
    camGoalPos.set(0.0, camY, screenZ + dist);
  } else if (portraitMobile) {
    // Portrait mobile (keyboard closed): full cozy desk view (lamp peek, 1702, full C64C, clock, 1541)
    // that zooms cleanly into the CRT the moment you tap to open the iOS keyboard
    const distScale = Math.max(0.84, Math.min(1.12, 0.48 / Math.max(0.38, aspect)));
    camGoalTarget.set(0.10, 1.66, 0.35);
    camGoalPos.set(0.28, 3.65, 18.2 * distScale);
  } else {
    // Big centered 1702 CRT with the C64C cropping naturally at the bottom foreground, 1541 + TAC-2 on the right, cheat sheet + lamp on the left
    const narrow = aspect < 1.50 ? Math.min(1.85, 1.50 / Math.max(0.85, aspect)) : 1.0;
    camGoalTarget.set(0.16, 1.70, 0.30);
    camGoalPos.set(0.48 * Math.min(1.25, narrow), 3.02 * Math.pow(narrow, 0.28), 8.62 * narrow);
  }
}

computePreset(false);
camCurPos.copy(camGoalPos);
camCurTarget.copy(camGoalTarget);
camera.position.copy(camCurPos);
camera.lookAt(camCurTarget);

// ---- Commodore 1702 Monitor, 1541 Floppy Drive, Orange Desk Lamp, Cheat Paper & BIC Pen ----
const monitor = new Commodore1702(screen.canvas);
scene.add(monitor.root);
scene.add(drive.root);

const deskLamp = new OrangeDeskLamp(() => {
  pickables.push(...deskLamp.interactiveMeshes);
});
scene.add(deskLamp.root);

const deskPaper = new DeskCheatPaper();
scene.add(deskPaper.root);
let paperImgReady = false;

const bicPen = new Bic4ColorPen();
scene.add(bicPen.root);

const wallClock = new RetroWallClock((sec) => sound.playClockTick(sec));
scene.add(wallClock.root);

const tac2 = new Tac2Joystick();
scene.add(tac2.root);

const c64 = new Commodore64Breadbin(tac2.cableEntryWorld);
scene.add(c64.root);

// ---- 1984 Swedish Bedroom Desk, Heritage Wallpaper, Kid Sketches & Echo Fireworks ----
const swedishRoom = buildSwedishRoom();
scene.add(swedishRoom.group);
scene.add(buildKidSketches());
scene.add(fireworks.root);

const pickables: THREE.Object3D[] = [
  ...monitor.interactiveMeshes,
  ...drive.interactiveMeshes,
  ...deskLamp.interactiveMeshes,
  ...c64.interactiveMeshes,
  ...tac2.interactiveMeshes,
  deskPaper.hitMesh,
  bicPen.hitMesh,
  wallClock.hitMesh,
  swedishRoom.wallMesh,
];

// ---- Moody Room Lighting (modulated smoothly by the clickable orange desk lamp) ----
const hemi = new THREE.HemisphereLight(0xd6cfc4, 0x241d17, 0.34);
scene.add(hemi);

// Warm overhead/left desk lamp key light (dims down to moonlight when the orange lamp is off!)
const keyLight = new THREE.DirectionalLight(0xffe4be, 1.45);
keyLight.position.set(-4.2, 6.8, 4.8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 2.0;
keyLight.shadow.camera.far = 19.0;
const d = 4.8;
keyLight.shadow.camera.left = -d;
keyLight.shadow.camera.right = d;
keyLight.shadow.camera.top = d;
keyLight.shadow.camera.bottom = -d;
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.025;
keyLight.shadow.radius = 3.5;
scene.add(keyLight);

// Subtle cool rim light from back-right to sculpt the 1702 & lamp silhouettes
const rimLight = new THREE.DirectionalLight(0xa7c0ea, 0.58);
rimLight.position.set(4.5, 4.4, -5.2);
scene.add(rimLight);

// Soft warm bounce fill from right-front
const fillLight = new THREE.DirectionalLight(0xe5d8c4, 0.38);
fillLight.position.set(4.2, 2.6, 4.6);
scene.add(fillLight);

let roomLampLevel = 1.0;

// ---- Pointer & Raycast Interaction ----
type SceneHit =
  | MonitorHit
  | { kind: 'paper' }
  | { kind: 'drive' }
  | { kind: 'pen' }
  | { kind: 'lamp' }
  | { kind: 'clock' }
  | { kind: 'key'; key: string }
  | { kind: 'joystick' }
  | { kind: 'joystick-fire' }
  | { kind: 'wallpaper' };
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

let downPos = { x: 0, y: 0 };
let activeKnob: keyof MonitorKnobs | null = null;
let activeKnobPointerId: number | null = null;
let lastKnobY = 0;
let lastCursor = '';
let canvasRect = canvas.getBoundingClientRect();
const activePointers = new Set<number>();
let multiTouchGesture = false;
const lastHitPoint = new THREE.Vector3();

function setCursor(next: string) {
  if (lastCursor !== next) {
    lastCursor = next;
    canvas.style.cursor = next;
  }
}

function releaseKnob() {
  if (!activeKnob) return;
  if (activeKnobPointerId !== null && canvas.hasPointerCapture(activeKnobPointerId)) {
    canvas.releasePointerCapture(activeKnobPointerId);
  }
  activeKnob = null;
  activeKnobPointerId = null;
  setCursor('default');
}

function pickScene(clientX: number, clientY: number): SceneHit | null {
  const rect = canvasRect;
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObjects(pickables, false);
  for (const h of hits) {
    const data = h.object.userData.hit as SceneHit | undefined;
    if (!data) continue;
    if (data.kind === 'knob' && !monitor.hatchOpen) continue;
    lastHitPoint.copy(h.point);
    return data;
  }
  return null;
}

canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  activePointers.add(e.pointerId);
  if (activePointers.size > 1) {
    multiTouchGesture = true;
    return;
  }
  multiTouchGesture = false;

  downPos = { x: e.clientX, y: e.clientY };

  const hit = pickScene(e.clientX, e.clientY);
  if (hit?.kind === 'knob' && hit.knob) {
    activeKnob = hit.knob;
    activeKnobPointerId = e.pointerId;
    lastKnobY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    setCursor('ns-resize');
  }
});

window.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'touch') {
    const nx = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
    const ny = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    parallaxTarget.x = Math.max(-1, Math.min(1, nx));
    parallaxTarget.y = Math.max(-1, Math.min(1, ny));
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (activeKnob) {
    const dy = lastKnobY - e.clientY;
    lastKnobY = e.clientY;
    monitor.adjustKnob(activeKnob, dy * 0.0045);
    return;
  }
  if (e.buttons === 0 && e.pointerType === 'mouse') {
    const hit = pickScene(e.clientX, e.clientY);
    deskPaper.setHovered(hit?.kind === 'paper');
    bicPen.setHovered(hit?.kind === 'pen');
    if (
      hit?.kind === 'power' ||
      hit?.kind === 'hatch' ||
      hit?.kind === 'paper' ||
      hit?.kind === 'drive' ||
      hit?.kind === 'pen' ||
      hit?.kind === 'lamp' ||
      hit?.kind === 'clock' ||
      hit?.kind === 'key' ||
      hit?.kind === 'joystick' ||
      hit?.kind === 'joystick-fire'
    ) {
      setCursor('pointer');
    } else if (hit?.kind === 'knob') {
      setCursor('ns-resize');
    } else if (hit?.kind === 'screen') {
      setCursor('text');
    } else {
      setCursor('default');
    }
  }
});

canvas.addEventListener('pointerleave', () => {
  deskPaper.setHovered(false);
  bicPen.setHovered(false);
  parallaxTarget.x = 0;
  parallaxTarget.y = 0;
});

canvas.addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  releaseKnob();
});

canvas.addEventListener('lostpointercapture', () => {
  releaseKnob();
});

const C64_SHIFT_MAP: Record<string, string> = {
  '1': '!', '2': '"', '3': '#', '4': '$', '5': '%', '6': '&', '7': "'", '8': '(', '9': ')',
  ':': '[', ';': ']', ',': '<', '.': '>', '/': '?',
};
let virtualShift = false;

let lastTouchTapOpensKbd = false;

canvas.addEventListener('click', () => {
  // iOS Safari strictly trusts synchronous 'click' events to open the native virtual keyboard
  if (lastTouchTapOpensKbd) {
    lastTouchTapOpensKbd = false;
    openMobileKeyboard();
  }
});

canvas.addEventListener('pointerup', (e) => {
  activePointers.delete(e.pointerId);
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  if (activeKnob) {
    releaseKnob();
    return;
  }
  if (multiTouchGesture) return;

  const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  if (dist > 6) return;

  const hit = pickScene(e.clientX, e.clientY);
  if (!hit) {
    if (document.activeElement === touchInput) touchInput.blur();
    return;
  }

  const wasTouchKbdFocused = document.activeElement === touchInput;
  if (hit.kind !== 'screen' && hit.kind !== 'key' && wasTouchKbdFocused) {
    touchInput.blur();
  }

  if (hit.kind === 'power') {
    const on = monitor.togglePower();
    sound.setPowered(on);
  } else if (hit.kind === 'hatch') {
    const open = monitor.toggleHatch();
    sound.playHatch(open);
  } else if (hit.kind === 'drive') {
    const inserted = drive.toggleDisk();
    disk.inserted = inserted;
    sound.playFloppyLatch(inserted);
  } else if (hit.kind === 'pen') {
    bicPen.clickNextColor();
    sound.playBicClick();
  } else if (hit.kind === 'lamp') {
    const on = deskLamp.toggle();
    sound.playLampSwitch(on);
  } else if (hit.kind === 'clock') {
    const ticking = wallClock.toggleTickSound();
    if (ticking) sound.playClockTick(0, true);
    showToast(ticking ? 'Clock tick on' : 'Clock tick off');
  } else if (hit.kind === 'key') {
    if (e.pointerType === 'touch') {
      // On iOS/Android touchscreens, tapping the 3D keyboard pops up the native OS keyboard!
      lastTouchTapOpensKbd = true;
      openMobileKeyboard();
    } else {
      c64.triggerKey(hit.key);
      sound.playKey(hit.key);
      if (hit.key === 'Shift') {
        virtualShift = !virtualShift;
      } else {
        const outKey = virtualShift ? (C64_SHIFT_MAP[hit.key] ?? hit.key) : hit.key;
        virtualShift = false;
        basic.pulseMatrixKey(outKey);
        basic.handleKey(outKey, false, false);
      }
    }
  } else if (hit.kind === 'joystick') {
    const local = tac2.root.worldToLocal(lastHitPoint.clone());
    const dx = Math.abs(local.x) >= Math.abs(local.z) ? (local.x >= 0 ? 1 : -1) : 0;
    const dz = Math.abs(local.z) > Math.abs(local.x) ? (local.z >= 0 ? 1 : -1) : 0;
    tac2.nudge(dx === 0 && dz === 0 ? 1 : dx, dz, 0.22);
    sound.playJoystickClick(false);
    // Feed CIA1 Port 2 ($DC00) joystick pulse for 6502 assembly programs
    if (dx < 0) basic.pulseJoystickBit(2);
    else if (dx > 0) basic.pulseJoystickBit(3);
    else if (dz < 0) basic.pulseJoystickBit(0);
    else if (dz > 0) basic.pulseJoystickBit(1);
    if (basic.running) {
      if (dx < 0) basic.handleKey('a', false, false);
      else if (dx > 0) basic.handleKey('d', false, false);
      else if (dz < 0) basic.handleKey('w', false, false);
      else if (dz > 0) basic.handleKey('s', false, false);
    }
  } else if (hit.kind === 'joystick-fire') {
    tac2.pressFire(false);
    sound.playJoystickClick(true);
    basic.pulseJoystickBit(4);
    if (basic.running) {
      basic.handleKey(' ', false, false);
    }
  } else if (hit.kind === 'paper') {
    setPaperOpen(paperViewEl.hidden);
  } else if (hit.kind === 'wallpaper') {
    if (!wasTouchKbdFocused) {
      swedishRoom.cycleWallpaper();
    }
  } else if (hit.kind === 'screen') {
    if (e.pointerType === 'touch') {
      lastTouchTapOpensKbd = true;
      openMobileKeyboard();
    }
  }
});

canvas.addEventListener('dblclick', (e) => {
  const hit = pickScene(e.clientX, e.clientY);
  if (hit?.kind === 'screen') {
    setFocused(!focusedMode);
  }
});

crtFsEl.addEventListener('dblclick', () => {
  setFocused(false);
});

crtFsEl.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (e.pointerType === 'touch') {
    openMobileKeyboard();
  }
});

// ---- Cheat Paper Overlay ----
function setPaperOpen(open: boolean) {
  if (open && !paperImgReady) {
    paperImgReady = true;
    paperImgEl.src = deskPaper.canvas.toDataURL('image/png');
  }
  paperViewEl.hidden = !open;
  deskPaper.root.visible = !open;
  btnPaper.setAttribute('aria-pressed', String(open));
  sound.playPageFlip();
}

paperCloseBtn.addEventListener('click', () => {
  setPaperOpen(false);
  paperCloseBtn.blur();
});

// ---- Keyboard & Clipboard Wiring ----
function copyProgramToClipboard() {
  const listing = basic.exportListing();
  if (!listing) {
    showToast('No program to copy');
    return;
  }
  const lineCount = listing.split('\n').length;
  navigator.clipboard?.writeText(listing).then(
    () => showToast(`Copied ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`),
    () => showToast('Clipboard unavailable'),
  );
}

window.addEventListener('copy', (e) => {
  const sel = window.getSelection()?.toString();
  if (sel) return; // let normal text selection copy if any
  const listing = basic.exportListing();
  if (!listing) return;
  e.preventDefault();
  e.clipboardData?.setData('text/plain', listing);
  const lineCount = listing.split('\n').length;
  showToast(`Copied ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`);
});

let lastPasteAt = 0;

function applyPastedText(text: string) {
  if (!text) return;
  lastPasteAt = performance.now();
  const count = basic.pasteText(text);
  if (count > 0) {
    sound.playKey('Enter');
    if (count > 1) showToast(`Pasted ${count} lines`);
  }
}

window.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text/plain');
  if (!text) return;
  e.preventDefault();
  applyPastedText(text);
});

window.addEventListener('keydown', (e) => {
  sound.unlock();
  // Cmd+C (macOS) or Ctrl+Shift+C: copy whole BASIC program listing
  if ((e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'c') ||
      (e.ctrlKey && e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'c')) {
    e.preventDefault();
    copyProgramToClipboard();
    return;
  }

  // Cmd+V / Ctrl+V: let native 'paste' fire, with clipboard API fallback if body ignores paste
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'v') {
    const triggeredAt = performance.now();
    window.setTimeout(() => {
      if (lastPasteAt >= triggeredAt) return;
      navigator.clipboard?.readText().then(applyPastedText).catch(() => {});
    }, 35);
    return;
  }

  // Let other browser shortcuts pass through (Cmd+R reloads, Cmd+L focuses address bar, etc.)
  if (e.metaKey) return;
  if (document.activeElement === touchInput) {
    if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Escape') {
      e.preventDefault();
      fireTouchSpecialKey(e.key);
      resetTouchSentinel();
    }
    return;
  }

  // Only close the cheat paper on Escape if no BASIC program is currently running
  if (e.key === 'Escape' && !basic.running && !paperViewEl.hidden) {
    setPaperOpen(false);
    e.preventDefault();
    return;
  }

  if (
    e.key === ' ' ||
    e.key === 'Backspace' ||
    e.key === 'Enter' ||
    e.key === 'Escape' ||
    e.key === 'Home' ||
    (!e.altKey && e.key.startsWith('Arrow')) ||
    (e.ctrlKey && (e.key === 'l' || e.key === 'L' || e.key === 'c' || e.key === 'C'))
  ) {
    e.preventDefault();
  }

  if (document.activeElement instanceof HTMLButtonElement) {
    document.activeElement.blur();
  }

  if (e.key === 'F1' || e.key === 'F3' || e.key === 'F5' || e.key === 'F7') {
    e.preventDefault();
  }
  basic.setMatrixKey(e.key, true);

  const handled = basic.handleKey(e.key, e.ctrlKey, e.metaKey);
  c64.triggerKey(e.key);
  const activeRun = basic.running || basic.cpuRunning;
  if (e.key === 'ArrowLeft' || (activeRun && e.key.toLowerCase() === 'a')) {
    tac2.nudge(-1, 0);
    basic.setJoystickBit(2, true);
  } else if (e.key === 'ArrowRight' || (activeRun && e.key.toLowerCase() === 'd')) {
    tac2.nudge(1, 0);
    basic.setJoystickBit(3, true);
  } else if (e.key === 'ArrowUp' || (activeRun && e.key.toLowerCase() === 'w')) {
    tac2.nudge(0, -1);
    basic.setJoystickBit(0, true);
  } else if (e.key === 'ArrowDown' || (activeRun && e.key.toLowerCase() === 's')) {
    tac2.nudge(0, 1);
    basic.setJoystickBit(1, true);
  } else if (e.key === ' ' && activeRun) {
    tac2.pressFire(false);
    basic.setJoystickBit(4, true);
  }
  if (handled) {
    sound.playKey(e.key);
  }
});

window.addEventListener('keyup', (e) => {
  basic.setMatrixKey(e.key, false);
  const k = e.key.toLowerCase();
  if (e.key === 'ArrowUp' || k === 'w') basic.setJoystickBit(0, false);
  else if (e.key === 'ArrowDown' || k === 's') basic.setJoystickBit(1, false);
  else if (e.key === 'ArrowLeft' || k === 'a') basic.setJoystickBit(2, false);
  else if (e.key === 'ArrowRight' || k === 'd') basic.setJoystickBit(3, false);
  else if (e.key === ' ') basic.setJoystickBit(4, false);
});

window.addEventListener('blur', () => {
  basic.clearMatrixKeys();
  for (let b = 0; b < 5; b++) basic.setJoystickBit(b, false);
});

// ---- Native iOS / Android Virtual Keyboard Bridge ----
// Keep a 1-space sentinel inside #touch-kbd so iOS & Android Backspace always emits an input event.
const KBD_SENTINEL = ' ';
let lastTouchSpecialAt = 0;

function resetTouchSentinel() {
  touchInput.value = KBD_SENTINEL;
  try {
    touchInput.setSelectionRange(1, 1);
  } catch {
    // Ignore browsers that disallow selection changes on hidden inputs
  }
}

function openMobileKeyboard() {
  resetTouchSentinel();
  touchInput.focus({ preventScroll: true });
  try {
    touchInput.setSelectionRange(1, 1);
  } catch {
    // Ignore
  }
}

function fireTouchSpecialKey(key: 'Enter' | 'Backspace' | 'Escape') {
  const now = performance.now();
  if (now - lastTouchSpecialAt < 25) return;
  lastTouchSpecialAt = now;
  c64.triggerKey(key);
  if (basic.handleKey(key, false, false)) {
    sound.playKey(key);
  }
}

touchInput.addEventListener('focus', () => {
  mobileKbdOpen = true;
  resetTouchSentinel();
  btnEsc.hidden = false;
  syncVisualViewport();
  computePreset(focusedMode);
});

touchInput.addEventListener('blur', () => {
  mobileKbdOpen = false;
  btnEsc.hidden = true;
  document.documentElement.style.setProperty('--vv-bottom', `${window.innerHeight}px`);
  computePreset(focusedMode);
});

touchInput.addEventListener('beforeinput', (e) => {
  if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
    e.preventDefault();
    fireTouchSpecialKey('Enter');
    resetTouchSentinel();
  } else if (e.inputType === 'deleteContentBackward') {
    e.preventDefault();
    fireTouchSpecialKey('Backspace');
    resetTouchSentinel();
  }
});

touchInput.addEventListener('input', () => {
  const val = touchInput.value;
  if (val.length === 0) {
    // Sentinel deleted -> Backspace on iOS/Android
    fireTouchSpecialKey('Backspace');
    resetTouchSentinel();
    return;
  }
  // Strip leading/trailing sentinel space so actual typed characters pass through cleanly
  const typed = val.startsWith(KBD_SENTINEL) ? val.slice(1) : val.endsWith(KBD_SENTINEL) ? val.slice(0, -1) : val;
  if (typed.length > 0) {
    for (const ch of typed) {
      if (ch === '\n' || ch === '\r') {
        fireTouchSpecialKey('Enter');
      } else {
        c64.triggerKey(ch);
        if (basic.handleKey(ch, false, false)) {
          sound.playKey(ch);
        }
      }
    }
  }
  resetTouchSentinel();
});

btnEsc.addEventListener('pointerdown', (e) => {
  // Prevent blur so tapping ESC · STOP breaks the BASIC loop without dismissing the iOS keyboard
  e.preventDefault();
  sound.unlock();
  fireTouchSpecialKey('Escape');
});

function syncVisualViewport() {
  const vv = window.visualViewport;
  const vvBottom = vv ? Math.round(vv.offsetTop + vv.height) : window.innerHeight;
  document.documentElement.style.setProperty('--vv-bottom', `${vvBottom}px`);
  computePreset(focusedMode);
}
window.visualViewport?.addEventListener('resize', syncVisualViewport);
window.visualViewport?.addEventListener('scroll', syncVisualViewport);

// ---- Fullscreen C64 Blue Screen Sync ----
let lastFsBorder = -1;
function syncFullscreenScreen(force = false) {
  if (!focusedMode && !force) return;
  crtFsCtx.drawImage(screen.canvas, 0, 0);
  if (force || screen.borderColor !== lastFsBorder) {
    lastFsBorder = screen.borderColor;
    const [r, g, b] = C64_PALETTE_RGB[screen.borderColor];
    crtFsEl.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
  }
}

// ---- Top-right Controls ----
function setFocused(on: boolean) {
  focusedMode = on;
  btnFocus.setAttribute('aria-pressed', String(on));
  crtFsEl.classList.toggle('open', on);
  crtFsEl.setAttribute('aria-hidden', String(!on));
  if (on) syncFullscreenScreen(true);
  computePreset(on);
}

btnFocus.addEventListener('click', () => {
  setFocused(!focusedMode);
  btnFocus.blur();
});

btnSound.addEventListener('click', () => {
  const next = !sound.enabled;
  sound.setEnabled(next);
  btnSound.setAttribute('aria-pressed', String(next));
  btnSound.blur();
});

btnPaper.addEventListener('click', () => {
  setPaperOpen(paperViewEl.hidden);
  btnPaper.blur();
});

// ---- Resize & Tab Visibility ----
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio, 2);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);
  filmGrade.resize(w, h, dpr);
  canvasRect = canvas.getBoundingClientRect();
  computePreset(focusedMode);
}
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  sound.setPageVisible(!document.hidden);
});

// ---- Main Loop ----
let lastTime = performance.now();
const startTime = lastTime;

function animate(now: number) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const elapsed = (now - startTime) / 1000;

  basic.step(18, dt);
  screen.tick(dt);
  if (screen.render()) {
    monitor.markScreenDirty();
    syncFullscreenScreen(false);
  }

  monitor.update(dt, elapsed, screen.getScreenGlowColor());
  drive.update(dt, elapsed);
  deskLamp.update(dt);
  deskPaper.update(dt);
  bicPen.update(dt);
  wallClock.update();
  c64.update(dt);
  tac2.update(dt);
  fireworks.update(dt);

  // Smoothly dim room fill down to CRT-lit late-night mode when the orange lamp is clicked off
  const targetLamp = deskLamp.lit ? 1.0 : 0.0;
  roomLampLevel += (targetLamp - roomLampLevel) * Math.min(1, dt * 14);
  keyLight.intensity = 0.16 + roomLampLevel * 1.28;
  fillLight.intensity = 0.08 + roomLampLevel * 0.30;
  hemi.intensity = 0.12 + roomLampLevel * 0.22;

  // Subtle, calm pointer parallax around the desk view (suspended during fullscreen CRT & mobile typing zoom)
  const pk = Math.min(1, dt * 3.4);
  const pTargetX = focusedMode || mobileKbdOpen ? 0 : parallaxTarget.x;
  const pTargetY = focusedMode || mobileKbdOpen ? 0 : parallaxTarget.y;
  parallax.x += (pTargetX - parallax.x) * pk;
  parallax.y += (pTargetY - parallax.y) * pk;

  desiredPos.set(
    camGoalPos.x + parallax.x * 0.24,
    camGoalPos.y - parallax.y * 0.10,
    camGoalPos.z - Math.abs(parallax.x) * 0.02,
  );
  desiredTarget.set(
    camGoalTarget.x + parallax.x * 0.05,
    camGoalTarget.y - parallax.y * 0.03,
    camGoalTarget.z,
  );

  const ck = Math.min(1, dt * 6.5);
  camCurPos.lerp(desiredPos, ck);
  camCurTarget.lerp(desiredTarget, ck);
  camera.position.copy(camCurPos);
  camera.lookAt(camCurTarget);

  filmGrade.render(renderer, scene, camera, elapsed);
}

screen.render();
monitor.markScreenDirty();
requestAnimationFrame(animate);
