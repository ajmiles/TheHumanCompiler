// ── Editing one part of an instruction ──
// Lists what an instruction's mnemonic, one of its operands or one of its VOP3 / VOP3P modifier fields can be
// changed to, keeping only the choices that still assemble, so the Instruction Info panel can rewrite the
// source line in place.

import { decodeBinary, encodeInstruction, EncodingError } from '../isa/encoding';
import { getAllOpcodes, lookupByMnemonic } from '../isa/opcodes';
import { isFloatType, operandRegCount, valuSourceCount, vopTypes } from '../isa/operands';
import { NUM_VGPRS, SGPR_MAX } from '../isa/constants';
import { InstructionFormat, OpcodeInfo, Operand, OperandSlot, OperandType, ParsedInstruction, SourceSpan } from '../isa/types';
import { Token, tokenize, TokenType } from './lexer';
import { parse } from './parser';

/** Result of assembling one source line on its own. */
export interface LineCheck {
  instr?: ParsedInstruction;
  words?: number[];
  error?: string;
}

/** Assemble a single source line. A branch target must be one of `labels`, when they are given. */
export function checkLine(lineText: string, labels?: ReadonlySet<string>): LineCheck {
  const { instructions, errors } = parse(tokenize(lineText));
  if (errors.length > 0) return { error: errors[0].message };
  const instr = instructions[0];
  if (!instr) return { error: 'There is no instruction on this line' };
  if (instr.labelRef !== undefined && labels && !labels.has(instr.labelRef)) {
    return { instr, error: `Undefined label '${instr.labelRef}'` };
  }
  try {
    return { instr, words: encodeInstruction(instr) };
  } catch (e) {
    if (e instanceof EncodingError) return { instr, error: e.message };
    throw e;
  }
}

/** Every label defined in a program. */
export function labelsIn(source: string): Set<string> {
  return new Set(tokenize(source).filter(t => t.type === TokenType.LABEL).map(t => t.value));
}

/** The line with the text at `span` replaced. */
export function replaceSpan(lineText: string, span: SourceSpan, text: string): string {
  return lineText.slice(0, span.start - 1) + text + lineText.slice(span.end - 1);
}

/** The one replacement that turns line `before` into `after`: the columns that differ, and their new text. */
export function lineEdit(before: string, after: string): { span: SourceSpan; text: string } {
  const shorter = Math.min(before.length, after.length);
  let head = 0;
  while (head < shorter && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < shorter - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return { span: { start: head + 1, end: before.length - tail + 1 }, text: after.slice(head, after.length - tail) };
}

export interface EditChoice {
  /** Replacement for the source text of the mnemonic or operand. */
  text: string;
  /** 'VGPR', 'SGPR', 'Special', 'Constant' or 'Label'; for mnemonics, the instruction format. */
  group: string;
  /** The source line after the replacement. */
  line: string;
  /** Size of the resulting instruction in bytes. */
  bytes: number;
  /** The instruction has this value now. */
  current: boolean;
  /** First line of a mnemonic's description. */
  detail?: string;
}

const FORMAT_ORDER: string[] = [
  InstructionFormat.VOP1, InstructionFormat.VOP2, InstructionFormat.VOP3, InstructionFormat.VOP3P, InstructionFormat.VOPC,
  InstructionFormat.SOP1, InstructionFormat.SOP2, InstructionFormat.SOPC, InstructionFormat.SOPK, InstructionFormat.SOPP,
  InstructionFormat.DS,
];
const GROUP_ORDER = ['VGPR', 'SGPR', 'Special', 'Constant', 'Label'];

const SPECIAL_32 = ['vcc_lo', 'vcc_hi', 'exec_lo', 'exec_hi', 'm0', 'null', 'scc', 'vccz', 'execz'];
const SPECIAL_64 = ['vcc', 'exec'];
const INLINE_FLOATS = ['0.5', '-0.5', '1.0', '-1.0', '2.0', '-2.0', '4.0', '-4.0'];

function slotOperand(instr: ParsedInstruction, slot: OperandSlot): Operand | undefined {
  switch (slot) {
    case 'dst': return instr.dst;
    case 'sdst': return instr.sdst;
    case 'src0': return instr.src0;
    case 'src1': return instr.src1;
    case 'src2': return instr.src2;
    default: return undefined;
  }
}

function operandGroup(op: Operand | undefined): string {
  switch (op?.type) {
    case OperandType.VGPR: return 'VGPR';
    case OperandType.SGPR: return 'SGPR';
    case OperandType.SPECIAL: return 'Special';
    default: return 'Constant';
  }
}

/**
 * What the mnemonic or an operand of the instruction on `lineText` can be changed to, each choice checked by
 * assembling the changed line. Mnemonics, registers, inline constants and branch labels are listed;
 * other values (literals, immediates) can still be typed and checked with checkLine.
 */
export function editChoices(lineText: string, slot: OperandSlot, labels: ReadonlySet<string> = new Set()): EditChoice[] {
  const now = checkLine(lineText, labels);
  const span = now.instr?.spans?.[slot];
  if (!now.instr || !now.words || !span) return [];
  const instr = now.instr;
  const currentText = lineText.slice(span.start - 1, span.end - 1);
  const choices: EditChoice[] = [];
  const tried = new Set<string>();
  const offer = (text: string, group: string, detail?: string) => {
    if (tried.has(text)) return;
    tried.add(text);
    const line = replaceSpan(lineText, span, text);
    const result = checkLine(line, labels);
    if (!result.words) return;
    const current = text.toLowerCase() === currentText.toLowerCase();
    choices.push({ text, group, line, bytes: result.words.length * 4, current, detail });
  };

  if (slot === 'mnemonic') {
    const own = lookupByMnemonic(instr.mnemonic)?.format;
    const rank = (format: string) => (format === own ? -1 : FORMAT_ORDER.indexOf(format));
    const opcodes = getAllOpcodes()
      .filter(info => FORMAT_ORDER.includes(info.format))
      .sort((a, b) => rank(a.format) - rank(b.format) || a.mnemonic.localeCompare(b.mnemonic));
    for (const info of opcodes) offer(info.mnemonic, info.format, info.description.split('\n')[0]);
    return choices;
  }

  if (slot === 'simm') {
    if (/^s_(c)?branch/.test(instr.mnemonic)) for (const label of [...labels].sort()) offer(label, 'Label');
    return choices;
  }
  if (slot === 'k') return choices;

  const op = slotOperand(instr, slot);
  const info = lookupByMnemonic(instr.mnemonic);
  const regs = op?.regCount ?? (info && slot !== 'sdst' ? operandRegCount(info, slot) : 1);
  const name = (prefix: string, i: number) => (regs > 1 ? `${prefix}[${i}:${i + regs - 1}]` : `${prefix}${i}`);
  for (let i = 0; i + regs <= NUM_VGPRS; i++) offer(name('v', i), 'VGPR');
  for (let i = 0; i + regs - 1 <= SGPR_MAX; i++) offer(name('s', i), 'SGPR');
  for (const s of regs === 1 ? SPECIAL_32 : regs === 2 ? SPECIAL_64 : []) offer(s, 'Special');
  for (let v = 0; v <= 64; v++) offer(String(v), 'Constant');
  for (let v = -1; v >= -16; v--) offer(String(v), 'Constant');
  for (const f of INLINE_FLOATS) offer(f, 'Constant');

  // Keep the current value among the choices when it is not one of the listed ones (a literal, ttmp3, vcc, …)
  if (!choices.some(c => c.current)) {
    choices.push({ text: currentText, group: operandGroup(op), line: lineText, bytes: now.words.length * 4, current: true });
  }
  return choices.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

// ── Modifier fields ──

/**
 * A modifier field of the VOP3A, VOP3B and VOP3P encodings. NEG is the same field in all three (NEG_LO in
 * VOP3P); OP_SEL_HI and NEG_HI exist only in VOP3P, ABS and OMOD only in VOP3A / VOP3B.
 */
export type ModifierField = 'clamp' | 'omod' | 'op_sel' | 'op_sel_hi' | 'abs' | 'neg' | 'neg_hi';

/** One value of a modifier field, or one of its bits, which can be switched on or off. */
export interface ModifierOption {
  /** For a bit, what it applies to ('src0'…'src2', 'dst', 'fi' or 'bound_ctrl'); for a value, the field's value. */
  key: string;
  /** Short name: SRC0, DST, off, mul:2, … */
  label: string;
  /** For a bit of ABS, NEG or OP_SEL: the operand it applies to, as written now. */
  operand?: string;
  /** What the value or bit does (CLAMP, OMOD and the flags of v_permlane*'s OP_SEL). */
  detail?: string;
  /** The bit is set, or the field holds this value. */
  on: boolean;
  /** The line with this value chosen or this bit switched, when that assembles, and the size of its instruction. */
  line?: string;
  bytes?: number;
  /** Why it cannot be chosen. */
  error?: string;
}

export interface ModifierChoices {
  /** 'toggles': each option switches one bit (ABS, NEG, NEG_HI, OP_SEL, OP_SEL_HI). 'choice': the options are the values (CLAMP, OMOD). */
  kind: 'toggles' | 'choice';
  options: ModifierOption[];
}

type Source = 'src0' | 'src1' | 'src2';
const SOURCES: readonly Source[] = ['src0', 'src1', 'src2'];
const OMOD_SYNTAX = ['', 'mul:2', 'mul:4', 'div:2'];
const OMOD_MEANING = [
  'The result is written as computed', 'Multiply the result by 2', 'Multiply the result by 4', 'Divide the result by 2',
];
/** The order LLVM prints these modifiers in; a new one is written in its place among them. */
const MODIFIER_RANK: Record<string, number> = { op_sel: 0, op_sel_hi: 1, neg_lo: 2, neg_hi: 3, clamp: 4, mul: 5, div: 5 };
/** Instructions that pack two f16 results, whose clamp applies to each half. */
const PACKED_F16_RESULT = new Set(['v_cvt_pkrtz_f16_f32', 'v_pack_b32_f16']);

function lineTokens(lineText: string): Token[] {
  return tokenize(lineText).filter(t => t.type !== TokenType.NEWLINE && t.type !== TokenType.EOF);
}

const modifierName = (t: Token) => t.value.split(':')[0];

/** The line without `token` and the space before it. */
function removeToken(lineText: string, tokens: Token[], token: Token): string {
  const i = tokens.indexOf(token);
  const from = i > 0 ? tokens[i - 1].end : token.column;
  return lineText.slice(0, from - 1) + lineText.slice(token.end - 1);
}

/**
 * The line with its modifiers called `names` replaced by `text`, or removed when `text` is ''. A modifier that
 * is not written yet goes where LLVM prints it: before any that comes later in that order, else at the end.
 */
function setModifier(lineText: string, names: string[], text: string): string {
  const tokens = lineTokens(lineText);
  const found = tokens.filter(t => t.type === TokenType.MODIFIER && names.includes(modifierName(t)));
  if (found.length === 0) {
    if (!text) return lineText;
    const rank = MODIFIER_RANK[text.split(':')[0]] ?? Infinity;
    const later = tokens.find(t => t.type === TokenType.MODIFIER && (MODIFIER_RANK[modifierName(t)] ?? -1) > rank);
    if (later) return lineText.slice(0, later.column - 1) + text + ' ' + lineText.slice(later.column - 1);
    const last = tokens[tokens.length - 1];
    return lineText.slice(0, last.end - 1) + ' ' + text + lineText.slice(last.end - 1);
  }
  // Remove any others from the end (so the columns before them stay valid), then replace or remove the first
  let line = lineText;
  for (const t of found.slice(1).reverse()) line = removeToken(line, tokens, t);
  const first = found[0];
  return text ? line.slice(0, first.column - 1) + text + line.slice(first.end - 1) : removeToken(line, tokens, first);
}

/** A source with the given abs and neg modifiers, written in the style the line uses (|x| or abs(x), -x or neg(x)). */
function wrapSource(core: string, abs: boolean, neg: boolean, constant: boolean, written: string): string {
  let text = /sext\s*\(/i.test(written) ? `sext(${core})` : core;
  if (abs) text = /abs\s*\(/i.test(written) ? `abs(${text})` : `|${text}|`;
  // '-' before a constant is read as part of it (-1.0 is another constant, not 1.0 with NEG set)
  if (neg) text = /neg\s*\(/i.test(written) || (constant && !abs) ? `neg(${text})` : `-${text}`;
  return text;
}

/** An operand as written on the line, with its modifiers. */
function writtenOperand(lineText: string, instr: ParsedInstruction, slot: 'dst' | Source): string {
  const span = slot === 'dst' ? instr.spans?.dst : instr.wrappedSpans?.[slot];
  return span ? lineText.slice(span.start - 1, span.end - 1) : '—';
}

/** The line with source `slot` written with exactly the given abs and neg modifiers. */
function withSourceModifiers(lineText: string, instr: ParsedInstruction, slot: Source, abs: boolean, neg: boolean): string | { error: string } {
  const op = instr[slot];
  const core = instr.spans?.[slot];
  const wrapped = instr.wrappedSpans?.[slot];
  if (!op || !core || !wrapped) return { error: `${slot.toUpperCase()} is implicit: it is not written on this line` };
  const constant = op.type === OperandType.INLINE_INT || op.type === OperandType.INLINE_FLOAT || op.type === OperandType.LITERAL;
  const written = lineText.slice(wrapped.start - 1, wrapped.end - 1);
  return replaceSpan(lineText, wrapped, wrapSource(lineText.slice(core.start - 1, core.end - 1), abs, neg, constant, written));
}

function clampMeaning(info: OpcodeInfo): string {
  if (info.format === InstructionFormat.VOPC) return 'Floating-point compares accept clamp; it does not change the result';
  const packed = info.format === InstructionFormat.VOP3P && !info.dot && !info.mnemonic.startsWith('v_fma_mix');
  if (PACKED_F16_RESULT.has(info.mnemonic) || (packed && !info.isIntegerOp)) return 'Clamp both f16 halves of the result to [0.0, 1.0]';
  if (packed) return 'Saturate both 16-bit halves of the result instead of letting them wrap';
  if (isFloatType(vopTypes(info).d)) return 'Clamp the result to [0.0, 1.0] (NaN becomes 0)';
  return 'Saturate: a result outside the integer range is clamped to it instead of wrapping';
}

/**
 * The options of a modifier field of the VOP3 / VOP3P instruction on `lineText`, each checked by assembling the
 * changed line: ABS, NEG, NEG_HI, OP_SEL and OP_SEL_HI switch one bit at a time, CLAMP and OMOD offer each value.
 * Null when the line does not assemble, or its encoding has no such field.
 */
export function modifierOptions(lineText: string, field: ModifierField): ModifierChoices | null {
  const now = checkLine(lineText);
  const instr = now.instr;
  const info = instr && lookupByMnemonic(instr.mnemonic);
  if (!instr || !now.words || !info) return null;
  const m = info.mnemonic;
  const nsrc = valuSourceCount(info);
  const vop3p = info.format === InstructionFormat.VOP3P;
  if (vop3p ? field === 'abs' || field === 'omod' : field === 'op_sel_hi' || field === 'neg_hi') return null;

  const option = (key: string, label: string, about: Pick<ModifierOption, 'operand' | 'detail'>, on: boolean,
    line: string | { error: string }): ModifierOption => {
    const base: ModifierOption = { key, label, ...about, on };
    if (typeof line !== 'string') return { ...base, error: line.error };
    const result = line === lineText ? now : checkLine(line);
    return result.words ? { ...base, line, bytes: result.words.length * 4 } : { ...base, error: result.error };
  };
  /** A switch per source for the bits `bits`, switching source i giving `line(i)`. */
  const sourceToggles = (bits: number, line: (i: number, slot: Source) => string | { error: string }): ModifierChoices => ({
    kind: 'toggles',
    options: SOURCES.map((slot, i) => (i < nsrc
      ? option(slot, slot.toUpperCase(), { operand: writtenOperand(lineText, instr, slot) }, !!((bits >> i) & 1), line(i, slot))
      : option(slot, slot.toUpperCase(), { operand: '—' }, false, { error: `${m} reads ${nsrc === 1 ? 'one source' : `${nsrc} sources`}` }))),
  });

  if (field === 'clamp') {
    return { kind: 'choice', options: [
      option('0', 'off', { detail: 'The result is written as computed' }, !instr.clamp, setModifier(lineText, ['clamp'], '')),
      option('1', 'on', { detail: clampMeaning(info) }, !!instr.clamp, setModifier(lineText, ['clamp'], 'clamp')),
    ] };
  }
  if (field === 'omod') {
    return { kind: 'choice', options: OMOD_SYNTAX.map((text, v) => option(String(v), text || 'none', { detail: OMOD_MEANING[v] },
      (instr.omod ?? 0) === v, setModifier(lineText, ['mul', 'div'], text))) };
  }
  if (vop3p) return packedOptions(lineText, instr, info, field, now.words, sourceToggles);

  if (field === 'op_sel') {
    const bits = instr.opSel ?? 0;
    if (m === 'v_permlane16_b32' || m === 'v_permlanex16_b32') {
      // op_sel:[fetch_inactive, bound_ctrl], also written as fi:1 and bound_ctrl:1
      const names = ['op_sel', 'fi', 'bound_ctrl'];
      const text = (b: number) => (b ? `op_sel:[${b & 1},${(b >> 1) & 1}]` : '');
      return { kind: 'toggles', options: [
        option('fi', 'FI', { detail: 'Fetch inactive: read the selected lane even when it is inactive' }, !!(bits & 1),
          setModifier(lineText, names, text(bits ^ 1))),
        option('bound_ctrl', 'BOUND_CTRL', { detail: 'Write 0 when the selected lane is inactive, instead of skipping the write' },
          !!(bits & 2), setModifier(lineText, names, text(bits ^ 2))),
      ] };
    }
    // op_sel:[src0, src1, (src2,) dst]: 1 reads the high half of a source, or writes the high half of vdst
    const text = (b: number) => {
      if (!b) return '';
      const entries = SOURCES.slice(0, nsrc).map((_, i) => (b >> i) & 1);
      return `op_sel:[${[...entries, (b >> 3) & 1].join(',')}]`;
    };
    const options = SOURCES.slice(0, nsrc).map((slot, i) => option(slot, slot.toUpperCase(),
      { operand: writtenOperand(lineText, instr, slot) }, !!((bits >> i) & 1), setModifier(lineText, ['op_sel'], text(bits ^ (1 << i)))));
    options.push(option('dst', 'DST', { operand: writtenOperand(lineText, instr, 'dst') }, !!(bits & 8),
      setModifier(lineText, ['op_sel'], text(bits ^ 8))));
    return { kind: 'toggles', options };
  }

  // ABS and NEG: -x and |x| on each source
  const flags = SOURCES.reduce((b, slot, i) => b | (instr[slot]?.[field === 'abs' ? 'abs' : 'neg'] ? 1 << i : 0), 0);
  return sourceToggles(flags, (_, slot) => {
    const op = instr[slot];
    return withSourceModifiers(lineText, instr, slot, field === 'abs' ? !op?.abs : !!op?.abs, field === 'neg' ? !op?.neg : !!op?.neg);
  });
}

/**
 * OP_SEL, OP_SEL_HI, NEG (neg_lo) and NEG_HI of a VOP3P instruction: one bit per source, written as lists
 * such as op_sel_hi:[1,0,1] that LLVM leaves out at their defaults. The negations of v_fma_mix are written
 * on the source instead (-x is neg_lo, |x| is neg_hi), and so may be those of v_dot2_f32_f16's f32 src2; a
 * - on any other source sets both of its bits.
 */
function packedOptions(
  lineText: string, instr: ParsedInstruction, info: OpcodeInfo, field: ModifierField, words: number[],
  sourceToggles: (bits: number, line: (i: number, slot: Source) => string | { error: string }) => ModifierChoices,
): ModifierChoices {
  const isMix = info.mnemonic.startsWith('v_fma_mix');
  const nsrc = valuSourceCount(info);
  const all = (1 << nsrc) - 1;
  const list = (name: string, bits: number) => `${name}:[${SOURCES.slice(0, nsrc).map((_, i) => (bits >> i) & 1).join(',')}]`;

  if (field === 'op_sel' || field === 'op_sel_hi') {
    // Unwritten op_sel_hi entries are 1, except for v_fma_mix, where 1 makes a source an f16
    const dflt = field === 'op_sel' || isMix ? 0 : all;
    const bits = field === 'op_sel' ? instr.opSel ?? 0 : instr.opSelHi ?? (isMix ? 0 : 7);
    return sourceToggles(bits, i => {
      const next = (bits ^ (1 << i)) & all;
      return setModifier(lineText, [field], next === dflt ? '' : list(field, next));
    });
  }

  const hiField = field === 'neg_hi';
  const d = decodeBinary(Uint32Array.from(words))[0];
  const bits = hiField ? d.negHi ?? 0 : (d.src0Neg ? 1 : 0) | (d.src1Neg ? 2 : 0) | (d.src2Neg ? 4 : 0);
  return sourceToggles(bits, (i, slot) => {
    const bit = 1 << i;
    const op = instr[slot];
    if (!op) return { error: `${slot.toUpperCase()} is not written on this line` };
    const onSource = isMix || (info.dot === 'f16' && i === 2); // -x is neg_lo and |x| is neg_hi
    let lo = instr.negLo ?? 0;
    let hi = instr.negHi ?? 0;
    let neg = !!op.neg;
    let abs = !!op.abs;
    if (!(bits & bit)) {
      // Switch on: on the source for v_fma_mix, else in the list
      if (isMix) [neg, abs] = hiField ? [neg, true] : [true, abs];
      else if (hiField) hi |= bit;
      else lo |= bit;
    } else {
      // Switch off wherever it is written
      if (hiField) hi &= ~bit;
      else lo &= ~bit;
      if (onSource) [neg, abs] = hiField ? [neg, false] : [false, abs];
      else if (neg) {
        // -x negated both halves: keep the other one, in its list
        neg = false;
        if (hiField) lo |= bit;
        else hi |= bit;
      }
    }
    let line: string | { error: string } = lineText;
    if (neg !== !!op.neg || abs !== !!op.abs) line = withSourceModifiers(lineText, instr, slot, abs, neg);
    if (typeof line !== 'string') return line;
    if (lo !== (instr.negLo ?? 0)) line = setModifier(line, ['neg_lo'], lo & all ? list('neg_lo', lo) : '');
    if (hi !== (instr.negHi ?? 0)) line = setModifier(line, ['neg_hi'], hi & all ? list('neg_hi', hi) : '');
    return line;
  });
}
