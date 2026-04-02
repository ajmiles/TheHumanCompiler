// ── Assembler Error Helpers ──

import { AssemblyError } from '../isa/types';

export function unknownMnemonic(name: string, line: number, col: number): AssemblyError {
  return { message: `Unknown instruction '${name}'`, line, column: col };
}

export function invalidRegister(name: string, line: number, col: number): AssemblyError {
  return { message: `Invalid register '${name}'`, line, column: col };
}

export function wrongOperandCount(expected: number, got: number, line: number, col: number): AssemblyError {
  return { message: `Expected ${expected} operands, got ${got}`, line, column: col };
}

export function invalidLiteral(text: string, line: number, col: number): AssemblyError {
  return { message: `Invalid numeric literal '${text}'`, line, column: col };
}

export function src0Constraint(line: number, col: number): AssemblyError {
  return { message: `VSRC1 operand must be a VGPR`, line, column: col };
}
