// ── Instruction Encyclopedia ──
// Interactive reference manual for RDNA2 instruction formats

import { getAllOpcodes } from '../isa/opcodes';
import { InstructionFormat } from '../isa/types';

interface BitField {
  name: string;
  bits: number;
  color: string;
  description: string;
}

interface FormatSpec {
  name: string;
  fullName: string;
  totalBits: number;
  words: number;
  fields: BitField[][];   // one array per dword
  description: string;
  operandRules: string[];
}

const FORMATS: FormatSpec[] = [
  {
    name: 'SOPP',
    fullName: 'Scalar Program Control (32-bit)',
    totalBits: 32,
    words: 1,
    fields: [[
      { name: '0x17F', bits: 9, color: '#f85149', description: 'Encoding prefix — 101111111 identifies SOPP' },
      { name: 'OP', bits: 7, color: '#58a6ff', description: 'Opcode — selects the operation (e.g. 0x01 = s_endpgm)' },
      { name: 'SIMM16', bits: 16, color: '#bc8cff', description: '16-bit signed immediate — used for branch offsets (unused by s_endpgm)' },
    ]],
    description: 'Scalar program control instructions — no register operands. Used for program termination (s_endpgm), branches, barriers, and other control flow. The 16-bit SIMM16 field provides a branch offset for jump instructions.',
    operandRules: [
      'No register operands — instruction is fully encoded in 32 bits',
      'SIMM16: signed 16-bit immediate, used as branch offset in dwords',
      's_endpgm: terminates the shader program (SIMM16 = 0)',
    ],
  },
  {
    name: 'SOP1',
    fullName: 'Scalar ALU — 1 Source (32-bit)',
    totalBits: 32,
    words: 1,
    fields: [[
      { name: '0x17D', bits: 9, color: '#f85149', description: 'Encoding prefix — 101111101 identifies SOP1' },
      { name: 'SDST', bits: 7, color: '#39d353', description: 'Destination SGPR index, or special register (EXEC, VCC)' },
      { name: 'OP', bits: 8, color: '#58a6ff', description: 'Opcode — selects the operation (e.g. 0x03 = s_mov_b32)' },
      { name: 'SSRC0', bits: 8, color: '#bc8cff', description: 'Source — SGPR, special register, or inline constant' },
    ]],
    description: 'Scalar operations execute once per wavefront (not per lane). Used for control flow, setting EXEC mask, and scalar math. SDST can target EXEC or VCC to control which lanes are active.',
    operandRules: [
      'SSRC0 (8-bit): SGPR (0–105), special registers (EXEC=126, VCC=106), inline constants',
      'SDST (7-bit): SGPR or special register (EXEC, VCC, M0)',
      'Scalar instructions are not per-lane — they execute once for the whole wavefront',
    ],
  },
  {
    name: 'VOP1',
    fullName: 'Vector ALU — 1 Source (32-bit)',
    totalBits: 32,
    words: 1,
    fields: [[
      { name: '0x3F', bits: 7, color: '#f85149', description: 'Encoding prefix — 0111111 identifies VOP1' },
      { name: 'VDST', bits: 8, color: '#39d353', description: 'Destination VGPR index (0–255)' },
      { name: 'OP', bits: 8, color: '#58a6ff', description: 'Opcode — selects the operation (e.g. 0x01 = v_mov_b32)' },
      { name: 'SRC0', bits: 9, color: '#bc8cff', description: 'Source operand — same 9-bit encoding as VOP2 SRC0' },
    ]],
    description: 'Single-source vector operations like move, type conversion, reciprocal, and square root. The 7-bit prefix 0x3F distinguishes it from VOP2.',
    operandRules: [
      'SRC0 (9-bit): SGPR, VGPR, inline constant, or literal',
      'VDST (8-bit): VGPR only',
    ],
  },
  {
    name: 'VOP2',
    fullName: 'Vector ALU — 2 Sources (32-bit)',
    totalBits: 32,
    words: 1,
    fields: [[
      { name: '0', bits: 1, color: '#f85149', description: 'Encoding bit — always 0 for VOP2' },
      { name: 'OP', bits: 6, color: '#58a6ff', description: 'Opcode — selects the operation (e.g. 0x03 = v_add_f32)' },
      { name: 'VDST', bits: 8, color: '#39d353', description: 'Destination VGPR index (0–255)' },
      { name: 'VSRC1', bits: 8, color: '#d29922', description: 'Second source — must be a VGPR (0–255)' },
      { name: 'SRC0', bits: 9, color: '#bc8cff', description: 'First source — 9-bit encoded: VGPR (256+), SGPR (0–105), inline constant, or literal' },
    ]],
    description: 'The most common ALU format. Two source operands, one destination. SRC0 can be a VGPR, SGPR, or inline constant. VSRC1 must always be a VGPR. If you need source modifiers (abs/neg), the assembler automatically promotes to VOP3.',
    operandRules: [
      'SRC0 (9-bit): SGPR (0–105), VGPR (256–511), inline int (128–192), inline float (240–247), literal (255 + next dword)',
      'VSRC1 (8-bit): VGPR only (0–255)',
      'VDST (8-bit): VGPR only (0–255)',
    ],
  },
  {
    name: 'VOP3',
    fullName: 'Vector ALU — Extended (64-bit)',
    totalBits: 64,
    words: 2,
    fields: [
      [
        { name: '0x34', bits: 6, color: '#f85149', description: 'Encoding prefix — 110100 identifies VOP3' },
        { name: 'OP', bits: 10, color: '#58a6ff', description: 'Opcode — 10-bit, maps back to VOP1/VOP2 base opcode' },
        { name: '', bits: 1, color: '#21262d', description: 'Reserved' },
        { name: 'CLAMP', bits: 1, color: '#db6d28', description: 'Clamp output to [0.0, 1.0]' },
        { name: '', bits: 1, color: '#21262d', description: 'Reserved' },
        { name: 'ABS', bits: 3, color: '#39c5cf', description: 'Absolute value modifier — bit 0: src0, bit 1: src1, bit 2: src2' },
        { name: 'VDST', bits: 8, color: '#39d353', description: 'Destination VGPR index' },
      ],
      [
        { name: 'NEG', bits: 3, color: '#f0883e', description: 'Negate modifier — bit 0: src0, bit 1: src1, bit 2: src2' },
        { name: 'OMOD', bits: 2, color: '#db6d28', description: 'Output modifier: 0=none, 1=×2, 2=×4, 3=÷2' },
        { name: 'SRC2', bits: 9, color: '#8b949e', description: 'Third source operand (used by 3-operand instructions like FMA)' },
        { name: 'SRC1', bits: 9, color: '#d29922', description: 'Second source — full 9-bit encoding (not limited to VGPR)' },
        { name: 'SRC0', bits: 9, color: '#bc8cff', description: 'First source — 9-bit encoded' },
      ],
    ],
    description: 'The 64-bit extended form. Any VOP1/VOP2 instruction can be promoted to VOP3 when source modifiers (abs, neg) are needed. All three source operands use the full 9-bit encoding, so SRC1 is no longer limited to VGPRs. VOP3 also adds CLAMP and OMOD output modifiers.',
    operandRules: [
      'All SRC fields are 9-bit: any SGPR, VGPR, inline constant, or literal',
      'ABS: 3 bits, one per source — clears the sign bit before the operation',
      'NEG: 3 bits, one per source — flips the sign bit before the operation',
      'CLAMP: clamps the output to [0.0, 1.0] for float operations',
      'Instructions auto-promote from VOP1/VOP2 when you use abs() or neg()',
    ],
  },
  {
    name: 'VOPC',
    fullName: 'Vector Compare (32-bit)',
    totalBits: 32,
    words: 1,
    fields: [[
      { name: '0x3E', bits: 7, color: '#f85149', description: 'Encoding prefix — 0111110 identifies VOPC' },
      { name: 'OP', bits: 8, color: '#58a6ff', description: 'Opcode — selects comparison type (lt, eq, le, gt, etc.)' },
      { name: 'VSRC1', bits: 8, color: '#d29922', description: 'Second comparison source — must be VGPR' },
      { name: 'SRC0', bits: 9, color: '#bc8cff', description: 'First comparison source — 9-bit encoded' },
    ]],
    description: 'Comparison instructions that set VCC (Vector Condition Code) per lane. No explicit destination — the result is always written to VCC. Each active lane gets a 1 or 0 in its VCC bit based on the comparison. Use v_cndmask_b32 to act on the result.',
    operandRules: [
      'No destination register — result always goes to VCC',
      'SRC0 (9-bit): SGPR, VGPR, inline constant, or literal',
      'VSRC1 (8-bit): VGPR only',
      'VCC is a 32-bit mask: bit N = comparison result for lane N',
    ],
  },
  {
    name: 'VOP3P',
    fullName: 'Vector ALU — Packed 16-bit (64-bit)',
    totalBits: 64,
    words: 2,
    fields: [
      [
        { name: '0x33', bits: 6, color: '#f85149', description: 'Encoding prefix — 110011 identifies VOP3P' },
        { name: 'OP', bits: 10, color: '#58a6ff', description: 'Opcode — selects the packed operation (e.g. 0x00F = v_pk_add_f16)' },
        { name: 'CLAMP', bits: 1, color: '#db6d28', description: 'Clamp output' },
        { name: 'OP_SEL_HI', bits: 4, color: '#39c5cf', description: 'Hi-half source selection: bit0=src0, bit1=src1, bit2=src2, bit3=dst' },
        { name: 'NEG_HI', bits: 3, color: '#f0883e', description: 'Negate hi-half: bit0=src0, bit1=src1, bit2=src2' },
        { name: 'VDST', bits: 8, color: '#39d353', description: 'Destination VGPR index' },
      ],
      [
        { name: 'NEG', bits: 3, color: '#f0883e', description: 'Negate lo-half: bit0=src0, bit1=src1, bit2=src2' },
        { name: 'OP_SEL', bits: 2, color: '#39c5cf', description: 'Lo-half source selection: bit0=src0, bit1=src1' },
        { name: 'SRC2', bits: 9, color: '#8b949e', description: 'Third source operand (for FMA/MAD instructions)' },
        { name: 'SRC1', bits: 9, color: '#d29922', description: 'Second source — full 9-bit encoding' },
        { name: 'SRC0', bits: 9, color: '#bc8cff', description: 'First source — full 9-bit encoding' },
      ],
    ],
    description: 'Packed 16-bit operations — processes two 16-bit values (lo and hi halves) of each 32-bit register in parallel. Used for f16 math (v_pk_add_f16, v_pk_mul_f16) and u16/i16 integer ops (v_pk_add_u16, v_pk_lshlrev_b16). OP_SEL/OP_SEL_HI control which half of each source to use for the lo/hi operations.',
    operandRules: [
      'Each 32-bit register holds two packed 16-bit values: lo=[15:0], hi=[31:16]',
      'OP_SEL: selects which half each source reads for the lo operation',
      'OP_SEL_HI: selects which half each source reads for the hi operation',
      'NEG/NEG_HI: negate lo/hi halves independently',
      'Default: lo reads from lo, hi reads from hi (OP_SEL=0, OP_SEL_HI=0x7)',
    ],
  },
];

const SRC0_ENCODING_TABLE = [
  { range: '0–105', meaning: 'SGPR0–SGPR105', color: '#39d353' },
  { range: '106–107', meaning: 'VCC_LO, VCC_HI', color: '#d29922' },
  { range: '124', meaning: 'M0 register', color: '#d29922' },
  { range: '126–127', meaning: 'EXEC_LO, EXEC_HI', color: '#d29922' },
  { range: '128', meaning: 'Integer literal 0', color: '#bc8cff' },
  { range: '129–192', meaning: 'Integer literals 1–64', color: '#bc8cff' },
  { range: '193–208', meaning: 'Integer literals −1 to −16', color: '#bc8cff' },
  { range: '240–247', meaning: 'Float constants: 0.5, −0.5, 1.0, −1.0, 2.0, −2.0, 4.0, −4.0', color: '#bc8cff' },
  { range: '255', meaning: '32-bit literal follows in next dword', color: '#f0883e' },
  { range: '256–511', meaning: 'VGPR0–VGPR255', color: '#58a6ff' },
];

export class Encyclopedia {
  private overlay: HTMLElement;
  private content: HTMLElement;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'puzzle-overlay puzzle-overlay--hidden';
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    this.content = document.createElement('div');
    this.content.className = 'ency-modal';
    this.overlay.appendChild(this.content);
    container.appendChild(this.overlay);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.overlay.classList.contains('puzzle-overlay--hidden')) {
        this.hide();
      }
    });
  }

  show(): void {
    this.overlay.classList.remove('puzzle-overlay--hidden');
    this.render();
  }

  hide(): void {
    this.overlay.classList.add('puzzle-overlay--hidden');
  }

  private render(): void {
    const allOpcodes = getAllOpcodes();

    let html = `
      <div class="ency-header">
        <h2>📖 Instruction Encyclopedia</h2>
        <span class="ency-subtitle">AMD RDNA2 (GFX10.3) Shader ISA Reference</span>
        <button class="controls-bar__btn ency-close" id="ency-close">✕</button>
      </div>
      <div class="ency-body">
    `;

    // Tab navigation
    html += `<div class="ency-tabs">`;
    for (let i = 0; i < FORMATS.length; i++) {
      const f = FORMATS[i];
      const active = i === 0 ? ' ency-tab--active' : '';
      html += `<button class="ency-tab${active}" data-tab="${i}">${f.name}</button>`;
    }
    html += `<button class="ency-tab" data-tab="src0">SRC0 Encoding</button>`;
    html += `</div>`;

    // Tab content
    for (let i = 0; i < FORMATS.length; i++) {
      const f = FORMATS[i];
      const hidden = i === 0 ? '' : ' style="display:none"';
      html += `<div class="ency-tab-content" data-content="${i}"${hidden}>`;
      html += this.renderFormat(f, allOpcodes);
      html += `</div>`;
    }

    // SRC0 encoding tab
    html += `<div class="ency-tab-content" data-content="src0" style="display:none">`;
    html += this.renderSrc0Table();
    html += `</div>`;

    html += `</div>`;
    this.content.innerHTML = html;

    // Wire up tabs
    this.content.querySelectorAll('.ency-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.content.querySelectorAll('.ency-tab').forEach(t => t.classList.remove('ency-tab--active'));
        tab.classList.add('ency-tab--active');
        this.content.querySelectorAll('.ency-tab-content').forEach(c => {
          (c as HTMLElement).style.display = 'none';
        });
        const target = (tab as HTMLElement).dataset.tab!;
        const contentEl = this.content.querySelector(`[data-content="${target}"]`) as HTMLElement;
        if (contentEl) contentEl.style.display = '';
      });
    });

    // Wire up bit field hover
    this.content.querySelectorAll('.ency-bit').forEach(bit => {
      bit.addEventListener('mouseenter', () => {
        const desc = (bit as HTMLElement).dataset.desc;
        const descEl = bit.closest('.ency-format-section')?.querySelector('.ency-field-desc') as HTMLElement;
        if (descEl && desc) descEl.textContent = desc;
      });
    });

    this.content.querySelector('#ency-close')?.addEventListener('click', () => this.hide());
  }

  private renderFormat(spec: FormatSpec, allOpcodes: { mnemonic: string; format: InstructionFormat; opcode: number; description: string; syntax: string }[]): string {
    let html = `<div class="ency-format-section">`;

    // Title
    html += `<h3 class="ency-format-title">${spec.name} <span class="ency-format-subtitle">— ${spec.fullName}</span></h3>`;
    html += `<p class="ency-format-desc">${spec.description}</p>`;

    // Bit diagram(s)
    for (let w = 0; w < spec.fields.length; w++) {
      const fields = spec.fields[w];
      const label = spec.words > 1 ? `DWORD ${w}` : '';
      html += `<div class="ency-diagram">`;
      if (label) html += `<span class="ency-diagram-label">${label}</span>`;
      html += `<div class="ency-bitfield">`;

      // Bit number ruler
      let bitPos = spec.words > 1 ? 31 : spec.totalBits - 1;
      html += `<div class="ency-ruler">`;
      for (const field of fields) {
        html += `<div class="ency-ruler-cell" style="flex:${field.bits}">`;
        html += `<span>${bitPos}</span>`;
        const endBit = bitPos - field.bits + 1;
        if (field.bits > 1) html += `<span>${endBit}</span>`;
        html += `</div>`;
        bitPos = bitPos - field.bits;
      }
      html += `</div>`;

      // Field boxes
      html += `<div class="ency-fields">`;
      for (const field of fields) {
        const subscript = field.bits > 0 ? `<sub>${field.bits}</sub>` : '';
        html += `<div class="ency-bit" style="flex:${field.bits};background:${field.color}20;border-color:${field.color}" data-desc="${this.escapeAttr(field.description)}">`;
        html += `<span class="ency-bit-name" style="color:${field.color}">${field.name}${subscript}</span>`;
        html += `</div>`;
      }
      html += `</div>`;

      html += `</div></div>`;
    }

    // Hover description area
    html += `<div class="ency-field-desc">Hover over a field to see its description</div>`;

    // Operand rules
    html += `<div class="ency-rules"><h4>Operand Encoding Rules</h4><ul>`;
    for (const rule of spec.operandRules) {
      html += `<li>${rule}</li>`;
    }
    html += `</ul></div>`;

    // Instruction table
    const instrs = allOpcodes.filter(o => {
      if (spec.name === 'VOP3') return o.format.toString() === 'VOP3';
      return o.format.toString() === spec.name;
    }).sort((a, b) => a.opcode - b.opcode);

    if (instrs.length > 0) {
      html += `<div class="ency-instr-table"><h4>Available Instructions</h4>`;
      html += `<table><thead><tr><th>Mnemonic</th><th>Opcode</th><th>Syntax</th><th>Description</th></tr></thead><tbody>`;
      for (const instr of instrs) {
        const desc = instr.description.split('\n')[0];
        html += `<tr>`;
        html += `<td class="ency-mnemonic">${instr.mnemonic}</td>`;
        html += `<td class="ency-opcode">0x${instr.opcode.toString(16).padStart(2, '0')}</td>`;
        html += `<td class="ency-syntax">${instr.syntax}</td>`;
        html += `<td>${desc}</td>`;
        html += `</tr>`;
      }
      html += `</tbody></table></div>`;
    }

    if (spec.name === 'VOP3') {
      html += `<div class="ency-instr-table"><h4>Promotable Instructions</h4>`;
      html += `<p class="ency-note">Any VOP1 or VOP2 instruction can be promoted to VOP3 by using abs() or neg() modifiers. The VOP3 opcode is: VOP2 base opcode (unchanged), or VOP1 base opcode + 0x100.</p>`;
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  private renderSrc0Table(): string {
    let html = `<div class="ency-format-section">`;
    html += `<h3 class="ency-format-title">SRC0 Encoding <span class="ency-format-subtitle">— 9-bit Source Operand</span></h3>`;
    html += `<p class="ency-format-desc">The 9-bit SRC0 field can reference VGPRs, SGPRs, special registers, inline constants, or a 32-bit literal that follows the instruction word. This encoding is shared by VOP1, VOP2, VOP3, and VOPC formats.</p>`;

    html += `<table class="ency-src0-table"><thead><tr><th>Value</th><th>Meaning</th></tr></thead><tbody>`;
    for (const entry of SRC0_ENCODING_TABLE) {
      html += `<tr><td style="color:${entry.color};font-weight:600">${entry.range}</td><td>${entry.meaning}</td></tr>`;
    }
    html += `</tbody></table>`;

    html += `<div class="ency-rules"><h4>Inline Float Constants</h4>`;
    html += `<table><thead><tr><th>Code</th><th>Value</th></tr></thead><tbody>`;
    const floats = [
      [240, '0.5'], [241, '−0.5'], [242, '1.0'], [243, '−1.0'],
      [244, '2.0'], [245, '−2.0'], [246, '4.0'], [247, '−4.0'],
    ];
    for (const [code, val] of floats) {
      html += `<tr><td>${code}</td><td>${val}</td></tr>`;
    }
    html += `</tbody></table></div>`;

    html += `</div>`;
    return html;
  }

  private escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}
