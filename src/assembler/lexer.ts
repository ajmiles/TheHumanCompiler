// ── AMD Assembly Lexer ──

export enum TokenType {
  MNEMONIC = 'MNEMONIC',
  REGISTER = 'REGISTER',
  NUMBER = 'NUMBER',
  COMMA = 'COMMA',
  NEWLINE = 'NEWLINE',
  COMMENT = 'COMMENT',
  MODIFIER = 'MODIFIER',  // abs, neg
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  PIPE = 'PIPE',           // | for |src| abs syntax
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

const REGISTER_RE = /^[vs]\d+$/;
const SPECIAL_REGS = new Set(['exec', 'exec_lo', 'exec_hi', 'vcc', 'vcc_lo', 'vcc_hi', 'm0', 'null']);
const MODIFIERS = new Set(['abs', 'neg', 'clamp', 'idxen', 'offen', 'glc']);
const MNEMONIC_RE = /^[a-z_][a-z0-9_]*$/;

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const lines = source.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineText = lines[lineIdx];
    const lineNum = lineIdx + 1;
    let col = 0;

    while (col < lineText.length) {
      const ch = lineText[col];

      // Skip whitespace (not newline — handled per-line)
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        col++;
        continue;
      }

      // Comment: skip rest of line
      if (ch === ';') {
        col = lineText.length;
        continue;
      }

      // Comma
      if (ch === ',') {
        tokens.push({ type: TokenType.COMMA, value: ',', line: lineNum, column: col + 1 });
        col++;
        continue;
      }

      // Parentheses
      if (ch === '(') {
        tokens.push({ type: TokenType.LPAREN, value: '(', line: lineNum, column: col + 1 });
        col++;
        continue;
      }
      if (ch === ')') {
        tokens.push({ type: TokenType.RPAREN, value: ')', line: lineNum, column: col + 1 });
        col++;
        continue;
      }

      // Pipe for |src| abs syntax
      if (ch === '|') {
        tokens.push({ type: TokenType.PIPE, value: '|', line: lineNum, column: col + 1 });
        col++;
        continue;
      }

      // Number: hex, float, or integer (may start with - for negative)
      // But '-' before a register (v/s) is a neg modifier, not a negative number
      if (ch === '-' && col + 1 < lineText.length) {
        const nextCh = lineText[col + 1];
        if (nextCh === 'v' || nextCh === 's' || nextCh === '|' || nextCh === 'a') {
          // Neg modifier before register, |abs|, or abs()
          tokens.push({ type: TokenType.MODIFIER, value: 'neg', line: lineNum, column: col + 1 });
          col++;
          continue;
        }
      }
      if (isDigit(ch) || (ch === '-' && col + 1 < lineText.length && isDigitOrDot(lineText[col + 1]))) {
        const start = col;
        if (ch === '-') col++;

        // Hex literal
        if (col + 1 < lineText.length && lineText[col] === '0' && (lineText[col + 1] === 'x' || lineText[col + 1] === 'X')) {
          col += 2;
          while (col < lineText.length && isHexDigit(lineText[col])) col++;
        } else {
          while (col < lineText.length && isDigit(lineText[col])) col++;
          // Float: check for decimal point
          if (col < lineText.length && lineText[col] === '.') {
            col++;
            while (col < lineText.length && isDigit(lineText[col])) col++;
          }
        }

        tokens.push({ type: TokenType.NUMBER, value: lineText.slice(start, col), line: lineNum, column: start + 1 });
        continue;
      }

      // Identifier: mnemonic or register
      if (isAlpha(ch) || ch === '_') {
        const start = col;
        while (col < lineText.length && isAlphaNum(lineText[col])) col++;
        const word = lineText.slice(start, col);
        const lower = word.toLowerCase();

        // Register range syntax: s[N:M] or v[N:M]
        if ((lower === 's' || lower === 'v') && col < lineText.length && lineText[col] === '[') {
          const rangeStart = col;
          col++; // skip [
          while (col < lineText.length && lineText[col] !== ']') col++;
          if (col < lineText.length) col++; // skip ]
          const fullToken = word + lineText.slice(rangeStart, col);
          tokens.push({ type: TokenType.REGISTER, value: fullToken.toLowerCase(), line: lineNum, column: start + 1 });
          continue;
        }

        if (REGISTER_RE.test(lower)) {
          tokens.push({ type: TokenType.REGISTER, value: lower, line: lineNum, column: start + 1 });
        } else if (SPECIAL_REGS.has(lower)) {
          tokens.push({ type: TokenType.REGISTER, value: lower, line: lineNum, column: start + 1 });
        } else if (MODIFIERS.has(lower)) {
          tokens.push({ type: TokenType.MODIFIER, value: lower, line: lineNum, column: start + 1 });
        } else if ((lower === 'mul' || lower === 'div' || lower === 'offset' || lower === 'offset0' || lower === 'offset1' ||
                    lower === 'row_shl' || lower === 'row_shr' || lower === 'row_ror' || lower === 'bound_ctrl' ||
                    lower === 'wave_shl' || lower === 'wave_shr' || lower === 'wave_rol' || lower === 'wave_ror') && col < lineText.length && lineText[col] === ':') {
          // Compound modifier: mul:2, row_shr:1, bound_ctrl:1, etc.
          col++; // skip ':'
          const dStart = col;
          // Handle hex (0x...) and decimal values
          if (col + 1 < lineText.length && lineText[col] === '0' && (lineText[col + 1] === 'x' || lineText[col + 1] === 'X')) {
            col += 2; // skip '0x'
            while (col < lineText.length && /[0-9a-fA-F]/.test(lineText[col])) col++;
          } else {
            while (col < lineText.length && isDigit(lineText[col])) col++;
          }
          const compound = lower + ':' + lineText.slice(dStart, col);
          tokens.push({ type: TokenType.MODIFIER, value: compound, line: lineNum, column: start + 1 });
        } else if ((lower === 'quad_perm' || lower === 'dpp8') && col < lineText.length && lineText[col] === ':') {
          // DPP bracket modifier: quad_perm:[3,2,1,0] or dpp8:[7,6,5,4,3,2,1,0]
          col++; // skip ':'
          const dStart = col;
          // Read until closing bracket
          while (col < lineText.length && lineText[col] !== ']') col++;
          if (col < lineText.length) col++; // skip ']'
          const compound = lower + ':' + lineText.slice(dStart, col);
          tokens.push({ type: TokenType.MODIFIER, value: compound, line: lineNum, column: start + 1 });
        } else if (lower === 'row_mirror' || lower === 'row_half_mirror' || lower === 'row_bcast15' || lower === 'row_bcast31') {
          tokens.push({ type: TokenType.MODIFIER, value: lower, line: lineNum, column: start + 1 });
        } else if (MNEMONIC_RE.test(lower)) {
          tokens.push({ type: TokenType.MNEMONIC, value: lower, line: lineNum, column: start + 1 });
        }
        continue;
      }

      // Unknown character — skip
      col++;
    }

    // Emit newline token after each line (except possibly the last empty line)
    if (lineIdx < lines.length - 1 || lineText.length > 0) {
      tokens.push({ type: TokenType.NEWLINE, value: '\n', line: lineNum, column: lineText.length + 1 });
    }
  }

  tokens.push({ type: TokenType.EOF, value: '', line: lines.length, column: 1 });
  return tokens;
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isDigitOrDot(ch: string): boolean {
  return isDigit(ch) || ch === '.';
}

function isHexDigit(ch: string): boolean {
  return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

function isAlpha(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isAlphaNum(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}
