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
  SOPP_ENCODING_PREFIX,
  SOPP_OP_SHIFT,
  SOPP_OP_MASK,
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
  VOP3_OP_SHIFT,
  VOP3_OP_MASK,
  VOP3_ABS_SHIFT,
  VOP3_VDST_MASK,
  VOP3_SRC0_MASK,
  VOP3_SRC1_SHIFT,
  VOP3_SRC1_MASK,
  VOP3_SRC2_SHIFT,
  VOP3_SRC2_MASK,
  VOP3_NEG_SHIFT,
  VOP3_NEG_MASK,
  VOP3_ABS_MASK,
  VOP3_OMOD_SHIFT,
  VOP3_OMOD_MASK,
  VOP3_CLAMP_BIT,
  VOP3_VOP2_OFFSET,
  VOP3_VOP1_OFFSET,
  SOPC_OP_SHIFT,
  SOPC_OP_MASK,
  SOP2_OP_SHIFT,
  SOP2_OP_MASK,
  SOP2_SDST_SHIFT,
  SOP2_SDST_MASK,
  SOP2_SSRC1_SHIFT,
  SOP2_SSRC1_MASK,
  SOP2_SSRC0_MASK,
  SOPK_OP_SHIFT,
  SOPK_OP_MASK,
  SOPK_SDST_SHIFT,
  SOPK_SDST_MASK,
  SOPK_SIMM16_MASK,
  SMEM_OP_SHIFT,
  SMEM_OP_MASK,
  SMEM_SDATA_SHIFT,
  SMEM_SDATA_MASK,
  SMEM_SBASE_MASK,
  SMEM_OFFSET_MASK,
  MUBUF_OP_SHIFT,
  MUBUF_OP_MASK,
  MUBUF_OFFSET_MASK,
  MIMG_OP_SHIFT,
  MIMG_OP_MASK,
  DS_ENCODING_PREFIX,
  DS_OP_SHIFT,
  DS_OP_MASK,
} from './constants';
import { lookupByMnemonic, lookupByOpcode } from './opcodes';

/** Check if an instruction needs VOP3 promotion (has modifiers or non-VGPR in src1). */
function needsVOP3(instr: ParsedInstruction): boolean {
  const hasMods = !!(instr.src0.abs || instr.src0.neg || instr.src1?.abs || instr.src1?.neg || instr.omod || instr.clamp);
  const src1NeedsPromotion = instr.src1 && instr.src1.type !== OperandType.VGPR;
  return hasMods || !!src1NeedsPromotion;
}

/**
 * Encode a single parsed instruction into 1-2 32-bit words (or 2 for VOP3).
 */
export function encodeInstruction(instr: ParsedInstruction): number[] {
  const info = lookupByMnemonic(instr.mnemonic);
  if (!info) throw new Error(`Unknown mnemonic: ${instr.mnemonic}`);

  // VOP3-only instructions (e.g. v_fma_f32) always use VOP3 encoding
  if (info.format === InstructionFormat.VOP3) {
    return encodeVOP3(InstructionFormat.VOP3, info.opcode, instr);
  }

  // Auto-promote to VOP3 if modifiers are present
  if ((info.format === InstructionFormat.VOP1 || info.format === InstructionFormat.VOP2) && needsVOP3(instr)) {
    return encodeVOP3(info.format, info.opcode, instr);
  }

  if (info.format === InstructionFormat.SOPP) {
    return encodeSOPP(info.opcode);
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

function encodeSOPP(opcode: number): number[] {
  // SOPP: [31:23]=0x17F, [22:16]=OP, [15:0]=SIMM16 (0 for s_endpgm)
  const word = (SOPP_ENCODING_PREFIX << SOP1_PREFIX_SHIFT)
    | ((opcode & SOPP_OP_MASK) << SOPP_OP_SHIFT);
  return [(word >>> 0)];
}

function encodeVOP3(baseFormat: InstructionFormat, baseOpcode: number, instr: ParsedInstruction): number[] {
  // Compute VOP3 opcode
  // Real RDNA2: VOP2 promoted = base + 256, VOP1 promoted = base + 256
  // Native VOP3 instructions use their own opcode directly
  let vop3Opcode: number;
  if (baseFormat === InstructionFormat.VOP3) {
    vop3Opcode = baseOpcode; // native VOP3 opcode
  } else if (baseFormat === InstructionFormat.VOP1) {
    vop3Opcode = baseOpcode + VOP3_VOP1_OFFSET;
  } else {
    // VOP2 promotion
    vop3Opcode = baseOpcode + VOP3_VOP2_OFFSET;
  }

  const vdst = instr.dst.encoded & VOP3_VDST_MASK;

  let absBits = 0;
  if (instr.src0.abs) absBits |= 1;
  if (instr.src1?.abs) absBits |= 2;
  if (instr.src2?.abs) absBits |= 4;

  let negBits = 0;
  if (instr.src0.neg) negBits |= 1;
  if (instr.src1?.neg) negBits |= 2;
  if (instr.src2?.neg) negBits |= 4;

  const clampBit = instr.clamp ? 1 : 0;
  const omodBits = (instr.omod ?? 0) & VOP3_OMOD_MASK;

  const dword0 = (VOP3_ENCODING_PREFIX << VOP3_PREFIX_SHIFT)
    | ((vop3Opcode & VOP3_OP_MASK) << VOP3_OP_SHIFT)
    | (clampBit << VOP3_CLAMP_BIT)
    | ((absBits & VOP3_ABS_MASK) << VOP3_ABS_SHIFT)
    | (vdst & VOP3_VDST_MASK);

  const src0 = encodeSrc0(instr.src0);
  const src1Result = instr.src1 ? encodeSrc0(instr.src1) : null;
  const src2Result = instr.src2 ? encodeSrc0(instr.src2) : null;

  const src1Encoded = src1Result?.encoded ?? 0;
  const src2Encoded = src2Result?.encoded ?? 0;

  // Dword 1: [31:29]=NEG, [28:27]=OMOD, [26:18]=SRC2, [17:9]=SRC1, [8:0]=SRC0
  const dword1 = ((negBits & VOP3_NEG_MASK) << VOP3_NEG_SHIFT)
    | ((omodBits & VOP3_OMOD_MASK) << VOP3_OMOD_SHIFT)
    | ((src2Encoded & VOP3_SRC2_MASK) << VOP3_SRC2_SHIFT)
    | ((src1Encoded & VOP3_SRC1_MASK) << VOP3_SRC1_SHIFT)
    | (src0.encoded & VOP3_SRC0_MASK);

  const words = [(dword0 >>> 0), (dword1 >>> 0)];

  // VOP3 supports one literal constant shared across sources
  const literal = src0.literal ?? src1Result?.literal ?? src2Result?.literal;
  if (literal !== undefined) {
    words.push(literal >>> 0);
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
    case OperandType.INLINE_FLOAT:
      return { encoded: operand.encoded };
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
  const prefix6 = (word >>> 26) & 0x3F;

  // 6-bit prefix checks (bits [31:26])
  if (prefix6 === 0x3D) return InstructionFormat.SMEM;
  if (prefix6 === 0x3C) return InstructionFormat.MIMG;
  if (prefix6 === 0x3A) return InstructionFormat.MTBUF;
  if (prefix6 === 0x38) return InstructionFormat.MUBUF;
  if (prefix6 === VOP3_ENCODING_PREFIX) return InstructionFormat.VOP3;   // 0x34
  if (prefix6 === 0x35) return InstructionFormat.VOP3;  // VOP3B — treat as VOP3 for decoding
  if (prefix6 === 0x33) return InstructionFormat.VOP3;  // VOP3P — treat as VOP3 for decoding
  if (prefix6 === DS_ENCODING_PREFIX) return InstructionFormat.DS; // 0x36

  // 9-bit prefix checks (bits [31:23])
  const prefix9 = (word >>> SOP1_PREFIX_SHIFT) & SOP1_PREFIX_MASK;
  if (prefix9 === SOPP_ENCODING_PREFIX) return InstructionFormat.SOPP;   // 0x17F
  if (prefix9 === 0x17E) return InstructionFormat.SOPC;                  // SOPC
  if (prefix9 === SOP1_ENCODING_PREFIX) return InstructionFormat.SOP1;   // 0x17D

  // 7-bit prefix checks (bits [31:25])
  const prefix7 = (word >>> VOP1_PREFIX_SHIFT) & VOP1_PREFIX_MASK;
  if (prefix7 === VOP1_ENCODING_PREFIX) return InstructionFormat.VOP1;   // 0x3F
  if (prefix7 === VOPC_ENCODING_PREFIX) return InstructionFormat.VOPC;   // 0x3E

  // SOPK: bits [31:28] = 0xB (1011)
  if (((word >>> 28) & 0xF) === 0xB) return InstructionFormat.SOPK;

  // SOP2: bits [31:30] = 0b10 (after excluding SOP1/SOPC/SOPP/SOPK)
  if (((word >>> 30) & 0x3) === 0x2) return InstructionFormat.SOP2;

  // Bit 31 = 0 → VOP2 (fallback)
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
      const src2 = (dword1 >>> VOP3_SRC2_SHIFT) & VOP3_SRC2_MASK;
      const negBits = (dword1 >>> VOP3_NEG_SHIFT) & VOP3_NEG_MASK;
      const omodBits = (dword1 >>> VOP3_OMOD_SHIFT) & VOP3_OMOD_MASK;
      const clampBit = (dword0 >>> VOP3_CLAMP_BIT) & 1;

      // Determine original format and base opcode
      let baseOpcode: number;
      let origFormat: InstructionFormat;

      // Check for v_nop_xbox_data (VOP3B prefix 0x35 with VOP1 v_nop promoted)
      const isVop3b = ((dword0 >>> VOP3_PREFIX_SHIFT) & 0x3F) === 0x35;
      const isXboxNop = isVop3b && vop3Opcode === VOP3_VOP1_OFFSET; // 0x180 = v_nop promoted

      // First try as native VOP3 (e.g. v_fma_f32 = 0x14B)
      if (lookupByOpcode(InstructionFormat.VOP3, vop3Opcode)) {
        origFormat = InstructionFormat.VOP3;
        baseOpcode = vop3Opcode;
      } else if (lookupByOpcode(InstructionFormat.VOPC, vop3Opcode)) {
        // VOPC promoted to VOP3 (no offset)
        origFormat = InstructionFormat.VOPC;
        baseOpcode = vop3Opcode;
      } else {
        // Try VOP2 promotion (subtract 0x100)
        const demotedVop2 = vop3Opcode - VOP3_VOP2_OFFSET;
        // Try VOP1 promotion (subtract 0x180)
        const demotedVop1 = vop3Opcode - VOP3_VOP1_OFFSET;
        if (demotedVop2 >= 0 && lookupByOpcode(InstructionFormat.VOP2, demotedVop2)) {
          origFormat = InstructionFormat.VOP2;
          baseOpcode = demotedVop2;
        } else if (demotedVop1 >= 0 && lookupByOpcode(InstructionFormat.VOP1, demotedVop1)) {
          origFormat = InstructionFormat.VOP1;
          baseOpcode = demotedVop1;
        } else if (demotedVop2 >= 0) {
          origFormat = InstructionFormat.VOP2;
          baseOpcode = demotedVop2;
        } else {
          origFormat = InstructionFormat.VOP3;
          baseOpcode = vop3Opcode;
        }
      }

      const decoded: DecodedInstruction = {
        format: origFormat,
        opcode: baseOpcode,
        dst: vdst,
        src0Encoded: src0,
        src1: src1,  // always present in VOP3
        src2: src2,  // always present in VOP3 encoding (may be unused)
        address,
        src0Abs: !!(absBits & 1),
        src0Neg: !!(negBits & 1),
        src1Abs: !!(absBits & 2),
        src1Neg: !!(negBits & 2),
        src2Abs: !!(absBits & 4),
        src2Neg: !!(negBits & 4),
        omod: omodBits || undefined,
        clamp: clampBit ? true : undefined,
      };

      i += 2;

      // v_nop_xbox_data: VOP3B-encoded v_nop with an extra data dword
      if (isXboxNop && i < binary.length) {
        decoded.literal = binary[i];
        i++;
      }
      // Check for literal constant (any source field == 255)
      else if ((src0 === LITERAL_CONST || src1 === LITERAL_CONST || src2 === LITERAL_CONST) && i < binary.length) {
        decoded.literal = binary[i];
        i++;
      }

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
        src1: VGPR_SRC_MIN + vsrc1,        address,
      };

      i++;

      // DPP8 (SRC0=0xE9), SDWA (SRC0=0xF9), DPP16 (SRC0=0xFA), or literal constant (SRC0=0xFF)
      if ((src0 === LITERAL_CONST || src0 === 0xE9 || src0 === 0xF9 || src0 === 0xFA) && i < binary.length) {
        decoded.literal = binary[i];
        i++;
      }

      instructions.push(decoded);
    } else if (format === InstructionFormat.SOPP) {
      const opcode = (word >>> SOPP_OP_SHIFT) & SOPP_OP_MASK;
      const simm16 = word & 0xFFFF;

      instructions.push({
        format,
        opcode,
        dst: 0,
        src0Encoded: 0,
        simm16,
        address,
      });

      i++;
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

      // Check for literal constant or DPP/SDWA data
      if ((src0 === LITERAL_CONST || src0 === 0xE9 || src0 === 0xF9 || src0 === 0xFA) && i < binary.length) {
        decoded.literal = binary[i];
        i++;
      }

      instructions.push(decoded);
    } else if (format === InstructionFormat.SOPC) {
      // SOPC: bits[31:23]=0x17E, [22:16]=OP(7), [15:8]=SSRC1(8), [7:0]=SSRC0(8)
      const opcode = (word >>> SOPC_OP_SHIFT) & SOPC_OP_MASK;
      const ssrc1 = (word >>> SOP2_SSRC1_SHIFT) & SOP2_SSRC1_MASK;
      const ssrc0 = word & SOP2_SSRC0_MASK;

      instructions.push({
        format,
        opcode,
        dst: 0,
        src0Encoded: ssrc0,
        src1: ssrc1,
        address,
      });

      i++;
    } else if (format === InstructionFormat.SOP2) {
      // SOP2: bits[31:30]=10, [29:23]=OP(7), [22:16]=SDST(7), [15:8]=SSRC1(8), [7:0]=SSRC0(8)
      const opcode = (word >>> SOP2_OP_SHIFT) & SOP2_OP_MASK;
      const sdst = (word >>> SOP2_SDST_SHIFT) & SOP2_SDST_MASK;
      const ssrc1 = (word >>> SOP2_SSRC1_SHIFT) & SOP2_SSRC1_MASK;
      const ssrc0 = word & SOP2_SSRC0_MASK;

      const decoded: DecodedInstruction = {
        format,
        opcode,
        dst: sdst,
        src0Encoded: ssrc0,
        src1: ssrc1,
        address,
      };

      i++;

      // SOP2 supports literal when SSRC0 or SSRC1 == 0xFF
      if ((ssrc0 === 0xFF || ssrc1 === 0xFF) && i < binary.length) {
        decoded.literal = binary[i];
        i++;
      }

      instructions.push(decoded);
    } else if (format === InstructionFormat.SOPK) {
      // SOPK: bits[31:28]=0b1011, [27:23]=OP(5), [22:16]=SDST(7), [15:0]=SIMM16(16)
      const opcode = (word >>> SOPK_OP_SHIFT) & SOPK_OP_MASK;
      const sdst = (word >>> SOPK_SDST_SHIFT) & SOPK_SDST_MASK;
      const simm16 = word & SOPK_SIMM16_MASK;

      const decoded: DecodedInstruction = {
        format,
        opcode,
        dst: sdst,
        src0Encoded: 0,
        simm16,
        address,
      };

      i++;

      // s_setreg_imm32_b32 (opcode 0x15) has a 32-bit literal following
      if (opcode === 0x15 && i < binary.length) {
        decoded.literal = binary[i];
        i++;
      }

      instructions.push(decoded);
    } else if (format === InstructionFormat.SMEM) {
      // SMEM: 2 dwords
      if (i + 1 >= binary.length) break;
      const dword0 = word;
      const dword1 = binary[i + 1];

      const opcode = (dword0 >>> SMEM_OP_SHIFT) & SMEM_OP_MASK;
      const sdata = (dword0 >>> SMEM_SDATA_SHIFT) & SMEM_SDATA_MASK;
      const sbase = dword0 & SMEM_SBASE_MASK;
      const offset = dword1 & SMEM_OFFSET_MASK;

      instructions.push({
        format,
        opcode,
        dst: sdata,
        src0Encoded: 0,
        sbase,
        offset,
        address,
      });

      i += 2;
    } else if (format === InstructionFormat.MUBUF) {
      // MUBUF: 2 dwords
      if (i + 1 >= binary.length) break;
      const dword0 = word;
      const dword1 = binary[i + 1];

      const opcode = (dword0 >>> MUBUF_OP_SHIFT) & MUBUF_OP_MASK;
      const mubufOffset = dword0 & MUBUF_OFFSET_MASK;
      const glc = (dword0 >>> 14) & 1;
      const idxen = (dword0 >>> 13) & 1;
      const offen = (dword0 >>> 12) & 1;

      const vaddr = dword1 & 0xFF;
      const vdata = (dword1 >>> 8) & 0xFF;
      const srsrcQuad = (dword1 >>> 16) & 0x1F;

      instructions.push({
        format,
        opcode,
        dst: vdata,
        src0Encoded: vaddr,
        srsrc: srsrcQuad,
        offset: mubufOffset,
        flags: (glc << 2) | (idxen << 1) | offen,
        address,
      });

      i += 2;
    } else if (format === InstructionFormat.MIMG) {
      // MIMG: 2-3 dwords depending on NSA
      if (i + 1 >= binary.length) break;
      const dword0 = word;
      const dword1 = binary[i + 1];

      const opcode = (dword0 >>> MIMG_OP_SHIFT) & MIMG_OP_MASK;
      const dmask = (dword0 >>> 14) & 0xF;
      const nsa = dword0 & 0x7;

      const vaddr = dword1 & 0xFF;
      const vdata = (dword1 >>> 8) & 0xFF;
      const srsrcQuad = (dword1 >>> 16) & 0x1F;
      const ssampQuad = (dword1 >>> 21) & 0x1F;

      instructions.push({
        format,
        opcode,
        dst: vdata,
        src0Encoded: vaddr,
        srsrc: srsrcQuad,
        ssamp: ssampQuad,
        dmask,
        address,
      });

      // Consume extra dwords for NSA mode
      const extraDwords = nsa > 0 ? Math.ceil(nsa / 4) : 0;
      i += 2 + extraDwords;
    } else if (format === InstructionFormat.MTBUF) {
      // MTBUF: 2 dwords, just skip
      if (i + 1 >= binary.length) break;
      instructions.push({
        format,
        opcode: 0,
        dst: 0,
        src0Encoded: 0,
        address,
      });
      i += 2;
    } else if (format === InstructionFormat.DS) {
      // DS: 2 dwords
      // Dword 0: [31:26]=0x36, [25:18]=OP(8), [17]=GDS, [15:8]=OFFSET1(8), [7:0]=OFFSET0(8)
      // Dword 1: [31:24]=VDST(8), [23:16]=DATA1(8), [15:8]=DATA0(8), [7:0]=ADDR(8)
      if (i + 1 >= binary.length) break;
      const dword0 = word;
      const dword1 = binary[i + 1];

      const opcode = (dword0 >>> DS_OP_SHIFT) & DS_OP_MASK;
      const offset0 = dword0 & 0xFF;
      const offset1 = (dword0 >>> 8) & 0xFF;

      const addr = dword1 & 0xFF;
      const data0 = (dword1 >>> 8) & 0xFF;
      const data1 = (dword1 >>> 16) & 0xFF;
      const vdst = (dword1 >>> 24) & 0xFF;

      instructions.push({
        format,
        opcode,
        dst: vdst,
        src0Encoded: addr,
        src1: data0,
        src2: data1,
        offset: offset0 | (offset1 << 8),
        address,
      });

      i += 2;
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
        src1: VGPR_SRC_MIN + vsrc1, // store as 9-bit encoding for consistency with VOP3
        address,
      };

      i++;

      // DPP8 (SRC0=0xE9), SDWA (SRC0=0xF9), DPP16 (SRC0=0xFA), or literal constant (SRC0=0xFF)
      if ((src0 === 0xE9 || src0 === 0xF9 || src0 === 0xFA || src0 === LITERAL_CONST) && i < binary.length) {
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
  lookupFn?: (format: InstructionFormat, opcode: number) => { mnemonic: string; isIntegerOp?: boolean } | undefined,
): string {
  const info = lookupFn?.(decoded.format, decoded.opcode);
  const mnemonic = info ? info.mnemonic : `v_unknown_${decoded.format.toLowerCase()}_0x${decoded.opcode.toString(16)}`;
  const isInt = !!(info as Record<string, unknown> | undefined)?.isIntegerOp ||
    mnemonic.endsWith('_b32') || mnemonic.endsWith('_b64') ||
    mnemonic.endsWith('_u32') || mnemonic.endsWith('_i32') ||
    mnemonic.endsWith('_u16') || mnemonic.endsWith('_i16');

  if (decoded.format === InstructionFormat.SOPP) {
    if (decoded.simm16 !== undefined && decoded.simm16 !== 0) {
      return `${mnemonic} 0x${decoded.simm16.toString(16).padStart(4, '0')}`;
    }
    return mnemonic;
  }

  if (decoded.format === InstructionFormat.SOP1) {
    const dst = formatSpecialOrSgpr(decoded.dst);
    const src0 = formatSsrc0(decoded.src0Encoded, decoded.literal);
    return `${mnemonic} ${dst}, ${src0}`;
  }

  if (decoded.format === InstructionFormat.SOP2) {
    const dst = formatSpecialOrSgpr(decoded.dst);
    const src0 = formatSsrc0(decoded.src0Encoded, decoded.literal);
    const src1 = formatSsrc0(decoded.src1 ?? 0, decoded.literal);
    return `${mnemonic} ${dst}, ${src0}, ${src1}`;
  }

  if (decoded.format === InstructionFormat.SOPC) {
    const src0 = formatSsrc0(decoded.src0Encoded, decoded.literal);
    const src1 = formatSsrc0(decoded.src1 ?? 0, decoded.literal);
    return `${mnemonic} ${src0}, ${src1}`;
  }

  if (decoded.format === InstructionFormat.SOPK) {
    const dst = formatSpecialOrSgpr(decoded.dst);
    if (decoded.literal !== undefined) {
      return `${mnemonic} ${dst}, 0x${decoded.simm16?.toString(16).padStart(4, '0') ?? '0000'}, 0x${(decoded.literal >>> 0).toString(16).padStart(8, '0')}`;
    }
    return `${mnemonic} ${dst}, 0x${decoded.simm16?.toString(16).padStart(4, '0') ?? '0000'}`;
  }

  if (decoded.format === InstructionFormat.SMEM) {
    const sdata = `s${decoded.dst}`;
    const sbase = `s[${(decoded.sbase ?? 0) * 2}:${(decoded.sbase ?? 0) * 2 + 1}]`;
    const off = decoded.offset ?? 0;
    return `${mnemonic} ${sdata}, ${sbase}, 0x${off.toString(16).padStart(4, '0')}`;
  }

  if (decoded.format === InstructionFormat.MUBUF) {
    const vdata = `v${decoded.dst}`;
    const vaddr = `v${decoded.src0Encoded}`;
    const srsrcIdx = (decoded.srsrc ?? 0) * 4;
    const srsrc = `s[${srsrcIdx}:${srsrcIdx + 3}]`;
    const parts = [mnemonic, `${vdata},`, `${vaddr},`, `${srsrc},`, '0'];
    const flagBits = decoded.flags ?? 0;
    if (flagBits & 2) parts.push('idxen');
    if (flagBits & 4) parts.push('glc');
    if ((decoded.offset ?? 0) > 0) parts.push(`offset:${decoded.offset}`);
    return parts.join(' ');
  }

  if (decoded.format === InstructionFormat.MIMG) {
    const vdata = `v${decoded.dst}`;
    const vaddr = `v${decoded.src0Encoded}`;
    const srsrcIdx = (decoded.srsrc ?? 0) * 4;
    const srsrc = `s[${srsrcIdx}:${srsrcIdx + 7}]`;
    const ssampIdx = (decoded.ssamp ?? 0) * 4;
    const ssamp = `s[${ssampIdx}:${ssampIdx + 3}]`;
    return `${mnemonic} ${vdata}, ${vaddr}, ${srsrc}, ${ssamp}`;
  }

  if (decoded.format === InstructionFormat.MTBUF) {
    return `mtbuf_unknown_0x${decoded.opcode.toString(16)}`;
  }

  if (decoded.format === InstructionFormat.DS) {
    const offset0 = (decoded.offset ?? 0) & 0xFF;
    const offset1 = ((decoded.offset ?? 0) >>> 8) & 0xFF;
    const isWrite = mnemonic.includes('write');
    const isSwizzle = mnemonic.includes('swizzle');
    const is2 = mnemonic.includes('2');

    if (isSwizzle) {
      const combinedOffset = (offset1 << 8) | offset0;
      return `${mnemonic} v${decoded.dst}, v${decoded.src0Encoded} offset:${combinedOffset}`;
    } else if (isWrite) {
      const parts = [`${mnemonic} v${decoded.src0Encoded}, v${decoded.src1 ?? 0}`];
      if (is2) parts[0] += `, v${decoded.src2 ?? 0}`;
      if (offset0) parts.push(`offset0:${offset0}`);
      if (offset1) parts.push(`offset1:${offset1}`);
      return parts.join(' ');
    } else {
      // read
      const parts = [`${mnemonic} v${decoded.dst}, v${decoded.src0Encoded}`];
      if (offset0) parts.push(`offset:${offset0}`);
      if (offset1) parts.push(`offset1:${offset1}`);
      return parts.join(' ');
    }
  }

  if (decoded.format === InstructionFormat.VOPC) {
    const src0 = formatSrc0(decoded.src0Encoded, decoded.literal, isInt);
    const src1 = formatSrc0(decoded.src1!, decoded.literal, isInt);
    const isCmpx = mnemonic.startsWith('v_cmpx_');
    // VOP3-promoted VOPC can write to an SGPR pair instead of VCC
    let dest: string;
    if (isCmpx) {
      dest = 'exec';
    } else if (decoded.dst === 106) {
      dest = 'vcc'; // VCC_LO
    } else {
      dest = `s${decoded.dst}`;
    }
    return `${mnemonic} ${dest}, ${src0}, ${src1}`;
  }

  const dst = `v${decoded.dst}`;
  let src0 = formatSrc0(decoded.src0Encoded, decoded.literal, isInt);
  if (decoded.src0Abs) src0 = `abs(${src0})`;
  if (decoded.src0Neg) src0 = `-${src0}`;

  // Output modifier suffixes
  const suffixes: string[] = [];
  if (decoded.clamp) suffixes.push('clamp');
  if (decoded.omod === 1) suffixes.push('mul:2');
  if (decoded.omod === 2) suffixes.push('mul:4');
  if (decoded.omod === 3) suffixes.push('div:2');
  const suffix = suffixes.length > 0 ? ' ' + suffixes.join(' ') : '';

  // Determine how many source operands to show based on opcode info
  const opInfo = info as { operandCount?: number } | undefined;
  const srcCount = opInfo?.operandCount ? opInfo.operandCount - 1 : // subtract dst
    (decoded.src2 !== undefined && decoded.src2 !== 0 ? 3 :
     decoded.src1 !== undefined ? 2 : 1);

  if (srcCount >= 3 && decoded.src2 !== undefined) {
    let src1 = formatSrc0(decoded.src1!, decoded.literal, isInt);
    if (decoded.src1Abs) src1 = `abs(${src1})`;
    if (decoded.src1Neg) src1 = `-${src1}`;
    let src2 = formatSrc0(decoded.src2, decoded.literal, isInt);
    if (decoded.src2Abs) src2 = `abs(${src2})`;
    if (decoded.src2Neg) src2 = `-${src2}`;
    return `${mnemonic} ${dst}, ${src0}, ${src1}, ${src2}${suffix}`;
  } else if (srcCount >= 2 && decoded.src1 !== undefined) {
    let src1 = formatSrc0(decoded.src1, decoded.literal, isInt);
    if (decoded.src1Abs) src1 = `abs(${src1})`;
    if (decoded.src1Neg) src1 = `-${src1}`;
    return `${mnemonic} ${dst}, ${src0}, ${src1}${suffix}`;
  } else {
    return `${mnemonic} ${dst}, ${src0}${suffix}`;
  }
}

function formatSrc0(encoded: number, literal?: number, isInt = false): string {
  if (encoded >= VGPR_SRC_MIN) return `v${encoded - VGPR_SRC_MIN}`;
  // Check special registers in the SGPR range
  if (encoded in SPECIAL_REG_NAMES) return SPECIAL_REG_NAMES[encoded];
  if (encoded <= 105) return `s${encoded}`;
  if (encoded === LITERAL_CONST && literal !== undefined) {
    if (isInt) {
      // Integer instruction: always show as hex
      return '0x' + (literal >>> 0).toString(16).padStart(8, '0');
    }
    f32Buf[0] = 0;
    u32Buf[0] = literal;
    const fval = f32Buf[0];
    // Show as hex if the float value is not a "nice" number
    if (!Number.isFinite(fval) || Math.abs(fval) > 1e15 || Math.abs(fval) < 1e-6 && fval !== 0) {
      return '0x' + (literal >>> 0).toString(16).padStart(8, '0');
    }
    const s = fval.toString();
    if (!s.includes('.') && !s.includes('e')) return s + '.0';
    return s;
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
  // Special registers
  if (encoded in SPECIAL_REG_NAMES) return SPECIAL_REG_NAMES[encoded];
  // SGPRs
  if (encoded <= 105) return `s${encoded}`;
  // Literal
  if (encoded === 0xFF && literal !== undefined) {
    return `0x${(literal >>> 0).toString(16)}`;
  }
  // Inline constants
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
  106: 'vcc',
  107: 'vcc_hi',
  124: 'm0',
  125: 'null',
  126: 'exec',
  127: 'exec_hi',
};

function formatSpecialOrSgpr(encoded: number): string {
  if (encoded in SPECIAL_REG_NAMES) return SPECIAL_REG_NAMES[encoded];
  return `s${encoded}`;
}
