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
  FLOAT_TO_INLINE,
} from '../isa/constants';
import {
  unknownMnemonic,
  invalidRegister,
  wrongOperandCount,
  invalidLiteral,
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

    // Skip formats we can't assemble (memory ops, etc.) — just consume the line
    const assembleableFormats = new Set([
      InstructionFormat.VOP1, InstructionFormat.VOP2, InstructionFormat.VOP3,
      InstructionFormat.VOPC, InstructionFormat.SOP1, InstructionFormat.SOPP,
      InstructionFormat.SOP2, InstructionFormat.SOPC,
      InstructionFormat.SMEM, InstructionFormat.MUBUF,
      InstructionFormat.DS, InstructionFormat.MIMG,
    ]);
    if (!assembleableFormats.has(info.format)) {
      while (pos < tokens.length && peek().type !== TokenType.NEWLINE && peek().type !== TokenType.EOF) {
        advance();
      }
      continue;
    }

    // Memory/DS formats — different operand pattern, parsed separately
    if (info.format === InstructionFormat.SMEM ||
        info.format === InstructionFormat.MUBUF ||
        info.format === InstructionFormat.DS ||
        info.format === InstructionFormat.MIMG) {
      const memTokens: Token[] = [];
      while (pos < tokens.length && peek().type !== TokenType.NEWLINE && peek().type !== TokenType.EOF) {
        if (peek().type === TokenType.COMMA) { advance(); continue; }
        memTokens.push(advance());
      }

      const memInstr = parseMemoryFormat(info.format, memTokens, mnemonicToken, errors);
      if (memInstr) {
        instructions.push(memInstr);
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

    // Extract trailing output modifiers (mul:2, mul:4, div:2, clamp) from raw tokens
    let omod = 0;
    let clamp = false;
    while (rawTokens.length > 0 && rawTokens[rawTokens.length - 1].type === TokenType.MODIFIER) {
      const mod = rawTokens.pop()!;
      switch (mod.value) {
        case 'mul:2': omod = 1; break;
        case 'mul:4': omod = 2; break;
        case 'div:2': omod = 3; break;
        case 'clamp': clamp = true; break;
      }
    }

    // Parse raw tokens into operand groups with modifier flags
    let ri = 0;
    while (ri < rawTokens.length) {
      let abs = false;
      let neg = false;
      let expectClose: TokenType | null = null;

      // Check for abs( or neg( modifier — track order for validation
      let outerMod: 'abs' | 'neg' | null = null;
      while (ri < rawTokens.length && rawTokens[ri].type === TokenType.MODIFIER) {
        const modVal = rawTokens[ri].value;
        if (modVal === 'abs') { abs = true; outerMod = 'abs'; }
        if (modVal === 'neg') { neg = true; outerMod = 'neg'; }
        ri++;
        // Skip opening paren
        if (ri < rawTokens.length && rawTokens[ri].type === TokenType.LPAREN) {
          expectClose = TokenType.RPAREN;
          ri++;
          // Check for nested modifier inside parens: abs(neg(...)) is invalid
          if (ri < rawTokens.length && rawTokens[ri].type === TokenType.MODIFIER) {
            const innerMod = rawTokens[ri].value;
            if (outerMod === 'abs' && (innerMod === 'neg')) {
              errors.push({
                message: 'Invalid modifier order: hardware applies abs before neg. Use -abs(v) instead of abs(-v)',
                line: rawTokens[ri].line,
                column: rawTokens[ri].column,
              });
            }
            if (innerMod === 'neg') neg = true;
            if (innerMod === 'abs') abs = true;
            ri++;
            if (ri < rawTokens.length && rawTokens[ri].type === TokenType.LPAREN) ri++;
          }
        }
      }

      // Check for | abs syntax
      if (ri < rawTokens.length && rawTokens[ri].type === TokenType.PIPE) {
        abs = true;
        outerMod = 'abs';
        expectClose = TokenType.PIPE;
        ri++;
        // Check for neg inside |...|: |neg(v)| or |-v| is invalid
        if (ri < rawTokens.length && rawTokens[ri].type === TokenType.MODIFIER && rawTokens[ri].value === 'neg') {
          errors.push({
            message: 'Invalid modifier order: hardware applies abs before neg. Use -|v| instead of |-v|',
            line: rawTokens[ri].line,
            column: rawTokens[ri].column,
          });
          neg = true;
          ri++;
          if (ri < rawTokens.length && rawTokens[ri].type === TokenType.LPAREN) ri++;
        }
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

    // SOPP: no operands (e.g. s_endpgm)
    if (info.format === InstructionFormat.SOPP) {
      const nullOp: Operand = { type: OperandType.INLINE_INT, value: 0, encoded: 0 };
      instructions.push({
        mnemonic: mnemonicToken.value,
        dst: nullOp,
        src0: nullOp,
        line: mnemonicToken.line,
        column: mnemonicToken.column,
      });
      continue;
    }

    // VOPC special handling: accept 2 or 3 operands (optional vcc dest)
    let expectedCount = info.operandCount;
    if (info.format === InstructionFormat.VOPC) {
      // Strip leading destination operand if present (vcc, exec, or SGPR pair)
      if (operandGroups.length === 3) {
        const firstVal = operandGroups[0].token.value;
        if (firstVal === 'vcc' || firstVal === 'exec' || firstVal.match(/^s\d+$/)) {
          operandGroups.shift();
        }
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

    // Reject modifiers on destination operand
    if (info.format !== InstructionFormat.VOPC && operandGroups.length > 0) {
      const dstGroup = operandGroups[0];
      if (dstGroup.abs || dstGroup.neg) {
        errors.push({
          message: 'Source modifiers (abs/neg) cannot be applied to the destination register',
          line: dstGroup.token.line,
          column: dstGroup.token.column,
        });
        continue;
      }
    }

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
    const src2Group = 3;
    if (operandGroups.length > src2Group && parsed.src2) {
      if (operandGroups[src2Group].abs) parsed.src2.abs = true;
      if (operandGroups[src2Group].neg) parsed.src2.neg = true;
    }

    instructions.push({
      mnemonic: mnemonicToken.value,
      dst: parsed.dst,
      src0: parsed.src0,
      src1: parsed.src1,
      src2: parsed.src2,
      line: mnemonicToken.line,
      column: mnemonicToken.column,
      omod: omod || undefined,
      clamp: clamp || undefined,
    });
  }

  return { instructions, errors };
}

interface OperandSet {
  dst: Operand;
  src0: Operand;
  src1?: Operand;
  src2?: Operand;
}

function parseOperands(
  format: InstructionFormat,
  _operandCount: number,
  tokens: Token[],
  errors: AssemblyError[],
): OperandSet | null {
  if (format === InstructionFormat.VOP3) {
    // VOP3: can be 3-source (dst, src0, src1, src2) or 2-source (dst, src0, src1)
    const dst = parseDestOperand(tokens[0], errors);
    if (!dst) return null;
    const src0 = parseSrc0Operand(tokens[1], errors);
    if (!src0) return null;
    if (tokens.length >= 4) {
      const src1 = parseSrc0Operand(tokens[2], errors);
      if (!src1) return null;
      const src2 = parseSrc0Operand(tokens[3], errors);
      if (!src2) return null;
      return { dst, src0, src1, src2 };
    } else {
      const src1 = parseSrc0Operand(tokens[2], errors);
      if (!src1) return null;
      return { dst, src0, src1 };
    }
  }

  if (format === InstructionFormat.VOPC) {
    // VOPC: src0, src1 (no destination — result to VCC/SGPR)
    // Both sources use 9-bit encoding (VOP3-promoted allows any source type)
    const src0 = parseSrc0Operand(tokens[0], errors);
    if (!src0) return null;
    const src1 = parseSrc0Operand(tokens[1], errors);
    if (!src1) return null;
    return { dst: src0, src0: src1 };
  }

  if (format === InstructionFormat.SOP1) {
    // SOP1: sdst, ssrc0
    const dst = parseSgprDestOperand(tokens[0], errors);
    if (!dst) return null;
    const src0 = parseSsrc0Operand(tokens[1], errors);
    if (!src0) return null;
    return { dst, src0 };
  }

  if (format === InstructionFormat.SOP2) {
    // SOP2: sdst, ssrc0, ssrc1
    const dst = parseSgprDestOperand(tokens[0], errors);
    if (!dst) return null;
    const src0 = parseSsrc0Operand(tokens[1], errors);
    if (!src0) return null;
    const src1 = parseSsrc0Operand(tokens[2], errors);
    if (!src1) return null;
    return { dst, src0, src1 };
  }

  if (format === InstructionFormat.SOPC) {
    // SOPC: ssrc0, ssrc1 (no dest — writes SCC)
    const src0 = parseSsrc0Operand(tokens[0], errors);
    if (!src0) return null;
    const src1 = parseSsrc0Operand(tokens[1], errors);
    if (!src1) return null;
    const nullDst: Operand = { type: OperandType.INLINE_INT, value: 0, encoded: 0 };
    return { dst: nullDst, src0, src1 };
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
  // vsrc1 is VGPR-only in VOP2 encoding, but if a non-VGPR operand is given
  // (literal, SGPR, inline constant), we accept it and let the encoder
  // auto-promote to VOP3 where all sources are 9-bit.
  const dst = parseDestOperand(tokens[0], errors);
  if (!dst) return null;
  const src0 = parseSrc0Operand(tokens[1], errors);
  if (!src0) return null;
  const vsrc1 = parseSrc0Operand(tokens[2], errors); // accept any source type
  if (!vsrc1) return null;

  // For plain VOP2 encoding, VSRC1 needs plain VGPR index (0-255)
  // For VOP3-promoted, it uses 9-bit encoding (handled by encoder)
  if (vsrc1.type === OperandType.VGPR) {
    vsrc1.encoded = vsrc1.value; // plain 8-bit VGPR index for VOP2
  }

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

function parseMemoryFormat(
  _format: InstructionFormat,
  tokens: Token[],
  mnemonicToken: Token,
  errors: AssemblyError[],
): ParsedInstruction | null {
  // Separate register/number tokens from trailing modifier tokens
  const regTokens: Token[] = [];
  let offset = 0;
  let memFlags = 0;
  for (const t of tokens) {
    if (t.type === TokenType.MODIFIER) {
      if (t.value === 'idxen') memFlags |= 2;
      else if (t.value === 'offen') memFlags |= 1;
      else if (t.value === 'glc') memFlags |= 4;
      else if (t.value.startsWith('offset:')) offset = parseInt(t.value.slice(7), 10) || 0;
      else if (t.value.startsWith('offset0:')) offset = (offset & 0xFF00) | (parseInt(t.value.slice(8), 10) & 0xFF);
      else if (t.value.startsWith('offset1:')) offset = (offset & 0x00FF) | ((parseInt(t.value.slice(8), 10) & 0xFF) << 8);
    } else {
      regTokens.push(t);
    }
  }

  const nullOp: Operand = { type: OperandType.INLINE_INT, value: 0, encoded: 0 };

  // Parse each register/number token into an Operand
  const ops: Operand[] = [];
  for (const t of regTokens) {
    if (t.type === TokenType.REGISTER) {
      const reg = parseRegister(t);
      if (!reg) {
        errors.push(invalidRegister(t.value, t.line, t.column));
        return null;
      }
      ops.push({ type: reg.type, value: reg.index, encoded: reg.index });
    } else if (t.type === TokenType.NUMBER) {
      const numOp = parseNumericOperand(t, errors);
      if (!numOp) return null;
      ops.push(numOp);
    }
  }

  if (ops.length < 1) {
    errors.push(wrongOperandCount(2, ops.length, mnemonicToken.line, mnemonicToken.column));
    return null;
  }

  return {
    mnemonic: mnemonicToken.value,
    dst: ops[0] ?? nullOp,
    src0: ops[1] ?? nullOp,
    src1: ops[2],
    src2: ops[3],
    line: mnemonicToken.line,
    column: mnemonicToken.column,
    offset: offset || undefined,
    memFlags: memFlags || undefined,
  };
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

  // Register range syntax: v[N:M] or s[N:M]
  const rangeMatch = val.match(/^([vs])\[(\d+):(\d+)\]$/);
  if (rangeMatch) {
    const regType = rangeMatch[1] === 'v' ? OperandType.VGPR : OperandType.SGPR;
    const idx = parseInt(rangeMatch[2], 10);
    return { type: regType, index: idx };
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
  const isFloat = text.includes('.');
  let inlineEncoded: number | null = null;

  if (isFloat) {
    // Float literals: prefer inline float encoding (e.g. 1.0 → 242, not inline int 1 → 129)
    const floatEncoding = FLOAT_TO_INLINE.get(value);
    inlineEncoded = floatEncoding !== undefined ? floatEncoding : tryEncodeInline(value);
  } else {
    inlineEncoded = tryEncodeInline(value);
  }

  if (inlineEncoded !== null) {
    return {
      type: isFloat ? OperandType.INLINE_FLOAT : OperandType.INLINE_INT,
      value,
      encoded: inlineEncoded,
    };
  }

  // Fall back to 32-bit literal
  return { type: OperandType.LITERAL, value, encoded: LITERAL_CONST };
}
