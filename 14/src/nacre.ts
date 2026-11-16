// Pärlemor: the sound drawn as mother of pearl, filling the dark behind the string. A WebGL
// layer under the drawing.
//
// What it hears: the spectrum of the output (an analyser), laid along the string the way the
// pitch is (every height is a pitch, so a note lights its own height and its overtones light the
// heights of theirs), kept as a history: every frame a new column at the string, the older ones
// further out, both sides. So the sound goes out from the string as light, a moment later the
// further from it.
//
// What it looks like: nacre, a dark shell's inside. Thin layers that undulate (bands roughly
// along the string, warped by slow noise), drawn as their contour lines, a pixel wide, white on
// the dark: each layer a little lighter or deeper by its thickness.
// The sound thickens the film where it passes (the shades slide), and brightens it; the string's own shape bends the layers near it.
// Silence leaves a faint, slow sheen.

const H = 128; // heights along the string
const M = 128; // columns of history
const BLUR = [0.05, 0.1, 0.2, 0.3, 0.2, 0.1, 0.05];

const VERT = `
attribute vec2 p;
varying vec2 v;
void main() { v = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision mediump float;
varying vec2 v;
uniform sampler2D hist;
uniform sampler2D shape;
uniform float head;
uniform float sx;
uniform float aspect;
uniform float time;
uniform float level;
uniform float amount;
uniform float detail;
uniform float beat;
uniform float pulse;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

float hist5(float hx, float yy) {
  // soft in time and in height: five taps
  float m = 1.0 / 128.0;
  return texture2D(hist, vec2(hx, yy)).r * 0.36
    + (texture2D(hist, vec2(hx - 2.0 * m, yy)).r + texture2D(hist, vec2(hx + 2.0 * m, yy)).r) * 0.2
    + (texture2D(hist, vec2(hx - 5.0 * m, yy + 0.02)).r + texture2D(hist, vec2(hx + 5.0 * m, yy - 0.02)).r) * 0.12;
}

void main() {
  float dx = (v.x - sx) * 2.0;           // -1..1 across, 0 at the string
  float d = abs(dx);
  float y = v.y;
  // a slow warp: the light runs along curved layers
  float warp = fbm(vec2(d * aspect, y) * vec2(1.4, 1.6) + vec2(time * 0.025, -time * 0.018));
  float yw = y + (warp - 0.5) * 0.12;
  // the sound that left the string at this height, as long ago as this is far out
  float age = pow(clamp(d, 0.0, 1.0), 0.85) * 0.94 + (warp - 0.5) * 0.05;
  float e = hist5(fract(head - max(0.003, age)), yw);
  float eb = hist5(fract(head - max(0.003, age * 1.2 + 0.03)), yw + 0.05) * 0.5 + hist5(fract(head - max(0.003, age * 1.2 + 0.03)), yw - 0.05) * 0.5;
  // ripples on it, going out
  float rip = 0.5 + 0.5 * sin(d * aspect * 38.0 - time * 7.0 + warp * 6.0);
  // the string's shape bends the layers near it
  float sh = (texture2D(shape, vec2(0.5, y)).r * 2.0 - 1.0) * exp(-d * 7.0);

  // the film's thickness: contours of a slow field, thickened where the sound passes
  // time and rhythm, up and down: the layers drift slowly upward, and on every beat they give
  // a small vertical kick that settles (the arp's beat when it plays, else a quiet 90 BPM)
  float bp = exp(-beat * 5.0) * pulse;
  float yt = y + time * 0.012 + 0.012 * bp * (0.6 + 0.4 * sin(d * aspect * 9.0 + y * 7.0));
  float field = fbm(vec2(d * aspect, yt) * vec2(1.1, 1.3) + warp * 0.9 + vec2(0.0, time * 0.01));
  float thick = field * 3.0 + y * 0.5 + (e * (0.8 + 0.4 * rip) + eb * 0.7) * 0.9 - sh * 1.4 + time * 0.01;
  // black and white: each layer a little lighter or deeper by its thickness
  float shade = 0.8 + 0.2 * cos(6.28318 * thick * 1.3);
  vec3 pearl = vec3(0.78) * shade;
  // two ways to draw the layers, and anything between (detail): fine, the layers' contour
  // lines, a pixel wide wherever they are (a little wider where the sound passes); soft, almost a
  // gradient, the broad shading of the film alone
#ifdef DERIV
  // fewer lines, each half a rendered pixel, antialiased (finer where the screen has the pixels)
  float q = thick * 9.0;
  float px = fwidth(q);
  float dist = abs(fract(q + 0.5) - 0.5);
  float wpx = px * (0.5 + 0.6 * e + 0.25 * eb);
  float fine = 1.0 - smoothstep(0.3 * wpx, wpx, dist);
  // where lines crowd closer than a few pixels they'd shimmer: they fade there
  fine *= 1.0 - smoothstep(0.18, 0.4, px);
#else
  float gf = 0.5 + 0.5 * sin(thick * 6.28318 * 14.0);
  float fine = pow(gf, 24.0);
#endif
  float soft = 0.4 + 0.6 * smoothstep(0.0, 1.0, 0.5 + 0.5 * cos(6.28318 * thick * 0.45));
  float line = mix(soft, fine * 1.7, detail);
  // where it shines: a broad, slow sheen, the whole screen lifting with the sound
  float hi = smoothstep(0.3, 0.9, fbm(vec2(d * aspect, yt) * vec2(0.7, 0.8) - time * 0.01)) + 0.25 * bp;
  float lift = 0.1 + 0.3 * hi + 0.5 * level * (0.4 + 0.6 * hi) + 0.8 * e * (0.8 + 0.2 * rip) + 0.4 * eb;
  // softer and darker than it was: a glow in the dark, not a light show
  float bright = line * lift * 0.3 * amount;
  bright *= (1.0 - 0.25 * smoothstep(0.6, 1.0, d)) * (0.55 + 0.45 * smoothstep(0.0, 0.06, d));
  bright = min(bright, 0.32);
  gl_FragColor = vec4(pearl * bright, bright);
}`;

export class Nacre {
  /** 0 off, 1 as designed, up to 2 */
  amount = 1;
  /** where in the beat it is, 0..1, and how much the beat shows (set every frame) */
  beat = 0;
  pulse = 0.3;
  /** 0 soft, almost a gradient; 1 fine lines, many and hair thin (drawn at a finer resolution) */
  private detailV = 1;
  private size = { w: 1, h: 1, dpr: 1 };
  get detail() {
    return this.detailV;
  }
  set detail(v: number) {
    const was = this.detailV > 0.5;
    this.detailV = v;
    if (was !== v > 0.5) this.resize(this.size.w, this.size.h, this.size.dpr);
  }
  private gl: WebGLRenderingContext | null;
  private prog: WebGLProgram | null = null;
  private hist: WebGLTexture | null = null;
  private shape: WebGLTexture | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private head = 0;
  private lv = 0;
  private col = new Uint8Array(H);
  private shp = new Uint8Array(H);
  /** the spectrum along the string, 0..1, top to bottom (filled by `listen`) */
  readonly spec = new Float32Array(H);
  private freq: Float32Array<ArrayBuffer> | null = null;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true });
    const gl = this.gl;
    if (!gl) return;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    // crisp lines need the derivatives (a pixel's width wherever the line is); without them, softer ones
    const deriv = !!gl.getExtension('OES_standard_derivatives');
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, (deriv ? '#extension GL_OES_standard_derivatives : enable\n#define DERIV 1\n' : '') + FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(prog));
      this.gl = null;
      return;
    }
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const k of ['hist', 'shape', 'head', 'sx', 'aspect', 'time', 'level', 'amount', 'detail', 'beat', 'pulse']) this.u[k] = gl.getUniformLocation(prog, k);
    const tex = (w: number, h: number, wrap: number) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array(w * h));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.activeTexture(gl.TEXTURE0);
    this.hist = tex(M, H, gl.REPEAT);
    gl.activeTexture(gl.TEXTURE1);
    this.shape = tex(1, H, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.u.hist, 0);
    gl.uniform1i(this.u.shape, 1);
  }

  /** the canvas at a fraction of the screen's pixels: it's soft anyway, and phones are small engines */
  resize(w: number, h: number, dpr: number) {
    this.size = { w, h, dpr };
    // fine lines want the pixels (up to 2.5 per CSS pixel: a line under half a CSS pixel wide);
    // soft gets by on three quarters of one
    const k = this.detailV > 0.5 ? Math.min(2.5, dpr) : Math.min(1, dpr) * 0.75;
    this.canvas.width = Math.max(1, Math.round(w * k));
    this.canvas.height = Math.max(1, Math.round(h * k));
    this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * The spectrum along the string from the analyser: at each height, the loudest bin within a
   * quarter tone of that height's pitch. False when there's nothing to listen to.
   */
  listen(scope: AnalyserNode | null, hzAt: (u: number) => number) {
    if (!scope || (scope.context as AudioContext).state !== 'running') return false;
    if (!this.freq || this.freq.length !== scope.frequencyBinCount) this.freq = new Float32Array(scope.frequencyBinCount);
    scope.getFloatFrequencyData(this.freq);
    const binHz = scope.context.sampleRate / scope.fftSize;
    for (let i = 0; i < H; i++) {
      const hz = hzAt(i / (H - 1));
      let db = -140;
      if (hz > 0) {
        const lo = Math.max(1, Math.floor((hz * 0.986) / binHz));
        const hi = Math.min(this.freq.length - 1, Math.ceil((hz * 1.014) / binHz));
        for (let b = lo; b <= hi; b++) db = Math.max(db, this.freq[b]);
      }
      this.spec[i] = Math.pow(Math.min(1, Math.max(0, (db + 92) / 62)), 1.6);
    }
    return true;
  }

  /**
   * Every frame: the newest column of the history (from `spec`), the string's shape (`ys`, px
   * aside, top to bottom, against `reach`), then draw.
   */
  /** a touch at `u` along the string (0 top, 1 bottom), as strong as `s`: a bright swell that goes out from there */
  poke(u: number, s: number, now: number) {
    this.pokes.push({ u, s, t: now });
    if (this.pokes.length > 24) this.pokes.shift();
  }
  private pokes: Array<{ u: number; s: number; t: number }> = [];
  private touch = new Float32Array(H);

  render(t: number, sx: number, w: number, h: number, ys: Float32Array, reach: number) {
    const gl = this.gl;
    if (!gl || !this.prog) return;
    // the touches still alive, kept in place; each one's swell, laid in only near its height
    // (past ±0.08 a gaussian this narrow is nothing)
    let live = 0;
    for (const p of this.pokes) if (t - p.t < 0.8) this.pokes[live++] = p;
    this.pokes.length = live;
    this.touch.fill(0);
    for (const p of this.pokes) {
      const a = p.s * Math.exp(-(t - p.t) / 0.22);
      const lo = Math.max(0, Math.floor((p.u - 0.08) * (H - 1)));
      const hi = Math.min(H - 1, Math.ceil((p.u + 0.08) * (H - 1)));
      for (let i = lo; i <= hi; i++) {
        const dy = i / (H - 1) - p.u;
        this.touch[i] += a * Math.exp(-(dy * dy) / (2 * 0.018 * 0.018));
      }
    }
    let sum = 0;
    for (let i = 0; i < H; i++) {
      // blurred up and down: a swell of light, not a comb; and the touches over it
      let s = 0;
      for (let k = -3; k <= 3; k++) s += this.spec[Math.max(0, Math.min(H - 1, i + k))] * BLUR[k + 3];
      s = s * 1.6 + this.touch[i];
      this.col[i] = Math.round(Math.min(1, s) * 255);
      sum += s;
      const y = ys[Math.round((i / (H - 1)) * (ys.length - 1))] / Math.max(1, reach);
      this.shp[i] = Math.round(Math.max(0, Math.min(1, 0.5 + 0.5 * y)) * 255);
    }
    this.head = (this.head + 1) % M;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.hist);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, this.head, 0, 1, H, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.col);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shape);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, H, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.shp);
    gl.uniform1f(this.u.head, (this.head + 0.5) / M);
    gl.uniform1f(this.u.sx, sx / w);
    gl.uniform1f(this.u.aspect, w / h);
    gl.uniform1f(this.u.time, t);
    // the whole screen breathes with it: up quickly, down slowly
    const lv = Math.min(1, sum / (H * 0.05));
    this.lv += (lv - this.lv) * (lv > this.lv ? 0.25 : 0.025);
    gl.uniform1f(this.u.level, this.lv);
    gl.uniform1f(this.u.amount, this.amount);
    gl.uniform1f(this.u.detail, this.detailV);
    gl.uniform1f(this.u.beat, this.beat);
    gl.uniform1f(this.u.pulse, this.pulse);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
