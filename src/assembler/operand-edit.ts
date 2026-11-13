// ── Editing one part of an instruction ──
// Lists what an instruction's mnemonic, one of its operands or one of its VOP3 / VOP3P modifier fields can be
// changed to, and which other encodings (VOP3, DPP16, DPP8, SDWA) a VOP1, VOP2 or VOPC instruction can switch to,
// keeping only the choices that still assemble, so the Instruction Info panel can rewrite the source line in place.

import { decodeBinary, dppCtrlMeaning, encodeInstruction, EncodingError, EncodingPlan, planEncoding } from '../isa/encoding';
import { getAllOpcodes, lookupByMnemonic } from '../isa/opcodes';
import { isFloatType, omodIgnored, operandRegCount, valuSourceCount, vopTypes } from '../isa/operands';
import { EXEC_LO, NUM_VGPRS, SGPR_MAX, VCC_LO } from '../isa/constants';
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
  /** First line of a mnemonic's description, or what a DPP lane control does. */
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

const sentence = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The DPP16 lane controls offered for DPP_CTRL: [text, group, what it does]. */
const DPP16_CONTROLS: Array<[string, string, string]> = (() => {
  const quads: Array<[number[], string]> = [
    [[0, 1, 2, 3], 'Every lane reads itself'],
    [[1, 0, 3, 2], 'Swap neighbouring lanes'],
    [[2, 3, 0, 1], 'Swap the two halves of each quad'],
    [[3, 2, 1, 0], 'Reverse each quad'],
    [[1, 2, 3, 0], 'Lane i reads lane i+1 of its quad, wrapping round'],
    [[3, 0, 1, 2], 'Lane i reads lane i−1 of its quad, wrapping round'],
    ...[0, 1, 2, 3].map((k): [number[], string] => [[k, k, k, k], `Every lane reads lane ${k} of its quad`]),
  ];
  const list = quads.map(([sel, what]): [string, string, string] => [`quad_perm:[${sel.join(',')}]`, 'Quad permute', what]);
  const add = (text: string, group: string, ctrl: number) => list.push([text, group, sentence(dppCtrlMeaning(ctrl))]);
  for (let n = 1; n <= 15; n++) add(`row_shl:${n}`, 'Row shift', 0x100 + n);
  for (let n = 1; n <= 15; n++) add(`row_shr:${n}`, 'Row shift', 0x110 + n);
  for (let n = 1; n <= 15; n++) add(`row_ror:${n}`, 'Row rotate', 0x120 + n);
  add('row_mirror', 'Row mirror', 0x140);
  add('row_half_mirror', 'Row mirror', 0x141);
  for (let n = 0; n <= 15; n++) add(`row_share:${n}`, 'Row share', 0x150 + n);
  for (let n = 0; n <= 15; n++) add(`row_xmask:${n}`, 'Row xmask', 0x160 + n);
  return list;
})();

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
  // K is typed, and the output modifier is set through the OMOD field: neither offers choices here
  if (slot === 'k' || slot === 'omod') return choices;

  if (slot === 'dpp') {
    // The DPP16 lane controls, with what each does; a DPP8 selection or another quad_perm is typed
    if (instr.dppCtrl === undefined) return choices;
    for (const [text, group, detail] of DPP16_CONTROLS) {
      const line = replaceSpan(lineText, span, text);
      const result = checkLine(line, labels);
      if (result.words) choices.push({ text, group, line, bytes: result.words.length * 4, current: result.instr?.dppCtrl === instr.dppCtrl, detail });
    }
    if (!choices.some(c => c.current)) {
      choices.unshift({ text: currentText, group: 'Quad permute', line: lineText, bytes: now.words.length * 4, current: true,
        detail: sentence(dppCtrlMeaning(instr.dppCtrl)) });
    }
    return choices;
  }

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
 * A modifier field of an encoding. CLAMP and OMOD (VOP3A/B, SDWA); OP_SEL (VOP3A, VOP3P); OP_SEL_HI and NEG_HI
 * (VOP3P); ABS and NEG of each source (VOP3A/B, DPP16, SDWA, and NEG as VOP3P's NEG_LO); ROW_MASK, BANK_MASK,
 * BOUND_CTRL and FI (DPP16, and FI of DPP8); DPP8's lane selectors; and SDWA's SRC0_SEL, SRC1_SEL, DST_SEL,
 * DST_UNUSED and SEXT.
 */
export type ModifierField = 'clamp' | 'omod' | 'op_sel' | 'op_sel_hi' | 'abs' | 'neg' | 'neg_hi'
  | 'row_mask' | 'bank_mask' | 'bound_ctrl' | 'fi' | 'dpp8' | 'src0_sel' | 'src1_sel' | 'dst_sel' | 'dst_unused' | 'sext';

/** One value of a modifier field, or one of its bits, which can be switched on or off. */
export interface ModifierOption {
  /** For a bit, what it applies to ('src0'…'src2', 'dst', 'fi', 'bound_ctrl', 'row0'…, 'bank0'…); for a value, the field's value. */
  key: string;
  /** Short name: SRC0, DST, ROW 1, off, mul:2, BYTE_0, … */
  label: string;
  /** For a bit of ABS, NEG, NEG_HI, OP_SEL, OP_SEL_HI or SEXT: the operand it applies to, as written now. */
  operand?: string;
  /** What the value or bit does. */
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
  /**
   * 'toggles': each option switches one bit (ABS, NEG, NEG_HI, OP_SEL, OP_SEL_HI, ROW_MASK, BANK_MASK, SEXT).
   * 'choice': the options are the field's values (CLAMP, OMOD, BOUND_CTRL, FI, a DPP8 selector, the SDWA selectors).
   */
  kind: 'toggles' | 'choice';
  options: ModifierOption[];
}

type Source = 'src0' | 'src1' | 'src2';
const SOURCES: readonly Source[] = ['src0', 'src1', 'src2'];
const OMOD_SYNTAX = ['', 'mul:2', 'mul:4', 'div:2'];
const OMOD_MEANING = [
  'The result is written as computed', 'Multiply the result by 2', 'Multiply the result by 4', 'Divide the result by 2',
];
/** SDWA selectors in encoding order, with the bits each picks. */
const SDWA_SELS: Array<[string, string]> = [
  ['BYTE_0', 'Bits 7:0'], ['BYTE_1', 'Bits 15:8'], ['BYTE_2', 'Bits 23:16'], ['BYTE_3', 'Bits 31:24'],
  ['WORD_0', 'Bits 15:0'], ['WORD_1', 'Bits 31:16'], ['DWORD', 'All 32 bits'],
];
const SDWA_UNUSED: Array<[string, string]> = [
  ['UNUSED_PAD', 'Fill the other bits of VDST with 0'],
  ['UNUSED_SEXT', 'Fill the bits above the result with its sign, and those below it with 0'],
  ['UNUSED_PRESERVE', 'Keep the other bits of VDST'],
];
/**
 * The order LLVM prints these modifiers in; a new one is written in its place among them. DPP's masks and
 * flags follow its lane control (which is always written), and SDWA's selectors come last.
 */
const MODIFIER_RANK: Record<string, number> = {
  op_sel: 0, op_sel_hi: 1, neg_lo: 2, neg_hi: 3, clamp: 4, mul: 5, div: 5,
  ...Object.fromEntries(['quad_perm', 'row_shl', 'row_shr', 'row_ror', 'row_mirror', 'row_half_mirror', 'row_share', 'row_xmask', 'dpp8']
    .map(name => [name, 6])),
  row_mask: 7, bank_mask: 8, bound_ctrl: 9, fi: 10,
  dst_sel: 6, dst_unused: 7, src0_sel: 8, src0_sext: 8.5, src1_sel: 9, src1_sext: 9.5,
};
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

/** The modifiers written on a source. */
interface SourceMods {
  abs: boolean;
  neg: boolean;
  sext: boolean;
}

/** A source with the given modifiers, written in the style the line uses (|x| or abs(x), -x or neg(x)). */
function wrapSource(core: string, mods: SourceMods, constant: boolean, written: string): string {
  let text = mods.sext ? `sext(${core})` : core;
  if (mods.abs) text = /abs\s*\(/i.test(written) ? `abs(${text})` : `|${text}|`;
  // '-' before a constant is read as part of it (-1.0 is another constant, not 1.0 with NEG set)
  if (mods.neg) text = /neg\s*\(/i.test(written) || (constant && !mods.abs) ? `neg(${text})` : `-${text}`;
  return text;
}

/** An operand as written on the line, with its modifiers. */
function writtenOperand(lineText: string, instr: ParsedInstruction, slot: 'dst' | Source): string {
  const span = slot === 'dst' ? instr.spans?.dst : instr.wrappedSpans?.[slot];
  return span ? lineText.slice(span.start - 1, span.end - 1) : '—';
}

/** Source `slot` written with `change` made to its modifiers, and the span of the text it replaces. */
function rewrittenSource(lineText: string, instr: ParsedInstruction, slot: Source, change: Partial<SourceMods>):
  { span: SourceSpan; text: string } | { error: string } {
  const op = instr[slot];
  const core = instr.spans?.[slot];
  const wrapped = instr.wrappedSpans?.[slot];
  if (!op || !core || !wrapped) return { error: `${slot.toUpperCase()} is implicit: it is not written on this line` };
  const constant = op.type === OperandType.INLINE_INT || op.type === OperandType.INLINE_FLOAT || op.type === OperandType.LITERAL;
  const written = lineText.slice(wrapped.start - 1, wrapped.end - 1);
  const mods: SourceMods = { abs: !!op.abs, neg: !!op.neg, sext: /sext\s*\(/i.test(written), ...change };
  return { span: wrapped, text: wrapSource(lineText.slice(core.start - 1, core.end - 1), mods, constant, written) };
}

/** The line with source `slot` written with `change` made to its modifiers. */
function withSourceModifiers(lineText: string, instr: ParsedInstruction, slot: Source, change: Partial<SourceMods>): string | { error: string } {
  const source = rewrittenSource(lineText, instr, slot, change);
  return 'error' in source ? source : replaceSpan(lineText, source.span, source.text);
}

function clampMeaning(info: OpcodeInfo): string {
  if (info.format === InstructionFormat.VOPC) return 'Floating-point compares accept clamp; it does not change the result';
  const packed = info.format === InstructionFormat.VOP3P && !info.dot && !info.mnemonic.startsWith('v_fma_mix');
  if (PACKED_F16_RESULT.has(info.mnemonic) || (packed && !info.isIntegerOp)) return 'Clamp both f16 halves of the result to [0.0, 1.0]';
  if (packed) return 'Saturate both 16-bit halves of the result instead of letting them wrap';
  if (isFloatType(vopTypes(info).d)) return 'Clamp the result to [0.0, 1.0] (NaN becomes 0)';
  return 'Saturate: a result outside the integer range is clamped to it instead of wrapping';
}

/** Whether an instruction encoded as `extra` (DPP16, DPP8, SDWA, a literal or none of those) has bits for the field. */
function hasField(field: ModifierField, info: OpcodeInfo, extra: string | undefined): boolean {
  const vop3p = info.format === InstructionFormat.VOP3P;
  const dpp = extra === 'DPP16' || extra === 'DPP8';
  const sdwa = extra === 'SDWA';
  const sdwaCompare = sdwa && info.format === InstructionFormat.VOPC;
  switch (field) {
    case 'op_sel': return !dpp && !sdwa;
    case 'op_sel_hi': case 'neg_hi': return vop3p;
    case 'clamp': return !dpp && !sdwaCompare;
    case 'omod': return !vop3p && !dpp && !sdwaCompare;
    case 'abs': return !vop3p && extra !== 'DPP8';
    case 'neg': return extra !== 'DPP8';
    case 'row_mask': case 'bank_mask': case 'bound_ctrl': return extra === 'DPP16';
    case 'fi': return dpp;
    case 'dpp8': return extra === 'DPP8';
    case 'src0_sel': case 'sext': return sdwa;
    case 'src1_sel': return sdwa && info.format !== InstructionFormat.VOP1;
    case 'dst_sel': case 'dst_unused': return sdwa && !sdwaCompare;
  }
}

/**
 * The options of a modifier field of the instruction on `lineText`, each checked by assembling the changed line:
 * the fields with a bit per source (or per row or bank) switch one bit at a time, the others offer each value.
 * `lane` picks the selector of a DPP8 lane. Null when the line does not assemble, or its encoding has no such field.
 */
export function modifierOptions(lineText: string, field: ModifierField, lane = 0): ModifierChoices | null {
  const now = checkLine(lineText);
  const instr = now.instr;
  const info = instr && lookupByMnemonic(instr.mnemonic);
  if (!instr || !now.words || !info) return null;
  const m = info.mnemonic;
  const nsrc = valuSourceCount(info);
  const vop3p = info.format === InstructionFormat.VOP3P;
  const extra = planEncoding(instr, info).extra;
  if (!hasField(field, info, extra)) return null;

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
  /** One option per value, each written as `text(value)` (the value now leaves the line as it is). */
  const values = (names: Array<[string, string]>, current: number, text: (v: number) => string): ModifierChoices => ({
    kind: 'choice',
    options: names.map(([label, detail], v) => option(String(v), label, { detail }, v === current, v === current ? lineText : text(v))),
  });

  switch (field) {
    case 'clamp': {
      const offOmod = instr.omod && !omodIgnored(vopTypes(info).d, extra === 'SDWA', false)
        ? `; ${OMOD_SYNTAX[instr.omod]} then does nothing on the devkit's GPU` : '';
      return values([['off', 'The result is written as computed'], ['on', clampMeaning(info) + offOmod]], instr.clamp ? 1 : 0,
        v => setModifier(lineText, ['clamp'], v ? 'clamp' : ''));
    }
    case 'omod': {
      // The devkit's GPU ignores OMOD in some places; it still assembles there, and the option says so
      const ignored = omodIgnored(vopTypes(info).d, extra === 'SDWA', !!instr.clamp);
      return values(OMOD_SYNTAX.map((text, v) => [text || 'none', v && ignored ? `Does nothing here: ${ignored}` : OMOD_MEANING[v]]),
        instr.omod ?? 0, v => setModifier(lineText, ['mul', 'div'], OMOD_SYNTAX[v]));
    }
    case 'row_mask':
    case 'bank_mask': {
      // A bit per row of 16 lanes, or per bank of 4 lanes in each row; an unwritten mask is 0xf
      const rows = field === 'row_mask';
      const mask = (rows ? instr.rowMask : instr.bankMask) ?? 0xF;
      return { kind: 'toggles', options: [0, 1, 2, 3].map(b => {
        const next = mask ^ (1 << b);
        const detail = rows ? `Lanes ${16 * b}–${16 * b + 15}${b > 1 ? ' (wave64 only)' : ''}` : `Lanes ${4 * b}–${4 * b + 3} of each row`;
        return option(`${rows ? 'row' : 'bank'}${b}`, `${rows ? 'ROW' : 'BANK'} ${b}`, { detail }, !!((mask >> b) & 1),
          setModifier(lineText, [field], next === 0xF ? '' : `${field}:0x${next.toString(16)}`));
      }) };
    }
    case 'bound_ctrl':
      return values([['off', 'A lane whose source is outside its row, or inactive, is not written'],
        ['on', 'A lane whose source is outside its row, or inactive, reads 0']], instr.boundCtrl ? 1 : 0,
      v => setModifier(lineText, ['bound_ctrl'], v ? 'bound_ctrl:1' : ''));
    case 'fi':
      return values([['off', extra === 'DPP8' ? 'Reading an inactive lane gives 0' : 'Reading an inactive lane counts as reading outside the row'],
        ['on', 'Inactive lanes are read like active ones']], instr.fetchInactive ? 1 : 0,
      v => setModifier(lineText, ['fi'], v ? 'fi:1' : ''));
    case 'dpp8': {
      // Which lane of its group of 8 lane `lane` reads
      const sel = instr.dpp8 ?? [0, 1, 2, 3, 4, 5, 6, 7];
      const names = sel.map((_, k): [string, string] => [String(k), k === lane ? `Lane ${lane} reads itself` : `Lane ${lane} reads lane ${k} of its group of 8`]);
      return values(names, sel[lane], k => setModifier(lineText, ['dpp8'], `dpp8:[${sel.map((s, j) => (j === lane ? k : s)).join(',')}]`));
    }
    case 'src0_sel':
    case 'src1_sel':
    case 'dst_sel': {
      // Written even at DWORD, the default, since the last SDWA modifier gone would make it a plain VOP1/VOP2
      const sel = (field === 'src0_sel' ? instr.sdwaSrc0Sel : field === 'src1_sel' ? instr.sdwaSrc1Sel : instr.sdwaDstSel) ?? 6;
      return values(SDWA_SELS, sel, v => setModifier(lineText, [field], `${field}:${SDWA_SELS[v][0]}`));
    }
    case 'dst_unused':
      return values(SDWA_UNUSED, instr.sdwaDstUnused ?? 0, v => setModifier(lineText, ['dst_unused'], `dst_unused:${SDWA_UNUSED[v][0]}`));
    case 'sext': {
      // sext(x) on the source; a src0_sext / src1_sext flag (as the disassembler writes it) is removed too
      const flags = (instr.sdwaSrc0Sext ? 1 : 0) | (instr.sdwaSrc1Sext ? 2 : 0);
      return sourceToggles(flags, (i, slot) => {
        const on = !!((flags >> i) & 1);
        const line = withSourceModifiers(lineText, instr, slot, { sext: !on });
        return typeof line === 'string' && on ? setModifier(line, [`src${i}_sext`], '') : line;
      });
    }
    default:
      break;
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
    return withSourceModifiers(lineText, instr, slot, field === 'abs' ? { abs: !op?.abs } : { neg: !op?.neg });
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
    if (neg !== !!op.neg || abs !== !!op.abs) line = withSourceModifiers(lineText, instr, slot, { abs, neg });
    if (typeof line !== 'string') return line;
    if (lo !== (instr.negLo ?? 0)) line = setModifier(line, ['neg_lo'], lo & all ? list('neg_lo', lo) : '');
    if (hi !== (instr.negHi ?? 0)) line = setModifier(line, ['neg_hi'], hi & all ? list('neg_hi', hi) : '');
    return line;
  });
}

// ── Switching encodings ──

/** The encodings of a VOP1, VOP2 or VOPC instruction: its 32-bit one, VOP3, DPP16, DPP8 and SDWA. */
export type EncodingKey = 'e32' | 'vop3' | 'dpp16' | 'dpp8' | 'sdwa';

/** One encoding of the instruction on a line. */
export interface EncodingOption {
  key: EncodingKey;
  /** VOP1, VOP2, VOPC, VOP3A, VOP3B, DPP16, DPP8 or SDWA. */
  label: string;
  /** What the encoding offers the instruction. */
  detail: string;
  /** The instruction is encoded this way now. */
  current: boolean;
  /** The line rewritten in this encoding, when that assembles, and the size of its instruction in bytes. */
  line?: string;
  bytes?: number;
  /**
   * For VOP3 when nothing on `line` needs it: what VOP3 holds that would. Encodings are only chosen by what the line
   * holds, so `line` still assembles to the 32-bit encoding, and the panel shows VOP3's fields until one is set.
   */
  preview?: string[];
  /** Modifiers written on the line that this encoding has no room for: the rewritten line leaves them out. */
  dropped: string[];
  /** Why the instruction cannot be encoded this way. */
  error?: string;
}

const ENCODING_KEYS: readonly EncodingKey[] = ['e32', 'vop3', 'dpp16', 'dpp8', 'sdwa'];
const DPP16_NAMES = [
  'quad_perm', 'row_shl', 'row_shr', 'row_ror', 'row_mirror', 'row_half_mirror', 'row_share', 'row_xmask',
  'row_mask', 'bank_mask', 'bound_ctrl', 'fi',
];
const SDWA_NAMES = ['dst_sel', 'dst_unused', 'src0_sel', 'src1_sel', 'src0_sext', 'src1_sext'];
const OUTPUT_NAMES = ['clamp', 'mul', 'div'];
/** Modifiers written after the operands that belong to one encoding or another (ABS, NEG and SEXT wrap a source). */
const ENCODING_NAMES = new Set([...OUTPUT_NAMES, 'op_sel', ...DPP16_NAMES, 'dpp8', ...SDWA_NAMES]);
const DWORD_SEL = 6;

/** The modifiers written after the operands that encoding `key` has room for. */
function encodingModifiers(key: EncodingKey, info: OpcodeInfo): string[] {
  switch (key) {
    case 'e32': return [];
    case 'vop3': return [...OUTPUT_NAMES, 'op_sel'];
    case 'dpp16': return DPP16_NAMES;
    case 'dpp8': return ['dpp8', 'fi'];
    case 'sdwa': return info.format === InstructionFormat.VOPC ? SDWA_NAMES : [...SDWA_NAMES, ...OUTPUT_NAMES];
  }
}

/** Whether modifier `name`, as written, leaves the instruction's result as it would be without it. */
function changesNothing(name: string, instr: ParsedInstruction): boolean {
  const dword = (sel: number | undefined) => (sel ?? DWORD_SEL) === DWORD_SEL;
  switch (name) {
    case 'quad_perm': return instr.dppCtrl === 0xE4; // [0,1,2,3]
    case 'dpp8': return !!instr.dpp8?.every((sel, i) => sel === i);
    case 'row_mask': return (instr.rowMask ?? 0xF) === 0xF;
    case 'bank_mask': return (instr.bankMask ?? 0xF) === 0xF;
    case 'bound_ctrl': return !instr.boundCtrl;
    case 'fi': return !instr.fetchInactive;
    case 'op_sel': return !instr.opSel;
    case 'src0_sel': case 'src0_sext': return dword(instr.sdwaSrc0Sel);
    case 'src1_sel': case 'src1_sext': return dword(instr.sdwaSrc1Sel);
    case 'dst_sel': case 'dst_unused': return dword(instr.sdwaDstSel);
    default: return false;
  }
}

function encodingKey(plan: EncodingPlan): EncodingKey {
  if (plan.extra === 'DPP16') return 'dpp16';
  if (plan.extra === 'DPP8') return 'dpp8';
  if (plan.extra === 'SDWA') return 'sdwa';
  return plan.kind === 'VOP3A' || plan.kind === 'VOP3B' ? 'vop3' : 'e32';
}

/**
 * The line rewritten in encoding `key`, and the modifiers on it that the encoding leaves out. The other encodings'
 * modifiers go, and DPP16, DPP8 and SDWA start from a lane control or selectors that leave the result unchanged.
 */
function rewriteEncoding(lineText: string, instr: ParsedInstruction, info: OpcodeInfo, key: EncodingKey):
  { line: string; dropped: string[] } | { error: string } {
  const tokens = lineTokens(lineText);
  const name = instr.spans?.mnemonic;
  const mnemonic = name && tokens.find(t => t.type === TokenType.MNEMONIC && t.column === name.start);
  if (!name || !mnemonic) return { error: 'The mnemonic is not written on this line' };
  const edits: Array<SourceSpan & { text: string }> = [];
  const dropped: string[] = [];

  // The mnemonic: what the line holds chooses the encoding, so an _e32, _e64, _dpp or _sdwa suffix goes
  const base = lineText.slice(name.start - 1, name.end - 1);
  edits.push({ start: mnemonic.column, end: mnemonic.end, text: base });

  // ABS and NEG on the sources (VOP3, DPP16 and SDWA have them), and SEXT (SDWA)
  const absNeg = key === 'vop3' || key === 'dpp16' || key === 'sdwa';
  for (const slot of SOURCES) {
    const op = instr[slot];
    const wrapped = instr.wrappedSpans?.[slot];
    if (!op || !wrapped) continue;
    const written = lineText.slice(wrapped.start - 1, wrapped.end - 1);
    const sext = key !== 'sdwa' && /sext\s*\(/i.test(written);
    const signs = !absNeg && !!(op.abs || op.neg);
    if (!sext && !signs) continue;
    const source = rewrittenSource(lineText, instr, slot, signs ? { abs: false, neg: false, sext: false } : { sext: false });
    if ('error' in source) return source;
    edits.push({ ...source.span, text: source.text });
    const sel = slot === 'src0' ? instr.sdwaSrc0Sel : slot === 'src1' ? instr.sdwaSrc1Sel : undefined;
    if (signs || (sel ?? DWORD_SEL) !== DWORD_SEL) dropped.push(written);
  }

  // The modifiers of other encodings, each with the space before it
  const keep = encodingModifiers(key, info);
  tokens.forEach((t, i) => {
    const mod = t.type === TokenType.MODIFIER ? modifierName(t) : '';
    if (!ENCODING_NAMES.has(mod) || keep.includes(mod)) return;
    edits.push({ start: i > 0 ? tokens[i - 1].end : t.column, end: t.end, text: '' });
    if (!changesNothing(mod, instr)) dropped.push(lineText.slice(t.column - 1, t.end - 1));
  });

  // From right to left, so that the columns of the edits still to make stay put
  let line = lineText;
  for (const e of edits.sort((a, b) => b.start - a.start)) line = line.slice(0, e.start - 1) + e.text + line.slice(e.end - 1);

  const add = (text: string) => { line = setModifier(line, [text.split(':')[0]], text); };
  if (key === 'dpp16') add('quad_perm:[0,1,2,3]');
  if (key === 'dpp8') add('dpp8:[0,1,2,3,4,5,6,7]');
  if (key === 'sdwa') {
    if (info.format !== InstructionFormat.VOPC) ['dst_sel:DWORD', 'dst_unused:UNUSED_PAD'].forEach(add);
    add('src0_sel:DWORD');
    if (info.format !== InstructionFormat.VOP1) add('src1_sel:DWORD');
  }
  return { line, dropped };
}

/** Why the instruction on `line`, which has nothing of the other encodings, still needs VOP3. */
function e32Obstacle(line: string, instr: ParsedInstruction, info: OpcodeInfo): string {
  const f = info.format;
  const written = (slot: OperandSlot) => {
    const span = instr.spans?.[slot];
    return span ? line.slice(span.start - 1, span.end - 1) : '';
  };
  if (f !== InstructionFormat.VOP1 && instr.src1 && instr.src1.type !== OperandType.VGPR) {
    return `SRC1 is ${written('src1')}, but the 32-bit ${f} encoding only has room for a VGPR there`;
  }
  const cmpx = f === InstructionFormat.VOPC && info.mnemonic.startsWith('v_cmpx_');
  if (instr.sdst && instr.sdst.value !== (cmpx ? EXEC_LO : VCC_LO)) {
    return `The 32-bit ${f} encoding always writes the ${f === InstructionFormat.VOPC ? 'result' : 'carry'} to ` +
      `${cmpx ? 'EXEC_LO' : 'VCC_LO'}, not ${written('sdst')}`;
  }
  if ((info.carryIn || info.mnemonic === 'v_cndmask_b32') && instr.src2 && instr.src2.value !== VCC_LO) {
    return `The 32-bit VOP2 encoding always reads the ${info.carryIn ? 'carry' : 'condition'} from VCC_LO, not ${written('src2')}`;
  }
  return `${info.mnemonic} needs the VOP3 encoding here`;
}

/** "a", "a and b", "a, b and c"; with a comma before the last "and" when an item has an "and" of its own. */
function listText(items: string[]): string {
  if (items.length < 2) return items.join('');
  const comma = items.some(item => item.includes(' and ')) ? ',' : '';
  return `${items.slice(0, -1).join(', ')}${comma} and ${items[items.length - 1]}`;
}

/** The source modifiers (NEG, ABS, SEXT) and output modifiers the instruction on `line` takes in encoding `key`. */
function modifiersTaken(key: EncodingKey, line: string): string[] {
  const instr = checkLine(line).instr;
  if (!instr) return [];
  const assembles = (changed: string | { error: string }) => typeof changed === 'string' && !!checkLine(changed).words;
  const takes: string[] = [];
  if (key === 'sdwa' && assembles(withSourceModifiers(line, instr, 'src0', { sext: true }))) takes.push('SEXT on sources');
  const neg = !!instr.src0.neg || assembles(withSourceModifiers(line, instr, 'src0', { neg: true }));
  const abs = !!instr.src0.abs || assembles(withSourceModifiers(line, instr, 'src0', { abs: true }));
  if (neg || abs) takes.push(`${neg && abs ? 'NEG and ABS' : neg ? 'NEG' : 'ABS'} on sources`);
  if (key === 'dpp16') return takes;
  if (instr.clamp || assembles(setModifier(line, ['clamp'], 'clamp'))) takes.push('CLAMP');
  if (instr.omod || assembles(setModifier(line, ['mul', 'div'], 'mul:2'))) takes.push('output modifiers (mul:2, mul:4, div:2)');
  return takes;
}

/**
 * What the VOP3 encoding holds that the 32-bit one cannot, for the instruction on `line` (each modifier is tried on
 * it), or for any instruction like it when `line` is not given.
 */
function vop3Additions(info: OpcodeInfo, line?: string): string[] {
  const items: string[] = [];
  if (info.format !== InstructionFormat.VOP1) items.push('an SGPR or constant as SRC1');
  if (info.format === InstructionFormat.VOPC && !info.mnemonic.startsWith('v_cmpx_')) items.push('any SGPR for the result');
  if (info.carry) items.push('any SGPRs for the carry');
  if (info.mnemonic === 'v_cndmask_b32') items.push('any SGPR for the condition');
  if (line !== undefined) items.push(...modifiersTaken('vop3', line));
  if (info.opSel && !info.carry) items.push('OP_SEL (the high halves of 16-bit operands)');
  return items;
}

/**
 * What encoding `key` offers the instruction. `line` is the instruction in that encoding, when it can be encoded
 * so: the modifiers it takes there are found by trying each of them on it.
 */
function encodingDetail(key: EncodingKey, info: OpcodeInfo, line?: string): string {
  const f = info.format;
  const vop1 = f === InstructionFormat.VOP1;
  const vopc = f === InstructionFormat.VOPC;
  const cmpx = vopc && info.mnemonic.startsWith('v_cmpx_');
  const modifiers = () => (line === undefined ? [] : modifiersTaken(key, line));
  const vgprs = vop1 ? 'SRC0 must be a VGPR' : 'Both sources must be VGPRs';
  const also = (items: string[]) => (items.length ? `; it also takes ${listText(items)}` : '');
  switch (key) {
    case 'e32': {
      const fixed = vopc ? `, and the result always goes to ${cmpx ? 'EXEC_LO' : 'VCC_LO'}`
        : info.carry ? ', and the carry is always VCC_LO'
          : info.mnemonic === 'v_cndmask_b32' ? ', and the condition is always VCC_LO' : '';
      return `The 32-bit encoding: SRC0 can be any register or constant${vop1 ? '' : ', SRC1 must be a VGPR'}${fixed}. No modifiers.`;
    }
    case 'vop3': {
      const items = vop3Additions(info, line);
      return items.length ? `The 64-bit encoding, which adds ${listText(items)}.` : `The 64-bit encoding, which adds nothing ${info.mnemonic} can use.`;
    }
    case 'dpp16':
      return 'SRC0 reads another lane of its row of 16, picked by a lane control (quad_perm, row_shl, row_shr, row_ror, ' +
        `row_mirror, row_half_mirror, row_share or row_xmask); ROW_MASK and BANK_MASK pick the lanes written. ${vgprs}${also(modifiers())}.`;
    case 'dpp8':
      return `SRC0 reads any lane of its group of 8 (dpp8:[…]). ${vgprs}, without NEG or ABS.`;
    case 'sdwa': {
      const what = vopc
        ? `Compares a byte or word of each source (src0_sel, src1_sel)${cmpx ? '' : ', and can write the result to any SGPR'}`
        : `Reads a byte or word of ${vop1 ? 'SRC0 (src0_sel)' : 'each source (src0_sel, src1_sel)'} and writes a byte or word of VDST (dst_sel, dst_unused)`;
      return `${what}. Sources can be VGPRs, SGPRs or inline constants${also(modifiers())}.`;
    }
  }
}

/**
 * The encodings the VOP1, VOP2 or VOPC instruction on `lineText` can be switched between: its 32-bit one, VOP3,
 * DPP16, DPP8 and SDWA, each other one with the line rewritten in it when that assembles, or why not. No encoding
 * suffix is written: DPP16, DPP8 and SDWA start from quad_perm:[0,1,2,3], dpp8:[0,1,2,3,4,5,6,7] and DWORD
 * selectors, which leave the result unchanged, and VOP3 is a preview of its fields while nothing on the line needs
 * it. Null when the line does not assemble, holds another kind of instruction, or has no other encoding.
 */
export function encodingOptions(lineText: string): EncodingOption[] | null {
  const now = checkLine(lineText);
  const instr = now.instr;
  const info = instr && lookupByMnemonic(instr.mnemonic);
  if (!instr || !now.words || !info) return null;
  const f = info.format;
  if (f !== InstructionFormat.VOP1 && f !== InstructionFormat.VOP2 && f !== InstructionFormat.VOPC) return null;
  const bytes = now.words.length * 4;
  const currentKey = encodingKey(planEncoding(instr, info));
  const options = ENCODING_KEYS.map((key): EncodingOption => {
    const label = key === 'e32' ? f : key === 'vop3' ? (f === InstructionFormat.VOP2 && info.carry ? 'VOP3B' : 'VOP3A') : key.toUpperCase();
    if (key === currentKey) return { key, label, detail: encodingDetail(key, info, lineText), current: true, line: lineText, bytes, dropped: [] };
    const unavailable = (error: string): EncodingOption => ({ key, label, detail: encodingDetail(key, info), current: false, dropped: [], error });
    const rewritten = rewriteEncoding(lineText, instr, info, key);
    if ('error' in rewritten) return unavailable(rewritten.error);
    const result = checkLine(rewritten.line);
    if (!result.instr || !result.words) return unavailable(result.error ?? 'It does not assemble');
    const option = { key, label, detail: encodingDetail(key, info, rewritten.line), current: false, line: rewritten.line, dropped: rewritten.dropped };
    const resultKey = encodingKey(planEncoding(result.instr, info));
    if (resultKey === key) return { ...option, bytes: result.words.length * 4 };
    if (key !== 'vop3' || resultKey !== 'e32') {
      return unavailable(key === 'e32' ? e32Obstacle(rewritten.line, result.instr, info) : `${info.mnemonic} cannot be encoded as ${label} here`);
    }
    // Nothing on the line needs VOP3, so it stays in its 32-bit encoding until one of VOP3's fields is set
    let vop3: number[];
    try {
      vop3 = encodeInstruction({ ...result.instr, forceVop3: true });
    } catch (e) {
      if (e instanceof EncodingError) return unavailable(e.message);
      throw e;
    }
    const preview = vop3Additions(info, rewritten.line);
    if (!preview.length) return unavailable(`${label} adds nothing ${info.mnemonic} can use, so the assembler always picks ${f} for it`);
    return { ...option, bytes: vop3.length * 4, preview };
  });
  return options.some(o => !o.current && o.line !== undefined) ? options : null;
}
