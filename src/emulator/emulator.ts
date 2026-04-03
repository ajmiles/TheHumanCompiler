// ── GPU Emulator Controller ──
// Top-level interface for loading, stepping, and running shader programs

import { GPUState } from './state';
import { ResolvedInstruction, decodeProgram } from './decoder';
import { executeInstruction } from './executor';

export class Emulator {
  state: GPUState;
  private program: ResolvedInstruction[];

  constructor() {
    this.state = new GPUState();
    this.program = [];
  }

  /** Load a binary program, decode it, and reset execution state. */
  load(binary: Uint32Array): void {
    this.program = decodeProgram(binary);
    this.state.reset();
  }

  /**
   * Execute one instruction at the current PC and advance.
   * Returns false if the program is already complete.
   */
  step(): boolean {
    if (this.isComplete()) return false;

    const instr = this.program[this.state.pc];
    executeInstruction(this.state, instr);
    this.state.pc++;
    this.state.cycleCount++;

    // Halting instruction (s_endpgm): jump to end
    if (instr.opcodeInfo.halts) {
      this.state.pc = this.program.length;
    }

    return true;
  }

  /** Run all remaining instructions to completion. */
  run(): void {
    while (this.step()) {
      // execute until program ends
    }
  }

  /** Reset execution state but keep the loaded program. */
  reset(): void {
    this.state.reset();
  }

  /** Check if execution has reached the end of the program. */
  isComplete(): boolean {
    return this.state.pc >= this.program.length;
  }

  /** Get the instruction at the current PC, or null if complete. */
  getCurrentInstruction(): ResolvedInstruction | null {
    if (this.isComplete()) return null;
    return this.program[this.state.pc];
  }

  /** Get total cycles executed so far. */
  getCycleCount(): number {
    return this.state.cycleCount;
  }

  /** Get current PC as byte address. */
  getPCBytes(): number {
    if (this.isComplete() && this.program.length > 0) {
      // Past last instruction: use binary length
      const last = this.program[this.program.length - 1];
      // Estimate: last instruction address + its size in words
      const lastAddr = last.decoded.address;
      const lastSize = (last.decoded.literal !== undefined) ? 2 :
        (last.decoded.src2 !== undefined || last.decoded.src0Abs || last.decoded.src0Neg ||
         last.decoded.src1Abs || last.decoded.src1Neg || last.decoded.omod || last.decoded.clamp) ? 2 : 1;
      return (lastAddr + lastSize) * 4;
    }
    if (this.state.pc < this.program.length) {
      return this.program[this.state.pc].decoded.address * 4;
    }
    return 0;
  }
}
