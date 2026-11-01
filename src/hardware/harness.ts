// ── Hardware harness ──
// Wraps a solution's machine code in a program that times it when the devkit runs it as a wave32 compute shader:
//
//   setup     turn whatever the wave starts with into the emulator's start state for an invocation: LDS, SGPRs, VCC
//             and M0 zeroed, EXEC all ones, the emulator's float mode; then every VGPR, and any SGPR inputs, loaded
//             from the invocation's input block (inputWords), which the runner copies into the result buffer before
//             each run. So a job has one solution program and one baseline for every invocation. SCC ends at 0.
//   timer     s_memtime gives T_start, which goes out through a store: the solution may use every register and all
//             of LDS, and there are no scalar stores. The registers this borrows are then put back to 0.
//   solution  unchanged, except that each s_endpgm becomes s_branch epilogue (the same size)
//   epilogue  s_memtime gives T_end; store the output registers and T_end; s_endpgm
//
// T_end − T_start, less the same for an empty solution (the baseline), is what the solution costs. The solution
// and the epilogue each start on a 64-byte instruction cache line, so the setup's length doesn't move them. Apart
// from s_memtime and the memory instructions, which the assembler leaves out, the harness is assembled like a
// solution.

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

/** Bytes from the result address to the input block (HwJob.inputOffset): past the record, on a 4 KB boundary. */
export const INPUT_OFFSET = 4096;
/** An input block's bytes for four VGPRs: 16 a lane, as one global_load_dwordx4 loads them. */
const GROUP_BYTES = WAVE_WIDTH * 16;
/** The input block's VGPR part, in dwords: every VGPR's 32 lanes. The SGPR inputs follow it. */
export const VGPR_BLOCK_DWORDS = NUM_VGPRS * WAVE_WIDTH;

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

/** global_load_dword(x4) vdst, vaddr, saddr offset:…, which loads from saddr + vaddr + offset (LLVM's GFX10 encoding). */
export function globalLoad(dwords: 1 | 4, vdst: number, vaddr: number, saddr: number, offset = 0): number[] {
  if (offset < -2048 || offset > 2047) throw new Error(`A global load offset must fit in 12 bits (${offset})`);
  const op = dwords === 1 ? 0x0C : 0x0E;
  return [(0xDC000000 | (op << 18) | (2 << 14) | (offset & 0xFFF)) >>> 0, (vaddr | (saddr << 16) | (vdst << 24)) >>> 0];
}

/** s_load_dword sdst, s[sbase:sbase+1], offset, with no offset register (LLVM's GFX10 encoding). */
export function sLoadDword(sdst: number, sbase: number, offset: number): number[] {
  if (offset < 0 || offset > 0xFFFFF) throw new Error(`An s_load offset must fit in 20 bits (${offset})`);
  return [(0xF4000000 | (sdst << 6) | (sbase >> 1)) >>> 0, (0xFA000000 | offset) >>> 0];
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

/** The start state's ALU part, the same in every program: EXEC, LDS, SGPRs, VCC, M0 and the float mode. */
function startStateLines(): string[] {
  const lines = ['s_mov_b32 exec_lo, -1', 's_mov_b32 exec_hi, 0'];
  // LDS: each lane zeroes one dword in each half of each 256-byte block (ds_write2st64 offsets count 256 bytes).
  // v0-v2 are only borrowed: every VGPR is loaded afterwards.
  lines.push('v_mbcnt_lo_u32_b32 v0, -1, 0', 'v_lshlrev_b32 v0, 2, v0', 'v_add_nc_u32 v1, 0x80, v0', 'v_mov_b32 v2, 0');
  for (const base of ['v0', 'v1']) {
    for (let block = 0; block < 256; block += 2) lines.push(`ds_write2st64_b32 ${base}, v2, v2 offset0:${block} offset1:${block + 1}`);
  }
  lines.push('s_waitcnt lgkmcnt(0)');
  for (let s = 0; s <= SGPR_MAX; s++) lines.push(`s_mov_b32 s${s}, 0`);
  lines.push('s_mov_b32 vcc_lo, 0', 's_mov_b32 vcc_hi, 0', 's_mov_b32 m0, 0');
  lines.push(`s_setreg_imm32_b32 ${hex(MODE_BITS_9_0)}, ${hex(EMULATOR_MODE)}`);
  return lines;
}

const sgprInputs = (puzzle: Puzzle | null) => puzzle?.inputs.filter(p => p.isSGPR) ?? [];

/** Where VGPR `reg`'s value for `lane` is in an input block, in dwords: four registers a lane at a time. */
export function vgprWord(reg: number, lane: number): number {
  return (reg >> 2) * (GROUP_BYTES / 4) + lane * 4 + (reg & 3);
}

/**
 * An invocation's input block: every VGPR's start value for each lane (an input's, or 0), as the emulator loads
 * them, then each SGPR input's value, in the puzzle's order.
 */
export function inputWords(puzzle: Puzzle | null, invocation: number): number[] {
  const sgprs = sgprInputs(puzzle);
  const words: number[] = new Array(VGPR_BLOCK_DWORDS + sgprs.length).fill(0);
  for (const input of puzzle?.inputs ?? []) {
    if (input.isSGPR) continue;
    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      const idx = invocation * WAVE_WIDTH + lane;
      words[vgprWord(input.register, lane)] = valueBits(idx < input.values.length ? input.values[idx] : 0, input.isInteger);
    }
  }
  sgprs.forEach((input, k) => {
    words[VGPR_BLOCK_DWORDS + k] = invocation < input.values.length ? input.values[invocation] >>> 0 : 0;
  });
  return words;
}

/** A line of the harness's assembly, or hand-encoded words (an instruction the assembler leaves out). */
type Part = string | number[];

/**
 * Load the registers from the input block, which the runner puts at the result address + INPUT_OFFSET: the SGPR
 * inputs, then every VGPR, four at a time. v255 holds each lane's offset in the block until the last load, which
 * loads it too. The address pair goes back to 0, and SCC to 0.
 */
function loadParts(puzzle: Puzzle | null, s: Scratch): Part[] {
  const a = s.address;
  const parts: Part[] = [`s_mov_b32 s${a}, ${hex(RESULT_LO)}`, `s_mov_b32 s${a + 1}, ${hex(RESULT_HI)}`,
    `s_add_u32 s${a}, s${a}, ${hex(INPUT_OFFSET)}`, `s_addc_u32 s${a + 1}, s${a + 1}, 0`];
  sgprInputs(puzzle).forEach((input, k) => parts.push(sLoadDword(input.register, a, (VGPR_BLOCK_DWORDS + k) * 4)));
  // Wait for those before the address moves on
  parts.push('s_waitcnt lgkmcnt(0)', 'v_mbcnt_lo_u32_b32 v255, -1, 0', 'v_lshlrev_b32 v255, 4, v255');
  for (let group = 0; group < NUM_VGPRS / 4; group++) {
    // A load's offset has 12 bits (to 2047), so the address moves on 2 KB every four loads
    if (group > 0 && group % 4 === 0) parts.push(`s_add_u32 s${a}, s${a}, 0x800`, `s_addc_u32 s${a + 1}, s${a + 1}, 0`);
    parts.push(globalLoad(4, 4 * group, 255, a, (group % 4) * GROUP_BYTES));
  }
  parts.push('s_waitcnt vmcnt(0)', `s_mov_b32 s${a}, 0`, `s_mov_b32 s${a + 1}, 0`, 's_cmp_eq_u32 0, 1'); // SCC = 0
  return parts;
}

/**
 * The setup's assembly, without its loads (the emulator runs no memory instructions), for tests. (Its
 * s_setreg_imm32_b32 sets the float mode, which the emulator doesn't run either.)
 */
export function setupSource(puzzle: Puzzle | null, vgprsUsed = 1): string[] {
  return [...startStateLines(), ...loadParts(puzzle, pickScratch(puzzle, vgprsUsed).scratch).filter((p): p is string => typeof p === 'string')];
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

  /** Append parts, assembling each run of lines together. */
  parts(parts: Part[]): this {
    let lines: string[] = [];
    for (const part of parts) {
      if (typeof part === 'string') {
        lines.push(part);
        continue;
      }
      if (lines.length > 0) this.asm(lines);
      lines = [];
      this.raw(part);
    }
    return lines.length > 0 ? this.asm(lines) : this;
  }

  /** Pad with s_nop 0 until the next `ahead` dwords would end on a cache line. */
  alignEnd(ahead: number): this {
    while ((this.code.length + ahead) % LINE_DWORDS !== 0) this.code.push(S_NOP_0);
    return this;
  }
}

let startState: number[] | null = null;

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
function harnessProgram(puzzle: Puzzle | null, solution: Uint32Array, s: Scratch, waitForStore: boolean, outputs: readonly number[]): HwProgram {
  // The start state's ALU part is the same in every program, so it's assembled once
  startState ??= new CodeBuilder().asm(startStateLines()).code;
  const b = new CodeBuilder().raw(startState).parts(loadParts(puzzle, s));
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
 * The two programs to time: the solution, and the baseline (the same harness around just s_endpgm). They're the
 * same for every invocation; only the input block differs. `vgprsUsed` is how many VGPRs the solution uses.
 */
export function jobPrograms(puzzle: Puzzle | null, solution: Uint32Array, vgprsUsed: number): { solution: HwProgram; baseline: HwProgram } {
  if (resultBytes(puzzle) > INPUT_OFFSET) throw new Error('The record would run into the input block');
  const { scratch, sharedWithSolution } = pickScratch(puzzle, vgprsUsed);
  const outputs = puzzle?.outputs.map(o => o.register) ?? [];
  return {
    solution: harnessProgram(puzzle, solution, scratch, sharedWithSolution, outputs),
    baseline: harnessProgram(puzzle, Uint32Array.of(S_ENDPGM), scratch, sharedWithSolution, outputs),
  };
}
