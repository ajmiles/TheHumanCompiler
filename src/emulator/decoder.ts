// ── Instruction Decoder ──
// Combines binary decoding with opcode lookup into resolved instructions

import { DecodedInstruction, InstructionFormat, OpcodeInfo } from '../isa/types';
import { decodeBinary } from '../isa/encoding';
import { lookupByOpcode } from '../isa/opcodes';

export interface ResolvedInstruction {
  decoded: DecodedInstruction;
  opcodeInfo: OpcodeInfo;
}

/** Placeholder for an opcode missing from the table; executing it raises an emulator fault. */
function unknownOpcode(d: DecodedInstruction): OpcodeInfo {
  return {
    mnemonic: `${d.format.toLowerCase()}_opcode_0x${d.opcode.toString(16)}`,
    format: InstructionFormat.UNKNOWN,
    opcode: d.opcode,
    operandCount: 0,
    execute: (a) => a,
    description: 'Unknown instruction',
    syntax: '',
  };
}

/**
 * Decode a binary program into resolved instructions.
 * VOP3-encoded instructions keep their base format (VOP1/VOP2/VOPC) with the
 * VOP3 modifiers recorded on the DecodedInstruction.
 */
export function decodeProgram(binary: Uint32Array): ResolvedInstruction[] {
  return decodeBinary(binary).map((decoded) => ({
    decoded,
    opcodeInfo: lookupByOpcode(decoded.format, decoded.opcode) ?? unknownOpcode(decoded),
  }));
}
