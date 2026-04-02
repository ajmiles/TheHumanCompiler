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
}
