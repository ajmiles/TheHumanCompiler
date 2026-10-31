// ── VALU operand typing ──
// Shared by the encoder (constant/literal conversion), the executor (typed reads/writes)
// and the UI (register usage).

import { InstructionFormat, OpcodeInfo, ValueType } from './types';

export interface VopTypes {
  d: ValueType;
  /** Types of src0..src2 (always three entries). */
  s: ValueType[];
}

const F32_TYPES: VopTypes = { d: 'f32', s: ['f32', 'f32', 'f32'] };
const B32_TYPES: VopTypes = { d: 'b32', s: ['b32', 'b32', 'b32'] };

/** Operand value types of a VOP1/VOP2/VOP3/VOPC instruction. */
export function vopTypes(info: OpcodeInfo): VopTypes {
  if (info.types) {
    const s = info.types.s.slice();
    while (s.length < 3) s.push(s.length > 0 ? s[s.length - 1] : info.types.d);
    return { d: info.types.d, s };
  }
  if (info.isIntegerOp) return B32_TYPES;
  if (info.integerInput) return { d: 'f32', s: ['b32', 'b32', 'b32'] };
  if (info.integerOutput) return { d: 'b32', s: ['f32', 'f32', 'f32'] };
  return F32_TYPES;
}

export function isFloatType(t: ValueType): boolean {
  return t === 'f32' || t === 'f16' || t === 'f64';
}

export function is16BitType(t: ValueType): boolean {
  return t === 'f16' || t === 'u16' || t === 'i16' || t === 'b16';
}

/** 64-bit operands occupy a register pair. */
export function is64BitType(t: ValueType): boolean {
  return t === 'f64' || t === 'i64' || t === 'u64';
}

/**
 * How a constant written for an operand is converted to bits
 * (see "Type and Size Conversion" in the LLVM AMDGPU operand syntax).
 */
export type ConstKind =
  | 'f32'    // 32-bit float
  | 'f16'    // 16-bit float
  | 'i16'    // 16-bit integer (float constants become f16 bit patterns)
  | 'b32'    // 32-bit integer (float constants become f32 bit patterns)
  | 'u64'    // 64-bit unsigned: 32-bit literal is zero-extended by the hardware
  | 'i64'    // 64-bit signed: 32-bit literal is sign-extended by the hardware
  | 'f64'    // 64-bit float: a 32-bit literal is the high half of the double (the low half is 0)
  | 'pkf16'  // packed 2×f16 (VOP3P)
  | 'pki16'; // packed 2×16-bit integer (VOP3P)

/** Instructions whose operands span several consecutive registers. */
const MULTI_REG: Record<string, { dst?: number; src0?: number; src1?: number; src2?: number; signed?: boolean }> = {
  v_lshlrev_b64: { dst: 2, src1: 2 },
  v_lshrrev_b64: { dst: 2, src1: 2 },
  v_ashrrev_i64: { dst: 2, src1: 2, signed: true },
  v_mad_u64_u32: { dst: 2, src2: 2 },
  v_mad_i64_i32: { dst: 2, src2: 2, signed: true },
  v_qsad_pk_u16_u8: { dst: 2, src0: 2, src2: 2 },
  v_mqsad_pk_u16_u8: { dst: 2, src0: 2, src2: 2 },
  v_mqsad_u32_u8: { dst: 4, src0: 2, src2: 4 },
  ds_read2st64_b32: { dst: 2 },
};

export type OperandRole = 'dst' | 'src0' | 'src1' | 'src2';

/** Number of consecutive 32-bit registers an operand occupies. */
export function operandRegCount(info: OpcodeInfo, role: OperandRole): number {
  if (info.salu) {
    const s = info.salu;
    const w = role === 'dst' ? s.d : role === 'src0' ? s.s0 : role === 'src1' ? s.s1 : 0;
    return w === 64 ? 2 : 1;
  }
  const multi = MULTI_REG[info.mnemonic]?.[role];
  if (multi !== undefined) return multi;
  // Typed 64-bit sources (the f64/i64/u64 compares) are register pairs
  if (role !== 'dst' && info.types && is64BitType(vopTypes(info).s[Number(role.slice(3))])) return 2;
  return 1;
}

/**
 * VOP3P instructions that take op_sel, op_sel_hi, neg_lo and neg_hi: all but the 8- and 4-bit dot products,
 * whose sources are whole dwords.
 */
export function hasPackedModifiers(info: OpcodeInfo): boolean {
  if (info.format !== InstructionFormat.VOP3P) return false;
  return info.dot === undefined || info.dot === 'f16' || info.dot === 'i16' || info.dot === 'u16';
}

/** How constants are converted for VALU source operand `index` (0..2). */
export function valuConstKind(info: OpcodeInfo, index: number, opSelHi = 0): ConstKind {
  const multi = MULTI_REG[info.mnemonic];
  const role = (['src0', 'src1', 'src2'] as const)[index];
  if (multi && (multi[role] ?? 1) > 1) return multi.signed ? 'i64' : 'u64';
  if (info.format === InstructionFormat.VOP3P) {
    if (info.mnemonic.startsWith('v_fma_mix')) return (opSelHi >> index) & 1 ? 'f16' : 'f32';
    if (info.dot) {
      if (index === 2) return info.dot === 'f16' ? 'f32' : 'b32';
      return info.dot === 'f16' ? 'pkf16' : hasPackedModifiers(info) ? 'pki16' : 'b32';
    }
    return info.isIntegerOp ? 'pki16' : 'pkf16';
  }
  // VOP2 packed f16 FMA: a constant src0 is a packed f16 pair (value in the low half)
  if (info.mnemonic === 'v_pk_fmac_f16') return 'pkf16';
  const t = vopTypes(info).s[index];
  switch (t) {
    case 'f32': return 'f32';
    case 'f16': return 'f16';
    case 'f64': return 'f64';
    case 'i64': return 'i64';
    case 'u64': return 'u64';
    case 'u16': case 'i16': case 'b16': return 'i16';
    default: return 'b32';
  }
}

/** Number of source operands read by a VALU instruction (excluding implicit VCC). */
export function valuSourceCount(info: OpcodeInfo): number {
  if (info.kLiteral) return 2;
  switch (info.format) {
    case InstructionFormat.VOP1: return info.operandCount === 0 ? 0 : 1;
    case InstructionFormat.VOPC: return 2;
    case InstructionFormat.VOP2:
      return info.carryIn || info.mnemonic === 'v_cndmask_b32' ? 3 : 2;
    default:
      // VOP3 / VOP3P: operandCount counts the destination(s)
      if (info.vop3b) return info.operandCount - 2;
      return info.operandCount - 1;
  }
}
