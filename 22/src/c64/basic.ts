import { C64Screen, COLS, ROWS } from './screen';
import { C64FloppyDisk } from './disk';

type BasicValue = number | string;

interface ForFrame {
  varName: string;
  endVal: number;
  stepVal: number;
  lineIndex: number;
  stmtOffset: number;
}

interface GosubFrame {
  lineIndex: number;
  stmtOffset: number;
}

interface InputTarget {
  name: string;
  isString: boolean;
  indices?: number[];
}

interface InputState {
  targets: InputTarget[];
  collected: string[];
  promptRow: number;
  promptCol: number;
  scrollSnapshot: number;
  resumeLineIndex: number;
  resumeStmtOffset: number;
  fromDirect: boolean;
  directLine: string;
}

class BasicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BasicError';
  }
}

interface ArrayEntry {
  dims: number[];
  isString: boolean;
  data: BasicValue[];
}

const KEYWORDS = [
  'PRINT', 'INPUT', 'GOTO', 'GOSUB', 'RETURN', 'IF', 'THEN', 'FOR', 'TO', 'STEP', 'NEXT',
  'LET', 'DIM', 'REM', 'END', 'STOP', 'CONT', 'LIST', 'RUN', 'NEW', 'CLR', 'DATA', 'READ',
  'RESTORE', 'POKE', 'SYS', 'GET', 'ON', 'WAIT', 'LOAD', 'SAVE', 'VERIFY', 'OPEN', 'CLOSE',
  'CMD', 'DEF', 'FN',
] as const;

export type DiskActivityState = 'idle' | 'read' | 'write' | 'error';

export interface C64MachineOptions {
  disk?: C64FloppyDisk;
  onSidPoke?: (reg: number, val: number) => void;
  onSidSilence?: () => void;
  onReset?: () => void;
  onDiskActivity?: (state: DiskActivityState) => void;
  onEchoAchieved?: (echoed: string) => void;
}

export class C64Basic {
  readonly screen: C64Screen;
  readonly disk: C64FloppyDisk;
  private readonly options: C64MachineOptions;

  // Stored BASIC program: lineNumber -> source text (without line number)
  private program = new Map<number, string>();
  private sortedLines: number[] = [];
  // Populated by LOAD "$",8 so LIST prints the authentic 1541 disk directory
  private directoryListing: string[] | null = null;
  // Active async disk operation (SEARCHING / LOADING / SAVING)
  private diskTimer: {
    phase: 'searching' | 'transfer';
    remaining: number;
    mode: 'load' | 'save' | 'verify';
    filename: string;
    finish: () => void;
  } | null = null;

  // Runtime state
  private vars = new Map<string, BasicValue>();
  private arrays = new Map<string, ArrayEntry>();
  private forStack: ForFrame[] = [];
  private gosubStack: GosubFrame[] = [];
  private dataItems: string[] = [];
  private dataPointer = 0;

  // Execution cursor
  running = false;
  private pcLineIndex = 0;
  private pcOffset = 0;
  private currentLineNum: number | null = null;
  private stoppedState: { lineIndex: number; offset: number } | null = null;

  // Waiting for INPUT line
  private inputState: InputState | null = null;

  // Echo celebration detector (tracks recent INPUT -> PRINT echo in user programs or ECHO disk PRG)
  private loadedBuiltinName: string | null = null;
  private pendingEchoInput: { text: string; at: number } | null = null;
  private lastEchoCelebrationAt = -99999;

  // Keyboard buffer for GET
  private keyBuffer: string[] = [];

  // Boot time for TI / TI$
  private bootTime = performance.now();

  // Simple seedable PRNG for RND
  private rngState = 0x12345678;

  // Direct-mode remaining statements after an INPUT (rare, supported cleanly)
  private directRemainder: { text: string; offset: number } | null = null;

  // Scratch RAM for arbitrary PEEK/POKE outside VIC/SID
  private extraRam = new Map<number, number>();

  constructor(screen: C64Screen, options: C64MachineOptions = {}) {
    this.screen = screen;
    this.disk = options.disk ?? new C64FloppyDisk();
    this.options = options;
    this.boot();
  }

  boot() {
    this.program.clear();
    this.sortedLines = [];
    this.directoryListing = null;
    this.diskTimer = null;
    this.options.onDiskActivity?.('idle');
    this.options.onSidSilence?.();
    this.clearRuntime();
    this.bootTime = performance.now();
    this.screen.reset();
    this.screen.printLine('');
    this.screen.printLine('    **** COMMODORE 64 BASIC V2 ****');
    this.screen.printLine('');
    this.screen.printLine(' 64K RAM SYSTEM  38911 BASIC BYTES FREE');
    this.screen.printLine('');
    this.screen.printLine('READY.');
    this.screen.cursorEnabled = true;
    this.screen.resetBlink();
  }

  private clearRuntime() {
    this.vars.clear();
    this.arrays.clear();
    this.forStack = [];
    this.gosubStack = [];
    this.dataItems = [];
    this.dataPointer = 0;
    this.running = false;
    this.inputState = null;
    this.currentLineNum = null;
    this.stoppedState = null;
    this.directRemainder = null;
    this.keyBuffer = [];
  }

  private rebuildLineIndex() {
    this.sortedLines = Array.from(this.program.keys()).sort((a, b) => a - b);
  }

  private bytesFree(): number {
    let used = 0;
    for (const [, src] of this.program) used += src.length + 5;
    for (const [k, v] of this.vars) used += k.length + (typeof v === 'string' ? v.length + 5 : 7);
    return Math.max(0, 38911 - used);
  }

  /** Export the stored BASIC program (same as LIST) for Cmd+C clipboard copy. */
  exportListing(): string {
    if (this.sortedLines.length > 0) {
      return this.sortedLines
        .map((num) => `${num} ${this.program.get(num) ?? ''}`)
        .join('\n');
    }
    if (this.directoryListing) {
      // Strip PETSCII reverse control codes for plain text clipboard
      return this.directoryListing
        .map((l) => l.replace(/[\x12\x92]/g, ''))
        .join('\n');
    }
    return '';
  }

  /**
   * Paste single-line or multi-line BASIC code into the C64 (Cmd+V / Ctrl+V).
   * Single-line text types at the cursor; multi-line programs store every line cleanly.
   */
  pasteText(raw: string): number {
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized) return 0;

    // If inside INPUT or single line without newline, type characters directly at the cursor
    if (this.inputState || !normalized.includes('\n')) {
      const single = normalized.split('\n')[0];
      for (let i = 0; i < single.length; i++) {
        this.screen.typeChar(single[i]);
      }
      return 1;
    }

    // Multi-line paste: stop any running loop first if needed, then feed each line
    if (this.running || this.diskTimer) {
      this.breakProgram();
    }

    const lines = normalized
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let count = 0;
    for (const line of lines) {
      this.screen.printLine(line);
      count++;

      const numMatch = line.match(/^(\d+)\s*(.*)$/);
      if (numMatch) {
        const lineNum = parseInt(numMatch[1], 10);
        const body = numMatch[2].trim();
        if (lineNum <= 63999) {
          if (body.length === 0) this.program.delete(lineNum);
          else this.program.set(lineNum, body);
          this.loadedBuiltinName = null;
          this.directoryListing = null;
          this.rebuildLineIndex();
          this.stoppedState = null;
        }
      } else {
        // Direct command (e.g. NEW or RUN at the end of a pasted listing)
        this.executeDirect(line);
        if (this.running || this.inputState || this.diskTimer) break;
      }
    }

    if (!this.running && !this.inputState && !this.diskTimer) {
      this.screen.cursorEnabled = true;
      this.screen.resetBlink();
    }
    return count;
  }

  /** Handle a browser KeyboardEvent or virtual key. Returns true if consumed. */
  handleKey(key: string, ctrl = false, meta = false): boolean {
    if (meta) return false;

    // RUN/STOP (Escape or Ctrl+C)
    if (key === 'Escape' || (ctrl && (key === 'c' || key === 'C'))) {
      this.breakProgram();
      return true;
    }

    // CLR/HOME (Ctrl+L or Home) — ignored during active INPUT so prompt lock stays intact
    if (key === 'Home' || (ctrl && (key === 'l' || key === 'L'))) {
      if (!this.running && !this.inputState) {
        if (ctrl) this.screen.clear();
        else this.screen.home();
      }
      return true;
    }

    // Ignore typing while 1541 drive is actively loading/saving (except Escape/RUN-STOP)
    if (this.diskTimer) return true;

    // If program is running without INPUT, buffer key for GET
    if (this.running && !this.inputState) {
      if (key.length === 1) {
        if (this.keyBuffer.length < 16) this.keyBuffer.push(key.toUpperCase());
      } else if (key === 'Enter') {
        if (this.keyBuffer.length < 16) this.keyBuffer.push('\r');
      }
      return true;
    }

    // Editor or INPUT mode
    if (key === 'Enter') {
      this.onReturnPressed();
      return true;
    }

    if (key === 'Backspace') {
      if (this.inputState) {
        const scrolled = this.screen.scrollCount - this.inputState.scrollSnapshot;
        const anchorRow = Math.max(0, this.inputState.promptRow - scrolled);
        this.screen.backspace(this.inputState.promptCol, anchorRow);
      } else {
        this.screen.backspace();
      }
      return true;
    }

    if (key === 'ArrowLeft') {
      if (this.inputState) {
        const scrolled = this.screen.scrollCount - this.inputState.scrollSnapshot;
        const anchorRow = Math.max(0, this.inputState.promptRow - scrolled);
        if (this.screen.cursorY > anchorRow || this.screen.cursorX > this.inputState.promptCol) {
          this.screen.moveCursor(-1, 0);
        }
      } else {
        this.screen.moveCursor(-1, 0);
      }
      return true;
    }
    if (key === 'ArrowRight') {
      this.screen.moveCursor(1, 0);
      return true;
    }
    if (key === 'ArrowUp') {
      if (!this.inputState) this.screen.moveCursor(0, -1);
      return true;
    }
    if (key === 'ArrowDown') {
      if (!this.inputState) this.screen.moveCursor(0, 1);
      return true;
    }

    if (key.length === 1 && !ctrl) {
      this.screen.typeChar(key);
      return true;
    }

    return false;
  }

  /** Trigger RUN/STOP just like pressing the C64 RUN/STOP key. */
  breakProgram() {
    if (this.diskTimer) {
      this.diskTimer = null;
      this.options.onDiskActivity?.('idle');
      this.screen.newLine();
      this.screen.printLine('BREAK');
      this.screen.printLine('READY.');
      this.screen.cursorEnabled = true;
      this.screen.resetBlink();
      return;
    }
    if (this.running || this.inputState) {
      const line = this.currentLineNum;
      this.stoppedState = this.running
        ? { lineIndex: this.pcLineIndex, offset: this.pcOffset }
        : null;
      this.running = false;
      this.inputState = null;
      this.directRemainder = null;
      this.options.onSidSilence?.();
      this.screen.newLine();
      if (line !== null) {
        this.screen.printLine(`BREAK IN ${line}`);
      } else {
        this.screen.printLine('BREAK');
      }
      this.screen.printLine('READY.');
      this.screen.cursorEnabled = true;
      this.screen.resetBlink();
    }
  }

  /** Step running program and async 1541 disk transfer non-blockingly each frame. */
  step(maxStatements = 24, dt = 1 / 60) {
    if (this.diskTimer) {
      this.diskTimer.remaining -= dt;
      if (this.diskTimer.remaining <= 0) {
        if (this.diskTimer.phase === 'searching') {
          this.diskTimer.phase = 'transfer';
          this.diskTimer.remaining = 0.58;
          if (this.diskTimer.mode === 'load') {
            this.screen.printLine('LOADING');
          } else if (this.diskTimer.mode === 'verify') {
            this.screen.printLine('VERIFYING');
          }
        } else {
          const finish = this.diskTimer.finish;
          this.diskTimer = null;
          finish();
        }
      }
      return;
    }

    if (!this.running || this.inputState) return;

    let count = 0;
    while (this.running && !this.inputState && count < maxStatements) {
      if (this.pcLineIndex >= this.sortedLines.length) {
        this.finishProgram();
        return;
      }

      const lineNum = this.sortedLines[this.pcLineIndex];
      const src = this.program.get(lineNum) ?? '';
      this.currentLineNum = lineNum;

      try {
        const res = this.executeOneStatement(src, this.pcOffset, false);
        count++;

        if (res.action === 'stop' || res.action === 'end') {
          if (res.action === 'stop') {
            this.stoppedState = { lineIndex: this.pcLineIndex, offset: res.nextOffset };
            this.screen.printLine(`BREAK IN ${lineNum}`);
          }
          this.finishProgram();
          return;
        }
        if (res.action === 'input') {
          return;
        }
        if (res.action === 'jump') {
          this.jumpToLine(res.targetLine);
          continue;
        }
        if (res.action === 'jumpPc') {
          this.pcLineIndex = res.lineIndex;
          this.pcOffset = res.offset;
          continue;
        }
        if (res.action === 'nextLine') {
          this.pcLineIndex++;
          this.pcOffset = 0;
          continue;
        }
        if (res.action === 'continue') {
          this.pcOffset = res.nextOffset;
          if (this.pcOffset >= src.length) {
            this.pcLineIndex++;
            this.pcOffset = 0;
          }
        }
      } catch (err) {
        const msg = err instanceof BasicError ? err.message : 'SYNTAX';
        this.reportError(msg, lineNum);
        return;
      }
    }
  }

  private finishProgram() {
    this.running = false;
    this.currentLineNum = null;
    if (this.screen.cursorX > 0) this.screen.newLine();
    this.screen.printLine('READY.');
    this.screen.cursorEnabled = true;
    this.screen.resetBlink();
  }

  private reportError(code: string, lineNum: number | null) {
    this.running = false;
    this.inputState = null;
    this.directRemainder = null;
    this.currentLineNum = null;
    if (this.screen.cursorX > 0) this.screen.newLine();
    const suffix = lineNum !== null ? ` IN ${lineNum}` : '';
    this.screen.printLine(`?${code}  ERROR${suffix}`);
    this.screen.printLine('READY.');
    this.screen.cursorEnabled = true;
    this.screen.resetBlink();
  }

  private onReturnPressed() {
    if (this.inputState) {
      const state = this.inputState;
      const scrolled = this.screen.scrollCount - state.scrollSnapshot;
      const anchorRow = Math.max(0, state.promptRow - scrolled);
      const raw = this.screen.commitLogicalLine(state.promptCol, anchorRow);
      this.handleInputResponse(state, raw);
      return;
    }

    const line = this.screen.commitLogicalLine();
    const trimmed = line.trim();
    if (!trimmed) return;

    // Check for leading line number (program editing)
    const numMatch = trimmed.match(/^(\d+)\s*(.*)$/);
    if (numMatch) {
      const lineNum = parseInt(numMatch[1], 10);
      const body = numMatch[2].trim();
      if (lineNum > 63999) {
        this.reportError('SYNTAX', null);
        return;
      }
      if (body.length === 0) {
        this.program.delete(lineNum);
      } else {
        this.program.set(lineNum, body);
      }
      this.loadedBuiltinName = null;
      this.directoryListing = null;
      this.rebuildLineIndex();
      this.stoppedState = null;
      return;
    }

    // Direct mode execution
    this.executeDirect(trimmed);
  }

  private handleInputResponse(state: InputState, raw: string) {
    // Split on commas outside quotes (or whole string if single string var!)
    let parts: string[];
    if (state.targets.length === 1 && state.targets[0].isString) {
      // C64 INPUT A$ accepts commas/spaces cleanly unless wrapped in quotes
      const t = raw.trim();
      if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
        parts = [t.slice(1, -1)];
      } else {
        parts = [raw];
      }
    } else {
      parts = splitInputFields(raw);
    }

    const needed = state.targets.length - state.collected.length;
    if (parts.length > needed) {
      this.screen.printLine('?EXTRA IGNORED');
    }

    // Validate & collect
    const tentative = [...state.collected];
    for (let i = 0; i < Math.min(parts.length, needed); i++) {
      const target = state.targets[tentative.length];
      const field = parts[i];
      if (!target.isString) {
        const cleaned = field.trim();
        if (cleaned !== '' && Number.isNaN(Number(cleaned))) {
          this.screen.printLine('?REDO FROM START');
          this.screen.print('? ');
          state.collected = [];
          state.promptRow = this.screen.cursorY;
          state.promptCol = this.screen.cursorX;
          state.scrollSnapshot = this.screen.scrollCount;
          this.screen.cursorEnabled = true;
          this.screen.resetBlink();
          return;
        }
      }
      tentative.push(field);
    }

    state.collected = tentative;
    if (state.collected.length < state.targets.length) {
      // Need more values -> classic C64 double question mark
      this.screen.print('?? ');
      state.promptRow = this.screen.cursorY;
      state.promptCol = this.screen.cursorX;
      state.scrollSnapshot = this.screen.scrollCount;
      this.screen.cursorEnabled = true;
      this.screen.resetBlink();
      return;
    }

    // Assign all targets
    for (let i = 0; i < state.targets.length; i++) {
      const target = state.targets[i];
      const rawVal = state.collected[i];
      const val: BasicValue = target.isString
        ? rawVal
        : (rawVal.trim() === '' ? 0 : Number(rawVal.trim()));
      this.assignTarget(target, val);

      if (!state.fromDirect) {
        const cleaned = rawVal.trim().toUpperCase();
        if (cleaned.length > 0) {
          this.pendingEchoInput = { text: cleaned, at: performance.now() };
        }
      }
    }

    this.inputState = null;

    if (state.fromDirect) {
      this.directRemainder = { text: state.directLine, offset: state.resumeStmtOffset };
      this.resumeDirect();
    } else {
      this.screen.cursorEnabled = false;
      this.pcLineIndex = state.resumeLineIndex;
      this.pcOffset = state.resumeStmtOffset;
      const src = this.program.get(this.sortedLines[this.pcLineIndex]) ?? '';
      if (this.pcOffset >= src.length) {
        this.pcLineIndex++;
        this.pcOffset = 0;
      }
    }
  }

  private executeDirect(line: string) {
    this.directRemainder = { text: line, offset: 0 };
    this.resumeDirect();
  }

  private resumeDirect() {
    let steps = 0;
    const MAX_DIRECT_STEPS = 4000;
    while (this.directRemainder) {
      if (++steps > MAX_DIRECT_STEPS) {
        this.directRemainder = null;
        this.reportError('OUT OF MEMORY', null);
        return;
      }
      const { text, offset } = this.directRemainder;
      if (offset >= text.length) {
        this.directRemainder = null;
        if (!this.running) {
          if (this.screen.cursorX > 0) this.screen.newLine();
          this.screen.printLine('READY.');
          this.screen.cursorEnabled = true;
          this.screen.resetBlink();
        }
        return;
      }
      this.currentLineNum = null;
      try {
        const res = this.executeOneStatement(text, offset, true);
        if (res.action === 'startedRun') {
          this.directRemainder = null;
          return;
        }
        if (res.action === 'input') {
          return;
        }
        if (res.action === 'jumpPc') {
          this.directRemainder = { text, offset: res.offset };
          continue;
        }
        if (res.action === 'jump') {
          this.directRemainder = null;
          this.collectDataStatements();
          this.running = true;
          this.screen.cursorEnabled = false;
          this.jumpToLine(res.targetLine);
          return;
        }
        if (res.action === 'stop' || res.action === 'end' || res.action === 'nextLine') {
          this.directRemainder = null;
          if (!this.running) {
            if (this.screen.cursorX > 0) this.screen.newLine();
            this.screen.printLine('READY.');
            this.screen.cursorEnabled = true;
            this.screen.resetBlink();
          }
          return;
        }
        if (res.action === 'continue') {
          this.directRemainder = { text, offset: res.nextOffset };
        }
      } catch (err) {
        const msg = err instanceof BasicError ? err.message : 'SYNTAX';
        this.reportError(msg, null);
        return;
      }
    }
  }

  private jumpToLine(lineNum: number) {
    const idx = this.sortedLines.indexOf(lineNum);
    if (idx < 0) throw new BasicError("UNDEF'D STATEMENT");
    this.pcLineIndex = idx;
    this.pcOffset = 0;
  }

  private collectDataStatements() {
    this.dataItems = [];
    this.dataPointer = 0;
    for (const lineNum of this.sortedLines) {
      const src = this.program.get(lineNum) ?? '';
      let pos = 0;
      while (pos < src.length) {
        pos = skipSpaces(src, pos);
        if (pos >= src.length) break;
        if (src[pos] === ':') {
          pos++;
          continue;
        }
        if (matchKeywordAt(src, pos, 'REM')) break;
        if (matchKeywordAt(src, pos, 'DATA')) {
          pos += 4;
          const end = findStatementEnd(src, pos);
          const payload = src.slice(pos, end);
          for (const item of splitInputFields(payload)) {
            this.dataItems.push(item);
          }
          pos = end + 1;
        } else {
          pos = findStatementEnd(src, pos) + 1;
        }
      }
    }
  }

  private executeOneStatement(
    src: string,
    startOffset: number,
    isDirect: boolean,
  ):
    | { action: 'continue'; nextOffset: number }
    | { action: 'nextLine' }
    | { action: 'jump'; targetLine: number }
    | { action: 'jumpPc'; lineIndex: number; offset: number }
    | { action: 'end' }
    | { action: 'stop'; nextOffset: number }
    | { action: 'input' }
    | { action: 'startedRun' } {
    let pos = skipSpaces(src, startOffset);
    while (pos < src.length && src[pos] === ':') {
      pos = skipSpaces(src, pos + 1);
    }
    if (pos >= src.length) return { action: 'nextLine' };

    // Shorthand '?' -> PRINT
    if (src[pos] === '?') {
      const end = findStatementEnd(src, pos + 1);
      this.execPrint(src.slice(pos + 1, end));
      return { action: 'continue', nextOffset: end < src.length ? end + 1 : src.length };
    }

    // Match statement keyword
    let kw: string | null = null;
    for (const candidate of KEYWORDS) {
      if (matchKeywordAt(src, pos, candidate)) {
        kw = candidate;
        break;
      }
    }

    if (kw === 'REM' || kw === 'DATA') {
      if (kw === 'REM') return { action: 'nextLine' };
      const end = findStatementEnd(src, pos + kw.length);
      return { action: 'continue', nextOffset: end < src.length ? end + 1 : src.length };
    }

    if (kw === 'PRINT') {
      const end = findStatementEnd(src, pos + 5);
      this.execPrint(src.slice(pos + 5, end));
      return { action: 'continue', nextOffset: end < src.length ? end + 1 : src.length };
    }

    if (kw === 'LIST') {
      const end = findStatementEnd(src, pos + 4);
      this.execList(src.slice(pos + 4, end).trim());
      return { action: 'continue', nextOffset: end < src.length ? end + 1 : src.length };
    }

    if (kw === 'NEW') {
      this.program.clear();
      this.sortedLines = [];
      this.directoryListing = null;
      this.loadedBuiltinName = null;
      this.pendingEchoInput = null;
      this.clearRuntime();
      return { action: 'end' };
    }

    if (kw === 'CLR') {
      this.vars.clear();
      this.arrays.clear();
      this.forStack = [];
      this.gosubStack = [];
      this.dataPointer = 0;
      const end = findStatementEnd(src, pos + 3);
      return { action: 'continue', nextOffset: end < src.length ? end + 1 : src.length };
    }

    if (kw === 'RUN') {
      const end = findStatementEnd(src, pos + 3);
      const arg = src.slice(pos + 3, end).trim();
      this.vars.clear();
      this.arrays.clear();
      this.forStack = [];
      this.gosubStack = [];
      this.stoppedState = null;
      this.pendingEchoInput = null;
      this.keyBuffer = [];
      this.rebuildLineIndex();
      this.collectDataStatements();
      if (this.sortedLines.length === 0) {
        return { action: 'end' };
      }
      if (arg) {
        const lineNum = parseInt(arg, 10);
        if (Number.isNaN(lineNum)) throw new BasicError('SYNTAX');
        this.jumpToLine(lineNum);
      } else {
        this.pcLineIndex = 0;
        this.pcOffset = 0;
      }
      this.running = true;
      this.screen.cursorEnabled = false;
      return { action: 'startedRun' };
    }

    if (kw === 'CONT') {
      if (!this.stoppedState) throw new BasicError("CAN'T CONTINUE");
      this.pcLineIndex = this.stoppedState.lineIndex;
      this.pcOffset = this.stoppedState.offset;
      this.stoppedState = null;
      this.running = true;
      this.screen.cursorEnabled = false;
      return { action: 'startedRun' };
    }

    if (kw === 'END') return { action: 'end' };
    if (kw === 'STOP') {
      const end = findStatementEnd(src, pos + 4);
      return { action: 'stop', nextOffset: end < src.length ? end + 1 : src.length };
    }

    if (kw === 'GOTO') {
      const end = findStatementEnd(src, pos + 4);
      const target = this.parseLineNumber(src.slice(pos + 4, end).trim());
      return { action: 'jump', targetLine: target };
    }

    if (kw === 'GOSUB') {
      const end = findStatementEnd(src, pos + 5);
      const target = this.parseLineNumber(src.slice(pos + 5, end).trim());
      const nextOffset = end < src.length ? end + 1 : src.length;
      this.gosubStack.push({ lineIndex: this.pcLineIndex, stmtOffset: nextOffset });
      if (this.gosubStack.length > 128) throw new BasicError('OUT OF MEMORY');
      return { action: 'jump', targetLine: target };
    }

    if (kw === 'RETURN') {
      const frame = this.gosubStack.pop();
      if (!frame) throw new BasicError('RETURN WITHOUT GOSUB');
      return { action: 'jumpPc', lineIndex: frame.lineIndex, offset: frame.stmtOffset };
    }

    if (kw === 'ON') {
      const end = findStatementEnd(src, pos + 2);
      const body = src.slice(pos + 2, end);
      const m = body.match(/^(.*?)\b(GOTO|GOSUB)\b(.*)$/i);
      if (!m) throw new BasicError('SYNTAX');
      const idx = Math.trunc(this.evalNum(m[1]));
      if (idx < 0 || idx > 255) throw new BasicError('ILLEGAL QUANTITY');
      const targets = m[3].split(',').map((s) => this.parseLineNumber(s.trim()));
      const nextOffset = end < src.length ? end + 1 : src.length;
      if (idx >= 1 && idx <= targets.length) {
        if (m[2].toUpperCase() === 'GOSUB') {
          this.gosubStack.push({ lineIndex: this.pcLineIndex, stmtOffset: nextOffset });
        }
        return { action: 'jump', targetLine: targets[idx - 1] };
      }
      return { action: 'continue', nextOffset };
    }

    if (kw === 'IF') {
      const rest = src.slice(pos + 2);
      const split = findIfThenSplit(rest);
      if (!split) throw new BasicError('SYNTAX');
      const cond = this.evalNum(split.cond);
      if (cond === 0) {
        // False skips the rest of the entire physical line, authentic BASIC V2 behavior!
        return { action: 'nextLine' };
      }
      const after = split.after.trim();
      if (/^\d+$/.test(after)) {
        return { action: 'jump', targetLine: parseInt(after, 10) };
      }
      // Execute the statement(s) after THEN starting at their exact offset in src
      return { action: 'continue', nextOffset: pos + 2 + split.afterIndex };
    }

    if (kw === 'FOR') {
      const end = findStatementEnd(src, pos + 3);
      const body = src.slice(pos + 3, end);
      const nextOffset = end < src.length ? end + 1 : src.length;
      this.execFor(body, nextOffset);
      return { action: 'continue', nextOffset };
    }

    if (kw === 'NEXT') {
      const end = findStatementEnd(src, pos + 4);
      const body = src.slice(pos + 4, end).trim();
      const nextOffset = end < src.length ? end + 1 : src.length;
      const varList = body ? body.split(',').map((s) => normalizeVarName(s.trim())) : [''];
      for (const vName of varList) {
        const jump = this.execNext(vName);
        if (jump) return jump;
      }
      return { action: 'continue', nextOffset };
    }

    if (kw === 'INPUT') {
      const end = findStatementEnd(src, pos + 5);
      const body = src.slice(pos + 5, end).trim();
      const nextOffset = end < src.length ? end + 1 : src.length;
      this.execInput(body, nextOffset, isDirect, src);
      return { action: 'input' };
    }

    if (kw === 'GET') {
      const end = findStatementEnd(src, pos + 3);
      const targetStr = src.slice(pos + 3, end).trim();
      const target = this.parseTarget(targetStr);
      const ch = this.keyBuffer.shift() ?? '';
      if (target.isString) {
        this.assignTarget(target, ch);
      } else {
        const n = ch ? Number(ch) : 0;
        if (Number.isNaN(n)) throw new BasicError('SYNTAX');
        this.assignTarget(target, n);
      }
      return { action: 'continue', nextOffset: end < src.length ? end + 1 : src.length };
    }

    if (kw === 'DIM') {
      const end = findStatementEnd(src, pos + 3);
      this.execDim(src.slice(pos + 3, end));
      return { action: 'continue', nextOffset: end < src.length ? end + 1 : src.length };
    }

    if (kw === 'READ') {
      const end = findStatementEnd(src, pos + 4);
      this.execRead(src.slice(pos + 4, end));
      return { action: 'continue', nextOffset: end < src.length ? end + 1 : src.length };
    }

    if (kw === 'RESTORE') {
      this.dataPointer = 0;
      const end = findStatementEnd(src, pos + 7);
      return { action: 'continue', nextOffset: end < src.length ? end + 1 : src.length };
    }

    if (kw === 'POKE') {
      const end = findStatementEnd(src, pos + 4);
      const args = splitTopLevelCommas(src.slice(pos + 4, end));
      if (args.length !== 2) throw new BasicError('SYNTAX');
      const addr = Math.trunc(this.evalNum(args[0]));
      const val = Math.trunc(this.evalNum(args[1]));
      if (addr < 0 || addr > 65535 || val < 0 || val > 255) {
        throw new BasicError('ILLEGAL QUANTITY');
      }
      this.poke(addr, val);
      return { action: 'continue', nextOffset: end < src.length ? end + 1 : src.length };
    }

    if (kw === 'SYS') {
      const end = findStatementEnd(src, pos + 3);
      const addr = Math.trunc(this.evalNum(src.slice(pos + 3, end)));
      if (addr === 64738) {
        this.boot();
        this.options.onReset?.();
        return { action: 'startedRun' };
      }
      return { action: 'continue', nextOffset: end < src.length ? end + 1 : src.length };
    }

    if (kw === 'WAIT') {
      const end = findStatementEnd(src, pos + 4);
      return { action: 'continue', nextOffset: end < src.length ? end + 1 : src.length };
    }

    if (kw === 'LOAD' || kw === 'SAVE' || kw === 'VERIFY') {
      const end = findStatementEnd(src, pos + kw.length);
      this.execDiskCommand(kw, src.slice(pos + kw.length, end).trim());
      return { action: 'startedRun' };
    }

    // LET or implicit assignment
    const assignStart = kw === 'LET' ? pos + 3 : pos;
    const end = findStatementEnd(src, assignStart);
    this.execAssignment(src.slice(assignStart, end));
    return { action: 'continue', nextOffset: end < src.length ? end + 1 : src.length };
  }

  private execDiskCommand(cmd: 'LOAD' | 'SAVE' | 'VERIFY', rawArgs: string) {
    const parts = rawArgs ? splitTopLevelCommas(rawArgs) : [];
    const filename = parts[0]?.trim() ? this.asStr(this.evalExpr(parts[0].trim())) : '*';
    const device = parts[1]?.trim() ? Math.trunc(this.evalNum(parts[1].trim())) : 8;

    // Only device 8 (the 1541 floppy drive) is connected!
    if (device !== 8) {
      throw new BasicError('DEVICE NOT PRESENT');
    }

    this.running = false;
    this.screen.cursorEnabled = false;

    if (cmd === 'SAVE') {
      if (!filename || filename === '*' || filename === '$') {
        throw new BasicError('SYNTAX');
      }
      if (!this.disk.inserted) {
        this.options.onDiskActivity?.('error');
        this.screen.printLine('?FILE NOT FOUND  ERROR');
        this.screen.printLine('READY.');
        this.screen.cursorEnabled = true;
        this.screen.resetBlink();
        return;
      }
      const upperName = filename.trim().toUpperCase().replace(/^@/, '').replace(/^0:/, '');
      this.screen.printLine(`SAVING ${upperName}`);
      this.options.onDiskActivity?.('write');
      this.diskTimer = {
        phase: 'transfer',
        remaining: 0.72,
        mode: 'save',
        filename: upperName,
        finish: () => {
          const res = this.disk.save(filename, this.program);
          this.options.onDiskActivity?.(res.ok ? 'idle' : 'error');
          if (!res.ok) {
            this.screen.printLine(`?${res.error ?? 'SYNTAX'}  ERROR`);
          }
          this.screen.printLine('READY.');
          this.screen.cursorEnabled = true;
          this.screen.resetBlink();
        },
      };
      return;
    }

    // LOAD or VERIFY
    const cleanName = filename.trim().toUpperCase();
    this.screen.printLine(`SEARCHING FOR ${cleanName || '*'}`);
    this.options.onDiskActivity?.('read');

    if (!this.disk.inserted) {
      this.diskTimer = {
        phase: 'transfer',
        remaining: 0.55,
        mode: cmd === 'LOAD' ? 'load' : 'verify',
        filename: cleanName,
        finish: () => {
          this.options.onDiskActivity?.('error');
          this.screen.printLine('?FILE NOT FOUND  ERROR');
          this.screen.printLine('READY.');
          this.screen.cursorEnabled = true;
          this.screen.resetBlink();
        },
      };
      return;
    }

    if (cleanName === '$' || cleanName === '$0') {
      this.diskTimer = {
        phase: 'searching',
        remaining: 0.35,
        mode: cmd === 'LOAD' ? 'load' : 'verify',
        filename: '$',
        finish: () => {
          if (cmd === 'LOAD') {
            this.program.clear();
            this.sortedLines = [];
            this.directoryListing = this.disk.formatDirectory();
          } else {
            this.screen.printLine('OK');
          }
          this.options.onDiskActivity?.('idle');
          this.screen.printLine('READY.');
          this.screen.cursorEnabled = true;
          this.screen.resetBlink();
        },
      };
      return;
    }

    const found = this.disk.find(cleanName);
    if (!found) {
      this.diskTimer = {
        phase: 'transfer',
        remaining: 0.52,
        mode: cmd === 'LOAD' ? 'load' : 'verify',
        filename: cleanName,
        finish: () => {
          this.options.onDiskActivity?.('error');
          this.screen.printLine('?FILE NOT FOUND  ERROR');
          this.screen.printLine('READY.');
          this.screen.cursorEnabled = true;
          this.screen.resetBlink();
        },
      };
      return;
    }

    this.diskTimer = {
      phase: 'searching',
      remaining: 0.38,
      mode: cmd === 'LOAD' ? 'load' : 'verify',
      filename: found.name,
      finish: () => {
        if (cmd === 'LOAD') {
          this.program.clear();
          this.directoryListing = null;
          this.loadedBuiltinName = found.builtin ? found.name : null;
          this.pendingEchoInput = null;
          for (const [ln, src] of Object.entries(found.lines)) {
            this.program.set(Number(ln), src);
          }
          this.rebuildLineIndex();
          this.clearRuntime();
        } else {
          this.screen.printLine('OK');
        }
        this.options.onDiskActivity?.('idle');
        this.screen.printLine('READY.');
        this.screen.cursorEnabled = true;
        this.screen.resetBlink();
      },
    };
  }

  private execList(arg: string) {
    if (this.directoryListing && !arg) {
      for (const line of this.directoryListing) {
        this.screen.printLine(line);
      }
      return;
    }
    let from = 0;
    let to = 65535;
    if (arg) {
      const dash = arg.indexOf('-');
      if (dash >= 0) {
        const a = arg.slice(0, dash).trim();
        const b = arg.slice(dash + 1).trim();
        if (a) from = parseInt(a, 10);
        if (b) to = parseInt(b, 10);
      } else {
        from = to = parseInt(arg, 10);
      }
      if (Number.isNaN(from) || Number.isNaN(to)) throw new BasicError('SYNTAX');
    }
    for (const num of this.sortedLines) {
      if (num >= from && num <= to) {
        this.screen.printLine(`${num} ${this.program.get(num) ?? ''}`);
      }
    }
  }

  private execPrint(raw: string) {
    let pos = 0;
    let trailingSep = false;
    let printedText = '';

    while (pos < raw.length) {
      pos = skipSpaces(raw, pos);
      if (pos >= raw.length) break;

      const ch = raw[pos];
      if (ch === ';') {
        trailingSep = true;
        pos++;
        continue;
      }
      if (ch === ',') {
        trailingSep = true;
        // Advance to next 10-column tab zone
        const nextTab = (Math.floor(this.screen.cursorX / 10) + 1) * 10;
        if (nextTab >= COLS) {
          this.screen.newLine();
        } else {
          this.screen.print(' '.repeat(nextTab - this.screen.cursorX));
        }
        pos++;
        continue;
      }

      trailingSep = false;

      // TAB(n) and SPC(n)
      if (matchKeywordAt(raw, pos, 'TAB(') || matchKeywordAt(raw, pos, 'SPC(')) {
        const isTab = raw[pos].toUpperCase() === 'T';
        const close = findMatchingParen(raw, pos + 3);
        if (close < 0) throw new BasicError('SYNTAX');
        const n = Math.trunc(this.evalNum(raw.slice(pos + 4, close)));
        if (n < 0 || n > 255) throw new BasicError('ILLEGAL QUANTITY');
        if (isTab) {
          const target = n % COLS;
          if (target > this.screen.cursorX) {
            this.screen.print(' '.repeat(target - this.screen.cursorX));
          } else if (target < this.screen.cursorX) {
            this.screen.newLine();
            this.screen.print(' '.repeat(target));
          }
        } else {
          this.screen.print(' '.repeat(n));
        }
        pos = close + 1;
        trailingSep = true; // TAB() / SPC() behave like trailing ';' on C64
        continue;
      }

      // Parse an expression up to the next top-level ';' or ','
      const exprEnd = findPrintExprEnd(raw, pos);
      const exprStr = raw.slice(pos, exprEnd).trim();
      if (exprStr) {
        const val = this.evalExpr(exprStr);
        if (typeof val === 'string') {
          this.screen.print(val);
          printedText += val;
        } else {
          const numStr = formatBasicNumber(val);
          this.screen.print(numStr);
          printedText += numStr;
        }
      }
      pos = exprEnd;
    }

    if (!trailingSep) {
      this.screen.newLine();
    }

    // Check if the running program just echoed the user's INPUT back onto the screen!
    if (this.running && this.pendingEchoInput && printedText.trim().length > 0) {
      const nonEchoBuiltin = this.loadedBuiltinName !== null && this.loadedBuiltinName !== 'ECHO';
      const now = performance.now();
      if (!nonEchoBuiltin && now - this.pendingEchoInput.at < 8000 && now - this.lastEchoCelebrationAt > 9000) {
        const needle = this.pendingEchoInput.text;
        const hay = printedText.trim().toUpperCase();
        if (hay === needle || (needle.length >= 2 && hay.includes(needle))) {
          this.pendingEchoInput = null;
          this.lastEchoCelebrationAt = now;
          this.options.onEchoAchieved?.(needle);
        }
      }
    }
  }

  private execInput(body: string, resumeStmtOffset: number, fromDirect: boolean, directLine: string) {
    let rest = body;
    let prompt = '';

    if (rest.startsWith('"')) {
      const closeQuote = rest.indexOf('"', 1);
      if (closeQuote < 0) throw new BasicError('SYNTAX');
      prompt = rest.slice(1, closeQuote);
      rest = rest.slice(closeQuote + 1).trim();
      if (rest.startsWith(';') || rest.startsWith(',')) {
        rest = rest.slice(1).trim();
      } else {
        throw new BasicError('SYNTAX');
      }
    }

    const varStrs = splitTopLevelCommas(rest);
    if (varStrs.length === 0 || !varStrs[0].trim()) throw new BasicError('SYNTAX');
    const targets = varStrs.map((s) => this.parseTarget(s.trim()));

    if (prompt) this.screen.print(prompt);
    this.screen.print('? ');

    this.inputState = {
      targets,
      collected: [],
      promptRow: this.screen.cursorY,
      promptCol: this.screen.cursorX,
      scrollSnapshot: this.screen.scrollCount,
      resumeLineIndex: this.pcLineIndex,
      resumeStmtOffset,
      fromDirect,
      directLine,
    };
    this.screen.cursorEnabled = true;
    this.screen.resetBlink();
  }

  private execFor(body: string, nextOffset: number) {
    const eq = body.indexOf('=');
    if (eq < 0) throw new BasicError('SYNTAX');
    const varName = normalizeVarName(body.slice(0, eq).trim());
    if (!varName || varName.endsWith('$')) throw new BasicError('TYPE MISMATCH');

    const rhs = body.slice(eq + 1);
    const toMatch = findTopLevelKeyword(rhs, 'TO');
    if (toMatch < 0) throw new BasicError('SYNTAX');
    const startExpr = rhs.slice(0, toMatch);
    const afterTo = rhs.slice(toMatch + 2);

    const stepMatch = findTopLevelKeyword(afterTo, 'STEP');
    const endExpr = stepMatch >= 0 ? afterTo.slice(0, stepMatch) : afterTo;
    const stepExpr = stepMatch >= 0 ? afterTo.slice(stepMatch + 4) : '1';

    const startVal = this.evalNum(startExpr);
    const endVal = this.evalNum(endExpr);
    const stepVal = this.evalNum(stepExpr);

    this.vars.set(varName, startVal);

    // Replace existing FOR frame for same variable (authentic BASIC V2)
    const existing = this.forStack.findIndex((f) => f.varName === varName);
    if (existing >= 0) this.forStack.splice(existing);

    this.forStack.push({
      varName,
      endVal,
      stepVal,
      lineIndex: this.pcLineIndex,
      stmtOffset: nextOffset,
    });
  }

  private execNext(varName: string): { action: 'jumpPc'; lineIndex: number; offset: number } | null {
    if (this.forStack.length === 0) throw new BasicError('NEXT WITHOUT FOR');

    let idx = this.forStack.length - 1;
    if (varName) {
      while (idx >= 0 && this.forStack[idx].varName !== varName) idx--;
      if (idx < 0) throw new BasicError('NEXT WITHOUT FOR');
      this.forStack.splice(idx + 1);
    }

    const frame = this.forStack[idx];
    const cur = (this.vars.get(frame.varName) as number | undefined) ?? 0;
    const nextVal = cur + frame.stepVal;
    this.vars.set(frame.varName, nextVal);

    const done = frame.stepVal >= 0 ? nextVal > frame.endVal : nextVal < frame.endVal;
    if (!done) {
      return { action: 'jumpPc', lineIndex: frame.lineIndex, offset: frame.stmtOffset };
    }
    this.forStack.pop();
    return null;
  }

  private execDim(body: string) {
    const decls = splitTopLevelCommas(body);
    for (const decl of decls) {
      const m = decl.trim().match(/^([A-Za-z][A-Za-z0-9]*\$?)\s*\((.*)\)$/);
      if (!m) throw new BasicError('SYNTAX');
      const name = normalizeVarName(m[1]);
      const isString = name.endsWith('$');
      const dimExprs = splitTopLevelCommas(m[2]);
      const dims = dimExprs.map((e) => {
        const d = Math.trunc(this.evalNum(e));
        if (d < 0) throw new BasicError('ILLEGAL QUANTITY');
        return d + 1; // BASIC arrays are 0..N inclusive
      });
      if (this.arrays.has(name)) throw new BasicError("REDIM'D ARRAY");
      const size = dims.reduce((a, b) => a * b, 1);
      if (size > 65536) throw new BasicError('OUT OF MEMORY');
      this.arrays.set(name, {
        dims,
        isString,
        data: new Array<BasicValue>(size).fill(isString ? '' : 0),
      });
    }
  }

  private execRead(body: string) {
    const varStrs = splitTopLevelCommas(body);
    for (const vs of varStrs) {
      if (this.dataPointer >= this.dataItems.length) {
        throw new BasicError('OUT OF DATA');
      }
      const target = this.parseTarget(vs.trim());
      const item = this.dataItems[this.dataPointer++];
      if (target.isString) {
        this.assignTarget(target, item);
      } else {
        const n = Number(item.trim());
        if (Number.isNaN(n)) throw new BasicError('SYNTAX');
        this.assignTarget(target, n);
      }
    }
  }

  private execAssignment(stmt: string) {
    const eq = findTopLevelChar(stmt, '=');
    if (eq < 0) throw new BasicError('SYNTAX');
    const lhs = stmt.slice(0, eq).trim();
    const rhs = stmt.slice(eq + 1).trim();
    if (!lhs || !rhs) throw new BasicError('SYNTAX');
    const target = this.parseTarget(lhs);
    const val = this.evalExpr(rhs);
    if (target.isString && typeof val !== 'string') throw new BasicError('TYPE MISMATCH');
    if (!target.isString && typeof val !== 'number') throw new BasicError('TYPE MISMATCH');
    this.assignTarget(target, val);
  }

  private parseTarget(lhs: string): InputTarget {
    const m = lhs.match(/^([A-Za-z][A-Za-z0-9]*\$?)(?:\s*\((.*)\))?$/);
    if (!m) throw new BasicError('SYNTAX');
    const name = normalizeVarName(m[1]);
    const isString = name.endsWith('$');
    if (m[2] !== undefined) {
      const idxExprs = splitTopLevelCommas(m[2]);
      const indices = idxExprs.map((e) => Math.trunc(this.evalNum(e)));
      return { name, isString, indices };
    }
    return { name, isString };
  }

  private assignTarget(target: InputTarget, val: BasicValue) {
    if (!target.indices) {
      this.vars.set(target.name, val);
      return;
    }
    const entry = this.getOrAutoDimArray(target.name, target.isString, target.indices.length);
    const flat = this.flattenIndex(entry, target.indices);
    entry.data[flat] = val;
  }

  private getOrAutoDimArray(name: string, isString: boolean, rank: number): ArrayEntry {
    let entry = this.arrays.get(name);
    if (!entry) {
      const dims = new Array<number>(rank).fill(11); // C64 auto-DIM 0..10
      const size = dims.reduce((a, b) => a * b, 1);
      entry = { dims, isString, data: new Array<BasicValue>(size).fill(isString ? '' : 0) };
      this.arrays.set(name, entry);
    }
    return entry;
  }

  private flattenIndex(entry: ArrayEntry, indices: number[]): number {
    if (indices.length !== entry.dims.length) throw new BasicError('BAD SUBSCRIPT');
    let flat = 0;
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      if (idx < 0 || idx >= entry.dims[i]) throw new BasicError('BAD SUBSCRIPT');
      flat = flat * entry.dims[i] + idx;
    }
    return flat;
  }

  private parseLineNumber(str: string): number {
    if (!/^\d+$/.test(str)) throw new BasicError('SYNTAX');
    return parseInt(str, 10);
  }

  private poke(addr: number, val: number) {
    if (addr === 53280) {
      this.screen.setBorder(val);
    } else if (addr === 53281) {
      this.screen.setBg(val);
    } else if (addr === 646) {
      this.screen.setTextColor(val);
    } else if (addr >= 1024 && addr < 1024 + COLS * ROWS) {
      this.screen.pokeScreen(addr - 1024, val);
    } else if (addr >= 55296 && addr < 55296 + COLS * ROWS) {
      this.screen.pokeColor(addr - 55296, val);
    } else if (addr >= 54272 && addr <= 54296) {
      this.extraRam.set(addr, val);
      this.options.onSidPoke?.(addr - 54272, val);
    } else {
      this.extraRam.set(addr, val);
    }
  }

  private peek(addr: number): number {
    if (addr === 53280) return this.screen.borderColor;
    if (addr === 53281) return this.screen.bgColor;
    if (addr === 646) return this.screen.textColor;
    if (addr === 198) return this.keyBuffer.length;
    if (addr >= 1024 && addr < 1024 + COLS * ROWS) return this.screen.screenRam[addr - 1024];
    if (addr >= 55296 && addr < 55296 + COLS * ROWS) return this.screen.colorRam[addr - 55296];
    return this.extraRam.get(addr) ?? 0;
  }

  private nextRnd(arg: number): number {
    if (arg < 0) {
      this.rngState = Math.abs(Math.floor(arg * 16777215)) || 1;
    } else if (arg === 0) {
      this.rngState ^= (Date.now() & 0xffffffff) >>> 0;
    }
    // xorshift32
    let x = this.rngState || 0x12345678;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return (this.rngState & 0xffffff) / 0x1000000;
  }

  // ---- Expression Evaluator (recursive descent) ----

  private evalNum(expr: string): number {
    const v = this.evalExpr(expr);
    if (typeof v !== 'number') throw new BasicError('TYPE MISMATCH');
    return v;
  }

  private evalExpr(expr: string): BasicValue {
    const parser = new ExprParser(expr, this);
    const val = parser.parseOr();
    parser.expectEnd();
    return val;
  }

  /** Called by ExprParser for built-in functions and variable/array reads. */
  resolveIdentifier(rawName: string, args: BasicValue[] | null): BasicValue {
    const name = rawName.toUpperCase();

    // Built-in functions
    if (args !== null) {
      switch (name) {
        case 'CHR$': {
          this.expectArity(args, 1);
          const n = Math.trunc(this.asNum(args[0]));
          if (n < 0 || n > 255) throw new BasicError('ILLEGAL QUANTITY');
          return String.fromCharCode(n);
        }
        case 'ASC': {
          this.expectArity(args, 1);
          const s = this.asStr(args[0]);
          if (!s.length) throw new BasicError('ILLEGAL QUANTITY');
          return s.charCodeAt(0);
        }
        case 'LEN': {
          this.expectArity(args, 1);
          return this.asStr(args[0]).length;
        }
        case 'LEFT$': {
          this.expectArity(args, 2);
          const s = this.asStr(args[0]);
          const n = Math.trunc(this.asNum(args[1]));
          if (n < 0 || n > 255) throw new BasicError('ILLEGAL QUANTITY');
          return s.slice(0, n);
        }
        case 'RIGHT$': {
          this.expectArity(args, 2);
          const s = this.asStr(args[0]);
          const n = Math.trunc(this.asNum(args[1]));
          if (n < 0 || n > 255) throw new BasicError('ILLEGAL QUANTITY');
          return n === 0 ? '' : s.slice(-n);
        }
        case 'MID$': {
          if (args.length < 2 || args.length > 3) throw new BasicError('SYNTAX');
          const s = this.asStr(args[0]);
          const start = Math.trunc(this.asNum(args[1]));
          if (start < 1 || start > 255) throw new BasicError('ILLEGAL QUANTITY');
          if (args.length === 2) return s.slice(start - 1);
          const len = Math.trunc(this.asNum(args[2]));
          if (len < 0 || len > 255) throw new BasicError('ILLEGAL QUANTITY');
          return s.slice(start - 1, start - 1 + len);
        }
        case 'STR$': {
          this.expectArity(args, 1);
          const n = this.asNum(args[0]);
          return (n >= 0 ? ' ' : '') + String(n);
        }
        case 'VAL': {
          this.expectArity(args, 1);
          const m = this.asStr(args[0]).trim().match(/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
          return m ? Number(m[0]) : 0;
        }
        case 'RND': {
          this.expectArity(args, 1);
          return this.nextRnd(this.asNum(args[0]));
        }
        case 'INT': {
          this.expectArity(args, 1);
          return Math.floor(this.asNum(args[0]));
        }
        case 'ABS': {
          this.expectArity(args, 1);
          return Math.abs(this.asNum(args[0]));
        }
        case 'SGN': {
          this.expectArity(args, 1);
          return Math.sign(this.asNum(args[0]));
        }
        case 'SQR': {
          this.expectArity(args, 1);
          const x = this.asNum(args[0]);
          if (x < 0) throw new BasicError('ILLEGAL QUANTITY');
          return Math.sqrt(x);
        }
        case 'SIN':
          this.expectArity(args, 1);
          return Math.sin(this.asNum(args[0]));
        case 'COS':
          this.expectArity(args, 1);
          return Math.cos(this.asNum(args[0]));
        case 'TAN':
          this.expectArity(args, 1);
          return Math.tan(this.asNum(args[0]));
        case 'ATN':
          this.expectArity(args, 1);
          return Math.atan(this.asNum(args[0]));
        case 'LOG': {
          this.expectArity(args, 1);
          const x = this.asNum(args[0]);
          if (x <= 0) throw new BasicError('ILLEGAL QUANTITY');
          return Math.log(x);
        }
        case 'EXP':
          this.expectArity(args, 1);
          return Math.exp(this.asNum(args[0]));
        case 'PEEK': {
          this.expectArity(args, 1);
          const addr = Math.trunc(this.asNum(args[0]));
          if (addr < 0 || addr > 65535) throw new BasicError('ILLEGAL QUANTITY');
          return this.peek(addr);
        }
        case 'FRE':
          this.expectArity(args, 1);
          return this.bytesFree();
        case 'POS':
          this.expectArity(args, 1);
          return this.screen.cursorX;
      }

      // Otherwise it is an array element lookup
      const arrName = normalizeVarName(name);
      const isString = arrName.endsWith('$');
      const indices = args.map((a) => Math.trunc(this.asNum(a)));
      const entry = this.getOrAutoDimArray(arrName, isString, indices.length);
      const flat = this.flattenIndex(entry, indices);
      return entry.data[flat];
    }

    // Special system variables TI and TI$
    if (name === 'TI') {
      return Math.floor(((performance.now() - this.bootTime) * 60) / 1000) % 5184000;
    }
    if (name === 'TI$') {
      const secs = Math.floor((performance.now() - this.bootTime) / 1000) % 86400;
      const h = String(Math.floor(secs / 3600)).padStart(2, '0');
      const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
      const s = String(secs % 60).padStart(2, '0');
      return `${h}${m}${s}`;
    }

    const varName = normalizeVarName(name);
    const val = this.vars.get(varName);
    if (val !== undefined) return val;
    return varName.endsWith('$') ? '' : 0;
  }

  private expectArity(args: BasicValue[], n: number) {
    if (args.length !== n) throw new BasicError('SYNTAX');
  }

  private asNum(v: BasicValue): number {
    if (typeof v !== 'number') throw new BasicError('TYPE MISMATCH');
    return v;
  }

  private asStr(v: BasicValue): string {
    if (typeof v !== 'string') throw new BasicError('TYPE MISMATCH');
    return v;
  }
}

class ExprParser {
  private pos = 0;
  constructor(
    private readonly src: string,
    private readonly vm: C64Basic,
  ) {}

  private skip() {
    while (this.pos < this.src.length && this.src[this.pos] === ' ') this.pos++;
  }

  expectEnd() {
    this.skip();
    if (this.pos < this.src.length) throw new BasicError('SYNTAX');
  }

  parseOr(): BasicValue {
    let left = this.parseAnd();
    while (true) {
      this.skip();
      if (matchKeywordAt(this.src, this.pos, 'OR')) {
        this.pos += 2;
        const right = this.parseAnd();
        left = (toInt16(left) | toInt16(right));
      } else {
        break;
      }
    }
    return left;
  }

  private parseAnd(): BasicValue {
    let left = this.parseNot();
    while (true) {
      this.skip();
      if (matchKeywordAt(this.src, this.pos, 'AND')) {
        this.pos += 3;
        const right = this.parseNot();
        left = (toInt16(left) & toInt16(right));
      } else {
        break;
      }
    }
    return left;
  }

  private parseNot(): BasicValue {
    this.skip();
    if (matchKeywordAt(this.src, this.pos, 'NOT')) {
      this.pos += 3;
      const v = this.parseNot();
      return ~toInt16(v);
    }
    return this.parseCompare();
  }

  private parseCompare(): BasicValue {
    let left = this.parseAddSub();
    while (true) {
      this.skip();
      const two = this.src.slice(this.pos, this.pos + 2);
      const one = this.src[this.pos];
      let op: string | null = null;
      if (two === '<>' || two === '><' || two === '<=' || two === '=<' || two === '>=' || two === '=>') {
        op = two;
        this.pos += 2;
      } else if (one === '=' || one === '<' || one === '>') {
        op = one;
        this.pos += 1;
      }
      if (!op) break;

      const right = this.parseAddSub();
      if (typeof left !== typeof right) throw new BasicError('TYPE MISMATCH');

      let truth = false;
      if (op === '=') truth = left === right;
      else if (op === '<>' || op === '><') truth = left !== right;
      else if (op === '<') truth = left < right;
      else if (op === '>') truth = left > right;
      else if (op === '<=' || op === '=<') truth = left <= right;
      else if (op === '>=' || op === '=>') truth = left >= right;

      left = truth ? -1 : 0; // C64 BASIC true is -1, false is 0
    }
    return left;
  }

  private parseAddSub(): BasicValue {
    let left = this.parseMulDiv();
    while (true) {
      this.skip();
      const ch = this.src[this.pos];
      if (ch === '+') {
        this.pos++;
        const right = this.parseMulDiv();
        if (typeof left === 'string' && typeof right === 'string') {
          left = left + right;
        } else if (typeof left === 'number' && typeof right === 'number') {
          left = left + right;
        } else {
          throw new BasicError('TYPE MISMATCH');
        }
      } else if (ch === '-') {
        this.pos++;
        const right = this.parseMulDiv();
        if (typeof left !== 'number' || typeof right !== 'number') {
          throw new BasicError('TYPE MISMATCH');
        }
        left = left - right;
      } else {
        break;
      }
    }
    return left;
  }

  private parseMulDiv(): BasicValue {
    let left = this.parseUnary();
    while (true) {
      this.skip();
      const ch = this.src[this.pos];
      if (ch === '*' || ch === '/') {
        this.pos++;
        const right = this.parseUnary();
        if (typeof left !== 'number' || typeof right !== 'number') {
          throw new BasicError('TYPE MISMATCH');
        }
        if (ch === '*') {
          left = left * right;
        } else {
          if (right === 0) throw new BasicError('DIVISION BY ZERO');
          left = left / right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  private parseUnary(): BasicValue {
    this.skip();
    const ch = this.src[this.pos];
    if (ch === '-') {
      this.pos++;
      const v = this.parseUnary();
      if (typeof v !== 'number') throw new BasicError('TYPE MISMATCH');
      return -v;
    }
    if (ch === '+') {
      this.pos++;
      const v = this.parseUnary();
      if (typeof v !== 'number') throw new BasicError('TYPE MISMATCH');
      return v;
    }
    return this.parsePower();
  }

  private parsePower(): BasicValue {
    let left = this.parsePrimary();
    this.skip();
    if (this.src[this.pos] === '^') {
      this.pos++;
      const right = this.parseUnary();
      if (typeof left !== 'number' || typeof right !== 'number') {
        throw new BasicError('TYPE MISMATCH');
      }
      left = Math.pow(left, right);
    }
    return left;
  }

  private parsePrimary(): BasicValue {
    this.skip();
    if (this.pos >= this.src.length) throw new BasicError('SYNTAX');
    const ch = this.src[this.pos];

    // String literal
    if (ch === '"') {
      this.pos++;
      let s = '';
      while (this.pos < this.src.length && this.src[this.pos] !== '"') {
        s += this.src[this.pos++];
      }
      if (this.pos < this.src.length && this.src[this.pos] === '"') this.pos++;
      return s;
    }

    // Parenthesized expression
    if (ch === '(') {
      this.pos++;
      const v = this.parseOr();
      this.skip();
      if (this.src[this.pos] !== ')') throw new BasicError('SYNTAX');
      this.pos++;
      return v;
    }

    // Number literal
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      const m = this.src.slice(this.pos).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
      if (!m) throw new BasicError('SYNTAX');
      this.pos += m[0].length;
      return Number(m[0]);
    }

    // Pi symbol (PETSCII 255 / π)
    if (ch === 'π' || ch.charCodeAt(0) === 255) {
      this.pos++;
      return Math.PI;
    }

    // Identifier (variable, array, or function)
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) {
      const start = this.pos;
      while (this.pos < this.src.length && /[A-Za-z0-9]/.test(this.src[this.pos])) {
        this.pos++;
      }
      if (this.src[this.pos] === '$' || this.src[this.pos] === '%') {
        this.pos++;
      }
      const name = this.src.slice(start, this.pos);
      this.skip();
      if (this.src[this.pos] === '(') {
        this.pos++;
        const args: BasicValue[] = [];
        this.skip();
        if (this.src[this.pos] !== ')') {
          while (true) {
            args.push(this.parseOr());
            this.skip();
            if (this.src[this.pos] === ',') {
              this.pos++;
            } else {
              break;
            }
          }
        }
        if (this.src[this.pos] !== ')') throw new BasicError('SYNTAX');
        this.pos++;
        return this.vm.resolveIdentifier(name, args);
      }
      return this.vm.resolveIdentifier(name, null);
    }

    throw new BasicError('SYNTAX');
  }
}

// ---- Utility helpers ----

function toInt16(v: BasicValue): number {
  if (typeof v !== 'number') throw new BasicError('TYPE MISMATCH');
  return Math.trunc(v);
}

function normalizeVarName(name: string): string {
  return name.toUpperCase().replace(/%$/, '');
}

function skipSpaces(s: string, pos: number): number {
  while (pos < s.length && s[pos] === ' ') pos++;
  return pos;
}

function matchKeywordAt(src: string, pos: number, kw: string): boolean {
  if (pos + kw.length > src.length) return false;
  if (src.slice(pos, pos + kw.length).toUpperCase() !== kw) return false;
  // If keyword ends with a letter, ensure the next char isn't alphanumeric or $
  const last = kw[kw.length - 1];
  if (/[A-Z]/i.test(last)) {
    const next = src[pos + kw.length];
    if (next && /[A-Za-z0-9$]/.test(next)) return false;
  }
  return true;
}

function findStatementEnd(src: string, start: number): number {
  let inQuote = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === ':') return i;
  }
  return src.length;
}

function findMatchingParen(src: string, openPos: number): number {
  let depth = 0;
  let inQuote = false;
  for (let i = openPos; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote) {
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

function findPrintExprEnd(src: string, start: number): number {
  let depth = 0;
  let inQuote = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && (ch === ';' || ch === ',')) return i;
    }
  }
  return src.length;
}

function splitTopLevelCommas(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && ch === ',') {
        out.push(src.slice(start, i));
        start = i + 1;
      }
    }
  }
  out.push(src.slice(start));
  return out;
}

function splitInputFields(raw: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= raw.length) {
    while (i < raw.length && raw[i] === ' ') i++;
    if (i < raw.length && raw[i] === '"') {
      i++;
      let s = '';
      while (i < raw.length && raw[i] !== '"') s += raw[i++];
      if (i < raw.length && raw[i] === '"') i++;
      out.push(s);
      while (i < raw.length && raw[i] !== ',') i++;
      if (i < raw.length && raw[i] === ',') i++;
      else break;
    } else {
      const comma = raw.indexOf(',', i);
      if (comma < 0) {
        out.push(raw.slice(i).trim());
        break;
      }
      out.push(raw.slice(i, comma).trim());
      i = comma + 1;
    }
  }
  return out;
}

function findTopLevelChar(src: string, target: string): number {
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && ch === target) return i;
    }
  }
  return -1;
}

function findTopLevelKeyword(src: string, kw: string): number {
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && matchKeywordAt(src, i, kw)) {
        const prev = i > 0 ? src[i - 1] : ' ';
        if (!/[A-Za-z0-9$]/.test(prev)) return i;
      }
    }
  }
  return -1;
}

function findIfThenSplit(src: string): { cond: string; after: string; afterIndex: number } | null {
  const thenIdx = findTopLevelKeyword(src, 'THEN');
  if (thenIdx >= 0) {
    return {
      cond: src.slice(0, thenIdx).trim(),
      after: src.slice(thenIdx + 4),
      afterIndex: thenIdx + 4,
    };
  }
  const gotoIdx = findTopLevelKeyword(src, 'GOTO');
  if (gotoIdx >= 0) {
    return {
      cond: src.slice(0, gotoIdx).trim(),
      after: src.slice(gotoIdx + 4),
      afterIndex: gotoIdx,
    };
  }
  return null;
}

function formatBasicNumber(n: number): string {
  if (Object.is(n, -0)) n = 0;
  // Format cleanly like C64 (9 significant digits, leading space if >= 0, trailing space)
  let s = Math.abs(n) >= 1e9 || (Math.abs(n) > 0 && Math.abs(n) < 0.01)
    ? n.toExponential(7).replace(/\.?0+e/, 'E').toUpperCase()
    : Number(n.toPrecision(9)).toString();
  return (n >= 0 ? ' ' : '') + s + ' ';
}
