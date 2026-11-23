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

const PACKED_PALETTE = new Uint32Array(
  C64_PALETTE_RGB.map(([r, g, b]) => 0xff000000 | (b << 16) | (g << 8) | r),
);

export class C64Screen {
  readonly screenRam = new Uint8Array(COLS * ROWS);
  readonly colorRam = new Uint8Array(COLS * ROWS);
  // True if row `r` continues logically from row `r - 1` (80-char logical lines)
  readonly continued = new Uint8Array(ROWS);

  borderColor = 14; // Light blue ($D020 / 53280)
  bgColor = 6;      // Dark blue  ($D021 / 53281)
  textColor = 14;   // Light blue ($0286 / 646)

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

  reset() {
    this.borderColor = 14;
    this.bgColor = 6;
    this.textColor = 14;
    this.reverseMode = false;
    this.cursorEnabled = true;
    this.resetBlink();
    this.clear();
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
    if (!this.cursorEnabled) return;
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
    // Only allow up to 2-row logical lines (80 chars), authentic C64 behavior
    if (this.cursorX === COLS - 1) {
      const startRow = this.getLogicalLineStart(this.cursorY);
      if (this.cursorY - startRow >= 1) {
        // Still allow last char on 2nd row, then wrap cleanly
      }
    }
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

  private readonly glowCache: [number, number, number] = [0, 0, 0];

  /** Compute a live RGB tint (0..1) representing the monitor's current emitted color for ambient lighting. */
  getScreenGlowColor(): [number, number, number] {
    const [br, bg, bb] = C64_PALETTE_RGB[this.borderColor];
    const [gr, gg, gb] = C64_PALETTE_RGB[this.bgColor];
    const [tr, tg, tb] = C64_PALETTE_RGB[this.textColor];
    // Blend background (55%), border (30%), text highlights (15%)
    this.glowCache[0] = (gr * 0.55 + br * 0.30 + tr * 0.15) / 255;
    this.glowCache[1] = (gg * 0.55 + bg * 0.30 + tg * 0.15) / 255;
    this.glowCache[2] = (gb * 0.55 + bb * 0.30 + tb * 0.15) / 255;
    return this.glowCache;
  }

  /** Render screen RAM + border + cursor into the offscreen canvas. Returns true if redrawn. */
  render(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;

    const borderPx = PACKED_PALETTE[this.borderColor];
    const bgPx = PACKED_PALETTE[this.bgColor];

    // Fill entire frame with border color
    this.pixels.fill(borderPx);

    // Draw 40x25 character cells
    for (let row = 0; row < ROWS; row++) {
      const pyBase = BORDER_Y + row * 8;
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;
        const rawCode = this.screenRam[idx];
        const isCursor =
          this.cursorEnabled &&
          this.cursorBlinkOn &&
          row === this.cursorY &&
          col === this.cursorX;

        const reversed = Boolean(rawCode & 0x80) !== isCursor;
        const glyphBase = (rawCode & 0x7f) * 8;
        const fgPx = isCursor
          ? PACKED_PALETTE[this.textColor]
          : PACKED_PALETTE[this.colorRam[idx] & 0x0f];

        const pxBase = BORDER_X + col * 8;
        for (let gy = 0; gy < 8; gy++) {
          const bits = CHAR_ROM[glyphBase + gy];
          const rowOffset = (pyBase + gy) * SCREEN_W + pxBase;
          for (let gx = 0; gx < 8; gx++) {
            const on = Boolean(bits & (0x80 >> gx));
            this.pixels[rowOffset + gx] = on !== reversed ? fgPx : bgPx;
          }
        }
      }
    }

    this.ctx.putImageData(this.imgData, 0, 0);
    return true;
  }
}
