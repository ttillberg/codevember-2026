// 19 Erosion: a cube of layered sandstone in a voxel grid, worn by rain, water and wind.
// The grid lives on the GPU: sim.wgsl moves and wears it, render.wgsl draws it.
import commonSrc from './common.wgsl?raw';
import simSrc from './sim.wgsl?raw';
import renderSrc from './render.wgsl?raw';
import { GX, GY, GZ, GROUND_H, CUBE, X0, Z0, TOP, TYPES, LAYERS, EXTRA, EXTRA_LAYERS, buildWorld } from './world';
import { buildBar, forceFace, ICONS, sizeFace } from './bar';

const query = new URLSearchParams(location.search);
// ?clean: no page furniture, the scene alone (screengrabs, clips)
const clean = query.has('clean');
document.body.classList.toggle('clean', clean);

const BACKDROP = '#e8e3da';
// the tools, by the number the shaders and what is saved know them by (the bar and the keys have their own order: TOOLS)
const TOOL = { RAIN: 1, HOSE: 2, WIND: 3, SCRATCH: 4 };

// Tuning. On window.P, to play with from the console.
const P = {
  steps: 4, // simulation steps per frame, for the falling sediment and for the water
  erode: 0.1, // how fast running water wears its bed, at level 40 (sim.wgsl settle has the rest of the sum)
  calm: 0.1, // and how much of that is left once the rain has stopped: what still runs off wears little
  minFlow: 0.004, // less water than this through a column wears nothing: a pool, a film
  evap: 0.0004, // depth a film of water loses per step. Water with depth to it does not dry (sim.wgsl settle)
  rainRate: 0.006, // depth of rain per step
  hoseRate: 0.55, // how hard the hose wears what it lands on, like windRate
  scratchRate: 0.9, // and the scratch: at level 40, one pass takes the surface clean off
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
const layers = Array.from({ length: 16 }, (_, i) => LAYERS[i] ?? EXTRA_LAYERS[i] ?? { color: '#ff00ff', soft: 0 });
const ids = (o: Record<string, number>) => Object.entries(o).map(([name, id]) => `const ${name} = ${id}u;`).join('\n');
// what the shaders are told (common.wgsl): the grid, the block in it, and the names of things
const header = `
const GX: i32 = ${GX};
const GY: i32 = ${GY};
const GZ: i32 = ${GZ};
const CUBE: i32 = ${CUBE};
const TOP: i32 = ${TOP};
const LO = vec3i(${X0}, ${GROUND_H}, ${Z0});
${ids(TYPES)}
${ids(EXTRA)}
${ids(TOOL)}
const PAL = array<vec3f, 16>(${layers.map((l) => `vec3f(${rgb(l.color)})`).join(', ')});
const SOFT = array<f32, 16>(${layers.map((l) => l.soft.toFixed(3)).join(', ')});
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
const stepData = new Uint32Array(4);
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

// a bind group and its layout from one list, the bindings in the order the shader numbers them
function bind(visibility: number, buffers: [GPUBuffer, GPUBufferBindingType][]) {
  const layout = device.createBindGroupLayout({ entries: buffers.map(([, type], binding) => ({ binding, visibility, buffer: { type } })) });
  const group = device.createBindGroup({ layout, entries: buffers.map(([buffer], binding) => ({ binding, resource: { buffer } })) });
  return { layout, group };
}
const { layout: simLayout, group: simGroup } = bind(GPUShaderStage.COMPUTE, [
  [cellBuf, 'storage'], [uBuf, 'uniform'], [stepBuf, 'uniform'], [pickBuf, 'storage'], [skyBuf, 'storage'],
  [colBuf, 'storage'], [fluxBuf, 'storage'], [ranBuf, 'storage'], [vegBuf, 'storage'],
]);
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

const { layout: renderLayout, group: renderGroup } = bind(GPUShaderStage.FRAGMENT, [
  [cellBuf, 'read-only-storage'], [uBuf, 'uniform'], [pickBuf, 'read-only-storage'],
]);
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

function updateCamera(yaw: number) {
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
  const lo: V3 = [X0 - 6, 0, Z0 - 6];
  const hi: V3 = [X0 + CUBE + 6, TOP + 6, Z0 + CUBE + 6];
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

let tool = TOOL.SCRATCH; // the one in hand from the start
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
// Its force, 0..1: how hard it works. That is a power of 1 at 40, 10 times that at 100, a fifth at
// 0. For rain the hard work is the wearing, not the amount of water: ten times the water only
// drowns the rock, deep water shelters what is under it. So its force turns up how fast running
// water wears, and the rain itself only a little.
// And its size, the brush's radius in voxels: the knob, or cmd + drag on the scene.
// (min, max, start: the radius. force: what it starts on. rate: what the shader gets at this much power, from the tuning above.)
type Tool = { id: number; name: string; icon: string; min: number; max: number; start: number; force: number; rate(power: number): number };
// in the order of the bar, which is the order of the keys 1 to 4
const TOOLS: Tool[] = [
  { id: TOOL.SCRATCH, name: 'Scratch', icon: ICONS.scratch, min: 1.5, max: 14, start: 11.2, force: 0.6, rate: (p) => P.scratchRate * p }, // big (90 on the knob) and not so hard
  { id: TOOL.RAIN, name: 'Rain', icon: ICONS.rain, min: 5, max: 45, start: 13, force: 0.75, rate: (p) => P.rainRate * p ** 0.3 },
  { id: TOOL.HOSE, name: 'Hose', icon: ICONS.water, min: 2, max: 16, start: 7, force: 0.75, rate: (p) => P.hoseRate * p },
  { id: TOOL.WIND, name: 'Wind', icon: ICONS.wind, min: 12, max: 90, start: 40, force: 0.75, rate: (p) => P.windRate * p },
];
const toolOf = (id: number) => TOOLS.find((t) => t.id === id)!;
// both by the tool's number, as they are saved (nothing at 0)
const force = [0, 0, 0, 0, 0];
const brush = [0, 0, 0, 0, 0];
for (const t of TOOLS) {
  force[t.id] = t.force;
  brush[t.id] = t.start;
}
const BRUSH = 'codevember-19-brush';
try {
  const saved = JSON.parse(localStorage.getItem(BRUSH) ?? 'null');
  for (const { id, min, max } of TOOLS) {
    // (a force saved at 0.4, a scratch at 3 or 6 or a hose at 4 is an old default, kept by nobody's choice: it takes the new one)
    if (saved?.force?.[id] >= 0 && saved.force[id] <= 1 && saved.force[id] !== 0.4) force[id] = saved.force[id];
    const old = (id === TOOL.SCRATCH && [3, 6].includes(saved?.radius?.[id])) || (id === TOOL.HOSE && saved?.radius?.[id] === 4);
    if (!old && saved?.radius?.[id] >= min && saved.radius[id] <= max) brush[id] = saved.radius[id];
  }
} catch { /* no storage, or not ours: the defaults */ }
const remember = () => {
  try { localStorage.setItem(BRUSH, JSON.stringify({ force, radius: brush })); } catch { /* no storage */ }
};
// the size as the knob has it, 0..1 over the tool's range, evenly by ratio
const sizeKnob = (t: number) => Math.log(brush[t] / toolOf(t).min) / Math.log(toolOf(t).max / toolOf(t).min);
const setSizeKnob = (t: number, v: number) => { brush[t] = toolOf(t).min * (toolOf(t).max / toolOf(t).min) ** v; };
const power = (t: number) => 10 ** ((force[t] - 0.4) / 0.6);

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
  TOOLS.map(({ id, name, icon }, i) => ({ id, name, icon, key: String(i + 1) })),
  [
    { name: 'Size', key: MAC ? '⌘ drag' : 'Ctrl drag', face: sizeFace, get: () => sizeKnob(tool), put: (v) => { setSizeKnob(tool, v); remember(); } },
    { name: 'Force', key: MAC ? '⇧⌘ drag' : 'Shift Ctrl drag', face: forceFace, get: () => force[tool], put: (v) => { force[tool] = v; remember(); } },
  ],
  { select: setTool },
);
function setTool(t: number) {
  tool = t;
  bar.select(t);
}
setTool(tool);

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
const TOUCH_LIFT = 40; // CSS px
const pointAt = (e: PointerEvent) => ({ x: e.clientX, y: e.clientY - (e.pointerType === 'touch' ? TOUCH_LIFT : 0) });

// Two fingers are the camera's, wherever they land: moved together they turn the table as a drag
// beside the rock does, a pinch zooms, a twist turns too. One finger has the tool, but not at
// once: a second finger gets a moment to land first, or every pinch would begin with a scratch.
const TOUCH_WAIT = 90; // ms
const TWIST_FROM = 0.15; // radians before a twist counts, so that a pinch does not turn the table
const fingers = new Map<number, { x: number; y: number }>();
let pinch: { x: number; y: number; d: number; a: number; twist: number } | null = null;
let pinched = false; // two fingers have been down: what is left of the touch does nothing
let heldFrom = 0; // when the tool may start (performance.now)
const clampZoom = (z: number) => Math.min(5, Math.max(0.6, z));
function pinchAt() {
  const [a, b] = [...fingers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
}
function turn(dx: number, dy: number) {
  yaw -= dx * 0.008;
  pitch = Math.min(1.2, Math.max(0.2, pitch + dy * 0.005));
}

canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch { /* a made-up pointer in a test */ }
  if (e.pointerType === 'touch') {
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size > 1) {
      release();
      hover = false;
      pinched = true;
      pinch = fingers.size === 2 ? { ...pinchAt(), twist: 0 } : null;
      return;
    }
    heldFrom = performance.now() + TOUCH_WAIT;
  }
  ptr = pointAt(e);
  hover = true;
  last = { x: e.clientX, y: e.clientY };
  if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
    forcing = { x: e.clientX, t: force[tool] };
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
  if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinched) {
    if (!pinch || fingers.size !== 2) return;
    const now = pinchAt();
    turn(now.x - pinch.x, now.y - pinch.y);
    zoom = clampZoom((zoom * now.d) / Math.max(1, pinch.d));
    const da = Math.atan2(Math.sin(now.a - pinch.a), Math.cos(now.a - pinch.a)); // the short way round
    const twist = pinch.twist + da;
    if (Math.abs(pinch.twist) > TWIST_FROM) yaw += da;
    pinch = { ...now, twist };
    return;
  }
  if (forcing) {
    force[tool] = Math.min(1, Math.max(0, forcing.t + (e.clientX - forcing.x) / 160));
    bar.refresh();
    return;
  }
  if (sizing) {
    const k = Math.exp((e.clientX - sizing.x) / 160);
    brush[tool] = Math.min(toolOf(tool).max, Math.max(toolOf(tool).min, sizing.r * k));
    showRing();
    bar.refresh();
    return;
  }
  setCursor(e.metaKey || e.ctrlKey);
  if (turning) {
    turn(e.clientX - last.x, e.clientY - last.y);
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
const lift = (e: PointerEvent) => {
  fingers.delete(e.pointerId);
  if (!pinched) return release();
  pinch = null;
  if (!fingers.size) pinched = false;
};
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('pointerleave', () => { if (!held) hover = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom = clampZoom(zoom * Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (TOOLS[Number(e.key) - 1]) setTool(TOOLS[Number(e.key) - 1].id);
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
  updateCamera(yawNow);

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
  let working = held && performance.now() >= heldFrom;
  if (tool === TOOL.SCRATCH) {
    scratch.frames++;
    const moved = Math.hypot(ptr.x - scratch.at.x, ptr.y - scratch.at.y) > 8;
    working = working && scratch.frames >= (moved ? 3 : 7);
    if (working) {
      scratch.frames = 0;
      scratch.at = { ...ptr };
      scratch.bite = 0.7 + 0.6 * Math.random();
    }
  }
  const wearTo = held && tool === TOOL.RAIN ? power(tool) : held && tool === TOOL.HOSE ? 1 : P.calm;
  wearing += (wearTo - wearing) * (wearTo > wearing ? 0.2 : 0.03);
  // struct U in common.wgsl, a vec4 a line
  uData.set(cam.o, 0);
  uData.set([...cam.r, cam.inv], 4);
  uData.set(cam.u, 8);
  uData.set(cam.f, 12);
  uData.set([W, H, t / 1000], 16);
  uData.set(sun, 20);
  uData.set(rayOrigin(ptr.x, ptr.y), 24);
  uData.set([px, py, hover ? 1 : 0, working ? 1 : 0], 28);
  uData.set([tool, brush[tool] * (tool === TOOL.SCRATCH ? scratch.bite : 1), toolOf(tool).rate(power(tool))], 32);
  uData.set([P.gravity, P.minFlow, P.inertia, P.cling], 36);
  uData.set([P.erode * wearing, P.evap, P.supportLimit], 40);
  device.queue.writeBuffer(uBuf, 0, uData);

  // one dispatch over every column
  const columns = (pass: GPUComputePassEncoder, pipe: GPUComputePipeline) => {
    pass.setPipeline(pipe);
    pass.dispatchWorkgroups(GX / 8, GZ / 8);
  };

  {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, simGroup);
    columns(pass, skyPipe);
    pass.setPipeline(pickPipe);
    pass.dispatchWorkgroups(1);
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  // every step has its own block offset, so its own uniforms: one submit each
  for (let i = 0; i < P.steps; i++) {
    step++;
    const bits = (Math.random() * 4) | 0;
    stepData.set([bits & 1, step & 1, bits >> 1, (Math.random() * 0xffffffff) >>> 0]);
    device.queue.writeBuffer(stepBuf, 0, stepData);
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, simGroup);
    pass.setPipeline(simPipe);
    pass.dispatchWorkgroups(Math.ceil((GX / 2 + 1) / 4), Math.ceil((GY / 2 + 1) / 4), Math.ceil((GZ / 2 + 1) / 4));
    if (i % 2 === 0) {
      pass.setPipeline(supportPipe);
      pass.dispatchWorkgroups(CUBE / 4, CUBE / 4, CUBE / 4); // the block only
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
      columns(pass, flowPipe);
      columns(pass, settlePipe);
    }
    columns(pass, growPipe);
    columns(pass, stampPipe);
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
// hold a tool on a screen point without a pointer, and set its force
function hold(x: number, y: number, t = tool) {
  setTool(t);
  ptr = { x, y };
  hover = true;
  held = true;
}
function level(t: number, v: number) {
  force[t] = v;
  bar.refresh();
}
const holdAt = query.get('hold')?.split(',').map(Number);
if (holdAt) {
  hold(holdAt[0] * window.innerWidth, holdAt[1] * window.innerHeight, holdAt[2] || TOOL.RAIN);
  if (holdAt[3] >= 0) level(tool, holdAt[3]);
  if (holdAt[4] > 0) setTimeout(release, holdAt[4] * 1000);
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

// for tests and clips
(window as unknown as Record<string, unknown>).erosion = {
  P,
  setTool,
  reset,
  hold,
  release,
  turn(a: number) { yaw = a; },
  camera: () => ({ yaw, pitch, zoom }),
  level,
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
    const cells = new Uint32Array(await readBack(cellBuf));
    const count = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < cells.length; i++) count[cells[i] & 7]++;
    const [air, water, sediment, rock, ground, plants] = count;
    // the water itself is the depth per column; `water` above counts the voxels it is drawn with
    const cols = new Float32Array(await readBack(colBuf));
    let volume = 0;
    let wet = 0;
    let deepest = 0;
    for (let i = 0; i < cols.length; i += 4) {
      volume += cols[i];
      if (cols[i] > 0.25) wet++;
      deepest = Math.max(deepest, cols[i]);
    }
    return { air, water, sediment, rock, ground, plants, volume, wet, deepest, pick: [...new Float32Array(await readBack(pickBuf))], step, held, hover, tool };
  },
};
