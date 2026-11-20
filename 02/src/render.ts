// WebGL2. Three steps a frame: the shadow of the glass on the floor, into a map; the room and every crack
// surface, into a texture; then the faces of the glass on screen, which look that texture up, bent.
import { BALL_FS, BALL_VS, COPY_FS, DUST_FS, DUST_VS, FACE_FS, GLASS_VS, QUAD_VS, ROOM_FS, ROOM_VS, SHADOW_FS, VIGNETTE_FS, WALL_FS } from './shaders';
import { STRIDE, pushWall, type ShardSet } from './shards';
import type { Pane, Seg } from './cracks';

export type Mat4 = Float32Array<ArrayBufferLike>;

export function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
export function lookAt(e: number[], c: number[], up: number[]): Mat4 {
  let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
  let l = 1 / Math.hypot(zx, zy, zz); zx *= l; zy *= l; zz *= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = 1 / Math.hypot(xx, xy, xz); xx *= l; xy *= l; xz *= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
}
export function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

const XF_W = 1024;

export class Renderer {
  gl: WebGL2RenderingContext;
  private progs: Record<string, { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }> = {};
  private quad: WebGLVertexArrayObject;
  private room: WebGLVertexArrayObject;
  private roomCount = 0;
  /** one per pane: its cracks where it stands, whether it stands at all, whether pieces have been cut out of it */
  private layers: { vao: WebGLVertexArrayObject; buf: WebGLBuffer; data: number[]; count: number; z: number; standing: boolean; cut: boolean }[] = [];
  private paneVao: WebGLVertexArrayObject; private paneBuf: WebGLBuffer;
  private wallVao: WebGLVertexArrayObject; private wallBuf: WebGLBuffer; private wallCount = 0;
  private faceVao: WebGLVertexArrayObject; private faceBuf: WebGLBuffer; private faceCount = 0;
  private dustVao: WebGLVertexArrayObject; private dustBuf: WebGLBuffer; private dustSeed: WebGLBuffer;
  private wallAll = new Float32Array(0); private faceAll = new Float32Array(0); private shardCount = 0;
  private xf: WebGLTexture; private xfData = new Float32Array(XF_W * 4); private xfRows = 1;
  private mask: WebGLTexture;
  private shadowFbo: WebGLFramebuffer; private shadowTex: WebGLTexture;
  private msFbo: WebGLFramebuffer | null = null; private msColor: WebGLRenderbuffer | null = null; private msDepth: WebGLRenderbuffer | null = null;
  private sceneFbo: WebGLFramebuffer | null = null; private sceneTex: WebGLTexture | null = null;
  private w = 0; private h = 0;
  shards = false;
  /** the football: where it is and how it is turned, or off */
  ball = { on: false, p: [0, 0, 0], q: [0, 0, 0, 1], r: 0.11 };
  /** what the settings panel turns */
  look = { exposure: 1, wall: 1, floor: 1, dark: 1, tint: 1, wavy: 0.06, refl: 1, bend: 0.014, seam: 0.16, shadow: 0.58 };
  private ballVao!: WebGLVertexArrayObject; private ballCount = 0;
  pane = { W: 1, H: 1, y0: 0, T: 0.008, N: 1 };
  static SHADOW = 2048;
  static DUST = 6000;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.prog('room', ROOM_VS, ROOM_FS);
    this.prog('wall', GLASS_VS, WALL_FS);
    this.prog('face', GLASS_VS, FACE_FS);
    this.prog('shadow', GLASS_VS, SHADOW_FS);
    this.prog('copy', QUAD_VS, COPY_FS);
    this.prog('vignette', QUAD_VS, VIGNETTE_FS);
    this.prog('dust', DUST_VS, DUST_FS);
    this.prog('ball', BALL_VS, BALL_FS);
    {
      const v: number[] = [];
      const A = 24, B = 48;
      const pt = (i: number, j: number) => { const th = (i / A) * Math.PI, ph = (j / B) * Math.PI * 2; v.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)); };
      for (let i = 0; i < A; i++) for (let j = 0; j < B; j++) { pt(i, j); pt(i + 1, j); pt(i + 1, j + 1); pt(i, j); pt(i + 1, j + 1); pt(i, j + 1); }
      this.ballVao = gl.createVertexArray()!;
      gl.bindVertexArray(this.ballVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      this.ballCount = v.length / 3;
    }

    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.room = gl.createVertexArray()!;
    [this.paneVao, this.paneBuf] = this.glassVao();
    [this.wallVao, this.wallBuf] = this.glassVao();
    [this.faceVao, this.faceBuf] = this.glassVao();

    this.dustVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.dustVao);
    this.dustBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dustBuf);
    gl.bufferData(gl.ARRAY_BUFFER, Renderer.DUST * 16, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    this.dustSeed = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dustSeed);
    const seeds = new Float32Array(Renderer.DUST);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);

    this.xf = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.xf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, XF_W, 1, 0, gl.RGBA, gl.FLOAT, this.xfData);

    this.mask = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, Renderer.SHADOW, Renderer.SHADOW, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.shadowFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private prog(name: string, vs: string, fs: string) {
    const gl = this.gl;
    const p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${name}: ${gl.getShaderInfoLog(s)}`);
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: ${gl.getProgramInfoLog(p)}`);
    const u: Record<string, WebGLUniformLocation | null> = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i)!; u[info.name] = gl.getUniformLocation(p, info.name); }
    this.progs[name] = { p, u };
  }

  private glassVao(): [WebGLVertexArrayObject, WebGLBuffer] {
    const gl = this.gl;
    const vao = gl.createVertexArray()!, buf = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const B = STRIDE * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, B, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, B, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, B, 32);
    return [vao, buf];
  }

  /** New panes, one behind the other at the given depths: the room around them, each pane as one quad and
   *  its four edges as its first crack surfaces. */
  setPanes(W: number, H: number, T: number, y0: number, zs: number[]) {
    const gl = this.gl;
    this.pane = { W, H, y0, T, N: zs.length };
    this.shards = false;
    this.wallAll = new Float32Array(0); this.faceAll = new Float32Array(0); this.shardCount = 0; this.wallCount = this.faceCount = 0;
    const hx = W / 2;
    const r: number[] = [];
    const quadv = (a: number[], b: number[], c: number[], d: number[], m: number) => { for (const p of [a, b, c, a, c, d]) r.push(p[0], p[1], p[2], m); };
    quadv([-9, 0, 6], [9, 0, 6], [9, 0, -2.4], [-9, 0, -2.4], 0);
    quadv([-9, 0, -2.4], [9, 0, -2.4], [9, 7, -2.4], [-9, 7, -2.4], 1);
    const f: number[] = [];
    for (const old of this.layers) { gl.deleteBuffer(old.buf); gl.deleteVertexArray(old.vao); }
    this.layers = zs.map((z, i) => {
      // its channel
      const bx = hx + 0.03, bz0 = z - 0.026, bz1 = z + 0.018;
      quadv([-bx, 0, bz1], [bx, 0, bz1], [bx, y0, bz1], [-bx, y0, bz1], 2);
      quadv([-bx, y0, bz1], [bx, y0, bz1], [bx, y0, bz0], [-bx, y0, bz0], 2);
      quadv([-bx, 0, bz0], [-bx, 0, bz1], [-bx, y0, bz1], [-bx, y0, bz0], 2);
      quadv([bx, 0, bz1], [bx, 0, bz0], [bx, y0, bz0], [bx, y0, bz1], 2);
      const corner = (x: number, y: number) => f.push(x - hx, y + y0, z, 0, 0, 1, x, y, 0, -1e3, 0, i * 10);
      corner(0, 0); corner(W, 0); corner(W, H); corner(0, 0); corner(W, H); corner(0, H);
      const [vao, buf] = this.glassVao();
      const data: number[] = [];
      const c = [[0, 0], [W, 0], [W, H], [0, H]];
      for (let k = 0; k < 4; k++) {
        const a = c[k], b = c[(k + 1) % 4];
        pushWall(data, a[0] - hx, a[1] + y0, b[0] - hx, b[1] + y0, 0, 0, 0, 0, z, T, a[0], a[1], b[0], b[1], -1e3, -1e3, 0, i * 10, 0);
      }
      return { vao, buf, data, count: 0, z, standing: true, cut: false };
    });
    gl.bindVertexArray(this.room);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(r), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
    this.roomCount = r.length / 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.paneBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(f), gl.STATIC_DRAW);
    for (let i = 0; i < zs.length; i++) this.uploadRibbons(i);
    this.setMask(null);
  }

  /** Does pane i still stand, in part at least? */
  setStanding(i: number, standing: boolean) { this.layers[i].standing = standing; }

  addCracks(i: number, pane: Pane, segs: Seg[]) {
    const { nx, ny, ox, oy, W, T } = pane;
    const hx = W / 2, y0 = this.pane.y0, L = this.layers[i];
    for (const s of segs) {
      const { a, b } = s;
      pushWall(L.data, nx[a] - hx, ny[a] + y0, nx[b] - hx, ny[b] + y0, ox[a], oy[a], ox[b], oy[b], L.z, T, nx[a], ny[a], nx[b], ny[b], s.ta, s.tb, 0, s.kind + i * 10, 0);
    }
    this.uploadRibbons(i);
  }

  private uploadRibbons(i: number) {
    const gl = this.gl, L = this.layers[i];
    gl.bindBuffer(gl.ARRAY_BUFFER, L.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(L.data), gl.DYNAMIC_DRAW);
    L.count = L.data.length / STRIDE;
  }

  /** The hole and frost map: a canvas with every pane's map, one under the other. Red where a bullet took the
   *  glass, green where it is crushed, blue where pieces have left. */
  setMask(canvas: HTMLCanvasElement | null) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    if (!canvas) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); return; }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  /** A new fall. The shards of earlier ones stay where they came to rest: the new ones are added after them.
   *  Returns the id of the first new shard. */
  addShards(set: ShardSet): number {
    const gl = this.gl;
    const base = this.shardCount;
    for (const arr of [set.walls, set.faces]) for (let i = 10; i < arr.length; i += STRIDE) arr[i] += base;
    const join = (old: Float32Array, add: Float32Array) => { const o = new Float32Array(old.length + add.length); o.set(old); o.set(add, old.length); return o; };
    this.wallAll = join(this.wallAll, set.walls); this.faceAll = join(this.faceAll, set.faces);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.wallBuf); gl.bufferData(gl.ARRAY_BUFFER, this.wallAll, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.faceBuf); gl.bufferData(gl.ARRAY_BUFFER, this.faceAll, gl.STATIC_DRAW);
    this.wallCount = this.wallAll.length / STRIDE;
    this.faceCount = this.faceAll.length / STRIDE;
    this.shardCount = base + set.count;
    this.xfRows = Math.max(1, Math.ceil((this.shardCount * 2) / XF_W));
    const d = new Float32Array(XF_W * this.xfRows * 4);
    d.set(this.xfData.subarray(0, Math.min(d.length, base * 8)));
    // until the fall starts the new ones are where they stand in the pane
    for (let i = 0; i < set.count; i++) { const o = (base + i) * 8, c = set.bodies[i].c; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 7] = 1; }
    this.xfData = d;
    gl.bindTexture(gl.TEXTURE_2D, this.xf);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, XF_W, this.xfRows, 0, gl.RGBA, gl.FLOAT, d);
    return base;
  }

  /** Poses for `count` shards from id `base` on: frame a blended towards frame b, each count × 7 at least. */
  setPose(a: Float32Array, b: Float32Array, k: number, base: number, count: number) {
    const gl = this.gl, d = this.xfData;
    for (let i = 0; i < count; i++) {
      const s = i * 7, o = (base + i) * 8;
      d[o] = a[s] + (b[s] - a[s]) * k; d[o + 1] = a[s + 1] + (b[s + 1] - a[s + 1]) * k; d[o + 2] = a[s + 2] + (b[s + 2] - a[s + 2]) * k;
      let bx = b[s + 3], by = b[s + 4], bz = b[s + 5], bw = b[s + 6];
      if (a[s + 3] * bx + a[s + 4] * by + a[s + 5] * bz + a[s + 6] * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
      const qx = a[s + 3] + (bx - a[s + 3]) * k, qy = a[s + 4] + (by - a[s + 4]) * k, qz = a[s + 5] + (bz - a[s + 5]) * k, qw = a[s + 6] + (bw - a[s + 6]) * k;
      const l = 1 / Math.hypot(qx, qy, qz, qw);
      d[o + 4] = qx * l; d[o + 5] = qy * l; d[o + 6] = qz * l; d[o + 7] = qw * l;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.xf);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, XF_W, this.xfRows, gl.RGBA, gl.FLOAT, d);
  }

  setDust(data: Float32Array, count: number) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dustBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 4);
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.w = w; this.h = h;
    for (const o of [this.msColor, this.msDepth]) if (o) gl.deleteRenderbuffer(o);
    if (this.sceneTex) gl.deleteTexture(this.sceneTex);
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
    this.msFbo ??= gl.createFramebuffer();
    this.sceneFbo ??= gl.createFramebuffer();
    this.msColor = gl.createRenderbuffer(); this.msDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.msColor); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.msDepth); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msDepth);
    this.sceneTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private use(name: string) {
    const pr = this.progs[name], k = this.look;
    this.gl.useProgram(pr.p);
    if (pr.u.uLook) this.gl.uniform4f(pr.u.uLook, k.exposure, k.wall, k.floor, k.dark);
    return pr.u;
  }

  private glassUniforms(u: Record<string, WebGLUniformLocation | null>, vp: Mat4, now: number, flash: number, toFloor: boolean) {
    const gl = this.gl;
    gl.uniformMatrix4fv(u.uVP, false, vp);
    gl.uniform1f(u.uUseXf, this.shards ? 1 : 0);
    gl.uniform1f(u.uToFloor, toFloor ? 1 : 0);
    gl.uniform1f(u.uNow, now);
    gl.uniform1f(u.uFlash, flash);
    gl.uniform3f(u.uPane, this.pane.W, this.pane.H, this.pane.N);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.xf); gl.uniform1i(u.uXf, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.mask); gl.uniform1i(u.uMask, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(u.uShadow, 2);
  }

  private drawBall(vp: Mat4, flash: number, toFloor: boolean) {
    if (!this.ball.on) return;
    const gl = this.gl, u = this.use('ball');
    gl.uniformMatrix4fv(u.uVP, false, vp);
    gl.uniform4f(u.uBall, this.ball.p[0], this.ball.p[1], this.ball.p[2], this.ball.r);
    gl.uniform4fv(u.uQ, this.ball.q);
    gl.uniform1f(u.uToFloor, toFloor ? 1 : 0);
    gl.uniform1f(u.uFlash, flash);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(u.uShadow, 2);
    gl.bindVertexArray(this.ballVao); gl.drawArrays(gl.TRIANGLES, 0, this.ballCount);
  }

  /** What is left standing and what flies are drawn one after the other: each pane and its cracks where they
   *  are, cut out where pieces left (uCut), then the shards with their poses. */
  private drawGlass(u: Record<string, WebGLUniformLocation | null>, walls: boolean, now: number, shardNow: number) {
    const gl = this.gl;
    gl.uniform1f(u.uUseXf, 0); gl.uniform1f(u.uNow, now);
    this.layers.forEach((L, i) => {
      if (!L.standing) return;
      gl.uniform1f(u.uCut, L.cut ? 1 : 0);
      if (walls) { gl.bindVertexArray(L.vao); gl.drawArrays(gl.TRIANGLES, 0, L.count); }
      else { gl.bindVertexArray(this.paneVao); gl.drawArrays(gl.TRIANGLES, i * 6, 6); }
    });
    if (this.shards) {
      gl.uniform1f(u.uUseXf, 1); gl.uniform1f(u.uCut, 0); gl.uniform1f(u.uNow, shardNow);
      if (walls) { gl.bindVertexArray(this.wallVao); gl.drawArrays(gl.TRIANGLES, 0, this.wallCount); }
      else { gl.bindVertexArray(this.faceVao); gl.drawArrays(gl.TRIANGLES, 0, this.faceCount); }
    }
  }

  /** The cracks of pane i again, from the graph itself, without the ones `drop` names: those between two
   *  pieces that left. From here on the pane is one that has lost pieces. */
  rebuildCracks(i: number, pane: Pane, drop: (a: number, b: number) => boolean) {
    const { nx, ny, ox, oy, W, T, ea, eb, ekind } = pane;
    const hx = W / 2, y0 = this.pane.y0, L = this.layers[i];
    L.data = []; L.cut = true;
    for (let e = 0; e < ea.length; e++) {
      const a = ea[e], b = eb[e];
      if (drop(a, b)) continue;
      const frame = ekind[e] === 1;
      pushWall(L.data, nx[a] - hx, ny[a] + y0, nx[b] - hx, ny[b] + y0, frame ? 0 : ox[a], frame ? 0 : oy[a], frame ? 0 : ox[b], frame ? 0 : oy[b], L.z, T, nx[a], ny[a], nx[b], ny[b], -1e3, -1e3, 0, (frame ? 0 : ekind[e]) + i * 10, 0);
    }
    this.uploadRibbons(i);
  }

  draw(view: Mat4, proj: Mat4, cam: number[], now: number, shardNow: number, flash: number, fade: number, dustCount: number) {
    const gl = this.gl;
    const vp = mul(proj, view);
    gl.disable(gl.CULL_FACE);

    // 1. the shadow on the floor: faces dim the light a little, crack surfaces a lot
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, Renderer.SHADOW, Renderer.SHADOW);
    gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND); gl.blendEquation(gl.MIN); gl.blendFunc(gl.ONE, gl.ONE);
    let u = this.use('shadow');
    this.glassUniforms(u, vp, now, flash, true);
    gl.uniform1f(u.uShade, 1 - this.look.shadow * 0.41); this.drawGlass(u, false, now, shardNow);
    gl.uniform1f(u.uShade, 1 - this.look.shadow); this.drawGlass(u, true, now, shardNow);
    this.drawBall(vp, flash, true);
    gl.blendEquation(gl.FUNC_ADD); gl.disable(gl.BLEND);

    // 2. the room and the crack surfaces
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    u = this.use('room');
    gl.uniformMatrix4fv(u.uVP, false, vp);
    gl.uniform3fv(u.uCam, cam); gl.uniform1f(u.uFlash, flash);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(u.uShadow, 2);
    gl.bindVertexArray(this.room); gl.drawArrays(gl.TRIANGLES, 0, this.roomCount);
    this.drawBall(vp, flash, false);
    u = this.use('wall');
    this.glassUniforms(u, vp, now, flash, false);
    gl.uniform3fv(u.uCam, cam);
    gl.uniform1f(u.uSeam, this.look.seam);
    this.drawGlass(u, true, now, shardNow);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.sceneFbo);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    // 3. on screen: that picture, then the faces of the glass over it
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    u = this.use('copy');
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.sceneTex); gl.uniform1i(u.uTex, 3);
    gl.bindVertexArray(this.quad); gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.DEPTH_TEST);
    u = this.use('face');
    this.glassUniforms(u, vp, now, flash, false);
    gl.uniform3fv(u.uCam, cam);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform2f(u.uRes, this.w, this.h);
    gl.uniform1f(u.uBend, this.look.bend * proj[5] * 0.5);
    gl.uniform3f(u.uGlass, this.look.tint, this.look.wavy, this.look.refl);
    gl.uniform1i(u.uScene, 3);
    this.drawGlass(u, false, now, shardNow);
    gl.disable(gl.DEPTH_TEST);

    if (dustCount) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      u = this.use('dust');
      gl.uniformMatrix4fv(u.uVP, false, vp);
      gl.uniform1f(u.uPx, this.h * proj[5] * 0.5);
      gl.uniform3fv(u.uCam, cam); gl.uniform1f(u.uFlash, flash);
      gl.bindVertexArray(this.dustVao); gl.drawArrays(gl.POINTS, 0, dustCount);
      gl.disable(gl.BLEND);
    }

    gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    u = this.use('vignette');
    gl.uniform1f(u.uFade, fade);
    gl.bindVertexArray(this.quad); gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND);
  }
}
