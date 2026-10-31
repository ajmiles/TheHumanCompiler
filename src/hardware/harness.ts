// ── Hardware harness ──
// Wraps a solution's machine code in a program that times it when the devkit runs it as a wave32 compute shader:
//
//   setup     turn whatever the wave starts with into the emulator's start state (registers and LDS zero, EXEC all
//             ones, SCC 0, the emulator's float mode), then write the invocation's inputs
//   timer     s_memtime gives T_start, which goes out through a store: the solution may use every register and all
//             of LDS, and there are no scalar stores. The registers this borrows are then put back to 0.
//   solution  unchanged, except that each s_endpgm becomes s_branch epilogue (the same size)
//   epilogue  s_memtime gives T_end; store the output registers and T_end; s_endpgm
//
// T_end − T_start, less the same for an empty solution (the baseline), is what the solution costs. The solution
// and the epilogue each start on a 64-byte instruction cache line, so the setup's length doesn't move them. Apart
// from s_memtime and the global stores, which the assembler leaves out, the harness is assembled like a solution.

import { assemble } from '../assembler/assembler';
import { decodeProgram } from '../emulator/decoder';
import { NUM_VGPRS, SGPR_MAX, WAVE_WIDTH } from '../isa/constants';
import { decodeBinary } from '../isa/encoding';
import { Puzzle } from '../puzzle/types';
import { valueBits } from './hash';
import { HwProgram, HwRelocation, RESULT_OUTPUTS, RESULT_T_END, RESULT_T_START } from './protocol';

/** Dwords in a 64-byte instruction cache line. */
const LINE_DWORDS = 16;
const S_NOP_0 = 0xBF800000;
export const S_ENDPGM = 0xBF810000;
/** Placeholders that the runner overwrites with the result buffer's address (see HwRelocation). */
const RESULT_LO = 0xDEAD0000;
const RESULT_HI = 0xDEAD0001;

/** MODE[9:0] as the emulator behaves: round to nearest even, f32/f64/f16 denormals kept, DX10 clamp, IEEE off. */
export const EMULATOR_MODE = 0x1F0;
/** The s_setreg selector of MODE[9:0]: hwreg(HW_REG_MODE, 0, 10). */
const MODE_BITS_9_0 = (9 << 11) | 1;

/** s_memtime sdst: the 64-bit core-clock counter (LLVM's GFX10 encoding). */
export function sMemtime(sdst: number): number[] {
  return [(0xF4900000 | (sdst << 6)) >>> 0, 0];
}

/** global_store_dword(x2) vaddr, vdata, saddr offset:…, which stores to saddr + vaddr + offset (LLVM's GFX10 encoding). */
export function globalStore(dwords: 1 | 2, vaddr: number, vdata: number, saddr: number, offset = 0): number[] {
  if (offset < -2048 || offset > 2047) throw new Error(`A global store offset must fit in 12 bits (${offset})`);
  const op = dwords === 1 ? 0x1C : 0x1D;
  return [(0xDC000000 | (op << 18) | (2 << 14) | (offset & 0xFFF)) >>> 0, (vaddr | (vdata << 8) | (saddr << 16)) >>> 0];
}

/** s_branch to `offset` dwords after the instruction that follows it. */
function sBranch(offset: number): number {
  return (0xBF820000 | (offset & 0xFFFF)) >>> 0;
}

const hex = (v: number) => `0x${(v >>> 0).toString(16)}`;

/** Registers the timer and the epilogue borrow; none of them is a puzzle input or output. */
export interface Scratch {
  /** SGPR pair for a timestamp. */
  time: number;
  /** SGPR pair for the result address. */
  address: number;
  /** VGPR for a store's lane offset. */
  offset: number;
  /** VGPR pair for a stored timestamp. */
  data: number;
}

/**
 * The scratch registers: the highest ones that aren't puzzle inputs or outputs. `sharedWithSolution` says the
 * solution may write the VGPRs (it uses `vgprsUsed` of them).
 */
export function pickScratch(puzzle: Puzzle | null, vgprsUsed: number): { scratch: Scratch; sharedWithSolution: boolean } {
  const sgprPorts = new Set<number>();
  const vgprPorts = new Set<number>();
  for (const port of puzzle?.inputs ?? []) (port.isSGPR ? sgprPorts : vgprPorts).add(port.register);
  for (const port of puzzle?.outputs ?? []) vgprPorts.add(port.register);

  const pairs: number[] = [];
  for (let s = SGPR_MAX - 1; s >= 0 && pairs.length < 2; s -= 2) {
    if (!sgprPorts.has(s) && !sgprPorts.has(s + 1)) pairs.push(s);
  }
  const free = (v: number) => !vgprPorts.has(v);
  let data = -1;
  for (let v = NUM_VGPRS - 2; v >= 0 && data < 0; v--) {
    if (free(v) && free(v + 1)) data = v;
  }
  let offset = -1;
  for (let v = NUM_VGPRS - 1; v >= 0 && offset < 0; v--) {
    if (free(v) && v !== data && v !== data + 1) offset = v;
  }
  if (pairs.length < 2 || data < 0 || offset < 0) throw new Error('The puzzle leaves no registers for the harness');
  return { scratch: { time: pairs[1], address: pairs[0], offset, data }, sharedWithSolution: Math.min(offset, data) < vgprsUsed };
}

/** The start state every invocation shares: LDS, VGPRs, SGPRs, VCC, M0, EXEC and the float mode. */
function startStateLines(): string[] {
  const lines = ['s_mov_b32 exec_lo, -1', 's_mov_b32 exec_hi, 0'];
  // LDS: each lane zeroes one dword in each half of each 256-byte block (ds_write2st64 offsets count 256 bytes)
  lines.push('v_mbcnt_lo_u32_b32 v0, -1, 0', 'v_lshlrev_b32 v0, 2, v0', 'v_add_nc_u32 v1, 0x80, v0', 'v_mov_b32 v2, 0');
  for (const base of ['v0', 'v1']) {
    for (let block = 0; block < 256; block += 2) lines.push(`ds_write2st64_b32 ${base}, v2, v2 offset0:${block} offset1:${block + 1}`);
  }
  lines.push('s_waitcnt lgkmcnt(0)');
  for (let v = 0; v < NUM_VGPRS; v++) lines.push(`v_mov_b32 v${v}, 0`);
  for (let s = 0; s <= SGPR_MAX; s++) lines.push(`s_mov_b32 s${s}, 0`);
  lines.push('s_mov_b32 vcc_lo, 0', 's_mov_b32 vcc_hi, 0', 's_mov_b32 m0, 0');
  lines.push(`s_setreg_imm32_b32 ${hex(MODE_BITS_9_0)}, ${hex(EMULATOR_MODE)}`);
  return lines;
}

/** One invocation's inputs, as the app loads them: one EXEC mask per value a register holds (0s are already there). */
function inputLines(puzzle: Puzzle | null, invocation: number): string[] {
  const lines: string[] = [];
  for (const input of puzzle?.inputs ?? []) {
    if (input.isSGPR) {
      const value = invocation < input.values.length ? input.values[invocation] >>> 0 : 0;
      if (value !== 0) lines.push(`s_mov_b32 s${input.register}, ${hex(value)}`);
      continue;
    }
    const lanes = new Map<number, number>();
    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      const idx = invocation * WAVE_WIDTH + lane;
      const bits = valueBits(idx < input.values.length ? input.values[idx] : 0, input.isInteger);
      if (bits !== 0) lanes.set(bits, ((lanes.get(bits) ?? 0) | (1 << lane)) >>> 0);
    }
    for (const [bits, mask] of lanes) lines.push(`s_mov_b32 exec_lo, ${hex(mask)}`, `v_mov_b32 v${input.register}, ${hex(bits)}`);
  }
  lines.push('s_mov_b32 exec_lo, -1', 's_cmp_eq_u32 0, 1'); // SCC = 0
  return lines;
}

/**
 * The setup's assembly: whatever the wave starts with becomes the emulator's start state for one invocation. (Its
 * s_setreg_imm32_b32 sets the float mode, which the emulator doesn't run.)
 */
export function setupSource(puzzle: Puzzle | null, invocation: number): string[] {
  return [...startStateLines(), ...inputLines(puzzle, invocation)];
}

/** Machine code built from assembled harness lines and hand-encoded instructions. */
class CodeBuilder {
  readonly code: number[] = [];
  readonly relocations: HwRelocation[] = [];

  /** Assemble harness lines and append them; result-address placeholders become relocations. */
  asm(lines: string[]): this {
    const r = assemble(lines.join('\n'));
    if (r.errors.length > 0) {
      const e = r.errors[0];
      throw new Error(`Harness line ${e.line} (${lines[e.line - 1]}): ${e.message}`);
    }
    for (const d of decodeBinary(r.binary)) {
      const value = d.literal === RESULT_LO ? 'resultAddressLo' : d.literal === RESULT_HI ? 'resultAddressHi' : null;
      if (value) this.relocations.push({ dword: this.code.length + d.address + d.size - 1, value });
    }
    return this.raw(r.binary);
  }

  raw(words: ArrayLike<number>): this {
    for (let i = 0; i < words.length; i++) this.code.push(words[i] >>> 0);
    return this;
  }

  /** Pad with s_nop 0 until the next `ahead` dwords would end on a cache line. */
  alignEnd(ahead: number): this {
    while ((this.code.length + ahead) % LINE_DWORDS !== 0) this.code.push(S_NOP_0);
    return this;
  }
}

let startState: number[] | null = null;

/** The setup's machine code (the start state is the same for every program, so it's assembled once). */
function setupCode(puzzle: Puzzle | null, invocation: number): number[] {
  startState ??= new CodeBuilder().asm(startStateLines()).code;
  return [...startState, ...new CodeBuilder().asm(inputLines(puzzle, invocation)).code];
}

/** Start the timer; the code after this begins on a cache line. */
function startTimer(b: CodeBuilder, s: Scratch, waitForStore: boolean): void {
  b.asm([`s_mov_b32 s${s.address}, ${hex(RESULT_LO)}`, `s_mov_b32 s${s.address + 1}, ${hex(RESULT_HI)}`, 's_mov_b32 exec_lo, 1']);
  const timed = new CodeBuilder()
    .raw(sMemtime(s.time))
    .asm(['s_waitcnt lgkmcnt(0)', `v_mov_b32 v${s.data}, s${s.time}`, `v_mov_b32 v${s.data + 1}, s${s.time + 1}`])
    .raw(globalStore(2, s.offset, s.data, s.address, RESULT_T_START)) // lane 0; the offset VGPR is 0
    // VALU instructions come between the store and the SALU writes to the SGPRs it reads (a GFX10 hazard)
    .asm([`v_mov_b32 v${s.data}, 0`, `v_mov_b32 v${s.data + 1}, 0`, `s_mov_b32 s${s.time}, 0`, `s_mov_b32 s${s.time + 1}, 0`,
      `s_mov_b32 s${s.address}, 0`, `s_mov_b32 s${s.address + 1}, 0`, 's_mov_b32 exec_lo, -1',
      // GFX10 can let an LDS access after a branch overtake a store's VGPR reads (LLVM's LdsBranchVmemWARHazard):
      // when the solution may write these VGPRs, wait for the store, though that time is then measured too
      ...(waitForStore ? ['s_waitcnt_vscnt null, 0'] : [])]);
  b.alignEnd(timed.code.length).raw(timed.code);
}

/** Stop the timer and store the record: T_start is already out, then T_end and 32 lanes of each output. */
function epilogue(b: CodeBuilder, s: Scratch, outputs: readonly number[]): void {
  b.raw(sMemtime(s.time))
    // T_end and the solution's LDS reads still in flight; then the wait GFX10 needs between LDS, a branch and a store
    .asm(['s_waitcnt lgkmcnt(0)', 's_waitcnt_vscnt null, 0',
      `s_mov_b32 s${s.address}, ${hex(RESULT_LO)}`, `s_mov_b32 s${s.address + 1}, ${hex(RESULT_HI)}`,
      's_mov_b32 exec_lo, -1', `v_mbcnt_lo_u32_b32 v${s.offset}, -1, 0`, `v_lshlrev_b32 v${s.offset}, 2, v${s.offset}`]);
  outputs.forEach((reg, k) => b.raw(globalStore(1, s.offset, reg, s.address, RESULT_OUTPUTS + 4 * WAVE_WIDTH * k)));
  b.asm(['s_mov_b32 exec_lo, 1', `v_mov_b32 v${s.data}, s${s.time}`, `v_mov_b32 v${s.data + 1}, s${s.time + 1}`])
    .raw(globalStore(2, s.offset, s.data, s.address, RESULT_T_END))
    .raw([S_ENDPGM]);
}

/** One program: setup, timer, the solution's code (each s_endpgm branching to the epilogue) and epilogue. */
function harnessProgram(setup: number[], solution: Uint32Array, s: Scratch, waitForStore: boolean, outputs: readonly number[]): HwProgram {
  const b = new CodeBuilder().raw(setup);
  startTimer(b, s, waitForStore);
  const at = b.code.length;
  const epilogueAt = Math.ceil((at + solution.length) / LINE_DWORDS) * LINE_DWORDS;
  const code = Array.from(solution);
  for (const { decoded, opcodeInfo } of decodeProgram(solution)) {
    if (opcodeInfo.halts) code[decoded.address] = sBranch(epilogueAt - (at + decoded.address + 1));
  }
  b.raw(code);
  while (b.code.length < epilogueAt) b.code.push(S_NOP_0);
  epilogue(b, s, outputs);
  return { code: b.code, relocations: b.relocations };
}

/** Bytes each run writes at the result address. */
export function resultBytes(puzzle: Puzzle | null): number {
  return RESULT_OUTPUTS + 4 * WAVE_WIDTH * (puzzle?.outputs.length ?? 0);
}

/**
 * The two programs to time for one invocation: the solution, and the baseline (the same harness around just
 * s_endpgm). `vgprsUsed` is how many VGPRs the solution uses.
 */
export function invocationPrograms(puzzle: Puzzle | null, solution: Uint32Array, vgprsUsed: number, invocation: number): { solution: HwProgram; baseline: HwProgram } {
  const { scratch, sharedWithSolution } = pickScratch(puzzle, vgprsUsed);
  const setup = setupCode(puzzle, invocation);
  const outputs = puzzle?.outputs.map(o => o.register) ?? [];
  return {
    solution: harnessProgram(setup, solution, scratch, sharedWithSolution, outputs),
    baseline: harnessProgram(setup, Uint32Array.of(S_ENDPGM), scratch, sharedWithSolution, outputs),
  };
}
