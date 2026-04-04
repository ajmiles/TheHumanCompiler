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

  // SOP1: scalar instruction — values are already u32
  if (decoded.format === InstructionFormat.SOP1) {
    const src0Raw = resolveSsrc0(state, decoded.src0Encoded, decoded.literal);

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
    if (opcodeInfo.mnemonic === 's_cselect_b32') {
      const result = (state.scc ? src0 : src1) >>> 0;
      const dst = decoded.dst;
      if (dst === EXEC_LO) { state.exec = result; state.modifiedRegs.add('EXEC'); }
      else if (dst === VCC_LO) { state.vcc = result; state.modifiedRegs.add('VCC'); }
      else { state.writeSGPR(dst, result); }
      return;
    }

    const result = (opcodeInfo.execute(src0, src1)) >>> 0;

    // SCC: set for bitwise ops if result != 0, for add if overflow
    if (opcodeInfo.mnemonic === 's_and_b32' || opcodeInfo.mnemonic === 's_and_b64' ||
        opcodeInfo.mnemonic === 's_or_b64' || opcodeInfo.mnemonic === 's_xor_b64' ||
        opcodeInfo.mnemonic === 's_andn2_b64') {
      state.scc = result !== 0 ? 1 : 0;
      state.modifiedRegs.add('SCC');
    } else if (opcodeInfo.mnemonic === 's_lshl_b32') {
      state.scc = result !== 0 ? 1 : 0;
      state.modifiedRegs.add('SCC');
    } else if (opcodeInfo.mnemonic === 's_add_i32') {
      // Overflow: check if signs of inputs match but differ from result sign
      const signA = (src0 >>> 31) & 1;
      const signB = (src1 >>> 31) & 1;
      const signR = (result >>> 31) & 1;
      state.scc = (signA === signB && signA !== signR) ? 1 : 0;
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

  // SOPK: scalar with inline 16-bit constant — hardware config, NOP in emulator
  if (decoded.format === InstructionFormat.SOPK) {
    return;
  }

  // VOPC: float comparison instructions — write result to VCC or EXEC (v_cmpx_*)
  if (decoded.format === InstructionFormat.VOPC) {
    const isCmpx = opcodeInfo.mnemonic.startsWith('v_cmpx_');
    const isIntCmp = opcodeInfo.mnemonic.includes('_i32') || opcodeInfo.mnemonic.includes('_u32');
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
    let result: number;

    if (isInt) {
      // Integer/bitwise ops: pass raw u32 values directly
      if (decoded.src1 !== undefined) {
        const src1Raw = resolveRaw(state, decoded.src1, decoded.literal, lane);
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
      const writeVal = result >>> 0;
      if (dppResults) { dppResults.push({ lane, value: writeVal }); }
      else { state.writeVGPR_u32(decoded.dst, lane, writeVal); }
    } else if (intIn) {
      // Integer input, float output (v_cvt_f32_i32, v_cvt_f32_u32, v_cvt_f32_ubyte*)
      // Pass raw u32 to execute, get float back, bitcast for storage
      const floatResult = opcodeInfo.execute(src0Raw);
      const writeVal = floatBits(floatResult);
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
        let src1Val = bitsToFloat(resolveRaw(state, decoded.src1, decoded.literal, lane));
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

      const writeVal = opcodeInfo.integerOutput ? (result >>> 0) : floatBits(result);
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
