// ── Instruction Info Panel ──
// Shows detailed info about the instruction under the cursor:
// filled-in bit-field diagram, math formula, and opcode metadata.

import { AssemblyResult, ParsedInstruction, InstructionFormat, OperandType, OpcodeInfo } from '../isa/types';
import { lookupByMnemonic } from '../isa/opcodes';
import { encodeInstruction } from '../isa/encoding';

// ── Format definitions matching encyclopedia.ts (field name, bit width, color) ──

interface BitFieldDef {
  name: string;
  bits: number;
  color: string;
  /** Function to extract the display value from encoded words + instruction */
  extract: (words: number[], instr: ParsedInstruction, info: OpcodeInfo) => string;
}

type FormatLayout = BitFieldDef[][];

// ── Field extractors ──

function hexVal(v: number, pad = 2): string {
  return '0x' + (v >>> 0).toString(16).padStart(pad, '0').toUpperCase();
}

function formatOperandShort(op: { type: OperandType; value: number; encoded: number }): string {
  switch (op.type) {
    case OperandType.VGPR: return `v${op.value}`;
    case OperandType.SGPR: return `s${op.value}`;
    case OperandType.INLINE_INT: return `${op.value}`;
    case OperandType.INLINE_FLOAT: return `${op.value}`;
    case OperandType.LITERAL: return Number.isInteger(op.value) ? `${op.value}` : `${op.value}`;
    case OperandType.SPECIAL: {
      const names: Record<number, string> = { 106: 'vcc', 107: 'vcc_hi', 124: 'm0', 125: 'null', 126: 'exec', 127: 'exec_hi' };
      return names[op.encoded] ?? `spr${op.encoded}`;
    }
    default: return `${op.value}`;
  }
}

function src0EncodedStr(op: { type: OperandType; value: number; encoded: number }): string {
  const name = formatOperandShort(op);
  const enc = op.encoded;
  // Show encoded value in parentheses when it's not obvious
  if (op.type === OperandType.VGPR) return `${name} (${hexVal(enc, 3)})`;
  if (op.type === OperandType.SGPR) return name;
  if (op.type === OperandType.LITERAL) return `${name} (lit)`;
  return name;
}

// ── VOP2 layout ──
const VOP2_FIELDS: BitFieldDef[][] = [[
  { name: '0', bits: 1, color: '#f85149',
    extract: () => '0' },
  { name: 'OP', bits: 6, color: '#58a6ff',
    extract: (_w, _i, info) => hexVal(info.opcode) },
  { name: 'VDST', bits: 8, color: '#39d353',
    extract: (_w, instr) => `v${instr.dst.value}` },
  { name: 'VSRC1', bits: 8, color: '#d29922',
    extract: (_w, instr) => instr.src1 ? formatOperandShort(instr.src1) : '—' },
  { name: 'SRC0', bits: 9, color: '#bc8cff',
    extract: (_w, instr) => src0EncodedStr(instr.src0) },
]];

// ── VOP1 layout ──
const VOP1_FIELDS: BitFieldDef[][] = [[
  { name: '0x3F', bits: 7, color: '#f85149', extract: () => '0x3F' },
  { name: 'VDST', bits: 8, color: '#39d353',
    extract: (_w, instr) => `v${instr.dst.value}` },
  { name: 'OP', bits: 8, color: '#58a6ff',
    extract: (_w, _i, info) => hexVal(info.opcode) },
  { name: 'SRC0', bits: 9, color: '#bc8cff',
    extract: (_w, instr) => src0EncodedStr(instr.src0) },
]];

// ── VOPC layout ──
const VOPC_FIELDS: BitFieldDef[][] = [[
  { name: '0x3E', bits: 7, color: '#f85149', extract: () => '0x3E' },
  { name: 'OP', bits: 8, color: '#58a6ff',
    extract: (_w, _i, info) => hexVal(info.opcode) },
  { name: 'VSRC1', bits: 8, color: '#d29922',
    extract: (_w, instr) => formatOperandShort(instr.src0) },
  { name: 'SRC0', bits: 9, color: '#bc8cff',
    extract: (_w, instr) => src0EncodedStr(instr.dst) },
]];

// ── SOP1 layout ──
const SOP1_FIELDS: BitFieldDef[][] = [[
  { name: '0x17D', bits: 9, color: '#f85149', extract: () => '0x17D' },
  { name: 'SDST', bits: 7, color: '#39d353',
    extract: (_w, instr) => formatOperandShort(instr.dst) },
  { name: 'OP', bits: 8, color: '#58a6ff',
    extract: (_w, _i, info) => hexVal(info.opcode) },
  { name: 'SSRC0', bits: 8, color: '#bc8cff',
    extract: (_w, instr) => formatOperandShort(instr.src0) },
]];

// ── SOPP layout ──
const SOPP_FIELDS: BitFieldDef[][] = [[
  { name: '0x17F', bits: 9, color: '#f85149', extract: () => '0x17F' },
  { name: 'OP', bits: 7, color: '#58a6ff',
    extract: (_w, _i, info) => hexVal(info.opcode) },
  { name: 'SIMM16', bits: 16, color: '#bc8cff', extract: () => '0x0000' },
]];

// ── VOP3 layout (2 dwords) ──
const VOP3_FIELDS: BitFieldDef[][] = [
  [
    { name: '0x34', bits: 6, color: '#f85149', extract: () => '0x34' },
    { name: 'OP', bits: 10, color: '#58a6ff',
      extract: (words) => hexVal((words[0] >>> 16) & 0x3FF, 3) },
    { name: '', bits: 1, color: '#21262d', extract: () => '—' },
    { name: 'CLAMP', bits: 1, color: '#db6d28',
      extract: (_w, instr) => instr.clamp ? '1' : '0' },
    { name: '', bits: 1, color: '#21262d', extract: () => '—' },
    { name: 'ABS', bits: 3, color: '#39c5cf',
      extract: (_w, instr) => {
        let v = 0;
        if (instr.src0.abs) v |= 1;
        if (instr.src1?.abs) v |= 2;
        if (instr.src2?.abs) v |= 4;
        return v.toString(2).padStart(3, '0');
      } },
    { name: 'VDST', bits: 8, color: '#39d353',
      extract: (_w, instr) => `v${instr.dst.value}` },
  ],
  [
    { name: 'NEG', bits: 3, color: '#f0883e',
      extract: (_w, instr) => {
        let v = 0;
        if (instr.src0.neg) v |= 1;
        if (instr.src1?.neg) v |= 2;
        if (instr.src2?.neg) v |= 4;
        return v.toString(2).padStart(3, '0');
      } },
    { name: 'OMOD', bits: 2, color: '#db6d28',
      extract: (_w, instr) => String(instr.omod ?? 0) },
    { name: 'SRC2', bits: 9, color: '#8b949e',
      extract: (_w, instr) => instr.src2 ? src0EncodedStr(instr.src2) : '—' },
    { name: 'SRC1', bits: 9, color: '#d29922',
      extract: (_w, instr) => instr.src1 ? src0EncodedStr(instr.src1) : '—' },
    { name: 'SRC0', bits: 9, color: '#bc8cff',
      extract: (_w, instr) => src0EncodedStr(instr.src0) },
  ],
];

function getLayout(format: InstructionFormat, instr: ParsedInstruction): FormatLayout {
  // Check for VOP3 promotion: if a VOP1/VOP2 instruction has modifiers, it encodes as VOP3
  if (format === InstructionFormat.VOP3) return VOP3_FIELDS;
  if ((format === InstructionFormat.VOP1 || format === InstructionFormat.VOP2) && needsVOP3(instr)) {
    return VOP3_FIELDS;
  }
  switch (format) {
    case InstructionFormat.VOP2: return VOP2_FIELDS;
    case InstructionFormat.VOP1: return VOP1_FIELDS;
    case InstructionFormat.VOPC: return VOPC_FIELDS;
    case InstructionFormat.SOP1: return SOP1_FIELDS;
    case InstructionFormat.SOPP: return SOPP_FIELDS;
    default: return VOP2_FIELDS;
  }
}

function needsVOP3(instr: ParsedInstruction): boolean {
  const hasMods = !!(instr.src0.abs || instr.src0.neg || instr.src1?.abs || instr.src1?.neg || instr.omod || instr.clamp);
  const src1NeedsPromotion = instr.src1 && instr.src1.type !== OperandType.VGPR;
  return hasMods || !!src1NeedsPromotion;
}

function getEffectiveFormatName(format: InstructionFormat, instr: ParsedInstruction): string {
  if (format === InstructionFormat.VOP3) return 'VOP3';
  if ((format === InstructionFormat.VOP1 || format === InstructionFormat.VOP2) && needsVOP3(instr)) {
    return `VOP3 (promoted from ${format})`;
  }
  return format;
}

// ── Operand substitution for the math formula ──

function buildFormula(info: OpcodeInfo, instr: ParsedInstruction): string {
  const lines = info.description.split('\n');
  // Find a formula line (typically the second line, starts with "vdst = ..." or "VCC[lane]" etc.)
  const formulaLine = lines.find(l => {
    const t = l.trim().toLowerCase();
    return t.startsWith('vdst') || t.startsWith('vcc') || t.startsWith('sdst');
  });
  if (!formulaLine) return '';

  let formula = formulaLine.trim();

  // Substitute generic operand names with actual register names
  const dst = formatOperandShort(instr.dst);
  let src0 = formatOperandShort(instr.src0);
  let src1 = instr.src1 ? formatOperandShort(instr.src1) : '';
  let src2 = instr.src2 ? formatOperandShort(instr.src2) : '';

  // Apply modifiers for display
  if (instr.src0.abs) src0 = `|${src0}|`;
  if (instr.src0.neg) src0 = `-${src0}`;
  if (instr.src1?.abs) src1 = `|${src1}|`;
  if (instr.src1?.neg) src1 = `-${src1}`;
  if (instr.src2?.abs) src2 = `|${src2}|`;
  if (instr.src2?.neg) src2 = `-${src2}`;

  // VOPC: dst/src0 are the two compare operands in the parser
  if (info.format === InstructionFormat.VOPC) {
    formula = formula.replace(/\bsrc0\b/gi, formatOperandShort(instr.dst));
    formula = formula.replace(/\bvsrc1\b/gi, formatOperandShort(instr.src0));
    formula = formula.replace(/\bsrc1\b/gi, formatOperandShort(instr.src0));
  } else {
    formula = formula.replace(/\bvdst\b/gi, dst);
    formula = formula.replace(/\bsdst\b/gi, dst);
    formula = formula.replace(/\bvsrc1\b/gi, src1);
    formula = formula.replace(/\bsrc2\b/gi, src2);
    formula = formula.replace(/\bsrc1\b/gi, src1);
    formula = formula.replace(/\bsrc0\b/gi, src0);
  }

  // Apply output modifiers
  if (instr.omod === 1) formula += ' × 2';
  if (instr.omod === 2) formula += ' × 4';
  if (instr.omod === 3) formula += ' ÷ 2';
  if (instr.clamp) formula = `clamp(${formula})`;

  return formula;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Main class ──

export class InstructionInfo {
  private container: HTMLElement;
  private scrollable: HTMLElement;
  private bodyEl: HTMLElement;
  private toggleBtn: HTMLButtonElement;
  private collapsed = false;

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
    this.bodyEl.innerHTML = '<div class="instr-info-placeholder">Move cursor to an instruction to see details</div>';

    this.scrollable = document.createElement('div');
    this.scrollable.className = 'panel__content';
    this.scrollable.style.padding = '0';
    this.scrollable.appendChild(this.bodyEl);

    this.container.append(header, this.scrollable);
  }

  private toggle(): void {
    this.collapsed = !this.collapsed;
    this.scrollable.style.display = this.collapsed ? 'none' : '';
    this.toggleBtn.textContent = this.collapsed ? '▶' : '▼';
    this.toggleBtn.title = this.collapsed ? 'Expand instruction info' : 'Collapse instruction info';
  }

  update(assemblyResult: AssemblyResult | null, cursorLine: number): void {
    if (!assemblyResult || assemblyResult.instructions.length === 0) {
      this.bodyEl.innerHTML = '<div class="instr-info-placeholder">Move cursor to an instruction to see details</div>';
      return;
    }

    // Find instruction on this line
    const instr = assemblyResult.instructions.find(i => i.line === cursorLine);
    if (!instr) {
      this.bodyEl.innerHTML = '<div class="instr-info-placeholder">Move cursor to an instruction to see details</div>';
      return;
    }

    const info = lookupByMnemonic(instr.mnemonic);
    if (!info) {
      this.bodyEl.innerHTML = '<div class="instr-info-placeholder">Unknown instruction</div>';
      return;
    }

    // Encode to get actual binary words
    let words: number[];
    try {
      words = encodeInstruction(instr);
    } catch {
      words = [0];
    }

    const effectiveFormat = getEffectiveFormatName(info.format, instr);
    const layout = getLayout(info.format, instr);
    const formula = buildFormula(info, instr);
    const descFirstLine = info.description.split('\n')[0];

    let html = '';

    // ── Meta line ──
    html += `<div class="instr-info-meta">`;
    html += `<span class="instr-info-format">${escapeHtml(effectiveFormat)}</span>`;
    html += `<span class="instr-info-sep">|</span>`;
    html += `<span class="instr-info-opcode">opcode: ${hexVal(info.opcode)}</span>`;
    html += `<span class="instr-info-sep">|</span>`;
    html += `<span class="instr-info-mnemonic">${escapeHtml(info.mnemonic)}</span>`;
    html += `</div>`;

    // ── Description ──
    html += `<div class="instr-info-desc">${escapeHtml(descFirstLine)}</div>`;

    // ── Formula ──
    if (formula) {
      html += `<div class="instr-info-formula">${escapeHtml(formula)}</div>`;
    }

    // ── Bit field diagram ──
    for (let w = 0; w < layout.length; w++) {
      const fields = layout[w];
      const label = layout.length > 1 ? `DWORD ${w}` : '';
      html += `<div class="instr-info-diagram">`;
      if (label) html += `<span class="instr-info-diagram-label">${label}</span>`;
      html += `<div class="instr-info-bitfield">`;

      // Bit ruler
      let bitPos = 31;
      html += `<div class="instr-info-ruler">`;
      for (const field of fields) {
        html += `<div class="instr-info-ruler-cell" style="flex:${field.bits}">`;
        html += `<span>${bitPos}</span>`;
        const endBit = bitPos - field.bits + 1;
        if (field.bits > 1) html += `<span>${endBit}</span>`;
        html += `</div>`;
        bitPos -= field.bits;
      }
      html += `</div>`;

      // Field boxes with values
      html += `<div class="instr-info-fields">`;
      for (const field of fields) {
        const value = field.extract(words, instr, info);
        html += `<div class="instr-info-bit" style="flex:${field.bits};background:${field.color}15;border-color:${field.color}">`;
        html += `<span class="instr-info-field-name" style="color:${field.color}80">${field.name || '—'}</span>`;
        html += `<span class="instr-info-field-value" style="color:${field.color}">${escapeHtml(value)}</span>`;
        html += `</div>`;
      }
      html += `</div>`;

      html += `</div></div>`;
    }

    // ── Raw hex ──
    const hexStr = words.map(w => (w >>> 0).toString(16).padStart(8, '0')).join(' ');
    html += `<div class="instr-info-hex">Binary: <span>${hexStr}</span></div>`;

    this.bodyEl.innerHTML = html;
  }
}
