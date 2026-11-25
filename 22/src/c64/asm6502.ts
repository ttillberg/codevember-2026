// 2-Pass MOS 6502 Assembler & Disassembler for the Day 22 Commodore 64.
// Supports labels, constants (= / EQU), * = $C000 / .ORG, .BYTE / .WORD / .TEXT,
// arithmetic expressions (<lo, >hi, +, -, *, /, &, |, ^), hex ($), binary (%),
// char literals ('A'), and single-line interactive monitor assembly.

export type AddrMode =
  | 'IMP'
  | 'ACC'
  | 'IMM'
  | 'ZP'
  | 'ZPX'
  | 'ZPY'
  | 'ABS'
  | 'ABSX'
  | 'ABSY'
  | 'IND'
  | 'INDX'
  | 'INDY'
  | 'REL';

const MODE_SIZE: Record<AddrMode, number> = {
  IMP: 1,
  ACC: 1,
  IMM: 2,
  ZP: 2,
  ZPX: 2,
  ZPY: 2,
  ABS: 3,
  ABSX: 3,
  ABSY: 3,
  IND: 3,
  INDX: 2,
  INDY: 2,
  REL: 2,
};

// Complete official 6502 opcode table: MNEMONIC -> { mode: opcode }
const OPCODES: Record<string, Partial<Record<AddrMode, number>>> = {
  ADC: { IMM: 0x69, ZP: 0x65, ZPX: 0x75, ABS: 0x6d, ABSX: 0x7d, ABSY: 0x79, INDX: 0x61, INDY: 0x71 },
  AND: { IMM: 0x29, ZP: 0x25, ZPX: 0x35, ABS: 0x2d, ABSX: 0x3d, ABSY: 0x39, INDX: 0x21, INDY: 0x31 },
  ASL: { ACC: 0x0a, IMP: 0x0a, ZP: 0x06, ZPX: 0x16, ABS: 0x0e, ABSX: 0x1e },
  BCC: { REL: 0x90 },
  BCS: { REL: 0xb0 },
  BEQ: { REL: 0xf0 },
  BIT: { ZP: 0x24, ABS: 0x2c },
  BMI: { REL: 0x30 },
  BNE: { REL: 0xd0 },
  BPL: { REL: 0x10 },
  BRK: { IMP: 0x00 },
  BVC: { REL: 0x50 },
  BVS: { REL: 0x70 },
  CLC: { IMP: 0x18 },
  CLD: { IMP: 0xd8 },
  CLI: { IMP: 0x58 },
  CLV: { IMP: 0xb8 },
  CMP: { IMM: 0xc9, ZP: 0xc5, ZPX: 0xd5, ABS: 0xcd, ABSX: 0xdd, ABSY: 0xd9, INDX: 0xc1, INDY: 0xd1 },
  CPX: { IMM: 0xe0, ZP: 0xe4, ABS: 0xec },
  CPY: { IMM: 0xc0, ZP: 0xc4, ABS: 0xcc },
  DEC: { ZP: 0xc6, ZPX: 0xd6, ABS: 0xce, ABSX: 0xde },
  DEX: { IMP: 0xca },
  DEY: { IMP: 0x88 },
  EOR: { IMM: 0x49, ZP: 0x45, ZPX: 0x55, ABS: 0x4d, ABSX: 0x5d, ABSY: 0x59, INDX: 0x41, INDY: 0x51 },
  INC: { ZP: 0xe6, ZPX: 0xf6, ABS: 0xee, ABSX: 0xfe },
  INX: { IMP: 0xe8 },
  INY: { IMP: 0xc8 },
  JMP: { ABS: 0x4c, IND: 0x6c },
  JSR: { ABS: 0x20 },
  LDA: { IMM: 0xa9, ZP: 0xa5, ZPX: 0xb5, ABS: 0xad, ABSX: 0xbd, ABSY: 0xb9, INDX: 0xa1, INDY: 0xb1 },
  LDX: { IMM: 0xa2, ZP: 0xa6, ZPY: 0xb6, ABS: 0xae, ABSY: 0xbe },
  LDY: { IMM: 0xa0, ZP: 0xa4, ZPX: 0xb4, ABS: 0xac, ABSX: 0xbc },
  LSR: { ACC: 0x4a, IMP: 0x4a, ZP: 0x46, ZPX: 0x56, ABS: 0x4e, ABSX: 0x5e },
  NOP: { IMP: 0xea },
  ORA: { IMM: 0x09, ZP: 0x05, ZPX: 0x15, ABS: 0x0d, ABSX: 0x1d, ABSY: 0x19, INDX: 0x01, INDY: 0x11 },
  PHA: { IMP: 0x48 },
  PHP: { IMP: 0x08 },
  PLA: { IMP: 0x68 },
  PLP: { IMP: 0x28 },
  ROL: { ACC: 0x2a, IMP: 0x2a, ZP: 0x26, ZPX: 0x36, ABS: 0x2e, ABSX: 0x3e },
  ROR: { ACC: 0x6a, IMP: 0x6a, ZP: 0x66, ZPX: 0x76, ABS: 0x6e, ABSX: 0x7e },
  RTI: { IMP: 0x40 },
  RTS: { IMP: 0x60 },
  SBC: { IMM: 0xe9, ZP: 0xe5, ZPX: 0xf5, ABS: 0xed, ABSX: 0xfd, ABSY: 0xf9, INDX: 0xe1, INDY: 0xf1 },
  SEC: { IMP: 0x38 },
  SED: { IMP: 0xf8 },
  SEI: { IMP: 0x78 },
  STA: { ZP: 0x85, ZPX: 0x95, ABS: 0x8d, ABSX: 0x9d, ABSY: 0x99, INDX: 0x81, INDY: 0x91 },
  STX: { ZP: 0x86, ZPY: 0x96, ABS: 0x8e },
  STY: { ZP: 0x84, ZPX: 0x94, ABS: 0x8c },
  TAX: { IMP: 0xaa },
  TAY: { IMP: 0xa8 },
  TSX: { IMP: 0xba },
  TXA: { IMP: 0x8a },
  TXS: { IMP: 0x9a },
  TYA: { IMP: 0x98 },

  // ---- Official-layout MOS 6502/6510 undocumented opcodes (used by DASM disassemblies & demos) ----
  LAX: { ZP: 0xa7, ZPY: 0xb7, ABS: 0xaf, ABSY: 0xbf, INDX: 0xa3, INDY: 0xb3, IMM: 0xab },
  SAX: { ZP: 0x87, ZPY: 0x97, ABS: 0x8f, INDX: 0x83 },
  DCP: { ZP: 0xc7, ZPX: 0xd7, ABS: 0xcf, ABSX: 0xdf, ABSY: 0xdb, INDX: 0xc3, INDY: 0xd3 },
  ISB: { ZP: 0xe7, ZPX: 0xf7, ABS: 0xef, ABSX: 0xff, ABSY: 0xfb, INDX: 0xe3, INDY: 0xf3 },
  ISC: { ZP: 0xe7, ZPX: 0xf7, ABS: 0xef, ABSX: 0xff, ABSY: 0xfb, INDX: 0xe3, INDY: 0xf3 },
  SLO: { ZP: 0x07, ZPX: 0x17, ABS: 0x0f, ABSX: 0x1f, ABSY: 0x1b, INDX: 0x03, INDY: 0x13 },
  RLA: { ZP: 0x27, ZPX: 0x37, ABS: 0x2f, ABSX: 0x3f, ABSY: 0x3b, INDX: 0x23, INDY: 0x33 },
  SRE: { ZP: 0x47, ZPX: 0x57, ABS: 0x4f, ABSX: 0x5f, ABSY: 0x5b, INDX: 0x43, INDY: 0x53 },
  RRA: { ZP: 0x67, ZPX: 0x77, ABS: 0x6f, ABSX: 0x7f, ABSY: 0x7b, INDX: 0x63, INDY: 0x73 },
  SBX: { IMM: 0xcb },
  AXS: { IMM: 0xcb },
  ANC: { IMM: 0x0b },
  ALR: { IMM: 0x4b },
  ASR: { IMM: 0x4b },
  ARR: { IMM: 0x6b },
  LAS: { ABSY: 0xbb },
  SHA: { ABSY: 0x9f, INDY: 0x93 },
  SHX: { ABSY: 0x9e },
  SHY: { ABSX: 0x9c },
  TAS: { ABSY: 0x9b },
  ANE: { IMM: 0x8b },
  LXA: { IMM: 0xab },
  USBC: { IMM: 0xeb },
};

// Reverse lookup table for disassembly: opcode -> { mnem, mode }
const DISASM_TABLE: ({ mnem: string; mode: AddrMode } | null)[] = new Array(256).fill(null);
for (const [mnem, modes] of Object.entries(OPCODES)) {
  for (const [mode, op] of Object.entries(modes)) {
    if (op !== undefined && !DISASM_TABLE[op]) {
      // Prefer ACC over IMP for ASL/LSR/ROL/ROR disassembly
      DISASM_TABLE[op] = { mnem, mode: mode as AddrMode };
    }
  }
}

export const MNEMONIC_SET = new Set(Object.keys(OPCODES));

export interface AsmSegment {
  org: number;
  bytes: number[];
}

export interface AsmResult {
  ok: boolean;
  segments: AsmSegment[];
  entryAddr: number;
  totalBytes: number;
  symbols: Record<string, number>;
  errors: string[];
}

function stripComment(line: string): string {
  let inQuotes = false;
  let quoteChar = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === quoteChar) inQuotes = false;
    } else if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
    } else if (ch === ';') {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Evaluate a 6502 assembler expression. Returns null if an unresolved symbol is referenced. */
function evalExpr(
  raw: string,
  symbols: Record<string, number>,
  pc: number,
  strict: boolean,
  scopeId = 0,
): number | null {
  const s = raw.trim();
  if (!s) throw new Error('EMPTY EXPRESSION');

  let pos = 0;
  let unresolved = false;

  const skipWs = () => {
    while (pos < s.length && /\s/.test(s[pos])) pos++;
  };

  const parseOr = (): number => {
    let left = parseXor();
    while (true) {
      skipWs();
      if (s[pos] === '|') {
        pos++;
        left = left | parseXor();
      } else break;
    }
    return left;
  };

  const parseXor = (): number => {
    let left = parseAnd();
    while (true) {
      skipWs();
      if (s[pos] === '^') {
        pos++;
        left = left ^ parseAnd();
      } else break;
    }
    return left;
  };

  const parseAnd = (): number => {
    let left = parseShift();
    while (true) {
      skipWs();
      if (s[pos] === '&') {
        pos++;
        left = left & parseShift();
      } else break;
    }
    return left;
  };

  const parseShift = (): number => {
    let left = parseAdd();
    while (true) {
      skipWs();
      if (s.startsWith('<<', pos)) {
        pos += 2;
        left = left << parseAdd();
      } else if (s.startsWith('>>', pos)) {
        pos += 2;
        left = left >> parseAdd();
      } else break;
    }
    return left;
  };

  const parseAdd = (): number => {
    let left = parseMul();
    while (true) {
      skipWs();
      if (s[pos] === '+') {
        pos++;
        left = left + parseMul();
      } else if (s[pos] === '-') {
        pos++;
        left = left - parseMul();
      } else break;
    }
    return left;
  };

  const parseMul = (): number => {
    let left = parseUnary();
    while (true) {
      skipWs();
      if (s[pos] === '*') {
        pos++;
        left = left * parseUnary();
      } else if (s[pos] === '/') {
        pos++;
        const r = parseUnary();
        left = r === 0 ? 0 : Math.trunc(left / r);
      } else break;
    }
    return left;
  };

  const parseUnary = (): number => {
    skipWs();
    if (s[pos] === '<') {
      pos++;
      return parseUnary() & 0xff;
    }
    if (s[pos] === '>') {
      pos++;
      return (parseUnary() >> 8) & 0xff;
    }
    if (s[pos] === '-') {
      pos++;
      return -parseUnary();
    }
    if (s[pos] === '+') {
      pos++;
      return parseUnary();
    }
    if (s[pos] === '~') {
      pos++;
      return ~parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    skipWs();
    if (s[pos] === '(') {
      pos++;
      const v = parseOr();
      skipWs();
      if (s[pos] !== ')') throw new Error('MISSING )');
      pos++;
      return v;
    }
    if (s[pos] === '*') {
      pos++;
      return pc;
    }
    if (s[pos] === '$') {
      pos++;
      const start = pos;
      while (pos < s.length && /[0-9a-fA-F]/.test(s[pos])) pos++;
      if (pos === start) throw new Error('BAD HEX');
      return parseInt(s.slice(start, pos), 16);
    }
    if (s[pos] === '%') {
      pos++;
      const start = pos;
      while (pos < s.length && /[01_]/.test(s[pos])) pos++;
      if (pos === start) throw new Error('BAD BINARY');
      return parseInt(s.slice(start, pos).replace(/_/g, ''), 2);
    }
    if (s[pos] === "'" && pos + 2 < s.length && s[pos + 2] === "'") {
      const code = s.charCodeAt(pos + 1);
      pos += 3;
      return code;
    }
    if (/[0-9]/.test(s[pos] ?? '')) {
      const start = pos;
      if (s[pos] === '0' && (s[pos + 1] === 'x' || s[pos + 1] === 'X')) {
        pos += 2;
        const hStart = pos;
        while (pos < s.length && /[0-9a-fA-F]/.test(s[pos])) pos++;
        return parseInt(s.slice(hStart, pos), 16);
      }
      while (pos < s.length && /[0-9]/.test(s[pos])) pos++;
      return parseInt(s.slice(start, pos), 10);
    }
    if (/[A-Za-z_.]/.test(s[pos] ?? '')) {
      const start = pos;
      while (pos < s.length && /[A-Za-z0-9_.]/.test(s[pos])) pos++;
      const name = s.slice(start, pos).toUpperCase();
      if (name.startsWith('.')) {
        const scoped = `@@${scopeId}${name}`;
        if (scoped in symbols) return symbols[scoped];
      }
      if (name in symbols) return symbols[name];
      if (strict) throw new Error(`UNKNOWN SYMBOL ${name}`);
      unresolved = true;
      return 0;
    }
    throw new Error(`UNEXPECTED '${s.slice(pos, pos + 8)}'`);
  };

  const val = parseOr();
  skipWs();
  if (pos < s.length) throw new Error(`TRAILING '${s.slice(pos)}'`);
  return unresolved ? null : val;
}

function splitCsvRespectingQuotes(str: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  let qCh = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inQ) {
      cur += ch;
      if (ch === qCh) inQ = false;
    } else if (ch === '"' || ch === "'") {
      inQ = true;
      qCh = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

interface ParsedOperand {
  kind: 'IMP' | 'ACC' | 'IMM' | 'IND' | 'INDX' | 'INDY' | 'X' | 'Y' | 'DIRECT';
  expr: string;
}

function parseOperand(raw: string): ParsedOperand {
  const op = raw.trim();
  if (!op) return { kind: 'IMP', expr: '' };
  if (/^[Aa]$/.test(op)) return { kind: 'ACC', expr: '' };
  if (op.startsWith('#')) return { kind: 'IMM', expr: op.slice(1).trim() };

  // (expr,X)
  const indX = op.match(/^\((.+),\s*[Xx]\)$/);
  if (indX) return { kind: 'INDX', expr: indX[1].trim() };

  // (expr),Y
  const indY = op.match(/^\((.+)\),\s*[Yy]$/);
  if (indY) return { kind: 'INDY', expr: indY[1].trim() };

  // (expr) — only indirect when whole operand is a single balanced (...) for JMP
  if (op.startsWith('(') && op.endsWith(')')) {
    let depth = 0;
    let wrapsWhole = true;
    for (let i = 0; i < op.length - 1; i++) {
      if (op[i] === '(') depth++;
      else if (op[i] === ')') depth--;
      if (depth === 0) {
        wrapsWhole = false;
        break;
      }
    }
    if (wrapsWhole) return { kind: 'IND', expr: op.slice(1, -1).trim() };
  }

  // expr,X or expr,Y
  const idxX = op.match(/^(.+),\s*[Xx]$/);
  if (idxX) return { kind: 'X', expr: idxX[1].trim() };
  const idxY = op.match(/^(.+),\s*[Yy]$/);
  if (idxY) return { kind: 'Y', expr: idxY[1].trim() };

  return { kind: 'DIRECT', expr: op };
}

interface EncodedInst {
  mode: AddrMode;
  opcode: number;
  size: number;
  bytes: number[];
}

function encodeInstruction(
  rawMnem: string,
  rawOperand: string,
  symbols: Record<string, number>,
  pc: number,
  pass: 1 | 2,
  forcedMode?: AddrMode,
  scopeId = 0,
): EncodedInst {
  // Support standard DASM size-override suffixes: .W (force 16-bit absolute) and .B/.Z (force 8-bit zero-page)
  let mnem = rawMnem;
  let forceAbs = false;
  let forceZp = false;
  const suffixMatch = rawMnem.match(/^([A-Z]{3,4})\.(W|B|Z)$/);
  if (suffixMatch) {
    mnem = suffixMatch[1];
    forceAbs = suffixMatch[2] === 'W';
    forceZp = suffixMatch[2] === 'B' || suffixMatch[2] === 'Z';
  }
  const table = OPCODES[mnem];
  if (!table) throw new Error(`UNKNOWN OPCODE ${rawMnem}`);
  const parsed = parseOperand(rawOperand);
  const strict = pass === 2;

  // Branch instructions always use REL
  if (table.REL !== undefined) {
    if (parsed.kind !== 'DIRECT') throw new Error(`BAD BRANCH OPERAND`);
    const target = evalExpr(parsed.expr, symbols, pc, strict, scopeId);
    let rel = 0;
    if (target !== null) {
      const diff = target - (pc + 2);
      if (strict && (diff < -128 || diff > 127)) {
        throw new Error(`BRANCH OUT OF RANGE (${diff})`);
      }
      rel = diff & 0xff;
    }
    return { mode: 'REL', opcode: table.REL, size: 2, bytes: [table.REL, rel] };
  }

  if (parsed.kind === 'IMP') {
    if (table.IMP !== undefined) return { mode: 'IMP', opcode: table.IMP, size: 1, bytes: [table.IMP] };
    if (table.ACC !== undefined) return { mode: 'ACC', opcode: table.ACC, size: 1, bytes: [table.ACC] };
    throw new Error(`${mnem} NEEDS OPERAND`);
  }

  if (parsed.kind === 'ACC') {
    if (table.ACC !== undefined) return { mode: 'ACC', opcode: table.ACC, size: 1, bytes: [table.ACC] };
    // Could also be a label named "A"
  }

  if (parsed.kind === 'IMM') {
    if (table.IMM === undefined) throw new Error(`${mnem} NO IMM MODE`);
    const val = evalExpr(parsed.expr, symbols, pc, strict, scopeId) ?? 0;
    return { mode: 'IMM', opcode: table.IMM, size: 2, bytes: [table.IMM, val & 0xff] };
  }

  if (parsed.kind === 'INDX') {
    if (table.INDX === undefined) throw new Error(`${mnem} NO (ZP,X) MODE`);
    const val = evalExpr(parsed.expr, symbols, pc, strict, scopeId) ?? 0;
    return { mode: 'INDX', opcode: table.INDX, size: 2, bytes: [table.INDX, val & 0xff] };
  }

  if (parsed.kind === 'INDY') {
    if (table.INDY === undefined) throw new Error(`${mnem} NO (ZP),Y MODE`);
    const val = evalExpr(parsed.expr, symbols, pc, strict, scopeId) ?? 0;
    return { mode: 'INDY', opcode: table.INDY, size: 2, bytes: [table.INDY, val & 0xff] };
  }

  if (parsed.kind === 'IND') {
    if (table.IND !== undefined) {
      const val = evalExpr(parsed.expr, symbols, pc, strict, scopeId) ?? 0;
      return { mode: 'IND', opcode: table.IND, size: 3, bytes: [table.IND, val & 0xff, (val >> 8) & 0xff] };
    }
    // Otherwise treat parenthesized expression as a normal arithmetic expression
  }

  const exprStr = parsed.kind === 'ACC' ? rawOperand.trim() : parsed.kind === 'IND' ? rawOperand.trim() : parsed.expr;
  const val = evalExpr(exprStr, symbols, pc, strict, scopeId);
  const canZp = !forceAbs && (forceZp || (val !== null && val >= 0 && val <= 0xff));

  if (parsed.kind === 'X') {
    const useZp = forcedMode ? forcedMode === 'ZPX' : canZp && table.ZPX !== undefined;
    if (useZp && table.ZPX !== undefined) {
      return { mode: 'ZPX', opcode: table.ZPX, size: 2, bytes: [table.ZPX, (val ?? 0) & 0xff] };
    }
    if (table.ABSX !== undefined) {
      const v = val ?? 0;
      return { mode: 'ABSX', opcode: table.ABSX, size: 3, bytes: [table.ABSX, v & 0xff, (v >> 8) & 0xff] };
    }
    if (table.ZPX !== undefined) {
      return { mode: 'ZPX', opcode: table.ZPX, size: 2, bytes: [table.ZPX, (val ?? 0) & 0xff] };
    }
    throw new Error(`${mnem} NO ,X MODE`);
  }

  if (parsed.kind === 'Y') {
    const useZp = forcedMode ? forcedMode === 'ZPY' : canZp && table.ZPY !== undefined;
    if (useZp && table.ZPY !== undefined) {
      return { mode: 'ZPY', opcode: table.ZPY, size: 2, bytes: [table.ZPY, (val ?? 0) & 0xff] };
    }
    if (table.ABSY !== undefined) {
      const v = val ?? 0;
      return { mode: 'ABSY', opcode: table.ABSY, size: 3, bytes: [table.ABSY, v & 0xff, (v >> 8) & 0xff] };
    }
    if (table.ZPY !== undefined) {
      return { mode: 'ZPY', opcode: table.ZPY, size: 2, bytes: [table.ZPY, (val ?? 0) & 0xff] };
    }
    throw new Error(`${mnem} NO ,Y MODE`);
  }

  // DIRECT (ZP or ABS)
  const useZp = forcedMode ? forcedMode === 'ZP' : canZp && table.ZP !== undefined;
  if (useZp && table.ZP !== undefined) {
    return { mode: 'ZP', opcode: table.ZP, size: 2, bytes: [table.ZP, (val ?? 0) & 0xff] };
  }
  if (table.ABS !== undefined) {
    const v = val ?? 0;
    return { mode: 'ABS', opcode: table.ABS, size: 3, bytes: [table.ABS, v & 0xff, (v >> 8) & 0xff] };
  }
  if (table.ZP !== undefined) {
    return { mode: 'ZP', opcode: table.ZP, size: 2, bytes: [table.ZP, (val ?? 0) & 0xff] };
  }
  throw new Error(`${mnem} BAD MODE`);
}

interface ParsedLine {
  lineNo: number;
  label?: string;
  op: string;
  arg: string;
  kind: 'EMPTY' | 'EQU' | 'ORG' | 'BYTE' | 'WORD' | 'FILL' | 'HEX' | 'SUBROUTINE' | 'INST';
  equName?: string;
  scopeId: number;
}

function parseHexBytes(arg: string): number[] {
  const clean = arg.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('ODD HEX DIGITS');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    out.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

function parseSourceLines(source: string): ParsedLine[] {
  const rawLines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out: ParsedLine[] = [];
  let scopeId = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    let line = stripComment(rawLines[i]).trim();
    if (!line) {
      out.push({ lineNo, op: '', arg: '', kind: 'EMPTY', scopeId });
      continue;
    }

    // * = $C000
    const starOrg = line.match(/^\*\s*=\s*(.+)$/);
    if (starOrg) {
      out.push({ lineNo, op: 'ORG', arg: starOrg[1].trim(), kind: 'ORG', scopeId });
      continue;
    }

    // NAME = expr  or  NAME EQU expr
    const equMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|\bEQU\b)\s*(.+)$/i);
    if (equMatch) {
      out.push({
        lineNo,
        op: 'EQU',
        equName: equMatch[1].toUpperCase(),
        arg: equMatch[2].trim(),
        kind: 'EQU',
        scopeId,
      });
      continue;
    }

    // DASM colonless "LABEL SUBROUTINE"
    const subLine = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+SUBROUTINE\b(.*)$/i);
    if (subLine) {
      scopeId++;
      out.push({
        lineNo,
        label: subLine[1].toUpperCase(),
        op: 'SUBROUTINE',
        arg: subLine[2].trim(),
        kind: 'SUBROUTINE',
        scopeId,
      });
      continue;
    }

    // Optional label:  foo:  or  .local:  or  foo: LDA #1
    let label: string | undefined;
    const colonLabel = line.match(/^([A-Za-z_.][A-Za-z0-9_.]*):(.*)$/);
    if (colonLabel) {
      label = colonLabel[1].toUpperCase();
      line = colonLabel[2].trim();
      if (!line) {
        out.push({ lineNo, label, op: '', arg: '', kind: 'EMPTY', scopeId });
        continue;
      }
    }

    // Split first token (allow dots inside DASM directives like DC.B / DC.W / DS.B / STA.W)
    const tokMatch = line.match(/^([.!A-Za-z_][A-Za-z0-9_.]*)\s*(.*)$/);
    if (!tokMatch) {
      out.push({ lineNo, label, op: line.toUpperCase(), arg: '', kind: 'INST', scopeId });
      continue;
    }

    const opRaw = tokMatch[1].toUpperCase();
    const arg = tokMatch[2].trim();
    const opClean = opRaw.replace(/^[.!]/, '');

    if (opClean === 'SUBROUTINE') {
      scopeId++;
      out.push({ lineNo, label, op: 'SUBROUTINE', arg, kind: 'SUBROUTINE', scopeId });
    } else if (opClean === 'PROCESSOR' || opClean === 'SEG' || opClean === 'SEG.U' || opClean === 'LIST' || opClean === 'NOLIST') {
      out.push({ lineNo, label, op: '', arg: '', kind: 'EMPTY', scopeId });
    } else if (opClean === 'ORG') {
      out.push({ lineNo, label, op: 'ORG', arg, kind: 'ORG', scopeId });
    } else if (opClean === 'HEX') {
      out.push({ lineNo, label, op: 'HEX', arg, kind: 'HEX', scopeId });
    } else if (opClean === 'BYTE' || opClean === 'DB' || opClean === 'DC.B' || opClean === 'TEXT' || opClean === 'PETSCII' || opClean === 'ASCII') {
      out.push({ lineNo, label, op: 'BYTE', arg, kind: 'BYTE', scopeId });
    } else if (opClean === 'WORD' || opClean === 'DW' || opClean === 'DC.W') {
      out.push({ lineNo, label, op: 'WORD', arg, kind: 'WORD', scopeId });
    } else if (opClean === 'FILL' || opClean === 'DS' || opClean === 'DS.B' || opClean === 'RES') {
      out.push({ lineNo, label, op: 'FILL', arg, kind: 'FILL', scopeId });
    } else {
      out.push({ lineNo, label, op: opRaw, arg, kind: 'INST', scopeId });
    }
  }

  return out;
}

/** Assemble a full 6502 assembly source listing in 2 passes. */
export function assemble6502(source: string, defaultOrg = 0xc000): AsmResult {
  const parsed = parseSourceLines(source);
  const symbols: Record<string, number> = {};
  const errors: string[] = [];
  // Track chosen addressing mode from pass 1 so pass 2 never drifts in size!
  const chosenModes = new Map<number, AddrMode>();

  // Pass 1: collect labels, constants, and instruction sizes
  let pc = defaultOrg & 0xffff;
  let entryAddr = -1;

  for (let idx = 0; idx < parsed.length; idx++) {
    const item = parsed[idx];
    try {
      if (item.label) {
        const key = item.label.startsWith('.') ? `@@${item.scopeId}${item.label}` : item.label;
        symbols[key] = pc;
      }
      if (item.kind === 'EMPTY' || item.kind === 'SUBROUTINE') continue;

      if (item.kind === 'EQU' && item.equName) {
        const v = evalExpr(item.arg, symbols, pc, false, item.scopeId);
        if (v !== null) symbols[item.equName] = v;
        continue;
      }

      if (item.kind === 'ORG') {
        const v = evalExpr(item.arg, symbols, pc, true, item.scopeId);
        if (v === null) throw new Error('BAD ORG');
        pc = v & 0xffff;
        if (entryAddr < 0) entryAddr = pc;
        continue;
      }

      if (entryAddr < 0) entryAddr = pc;

      if (item.kind === 'HEX') {
        const bytes = parseHexBytes(item.arg);
        pc = (pc + bytes.length) & 0xffff;
      } else if (item.kind === 'BYTE') {
        const parts = splitCsvRespectingQuotes(item.arg);
        for (const p of parts) {
          if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'") && p.length > 3)) {
            pc = (pc + p.length - 2) & 0xffff;
          } else {
            pc = (pc + 1) & 0xffff;
          }
        }
      } else if (item.kind === 'WORD') {
        const parts = splitCsvRespectingQuotes(item.arg);
        pc = (pc + parts.length * 2) & 0xffff;
      } else if (item.kind === 'FILL') {
        const parts = splitCsvRespectingQuotes(item.arg);
        const count = evalExpr(parts[0] ?? '0', symbols, pc, true, item.scopeId) ?? 0;
        pc = (pc + Math.max(0, count)) & 0xffff;
      } else if (item.kind === 'INST') {
        const enc = encodeInstruction(item.op, item.arg, symbols, pc, 1, undefined, item.scopeId);
        chosenModes.set(idx, enc.mode);
        pc = (pc + enc.size) & 0xffff;
      }
    } catch (err) {
      errors.push(`LINE ${item.lineNo}: ${(err as Error).message}`);
    }
  }

  // Resolve any forward EQU definitions now that labels are known
  for (const item of parsed) {
    if (item.kind === 'EQU' && item.equName && !(item.equName in symbols)) {
      try {
        const v = evalExpr(item.arg, symbols, defaultOrg, true, item.scopeId);
        if (v !== null) symbols[item.equName] = v;
      } catch (err) {
        errors.push(`LINE ${item.lineNo}: ${(err as Error).message}`);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, segments: [], entryAddr: defaultOrg, totalBytes: 0, symbols, errors };
  }

  // Pass 2: emit bytes
  const segments: AsmSegment[] = [];
  let curSeg: AsmSegment | null = null;
  pc = defaultOrg & 0xffff;

  const emitByte = (b: number) => {
    if (!curSeg || curSeg.org + curSeg.bytes.length !== pc) {
      curSeg = { org: pc, bytes: [] };
      segments.push(curSeg);
    }
    curSeg.bytes.push(b & 0xff);
    pc = (pc + 1) & 0xffff;
  };

  for (let idx = 0; idx < parsed.length; idx++) {
    const item = parsed[idx];
    if (item.kind === 'EMPTY' || item.kind === 'EQU' || item.kind === 'SUBROUTINE') continue;
    try {
      if (item.kind === 'ORG') {
        const v = evalExpr(item.arg, symbols, pc, true, item.scopeId) ?? defaultOrg;
        pc = v & 0xffff;
        curSeg = null;
        continue;
      }
      if (item.kind === 'HEX') {
        for (const b of parseHexBytes(item.arg)) emitByte(b);
      } else if (item.kind === 'BYTE') {
        const parts = splitCsvRespectingQuotes(item.arg);
        for (const p of parts) {
          if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'") && p.length > 3)) {
            const inner = p.slice(1, -1);
            for (let k = 0; k < inner.length; k++) emitByte(inner.charCodeAt(k));
          } else {
            const v = evalExpr(p, symbols, pc, true, item.scopeId) ?? 0;
            emitByte(v);
          }
        }
      } else if (item.kind === 'WORD') {
        const parts = splitCsvRespectingQuotes(item.arg);
        for (const p of parts) {
          const v = evalExpr(p, symbols, pc, true, item.scopeId) ?? 0;
          emitByte(v & 0xff);
          emitByte((v >> 8) & 0xff);
        }
      } else if (item.kind === 'FILL') {
        const parts = splitCsvRespectingQuotes(item.arg);
        const count = evalExpr(parts[0] ?? '0', symbols, pc, true, item.scopeId) ?? 0;
        const fillVal = parts[1] ? (evalExpr(parts[1], symbols, pc, true, item.scopeId) ?? 0) : 0;
        for (let k = 0; k < count; k++) emitByte(fillVal);
      } else if (item.kind === 'INST') {
        const enc = encodeInstruction(item.op, item.arg, symbols, pc, 2, chosenModes.get(idx), item.scopeId);
        for (const b of enc.bytes) emitByte(b);
      }
    } catch (err) {
      errors.push(`LINE ${item.lineNo}: ${(err as Error).message}`);
    }
  }

  const totalBytes = segments.reduce((sum, s) => sum + s.bytes.length, 0);
  // Auto-detect authentic C64 entry vectors:
  // 1) Ultimax / 6502 RESET vector at $FFFC/$FFFD
  // 2) Standard $8000 "CBM80" cartridge autostart header ($C3 $C2 $CD $38 $30 at $8004..$8008)
  let resolvedEntry = entryAddr < 0 ? defaultOrg : entryAddr;
  for (const seg of segments) {
    if (
      seg.org === 0x8000 &&
      seg.bytes.length >= 9 &&
      seg.bytes[4] === 0xc3 &&
      seg.bytes[5] === 0xc2 &&
      seg.bytes[6] === 0xcd &&
      seg.bytes[7] === 0x38 &&
      seg.bytes[8] === 0x30
    ) {
      const coldStart = seg.bytes[0] | (seg.bytes[1] << 8);
      if (coldStart >= 0x8009) resolvedEntry = coldStart;
    }
    if (seg.org <= 0xfffc && seg.org + seg.bytes.length >= 0xfffe) {
      const lo = seg.bytes[0xfffc - seg.org];
      const hi = seg.bytes[0xfffd - seg.org];
      const resetVec = lo | (hi << 8);
      if (resetVec >= 0x0800) resolvedEntry = resetVec;
    }
  }
  return {
    ok: errors.length === 0,
    segments,
    entryAddr: resolvedEntry,
    totalBytes,
    symbols,
    errors,
  };
}

/** Assemble a single 6502 instruction at `addr` (for interactive Monitor `A C000 LDA #$01`). */
export function assembleSingleLine(
  addr: number,
  instruction: string,
  symbols: Record<string, number> = {},
): { ok: true; bytes: number[] } | { ok: false; error: string } {
  const clean = stripComment(instruction).trim();
  const m = clean.match(/^([A-Za-z]{3})\s*(.*)$/);
  if (!m) return { ok: false, error: 'SYNTAX' };
  const mnem = m[1].toUpperCase();
  const arg = m[2].trim();
  try {
    const enc = encodeInstruction(mnem, arg, symbols, addr & 0xffff, 2);
    return { ok: true, bytes: enc.bytes };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Disassemble one instruction at `addr` from 64KB RAM. */
export function disassembleAt(
  ram: Uint8Array,
  addr: number,
): { text: string; bytes: number[]; size: number } {
  const a = addr & 0xffff;
  const op = ram[a];
  const info = DISASM_TABLE[op];
  const h2 = (n: number) => (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
  const h4 = (n: number) => (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');

  if (!info) {
    return { text: `??? ($${h2(op)})`, bytes: [op], size: 1 };
  }

  const size = MODE_SIZE[info.mode];
  const b1 = ram[(a + 1) & 0xffff];
  const b2 = ram[(a + 2) & 0xffff];
  const word = b1 | (b2 << 8);
  const bytes = size === 1 ? [op] : size === 2 ? [op, b1] : [op, b1, b2];

  let operand = '';
  switch (info.mode) {
    case 'IMP': operand = ''; break;
    case 'ACC': operand = ' A'; break;
    case 'IMM': operand = ` #$${h2(b1)}`; break;
    case 'ZP': operand = ` $${h2(b1)}`; break;
    case 'ZPX': operand = ` $${h2(b1)},X`; break;
    case 'ZPY': operand = ` $${h2(b1)},Y`; break;
    case 'ABS': operand = ` $${h4(word)}`; break;
    case 'ABSX': operand = ` $${h4(word)},X`; break;
    case 'ABSY': operand = ` $${h4(word)},Y`; break;
    case 'IND': operand = ` ($${h4(word)})`; break;
    case 'INDX': operand = ` ($${h2(b1)},X)`; break;
    case 'INDY': operand = ` ($${h2(b1)}),Y`; break;
    case 'REL': {
      const off = b1 < 0x80 ? b1 : b1 - 256;
      const target = (a + 2 + off) & 0xffff;
      operand = ` $${h4(target)}`;
      break;
    }
  }

  return { text: `${info.mnem}${operand}`, bytes, size };
}

/** Heuristic to detect pasted multi-line 6502 assembly source vs BASIC V2 source. */
export function looksLike6502Assembly(text: string): boolean {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => stripComment(l).trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return false;

  // If lines start with BASIC line numbers (e.g. "10 PRINT ..."), it's BASIC
  let numbered = 0;
  let asmHits = 0;
  for (const line of lines) {
    if (/^\d+\s+/.test(line)) {
      numbered++;
      continue;
    }
    if (/^\*\s*=|^\.?(ORG|BYTE|WORD|DB|DW|DC\.B|DC\.W|DS\.B|HEX|TEXT|FILL|PROCESSOR|SUBROUTINE)\b/i.test(line)) {
      asmHits += 2;
      continue;
    }
    const strippedLabel = line.replace(/^[A-Za-z_.][A-Za-z0-9_.]*:\s*/, '');
    const firstTok = (strippedLabel.split(/\s+/)[0]?.toUpperCase() ?? '').replace(/\.(W|B|Z)$/, '');
    if (MNEMONIC_SET.has(firstTok)) {
      asmHits++;
    }
  }
  return numbered === 0 && asmHits >= 2;
}
