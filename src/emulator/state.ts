// ── GPU Execution State (Wave32) ──

import { NUM_VGPRS, NUM_SGPRS, WAVE_WIDTH } from '../isa/constants';

export interface GPUStateSnapshot {
  vgprs: Float32Array[];
  sgprs: Uint32Array;
  exec: number;
  vcc: number;
  pc: number;
  cycleCount: number;
}

export class GPUState {
  vgprs: Float32Array[];
  sgprs: Uint32Array;
  exec: number;
  vcc: number;
  pc: number;
  cycleCount: number;
  modifiedRegs: Set<string>;

  constructor() {
    this.vgprs = [];
    this.sgprs = new Uint32Array(NUM_SGPRS);
    this.exec = 0xFFFFFFFF;
    this.vcc = 0;
    this.pc = 0;
    this.cycleCount = 0;
    this.modifiedRegs = new Set();

    for (let i = 0; i < NUM_VGPRS; i++) {
      this.vgprs.push(new Float32Array(WAVE_WIDTH));
    }
  }

  reset(): void {
    for (let i = 0; i < NUM_VGPRS; i++) {
      this.vgprs[i].fill(0);
    }
    this.sgprs.fill(0);
    this.exec = 0xFFFFFFFF;
    this.vcc = 0;
    this.pc = 0;
    this.cycleCount = 0;
    this.modifiedRegs.clear();
  }

  snapshot(): GPUStateSnapshot {
    return {
      vgprs: this.vgprs.map((reg) => new Float32Array(reg)),
      sgprs: new Uint32Array(this.sgprs),
      exec: this.exec,
      vcc: this.vcc,
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
    this.pc = snap.pc;
    this.cycleCount = snap.cycleCount;
    this.modifiedRegs.clear();
  }

  readVGPR(reg: number, lane: number): number {
    return this.vgprs[reg][lane];
  }

  writeVGPR(reg: number, lane: number, value: number): void {
    this.vgprs[reg][lane] = value;
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
