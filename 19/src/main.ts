// 19 Erosion: a cube of layered sandstone in a voxel grid, worn by rain, water and wind.
// The grid lives on the GPU: sim.wgsl moves and wears it, render.wgsl draws it.
import commonSrc from './common.wgsl?raw';
import simSrc from './sim.wgsl?raw';
import renderSrc from './render.wgsl?raw';
import { GX, GY, GZ, GROUND_H, CUBE, LAYERS, GREEN, BONE_LAYER, BONE_COLOR, BONE_SOFT, GROUND_LAYER, GROUND_COLOR, buildWorld } from './world';
import { buildBar, forceFace, ICONS, sizeFace } from './bar';

const query = new URLSearchParams(location.search);
// ?clean: no page furniture, the scene alone (screengrabs, clips)
if (query.has('clean')) document.body.classList.add('clean');

const BACKDROP = '#e8e3da';

// Tuning. On window.P in dev.
const P = {
  steps: 4, // simulation steps per frame, for the falling sediment and for the water
  erode: 0.1, // how fast running water wears its bed, at level 40 (sim.wgsl settle has the rest of the sum)
  calm: 0.1, // and how much of that is left once the rain has stopped: what still runs off wears little
  minFlow: 0.004, // less water than this through a column wears nothing: a pool, a film
  evap: 0.0004, // depth a film of water loses per step. Water with depth to it does not dry (sim.wgsl settle)
  rainRate: 0.006, // depth of rain per step
  hoseRate: 0.55, // how hard the hose wears what it lands on, like windRate
  scratchRate: 0.9, // and the scratch: at the 40 it starts on, one pass takes the surface clean off
  gravity: 0.2, // how hard a difference in level pushes the water
  inertia: 0.9, // how much of its flow the water keeps from one step to the next
  cling: 0.06, // the depth under which water is a film that hardly runs
  windRate: 0.006, // low: the wind is wide, it works on most of the block at once
  supportLimit: 420, // steps to the ground through rock before a piece counts as loose
  pitch: (30 * Math.PI) / 180,
  lower: 0.2, // how far below the middle of a wide screen the block sits, as a part of its height
};
(window as unknown as { P: typeof P }).P = P;

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;

function fail(msg: string): never {
  const el = document.createElement('p');
  el.className = 'note';
  el.textContent = msg;
  document.body.append(el);
  throw new Error(msg);
}

if (!navigator.gpu) fail('This one needs WebGPU: a recent Chrome, Edge or Safari.');
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail('No WebGPU adapter here.');
const device = await adapter.requestDevice();
const context = canvas.getContext('webgpu')!;
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'opaque' });

// ---------- shaders ----------

const rgb = (hex: string) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4));
const pal: string[] = [];
const soft: string[] = [];
for (let i = 0; i < 16; i++) {
  const layer = LAYERS[i];
  const special = i === GROUND_LAYER ? GROUND_COLOR : i === BONE_LAYER ? BONE_COLOR : GREEN[i];
  pal.push(`vec3f(${rgb(layer?.color ?? special ?? '#ff00ff')})`);
  soft.push((layer?.soft ?? (i === BONE_LAYER ? BONE_SOFT : 0)).toFixed(3));
}
const header = `
const CUBE: i32 = ${CUBE};
const TOP: i32 = ${GROUND_H + CUBE};
const GX: i32 = ${GX};
const GY: i32 = ${GY};
const GZ: i32 = ${GZ};
const PAL = array<vec3f, 16>(${pal.join(', ')});
const SOFT = array<f32, 16>(${soft.join(', ')});
const BG = vec3f(${rgb(BACKDROP)});
`;

const simModule = device.createShaderModule({ code: header + commonSrc + simSrc });
const renderModule = device.createShaderModule({ code: header + commonSrc + renderSrc });
for (const [name, m] of [['sim', simModule], ['render', renderModule]] as const) {
  m.getCompilationInfo().then((info) => {
    for (const msg of info.messages) console[msg.type === 'error' ? 'error' : 'warn'](`${name}.wgsl ${msg.lineNum}:${msg.linePos} ${msg.message}`);
  });
}

// ---------- buffers ----------

const cellBuf = device.createBuffer({ size: GX * GY * GZ * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
const uData = new Float32Array(11 * 4);
const uBuf = device.createBuffer({ size: uData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const stepData = new Uint32Array(8);
const stepBuf = device.createBuffer({ size: stepData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const pickBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
// the highest rock of every column: only what is open to the sky can be worked on
const skyBuf = device.createBuffer({ size: GX * GZ * 4, usage: GPUBufferUsage.STORAGE });
// the water, per column: depth, wear, bed and discharge in one, and what flows out to the four neighbours
const colBuf = device.createBuffer({ size: GX * GZ * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
const fluxBuf = device.createBuffer({ size: GX * GZ * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const ranBuf = device.createBuffer({ size: GX * GZ * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
// what grows, per column: cover, the bed it grew on, moisture, tufts on a wall beside
const vegBuf = device.createBuffer({ size: GX * GZ * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const dry = new Float32Array(GX * GZ * 4);

function reset(seed = (Math.random() * 1e9) | 0) {
  const world = buildWorld(seed);
  device.queue.writeBuffer(cellBuf, 0, world.cells);
  device.queue.writeBuffer(colBuf, 0, world.col);
  device.queue.writeBuffer(fluxBuf, 0, dry);
  device.queue.writeBuffer(ranBuf, 0, dry, 0, GX * GZ);
  device.queue.writeBuffer(vegBuf, 0, world.veg);
}
reset(Number(query.get('seed') ?? 19));

const simLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ],
});
const simGroup = device.createBindGroup({
  layout: simLayout,
  entries: [
    { binding: 0, resource: { buffer: cellBuf } },
    { binding: 1, resource: { buffer: uBuf } },
    { binding: 2, resource: { buffer: stepBuf } },
    { binding: 3, resource: { buffer: pickBuf } },
    { binding: 4, resource: { buffer: skyBuf } },
    { binding: 5, resource: { buffer: colBuf } },
    { binding: 6, resource: { buffer: fluxBuf } },
    { binding: 7, resource: { buffer: ranBuf } },
    { binding: 8, resource: { buffer: vegBuf } },
  ],
});
const simPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [simLayout] });
const compute = (entryPoint: string) =>
  device.createComputePipeline({ layout: simPipelineLayout, compute: { module: simModule, entryPoint } });
const skyPipe = compute('skyline');
const pickPipe = compute('pickMain');
const simPipe = compute('sim');
const supportPipe = compute('support');
const flowPipe = compute('flow');
const settlePipe = compute('settle');
const growPipe = compute('grow');
const stampPipe = compute('stamp');

const renderLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
  ],
});
const renderGroup = device.createBindGroup({
  layout: renderLayout,
  entries: [
    { binding: 0, resource: { buffer: cellBuf } },
    { binding: 1, resource: { buffer: uBuf } },
    { binding: 2, resource: { buffer: pickBuf } },
  ],
});
const renderPipe = device.createRenderPipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
  vertex: { module: renderModule, entryPoint: 'vs' },
  fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
});

// ---------- the screen: big pixels ----------

let W = 1;
let H = 1;
// Detail, in the settings: how big a picture pixel is. Medium is a CSS pixel on a dense screen
// and two on a plain one; low is twice that, high a single device pixel.
type Detail = 'low' | 'med' | 'high';
const DETAIL = 'codevember-19-detail';
let detail: Detail = 'med';
try {
  const saved = localStorage.getItem(DETAIL);
  if (saved === 'low' || saved === 'med' || saved === 'high') detail = saved;
} catch { /* no storage */ }

function resize() {
  const dpr = window.devicePixelRatio;
  // one picture pixel is this many device pixels
  const base = Math.max(2, Math.round(dpr));
  const px = Number(query.get('px')) || { low: base * 2, med: base, high: 1 }[detail];
  W = Math.max(1, Math.ceil((window.innerWidth * dpr) / px));
  H = Math.max(1, Math.ceil((window.innerHeight * dpr) / px));
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = `${(W * px) / dpr}px`;
  canvas.style.height = `${(H * px) / dpr}px`;
}
window.addEventListener('resize', resize);
resize();

// ---------- camera: orthographic, on a turntable ----------

type V3 = [number, number, number];
let yaw = Math.PI / 4;
let pitch = P.pitch;
let zoom = 1;
const target: V3 = [GX / 2, GROUND_H + CUBE * 0.42, GZ / 2];

const cam = { o: [0, 0, 0] as V3, r: [1, 0, 0] as V3, u: [0, 1, 0] as V3, f: [0, 0, -1] as V3, inv: 1 };
const nz = (v: number) => (Math.abs(v) < 1e-5 ? 1e-5 : v); // the grid walk divides by these

function updateCamera() {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  cam.f = [nz(-cp * sy), -sp, nz(-cp * cy)];
  cam.r = [cy, 0, -sy];
  cam.u = [-sy * sp, cp, -cy * sp];
  cam.o = [target[0] - cam.f[0] * 500, target[1] - cam.f[1] * 500, target[2] - cam.f[2] * 500];
  // Fit the tray side to side, and the cube's height. On an upright screen, a phone, the
  // width is what is short: there the block and its tray fill it, a little air either side,
  // and the block sits lower, clear of the title and nearer the thumb.
  const upright = W < H * 0.8;
  const fit = upright ? Math.min(W / (CUBE * 1.8), H / (CUBE * 1.9)) : Math.min(W / (GX * 1.08), H / (CUBE * 2.15));
  cam.inv = 1 / (fit * zoom);
  // Looking from a little higher puts the scene lower on the screen, clear of the title: by
  // P.lower of the height where there is room for that, and never so far that the block's foot
  // goes under the tool bar. (The tray may: it is only what the block stands on.)
  let foot = 0; // how far below the middle of the screen the block's lowest corner is, in voxels
  for (let k = 0; k < 4; k++) {
    const dx = ((k & 1) * 2 - 1) * (CUBE / 2);
    const dz = ((k >> 1) * 2 - 1) * (CUBE / 2);
    foot = Math.max(foot, -(dx * cam.u[0] + (GROUND_H - target[1]) * cam.u[1] + dz * cam.u[2]));
  }
  const pxPerCss = W / Math.max(1, window.innerWidth);
  const room = H / 2 - 100 * pxPerCss - foot / cam.inv; // 100 CSS px: the bar and the air over it
  // (not in ?clean: with no title and no bar to keep clear of, the block sits in the middle)
  const clean = document.body.classList.contains('clean');
  const lower = clean ? 0 : Math.max(0, Math.min(H * (upright ? 0.08 : P.lower), room)) * cam.inv;
  cam.o = [cam.o[0] + cam.u[0] * lower, cam.o[1] + cam.u[1] * lower, cam.o[2] + cam.u[2] * lower];
}

// a screen point (CSS pixels) to where its ray starts
function rayOrigin(clientX: number, clientY: number): V3 {
  const rect = canvas.getBoundingClientRect();
  const sx = (((clientX - rect.left) / rect.width) * W - W / 2) * cam.inv;
  const sy = (H / 2 - ((clientY - rect.top) / rect.height) * H) * cam.inv;
  return [0, 1, 2].map((i) => cam.o[i] + cam.r[i] * sx + cam.u[i] * sy) as V3;
}

// does a ray along the view meet the rock's box? Decides between the tool and turning the table.
function overRock(o: V3) {
  const lo: V3 = [GX / 2 - CUBE / 2 - 6, 0, GZ / 2 - CUBE / 2 - 6];
  const hi: V3 = [GX / 2 + CUBE / 2 + 6, GROUND_H + CUBE + 6, GZ / 2 + CUBE / 2 + 6];
  let tn = -Infinity;
  let tf = Infinity;
  for (let i = 0; i < 3; i++) {
    const a = (lo[i] - o[i]) / cam.f[i];
    const b = (hi[i] - o[i]) / cam.f[i];
    tn = Math.max(tn, Math.min(a, b));
    tf = Math.min(tf, Math.max(a, b));
  }
  return tn < tf;
}

// ---------- pointer and tools ----------

let tool = 1; // 1 rain, 2 hose, 3 wind, 4 scratch
let hover = false;
let held = false;
let turning = false;
let ptr = { x: 0, y: 0 }; // CSS pixels: the ray is taken from it every frame, the camera may have moved
let last = { x: 0, y: 0 };
// Brush size, as on day 05: cmd (or ctrl) and drag sideways on the scene. A ring shows the size and
// stays where the drag began, only its size changes. Exponential, so it feels the same small and big.
let sizing: { x: number; y: number; r: number } | null = null;
// And force the same way with shift held too: the force knob's gauge shows while it is dragged.
let forcing: { x: number; t: number } | null = null;
const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const sizeRing = document.querySelector<HTMLElement>('.size-ring')!;

// A tool has two things to set, each tool its own, both remembered from one visit to the next,
// both on the same two knobs in the bar whichever tool is in hand.
// Its force, 0..1: how hard it works, 1 at the 40 it starts on, 10 times that at 100, a fifth at
// 0. For rain the hard work is the wearing, not the amount of water: ten times the water only
// drowns the rock, deep water shelters what is under it. So its force turns up how fast running
// water wears, and the rain itself only a little.
// And its size, the brush's radius in voxels: the knob, or cmd + drag on the scene.
const size = [0, 0.4, 0.4, 0.4, 0.4];
const RADIUS = [
  { min: 0, max: 0, start: 0 },
  { min: 5, max: 45, start: 13 }, // rain
  { min: 2, max: 16, start: 7 }, // hose
  { min: 12, max: 90, start: 40 }, // wind
  { min: 1.5, max: 14, start: 6 }, // scratch
];
const brush = RADIUS.map((r) => r.start);
const BRUSH = 'codevember-19-brush';
try {
  const saved = JSON.parse(localStorage.getItem(BRUSH) ?? 'null');
  for (let i = 1; i <= 4; i++) {
    if (saved?.force?.[i] >= 0 && saved.force[i] <= 1) size[i] = saved.force[i];
    // (a scratch saved at 3 or a hose at 4 is an old default, kept by nobody's choice: it takes the new one)
    const old = (i === 4 && saved?.radius?.[i] === 3) || (i === 2 && saved?.radius?.[i] === 4);
    if (!old && saved?.radius?.[i] >= RADIUS[i].min && saved.radius[i] <= RADIUS[i].max) brush[i] = saved.radius[i];
  }
} catch { /* no storage, or not ours: the defaults */ }
const remember = () => {
  try { localStorage.setItem(BRUSH, JSON.stringify({ force: size, radius: brush })); } catch { /* no storage */ }
};
const radius = (t: number) => brush[t];
// the size as the knob has it, 0..1 over the tool's range, evenly by ratio
const sizeKnob = (t: number) => Math.log(brush[t] / RADIUS[t].min) / Math.log(RADIUS[t].max / RADIUS[t].min);
const setSizeKnob = (t: number, v: number) => { brush[t] = RADIUS[t].min * (RADIUS[t].max / RADIUS[t].min) ** v; };
const power = (t: number) => 10 ** (((size[t] ?? 0.4) - 0.4) / 0.6);

function showRing() {
  if (!sizing) return;
  // the radius on the screen: voxels to picture pixels to CSS pixels
  const rect = canvas.getBoundingClientRect();
  const px = (brush[tool] / cam.inv) * (rect.width / W);
  sizeRing.style.display = 'block';
  sizeRing.style.width = sizeRing.style.height = `${px * 2}px`;
  sizeRing.style.left = `${sizing.x}px`;
  sizeRing.style.top = `${sizing.y}px`;
}

const bar = buildBar(
  document.querySelector<HTMLElement>('#bar')!,
  [
    { id: 1, name: 'Rain', key: '1', icon: ICONS.rain },
    { id: 2, name: 'Hose', key: '2', icon: ICONS.water },
    { id: 3, name: 'Wind', key: '3', icon: ICONS.wind },
    { id: 4, name: 'Scratch', key: '4', icon: ICONS.scratch },
  ],
  [
    { name: 'Size', key: MAC ? '⌘ drag' : 'Ctrl drag', face: sizeFace, get: () => sizeKnob(tool), put: (v) => { setSizeKnob(tool, v); remember(); } },
    { name: 'Force', key: MAC ? '⇧⌘ drag' : 'Shift Ctrl drag', face: forceFace, get: () => size[tool], put: (v) => { size[tool] = v; remember(); } },
  ],
  { select: (id) => setTool(id) },
);
function setTool(t: number) {
  tool = t;
  bar.select(t);
}
setTool(1);

// settings: a gear top right, its menu holds the detail and a new block
{
  const box = document.querySelector<HTMLElement>('.settings')!;
  const gear = box.querySelector<HTMLButtonElement>('.gear')!;
  const menu = box.querySelector<HTMLElement>('.menu')!;
  const setOpen = (open: boolean) => {
    menu.hidden = !open;
    gear.classList.toggle('on', open);
    gear.setAttribute('aria-expanded', String(open));
  };
  gear.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus off it, keys stay the scene's
  gear.addEventListener('click', () => setOpen(menu.hidden));
  window.addEventListener('pointerdown', (e) => { if (!menu.hidden && !box.contains(e.target as Node)) setOpen(false); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  const select = menu.querySelector<HTMLSelectElement>('[data-detail]')!;
  select.value = detail;
  select.addEventListener('change', () => {
    detail = select.value as Detail;
    try { localStorage.setItem(DETAIL, detail); } catch { /* no storage */ }
    resize();
    select.blur(); // or the number keys would change it instead of the tool
  });
  menu.querySelector('[data-action="reset"]')!.addEventListener('click', () => { reset(); setOpen(false); });
}

// Where a pointer acts. A mouse, where it is. A finger hides what is under it, so it acts a
// little above itself: the brush sits clear of the fingertip, where it can be seen.
const TOUCH_LIFT = 56; // CSS px
const pointAt = (e: PointerEvent) => ({ x: e.clientX, y: e.clientY - (e.pointerType === 'touch' ? TOUCH_LIFT : 0) });

canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch { /* a made-up pointer in a test */ }
  ptr = pointAt(e);
  hover = true;
  last = { x: e.clientX, y: e.clientY };
  if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
    forcing = { x: e.clientX, t: size[tool] };
    bar.peek('Force', true);
    setCursor(true);
  } else if (e.metaKey || e.ctrlKey) {
    sizing = { x: e.clientX, y: e.clientY, r: brush[tool] };
    showRing();
    setCursor(true);
  } else if (e.button === 0 && overRock(rayOrigin(ptr.x, ptr.y))) held = true;
  else turning = true;
});
canvas.addEventListener('pointermove', (e) => {
  if (forcing) {
    size[tool] = Math.min(1, Math.max(0, forcing.t + (e.clientX - forcing.x) / 160));
    bar.refresh();
    return;
  }
  if (sizing) {
    const k = Math.exp((e.clientX - sizing.x) / 160);
    brush[tool] = Math.min(RADIUS[tool].max, Math.max(RADIUS[tool].min, sizing.r * k));
    showRing();
    bar.refresh();
    return;
  }
  setCursor(e.metaKey || e.ctrlKey);
  if (turning) {
    yaw -= (e.clientX - last.x) * 0.008;
    pitch = Math.min(1.2, Math.max(0.2, pitch + (e.clientY - last.y) * 0.005));
    last = { x: e.clientX, y: e.clientY };
    return;
  }
  hover = true;
  ptr = pointAt(e);
});
const release = () => {
  held = false;
  turning = false;
  if (sizing) {
    sizeRing.style.display = 'none';
    remember();
  }
  if (forcing) {
    bar.peek('Force', false);
    remember();
  }
  sizing = null;
  forcing = null;
};
// a resize arrow while cmd or ctrl is held: a drag will size the brush
function setCursor(mod: boolean) {
  canvas.style.cursor = sizing || forcing || mod ? 'ew-resize' : '';
}
window.addEventListener('keydown', (e) => { if (e.key === 'Meta' || e.key === 'Control') setCursor(true); });
window.addEventListener('keyup', (e) => { if (e.key === 'Meta' || e.key === 'Control') setCursor(false); });
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointerleave', () => { if (!held) hover = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom = Math.min(5, Math.max(0.6, zoom * Math.exp(-e.deltaY * 0.0015)));
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key >= '1' && e.key <= '4') setTool(Number(e.key));
  else if (e.key === 'r' || e.key === 'R') reset();
  else if (e.key === 'ArrowLeft') yaw -= Math.PI / 2;
  else if (e.key === 'ArrowRight') yaw += Math.PI / 2;
});

// ---------- frame ----------

let step = 0;
// The scratch works in pulses, like a nail on a wall: a bite, a gap, a bite. One frame on, then
// off for a few; sooner again when the pointer has moved on, so a drag is a run of short marks
// and holding still is a slow pecking at one spot. Each bite is a little bigger or smaller.
const scratch = { frames: 0, at: { x: 0, y: 0 }, bite: 1 };
// How hard running water wears, now. The rain's force while it rains, plain while the hose runs,
// and little otherwise: it comes up fast and dies away over a couple of seconds, so that when
// the rain stops the wearing stops with it and does not go on for as long as there is a puddle.
let wearing = P.calm;
let yawNow = yaw;

function frame(t: number) {
  // the arrow keys turn a quarter at once: ease into it
  yawNow += (yaw - yawNow) * 0.2;
  const yawTarget = yaw;
  yaw = yawNow;
  updateCamera();
  yaw = yawTarget;

  const norm = (v: V3): V3 => {
    const l = Math.hypot(...v);
    return [nz(v[0] / l), nz(v[1] / l), nz(v[2] / l)];
  };
  // the light comes over the viewer's left shoulder, wherever the table is turned
  const sun = norm([0, 1, 2].map((i) => -cam.r[i] * 0.6 + cam.u[i] * 0.75 - cam.f[i] * 0.3) as V3);

  // the pointer in picture pixels, for what is drawn over the scene (the hose's jet)
  const rect = canvas.getBoundingClientRect();
  const px = ((ptr.x - rect.left) / rect.width) * W;
  const py = ((ptr.y - rect.top) / rect.height) * H;
  uData.set([...cam.o, px], 0);
  uData.set([...cam.r, cam.inv], 4);
  uData.set([...cam.u, py], 8);
  uData.set([...cam.f, 0], 12);
  uData.set([W, H, t / 1000, radius(3)], 16);
  let working = held;
  if (tool === 4) {
    scratch.frames++;
    const moved = Math.hypot(ptr.x - scratch.at.x, ptr.y - scratch.at.y) > 8;
    working = held && scratch.frames >= (moved ? 3 : 7);
    if (working) {
      scratch.frames = 0;
      scratch.at = { ...ptr };
      scratch.bite = 0.7 + 0.6 * Math.random();
    }
  }
  uData.set([...sun, tool === 4 ? radius(4) * scratch.bite : radius(2)], 20);
  uData.set([...rayOrigin(ptr.x, ptr.y), working ? 1 : 0], 24);
  uData.set([...cam.f, tool], 28);
  uData.set([P.gravity, P.minFlow, P.inertia, radius(1)], 32);
  const wearTo = held && tool === 1 ? power(1) : held && tool === 2 ? 1 : P.calm;
  wearing += (wearTo - wearing) * (wearTo > wearing ? 0.2 : 0.03);
  uData.set([P.erode * wearing, P.cling, P.evap, P.rainRate * power(1) ** 0.3], 36);
  const jetRate = tool === 4 ? P.scratchRate * power(4) : P.hoseRate * power(2);
  uData.set([P.windRate * power(3), jetRate, P.supportLimit, hover ? 1 : 0], 40);
  device.queue.writeBuffer(uBuf, 0, uData);

  {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, simGroup);
    pass.setPipeline(skyPipe);
    pass.dispatchWorkgroups(GX / 8, GZ / 8);
    pass.setPipeline(pickPipe);
    pass.dispatchWorkgroups(1);
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  // every step has its own block offset, so its own uniforms: one submit each
  for (let i = 0; i < P.steps; i++) {
    step++;
    const bits = (Math.random() * 4) | 0;
    stepData.set([bits & 1, step & 1, bits >> 1, step, (Math.random() * 0xffffffff) >>> 0, 0, 0, 0]);
    device.queue.writeBuffer(stepBuf, 0, stepData);
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, simGroup);
    pass.setPipeline(simPipe);
    pass.dispatchWorkgroups(Math.ceil((GX / 2 + 1) / 4), Math.ceil((GY / 2 + 1) / 4), Math.ceil((GZ / 2 + 1) / 4));
    if (i % 2 === 0) {
      pass.setPipeline(supportPipe);
      pass.dispatchWorkgroups(GX / 4, GY / 4, GZ / 4);
    }
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  // the water: its steps need no uniforms of their own, so they go in one pass; then it is
  // stamped into the grid for the picture
  {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, simGroup);
    for (let i = 0; i < P.steps; i++) {
      pass.setPipeline(flowPipe);
      pass.dispatchWorkgroups(GX / 8, GZ / 8);
      pass.setPipeline(settlePipe);
      pass.dispatchWorkgroups(GX / 8, GZ / 8);
    }
    pass.setPipeline(growPipe);
    pass.dispatchWorkgroups(GX / 8, GZ / 8);
    pass.setPipeline(stampPipe);
    pass.dispatchWorkgroups(GX / 8, GZ / 8);
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  {
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(renderPipe);
    pass.setBindGroup(0, renderGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
  }
}
function loop(t: number) {
  frame(t);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ?hold=0.42,0.3,1: a tool held from the start, on a point given as a fraction of the screen.
// A fourth number is its level, 0..1, a fifth the seconds after which it is let go.
const holdAt = query.get('hold')?.split(',').map(Number);
if (holdAt) {
  setTool(holdAt[2] || 1);
  if (holdAt[3] >= 0) size[tool] = holdAt[3];
  bar.refresh();
  if (holdAt[4] > 0) setTimeout(release, holdAt[4] * 1000);
  ptr = { x: holdAt[0] * window.innerWidth, y: holdAt[1] * window.innerHeight };
  hover = true;
  held = true;
}

async function readBack(src: GPUBuffer) {
  const dst = device.createBuffer({ size: src.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, 0, dst, 0, src.size);
  device.queue.submit([enc.finish()]);
  await dst.mapAsync(GPUMapMode.READ);
  const out = dst.getMappedRange().slice(0);
  dst.destroy();
  return out;
}

// for tests and clips: hold a tool on a screen point without a pointer
(window as unknown as Record<string, unknown>).erosion = {
  P,
  setTool,
  reset,
  hold(x: number, y: number, t = tool) {
    setTool(t);
    ptr = { x, y };
    hover = true;
    held = true;
  },
  release,
  turn(a: number) { yaw = a; },
  level(t: number, v: number) { size[t] = v; bar.refresh(); },
  brush(t: number, r?: number) { if (r !== undefined) { brush[t] = r; bar.refresh(); } return brush[t]; },
  // run frames by hand, for when the page is hidden and the browser holds its own back
  tick(n = 1) { for (let i = 0; i < n; i++) frame(performance.now()); },
  // the whole grid read back, index x + GX * (z + GZ * y): for measuring what the water does
  async cells() { return new Uint32Array(await readBack(cellBuf)); },
  // per column, index 4 * (x + GX * z): depth, wear, bed height, discharge
  async columns() { return new Float32Array(await readBack(colBuf)); },
  dims: [GX, GY, GZ],
  // read the grid back: how many cells of each type, and what the pointer is on
  async stats() {
    const read = readBack;
    const cells = new Uint32Array(await read(cellBuf));
    const count = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < cells.length; i++) count[cells[i] & 7]++;
    const [air, water, sediment, rock, ground, plants] = count;
    // the water itself is the depth per column; `water` above counts the voxels it is drawn with
    const cols = new Float32Array(await read(colBuf));
    let volume = 0;
    let wet = 0;
    let deepest = 0;
    for (let i = 0; i < cols.length; i += 4) {
      volume += cols[i];
      if (cols[i] > 0.25) wet++;
      deepest = Math.max(deepest, cols[i]);
    }
    return { air, water, sediment, rock, ground, plants, volume, wet, deepest, pick: [...new Float32Array(await read(pickBuf))], step, held, hover, tool };
  },
};
