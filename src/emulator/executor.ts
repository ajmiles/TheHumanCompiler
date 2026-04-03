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
 * Execute a single resolved instruction on the GPU state.
 * Iterates over all 32 lanes; only lanes with their EXEC bit set are active.
 */
export function executeInstruction(state: GPUState, instr: ResolvedInstruction): void {
  const { decoded, opcodeInfo } = instr;
  const isInt = !!opcodeInfo.isIntegerOp;
  const intIn = !!opcodeInfo.integerInput;

  state.modifiedRegs.clear();

  // SOPP: program control (e.g. s_endpgm)
  if (opcodeInfo.halts) {
    return;
  }

  // SOP1: scalar instruction — values are already u32
  if (decoded.format === InstructionFormat.SOP1) {
    const src0Raw = resolveSsrc0(state, decoded.src0Encoded, decoded.literal);
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

  // VOPC: float comparison instructions — bitcast to float, write result to VCC
  if (decoded.format === InstructionFormat.VOPC) {
    let vcc = 0;
    const exec = state.exec;
    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      if (((exec >>> lane) & 1) === 0) continue;

      const src0Raw = resolveRaw(state, decoded.src0Encoded, decoded.literal, lane);
      const src1Raw = resolveRaw(state, decoded.src1!, decoded.literal, lane);
      const src0Val = bitsToFloat(src0Raw);
      const src1Val = bitsToFloat(src1Raw);
      const cmpResult = opcodeInfo.execute(src0Val, src1Val);

      if (cmpResult) {
        vcc |= (1 << lane);
      }
    }
    state.vcc = vcc >>> 0;
    state.modifiedRegs.add('VCC');
    return;
  }

  // v_readfirstlane_b32: broadcast first active lane to all lanes
  if (opcodeInfo.mnemonic === 'v_readfirstlane_b32') {
    const exec = state.exec;
    let firstVal = 0;
    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      if (((exec >>> lane) & 1) !== 0) {
        firstVal = resolveRaw(state, decoded.src0Encoded, decoded.literal, lane);
        break;
      }
    }
    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      state.writeVGPR_u32(decoded.dst, lane, firstVal);
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
  for (let lane = 0; lane < WAVE_WIDTH; lane++) {
    if (((exec >>> lane) & 1) === 0) continue;

    const src0Raw = resolveRaw(state, decoded.src0Encoded, decoded.literal, lane);
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
      state.writeVGPR_u32(decoded.dst, lane, result >>> 0);
    } else if (intIn) {
      // Integer input, float output (v_cvt_f32_i32, v_cvt_f32_u32, v_cvt_f32_ubyte*)
      // Pass raw u32 to execute, get float back, bitcast for storage
      const floatResult = opcodeInfo.execute(src0Raw);
      state.writeVGPR_u32(decoded.dst, lane, floatBits(floatResult));
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
        result = opcodeInfo.execute(src0Val, src1Val);
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

      state.writeVGPR_u32(decoded.dst, lane,
        opcodeInfo.integerOutput ? (result >>> 0) : floatBits(result));
    }
  }
}
