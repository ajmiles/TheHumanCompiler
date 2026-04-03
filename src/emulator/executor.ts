// ── Instruction Executor ──
// Executes a single resolved instruction across all active lanes

import { InstructionFormat } from '../isa/types';
import {
  WAVE_WIDTH,
  LITERAL_CONST,
  decodeInlineConstant,
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

/**
 * Resolve the SRC0 operand value for a given lane.
 *
 * The 9-bit src0Encoded field can reference:
 *  - VGPR (256-511): per-lane float value
 *  - SGPR (0-105): scalar uint32, reinterpreted as float
 *  - Inline constant (128-247): decoded integer or float constant
 *  - Literal (255): 32-bit literal from the instruction stream, reinterpreted as float
 */
function resolveSrc0(state: GPUState, src0Encoded: number, literal: number | undefined, lane: number): number {
  // VGPR source — already stored as float32
  if (isVGPR(src0Encoded)) {
    return state.readVGPR(vgprIndex(src0Encoded), lane);
  }

  // SGPR source — stored as uint32, reinterpret bits as float
  if (isSGPR(src0Encoded)) {
    return bitsToFloat(state.readSGPR(src0Encoded));
  }

  // Literal constant — uint32 bit pattern, reinterpret as float
  if (src0Encoded === LITERAL_CONST) {
    if (literal === undefined) {
      throw new Error('Literal constant referenced but no literal value present');
    }
    return bitsToFloat(literal);
  }

  // Inline constant — decodeInlineConstant returns the numeric value directly.
  // For inline floats (0.5, 1.0, etc.) it returns the float.
  // For inline integers (0-64, -1 to -16) it returns the integer.
  // The execute function decides how to interpret the value (float vs int).
  return decodeInlineConstant(src0Encoded);
}

/**
 * Execute a single resolved instruction on the GPU state.
 * Iterates over all 32 lanes; only lanes with their EXEC bit set are active.
 */
export function executeInstruction(state: GPUState, instr: ResolvedInstruction): void {
  const { decoded, opcodeInfo } = instr;

  state.modifiedRegs.clear();

  // SOPP: program control (e.g. s_endpgm)
  if (opcodeInfo.halts) {
    return; // executor returns; emulator's step() advances PC past the end
  }

  // SOP1: scalar instruction, writes to SGPR or special register
  if (decoded.format === InstructionFormat.SOP1) {
    const src0Val = resolveSsrc0(state, decoded.src0Encoded, decoded.literal);
    const result = (opcodeInfo.execute(src0Val)) >>> 0;

    // Write to destination (may be special register)
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

  // VOPC: comparison instructions — write result to VCC
  if (decoded.format === InstructionFormat.VOPC) {
    let vcc = 0;
    const exec = state.exec;
    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      if (((exec >>> lane) & 1) === 0) continue;

      const src0Val = resolveSrc0(state, decoded.src0Encoded, decoded.literal, lane);
      const src1Val = state.readVGPR(decoded.src1!, lane);
      const cmpResult = opcodeInfo.execute(src0Val, src1Val);

      if (cmpResult) {
        vcc |= (1 << lane);
      }
    }
    state.vcc = vcc >>> 0;
    state.modifiedRegs.add('VCC');
    return;
  }

  // Vector instructions: execute per active lane
  const exec = state.exec;
  for (let lane = 0; lane < WAVE_WIDTH; lane++) {
    if (((exec >>> lane) & 1) === 0) continue;

    let src0Val = resolveSrc0(state, decoded.src0Encoded, decoded.literal, lane);
    if (decoded.src0Abs) src0Val = Math.abs(src0Val);
    if (decoded.src0Neg) src0Val = -src0Val;

    let result: number;

    if (decoded.format === InstructionFormat.VOP3 && decoded.src2 !== undefined) {
      // 3-source VOP3 (e.g. v_fma_f32)
      let src1Val = resolveSrc0(state, decoded.src1!, decoded.literal, lane);
      if (decoded.src1Abs) src1Val = Math.abs(src1Val);
      if (decoded.src1Neg) src1Val = -src1Val;
      let src2Val = resolveSrc0(state, decoded.src2, decoded.literal, lane);
      if (decoded.src2Abs) src2Val = Math.abs(src2Val);
      if (decoded.src2Neg) src2Val = -src2Val;
      result = opcodeInfo.execute(src0Val, src1Val, src2Val);
    } else if (decoded.src1 !== undefined) {
      // 2-source (VOP2, promoted VOP2, or VOPC with src1)
      let src1Val = resolveSrc0(state, decoded.src1, decoded.literal, lane);
      if (decoded.src1Abs) src1Val = Math.abs(src1Val);
      if (decoded.src1Neg) src1Val = -src1Val;

      if (opcodeInfo.readsVCC) {
        const vccBit = (state.vcc >>> lane) & 1;
        result = vccBit ? src1Val : src0Val;
      } else {
        result = opcodeInfo.execute(src0Val, src1Val);
      }
    } else {
      result = opcodeInfo.execute(src0Val);
    }

    // Apply output modifiers (OMOD then CLAMP)
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

    state.writeVGPR(decoded.dst, lane, result);
  }
}

/**
 * Resolve SOP1 SSRC0 operand (8-bit scalar source).
 */
function resolveSsrc0(state: GPUState, encoded: number, literal: number | undefined): number {
  if (isSGPR(encoded)) return state.readSGPR(encoded);
  if (encoded === EXEC_LO) return state.exec;
  if (encoded === VCC_LO) return state.vcc;
  if (encoded === 0xFF && literal !== undefined) return literal;
  if (encoded >= 128 && encoded <= 247) return decodeInlineConstant(encoded);
  return 0;
}
