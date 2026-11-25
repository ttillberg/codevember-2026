// Authentic MOS 6502 / 6510 CPU emulator for the Day 22 Commodore 64.
// Supports all 56 official instructions, all 13 addressing modes, BCD arithmetic,
// cycle counting for raster timing, and KERNAL / return-to-BASIC traps.

export const FLAG_C = 0x01; // Carry
export const FLAG_Z = 0x02; // Zero
export const FLAG_I = 0x04; // Interrupt Disable
export const FLAG_D = 0x08; // Decimal Mode
export const FLAG_B = 0x10; // Break
export const FLAG_U = 0x20; // Unused (always 1)
export const FLAG_V = 0x40; // Overflow
export const FLAG_N = 0x80; // Negative

/** Return address pushed onto stack by SYS so RTS returns cleanly to BASIC. */
export const SYS_RETURN_ADDR = 0xfff9;

export interface CpuBus {
  read(addr: number): number;
  write(addr: number, val: number): void;
  /**
   * Optional KERNAL trap hook called before fetching opcode at `pc >= 0xe000`.
   * Return true if the trap handled the routine (and updated PC/registers).
   */
  kernalTrap?(pc: number, cpu: Cpu6502): boolean;
}

export type CpuHaltReason = 'none' | 'rts' | 'brk' | 'jam';

export class Cpu6502 {
  a = 0;
  x = 0;
  y = 0;
  sp = 0xff;
  pc = 0xc000;
  p = FLAG_U | FLAG_I;

  cycles = 0;
  halted = false;
  haltReason: CpuHaltReason = 'none';
  lastIllegalOpcode = 0;

  private readonly bus: CpuBus;

  constructor(bus: CpuBus) {
    this.bus = bus;
  }

  reset(startPc = 0xc000) {
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xff;
    this.p = FLAG_U | FLAG_I;
    this.pc = startPc & 0xffff;
    this.cycles = 0;
    this.halted = false;
    this.haltReason = 'none';
  }

  /** Prepare CPU to execute a machine-language routine via SYS addr. */
  callSys(addr: number) {
    this.halted = false;
    this.haltReason = 'none';
    this.sp = 0xff;
    // Push SYS_RETURN_ADDR - 1 so an RTS from the user routine lands at SYS_RETURN_ADDR
    const ret = (SYS_RETURN_ADDR - 1) & 0xffff;
    this.push((ret >> 8) & 0xff);
    this.push(ret & 0xff);
    this.pc = addr & 0xffff;
  }

  read(addr: number): number {
    return this.bus.read(addr & 0xffff) & 0xff;
  }

  write(addr: number, val: number) {
    this.bus.write(addr & 0xffff, val & 0xff);
  }

  read16(addr: number): number {
    const lo = this.read(addr);
    const hi = this.read((addr + 1) & 0xffff);
    return lo | (hi << 8);
  }

  push(val: number) {
    this.write(0x0100 | this.sp, val & 0xff);
    this.sp = (this.sp - 1) & 0xff;
  }

  pull(): number {
    this.sp = (this.sp + 1) & 0xff;
    return this.read(0x0100 | this.sp);
  }

  /** Simulate an RTS (used by KERNAL trap stubs). */
  rts() {
    const lo = this.pull();
    const hi = this.pull();
    this.pc = (((hi << 8) | lo) + 1) & 0xffff;
  }

  setFlag(flag: number, cond: boolean) {
    if (cond) this.p |= flag;
    else this.p &= ~flag;
  }

  getFlag(flag: number): boolean {
    return (this.p & flag) !== 0;
  }

  private setZN(val: number): number {
    const v = val & 0xff;
    this.setFlag(FLAG_Z, v === 0);
    this.setFlag(FLAG_N, (v & 0x80) !== 0);
    return v;
  }

  private fetch8(): number {
    const v = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  private fetch16(): number {
    const lo = this.fetch8();
    const hi = this.fetch8();
    return lo | (hi << 8);
  }

  // Addressing mode helpers
  private addrZp(): number {
    return this.fetch8();
  }
  private addrZpX(): number {
    return (this.fetch8() + this.x) & 0xff;
  }
  private addrZpY(): number {
    return (this.fetch8() + this.y) & 0xff;
  }
  private addrAbs(): number {
    return this.fetch16();
  }
  private addrAbsX(): { addr: number; cross: boolean } {
    const base = this.fetch16();
    const addr = (base + this.x) & 0xffff;
    return { addr, cross: (base & 0xff00) !== (addr & 0xff00) };
  }
  private addrAbsY(): { addr: number; cross: boolean } {
    const base = this.fetch16();
    const addr = (base + this.y) & 0xffff;
    return { addr, cross: (base & 0xff00) !== (addr & 0xff00) };
  }
  private addrIndX(): number {
    const ptr = (this.fetch8() + this.x) & 0xff;
    const lo = this.read(ptr);
    const hi = this.read((ptr + 1) & 0xff);
    return lo | (hi << 8);
  }
  private addrIndY(): { addr: number; cross: boolean } {
    const ptr = this.fetch8();
    const lo = this.read(ptr);
    const hi = this.read((ptr + 1) & 0xff);
    const base = lo | (hi << 8);
    const addr = (base + this.y) & 0xffff;
    return { addr, cross: (base & 0xff00) !== (addr & 0xff00) };
  }

  private branch(cond: boolean): number {
    const rel = this.fetch8();
    if (!cond) return 2;
    const offset = rel < 0x80 ? rel : rel - 256;
    const oldPc = this.pc;
    this.pc = (this.pc + offset) & 0xffff;
    return (oldPc & 0xff00) !== (this.pc & 0xff00) ? 4 : 3;
  }

  private adc(val: number) {
    const c = this.getFlag(FLAG_C) ? 1 : 0;
    if (this.getFlag(FLAG_D)) {
      let lo = (this.a & 0x0f) + (val & 0x0f) + c;
      let hi = (this.a >> 4) + (val >> 4);
      if (lo > 9) {
        lo -= 10;
        hi++;
      }
      const binSum = this.a + val + c;
      this.setFlag(FLAG_Z, (binSum & 0xff) === 0);
      this.setFlag(FLAG_N, (hi & 0x08) !== 0);
      this.setFlag(FLAG_V, (~(this.a ^ val) & (this.a ^ ((hi << 4) | (lo & 0x0f))) & 0x80) !== 0);
      if (hi > 9) {
        hi -= 10;
        this.setFlag(FLAG_C, true);
      } else {
        this.setFlag(FLAG_C, false);
      }
      this.a = ((hi << 4) | (lo & 0x0f)) & 0xff;
    } else {
      const sum = this.a + val + c;
      const res = sum & 0xff;
      this.setFlag(FLAG_C, sum > 0xff);
      this.setFlag(FLAG_V, (~(this.a ^ val) & (this.a ^ res) & 0x80) !== 0);
      this.a = this.setZN(res);
    }
  }

  private sbc(val: number) {
    const borrow = this.getFlag(FLAG_C) ? 0 : 1;
    if (this.getFlag(FLAG_D)) {
      let lo = (this.a & 0x0f) - (val & 0x0f) - borrow;
      let hi = (this.a >> 4) - (val >> 4);
      if (lo < 0) {
        lo += 10;
        hi--;
      }
      const binDiff = this.a - val - borrow;
      this.setFlag(FLAG_V, ((this.a ^ val) & (this.a ^ (binDiff & 0xff)) & 0x80) !== 0);
      this.setFlag(FLAG_Z, (binDiff & 0xff) === 0);
      this.setFlag(FLAG_N, (binDiff & 0x80) !== 0);
      if (hi < 0) {
        hi += 10;
        this.setFlag(FLAG_C, false);
      } else {
        this.setFlag(FLAG_C, true);
      }
      this.a = ((hi << 4) | (lo & 0x0f)) & 0xff;
    } else {
      this.adc(val ^ 0xff);
    }
  }

  private cmp(reg: number, val: number) {
    const diff = reg - val;
    this.setFlag(FLAG_C, reg >= val);
    this.setZN(diff);
  }

  private bit(val: number) {
    this.setFlag(FLAG_Z, (this.a & val) === 0);
    this.setFlag(FLAG_N, (val & 0x80) !== 0);
    this.setFlag(FLAG_V, (val & 0x40) !== 0);
  }

  private aslVal(val: number): number {
    this.setFlag(FLAG_C, (val & 0x80) !== 0);
    return this.setZN(val << 1);
  }

  private lsrVal(val: number): number {
    this.setFlag(FLAG_C, (val & 0x01) !== 0);
    return this.setZN(val >>> 1);
  }

  private rolVal(val: number): number {
    const oldC = this.getFlag(FLAG_C) ? 1 : 0;
    this.setFlag(FLAG_C, (val & 0x80) !== 0);
    return this.setZN((val << 1) | oldC);
  }

  private rorVal(val: number): number {
    const oldC = this.getFlag(FLAG_C) ? 0x80 : 0;
    this.setFlag(FLAG_C, (val & 0x01) !== 0);
    return this.setZN((val >>> 1) | oldC);
  }

  /** Execute one 6502 instruction and return its cycle count. */
  step(): number {
    if (this.halted) return 0;

    if (this.pc === SYS_RETURN_ADDR) {
      this.halted = true;
      this.haltReason = 'rts';
      return 0;
    }

    if (this.pc >= 0xe000 && this.bus.kernalTrap?.(this.pc, this)) {
      this.cycles += 12;
      return 12;
    }

    const op = this.fetch8();
    let cyc = 2;

    switch (op) {
      // ---- LDA ----
      case 0xa9: this.a = this.setZN(this.fetch8()); cyc = 2; break;
      case 0xa5: this.a = this.setZN(this.read(this.addrZp())); cyc = 3; break;
      case 0xb5: this.a = this.setZN(this.read(this.addrZpX())); cyc = 4; break;
      case 0xad: this.a = this.setZN(this.read(this.addrAbs())); cyc = 4; break;
      case 0xbd: { const { addr, cross } = this.addrAbsX(); this.a = this.setZN(this.read(addr)); cyc = cross ? 5 : 4; break; }
      case 0xb9: { const { addr, cross } = this.addrAbsY(); this.a = this.setZN(this.read(addr)); cyc = cross ? 5 : 4; break; }
      case 0xa1: this.a = this.setZN(this.read(this.addrIndX())); cyc = 6; break;
      case 0xb1: { const { addr, cross } = this.addrIndY(); this.a = this.setZN(this.read(addr)); cyc = cross ? 6 : 5; break; }

      // ---- LDX ----
      case 0xa2: this.x = this.setZN(this.fetch8()); cyc = 2; break;
      case 0xa6: this.x = this.setZN(this.read(this.addrZp())); cyc = 3; break;
      case 0xb6: this.x = this.setZN(this.read(this.addrZpY())); cyc = 4; break;
      case 0xae: this.x = this.setZN(this.read(this.addrAbs())); cyc = 4; break;
      case 0xbe: { const { addr, cross } = this.addrAbsY(); this.x = this.setZN(this.read(addr)); cyc = cross ? 5 : 4; break; }

      // ---- LDY ----
      case 0xa0: this.y = this.setZN(this.fetch8()); cyc = 2; break;
      case 0xa4: this.y = this.setZN(this.read(this.addrZp())); cyc = 3; break;
      case 0xb4: this.y = this.setZN(this.read(this.addrZpX())); cyc = 4; break;
      case 0xac: this.y = this.setZN(this.read(this.addrAbs())); cyc = 4; break;
      case 0xbc: { const { addr, cross } = this.addrAbsX(); this.y = this.setZN(this.read(addr)); cyc = cross ? 5 : 4; break; }

      // ---- STA ----
      case 0x85: this.write(this.addrZp(), this.a); cyc = 3; break;
      case 0x95: this.write(this.addrZpX(), this.a); cyc = 4; break;
      case 0x8d: this.write(this.addrAbs(), this.a); cyc = 4; break;
      case 0x9d: this.write(this.addrAbsX().addr, this.a); cyc = 5; break;
      case 0x99: this.write(this.addrAbsY().addr, this.a); cyc = 5; break;
      case 0x81: this.write(this.addrIndX(), this.a); cyc = 6; break;
      case 0x91: this.write(this.addrIndY().addr, this.a); cyc = 6; break;

      // ---- STX ----
      case 0x86: this.write(this.addrZp(), this.x); cyc = 3; break;
      case 0x96: this.write(this.addrZpY(), this.x); cyc = 4; break;
      case 0x8e: this.write(this.addrAbs(), this.x); cyc = 4; break;

      // ---- STY ----
      case 0x84: this.write(this.addrZp(), this.y); cyc = 3; break;
      case 0x94: this.write(this.addrZpX(), this.y); cyc = 4; break;
      case 0x8c: this.write(this.addrAbs(), this.y); cyc = 4; break;

      // ---- Transfers ----
      case 0xaa: this.x = this.setZN(this.a); cyc = 2; break; // TAX
      case 0x8a: this.a = this.setZN(this.x); cyc = 2; break; // TXA
      case 0xa8: this.y = this.setZN(this.a); cyc = 2; break; // TAY
      case 0x98: this.a = this.setZN(this.y); cyc = 2; break; // TYA
      case 0xba: this.x = this.setZN(this.sp); cyc = 2; break; // TSX
      case 0x9a: this.sp = this.x; cyc = 2; break; // TXS

      // ---- Stack ----
      case 0x48: this.push(this.a); cyc = 3; break; // PHA
      case 0x68: this.a = this.setZN(this.pull()); cyc = 4; break; // PLA
      case 0x08: this.push(this.p | FLAG_B | FLAG_U); cyc = 3; break; // PHP
      case 0x28: this.p = (this.pull() & ~FLAG_B) | FLAG_U; cyc = 4; break; // PLP

      // ---- Logical AND ----
      case 0x29: this.a = this.setZN(this.a & this.fetch8()); cyc = 2; break;
      case 0x25: this.a = this.setZN(this.a & this.read(this.addrZp())); cyc = 3; break;
      case 0x35: this.a = this.setZN(this.a & this.read(this.addrZpX())); cyc = 4; break;
      case 0x2d: this.a = this.setZN(this.a & this.read(this.addrAbs())); cyc = 4; break;
      case 0x3d: { const { addr, cross } = this.addrAbsX(); this.a = this.setZN(this.a & this.read(addr)); cyc = cross ? 5 : 4; break; }
      case 0x39: { const { addr, cross } = this.addrAbsY(); this.a = this.setZN(this.a & this.read(addr)); cyc = cross ? 5 : 4; break; }
      case 0x21: this.a = this.setZN(this.a & this.read(this.addrIndX())); cyc = 6; break;
      case 0x31: { const { addr, cross } = this.addrIndY(); this.a = this.setZN(this.a & this.read(addr)); cyc = cross ? 6 : 5; break; }

      // ---- Logical ORA ----
      case 0x09: this.a = this.setZN(this.a | this.fetch8()); cyc = 2; break;
      case 0x05: this.a = this.setZN(this.a | this.read(this.addrZp())); cyc = 3; break;
      case 0x15: this.a = this.setZN(this.a | this.read(this.addrZpX())); cyc = 4; break;
      case 0x0d: this.a = this.setZN(this.a | this.read(this.addrAbs())); cyc = 4; break;
      case 0x1d: { const { addr, cross } = this.addrAbsX(); this.a = this.setZN(this.a | this.read(addr)); cyc = cross ? 5 : 4; break; }
      case 0x19: { const { addr, cross } = this.addrAbsY(); this.a = this.setZN(this.a | this.read(addr)); cyc = cross ? 5 : 4; break; }
      case 0x01: this.a = this.setZN(this.a | this.read(this.addrIndX())); cyc = 6; break;
      case 0x11: { const { addr, cross } = this.addrIndY(); this.a = this.setZN(this.a | this.read(addr)); cyc = cross ? 6 : 5; break; }

      // ---- Logical EOR ----
      case 0x49: this.a = this.setZN(this.a ^ this.fetch8()); cyc = 2; break;
      case 0x45: this.a = this.setZN(this.a ^ this.read(this.addrZp())); cyc = 3; break;
      case 0x55: this.a = this.setZN(this.a ^ this.read(this.addrZpX())); cyc = 4; break;
      case 0x4d: this.a = this.setZN(this.a ^ this.read(this.addrAbs())); cyc = 4; break;
      case 0x5d: { const { addr, cross } = this.addrAbsX(); this.a = this.setZN(this.a ^ this.read(addr)); cyc = cross ? 5 : 4; break; }
      case 0x59: { const { addr, cross } = this.addrAbsY(); this.a = this.setZN(this.a ^ this.read(addr)); cyc = cross ? 5 : 4; break; }
      case 0x41: this.a = this.setZN(this.a ^ this.read(this.addrIndX())); cyc = 6; break;
      case 0x51: { const { addr, cross } = this.addrIndY(); this.a = this.setZN(this.a ^ this.read(addr)); cyc = cross ? 6 : 5; break; }

      // ---- BIT ----
      case 0x24: this.bit(this.read(this.addrZp())); cyc = 3; break;
      case 0x2c: this.bit(this.read(this.addrAbs())); cyc = 4; break;

      // ---- ADC ----
      case 0x69: this.adc(this.fetch8()); cyc = 2; break;
      case 0x65: this.adc(this.read(this.addrZp())); cyc = 3; break;
      case 0x75: this.adc(this.read(this.addrZpX())); cyc = 4; break;
      case 0x6d: this.adc(this.read(this.addrAbs())); cyc = 4; break;
      case 0x7d: { const { addr, cross } = this.addrAbsX(); this.adc(this.read(addr)); cyc = cross ? 5 : 4; break; }
      case 0x79: { const { addr, cross } = this.addrAbsY(); this.adc(this.read(addr)); cyc = cross ? 5 : 4; break; }
      case 0x61: this.adc(this.read(this.addrIndX())); cyc = 6; break;
      case 0x71: { const { addr, cross } = this.addrIndY(); this.adc(this.read(addr)); cyc = cross ? 6 : 5; break; }

      // ---- SBC ----
      case 0xe9: this.sbc(this.fetch8()); cyc = 2; break;
      case 0xe5: this.sbc(this.read(this.addrZp())); cyc = 3; break;
      case 0xf5: this.sbc(this.read(this.addrZpX())); cyc = 4; break;
      case 0xed: this.sbc(this.read(this.addrAbs())); cyc = 4; break;
      case 0xfd: { const { addr, cross } = this.addrAbsX(); this.sbc(this.read(addr)); cyc = cross ? 5 : 4; break; }
      case 0xf9: { const { addr, cross } = this.addrAbsY(); this.sbc(this.read(addr)); cyc = cross ? 5 : 4; break; }
      case 0xe1: this.sbc(this.read(this.addrIndX())); cyc = 6; break;
      case 0xf1: { const { addr, cross } = this.addrIndY(); this.sbc(this.read(addr)); cyc = cross ? 6 : 5; break; }

      // ---- CMP ----
      case 0xc9: this.cmp(this.a, this.fetch8()); cyc = 2; break;
      case 0xc5: this.cmp(this.a, this.read(this.addrZp())); cyc = 3; break;
      case 0xd5: this.cmp(this.a, this.read(this.addrZpX())); cyc = 4; break;
      case 0xcd: this.cmp(this.a, this.read(this.addrAbs())); cyc = 4; break;
      case 0xdd: { const { addr, cross } = this.addrAbsX(); this.cmp(this.a, this.read(addr)); cyc = cross ? 5 : 4; break; }
      case 0xd9: { const { addr, cross } = this.addrAbsY(); this.cmp(this.a, this.read(addr)); cyc = cross ? 5 : 4; break; }
      case 0xc1: this.cmp(this.a, this.read(this.addrIndX())); cyc = 6; break;
      case 0xd1: { const { addr, cross } = this.addrIndY(); this.cmp(this.a, this.read(addr)); cyc = cross ? 6 : 5; break; }

      // ---- CPX ----
      case 0xe0: this.cmp(this.x, this.fetch8()); cyc = 2; break;
      case 0xe4: this.cmp(this.x, this.read(this.addrZp())); cyc = 3; break;
      case 0xec: this.cmp(this.x, this.read(this.addrAbs())); cyc = 4; break;

      // ---- CPY ----
      case 0xc0: this.cmp(this.y, this.fetch8()); cyc = 2; break;
      case 0xc4: this.cmp(this.y, this.read(this.addrZp())); cyc = 3; break;
      case 0xcc: this.cmp(this.y, this.read(this.addrAbs())); cyc = 4; break;

      // ---- INC / DEC ----
      case 0xe6: { const a = this.addrZp(); this.write(a, this.setZN(this.read(a) + 1)); cyc = 5; break; }
      case 0xf6: { const a = this.addrZpX(); this.write(a, this.setZN(this.read(a) + 1)); cyc = 6; break; }
      case 0xee: { const a = this.addrAbs(); this.write(a, this.setZN(this.read(a) + 1)); cyc = 6; break; }
      case 0xfe: { const a = this.addrAbsX().addr; this.write(a, this.setZN(this.read(a) + 1)); cyc = 7; break; }

      case 0xc6: { const a = this.addrZp(); this.write(a, this.setZN(this.read(a) - 1)); cyc = 5; break; }
      case 0xd6: { const a = this.addrZpX(); this.write(a, this.setZN(this.read(a) - 1)); cyc = 6; break; }
      case 0xce: { const a = this.addrAbs(); this.write(a, this.setZN(this.read(a) - 1)); cyc = 6; break; }
      case 0xde: { const a = this.addrAbsX().addr; this.write(a, this.setZN(this.read(a) - 1)); cyc = 7; break; }

      case 0xe8: this.x = this.setZN(this.x + 1); cyc = 2; break; // INX
      case 0xca: this.x = this.setZN(this.x - 1); cyc = 2; break; // DEX
      case 0xc8: this.y = this.setZN(this.y + 1); cyc = 2; break; // INY
      case 0x88: this.y = this.setZN(this.y - 1); cyc = 2; break; // DEY

      // ---- Shifts & Rotates ----
      case 0x0a: this.a = this.aslVal(this.a); cyc = 2; break;
      case 0x06: { const a = this.addrZp(); this.write(a, this.aslVal(this.read(a))); cyc = 5; break; }
      case 0x16: { const a = this.addrZpX(); this.write(a, this.aslVal(this.read(a))); cyc = 6; break; }
      case 0x0e: { const a = this.addrAbs(); this.write(a, this.aslVal(this.read(a))); cyc = 6; break; }
      case 0x1e: { const a = this.addrAbsX().addr; this.write(a, this.aslVal(this.read(a))); cyc = 7; break; }

      case 0x4a: this.a = this.lsrVal(this.a); cyc = 2; break;
      case 0x46: { const a = this.addrZp(); this.write(a, this.lsrVal(this.read(a))); cyc = 5; break; }
      case 0x56: { const a = this.addrZpX(); this.write(a, this.lsrVal(this.read(a))); cyc = 6; break; }
      case 0x4e: { const a = this.addrAbs(); this.write(a, this.lsrVal(this.read(a))); cyc = 6; break; }
      case 0x5e: { const a = this.addrAbsX().addr; this.write(a, this.lsrVal(this.read(a))); cyc = 7; break; }

      case 0x2a: this.a = this.rolVal(this.a); cyc = 2; break;
      case 0x26: { const a = this.addrZp(); this.write(a, this.rolVal(this.read(a))); cyc = 5; break; }
      case 0x36: { const a = this.addrZpX(); this.write(a, this.rolVal(this.read(a))); cyc = 6; break; }
      case 0x2e: { const a = this.addrAbs(); this.write(a, this.rolVal(this.read(a))); cyc = 6; break; }
      case 0x3e: { const a = this.addrAbsX().addr; this.write(a, this.rolVal(this.read(a))); cyc = 7; break; }

      case 0x6a: this.a = this.rorVal(this.a); cyc = 2; break;
      case 0x66: { const a = this.addrZp(); this.write(a, this.rorVal(this.read(a))); cyc = 5; break; }
      case 0x76: { const a = this.addrZpX(); this.write(a, this.rorVal(this.read(a))); cyc = 6; break; }
      case 0x6e: { const a = this.addrAbs(); this.write(a, this.rorVal(this.read(a))); cyc = 6; break; }
      case 0x7e: { const a = this.addrAbsX().addr; this.write(a, this.rorVal(this.read(a))); cyc = 7; break; }

      // ---- Jumps & Subroutines ----
      case 0x4c: this.pc = this.fetch16(); cyc = 3; break; // JMP abs
      case 0x6c: { // JMP (abs) with authentic 6502 page-wrap
        const ptr = this.fetch16();
        const lo = this.read(ptr);
        const hi = this.read((ptr & 0xff00) | ((ptr + 1) & 0xff));
        this.pc = lo | (hi << 8);
        cyc = 5;
        break;
      }
      case 0x20: { // JSR abs
        const target = this.fetch16();
        const ret = (this.pc - 1) & 0xffff;
        this.push((ret >> 8) & 0xff);
        this.push(ret & 0xff);
        this.pc = target;
        cyc = 6;
        break;
      }
      case 0x60: { // RTS
        this.rts();
        cyc = 6;
        break;
      }
      case 0x40: { // RTI
        this.p = (this.pull() & ~FLAG_B) | FLAG_U;
        const lo = this.pull();
        const hi = this.pull();
        this.pc = lo | (hi << 8);
        cyc = 6;
        break;
      }

      // ---- Branches ----
      case 0x10: cyc = this.branch(!this.getFlag(FLAG_N)); break; // BPL
      case 0x30: cyc = this.branch(this.getFlag(FLAG_N)); break;  // BMI
      case 0x50: cyc = this.branch(!this.getFlag(FLAG_V)); break; // BVC
      case 0x70: cyc = this.branch(this.getFlag(FLAG_V)); break;  // BVS
      case 0x90: cyc = this.branch(!this.getFlag(FLAG_C)); break; // BCC
      case 0xb0: cyc = this.branch(this.getFlag(FLAG_C)); break;  // BCS
      case 0xd0: cyc = this.branch(!this.getFlag(FLAG_Z)); break; // BNE
      case 0xf0: cyc = this.branch(this.getFlag(FLAG_Z)); break;  // BEQ

      // ---- Flags ----
      case 0x18: this.setFlag(FLAG_C, false); cyc = 2; break; // CLC
      case 0x38: this.setFlag(FLAG_C, true); cyc = 2; break;  // SEC
      case 0x58: this.setFlag(FLAG_I, false); cyc = 2; break; // CLI
      case 0x78: this.setFlag(FLAG_I, true); cyc = 2; break;  // SEI
      case 0xb8: this.setFlag(FLAG_V, false); cyc = 2; break; // CLV
      case 0xd8: this.setFlag(FLAG_D, false); cyc = 2; break; // CLD
      case 0xf8: this.setFlag(FLAG_D, true); cyc = 2; break;  // SED

      // ---- System ----
      case 0xea: cyc = 2; break; // NOP
      case 0x00: { // BRK -> break cleanly into monitor / BASIC with register dump
        this.pc = (this.pc + 1) & 0xffff;
        this.halted = true;
        this.haltReason = 'brk';
        cyc = 7;
        break;
      }

      // ---- Common MOS 6502/6510 Undocumented Opcodes ----
      // LAX (LDA + LDX)
      case 0xa7: { const v = this.read(this.addrZp()); this.a = this.x = this.setZN(v); cyc = 3; break; }
      case 0xb7: { const v = this.read(this.addrZpY()); this.a = this.x = this.setZN(v); cyc = 4; break; }
      case 0xaf: { const v = this.read(this.addrAbs()); this.a = this.x = this.setZN(v); cyc = 4; break; }
      case 0xbf: { const { addr, cross } = this.addrAbsY(); const v = this.read(addr); this.a = this.x = this.setZN(v); cyc = cross ? 5 : 4; break; }
      case 0xa3: { const v = this.read(this.addrIndX()); this.a = this.x = this.setZN(v); cyc = 6; break; }
      case 0xb3: { const { addr, cross } = this.addrIndY(); const v = this.read(addr); this.a = this.x = this.setZN(v); cyc = cross ? 6 : 5; break; }
      case 0xab: { const v = this.fetch8(); this.a = this.x = this.setZN(v); cyc = 2; break; }
      // SAX (store A & X)
      case 0x87: this.write(this.addrZp(), this.a & this.x); cyc = 3; break;
      case 0x97: this.write(this.addrZpY(), this.a & this.x); cyc = 4; break;
      case 0x8f: this.write(this.addrAbs(), this.a & this.x); cyc = 4; break;
      case 0x83: this.write(this.addrIndX(), this.a & this.x); cyc = 6; break;
      // DCP (DEC + CMP)
      case 0xc7: { const a = this.addrZp(); const v = (this.read(a) - 1) & 0xff; this.write(a, v); this.cmp(this.a, v); cyc = 5; break; }
      case 0xd7: { const a = this.addrZpX(); const v = (this.read(a) - 1) & 0xff; this.write(a, v); this.cmp(this.a, v); cyc = 6; break; }
      case 0xcf: { const a = this.addrAbs(); const v = (this.read(a) - 1) & 0xff; this.write(a, v); this.cmp(this.a, v); cyc = 6; break; }
      case 0xdf: { const a = this.addrAbsX().addr; const v = (this.read(a) - 1) & 0xff; this.write(a, v); this.cmp(this.a, v); cyc = 7; break; }
      case 0xdb: { const a = this.addrAbsY().addr; const v = (this.read(a) - 1) & 0xff; this.write(a, v); this.cmp(this.a, v); cyc = 7; break; }
      case 0xc3: { const a = this.addrIndX(); const v = (this.read(a) - 1) & 0xff; this.write(a, v); this.cmp(this.a, v); cyc = 8; break; }
      case 0xd3: { const a = this.addrIndY().addr; const v = (this.read(a) - 1) & 0xff; this.write(a, v); this.cmp(this.a, v); cyc = 8; break; }
      // ISB/ISC (INC + SBC)
      case 0xe7: { const a = this.addrZp(); const v = (this.read(a) + 1) & 0xff; this.write(a, v); this.sbc(v); cyc = 5; break; }
      case 0xf7: { const a = this.addrZpX(); const v = (this.read(a) + 1) & 0xff; this.write(a, v); this.sbc(v); cyc = 6; break; }
      case 0xef: { const a = this.addrAbs(); const v = (this.read(a) + 1) & 0xff; this.write(a, v); this.sbc(v); cyc = 6; break; }
      case 0xff: { const a = this.addrAbsX().addr; const v = (this.read(a) + 1) & 0xff; this.write(a, v); this.sbc(v); cyc = 7; break; }
      case 0xfb: { const a = this.addrAbsY().addr; const v = (this.read(a) + 1) & 0xff; this.write(a, v); this.sbc(v); cyc = 7; break; }
      case 0xe3: { const a = this.addrIndX(); const v = (this.read(a) + 1) & 0xff; this.write(a, v); this.sbc(v); cyc = 8; break; }
      case 0xf3: { const a = this.addrIndY().addr; const v = (this.read(a) + 1) & 0xff; this.write(a, v); this.sbc(v); cyc = 8; break; }
      // SLO (ASL + ORA)
      case 0x07: { const a = this.addrZp(); const v = this.aslVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a | v); cyc = 5; break; }
      case 0x17: { const a = this.addrZpX(); const v = this.aslVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a | v); cyc = 6; break; }
      case 0x0f: { const a = this.addrAbs(); const v = this.aslVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a | v); cyc = 6; break; }
      case 0x1f: { const a = this.addrAbsX().addr; const v = this.aslVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a | v); cyc = 7; break; }
      case 0x1b: { const a = this.addrAbsY().addr; const v = this.aslVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a | v); cyc = 7; break; }
      case 0x03: { const a = this.addrIndX(); const v = this.aslVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a | v); cyc = 8; break; }
      case 0x13: { const a = this.addrIndY().addr; const v = this.aslVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a | v); cyc = 8; break; }
      // RLA (ROL + AND)
      case 0x27: { const a = this.addrZp(); const v = this.rolVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a & v); cyc = 5; break; }
      case 0x37: { const a = this.addrZpX(); const v = this.rolVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a & v); cyc = 6; break; }
      case 0x2f: { const a = this.addrAbs(); const v = this.rolVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a & v); cyc = 6; break; }
      case 0x3f: { const a = this.addrAbsX().addr; const v = this.rolVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a & v); cyc = 7; break; }
      case 0x3b: { const a = this.addrAbsY().addr; const v = this.rolVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a & v); cyc = 7; break; }
      case 0x23: { const a = this.addrIndX(); const v = this.rolVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a & v); cyc = 8; break; }
      case 0x33: { const a = this.addrIndY().addr; const v = this.rolVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a & v); cyc = 8; break; }
      // SRE (LSR + EOR)
      case 0x47: { const a = this.addrZp(); const v = this.lsrVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a ^ v); cyc = 5; break; }
      case 0x57: { const a = this.addrZpX(); const v = this.lsrVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a ^ v); cyc = 6; break; }
      case 0x4f: { const a = this.addrAbs(); const v = this.lsrVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a ^ v); cyc = 6; break; }
      case 0x5f: { const a = this.addrAbsX().addr; const v = this.lsrVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a ^ v); cyc = 7; break; }
      case 0x5b: { const a = this.addrAbsY().addr; const v = this.lsrVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a ^ v); cyc = 7; break; }
      case 0x43: { const a = this.addrIndX(); const v = this.lsrVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a ^ v); cyc = 8; break; }
      case 0x53: { const a = this.addrIndY().addr; const v = this.lsrVal(this.read(a)); this.write(a, v); this.a = this.setZN(this.a ^ v); cyc = 8; break; }
      // RRA (ROR + ADC)
      case 0x67: { const a = this.addrZp(); const v = this.rorVal(this.read(a)); this.write(a, v); this.adc(v); cyc = 5; break; }
      case 0x77: { const a = this.addrZpX(); const v = this.rorVal(this.read(a)); this.write(a, v); this.adc(v); cyc = 6; break; }
      case 0x6f: { const a = this.addrAbs(); const v = this.rorVal(this.read(a)); this.write(a, v); this.adc(v); cyc = 6; break; }
      case 0x7f: { const a = this.addrAbsX().addr; const v = this.rorVal(this.read(a)); this.write(a, v); this.adc(v); cyc = 7; break; }
      case 0x7b: { const a = this.addrAbsY().addr; const v = this.rorVal(this.read(a)); this.write(a, v); this.adc(v); cyc = 7; break; }
      case 0x63: { const a = this.addrIndX(); const v = this.rorVal(this.read(a)); this.write(a, v); this.adc(v); cyc = 8; break; }
      case 0x73: { const a = this.addrIndY().addr; const v = this.rorVal(this.read(a)); this.write(a, v); this.adc(v); cyc = 8; break; }
      // SBX / AXS, ANC, ALR, ARR, USBC, multi-byte NOPs
      case 0xcb: { const v = this.fetch8(); const t = (this.a & this.x) - v; this.setFlag(FLAG_C, (this.a & this.x) >= v); this.x = this.setZN(t); cyc = 2; break; }
      case 0x0b: case 0x2b: { this.a = this.setZN(this.a & this.fetch8()); this.setFlag(FLAG_C, (this.a & 0x80) !== 0); cyc = 2; break; }
      case 0x4b: { this.a = this.lsrVal(this.a & this.fetch8()); cyc = 2; break; }
      case 0x6b: { this.a = this.rorVal(this.a & this.fetch8()); cyc = 2; break; }
      case 0xeb: { this.sbc(this.fetch8()); cyc = 2; break; }
      case 0x1a: case 0x3a: case 0x5a: case 0x7a: case 0xda: case 0xfa: cyc = 2; break;
      case 0x80: case 0x82: case 0x89: case 0xc2: case 0xe2: this.fetch8(); cyc = 2; break;
      case 0x04: case 0x44: case 0x64: this.fetch8(); cyc = 3; break;
      case 0x14: case 0x34: case 0x54: case 0x74: case 0xd4: case 0xf4: this.fetch8(); cyc = 4; break;
      case 0x0c: this.fetch16(); cyc = 4; break;
      case 0x1c: case 0x3c: case 0x5c: case 0x7c: case 0xdc: case 0xfc: this.fetch16(); cyc = 4; break;

      default: {
        // Unofficial / JAM opcode
        this.lastIllegalOpcode = op;
        this.halted = true;
        this.haltReason = 'jam';
        cyc = 2;
        break;
      }
    }

    this.cycles += cyc;
    return cyc;
  }

  /** Trigger a maskable 6502 IRQ (VIC-II raster or CIA1 Timer A) if I flag is clear. */
  irq(): boolean {
    if (this.halted || this.getFlag(FLAG_I)) return false;
    const hwVec = this.read16(0xfffe);
    const ramVec = this.read16(0x0314);
    if (!hwVec && !ramVec) return false;
    this.push((this.pc >> 8) & 0xff);
    this.push(this.pc & 0xff);
    this.push((this.p & ~FLAG_B) | FLAG_U);
    this.setFlag(FLAG_I, true);
    if (hwVec) {
      // Direct hardware 6502 IRQ vector ($FFFE/$FFFF): handler saves/restores A,X,Y itself
      this.pc = hwVec;
    } else {
      // Authentic C64 KERNAL $FF48 IRQ trampoline: pushes A, X, Y before jumping via ($0314)
      this.push(this.a);
      this.push(this.x);
      this.push(this.y);
      this.pc = ramVec;
    }
    this.cycles += 7;
    return true;
  }

  /** Trigger a non-maskable 6502 NMI (e.g. CIA2 timer interrupt) via $FFFA or C64 KERNAL $0318. */
  nmi(): boolean {
    if (this.halted) return false;
    const hwVec = this.read16(0xfffa);
    const ramVec = this.read16(0x0318);
    if (!hwVec && !ramVec) return false;
    this.push((this.pc >> 8) & 0xff);
    this.push(this.pc & 0xff);
    this.push((this.p & ~FLAG_B) | FLAG_U);
    this.setFlag(FLAG_I, true);
    if (hwVec) {
      this.pc = hwVec;
    } else {
      // Authentic C64 KERNAL $FE43 NMI trampoline: pushes A, X, Y before jumping via ($0318)
      this.push(this.a);
      this.push(this.x);
      this.push(this.y);
      this.pc = ramVec;
    }
    this.cycles += 7;
    return true;
  }

  /** Format CPU registers in classic Supermon64 style. */
  formatRegisters(): string {
    const h2 = (n: number) => (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
    const h4 = (n: number) => (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
    return `${h4(this.pc)}  ${h2(this.p)} ${h2(this.a)} ${h2(this.x)} ${h2(this.y)} ${h2(this.sp)}`;
  }
}
