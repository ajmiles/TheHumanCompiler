// ── AMD Assembly Lexer ──

export enum TokenType {
  MNEMONIC = 'MNEMONIC',
  REGISTER = 'REGISTER',
  NUMBER = 'NUMBER',
  COMMA = 'COMMA',
  NEWLINE = 'NEWLINE',
  COMMENT = 'COMMENT',
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

      // Number: hex, float, or integer (may start with - for negative)
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

        if (REGISTER_RE.test(lower)) {
          tokens.push({ type: TokenType.REGISTER, value: lower, line: lineNum, column: start + 1 });
        } else if (SPECIAL_REGS.has(lower)) {
          tokens.push({ type: TokenType.REGISTER, value: lower, line: lineNum, column: start + 1 });
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
