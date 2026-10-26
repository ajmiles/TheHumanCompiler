// ── AMD Assembly Lexer ──

export enum TokenType {
  MNEMONIC = 'MNEMONIC',   // Identifier: instruction mnemonic, label reference or counter name
  REGISTER = 'REGISTER',
  NUMBER = 'NUMBER',
  COMMA = 'COMMA',
  NEWLINE = 'NEWLINE',
  COMMENT = 'COMMENT',
  MODIFIER = 'MODIFIER',   // abs, neg, clamp, row_shr:1, op_sel:[0,1], …
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  PIPE = 'PIPE',           // | for |src| abs syntax
  LABEL = 'LABEL',         // my_label: (definition)
  ERROR = 'ERROR',         // Unexpected character
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

const REGISTER_RE = /^(?:[vs]\d+|ttmp\d+)$/;
const SPECIAL_REGS = new Set([
  'exec', 'exec_lo', 'exec_hi', 'vcc', 'vcc_lo', 'vcc_hi', 'm0', 'null',
  'scc', 'vccz', 'execz', 'src_scc', 'src_vccz', 'src_execz',
]);
const FLAG_MODIFIERS = new Set([
  'abs', 'neg', 'clamp', 'idxen', 'offen', 'glc', 'gds',
  'row_mirror', 'row_half_mirror', 'row_bcast15', 'row_bcast31', 'bound_ctrl',
  'src0_sext', 'src1_sext',
]);
/** Modifiers written as name:number. */
const VALUE_MODIFIERS = new Set([
  'mul', 'div', 'offset', 'offset0', 'offset1',
  'row_shl', 'row_shr', 'row_ror', 'row_share', 'row_xmask', 'row_mask', 'bank_mask', 'bound_ctrl', 'fi',
  'wave_shl', 'wave_shr', 'wave_rol', 'wave_ror', 'row_bcast',
]);
/** Modifiers written as name:WORD. */
const WORD_MODIFIERS = new Set(['dst_sel', 'dst_unused', 'src0_sel', 'src1_sel']);
/** Modifiers written as name:[a,b,…]. */
const LIST_MODIFIERS = new Set(['quad_perm', 'dpp8', 'op_sel', 'op_sel_hi', 'neg_lo', 'neg_hi']);
const IDENT_RE = /^[a-z_.][a-z0-9_.$]*$/;

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const lines = source.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineText = lines[lineIdx];
    const lineNum = lineIdx + 1;
    let col = 0;
    const push = (type: TokenType, value: string, start: number) =>
      tokens.push({ type, value, line: lineNum, column: start + 1 });

    while (col < lineText.length) {
      const ch = lineText[col];

      if (ch === ' ' || ch === '\t' || ch === '\r') {
        col++;
        continue;
      }

      // Comments: ';' or '//' to end of line
      if (ch === ';' || (ch === '/' && lineText[col + 1] === '/')) {
        col = lineText.length;
        continue;
      }

      if (ch === ',') { push(TokenType.COMMA, ',', col); col++; continue; }
      if (ch === '(') { push(TokenType.LPAREN, '(', col); col++; continue; }
      if (ch === ')') { push(TokenType.RPAREN, ')', col); col++; continue; }
      if (ch === '|') { push(TokenType.PIPE, '|', col); col++; continue; }
      // '&' separates s_waitcnt counters: vmcnt(0) & lgkmcnt(0)
      if (ch === '&') { col++; continue; }

      // '-' before a register, |abs| or abs(...) is a neg modifier, not a negative number
      if (ch === '-' && col + 1 < lineText.length) {
        const nextCh = lineText[col + 1];
        if (isAlpha(nextCh) || nextCh === '|') {
          push(TokenType.MODIFIER, 'neg', col);
          col++;
          continue;
        }
      }

      // Number: hex, decimal integer or float (optional exponent), optionally negative
      if (isDigit(ch) || (ch === '.' && isDigit(lineText[col + 1] ?? '')) ||
          (ch === '-' && col + 1 < lineText.length && isDigitOrDot(lineText[col + 1]))) {
        const start = col;
        if (ch === '-') col++;
        if (lineText[col] === '0' && (lineText[col + 1] === 'x' || lineText[col + 1] === 'X')) {
          col += 2;
          while (col < lineText.length && isHexDigit(lineText[col])) col++;
        } else {
          while (col < lineText.length && isDigit(lineText[col])) col++;
          if (lineText[col] === '.') {
            col++;
            while (col < lineText.length && isDigit(lineText[col])) col++;
          }
          if ((lineText[col] === 'e' || lineText[col] === 'E') &&
              (isDigit(lineText[col + 1] ?? '') || ((lineText[col + 1] === '+' || lineText[col + 1] === '-') && isDigit(lineText[col + 2] ?? '')))) {
            col += 2;
            while (col < lineText.length && isDigit(lineText[col])) col++;
          }
        }
        push(TokenType.NUMBER, lineText.slice(start, col), start);
        continue;
      }

      // Identifier: mnemonic, register, modifier or label
      if (isAlpha(ch) || (ch === '.' && isAlpha(lineText[col + 1] ?? ''))) {
        const start = col;
        col++;
        while (col < lineText.length && (isAlphaNum(lineText[col]) || lineText[col] === '.' || lineText[col] === '$')) col++;
        const lower = lineText.slice(start, col).toLowerCase();
        const next = lineText[col];

        // Register range syntax: s[N:M], v[N:M], ttmp[N:M]
        if ((lower === 's' || lower === 'v' || lower === 'ttmp') && next === '[') {
          const close = lineText.indexOf(']', col);
          col = close < 0 ? lineText.length : close + 1;
          push(TokenType.REGISTER, (lower + lineText.slice(start + lower.length, col)).toLowerCase().replace(/\s+/g, ''), start);
          continue;
        }

        if (next === ':' && VALUE_MODIFIERS.has(lower)) {
          col++;
          const vStart = col;
          if (lineText[col] === '-') col++;
          if (lineText[col] === '0' && (lineText[col + 1] === 'x' || lineText[col + 1] === 'X')) {
            col += 2;
            while (col < lineText.length && isHexDigit(lineText[col])) col++;
          } else {
            while (col < lineText.length && isDigit(lineText[col])) col++;
          }
          push(TokenType.MODIFIER, `${lower}:${lineText.slice(vStart, col)}`, start);
          continue;
        }
        if (next === ':' && WORD_MODIFIERS.has(lower)) {
          col++;
          const vStart = col;
          while (col < lineText.length && isAlphaNum(lineText[col])) col++;
          push(TokenType.MODIFIER, `${lower}:${lineText.slice(vStart, col).toUpperCase()}`, start);
          continue;
        }
        if (next === ':' && LIST_MODIFIERS.has(lower)) {
          col++;
          const vStart = col;
          const close = lineText.indexOf(']', col);
          col = close < 0 ? lineText.length : close + 1;
          push(TokenType.MODIFIER, `${lower}:${lineText.slice(vStart, col).replace(/\s+/g, '')}`, start);
          continue;
        }

        if (REGISTER_RE.test(lower) || SPECIAL_REGS.has(lower)) {
          push(TokenType.REGISTER, lower, start);
        } else if (FLAG_MODIFIERS.has(lower) && next !== ':') {
          push(TokenType.MODIFIER, lower, start);
        } else if (next === ':' && IDENT_RE.test(lower)) {
          col++; // skip ':'
          push(TokenType.LABEL, lower, start);
        } else {
          push(TokenType.MNEMONIC, lower, start);
        }
        continue;
      }

      push(TokenType.ERROR, ch, col);
      col++;
    }

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
