// ── Top-Level Assembler ──

import { AssemblyResult } from '../isa/types';
import { assembleToBinary } from '../isa/encoding';
import { tokenize } from './lexer';
import { parse } from './parser';

export function assemble(source: string): AssemblyResult {
  const tokens = tokenize(source);
  const { instructions, errors } = parse(tokens);

  if (errors.length > 0) {
    return { binary: new Uint32Array(0), errors, instructions };
  }

  const binary = assembleToBinary(instructions);
  return { binary, errors: [], instructions };
}
