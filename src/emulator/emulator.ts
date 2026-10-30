// ── GPU Emulator Controller ──
// Top-level interface for loading, stepping, and running shader programs

import { GPUState } from './state';
import { ResolvedInstruction, decodeProgram } from './decoder';
import { executeInstruction, EmulatorFault } from './executor';

/** Default instruction budget for run(): protects against infinite loops. */
export const DEFAULT_MAX_STEPS = 1_000_000;

/** Appended to every "ran off the end" fault. */
const MUST_END = ' — every program must finish by executing s_endpgm';

export class Emulator {
  state: GPUState;
  /** Execution has stopped: s_endpgm ran, or the program crashed (see `fault`). */
  halted: boolean;
  /**
   * Why the program crashed (ran past its last instruction, bad branch target, unsupported
   * instruction, …), or null.
   */
  fault: string | null;
  private program: ResolvedInstruction[];
  private indexByAddress: Map<number, number>;
  private programDwords: number;

  constructor() {
    this.state = new GPUState();
    this.program = [];
    this.indexByAddress = new Map();
    this.programDwords = 0;
    this.halted = false;
    this.fault = null;
  }

  /** Load a binary program, decode it, and reset execution state. */
  load(binary: Uint32Array): void {
    this.program = decodeProgram(binary);
    this.indexByAddress = new Map(this.program.map((p, i) => [p.decoded.address, i]));
    this.programDwords = binary.length;
    this.reset();
  }

  /**
   * Execute one instruction at the current PC and advance.
   * Returns false if the program has already stopped.
   */
  step(): boolean {
    if (this.halted) return false;

    const pc = this.state.pc;
    if (pc >= this.program.length) {
      // Only an empty program gets here: running past the last instruction faults as it happens
      this.raiseFault(`The program has no instructions${MUST_END}`);
      return true;
    }
    const instr = this.program[pc];
    const mnemonic = instr.opcodeInfo.mnemonic;
    const nextAddress = instr.decoded.address + instr.decoded.size;
    let flow;
    try {
      flow = executeInstruction(this.state, instr, { nextPcBytes: nextAddress * 4 });
    } catch (e) {
      if (!(e instanceof EmulatorFault)) throw e;
      this.raiseFault(e.message);
      return true;
    }
    this.state.cycleCount++;

    if (!flow) {
      this.state.pc = pc + 1;
      // On a GPU, execution would carry on into whatever memory follows the shader
      if (this.state.pc >= this.program.length) {
        this.raiseFault(`Execution ran off the end of the program after ${mnemonic}${MUST_END}`);
      }
    } else if (flow.kind === 'halt') {
      this.state.pc = pc + 1;
      this.halted = true;
    } else if (flow.kind === 'branch') {
      this.jumpTo(nextAddress + flow.offset, mnemonic);
    } else if (flow.byteAddress % 4 !== 0) {
      this.raiseFault(`${mnemonic} jumped to a misaligned address 0x${flow.byteAddress.toString(16)}`);
    } else {
      this.jumpTo(flow.byteAddress / 4, mnemonic);
    }
    return true;
  }

  /** Continue at a dword address; jumping to the end of the program (past the last instruction) crashes. */
  private jumpTo(dwordAddress: number, mnemonic: string): void {
    if (dwordAddress === this.programDwords) {
      this.state.pc = this.program.length;
      this.raiseFault(`${mnemonic} jumped to the end of the program, past the last instruction${MUST_END}`);
      return;
    }
    const index = this.indexByAddress.get(dwordAddress);
    if (index === undefined) {
      this.raiseFault(`Jump to byte address 0x${(dwordAddress * 4).toString(16)}, which is not the start of an instruction`);
      return;
    }
    this.state.pc = index;
  }

  private raiseFault(message: string): void {
    this.fault = message;
    this.halted = true;
  }

  /** Run all remaining instructions to completion (or until the step budget runs out). */
  run(maxSteps = DEFAULT_MAX_STEPS): void {
    let steps = 0;
    while (this.step()) {
      if (++steps >= maxSteps && !this.isComplete()) {
        this.raiseFault(`Stopped after ${maxSteps} instructions — is there an infinite loop?`);
        return;
      }
    }
  }

  /** Reset execution state but keep the loaded program. */
  reset(): void {
    this.state.reset();
    this.halted = false;
    this.fault = null;
  }

  /** Check if execution has stopped: s_endpgm ran, or the program crashed (`fault` says why). */
  isComplete(): boolean {
    return this.halted;
  }

  /** Get the instruction at the current PC, or null if execution has stopped. */
  getCurrentInstruction(): ResolvedInstruction | null {
    if (this.isComplete()) return null;
    return this.program[this.state.pc] ?? null;
  }

  /** Get total cycles executed so far. */
  getCycleCount(): number {
    return this.state.cycleCount;
  }

  /** Byte address of the current instruction (or of the end of the program). */
  getPCBytes(): number {
    if (this.state.pc < this.program.length) return this.program[this.state.pc].decoded.address * 4;
    return this.programDwords * 4;
  }
}
