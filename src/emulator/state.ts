// ── GPU Execution State (Wave32) ──

import { NUM_VGPRS, NUM_SGPRS, WAVE_WIDTH } from '../isa/constants';

// Shared reinterpret buffers
const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

export interface GPUStateSnapshot {
  vgprs: Uint32Array[];
  sgprs: Uint32Array;
  exec: number;
  vcc: number;
  scc: number;
  pc: number;
  cycleCount: number;
}

export class GPUState {
  vgprs: Uint32Array[];  // Raw 32-bit storage per register per lane
  sgprs: Uint32Array;
  exec: number;
  vcc: number;
  scc: number;
  pc: number;
  cycleCount: number;
  modifiedRegs: Set<string>;

  constructor() {
    this.vgprs = [];
    this.sgprs = new Uint32Array(NUM_SGPRS);
    this.exec = 0xFFFFFFFF;
    this.vcc = 0;
    this.scc = 0;
    this.pc = 0;
    this.cycleCount = 0;
    this.modifiedRegs = new Set();

    for (let i = 0; i < NUM_VGPRS; i++) {
      this.vgprs.push(new Uint32Array(WAVE_WIDTH));
    }
  }

  reset(): void {
    for (let i = 0; i < NUM_VGPRS; i++) {
      this.vgprs[i].fill(0);
    }
    this.sgprs.fill(0);
    this.exec = 0xFFFFFFFF;
    this.vcc = 0;
    this.scc = 0;
    this.pc = 0;
    this.cycleCount = 0;
    this.modifiedRegs.clear();
  }

  snapshot(): GPUStateSnapshot {
    return {
      vgprs: this.vgprs.map((reg) => new Uint32Array(reg)),
      sgprs: new Uint32Array(this.sgprs),
      exec: this.exec,
      vcc: this.vcc,
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
    this.exec = snap.exec;
    this.vcc = snap.vcc;
    this.scc = snap.scc;
    this.pc = snap.pc;
    this.cycleCount = snap.cycleCount;
    this.modifiedRegs.clear();
  }

  /** Read raw 32-bit value from VGPR */
  readVGPR_u32(reg: number, lane: number): number {
    return this.vgprs[reg][lane];
  }

  /** Read VGPR as float (bitcast from u32) */
  readVGPR(reg: number, lane: number): number {
    _u32[0] = this.vgprs[reg][lane];
    return _f32[0];
  }

  /** Write raw 32-bit value to VGPR */
  writeVGPR_u32(reg: number, lane: number, value: number): void {
    this.vgprs[reg][lane] = value >>> 0;
    this.modifiedRegs.add(`v${reg}`);
  }

  /** Write float to VGPR (bitcast to u32 for storage) */
  writeVGPR(reg: number, lane: number, value: number): void {
    _f32[0] = value;
    this.vgprs[reg][lane] = _u32[0];
    this.modifiedRegs.add(`v${reg}`);
  }

  readSGPR(reg: number): number {
    return this.sgprs[reg];
  }

  writeSGPR(reg: number, value: number): void {
    this.sgprs[reg] = value;
    this.modifiedRegs.add(`s${reg}`);
  }
}
