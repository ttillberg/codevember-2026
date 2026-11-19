// 19 Erosion: a cube of layered sandstone in a voxel grid, worn by rain, water and wind.
// The grid lives on the GPU: sim.wgsl moves and wears it, render.wgsl draws it.
import commonSrc from './common.wgsl?raw';
import simSrc from './sim.wgsl?raw';
import renderSrc from './render.wgsl?raw';
import { GX, GY, GZ, GROUND_H, CUBE, LAYERS, GROUND_LAYER, GROUND_COLOR, buildWorld } from './world';

const query = new URLSearchParams(location.search);
// ?clean: no page furniture, the scene alone (screengrabs, clips)
if (query.has('clean')) document.body.classList.add('clean');

const BACKDROP = '#e8e3da';

// Tuning. On window.P in dev.
const P = {
  steps: 4, // simulation steps per frame
  erode: 0.03, // chance per step that water at full energy wears a soft rock cell
  sedYield: 0.5, // how much of the worn rock stays as sediment
  evap: 0.0004,
  rainRate: 0.02,
  rainR: 14,
  hoseRate: 1,
  windRate: 0.05,
  windR: 9,
  supportLimit: 420, // steps to the ground through rock before a piece counts as loose
  pitch: (30 * Math.PI) / 180,
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
  pal.push(`vec3f(${rgb(i === GROUND_LAYER ? GROUND_COLOR : (layer?.color ?? '#ff00ff'))})`);
  soft.push((layer?.soft ?? 0).toFixed(3));
}
const header = `
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

function reset(seed = (Math.random() * 1e9) | 0) {
  device.queue.writeBuffer(cellBuf, 0, buildWorld(seed));
}
reset(Number(query.get('seed') ?? 19));

const simLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ],
});
const simGroup = device.createBindGroup({
  layout: simLayout,
  entries: [
    { binding: 0, resource: { buffer: cellBuf } },
    { binding: 1, resource: { buffer: uBuf } },
    { binding: 2, resource: { buffer: stepBuf } },
    { binding: 3, resource: { buffer: pickBuf } },
  ],
});
const simPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [simLayout] });
const compute = (entryPoint: string) =>
  device.createComputePipeline({ layout: simPipelineLayout, compute: { module: simModule, entryPoint } });
const pickPipe = compute('pickMain');
const simPipe = compute('sim');
const supportPipe = compute('support');

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
function resize() {
  const dpr = window.devicePixelRatio;
  // one picture pixel is this many device pixels: a CSS pixel on a dense screen, two on a plain one
  const px = Number(query.get('px')) || Math.max(2, Math.round(dpr));
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
  // fit the plinth corner to corner, and the cube's height
  const fit = Math.min(W / ((GX + GZ) * 0.72), H / (CUBE * 1.9));
  cam.inv = 1 / (fit * zoom);
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

let tool = 1; // 1 rain, 2 water, 3 wind
let hover = false;
let held = false;
let turning = false;
let ptr = { x: 0, y: 0 }; // CSS pixels: the ray is taken from it every frame, the camera may have moved
let last = { x: 0, y: 0 };

const toolButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-tool]')];
function setTool(t: number) {
  tool = t;
  for (const b of toolButtons) b.classList.toggle('on', Number(b.dataset.tool) === t);
}
for (const b of toolButtons) b.addEventListener('click', () => setTool(Number(b.dataset.tool)));
document.querySelector('#reset')?.addEventListener('click', () => reset());
setTool(1);

canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch { /* a made-up pointer in a test */ }
  ptr = { x: e.clientX, y: e.clientY };
  hover = true;
  last = { x: e.clientX, y: e.clientY };
  if (e.button === 0 && overRock(rayOrigin(ptr.x, ptr.y))) held = true;
  else turning = true;
});
canvas.addEventListener('pointermove', (e) => {
  if (turning) {
    yaw -= (e.clientX - last.x) * 0.008;
    pitch = Math.min(1.2, Math.max(0.2, pitch + (e.clientY - last.y) * 0.005));
    last = { x: e.clientX, y: e.clientY };
    return;
  }
  hover = true;
  ptr = { x: e.clientX, y: e.clientY };
});
const release = () => { held = false; turning = false; };
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
  if (e.key >= '1' && e.key <= '3') setTool(Number(e.key));
  else if (e.key === 'r' || e.key === 'R') reset();
  else if (e.key === 'ArrowLeft') yaw -= Math.PI / 2;
  else if (e.key === 'ArrowRight') yaw += Math.PI / 2;
});

// ---------- frame ----------

let step = 0;
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
  const wind = norm([cam.f[0], 0, cam.f[2]]);

  uData.set([...cam.o, 0], 0);
  uData.set([...cam.r, cam.inv], 4);
  uData.set([...cam.u, 0], 8);
  uData.set([...cam.f, 0], 12);
  uData.set([W, H, t / 1000, P.windR], 16);
  uData.set([...sun, 0], 20);
  uData.set([...rayOrigin(ptr.x, ptr.y), held ? 1 : 0], 24);
  uData.set([...cam.f, tool], 28);
  uData.set([wind[0], 0, wind[2], P.rainR], 32);
  uData.set([P.erode, P.sedYield, P.evap, P.rainRate], 36);
  uData.set([P.windRate, P.hoseRate, P.supportLimit, hover ? 1 : 0], 40);
  device.queue.writeBuffer(uBuf, 0, uData);

  {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, simGroup);
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

// ?hold=0.42,0.3,1: a tool held from the start, on a point given as a fraction of the screen
const holdAt = query.get('hold')?.split(',').map(Number);
if (holdAt) {
  setTool(holdAt[2] || 1);
  ptr = { x: holdAt[0] * window.innerWidth, y: holdAt[1] * window.innerHeight };
  hover = true;
  held = true;
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
  // run frames by hand, for when the page is hidden and the browser holds its own back
  tick(n = 1) { for (let i = 0; i < n; i++) frame(performance.now()); },
  // read the grid back: how many cells of each type, and what the pointer is on
  async stats() {
    const read = async (src: GPUBuffer) => {
      const dst = device.createBuffer({ size: src.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(src, 0, dst, 0, src.size);
      device.queue.submit([enc.finish()]);
      await dst.mapAsync(GPUMapMode.READ);
      const out = dst.getMappedRange().slice(0);
      dst.destroy();
      return out;
    };
    const cells = new Uint32Array(await read(cellBuf));
    const count = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < cells.length; i++) count[cells[i] & 7]++;
    const [air, water, sediment, rock, ground] = count;
    return { air, water, sediment, rock, ground, pick: [...new Float32Array(await read(pickBuf))], step, held, hover, tool };
  },
};
