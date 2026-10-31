// ── Top-Level Assembler ──

import { AssemblyError, AssemblyResult, ParsedInstruction } from '../isa/types';
import { encodeInstruction, encodingWarnings, EncodingError } from '../isa/encoding';
import { lookupByMnemonic } from '../isa/opcodes';
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

/** Every program must end by executing s_endpgm; without one, execution runs off the end and crashes. */
function checkWarnings(instructions: ParsedInstruction[]): AssemblyError[] {
  if (instructions.some(i => lookupByMnemonic(i.mnemonic)?.halts)) return [];
  const last = instructions[instructions.length - 1];
  if (!last) {
    return [{ message: 'The program has no s_endpgm, so running it will crash. Every program must finish by executing s_endpgm.', line: 1, column: 1 }];
  }
  return [{
    message: 'The program has no s_endpgm: execution will run off the end after this instruction and crash. ' +
      'Every program must finish by executing s_endpgm.',
    line: last.line,
    column: last.column,
  }];
}

export function assemble(source: string): AssemblyResult {
  const { instructions, errors, labels } = parse(tokenize(source));
  const warnings = checkWarnings(instructions);
  for (const instr of instructions) {
    for (const w of encodingWarnings(instr)) {
      warnings.push({ message: w.message, line: instr.line, column: instr.spans?.[w.slot]?.start ?? instr.column });
    }
  }
  if (errors.length > 0) {
    return { binary: new Uint32Array(0), errors, warnings, instructions };
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
    return { binary: new Uint32Array(0), errors, warnings, instructions };
  }

  const words: number[] = [];
  for (const instr of instructions) words.push(...encodeInstruction(instr));
  return { binary: new Uint32Array(words), errors: [], warnings, instructions };
}
