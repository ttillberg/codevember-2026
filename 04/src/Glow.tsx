// An experiment beside the trails in Cars.tsx: the lights of the traffic as a real long exposure, on a WebGPU canvas over the picture.
/// <reference types="@webgpu/types" />
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { useThree } from '@react-three/fiber';
import { Matrix4, type Camera } from 'three';
import { NIGHT } from './haze';
import { PARKED, type Car } from './sim';
import { SMEAR_R } from './paint';
import { SOAK, WET } from './wet';

/**
 * The light is not kept on the picture, where the drone's own motion would smear it, but on the ground: one float texture
 * that is a map of the town seen from straight above. Every frame the map fades a little, every vehicle under way draws
 * the stretch it has just driven into it, and the map is laid on the ground with the camera of the WebGL scene.
 *
 * SPAN is the whole network (lanes run to 600 m either side of the middle). At 2048 texels that is 0.59 m a texel, about a
 * screen point and a half in the default shot: a lamp's light on a road is wider than that. 4096 would be four times
 * the pixels to fade every frame, for an edge nobody sees.
 */
// half the map on a phone: a quarter of the memory, and the light is soft enough not to show it
const MID = [0, 0], SPAN = 1200, SIZE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 1024 : 2048;
/** Sixteen-bit floats: they blend and filter without any optional feature, and a fading light never sticks at a grey as it does in bytes. */
const FORMAT: GPUTextureFormat = 'rgba16float';
/** Stretches of light drawn in one frame at most, and the numbers kept for each. */
const SEGS = 8192, REC = 12;
/** What a stretch is the light of: a head lamp, a tail lamp, the blue or the red flash of an emergency vehicle, or the beam on the road ahead. */
const HEAD = 0, TAIL = 1, FLASH = 2, BEAM = 4;
/** How far ahead of a vehicle its head lamps show the road, metres, and how bright that is beside the lamps themselves. */
const REACH = 46, SHINE = 0.085;
/** Seconds of their time between two notes of where a vehicle is: short enough that a turn through a junction stays a curve. */
const EVERY = 0.35;
/** How high a lamp sits on a vehicle, metres. */
const LAMP = 0.6;
/** Canvas pixels to a screen point. The light is soft: one is enough, and a quarter of the pixels of the picture under it. */
const DPR = 1;
/** How bright the map is shown. */
const GAIN = 1.5;

const FADE = /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0.0, 1.0);
}
// the blend multiplies what is there by the blend constant: this colour is not used
@fragment fn fs() -> @location(0) vec4f { return vec4f(0.0); }`;

const SPLAT = /* wgsl */ `
struct Out { @builtin(position) pos: vec4f, @location(0) at: vec2f, @location(1) len: f32, @location(2) @interpolate(flat) lamp: vec2f, @location(3) age: vec2f };
const HALF = 4.5; // metres either side of the way that the light reaches
const CAP = 1.2;  // metres over which one stretch hands over to the next
const FAN = 12.0; // metres either side of a vehicle's heading that its beam reaches, at its far end
@vertex fn vs(@builtin(vertex_index) i: u32, @location(0) ab: vec4f, @location(1) k: vec4f) -> Out {
  let a = ab.xy; let b = ab.zw; let d = b - a; let len = length(d);
  let along = select(vec2f(1.0, 0.0), d / max(len, 1e-4), len > 1e-3);
  let across = vec2f(-along.y, along.x);
  // a beam is not a stretch of the way but a cone ahead of the vehicle: wider, and with no ends to hand over
  let beam = k.z > 3.5;
  let cap = select(CAP, 0.0, beam); let half = select(HALF, FAN, beam);
  let s = mix(-cap, len + cap, f32(i & 1u)); let v = mix(-half, half, f32(i >> 1u));
  let p = (a + along * s + across * v - vec2f(${MID[0]}, ${MID[1]})) / ${SPAN / 2}.0;
  var o: Out;
  o.pos = vec4f(p.x, -p.y, 0.0, 1.0);
  o.at = vec2f(s, v); o.len = len; o.lamp = k.zw; o.age = k.xy;
  return o;
}
@fragment fn fs(o: Out) -> @location(0) vec4f {
  let s = o.at.x; let v = o.at.y;
  if (o.lamp.x > 3.5) {
    // the beam: narrow and bright at the nose, wider and fainter the further it goes. One of these is laid down for every
    // note of where the vehicle is, so through a bend they add up to a fan on the outside of it
    let t = clamp(s / max(o.len, 1e-3), 0.0, 1.0);
    let wide = 1.1 + 7.5 * t; let x = v / wide;
    let far = (1.0 - t) * (1.0 - t) * smoothstep(0.0, 0.05, t);
    return vec4f(vec3f(1.0, 0.86, 0.64) * exp(-x * x) * far / wide * o.lamp.y * o.age.x, 1.0);
  }
  if (o.lamp.x > 1.5) {
    // the flashes of an emergency vehicle: one colour to a stretch, wide as the road
    let age = mix(o.age.x, o.age.y, clamp(s / max(o.len, 1e-3), 0.0, 1.0));
    let ends = clamp((s + CAP) / (2.0 * CAP), 0.0, 1.0) * clamp((o.len + CAP - s) / (2.0 * CAP), 0.0, 1.0);
    let w = v / 2.2;
    return vec4f(mix(vec3f(0.08, 0.3, 1.0), vec3f(1.0, 0.06, 0.03), o.lamp.x - 2.0) * exp(-w * w) * ends * age * o.lamp.y, 1.0);
  }
  // each stretch fades in over the end of the one before, so a straight way is one even line and not a string of beads
  let ends = clamp((s + CAP) / (2.0 * CAP), 0.0, 1.0) * clamp((o.len + CAP - s) / (2.0 * CAP), 0.0, 1.0);
  // older towards where it came from
  let age = mix(o.age.x, o.age.y, clamp(s / max(o.len, 1e-3), 0.0, 1.0));
  // two lamps, and what the road gives back of them
  let e = (abs(v) - 0.7) / 0.55; let lamps = exp(-e * e);
  let w = v / 2.4; let wash = exp(-w * w);
  let head = vec3f(1.0, 0.84, 0.6) * (0.9 * lamps + 0.3 * wash);
  let tail = vec3f(1.0, 0.07, 0.03) * (1.0 * lamps + 0.1 * wash);
  return vec4f(mix(head, tail, o.lamp.x) * o.lamp.y * ends * age, 1.0);
}`;

const SHOW = /* wgsl */ `
struct U { vp: mat4x4f, k: vec4f, wet: vec4f, soak: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var map: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let uv = vec2f(f32(i & 1u), f32(i >> 1u));
  let w = (uv - 0.5) * ${SPAN}.0 + vec2f(${MID[0]}, ${MID[1]});
  var p = u.vp * vec4f(w.x, 0.0, w.y, 1.0);
  // the matrix is the WebGL one, with its depth from -1 to 1: there is no depth here, any that is inside will do
  p.z = 0.5 * p.w;
  var o: Out; o.pos = p; o.uv = uv;
  return o;
}
fn fall(p: vec2f) -> f32 {
  let d = p - u.wet.xy;
  let q = dot(d, d) / ${(SMEAR_R * SMEAR_R).toFixed(1)};
  return select(0.0, (1.0 - q) * (1.0 - q), q < 1.0);
}
@fragment fn fs(o: Out) -> @location(0) vec4f {
  // while a smear is dragged the light goes with the traffic, pushed as the roads are (wet.ts): this point of the
  // ground shows what was drawn where it was pushed from. Found by going back a few times, close enough for a short push
  let x = (o.uv - 0.5) * ${SPAN}.0 + vec2f(${MID[0]}, ${MID[1]});
  let push = (u.wet.zw - u.soak.xy) * u.soak.z;
  var w = x;
  for (var i = 0; i < 3; i++) { w = x - push * fall(w); }
  let c = textureSampleLevel(map, smp, (w - vec2f(${MID[0]}, ${MID[1]})) / ${SPAN}.0 + 0.5, 0.0).rgb * u.k.x;
  // a shoulder, as film has: a lamp that stands still burns out to white instead of clipping to its colour
  let lit = 1.0 - exp(-c);
  // a little noise, or the faint end of a trail shows its steps
  let n = fract(sin(dot(o.pos.xy + u.k.y, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  return vec4f(max(lit + n / 255.0, vec3f(0.0)), 1.0);
}`;

const WALLS = /* wgsl */ `
struct U { vp: mat4x4f, k: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@location(0) at: vec3f) -> @builtin(position) vec4f {
  var p = u.vp * vec4f(at, 1.0);
  p.z = 0.5 * p.w;
  return p;
}
@fragment fn fs() -> @location(0) vec4f { return vec4f(0.0, 0.0, 0.0, 1.0); }`;

/** Something with walls that the light on the ground cannot be seen through: its place, its height, and how it is turned. */
export interface Wall {
  x0: number; y0: number; x1: number; y1: number; h: number;
  turn?: number;
  inner?: { x0: number; y0: number; x1: number; y1: number };
  canopy?: boolean;
}

let asked: Promise<GPUDevice | null> | null = null;
/** The graphics card through WebGPU, asked for once. Null where the browser has none, or will not give it. */
export function gpu(): Promise<GPUDevice | null> {
  asked ??= (async () => {
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      const device = await adapter?.requestDevice();
      if (!device) return null;
      // a device that is lost is asked for again the next time
      device.lost.then(() => { asked = null; });
      return device;
    } catch {
      return null;
    }
  })();
  return asked;
}

const step = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const vp = new Matrix4();

/** The canvas, the map and what draws them. No React in here. */
class Layer {
  readonly canvas = document.createElement('canvas');
  private ctx: GPUCanvasContext;
  private map: GPUTexture;
  private fade: GPURenderPipeline; private splat: GPURenderPipeline; private show: GPURenderPipeline; private walls: GPURenderPipeline;
  private segs: GPUBuffer; private uni: GPUBuffer; private boxes: GPUBuffer | null = null;
  private bind: GPUBindGroup; private bindWalls: GPUBindGroup;
  private nBoxes = 0;
  /** stretches noted since the last frame: from, to (x, height, y each), when at either end, head or tail, how strong, heading */
  private rec = new Float32Array(SEGS * REC);
  private n = 0;
  private out = new Float32Array(SEGS * 8);
  private u = new Float32Array(28);
  /** where the lamps of each vehicle were when last noted: head x y, tail x y, height, when */
  private last = new WeakMap<object, Float32Array>();
  private noted = -1e9; private drawn = -1; private blank = true; private lit = false;
  /** how many notes have been taken: the flashes of an emergency vehicle take turns by it */
  private notes = 0;
  private dead = false;

  constructor(private device: GPUDevice, host: HTMLElement) {
    const c = this.canvas;
    c.className = 'glow';
    host.appendChild(c);
    this.ctx = c.getContext('webgpu')!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    // opaque black where there is no light: the page adds it to the picture under it (mix-blend-mode in style.css)
    this.ctx.configure({ device, format, alphaMode: 'opaque' });
    this.map = device.createTexture({ size: [SIZE, SIZE], format: FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const mod = (code: string) => device.createShaderModule({ code });
    const make = (code: string, target: GPUColorTargetState, buffers: GPUVertexBufferLayout[] = [], topology: GPUPrimitiveTopology = 'triangle-strip') => {
      const module = mod(code);
      return device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs', buffers }, fragment: { module, entryPoint: 'fs', targets: [target] }, primitive: { topology } });
    };
    const times: GPUBlendComponent = { srcFactor: 'zero', dstFactor: 'constant', operation: 'add' };
    const plus: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
    this.fade = make(FADE, { format: FORMAT, blend: { color: times, alpha: times } }, [], 'triangle-list');
    this.splat = make(SPLAT, { format: FORMAT, blend: { color: plus, alpha: plus } }, [{
      arrayStride: 32, stepMode: 'instance',
      attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }],
    }]);
    this.show = make(SHOW, { format });
    this.walls = make(WALLS, { format }, [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }], 'triangle-list');
    this.segs = device.createBuffer({ size: this.out.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.uni = device.createBuffer({ size: this.u.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const smp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.bind = device.createBindGroup({ layout: this.show.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uni } }, { binding: 1, resource: this.map.createView() }, { binding: 2, resource: smp }] });
    this.bindWalls = device.createBindGroup({ layout: this.walls.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uni } }] });
  }

  resize(w: number, h: number) {
    this.canvas.width = Math.max(1, Math.round(w * DPR));
    this.canvas.height = Math.max(1, Math.round(h * DPR));
  }

  /** Whatever stands between the camera and the ground, as black boxes: the layer knows no depth, so they are drawn over the light. */
  setWalls(list: Wall[]) {
    this.boxes?.destroy();
    this.boxes = null;
    const solid = list.filter((b) => !b.canopy && b.h > 0);
    this.nBoxes = solid.length * 30;
    if (!solid.length) return;
    const v = new Float32Array(this.nBoxes * 3);
    let o = 0;
    const put = (p: number[], y: number) => { v[o++] = p[0]; v[o++] = y; v[o++] = p[1]; };
    for (const b of solid) {
      const r = b.inner ?? b, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, c = Math.cos(b.turn ?? 0), s = Math.sin(b.turn ?? 0);
      const q = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].map(([x, y]) => [cx + (x - cx) * c + (y - cy) * s, cy - (x - cx) * s + (y - cy) * c]);
      for (let i = 0; i < 4; i++) {
        const a = q[i], d = q[(i + 1) % 4];
        put(a, 0); put(d, 0); put(d, b.h); put(a, 0); put(d, b.h); put(a, b.h);
      }
      put(q[0], b.h); put(q[1], b.h); put(q[2], b.h); put(q[0], b.h); put(q[2], b.h); put(q[3], b.h);
    }
    this.boxes = this.device.createBuffer({ size: v.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.boxes, 0, v);
  }

  /** Note where every vehicle under way is now. Called between the steps of the traffic; it takes only as many as it needs. */
  sample(cars: Car[], time: number, now = false) {
    if (NIGHT.value <= 0.01 || (!now && time - this.noted < EVERY) || time === this.noted) return;
    this.noted = time;
    this.notes++;
    const rec = this.rec;
    for (const c of cars) {
      if (c.state === PARKED) continue;
      let l = this.last.get(c);
      const fresh = !l;
      if (!l) this.last.set(c, l = new Float32Array(6));
      const fx = Math.cos(c.ang), fy = Math.sin(c.ang), half = c.len / 2 - 0.2;
      const hx = c.x + fx * half, hy = c.y + fy * half, tx = c.x - fx * half, ty = c.y - fy * half;
      // a jump is not a journey: whoever was moved with the roads, or was not followed for a while, starts again
      const gap = time - l[5];
      let moved = 0;
      if (!fresh && gap < 3 && Math.hypot(hx - l[0], hy - l[1]) < 40 * Math.max(gap, 0.1) + 4) {
        moved = Math.hypot(hx - l[0], hy - l[1]);
        // a lamp that stands still would add up to a sun; one that moves is as bright per metre however fast it goes
        const w = Math.min(1, 0.1 + moved / 3);
        // the head lamps, the tail lamps, and for an emergency vehicle its flash, with its own lamps turned down under it:
        // mostly blue, the one colour nothing else on the road has, and red now and then
        for (let k = 0, n = c.siren ? 3 : 2; k < n && this.n < SEGS; k++) {
          const o = this.n++ * REC, tail = k === 1, p = tail ? 2 : 0;
          rec[o] = l[p]; rec[o + 1] = l[4]; rec[o + 2] = l[p + 1];
          rec[o + 3] = tail ? tx : hx; rec[o + 4] = c.h; rec[o + 5] = tail ? ty : hy;
          rec[o + 6] = l[5]; rec[o + 7] = time; rec[o + 8] = k < 2 ? k : FLASH + (this.notes & 3 ? 0 : 1); rec[o + 9] = k < 2 ? (c.siren ? 0.3 * w : w) : 1.1 * w; rec[o + 10] = fx; rec[o + 11] = fy;
        }
      }
      // The beam on the road ahead, as it lies at this moment: it is exposed like the rest, and by how far the vehicle
      // has come since the last note, so that a fast one does not lay less light on a metre of road than a slow one
      if (this.n < SEGS) {
        const o = this.n++ * REC, y = c.h - LAMP;
        rec[o] = hx; rec[o + 1] = y; rec[o + 2] = hy;
        rec[o + 3] = hx + fx * REACH; rec[o + 4] = y; rec[o + 5] = hy + fy * REACH;
        rec[o + 6] = time; rec[o + 7] = time; rec[o + 8] = BEAM; rec[o + 9] = SHINE * (0.05 + moved); rec[o + 10] = fx; rec[o + 11] = fy;
      }
      l[0] = hx; l[1] = hy; l[2] = tx; l[3] = ty; l[4] = c.h; l[5] = time;
    }
  }

  /**
   * One frame: fade the map, add the stretches driven since the last one, lay the map on the ground as the camera sees it.
   * `stay` is the seconds of their time a light stays on the picture, the same number the other trails are given.
   */
  draw(cars: Car[], time: number, camera: Camera, stay: number) {
    if (this.dead) return;
    const night = NIGHT.value, lit = night > 0.01;
    if (lit !== this.lit) { this.lit = lit; this.canvas.style.display = lit ? '' : 'none'; }
    if (!lit) { this.n = 0; this.blank = true; return; }
    this.sample(cars, time, true);

    // the light is half gone after a third of the time it is said to stay
    const tau = Math.max(stay, 0.01) / 2;
    const keep = this.drawn < 0 || time < this.drawn ? 1 : Math.exp(-(time - this.drawn) / tau);
    this.drawn = time;

    // A lamp is above the ground and the map is flat, so each point is put where the camera sees it on the ground.
    // That also puts the traffic on a bridge where the bridge is in the picture, as long as the drone has not flown far since.
    const C = camera.position, rec = this.rec, out = this.out;
    for (let i = 0; i < this.n; i++) {
      const o = i * REC, q = i * 8;
      const ka = C.y / (C.y - rec[o + 1] - LAMP), kb = C.y / (C.y - rec[o + 4] - LAMP);
      const bx = C.x + (rec[o + 3] - C.x) * kb, by = C.z + (rec[o + 5] - C.z) * kb;
      out[q] = C.x + (rec[o] - C.x) * ka; out[q + 1] = C.z + (rec[o + 2] - C.z) * ka; out[q + 2] = bx; out[q + 3] = by;
      // a vehicle that stands still has no way to draw along: a hair's breadth along its heading gives its lamps their sides
      if (Math.abs(bx - out[q]) + Math.abs(by - out[q + 1]) < 0.01) { out[q] = bx - rec[o + 10] * 0.01; out[q + 1] = by - rec[o + 11] * 0.01; }
      out[q + 4] = Math.exp(-(time - rec[o + 6]) / tau); out[q + 5] = Math.exp(-(time - rec[o + 7]) / tau);
      // head lamps show to whoever they come towards, tail lamps to whoever they leave: lanes turn white or red by which way they run
      const dx = C.x - bx, dy = C.z - by, d = Math.hypot(dx, dy) || 1, toward = (rec[o + 10] * dx + rec[o + 11] * dy) / d;
      const kind = rec[o + 8];
      out[q + 6] = kind;
      // a flash shows all round; a beam is on the road for anyone to see, but less from behind, or every lane would be white
      out[q + 7] = rec[o + 9] * (kind === HEAD || kind === TAIL ? 0.12 + 0.88 * step(-0.4, 0.6, kind === TAIL ? -toward : toward) : kind === BEAM ? 0.15 + 0.85 * step(-0.4, 0.6, toward) : 1);
    }
    const n = this.n;
    this.n = 0;

    // the camera as the WebGL scene is about to use it: the drone has moved it this frame, its matrices follow only when it is drawn
    camera.updateMatrixWorld();
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.u.set(vp.elements);
    this.u[16] = GAIN * night; this.u[17] = (time * 7.3) % 61;
    WET.value.toArray(this.u, 20);
    SOAK.traffic.value.toArray(this.u, 24);

    const { device } = this;
    let view: GPUTextureView;
    try {
      view = this.ctx.getCurrentTexture().createView();
    } catch {
      return;
    }
    if (n) device.queue.writeBuffer(this.segs, 0, out, 0, n * 8);
    device.queue.writeBuffer(this.uni, 0, this.u);
    const enc = device.createCommandEncoder();
    const a = enc.beginRenderPass({ colorAttachments: [{ view: this.map.createView(), loadOp: this.blank ? 'clear' : 'load', clearValue: [0, 0, 0, 1], storeOp: 'store' }] });
    this.blank = false;
    if (keep < 1) {
      a.setPipeline(this.fade);
      a.setBlendConstant([keep, keep, keep, 1]);
      a.draw(3);
    }
    if (n) {
      a.setPipeline(this.splat);
      a.setVertexBuffer(0, this.segs);
      a.draw(4, n);
    }
    a.end();
    const b = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store' }] });
    b.setPipeline(this.show);
    b.setBindGroup(0, this.bind);
    b.draw(4);
    if (this.boxes) {
      b.setPipeline(this.walls);
      b.setBindGroup(0, this.bindWalls);
      b.setVertexBuffer(0, this.boxes);
      b.draw(this.nBoxes);
    }
    b.end();
    device.queue.submit([enc.finish()]);
  }

  dispose() {
    this.dead = true;
    this.canvas.remove();
    this.ctx.unconfigure();
    this.map.destroy(); this.segs.destroy(); this.uni.destroy(); this.boxes?.destroy();
  }
}

/** What the traffic calls: `sample` between its steps, `draw` once it has moved everything for the frame. */
export type GlowHandle = Pick<Layer, 'sample' | 'draw'>;

/**
 * The layer, mounted inside the WebGL canvas's own React tree so that it lives and dies with it, but drawing on a canvas of its own.
 * It draws nothing by itself: Cars drives it from the same frame as the scene, after the drone and the traffic have moved.
 */
export function Glow({ ref, walls, onFail }: {
  ref: Ref<GlowHandle | null>;
  walls: Wall[];
  /** no WebGPU after all, or the device was lost */
  onFail?: () => void;
}) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const layer = useRef<Layer | null>(null);
  const now = useRef({ size, walls, onFail });
  now.current = { size, walls, onFail };
  useImperativeHandle(ref, () => ({
    sample: (cars, time, force) => layer.current?.sample(cars, time, force),
    draw: (cars, time, camera, stay) => layer.current?.draw(cars, time, camera, stay),
  }), []);
  useEffect(() => {
    let gone = false;
    gpu().then((device) => {
      if (gone) return;
      const host = gl.domElement.parentElement;
      if (!device || !host) { now.current.onFail?.(); return; }
      try {
        const l = new Layer(device, host);
        l.resize(now.current.size.width, now.current.size.height);
        l.setWalls(now.current.walls);
        layer.current = l;
        device.lost.then(() => { if (!gone) now.current.onFail?.(); });
      } catch (e) {
        console.warn('glow', e);
        now.current.onFail?.();
      }
    });
    return () => { gone = true; layer.current?.dispose(); layer.current = null; };
  }, [gl]);
  useEffect(() => layer.current?.resize(size.width, size.height), [size]);
  useEffect(() => layer.current?.setWalls(walls), [walls]);
  return null;
}
