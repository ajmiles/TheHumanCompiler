// ── RDNA2 ISA Core Types ──

export enum InstructionFormat {
  VOP1 = 'VOP1',
  VOP2 = 'VOP2',
  VOP3 = 'VOP3',
  VOP3P = 'VOP3P',
  VOPC = 'VOPC',
  SOP1 = 'SOP1',
  SOP2 = 'SOP2',
  SOPC = 'SOPC',
  SOPP = 'SOPP',
  SOPK = 'SOPK',
  SMEM = 'SMEM',
  MUBUF = 'MUBUF',
  MTBUF = 'MTBUF',
  MIMG = 'MIMG',
  DS = 'DS',
  FLAT = 'FLAT',
  EXP = 'EXP',
  VINTRP = 'VINTRP',
  UNKNOWN = 'UNKNOWN',
}

/** Concrete machine encoding of an instruction. */
export type EncodingKind =
  | 'VOP1' | 'VOP2' | 'VOPC' | 'VOP3A' | 'VOP3B' | 'VOP3P'
  | 'SOP1' | 'SOP2' | 'SOPC' | 'SOPK' | 'SOPP' | 'SMEM'
  | 'DS' | 'MUBUF' | 'MTBUF' | 'MIMG' | 'FLAT' | 'EXP' | 'VINTRP' | 'UNKNOWN';

/** Extra dword following a 32-bit VALU encoding (or any literal constant). */
export type EncodingExtra = 'DPP16' | 'DPP8' | 'SDWA' | 'LITERAL';

export enum OperandType {
  VGPR = 'VGPR',
  SGPR = 'SGPR',
  INLINE_INT = 'INLINE_INT',
  INLINE_FLOAT = 'INLINE_FLOAT',
  LITERAL = 'LITERAL',
  SPECIAL = 'SPECIAL',
}

export interface Operand {
  type: OperandType;
  value: number;       // Register index (VGPR index, or scalar operand encoding) or constant value
  encoded: number;     // 9-bit source encoding (VGPR = 256 + index); constants are re-encoded per operand type
  abs?: boolean;       // |src| — clear sign bit before operation
  neg?: boolean;       // -src — flip sign bit before operation
  isFloat?: boolean;   // Constant was written in floating-point syntax (e.g. 3.0)
  isHex?: boolean;     // Constant was written in hexadecimal (e.g. 0x40400000): a bit pattern
  regCount?: number;   // Number of registers named by a range such as v[0:1]
}

/** Where something was written on its source line: 1-based columns, `end` exclusive. */
export interface SourceSpan {
  start: number;
  end: number;
}

/**
 * Parts of an instruction that can be rewritten in place: the mnemonic (without an _e32/_e64/_dpp/_sdwa
 * suffix), the operands (just the register or constant, inside any -, |…|, abs() or sext() wrapper),
 * the implied constant K and the 16-bit immediate (or branch label, or s_waitcnt counters).
 */
export type OperandSlot = 'mnemonic' | 'dst' | 'sdst' | 'src0' | 'src1' | 'src2' | 'k' | 'simm';

export interface ParsedInstruction {
  mnemonic: string;
  dst: Operand;
  src0: Operand;
  src1?: Operand;
  src2?: Operand;      // VOP3 3-source instructions; also the carry-in / condition SGPR of VOP3 carry ops and v_cndmask_b32
  sdst?: Operand;      // Scalar destination: VOPC result mask, VOP3B carry-out (defaults to VCC)
  kLiteral?: number;   // Implied 32-bit literal K of v_madmk/v_madak/v_fmamk/v_fmaak (raw bits)
  kInteger?: number;   // K as written when that was a decimal integer (the float K then holds its bit pattern)
  line: number;
  column: number;
  spans?: Partial<Record<OperandSlot, SourceSpan>>; // Source columns of the mnemonic and of each written operand
  /** Source columns of each written VALU source with its modifiers: -, |…|, abs(), neg() and sext(). */
  wrappedSpans?: Partial<Record<'src0' | 'src1' | 'src2', SourceSpan>>;
  omod?: number;       // Output modifier: 0=none, 1=×2, 2=×4, 3=÷2
  clamp?: boolean;     // Clamp output to [0.0, 1.0]
  offset?: number;     // Memory offset (DS: OFFSET1:OFFSET0)
  memFlags?: number;   // Packed memory flags: bit1=idxen, bit2=glc, bit0=offen
  // DPP modifiers
  dppCtrl?: number;    // DPP16 control (row_shr:N, quad_perm, etc.)
  dpp8?: number[];     // DPP8: 8 lane selectors
  boundCtrl?: boolean; // DPP16 bound control
  fetchInactive?: boolean; // DPP8/DPP16 FI: read pre-existing values from inactive lanes
  rowMask?: number;    // DPP16 ROW_MASK (default 0xF)
  bankMask?: number;   // DPP16 BANK_MASK (default 0xF)
  // SDWA modifiers (Sub-Dword Addressing)
  sdwaDstSel?: number;    // DST_SEL: 0=BYTE_0..3, 4=WORD_0, 5=WORD_1, 6=DWORD
  sdwaDstUnused?: number; // DST_UNUSED: 0=PAD, 1=SEXT, 2=PRESERVE
  sdwaSrc0Sel?: number;   // SRC0_SEL: same as DST_SEL
  sdwaSrc0Sext?: boolean; // SRC0 sign-extend
  sdwaSrc1Sel?: number;   // SRC1_SEL: same as DST_SEL (VOP2 only)
  sdwaSrc1Sext?: boolean; // SRC1 sign-extend
  // Branch support
  labelRef?: string;   // Unresolved label reference (branch target)
  simm16?: number;     // Resolved SIMM16 (branch offset in dwords, or waitcnt)
  forceVop3?: boolean; // Written with an _e64 suffix: always use the VOP3 encoding
  // VOP3 / VOP3P modifiers
  opSel?: number;      // OP_SEL: VOP3 bits[3:0] = src0,src1,src2,dst; VOP3P bits[2:0] = src0..src2 lo-half select
  opSelHi?: number;    // VOP3P OP_SEL_HI bits[2:0] = src0..src2 hi-half select (default 0b111)
  negLo?: number;      // VOP3P NEG_LO bits[2:0] (stored as src0/1/2 neg)
  negHi?: number;      // VOP3P NEG_HI bits[2:0]
}

export interface DecodedInstruction {
  format: InstructionFormat; // Opcode table format (VOP3-encoded VOP1/VOP2/VOPC keep their base format)
  opcode: number;
  dst: number;         // VDST field: VGPR index, or SGPR encoding for scalar destinations
  src0Encoded: number; // 9-bit encoded source (DS: ADDR VGPR index)
  src1?: number;       // 9-bit encoded source (VOP2 VSRC1 is stored as 256 + VGPR; DS: DATA0 VGPR index)
  src2?: number;       // 9-bit encoded source (VOP3; implicit VCC of VOP2 v_cndmask/carry ops; DS: DATA1)
  sdst?: number;       // Scalar destination: VOPC mask target, VOP3B carry-out
  literal?: number;    // 32-bit literal (SRC == 255), implied K constant, or Xbox v_nop data
  address: number;     // Dword offset of the instruction in the binary
  size: number;        // Instruction size in dwords (including literal / DPP / SDWA words)
  encoding: EncodingKind;
  extra?: EncodingExtra;
  vop3?: boolean;      // Encoded with the 64-bit VOP3A/VOP3B encoding
  // Extra fields for memory/scalar instructions
  simm16?: number;     // 16-bit immediate (SOPP, SOPK)
  offset?: number;     // Memory offset (MUBUF, SMEM, DS)
  srsrc?: number;      // Resource descriptor SGPR quad index (MUBUF, MIMG)
  ssamp?: number;      // Sampler SGPR quad index (MIMG)
  sbase?: number;      // SMEM base SGPR pair index
  dmask?: number;      // MIMG data mask
  flags?: number;      // Raw flags (idxen, glc, etc.)
  // Source modifiers (applied before the operation)
  src0Abs?: boolean;
  src0Neg?: boolean;
  src1Abs?: boolean;
  src1Neg?: boolean;
  src2Abs?: boolean;
  src2Neg?: boolean;
  // Output modifiers
  omod?: number;       // 0=none, 1=×2, 2=×4, 3=÷2
  clamp?: boolean;
  // DPP modifiers
  dppCtrl?: number;    // DPP16: 9-bit control word (row_shr, quad_perm, etc.)
  dpp8?: number[];     // DPP8: 8 lane selectors (3-bit each, within groups of 8)
  boundCtrl?: boolean; // DPP16: true = invalid source lanes read 0, false = lane not written
  fetchInactive?: boolean; // DPP FI bit (DPP16) / DPP8FI encoding
  rowMask?: number;    // DPP16 ROW_MASK
  bankMask?: number;   // DPP16 BANK_MASK
  // VOP3 / VOP3P modifiers
  opSel?: number;      // VOP3: OP_SEL[3:0]; VOP3P: OP_SEL[2:0]
  opSelHi?: number;    // VOP3P OP_SEL_HI[2:0]
  negHi?: number;      // VOP3P NEG_HI bits for src0/src1/src2
  // SDWA modifiers (Sub-Dword Addressing)
  sdwaDstSel?: number;    // DST_SEL: 0=BYTE_0..3, 4=WORD_0, 5=WORD_1, 6=DWORD
  sdwaDstUnused?: number; // DST_UNUSED: 0=PAD, 1=SEXT, 2=PRESERVE
  sdwaSrc0Sel?: number;   // SRC0_SEL: same as DST_SEL
  sdwaSrc0Sext?: boolean; // SRC0 sign-extend (true) vs zero-extend (false)
  sdwaSrc1Sel?: number;   // SRC1_SEL: same as DST_SEL (VOP2 only)
  sdwaSrc1Sext?: boolean; // SRC1 sign-extend
}

export type SemanticFn = (a: number, b?: number, c?: number) => number;

/**
 * Value type of a VALU operand.
 *  - f32/f16: floating point; the semantic function receives and returns JS numbers.
 *  - b32: raw 32-bit pattern (unsigned number).
 *  - u16/i16/b16: low (or op_sel-selected) 16 bits, zero- or sign-extended.
 *  - f64/i64/u64: a 64-bit value in a register pair (VOPC compares), read exactly by the executor.
 * 16-bit destinations write only their half of the VGPR and preserve the other half (GFX10).
 */
export type ValueType = 'f32' | 'f16' | 'b32' | 'u16' | 'i16' | 'b16' | 'f64' | 'i64' | 'u64';

/** Source type of a VOPC compare. */
export type CompareType = 'f16' | 'f32' | 'f64' | 'i16' | 'u16' | 'i32' | 'u32' | 'i64' | 'u64';

/**
 * Condition of a VOPC compare. The float conditions f…tru and the integer conditions f…t are listed in
 * opcode order, where each one's position is its truth table (see COMPARE_TRUTH in opcodes.ts);
 * 'class' tests the floating-point class of src0 against the mask in src1.
 */
export type CompareOp =
  | 'f' | 'lt' | 'eq' | 'le' | 'gt' | 'lg' | 'ge' | 'o' | 'u' | 'nge' | 'nlg' | 'ngt' | 'nle' | 'neq' | 'nlt' | 'tru'
  | 'ne' | 't' | 'class';

/** Element type of a packed dot-product source. */
export type DotElement = 'f16' | 'i16' | 'u16' | 'i8' | 'u8' | 'i4' | 'u4';

/** Bit width of a scalar operand (0 = not present). */
export type ScalarWidth = 0 | 32 | 64;

export interface SaluContext {
  scc: number;   // SCC before the instruction
  d: bigint;     // Destination value before the instruction (accumulating/conditional ops)
}

/** Scalar ALU semantics, evaluated with BigInt so 64-bit operands are exact. */
export interface SaluSemantics {
  d: ScalarWidth;
  s0: ScalarWidth;
  s1: ScalarWidth;
  /** SOPK only: how SIMM16 is extended to form S1 (S0 is the destination's old value). */
  simm?: 'sext' | 'zext';
  /** Returns the new destination value, or undefined to leave it unchanged. */
  op: (s0: bigint, s1: bigint, ctx: SaluContext) => bigint | undefined;
  /** Returns the new SCC value; omitted when the instruction does not write SCC. */
  scc?: (s0: bigint, s1: bigint, d: bigint, ctx: SaluContext) => boolean;
}

export interface OpcodeInfo {
  mnemonic: string;
  format: InstructionFormat;
  opcode: number;
  operandCount: number; // 2 for VOP1/VOPC, 3 for VOP2
  execute: SemanticFn;
  description: string;
  syntax: string;
  readsVCC?: boolean;   // Reads VCC (or the VOP3 SRC2 SGPR) per lane
  writesVCC?: boolean;  // Writes a lane mask to VCC (or the VOP3 SDST SGPR)
  halts?: boolean;      // s_endpgm: stops execution
  isIntegerOp?: boolean; // true: raw u32 input AND output (v_and_b32, v_mov_b32, etc.)
  integerInput?: boolean; // true: raw u32 input, float output (v_cvt_f32_i32, v_cvt_f32_ubyte*)
  integerOutput?: boolean; // true: float input, raw u32 output (v_cvt_u32_f32, v_cvt_i32_f32)
  /** Explicit operand value types; takes precedence over the integer flags above. */
  types?: { d: ValueType; s: ValueType[] };
  /** VOP3 OP_SEL selects the 16-bit half of each source/destination. */
  opSel?: boolean;
  /** Destination is also an implicit source (passed as the last semantic argument). */
  accumulate?: boolean;
  /** Implied literal K: 'mk' → execute(S0, K, S1), 'ak' → execute(S0, S1, K). No VOP3 form. */
  kLiteral?: 'mk' | 'ak';
  /** Carry-chain integer op: carry-out to VCC/SDST, optional carry-in from VCC/SRC2. */
  carry?: 'add' | 'sub' | 'subrev';
  carryIn?: boolean;
  /** Encoded with VOP3B (SDST field in place of ABS/OP_SEL). */
  vop3b?: boolean;
  /**
   * VOP3P dot product: the element type packed into src0 and src1. src2 and the result are 32-bit
   * (f32 for 'f16', otherwise i32/u32). Only the 16-bit kinds take op_sel/op_sel_hi.
   */
  dot?: DotElement;
  /** VOPC compare: its source type and condition. */
  compare?: { type: CompareType; op: CompareOp };
  /** Scalar ALU semantics (SOP1/SOP2/SOPC/SOPK). */
  salu?: SaluSemantics;
}

export interface AssemblyError {
  message: string;
  line: number;
  column: number;
}

export interface AssemblyResult {
  binary: Uint32Array;
  errors: AssemblyError[];
  /** Problems that do not stop the program assembling, such as a missing s_endpgm. */
  warnings: AssemblyError[];
  instructions: ParsedInstruction[];
}
