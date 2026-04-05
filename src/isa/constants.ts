// ── RDNA2 ISA Constants ──
// Source operand encoding ranges and special register indices

// Source operand encoding (9-bit SRC0 field)
export const SGPR_MIN = 0;
export const SGPR_MAX = 105;
export const VCC_LO = 106;
export const VCC_HI = 107;
export const M0_REG = 124;
export const NULL_REG = 125;
export const EXEC_LO = 126;
export const EXEC_HI = 127;

// Inline integer constants
export const INLINE_INT_0 = 128;       // encodes literal 0
export const INLINE_INT_POS_MIN = 129; // encodes literal 1
export const INLINE_INT_POS_MAX = 192; // encodes literal 64
export const INLINE_INT_NEG_MIN = 193; // encodes literal -1
export const INLINE_INT_NEG_MAX = 208; // encodes literal -16

// Inline float constants
export const INLINE_FLOAT_BASE = 240;
export const INLINE_FLOAT_MAP: Record<number, number> = {
  240: 0.5,
  241: -0.5,
  242: 1.0,
  243: -1.0,
  244: 2.0,
  245: -2.0,
  246: 4.0,
  247: -4.0,
};

// Reverse map: float value → encoding
export const FLOAT_TO_INLINE = new Map<number, number>([
  [0.5, 240],
  [-0.5, 241],
  [1.0, 242],
  [-1.0, 243],
  [2.0, 244],
  [-2.0, 245],
  [4.0, 246],
  [-4.0, 247],
]);

// Literal constant marker
export const LITERAL_CONST = 255;

// VGPR range in 9-bit encoding
export const VGPR_SRC_MIN = 256;
export const VGPR_SRC_MAX = 511;

// Register file sizes
export const NUM_VGPRS = 256;
export const NUM_SGPRS = 128;  // Covers user SGPRs (0-105) + VCC(106-107) + M0(124) + EXEC(126-127)
export const WAVE_WIDTH = 32;

// VOP1 encoding marker: bits [31:25] = 0b0111111 = 0x3F
export const VOP1_ENCODING_PREFIX = 0x3F;

// SOPP encoding: bits [31:23] = 0b101111111 = 0x17F
// [22:16] = OP (7 bits), [15:0] = SIMM16 (16 bits)
export const SOPP_ENCODING_PREFIX = 0x17F;
export const SOPP_OP_SHIFT = 16;
export const SOPP_OP_MASK = 0x7F;     // 7 bits

// VOPC encoding marker: bits [31:25] = 0b0111110 = 0x3E
// [24:17] = OP (8 bits), [16:9] = VSRC1 (8 bits), [8:0] = SRC0 (9 bits)
export const VOPC_ENCODING_PREFIX = 0x3E;
export const VOPC_OP_SHIFT = 17;
export const VOPC_OP_MASK = 0xFF;    // 8 bits

// Encoding bit positions
export const VOP2_OP_SHIFT = 25;
export const VOP2_OP_MASK = 0x3F;   // 6 bits
export const VDST_SHIFT = 17;
export const VDST_MASK = 0xFF;      // 8 bits
export const VSRC1_SHIFT = 9;
export const VSRC1_MASK = 0xFF;     // 8 bits
export const SRC0_MASK = 0x1FF;     // 9 bits

export const VOP1_PREFIX_SHIFT = 25;
export const VOP1_PREFIX_MASK = 0x7F; // 7 bits
export const VOP1_OP_SHIFT = 9;
export const VOP1_OP_MASK = 0xFF;    // 8 bits

// SOP1 encoding: bits [31:23] = 0b101111101 = 0x17D
// [22:16] = SDST (7 bits), [15:8] = OP (8 bits), [7:0] = SSRC0 (8 bits)
export const SOP1_ENCODING_PREFIX = 0x17D; // 9 bits
export const SOP1_PREFIX_SHIFT = 23;
export const SOP1_PREFIX_MASK = 0x1FF;   // 9 bits
export const SOP1_SDST_SHIFT = 16;
export const SOP1_SDST_MASK = 0x7F;     // 7 bits
export const SOP1_OP_SHIFT = 8;
export const SOP1_OP_MASK = 0xFF;       // 8 bits
export const SOP1_SSRC0_MASK = 0xFF;    // 8 bits

// VOP3A encoding (64-bit, two dwords):
// Dword 0: [31:26]=0x34 prefix, [25:16]=OP(10), [11]=CLAMP, [10:8]=ABS(3), [7:0]=VDST(8)
// Dword 1: [31:29]=NEG(3), [28:27]=OMOD(2), [26:18]=SRC2(9), [17:9]=SRC1(9), [8:0]=SRC0(9)
export const VOP3_ENCODING_PREFIX = 0x34; // 6 bits
export const VOP3_PREFIX_SHIFT = 26;
export const VOP3_PREFIX_MASK = 0x3F;    // 6 bits
export const VOP3_OP_SHIFT = 16;
export const VOP3_OP_MASK = 0x3FF;       // 10 bits
export const VOP3_CLAMP_BIT = 11;
export const VOP3_ABS_SHIFT = 8;
export const VOP3_ABS_MASK = 0x7;        // 3 bits (src0=bit0, src1=bit1, src2=bit2)
export const VOP3_VDST_MASK = 0xFF;      // 8 bits

// Dword 1 bit positions (relative to dword 1)
export const VOP3_SRC0_MASK = 0x1FF;     // 9 bits [8:0]
export const VOP3_SRC1_SHIFT = 9;
export const VOP3_SRC1_MASK = 0x1FF;     // 9 bits [17:9]
export const VOP3_SRC2_SHIFT = 18;
export const VOP3_SRC2_MASK = 0x1FF;     // 9 bits [26:18]
export const VOP3_OMOD_SHIFT = 27;
export const VOP3_OMOD_MASK = 0x3;       // 2 bits [28:27]
export const VOP3_NEG_SHIFT = 29;
export const VOP3_NEG_MASK = 0x7;        // 3 bits [31:29]

// VOP2→VOP3 opcode offset: VOP3_opcode = VOP2_opcode + 0x100
export const VOP3_VOP2_OFFSET = 0x100;
// VOP1→VOP3 opcode offset: VOP3_opcode = VOP1_opcode + 0x180
export const VOP3_VOP1_OFFSET = 0x180;
// Keep the old name for backward compat (used in encoder for VOP2 promotion)
/** @deprecated Use VOP3_VOP2_OFFSET or VOP3_VOP1_OFFSET */
export { VOP3_VOP2_OFFSET as VOP3_VOP1_OFFSET_LEGACY };

// SOP2 encoding: bits[31:30]=10, [29:23]=OP(7), [22:16]=SDST(7), [15:8]=SSRC1(8), [7:0]=SSRC0(8)
export const SOP2_OP_SHIFT = 23;
export const SOP2_OP_MASK = 0x7F;
export const SOP2_SDST_SHIFT = 16;
export const SOP2_SDST_MASK = 0x7F;
export const SOP2_SSRC1_SHIFT = 8;
export const SOP2_SSRC1_MASK = 0xFF;
export const SOP2_SSRC0_MASK = 0xFF;

// SOPC encoding: bits[31:23]=0x17E, [22:16]=OP(7), [15:8]=SSRC1(8), [7:0]=SSRC0(8)
export const SOPC_ENCODING_PREFIX = 0x17E;
export const SOPC_OP_SHIFT = 16;
export const SOPC_OP_MASK = 0x7F;

// SOPK encoding: bits[31:28]=0b1011, [27:23]=OP(5), [22:16]=SDST(7), [15:0]=SIMM16(16)
export const SOPK_PREFIX = 0xB;
export const SOPK_OP_SHIFT = 23;
export const SOPK_OP_MASK = 0x1F;
export const SOPK_SDST_SHIFT = 16;
export const SOPK_SDST_MASK = 0x7F;
export const SOPK_SIMM16_MASK = 0xFFFF;

// SMEM encoding (2 dwords):
// Dword 0: [31:26]=0x3D, [25:18]=OP(8), [17]=GLC, [16]=DLC, [12:6]=SDATA(7), [5:0]=SBASE(6)
// Dword 1: [31:25]=SOFFSET(7), [20:0]=OFFSET(21)
export const SMEM_ENCODING_PREFIX = 0x3D;
export const SMEM_OP_SHIFT = 18;
export const SMEM_OP_MASK = 0xFF;
export const SMEM_SDATA_SHIFT = 6;
export const SMEM_SDATA_MASK = 0x7F;
export const SMEM_SBASE_MASK = 0x3F;
export const SMEM_OFFSET_MASK = 0x1FFFFF;

// MUBUF encoding (2 dwords):
// Dword 0: [31:26]=0x38, [25:18]=OP(8), [14]=GLC, [13]=IDXEN, [12]=OFFEN, [11:0]=OFFSET(12)
// Dword 1: [31:24]=SOFFSET(8), [20:16]=SRSRC(5), [15:8]=VDATA(8), [7:0]=VADDR(8)
export const MUBUF_ENCODING_PREFIX = 0x38;
export const MUBUF_OP_SHIFT = 18;
export const MUBUF_OP_MASK = 0xFF;
export const MUBUF_OFFSET_MASK = 0xFFF;

// MIMG encoding (2-3 dwords):
// Dword 0: [31:26]=0x3C, [25:18]=OP(8), [17:14]=DMASK(4), [13:11]=DIM(3), [2:0]=NSA
// Dword 1: [25:21]=SSAMP(5), [20:16]=SRSRC(5), [15:8]=VDATA(8), [7:0]=VADDR(8)
export const MIMG_ENCODING_PREFIX = 0x3C;
export const MIMG_OP_SHIFT = 18;
export const MIMG_OP_MASK = 0xFF;

// DS encoding (2 dwords):
// Dword 0: [31:26]=0x36, [25:18]=OP(8), [17]=GDS, [15:8]=OFFSET1(8), [7:0]=OFFSET0(8)
// Dword 1: [31:24]=VDST(8), [23:16]=DATA1(8), [15:8]=DATA0(8), [7:0]=ADDR(8)
export const DS_ENCODING_PREFIX = 0x36;
export const DS_OP_SHIFT = 18;
export const DS_OP_MASK = 0xFF;

/**
 * Decode a 9-bit source operand encoding to its float/int value.
 * Returns the value the operand represents.
 */
export function decodeInlineConstant(encoded: number): number {
  if (encoded === INLINE_INT_0) return 0;
  if (encoded >= INLINE_INT_POS_MIN && encoded <= INLINE_INT_POS_MAX) {
    return encoded - INLINE_INT_0; // 1-64
  }
  if (encoded >= INLINE_INT_NEG_MIN && encoded <= INLINE_INT_NEG_MAX) {
    return -(encoded - INLINE_INT_NEG_MIN + 1); // -1 to -16
  }
  if (encoded in INLINE_FLOAT_MAP) {
    return INLINE_FLOAT_MAP[encoded];
  }
  throw new Error(`Not an inline constant: ${encoded}`);
}

/**
 * Try to encode a numeric value as an inline constant.
 * Returns the 9-bit encoding or null if not representable inline.
 */
export function tryEncodeInline(value: number): number | null {
  // Integer 0
  if (value === 0) return INLINE_INT_0;
  // Positive integers 1-64
  if (Number.isInteger(value) && value >= 1 && value <= 64) {
    return INLINE_INT_0 + value;
  }
  // Negative integers -1 to -16
  if (Number.isInteger(value) && value >= -16 && value <= -1) {
    return INLINE_INT_NEG_MIN + (-value - 1);
  }
  // Inline floats
  const floatEncoding = FLOAT_TO_INLINE.get(value);
  if (floatEncoding !== undefined) return floatEncoding;

  return null;
}

/**
 * Check if a 9-bit encoded operand refers to a VGPR.
 */
export function isVGPR(encoded: number): boolean {
  return encoded >= VGPR_SRC_MIN && encoded <= VGPR_SRC_MAX;
}

/**
 * Check if a 9-bit encoded operand refers to an SGPR.
 */
export function isSGPR(encoded: number): boolean {
  return encoded >= SGPR_MIN && encoded <= SGPR_MAX;
}

/**
 * Get VGPR index from 9-bit encoding.
 */
export function vgprIndex(encoded: number): number {
  return encoded - VGPR_SRC_MIN;
}

/**
 * Encode a VGPR index (0-255) to 9-bit SRC0 encoding.
 */
export function encodeVGPR(index: number): number {
  return VGPR_SRC_MIN + index;
}
