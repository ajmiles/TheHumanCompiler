// ── Instruction Executor ──
// Executes one decoded instruction on the wave state. Registers hold raw 32-bit patterns;
// operands are converted according to the opcode's operand types (f32, f16, 16/32-bit integer).

import { InstructionFormat, DecodedInstruction, OpcodeInfo, ValueType, SaluContext } from '../isa/types';
import {
  WAVE_WIDTH,
  LITERAL_CONST,
  VGPR_SRC_MIN,
  INLINE_FLOAT_MAP,
  INLINE_FLOAT16_BITS,
  VCC_LO,
  EXEC_LO,
  M0_REG,
  SRC_VCCZ,
  SRC_EXECZ,
  SRC_SCC,
  NUM_VGPRS,
} from '../isa/constants';
import { f16ToF32, f32ToF16 } from '../isa/float16';
import { sadU8, msadU8 } from '../isa/opcodes';
import { vopTypes, valuSourceCount, isFloatType, is16BitType } from '../isa/operands';
import { GPUState, LDS_SIZE_BYTES } from './state';
import { ResolvedInstruction } from './decoder';

/** An instruction the emulator cannot execute (unsupported format, bad register index, …). */
export class EmulatorFault extends Error {}

function fault(message: string): never {
  throw new EmulatorFault(message);
}

/** Program-counter effect of an instruction (undefined = fall through to the next instruction). */
export type ControlFlow =
  | { kind: 'halt' }
  | { kind: 'branch'; offset: number }      // SIMM16 dwords relative to the next instruction
  | { kind: 'jump'; byteAddress: number };  // Absolute byte address (s_setpc_b64 / s_swappc_b64)

export interface ExecContext {
  /** Byte address of the next sequential instruction (s_getpc_b64, s_swappc_b64). */
  nextPcBytes: number;
}

// ── Bit helpers ──

const f32a = new Float32Array(1);
const u32a = new Uint32Array(f32a.buffer);
const f64a = new Float64Array(1);
const u64a = new BigUint64Array(f64a.buffer);

function bitsToFloat(bits: number): number {
  u32a[0] = bits >>> 0;
  return f32a[0];
}

function floatBits(v: number): number {
  f32a[0] = v;
  return u32a[0];
}

function f64Bits(v: number): bigint {
  f64a[0] = v;
  return u64a[0];
}

const M64 = 0xFFFFFFFFFFFFFFFFn;
const sx16 = (v: number) => (v << 16) >> 16;
const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isActive = (exec: number, lane: number) => ((exec >>> lane) & 1) === 1;

function popcount32(v: number): number {
  let n = 0;
  for (let x = v >>> 0; x !== 0; x >>>= 1) n += x & 1;
  return n;
}

// ── Operand reads ──

function inlineInt(enc: number): number | undefined {
  if (enc >= 128 && enc <= 192) return enc - 128;
  if (enc >= 193 && enc <= 208) return 192 - enc;
  return undefined;
}

/** Read a 32-bit scalar operand: SGPR, VCC, M0, EXEC, inline constant, SCC/VCCZ/EXECZ or literal. */
function readScalar32(state: GPUState, enc: number, literal: number | undefined, f16 = false): number {
  if (enc <= 127) return state.readSGPR(enc);
  const i = inlineInt(enc);
  if (i !== undefined) return i >>> 0;
  if (enc >= 240 && enc <= 248) return f16 ? INLINE_FLOAT16_BITS[enc] : floatBits(INLINE_FLOAT_MAP[enc]);
  switch (enc) {
    case SRC_VCCZ: return state.vcc === 0 ? 1 : 0;
    case SRC_EXECZ: return state.exec === 0 ? 1 : 0;
    case SRC_SCC: return state.scc;
    case LITERAL_CONST:
      if (literal === undefined) fault('The instruction is missing its literal constant');
      return literal >>> 0;
    case 254:
      return fault('LDS_DIRECT operands are not supported by the emulator');
    default:
      return 0;
  }
}

/** Read a 64-bit scalar operand. Inline floats are f64 values; literals are zero- or sign-extended. */
function readScalar64(state: GPUState, enc: number, literal: number | undefined, signedLiteral = false): bigint {
  if (enc <= 127) return state.readSGPR64(enc);
  const i = inlineInt(enc);
  if (i !== undefined) return BigInt.asUintN(64, BigInt(i));
  if (enc >= 240 && enc <= 248) return f64Bits(enc === 248 ? 1 / (2 * Math.PI) : INLINE_FLOAT_MAP[enc]);
  if (enc === LITERAL_CONST) {
    if (literal === undefined) fault('The instruction is missing its literal constant');
    return signedLiteral ? BigInt.asUintN(64, BigInt(literal | 0)) : BigInt(literal >>> 0);
  }
  return BigInt(readScalar32(state, enc, literal));
}

/** Read a 9-bit VALU source for one lane. */
function readLane(state: GPUState, enc: number, lane: number, literal: number | undefined, f16 = false): number {
  return enc >= VGPR_SRC_MIN ? state.readVGPR_u32(enc - VGPR_SRC_MIN, lane) : readScalar32(state, enc, literal, f16);
}

/** Read a 64-bit VALU source (VGPR pair, SGPR pair or constant) for one lane. */
function readLane64(state: GPUState, enc: number, lane: number, literal: number | undefined, signedLiteral = false): bigint {
  if (enc >= VGPR_SRC_MIN) {
    const r = enc - VGPR_SRC_MIN;
    return BigInt(state.readVGPR_u32(r, lane)) | (BigInt(state.readVGPR_u32(r + 1, lane)) << 32n);
  }
  return readScalar64(state, enc, literal, signedLiteral);
}

function writeLane64(state: GPUState, reg: number, lane: number, value: bigint): void {
  state.writeVGPR_u32(reg, lane, Number(value & 0xFFFFFFFFn));
  state.writeVGPR_u32(reg + 1, lane, Number((value >> 32n) & 0xFFFFFFFFn));
}

// ── Typed values ──

/** Convert raw register bits to the value passed to an opcode's semantic function. */
function typed(raw: number, t: ValueType, hi: boolean): number {
  switch (t) {
    case 'f32': return bitsToFloat(raw);
    case 'f16': return f16ToF32(hi ? raw >>> 16 : raw & 0xFFFF);
    case 'u16':
    case 'b16': return hi ? raw >>> 16 : raw & 0xFFFF;
    case 'i16': return sx16(hi ? raw >>> 16 : raw & 0xFFFF);
    default: return raw >>> 0;
  }
}

function applyModifiers(v: number, t: ValueType, abs: boolean, neg: boolean): number {
  if (!abs && !neg) return v;
  if (isFloatType(t)) {
    if (abs) v = Math.abs(v);
    return neg ? -v : v;
  }
  // VOP3 abs/neg on a bitwise operand (v_cndmask_b32) act on the sign bit
  if (abs) v = (v & 0x7FFFFFFF) >>> 0;
  return neg ? (v ^ 0x80000000) >>> 0 : v;
}

/** Convert a semantic-function result to raw destination bits (16-bit types return 16 bits). */
function toBits(v: number, t: ValueType): number {
  switch (t) {
    case 'f32': return floatBits(v);
    case 'f16': return f32ToF16(v);
    case 'u16':
    case 'i16':
    case 'b16': return v & 0xFFFF;
    default: return v >>> 0;
  }
}

/** OMOD then CLAMP for floating-point results (DX10 clamp: NaN becomes 0). */
function outputModifiers(v: number, d: DecodedInstruction): number {
  if (d.omod === 1) v *= 2;
  else if (d.omod === 2) v *= 4;
  else if (d.omod === 3) v *= 0.5;
  if (d.clamp) v = Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v));
  return v;
}

/** Write a 16-bit result into one half of a register, preserving the other half. */
function writeHalf(old: number, half: number, hi: boolean): number {
  return hi ? (((half & 0xFFFF) << 16) | (old & 0xFFFF)) >>> 0 : ((old & 0xFFFF0000) | (half & 0xFFFF)) >>> 0;
}

const sx24 = (v: number) => (v << 8) >> 8;
const U32_MAX = 0xFFFFFFFF;
const I32_MIN = -0x80000000;
const I32_MAX = 0x7FFFFFFF;

/**
 * Integer instructions whose exact result can overflow: with the VOP3/SDWA clamp bit they saturate to
 * the range of the result type instead of wrapping.
 */
const SATURATING: Record<string, (a: number, b: number, c: number) => number> = {
  v_add_nc_u32: (a, b) => clampN(a + b, 0, U32_MAX),
  v_sub_nc_u32: (a, b) => clampN(a - b, 0, U32_MAX),
  v_subrev_nc_u32: (a, b) => clampN(b - a, 0, U32_MAX),
  v_add_nc_i32: (a, b) => clampN((a | 0) + (b | 0), I32_MIN, I32_MAX),
  v_sub_nc_i32: (a, b) => clampN((a | 0) - (b | 0), I32_MIN, I32_MAX),
  v_add_nc_u16: (a, b) => clampN(a + b, 0, 0xFFFF),
  v_sub_nc_u16: (a, b) => clampN(a - b, 0, 0xFFFF),
  v_add3_u32: (a, b, c) => clampN(a + b + c, 0, U32_MAX),
  v_xad_u32: (a, b, c) => clampN(((a ^ b) >>> 0) + c, 0, U32_MAX),
  v_mul_u32_u24: (a, b) => clampN((a & 0xFFFFFF) * (b & 0xFFFFFF), 0, U32_MAX),
  v_mul_i32_i24: (a, b) => clampN(sx24(a) * sx24(b), I32_MIN, I32_MAX),
  v_mad_u32_u24: (a, b, c) => clampN((a & 0xFFFFFF) * (b & 0xFFFFFF) + c, 0, U32_MAX),
  v_mad_i32_i24: (a, b, c) => clampN(sx24(a) * sx24(b) + (c | 0), I32_MIN, I32_MAX),
  v_mul_lo_u32: (a, b) => clampN(a * b, 0, U32_MAX),
  v_sad_u8: (a, b, c) => clampN(sadU8(a, b, 0) + c, 0, U32_MAX),
  v_sad_hi_u8: (a, b, c) => clampN(sadU8(a, b, 0) * 0x10000 + c, 0, U32_MAX),
  v_sad_u16: (a, b, c) => clampN(Math.abs((a & 0xFFFF) - (b & 0xFFFF)) + Math.abs((a >>> 16) - (b >>> 16)) + c, 0, U32_MAX),
  v_sad_u32: (a, b, c) => clampN(Math.abs((a | 0) - (b | 0)) + c, 0, U32_MAX),
  v_msad_u8: (a, b, c) => clampN(msadU8(a, b, 0) + c, 0, U32_MAX),
};

const PACKED_SATURATING: Record<string, (a: number, b: number, c: number) => number> = {
  v_pk_add_u16: (a, b) => clampN(a + b, 0, 0xFFFF),
  v_pk_sub_u16: (a, b) => clampN(a - b, 0, 0xFFFF),
  v_pk_add_i16: (a, b) => clampN(sx16(a) + sx16(b), -0x8000, 0x7FFF),
  v_pk_sub_i16: (a, b) => clampN(sx16(a) - sx16(b), -0x8000, 0x7FFF),
  v_pk_mul_lo_u16: (a, b) => clampN(a * b, 0, 0xFFFF),
  v_pk_mad_u16: (a, b, c) => clampN(a * b + c, 0, 0xFFFF),
  v_pk_mad_i16: (a, b, c) => clampN(sx16(a) * sx16(b) + sx16(c), -0x8000, 0x7FFF),
};

/** Instructions producing two packed f16 results: clamp limits each half to [0.0, 1.0]. */
const PACKED_F16_RESULT = new Set(['v_cvt_pkrtz_f16_f32', 'v_pack_b32_f16']);

function clampPackedF16(bits: number): number {
  const half = (h: number) => {
    const v = f16ToF32(h);
    return f32ToF16(Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v)));
  };
  return (half(bits & 0xFFFF) | (half(bits >>> 16) << 16)) >>> 0;
}

// ── SDWA ──

function sdwaSelect(raw: number, sel: number, sext: boolean): number {
  if (sel >= 6) return raw >>> 0;
  const width = sel <= 3 ? 8 : 16;
  const shift = sel <= 3 ? sel * 8 : (sel - 4) * 16;
  const field = (raw >>> shift) & (width === 8 ? 0xFF : 0xFFFF);
  return sext ? ((field << (32 - width)) >> (32 - width)) >>> 0 : field;
}

function sdwaWrite(old: number, result: number, dstSel: number, dstUnused: number): number {
  if (dstSel >= 6) return result >>> 0;
  const width = dstSel <= 3 ? 8 : 16;
  const shift = dstSel <= 3 ? dstSel * 8 : (dstSel - 4) * 16;
  const mask = width === 8 ? 0xFF : 0xFFFF;
  const field = result & mask;
  switch (dstUnused) {
    case 1: // UNUSED_SEXT: sign-extend into the bits above the field, zero the bits below
      return (((field << (32 - width)) >> (32 - width)) << shift) >>> 0;
    case 2: // UNUSED_PRESERVE
      return ((old & ~(mask << shift)) | (field << shift)) >>> 0;
    default: // UNUSED_PAD
      return (field << shift) >>> 0;
  }
}

// ── DPP ──

/** DPP16 source lane for `lane`, or -1 when the source is outside the row. */
function dpp16Source(lane: number, ctrl: number): number {
  const row = lane & ~15;
  const r = lane & 15;
  if (ctrl <= 0xFF) return (lane & ~3) + ((ctrl >> ((lane & 3) * 2)) & 3);           // quad_perm
  if (ctrl >= 0x101 && ctrl <= 0x10F) {                                                // row_shl: lane n reads n+k
    const s = r + (ctrl & 0xF);
    return s < 16 ? row + s : -1;
  }
  if (ctrl >= 0x111 && ctrl <= 0x11F) {                                                // row_shr: lane n reads n-k
    const s = r - (ctrl & 0xF);
    return s >= 0 ? row + s : -1;
  }
  if (ctrl >= 0x121 && ctrl <= 0x12F) return row + ((r - (ctrl & 0xF)) & 15);         // row_ror
  if (ctrl === 0x140) return row + (15 - r);                                           // row_mirror
  if (ctrl === 0x141) return (lane & ~7) + (7 - (lane & 7));                           // row_half_mirror
  if (ctrl >= 0x150 && ctrl <= 0x15F) return row + (ctrl & 0xF);                       // row_share
  if (ctrl >= 0x160 && ctrl <= 0x16F) return row + (r ^ (ctrl & 0xF));                // row_xmask
  return lane;
}

const LANE_DISABLED = -1;
const READ_ZERO = -2;

/**
 * Lane that src0 is read from (DPP), LANE_DISABLED when the lane must not be written,
 * or READ_ZERO when src0 reads as 0 (bound_ctrl / DPP8 inactive source).
 */
function src0Lane(d: DecodedInstruction, exec: number, lane: number): number {
  if (d.extra === 'DPP16') {
    if (!(((d.rowMask ?? 0xF) >> (lane >> 4)) & 1) || !(((d.bankMask ?? 0xF) >> ((lane >> 2) & 3)) & 1)) return LANE_DISABLED;
    const s = dpp16Source(lane, d.dppCtrl ?? 0);
    if (s >= 0 && (d.fetchInactive || isActive(exec, s))) return s;
    return d.boundCtrl ? READ_ZERO : LANE_DISABLED;
  }
  if (d.extra === 'DPP8') {
    const s = (lane & ~7) + (d.dpp8?.[lane & 7] ?? (lane & 7));
    return d.fetchInactive || isActive(exec, s) ? s : READ_ZERO;
  }
  return lane;
}

// ── VALU ──

type ValuHandler = (state: GPUState, d: DecodedInstruction, info: OpcodeInfo) => void;

function requireVgpr(enc: number, info: OpcodeInfo): number {
  if (enc < VGPR_SRC_MIN) fault(`${info.mnemonic} needs a VGPR source operand`);
  return enc - VGPR_SRC_MIN;
}

function movrel(state: GPUState, d: DecodedInstruction, info: OpcodeInfo, kind: 'd' | 's' | 'sd' | 'sd2'): void {
  const m0 = state.readSGPR(M0_REG);
  const srcOff = kind === 'd' ? 0 : kind === 'sd2' ? m0 & 0x3FF : m0;
  const dstOff = kind === 's' ? 0 : kind === 'sd2' ? (m0 >>> 16) & 0x3FF : m0;
  const srcIsVgpr = d.src0Encoded >= VGPR_SRC_MIN;
  if (kind !== 'd' && !srcIsVgpr) fault(`${info.mnemonic} needs a VGPR source operand`);
  const dst = d.dst + dstOff;
  const src = srcIsVgpr ? d.src0Encoded - VGPR_SRC_MIN + srcOff : -1;
  if (dst >= NUM_VGPRS || src >= NUM_VGPRS) {
    fault(`${info.mnemonic}: the M0-relative register index (M0 = ${m0}) points past v${NUM_VGPRS - 1}`);
  }
  state.maxIndirectVgpr = Math.max(state.maxIndirectVgpr, dst, src);
  const exec = state.exec;
  const isSdwa = d.extra === 'SDWA';
  const writes: Array<[number, number]> = [];
  for (let lane = 0; lane < WAVE_WIDTH; lane++) {
    if (!isActive(exec, lane)) continue;
    // DPP picks the lane that the (M0-indexed) source register is read from
    const l0 = src0Lane(d, exec, lane);
    if (l0 === LANE_DISABLED) continue;
    let v = l0 === READ_ZERO ? 0 : srcIsVgpr ? state.readVGPR_u32(src, l0) : readScalar32(state, d.src0Encoded, d.literal);
    if (isSdwa) {
      v = sdwaWrite(state.readVGPR_u32(dst, lane), sdwaSelect(v, d.sdwaSrc0Sel ?? 6, !!d.sdwaSrc0Sext),
        d.sdwaDstSel ?? 6, d.sdwaDstUnused ?? 0);
    }
    writes.push([lane, v]);
  }
  for (const [lane, v] of writes) state.writeVGPR_u32(dst, lane, v);
}

function permlane(state: GPUState, d: DecodedInstruction, info: OpcodeInfo, cross: boolean): void {
  const exec = state.exec;
  const src = requireVgpr(d.src0Encoded, info);
  const sel = (BigInt(readScalar32(state, d.src2 ?? 0, d.literal)) << 32n) | BigInt(readScalar32(state, d.src1 ?? 0, d.literal));
  const fi = ((d.opSel ?? 0) & 1) !== 0;
  const bc = ((d.opSel ?? 0) & 2) !== 0;
  const writes: Array<[number, number]> = [];
  for (let lane = 0; lane < WAVE_WIDTH; lane++) {
    if (!isActive(exec, lane)) continue;
    const row = cross ? (lane >> 4) ^ 1 : lane >> 4;
    const s = row * 16 + Number((sel >> BigInt((lane & 15) * 4)) & 0xFn);
    if (fi || isActive(exec, s)) writes.push([lane, state.readVGPR_u32(src, s)]);
    else if (bc) writes.push([lane, 0]);
  }
  for (const [lane, v] of writes) state.writeVGPR_u32(d.dst, lane, v);
}

/** Per-lane helper for instructions that read 32-bit sources and write a 64-bit VGPR pair. */
function perLane64(state: GPUState, d: DecodedInstruction, fn: (lane: number) => bigint): void {
  const exec = state.exec;
  const writes: Array<[number, bigint]> = [];
  for (let lane = 0; lane < WAVE_WIDTH; lane++) if (isActive(exec, lane)) writes.push([lane, fn(lane)]);
  for (const [lane, v] of writes) writeLane64(state, d.dst, lane, v);
}

function shift64(state: GPUState, d: DecodedInstruction, op: (v: bigint, n: bigint) => bigint, signed: boolean): void {
  perLane64(state, d, (lane) => {
    const n = BigInt(readLane(state, d.src0Encoded, lane, d.literal) & 63);
    return op(readLane64(state, d.src1 ?? 0, lane, d.literal, signed), n) & M64;
  });
}

function mad64(state: GPUState, d: DecodedInstruction, signed: boolean): void {
  let carry = 0;
  const [lo, hi] = signed ? [-(1n << 63n), (1n << 63n) - 1n] : [0n, M64];
  perLane64(state, d, (lane) => {
    const a = readLane(state, d.src0Encoded, lane, d.literal);
    const b = readLane(state, d.src1 ?? 0, lane, d.literal);
    const c = readLane64(state, d.src2 ?? 0, lane, d.literal, signed);
    const exact = signed
      ? BigInt(a | 0) * BigInt(b | 0) + BigInt.asIntN(64, c)
      : BigInt(a >>> 0) * BigInt(b >>> 0) + c;
    if ((BigInt.asUintN(65, exact) >> 64n) & 1n) carry |= 1 << lane; // bit 64 of the 65-bit result
    // clamp saturates the 64-bit result to its signed/unsigned range
    const result = d.clamp ? (exact < lo ? lo : exact > hi ? hi : exact) : exact;
    return BigInt.asUintN(64, result);
  });
  state.writeSGPR(d.sdst ?? VCC_LO, carry >>> 0);
}

function quadSad(state: GPUState, d: DecodedInstruction, masked: boolean, wide: boolean): void {
  const exec = state.exec;
  const sad = masked ? msadU8 : sadU8;
  const accBits = wide ? 32 : 16;
  const writes: Array<[number, number[]]> = [];
  for (let lane = 0; lane < WAVE_WIDTH; lane++) {
    if (!isActive(exec, lane)) continue;
    const s0 = readLane64(state, d.src0Encoded, lane, d.literal);
    const s1 = readLane(state, d.src1 ?? 0, lane, d.literal);
    const acc: number[] = [];
    if (wide) {
      const base = (d.src2 ?? 0) - VGPR_SRC_MIN;
      for (let k = 0; k < 4; k++) acc.push(base >= 0 ? state.readVGPR_u32(base + k, lane) : readScalar32(state, d.src2 ?? 0, d.literal));
    } else {
      const s2 = readLane64(state, d.src2 ?? 0, lane, d.literal);
      for (let k = 0; k < 4; k++) acc.push(Number((s2 >> BigInt(16 * k)) & 0xFFFFn));
    }
    const out: number[] = [];
    for (let k = 0; k < 4; k++) {
      const window = Number((s0 >> BigInt(8 * k)) & 0xFFFFFFFFn);
      // Exact sum, then truncated to the accumulator width (or saturated with clamp)
      const r = sad(window, s1, 0) + (acc[k] >>> 0);
      const max = accBits === 16 ? 0xFFFF : U32_MAX;
      out.push(d.clamp ? Math.min(r, max) : accBits === 16 ? r & 0xFFFF : r >>> 0);
    }
    writes.push([lane, wide ? out : [(out[0] | (out[1] << 16)) >>> 0, (out[2] | (out[3] << 16)) >>> 0]]);
  }
  for (const [lane, words] of writes) words.forEach((w, k) => state.writeVGPR_u32(d.dst + k, lane, w));
}

const VALU_SPECIAL: Record<string, ValuHandler> = {
  v_nop: () => {},
  v_readfirstlane_b32: (state, d) => {
    const exec = state.exec;
    let lane = 0;
    while (lane < WAVE_WIDTH && !isActive(exec, lane)) lane++;
    if (lane === WAVE_WIDTH) lane = 0; // EXEC = 0 reads lane 0
    state.writeSGPR(d.dst, readLane(state, d.src0Encoded, lane, d.literal));
  },
  v_readlane_b32: (state, d) => {
    const lane = readScalar32(state, d.src1 ?? 0, d.literal) & (WAVE_WIDTH - 1);
    state.writeSGPR(d.dst, readLane(state, d.src0Encoded, lane, d.literal));
  },
  v_writelane_b32: (state, d) => {
    const lane = readScalar32(state, d.src1 ?? 0, d.literal) & (WAVE_WIDTH - 1);
    state.writeVGPR_u32(d.dst, lane, readLane(state, d.src0Encoded, lane, d.literal));
  },
  v_swap_b32: (state, d, info) => {
    const src = requireVgpr(d.src0Encoded, info);
    const exec = state.exec;
    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      if (!isActive(exec, lane)) continue;
      const a = state.readVGPR_u32(d.dst, lane);
      state.writeVGPR_u32(d.dst, lane, state.readVGPR_u32(src, lane));
      state.writeVGPR_u32(src, lane, a);
    }
  },
  v_movreld_b32: (state, d, info) => movrel(state, d, info, 'd'),
  v_movrels_b32: (state, d, info) => movrel(state, d, info, 's'),
  v_movrelsd_b32: (state, d, info) => movrel(state, d, info, 'sd'),
  v_movrelsd_2_b32: (state, d, info) => movrel(state, d, info, 'sd2'),
  v_mbcnt_lo_u32_b32: (state, d) => {
    const exec = state.exec;
    const writes: Array<[number, number]> = [];
    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      if (!isActive(exec, lane)) continue;
      const below = lane === 0 ? 0 : 0xFFFFFFFF >>> (32 - lane);
      const s0 = readLane(state, d.src0Encoded, lane, d.literal);
      const s1 = readLane(state, d.src1 ?? 0, lane, d.literal);
      writes.push([lane, (popcount32(s0 & below) + s1) >>> 0]);
    }
    for (const [lane, v] of writes) state.writeVGPR_u32(d.dst, lane, v);
  },
  v_mbcnt_hi_u32_b32: (state, d) => {
    // Wave32: the lanes 32–63 part of the thread mask is empty, so the result is src1
    const exec = state.exec;
    const writes: Array<[number, number]> = [];
    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      if (isActive(exec, lane)) writes.push([lane, readLane(state, d.src1 ?? 0, lane, d.literal)]);
    }
    for (const [lane, v] of writes) state.writeVGPR_u32(d.dst, lane, v);
  },
  v_permlane16_b32: (state, d, info) => permlane(state, d, info, false),
  v_permlanex16_b32: (state, d, info) => permlane(state, d, info, true),
  v_lshlrev_b64: (state, d) => shift64(state, d, (v, n) => v << n, false),
  v_lshrrev_b64: (state, d) => shift64(state, d, (v, n) => v >> n, false),
  v_ashrrev_i64: (state, d) => shift64(state, d, (v, n) => BigInt.asUintN(64, BigInt.asIntN(64, v) >> n), true),
  v_mad_u64_u32: (state, d) => mad64(state, d, false),
  v_mad_i64_i32: (state, d) => mad64(state, d, true),
  v_qsad_pk_u16_u8: (state, d) => quadSad(state, d, false, false),
  v_mqsad_pk_u16_u8: (state, d) => quadSad(state, d, true, false),
  v_mqsad_u32_u8: (state, d) => quadSad(state, d, true, true),
  v_pk_fmac_f16: (state, d) => {
    const exec = state.exec;
    const writes: Array<[number, number]> = [];
    for (let lane = 0; lane < WAVE_WIDTH; lane++) {
      if (!isActive(exec, lane)) continue;
      const lane0 = src0Lane(d, exec, lane);
      if (lane0 === LANE_DISABLED) continue;
      const a = lane0 === READ_ZERO ? 0 : readLane(state, d.src0Encoded, lane0, d.literal, true);
      const b = readLane(state, d.src1 ?? 0, lane, d.literal, true);
      const c = state.readVGPR_u32(d.dst, lane);
      const half = (x: number, hi: boolean) => f16ToF32(hi ? x >>> 16 : x & 0xFFFF);
      const lo = f32ToF16(Math.fround(half(a, false) * half(b, false) + half(c, false)));
      const hi = f32ToF16(Math.fround(half(a, true) * half(b, true) + half(c, true)));
      writes.push([lane, ((hi << 16) | lo) >>> 0]);
    }
    for (const [lane, v] of writes) state.writeVGPR_u32(d.dst, lane, v);
  },
};

function executeVOPC(state: GPUState, d: DecodedInstruction, info: OpcodeInfo): void {
  const types = vopTypes(info);
  const exec = state.exec;
  const isSdwa = d.extra === 'SDWA';
  let mask = 0;
  for (let lane = 0; lane < WAVE_WIDTH; lane++) {
    if (!isActive(exec, lane)) continue;
    const l0 = src0Lane(d, exec, lane);
    if (l0 === LANE_DISABLED) continue;
    let r0 = l0 === READ_ZERO ? 0 : readLane(state, d.src0Encoded, l0, d.literal, types.s[0] === 'f16');
    let r1 = readLane(state, d.src1 ?? 0, lane, d.literal, types.s[1] === 'f16');
    if (isSdwa) {
      r0 = sdwaSelect(r0, d.sdwaSrc0Sel ?? 6, !!d.sdwaSrc0Sext);
      r1 = sdwaSelect(r1, d.sdwaSrc1Sel ?? 6, !!d.sdwaSrc1Sext);
    }
    const a = applyModifiers(typed(r0, types.s[0], false), types.s[0], !!d.src0Abs, !!d.src0Neg);
    const b = applyModifiers(typed(r1, types.s[1], false), types.s[1], !!d.src1Abs, !!d.src1Neg);
    if (info.execute(a, b)) mask |= 1 << lane;
  }
  // Inactive lanes write 0; v_cmpx writes EXEC only
  if (info.mnemonic.startsWith('v_cmpx_')) state.writeSGPR(EXEC_LO, mask >>> 0);
  else state.writeSGPR(d.sdst ?? VCC_LO, mask >>> 0);
}

function executeVALU(state: GPUState, d: DecodedInstruction, info: OpcodeInfo): void {
  const m = info.mnemonic;
  const special = VALU_SPECIAL[m];
  if (special) {
    special(state, d, info);
    return;
  }
  if (info.format === InstructionFormat.VOPC) {
    executeVOPC(state, d, info);
    return;
  }

  const types = vopTypes(info);
  const exec = state.exec;
  const opSel = info.opSel && d.vop3 ? (d.opSel ?? 0) : 0;
  const enc = [d.src0Encoded, d.src1 ?? 0, d.src2 ?? 0];
  const abs = [!!d.src0Abs, !!d.src1Abs, !!d.src2Abs];
  const neg = [!!d.src0Neg, !!d.src1Neg, !!d.src2Neg];
  const isSdwa = d.extra === 'SDWA';
  const isCndmask = m === 'v_cndmask_b32';
  const usesMask = isCndmask || !!info.carryIn;
  const mask = usesMask ? readScalar32(state, d.src2 ?? VCC_LO, d.literal) : 0;
  const dataSources = usesMask ? 2 : valuSourceCount(info);
  const sat = d.clamp ? SATURATING[m] : undefined;
  const k = info.kLiteral ? typed(d.literal ?? 0, types.s[0], false) : 0;
  const writes: Array<[number, number]> = [];
  let carryMask = 0;

  for (let lane = 0; lane < WAVE_WIDTH; lane++) {
    if (!isActive(exec, lane)) continue;
    const l0 = src0Lane(d, exec, lane);
    if (l0 === LANE_DISABLED) continue;

    const raw = [0, 0, 0];
    for (let i = 0; i < dataSources; i++) {
      if (i === 0 && l0 === READ_ZERO) continue;
      raw[i] = readLane(state, enc[i], i === 0 ? l0 : lane, d.literal, types.s[i] === 'f16');
    }
    if (isSdwa) {
      raw[0] = sdwaSelect(raw[0], d.sdwaSrc0Sel ?? 6, !!d.sdwaSrc0Sext);
      if (info.format !== InstructionFormat.VOP1) raw[1] = sdwaSelect(raw[1], d.sdwaSrc1Sel ?? 6, !!d.sdwaSrc1Sext);
    }
    const args = raw.map((r, i) => applyModifiers(typed(r, types.s[i], ((opSel >> i) & 1) === 1), types.s[i], abs[i], neg[i]));

    let result: number;
    if (isCndmask) {
      result = (mask >>> lane) & 1 ? args[1] : args[0];
    } else if (info.carry) {
      const a = args[0] >>> 0;
      const b = args[1] >>> 0;
      const cin = info.carryIn ? (mask >>> lane) & 1 : 0;
      const exact = info.carry === 'add' ? a + b + cin : info.carry === 'sub' ? a - b - cin : b - a - cin;
      if (info.carry === 'add' ? exact > 0xFFFFFFFF : exact < 0) carryMask |= 1 << lane;
      result = d.clamp ? clampN(exact, 0, 0xFFFFFFFF) : exact;
    } else {
      if (info.kLiteral === 'mk') {
        args[2] = args[1];
        args[1] = k;
      } else if (info.kLiteral === 'ak') {
        args[2] = k;
      } else if (info.accumulate) {
        args[dataSources] = typed(state.readVGPR_u32(d.dst, lane), types.d, false);
      }
      result = sat ? sat(args[0], args[1], args[2]) : info.execute(args[0], args[1], args[2]);
      if (m === 'v_div_fmas_f32' && (state.vcc >>> lane) & 1) result *= 2 ** 32;
    }

    if (isFloatType(types.d)) result = outputModifiers(result, d);
    let bits = toBits(result, types.d);
    if (d.clamp && PACKED_F16_RESULT.has(m)) bits = clampPackedF16(bits);
    const old = state.readVGPR_u32(d.dst, lane);
    let value: number;
    if (isSdwa) value = sdwaWrite(old, bits, d.sdwaDstSel ?? 6, d.sdwaDstUnused ?? 0);
    else if (is16BitType(types.d)) value = writeHalf(old, bits, (opSel & 8) !== 0);
    else value = bits;
    writes.push([lane, value]);
  }

  for (const [lane, value] of writes) state.writeVGPR_u32(d.dst, lane, value);
  if (info.carry) state.writeSGPR(d.sdst ?? VCC_LO, carryMask >>> 0);
}

function executeVOP3P(state: GPUState, d: DecodedInstruction, info: OpcodeInfo): void {
  const m = info.mnemonic;
  const exec = state.exec;
  const nsrc = valuSourceCount(info);
  const isMix = m.startsWith('v_fma_mix');
  const isFloat = !info.isIntegerOp;
  const opSel = d.opSel ?? 0;
  const opSelHi = d.opSelHi ?? (isMix ? 0 : 7);
  const negLo = (d.src0Neg ? 1 : 0) | (d.src1Neg ? 2 : 0) | (d.src2Neg ? 4 : 0);
  const negHi = d.negHi ?? 0;
  const enc = [d.src0Encoded, d.src1 ?? 0, d.src2 ?? 0];
  const sat = d.clamp ? PACKED_SATURATING[m] : undefined;
  const writes: Array<[number, number]> = [];

  for (let lane = 0; lane < WAVE_WIDTH; lane++) {
    if (!isActive(exec, lane)) continue;
    const raw = [0, 0, 0];
    for (let i = 0; i < nsrc; i++) {
      // Inline float constants: f16 value in the low half for f16 operands (0 above it),
      // the f32 value for integer and f32 operands
      const f16Source = isMix ? ((opSelHi >> i) & 1) === 1 : isFloat;
      raw[i] = readLane(state, enc[i], lane, d.literal, f16Source);
    }

    if (isMix) {
      // Each source is f32 (op_sel_hi = 0) or the f16 half chosen by op_sel; neg_hi means abs
      const args = raw.map((r, i) => {
        let v = (opSelHi >> i) & 1 ? f16ToF32((opSel >> i) & 1 ? r >>> 16 : r & 0xFFFF) : bitsToFloat(r);
        if ((negHi >> i) & 1) v = Math.abs(v);
        return (negLo >> i) & 1 ? -v : v;
      });
      writes.push([lane, floatBits(outputModifiers(info.execute(args[0], args[1], args[2]), d))]);
      continue;
    }

    const half = (r: number, hi: boolean) => (hi ? r >>> 16 : r & 0xFFFF);
    const lo = raw.map((r, i) => half(r, ((opSel >> i) & 1) === 1));
    const hi = raw.map((r, i) => half(r, ((opSelHi >> i) & 1) === 1));
    let rLo: number;
    let rHi: number;
    if (isFloat) {
      const conv = (h: number[], negBits: number) => h.map((x, i) => ((negBits >> i) & 1 ? -f16ToF32(x) : f16ToF32(x)));
      const a = conv(lo, negLo);
      const b = conv(hi, negHi);
      rLo = f32ToF16(outputModifiers(info.execute(a[0], a[1], a[2]), d));
      rHi = f32ToF16(outputModifiers(info.execute(b[0], b[1], b[2]), d));
    } else if (sat) {
      rLo = sat(lo[0], lo[1], lo[2]) & 0xFFFF;
      rHi = sat(hi[0], hi[1], hi[2]) & 0xFFFF;
    } else {
      rLo = info.execute(lo[0], lo[1], lo[2]) & 0xFFFF;
      rHi = info.execute(hi[0], hi[1], hi[2]) & 0xFFFF;
    }
    writes.push([lane, ((rHi << 16) | rLo) >>> 0]);
  }
  for (const [lane, value] of writes) state.writeVGPR_u32(d.dst, lane, value);
}

// ── DS (LDS and cross-lane) ──

function reverse5(v: number): number {
  let r = 0;
  for (let i = 0; i < 5; i++) r |= ((v >> i) & 1) << (4 - i);
  return r;
}

/** Source lane of ds_swizzle_b32 for `lane` (wave32). */
function swizzleSource(offset: number, lane: number): number {
  if (offset >= 0xE000) { // FFT
    const mask = offset & 0x1F;
    return ((reverse5(lane & 0x1F) >> popcount32(mask)) | (lane & mask)) & 0x1F;
  }
  if (offset >= 0xC000) { // rotate
    const mask = offset & 0x1F;
    let rotate = (offset >> 5) & 0x1F;
    if (offset & 0x400) rotate = -rotate;
    return ((lane & mask) | ((lane + rotate) & ~mask)) & 0x1F;
  }
  if (offset & 0x8000) return (lane & ~3) + ((offset >> ((lane & 3) * 2)) & 3); // quad permute
  const andMask = offset & 0x1F;
  const orMask = (offset >> 5) & 0x1F;
  const xorMask = (offset >> 10) & 0x1F;
  return (((lane & andMask) | orMask) ^ xorMask) & 0x1F;
}

function executeDS(state: GPUState, d: DecodedInstruction, info: OpcodeInfo): void {
  const m = info.mnemonic;
  const exec = state.exec;
  const offset = d.offset ?? 0;
  const off0 = offset & 0xFF;
  const off1 = (offset >>> 8) & 0xFF;
  const addr = d.src0Encoded & 0xFF;
  const data0 = (d.src1 ?? 0) & 0xFF;
  const data1 = (d.src2 ?? 0) & 0xFF;
  // Out-of-range LDS reads return 0 and writes are dropped; dword accesses ignore the low address bits
  const load = (byte: number): number => (byte >= 0 && byte < LDS_SIZE_BYTES ? state.lds[byte >>> 2] : 0);
  const store = (byte: number, v: number) => {
    if (byte >= 0 && byte < LDS_SIZE_BYTES) state.lds[byte >>> 2] = v >>> 0;
  };
  const vaddr = (lane: number) => state.readVGPR_u32(addr, lane);
  const writes: Array<[number, number, number]> = [];

  switch (m) {
    case 'ds_write_b32':
      for (let lane = 0; lane < WAVE_WIDTH; lane++) {
        if (isActive(exec, lane)) store(vaddr(lane) + offset, state.readVGPR_u32(data0, lane));
      }
      return;
    case 'ds_write2st64_b32':
      for (let lane = 0; lane < WAVE_WIDTH; lane++) {
        if (!isActive(exec, lane)) continue;
        store(vaddr(lane) + off0 * 256, state.readVGPR_u32(data0, lane));
        store(vaddr(lane) + off1 * 256, state.readVGPR_u32(data1, lane));
      }
      return;
    case 'ds_read_b32':
      for (let lane = 0; lane < WAVE_WIDTH; lane++) {
        if (isActive(exec, lane)) writes.push([d.dst, lane, load(vaddr(lane) + offset)]);
      }
      break;
    case 'ds_read2st64_b32':
      for (let lane = 0; lane < WAVE_WIDTH; lane++) {
        if (!isActive(exec, lane)) continue;
        writes.push([d.dst, lane, load(vaddr(lane) + off0 * 256)]);
        writes.push([d.dst + 1, lane, load(vaddr(lane) + off1 * 256)]);
      }
      break;
    case 'ds_swizzle_b32':
      for (let lane = 0; lane < WAVE_WIDTH; lane++) {
        if (!isActive(exec, lane)) continue;
        const s = swizzleSource(offset, lane);
        writes.push([d.dst, lane, isActive(exec, s) ? state.readVGPR_u32(addr, s) : 0]);
      }
      break;
    case 'ds_permute_b32': {
      const tmp = new Uint32Array(WAVE_WIDTH);
      for (let lane = 0; lane < WAVE_WIDTH; lane++) {
        if (isActive(exec, lane)) tmp[((vaddr(lane) + offset) >>> 2) & 31] = state.readVGPR_u32(data0, lane);
      }
      for (let lane = 0; lane < WAVE_WIDTH; lane++) if (isActive(exec, lane)) writes.push([d.dst, lane, tmp[lane]]);
      break;
    }
    case 'ds_bpermute_b32':
      for (let lane = 0; lane < WAVE_WIDTH; lane++) {
        if (!isActive(exec, lane)) continue;
        const s = ((vaddr(lane) + offset) >>> 2) & 31;
        writes.push([d.dst, lane, isActive(exec, s) ? state.readVGPR_u32(data0, s) : 0]);
      }
      break;
    default:
      fault(`${m} is not implemented by the emulator`);
  }
  for (const [reg, lane, v] of writes) state.writeVGPR_u32(reg, lane, v);
}

// ── Scalar ──

function writeScalar(state: GPUState, reg: number, width: number, value: bigint): void {
  if (width === 64) state.writeSGPR64(reg, BigInt.asUintN(64, value));
  else state.writeSGPR(reg, Number(BigInt.asUintN(32, value)));
}

function setScc(state: GPUState, value: boolean): void {
  state.scc = value ? 1 : 0;
  state.modifiedRegs.add('SCC');
}

function executeScalarSpecial(state: GPUState, d: DecodedInstruction, info: OpcodeInfo, ctx: ExecContext): ControlFlow | undefined {
  const m = info.mnemonic;
  const wide = m.endsWith('_b64');
  switch (m) {
    case 's_getpc_b64':
      state.writeSGPR64(d.dst, BigInt(ctx.nextPcBytes));
      return undefined;
    case 's_setpc_b64':
      return { kind: 'jump', byteAddress: Number(readScalar64(state, d.src0Encoded, d.literal) & 0xFFFFFFFFFFFFn) };
    case 's_swappc_b64': {
      const target = readScalar64(state, d.src0Encoded, d.literal);
      state.writeSGPR64(d.dst, BigInt(ctx.nextPcBytes));
      return { kind: 'jump', byteAddress: Number(target & 0xFFFFFFFFFFFFn) };
    }
    case 's_and_saveexec_b64':
    case 's_or_saveexec_b64': {
      const s0 = readScalar64(state, d.src0Encoded, d.literal);
      const old = state.readSGPR64(EXEC_LO);
      state.writeSGPR64(d.dst, old);
      const exec = m === 's_and_saveexec_b64' ? s0 & old : s0 | old;
      state.writeSGPR64(EXEC_LO, exec);
      setScc(state, exec !== 0n);
      return undefined;
    }
    case 's_and_saveexec_b32': {
      const s0 = readScalar32(state, d.src0Encoded, d.literal);
      const old = state.exec;
      state.writeSGPR(d.dst, old);
      const exec = (s0 & old) >>> 0;
      state.writeSGPR(EXEC_LO, exec);
      setScc(state, exec !== 0);
      return undefined;
    }
    case 's_movrels_b32':
    case 's_movrels_b64':
    case 's_movreld_b32':
    case 's_movreld_b64': {
      const m0 = state.readSGPR(M0_REG);
      const relDst = m.startsWith('s_movreld');
      const base = relDst ? d.dst : d.src0Encoded;
      const index = base + m0;
      if (index + (wide ? 1 : 0) > 127) {
        fault(`${m}: register ${base} + M0 (${m0}) is outside the scalar register file`);
      }
      if (relDst) {
        if (wide) state.writeSGPR64(index, readScalar64(state, d.src0Encoded, d.literal));
        else state.writeSGPR(index, readScalar32(state, d.src0Encoded, d.literal));
      } else if (wide) {
        state.writeSGPR64(d.dst, state.readSGPR64(index));
      } else {
        state.writeSGPR(d.dst, state.readSGPR(index));
      }
      return undefined;
    }
    case 's_setreg_imm32_b32':
    case 's_waitcnt_vscnt':
      return undefined; // hardware state / memory counters are not modelled
    default:
      return fault(`${m} is not implemented by the emulator`);
  }
}

function executeSALU(state: GPUState, d: DecodedInstruction, info: OpcodeInfo, ctx: ExecContext): ControlFlow | undefined {
  const s = info.salu;
  if (!s) return executeScalarSpecial(state, d, info, ctx);
  const signedSrc0 = /_i64$/.test(info.mnemonic);
  const read = (enc: number, width: number, signed = false): bigint =>
    width === 64 ? readScalar64(state, enc, d.literal, signed) : BigInt(readScalar32(state, enc, d.literal));

  let s0: bigint;
  let s1: bigint;
  if (d.format === InstructionFormat.SOPK) {
    // SOPK reads its destination SGPR as the first source; SIMM16 is the second
    s0 = s.s0 ? read(d.dst, s.s0) : 0n;
    const imm = d.simm16 ?? 0;
    s1 = s.simm === 'zext' ? BigInt(imm & 0xFFFF) : BigInt(sx16(imm));
  } else {
    s0 = s.s0 ? read(d.src0Encoded, s.s0, signedSrc0) : 0n;
    s1 = s.s1 ? read(d.src1 ?? 0, s.s1) : 0n;
  }
  const ctx2: SaluContext = { scc: state.scc, d: s.d ? read(d.dst, s.d) : 0n };
  const result = s.op(s0, s1, ctx2);
  if (s.scc) setScc(state, s.scc(s0, s1, result ?? 0n, ctx2));
  if (result !== undefined && s.d) writeScalar(state, d.dst, s.d, result);
  return undefined;
}

function executeSOPP(state: GPUState, d: DecodedInstruction, info: OpcodeInfo): ControlFlow | undefined {
  const offset = sx16(d.simm16 ?? 0);
  const branchIf = (cond: boolean): ControlFlow | undefined => (cond ? { kind: 'branch', offset } : undefined);
  switch (info.mnemonic) {
    case 's_endpgm': return { kind: 'halt' };
    case 's_branch': return { kind: 'branch', offset };
    case 's_cbranch_scc0': return branchIf(state.scc === 0);
    case 's_cbranch_scc1': return branchIf(state.scc === 1);
    case 's_cbranch_vccz': return branchIf(state.vcc === 0);
    case 's_cbranch_vccnz': return branchIf(state.vcc !== 0);
    case 's_cbranch_execz': return branchIf(state.exec === 0);
    case 's_cbranch_execnz': return branchIf(state.exec !== 0);
    default: return info.halts ? { kind: 'halt' } : undefined; // s_nop, s_waitcnt, s_barrier, …
  }
}

/**
 * Execute a single instruction on the wave. Returns its effect on the program counter,
 * or undefined to continue with the next instruction. Throws EmulatorFault for
 * instructions the emulator cannot run.
 */
export function executeInstruction(state: GPUState, instr: ResolvedInstruction, ctx: ExecContext = { nextPcBytes: 0 }): ControlFlow | undefined {
  const { decoded: d, opcodeInfo: info } = instr;
  state.modifiedRegs.clear();
  if (info.format === InstructionFormat.UNKNOWN) {
    fault(`Unknown instruction ${info.mnemonic} at byte address 0x${(d.address * 4).toString(16)}`);
  }
  switch (d.format) {
    case InstructionFormat.SOPP:
      return executeSOPP(state, d, info);
    case InstructionFormat.SOP1:
    case InstructionFormat.SOP2:
    case InstructionFormat.SOPC:
    case InstructionFormat.SOPK:
      return executeSALU(state, d, info, ctx);
    case InstructionFormat.VOP1:
    case InstructionFormat.VOP2:
    case InstructionFormat.VOPC:
    case InstructionFormat.VOP3:
      executeVALU(state, d, info);
      return undefined;
    case InstructionFormat.VOP3P:
      executeVOP3P(state, d, info);
      return undefined;
    case InstructionFormat.DS:
      executeDS(state, d, info);
      return undefined;
    default:
      return fault(`${info.mnemonic}: ${d.format} instructions are not supported by the emulator`);
  }
}
