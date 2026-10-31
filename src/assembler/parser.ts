// ── AMD Assembly Parser ──

import { Token, TokenType } from './lexer';
import {
  ParsedInstruction,
  Operand,
  OperandType,
  OperandSlot,
  AssemblyError,
  InstructionFormat,
  OpcodeInfo,
} from '../isa/types';
import { lookupByMnemonic } from '../isa/opcodes';
import {
  tryEncodeInline,
  encodeVGPR,
  LITERAL_CONST,
  NUM_VGPRS,
  SGPR_MAX,
  VCC_LO,
  VCC_HI,
  M0_REG,
  NULL_REG,
  EXEC_LO,
  EXEC_HI,
  TTMP_MIN,
  SRC_SCC,
  SRC_VCCZ,
  SRC_EXECZ,
} from '../isa/constants';
import { operandRegCount, valuSourceCount, vopTypes, OperandRole, hasPackedModifiers } from '../isa/operands';
import { planEncoding } from '../isa/encoding';
import { f32ToF16 } from '../isa/float16';
import { unknownMnemonic, invalidLiteral } from './errors';

export interface ParseResult {
  instructions: ParsedInstruction[];
  errors: AssemblyError[];
  /** Label name → index of the instruction that follows the label. */
  labels: Map<string, number>;
}

class ParseError extends Error {
  constructor(message: string, readonly token?: Token) {
    super(message);
  }
}

function errorAt(message: string, token?: Token): never {
  throw new ParseError(message, token);
}

/** Fields every parsed instruction starts with. */
type InstrBase = Pick<ParsedInstruction, 'mnemonic' | 'line' | 'column'> & Required<Pick<ParsedInstruction, 'spans'>>;

/** Record where an operand was written (from the first token to the last). */
function mark(instr: ParsedInstruction, slot: OperandSlot, first: Token | undefined, last = first): void {
  if (first && last) (instr.spans ??= {})[slot] = { start: first.column, end: last.end };
}

export function parse(tokens: Token[]): ParseResult {
  const instructions: ParsedInstruction[] = [];
  const errors: AssemblyError[] = [];
  const labels = new Map<string, number>();
  let pos = 0;

  while (pos < tokens.length) {
    const tok = tokens[pos];
    if (tok.type === TokenType.EOF) break;
    if (tok.type === TokenType.NEWLINE) {
      pos++;
      continue;
    }
    if (tok.type === TokenType.LABEL) {
      if (labels.has(tok.value)) {
        errors.push({ message: `Label '${tok.value}' is already defined`, line: tok.line, column: tok.column });
      } else {
        labels.set(tok.value, instructions.length);
      }
      pos++;
      continue;
    }

    const lineTokens: Token[] = [];
    while (pos < tokens.length && tokens[pos].type !== TokenType.NEWLINE && tokens[pos].type !== TokenType.EOF) {
      lineTokens.push(tokens[pos++]);
    }
    if (lineTokens[0].type !== TokenType.MNEMONIC) {
      const t = lineTokens[0];
      errors.push({ message: `Expected an instruction, found '${t.value}'`, line: t.line, column: t.column });
      continue;
    }

    try {
      const instr = parseInstruction(lineTokens[0], lineTokens.slice(1), errors);
      if (instr) instructions.push(instr);
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      const at = e.token ?? lineTokens[0];
      errors.push({ message: e.message, line: at.line, column: at.column });
    }
  }

  return { instructions, errors, labels };
}

// ── Operand groups ──

interface OperandGroup {
  token: Token;   // REGISTER, NUMBER or identifier (MNEMONIC)
  abs: boolean;
  neg: boolean;
  sext: boolean;  // SDWA sext(...) wrapper
}

/** Split the tokens after the mnemonic into operands (with abs/neg/sext wrappers) and trailing modifiers. */
function splitOperands(rest: Token[]): { groups: OperandGroup[]; mods: Token[] } {
  const groups: OperandGroup[] = [];
  const mods: Token[] = [];
  let i = 0;
  while (i < rest.length) {
    const t = rest[i];
    if (t.type === TokenType.ERROR) errorAt(`Unexpected character '${t.value}'`, t);
    if (t.type === TokenType.COMMA) {
      i++;
      continue;
    }
    if (t.type === TokenType.MODIFIER && t.value !== 'abs' && t.value !== 'neg') {
      mods.push(t);
      i++;
      continue;
    }

    let abs = false;
    let neg = false;
    let sext = false;
    const closers: TokenType[] = [];
    for (;;) {
      const p = rest[i];
      if (!p) break;
      if (p.type === TokenType.MNEMONIC && p.value === 'sext' && rest[i + 1]?.type === TokenType.LPAREN) {
        sext = true;
        closers.push(TokenType.RPAREN);
        i += 2;
        continue;
      }
      if (p.type === TokenType.MODIFIER && p.value === 'neg') {
        if (abs) errorAt('Invalid modifier order: the hardware applies abs before neg. Write -|v| or -abs(v) instead of |-v| or abs(-v)', p);
        neg = true;
        i++;
        if (rest[i]?.type === TokenType.LPAREN) {
          closers.push(TokenType.RPAREN);
          i++;
        }
        continue;
      }
      if (p.type === TokenType.MODIFIER && p.value === 'abs') {
        abs = true;
        i++;
        if (rest[i]?.type !== TokenType.LPAREN) errorAt("Expected '(' after abs", rest[i] ?? p);
        closers.push(TokenType.RPAREN);
        i++;
        continue;
      }
      if (p.type === TokenType.PIPE) {
        abs = true;
        closers.push(TokenType.PIPE);
        i++;
        continue;
      }
      break;
    }

    const core = rest[i];
    if (!core || !(core.type === TokenType.REGISTER || core.type === TokenType.NUMBER || core.type === TokenType.MNEMONIC)) {
      errorAt(core ? `Unexpected '${core.value}'` : 'Missing operand', core ?? rest[i - 1] ?? t);
    }
    groups.push({ token: core, abs, neg, sext });
    i++;
    while (closers.length > 0) {
      const expected = closers.pop()!;
      if (rest[i]?.type !== expected) errorAt(`Missing '${expected === TokenType.PIPE ? '|' : ')'}'`, rest[i] ?? core);
      i++;
    }
  }
  return { groups, mods };
}

// ── Registers and constants ──

interface RegisterRef {
  kind: 'v' | 's';     // VGPR, or scalar operand encoding (SGPR, VCC, EXEC, M0, …)
  index: number;       // VGPR index or scalar encoding of the first register
  count: number;       // Number of registers named
  wide?: boolean;      // 64-bit alias such as vcc or exec
}

const SCALAR_NAMES: Record<string, { index: number; wide?: boolean; sourceOnly?: boolean }> = {
  vcc: { index: VCC_LO, wide: true },
  vcc_lo: { index: VCC_LO },
  vcc_hi: { index: VCC_HI },
  exec: { index: EXEC_LO, wide: true },
  exec_lo: { index: EXEC_LO },
  exec_hi: { index: EXEC_HI },
  m0: { index: M0_REG },
  null: { index: NULL_REG },
  scc: { index: SRC_SCC, sourceOnly: true },
  src_scc: { index: SRC_SCC, sourceOnly: true },
  vccz: { index: SRC_VCCZ, sourceOnly: true },
  src_vccz: { index: SRC_VCCZ, sourceOnly: true },
  execz: { index: SRC_EXECZ, sourceOnly: true },
  src_execz: { index: SRC_EXECZ, sourceOnly: true },
};

function parseRegister(token: Token): RegisterRef & { sourceOnly?: boolean } {
  const val = token.value.toLowerCase();
  const named = SCALAR_NAMES[val];
  if (named) return { kind: 's', index: named.index, count: named.wide ? 2 : 1, wide: named.wide, sourceOnly: named.sourceOnly };

  const m = /^(v|s|ttmp)(?:(\d+)|\[(\d+)(?::(\d+))?\])$/.exec(val);
  if (!m) errorAt(`Invalid register '${token.value}'`, token);
  const first = Number(m[2] ?? m[3]);
  const last = m[4] !== undefined ? Number(m[4]) : first;
  if (last < first) errorAt(`Invalid register range '${token.value}'`, token);
  const count = last - first + 1;
  if (m[1] === 'v') {
    if (last >= NUM_VGPRS) errorAt(`Invalid register '${token.value}': RDNA2 has VGPRs v0–v${NUM_VGPRS - 1}`, token);
    return { kind: 'v', index: first, count };
  }
  if (m[1] === 's') {
    if (last > SGPR_MAX) errorAt(`Invalid register '${token.value}': RDNA2 has SGPRs s0–s${SGPR_MAX}`, token);
    return { kind: 's', index: first, count };
  }
  if (last > 15) errorAt(`Invalid register '${token.value}': trap temporaries are ttmp0–ttmp15`, token);
  return { kind: 's', index: TTMP_MIN + first, count };
}

function parseNumberText(token: Token): { value: number; isFloat: boolean } {
  const text = token.value;
  const isHex = /^-?0x/i.test(text);
  const isFloat = !isHex && /[.eE]/.test(text);
  const value = isHex ? (text.startsWith('-') ? -Number(text.slice(1)) : Number(text)) : Number(text);
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    throw new ParseError(invalidLiteral(text, token.line, token.column).message, token);
  }
  return { value, isFloat };
}

function constantOperand(token: Token, neg: boolean, abs: boolean): Operand {
  const { value, isFloat } = parseNumberText(token);
  let inline = tryEncodeInline(value);
  if (isFloat && Object.is(value, -0)) inline = null;
  const op: Operand = inline !== null
    ? { type: isFloat ? OperandType.INLINE_FLOAT : OperandType.INLINE_INT, value, encoded: inline, isFloat }
    : { type: OperandType.LITERAL, value, encoded: LITERAL_CONST, isFloat };
  if (neg) op.neg = true;
  if (abs) op.abs = true;
  return op;
}

function checkWidth(ref: RegisterRef, regs: number, token: Token): void {
  if (ref.count > 1 && !ref.wide && ref.count !== regs) {
    errorAt(regs === 1
      ? `Expected a single 32-bit register, got '${token.value}'`
      : `Expected a ${regs * 32}-bit operand (${regs} registers), got '${token.value}'`, token);
  }
  if (ref.wide && regs > 2) errorAt(`'${token.value}' is a 64-bit register pair; this operand needs ${regs} registers`, token);
  if (regs >= 2 && ref.kind === 's' && ref.index <= SGPR_MAX && ref.index % 2 !== 0) {
    errorAt(`64-bit SGPR operands must start at an even register (got '${token.value}')`, token);
  }
  if (ref.kind === 'v' && ref.index + regs - 1 >= NUM_VGPRS) errorAt(`Register range '${token.value}' goes past v${NUM_VGPRS - 1}`, token);
  if (ref.kind === 's' && ref.index <= SGPR_MAX && ref.index + regs - 1 > SGPR_MAX) {
    errorAt(`Register range '${token.value}' goes past s${SGPR_MAX}`, token);
  }
}

function noModifiers(g: OperandGroup, what: string): void {
  if (g.abs || g.neg) errorAt(`abs/neg modifiers cannot be applied to ${what}`, g.token);
  if (g.sext) errorAt(`sext() can only be applied to SDWA source operands, not ${what}`, g.token);
}

function vgprOperand(g: OperandGroup, regs: number, what: string): Operand {
  noModifiers(g, what);
  if (g.token.type !== TokenType.REGISTER) errorAt(`Expected a VGPR for ${what}, got '${g.token.value}'`, g.token);
  const ref = parseRegister(g.token);
  if (ref.kind !== 'v') errorAt(`Expected a VGPR for ${what}, got '${g.token.value}'`, g.token);
  checkWidth(ref, regs, g.token);
  return { type: OperandType.VGPR, value: ref.index, encoded: ref.index, regCount: regs };
}

function scalarDestOperand(g: OperandGroup, regs: number, what: string): Operand {
  noModifiers(g, what);
  if (g.token.type !== TokenType.REGISTER) errorAt(`Expected a scalar register for ${what}, got '${g.token.value}'`, g.token);
  const ref = parseRegister(g.token);
  if (ref.kind !== 's' || ref.sourceOnly) errorAt(`Expected a scalar register for ${what}, got '${g.token.value}'`, g.token);
  if (regs === 1 && ref.count === 2 && !ref.wide) {
    errorAt(`In wave32 ${what} is a 32-bit mask; use a single SGPR such as s${ref.index} instead of '${g.token.value}'`, g.token);
  }
  if (regs === 2 && ref.index === M0_REG) errorAt('m0 cannot be used as a 64-bit operand', g.token);
  checkWidth(ref, regs, g.token);
  return { type: ref.index <= SGPR_MAX ? OperandType.SGPR : OperandType.SPECIAL, value: ref.index, encoded: ref.index, regCount: regs };
}

/** Any source: VGPR, scalar register or constant (9-bit VALU source). */
function sourceOperand(g: OperandGroup, regs: number): Operand {
  if (g.token.type === TokenType.NUMBER) return constantOperand(g.token, g.neg, g.abs);
  if (g.token.type !== TokenType.REGISTER) errorAt(`Expected a register or constant, got '${g.token.value}'`, g.token);
  const ref = parseRegister(g.token);
  checkWidth(ref, regs, g.token);
  const op: Operand = ref.kind === 'v'
    ? { type: OperandType.VGPR, value: ref.index, encoded: encodeVGPR(ref.index), regCount: regs }
    : { type: ref.index <= SGPR_MAX ? OperandType.SGPR : OperandType.SPECIAL, value: ref.index, encoded: ref.index, regCount: regs };
  if (g.neg) op.neg = true;
  if (g.abs) op.abs = true;
  return op;
}

/** Scalar source: scalar register or constant (8-bit SALU source). */
function scalarSourceOperand(g: OperandGroup, regs: number): Operand {
  noModifiers(g, 'scalar operands');
  const op = sourceOperand(g, regs);
  if (op.type === OperandType.VGPR) errorAt(`VGPRs cannot be used as scalar operands (got '${g.token.value}')`, g.token);
  return op;
}

const NULL_OPERAND = (): Operand => ({ type: OperandType.INLINE_INT, value: 0, encoded: 0 });

// ── Modifiers ──

interface Modifiers {
  omod?: number;
  clamp?: boolean;
  dppCtrl?: number;
  dpp8?: number[];
  boundCtrl?: boolean;
  fi?: boolean;
  rowMask?: number;
  bankMask?: number;
  sdwaDstSel?: number;
  sdwaDstUnused?: number;
  sdwaSrc0Sel?: number;
  sdwaSrc1Sel?: number;
  sdwaSrc0Sext?: boolean;
  sdwaSrc1Sext?: boolean;
  opSel?: number[];
  opSelHi?: number[];
  negLo?: number[];
  negHi?: number[];
  offset?: number;
  offset0?: number;
  offset1?: number;
  seen: Map<string, Token>;
}

const SEL_MAP: Record<string, number> = {
  BYTE_0: 0, BYTE_1: 1, BYTE_2: 2, BYTE_3: 3, WORD_0: 4, WORD_1: 5, DWORD: 6,
};
const UNUSED_MAP: Record<string, number> = { UNUSED_PAD: 0, UNUSED_SEXT: 1, UNUSED_PRESERVE: 2 };

function modNumber(t: Token, text: string, min: number, max: number): number {
  const value = /^-?0x/i.test(text) ? Number(text) : text === '' ? NaN : Number(text);
  if (!Number.isInteger(value) || value < min || value > max) {
    errorAt(`Invalid value in '${t.value}' (expected ${min}–${max})`, t);
  }
  return value;
}

function modList(t: Token, text: string, max: number, minLen: number, maxLen: number): number[] {
  const m = /^\[(.*)\]$/.exec(text);
  if (!m) errorAt(`Expected a list such as [0,1] in '${t.value}'`, t);
  const items = m[1].split(',').map(s => s.trim());
  if (items.length < minLen || items.length > maxLen) errorAt(`'${t.value}' needs ${minLen === maxLen ? minLen : `${minLen}–${maxLen}`} entries`, t);
  return items.map(s => modNumber(t, s, 0, max));
}

function parseModifiers(mods: Token[]): Modifiers {
  const r: Modifiers = { seen: new Map() };
  const setDpp = (t: Token, ctrl: number) => {
    if (r.dppCtrl !== undefined || r.dpp8) errorAt('Only one DPP lane control can be used per instruction', t);
    r.dppCtrl = ctrl;
  };
  for (const t of mods) {
    const colon = t.value.indexOf(':');
    const name = colon < 0 ? t.value : t.value.slice(0, colon);
    const arg = colon < 0 ? '' : t.value.slice(colon + 1);
    if (r.seen.has(name)) errorAt(`Duplicate modifier '${name}'`, t);
    r.seen.set(name, t);
    switch (name) {
      case 'mul':
        if (arg !== '2' && arg !== '4') errorAt(`Invalid output modifier '${t.value}' (use mul:2, mul:4 or div:2)`, t);
        if (r.omod) errorAt('Only one output modifier can be used', t);
        r.omod = arg === '2' ? 1 : 2;
        break;
      case 'div':
        if (arg !== '2') errorAt(`Invalid output modifier '${t.value}' (use mul:2, mul:4 or div:2)`, t);
        if (r.omod) errorAt('Only one output modifier can be used', t);
        r.omod = 3;
        break;
      case 'clamp': r.clamp = true; break;
      case 'row_shl': setDpp(t, 0x100 + modNumber(t, arg, 1, 15)); break;
      case 'row_shr': setDpp(t, 0x110 + modNumber(t, arg, 1, 15)); break;
      case 'row_ror': setDpp(t, 0x120 + modNumber(t, arg, 1, 15)); break;
      case 'row_share': setDpp(t, 0x150 + modNumber(t, arg, 0, 15)); break;
      case 'row_xmask': setDpp(t, 0x160 + modNumber(t, arg, 0, 15)); break;
      case 'row_mirror': setDpp(t, 0x140); break;
      case 'row_half_mirror': setDpp(t, 0x141); break;
      case 'quad_perm': {
        const s = modList(t, arg, 3, 4, 4);
        setDpp(t, s[0] | (s[1] << 2) | (s[2] << 4) | (s[3] << 6));
        break;
      }
      case 'dpp8':
        if (r.dppCtrl !== undefined) errorAt('Only one DPP lane control can be used per instruction', t);
        r.dpp8 = modList(t, arg, 7, 8, 8);
        break;
      case 'wave_shl': case 'wave_shr': case 'wave_rol': case 'wave_ror':
      case 'row_bcast': case 'row_bcast15': case 'row_bcast31':
        errorAt(`${name} does not exist on RDNA2 (GFX10). Use row_share, row_xmask, DPP8, v_permlanex16_b32 or v_readlane_b32 instead`, t);
        break;
      case 'row_mask': r.rowMask = modNumber(t, arg, 0, 15); break;
      case 'bank_mask': r.bankMask = modNumber(t, arg, 0, 15); break;
      case 'bound_ctrl': r.boundCtrl = arg === '' ? true : modNumber(t, arg, 0, 1) === 1; break;
      case 'fi': r.fi = modNumber(t, arg, 0, 1) === 1; break;
      case 'dst_sel':
      case 'src0_sel':
      case 'src1_sel': {
        const sel = /^(0X[0-9A-F]+|\d+)$/.test(arg) ? Number(arg.replace('0X', '0x')) : SEL_MAP[arg];
        if (sel === undefined || sel > 6) errorAt(`Invalid SDWA selector '${arg}' (use BYTE_0–BYTE_3, WORD_0, WORD_1 or DWORD)`, t);
        if (name === 'dst_sel') r.sdwaDstSel = sel;
        else if (name === 'src0_sel') r.sdwaSrc0Sel = sel;
        else r.sdwaSrc1Sel = sel;
        break;
      }
      case 'dst_unused': {
        const u = /^(0X[0-9A-F]+|\d+)$/.test(arg) ? Number(arg.replace('0X', '0x')) : UNUSED_MAP[arg];
        if (u === undefined || u > 2) errorAt(`Invalid dst_unused '${arg}' (use UNUSED_PAD, UNUSED_SEXT or UNUSED_PRESERVE)`, t);
        r.sdwaDstUnused = u;
        break;
      }
      case 'src0_sext': r.sdwaSrc0Sext = true; break;
      case 'src1_sext': r.sdwaSrc1Sext = true; break;
      case 'op_sel': r.opSel = modList(t, arg, 1, 1, 4); break;
      case 'op_sel_hi': r.opSelHi = modList(t, arg, 1, 1, 3); break;
      case 'neg_lo': r.negLo = modList(t, arg, 1, 1, 3); break;
      case 'neg_hi': r.negHi = modList(t, arg, 1, 1, 3); break;
      case 'offset': r.offset = modNumber(t, arg, 0, 0xFFFF); break;
      case 'offset0': r.offset0 = modNumber(t, arg, 0, 0xFF); break;
      case 'offset1': r.offset1 = modNumber(t, arg, 0, 0xFF); break;
      case 'gds':
        errorAt('gds: the global data share is not modelled by the emulator (only LDS is)', t);
        break;
      default:
        errorAt(`Unknown modifier '${t.value}'`, t);
    }
  }
  return r;
}

function rejectModifiers(mods: Modifiers, allowed: string[], mnemonic: string): void {
  for (const [name, t] of mods.seen) {
    if (!allowed.includes(name)) errorAt(`Modifier '${name}' is not valid for ${mnemonic}`, t);
  }
}

const DPP_MODS = ['row_shl', 'row_shr', 'row_ror', 'row_share', 'row_xmask', 'row_mirror', 'row_half_mirror',
  'quad_perm', 'dpp8', 'row_mask', 'bank_mask', 'bound_ctrl', 'fi'];
const SDWA_MODS = ['dst_sel', 'dst_unused', 'src0_sel', 'src1_sel', 'src0_sext', 'src1_sext'];

function bits(list: number[] | undefined): number | undefined {
  if (!list) return undefined;
  return list.reduce((acc, b, i) => acc | ((b & 1) << i), 0);
}

// ── Instruction parsing ──

const VALU_FORMATS = new Set<InstructionFormat>([
  InstructionFormat.VOP1, InstructionFormat.VOP2, InstructionFormat.VOPC, InstructionFormat.VOP3, InstructionFormat.VOP3P,
]);

function parseInstruction(mnemonicToken: Token, rest: Token[], errors: AssemblyError[]): ParsedInstruction | null {
  let name = mnemonicToken.value;
  let info = lookupByMnemonic(name);
  let force: 'e32' | 'e64' | 'dpp' | 'sdwa' | undefined;
  if (!info) {
    const m = /^(.*)_(e32|e64|dpp|sdwa)$/.exec(name);
    if (m && lookupByMnemonic(m[1])) {
      name = m[1];
      info = lookupByMnemonic(name);
      force = m[2] as typeof force;
    }
  }
  if (!info) {
    errors.push(unknownMnemonic(mnemonicToken.value, mnemonicToken.line, mnemonicToken.column));
    return null;
  }

  // The mnemonic's span leaves out an _e32/_e64/_dpp/_sdwa suffix, so a new mnemonic keeps it
  const base: InstrBase = {
    mnemonic: info.mnemonic, line: mnemonicToken.line, column: mnemonicToken.column,
    spans: { mnemonic: { start: mnemonicToken.column, end: mnemonicToken.column + name.length } },
  };
  if (force && !VALU_FORMATS.has(info.format)) {
    errorAt(`${info.mnemonic} has no _${force} form: encoding suffixes only apply to vector ALU instructions`, mnemonicToken);
  }
  switch (info.format) {
    case InstructionFormat.VOP1:
    case InstructionFormat.VOP2:
    case InstructionFormat.VOPC:
    case InstructionFormat.VOP3:
    case InstructionFormat.VOP3P:
      return parseVALU(info, mnemonicToken, rest, base, force);
    case InstructionFormat.SOP1:
    case InstructionFormat.SOP2:
    case InstructionFormat.SOPC:
      return parseSALU(info, mnemonicToken, rest, base);
    case InstructionFormat.SOPK:
      return parseSOPK(info, mnemonicToken, rest, base);
    case InstructionFormat.SOPP:
      return parseSOPP(info, mnemonicToken, rest, base);
    case InstructionFormat.DS:
      return parseDS(info, mnemonicToken, rest, base);
    default:
      errorAt(`${info.mnemonic}: ${info.format} memory instructions are not supported by the emulator`, mnemonicToken);
  }
}

type Slot = 'dst' | 'sdst' | 'sdstScalar' | 'src0' | 'src1' | 'src2' | 'k';

/** Accepted operand layouts of a VALU instruction (alternatives by operand count). */
function valuLayouts(info: OpcodeInfo): Slot[][] {
  const m = info.mnemonic;
  if (m === 'v_nop') return [[]];
  if (info.kLiteral === 'mk') return [['dst', 'src0', 'k', 'src1']];
  if (info.kLiteral === 'ak') return [['dst', 'src0', 'src1', 'k']];
  if (m === 'v_readlane_b32') return [['sdstScalar', 'src0', 'src1']];
  if (m === 'v_readfirstlane_b32') return [['sdstScalar', 'src0']];
  if (info.format === InstructionFormat.VOPC) return [['src0', 'src1'], ['sdst', 'src0', 'src1']];
  if (m === 'v_cndmask_b32') return [['dst', 'src0', 'src1'], ['dst', 'src0', 'src1', 'src2']];
  if (info.carry && info.carryIn) return [['dst', 'src0', 'src1'], ['dst', 'sdst', 'src0', 'src1', 'src2']];
  if (info.vop3b) {
    const srcs: Slot[] = (['src0', 'src1', 'src2'] as Slot[]).slice(0, valuSourceCount(info));
    return [['dst', ...srcs], ['dst', 'sdst', ...srcs]];
  }
  const srcs: Slot[] = (['src0', 'src1', 'src2'] as Slot[]).slice(0, valuSourceCount(info));
  return [['dst', ...srcs]];
}

function kLiteralBits(info: OpcodeInfo, g: OperandGroup): number {
  noModifiers(g, 'the constant K');
  if (g.token.type !== TokenType.NUMBER) errorAt(`${info.mnemonic} expects a constant K, got '${g.token.value}'`, g.token);
  const { value, isFloat } = parseNumberText(g.token);
  const f16 = vopTypes(info).d === 'f16';
  if (isFloat) {
    if (!f16) {
      const f = Math.fround(value);
      if (!Number.isFinite(f)) errorAt(`${value} is out of range for a 32-bit float`, g.token);
      const buf = new Float32Array([value]);
      return new Uint32Array(buf.buffer)[0];
    }
    const h = f32ToF16(value);
    if ((h & 0x7FFF) === 0x7C00) errorAt(`${value} is out of range for a 16-bit float`, g.token);
    return h;
  }
  const width = f16 ? 16 : 32;
  if (!Number.isInteger(value) || value < -(2 ** (width - 1)) || value > 2 ** width - 1) {
    errorAt(`Constant ${g.token.value} does not fit in ${width} bits`, g.token);
  }
  return width === 16 ? value & 0xFFFF : value >>> 0;
}

/** Instructions whose src0 must be a VGPR (it names a register, not a value). */
const VGPR_SRC0 = new Set([
  'v_movrels_b32', 'v_movrelsd_b32', 'v_movrelsd_2_b32', 'v_swap_b32',
  'v_readlane_b32', 'v_permlane16_b32', 'v_permlanex16_b32',
]);
/** Operands that must be scalar values (SGPR, M0, inline constant …), never VGPRs. */
const SCALAR_SOURCES: Record<string, Slot[]> = {
  v_readlane_b32: ['src1'],
  v_writelane_b32: ['src0', 'src1'],
  v_permlane16_b32: ['src1', 'src2'],
  v_permlanex16_b32: ['src1', 'src2'],
};

function checkOperandKinds(info: OpcodeInfo, instr: ParsedInstruction, groups: OperandGroup[], layout: Slot[]): void {
  const m = info.mnemonic;
  const tokenFor = (slot: Slot) => groups[layout.indexOf(slot)]?.token;
  if (VGPR_SRC0.has(m) && instr.src0.type !== OperandType.VGPR) {
    errorAt(`${m} needs a VGPR as its source operand`, tokenFor('src0'));
  }
  for (const slot of SCALAR_SOURCES[m] ?? []) {
    const op = slot === 'src0' ? instr.src0 : slot === 'src1' ? instr.src1 : instr.src2;
    if (op?.type === OperandType.VGPR) errorAt(`${m}: this operand must be a scalar value (SGPR, M0 or a constant), not a VGPR`, tokenFor(slot));
  }
}

function parseVALU(
  info: OpcodeInfo, mnemonicToken: Token, rest: Token[],
  base: InstrBase,
  force: 'e32' | 'e64' | 'dpp' | 'sdwa' | undefined,
): ParsedInstruction {
  const m = info.mnemonic;
  const { groups, mods: modTokens } = splitOperands(rest);
  const mods = parseModifiers(modTokens);
  const isVOP3P = info.format === InstructionFormat.VOP3P;
  const isPermlane = m === 'v_permlane16_b32' || m === 'v_permlanex16_b32';
  const nsrc = valuSourceCount(info);

  // Which modifiers apply
  const allowed = ['clamp'];
  if (isVOP3P) {
    if (hasPackedModifiers(info)) allowed.push('op_sel', 'op_sel_hi', 'neg_lo', 'neg_hi');
  } else {
    allowed.push('mul', 'div', 'op_sel');
    if (info.format !== InstructionFormat.VOP3) allowed.push(...DPP_MODS, ...SDWA_MODS);
    if (isPermlane) allowed.push('fi', 'bound_ctrl');
  }
  rejectModifiers(mods, allowed, m);

  // Operand layout
  const layouts = valuLayouts(info);
  const layout = layouts.find(l => l.length === groups.length);
  if (!layout) {
    const counts = [...new Set(layouts.map(l => l.length))].join(' or ');
    errorAt(`${m} expects ${counts} operands, got ${groups.length} (syntax: ${info.syntax})`, mnemonicToken);
  }

  const instr: ParsedInstruction = { ...base, dst: NULL_OPERAND(), src0: NULL_OPERAND() };
  const isCmpx = info.format === InstructionFormat.VOPC && m.startsWith('v_cmpx_');
  layout.forEach((slot, i) => {
    const g = groups[i];
    const role = slot as OperandRole;
    mark(instr, slot === 'sdstScalar' ? 'dst' : slot, g.token);
    switch (slot) {
      case 'dst':
        instr.dst = vgprOperand(g, operandRegCount(info, 'dst'), 'the destination');
        break;
      case 'sdstScalar':
        instr.dst = scalarDestOperand(g, 1, 'the destination');
        break;
      case 'sdst': {
        const sdst = scalarDestOperand(g, 1, info.format === InstructionFormat.VOPC ? 'the compare result'
          : m === 'v_div_scale_f64' ? 'the scale flag' : 'the carry-out');
        if (isCmpx && sdst.value !== EXEC_LO) errorAt(`${m} writes EXEC; use exec_lo (or omit the destination)`, g.token);
        instr.sdst = sdst;
        break;
      }
      case 'k':
        instr.kLiteral = kLiteralBits(info, g);
        break;
      default: {
        const regs = operandRegCount(info, role);
        let op: Operand;
        if ((m === 'v_cndmask_b32' || info.carryIn) && slot === 'src2') {
          op = scalarDestOperand(g, 1, info.carryIn ? 'the carry-in' : 'the condition mask');
        } else {
          op = sourceOperand(g, regs);
        }
        if (slot === 'src0') instr.src0 = op;
        else if (slot === 'src1') instr.src1 = op;
        else instr.src2 = op;
        if (g.sext) {
          if (slot === 'src0') instr.sdwaSrc0Sext = true;
          else if (slot === 'src1') instr.sdwaSrc1Sext = true;
          else errorAt('sext() can only be applied to src0 or src1', g.token);
        }
      }
    }
  });

  // Modifiers → instruction fields
  if (mods.omod) instr.omod = mods.omod;
  if (mods.clamp) instr.clamp = true;
  if (mods.dppCtrl !== undefined) instr.dppCtrl = mods.dppCtrl;
  if (mods.dpp8) instr.dpp8 = mods.dpp8;
  if (isPermlane) {
    let sel = bits(mods.opSel) ?? 0;
    if (mods.opSel && mods.opSel.length !== 2) errorAt(`${m} op_sel takes two entries: [fetch_inactive, bound_ctrl]`, mods.seen.get('op_sel'));
    if (mods.fi) sel |= 1;
    if (mods.boundCtrl) sel |= 2;
    if (sel) instr.opSel = sel;
  } else {
    if (mods.boundCtrl !== undefined) instr.boundCtrl = mods.boundCtrl;
    if (mods.fi !== undefined) instr.fetchInactive = mods.fi;
    if (mods.rowMask !== undefined) instr.rowMask = mods.rowMask;
    if (mods.bankMask !== undefined) instr.bankMask = mods.bankMask;
    if ((mods.rowMask !== undefined || mods.bankMask !== undefined || mods.boundCtrl !== undefined) && mods.dppCtrl === undefined) {
      errorAt('row_mask, bank_mask and bound_ctrl need a DPP16 lane control such as row_shr:1 or quad_perm:[…]', mods.seen.get('row_mask') ?? mods.seen.get('bank_mask') ?? mods.seen.get('bound_ctrl'));
    }
    if (mods.fi !== undefined && mods.dppCtrl === undefined && !mods.dpp8) errorAt('fi needs a DPP lane control', mods.seen.get('fi'));
    if (mods.opSel) {
      if (isVOP3P) {
        if (mods.opSel.length > nsrc) errorAt(`${m} op_sel takes ${nsrc} entries`, mods.seen.get('op_sel'));
        instr.opSel = bits(mods.opSel);
      } else {
        // VOP3 op_sel: [src0, src1, (src2,) dst]
        const list = mods.opSel;
        if (list.length !== nsrc && list.length !== nsrc + 1) errorAt(`${m} op_sel takes ${nsrc + 1} entries: the sources then the destination`, mods.seen.get('op_sel'));
        let sel = 0;
        for (let i = 0; i < Math.min(list.length, nsrc); i++) sel |= (list[i] & 1) << i;
        if (list.length === nsrc + 1) sel |= (list[nsrc] & 1) << 3;
        instr.opSel = sel;
      }
    }
  }
  if (isVOP3P) {
    const isMix = m.startsWith('v_fma_mix');
    // Entries past the instruction's sources keep the defaults (op_sel_hi = 1, neg = 0), as in LLVM
    const fill = (list: number[] | undefined, dflt: number, what: string): number | undefined => {
      if (!list) return undefined;
      if (list.length > nsrc) errorAt(`${m} ${what} takes ${nsrc} entries`, mods.seen.get(what));
      const full = list.slice();
      while (full.length < 3) full.push(dflt);
      return bits(full);
    };
    instr.opSelHi = fill(mods.opSelHi, isMix ? 0 : 1, 'op_sel_hi');
    instr.negLo = fill(mods.negLo, 0, 'neg_lo');
    instr.negHi = fill(mods.negHi, 0, 'neg_hi');
  }
  if (mods.sdwaDstSel !== undefined) instr.sdwaDstSel = mods.sdwaDstSel;
  if (mods.sdwaDstUnused !== undefined) instr.sdwaDstUnused = mods.sdwaDstUnused;
  if (mods.sdwaSrc0Sel !== undefined) instr.sdwaSrc0Sel = mods.sdwaSrc0Sel;
  if (mods.sdwaSrc1Sel !== undefined) instr.sdwaSrc1Sel = mods.sdwaSrc1Sel;
  if (mods.sdwaSrc0Sext !== undefined) instr.sdwaSrc0Sext = mods.sdwaSrc0Sext;
  if (mods.sdwaSrc1Sext !== undefined) instr.sdwaSrc1Sext = mods.sdwaSrc1Sext;
  if (info.format === InstructionFormat.VOP1 && (mods.sdwaSrc1Sel !== undefined || mods.sdwaSrc1Sext)) {
    errorAt(`${m} has no src1 for src1_sel/src1_sext`, mods.seen.get('src1_sel') ?? mods.seen.get('src1_sext'));
  }
  checkOperandKinds(info, instr, groups, layout);

  // Encoding suffixes (_e32, _e64, _dpp, _sdwa)
  if (force === 'e64') {
    if (info.format === InstructionFormat.VOP3P || info.kLiteral) errorAt(`${m} has no _e64 form`, mnemonicToken);
    instr.forceVop3 = true;
  } else if (force === 'e32') {
    const plan = planEncoding(instr, info);
    if (plan.kind === 'VOP3A' || plan.kind === 'VOP3B' || plan.kind === 'VOP3P' || plan.extra) {
      errorAt(`${m}_e32 cannot encode these operands or modifiers; use the VOP3 (_e64) form`, mnemonicToken);
    }
  } else if (force === 'dpp' && instr.dppCtrl === undefined && !instr.dpp8) {
    errorAt(`${m}_dpp needs a DPP lane control such as row_shr:1, quad_perm:[…] or dpp8:[…]`, mnemonicToken);
  } else if (force === 'sdwa' && instr.sdwaSrc0Sel === undefined && instr.sdwaDstSel === undefined &&
             instr.sdwaSrc1Sel === undefined && instr.sdwaDstUnused === undefined) {
    instr.sdwaSrc0Sel = 6;
  }
  return instr;
}

/** Operand widths of SOP1 instructions implemented outside the generic SALU table. */
const SOP1_SPECIAL: Record<string, Array<['dst' | 'src', number]>> = {
  s_getpc_b64: [['dst', 2]],
  s_setpc_b64: [['src', 2]],
  s_swappc_b64: [['dst', 2], ['src', 2]],
  s_and_saveexec_b64: [['dst', 2], ['src', 2]],
  s_or_saveexec_b64: [['dst', 2], ['src', 2]],
  s_and_saveexec_b32: [['dst', 1], ['src', 1]],
  s_movrels_b32: [['dst', 1], ['src', 1]],
  s_movrels_b64: [['dst', 2], ['src', 2]],
  s_movreld_b32: [['dst', 1], ['src', 1]],
  s_movreld_b64: [['dst', 2], ['src', 2]],
};

function parseSALU(info: OpcodeInfo, mnemonicToken: Token, rest: Token[], base: InstrBase): ParsedInstruction {
  const m = info.mnemonic;
  const { groups, mods } = splitOperands(rest);
  if (mods.length) errorAt(`Modifier '${mods[0].value}' is not valid for ${m}`, mods[0]);

  let layout: Array<['dst' | 'src', number]>;
  if (SOP1_SPECIAL[m]) {
    layout = SOP1_SPECIAL[m];
  } else {
    const s = info.salu;
    const w = (x: number | undefined) => (x === 64 ? 2 : 1);
    layout = [];
    if (s?.d) layout.push(['dst', w(s.d)]);
    if (s?.s0) layout.push(['src', w(s.s0)]);
    if (s?.s1) layout.push(['src', w(s.s1)]);
  }
  if (groups.length !== layout.length) {
    errorAt(`${m} expects ${layout.length} operands, got ${groups.length} (syntax: ${info.syntax})`, mnemonicToken);
  }

  const instr: ParsedInstruction = { ...base, dst: NULL_OPERAND(), src0: NULL_OPERAND() };
  const srcs: Operand[] = [];
  layout.forEach(([kind, regs], i) => {
    const g = groups[i];
    if (kind === 'dst') {
      mark(instr, 'dst', g.token);
      instr.dst = scalarDestOperand(g, regs, 'the destination');
    } else {
      mark(instr, srcs.length === 0 ? 'src0' : 'src1', g.token);
      const op = scalarSourceOperand(g, regs);
      if ((m === 's_movrels_b32' || m === 's_movrels_b64') && !(op.type === OperandType.SGPR || op.type === OperandType.SPECIAL)) {
        errorAt(`${m} needs a scalar register as its relative source`, g.token);
      }
      srcs.push(op);
    }
  });
  if (srcs[0]) instr.src0 = srcs[0];
  if (srcs[1]) instr.src1 = srcs[1];
  return instr;
}

function parseSOPK(info: OpcodeInfo, mnemonicToken: Token, rest: Token[], base: InstrBase): ParsedInstruction {
  const m = info.mnemonic;
  const { groups, mods } = splitOperands(rest);
  if (mods.length) errorAt(`Modifier '${mods[0].value}' is not valid for ${m}`, mods[0]);
  const instr: ParsedInstruction = { ...base, dst: NULL_OPERAND(), src0: NULL_OPERAND() };

  const imm = (g: OperandGroup, min: number, max: number, what: string): number => {
    noModifiers(g, what);
    if (g.token.type !== TokenType.NUMBER) {
      errorAt(g.token.value === 'hwreg' ? 'hwreg(…) syntax is not supported; write the 16-bit hardware register selector as a number'
        : `Expected ${what}, got '${g.token.value}'`, g.token);
    }
    const { value, isFloat } = parseNumberText(g.token);
    if (isFloat || !Number.isInteger(value) || value < min || value > max) {
      errorAt(`${what} must be an integer in the range ${min}..${max >= 0xFFFF ? '0x' + max.toString(16) : max}`, g.token);
    }
    return value;
  };

  if (m === 's_setreg_imm32_b32') {
    if (groups.length !== 2) errorAt(`${m} expects 2 operands, got ${groups.length} (syntax: ${info.syntax})`, mnemonicToken);
    mark(instr, 'simm', groups[0].token);
    mark(instr, 'k', groups[1].token);
    instr.simm16 = imm(groups[0], 0, 0xFFFF, 'a 16-bit hardware register selector') & 0xFFFF;
    instr.kLiteral = imm(groups[1], -0x80000000, 0xFFFFFFFF, 'a 32-bit immediate') >>> 0;
    return instr;
  }
  if (m === 's_waitcnt_vscnt') {
    if (groups.length === 1) {
      mark(instr, 'simm', groups[0].token);
      instr.dst = { type: OperandType.SPECIAL, value: NULL_REG, encoded: NULL_REG };
      instr.simm16 = imm(groups[0], 0, 0xFFFF, 'a 16-bit count');
      return instr;
    }
    if (groups.length !== 2) errorAt(`${m} expects 2 operands, got ${groups.length} (syntax: ${info.syntax})`, mnemonicToken);
    mark(instr, 'dst', groups[0].token);
    mark(instr, 'simm', groups[1].token);
    instr.dst = scalarDestOperand(groups[0], 1, 'the count register');
    instr.simm16 = imm(groups[1], 0, 0xFFFF, 'a 16-bit count');
    return instr;
  }
  if (groups.length !== 2) errorAt(`${m} expects 2 operands, got ${groups.length} (syntax: ${info.syntax})`, mnemonicToken);
  mark(instr, 'dst', groups[0].token);
  mark(instr, 'simm', groups[1].token);
  instr.dst = scalarDestOperand(groups[0], 1, 'the destination');
  instr.simm16 = imm(groups[1], -0x8000, 0xFFFF, 'a 16-bit immediate') & 0xFFFF;
  return instr;
}

const BRANCHES = new Set(['s_branch', 's_cbranch_scc0', 's_cbranch_scc1', 's_cbranch_vccz', 's_cbranch_vccnz', 's_cbranch_execz', 's_cbranch_execnz']);

function parseWaitcnt(rest: Token[]): number {
  if (rest.length === 1 && rest[0].type === TokenType.NUMBER) {
    const { value, isFloat } = parseNumberText(rest[0]);
    if (isFloat || !Number.isInteger(value) || value < 0 || value > 0xFFFF) errorAt('s_waitcnt expects a 16-bit value or counters such as vmcnt(0) lgkmcnt(0)', rest[0]);
    return value;
  }
  // Counters at their maximum mean "don't wait": vmcnt 63, expcnt 7, lgkmcnt 63
  let vmcnt = 63;
  let expcnt = 7;
  let lgkmcnt = 63;
  const seen = new Set<string>();
  let i = 0;
  while (i < rest.length) {
    const t = rest[i];
    if (t.type === TokenType.COMMA) { i++; continue; }
    if (t.type !== TokenType.MNEMONIC || !['vmcnt', 'expcnt', 'lgkmcnt'].includes(t.value)) {
      errorAt(`Expected vmcnt(N), expcnt(N) or lgkmcnt(N), got '${t.value}'`, t);
    }
    if (seen.has(t.value)) errorAt(`Duplicate counter '${t.value}'`, t);
    seen.add(t.value);
    const num = rest[i + 2];
    if (rest[i + 1]?.type !== TokenType.LPAREN || num?.type !== TokenType.NUMBER || rest[i + 3]?.type !== TokenType.RPAREN) {
      errorAt(`Expected ${t.value}(N)`, t);
    }
    const max = t.value === 'expcnt' ? 7 : 63;
    const { value } = parseNumberText(num);
    if (!Number.isInteger(value) || value < 0 || value > max) errorAt(`${t.value} must be in the range 0..${max}`, num);
    if (t.value === 'vmcnt') vmcnt = value;
    else if (t.value === 'expcnt') expcnt = value;
    else lgkmcnt = value;
    i += 4;
  }
  if (seen.size === 0) errorAt('s_waitcnt expects a 16-bit value or counters such as vmcnt(0) lgkmcnt(0)');
  return (((vmcnt >> 4) & 3) << 14) | (lgkmcnt << 8) | (expcnt << 4) | (vmcnt & 0xF);
}

function parseSOPP(info: OpcodeInfo, mnemonicToken: Token, rest: Token[], base: InstrBase): ParsedInstruction {
  const m = info.mnemonic;
  const instr: ParsedInstruction = { ...base, dst: NULL_OPERAND(), src0: NULL_OPERAND() };
  for (const t of rest) if (t.type === TokenType.ERROR) errorAt(`Unexpected character '${t.value}'`, t);
  mark(instr, 'simm', rest[0], rest[rest.length - 1]);

  if (m === 's_waitcnt') {
    instr.simm16 = rest.length === 0 ? 0 : parseWaitcnt(rest);
    return instr;
  }
  if (BRANCHES.has(m)) {
    if (rest.length !== 1) errorAt(`${m} expects a target label`, rest[1] ?? mnemonicToken);
    const t = rest[0];
    if (t.type === TokenType.MNEMONIC) {
      instr.labelRef = t.value;
      instr.simm16 = 0;
      return instr;
    }
    if (t.type !== TokenType.NUMBER) errorAt(`${m} expects a target label, got '${t.value}'`, t);
    const { value, isFloat } = parseNumberText(t);
    if (isFloat || !Number.isInteger(value) || value < -0x8000 || value > 0xFFFF) {
      errorAt('A numeric branch offset must be a 16-bit dword count', t);
    }
    instr.simm16 = value & 0xFFFF;
    return instr;
  }
  if (rest.length === 0) {
    instr.simm16 = 0;
    return instr;
  }
  if (rest.length !== 1 || rest[0].type !== TokenType.NUMBER) errorAt(`${m} expects at most one numeric operand`, rest[0]);
  const { value, isFloat } = parseNumberText(rest[0]);
  if (isFloat || !Number.isInteger(value) || value < 0 || value > 0xFFFF) errorAt(`${m} expects a 16-bit immediate`, rest[0]);
  instr.simm16 = value;
  return instr;
}

function parseDS(info: OpcodeInfo, mnemonicToken: Token, rest: Token[], base: InstrBase): ParsedInstruction {
  const m = info.mnemonic;
  const { groups, mods: modTokens } = splitOperands(rest);
  const mods = parseModifiers(modTokens);
  const twoOffsets = m.includes('2st64');
  rejectModifiers(mods, twoOffsets ? ['offset0', 'offset1'] : ['offset'], m);

  const instr: ParsedInstruction = { ...base, dst: NULL_OPERAND(), src0: NULL_OPERAND() };
  const expect = (...slots: OperandSlot[]) => {
    if (groups.length !== slots.length) errorAt(`${m} expects ${slots.length} operands, got ${groups.length} (syntax: ${info.syntax})`, mnemonicToken);
    slots.forEach((slot, i) => mark(instr, slot, groups[i].token));
  };
  switch (m) {
    case 'ds_write_b32':
      expect('src0', 'src1');
      instr.src0 = vgprOperand(groups[0], 1, 'the address');
      instr.src1 = vgprOperand(groups[1], 1, 'the data');
      break;
    case 'ds_write2st64_b32':
      expect('src0', 'src1', 'src2');
      instr.src0 = vgprOperand(groups[0], 1, 'the address');
      instr.src1 = vgprOperand(groups[1], 1, 'the first data operand');
      instr.src2 = vgprOperand(groups[2], 1, 'the second data operand');
      break;
    case 'ds_permute_b32':
    case 'ds_bpermute_b32':
      expect('dst', 'src0', 'src1');
      instr.dst = vgprOperand(groups[0], 1, 'the destination');
      instr.src0 = vgprOperand(groups[1], 1, 'the address');
      instr.src1 = vgprOperand(groups[2], 1, 'the data');
      break;
    default:
      expect('dst', 'src0');
      instr.dst = vgprOperand(groups[0], operandRegCount(info, 'dst'), 'the destination');
      instr.src0 = vgprOperand(groups[1], 1, m === 'ds_swizzle_b32' ? 'the source' : 'the address');
  }
  const offset = twoOffsets ? ((mods.offset1 ?? 0) << 8) | (mods.offset0 ?? 0) : (mods.offset ?? 0);
  if (offset) instr.offset = offset;
  return instr;
}
