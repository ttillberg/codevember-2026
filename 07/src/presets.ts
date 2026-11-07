// Presets: shift + 0..9 stores the brush as it is now in that slot, 0..9 alone brings it back. A slot holds the
// brush, its finish, colour, size, flow and wetness, not the room settings (auto draw, inertia). Kept between visits.
import { save, tool } from './tool';

const KEY = 'codevember-07-presets';
const FIELDS = ['brush', 'finish', 'hex', 'hue', 'shade', 'size', 'flow', 'liquid', 'watery'] as const;
type Preset = Pick<typeof tool, (typeof FIELDS)[number]>;

let slots: Record<string, Preset> = {};
try { slots = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* no storage, no memory */ }
const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(slots)); } catch { /* ignore */ } };

// A short note at the top of the screen that says what happened.
let toast: HTMLDivElement | null = null, timer = 0;
function tell(text: string) {
  if (!toast) { toast = document.createElement('div'); toast.className = 'ft-toast'; document.body.appendChild(toast); }
  toast.textContent = text;
  toast.classList.add('on');
  clearTimeout(timer);
  timer = window.setTimeout(() => toast?.classList.remove('on'), 1200);
}

window.addEventListener('keydown', (e) => {
  const m = /^Digit(\d)$/.exec(e.code);
  if (!m || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const n = m[1];
  e.preventDefault();
  if (e.shiftKey) {
    slots[n] = Object.fromEntries(FIELDS.map((k) => [k, tool[k]])) as Preset;
    keep();
    tell(`Preset ${n} saved`);
  } else if (slots[n]) {
    const p = slots[n];
    for (const k of FIELDS) if (typeof p[k] === typeof tool[k]) (tool as Record<string, unknown>)[k] = p[k];
    save();
    tell(`Preset ${n}`);
  } else {
    tell(`Preset ${n} is empty, shift + ${n} saves it`);
  }
});
