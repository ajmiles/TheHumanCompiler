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
    mnemonic: 'v_swap_b32',
    format: InstructionFormat.VOP1,
    opcode: 0x65,
    operandCount: 2,
    execute: (a) => a,
    description: 'Swap the contents of two VGPRs.\nvdst, src0 = src0, vdst (both registers are exchanged)',
    syntax: 'v_swap_b32 vdst, vsrc0',
    isIntegerOp: true,
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
