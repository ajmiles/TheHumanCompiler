// ── RDNA2 ISA Core Types ──

export enum InstructionFormat {
  VOP1 = 'VOP1',
  VOP2 = 'VOP2',
  VOP3 = 'VOP3',
  VOPC = 'VOPC',
  SOP1 = 'SOP1',
  SOPP = 'SOPP',
}

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
  value: number;       // Register index or constant value
  encoded: number;     // 9-bit encoded value for SRC0, or 8-bit for VSRC1/VDST
  abs?: boolean;       // |src| — clear sign bit before operation
  neg?: boolean;       // -src — flip sign bit before operation
}

export interface ParsedInstruction {
  mnemonic: string;
  dst: Operand;
  src0: Operand;
  src1?: Operand;
  src2?: Operand;      // VOP3-only (3-source instructions like FMA)
  line: number;
  column: number;
  omod?: number;       // Output modifier: 0=none, 1=×2, 2=×4, 3=÷2
  clamp?: boolean;     // Clamp output to [0.0, 1.0]
}

export interface DecodedInstruction {
  format: InstructionFormat;
  opcode: number;
  dst: number;         // VGPR index (0-255)
  src0Encoded: number; // 9-bit encoded source
  src1?: number;       // 8-bit VGPR index (VOP2) or 9-bit (VOP3)
  src2?: number;       // 9-bit (VOP3 3-source only)
  literal?: number;    // 32-bit literal if SRC0 == 255
  address: number;     // Word offset in the binary
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
}

export type SemanticFn = (a: number, b?: number, c?: number) => number;

export interface OpcodeInfo {
  mnemonic: string;
  format: InstructionFormat;
  opcode: number;
  operandCount: number; // 2 for VOP1/VOPC, 3 for VOP2
  execute: SemanticFn;
  description: string;
  syntax: string;
  readsVCC?: boolean;   // v_cndmask_b32: uses VCC to select
  writesVCC?: boolean;  // VOPC: writes comparison result to VCC
  halts?: boolean;      // s_endpgm: stops execution
}

export interface AssemblyError {
  message: string;
  line: number;
  column: number;
}

export interface AssemblyResult {
  binary: Uint32Array;
  errors: AssemblyError[];
  instructions: ParsedInstruction[];
}
