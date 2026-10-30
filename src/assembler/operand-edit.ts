// ── Editing one part of an instruction ──
// Lists what an instruction's mnemonic or one of its operands can be changed to, keeping only the
// choices that still assemble, so the Instruction Info panel can rewrite the source line in place.

import { encodeInstruction, EncodingError } from '../isa/encoding';
import { getAllOpcodes, lookupByMnemonic } from '../isa/opcodes';
import { operandRegCount } from '../isa/operands';
import { NUM_VGPRS, SGPR_MAX } from '../isa/constants';
import { InstructionFormat, Operand, OperandSlot, OperandType, ParsedInstruction, SourceSpan } from '../isa/types';
import { tokenize, TokenType } from './lexer';
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
