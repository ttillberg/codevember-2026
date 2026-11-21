// ?debug: the look panel, to tune the picture by eye beside the reference (stacked over the soundboard). Three parts: the colour grade (the lens
// pass's last step), the depth of field (aperture, blur, and the focus held by hand instead of the autofocus), and
// the light and the air (the sun's height, live, the beams, the mist, the haze, the screen-space shafts). Every
// slider starts at the value the page has; Copy puts them all on the clipboard as JSON, to bake in as defaults.
import type * as THREE from 'three';
import { debugStack } from './debugStack';

const CSS = `
.lookboard { flex: none; padding: 10px 12px 12px; box-sizing: border-box; border-radius: 10px; background: rgba(14, 12, 8, 0.82);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: inset 0 0 0 1px rgba(244, 244, 242, 0.18);
  color: #f4f4f2; font: 500 11px/1.3 Inter, "Helvetica Neue", Helvetica, Arial, sans-serif; user-select: none; }
.lookboard.folded > :not(header) { display: none !important; }
.lookboard header { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
.lookboard header span { flex: 1; }
.lookboard h4 { margin: 10px 0 5px; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.55; }
.lookboard button { padding: 4px 7px; border: 0; border-radius: 5px; background: rgba(244, 244, 242, 0.1); color: inherit; font: inherit; cursor: pointer; }
.lookboard button:hover { background: rgba(244, 244, 242, 0.2); }
.lookboard label { display: grid; grid-template-columns: 78px 1fr 38px; align-items: center; gap: 6px; margin: 3px 0; }
.lookboard label.check { display: flex; gap: 6px; }
.lookboard input[type=range] { width: 100%; accent-color: #e8b26a; }
.lookboard output { text-align: right; opacity: 0.7; font-variant-numeric: tabular-nums; }
`;

type U = { value: number };
export interface LookTargets {
  lens: THREE.ShaderMaterial; // the lens pass: the grade and the depth of field
  atmos: THREE.ShaderMaterial; // the haze pass: beams, mist, haze, shafts
  focus: { hold: boolean; at: number }; // the autofocus, held by hand
  sun: { deg: number; set(deg: number): void }; // the sun's height
  canopy: { canvas: HTMLCanvasElement; box: THREE.Vector3; camera: THREE.Camera; light: THREE.Vector3 }; // the crowns' shade map
}

export function lookboard(t: LookTargets) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const el = document.createElement('div');
  el.className = 'lookboard';
  for (const ev of ['pointerdown', 'pointerup', 'keydown', 'wheel']) el.addEventListener(ev, (e) => e.stopPropagation());
  debugStack().prepend(el); // above the soundboard
  const add = <T extends HTMLElement = HTMLElement>(parent: HTMLElement, tag: string, props: object = {}): T => {
    const n = Object.assign(document.createElement(tag), props) as T;
    parent.append(n);
    return n;
  };
  const values: Record<string, number | boolean> = {};

  const head = add(el, 'header');
  add(head, 'span', { textContent: 'Look' });
  const copy = add(head, 'button', { textContent: 'Copy' });
  copy.onclick = () => {
    navigator.clipboard?.writeText(JSON.stringify(values, null, 1)).catch(() => {});
    copy.textContent = 'Copied';
    setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
  };
  const fold = add(head, 'button', { textContent: '–' });
  fold.onclick = () => { el.classList.toggle('folded'); fold.textContent = el.classList.contains('folded') ? '+' : '–'; };

  /** a slider on a uniform (or anything with a value) */
  function slider(name: string, key: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number) {
    const l = add(el, 'label');
    add(l, 'span', { textContent: name });
    const v0 = get();
    const r = add<HTMLInputElement>(l, 'input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(v0) });
    const o = add(l, 'output', { textContent: String(+v0.toFixed(3)) });
    values[key] = v0;
    r.oninput = () => { const v = +r.value; o.textContent = String(v); set(v); values[key] = v; };
  }
  const uni = (name: string, m: THREE.ShaderMaterial, u: string, min: number, max: number, step: number) =>
    slider(name, u, () => (m.uniforms[u] as U).value, (v) => { (m.uniforms[u] as U).value = v; }, min, max, step);

  add(el, 'h4', { textContent: 'Colour grade' });
  uni('exposure', t.lens, 'uBright', 0.4, 2, 0.01);
  uni('saturation', t.lens, 'uSat', 0, 2, 0.01);
  uni('contrast', t.lens, 'uContrast', 0, 1.5, 0.01);
  uni('olive greens', t.lens, 'uGreen', 0, 1, 0.01);
  uni('amber mids', t.lens, 'uWarm', 0, 1, 0.01);
  uni('split tone', t.lens, 'uSplit', 0, 2, 0.01);
  uni('lift blacks', t.lens, 'uLift', 0, 6, 0.05);
  uni('vignette', t.lens, 'uVignette', 0, 1, 0.01);

  add(el, 'h4', { textContent: 'Depth of field' });
  uni('aperture', t.lens, 'uAperture', 0, 3, 0.01);
  uni('max blur px', t.lens, 'uMaxBlur', 0, 40, 0.5);
  const hl = add(el, 'label', { className: 'check' });
  const hc = add<HTMLInputElement>(hl, 'input', { type: 'checkbox', checked: t.focus.hold });
  add(hl, 'span', { textContent: 'hold focus (no autofocus)' });
  values.focusHold = t.focus.hold;
  hc.onchange = () => { t.focus.hold = hc.checked; values.focusHold = hc.checked; };
  slider('focus m', 'focusAt', () => t.focus.at, (v) => { t.focus.at = v; }, 0.1, 30, 0.05);

  add(el, 'h4', { textContent: 'Light and air' });
  // the crowns' shade map from above, north up as in the world (x right, z down), you on it: a dot, where you look
  // a line; the sun's direction an arrow from the edge. White is open, black under boughs
  const ml = add(el, 'label', { className: 'check' });
  const mc = add<HTMLInputElement>(ml, 'input', { type: 'checkbox' });
  add(ml, 'span', { textContent: 'show crown map' });
  const view = add<HTMLCanvasElement>(el, 'canvas', { width: 266, height: 266 });
  view.style.cssText = 'display:none;width:266px;height:266px;border-radius:6px;margin:4px 0 6px';
  let timer = 0;
  const drawMap = () => {
    const c = t.canopy, ctx = view.getContext('2d')!, W = view.width, b = c.box;
    ctx.drawImage(c.canvas, 0, 0, W, W);
    const k = W / b.z, p = c.camera.position;
    const px = (p.x - b.x) * k, pz = (p.z - b.y) * k;
    // where it looks: the camera's -z (from its matrix, no Vector3 here: three is only a type in this file)
    const e = c.camera.matrixWorld.elements, dir = { x: -e[8], z: -e[10] };
    const fl = Math.hypot(dir.x, dir.z) || 1;
    // where the view reaches: the circle the map counts out to (past it, neutral)
    ctx.strokeStyle = 'rgba(80,160,255,0.6)';
    ctx.beginPath(); ctx.arc(px, pz, 26 * k, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#e8b26a'; ctx.fillStyle = '#e8b26a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, pz); ctx.lineTo(px + (dir.x / fl) * 30, pz + (dir.z / fl) * 30); ctx.stroke();
    ctx.beginPath(); ctx.arc(px, pz, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.stroke();
    // the sun: from the edge toward the middle, the way the light goes
    const L = c.light, ll = Math.hypot(L.x, L.z) || 1;
    ctx.strokeStyle = '#ffd04a';
    ctx.beginPath(); ctx.moveTo(W / 2 + (L.x / ll) * W * 0.46, W / 2 + (L.z / ll) * W * 0.46); ctx.lineTo(W / 2 + (L.x / ll) * W * 0.34, W / 2 + (L.z / ll) * W * 0.34); ctx.stroke();
    ctx.lineWidth = 1;
  };
  mc.onchange = () => {
    view.style.display = mc.checked ? 'block' : 'none';
    clearInterval(timer);
    if (mc.checked) { drawMap(); timer = window.setInterval(drawMap, 250); }
  };
  slider('sun height °', 'sun', () => t.sun.deg, (v) => t.sun.set(v), 2, 88, 1);
  uni('crown shade', t.atmos, 'uCanopyAmt', 0, 2, 0.01); // the crowns' shade map on the floor and in the beams: 0 off
  uni('beams', t.atmos, 'uBeam', 0, 3, 0.01);
  uni('ground mist', t.atmos, 'uMist', 0, 2, 0.01);
  uni('mist from m', t.atmos, 'uMistStart', 0, 4, 0.05);
  uni('haze', t.atmos, 'uFog', 0, 0.4, 0.005);
  uni('shafts', t.atmos, 'uShaft', 0, 3, 0.01);
  uni('shaft edge', t.atmos, 'uShaftPow', 0.5, 6, 0.05);
  uni('shaft reach', t.atmos, 'uShaftReach', 0.3, 5, 0.05);
}
