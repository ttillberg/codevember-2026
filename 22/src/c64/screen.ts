import {
  CHAR_ROM,
  C64_PALETTE_RGB,
  PETSCII_COLOR_CODES,
  petsciiToScreenCode,
  screenCodeToAscii,
} from './charset';

export const COLS = 40;
export const ROWS = 25;
export const BORDER_X = 32;
export const BORDER_Y = 36;
export const SCREEN_W = COLS * 8 + BORDER_X * 2; // 384
export const SCREEN_H = ROWS * 8 + BORDER_Y * 2; // 272

// PAL VIC-II scanline mapping:
// Active 200 display rows sit at raster lines 50..249.
// Top border (36px) maps to raster lines 14..49; bottom border (36px) to 250..285.
export const RASTER_ACTIVE_TOP = 50;
export const RASTER_VISIBLE_TOP = RASTER_ACTIVE_TOP - BORDER_Y; // 14
export const RASTER_LINES_TOTAL = 312;

const PACKED_PALETTE = new Uint32Array(
  C64_PALETTE_RGB.map(([r, g, b]) => 0xff000000 | (b << 16) | (g << 8) | r),
);

export class C64Screen {
  readonly screenRam = new Uint8Array(COLS * ROWS);
  readonly colorRam = new Uint8Array(COLS * ROWS);
  // True if row `r` continues logically from row `r - 1` (80-char logical lines)
  readonly continued = new Uint8Array(ROWS);

  // Optional 64KB RAM attached by the 6510 CPU / C64Basic machine for bitmap/sprite modes
  private ram: Uint8Array | null = null;

  // VIC-II state
  borderColor = 14; // Light blue ($D020 / 53280)
  bgColor = 6;      // Dark blue  ($D021 / 53281)
  bgColor1 = 0;     // Multicolor / ECM bg 1 ($D022)
  bgColor2 = 0;     // Multicolor / ECM bg 2 ($D023)
  bgColor3 = 0;     // ECM bg 3 ($D024)
  textColor = 14;   // Light blue ($0286 / 646)

  vicD011 = 0x1b;   // Bit 6 = ECM, Bit 5 = Bitmap, Bit 4 = DEN, Bit 3 = 25/24 rows, Bits 2-0 = Y scroll
  vicD016 = 0x08;   // Bit 4 = Multicolor Mode
  vicD018 = 0x14;   // Bits 7-4 = screen matrix offset, Bits 3-1 = charset/bitmap base
  vicBank = 0x0000; // CIA2 $DD00 bits 0-1 inverted -> 16KB VIC-II bank
  /** Ultimax cartridge mode: VIC-II $3000-$3FFF mirrors ROM $F000-$FFFF (e.g. Jupiter Lander). */
  ultimaxMirror = false;

  // Hardware sprites ($D000-$D01F, $D025-$D02E)
  readonly spriteX = new Uint16Array(8);
  readonly spriteY = new Uint8Array(8);
  readonly spriteColor = new Uint8Array(8);
  spriteEnable = 0;     // $D015
  spriteExpandX = 0;    // $D01D
  spriteExpandY = 0;    // $D017
  spritePriority = 0;   // $D01B (bit=1 -> sprite behind foreground background pixels)
  spriteMulticolor = 0; // $D01C
  spriteMcColor0 = 0;   // $D025
  spriteMcColor1 = 0;   // $D026
  spriteSpriteCollision = 0; // $D01E (cleared on read)
  spriteBgCollision = 0;     // $D01F (cleared on read)

  // Foreground pixel mask for hardware sprite-to-background collision detection ($D01F)
  private readonly fgMask = new Uint8Array(COLS * 8 * ROWS * 8);
  private readonly spriteOccMask = new Uint8Array(COLS * 8 * ROWS * 8);

  // Per-scanline latched VIC-II state for authentic C64 raster bars, split-screen, and fine X-scroll
  private readonly rasterBorder = new Uint8Array(SCREEN_H);
  private readonly rasterBg = new Uint8Array(SCREEN_H);
  private readonly rasterD011 = new Uint8Array(SCREEN_H);
  private readonly rasterD016 = new Uint8Array(SCREEN_H);
  private readonly rasterD018 = new Uint8Array(SCREEN_H);
  private readonly rasterBank = new Uint16Array(SCREEN_H);
  private hasRasterSplits = false;
  private hasModeSplits = false;

  cursorX = 0;
  cursorY = 0;
  cursorEnabled = true;
  cursorBlinkOn = true;
  reverseMode = false;

  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly imgData: ImageData;
  private readonly pixels: Uint32Array;

  private blinkAccum = 0;
  scrollCount = 0;
  dirty = true;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SCREEN_W;
    this.canvas.height = SCREEN_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
    this.imgData = ctx.createImageData(SCREEN_W, SCREEN_H);
    this.pixels = new Uint32Array(this.imgData.data.buffer);
    this.clear();
  }

  /** Attach the machine's flat 64KB RAM so VIC-II bitmap & sprite modes read directly from it. */
  attachRam(ram: Uint8Array) {
    this.ram = ram;
  }

  reset() {
    this.borderColor = 14;
    this.bgColor = 6;
    this.textColor = 14;
    this.resetVic();
    this.reverseMode = false;
    this.cursorEnabled = true;
    this.resetBlink();
    this.clear();
  }

  /** Restore default VIC-II text mode & clear raster splits/sprites (e.g. on RUN/STOP). */
  resetVic() {
    this.vicD011 = 0x1b;
    this.vicD016 = 0x08;
    this.vicD018 = 0x14;
    this.vicBank = 0x0000;
    this.bgColor1 = 0;
    this.bgColor2 = 0;
    this.bgColor3 = 0;
    this.ultimaxMirror = false;
    this.spriteEnable = 0;
    this.spriteExpandX = 0;
    this.spriteExpandY = 0;
    this.spritePriority = 0;
    this.spriteMulticolor = 0;
    this.spriteMcColor0 = 0;
    this.spriteMcColor1 = 0;
    this.spriteSpriteCollision = 0;
    this.spriteBgCollision = 0;
    this.spriteX.fill(0);
    this.spriteY.fill(0);
    this.spriteColor.fill(1);
    this.hasRasterSplits = false;
    this.hasModeSplits = false;
    this.dirty = true;
  }

  isBitmapMode(): boolean {
    return (this.vicD011 & 0x20) !== 0;
  }

  /** Reset per-frame raster split tracking before stepping a 6502 frame. */
  beginRasterFrame() {
    if (this.hasRasterSplits || this.hasModeSplits) {
      this.dirty = true;
    }
    this.hasRasterSplits = false;
    this.hasModeSplits = false;
  }

  /** Latch current VIC-II registers for a PAL raster line during 6502 execution. */
  latchRasterLine(rasterLine: number) {
    const sy = rasterLine - RASTER_VISIBLE_TOP;
    if (sy < 0 || sy >= SCREEN_H) return;
    const b = this.borderColor;
    const g = this.bgColor;
    const d11 = this.vicD011;
    const d16 = this.vicD016;
    const d18 = this.vicD018;
    const bank = this.vicBank;
    if (
      this.rasterBorder[sy] !== b ||
      this.rasterBg[sy] !== g ||
      this.rasterD011[sy] !== d11 ||
      this.rasterD016[sy] !== d16 ||
      this.rasterD018[sy] !== d18 ||
      this.rasterBank[sy] !== bank
    ) {
      this.dirty = true;
    }
    this.rasterBorder[sy] = b;
    this.rasterBg[sy] = g;
    this.rasterD011[sy] = d11;
    this.rasterD016[sy] = d16;
    this.rasterD018[sy] = d18;
    this.rasterBank[sy] = bank;
    if (sy > 0) {
      if (b !== this.rasterBorder[0] || g !== this.rasterBg[0]) {
        this.hasRasterSplits = true;
      }
      if (
        d11 !== this.rasterD011[0] ||
        d16 !== this.rasterD016[0] ||
        d18 !== this.rasterD018[0] ||
        bank !== this.rasterBank[0] ||
        (d16 & 0x0f) !== 0x08
      ) {
        this.hasModeSplits = true;
      }
    }
  }

  markDirty() {
    this.dirty = true;
  }

  clear() {
    this.screenRam.fill(0x20); // space
    this.colorRam.fill(this.textColor);
    this.continued.fill(0);
    this.cursorX = 0;
    this.cursorY = 0;
    this.dirty = true;
  }

  home() {
    this.cursorX = 0;
    this.cursorY = 0;
    this.reverseMode = false;
    this.resetBlink();
    this.dirty = true;
  }

  resetBlink() {
    this.blinkAccum = 0;
    if (!this.cursorBlinkOn) {
      this.cursorBlinkOn = true;
      this.dirty = true;
    }
  }

  tick(dt: number) {
    if (!this.cursorEnabled || this.isBitmapMode()) return;
    this.blinkAccum += dt;
    // Real C64 blinks roughly every 20 jiffies (~0.33s–0.5s)
    if (this.blinkAccum >= 0.42) {
      this.blinkAccum %= 0.42;
      this.cursorBlinkOn = !this.cursorBlinkOn;
      this.dirty = true;
    }
  }

  setBorder(color: number) {
    const c = color & 0x0f;
    if (c !== this.borderColor) {
      this.borderColor = c;
      this.dirty = true;
    }
  }

  setBg(color: number) {
    const c = color & 0x0f;
    if (c !== this.bgColor) {
      this.bgColor = c;
      this.dirty = true;
    }
  }

  setTextColor(color: number) {
    this.textColor = color & 0x0f;
  }

  pokeScreen(offset: number, val: number) {
    if (offset >= 0 && offset < COLS * ROWS) {
      this.screenRam[offset] = val & 0xff;
      this.dirty = true;
    }
  }

  pokeColor(offset: number, val: number) {
    if (offset >= 0 && offset < COLS * ROWS) {
      this.colorRam[offset] = val & 0x0f;
      this.dirty = true;
    }
  }

  scrollUp() {
    this.screenRam.copyWithin(0, COLS);
    this.colorRam.copyWithin(0, COLS);
    this.continued.copyWithin(0, 1);
    const last = (ROWS - 1) * COLS;
    this.screenRam.fill(0x20, last);
    this.colorRam.fill(this.textColor, last);
    this.continued[ROWS - 1] = 0;
    this.scrollCount++;
    this.dirty = true;
  }

  newLine() {
    this.reverseMode = false;
    this.cursorX = 0;
    if (this.cursorY < ROWS - 1) {
      this.cursorY++;
    } else {
      this.scrollUp();
    }
    this.dirty = true;
  }

  /** Put a raw printable PETSCII code at the cursor and advance. */
  printCode(code: number, allowWrapFlag = false) {
    const c = code & 0xff;

    // Color control codes
    const color = PETSCII_COLOR_CODES[c];
    if (color !== undefined) {
      this.textColor = color;
      return;
    }

    switch (c) {
      case 13:
      case 10:
        this.newLine();
        return;
      case 147: // CLR/HOME
        this.clear();
        return;
      case 19: // HOME
        this.home();
        return;
      case 18: // RVS ON
        this.reverseMode = true;
        return;
      case 146: // RVS OFF
        this.reverseMode = false;
        return;
      case 17: // Cursor down
        this.moveCursor(0, 1);
        return;
      case 145: // Cursor up
        this.moveCursor(0, -1);
        return;
      case 29: // Cursor right
        this.moveCursor(1, 0);
        return;
      case 157: // Cursor left
        this.moveCursor(-1, 0);
        return;
      case 20: // DEL
        this.backspace();
        return;
    }

    const sc = petsciiToScreenCode(c);
    if (sc < 0) return;

    const idx = this.cursorY * COLS + this.cursorX;
    this.screenRam[idx] = this.reverseMode ? (sc | 0x80) : sc;
    this.colorRam[idx] = this.textColor;

    this.cursorX++;
    if (this.cursorX >= COLS) {
      this.cursorX = 0;
      if (this.cursorY < ROWS - 1) {
        this.cursorY++;
      } else {
        this.scrollUp();
      }
      if (allowWrapFlag) {
        this.continued[this.cursorY] = 1;
      }
    }
    this.dirty = true;
  }

  print(text: string) {
    for (let i = 0; i < text.length; i++) {
      this.printCode(text.charCodeAt(i), false);
    }
  }

  printLine(text = '') {
    this.print(text);
    this.newLine();
  }

  /** User typed a printable character in editor / input mode. */
  typeChar(ch: string) {
    if (!ch) return;
    const code = ch.charCodeAt(0);
    this.printCode(code, true);
    this.resetBlink();
  }

  /** Authentic C64 INST/DEL (backspace) within the current logical line. */
  backspace(minCol = 0, lockRow = -1) {
    if (lockRow >= 0 && (this.cursorY < lockRow || (this.cursorY === lockRow && this.cursorX <= minCol))) {
      return;
    }

    if (this.cursorX > 0) {
      this.cursorX--;
    } else if (this.cursorY > 0 && this.continued[this.cursorY]) {
      this.cursorY--;
      this.cursorX = COLS - 1;
    } else if (this.cursorY > 0 && lockRow < 0) {
      this.cursorY--;
      this.cursorX = COLS - 1;
      this.resetBlink();
      this.dirty = true;
      return;
    } else {
      return;
    }

    // Shift characters left through the end of the logical line
    const endRow = this.getLogicalLineEnd(this.cursorY);
    const startIdx = this.cursorY * COLS + this.cursorX;
    const endIdx = endRow * COLS + (COLS - 1);
    for (let i = startIdx; i < endIdx; i++) {
      this.screenRam[i] = this.screenRam[i + 1];
      this.colorRam[i] = this.colorRam[i + 1];
    }
    this.screenRam[endIdx] = 0x20;
    this.colorRam[endIdx] = this.textColor;
    this.resetBlink();
    this.dirty = true;
  }

  moveCursor(dx: number, dy: number) {
    let x = this.cursorX + dx;
    let y = this.cursorY + dy;
    if (x < 0) {
      if (y > 0) {
        y--;
        x = COLS - 1;
      } else {
        x = 0;
      }
    } else if (x >= COLS) {
      if (y < ROWS - 1) {
        y++;
        x = 0;
      } else {
        x = COLS - 1;
      }
    }
    y = Math.max(0, Math.min(ROWS - 1, y));
    this.cursorX = x;
    this.cursorY = y;
    this.resetBlink();
    this.dirty = true;
  }

  getLogicalLineStart(row: number): number {
    let r = row;
    while (r > 0 && this.continued[r]) r--;
    return r;
  }

  getLogicalLineEnd(row: number): number {
    let r = row;
    while (r < ROWS - 1 && this.continued[r + 1]) r++;
    return r;
  }

  /**
   * Read the logical line containing `row` as ASCII text (trimmed on the right).
   * Also advances cursor to the line after the logical line.
   */
  commitLogicalLine(startCol = 0, anchorRow = -1): string {
    const startRow = anchorRow >= 0 ? anchorRow : this.getLogicalLineStart(this.cursorY);
    const endRow = Math.max(this.cursorY, this.getLogicalLineEnd(startRow));

    let out = '';
    for (let r = startRow; r <= endRow; r++) {
      const c0 = r === startRow ? startCol : 0;
      for (let c = c0; c < COLS; c++) {
        out += screenCodeToAscii(this.screenRam[r * COLS + c]);
      }
    }

    // Move cursor below the submitted logical line
    this.cursorY = endRow;
    this.newLine();
    return out.replace(/\s+$/, '');
  }

  private readVicByte(addr: number): number {
    const a = addr & 0xffff;
    if (a >= 0x0400 && a < 0x0400 + COLS * ROWS) {
      return this.screenRam[a - 0x0400];
    }
    if (this.ultimaxMirror && a >= 0x3000 && a < 0x4000) {
      return this.ram ? this.ram[a | 0xc000] : 0;
    }
    return this.ram ? this.ram[a] : 0;
  }

  /** Fetch 1 byte of character glyph data from either built-in CHAR_ROM or custom RAM/Ultimax charset ($D018). */
  private readCharByte(charBase: number, code: number, gy: number): number {
    // Standard C64 VIC Bank 0 Character ROM windows ($1000-$1FFF)
    if (!this.ram || charBase === 0x1000 || charBase === 0x1800) {
      return CHAR_ROM[(code & 0x7f) * 8 + gy];
    }
    // Custom RAM charset or Ultimax ROM charset (full 256 glyphs, 8 bytes each!)
    return this.readVicByte((charBase + (code & 0xff) * 8 + gy) & 0xffff);
  }

  private readonly glowCache: [number, number, number] = [0, 0, 0];

  /** Compute a live RGB tint (0..1) representing the monitor's current emitted color for ambient lighting. */
  getScreenGlowColor(): [number, number, number] {
    if (this.isBitmapMode()) {
      // In hi-res demo mode, emit a cool cyan/border blend so the room reacts nicely
      const [br, bg, bb] = C64_PALETTE_RGB[this.borderColor];
      this.glowCache[0] = (br * 0.4 + 45) / 255;
      this.glowCache[1] = (bg * 0.4 + 130) / 255;
      this.glowCache[2] = (bb * 0.4 + 165) / 255;
      return this.glowCache;
    }
    const [br, bg, bb] = C64_PALETTE_RGB[this.borderColor];
    const [gr, gg, gb] = C64_PALETTE_RGB[this.bgColor];
    const [tr, tg, tb] = C64_PALETTE_RGB[this.textColor];
    // Blend background (55%), border (30%), text highlights (15%)
    this.glowCache[0] = (gr * 0.55 + br * 0.30 + tr * 0.15) / 255;
    this.glowCache[1] = (gg * 0.55 + bg * 0.30 + tg * 0.15) / 255;
    this.glowCache[2] = (gb * 0.55 + bb * 0.30 + tb * 0.15) / 255;
    return this.glowCache;
  }

  /** Render VIC-II display (Text / Hi-Res Bitmap / Multicolor Bitmap + Raster Bars + Sprites). */
  render(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;

    const pixels = this.pixels;

    // 1. Fill border (per-scanline when raster splits are active, otherwise fast flat fill)
    if (this.hasRasterSplits) {
      for (let sy = 0; sy < SCREEN_H; sy++) {
        const bPx = PACKED_PALETTE[this.rasterBorder[sy] & 0x0f];
        const rowOff = sy * SCREEN_W;
        pixels.fill(bPx, rowOff, rowOff + SCREEN_W);
      }
    } else {
      pixels.fill(PACKED_PALETTE[this.borderColor & 0x0f]);
    }

    const displayEnabled = (this.vicD011 & 0x10) !== 0;
    const screenBase = (this.vicBank + ((this.vicD018 >> 4) & 0x0f) * 0x0400) & 0xffff;

    const needsScanlinePath =
      this.hasModeSplits ||
      (this.vicD011 & 0x40) !== 0 ||
      (this.vicD011 & 0x0f) !== 0x0b ||
      (this.vicD016 & 0x0f) !== 0x08;

    if (needsScanlinePath && this.ram) {
      this.renderScanlineSplit(this.hasModeSplits);
      if (this.spriteEnable !== 0) {
        this.renderSprites(screenBase);
      }
    } else if (displayEnabled) {
      if (this.isBitmapMode() && this.ram) {
        const bitmapBase = (this.vicBank + ((this.vicD018 & 0x08) ? 0x2000 : 0x0000)) & 0xffff;
        const multicolor = (this.vicD016 & 0x10) !== 0;
        this.renderBitmap(screenBase, bitmapBase, multicolor);
      } else {
        this.renderText(screenBase);
      }

      if (this.spriteEnable !== 0 && this.ram) {
        this.renderSprites(screenBase);
      }
    }

    this.ctx.putImageData(this.imgData, 0, 0);
    return true;
  }

  /** Scanline-accurate renderer for VIC-II splits, ECM, fine X/Y-scroll, and 24-row / 38-col borders! */
  private renderScanlineSplit(useLatched: boolean) {
    const pixels = this.pixels;
    const ram = this.ram!;
    const useSplits = this.hasRasterSplits;
    const flatBgPx = PACKED_PALETTE[this.bgColor & 0x0f];
    const flatBorderPx = PACKED_PALETTE[this.borderColor & 0x0f];
    const bg1Px = PACKED_PALETTE[this.bgColor1 & 0x0f];
    const bg2Px = PACKED_PALETTE[this.bgColor2 & 0x0f];
    const bg3Px = PACKED_PALETTE[this.bgColor3 & 0x0f];
    const trackFg = this.spriteEnable !== 0;
    const fgMask = this.fgMask;
    if (trackFg) fgMask.fill(0);

    for (let py = 0; py < ROWS * 8; py++) {
      const sy = BORDER_Y + py;
      const d11 = useLatched ? this.rasterD011[sy] : this.vicD011;
      if ((d11 & 0x10) === 0) continue; // Display blanked on this line

      const borderPx = useSplits ? PACKED_PALETTE[this.rasterBorder[sy] & 0x0f] : flatBorderPx;
      // Authentic VIC-II 24-row vertical border clip ($D011 bit 3 = 0 masks top 4px & bottom 4px)
      if ((d11 & 0x08) === 0 && (py < 4 || py >= 196)) continue;

      const d16 = useLatched ? this.rasterD016[sy] : this.vicD016;
      const d18 = useLatched ? this.rasterD018[sy] : this.vicD018;
      const bank = useLatched ? this.rasterBank[sy] : this.vicBank;
      const screenBase = (bank + ((d18 >> 4) & 0x0f) * 0x0400) & 0xffff;

      // Authentic VIC-II fine Y-scroll ($D011 bits 0-2, default 3 -> 0px shift)
      const yShift = (d11 & 0x07) - 3;
      const srcPy = py - yShift;
      const bgPx = useSplits ? PACKED_PALETTE[this.rasterBg[sy] & 0x0f] : flatBgPx;
      const lineBase = sy * SCREEN_W + BORDER_X;
      if (srcPy < 0 || srcPy >= ROWS * 8) {
        pixels.fill(bgPx, lineBase, lineBase + 320);
        continue;
      }

      const row = srcPy >> 3;
      const gy = srcPy & 7;
      const scrollX = d16 & 0x07;
      const narrow38 = (d16 & 0x08) === 0;
      const fgRow = py * 320;

      if ((d11 & 0x20) !== 0) {
        // Hi-Res Bitmap scanline
        const bitmapBase = (bank + ((d18 & 0x08) ? 0x2000 : 0x0000)) & 0xffff;
        for (let col = 0; col < COLS; col++) {
          const cell = row * COLS + col;
          const colByte = this.readVicByte(screenBase + cell);
          const fgPx = PACKED_PALETTE[(colByte >> 4) & 0x0f];
          const cellBgPx = PACKED_PALETTE[colByte & 0x0f];
          const bits = ram[(bitmapBase + cell * 8 + gy) & 0xffff];
          const pxOff = lineBase + col * 8;
          if (bits === 0) {
            pixels.fill(cellBgPx, pxOff, pxOff + 8);
          } else {
            for (let gx = 0; gx < 8; gx++) {
              const lit = (bits & (0x80 >> gx)) !== 0;
              pixels[pxOff + gx] = lit ? fgPx : cellBgPx;
              if (trackFg && lit) fgMask[fgRow + col * 8 + gx] = 1;
            }
          }
        }
      } else {
        // Text scanline with custom RAM/Ultimax charset ($D018), ECM ($D011 bit 6), multicolor text & fine X-scroll!
        pixels.fill(bgPx, lineBase, lineBase + 320);
        const defaultScreen = screenBase === 0x0400;
        const charBase = (bank + (d18 & 0x0e) * 0x0400) & 0xffff;
        const useRom = charBase === 0x1000 || charBase === 0x1800;
        const ecm = (d11 & 0x40) !== 0;
        const multicolor = !ecm && (d16 & 0x10) !== 0;

        for (let col = 0; col < COLS; col++) {
          const idx = row * COLS + col;
          const rawCode = defaultScreen ? this.screenRam[idx] : this.readVicByte(screenBase + idx);
          const colVal = this.colorRam[idx] & 0x0f;
          const isMcCell = multicolor && (colVal & 0x08) !== 0;
          const charCode = ecm ? (rawCode & 0x3f) : rawCode;
          const cellBgPx = ecm
            ? (rawCode >> 6) === 0 ? bgPx : (rawCode >> 6) === 1 ? bg1Px : (rawCode >> 6) === 2 ? bg2Px : bg3Px
            : bgPx;
          const reversed = useRom && !ecm && (rawCode & 0x80) !== 0;
          const bits = useRom
            ? CHAR_ROM[(charCode & 0x7f) * 8 + gy]
            : this.readCharByte(charBase, charCode, gy);
          const fgPx = PACKED_PALETTE[isMcCell ? (colVal & 0x07) : colVal];
          const destX0 = col * 8 + scrollX;

          if (isMcCell) {
            for (let pair = 0; pair < 4; pair++) {
              const code2 = (bits >> (6 - pair * 2)) & 0x03;
              const px = code2 === 0 ? cellBgPx : code2 === 1 ? bg1Px : code2 === 2 ? bg2Px : fgPx;
              const dx = destX0 + pair * 2;
              if (dx < 320) {
                pixels[lineBase + dx] = px;
                if (trackFg && code2 >= 2) fgMask[fgRow + dx] = 1;
              }
              if (dx + 1 < 320) {
                pixels[lineBase + dx + 1] = px;
                if (trackFg && code2 >= 2) fgMask[fgRow + dx + 1] = 1;
              }
            }
          } else {
            for (let gx = 0; gx < 8; gx++) {
              const dx = destX0 + gx;
              if (dx >= 320) break;
              const lit = ((bits & (0x80 >> gx)) !== 0) !== reversed;
              pixels[lineBase + dx] = lit ? fgPx : cellBgPx;
              if (trackFg && lit) fgMask[fgRow + dx] = 1;
            }
          }
        }
        if (narrow38) {
          pixels.fill(borderPx, lineBase, lineBase + 7);
          pixels.fill(borderPx, lineBase + 311, lineBase + 320);
        }
      }
    }
  }

  private renderText(screenBase: number) {
    const pixels = this.pixels;
    const flatBgPx = PACKED_PALETTE[this.bgColor & 0x0f];
    const bg1Px = PACKED_PALETTE[this.bgColor1 & 0x0f];
    const bg2Px = PACKED_PALETTE[this.bgColor2 & 0x0f];
    const useSplits = this.hasRasterSplits;
    const defaultScreen = screenBase === 0x0400;
    const charOffset = (this.vicD018 & 0x0e) * 0x0400;
    const charBase = (this.vicBank + charOffset) & 0xffff;
    const useRom = !this.ram || charBase === 0x1000 || charBase === 0x1800;
    const multicolor = (this.vicD016 & 0x10) !== 0;
    const trackFg = this.spriteEnable !== 0;
    const fgMask = this.fgMask;
    if (trackFg) fgMask.fill(0);

    for (let row = 0; row < ROWS; row++) {
      const pyBase = BORDER_Y + row * 8;
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;
        const rawCode = defaultScreen ? this.screenRam[idx] : this.readVicByte(screenBase + idx);
        const isCursor =
          useRom &&
          defaultScreen &&
          this.cursorEnabled &&
          this.cursorBlinkOn &&
          row === this.cursorY &&
          col === this.cursorX;

        const colVal = this.colorRam[idx] & 0x0f;
        const isMcCell = multicolor && (colVal & 0x08) !== 0;
        const reversed = useRom && (Boolean(rawCode & 0x80) !== isCursor);
        const fgPx = isCursor
          ? PACKED_PALETTE[this.textColor & 0x0f]
          : PACKED_PALETTE[isMcCell ? (colVal & 0x07) : colVal];

        const pxBase = BORDER_X + col * 8;
        for (let gy = 0; gy < 8; gy++) {
          const sy = pyBase + gy;
          const bgPx = useSplits ? PACKED_PALETTE[this.rasterBg[sy] & 0x0f] : flatBgPx;
          const bits = useRom
            ? CHAR_ROM[(rawCode & 0x7f) * 8 + gy]
            : this.readCharByte(charBase, rawCode, gy);
          const rowOffset = sy * SCREEN_W + pxBase;
          const fgRow = (row * 8 + gy) * 320 + col * 8;

          if (isMcCell) {
            for (let pair = 0; pair < 4; pair++) {
              const code2 = (bits >> (6 - pair * 2)) & 0x03;
              const px = code2 === 0 ? bgPx : code2 === 1 ? bg1Px : code2 === 2 ? bg2Px : fgPx;
              const dx = pair * 2;
              pixels[rowOffset + dx] = px;
              pixels[rowOffset + dx + 1] = px;
              if (trackFg && code2 >= 2) {
                fgMask[fgRow + dx] = 1;
                fgMask[fgRow + dx + 1] = 1;
              }
            }
          } else {
            for (let gx = 0; gx < 8; gx++) {
              const on = Boolean(bits & (0x80 >> gx));
              const lit = on !== reversed;
              pixels[rowOffset + gx] = lit ? fgPx : bgPx;
              if (trackFg && lit) fgMask[fgRow + gx] = 1;
            }
          }
        }
      }
    }
  }

  private renderBitmap(screenBase: number, bitmapBase: number, multicolor: boolean) {
    const pixels = this.pixels;
    const ram = this.ram!;
    const useSplits = this.hasRasterSplits;
    const flatBgPx = PACKED_PALETTE[this.bgColor & 0x0f];

    if (!multicolor) {
      // Standard 320x200 Hi-Res Bitmap mode
      for (let row = 0; row < ROWS; row++) {
        const pyBase = BORDER_Y + row * 8;
        for (let col = 0; col < COLS; col++) {
          const cell = row * COLS + col;
          const colByte = this.readVicByte(screenBase + cell);
          const fgPx = PACKED_PALETTE[(colByte >> 4) & 0x0f];
          const bgPx = PACKED_PALETTE[colByte & 0x0f];
          const bmCell = (bitmapBase + cell * 8) & 0xffff;
          const pxBase = BORDER_X + col * 8;

          for (let gy = 0; gy < 8; gy++) {
            const bits = ram[(bmCell + gy) & 0xffff];
            const rowOffset = (pyBase + gy) * SCREEN_W + pxBase;
            if (bits === 0) {
              pixels[rowOffset] = bgPx;
              pixels[rowOffset + 1] = bgPx;
              pixels[rowOffset + 2] = bgPx;
              pixels[rowOffset + 3] = bgPx;
              pixels[rowOffset + 4] = bgPx;
              pixels[rowOffset + 5] = bgPx;
              pixels[rowOffset + 6] = bgPx;
              pixels[rowOffset + 7] = bgPx;
            } else {
              pixels[rowOffset] = (bits & 0x80) ? fgPx : bgPx;
              pixels[rowOffset + 1] = (bits & 0x40) ? fgPx : bgPx;
              pixels[rowOffset + 2] = (bits & 0x20) ? fgPx : bgPx;
              pixels[rowOffset + 3] = (bits & 0x10) ? fgPx : bgPx;
              pixels[rowOffset + 4] = (bits & 0x08) ? fgPx : bgPx;
              pixels[rowOffset + 5] = (bits & 0x04) ? fgPx : bgPx;
              pixels[rowOffset + 6] = (bits & 0x02) ? fgPx : bgPx;
              pixels[rowOffset + 7] = (bits & 0x01) ? fgPx : bgPx;
            }
          }
        }
      }
    } else {
      // 160x200 Multicolor Bitmap mode (2 bits per double-wide pixel)
      for (let row = 0; row < ROWS; row++) {
        const pyBase = BORDER_Y + row * 8;
        for (let col = 0; col < COLS; col++) {
          const cell = row * COLS + col;
          const colByte = this.readVicByte(screenBase + cell);
          const c1 = PACKED_PALETTE[(colByte >> 4) & 0x0f];
          const c2 = PACKED_PALETTE[colByte & 0x0f];
          const c3 = PACKED_PALETTE[this.colorRam[cell] & 0x0f];
          const bmCell = (bitmapBase + cell * 8) & 0xffff;
          const pxBase = BORDER_X + col * 8;

          for (let gy = 0; gy < 8; gy++) {
            const sy = pyBase + gy;
            const c0 = useSplits ? PACKED_PALETTE[this.rasterBg[sy] & 0x0f] : flatBgPx;
            const bits = ram[(bmCell + gy) & 0xffff];
            const rowOffset = sy * SCREEN_W + pxBase;
            for (let pair = 0; pair < 4; pair++) {
              const code = (bits >> (6 - pair * 2)) & 0x03;
              const px = code === 0 ? c0 : code === 1 ? c1 : code === 2 ? c2 : c3;
              pixels[rowOffset + pair * 2] = px;
              pixels[rowOffset + pair * 2 + 1] = px;
            }
          }
        }
      }
    }
  }

  private renderSprites(screenBase: number) {
    const pixels = this.pixels;
    const fgMask = this.fgMask;
    const occ = this.spriteOccMask;
    occ.fill(0);

    const mc0Px = PACKED_PALETTE[this.spriteMcColor0 & 0x0f];
    const mc1Px = PACKED_PALETTE[this.spriteMcColor1 & 0x0f];

    // Sprite 0 has highest priority, so draw 7 down to 0
    for (let s = 7; s >= 0; s--) {
      const bit = 1 << s;
      if ((this.spriteEnable & bit) === 0) continue;

      const ptr = this.readVicByte(screenBase + 0x03f8 + s);
      const dataBase = (this.vicBank + ptr * 64) & 0xffff;
      const sx0 = this.spriteX[s] - 24;
      const sy0 = this.spriteY[s] - 50;
      const expX = (this.spriteExpandX & bit) !== 0 ? 2 : 1;
      const expY = (this.spriteExpandY & bit) !== 0 ? 2 : 1;
      const isMc = (this.spriteMulticolor & bit) !== 0;
      const behindBg = (this.spritePriority & bit) !== 0;
      const colPx = PACKED_PALETTE[this.spriteColor[s] & 0x0f];

      for (let row = 0; row < 21; row++) {
        const b0 = this.readVicByte(dataBase + row * 3);
        const b1 = this.readVicByte(dataBase + row * 3 + 1);
        const b2 = this.readVicByte(dataBase + row * 3 + 2);
        const bits = (b0 << 16) | (b1 << 8) | b2;
        if (bits === 0) continue;

        for (let dy = 0; dy < expY; dy++) {
          const ay = sy0 + row * expY + dy;
          if (ay < 0 || ay >= ROWS * 8) continue;
          const rowOff = (ay + BORDER_Y) * SCREEN_W + BORDER_X;
          const maskRow = ay * 320;

          if (isMc) {
            for (let pair = 0; pair < 12; pair++) {
              const code = (bits >>> (22 - pair * 2)) & 0x03;
              if (code === 0) continue;
              const px = code === 1 ? mc0Px : code === 2 ? colPx : mc1Px;
              const span = expX * 2;
              for (let dx = 0; dx < span; dx++) {
                const ax = sx0 + pair * span + dx;
                if (ax < 0 || ax >= 320) continue;
                const mi = maskRow + ax;
                const hitBg = fgMask[mi] !== 0;
                if (hitBg) this.spriteBgCollision |= bit;
                if (occ[mi]) this.spriteSpriteCollision |= occ[mi] | bit;
                occ[mi] |= bit;
                if (!behindBg || !hitBg) pixels[rowOff + ax] = px;
              }
            }
          } else {
            for (let col = 0; col < 24; col++) {
              if ((bits & (0x800000 >>> col)) === 0) continue;
              for (let dx = 0; dx < expX; dx++) {
                const ax = sx0 + col * expX + dx;
                if (ax < 0 || ax >= 320) continue;
                const mi = maskRow + ax;
                const hitBg = fgMask[mi] !== 0;
                if (hitBg) this.spriteBgCollision |= bit;
                if (occ[mi]) this.spriteSpriteCollision |= occ[mi] | bit;
                occ[mi] |= bit;
                if (!behindBg || !hitBg) pixels[rowOff + ax] = colPx;
              }
            }
          }
        }
      }
    }
  }
}
