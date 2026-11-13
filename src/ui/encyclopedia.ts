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
    description: 'The 64-bit extended form. VOP1, VOP2 and VOPC instructions are promoted to VOP3 when they need source modifiers (abs, neg), output modifiers (clamp, mul:/div:), a non-VGPR second source, or an SGPR destination for a compare. All three sources use the full 9-bit encoding.',
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
    description: 'Per-lane comparisons that produce a lane mask: bit N is the result for lane N, and inactive lanes get 0. In this 32-bit form v_cmp_* writes VCC and v_cmpx_* writes EXEC. The VOP3 and SDWA forms of v_cmp_* can write any SGPR instead. Use v_cndmask_b32 or s_and_saveexec_b32 to act on the result.',
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
        { name: 'NEG_HI', bits: 3, color: '#f0883e', description: 'Negate the hi-half input: bit0=src0, bit1=src1, bit2=src2 (abs for v_fma_mix* and for the f32 src2 of v_dot2_f32_f16)' },
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
    description: 'Packed 16-bit operations — processes the lo and hi halves of each 32-bit register in parallel. Used for f16 math (v_pk_add_f16, v_pk_mul_f16), u16/i16 integer ops (v_pk_add_u16, v_pk_lshlrev_b16), mixed-precision FMA (v_fma_mix*) and dot products (v_dot2/v_dot4/v_dot8). OP_SEL/OP_SEL_HI choose which half of each source feeds the lo and hi operations.',
    operandRules: [
      'Each 32-bit register holds two packed 16-bit values: lo=[15:0], hi=[31:16]',
      'OP_SEL: selects which half each source reads for the lo operation',
      'OP_SEL_HI: selects which half each source reads for the hi operation (default 1 = hi half)',
      'Constants are not replicated: in f16 instructions 2.0 has 0 in its hi half and integer constants such as 3 are sign-extended, so write op_sel_hi:[1,0] to use a constant src1 in both halves',
      'Integer packed instructions receive a float constant as its f32 bit pattern (1.0 → lo 0x0000, hi 0x3F80)',
      'NEG/NEG_HI: negate lo/hi inputs independently',
      'v_fma_mix_*: OP_SEL_HI marks a source as f16 (OP_SEL picks its half); 0 means f32',
      'v_fma_mixlo_f16 / v_fma_mixhi_f16 round the result to f16 and write the lo / hi half of vdst, keeping the other half',
      'v_dot*: multiply the packed elements of src0 and src1 pairwise and add the products to the 32-bit src2. In v_dot2, OP_SEL picks the halves for the first product and OP_SEL_HI for the second; v_dot4 and v_dot8 read whole dwords and take no OP_SEL or NEG',
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
    description: 'Local Data Share instructions read and write fast on-chip memory shared by the work-group, and include lane-permute instructions (ds_swizzle_b32, ds_permute_b32, ds_bpermute_b32) that never touch memory. Their results arrive some cycles later: wait with s_waitcnt lgkmcnt(0) before using a destination VGPR.',
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

/** The encodings that have modifiers: the columns of the Modifiers tab's table. */
const MODIFIER_ENCODINGS = ['VOP3A', 'VOP3B', 'VOP3P', 'DPP16', 'DPP8', 'SDWA'] as const;
type ModifierEncoding = typeof MODIFIER_ENCODINGS[number];

interface ModifierRow {
  name: string;
  /** HTML: how it's written. */
  syntax: string;
  /** Where it's available: ✓, or which sources or instructions take it there. Absent: not available. */
  in: Partial<Record<ModifierEncoding, string>>;
}

const code = (s: string) => `<code>${s}</code>`;
/** Alternative spellings: `a`, `a or b`, `a, b or c`. */
const either = (...forms: string[]) => {
  const c = forms.map(code);
  return c.length < 2 ? c.join('') : `${c.slice(0, -1).join(', ')} or ${c[c.length - 1]}`;
};

const INPUT_MODIFIERS: ModifierRow[] = [
  { name: 'neg', syntax: either('-v1', 'neg(v1)'),
    in: { VOP3A: 'src0–2', VOP3B: 'src0–2', VOP3P: 'src0–2, both halves', DPP16: 'src0, src1', SDWA: 'src0, src1' } },
  { name: 'abs', syntax: either('|v1|', 'abs(v1)'),
    in: { VOP3A: 'src0–2', VOP3P: 'v_fma_mix*, v_dot2_f32_f16 src2', DPP16: 'src0, src1', SDWA: 'src0, src1' } },
  { name: 'neg_lo, neg_hi', syntax: code('neg_lo:[0,1]'), in: { VOP3P: '✓' } },
  { name: 'op_sel', syntax: code('op_sel:[1,0,0,1]'), in: { VOP3A: '16-bit instructions', VOP3P: '✓' } },
  { name: 'op_sel_hi', syntax: code('op_sel_hi:[0,1]'), in: { VOP3P: '✓' } },
  { name: 'src0_sel, src1_sel', syntax: code('src0_sel:BYTE_1'), in: { SDWA: '✓' } },
  { name: 'sext', syntax: code('sext(v1)'), in: { SDWA: 'src0, src1' } },
];

const OUTPUT_MODIFIERS: ModifierRow[] = [
  { name: 'clamp', syntax: code('clamp'), in: { VOP3A: '✓', VOP3B: '✓', VOP3P: '✓', SDWA: 'not VOPC' } },
  { name: 'mul, div', syntax: either('mul:2', 'mul:4', 'div:2'), in: { VOP3A: 'f32 results, without clamp', VOP3B: 'f32 results, without clamp' } },
  { name: 'dst_sel, dst_unused', syntax: code('dst_sel:WORD_1'), in: { SDWA: 'not VOPC' } },
];

/** The Modifiers tab's examples: each line assembles in its `encoding` (tested). */
export const MODIFIER_EXAMPLES: { line: string; encoding: string; result: string }[] = [
  { line: 'v_add_f32 v0, -v1, |v2|', encoding: 'VOP3A', result: 'v0 = −v1 + |v2|' },
  { line: 'v_mul_f32 v0, v1, v2 mul:2', encoding: 'VOP3A', result: 'v0 = v1 × v2 × 2' },
  { line: 'v_mul_f32 v0, v1, v2 clamp', encoding: 'VOP3A', result: 'v0 = v1 × v2, clamped to [0.0, 1.0]' },
  { line: 'v_sub_f32 v0, v1, v2 div:2', encoding: 'VOP3A', result: 'v0 = (v1 − v2) ÷ 2' },
  { line: 'v_fma_f16 v0, v1, v2, v3 op_sel:[1,0,0,1]', encoding: 'VOP3A', result: 'hi(v0) = hi(v1) × lo(v2) + lo(v3), keeping lo(v0)' },
  { line: 'v_add_co_u32 v0, s0, v1, v2 clamp', encoding: 'VOP3B', result: 'v0 = v1 + v2, saturating at 0xFFFFFFFF; s0 gets the carries' },
  { line: 'v_pk_add_f16 v0, v1, v2 op_sel:[1,0] op_sel_hi:[0,1]', encoding: 'VOP3P', result: 'lo(v0) = hi(v1) + lo(v2), hi(v0) = lo(v1) + hi(v2)' },
  { line: 'v_pk_mul_f16 v0, v1, v2 neg_hi:[0,1]', encoding: 'VOP3P', result: 'lo(v0) = lo(v1) × lo(v2), hi(v0) = hi(v1) × −hi(v2)' },
  { line: 'v_fma_mix_f32 v0, |v1|, v2, v3 op_sel_hi:[1,0,0]', encoding: 'VOP3P', result: 'v0 = |lo(v1)| × v2 + v3, where lo(v1) is an f16' },
  { line: 'v_add_f32 v0, -v1, v2 quad_perm:[1,0,3,2]', encoding: 'DPP16', result: 'v0 = −v1 + v2, with v1 read from the lane\'s partner (0↔1, 2↔3, …)' },
  { line: 'v_add_nc_u32 v0, sext(v1), v2 src0_sel:BYTE_1', encoding: 'SDWA', result: 'v0 = byte 1 of v1, sign-extended, + v2' },
  { line: 'v_cvt_f32_f16 v0, -v1 src0_sel:WORD_1', encoding: 'SDWA', result: 'v0 = −hi(v1), converted to f32' },
  { line: 'v_add_f16 v0, v1, v2 src0_sel:WORD_1 dst_sel:WORD_1 dst_unused:UNUSED_PRESERVE', encoding: 'SDWA', result: 'hi(v0) = hi(v1) + lo(v2), keeping lo(v0)' },
  { line: 'v_mov_b32 v0, v1 dst_sel:BYTE_2 dst_unused:UNUSED_PRESERVE src0_sel:BYTE_0', encoding: 'SDWA', result: 'byte 2 of v0 = byte 0 of v1, keeping the rest of v0' },
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
    html += `<button class="ency-tab" data-tab="modifiers">Modifiers</button>`;
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

    html += `<div class="ency-tab-content" data-content="modifiers" style="display:none">`;
    html += this.renderModifiers(allOpcodes);
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
      html += `<p class="ency-note">Any VOP1, VOP2 or VOPC instruction can also be encoded as VOP3, which the assembler picks when it uses modifiers or operands the 32-bit form cannot hold. The VOP3 opcode is the VOPC opcode + 0x000, the VOP2 opcode + 0x100, or the VOP1 opcode + 0x180.</p>`;
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

  /** Every input and output modifier, the encodings that have each, what they do, and examples. */
  private renderModifiers(allOpcodes: OpcodeInfo[]): string {
    const opSel16 = allOpcodes.filter(o => o.opSel && o.format === InstructionFormat.VOP3).map(o => o.mnemonic);
    let html = `<div class="ency-format-section ency-mods">`;
    html += `<h3 class="ency-format-title">Modifiers <span class="ency-format-subtitle">— Input and Output Modifiers</span></h3>`;
    html += `<p class="ency-format-desc">Input modifiers change a source before the instruction reads it; output modifiers change the result before it's written. The 32-bit VOP1, VOP2 and VOPC encodings have no room for them, so a modifier makes one of those instructions 4 bytes bigger, in one of the 64-bit encodings below. The assembler picks the encoding from what the line uses: DPP16 or DPP8 when it has a lane control such as quad_perm, SDWA when it has a byte or word selector or sext(), and VOP3 otherwise. In Instruction Info, the Encoding buttons switch an instruction between the encodings it can use.</p>`;

    const rows = (title: string, list: ModifierRow[]) => {
      let out = `<tr class="ency-mod-group"><td colspan="${2 + MODIFIER_ENCODINGS.length}">${title}</td></tr>`;
      for (const row of list) {
        out += `<tr><td class="ency-mod-name">${row.name}</td><td>${row.syntax}</td>`;
        for (const enc of MODIFIER_ENCODINGS) {
          const where = row.in[enc];
          out += where ? `<td class="ency-mod-yes">${where}</td>` : `<td class="ency-mod-no">—</td>`;
        }
        out += `</tr>`;
      }
      return out;
    };
    html += `<table class="ency-mod-table"><thead><tr><th>Modifier</th><th>Syntax</th>`;
    for (const enc of MODIFIER_ENCODINGS) html += `<th>${enc}</th>`;
    html += `</tr></thead><tbody>`;
    html += rows('Input modifiers — applied to a source before the operation', INPUT_MODIFIERS);
    html += rows('Output modifiers — applied to the result before it is written', OUTPUT_MODIFIERS);
    html += `</tbody></table>`;
    html += `<p class="ency-note">Scalar (SOP*) and DS instructions take no modifiers, and neither do VOP1, VOP2 and VOPC in their 32-bit form.</p>`;

    const list = (title: string, items: string[]) => `<div class="ency-rules"><h4>${title}</h4><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul></div>`;
    html += list('Input Modifiers', [
      `<b>neg</b> flips the sign of a floating-point source, and <b>abs</b> clears it. With both, ${code('-|v1|')}, abs comes first, so the source is never positive. Only floating-point sources take them (and the two sources of v_cndmask_b32): an integer source can't`,
      'VOP3B has no ABS field: its scalar destination (the carry-out or flag) takes its place. DPP16 and SDWA take neg and abs on src0 and src1; DPP8 takes no modifiers at all',
      `In VOP3P, ${code('-v1')} negates both halves of a packed f16 source, and ${code('neg_lo:[…]')} and ${code('neg_hi:[…]')} negate just the low or high halves, one bit per source. In v_fma_mix* and the f32 src2 of v_dot2_f32_f16, NEG_HI is abs instead: write ${code('|v1|')}. Packed integer instructions take neither`,
      `<b>op_sel</b> in VOP3A, for 16-bit instructions: one bit per source reads its high half instead of its low half, and a last bit writes the result to the high half of vdst instead of the low half; the other half keeps its value. The VOP3A instructions with op_sel: ${opSel16.join(', ')}. (v_permlane16_b32 and v_permlanex16_b32 use ${code('op_sel:[fi,bound_ctrl]')} for their own two flags.)`,
      'VOP1 and VOP2 16-bit instructions such as v_add_f16 have no op_sel on RDNA2: SDWA\'s WORD_1 selectors read and write their high halves instead',
      '<b>op_sel</b> and <b>op_sel_hi</b> in VOP3P: a packed instruction makes a low and a high result. op_sel picks the half of each source that the low result reads (default: the low halves), and op_sel_hi the half that the high result reads (default: the high halves). In v_fma_mix*, op_sel_hi marks a source as f16 and op_sel picks its half; 0 means f32. v_dot4* and v_dot8* take neither',
      `<b>src0_sel</b> and <b>src1_sel</b> (SDWA): the instruction reads only BYTE_0–BYTE_3, WORD_0 or WORD_1 of the source (default DWORD: all of it), moved down to bit 0 and zero-extended. <b>sext</b>, as in ${code('sext(v1)')}, sign-extends it instead: it's for integer sources, as abs and neg are for floats. sext() alone also makes the instruction SDWA`,
    ]);
    html += list('Output Modifiers', [
      '<b>clamp</b>: a floating-point result is clamped to [0.0, 1.0], and NaN becomes 0. An integer result that overflows saturates at the limits of its type instead of wrapping (v_add_nc_u32, v_add_co_u32, v_mul_lo_u32, v_mad_u32_u24, the packed and dot instructions, …), and each half of a packed result is clamped on its own. Bitwise, shift, move and lane instructions (v_and_b32, v_lshlrev_b32, v_mov_b32, v_readlane_b32, …) have no clamp, and compares take it only when they compare floats (not v_cmp_class), where it leaves the mask unchanged',
      `<b>mul:2</b>, <b>mul:4</b> and <b>div:2</b> (OMOD) multiply an f32 result by 2, 4 or 0.5, in VOP3, one per instruction. As in LLVM, they assemble on any floating-point result and in SDWA too, but the devkit's GPU ignores them (and the editor warns) in SDWA, alongside clamp (${code('mul:2 clamp')} only clamps), and on f16 and f64 results, whose denormals it keeps`,
      '<b>dst_sel</b> (SDWA): writes the result to BYTE_0–BYTE_3, WORD_0 or WORD_1 of vdst (default DWORD: all of it). <b>dst_unused</b> sets the rest of vdst: UNUSED_PAD zeros it (the default), UNUSED_SEXT sign-extends the result into the bits above it and zeros those below, and UNUSED_PRESERVE keeps them',
      'SDWA compares write a lane mask, so they take no clamp, mul:/div:, dst_sel or dst_unused',
    ]);
    html += list('Which Instructions Each Encoding Covers', [
      '<b>VOP3A</b>: the VOP3-only instructions, and the VOP1, VOP2 and VOPC instructions, except the carry instructions (VOP3B) and the few with no VOP3 form: v_nop, v_swap_b32, v_pk_fmac_f16, v_dot4c_i32_i8, v_dot8c_i32_i4 and the K-constant forms (v_fmamk_f32, v_fmaak_f32, v_madmk_f32, …)',
      '<b>VOP3B</b>: instructions with a second, scalar destination: v_add_co_u32 and the other carry instructions, v_div_scale_f64, v_mad_u64_u32 and v_mad_i64_i32',
      '<b>VOP3P</b>: the packed and mixed-precision instructions: v_pk_*, v_fma_mix* and v_dot*',
      '<b>DPP16</b> and <b>DPP8</b>: VOP1 and VOP2 instructions without 64-bit operands, whose src0 and vsrc1 are VGPRs. Not compares, v_readfirstlane_b32, v_swap_b32 or the K-constant forms',
      '<b>SDWA</b>: VOP1, VOP2 and VOPC instructions without 64-bit operands, except v_readfirstlane_b32, v_swap_b32, the K-constant forms and the accumulating instructions (v_fmac_f32, v_mac_f32, …). Its sources can be VGPRs, SGPRs or inline constants, but not literals',
    ]);

    html += `<div class="ency-instr-table"><h4>Examples</h4>`;
    html += `<table><thead><tr><th>Instruction</th><th>Encoding</th><th>Result</th></tr></thead><tbody>`;
    for (const ex of MODIFIER_EXAMPLES) {
      html += `<tr><td class="ency-syntax">${ex.line}</td><td class="ency-opcode">${ex.encoding}</td><td>${ex.result}</td></tr>`;
    }
    html += `</tbody></table></div>`;

    html += `</div>`;
    return html;
  }

  private escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}
