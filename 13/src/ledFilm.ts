import * as THREE from 'three';

// Crisp 5x7 dot-matrix bitmap font (each row is 5 bits, MSB on left)
const FONT_5X7: Record<string, number[]> = {
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  '-': [0x00, 0x00, 0x00, 0x1c, 0x00, 0x00, 0x00],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x18, 0x18],
  '·': [0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00],
  '/': [0x02, 0x02, 0x04, 0x04, 0x08, 0x08, 0x10],
  ':': [0x00, 0x18, 0x18, 0x00, 0x18, 0x18, 0x00],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x08, 0x18, 0x08, 0x08, 0x08, 0x08, 0x1c],
  '2': [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  '3': [0x1e, 0x01, 0x01, 0x0e, 0x01, 0x01, 0x1e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x1c, 0x08, 0x08, 0x08, 0x08, 0x08, 0x1c],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
};

// Proportional column width for narrow characters so spacing reads crisply on the LED matrix
const GLYPH_WIDTH: Record<string, number> = {
  ' ': 2,
  '-': 3,
  '.': 2,
  '·': 1,
  ':': 2,
  '1': 3,
  I: 3,
  '/': 4,
};

export interface LedFilmRig {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
  glowMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  isCleared: () => boolean;
  getLightFactor: () => number;
  setLevel: (levelNum: number, title: string, cleared?: boolean) => void;
  restartIntro: () => void;
  update: (time: number) => void;
  dispose: () => void;
}

function makeDiodeSprite(
  size: number,
  haloColor: string,
  ringColor: string,
  bodyColor: string,
  coreColor: string,
  drawRing: boolean,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const half = size * 0.5;

  const grad = ctx.createRadialGradient(half, half, 0.8, half, half, half);
  grad.addColorStop(0, haloColor);
  grad.addColorStop(0.42, haloColor);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  if (drawRing) {
    ctx.fillStyle = ringColor;
    ctx.beginPath();
    ctx.roundRect(half - 2.75, half - 2.6, 5.5, 5.2, 1.25);
    ctx.fill();
  }

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.roundRect(half - 2.15, half - 2.0, 4.3, 4.0, 0.9);
  ctx.fill();

  // Delicate pinpoint white-hot semiconductor die sparkle at the center
  ctx.fillStyle = coreColor;
  ctx.fillRect(half - 0.58, half - 0.55, 1.16, 1.1);
  return c;
}

function makeBloomSprite(size: number, coreRgba: string, midRgba: string, outerRgba: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const half = size * 0.5;

  const grad = ctx.createRadialGradient(half, half, 0.2, half, half, half);
  grad.addColorStop(0.0, coreRgba);
  grad.addColorStop(0.16, midRgba);
  grad.addColorStop(0.52, outerRgba);
  grad.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/**
 * Transparent flexible conductive PCB / micro-LED film ribbon adhered directly to the curved outer shell.
 * Features etched silver/copper bus rails, SMD flex-driver IC, gold test pads, transparent ITO column grid,
 * smoked-PET optical contrast filter, and a centered 7x80 electric-cyan micro-LED display that blinks/dissolves
 * in "LEVEL N" and scans/dissolves into "[TITLE]".
 */
export function createLedFilmDisplay(): LedFilmRig {
  const W = 768;
  const H = 128;
  const GW = 384;
  const GH = 64;
  const COLS = 80;
  const ROWS = 7;

  // Active diode matrix pixel grid bounds inside the 768x128 transparent film
  const gridLeft = 74;
  const gridRight = 694;
  const gridTop = 32;
  const gridBottom = 96;
  const pitchX = (gridRight - gridLeft) / (COLS - 1);
  const pitchY = (gridBottom - gridTop) / (ROWS - 1);

  // Deterministic per-diode threshold [0..1] for crisp organic pixel dissolve transitions
  const pixelThresh = new Float32Array(COLS * ROWS);
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      let h = (col * 374761393 + row * 668265263 + 1313) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      pixelThresh[col * ROWS + row] = ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    }
  }

  // Pre-rendered crisp micro-LED sprites for sub-0.1ms Canvas2D blitting (electric cyan active, emerald mint cleared)
  const SPRITE_SZ = 12;
  const SPRITE_HALF = SPRITE_SZ * 0.5;
  const cyanDiffSprite = makeDiodeSprite(
    SPRITE_SZ,
    'rgba(10, 210, 245, 0.36)',
    'rgba(4, 34, 46, 0.62)',
    '#06ccf0',
    '#ecfeff',
    true,
  );
  const cyanEmSprite = makeDiodeSprite(
    SPRITE_SZ,
    'rgba(8, 214, 248, 0.44)',
    '#000000',
    '#08d6f8',
    '#e4fdff',
    false,
  );
  const mintDiffSprite = makeDiodeSprite(
    SPRITE_SZ,
    'rgba(24, 226, 142, 0.34)',
    'rgba(6, 40, 28, 0.60)',
    '#14d884',
    '#eefff8',
    true,
  );
  const mintEmSprite = makeDiodeSprite(
    SPRITE_SZ,
    'rgba(22, 232, 144, 0.42)',
    '#000000',
    '#1ae48c',
    '#e6fff5',
    false,
  );

  // Tight, clean bloom stamps for the AdditiveBlending HDR halo mesh (keeps every diode dot sharp & saturated cyan!)
  const BLOOM_SZ = 13;
  const BLOOM_HALF = BLOOM_SZ * 0.5;
  const cyanBloomSprite = makeBloomSprite(
    BLOOM_SZ,
    'rgba(165, 248, 255, 0.62)',
    'rgba(14, 214, 248, 0.38)',
    'rgba(6, 172, 230, 0.09)',
  );
  const mintBloomSprite = makeBloomSprite(
    BLOOM_SZ,
    'rgba(175, 255, 224, 0.60)',
    'rgba(32, 230, 148, 0.36)',
    'rgba(16, 194, 120, 0.08)',
  );

  // 1. Pre-render static flexible conductive PET film substrate + etched copper/silver traces + SMD driver IC
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = W;
  baseCanvas.height = H;
  const bCtx = baseCanvas.getContext('2d')!;

  const padX = 9;
  const padY = 9;
  const r = 8;
  bCtx.beginPath();
  bCtx.roundRect(padX, padY, W - padX * 2, H - padY * 2, r);
  const filmGrad = bCtx.createLinearGradient(0, padY, 0, H - padY);
  filmGrad.addColorStop(0, 'rgba(188, 184, 176, 0.56)');
  filmGrad.addColorStop(0.16, 'rgba(196, 192, 186, 0.36)');
  filmGrad.addColorStop(0.84, 'rgba(194, 190, 184, 0.34)');
  filmGrad.addColorStop(1, 'rgba(182, 177, 169, 0.54)');
  bCtx.fillStyle = filmGrad;
  bCtx.fill();

  bCtx.strokeStyle = 'rgba(96, 92, 84, 0.54)';
  bCtx.lineWidth = 1.25;
  bCtx.stroke();

  bCtx.strokeStyle = 'rgba(255, 255, 255, 0.50)';
  bCtx.lineWidth = 0.85;
  bCtx.beginPath();
  bCtx.roundRect(padX + 1.5, padY + 1.5, W - (padX + 1.5) * 2, H - (padY + 1.5) * 2, r - 1);
  bCtx.stroke();

  // Smoked translucent optical contrast window (still clearly transparent to maze behind, lets lit diodes BLAZE!)
  const winGrad = bCtx.createLinearGradient(0, gridTop - 8, 0, gridBottom + 8);
  winGrad.addColorStop(0, 'rgba(28, 27, 25, 0.44)');
  winGrad.addColorStop(0.5, 'rgba(24, 23, 21, 0.48)');
  winGrad.addColorStop(1, 'rgba(28, 27, 25, 0.44)');
  bCtx.fillStyle = winGrad;
  bCtx.beginPath();
  bCtx.roundRect(gridLeft - 8, gridTop - 8, gridRight - gridLeft + 16, gridBottom - gridTop + 16, 4.5);
  bCtx.fill();
  bCtx.strokeStyle = 'rgba(42, 40, 36, 0.38)';
  bCtx.lineWidth = 0.9;
  bCtx.stroke();

  // Top & bottom conductive silver-copper power bus rails (VCC / GND)
  const drawBusRail = (y: number, thickness: number, alpha: number) => {
    bCtx.strokeStyle = `rgba(156, 130, 92, ${alpha})`;
    bCtx.lineWidth = thickness;
    bCtx.beginPath();
    bCtx.moveTo(48, y);
    bCtx.lineTo(W - 48, y);
    bCtx.stroke();
  };
  drawBusRail(18, 1.8, 0.58);
  drawBusRail(22.5, 0.9, 0.38);
  drawBusRail(H - 18, 1.8, 0.58);
  drawBusRail(H - 22.5, 0.9, 0.38);

  // Ultra-fine transparent conductive ITO horizontal row traces & vertical column traces
  bCtx.strokeStyle = 'rgba(170, 158, 138, 0.22)';
  bCtx.lineWidth = 0.7;
  for (let row = 0; row < ROWS; row++) {
    const y = gridTop + row * pitchY;
    bCtx.beginPath();
    bCtx.moveTo(56, y);
    bCtx.lineTo(gridRight + 10, y);
    bCtx.stroke();
  }
  bCtx.strokeStyle = 'rgba(170, 158, 138, 0.14)';
  bCtx.lineWidth = 0.55;
  for (let col = 0; col < COLS; col++) {
    const x = gridLeft + col * pitchX;
    bCtx.beginPath();
    bCtx.moveTo(x, 23);
    bCtx.lineTo(x, H - 23);
    bCtx.stroke();
  }

  // Left end: miniature matte-charcoal SMD flex-PCB LED driver IC + metallic gull-wing pins fanning to row traces
  const icX = 26;
  const icY = 32;
  const icW = 21;
  const icH = 64;
  bCtx.strokeStyle = 'rgba(154, 130, 94, 0.66)';
  bCtx.lineWidth = 0.9;
  for (let row = 0; row < ROWS; row++) {
    const pinY = icY + 7 + (row / (ROWS - 1)) * (icH - 14);
    const rowY = gridTop + row * pitchY;
    bCtx.beginPath();
    bCtx.moveTo(icX + icW, pinY);
    bCtx.lineTo(icX + icW + 7, pinY);
    bCtx.lineTo(56, rowY);
    bCtx.stroke();
    bCtx.fillStyle = 'rgba(186, 188, 192, 0.92)';
    bCtx.fillRect(icX + icW, pinY - 1.2, 4, 2.4);
    bCtx.fillRect(icX - 3, pinY - 1.2, 3, 2.4);
  }
  bCtx.fillStyle = 'rgba(26, 26, 28, 0.94)';
  bCtx.beginPath();
  bCtx.roundRect(icX, icY, icW, icH, 2.5);
  bCtx.fill();
  bCtx.strokeStyle = 'rgba(98, 98, 102, 0.62)';
  bCtx.lineWidth = 0.85;
  bCtx.stroke();
  bCtx.fillStyle = 'rgba(210, 205, 198, 0.74)';
  bCtx.beginPath();
  bCtx.arc(icX + 5.5, icY + 6, 1.7, 0, Math.PI * 2);
  bCtx.fill();

  // Right end: 4 gold-plated flex connector test pads (VCC · DAT · CLK · GND)
  const padColX = W - 43;
  const padLabels = ['V+', 'DA', 'CK', 'GD'];
  bCtx.font = '600 6.5px "IBM Plex Mono", ui-monospace, monospace';
  bCtx.textBaseline = 'middle';
  bCtx.textAlign = 'right';
  for (let i = 0; i < 4; i++) {
    const py = 38 + i * 17.5;
    bCtx.fillStyle = 'rgba(204, 166, 94, 0.86)';
    bCtx.beginPath();
    bCtx.roundRect(padColX, py - 4, 14, 8, 2);
    bCtx.fill();
    bCtx.strokeStyle = 'rgba(128, 98, 50, 0.70)';
    bCtx.lineWidth = 0.75;
    bCtx.stroke();
    bCtx.strokeStyle = 'rgba(154, 130, 94, 0.54)';
    bCtx.beginPath();
    bCtx.moveTo(padColX, py);
    bCtx.lineTo(gridRight + 10, py);
    bCtx.stroke();
    bCtx.fillStyle = 'rgba(46, 42, 36, 0.76)';
    bCtx.fillText(padLabels[i], padColX - 3, py);
  }

  // Technical micro-silkscreen along top & bottom margins
  bCtx.font = '600 6.8px "IBM Plex Mono", ui-monospace, monospace';
  bCtx.fillStyle = 'rgba(34, 31, 26, 0.70)';
  bCtx.textAlign = 'left';
  bCtx.textBaseline = 'middle';
  bCtx.fillText('FPC-13 // TRANSPARENT LED FILM', 74, 15.5);
  bCtx.textAlign = 'right';
  bCtx.fillText('ITO MATRIX 7×80 · STHLM', 694, H - 15);

  // Pre-draw all 7x80 physical unlit micro-LED SMD packages onto the smoked window
  for (let row = 0; row < ROWS; row++) {
    const y = gridTop + row * pitchY;
    for (let col = 0; col < COLS; col++) {
      const x = gridLeft + col * pitchX;
      bCtx.fillStyle = 'rgba(182, 176, 166, 0.20)';
      bCtx.fillRect(x - 1.85, y - 1.65, 3.7, 3.3);
      bCtx.fillStyle = 'rgba(24, 22, 20, 0.34)';
      bCtx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    }
  }

  // 2. Roughness map (glossy PET film + matte SMD IC)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 128;
  roughCanvas.height = 32;
  const rCtx = roughCanvas.getContext('2d')!;
  rCtx.fillStyle = '#444444';
  rCtx.fillRect(0, 0, 128, 32);
  rCtx.fillStyle = '#989898';
  rCtx.fillRect(4, 8, 4, 16);

  // 3. Live diffuse, emissive, and wide-bloom canvases (generateMipmaps=false for locked 60 FPS!)
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = W;
  mapCanvas.height = H;
  const mCtx = mapCanvas.getContext('2d')!;

  const emCanvas = document.createElement('canvas');
  emCanvas.width = W;
  emCanvas.height = H;
  const eCtx = emCanvas.getContext('2d')!;

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = GW;
  glowCanvas.height = GH;
  const gCtx = glowCanvas.getContext('2d')!;

  const makeLiveTex = (canvas: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 1;
    return t;
  };

  const map = makeLiveTex(mapCanvas);
  const emissiveMap = makeLiveTex(emCanvas);
  const glowMap = makeLiveTex(glowCanvas);
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);

  const buildCenteredColumns = (text: string): Uint8Array => {
    const upper = text.toUpperCase();
    const raw: number[] = [];
    for (let i = 0; i < upper.length; i++) {
      const ch = upper[i];
      const glyph = FONT_5X7[ch] ?? FONT_5X7[' '];
      const gw = GLYPH_WIDTH[ch] ?? 5;
      for (let cx = 0; cx < gw; cx++) {
        let colBits = 0;
        const bitMask = 1 << (4 - cx);
        for (let ry = 0; ry < ROWS; ry++) {
          if (glyph[ry] & bitMask) colBits |= 1 << ry;
        }
        raw.push(colBits);
      }
      if (i < upper.length - 1) raw.push(0); // 1-column kerning gap
    }
    const out = new Uint8Array(COLS);
    const startCol = Math.max(0, Math.floor((COLS - raw.length) * 0.5));
    for (let i = 0; i < raw.length && startCol + i < COLS; i++) {
      out[startCol + i] = raw[i];
    }
    return out;
  };

  const frameCols = new Uint8Array(COLS);
  let levelCols = buildCenteredColumns('LEVEL 1');
  let titleCols = buildCenteredColumns('FIRST ROLL');
  let clearCols = buildCenteredColumns('CLEAR');
  let isClearedColor = false;
  let seqStartTime = -1;
  let lastRenderKey = '';
  let currentKey = '';
  let lightFactor = 1.0;

  const drawDisplay = (cols: Uint8Array, scanCol: number, pilotOn: boolean) => {
    mCtx.clearRect(0, 0, W, H);
    mCtx.drawImage(baseCanvas, 0, 0);

    eCtx.fillStyle = '#000000';
    eCtx.fillRect(0, 0, W, H);

    gCtx.globalCompositeOperation = 'source-over';
    gCtx.fillStyle = '#000000';
    gCtx.fillRect(0, 0, GW, GH);
    gCtx.globalCompositeOperation = 'lighter';

    const diffSprite = isClearedColor ? mintDiffSprite : cyanDiffSprite;
    const emSprite = isClearedColor ? mintEmSprite : cyanEmSprite;
    const bloomSprite = isClearedColor ? mintBloomSprite : cyanBloomSprite;

    if (pilotOn) {
      const px = 36;
      const py = 107;
      mCtx.drawImage(diffSprite, px - 5.5, py - 5.5, 11, 11);
      eCtx.drawImage(emSprite, px - 5.5, py - 5.5, 11, 11);
      gCtx.drawImage(bloomSprite, px * 0.5 - 8, py * 0.5 - 8, 16, 16);
    }

    let litCount = 0;
    for (let col = 0; col < COLS; col++) {
      const bits = cols[col];
      const isScanHead = scanCol >= 0 && col === scanCol;
      if (bits === 0 && !isScanHead) continue;

      const cx = gridLeft + col * pitchX;
      const x = cx - SPRITE_HALF;
      const gx = cx * 0.5 - BLOOM_HALF;
      for (let row = 0; row < ROWS; row++) {
        const bitOn = (bits & (1 << row)) !== 0;
        if (!bitOn && !isScanHead) continue;

        const cy = gridTop + row * pitchY;
        if (bitOn) {
          mCtx.drawImage(diffSprite, x, cy - SPRITE_HALF);
          eCtx.drawImage(emSprite, x, cy - SPRITE_HALF);
          gCtx.drawImage(bloomSprite, gx, cy * 0.5 - BLOOM_HALF);
          litCount++;
        } else {
          // Subtle luminous cyan optical scanline cursor sweeping left-to-right during title reveal
          mCtx.globalAlpha = 0.42;
          eCtx.globalAlpha = 0.48;
          gCtx.globalAlpha = 0.36;
          mCtx.drawImage(diffSprite, x, cy - SPRITE_HALF);
          eCtx.drawImage(emSprite, x, cy - SPRITE_HALF);
          gCtx.drawImage(bloomSprite, gx, cy * 0.5 - BLOOM_HALF);
          mCtx.globalAlpha = 1;
          eCtx.globalAlpha = 1;
          gCtx.globalAlpha = 1;
        }
      }
    }

    lightFactor = Math.min(1, litCount / 55);
    map.needsUpdate = true;
    emissiveMap.needsUpdate = true;
    glowMap.needsUpdate = true;
  };

  function setLevel(levelNum: number, title: string, cleared = false) {
    const key = `${levelNum}|${title}|${cleared ? 1 : 0}`;
    if (key === currentKey) return;
    currentKey = key;
    isClearedColor = cleared;
    levelCols = buildCenteredColumns(`LEVEL ${levelNum}`);
    titleCols = buildCenteredColumns(title);
    clearCols = buildCenteredColumns(`LEVEL ${levelNum} · CLEAR`);
    seqStartTime = -1;
    lastRenderKey = '';
  }

  function restartIntro() {
    seqStartTime = -1;
    lastRenderKey = '';
  }

  function update(time: number) {
    if (seqStartTime < 0) seqStartTime = time;
    const elapsed = Math.max(0, time - seqStartTime);
    const pilotOn = Math.floor(time * 2) % 2 === 0;

    // Cleared celebration: brief double-blink + dissolve into mint "LEVEL N · CLEAR"
    if (isClearedColor) {
      const q = Math.min(20, Math.floor(elapsed * 28));
      const key = `clr:${q}:${pilotOn ? 1 : 0}`;
      if (key === lastRenderKey) return;
      lastRenderKey = key;

      const blinkOff = (elapsed > 0.08 && elapsed < 0.14) || (elapsed > 0.21 && elapsed < 0.27);
      const prog = Math.min(1, elapsed / 0.45);
      for (let col = 0; col < COLS; col++) {
        let bits = 0;
        if (!blinkOff) {
          const src = clearCols[col];
          if (src !== 0) {
            for (let row = 0; row < ROWS; row++) {
              if ((src & (1 << row)) !== 0 && pixelThresh[col * ROWS + row] <= prog) {
                bits |= 1 << row;
              }
            }
          }
        }
        frameCols[col] = bits;
      }
      drawDisplay(frameCols, -1, pilotOn);
      return;
    }

    // Active level sequence (first cycle synced to level intro, then gently loops during gameplay):
    // 0.00 - 0.56s : Blink + pixel dissolve in "LEVEL N"
    // 0.56 - 1.50s : Steady luminous hold "LEVEL N"
    // 1.50 - 2.15s : Left-to-right optical scan + pixel dissolve into "[TITLE]"
    // 2.15 - 5.45s : Steady luminous hold "[TITLE]"
    // 5.45 - 6.00s : Gentle pixel dissolve back to "LEVEL N"
    const LOOP = 6.0;
    const phaseT = elapsed < LOOP ? elapsed : 0.56 + ((elapsed - LOOP) % (LOOP - 0.56));
    let scanCol = -1;
    let quantKey: string;

    if (phaseT < 0.56) {
      const q = Math.floor(phaseT * 32);
      quantKey = `in:${q}:${pilotOn ? 1 : 0}`;
      if (quantKey === lastRenderKey) return;
      lastRenderKey = quantKey;

      // Crisp micro-LED boot double-blink + organic pixel dissolve
      const blinkOff = (phaseT > 0.07 && phaseT < 0.13) || (phaseT > 0.2 && phaseT < 0.26);
      const prog = Math.min(1, phaseT / 0.48);
      for (let col = 0; col < COLS; col++) {
        let bits = 0;
        if (!blinkOff) {
          const src = levelCols[col];
          if (src !== 0) {
            for (let row = 0; row < ROWS; row++) {
              if ((src & (1 << row)) !== 0 && pixelThresh[col * ROWS + row] <= prog) {
                bits |= 1 << row;
              }
            }
          }
        }
        frameCols[col] = bits;
      }
    } else if (phaseT < 1.5) {
      quantKey = `lvl:${pilotOn ? 1 : 0}`;
      if (quantKey === lastRenderKey) return;
      lastRenderKey = quantKey;
      frameCols.set(levelCols);
    } else if (phaseT < 2.15) {
      const u = (phaseT - 1.5) / 0.65;
      const scanPos = u * (COLS + 8) - 4;
      scanCol = Math.round(scanPos);
      quantKey = `scan:${scanCol}:${pilotOn ? 1 : 0}`;
      if (quantKey === lastRenderKey) return;
      lastRenderKey = quantKey;

      for (let col = 0; col < COLS; col++) {
        const dist = scanPos - col; // > 0 means scan has already passed this column
        if (dist >= 4) {
          frameCols[col] = titleCols[col];
        } else if (dist <= -4) {
          frameCols[col] = levelCols[col];
        } else {
          // Dissolve zone right around the sweeping scanline
          const blend = (dist + 4) / 8;
          let bits = 0;
          const a = levelCols[col];
          const b = titleCols[col];
          for (let row = 0; row < ROWS; row++) {
            const bit = 1 << row;
            const takeB = pixelThresh[col * ROWS + row] <= blend;
            if (takeB ? (b & bit) !== 0 : (a & bit) !== 0) bits |= bit;
          }
          frameCols[col] = bits;
        }
      }
    } else if (phaseT < 5.45) {
      quantKey = `ttl:${pilotOn ? 1 : 0}`;
      if (quantKey === lastRenderKey) return;
      lastRenderKey = quantKey;
      frameCols.set(titleCols);
    } else {
      const u = (phaseT - 5.45) / 0.55;
      const q = Math.floor(u * 20);
      quantKey = `rev:${q}:${pilotOn ? 1 : 0}`;
      if (quantKey === lastRenderKey) return;
      lastRenderKey = quantKey;

      for (let col = 0; col < COLS; col++) {
        let bits = 0;
        const a = titleCols[col];
        const b = levelCols[col];
        for (let row = 0; row < ROWS; row++) {
          const bit = 1 << row;
          const takeB = pixelThresh[col * ROWS + row] <= u;
          if (takeB ? (b & bit) !== 0 : (a & bit) !== 0) bits |= bit;
        }
        frameCols[col] = bits;
      }
    }

    drawDisplay(frameCols, scanCol >= 0 && scanCol < COLS ? scanCol : -1, pilotOn);
  }

  setLevel(1, 'FIRST ROLL', false);
  drawDisplay(levelCols, -1, true);

  return {
    map,
    emissiveMap,
    glowMap,
    roughnessMap,
    isCleared: () => isClearedColor,
    getLightFactor: () => lightFactor,
    setLevel,
    restartIntro,
    update,
    dispose: () => {
      map.dispose();
      emissiveMap.dispose();
      glowMap.dispose();
      roughnessMap.dispose();
    },
  };
}
