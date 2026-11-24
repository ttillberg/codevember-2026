// Pre-baked procedural textures for a hyper-realistic human eyeball, generated once at
// startup onto offscreen canvases so the runtime shader stays ultra-lightweight.
//
// Outputs:
// - irisColor: 1024x1024 sRGB disc, rich pale glacial-blue & muted sea-green stroma with
//   warm amber-brown central heterochromia, braided fibrous collarette, irregular Fuchs'
//   crypts tucked beneath radial trabeculae, soft broken contraction furrows, subtle
//   brown nevi, Wolfflin wisps, pupillary ruff, and feathered deep slate limbal ring.
// - irisData:  1024x1024 linear RGBA: RG = tangent normal, B = multi-scale AO, A = height.
// - scleraColor: 1536x1536 sRGB Lambert azimuthal equal-area map centered on +z, with
//   translucent limbal ivory, warm organic sclera, rosy vascular equator/back, soft deep
//   episcleral veins, and smooth tapered branching conjunctival capillaries.
// - scleraNormal: 1024x1024 linear RGBA tangent-space normal map (raised veins + tissue grain).

import {
  CanvasTexture, ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter,
  RGBAFormat, SRGBColorSpace, UnsignedByteType,
} from 'three';

export const R_PUPIL_REF = 0.28; // reference pupil radius in baked iris space (0..1)

export interface BakedEyeTextures {
  irisColor: CanvasTexture;
  irisData: DataTexture;
  scleraColor: CanvasTexture;
  scleraNormal: DataTexture;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise2D(seed: number) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = rand();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];

  const v = (ix: number, iy: number) => vals[perm[(ix & 255) + perm[iy & 255]]];

  function noise(x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const w = yf * yf * (3 - 2 * yf);
    const a = v(xi, yi), b = v(xi + 1, yi);
    const c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * w;
  }

  function fbm(x: number, y: number, octaves = 4): number {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }

  return { noise, fbm };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

// Convert a grayscale height canvas into a tangent-space normal + AO + height RGBA DataTexture.
function heightToNormalData(hCanvas: HTMLCanvasElement, strength: number): DataTexture {
  const size = hCanvas.width;
  const ctx = hCanvas.getContext('2d')!;
  const src = ctx.getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) h[i] = src[i * 4] / 255;

  const out = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => h[clamp(y, 0, size - 1) * size + clamp(x, 0, size - 1)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = at(x - 1, y - 1), tc = at(x, y - 1), tr = at(x + 1, y - 1);
      const ml = at(x - 1, y),     mc = at(x, y),     mr = at(x + 1, y);
      const bl = at(x - 1, y + 1), bc = at(x, y + 1), br = at(x + 1, y + 1);

      const dx = (tr + 2 * mr + br - (tl + 2 * ml + bl)) * strength;
      const dy = (tl + 2 * tc + tr - (bl + 2 * bc + br)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const nx = -dx * inv;
      const ny = -dy * inv;

      // Multi-scale local concavity AO (carves soft shadow inside crypts & folds)
      const avgNear = (
        at(x - 3, y) + at(x + 3, y) + at(x, y - 3) + at(x, y + 3)
      ) * 0.25;
      const avgFar = (
        at(x - 8, y) + at(x + 8, y) + at(x, y - 8) + at(x, y + 8)
      ) * 0.25;
      const ao = clamp(0.72 + (mc - avgNear) * 1.15 + (mc - avgFar) * 0.65 + (mc - 0.5) * 0.38, 0.28, 1.0);

      const idx = (y * size + x) * 4;
      out[idx]     = Math.round((nx * 0.5 + 0.5) * 255);
      out[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[idx + 2] = Math.round(ao * 255);
      out[idx + 3] = Math.round(mc * 255);
    }
  }

  const tex = new DataTexture(out, size, size, RGBAFormat, UnsignedByteType);
  tex.flipY = true;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Draw a smooth tapered ribbon along a polyline without overlapping round-cap joints.
// Each vertex gets an offset ±halfWidth perpendicular to the local tangent, producing a
// single filled closed polygon with silky opacity and zero dotted segment artifacts!
function fillTaperedRibbon(
  ctx: CanvasRenderingContext2D,
  pts: Array<[number, number]>,
  wStart: number,
  wEnd: number,
  fillStyle: string,
) {
  const n = pts.length;
  if (n < 2) return;
  const left: Array<[number, number]> = new Array(n);
  const right: Array<[number, number]> = new Array(n);

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // Smooth exponential taper with a soft tip
    const hw = 0.5 * mix(wStart, wEnd, Math.pow(t, 0.78)) * (1 - smoothstep(0.84, 1.0, t) * 0.65);
    const pPrev = pts[Math.max(0, i - 1)];
    const pNext = pts[Math.min(n - 1, i + 1)];
    const dx = pNext[0] - pPrev[0];
    const dy = pNext[1] - pPrev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    left[i] = [pts[i][0] + nx * hw, pts[i][1] + ny * hw];
    right[i] = [pts[i][0] - nx * hw, pts[i][1] - ny * hw];
  }

  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

// -----------------------------------------------------------------------------
// 1. IRIS BAKE: pale glacial blue + muted sea-green stroma + amber-brown core
// -----------------------------------------------------------------------------

function bakeIris(maxAniso: number): { irisColor: CanvasTexture; irisData: DataTexture } {
  const SIZE = 1024;
  const CX = SIZE * 0.5;
  const CY = SIZE * 0.5;
  const RAD = SIZE * 0.485;

  const rand = mulberry32(9021047);
  const n1 = makeNoise2D(13379);
  const n2 = makeNoise2D(79199);

  const [colCanvas, c] = makeCanvas(SIZE);
  const [hCanvas, h] = makeCanvas(SIZE);

  // Organic scalloped collarette radius rCol(theta) in 0..1 iris radii
  const harmAmp = [0.024, 0.017, 0.014, 0.011, 0.008, 0.006, 0.005, 0.004];
  const harmPh = harmAmp.map(() => rand() * Math.PI * 2);
  const collaretteR = (theta: number) => {
    let r = 0.45;
    for (let k = 0; k < harmAmp.length; k++) {
      r += harmAmp[k] * Math.sin((k + 2) * theta + harmPh[k]);
    }
    return r;
  };

  // --- Step 1: Deep translucent multi-hue stromal ground (512 -> smooth upscale to 1024)
  // Keeping the ground slightly deeper lets pale blue & sea-green anterior fibers float
  // with true luminous 3D depth instead of looking chalky or washed out.
  const BASE = 512;
  const [baseCol, bc] = makeCanvas(BASE);
  const [baseH, bh] = makeCanvas(BASE);
  const imgC = bc.createImageData(BASE, BASE);
  const imgH = bh.createImageData(BASE, BASE);
  const cd = imgC.data;
  const hd = imgH.data;
  const bRad = BASE * 0.485;

  for (let y = 0; y < BASE; y++) {
    const dy = (y - BASE * 0.5) / bRad;
    for (let x = 0; x < BASE; x++) {
      const dx = (x - BASE * 0.5) / bRad;
      const r = Math.hypot(dx, dy);
      const theta = Math.atan2(dy, dx);
      const rCol = collaretteR(theta);

      const cloudGreen = n1.fbm(dx * 2.3 + 4.1, dy * 2.3 + 1.7, 4);
      const cloudDepth = n2.fbm(dx * 4.2 - 2.3, dy * 4.2 + 5.2, 4);
      const fineMottle = n1.fbm(dx * 10.5 + 1.2, dy * 10.5 - 3.4, 3);
      const ax = Math.cos(theta), ay = Math.sin(theta);
      const sector = n2.fbm(ax * 1.5 + 3.0, ay * 1.5 + 2.0, 3);
      // Radial ray modulation so base color already hints at radial stroma streaks
      const rays = n1.fbm(ax * 6.5 + r * 1.4, ay * 6.5 + r * 1.4, 3);

      // Deeper translucent blue & sea-green ground (pale highlights sit on top as fibers!)
      // Glacial blue-slate: (78, 118, 140)
      // Muted sea-green:    (74, 116, 100)
      const gMix = smoothstep(0.30, 0.72, cloudGreen * 0.62 + sector * 0.38);
      let R = mix(76, 74, gMix);
      let G = mix(118, 116, gMix);
      let B = mix(142, 98, gMix);

      const lum = 0.76 + 0.42 * cloudDepth + 0.16 * (rays - 0.5) + 0.10 * (fineMottle - 0.5);
      R *= lum; G *= lum; B *= lum;

      // Soft mossy olive-sage halo bleeding unevenly out from the collarette
      const oliveReach = rCol + 0.08 + 0.07 * (sector - 0.5) + 0.05 * (rays - 0.5);
      const oliveBand = Math.exp(-Math.pow((r - oliveReach) / 0.15, 2))
        * (0.48 + 0.52 * smoothstep(0.22, 0.78, cloudGreen));
      R = mix(R, 98  * (0.82 + 0.34 * cloudDepth), oliveBand * 0.58);
      G = mix(G, 112 * (0.82 + 0.34 * cloudDepth), oliveBand * 0.58);
      B = mix(B, 72  * (0.82 + 0.34 * cloudDepth), oliveBand * 0.58);

      // Warm chestnut / amber-brown central heterochromia with subtle organic asymmetry
      const asym = 0.032 * Math.sin(theta - 0.9) + 0.018 * Math.cos(theta * 2 + 0.4);
      const brownEdge = rCol + asym + 0.045 * (sector - 0.4) + 0.075 * (rays - 0.5);
      const inBrown = 1 - smoothstep(brownEdge - 0.085, brownEdge + 0.11, r);
      const deepCore = 1 - smoothstep(R_PUPIL_REF - 0.02, rCol - 0.02, r);
      const bR = mix(116, 68, deepCore) * (0.82 + 0.36 * fineMottle);
      const bG = mix(74,  38, deepCore) * (0.82 + 0.36 * fineMottle);
      const bB = mix(35,  18, deepCore) * (0.82 + 0.36 * fineMottle);
      R = mix(R, bR, inBrown * 0.86);
      G = mix(G, bG, inBrown * 0.86);
      B = mix(B, bB, inBrown * 0.86);

      // Deep slate-blue limbal ring: organic irregular inner margin
      const limbStart = 0.78 + 0.07 * (fineMottle - 0.5) + 0.04 * (rays - 0.5);
      const limbal = smoothstep(limbStart, 0.96, r);
      R = mix(R, 26, limbal * 0.84);
      G = mix(G, 42, limbal * 0.82);
      B = mix(B, 56, limbal * 0.78);

      const idx = (y * BASE + x) * 4;
      cd[idx]     = clamp(Math.round(R), 0, 255);
      cd[idx + 1] = clamp(Math.round(G), 0, 255);
      cd[idx + 2] = clamp(Math.round(B), 0, 255);
      cd[idx + 3] = 255;

      // Base heightfield: domed collarette, gently sloping to pupil & limbus
      const colBump = Math.exp(-Math.pow((r - rCol) / 0.07, 2)) * 38;
      const outerSlope = (1 - smoothstep(0.74, 1.0, r)) * 20;
      const innerSlope = smoothstep(R_PUPIL_REF - 0.04, rCol, r) * 16;
      const hVal = clamp(Math.round(112 + colBump + outerSlope + innerSlope + (rays - 0.5) * 26), 0, 255);
      hd[idx] = hd[idx + 1] = hd[idx + 2] = hVal;
      hd[idx + 3] = 255;
    }
  }
  bc.putImageData(imgC, 0, 0);
  bh.putImageData(imgH, 0, 0);

  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(baseCol, 0, 0, SIZE, SIZE);
  h.imageSmoothingEnabled = true;
  h.imageSmoothingQuality = 'high';
  h.drawImage(baseH, 0, 0, SIZE, SIZE);

  const px = (r: number, th: number) => CX + Math.cos(th) * r * RAD;
  const py = (r: number, th: number) => CY + Math.sin(th) * r * RAD;

  // --- Step 2: Deep Posterior Fuchs' Crypts (irregular webbed clefts UNDER the fibers!)
  // Drawn into dedicated layers and soft-blurred ONCE so they read as deep tissue cavities,
  // never stamped dots; main collagen cords will weave over and around them next!
  const [cryptC, ccCtx] = makeCanvas(SIZE);
  const [cryptH, chCtx] = makeCanvas(SIZE);

  const drawIrregularCrypt = (
    rCenter: number,
    theta: number,
    lenR: number,
    widthA: number,
    col: string,
    depth: number,
  ) => {
    const verts = 16;
    const pts: Array<[number, number]> = [];
    const skew = (rand() - 0.5) * 0.25;
    const ph1 = rand() * Math.PI * 2;
    const ph2 = rand() * Math.PI * 2;
    for (let i = 0; i < verts; i++) {
      const a = (i / verts) * Math.PI * 2;
      // Asymmetric diamond/spindle contour with jagged stromal edges
      const jag = 1 + 0.22 * Math.sin(a * 3 + ph1) + 0.14 * Math.cos(a * 5 + ph2);
      const dr = Math.cos(a) * lenR * 0.5 * jag;
      const da = Math.sin(a) * widthA * (1 + 0.35 * Math.cos(a)) * jag + dr * skew;
      pts.push([px(rCenter + dr, theta + da), py(rCenter + dr, theta + da)]);
    }
    const fillPoly = (ctx: CanvasRenderingContext2D, style: string) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < verts; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = style;
      ctx.fill();
    };
    fillPoly(ccCtx, col);
    fillPoly(chCtx, `rgba(14, 14, 14, ${depth})`);
  };

  for (let i = 0; i < 46; i++) {
    const th = (i / 46) * Math.PI * 2 + (rand() - 0.5) * 0.16;
    const rc = collaretteR(th);
    const rCenter = rc + 0.04 + rand() * 0.22;
    const lenR = 0.055 + rand() * 0.14;
    const widthA = (0.012 + rand() * 0.028) / Math.max(0.38, rCenter);
    const col = rand() < 0.5
      ? `rgba(18, 34, 44, ${(0.34 + rand() * 0.28).toFixed(3)})`
      : `rgba(20, 38, 38, ${(0.32 + rand() * 0.26).toFixed(3)})`;
    drawIrregularCrypt(rCenter, th, lenR, widthA, col, 0.45 + rand() * 0.30);
  }
  // Small pupillary clefts tucked inside the collarette
  for (let i = 0; i < 24; i++) {
    const th = rand() * Math.PI * 2;
    const rc = collaretteR(th);
    const rCenter = mix(R_PUPIL_REF + 0.03, rc - 0.02, rand());
    drawIrregularCrypt(rCenter, th, 0.035 + rand() * 0.055, 0.022 + rand() * 0.032, `rgba(30, 17, 9, 0.42)`, 0.40);
  }
  c.save(); c.filter = 'blur(4.2px)'; c.drawImage(cryptC, 0, 0); c.restore();
  h.save(); h.filter = 'blur(4.8px)'; h.drawImage(cryptH, 0, 0); h.restore();

  // --- Step 3: Soft Organic Contraction Furrows (drawn UNDER upper fibers, softly blurred!)
  // Real contraction furrows are soft tissue creases draped over by superficial collagen strands,
  // never sharp geometric pen lines.
  const [furC, fcCtx] = makeCanvas(SIZE);
  const [furH, fhCtx] = makeCanvas(SIZE);
  const furrowRadii = [0.63, 0.70, 0.77, 0.83];
  for (let f = 0; f < furrowRadii.length; f++) {
    const baseR = furrowRadii[f];
    const arcCount = 3 + Math.floor(rand() * 3);
    for (let a = 0; a < arcCount; a++) {
      const thStart = rand() * Math.PI * 2;
      const arcLen = 0.28 + rand() * 0.78;
      const steps = 24;
      const wob1 = rand() * Math.PI * 2;
      const wob2 = rand() * Math.PI * 2;
      const pts: Array<[number, number]> = [];
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const th = thStart + u * arcLen;
        const rr = baseR + Math.sin(th * 5 + wob1) * 0.014 + Math.cos(th * 11 + wob2) * 0.006;
        pts.push([px(rr, th), py(rr, th)]);
      }
      const str = 0.16 + rand() * 0.14;
      fillTaperedRibbon(fcCtx, pts, 4.5 + rand() * 2.5, 3.0, `rgba(22, 36, 44, ${str.toFixed(3)})`);
      fillTaperedRibbon(fhCtx, pts, 5.5 + rand() * 2.5, 3.5, `rgba(34, 34, 34, ${(str * 1.4).toFixed(3)})`);
    }
  }
  c.save(); c.filter = 'blur(3.2px)'; c.drawImage(furC, 0, 0); c.restore();
  h.save(); h.filter = 'blur(3.6px)'; h.drawImage(furH, 0, 0); h.restore();

  // --- Step 4: Braided Multi-Tier Radial Collagen Trabeculae
  const drawWavyStrand = (
    th0: number,
    r0: number,
    r1: number,
    waveAmp: number,
    waveFreq: number,
    phase: number,
    drift: number,
    width: number,
    color: string,
    hStroke: string,
    hWidth = width * 1.1,
  ) => {
    const segs = 18;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const r = mix(r0, r1, t);
      const env = Math.sin(t * Math.PI);
      // Gently braided S-wave so adjacent strands weave like real iris lace
      const th = th0 + drift * t + Math.sin(t * waveFreq + phase) * waveAmp * env;
      pts.push([px(r, th), py(r, th)]);
    }
    const strokeSmooth = (ctx: CanvasRenderingContext2D, style: string, lw: number) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) * 0.5;
        const my = (pts[i][1] + pts[i + 1][1]) * 0.5;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      ctx.strokeStyle = style;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    strokeSmooth(c, color, width);
    strokeSmooth(h, hStroke, hWidth);
  };

  // Tier 1: Deep stromal shadow grooves (create dark depth channels between collagen cords)
  for (let i = 0; i < 520; i++) {
    const th = (i / 520) * Math.PI * 2 + (rand() - 0.5) * 0.03;
    const r0 = 0.24 + rand() * 0.25;
    const r1 = 0.68 + rand() * 0.27;
    const alpha = 0.14 + rand() * 0.24;
    const col = r0 < 0.38
      ? `rgba(42, 26, 14, ${alpha.toFixed(3)})`
      : `rgba(22, 40, 52, ${alpha.toFixed(3)})`;
    drawWavyStrand(
      th, r0, r1,
      0.008 + rand() * 0.024, 3.5 + rand() * 5.5, rand() * Math.PI * 2,
      (rand() - 0.5) * 0.09, 1.0 + rand() * 1.9,
      col, `rgba(28, 28, 28, ${(alpha * 0.9).toFixed(3)})`,
    );
  }

  // Tier 2: Main mid-stroma pale glacial-blue & soft sea-green woven collagen bundles
  // Clumped slightly into softer translucent ribbons so it reads as living woven stroma
  // rather than uniform dry bristles.
  for (let i = 0; i < 820; i++) {
    const th = (i / 820) * Math.PI * 2 + (rand() - 0.5) * 0.026;
    const rc = collaretteR(th);
    const fromCol = rand() < 0.72;
    const r0 = fromCol ? rc - 0.05 + rand() * 0.07 : 0.24 + rand() * 0.36;
    const r1 = 0.72 + rand() * 0.24;
    const sx = Math.cos(th), sy = Math.sin(th);
    const sector = n1.fbm(sx * 1.6 + 3.2, sy * 1.6 + 1.4, 3);
    const pick = rand();

    let rgb: [number, number, number];
    if (pick < 0.46 + (0.5 - sector) * 0.35) {
      // Luminous pale glacial blue
      rgb = [126 + rand() * 42, 168 + rand() * 34, 190 + rand() * 28];
    } else if (pick < 0.84) {
      // Muted sea-green / sage-celadon
      rgb = [112 + rand() * 36, 156 + rand() * 32, 134 + rand() * 26];
    } else {
      // Delicate golden-olive collagen thread bridging from center
      rgb = [144 + rand() * 28, 140 + rand() * 24, 84 + rand() * 22];
    }
    const alpha = 0.12 + rand() * 0.22;
    drawWavyStrand(
      th, r0, r1,
      0.011 + rand() * 0.028, 3.0 + rand() * 5.8, rand() * Math.PI * 2,
      (rand() - 0.5) * 0.13, 1.3 + rand() * 2.6,
      `rgba(${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0}, ${alpha.toFixed(3)})`,
      `rgba(220, 220, 220, ${(0.12 + rand() * 0.20).toFixed(3)})`,
    );
  }

  // Tier 3: Fine anterior stroma wisps (crisp pale ice-blue, seafoam, & amber cords on top!)
  for (let i = 0; i < 340; i++) {
    const th = rand() * Math.PI * 2;
    const rc = collaretteR(th);
    const r0 = rc - 0.03 + rand() * 0.15;
    const r1 = Math.min(0.92, r0 + 0.16 + rand() * 0.36);
    const pick = rand();
    const col = pick < 0.54
      ? `rgba(190, 216, 226, ${(0.13 + rand() * 0.22).toFixed(3)})`
      : pick < 0.84
        ? `rgba(170, 200, 182, ${(0.13 + rand() * 0.20).toFixed(3)})`
        : `rgba(184, 146, 86, ${(0.16 + rand() * 0.22).toFixed(3)})`;
    drawWavyStrand(
      th, r0, r1,
      0.012 + rand() * 0.030, 3.8 + rand() * 5.8, rand() * Math.PI * 2,
      (rand() - 0.5) * 0.14, 0.8 + rand() * 1.4,
      col, `rgba(255, 255, 255, ${(0.20 + rand() * 0.26).toFixed(3)})`, 1.5,
    );
  }

  // --- Step 5: Organic Woven Collarette (built purely from braided looping fibers — NO outline!)
  // Warm amber-brown, golden-ochre, and mossy-olive streamers fanning out irregularly
  for (let i = 0; i < 280; i++) {
    const th = (i / 280) * Math.PI * 2 + (rand() - 0.5) * 0.035;
    const rc = collaretteR(th);
    const reach = rc + (rand() < 0.22 ? 0.12 + rand() * 0.22 : 0.01 + rand() * 0.11);
    const r0 = mix(R_PUPIL_REF - 0.04, rc - 0.04, rand() * 0.65);
    const warm = rand();
    const col = warm < 0.42
      ? `rgba(132, 84, 38, ${(0.20 + rand() * 0.28).toFixed(3)})`
      : warm < 0.74
        ? `rgba(164, 122, 58, ${(0.18 + rand() * 0.26).toFixed(3)})`
        : `rgba(108, 122, 68, ${(0.20 + rand() * 0.24).toFixed(3)})`;
    drawWavyStrand(
      th, r0, reach,
      0.008 + rand() * 0.018, 4 + rand() * 5, rand() * Math.PI * 2,
      (rand() - 0.5) * 0.07, 0.9 + rand() * 1.8,
      col, `rgba(238, 238, 238, ${(0.16 + rand() * 0.20).toFixed(3)})`,
    );
  }

  // Tangential interlaced fibrous loops along the collarette crown (creates the true lacy wreath!)
  for (let i = 0; i < 160; i++) {
    const th0 = (i / 160) * Math.PI * 2 + (rand() - 0.5) * 0.06;
    const span = (0.04 + rand() * 0.085) * (rand() < 0.5 ? 1 : -1);
    const rOff = (rand() - 0.5) * 0.036;
    const segs = 10;
    const pts: Array<[number, number]> = [];
    for (let s = 0; s <= segs; s++) {
      const u = s / segs;
      const th = th0 + span * u;
      // Arch slightly outward at midpoint of each lacy collarette loop
      const arch = Math.sin(u * Math.PI) * (0.014 + rand() * 0.012);
      const rr = collaretteR(th) + rOff + arch;
      pts.push([px(rr, th), py(rr, th)]);
    }
    const tone = rand();
    const col = tone < 0.45
      ? `rgba(172, 134, 72, ${(0.18 + rand() * 0.24).toFixed(3)})`
      : tone < 0.78
        ? `rgba(136, 124, 68, ${(0.16 + rand() * 0.22).toFixed(3)})`
        : `rgba(96, 62, 28, ${(0.18 + rand() * 0.22).toFixed(3)})`;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) c.lineTo(pts[k][0], pts[k][1]);
    c.strokeStyle = col;
    c.lineWidth = 1.2 + rand() * 1.8;
    c.lineCap = 'round';
    c.stroke();

    h.beginPath();
    h.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) h.lineTo(pts[k][0], pts[k][1]);
    h.strokeStyle = `rgba(255, 255, 255, ${(0.22 + rand() * 0.24).toFixed(3)})`;
    h.lineWidth = 2.0 + rand() * 1.8;
    h.lineCap = 'round';
    h.stroke();
  }

  // --- Step 6: Pupillary Zone Fine Radial Folds (between pupil margin and collarette)
  for (let i = 0; i < 280; i++) {
    const th = (i / 280) * Math.PI * 2 + (rand() - 0.5) * 0.02;
    const rc = collaretteR(th);
    const isDark = rand() < 0.52;
    const col = isDark
      ? `rgba(44, 24, 11, ${(0.24 + rand() * 0.28).toFixed(3)})`
      : `rgba(156, 108, 52, ${(0.18 + rand() * 0.24).toFixed(3)})`;
    const hCol = isDark ? 'rgba(55, 55, 55, 0.24)' : 'rgba(215, 215, 215, 0.22)';
    drawWavyStrand(
      th, R_PUPIL_REF - 0.06, rc + 0.015,
      0.005, 5, rand() * 6, (rand() - 0.5) * 0.03,
      0.85 + rand() * 1.1, col, hCol,
    );
  }

  // --- Step 7: Subtle Iris Nevi (small organic brown pigment freckles) & Wolfflin Wisps
  for (let i = 0; i < 5; i++) {
    const th = rand() * Math.PI * 2;
    const rr = 0.50 + rand() * 0.28;
    const x = px(rr, th), y = py(rr, th);
    const rx = 4 + rand() * 7;
    const ry = 3 + rand() * 5;
    c.save();
    c.translate(x, y);
    c.rotate(th + (rand() - 0.5) * 0.6);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry));
    g.addColorStop(0, `rgba(62, 34, 15, ${(0.48 + rand() * 0.24).toFixed(2)})`);
    g.addColorStop(0.55, `rgba(88, 52, 24, ${(0.22 + rand() * 0.16).toFixed(2)})`);
    g.addColorStop(1, 'rgba(88, 52, 24, 0)');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  for (let i = 0; i < 18; i++) {
    const th = (i / 18) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    const rr = 0.77 + rand() * 0.08;
    const x = px(rr, th), y = py(rr, th);
    const rN = 3 + rand() * 4.5;
    const g = c.createRadialGradient(x, y, 0, x, y, rN);
    g.addColorStop(0, `rgba(210, 224, 228, ${(0.16 + rand() * 0.14).toFixed(2)})`);
    g.addColorStop(1, 'rgba(210, 224, 228, 0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, rN, 0, Math.PI * 2);
    c.fill();
  }

  // --- Step 8: Feathered Dark Slate-Blue Limbal Ring + Scalloped Pupillary Ruff
  const limbGrad = c.createRadialGradient(CX, CY, RAD * 0.74, CX, CY, RAD * 1.02);
  limbGrad.addColorStop(0, 'rgba(18, 32, 42, 0)');
  limbGrad.addColorStop(0.52, 'rgba(18, 32, 42, 0.22)');
  limbGrad.addColorStop(0.82, 'rgba(15, 26, 36, 0.62)');
  limbGrad.addColorStop(1, 'rgba(14, 22, 30, 0.84)');
  c.fillStyle = limbGrad;
  c.fillRect(0, 0, SIZE, SIZE);

  const ruffN = 140;
  c.save();
  c.beginPath();
  for (let i = 0; i <= ruffN; i++) {
    const th = (i / ruffN) * Math.PI * 2;
    const rr = R_PUPIL_REF + 0.010 + 0.004 * Math.sin(th * 44) + 0.0025 * Math.cos(th * 71 + 1.1);
    const x = px(rr, th), y = py(rr, th);
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.closePath();
  c.strokeStyle = 'rgba(18, 10, 5, 0.80)';
  c.lineWidth = 5.0;
  c.stroke();
  c.restore();

  const hLimb = h.createRadialGradient(CX, CY, RAD * 0.82, CX, CY, RAD * 1.02);
  hLimb.addColorStop(0, 'rgba(128, 128, 128, 0)');
  hLimb.addColorStop(1, 'rgba(128, 128, 128, 0.88)');
  h.fillStyle = hLimb;
  h.fillRect(0, 0, SIZE, SIZE);

  const irisColor = new CanvasTexture(colCanvas);
  irisColor.colorSpace = SRGBColorSpace;
  irisColor.wrapS = ClampToEdgeWrapping;
  irisColor.wrapT = ClampToEdgeWrapping;
  irisColor.minFilter = LinearMipmapLinearFilter;
  irisColor.magFilter = LinearFilter;
  irisColor.anisotropy = maxAniso;
  irisColor.needsUpdate = true;

  const irisData = heightToNormalData(hCanvas, 2.45);
  irisData.anisotropy = maxAniso;

  return { irisColor, irisData };
}

// -----------------------------------------------------------------------------
// 2. SCLERA & BLOOD VESSELS BAKE (Lambert azimuthal equal-area centered on +z)
// -----------------------------------------------------------------------------

function bakeSclera(limbusAngle: number, maxAniso: number): { scleraColor: CanvasTexture; scleraNormal: DataTexture } {
  const SIZE = 1536;
  const HSIZE = 1024;
  const CX = SIZE * 0.5;
  const CY = SIZE * 0.5;
  const SCALE = SIZE * 0.49;

  const rand = mulberry32(4182029);
  const n1 = makeNoise2D(55127);
  const n2 = makeNoise2D(88321);

  const [colCanvas, c] = makeCanvas(SIZE);
  const [hCanvas, h] = makeCanvas(HSIZE);

  h.fillStyle = 'rgb(128, 128, 128)';
  h.fillRect(0, 0, HSIZE, HSIZE);

  // --- Step 1: Organic base scleral color & tissue grain (512 -> smooth upscale)
  const BASE = 512;
  const [baseCol, bc] = makeCanvas(BASE);
  const [baseH, bh] = makeCanvas(BASE);
  const imgC = bc.createImageData(BASE, BASE);
  const imgH = bh.createImageData(BASE, BASE);
  const cd = imgC.data;
  const hd = imgH.data;
  const bScale = BASE * 0.49;

  for (let y = 0; y < BASE; y++) {
    const ny = -(y - BASE * 0.5) / bScale;
    for (let x = 0; x < BASE; x++) {
      const nx = (x - BASE * 0.5) / bScale;
      const rn = Math.min(1, Math.hypot(nx, ny));
      const theta = 2 * Math.asin(rn);
      const phi = Math.atan2(ny, nx);

      const m1 = n1.fbm(nx * 5.0 + 2.1, ny * 5.0 - 1.3, 4);
      const m2 = n2.fbm(nx * 14.0 - 4.7, ny * 14.0 + 3.2, 3);
      const grain = n1.noise(nx * 46.0, ny * 46.0);
      const horiz = Math.pow(Math.abs(Math.cos(phi)), 1.5);

      const tLimb = smoothstep(limbusAngle - 0.03, limbusAngle + 0.16, theta);
      const tMid  = smoothstep(limbusAngle + 0.16, 1.12, theta);
      const tBack = smoothstep(1.10, 2.35, theta);

      // Subtle cool bluish-porcelain translucency right at limbus -> warm natural ivory
      let R = mix(198, 232, tLimb);
      let G = mix(203, 226, tLimb);
      let B = mix(208, 218, tLimb);

      // Soft warm vascular peach blush toward equator (stronger on nasal/temporal horizontal sides)
      const blush = tMid * (0.55 + 0.45 * horiz) * (0.76 + 0.48 * m1);
      R = mix(R, 228, blush * 0.68);
      G = mix(G, 192, blush * 0.68);
      B = mix(B, 182, blush * 0.68);

      // Ultra-subtle natural warm cream-amber pinguecula tone horizontally
      const ping = horiz * Math.exp(-Math.pow((theta - (limbusAngle + 0.25)) / 0.17, 2)) * smoothstep(0.40, 0.78, m1);
      R = mix(R, 230, ping * 0.20);
      G = mix(G, 216, ping * 0.20);
      B = mix(B, 188, ping * 0.20);

      // Posterior vascular fleshy rose + subtle rectus muscle bands
      const rectus = Math.pow(Math.max(Math.abs(Math.cos(phi)), Math.abs(Math.sin(phi))), 8)
        * smoothstep(1.05, 1.5, theta) * (1 - smoothstep(2.0, 2.6, theta));
      R = mix(R, 194, tBack * 0.85);
      G = mix(G, 122, tBack * 0.85);
      B = mix(B, 114, tBack * 0.85);
      R = mix(R, 172, rectus * 0.28);
      G = mix(G, 94,  rectus * 0.28);
      B = mix(B, 90,  rectus * 0.28);

      const optic = smoothstep(2.78, 3.04, theta);
      R = mix(R, 212, optic * 0.45);
      G = mix(G, 178, optic * 0.45);
      B = mix(B, 164, optic * 0.45);

      const vMod = 0.962 + 0.065 * (m2 - 0.5) + 0.022 * (grain - 0.5);
      R *= vMod; G *= vMod; B *= vMod;

      const idx = (y * BASE + x) * 4;
      cd[idx]     = clamp(Math.round(R), 0, 255);
      cd[idx + 1] = clamp(Math.round(G), 0, 255);
      cd[idx + 2] = clamp(Math.round(B), 0, 255);
      cd[idx + 3] = 255;

      const hVal = clamp(Math.round(128 + (m2 - 0.5) * 16 + (grain - 0.5) * 9), 0, 255);
      hd[idx] = hd[idx + 1] = hd[idx + 2] = hVal;
      hd[idx + 3] = 255;
    }
  }
  bc.putImageData(imgC, 0, 0);
  bh.putImageData(imgH, 0, 0);

  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(baseCol, 0, 0, SIZE, SIZE);
  h.imageSmoothingEnabled = true;
  h.imageSmoothingQuality = 'high';
  h.drawImage(baseH, 0, 0, HSIZE, HSIZE);

  const toColXY = (th: number, ph: number): [number, number] => {
    const r = Math.sin(clamp(th, 0, Math.PI) * 0.5) * SCALE;
    return [CX + Math.cos(ph) * r, CY - Math.sin(ph) * r];
  };
  const hRatio = HSIZE / SIZE;

  // --- Step 2: Silky Tapered Branching Blood Vessels (ribbon polygons, ZERO dotted joints!)
  // Each vascular depth layer renders cleanly onto its own offscreen canvas, then composites
  // onto scleraColor with a single blur/alpha pass.
  const [deepCanvas, deepCtx] = makeCanvas(SIZE);
  const [midCanvas, midCtx] = makeCanvas(SIZE);
  const [fineCanvas, fineCtx] = makeCanvas(SIZE);
  const [veinHCanvas, veinHCtx] = makeCanvas(HSIZE);

  interface VesselStyle {
    targetCtx: CanvasRenderingContext2D;
    rgb: [number, number, number];
    alpha: number;
    width: number;
    heightBump: number;
    wiggle: number;
    stopTheta: number;
  }

  function growVessel(
    th0: number,
    ph0: number,
    dirTh: number,
    dirPh: number,
    steps: number,
    depth: number,
    style: VesselStyle,
  ) {
    let th = th0;
    let ph = ph0;
    let dTh = dirTh;
    let dPh = dirPh;
    const stepLen = 0.018;
    const pts: Array<[number, number]> = [];
    const hPts: Array<[number, number]> = [];
    let meander = (rand() - 0.5) * 0.45;

    for (let s = 0; s < steps; s++) {
      const [x, y] = toColXY(th, ph);
      pts.push([x, y]);
      hPts.push([x * hRatio, y * hRatio]);

      // Smooth dendritic tortuosity: gentle forward progression with natural organic micro-squiggles
      // (avoids artificial wide loops while keeping authentic wavy conjunctival character)
      meander = meander * 0.55 + (rand() - 0.5) * style.wiggle;
      const ang = Math.atan2(dPh, dTh) + meander;
      dTh = Math.cos(ang);
      dPh = Math.sin(ang);

      if (th < style.stopTheta + 0.12) {
        const tang = dPh >= 0 ? 1 : -1;
        dTh = mix(dTh, 0.04, 0.36);
        dPh = mix(dPh, tang, 0.44);
      } else {
        // Stronger dendritic pull forward toward limbus so vessels radiate organically
        dTh = mix(dTh, -0.94, 0.18);
      }
      const norm = Math.hypot(dTh, dPh) || 1;
      dTh /= norm;
      dPh /= norm;

      const sinTh = Math.max(0.28, Math.sin(th));
      th += dTh * stepLen;
      ph += (dPh * stepLen) / sinTh;

      if (th < style.stopTheta || th > Math.PI - 0.08) break;

      if (depth > 0 && s > 5 && s < steps - 5 && rand() < (depth === 2 ? 0.10 : 0.085)) {
        const side = rand() < 0.5 ? 1 : -1;
        const splitAng = Math.atan2(dPh, dTh) + side * (0.38 + rand() * 0.46);
        const childSteps = Math.max(8, Math.round((steps - s) * (0.55 + rand() * 0.35)));
        growVessel(
          th, ph,
          Math.cos(splitAng), Math.sin(splitAng),
          childSteps,
          depth - 1,
          {
            ...style,
            width: style.width * (0.58 + rand() * 0.14),
            alpha: style.alpha * (0.78 + rand() * 0.15),
            heightBump: style.heightBump * 0.62,
            wiggle: style.wiggle * 1.12,
            stopTheta: Math.max(limbusAngle + 0.03, style.stopTheta - 0.015),
          },
        );
      }
    }

    if (pts.length < 4) return;

    const [r, g, b] = style.rgb;
    fillTaperedRibbon(
      style.targetCtx,
      pts,
      style.width,
      Math.max(0.45, style.width * 0.24),
      `rgba(${r}, ${g}, ${b}, ${style.alpha.toFixed(3)})`,
    );

    if (style.heightBump > 0.01) {
      fillTaperedRibbon(
        veinHCtx,
        hPts,
        Math.max(0.9, style.width * hRatio * 1.2),
        0.5,
        `rgba(255, 255, 255, ${style.heightBump.toFixed(3)})`,
      );
    }
  }

  // Layer A: Deep Episcleral Veins (soft blurred violet-rose trunks under the conjunctiva)
  for (let i = 0; i < 18; i++) {
    const phi = (i / 18) * Math.PI * 2 + (rand() - 0.5) * 0.28;
    const horiz = Math.abs(Math.cos(phi));
    const th0 = 1.42 + rand() * 0.52;
    growVessel(th0, phi, -0.95, (rand() - 0.5) * 0.38, 46 + Math.floor(rand() * 26), 1, {
      targetCtx: deepCtx,
      rgb: [154, 68, 82],
      alpha: 0.20 + horiz * 0.14,
      width: 4.2 + rand() * 2.4,
      heightBump: 0.06,
      wiggle: 0.32,
      stopTheta: limbusAngle + 0.11 + rand() * 0.11,
    });
  }

  // Layer B: Primary Superficial Conjunctival Arteries & Venules (natural crimson-coral)
  for (let i = 0; i < 22; i++) {
    const side = i % 2 === 0 ? 0 : Math.PI;
    const spread = (rand() - 0.5) * Math.PI * (rand() < 0.74 ? 0.56 : 1.0);
    const phi = side + spread;
    const horiz = Math.pow(Math.abs(Math.cos(phi)), 1.25);
    const th0 = 1.24 + rand() * 0.54;
    const reach = limbusAngle + (0.055 + (1 - horiz) * 0.13 + rand() * 0.08);
    const isArteriole = rand() < 0.55;
    growVessel(th0, phi, -0.92, (rand() - 0.5) * 0.42, 48 + Math.floor(rand() * 32), 2, {
      targetCtx: midCtx,
      rgb: isArteriole ? [178, 52, 50] : [148, 38, 48],
      alpha: (0.28 + horiz * 0.26) * (0.8 + rand() * 0.3),
      width: 2.3 + rand() * 1.4,
      heightBump: 0.16 + horiz * 0.10,
      wiggle: 0.40,
      stopTheta: reach,
    });
  }

  // Layer C: Ultra-fine Anterior Capillary Web (subtle healthy vascular filigree)
  for (let i = 0; i < 46; i++) {
    const phi = rand() * Math.PI * 2;
    const horiz = Math.abs(Math.cos(phi));
    const th0 = limbusAngle + 0.34 + rand() * 0.72;
    growVessel(th0, phi, -0.88, (rand() - 0.5) * 0.65, 22 + Math.floor(rand() * 24), 1, {
      targetCtx: fineCtx,
      rgb: [186, 68, 68],
      alpha: 0.14 + horiz * 0.13,
      width: 1.05 + rand() * 0.6,
      heightBump: 0.05,
      wiggle: 0.50,
      stopTheta: limbusAngle + 0.035 + rand() * 0.08,
    });
  }

  // Composite vascular layers with physical depth blur (deep softest -> fine crispest)
  c.save(); c.filter = 'blur(3.6px)'; c.drawImage(deepCanvas, 0, 0); c.restore();
  c.save(); c.filter = 'blur(0.7px)'; c.drawImage(midCanvas, 0, 0); c.restore();
  c.save(); c.filter = 'blur(0.3px)'; c.drawImage(fineCanvas, 0, 0); c.restore();
  h.save(); h.filter = 'blur(1.2px)'; h.drawImage(veinHCanvas, 0, 0); h.restore();

  // Subtle translucent limbal arcus & capillary blush right outside the cornea
  const rLimbPx = Math.sin(limbusAngle * 0.5) * SCALE;
  const arcGrad = c.createRadialGradient(CX, CY, rLimbPx * 0.94, CX, CY, rLimbPx * 1.22);
  arcGrad.addColorStop(0, 'rgba(170, 178, 184, 0.28)');
  arcGrad.addColorStop(0.32, 'rgba(192, 152, 148, 0.08)');
  arcGrad.addColorStop(1, 'rgba(192, 152, 148, 0)');
  c.fillStyle = arcGrad;
  c.fillRect(0, 0, SIZE, SIZE);

  const scleraColor = new CanvasTexture(colCanvas);
  scleraColor.colorSpace = SRGBColorSpace;
  scleraColor.wrapS = ClampToEdgeWrapping;
  scleraColor.wrapT = ClampToEdgeWrapping;
  scleraColor.minFilter = LinearMipmapLinearFilter;
  scleraColor.magFilter = LinearFilter;
  scleraColor.anisotropy = maxAniso;
  scleraColor.needsUpdate = true;

  const scleraNormal = heightToNormalData(hCanvas, 1.25);
  scleraNormal.anisotropy = maxAniso;

  return { scleraColor, scleraNormal };
}

export function bakeEyeTextures(limbusAngle: number, maxAniso: number): BakedEyeTextures {
  const aniso = Math.min(8, Math.max(1, maxAniso));
  const { irisColor, irisData } = bakeIris(aniso);
  const { scleraColor, scleraNormal } = bakeSclera(limbusAngle, aniso);
  return { irisColor, irisData, scleraColor, scleraNormal };
}
