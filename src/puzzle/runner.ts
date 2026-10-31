// ── Puzzle runner ──
// Runs a solution on every invocation of a puzzle and works out its stats, the way the app does. The app steps
// through the same per-invocation helpers; the tests and the hardware verifier run the whole thing at once.

import { DEFAULT_MAX_STEPS, Emulator } from '../emulator/emulator';
import { GPUState } from '../emulator/state';
import { WAVE_WIDTH } from '../isa/constants';
import { lookupByMnemonic } from '../isa/opcodes';
import { operandRegCount, OperandRole } from '../isa/operands';
import { Operand, OperandType, ParsedInstruction } from '../isa/types';
import { Puzzle, PuzzleResult } from './types';
import { validatePuzzle } from './validator';

/** Number of invocations (waves of 32 lanes) it takes to process a puzzle's streams. */
export function invocationCount(puzzle: Puzzle): number {
  return Math.ceil((puzzle.outputs[0]?.values.length ?? 0) / WAVE_WIDTH);
}

/**
 * Write one invocation's inputs into the registers: a VGPR input fills its 32 lanes from the stream (0 past its
 * end), an SGPR input takes one value per invocation.
 */
export function loadInvocationInputs(state: GPUState, puzzle: Puzzle, invocation: number): void {
  const start = invocation * WAVE_WIDTH;
  for (const input of puzzle.inputs) {
    if (input.isSGPR) {
      const value = invocation < input.values.length ? input.values[invocation] : 0;
      state.writeSGPR(input.register, value >>> 0);
      continue;
    }
    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      const idx = start + lane;
      const value = idx < input.values.length ? input.values[idx] : 0;
      if (input.isInteger) state.writeVGPR_u32(input.register, lane, value >>> 0);
      else state.writeVGPR(input.register, lane, value);
    }
  }
}

/** Read one invocation's output lanes (those within each stream) into `collected`: register → stream of values. */
export function collectInvocationOutputs(state: GPUState, puzzle: Puzzle, invocation: number, collected: Map<number, number[]>): void {
  const start = invocation * WAVE_WIDTH;
  for (const output of puzzle.outputs) {
    if (!collected.has(output.register)) collected.set(output.register, []);
    const values = collected.get(output.register)!;
    for (let lane = 0; lane < WAVE_WIDTH && start + lane < output.values.length; lane++) {
      values[start + lane] = output.isInteger ? state.readVGPR_u32(output.register, lane) : state.readVGPR(output.register, lane);
    }
  }
}

export interface InvocationRun {
  /** Instructions executed, s_endpgm included: the "cycles" of the Speed leaderboard. */
  cycles: number;
  /** The bits of every lane of each output register at the end: outputBits[output][lane]. */
  outputBits: number[][];
}

export interface PuzzleRun {
  result: PuzzleResult;
  /** The invocations that ran to s_endpgm; a crash stops the run. */
  invocations: InvocationRun[];
  /** Instructions executed by all the invocations. */
  cycles: number;
  /** Highest VGPR any invocation reached through M0-relative addressing, or -1. */
  peakIndirectVgpr: number;
}

/** Run a solution on each invocation of a puzzle in turn, each from a fresh start, and validate the outputs. */
export function runPuzzle(puzzle: Puzzle, binary: Uint32Array, maxSteps = DEFAULT_MAX_STEPS): PuzzleRun {
  const collected = new Map<number, number[]>(puzzle.outputs.map(o => [o.register, []]));
  const invocations: InvocationRun[] = [];
  let cycles = 0;
  let peakIndirectVgpr = -1;
  const emu = new Emulator();
  for (let inv = 0; inv < invocationCount(puzzle); inv++) {
    emu.load(binary);
    loadInvocationInputs(emu.state, puzzle, inv);
    emu.run(maxSteps);
    peakIndirectVgpr = Math.max(peakIndirectVgpr, emu.state.maxIndirectVgpr);
    if (emu.fault) {
      const result = validatePuzzle(puzzle, collected, { invocation: inv, message: emu.fault });
      return { result, invocations, cycles, peakIndirectVgpr };
    }
    cycles += emu.getCycleCount();
    collectInvocationOutputs(emu.state, puzzle, inv, collected);
    invocations.push({ cycles: emu.getCycleCount(), outputBits: puzzle.outputs.map(o => Array.from(emu.state.vgprs[o.register])) });
  }
  return { result: validatePuzzle(puzzle, collected), invocations, cycles, peakIndirectVgpr };
}

/** Highest register of one file named by an operand, counting every register of a range such as v[4:5]; -1 if none. */
export function highestNamedRegister(instructions: readonly ParsedInstruction[], type: OperandType): number {
  let max = -1;
  for (const instr of instructions) {
    const info = lookupByMnemonic(instr.mnemonic);
    const operands: [OperandRole | null, Operand | undefined][] = [
      ['dst', instr.dst], ['src0', instr.src0], ['src1', instr.src1], ['src2', instr.src2], [null, instr.sdst],
    ];
    for (const [role, op] of operands) {
      if (op?.type !== type) continue;
      const width = Math.max(op.regCount ?? 1, info && role ? operandRegCount(info, role) : 1);
      max = Math.max(max, op.value + width - 1);
    }
  }
  return max;
}

/**
 * The VGPRs a solution uses, for the leaderboard: up to the highest it names, reaches through M0 or that holds a
 * puzzle input or output.
 */
export function vgprsUsed(instructions: readonly ParsedInstruction[], puzzle: Puzzle | null, peakIndirectVgpr: number): number {
  let max = Math.max(highestNamedRegister(instructions, OperandType.VGPR), peakIndirectVgpr);
  for (const port of puzzle?.inputs ?? []) {
    if (!port.isSGPR) max = Math.max(max, port.register);
  }
  for (const port of puzzle?.outputs ?? []) max = Math.max(max, port.register);
  return max + 1;
}
