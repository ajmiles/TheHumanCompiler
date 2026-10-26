// ── Top-Level Assembler ──

import { AssemblyError, AssemblyResult, ParsedInstruction } from '../isa/types';
import { encodeInstruction, EncodingError } from '../isa/encoding';
import { tokenize } from './lexer';
import { parse } from './parser';

function encodeOrReport(instr: ParsedInstruction, errors: AssemblyError[]): number[] | null {
  try {
    return encodeInstruction(instr);
  } catch (e) {
    if (!(e instanceof EncodingError)) throw e;
    errors.push({ message: e.message, line: instr.line, column: instr.column });
    return null;
  }
}

export function assemble(source: string): AssemblyResult {
  const { instructions, errors, labels } = parse(tokenize(source));
  if (errors.length > 0) {
    return { binary: new Uint32Array(0), errors, instructions };
  }

  // Dword address of every instruction (branch targets are dword offsets)
  const addresses: number[] = [];
  let address = 0;
  for (const instr of instructions) {
    addresses.push(address);
    const words = encodeOrReport(instr, errors);
    address += words ? words.length : 1;
  }
  addresses.push(address); // a label after the last instruction points at the end of the program

  // SOPP branches: SIMM16 = target - (address of the branch + 1), in dwords
  instructions.forEach((instr, i) => {
    if (!instr.labelRef) return;
    const target = labels.get(instr.labelRef);
    if (target === undefined) {
      errors.push({ message: `Undefined label '${instr.labelRef}'`, line: instr.line, column: instr.column });
      return;
    }
    const offset = addresses[target] - (addresses[i] + 1);
    if (offset < -0x8000 || offset > 0x7FFF) {
      errors.push({ message: `Branch to '${instr.labelRef}' is out of range (${offset} dwords)`, line: instr.line, column: instr.column });
      return;
    }
    instr.simm16 = offset & 0xFFFF;
  });

  if (errors.length > 0) {
    return { binary: new Uint32Array(0), errors, instructions };
  }

  const words: number[] = [];
  for (const instr of instructions) words.push(...encodeInstruction(instr));
  return { binary: new Uint32Array(words), errors: [], instructions };
}
