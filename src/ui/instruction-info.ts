// ── Instruction Info Panel ──
// Shows detailed info about the instruction under the cursor: its machine-code bit fields
// (taken from the real encoding), a formula with the actual operands, and opcode metadata.

import {
  AssemblyResult, DecodedInstruction, InstructionFormat, OpcodeInfo, Operand, OperandType, ParsedInstruction,
} from '../isa/types';
import { lookupByMnemonic } from '../isa/opcodes';
import { decodeBinary, describeDppCtrl, encodeInstruction, scalarRegName, sourceFieldName } from '../isa/encoding';
import { OperandRole, operandRegCount, valuSourceCount } from '../isa/operands';
import { VCC_LO } from '../isa/constants';

// ── Bit-field layouts ──

/** One field of a 32-bit instruction dword, from bit `hi` down to bit `lo`. */
interface BitField {
  name: string;
  hi: number;
  lo: number;
  color: string;
  /** Display text for the field's value; `words` is the whole encoded instruction. */
  show: (value: number, words: number[]) => string;
}

interface DwordLayout {
  label: string;
  fields: BitField[];
}

interface LayoutContext {
  info: OpcodeInfo;
  instr: ParsedInstruction;
  decoded: DecodedInstruction;
}

const COLOR = {
  encoding: '#f85149',
  op: '#58a6ff',
  dst: '#39d353',
  src0: '#bc8cff',
  src1: '#d29922',
  src2: '#8b949e',
  abs: '#39c5cf',
  neg: '#f0883e',
  modifier: '#db6d28',
  select: '#a371f7',
  reserved: '#6e7681',
};

const SDWA_SEL = ['BYTE_0', 'BYTE_1', 'BYTE_2', 'BYTE_3', 'WORD_0', 'WORD_1', 'DWORD', '7'];
const SDWA_UNUSED = ['PAD', 'SEXT', 'PRESERVE', '3'];
const OMOD = ['none', '×2', '×4', '÷2'];

function hexVal(v: number, pad = 2): string {
  return '0x' + (v >>> 0).toString(16).padStart(pad, '0').toUpperCase();
}

function field(name: string, hi: number, lo: number, color: string, show: BitField['show'] = v => String(v)): BitField {
  return { name, hi, lo, color, show };
}

/** Fixed encoding bits that identify the format. */
const fixed = (hi: number, lo: number): BitField => field('ENC', hi, lo, COLOR.encoding, v => hexVal(v, 1));
const reserved = (hi: number, lo: number): BitField => field('', hi, lo, COLOR.reserved, () => '—');
const binary = (n: number) => (v: number) => v.toString(2).padStart(n, '0');
const opField = (hi: number, lo: number, ctx: LayoutContext): BitField => field('OP', hi, lo, COLOR.op, () => ctx.info.mnemonic);

function vgprName(v: number, count = 1): string {
  return count > 1 ? `v[${v}:${v + count - 1}]` : `v${v}`;
}

function regWidth(ctx: LayoutContext, role: OperandRole): number {
  return operandRegCount(ctx.info, role);
}

/** A 9-bit VALU or 8-bit SALU source field. */
function sourceName(v: number, count: number): string {
  if (v >= 256) return vgprName(v - 256, count);
  if (v <= 127) return scalarRegName(v, count > 1 ? 64 : 32);
  return sourceFieldName(v);
}

function valuSource(ctx: LayoutContext, index: 0 | 1 | 2): BitField['show'] {
  const role = (['src0', 'src1', 'src2'] as const)[index];
  if (index >= valuSourceCount(ctx.info)) return () => '—';
  return v => sourceName(v, regWidth(ctx, role));
}

/** The VDST field holds an SGPR for scalar results (v_readlane, VOP3 compares, …). */
function vdst(ctx: LayoutContext): BitField['show'] {
  if (ctx.instr.dst.type !== OperandType.VGPR) return v => scalarRegName(v);
  return v => vgprName(v, regWidth(ctx, 'dst'));
}

function scalarDst(ctx: LayoutContext): BitField['show'] {
  return v => scalarRegName(v, regWidth(ctx, 'dst') > 1 ? 64 : 32);
}

function scalarSrc(ctx: LayoutContext, role: OperandRole): BitField['show'] {
  return v => sourceName(v, regWidth(ctx, role));
}

/** VSRC1 of a 32-bit VALU encoding; with SDWA its S1 bit makes it a scalar or constant. */
function vsrc1(ctx: LayoutContext): BitField['show'] {
  if (ctx.decoded.extra === 'SDWA') return (v, w) => ((w[1] >>> 31) & 1 ? sourceFieldName(v) : vgprName(v));
  return v => vgprName(v);
}

function e32Fields(ctx: LayoutContext): BitField[] {
  const src0 = field('SRC0', 8, 0, COLOR.src0, valuSource(ctx, 0));
  switch (ctx.decoded.encoding) {
    case 'VOP1':
      return [fixed(31, 25), field('VDST', 24, 17, COLOR.dst, vdst(ctx)), opField(16, 9, ctx), src0];
    case 'VOP2':
      return [fixed(31, 31), opField(30, 25, ctx), field('VDST', 24, 17, COLOR.dst, vdst(ctx)),
        field('VSRC1', 16, 9, COLOR.src1, vsrc1(ctx)), src0];
    default: // VOPC
      return [fixed(31, 25), opField(24, 17, ctx), field('VSRC1', 16, 9, COLOR.src1, vsrc1(ctx)), src0];
  }
}

function vop3SourceFields(ctx: LayoutContext, vop3p: boolean): BitField[] {
  return [
    field('NEG', 31, 29, COLOR.neg, binary(3)),
    vop3p ? field('OP_SEL_HI', 28, 27, COLOR.select, binary(2)) : field('OMOD', 28, 27, COLOR.modifier, v => OMOD[v]),
    field('SRC2', 26, 18, COLOR.src2, valuSource(ctx, 2)),
    field('SRC1', 17, 9, COLOR.src1, valuSource(ctx, 1)),
    field('SRC0', 8, 0, COLOR.src0, valuSource(ctx, 0)),
  ];
}

function dpp16Fields(): BitField[] {
  return [
    field('ROW_MASK', 31, 28, COLOR.select, v => hexVal(v, 1)),
    field('BANK_MASK', 27, 24, COLOR.select, v => hexVal(v, 1)),
    field('S1 ABS', 23, 23, COLOR.abs), field('S1 NEG', 22, 22, COLOR.neg),
    field('S0 ABS', 21, 21, COLOR.abs), field('S0 NEG', 20, 20, COLOR.neg),
    field('BC', 19, 19, COLOR.modifier), field('FI', 18, 18, COLOR.modifier),
    reserved(17, 17),
    field('DPP_CTRL', 16, 8, COLOR.select, v => describeDppCtrl(v)),
    field('SRC0', 7, 0, COLOR.src0, v => vgprName(v)),
  ];
}

function dpp8Fields(): BitField[] {
  const fields: BitField[] = [];
  for (let lane = 7; lane >= 0; lane--) fields.push(field(`SEL${lane}`, 10 + lane * 3, 8 + lane * 3, COLOR.select));
  fields.push(field('SRC0', 7, 0, COLOR.src0, v => vgprName(v)));
  return fields;
}

function sdwaFields(ctx: LayoutContext): BitField[] {
  const format = ctx.info.format;
  const sel = (v: number) => SDWA_SEL[v];
  const fields: BitField[] = format === InstructionFormat.VOP1 ? [reserved(31, 24)] : [
    field('S1', 31, 31, COLOR.src1), reserved(30, 30),
    field('S1 ABS', 29, 29, COLOR.abs), field('S1 NEG', 28, 28, COLOR.neg), field('S1 SEXT', 27, 27, COLOR.modifier),
    field('SRC1_SEL', 26, 24, COLOR.select, sel),
  ];
  fields.push(
    field('S0', 23, 23, COLOR.src0), reserved(22, 22),
    field('S0 ABS', 21, 21, COLOR.abs), field('S0 NEG', 20, 20, COLOR.neg), field('S0 SEXT', 19, 19, COLOR.modifier),
    field('SRC0_SEL', 18, 16, COLOR.select, sel),
  );
  if (format === InstructionFormat.VOPC) {
    fields.push(
      field('SD', 15, 15, COLOR.dst),
      field('SDST', 14, 8, COLOR.dst, (v, w) => ((w[1] >>> 15) & 1 ? scalarRegName(v) : 'vcc_lo')),
    );
  } else {
    fields.push(
      field('OMOD', 15, 14, COLOR.modifier, v => OMOD[v]),
      field('CLAMP', 13, 13, COLOR.modifier),
      field('DST_UNUSED', 12, 11, COLOR.select, v => SDWA_UNUSED[v]),
      field('DST_SEL', 10, 8, COLOR.select, sel),
    );
  }
  fields.push(field('SRC0', 7, 0, COLOR.src0, (v, w) => ((w[1] >>> 23) & 1 ? sourceFieldName(v) : vgprName(v))));
  return fields;
}

function sopp16(ctx: LayoutContext): BitField['show'] {
  if (ctx.info.mnemonic.includes('branch')) return v => `${(v << 16) >> 16} dwords`;
  return v => hexVal(v, 4);
}

function dsFields(ctx: LayoutContext): DwordLayout[] {
  const { instr } = ctx;
  const unused = () => '—';
  return [
    { label: 'DS', fields: [
      fixed(31, 26), opField(25, 18, ctx), field('GDS', 17, 17, COLOR.modifier), reserved(16, 16),
      field('OFFSET1', 15, 8, COLOR.src1), field('OFFSET0', 7, 0, COLOR.src1),
    ] },
    { label: 'DS', fields: [
      field('VDST', 31, 24, COLOR.dst, instr.dst.type === OperandType.VGPR ? v => vgprName(v, regWidth(ctx, 'dst')) : unused),
      field('DATA1', 23, 16, COLOR.src2, instr.src2 ? v => vgprName(v) : unused),
      field('DATA0', 15, 8, COLOR.neg, instr.src1 ? v => vgprName(v) : unused),
      field('ADDR', 7, 0, COLOR.src0, v => vgprName(v)),
    ] },
  ];
}

/** Bit-field layout of every dword of an encoded instruction. */
function layoutFor(ctx: LayoutContext, words: number[]): DwordLayout[] {
  const d = ctx.decoded;
  const dwords: DwordLayout[] = [];
  const push = (label: string, fields: BitField[]) => dwords.push({ label, fields });
  const sdst = field('SDST', 22, 16, COLOR.dst, scalarDst(ctx));
  const ssrc0 = field('SSRC0', 7, 0, COLOR.src0, scalarSrc(ctx, 'src0'));
  const ssrc1 = field('SSRC1', 15, 8, COLOR.src1, scalarSrc(ctx, 'src1'));
  switch (d.encoding) {
    case 'VOP1': case 'VOP2': case 'VOPC':
      push(d.encoding, e32Fields(ctx));
      break;
    case 'VOP3A':
      push('VOP3A', [fixed(31, 26), opField(25, 16, ctx), field('CLAMP', 15, 15, COLOR.modifier),
        field('OP_SEL', 14, 11, COLOR.select, binary(4)), field('ABS', 10, 8, COLOR.abs, binary(3)),
        field('VDST', 7, 0, COLOR.dst, vdst(ctx))]);
      push('VOP3A', vop3SourceFields(ctx, false));
      break;
    case 'VOP3B':
      push('VOP3B', [fixed(31, 26), opField(25, 16, ctx), field('CLAMP', 15, 15, COLOR.modifier),
        field('SDST', 14, 8, COLOR.dst, v => scalarRegName(v)), field('VDST', 7, 0, COLOR.dst, vdst(ctx))]);
      push('VOP3B', vop3SourceFields(ctx, false));
      break;
    case 'VOP3P':
      push('VOP3P', [fixed(31, 23), opField(22, 16, ctx), field('CLAMP', 15, 15, COLOR.modifier),
        field('OP_SEL_HI[2]', 14, 14, COLOR.select), field('OP_SEL', 13, 11, COLOR.select, binary(3)),
        field('NEG_HI', 10, 8, COLOR.neg, binary(3)), field('VDST', 7, 0, COLOR.dst, vdst(ctx))]);
      push('VOP3P', vop3SourceFields(ctx, true));
      break;
    case 'SOP1':
      push('SOP1', [fixed(31, 23), sdst, opField(15, 8, ctx), ssrc0]);
      break;
    case 'SOP2':
      push('SOP2', [fixed(31, 30), opField(29, 23, ctx), sdst, ssrc1, ssrc0]);
      break;
    case 'SOPC':
      push('SOPC', [fixed(31, 23), opField(22, 16, ctx), ssrc1, ssrc0]);
      break;
    case 'SOPK':
      push('SOPK', [fixed(31, 28), opField(27, 23, ctx), sdst, field('SIMM16', 15, 0, COLOR.src0, v => hexVal(v, 4))]);
      break;
    case 'SOPP':
      push('SOPP', [fixed(31, 23), opField(22, 16, ctx), field('SIMM16', 15, 0, COLOR.src0, sopp16(ctx))]);
      break;
    case 'DS':
      dwords.push(...dsFields(ctx));
      break;
    default:
      return [];
  }
  if (d.extra === 'DPP16') push('DPP16', dpp16Fields());
  else if (d.extra === 'DPP8') push('DPP8', dpp8Fields());
  else if (d.extra === 'SDWA') push('SDWA', sdwaFields(ctx));
  while (dwords.length < words.length) {
    const name = ctx.info.kLiteral ? 'K' : 'LITERAL';
    push(name === 'K' ? 'K constant' : 'Literal', [field(name, 31, 0, COLOR.src1, v => hexVal(v, 8))]);
  }
  return dwords;
}

/** Encoding name shown in the header, e.g. "VOP3A (promoted from VOP2)" or "VOP2 + DPP16". */
function encodingName(d: DecodedInstruction, info: OpcodeInfo): string {
  if (d.extra === 'DPP16' || d.extra === 'DPP8' || d.extra === 'SDWA') return `${d.encoding} + ${d.extra}`;
  if ((d.encoding === 'VOP3A' || d.encoding === 'VOP3B') && info.format !== InstructionFormat.VOP3) {
    return `${d.encoding} (promoted from ${info.format})`;
  }
  return d.encoding;
}

// ── Operand text and the math formula ──

function constantText(op: Operand): string {
  const v = op.value;
  if (op.type === OperandType.INLINE_FLOAT || op.isFloat) return Number.isInteger(v) ? `${v}.0` : String(v);
  if (op.type === OperandType.LITERAL && Number.isInteger(v) && (v < -16 || v > 64)) return hexVal(v, 1);
  return String(v);
}

function operandText(op: Operand | undefined): string {
  if (!op) return '';
  const count = op.regCount ?? 1;
  let text: string;
  switch (op.type) {
    case OperandType.VGPR: text = vgprName(op.value, count); break;
    case OperandType.SGPR: text = count > 1 ? `s[${op.value}:${op.value + count - 1}]` : `s${op.value}`; break;
    case OperandType.SPECIAL: text = scalarRegName(op.value, count > 1 ? 64 : 32); break;
    default: text = constantText(op);
  }
  if (op.abs) text = `|${text}|`;
  return op.neg ? `-${text}` : text;
}

/** A description line that is a formula, e.g. "vdst = src0 + src1" or "SCC = (ssrc0 == ssrc1)". */
const FORMULA_START = /^(\{|vdst|sdst|vcc|exec|scc|lds|d\b)/i;

function formulaLineOf(info: OpcodeInfo): string | undefined {
  return info.description.split('\n').slice(1).find(l => FORMULA_START.test(l.trim()));
}

function buildFormula(info: OpcodeInfo, instr: ParsedInstruction): string {
  const formulaLine = formulaLineOf(info);
  if (!formulaLine) return '';

  const src0 = operandText(instr.src0);
  const src1 = operandText(instr.src1);
  const src2 = operandText(instr.src2);
  const names: Record<string, string> = {
    vdst: operandText(instr.dst),
    sdst: operandText(instr.sdst ?? instr.dst),
    src0, vsrc0: src0, ssrc0: src0,
    src1, vsrc1: src1, ssrc1: src1,
    src2, vsrc2: src2,
  };
  if (info.format === InstructionFormat.DS) {
    Object.assign(names, { vaddr: src0, vdata: src1, offset: String(instr.offset ?? 0) });
  }
  // "vdst[0:1]" marks a register pair; the substituted name is already a range such as v[2:3]
  let formula = formulaLine.trim().replace(/\b(vdst|sdst|v?src[0-2]|ssrc[01]|vaddr|vdata|offset)\b(\[0:1\])?/gi,
    (m, name: string) => names[name.toLowerCase()] || m);

  // Lane masks: compares write VCC unless the VOP3 / SDWA form names another SGPR;
  // VOP3 v_cndmask and carry ops read (and write) the SGPRs named in src2 / sdst
  const maskName = (op: Operand | undefined) => (op && op.value !== VCC_LO ? operandText(op) : 'VCC');
  if (info.format === InstructionFormat.VOPC) {
    formula = formula.replace(/^VCC\b/, maskName(instr.sdst));
  } else if (info.mnemonic === 'v_cndmask_b32') {
    formula = formula.replace(/\bVCC\b/, maskName(instr.src2));
  } else if (info.carry) {
    let k = 0;
    formula = formula.replace(/\bVCC\b/g, () => maskName(info.carryIn && k++ === 0 ? instr.src2 : instr.sdst));
  }

  if (instr.omod === 1) formula += ' × 2';
  if (instr.omod === 2) formula += ' × 4';
  if (instr.omod === 3) formula += ' ÷ 2';
  if (instr.clamp) formula = `clamp(${formula})`;
  return formula;
}

/** Plain-language meaning of a DPP16 control value. */
function dppMeaning(ctrl: number): string {
  const n = ctrl & 0xF;
  if (ctrl <= 0xFF) return 'each lane reads the lane of its quad chosen by the quad_perm selector';
  if (ctrl >= 0x101 && ctrl <= 0x10F) return `lane i reads lane i+${n} of its row`;
  if (ctrl >= 0x111 && ctrl <= 0x11F) return `lane i reads lane i−${n} of its row`;
  if (ctrl >= 0x121 && ctrl <= 0x12F) return `lane i reads lane (i−${n}) mod 16 of its row`;
  if (ctrl === 0x140) return 'lane i reads lane 15−i of its row';
  if (ctrl === 0x141) return 'lane i reads lane 7−i of its half-row';
  if (ctrl >= 0x150 && ctrl <= 0x15F) return `every lane reads lane ${n} of its row`;
  if (ctrl >= 0x160 && ctrl <= 0x16F) return `lane i reads lane i XOR ${n} of its row`;
  return 'reserved control value';
}

/** One-line summary of the DPP / SDWA / packed-math modifiers, or '' when there are none. */
function modifierSummary(d: DecodedInstruction, info: OpcodeInfo): string {
  if (d.extra === 'DPP16') {
    const ctrl = d.dppCtrl ?? 0;
    const masks = `row_mask:${hexVal(d.rowMask ?? 0xF, 1)} bank_mask:${hexVal(d.bankMask ?? 0xF, 1)}`;
    const flags = `${d.boundCtrl ? ' bound_ctrl:1' : ''}${d.fetchInactive ? ' fi:1' : ''}`;
    return `DPP16 ${describeDppCtrl(ctrl)} ${masks}${flags} — ${dppMeaning(ctrl)}`;
  }
  if (d.extra === 'DPP8') {
    return `DPP8 [${(d.dpp8 ?? []).join(',')}]${d.fetchInactive ? ' fi:1' : ''} — lane i reads lane sel[i mod 8] of its group of 8`;
  }
  if (d.extra === 'SDWA') {
    const sel = (v: number | undefined) => SDWA_SEL[v ?? 6];
    const parts = [`src0_sel:${sel(d.sdwaSrc0Sel)}${d.sdwaSrc0Sext ? ' (sext)' : ''}`];
    if (info.format !== InstructionFormat.VOP1) parts.push(`src1_sel:${sel(d.sdwaSrc1Sel)}${d.sdwaSrc1Sext ? ' (sext)' : ''}`);
    if (info.format !== InstructionFormat.VOPC) {
      parts.push(`dst_sel:${sel(d.sdwaDstSel)}`, `dst_unused:${SDWA_UNUSED[d.sdwaDstUnused ?? 0]}`);
    }
    return `SDWA ${parts.join(' ')}`;
  }
  if (d.encoding === 'VOP3P' && !info.mnemonic.startsWith('v_fma_mix')) {
    const n = valuSourceCount(info);
    const list = (bits: number) => `[${Array.from({ length: n }, (_, i) => (bits >> i) & 1).join(',')}]`;
    return `op_sel:${list(d.opSel ?? 0)} (lo result) op_sel_hi:${list(d.opSelHi ?? 7)} (hi result) — 1 reads a source's hi half`;
  }
  return '';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Main class ──

const PLACEHOLDER = '<div class="instr-info-placeholder">Move cursor to an instruction to see details</div>';

export class InstructionInfo {
  private container: HTMLElement;
  private scrollable: HTMLElement;
  private bodyEl: HTMLElement;
  private toggleBtn: HTMLButtonElement;
  private collapsed = false;
  private lastSource = '';

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('instr-info-panel');

    const header = document.createElement('div');
    header.className = 'panel__header';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.cursor = 'pointer';

    const label = document.createElement('span');
    label.textContent = 'Instruction Info';

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.className = 'binary-toggle';
    this.toggleBtn.textContent = '▼';
    this.toggleBtn.title = 'Collapse instruction info';

    header.append(label, this.toggleBtn);
    header.onclick = () => this.toggle();

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'instr-info-body';
    this.bodyEl.innerHTML = PLACEHOLDER;

    this.scrollable = document.createElement('div');
    this.scrollable.className = 'panel__content';
    this.scrollable.style.padding = '0';
    this.scrollable.appendChild(this.bodyEl);

    this.container.append(header, this.scrollable);
  }

  private toggle(): void {
    this.collapsed = !this.collapsed;
    this.applyCollapsed();
  }

  private applyCollapsed(): void {
    this.scrollable.style.display = this.collapsed ? 'none' : '';
    this.toggleBtn.textContent = this.collapsed ? '▶' : '▼';
    this.toggleBtn.title = this.collapsed ? 'Expand instruction info' : 'Collapse instruction info';
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.applyCollapsed();
  }

  update(assemblyResult: AssemblyResult | null, cursorLine: number): void {
    if (!assemblyResult) {
      this.bodyEl.innerHTML = PLACEHOLDER;
      return;
    }

    const instr = assemblyResult.instructions.find(i => i.line === cursorLine);
    if (instr) {
      const info = lookupByMnemonic(instr.mnemonic);
      if (!info) {
        this.bodyEl.innerHTML = '<div class="instr-info-placeholder">Unknown instruction</div>';
        return;
      }
      this.renderFull(instr, info);
      return;
    }

    // No assembled instruction on this line (e.g. it has an error): show what we know about the mnemonic
    const lines = this.lastSource.split('\n');
    if (cursorLine >= 1 && cursorLine <= lines.length) {
      const match = lines[cursorLine - 1].trim().match(/^([a-z_][a-z0-9_]*)/i);
      const info = match ? lookupByMnemonic(match[1].toLowerCase().replace(/_(e32|e64|dpp|sdwa)$/, '')) : undefined;
      if (info) {
        this.renderMetaOnly(info);
        return;
      }
    }

    this.bodyEl.innerHTML = PLACEHOLDER;
  }

  setSource(source: string): void {
    this.lastSource = source;
  }

  private renderFull(instr: ParsedInstruction, info: OpcodeInfo): void {
    let words: number[] = [];
    let encodeError = '';
    try {
      words = encodeInstruction(instr);
    } catch (e) {
      encodeError = (e as Error).message;
    }
    const decoded = words.length ? decodeBinary(Uint32Array.from(words))[0] : undefined;
    const layout = decoded ? layoutFor({ info, instr, decoded }, words) : [];

    let opcodeText = `opcode: ${hexVal(info.opcode)}`;
    if (decoded && (decoded.encoding === 'VOP3A' || decoded.encoding === 'VOP3B') && info.format !== InstructionFormat.VOP3) {
      opcodeText += ` (VOP3: ${hexVal((words[0] >>> 16) & 0x3FF, 3)})`;
    }

    let html = this.metaHtml(decoded ? encodingName(decoded, info) : info.format, opcodeText, info);
    html += this.descriptionHtml(info, buildFormula(info, instr));
    if (encodeError) html += `<div class="instr-info-desc" style="color:#f85149">Cannot encode: ${escapeHtml(encodeError)}</div>`;

    layout.forEach((dword, i) => {
      const word = words[i] >>> 0;
      html += `<div class="instr-info-diagram">`;
      html += `<span class="instr-info-diagram-label">${layout.length > 1 ? `DWORD ${i} · ` : ''}${escapeHtml(dword.label)}</span>`;
      html += `<div class="instr-info-bitfield"><div class="instr-info-ruler">`;
      for (const f of dword.fields) {
        const width = f.hi - f.lo + 1;
        html += `<div class="instr-info-ruler-cell" style="flex:${width}"><span>${f.hi}</span>${width > 1 ? `<span>${f.lo}</span>` : ''}</div>`;
      }
      html += `</div><div class="instr-info-fields">`;
      for (const f of dword.fields) {
        const width = f.hi - f.lo + 1;
        const value = width === 32 ? word : (word >>> f.lo) & ((1 << width) - 1);
        const text = f.show(value, words);
        const tip = `${f.name || 'reserved'} [${f.hi}:${f.lo}] = ${hexVal(value, 1)}`;
        html += `<div class="instr-info-bit" style="flex:${width};background:${f.color}15;border-color:${f.color}" title="${escapeHtml(tip)}">`;
        if (f.name && f.name !== text) {
          html += `<span class="instr-info-field-name" style="color:${f.color}80">${escapeHtml(f.name)}</span>`;
        }
        html += `<span class="instr-info-field-value" style="color:${f.color}">${escapeHtml(text)}</span></div>`;
      }
      html += `</div></div></div>`;
    });

    const summary = decoded ? modifierSummary(decoded, info) : '';
    if (summary) {
      const [kind, ...rest] = summary.split(' ');
      html += `<div class="instr-info-dpp"><span class="instr-info-field-name" style="color:#ff9800">${escapeHtml(kind)}</span> `;
      html += `<span>${escapeHtml(rest.join(' '))}</span></div>`;
    }

    if (words.length) {
      const hexStr = words.map(w => (w >>> 0).toString(16).padStart(8, '0')).join(' ');
      html += `<div class="instr-info-hex">Binary: <span>${hexStr}</span></div>`;
    }

    this.bodyEl.innerHTML = html;
  }

  private renderMetaOnly(info: OpcodeInfo): void {
    let html = this.metaHtml(info.format, `opcode: ${hexVal(info.opcode)}`, info);
    html += this.descriptionHtml(info, '');
    html += `<div class="instr-info-formula">${escapeHtml(info.syntax)}</div>`;
    this.bodyEl.innerHTML = html;
  }

  private metaHtml(format: string, opcodeText: string, info: OpcodeInfo): string {
    return `<div class="instr-info-meta">` +
      `<span class="instr-info-format">${escapeHtml(format)}</span>` +
      `<span class="instr-info-sep">|</span>` +
      `<span class="instr-info-opcode">${escapeHtml(opcodeText)}</span>` +
      `<span class="instr-info-sep">|</span>` +
      `<span class="instr-info-mnemonic">${escapeHtml(info.mnemonic)}</span>` +
      `</div>`;
  }

  /** First description line, the formula (with real operands when known), then any further notes. */
  private descriptionHtml(info: OpcodeInfo, formula: string): string {
    const [first, ...rest] = info.description.split('\n');
    const formulaLine = formulaLineOf(info);
    let html = `<div class="instr-info-desc">${escapeHtml(first)}</div>`;
    const shownFormula = formula || formulaLine?.trim();
    if (shownFormula) html += `<div class="instr-info-formula">${escapeHtml(shownFormula)}</div>`;
    for (const note of rest) {
      if (note.trim() && note !== formulaLine) html += `<div class="instr-info-desc">${escapeHtml(note.trim())}</div>`;
    }
    return html;
  }
}
