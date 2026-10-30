// ── Instruction Encyclopedia ──
// Interactive reference manual for RDNA2 instruction formats

import { getAllOpcodes } from '../isa/opcodes';
import { InstructionFormat, OpcodeInfo } from '../isa/types';

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
  /** Instructions listed under this format (default: opcode-table format === name). */
  filter?: (op: OpcodeInfo) => boolean;
}

const RESERVED = '#6e7681';

const FORMATS: FormatSpec[] = [
  {
    name: 'SOPP',
    fullName: 'Scalar Program Control (32-bit)',
    totalBits: 32,
    words: 1,
    fields: [[
      { name: '0x17F', bits: 9, color: '#f85149', description: 'Encoding prefix — 101111111 identifies SOPP' },
      { name: 'OP', bits: 7, color: '#58a6ff', description: 'Opcode — selects the operation (e.g. 0x01 = s_endpgm)' },
      { name: 'SIMM16', bits: 16, color: '#bc8cff', description: '16-bit immediate — a signed branch offset in dwords, or the counters of s_waitcnt' },
    ]],
    description: 'Scalar program control instructions — no register operands. Used for program termination (s_endpgm), branches, waits and other control flow. Branches jump relative to the next instruction.',
    operandRules: [
      'No register operands — the instruction is fully encoded in 32 bits',
      'Branches: target = address of the next instruction + SIMM16 × 4 bytes; the assembler computes SIMM16 from a label',
      's_cbranch_scc0/scc1, vccz/vccnz and execz/execnz test SCC, VCC and EXEC',
      's_endpgm: terminates the shader program. Every program must execute it; running past the last instruction is a crash',
    ],
  },
  {
    name: 'SOP1',
    fullName: 'Scalar ALU — 1 Source (32-bit)',
    totalBits: 32,
    words: 1,
    fields: [[
      { name: '0x17D', bits: 9, color: '#f85149', description: 'Encoding prefix — 101111101 identifies SOP1' },
      { name: 'SDST', bits: 7, color: '#39d353', description: 'Destination SGPR, or a special register (VCC, EXEC, M0)' },
      { name: 'OP', bits: 8, color: '#58a6ff', description: 'Opcode — selects the operation (e.g. 0x03 = s_mov_b32)' },
      { name: 'SSRC0', bits: 8, color: '#bc8cff', description: 'Source — SGPR, special register, inline constant, or 255 for a 32-bit literal' },
    ]],
    description: 'Scalar operations execute once per wavefront (not per lane). Used for control flow, the EXEC mask, and scalar math. 64-bit (_b64) operations use aligned SGPR pairs such as s[2:3].',
    operandRules: [
      'SSRC0 (8-bit): SGPR (0–105), special registers (VCC=106, M0=124, EXEC=126), inline constants, or a literal (255)',
      'SDST (7-bit): SGPR or special register',
      '64-bit operands are even-aligned register pairs: s[0:1], s[2:3], vcc, exec',
    ],
  },
  {
    name: 'SOP2',
    fullName: 'Scalar ALU — 2 Sources (32-bit)',
    totalBits: 32,
    words: 1,
    fields: [[
      { name: '10', bits: 2, color: '#f85149', description: 'Encoding prefix — 10 identifies SOP2' },
      { name: 'OP', bits: 7, color: '#58a6ff', description: 'Opcode — selects the operation (e.g. 0x00 = s_add_u32)' },
      { name: 'SDST', bits: 7, color: '#39d353', description: 'Destination SGPR or special register' },
      { name: 'SSRC1', bits: 8, color: '#d29922', description: 'Second source — SGPR, special register, inline constant, or literal' },
      { name: 'SSRC0', bits: 8, color: '#bc8cff', description: 'First source — SGPR, special register, inline constant, or literal' },
    ]],
    description: 'Two-source scalar math, logic and shifts. Many SOP2 instructions also set SCC (carry, overflow or "result is non-zero").',
    operandRules: [
      'SSRC0/SSRC1 (8-bit): SGPRs, special registers, inline constants; at most one 32-bit literal',
      'SCC is written by most arithmetic and logic operations — check each instruction',
    ],
  },
  {
    name: 'SOPC',
    fullName: 'Scalar Compare (32-bit)',
    totalBits: 32,
    words: 1,
    fields: [[
      { name: '0x17E', bits: 9, color: '#f85149', description: 'Encoding prefix — 101111110 identifies SOPC' },
      { name: 'OP', bits: 7, color: '#58a6ff', description: 'Opcode — selects the comparison' },
      { name: 'SSRC1', bits: 8, color: '#d29922', description: 'Second source' },
      { name: 'SSRC0', bits: 8, color: '#bc8cff', description: 'First source' },
    ]],
    description: 'Scalar comparisons. The result goes to SCC, which s_cbranch_scc0/scc1 and s_cselect can then use.',
    operandRules: [
      'SSRC0/SSRC1 (8-bit): SGPRs, special registers, inline constants, or one literal',
      'Result: SCC = 1 when the comparison is true',
    ],
  },
  {
    name: 'SOPK',
    fullName: 'Scalar with 16-bit Constant (32-bit)',
    totalBits: 32,
    words: 1,
    fields: [[
      { name: '1011', bits: 4, color: '#f85149', description: 'Encoding prefix — 1011 identifies SOPK' },
      { name: 'OP', bits: 5, color: '#58a6ff', description: 'Opcode — selects the operation (e.g. 0x00 = s_movk_i32)' },
      { name: 'SDST', bits: 7, color: '#39d353', description: 'Destination SGPR (for s_cmpk_*: the SGPR being compared)' },
      { name: 'SIMM16', bits: 16, color: '#bc8cff', description: '16-bit immediate, sign- or zero-extended depending on the instruction' },
    ]],
    description: 'Scalar operations with a 16-bit immediate packed into the instruction, avoiding a separate literal dword.',
    operandRules: [
      'SIMM16 is sign-extended for _i32 forms and zero-extended for _u32 forms',
      's_cmpk_* compare SDST with SIMM16 and write SCC',
    ],
  },
  {
    name: 'VOP1',
    fullName: 'Vector ALU — 1 Source (32-bit)',
    totalBits: 32,
    words: 1,
    fields: [[
      { name: '0x3F', bits: 7, color: '#f85149', description: 'Encoding prefix — 0111111 identifies VOP1' },
      { name: 'VDST', bits: 8, color: '#39d353', description: 'Destination VGPR (v_readfirstlane_b32 puts its SGPR destination here)' },
      { name: 'OP', bits: 8, color: '#58a6ff', description: 'Opcode — selects the operation (e.g. 0x01 = v_mov_b32)' },
      { name: 'SRC0', bits: 9, color: '#bc8cff', description: 'Source operand — 9-bit encoding (see the SRC0 Encoding tab)' },
    ]],
    description: 'Single-source vector operations like move, type conversion, reciprocal, and square root. The 7-bit prefix 0x3F distinguishes it from VOP2.',
    operandRules: [
      'SRC0 (9-bit): SGPR, VGPR, inline constant, or literal',
      'VDST (8-bit): VGPR',
      'SRC0 = 250 / 233 / 249 means a DPP16 / DPP8 / SDWA control dword follows',
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
    description: 'The most common ALU format. Two source operands, one destination. SRC0 can be a VGPR, SGPR, or constant; VSRC1 must be a VGPR. If you need modifiers (abs, neg, clamp, omod) or a non-VGPR second source, the assembler promotes the instruction to VOP3.',
    operandRules: [
      'SRC0 (9-bit): SGPR (0–105), inline int (128–208), inline float (240–248), literal (255 + next dword), VGPR (256–511)',
      'VSRC1 (8-bit): VGPR only (0–255)',
      'VDST (8-bit): VGPR only (0–255)',
      'v_cndmask_b32 and the carry ops (v_add_co_ci_u32, …) read and write VCC implicitly in this form',
      'v_fmamk_f32 / v_fmaak_f32 always carry a 32-bit constant K in the following dword',
    ],
  },
  {
    name: 'VOP3',
    fullName: 'Vector ALU — Extended, VOP3A (64-bit)',
    totalBits: 64,
    words: 2,
    fields: [
      [
        { name: '0x35', bits: 6, color: '#f85149', description: 'Encoding prefix — 110101 identifies VOP3' },
        { name: 'OP', bits: 10, color: '#58a6ff', description: 'Opcode — 10-bit; VOPC ops use 0x000–0x0FF, VOP2 ops +0x100, VOP1 ops +0x180, VOP3-only ops 0x140–0x17F and 0x200+' },
        { name: 'CLAMP', bits: 1, color: '#db6d28', description: 'Clamp the result: floats to [0.0, 1.0], integers saturate' },
        { name: 'OP_SEL', bits: 4, color: '#a371f7', description: 'For 16-bit operands: bit 0–2 read the hi half of src0–src2, bit 3 writes the hi half of the destination' },
        { name: 'ABS', bits: 3, color: '#39c5cf', description: 'Absolute value modifier — bit 0: src0, bit 1: src1, bit 2: src2' },
        { name: 'VDST', bits: 8, color: '#39d353', description: 'Destination VGPR (or the SGPR written by compares and v_readlane_b32)' },
      ],
      [
        { name: 'NEG', bits: 3, color: '#f0883e', description: 'Negate modifier — bit 0: src0, bit 1: src1, bit 2: src2' },
        { name: 'OMOD', bits: 2, color: '#db6d28', description: 'Output modifier: 0=none, 1=×2, 2=×4, 3=÷2' },
        { name: 'SRC2', bits: 9, color: '#8b949e', description: 'Third source operand (FMA, MAD, …; unused fields hold 0x80)' },
        { name: 'SRC1', bits: 9, color: '#d29922', description: 'Second source — full 9-bit encoding (not limited to VGPRs)' },
        { name: 'SRC0', bits: 9, color: '#bc8cff', description: 'First source — full 9-bit encoding' },
      ],
    ],
    description: 'The 64-bit extended form. VOP1, VOP2 and VOPC instructions are promoted to VOP3 when they need source modifiers (abs, neg), output modifiers (clamp, mul:/div:), a non-VGPR second source, or an SGPR destination for a compare. All three sources use the full 9-bit encoding. Write an _e64 suffix to force this encoding.',
    operandRules: [
      'All SRC fields are 9-bit: any SGPR, VGPR, inline constant, or literal',
      'At most one literal (it may be used by several sources) and at most two different scalar values (SGPRs, VCC, M0, EXEC or the literal) per instruction',
      'ABS / NEG: one bit per source, applied to floating-point operands before the operation',
      'CLAMP: clamps float results to [0.0, 1.0] and saturates integer results',
      'Opcode mapping: VOPC + 0x000, VOP2 + 0x100, VOP1 + 0x180',
    ],
    filter: op => op.format === InstructionFormat.VOP3 && !op.vop3b,
  },
  {
    name: 'VOP3B',
    fullName: 'Vector ALU — Extended with Scalar Destination (64-bit)',
    totalBits: 64,
    words: 2,
    fields: [
      [
        { name: '0x35', bits: 6, color: '#f85149', description: 'Encoding prefix — 110101 (same as VOP3A)' },
        { name: 'OP', bits: 10, color: '#58a6ff', description: 'Opcode' },
        { name: 'CLAMP', bits: 1, color: '#db6d28', description: 'Clamp / saturate the result' },
        { name: 'SDST', bits: 7, color: '#39d353', description: 'Scalar destination — the carry-out (or v_div_scale flag) lane mask, usually VCC' },
        { name: 'VDST', bits: 8, color: '#39d353', description: 'Destination VGPR' },
      ],
      [
        { name: 'NEG', bits: 3, color: '#f0883e', description: 'Negate modifier — bit 0: src0, bit 1: src1, bit 2: src2' },
        { name: 'OMOD', bits: 2, color: '#db6d28', description: 'Output modifier: 0=none, 1=×2, 2=×4, 3=÷2' },
        { name: 'SRC2', bits: 9, color: '#8b949e', description: 'Third source (the carry-in SGPR of v_add_co_ci_u32 and friends)' },
        { name: 'SRC1', bits: 9, color: '#d29922', description: 'Second source — full 9-bit encoding' },
        { name: 'SRC0', bits: 9, color: '#bc8cff', description: 'First source — full 9-bit encoding' },
      ],
    ],
    description: 'VOP3 variant for instructions with a second, scalar destination: carry-out from v_add_co_u32 / v_sub_co_u32 / v_add_co_ci_u32, v_mad_u64_u32 and v_div_scale. The SDST field replaces ABS and OP_SEL.',
    operandRules: [
      'SDST (7-bit): any SGPR or VCC; holds one carry/flag bit per lane',
      'Carry-in ops promoted from VOP2 read their carry-in from SRC2 instead of VCC',
      'No ABS or OP_SEL fields',
    ],
    filter: op => op.format === InstructionFormat.VOP3 && !!op.vop3b,
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
    description: 'Per-lane comparisons that produce a lane mask: bit N is the result for lane N, and inactive lanes get 0. In this 32-bit form v_cmp_* writes VCC and v_cmpx_* writes EXEC. The VOP3 (_e64) and SDWA forms of v_cmp_* can write any SGPR instead. Use v_cndmask_b32 or s_and_saveexec_b32 to act on the result.',
    operandRules: [
      'Destination: VCC (v_cmp_*) or EXEC (v_cmpx_*) here; any SGPR in the VOP3 or SDWA form',
      'SRC0 (9-bit): SGPR, VGPR, inline constant, or literal',
      'VSRC1 (8-bit): VGPR only — a constant or SGPR second source promotes to VOP3',
      'SDWA is allowed; DPP is not',
    ],
  },
  {
    name: 'VOP3P',
    fullName: 'Vector ALU — Packed 16-bit (64-bit)',
    totalBits: 64,
    words: 2,
    fields: [
      [
        { name: '0x198', bits: 9, color: '#f85149', description: 'Encoding prefix — 110011000 identifies VOP3P (top byte 0xCC)' },
        { name: 'OP', bits: 7, color: '#58a6ff', description: 'Opcode — selects the packed operation (e.g. 0x0F = v_pk_add_f16)' },
        { name: 'CLAMP', bits: 1, color: '#db6d28', description: 'Clamp output' },
        { name: 'OP_SEL_HI[2]', bits: 1, color: '#a371f7', description: 'Hi-half source selection for src2' },
        { name: 'OP_SEL', bits: 3, color: '#a371f7', description: 'Lo result: 1 = read the hi half of src0 / src1 / src2' },
        { name: 'NEG_HI', bits: 3, color: '#f0883e', description: 'Negate the hi-half input: bit0=src0, bit1=src1, bit2=src2 (abs for v_fma_mix)' },
        { name: 'VDST', bits: 8, color: '#39d353', description: 'Destination VGPR index' },
      ],
      [
        { name: 'NEG', bits: 3, color: '#f0883e', description: 'Negate the lo-half input: bit0=src0, bit1=src1, bit2=src2' },
        { name: 'OP_SEL_HI', bits: 2, color: '#a371f7', description: 'Hi result: 1 = read the hi half of src0 / src1' },
        { name: 'SRC2', bits: 9, color: '#8b949e', description: 'Third source operand (for FMA/MAD instructions)' },
        { name: 'SRC1', bits: 9, color: '#d29922', description: 'Second source — full 9-bit encoding' },
        { name: 'SRC0', bits: 9, color: '#bc8cff', description: 'First source — full 9-bit encoding' },
      ],
    ],
    description: 'Packed 16-bit operations — processes the lo and hi halves of each 32-bit register in parallel. Used for f16 math (v_pk_add_f16, v_pk_mul_f16) and u16/i16 integer ops (v_pk_add_u16, v_pk_lshlrev_b16). OP_SEL/OP_SEL_HI choose which half of each source feeds the lo and hi operations.',
    operandRules: [
      'Each 32-bit register holds two packed 16-bit values: lo=[15:0], hi=[31:16]',
      'OP_SEL: selects which half each source reads for the lo operation',
      'OP_SEL_HI: selects which half each source reads for the hi operation (default 1 = hi half)',
      'Constants are not replicated: in f16 instructions 2.0 has 0 in its hi half and integer constants such as 3 are sign-extended, so write op_sel_hi:[1,0] to use a constant src1 in both halves',
      'Integer packed instructions receive a float constant as its f32 bit pattern (1.0 → lo 0x0000, hi 0x3F80)',
      'NEG/NEG_HI: negate lo/hi inputs independently',
      'v_fma_mix_*: OP_SEL_HI marks a source as f16 (OP_SEL picks its half); 0 means f32',
    ],
  },
  {
    name: 'DS',
    fullName: 'Local Data Share (64-bit)',
    totalBits: 64,
    words: 2,
    fields: [
      [
        { name: '0x36', bits: 6, color: '#f85149', description: 'Encoding prefix — 110110 identifies DS' },
        { name: 'OP', bits: 8, color: '#58a6ff', description: 'Opcode — selects the LDS operation' },
        { name: 'GDS', bits: 1, color: '#db6d28', description: '1 = global data share (not supported by the emulator)' },
        { name: '', bits: 1, color: RESERVED, description: 'Reserved' },
        { name: 'OFFSET1', bits: 8, color: '#d29922', description: 'High byte of the 16-bit offset (or the second offset of *2st64 ops)' },
        { name: 'OFFSET0', bits: 8, color: '#d29922', description: 'Low byte of the 16-bit offset (or the first offset of *2st64 ops)' },
      ],
      [
        { name: 'VDST', bits: 8, color: '#39d353', description: 'Destination VGPR for reads' },
        { name: 'DATA1', bits: 8, color: '#8b949e', description: 'Second data VGPR (two-address writes)' },
        { name: 'DATA0', bits: 8, color: '#f0883e', description: 'Data VGPR for writes and permutes' },
        { name: 'ADDR', bits: 8, color: '#bc8cff', description: 'Per-lane byte address VGPR (ds_swizzle_b32: the source data)' },
      ],
    ],
    description: 'Local Data Share instructions read and write fast on-chip memory shared by the work-group, and include lane-permute instructions (ds_swizzle_b32, ds_permute_b32, ds_bpermute_b32) that never touch memory.',
    operandRules: [
      'Address = ADDR (per lane) + OFFSET, in bytes',
      'ds_swizzle_b32 uses OFFSET as a lane pattern (and/or/xor masks, quad permute, rotate, FFT)',
      'ds_permute_b32 pushes data to the lane given by address / 4; ds_bpermute_b32 pulls from it',
    ],
  },
];

const SRC0_ENCODING_TABLE = [
  { range: '0–105', meaning: 'SGPR0–SGPR105', color: '#39d353' },
  { range: '106–107', meaning: 'VCC_LO, VCC_HI', color: '#d29922' },
  { range: '108–123', meaning: 'TTMP0–TTMP15 (trap handler temporaries)', color: '#d29922' },
  { range: '124', meaning: 'M0 register', color: '#d29922' },
  { range: '125', meaning: 'NULL — reads as 0, writes are discarded', color: '#d29922' },
  { range: '126–127', meaning: 'EXEC_LO, EXEC_HI', color: '#d29922' },
  { range: '128–192', meaning: 'Integer constants 0–64', color: '#bc8cff' },
  { range: '193–208', meaning: 'Integer constants −1 to −16', color: '#bc8cff' },
  { range: '233–234', meaning: 'DPP8 (234: DPP8 with fetch-inactive) — control dword follows', color: '#f0883e' },
  { range: '240–248', meaning: 'Float constants: 0.5, −0.5, 1.0, −1.0, 2.0, −2.0, 4.0, −4.0, 1/(2π)', color: '#bc8cff' },
  { range: '249', meaning: 'SDWA — control dword follows', color: '#f0883e' },
  { range: '250', meaning: 'DPP16 — control dword follows', color: '#f0883e' },
  { range: '251–253', meaning: 'VCCZ, EXECZ, SCC (as 0 or 1)', color: '#d29922' },
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

  private renderFormat(spec: FormatSpec, allOpcodes: OpcodeInfo[]): string {
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
    const instrs = allOpcodes.filter(spec.filter ?? (o => o.format.toString() === spec.name)).sort((a, b) => a.opcode - b.opcode);

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
      html += `<p class="ency-note">Any VOP1, VOP2 or VOPC instruction can also be encoded as VOP3 — automatically when it uses modifiers or operands the 32-bit form cannot hold, or explicitly with an _e64 suffix. The VOP3 opcode is the VOPC opcode + 0x000, the VOP2 opcode + 0x100, or the VOP1 opcode + 0x180.</p>`;
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  private renderSrc0Table(): string {
    let html = `<div class="ency-format-section">`;
    html += `<h3 class="ency-format-title">SRC0 Encoding <span class="ency-format-subtitle">— 9-bit Source Operand</span></h3>`;
    html += `<p class="ency-format-desc">The 9-bit SRC0 field can reference VGPRs, SGPRs, special registers, inline constants, or a 32-bit literal that follows the instruction word. This encoding is shared by VOP1, VOP2, VOPC, VOP3 and VOP3P; scalar instructions use the same values below 256 in their 8-bit source fields.</p>`;

    html += `<table class="ency-src0-table"><thead><tr><th>Value</th><th>Meaning</th></tr></thead><tbody>`;
    for (const entry of SRC0_ENCODING_TABLE) {
      html += `<tr><td style="color:${entry.color};font-weight:600">${entry.range}</td><td>${entry.meaning}</td></tr>`;
    }
    html += `</tbody></table>`;

    html += `<div class="ency-rules"><h4>Inline Float Constants</h4>`;
    html += `<table><thead><tr><th>Code</th><th>Value</th></tr></thead><tbody>`;
    const floats = [
      [240, '0.5'], [241, '−0.5'], [242, '1.0'], [243, '−1.0'],
      [244, '2.0'], [245, '−2.0'], [246, '4.0'], [247, '−4.0'], [248, '1/(2π) ≈ 0.159155'],
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
