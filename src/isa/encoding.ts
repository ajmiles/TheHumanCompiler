// ── RDNA2 Binary Encoding/Decoding ──
// Encodes ParsedInstruction → binary words and decodes binary → DecodedInstruction

import {
  InstructionFormat,
  ParsedInstruction,
  DecodedInstruction,
  OperandType,
} from './types';
import {
  VOP1_ENCODING_PREFIX,
  VOP2_OP_SHIFT,
  VDST_SHIFT,
  VSRC1_SHIFT,
  SRC0_MASK,
  VOP1_PREFIX_SHIFT,
  VOP1_PREFIX_MASK,
  VOP1_OP_SHIFT,
  VOP1_OP_MASK,
  VOP2_OP_MASK,
  VDST_MASK,
  VSRC1_MASK,
  LITERAL_CONST,
  VGPR_SRC_MIN,
  encodeVGPR,
  tryEncodeInline,
  SOP1_ENCODING_PREFIX,
  SOP1_PREFIX_SHIFT,
  SOP1_PREFIX_MASK,
  SOP1_SDST_SHIFT,
  SOP1_SDST_MASK,
  SOP1_OP_SHIFT,
  SOP1_OP_MASK,
  SOP1_SSRC0_MASK,
} from './constants';
import { lookupByMnemonic } from './opcodes';

/**
 * Encode a single parsed instruction into one or two 32-bit words.
 * Returns the words (1 word normally, 2 if a literal constant is used).
 */
export function encodeInstruction(instr: ParsedInstruction): number[] {
  const info = lookupByMnemonic(instr.mnemonic);
  if (!info) throw new Error(`Unknown mnemonic: ${instr.mnemonic}`);

  if (info.format === InstructionFormat.VOP2) {
    return encodeVOP2(info.opcode, instr);
  } else if (info.format === InstructionFormat.SOP1) {
    return encodeSOP1(info.opcode, instr);
  } else {
    return encodeVOP1(info.opcode, instr);
  }
}

function encodeVOP2(opcode: number, instr: ParsedInstruction): number[] {
  const vdst = instr.dst.encoded & 0xFF;
  const vsrc1 = instr.src1!.encoded & 0xFF;
  const src0Result = encodeSrc0(instr.src0);

  // VOP2: bit31=0, [30:25]=OP, [24:17]=VDST, [16:9]=VSRC1, [8:0]=SRC0
  const word = (0 << 31)
    | ((opcode & VOP2_OP_MASK) << VOP2_OP_SHIFT)
    | ((vdst & VDST_MASK) << VDST_SHIFT)
    | ((vsrc1 & VSRC1_MASK) << VSRC1_SHIFT)
    | (src0Result.encoded & SRC0_MASK);

  const words = [(word >>> 0)];
  if (src0Result.literal !== undefined) {
    words.push(src0Result.literal >>> 0);
  }
  return words;
}

function encodeVOP1(opcode: number, instr: ParsedInstruction): number[] {
  const vdst = instr.dst.encoded & 0xFF;
  const src0Result = encodeSrc0(instr.src0);

  // VOP1: [31:25]=0x3F, [24:17]=VDST, [16:9]=OP, [8:0]=SRC0
  const word = (VOP1_ENCODING_PREFIX << VOP1_PREFIX_SHIFT)
    | ((vdst & VDST_MASK) << VDST_SHIFT)
    | ((opcode & VOP1_OP_MASK) << VOP1_OP_SHIFT)
    | (src0Result.encoded & SRC0_MASK);

  const words = [(word >>> 0)];
  if (src0Result.literal !== undefined) {
    words.push(src0Result.literal >>> 0);
  }
  return words;
}

function encodeSOP1(opcode: number, instr: ParsedInstruction): number[] {
  const sdst = instr.dst.encoded & SOP1_SDST_MASK;
  const ssrc0 = instr.src0.encoded & SOP1_SSRC0_MASK;

  // SOP1: [31:23]=0x17D, [22:16]=SDST, [15:8]=OP, [7:0]=SSRC0
  const word = (SOP1_ENCODING_PREFIX << SOP1_PREFIX_SHIFT)
    | ((sdst & SOP1_SDST_MASK) << SOP1_SDST_SHIFT)
    | ((opcode & SOP1_OP_MASK) << SOP1_OP_SHIFT)
    | (ssrc0 & SOP1_SSRC0_MASK);

  // SOP1 supports literal constants when SSRC0 == 0xFF
  const words = [(word >>> 0)];
  if (instr.src0.encoded === LITERAL_CONST && instr.src0.type === OperandType.LITERAL) {
    const val = instr.src0.value;
    if (Number.isInteger(val)) {
      words.push(val >>> 0);
    } else {
      const f32Tmp = new Float32Array(1);
      const u32Tmp = new Uint32Array(f32Tmp.buffer);
      f32Tmp[0] = val;
      words.push(u32Tmp[0] >>> 0);
    }
  }
  return words;
}

interface Src0Encoding {
  encoded: number;     // 9-bit value for the SRC0 field
  literal?: number;    // Optional 32-bit literal word
}

function encodeSrc0(operand: ParsedInstruction['src0']): Src0Encoding {
  switch (operand.type) {
    case OperandType.VGPR:
      return { encoded: encodeVGPR(operand.value) };
    case OperandType.SGPR:
      return { encoded: operand.value }; // SGPR index is direct
    case OperandType.INLINE_INT:
    case OperandType.INLINE_FLOAT: {
      const inlineCode = tryEncodeInline(operand.value);
      if (inlineCode !== null) return { encoded: inlineCode };
      // Fall through to literal if inline encoding fails
      return encodeLiteral(operand.value);
    }
    case OperandType.LITERAL:
      return encodeLiteral(operand.value);
    default:
      return { encoded: operand.encoded };
  }
}

const f32Buf = new Float32Array(1);
const u32Buf = new Uint32Array(f32Buf.buffer);

function encodeLiteral(value: number): Src0Encoding {
  // Integer values: store raw bits directly
  if (Number.isInteger(value)) {
    return { encoded: LITERAL_CONST, literal: value >>> 0 };
  }
  // Float values: encode as 32-bit IEEE 754
  f32Buf[0] = value;
  return { encoded: LITERAL_CONST, literal: u32Buf[0] };
}

/**
 * Assemble a list of parsed instructions into a binary stream.
 */
export function assembleToBinary(instructions: ParsedInstruction[]): Uint32Array {
  const words: number[] = [];
  for (const instr of instructions) {
    words.push(...encodeInstruction(instr));
  }
  return new Uint32Array(words);
}

// ── Decoder ──

/**
 * Detect instruction format from a 32-bit word.
 */
export function detectFormat(word: number): InstructionFormat {
  // Check SOP1 first: bits [31:23] = 0x17D (101111101)
  const prefix9 = (word >>> SOP1_PREFIX_SHIFT) & SOP1_PREFIX_MASK;
  if (prefix9 === SOP1_ENCODING_PREFIX) return InstructionFormat.SOP1;
  // VOP1: bits [31:25] = 0x3F (0111111)
  const prefix7 = (word >>> VOP1_PREFIX_SHIFT) & VOP1_PREFIX_MASK;
  if (prefix7 === VOP1_ENCODING_PREFIX) return InstructionFormat.VOP1;
  // Bit 31 = 0 → VOP2
  return InstructionFormat.VOP2;
}

/**
 * Decode a binary stream into instructions.
 */
export function decodeBinary(binary: Uint32Array): DecodedInstruction[] {
  const instructions: DecodedInstruction[] = [];
  let i = 0;

  while (i < binary.length) {
    const word = binary[i];
    const format = detectFormat(word);
    const address = i;

    if (format === InstructionFormat.SOP1) {
      const sdst = (word >>> SOP1_SDST_SHIFT) & SOP1_SDST_MASK;
      const opcode = (word >>> SOP1_OP_SHIFT) & SOP1_OP_MASK;
      const ssrc0 = word & SOP1_SSRC0_MASK;

      const decoded: DecodedInstruction = {
        format,
        opcode,
        dst: sdst,
        src0Encoded: ssrc0,
        address,
      };

      i++;

      if (ssrc0 === 0xFF && i < binary.length) {
        decoded.literal = binary[i];
        i++;
      }

      instructions.push(decoded);
    } else if (format === InstructionFormat.VOP1) {
      const vdst = (word >>> VDST_SHIFT) & VDST_MASK;
      const opcode = (word >>> VOP1_OP_SHIFT) & VOP1_OP_MASK;
      const src0 = word & SRC0_MASK;

      const decoded: DecodedInstruction = {
        format,
        opcode,
        dst: vdst,
        src0Encoded: src0,
        address,
      };

      i++;

      // Check for literal constant
      if (src0 === LITERAL_CONST && i < binary.length) {
        decoded.literal = binary[i];
        i++;
      }

      instructions.push(decoded);
    } else {
      // VOP2
      const opcode = (word >>> VOP2_OP_SHIFT) & VOP2_OP_MASK;
      const vdst = (word >>> VDST_SHIFT) & VDST_MASK;
      const vsrc1 = (word >>> VSRC1_SHIFT) & VSRC1_MASK;
      const src0 = word & SRC0_MASK;

      const decoded: DecodedInstruction = {
        format,
        opcode,
        dst: vdst,
        src0Encoded: src0,
        src1: vsrc1,
        address,
      };

      i++;

      if (src0 === LITERAL_CONST && i < binary.length) {
        decoded.literal = binary[i];
        i++;
      }

      instructions.push(decoded);
    }
  }

  return instructions;
}

/**
 * Disassemble a decoded instruction back to a human-readable string.
 * Note: requires lookupByOpcode to be passed in to avoid circular imports.
 */
export function disassemble(
  decoded: DecodedInstruction,
  lookupFn?: (format: InstructionFormat, opcode: number) => { mnemonic: string } | undefined,
): string {
  const info = lookupFn?.(decoded.format, decoded.opcode);
  const mnemonic = info ? info.mnemonic : `unknown_${decoded.format}_${decoded.opcode}`;

  if (decoded.format === InstructionFormat.SOP1) {
    const dst = formatSpecialOrSgpr(decoded.dst);
    const src0 = formatSsrc0(decoded.src0Encoded, decoded.literal);
    return `${mnemonic} ${dst}, ${src0}`;
  }

  const dst = `v${decoded.dst}`;
  const src0 = formatSrc0(decoded.src0Encoded, decoded.literal);

  if (decoded.format === InstructionFormat.VOP2) {
    const src1 = `v${decoded.src1}`;
    return `${mnemonic} ${dst}, ${src0}, ${src1}`;
  } else {
    return `${mnemonic} ${dst}, ${src0}`;
  }
}

function formatSrc0(encoded: number, literal?: number): string {
  if (encoded >= VGPR_SRC_MIN) return `v${encoded - VGPR_SRC_MIN}`;
  // Check special registers in the SGPR range
  if (encoded in SPECIAL_REG_NAMES) return SPECIAL_REG_NAMES[encoded];
  if (encoded <= 105) return `s${encoded}`;
  if (encoded === LITERAL_CONST && literal !== undefined) {
    f32Buf[0] = 0;
    u32Buf[0] = literal;
    return f32Buf[0].toString();
  }
  if (encoded === 128) return '0';
  if (encoded >= 129 && encoded <= 192) return `${encoded - 128}`;
  if (encoded >= 193 && encoded <= 208) return `${-(encoded - 192)}`;
  const floatMap: Record<number, string> = {
    240: '0.5', 241: '-0.5', 242: '1.0', 243: '-1.0',
    244: '2.0', 245: '-2.0', 246: '4.0', 247: '-4.0',
  };
  if (encoded in floatMap) return floatMap[encoded];
  return `src(${encoded})`;
}

function formatSsrc0(encoded: number, literal?: number): string {
  // Check special registers first
  const special = formatSpecialOrSgpr(encoded);
  if (special !== null) return special;
  if (encoded === 0xFF && literal !== undefined) {
    return `0x${(literal >>> 0).toString(16)}`;
  }
  if (encoded === 128) return '0';
  if (encoded >= 129 && encoded <= 192) return `${encoded - 128}`;
  if (encoded >= 193 && encoded <= 208) return `${-(encoded - 192)}`;
  const floatMap: Record<number, string> = {
    240: '0.5', 241: '-0.5', 242: '1.0', 243: '-1.0',
    244: '2.0', 245: '-2.0', 246: '4.0', 247: '-4.0',
  };
  if (encoded in floatMap) return floatMap[encoded];
  return `ssrc(${encoded})`;
}

const SPECIAL_REG_NAMES: Record<number, string> = {
  106: 'vcc_lo',
  107: 'vcc_hi',
  124: 'm0',
  125: 'null',
  126: 'exec_lo',
  127: 'exec_hi',
};

function formatSpecialOrSgpr(encoded: number): string {
  if (encoded in SPECIAL_REG_NAMES) return SPECIAL_REG_NAMES[encoded];
  if (encoded <= 105) return `s${encoded}`;
  return `s${encoded}`;
}
