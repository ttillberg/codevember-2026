// ?debug: a soundboard to try the sounds one by one. Every sound on a button (the birds, the ground's, the loud
// cracks, your body, the throws and the fungi's creaks), where it comes from (any side, or left, right, ahead,
// behind, so far off), the levels of each part, and switches for what plays by itself, to hear one thing alone.
import { debugStack } from './debugStack';
import * as THREE from 'three';
import { BIRDS, GROUND_KINDS, LOUD_KINDS, type Forest } from './forest';
import type { Sound } from './sound';

const FUNGI = ['funnel', 'finger', 'chanterelle', 'puffball', 'agaric', 'porcini', 'slippery', 'morel', 'waxcap'];
const NAMES: Record<string, string> = {
  robin: 'rödhake', goldcrest: 'kungsfågel', wren: 'gärdsmyg', greatTit: 'talgoxe', blackbird: 'koltrast', woodpecker: 'hackspett',
  owl: 'kattuggla', cuckoo: 'gök', nightingale: 'näktergal', crackle: 'knaster', rustle: 'prassel',
  twig: 'kvist', crack: 'gren knäcks',
  funnel: 'trattkantarell', finger: 'korallsvamp', chanterelle: 'kantarell', puffball: 'röksvamp', agaric: 'flugsvamp', porcini: 'karljohan',
  slippery: 'smörsopp', morel: 'toppmurkla', waxcap: 'sotvaxskivling',
};

const CSS = `
.soundboard { flex: none; padding: 10px 12px 12px; box-sizing: border-box; border-radius: 10px; background: rgba(14, 12, 8, 0.82);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: inset 0 0 0 1px rgba(244, 244, 242, 0.18);
  color: #f4f4f2; font: 500 11px/1.3 Inter, "Helvetica Neue", Helvetica, Arial, sans-serif; user-select: none; }
.soundboard.folded > :not(header) { display: none !important; }
.soundboard header { display: flex; justify-content: space-between; align-items: center; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
.soundboard h4 { margin: 10px 0 5px; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.55; }
.soundboard .row { display: flex; flex-wrap: wrap; gap: 4px; }
.soundboard button { padding: 4px 7px; border: 0; border-radius: 5px; background: rgba(244, 244, 242, 0.1); color: inherit; font: inherit; cursor: pointer; }
.soundboard button:hover { background: rgba(244, 244, 242, 0.2); }
.soundboard button:active { background: rgba(255, 200, 120, 0.45); }
.soundboard label { display: grid; grid-template-columns: 62px 1fr 34px; align-items: center; gap: 6px; margin: 3px 0; }
.soundboard label.check { display: inline-flex; gap: 4px; margin-right: 10px; }
.soundboard input[type=range] { width: 100%; accent-color: #e8b26a; }
.soundboard select { background: rgba(244, 244, 242, 0.1); color: inherit; border: 0; border-radius: 5px; font: inherit; padding: 3px; }
.soundboard output { text-align: right; opacity: 0.7; font-variant-numeric: tabular-nums; }
`;

export function soundboard(forest: Forest, sound: Sound, camera: THREE.Camera) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const el = document.createElement('div');
  el.className = 'soundboard';
  // keep its clicks and keys to itself: not a throw, not a crawl
  for (const ev of ['pointerdown', 'pointerup', 'keydown', 'wheel']) el.addEventListener(ev, (e) => e.stopPropagation());
  el.classList.add('folded'); // folded to its header to begin with: the look panel is the one in use
  debugStack().append(el);

  function add<T extends HTMLElement = HTMLElement>(parent: HTMLElement, tag: string, props: object = {}): T {
    const n = Object.assign(document.createElement(tag), props) as T;
    parent.append(n);
    return n;
  }
  const head = add(el, 'header');
  add(head, 'span', { textContent: 'Soundboard' });
  const fold = add(head, 'button', { textContent: '+' });
  fold.onclick = () => { el.classList.toggle('folded'); fold.textContent = el.classList.contains('folded') ? '+' : '–'; };

  // where it comes from
  add(el, 'h4', { textContent: 'Var' });
  const where = add(el, 'label');
  add(where, 'span', { textContent: 'riktning' });
  const dir = add<HTMLSelectElement>(where, 'select');
  for (const [v, t] of [['', 'slump'], ['left', 'vänster'], ['right', 'höger'], ['ahead', 'framför'], ['behind', 'bakom']]) add(dir, 'option', { value: v, textContent: t });
  add(where, 'span');
  const far = slider(el, 'avstånd m', 2, 90, 1, 15, () => {});
  const at = () => {
    if (!dir.value) return undefined;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).setY(0).normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const v = { left: r.clone().negate(), right: r, ahead: f, behind: f.clone().negate() }[dir.value as 'left']!;
    return camera.position.clone().addScaledVector(v, far()).add(new THREE.Vector3(0, far() > 20 ? 6 : 1, 0));
  };

  const buttons = (title: string, kinds: string[], go: (k: string) => void) => {
    add(el, 'h4', { textContent: title });
    const row = add(el, 'div', { className: 'row' });
    for (const k of kinds) add(row, 'button', { textContent: NAMES[k] ?? k, onclick: () => go(k) });
  };
  buttons('Fåglar', BIRDS, (k) => forest.call(k, at()));
  buttons('Marken', GROUND_KINDS, (k) => forest.call(k, at()));
  buttons('Högt', LOUD_KINDS, (k) => forest.call(k, at()));
  add(el, 'h4', { textContent: 'Kroppen' });
  const body = add(el, 'div', { className: 'row' });
  let left = true;
  add(body, 'button', { textContent: 'steg', onclick: () => { forest.step(0.9, 0, left); left = !left; } });
  add(body, 'button', { textContent: 'steg hukad', onclick: () => { forest.step(0.9, 1, left); left = !left; } });
  add(body, 'button', { textContent: 'steg pöl', onclick: () => { forest.step(0.9, 0, left, 1); left = !left; } });
  add(body, 'button', { textContent: 'landning', onclick: () => { forest.step(1.6, 0, true); forest.step(1.2, 0, false); } });
  add(body, 'button', { textContent: 'landning pöl', onclick: () => { forest.step(1.6, 0, true, 1); forest.step(1.2, 0, false, 1); } });
  add(body, 'button', { textContent: 'andas in', onclick: () => forest.breathe(true, 1) });
  add(body, 'button', { textContent: 'andas ut', onclick: () => forest.breathe(false, 1) });
  add(el, 'h4', { textContent: 'Kast' });
  const ahead = () => camera.position.clone().add(new THREE.Vector3(0, -0.06, -0.5).applyQuaternion(camera.quaternion));
  const throws = add(el, 'div', { className: 'row' });
  add(throws, 'button', { textContent: 'sus', onclick: () => sound.whoosh(1) });
  add(throws, 'button', { textContent: 'puff', onclick: () => sound.puff(ahead(), 1) });
  add(throws, 'button', { textContent: 'puff liten', onclick: () => sound.puff(ahead(), 0.45) });
  add(throws, 'button', { textContent: 'plask', onclick: () => sound.plop(ahead(), 1) });
  buttons('Svampar knarrar', FUNGI, (k) => sound.creak(ahead(), k));

  // the levels
  add(el, 'h4', { textContent: 'Nivåer' });
  slider(el, 'master', 0, 1.5, 0.01, sound.out?.gain.value ?? 0.7, (v) => { if (sound.out) sound.out.gain.value = v; });
  for (const k of ['wind', 'birds', 'ground', 'loud', 'body', 'wet'] as const) {
    slider(el, { wind: 'vind', birds: 'fåglar', ground: 'mark', loud: 'knäck', body: 'kropp', wet: 'eko' }[k], 0, k === 'birds' ? 2 : 3, 0.01, forest.levels[k], (v) => { forest.levels[k] = v; forest.apply(); });
  }
  add(el, 'h4', { textContent: 'Spelar av sig själv' });
  for (const k of ['birds', 'ground', 'loud'] as const) {
    const l = add(el, 'label', { className: 'check' });
    const c = add<HTMLInputElement>(l, 'input', { type: 'checkbox', checked: forest.auto[k] });
    c.onchange = () => { forest.auto[k] = c.checked; };
    add(l, 'span', { textContent: { birds: 'fåglar', ground: 'mark', loud: 'knäck' }[k] });
  }

  function slider(parent: HTMLElement, name: string, min: number, max: number, step: number, value: number, set: (v: number) => void) {
    const l = add(parent, 'label');
    add(l, 'span', { textContent: name });
    const r = add<HTMLInputElement>(l, 'input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
    const o = add(l, 'output', { textContent: String(value) });
    r.oninput = () => { o.textContent = r.value; set(+r.value); };
    return () => +r.value;
  }
}
