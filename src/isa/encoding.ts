// ── RDNA2 (GFX10) Binary Encoding / Decoding ──
// encodeInstruction: ParsedInstruction → machine words
// decodeBinary:      machine words → DecodedInstruction[]
// disassemble:       DecodedInstruction → assembly text accepted by the assembler

import {
  InstructionFormat,
  ParsedInstruction,
  DecodedInstruction,
  OperandType,
  Operand,
  OpcodeInfo,
  EncodingKind,
} from './types';
import {
  LITERAL_CONST,
  VGPR_SRC_MIN,
  VCC_LO,
  EXEC_LO,
  NULL_REG,
  INLINE_INT_0,
  INLINE_FLOAT_MAP,
  INLINE_FLOAT16_BITS,
  SRC_DPP8,
  SRC_DPP8FI,
  SRC_SDWA,
  SRC_DPP16,
  VOP3_VOP1_OFFSET,
  VOP3_VOP2_OFFSET,
} from './constants';
import { lookupByMnemonic, lookupByOpcode } from './opcodes';
import { f16ToF32, f32ToF16 } from './float16';
import { ConstKind, valuConstKind, valuSourceCount, vopTypes, isFloatType, operandRegCount, hasPackedModifiers } from './operands';

/** An instruction that cannot be encoded (bad operand combination, constant out of range, …). */
export class EncodingError extends Error {}

function fail(message: string): never {
  throw new EncodingError(message);
}

const f32buf = new Float32Array(1);
const u32buf = new Uint32Array(f32buf.buffer);

function f32Bits(v: number): number {
  f32buf[0] = v;
  return u32buf[0] >>> 0;
}

function bitsToF32(bits: number): number {
  u32buf[0] = bits >>> 0;
  return f32buf[0];
}

// ── Constant operands ──

function isScalarReg(op: Operand | undefined): op is Operand {
  return !!op && (op.type === OperandType.SGPR || op.type === OperandType.SPECIAL);
}

function constIsFloat(op: Operand): boolean {
  return op.isFloat ?? (op.type === OperandType.INLINE_FLOAT || !Number.isInteger(op.value));
}

function inlineIntEncoding(v: number): number | null {
  if (!Number.isInteger(v)) return null;
  if (v >= 0 && v <= 64) return INLINE_INT_0 + v;
  if (v >= -16 && v <= -1) return 192 - v;
  return null;
}

const INV_2PI_F64 = 1 / (2 * Math.PI);

/** Inline float constant encoding (240–248) for a value, as seen by an operand of the given kind. */
function inlineFloatEncoding(v: number, kind: ConstKind): number | null {
  if (v === 0 && !Object.is(v, -0)) return INLINE_INT_0;
  for (const key of Object.keys(INLINE_FLOAT_MAP)) {
    const enc = Number(key);
    const c = INLINE_FLOAT_MAP[enc];
    if (kind === 'f16' || kind === 'pkf16') {
      if (f32ToF16(v) === INLINE_FLOAT16_BITS[enc]) return enc;
    } else if (kind === 'u64' || kind === 'i64') {
      if (enc === 248 ? Math.abs(v - INV_2PI_F64) < 1e-9 : v === c) return enc;
    } else if (Math.fround(v) === Math.fround(c)) {
      return enc;
    }
  }
  return null;
}

function f16LiteralBits(v: number): number {
  const h = f32ToF16(v);
  if ((h & 0x7FFF) === 0x7C00 && Number.isFinite(v)) fail(`${v} is out of range for a 16-bit float`);
  return h;
}

function formatNumber(v: number): string {
  return Number.isInteger(v) && Math.abs(v) > 0xFFFF ? `0x${(v >>> 0).toString(16)}` : String(v);
}

interface ConstEncoding { enc: number; literal?: number }

/**
 * Encode a constant for an operand of the given kind: an inline constant when the
 * hardware has one for the value, otherwise the 32-bit literal (LLVM conversion rules).
 */
export function encodeConstant(op: Operand, kind: ConstKind): ConstEncoding {
  const v = op.value;
  if (constIsFloat(op)) {
    switch (kind) {
      case 'f16':
      case 'pkf16': {
        // Packed f16 literals hold the value in the low half only (LLVM semantics)
        const inl = inlineFloatEncoding(v, kind);
        if (inl !== null) return { enc: inl };
        return { enc: LITERAL_CONST, literal: f16LiteralBits(v) };
      }
      case 'u64':
      case 'i64': {
        const inl = inlineFloatEncoding(v, kind);
        if (inl !== null) return { enc: inl };
        return fail(`Floating-point constant ${v} cannot be used as a 64-bit integer operand`);
      }
      default: {
        // 32-bit operands, and 16-bit integer operands (packed or not): integer instructions receive
        // inline float constants as f32 values, so a float always means its f32 bit pattern there
        // (a 16-bit operand uses the low half)
        const inl = inlineFloatEncoding(v, kind);
        if (inl !== null) return { enc: inl };
        if (Number.isFinite(v) && !Number.isFinite(Math.fround(v))) fail(`${v} is out of range for a 32-bit float`);
        return { enc: LITERAL_CONST, literal: f32Bits(v) };
      }
    }
  }
  const inl = inlineIntEncoding(v);
  if (inl !== null) return { enc: inl };
  const width = kind === 'f16' || kind === 'i16' ? 16 : 32;
  if (!Number.isInteger(v) || v < -(2 ** (width - 1)) || v > 2 ** width - 1) {
    fail(`Constant ${formatNumber(v)} does not fit in a ${width}-bit operand`);
  }
  // A bit pattern such as 0xffffffff is the inline constant -1 for 32/16-bit operands
  // (not for 64-bit operands, where the literal is zero-extended)
  if (kind !== 'u64' && kind !== 'i64') {
    const signed = width === 16 ? (v << 16) >> 16 : v | 0;
    const folded = inlineIntEncoding(signed);
    if (folded !== null) return { enc: folded };
  }
  // f16 bit patterns of the inline float constants (e.g. 0x3c00 = 1.0) for 16-bit float operands
  if ((kind === 'f16' || kind === 'pkf16') && v >= 0 && v <= 0xFFFF) {
    for (const key of Object.keys(INLINE_FLOAT16_BITS)) {
      if (INLINE_FLOAT16_BITS[Number(key)] === v) return { enc: Number(key) };
    }
  }
  return { enc: LITERAL_CONST, literal: (width === 16 ? v & 0xFFFF : v) >>> 0 };
}

/** The single 32-bit literal dword an instruction may carry. */
class LiteralSlot {
  value: number | undefined;
  use(literal: number | undefined): void {
    if (literal === undefined) return;
    if (this.value !== undefined && this.value !== (literal >>> 0)) {
      fail('Only one literal constant is allowed per instruction (RDNA2 has a single 32-bit literal slot)');
    }
    this.value = literal >>> 0;
  }
}

/** 9-bit VALU source encoding. */
function vsrc9(op: Operand, kind: ConstKind, lit: LiteralSlot): number {
  switch (op.type) {
    case OperandType.VGPR: return VGPR_SRC_MIN + (op.value & 0xFF);
    case OperandType.SGPR:
    case OperandType.SPECIAL: return op.value & 0xFF;
    default: {
      const e = encodeConstant(op, kind);
      lit.use(e.literal);
      return e.enc;
    }
  }
}

/** 8-bit scalar (SALU) source encoding. */
function ssrc8(op: Operand, kind: ConstKind, lit: LiteralSlot, mnemonic: string): number {
  if (op.type === OperandType.VGPR) fail(`${mnemonic}: VGPRs cannot be used as scalar operands`);
  if (isScalarReg(op)) return op.value & 0xFF;
  const e = encodeConstant(op, kind);
  lit.use(e.literal);
  return e.enc;
}

/** A VALU source as seen by the constant bus: its operand, encoded field and size in dwords. */
interface BusSource {
  op: Operand | undefined;
  enc: number;
  dwords: number;
}

/** 64-bit shifts may read only one scalar value on RDNA2. */
const SINGLE_SCALAR_VALUE = new Set(['v_lshlrev_b64', 'v_lshrrev_b64', 'v_ashrrev_i64']);

/**
 * RDNA2 VALU instructions may read at most two scalar values (SGPRs, VCC, EXEC, M0, SCC or the
 * literal), and 64-bit shifts only one. Inline constants are free and a value read twice counts once,
 * except that the literal used by operands of different sizes counts once per size.
 */
function checkConstantBus(mnemonic: string, sources: BusSource[], implicitVcc: boolean): void {
  const keys = new Set<string>();
  for (const { op, enc, dwords } of sources) {
    if (isScalarReg(op) && op.value !== NULL_REG) keys.add(`r${op.value}`);
    else if (enc === LITERAL_CONST) keys.add(`literal${dwords}`);
  }
  if (implicitVcc) keys.add(`r${VCC_LO}`);
  const limit = SINGLE_SCALAR_VALUE.has(mnemonic) ? 1 : 2;
  if (keys.size > limit) {
    fail(`${mnemonic} reads ${keys.size} scalar values; ` + (limit === 1
      ? 'RDNA2 64-bit shifts may read only one (an SGPR, VCC, M0, EXEC or a literal; inline constants are free)'
      : 'RDNA2 VALU instructions may read at most 2 (SGPRs, VCC, M0, EXEC or a literal)'));
  }
}

/** Constant-bus view of sources that are all 32-bit. */
function busSources(ops: (Operand | undefined)[], encs: number[]): BusSource[] {
  return ops.map((op, i) => ({ op, enc: encs[i], dwords: 1 }));
}

// ── VALU encodings ──

const SDWA_DWORD = 6;

function hasSdwa(instr: ParsedInstruction): boolean {
  return instr.sdwaDstSel !== undefined || instr.sdwaDstUnused !== undefined || instr.sdwaSrc0Sel !== undefined ||
    instr.sdwaSrc1Sel !== undefined || instr.sdwaSrc0Sext !== undefined || instr.sdwaSrc1Sext !== undefined;
}

function hasDpp(instr: ParsedInstruction): boolean {
  return instr.dppCtrl !== undefined || instr.dpp8 !== undefined;
}

function sources(instr: ParsedInstruction): (Operand | undefined)[] {
  return [instr.src0, instr.src1, instr.src2];
}

function isCmpx(info: OpcodeInfo): boolean {
  return info.format === InstructionFormat.VOPC && info.mnemonic.startsWith('v_cmpx_');
}

/** VOP2 instructions whose third source (carry-in / condition) is VCC in the 32-bit encoding. */
function hasImplicitVccSource(info: OpcodeInfo): boolean {
  return info.format === InstructionFormat.VOP2 && (!!info.carryIn || info.mnemonic === 'v_cndmask_b32');
}

function defaultSdst(info: OpcodeInfo): number {
  return isCmpx(info) ? EXEC_LO : VCC_LO;
}

/** Does a VOP1/VOP2/VOPC instruction need the 64-bit VOP3 encoding? */
function needsVop3(info: OpcodeInfo, instr: ParsedInstruction): boolean {
  if (info.format === InstructionFormat.VOP3 || instr.forceVop3) return true;
  if (instr.clamp || instr.omod || instr.opSel) return true;
  if (sources(instr).some(s => s?.abs || s?.neg)) return true;
  if ((info.format === InstructionFormat.VOP2 || info.format === InstructionFormat.VOPC) &&
      instr.src1 && instr.src1.type !== OperandType.VGPR) return true;
  if (instr.sdst && instr.sdst.value !== defaultSdst(info)) return true;
  if (hasImplicitVccSource(info) && instr.src2 && !(isScalarReg(instr.src2) && instr.src2.value === VCC_LO)) return true;
  return false;
}

export interface EncodingPlan {
  kind: EncodingKind;
  extra?: 'DPP16' | 'DPP8' | 'SDWA';
}

/** Which machine encoding the assembler uses for an instruction. */
export function planEncoding(instr: ParsedInstruction, info = lookupByMnemonic(instr.mnemonic)): EncodingPlan {
  if (!info) return { kind: 'UNKNOWN' };
  switch (info.format) {
    case InstructionFormat.VOP1:
    case InstructionFormat.VOP2:
    case InstructionFormat.VOPC:
      if (hasDpp(instr)) return { kind: info.format, extra: instr.dpp8 ? 'DPP8' : 'DPP16' };
      if (hasSdwa(instr)) return { kind: info.format, extra: 'SDWA' };
      if (needsVop3(info, instr)) return { kind: info.format === InstructionFormat.VOP2 && info.carry ? 'VOP3B' : 'VOP3A' };
      return { kind: info.format };
    case InstructionFormat.VOP3:
      return { kind: info.vop3b ? 'VOP3B' : 'VOP3A' };
    case InstructionFormat.VOP3P: return { kind: 'VOP3P' };
    case InstructionFormat.SOP1: return { kind: 'SOP1' };
    case InstructionFormat.SOP2: return { kind: 'SOP2' };
    case InstructionFormat.SOPC: return { kind: 'SOPC' };
    case InstructionFormat.SOPK: return { kind: 'SOPK' };
    case InstructionFormat.SOPP: return { kind: 'SOPP' };
    case InstructionFormat.DS: return { kind: 'DS' };
    default: return { kind: 'UNKNOWN' };
  }
}

function checkSourceModifiers(info: OpcodeInfo, instr: ParsedInstruction): void {
  const types = vopTypes(info);
  if (info.mnemonic === 'v_pk_fmac_f16' && sources(instr).some(s => s?.abs || s?.neg)) {
    fail('abs/neg modifiers are not supported on the packed sources of v_pk_fmac_f16');
  }
  sources(instr).forEach((s, i) => {
    if (!s || !(s.abs || s.neg)) return;
    if (info.mnemonic === 'v_cndmask_b32' && i < 2) return; // bitwise select, but VOP3 abs/neg act on the sign bit
    if (!isFloatType(types.s[i])) {
      fail(`abs/neg modifiers are only valid on floating-point operands (operand ${i + 1} of ${info.mnemonic} is an integer)`);
    }
  });
  if (instr.omod && !isFloatType(types.d)) fail(`Output modifiers mul:/div: require a floating-point result (${info.mnemonic})`);
}

function vop3Opcode(info: OpcodeInfo): number {
  if (info.format === InstructionFormat.VOP1) return info.opcode + VOP3_VOP1_OFFSET;
  if (info.format === InstructionFormat.VOP2) return info.opcode + VOP3_VOP2_OFFSET;
  return info.opcode; // VOPC (0x000–0x0FF) and native VOP3
}

function requireSource(info: OpcodeInfo, op: Operand | undefined, index: number): Operand {
  if (!op) fail(`${info.mnemonic}: missing source operand ${index}`);
  return op;
}

function encodeVOP3(info: OpcodeInfo, instr: ParsedInstruction): number[] {
  const m = info.mnemonic;
  const isB = !!info.vop3b || (info.format === InstructionFormat.VOP2 && !!info.carry);
  const nsrc = valuSourceCount(info);
  const srcs = sources(instr);
  const lit = new LiteralSlot();

  if (info.kLiteral) fail(`${m} has no VOP3 form: it does not support modifiers, op_sel or non-VGPR vsrc1`);
  if (NO_VOP3.has(m)) {
    fail(`${m} has no VOP3 (_e64) form on RDNA2, so it cannot use abs/neg, clamp, output modifiers or a non-VGPR vsrc1`);
  }
  checkClamp(info, instr);
  checkSourceModifiers(info, instr);

  // Unused source fields hold inline constant 0, as LLVM encodes them
  const enc = [INLINE_INT_0, INLINE_INT_0, INLINE_INT_0];
  const used: Operand[] = [];
  for (let i = 0; i < nsrc; i++) {
    let op = srcs[i];
    if (!op && i === 2 && hasImplicitVccSource(info)) op = { type: OperandType.SPECIAL, value: VCC_LO, encoded: VCC_LO };
    const src = requireSource(info, op, i);
    used.push(src);
    enc[i] = vsrc9(src, valuConstKind(info, i), lit);
  }

  let abs = 0;
  let neg = 0;
  srcs.forEach((s, i) => {
    if (s?.abs) abs |= 1 << i;
    if (s?.neg) neg |= 1 << i;
  });
  const opSel = instr.opSel ?? 0;
  const isPermlane = m === 'v_permlane16_b32' || m === 'v_permlanex16_b32';
  if (isB && abs) fail(`${m} does not support abs modifiers (VOP3B encoding)`);
  if (opSel && (isB || !(info.opSel || isPermlane))) fail(`op_sel is not supported by ${m}`);

  const sdst = instr.sdst?.value ?? defaultSdst(info);
  const vdst = info.format === InstructionFormat.VOPC ? sdst : instr.dst.value;
  const roles = ['src0', 'src1', 'src2'] as const;
  checkConstantBus(m, used.map((op, i) => ({ op, enc: enc[i], dwords: operandRegCount(info, roles[i]) })),
    m === 'v_div_fmas_f32');

  const w0 = (0x35 << 26) | ((vop3Opcode(info) & 0x3FF) << 16) | ((instr.clamp ? 1 : 0) << 15) |
    (isB ? (sdst & 0x7F) << 8 : ((opSel & 0xF) << 11) | ((abs & 7) << 8)) | (vdst & 0xFF);
  const w1 = ((neg & 7) << 29) | (((instr.omod ?? 0) & 3) << 27) |
    ((enc[2] & 0x1FF) << 18) | ((enc[1] & 0x1FF) << 9) | (enc[0] & 0x1FF);
  const words = [w0 >>> 0, w1 >>> 0];
  if (lit.value !== undefined) words.push(lit.value);
  return words;
}

/** First dword of the 32-bit VOP1/VOP2/VOPC encodings. */
function e32Word(info: OpcodeInfo, dst: number, vsrc1: number, src0Field: number): number {
  switch (info.format) {
    case InstructionFormat.VOP1:
      return ((0x3F << 25) | ((dst & 0xFF) << 17) | ((info.opcode & 0xFF) << 9) | (src0Field & 0x1FF)) >>> 0;
    case InstructionFormat.VOPC:
      return ((0x3E << 25) | ((info.opcode & 0xFF) << 17) | ((vsrc1 & 0xFF) << 9) | (src0Field & 0x1FF)) >>> 0;
    default:
      return (((info.opcode & 0x3F) << 25) | ((dst & 0xFF) << 17) | ((vsrc1 & 0xFF) << 9) | (src0Field & 0x1FF)) >>> 0;
  }
}

function checkImplicitVccForms(info: OpcodeInfo, instr: ParsedInstruction, encodingName: string): void {
  if (instr.sdst && instr.sdst.value !== defaultSdst(info) && info.format !== InstructionFormat.VOPC) {
    fail(`${encodingName} forms of ${info.mnemonic} always write ${defaultSdst(info) === VCC_LO ? 'vcc_lo' : 'exec_lo'}`);
  }
  if (hasImplicitVccSource(info) && instr.src2 && !(isScalarReg(instr.src2) && instr.src2.value === VCC_LO)) {
    fail(`${encodingName} forms of ${info.mnemonic} always read vcc_lo`);
  }
}

function encodeE32(info: OpcodeInfo, instr: ParsedInstruction): number[] {
  const lit = new LiteralSlot();
  if (info.kLiteral) lit.use(instr.kLiteral ?? 0);
  const nsrc = valuSourceCount(info);
  const src0 = info.operandCount === 0 ? 0 : vsrc9(requireSource(info, instr.src0, 0), valuConstKind(info, 0), lit);
  const vsrc1 = nsrc >= 2 && info.format !== InstructionFormat.VOP1 ? requireSource(info, instr.src1, 1).value : 0;
  const bus = busSources([instr.src0], [src0]);
  if (info.kLiteral) bus.push({ op: undefined, enc: LITERAL_CONST, dwords: 1 });
  checkConstantBus(info.mnemonic, bus, hasImplicitVccSource(info));
  const words = [e32Word(info, info.format === InstructionFormat.VOPC ? 0 : instr.dst.value, vsrc1, src0)];
  if (lit.value !== undefined) words.push(lit.value);
  return words;
}

function encodeDPP(info: OpcodeInfo, instr: ParsedInstruction): number[] {
  const m = info.mnemonic;
  if (info.kLiteral) fail(`${m} cannot use DPP`);
  if (instr.clamp || instr.omod) fail('DPP instructions do not support clamp or output modifiers');
  if (instr.opSel) fail('DPP instructions do not support op_sel');
  checkImplicitVccForms(info, instr, 'DPP');
  const src0 = requireSource(info, instr.src0, 0);
  if (src0.type !== OperandType.VGPR) fail('DPP requires src0 to be a VGPR');
  const nsrc = valuSourceCount(info);
  let vsrc1 = 0;
  if (nsrc >= 2 && info.format !== InstructionFormat.VOP1) {
    const s1 = requireSource(info, instr.src1, 1);
    if (s1.type !== OperandType.VGPR) fail('DPP requires vsrc1 to be a VGPR');
    vsrc1 = s1.value;
  }
  checkSourceModifiers(info, instr);

  let word: number;
  let marker: number;
  if (instr.dpp8) {
    if (sources(instr).some(s => s?.abs || s?.neg)) fail('DPP8 does not support abs/neg modifiers');
    marker = instr.fetchInactive ? SRC_DPP8FI : SRC_DPP8;
    word = src0.value & 0xFF;
    for (let j = 0; j < 8; j++) word |= (instr.dpp8[j] & 7) << (8 + j * 3);
  } else {
    marker = SRC_DPP16;
    word = (src0.value & 0xFF) | (((instr.dppCtrl ?? 0) & 0x1FF) << 8) |
      ((instr.fetchInactive ? 1 : 0) << 18) | ((instr.boundCtrl ? 1 : 0) << 19) |
      ((instr.src0.neg ? 1 : 0) << 20) | ((instr.src0.abs ? 1 : 0) << 21) |
      ((instr.src1?.neg ? 1 : 0) << 22) | ((instr.src1?.abs ? 1 : 0) << 23) |
      (((instr.bankMask ?? 0xF) & 0xF) << 24) | (((instr.rowMask ?? 0xF) & 0xF) << 28);
  }
  return [e32Word(info, instr.dst.value, vsrc1, marker), word >>> 0];
}

/** SDWA operand: VGPR index, or (with the S flag) an SGPR / inline constant. */
function sdwaOperand(info: OpcodeInfo, op: Operand, index: number): { field: number; scalar: boolean } {
  if (op.type === OperandType.VGPR) return { field: op.value & 0xFF, scalar: false };
  if (isScalarReg(op)) return { field: op.value & 0xFF, scalar: true };
  const e = encodeConstant(op, valuConstKind(info, index));
  if (e.literal !== undefined) fail('SDWA instructions cannot use literal constants');
  return { field: e.enc, scalar: true };
}

function encodeSDWA(info: OpcodeInfo, instr: ParsedInstruction): number[] {
  const m = info.mnemonic;
  const isVOPC = info.format === InstructionFormat.VOPC;
  if (info.kLiteral) fail(`${m} cannot use SDWA`);
  if (instr.opSel) fail('SDWA instructions do not support op_sel');
  checkImplicitVccForms(info, instr, 'SDWA');
  checkClamp(info, instr);
  checkSourceModifiers(info, instr);
  if (isVOPC && (instr.clamp || instr.omod || instr.sdwaDstSel !== undefined || instr.sdwaDstUnused !== undefined)) {
    fail('SDWA compares do not support clamp, output modifiers, dst_sel or dst_unused');
  }
  const s0 = sdwaOperand(info, requireSource(info, instr.src0, 0), 0);
  let s1 = { field: 0, scalar: false };
  if (valuSourceCount(info) >= 2 && info.format !== InstructionFormat.VOP1) {
    s1 = sdwaOperand(info, requireSource(info, instr.src1, 1), 1);
  }
  checkConstantBus(m, busSources([instr.src0, instr.src1], [s0.scalar ? s0.field : -1, s1.scalar ? s1.field : -1]),
    hasImplicitVccSource(info));

  let word = s0.field |
    (((instr.sdwaSrc0Sel ?? SDWA_DWORD) & 7) << 16) | ((instr.sdwaSrc0Sext ? 1 : 0) << 19) |
    ((instr.src0.neg ? 1 : 0) << 20) | ((instr.src0.abs ? 1 : 0) << 21) | ((s0.scalar ? 1 : 0) << 23);
  if (info.format !== InstructionFormat.VOP1) {
    word |= (((instr.sdwaSrc1Sel ?? SDWA_DWORD) & 7) << 24) | ((instr.sdwaSrc1Sext ? 1 : 0) << 27) |
      ((instr.src1?.neg ? 1 : 0) << 28) | ((instr.src1?.abs ? 1 : 0) << 29) | ((s1.scalar ? 1 : 0) << 31);
  }
  if (isVOPC) {
    const sdst = instr.sdst?.value ?? defaultSdst(info);
    if (isCmpx(info)) {
      if (sdst !== EXEC_LO) fail(`${m} always writes exec_lo`);
    } else if (sdst !== VCC_LO) {
      word |= ((sdst & 0x7F) << 8) | (1 << 15);
    }
  } else {
    word |= (((instr.sdwaDstSel ?? SDWA_DWORD) & 7) << 8) | (((instr.sdwaDstUnused ?? 0) & 3) << 11) |
      ((instr.clamp ? 1 : 0) << 13) | (((instr.omod ?? 0) & 3) << 14);
  }
  return [e32Word(info, instr.dst.value, s1.field, SRC_SDWA), word >>> 0];
}

/** VOP1/VOP2 instructions that cannot use DPP or SDWA on RDNA2. */
const NO_DPP_OR_SDWA = new Set([
  'v_nop', 'v_readfirstlane_b32', 'v_swap_b32', 'v_swaprel_b32', 'v_mac_legacy_f32', 'v_pipeflush', 'v_clrexcp',
]);
/** Accumulating instructions (vdst is also a source) may use DPP but not SDWA. */
const NO_SDWA = new Set(['v_fmac_f32', 'v_fmac_f16', 'v_mac_f32', 'v_pk_fmac_f16', 'v_dot4c_i32_i8', 'v_dot8c_i32_i4']);
/** 32-bit-only instructions with no VOP3 encoding on RDNA2 (the K-constant forms are checked separately). */
const NO_VOP3 = new Set(['v_swap_b32', 'v_pk_fmac_f16', 'v_dot4c_i32_i8', 'v_dot8c_i32_i4']);
/** VALU instructions without a clamp bit on RDNA2 (bitwise, shifts, moves and lane operations). */
const NO_CLAMP = new Set([
  'v_cndmask_b32', 'v_and_b32', 'v_or_b32', 'v_xor_b32', 'v_xnor_b32', 'v_not_b32', 'v_bfrev_b32', 'v_ffbl_b32',
  'v_lshlrev_b32', 'v_lshrrev_b32', 'v_ashrrev_i32', 'v_lshrrev_b16', 'v_lshlrev_b16', 'v_ashrrev_i16',
  'v_lshlrev_b64', 'v_lshrrev_b64', 'v_ashrrev_i64',
  'v_pk_lshlrev_b16', 'v_pk_lshrrev_b16', 'v_pk_ashrrev_i16', 'v_add_lshl_u32', 'v_lshl_add_u32', 'v_lshl_or_b32',
  'v_and_or_b32', 'v_or3_b32', 'v_xor3_b32', 'v_bfi_b32', 'v_bfm_b32', 'v_perm_b32', 'v_alignbit_b32', 'v_alignbyte_b32',
  'v_bcnt_u32_b32', 'v_mbcnt_lo_u32_b32', 'v_mbcnt_hi_u32_b32', 'v_mov_b32', 'v_swap_b32', 'v_readfirstlane_b32',
  'v_readlane_b32', 'v_writelane_b32', 'v_permlane16_b32', 'v_permlanex16_b32',
  'v_movreld_b32', 'v_movrels_b32', 'v_movrelsd_b32', 'v_movrelsd_2_b32',
]);

function checkClamp(info: OpcodeInfo, instr: ParsedInstruction): void {
  if (instr.clamp && NO_CLAMP.has(info.mnemonic)) fail(`${info.mnemonic} does not support clamp`);
}

function checkDppSdwaAllowed(info: OpcodeInfo, instr: ParsedInstruction): void {
  const m = info.mnemonic;
  const dpp = hasDpp(instr), sdwa = hasSdwa(instr);
  if (!dpp && !sdwa) return;
  if (info.format === InstructionFormat.VOP3) fail(`${m} is a VOP3-only instruction and cannot use DPP or SDWA`);
  if (dpp && sdwa) fail('An instruction cannot use both DPP and SDWA');
  const wide = (['dst', 'src0', 'src1'] as const).some(r => operandRegCount(info, r) > 1);
  if (NO_DPP_OR_SDWA.has(m) || wide) fail(`${m} cannot use DPP or SDWA`);
  if (dpp && info.format === InstructionFormat.VOPC) fail(`VOPC instructions cannot use DPP (${m} may use SDWA)`);
  if (sdwa && NO_SDWA.has(m)) fail(`${m} cannot use SDWA`);
}

function encodeVALU(info: OpcodeInfo, instr: ParsedInstruction): number[] {
  const plan = planEncoding(instr, info);
  checkDppSdwaAllowed(info, instr);
  if (info.mnemonic === 'v_nop' && (plan.kind === 'VOP3A' || plan.kind === 'VOP3B')) {
    // decodeAt reads a VOP3 v_nop as carrying a data dword (Xbox shader binaries)
    fail('v_nop takes no operands or modifiers, and its VOP3 (_e64) encoding is reserved for Xbox binaries, which follow it with a data dword');
  }
  if (plan.extra === 'DPP8' || plan.extra === 'DPP16') return encodeDPP(info, instr);
  if (plan.extra === 'SDWA') return encodeSDWA(info, instr);
  if (plan.kind === 'VOP3A' || plan.kind === 'VOP3B') return encodeVOP3(info, instr);
  return encodeE32(info, instr);
}

function encodeVOP3P(info: OpcodeInfo, instr: ParsedInstruction): number[] {
  const m = info.mnemonic;
  const isMix = m.startsWith('v_fma_mix');
  const nsrc = valuSourceCount(info);
  const srcs = sources(instr);
  if (hasDpp(instr) || hasSdwa(instr)) fail(`${m} cannot use DPP or SDWA`);
  if (instr.omod) fail(`${m} does not support output modifiers`);
  checkClamp(info, instr);

  let opSelHi = instr.opSelHi ?? (isMix ? 0 : 7);
  const opSel = instr.opSel ?? 0;
  let negLo = instr.negLo ?? 0;
  let negHi = instr.negHi ?? 0;
  srcs.forEach((s, i) => {
    if (!s) return;
    if (isMix || (info.dot === 'f16' && i === 2)) {
      // v_fma_mix sources and the f32 src2 of v_dot2_f32_f16: neg_lo negates, neg_hi takes the absolute value
      if (s.neg) negLo |= 1 << i;
      if (s.abs) negHi |= 1 << i;
    } else {
      if (s.abs) fail(`${m} does not support abs modifiers`);
      if (s.neg) {
        negLo |= 1 << i;
        negHi |= 1 << i;
      }
    }
  });
  if (info.isIntegerOp && (negLo || negHi)) fail(`neg modifiers are only valid on floating-point packed instructions (${m})`);

  const lit = new LiteralSlot();
  const enc = [INLINE_INT_0, INLINE_INT_0, INLINE_INT_0];
  for (let i = 0; i < nsrc; i++) {
    enc[i] = vsrc9(requireSource(info, srcs[i], i), valuConstKind(info, i, opSelHi), lit);
  }
  checkConstantBus(m, busSources(srcs.slice(0, nsrc), enc), false);

  const w0 = (0xCC << 24) | ((info.opcode & 0x7F) << 16) | ((instr.clamp ? 1 : 0) << 15) |
    (((opSelHi >> 2) & 1) << 14) | ((opSel & 7) << 11) | ((negHi & 7) << 8) | (instr.dst.value & 0xFF);
  const w1 = ((negLo & 7) << 29) | ((opSelHi & 3) << 27) |
    ((enc[2] & 0x1FF) << 18) | ((enc[1] & 0x1FF) << 9) | (enc[0] & 0x1FF);
  const words = [w0 >>> 0, w1 >>> 0];
  if (lit.value !== undefined) words.push(lit.value);
  return words;
}

// ── Scalar encodings ──

/** Width of scalar operand `which` (0 = src0, 1 = src1) for constant conversion. */
function saluConstKind(info: OpcodeInfo, which: 0 | 1): ConstKind {
  const width = which === 0 ? (info.salu?.s0 ?? (info.mnemonic.endsWith('_b64') ? 64 : 32)) : (info.salu?.s1 ?? 32);
  if (width !== 64) return 'b32';
  return which === 0 && /_i64$/.test(info.mnemonic) ? 'i64' : 'u64';
}

function sdstField(op: Operand, mnemonic: string): number {
  if (!isScalarReg(op)) fail(`${mnemonic}: the destination must be a scalar register`);
  return op.value & 0x7F;
}

function encodeSOP1(info: OpcodeInfo, instr: ParsedInstruction): number[] {
  const m = info.mnemonic;
  const lit = new LiteralSlot();
  let sdst = 0;
  let ssrc0 = 0;
  if (m === 's_getpc_b64') {
    sdst = sdstField(instr.dst, m);
  } else if (m === 's_setpc_b64') {
    ssrc0 = ssrc8(instr.src0, 'u64', lit, m);
  } else {
    sdst = sdstField(instr.dst, m);
    ssrc0 = ssrc8(instr.src0, saluConstKind(info, 0), lit, m);
  }
  const words = [((0x17D << 23) | (sdst << 16) | ((info.opcode & 0xFF) << 8) | (ssrc0 & 0xFF)) >>> 0];
  if (lit.value !== undefined) words.push(lit.value);
  return words;
}

function encodeSOP2(info: OpcodeInfo, instr: ParsedInstruction): number[] {
  const m = info.mnemonic;
  const lit = new LiteralSlot();
  const sdst = sdstField(instr.dst, m);
  const ssrc0 = ssrc8(instr.src0, saluConstKind(info, 0), lit, m);
  const ssrc1 = ssrc8(requireSource(info, instr.src1, 1), saluConstKind(info, 1), lit, m);
  const words = [((0b10 << 30) | ((info.opcode & 0x7F) << 23) | (sdst << 16) | (ssrc1 << 8) | ssrc0) >>> 0];
  if (lit.value !== undefined) words.push(lit.value);
  return words;
}

function encodeSOPC(info: OpcodeInfo, instr: ParsedInstruction): number[] {
  const m = info.mnemonic;
  const lit = new LiteralSlot();
  const ssrc0 = ssrc8(instr.src0, saluConstKind(info, 0), lit, m);
  const ssrc1 = ssrc8(requireSource(info, instr.src1, 1), saluConstKind(info, 1), lit, m);
  const words = [((0x17E << 23) | ((info.opcode & 0x7F) << 16) | (ssrc1 << 8) | ssrc0) >>> 0];
  if (lit.value !== undefined) words.push(lit.value);
  return words;
}

function encodeSOPK(info: OpcodeInfo, instr: ParsedInstruction): number[] {
  const m = info.mnemonic;
  const sdst = m === 's_setreg_imm32_b32' ? 0 : sdstField(instr.dst, m);
  const words = [((0xB << 28) | ((info.opcode & 0x1F) << 23) | (sdst << 16) | ((instr.simm16 ?? 0) & 0xFFFF)) >>> 0];
  if (m === 's_setreg_imm32_b32') words.push((instr.kLiteral ?? 0) >>> 0);
  return words;
}

function encodeSOPP(info: OpcodeInfo, instr: ParsedInstruction): number[] {
  return [((0x17F << 23) | ((info.opcode & 0x7F) << 16) | ((instr.simm16 ?? 0) & 0xFFFF)) >>> 0];
}

function encodeDS(info: OpcodeInfo, instr: ParsedInstruction): number[] {
  const m = info.mnemonic;
  const offset = instr.offset ?? 0;
  const vgpr = (op: Operand | undefined, what: string): number => {
    if (!op || op.type !== OperandType.VGPR) fail(`${m}: ${what} must be a VGPR`);
    return op.value & 0xFF;
  };
  let vdst = 0;
  let addr = 0;
  let data0 = 0;
  let data1 = 0;
  if (m.startsWith('ds_write')) {
    addr = vgpr(instr.src0, 'the address');
    data0 = vgpr(instr.src1, 'the data');
    if (m === 'ds_write2st64_b32') data1 = vgpr(instr.src2, 'the second data operand');
  } else {
    vdst = vgpr(instr.dst, 'the destination');
    addr = vgpr(instr.src0, 'the address');
    if (m === 'ds_permute_b32' || m === 'ds_bpermute_b32') data0 = vgpr(instr.src1, 'the data');
  }
  const w0 = (0x36 << 26) | ((info.opcode & 0xFF) << 18) | (((offset >>> 8) & 0xFF) << 8) | (offset & 0xFF);
  const w1 = (vdst << 24) | (data1 << 16) | (data0 << 8) | addr;
  return [w0 >>> 0, w1 >>> 0];
}

/**
 * Encode a single parsed instruction into machine words.
 * Throws EncodingError for operand combinations the hardware cannot encode.
 */
export function encodeInstruction(instr: ParsedInstruction): number[] {
  const info = lookupByMnemonic(instr.mnemonic);
  if (!info) fail(`Unknown instruction '${instr.mnemonic}'`);
  switch (info.format) {
    case InstructionFormat.VOP1:
    case InstructionFormat.VOP2:
    case InstructionFormat.VOPC:
    case InstructionFormat.VOP3:
      return encodeVALU(info, instr);
    case InstructionFormat.VOP3P: return encodeVOP3P(info, instr);
    case InstructionFormat.SOP1: return encodeSOP1(info, instr);
    case InstructionFormat.SOP2: return encodeSOP2(info, instr);
    case InstructionFormat.SOPC: return encodeSOPC(info, instr);
    case InstructionFormat.SOPK: return encodeSOPK(info, instr);
    case InstructionFormat.SOPP: return encodeSOPP(info, instr);
    case InstructionFormat.DS: return encodeDS(info, instr);
    default:
      return fail(`${info.format} instructions are not supported by the emulator`);
  }
}

/** Assemble a list of parsed instructions into a binary stream. */
export function assembleToBinary(instructions: ParsedInstruction[]): Uint32Array {
  const words: number[] = [];
  for (const instr of instructions) words.push(...encodeInstruction(instr));
  return new Uint32Array(words);
}

// ── Decoder ──

/** Detect the encoding format of the first dword of an instruction. */
export function detectFormat(word: number): InstructionFormat {
  word >>>= 0;
  if ((word >>> 31) === 0) {
    const prefix7 = word >>> 25;
    if (prefix7 === 0x3F) return InstructionFormat.VOP1;
    if (prefix7 === 0x3E) return InstructionFormat.VOPC;
    return InstructionFormat.VOP2;
  }
  if ((word >>> 30) === 0b10) {
    const prefix9 = word >>> 23;
    if (prefix9 === 0x17F) return InstructionFormat.SOPP;
    if (prefix9 === 0x17E) return InstructionFormat.SOPC;
    if (prefix9 === 0x17D) return InstructionFormat.SOP1;
    if ((word >>> 28) === 0xB) return InstructionFormat.SOPK;
    return InstructionFormat.SOP2;
  }
  switch (word >>> 26) {
    case 0x32: return InstructionFormat.VINTRP;
    case 0x33: return InstructionFormat.VOP3P;
    case 0x35: return InstructionFormat.VOP3;
    case 0x36: return InstructionFormat.DS;
    case 0x37: return InstructionFormat.FLAT;
    case 0x38: return InstructionFormat.MUBUF;
    case 0x3A: return InstructionFormat.MTBUF;
    case 0x3C: return InstructionFormat.MIMG;
    case 0x3D: return InstructionFormat.SMEM;
    case 0x3E: return InstructionFormat.EXP;
    default: return InstructionFormat.UNKNOWN;
  }
}

/** VOP3 opcodes that use the VOP3B layout (scalar destination in place of ABS/OP_SEL). */
const VOP3B_OPCODES = new Set([0x128, 0x129, 0x12A, 0x16D, 0x16E, 0x176, 0x177, 0x30F, 0x310, 0x319]);

function parseDpp16(d: DecodedInstruction, x: number): void {
  d.src0Encoded = VGPR_SRC_MIN + (x & 0xFF);
  d.dppCtrl = (x >>> 8) & 0x1FF;
  d.fetchInactive = !!((x >>> 18) & 1);
  d.boundCtrl = !!((x >>> 19) & 1);
  d.src0Neg = !!((x >>> 20) & 1);
  d.src0Abs = !!((x >>> 21) & 1);
  d.src1Neg = !!((x >>> 22) & 1);
  d.src1Abs = !!((x >>> 23) & 1);
  d.bankMask = (x >>> 24) & 0xF;
  d.rowMask = (x >>> 28) & 0xF;
}

function parseDpp8(d: DecodedInstruction, x: number): void {
  d.src0Encoded = VGPR_SRC_MIN + (x & 0xFF);
  d.dpp8 = [];
  for (let j = 0; j < 8; j++) d.dpp8.push((x >>> (8 + j * 3)) & 7);
}

function parseSdwa(d: DecodedInstruction, x: number, vsrc1Field: number, info: OpcodeInfo | undefined): void {
  const isVOPC = d.format === InstructionFormat.VOPC;
  d.src0Encoded = ((x >>> 23) & 1) ? (x & 0xFF) : VGPR_SRC_MIN + (x & 0xFF);
  d.sdwaSrc0Sel = (x >>> 16) & 7;
  d.sdwaSrc0Sext = !!((x >>> 19) & 1);
  d.src0Neg = !!((x >>> 20) & 1);
  d.src0Abs = !!((x >>> 21) & 1);
  if (d.format !== InstructionFormat.VOP1) {
    d.src1 = ((x >>> 31) & 1) ? vsrc1Field : VGPR_SRC_MIN + vsrc1Field;
    d.sdwaSrc1Sel = (x >>> 24) & 7;
    d.sdwaSrc1Sext = !!((x >>> 27) & 1);
    d.src1Neg = !!((x >>> 28) & 1);
    d.src1Abs = !!((x >>> 29) & 1);
  }
  if (isVOPC) {
    if ((x >>> 15) & 1) d.sdst = (x >>> 8) & 0x7F;
    else d.sdst = info && isCmpx(info) ? EXEC_LO : VCC_LO;
  } else {
    d.sdwaDstSel = (x >>> 8) & 7;
    d.sdwaDstUnused = (x >>> 11) & 3;
    if ((x >>> 13) & 1) d.clamp = true;
    if ((x >>> 14) & 3) d.omod = (x >>> 14) & 3;
  }
}

/** Decode one instruction starting at dword `i`. */
function decodeAt(bin: Uint32Array, i: number): DecodedInstruction {
  const w = bin[i] >>> 0;
  const remaining = bin.length - i;
  const word = (k: number): number | undefined => (k < remaining ? bin[i + k] >>> 0 : undefined);
  const format = detectFormat(w);
  const d: DecodedInstruction = { format, opcode: 0, dst: 0, src0Encoded: 0, address: i, size: 1, encoding: 'UNKNOWN' };
  const finish = (size: number): DecodedInstruction => {
    d.size = Math.max(1, Math.min(size, remaining));
    return d;
  };

  switch (format) {
    case InstructionFormat.VOP1:
    case InstructionFormat.VOP2:
    case InstructionFormat.VOPC: {
      d.encoding = format;
      const src0 = w & 0x1FF;
      let vsrc1 = 0;
      if (format === InstructionFormat.VOP1) {
        d.dst = (w >>> 17) & 0xFF;
        d.opcode = (w >>> 9) & 0xFF;
      } else if (format === InstructionFormat.VOP2) {
        d.opcode = (w >>> 25) & 0x3F;
        d.dst = (w >>> 17) & 0xFF;
        vsrc1 = (w >>> 9) & 0xFF;
      } else {
        d.opcode = (w >>> 17) & 0xFF;
        vsrc1 = (w >>> 9) & 0xFF;
      }
      const info = lookupByOpcode(format, d.opcode);
      d.src0Encoded = src0;
      if (format !== InstructionFormat.VOP1) d.src1 = VGPR_SRC_MIN + vsrc1;
      if (format === InstructionFormat.VOPC) d.sdst = info && isCmpx(info) ? EXEC_LO : VCC_LO;
      if (info && hasImplicitVccSource(info)) d.src2 = VCC_LO;
      if (info?.carry) d.sdst = VCC_LO;

      const extra = word(1);
      if (src0 === SRC_DPP16) {
        d.extra = 'DPP16';
        parseDpp16(d, extra ?? 0);
        return finish(2);
      }
      if (src0 === SRC_DPP8 || src0 === SRC_DPP8FI) {
        d.extra = 'DPP8';
        parseDpp8(d, extra ?? 0);
        if (src0 === SRC_DPP8FI) d.fetchInactive = true;
        return finish(2);
      }
      if (src0 === SRC_SDWA) {
        d.extra = 'SDWA';
        parseSdwa(d, extra ?? 0, vsrc1, info);
        return finish(2);
      }
      if (src0 === LITERAL_CONST || info?.kLiteral) {
        d.extra = 'LITERAL';
        d.literal = extra;
        return finish(2);
      }
      return finish(1);
    }

    case InstructionFormat.VOP3: {
      const w1 = word(1) ?? 0;
      const op = (w >>> 16) & 0x3FF;
      let fmt: InstructionFormat;
      let base: number;
      if (op < 0x100) { fmt = InstructionFormat.VOPC; base = op; }
      else if (op < 0x140) { fmt = InstructionFormat.VOP2; base = op - VOP3_VOP2_OFFSET; }
      else if (op < 0x180) { fmt = InstructionFormat.VOP3; base = op; }
      else if (op < 0x200) { fmt = InstructionFormat.VOP1; base = op - VOP3_VOP1_OFFSET; }
      else { fmt = InstructionFormat.VOP3; base = op; }
      const info = lookupByOpcode(fmt, base);
      const isB = info ? (!!info.vop3b || (fmt === InstructionFormat.VOP2 && !!info.carry)) : VOP3B_OPCODES.has(op);
      d.format = fmt;
      d.opcode = base;
      d.vop3 = true;
      d.encoding = isB ? 'VOP3B' : 'VOP3A';
      d.dst = w & 0xFF;
      if (isB) {
        d.sdst = (w >>> 8) & 0x7F;
      } else {
        const abs = (w >>> 8) & 7;
        if (abs & 1) d.src0Abs = true;
        if (abs & 2) d.src1Abs = true;
        if (abs & 4) d.src2Abs = true;
        const opSel = (w >>> 11) & 0xF;
        if (opSel) d.opSel = opSel;
      }
      if (fmt === InstructionFormat.VOPC) d.sdst = d.dst;
      if ((w >>> 15) & 1) d.clamp = true;
      d.src0Encoded = w1 & 0x1FF;
      d.src1 = (w1 >>> 9) & 0x1FF;
      d.src2 = (w1 >>> 18) & 0x1FF;
      const omod = (w1 >>> 27) & 3;
      if (omod) d.omod = omod;
      const neg = (w1 >>> 29) & 7;
      if (neg & 1) d.src0Neg = true;
      if (neg & 2) d.src1Neg = true;
      if (neg & 4) d.src2Neg = true;

      // Xbox binaries follow a VOP3-encoded v_nop with an extra data dword
      if (op === VOP3_VOP1_OFFSET) {
        d.literal = word(2);
        if (d.literal !== undefined) d.extra = 'LITERAL';
        return finish(d.literal !== undefined ? 3 : 2);
      }
      const nsrc = info ? valuSourceCount(info) : 3;
      const fields = [d.src0Encoded, d.src1, d.src2].slice(0, nsrc);
      if (fields.includes(LITERAL_CONST)) {
        d.extra = 'LITERAL';
        d.literal = word(2);
        return finish(3);
      }
      return finish(2);
    }

    case InstructionFormat.VOP3P: {
      const w1 = word(1) ?? 0;
      d.encoding = 'VOP3P';
      d.opcode = (w >>> 16) & 0x7F;
      d.dst = w & 0xFF;
      d.negHi = (w >>> 8) & 7;
      d.opSel = (w >>> 11) & 7;
      d.opSelHi = ((w1 >>> 27) & 3) | (((w >>> 14) & 1) << 2);
      if ((w >>> 15) & 1) d.clamp = true;
      d.src0Encoded = w1 & 0x1FF;
      d.src1 = (w1 >>> 9) & 0x1FF;
      d.src2 = (w1 >>> 18) & 0x1FF;
      const negLo = (w1 >>> 29) & 7;
      if (negLo & 1) d.src0Neg = true;
      if (negLo & 2) d.src1Neg = true;
      if (negLo & 4) d.src2Neg = true;
      const info = lookupByOpcode(format, d.opcode);
      const nsrc = info ? valuSourceCount(info) : 3;
      if ([d.src0Encoded, d.src1, d.src2].slice(0, nsrc).includes(LITERAL_CONST)) {
        d.extra = 'LITERAL';
        d.literal = word(2);
        return finish(3);
      }
      return finish(2);
    }

    case InstructionFormat.SOP1:
    case InstructionFormat.SOP2:
    case InstructionFormat.SOPC: {
      d.encoding = format;
      if (format === InstructionFormat.SOP1) {
        d.dst = (w >>> 16) & 0x7F;
        d.opcode = (w >>> 8) & 0xFF;
        d.src0Encoded = w & 0xFF;
      } else {
        d.opcode = format === InstructionFormat.SOP2 ? (w >>> 23) & 0x7F : (w >>> 16) & 0x7F;
        if (format === InstructionFormat.SOP2) d.dst = (w >>> 16) & 0x7F;
        d.src0Encoded = w & 0xFF;
        d.src1 = (w >>> 8) & 0xFF;
      }
      if (d.src0Encoded === LITERAL_CONST || d.src1 === LITERAL_CONST) {
        d.extra = 'LITERAL';
        d.literal = word(1);
        return finish(2);
      }
      return finish(1);
    }

    case InstructionFormat.SOPK: {
      d.encoding = 'SOPK';
      d.opcode = (w >>> 23) & 0x1F;
      d.dst = (w >>> 16) & 0x7F;
      d.simm16 = w & 0xFFFF;
      if (d.opcode === 0x15) { // s_setreg_imm32_b32 carries a 32-bit immediate
        d.extra = 'LITERAL';
        d.literal = word(1);
        return finish(2);
      }
      return finish(1);
    }

    case InstructionFormat.SOPP:
      d.encoding = 'SOPP';
      d.opcode = (w >>> 16) & 0x7F;
      d.simm16 = w & 0xFFFF;
      return finish(1);

    case InstructionFormat.DS: {
      const w1 = word(1) ?? 0;
      d.encoding = 'DS';
      d.opcode = (w >>> 18) & 0xFF;
      d.offset = w & 0xFFFF;
      d.src0Encoded = w1 & 0xFF;          // ADDR (VGPR index)
      d.src1 = (w1 >>> 8) & 0xFF;         // DATA0
      d.src2 = (w1 >>> 16) & 0xFF;        // DATA1
      d.dst = (w1 >>> 24) & 0xFF;         // VDST
      return finish(2);
    }

    case InstructionFormat.SMEM: {
      const w1 = word(1) ?? 0;
      d.encoding = 'SMEM';
      d.opcode = (w >>> 18) & 0xFF;
      d.dst = (w >>> 6) & 0x7F;
      d.sbase = w & 0x3F;
      d.offset = w1 & 0x1FFFFF;
      return finish(2);
    }

    case InstructionFormat.MUBUF:
    case InstructionFormat.MTBUF: {
      const w1 = word(1) ?? 0;
      d.encoding = format;
      d.opcode = format === InstructionFormat.MUBUF ? (w >>> 18) & 0x7F : (w >>> 16) & 0x7;
      d.offset = w & 0xFFF;
      d.flags = (((w >>> 14) & 1) << 2) | (((w >>> 13) & 1) << 1) | ((w >>> 12) & 1);
      d.src0Encoded = w1 & 0xFF;
      d.dst = (w1 >>> 8) & 0xFF;
      d.srsrc = (w1 >>> 16) & 0x1F;
      return finish(2);
    }

    case InstructionFormat.MIMG: {
      const w1 = word(1) ?? 0;
      d.encoding = 'MIMG';
      d.opcode = ((w >>> 18) & 0x7F) | (((w >>> 0) & 1) << 7);
      d.dmask = (w >>> 8) & 0xF;
      d.src0Encoded = w1 & 0xFF;
      d.dst = (w1 >>> 8) & 0xFF;
      d.srsrc = (w1 >>> 16) & 0x1F;
      d.ssamp = (w1 >>> 21) & 0x1F;
      return finish(2 + ((w >>> 1) & 3));
    }

    case InstructionFormat.FLAT:
    case InstructionFormat.EXP:
      d.encoding = format;
      d.opcode = format === InstructionFormat.FLAT ? (w >>> 18) & 0x7F : 0;
      return finish(2);

    case InstructionFormat.VINTRP:
      d.encoding = 'VINTRP';
      d.opcode = (w >>> 16) & 0x3;
      return finish(1);

    default:
      return finish(1);
  }
}

/** Decode a binary stream into instructions. */
export function decodeBinary(binary: Uint32Array): DecodedInstruction[] {
  const instructions: DecodedInstruction[] = [];
  let i = 0;
  while (i < binary.length) {
    const d = decodeAt(binary, i);
    instructions.push(d);
    i += d.size;
  }
  return instructions;
}

// ── Disassembler ──

const SEL_NAMES = ['BYTE_0', 'BYTE_1', 'BYTE_2', 'BYTE_3', 'WORD_0', 'WORD_1', 'DWORD'];
const UNUSED_NAMES = ['UNUSED_PAD', 'UNUSED_SEXT', 'UNUSED_PRESERVE'];
const INLINE_FLOAT_NAMES: Record<number, string> = {
  240: '0.5', 241: '-0.5', 242: '1.0', 243: '-1.0', 244: '2.0', 245: '-2.0', 246: '4.0', 247: '-4.0',
  248: '0.15915494309189535',
};

function hex(v: number, pad = 0): string {
  return '0x' + (v >>> 0).toString(16).padStart(pad, '0');
}

/** Name of a scalar operand encoding (0–127, 251–254). */
export function scalarRegName(enc: number, width: 32 | 64 = 32): string {
  if (enc <= 105) return width === 64 ? `s[${enc}:${enc + 1}]` : `s${enc}`;
  if (enc === 106) return width === 64 ? 'vcc' : 'vcc_lo';
  if (enc === 107) return 'vcc_hi';
  if (enc >= 108 && enc <= 123) {
    const t = enc - 108;
    return width === 64 ? `ttmp[${t}:${t + 1}]` : `ttmp${t}`;
  }
  if (enc === 124) return 'm0';
  if (enc === 125) return 'null';
  if (enc === 126) return width === 64 ? 'exec' : 'exec_lo';
  if (enc === 127) return 'exec_hi';
  if (enc === 251) return 'src_vccz';
  if (enc === 252) return 'src_execz';
  if (enc === 253) return 'src_scc';
  if (enc === 254) return 'src_lds_direct';
  return `src(${enc})`;
}

function floatText(v: number): string {
  if (Object.is(v, -0)) return '-0.0';
  const s = String(v);
  return /[.eE]/.test(s) || !Number.isFinite(v) ? s : `${s}.0`;
}

function literalText(literal: number | undefined, kind: ConstKind): string {
  if (literal === undefined) return '<missing literal>';
  const bits = literal >>> 0;
  if (kind === 'f32') {
    const f = bitsToF32(bits);
    const text = floatText(f);
    if (Number.isFinite(f) && Math.abs(f) < 1e15 && (f === 0 || Math.abs(f) >= 1e-6) && f32Bits(Number(text)) === bits) {
      return text;
    }
  } else if (kind === 'f16' && bits <= 0xFFFF) {
    const f = f16ToF32(bits);
    const text = floatText(f);
    if (Number.isFinite(f) && f32ToF16(Number(text)) === bits) return text;
  } else if (kind === 'i16' && bits > 0xFFFF) {
    // A 16-bit integer operand only accepts a wider literal as a float's f32 bit pattern
    const f = bitsToF32(bits);
    const text = floatText(f);
    if (Number.isFinite(f) && f32Bits(Number(text)) === bits) return text;
  }
  return hex(bits);
}

/** Text for a 9-bit (VALU) or 8-bit (SALU) source encoding. */
function sourceText(enc: number, literal: number | undefined, kind: ConstKind, regCount = 1): string {
  if (enc >= VGPR_SRC_MIN) {
    const v = enc - VGPR_SRC_MIN;
    return regCount > 1 ? `v[${v}:${v + regCount - 1}]` : `v${v}`;
  }
  if (enc === LITERAL_CONST) return literalText(literal, kind);
  if (enc >= 128 && enc <= 192) return String(enc - 128);
  if (enc >= 193 && enc <= 208) return String(192 - enc);
  if (enc in INLINE_FLOAT_NAMES) return INLINE_FLOAT_NAMES[enc];
  return scalarRegName(enc, regCount > 1 ? 64 : 32);
}

function vgprText(index: number, count = 1): string {
  return count > 1 ? `v[${index}:${index + count - 1}]` : `v${index}`;
}

function withModifiers(text: string, abs?: boolean, neg?: boolean): string {
  if (abs) text = `|${text}|`;
  return neg ? `-${text}` : text;
}

function dppCtrlText(ctrl: number): string {
  if (ctrl <= 0xFF) return `quad_perm:[${ctrl & 3},${(ctrl >>> 2) & 3},${(ctrl >>> 4) & 3},${(ctrl >>> 6) & 3}]`;
  if (ctrl >= 0x101 && ctrl <= 0x10F) return `row_shl:${ctrl & 0xF}`;
  if (ctrl >= 0x111 && ctrl <= 0x11F) return `row_shr:${ctrl & 0xF}`;
  if (ctrl >= 0x121 && ctrl <= 0x12F) return `row_ror:${ctrl & 0xF}`;
  if (ctrl === 0x140) return 'row_mirror';
  if (ctrl === 0x141) return 'row_half_mirror';
  if (ctrl >= 0x150 && ctrl <= 0x15F) return `row_share:${ctrl & 0xF}`;
  if (ctrl >= 0x160 && ctrl <= 0x16F) return `row_xmask:${ctrl & 0xF}`;
  return `dpp_ctrl:${hex(ctrl)}`;
}

/** Human-readable name of a DPP16 control value. */
export function describeDppCtrl(ctrl: number): string {
  return dppCtrlText(ctrl);
}

/** Short name of a 9-bit VALU (or 8-bit SALU) source field value, for encoding diagrams. */
export function sourceFieldName(enc: number): string {
  if (enc === LITERAL_CONST) return 'literal';
  if (enc === SRC_DPP16) return 'DPP16';
  if (enc === SRC_DPP8) return 'DPP8';
  if (enc === SRC_DPP8FI) return 'DPP8 FI';
  if (enc === SRC_SDWA) return 'SDWA';
  return sourceText(enc, undefined, 'b32');
}

function bitList(bits: number, count: number): string {
  const parts: number[] = [];
  for (let i = 0; i < count; i++) parts.push((bits >> i) & 1);
  return `[${parts.join(',')}]`;
}

function disassembleVALU(d: DecodedInstruction, info: OpcodeInfo): string {
  const m = info.mnemonic;
  if (m === 'v_nop') {
    if (d.size <= 1) return 'v_nop';
    // VOP3 (Xbox data dword), DPP, SDWA and literal forms take several dwords, but the assembler only
    // accepts the plain 32-bit v_nop: emit one per dword so that re-assembled code keeps its layout
    // (and raw branch offsets) and behaves the same
    const form = d.vop3 ? 'VOP3' : d.extra === 'LITERAL' ? 'literal-operand' : d.extra ?? 'multi-dword';
    const extra = d.literal !== undefined ? `, extra dword ${hex(d.literal, 8)}` : '';
    return [`v_nop ; ${form} v_nop (${d.size} dwords${extra}), shown as ${d.size} × v_nop`,
      ...Array<string>(d.size - 1).fill('v_nop')].join('\n');
  }
  // VOP3-encoded VOP1/VOP2/VOPC instructions carry the _e64 suffix, as LLVM prints them
  const name = d.vop3 && info.format !== InstructionFormat.VOP3 ? `${m}_e64` : m;
  const nsrc = valuSourceCount(info);
  const isVOP3P = info.format === InstructionFormat.VOP3P;
  const isMix = m.startsWith('v_fma_mix');
  const srcEnc = [d.src0Encoded, d.src1 ?? 0, d.src2 ?? 0];
  const srcAbs = [d.src0Abs, d.src1Abs, d.src2Abs];
  const srcNeg = [d.src0Neg, d.src1Neg, d.src2Neg];
  const roles = ['src0', 'src1', 'src2'] as const;
  const ops: string[] = [];

  // Destination(s)
  if (info.format === InstructionFormat.VOPC) {
    ops.push(scalarRegName(d.sdst ?? VCC_LO));
  } else {
    const scalarDst = m === 'v_readlane_b32' || m === 'v_readfirstlane_b32';
    ops.push(scalarDst ? scalarRegName(d.dst) : vgprText(d.dst, operandRegCount(info, 'dst')));
    if (info.carry || info.vop3b) ops.push(scalarRegName(d.sdst ?? VCC_LO));
  }

  // Sources
  const srcText: string[] = [];
  for (let i = 0; i < nsrc; i++) {
    const kind = valuConstKind(info, i, d.opSelHi ?? 0);
    let text = sourceText(srcEnc[i], d.literal, kind, operandRegCount(info, roles[i]));
    if (isVOP3P) {
      if (isMix) text = withModifiers(text, d.negHi !== undefined && !!((d.negHi >> i) & 1), srcNeg[i]);
    } else {
      text = withModifiers(text, srcAbs[i], srcNeg[i]);
    }
    srcText.push(text);
  }
  if (info.kLiteral && !d.vop3) {
    const k = literalText(d.literal, valuConstKind(info, info.kLiteral === 'mk' ? 1 : 2));
    if (info.kLiteral === 'mk') srcText.splice(1, 0, k);
    else srcText.push(k);
  }
  ops.push(...srcText);

  // Modifiers
  const mods: string[] = [];
  if (isVOP3P) {
    // The 8- and 4-bit dot products read whole dwords and take no op_sel or neg modifiers
    if (hasPackedModifiers(info)) {
      const allSources = (1 << nsrc) - 1;
      if (d.opSel) mods.push(`op_sel:${bitList(d.opSel, nsrc)}`);
      const hi = d.opSelHi ?? (isMix ? 0 : 7);
      if (isMix ? (hi & allSources) !== 0 : (hi & allSources) !== allSources) mods.push(`op_sel_hi:${bitList(hi, nsrc)}`);
      if (!isMix) {
        const negLo = (d.src0Neg ? 1 : 0) | (d.src1Neg ? 2 : 0) | (d.src2Neg ? 4 : 0);
        if (negLo) mods.push(`neg_lo:${bitList(negLo, nsrc)}`);
        if (d.negHi) mods.push(`neg_hi:${bitList(d.negHi, nsrc)}`);
      }
    }
  } else if (d.opSel) {
    if (m === 'v_permlane16_b32' || m === 'v_permlanex16_b32') {
      mods.push(`op_sel:${bitList(d.opSel, 2)}`);
    } else {
      // VOP3 op_sel lists the sources followed by the destination (bit 3)
      const entries: number[] = [];
      for (let i = 0; i < nsrc; i++) entries.push((d.opSel >> i) & 1);
      entries.push((d.opSel >> 3) & 1);
      mods.push(`op_sel:[${entries.join(',')}]`);
    }
  }
  if (d.clamp) mods.push('clamp');
  if (d.omod === 1) mods.push('mul:2');
  if (d.omod === 2) mods.push('mul:4');
  if (d.omod === 3) mods.push('div:2');
  if (d.extra === 'DPP16') {
    mods.push(dppCtrlText(d.dppCtrl ?? 0));
    if ((d.rowMask ?? 0xF) !== 0xF) mods.push(`row_mask:${hex(d.rowMask ?? 0)}`);
    if ((d.bankMask ?? 0xF) !== 0xF) mods.push(`bank_mask:${hex(d.bankMask ?? 0)}`);
    if (d.boundCtrl) mods.push('bound_ctrl:1');
    if (d.fetchInactive) mods.push('fi:1');
  } else if (d.extra === 'DPP8') {
    mods.push(`dpp8:[${(d.dpp8 ?? []).join(',')}]`);
    if (d.fetchInactive) mods.push('fi:1');
  } else if (d.extra === 'SDWA') {
    if (info.format !== InstructionFormat.VOPC) {
      mods.push(`dst_sel:${SEL_NAMES[d.sdwaDstSel ?? 6] ?? 'DWORD'}`);
      mods.push(`dst_unused:${UNUSED_NAMES[d.sdwaDstUnused ?? 0] ?? 'UNUSED_PAD'}`);
    }
    mods.push(`src0_sel:${SEL_NAMES[d.sdwaSrc0Sel ?? 6] ?? 'DWORD'}`);
    if (d.sdwaSrc0Sext) mods.push('src0_sext');
    if (info.format !== InstructionFormat.VOP1) {
      mods.push(`src1_sel:${SEL_NAMES[d.sdwaSrc1Sel ?? 6] ?? 'DWORD'}`);
      if (d.sdwaSrc1Sext) mods.push('src1_sext');
    }
  }
  return `${name} ${ops.join(', ')}${mods.length ? ' ' + mods.join(' ') : ''}`;
}

const SOP1_SPECIAL_WIDTHS: Record<string, [32 | 64, 32 | 64]> = {
  s_getpc_b64: [64, 64],
  s_setpc_b64: [64, 64],
  s_swappc_b64: [64, 64],
  s_and_saveexec_b64: [64, 64],
  s_or_saveexec_b64: [64, 64],
  s_movrels_b64: [64, 64],
  s_movreld_b64: [64, 64],
};

function scalarWidth(w: number | undefined): 32 | 64 {
  return w === 64 ? 64 : 32;
}

function waitcntText(simm: number): string {
  // Bits outside the counter fields can only be expressed as a raw value
  if (simm & ~0xFF7F) return `s_waitcnt ${hex(simm)}`;
  const vmcnt = (((simm >>> 14) & 3) << 4) | (simm & 0xF);
  const expcnt = (simm >>> 4) & 7;
  const lgkmcnt = (simm >>> 8) & 0x3F;
  const parts: string[] = [];
  if (vmcnt !== 63) parts.push(`vmcnt(${vmcnt})`);
  if (expcnt !== 7) parts.push(`expcnt(${expcnt})`);
  if (lgkmcnt !== 63) parts.push(`lgkmcnt(${lgkmcnt})`);
  return parts.length ? `s_waitcnt ${parts.join(' ')}` : 's_waitcnt 0xffff';
}

const BRANCHES = new Set(['s_branch', 's_cbranch_scc0', 's_cbranch_scc1', 's_cbranch_vccz', 's_cbranch_vccnz', 's_cbranch_execz', 's_cbranch_execnz']);

function disassembleScalar(d: DecodedInstruction, info: OpcodeInfo): string {
  const m = info.mnemonic;
  const sw = SOP1_SPECIAL_WIDTHS[m];
  const dw = sw ? sw[0] : scalarWidth(info.salu?.d);
  const s0w = sw ? sw[1] : scalarWidth(info.salu?.s0);
  const s1w = scalarWidth(info.salu?.s1);
  const kind0: ConstKind = s0w === 64 ? (/_i64$/.test(m) ? 'i64' : 'u64') : 'b32';
  const kind1: ConstKind = s1w === 64 ? 'u64' : 'b32';
  const src0 = sourceText(d.src0Encoded, d.literal, kind0, s0w === 64 ? 2 : 1);
  switch (d.format) {
    case InstructionFormat.SOP1:
      if (m === 's_getpc_b64') return `${m} ${scalarRegName(d.dst, 64)}`;
      if (m === 's_setpc_b64') return `${m} ${src0}`;
      return `${m} ${scalarRegName(d.dst, dw)}, ${src0}`;
    case InstructionFormat.SOP2:
      return `${m} ${scalarRegName(d.dst, dw)}, ${src0}, ${sourceText(d.src1 ?? 0, d.literal, kind1, s1w === 64 ? 2 : 1)}`;
    case InstructionFormat.SOPC:
      return `${m} ${src0}, ${sourceText(d.src1 ?? 0, d.literal, kind1, s1w === 64 ? 2 : 1)}`;
    case InstructionFormat.SOPK: {
      const simm = d.simm16 ?? 0;
      if (m === 's_setreg_imm32_b32') return `${m} ${hex(simm)}, ${hex(d.literal ?? 0)}`;
      return `${m} ${scalarRegName(d.dst)}, ${hex(simm)}`;
    }
    default: { // SOPP
      const simm = d.simm16 ?? 0;
      if (m === 's_waitcnt') return waitcntText(simm);
      if (BRANCHES.has(m)) return `${m} ${(simm << 16) >> 16}`;
      return simm ? `${m} ${hex(simm)}` : m;
    }
  }
}

function disassembleDS(d: DecodedInstruction, info: OpcodeInfo): string {
  const m = info.mnemonic;
  const offset = d.offset ?? 0;
  const off0 = offset & 0xFF;
  const off1 = (offset >>> 8) & 0xFF;
  const addr = `v${d.src0Encoded}`;
  const pairOffsets = (): string => `${off0 ? ` offset0:${off0}` : ''}${off1 ? ` offset1:${off1}` : ''}`;
  const single = offset ? ` offset:${m === 'ds_swizzle_b32' ? hex(offset) : offset}` : '';
  switch (m) {
    case 'ds_write_b32': return `${m} ${addr}, v${d.src1 ?? 0}${single}`;
    case 'ds_write2st64_b32': return `${m} ${addr}, v${d.src1 ?? 0}, v${d.src2 ?? 0}${pairOffsets()}`;
    case 'ds_read2st64_b32': return `${m} ${vgprText(d.dst, 2)}, ${addr}${pairOffsets()}`;
    case 'ds_permute_b32':
    case 'ds_bpermute_b32': return `${m} v${d.dst}, ${addr}, v${d.src1 ?? 0}${single}`;
    default: return `${m} v${d.dst}, ${addr}${single}`;
  }
}

function disassembleMemory(d: DecodedInstruction, info: OpcodeInfo): string {
  const m = info.mnemonic;
  switch (d.format) {
    case InstructionFormat.SMEM: {
      const base = (d.sbase ?? 0) * 2;
      return `${m} s${d.dst}, s[${base}:${base + 1}], ${hex(d.offset ?? 0)}`;
    }
    case InstructionFormat.MUBUF: {
      const r = (d.srsrc ?? 0) * 4;
      const parts = [`${m} v${d.dst}, v${d.src0Encoded}, s[${r}:${r + 3}], 0`];
      if ((d.flags ?? 0) & 2) parts.push('idxen');
      if ((d.flags ?? 0) & 1) parts.push('offen');
      if ((d.flags ?? 0) & 4) parts.push('glc');
      if (d.offset) parts.push(`offset:${d.offset}`);
      return parts.join(' ');
    }
    case InstructionFormat.MIMG: {
      const r = (d.srsrc ?? 0) * 4;
      const s = (d.ssamp ?? 0) * 4;
      return `${m} v${d.dst}, v${d.src0Encoded}, s[${r}:${r + 7}], s[${s}:${s + 3}] dmask:${hex(d.dmask ?? 0)}`;
    }
    default:
      return m;
  }
}

function unsupportedComment(what: string): string {
  return `; ${what} (not supported by the emulator)`;
}

/**
 * Disassemble a decoded instruction to assembly text accepted by the assembler.
 * Formats the emulator cannot run are disassembled for reference only.
 */
export function disassemble(
  decoded: DecodedInstruction,
  lookupFn: (format: InstructionFormat, opcode: number) => OpcodeInfo | undefined = lookupByOpcode,
): string {
  const info = lookupFn(decoded.format, decoded.opcode);
  switch (decoded.format) {
    case InstructionFormat.FLAT:
    case InstructionFormat.EXP:
    case InstructionFormat.MTBUF:
    case InstructionFormat.VINTRP:
      return unsupportedComment(`${decoded.format} instruction`);
    case InstructionFormat.UNKNOWN:
      return unsupportedComment('unknown encoding');
    default:
      break;
  }
  if (!info) return unsupportedComment(`${decoded.format} opcode ${hex(decoded.opcode)}`);
  switch (decoded.format) {
    case InstructionFormat.VOP1:
    case InstructionFormat.VOP2:
    case InstructionFormat.VOPC:
    case InstructionFormat.VOP3:
    case InstructionFormat.VOP3P:
      return disassembleVALU(decoded, info);
    case InstructionFormat.SOP1:
    case InstructionFormat.SOP2:
    case InstructionFormat.SOPC:
    case InstructionFormat.SOPK:
    case InstructionFormat.SOPP:
      return disassembleScalar(decoded, info);
    case InstructionFormat.DS:
      return disassembleDS(decoded, info);
    default:
      return disassembleMemory(decoded, info);
  }
}
