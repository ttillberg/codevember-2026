import { Vec3, Quat } from './math';
import { Palette } from './palettes';
import { Plane } from './poly';
import {
  CAUSTICS_CUT_WGSL,
  CAUSTICS_WGSL,
  CRACKS_WGSL,
  FLOOR_WGSL,
  GLASS_WGSL,
  PLANE_WGSL,
  SECTION_WGSL,
  SHARDS_BACK_WGSL,
  SHARDS_WGSL,
  SPLINTERS_COMPUTE_WGSL,
  SPLINTERS_RENDER_WGSL,
  SURFACE_CRACKS_WGSL,
} from './shaders';

export const MAX_SHARDS = 2048;
export const MAX_SPLINTERS = 4096;
export const MAX_CUT_SLOTS = 24;
const MAX_BLOCK_PARTS = 12;
const POLY_PLANES_BYTES = 48 + 64 * 16; // info(16) + offset(16) + quat(16) + 64*vec4(1024) = 1072 bytes
const MSAA_SAMPLES = 4;

export interface GpuPerfOptions {
  maxSplinters?: number;
  causticRes?: number;
}

export interface FrameParams {
  viewProj: Float32Array;
  invViewProj: Float32Array;
  camPos: Vec3;
  time: number;
  dt: number;
  lightDir: Vec3;
  causticStrength: number;
  blockCenter: Vec3;
  blockQuat: Quat;
  halfSize: Vec3;
  ior: number;
  dispersion: number;
  palette: Palette;
  crackProgress: number;
  planeHover: number;
  cutRadius: number;
  cutPlaneN: Vec3;
  cutPlane2N: Vec3 | null;
  cutRadius2: number;
  cutOffsets: Vec3[]; // 0, 1, or 2 world drift offsets for active cracking chunks
  cutQuat: Quat;
  hasCutPiece: boolean;
  planeAlpha: number;
  canCut: boolean;
  exposure: number;
  floorScrollVelZ?: number;
}

export interface SplinterSpawn {
  pos: Vec3;
  vel: Vec3;
  size: number;
  maxAge: number;
  color: Vec3;
  spinSpeed: number;
}

export interface CutPieceUpload {
  verts: Float32Array;
  planes: Plane[];
  crackVerts: Float32Array;
  surfaceCrackVerts: Float32Array;
}

interface BlockPartSlot {
  vb: GPUBuffer | null;
  vertCount: number;
  planesBuf: GPUBuffer;
  glassBG: GPUBindGroup;
}

interface CutSlot {
  vb: GPUBuffer | null;
  vertCount: number;
  crackVB: GPUBuffer | null;
  crackVertCount: number;
  surfaceCrackVB: GPUBuffer | null;
  surfaceCrackVertCount: number;
  planesBuf: GPUBuffer;
  causticCutBG: GPUBindGroup;
  cutGlassBG: GPUBindGroup;
  cracksBG: GPUBindGroup;
  surfaceCracksBG: GPUBindGroup;
}

export class GpuEngine {
  device!: GPUDevice;
  context!: GPUCanvasContext;
  format!: GPUTextureFormat;
  canvas: HTMLCanvasElement;

  private msaaTex: GPUTexture | null = null;
  private msaaView: GPUTextureView | null = null;
  private depthTex: GPUTexture | null = null;
  private depthView: GPUTextureView | null = null;
  private bgTex: GPUTexture | null = null;
  private bgView: GPUTextureView | null = null;
  private shardBackTex: GPUTexture | null = null;
  private shardBackView: GPUTextureView | null = null;
  private shardBackDepth: GPUTexture | null = null;
  private shardBackDepthView: GPUTextureView | null = null;
  private width = 1;
  private height = 1;

  private readonly maxSplinters: number;
  private readonly causticRes: number;
  private hasSplinters = false;

  private causticTex!: GPUTexture;
  private causticView!: GPUTextureView;
  private causticSampler!: GPUSampler;

  // Uniform & storage buffers
  private sceneBuf!: GPUBuffer;
  private sceneData = new Float32Array(368 / 4);
  private shardPosesBuf!: GPUBuffer;
  private shardPosesCPU = new Float32Array(MAX_SHARDS * 8);
  private splinterBuf!: GPUBuffer;
  private splinterCursor = 0;

  // Multi-part main block slots (1 for convex shapes, up to 12 for carved concave letters!)
  private blockSlots: BlockPartSlot[] = [];
  private activeBlockParts = 0;

  // Up to MAX_CUT_SLOTS independent tumbling chunks / flying gems
  private cutSlots: CutSlot[] = [];
  private activeCutSlots = 0;

  private sectionVB: GPUBuffer | null = null;
  private sectionVertCount = 0;

  private shardBatches: Array<{ vb: GPUBuffer; vertCount: number; baseShardId: number; numShards: number }> = [];

  // Pipelines & bind groups
  private floorPipe!: GPURenderPipeline;
  private floorBG!: GPUBindGroup;

  private causticBlockPipe!: GPURenderPipeline;
  private causticCutPipe!: GPURenderPipeline;
  private causticShardsPipe!: GPURenderPipeline;
  private causticBG!: GPUBindGroup;

  private glassPipe!: GPURenderPipeline;
  private cutGlassPipe!: GPURenderPipeline;
  private cracksPipe!: GPURenderPipeline;
  private surfaceCracksPipe!: GPURenderPipeline;

  private shardsBackDepthPipe!: GPURenderPipeline;
  private shardsInnerPipe!: GPURenderPipeline;
  private shardsBackBG!: GPUBindGroup;
  private shardsPipe!: GPURenderPipeline;
  private shardsBG: GPUBindGroup | null = null;

  private splintersCompPipe!: GPUComputePipeline;
  private splintersCompBG!: GPUBindGroup;
  private splintersRenderPipe!: GPURenderPipeline;
  private splintersRenderBG!: GPUBindGroup;

  private planePipe!: GPURenderPipeline;
  private planeBG!: GPUBindGroup;

  private sectionPipe!: GPURenderPipeline;
  private sectionBG!: GPUBindGroup;

  constructor(canvas: HTMLCanvasElement, opts: GpuPerfOptions = {}) {
    this.canvas = canvas;
    this.maxSplinters = Math.max(64, Math.min(MAX_SPLINTERS, Math.floor(opts.maxSplinters ?? MAX_SPLINTERS)));
    this.causticRes = opts.causticRes ?? 1024;
  }

  async init(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not available in this browser. Try a recent Chrome, Edge, or Safari.');
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      throw new Error('Could not acquire a WebGPU adapter.');
    }
    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
    });

    this.createResources();
    this.createPipelines();
    this.resize(this.canvas.width || 1280, this.canvas.height || 800);
  }

  private createResources() {
    const dev = this.device;

    this.sceneBuf = dev.createBuffer({
      size: 368,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.shardPosesBuf = dev.createBuffer({
      size: MAX_SHARDS * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.splinterBuf = dev.createBuffer({
      size: this.maxSplinters * 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.causticTex = dev.createTexture({
      size: [this.causticRes, this.causticRes],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.causticView = this.causticTex.createView();
    this.causticSampler = dev.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  private createPipelines() {
    const dev = this.device;
    const fmt = this.format;

    // 1. Floor + studio cyclorama
    const floorMod = dev.createShaderModule({ code: FLOOR_WGSL });
    this.floorPipe = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: floorMod, entryPoint: 'vs_main' },
      fragment: { module: floorMod, entryPoint: 'fs_main', targets: [{ format: fmt }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
      multisample: { count: MSAA_SAMPLES },
    });
    this.floorBG = dev.createBindGroup({
      layout: this.floorPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.sceneBuf } },
        { binding: 1, resource: this.causticView },
        { binding: 2, resource: this.causticSampler },
      ],
    });

    // 2. Fake Caustics + Shadow projection
    const caustMod = dev.createShaderModule({ code: CAUSTICS_WGSL });
    const caustTarget: GPUColorTargetState = {
      format: 'rgba16float',
      blend: {
        color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
    };
    const caustBGL = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const caustPL = dev.createPipelineLayout({ bindGroupLayouts: [caustBGL] });
    this.causticBG = dev.createBindGroup({
      layout: caustBGL,
      entries: [
        { binding: 0, resource: { buffer: this.sceneBuf } },
        { binding: 1, resource: { buffer: this.shardPosesBuf } },
      ],
    });
    const polyVBLayout: GPUVertexBufferLayout = {
      arrayStride: 24,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
      ],
    };
    this.causticBlockPipe = dev.createRenderPipeline({
      layout: caustPL,
      vertex: { module: caustMod, entryPoint: 'vs_block', buffers: [polyVBLayout] },
      fragment: { module: caustMod, entryPoint: 'fs_main', targets: [caustTarget] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });
    const caustCutMod = dev.createShaderModule({ code: CAUSTICS_CUT_WGSL });
    this.causticCutPipe = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: caustCutMod, entryPoint: 'vs_cut', buffers: [polyVBLayout] },
      fragment: { module: caustCutMod, entryPoint: 'fs_main', targets: [caustTarget] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });
    const shardVBLayout: GPUVertexBufferLayout = {
      arrayStride: 40,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x3' },
        { shaderLocation: 3, offset: 36, format: 'float32' },
      ],
    };
    this.causticShardsPipe = dev.createRenderPipeline({
      layout: caustPL,
      vertex: { module: caustMod, entryPoint: 'vs_shards', buffers: [shardVBLayout] },
      fragment: { module: caustMod, entryPoint: 'fs_main', targets: [caustTarget] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });

    // 3. Main Glass Block + Severed Cut Piece(s)
    const glassMod = dev.createShaderModule({ code: GLASS_WGSL });
    this.glassPipe = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: glassMod, entryPoint: 'vs_main', buffers: [polyVBLayout] },
      fragment: { module: glassMod, entryPoint: 'fs_main', targets: [{ format: fmt }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: MSAA_SAMPLES },
    });
    this.cutGlassPipe = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: glassMod, entryPoint: 'vs_main', buffers: [polyVBLayout] },
      fragment: { module: glassMod, entryPoint: 'fs_main', targets: [{ format: fmt }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: MSAA_SAMPLES },
    });

    // 4. Internal & Exterior Cracks (bound per cutSlot so each chunk uses its own poly.offset!)
    const cracksMod = dev.createShaderModule({ code: CRACKS_WGSL });
    this.cracksPipe = dev.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: cracksMod,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 32,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32' },
            { shaderLocation: 3, offset: 28, format: 'float32' },
          ],
        }],
      },
      fragment: {
        module: cracksMod,
        entryPoint: 'fs_main',
        targets: [{
          format: fmt,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
      multisample: { count: MSAA_SAMPLES },
    });

    const surfCrackMod = dev.createShaderModule({ code: SURFACE_CRACKS_WGSL });
    this.surfaceCracksPipe = dev.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: surfCrackMod,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 40,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32' },
            { shaderLocation: 3, offset: 28, format: 'float32' },
            { shaderLocation: 4, offset: 32, format: 'float32' },
            { shaderLocation: 5, offset: 36, format: 'float32' },
          ],
        }],
      },
      fragment: {
        module: surfCrackMod,
        entryPoint: 'fs_main',
        targets: [{
          format: fmt,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
      multisample: { count: MSAA_SAMPLES },
    });

    // Pre-allocate block part slots & twin cut slots
    for (let i = 0; i < MAX_BLOCK_PARTS; i++) {
      const planesBuf = dev.createBuffer({
        size: POLY_PLANES_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const glassBG = dev.createBindGroup({
        layout: this.glassPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.sceneBuf } },
          { binding: 1, resource: { buffer: planesBuf } },
        ],
      });
      this.blockSlots.push({ vb: null, vertCount: 0, planesBuf, glassBG });
    }

    for (let i = 0; i < MAX_CUT_SLOTS; i++) {
      const planesBuf = dev.createBuffer({
        size: POLY_PLANES_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const causticCutBG = dev.createBindGroup({
        layout: this.causticCutPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.sceneBuf } },
          { binding: 1, resource: { buffer: planesBuf } },
        ],
      });
      const cutGlassBG = dev.createBindGroup({
        layout: this.cutGlassPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.sceneBuf } },
          { binding: 1, resource: { buffer: planesBuf } },
        ],
      });
      const cracksBG = dev.createBindGroup({
        layout: this.cracksPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.sceneBuf } },
          { binding: 1, resource: { buffer: planesBuf } },
        ],
      });
      const surfaceCracksBG = dev.createBindGroup({
        layout: this.surfaceCracksPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.sceneBuf } },
          { binding: 1, resource: { buffer: planesBuf } },
        ],
      });
      this.cutSlots.push({
        vb: null,
        vertCount: 0,
        crackVB: null,
        crackVertCount: 0,
        surfaceCrackVB: null,
        surfaceCrackVertCount: 0,
        planesBuf,
        causticCutBG,
        cutGlassBG,
        cracksBG,
        surfaceCracksBG,
      });
    }

    // 5. Shattered Rapier Rigid-Body Shards (true refractive crystal glass!)
    const shardsBackMod = dev.createShaderModule({ code: SHARDS_BACK_WGSL });
    const shardsBackBGL = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const shardsBackPL = dev.createPipelineLayout({ bindGroupLayouts: [shardsBackBGL] });
    this.shardsBackBG = dev.createBindGroup({
      layout: shardsBackBGL,
      entries: [
        { binding: 0, resource: { buffer: this.sceneBuf } },
        { binding: 1, resource: { buffer: this.shardPosesBuf } },
      ],
    });
    this.shardsBackDepthPipe = dev.createRenderPipeline({
      layout: shardsBackPL,
      vertex: { module: shardsBackMod, entryPoint: 'vs_main', buffers: [shardVBLayout] },
      fragment: { module: shardsBackMod, entryPoint: 'fs_depth', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list', cullMode: 'front' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this.shardsInnerPipe = dev.createRenderPipeline({
      layout: shardsBackPL,
      vertex: { module: shardsBackMod, entryPoint: 'vs_main', buffers: [shardVBLayout] },
      fragment: {
        module: shardsBackMod,
        entryPoint: 'fs_inner',
        targets: [{
          format: fmt,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'front' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
      multisample: { count: MSAA_SAMPLES },
    });
    const shardsMod = dev.createShaderModule({ code: SHARDS_WGSL });
    this.shardsPipe = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shardsMod, entryPoint: 'vs_main', buffers: [shardVBLayout] },
      fragment: {
        module: shardsMod,
        entryPoint: 'fs_main',
        targets: [{
          format: fmt,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: MSAA_SAMPLES },
    });

    // 6. WebGPU Compute Splinters
    const splCompMod = dev.createShaderModule({ code: SPLINTERS_COMPUTE_WGSL });
    this.splintersCompPipe = dev.createComputePipeline({
      layout: 'auto',
      compute: { module: splCompMod, entryPoint: 'cs_main' },
    });
    this.splintersCompBG = dev.createBindGroup({
      layout: this.splintersCompPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.sceneBuf } },
        { binding: 1, resource: { buffer: this.splinterBuf } },
      ],
    });

    const splRendMod = dev.createShaderModule({ code: SPLINTERS_RENDER_WGSL });
    this.splintersRenderPipe = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: splRendMod, entryPoint: 'vs_main' },
      fragment: {
        module: splRendMod,
        entryPoint: 'fs_main',
        targets: [{
          format: fmt,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: MSAA_SAMPLES },
    });
    this.splintersRenderBG = dev.createBindGroup({
      layout: this.splintersRenderPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.sceneBuf } },
        { binding: 1, resource: { buffer: this.splinterBuf } },
      ],
    });

    // 7. Side Cutting Plate(s) (1 or 2 symmetrical discs!)
    const planeMod = dev.createShaderModule({ code: PLANE_WGSL });
    this.planePipe = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: planeMod, entryPoint: 'vs_main' },
      fragment: {
        module: planeMod,
        entryPoint: 'fs_main',
        targets: [{
          format: fmt,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
      multisample: { count: MSAA_SAMPLES },
    });
    this.planeBG = dev.createBindGroup({
      layout: this.planePipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.sceneBuf } }],
    });

    // 8. Live Cut Cross-Section Contour Ribbon(s)
    const secMod = dev.createShaderModule({ code: SECTION_WGSL });
    this.sectionPipe = dev.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: secMod,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        }],
      },
      fragment: {
        module: secMod,
        entryPoint: 'fs_main',
        targets: [{
          format: fmt,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
      multisample: { count: MSAA_SAMPLES },
    });
    this.sectionBG = dev.createBindGroup({
      layout: this.sectionPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.sceneBuf } }],
    });
  }

  resize(width: number, height: number) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height && this.msaaTex) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;

    this.msaaTex?.destroy();
    this.depthTex?.destroy();
    this.bgTex?.destroy();
    this.shardBackTex?.destroy();
    this.shardBackDepth?.destroy();

    this.msaaTex = this.device.createTexture({
      size: [w, h],
      sampleCount: MSAA_SAMPLES,
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.msaaView = this.msaaTex.createView();
    this.depthTex = this.device.createTexture({
      size: [w, h],
      sampleCount: MSAA_SAMPLES,
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depthTex.createView();
    this.bgTex = this.device.createTexture({
      size: [w, h],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.bgView = this.bgTex.createView();

    this.shardBackTex = this.device.createTexture({
      size: [w, h],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.shardBackView = this.shardBackTex.createView();

    this.shardBackDepth = this.device.createTexture({
      size: [w, h],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.shardBackDepthView = this.shardBackDepth.createView();

    this.shardsBG = this.device.createBindGroup({
      layout: this.shardsPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.sceneBuf } },
        { binding: 1, resource: { buffer: this.shardPosesBuf } },
        { binding: 2, resource: this.bgView },
        { binding: 3, resource: this.shardBackView },
        { binding: 4, resource: this.causticSampler },
      ],
    });
  }

  private uploadPlanes(
    buf: GPUBuffer,
    planes: Plane[],
    isCutPiece: boolean,
    pos: Vec3 = [0, 0, 0],
    quat: Quat = [0, 0, 0, 1],
    gemId = 0,
  ) {
    const ab = new ArrayBuffer(POLY_PLANES_BYTES);
    const u32 = new Uint32Array(ab, 0, 4);
    const poseF32 = new Float32Array(ab, 16, 8);
    const f32 = new Float32Array(ab, 48, 64 * 4);
    const n = Math.min(64, planes.length);
    u32[0] = n;
    u32[1] = isCutPiece ? 1 : 0;
    u32[2] = gemId >>> 0;
    poseF32[0] = pos[0];
    poseF32[1] = pos[1];
    poseF32[2] = pos[2];
    poseF32[3] = 0;
    poseF32[4] = quat[0];
    poseF32[5] = quat[1];
    poseF32[6] = quat[2];
    poseF32[7] = quat[3];
    for (let i = 0; i < n; i++) {
      f32[i * 4] = planes[i].n[0];
      f32[i * 4 + 1] = planes[i].n[1];
      f32[i * 4 + 2] = planes[i].n[2];
      f32[i * 4 + 3] = planes[i].d;
    }
    this.device.queue.writeBuffer(buf, 0, ab);
  }

  updateCutSlotPose(slotIdx: number, pos: Vec3, quat: Quat) {
    if (slotIdx < 0 || slotIdx >= MAX_CUT_SLOTS) return;
    const pose = new Float32Array([pos[0], pos[1], pos[2], 0, quat[0], quat[1], quat[2], quat[3]]);
    this.device.queue.writeBuffer(this.cutSlots[slotIdx].planesBuf, 16, pose);
  }

  /** Upload a single independently tumbling cut chunk or crystal into slotIdx (0..MAX_CUT_SLOTS-1). */
  setCutSlot(slotIdx: number, p: CutPieceUpload, pos: Vec3, quat: Quat, gemId = 0) {
    if (slotIdx < 0 || slotIdx >= MAX_CUT_SLOTS) return;
    const slot = this.cutSlots[slotIdx];
    slot.vb?.destroy();
    slot.crackVB?.destroy();
    slot.surfaceCrackVB?.destroy();
    slot.vb = null;
    slot.crackVB = null;
    slot.surfaceCrackVB = null;
    slot.vertCount = 0;
    slot.crackVertCount = 0;
    slot.surfaceCrackVertCount = 0;

    if (p.verts.length > 0) {
      slot.vb = this.device.createBuffer({
        size: Math.max(24, p.verts.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(slot.vb, 0, p.verts.buffer, p.verts.byteOffset, p.verts.byteLength);
      slot.vertCount = p.verts.length / 6;
      this.uploadPlanes(slot.planesBuf, p.planes, true, pos, quat, gemId);
    }
    if (p.crackVerts.length > 0) {
      slot.crackVB = this.device.createBuffer({
        size: Math.max(32, p.crackVerts.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(slot.crackVB, 0, p.crackVerts.buffer, p.crackVerts.byteOffset, p.crackVerts.byteLength);
      slot.crackVertCount = p.crackVerts.length / 8;
    }
    if (p.surfaceCrackVerts.length > 0) {
      slot.surfaceCrackVB = this.device.createBuffer({
        size: Math.max(40, p.surfaceCrackVerts.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(
        slot.surfaceCrackVB,
        0,
        p.surfaceCrackVerts.buffer,
        p.surfaceCrackVerts.byteOffset,
        p.surfaceCrackVerts.byteLength,
      );
      slot.surfaceCrackVertCount = p.surfaceCrackVerts.length / 10;
    }
    this.recountCutSlots();
  }

  clearCutSlot(slotIdx: number) {
    if (slotIdx < 0 || slotIdx >= MAX_CUT_SLOTS) return;
    const slot = this.cutSlots[slotIdx];
    slot.vb?.destroy();
    slot.crackVB?.destroy();
    slot.surfaceCrackVB?.destroy();
    slot.vb = null;
    slot.crackVB = null;
    slot.surfaceCrackVB = null;
    slot.vertCount = 0;
    slot.crackVertCount = 0;
    slot.surfaceCrackVertCount = 0;
    this.recountCutSlots();
  }

  clearAllCutSlots() {
    for (let i = 0; i < MAX_CUT_SLOTS; i++) this.clearCutSlot(i);
  }

  private recountCutSlots() {
    let n = 0;
    for (let i = 0; i < MAX_CUT_SLOTS; i++) {
      if (this.cutSlots[i].vertCount > 0) n++;
    }
    this.activeCutSlots = n;
  }

  /** Upload 1 or more convex parts making up the main glass block / carved letter. */
  setMainBlocks(parts: Array<{ verts: Float32Array; planes: Plane[] }>) {
    const count = Math.min(MAX_BLOCK_PARTS, parts.length);
    for (let i = 0; i < MAX_BLOCK_PARTS; i++) {
      const slot = this.blockSlots[i];
      slot.vb?.destroy();
      slot.vb = null;
      slot.vertCount = 0;
      if (i < count && parts[i].verts.length > 0) {
        slot.vb = this.device.createBuffer({
          size: Math.max(24, parts[i].verts.byteLength),
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(
          slot.vb,
          0,
          parts[i].verts.buffer,
          parts[i].verts.byteOffset,
          parts[i].verts.byteLength,
        );
        slot.vertCount = parts[i].verts.length / 6;
        this.uploadPlanes(slot.planesBuf, parts[i].planes, false);
      }
    }
    this.activeBlockParts = count;
  }

  /** Legacy convenience: upload 0..N cut pieces into slots 0..N-1. */
  setCutPieces(pieces: CutPieceUpload[]) {
    this.clearAllCutSlots();
    const count = Math.min(MAX_CUT_SLOTS, pieces.length);
    for (let i = 0; i < count; i++) {
      this.setCutSlot(i, pieces[i], [0, 0, 0], [0, 0, 0, 1]);
    }
  }

  /** Upload thin ribbon triangles around 1 or more live plane-block intersection loops. */
  setSectionLoops(worldLoops: Vec3[][], camPos: Vec3) {
    this.sectionVB?.destroy();
    this.sectionVB = null;
    this.sectionVertCount = 0;

    let totalSegs = 0;
    for (const loop of worldLoops) {
      if (loop.length >= 3) totalSegs += loop.length;
    }
    if (totalSegs === 0) return;

    const width = 0.0017;
    const data = new Float32Array(totalSegs * 6 * 3);
    let o = 0;

    for (const worldLoop of worldLoops) {
      const n = worldLoop.length;
      if (n < 3) continue;
      for (let i = 0; i < n; i++) {
        const a = worldLoop[i];
        const b = worldLoop[(i + 1) % n];
        const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
        const vx = camPos[0] - (a[0] + b[0]) * 0.5;
        const vy = camPos[1] - (a[1] + b[1]) * 0.5;
        const vz = camPos[2] - (a[2] + b[2]) * 0.5;
        let px = ey * vz - ez * vy;
        let py = ez * vx - ex * vz;
        let pz = ex * vy - ey * vx;
        const pl = Math.hypot(px, py, pz) || 1;
        px = (px / pl) * width;
        py = (py / pl) * width;
        pz = (pz / pl) * width;

        data[o++] = a[0] - px; data[o++] = a[1] - py; data[o++] = a[2] - pz;
        data[o++] = a[0] + px; data[o++] = a[1] + py; data[o++] = a[2] + pz;
        data[o++] = b[0] + px; data[o++] = b[1] + py; data[o++] = b[2] + pz;

        data[o++] = a[0] - px; data[o++] = a[1] - py; data[o++] = a[2] - pz;
        data[o++] = b[0] + px; data[o++] = b[1] + py; data[o++] = b[2] + pz;
        data[o++] = b[0] - px; data[o++] = b[1] - py; data[o++] = b[2] - pz;
      }
    }

    this.sectionVB = this.device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.sectionVB, 0, data);
    this.sectionVertCount = totalSegs * 6;
  }

  addShardBatch(verts: Float32Array, baseShardId = 0, numShards = 0, maxBatches = 20) {
    if (verts.length === 0) return;
    while (this.shardBatches.length >= maxBatches) {
      const oldest = this.shardBatches.shift()!;
      oldest.vb.destroy();
      if (oldest.numShards > 0) {
        const end = Math.min(MAX_SHARDS, oldest.baseShardId + oldest.numShards);
        for (let id = oldest.baseShardId; id < end; id++) {
          this.shardPosesCPU[id * 8 + 3] = 0;
        }
        this.device.queue.writeBuffer(
          this.shardPosesBuf,
          oldest.baseShardId * 32,
          this.shardPosesCPU,
          oldest.baseShardId * 8,
          (end - oldest.baseShardId) * 8,
        );
      }
    }
    const vb = this.device.createBuffer({
      size: Math.max(40, verts.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vb, 0, verts.buffer, verts.byteOffset, verts.byteLength);
    this.shardBatches.push({ vb, vertCount: verts.length / 10, baseShardId, numShards });
  }

  clearShards() {
    for (const b of this.shardBatches) b.vb.destroy();
    this.shardBatches = [];
    this.shardPosesCPU.fill(0);
    this.device.queue.writeBuffer(this.shardPosesBuf, 0, this.shardPosesCPU);
    const zeros = new Float32Array(this.maxSplinters * 16);
    this.device.queue.writeBuffer(this.splinterBuf, 0, zeros);
    this.splinterCursor = 0;
    this.hasSplinters = false;
  }

  setShardPose(shardId: number, pos: Vec3, quat: Quat, active = true, gemId = 0) {
    if (shardId < 0 || shardId >= MAX_SHARDS) return;
    const o = shardId * 8;
    this.shardPosesCPU[o] = pos[0];
    this.shardPosesCPU[o + 1] = pos[1];
    this.shardPosesCPU[o + 2] = pos[2];
    this.shardPosesCPU[o + 3] = active ? gemId + 1 : 0;
    this.shardPosesCPU[o + 4] = quat[0];
    this.shardPosesCPU[o + 5] = quat[1];
    this.shardPosesCPU[o + 6] = quat[2];
    this.shardPosesCPU[o + 7] = quat[3];
  }

  flushShardPoses(maxActiveCount: number) {
    const count = Math.min(MAX_SHARDS, maxActiveCount);
    if (count <= 0) return;
    this.device.queue.writeBuffer(this.shardPosesBuf, 0, this.shardPosesCPU, 0, count * 8);
  }

  /**
   * Continuously glide all settled floor shards along Z (dz < 0 recedes into the horizon mist;
   * dz > 0 advances under the camera), retiring any shard outside [retireMinZ, retireMaxZ]
   * and immediately destroying & pruning GPU vertex buffers once all shards in a batch are gone.
   * Returns true if ALL shard batches are now empty (caller can reset nextShardId = 0).
   */
  scrollFloorShards(maxActiveCount: number, dz: number, retireMinZ: number, retireMaxZ: number): boolean {
    const count = Math.min(MAX_SHARDS, maxActiveCount);
    if (count <= 0 || Math.abs(dz) < 1e-7) return this.shardBatches.length === 0;
    let dirty = false;
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      if (this.shardPosesCPU[o + 3] < 0.5) continue;
      const nz = this.shardPosesCPU[o + 2] + dz;
      dirty = true;
      if (nz < retireMinZ || nz > retireMaxZ) {
        this.shardPosesCPU[o + 1] = -999;
        this.shardPosesCPU[o + 3] = 0;
      } else {
        this.shardPosesCPU[o + 2] = nz;
      }
    }
    if (dirty) {
      this.device.queue.writeBuffer(this.shardPosesBuf, 0, this.shardPosesCPU, 0, count * 8);
    }

    // Reclaim GPU vertex buffers & draw calls for any batch whose shards have all drifted out of view!
    for (let bi = this.shardBatches.length - 1; bi >= 0; bi--) {
      const b = this.shardBatches[bi];
      if (b.numShards <= 0) continue;
      const end = Math.min(MAX_SHARDS, b.baseShardId + b.numShards);
      let anyAlive = false;
      for (let id = b.baseShardId; id < end; id++) {
        if (this.shardPosesCPU[id * 8 + 3] >= 0.5) {
          anyAlive = true;
          break;
        }
      }
      if (!anyAlive) {
        b.vb.destroy();
        this.shardBatches.splice(bi, 1);
      }
    }

    return this.shardBatches.length === 0;
  }

  spawnSplinters(spawns: SplinterSpawn[]) {
    if (spawns.length === 0) return;
    const count = Math.min(spawns.length, this.maxSplinters);
    const floats = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) {
      const s = spawns[i];
      const o = i * 16;
      floats[o] = s.pos[0]; floats[o + 1] = s.pos[1]; floats[o + 2] = s.pos[2]; floats[o + 3] = s.size;
      floats[o + 4] = s.vel[0]; floats[o + 5] = s.vel[1]; floats[o + 6] = s.vel[2]; floats[o + 7] = 0;
      floats[o + 8] = Math.random() * 6.28; floats[o + 9] = Math.random() * 6.28; floats[o + 10] = Math.random() * 6.28; floats[o + 11] = s.maxAge;
      floats[o + 12] = s.color[0]; floats[o + 13] = s.color[1]; floats[o + 14] = s.color[2]; floats[o + 15] = s.spinSpeed;
    }

    let remaining = count;
    let srcOffset = 0;
    while (remaining > 0) {
      const chunk = Math.min(remaining, this.maxSplinters - this.splinterCursor);
      this.device.queue.writeBuffer(
        this.splinterBuf,
        this.splinterCursor * 64,
        floats,
        srcOffset * 16,
        chunk * 16,
      );
      this.splinterCursor = (this.splinterCursor + chunk) % this.maxSplinters;
      srcOffset += chunk;
      remaining -= chunk;
    }
    this.hasSplinters = true;
  }

  render(p: FrameParams) {
    // Pack SceneUniforms (368 bytes = 92 floats)
    const d = this.sceneData;
    d.set(p.viewProj, 0);
    d.set(p.invViewProj, 16);
    d[32] = p.camPos[0]; d[33] = p.camPos[1]; d[34] = p.camPos[2]; d[35] = p.time;
    d[36] = p.lightDir[0]; d[37] = p.lightDir[1]; d[38] = p.lightDir[2]; d[39] = p.causticStrength;
    d[40] = p.blockCenter[0]; d[41] = p.blockCenter[1]; d[42] = p.blockCenter[2]; d[43] = p.cutRadius;
    d[44] = p.blockQuat[0]; d[45] = p.blockQuat[1]; d[46] = p.blockQuat[2]; d[47] = p.blockQuat[3];
    d[48] = p.halfSize[0]; d[49] = p.halfSize[1]; d[50] = p.halfSize[2]; d[51] = p.ior;
    d[52] = p.palette.bottom[0]; d[53] = p.palette.bottom[1]; d[54] = p.palette.bottom[2]; d[55] = p.palette.density;
    d[56] = p.palette.core[0]; d[57] = p.palette.core[1]; d[58] = p.palette.core[2]; d[59] = p.dispersion;
    d[60] = p.palette.top[0]; d[61] = p.palette.top[1]; d[62] = p.palette.top[2]; d[63] = p.crackProgress;
    d[64] = p.palette.edge[0]; d[65] = p.palette.edge[1]; d[66] = p.palette.edge[2]; d[67] = p.planeHover;
    const off0 = p.cutOffsets[0] ?? [0, 0, 0];
    d[68] = off0[0]; d[69] = off0[1]; d[70] = off0[2]; d[71] = p.hasCutPiece ? 1 : 0;
    d[72] = -3.6; d[73] = -4.8; d[74] = 1 / 7.2; d[75] = 0.0;
    d[76] = p.planeAlpha; d[77] = p.canCut ? 1 : 0; d[78] = p.exposure; d[79] = p.dt;
    d[80] = p.cutQuat[0]; d[81] = p.cutQuat[1]; d[82] = p.cutQuat[2]; d[83] = p.cutQuat[3];
    d[84] = p.cutPlaneN[0]; d[85] = p.cutPlaneN[1]; d[86] = p.cutPlaneN[2]; d[87] = p.floorScrollVelZ ?? 0;
    if (p.cutPlane2N) {
      d[88] = p.cutPlane2N[0]; d[89] = p.cutPlane2N[1]; d[90] = p.cutPlane2N[2]; d[91] = p.cutRadius2;
    } else {
      d[88] = 0; d[89] = 1; d[90] = 0; d[91] = -1;
    }

    this.device.queue.writeBuffer(this.sceneBuf, 0, d);

    const enc = this.device.createCommandEncoder();

    // Pass 1: WebGPU Compute — step glittering glass splinters (skipped when empty!)
    if (this.hasSplinters && p.dt > 0) {
      const cp = enc.beginComputePass();
      cp.setPipeline(this.splintersCompPipe);
      cp.setBindGroup(0, this.splintersCompBG);
      cp.dispatchWorkgroups(Math.ceil(this.maxSplinters / 64));
      cp.end();
    }

    // Pass 2: Offscreen Fake Dispersive Caustics + Soft Studio Shadow Map
    {
      const rp = enc.beginRenderPass({
        colorAttachments: [{
          view: this.causticView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      rp.setBindGroup(0, this.causticBG);
      if (this.activeBlockParts > 0) {
        rp.setPipeline(this.causticBlockPipe);
        for (let i = 0; i < this.activeBlockParts; i++) {
          const slot = this.blockSlots[i];
          if (slot.vb && slot.vertCount > 0) {
            rp.setVertexBuffer(0, slot.vb);
            rp.draw(slot.vertCount, 4);
          }
        }
      }
      if (this.activeCutSlots > 0) {
        rp.setPipeline(this.causticCutPipe);
        for (let i = 0; i < MAX_CUT_SLOTS; i++) {
          const slot = this.cutSlots[i];
          if (slot.vb && slot.vertCount > 0) {
            rp.setBindGroup(0, slot.causticCutBG);
            rp.setVertexBuffer(0, slot.vb);
            rp.draw(slot.vertCount, 4);
          }
        }
        rp.setBindGroup(0, this.causticBG);
      }
      if (this.shardBatches.length > 0) {
        rp.setPipeline(this.causticShardsPipe);
        for (const b of this.shardBatches) {
          rp.setVertexBuffer(0, b.vb);
          rp.draw(b.vertCount, 4);
        }
      }
      rp.end();
    }

    // Pass 2b: Offscreen Shard Back-Face Depth & Normal Map
    if (this.shardBatches.length > 0 && this.shardBackView && this.shardBackDepthView) {
      const rp = enc.beginRenderPass({
        colorAttachments: [{
          view: this.shardBackView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: this.shardBackDepthView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
        },
      });
      rp.setPipeline(this.shardsBackDepthPipe);
      rp.setBindGroup(0, this.shardsBackBG);
      for (const b of this.shardBatches) {
        rp.setVertexBuffer(0, b.vb);
        rp.draw(b.vertCount);
      }
      rp.end();
    }

    // Pass 3a: Studio Floor + Caustics + Main Sommerso Block(s) -> resolve copy to bgTex for shard refraction
    const msaaView = this.msaaView!;
    const depthView = this.depthView!;
    const swapView = this.context.getCurrentTexture().createView();
    {
      const rp = enc.beginRenderPass({
        colorAttachments: [{
          view: msaaView,
          resolveTarget: this.bgView!,
          clearValue: { r: 0.96, g: 0.96, b: 0.955, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: depthView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });

      rp.setPipeline(this.floorPipe);
      rp.setBindGroup(0, this.floorBG);
      rp.draw(3);

      if (this.activeBlockParts > 0) {
        rp.setPipeline(this.glassPipe);
        for (let i = 0; i < this.activeBlockParts; i++) {
          const slot = this.blockSlots[i];
          if (slot.vb && slot.vertCount > 0) {
            rp.setBindGroup(0, slot.glassBG);
            rp.setVertexBuffer(0, slot.vb);
            rp.draw(slot.vertCount);
          }
        }
      }
      rp.end();
    }

    // Pass 3b: Refractive Shards, Twin Cracking Chunks, Cracks, Splinters, Twin Cutting Plates -> swapchain
    {
      const rp = enc.beginRenderPass({
        colorAttachments: [{
          view: msaaView,
          resolveTarget: swapView,
          loadOp: 'load',
          storeOp: 'discard',
        }],
        depthStencilAttachment: {
          view: depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'discard',
        },
      });

      if (this.shardBatches.length > 0 && this.shardsBG) {
        rp.setPipeline(this.shardsInnerPipe);
        rp.setBindGroup(0, this.shardsBackBG);
        for (const b of this.shardBatches) {
          rp.setVertexBuffer(0, b.vb);
          rp.draw(b.vertCount);
        }

        rp.setPipeline(this.shardsPipe);
        rp.setBindGroup(0, this.shardsBG);
        for (const b of this.shardBatches) {
          rp.setVertexBuffer(0, b.vb);
          rp.draw(b.vertCount);
        }
      }

      if (this.activeCutSlots > 0) {
        for (let i = 0; i < MAX_CUT_SLOTS; i++) {
          const slot = this.cutSlots[i];
          if (!slot.vb || slot.vertCount === 0) continue;

          rp.setPipeline(this.cutGlassPipe);
          rp.setBindGroup(0, slot.cutGlassBG);
          rp.setVertexBuffer(0, slot.vb);
          rp.draw(slot.vertCount);

          if (p.crackProgress > 0.0001 && slot.crackVB && slot.crackVertCount > 0) {
            rp.setPipeline(this.cracksPipe);
            rp.setBindGroup(0, slot.cracksBG);
            rp.setVertexBuffer(0, slot.crackVB);
            rp.draw(slot.crackVertCount);
          }

          if (p.crackProgress > 0.0001 && slot.surfaceCrackVB && slot.surfaceCrackVertCount > 0) {
            rp.setPipeline(this.surfaceCracksPipe);
            rp.setBindGroup(0, slot.surfaceCracksBG);
            rp.setVertexBuffer(0, slot.surfaceCrackVB);
            rp.draw(slot.surfaceCrackVertCount);
          }
        }
      }

      if (this.hasSplinters) {
        rp.setPipeline(this.splintersRenderPipe);
        rp.setBindGroup(0, this.splintersRenderBG);
        rp.draw(12, this.maxSplinters);
      }

      if (p.planeAlpha > 0.01) {
        rp.setPipeline(this.planePipe);
        rp.setBindGroup(0, this.planeBG);
        rp.draw(6, p.cutPlane2N ? 2 : 1);

        if (this.sectionVB && this.sectionVertCount > 0 && !p.hasCutPiece && p.canCut) {
          rp.setPipeline(this.sectionPipe);
          rp.setBindGroup(0, this.sectionBG);
          rp.setVertexBuffer(0, this.sectionVB);
          rp.draw(this.sectionVertCount);
        }
      }

      rp.end();
    }

    this.device.queue.submit([enc.finish()]);
  }
}
