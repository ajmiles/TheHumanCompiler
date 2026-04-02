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
export const NUM_SGPRS = 106;
export const WAVE_WIDTH = 32;

// VOP1 encoding marker: bits [31:25] = 0b0111111 = 0x3F
export const VOP1_ENCODING_PREFIX = 0x3F;

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
