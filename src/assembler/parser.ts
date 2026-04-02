// ── AMD Assembly Parser ──

import { Token, TokenType } from './lexer';
import {
  ParsedInstruction,
  Operand,
  OperandType,
  AssemblyError,
  InstructionFormat,
} from '../isa/types';
import { lookupByMnemonic } from '../isa/opcodes';
import {
  tryEncodeInline,
  encodeVGPR,
  LITERAL_CONST,
  NUM_VGPRS,
  NUM_SGPRS,
  VCC_LO,
  VCC_HI,
  M0_REG,
  NULL_REG,
  EXEC_LO,
  EXEC_HI,
} from '../isa/constants';
import {
  unknownMnemonic,
  invalidRegister,
  wrongOperandCount,
  invalidLiteral,
  src0Constraint,
} from './errors';

export interface ParseResult {
  instructions: ParsedInstruction[];
  errors: AssemblyError[];
}

export function parse(tokens: Token[]): ParseResult {
  const instructions: ParsedInstruction[] = [];
  const errors: AssemblyError[] = [];
  let pos = 0;

  function peek(): Token {
    return tokens[pos];
  }

  function advance(): Token {
    return tokens[pos++];
  }

  function skipNewlines(): void {
    while (pos < tokens.length && peek().type === TokenType.NEWLINE) {
      advance();
    }
  }

  while (pos < tokens.length) {
    skipNewlines();
    if (pos >= tokens.length || peek().type === TokenType.EOF) break;

    const tok = peek();

    if (tok.type !== TokenType.MNEMONIC) {
      // Skip unexpected tokens until next newline
      while (pos < tokens.length && peek().type !== TokenType.NEWLINE && peek().type !== TokenType.EOF) {
        advance();
      }
      continue;
    }

    const mnemonicToken = advance();
    const info = lookupByMnemonic(mnemonicToken.value);

    if (!info) {
      errors.push(unknownMnemonic(mnemonicToken.value, mnemonicToken.line, mnemonicToken.column));
      while (pos < tokens.length && peek().type !== TokenType.NEWLINE && peek().type !== TokenType.EOF) {
        advance();
      }
      continue;
    }

    // Collect operand groups (handling modifiers like abs(v0), |v0|)
    interface OperandGroup {
      token: Token;
      abs: boolean;
      neg: boolean;
    }
    const operandGroups: OperandGroup[] = [];

    // Collect all non-comma, non-newline tokens for this instruction
    const rawTokens: Token[] = [];
    while (pos < tokens.length && peek().type !== TokenType.NEWLINE && peek().type !== TokenType.EOF) {
      const t = peek();
      if (t.type === TokenType.COMMA) {
        advance();
        continue;
      }
      rawTokens.push(advance());
    }

    // Parse raw tokens into operand groups with modifier flags
    let ri = 0;
    while (ri < rawTokens.length) {
      let abs = false;
      let neg = false;
      let expectClose: TokenType | null = null;

      // Check for abs( or neg( modifier
      while (ri < rawTokens.length && rawTokens[ri].type === TokenType.MODIFIER) {
        if (rawTokens[ri].value === 'abs') abs = true;
        if (rawTokens[ri].value === 'neg') neg = true;
        ri++;
        // Skip opening paren
        if (ri < rawTokens.length && rawTokens[ri].type === TokenType.LPAREN) {
          expectClose = TokenType.RPAREN;
          ri++;
        }
      }

      // Check for | abs syntax
      if (ri < rawTokens.length && rawTokens[ri].type === TokenType.PIPE) {
        abs = true;
        expectClose = TokenType.PIPE;
        ri++;
      }

      // The actual operand token
      if (ri < rawTokens.length && (rawTokens[ri].type === TokenType.REGISTER || rawTokens[ri].type === TokenType.NUMBER)) {
        operandGroups.push({ token: rawTokens[ri], abs, neg });
        ri++;
      } else {
        ri++;
        continue;
      }

      // Skip closing ) or | only if we opened one
      if (expectClose !== null && ri < rawTokens.length && rawTokens[ri].type === expectClose) {
        ri++;
      }
    }

    // VOPC special handling: accept 2 or 3 operands (optional vcc dest)
    let expectedCount = info.operandCount;
    if (info.format === InstructionFormat.VOPC) {
      // Strip leading "vcc" operand if present (it's implicit)
      if (operandGroups.length === 3 && operandGroups[0].token.value === 'vcc') {
        operandGroups.shift();
      }
      expectedCount = 2; // always 2 source operands
    }

    if (operandGroups.length !== expectedCount) {
      errors.push(wrongOperandCount(expectedCount, operandGroups.length, mnemonicToken.line, mnemonicToken.column));
      continue;
    }

    // Parse operands based on instruction format
    const parsed = parseOperands(info.format, expectedCount,
      operandGroups.map(g => g.token),
      errors,
    );
    if (!parsed) continue;

    // Apply modifiers to source operands
    // For VOPC: both operands are sources (stored in dst/src0 of OperandSet)
    const src0Group = info.format === InstructionFormat.VOPC ? 0 : 1;
    const src1Group = info.format === InstructionFormat.VOPC ? 1 : 2;

    if (operandGroups.length > src0Group) {
      if (operandGroups[src0Group].abs) parsed.src0.abs = true;
      if (operandGroups[src0Group].neg) parsed.src0.neg = true;
    }
    if (operandGroups.length > src1Group && parsed.src1) {
      if (operandGroups[src1Group].abs) parsed.src1.abs = true;
      if (operandGroups[src1Group].neg) parsed.src1.neg = true;
    }

    instructions.push({
      mnemonic: mnemonicToken.value,
      dst: parsed.dst,
      src0: parsed.src0,
      src1: parsed.src1,
      line: mnemonicToken.line,
      column: mnemonicToken.column,
    });
  }

  return { instructions, errors };
}

interface OperandSet {
  dst: Operand;
  src0: Operand;
  src1?: Operand;
}

function parseOperands(
  format: InstructionFormat,
  _operandCount: number,
  tokens: Token[],
  errors: AssemblyError[],
): OperandSet | null {
  if (format === InstructionFormat.VOPC) {
    // VOPC: src0, vsrc1 (no destination — result to VCC)
    const src0 = parseSrc0Operand(tokens[0], errors);
    if (!src0) return null;
    const vsrc1 = parseVsrc1Operand(tokens[1], errors);
    if (!vsrc1) return null;
    // Store src0 as "dst" and vsrc1 as "src0" for the encoding to pick up
    return { dst: src0, src0: vsrc1 };
  }

  if (format === InstructionFormat.SOP1) {
    // SOP1: sdst, ssrc0
    const dst = parseSgprDestOperand(tokens[0], errors);
    if (!dst) return null;
    const src0 = parseSsrc0Operand(tokens[1], errors);
    if (!src0) return null;
    return { dst, src0 };
  }

  if (format === InstructionFormat.VOP1) {
    // VOP1: dst, src0
    const dst = parseDestOperand(tokens[0], errors);
    if (!dst) return null;
    const src0 = parseSrc0Operand(tokens[1], errors);
    if (!src0) return null;
    return { dst, src0 };
  }

  // VOP2: dst, src0, vsrc1
  const dst = parseDestOperand(tokens[0], errors);
  if (!dst) return null;
  const src0 = parseSrc0Operand(tokens[1], errors);
  if (!src0) return null;
  const vsrc1 = parseVsrc1Operand(tokens[2], errors);
  if (!vsrc1) return null;

  return { dst, src0, src1: vsrc1 };
}

// VDST: must be VGPR, encoded as plain 8-bit index
function parseDestOperand(token: Token, errors: AssemblyError[]): Operand | null {
  if (token.type === TokenType.REGISTER) {
    const reg = parseRegister(token);
    if (!reg) {
      errors.push(invalidRegister(token.value, token.line, token.column));
      return null;
    }
    if (reg.type !== OperandType.VGPR) {
      errors.push(invalidRegister(token.value, token.line, token.column));
      return null;
    }
    // VDST encoded as plain VGPR index
    return { type: OperandType.VGPR, value: reg.index, encoded: reg.index };
  }
  errors.push(invalidRegister(token.value, token.line, token.column));
  return null;
}

// SRC0: 9-bit encoded, can be VGPR, SGPR, inline constant, or literal
function parseSrc0Operand(token: Token, errors: AssemblyError[]): Operand | null {
  if (token.type === TokenType.REGISTER) {
    const reg = parseRegister(token);
    if (!reg) {
      errors.push(invalidRegister(token.value, token.line, token.column));
      return null;
    }
    if (reg.type === OperandType.VGPR) {
      // 9-bit: VGPR uses 256+index
      return { type: OperandType.VGPR, value: reg.index, encoded: encodeVGPR(reg.index) };
    }
    // SGPR: encoded directly as index
    return { type: OperandType.SGPR, value: reg.index, encoded: reg.index };
  }

  if (token.type === TokenType.NUMBER) {
    return parseNumericOperand(token, errors);
  }

  errors.push(invalidLiteral(token.value, token.line, token.column));
  return null;
}

// VSRC1: must be VGPR, encoded as plain 8-bit index
function parseVsrc1Operand(token: Token, errors: AssemblyError[]): Operand | null {
  if (token.type === TokenType.REGISTER) {
    const reg = parseRegister(token);
    if (!reg) {
      errors.push(invalidRegister(token.value, token.line, token.column));
      return null;
    }
    if (reg.type !== OperandType.VGPR) {
      errors.push(src0Constraint(token.line, token.column));
      return null;
    }
    // VSRC1 encoded as plain VGPR index
    return { type: OperandType.VGPR, value: reg.index, encoded: reg.index };
  }

  // VSRC1 must be VGPR
  errors.push(src0Constraint(token.line, token.column));
  return null;
}

// SDST: must be SGPR or special register, encoded as 7-bit index
function parseSgprDestOperand(token: Token, errors: AssemblyError[]): Operand | null {
  if (token.type === TokenType.REGISTER) {
    const reg = parseRegister(token);
    if (!reg) {
      errors.push(invalidRegister(token.value, token.line, token.column));
      return null;
    }
    if (reg.type === OperandType.SGPR || reg.type === OperandType.SPECIAL) {
      return { type: reg.type, value: reg.index, encoded: reg.index };
    }
    errors.push(invalidRegister(token.value, token.line, token.column));
    return null;
  }
  errors.push(invalidRegister(token.value, token.line, token.column));
  return null;
}

// SSRC0: 8-bit, can be SGPR, special register, or inline constant (not VGPR)
function parseSsrc0Operand(token: Token, errors: AssemblyError[]): Operand | null {
  if (token.type === TokenType.REGISTER) {
    const reg = parseRegister(token);
    if (!reg) {
      errors.push(invalidRegister(token.value, token.line, token.column));
      return null;
    }
    if (reg.type === OperandType.SGPR || reg.type === OperandType.SPECIAL) {
      return { type: reg.type, value: reg.index, encoded: reg.index };
    }
    errors.push(invalidRegister(token.value, token.line, token.column));
    return null;
  }
  if (token.type === TokenType.NUMBER) {
    return parseNumericOperand(token, errors);
  }
  errors.push(invalidLiteral(token.value, token.line, token.column));
  return null;
}

interface RegisterInfo {
  type: OperandType.VGPR | OperandType.SGPR | OperandType.SPECIAL;
  index: number;
}

const SPECIAL_REG_MAP: Record<string, number> = {
  'vcc_lo': VCC_LO,
  'vcc_hi': VCC_HI,
  'vcc': VCC_LO,
  'exec_lo': EXEC_LO,
  'exec_hi': EXEC_HI,
  'exec': EXEC_LO,
  'm0': M0_REG,
  'null': NULL_REG,
};

function parseRegister(token: Token): RegisterInfo | null {
  const val = token.value.toLowerCase();

  // Special registers
  if (val in SPECIAL_REG_MAP) {
    return { type: OperandType.SPECIAL, index: SPECIAL_REG_MAP[val] };
  }

  if (val.startsWith('v')) {
    const idx = parseInt(val.slice(1), 10);
    if (isNaN(idx) || idx < 0 || idx >= NUM_VGPRS) return null;
    return { type: OperandType.VGPR, index: idx };
  }
  if (val.startsWith('s')) {
    const idx = parseInt(val.slice(1), 10);
    if (isNaN(idx) || idx < 0 || idx >= NUM_SGPRS) return null;
    return { type: OperandType.SGPR, index: idx };
  }
  return null;
}

function parseNumericOperand(token: Token, errors: AssemblyError[]): Operand | null {
  const text = token.value;
  let value: number;

  if (text.startsWith('0x') || text.startsWith('0X') || text.startsWith('-0x') || text.startsWith('-0X')) {
    value = Number(text);
  } else if (text.includes('.')) {
    value = parseFloat(text);
  } else {
    value = parseInt(text, 10);
  }

  if (isNaN(value)) {
    errors.push(invalidLiteral(text, token.line, token.column));
    return null;
  }

  // Try inline constant encoding first
  const inlineEncoded = tryEncodeInline(value);
  if (inlineEncoded !== null) {
    const isFloat = text.includes('.');
    return {
      type: isFloat ? OperandType.INLINE_FLOAT : OperandType.INLINE_INT,
      value,
      encoded: inlineEncoded,
    };
  }

  // Fall back to 32-bit literal
  return { type: OperandType.LITERAL, value, encoded: LITERAL_CONST };
}
