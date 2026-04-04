// ── Top-Level Assembler ──

import { AssemblyResult, ParsedInstruction } from '../isa/types';
import { assembleToBinary, encodeInstruction } from '../isa/encoding';
import { tokenize, TokenType } from './lexer';
import { parse } from './parser';

/**
 * Collect label definitions from the token stream.
 * Returns a map of label name → index into the instruction array
 * (the label points to the instruction *after* the label definition).
 */
function collectLabels(source: string, _instructions: ParsedInstruction[]): Map<string, number> {
  const tokens = tokenize(source);
  const labels = new Map<string, number>();

  // Walk tokens and map label lines to instruction indices.
  // The parser skips LABEL tokens, so instructions don't include them.
  // We count how many instructions precede each label.
  let instrIdx = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === TokenType.LABEL) {
      labels.set(tok.value, instrIdx);
    } else if (tok.type === TokenType.NEWLINE || tok.type === TokenType.EOF) {
      // End of a line — if this line had a mnemonic, instrIdx advanced in parser
    } else if (tok.type === TokenType.MNEMONIC) {
      // This mnemonic corresponds to instructions[instrIdx]
      // (unless it was an error / skipped format — but we only reach here if no errors)
      instrIdx++;
    }
  }

  return labels;
}

export function assemble(source: string): AssemblyResult {
  const tokens = tokenize(source);
  const { instructions, errors } = parse(tokens);

  if (errors.length > 0) {
    return { binary: new Uint32Array(0), errors, instructions };
  }

  // Collect labels and compute word offsets per instruction
  const labels = collectLabels(source, instructions);
  const wordOffsets: number[] = [];
  let offset = 0;
  for (const instr of instructions) {
    wordOffsets.push(offset);
    offset += encodeInstruction(instr).length;
  }

  // Resolve label references → simm16 (PC-relative in dword units)
  for (let i = 0; i < instructions.length; i++) {
    const instr = instructions[i];
    if (instr.labelRef) {
      const targetIdx = labels.get(instr.labelRef);
      if (targetIdx !== undefined) {
        // Branch target = targetWordOffset, current PC = wordOffsets[i]
        // SOPP simm16 = target - (PC + 1) in instruction units
        // But our PC is in instruction indices, not word offsets.
        // The emulator uses instruction indices, so:
        // simm16 = targetIdx - (i + 1)
        instr.simm16 = (targetIdx - (i + 1)) & 0xFFFF;
      } else {
        errors.push({
          message: `Undefined label '${instr.labelRef}'`,
          line: instr.line,
          column: instr.column,
        });
      }
    }
  }

  if (errors.length > 0) {
    return { binary: new Uint32Array(0), errors, instructions };
  }

  const binary = assembleToBinary(instructions);
  return { binary, errors: [], instructions };
}
