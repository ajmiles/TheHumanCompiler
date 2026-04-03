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
  VOPC_ENCODING_PREFIX,
  VOPC_OP_SHIFT,
  VOPC_OP_MASK,
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
  VOP3_ENCODING_PREFIX,
  VOP3_PREFIX_SHIFT,
  VOP3_PREFIX_MASK,
  VOP3_OP_SHIFT,
  VOP3_OP_MASK,
  VOP3_ABS_SHIFT,
  VOP3_VDST_MASK,
  VOP3_SRC0_MASK,
  VOP3_SRC1_SHIFT,
  VOP3_SRC1_MASK,
  VOP3_NEG_SHIFT,
  VOP3_NEG_MASK,
  VOP3_ABS_MASK,
  VOP3_OMOD_SHIFT,
  VOP3_OMOD_MASK,
  VOP3_CLAMP_BIT,
  VOP3_VOP1_OFFSET,
} from './constants';
import { lookupByMnemonic } from './opcodes';

/** Check if an instruction needs VOP3 promotion (has modifiers). */
function needsVOP3(instr: ParsedInstruction): boolean {
  return !!(instr.src0.abs || instr.src0.neg || instr.src1?.abs || instr.src1?.neg || instr.omod || instr.clamp);
}

/**
 * Encode a single parsed instruction into 1-2 32-bit words (or 2 for VOP3).
 */
export function encodeInstruction(instr: ParsedInstruction): number[] {
  const info = lookupByMnemonic(instr.mnemonic);
  if (!info) throw new Error(`Unknown mnemonic: ${instr.mnemonic}`);

  // Auto-promote to VOP3 if modifiers are present
  if ((info.format === InstructionFormat.VOP1 || info.format === InstructionFormat.VOP2) && needsVOP3(instr)) {
    return encodeVOP3(info.format, info.opcode, instr);
  }

  if (info.format === InstructionFormat.VOPC) {
    return encodeVOPC(info.opcode, instr);
  } else if (info.format === InstructionFormat.VOP2) {
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

function encodeVOPC(opcode: number, instr: ParsedInstruction): number[] {
  // VOPC: [31:25]=0x3E, [24:17]=OP, [16:9]=VSRC1, [8:0]=SRC0
  // VOPC has no destination — src0 and src1 are the two operands
  // In our parser: dst = src0 (first operand), src0 = src1 (second operand)
  // Wait — for VOPC, operandCount=2, parser puts them as dst and src0.
  // But VOPC doesn't have a dest, it has two sources. Let me use dst as src0, src0 as src1.
  const src0Result = encodeSrc0(instr.dst); // first compare operand
  const vsrc1 = instr.src0.encoded & 0xFF;  // second compare operand (VGPR)

  const word = (VOPC_ENCODING_PREFIX << VOP1_PREFIX_SHIFT)
    | ((opcode & VOPC_OP_MASK) << VOPC_OP_SHIFT)
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

function encodeVOP3(baseFormat: InstructionFormat, baseOpcode: number, instr: ParsedInstruction): number[] {
  // Compute VOP3 opcode: VOP2 stays same, VOP1 gets +0x100 offset
  const vop3Opcode = baseFormat === InstructionFormat.VOP1
    ? baseOpcode + VOP3_VOP1_OFFSET
    : baseOpcode;

  const vdst = instr.dst.encoded & VOP3_VDST_MASK;

  // ABS bits: bit0=src0, bit1=src1, bit2=src2
  let absBits = 0;
  if (instr.src0.abs) absBits |= 1;
  if (instr.src1?.abs) absBits |= 2;

  // NEG bits: bit0=src0, bit1=src1, bit2=src2
  let negBits = 0;
  if (instr.src0.neg) negBits |= 1;
  if (instr.src1?.neg) negBits |= 2;

  const clampBit = instr.clamp ? 1 : 0;
  const omodBits = (instr.omod ?? 0) & VOP3_OMOD_MASK;

  // Dword 0: [31:26]=prefix, [25:16]=OP, [11]=CLAMP, [10:8]=ABS, [7:0]=VDST
  const dword0 = (VOP3_ENCODING_PREFIX << VOP3_PREFIX_SHIFT)
    | ((vop3Opcode & VOP3_OP_MASK) << VOP3_OP_SHIFT)
    | (clampBit << VOP3_CLAMP_BIT)
    | ((absBits & VOP3_ABS_MASK) << VOP3_ABS_SHIFT)
    | (vdst & VOP3_VDST_MASK);

  // Source operands (all 9-bit in VOP3)
  const src0 = encodeSrc0(instr.src0);
  const src1Encoded = instr.src1
    ? encodeVGPR(instr.src1.value) // in VOP3, src1 is also 9-bit
    : 0;

  // Dword 1: [31:29]=NEG, [28:27]=OMOD, [17:9]=SRC1, [8:0]=SRC0
  const dword1 = ((negBits & VOP3_NEG_MASK) << VOP3_NEG_SHIFT)
    | ((omodBits & VOP3_OMOD_MASK) << VOP3_OMOD_SHIFT)
    | ((src1Encoded & VOP3_SRC1_MASK) << VOP3_SRC1_SHIFT)
    | (src0.encoded & VOP3_SRC0_MASK);

  return [(dword0 >>> 0), (dword1 >>> 0)];
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
  // Check VOP3 first: bits [31:26] = 0x34 (110100)
  const prefix6 = (word >>> VOP3_PREFIX_SHIFT) & VOP3_PREFIX_MASK;
  if (prefix6 === VOP3_ENCODING_PREFIX) return InstructionFormat.VOP3;
  // Check SOP1: bits [31:23] = 0x17D (101111101)
  const prefix9 = (word >>> SOP1_PREFIX_SHIFT) & SOP1_PREFIX_MASK;
  if (prefix9 === SOP1_ENCODING_PREFIX) return InstructionFormat.SOP1;
  // VOP1: bits [31:25] = 0x3F (0111111)
  const prefix7 = (word >>> VOP1_PREFIX_SHIFT) & VOP1_PREFIX_MASK;
  if (prefix7 === VOP1_ENCODING_PREFIX) return InstructionFormat.VOP1;
  // VOPC: bits [31:25] = 0x3E (0111110)
  if (prefix7 === VOPC_ENCODING_PREFIX) return InstructionFormat.VOPC;
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

    if (format === InstructionFormat.VOP3) {
      // VOP3 is always 2 dwords
      if (i + 1 >= binary.length) break;
      const dword0 = word;
      const dword1 = binary[i + 1];

      const vop3Opcode = (dword0 >>> VOP3_OP_SHIFT) & VOP3_OP_MASK;
      const vdst = dword0 & VOP3_VDST_MASK;
      const absBits = (dword0 >>> VOP3_ABS_SHIFT) & VOP3_ABS_MASK;

      const src0 = dword1 & VOP3_SRC0_MASK;
      const src1 = (dword1 >>> VOP3_SRC1_SHIFT) & VOP3_SRC1_MASK;
      const negBits = (dword1 >>> VOP3_NEG_SHIFT) & VOP3_NEG_MASK;
      const omodBits = (dword1 >>> VOP3_OMOD_SHIFT) & VOP3_OMOD_MASK;
      const clampBit = (dword0 >>> VOP3_CLAMP_BIT) & 1;

      // Determine original format and base opcode
      let baseOpcode: number;
      let origFormat: InstructionFormat;
      if (vop3Opcode >= VOP3_VOP1_OFFSET) {
        origFormat = InstructionFormat.VOP1;
        baseOpcode = vop3Opcode - VOP3_VOP1_OFFSET;
      } else {
        origFormat = InstructionFormat.VOP2;
        baseOpcode = vop3Opcode;
      }

      const decoded: DecodedInstruction = {
        format: origFormat, // store as original format for opcode lookup
        opcode: baseOpcode,
        dst: vdst,
        src0Encoded: src0,
        src1: origFormat === InstructionFormat.VOP2 ? (src1 & 0xFF) : undefined,
        address,
        src0Abs: !!(absBits & 1),
        src0Neg: !!(negBits & 1),
        src1Abs: !!(absBits & 2),
        src1Neg: !!(negBits & 2),
        omod: omodBits || undefined,
        clamp: clampBit ? true : undefined,
      };

      i += 2;
      instructions.push(decoded);
    } else if (format === InstructionFormat.VOPC) {
      const opcode = (word >>> VOPC_OP_SHIFT) & VOPC_OP_MASK;
      const vsrc1 = (word >>> VSRC1_SHIFT) & VSRC1_MASK;
      const src0 = word & SRC0_MASK;

      const decoded: DecodedInstruction = {
        format,
        opcode,
        dst: 0,  // VOPC has no dest; result goes to VCC
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
    } else if (format === InstructionFormat.SOP1) {
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

  if (decoded.format === InstructionFormat.VOPC) {
    const src0 = formatSrc0(decoded.src0Encoded, decoded.literal);
    const src1 = `v${decoded.src1}`;
    return `${mnemonic} vcc, ${src0}, ${src1}`;
  }

  const dst = `v${decoded.dst}`;
  let src0 = formatSrc0(decoded.src0Encoded, decoded.literal);
  if (decoded.src0Abs) src0 = `abs(${src0})`;
  if (decoded.src0Neg) src0 = `-${src0}`;

  // Output modifier suffixes
  const suffixes: string[] = [];
  if (decoded.clamp) suffixes.push('clamp');
  if (decoded.omod === 1) suffixes.push('mul:2');
  if (decoded.omod === 2) suffixes.push('mul:4');
  if (decoded.omod === 3) suffixes.push('div:2');
  const suffix = suffixes.length > 0 ? ' ' + suffixes.join(' ') : '';

  if (decoded.format === InstructionFormat.VOP2) {
    let src1 = `v${decoded.src1}`;
    if (decoded.src1Abs) src1 = `abs(${src1})`;
    if (decoded.src1Neg) src1 = `-${src1}`;
    return `${mnemonic} ${dst}, ${src0}, ${src1}${suffix}`;
  } else {
    return `${mnemonic} ${dst}, ${src0}${suffix}`;
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
