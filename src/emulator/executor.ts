// ── Instruction Executor ──
// Executes a single resolved instruction across all active lanes.
// All data flows as raw u32 bit patterns. Float ops bitcast to/from float;
// integer ops pass raw u32 directly to the execute function.

import { InstructionFormat } from '../isa/types';
import {
  WAVE_WIDTH,
  LITERAL_CONST,
  INLINE_FLOAT_MAP,
  INLINE_INT_0,
  INLINE_INT_POS_MAX,
  INLINE_INT_NEG_MIN,
  INLINE_INT_NEG_MAX,
  isVGPR,
  isSGPR,
  vgprIndex,
  EXEC_LO,
  VCC_LO,
} from '../isa/constants';
import { GPUState } from './state';
import { ResolvedInstruction } from './decoder';

// Shared buffers for bit-level reinterpretation between float32 and uint32
const reinterpretF32 = new Float32Array(1);
const reinterpretU32 = new Uint32Array(reinterpretF32.buffer);

/** Reinterpret a uint32 bit pattern as a float32 value. */
function bitsToFloat(bits: number): number {
  reinterpretU32[0] = bits >>> 0;
  return reinterpretF32[0];
}

/** Reinterpret a float32 value as a uint32 bit pattern. */
function floatBits(f: number): number {
  reinterpretF32[0] = f;
  return reinterpretU32[0];
}

/** Clamp a float through f32 to match GPU precision. */
function asFloat(v: number): number {
  reinterpretF32[0] = v;
  return reinterpretF32[0];
}

/** Convert a 16-bit IEEE 754 half-precision float to a JS number. */
function f16ToF32(h: number): number {
  const sign = (h >>> 15) & 1;
  const exp = (h >>> 10) & 0x1F;
  const frac = h & 0x3FF;

  if (exp === 0) {
    if (frac === 0) return sign ? -0 : 0; // ±zero
    // Denormal: value = (-1)^sign * 2^(-14) * (frac / 1024)
    return (sign ? -1 : 1) * Math.pow(2, -14) * (frac / 1024);
  }
  if (exp === 0x1F) {
    if (frac === 0) return sign ? -Infinity : Infinity;
    return NaN;
  }
  // Normal: value = (-1)^sign * 2^(exp-15) * (1 + frac/1024)
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

/** Convert a JS number to a 16-bit IEEE 754 half-precision float. */
function f32ToF16(v: number): number {
  if (Number.isNaN(v)) return 0x7E00; // NaN
  if (!Number.isFinite(v)) return v > 0 ? 0x7C00 : 0xFC00; // ±Inf

  const sign = v < 0 || (v === 0 && 1 / v === -Infinity) ? 1 : 0;
  v = Math.abs(v);

  if (v === 0) return sign << 15;

  // Convert to f16 range
  // f16 max normal = 65504, min normal = 2^-14 ≈ 6.1e-5, min denormal = 2^-24
  if (v >= 65520) return (sign << 15) | 0x7C00; // overflow → ±Inf

  if (v < Math.pow(2, -24)) return sign << 15; // underflow → ±0

  if (v < Math.pow(2, -14)) {
    // Denormal
    const frac = Math.round(v / Math.pow(2, -24));
    return (sign << 15) | (frac & 0x3FF);
  }

  // Normal
  let exp = Math.floor(Math.log2(v));
  let frac = Math.round((v / Math.pow(2, exp) - 1) * 1024);
  if (frac >= 1024) { frac = 0; exp++; }
  if (exp + 15 >= 0x1F) return (sign << 15) | 0x7C00; // overflow
  return (sign << 15) | ((exp + 15) << 10) | (frac & 0x3FF);
}

/**
 * Resolve a source operand to raw u32 bits.
 *
 * Every source returns a u32 bit pattern:
 *  - VGPR: raw u32 from the register file
 *  - SGPR: raw u32 from scalar register
 *  - Literal (255): raw 32-bit literal value
 *  - Inline float (240-247): bitcast the float constant to u32
 *  - Inline integer (128-208): the integer value as u32 (e.g. 7 → 0x00000007)
 */
function resolveRaw(state: GPUState, encoded: number, literal: number | undefined, lane: number): number {
  if (isVGPR(encoded)) {
    return state.readVGPR_u32(vgprIndex(encoded), lane);
  }

  if (isSGPR(encoded)) {
    return state.readSGPR(encoded);
  }

  if (encoded === LITERAL_CONST) {
    if (literal === undefined) {
      throw new Error('Literal constant referenced but no literal value present');
    }
    return literal >>> 0;
  }

  // Inline float constants (240-247): bitcast the float value to u32
  if (encoded in INLINE_FLOAT_MAP) {
    return floatBits(INLINE_FLOAT_MAP[encoded]);
  }

  // Inline integer constants (128-208)
  if (encoded === INLINE_INT_0) return 0;
  if (encoded >= INLINE_INT_0 + 1 && encoded <= INLINE_INT_POS_MAX) {
    return (encoded - INLINE_INT_0) >>> 0; // 1-64
  }
  if (encoded >= INLINE_INT_NEG_MIN && encoded <= INLINE_INT_NEG_MAX) {
    // -1 to -16, stored as u32 two's complement
    return (-(encoded - INLINE_INT_NEG_MIN + 1)) >>> 0;
  }

  return 0;
}

/**
 * Resolve SOP1 SSRC0 operand (8-bit scalar source) to raw u32 bits.
 */
function resolveSsrc0(state: GPUState, encoded: number, literal: number | undefined): number {
  if (isSGPR(encoded)) return state.readSGPR(encoded);
  if (encoded === EXEC_LO) return state.exec;
  if (encoded === VCC_LO) return state.vcc;
  if (encoded === 0xFF && literal !== undefined) return literal >>> 0;

  // Inline float constants → bitcast to u32
  if (encoded in INLINE_FLOAT_MAP) {
    return floatBits(INLINE_FLOAT_MAP[encoded]);
  }

  // Inline integer constants
  if (encoded === INLINE_INT_0) return 0;
  if (encoded >= INLINE_INT_0 + 1 && encoded <= INLINE_INT_POS_MAX) {
    return (encoded - INLINE_INT_0) >>> 0;
  }
  if (encoded >= INLINE_INT_NEG_MIN && encoded <= INLINE_INT_NEG_MAX) {
    return (-(encoded - INLINE_INT_NEG_MIN + 1)) >>> 0;
  }

  return 0;
}

/**
 * Resolve DPP16 source lane for a given lane.
 * Returns the source lane index, or -1 if out of range (bound_ctrl=true → use 0).
 */
function dpp16SourceLane(lane: number, ctrl: number): number {
  // Row = 16 lanes (0-15, 16-31)
  const rowBase = lane & ~15;
  const laneInRow = lane & 15;

  if (ctrl <= 0xFF) {
    // quad_perm: 4 × 2-bit selectors, applied within each quad of 4
    const quadBase = lane & ~3;
    const laneInQuad = lane & 3;
    const sel = (ctrl >>> (laneInQuad * 2)) & 3;
    return quadBase + sel;
  }
  if (ctrl >= 0x101 && ctrl <= 0x10F) {
    // row_shl:N — shift left within row
    const shift = ctrl & 0xF;
    const src = laneInRow - shift;
    return src >= 0 ? rowBase + src : -1;
  }
  if (ctrl >= 0x111 && ctrl <= 0x11F) {
    // row_shr:N — shift right within row
    const shift = ctrl & 0xF;
    const src = laneInRow + shift;
    return src < 16 ? rowBase + src : -1;
  }
  if (ctrl >= 0x121 && ctrl <= 0x12F) {
    // row_ror:N — rotate right within row
    const shift = ctrl & 0xF;
    return rowBase + ((laneInRow + shift) & 15);
  }
  if (ctrl === 0x130) {
    // wave_shl:1
    return lane > 0 ? lane - 1 : -1;
  }
  if (ctrl === 0x134) {
    // wave_shr:1
    return lane < WAVE_WIDTH - 1 ? lane + 1 : -1;
  }
  if (ctrl === 0x138) {
    // wave_rol:1
    return (lane - 1 + WAVE_WIDTH) & (WAVE_WIDTH - 1);
  }
  if (ctrl === 0x13C) {
    // wave_ror:1
    return (lane + 1) & (WAVE_WIDTH - 1);
  }
  if (ctrl === 0x140) {
    // row_mirror — reverse within row
    return rowBase + (15 - laneInRow);
  }
  if (ctrl === 0x141) {
    // row_half_mirror — reverse within each half-row (8 lanes)
    const halfBase = lane & ~7;
    const laneInHalf = lane & 7;
    return halfBase + (7 - laneInHalf);
  }
  if (ctrl === 0x142) {
    // row_bcast15 — broadcast lane 15 of each row
    return rowBase + 15;
  }
  if (ctrl === 0x143) {
    // row_bcast31 — broadcast lane 31
    return 31;
  }
  return lane;
}

/** Resolve DPP8 source lane within groups of 8. */
function dpp8SourceLane(lane: number, selectors: number[]): number {
  const groupBase = lane & ~7;
  const laneInGroup = lane & 7;
  return groupBase + selectors[laneInGroup];
}

/** Extract a sub-dword portion from a raw u32 value, with optional sign extension. */
function extractSel(raw: number, sel: number, sext: boolean): number {
  raw = raw >>> 0;
  let extracted: number;
  switch (sel) {
    case 0: extracted = raw & 0xFF; break;          // BYTE_0: [7:0]
    case 1: extracted = (raw >>> 8) & 0xFF; break;  // BYTE_1: [15:8]
    case 2: extracted = (raw >>> 16) & 0xFF; break; // BYTE_2: [23:16]
    case 3: extracted = (raw >>> 24) & 0xFF; break; // BYTE_3: [31:24]
    case 4: extracted = raw & 0xFFFF; break;        // WORD_0: [15:0]
    case 5: extracted = (raw >>> 16) & 0xFFFF; break; // WORD_1: [31:16]
    case 6: default: return raw;                    // DWORD: [31:0]
  }
  if (sext) {
    // Sign-extend to 32 bits
    const bits = sel <= 3 ? 8 : 16;
    const signBit = 1 << (bits - 1);
    if (extracted & signBit) {
      extracted |= (~0 << bits);
    }
    return extracted >>> 0; // return as unsigned
  }
  return extracted >>> 0; // zero-extended
}

/** Write a sub-dword portion into a destination, handling unused bits. */
function writeSel(oldDst: number, result: number, dstSel: number, dstUnused: number): number {
  oldDst = oldDst >>> 0;
  result = result >>> 0;

  let mask: number;
  let shift: number;
  let selBits: number;
  switch (dstSel) {
    case 0: mask = 0xFF; shift = 0; selBits = 8; break;
    case 1: mask = 0xFF; shift = 8; selBits = 8; break;
    case 2: mask = 0xFF; shift = 16; selBits = 8; break;
    case 3: mask = 0xFF; shift = 24; selBits = 8; break;
    case 4: mask = 0xFFFF; shift = 0; selBits = 16; break;
    case 5: mask = 0xFFFF; shift = 16; selBits = 16; break;
    case 6: default: return result; // DWORD: write all
  }

  const selectedBits = result & mask;

  switch (dstUnused) {
    case 0: // UNUSED_PAD: unused bits are zero
      return (selectedBits << shift) >>> 0;
    case 1: { // UNUSED_SEXT: sign-extend the selected portion to 32 bits
      const signBit = 1 << (selBits - 1);
      let val = selectedBits;
      if (val & signBit) {
        val |= (~0 << selBits);
      }
      return val >>> 0;
    }
    case 2: // UNUSED_PRESERVE: keep unused bits from old destination
      return ((oldDst & ~(mask << shift)) | (selectedBits << shift)) >>> 0;
    default:
      return (selectedBits << shift) >>> 0;
  }
}

/**
 * Execute a single resolved instruction on the GPU state.
 * Iterates over all 32 lanes; only lanes with their EXEC bit set are active.
 */
export function executeInstruction(state: GPUState, instr: ResolvedInstruction): void {
  const { decoded, opcodeInfo } = instr;
  const isInt = !!opcodeInfo.isIntegerOp;
  const intIn = !!opcodeInfo.integerInput;

  state.modifiedRegs.clear();

  // SOPP: program control (s_endpgm, branches, waitcnt, etc.)
  // Branching is handled in emulator.ts step(), not here.
  if (decoded.format === InstructionFormat.SOPP) {
    return;
  }

  // VOP3P: packed 16-bit operations (two 16-bit ops per lane)
  if (decoded.format === InstructionFormat.VOP3P) {
    const exec = state.exec;
    const opSel = decoded.opSel ?? 0;
    const opSelHi = decoded.opSelHi ?? 0x7; // default: all sources read hi from hi half
    const isFloat = !opcodeInfo.isIntegerOp;

    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      if (((exec >>> lane) & 1) === 0) continue;

      const s0Raw = resolveRaw(state, decoded.src0Encoded, decoded.literal, lane);
      const s1Raw = decoded.src1 !== undefined ? resolveRaw(state, decoded.src1, decoded.literal, lane) : 0;
      const s2Raw = decoded.src2 !== undefined ? resolveRaw(state, decoded.src2, decoded.literal, lane) : 0;

      // Extract 16-bit halves based on op_sel (lo) and op_sel_hi (hi)
      const s0Lo = ((opSel & 1) ? (s0Raw >>> 16) : s0Raw) & 0xFFFF;
      const s1Lo = ((opSel & 2) ? (s1Raw >>> 16) : s1Raw) & 0xFFFF;
      const s0Hi = ((opSelHi & 1) ? (s0Raw >>> 16) : s0Raw) & 0xFFFF;
      const s1Hi = ((opSelHi & 2) ? (s1Raw >>> 16) : s1Raw) & 0xFFFF;
      const s2Lo = (s2Raw) & 0xFFFF;
      const s2Hi = ((opSelHi & 4) ? (s2Raw >>> 16) : s2Raw) & 0xFFFF;

      let resultLo: number, resultHi: number;
      if (isFloat) {
        // f16 operations: convert u16 → f32, execute, convert f32 → u16
        const fResultLo = opcodeInfo.execute(f16ToF32(s0Lo), f16ToF32(s1Lo), f16ToF32(s2Lo));
        const fResultHi = opcodeInfo.execute(f16ToF32(s0Hi), f16ToF32(s1Hi), f16ToF32(s2Hi));
        resultLo = f32ToF16(fResultLo);
        resultHi = f32ToF16(fResultHi);
      } else {
        // Integer packed ops
        resultLo = opcodeInfo.execute(s0Lo, s1Lo, s2Lo) & 0xFFFF;
        resultHi = opcodeInfo.execute(s0Hi, s1Hi, s2Hi) & 0xFFFF;
      }

      // Pack result: dst_hi selects which half to write
      const dstHi = (opSelHi & 8); // bit 3 of opSelHi = dst half select
      const result = dstHi
        ? ((resultLo & 0xFFFF) | ((resultHi & 0xFFFF) << 16))
        : ((resultLo & 0xFFFF) | ((resultHi & 0xFFFF) << 16));
      state.writeVGPR_u32(decoded.dst, lane, result >>> 0);
    }
    return;
  }

  // DS: ds_swizzle_b32 — cross-lane data permutation
  if (opcodeInfo.mnemonic === 'ds_swizzle_b32') {
    const exec = state.exec;
    const control = decoded.offset ?? 0;
    const srcReg = decoded.src1!;  // DATA0 field = source VGPR index
    const dstReg = decoded.dst;
    const isQDM = (control & 0x8000) !== 0;

    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      if (((exec >>> lane) & 1) === 0) continue;
      let srcLane: number;
      if (isQDM) {
        // Quad permute mode (bit15=1): 2-bit selectors per lane within each quad
        const quadBase = lane & ~3;
        const laneInQuad = lane & 3;
        srcLane = quadBase + ((control >>> (laneInQuad * 2)) & 3);
        if (srcLane >= WAVE_WIDTH) srcLane = lane;
      } else {
        // Bitwise mode (bit15=0): full 32-thread sharing
        const andMask = control & 0x1F;
        const orMask = (control >>> 5) & 0x1F;
        const xorMask = (control >>> 10) & 0x1F;
        srcLane = ((lane & andMask) | orMask) ^ xorMask;
      }
      srcLane &= 31;
      state.writeVGPR_u32(dstReg, lane, state.readVGPR_u32(srcReg, srcLane));
    }
    return;
  }

  // DS: ds_bpermute_b32 — backward permute: each lane reads from lane[vaddr/4]
  if (opcodeInfo.mnemonic === 'ds_bpermute_b32') {
    const exec = state.exec;
    const addrReg = decoded.src0Encoded;  // ADDR = VGPR with lane indices * 4
    const dataReg = decoded.src1!;        // DATA0 = source VGPR
    const dstReg = decoded.dst;
    const results: Array<{ lane: number; value: number }> = [];

    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      if (((exec >>> lane) & 1) === 0) continue;
      const addr = state.readVGPR_u32(addrReg, lane);
      const srcLane = (addr >>> 2) & 31; // addr is byte offset, divide by 4
      results.push({ lane, value: state.readVGPR_u32(dataReg, srcLane) });
    }
    for (const { lane, value } of results) {
      state.writeVGPR_u32(dstReg, lane, value);
    }
    return;
  }

  // DS: ds_permute_b32 — forward permute: lane writes its data to lane[vaddr/4]
  if (opcodeInfo.mnemonic === 'ds_permute_b32') {
    const exec = state.exec;
    const addrReg = decoded.src0Encoded;  // ADDR = VGPR with dest lane indices * 4
    const dataReg = decoded.src1!;        // DATA0 = source VGPR
    const dstReg = decoded.dst;
    const results: Array<{ lane: number; value: number }> = [];

    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      if (((exec >>> lane) & 1) === 0) continue;
      const addr = state.readVGPR_u32(addrReg, lane);
      const dstLane = (addr >>> 2) & 31;
      results.push({ lane: dstLane, value: state.readVGPR_u32(dataReg, lane) });
    }
    for (const { lane, value } of results) {
      state.writeVGPR_u32(dstReg, lane, value);
    }
    return;
  }

  // SOP1: scalar instruction — values are already u32
  if (decoded.format === InstructionFormat.SOP1) {
    const src0Raw = resolveSsrc0(state, decoded.src0Encoded, decoded.literal);

    // s_getpc_b64: sdst = PC + 4 (address of next instruction, in bytes)
    // In our emulator, PC is instruction index. Store (pc+1)*4 as byte address.
    if (opcodeInfo.mnemonic === 's_getpc_b64') {
      const nextPC = (state.pc + 1) * 4;
      state.writeSGPR(decoded.dst, nextPC >>> 0);
      state.writeSGPR(decoded.dst + 1, 0); // high 32 bits = 0
      return;
    }

    // s_setpc_b64: PC = ssrc0 (handled in emulator.ts for actual PC update)
    // Just mark it — the emulator checks the mnemonic after execution
    if (opcodeInfo.mnemonic === 's_setpc_b64') {
      return;
    }

    // s_swappc_b64: sdst = PC + 4; PC = ssrc0
    // Save return address here, PC update handled in emulator.ts
    if (opcodeInfo.mnemonic === 's_swappc_b64') {
      const nextPC = (state.pc + 1) * 4;
      state.writeSGPR(decoded.dst, nextPC >>> 0);
      state.writeSGPR(decoded.dst + 1, 0);
      return;
    }

    // s_and_saveexec_b64: save EXEC to dst, then EXEC &= src0
    if (opcodeInfo.mnemonic === 's_and_saveexec_b64') {
      const oldExec = state.exec;
      const dst = decoded.dst;
      if (dst === VCC_LO) { state.vcc = oldExec; state.modifiedRegs.add('VCC'); }
      else { state.writeSGPR(dst, oldExec); }
      state.exec = (oldExec & src0Raw) >>> 0;
      state.scc = state.exec !== 0 ? 1 : 0;
      state.modifiedRegs.add('EXEC');
      state.modifiedRegs.add('SCC');
      return;
    }

    // s_or_saveexec_b64: save EXEC to dst, then EXEC |= src0
    if (opcodeInfo.mnemonic === 's_or_saveexec_b64') {
      const oldExec = state.exec;
      const dst = decoded.dst;
      if (dst === VCC_LO) { state.vcc = oldExec; state.modifiedRegs.add('VCC'); }
      else { state.writeSGPR(dst, oldExec); }
      state.exec = (oldExec | src0Raw) >>> 0;
      state.scc = state.exec !== 0 ? 1 : 0;
      state.modifiedRegs.add('EXEC');
      state.modifiedRegs.add('SCC');
      return;
    }

    const result = (opcodeInfo.execute(src0Raw)) >>> 0;

    // SCC for SOP1 bitwise/logic ops
    const sop1mn = opcodeInfo.mnemonic;
    if (sop1mn === 's_not_b32' || sop1mn === 's_not_b64' ||
        sop1mn === 's_wqm_b32' || sop1mn === 's_wqm_b64' ||
        sop1mn === 's_brev_b32' || sop1mn === 's_brev_b64' ||
        sop1mn === 's_bitreplicate_b64_b32') {
      state.scc = result !== 0 ? 1 : 0;
      state.modifiedRegs.add('SCC');
    } else if (sop1mn === 's_abs_i32') {
      state.scc = result !== 0 ? 1 : 0;
      state.modifiedRegs.add('SCC');
    }

    const dst = decoded.dst;
    if (dst === EXEC_LO) {
      state.exec = result;
      state.modifiedRegs.add('EXEC');
    } else if (dst === VCC_LO) {
      state.vcc = result;
      state.modifiedRegs.add('VCC');
    } else {
      state.writeSGPR(dst, result);
    }
    return;
  }

  // SOP2: 2-source scalar ALU
  if (decoded.format === InstructionFormat.SOP2) {
    const src0 = resolveSsrc0(state, decoded.src0Encoded, decoded.literal);
    const src1 = resolveSsrc0(state, decoded.src1!, decoded.literal);

    // s_cselect_b32: select src0 if SCC==1, else src1
    if (opcodeInfo.mnemonic === 's_cselect_b32' || opcodeInfo.mnemonic === 's_cselect_b64') {
      const result = (state.scc ? src0 : src1) >>> 0;
      const dst = decoded.dst;
      if (dst === EXEC_LO) { state.exec = result; state.modifiedRegs.add('EXEC'); }
      else if (dst === VCC_LO) { state.vcc = result; state.modifiedRegs.add('VCC'); }
      else { state.writeSGPR(dst, result); }
      return;
    }

    // s_addc_u32: add with carry — sdst = src0 + src1 + SCC
    if (opcodeInfo.mnemonic === 's_addc_u32') {
      const sum = (src0 >>> 0) + (src1 >>> 0) + state.scc;
      const result = sum >>> 0;
      state.scc = sum > 0xFFFFFFFF ? 1 : 0;
      state.modifiedRegs.add('SCC');
      const dst = decoded.dst;
      if (dst === EXEC_LO) { state.exec = result; state.modifiedRegs.add('EXEC'); }
      else if (dst === VCC_LO) { state.vcc = result; state.modifiedRegs.add('VCC'); }
      else { state.writeSGPR(dst, result); }
      return;
    }

    // s_subb_u32: subtract with borrow — sdst = src0 - src1 - SCC
    if (opcodeInfo.mnemonic === 's_subb_u32') {
      const diff = (src0 >>> 0) - (src1 >>> 0) - state.scc;
      const result = diff >>> 0;
      state.scc = diff < 0 ? 1 : 0;
      state.modifiedRegs.add('SCC');
      const dst = decoded.dst;
      if (dst === EXEC_LO) { state.exec = result; state.modifiedRegs.add('EXEC'); }
      else if (dst === VCC_LO) { state.vcc = result; state.modifiedRegs.add('VCC'); }
      else { state.writeSGPR(dst, result); }
      return;
    }

    const result = (opcodeInfo.execute(src0, src1)) >>> 0;

    // SCC: set for bitwise ops if result != 0, for add if overflow
    const mn = opcodeInfo.mnemonic;
    if (mn === 's_and_b32' || mn === 's_and_b64' ||
        mn === 's_or_b64' || mn === 's_xor_b64' ||
        mn === 's_andn2_b64' || mn === 's_or_b32' || mn === 's_xor_b32' ||
        mn === 's_andn2_b32' || mn === 's_nand_b32' || mn === 's_nor_b32' ||
        mn === 's_lshl_b32' || mn === 's_lshr_b32' || mn === 's_ashr_i32' ||
        mn === 's_lshl_b64' || mn === 's_lshr_b64' || mn === 's_ashr_i64' ||
        mn === 's_bfm_b32' || mn === 's_bfe_u32' || mn === 's_bfe_i32' ||
        mn === 's_absdiff_i32' || mn === 's_min_i32' || mn === 's_min_u32' ||
        mn === 's_max_i32' || mn === 's_max_u32' ||
        mn === 's_orn2_b32' || mn === 's_orn2_b64' ||
        mn === 's_nand_b64' || mn === 's_nor_b64' ||
        mn === 's_xnor_b32' || mn === 's_xnor_b64' ||
        mn === 's_bfm_b64' || mn === 's_bfe_u64' || mn === 's_bfe_i64' ||
        mn === 's_mul_hi_u32' || mn === 's_mul_hi_i32') {
      state.scc = result !== 0 ? 1 : 0;
      state.modifiedRegs.add('SCC');
    } else if (mn === 's_add_i32') {
      // Overflow: check if signs of inputs match but differ from result sign
      const signA = (src0 >>> 31) & 1;
      const signB = (src1 >>> 31) & 1;
      const signR = (result >>> 31) & 1;
      state.scc = (signA === signB && signA !== signR) ? 1 : 0;
      state.modifiedRegs.add('SCC');
    } else if (mn === 's_sub_i32') {
      // Borrow: unsigned borrow-out
      state.scc = ((src0 >>> 0) < (src1 >>> 0)) ? 1 : 0;
      state.modifiedRegs.add('SCC');
    } else if (mn === 's_add_u32') {
      // Carry-out: unsigned overflow
      const sum = (src0 >>> 0) + (src1 >>> 0);
      state.scc = sum > 0xFFFFFFFF ? 1 : 0;
      state.modifiedRegs.add('SCC');
    } else if (mn === 's_sub_u32') {
      // Borrow: unsigned borrow-out
      state.scc = ((src0 >>> 0) < (src1 >>> 0)) ? 1 : 0;
      state.modifiedRegs.add('SCC');
    }

    const dst = decoded.dst;
    if (dst === EXEC_LO) {
      state.exec = result;
      state.modifiedRegs.add('EXEC');
    } else if (dst === VCC_LO) {
      state.vcc = result;
      state.modifiedRegs.add('VCC');
    } else {
      state.writeSGPR(dst, result);
    }
    return;
  }

  // SOPC: 2-source scalar compare — result goes to SCC
  if (decoded.format === InstructionFormat.SOPC) {
    const src0 = resolveSsrc0(state, decoded.src0Encoded, decoded.literal);
    const src1 = resolveSsrc0(state, decoded.src1!, decoded.literal);
    state.scc = opcodeInfo.execute(src0, src1) ? 1 : 0;
    state.modifiedRegs.add('SCC');
    return;
  }

  // SOPK: scalar with inline 16-bit constant
  if (decoded.format === InstructionFormat.SOPK) {
    const mn = opcodeInfo.mnemonic;

    // Skip hardware config instructions
    if (mn === 's_setreg_imm32_b32' || mn === 's_waitcnt_vscnt') {
      return;
    }

    const rawSimm16 = decoded.simm16 ?? 0;
    // Sign-extend 16-bit immediate to 32-bit
    const signExtSimm16 = ((rawSimm16 << 16) >> 16);
    const dst = decoded.dst;

    if (mn === 's_movk_i32') {
      const result = signExtSimm16 >>> 0;
      state.writeSGPR(dst, result);
      return;
    }

    if (mn === 's_addk_i32') {
      const srcVal = state.readSGPR(dst);
      const sum = (srcVal >>> 0) + (signExtSimm16 >>> 0);
      const result = sum >>> 0;
      state.scc = sum > 0xFFFFFFFF ? 1 : 0;
      state.writeSGPR(dst, result);
      state.modifiedRegs.add('SCC');
      return;
    }

    if (mn === 's_mulk_i32') {
      const srcVal = state.readSGPR(dst);
      const result = Math.imul(srcVal, signExtSimm16) | 0;
      state.writeSGPR(dst, result >>> 0);
      return;
    }

    // s_cmpk_* — compare instructions
    if (mn.startsWith('s_cmpk_')) {
      const srcVal = state.readSGPR(dst);
      // For unsigned compares, use zero-extended immediate
      const isUnsigned = mn.endsWith('_u32');
      const immVal = isUnsigned ? (rawSimm16 & 0xFFFF) : signExtSimm16;
      state.scc = opcodeInfo.execute(srcVal, immVal) ? 1 : 0;
      state.modifiedRegs.add('SCC');
      return;
    }

    return;
  }

  // VOPC: float comparison instructions — write result to VCC or EXEC (v_cmpx_*)
  if (decoded.format === InstructionFormat.VOPC) {
    const isCmpx = opcodeInfo.mnemonic.startsWith('v_cmpx_');
    const isIntCmp = opcodeInfo.mnemonic.includes('_i32') || opcodeInfo.mnemonic.includes('_u32') ||
                     opcodeInfo.mnemonic.includes('_i16') || opcodeInfo.mnemonic.includes('_u16');
    let mask = 0;
    const exec = state.exec;
    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      if (((exec >>> lane) & 1) === 0) continue;

      const src0Raw = resolveRaw(state, decoded.src0Encoded, decoded.literal, lane);
      const src1Raw = resolveRaw(state, decoded.src1!, decoded.literal, lane);
      let cmpResult: number;
      if (isIntCmp) {
        cmpResult = opcodeInfo.execute(src0Raw, src1Raw);
      } else {
        const src0Val = bitsToFloat(src0Raw);
        const src1Val = bitsToFloat(src1Raw);
        cmpResult = opcodeInfo.execute(src0Val, src1Val);
      }

      if (cmpResult) {
        mask |= (1 << lane);
      }
    }
    if (isCmpx) {
      state.exec = mask >>> 0;
      state.modifiedRegs.add('EXEC');
    } else {
      state.vcc = mask >>> 0;
      state.modifiedRegs.add('VCC');
    }
    return;
  }

  // v_readfirstlane_b32: broadcast first active lane to scalar dest
  if (opcodeInfo.mnemonic === 'v_readfirstlane_b32') {
    const exec = state.exec;
    let firstVal = 0;
    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      if (((exec >>> lane) & 1) !== 0) {
        firstVal = resolveRaw(state, decoded.src0Encoded, decoded.literal, lane);
        break;
      }
    }
    // v_readfirstlane writes to an SGPR (VDST field holds SGPR index)
    const dst = decoded.dst;
    if (dst === EXEC_LO) {
      state.exec = firstVal; state.modifiedRegs.add('EXEC');
    } else if (dst === VCC_LO) {
      state.vcc = firstVal; state.modifiedRegs.add('VCC');
    } else {
      state.writeSGPR(dst, firstVal);
    }
    return;
  }

  // v_readlane_b32: read a specific lane into a scalar register
  if (opcodeInfo.mnemonic === 'v_readlane_b32') {
    // VOP3: sdst, vsrc0, ssrc1 (lane index)
    const src0Reg = decoded.src0Encoded >= 256 ? decoded.src0Encoded - 256 : decoded.src0Encoded;
    const laneIdx = resolveSsrc0(state, decoded.src1!, decoded.literal) & 31;
    const val = state.readVGPR_u32(src0Reg, laneIdx);
    const dst = decoded.dst;
    if (dst === EXEC_LO) {
      state.exec = val; state.modifiedRegs.add('EXEC');
    } else if (dst === VCC_LO) {
      state.vcc = val; state.modifiedRegs.add('VCC');
    } else {
      state.writeSGPR(dst, val);
    }
    return;
  }

  // v_writelane_b32: write a scalar value into a specific VGPR lane
  if (opcodeInfo.mnemonic === 'v_writelane_b32') {
    // VOP3: vdst, ssrc0 (value), ssrc1 (lane index)
    const val = resolveSsrc0(state, decoded.src0Encoded, decoded.literal);
    const laneIdx = resolveSsrc0(state, decoded.src1!, decoded.literal) & 31;
    state.writeVGPR_u32(decoded.dst, laneIdx, val);
    return;
  }

  // v_swap_b32: swap two VGPRs
  if (opcodeInfo.mnemonic === 'v_swap_b32') {
    const exec = state.exec;
    const src0Reg = decoded.src0Encoded >= 256 ? decoded.src0Encoded - 256 : decoded.src0Encoded;
    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      if (((exec >>> lane) & 1) === 0) continue;
      const dstVal = state.readVGPR_u32(decoded.dst, lane);
      const srcVal = state.readVGPR_u32(src0Reg, lane);
      state.writeVGPR_u32(decoded.dst, lane, srcVal);
      state.writeVGPR_u32(src0Reg, lane, dstVal);
    }
    return;
  }

  // Vector instructions: execute per active lane
  const exec = state.exec;
  const hasDpp16 = decoded.dppCtrl !== undefined;
  const hasDpp8 = decoded.dpp8 !== undefined;
  const hasDpp = hasDpp16 || hasDpp8;
  const hasSdwa = decoded.sdwaSrc0Sel !== undefined || decoded.sdwaSrc1Sel !== undefined ||
                  decoded.sdwaDstSel !== undefined;

  // When DPP is active, buffer results to avoid read-after-write hazards
  // (lane N may read lane M's VGPR via DPP, but lane M may already be written)
  const dppResults: Array<{ lane: number; value: number }> | null = hasDpp ? [] : null;

  for (let lane = 0; lane < WAVE_WIDTH; lane++) {
    if (((exec >>> lane) & 1) === 0) continue;

    // DPP: resolve src0 from a different lane
    let src0Raw: number;
    if (hasDpp16) {
      const srcLane = dpp16SourceLane(lane, decoded.dppCtrl!);
      if (srcLane < 0) {
        if (decoded.boundCtrl) {
          src0Raw = 0;
        } else {
          continue;
        }
      } else {
        src0Raw = resolveRaw(state, decoded.src0Encoded, decoded.literal, srcLane);
      }
    } else if (hasDpp8) {
      const srcLane = dpp8SourceLane(lane, decoded.dpp8!);
      src0Raw = resolveRaw(state, decoded.src0Encoded, decoded.literal, srcLane);
    } else {
      src0Raw = resolveRaw(state, decoded.src0Encoded, decoded.literal, lane);
    }

    // SDWA: extract sub-dword portion from src0
    if (hasSdwa && decoded.sdwaSrc0Sel !== undefined) {
      src0Raw = extractSel(src0Raw, decoded.sdwaSrc0Sel, !!decoded.sdwaSrc0Sext);
    }

    let result: number;

    if (isInt) {
      // Integer/bitwise ops: pass raw u32 values directly
      if (decoded.src1 !== undefined) {
        let src1Raw = resolveRaw(state, decoded.src1, decoded.literal, lane);
        if (hasSdwa && decoded.sdwaSrc1Sel !== undefined) {
          src1Raw = extractSel(src1Raw, decoded.sdwaSrc1Sel, !!decoded.sdwaSrc1Sext);
        }
        if (opcodeInfo.readsVCC) {
          const vccBit = (state.vcc >>> lane) & 1;
          result = vccBit ? src1Raw : src0Raw;
        } else if (decoded.format === InstructionFormat.VOP3 && decoded.src2 !== undefined) {
          const src2Raw = resolveRaw(state, decoded.src2, decoded.literal, lane);
          result = opcodeInfo.execute(src0Raw, src1Raw, src2Raw);
        } else {
          result = opcodeInfo.execute(src0Raw, src1Raw);
        }
      } else {
        result = opcodeInfo.execute(src0Raw);
      }
      let writeVal = result >>> 0;
      if (hasSdwa && decoded.sdwaDstSel !== undefined) {
        const oldDst = state.readVGPR_u32(decoded.dst, lane);
        writeVal = writeSel(oldDst, writeVal, decoded.sdwaDstSel, decoded.sdwaDstUnused ?? 0);
      }
      if (dppResults) { dppResults.push({ lane, value: writeVal }); }
      else { state.writeVGPR_u32(decoded.dst, lane, writeVal); }
    } else if (intIn) {
      // Integer input, float output (v_cvt_f32_i32, v_cvt_f32_u32, v_cvt_f32_ubyte*)
      // Pass raw u32 to execute, get float back, bitcast for storage
      const floatResult = opcodeInfo.execute(src0Raw);
      let writeVal = floatBits(floatResult);
      if (hasSdwa && decoded.sdwaDstSel !== undefined) {
        const oldDst = state.readVGPR_u32(decoded.dst, lane);
        writeVal = writeSel(oldDst, writeVal, decoded.sdwaDstSel, decoded.sdwaDstUnused ?? 0);
      }
      if (dppResults) { dppResults.push({ lane, value: writeVal }); }
      else { state.writeVGPR_u32(decoded.dst, lane, writeVal); }
    } else {
      // Float ops: bitcast u32 → float, apply modifiers, execute, bitcast back
      let src0Val = bitsToFloat(src0Raw);
      if (decoded.src0Abs) src0Val = Math.abs(src0Val);
      if (decoded.src0Neg) src0Val = -src0Val;

      if (decoded.format === InstructionFormat.VOP3 && decoded.src2 !== undefined) {
        let src1Val = bitsToFloat(resolveRaw(state, decoded.src1!, decoded.literal, lane));
        if (decoded.src1Abs) src1Val = Math.abs(src1Val);
        if (decoded.src1Neg) src1Val = -src1Val;
        let src2Val = bitsToFloat(resolveRaw(state, decoded.src2, decoded.literal, lane));
        if (decoded.src2Abs) src2Val = Math.abs(src2Val);
        if (decoded.src2Neg) src2Val = -src2Val;
        result = opcodeInfo.execute(src0Val, src1Val, src2Val);
      } else if (decoded.src1 !== undefined) {
        let src1Raw = resolveRaw(state, decoded.src1, decoded.literal, lane);
        if (hasSdwa && decoded.sdwaSrc1Sel !== undefined) {
          src1Raw = extractSel(src1Raw, decoded.sdwaSrc1Sel, !!decoded.sdwaSrc1Sext);
        }
        let src1Val = bitsToFloat(src1Raw);
        if (decoded.src1Abs) src1Val = Math.abs(src1Val);
        if (decoded.src1Neg) src1Val = -src1Val;
        if (opcodeInfo.mnemonic === 'v_fmac_f32') {
          // Fused multiply-accumulate: vdst += src0 * vsrc1
          const dstVal = bitsToFloat(state.readVGPR_u32(decoded.dst, lane));
          result = asFloat(src0Val * src1Val + dstVal);
        } else {
          result = opcodeInfo.execute(src0Val, src1Val);
        }
      } else {
        result = opcodeInfo.execute(src0Val);
      }

      // Apply output modifiers (OMOD then CLAMP) on float before bitcasting
      if (decoded.omod) {
        switch (decoded.omod) {
          case 1: result = result * 2.0; break;
          case 2: result = result * 4.0; break;
          case 3: result = result * 0.5; break;
        }
      }
      if (decoded.clamp) {
        result = Math.max(0.0, Math.min(1.0, result));
      }

      let writeVal = opcodeInfo.integerOutput ? (result >>> 0) : floatBits(result);
      if (hasSdwa && decoded.sdwaDstSel !== undefined) {
        const oldDst = state.readVGPR_u32(decoded.dst, lane);
        writeVal = writeSel(oldDst, writeVal, decoded.sdwaDstSel, decoded.sdwaDstUnused ?? 0);
      }
      if (dppResults) { dppResults.push({ lane, value: writeVal }); }
      else { state.writeVGPR_u32(decoded.dst, lane, writeVal); }
    }
  }

  // Flush buffered DPP results
  if (dppResults) {
    for (const { lane, value } of dppResults) {
      state.writeVGPR_u32(decoded.dst, lane, value);
    }
  }
}
