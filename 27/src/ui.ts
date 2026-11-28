// The page furniture of day 27, over the scene: the controls shown at the start (a key map on a desktop, the
// headphones card on a phone), the help top right that brings them back, and the pointer lock bottom centre.
// The scene's own input stays in main.ts: this file only draws, opens and closes, and asks for the lock.

import * as THREE from 'three';
import { eggGeometry } from './game';

const svg = (w: number, h: number, box: string, body: string) =>
  `<svg width="${w}" height="${h}" viewBox="${box}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// a mouse, with the way it is moved to look about drawn either side of it
const MOUSE = svg(44, 47, '0 0 44 47', '<rect x="12" y="6" width="20" height="36" rx="10" /><path d="M22 12v6" /><path d="M6.5 20l-4 4 4 4M37.5 20l4 4-4 4" />');

// only what is needed to set off: the keys move, the mouse looks, R looks over the shoulder. The rest is found by doing
const KEYMAP = `
  <div class="row">
    <figure>
      <div class="clusters"><span class="cluster"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></div>
      <figcaption>Move</figcaption>
    </figure>
    <figure>
      <div class="clusters"><span class="cluster one"><kbd>R</kbd></span></div>
      <figcaption>Look back if followed</figcaption>
    </figure>
    <figure>${MOUSE}<figcaption>Look around</figcaption></figure>
  </div>`;

// the headphones of day 14's card
const HEADPHONES =
  '<svg width="72" height="72" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 13.6V11.6a7.5 7.5 0 0 1 15 0v2" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round"/><g fill="currentColor"><rect x="3" y="13.2" width="3.1" height="6.6" rx="1.55"/><rect x="5.2" y="12.4" width="2.7" height="8.6" rx="1.35"/><rect x="17.9" y="13.2" width="3.1" height="6.6" rx="1.55"/><rect x="16.1" y="12.4" width="2.7" height="8.6" rx="1.35"/></g></svg>';

const CARD = `
  ${HEADPHONES}
  <b>Headphones recommended</b><i lang="ja">ヘッドホン推奨</i>
  <ul>
    <li>${svg(28, 20, '0 0 28 20', '<circle cx="14" cy="10" r="3.5" fill="currentColor" stroke="none" /><path d="M6 6.5 2.5 10 6 13.5M22 6.5l3.5 3.5-3.5 3.5" />')}Drag to look</li>
    <li>${svg(28, 20, '0 0 28 20', '<circle cx="14" cy="10" r="3.5" fill="currentColor" stroke="none" /><circle cx="14" cy="10" r="8" />')}Hold to run</li>
  </ul>
  <em></em>`;

/**
 * Wires the furniture that index.html lays out. `start`: show the controls now (not for a clip that crawls by itself
 * or starts somewhere else). ?clean shows none of it; ?touch gives a desktop the phone's furniture, for screenshots.
 */
export function initUI(canvas: HTMLCanvasElement, opts: { start: boolean; sound?: (on: boolean) => void }) {
  const params = new URLSearchParams(location.search);
  const touch = params.has('touch') || matchMedia('(pointer: coarse)').matches;
  document.body.classList.toggle('touch', touch);

  const veil = document.querySelector<HTMLElement>('.veil')!;
  const help = document.querySelector<HTMLButtonElement>('.help')!;
  const pill = document.querySelector<HTMLButtonElement>('.lockpill')!;
  veil.innerHTML = touch ? `<div class="card">${CARD}</div>` : `<div class="keymap">${KEYMAP}</div>`;
  const foot = veil.querySelector('em');

  let open = false;
  const show = (on: boolean, first = false) => {
    open = on;
    if (on && foot) foot.textContent = first ? 'Tap to begin' : 'Tap to close';
    veil.classList.toggle('open', on);
    help.classList.toggle('on', on);
    help.setAttribute('aria-expanded', String(on));
  };
  help.addEventListener('click', () => { show(!open); help.blur(); });

  // the whole screen (and with it the plate goes: body.fullscreen). Not everywhere: an iPhone has none to give
  const full = document.querySelector<HTMLButtonElement>('.full')!;
  type FS = { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void; webkitFullscreenEnabled?: boolean };
  type FSEl = { webkitRequestFullscreen?: () => void };
  const doc = document as Document & FS, root = document.documentElement as HTMLElement & FSEl;
  const isFull = () => !!(document.fullscreenElement ?? doc.webkitFullscreenElement);
  const corners = (d: string) => svg(16, 16, '0 0 16 16', `<path d="${d}" />`);
  const paint = () => {
    const on = isFull();
    document.body.classList.toggle('fullscreen', on);
    full.classList.toggle('on', on);
    full.setAttribute('aria-pressed', String(on));
    // corners opening out, or drawn back in
    full.innerHTML = corners(on ? 'M6 2.5V6H2.5M10 2.5V6h3.5M13.5 10H10v3.5M6 13.5V10H2.5' : 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10');
  };
  if (!(document.fullscreenEnabled || doc.webkitFullscreenEnabled)) document.body.classList.add('nofull');
  full.addEventListener('click', () => {
    full.blur();
    try {
      if (isFull()) (document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document);
      else (root.requestFullscreen ?? root.webkitRequestFullscreen)?.call(root);
    } catch { /* refused: nothing changes */ }
  });
  document.addEventListener('fullscreenchange', paint);
  document.addEventListener('webkitfullscreenchange', paint);
  paint();

  // sound on or off, remembered from one visit to the next (the engine is told; it keeps no memory of its own)
  const snd = document.querySelector<HTMLButtonElement>('.snd')!;
  if (params.has('mute')) document.body.classList.add('nosound');
  let heard = true;
  try { heard = localStorage.getItem('burrow-sound') !== 'off'; } catch { /* no storage: sound on */ }
  const speaker = '<path d="M2.5 6.2h2.3L8 3.4v9.2L4.8 9.8H2.5z" />';
  const voice = () => {
    snd.classList.toggle('off', !heard);
    snd.setAttribute('aria-pressed', String(heard));
    snd.innerHTML = svg(16, 16, '0 0 16 16', speaker + (heard ? '<path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.3 3.8a6 6 0 0 1 0 8.4" />' : '<path d="M10.6 6 14 9.4M14 6l-3.4 3.4" />'));
    opts.sound?.(heard);
  };
  snd.addEventListener('click', () => {
    snd.blur();
    heard = !heard;
    try { localStorage.setItem('burrow-sound', heard ? 'on' : 'off'); } catch { /* not remembered then */ }
    voice();
  });
  voice();

  if (touch) {
    // a phone: the card takes the tap that sends it away, so that tap is not also a dash into the hole
    veil.addEventListener('click', () => show(false));
  } else {
    // a desktop: the first press, key or scroll sends the map away. A key or the wheel is already the scene's own; a
    // click is not: the first click only says "I am here" (focus, and the sound's leave to start), and nobody sets
    // off at a run from it. main.ts asks firstPress() before it takes a press on the canvas
    const away = (ev: Event) => {
      if (!open || (ev.target as Element).closest?.('.help, .full, .snd')) return;
      show(false);
      if (ev.type === 'pointerdown') swallow = true;
    };
    addEventListener('pointerdown', away, true);
    addEventListener('pointerup', () => { swallow = false; }, true);
    addEventListener('keydown', away, true);
    addEventListener('wheel', away, { capture: true, passive: true });
  }

  // the pointer lock: the mouse itself is the look, no drag (main.ts reads document.pointerLockElement). Esc lets go
  const locked = () => document.pointerLockElement === canvas;
  pill.addEventListener('click', () => {
    pill.blur();
    // (a browser may refuse, e.g. straight after an Esc: then nothing happens and the pill is still there)
    try { (canvas.requestPointerLock() as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* no pointer lock here */ }
  });
  let lastId = -1;
  canvas.addEventListener('pointerdown', (ev) => { lastId = ev.pointerId; });
  document.addEventListener('pointerlockchange', () => {
    document.body.classList.toggle('locked', locked());
    // a button still held when Esc let the pointer go comes up over the pill, not the canvas: let it up here
    if (!locked() && lastId >= 0) canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: lastId }));
  });

  if (opts.start && !params.has('clean')) show(true, true);
}

/** The press that sent the start screen away is not also a press on the scene: true once, for that one. */
let swallow = false;
export function firstPress(): boolean {
  const s = swallow;
  swallow = false;
  return s;
}

/** A line at the foot of the view, for a few seconds: the little the game has to say. */
let note: HTMLElement | undefined, noteT = 0;
export function say(text: string, seconds = 4.5) {
  if (!note) {
    note = document.createElement('p');
    note.className = 'note';
    document.body.append(note);
  }
  note.textContent = text;
  note.classList.add('on');
  clearTimeout(noteT);
  noteT = window.setTimeout(() => note!.classList.remove('on'), seconds * 1000);
}

/** freckles for the egg of the last screen: painted, since out here it is not in the scene's light any more */
function eggSkin(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9d0b8';
  g.fillRect(0, 0, 512, 512);
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  // a cloudy mottle under everything
  for (let i = 0; i < 260; i++) {
    const r = 18 + rnd() * 46, tone = rnd();
    g.fillStyle = tone < 0.5 ? `rgba(160, 146, 116, ${0.05 + rnd() * 0.06})` : `rgba(240, 234, 214, ${0.05 + rnd() * 0.06})`;
    g.beginPath(); g.arc(rnd() * 512, rnd() * 512, r, 0, 7); g.fill();
  }
  // and the freckles, thickest round the blunt end (the bottom of the picture)
  for (let i = 0; i < 520; i++) {
    const y = 512 * (1 - rnd() * rnd()), r = 1.2 + rnd() * rnd() * 5.5;
    g.fillStyle = `rgba(${70 + rnd() * 30}, ${44 + rnd() * 20}, ${26 + rnd() * 14}, ${0.35 + rnd() * 0.5})`;
    g.beginPath(); g.ellipse(rnd() * 512, y, r * (0.7 + rnd() * 0.8), r, rnd() * 3, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/**
 * The end: everything fades to the dark, and what is left is the egg, turning slowly in a light of its own, a thought,
 * and well done. (Its own small renderer: the burrow's is stopped behind it.)
 */
export function showWin() {
  const el = document.createElement('div');
  el.className = 'win';
  el.innerHTML = `
    <canvas width="640" height="640"></canvas>
    <p class="thought">Whatever hatches, it will remember the dark better than you do.</p>
    <p class="congrats">Congratulations &middot; you got out with the egg</p>
    <button class="again" type="button">Go back in</button>`;
  document.body.append(el);
  el.querySelector('.again')!.addEventListener('click', () => location.reload());
  document.exitPointerLock?.();

  const canvas = el.querySelector('canvas')!;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(640, 640, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 5);
  camera.position.set(0, 0.004, 0.25);
  const skin = eggSkin();
  const egg = new THREE.Mesh(eggGeometry(), new THREE.MeshStandardMaterial({ map: skin, bumpMap: skin, bumpScale: 0.6, roughness: 0.5, metalness: 0 }));
  egg.rotation.z = 0.32;
  scene.add(egg);
  // one warm lamp from over the left shoulder, a cold edge from behind, hardly any fill: it is still half in the dark
  const key = new THREE.DirectionalLight(new THREE.Color(1, 0.86, 0.66), 3.4);
  key.position.set(-1, 1.1, 1.3);
  const rim = new THREE.DirectionalLight(new THREE.Color(0.6, 0.72, 1), 1.5);
  rim.position.set(1.3, 0.5, -1.4);
  scene.add(key, rim, new THREE.HemisphereLight(new THREE.Color(0.5, 0.48, 0.44), new THREE.Color(0.06, 0.04, 0.03), 0.35));
  const t0 = performance.now();
  const frame = (now: number) => {
    const t = (now - t0) / 1000;
    egg.rotation.y = t * 0.35;
    egg.position.y = 0.0015 * Math.sin(t * 0.9);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // (a frame for the element to exist in before it is asked to fade)
  requestAnimationFrame(() => el.classList.add('on'));
}
