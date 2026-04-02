// ── Instruction Decoder ──
// Combines binary decoding with opcode lookup into resolved instructions

import { DecodedInstruction, OpcodeInfo } from '../isa/types';
import { decodeBinary } from '../isa/encoding';
import { lookupByOpcode } from '../isa/opcodes';

export interface ResolvedInstruction {
  decoded: DecodedInstruction;
  opcodeInfo: OpcodeInfo;
}

/**
 * Decode a binary program into resolved instructions.
 * Each instruction pairs its decoded fields with the matching opcode info
 * (mnemonic, format, and semantic execute function).
 */
export function decodeProgram(binary: Uint32Array): ResolvedInstruction[] {
  const decoded = decodeBinary(binary);
  const resolved: ResolvedInstruction[] = [];

  for (const instr of decoded) {
    const info = lookupByOpcode(instr.format, instr.opcode);
    if (!info) {
      throw new Error(
        `Unknown opcode ${instr.opcode} for format ${instr.format} at address ${instr.address}`,
      );
    }
    resolved.push({ decoded: instr, opcodeInfo: info });
  }

  return resolved;
}
