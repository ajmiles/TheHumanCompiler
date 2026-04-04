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
    opcode: 0x1B,
    operandCount: 3,
    execute: (a, b) => ((a & (b ?? 0)) >>> 0),
    description: 'Bitwise AND of two 32-bit values per lane.\nvdst = src0 & vsrc1',
    syntax: 'v_and_b32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_or_b32',
    format: InstructionFormat.VOP2,
    opcode: 0x1C,
    operandCount: 3,
    execute: (a, b) => ((a | (b ?? 0)) >>> 0),
    description: 'Bitwise OR of two 32-bit values per lane.\nvdst = src0 | vsrc1',
    syntax: 'v_or_b32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_xor_b32',
    format: InstructionFormat.VOP2,
    opcode: 0x1D,
    operandCount: 3,
    execute: (a, b) => ((a ^ (b ?? 0)) >>> 0),
    description: 'Bitwise XOR of two 32-bit values per lane.\nvdst = src0 ^ vsrc1',
    syntax: 'v_xor_b32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_xnor_b32',
    format: InstructionFormat.VOP2,
    opcode: 0x1E,
    operandCount: 3,
    execute: (a, b) => (~((a ^ (b ?? 0))) >>> 0),
    description: 'Bitwise XNOR of two 32-bit values per lane.\nvdst = ~(src0 ^ vsrc1)',
    syntax: 'v_xnor_b32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_min_i32',
    format: InstructionFormat.VOP2,
    opcode: 0x11,
    operandCount: 3,
    execute: (a, b) => ((a | 0) < ((b ?? 0) | 0)) ? a : (b ?? 0),
    description: 'Return the minimum of two signed 32-bit integers per lane.\nvdst = min((int)src0, (int)vsrc1)',
    syntax: 'v_min_i32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_max_i32',
    format: InstructionFormat.VOP2,
    opcode: 0x12,
    operandCount: 3,
    execute: (a, b) => ((a | 0) > ((b ?? 0) | 0)) ? a : (b ?? 0),
    description: 'Return the maximum of two signed 32-bit integers per lane.\nvdst = max((int)src0, (int)vsrc1)',
    syntax: 'v_max_i32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_min_u32',
    format: InstructionFormat.VOP2,
    opcode: 0x13,
    operandCount: 3,
    execute: (a, b) => ((a >>> 0) < ((b ?? 0) >>> 0)) ? a : (b ?? 0),
    description: 'Return the minimum of two unsigned 32-bit integers per lane.\nvdst = min((uint)src0, (uint)vsrc1)',
    syntax: 'v_min_u32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_max_u32',
    format: InstructionFormat.VOP2,
    opcode: 0x14,
    operandCount: 3,
    execute: (a, b) => ((a >>> 0) > ((b ?? 0) >>> 0)) ? a : (b ?? 0),
    description: 'Return the maximum of two unsigned 32-bit integers per lane.\nvdst = max((uint)src0, (uint)vsrc1)',
    syntax: 'v_max_u32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_add_nc_u32',
    format: InstructionFormat.VOP2,
    opcode: 0x25,
    operandCount: 3,
    execute: (a, b) => ((a + (b ?? 0)) >>> 0),
    description: 'Add two unsigned 32-bit integers per lane (no carry out).\nvdst = src0 + vsrc1',
    syntax: 'v_add_nc_u32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_sub_nc_u32',
    format: InstructionFormat.VOP2,
    opcode: 0x26,
    operandCount: 3,
    execute: (a, b) => ((a - (b ?? 0)) >>> 0),
    description: 'Subtract two unsigned 32-bit integers per lane (no carry).\nvdst = src0 - vsrc1',
    syntax: 'v_sub_nc_u32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_subrev_nc_u32',
    format: InstructionFormat.VOP2,
    opcode: 0x27,
    operandCount: 3,
    execute: (a, b) => (((b ?? 0) - a) >>> 0),
    description: 'Reverse subtract two unsigned 32-bit integers (no carry).\nvdst = vsrc1 - src0',
    syntax: 'v_subrev_nc_u32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mul_i32_i24',
    format: InstructionFormat.VOP2,
    opcode: 0x09,
    operandCount: 3,
    execute: (a, b) => {
      // Sign-extend 24-bit values then multiply
      const sa = (a << 8) >> 8;
      const sb = ((b ?? 0) << 8) >> 8;
      return (sa * sb) | 0;
    },
    description: 'Multiply two signed 24-bit integers, return low 32 bits.\nvdst = (int24)src0 × (int24)vsrc1',
    syntax: 'v_mul_i32_i24 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mul_hi_i32_i24',
    format: InstructionFormat.VOP2,
    opcode: 0x0A,
    operandCount: 3,
    execute: (a, b) => {
      const sa = (a << 8) >> 8;
      const sb = ((b ?? 0) << 8) >> 8;
      // JS can handle 48-bit products safely
      const product = sa * sb;
      return (product / 0x100000000) | 0;
    },
    description: 'Multiply two signed 24-bit integers, return high 32 bits.\nvdst = hi32((int24)src0 × (int24)vsrc1)',
    syntax: 'v_mul_hi_i32_i24 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mul_u32_u24',
    format: InstructionFormat.VOP2,
    opcode: 0x0B,
    operandCount: 3,
    execute: (a, b) => {
      const ua = (a >>> 0) & 0xFFFFFF;
      const ub = ((b ?? 0) >>> 0) & 0xFFFFFF;
      return (ua * ub) >>> 0;
    },
    description: 'Multiply two unsigned 24-bit integers, return low 32 bits.\nvdst = (uint24)src0 × (uint24)vsrc1',
    syntax: 'v_mul_u32_u24 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mul_hi_u32_u24',
    format: InstructionFormat.VOP2,
    opcode: 0x0C,
    operandCount: 3,
    execute: (a, b) => {
      const ua = (a >>> 0) & 0xFFFFFF;
      const ub = ((b ?? 0) >>> 0) & 0xFFFFFF;
      const product = ua * ub;
      return (product / 0x100000000) >>> 0;
    },
    description: 'Multiply two unsigned 24-bit integers, return high 32 bits.\nvdst = hi32((uint24)src0 × (uint24)vsrc1)',
    syntax: 'v_mul_hi_u32_u24 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_lshlrev_b32',
    format: InstructionFormat.VOP2,
    opcode: 0x1A,
    operandCount: 3,
    execute: (a, b) => ((b ?? 0) << (a & 31)) >>> 0,
    description: 'Left shift vsrc1 by src0 bits (reversed operand order).\nvdst = vsrc1 << (src0 & 31)',
    syntax: 'v_lshlrev_b32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_lshrrev_b32',
    format: InstructionFormat.VOP2,
    opcode: 0x16,
    operandCount: 3,
    execute: (a, b) => ((b ?? 0) >>> (a & 31)) >>> 0,
    description: 'Logical right shift vsrc1 by src0 bits (reversed operand order).\nvdst = vsrc1 >> (src0 & 31) (unsigned)',
    syntax: 'v_lshrrev_b32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_ashrrev_i32',
    format: InstructionFormat.VOP2,
    opcode: 0x18,
    operandCount: 3,
    execute: (a, b) => (((b ?? 0) | 0) >> (a & 31)) | 0,
    description: 'Arithmetic right shift vsrc1 by src0 bits (sign-extending, reversed order).\nvdst = (int)vsrc1 >> (src0 & 31)',
    syntax: 'v_ashrrev_i32 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_fmac_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x2B,
    operandCount: 3,
    execute: (a, b) => asFloat(a * (b ?? 0)),
    description: 'Fused multiply-accumulate: vdst = src0 × vsrc1 + vdst.\nNote: vdst is also an implicit source (accumulated).',
    syntax: 'v_fmac_f32 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_mul_legacy_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x07,
    operandCount: 3,
    execute: (a, b) => asFloat(a * (b ?? 0)),
    description: 'Legacy multiply: 0 * anything = 0 (no NaN from 0*Inf).\nvdst = src0 × vsrc1 (legacy)',
    syntax: 'v_mul_legacy_f32 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_add_co_ci_u32',
    format: InstructionFormat.VOP2,
    opcode: 0x28,
    operandCount: 3,
    execute: (a, b) => ((a + (b ?? 0)) >>> 0),
    description: 'Add with carry-in from VCC and carry-out to VCC.\nvdst = src0 + vsrc1 + VCC[lane]',
    syntax: 'v_add_co_ci_u32 vdst, src0, vsrc1',
    readsVCC: true,
    writesVCC: true,
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_dot8c_i32_i4',
    format: InstructionFormat.VOP2,
    opcode: 0x02,
    operandCount: 3,
    execute: (a, b) => ((a + (b ?? 0)) | 0),
    description: 'Dot product of 8 4-bit integers, accumulate into 32-bit integer.',
    syntax: 'v_dot8c_i32_i4 vdst, src0, vsrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mac_legacy_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x06,
    operandCount: 3,
    execute: (a, b) => asFloat(a * (b ?? 0)),
    description: 'Legacy multiply-accumulate: vdst = src0 × vsrc1 + vdst (0 * anything = 0).',
    syntax: 'v_mac_legacy_f32 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_add_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x32,
    operandCount: 3,
    execute: (a, b) => asFloat(a + (b ?? 0)),
    description: 'Add two 16-bit floats.\nvdst = src0 + vsrc1',
    syntax: 'v_add_f16 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_sub_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x33,
    operandCount: 3,
    execute: (a, b) => asFloat(a - (b ?? 0)),
    description: 'Subtract two 16-bit floats.\nvdst = src0 - vsrc1',
    syntax: 'v_sub_f16 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_mul_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x35,
    operandCount: 3,
    execute: (a, b) => asFloat(a * (b ?? 0)),
    description: 'Multiply two 16-bit floats.\nvdst = src0 × vsrc1',
    syntax: 'v_mul_f16 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_fmac_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x36,
    operandCount: 3,
    execute: (a, b) => asFloat(a * (b ?? 0)),
    description: 'Fused multiply-accumulate f16: vdst = src0 × vsrc1 + vdst.',
    syntax: 'v_fmac_f16 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_max_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x39,
    operandCount: 3,
    execute: (a, b) => Math.max(a, b ?? 0),
    description: 'Maximum of two 16-bit floats.\nvdst = max(src0, vsrc1)',
    syntax: 'v_max_f16 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_min_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x3A,
    operandCount: 3,
    execute: (a, b) => Math.min(a, b ?? 0),
    description: 'Minimum of two 16-bit floats.\nvdst = min(src0, vsrc1)',
    syntax: 'v_min_f16 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_ldexp_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x3B,
    operandCount: 3,
    execute: (a, b) => asFloat(a * Math.pow(2, (b ?? 0) | 0)),
    description: 'Load exponent f16: vdst = src0 × 2^vsrc1.',
    syntax: 'v_ldexp_f16 vdst, src0, vsrc1',
  },
];

// ── VOP1 Instructions (1-source) ──

const VOP1_OPCODES: OpcodeInfo[] = [
  {
    mnemonic: 'v_nop',
    format: InstructionFormat.VOP1,
    opcode: 0x00,
    operandCount: 0,
    execute: (a) => a,
    description: 'No operation.',
    syntax: 'v_nop',
  },
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
    integerInput: true,
  },
  {
    mnemonic: 'v_cvt_i32_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x08,
    operandCount: 2,
    execute: (a) => Math.trunc(a) | 0,
    description: 'Convert a 32-bit float to a signed 32-bit integer (truncate toward zero).\nvdst = (int)src0',
    syntax: 'v_cvt_i32_f32 vdst, src0',
    integerOutput: true,
  },
  {
    mnemonic: 'v_rcp_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x2A,
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
    opcode: 0x22,
    operandCount: 2,
    execute: (a) => asFloat(Math.ceil(a)),
    description: 'Round a 32-bit float up to the nearest integer.\nvdst = ceil(src0)',
    syntax: 'v_ceil_f32 vdst, src0',
  },
  {
    mnemonic: 'v_cvt_f32_u32',
    format: InstructionFormat.VOP1,
    opcode: 0x06,
    operandCount: 2,
    execute: (a) => asFloat(a >>> 0),
    description: 'Convert an unsigned 32-bit integer to a 32-bit float.\nvdst = (float)(uint)src0',
    syntax: 'v_cvt_f32_u32 vdst, src0',
    integerInput: true,
  },
  {
    mnemonic: 'v_cvt_u32_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x07,
    operandCount: 2,
    execute: (a) => Math.max(0, Math.min(0xFFFFFFFF, Math.trunc(a))) >>> 0,
    description: 'Convert a 32-bit float to an unsigned 32-bit integer (truncate, clamp to [0, 2³²-1]).\nvdst = (uint)src0',
    syntax: 'v_cvt_u32_f32 vdst, src0',
    integerOutput: true,
  },
  {
    mnemonic: 'v_trunc_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x21,
    operandCount: 2,
    execute: (a) => asFloat(Math.trunc(a)),
    description: 'Truncate a 32-bit float toward zero (drop the fractional part).\nvdst = trunc(src0)',
    syntax: 'v_trunc_f32 vdst, src0',
  },
  {
    mnemonic: 'v_rndne_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x23,
    operandCount: 2,
    execute: (a) => {
      // Round to nearest even (banker's rounding)
      const r = Math.round(a);
      // If exactly halfway, round to even
      if (Math.abs(a - r) === 0.5 && r % 2 !== 0) return asFloat(r - Math.sign(a));
      return asFloat(r);
    },
    description: 'Round a 32-bit float to nearest even integer.\nvdst = roundEven(src0)',
    syntax: 'v_rndne_f32 vdst, src0',
  },
  {
    mnemonic: 'v_fract_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x20,
    operandCount: 2,
    execute: (a) => asFloat(a - Math.floor(a)),
    description: 'Return the fractional part of a 32-bit float.\nvdst = src0 - floor(src0)',
    syntax: 'v_fract_f32 vdst, src0',
  },
  {
    mnemonic: 'v_exp_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x25,
    operandCount: 2,
    execute: (a) => asFloat(Math.pow(2, a)),
    description: 'Compute 2^x (base-2 exponential) of a 32-bit float.\nvdst = 2^src0',
    syntax: 'v_exp_f32 vdst, src0',
  },
  {
    mnemonic: 'v_log_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x27,
    operandCount: 2,
    execute: (a) => asFloat(Math.log2(a)),
    description: 'Compute log₂(x) (base-2 logarithm) of a 32-bit float.\nvdst = log₂(src0)',
    syntax: 'v_log_f32 vdst, src0',
  },
  {
    mnemonic: 'v_cvt_f32_ubyte0',
    format: InstructionFormat.VOP1,
    opcode: 0x11,
    operandCount: 2,
    execute: (a) => asFloat((a >>> 0) & 0xFF),
    description: 'Extract byte 0 (bits [7:0]) from src0 and convert to float.\nvdst = (float)(src0 & 0xFF)',
    syntax: 'v_cvt_f32_ubyte0 vdst, src0',
    integerInput: true,
  },
  {
    mnemonic: 'v_cvt_f32_ubyte1',
    format: InstructionFormat.VOP1,
    opcode: 0x12,
    operandCount: 2,
    execute: (a) => asFloat(((a >>> 0) >> 8) & 0xFF),
    description: 'Extract byte 1 (bits [15:8]) from src0 and convert to float.\nvdst = (float)((src0 >> 8) & 0xFF)',
    syntax: 'v_cvt_f32_ubyte1 vdst, src0',
    integerInput: true,
  },
  {
    mnemonic: 'v_cvt_f32_ubyte2',
    format: InstructionFormat.VOP1,
    opcode: 0x13,
    operandCount: 2,
    execute: (a) => asFloat(((a >>> 0) >> 16) & 0xFF),
    description: 'Extract byte 2 (bits [23:16]) from src0 and convert to float.\nvdst = (float)((src0 >> 16) & 0xFF)',
    syntax: 'v_cvt_f32_ubyte2 vdst, src0',
    integerInput: true,
  },
  {
    mnemonic: 'v_cvt_f32_ubyte3',
    format: InstructionFormat.VOP1,
    opcode: 0x14,
    operandCount: 2,
    execute: (a) => asFloat(((a >>> 0) >> 24) & 0xFF),
    description: 'Extract byte 3 (bits [31:24]) from src0 and convert to float.\nvdst = (float)((src0 >> 24) & 0xFF)',
    syntax: 'v_cvt_f32_ubyte3 vdst, src0',
    integerInput: true,
  },
  {
    mnemonic: 'v_readfirstlane_b32',
    format: InstructionFormat.VOP1,
    opcode: 0x02,
    operandCount: 2,
    execute: (a) => a,
    description: 'Copy the value from the first active lane of src0 to all lanes of vdst.\nvdst = src0[firstActiveLane] (broadcast)',
    syntax: 'v_readfirstlane_b32 vdst, src0',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_rsq_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x2E,
    operandCount: 2,
    execute: (a) => asFloat(1.0 / Math.sqrt(a)),
    description: 'Reciprocal square root of a 32-bit float.\nvdst = 1.0 / √src0',
    syntax: 'v_rsq_f32 vdst, src0',
  },
  {
    mnemonic: 'v_not_b32',
    format: InstructionFormat.VOP1,
    opcode: 0x37,
    operandCount: 2,
    execute: (a) => (~a) >>> 0,
    description: 'Bitwise NOT of a 32-bit value.\nvdst = ~src0',
    syntax: 'v_not_b32 vdst, src0',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_sin_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x35,
    operandCount: 2,
    execute: (a) => asFloat(Math.sin(a * 2 * Math.PI)),
    description: 'Compute sin(2π × src0). Input is in turns, not radians.\nvdst = sin(2π × src0)',
    syntax: 'v_sin_f32 vdst, src0',
  },
  {
    mnemonic: 'v_cos_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x36,
    operandCount: 2,
    execute: (a) => asFloat(Math.cos(a * 2 * Math.PI)),
    description: 'Compute cos(2π × src0). Input is in turns, not radians.\nvdst = cos(2π × src0)',
    syntax: 'v_cos_f32 vdst, src0',
  },
  {
    mnemonic: 'v_bfrev_b32',
    format: InstructionFormat.VOP1,
    opcode: 0x38,
    operandCount: 2,
    execute: (a) => {
      let v = a >>> 0;
      let r = 0;
      for (let i = 0; i < 32; i++) { r = (r << 1) | (v & 1); v >>>= 1; }
      return r >>> 0;
    },
    description: 'Reverse the bits of a 32-bit value.\nvdst = bitreverse(src0)',
    syntax: 'v_bfrev_b32 vdst, src0',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_ffbh_u32',
    format: InstructionFormat.VOP1,
    opcode: 0x39,
    operandCount: 2,
    execute: (a) => {
      const v = a >>> 0;
      if (v === 0) return 0xFFFFFFFF;
      return Math.clz32(v);
    },
    description: 'Find first bit high (leading zero count) of an unsigned 32-bit integer.\nvdst = position of highest set bit from MSB (0-31), or 0xFFFFFFFF if zero',
    syntax: 'v_ffbh_u32 vdst, src0',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_ffbl_b32',
    format: InstructionFormat.VOP1,
    opcode: 0x3A,
    operandCount: 2,
    execute: (a) => {
      const v = a >>> 0;
      if (v === 0) return 0xFFFFFFFF;
      for (let i = 0; i < 32; i++) { if ((v >>> i) & 1) return i; }
      return 0xFFFFFFFF;
    },
    description: 'Find first bit low (trailing zero count) of a 32-bit value.\nvdst = position of lowest set bit (0-31), or 0xFFFFFFFF if zero',
    syntax: 'v_ffbl_b32 vdst, src0',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_ffbh_i32',
    format: InstructionFormat.VOP1,
    opcode: 0x3B,
    operandCount: 2,
    execute: (a) => {
      const v = a | 0;
      if (v === 0 || v === -1) return 0xFFFFFFFF;
      return Math.clz32(v >= 0 ? v : ~v) - 1;
    },
    description: 'Find first bit high for signed integer (position of most significant bit that differs from sign).',
    syntax: 'v_ffbh_i32 vdst, src0',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_swap_b32',
    format: InstructionFormat.VOP1,
    opcode: 0x65,
    operandCount: 2,
    execute: (a) => a,
    description: 'Swap the contents of two VGPRs.\nvdst, src0 = src0, vdst (both registers are exchanged)',
    syntax: 'v_swap_b32 vdst, vsrc0',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_cvt_f16_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x0A,
    operandCount: 2,
    execute: (a) => asFloat(a),
    description: 'Convert a 32-bit float to a 16-bit float.\nvdst = (f16)src0',
    syntax: 'v_cvt_f16_f32 vdst, src0',
  },
  {
    mnemonic: 'v_cvt_f32_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x0B,
    operandCount: 2,
    execute: (a) => asFloat(a),
    description: 'Convert a 16-bit float to a 32-bit float.\nvdst = (f32)src0',
    syntax: 'v_cvt_f32_f16 vdst, src0',
  },
  {
    mnemonic: 'v_cvt_f16_u16',
    format: InstructionFormat.VOP1,
    opcode: 0x50,
    operandCount: 2,
    execute: (a) => asFloat((a >>> 0) & 0xFFFF),
    description: 'Convert unsigned 16-bit integer to 16-bit float.\nvdst = (f16)(uint16)src0',
    syntax: 'v_cvt_f16_u16 vdst, src0',
    integerInput: true,
  },
  {
    mnemonic: 'v_cvt_f16_i16',
    format: InstructionFormat.VOP1,
    opcode: 0x51,
    operandCount: 2,
    execute: (a) => asFloat((a << 16) >> 16),
    description: 'Convert signed 16-bit integer to 16-bit float.\nvdst = (f16)(int16)src0',
    syntax: 'v_cvt_f16_i16 vdst, src0',
    integerInput: true,
  },
  {
    mnemonic: 'v_rcp_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x54,
    operandCount: 2,
    execute: (a) => asFloat(1.0 / a),
    description: 'Reciprocal of a 16-bit float.\nvdst = 1.0 / src0',
    syntax: 'v_rcp_f16 vdst, src0',
  },
  {
    mnemonic: 'v_sqrt_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x55,
    operandCount: 2,
    execute: (a) => asFloat(Math.sqrt(a)),
    description: 'Square root of a 16-bit float.\nvdst = √src0',
    syntax: 'v_sqrt_f16 vdst, src0',
  },
  {
    mnemonic: 'v_exp_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x58,
    operandCount: 2,
    execute: (a) => asFloat(Math.pow(2, a)),
    description: 'Base-2 exponential of a 16-bit float.\nvdst = 2^src0',
    syntax: 'v_exp_f16 vdst, src0',
  },
  {
    mnemonic: 'v_floor_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x5B,
    operandCount: 2,
    execute: (a) => asFloat(Math.floor(a)),
    description: 'Floor of a 16-bit float.\nvdst = floor(src0)',
    syntax: 'v_floor_f16 vdst, src0',
  },
];

// ── VOP3-only Instructions (3-source, always 64-bit) ──

const VOP3_ONLY_OPCODES: OpcodeInfo[] = [
  {
    mnemonic: 'v_fma_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x14B,
    operandCount: 4, // dst, src0, src1, src2
    execute: (a, b, c) => asFloat(a * (b ?? 0) + (c ?? 0)),
    description: 'Fused multiply-add: computes src0 × src1 + src2 with a single rounding.\nvdst = src0 × src1 + src2',
    syntax: 'v_fma_f32 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_add_lshl_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x347,
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
  {
    mnemonic: 'v_min3_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x151,
    operandCount: 4,
    execute: (a, b, c) => asFloat(Math.min(a, b ?? 0, c ?? 0)),
    description: 'Return the minimum of three 32-bit floats.\nvdst = min(src0, src1, src2)',
    syntax: 'v_min3_f32 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_max3_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x154,
    operandCount: 4,
    execute: (a, b, c) => asFloat(Math.max(a, b ?? 0, c ?? 0)),
    description: 'Return the maximum of three 32-bit floats.\nvdst = max(src0, src1, src2)',
    syntax: 'v_max3_f32 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_lshl_add_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x346,
    operandCount: 4,
    execute: (a, b, c) => (((a << ((b ?? 0) & 31)) + (c ?? 0)) >>> 0),
    description: 'Left shift src0 by src1 bits, then add src2.\nvdst = (src0 << src1) + src2',
    syntax: 'v_lshl_add_u32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_readlane_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x360,
    operandCount: 3,
    execute: (a) => a,
    description: 'Read a single lane from a VGPR.\nsdst = src0[src1]',
    syntax: 'v_readlane_b32 sdst, vsrc0, ssrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mbcnt_lo_u32_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x365,
    operandCount: 3,
    execute: (a) => a,
    description: 'Count mask bits below current lane (low 32 of exec).\nvdst = countBits(src0 & ((1 << laneId) - 1)) + src1',
    syntax: 'v_mbcnt_lo_u32_b32 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mbcnt_hi_u32_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x366,
    operandCount: 3,
    execute: (a) => a,
    description: 'Count mask bits below current lane (high 32 of exec).\nvdst = countBits(src0 & ((1 << (laneId-32)) - 1)) + src1',
    syntax: 'v_mbcnt_hi_u32_b32 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_permlanex16_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x378,
    operandCount: 4,
    execute: (a) => a,
    description: 'Cross-lane permutation across groups of 16 lanes.',
    syntax: 'v_permlanex16_b32 vdst, vsrc0, ssrc1, ssrc2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mad_i32_i24',
    format: InstructionFormat.VOP3,
    opcode: 0x142,
    operandCount: 4,
    execute: (a, b, c) => {
      const sa = (a << 8) >> 8;
      const sb = ((b ?? 0) << 8) >> 8;
      return ((sa * sb) + (c ?? 0)) | 0;
    },
    description: 'Multiply-add: (int24)src0 × (int24)src1 + src2.',
    syntax: 'v_mad_i32_i24 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_bfe_i32',
    format: InstructionFormat.VOP3,
    opcode: 0x149,
    operandCount: 4,
    execute: (a, b, c) => {
      const data = a | 0;
      const offset = (b ?? 0) & 31;
      const width = (c ?? 0) & 31;
      if (width === 0) return 0;
      const extracted = (data >> offset) & ((1 << width) - 1);
      // Sign-extend
      const signBit = (extracted >>> (width - 1)) & 1;
      return signBit ? (extracted | (~0 << width)) | 0 : extracted;
    },
    description: 'Bitfield extract (signed): extract and sign-extend a field from src0.',
    syntax: 'v_bfe_i32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_bfi_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x14A,
    operandCount: 4,
    execute: (a, b, c) => (((a >>> 0) & (b ?? 0)) | (~(a >>> 0) & (c ?? 0))) >>> 0,
    description: 'Bitfield insert: vdst = (src0 & src1) | (~src0 & src2).',
    syntax: 'v_bfi_b32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_med3_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x157,
    operandCount: 4,
    execute: (a, b, c) => {
      const vals = [a, b ?? 0, c ?? 0].sort((x, y) => x - y);
      return asFloat(vals[1]);
    },
    description: 'Median of three 32-bit floats.\nvdst = median(src0, src1, src2)',
    syntax: 'v_med3_f32 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_mul_lo_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x169,
    operandCount: 3,
    execute: (a, b) => Math.imul(a >>> 0, (b ?? 0) >>> 0) >>> 0,
    description: 'Multiply two unsigned 32-bit integers, return low 32 bits.',
    syntax: 'v_mul_lo_u32 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mul_hi_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x16A,
    operandCount: 3,
    execute: (a, b) => {
      const ua = (a >>> 0);
      const ub = ((b ?? 0) >>> 0);
      return (Number(BigInt(ua) * BigInt(ub) >> 32n)) >>> 0;
    },
    description: 'Multiply two unsigned 32-bit integers, return high 32 bits.',
    syntax: 'v_mul_hi_u32 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_add3_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x36D,
    operandCount: 4,
    execute: (a, b, c) => ((a + (b ?? 0) + (c ?? 0)) >>> 0),
    description: 'Add three unsigned 32-bit integers.\nvdst = src0 + src1 + src2',
    syntax: 'v_add3_u32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_lshl_or_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x36F,
    operandCount: 4,
    execute: (a, b, c) => (((a << ((b ?? 0) & 31)) | (c ?? 0)) >>> 0),
    description: 'Left shift src0 by src1 bits, then OR with src2.\nvdst = (src0 << src1) | src2',
    syntax: 'v_lshl_or_b32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_or3_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x372,
    operandCount: 4,
    execute: (a, b, c) => ((a | (b ?? 0) | (c ?? 0)) >>> 0),
    description: 'OR three 32-bit values.\nvdst = src0 | src1 | src2',
    syntax: 'v_or3_b32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pack_b32_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x311,
    operandCount: 3,
    execute: (a, b) => (((a & 0xFFFF) | (((b ?? 0) & 0xFFFF) << 16)) >>> 0),
    description: 'Pack two f16 values into a 32-bit register.\nvdst = {src1[15:0], src0[15:0]}',
    syntax: 'v_pack_b32_f16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_fma_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x34B,
    operandCount: 4,
    execute: (a, b, c) => asFloat(a * (b ?? 0) + (c ?? 0)),
    description: 'Fused multiply-add for 16-bit floats.\nvdst = src0 × src1 + src2',
    syntax: 'v_fma_f16 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_min3_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x351,
    operandCount: 4,
    execute: (a, b, c) => asFloat(Math.min(a, b ?? 0, c ?? 0)),
    description: 'Minimum of three 16-bit floats.',
    syntax: 'v_min3_f16 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_max3_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x354,
    operandCount: 4,
    execute: (a, b, c) => asFloat(Math.max(a, b ?? 0, c ?? 0)),
    description: 'Maximum of three 16-bit floats.',
    syntax: 'v_max3_f16 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_med3_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x357,
    operandCount: 4,
    execute: (a, b, c) => {
      const vals = [a, b ?? 0, c ?? 0].sort((x, y) => x - y);
      return asFloat(vals[1]);
    },
    description: 'Median of three 16-bit floats.',
    syntax: 'v_med3_f16 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_med3_i16',
    format: InstructionFormat.VOP3,
    opcode: 0x358,
    operandCount: 4,
    execute: (a, b, c) => {
      const vals = [a | 0, (b ?? 0) | 0, (c ?? 0) | 0].sort((x, y) => x - y);
      return vals[1];
    },
    description: 'Median of three signed 16-bit integers.',
    syntax: 'v_med3_i16 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_add_nc_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x303,
    operandCount: 3,
    execute: (a, b) => ((a + (b ?? 0)) & 0xFFFF),
    description: 'Add two unsigned 16-bit integers (no carry).',
    syntax: 'v_add_nc_u16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_sub_nc_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x304,
    operandCount: 3,
    execute: (a, b) => ((a - (b ?? 0)) & 0xFFFF),
    description: 'Subtract two unsigned 16-bit integers (no carry).',
    syntax: 'v_sub_nc_u16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_lshrrev_b16',
    format: InstructionFormat.VOP3,
    opcode: 0x307,
    operandCount: 3,
    execute: (a, b) => (((b ?? 0) >>> (a & 15)) & 0xFFFF),
    description: 'Logical right shift 16-bit value (reversed operand order).',
    syntax: 'v_lshrrev_b16 vdst, src0, src1',
    isIntegerOp: true,
  },
  // VOP3P packed instructions (prefix 0x33, treated as VOP3)
  {
    mnemonic: 'v_pk_mul_lo_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x001,
    operandCount: 3,
    execute: (a) => a,
    description: 'Packed multiply low unsigned 16-bit.',
    syntax: 'v_pk_mul_lo_u16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_sub_i16',
    format: InstructionFormat.VOP3,
    opcode: 0x003,
    operandCount: 3,
    execute: (a) => a,
    description: 'Packed subtract signed 16-bit.',
    syntax: 'v_pk_sub_i16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_lshlrev_b16',
    format: InstructionFormat.VOP3,
    opcode: 0x004,
    operandCount: 3,
    execute: (a) => a,
    description: 'Packed left shift rev 16-bit.',
    syntax: 'v_pk_lshlrev_b16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_add_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x00A,
    operandCount: 3,
    execute: (a) => a,
    description: 'Packed add unsigned 16-bit.',
    syntax: 'v_pk_add_u16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_fma_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x00E,
    operandCount: 4,
    execute: (a, b, c) => asFloat(a * (b ?? 0) + (c ?? 0)),
    description: 'Packed fused multiply-add f16.',
    syntax: 'v_pk_fma_f16 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_pk_add_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x00F,
    operandCount: 3,
    execute: (a, b) => asFloat(a + (b ?? 0)),
    description: 'Packed add f16.',
    syntax: 'v_pk_add_f16 vdst, src0, src1',
  },
  {
    mnemonic: 'v_pk_mul_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x010,
    operandCount: 3,
    execute: (a, b) => asFloat(a * (b ?? 0)),
    description: 'Packed multiply f16.',
    syntax: 'v_pk_mul_f16 vdst, src0, src1',
  },
  {
    mnemonic: 'v_pk_min_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x011,
    operandCount: 3,
    execute: (a, b) => Math.min(a, b ?? 0),
    description: 'Packed minimum f16.',
    syntax: 'v_pk_min_f16 vdst, src0, src1',
  },
  {
    mnemonic: 'v_pk_max_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x012,
    operandCount: 3,
    execute: (a, b) => Math.max(a, b ?? 0),
    description: 'Packed maximum f16.',
    syntax: 'v_pk_max_f16 vdst, src0, src1',
  },
  {
    mnemonic: 'v_perm_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x344,
    operandCount: 4,
    execute: (a, b, c) => {
      // Permute bytes from src0 and src1 based on selector src2
      // Each nibble of src2 selects a byte:
      //   0-3: byte 0-3 of src1
      //   4-7: byte 0-3 of src0
      //   8-11: reserved (0)
      //   12: 0x00, 13: 0xFF
      const s0 = (a ?? 0) >>> 0;
      const s1 = (b ?? 0) >>> 0;
      const sel = (c ?? 0) >>> 0;
      let result = 0;
      for (let i = 0; i < 4; i++) {
        const nibble = (sel >>> (i * 8)) & 0xFF;
        let byte: number;
        if (nibble <= 3) byte = (s1 >>> (nibble * 8)) & 0xFF;
        else if (nibble <= 7) byte = (s0 >>> ((nibble - 4) * 8)) & 0xFF;
        else if (nibble === 0x0C) byte = 0x00;
        else if (nibble === 0x0D) byte = 0xFF;
        else byte = 0;
        result |= byte << (i * 8);
      }
      return result >>> 0;
    },
    description: 'Byte permutation. Each byte of vdst is selected from src0 or src1 by a selector in src2.\nSelector nibbles: 0-3=src1 bytes, 4-7=src0 bytes, 0xC=0x00, 0xD=0xFF.',
    syntax: 'v_perm_b32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
];

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
  {
    mnemonic: 'v_cmp_nge_f32',
    format: InstructionFormat.VOPC,
    opcode: 0x09,
    operandCount: 2,
    execute: (a, b) => (!(a >= (b ?? 0))) ? 1 : 0,
    description: 'Compare two 32-bit floats: set VCC if NOT (src0 >= vsrc1).\nVCC[lane] = !(src0 >= vsrc1) (unordered)',
    syntax: 'v_cmp_nge_f32 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_nle_f32',
    format: InstructionFormat.VOPC,
    opcode: 0x0C,
    operandCount: 2,
    execute: (a, b) => (!(a <= (b ?? 0))) ? 1 : 0,
    description: 'Compare two 32-bit floats: set VCC if NOT (src0 <= vsrc1).\nVCC[lane] = !(src0 <= vsrc1) (unordered)',
    syntax: 'v_cmp_nle_f32 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_lt_i32',
    format: InstructionFormat.VOPC,
    opcode: 0x81,
    operandCount: 2,
    execute: (a, b) => ((a | 0) < ((b ?? 0) | 0)) ? 1 : 0,
    description: 'Compare two signed 32-bit integers: set VCC if src0 < vsrc1.',
    syntax: 'v_cmp_lt_i32 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_eq_u32',
    format: InstructionFormat.VOPC,
    opcode: 0xC2,
    operandCount: 2,
    execute: (a, b) => ((a >>> 0) === ((b ?? 0) >>> 0)) ? 1 : 0,
    description: 'Compare two unsigned 32-bit integers: set VCC if src0 == vsrc1.',
    syntax: 'v_cmp_eq_u32 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_ne_u32',
    format: InstructionFormat.VOPC,
    opcode: 0xC5,
    operandCount: 2,
    execute: (a, b) => ((a >>> 0) !== ((b ?? 0) >>> 0)) ? 1 : 0,
    description: 'Compare two unsigned 32-bit integers: set VCC if src0 != vsrc1.',
    syntax: 'v_cmp_ne_u32 src0, vsrc1',
    writesVCC: true,
  },
  // v_cmpx_* — write to EXEC instead of VCC
  {
    mnemonic: 'v_cmpx_eq_i32',
    format: InstructionFormat.VOPC,
    opcode: 0x92,
    operandCount: 2,
    execute: (a, b) => ((a | 0) === ((b ?? 0) | 0)) ? 1 : 0,
    description: 'Compare signed ints and write to EXEC mask.',
    syntax: 'v_cmpx_eq_i32 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmpx_eq_u32',
    format: InstructionFormat.VOPC,
    opcode: 0xD2,
    operandCount: 2,
    execute: (a, b) => ((a >>> 0) === ((b ?? 0) >>> 0)) ? 1 : 0,
    description: 'Compare unsigned ints and write to EXEC mask.',
    syntax: 'v_cmpx_eq_u32 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmpx_gt_u32',
    format: InstructionFormat.VOPC,
    opcode: 0xD4,
    operandCount: 2,
    execute: (a, b) => ((a >>> 0) > ((b ?? 0) >>> 0)) ? 1 : 0,
    description: 'Compare unsigned ints (greater than) and write to EXEC mask.',
    syntax: 'v_cmpx_gt_u32 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmpx_ne_u32',
    format: InstructionFormat.VOPC,
    opcode: 0xD5,
    operandCount: 2,
    execute: (a, b) => ((a >>> 0) !== ((b ?? 0) >>> 0)) ? 1 : 0,
    description: 'Compare unsigned ints (not equal) and write to EXEC mask.',
    syntax: 'v_cmpx_ne_u32 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_lt_u32',
    format: InstructionFormat.VOPC,
    opcode: 0xC1,
    operandCount: 2,
    execute: (a, b) => ((a >>> 0) < ((b ?? 0) >>> 0)) ? 1 : 0,
    description: 'Compare two unsigned 32-bit integers: set VCC if src0 < vsrc1.',
    syntax: 'v_cmp_lt_u32 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_lt_f16',
    format: InstructionFormat.VOPC,
    opcode: 0xC9,
    operandCount: 2,
    execute: (a, b) => (a < (b ?? 0)) ? 1 : 0,
    description: 'Compare two 16-bit floats: set VCC if src0 < vsrc1.',
    syntax: 'v_cmp_lt_f16 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_gt_f16',
    format: InstructionFormat.VOPC,
    opcode: 0xCC,
    operandCount: 2,
    execute: (a, b) => (a > (b ?? 0)) ? 1 : 0,
    description: 'Compare two 16-bit floats: set VCC if src0 > vsrc1.',
    syntax: 'v_cmp_gt_f16 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_eq_u16',
    format: InstructionFormat.VOPC,
    opcode: 0xAA,
    operandCount: 2,
    execute: (a, b) => ((a & 0xFFFF) === ((b ?? 0) & 0xFFFF)) ? 1 : 0,
    description: 'Compare two unsigned 16-bit integers: set VCC if src0 == vsrc1.',
    syntax: 'v_cmp_eq_u16 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_ne_u16',
    format: InstructionFormat.VOPC,
    opcode: 0xAD,
    operandCount: 2,
    execute: (a, b) => ((a & 0xFFFF) !== ((b ?? 0) & 0xFFFF)) ? 1 : 0,
    description: 'Compare two unsigned 16-bit integers: set VCC if src0 != vsrc1.',
    syntax: 'v_cmp_ne_u16 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_lt_i16',
    format: InstructionFormat.VOPC,
    opcode: 0x89,
    operandCount: 2,
    execute: (a, b) => (((a << 16) >> 16) < (((b ?? 0) << 16) >> 16)) ? 1 : 0,
    description: 'Compare two signed 16-bit integers: set VCC if src0 < vsrc1.',
    syntax: 'v_cmp_lt_i16 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_le_i16',
    format: InstructionFormat.VOPC,
    opcode: 0x8B,
    operandCount: 2,
    execute: (a, b) => (((a << 16) >> 16) <= (((b ?? 0) << 16) >> 16)) ? 1 : 0,
    description: 'Compare two signed 16-bit integers: set VCC if src0 <= vsrc1.',
    syntax: 'v_cmp_le_i16 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_gt_i16',
    format: InstructionFormat.VOPC,
    opcode: 0x8C,
    operandCount: 2,
    execute: (a, b) => (((a << 16) >> 16) > (((b ?? 0) << 16) >> 16)) ? 1 : 0,
    description: 'Compare two signed 16-bit integers: set VCC if src0 > vsrc1.',
    syntax: 'v_cmp_gt_i16 src0, vsrc1',
    writesVCC: true,
  },
  {
    mnemonic: 'v_cmp_ge_i16',
    format: InstructionFormat.VOPC,
    opcode: 0x8E,
    operandCount: 2,
    execute: (a, b) => (((a << 16) >> 16) >= (((b ?? 0) << 16) >> 16)) ? 1 : 0,
    description: 'Compare two signed 16-bit integers: set VCC if src0 >= vsrc1.',
    syntax: 'v_cmp_ge_i16 src0, vsrc1',
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
  {
    mnemonic: 's_mov_b64',
    format: InstructionFormat.SOP1,
    opcode: 0x04,
    operandCount: 2,
    execute: (a) => a,
    description: 'Copy a 64-bit scalar value.\nsdst = ssrc0 (64-bit)',
    syntax: 's_mov_b64 sdst, ssrc0',
  },
  {
    mnemonic: 's_ff1_i32_b64',
    format: InstructionFormat.SOP1,
    opcode: 0x14,
    operandCount: 2,
    execute: (a) => {
      const v = a >>> 0;
      if (v === 0) return 0xFFFFFFFF;
      for (let i = 0; i < 32; i++) { if ((v >>> i) & 1) return i; }
      return 0xFFFFFFFF;
    },
    description: 'Find first one in a 64-bit value.\nsdst = findFirstOne(ssrc0)',
    syntax: 's_ff1_i32_b64 sdst, ssrc0',
  },
  {
    mnemonic: 's_flbit_i32_b32',
    format: InstructionFormat.SOP1,
    opcode: 0x15,
    operandCount: 2,
    execute: (a) => {
      const v = a >>> 0;
      if (v === 0) return 0xFFFFFFFF;
      return Math.clz32(v);
    },
    description: 'Find last bit (count leading zeros/ones) of a signed 32-bit integer.',
    syntax: 's_flbit_i32_b32 sdst, ssrc0',
  },
  {
    mnemonic: 's_and_saveexec_b64',
    format: InstructionFormat.SOP1,
    opcode: 0x24,
    operandCount: 2,
    execute: (a) => a,
    description: 'Save EXEC to sdst, then AND ssrc0 into EXEC.\nsdst = EXEC; EXEC &= ssrc0',
    syntax: 's_and_saveexec_b64 sdst, ssrc0',
  },
  {
    mnemonic: 's_or_saveexec_b64',
    format: InstructionFormat.SOP1,
    opcode: 0x25,
    operandCount: 2,
    execute: (a) => a,
    description: 'Save EXEC to sdst, then OR ssrc0 into EXEC.\nsdst = EXEC; EXEC |= ssrc0',
    syntax: 's_or_saveexec_b64 sdst, ssrc0',
  },
  {
    mnemonic: 's_bcnt1_i32_b32',
    format: InstructionFormat.SOP1,
    opcode: 0x0F,
    operandCount: 2,
    execute: (a) => {
      let v = a >>> 0;
      let count = 0;
      while (v) { count += v & 1; v >>>= 1; }
      return count;
    },
    description: 'Count set bits (popcount) of a 32-bit value.',
    syntax: 's_bcnt1_i32_b32 sdst, ssrc0',
  },
  {
    mnemonic: 's_ff1_i32_b32',
    format: InstructionFormat.SOP1,
    opcode: 0x13,
    operandCount: 2,
    execute: (a) => {
      const v = a >>> 0;
      if (v === 0) return 0xFFFFFFFF;
      for (let i = 0; i < 32; i++) { if ((v >>> i) & 1) return i; }
      return 0xFFFFFFFF;
    },
    description: 'Find first one in a 32-bit value.',
    syntax: 's_ff1_i32_b32 sdst, ssrc0',
  },
  {
    mnemonic: 's_and_saveexec_b32',
    format: InstructionFormat.SOP1,
    opcode: 0x3C,
    operandCount: 2,
    execute: (a) => a,
    description: 'Save EXEC to sdst, then AND ssrc0 into EXEC (32-bit).\nsdst = EXEC_LO; EXEC_LO &= ssrc0',
    syntax: 's_and_saveexec_b32 sdst, ssrc0',
  },
];

// ── SOPP Instructions (scalar, no operands / immediate only) ──

const SOPP_OPCODES: OpcodeInfo[] = [
  {
    mnemonic: 's_nop',
    format: InstructionFormat.SOPP,
    opcode: 0x00,
    operandCount: 0,
    execute: () => 0,
    description: 'No operation (scalar). Can encode a count in SIMM16.',
    syntax: 's_nop simm16',
  },
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
  {
    mnemonic: 's_branch',
    format: InstructionFormat.SOPP,
    opcode: 0x02,
    operandCount: 0,
    execute: () => 0,
    description: 'Unconditional branch to PC + SIMM16 × 4.',
    syntax: 's_branch simm16',
  },
  {
    mnemonic: 's_cbranch_scc1',
    format: InstructionFormat.SOPP,
    opcode: 0x05,
    operandCount: 0,
    execute: () => 0,
    description: 'Conditional branch if SCC == 1.',
    syntax: 's_cbranch_scc1 simm16',
  },
  {
    mnemonic: 's_cbranch_execz',
    format: InstructionFormat.SOPP,
    opcode: 0x08,
    operandCount: 0,
    execute: () => 0,
    description: 'Conditional branch if EXEC == 0.',
    syntax: 's_cbranch_execz simm16',
  },
  {
    mnemonic: 's_waitcnt',
    format: InstructionFormat.SOPP,
    opcode: 0x0C,
    operandCount: 0,
    execute: () => 0,
    description: 'Wait for outstanding memory operations to complete.',
    syntax: 's_waitcnt simm16',
  },
  {
    mnemonic: 's_inst_prefetch',
    format: InstructionFormat.SOPP,
    opcode: 0x20,
    operandCount: 0,
    execute: () => 0,
    description: 'Instruction prefetch hint.',
    syntax: 's_inst_prefetch simm16',
  },
  {
    mnemonic: 's_cbranch_scc0',
    format: InstructionFormat.SOPP,
    opcode: 0x04,
    operandCount: 0,
    execute: () => 0,
    description: 'Conditional branch if SCC == 0.',
    syntax: 's_cbranch_scc0 simm16',
  },
  {
    mnemonic: 's_cbranch_vccnz',
    format: InstructionFormat.SOPP,
    opcode: 0x07,
    operandCount: 0,
    execute: () => 0,
    description: 'Conditional branch if VCC != 0.',
    syntax: 's_cbranch_vccnz simm16',
  },
  {
    mnemonic: 's_barrier',
    format: InstructionFormat.SOPP,
    opcode: 0x0A,
    operandCount: 0,
    execute: () => 0,
    description: 'Synchronization barrier for all waves in a threadgroup.',
    syntax: 's_barrier',
  },
];

// ── SOP2 Instructions (scalar, 2-source) ──

const SOP2_OPCODES: OpcodeInfo[] = [
  { mnemonic: 's_add_i32', format: InstructionFormat.SOP2, opcode: 0x02, operandCount: 3, execute: (a, b) => (a + (b ?? 0)) | 0, description: 'Scalar add signed 32-bit.', syntax: 's_add_i32 sdst, ssrc0, ssrc1' },
  { mnemonic: 's_cselect_b32', format: InstructionFormat.SOP2, opcode: 0x0A, operandCount: 3, execute: (a, _b) => a, description: 'Scalar conditional select based on SCC.', syntax: 's_cselect_b32 sdst, ssrc0, ssrc1' },
  { mnemonic: 's_and_b32', format: InstructionFormat.SOP2, opcode: 0x0E, operandCount: 3, execute: (a, b) => (a & (b ?? 0)) >>> 0, description: 'Scalar bitwise AND (32-bit).', syntax: 's_and_b32 sdst, ssrc0, ssrc1' },
  { mnemonic: 's_and_b64', format: InstructionFormat.SOP2, opcode: 0x0F, operandCount: 3, execute: (a, b) => (a & (b ?? 0)) >>> 0, description: 'Scalar bitwise AND (64-bit).', syntax: 's_and_b64 sdst, ssrc0, ssrc1' },
  { mnemonic: 's_or_b64', format: InstructionFormat.SOP2, opcode: 0x11, operandCount: 3, execute: (a, b) => (a | (b ?? 0)) >>> 0, description: 'Scalar bitwise OR (64-bit).', syntax: 's_or_b64 sdst, ssrc0, ssrc1' },
  { mnemonic: 's_xor_b64', format: InstructionFormat.SOP2, opcode: 0x13, operandCount: 3, execute: (a, b) => (a ^ (b ?? 0)) >>> 0, description: 'Scalar bitwise XOR (64-bit).', syntax: 's_xor_b64 sdst, ssrc0, ssrc1' },
  { mnemonic: 's_andn2_b64', format: InstructionFormat.SOP2, opcode: 0x15, operandCount: 3, execute: (a, b) => (a & ~(b ?? 0)) >>> 0, description: 'Scalar AND-NOT2 (64-bit): sdst = ssrc0 & ~ssrc1.', syntax: 's_andn2_b64 sdst, ssrc0, ssrc1' },
  { mnemonic: 's_lshl_b32', format: InstructionFormat.SOP2, opcode: 0x1E, operandCount: 3, execute: (a, b) => (a << ((b ?? 0) & 31)) >>> 0, description: 'Scalar left shift (32-bit).', syntax: 's_lshl_b32 sdst, ssrc0, ssrc1' },
  { mnemonic: 's_mul_i32', format: InstructionFormat.SOP2, opcode: 0x26, operandCount: 3, execute: (a, b) => Math.imul(a, b ?? 0) | 0, description: 'Scalar multiply signed 32-bit.', syntax: 's_mul_i32 sdst, ssrc0, ssrc1' },
  { mnemonic: 's_or_b32', format: InstructionFormat.SOP2, opcode: 0x10, operandCount: 3, execute: (a, b) => (a | (b ?? 0)) >>> 0, description: 'Scalar bitwise OR (32-bit).', syntax: 's_or_b32 sdst, ssrc0, ssrc1' },
  { mnemonic: 's_xor_b32', format: InstructionFormat.SOP2, opcode: 0x12, operandCount: 3, execute: (a, b) => (a ^ (b ?? 0)) >>> 0, description: 'Scalar bitwise XOR (32-bit).', syntax: 's_xor_b32 sdst, ssrc0, ssrc1' },
  { mnemonic: 's_andn2_b32', format: InstructionFormat.SOP2, opcode: 0x14, operandCount: 3, execute: (a, b) => (a & ~(b ?? 0)) >>> 0, description: 'Scalar AND-NOT2 (32-bit): sdst = ssrc0 & ~ssrc1.', syntax: 's_andn2_b32 sdst, ssrc0, ssrc1' },
];

// ── SOPC Instructions (scalar compare) ──

const SOPC_OPCODES: OpcodeInfo[] = [
  { mnemonic: 's_cmp_eq_u32', format: InstructionFormat.SOPC, opcode: 0x06, operandCount: 2, execute: (a, b) => ((a >>> 0) === ((b ?? 0) >>> 0)) ? 1 : 0, description: 'Scalar compare equal unsigned 32-bit. Sets SCC.', syntax: 's_cmp_eq_u32 ssrc0, ssrc1' },
  { mnemonic: 's_cmp_lg_u32', format: InstructionFormat.SOPC, opcode: 0x07, operandCount: 2, execute: (a, b) => ((a >>> 0) !== ((b ?? 0) >>> 0)) ? 1 : 0, description: 'Scalar compare not-equal unsigned 32-bit. Sets SCC.', syntax: 's_cmp_lg_u32 ssrc0, ssrc1' },
];

// ── SOPK Instructions (scalar with inline constant) ──

const SOPK_OPCODES: OpcodeInfo[] = [
  { mnemonic: 's_movk_i32', format: InstructionFormat.SOPK, opcode: 0x00, operandCount: 2, execute: (a) => a, description: 'Move a 16-bit immediate into an SGPR (sign-extended).', syntax: 's_movk_i32 sdst, simm16' },
  { mnemonic: 's_setreg_imm32_b32', format: InstructionFormat.SOPK, opcode: 0x15, operandCount: 2, execute: (a) => a, description: 'Set hardware register from 32-bit immediate.', syntax: 's_setreg_imm32_b32 hwreg, imm32' },
  { mnemonic: 's_waitcnt_vscnt', format: InstructionFormat.SOPK, opcode: 0x17, operandCount: 0, execute: () => 0, description: 'Wait for vector store count to reach a specified value.', syntax: 's_waitcnt_vscnt null, simm16' },
];

// ── SMEM Instructions (scalar memory) ──

const SMEM_OPCODES: OpcodeInfo[] = [
  { mnemonic: 's_load_dword', format: InstructionFormat.SMEM, opcode: 0x00, operandCount: 3, execute: (a) => a, description: 'Scalar load 1 dword.', syntax: 's_load_dword sdst, sbase, offset' },
  { mnemonic: 's_load_dwordx2', format: InstructionFormat.SMEM, opcode: 0x01, operandCount: 3, execute: (a) => a, description: 'Scalar load 2 dwords.', syntax: 's_load_dwordx2 sdst, sbase, offset' },
  { mnemonic: 's_load_dwordx4', format: InstructionFormat.SMEM, opcode: 0x02, operandCount: 3, execute: (a) => a, description: 'Scalar load 4 dwords.', syntax: 's_load_dwordx4 sdst, sbase, offset' },
  { mnemonic: 's_load_dwordx8', format: InstructionFormat.SMEM, opcode: 0x03, operandCount: 3, execute: (a) => a, description: 'Scalar load 8 dwords.', syntax: 's_load_dwordx8 sdst, sbase, offset' },
  { mnemonic: 's_buffer_load_dword', format: InstructionFormat.SMEM, opcode: 0x08, operandCount: 3, execute: (a) => a, description: 'Scalar buffer load 1 dword.', syntax: 's_buffer_load_dword sdst, sbase, offset' },
  { mnemonic: 's_buffer_load_dwordx2', format: InstructionFormat.SMEM, opcode: 0x09, operandCount: 3, execute: (a) => a, description: 'Scalar buffer load 2 dwords.', syntax: 's_buffer_load_dwordx2 sdst, sbase, offset' },
  { mnemonic: 's_buffer_load_dwordx4', format: InstructionFormat.SMEM, opcode: 0x0A, operandCount: 3, execute: (a) => a, description: 'Scalar buffer load 4 dwords.', syntax: 's_buffer_load_dwordx4 sdst, sbase, offset' },
  { mnemonic: 's_buffer_load_dwordx8', format: InstructionFormat.SMEM, opcode: 0x0B, operandCount: 3, execute: (a) => a, description: 'Scalar buffer load 8 dwords.', syntax: 's_buffer_load_dwordx8 sdst, sbase, offset' },
  { mnemonic: 's_buffer_load_dwordx16', format: InstructionFormat.SMEM, opcode: 0x0C, operandCount: 3, execute: (a) => a, description: 'Scalar buffer load 16 dwords.', syntax: 's_buffer_load_dwordx16 sdst, sbase, offset' },
];

// ── MUBUF Instructions (buffer memory) ──

const MUBUF_OPCODES: OpcodeInfo[] = [
  { mnemonic: 'buffer_load_format_x', format: InstructionFormat.MUBUF, opcode: 0x00, operandCount: 3, execute: (a) => a, description: 'Typed buffer load (x component).', syntax: 'buffer_load_format_x vdata, vaddr, srsrc' },
  { mnemonic: 'buffer_load_dword', format: InstructionFormat.MUBUF, opcode: 0x0C, operandCount: 3, execute: (a) => a, description: 'Buffer load 1 dword.', syntax: 'buffer_load_dword vdata, vaddr, srsrc' },
  { mnemonic: 'buffer_load_dwordx2', format: InstructionFormat.MUBUF, opcode: 0x0D, operandCount: 3, execute: (a) => a, description: 'Buffer load 2 dwords.', syntax: 'buffer_load_dwordx2 vdata, vaddr, srsrc' },
  { mnemonic: 'buffer_load_dwordx4', format: InstructionFormat.MUBUF, opcode: 0x0E, operandCount: 3, execute: (a) => a, description: 'Buffer load 4 dwords.', syntax: 'buffer_load_dwordx4 vdata, vaddr, srsrc' },
  { mnemonic: 'buffer_load_dwordx3', format: InstructionFormat.MUBUF, opcode: 0x0F, operandCount: 3, execute: (a) => a, description: 'Buffer load 3 dwords.', syntax: 'buffer_load_dwordx3 vdata, vaddr, srsrc' },
  { mnemonic: 'buffer_store_dword', format: InstructionFormat.MUBUF, opcode: 0x1C, operandCount: 3, execute: (a) => a, description: 'Buffer store 1 dword.', syntax: 'buffer_store_dword vdata, vaddr, srsrc' },
  { mnemonic: 'buffer_atomic_add', format: InstructionFormat.MUBUF, opcode: 0x32, operandCount: 3, execute: (a) => a, description: 'Atomic add to buffer.', syntax: 'buffer_atomic_add vdata, vaddr, srsrc' },
];

// ── MIMG Instructions (image memory) ──

const MIMG_OPCODES: OpcodeInfo[] = [
  { mnemonic: 'image_load', format: InstructionFormat.MIMG, opcode: 0x00, operandCount: 3, execute: (a) => a, description: 'Image load from texture.', syntax: 'image_load vdata, vaddr, srsrc' },
  { mnemonic: 'image_store', format: InstructionFormat.MIMG, opcode: 0x08, operandCount: 3, execute: (a) => a, description: 'Image store to texture.', syntax: 'image_store vdata, vaddr, srsrc' },
  { mnemonic: 'image_sample_lz', format: InstructionFormat.MIMG, opcode: 0x27, operandCount: 3, execute: (a) => a, description: 'Image sample with LOD zero.', syntax: 'image_sample_lz vdata, vaddr, srsrc, ssamp' },
  { mnemonic: 'image_gather4_l', format: InstructionFormat.MIMG, opcode: 0x44, operandCount: 3, execute: (a) => a, description: 'Gather 4 texels with explicit LOD.', syntax: 'image_gather4_l vdata, vaddr, srsrc, ssamp' },
];

// ── DS Instructions (data share / LDS) ──

const DS_OPCODES: OpcodeInfo[] = [
  { mnemonic: 'ds_write_b32', format: InstructionFormat.DS, opcode: 0x0D, operandCount: 2, execute: (a) => a, description: 'Write 32 bits to LDS.', syntax: 'ds_write_b32 vaddr, vdata' },
  { mnemonic: 'ds_write2st64_b32', format: InstructionFormat.DS, opcode: 0x0F, operandCount: 3, execute: (a) => a, description: 'Write two 32-bit values to LDS with stride 64.', syntax: 'ds_write2st64_b32 vaddr, vdata0, vdata1' },
  { mnemonic: 'ds_swizzle_b32', format: InstructionFormat.DS, opcode: 0x35, operandCount: 2, execute: (a) => a, description: 'Cross-lane data swizzle in LDS.', syntax: 'ds_swizzle_b32 vdst, vsrc' },
  { mnemonic: 'ds_read_b32', format: InstructionFormat.DS, opcode: 0x36, operandCount: 2, execute: (a) => a, description: 'Read 32 bits from LDS.', syntax: 'ds_read_b32 vdst, vaddr' },
  { mnemonic: 'ds_read2st64_b32', format: InstructionFormat.DS, opcode: 0x38, operandCount: 2, execute: (a) => a, description: 'Read two 32-bit values from LDS with stride 64.', syntax: 'ds_read2st64_b32 vdst, vaddr' },
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
register(SOP2_OPCODES);
register(SOPC_OPCODES);
register(SOPK_OPCODES);
register(SMEM_OPCODES);
register(MUBUF_OPCODES);
register(MIMG_OPCODES);
register(DS_OPCODES);

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
