// ── GPU Execution State (Wave32) ──

import {
  NUM_VGPRS, NUM_SGPRS, WAVE_WIDTH, VCC_LO, VCC_HI, M0_REG, NULL_REG, EXEC_LO, EXEC_HI,
} from '../isa/constants';

// Shared reinterpret buffers
const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

/** Local data share size per workgroup, in bytes. */
export const LDS_SIZE_BYTES = 64 * 1024;

export interface GPUStateSnapshot {
  vgprs: Uint32Array[];
  sgprs: Uint32Array;
  lds: Uint32Array;
  scc: number;
  pc: number;
  cycleCount: number;
}

export class GPUState {
  vgprs: Uint32Array[];  // Raw 32-bit storage per register per lane
  /**
   * Scalar register file indexed by operand encoding: s0–s105, VCC_LO/HI (106/107),
   * TTMP0–15 (108–123), M0 (124), NULL (125, always reads 0), EXEC_LO/HI (126/127).
   */
  sgprs: Uint32Array;
  lds: Uint32Array;      // 64 KB local data share, dword addressed
  scc: number;
  pc: number;            // Index of the next instruction to execute
  cycleCount: number;
  modifiedRegs: Set<string>;
  /** Highest VGPR index reached through M0-relative addressing (v_movrel*); -1 if none. */
  maxIndirectVgpr: number;

  constructor() {
    this.vgprs = [];
    this.sgprs = new Uint32Array(NUM_SGPRS);
    this.lds = new Uint32Array(LDS_SIZE_BYTES / 4);
    this.scc = 0;
    this.pc = 0;
    this.cycleCount = 0;
    this.modifiedRegs = new Set();
    this.maxIndirectVgpr = -1;

    for (let i = 0; i < NUM_VGPRS; i++) {
      this.vgprs.push(new Uint32Array(WAVE_WIDTH));
    }
    this.exec = 0xFFFFFFFF;
  }

  get exec(): number { return this.sgprs[EXEC_LO]; }
  set exec(value: number) { this.sgprs[EXEC_LO] = value >>> 0; }

  get vcc(): number { return this.sgprs[VCC_LO]; }
  set vcc(value: number) { this.sgprs[VCC_LO] = value >>> 0; }

  reset(): void {
    for (let i = 0; i < NUM_VGPRS; i++) {
      this.vgprs[i].fill(0);
    }
    this.sgprs.fill(0);
    this.lds.fill(0);
    this.exec = 0xFFFFFFFF;
    this.scc = 0;
    this.pc = 0;
    this.cycleCount = 0;
    this.maxIndirectVgpr = -1;
    this.modifiedRegs.clear();
  }

  snapshot(): GPUStateSnapshot {
    return {
      vgprs: this.vgprs.map((reg) => new Uint32Array(reg)),
      sgprs: new Uint32Array(this.sgprs),
      lds: new Uint32Array(this.lds),
      scc: this.scc,
      pc: this.pc,
      cycleCount: this.cycleCount,
    };
  }

  restore(snap: GPUStateSnapshot): void {
    for (let i = 0; i < NUM_VGPRS; i++) {
      this.vgprs[i].set(snap.vgprs[i]);
    }
    this.sgprs.set(snap.sgprs);
    this.lds.set(snap.lds);
    this.scc = snap.scc;
    this.pc = snap.pc;
    this.cycleCount = snap.cycleCount;
    this.modifiedRegs.clear();
  }

  /** Read raw 32-bit value from VGPR */
  readVGPR_u32(reg: number, lane: number): number {
    return this.vgprs[reg & 0xFF][lane];
  }

  /** Read VGPR as float (bitcast from u32) */
  readVGPR(reg: number, lane: number): number {
    _u32[0] = this.vgprs[reg & 0xFF][lane];
    return _f32[0];
  }

  /** Write raw 32-bit value to VGPR */
  writeVGPR_u32(reg: number, lane: number, value: number): void {
    this.vgprs[reg & 0xFF][lane] = value >>> 0;
    this.modifiedRegs.add(`v${reg & 0xFF}`);
  }

  /** Write float to VGPR (bitcast to u32 for storage) */
  writeVGPR(reg: number, lane: number, value: number): void {
    _f32[0] = value;
    this.vgprs[reg & 0xFF][lane] = _u32[0];
    this.modifiedRegs.add(`v${reg & 0xFF}`);
  }

  /** Read a scalar register by operand encoding (0–127). */
  readSGPR(reg: number): number {
    if (reg === NULL_REG || reg < 0 || reg >= NUM_SGPRS) return 0;
    return this.sgprs[reg];
  }

  /** Write a scalar register by operand encoding (0–127). Writes to NULL are discarded. */
  writeSGPR(reg: number, value: number): void {
    if (reg === NULL_REG || reg < 0 || reg >= NUM_SGPRS) return;
    this.sgprs[reg] = value >>> 0;
    this.modifiedRegs.add(scalarRegKey(reg));
  }

  /** Read an aligned 64-bit scalar register pair (e.g. s[0:1], VCC, EXEC). NULL reads as 0. */
  readSGPR64(reg: number): bigint {
    if (reg === NULL_REG) return 0n;
    return (BigInt(this.readSGPR(reg + 1)) << 32n) | BigInt(this.readSGPR(reg));
  }

  /** Write a 64-bit scalar register pair. Writes to NULL are discarded. */
  writeSGPR64(reg: number, value: bigint): void {
    if (reg === NULL_REG) return;
    this.writeSGPR(reg, Number(value & 0xFFFFFFFFn));
    this.writeSGPR(reg + 1, Number((value >> 32n) & 0xFFFFFFFFn));
  }
}

/** Key used in `modifiedRegs` for a scalar register encoding. */
export function scalarRegKey(reg: number): string {
  if (reg === VCC_LO || reg === VCC_HI) return 'VCC';
  if (reg === EXEC_LO || reg === EXEC_HI) return 'EXEC';
  if (reg === M0_REG) return 'M0';
  return `s${reg}`;
}
