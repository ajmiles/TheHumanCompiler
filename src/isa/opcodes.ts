// ── RDNA2 Opcode Table ──
// Maps mnemonic → opcode info with encoding format and semantic function

import { InstructionFormat, OpcodeInfo } from './types';

// IEEE 754 helper for bit-exact float operations
const f32 = new Float32Array(1);

function asFloat(v: number): number {
  // Reinterpret a value through f32 to match GPU precision
  f32[0] = v;
  return f32[0];
}

// ── VOP2 Instructions (2-source) ──

const VOP2_OPCODES: OpcodeInfo[] = [
  {
    mnemonic: 'v_cndmask_b32',
    format: InstructionFormat.VOP2,
    opcode: 0x01,
    operandCount: 3,
    execute: (a, b) => b ?? a, // actual selection done in executor using VCC
    description: 'Conditional mask: select src0 or vsrc1 per lane based on VCC.\nvdst = VCC[lane] ? vsrc1 : src0',
    syntax: 'v_cndmask_b32 vdst, src0, vsrc1',
    readsVCC: true,
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_add_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x03,
    operandCount: 3,
    execute: (a, b) => asFloat(a + (b ?? 0)),
    description: 'Add two 32-bit floats per lane.\nvdst = src0 + vsrc1',
    syntax: 'v_add_f32 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_sub_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x04,
    operandCount: 3,
    execute: (a, b) => asFloat(a - (b ?? 0)),
    description: 'Subtract two 32-bit floats per lane.\nvdst = src0 - vsrc1',
    syntax: 'v_sub_f32 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_subrev_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x05,
    operandCount: 3,
    execute: (a, b) => asFloat((b ?? 0) - a),
    description: 'Reverse subtract: subtract src0 from vsrc1.\nvdst = vsrc1 - src0',
    syntax: 'v_subrev_f32 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_mul_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x08,
    operandCount: 3,
    execute: (a, b) => asFloat(a * (b ?? 0)),
    description: 'Multiply two 32-bit floats per lane.\nvdst = src0 × vsrc1',
    syntax: 'v_mul_f32 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_min_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x0F,
    operandCount: 3,
    execute: (a, b) => Math.min(a, b ?? 0),
    description: 'Return the minimum of two 32-bit floats per lane.\nvdst = min(src0, vsrc1)',
    syntax: 'v_min_f32 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_max_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x10,
    operandCount: 3,
    execute: (a, b) => Math.max(a, b ?? 0),
    description: 'Return the maximum of two 32-bit floats per lane.\nvdst = max(src0, vsrc1)',
    syntax: 'v_max_f32 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_and_b32',
    format: InstructionFormat.VOP2,
    opcode: 0x1C,
    operandCount: 3,
    execute: (a, b) => ((a & (b ?? 0)) >>> 0),
    description: 'Bitwise AND of two 32-bit values per lane.\nvdst = src0 & vsrc1',
    syntax: 'v_and_b32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_or_b32',
    format: InstructionFormat.VOP2,
    opcode: 0x1D,
    operandCount: 3,
    execute: (a, b) => ((a | (b ?? 0)) >>> 0),
    description: 'Bitwise OR of two 32-bit values per lane.\nvdst = src0 | vsrc1',
    syntax: 'v_or_b32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_xor_b32',
    format: InstructionFormat.VOP2,
    opcode: 0x1E,
    operandCount: 3,
    execute: (a, b) => ((a ^ (b ?? 0)) >>> 0),
    description: 'Bitwise XOR of two 32-bit values per lane.\nvdst = src0 ^ vsrc1',
    syntax: 'v_xor_b32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_add_nc_u32',
    format: InstructionFormat.VOP2,
    opcode: 0x2A,
    operandCount: 3,
    execute: (a, b) => ((a + (b ?? 0)) >>> 0),
    description: 'Add two unsigned 32-bit integers per lane (no carry out).\nvdst = src0 + vsrc1',
    syntax: 'v_add_nc_u32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
];

// ── VOP1 Instructions (1-source) ──

const VOP1_OPCODES: OpcodeInfo[] = [
  {
    mnemonic: 'v_mov_b32',
    format: InstructionFormat.VOP1,
    opcode: 0x01,
    operandCount: 2,
    execute: (a) => a,
    description: 'Copy a 32-bit value into the destination per lane.\nvdst = src0',
    syntax: 'v_mov_b32 vdst, src0',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_cvt_f32_i32',
    format: InstructionFormat.VOP1,
    opcode: 0x05,
    operandCount: 2,
    execute: (a) => asFloat(a | 0),
    description: 'Convert a signed 32-bit integer to a 32-bit float.\nvdst = (float)src0',
    syntax: 'v_cvt_f32_i32 vdst, src0',
  },
  {
    mnemonic: 'v_cvt_i32_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x11,
    operandCount: 2,
    execute: (a) => Math.trunc(a) | 0,
    description: 'Convert a 32-bit float to a signed 32-bit integer (truncate toward zero).\nvdst = (int)src0',
    syntax: 'v_cvt_i32_f32 vdst, src0',
  },
  {
    mnemonic: 'v_rcp_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x2B,
    operandCount: 2,
    execute: (a) => asFloat(1.0 / a),
    description: 'Compute the reciprocal (1/x) of a 32-bit float.\nvdst = 1.0 / src0',
    syntax: 'v_rcp_f32 vdst, src0',
  },
  {
    mnemonic: 'v_sqrt_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x33,
    operandCount: 2,
    execute: (a) => asFloat(Math.sqrt(a)),
    description: 'Compute the square root of a 32-bit float.\nvdst = √src0',
    syntax: 'v_sqrt_f32 vdst, src0',
  },
  {
    mnemonic: 'v_floor_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x24,
    operandCount: 2,
    execute: (a) => asFloat(Math.floor(a)),
    description: 'Round a 32-bit float down to the nearest integer.\nvdst = floor(src0)',
    syntax: 'v_floor_f32 vdst, src0',
  },
  {
    mnemonic: 'v_ceil_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x25,
    operandCount: 2,
    execute: (a) => asFloat(Math.ceil(a)),
    description: 'Round a 32-bit float up to the nearest integer.\nvdst = ceil(src0)',
    syntax: 'v_ceil_f32 vdst, src0',
  },
];

// ── VOP3-only Instructions (3-source, always 64-bit) ──

const VOP3_ONLY_OPCODES: OpcodeInfo[] = [
  {
    mnemonic: 'v_fma_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x13B,
    operandCount: 4, // dst, src0, src1, src2
    execute: (a, b, c) => asFloat(a * (b ?? 0) + (c ?? 0)),
    description: 'Fused multiply-add: computes src0 × src1 + src2 with a single rounding.\nvdst = src0 × src1 + src2',
    syntax: 'v_fma_f32 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_add_lshl_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x147,
    operandCount: 4,
    execute: (a, b, c) => (((a + (b ?? 0)) << ((c ?? 0) & 31)) >>> 0),
    description: 'Add two unsigned 32-bit integers, then left-shift the result.\nvdst = (src0 + src1) << src2',
    syntax: 'v_add_lshl_u32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_bfe_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x148,
    operandCount: 4,
    execute: (a, b, c) => {
      const data = a >>> 0;
      const offset = (b ?? 0) & 31;
      const width = (c ?? 0) & 31;
      if (width === 0) return 0;
      return ((data >>> offset) & ((1 << width) - 1)) >>> 0;
    },
    description: 'Bitfield extract (unsigned): extract a field of bits from src0.\nvdst = (src0 >> src1) & ((1 << src2) - 1)\nsrc1 = bit offset, src2 = field width',
    syntax: 'v_bfe_u32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
];

// ── VOPC Instructions(comparisons, write to VCC) ──

const VOPC_OPCODES: OpcodeInfo[] = [
  {
    mnemonic: 'v_cmp_lt_f32',
    format: InstructionFormat.VOPC,
    opcode: 0x01,
    operandCount: 2,
    execute: (a, b) => (a < (b ?? 0)) ? 1 : 0,
    description: 'Compare two 32-bit floats: set VCC bit if src0 < vsrc1.\nVCC[lane] = (src0 < vsrc1)',
    syntax: 'v_cmp_lt_f32 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_eq_f32',
    format: InstructionFormat.VOPC,
    opcode: 0x02,
    operandCount: 2,
    execute: (a, b) => (a === (b ?? 0)) ? 1 : 0,
    description: 'Compare two 32-bit floats: set VCC bit if src0 == vsrc1.\nVCC[lane] = (src0 == vsrc1)',
    syntax: 'v_cmp_eq_f32 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_le_f32',
    format: InstructionFormat.VOPC,
    opcode: 0x03,
    operandCount: 2,
    execute: (a, b) => (a <= (b ?? 0)) ? 1 : 0,
    description: 'Compare two 32-bit floats: set VCC bit if src0 ≤ vsrc1.\nVCC[lane] = (src0 <= vsrc1)',
    syntax: 'v_cmp_le_f32 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_gt_f32',
    format: InstructionFormat.VOPC,
    opcode: 0x04,
    operandCount: 2,
    execute: (a, b) => (a > (b ?? 0)) ? 1 : 0,
    description: 'Compare two 32-bit floats: set VCC bit if src0 > vsrc1.\nVCC[lane] = (src0 > vsrc1)',
    syntax: 'v_cmp_gt_f32 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_lg_f32',
    format: InstructionFormat.VOPC,
    opcode: 0x05,
    operandCount: 2,
    execute: (a, b) => (a !== (b ?? 0)) ? 1 : 0,
    description: 'Compare two 32-bit floats: set VCC bit if src0 ≠ vsrc1 (ordered).\nVCC[lane] = (src0 != vsrc1)',
    syntax: 'v_cmp_lg_f32 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_ge_f32',
    format: InstructionFormat.VOPC,
    opcode: 0x06,
    operandCount: 2,
    execute: (a, b) => (a >= (b ?? 0)) ? 1 : 0,
    description: 'Compare two 32-bit floats: set VCC bit if src0 ≥ vsrc1.\nVCC[lane] = (src0 >= vsrc1)',
    syntax: 'v_cmp_ge_f32 src0, vsrc1',
    writesVCC: true,
  },
];

// ── SOP1 Instructions (scalar, 1-source) ──

const SOP1_OPCODES: OpcodeInfo[] = [
  {
    mnemonic: 's_mov_b32',
    format: InstructionFormat.SOP1,
    opcode: 0x03,
    operandCount: 2,
    execute: (a) => a,
    description: 'Copy a 32-bit scalar value into the destination SGPR.\nsdst = ssrc0',
    syntax: 's_mov_b32 sdst, ssrc0',
  },
];

// ── SOPP Instructions (scalar, no operands / immediate only) ──

const SOPP_OPCODES: OpcodeInfo[] = [
  {
    mnemonic: 's_endpgm',
    format: InstructionFormat.SOPP,
    opcode: 0x01,
    operandCount: 0,
    execute: () => 0,
    description: 'End the shader program. Execution stops at this instruction.',
    syntax: 's_endpgm',
    halts: true,
  },
];

// ── Lookup Tables ──

const byMnemonic = new Map<string, OpcodeInfo>();
const byFormatAndOpcode = new Map<string, OpcodeInfo>();

function register(opcodes: OpcodeInfo[]) {
  for (const info of opcodes) {
    byMnemonic.set(info.mnemonic, info);
    byFormatAndOpcode.set(`${info.format}:${info.opcode}`, info);
  }
}

register(VOP2_OPCODES);
register(VOP1_OPCODES);
register(VOP3_ONLY_OPCODES);
register(VOPC_OPCODES);
register(SOP1_OPCODES);
register(SOPP_OPCODES);

export function lookupByMnemonic(mnemonic: string): OpcodeInfo | undefined {
  return byMnemonic.get(mnemonic.toLowerCase());
}

export function lookupByOpcode(format: InstructionFormat, opcode: number): OpcodeInfo | undefined {
  return byFormatAndOpcode.get(`${format}:${opcode}`);
}

export function getAllMnemonics(): string[] {
  return Array.from(byMnemonic.keys());
}

export function getAllOpcodes(): OpcodeInfo[] {
  return Array.from(byMnemonic.values());
}
