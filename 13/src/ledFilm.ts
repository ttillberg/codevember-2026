import * as THREE from 'three';

export interface LedFilmRig {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  isCleared: () => boolean;
  setLevel: (levelNum: number, title: string, titleJa: string, cleared?: boolean) => void;
  restartIntro: () => void;
  clearToBlank: () => void;
  update: (time: number) => void;
  dispose: () => void;
}

/**
 * Handcrafted 100% SQUARE-CORNERED architectural bitmap pixel font (12 rows tall, uniform 2px strokes,
 * strict 90-degree corners — zero rounded bevels, pure Swiss/Swedish hardware pixel geometry).
 */
const SQUARE_FONT_12: Record<string, string[]> = {
  ' ': ['....', '....', '....', '....', '....', '....', '....', '....', '....', '....', '....', '....'],
  '-': ['......', '......', '......', '......', '......', '######', '######', '......', '......', '......', '......', '......'],
  '·': ['..', '..', '..', '..', '..', '##', '##', '..', '..', '..', '..', '..'],
  '0': ['#######', '#######', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '#######', '#######'],
  '1': ['..####.', '..####.', '....##.', '....##.', '....##.', '....##.', '....##.', '....##.', '....##.', '....##.', '#######', '#######'],
  '2': ['#######', '#######', '.....##', '.....##', '.....##', '#######', '#######', '##.....', '##.....', '##.....', '#######', '#######'],
  '3': ['#######', '#######', '.....##', '.....##', '.....##', '..#####', '..#####', '.....##', '.....##', '.....##', '#######', '#######'],
  '4': ['##...##', '##...##', '##...##', '##...##', '##...##', '#######', '#######', '.....##', '.....##', '.....##', '.....##', '.....##'],
  '5': ['#######', '#######', '##.....', '##.....', '##.....', '#######', '#######', '.....##', '.....##', '.....##', '#######', '#######'],
  '6': ['#######', '#######', '##.....', '##.....', '##.....', '#######', '#######', '##...##', '##...##', '##...##', '#######', '#######'],
  '7': ['#######', '#######', '.....##', '.....##', '.....##', '.....##', '.....##', '.....##', '.....##', '.....##', '.....##', '.....##'],
  '8': ['#######', '#######', '##...##', '##...##', '##...##', '#######', '#######', '##...##', '##...##', '##...##', '#######', '#######'],
  '9': ['#######', '#######', '##...##', '##...##', '##...##', '#######', '#######', '.....##', '.....##', '.....##', '#######', '#######'],
  A: ['#######', '#######', '##...##', '##...##', '##...##', '#######', '#######', '##...##', '##...##', '##...##', '##...##', '##...##'],
  B: ['######.', '#######', '##...##', '##...##', '##...##', '######.', '#######', '##...##', '##...##', '##...##', '#######', '######.'],
  C: ['#######', '#######', '##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '#######', '#######'],
  D: ['######.', '#######', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '#######', '######.'],
  E: ['#######', '#######', '##.....', '##.....', '##.....', '######.', '######.', '##.....', '##.....', '##.....', '#######', '#######'],
  F: ['#######', '#######', '##.....', '##.....', '##.....', '######.', '######.', '##.....', '##.....', '##.....', '##.....', '##.....'],
  G: ['#######', '#######', '##.....', '##.....', '##.....', '##..###', '##..###', '##...##', '##...##', '##...##', '#######', '#######'],
  H: ['##...##', '##...##', '##...##', '##...##', '##...##', '#######', '#######', '##...##', '##...##', '##...##', '##...##', '##...##'],
  I: ['######', '######', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '######', '######'],
  J: ['.....##', '.....##', '.....##', '.....##', '.....##', '.....##', '.....##', '##...##', '##...##', '##...##', '#######', '#######'],
  K: ['##...##', '##...##', '##..##.', '##..##.', '##.##..', '####...', '####...', '##.##..', '##..##.', '##..##.', '##...##', '##...##'],
  L: ['##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '#######', '#######'],
  M: ['##.....##', '###...###', '####.####', '##.###.##', '##..#..##', '##.....##', '##.....##', '##.....##', '##.....##', '##.....##', '##.....##', '##.....##'],
  N: ['##...##', '###..##', '###..##', '####.##', '##.####', '##..###', '##..###', '##...##', '##...##', '##...##', '##...##', '##...##'],
  O: ['#######', '#######', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '#######', '#######'],
  P: ['#######', '#######', '##...##', '##...##', '##...##', '#######', '#######', '##.....', '##.....', '##.....', '##.....', '##.....'],
  Q: ['#######', '#######', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##.#.##', '##..###', '#######', '#####.#'],
  R: ['#######', '#######', '##...##', '##...##', '##...##', '#######', '#######', '##..##.', '##...##', '##...##', '##...##', '##...##'],
  S: ['#######', '#######', '##.....', '##.....', '##.....', '#######', '#######', '.....##', '.....##', '.....##', '#######', '#######'],
  T: ['########', '########', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...'],
  U: ['##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '#######', '#######'],
  V: ['##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '.##.##.', '.##.##.', '..###..', '..###..'],
  W: ['##.....##', '##.....##', '##.....##', '##.....##', '##.....##', '##.....##', '##..#..##', '##.###.##', '####.####', '###...###', '##.....##', '##.....##'],
  X: ['##...##', '##...##', '.##.##.', '.##.##.', '..###..', '..###..', '..###..', '..###..', '.##.##.', '.##.##.', '##...##', '##...##'],
  Y: ['##....##', '##....##', '##....##', '.##..##.', '..####..', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...'],
  Z: ['#######', '#######', '.....##', '....##.', '...##..', '..##...', '..##...', '.##....', '##.....', '##.....', '#######', '#######'],
};

/**
 * Translucent flexible electrophoretic E-Ink film ribbon (16x156 square microcapsule matrix) adhered to the outer shell.
 * Non-filled cells stay softly translucent so the labyrinth architecture ghosts through the film,
 * while active cells pull crisp square matte-charcoal E-Ink pigment to the surface:
 *   LEVEL N -> [TITLE] [日本語] -> TAP TO START -> clears smoothly to blank translucent film!
 */
export function createLedFilmDisplay(): LedFilmRig {
  const W = 768;
  const H = 128;
  const COLS = 156;
  const ROWS = 16;

  // Active 16x156 exact-square electrophoretic E-Ink pixel matrix inside the 768x128 flexible PET film
  const gridLeft = 72;
  const gridRight = 696;
  const gridTop = 32;
  const gridBottom = 96;
  const pitchX = (gridRight - gridLeft) / (COLS - 1);
  const pitchY = (gridBottom - gridTop) / (ROWS - 1);

  // Strict square pixel cells (no rounded corners)
  const cellW = Math.min(pitchX, pitchY) - 0.72;
  const cellH = cellW;
  const halfCellW = cellW * 0.5;
  const halfCellH = cellH * 0.5;

  // Deterministic per-cell threshold [0..1] & paper micro-grain for tactile electrophoretic dissolve
  const pixelThresh = new Float32Array(COLS * ROWS);
  const pixelJitter = new Float32Array(COLS * ROWS);
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      let h = (col * 374761393 + row * 668265263 + 1313) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      pixelThresh[col * ROWS + row] = ((h ^ (h >>> 16)) >>> 0) / 4294967295;
      pixelJitter[col * ROWS + row] = (((h >>> 8) & 0xff) / 255 - 0.5) * 14;
    }
  }

  // 1. Pre-render static flexible PET laminating film + translucent unfilled E-Ink cell matrix + EPD driver IC
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = W;
  baseCanvas.height = H;
  const bCtx = baseCanvas.getContext('2d')!;

  const padX = 9;
  const padY = 9;
  // Crisp square architectural die-cut PET film (no rounded corners)
  const filmGrad = bCtx.createLinearGradient(0, padY, 0, H - padY);
  filmGrad.addColorStop(0, 'rgba(226, 222, 214, 0.48)');
  filmGrad.addColorStop(0.16, 'rgba(234, 230, 223, 0.28)');
  filmGrad.addColorStop(0.84, 'rgba(232, 228, 221, 0.26)');
  filmGrad.addColorStop(1, 'rgba(220, 215, 206, 0.46)');
  bCtx.fillStyle = filmGrad;
  bCtx.fillRect(padX, padY, W - padX * 2, H - padY * 2);

  bCtx.strokeStyle = 'rgba(116, 111, 102, 0.42)';
  bCtx.lineWidth = 1.2;
  bCtx.strokeRect(padX, padY, W - padX * 2, H - padY * 2);

  bCtx.strokeStyle = 'rgba(255, 255, 255, 0.58)';
  bCtx.lineWidth = 0.85;
  bCtx.strokeRect(padX + 1.5, padY + 1.5, W - (padX + 1.5) * 2, H - (padY + 1.5) * 2);

  // Semi-transparent milky e-paper substrate window (lets maze show softly through non-filled pixels!)
  bCtx.fillStyle = 'rgba(238, 235, 228, 0.30)';
  bCtx.fillRect(gridLeft - 6, gridTop - 6, gridRight - gridLeft + 12, gridBottom - gridTop + 12);
  bCtx.strokeStyle = 'rgba(122, 116, 106, 0.26)';
  bCtx.lineWidth = 0.8;
  bCtx.strokeRect(gridLeft - 6, gridTop - 6, gridRight - gridLeft + 12, gridBottom - gridTop + 12);

  // Top & bottom conductive silver-copper electrode bus rails
  const drawBusRail = (y: number, thickness: number, alpha: number) => {
    bCtx.strokeStyle = `rgba(148, 128, 96, ${alpha})`;
    bCtx.lineWidth = thickness;
    bCtx.beginPath();
    bCtx.moveTo(48, y);
    bCtx.lineTo(W - 48, y);
    bCtx.stroke();
  };
  drawBusRail(17, 1.5, 0.46);
  drawBusRail(20.5, 0.75, 0.28);
  drawBusRail(H - 17, 1.5, 0.46);
  drawBusRail(H - 20.5, 0.75, 0.28);

  // Left end: matte-charcoal E-Ink EPD flex-driver IC + metallic gull-wing leads (sharp square package)
  const icX = 26;
  const icY = 32;
  const icW = 21;
  const icH = 64;
  bCtx.strokeStyle = 'rgba(144, 124, 92, 0.52)';
  bCtx.lineWidth = 0.8;
  for (let i = 0; i < 8; i++) {
    const pinY = icY + 6 + (i / 7) * (icH - 12);
    const rowY = gridTop + (i / 7) * (gridBottom - gridTop);
    bCtx.beginPath();
    bCtx.moveTo(icX + icW, pinY);
    bCtx.lineTo(icX + icW + 7, pinY);
    bCtx.lineTo(66, rowY);
    bCtx.stroke();
    bCtx.fillStyle = 'rgba(182, 184, 188, 0.90)';
    bCtx.fillRect(icX + icW, pinY - 1.1, 4, 2.2);
    bCtx.fillRect(icX - 3, pinY - 1.1, 3, 2.2);
  }
  bCtx.fillStyle = 'rgba(30, 30, 32, 0.92)';
  bCtx.fillRect(icX, icY, icW, icH);
  bCtx.strokeStyle = 'rgba(98, 98, 102, 0.55)';
  bCtx.lineWidth = 0.8;
  bCtx.strokeRect(icX, icY, icW, icH);
  bCtx.fillStyle = 'rgba(216, 212, 204, 0.72)';
  bCtx.fillRect(icX + 4, icY + 4.5, 3, 3);

  // Right end: 4 gold-plated square flex connector pads (V+, DA, CK, GD)
  const padColX = W - 43;
  const padLabels = ['V+', 'DA', 'CK', 'GD'];
  bCtx.font = '600 6.5px "IBM Plex Mono", ui-monospace, monospace';
  bCtx.textBaseline = 'middle';
  bCtx.textAlign = 'right';
  for (let i = 0; i < 4; i++) {
    const py = 38 + i * 17.5;
    bCtx.fillStyle = 'rgba(198, 162, 94, 0.82)';
    bCtx.fillRect(padColX, py - 4, 14, 8);
    bCtx.strokeStyle = 'rgba(128, 98, 50, 0.65)';
    bCtx.lineWidth = 0.75;
    bCtx.strokeRect(padColX, py - 4, 14, 8);
    bCtx.strokeStyle = 'rgba(146, 126, 94, 0.46)';
    bCtx.beginPath();
    bCtx.moveTo(padColX, py);
    bCtx.lineTo(gridRight + 6, py);
    bCtx.stroke();
    bCtx.fillStyle = 'rgba(46, 42, 36, 0.72)';
    bCtx.fillText(padLabels[i], padColX - 3, py);
  }

  // Technical micro-silkscreen along top & bottom margins
  bCtx.font = '600 6.8px "IBM Plex Mono", ui-monospace, monospace';
  bCtx.fillStyle = 'rgba(38, 35, 30, 0.62)';
  bCtx.textAlign = 'left';
  bCtx.textBaseline = 'middle';
  bCtx.fillText('EPD-13 // TRANSLUCENT E-INK FILM', 72, 13.5);
  bCtx.textAlign = 'right';
  bCtx.fillText('16×156 ELECTROPHORETIC · STHLM', 696, H - 13.5);

  // Subtle translucent square microcapsule grid across the active E-Ink window
  bCtx.fillStyle = 'rgba(244, 241, 234, 0.17)';
  for (let row = 0; row < ROWS; row++) {
    const y = gridTop + row * pitchY - halfCellH;
    for (let col = 0; col < COLS; col++) {
      const x = gridLeft + col * pitchX - halfCellW;
      bCtx.fillRect(x, y, cellW, cellH);
    }
  }
  bCtx.strokeStyle = 'rgba(122, 116, 106, 0.10)';
  bCtx.lineWidth = 0.45;
  for (let row = 0; row <= ROWS; row++) {
    const y = gridTop - pitchY * 0.5 + row * pitchY;
    bCtx.beginPath();
    bCtx.moveTo(gridLeft - pitchX * 0.5, y);
    bCtx.lineTo(gridRight + pitchX * 0.5, y);
    bCtx.stroke();
  }
  for (let col = 0; col <= COLS; col += 2) {
    const x = gridLeft - pitchX * 0.5 + col * pitchX;
    bCtx.beginPath();
    bCtx.moveTo(x, gridTop - pitchY * 0.5);
    bCtx.lineTo(x, gridBottom + pitchY * 0.5);
    bCtx.stroke();
  }

  // 2. Roughness map: matte paper-like finish over the active E-Ink window, satin PET around margins
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 128;
  roughCanvas.height = 32;
  const rCtx = roughCanvas.getContext('2d')!;
  rCtx.fillStyle = '#5c5c5c';
  rCtx.fillRect(0, 0, 128, 32);
  rCtx.fillStyle = '#c4c4c4';
  rCtx.fillRect(11, 7, 106, 18);
  rCtx.fillStyle = '#9a9a9a';
  rCtx.fillRect(4, 8, 4, 16);

  // 3. Live diffuse canvas (generateMipmaps=false eliminates GPU stalls for locked 60 FPS!)
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = W;
  mapCanvas.height = H;
  const mCtx = mapCanvas.getContext('2d')!;

  const map = new THREE.CanvasTexture(mapCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.generateMipmaps = false;
  map.minFilter = THREE.LinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.anisotropy = 1;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);

  // Offscreen 16px pixel-grid rasterizer specifically for DotGothic16 Japanese Kanji (true 16x16 square pixel font!)
  const jaCanvas = document.createElement('canvas');
  jaCanvas.width = 80;
  jaCanvas.height = ROWS;
  const jaCtx = jaCanvas.getContext('2d', { willReadFrequently: true })!;

  const buildLatinCols = (text: string): number[] => {
    const upper = text.toUpperCase();
    const cols: number[] = [];
    for (let i = 0; i < upper.length; i++) {
      const glyph = SQUARE_FONT_12[upper[i]] ?? SQUARE_FONT_12[' '];
      const gw = glyph[0].length;
      for (let cx = 0; cx < gw; cx++) {
        let bits = 0;
        for (let ry = 0; ry < 12; ry++) {
          if (glyph[ry][cx] === '#') bits |= 1 << (ry + 2); // Centered cleanly inside 16 rows (rows 2..13)
        }
        cols.push(bits);
      }
      if (i < upper.length - 1) cols.push(0, 0); // Crisp 2-pixel square kerning gap
    }
    return cols;
  };

  const buildJapaneseCols = (ja: string): number[] => {
    if (!ja) return [];
    jaCtx.clearRect(0, 0, jaCanvas.width, ROWS);
    jaCtx.imageSmoothingEnabled = false;
    jaCtx.fillStyle = '#000000';
    jaCtx.textBaseline = 'middle';
    jaCtx.textAlign = 'left';
    // DotGothic16 is a genuine 16x16 square-dot Japanese pixel font!
    jaCtx.font = '400 15px "DotGothic16", "Hiragino Sans", "Noto Sans JP", monospace';
    const w = Math.min(jaCanvas.width - 2, Math.ceil(jaCtx.measureText(ja).width) + 2);
    jaCtx.fillText(ja, 1, ROWS * 0.5 + 0.5);

    const data = jaCtx.getImageData(0, 0, w, ROWS).data;
    const raw: number[] = [];
    for (let col = 0; col < w; col++) {
      let bits = 0;
      for (let row = 0; row < ROWS; row++) {
        const a = data[(row * w + col) * 4 + 3];
        if (a >= 104) bits |= 1 << row;
      }
      raw.push(bits);
    }
    // Trim leading/trailing empty columns for exact centering
    let first = 0;
    while (first < raw.length && raw[first] === 0) first++;
    let last = raw.length - 1;
    while (last >= first && raw[last] === 0) last--;
    return first <= last ? raw.slice(first, last + 1) : [];
  };

  const composeCentered = (latin: string, ja = ''): Uint16Array => {
    const lCols = buildLatinCols(latin);
    const jCols = buildJapaneseCols(ja);
    const gap = lCols.length > 0 && jCols.length > 0 ? 7 : 0;
    const total = lCols.length + gap + jCols.length;
    const out = new Uint16Array(COLS);
    const start = Math.max(0, Math.floor((COLS - total) * 0.5));
    let cursor = start;
    for (let i = 0; i < lCols.length && cursor < COLS; i++, cursor++) out[cursor] = lCols[i];
    cursor += gap;
    for (let i = 0; i < jCols.length && cursor < COLS; i++, cursor++) out[cursor] = jCols[i];
    return out;
  };

  const emptyCols = new Uint16Array(COLS);
  const frameCols = new Uint16Array(COLS);
  const clearSourceCols = new Uint16Array(COLS);

  let curLevelNum = 1;
  let curTitle = 'FIRST ROLL';
  let curTitleJa = '初転';
  let isClearedColor = false;

  let levelCols: Uint16Array = new Uint16Array(COLS);
  let titleCols: Uint16Array = new Uint16Array(COLS);
  let tapCols: Uint16Array = new Uint16Array(COLS);
  let clearCols: Uint16Array = new Uint16Array(COLS);

  const rebuildBitmaps = () => {
    levelCols = composeCentered(`LEVEL ${curLevelNum}`);
    titleCols = composeCentered(curTitle, curTitleJa);
    tapCols = composeCentered('TAP TO START', '開始');
    clearCols = composeCentered(`LEVEL ${curLevelNum} CLEAR`, '完了');
    lastRenderKey = '';
  };

  type TapeMode = 'intro' | 'clearing' | 'blank' | 'cleared';
  let mode: TapeMode = 'intro';
  let modeStartTime = -1;
  let lastRenderKey = '';
  let currentKey = '';

  const drawDisplay = (
    cols: Uint16Array,
    ghostCols: Uint16Array | null,
    ghostAlpha: number,
    flashMode: 'none' | 'dark' | 'light',
    scanCol: number,
    busyPip: boolean,
  ) => {
    mCtx.clearRect(0, 0, W, H);
    mCtx.drawImage(baseCanvas, 0, 0);

    // Tiny square passive e-ink refresh status pip below the EPD controller IC
    const px = 34;
    const py = 105;
    mCtx.fillStyle = busyPip
      ? isClearedColor
        ? 'rgba(18, 128, 82, 0.92)'
        : 'rgba(28, 28, 30, 0.86)'
      : 'rgba(140, 134, 124, 0.24)';
    mCtx.fillRect(px, py, 4.2, 4.2);

    // Classic E-Ink full-panel polarity clear flash
    if (flashMode === 'dark') {
      mCtx.fillStyle = 'rgba(34, 34, 36, 0.68)';
      mCtx.fillRect(
        gridLeft - halfCellW,
        gridTop - halfCellH,
        gridRight - gridLeft + cellW,
        gridBottom - gridTop + cellH,
      );
      map.needsUpdate = true;
      return;
    }

    if (flashMode === 'light') {
      mCtx.fillStyle = 'rgba(248, 246, 240, 0.56)';
      mCtx.fillRect(
        gridLeft - halfCellW,
        gridTop - halfCellH,
        gridRight - gridLeft + cellW,
        gridBottom - gridTop + cellH,
      );
      map.needsUpdate = true;
      return;
    }

    // Subtle real E-Ink micro-ghosting right after a partial refresh
    if (ghostCols && ghostAlpha > 0.005) {
      mCtx.fillStyle = `rgba(34, 34, 36, ${ghostAlpha.toFixed(3)})`;
      for (let col = 0; col < COLS; col++) {
        const gBits = ghostCols[col];
        if (gBits === 0) continue;
        const cx = gridLeft + col * pitchX - halfCellW;
        for (let row = 0; row < ROWS; row++) {
          if ((gBits & (1 << row)) === 0) continue;
          const cy = gridTop + row * pitchY - halfCellH;
          mCtx.fillRect(cx, cy, cellW, cellH);
        }
      }
    }

    // Active crisp square matte electrophoretic E-Ink pigment pixels
    for (let col = 0; col < COLS; col++) {
      const bits = cols[col];
      const isScanDark = scanCol >= 0 && (col === scanCol || col === scanCol + 1);
      const isScanClear = scanCol >= 0 && (col === scanCol - 1 || col === scanCol - 2);
      if (bits === 0 && !isScanDark && !isScanClear) continue;

      const cx = gridLeft + col * pitchX - halfCellW;
      for (let row = 0; row < ROWS; row++) {
        const cy = gridTop + row * pitchY - halfCellH;
        const bitOn = (bits & (1 << row)) !== 0;

        if (isScanDark) {
          mCtx.fillStyle = bitOn ? 'rgba(244, 241, 234, 0.64)' : 'rgba(42, 42, 44, 0.48)';
          mCtx.fillRect(cx, cy, cellW, cellH);
        } else if (isScanClear && !bitOn) {
          mCtx.fillStyle = 'rgba(248, 246, 240, 0.42)';
          mCtx.fillRect(cx, cy, cellW, cellH);
        } else if (bitOn) {
          const j = pixelJitter[col * ROWS + row];
          if (isClearedColor) {
            const rC = Math.round(14 + j * 0.25);
            const gC = Math.round(112 + j * 0.45);
            const bC = Math.round(72 + j * 0.35);
            mCtx.fillStyle = `rgba(${rC}, ${gC}, ${bC}, 0.94)`;
          } else {
            const v = Math.round(22 + j * 0.32);
            mCtx.fillStyle = `rgba(${v}, ${v + 1}, ${v + 2}, 0.95)`;
          }
          mCtx.fillRect(cx, cy, cellW, cellH);
        }
      }
    }

    map.needsUpdate = true;
  };

  function setLevel(levelNum: number, title: string, titleJa: string, cleared = false) {
    const key = `${levelNum}|${title}|${titleJa}|${cleared ? 1 : 0}`;
    if (key === currentKey) return;
    currentKey = key;
    curLevelNum = levelNum;
    curTitle = title;
    curTitleJa = titleJa;
    isClearedColor = cleared;
    rebuildBitmaps();
    if (cleared) {
      mode = 'cleared';
      modeStartTime = -1;
    }
    lastRenderKey = '';
  }

  function restartIntro() {
    isClearedColor = false;
    mode = 'intro';
    modeStartTime = -1;
    lastRenderKey = '';
  }

  function clearToBlank() {
    if (mode === 'blank' || mode === 'clearing') return;
    clearSourceCols.set(frameCols);
    mode = 'clearing';
    modeStartTime = -1;
    lastRenderKey = '';
  }

  const blendScan = (from: Uint16Array, to: Uint16Array, u: number): number => {
    const scanPos = u * (COLS + 12) - 6;
    const scanCol = Math.round(scanPos);
    for (let col = 0; col < COLS; col++) {
      const dist = scanPos - col;
      if (dist >= 6) {
        frameCols[col] = to[col];
      } else if (dist <= -6) {
        frameCols[col] = from[col];
      } else {
        const blend = (dist + 6) / 12;
        let bits = 0;
        const a = from[col];
        const b = to[col];
        for (let row = 0; row < ROWS; row++) {
          const bit = 1 << row;
          const takeB = pixelThresh[col * ROWS + row] <= blend;
          if (takeB ? (b & bit) !== 0 : (a & bit) !== 0) bits |= bit;
        }
        frameCols[col] = bits;
      }
    }
    return scanCol;
  };

  function update(time: number) {
    if (modeStartTime < 0) modeStartTime = time;
    const elapsed = Math.max(0, time - modeStartTime);

    // 1. Clean blank translucent E-Ink film during gameplay (zero text clutter!)
    if (mode === 'blank') {
      if (lastRenderKey === 'blank') return;
      lastRenderKey = 'blank';
      frameCols.fill(0);
      drawDisplay(emptyCols, null, 0, 'none', -1, false);
      return;
    }

    // 2. Crisp E-Ink dissolve-to-blank wipe once tapped / transitioning to North Pole ("then disappear")
    if (mode === 'clearing') {
      if (elapsed < 0.06) {
        if (lastRenderKey === 'clr:light') return;
        lastRenderKey = 'clr:light';
        drawDisplay(frameCols, null, 0, 'light', -1, true);
        return;
      }
      const prog = Math.min(1, (elapsed - 0.06) / 0.34);
      if (prog >= 1) {
        mode = 'blank';
        lastRenderKey = '';
        frameCols.fill(0);
        drawDisplay(emptyCols, null, 0, 'none', -1, false);
        return;
      }
      const q = Math.floor(prog * 14);
      const key = `clearing:${q}`;
      if (key === lastRenderKey) return;
      lastRenderKey = key;

      for (let col = 0; col < COLS; col++) {
        let bits = 0;
        const src = clearSourceCols[col];
        if (src !== 0) {
          for (let row = 0; row < ROWS; row++) {
            const bit = 1 << row;
            if ((src & bit) !== 0 && pixelThresh[col * ROWS + row] > prog) bits |= bit;
          }
        }
        frameCols[col] = bits;
      }
      drawDisplay(frameCols, null, 0, 'none', -1, true);
      return;
    }

    // 3. Level cleared flash -> emerald "LEVEL N CLEAR 完了"
    if (mode === 'cleared') {
      if (elapsed < 0.08) {
        if (lastRenderKey === 'done:dark') return;
        lastRenderKey = 'done:dark';
        drawDisplay(frameCols, null, 0, 'dark', -1, true);
        return;
      }
      if (elapsed < 0.15) {
        if (lastRenderKey === 'done:light') return;
        lastRenderKey = 'done:light';
        drawDisplay(frameCols, null, 0, 'light', -1, true);
        return;
      }
      const prog = Math.min(1, (elapsed - 0.15) / 0.34);
      const q = Math.min(16, Math.floor(prog * 16));
      const key = `done:${q}`;
      if (key === lastRenderKey) return;
      lastRenderKey = key;

      for (let col = 0; col < COLS; col++) {
        let bits = 0;
        const src = clearCols[col];
        if (src !== 0) {
          for (let row = 0; row < ROWS; row++) {
            const bit = 1 << row;
            if ((src & bit) !== 0 && pixelThresh[col * ROWS + row] <= prog) bits |= bit;
          }
        }
        frameCols[col] = bits;
      }
      drawDisplay(frameCols, null, 0, 'none', -1, prog < 1);
      return;
    }

    // 4. Intro sequence on the translucent E-Ink tape:
    //    0.00 - 0.08s : Dark full-panel polarity clear flash
    //    0.08 - 0.15s : Milky translucent clear pulse
    //    0.15 - 0.48s : Electrophoretic dissolve into "LEVEL N"
    //    0.48 - 1.45s : Crisp daylight hold "LEVEL N"
    //    1.45 - 2.02s : Left-to-right E-Ink polarity scan into "[TITLE]  [日本語]"
    //    2.02 - 3.65s : Crisp daylight hold "[TITLE]  [日本語]" (with faint fading ghosting!)
    //    3.65 - 4.20s : Left-to-right E-Ink polarity scan into "TAP TO START"
    //    4.20s+       : Crisp daylight hold "TAP TO START" until user taps or auto-starts -> clears!
    if (elapsed < 0.08) {
      if (lastRenderKey === 'in:dark') return;
      lastRenderKey = 'in:dark';
      drawDisplay(frameCols, null, 0, 'dark', -1, true);
      return;
    }
    if (elapsed < 0.15) {
      if (lastRenderKey === 'in:light') return;
      lastRenderKey = 'in:light';
      drawDisplay(frameCols, null, 0, 'light', -1, true);
      return;
    }
    if (elapsed < 0.48) {
      const prog = Math.min(1, (elapsed - 0.15) / 0.33);
      const q = Math.floor(prog * 14);
      const key = `in:lvl:${q}`;
      if (key === lastRenderKey) return;
      lastRenderKey = key;

      for (let col = 0; col < COLS; col++) {
        let bits = 0;
        const src = levelCols[col];
        if (src !== 0) {
          for (let row = 0; row < ROWS; row++) {
            const bit = 1 << row;
            if ((src & bit) !== 0 && pixelThresh[col * ROWS + row] <= prog) bits |= bit;
          }
        }
        frameCols[col] = bits;
      }
      drawDisplay(frameCols, null, 0, 'none', -1, true);
      return;
    }
    if (elapsed < 1.45) {
      if (lastRenderKey === 'hold:lvl') return;
      lastRenderKey = 'hold:lvl';
      frameCols.set(levelCols);
      drawDisplay(frameCols, null, 0, 'none', -1, false);
      return;
    }
    if (elapsed < 2.02) {
      const u = (elapsed - 1.45) / 0.57;
      const scanCol = blendScan(levelCols, titleCols, u);
      const key = `scan:ttl:${scanCol}`;
      if (key === lastRenderKey) return;
      lastRenderKey = key;
      drawDisplay(frameCols, null, 0, 'none', scanCol >= 0 && scanCol < COLS ? scanCol : -1, true);
      return;
    }
    if (elapsed < 3.65) {
      const since = elapsed - 2.02;
      const gStep = since < 0.4 ? Math.floor(since * 12) : 99;
      const key = `hold:ttl:${gStep}`;
      if (key === lastRenderKey) return;
      lastRenderKey = key;
      frameCols.set(titleCols);
      const gAlpha = since < 0.4 ? 0.08 * (1 - since / 0.4) : 0;
      drawDisplay(frameCols, gAlpha > 0 ? levelCols : null, gAlpha, 'none', -1, false);
      return;
    }
    if (elapsed < 4.2) {
      const u = (elapsed - 3.65) / 0.55;
      const scanCol = blendScan(titleCols, tapCols, u);
      const key = `scan:tap:${scanCol}`;
      if (key === lastRenderKey) return;
      lastRenderKey = key;
      drawDisplay(frameCols, null, 0, 'none', scanCol >= 0 && scanCol < COLS ? scanCol : -1, true);
      return;
    }

    const sinceTap = elapsed - 4.2;
    const gStep = sinceTap < 0.4 ? Math.floor(sinceTap * 12) : 99;
    const waitPip = Math.floor(time * 1.6) % 2 === 0;
    const key = `hold:tap:${gStep}:${waitPip ? 1 : 0}`;
    if (key === lastRenderKey) return;
    lastRenderKey = key;
    frameCols.set(tapCols);
    const gAlpha = sinceTap < 0.4 ? 0.08 * (1 - sinceTap / 0.4) : 0;
    drawDisplay(frameCols, gAlpha > 0 ? titleCols : null, gAlpha, 'none', -1, waitPip);
  }

  rebuildBitmaps();
  drawDisplay(levelCols, null, 0, 'none', -1, false);

  if (typeof document !== 'undefined' && 'fonts' in document) {
    document.fonts.ready.then(() => {
      rebuildBitmaps();
    });
  }

  return {
    map,
    roughnessMap,
    isCleared: () => isClearedColor,
    setLevel,
    restartIntro,
    clearToBlank,
    update,
    dispose: () => {
      map.dispose();
      roughnessMap.dispose();
    },
  };
}
