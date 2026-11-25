import * as THREE from 'three';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fine matte molded ABS / bead-blasted ceramic micro-grain texture for the white/beige labyrinth body.
 */
export function createMatteGrainTextures(): { roughnessMap: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const size = 512;
  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d')!;

  const rImg = rCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);
  const rng = mulberry32(4213);

  for (let i = 0; i < size * size; i++) {
    const n = (rng() + rng()) * 0.5; // soft triangular distribution
    // Roughness centered around ~0.58 with subtle bead-blast variation
    const rv = Math.round(136 + (n - 0.5) * 34);
    const bv = Math.round(128 + (n - 0.5) * 44);
    const p = i * 4;
    rImg.data[p] = rImg.data[p + 1] = rImg.data[p + 2] = rv;
    rImg.data[p + 3] = 255;
    bImg.data[p] = bImg.data[p + 1] = bImg.data[p + 2] = bv;
    bImg.data[p + 3] = 255;
  }
  rCtx.putImageData(rImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);

  // Subtle very faint handling scuffs on the matte plastic floor/walls
  rCtx.strokeStyle = 'rgba(215, 215, 215, 0.14)';
  for (let s = 0; s < 26; s++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 18 + rng() * 55;
    const ang = rng() * Math.PI * 2;
    rCtx.lineWidth = 0.6 + rng() * 0.9;
    rCtx.beginPath();
    rCtx.moveTo(x, y);
    rCtx.quadraticCurveTo(
      x + Math.cos(ang + 0.2) * len * 0.5,
      y + Math.sin(ang + 0.2) * len * 0.5,
      x + Math.cos(ang) * len,
      y + Math.sin(ang) * len,
    );
    rCtx.stroke();
  }

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(4, 4);

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(4, 4);

  return { roughnessMap, bumpMap };
}

/**
 * Very light scratches & micro-buffing marks for the thin clear plastic outer shell.
 * Designed to stay nearly invisible straight-on and subtly catch grazing studio softbox light.
 */
export function createPlasticScratchTextures(): {
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  scratchAlphaMap: THREE.CanvasTexture;
} {
  const w = 2048;
  const h = 1024;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = w;
  rCanvas.height = h;
  const rCtx = rCanvas.getContext('2d')!;

  const bCanvas = document.createElement('canvas');
  bCanvas.width = w;
  bCanvas.height = h;
  const bCtx = bCanvas.getContext('2d')!;

  const aCanvas = document.createElement('canvas');
  aCanvas.width = w;
  aCanvas.height = h;
  const aCtx = aCanvas.getContext('2d')!;

  // Base ultra-smooth glossy polycarbonate (roughness ~0.045)
  rCtx.fillStyle = 'rgb(12, 12, 12)';
  rCtx.fillRect(0, 0, w, h);

  // Neutral mid-gray bump
  bCtx.fillStyle = 'rgb(128, 128, 128)';
  bCtx.fillRect(0, 0, w, h);

  // Nearly transparent scratch gleam overlay
  aCtx.fillStyle = 'rgb(0, 0, 0)';
  aCtx.fillRect(0, 0, w, h);

  const rng = mulberry32(1388);

  // 1. Ultra-faint circular handling/polishing micro-swirls
  for (let i = 0; i < 65; i++) {
    const cx = rng() * w;
    const cy = h * (0.12 + rng() * 0.76);
    const rad = 28 + rng() * 95;
    const start = rng() * Math.PI * 2;
    const span = 0.35 + rng() * 1.1;
    const intensity = 0.04 + rng() * 0.08;

    rCtx.strokeStyle = `rgba(120, 120, 120, ${intensity * 1.4})`;
    rCtx.lineWidth = 0.7 + rng() * 0.7;
    rCtx.beginPath();
    rCtx.arc(cx, cy, rad, start, start + span);
    rCtx.stroke();

    bCtx.strokeStyle = `rgba(148, 148, 148, ${intensity * 0.9})`;
    bCtx.lineWidth = 0.7;
    bCtx.beginPath();
    bCtx.arc(cx, cy, rad, start, start + span);
    bCtx.stroke();

    aCtx.strokeStyle = `rgba(255, 255, 255, ${intensity * 0.55})`;
    aCtx.lineWidth = 0.65;
    aCtx.beginPath();
    aCtx.arc(cx, cy, rad, start, start + span);
    aCtx.stroke();
  }

  // 2. Handful of delicate hairline scratches (very subtle, realistic studio-handled prototype)
  for (let i = 0; i < 48; i++) {
    const x0 = rng() * w;
    const y0 = h * (0.1 + rng() * 0.8);
    const len = 22 + rng() * 110;
    const ang = rng() * Math.PI * 2;
    const bend = (rng() - 0.5) * 0.38;
    const mx = x0 + Math.cos(ang + bend) * len * 0.5;
    const my = y0 + Math.sin(ang + bend) * len * 0.5;
    const x1 = x0 + Math.cos(ang) * len;
    const y1 = y0 + Math.sin(ang) * len;
    const strength = 0.06 + rng() * 0.16;
    const lw = 0.55 + rng() * 0.85;

    rCtx.strokeStyle = `rgba(185, 185, 185, ${strength * 1.6})`;
    rCtx.lineWidth = lw;
    rCtx.beginPath();
    rCtx.moveTo(x0, y0);
    rCtx.quadraticCurveTo(mx, my, x1, y1);
    rCtx.stroke();

    bCtx.strokeStyle = `rgba(92, 92, 92, ${strength * 1.2})`;
    bCtx.lineWidth = lw;
    bCtx.beginPath();
    bCtx.moveTo(x0, y0);
    bCtx.quadraticCurveTo(mx, my, x1, y1);
    bCtx.stroke();

    aCtx.strokeStyle = `rgba(255, 253, 248, ${strength * 0.9})`;
    aCtx.lineWidth = lw * 0.85;
    aCtx.beginPath();
    aCtx.moveTo(x0, y0);
    aCtx.quadraticCurveTo(mx, my, x1, y1);
    aCtx.stroke();
  }

  // 3. Subtle microscopic dust flecks (barely visible up close)
  for (let i = 0; i < 110; i++) {
    const x = rng() * w;
    const y = h * (0.08 + rng() * 0.84);
    const rad = 0.4 + rng() * 0.8;
    const s = 0.05 + rng() * 0.1;
    rCtx.fillStyle = `rgba(150,150,150,${s})`;
    rCtx.beginPath();
    rCtx.arc(x, y, rad, 0, Math.PI * 2);
    rCtx.fill();
  }

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.ClampToEdgeWrapping;

  const bumpMap = new THREE.CanvasTexture(bCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.ClampToEdgeWrapping;

  const scratchAlphaMap = new THREE.CanvasTexture(aCanvas);
  scratchAlphaMap.wrapS = THREE.RepeatWrapping;
  scratchAlphaMap.wrapT = THREE.ClampToEdgeWrapping;

  return { roughnessMap, bumpMap, scratchAlphaMap };
}

/**
 * Semi-transparent matte frosted adhesive tape strip with serrated torn ends and
 * crisp minimalist Swedish technical typography ("MADE IN SWEDEN ...").
 */
export function createTapeTexture(variant: 'primary' | 'secondary' | 'north' | 'south'): {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const isPole = variant === 'north' || variant === 'south';
  const w = isPole ? 860 : 1536;
  const h = isPole ? 256 : 320;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = w;
  rCanvas.height = h;
  const rCtx = rCanvas.getContext('2d')!;
  rCtx.fillStyle = 'rgb(112, 112, 112)';
  rCtx.fillRect(0, 0, w, h);

  const seedMap = { primary: 9913, secondary: 5513, north: 7113, south: 8213 };
  const rng = mulberry32(seedMap[variant]);

  // Build serrated dispenser-torn path for left & right tape edges
  const padX = isPole ? 24 : 34;
  const padY = isPole ? 20 : 26;
  const teeth = isPole ? 12 : 16;
  const toothDepth = isPole ? 13 : 16;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(padX, padY);
  ctx.lineTo(w - padX, padY);
  // Right serrated edge
  for (let i = 0; i < teeth; i++) {
    const y0 = padY + (i / teeth) * (h - padY * 2);
    const yMid = padY + ((i + 0.5) / teeth) * (h - padY * 2);
    const y1 = padY + ((i + 1) / teeth) * (h - padY * 2);
    ctx.lineTo(w - padX - toothDepth * (0.75 + rng() * 0.35), yMid);
    ctx.lineTo(w - padX + (rng() - 0.5) * 3, y1);
    void y0;
  }
  ctx.lineTo(padX, h - padY);
  // Left serrated edge
  for (let i = teeth - 1; i >= 0; i--) {
    const yMid = padY + ((i + 0.5) / teeth) * (h - padY * 2);
    const y0 = padY + (i / teeth) * (h - padY * 2);
    ctx.lineTo(padX + toothDepth * (0.75 + rng() * 0.35), yMid);
    ctx.lineTo(padX + (rng() - 0.5) * 3, y0);
  }
  ctx.closePath();
  ctx.clip();

  // Translucent warm-ivory frosted Scotch tape body
  const bodyGrad = ctx.createLinearGradient(0, padY, 0, h - padY);
  bodyGrad.addColorStop(0, 'rgba(246, 243, 234, 0.44)');
  bodyGrad.addColorStop(0.08, 'rgba(244, 240, 230, 0.29)');
  bodyGrad.addColorStop(0.5, 'rgba(242, 238, 227, 0.26)');
  bodyGrad.addColorStop(0.92, 'rgba(244, 240, 230, 0.29)');
  bodyGrad.addColorStop(1, 'rgba(246, 243, 234, 0.45)');
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(0, 0, w, h);

  // Subtle adhesive micro-texture and faint lifted air-line near edges
  ctx.strokeStyle = 'rgba(255, 254, 250, 0.48)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(padX, padY + 2);
  ctx.lineTo(w - padX, padY + 2);
  ctx.moveTo(padX, h - padY - 2);
  ctx.lineTo(w - padX, h - padY - 2);
  ctx.stroke();

  // Subtle horizontal adhesive streaks
  for (let i = 0; i < 40; i++) {
    const y = padY + 8 + rng() * (h - padY * 2 - 16);
    ctx.strokeStyle = `rgba(255, 252, 245, ${0.03 + rng() * 0.05})`;
    ctx.lineWidth = 1 + rng() * 2;
    ctx.beginPath();
    ctx.moveTo(padX + rng() * 140, y);
    ctx.lineTo(w - padX - rng() * 140, y);
    ctx.stroke();
  }

  // Tiny trapped micro-bubbles near tape corners
  for (let i = 0; i < 9; i++) {
    const side = i % 2 === 0 ? padX + 26 + rng() * 85 : w - padX - 26 - rng() * 85;
    const by = padY + 18 + rng() * (h - padY * 2 - 36);
    const br = 3 + rng() * 8;
    ctx.fillStyle = 'rgba(255, 255, 252, 0.22)';
    ctx.beginPath();
    ctx.ellipse(side, by, br * 1.4, br * 0.8, rng() * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Crisp printed technical copy in dark warm-charcoal ink
  ctx.fillStyle = 'rgba(26, 25, 22, 0.88)';
  ctx.strokeStyle = 'rgba(26, 25, 22, 0.42)';
  ctx.textBaseline = 'middle';

  // Thin top/bottom framing hairlines
  ctx.lineWidth = 2;
  const lineInsetX = isPole ? 40 : 58;
  const lineInsetY = isPole ? 30 : 40;
  ctx.beginPath();
  ctx.moveTo(padX + lineInsetX, padY + lineInsetY);
  ctx.lineTo(w - padX - lineInsetX, padY + lineInsetY);
  ctx.moveTo(padX + lineInsetX, h - padY - lineInsetY);
  ctx.lineTo(w - padX - lineInsetX, h - padY - lineInsetY);
  ctx.stroke();

  if (variant === 'primary') {
    // Registration crosshair on left
    const rx = padX + 94;
    const ry = h / 2;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(rx, ry, 16, 0, Math.PI * 2);
    ctx.moveTo(rx - 24, ry);
    ctx.lineTo(rx + 24, ry);
    ctx.moveTo(rx, ry - 24);
    ctx.lineTo(rx, ry + 24);
    ctx.stroke();

    // Main bold typography
    ctx.font = '700 44px "IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillText('MADE IN SWEDEN', padX + 148, h / 2 - 14);

    // Sub-copy technical metadata
    ctx.fillStyle = 'rgba(32, 31, 28, 0.56)';
    ctx.font = '600 22px Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillText('SPHERE LABYRINTH NO. 13   ·   ABS / PC SHELL   ·   STHLM 2026', padX + 150, h / 2 + 30);

    // Right-side batch stamp box
    const bx = w - padX - 246;
    ctx.strokeStyle = 'rgba(32, 31, 28, 0.45)';
    ctx.lineWidth = 2.2;
    ctx.strokeRect(bx, h / 2 - 36, 178, 72);
    ctx.fillStyle = 'rgba(32, 31, 28, 0.74)';
    ctx.font = '700 24px "IBM Plex Sans", "Helvetica Neue", sans-serif';
    ctx.fillText('SE-013', bx + 18, h / 2 - 11);
    ctx.fillStyle = 'rgba(32, 31, 28, 0.54)';
    ctx.font = '600 17px Inter, "Helvetica Neue", sans-serif';
    ctx.fillText('Ø120MM  QC ✓', bx + 18, h / 2 + 18);
  } else if (variant === 'secondary') {
    // Secondary seal strip on opposite side
    ctx.font = '700 34px "IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillText('INSPECTION SEAL  ·  DO NOT OPEN', padX + 110, h / 2 - 12);

    ctx.fillStyle = 'rgba(32, 31, 28, 0.54)';
    ctx.font = '600 21px Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillText('LOT 26-1113   ·   PRECISION STEEL 8MM   ·   MADE IN SWEDEN', padX + 112, h / 2 + 28);
  } else {
    // Compact polar calibration tape (North / South) matching the MADE IN SWEDEN style
    const isNorth = variant === 'north';
    const rx = padX + 76;
    const ry = h / 2;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(rx, ry, 14, 0, Math.PI * 2);
    ctx.moveTo(rx - 21, ry);
    ctx.lineTo(rx + 21, ry);
    ctx.moveTo(rx, ry - 21);
    ctx.lineTo(rx, ry + 21);
    ctx.stroke();

    ctx.font = '700 38px "IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillText(isNorth ? 'NORTH POLE' : 'SOUTH POLE', padX + 124, h / 2 - 14);

    ctx.fillStyle = 'rgba(32, 31, 28, 0.56)';
    ctx.font = '600 19px Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillText(
      isNorth ? '+90°N  ·  00 START  ·  AXIS REF' : '−90°S  ·  13 END  ·  AXIS REF',
      padX + 126,
      h / 2 + 26,
    );

    const bx = w - padX - 134;
    ctx.strokeStyle = 'rgba(32, 31, 28, 0.45)';
    ctx.lineWidth = 2.2;
    ctx.strokeRect(bx, h / 2 - 30, 88, 60);
    ctx.fillStyle = 'rgba(32, 31, 28, 0.78)';
    ctx.font = '700 32px "IBM Plex Sans", "Helvetica Neue", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(isNorth ? 'N' : 'S', bx + 44, h / 2 + 2);
    ctx.textAlign = 'left';
  }

  ctx.restore();

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.anisotropy = 4;

  return { map, roughnessMap };
}

/**
 * Tiny crisp pad-printed technical label texture for checkpoint numerals & start/end rings.
 */
export function createDecalLabelTexture(text: string, subText?: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);

  // Delicate hairline ring
  ctx.strokeStyle = 'rgba(42, 40, 36, 0.34)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  ctx.stroke();

  // Four tiny tick marks
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(size / 2 + Math.cos(a) * size * 0.36, size / 2 + Math.sin(a) * size * 0.36);
    ctx.lineTo(size / 2 + Math.cos(a) * size * 0.45, size / 2 + Math.sin(a) * size * 0.45);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(38, 36, 32, 0.62)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 44px "IBM Plex Sans", "Helvetica Neue", sans-serif';
  ctx.fillText(text, size / 2, subText ? size * 0.24 : size * 0.25);

  if (subText) {
    ctx.fillStyle = 'rgba(38, 36, 32, 0.46)';
    ctx.font = '600 22px Inter, "Helvetica Neue", sans-serif';
    ctx.fillText(subText, size / 2, size * 0.78);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Soft radial glow sprite texture for the miniature checkpoint LEDs inside the track.
 */
export function createLedHaloTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.22, 'rgba(255, 255, 255, 0.62)');
  grad.addColorStop(0.55, 'rgba(255, 255, 255, 0.16)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Very fine brushed-steel micro-roughness texture for the rolling metal ball.
 */
export function createMetalBallTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(26, 26, 26)'; // smooth chrome (~0.10 roughness)
  ctx.fillRect(0, 0, w, h);

  const rng = mulberry32(7713);
  for (let i = 0; i < 160; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const len = 10 + rng() * 48;
    const ang = rng() * Math.PI * 2;
    ctx.strokeStyle = `rgba(110, 110, 110, ${0.06 + rng() * 0.16})`;
    ctx.lineWidth = 0.6 + rng() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Minimalist etched line-art padlock icon pad-printed onto permanently locked walls (inspired by reference).
 */
export function createPadlockGlyphTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(42, 40, 36, 0.72)';
  ctx.fillStyle = 'rgba(42, 40, 36, 0.72)';
  ctx.lineWidth = 7.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Shackle arch
  ctx.beginPath();
  ctx.arc(64, 52, 16, Math.PI, 0, false);
  ctx.lineTo(80, 62);
  ctx.moveTo(48, 52);
  ctx.lineTo(48, 62);
  ctx.stroke();

  // Lock body (rounded rect)
  ctx.beginPath();
  ctx.roundRect(38, 60, 52, 38, 7);
  ctx.stroke();

  // Minimal keyhole dot
  ctx.beginPath();
  ctx.arc(64, 79, 4.5, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Minimalist etched directional micro-arrow for morphing actuator walls.
 */
export function createArrowGlyphTexture(): THREE.CanvasTexture {
  const w = 192;
  const h = 96;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(42, 40, 36, 0.58)';
  ctx.lineWidth = 6.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Clean horizontal double-headed arrow (↔)
  ctx.beginPath();
  ctx.moveTo(46, 48);
  ctx.lineTo(146, 48);
  // Left arrowhead
  ctx.moveTo(62, 34);
  ctx.lineTo(44, 48);
  ctx.lineTo(62, 62);
  // Right arrowhead
  ctx.moveTo(130, 34);
  ctx.lineTo(148, 48);
  ctx.lineTo(130, 62);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Minimalist circular pad-print ring around a floor Toggle Switch (⇄ A / ⇄ B).
 */
export function createTogglePadDecalTexture(label: string, accentHex: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);

  // Subtle dashed outer collar ring in the toggle's accent hue
  ctx.strokeStyle = accentHex;
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 4.5;
  ctx.setLineDash([12, 8]);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.43, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Crisp label at top & toggle symbol at bottom
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = accentHex;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 34px "IBM Plex Sans", "Helvetica Neue", sans-serif';
  ctx.fillText(`SW ${label}`, size / 2, size * 0.16);
  ctx.font = '600 26px Inter, "Helvetica Neue", sans-serif';
  ctx.fillText('⇄', size / 2, size * 0.84);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Cross-section luminous LED light-pipe gradient texture for sleek gate neon bars:
 * pure saturated red/blue glowing edges smoothly blooming into a luminous bright LED filament center
 * (calibrated to stay unmistakably red/blue while genuinely glowing like an LED under studioFilmic).
 */
export function createNeonTubeTexture(colorId: 0 | 1): THREE.CanvasTexture {
  const w = 64;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  if (colorId === 0) {
    // Sleek glowing laser-red LED light pipe (pure red edges -> luminous hot red-white filament core)
    grad.addColorStop(0.0, '#e60404');
    grad.addColorStop(0.22, '#ff120e');
    grad.addColorStop(0.4, '#ff4842');
    grad.addColorStop(0.5, '#ff8a84');
    grad.addColorStop(0.6, '#ff4842');
    grad.addColorStop(0.78, '#ff120e');
    grad.addColorStop(1.0, '#e60404');
  } else {
    // Sleek glowing cobalt-blue LED light pipe (vivid blue edges -> luminous bright cyan-blue core)
    grad.addColorStop(0.0, '#0038f0');
    grad.addColorStop(0.22, '#0c5eff');
    grad.addColorStop(0.4, '#4a98ff');
    grad.addColorStop(0.5, '#9ed0ff');
    grad.addColorStop(0.6, '#4a98ff');
    grad.addColorStop(0.78, '#0c5eff');
    grad.addColorStop(1.0, '#0038f0');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}


