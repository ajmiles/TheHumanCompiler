// ── RDNA2 Opcode Table ──
// Maps mnemonic → opcode info with encoding format and semantic function

import { CompareOp, CompareType, InstructionFormat, OpcodeInfo, SaluSemantics, SaluContext, ScalarWidth, SemanticFn, ValueType } from './types';
import { f16ToF32, f32ToF16 } from './float16';
import { bitsToF64, divFixupF64, divScaleF64, f64ToBits, fmaF64, frexpF64, ldexpF64, rndneF64, trigPreopF64 } from './float64';

// IEEE 754 helper for bit-exact float operations
const f32 = new Float32Array(1);

function asFloat(v: number): number {
  // Reinterpret a value through f32 to match GPU precision
  f32[0] = v;
  return f32[0];
}

/** V_MIN_F32 semantics: a NaN operand yields the other operand; -0 < +0. */
function fmin(a: number, b: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  if (a === 0 && b === 0) return Object.is(a, -0) || Object.is(b, -0) ? -0 : 0;
  return a < b ? a : b;
}

/** V_MAX_F32 semantics: a NaN operand yields the other operand; +0 > -0. */
function fmax(a: number, b: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  if (a === 0 && b === 0) return Object.is(a, 0) || Object.is(b, 0) ? 0 : -0;
  return a > b ? a : b;
}

/** V_MED3_F32 semantics (NaN inputs fall back to min3). */
function fmed3(a: number, b: number, c: number): number {
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) return fmin(fmin(a, b), c);
  const mx = fmax(fmax(a, b), c);
  if (mx === a) return fmax(b, c);
  if (mx === b) return fmax(a, c);
  return fmax(a, b);
}

/** DX9 multiply rule: 0.0 times anything (including Inf/NaN) is 0.0. */
function legacyMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : a * b;
}

/** V_RNDNE semantics: round to nearest, ties to even. */
function rndne(a: number): number {
  if (!Number.isFinite(a)) return a;
  const fl = Math.floor(a);
  let r = Math.floor(a + 0.5);
  if (a - fl === 0.5 && fl % 2 === 0) r -= 1;
  return r === 0 ? (Object.is(a, -0) || a < 0 ? -0 : 0) : r;
}

/** Float → signed integer conversion with saturation; NaN converts to 0. */
function satI32(a: number): number {
  if (Number.isNaN(a)) return 0;
  return Math.max(-2147483648, Math.min(2147483647, Math.trunc(a))) | 0;
}

/** Float → 16-bit integer conversions with saturation (returned as raw 16-bit values). */
function satU16(a: number): number {
  if (Number.isNaN(a)) return 0;
  return Math.max(0, Math.min(65535, Math.trunc(a)));
}
function satI16(a: number): number {
  if (Number.isNaN(a)) return 0;
  return Math.max(-32768, Math.min(32767, Math.trunc(a))) & 0xFFFF;
}

/**
 * Float → normalized 16-bit integer (raw 16-bit result): clamp to [-1, 1] (snorm) or [0, 1] (unorm),
 * scale by 32767 or 65535 and round to nearest even. NaN converts to 0.
 */
function snorm16(a: number): number {
  if (Number.isNaN(a)) return 0;
  return rndne(Math.fround(Math.max(-1, Math.min(1, a)) * 32767)) & 0xFFFF;
}
function unorm16(a: number): number {
  if (Number.isNaN(a)) return 0;
  return rndne(Math.fround(Math.max(0, Math.min(1, a)) * 65535)) & 0xFFFF;
}

/** 32-bit integer → 16-bit integer with saturation (raw 16-bit result). */
const satI32ToI16 = (v: number) => Math.max(-32768, Math.min(32767, v | 0)) & 0xFFFF;
const satU32ToU16 = (v: number) => Math.min(65535, v >>> 0);

/** Exact sum of the pairwise products of the `bits`-wide elements packed into a and b. */
function dotProduct(a: number, b: number, bits: 4 | 8 | 16, signed: boolean): number {
  const mask = (1 << bits) - 1;
  const element = (v: number, i: number) => {
    const x = (v >>> (i * bits)) & mask;
    return signed && x > mask >> 1 ? x - mask - 1 : x;
  };
  let sum = 0;
  for (let i = 0; i < 32 / bits; i++) sum += element(a, i) * element(b, i);
  return sum;
}

/** Dot product of two packed f16 pairs plus an f32, computed exactly (the caller rounds to f32). */
function dotF16(a: number, b: number, c: number): number {
  return f16ToF32(a & 0xFFFF) * f16ToF32(b & 0xFFFF) + f16ToF32(a >>> 16) * f16ToF32(b >>> 16) + c;
}

/** Sum of absolute differences of the four unsigned bytes of a and b, plus acc. */
export function sadU8(a: number, b: number, acc: number): number {
  let sum = acc >>> 0;
  for (let i = 0; i < 4; i++) sum += Math.abs(((a >>> (i * 8)) & 0xFF) - ((b >>> (i * 8)) & 0xFF));
  return sum >>> 0;
}

/** Masked SAD: bytes where the reference value b is zero are skipped. */
export function msadU8(a: number, b: number, acc: number): number {
  let sum = acc >>> 0;
  for (let i = 0; i < 4; i++) {
    const ref = (b >>> (i * 8)) & 0xFF;
    if (ref !== 0) sum += Math.abs(((a >>> (i * 8)) & 0xFF) - ref);
  }
  return sum >>> 0;
}

/** Appended to packed f16 descriptions: constants are not replicated into the high half. */
const PK_F16_CONST_NOTE =
  '\nA constant such as 2.0 has 0 in its high half, so clear that source\'s op_sel_hi bit — ' +
  'e.g. op_sel_hi:[1,0] — to apply a constant to both halves.';

/** Appended to packed integer descriptions: integer constants are sign-extended, floats are f32 bits. */
const PK_INT_CONST_NOTE =
  '\nAn integer constant such as 3 has 0 in its high half (all ones when negative), so clear that source\'s ' +
  'op_sel_hi bit — e.g. op_sel_hi:[1,0] — to apply it to both halves. A float constant supplies its f32 bits ' +
  '(1.0 gives 0x0000 in the low half and 0x3F80 in the high half).';

// ── Scalar ALU helpers (BigInt) ──

const M32 = 0xFFFFFFFFn;
const M64 = 0xFFFFFFFFFFFFFFFFn;
const sext32 = (v: bigint) => BigInt.asIntN(32, v);
const sext64 = (v: bigint) => BigInt.asIntN(64, v);
const bit = (b: boolean) => (b ? 1n : 0n);
const SCC_NZ = (_a: bigint, _b: bigint, d: bigint) => d !== 0n;

function popcount64(v: bigint): bigint {
  let n = 0n;
  for (let x = v; x !== 0n; x >>= 1n) n += x & 1n;
  return n;
}

/** Bit field mask of `width` bits (width ≥ 64 → all ones). */
function fieldMask(width: bigint): bigint {
  return width >= 64n ? M64 : (1n << width) - 1n;
}

function reverseBits(v: bigint, width: number): bigint {
  let r = 0n;
  for (let i = 0; i < width; i++) r |= ((v >> BigInt(i)) & 1n) << BigInt(width - 1 - i);
  return r;
}

/** Whole-quad mode: each 4-bit group becomes 0xF if any of its bits are set. */
function wqm(v: bigint, width: number): bigint {
  let r = 0n;
  for (let q = 0; q < width; q += 4) if ((v >> BigInt(q)) & 0xFn) r |= 0xFn << BigInt(q);
  return r;
}

/** Number-based wrapper so every scalar opcode still exposes `execute(a, b)`. */
function saluExecute(s: SaluSemantics): (a: number, b?: number) => number {
  return (a, b) => {
    const ctx: SaluContext = { scc: 0, d: 0n };
    const r = s.op(BigInt(a >>> 0), BigInt((b ?? 0) >>> 0), ctx);
    return Number((r ?? 0n) & M32) >>> 0;
  };
}

/** Build a scalar opcode entry from BigInt semantics. */
function scalarOp(
  format: InstructionFormat, mnemonic: string, opcode: number, operandCount: number,
  widths: [ScalarWidth, ScalarWidth, ScalarWidth],
  op: SaluSemantics['op'],
  scc: SaluSemantics['scc'] | undefined,
  description: string, syntax: string,
  simm?: 'sext' | 'zext',
): OpcodeInfo {
  const salu: SaluSemantics = { d: widths[0], s0: widths[1], s1: widths[2], op, scc, simm };
  return { mnemonic, format, opcode, operandCount, execute: saluExecute(salu), description, syntax, salu };
}

// ── VOP2 Instructions (2-source) ──

const VOP2_OPCODES: OpcodeInfo[] = [
  {
    mnemonic: 'v_cndmask_b32',
    format: InstructionFormat.VOP2,
    opcode: 0x01,
    operandCount: 3,
    execute: (a, b) => b ?? a, // per-lane selection is done by the executor using VCC (or SRC2 in VOP3)
    description: 'Conditional mask: select src0 or vsrc1 per lane based on VCC (VOP3: the SGPR in src2).\nvdst = VCC[lane] ? vsrc1 : src0',
    syntax: 'v_cndmask_b32 vdst, src0, vsrc1, vcc_lo',
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
    mnemonic: 'v_dot4c_i32_i8',
    format: InstructionFormat.VOP2,
    opcode: 0x0D,
    operandCount: 3,
    execute: (a, b, c) => {
      // Dot product of 4 signed bytes, accumulated into vdst (c = old vdst)
      const s0 = a >>> 0, s1 = (b ?? 0) >>> 0;
      let sum = 0;
      for (let i = 0; i < 4; i++) {
        let a8 = (s0 >>> (i * 8)) & 0xFF;
        let b8 = (s1 >>> (i * 8)) & 0xFF;
        if (a8 > 127) a8 -= 256;
        if (b8 > 127) b8 -= 256;
        sum += a8 * b8;
      }
      return (sum + ((c ?? 0) | 0)) | 0;
    },
    description: 'Dot product of 4 signed bytes, accumulated.\nvdst += src0.b0×vsrc1.b0 + src0.b1×vsrc1.b1 + src0.b2×vsrc1.b2 + src0.b3×vsrc1.b3',
    syntax: 'v_dot4c_i32_i8 vdst, src0, vsrc1',
    isIntegerOp: true,
    accumulate: true,
  },
  {
    mnemonic: 'v_min_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x0F,
    operandCount: 3,
    execute: (a, b) => fmin(a, b ?? 0),
    description: 'Return the minimum of two 32-bit floats per lane. If one input is NaN the other is returned.\nvdst = min(src0, vsrc1)',
    syntax: 'v_min_f32 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_max_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x10,
    operandCount: 3,
    execute: (a, b) => fmax(a, b ?? 0),
    description: 'Return the maximum of two 32-bit floats per lane. If one input is NaN the other is returned.\nvdst = max(src0, vsrc1)',
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
    mnemonic: 'v_madmk_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x20,
    operandCount: 4,
    execute: (a, b, c) => asFloat(asFloat(a * (b ?? 0)) + (c ?? 0)),
    description: 'Multiply-add with literal constant K (not fused): vdst = src0 × K + vsrc1.\nK is a 32-bit literal always following the instruction word. No VOP3 form or modifiers.',
    syntax: 'v_madmk_f32 vdst, src0, K, vsrc1',
    kLiteral: 'mk',
  },
  {
    mnemonic: 'v_madak_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x21,
    operandCount: 4,
    execute: (a, b, c) => asFloat(asFloat(a * (b ?? 0)) + (c ?? 0)),
    description: 'Multiply-add with literal constant K (not fused): vdst = src0 × vsrc1 + K.\nK is a 32-bit literal always following the instruction word. No VOP3 form or modifiers.',
    syntax: 'v_madak_f32 vdst, src0, vsrc1, K',
    kLiteral: 'ak',
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
      const product = sa * sb;
      return Math.floor(product / 0x100000000) | 0;
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
    execute: (a, b, c) => asFloat(a * (b ?? 0) + (c ?? 0)),
    description: 'Fused multiply-accumulate: vdst = src0 × vsrc1 + vdst.\nNote: vdst is also an implicit source (accumulated).',
    syntax: 'v_fmac_f32 vdst, src0, vsrc1',
    accumulate: true,
  },
  {
    mnemonic: 'v_mul_legacy_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x07,
    operandCount: 3,
    execute: (a, b) => asFloat(legacyMul(a, b ?? 0)),
    description: 'Legacy multiply (DX9 rules): 0 × anything = 0, even Inf or NaN.\nvdst = src0 × vsrc1 (legacy)',
    syntax: 'v_mul_legacy_f32 vdst, src0, vsrc1',
  },
  {
    mnemonic: 'v_add_co_ci_u32',
    format: InstructionFormat.VOP2,
    opcode: 0x28,
    operandCount: 5,
    execute: (a, b, c) => ((a + (b ?? 0) + (c ?? 0)) >>> 0),
    description: 'Add with carry-in and carry-out (VCC in VOP2; any SGPR in VOP3).\nvdst = src0 + vsrc1 + VCC[lane]; VCC[lane] = carry',
    syntax: 'v_add_co_ci_u32 vdst, vcc_lo, src0, vsrc1, vcc_lo',
    readsVCC: true,
    writesVCC: true,
    isIntegerOp: true,
    carry: 'add',
    carryIn: true,
  },
  {
    mnemonic: 'v_sub_co_ci_u32',
    format: InstructionFormat.VOP2,
    opcode: 0x29,
    operandCount: 5,
    execute: (a, b, c) => ((a - (b ?? 0) - (c ?? 0)) >>> 0),
    description: 'Subtract with borrow-in and borrow-out (VCC in VOP2; any SGPR in VOP3).\nvdst = src0 - vsrc1 - VCC[lane]; VCC[lane] = borrow',
    syntax: 'v_sub_co_ci_u32 vdst, vcc_lo, src0, vsrc1, vcc_lo',
    readsVCC: true,
    writesVCC: true,
    isIntegerOp: true,
    carry: 'sub',
    carryIn: true,
  },
  {
    mnemonic: 'v_subrev_co_ci_u32',
    format: InstructionFormat.VOP2,
    opcode: 0x2A,
    operandCount: 5,
    execute: (a, b, c) => (((b ?? 0) - a - (c ?? 0)) >>> 0),
    description: 'Reverse subtract with borrow-in and borrow-out.\nvdst = vsrc1 - src0 - VCC[lane]; VCC[lane] = borrow',
    syntax: 'v_subrev_co_ci_u32 vdst, vcc_lo, src0, vsrc1, vcc_lo',
    readsVCC: true,
    writesVCC: true,
    isIntegerOp: true,
    carry: 'subrev',
    carryIn: true,
  },
  {
    mnemonic: 'v_fmamk_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x2C,
    operandCount: 4,
    execute: (a, b, c) => asFloat(a * (b ?? 0) + (c ?? 0)),
    description: 'Fused multiply-add with literal constant K: vdst = src0 × K + vsrc1.\nK is a 32-bit literal always following the instruction word. No VOP3 form or modifiers.',
    syntax: 'v_fmamk_f32 vdst, src0, K, vsrc1',
    kLiteral: 'mk',
  },
  {
    mnemonic: 'v_fmaak_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x2D,
    operandCount: 4,
    execute: (a, b, c) => asFloat(a * (b ?? 0) + (c ?? 0)),
    description: 'Fused multiply-add with literal constant K: vdst = src0 × vsrc1 + K.\nK is a 32-bit literal always following the instruction word. No VOP3 form or modifiers.',
    syntax: 'v_fmaak_f32 vdst, src0, vsrc1, K',
    kLiteral: 'ak',
  },
  {
    mnemonic: 'v_cvt_pkrtz_f16_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x2F,
    operandCount: 3,
    execute: (a, b) => (f32ToF16(a, true) | (f32ToF16(b ?? 0, true) << 16)) >>> 0,
    description: 'Convert two f32 values to f16 (round toward zero) and pack them.\nvdst = {f16(vsrc1), f16(src0)}',
    syntax: 'v_cvt_pkrtz_f16_f32 vdst, src0, vsrc1',
    types: { d: 'b32', s: ['f32', 'f32'] },
  },
  {
    mnemonic: 'v_dot8c_i32_i4',
    format: InstructionFormat.VOP2,
    opcode: 0x02,
    operandCount: 3,
    execute: (a, b, c) => {
      // Dot product of 8 signed 4-bit values, accumulated into vdst (c = old vdst)
      let sum = (c ?? 0) | 0;
      for (let i = 0; i < 8; i++) {
        const a4 = (((a >>> (i * 4)) & 0xF) << 28) >> 28;
        const b4 = ((((b ?? 0) >>> (i * 4)) & 0xF) << 28) >> 28;
        sum += a4 * b4;
      }
      return sum | 0;
    },
    description: 'Dot product of 8 signed 4-bit integers, accumulated.\nvdst += Σ src0.i4[n] × vsrc1.i4[n] (n = 0..7)',
    syntax: 'v_dot8c_i32_i4 vdst, src0, vsrc1',
    isIntegerOp: true,
    accumulate: true,
  },
  {
    mnemonic: 'v_mac_legacy_f32',
    format: InstructionFormat.VOP2,
    opcode: 0x06,
    operandCount: 3,
    execute: (a, b, c) => asFloat(asFloat(legacyMul(a, b ?? 0)) + (c ?? 0)),
    description: 'Legacy multiply-accumulate (DX9 rules): vdst = src0 × vsrc1 + vdst, where 0 × anything = 0.',
    syntax: 'v_mac_legacy_f32 vdst, src0, vsrc1',
    accumulate: true,
  },
  {
    mnemonic: 'v_add_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x32,
    operandCount: 3,
    execute: (a, b) => a + (b ?? 0),
    description: 'Add two 16-bit floats (low halves; the high half of vdst is preserved).\nvdst = src0 + vsrc1',
    syntax: 'v_add_f16 vdst, src0, vsrc1',
    types: { d: 'f16', s: ['f16', 'f16'] },
  },
  {
    mnemonic: 'v_sub_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x33,
    operandCount: 3,
    execute: (a, b) => a - (b ?? 0),
    description: 'Subtract two 16-bit floats (low halves; the high half of vdst is preserved).\nvdst = src0 - vsrc1',
    syntax: 'v_sub_f16 vdst, src0, vsrc1',
    types: { d: 'f16', s: ['f16', 'f16'] },
  },
  {
    mnemonic: 'v_subrev_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x34,
    operandCount: 3,
    execute: (a, b) => (b ?? 0) - a,
    description: 'Reverse subtract two 16-bit floats (low halves).\nvdst = vsrc1 - src0',
    syntax: 'v_subrev_f16 vdst, src0, vsrc1',
    types: { d: 'f16', s: ['f16', 'f16'] },
  },
  {
    mnemonic: 'v_mul_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x35,
    operandCount: 3,
    execute: (a, b) => a * (b ?? 0),
    description: 'Multiply two 16-bit floats (low halves).\nvdst = src0 × vsrc1',
    syntax: 'v_mul_f16 vdst, src0, vsrc1',
    types: { d: 'f16', s: ['f16', 'f16'] },
  },
  {
    mnemonic: 'v_fmac_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x36,
    operandCount: 3,
    execute: (a, b, c) => a * (b ?? 0) + (c ?? 0),
    description: 'Fused multiply-accumulate f16 (low halves): vdst = src0 × vsrc1 + vdst.',
    syntax: 'v_fmac_f16 vdst, src0, vsrc1',
    types: { d: 'f16', s: ['f16', 'f16', 'f16'] },
    accumulate: true,
  },
  {
    mnemonic: 'v_fmamk_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x37,
    operandCount: 4,
    execute: (a, b, c) => a * (b ?? 0) + (c ?? 0),
    description: 'Fused multiply-add with literal constant K (f16): vdst = src0 × K + vsrc1.\nK is a literal dword following the instruction; its low 16 bits hold the f16 value.',
    syntax: 'v_fmamk_f16 vdst, src0, K, vsrc1',
    types: { d: 'f16', s: ['f16', 'f16', 'f16'] },
    kLiteral: 'mk',
  },
  {
    mnemonic: 'v_fmaak_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x38,
    operandCount: 4,
    execute: (a, b, c) => a * (b ?? 0) + (c ?? 0),
    description: 'Fused multiply-add with literal constant K (f16): vdst = src0 × vsrc1 + K.\nK is a literal dword following the instruction; its low 16 bits hold the f16 value.',
    syntax: 'v_fmaak_f16 vdst, src0, vsrc1, K',
    types: { d: 'f16', s: ['f16', 'f16', 'f16'] },
    kLiteral: 'ak',
  },
  {
    mnemonic: 'v_max_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x39,
    operandCount: 3,
    execute: (a, b) => fmax(a, b ?? 0),
    description: 'Maximum of two 16-bit floats (low halves).\nvdst = max(src0, vsrc1)',
    syntax: 'v_max_f16 vdst, src0, vsrc1',
    types: { d: 'f16', s: ['f16', 'f16'] },
  },
  {
    mnemonic: 'v_min_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x3A,
    operandCount: 3,
    execute: (a, b) => fmin(a, b ?? 0),
    description: 'Minimum of two 16-bit floats (low halves).\nvdst = min(src0, vsrc1)',
    syntax: 'v_min_f16 vdst, src0, vsrc1',
    types: { d: 'f16', s: ['f16', 'f16'] },
  },
  {
    mnemonic: 'v_ldexp_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x3B,
    operandCount: 3,
    execute: (a, b) => a * Math.pow(2, (b ?? 0) | 0),
    description: 'Load exponent f16: vdst = src0 × 2^vsrc1 (vsrc1 is a signed 16-bit integer).',
    syntax: 'v_ldexp_f16 vdst, src0, vsrc1',
    types: { d: 'f16', s: ['f16', 'i16'] },
  },
  {
    mnemonic: 'v_pk_fmac_f16',
    format: InstructionFormat.VOP2,
    opcode: 0x3C,
    operandCount: 3,
    execute: (a, b, c) => a * (b ?? 0) + (c ?? 0),
    description: 'Packed FMA-accumulate f16: vdst += src0 × vsrc1 (both 16-bit halves).\nA constant src0 such as 2.0 has 0 in its high half, so only the low half is scaled by it.',
    syntax: 'v_pk_fmac_f16 vdst, src0, vsrc1',
    accumulate: true,
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
    execute: (a) => satI32(a),
    description: 'Convert a 32-bit float to a signed 32-bit integer (truncate toward zero; out-of-range values saturate, NaN → 0).\nvdst = (int)src0',
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
    execute: (a) => asFloat(rndne(a)),
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
    description: 'Copy src0 from the first active lane into a scalar register (lane 0 when EXEC is 0).\nsdst = src0[firstActiveLane]',
    syntax: 'v_readfirstlane_b32 sdst, src0',
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
    mnemonic: 'v_cvt_rpi_i32_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x0C,
    operandCount: 2,
    execute: (a) => satI32(Math.floor(a + 0.5)),
    description: 'Convert f32 to i32, rounding to nearest with halves toward +∞ (saturates; NaN → 0).\nvdst = (i32)floor(src0 + 0.5)',
    syntax: 'v_cvt_rpi_i32_f32 vdst, src0',
    integerOutput: true,
  },
  {
    mnemonic: 'v_cvt_flr_i32_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x0D,
    operandCount: 2,
    execute: (a) => satI32(Math.floor(a)),
    description: 'Convert f32 to i32 with floor (round toward negative infinity; saturates, NaN → 0).\nvdst = (i32)floor(src0)',
    syntax: 'v_cvt_flr_i32_f32 vdst, src0',
    integerOutput: true,
  },
  {
    mnemonic: 'v_cvt_off_f32_i4',
    format: InstructionFormat.VOP1,
    opcode: 0x0E,
    operandCount: 2,
    execute: (a) => {
      const i4 = a & 0xF;
      return (i4 >= 8 ? i4 - 16 : i4) / 16;
    },
    description: 'Convert a signed 4-bit integer to an f32 interpolation offset in [-0.5, 0.4375].\nvdst = (f32)(signed_4bit(src0[3:0])) / 16',
    syntax: 'v_cvt_off_f32_i4 vdst, src0',
    integerInput: true,
  },
  {
    mnemonic: 'v_rcp_iflag_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x2B,
    operandCount: 2,
    execute: (a) => 1.0 / a,
    description: 'Reciprocal with IEEE flag reporting.\nvdst = 1.0 / src0',
    syntax: 'v_rcp_iflag_f32 vdst, src0',
  },
  {
    mnemonic: 'v_movreld_b32',
    format: InstructionFormat.VOP1,
    opcode: 0x42,
    operandCount: 2,
    execute: (a) => a,
    description: 'Move to VGPR with relative destination.\nv[vdst + M0] = src0',
    syntax: 'v_movreld_b32 vdst, vsrc0',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_movrels_b32',
    format: InstructionFormat.VOP1,
    opcode: 0x43,
    operandCount: 2,
    execute: (a) => a,
    description: 'Move from VGPR with relative source.\nvdst = v[vsrc0 + M0]',
    syntax: 'v_movrels_b32 vdst, vsrc0',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_movrelsd_b32',
    format: InstructionFormat.VOP1,
    opcode: 0x44,
    operandCount: 2,
    execute: (a) => a,
    description: 'Move with relative source and destination.\nv[vdst + M0] = v[vsrc0 + M0]',
    syntax: 'v_movrelsd_b32 vdst, vsrc0',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_movrelsd_2_b32',
    format: InstructionFormat.VOP1,
    opcode: 0x48,
    operandCount: 2,
    execute: (a) => a,
    description: 'Move with relative source (M0) and relative destination (M0+1).\nv[vdst + M0 + 1] = v[vsrc0 + M0]',
    syntax: 'v_movrelsd_2_b32 vdst, vsrc0',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_cvt_f16_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x0A,
    operandCount: 2,
    execute: (a) => a,
    description: 'Convert a 32-bit float to a 16-bit float (low half of vdst; the high half is preserved).\nvdst = (f16)src0',
    syntax: 'v_cvt_f16_f32 vdst, src0',
    types: { d: 'f16', s: ['f32'] },
  },
  {
    mnemonic: 'v_cvt_f32_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x0B,
    operandCount: 2,
    execute: (a) => a,
    description: 'Convert a 16-bit float (low half of src0) to a 32-bit float.\nvdst = (f32)src0',
    syntax: 'v_cvt_f32_f16 vdst, src0',
    types: { d: 'f32', s: ['f16'] },
  },
  {
    mnemonic: 'v_cvt_f16_u16',
    format: InstructionFormat.VOP1,
    opcode: 0x50,
    operandCount: 2,
    execute: (a) => a,
    description: 'Convert unsigned 16-bit integer to 16-bit float.\nvdst = (f16)(uint16)src0',
    syntax: 'v_cvt_f16_u16 vdst, src0',
    types: { d: 'f16', s: ['u16'] },
  },
  {
    mnemonic: 'v_cvt_f16_i16',
    format: InstructionFormat.VOP1,
    opcode: 0x51,
    operandCount: 2,
    execute: (a) => a,
    description: 'Convert signed 16-bit integer to 16-bit float.\nvdst = (f16)(int16)src0',
    syntax: 'v_cvt_f16_i16 vdst, src0',
    types: { d: 'f16', s: ['i16'] },
  },
  {
    mnemonic: 'v_rcp_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x54,
    operandCount: 2,
    execute: (a) => 1.0 / a,
    description: 'Reciprocal of a 16-bit float.\nvdst = 1.0 / src0',
    syntax: 'v_rcp_f16 vdst, src0',
    types: { d: 'f16', s: ['f16'] },
  },
  {
    mnemonic: 'v_sqrt_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x55,
    operandCount: 2,
    execute: (a) => Math.sqrt(a),
    description: 'Square root of a 16-bit float.\nvdst = √src0',
    syntax: 'v_sqrt_f16 vdst, src0',
    types: { d: 'f16', s: ['f16'] },
  },
  {
    mnemonic: 'v_exp_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x58,
    operandCount: 2,
    execute: (a) => Math.pow(2, a),
    description: 'Base-2 exponential of a 16-bit float.\nvdst = 2^src0',
    syntax: 'v_exp_f16 vdst, src0',
    types: { d: 'f16', s: ['f16'] },
  },
  {
    mnemonic: 'v_floor_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x5B,
    operandCount: 2,
    execute: (a) => Math.floor(a),
    description: 'Floor of a 16-bit float.\nvdst = floor(src0)',
    syntax: 'v_floor_f16 vdst, src0',
    types: { d: 'f16', s: ['f16'] },
  },
  {
    mnemonic: 'v_frexp_exp_i32_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x3F,
    operandCount: 2,
    execute: (a) => {
      if (a === 0 || !isFinite(a) || isNaN(a)) return 0;
      const abs = Math.abs(a);
      return (Math.floor(Math.log2(abs)) + 1) | 0;
    },
    description: 'Extract the exponent from a 32-bit float (as integer).\nvdst = frexp_exp(src0)',
    syntax: 'v_frexp_exp_i32_f32 vdst, src0',
    integerOutput: true,
  },
  {
    mnemonic: 'v_frexp_mant_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x40,
    operandCount: 2,
    execute: (a) => {
      if (a === 0 || !isFinite(a) || isNaN(a)) return a;
      const abs = Math.abs(a);
      const exp = Math.floor(Math.log2(abs)) + 1;
      return asFloat(a / Math.pow(2, exp));
    },
    description: 'Extract the mantissa from a 32-bit float (result in [0.5, 1.0)).\nvdst = frexp_mant(src0)',
    syntax: 'v_frexp_mant_f32 vdst, src0',
  },
  {
    mnemonic: 'v_cvt_u16_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x52,
    operandCount: 2,
    execute: (a) => satU16(a),
    description: 'Convert 16-bit float to unsigned 16-bit integer (truncate; saturates, NaN → 0).\nvdst = (uint16)src0',
    syntax: 'v_cvt_u16_f16 vdst, src0',
    types: { d: 'u16', s: ['f16'] },
  },
  {
    mnemonic: 'v_cvt_i16_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x53,
    operandCount: 2,
    execute: (a) => satI16(a),
    description: 'Convert 16-bit float to signed 16-bit integer (truncate; saturates, NaN → 0).\nvdst = (int16)src0',
    syntax: 'v_cvt_i16_f16 vdst, src0',
    types: { d: 'i16', s: ['f16'] },
  },
  {
    mnemonic: 'v_rsq_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x56,
    operandCount: 2,
    execute: (a) => 1.0 / Math.sqrt(a),
    description: 'Reciprocal square root of a 16-bit float.\nvdst = 1.0 / √src0',
    syntax: 'v_rsq_f16 vdst, src0',
    types: { d: 'f16', s: ['f16'] },
  },
  {
    mnemonic: 'v_log_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x57,
    operandCount: 2,
    execute: (a) => Math.log2(a),
    description: 'Base-2 logarithm of a 16-bit float.\nvdst = log₂(src0)',
    syntax: 'v_log_f16 vdst, src0',
    types: { d: 'f16', s: ['f16'] },
  },
  {
    mnemonic: 'v_ceil_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x5C,
    operandCount: 2,
    execute: (a) => Math.ceil(a),
    description: 'Ceiling of a 16-bit float.\nvdst = ceil(src0)',
    syntax: 'v_ceil_f16 vdst, src0',
    types: { d: 'f16', s: ['f16'] },
  },
  {
    mnemonic: 'v_trunc_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x5D,
    operandCount: 2,
    execute: (a) => Math.trunc(a),
    description: 'Truncate a 16-bit float toward zero.\nvdst = trunc(src0)',
    syntax: 'v_trunc_f16 vdst, src0',
    types: { d: 'f16', s: ['f16'] },
  },
  {
    mnemonic: 'v_rndne_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x5E,
    operandCount: 2,
    execute: (a) => rndne(a),
    description: 'Round a 16-bit float to nearest even.\nvdst = roundEven(src0)',
    syntax: 'v_rndne_f16 vdst, src0',
    types: { d: 'f16', s: ['f16'] },
  },
  {
    mnemonic: 'v_fract_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x5F,
    operandCount: 2,
    execute: (a) => a - Math.floor(a),
    description: 'Fractional part of a 16-bit float.\nvdst = src0 - floor(src0)',
    syntax: 'v_fract_f16 vdst, src0',
    types: { d: 'f16', s: ['f16'] },
  },
  {
    mnemonic: 'v_sin_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x60,
    operandCount: 2,
    execute: (a) => Math.sin(a * 2 * Math.PI),
    description: 'Sine of a 16-bit float (input in turns).\nvdst = sin(2π × src0)',
    syntax: 'v_sin_f16 vdst, src0',
    types: { d: 'f16', s: ['f16'] },
  },
  {
    mnemonic: 'v_cos_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x61,
    operandCount: 2,
    execute: (a) => Math.cos(a * 2 * Math.PI),
    description: 'Cosine of a 16-bit float (input in turns).\nvdst = cos(2π × src0)',
    syntax: 'v_cos_f16 vdst, src0',
    types: { d: 'f16', s: ['f16'] },
  },
  {
    mnemonic: 'v_sat_pk_u8_i16',
    format: InstructionFormat.VOP1,
    opcode: 0x62,
    operandCount: 2,
    execute: (a) => {
      const lo16 = (a << 16) >> 16;
      const hi16 = (a >> 16);
      const loByte = Math.max(0, Math.min(255, lo16));
      const hiByte = Math.max(0, Math.min(255, hi16));
      return ((hiByte << 8) | loByte) >>> 0;
    },
    description: 'Pack two signed i16 halves to two unsigned u8 bytes with saturation.\nlo_byte = clamp(src0[15:0], 0, 255), hi_byte = clamp(src0[31:16], 0, 255).\nResult = (hi_byte << 8) | lo_byte',
    syntax: 'v_sat_pk_u8_i16 vdst, src0',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_cvt_norm_i16_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x63,
    operandCount: 2,
    execute: (a) => snorm16(a),
    description: 'Convert f16 to a signed normalized 16-bit integer, rounding to nearest even.\nvdst = (i16)(clamp(src0, -1, 1) × 32767)',
    syntax: 'v_cvt_norm_i16_f16 vdst, src0',
    types: { d: 'i16', s: ['f16'] },
  },
  {
    mnemonic: 'v_cvt_norm_u16_f16',
    format: InstructionFormat.VOP1,
    opcode: 0x64,
    operandCount: 2,
    execute: (a) => unorm16(a),
    description: 'Convert f16 to an unsigned normalized 16-bit integer, rounding to nearest even.\nvdst = (u16)(clamp(src0, 0, 1) × 65535)',
    syntax: 'v_cvt_norm_u16_f16 vdst, src0',
    types: { d: 'u16', s: ['f16'] },
  },
  // 64-bit floats occupy register pairs; a 32-bit literal is the high half of the double
  {
    mnemonic: 'v_cvt_i32_f64',
    format: InstructionFormat.VOP1,
    opcode: 0x03,
    operandCount: 2,
    execute: (a) => satI32(a),
    description: 'Convert a 64-bit float to a signed 32-bit integer (truncate toward zero; out-of-range values saturate, NaN → 0).\nvdst = (int)src0[0:1]',
    syntax: 'v_cvt_i32_f64 vdst, src0[0:1]',
    types: { d: 'b32', s: ['f64'] },
  },
  {
    mnemonic: 'v_cvt_f64_i32',
    format: InstructionFormat.VOP1,
    opcode: 0x04,
    operandCount: 2,
    execute: (a) => a | 0,
    description: 'Convert a signed 32-bit integer to a 64-bit float (exact).\nvdst[0:1] = (double)(int)src0',
    syntax: 'v_cvt_f64_i32 vdst[0:1], src0',
    types: { d: 'f64', s: ['b32'] },
  },
  {
    mnemonic: 'v_cvt_f32_f64',
    format: InstructionFormat.VOP1,
    opcode: 0x0F,
    operandCount: 2,
    execute: (a) => a,
    description: 'Convert a 64-bit float to a 32-bit float, rounding to nearest even (too large → ±∞).\nvdst = (float)src0[0:1]',
    syntax: 'v_cvt_f32_f64 vdst, src0[0:1]',
    types: { d: 'f32', s: ['f64'] },
  },
  {
    mnemonic: 'v_cvt_f64_f32',
    format: InstructionFormat.VOP1,
    opcode: 0x10,
    operandCount: 2,
    execute: (a) => a,
    description: 'Convert a 32-bit float to a 64-bit float (exact).\nvdst[0:1] = (double)src0',
    syntax: 'v_cvt_f64_f32 vdst[0:1], src0',
    types: { d: 'f64', s: ['f32'] },
  },
  {
    mnemonic: 'v_cvt_u32_f64',
    format: InstructionFormat.VOP1,
    opcode: 0x15,
    operandCount: 2,
    execute: (a) => Math.max(0, Math.min(0xFFFFFFFF, Math.trunc(a))) >>> 0,
    description: 'Convert a 64-bit float to an unsigned 32-bit integer (truncate, clamp to [0, 2³²-1], NaN → 0).\nvdst = (uint)src0[0:1]',
    syntax: 'v_cvt_u32_f64 vdst, src0[0:1]',
    types: { d: 'b32', s: ['f64'] },
  },
  {
    mnemonic: 'v_cvt_f64_u32',
    format: InstructionFormat.VOP1,
    opcode: 0x16,
    operandCount: 2,
    execute: (a) => a >>> 0,
    description: 'Convert an unsigned 32-bit integer to a 64-bit float (exact).\nvdst[0:1] = (double)(uint)src0',
    syntax: 'v_cvt_f64_u32 vdst[0:1], src0',
    types: { d: 'f64', s: ['b32'] },
  },
  {
    mnemonic: 'v_trunc_f64',
    format: InstructionFormat.VOP1,
    opcode: 0x17,
    operandCount: 2,
    execute: (a) => Math.trunc(a),
    description: 'Truncate a 64-bit float toward zero (drop the fractional part).\nvdst[0:1] = trunc(src0[0:1])',
    syntax: 'v_trunc_f64 vdst[0:1], src0[0:1]',
    types: { d: 'f64', s: ['f64'] },
  },
  {
    mnemonic: 'v_ceil_f64',
    format: InstructionFormat.VOP1,
    opcode: 0x18,
    operandCount: 2,
    execute: (a) => Math.ceil(a),
    description: 'Round a 64-bit float up to an integer.\nvdst[0:1] = ceil(src0[0:1])',
    syntax: 'v_ceil_f64 vdst[0:1], src0[0:1]',
    types: { d: 'f64', s: ['f64'] },
  },
  {
    mnemonic: 'v_rndne_f64',
    format: InstructionFormat.VOP1,
    opcode: 0x19,
    operandCount: 2,
    execute: (a) => rndneF64(a),
    description: 'Round a 64-bit float to the nearest integer, ties to even.\nvdst[0:1] = roundEven(src0[0:1])',
    syntax: 'v_rndne_f64 vdst[0:1], src0[0:1]',
    types: { d: 'f64', s: ['f64'] },
  },
  {
    mnemonic: 'v_floor_f64',
    format: InstructionFormat.VOP1,
    opcode: 0x1A,
    operandCount: 2,
    execute: (a) => Math.floor(a),
    description: 'Round a 64-bit float down to an integer.\nvdst[0:1] = floor(src0[0:1])',
    syntax: 'v_floor_f64 vdst[0:1], src0[0:1]',
    types: { d: 'f64', s: ['f64'] },
  },
  {
    mnemonic: 'v_rcp_f64',
    format: InstructionFormat.VOP1,
    opcode: 0x2F,
    operandCount: 2,
    execute: (a) => 1 / a,
    description: 'Reciprocal of a 64-bit float. The emulator returns the correctly rounded value; hardware is accurate only to ' +
      'about 2^29 ULP (close to single precision), so real code refines it with v_fma_f64 (Newton-Raphson).\nvdst[0:1] = 1.0 / src0[0:1]',
    syntax: 'v_rcp_f64 vdst[0:1], src0[0:1]',
    types: { d: 'f64', s: ['f64'] },
  },
  {
    mnemonic: 'v_rsq_f64',
    format: InstructionFormat.VOP1,
    opcode: 0x31,
    operandCount: 2,
    execute: (a) => 1 / Math.sqrt(a),
    description: 'Reciprocal square root of a 64-bit float. Hardware is accurate only to about 2^29 ULP, so real code refines ' +
      'the result with v_fma_f64; the emulator computes it in double precision.\nvdst[0:1] = 1.0 / √src0[0:1]',
    syntax: 'v_rsq_f64 vdst[0:1], src0[0:1]',
    types: { d: 'f64', s: ['f64'] },
  },
  {
    mnemonic: 'v_sqrt_f64',
    format: InstructionFormat.VOP1,
    opcode: 0x34,
    operandCount: 2,
    execute: (a) => Math.sqrt(a),
    description: 'Square root of a 64-bit float. The emulator returns the correctly rounded value; hardware is accurate only to ' +
      'about 2^29 ULP, so real code refines it with v_fma_f64.\nvdst[0:1] = √src0[0:1]',
    syntax: 'v_sqrt_f64 vdst[0:1], src0[0:1]',
    types: { d: 'f64', s: ['f64'] },
  },
  {
    mnemonic: 'v_frexp_exp_i32_f64',
    format: InstructionFormat.VOP1,
    opcode: 0x3C,
    operandCount: 2,
    execute: (a) => frexpF64(a).exp,
    description: 'Exponent of a 64-bit float, such that src0 = significand × 2^exponent with the significand in [0.5, 1.0) ' +
      '(subnormals are normalized; ±0, ±∞ and NaN give 0).\nvdst = exponent(src0[0:1])',
    syntax: 'v_frexp_exp_i32_f64 vdst, src0[0:1]',
    types: { d: 'b32', s: ['f64'] },
  },
  {
    mnemonic: 'v_frexp_mant_f64',
    format: InstructionFormat.VOP1,
    opcode: 0x3D,
    operandCount: 2,
    execute: (a) => frexpF64(a).mant,
    description: 'Significand of a 64-bit float, in [0.5, 1.0) with the sign of src0 (subnormals are normalized; ±0, ±∞ and NaN ' +
      'are returned unchanged).\nvdst[0:1] = significand(src0[0:1])',
    syntax: 'v_frexp_mant_f64 vdst[0:1], src0[0:1]',
    types: { d: 'f64', s: ['f64'] },
  },
  {
    mnemonic: 'v_fract_f64',
    format: InstructionFormat.VOP1,
    opcode: 0x3E,
    operandCount: 2,
    execute: (a) => a - Math.floor(a),
    description: 'Fractional part of a 64-bit float (±∞ gives NaN).\nvdst[0:1] = src0[0:1] - floor(src0[0:1])',
    syntax: 'v_fract_f64 vdst[0:1], src0[0:1]',
    types: { d: 'f64', s: ['f64'] },
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
    execute: (a, b, c) => asFloat(fmin(fmin(a, b ?? 0), c ?? 0)),
    description: 'Return the minimum of three 32-bit floats (V_MIN_F32 NaN rules).\nvdst = min(src0, src1, src2)',
    syntax: 'v_min3_f32 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_max3_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x154,
    operandCount: 4,
    execute: (a, b, c) => asFloat(fmax(fmax(a, b ?? 0), c ?? 0)),
    description: 'Return the maximum of three 32-bit floats (V_MAX_F32 NaN rules).\nvdst = max(src0, src1, src2)',
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
    execute: (a, b) => (a + (b ?? 0)) >>> 0, // lane-dependent masking is applied by the executor
    description: 'Masked bit count of src0 for the lanes below the current one (bits 0–31), plus src1.\nvdst = countBits(src0 & ((1 << laneId) - 1)) + src1\nv_mbcnt_lo_u32_b32 v0, -1, 0 yields each lane\'s index.',
    syntax: 'v_mbcnt_lo_u32_b32 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mbcnt_hi_u32_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x366,
    operandCount: 3,
    execute: (a, b) => (a + (b ?? 0)) >>> 0, // lane-dependent masking is applied by the executor
    description: 'Masked bit count of src0 for lanes 32–63 below the current one, plus src1. In wave32 the mask is empty, so this is a move of src1.\nvdst = countBits(src0 & ThreadMask[63:32]) + src1',
    syntax: 'v_mbcnt_hi_u32_b32 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_permlanex16_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x378,
    operandCount: 4,
    execute: (a) => a,
    description: 'Gather within a 16-lane row from the opposite row: lane i of each row reads vsrc0 from lane sel[i] of the other row. The 64-bit lane-select {ssrc2, ssrc1} holds a 4-bit index per lane.\nfi:1 fetches inactive lanes, bound_ctrl:1 reads 0 instead of skipping the write.',
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
    execute: (a, b, c) => asFloat(fmed3(a, b ?? 0, c ?? 0)),
    description: 'Median of three 32-bit floats (if any input is NaN, returns min3).\nvdst = median(src0, src1, src2)',
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
    execute: (a, b) => (f32ToF16(a) | (f32ToF16(b ?? 0) << 16)) >>> 0,
    description: 'Pack two f16 values into a 32-bit register (op_sel picks each source half).\nvdst = {src1.f16, src0.f16}',
    syntax: 'v_pack_b32_f16 vdst, src0, src1',
    types: { d: 'b32', s: ['f16', 'f16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_fma_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x34B,
    operandCount: 4,
    execute: (a, b, c) => a * (b ?? 0) + (c ?? 0),
    description: 'Fused multiply-add for 16-bit floats (op_sel selects source halves and the destination half; the other half is preserved).\nvdst = src0 × src1 + src2',
    syntax: 'v_fma_f16 vdst, src0, src1, src2',
    types: { d: 'f16', s: ['f16', 'f16', 'f16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_min3_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x351,
    operandCount: 4,
    execute: (a, b, c) => fmin(fmin(a, b ?? 0), c ?? 0),
    description: 'Minimum of three 16-bit floats.',
    syntax: 'v_min3_f16 vdst, src0, src1, src2',
    types: { d: 'f16', s: ['f16', 'f16', 'f16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_max3_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x354,
    operandCount: 4,
    execute: (a, b, c) => fmax(fmax(a, b ?? 0), c ?? 0),
    description: 'Maximum of three 16-bit floats.',
    syntax: 'v_max3_f16 vdst, src0, src1, src2',
    types: { d: 'f16', s: ['f16', 'f16', 'f16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_med3_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x357,
    operandCount: 4,
    execute: (a, b, c) => fmed3(a, b ?? 0, c ?? 0),
    description: 'Median of three 16-bit floats (if any input is NaN, returns min3).',
    syntax: 'v_med3_f16 vdst, src0, src1, src2',
    types: { d: 'f16', s: ['f16', 'f16', 'f16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_med3_i16',
    format: InstructionFormat.VOP3,
    opcode: 0x358,
    operandCount: 4,
    execute: (a, b, c) => [a, b ?? 0, c ?? 0].sort((x, y) => x - y)[1] & 0xFFFF,
    description: 'Median of three signed 16-bit integers.',
    syntax: 'v_med3_i16 vdst, src0, src1, src2',
    types: { d: 'i16', s: ['i16', 'i16', 'i16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_add_nc_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x303,
    operandCount: 3,
    execute: (a, b) => ((a + (b ?? 0)) & 0xFFFF),
    description: 'Add two unsigned 16-bit integers (no carry; the other half of vdst is preserved).',
    syntax: 'v_add_nc_u16 vdst, src0, src1',
    types: { d: 'u16', s: ['u16', 'u16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_sub_nc_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x304,
    operandCount: 3,
    execute: (a, b) => ((a - (b ?? 0)) & 0xFFFF),
    description: 'Subtract two unsigned 16-bit integers (no carry; the other half of vdst is preserved).',
    syntax: 'v_sub_nc_u16 vdst, src0, src1',
    types: { d: 'u16', s: ['u16', 'u16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_lshrrev_b16',
    format: InstructionFormat.VOP3,
    opcode: 0x307,
    operandCount: 3,
    execute: (a, b) => (((b ?? 0) >>> (a & 15)) & 0xFFFF),
    description: 'Logical right shift of a 16-bit value (reversed operand order).\nvdst[15:0] = src1[15:0] >> src0[3:0]',
    syntax: 'v_lshrrev_b16 vdst, src0, src1',
    types: { d: 'b16', s: ['b16', 'b16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_lshlrev_b16',
    format: InstructionFormat.VOP3,
    opcode: 0x314,
    operandCount: 3,
    execute: (a, b) => (((b ?? 0) << (a & 15)) & 0xFFFF),
    description: 'Left shift of a 16-bit value (reversed operand order).\nvdst[15:0] = src1[15:0] << src0[3:0]',
    syntax: 'v_lshlrev_b16 vdst, src0, src1',
    types: { d: 'b16', s: ['b16', 'b16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_ashrrev_i16',
    format: InstructionFormat.VOP3,
    opcode: 0x308,
    operandCount: 3,
    execute: (a, b) => (((b ?? 0) >> (a & 15)) & 0xFFFF),
    description: 'Arithmetic right shift of a signed 16-bit value (reversed operand order); the sign bit fills in from the left.\nvdst[15:0] = src1[15:0] >> src0[3:0]',
    syntax: 'v_ashrrev_i16 vdst, src0, src1',
    types: { d: 'i16', s: ['b16', 'i16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_add_nc_i16',
    format: InstructionFormat.VOP3,
    opcode: 0x30D,
    operandCount: 3,
    execute: (a, b) => ((a + (b ?? 0)) & 0xFFFF),
    description: 'Add two signed 16-bit integers (no carry; the other half of vdst is preserved). The sum wraps; with clamp it saturates to [-32768, 32767].\nvdst = src0 + src1',
    syntax: 'v_add_nc_i16 vdst, src0, src1',
    types: { d: 'i16', s: ['i16', 'i16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_sub_nc_i16',
    format: InstructionFormat.VOP3,
    opcode: 0x30E,
    operandCount: 3,
    execute: (a, b) => ((a - (b ?? 0)) & 0xFFFF),
    description: 'Subtract two signed 16-bit integers (no borrow; the other half of vdst is preserved). The difference wraps; with clamp it saturates to [-32768, 32767].\nvdst = src0 - src1',
    syntax: 'v_sub_nc_i16 vdst, src0, src1',
    types: { d: 'i16', s: ['i16', 'i16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_mul_lo_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x305,
    operandCount: 3,
    execute: (a, b) => ((a * (b ?? 0)) & 0xFFFF),
    description: 'Multiply two unsigned 16-bit integers, keeping the low 16 bits of the product (with clamp it saturates to 65535).\nvdst = (src0 × src1) & 0xFFFF',
    syntax: 'v_mul_lo_u16 vdst, src0, src1',
    types: { d: 'u16', s: ['u16', 'u16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_max_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x309,
    operandCount: 3,
    execute: (a, b) => Math.max(a, b ?? 0),
    description: 'Maximum of two unsigned 16-bit integers.\nvdst = max(src0, src1)',
    syntax: 'v_max_u16 vdst, src0, src1',
    types: { d: 'u16', s: ['u16', 'u16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_max_i16',
    format: InstructionFormat.VOP3,
    opcode: 0x30A,
    operandCount: 3,
    execute: (a, b) => Math.max(a, b ?? 0) & 0xFFFF,
    description: 'Maximum of two signed 16-bit integers.\nvdst = max(src0, src1)',
    syntax: 'v_max_i16 vdst, src0, src1',
    types: { d: 'i16', s: ['i16', 'i16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_min_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x30B,
    operandCount: 3,
    execute: (a, b) => Math.min(a, b ?? 0),
    description: 'Minimum of two unsigned 16-bit integers.\nvdst = min(src0, src1)',
    syntax: 'v_min_u16 vdst, src0, src1',
    types: { d: 'u16', s: ['u16', 'u16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_min_i16',
    format: InstructionFormat.VOP3,
    opcode: 0x30C,
    operandCount: 3,
    execute: (a, b) => Math.min(a, b ?? 0) & 0xFFFF,
    description: 'Minimum of two signed 16-bit integers.\nvdst = min(src0, src1)',
    syntax: 'v_min_i16 vdst, src0, src1',
    types: { d: 'i16', s: ['i16', 'i16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_mad_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x340,
    operandCount: 4,
    execute: (a, b, c) => ((a * (b ?? 0) + (c ?? 0)) & 0xFFFF),
    description: 'Multiply-add of unsigned 16-bit integers, keeping the low 16 bits (with clamp it saturates to 65535).\nvdst = src0 × src1 + src2',
    syntax: 'v_mad_u16 vdst, src0, src1, src2',
    types: { d: 'u16', s: ['u16', 'u16', 'u16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_mad_i16',
    format: InstructionFormat.VOP3,
    opcode: 0x35E,
    operandCount: 4,
    execute: (a, b, c) => ((a * (b ?? 0) + (c ?? 0)) & 0xFFFF),
    description: 'Multiply-add of signed 16-bit integers, keeping the low 16 bits (with clamp it saturates to [-32768, 32767]).\nvdst = src0 × src1 + src2',
    syntax: 'v_mad_i16 vdst, src0, src1, src2',
    types: { d: 'i16', s: ['i16', 'i16', 'i16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_mad_u32_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x373,
    operandCount: 4,
    execute: (a, b, c) => ((a * (b ?? 0) + (c ?? 0)) >>> 0),
    description: 'Multiply two unsigned 16-bit integers and add a 32-bit value (op_sel picks the halves of src0 and src1). The sum wraps; with clamp it saturates to 0xFFFFFFFF.\nvdst = src0[15:0] × src1[15:0] + src2',
    syntax: 'v_mad_u32_u16 vdst, src0, src1, src2',
    types: { d: 'b32', s: ['u16', 'u16', 'b32'] },
    opSel: true,
  },
  {
    mnemonic: 'v_mad_i32_i16',
    format: InstructionFormat.VOP3,
    opcode: 0x375,
    operandCount: 4,
    execute: (a, b, c) => ((a * (b ?? 0) + ((c ?? 0) | 0)) >>> 0),
    description: 'Multiply two signed 16-bit integers and add a signed 32-bit value (op_sel picks the halves of src0 and src1). The sum wraps; with clamp it saturates to the i32 range.\nvdst = src0[15:0] × src1[15:0] + src2',
    syntax: 'v_mad_i32_i16 vdst, src0, src1, src2',
    types: { d: 'b32', s: ['i16', 'i16', 'b32'] },
    opSel: true,
  },
  {
    mnemonic: 'v_min3_i16',
    format: InstructionFormat.VOP3,
    opcode: 0x352,
    operandCount: 4,
    execute: (a, b, c) => Math.min(a, b ?? 0, c ?? 0) & 0xFFFF,
    description: 'Minimum of three signed 16-bit integers.',
    syntax: 'v_min3_i16 vdst, src0, src1, src2',
    types: { d: 'i16', s: ['i16', 'i16', 'i16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_min3_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x353,
    operandCount: 4,
    execute: (a, b, c) => Math.min(a, b ?? 0, c ?? 0),
    description: 'Minimum of three unsigned 16-bit integers.',
    syntax: 'v_min3_u16 vdst, src0, src1, src2',
    types: { d: 'u16', s: ['u16', 'u16', 'u16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_max3_i16',
    format: InstructionFormat.VOP3,
    opcode: 0x355,
    operandCount: 4,
    execute: (a, b, c) => Math.max(a, b ?? 0, c ?? 0) & 0xFFFF,
    description: 'Maximum of three signed 16-bit integers.',
    syntax: 'v_max3_i16 vdst, src0, src1, src2',
    types: { d: 'i16', s: ['i16', 'i16', 'i16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_max3_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x356,
    operandCount: 4,
    execute: (a, b, c) => Math.max(a, b ?? 0, c ?? 0),
    description: 'Maximum of three unsigned 16-bit integers.',
    syntax: 'v_max3_u16 vdst, src0, src1, src2',
    types: { d: 'u16', s: ['u16', 'u16', 'u16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_med3_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x359,
    operandCount: 4,
    execute: (a, b, c) => [a, b ?? 0, c ?? 0].sort((x, y) => x - y)[1],
    description: 'Median of three unsigned 16-bit integers.',
    syntax: 'v_med3_u16 vdst, src0, src1, src2',
    types: { d: 'u16', s: ['u16', 'u16', 'u16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_cvt_pk_i16_i32',
    format: InstructionFormat.VOP3,
    opcode: 0x36B,
    operandCount: 3,
    execute: (a, b) => (satI32ToI16(a) | (satI32ToI16(b ?? 0) << 16)) >>> 0,
    description: 'Pack two signed 32-bit integers into two signed 16-bit halves, saturating each to [-32768, 32767].\nvdst = {sat_i16(src1), sat_i16(src0)}',
    syntax: 'v_cvt_pk_i16_i32 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_cvt_pk_u16_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x36A,
    operandCount: 3,
    execute: (a, b) => (satU32ToU16(a) | (satU32ToU16(b ?? 0) << 16)) >>> 0,
    description: 'Pack two unsigned 32-bit integers into two unsigned 16-bit halves, saturating each to 65535.\nvdst = {sat_u16(src1), sat_u16(src0)}',
    syntax: 'v_cvt_pk_u16_u32 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_cvt_pknorm_i16_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x368,
    operandCount: 3,
    execute: (a, b) => (snorm16(a) | (snorm16(b ?? 0) << 16)) >>> 0,
    description: 'Convert two f32 values to signed normalized 16-bit integers and pack them: each is clamped to [-1, 1], scaled by 32767 and rounded to nearest even (NaN gives 0).\nvdst = {snorm16(src1), snorm16(src0)}',
    syntax: 'v_cvt_pknorm_i16_f32 vdst, src0, src1',
    types: { d: 'b32', s: ['f32', 'f32'] },
  },
  {
    mnemonic: 'v_cvt_pknorm_u16_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x369,
    operandCount: 3,
    execute: (a, b) => (unorm16(a) | (unorm16(b ?? 0) << 16)) >>> 0,
    description: 'Convert two f32 values to unsigned normalized 16-bit integers and pack them: each is clamped to [0, 1], scaled by 65535 and rounded to nearest even (NaN gives 0).\nvdst = {unorm16(src1), unorm16(src0)}',
    syntax: 'v_cvt_pknorm_u16_f32 vdst, src0, src1',
    types: { d: 'b32', s: ['f32', 'f32'] },
  },
  {
    mnemonic: 'v_cvt_pknorm_i16_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x312,
    operandCount: 3,
    execute: (a, b) => (snorm16(a) | (snorm16(b ?? 0) << 16)) >>> 0,
    description: 'Convert two f16 values (op_sel picks each source half) to signed normalized 16-bit integers and pack them: each is clamped to [-1, 1], scaled by 32767 and rounded to nearest even.\nvdst = {snorm16(src1), snorm16(src0)}',
    syntax: 'v_cvt_pknorm_i16_f16 vdst, src0, src1',
    types: { d: 'b32', s: ['f16', 'f16'] },
    opSel: true,
  },
  {
    mnemonic: 'v_cvt_pknorm_u16_f16',
    format: InstructionFormat.VOP3,
    opcode: 0x313,
    operandCount: 3,
    execute: (a, b) => (unorm16(a) | (unorm16(b ?? 0) << 16)) >>> 0,
    description: 'Convert two f16 values (op_sel picks each source half) to unsigned normalized 16-bit integers and pack them: each is clamped to [0, 1], scaled by 65535 and rounded to nearest even.\nvdst = {unorm16(src1), unorm16(src0)}',
    syntax: 'v_cvt_pknorm_u16_f16 vdst, src0, src1',
    types: { d: 'b32', s: ['f16', 'f16'] },
    opSel: true,
  },
  // VOP3P packed instructions (bits [31:23] = 0x198)
  // Each operates on two packed 16-bit values per 32-bit register
  {
    mnemonic: 'v_pk_mad_i16',
    format: InstructionFormat.VOP3P,
    opcode: 0x000,
    operandCount: 4,
    execute: (a, b, c) => (((a | 0) * (b ?? 0 | 0) + (c ?? 0 | 0)) & 0xFFFF),
    description: 'Packed multiply-add signed 16-bit.\nvdst = src0 * src1 + src2' + PK_INT_CONST_NOTE,
    syntax: 'v_pk_mad_i16 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_mul_lo_u16',
    format: InstructionFormat.VOP3P,
    opcode: 0x001,
    operandCount: 3,
    execute: (a, b) => ((a * (b ?? 0)) & 0xFFFF),
    description: 'Packed multiply low unsigned 16-bit.\nvdst = (src0 * src1) & 0xFFFF' + PK_INT_CONST_NOTE,
    syntax: 'v_pk_mul_lo_u16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_add_i16',
    format: InstructionFormat.VOP3P,
    opcode: 0x002,
    operandCount: 3,
    execute: (a, b) => ((a + (b ?? 0)) & 0xFFFF),
    description: 'Packed add signed 16-bit.\nvdst = src0 + src1' + PK_INT_CONST_NOTE,
    syntax: 'v_pk_add_i16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_sub_i16',
    format: InstructionFormat.VOP3P,
    opcode: 0x003,
    operandCount: 3,
    execute: (a, b) => ((a - (b ?? 0)) & 0xFFFF),
    description: 'Packed subtract signed 16-bit.\nvdst = src0 - src1' + PK_INT_CONST_NOTE,
    syntax: 'v_pk_sub_i16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_lshlrev_b16',
    format: InstructionFormat.VOP3P,
    opcode: 0x004,
    operandCount: 3,
    execute: (a, b) => (((b ?? 0) << (a & 0xF)) & 0xFFFF),
    description: 'Packed left shift rev 16-bit.\nvdst = src1 << src0' + PK_INT_CONST_NOTE,
    syntax: 'v_pk_lshlrev_b16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_lshrrev_b16',
    format: InstructionFormat.VOP3P,
    opcode: 0x005,
    operandCount: 3,
    execute: (a, b) => (((b ?? 0) >>> (a & 0xF)) & 0xFFFF),
    description: 'Packed logical shift right rev 16-bit.\nvdst = src1 >> src0' + PK_INT_CONST_NOTE,
    syntax: 'v_pk_lshrrev_b16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_ashrrev_i16',
    format: InstructionFormat.VOP3P,
    opcode: 0x006,
    operandCount: 3,
    execute: (a, b) => ((((b ?? 0) << 16 >> 16) >> (a & 0xF)) & 0xFFFF),
    description: 'Packed arithmetic shift right rev signed 16-bit.\nvdst = src1 >> src0 (signed)' + PK_INT_CONST_NOTE,
    syntax: 'v_pk_ashrrev_i16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_max_i16',
    format: InstructionFormat.VOP3P,
    opcode: 0x007,
    operandCount: 3,
    execute: (a, b) => { const sa = (a << 16) >> 16; const sb = ((b ?? 0) << 16) >> 16; return (Math.max(sa, sb) & 0xFFFF); },
    description: 'Packed max signed 16-bit.\nvdst = max(src0, src1)' + PK_INT_CONST_NOTE,
    syntax: 'v_pk_max_i16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_min_i16',
    format: InstructionFormat.VOP3P,
    opcode: 0x008,
    operandCount: 3,
    execute: (a, b) => { const sa = (a << 16) >> 16; const sb = ((b ?? 0) << 16) >> 16; return (Math.min(sa, sb) & 0xFFFF); },
    description: 'Packed min signed 16-bit.\nvdst = min(src0, src1)' + PK_INT_CONST_NOTE,
    syntax: 'v_pk_min_i16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_mad_u16',
    format: InstructionFormat.VOP3P,
    opcode: 0x009,
    operandCount: 4,
    execute: (a, b, c) => ((a * (b ?? 0) + (c ?? 0)) & 0xFFFF),
    description: 'Packed multiply-add unsigned 16-bit.\nvdst = src0 * src1 + src2' + PK_INT_CONST_NOTE,
    syntax: 'v_pk_mad_u16 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_add_u16',
    format: InstructionFormat.VOP3P,
    opcode: 0x00A,
    operandCount: 3,
    execute: (a, b) => ((a + (b ?? 0)) & 0xFFFF),
    description: 'Packed add unsigned 16-bit.\nvdst = src0 + src1' + PK_INT_CONST_NOTE,
    syntax: 'v_pk_add_u16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_sub_u16',
    format: InstructionFormat.VOP3P,
    opcode: 0x00B,
    operandCount: 3,
    execute: (a, b) => ((a - (b ?? 0)) & 0xFFFF),
    description: 'Packed subtract unsigned 16-bit.\nvdst = src0 - src1' + PK_INT_CONST_NOTE,
    syntax: 'v_pk_sub_u16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_max_u16',
    format: InstructionFormat.VOP3P,
    opcode: 0x00C,
    operandCount: 3,
    execute: (a, b) => Math.max(a & 0xFFFF, (b ?? 0) & 0xFFFF),
    description: 'Packed max unsigned 16-bit.\nvdst = max(src0, src1)' + PK_INT_CONST_NOTE,
    syntax: 'v_pk_max_u16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_min_u16',
    format: InstructionFormat.VOP3P,
    opcode: 0x00D,
    operandCount: 3,
    execute: (a, b) => Math.min(a & 0xFFFF, (b ?? 0) & 0xFFFF),
    description: 'Packed min unsigned 16-bit.\nvdst = min(src0, src1)' + PK_INT_CONST_NOTE,
    syntax: 'v_pk_min_u16 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_pk_fma_f16',
    format: InstructionFormat.VOP3P,
    opcode: 0x00E,
    operandCount: 4,
    execute: (a, b, c) => asFloat(a * (b ?? 0) + (c ?? 0)),
    description: 'Packed fused multiply-add f16.\nvdst = src0 * src1 + src2' + PK_F16_CONST_NOTE,
    syntax: 'v_pk_fma_f16 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_pk_add_f16',
    format: InstructionFormat.VOP3P,
    opcode: 0x00F,
    operandCount: 3,
    execute: (a, b) => asFloat(a + (b ?? 0)),
    description: 'Packed add f16.\nvdst = src0 + src1' + PK_F16_CONST_NOTE,
    syntax: 'v_pk_add_f16 vdst, src0, src1',
  },
  {
    mnemonic: 'v_pk_mul_f16',
    format: InstructionFormat.VOP3P,
    opcode: 0x010,
    operandCount: 3,
    execute: (a, b) => asFloat(a * (b ?? 0)),
    description: 'Packed multiply f16.\nvdst = src0 * src1' + PK_F16_CONST_NOTE,
    syntax: 'v_pk_mul_f16 vdst, src0, src1',
  },
  {
    mnemonic: 'v_pk_min_f16',
    format: InstructionFormat.VOP3P,
    opcode: 0x011,
    operandCount: 3,
    execute: (a, b) => fmin(a, b ?? 0),
    description: 'Packed minimum f16.\nvdst = min(src0, src1)' + PK_F16_CONST_NOTE,
    syntax: 'v_pk_min_f16 vdst, src0, src1',
  },
  {
    mnemonic: 'v_pk_max_f16',
    format: InstructionFormat.VOP3P,
    opcode: 0x012,
    operandCount: 3,
    execute: (a, b) => fmax(a, b ?? 0),
    description: 'Packed maximum f16.\nvdst = max(src0, src1)' + PK_F16_CONST_NOTE,
    syntax: 'v_pk_max_f16 vdst, src0, src1',
  },
  {
    mnemonic: 'v_fma_mix_f32',
    format: InstructionFormat.VOP3P,
    opcode: 0x020,
    operandCount: 4,
    execute: (a, b, c) => asFloat(a * (b ?? 0) + (c ?? 0)),
    description: 'Mixed-precision fused multiply-add with an f32 result. Each source is f32 when its op_sel_hi bit is 0, or an f16 half (op_sel picks lo/hi) when it is 1; neg_hi acts as abs.\nvdst = src0 * src1 + src2',
    syntax: 'v_fma_mix_f32 vdst, src0, src1, src2 op_sel:[0,0,0] op_sel_hi:[0,0,0]',
  },
  {
    mnemonic: 'v_fma_mixlo_f16',
    format: InstructionFormat.VOP3P,
    opcode: 0x021,
    operandCount: 4,
    execute: (a, b, c) => asFloat(a * (b ?? 0) + (c ?? 0)),
    description: 'Mixed-precision fused multiply-add rounded to f16 and written to the low half of vdst (the high half is preserved). Sources are read as for v_fma_mix_f32: f32 when the op_sel_hi bit is 0, the f16 half picked by op_sel when it is 1.\nvdst[15:0] = src0 * src1 + src2',
    syntax: 'v_fma_mixlo_f16 vdst, src0, src1, src2 op_sel:[0,0,0] op_sel_hi:[0,0,0]',
  },
  {
    mnemonic: 'v_fma_mixhi_f16',
    format: InstructionFormat.VOP3P,
    opcode: 0x022,
    operandCount: 4,
    execute: (a, b, c) => asFloat(a * (b ?? 0) + (c ?? 0)),
    description: 'Mixed-precision fused multiply-add rounded to f16 and written to the high half of vdst (the low half is preserved). Sources are read as for v_fma_mix_f32: f32 when the op_sel_hi bit is 0, the f16 half picked by op_sel when it is 1.\nvdst[31:16] = src0 * src1 + src2',
    syntax: 'v_fma_mixhi_f16 vdst, src0, src1, src2 op_sel:[0,0,0] op_sel_hi:[0,0,0]',
  },
  // Dot products: src0 and src1 hold packed elements, src2 and vdst are 32-bit
  {
    mnemonic: 'v_dot2_f32_f16',
    format: InstructionFormat.VOP3P,
    opcode: 0x013,
    operandCount: 4,
    execute: (a, b, c) => dotF16(a, b ?? 0, c ?? 0),
    description: 'Multiply the two f16 halves of src0 by the matching halves of src1 and add both products to the f32 src2. ' +
      'op_sel picks the halves for the first product and op_sel_hi (default hi) those for the second; -src0/-src1 negate both halves, ' +
      'and the f32 src2 takes -src2 and |src2|. With clamp the result is limited to [0.0, 1.0].\nvdst.f32 = src0.lo × src1.lo + src0.hi × src1.hi + src2' + PK_F16_CONST_NOTE,
    syntax: 'v_dot2_f32_f16 vdst, src0, src1, src2',
    dot: 'f16',
  },
  {
    mnemonic: 'v_dot2_i32_i16',
    format: InstructionFormat.VOP3P,
    opcode: 0x014,
    operandCount: 4,
    execute: (a, b, c) => dotProduct(a, b ?? 0, 16, true) + ((c ?? 0) | 0),
    description: 'Multiply the two signed 16-bit halves of src0 by the matching halves of src1 and add both products to the signed 32-bit src2. ' +
      'op_sel picks the halves for the first product and op_sel_hi (default hi) those for the second. The sum wraps; with clamp it saturates to the i32 range.' +
      '\nvdst.i32 = src0.lo × src1.lo + src0.hi × src1.hi + src2' + PK_INT_CONST_NOTE,
    syntax: 'v_dot2_i32_i16 vdst, src0, src1, src2',
    isIntegerOp: true,
    dot: 'i16',
  },
  {
    mnemonic: 'v_dot2_u32_u16',
    format: InstructionFormat.VOP3P,
    opcode: 0x015,
    operandCount: 4,
    execute: (a, b, c) => dotProduct(a, b ?? 0, 16, false) + ((c ?? 0) >>> 0),
    description: 'Multiply the two unsigned 16-bit halves of src0 by the matching halves of src1 and add both products to the unsigned 32-bit src2. ' +
      'op_sel picks the halves for the first product and op_sel_hi (default hi) those for the second. The sum wraps; with clamp it saturates to 0xFFFFFFFF.' +
      '\nvdst.u32 = src0.lo × src1.lo + src0.hi × src1.hi + src2' + PK_INT_CONST_NOTE,
    syntax: 'v_dot2_u32_u16 vdst, src0, src1, src2',
    isIntegerOp: true,
    dot: 'u16',
  },
  {
    mnemonic: 'v_dot4_i32_i8',
    format: InstructionFormat.VOP3P,
    opcode: 0x016,
    operandCount: 4,
    execute: (a, b, c) => dotProduct(a, b ?? 0, 8, true) + ((c ?? 0) | 0),
    description: 'Multiply each of the four signed bytes of src0 by the matching byte of src1 and add the four products to the signed 32-bit src2. ' +
      'The sum wraps; with clamp it saturates to the i32 range. No op_sel or neg modifiers.\nvdst.i32 = Σ src0.i8[k] × src1.i8[k] (k = 0..3) + src2',
    syntax: 'v_dot4_i32_i8 vdst, src0, src1, src2',
    isIntegerOp: true,
    dot: 'i8',
  },
  {
    mnemonic: 'v_dot4_u32_u8',
    format: InstructionFormat.VOP3P,
    opcode: 0x017,
    operandCount: 4,
    execute: (a, b, c) => dotProduct(a, b ?? 0, 8, false) + ((c ?? 0) >>> 0),
    description: 'Multiply each of the four unsigned bytes of src0 by the matching byte of src1 and add the four products to the unsigned 32-bit src2. ' +
      'The sum wraps; with clamp it saturates to 0xFFFFFFFF. No op_sel or neg modifiers.\nvdst.u32 = Σ src0.u8[k] × src1.u8[k] (k = 0..3) + src2',
    syntax: 'v_dot4_u32_u8 vdst, src0, src1, src2',
    isIntegerOp: true,
    dot: 'u8',
  },
  {
    mnemonic: 'v_dot8_i32_i4',
    format: InstructionFormat.VOP3P,
    opcode: 0x018,
    operandCount: 4,
    execute: (a, b, c) => dotProduct(a, b ?? 0, 4, true) + ((c ?? 0) | 0),
    description: 'Multiply each of the eight signed 4-bit values (nibbles, -8..7) of src0 by the matching nibble of src1 and add the eight products to the signed 32-bit src2. ' +
      'The sum wraps; with clamp it saturates to the i32 range. No op_sel or neg modifiers.\nvdst.i32 = Σ src0.i4[k] × src1.i4[k] (k = 0..7) + src2',
    syntax: 'v_dot8_i32_i4 vdst, src0, src1, src2',
    isIntegerOp: true,
    dot: 'i4',
  },
  {
    mnemonic: 'v_dot8_u32_u4',
    format: InstructionFormat.VOP3P,
    opcode: 0x019,
    operandCount: 4,
    execute: (a, b, c) => dotProduct(a, b ?? 0, 4, false) + ((c ?? 0) >>> 0),
    description: 'Multiply each of the eight unsigned 4-bit values (nibbles, 0..15) of src0 by the matching nibble of src1 and add the eight products to the unsigned 32-bit src2. ' +
      'The sum wraps; with clamp it saturates to 0xFFFFFFFF. No op_sel or neg modifiers.\nvdst.u32 = Σ src0.u4[k] × src1.u4[k] (k = 0..7) + src2',
    syntax: 'v_dot8_u32_u4 vdst, src0, src1, src2',
    isIntegerOp: true,
    dot: 'u4',
  },
  {
    mnemonic: 'v_perm_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x344,
    operandCount: 4,
    execute: (a, b, c) => {
      // Each selector byte of src2 picks a byte of {src0, src1} (bytes 0–3 = src1, 4–7 = src0)
      const s0 = (a ?? 0) >>> 0;
      const s1 = (b ?? 0) >>> 0;
      const sel = (c ?? 0) >>> 0;
      const byteOf = (i: number) => (i < 4 ? (s1 >>> (i * 8)) : (s0 >>> ((i - 4) * 8))) & 0xFF;
      let result = 0;
      for (let i = 0; i < 4; i++) {
        const s = (sel >>> (i * 8)) & 0xFF;
        let byte: number;
        if (s >= 13) byte = 0xFF;
        else if (s === 12) byte = 0x00;
        else if (s >= 8) byte = (byteOf((s - 8) * 2 + 1) & 0x80) ? 0xFF : 0x00; // sign of byte 1/3/5/7
        else byte = byteOf(s);
        result |= byte << (i * 8);
      }
      return result >>> 0;
    },
    description: 'Byte permutation. Each byte of vdst is selected from {src0, src1} by the matching selector byte of src2.\nSelectors: 0–3 = src1 bytes, 4–7 = src0 bytes, 8–11 = sign of byte 1/3/5/7 replicated, 12 = 0x00, ≥13 = 0xFF.',
    syntax: 'v_perm_b32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mad_u32_u24',
    format: InstructionFormat.VOP3,
    opcode: 0x143,
    operandCount: 4,
    execute: (a, b, c) => {
      const ua = (a >>> 0) & 0xFFFFFF;
      const ub = ((b ?? 0) >>> 0) & 0xFFFFFF;
      return ((ua * ub) + (c ?? 0)) >>> 0;
    },
    description: 'Multiply-add unsigned 24-bit: (uint24)src0 × (uint24)src1 + src2.\nvdst = (uint24)src0 × (uint24)src1 + src2',
    syntax: 'v_mad_u32_u24 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_cubeid_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x144,
    operandCount: 4,
    execute: (a, b, c) => {
      const x = a, y = b ?? 0, z = c ?? 0;
      const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
      if (az >= ax && az >= ay) return asFloat(z < 0 ? 5.0 : 4.0);
      if (ay >= ax) return asFloat(y < 0 ? 3.0 : 2.0);
      return asFloat(x < 0 ? 1.0 : 0.0);
    },
    description: 'Cubemap face ID (0–5) of the major axis of (x=src0, y=src1, z=src2); Z wins ties, then Y.\nvdst = cubeid(src0, src1, src2)',
    syntax: 'v_cubeid_f32 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_cubesc_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x145,
    operandCount: 4,
    execute: (a, b, c) => {
      const x = a, y = b ?? 0, z = c ?? 0;
      const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
      if (az >= ax && az >= ay) return asFloat(z < 0 ? -x : x);
      if (ay >= ax) return asFloat(x);
      return asFloat(x < 0 ? z : -z);
    },
    description: 'Cubemap S coordinate.\nvdst = cubesc(src0, src1, src2)',
    syntax: 'v_cubesc_f32 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_cubetc_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x146,
    operandCount: 4,
    execute: (a, b, c) => {
      const x = a, y = b ?? 0, z = c ?? 0;
      const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
      if (az >= ax && az >= ay) return asFloat(-y);
      if (ay >= ax) return asFloat(y < 0 ? -z : z);
      return asFloat(-y);
    },
    description: 'Cubemap T coordinate.\nvdst = cubetc(src0, src1, src2)',
    syntax: 'v_cubetc_f32 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_cubema_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x147,
    operandCount: 4,
    execute: (a, b, c) => {
      const x = a, y = b ?? 0, z = c ?? 0;
      const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
      if (az >= ax && az >= ay) return asFloat(2.0 * z);
      if (ay >= ax) return asFloat(2.0 * y);
      return asFloat(2.0 * x);
    },
    description: 'Cubemap major axis: 2.0 × the (signed) major-axis coordinate.\nvdst = 2.0 × major_axis(src0, src1, src2)',
    syntax: 'v_cubema_f32 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_lerp_u8',
    format: InstructionFormat.VOP3,
    opcode: 0x14D,
    operandCount: 4,
    execute: (a, b, c) => {
      const s0 = a >>> 0, s1 = (b ?? 0) >>> 0, s2 = (c ?? 0) >>> 0;
      let result = 0;
      for (let i = 0; i < 4; i++) {
        const a8 = (s0 >>> (i * 8)) & 0xFF;
        const b8 = (s1 >>> (i * 8)) & 0xFF;
        const round = (s2 >>> (i * 8)) & 1;
        const lerped = ((a8 + b8 + round) >> 1) & 0xFF;
        result |= lerped << (i * 8);
      }
      return result >>> 0;
    },
    description: 'Unsigned 8-bit average of packed bytes; bit 0 of each src2 byte rounds 0.5 up.\nvdst.byte[i] = (src0.byte[i] + src1.byte[i] + src2[8i]) >> 1',
    syntax: 'v_lerp_u8 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_alignbit_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x14E,
    operandCount: 4,
    execute: (a, b, c) => {
      const shift = (c ?? 0) & 31;
      if (shift === 0) return (b ?? 0) >>> 0;
      return ((((a >>> 0) << (32 - shift)) | (((b ?? 0) >>> 0) >>> shift)) >>> 0);
    },
    description: 'Bit alignment: extract 32 bits from a 64-bit value {src0, src1} >> src2.\nvdst = ({src0, src1} >> src2)[31:0]',
    syntax: 'v_alignbit_b32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_alignbyte_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x14F,
    operandCount: 4,
    execute: (a, b, c) => {
      const shift = ((c ?? 0) & 3) * 8;
      if (shift === 0) return (b ?? 0) >>> 0;
      return ((((a >>> 0) << (32 - shift)) | (((b ?? 0) >>> 0) >>> shift)) >>> 0);
    },
    description: 'Byte alignment: extract 32 bits from {src0, src1} >> (src2[1:0] × 8).\nvdst = ({src0, src1} >> (src2[1:0] × 8))[31:0]',
    syntax: 'v_alignbyte_b32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_min3_i32',
    format: InstructionFormat.VOP3,
    opcode: 0x152,
    operandCount: 4,
    execute: (a, b, c) => {
      const sa = a | 0, sb = (b ?? 0) | 0, sc = (c ?? 0) | 0;
      return Math.min(sa, sb, sc) | 0;
    },
    description: 'Minimum of three signed 32-bit integers.\nvdst = min(src0, src1, src2)',
    syntax: 'v_min3_i32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_min3_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x153,
    operandCount: 4,
    execute: (a, b, c) => {
      const ua = a >>> 0, ub = (b ?? 0) >>> 0, uc = (c ?? 0) >>> 0;
      return Math.min(ua, ub, uc) >>> 0;
    },
    description: 'Minimum of three unsigned 32-bit integers.\nvdst = min(src0, src1, src2)',
    syntax: 'v_min3_u32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_max3_i32',
    format: InstructionFormat.VOP3,
    opcode: 0x155,
    operandCount: 4,
    execute: (a, b, c) => {
      const sa = a | 0, sb = (b ?? 0) | 0, sc = (c ?? 0) | 0;
      return Math.max(sa, sb, sc) | 0;
    },
    description: 'Maximum of three signed 32-bit integers.\nvdst = max(src0, src1, src2)',
    syntax: 'v_max3_i32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_max3_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x156,
    operandCount: 4,
    execute: (a, b, c) => {
      const ua = a >>> 0, ub = (b ?? 0) >>> 0, uc = (c ?? 0) >>> 0;
      return Math.max(ua, ub, uc) >>> 0;
    },
    description: 'Maximum of three unsigned 32-bit integers.\nvdst = max(src0, src1, src2)',
    syntax: 'v_max3_u32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_med3_i32',
    format: InstructionFormat.VOP3,
    opcode: 0x158,
    operandCount: 4,
    execute: (a, b, c) => {
      const vals = [a | 0, (b ?? 0) | 0, (c ?? 0) | 0].sort((x, y) => x - y);
      return vals[1] | 0;
    },
    description: 'Median of three signed 32-bit integers.\nvdst = median(src0, src1, src2)',
    syntax: 'v_med3_i32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_med3_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x159,
    operandCount: 4,
    execute: (a, b, c) => {
      const vals = [a >>> 0, (b ?? 0) >>> 0, (c ?? 0) >>> 0].sort((x, y) => x - y);
      return vals[1] >>> 0;
    },
    description: 'Median of three unsigned 32-bit integers.\nvdst = median(src0, src1, src2)',
    syntax: 'v_med3_u32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_sad_u8',
    format: InstructionFormat.VOP3,
    opcode: 0x15A,
    operandCount: 4,
    execute: (a, b, c) => {
      const s0 = a >>> 0, s1 = (b ?? 0) >>> 0;
      let sum = (c ?? 0) >>> 0;
      for (let i = 0; i < 4; i++) {
        const a8 = (s0 >>> (i * 8)) & 0xFF;
        const b8 = (s1 >>> (i * 8)) & 0xFF;
        sum += Math.abs(a8 - b8);
      }
      return sum >>> 0;
    },
    description: 'Sum of absolute differences of packed bytes, accumulated.\nvdst = Σ|src0[i] - src1[i]| + src2 (4 bytes)',
    syntax: 'v_sad_u8 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_sad_u16',
    format: InstructionFormat.VOP3,
    opcode: 0x15C,
    operandCount: 4,
    execute: (a, b, c) => {
      const s0 = a >>> 0, s1 = (b ?? 0) >>> 0;
      let sum = (c ?? 0) >>> 0;
      for (let i = 0; i < 2; i++) {
        const a16 = (s0 >>> (i * 16)) & 0xFFFF;
        const b16 = (s1 >>> (i * 16)) & 0xFFFF;
        sum += Math.abs(a16 - b16);
      }
      return sum >>> 0;
    },
    description: 'Sum of absolute differences of packed 16-bit values, accumulated.\nvdst = Σ|src0[i] - src1[i]| + src2 (2 halfwords)',
    syntax: 'v_sad_u16 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_sad_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x15D,
    operandCount: 4,
    execute: (a, b, c) => {
      const diff = Math.abs((a | 0) - ((b ?? 0) | 0));
      return (diff + ((c ?? 0) >>> 0)) >>> 0;
    },
    description: 'Absolute difference of two signed 32-bit values, accumulated.\nvdst = |src0 - src1| + src2',
    syntax: 'v_sad_u32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mul_hi_i32',
    format: InstructionFormat.VOP3,
    opcode: 0x16C,
    operandCount: 3,
    execute: (a, b) => {
      const sa = a | 0;
      const sb = (b ?? 0) | 0;
      return (Number(BigInt(sa) * BigInt(sb) >> 32n)) | 0;
    },
    description: 'Multiply two signed 32-bit integers, return high 32 bits.\nvdst = hi32((int)src0 × (int)src1)',
    syntax: 'v_mul_hi_i32 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_xor3_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x178,
    operandCount: 4,
    execute: (a, b, c) => ((a ^ (b ?? 0) ^ (c ?? 0)) >>> 0),
    description: 'XOR three 32-bit values.\nvdst = src0 ^ src1 ^ src2',
    syntax: 'v_xor3_b32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_lshlrev_b64',
    format: InstructionFormat.VOP3,
    opcode: 0x2FF,
    operandCount: 3,
    execute: (a, b) => Number((BigInt((b ?? 0) >>> 0) << BigInt(a & 63)) & 0xFFFFFFFFn) >>> 0,
    description: '64-bit left shift of the register pair src1 by src0[5:0] (reversed operand order).\nvdst[0:1] = src1[0:1] << src0[5:0]',
    syntax: 'v_lshlrev_b64 v[vdst:vdst+1], src0, v[src1:src1+1]',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_lshrrev_b64',
    format: InstructionFormat.VOP3,
    opcode: 0x300,
    operandCount: 3,
    execute: (a, b) => Number((BigInt((b ?? 0) >>> 0) >> BigInt(a & 63)) & 0xFFFFFFFFn) >>> 0,
    description: '64-bit logical right shift of the register pair src1 by src0[5:0] (reversed operand order).\nvdst[0:1] = src1[0:1] >> src0[5:0]',
    syntax: 'v_lshrrev_b64 v[vdst:vdst+1], src0, v[src1:src1+1]',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_ashrrev_i64',
    format: InstructionFormat.VOP3,
    opcode: 0x301,
    operandCount: 3,
    execute: (a, b) => Number(BigInt.asUintN(32, BigInt((b ?? 0) | 0) >> BigInt(a & 63))) >>> 0,
    description: '64-bit arithmetic right shift of the register pair src1 by src0[5:0] (reversed operand order).\nvdst[0:1] = (int64)src1[0:1] >> src0[5:0]',
    syntax: 'v_ashrrev_i64 v[vdst:vdst+1], src0, v[src1:src1+1]',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_add_co_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x30F,
    operandCount: 4,
    execute: (a, b) => ((a + (b ?? 0)) >>> 0),
    description: 'Add two unsigned 32-bit integers with carry-out to an SGPR (VCC by default).\nvdst = src0 + src1; sdst[lane] = carry',
    syntax: 'v_add_co_u32 vdst, vcc_lo, src0, src1',
    writesVCC: true,
    isIntegerOp: true,
    carry: 'add',
    vop3b: true,
  },
  {
    mnemonic: 'v_sub_co_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x310,
    operandCount: 4,
    execute: (a, b) => ((a - (b ?? 0)) >>> 0),
    description: 'Subtract two unsigned 32-bit integers with borrow-out to an SGPR (VCC by default).\nvdst = src0 - src1; sdst[lane] = borrow',
    syntax: 'v_sub_co_u32 vdst, vcc_lo, src0, src1',
    writesVCC: true,
    isIntegerOp: true,
    carry: 'sub',
    vop3b: true,
  },
  {
    mnemonic: 'v_subrev_co_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x319,
    operandCount: 4,
    execute: (a, b) => (((b ?? 0) - a) >>> 0),
    description: 'Reverse subtract with borrow-out to an SGPR (VCC by default).\nvdst = src1 - src0; sdst[lane] = borrow',
    syntax: 'v_subrev_co_u32 vdst, vcc_lo, src0, src1',
    writesVCC: true,
    isIntegerOp: true,
    carry: 'subrev',
    vop3b: true,
  },
  {
    mnemonic: 'v_xad_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x345,
    operandCount: 4,
    execute: (a, b, c) => (((a ^ (b ?? 0)) + (c ?? 0)) >>> 0),
    description: 'XOR then add: (src0 ^ src1) + src2.\nvdst = (src0 ^ src1) + src2',
    syntax: 'v_xad_u32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_and_or_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x371,
    operandCount: 4,
    execute: (a, b, c) => (((a & (b ?? 0)) | (c ?? 0)) >>> 0),
    description: 'AND then OR: (src0 & src1) | src2.\nvdst = (src0 & src1) | src2',
    syntax: 'v_and_or_b32 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_sub_nc_i32',
    format: InstructionFormat.VOP3,
    opcode: 0x376,
    operandCount: 3,
    execute: (a, b) => ((a - (b ?? 0)) | 0),
    description: 'Subtract signed 32-bit integers (no carry).\nvdst = src0 - src1',
    syntax: 'v_sub_nc_i32 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_add_nc_i32',
    format: InstructionFormat.VOP3,
    opcode: 0x37F,
    operandCount: 3,
    execute: (a, b) => ((a + (b ?? 0)) | 0),
    description: 'Add signed 32-bit integers (no carry).\nvdst = src0 + src1',
    syntax: 'v_add_nc_i32 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_writelane_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x361,
    operandCount: 3,
    execute: (a) => a,
    description: 'Write a scalar value into a specific lane of a VGPR.\nvdst[src1] = src0',
    syntax: 'v_writelane_b32 vdst, ssrc0, ssrc1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_ldexp_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x362,
    operandCount: 3,
    // The exponent is clamped so 0 × 2^huge stays 0 instead of becoming NaN; f32 results are unchanged
    execute: (a, b) => asFloat(a * Math.pow(2, Math.max(-300, Math.min(300, (b ?? 0) | 0)))),
    description: 'Load exponent: multiply a float by a power of two.\nvdst = src0 × 2^(int)src1',
    syntax: 'v_ldexp_f32 vdst, src0, src1',
    types: { d: 'f32', s: ['f32', 'b32'] },
  },
  {
    mnemonic: 'v_bfm_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x363,
    operandCount: 3,
    execute: (a, b) => {
      const count = a & 31;
      const offset = (b ?? 0) & 31;
      return (((1 << count) - 1) << offset) >>> 0;
    },
    description: 'Bit field mask: generate a mask of count bits starting at offset.\nvdst = ((1 << src0[4:0]) - 1) << src1[4:0]',
    syntax: 'v_bfm_b32 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_bcnt_u32_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x364,
    operandCount: 3,
    execute: (a, b) => {
      let v = a >>> 0;
      let count = 0;
      while (v) { count += v & 1; v >>>= 1; }
      return (count + ((b ?? 0) >>> 0)) >>> 0;
    },
    description: 'Bit count (popcount) + accumulate: count set bits in src0, add src1.\nvdst = popcount(src0) + src1',
    syntax: 'v_bcnt_u32_b32 vdst, src0, src1',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mad_legacy_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x140,
    operandCount: 4,
    execute: (a, b, c) => {
      if (a === 0 || (b ?? 0) === 0) return asFloat(0 + (c ?? 0));
      return asFloat(a * (b ?? 0) + (c ?? 0));
    },
    description: 'Legacy multiply-add f32: if src0 or src1 is 0, treat product as 0.\nvdst = src0 × src1 + src2 (legacy zero handling)',
    syntax: 'v_mad_legacy_f32 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_mad_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x141,
    operandCount: 4,
    execute: (a, b, c) => asFloat(asFloat(a * (b ?? 0)) + (c ?? 0)),
    description: 'Multiply-add f32 (not fused: the product is rounded to f32 before the add).\nvdst = src0 × src1 + src2',
    syntax: 'v_mad_f32 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_mullit_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x150,
    operandCount: 4,
    execute: (a, b, _c) => {
      if (a === 0 || (b ?? 0) === 0) return 0;
      return asFloat(a * (b ?? 0));
    },
    description: 'Multiply-lit: special for lighting. Returns 0 if either source is 0.\nvdst = (src0 == 0 || src1 == 0) ? 0 : src0 × src1',
    syntax: 'v_mullit_f32 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_sad_hi_u8',
    format: InstructionFormat.VOP3,
    opcode: 0x15B,
    operandCount: 4,
    execute: (a, b, c) => {
      const s0 = a >>> 0, s1 = (b ?? 0) >>> 0;
      let sum = 0;
      for (let i = 0; i < 4; i++) {
        const a8 = (s0 >>> (i * 8)) & 0xFF;
        const b8 = (s1 >>> (i * 8)) & 0xFF;
        sum += Math.abs(a8 - b8);
      }
      return ((sum << 16) + ((c ?? 0) >>> 0)) >>> 0;
    },
    description: 'Sum of absolute differences of packed bytes, result shifted left by 16 bits, then accumulated.\nvdst = (Σ|src0[i] - src1[i]| << 16) + src2',
    syntax: 'v_sad_hi_u8 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_cvt_pk_u8_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x15E,
    operandCount: 4,
    execute: (a, b, c) => {
      const val = Number.isNaN(a) ? 0 : Math.max(0, Math.min(255, rndne(a)));
      const byteIdx = (b ?? 0) & 3;
      const prev = (c ?? 0) >>> 0;
      const mask = ~(0xFF << (byteIdx * 8)) >>> 0;
      return ((prev & mask) | ((val & 0xFF) << (byteIdx * 8))) >>> 0;
    },
    description: 'Convert float to unsigned 8-bit (round to nearest even, saturate) and pack into byte position.\nvdst = (src2 & ~(0xFF << (src1*8))) | (u8(src0) << (src1*8))',
    syntax: 'v_cvt_pk_u8_f32 vdst, src0, src1, src2',
    types: { d: 'b32', s: ['f32', 'b32', 'b32'] },
  },
  {
    mnemonic: 'v_div_fixup_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x15F,
    operandCount: 4,
    execute: (a, b, c) => {
      const quotient = a;
      const denominator = b ?? 0;
      const numerator = c ?? 0;
      const signOut = (denominator < 0 || Object.is(denominator, -0)) !== (numerator < 0 || Object.is(numerator, -0));
      if (Number.isNaN(numerator) || Number.isNaN(denominator)) return NaN;
      if (denominator === 0 && numerator === 0) return NaN;                       // 0/0
      if (!Number.isFinite(denominator) && !Number.isFinite(numerator)) return NaN; // inf/inf
      if (denominator === 0 || !Number.isFinite(numerator)) return signOut ? -Infinity : Infinity; // x/0, inf/y
      if (!Number.isFinite(denominator) || numerator === 0) return signOut ? -0 : 0;            // x/inf, 0/y
      if (Math.log2(Math.abs(numerator)) - Math.log2(Math.abs(denominator)) < -150) return signOut ? -0 : 0;
      return asFloat(signOut ? -Math.abs(quotient) : Math.abs(quotient));
    },
    description: 'Division fixup: applies IEEE special cases to a quotient. src0 = quotient, src1 = denominator, src2 = numerator.\nvdst = divFixup(src0, src1, src2)',
    syntax: 'v_div_fixup_f32 vdst, src0, src1, src2',
  },
  {
    mnemonic: 'v_div_fmas_f32',
    format: InstructionFormat.VOP3,
    opcode: 0x16F,
    operandCount: 4,
    execute: (a, b, c) => asFloat(a * (b ?? 0) + (c ?? 0)),
    description: 'Division FMA with scale: if VCC[lane] is set the result is scaled by 2^32 (set up by v_div_scale_f32).\nvdst = VCC[lane] ? 2^32 × (src0 × src1 + src2) : src0 × src1 + src2',
    syntax: 'v_div_fmas_f32 vdst, src0, src1, src2',
    readsVCC: true,
  },
  // 64-bit float arithmetic (register pairs)
  {
    mnemonic: 'v_fma_f64',
    format: InstructionFormat.VOP3,
    opcode: 0x14C,
    operandCount: 4,
    execute: (a, b, c) => fmaF64(a, b ?? 0, c ?? 0),
    description: 'Fused multiply-add of 64-bit floats with a single rounding.\nvdst[0:1] = src0[0:1] × src1[0:1] + src2[0:1]',
    syntax: 'v_fma_f64 vdst[0:1], src0[0:1], src1[0:1], src2[0:1]',
    types: { d: 'f64', s: ['f64', 'f64', 'f64'] },
  },
  {
    mnemonic: 'v_add_f64',
    format: InstructionFormat.VOP3,
    opcode: 0x164,
    operandCount: 3,
    execute: (a, b) => a + (b ?? 0),
    description: 'Add two 64-bit floats.\nvdst[0:1] = src0[0:1] + src1[0:1]',
    syntax: 'v_add_f64 vdst[0:1], src0[0:1], src1[0:1]',
    types: { d: 'f64', s: ['f64', 'f64'] },
  },
  {
    mnemonic: 'v_mul_f64',
    format: InstructionFormat.VOP3,
    opcode: 0x165,
    operandCount: 3,
    execute: (a, b) => a * (b ?? 0),
    description: 'Multiply two 64-bit floats.\nvdst[0:1] = src0[0:1] × src1[0:1]',
    syntax: 'v_mul_f64 vdst[0:1], src0[0:1], src1[0:1]',
    types: { d: 'f64', s: ['f64', 'f64'] },
  },
  {
    mnemonic: 'v_min_f64',
    format: InstructionFormat.VOP3,
    opcode: 0x166,
    operandCount: 3,
    execute: (a, b) => fmin(a, b ?? 0),
    description: 'Minimum of two 64-bit floats. If one input is NaN the other is returned; -0 is less than +0.\nvdst[0:1] = min(src0[0:1], src1[0:1])',
    syntax: 'v_min_f64 vdst[0:1], src0[0:1], src1[0:1]',
    types: { d: 'f64', s: ['f64', 'f64'] },
  },
  {
    mnemonic: 'v_max_f64',
    format: InstructionFormat.VOP3,
    opcode: 0x167,
    operandCount: 3,
    execute: (a, b) => fmax(a, b ?? 0),
    description: 'Maximum of two 64-bit floats. If one input is NaN the other is returned; +0 is greater than -0.\nvdst[0:1] = max(src0[0:1], src1[0:1])',
    syntax: 'v_max_f64 vdst[0:1], src0[0:1], src1[0:1]',
    types: { d: 'f64', s: ['f64', 'f64'] },
  },
  {
    mnemonic: 'v_ldexp_f64',
    format: InstructionFormat.VOP3,
    opcode: 0x168,
    operandCount: 3,
    execute: (a, b) => ldexpF64(a, (b ?? 0) | 0),
    description: 'Multiply a 64-bit float by a power of two given as a signed integer; a subnormal result is rounded once.\nvdst[0:1] = src0[0:1] × 2^src1',
    syntax: 'v_ldexp_f64 vdst[0:1], src0[0:1], src1',
    types: { d: 'f64', s: ['f64', 'b32'] },
  },
  {
    mnemonic: 'v_trig_preop_f64',
    format: InstructionFormat.VOP3,
    opcode: 0x174,
    operandCount: 3,
    execute: (a, b) => trigPreopF64(a, b ?? 0),
    description: 'Look up 53 bits of 2/π for the argument reduction of sin and cos: segment src1[4:0] starts at fractional bit ' +
      '53 × src1, moved further right by how far src0\'s exponent exceeds 1077. The bits are returned at their place value ' +
      '(rounded to nearest even when they fall in the subnormal range; for exponents of 1968 or more the result is scaled up by 2^128).\nvdst[0:1] = 2/π bits [53 × src1 …] for src0[0:1]',
    syntax: 'v_trig_preop_f64 vdst[0:1], src0[0:1], src1',
    types: { d: 'f64', s: ['f64', 'b32'] },
  },
  {
    mnemonic: 'v_div_scale_f64',
    format: InstructionFormat.VOP3,
    opcode: 0x16E,
    operandCount: 5,
    execute: (a, b, c) => divScaleF64(a, b ?? 0, c ?? 0).value,
    description: 'Division setup (src1 = denominator, src2 = numerator, src0 = the one to scale): scale src0 by 2^±128 where needed so the ' +
      'Newton-Raphson steps avoid subnormals, and set the lane\'s bit of sdst when v_div_fmas_f64 must rescale the quotient. ' +
      'A zero numerator or denominator gives NaN with the bit set.\nvdst[0:1] = scaled src0[0:1]',
    syntax: 'v_div_scale_f64 vdst[0:1], sdst, src0[0:1], src1[0:1], src2[0:1]',
    types: { d: 'f64', s: ['f64', 'f64', 'f64'] },
    vop3b: true,
    writesVCC: true,
  },
  {
    mnemonic: 'v_div_fmas_f64',
    format: InstructionFormat.VOP3,
    opcode: 0x170,
    operandCount: 4,
    execute: (a, b, c) => fmaF64(a, b ?? 0, c ?? 0),
    description: 'Division FMA: src0 × src1 + src2 with a single rounding. When the lane\'s VCC bit is set (by v_div_scale_f64) ' +
      'the result is also rescaled before rounding: by 2^128 if |src2| ≥ 2, otherwise by 2^-128.\n' +
      'vdst[0:1] = VCC[lane] ? 2^±128 × (src0 × src1 + src2) : src0 × src1 + src2',
    syntax: 'v_div_fmas_f64 vdst[0:1], src0[0:1], src1[0:1], src2[0:1]',
    types: { d: 'f64', s: ['f64', 'f64', 'f64'] },
    readsVCC: true,
  },
  {
    mnemonic: 'v_div_fixup_f64',
    format: InstructionFormat.VOP3,
    opcode: 0x160,
    operandCount: 4,
    execute: (a, b, c) => bitsToF64(divFixupF64(f64ToBits(a), f64ToBits(b ?? 0), f64ToBits(c ?? 0))),
    description: 'Division fixup (src0 = quotient, src1 = denominator, src2 = numerator): give the quotient the sign of ' +
      'numerator / denominator and handle the special cases: NaN, 0/0 and ∞/∞ (NaN), x/0 and ∞/y (±∞), x/∞ and 0/y (±0), ' +
      'underflow (±0) and an overflowed quotient (±∞).\nvdst[0:1] = fixup(src0[0:1], src1[0:1], src2[0:1])',
    syntax: 'v_div_fixup_f64 vdst[0:1], src0[0:1], src1[0:1], src2[0:1]',
    types: { d: 'f64', s: ['f64', 'f64', 'f64'] },
  },
  {
    mnemonic: 'v_msad_u8',
    format: InstructionFormat.VOP3,
    opcode: 0x171,
    operandCount: 4,
    execute: (a, b, c) => msadU8(a, b ?? 0, c ?? 0),
    description: 'Masked sum of absolute differences: bytes where the reference (src1) is 0 are skipped.\nvdst = Σ(src1[i]!=0 ? |src0[i]-src1[i]| : 0) + src2',
    syntax: 'v_msad_u8 vdst, src0, src1, src2',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_qsad_pk_u16_u8',
    format: InstructionFormat.VOP3,
    opcode: 0x172,
    operandCount: 4,
    execute: (a, b, c) => sadU8(a, b ?? 0, c ?? 0) & 0xFFFF,
    description: 'Sums of absolute byte differences between src1 and four sliding 32-bit windows of the 64-bit src0, each added to one 16-bit field of src2.\nvdst[16k+15:16k] = sad(src0[8k+31:8k], src1) + src2[16k+15:16k], k = 0..3',
    syntax: 'v_qsad_pk_u16_u8 v[vdst:vdst+1], v[src0:src0+1], src1, v[src2:src2+1]',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mqsad_pk_u16_u8',
    format: InstructionFormat.VOP3,
    opcode: 0x173,
    operandCount: 4,
    execute: (a, b, c) => msadU8(a, b ?? 0, c ?? 0) & 0xFFFF,
    description: 'Like v_qsad_pk_u16_u8, but bytes where src1 is zero are skipped (masked SAD).\nvdst[16k+15:16k] = msad(src0[8k+31:8k], src1) + src2[16k+15:16k], k = 0..3',
    syntax: 'v_mqsad_pk_u16_u8 v[vdst:vdst+1], v[src0:src0+1], src1, v[src2:src2+1]',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mqsad_u32_u8',
    format: InstructionFormat.VOP3,
    opcode: 0x175,
    operandCount: 4,
    execute: (a, b, c) => msadU8(a, b ?? 0, c ?? 0),
    description: 'Like v_mqsad_pk_u16_u8, but each masked SAD is added to a 32-bit field of the 128-bit src2, giving a 128-bit result.\nvdst[32k+31:32k] = msad(src0[8k+31:8k], src1) + src2[32k+31:32k], k = 0..3',
    syntax: 'v_mqsad_u32_u8 v[vdst:vdst+3], v[src0:src0+1], src1, v[src2:src2+3]',
    isIntegerOp: true,
  },
  {
    mnemonic: 'v_mad_u64_u32',
    format: InstructionFormat.VOP3,
    opcode: 0x176,
    operandCount: 5,
    execute: (a, b, c) => {
      const result = BigInt(a >>> 0) * BigInt((b ?? 0) >>> 0) + BigInt((c ?? 0) >>> 0);
      return Number(result & 0xFFFFFFFFn) >>> 0;
    },
    description: 'Multiply-add producing a 64-bit result and a carry-out.\n{sdst[lane], vdst[0:1]} = (u64)src0 × (u64)src1 + src2[0:1]',
    syntax: 'v_mad_u64_u32 v[vdst:vdst+1], vcc_lo, src0, src1, v[src2:src2+1]',
    isIntegerOp: true,
    writesVCC: true,
    vop3b: true,
  },
  {
    mnemonic: 'v_mad_i64_i32',
    format: InstructionFormat.VOP3,
    opcode: 0x177,
    operandCount: 5,
    execute: (a, b, c) => {
      const result = BigInt(a | 0) * BigInt((b ?? 0) | 0) + BigInt((c ?? 0) | 0);
      return Number(result & 0xFFFFFFFFn) >>> 0;
    },
    description: 'Signed multiply-add producing a 64-bit result and a carry-out.\n{sdst[lane], vdst[0:1]} = (i64)src0 × (i64)src1 + src2[0:1]',
    syntax: 'v_mad_i64_i32 v[vdst:vdst+1], vcc_lo, src0, src1, v[src2:src2+1]',
    isIntegerOp: true,
    writesVCC: true,
    vop3b: true,
  },
  {
    mnemonic: 'v_permlane16_b32',
    format: InstructionFormat.VOP3,
    opcode: 0x377,
    operandCount: 4,
    execute: (a) => a,
    description: 'Gather within each 16-lane row: lane i reads vsrc0 from lane sel[i] of its own row. The 64-bit lane-select {ssrc2, ssrc1} holds a 4-bit index per lane.\nfi:1 fetches inactive lanes, bound_ctrl:1 reads 0 instead of skipping the write.',
    syntax: 'v_permlane16_b32 vdst, vsrc0, ssrc1, ssrc2',
    isIntegerOp: true,
  },
];

// ── VOPC compares ──
// Every GFX10 compare is generated from the tables below. Within a family the opcode is the family base
// plus the condition's truth table (its position in FLOAT_CONDITIONS / INT_CONDITIONS), and the
// v_cmpx_* form of a compare is its v_cmp_* opcode + 0x10.

/** Float conditions in opcode order; each position is a truth table: bit 0 less, 1 equal, 2 greater, 3 unordered. */
const FLOAT_CONDITIONS: CompareOp[] = ['f', 'lt', 'eq', 'le', 'gt', 'lg', 'ge', 'o', 'u', 'nge', 'nlg', 'ngt', 'nle', 'neq', 'nlt', 'tru'];
/** Integer conditions in opcode order, with the same truth-table bits (integers are never unordered). */
const INT_CONDITIONS: CompareOp[] = ['f', 'lt', 'eq', 'le', 'gt', 'ne', 'ge', 't'];

const COMPARE_TRUTH = new Map<CompareOp, number>([
  ...FLOAT_CONDITIONS.map((op, i): [CompareOp, number] => [op, i]),
  ['ne', 5],
  ['t', 7],
]);

/** How two compare operands are ordered: 0 = less, 1 = equal, 2 = greater, 3 = unordered (a NaN). */
export function compareOrder(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return 3;
  return a < b ? 0 : a === b ? 1 : 2;
}

/** Does a compare condition hold for operands in the given order (see compareOrder)? */
export function compareHolds(op: CompareOp, order: number): boolean {
  return (((COMPARE_TRUTH.get(op) ?? 0) >> order) & 1) === 1;
}

/** Exponent and mantissa widths of the floating-point formats. */
const FLOAT_FIELDS = { f16: [5, 10], f32: [8, 23], f64: [11, 52] } as const;

/**
 * IEEE class of a float's bit pattern, as its bit in the v_cmp_class mask: 0 signaling NaN, 1 quiet NaN,
 * 2 -infinity, 3 -normal, 4 -denormal, 5 -0, 6 +0, 7 +denormal, 8 +normal, 9 +infinity.
 */
export function floatClass(bits: bigint, format: 'f16' | 'f32' | 'f64'): number {
  const [expBits, mantBits] = FLOAT_FIELDS[format];
  const mant = bits & ((1n << BigInt(mantBits)) - 1n);
  const exp = Number((bits >> BigInt(mantBits)) & BigInt((1 << expBits) - 1));
  const negative = ((bits >> BigInt(expBits + mantBits)) & 1n) === 1n;
  if (exp === (1 << expBits) - 1) {
    if (mant === 0n) return negative ? 2 : 9;
    return ((mant >> BigInt(mantBits - 1)) & 1n) === 1n ? 1 : 0; // the top mantissa bit marks a quiet NaN
  }
  if (exp === 0) return mant === 0n ? (negative ? 5 : 6) : (negative ? 4 : 7);
  return negative ? 3 : 8;
}

/** [compare type, its conditions, opcode of truth table 0]: every v_cmp_* family except the class tests. */
const COMPARE_FAMILIES: Array<[CompareType, CompareOp[], number]> = [
  ['f32', FLOAT_CONDITIONS, 0x00],
  ['f64', FLOAT_CONDITIONS, 0x20],
  ['i32', INT_CONDITIONS, 0x80],
  ['i16', INT_CONDITIONS.slice(1, 7), 0x88],
  ['i64', INT_CONDITIONS, 0xA0],
  ['u16', INT_CONDITIONS.slice(1, 7), 0xA8],
  ['u32', INT_CONDITIONS, 0xC0],
  ['f16', FLOAT_CONDITIONS.slice(0, 8), 0xC8],
  ['f16', FLOAT_CONDITIONS.slice(8), 0xE0],
  ['u64', INT_CONDITIONS, 0xE0],
];

/** v_cmp_class_* opcodes. */
const CLASS_COMPARES: Array<[CompareType, number]> = [['f32', 0x88], ['f16', 0x8F], ['f64', 0xA8]];

/** Value type of a compare source (32-bit integers are raw bits; the condition reads them signed or unsigned). */
const COMPARE_SOURCE: Record<CompareType, ValueType> = {
  f16: 'f16', f32: 'f32', f64: 'f64', i16: 'i16', u16: 'u16', i32: 'b32', u32: 'b32', i64: 'i64', u64: 'u64',
};

const COMPARE_TYPE_TEXT: Record<CompareType, string> = {
  f16: '16-bit floats', f32: '32-bit floats', f64: '64-bit floats (register pairs)',
  i16: 'signed 16-bit integers', u16: 'unsigned 16-bit integers',
  i32: 'signed 32-bit integers', u32: 'unsigned 32-bit integers',
  i64: 'signed 64-bit integers (register pairs)', u64: 'unsigned 64-bit integers (register pairs)',
};

/** When each condition holds, in words, and as a formula ('' = never or always). */
const CONDITION_TEXT: Record<Exclude<CompareOp, 'class'>, [string, string]> = {
  f: ['', '0'],
  lt: ['src0 < src1', 'src0 < src1'],
  eq: ['src0 == src1', 'src0 == src1'],
  le: ['src0 <= src1', 'src0 <= src1'],
  gt: ['src0 > src1', 'src0 > src1'],
  lg: ['src0 < src1 or src0 > src1', 'src0 <> src1'],
  ge: ['src0 >= src1', 'src0 >= src1'],
  o: ['neither source is NaN', '!isnan(src0) && !isnan(src1)'],
  u: ['either source is NaN', 'isnan(src0) || isnan(src1)'],
  nge: ['src0 < src1 or either is NaN', '!(src0 >= src1)'],
  nlg: ['src0 == src1 or either is NaN', '!(src0 <> src1)'],
  ngt: ['src0 <= src1 or either is NaN', '!(src0 > src1)'],
  nle: ['src0 > src1 or either is NaN', '!(src0 <= src1)'],
  neq: ['src0 != src1 or either is NaN', '!(src0 == src1)'],
  nlt: ['src0 >= src1 or either is NaN', '!(src0 < src1)'],
  tru: ['', '1'],
  ne: ['src0 != src1', 'src0 != src1'],
  t: ['', '1'],
};

const CLASS_BITS = 'Class bits of src1: 0 signaling NaN, 1 quiet NaN, 2 -infinity, 3 -normal, 4 -denormal, 5 -0, ' +
  '6 +0, 7 +denormal, 8 +normal, 9 +infinity.';

function compareDescription(type: CompareType, op: CompareOp, cmpx: boolean): string {
  const mask = cmpx ? 'EXEC' : 'VCC';
  const pair = (formula: string, sources: RegExp) => (type.endsWith('64') ? formula.replace(sources, '$1[0:1]') : formula);
  if (op === 'class') {
    const what = type === 'f64' ? 'a 64-bit float (register pair)' : `a ${type === 'f16' ? '16' : '32'}-bit float`;
    const result = cmpx ? 'keep each active lane where src1 has the bit for its class and turn the others off'
      : `set the ${mask} bit of each active lane where src1 has the bit for its class`;
    return `Test the class of src0, ${what}, against the mask in src1${cmpx ? ' and write EXEC' : ''}: ${result}.\n` +
      `${mask}[lane] = (src1 >> class(${pair('src0', /(src0)/)})) & 1\n${CLASS_BITS}`;
  }
  const [when, formula] = CONDITION_TEXT[op];
  const types = COMPARE_TYPE_TEXT[type];
  let first: string;
  if (!when) {
    const always = formula === '1';
    first = cmpx
      ? `Always-${always ? 'true' : 'false'} compare of ${types} that writes EXEC: ${always ? 'every active lane stays on' : 'turns every lane off'}.`
      : `Always-${always ? 'true' : 'false'} compare of ${types}: ${always ? 'sets the VCC bit of every active lane' : 'clears every VCC bit'}.`;
  } else {
    const nan = type.startsWith('f') && ['lt', 'eq', 'le', 'gt', 'lg', 'ge'].includes(op) ? ' (false if either is NaN)' : '';
    first = cmpx
      ? `Compare two ${types} and write EXEC: keep each active lane where ${when}${nan} and turn the others off.`
      : `Compare two ${types}: set the VCC bit of each active lane where ${when}${nan}.`;
  }
  return `${first}\n${mask}[lane] = ${pair(formula, /(src[01])/g)}`;
}

/** Semantics for 16- and 32-bit sources: typed values, or for the class tests src0's raw bits and the mask. */
function compareExecute(type: CompareType, op: CompareOp): SemanticFn {
  if (op === 'class') {
    const format = type as 'f16' | 'f32' | 'f64';
    return (a, b) => ((b ?? 0) >>> floatClass(BigInt(a >>> 0), format)) & 1;
  }
  const norm = type === 'i32' ? (v: number) => v | 0 : type === 'u32' ? (v: number) => v >>> 0 : (v: number) => v;
  return (a, b) => (compareHolds(op, compareOrder(norm(a), norm(b ?? 0))) ? 1 : 0);
}

function compareEntry(type: CompareType, op: CompareOp, opcode: number, cmpx: boolean): OpcodeInfo {
  const mnemonic = `v_cmp${cmpx ? 'x' : ''}_${op}_${type}`;
  const src = COMPARE_SOURCE[type];
  const wide = type.endsWith('64');
  return {
    mnemonic,
    format: InstructionFormat.VOPC,
    opcode,
    operandCount: 2,
    execute: compareExecute(type, op),
    description: compareDescription(type, op, cmpx),
    syntax: `${mnemonic} src0${wide ? '[0:1]' : ''}, vsrc1${wide && op !== 'class' ? '[0:1]' : ''}`,
    types: { d: 'b32', s: [src, op === 'class' ? 'b32' : src] },
    compare: { type, op },
    ...(cmpx ? {} : { writesVCC: true }),
  };
}

const VOPC_OPCODES: OpcodeInfo[] = [];
for (const [type, ops, base] of COMPARE_FAMILIES) {
  for (const op of ops) {
    const opcode = base + (COMPARE_TRUTH.get(op) ?? 0);
    VOPC_OPCODES.push(compareEntry(type, op, opcode, false), compareEntry(type, op, opcode + 0x10, true));
  }
}
for (const [type, opcode] of CLASS_COMPARES) {
  VOPC_OPCODES.push(compareEntry(type, 'class', opcode, false), compareEntry(type, 'class', opcode + 0x10, true));
}
VOPC_OPCODES.sort((a, b) => a.opcode - b.opcode);

// ── SOP1 Instructions (scalar, 1-source) ──
// Semantics follow the GFX10 ISA. SCC is written only by instructions that the ISA says write it.

/** SOP1 opcodes whose behaviour (EXEC, PC or M0-relative access) is implemented in the executor. */
function sop1Special(mnemonic: string, opcode: number, operandCount: number, description: string, syntax: string): OpcodeInfo {
  return { mnemonic, format: InstructionFormat.SOP1, opcode, operandCount, execute: (a) => a, description, syntax };
}

const SOP1 = InstructionFormat.SOP1;

const SOP1_OPCODES: OpcodeInfo[] = [
  scalarOp(SOP1, 's_mov_b32', 0x03, 2, [32, 32, 0], (a) => a, undefined,
    'Copy a 32-bit scalar value into the destination SGPR.\nsdst = ssrc0', 's_mov_b32 sdst, ssrc0'),
  scalarOp(SOP1, 's_mov_b64', 0x04, 2, [64, 64, 0], (a) => a, undefined,
    'Copy a 64-bit scalar value (register pair).\nsdst[0:1] = ssrc0[0:1]', 's_mov_b64 sdst, ssrc0'),
  scalarOp(SOP1, 's_cmov_b32', 0x05, 2, [32, 32, 0], (a, _b, ctx) => (ctx.scc ? a : undefined), undefined,
    'Conditional move: if SCC==1, sdst = ssrc0; else sdst unchanged.\nsdst = SCC ? ssrc0 : sdst', 's_cmov_b32 sdst, ssrc0'),
  scalarOp(SOP1, 's_cmov_b64', 0x06, 2, [64, 64, 0], (a, _b, ctx) => (ctx.scc ? a : undefined), undefined,
    'Conditional move 64-bit: if SCC==1, sdst = ssrc0; else sdst unchanged.\nsdst[0:1] = SCC ? ssrc0[0:1] : sdst[0:1]', 's_cmov_b64 sdst, ssrc0'),
  scalarOp(SOP1, 's_not_b32', 0x07, 2, [32, 32, 0], (a) => ~a & M32, SCC_NZ,
    'Scalar bitwise NOT (32-bit). SCC = (result != 0).\nsdst = ~ssrc0', 's_not_b32 sdst, ssrc0'),
  scalarOp(SOP1, 's_not_b64', 0x08, 2, [64, 64, 0], (a) => ~a & M64, SCC_NZ,
    'Scalar bitwise NOT (64-bit). SCC = (result != 0).\nsdst[0:1] = ~ssrc0[0:1]', 's_not_b64 sdst, ssrc0'),
  scalarOp(SOP1, 's_wqm_b32', 0x09, 2, [32, 32, 0], (a) => wqm(a, 32), SCC_NZ,
    'Whole Quad Mode (32-bit): for each group of 4 bits, if any bit is set, set all 4. SCC = (result != 0).\nsdst = WQM(ssrc0)', 's_wqm_b32 sdst, ssrc0'),
  scalarOp(SOP1, 's_wqm_b64', 0x0A, 2, [64, 64, 0], (a) => wqm(a, 64), SCC_NZ,
    'Whole Quad Mode (64-bit): for each group of 4 bits, if any bit is set, set all 4. SCC = (result != 0).\nsdst[0:1] = WQM(ssrc0[0:1])', 's_wqm_b64 sdst, ssrc0'),
  scalarOp(SOP1, 's_brev_b32', 0x0B, 2, [32, 32, 0], (a) => reverseBits(a, 32), undefined,
    'Scalar bit reverse (32-bit).\nsdst = reverse_bits(ssrc0)', 's_brev_b32 sdst, ssrc0'),
  scalarOp(SOP1, 's_brev_b64', 0x0C, 2, [64, 64, 0], (a) => reverseBits(a, 64), undefined,
    'Scalar bit reverse (64-bit).\nsdst[0:1] = reverse_bits(ssrc0[0:1])', 's_brev_b64 sdst, ssrc0'),
  scalarOp(SOP1, 's_bcnt1_i32_b32', 0x0F, 2, [32, 32, 0], (a) => popcount64(a), SCC_NZ,
    'Count set bits (popcount) of a 32-bit value. SCC = (result != 0).\nsdst = countBits(ssrc0)', 's_bcnt1_i32_b32 sdst, ssrc0'),
  scalarOp(SOP1, 's_ff1_i32_b32', 0x13, 2, [32, 32, 0], (a) => {
    for (let i = 0n; i < 32n; i++) if ((a >> i) & 1n) return i;
    return M32;
  }, undefined,
  'Find the first set bit from the LSB of a 32-bit value (-1 if none).\nsdst = findFirstOne(ssrc0)', 's_ff1_i32_b32 sdst, ssrc0'),
  scalarOp(SOP1, 's_ff1_i32_b64', 0x14, 2, [32, 64, 0], (a) => {
    for (let i = 0n; i < 64n; i++) if ((a >> i) & 1n) return i;
    return M32;
  }, undefined,
  'Find the first set bit from the LSB of a 64-bit value (-1 if none).\nsdst = findFirstOne(ssrc0[0:1])', 's_ff1_i32_b64 sdst, ssrc0'),
  scalarOp(SOP1, 's_flbit_i32_b32', 0x15, 2, [32, 32, 0], (a) => {
    for (let i = 0n; i < 32n; i++) if ((a >> (31n - i)) & 1n) return i;
    return M32;
  }, undefined,
  'Count the zeros before the first set bit, starting from the MSB (-1 if none).\nsdst = countLeadingZeros(ssrc0)', 's_flbit_i32_b32 sdst, ssrc0'),
  sop1Special('s_getpc_b64', 0x1F, 1,
    'Get program counter: stores the byte address of the next instruction into an SGPR pair.\nsdst[0:1] = PC + 4', 's_getpc_b64 sdst'),
  sop1Special('s_setpc_b64', 0x20, 1,
    'Set program counter: jump to the byte address held in an SGPR pair.\nPC = ssrc0[0:1]', 's_setpc_b64 ssrc0'),
  sop1Special('s_swappc_b64', 0x21, 2,
    'Swap program counter: save the return address and jump (function call).\nsdst[0:1] = PC + 4; PC = ssrc0[0:1]', 's_swappc_b64 sdst, ssrc0'),
  sop1Special('s_and_saveexec_b64', 0x24, 2,
    'Save EXEC to sdst, then AND ssrc0 into EXEC. SCC = (EXEC != 0).\nsdst[0:1] = EXEC; EXEC &= ssrc0[0:1]', 's_and_saveexec_b64 sdst, ssrc0'),
  sop1Special('s_or_saveexec_b64', 0x25, 2,
    'Save EXEC to sdst, then OR ssrc0 into EXEC. SCC = (EXEC != 0).\nsdst[0:1] = EXEC; EXEC |= ssrc0[0:1]', 's_or_saveexec_b64 sdst, ssrc0'),
  sop1Special('s_movrels_b32', 0x2E, 2,
    'Move from SGPR with relative source.\nsdst = s[ssrc0 + M0]', 's_movrels_b32 sdst, ssrc0'),
  sop1Special('s_movrels_b64', 0x2F, 2,
    'Move from SGPR pair with relative source (64-bit).\nsdst[0:1] = s[ssrc0 + M0 : ssrc0 + M0 + 1]', 's_movrels_b64 sdst, ssrc0'),
  sop1Special('s_movreld_b32', 0x30, 2,
    'Move to SGPR with relative destination.\ns[sdst + M0] = ssrc0', 's_movreld_b32 sdst, ssrc0'),
  sop1Special('s_movreld_b64', 0x31, 2,
    'Move to SGPR pair with relative destination (64-bit).\ns[sdst + M0 : sdst + M0 + 1] = ssrc0[0:1]', 's_movreld_b64 sdst, ssrc0'),
  scalarOp(SOP1, 's_abs_i32', 0x34, 2, [32, 32, 0], (a) => {
    const s = sext32(a);
    return (s < 0n ? -s : s) & M32;
  }, SCC_NZ,
  'Scalar absolute value (signed 32-bit; 0x80000000 stays 0x80000000). SCC = (result != 0).\nsdst = abs(ssrc0)', 's_abs_i32 sdst, ssrc0'),
  scalarOp(SOP1, 's_bitreplicate_b64_b32', 0x3B, 2, [64, 32, 0], (a) => {
    let r = 0n;
    for (let i = 0n; i < 32n; i++) if ((a >> i) & 1n) r |= 3n << (2n * i);
    return r;
  }, undefined,
  'Replicate each of the 32 bits of ssrc0 into 2 adjacent bits of a 64-bit result (quad mask → pixel mask).\nsdst[0:1] = bitreplicate(ssrc0)', 's_bitreplicate_b64_b32 sdst, ssrc0'),
  sop1Special('s_and_saveexec_b32', 0x3C, 2,
    'Save EXEC_LO to sdst, then AND ssrc0 into EXEC_LO. SCC = (EXEC_LO != 0).\nsdst = EXEC_LO; EXEC_LO &= ssrc0', 's_and_saveexec_b32 sdst, ssrc0'),
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
    description: 'End the shader program. Execution stops at this instruction.\nEvery program must finish by executing s_endpgm: running past the last instruction is a crash.',
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
    mnemonic: 's_cbranch_vccz',
    format: InstructionFormat.SOPP,
    opcode: 0x06,
    operandCount: 0,
    execute: () => 0,
    description: 'Conditional branch if VCC == 0.',
    syntax: 's_cbranch_vccz simm16',
  },
  {
    mnemonic: 's_cbranch_execnz',
    format: InstructionFormat.SOPP,
    opcode: 0x09,
    operandCount: 0,
    execute: () => 0,
    description: 'Conditional branch if EXEC != 0.',
    syntax: 's_cbranch_execnz simm16',
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

const SOP2 = InstructionFormat.SOP2;
const signBit32 = (v: bigint) => (v >> 31n) & 1n;

/** Signed bit-field extract: sign-extend the low `width` bits (width 0 → 0, ≥ total → unchanged). */
function bfeSigned(value: bigint, width: bigint, total: number): bigint {
  if (width === 0n) return 0n;
  if (width >= BigInt(total)) return value;
  return BigInt.asIntN(Number(width), value);
}

const SOP2_OPCODES: OpcodeInfo[] = [
  scalarOp(SOP2, 's_add_u32', 0x00, 3, [32, 32, 32], (a, b) => (a + b) & M32, (a, b) => a + b > M32,
    'Scalar add unsigned 32-bit. SCC = carry-out.\nsdst = ssrc0 + ssrc1; SCC = unsigned overflow', 's_add_u32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_sub_u32', 0x01, 3, [32, 32, 32], (a, b) => (a - b) & M32, (a, b) => b > a,
    'Scalar subtract unsigned 32-bit. SCC = borrow-out.\nsdst = ssrc0 - ssrc1; SCC = (ssrc1 > ssrc0)', 's_sub_u32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_add_i32', 0x02, 3, [32, 32, 32], (a, b) => (a + b) & M32,
    (a, b, d) => signBit32(a) === signBit32(b) && signBit32(a) !== signBit32(d),
    'Scalar add signed 32-bit. SCC = signed overflow.\nsdst = ssrc0 + ssrc1', 's_add_i32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_sub_i32', 0x03, 3, [32, 32, 32], (a, b) => (a - b) & M32,
    (a, b, d) => signBit32(a) !== signBit32(b) && signBit32(a) !== signBit32(d),
    'Scalar subtract signed 32-bit. SCC = signed overflow.\nsdst = ssrc0 - ssrc1', 's_sub_i32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_addc_u32', 0x04, 3, [32, 32, 32], (a, b, ctx) => (a + b + BigInt(ctx.scc)) & M32,
    (a, b, _d, ctx) => a + b + BigInt(ctx.scc) > M32,
    'Scalar add with carry (SCC is carry-in and carry-out).\nsdst = ssrc0 + ssrc1 + SCC', 's_addc_u32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_subb_u32', 0x05, 3, [32, 32, 32], (a, b, ctx) => (a - b - BigInt(ctx.scc)) & M32,
    (a, b, _d, ctx) => b + BigInt(ctx.scc) > a,
    'Scalar subtract with borrow (SCC is borrow-in and borrow-out).\nsdst = ssrc0 - ssrc1 - SCC', 's_subb_u32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_min_i32', 0x06, 3, [32, 32, 32], (a, b) => (sext32(a) < sext32(b) ? a : b), (a, b) => sext32(a) < sext32(b),
    'Scalar signed minimum. SCC = 1 if ssrc0 is selected.\nsdst = min(ssrc0, ssrc1); SCC = (ssrc0 < ssrc1)', 's_min_i32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_min_u32', 0x07, 3, [32, 32, 32], (a, b) => (a < b ? a : b), (a, b) => a < b,
    'Scalar unsigned minimum. SCC = 1 if ssrc0 is selected.\nsdst = min(ssrc0, ssrc1); SCC = (ssrc0 < ssrc1)', 's_min_u32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_max_i32', 0x08, 3, [32, 32, 32], (a, b) => (sext32(a) > sext32(b) ? a : b), (a, b) => sext32(a) > sext32(b),
    'Scalar signed maximum. SCC = 1 if ssrc0 is selected.\nsdst = max(ssrc0, ssrc1); SCC = (ssrc0 > ssrc1)', 's_max_i32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_max_u32', 0x09, 3, [32, 32, 32], (a, b) => (a > b ? a : b), (a, b) => a > b,
    'Scalar unsigned maximum. SCC = 1 if ssrc0 is selected.\nsdst = max(ssrc0, ssrc1); SCC = (ssrc0 > ssrc1)', 's_max_u32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_cselect_b32', 0x0A, 3, [32, 32, 32], (a, b, ctx) => (ctx.scc ? a : b), undefined,
    'Scalar conditional select based on SCC.\nsdst = SCC ? ssrc0 : ssrc1', 's_cselect_b32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_cselect_b64', 0x0B, 3, [64, 64, 64], (a, b, ctx) => (ctx.scc ? a : b), undefined,
    'Scalar conditional select 64-bit based on SCC.\nsdst[0:1] = SCC ? ssrc0[0:1] : ssrc1[0:1]', 's_cselect_b64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_and_b32', 0x0E, 3, [32, 32, 32], (a, b) => a & b, SCC_NZ,
    'Scalar bitwise AND (32-bit). SCC = (result != 0).\nsdst = ssrc0 & ssrc1', 's_and_b32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_and_b64', 0x0F, 3, [64, 64, 64], (a, b) => a & b, SCC_NZ,
    'Scalar bitwise AND (64-bit). SCC = (result != 0).\nsdst[0:1] = ssrc0 & ssrc1', 's_and_b64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_or_b32', 0x10, 3, [32, 32, 32], (a, b) => a | b, SCC_NZ,
    'Scalar bitwise OR (32-bit). SCC = (result != 0).\nsdst = ssrc0 | ssrc1', 's_or_b32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_or_b64', 0x11, 3, [64, 64, 64], (a, b) => a | b, SCC_NZ,
    'Scalar bitwise OR (64-bit). SCC = (result != 0).\nsdst[0:1] = ssrc0 | ssrc1', 's_or_b64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_xor_b32', 0x12, 3, [32, 32, 32], (a, b) => a ^ b, SCC_NZ,
    'Scalar bitwise XOR (32-bit). SCC = (result != 0).\nsdst = ssrc0 ^ ssrc1', 's_xor_b32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_xor_b64', 0x13, 3, [64, 64, 64], (a, b) => a ^ b, SCC_NZ,
    'Scalar bitwise XOR (64-bit). SCC = (result != 0).\nsdst[0:1] = ssrc0 ^ ssrc1', 's_xor_b64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_andn2_b32', 0x14, 3, [32, 32, 32], (a, b) => a & ~b & M32, SCC_NZ,
    'Scalar AND-NOT2 (32-bit). SCC = (result != 0).\nsdst = ssrc0 & ~ssrc1', 's_andn2_b32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_andn2_b64', 0x15, 3, [64, 64, 64], (a, b) => a & ~b & M64, SCC_NZ,
    'Scalar AND-NOT2 (64-bit). SCC = (result != 0).\nsdst[0:1] = ssrc0 & ~ssrc1', 's_andn2_b64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_orn2_b32', 0x16, 3, [32, 32, 32], (a, b) => (a | ~b) & M32, SCC_NZ,
    'Scalar bitwise OR-NOT2 (32-bit). SCC = (result != 0).\nsdst = ssrc0 | ~ssrc1', 's_orn2_b32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_orn2_b64', 0x17, 3, [64, 64, 64], (a, b) => (a | ~b) & M64, SCC_NZ,
    'Scalar bitwise OR-NOT2 (64-bit). SCC = (result != 0).\nsdst[0:1] = ssrc0 | ~ssrc1', 's_orn2_b64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_nand_b32', 0x18, 3, [32, 32, 32], (a, b) => ~(a & b) & M32, SCC_NZ,
    'Scalar bitwise NAND (32-bit). SCC = (result != 0).\nsdst = ~(ssrc0 & ssrc1)', 's_nand_b32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_nand_b64', 0x19, 3, [64, 64, 64], (a, b) => ~(a & b) & M64, SCC_NZ,
    'Scalar bitwise NAND (64-bit). SCC = (result != 0).\nsdst[0:1] = ~(ssrc0 & ssrc1)', 's_nand_b64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_nor_b32', 0x1A, 3, [32, 32, 32], (a, b) => ~(a | b) & M32, SCC_NZ,
    'Scalar bitwise NOR (32-bit). SCC = (result != 0).\nsdst = ~(ssrc0 | ssrc1)', 's_nor_b32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_nor_b64', 0x1B, 3, [64, 64, 64], (a, b) => ~(a | b) & M64, SCC_NZ,
    'Scalar bitwise NOR (64-bit). SCC = (result != 0).\nsdst[0:1] = ~(ssrc0 | ssrc1)', 's_nor_b64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_xnor_b32', 0x1C, 3, [32, 32, 32], (a, b) => ~(a ^ b) & M32, SCC_NZ,
    'Scalar bitwise XNOR (32-bit). SCC = (result != 0).\nsdst = ~(ssrc0 ^ ssrc1)', 's_xnor_b32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_xnor_b64', 0x1D, 3, [64, 64, 64], (a, b) => ~(a ^ b) & M64, SCC_NZ,
    'Scalar bitwise XNOR (64-bit). SCC = (result != 0).\nsdst[0:1] = ~(ssrc0 ^ ssrc1)', 's_xnor_b64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_lshl_b32', 0x1E, 3, [32, 32, 32], (a, b) => (a << (b & 31n)) & M32, SCC_NZ,
    'Scalar left shift (32-bit). SCC = (result != 0).\nsdst = ssrc0 << ssrc1[4:0]', 's_lshl_b32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_lshl_b64', 0x1F, 3, [64, 64, 32], (a, b) => (a << (b & 63n)) & M64, SCC_NZ,
    'Scalar left shift (64-bit). SCC = (result != 0).\nsdst[0:1] = ssrc0[0:1] << ssrc1[5:0]', 's_lshl_b64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_lshr_b32', 0x20, 3, [32, 32, 32], (a, b) => a >> (b & 31n), SCC_NZ,
    'Scalar logical right shift (32-bit). SCC = (result != 0).\nsdst = ssrc0 >> ssrc1[4:0]', 's_lshr_b32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_lshr_b64', 0x21, 3, [64, 64, 32], (a, b) => a >> (b & 63n), SCC_NZ,
    'Scalar logical right shift (64-bit). SCC = (result != 0).\nsdst[0:1] = ssrc0[0:1] >> ssrc1[5:0]', 's_lshr_b64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_ashr_i32', 0x22, 3, [32, 32, 32], (a, b) => (sext32(a) >> (b & 31n)) & M32, SCC_NZ,
    'Scalar arithmetic right shift (32-bit). SCC = (result != 0).\nsdst = (int)ssrc0 >> ssrc1[4:0]', 's_ashr_i32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_ashr_i64', 0x23, 3, [64, 64, 32], (a, b) => (sext64(a) >> (b & 63n)) & M64, SCC_NZ,
    'Scalar arithmetic right shift (64-bit). SCC = (result != 0).\nsdst[0:1] = (int64)ssrc0[0:1] >> ssrc1[5:0]', 's_ashr_i64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_bfm_b32', 0x24, 3, [32, 32, 32], (a, b) => (((1n << (a & 31n)) - 1n) << (b & 31n)) & M32, undefined,
    'Scalar bit field mask (32-bit).\nsdst = ((1 << ssrc0[4:0]) - 1) << ssrc1[4:0]', 's_bfm_b32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_bfm_b64', 0x25, 3, [64, 32, 32], (a, b) => (((1n << (a & 63n)) - 1n) << (b & 63n)) & M64, undefined,
    'Scalar bit field mask (64-bit).\nsdst[0:1] = ((1 << ssrc0[5:0]) - 1) << ssrc1[5:0]', 's_bfm_b64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_mul_i32', 0x26, 3, [32, 32, 32], (a, b) => (sext32(a) * sext32(b)) & M32, undefined,
    'Scalar multiply signed 32-bit (low 32 bits).\nsdst = ssrc0 × ssrc1', 's_mul_i32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_bfe_u32', 0x27, 3, [32, 32, 32], (a, b) => (a >> (b & 31n)) & fieldMask((b >> 16n) & 0x7Fn) & M32, SCC_NZ,
    'Scalar unsigned bit field extract (32-bit). ssrc1[4:0] = offset, ssrc1[22:16] = width. SCC = (result != 0).\nsdst = (ssrc0 >> offset) & ((1 << width) - 1)', 's_bfe_u32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_bfe_i32', 0x28, 3, [32, 32, 32],
    (a, b) => bfeSigned((sext32(a) >> (b & 31n)) & fieldMask((b >> 16n) & 0x7Fn), (b >> 16n) & 0x7Fn, 32) & M32, SCC_NZ,
    'Scalar signed bit field extract (32-bit). ssrc1[4:0] = offset, ssrc1[22:16] = width. SCC = (result != 0).\nsdst = signext((ssrc0 >> offset) & ((1 << width) - 1))', 's_bfe_i32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_bfe_u64', 0x29, 3, [64, 64, 32], (a, b) => (a >> (b & 63n)) & fieldMask((b >> 16n) & 0x7Fn), SCC_NZ,
    'Scalar unsigned bit field extract (64-bit). ssrc1[5:0] = offset, ssrc1[22:16] = width. SCC = (result != 0).\nsdst[0:1] = (ssrc0 >> offset) & ((1 << width) - 1)', 's_bfe_u64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_bfe_i64', 0x2A, 3, [64, 64, 32],
    (a, b) => bfeSigned((sext64(a) >> (b & 63n)) & fieldMask((b >> 16n) & 0x7Fn), (b >> 16n) & 0x7Fn, 64) & M64, SCC_NZ,
    'Scalar signed bit field extract (64-bit). ssrc1[5:0] = offset, ssrc1[22:16] = width. SCC = (result != 0).\nsdst[0:1] = signext((ssrc0 >> offset) & ((1 << width) - 1))', 's_bfe_i64 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_absdiff_i32', 0x2C, 3, [32, 32, 32], (a, b) => {
    const d = sext32(a) - sext32(b);
    return (d < 0n ? -d : d) & M32;
  }, SCC_NZ,
  'Scalar absolute difference of signed 32-bit values. SCC = (result != 0).\nsdst = abs(ssrc0 - ssrc1)', 's_absdiff_i32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_pack_ll_b32_b16', 0x32, 3, [32, 32, 32], (a, b) => ((b & 0xFFFFn) << 16n) | (a & 0xFFFFn), undefined,
    'Pack two low 16-bit values into a 32-bit value.\nsdst = {ssrc1[15:0], ssrc0[15:0]}', 's_pack_ll_b32_b16 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_pack_lh_b32_b16', 0x33, 3, [32, 32, 32], (a, b) => (b & 0xFFFF0000n) | (a & 0xFFFFn), undefined,
    'Pack ssrc0 low 16 and ssrc1 high 16 into a 32-bit value.\nsdst = {ssrc1[31:16], ssrc0[15:0]}', 's_pack_lh_b32_b16 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_pack_hh_b32_b16', 0x34, 3, [32, 32, 32], (a, b) => (b & 0xFFFF0000n) | ((a >> 16n) & 0xFFFFn), undefined,
    'Pack two high 16-bit values into a 32-bit value.\nsdst = {ssrc1[31:16], ssrc0[31:16]}', 's_pack_hh_b32_b16 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_mul_hi_u32', 0x35, 3, [32, 32, 32], (a, b) => ((a * b) >> 32n) & M32, undefined,
    'Scalar multiply high unsigned 32-bit. Returns upper 32 bits of the 64-bit product.\nsdst = (ssrc0 × ssrc1) >> 32', 's_mul_hi_u32 sdst, ssrc0, ssrc1'),
  scalarOp(SOP2, 's_mul_hi_i32', 0x36, 3, [32, 32, 32], (a, b) => ((sext32(a) * sext32(b)) >> 32n) & M32, undefined,
    'Scalar multiply high signed 32-bit. Returns upper 32 bits of the signed 64-bit product.\nsdst = (ssrc0 × ssrc1) >> 32 (signed)', 's_mul_hi_i32 sdst, ssrc0, ssrc1'),
];

// ── SOPC Instructions (scalar compare) ──

const SOPC = InstructionFormat.SOPC;
const NO_DST = () => undefined;

function scmp(mnemonic: string, opcode: number, widths: [ScalarWidth, ScalarWidth], test: (a: bigint, b: bigint) => boolean, description: string): OpcodeInfo {
  return scalarOp(SOPC, mnemonic, opcode, 2, [0, widths[0], widths[1]], NO_DST, (a, b) => test(a, b),
    `${description} Sets SCC.`, `${mnemonic} ssrc0, ssrc1`);
}

const SOPC_OPCODES: OpcodeInfo[] = [
  scmp('s_cmp_eq_i32', 0x00, [32, 32], (a, b) => a === b, 'Scalar compare equal signed 32-bit.\nSCC = (ssrc0 == ssrc1)'),
  scmp('s_cmp_lg_i32', 0x01, [32, 32], (a, b) => a !== b, 'Scalar compare not-equal signed 32-bit.\nSCC = (ssrc0 != ssrc1)'),
  scmp('s_cmp_gt_i32', 0x02, [32, 32], (a, b) => sext32(a) > sext32(b), 'Scalar compare greater-than signed 32-bit.\nSCC = (ssrc0 > ssrc1)'),
  scmp('s_cmp_ge_i32', 0x03, [32, 32], (a, b) => sext32(a) >= sext32(b), 'Scalar compare greater-or-equal signed 32-bit.\nSCC = (ssrc0 >= ssrc1)'),
  scmp('s_cmp_lt_i32', 0x04, [32, 32], (a, b) => sext32(a) < sext32(b), 'Scalar compare less-than signed 32-bit.\nSCC = (ssrc0 < ssrc1)'),
  scmp('s_cmp_le_i32', 0x05, [32, 32], (a, b) => sext32(a) <= sext32(b), 'Scalar compare less-or-equal signed 32-bit.\nSCC = (ssrc0 <= ssrc1)'),
  scmp('s_cmp_eq_u32', 0x06, [32, 32], (a, b) => a === b, 'Scalar compare equal unsigned 32-bit.\nSCC = (ssrc0 == ssrc1)'),
  scmp('s_cmp_lg_u32', 0x07, [32, 32], (a, b) => a !== b, 'Scalar compare not-equal unsigned 32-bit.\nSCC = (ssrc0 != ssrc1)'),
  scmp('s_cmp_gt_u32', 0x08, [32, 32], (a, b) => a > b, 'Scalar compare greater-than unsigned 32-bit.\nSCC = (ssrc0 > ssrc1)'),
  scmp('s_cmp_ge_u32', 0x09, [32, 32], (a, b) => a >= b, 'Scalar compare greater-or-equal unsigned 32-bit.\nSCC = (ssrc0 >= ssrc1)'),
  scmp('s_cmp_lt_u32', 0x0A, [32, 32], (a, b) => a < b, 'Scalar compare less-than unsigned 32-bit.\nSCC = (ssrc0 < ssrc1)'),
  scmp('s_cmp_le_u32', 0x0B, [32, 32], (a, b) => a <= b, 'Scalar compare less-or-equal unsigned 32-bit.\nSCC = (ssrc0 <= ssrc1)'),
  scmp('s_bitcmp0_b32', 0x0C, [32, 32], (a, b) => ((a >> (b & 31n)) & 1n) === 0n, 'Test if bit N of ssrc0 is zero.\nSCC = (ssrc0[ssrc1[4:0]] == 0)'),
  scmp('s_bitcmp1_b32', 0x0D, [32, 32], (a, b) => ((a >> (b & 31n)) & 1n) === 1n, 'Test if bit N of ssrc0 is one.\nSCC = (ssrc0[ssrc1[4:0]] == 1)'),
  scmp('s_bitcmp0_b64', 0x0E, [64, 32], (a, b) => ((a >> (b & 63n)) & 1n) === 0n, 'Test if bit N of the 64-bit ssrc0 is zero.\nSCC = (ssrc0[ssrc1[5:0]] == 0)'),
  scmp('s_bitcmp1_b64', 0x0F, [64, 32], (a, b) => ((a >> (b & 63n)) & 1n) === 1n, 'Test if bit N of the 64-bit ssrc0 is one.\nSCC = (ssrc0[ssrc1[5:0]] == 1)'),
  scmp('s_cmp_eq_u64', 0x12, [64, 64], (a, b) => a === b, 'Scalar compare equal 64-bit.\nSCC = (ssrc0[0:1] == ssrc1[0:1])'),
];

// ── SOPK Instructions (scalar with inline constant) ──
// SOPK reads the destination SGPR as its first source; SIMM16 is the second.

const SOPK = InstructionFormat.SOPK;

function scmpk(mnemonic: string, opcode: number, signed: boolean, test: (a: bigint, b: bigint) => boolean, rel: string): OpcodeInfo {
  const ext = signed ? 'signext' : 'zext';
  return scalarOp(SOPK, mnemonic, opcode, 2, [0, 32, 0], NO_DST, (a, b) => test(a, b),
    `Compare SGPR with ${signed ? 'sign' : 'zero'}-extended 16-bit immediate (${signed ? 'signed' : 'unsigned'}).\nSCC = (sdst ${rel} ${ext}(SIMM16))`,
    `${mnemonic} sdst, simm16`, signed ? 'sext' : 'zext');
}

function sopkSpecial(mnemonic: string, opcode: number, operandCount: number, description: string, syntax: string): OpcodeInfo {
  return { mnemonic, format: SOPK, opcode, operandCount, execute: (a) => a, description, syntax };
}

const SOPK_OPCODES: OpcodeInfo[] = [
  scalarOp(SOPK, 's_movk_i32', 0x00, 2, [32, 0, 0], (_a, k) => k & M32, undefined,
    'Move a 16-bit immediate into an SGPR (sign-extended).\nsdst = signext(SIMM16)', 's_movk_i32 sdst, simm16', 'sext'),
  scmpk('s_cmpk_eq_i32', 0x03, true, (a, b) => sext32(a) === b, '=='),
  scmpk('s_cmpk_lg_i32', 0x04, true, (a, b) => sext32(a) !== b, '!='),
  scmpk('s_cmpk_gt_i32', 0x05, true, (a, b) => sext32(a) > b, '>'),
  scmpk('s_cmpk_ge_i32', 0x06, true, (a, b) => sext32(a) >= b, '>='),
  scmpk('s_cmpk_lt_i32', 0x07, true, (a, b) => sext32(a) < b, '<'),
  scmpk('s_cmpk_le_i32', 0x08, true, (a, b) => sext32(a) <= b, '<='),
  scmpk('s_cmpk_eq_u32', 0x09, false, (a, b) => a === b, '=='),
  scmpk('s_cmpk_lg_u32', 0x0A, false, (a, b) => a !== b, '!='),
  scmpk('s_cmpk_gt_u32', 0x0B, false, (a, b) => a > b, '>'),
  scmpk('s_cmpk_ge_u32', 0x0C, false, (a, b) => a >= b, '>='),
  scmpk('s_cmpk_lt_u32', 0x0D, false, (a, b) => a < b, '<'),
  scmpk('s_cmpk_le_u32', 0x0E, false, (a, b) => a <= b, '<='),
  scalarOp(SOPK, 's_addk_i32', 0x0F, 2, [32, 32, 0], (a, k) => (a + k) & M32,
    (a, k, d) => signBit32(a) === bit(k < 0n) && signBit32(a) !== signBit32(d),
    'Add sign-extended 16-bit immediate to SGPR. SCC = signed overflow.\nsdst = sdst + signext(SIMM16)', 's_addk_i32 sdst, simm16', 'sext'),
  scalarOp(SOPK, 's_mulk_i32', 0x10, 2, [32, 32, 0], (a, k) => (sext32(a) * k) & M32, undefined,
    'Multiply SGPR by sign-extended 16-bit immediate.\nsdst = sdst × signext(SIMM16)', 's_mulk_i32 sdst, simm16', 'sext'),
  sopkSpecial('s_setreg_imm32_b32', 0x15, 2, 'Set hardware register from 32-bit immediate (no effect in the emulator).', 's_setreg_imm32_b32 hwreg, imm32'),
  sopkSpecial('s_waitcnt_vscnt', 0x17, 0, 'Wait for vector store count to reach a specified value (no effect in the emulator).', 's_waitcnt_vscnt null, simm16'),
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
  { mnemonic: 'ds_write_b32', format: InstructionFormat.DS, opcode: 0x0D, operandCount: 2, execute: (a) => a, description: 'Write 32 bits to LDS.\nLDS[vaddr + offset] = vdata', syntax: 'ds_write_b32 vaddr, vdata offset:0' },
  { mnemonic: 'ds_write2st64_b32', format: InstructionFormat.DS, opcode: 0x0F, operandCount: 3, execute: (a) => a, description: 'Write two 32-bit values to LDS with a stride of 64 dwords.\nLDS[vaddr + offset0×256] = vdata0; LDS[vaddr + offset1×256] = vdata1', syntax: 'ds_write2st64_b32 vaddr, vdata0, vdata1 offset0:0 offset1:1' },
  { mnemonic: 'ds_swizzle_b32', format: InstructionFormat.DS, opcode: 0x35, operandCount: 2, execute: (a) => a, description: 'Swizzle data across lanes without touching LDS memory. Reading from an inactive lane returns 0.\noffset[15]=1 (below 0xC000): quad permute; offset[15]=0: and/or/xor lane masks; ≥0xC000: rotate; ≥0xE000: FFT.', syntax: 'ds_swizzle_b32 vdst, vsrc offset:0' },
  { mnemonic: 'ds_read_b32', format: InstructionFormat.DS, opcode: 0x36, operandCount: 2, execute: (a) => a, description: 'Read 32 bits from LDS.\nvdst = LDS[vaddr + offset]', syntax: 'ds_read_b32 vdst, vaddr offset:0' },
  { mnemonic: 'ds_read2st64_b32', format: InstructionFormat.DS, opcode: 0x38, operandCount: 2, execute: (a) => a, description: 'Read two 32-bit values from LDS with a stride of 64 dwords.\nvdst[0] = LDS[vaddr + offset0×256]; vdst[1] = LDS[vaddr + offset1×256]', syntax: 'ds_read2st64_b32 v[vdst:vdst+1], vaddr offset0:0 offset1:1' },
  { mnemonic: 'ds_permute_b32', format: InstructionFormat.DS, opcode: 0xB2, operandCount: 3, execute: (a) => a, description: 'Forward lane permute (no LDS access). Each active lane sends vdata to lane ((vaddr + offset) / 4) % 32; lanes that receive nothing get 0.\nvdst[(vaddr + offset) / 4] = vdata', syntax: 'ds_permute_b32 vdst, vaddr, vdata offset:0' },
  { mnemonic: 'ds_bpermute_b32', format: InstructionFormat.DS, opcode: 0xB3, operandCount: 3, execute: (a) => a, description: 'Backward lane permute (no LDS access). Each lane reads vdata from lane ((vaddr + offset) / 4) % 32; reading an inactive lane returns 0.\nvdst = vdata[(vaddr + offset) / 4]', syntax: 'ds_bpermute_b32 vdst, vaddr, vdata offset:0' },
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
