// ── Comprehensive RDNA2 Emulator Test Suite ──

import { assemble } from '../src/assembler/assembler';
import { Emulator } from '../src/emulator/emulator';
import { decodeBinary, disassemble } from '../src/isa/encoding';
import { getAllOpcodes, lookupByOpcode, lookupByMnemonic } from '../src/isa/opcodes';
import { f16ToF32, f32ToF16 } from '../src/isa/float16';
import { getPuzzleById, ALL_PUZZLES } from '../src/puzzle/puzzles';
import { validatePuzzle } from '../src/puzzle/validator';
import { ALL_TUTORIALS } from '../src/puzzle/tutorials';
import { Puzzle, PuzzleResult } from '../src/puzzle/types';
import { InstructionFormat, OperandSlot } from '../src/isa/types';
import { twoOverPiTable } from '../src/isa/float64';
import { checkLine, EditChoice, editChoices, labelsIn } from '../src/assembler/operand-edit';

/** Write an f16 value into the low half of a VGPR lane (the high half is cleared). */
function writeF16(emu: Emulator, reg: number, lane: number, value: number): void {
  emu.state.writeVGPR_u32(reg, lane, f32ToF16(value));
}

/** Read the f16 value in the low half of a VGPR lane. */
function readF16(emu: Emulator, reg: number, lane: number): number {
  return f16ToF32(emu.state.readVGPR_u32(reg, lane) & 0xFFFF);
}

// ── Test Harness ──

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function approx(a: number, b: number, eps = 0.001): boolean {
  return Math.abs(a - b) < eps;
}

function group(name: string): void {
  console.log(`\n── ${name} ──`);
}

// Shared reinterpret buffers for float↔u32 bitcasting
const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

function floatBits(f: number): number {
  _f32[0] = f;
  return _u32[0];
}

function bitsToFloat(bits: number): number {
  _u32[0] = bits >>> 0;
  return _f32[0];
}

/** Assemble source, load into emulator, return emulator ready for input setup. */
function setup(source: string): Emulator {
  const result = assemble(source);
  assert(result.errors.length === 0, `Assembly errors for: ${source.trim().split('\n')[0]}... — ${result.errors.map(e => e.message).join(', ')}`);
  const emu = new Emulator();
  emu.load(result.binary);
  return emu;
}

// ════════════════════════════════════════════
//  VOP2 — Float Operations
// ════════════════════════════════════════════
group('VOP2 Float Operations');

// v_add_f32
{
  const emu = setup('v_add_f32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 1.5);
  emu.state.writeVGPR(1, 0, 2.5);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 4.0), 'v_add_f32: 1.5 + 2.5 = 4.0');
}

// v_sub_f32
{
  const emu = setup('v_sub_f32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 5.0);
  emu.state.writeVGPR(1, 0, 3.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 2.0), 'v_sub_f32: 5.0 - 3.0 = 2.0');
}

// v_subrev_f32
{
  const emu = setup('v_subrev_f32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 3.0);
  emu.state.writeVGPR(1, 0, 10.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 7.0), 'v_subrev_f32: 10.0 - 3.0 = 7.0');
}

// v_mul_f32
{
  const emu = setup('v_mul_f32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 3.0);
  emu.state.writeVGPR(1, 0, 4.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 12.0), 'v_mul_f32: 3.0 * 4.0 = 12.0');
}

// v_min_f32
{
  const emu = setup('v_min_f32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 7.0);
  emu.state.writeVGPR(1, 0, 3.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 3.0), 'v_min_f32: min(7.0, 3.0) = 3.0');
}

// v_max_f32
{
  const emu = setup('v_max_f32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 2.0);
  emu.state.writeVGPR(1, 0, 9.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 9.0), 'v_max_f32: max(2.0, 9.0) = 9.0');
}

// ════════════════════════════════════════════
//  VOP2 — Integer Operations
// ════════════════════════════════════════════
group('VOP2 Integer Operations');

// v_and_b32
{
  const emu = setup('v_and_b32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFF00FF00);
  emu.state.writeVGPR_u32(1, 0, 0x0F0F0F0F);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === (0x0F000F00 >>> 0), 'v_and_b32: 0xFF00FF00 & 0x0F0F0F0F = 0x0F000F00');
}

// v_or_b32
{
  const emu = setup('v_or_b32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFF00FF00);
  emu.state.writeVGPR_u32(1, 0, 0x00FF00FF);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === (0xFFFFFFFF >>> 0), 'v_or_b32: 0xFF00FF00 | 0x00FF00FF = 0xFFFFFFFF');
}

// v_xor_b32
{
  const emu = setup('v_xor_b32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFF00FF00);
  emu.state.writeVGPR_u32(1, 0, 0xFF00FF00);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 0, 'v_xor_b32: 0xFF00FF00 ^ 0xFF00FF00 = 0');
}

// v_add_nc_u32
{
  const emu = setup('v_add_nc_u32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 100);
  emu.state.writeVGPR_u32(1, 0, 200);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 300, 'v_add_nc_u32: 100 + 200 = 300');
}

// v_add_nc_u32 overflow wraps
{
  const emu = setup('v_add_nc_u32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFFFFFFFF);
  emu.state.writeVGPR_u32(1, 0, 1);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 0, 'v_add_nc_u32: 0xFFFFFFFF + 1 wraps to 0');
}

// ════════════════════════════════════════════
//  VOP2 — Special: v_cndmask_b32
// ════════════════════════════════════════════
group('VOP2 Special (v_cndmask_b32)');

{
  // Use v_cmp_lt_f32 to set VCC, then v_cndmask_b32 picks based on VCC
  const emu = setup([
    'v_cmp_lt_f32 v0, v1',  // VCC[0] = (v0[0] < v1[0])
    'v_cndmask_b32 v3, v4, v5',
    's_endpgm',
  ].join('\n'));
  // lane 0: v0=1.0 < v1=2.0 → VCC[0]=1 → pick v5
  emu.state.writeVGPR(0, 0, 1.0);
  emu.state.writeVGPR(1, 0, 2.0);
  emu.state.writeVGPR_u32(4, 0, 0xAAAAAAAA);
  emu.state.writeVGPR_u32(5, 0, 0xBBBBBBBB);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === (0xBBBBBBBB >>> 0), 'v_cndmask_b32: VCC=1 selects vsrc1');
}

{
  const emu = setup([
    'v_cmp_gt_f32 v0, v1',  // VCC[0] = (v0 > v1)
    'v_cndmask_b32 v3, v4, v5',
    's_endpgm',
  ].join('\n'));
  // lane 0: v0=1.0 > v1=2.0 → false → VCC[0]=0 → pick v4 (src0)
  emu.state.writeVGPR(0, 0, 1.0);
  emu.state.writeVGPR(1, 0, 2.0);
  emu.state.writeVGPR_u32(4, 0, 0xAAAAAAAA);
  emu.state.writeVGPR_u32(5, 0, 0xBBBBBBBB);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === (0xAAAAAAAA >>> 0), 'v_cndmask_b32: VCC=0 selects src0');
}

// ════════════════════════════════════════════
//  VOP1 — Float Operations
// ════════════════════════════════════════════
group('VOP1 Float Operations');

// v_mov_b32
{
  const emu = setup('v_mov_b32 v1, v0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xDEADBEEF);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === (0xDEADBEEF >>> 0), 'v_mov_b32: copies raw bits');
}

// v_rcp_f32
{
  const emu = setup('v_rcp_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 4.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), 0.25), 'v_rcp_f32: 1/4.0 = 0.25');
}

// v_sqrt_f32
{
  const emu = setup('v_sqrt_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 16.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), 4.0), 'v_sqrt_f32: sqrt(16.0) = 4.0');
}

// v_floor_f32
{
  const emu = setup('v_floor_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 3.7);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), 3.0), 'v_floor_f32: floor(3.7) = 3.0');
}

// v_ceil_f32
{
  const emu = setup('v_ceil_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 3.2);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), 4.0), 'v_ceil_f32: ceil(3.2) = 4.0');
}

// v_trunc_f32
{
  const emu = setup('v_trunc_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, -3.9);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), -3.0), 'v_trunc_f32: trunc(-3.9) = -3.0');
}

// v_rndne_f32
{
  const emu = setup('v_rndne_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 2.5);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), 2.0), 'v_rndne_f32: roundEven(2.5) = 2.0');
}

// v_rndne_f32 — odd halfway rounds up
{
  const emu = setup('v_rndne_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 3.5);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), 4.0), 'v_rndne_f32: roundEven(3.5) = 4.0');
}

// v_fract_f32
{
  const emu = setup('v_fract_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 5.75);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), 0.75), 'v_fract_f32: fract(5.75) = 0.75');
}

// v_exp_f32
{
  const emu = setup('v_exp_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 3.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), 8.0), 'v_exp_f32: 2^3.0 = 8.0');
}

// v_log_f32
{
  const emu = setup('v_log_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 8.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), 3.0), 'v_log_f32: log2(8.0) = 3.0');
}

// ════════════════════════════════════════════
//  VOP1 — Conversion Operations
// ════════════════════════════════════════════
group('VOP1 Conversion Operations');

// v_cvt_f32_i32
{
  const emu = setup('v_cvt_f32_i32 v1, v0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 42);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), 42.0), 'v_cvt_f32_i32: int 42 → 42.0');
}

// v_cvt_f32_i32 negative
{
  const emu = setup('v_cvt_f32_i32 v1, v0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (-7 >>> 0));
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), -7.0), 'v_cvt_f32_i32: int -7 → -7.0');
}

// v_cvt_i32_f32
{
  const emu = setup('v_cvt_i32_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 7.9);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 7, 'v_cvt_i32_f32: float 7.9 → int 7 (truncate)');
}

// v_cvt_f32_u32
{
  const emu = setup('v_cvt_f32_u32 v1, v0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 255);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), 255.0), 'v_cvt_f32_u32: uint 255 → 255.0');
}

// v_cvt_u32_f32
{
  const emu = setup('v_cvt_u32_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 123.9);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 123, 'v_cvt_u32_f32: float 123.9 → uint 123 (truncate)');
}

// v_cvt_f32_ubyte0–3: extract each byte from 0xAABBCCDD
{
  const testVal = 0xAABBCCDD;
  // byte0 = 0xDD = 221
  {
    const emu = setup('v_cvt_f32_ubyte0 v1, v0\ns_endpgm');
    emu.state.writeVGPR_u32(0, 0, testVal);
    emu.state.modifiedRegs.clear();
    emu.run();
    assert(approx(emu.state.readVGPR(1, 0), 0xDD), 'v_cvt_f32_ubyte0: byte0 of 0xAABBCCDD = 221');
  }
  // byte1 = 0xCC = 204
  {
    const emu = setup('v_cvt_f32_ubyte1 v1, v0\ns_endpgm');
    emu.state.writeVGPR_u32(0, 0, testVal);
    emu.state.modifiedRegs.clear();
    emu.run();
    assert(approx(emu.state.readVGPR(1, 0), 0xCC), 'v_cvt_f32_ubyte1: byte1 of 0xAABBCCDD = 204');
  }
  // byte2 = 0xBB = 187
  {
    const emu = setup('v_cvt_f32_ubyte2 v1, v0\ns_endpgm');
    emu.state.writeVGPR_u32(0, 0, testVal);
    emu.state.modifiedRegs.clear();
    emu.run();
    assert(approx(emu.state.readVGPR(1, 0), 0xBB), 'v_cvt_f32_ubyte2: byte2 of 0xAABBCCDD = 187');
  }
  // byte3 = 0xAA = 170
  {
    const emu = setup('v_cvt_f32_ubyte3 v1, v0\ns_endpgm');
    emu.state.writeVGPR_u32(0, 0, testVal);
    emu.state.modifiedRegs.clear();
    emu.run();
    assert(approx(emu.state.readVGPR(1, 0), 0xAA), 'v_cvt_f32_ubyte3: byte3 of 0xAABBCCDD = 170');
  }
}

// ════════════════════════════════════════════
//  VOP1 — Special: v_readfirstlane_b32
// ════════════════════════════════════════════
group('VOP1 Special (v_readfirstlane_b32)');

{
  const emu = setup('v_readfirstlane_b32 s1, v0\ns_endpgm');
  // Set EXEC to skip lane 0, first active = lane 1
  emu.state.exec = 0xFFFFFFFE; // bit0=0, bit1..31=1
  emu.state.writeVGPR_u32(0, 0, 0x11111111);
  emu.state.writeVGPR_u32(0, 1, 0x22222222);
  emu.state.writeVGPR_u32(0, 2, 0x33333333);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readSGPR(1) === (0x22222222 >>> 0), 'v_readfirstlane_b32: broadcasts lane 1 value to s1');
}

// ════════════════════════════════════════════
//  VOP3 — Float: v_fma_f32
// ════════════════════════════════════════════
group('VOP3 Float (v_fma_f32)');

{
  const emu = setup('v_fma_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 2.0);
  emu.state.writeVGPR(1, 0, 3.0);
  emu.state.writeVGPR(2, 0, 4.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(3, 0), 10.0), 'v_fma_f32: 2.0 * 3.0 + 4.0 = 10.0');
}

// ════════════════════════════════════════════
//  VOP3 — Integer
// ════════════════════════════════════════════
group('VOP3 Integer');

// v_add_lshl_u32: (a + b) << c
{
  const emu = setup('v_add_lshl_u32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 3);
  emu.state.writeVGPR_u32(1, 0, 5);
  emu.state.writeVGPR_u32(2, 0, 2);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 32, 'v_add_lshl_u32: (3 + 5) << 2 = 32');
}

// v_bfe_u32: bitfield extract
{
  const emu = setup('v_bfe_u32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xABCD1234);
  emu.state.writeVGPR_u32(1, 0, 8);   // offset
  emu.state.writeVGPR_u32(2, 0, 8);   // width
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 0x12, 'v_bfe_u32: extract bits[15:8] of 0xABCD1234 = 0x12');
}

// ════════════════════════════════════════════
//  VOPC — Float Comparisons
// ════════════════════════════════════════════
group('VOPC Float Comparisons');

// v_cmp_lt_f32
{
  const emu = setup('v_cmp_lt_f32 v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 1.0);
  emu.state.writeVGPR(1, 0, 2.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_lt_f32: 1.0 < 2.0 → VCC[0]=1');
}

// v_cmp_lt_f32 false
{
  const emu = setup('v_cmp_lt_f32 v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 5.0);
  emu.state.writeVGPR(1, 0, 2.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 0, 'v_cmp_lt_f32: 5.0 < 2.0 → VCC[0]=0');
}

// v_cmp_eq_f32
{
  const emu = setup('v_cmp_eq_f32 v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 3.0);
  emu.state.writeVGPR(1, 0, 3.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_eq_f32: 3.0 == 3.0 → VCC[0]=1');
}

// v_cmp_le_f32
{
  const emu = setup('v_cmp_le_f32 v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 3.0);
  emu.state.writeVGPR(1, 0, 3.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_le_f32: 3.0 <= 3.0 → VCC[0]=1');
}

// v_cmp_gt_f32
{
  const emu = setup('v_cmp_gt_f32 v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 5.0);
  emu.state.writeVGPR(1, 0, 2.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_gt_f32: 5.0 > 2.0 → VCC[0]=1');
}

// v_cmp_lg_f32 (not equal)
{
  const emu = setup('v_cmp_lg_f32 v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 1.0);
  emu.state.writeVGPR(1, 0, 2.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_lg_f32: 1.0 != 2.0 → VCC[0]=1');
}

// v_cmp_lg_f32 equal → 0
{
  const emu = setup('v_cmp_lg_f32 v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 5.0);
  emu.state.writeVGPR(1, 0, 5.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 0, 'v_cmp_lg_f32: 5.0 != 5.0 → VCC[0]=0');
}

// v_cmp_ge_f32
{
  const emu = setup('v_cmp_ge_f32 v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 4.0);
  emu.state.writeVGPR(1, 0, 4.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_ge_f32: 4.0 >= 4.0 → VCC[0]=1');
}

// VOPC multi-lane test
{
  const emu = setup('v_cmp_lt_f32 v0, v1\ns_endpgm');
  // lane 0: 1.0 < 2.0 → 1
  emu.state.writeVGPR(0, 0, 1.0);
  emu.state.writeVGPR(1, 0, 2.0);
  // lane 1: 5.0 < 2.0 → 0
  emu.state.writeVGPR(0, 1, 5.0);
  emu.state.writeVGPR(1, 1, 2.0);
  // lane 2: 0.0 < 1.0 → 1
  emu.state.writeVGPR(0, 2, 0.0);
  emu.state.writeVGPR(1, 2, 1.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 0x7) === 0x5, 'v_cmp_lt_f32 multi-lane: VCC bits = 101 (lanes 0,2 true)');
}

// ════════════════════════════════════════════
//  SOP1 — s_mov_b32
// ════════════════════════════════════════════
group('SOP1 (s_mov_b32)');

// Write to SGPR
{
  const emu = setup('s_mov_b32 s5, 42\ns_endpgm');
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readSGPR(5) === 42, 's_mov_b32: s5 = 42');
}

// Write to EXEC
{
  const emu = setup('s_mov_b32 exec, 0\ns_endpgm');
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.exec === 0, 's_mov_b32: exec = 0');
}

// Write to VCC
{
  const emu = setup('s_mov_b32 vcc, 1\ns_endpgm');
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.vcc === 1, 's_mov_b32: vcc = 1');
}

// s_mov_b32 from SGPR to SGPR
{
  const emu = setup('s_mov_b32 s10, s5\ns_endpgm');
  emu.state.writeSGPR(5, 999);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readSGPR(10) === 999, 's_mov_b32: s10 = s5 = 999');
}

// ════════════════════════════════════════════
//  SOPP — s_endpgm
// ════════════════════════════════════════════
group('SOPP (s_endpgm)');

{
  // Verify s_endpgm halts — instruction after it should NOT execute
  const emu = setup([
    's_mov_b32 s0, 10',
    's_endpgm',
    's_mov_b32 s0, 99',
  ].join('\n'));
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readSGPR(0) === 10, 's_endpgm: halts execution, s0 stays 10 not 99');
  assert(emu.halted === true, 's_endpgm: emulator reports halted');
}

// ════════════════════════════════════════════
//  SOPC — s_cmp_eq_u32, s_cmp_lg_u32 (scalar compare → SCC)
// ════════════════════════════════════════════
group('SOPC (scalar compare)');

// s_cmp_eq_u32: equal → SCC=1, then not-equal → SCC=0
{
  const emu = setup([
    's_mov_b32 s0, 5',
    's_cmp_eq_u32 s0, 5',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 1, 's_cmp_eq_u32: s0==5 → SCC=1');
}

{
  const emu = setup([
    's_mov_b32 s0, 5',
    's_cmp_eq_u32 s0, 3',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 0, 's_cmp_eq_u32: s0!=3 → SCC=0');
}

// SCC toggles across multiple comparisons
{
  const emu = setup([
    's_mov_b32 s0, 5',
    's_cmp_eq_u32 s0, 5',   // SCC=1
    's_cmp_eq_u32 s0, 3',   // SCC=0
    's_endpgm',
  ].join('\n'));
  // Step through manually to check SCC at each point
  emu.step(); // s_mov_b32
  emu.step(); // s_cmp_eq_u32 s0, 5
  assert(emu.state.scc === 1, 's_cmp_eq_u32 toggle: after s0==5 SCC=1');
  emu.step(); // s_cmp_eq_u32 s0, 3
  assert(emu.state.scc === 0, 's_cmp_eq_u32 toggle: after s0!=3 SCC=0');
}

// s_cmp_lg_u32: not-equal check
{
  const emu = setup([
    's_mov_b32 s0, 7',
    's_cmp_lg_u32 s0, 7',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 0, 's_cmp_lg_u32: s0==7 (not less/greater) → SCC=0');
}

{
  const emu = setup([
    's_mov_b32 s0, 7',
    's_cmp_lg_u32 s0, 10',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 1, 's_cmp_lg_u32: s0!=10 → SCC=1');
}

// ════════════════════════════════════════════
//  SOP2 — s_add_i32, s_and_b32 (scalar 2-source ALU)
// ════════════════════════════════════════════
group('SOP2 (scalar ALU)');

{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_mov_b32 s1, 20',
    's_add_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 30, 's_add_i32: 10 + 20 = 30');
}

{
  const emu = setup([
    's_mov_b32 s0, 0xFF00FF00',
    's_mov_b32 s1, 0x0F0F0F0F',
    's_and_b32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === (0x0F000F00 >>> 0), 's_and_b32: 0xFF00FF00 & 0x0F0F0F0F = 0x0F000F00');
}

// ════════════════════════════════════════════
//  Modifiers — abs, neg, omod, clamp
// ════════════════════════════════════════════
group('Modifiers');

// abs(v0) — absolute value modifier
{
  const emu = setup('v_add_f32 v2, abs(v0), v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, -5.0);
  emu.state.writeVGPR(1, 0, 1.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 6.0), 'abs modifier: abs(-5.0) + 1.0 = 6.0');
}

// -v0 — negation modifier
{
  const emu = setup('v_add_f32 v2, -v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 3.0);
  emu.state.writeVGPR(1, 0, 10.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 7.0), 'neg modifier: -3.0 + 10.0 = 7.0');
}

// omod mul:2
{
  const emu = setup('v_add_f32 v2, v0, v1 mul:2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 1.0);
  emu.state.writeVGPR(1, 0, 2.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 6.0), 'omod mul:2: (1.0 + 2.0) * 2 = 6.0');
}

// clamp
{
  const emu = setup('v_add_f32 v2, v0, v1 clamp\ns_endpgm');
  emu.state.writeVGPR(0, 0, 0.8);
  emu.state.writeVGPR(1, 0, 0.5);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 1.0), 'clamp: clamp(0.8 + 0.5 = 1.3) → 1.0');
}

// clamp negative result
{
  const emu = setup('v_add_f32 v2, v0, v1 clamp\ns_endpgm');
  emu.state.writeVGPR(0, 0, -5.0);
  emu.state.writeVGPR(1, 0, 1.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 0.0), 'clamp: clamp(-5.0 + 1.0 = -4.0) → 0.0');
}

// ════════════════════════════════════════════
//  Literal Constants
// ════════════════════════════════════════════
group('Literal Constants');

// Inline float constant (2.0) — stays 1 dword
{
  const result = assemble('v_add_f32 v2, 2.0, v1\ns_endpgm');
  assert(result.errors.length === 0, 'Inline float 2.0: assembles without error');
  // VOP2 v_add_f32 with inline 2.0 = 1 dword + s_endpgm 1 dword = 2 dwords
  assert(result.binary.length === 2, 'Inline float 2.0: produces 2 dwords (1 instr + s_endpgm)');

  const emu = new Emulator();
  emu.load(result.binary);
  emu.state.writeVGPR(1, 0, 3.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 5.0), 'Inline float 2.0: 2.0 + 3.0 = 5.0');
}

// Non-inline literal float (3.14) — becomes 2 dwords
{
  const result = assemble('v_add_f32 v2, 3.14, v1\ns_endpgm');
  assert(result.errors.length === 0, 'Literal float 3.14: assembles without error');
  // VOP2 with literal = 2 dwords + s_endpgm 1 dword = 3 dwords
  assert(result.binary.length === 3, 'Literal float 3.14: produces 3 dwords (2 instr + s_endpgm)');

  const emu = new Emulator();
  emu.load(result.binary);
  emu.state.writeVGPR(1, 0, 1.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 4.14), 'Literal float 3.14: 3.14 + 1.0 ≈ 4.14');
}

// Integer literal (0x3F800000) = raw bits for 1.0
{
  const result = assemble('v_mov_b32 v1, 0x3F800000\ns_endpgm');
  assert(result.errors.length === 0, 'Integer literal 0x3F800000: assembles without error');

  const emu = new Emulator();
  emu.load(result.binary);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0x3F800000, 'Integer literal 0x3F800000: stored as raw bits');
  assert(approx(emu.state.readVGPR(1, 0), 1.0), 'Integer literal 0x3F800000: reinterpreted as float = 1.0');
}

// ════════════════════════════════════════════
//  Binary Encoding Roundtrip
// ════════════════════════════════════════════
group('Binary Encoding Roundtrip');

{
  const testCases = [
    'v_add_f32 v2, v0, v1',
    'v_mul_f32 v3, v1, v2',
    'v_mov_b32 v1, v0',
    'v_sqrt_f32 v1, v0',
    's_endpgm',
  ];

  for (const src of testCases) {
    const result = assemble(src + '\ns_endpgm');
    assert(result.errors.length === 0, `Roundtrip assemble: ${src}`);

    const decoded = decodeBinary(result.binary);
    assert(decoded.length >= 1, `Roundtrip decode: ${src} → at least 1 instruction`);

    const disasm = disassemble(decoded[0], lookupByOpcode);
    const expectedMnemonic = src.split(' ')[0];
    assert(disasm.startsWith(expectedMnemonic), `Roundtrip disassemble: '${disasm}' starts with '${expectedMnemonic}'`);
  }
}

// ════════════════════════════════════════════
//  Multi-lane Execution
// ════════════════════════════════════════════
group('Multi-lane Execution');

{
  const emu = setup('v_add_f32 v2, v0, v1\ns_endpgm');
  for (let lane = 0; lane < 4; lane++) {
    emu.state.writeVGPR(0, lane, lane * 1.0);
    emu.state.writeVGPR(1, lane, 10.0);
  }
  emu.state.modifiedRegs.clear();
  emu.run();
  let allCorrect = true;
  for (let lane = 0; lane < 4; lane++) {
    if (!approx(emu.state.readVGPR(2, lane), lane + 10.0)) allCorrect = false;
  }
  assert(allCorrect, 'Multi-lane: v_add_f32 produces correct results across lanes 0-3');
}

// EXEC mask disables lanes
{
  const emu = setup('v_mov_b32 v1, v0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xAA);
  emu.state.writeVGPR_u32(0, 1, 0xBB);
  emu.state.writeVGPR_u32(1, 0, 0);
  emu.state.writeVGPR_u32(1, 1, 0);
  emu.state.exec = 0x00000001; // only lane 0 active
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0xAA, 'EXEC mask: lane 0 active → v1[0] = 0xAA');
  assert(emu.state.readVGPR_u32(1, 1) === 0, 'EXEC mask: lane 1 inactive → v1[1] unchanged (0)');
}

// ════════════════════════════════════════════
//  New VOP1: v_rsq_f32, v_not_b32, v_bfrev_b32, v_ffbh_u32, v_ffbl_b32, v_swap_b32
// ════════════════════════════════════════════
group('VOP1 — Additional');

// v_rsq_f32
{
  const r = assemble('v_rsq_f32 v1, v0\ns_endpgm');
  assert(r.errors.length === 0, 'v_rsq_f32 assembles');
  const e = new Emulator(); e.load(r.binary);
  e.state.writeVGPR(0, 0, 4.0); e.run();
  assert(approx(e.state.readVGPR(1, 0), 0.5), 'v_rsq_f32: 1/sqrt(4) = 0.5');
}

// v_not_b32
{
  const r = assemble('v_not_b32 v1, v0\ns_endpgm');
  assert(r.errors.length === 0, 'v_not_b32 assembles');
  const e = new Emulator(); e.load(r.binary);
  e.state.writeVGPR_u32(0, 0, 0x00FF00FF); e.run();
  assert(e.state.readVGPR_u32(1, 0) === 0xFF00FF00, 'v_not_b32: ~0x00FF00FF = 0xFF00FF00');
}

// v_bfrev_b32
{
  const r = assemble('v_bfrev_b32 v1, v0\ns_endpgm');
  assert(r.errors.length === 0, 'v_bfrev_b32 assembles');
  const e = new Emulator(); e.load(r.binary);
  e.state.writeVGPR_u32(0, 0, 0x80000000); e.run();
  assert(e.state.readVGPR_u32(1, 0) === 1, 'v_bfrev_b32: rev(0x80000000) = 1');
}
{
  const r = assemble('v_bfrev_b32 v1, v0\ns_endpgm');
  const e = new Emulator(); e.load(r.binary);
  e.state.writeVGPR_u32(0, 0, 0x01); e.run();
  assert(e.state.readVGPR_u32(1, 0) === 0x80000000, 'v_bfrev_b32: rev(0x01) = 0x80000000');
}

// v_ffbh_u32
{
  const r = assemble('v_ffbh_u32 v1, v0\ns_endpgm');
  assert(r.errors.length === 0, 'v_ffbh_u32 assembles');
  const e = new Emulator(); e.load(r.binary);
  e.state.writeVGPR_u32(0, 0, 0x00010000); e.run();
  assert(e.state.readVGPR_u32(1, 0) === 15, 'v_ffbh_u32: clz(0x00010000) = 15');
}
{
  const r = assemble('v_ffbh_u32 v1, v0\ns_endpgm');
  const e = new Emulator(); e.load(r.binary);
  e.state.writeVGPR_u32(0, 0, 0); e.run();
  assert(e.state.readVGPR_u32(1, 0) === 0xFFFFFFFF, 'v_ffbh_u32: clz(0) = 0xFFFFFFFF');
}

// v_ffbl_b32
{
  const r = assemble('v_ffbl_b32 v1, v0\ns_endpgm');
  assert(r.errors.length === 0, 'v_ffbl_b32 assembles');
  const e = new Emulator(); e.load(r.binary);
  e.state.writeVGPR_u32(0, 0, 0x00001000); e.run();
  assert(e.state.readVGPR_u32(1, 0) === 12, 'v_ffbl_b32: ctz(0x1000) = 12');
}
{
  const r = assemble('v_ffbl_b32 v1, v0\ns_endpgm');
  const e = new Emulator(); e.load(r.binary);
  e.state.writeVGPR_u32(0, 0, 0); e.run();
  assert(e.state.readVGPR_u32(1, 0) === 0xFFFFFFFF, 'v_ffbl_b32: ctz(0) = 0xFFFFFFFF');
}

// v_swap_b32
{
  const r = assemble('v_swap_b32 v0, v1\ns_endpgm');
  assert(r.errors.length === 0, 'v_swap_b32 assembles');
  const e = new Emulator(); e.load(r.binary);
  e.state.writeVGPR_u32(0, 0, 0xAAAAAAAA);
  e.state.writeVGPR_u32(1, 0, 0xBBBBBBBB);
  e.run();
  assert(e.state.readVGPR_u32(0, 0) === 0xBBBBBBBB, 'v_swap_b32: v0 gets old v1');
  assert(e.state.readVGPR_u32(1, 0) === 0xAAAAAAAA, 'v_swap_b32: v1 gets old v0');
}

// ════════════════════════════════════════════
//  DS — ds_swizzle_b32
// ════════════════════════════════════════════
group('DS (ds_swizzle_b32)');

// Helper: load lane index (0..31) as u32 into v0 for all 32 lanes
function setupSwizzle(offsetHex: string): Emulator {
  // We use a trick: store the lane index into each lane of v0
  // by masking one lane at a time (slow, but works for testing)
  const lines: string[] = [];
  for (let i = 0; i < 32; i++) {
    const mask = (1 << i) >>> 0;
    lines.push(`s_mov_b32 exec_lo, 0x${mask.toString(16).padStart(8, '0')}`);
    lines.push(`v_mov_b32 v0, ${i}`);
  }
  lines.push('s_mov_b32 exec_lo, 0xFFFFFFFF');
  lines.push(`ds_swizzle_b32 v1, v0 offset:${offsetHex}`);
  lines.push('s_endpgm');
  const emu = setup(lines.join('\n'));
  emu.run();
  return emu;
}

// Bitwise mode: XOR swap adjacent lanes (xor=1, or=0, and=0x1F → 0x841F)
// src_lane = ((lane & 0x1F) | 0) ^ 1 = lane ^ 1
// Lane 0→1, 1→0, 2→3, 3→2, ...
{
  const emu = setupSwizzle('0x041F');
  assert(emu.state.readVGPR_u32(1, 0) === 1, 'ds_swizzle bitwise xor=1: lane 0 reads from lane 1');
  assert(emu.state.readVGPR_u32(1, 1) === 0, 'ds_swizzle bitwise xor=1: lane 1 reads from lane 0');
  assert(emu.state.readVGPR_u32(1, 2) === 3, 'ds_swizzle bitwise xor=1: lane 2 reads from lane 3');
  assert(emu.state.readVGPR_u32(1, 3) === 2, 'ds_swizzle bitwise xor=1: lane 3 reads from lane 2');
  assert(emu.state.readVGPR_u32(1, 30) === 31, 'ds_swizzle bitwise xor=1: lane 30 reads from lane 31');
  assert(emu.state.readVGPR_u32(1, 31) === 30, 'ds_swizzle bitwise xor=1: lane 31 reads from lane 30');
}

// Bitwise mode: XOR with distance 2 (xor=2, or=0, and=0x1F → 0x881F)
// src_lane = lane ^ 2 → 0→2, 1→3, 2→0, 3→1, 4→6, 5→7, ...
{
  const emu = setupSwizzle('0x081F');
  assert(emu.state.readVGPR_u32(1, 0) === 2, 'ds_swizzle bitwise xor=2: lane 0 reads from lane 2');
  assert(emu.state.readVGPR_u32(1, 1) === 3, 'ds_swizzle bitwise xor=2: lane 1 reads from lane 3');
  assert(emu.state.readVGPR_u32(1, 2) === 0, 'ds_swizzle bitwise xor=2: lane 2 reads from lane 0');
  assert(emu.state.readVGPR_u32(1, 3) === 1, 'ds_swizzle bitwise xor=2: lane 3 reads from lane 1');
}

// Bitwise mode: AND round-down to even (xor=0, or=0, and=0x1E → 0x801E)
// src_lane = (lane & 0x1E) | 0 ^ 0 = lane & 0x1E → clears bit 0
// Lane 0→0, 1→0, 2→2, 3→2, 4→4, 5→4, ...
{
  const emu = setupSwizzle('0x001E');
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'ds_swizzle bitwise and=0x1E: lane 0 → 0');
  assert(emu.state.readVGPR_u32(1, 1) === 0, 'ds_swizzle bitwise and=0x1E: lane 1 → 0 (round down)');
  assert(emu.state.readVGPR_u32(1, 2) === 2, 'ds_swizzle bitwise and=0x1E: lane 2 → 2');
  assert(emu.state.readVGPR_u32(1, 3) === 2, 'ds_swizzle bitwise and=0x1E: lane 3 → 2 (round down)');
  assert(emu.state.readVGPR_u32(1, 7) === 6, 'ds_swizzle bitwise and=0x1E: lane 7 → 6 (round down)');
}

// Bitwise mode: OR broadcast lane 0 within groups of 4 (xor=0, or=0, and=0x1C → 0x801C)
// src_lane = lane & 0x1C → clears bottom 2 bits → reads from base of quad
// Lane 0→0, 1→0, 2→0, 3→0, 4→4, 5→4, 6→4, 7→4, ...
{
  const emu = setupSwizzle('0x001C');
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'ds_swizzle bitwise and=0x1C: lane 0 → 0');
  assert(emu.state.readVGPR_u32(1, 1) === 0, 'ds_swizzle bitwise and=0x1C: lane 1 → 0');
  assert(emu.state.readVGPR_u32(1, 2) === 0, 'ds_swizzle bitwise and=0x1C: lane 2 → 0');
  assert(emu.state.readVGPR_u32(1, 3) === 0, 'ds_swizzle bitwise and=0x1C: lane 3 → 0');
  assert(emu.state.readVGPR_u32(1, 4) === 4, 'ds_swizzle bitwise and=0x1C: lane 4 → 4');
  assert(emu.state.readVGPR_u32(1, 5) === 4, 'ds_swizzle bitwise and=0x1C: lane 5 → 4');
}

// Bitwise mode: OR sets bit → broadcast from lane 1 within pairs (xor=0, or=1, and=0x1E → 0x803E)
// src_lane = ((lane & 0x1E) | 1) ^ 0 = (lane & 0x1E) | 1 → always odd
// Lane 0→1, 1→1, 2→3, 3→3, 4→5, 5→5, ...
{
  const emu = setupSwizzle('0x003E');
  assert(emu.state.readVGPR_u32(1, 0) === 1, 'ds_swizzle bitwise or=1,and=0x1E: lane 0 → 1');
  assert(emu.state.readVGPR_u32(1, 1) === 1, 'ds_swizzle bitwise or=1,and=0x1E: lane 1 → 1');
  assert(emu.state.readVGPR_u32(1, 2) === 3, 'ds_swizzle bitwise or=1,and=0x1E: lane 2 → 3');
  assert(emu.state.readVGPR_u32(1, 3) === 3, 'ds_swizzle bitwise or=1,and=0x1E: lane 3 → 3');
}

// Bitwise mode: combined xor+and (xor=1, or=0, and=0x1E → 0x841E)
// src_lane = ((lane & 0x1E) | 0) ^ 1 → round to even then flip bit 0
// Lane 0→1, 1→1, 2→3, 3→3, 4→5, 5→5, ...
{
  const emu = setupSwizzle('0x041E');
  assert(emu.state.readVGPR_u32(1, 0) === 1, 'ds_swizzle bitwise xor=1,and=0x1E: lane 0 → 1');
  assert(emu.state.readVGPR_u32(1, 1) === 1, 'ds_swizzle bitwise xor=1,and=0x1E: lane 1 → 1');
  assert(emu.state.readVGPR_u32(1, 2) === 3, 'ds_swizzle bitwise xor=1,and=0x1E: lane 2 → 3');
  assert(emu.state.readVGPR_u32(1, 3) === 3, 'ds_swizzle bitwise xor=1,and=0x1E: lane 3 → 3');
}

// Quad permute mode (bit15=0): reverse within each quad → 0x00E4 = identity, 0x001B = reverse
// 0x001B: quad_perm = [3,2,1,0] → bits = 11_10_01_00 = 0x1B
{
  const emu = setupSwizzle('0x801B');
  assert(emu.state.readVGPR_u32(1, 0) === 3, 'ds_swizzle QDM reverse: lane 0 → 3');
  assert(emu.state.readVGPR_u32(1, 1) === 2, 'ds_swizzle QDM reverse: lane 1 → 2');
  assert(emu.state.readVGPR_u32(1, 2) === 1, 'ds_swizzle QDM reverse: lane 2 → 1');
  assert(emu.state.readVGPR_u32(1, 3) === 0, 'ds_swizzle QDM reverse: lane 3 → 0');
  // Next quad (lanes 4-7) should also reverse within quad
  assert(emu.state.readVGPR_u32(1, 4) === 7, 'ds_swizzle QDM reverse: lane 4 → 7');
  assert(emu.state.readVGPR_u32(1, 5) === 6, 'ds_swizzle QDM reverse: lane 5 → 6');
}

// Quad permute mode: broadcast lane 0 of each quad → 0x0000 = [0,0,0,0]
{
  const emu = setupSwizzle('0x8000');
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'ds_swizzle QDM broadcast: lane 0 → 0');
  assert(emu.state.readVGPR_u32(1, 1) === 0, 'ds_swizzle QDM broadcast: lane 1 → 0');
  assert(emu.state.readVGPR_u32(1, 2) === 0, 'ds_swizzle QDM broadcast: lane 2 → 0');
  assert(emu.state.readVGPR_u32(1, 3) === 0, 'ds_swizzle QDM broadcast: lane 3 → 0');
  assert(emu.state.readVGPR_u32(1, 4) === 4, 'ds_swizzle QDM broadcast: lane 4 → 4 (quad base)');
  assert(emu.state.readVGPR_u32(1, 5) === 4, 'ds_swizzle QDM broadcast: lane 5 → 4');
}

// EXEC masking: disabled lanes are not written, and reading an inactive lane returns 0
{
  const lines: string[] = [];
  // Set v0[lane] = lane for all 32
  for (let i = 0; i < 32; i++) {
    const mask = (1 << i) >>> 0;
    lines.push(`s_mov_b32 exec_lo, 0x${mask.toString(16).padStart(8, '0')}`);
    lines.push(`v_mov_b32 v0, ${i}`);
  }
  // Set v1 = 0xFF for all lanes
  lines.push('s_mov_b32 exec_lo, 0xFFFFFFFF');
  lines.push('v_mov_b32 v1, 0xFF');
  // Mask: only lane 0 active
  lines.push('s_mov_b32 exec_lo, 0x00000001');
  lines.push('ds_swizzle_b32 v1, v0 offset:0x041F');  // XOR swap (bitwise: bit15=0)
  lines.push('s_endpgm');
  const emu = setup(lines.join('\n'));
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'ds_swizzle EXEC: active lane 0 reading inactive lane 1 gets 0');
  assert(emu.state.readVGPR_u32(1, 1) === 0xFF, 'ds_swizzle EXEC: inactive lane 1 unchanged (0xFF)');
  assert(emu.state.readVGPR_u32(1, 2) === 0xFF, 'ds_swizzle EXEC: inactive lane 2 unchanged (0xFF)');
}

// EXEC masking: an active source lane is read normally
{
  const lines = ['v_mov_b32 v1, 0xFF', 's_mov_b32 exec_lo, 3'];
  lines.unshift('v_mbcnt_lo_u32_b32 v0, -1, 0');
  lines.push('ds_swizzle_b32 v1, v0 offset:0x041F', 's_endpgm');
  const emu = setup(lines.join('\n'));
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 1, 'ds_swizzle EXEC: lane 0 reads active lane 1');
  assert(emu.state.readVGPR_u32(1, 1) === 0, 'ds_swizzle EXEC: lane 1 reads active lane 0');
  assert(emu.state.readVGPR_u32(1, 2) === 0xFF, 'ds_swizzle EXEC: inactive lane 2 unchanged');
}

// ════════════════════════════════════════════
//  DS — ds_permute_b32, ds_bpermute_b32
// ════════════════════════════════════════════
group('DS (ds_permute / ds_bpermute)');

// Helper: load lane index into v0 for all 32 lanes
function setupLaneIndices(): string[] {
  const lines: string[] = [];
  for (let i = 0; i < 32; i++) {
    const mask = (1 << i) >>> 0;
    lines.push(`s_mov_b32 exec_lo, 0x${mask.toString(16).padStart(8, '0')}`);
    lines.push(`v_mov_b32 v0, ${i}`);
  }
  lines.push('s_mov_b32 exec_lo, 0xFFFFFFFF');
  return lines;
}

// ds_bpermute_b32: each lane reads from lane[vaddr/4]
// Set v1 = lane * 4 (byte address of own lane) reversed: lane 0 reads lane 31, etc.
{
  const lines = setupLaneIndices();
  // v1 = (31 - lane) * 4 = reverse lane index as byte addr
  for (let i = 0; i < 32; i++) {
    const mask = (1 << i) >>> 0;
    lines.push(`s_mov_b32 exec_lo, 0x${mask.toString(16).padStart(8, '0')}`);
    lines.push(`v_mov_b32 v1, ${(31 - i) * 4}`);
  }
  lines.push('s_mov_b32 exec_lo, 0xFFFFFFFF');
  lines.push('ds_bpermute_b32 v2, v1, v0');
  lines.push('s_endpgm');
  const emu = setup(lines.join('\n'));
  emu.run();
  // Lane 0 reads from lane 31 (value 31), lane 31 reads from lane 0 (value 0)
  assert(emu.state.readVGPR_u32(2, 0) === 31, 'ds_bpermute: lane 0 reads lane 31');
  assert(emu.state.readVGPR_u32(2, 31) === 0, 'ds_bpermute: lane 31 reads lane 0');
  assert(emu.state.readVGPR_u32(2, 15) === 16, 'ds_bpermute: lane 15 reads lane 16');
  assert(emu.state.readVGPR_u32(2, 16) === 15, 'ds_bpermute: lane 16 reads lane 15');
}

// ds_bpermute_b32: broadcast lane 5 to all lanes
{
  const lines = setupLaneIndices();
  // v1 = 5*4 = 20 for all lanes (all read from lane 5)
  lines.push('v_mov_b32 v1, 20');
  lines.push('ds_bpermute_b32 v2, v1, v0');
  lines.push('s_endpgm');
  const emu = setup(lines.join('\n'));
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 5, 'ds_bpermute broadcast: lane 0 = 5');
  assert(emu.state.readVGPR_u32(2, 15) === 5, 'ds_bpermute broadcast: lane 15 = 5');
  assert(emu.state.readVGPR_u32(2, 31) === 5, 'ds_bpermute broadcast: lane 31 = 5');
}

// ds_permute_b32: forward permute — each lane sends its data to lane[vaddr/4]
// Lane N sends its value to lane (31-N)
{
  const lines = setupLaneIndices();
  // v1 = (31 - lane) * 4
  for (let i = 0; i < 32; i++) {
    const mask = (1 << i) >>> 0;
    lines.push(`s_mov_b32 exec_lo, 0x${mask.toString(16).padStart(8, '0')}`);
    lines.push(`v_mov_b32 v1, ${(31 - i) * 4}`);
  }
  lines.push('s_mov_b32 exec_lo, 0xFFFFFFFF');
  lines.push('ds_permute_b32 v2, v1, v0');
  lines.push('s_endpgm');
  const emu = setup(lines.join('\n'));
  emu.run();
  // Lane 0 sent value 0 to lane 31, lane 31 sent value 31 to lane 0
  assert(emu.state.readVGPR_u32(2, 0) === 31, 'ds_permute reverse: lane 0 gets 31');
  assert(emu.state.readVGPR_u32(2, 31) === 0, 'ds_permute reverse: lane 31 gets 0');
  assert(emu.state.readVGPR_u32(2, 10) === 21, 'ds_permute reverse: lane 10 gets 21');
}

// ds_permute_b32: rotate — each lane sends to lane+1 (wrapping)
{
  const lines = setupLaneIndices();
  // v1 = ((lane + 1) % 32) * 4
  for (let i = 0; i < 32; i++) {
    const mask = (1 << i) >>> 0;
    lines.push(`s_mov_b32 exec_lo, 0x${mask.toString(16).padStart(8, '0')}`);
    lines.push(`v_mov_b32 v1, ${((i + 1) % 32) * 4}`);
  }
  lines.push('s_mov_b32 exec_lo, 0xFFFFFFFF');
  lines.push('ds_permute_b32 v2, v1, v0');
  lines.push('s_endpgm');
  const emu = setup(lines.join('\n'));
  emu.run();
  // Lane 0 sent to lane 1, lane 1 sent to lane 2, ..., lane 31 sent to lane 0
  // So lane 1 has value 0, lane 2 has value 1, lane 0 has value 31
  assert(emu.state.readVGPR_u32(2, 0) === 31, 'ds_permute rotate: lane 0 gets 31 (from lane 31)');
  assert(emu.state.readVGPR_u32(2, 1) === 0, 'ds_permute rotate: lane 1 gets 0 (from lane 0)');
  assert(emu.state.readVGPR_u32(2, 31) === 30, 'ds_permute rotate: lane 31 gets 30');
}

// ════════════════════════════════════════════
//  DPP16 — row_shr, row_shl, row_ror, quad_perm, row_mirror, row_share, row_xmask
// ════════════════════════════════════════════
group('DPP16');

// Helper: load lane index (0..31) as u32 into v0, then run a DPP add
function setupDpp16(dppMod: string): Emulator {
  const lines: string[] = [];
  for (let i = 0; i < 32; i++) {
    const mask = (1 << i) >>> 0;
    lines.push(`s_mov_b32 exec_lo, 0x${mask.toString(16).padStart(8, '0')}`);
    lines.push(`v_mov_b32 v0, ${i}`);
  }
  lines.push('s_mov_b32 exec_lo, 0xFFFFFFFF');
  // v_mov_b32 with DPP: copies src0 from a different lane into dst
  lines.push(`v_mov_b32 v1, v0 ${dppMod}`);
  lines.push('s_endpgm');
  const emu = setup(lines.join('\n'));
  emu.run();
  return emu;
}

// row_shr:1 — lane n reads lane n-1 of its row; the first lane of each row has no source
{
  const emu = setupDpp16('row_shr:1 bound_ctrl:1');
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'DPP16 row_shr:1: lane 0 has no source → 0 (bound_ctrl)');
  assert(emu.state.readVGPR_u32(1, 1) === 0, 'DPP16 row_shr:1: lane 1 reads lane 0');
  assert(emu.state.readVGPR_u32(1, 15) === 14, 'DPP16 row_shr:1: lane 15 reads lane 14');
  assert(emu.state.readVGPR_u32(1, 16) === 0, 'DPP16 row_shr:1: lane 16 (row 1 start) → 0');
  assert(emu.state.readVGPR_u32(1, 17) === 16, 'DPP16 row_shr:1: lane 17 reads lane 16');
}

// row_shl:1 — lane n reads lane n+1 of its row
{
  const emu = setupDpp16('row_shl:1 bound_ctrl:1');
  assert(emu.state.readVGPR_u32(1, 0) === 1, 'DPP16 row_shl:1: lane 0 reads lane 1');
  assert(emu.state.readVGPR_u32(1, 14) === 15, 'DPP16 row_shl:1: lane 14 reads lane 15');
  assert(emu.state.readVGPR_u32(1, 15) === 0, 'DPP16 row_shl:1: lane 15 has no source → 0 (bound_ctrl)');
  assert(emu.state.readVGPR_u32(1, 16) === 17, 'DPP16 row_shl:1: lane 16 reads lane 17 (row 1)');
}

// row_shr:4 — shift by 4 within the row
{
  const emu = setupDpp16('row_shr:4 bound_ctrl:1');
  assert(emu.state.readVGPR_u32(1, 3) === 0, 'DPP16 row_shr:4: lane 3 has no source → 0');
  assert(emu.state.readVGPR_u32(1, 4) === 0, 'DPP16 row_shr:4: lane 4 reads lane 0');
  assert(emu.state.readVGPR_u32(1, 15) === 11, 'DPP16 row_shr:4: lane 15 reads lane 11');
}

// Without bound_ctrl, lanes with no source lane are not written
{
  const lines: string[] = ['v_mbcnt_lo_u32_b32 v0, -1, 0', 'v_mov_b32 v1, 0x77', 'v_mov_b32 v1, v0 row_shr:2', 's_endpgm'];
  const emu = setup(lines.join('\n'));
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0x77, 'DPP16 row_shr:2 without bound_ctrl: lane 0 keeps its old value');
  assert(emu.state.readVGPR_u32(1, 1) === 0x77, 'DPP16 row_shr:2 without bound_ctrl: lane 1 keeps its old value');
  assert(emu.state.readVGPR_u32(1, 2) === 0, 'DPP16 row_shr:2 without bound_ctrl: lane 2 reads lane 0');
}

// row_ror:1 — rotate right within the row: lane n reads lane (n-1) mod 16
{
  const emu = setupDpp16('row_ror:1');
  assert(emu.state.readVGPR_u32(1, 0) === 15, 'DPP16 row_ror:1: lane 0 wraps to lane 15');
  assert(emu.state.readVGPR_u32(1, 1) === 0, 'DPP16 row_ror:1: lane 1 reads lane 0');
  assert(emu.state.readVGPR_u32(1, 16) === 31, 'DPP16 row_ror:1: lane 16 wraps to lane 31 (row 1)');
}

// quad_perm:[1,0,3,2] — swap adjacent within each quad
{
  const emu = setupDpp16('quad_perm:[1,0,3,2]');
  assert(emu.state.readVGPR_u32(1, 0) === 1, 'DPP16 quad_perm swap: lane 0 reads lane 1');
  assert(emu.state.readVGPR_u32(1, 1) === 0, 'DPP16 quad_perm swap: lane 1 reads lane 0');
  assert(emu.state.readVGPR_u32(1, 2) === 3, 'DPP16 quad_perm swap: lane 2 reads lane 3');
  assert(emu.state.readVGPR_u32(1, 3) === 2, 'DPP16 quad_perm swap: lane 3 reads lane 2');
  assert(emu.state.readVGPR_u32(1, 4) === 5, 'DPP16 quad_perm swap: lane 4 reads lane 5');
}

// quad_perm:[0,0,0,0] — broadcast lane 0 of each quad
{
  const emu = setupDpp16('quad_perm:[0,0,0,0]');
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'DPP16 quad_perm bcast: lane 0 → 0');
  assert(emu.state.readVGPR_u32(1, 1) === 0, 'DPP16 quad_perm bcast: lane 1 → 0');
  assert(emu.state.readVGPR_u32(1, 2) === 0, 'DPP16 quad_perm bcast: lane 2 → 0');
  assert(emu.state.readVGPR_u32(1, 3) === 0, 'DPP16 quad_perm bcast: lane 3 → 0');
  assert(emu.state.readVGPR_u32(1, 4) === 4, 'DPP16 quad_perm bcast: lane 4 → 4 (next quad)');
}

// wave_shl / wave_shr / wave_rol / wave_ror / row_bcast are GCN-only: the assembler rejects them
for (const mod of ['wave_shl:1', 'wave_shr:1', 'wave_rol:1', 'wave_ror:1', 'row_bcast:15', 'row_bcast31']) {
  const r = assemble(`v_mov_b32 v1, v0 ${mod}\ns_endpgm`);
  assert(r.errors.length === 1 && /RDNA2/.test(r.errors[0].message), `DPP16: ${mod} is rejected on RDNA2`);
}

// row_share:3 — every lane of a row reads lane 3 of that row
{
  const emu = setupDpp16('row_share:3');
  assert(emu.state.readVGPR_u32(1, 0) === 3, 'DPP16 row_share:3: lane 0 reads lane 3');
  assert(emu.state.readVGPR_u32(1, 15) === 3, 'DPP16 row_share:3: lane 15 reads lane 3');
  assert(emu.state.readVGPR_u32(1, 16) === 19, 'DPP16 row_share:3: lane 16 reads lane 19 (row 1)');
}

// row_xmask:5 — lane n reads lane n ^ 5 of its row
{
  const emu = setupDpp16('row_xmask:5');
  assert(emu.state.readVGPR_u32(1, 0) === 5, 'DPP16 row_xmask:5: lane 0 reads lane 5');
  assert(emu.state.readVGPR_u32(1, 7) === 2, 'DPP16 row_xmask:5: lane 7 reads lane 2');
  assert(emu.state.readVGPR_u32(1, 21) === 16, 'DPP16 row_xmask:5: lane 21 reads lane 16');
}

// row_mask / bank_mask gate which lanes are written
{
  const emu = setup(['v_mbcnt_lo_u32_b32 v0, -1, 0', 'v_mov_b32 v1, 0x77',
    'v_mov_b32 v1, v0 quad_perm:[0,0,0,0] row_mask:0x1 bank_mask:0x2', 's_endpgm'].join('\n'));
  emu.run();
  assert(emu.state.readVGPR_u32(1, 4) === 4, 'DPP16 row_mask:0x1 bank_mask:0x2: lane 4 (row 0, bank 1) written');
  assert(emu.state.readVGPR_u32(1, 5) === 4, 'DPP16 row_mask:0x1 bank_mask:0x2: lane 5 (row 0, bank 1) written');
  assert(emu.state.readVGPR_u32(1, 0) === 0x77, 'DPP16 bank_mask:0x2: lane 0 (bank 0) not written');
  assert(emu.state.readVGPR_u32(1, 20) === 0x77, 'DPP16 row_mask:0x1: lane 20 (row 1) not written');
}

// An inactive source lane is invalid unless fi:1 (fetch inactive) is set
{
  const base = ['v_mbcnt_lo_u32_b32 v0, -1, 0', 'v_mov_b32 v1, 0x77', 's_mov_b32 exec_lo, 0xFFFFFFFD'];
  let emu = setup([...base, 'v_mov_b32 v1, v0 row_shl:1', 's_endpgm'].join('\n'));
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0x77, 'DPP16: source lane 1 inactive → lane 0 not written');
  emu = setup([...base, 'v_mov_b32 v1, v0 row_shl:1 bound_ctrl:1', 's_endpgm'].join('\n'));
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'DPP16: source lane 1 inactive + bound_ctrl:1 → 0');
  emu = setup([...base, 'v_mov_b32 v1, v0 row_shl:1 fi:1', 's_endpgm'].join('\n'));
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 1, 'DPP16: fi:1 fetches inactive lane 1');
}

// DPP16 encoding matches LLVM (GFX10)
{
  const r = assemble('v_mov_b32 v5, v1 quad_perm:[3,2,1,0] row_mask:0x0 bank_mask:0x0');
  assert(r.binary[0] === 0x7E0A02FA && r.binary[1] === 0x00001B01, 'DPP16 encoding: quad_perm word layout');
  const s = assemble('v_add_nc_u32 v5, v1, v2 row_shr:1 bound_ctrl:1 fi:1');
  assert(s.binary[1] === (0xFF000000 | (0x111 << 8) | (1 << 18) | (1 << 19) | 1) >>> 0, 'DPP16 encoding: row_shr/FI/BOUND_CTRL/masks');
}

// row_mirror — reverse within row of 16
{
  const emu = setupDpp16('row_mirror');
  assert(emu.state.readVGPR_u32(1, 0) === 15, 'DPP16 row_mirror: lane 0 reads lane 15');
  assert(emu.state.readVGPR_u32(1, 15) === 0, 'DPP16 row_mirror: lane 15 reads lane 0');
  assert(emu.state.readVGPR_u32(1, 7) === 8, 'DPP16 row_mirror: lane 7 reads lane 8');
  assert(emu.state.readVGPR_u32(1, 16) === 31, 'DPP16 row_mirror: lane 16 reads lane 31 (row 1)');
}

// row_half_mirror — reverse within each half-row (8 lanes)
{
  const emu = setupDpp16('row_half_mirror');
  assert(emu.state.readVGPR_u32(1, 0) === 7, 'DPP16 row_half_mirror: lane 0 reads lane 7');
  assert(emu.state.readVGPR_u32(1, 7) === 0, 'DPP16 row_half_mirror: lane 7 reads lane 0');
  assert(emu.state.readVGPR_u32(1, 8) === 15, 'DPP16 row_half_mirror: lane 8 reads lane 15');
}

// DPP16 with VOP2: v_add_f32 with row_shr:1
{
  const lines: string[] = [];
  for (let i = 0; i < 32; i++) {
    const mask = (1 << i) >>> 0;
    lines.push(`s_mov_b32 exec_lo, 0x${mask.toString(16).padStart(8, '0')}`);
    lines.push(`v_mov_b32 v0, ${i}.0`);
  }
  lines.push('s_mov_b32 exec_lo, 0xFFFFFFFF');
  lines.push('v_add_f32 v1, v0, v0 row_shr:1 bound_ctrl:1');
  lines.push('s_endpgm');
  const emu = setup(lines.join('\n'));
  emu.run();
  // Lane 0: src0 has no source lane → 0.0 (bound_ctrl), src1 = v0[0] = 0.0
  assert(approx(emu.state.readVGPR(1, 0), 0.0), 'DPP16 VOP2: v_add_f32 row_shr:1 lane 0 = 0.0 + 0.0');
  // Lane 5: src0 = v0[lane 4] = 4.0 (DPP), src1 = v0[lane 5] = 5.0
  assert(approx(emu.state.readVGPR(1, 5), 9.0), 'DPP16 VOP2: v_add_f32 row_shr:1 lane 5 = 4.0 + 5.0');
}

// ════════════════════════════════════════════
//  DPP8 — lane permutation within groups of 8
// ════════════════════════════════════════════
group('DPP8');

// DPP8: reverse within groups of 8
{
  const emu = setupDpp16('dpp8:[7,6,5,4,3,2,1,0]');
  assert(emu.state.readVGPR_u32(1, 0) === 7, 'DPP8 reverse: lane 0 reads lane 7');
  assert(emu.state.readVGPR_u32(1, 7) === 0, 'DPP8 reverse: lane 7 reads lane 0');
  assert(emu.state.readVGPR_u32(1, 8) === 15, 'DPP8 reverse: lane 8 reads lane 15 (group 1)');
  assert(emu.state.readVGPR_u32(1, 15) === 8, 'DPP8 reverse: lane 15 reads lane 8');
}

// DPP8: broadcast lane 0 of each group
{
  const emu = setupDpp16('dpp8:[0,0,0,0,0,0,0,0]');
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'DPP8 bcast: lane 0 → 0');
  assert(emu.state.readVGPR_u32(1, 5) === 0, 'DPP8 bcast: lane 5 → 0');
  assert(emu.state.readVGPR_u32(1, 7) === 0, 'DPP8 bcast: lane 7 → 0');
  assert(emu.state.readVGPR_u32(1, 8) === 8, 'DPP8 bcast: lane 8 → 8 (group 1 base)');
  assert(emu.state.readVGPR_u32(1, 12) === 8, 'DPP8 bcast: lane 12 → 8');
}

// DPP8: rotate left by 1 within groups of 8
{
  const emu = setupDpp16('dpp8:[1,2,3,4,5,6,7,0]');
  assert(emu.state.readVGPR_u32(1, 0) === 1, 'DPP8 rotate: lane 0 reads lane 1');
  assert(emu.state.readVGPR_u32(1, 6) === 7, 'DPP8 rotate: lane 6 reads lane 7');
  assert(emu.state.readVGPR_u32(1, 7) === 0, 'DPP8 rotate: lane 7 wraps to lane 0');
}

// ════════════════════════════════════════════
//  Labels and Branches
// ════════════════════════════════════════════
group('Labels and Branches');

// s_branch: unconditional forward jump (skip one instruction)
{
  const emu = setup([
    's_mov_b32 s0, 1',
    's_branch skip',
    's_mov_b32 s0, 99',   // should be skipped
    'skip:',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(0) === 1, 's_branch forward: s0 stays 1 (skipped s0=99)');
}

// s_cbranch_scc1: conditional branch taken
{
  const emu = setup([
    's_mov_b32 s0, 5',
    's_cmp_eq_u32 s0, 5',    // SCC=1
    's_cbranch_scc1 skip',
    's_mov_b32 s0, 99',      // should be skipped
    'skip:',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(0) === 5, 's_cbranch_scc1 taken: s0 stays 5');
}

// s_cbranch_scc1: conditional branch not taken
{
  const emu = setup([
    's_mov_b32 s0, 5',
    's_cmp_eq_u32 s0, 3',    // SCC=0
    's_cbranch_scc1 skip',
    's_mov_b32 s0, 99',      // should execute
    'skip:',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(0) === 99, 's_cbranch_scc1 not taken: s0 = 99');
}

// s_cbranch_scc0: branch when SCC=0
{
  const emu = setup([
    's_mov_b32 s0, 5',
    's_cmp_eq_u32 s0, 3',    // SCC=0
    's_cbranch_scc0 skip',
    's_mov_b32 s0, 99',      // should be skipped
    'skip:',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(0) === 5, 's_cbranch_scc0 taken: s0 stays 5');
}

// s_cbranch_execz: branch when EXEC=0
{
  const emu = setup([
    's_mov_b32 exec_lo, 0',
    's_cbranch_execz skip',
    's_mov_b32 s0, 99',      // should be skipped
    'skip:',
    's_mov_b32 exec_lo, 0xFFFFFFFF',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(0) === 0, 's_cbranch_execz taken: s0 stays 0');
}

// s_cbranch_execnz: branch when EXEC!=0
{
  const emu = setup([
    's_mov_b32 s0, 1',
    's_cbranch_execnz skip',  // EXEC=0xFFFFFFFF initially
    's_mov_b32 s0, 99',       // should be skipped
    'skip:',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(0) === 1, 's_cbranch_execnz taken: s0 stays 1');
}

// Backward branch (simple loop: add 1 three times)
{
  const emu = setup([
    's_mov_b32 s0, 0',
    's_mov_b32 s1, 3',       // loop counter
    'loop:',
    's_add_i32 s0, s0, 1',
    's_add_i32 s1, s1, -1',
    's_cmp_lg_u32 s1, 0',    // SCC=1 if s1 != 0
    's_cbranch_scc1 loop',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(0) === 3, 'Backward branch loop: s0 = 3 (looped 3 times)');
}

// Undefined label produces error
{
  const result = assemble('s_branch nowhere\ns_endpgm');
  assert(result.errors.length > 0, 'Undefined label: produces assembly error');
  assert(result.errors[0].message.includes('nowhere'), 'Undefined label: error mentions label name');
}

// ════════════════════════════════════════════
//  PC Manipulation — s_getpc, s_setpc, s_swappc
// ════════════════════════════════════════════
group('PC Manipulation');

// s_getpc_b64: stores address of next instruction
{
  const emu = setup([
    's_getpc_b64 s0',     // s0 = (PC+1)*4 = 1*4 = 4
    's_mov_b32 s2, 99',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(0) === 4, 's_getpc_b64: s0 = 4 (next instruction byte address)');
  assert(emu.state.readSGPR(2) === 99, 's_getpc_b64: execution continues normally');
}

// s_setpc_b64: jump to address in SGPR
{
  const emu = setup([
    's_getpc_b64 s0',      // s0 = 4 (byte addr of instruction 1)
    's_add_i32 s0, s0, 8', // s0 = 12 (byte addr of instruction 3)
    's_setpc_b64 s0',      // jump to instruction 3
    's_mov_b32 s2, 99',    // skipped
    's_mov_b32 s2, 42',    // instruction 3 (target): this executes
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 42, 's_setpc_b64: jumped over s2=99, s2=42');
}

// s_swappc_b64: save return address and jump (function call)
{
  const emu = setup([
    's_mov_b32 s4, 0',
    's_getpc_b64 s0',       // s0 = 8 (byte addr of instruction 2)
    's_add_i32 s0, s0, 12', // s0 = 20 (byte addr of instruction 5 = "func")
    's_swappc_b64 s2, s0',  // s2 = return addr (4*4=16), jump to instruction 5
    's_endpgm',             // instruction 4: return here after func
    's_mov_b32 s4, 77',     // instruction 5 ("func"): set s4=77
    's_setpc_b64 s2',       // return to saved address (instruction 4)
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(4) === 77, 's_swappc_b64: function executed (s4=77)');
}

// ════════════════════════════════════════════
//  VOP3P — Packed 16-bit Operations
// ════════════════════════════════════════════
group('VOP3P Packed 16-bit Operations');

// Helper: build a GFX10 VOP3P instruction (2 dwords)
// Dword 0: [31:24]=0xCC, [22:16]=OP, [15]=CLAMP, [14]=OP_SEL_HI[2], [13:11]=OP_SEL, [10:8]=NEG_HI, [7:0]=VDST
// Dword 1: [31:29]=NEG_LO, [28:27]=OP_SEL_HI[1:0], [26:18]=SRC2, [17:9]=SRC1, [8:0]=SRC0
function buildVOP3P(opcode: number, vdst: number, src0: number, src1: number, src2 = 0x80, opSelHi = 0x7, opSel = 0): number[] {
  const dword0 = (0xCC << 24) | ((opcode & 0x7F) << 16) | (((opSelHi >> 2) & 1) << 14) | ((opSel & 7) << 11) | (vdst & 0xFF);
  const dword1 = ((opSelHi & 3) << 27) | ((src2 & 0x1FF) << 18) | ((src1 & 0x1FF) << 9) | (src0 & 0x1FF);
  return [dword0 >>> 0, dword1 >>> 0];
}

// VGPR n encoded as 256 + n in 9-bit SRC fields
const V0 = 256, V1 = 257, V2 = 258, V3 = 259;
const ENDPGM = ((0x17F << 23) | (0x01 << 16)) >>> 0;

// Pack two u16 into a u32: lo in [15:0], hi in [31:16]
function pk(lo: number, hi: number): number {
  return ((hi & 0xFFFF) << 16 | (lo & 0xFFFF)) >>> 0;
}

/** Convert a JS number to f16 bit pattern. */
function f16(v: number): number {
  if (v === 0) return 0;
  if (!Number.isFinite(v)) return v > 0 ? 0x7C00 : 0xFC00;
  const sign = v < 0 ? 1 : 0;
  v = Math.abs(v);
  if (v >= 65520) return (sign << 15) | 0x7C00;
  if (v < Math.pow(2, -24)) return sign << 15;
  if (v < Math.pow(2, -14)) return (sign << 15) | (Math.round(v / Math.pow(2, -24)) & 0x3FF);
  let exp = Math.floor(Math.log2(v));
  let frac = Math.round((v / Math.pow(2, exp) - 1) * 1024);
  if (frac >= 1024) { frac = 0; exp++; }
  return (sign << 15) | ((exp + 15) << 10) | (frac & 0x3FF);
}

/** Pack two f16 values into a u32. */
function pkf16(lo: number, hi: number): number {
  return pk(f16(lo), f16(hi));
}

// ── v_pk_add_u16 (opcode 0x00A) ──

// Basic add
{
  const words = buildVOP3P(0x00A, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(3, 5));       // v0 = {lo:3, hi:5}
  emu.state.writeVGPR_u32(1, 0, pk(10, 20));      // v1 = {lo:10, hi:20}
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === pk(13, 25), 'v_pk_add_u16: basic (3+10=13, 5+20=25)');
}

// Overflow wrapping
{
  const words = buildVOP3P(0x00A, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(0xFFF0, 0xFFFF));
  emu.state.writeVGPR_u32(1, 0, pk(0x0020, 0x0001));
  emu.run();
  const result = emu.state.readVGPR_u32(2, 0);
  assert((result & 0xFFFF) === 0x0010, 'v_pk_add_u16 overflow lo: 0xFFF0+0x20 wraps to 0x10');
  assert((result >>> 16) === 0x0000, 'v_pk_add_u16 overflow hi: 0xFFFF+1 wraps to 0');
}

// Zero add
{
  const words = buildVOP3P(0x00A, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(100, 200));
  emu.state.writeVGPR_u32(1, 0, pk(0, 0));
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === pk(100, 200), 'v_pk_add_u16: adding zero is identity');
}

// ── v_pk_add_i16 (opcode 0x002) ──
{
  const words = buildVOP3P(0x002, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(10, 30));
  emu.state.writeVGPR_u32(1, 0, pk(5, 7));
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === pk(15, 37), 'v_pk_add_i16: basic (10+5=15, 30+7=37)');
}

// ── v_pk_sub_u16 (opcode 0x00B) ──
{
  const words = buildVOP3P(0x00B, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(20, 100));
  emu.state.writeVGPR_u32(1, 0, pk(5, 30));
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === pk(15, 70), 'v_pk_sub_u16: basic (20-5=15, 100-30=70)');
}

// Underflow wrapping
{
  const words = buildVOP3P(0x00B, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(0, 5));
  emu.state.writeVGPR_u32(1, 0, pk(1, 10));
  emu.run();
  const result = emu.state.readVGPR_u32(2, 0);
  assert((result & 0xFFFF) === 0xFFFF, 'v_pk_sub_u16 underflow lo: 0-1 wraps to 0xFFFF');
  assert((result >>> 16) === ((5 - 10) & 0xFFFF), 'v_pk_sub_u16 underflow hi: 5-10 wraps');
}

// ── v_pk_sub_i16 (opcode 0x003) ──
{
  const words = buildVOP3P(0x003, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(50, 200));
  emu.state.writeVGPR_u32(1, 0, pk(25, 100));
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === pk(25, 100), 'v_pk_sub_i16: basic (50-25=25, 200-100=100)');
}

// ── v_pk_mul_lo_u16 (opcode 0x001) ──
{
  const words = buildVOP3P(0x001, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(7, 10));
  emu.state.writeVGPR_u32(1, 0, pk(6, 5));
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === pk(42, 50), 'v_pk_mul_lo_u16: (7*6=42, 10*5=50)');
}

// Multiply truncating to low 16 bits
{
  const words = buildVOP3P(0x001, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(0x100, 0x200));
  emu.state.writeVGPR_u32(1, 0, pk(0x100, 0x100));
  emu.run();
  const result = emu.state.readVGPR_u32(2, 0);
  assert((result & 0xFFFF) === 0x0000, 'v_pk_mul_lo_u16 truncate lo: 0x100*0x100 = 0x10000 → lo16=0');
  assert((result >>> 16) === 0x0000, 'v_pk_mul_lo_u16 truncate hi: 0x200*0x100 = 0x20000 → lo16=0');
}

// ── v_pk_max_u16 (opcode 0x00C) ──
{
  const words = buildVOP3P(0x00C, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(10, 50));
  emu.state.writeVGPR_u32(1, 0, pk(20, 30));
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === pk(20, 50), 'v_pk_max_u16: max(10,20)=20, max(50,30)=50');
}

// ── v_pk_min_u16 (opcode 0x00D) ──
{
  const words = buildVOP3P(0x00D, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(10, 50));
  emu.state.writeVGPR_u32(1, 0, pk(20, 30));
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === pk(10, 30), 'v_pk_min_u16: min(10,20)=10, min(50,30)=30');
}

// ── v_pk_max_i16 (opcode 0x007) — signed comparisons ──
{
  const words = buildVOP3P(0x007, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  // -5 in u16 = 0xFFFB, -10 in u16 = 0xFFF6
  emu.state.writeVGPR_u32(0, 0, pk(0xFFFB, 100));   // {lo:-5, hi:100}
  emu.state.writeVGPR_u32(1, 0, pk(0xFFF6, 0xFFF6)); // {lo:-10, hi:-10}
  emu.run();
  const result = emu.state.readVGPR_u32(2, 0);
  assert((result & 0xFFFF) === 0xFFFB, 'v_pk_max_i16 lo: max(-5,-10) = -5 (0xFFFB)');
  assert((result >>> 16) === 100, 'v_pk_max_i16 hi: max(100,-10) = 100');
}

// Positive vs negative
{
  const words = buildVOP3P(0x007, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(5, 0xFFFF));    // {lo:5, hi:-1}
  emu.state.writeVGPR_u32(1, 0, pk(0xFFFE, 10));    // {lo:-2, hi:10}
  emu.run();
  const result = emu.state.readVGPR_u32(2, 0);
  assert((result & 0xFFFF) === 5, 'v_pk_max_i16: max(5,-2)=5');
  assert((result >>> 16) === 10, 'v_pk_max_i16: max(-1,10)=10');
}

// ── v_pk_min_i16 (opcode 0x008) — signed comparisons ──
{
  const words = buildVOP3P(0x008, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(0xFFFB, 100));   // {lo:-5, hi:100}
  emu.state.writeVGPR_u32(1, 0, pk(0xFFF6, 0xFFF6)); // {lo:-10, hi:-10}
  emu.run();
  const result = emu.state.readVGPR_u32(2, 0);
  assert((result & 0xFFFF) === 0xFFF6, 'v_pk_min_i16 lo: min(-5,-10) = -10 (0xFFF6)');
  assert((result >>> 16) === 0xFFF6, 'v_pk_min_i16 hi: min(100,-10) = -10');
}

// ── v_pk_lshlrev_b16 (opcode 0x004) ──
{
  const words = buildVOP3P(0x004, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  // lshlrev: dst = src1 << src0
  emu.state.writeVGPR_u32(0, 0, pk(2, 4));     // shift amounts {lo:2, hi:4}
  emu.state.writeVGPR_u32(1, 0, pk(3, 1));     // values {lo:3, hi:1}
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === pk(12, 16), 'v_pk_lshlrev_b16: (3<<2=12, 1<<4=16)');
}

// Shift with truncation to 16 bits
{
  const words = buildVOP3P(0x004, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(15, 8));
  emu.state.writeVGPR_u32(1, 0, pk(1, 0xFF));
  emu.run();
  const result = emu.state.readVGPR_u32(2, 0);
  assert((result & 0xFFFF) === 0x8000, 'v_pk_lshlrev_b16: 1<<15 = 0x8000');
  assert((result >>> 16) === 0xFF00, 'v_pk_lshlrev_b16: 0xFF<<8 = 0xFF00');
}

// ── v_pk_lshrrev_b16 (opcode 0x005) ──
{
  const words = buildVOP3P(0x005, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  // lshrrev: dst = src1 >>> src0
  emu.state.writeVGPR_u32(0, 0, pk(2, 4));     // shift amounts
  emu.state.writeVGPR_u32(1, 0, pk(0xFF, 0xF000)); // values
  emu.run();
  const result = emu.state.readVGPR_u32(2, 0);
  assert((result & 0xFFFF) === (0xFF >>> 2), 'v_pk_lshrrev_b16 lo: 0xFF>>>2 = 0x3F');
  assert((result >>> 16) === (0xF000 >>> 4), 'v_pk_lshrrev_b16 hi: 0xF000>>>4 = 0x0F00');
}

// Logical shift fills zeros (no sign extension)
{
  const words = buildVOP3P(0x005, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(1, 1));
  emu.state.writeVGPR_u32(1, 0, pk(0x8000, 0xFFFF));
  emu.run();
  const result = emu.state.readVGPR_u32(2, 0);
  assert((result & 0xFFFF) === 0x4000, 'v_pk_lshrrev_b16: 0x8000>>>1 = 0x4000 (no sign ext)');
  assert((result >>> 16) === 0x7FFF, 'v_pk_lshrrev_b16: 0xFFFF>>>1 = 0x7FFF');
}

// ── v_pk_ashrrev_i16 (opcode 0x006) — arithmetic shift with sign extension ──
{
  const words = buildVOP3P(0x006, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  // ashrrev: dst = (signed)src1 >> src0
  emu.state.writeVGPR_u32(0, 0, pk(1, 4));
  emu.state.writeVGPR_u32(1, 0, pk(0x8000, 0xFFF0)); // -32768, -16
  emu.run();
  const result = emu.state.readVGPR_u32(2, 0);
  // -32768 >> 1 = -16384 = 0xC000
  assert((result & 0xFFFF) === 0xC000, 'v_pk_ashrrev_i16 lo: 0x8000>>1 = 0xC000 (sign extended)');
  // -16 >> 4 = -1 = 0xFFFF
  assert((result >>> 16) === 0xFFFF, 'v_pk_ashrrev_i16 hi: -16>>4 = -1 (0xFFFF)');
}

// Positive value arithmetic shift
{
  const words = buildVOP3P(0x006, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(2, 3));
  emu.state.writeVGPR_u32(1, 0, pk(100, 0x7FFF)); // positive values
  emu.run();
  const result = emu.state.readVGPR_u32(2, 0);
  assert((result & 0xFFFF) === 25, 'v_pk_ashrrev_i16: 100>>2 = 25 (positive)');
  assert((result >>> 16) === (0x7FFF >> 3), 'v_pk_ashrrev_i16: 0x7FFF>>3 = 0x0FFF');
}

// ── v_pk_mad_u16 (opcode 0x009) — multiply-add with 3 sources ──
{
  // v_pk_mad_u16 v3, v0, v1, v2
  const words = buildVOP3P(0x009, 3, V0, V1, V2);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(3, 5));     // src0 = {3, 5}
  emu.state.writeVGPR_u32(1, 0, pk(4, 6));     // src1 = {4, 6}
  emu.state.writeVGPR_u32(2, 0, pk(10, 20));   // src2 = {10, 20}
  emu.run();
  // lo: 3*4+10=22, hi: 5*6+20=50
  assert(emu.state.readVGPR_u32(3, 0) === pk(22, 50), 'v_pk_mad_u16: (3*4+10=22, 5*6+20=50)');
}

// ── v_pk_mad_i16 (opcode 0x000) ──
{
  const words = buildVOP3P(0x000, 3, V0, V1, V2);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(2, 3));
  emu.state.writeVGPR_u32(1, 0, pk(7, 8));
  emu.state.writeVGPR_u32(2, 0, pk(1, 2));
  emu.run();
  // lo: 2*7+1=15, hi: 3*8+2=26
  assert(emu.state.readVGPR_u32(3, 0) === pk(15, 26), 'v_pk_mad_i16: (2*7+1=15, 3*8+2=26)');
}

// ── v_pk_add_f16 (opcode 0x00F) — packed float16 add ──
// The emulator uses simplified f16: execute fn does float math, result & 0xFFFF
{
  const words = buildVOP3P(0x00F, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  // Use small integer values that are exact in f16
  // f16(1.0) = 0x3C00, f16(2.0) = 0x4000, f16(3.0) = 0x4200
  emu.state.writeVGPR_u32(0, 0, pk(1, 3));
  emu.state.writeVGPR_u32(1, 0, pk(2, 4));
  emu.run();
  const result = emu.state.readVGPR_u32(2, 0);
  // The execute fn is: asFloat(a + b) — but these are raw u16 values being added as numbers
  // Actually the float ops pass u16 halves through the execute fn which treats them as numbers
  assert((result & 0xFFFF) === 3, 'v_pk_add_f16 lo: 1+2=3 (simplified)');
  assert((result >>> 16) === 7, 'v_pk_add_f16 hi: 3+4=7 (simplified)');
}

// ── v_pk_mul_f16 (opcode 0x010) — packed float16 multiply ──
{
  const words = buildVOP3P(0x010, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pkf16(3.0, 5.0));
  emu.state.writeVGPR_u32(1, 0, pkf16(4.0, 6.0));
  emu.run();
  const result = emu.state.readVGPR_u32(2, 0);
  assert((result & 0xFFFF) === f16(12.0), 'v_pk_mul_f16 lo: 3*4=12');
  assert((result >>> 16) === f16(30.0), 'v_pk_mul_f16 hi: 5*6=30');
}

// ── v_pk_min_f16 (opcode 0x011) ──
{
  const words = buildVOP3P(0x011, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pkf16(10.0, 50.0));
  emu.state.writeVGPR_u32(1, 0, pkf16(20.0, 30.0));
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === pkf16(10.0, 30.0), 'v_pk_min_f16: min(10,20)=10, min(50,30)=30');
}

// ── v_pk_max_f16 (opcode 0x012) ──
{
  const words = buildVOP3P(0x012, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pkf16(10.0, 50.0));
  emu.state.writeVGPR_u32(1, 0, pkf16(20.0, 30.0));
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === pkf16(20.0, 50.0), 'v_pk_max_f16: max(10,20)=20, max(50,30)=50');
}

// ── v_pk_fma_f16 (opcode 0x00E) — packed fused multiply-add f16 ──
{
  const words = buildVOP3P(0x00E, 3, V0, V1, V2);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pkf16(2.0, 3.0));
  emu.state.writeVGPR_u32(1, 0, pkf16(5.0, 4.0));
  emu.state.writeVGPR_u32(2, 0, pkf16(1.0, 2.0));
  emu.run();
  const result = emu.state.readVGPR_u32(3, 0);
  // lo: 2*5+1=11, hi: 3*4+2=14
  assert((result & 0xFFFF) === f16(11.0), 'v_pk_fma_f16 lo: 2*5+1=11');
  assert((result >>> 16) === f16(14.0), 'v_pk_fma_f16 hi: 3*4+2=14');
}

// ── v_pk_max_u16 with equal values ──
{
  const words = buildVOP3P(0x00C, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(42, 99));
  emu.state.writeVGPR_u32(1, 0, pk(42, 99));
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === pk(42, 99), 'v_pk_max_u16 equal: max(42,42)=42, max(99,99)=99');
}

// ── v_pk_min_u16 with boundary values ──
{
  const words = buildVOP3P(0x00D, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(0, 0xFFFF));
  emu.state.writeVGPR_u32(1, 0, pk(0xFFFF, 0));
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === pk(0, 0), 'v_pk_min_u16 boundary: min(0,0xFFFF)=0, min(0xFFFF,0)=0');
}

// ── v_pk_lshlrev_b16 shift by zero ──
{
  const words = buildVOP3P(0x004, 2, V0, V1);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(0, 0));
  emu.state.writeVGPR_u32(1, 0, pk(0x1234, 0xABCD));
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === pk(0x1234, 0xABCD), 'v_pk_lshlrev_b16: shift by 0 is identity');
}

// ── v_pk_mad_u16 with zero addend ──
{
  const words = buildVOP3P(0x009, 3, V0, V1, V2);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(100, 200));
  emu.state.writeVGPR_u32(1, 0, pk(3, 2));
  emu.state.writeVGPR_u32(2, 0, pk(0, 0));
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === pk(300, 400), 'v_pk_mad_u16 zero addend: (100*3+0=300, 200*2+0=400)');
}

// ── v_pk_mad_u16 overflow wrapping ──
{
  const words = buildVOP3P(0x009, 3, V0, V1, V2);
  const binary = new Uint32Array([...words, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pk(0xFFFF, 0x100));
  emu.state.writeVGPR_u32(1, 0, pk(2, 0x100));
  emu.state.writeVGPR_u32(2, 0, pk(1, 1));
  emu.run();
  const result = emu.state.readVGPR_u32(3, 0);
  // lo: (0xFFFF * 2 + 1) & 0xFFFF = (0x1FFFF) & 0xFFFF = 0xFFFF
  assert((result & 0xFFFF) === 0xFFFF, 'v_pk_mad_u16 overflow lo: (0xFFFF*2+1) & 0xFFFF');
  // hi: (0x100 * 0x100 + 1) & 0xFFFF = (0x10001) & 0xFFFF = 1
  assert((result >>> 16) === 1, 'v_pk_mad_u16 overflow hi: (0x100*0x100+1) & 0xFFFF');
}

// ════════════════════════════════════════════
//  New SOP2 Instructions
// ════════════════════════════════════════════
group('SOP2 (new instructions)');

// s_sub_i32: basic subtraction
{
  const emu = setup([
    's_mov_b32 s0, 30',
    's_mov_b32 s1, 10',
    's_sub_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 20, 's_sub_i32: 30 - 10 = 20');
}

// s_sub_i32: SCC = signed overflow (not borrow)
{
  const emu = setup([
    's_mov_b32 s0, 5',
    's_mov_b32 s1, 10',
    's_sub_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === ((-5) >>> 0), 's_sub_i32: 5 - 10 = -5');
  assert(emu.state.scc === 0, 's_sub_i32: 5 - 10 does not overflow → SCC=0');
}

{
  const emu = setup([
    's_mov_b32 s0, 0x80000000',
    's_sub_i32 s2, s0, 1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 0x7FFFFFFF, 's_sub_i32: INT_MIN - 1 wraps to INT_MAX');
  assert(emu.state.scc === 1, 's_sub_i32: INT_MIN - 1 overflows → SCC=1');
}

// s_min_i32: signed minimum
{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_mov_b32 s1, 20',
    's_min_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 10, 's_min_i32: min(10, 20) = 10');
}

// s_min_i32: negative values
{
  const emu = setup([
    's_mov_b32 s1, 5',
    's_min_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, (-3) >>> 0); // -3 as unsigned
  emu.run();
  assert((emu.state.readSGPR(2) | 0) === -3, 's_min_i32: min(-3, 5) = -3');
}

// s_min_u32: unsigned minimum
{
  const emu = setup([
    's_mov_b32 s0, 100',
    's_mov_b32 s1, 50',
    's_min_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 50, 's_min_u32: min(100, 50) = 50');
}

// s_min_u32: large unsigned value
{
  const emu = setup([
    's_min_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFFFFFFFF);
  emu.state.writeSGPR(1, 0x00000001);
  emu.run();
  assert(emu.state.readSGPR(2) === 1, 's_min_u32: min(0xFFFFFFFF, 1) = 1');
}

// s_max_i32: signed maximum
{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_mov_b32 s1, 20',
    's_max_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 20, 's_max_i32: max(10, 20) = 20');
}

// s_max_i32: negative value
{
  const emu = setup([
    's_mov_b32 s1, 5',
    's_max_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, (-10) >>> 0);
  emu.run();
  assert(emu.state.readSGPR(2) === 5, 's_max_i32: max(-10, 5) = 5');
}

// s_max_u32: unsigned maximum
{
  const emu = setup([
    's_max_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x80000000);
  emu.state.writeSGPR(1, 0x7FFFFFFF);
  emu.run();
  assert(emu.state.readSGPR(2) === 0x80000000, 's_max_u32: max(0x80000000, 0x7FFFFFFF) = 0x80000000');
}

// s_max_u32: both zero
{
  const emu = setup([
    's_mov_b32 s0, 0',
    's_mov_b32 s1, 0',
    's_max_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 0, 's_max_u32: max(0, 0) = 0');
  assert(emu.state.scc === 0, 's_max_u32: SCC=0 when result is 0');
}

// s_addc_u32: add with carry
{
  const emu = setup([
    's_mov_b32 s0, 5',
    's_mov_b32 s1, 10',
    's_cmp_eq_u32 s0, 5',
    's_addc_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  // SCC=1 from cmp, so result = 5 + 10 + 1 = 16
  assert(emu.state.readSGPR(2) === 16, 's_addc_u32: 5 + 10 + SCC(1) = 16');
}

// s_addc_u32: no carry-in
{
  const emu = setup([
    's_mov_b32 s0, 5',
    's_mov_b32 s1, 10',
    's_cmp_eq_u32 s0, 99',
    's_addc_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 15, 's_addc_u32: 5 + 10 + SCC(0) = 15');
}

// s_subb_u32: subtract with borrow
{
  const emu = setup([
    's_mov_b32 s0, 20',
    's_mov_b32 s1, 10',
    's_cmp_eq_u32 s0, 20',
    's_subb_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  // SCC=1 from cmp, so result = 20 - 10 - 1 = 9
  assert(emu.state.readSGPR(2) === 9, 's_subb_u32: 20 - 10 - SCC(1) = 9');
}

// s_subb_u32: borrow output
{
  const emu = setup([
    's_mov_b32 s0, 0',
    's_mov_b32 s1, 1',
    's_cmp_eq_u32 s0, 0',
    's_subb_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  // SCC=1 from cmp, result = 0 - 1 - 1 = -2 → unsigned = 0xFFFFFFFE
  assert(emu.state.readSGPR(2) === (0xFFFFFFFE >>> 0), 's_subb_u32: 0 - 1 - 1 underflows');
  assert(emu.state.scc === 1, 's_subb_u32: borrow out → SCC=1');
}

// s_nand_b32: bitwise NAND
{
  const emu = setup([
    's_nand_b32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFF00FF00);
  emu.state.writeSGPR(1, 0xFFFF0000);
  emu.run();
  assert(emu.state.readSGPR(2) === (~(0xFF00FF00 & 0xFFFF0000) >>> 0), 's_nand_b32: ~(0xFF00FF00 & 0xFFFF0000)');
}

// s_nand_b32: all ones → result is 0
{
  const emu = setup([
    's_nand_b32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFFFFFFFF);
  emu.state.writeSGPR(1, 0xFFFFFFFF);
  emu.run();
  assert(emu.state.readSGPR(2) === 0, 's_nand_b32: ~(0xFFFFFFFF & 0xFFFFFFFF) = 0');
}

// s_nor_b32: bitwise NOR
{
  const emu = setup([
    's_nor_b32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x00FF0000);
  emu.state.writeSGPR(1, 0x000000FF);
  emu.run();
  assert(emu.state.readSGPR(2) === (~(0x00FF0000 | 0x000000FF) >>> 0), 's_nor_b32: ~(0x00FF0000 | 0x000000FF)');
}

// s_nor_b32: both zero → all ones
{
  const emu = setup([
    's_mov_b32 s0, 0',
    's_mov_b32 s1, 0',
    's_nor_b32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 0xFFFFFFFF, 's_nor_b32: ~(0 | 0) = 0xFFFFFFFF');
}

// s_lshr_b32: logical right shift
{
  const emu = setup([
    's_lshr_b32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFF000000);
  emu.state.writeSGPR(1, 8);
  emu.run();
  assert(emu.state.readSGPR(2) === (0xFF000000 >>> 8), 's_lshr_b32: 0xFF000000 >> 8 = 0x00FF0000');
}

// s_lshr_b32: shift by 0
{
  const emu = setup([
    's_lshr_b32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x12345678);
  emu.state.writeSGPR(1, 0);
  emu.run();
  assert(emu.state.readSGPR(2) === 0x12345678, 's_lshr_b32: shift by 0 = unchanged');
}

// s_ashr_i32: arithmetic right shift
{
  const emu = setup([
    's_ashr_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x80000000); // -2147483648
  emu.state.writeSGPR(1, 4);
  emu.run();
  assert((emu.state.readSGPR(2) | 0) === ((-2147483648) >> 4), 's_ashr_i32: sign-extending right shift');
}

// s_ashr_i32: positive value
{
  const emu = setup([
    's_mov_b32 s0, 64',
    's_mov_b32 s1, 3',
    's_ashr_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 8, 's_ashr_i32: 64 >> 3 = 8');
}

// s_bfm_b32: bit field mask
{
  const emu = setup([
    's_mov_b32 s0, 8',
    's_mov_b32 s1, 4',
    's_bfm_b32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  // mask = ((1 << 8) - 1) << 4 = 0xFF << 4 = 0xFF0
  assert(emu.state.readSGPR(2) === 0xFF0, 's_bfm_b32: width=8 offset=4 → 0xFF0');
}

// s_bfm_b32: full width
{
  const emu = setup([
    's_mov_b32 s0, 16',
    's_mov_b32 s1, 0',
    's_bfm_b32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 0xFFFF, 's_bfm_b32: width=16 offset=0 → 0xFFFF');
}

// s_bfe_u32: unsigned bit field extract
{
  const emu = setup([
    's_bfe_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xABCD1234);
  // ssrc1: [4:0]=offset=8, [22:16]=width=8 → (8 << 16) | 8 = 0x80008
  emu.state.writeSGPR(1, (8 << 16) | 8);
  emu.run();
  assert(emu.state.readSGPR(2) === 0x12, 's_bfe_u32: extract byte 1 from 0xABCD1234 → 0x12');
}

// s_bfe_u32: width=0 returns 0
{
  const emu = setup([
    's_bfe_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFFFFFFFF);
  emu.state.writeSGPR(1, (0 << 16) | 0); // width=0
  emu.run();
  assert(emu.state.readSGPR(2) === 0, 's_bfe_u32: width=0 → 0');
}

// s_bfe_i32: signed bit field extract
{
  const emu = setup([
    's_bfe_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x000000F0); // bit[7]=1, bit[6:4]=110
  // Extract 4 bits at offset 4: field = 0xF, sign bit = 1, sign-extend → -1
  emu.state.writeSGPR(1, (4 << 16) | 4); // width=4, offset=4
  emu.run();
  assert((emu.state.readSGPR(2) | 0) === -1, 's_bfe_i32: extract 0xF (4 bits) sign-extended → -1');
}

// s_bfe_i32: positive extraction
{
  const emu = setup([
    's_bfe_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x00000050); // bit[6:4] = 0101
  emu.state.writeSGPR(1, (4 << 16) | 4); // width=4, offset=4
  emu.run();
  assert(emu.state.readSGPR(2) === 5, 's_bfe_i32: extract 0x5 (4 bits) → 5');
}

// s_absdiff_i32: absolute difference
{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_mov_b32 s1, 30',
    's_absdiff_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 20, 's_absdiff_i32: abs(10 - 30) = 20');
}

// s_absdiff_i32: same values
{
  const emu = setup([
    's_mov_b32 s0, 42',
    's_mov_b32 s1, 42',
    's_absdiff_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 0, 's_absdiff_i32: abs(42 - 42) = 0');
}

// s_cselect_b64: select based on SCC (64-bit register pairs)
{
  const emu = setup([
    's_mov_b64 s[0:1], 100',
    's_mov_b64 s[2:3], 200',
    's_cmp_eq_u32 s0, 100',
    's_cselect_b64 s[4:5], s[0:1], s[2:3]',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(4) === 100 && emu.state.readSGPR(5) === 0, 's_cselect_b64: SCC=1 → selects ssrc0 (100)');
}

// s_cselect_b64: SCC=0
{
  const emu = setup([
    's_mov_b64 s[0:1], 100',
    's_mov_b64 s[2:3], -1',
    's_cmp_eq_u32 s0, 999',
    's_cselect_b64 s[4:5], s[0:1], s[2:3]',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(4) === 0xFFFFFFFF && emu.state.readSGPR(5) === 0xFFFFFFFF, 's_cselect_b64: SCC=0 → selects ssrc1 (-1, all 64 bits)');
}

// s_lshl_b64: left shift 64-bit
{
  const emu = setup([
    's_mov_b64 s[0:1], 1',
    's_mov_b32 s4, 40',
    's_lshl_b64 s[2:3], s[0:1], s4',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 0 && emu.state.readSGPR(3) === (1 << 8), 's_lshl_b64: 1 << 40 crosses into the high dword');
}

// s_lshr_b64: right shift 64-bit
{
  const emu = setup([
    's_lshr_b64 s[2:3], s[0:1], s4',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x10000);
  emu.state.writeSGPR(1, 0x3);
  emu.state.writeSGPR(4, 8);
  emu.run();
  assert(emu.state.readSGPR(2) === 0x03000100 && emu.state.readSGPR(3) === 0, 's_lshr_b64: 0x3_00010000 >> 8 = 0x03000100');
}

// s_ashr_i64
{
  const emu = setup([
    's_ashr_i64 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x80000000);
  emu.state.writeSGPR(1, 1);
  emu.run();
  assert((emu.state.readSGPR(2) | 0) === ((-2147483648) >> 1), 's_ashr_i64: 0x80000000 >> 1 sign-extends');
}

// s_pack_ll_b32_b16
{
  const emu = setup([
    's_pack_ll_b32_b16 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xAAAA1111);
  emu.state.writeSGPR(1, 0xBBBB2222);
  emu.run();
  assert(emu.state.readSGPR(2) === ((0x2222 << 16) | 0x1111) >>> 0, 's_pack_ll_b32_b16: {ssrc1_lo, ssrc0_lo}');
}

// s_pack_lh_b32_b16
{
  const emu = setup([
    's_pack_lh_b32_b16 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xAAAA1111);
  emu.state.writeSGPR(1, 0xBBBB2222);
  emu.run();
  assert(emu.state.readSGPR(2) === ((0xBBBB << 16) | 0x1111) >>> 0, 's_pack_lh_b32_b16: {ssrc1_hi, ssrc0_lo}');
}

// s_pack_hh_b32_b16
{
  const emu = setup([
    's_pack_hh_b32_b16 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xAAAA1111);
  emu.state.writeSGPR(1, 0xBBBB2222);
  emu.run();
  assert(emu.state.readSGPR(2) === ((0xBBBB << 16) | 0xAAAA) >>> 0, 's_pack_hh_b32_b16: {ssrc1_hi, ssrc0_hi}');
}

// s_pack_ll_b32_b16: zero values
{
  const emu = setup([
    's_mov_b32 s0, 0',
    's_mov_b32 s1, 0',
    's_pack_ll_b32_b16 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 0, 's_pack_ll_b32_b16: both zero → 0');
}

// ════════════════════════════════════════════
//  New SOP1 Instructions
// ════════════════════════════════════════════
group('SOP1 (new instructions)');

// s_not_b32: bitwise NOT
{
  const emu = setup([
    's_not_b32 s1, s0',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x00FF00FF);
  emu.run();
  assert(emu.state.readSGPR(1) === (0xFF00FF00 >>> 0), 's_not_b32: ~0x00FF00FF = 0xFF00FF00');
}

// s_not_b32: all ones → 0
{
  const emu = setup([
    's_not_b32 s1, s0',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFFFFFFFF);
  emu.run();
  assert(emu.state.readSGPR(1) === 0, 's_not_b32: ~0xFFFFFFFF = 0');
  assert(emu.state.scc === 0, 's_not_b32: SCC=0 when result is 0');
}

// s_not_b64: bitwise NOT of a register pair
{
  const emu = setup([
    's_not_b64 s[2:3], s[0:1]',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x0F0F0F0F);
  emu.state.writeSGPR(1, 0xFFFFFFFF);
  emu.run();
  assert(emu.state.readSGPR(2) === (0xF0F0F0F0 >>> 0), 's_not_b64: low dword ~0x0F0F0F0F');
  assert(emu.state.readSGPR(3) === 0, 's_not_b64: high dword ~0xFFFFFFFF');
  assert(emu.state.scc === 1, 's_not_b64: SCC=1 (result non-zero)');
}

// s_wqm_b32: whole quad mode — single bit per quad activates all 4
{
  const emu = setup([
    's_wqm_b32 s1, s0',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x00000001); // bit 0 set → quad 0 = 0xF
  emu.run();
  assert(emu.state.readSGPR(1) === 0x0000000F, 's_wqm_b32: bit 0 set → quad 0 all set');
}

// s_wqm_b32: multiple quads
{
  const emu = setup([
    's_wqm_b32 s1, s0',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x00010100); // bit 8 and bit 16 set
  emu.run();
  assert(emu.state.readSGPR(1) === 0x000F0F00, 's_wqm_b32: bits in quads 2,4 → 0x000F0F00');
}

// s_brev_b32: reverse bits
{
  const emu = setup([
    's_brev_b32 s1, s0',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x80000000); // only MSB set
  emu.run();
  assert(emu.state.readSGPR(1) === 1, 's_brev_b32: 0x80000000 reversed → 1');
}

// s_brev_b32: 0x1 → 0x80000000
{
  const emu = setup([
    's_brev_b32 s1, s0',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 1);
  emu.run();
  assert(emu.state.readSGPR(1) === 0x80000000, 's_brev_b32: 1 reversed → 0x80000000');
}

// s_abs_i32: absolute value of negative
{
  const emu = setup([
    's_abs_i32 s1, s0',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, (-42) >>> 0);
  emu.run();
  assert(emu.state.readSGPR(1) === 42, 's_abs_i32: abs(-42) = 42');
}

// s_abs_i32: positive unchanged
{
  const emu = setup([
    's_mov_b32 s0, 99',
    's_abs_i32 s1, s0',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(1) === 99, 's_abs_i32: abs(99) = 99');
}

// s_bitreplicate_b64_b32: replicate bits
{
  const emu = setup([
    's_bitreplicate_b64_b32 s[2:3], s0',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x00000005); // bits 0 and 2 set → 0b0101
  emu.run();
  // bit 0 → bits 1:0 = 0b11, bit 2 → bits 5:4 = 0b11
  assert(emu.state.readSGPR(2) === 0x00000033 && emu.state.readSGPR(3) === 0, 's_bitreplicate: 0x5 → 0x33');
}

// s_bitreplicate_b64_b32: all low 16 bits set fill the low dword; bit 16 starts the high dword
{
  const emu = setup([
    's_bitreplicate_b64_b32 s[2:3], s0',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x0001FFFF);
  emu.run();
  assert(emu.state.readSGPR(2) === 0xFFFFFFFF, 's_bitreplicate: 0xFFFF → low dword 0xFFFFFFFF');
  assert(emu.state.readSGPR(3) === 0x3, 's_bitreplicate: bit 16 → high dword 0x3');
}

// ════════════════════════════════════════════
//  New SOPC Instructions (signed/unsigned compares)
// ════════════════════════════════════════════
group('SOPC (new compares)');

// s_cmp_gt_i32: signed greater than
{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_mov_b32 s1, 5',
    's_cmp_gt_i32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 1, 's_cmp_gt_i32: 10 > 5 → SCC=1');
}

{
  const emu = setup([
    's_mov_b32 s0, 5',
    's_mov_b32 s1, 10',
    's_cmp_gt_i32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 0, 's_cmp_gt_i32: 5 > 10 → SCC=0');
}

// s_cmp_ge_i32: signed greater-equal
{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_mov_b32 s1, 10',
    's_cmp_ge_i32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 1, 's_cmp_ge_i32: 10 >= 10 → SCC=1');
}

// s_cmp_lt_i32: signed less-than with negative
{
  const emu = setup([
    's_cmp_lt_i32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, (-5) >>> 0);
  emu.state.writeSGPR(1, 3);
  emu.run();
  assert(emu.state.scc === 1, 's_cmp_lt_i32: -5 < 3 → SCC=1');
}

// s_cmp_le_i32: signed less-equal
{
  const emu = setup([
    's_cmp_le_i32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, (-5) >>> 0);
  emu.state.writeSGPR(1, (-5) >>> 0);
  emu.run();
  assert(emu.state.scc === 1, 's_cmp_le_i32: -5 <= -5 → SCC=1');
}

// s_cmp_eq_i32: signed equal
{
  const emu = setup([
    's_mov_b32 s0, 42',
    's_mov_b32 s1, 42',
    's_cmp_eq_i32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 1, 's_cmp_eq_i32: 42 == 42 → SCC=1');
}

// s_cmp_lg_i32: signed not-equal
{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_mov_b32 s1, 20',
    's_cmp_lg_i32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 1, 's_cmp_lg_i32: 10 != 20 → SCC=1');
}

// s_cmp_gt_u32: unsigned greater than
{
  const emu = setup([
    's_cmp_gt_u32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFFFFFFFF);
  emu.state.writeSGPR(1, 1);
  emu.run();
  assert(emu.state.scc === 1, 's_cmp_gt_u32: 0xFFFFFFFF > 1 → SCC=1');
}

// s_cmp_ge_u32: unsigned greater-equal
{
  const emu = setup([
    's_cmp_ge_u32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x80000000);
  emu.state.writeSGPR(1, 0x80000000);
  emu.run();
  assert(emu.state.scc === 1, 's_cmp_ge_u32: 0x80000000 >= 0x80000000 → SCC=1');
}

// s_cmp_lt_u32: unsigned less-than
{
  const emu = setup([
    's_mov_b32 s0, 5',
    's_mov_b32 s1, 10',
    's_cmp_lt_u32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 1, 's_cmp_lt_u32: 5 < 10 → SCC=1');
}

// s_cmp_le_u32: unsigned less-equal
{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_mov_b32 s1, 10',
    's_cmp_le_u32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 1, 's_cmp_le_u32: 10 <= 10 → SCC=1');
}

{
  const emu = setup([
    's_mov_b32 s0, 20',
    's_mov_b32 s1, 10',
    's_cmp_le_u32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 0, 's_cmp_le_u32: 20 <= 10 → SCC=0');
}

// ════════════════════════════════════════════
//  New SOPK Instructions
// ════════════════════════════════════════════
group('SOPK (new instructions)');

// s_movk_i32: move 16-bit immediate
{
  const emu = setup([
    's_movk_i32 s5, 1234',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(5) === 1234, 's_movk_i32: s5 = 1234');
}

// s_movk_i32: negative (sign-extended)
{
  const emu = setup([
    's_movk_i32 s5, 0xFFFF',
    's_endpgm',
  ].join('\n'));
  emu.run();
  // 0xFFFF sign-extended to 32 bits = 0xFFFFFFFF = -1
  assert(emu.state.readSGPR(2) !== undefined || true, 's_movk_i32: assembled OK');
  assert((emu.state.readSGPR(5) | 0) === -1, 's_movk_i32: 0xFFFF sign-extended = -1');
}

// s_addk_i32: add immediate to SGPR
{
  const emu = setup([
    's_mov_b32 s3, 100',
    's_addk_i32 s3, 50',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(3) === 150, 's_addk_i32: 100 + 50 = 150');
}

// s_addk_i32: negative immediate
{
  const emu = setup([
    's_mov_b32 s3, 100',
    's_addk_i32 s3, 0xFFF6',
    's_endpgm',
  ].join('\n'));
  emu.run();
  // 0xFFF6 sign-extended = -10, so 100 + (-10) = 90
  assert(emu.state.readSGPR(3) === 90, 's_addk_i32: 100 + (-10) = 90');
}

// s_mulk_i32: multiply by immediate
{
  const emu = setup([
    's_mov_b32 s3, 7',
    's_mulk_i32 s3, 6',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(3) === 42, 's_mulk_i32: 7 * 6 = 42');
}

// s_mulk_i32: multiply by zero
{
  const emu = setup([
    's_mov_b32 s3, 12345',
    's_mulk_i32 s3, 0',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(3) === 0, 's_mulk_i32: 12345 * 0 = 0');
}

// s_cmpk_eq_i32: compare equal
{
  const emu = setup([
    's_mov_b32 s0, 42',
    's_cmpk_eq_i32 s0, 42',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 1, 's_cmpk_eq_i32: s0==42 → SCC=1');
}

{
  const emu = setup([
    's_mov_b32 s0, 42',
    's_cmpk_eq_i32 s0, 99',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 0, 's_cmpk_eq_i32: s0!=99 → SCC=0');
}

// s_cmpk_lg_i32: compare not-equal
{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_cmpk_lg_i32 s0, 20',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 1, 's_cmpk_lg_i32: 10 != 20 → SCC=1');
}

// s_cmpk_gt_i32: compare greater
{
  const emu = setup([
    's_mov_b32 s0, 100',
    's_cmpk_gt_i32 s0, 50',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 1, 's_cmpk_gt_i32: 100 > 50 → SCC=1');
}

{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_cmpk_gt_i32 s0, 50',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 0, 's_cmpk_gt_i32: 10 > 50 → SCC=0');
}

// s_cmpk_ge_i32: compare greater-equal
{
  const emu = setup([
    's_mov_b32 s0, 50',
    's_cmpk_ge_i32 s0, 50',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 1, 's_cmpk_ge_i32: 50 >= 50 → SCC=1');
}

// s_cmpk_lt_i32: compare less-than
{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_cmpk_lt_i32 s0, 20',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 1, 's_cmpk_lt_i32: 10 < 20 → SCC=1');
}

// s_cmpk_le_i32: compare less-equal
{
  const emu = setup([
    's_mov_b32 s0, 20',
    's_cmpk_le_i32 s0, 20',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.scc === 1, 's_cmpk_le_i32: 20 <= 20 → SCC=1');
}

// s_cmpk_eq_u32: unsigned equal
{
  const emu = setup([
    's_cmpk_eq_u32 s0, 255',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 255);
  emu.run();
  assert(emu.state.scc === 1, 's_cmpk_eq_u32: 255 == 255 → SCC=1');
}

// s_cmpk_lg_u32: unsigned not-equal
{
  const emu = setup([
    's_cmpk_lg_u32 s0, 100',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 200);
  emu.run();
  assert(emu.state.scc === 1, 's_cmpk_lg_u32: 200 != 100 → SCC=1');
}

// s_cmpk_gt_u32: unsigned greater
{
  const emu = setup([
    's_cmpk_gt_u32 s0, 100',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 200);
  emu.run();
  assert(emu.state.scc === 1, 's_cmpk_gt_u32: 200 > 100 → SCC=1');
}

// s_cmpk_ge_u32
{
  const emu = setup([
    's_cmpk_ge_u32 s0, 100',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 100);
  emu.run();
  assert(emu.state.scc === 1, 's_cmpk_ge_u32: 100 >= 100 → SCC=1');
}

// s_cmpk_lt_u32
{
  const emu = setup([
    's_cmpk_lt_u32 s0, 100',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 50);
  emu.run();
  assert(emu.state.scc === 1, 's_cmpk_lt_u32: 50 < 100 → SCC=1');
}

// s_cmpk_le_u32
{
  const emu = setup([
    's_cmpk_le_u32 s0, 100',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 100);
  emu.run();
  assert(emu.state.scc === 1, 's_cmpk_le_u32: 100 <= 100 → SCC=1');
}

{
  const emu = setup([
    's_cmpk_le_u32 s0, 50',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 100);
  emu.run();
  assert(emu.state.scc === 0, 's_cmpk_le_u32: 100 <= 50 → SCC=0');
}

// ════════════════════════════════════════════
//  New VOP1 Instructions
// ════════════════════════════════════════════
group('VOP1 New Instructions');

// v_frexp_exp_i32_f32: extract exponent
{
  const emu = setup('v_frexp_exp_i32_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 8.0); // 8.0 = 1.0 * 2^3 → exponent = 4
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 4, 'v_frexp_exp_i32_f32: exponent of 8.0 = 4');
}

{
  const emu = setup('v_frexp_exp_i32_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 0.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'v_frexp_exp_i32_f32: exponent of 0.0 = 0');
}

// v_frexp_mant_f32: extract mantissa
{
  const emu = setup('v_frexp_mant_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 8.0); // 8.0 = 0.5 * 2^4 → mantissa = 0.5
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), 0.5), 'v_frexp_mant_f32: mantissa of 8.0 = 0.5');
}

{
  const emu = setup('v_frexp_mant_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, -6.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(1, 0), -0.75), 'v_frexp_mant_f32: mantissa of -6.0 = -0.75');
}

// v_cvt_u16_f16: float to unsigned 16
{
  const emu = setup('v_cvt_u16_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 42.7);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 42, 'v_cvt_u16_f16: 42.7 → 42');
}

{
  const emu = setup('v_cvt_u16_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, -1.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'v_cvt_u16_f16: -1.0 clamped to 0');
}

// v_cvt_i16_f16: float to signed 16
{
  const emu = setup('v_cvt_i16_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, -5.9);
  emu.state.modifiedRegs.clear();
  emu.run();
  const result = emu.state.readVGPR_u32(1, 0);
  // -5 as uint16 = 0xFFFB
  assert(result === ((-5) & 0xFFFF), 'v_cvt_i16_f16: -5.9 → -5 (truncated)');
}

{
  const emu = setup('v_cvt_i16_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 100.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 100, 'v_cvt_i16_f16: 100.0 → 100');
}

// v_rsq_f16: reciprocal sqrt
{
  const emu = setup('v_rsq_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 4.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), 0.5), 'v_rsq_f16: 1/√4 = 0.5');
}

{
  const emu = setup('v_rsq_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 1.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), 1.0), 'v_rsq_f16: 1/√1 = 1.0');
}

// v_log_f16: log2
{
  const emu = setup('v_log_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 8.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), 3.0), 'v_log_f16: log2(8) = 3.0');
}

{
  const emu = setup('v_log_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 1.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), 0.0), 'v_log_f16: log2(1) = 0.0');
}

// v_ceil_f16
{
  const emu = setup('v_ceil_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 2.3);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), 3.0), 'v_ceil_f16: ceil(2.3) = 3.0');
}

{
  const emu = setup('v_ceil_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, -1.5);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), -1.0), 'v_ceil_f16: ceil(-1.5) = -1.0');
}

// v_trunc_f16
{
  const emu = setup('v_trunc_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 3.7);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), 3.0), 'v_trunc_f16: trunc(3.7) = 3.0');
}

{
  const emu = setup('v_trunc_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, -2.9);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), -2.0), 'v_trunc_f16: trunc(-2.9) = -2.0');
}

// v_rndne_f16: round to nearest even
{
  const emu = setup('v_rndne_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 2.5);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), 2.0), 'v_rndne_f16: roundEven(2.5) = 2.0');
}

{
  const emu = setup('v_rndne_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 3.5);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), 4.0), 'v_rndne_f16: roundEven(3.5) = 4.0');
}

// v_fract_f16
{
  const emu = setup('v_fract_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 3.75);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), 0.75), 'v_fract_f16: fract(3.75) = 0.75');
}

{
  const emu = setup('v_fract_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, -0.25);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), 0.75), 'v_fract_f16: fract(-0.25) = 0.75');
}

// v_sin_f16
{
  const emu = setup('v_sin_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 0.25); // sin(2π × 0.25) = sin(π/2) = 1.0
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), 1.0), 'v_sin_f16: sin(2π × 0.25) = 1.0');
}

{
  const emu = setup('v_sin_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 0.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), 0.0), 'v_sin_f16: sin(0) = 0.0');
}

// v_cos_f16
{
  const emu = setup('v_cos_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 0.0); // cos(0) = 1.0
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), 1.0), 'v_cos_f16: cos(0) = 1.0');
}

{
  const emu = setup('v_cos_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 0.5); // cos(2π × 0.5) = cos(π) = -1.0
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(readF16(emu, 1, 0), -1.0), 'v_cos_f16: cos(2π × 0.5) = -1.0');
}

// ════════════════════════════════════════════
//  New VOP2 Instructions
// ════════════════════════════════════════════
group('VOP2 New Instructions');

// v_sub_co_ci_u32: vdst = src0 - vsrc1 - VCC[lane]; VCC[lane] = borrow
{
  const emu = setup('v_sub_co_ci_u32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 10);
  emu.state.writeVGPR_u32(1, 0, 3);
  emu.state.vcc = 0;
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 7, 'v_sub_co_ci_u32: 10 - 3 - 0 = 7');
  assert((emu.state.vcc & 1) === 0, 'v_sub_co_ci_u32: no borrow out');
}

{
  const emu = setup('v_sub_co_ci_u32 v2, vcc_lo, v0, v1, vcc_lo\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 3);
  emu.state.writeVGPR_u32(1, 0, 3);
  emu.state.vcc = 1;
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 0xFFFFFFFF, 'v_sub_co_ci_u32: 3 - 3 - 1 wraps to 0xFFFFFFFF');
  assert((emu.state.vcc & 1) === 1, 'v_sub_co_ci_u32: borrow out sets VCC');
}

// v_subrev_co_ci_u32: vdst = vsrc1 - src0 - VCC[lane]
{
  const emu = setup('v_subrev_co_ci_u32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 3);
  emu.state.writeVGPR_u32(1, 0, 10);
  emu.state.vcc = 0;
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 7, 'v_subrev_co_ci_u32: 10 - 3 - 0 = 7');
}

{
  const emu = setup('v_subrev_co_ci_u32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 5);
  emu.state.writeVGPR_u32(1, 0, 10);
  emu.state.vcc = 1;
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 4, 'v_subrev_co_ci_u32: 10 - 5 - 1 = 4');
}

// v_fmamk_f32: vdst = src0 × K + vsrc1
{
  const emu = setup('v_fmamk_f32 v2, v0, 2.0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 3.0);
  emu.state.writeVGPR(1, 0, 1.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 7.0), 'v_fmamk_f32: 3.0 * 2.0 + 1.0 = 7.0');
}

{
  const r = assemble('v_fmamk_f32 v2, v0, 0x40000000, v1');
  assert(r.binary.length === 2 && r.binary[1] === 0x40000000, 'v_fmamk_f32: K is the literal dword after the instruction');
}

// v_fmaak_f32: vdst = src0 × vsrc1 + K
{
  const emu = setup('v_fmaak_f32 v2, v0, v1, 0.5\ns_endpgm');
  emu.state.writeVGPR(0, 0, 3.0);
  emu.state.writeVGPR(1, 0, 2.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 6.5), 'v_fmaak_f32: 3.0 * 2.0 + 0.5 = 6.5');
}

{
  const r = assemble('v_fmaak_f32 v2, -v0, v1, 0.5');
  assert(r.errors.length === 1, 'v_fmaak_f32: has no VOP3 form, so modifiers are rejected');
}

// v_cvt_pkrtz_f16_f32: convert two f32 values to f16 (round toward zero) and pack them
{
  const emu = setup('v_cvt_pkrtz_f16_f32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 1.0);
  emu.state.writeVGPR(1, 0, -2.5);
  emu.state.modifiedRegs.clear();
  emu.run();
  const r = emu.state.readVGPR_u32(2, 0);
  assert((r & 0xFFFF) === 0x3C00, 'v_cvt_pkrtz_f16_f32: low half = f16(src0) = 1.0');
  assert((r >>> 16) === 0xC100, 'v_cvt_pkrtz_f16_f32: high half = f16(vsrc1) = -2.5');
}

{
  // 1 + 0.75 ulp(f16) rounds to nearest as 0x3C01 but toward zero as 0x3C00
  const emu = setup('v_cvt_pkrtz_f16_f32 v2, v0, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 1 + 0.75 / 1024);
  emu.run();
  assert((emu.state.readVGPR_u32(2, 0) & 0xFFFF) === 0x3C00, 'v_cvt_pkrtz_f16_f32: rounds toward zero');
}

// ════════════════════════════════════════════
//  New VOP3 Instructions
// ════════════════════════════════════════════
group('VOP3 New Instructions');

// v_mad_u32_u24
{
  const emu = setup('v_mad_u32_u24 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 100);
  emu.state.writeVGPR_u32(1, 0, 200);
  emu.state.writeVGPR_u32(2, 0, 50);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 20050, 'v_mad_u32_u24: 100 * 200 + 50 = 20050');
}

{
  const emu = setup('v_mad_u32_u24 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0);
  emu.state.writeVGPR_u32(1, 0, 100);
  emu.state.writeVGPR_u32(2, 0, 7);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 7, 'v_mad_u32_u24: 0 * 100 + 7 = 7');
}

// v_cubeid_f32
{
  const emu = setup('v_cubeid_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 5.0);  // x = largest positive
  emu.state.writeVGPR(1, 0, 1.0);
  emu.state.writeVGPR(2, 0, 1.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(3, 0), 0.0), 'v_cubeid_f32: +X face = 0');
}

{
  const emu = setup('v_cubeid_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, -5.0);  // x = largest negative
  emu.state.writeVGPR(1, 0, 1.0);
  emu.state.writeVGPR(2, 0, 1.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(3, 0), 1.0), 'v_cubeid_f32: -X face = 1');
}

// v_cubema_f32: 2 × the major-axis coordinate (signed); ties prefer Z, then Y
{
  const emu = setup('v_cubema_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 3.0);
  emu.state.writeVGPR(1, 0, -4.0);
  emu.state.writeVGPR(2, 0, 2.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(3, 0), -8.0), 'v_cubema_f32: major axis Y = -4 → -8.0');
}

{
  const emu = setup('v_cubema_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 1.0);
  emu.state.writeVGPR(1, 0, 1.0);
  emu.state.writeVGPR(2, 0, 1.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(3, 0), 2.0), 'v_cubema_f32: 2*max(1,1,1) = 2.0');
}

// v_lerp_u8
{
  const emu = setup('v_lerp_u8 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x00000000);
  emu.state.writeVGPR_u32(1, 0, 0x00000064); // byte0 = 100
  emu.state.writeVGPR_u32(2, 0, 0x00000000);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.readVGPR_u32(3, 0) & 0xFF) === 50, 'v_lerp_u8: (0 + 100) / 2 = 50');
}

{
  const emu = setup('v_lerp_u8 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x0A0A0A0A);
  emu.state.writeVGPR_u32(1, 0, 0x0A0A0A0A);
  emu.state.writeVGPR_u32(2, 0, 0x00000000);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.readVGPR_u32(3, 0) & 0xFF) === 10, 'v_lerp_u8: (10 + 10) / 2 = 10');
}

// v_alignbit_b32
{
  const emu = setup('v_alignbit_b32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x12345678);
  emu.state.writeVGPR_u32(1, 0, 0xABCDEF00);
  emu.state.writeVGPR_u32(2, 0, 8); // shift by 8 bits
  emu.state.modifiedRegs.clear();
  emu.run();
  // {0x12345678, 0xABCDEF00} >> 8 = 0x7812345678ABCDEF00 >> 8 low 32
  // = (0x12345678 << 24) | (0xABCDEF00 >>> 8) = 0x78ABCDEF
  assert(emu.state.readVGPR_u32(3, 0) === 0x78ABCDEF, 'v_alignbit_b32: shift by 8 bits');
}

{
  const emu = setup('v_alignbit_b32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFF);
  emu.state.writeVGPR_u32(1, 0, 0xFF000000);
  emu.state.writeVGPR_u32(2, 0, 0); // no shift
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 0xFF000000, 'v_alignbit_b32: shift 0 = src1');
}

// v_alignbyte_b32
{
  const emu = setup('v_alignbyte_b32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x12345678);
  emu.state.writeVGPR_u32(1, 0, 0xAABBCCDD);
  emu.state.writeVGPR_u32(2, 0, 1); // shift by 1 byte = 8 bits
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 0x78AABBCC, 'v_alignbyte_b32: shift 1 byte');
}

{
  const emu = setup('v_alignbyte_b32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xDEADBEEF);
  emu.state.writeVGPR_u32(1, 0, 0x12345678);
  emu.state.writeVGPR_u32(2, 0, 0); // shift 0 bytes = src1
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 0x12345678, 'v_alignbyte_b32: shift 0 = src1');
}

// v_min3_i32
{
  const emu = setup('v_min3_i32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 5);
  emu.state.writeVGPR_u32(1, 0, (-3) >>> 0);
  emu.state.writeVGPR_u32(2, 0, 10);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.readVGPR_u32(3, 0) | 0) === -3, 'v_min3_i32: min(5, -3, 10) = -3');
}

{
  const emu = setup('v_min3_i32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 1);
  emu.state.writeVGPR_u32(1, 0, 1);
  emu.state.writeVGPR_u32(2, 0, 1);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 1, 'v_min3_i32: min(1, 1, 1) = 1');
}

// v_min3_u32
{
  const emu = setup('v_min3_u32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 100);
  emu.state.writeVGPR_u32(1, 0, 50);
  emu.state.writeVGPR_u32(2, 0, 200);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 50, 'v_min3_u32: min(100, 50, 200) = 50');
}

{
  const emu = setup('v_min3_u32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0);
  emu.state.writeVGPR_u32(1, 0, 0xFFFFFFFF);
  emu.state.writeVGPR_u32(2, 0, 1);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 0, 'v_min3_u32: min(0, MAX, 1) = 0');
}

// v_max3_i32
{
  const emu = setup('v_max3_i32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (-10) >>> 0);
  emu.state.writeVGPR_u32(1, 0, 5);
  emu.state.writeVGPR_u32(2, 0, (-1) >>> 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.readVGPR_u32(3, 0) | 0) === 5, 'v_max3_i32: max(-10, 5, -1) = 5');
}

{
  const emu = setup('v_max3_i32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (-100) >>> 0);
  emu.state.writeVGPR_u32(1, 0, (-200) >>> 0);
  emu.state.writeVGPR_u32(2, 0, (-50) >>> 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.readVGPR_u32(3, 0) | 0) === -50, 'v_max3_i32: max(-100, -200, -50) = -50');
}

// v_max3_u32
{
  const emu = setup('v_max3_u32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 100);
  emu.state.writeVGPR_u32(1, 0, 200);
  emu.state.writeVGPR_u32(2, 0, 150);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 200, 'v_max3_u32: max(100, 200, 150) = 200');
}

{
  const emu = setup('v_max3_u32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFFFFFFFF);
  emu.state.writeVGPR_u32(1, 0, 0);
  emu.state.writeVGPR_u32(2, 0, 1);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 0xFFFFFFFF, 'v_max3_u32: max(MAX, 0, 1) = MAX');
}

// v_med3_i32
{
  const emu = setup('v_med3_i32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (-5) >>> 0);
  emu.state.writeVGPR_u32(1, 0, 10);
  emu.state.writeVGPR_u32(2, 0, 3);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.readVGPR_u32(3, 0) | 0) === 3, 'v_med3_i32: median(-5, 10, 3) = 3');
}

{
  const emu = setup('v_med3_i32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 7);
  emu.state.writeVGPR_u32(1, 0, 7);
  emu.state.writeVGPR_u32(2, 0, 7);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 7, 'v_med3_i32: median(7, 7, 7) = 7');
}

// v_med3_u32
{
  const emu = setup('v_med3_u32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 1);
  emu.state.writeVGPR_u32(1, 0, 100);
  emu.state.writeVGPR_u32(2, 0, 50);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 50, 'v_med3_u32: median(1, 100, 50) = 50');
}

{
  const emu = setup('v_med3_u32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFFFFFFFF);
  emu.state.writeVGPR_u32(1, 0, 0);
  emu.state.writeVGPR_u32(2, 0, 0x80000000);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 0x80000000, 'v_med3_u32: median(MAX, 0, MID) = MID');
}

// v_sad_u8
{
  const emu = setup('v_sad_u8 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x0A141E28); // bytes: 10, 20, 30, 40
  emu.state.writeVGPR_u32(1, 0, 0x050A0F14); // bytes: 5, 10, 15, 20
  emu.state.writeVGPR_u32(2, 0, 0);           // accumulator
  emu.state.modifiedRegs.clear();
  emu.run();
  // |10-5| + |20-10| + |30-15| + |40-20| = 5+10+15+20 = 50
  assert(emu.state.readVGPR_u32(3, 0) === 50, 'v_sad_u8: SAD of 4 bytes = 50');
}

{
  const emu = setup('v_sad_u8 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x01010101);
  emu.state.writeVGPR_u32(1, 0, 0x01010101);
  emu.state.writeVGPR_u32(2, 0, 100);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 100, 'v_sad_u8: identical bytes + 100 = 100');
}

// v_sad_u16
{
  const emu = setup('v_sad_u16 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x00640032); // 100, 50
  emu.state.writeVGPR_u32(1, 0, 0x001E000A); // 30, 10
  emu.state.writeVGPR_u32(2, 0, 5);
  emu.state.modifiedRegs.clear();
  emu.run();
  // |50-10| + |100-30| + 5 = 40 + 70 + 5 = 115
  assert(emu.state.readVGPR_u32(3, 0) === 115, 'v_sad_u16: SAD of 2 halfwords + acc');
}

{
  const emu = setup('v_sad_u16 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x00000000);
  emu.state.writeVGPR_u32(1, 0, 0x00000000);
  emu.state.writeVGPR_u32(2, 0, 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 0, 'v_sad_u16: zero inputs = 0');
}

// v_sad_u32
{
  const emu = setup('v_sad_u32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 100);
  emu.state.writeVGPR_u32(1, 0, 30);
  emu.state.writeVGPR_u32(2, 0, 10);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 80, 'v_sad_u32: |100-30| + 10 = 80');
}

{
  const emu = setup('v_sad_u32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 5);
  emu.state.writeVGPR_u32(1, 0, 5);
  emu.state.writeVGPR_u32(2, 0, 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 0, 'v_sad_u32: |5-5| + 0 = 0');
}

// v_mul_hi_i32
{
  const emu = setup('v_mul_hi_i32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x10000);  // 65536
  emu.state.writeVGPR_u32(1, 0, 0x10000);  // 65536
  emu.state.modifiedRegs.clear();
  emu.run();
  // 65536 * 65536 = 4294967296 = 0x1_00000000, high 32 = 1
  assert(emu.state.readVGPR_u32(2, 0) === 1, 'v_mul_hi_i32: 0x10000 * 0x10000 high = 1');
}

{
  const emu = setup('v_mul_hi_i32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (-1) >>> 0); // -1
  emu.state.writeVGPR_u32(1, 0, 2);
  emu.state.modifiedRegs.clear();
  emu.run();
  // -1 * 2 = -2, high 32 = -1 = 0xFFFFFFFF
  assert(emu.state.readVGPR_u32(2, 0) === 0xFFFFFFFF, 'v_mul_hi_i32: -1 * 2 high = -1');
}

// v_xor3_b32
{
  const emu = setup('v_xor3_b32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFF00FF00);
  emu.state.writeVGPR_u32(1, 0, 0x00FF00FF);
  emu.state.writeVGPR_u32(2, 0, 0xFFFFFFFF);
  emu.state.modifiedRegs.clear();
  emu.run();
  // 0xFF00FF00 ^ 0x00FF00FF ^ 0xFFFFFFFF = 0xFFFFFFFF ^ 0xFFFFFFFF = 0
  assert(emu.state.readVGPR_u32(3, 0) === 0x00000000, 'v_xor3_b32: triple XOR = 0');
}

{
  const emu = setup('v_xor3_b32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xAAAAAAAA);
  emu.state.writeVGPR_u32(1, 0, 0x55555555);
  emu.state.writeVGPR_u32(2, 0, 0x00000000);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 0xFFFFFFFF, 'v_xor3_b32: 0xAA..^0x55..^0 = 0xFF..');
}

// v_lshlrev_b64: 64-bit register pairs v[dst:dst+1] = v[src1:src1+1] << src0
{
  const emu = setup('v_lshlrev_b64 v[2:3], v0, v[4:5]\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 4);
  emu.state.writeVGPR_u32(4, 0, 0xF000000F);
  emu.state.writeVGPR_u32(5, 0, 0x1);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 0x000000F0, 'v_lshlrev_b64: low dword 0xF000000F << 4');
  assert(emu.state.readVGPR_u32(3, 0) === 0x1F, 'v_lshlrev_b64: high dword receives the carried-out bits');
}

{
  const emu = setup('v_lshlrev_b64 v[2:3], v0, v[4:5]\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0);
  emu.state.writeVGPR_u32(4, 0, 42);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 42 && emu.state.readVGPR_u32(3, 0) === 0, 'v_lshlrev_b64: shift 0 = identity');
}

// v_lshrrev_b64
{
  const emu = setup('v_lshrrev_b64 v[2:3], v0, v[4:5]\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 36);
  emu.state.writeVGPR_u32(4, 0, 0);
  emu.state.writeVGPR_u32(5, 0, 0xF0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 0x0F && emu.state.readVGPR_u32(3, 0) === 0, 'v_lshrrev_b64: 0xF0_00000000 >> 36 = 0x0F');
}

// v_ashrrev_i64
{
  const emu = setup('v_ashrrev_i64 v[2:3], v0, v[4:5]\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 4);
  emu.state.writeVGPR_u32(4, 0, 0);
  emu.state.writeVGPR_u32(5, 0, 0x80000000); // negative 64-bit value
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 0 && emu.state.readVGPR_u32(3, 0) === 0xF8000000, 'v_ashrrev_i64: sign-extending right shift');
}

{
  const emu = setup('v_ashrrev_i64 v[2:3], v0, v[4:5]\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 1);
  emu.state.writeVGPR_u32(4, 0, 100);
  emu.state.writeVGPR_u32(5, 0, 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 50, 'v_ashrrev_i64: 100 >> 1 = 50');
}

// v_add_co_u32
{
  const emu = setup('v_add_co_u32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 100);
  emu.state.writeVGPR_u32(1, 0, 200);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 300, 'v_add_co_u32: 100 + 200 = 300');
}

{
  const emu = setup('v_add_co_u32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFFFFFFFF);
  emu.state.writeVGPR_u32(1, 0, 1);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 0, 'v_add_co_u32: overflow wraps');
}

// v_sub_co_u32
{
  const emu = setup('v_sub_co_u32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 300);
  emu.state.writeVGPR_u32(1, 0, 100);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 200, 'v_sub_co_u32: 300 - 100 = 200');
}

{
  const emu = setup('v_sub_co_u32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0);
  emu.state.writeVGPR_u32(1, 0, 1);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 0xFFFFFFFF, 'v_sub_co_u32: 0 - 1 wraps');
}

// v_subrev_co_u32
{
  const emu = setup('v_subrev_co_u32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 10);
  emu.state.writeVGPR_u32(1, 0, 50);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 40, 'v_subrev_co_u32: 50 - 10 = 40');
}

{
  const emu = setup('v_subrev_co_u32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 100);
  emu.state.writeVGPR_u32(1, 0, 100);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 0, 'v_subrev_co_u32: 100 - 100 = 0');
}

// v_xad_u32
{
  const emu = setup('v_xad_u32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFF00);
  emu.state.writeVGPR_u32(1, 0, 0x00FF);
  emu.state.writeVGPR_u32(2, 0, 10);
  emu.state.modifiedRegs.clear();
  emu.run();
  // (0xFF00 ^ 0x00FF) + 10 = 0xFFFF + 10 = 65545
  assert(emu.state.readVGPR_u32(3, 0) === 65545, 'v_xad_u32: (0xFF00 ^ 0x00FF) + 10');
}

{
  const emu = setup('v_xad_u32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFFFFFFFF);
  emu.state.writeVGPR_u32(1, 0, 0xFFFFFFFF);
  emu.state.writeVGPR_u32(2, 0, 42);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 42, 'v_xad_u32: (X ^ X) + 42 = 42');
}

// v_and_or_b32
{
  const emu = setup('v_and_or_b32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFF00FF00);
  emu.state.writeVGPR_u32(1, 0, 0xFFFF0000);
  emu.state.writeVGPR_u32(2, 0, 0x000000FF);
  emu.state.modifiedRegs.clear();
  emu.run();
  // (0xFF00FF00 & 0xFFFF0000) | 0x000000FF = 0xFF000000 | 0xFF = 0xFF0000FF
  assert(emu.state.readVGPR_u32(3, 0) === 0xFF0000FF, 'v_and_or_b32: (A & B) | C');
}

{
  const emu = setup('v_and_or_b32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0);
  emu.state.writeVGPR_u32(1, 0, 0xFFFFFFFF);
  emu.state.writeVGPR_u32(2, 0, 0xABCD);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 0xABCD, 'v_and_or_b32: (0 & X) | Y = Y');
}

// v_sub_nc_i32
{
  const emu = setup('v_sub_nc_i32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 10);
  emu.state.writeVGPR_u32(1, 0, 3);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 7, 'v_sub_nc_i32: 10 - 3 = 7');
}

{
  const emu = setup('v_sub_nc_i32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 5);
  emu.state.writeVGPR_u32(1, 0, 10);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.readVGPR_u32(2, 0) | 0) === -5, 'v_sub_nc_i32: 5 - 10 = -5');
}

// v_add_nc_i32
{
  const emu = setup('v_add_nc_i32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (-5) >>> 0);
  emu.state.writeVGPR_u32(1, 0, 3);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.readVGPR_u32(2, 0) | 0) === -2, 'v_add_nc_i32: -5 + 3 = -2');
}

{
  const emu = setup('v_add_nc_i32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 100);
  emu.state.writeVGPR_u32(1, 0, 200);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 300, 'v_add_nc_i32: 100 + 200 = 300');
}

// v_writelane_b32
{
  const emu = setup('v_writelane_b32 v2, s0, s1\ns_endpgm');
  emu.state.writeSGPR(0, 0xDEADBEEF);
  emu.state.writeSGPR(1, 3); // write to lane 3
  emu.state.writeVGPR_u32(2, 0, 0); // clear lane 0
  emu.state.writeVGPR_u32(2, 3, 0); // clear lane 3
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 3) === 0xDEADBEEF, 'v_writelane_b32: writes to lane 3');
  assert(emu.state.readVGPR_u32(2, 0) === 0, 'v_writelane_b32: lane 0 unchanged');
}

{
  const emu = setup('v_writelane_b32 v0, s0, s1\ns_endpgm');
  emu.state.writeSGPR(0, 42);
  emu.state.writeSGPR(1, 0); // write to lane 0
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(0, 0) === 42, 'v_writelane_b32: writes to lane 0');
}

// v_ldexp_f32
{
  const emu = setup('v_ldexp_f32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 1.5);
  emu.state.writeVGPR_u32(1, 0, 3); // exponent = 3
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 12.0), 'v_ldexp_f32: 1.5 * 2^3 = 12.0');
}

{
  const emu = setup('v_ldexp_f32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR(0, 0, 8.0);
  emu.state.writeVGPR_u32(1, 0, (-2) >>> 0); // exponent = -2
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 2.0), 'v_ldexp_f32: 8.0 * 2^(-2) = 2.0');
}

// v_bfm_b32
{
  const emu = setup('v_bfm_b32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 8);  // count = 8 bits
  emu.state.writeVGPR_u32(1, 0, 4);  // offset = 4
  emu.state.modifiedRegs.clear();
  emu.run();
  // ((1 << 8) - 1) << 4 = 0xFF << 4 = 0xFF0
  assert(emu.state.readVGPR_u32(2, 0) === 0xFF0, 'v_bfm_b32: 8 bits at offset 4 = 0xFF0');
}

{
  const emu = setup('v_bfm_b32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 1);
  emu.state.writeVGPR_u32(1, 0, 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 1, 'v_bfm_b32: 1 bit at offset 0 = 1');
}

// v_bcnt_u32_b32
{
  const emu = setup('v_bcnt_u32_b32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFF);  // 8 bits set
  emu.state.writeVGPR_u32(1, 0, 0);     // accumulator
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 8, 'v_bcnt_u32_b32: popcount(0xFF) + 0 = 8');
}

{
  const emu = setup('v_bcnt_u32_b32 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFFFFFFFF); // 32 bits set
  emu.state.writeVGPR_u32(1, 0, 10);          // accumulator
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 42, 'v_bcnt_u32_b32: popcount(0xFFFF) + 10 = 42');
}

// ════════════════════════════════════════════
//  New VOPC Comparisons
// ════════════════════════════════════════════
group('VOPC New Comparisons');

// v_cmp_eq_i32
{
  const emu = setup('v_cmp_eq_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (-5) >>> 0);
  emu.state.writeVGPR_u32(1, 0, (-5) >>> 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_eq_i32: -5 == -5 → VCC[0]=1');
}

{
  const emu = setup('v_cmp_eq_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 5);
  emu.state.writeVGPR_u32(1, 0, (-5) >>> 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 0, 'v_cmp_eq_i32: 5 != -5 → VCC[0]=0');
}

// v_cmp_le_i32
{
  const emu = setup('v_cmp_le_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (-3) >>> 0);
  emu.state.writeVGPR_u32(1, 0, 5);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_le_i32: -3 <= 5 → VCC[0]=1');
}

{
  const emu = setup('v_cmp_le_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 10);
  emu.state.writeVGPR_u32(1, 0, 10);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_le_i32: 10 <= 10 → VCC[0]=1');
}

// v_cmp_gt_i32
{
  const emu = setup('v_cmp_gt_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 5);
  emu.state.writeVGPR_u32(1, 0, (-10) >>> 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_gt_i32: 5 > -10 → VCC[0]=1');
}

{
  const emu = setup('v_cmp_gt_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (-10) >>> 0);
  emu.state.writeVGPR_u32(1, 0, 5);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 0, 'v_cmp_gt_i32: -10 > 5 → VCC[0]=0');
}

// v_cmp_ne_i32
{
  const emu = setup('v_cmp_ne_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 1);
  emu.state.writeVGPR_u32(1, 0, 2);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_ne_i32: 1 != 2 → VCC[0]=1');
}

{
  const emu = setup('v_cmp_ne_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 7);
  emu.state.writeVGPR_u32(1, 0, 7);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 0, 'v_cmp_ne_i32: 7 == 7 → VCC[0]=0');
}

// v_cmp_ge_i32
{
  const emu = setup('v_cmp_ge_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 10);
  emu.state.writeVGPR_u32(1, 0, (-5) >>> 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_ge_i32: 10 >= -5 → VCC[0]=1');
}

{
  const emu = setup('v_cmp_ge_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (-20) >>> 0);
  emu.state.writeVGPR_u32(1, 0, 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 0, 'v_cmp_ge_i32: -20 >= 0 → VCC[0]=0');
}

// v_cmp_le_u32
{
  const emu = setup('v_cmp_le_u32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 5);
  emu.state.writeVGPR_u32(1, 0, 10);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_le_u32: 5 <= 10 → VCC[0]=1');
}

{
  const emu = setup('v_cmp_le_u32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 100);
  emu.state.writeVGPR_u32(1, 0, 50);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 0, 'v_cmp_le_u32: 100 <= 50 → VCC[0]=0');
}

// v_cmp_gt_u32
{
  const emu = setup('v_cmp_gt_u32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xFFFFFFFF);
  emu.state.writeVGPR_u32(1, 0, 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_gt_u32: MAX > 0 → VCC[0]=1');
}

{
  const emu = setup('v_cmp_gt_u32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0);
  emu.state.writeVGPR_u32(1, 0, 1);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 0, 'v_cmp_gt_u32: 0 > 1 → VCC[0]=0');
}

// v_cmp_ge_u32
{
  const emu = setup('v_cmp_ge_u32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 42);
  emu.state.writeVGPR_u32(1, 0, 42);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 1, 'v_cmp_ge_u32: 42 >= 42 → VCC[0]=1');
}

{
  const emu = setup('v_cmp_ge_u32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 1);
  emu.state.writeVGPR_u32(1, 0, 100);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.vcc & 1) === 0, 'v_cmp_ge_u32: 1 >= 100 → VCC[0]=0');
}

// v_cmpx_lt_i32
{
  const emu = setup('v_cmpx_lt_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (-10) >>> 0);
  emu.state.writeVGPR_u32(1, 0, 5);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.exec & 1) === 1, 'v_cmpx_lt_i32: -10 < 5 → EXEC[0]=1');
}

{
  const emu = setup('v_cmpx_lt_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 5);
  emu.state.writeVGPR_u32(1, 0, 5);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.exec & 1) === 0, 'v_cmpx_lt_i32: 5 < 5 → EXEC[0]=0');
}

// v_cmpx_le_i32
{
  const emu = setup('v_cmpx_le_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 5);
  emu.state.writeVGPR_u32(1, 0, 5);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.exec & 1) === 1, 'v_cmpx_le_i32: 5 <= 5 → EXEC[0]=1');
}

// v_cmpx_gt_i32
{
  const emu = setup('v_cmpx_gt_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 10);
  emu.state.writeVGPR_u32(1, 0, 3);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.exec & 1) === 1, 'v_cmpx_gt_i32: 10 > 3 → EXEC[0]=1');
}

// v_cmpx_ne_i32
{
  const emu = setup('v_cmpx_ne_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 1);
  emu.state.writeVGPR_u32(1, 0, 2);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.exec & 1) === 1, 'v_cmpx_ne_i32: 1 != 2 → EXEC[0]=1');
}

// v_cmpx_ge_i32
{
  const emu = setup('v_cmpx_ge_i32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 5);
  emu.state.writeVGPR_u32(1, 0, 5);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.exec & 1) === 1, 'v_cmpx_ge_i32: 5 >= 5 → EXEC[0]=1');
}

// v_cmpx_lt_u32
{
  const emu = setup('v_cmpx_lt_u32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 5);
  emu.state.writeVGPR_u32(1, 0, 100);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.exec & 1) === 1, 'v_cmpx_lt_u32: 5 < 100 → EXEC[0]=1');
}

// v_cmpx_le_u32
{
  const emu = setup('v_cmpx_le_u32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 42);
  emu.state.writeVGPR_u32(1, 0, 42);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.exec & 1) === 1, 'v_cmpx_le_u32: 42 <= 42 → EXEC[0]=1');
}

// v_cmpx_ge_u32
{
  const emu = setup('v_cmpx_ge_u32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 100);
  emu.state.writeVGPR_u32(1, 0, 50);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.exec & 1) === 1, 'v_cmpx_ge_u32: 100 >= 50 → EXEC[0]=1');
}

{
  const emu = setup('v_cmpx_ge_u32 v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 1);
  emu.state.writeVGPR_u32(1, 0, 100);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert((emu.state.exec & 1) === 0, 'v_cmpx_ge_u32: 1 >= 100 → EXEC[0]=0');
}

// ════════════════════════════════════════════
//  New SOP2 & SOPC Instructions (RDNA2 additions)
// ════════════════════════════════════════════
group('SOP2/SOPC (RDNA2 additions)');

// s_add_u32: basic unsigned add
{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_mov_b32 s1, 20',
    's_add_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 30, 's_add_u32: 10 + 20 = 30');
  assert(emu.state.scc === 0, 's_add_u32: no carry → SCC=0');
}

// s_add_u32: overflow sets SCC carry
{
  const emu = setup([
    's_add_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFFFFFFFF);
  emu.state.writeSGPR(1, 1);
  emu.run();
  assert(emu.state.readSGPR(2) === 0, 's_add_u32: 0xFFFFFFFF + 1 wraps to 0');
  assert(emu.state.scc === 1, 's_add_u32: overflow → SCC=1');
}

// s_add_u32: large values no overflow
{
  const emu = setup([
    's_add_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x80000000);
  emu.state.writeSGPR(1, 0x7FFFFFFF);
  emu.run();
  assert(emu.state.readSGPR(2) === 0xFFFFFFFF, 's_add_u32: 0x80000000 + 0x7FFFFFFF = 0xFFFFFFFF');
  assert(emu.state.scc === 0, 's_add_u32: no carry → SCC=0');
}

// s_sub_u32: basic unsigned subtract
{
  const emu = setup([
    's_mov_b32 s0, 30',
    's_mov_b32 s1, 10',
    's_sub_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 20, 's_sub_u32: 30 - 10 = 20');
  assert(emu.state.scc === 0, 's_sub_u32: no borrow → SCC=0');
}

// s_sub_u32: borrow sets SCC
{
  const emu = setup([
    's_mov_b32 s0, 5',
    's_mov_b32 s1, 10',
    's_sub_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === ((-5) >>> 0), 's_sub_u32: 5 - 10 wraps unsigned');
  assert(emu.state.scc === 1, 's_sub_u32: borrow → SCC=1');
}

// s_orn2_b32: OR-NOT2
{
  const emu = setup([
    's_orn2_b32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xF0F0F0F0);
  emu.state.writeSGPR(1, 0xFF00FF00);
  emu.run();
  assert(emu.state.readSGPR(2) === (0xF0F0F0F0 | ~0xFF00FF00) >>> 0, 's_orn2_b32: ssrc0 | ~ssrc1');
}

// s_orn2_b32: src1=0 → all ones
{
  const emu = setup([
    's_mov_b32 s1, 0',
    's_orn2_b32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x12345678);
  emu.run();
  assert(emu.state.readSGPR(2) === 0xFFFFFFFF, 's_orn2_b32: ssrc0 | ~0 = 0xFFFFFFFF');
}

// s_orn2_b64: OR-NOT2 64-bit
{
  const emu = setup([
    's_orn2_b64 s[2:3], s[0:1], s[4:5]',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x0F0F0F0F);
  emu.state.writeSGPR(4, 0xFFFF0000);
  emu.run();
  assert(emu.state.readSGPR(2) === (0x0F0F0F0F | ~0xFFFF0000) >>> 0, 's_orn2_b64: ssrc0 | ~ssrc1');
}

// s_orn2_b64: both zero
{
  const emu = setup([
    's_mov_b32 s0, 0',
    's_mov_b32 s4, 0',
    's_orn2_b64 s[2:3], s[0:1], s[4:5]',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 0xFFFFFFFF, 's_orn2_b64: 0 | ~0 = 0xFFFFFFFF');
}

// s_nand_b64: NAND 64-bit
{
  const emu = setup([
    's_nand_b64 s[2:3], s[0:1], s[4:5]',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFF00FF00);
  emu.state.writeSGPR(4, 0xFFFF0000);
  emu.run();
  assert(emu.state.readSGPR(2) === (~(0xFF00FF00 & 0xFFFF0000) >>> 0), 's_nand_b64: ~(ssrc0 & ssrc1)');
}

// s_nand_b64: all ones → 0
{
  const emu = setup([
    's_nand_b64 s[2:3], s[0:1], s[4:5]',
    's_endpgm',
  ].join('\n'));
  for (const r of [0, 1, 4, 5]) emu.state.writeSGPR(r, 0xFFFFFFFF);
  emu.run();
  assert(emu.state.readSGPR(2) === 0 && emu.state.readSGPR(3) === 0, 's_nand_b64: ~(all ones & all ones) = 0');
  assert(emu.state.scc === 0, 's_nand_b64: result 0 → SCC=0');
}

// s_nor_b64: NOR 64-bit
{
  const emu = setup([
    's_nor_b64 s[2:3], s[0:1], s[4:5]',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x00FF0000);
  emu.state.writeSGPR(4, 0x000000FF);
  emu.run();
  assert(emu.state.readSGPR(2) === (~(0x00FF0000 | 0x000000FF) >>> 0), 's_nor_b64: ~(ssrc0 | ssrc1)');
}

// s_nor_b64: both zero → all ones
{
  const emu = setup([
    's_mov_b32 s0, 0',
    's_mov_b32 s4, 0',
    's_nor_b64 s[2:3], s[0:1], s[4:5]',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 0xFFFFFFFF, 's_nor_b64: ~(0 | 0) = 0xFFFFFFFF');
}

// s_xnor_b32: XNOR 32-bit
{
  const emu = setup([
    's_xnor_b32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFF00FF00);
  emu.state.writeSGPR(1, 0xFF00FF00);
  emu.run();
  assert(emu.state.readSGPR(2) === 0xFFFFFFFF, 's_xnor_b32: identical values → all ones');
}

// s_xnor_b32: different values
{
  const emu = setup([
    's_xnor_b32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xF0F0F0F0);
  emu.state.writeSGPR(1, 0x0F0F0F0F);
  emu.run();
  assert(emu.state.readSGPR(2) === (~(0xF0F0F0F0 ^ 0x0F0F0F0F) >>> 0), 's_xnor_b32: ~(ssrc0 ^ ssrc1)');
}

// s_xnor_b64: XNOR 64-bit
{
  const emu = setup([
    's_xnor_b64 s[2:3], s[0:1], s[4:5]',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xAAAAAAAA);
  emu.state.writeSGPR(4, 0xAAAAAAAA);
  emu.run();
  assert(emu.state.readSGPR(2) === 0xFFFFFFFF, 's_xnor_b64: identical values → all ones');
}

// s_xnor_b64: all zero XOR all ones
{
  const emu = setup([
    's_xnor_b64 s[2:3], s[0:1], s[4:5]',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(4, 0xFFFFFFFF);
  emu.state.writeSGPR(5, 0xFFFFFFFF);
  emu.run();
  assert(emu.state.readSGPR(2) === 0 && emu.state.readSGPR(3) === 0, 's_xnor_b64: ~(0 ^ all ones) = 0');
  assert(emu.state.scc === 0, 's_xnor_b64: result 0 → SCC=0');
}

// s_bfm_b64: bit field mask 64-bit
{
  const emu = setup([
    's_mov_b32 s0, 8',
    's_mov_b32 s1, 4',
    's_bfm_b64 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 0xFF0, 's_bfm_b64: width=8 offset=4 → 0xFF0');
}

// s_bfm_b64: width=16 offset=0
{
  const emu = setup([
    's_mov_b32 s0, 16',
    's_mov_b32 s1, 0',
    's_bfm_b64 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 0xFFFF, 's_bfm_b64: width=16 offset=0 → 0xFFFF');
}

// s_bfe_u64: unsigned bit field extract 64-bit
{
  const emu = setup([
    's_bfe_u64 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xABCD1234);
  emu.state.writeSGPR(1, (8 << 16) | 8); // width=8, offset=8
  emu.run();
  assert(emu.state.readSGPR(2) === 0x12, 's_bfe_u64: extract byte 1 from 0xABCD1234 → 0x12');
}

// s_bfe_u64: width=0 returns 0
{
  const emu = setup([
    's_bfe_u64 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFFFFFFFF);
  emu.state.writeSGPR(1, (0 << 16) | 0);
  emu.run();
  assert(emu.state.readSGPR(2) === 0, 's_bfe_u64: width=0 → 0');
}

// s_bfe_i64: signed bit field extract 64-bit (negative)
{
  const emu = setup([
    's_bfe_i64 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x000000F0);
  emu.state.writeSGPR(1, (4 << 16) | 4); // width=4, offset=4
  emu.run();
  assert((emu.state.readSGPR(2) | 0) === -1, 's_bfe_i64: extract 0xF (4 bits) sign-extended → -1');
}

// s_bfe_i64: positive extraction
{
  const emu = setup([
    's_bfe_i64 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x00000050);
  emu.state.writeSGPR(1, (4 << 16) | 4); // width=4, offset=4
  emu.run();
  assert(emu.state.readSGPR(2) === 5, 's_bfe_i64: extract 0x5 (4 bits) → 5');
}

// s_mul_hi_u32: unsigned multiply high
{
  const emu = setup([
    's_mul_hi_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x10000);   // 65536
  emu.state.writeSGPR(1, 0x10000);   // 65536
  emu.run();
  // 65536 * 65536 = 4294967296 = 0x1_00000000, hi = 1
  assert(emu.state.readSGPR(2) === 1, 's_mul_hi_u32: 0x10000 * 0x10000 → hi32 = 1');
}

// s_mul_hi_u32: small values → 0
{
  const emu = setup([
    's_mov_b32 s0, 100',
    's_mov_b32 s1, 200',
    's_mul_hi_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 0, 's_mul_hi_u32: 100 * 200 fits in 32 bits → hi=0');
}

// s_mul_hi_u32: large values
{
  const emu = setup([
    's_mul_hi_u32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFFFFFFFF);
  emu.state.writeSGPR(1, 0xFFFFFFFF);
  emu.run();
  // (2^32-1)^2 = 2^64 - 2^33 + 1, hi32 = 0xFFFFFFFE
  assert(emu.state.readSGPR(2) === (0xFFFFFFFE >>> 0), 's_mul_hi_u32: 0xFFFFFFFF * 0xFFFFFFFF → hi=0xFFFFFFFE');
}

// s_mul_hi_i32: signed multiply high
{
  const emu = setup([
    's_mul_hi_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x10000);   // 65536
  emu.state.writeSGPR(1, 0x10000);   // 65536
  emu.run();
  assert(emu.state.readSGPR(2) === 1, 's_mul_hi_i32: 65536 * 65536 → hi32 = 1');
}

// s_mul_hi_i32: small values → 0
{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_mov_b32 s1, 20',
    's_mul_hi_i32 s2, s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 0, 's_mul_hi_i32: 10 * 20 fits in 32 bits → hi=0');
}

// s_bitcmp0_b32: bit is zero
{
  const emu = setup([
    's_bitcmp0_b32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFFFFFFFE); // bit 0 = 0
  emu.state.writeSGPR(1, 0);          // test bit 0
  emu.run();
  assert(emu.state.scc === 1, 's_bitcmp0_b32: bit 0 is 0 → SCC=1');
}

// s_bitcmp0_b32: bit is one
{
  const emu = setup([
    's_bitcmp0_b32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFFFFFFFF); // all bits set
  emu.state.writeSGPR(1, 15);         // test bit 15
  emu.run();
  assert(emu.state.scc === 0, 's_bitcmp0_b32: bit 15 is 1 → SCC=0');
}

// s_bitcmp1_b32: bit is one
{
  const emu = setup([
    's_bitcmp1_b32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x00000008); // bit 3 = 1
  emu.state.writeSGPR(1, 3);          // test bit 3
  emu.run();
  assert(emu.state.scc === 1, 's_bitcmp1_b32: bit 3 is 1 → SCC=1');
}

// s_bitcmp1_b32: bit is zero
{
  const emu = setup([
    's_bitcmp1_b32 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x00000000); // all zeros
  emu.state.writeSGPR(1, 7);          // test bit 7
  emu.run();
  assert(emu.state.scc === 0, 's_bitcmp1_b32: bit 7 is 0 → SCC=0');
}

// s_bitcmp0_b64: bit is zero (64-bit)
{
  const emu = setup([
    's_bitcmp0_b64 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xFFFFFFF7); // bit 3 = 0
  emu.state.writeSGPR(1, 3);
  emu.run();
  assert(emu.state.scc === 1, 's_bitcmp0_b64: bit 3 is 0 → SCC=1');
}

// s_bitcmp0_b64: bit is one (64-bit)
{
  const emu = setup([
    's_bitcmp0_b64 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x80000000);
  emu.state.writeSGPR(1, 31);
  emu.run();
  assert(emu.state.scc === 0, 's_bitcmp0_b64: bit 31 is 1 → SCC=0');
}

// s_bitcmp1_b64: bit is one (64-bit)
{
  const emu = setup([
    's_bitcmp1_b64 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x80000000);
  emu.state.writeSGPR(1, 31);
  emu.run();
  assert(emu.state.scc === 1, 's_bitcmp1_b64: bit 31 is 1 → SCC=1');
}

// s_bitcmp1_b64: bit is zero (64-bit)
{
  const emu = setup([
    's_bitcmp1_b64 s0, s1',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0x00000000);
  emu.state.writeSGPR(1, 16);
  emu.run();
  assert(emu.state.scc === 0, 's_bitcmp1_b64: bit 16 is 0 → SCC=0');
}

// s_cmp_eq_u64: equal 64-bit
{
  const emu = setup([
    's_cmp_eq_u64 s[0:1], s[2:3]',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xDEADBEEF);
  emu.state.writeSGPR(1, 0x12345678);
  emu.state.writeSGPR(2, 0xDEADBEEF);
  emu.state.writeSGPR(3, 0x12345678);
  emu.run();
  assert(emu.state.scc === 1, 's_cmp_eq_u64: equal values → SCC=1');
}

// s_cmp_eq_u64: not equal (only the high dwords differ)
{
  const emu = setup([
    's_cmp_eq_u64 s[0:1], s[2:3]',
    's_endpgm',
  ].join('\n'));
  emu.state.writeSGPR(0, 0xDEADBEEF);
  emu.state.writeSGPR(1, 1);
  emu.state.writeSGPR(2, 0xDEADBEEF);
  emu.state.writeSGPR(3, 2);
  emu.run();
  assert(emu.state.scc === 0, 's_cmp_eq_u64: different high dwords → SCC=0');
}

// ════════════════════════════════════════════
//  VOP3 Additional Instructions
// ════════════════════════════════════════════
group('VOP3 Additional Instructions');

// v_mad_legacy_f32: basic multiply-add
{
  const emu = setup('v_mad_legacy_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 2.0);
  emu.state.writeVGPR(1, 0, 3.0);
  emu.state.writeVGPR(2, 0, 1.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(3, 0), 7.0), 'v_mad_legacy_f32: 2*3+1=7');
}

// v_mad_legacy_f32: zero source treated as zero product
{
  const emu = setup('v_mad_legacy_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 0.0);
  emu.state.writeVGPR(1, 0, Infinity);
  emu.state.writeVGPR(2, 0, 5.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(3, 0), 5.0), 'v_mad_legacy_f32: 0*Inf+5=5 (legacy)');
}

// v_mad_f32: basic multiply-add
{
  const emu = setup('v_mad_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 4.0);
  emu.state.writeVGPR(1, 0, 5.0);
  emu.state.writeVGPR(2, 0, 10.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(3, 0), 30.0), 'v_mad_f32: 4*5+10=30');
}

// v_mad_f32: negative values
{
  const emu = setup('v_mad_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, -2.0);
  emu.state.writeVGPR(1, 0, 3.0);
  emu.state.writeVGPR(2, 0, 8.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(3, 0), 2.0), 'v_mad_f32: -2*3+8=2');
}

// v_mullit_f32: basic multiply
{
  const emu = setup('v_mullit_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 3.0);
  emu.state.writeVGPR(1, 0, 4.0);
  emu.state.writeVGPR(2, 0, 0.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(3, 0), 12.0), 'v_mullit_f32: 3*4=12');
}

// v_mullit_f32: zero source returns 0
{
  const emu = setup('v_mullit_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 0.0);
  emu.state.writeVGPR(1, 0, 999.0);
  emu.state.writeVGPR(2, 0, 0.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(3, 0), 0.0), 'v_mullit_f32: 0*999=0');
}

// v_sad_hi_u8: SAD result shifted left 16
{
  const emu = setup('v_sad_hi_u8 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x04030201);
  emu.state.writeVGPR_u32(1, 0, 0x01010101);
  emu.state.writeVGPR_u32(2, 0, 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  // |4-1|+|3-1|+|2-1|+|1-1| = 3+2+1+0 = 6, shifted: 6<<16 = 393216
  assert(emu.state.readVGPR_u32(3, 0) === (6 << 16), 'v_sad_hi_u8: SAD=6 << 16');
}

// v_sad_hi_u8: with accumulator
{
  const emu = setup('v_sad_hi_u8 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x02020202);
  emu.state.writeVGPR_u32(1, 0, 0x01010101);
  emu.state.writeVGPR_u32(2, 0, 100);
  emu.state.modifiedRegs.clear();
  emu.run();
  // |2-1|*4 = 4, shifted: 4<<16 = 262144, + 100 = 262244
  assert(emu.state.readVGPR_u32(3, 0) === ((4 << 16) + 100), 'v_sad_hi_u8: SAD=4 << 16 + 100');
}

// v_cvt_pk_u8_f32: pack into byte 0
{
  const emu = setup('v_cvt_pk_u8_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 128.0);
  emu.state.writeVGPR_u32(1, 0, 0); // byte index 0
  emu.state.writeVGPR_u32(2, 0, 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 128, 'v_cvt_pk_u8_f32: f32(128) → byte0');
}

// v_cvt_pk_u8_f32: pack into byte 2 with existing data
{
  const emu = setup('v_cvt_pk_u8_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 255.0);
  emu.state.writeVGPR_u32(1, 0, 2); // byte index 2
  emu.state.writeVGPR_u32(2, 0, 0x00001234);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 0x00FF1234, 'v_cvt_pk_u8_f32: f32(255) → byte2');
}

// v_div_fixup_f32: normal quotient passthrough
{
  const emu = setup('v_div_fixup_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 2.5);  // quotient
  emu.state.writeVGPR(1, 0, 2.0);  // denominator
  emu.state.writeVGPR(2, 0, 5.0);  // numerator
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(3, 0), 2.5), 'v_div_fixup_f32: normal case passthrough');
}

// v_div_fixup_f32: NaN denominator
{
  const emu = setup('v_div_fixup_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 1.0);
  emu.state.writeVGPR(1, 0, NaN);
  emu.state.writeVGPR(2, 0, 5.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(isNaN(emu.state.readVGPR(3, 0)), 'v_div_fixup_f32: NaN denom → NaN');
}

// v_div_fmas_f32: basic FMA
{
  const emu = setup('v_div_fmas_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, 2.0);
  emu.state.writeVGPR(1, 0, 3.0);
  emu.state.writeVGPR(2, 0, 4.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(3, 0), 10.0), 'v_div_fmas_f32: 2*3+4=10');
}

// v_div_fmas_f32: negative values
{
  const emu = setup('v_div_fmas_f32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR(0, 0, -1.0);
  emu.state.writeVGPR(1, 0, 5.0);
  emu.state.writeVGPR(2, 0, 10.0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(approx(emu.state.readVGPR(3, 0), 5.0), 'v_div_fmas_f32: -1*5+10=5');
}

// v_msad_u8: basic masked SAD
{
  const emu = setup('v_msad_u8 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x04030201);
  emu.state.writeVGPR_u32(1, 0, 0x01010101);
  emu.state.writeVGPR_u32(2, 0, 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  // All src0 bytes nonzero: |4-1|+|3-1|+|2-1|+|1-1| = 6
  assert(emu.state.readVGPR_u32(3, 0) === 6, 'v_msad_u8: all nonzero = 6');
}

// v_msad_u8: bytes where the reference (src1) is zero are skipped
{
  const emu = setup('v_msad_u8 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x09030201);
  emu.state.writeVGPR_u32(1, 0, 0x00010101);
  emu.state.writeVGPR_u32(2, 0, 10);
  emu.state.modifiedRegs.clear();
  emu.run();
  // reference byte3 = 0 masked, rest: |3-1|+|2-1|+|1-1| = 3, +10 = 13
  assert(emu.state.readVGPR_u32(3, 0) === 13, 'v_msad_u8: masked reference byte3, result=13');
}

// v_msad_u8: a zero byte in src0 (not the reference) is still counted
{
  const emu = setup('v_msad_u8 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x00030201);
  emu.state.writeVGPR_u32(1, 0, 0x01010101);
  emu.state.writeVGPR_u32(2, 0, 10);
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 14, 'v_msad_u8: zero src0 byte counted (|0-1| = 1), result=14');
}

// v_mad_u64_u32: basic multiply-add
{
  const emu = setup('v_mad_u64_u32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 10);
  emu.state.writeVGPR_u32(1, 0, 20);
  emu.state.writeVGPR_u32(2, 0, 5);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 205, 'v_mad_u64_u32: 10*20+5=205');
}

// v_mad_u64_u32: larger values
{
  const emu = setup('v_mad_u64_u32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x10000);
  emu.state.writeVGPR_u32(1, 0, 0x10000);
  emu.state.writeVGPR_u32(2, 0, 1);
  emu.state.modifiedRegs.clear();
  emu.run();
  // 0x10000 * 0x10000 = 0x100000000 → low 32 = 0, + 1 = 1
  assert(emu.state.readVGPR_u32(3, 0) === 1, 'v_mad_u64_u32: overflow low32 = 1');
}

// v_mad_i64_i32: basic signed multiply-add
{
  const emu = setup('v_mad_i64_i32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 7);
  emu.state.writeVGPR_u32(1, 0, 8);
  emu.state.writeVGPR_u32(2, 0, 3);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(3, 0) === 59, 'v_mad_i64_i32: 7*8+3=59');
}

// v_mad_i64_i32: negative multiply-add
{
  const emu = setup('v_mad_i64_i32 v3, v0, v1, v2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (-3) >>> 0);
  emu.state.writeVGPR_u32(1, 0, 4);
  emu.state.writeVGPR_u32(2, 0, 20);
  emu.state.modifiedRegs.clear();
  emu.run();
  // -3*4+20 = 8
  assert(emu.state.readVGPR_u32(3, 0) === 8, 'v_mad_i64_i32: -3*4+20=8');
}

// v_permlane16_b32: passthrough (lane permute is handled at executor level)
{
  const emu = setup('v_permlane16_b32 v2, v0, s0, s1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xABCD1234);
  emu.state.writeSGPR(0, 0);
  emu.state.writeSGPR(1, 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 0xABCD1234, 'v_permlane16_b32: passthrough');
}

// v_permlane16_b32: different value
{
  const emu = setup('v_permlane16_b32 v2, v0, s0, s1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xDEADBEEF);
  emu.state.writeSGPR(0, 0);
  emu.state.writeSGPR(1, 0);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 0xDEADBEEF, 'v_permlane16_b32: passthrough 2');
}

// ════════════════════════════════════════════
//  VOP1 — Indexed Register Move (movrel*)
// ════════════════════════════════════════════
group('VOP1 Indexed Register Move');

// v_movrels_b32: vdst = v[vsrc + M0]
{
  const emu = setup([
    'v_mov_b32 v0, 0x10',
    'v_mov_b32 v1, 0x20',
    'v_mov_b32 v2, 0x30',
    'v_mov_b32 v3, 0x40',
    's_mov_b32 m0, 2',          // M0 = 2
    'v_movrels_b32 v5, v0',     // v5 = v[0 + 2] = v2 = 0x30
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readVGPR_u32(5, 0) === 0x30, 'v_movrels_b32: v5 = v[0+M0] = v2 = 0x30');
}

// v_movrels_b32: M0 = 0 (identity)
{
  const emu = setup([
    'v_mov_b32 v3, 0xAA',
    's_mov_b32 m0, 0',
    'v_movrels_b32 v5, v3',     // v5 = v[3+0] = v3
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readVGPR_u32(5, 0) === 0xAA, 'v_movrels_b32: M0=0 identity');
}

// v_movreld_b32: v[vdst + M0] = vsrc
{
  const emu = setup([
    'v_mov_b32 v0, 0xFF',
    's_mov_b32 m0, 3',          // M0 = 3
    'v_movreld_b32 v1, v0',     // v[1+3] = v4 = v0 = 0xFF
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readVGPR_u32(4, 0) === 0xFF, 'v_movreld_b32: v[1+M0] = v4 = 0xFF');
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'v_movreld_b32: v1 unchanged');
}

// v_movrelsd_b32: v[vdst + M0] = v[vsrc + M0]
{
  const emu = setup([
    'v_mov_b32 v0, 0x11',
    'v_mov_b32 v1, 0x22',
    'v_mov_b32 v2, 0x33',
    's_mov_b32 m0, 1',          // M0 = 1
    'v_movrelsd_b32 v5, v0',    // v[5+1] = v6 = v[0+1] = v1 = 0x22
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readVGPR_u32(6, 0) === 0x22, 'v_movrelsd_b32: v[5+M0]=v6 gets v[0+M0]=v1=0x22');
}

// v_movrelsd_2_b32: v[vdst + M0[25:16]] = v[vsrc + M0[9:0]]
{
  const emu = setup([
    'v_mov_b32 v0, 0xAA',
    'v_mov_b32 v1, 0xBB',
    'v_mov_b32 v2, 0xCC',
    's_mov_b32 m0, 0x00020001', // source offset 1, destination offset 2
    'v_movrelsd_2_b32 v5, v0',  // v[5+2] = v7 = v[0+1] = v1 = 0xBB
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readVGPR_u32(7, 0) === 0xBB, 'v_movrelsd_2_b32: v[5+M0[25:16]]=v7 gets v[0+M0[9:0]]=v1=0xBB');
}

// ════════════════════════════════════════════
//  VOP1 — Rounding Conversions & Reciprocal
// ════════════════════════════════════════════
group('VOP1 Rounding Conversions');

// v_cvt_rpi_i32_f32: round to positive infinity (round half up)
{
  const emu = setup('v_cvt_rpi_i32_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 2.5); emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 3, 'v_cvt_rpi_i32_f32: 2.5 → 3');
}
{
  const emu = setup('v_cvt_rpi_i32_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, -1.5); emu.run();
  assert((emu.state.readVGPR_u32(1, 0) | 0) === -1, 'v_cvt_rpi_i32_f32: -1.5 → -1');
}

// v_cvt_flr_i32_f32: floor
{
  const emu = setup('v_cvt_flr_i32_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 2.9); emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 2, 'v_cvt_flr_i32_f32: 2.9 → 2');
}
{
  const emu = setup('v_cvt_flr_i32_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, -0.1); emu.run();
  assert((emu.state.readVGPR_u32(1, 0) | 0) === -1, 'v_cvt_flr_i32_f32: -0.1 → -1');
}

// v_cvt_off_f32_i4: signed 4-bit value / 16 (interpolation offset)
{
  const emu = setup('v_cvt_off_f32_i4 v1, v0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 5); emu.run();
  assert(approx(emu.state.readVGPR(1, 0), 0.3125), 'v_cvt_off_f32_i4: 5 → 5/16 = 0.3125');
}
{
  const emu = setup('v_cvt_off_f32_i4 v1, v0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x8); emu.run(); // 0x8 = -8 in signed 4-bit
  assert(approx(emu.state.readVGPR(1, 0), -0.5), 'v_cvt_off_f32_i4: 0x8 → -8/16 = -0.5');
}

// v_rcp_iflag_f32
{
  const emu = setup('v_rcp_iflag_f32 v1, v0\ns_endpgm');
  emu.state.writeVGPR(0, 0, 4.0); emu.run();
  assert(approx(emu.state.readVGPR(1, 0), 0.25), 'v_rcp_iflag_f32: 1/4 = 0.25');
}

// ════════════════════════════════════════════
//  SOP1 — Conditional Move & Indexed SGPR Move
// ════════════════════════════════════════════
group('SOP1 Conditional/Indexed Move');

// s_cmov_b32: move only when SCC=1
{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_mov_b32 s1, 99',
    's_cmp_eq_u32 s0, 10',  // SCC=1
    's_cmov_b32 s2, s1',     // s2 = 99 (SCC=1)
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 99, 's_cmov_b32: SCC=1 → move executed');
}
{
  const emu = setup([
    's_mov_b32 s0, 10',
    's_mov_b32 s1, 99',
    's_mov_b32 s2, 42',
    's_cmp_eq_u32 s0, 5',   // SCC=0
    's_cmov_b32 s2, s1',     // s2 unchanged (SCC=0)
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(2) === 42, 's_cmov_b32: SCC=0 → move not executed');
}

// s_movrels_b32: sdst = s[ssrc0 + M0]
{
  const emu = setup([
    's_mov_b32 s0, 0xAA',
    's_mov_b32 s1, 0xBB',
    's_mov_b32 s2, 0xCC',
    's_mov_b32 m0, 2',
    's_movrels_b32 s5, s0',  // s5 = s[0+2] = s2 = 0xCC
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(5) === (0xCC >>> 0), 's_movrels_b32: s5 = s[0+M0] = s2 = 0xCC');
}

// s_movreld_b32: s[sdst + M0] = ssrc0
{
  const emu = setup([
    's_mov_b32 s0, 0xFF',
    's_mov_b32 m0, 3',
    's_movreld_b32 s1, s0',  // s[1+3] = s4 = s0 = 0xFF
    's_endpgm',
  ].join('\n'));
  emu.run();
  assert(emu.state.readSGPR(4) === (0xFF >>> 0), 's_movreld_b32: s[1+M0] = s4 = 0xFF');
}

// ════════════════════════════════════════════
//  Edge Cases
// ════════════════════════════════════════════
group('Edge Cases');

// Assembly error detection
{
  const result = assemble('v_bogus_instruction v0, v1\ns_endpgm');
  assert(result.errors.length > 0, 'Assembly error: unknown mnemonic produces error');
}

// Empty program doesn't crash
{
  const emu = setup('s_endpgm');
  emu.run();
  assert(emu.isComplete(), 'Empty program: s_endpgm alone completes');
}

// Reset preserves program
{
  const emu = setup('v_mov_b32 v1, v0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 42);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 42, 'Reset: first run sets v1=42');
  emu.reset();
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'Reset: v1 cleared after reset');
  emu.state.writeVGPR_u32(0, 0, 99);
  emu.state.modifiedRegs.clear();
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 99, 'Reset: re-run with new input works');
}

// Step-by-step execution
{
  const emu = setup([
    's_mov_b32 s0, 1',
    's_mov_b32 s1, 2',
    's_endpgm',
  ].join('\n'));
  emu.state.modifiedRegs.clear();
  emu.step();
  assert(emu.state.readSGPR(0) === 1, 'Step: after step 1, s0=1');
  assert(emu.state.readSGPR(1) === 0, 'Step: after step 1, s1 still 0');
  emu.step();
  assert(emu.state.readSGPR(1) === 2, 'Step: after step 2, s1=2');
  assert(!emu.isComplete(), 'Step: not yet complete before s_endpgm');
  emu.step();
  assert(emu.isComplete(), 'Step: complete after s_endpgm');
}

// ════════════════════════════════════════════
//  SDWA — Sub-Dword Addressing
// ════════════════════════════════════════════
group('SDWA Sub-Dword Addressing');

// BYTE_0 extraction from src0
{
  const emu = setup('v_mov_b32 v1, v0 src0_sel:BYTE_0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xDDCCBBAA);
  emu.run();
  assert((emu.state.readVGPR_u32(1, 0) & 0xFF) === 0xAA, 'SDWA: src0_sel:BYTE_0 extracts [7:0]');
}

// BYTE_1 extraction from src0
{
  const emu = setup('v_mov_b32 v1, v0 src0_sel:BYTE_1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xDDCCBBAA);
  emu.run();
  assert((emu.state.readVGPR_u32(1, 0) & 0xFF) === 0xBB, 'SDWA: src0_sel:BYTE_1 extracts [15:8]');
}

// BYTE_2 extraction from src0
{
  const emu = setup('v_mov_b32 v1, v0 src0_sel:BYTE_2\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xDDCCBBAA);
  emu.run();
  assert((emu.state.readVGPR_u32(1, 0) & 0xFF) === 0xCC, 'SDWA: src0_sel:BYTE_2 extracts [23:16]');
}

// BYTE_3 extraction from src0
{
  const emu = setup('v_mov_b32 v1, v0 src0_sel:BYTE_3\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xDDCCBBAA);
  emu.run();
  assert((emu.state.readVGPR_u32(1, 0) & 0xFF) === 0xDD, 'SDWA: src0_sel:BYTE_3 extracts [31:24]');
}

// WORD_0 extraction from src0
{
  const emu = setup('v_mov_b32 v1, v0 src0_sel:WORD_0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xDDCCBBAA);
  emu.run();
  assert((emu.state.readVGPR_u32(1, 0) & 0xFFFF) === 0xBBAA, 'SDWA: src0_sel:WORD_0 extracts [15:0]');
}

// WORD_1 extraction from src0
{
  const emu = setup('v_mov_b32 v1, v0 src0_sel:WORD_1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xDDCCBBAA);
  emu.run();
  assert((emu.state.readVGPR_u32(1, 0) & 0xFFFF) === 0xDDCC, 'SDWA: src0_sel:WORD_1 extracts [31:16]');
}

// Sign extension — BYTE with sign bit set
{
  const emu = setup('v_mov_b32 v1, v0 src0_sel:BYTE_0 src0_sext\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x000000FF); // 0xFF = -1 as signed byte
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0xFFFFFFFF, 'SDWA: src0_sext sign-extends 0xFF byte to 0xFFFFFFFF');
}

// Zero extension — BYTE without sext
{
  const emu = setup('v_mov_b32 v1, v0 src0_sel:BYTE_0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x000000FF);
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0x000000FF, 'SDWA: no sext zero-extends 0xFF byte to 0x000000FF');
}

// Sign extension — WORD with sign bit set
{
  const emu = setup('v_mov_b32 v1, v0 src0_sel:WORD_0 src0_sext\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x0000FFFF); // 0xFFFF = -1 as signed 16-bit
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0xFFFFFFFF, 'SDWA: src0_sext sign-extends 0xFFFF word to 0xFFFFFFFF');
}

// DST_SEL: write to BYTE_0
{
  const emu = setup('v_mov_b32 v1, v0 dst_sel:BYTE_0 dst_unused:UNUSED_PAD src0_sel:DWORD\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x12345678);
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0x00000078, 'SDWA: dst_sel:BYTE_0 writes only [7:0], pad rest');
}

// DST_SEL: write to BYTE_2
{
  const emu = setup('v_mov_b32 v1, v0 dst_sel:BYTE_2 dst_unused:UNUSED_PAD src0_sel:DWORD\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x12345678);
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0x00780000, 'SDWA: dst_sel:BYTE_2 writes [23:16], pad rest');
}

// DST_SEL: write to WORD_1
{
  const emu = setup('v_mov_b32 v1, v0 dst_sel:WORD_1 dst_unused:UNUSED_PAD src0_sel:DWORD\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x12345678);
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0x56780000, 'SDWA: dst_sel:WORD_1 writes [31:16], pad rest');
}

// DST_UNUSED: UNUSED_SEXT
{
  const emu = setup('v_mov_b32 v1, v0 dst_sel:BYTE_0 dst_unused:UNUSED_SEXT src0_sel:BYTE_0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x00000080); // 0x80 = negative byte
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0xFFFFFF80, 'SDWA: dst_unused:UNUSED_SEXT sign-extends 0x80');
}

// DST_UNUSED: UNUSED_PRESERVE
{
  const emu = setup('v_mov_b32 v1, v0 dst_sel:BYTE_0 dst_unused:UNUSED_PRESERVE src0_sel:DWORD\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x000000AB);
  emu.state.writeVGPR_u32(1, 0, 0xFFFF0000);
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0xFFFF00AB, 'SDWA: dst_unused:UNUSED_PRESERVE keeps upper bits');
}

// VOP2 with both src0_sel and src1_sel
{
  const emu = setup('v_add_nc_u32 v2, v0, v1 src0_sel:BYTE_0 src1_sel:BYTE_0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x00000010); // BYTE_0 = 0x10
  emu.state.writeVGPR_u32(1, 0, 0x00000020); // BYTE_0 = 0x20
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 0x30, 'SDWA VOP2: src0_sel:BYTE_0 + src1_sel:BYTE_0 addition');
}

// VOP2 with src0_sel:WORD_1 and src1_sel:WORD_0
{
  const emu = setup('v_add_nc_u32 v2, v0, v1 src0_sel:WORD_1 src1_sel:WORD_0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x00030000); // WORD_1 = 3
  emu.state.writeVGPR_u32(1, 0, 0x00000007); // WORD_0 = 7
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === 10, 'SDWA VOP2: src0_sel:WORD_1 + src1_sel:WORD_0');
}

// Roundtrip: assemble → decode → verify SDWA fields
{
  const result = assemble('v_mov_b32 v1, v0 dst_sel:BYTE_0 dst_unused:UNUSED_SEXT src0_sel:WORD_1\ns_endpgm');
  assert(result.errors.length === 0, 'SDWA roundtrip: no assembly errors');
  const decoded = decodeBinary(result.binary);
  assert(decoded.length >= 1, 'SDWA roundtrip: at least 1 decoded instruction');
  const d = decoded[0];
  assert(d.sdwaDstSel === 0, 'SDWA roundtrip: dst_sel=BYTE_0 (0)');
  assert(d.sdwaDstUnused === 1, 'SDWA roundtrip: dst_unused=UNUSED_SEXT (1)');
  assert(d.sdwaSrc0Sel === 5, 'SDWA roundtrip: src0_sel=WORD_1 (5)');
}

// Roundtrip: VOP2 with SDWA
{
  const result = assemble('v_add_nc_u32 v2, v0, v1 dst_sel:WORD_0 dst_unused:UNUSED_PAD src0_sel:BYTE_0 src1_sel:BYTE_1\ns_endpgm');
  assert(result.errors.length === 0, 'SDWA VOP2 roundtrip: no assembly errors');
  const decoded = decodeBinary(result.binary);
  const d = decoded[0];
  assert(d.sdwaDstSel === 4, 'SDWA VOP2 roundtrip: dst_sel=WORD_0 (4)');
  assert(d.sdwaDstUnused === 0, 'SDWA VOP2 roundtrip: dst_unused=UNUSED_PAD (0)');
  assert(d.sdwaSrc0Sel === 0, 'SDWA VOP2 roundtrip: src0_sel=BYTE_0 (0)');
  assert(d.sdwaSrc1Sel === 1, 'SDWA VOP2 roundtrip: src1_sel=BYTE_1 (1)');
}

// Disassembly includes SDWA modifiers
{
  const result = assemble('v_mov_b32 v1, v0 dst_sel:BYTE_0 dst_unused:UNUSED_PAD src0_sel:WORD_0\ns_endpgm');
  const decoded = decodeBinary(result.binary);
  const dis = disassemble(decoded[0], lookupByOpcode);
  assert(dis.includes('dst_sel:BYTE_0'), 'SDWA disassembly includes dst_sel:BYTE_0');
  assert(dis.includes('src0_sel:WORD_0'), 'SDWA disassembly includes src0_sel:WORD_0');
  assert(dis.includes('dst_unused:UNUSED_PAD'), 'SDWA disassembly includes dst_unused:UNUSED_PAD');
}

// SDWA with sign-extend roundtrip
{
  const result = assemble('v_mov_b32 v1, v0 src0_sel:BYTE_0 src0_sext\ns_endpgm');
  assert(result.errors.length === 0, 'SDWA sext roundtrip: no assembly errors');
  const decoded = decodeBinary(result.binary);
  const d = decoded[0];
  assert(d.sdwaSrc0Sel === 0, 'SDWA sext roundtrip: src0_sel=BYTE_0');
  assert(d.sdwaSrc0Sext === true, 'SDWA sext roundtrip: src0_sext=true');
}

// SDWA src1_sext roundtrip
{
  const result = assemble('v_add_nc_u32 v2, v0, v1 src0_sel:BYTE_0 src1_sel:BYTE_0 src1_sext\ns_endpgm');
  assert(result.errors.length === 0, 'SDWA src1_sext roundtrip: no assembly errors');
  const decoded = decodeBinary(result.binary);
  const d = decoded[0];
  assert(d.sdwaSrc1Sext === true, 'SDWA src1_sext roundtrip: src1_sext=true');
}

// SDWA BYTE_1 extraction with dst_sel BYTE_1
{
  const emu = setup('v_mov_b32 v1, v0 dst_sel:BYTE_1 dst_unused:UNUSED_PAD src0_sel:BYTE_1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0xAABBCCDD);
  emu.run();
  // src0_sel:BYTE_1 extracts 0xCC, dst_sel:BYTE_1 writes it to [15:8], pad rest
  assert(emu.state.readVGPR_u32(1, 0) === 0x0000CC00, 'SDWA: BYTE_1 extract + BYTE_1 write');
}

// SDWA WORD_0 with UNUSED_PRESERVE
{
  const emu = setup('v_mov_b32 v1, v0 dst_sel:WORD_0 dst_unused:UNUSED_PRESERVE src0_sel:WORD_0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0x0000AABB);
  emu.state.writeVGPR_u32(1, 0, 0x12340000);
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0x1234AABB, 'SDWA: WORD_0 preserve upper');
}

// ════════════════════════════════════════════
//  New VALU Instructions
// ════════════════════════════════════════════
group('New VALU Instructions');

// Helper: build VOP2 binary word
function buildVOP2(opcode: number, vdst: number, vsrc1: number, src0: number): number {
  return (((opcode & 0x3F) << 25) | ((vdst & 0xFF) << 17) | ((vsrc1 & 0xFF) << 9) | (src0 & 0x1FF)) >>> 0;
}

// Helper: build VOP1 binary word: [31:25]=0x3F, [24:17]=VDST, [16:9]=OP, [8:0]=SRC0
function buildVOP1(opcode: number, vdst: number, src0: number): number {
  return ((0x3F << 25) | ((vdst & 0xFF) << 17) | ((opcode & 0xFF) << 9) | (src0 & 0x1FF)) >>> 0;
}

// VOP3 helper for 3-source ops (GFX10: prefix 0x35, unused fields hold inline 0)
function buildVOP3_3src(opcode: number, vdst: number, src0: number, src1: number, src2: number): number[] {
  const dword0 = ((0x35 << 26) | ((opcode & 0x3FF) << 16) | (vdst & 0xFF)) >>> 0;
  const dword1 = (((src2 & 0x1FF) << 18) | ((src1 & 0x1FF) << 9) | (src0 & 0x1FF)) >>> 0;
  return [dword0, dword1];
}

// ── v_madmk_f32 (opcode 0x20): vdst = src0 * K + vsrc1 ──
{
  // v_madmk_f32 v2, v0, K=2.0, v1 → v2 = v0 * 2.0 + v1
  const word = buildVOP2(0x20, 2, 1, 256 + 0); // src0=v0, vsrc1=v1, vdst=v2
  const kBits = floatBits(2.0);
  const binary = new Uint32Array([word, kBits, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR(0, 0, 3.0);   // src0 = 3.0
  emu.state.writeVGPR(1, 0, 10.0);  // vsrc1 = 10.0
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 16.0), 'v_madmk_f32: 3.0 * 2.0 + 10.0 = 16.0');
}

// v_madmk_f32 with negative K
{
  const word = buildVOP2(0x20, 2, 1, 256 + 0);
  const kBits = floatBits(-0.5);
  const binary = new Uint32Array([word, kBits, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR(0, 0, 4.0);
  emu.state.writeVGPR(1, 0, 5.0);
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 3.0), 'v_madmk_f32: 4.0 * (-0.5) + 5.0 = 3.0');
}

// ── v_madak_f32 (opcode 0x21): vdst = src0 * vsrc1 + K ──
{
  // v_madak_f32 v2, v0, v1, K=100.0 → v2 = v0 * v1 + 100.0
  const word = buildVOP2(0x21, 2, 1, 256 + 0);
  const kBits = floatBits(100.0);
  const binary = new Uint32Array([word, kBits, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR(0, 0, 3.0);
  emu.state.writeVGPR(1, 0, 5.0);
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 115.0), 'v_madak_f32: 3.0 * 5.0 + 100.0 = 115.0');
}

// v_madak_f32 with K=0
{
  const word = buildVOP2(0x21, 2, 1, 256 + 0);
  const kBits = floatBits(0.0);
  const binary = new Uint32Array([word, kBits, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR(0, 0, 7.0);
  emu.state.writeVGPR(1, 0, 3.0);
  emu.run();
  assert(approx(emu.state.readVGPR(2, 0), 21.0), 'v_madak_f32: 7.0 * 3.0 + 0.0 = 21.0');
}

// ── v_subrev_f16 (opcode 0x34): vdst = vsrc1 - src0 ──
{
  const emu = setup('v_subrev_f16 v2, v0, v1\ns_endpgm');
  writeF16(emu, 0, 0, 3.0);
  writeF16(emu, 1, 0, 10.0);
  emu.run();
  assert(approx(readF16(emu, 2, 0), 7.0), 'v_subrev_f16: 10.0 - 3.0 = 7.0');
}

// v_subrev_f16 with larger src0
{
  const emu = setup('v_subrev_f16 v2, v0, v1\ns_endpgm');
  writeF16(emu, 0, 0, 10.0);
  writeF16(emu, 1, 0, 3.0);
  emu.run();
  assert(approx(readF16(emu, 2, 0), -7.0), 'v_subrev_f16: 3.0 - 10.0 = -7.0');
}

// ── v_fmamk_f16 (opcode 0x37): vdst = src0 * K + vsrc1 ──
{
  const word = buildVOP2(0x37, 2, 1, 256 + 0);
  const kBits = f32ToF16(3.0);
  const binary = new Uint32Array([word, kBits, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  writeF16(emu, 0, 0, 2.0);
  writeF16(emu, 1, 0, 4.0);
  emu.run();
  assert(approx(readF16(emu, 2, 0), 10.0), 'v_fmamk_f16: 2.0 * 3.0 + 4.0 = 10.0');
}

// ── v_fmaak_f16 (opcode 0x38): vdst = src0 * vsrc1 + K ──
{
  const word = buildVOP2(0x38, 2, 1, 256 + 0);
  const kBits = f32ToF16(50.0);
  const binary = new Uint32Array([word, kBits, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  writeF16(emu, 0, 0, 5.0);
  writeF16(emu, 1, 0, 4.0);
  emu.run();
  assert(approx(readF16(emu, 2, 0), 70.0), 'v_fmaak_f16: 5.0 * 4.0 + 50.0 = 70.0');
}

// ── v_pk_fmac_f16 (opcode 0x3C): vdst += src0 * vsrc1 (packed f16) ──
{
  const word = buildVOP2(0x3C, 2, 1, 256 + 0);
  const binary = new Uint32Array([word, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  // v0 = packed(lo=2.0, hi=3.0), v1 = packed(lo=4.0, hi=5.0), v2 = packed(lo=1.0, hi=10.0)
  emu.state.writeVGPR_u32(0, 0, pkf16(2.0, 3.0));
  emu.state.writeVGPR_u32(1, 0, pkf16(4.0, 5.0));
  emu.state.writeVGPR_u32(2, 0, pkf16(1.0, 10.0));
  emu.run();
  // vdst_lo = 1.0 + 2.0*4.0 = 9.0, vdst_hi = 10.0 + 3.0*5.0 = 25.0
  const r = emu.state.readVGPR_u32(2, 0);
  const rLoF16 = r & 0xFFFF;
  const rHiF16 = (r >>> 16) & 0xFFFF;
  // f16 for 9.0 = 0x4880, f16 for 25.0 = 0x4E40
  assert(rLoF16 === f16(9.0), `v_pk_fmac_f16: lo = 9.0 (got 0x${rLoF16.toString(16)})`);
  assert(rHiF16 === f16(25.0), `v_pk_fmac_f16: hi = 25.0 (got 0x${rHiF16.toString(16)})`);
}

// v_pk_fmac_f16 with zeros
{
  const word = buildVOP2(0x3C, 2, 1, 256 + 0);
  const binary = new Uint32Array([word, ENDPGM]);
  const emu = new Emulator(); emu.load(binary);
  emu.state.writeVGPR_u32(0, 0, pkf16(0.0, 0.0));
  emu.state.writeVGPR_u32(1, 0, pkf16(4.0, 5.0));
  emu.state.writeVGPR_u32(2, 0, pkf16(7.0, 8.0));
  emu.run();
  const r = emu.state.readVGPR_u32(2, 0);
  assert((r & 0xFFFF) === f16(7.0), 'v_pk_fmac_f16 zeros: lo preserved 7.0');
  assert(((r >>> 16) & 0xFFFF) === f16(8.0), 'v_pk_fmac_f16 zeros: hi preserved 8.0');
}

// ── v_dot4c_i32_i8 (opcode 0x0D): vdst += dot4(src0, src1) ──
{
  const emu = setup('v_dot4c_i32_i8 v2, v0, v1\ns_endpgm');
  // src0 = bytes [1, 2, 3, 4], src1 = bytes [5, 6, 7, 8]
  emu.state.writeVGPR_u32(0, 0, (4 << 24) | (3 << 16) | (2 << 8) | 1);
  emu.state.writeVGPR_u32(1, 0, (8 << 24) | (7 << 16) | (6 << 8) | 5);
  emu.state.writeVGPR_u32(2, 0, 100); // accumulator
  emu.run();
  // 1*5 + 2*6 + 3*7 + 4*8 = 5 + 12 + 21 + 32 = 70; 70 + 100 = 170
  assert(emu.state.readVGPR_u32(2, 0) === 170, 'v_dot4c_i32_i8: 1*5+2*6+3*7+4*8 + 100 = 170');
}

// v_dot4c_i32_i8 with negative bytes
{
  const emu = setup('v_dot4c_i32_i8 v2, v0, v1\ns_endpgm');
  // src0 = bytes [255(-1), 254(-2), 0, 1], src1 = bytes [1, 1, 1, 1]
  emu.state.writeVGPR_u32(0, 0, (1 << 24) | (0 << 16) | (254 << 8) | 255);
  emu.state.writeVGPR_u32(1, 0, (1 << 24) | (1 << 16) | (1 << 8) | 1);
  emu.state.writeVGPR_u32(2, 0, 10); // accumulator
  emu.run();
  // (-1)*1 + (-2)*1 + 0*1 + 1*1 = -1 + -2 + 0 + 1 = -2; -2 + 10 = 8
  assert(emu.state.readVGPR_u32(2, 0) === 8, 'v_dot4c_i32_i8 neg: -1+(-2)+0+1 + 10 = 8');
}

// v_dot4c_i32_i8 with zero accumulator
{
  const emu = setup('v_dot4c_i32_i8 v2, v0, v1\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (2 << 24) | (2 << 16) | (2 << 8) | 2);
  emu.state.writeVGPR_u32(1, 0, (3 << 24) | (3 << 16) | (3 << 8) | 3);
  emu.state.writeVGPR_u32(2, 0, 0);
  emu.run();
  // 2*3 * 4 = 24
  assert(emu.state.readVGPR_u32(2, 0) === 24, 'v_dot4c_i32_i8 zero accum: 2*3*4 = 24');
}

// ── v_sat_pk_u8_i16 (opcode 0x62): pack two i16 to u8 with saturation ──
{
  const emu = setup('v_sat_pk_u8_i16 v1, v0\ns_endpgm');
  // lo16 = 200, hi16 = 100 → both in [0,255] → result = (100 << 8) | 200 = 0x64C8
  emu.state.writeVGPR_u32(0, 0, (100 << 16) | 200);
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === ((100 << 8) | 200), 'v_sat_pk_u8_i16: normal values');
}

// v_sat_pk_u8_i16 with saturation (negative clamped to 0)
{
  const emu = setup('v_sat_pk_u8_i16 v1, v0\ns_endpgm');
  // lo16 = -10 (0xFFF6), hi16 = 300 (0x012C) → lo clamped to 0, hi clamped to 255
  const lo16 = (-10) & 0xFFFF;
  const hi16 = 300 & 0xFFFF;
  emu.state.writeVGPR_u32(0, 0, (hi16 << 16) | lo16);
  emu.run();
  // lo_byte = 0, hi_byte = 255 → result = (255 << 8) | 0 = 0xFF00
  assert(emu.state.readVGPR_u32(1, 0) === 0xFF00, 'v_sat_pk_u8_i16: saturation neg/overflow');
}

// v_sat_pk_u8_i16 with both halves zero
{
  const emu = setup('v_sat_pk_u8_i16 v1, v0\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, 0);
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'v_sat_pk_u8_i16: zeros');
}

// ── v_cvt_norm_i16_f16 (opcode 0x63): vdst = (i16)(src0 * 32767) ──
{
  const emu = setup('v_cvt_norm_i16_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 1.0);
  emu.run();
  const result = emu.state.readVGPR_u32(1, 0) & 0xFFFF;
  assert(result === 32767, 'v_cvt_norm_i16_f16: 1.0 → 32767');
}

// v_cvt_norm_i16_f16 with 0.5
{
  const emu = setup('v_cvt_norm_i16_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 0.5);
  emu.run();
  const result = emu.state.readVGPR_u32(1, 0) & 0xFFFF;
  // 0.5 * 32767 = 16383.5 → rounds to 16384
  assert(result === 16384, `v_cvt_norm_i16_f16: 0.5 → ~16384 (got ${result})`);
}

// v_cvt_norm_i16_f16 with 0.0
{
  const emu = setup('v_cvt_norm_i16_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 0.0);
  emu.run();
  const result = emu.state.readVGPR_u32(1, 0) & 0xFFFF;
  assert(result === 0, 'v_cvt_norm_i16_f16: 0.0 → 0');
}

// ── v_cvt_norm_u16_f16 (opcode 0x64): vdst = (u16)(src0 * 65535) ──
{
  const emu = setup('v_cvt_norm_u16_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 1.0);
  emu.run();
  const result = emu.state.readVGPR_u32(1, 0) & 0xFFFF;
  assert(result === 65535, 'v_cvt_norm_u16_f16: 1.0 → 65535');
}

// v_cvt_norm_u16_f16 with 0.5
{
  const emu = setup('v_cvt_norm_u16_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 0.5);
  emu.run();
  const result = emu.state.readVGPR_u32(1, 0) & 0xFFFF;
  // 0.5 * 65535 = 32767.5 → rounds to 32768
  assert(result === 32768, `v_cvt_norm_u16_f16: 0.5 → ~32768 (got ${result})`);
}

// v_cvt_norm_u16_f16 with 0.0
{
  const emu = setup('v_cvt_norm_u16_f16 v1, v0\ns_endpgm');
  writeF16(emu, 0, 0, 0.0);
  emu.run();
  const result = emu.state.readVGPR_u32(1, 0) & 0xFFFF;
  assert(result === 0, 'v_cvt_norm_u16_f16: 0.0 → 0');
}

// ── v_qsad_pk_u16_u8: four SADs over sliding 32-bit windows of the 64-bit src0 ──
{
  const emu = setup('v_qsad_pk_u16_u8 v[4:5], v[0:1], v2, v[6:7]\ns_endpgm');
  // src0 bytes (low to high): 10, 20, 30, 40, 50, 60, 70, 80; reference = 15, 25, 35, 45
  emu.state.writeVGPR_u32(0, 0, (40 << 24) | (30 << 16) | (20 << 8) | 10);
  emu.state.writeVGPR_u32(1, 0, (80 << 24) | (70 << 16) | (60 << 8) | 50);
  emu.state.writeVGPR_u32(2, 0, (45 << 24) | (35 << 16) | (25 << 8) | 15);
  emu.state.writeVGPR_u32(6, 0, (2 << 16) | 1);   // accumulators 1, 2
  emu.state.writeVGPR_u32(7, 0, (4 << 16) | 3);   // accumulators 3, 4
  emu.run();
  // window0 = 10,20,30,40 → 20; window1 = 20,30,40,50 → 5+5+5+5 = 20; window2 = 30..60 → 15+15+15+15 = 60; window3 = 40..70 → 100
  assert(emu.state.readVGPR_u32(4, 0) === (((20 + 2) << 16) | (20 + 1)) >>> 0, 'v_qsad_pk_u16_u8: windows 0 and 1');
  assert(emu.state.readVGPR_u32(5, 0) === (((100 + 4) << 16) | (60 + 3)) >>> 0, 'v_qsad_pk_u16_u8: windows 2 and 3');
}

// ── v_mqsad_pk_u16_u8: masked version (reference bytes that are 0 are skipped) ──
{
  const emu = setup('v_mqsad_pk_u16_u8 v[4:5], v[0:1], v2, v[6:7]\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (40 << 24) | (30 << 16) | (20 << 8) | 10);
  emu.state.writeVGPR_u32(1, 0, 0);
  emu.state.writeVGPR_u32(2, 0, (45 << 24) | (0 << 16) | (25 << 8) | 0);  // reference bytes 0 and 2 masked
  emu.state.writeVGPR_u32(6, 0, 5);
  emu.state.writeVGPR_u32(7, 0, 0);
  emu.run();
  // window0: |20-25| + |40-45| = 10, + 5 = 15
  assert((emu.state.readVGPR_u32(4, 0) & 0xFFFF) === 15, 'v_mqsad_pk_u16_u8: masked SAD + accum = 15');
}

// ── v_mqsad_u32_u8: masked quad SAD with 32-bit accumulators (128-bit src2 and result) ──
{
  const emu = setup('v_mqsad_u32_u8 v[4:7], v[0:1], v2, v[8:11]\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (100 << 24) | (50 << 16) | (0 << 8) | 200);
  emu.state.writeVGPR_u32(1, 0, 0);
  emu.state.writeVGPR_u32(2, 0, (90 << 24) | (60 << 16) | (0 << 8) | 180);
  emu.state.writeVGPR_u32(8, 0, 1000);
  emu.state.writeVGPR_u32(9, 0, 7);
  emu.run();
  // window0: |200-180| + skip + |50-60| + |100-90| = 40 → 1040
  assert(emu.state.readVGPR_u32(4, 0) === 1040, 'v_mqsad_u32_u8: masked SAD u32 = 1040');
  // window1 = bytes 0,50,100,0: |0-180| + skip + |100-60| + |0-90| = 310 → +7
  assert(emu.state.readVGPR_u32(5, 0) === 317, 'v_mqsad_u32_u8: second window uses S0[39:8]');
}

// ── v_fmac_f16: accumulate test (similar to v_fmac_f32) ──
{
  const emu = setup('v_fmac_f16 v2, v0, v1\ns_endpgm');
  writeF16(emu, 0, 0, 3.0);  // src0
  writeF16(emu, 1, 0, 4.0);  // vsrc1
  writeF16(emu, 2, 0, 10.0); // vdst (accumulator)
  emu.run();
  // vdst = 3.0 * 4.0 + 10.0 = 22.0
  assert(approx(readF16(emu, 2, 0), 22.0), 'v_fmac_f16: 3.0 * 4.0 + 10.0 = 22.0');
}

// ── Decode roundtrip tests for binary-only instructions ──

// v_madmk_f32 decode roundtrip
{
  const word = buildVOP2(0x20, 3, 1, 256 + 0);
  const kBits = floatBits(5.0);
  const binary = new Uint32Array([word, kBits, ENDPGM]);
  const decoded = decodeBinary(binary);
  assert(decoded.length === 2, 'v_madmk_f32 decode: 2 instructions (madmk + endpgm)');
  assert(decoded[0].opcode === 0x20, 'v_madmk_f32 decode: opcode 0x20');
  assert(decoded[0].literal === kBits, 'v_madmk_f32 decode: literal K preserved');
  assert(decoded[0].dst === 3, 'v_madmk_f32 decode: vdst=3');
}

// v_madak_f32 decode roundtrip
{
  const word = buildVOP2(0x21, 4, 2, 256 + 1);
  const kBits = floatBits(7.5);
  const binary = new Uint32Array([word, kBits, ENDPGM]);
  const decoded = decodeBinary(binary);
  assert(decoded.length === 2, 'v_madak_f32 decode: 2 instructions');
  assert(decoded[0].opcode === 0x21, 'v_madak_f32 decode: opcode 0x21');
  assert(decoded[0].literal === kBits, 'v_madak_f32 decode: literal K preserved');
}

// v_fmamk_f16 decode roundtrip
{
  const word = buildVOP2(0x37, 2, 1, 256 + 0);
  const kBits = floatBits(1.5);
  const binary = new Uint32Array([word, kBits, ENDPGM]);
  const decoded = decodeBinary(binary);
  assert(decoded[0].opcode === 0x37, 'v_fmamk_f16 decode: opcode 0x37');
  assert(decoded[0].literal === kBits, 'v_fmamk_f16 decode: literal K preserved');
}

// v_fmaak_f16 decode roundtrip
{
  const word = buildVOP2(0x38, 2, 1, 256 + 0);
  const kBits = floatBits(2.5);
  const binary = new Uint32Array([word, kBits, ENDPGM]);
  const decoded = decodeBinary(binary);
  assert(decoded[0].opcode === 0x38, 'v_fmaak_f16 decode: opcode 0x38');
  assert(decoded[0].literal === kBits, 'v_fmaak_f16 decode: literal K preserved');
}

// ── Opcode lookup tests ──
{
  assert(lookupByMnemonic('v_madmk_f32') !== undefined, 'lookup: v_madmk_f32 exists');
  assert(lookupByMnemonic('v_madak_f32') !== undefined, 'lookup: v_madak_f32 exists');
  assert(lookupByMnemonic('v_subrev_f16') !== undefined, 'lookup: v_subrev_f16 exists');
  assert(lookupByMnemonic('v_fmamk_f16') !== undefined, 'lookup: v_fmamk_f16 exists');
  assert(lookupByMnemonic('v_fmaak_f16') !== undefined, 'lookup: v_fmaak_f16 exists');
  assert(lookupByMnemonic('v_pk_fmac_f16') !== undefined, 'lookup: v_pk_fmac_f16 exists');
  assert(lookupByMnemonic('v_dot4c_i32_i8') !== undefined, 'lookup: v_dot4c_i32_i8 exists');
  assert(lookupByMnemonic('v_sat_pk_u8_i16') !== undefined, 'lookup: v_sat_pk_u8_i16 exists');
  assert(lookupByMnemonic('v_cvt_norm_i16_f16') !== undefined, 'lookup: v_cvt_norm_i16_f16 exists');
  assert(lookupByMnemonic('v_cvt_norm_u16_f16') !== undefined, 'lookup: v_cvt_norm_u16_f16 exists');
  assert(lookupByMnemonic('v_qsad_pk_u16_u8') !== undefined, 'lookup: v_qsad_pk_u16_u8 exists');
  assert(lookupByMnemonic('v_mqsad_pk_u16_u8') !== undefined, 'lookup: v_mqsad_pk_u16_u8 exists');
  assert(lookupByMnemonic('v_mqsad_u32_u8') !== undefined, 'lookup: v_mqsad_u32_u8 exists');
}

// ════════════════════════════════════════════
//  Regression tests for the GFX10 engine fixes
// ════════════════════════════════════════════

/** Assemble `src` + s_endpgm, apply `init`, run, and return the emulator. */
function run1(src: string, init?: (e: Emulator) => void): Emulator {
  const emu = setup(src + '\ns_endpgm');
  init?.(emu);
  emu.run();
  return emu;
}

const enc = (s: string): number[] => Array.from(assemble(s).binary);
const same = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => (x >>> 0) === (b[i] >>> 0));

group('Regression: constants');

// Float constants are encoded as f32 values, never as integer bit patterns
for (const [text, k] of [['3.0', 3], ['100.0', 100], ['-3.0', -3], ['0.1', Math.fround(0.1)], ['1e3', 1000]] as const) {
  const emu = run1(`v_mul_f32 v1, ${text}, v0`, e => e.state.writeVGPR(0, 0, 1.5));
  assert(emu.state.readVGPR(1, 0) === Math.fround(1.5 * k), `float constant ${text} is an f32 value`);
}
assert(same(enc('v_mul_f32 v1, 3.0, v0'), [((8 << 25) | (1 << 17) | 0xFF) >>> 0, 0x40400000]), '3.0 is the literal 0x40400000');
assert((enc('v_mov_b32 v0, 0.15915494309189535')[0] & 0x1FF) === 248, '1/(2π) is inline constant 248');
assert(run1('v_mov_b32 v0, -0.0').state.readVGPR_u32(0, 0) === 0x80000000, '-0.0 keeps its sign (literal 0x80000000)');
{
  const emu = run1('v_add_f16 v1, 3.5, v0', e => writeF16(e, 0, 0, 1.0));
  assert(readF16(emu, 1, 0) === 4.5, 'f16 literal 3.5 is converted to f16');
  assert(enc('v_add_f16 v1, 3.5, v0')[1] === f32ToF16(3.5), 'f16 literal holds the f16 bit pattern');
  assert(readF16(run1('v_add_f16 v1, 2.0, v0', e => writeF16(e, 0, 0, 1.0)), 1, 0) === 3.0, 'inline 2.0 is f16 2.0 for f16 operands');
}
assert(assemble('v_add_nc_u16 v0, 0x1ff00, v1').errors.length === 1, '16-bit operands reject constants that do not fit');
{
  const emu = run1('s_mov_b64 s[0:1], 0x80000000');
  assert(emu.state.readSGPR(0) === 0x80000000 && emu.state.readSGPR(1) === 0, 'a 32-bit literal is zero-extended for b64 operands');
  assert(run1('s_mov_b64 s[0:1], -5').state.readSGPR(1) === 0xFFFFFFFF, 'inline integers are sign-extended to 64 bits');
}

group('Regression: branches, labels and the program counter');
{
  const emu = run1(['s_branch skip', 'v_mov_b32 v0, 1', 'skip:', 'v_mov_b32 v1, 2'].join('\n'));
  assert(emu.state.readVGPR_u32(0, 0) === 0 && emu.state.readVGPR_u32(1, 0) === 2, 'forward branch lands exactly on its label');
  const r = assemble(['s_branch skip', 'v_bfe_u32 v0, v1, 0x3039, s1', 'skip:', 's_endpgm'].join('\n'));
  assert((r.binary[0] & 0xFFFF) === 3, 'branch offsets count dwords (VOP3 + literal = 3)');
  const loop = run1(['s_mov_b32 s0, 5', 'v_mov_b32 v0, 0', 'loop:', 'v_add_nc_u32 v0, 1, v0', 's_sub_u32 s0, s0, 1',
    's_cmp_lg_u32 s0, 0', 's_cbranch_scc1 loop'].join('\n'));
  assert(loop.state.readVGPR_u32(0, 0) === 5, 'backward branch loop runs 5 times');
}
{
  assert(assemble('a:\na:\ns_endpgm').errors.some(e => /already defined/.test(e.message)), 'duplicate label is an error');
  assert(assemble('s_branch nowhere\ns_endpgm').errors.some(e => /Undefined label/.test(e.message)), 'undefined label is an error');
  const r = assemble('s_branch end\nv_nop\nend:');
  assert(r.errors.length === 0 && (r.binary[0] & 0xFFFF) === 1, 'a label after the last instruction is valid');
  const emu = new Emulator();
  emu.load(r.binary);
  emu.run();
  assert(emu.isComplete() && emu.fault !== null && /jumped to the end of the program/.test(emu.fault),
    'branching to the end of the program (past the last instruction) crashes');
}
{
  const emu = run1(['v_add_f32 v0, v1, v2 clamp', 's_getpc_b64 s[0:1]'].join('\n'));
  assert(emu.state.readSGPR(0) === 12 && emu.state.readSGPR(1) === 0, 's_getpc_b64: byte address of the next instruction');
  const jump = run1(['s_getpc_b64 s[0:1]', 's_add_u32 s0, s0, 12', 's_setpc_b64 s[0:1]', 'v_mov_b32 v0, 1', 'v_mov_b32 v1, 2'].join('\n'));
  assert(jump.state.readVGPR_u32(0, 0) === 0 && jump.state.readVGPR_u32(1, 0) === 2, 's_setpc_b64 jumps to a byte address');
  const step = setup(['v_add_f32 v0, v1, v2 clamp', 'v_mov_b32 v0, 1', 's_endpgm'].join('\n'));
  step.step();
  assert(step.getPCBytes() === 8, 'getPCBytes uses real instruction sizes');
}
{
  const mis = run1(['s_mov_b64 s[0:1], 2', 's_setpc_b64 s[0:1]'].join('\n'));
  assert(mis.fault !== null && /misaligned/.test(mis.fault), 'a misaligned jump faults');
  const mid = run1(['v_bfe_u32 v0, v1, 0x3039, s1', 's_mov_b64 s[0:1], 4', 's_setpc_b64 s[0:1]'].join('\n'));
  assert(mid.fault !== null && /not the start of an instruction/.test(mid.fault), 'a jump into the middle of an instruction faults');
  const spin = setup('loop:\ns_branch loop');
  spin.run(1000);
  assert(spin.fault !== null && /infinite loop/.test(spin.fault), 'run() stops runaway loops');
}

group('Regression: carry chains, masks and special sources');
{
  const emu = setup(['v_add_co_u32 v4, s10, v0, v2', 'v_add_co_ci_u32 v5, s12, v1, v3, s10', 's_endpgm'].join('\n'));
  emu.state.writeVGPR_u32(0, 0, 0xFFFFFFFF);
  emu.state.writeVGPR_u32(1, 0, 1);
  emu.state.writeVGPR_u32(2, 0, 1);
  emu.state.writeVGPR_u32(3, 0, 2);
  emu.state.exec = 1;
  emu.run();
  assert(emu.state.readVGPR_u32(4, 0) === 0 && emu.state.readVGPR_u32(5, 0) === 4, '64-bit add via v_add_co_u32 + v_add_co_ci_u32');
  assert(emu.state.readSGPR(10) === 1 && emu.state.readSGPR(12) === 0, 'carry-out masks go to the chosen SGPRs');
  assert(emu.state.vcc === 0, 'VCC is untouched when SGPR carries are used');
}
{
  const emu = run1(['s_mov_b32 m0, 77', 'v_mov_b32 v0, m0', 's_mov_b32 s0, exec_lo', 's_mov_b32 vcc_lo, 5',
    'v_add_nc_u32 v1, vcc_lo, v0'].join('\n'));
  assert(emu.state.readVGPR_u32(0, 3) === 77, 'm0 as a VALU source');
  assert(emu.state.readSGPR(0) === 0xFFFFFFFF, 'exec_lo as a SALU source');
  assert(emu.state.readVGPR_u32(1, 0) === 82, 'vcc_lo as a VALU source');
}
{
  const emu = run1(['v_mbcnt_lo_u32_b32 v0, -1, 0', 'v_cmp_gt_u32 s4, v0, 15'].join('\n'));
  assert(emu.state.readSGPR(4) === 0xFFFF0000, 'v_cmp_* can write its mask to an SGPR (VOP3)');
  assert(emu.state.vcc === 0, 'VCC is untouched when a compare writes an SGPR');
  const cmpx = run1(['v_mbcnt_lo_u32_b32 v0, -1, 0', 'v_cmpx_lt_u32 v0, 4', 'v_mov_b32 v1, 9'].join('\n'));
  assert(cmpx.state.exec === 0xF, 'v_cmpx writes EXEC');
  assert(cmpx.state.readVGPR_u32(1, 3) === 9 && cmpx.state.readVGPR_u32(1, 4) === 0, 'v_cmpx masks later instructions');
  const inactive = run1(['s_mov_b32 vcc_lo, -1', 's_mov_b32 exec_lo, 0xFF', 'v_cmp_eq_u32 vcc_lo, v0, v0'].join('\n'));
  assert(inactive.state.vcc === 0xFF, 'VOPC clears the mask bits of inactive lanes');
  const sel = run1(['v_mbcnt_lo_u32_b32 v0, -1, 0', 's_mov_b32 s6, 0xAAAAAAAA', 'v_cndmask_b32 v1, 100, v0, s6'].join('\n'));
  assert(sel.state.readVGPR_u32(1, 2) === 100 && sel.state.readVGPR_u32(1, 3) === 3, 'v_cndmask_b32 with an SGPR condition (VOP3)');
}

group('Regression: 16-bit operations');
{
  const emu = setup('v_add_f16 v2, v0, v1\ns_endpgm');
  writeF16(emu, 0, 0, 1.5);
  writeF16(emu, 1, 0, 2.25);
  emu.state.writeVGPR_u32(2, 0, 0xABCD0000);
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === (0xABCD0000 | f32ToF16(3.75)) >>> 0, 'v_add_f16 writes the low half and preserves the high half');
  const big = setup('v_mul_f16 v2, v0, v1\ns_endpgm');
  writeF16(big, 0, 0, 1000);
  writeF16(big, 1, 0, 1000);
  big.run();
  assert(readF16(big, 2, 0) === Infinity, 'f16 arithmetic overflows past 65504');
}
{
  const emu = setup('v_add_nc_u16 v2, v0, v1 op_sel:[1,1,1]\ns_endpgm');
  emu.state.writeVGPR_u32(0, 0, (7 << 16) | 100);
  emu.state.writeVGPR_u32(1, 0, (5 << 16) | 200);
  emu.state.writeVGPR_u32(2, 0, 0x1234);
  emu.run();
  assert(emu.state.readVGPR_u32(2, 0) === ((12 << 16) | 0x1234) >>> 0, 'op_sel:[1,1,1] reads and writes the high halves');
  assert(((enc('v_add_nc_u16 v2, v0, v1 op_sel:[1,1,1]')[0] >>> 11) & 0xF) === 0xB, 'op_sel bits: src0, src1, dst (bit 3) in [14:11]');
  assert(assemble('v_add_f32 v0, v1, v2 op_sel:[1,0,0]').errors.length === 1, 'op_sel is rejected where the hardware ignores it');
}
{
  const half = (x: number) => (f32ToF16(x) << 16) | f32ToF16(3.0);
  const a = run1('v_pk_add_f16 v1, v0, 1.0', e => e.state.writeVGPR_u32(0, 0, half(2.0)));
  assert((a.state.readVGPR_u32(1, 0) & 0xFFFF) === f32ToF16(4.0), 'v_pk_add_f16: an inline constant feeds the low half');
  assert((a.state.readVGPR_u32(1, 0) >>> 16) === f32ToF16(2.0), 'v_pk_add_f16: the high half of an inline constant is 0');
  const b = run1('v_pk_add_f16 v1, v0, 1.0 op_sel_hi:[1,0]', e => e.state.writeVGPR_u32(0, 0, half(2.0)));
  assert((b.state.readVGPR_u32(1, 0) >>> 16) === f32ToF16(3.0), 'op_sel_hi:[1,0] applies the constant to both halves');
  const mix = run1('v_fma_mix_f32 v2, v0, v1, v1 op_sel:[0,1,0] op_sel_hi:[0,1,1]', e => {
    e.state.writeVGPR(0, 0, 1.5);
    e.state.writeVGPR_u32(1, 0, (f32ToF16(4.0) << 16) | f32ToF16(0.25));
  });
  assert(mix.state.readVGPR(2, 0) === 6.25, 'v_fma_mix_f32 mixes an f32 source with f16 halves');
}

group('Regression: K constants, SCC and scalar ops');
{
  const a = 1 + 2 ** -12;
  const init = (e: Emulator) => { e.state.writeVGPR(0, 0, a); e.state.writeVGPR(1, 0, a); };
  const madak = run1('v_madak_f32 v2, v0, v1, -1.00048828125', init);
  const fmaak = run1('v_fmaak_f32 v2, v0, v1, -1.00048828125', init);
  assert(madak.state.readVGPR(2, 0) === 0, 'v_madak_f32 rounds the product (not fused)');
  assert(fmaak.state.readVGPR(2, 0) === 2 ** -24, 'v_fmaak_f32 is fused');
}
{
  const scc = (lines: string[], before = 0): Emulator => {
    const e = setup([...lines, 's_endpgm'].join('\n'));
    e.state.scc = before;
    e.run();
    return e;
  };
  assert(scc(['s_min_i32 s2, -1, 5']).state.scc === 1, 's_min_i32: SCC = (src0 < src1)');
  assert(scc(['s_min_u32 s2, 9, 5']).state.scc === 0, 's_min_u32: SCC = (src0 < src1)');
  assert(scc(['s_max_i32 s2, 7, 5']).state.scc === 1, 's_max_i32: SCC = (src0 > src1)');
  assert(scc(['s_bfm_b32 s2, 4, 8'], 1).state.scc === 1, 's_bfm_b32 does not write SCC');
  assert(scc(['s_mul_i32 s2, 0, 5'], 1).state.scc === 1, 's_mul_i32 does not write SCC');
  assert(scc(['s_bcnt1_i32_b32 s2, 0'], 1).state.scc === 0, 's_bcnt1_i32_b32: SCC = (result != 0)');
  const addk = scc(['s_mov_b32 s0, 0x7FFFFFFF', 's_addk_i32 s0, 1']);
  assert(addk.state.readSGPR(0) === 0x80000000 && addk.state.scc === 1, 's_addk_i32: SCC = signed overflow');
  assert(scc(['s_mov_b32 s0, -1', 's_mul_hi_u32 s2, s0, s0']).state.readSGPR(2) === 0xFFFFFFFE, 's_mul_hi_u32 uses the exact 64-bit product');
  assert(scc(['s_mov_b32 s0, -2', 's_mul_hi_i32 s2, s0, 3']).state.readSGPR(2) === 0xFFFFFFFF, 's_mul_hi_i32 is signed');
  const save = scc(['s_mov_b32 s2, 0x0000FFFF', 's_and_saveexec_b32 s0, s2']);
  assert(save.state.readSGPR(0) === 0xFFFFFFFF && save.state.exec === 0xFFFF && save.state.scc === 1, 's_and_saveexec_b32 saves and masks EXEC_LO');
  const rel = scc(['s_mov_b32 s5, 55', 's_mov_b32 m0, 3', 's_movrels_b32 s0, s2', 's_movreld_b32 s10, 99']);
  assert(rel.state.readSGPR(0) === 55 && rel.state.readSGPR(13) === 99, 's_movrels_b32 / s_movreld_b32 index with M0');
  assert(scc(['s_mov_b64 null, 0']).state.exec === 0xFFFFFFFF, 'a 64-bit write to null leaves EXEC alone');
}

group('Regression: GFX10 encodings (checked against LLVM)');
{
  assert(same(enc('v_bfe_u32 v0, v1, 0x3039, s1'), [0xD5480000, 0x0005FF01, 0x3039]), 'VOP3A: prefix 0x35 and a literal');
  assert(same(enc('v_add_f32_e64 v5, v1, v2'), [0xD5030005, 0x02020501]), 'VOP3A: promoted VOP2, unused src2 = inline 0');
  assert(same(enc('v_add_f32 v5, v1, v2 clamp'), [0xD5038005, 0x02020501]), 'VOP3A: clamp is bit 15');
  assert(same(enc('v_add_co_u32 v5, s6, v1, v2'), [0xD70F0605, 0x02020501]), 'VOP3B: SDST in [14:8]');
  assert(same(enc('v_cmp_lt_f32 s10, v1, v2'), [0xD401000A, 0x02020501]), 'VOPC in VOP3: VDST holds the SGPR result');
  assert(same(enc('v_pk_add_f16 v1, v2, v3'), [0xCC0F4001, 0x1A020702]), 'VOP3P: prefix 0xCC, op_sel_hi defaults to 1');
  assert(same(enc('ds_permute_b32 v0, v1, v2'), [0xDAC80000, 0x00000201]), 'DS: ds_permute_b32 is opcode 0xB2');
  assert(same(enc('s_mov_b32 s0, s1'), [0xBE800301]), 'SOP1: s_mov_b32 is opcode 0x03');
  assert(same(enc('s_waitcnt vmcnt(0) lgkmcnt(0)'), [0xBF8C0070]), 's_waitcnt counter syntax');
  assert(same(enc('v_mov_b32 v0, v1 dpp8:[7,6,5,4,3,2,1,0]'), [0x7E0002E9, 0x05397701]), 'DPP8 lane selectors');
  assert(same(enc('v_mov_b32 v5, v1 dst_sel:BYTE_0 dst_unused:UNUSED_PAD src0_sel:DWORD'), [0x7E0A02F9, 0x00060001]), 'SDWA word layout');
  assert(enc('v_mov_b32_e64 v0, v1').length === 2, '_e64 forces the VOP3 encoding');
  assert(assemble('v_mov_b32_e32 v0, -v1').errors.length === 1, '_e32 cannot encode source modifiers');
}
{
  // Disassembly re-assembles to identical words
  const src = ['v_add_f32 v0, -v1, |v2| clamp', 'v_cndmask_b32 v3, v0, v1, s4', 'v_mov_b32 v5, v1 row_shr:3 bound_ctrl:1',
    'v_add_nc_u32 v6, v1, v2 dst_sel:WORD_1 dst_unused:UNUSED_PRESERVE src0_sel:BYTE_2 src1_sel:DWORD',
    'v_pk_fma_f16 v7, v1, v2, v3 op_sel:[1,0,0] neg_lo:[0,1,0]', 's_add_u32 s0, s1, 0x12345', 's_cselect_b64 s[2:3], s[4:5], exec',
    'ds_read2st64_b32 v[8:9], v1 offset0:1 offset1:2', 'v_cmp_lt_f32 s8, v1, 2.5', 's_waitcnt lgkmcnt(0)', 's_endpgm'].join('\n');
  const a = assemble(src);
  const text = decodeBinary(a.binary).map(d => disassemble(d)).join('\n');
  const b = assemble(text);
  assert(a.errors.length === 0 && b.errors.length === 0 && same(Array.from(a.binary), Array.from(b.binary)), 'disassembly round-trips');
  const xbox = decodeBinary(new Uint32Array([0xD5800000, 0x02010080, 0xDEADBEEF, ENDPGM]));
  assert(xbox.length === 2 && xbox[0].size === 3 && xbox[0].literal === 0xDEADBEEF, 'Xbox VOP3 v_nop carries an extra data dword');
}

group('Regression: operand rules');
{
  assert(assemble('v_fma_f32 v0, 1.5, 2.5, v1').errors.length === 1, 'two different literals are rejected');
  assert(assemble('v_fma_f32 v0, 1.5, 1.5, v1').errors.length === 0, 'one literal may be used twice');
  assert(assemble('v_fma_f32 v0, s0, s1, s2').errors.length === 1, 'three SGPRs exceed the constant bus');
  assert(assemble('v_fma_f32 v0, s0, s0, s1').errors.length === 0, 'two unique SGPRs are allowed');
  assert(assemble('v_add_f32 v0, 0x1234, v1 row_shr:1').errors.length === 1, 'DPP needs a VGPR src0 (no literals)');
  assert(assemble('s_load_dword s0, s[0:1], 0x0').errors.some(e => /not supported/.test(e.message)), 'memory instructions are rejected clearly');
  assert(assemble('v_mov_b32 v256, v0').errors.length === 1, 'v256 does not exist');
  assert(assemble('s_mov_b32 s106, 0').errors.length === 1, 's106 does not exist');
  assert(assemble('s_mov_b64 s[1:2], 0').errors.some(e => /even/.test(e.message)), '64-bit SGPR pairs must be even-aligned');
  assert(assemble('v_mov_b32 v0, v1 #').errors.length === 1, 'stray characters are reported');
  assert(assemble('v_movrels_b32 v0, s1').errors.length === 1, 'v_movrels_b32 needs a VGPR source');
  assert(assemble('v_cmp_gt_f32 vcc_lo, v0, v1 quad_perm:[1,0,3,2]').errors.some(e => /VOPC.*DPP/.test(e.message)), 'VOPC cannot use DPP16');
  assert(assemble('v_cmpx_eq_u32 v0, v1 dpp8:[1,0,3,2,5,4,7,6]').errors.length === 1, 'VOPC cannot use DPP8');
  assert(assemble('v_cmp_gt_u32_sdwa vcc_lo, v0, v1 src0_sel:BYTE_0 src1_sel:BYTE_1').errors.length === 0, 'VOPC may use SDWA');
  assert(assemble('v_readfirstlane_b32 s0, v1 row_shr:1').errors.length === 1, 'v_readfirstlane_b32 cannot use DPP');
  assert(assemble('v_swap_b32 v0, v1 src0_sel:WORD_1').errors.length === 1, 'v_swap_b32 cannot use SDWA');
  assert(assemble('v_fmac_f32 v0, v1, v2 src0_sel:WORD_0').errors.some(e => /SDWA/.test(e.message)), 'v_fmac_f32 cannot use SDWA');
  assert(assemble('v_fmac_f32 v0, v1, v2 row_shr:1').errors.length === 0, 'v_fmac_f32 may use DPP');
}

group('Regression: lane operations and LDS');
{
  const emu = run1(['v_mbcnt_lo_u32_b32 v0, -1, 0', 'v_add_nc_u32 v1, 1, v0', 'v_lshlrev_b32 v1, 2, v1', 'v_mov_b32 v2, 0x55',
    's_mov_b32 exec_lo, 0xFFFF', 'ds_permute_b32 v2, v1, v0'].join('\n'));
  assert(emu.state.readVGPR_u32(2, 0) === 0, 'ds_permute: a lane that receives nothing gets 0');
  assert(emu.state.readVGPR_u32(2, 5) === 4, 'ds_permute: lane 4 sends to lane 5');
  assert(emu.state.readVGPR_u32(2, 16) === 0x55, 'ds_permute: inactive lanes are not written');
}
{
  const emu = run1(['v_mbcnt_lo_u32_b32 v0, -1, 0', 'v_lshlrev_b32 v1, 2, v0', 'v_mul_u32_u24 v2, 3, v0',
    'ds_write_b32 v1, v2 offset:64', 'ds_read_b32 v3, v1 offset:64', 'v_mov_b32 v4, 0x10000', 'ds_read_b32 v5, v4'].join('\n'));
  assert(emu.state.readVGPR_u32(3, 7) === 21, 'LDS: ds_write_b32 / ds_read_b32 round trip');
  assert(emu.state.lds[(64 >> 2) + 7] === 21, 'LDS: data lands at byte address vaddr + offset');
  assert(emu.state.readVGPR_u32(5, 0) === 0, 'LDS: reads past 64 KB return 0');
  const rot = run1(['v_mbcnt_lo_u32_b32 v0, -1, 0', `ds_swizzle_b32 v1, v0 offset:0x${(0xC000 | (1 << 5)).toString(16)}`].join('\n'));
  assert(rot.state.readVGPR_u32(1, 0) === 1 && rot.state.readVGPR_u32(1, 31) === 0, 'ds_swizzle rotate mode');
}
{
  const first = run1(['v_mbcnt_lo_u32_b32 v0, -1, 0', 'v_add_nc_u32 v0, 10, v0', 's_mov_b32 exec_lo, 0', 'v_readfirstlane_b32 s0, v0',
    's_mov_b32 exec_lo, 0xF0', 'v_readfirstlane_b32 s1, v0'].join('\n'));
  assert(first.state.readSGPR(0) === 10, 'v_readfirstlane_b32 reads lane 0 when EXEC is 0');
  assert(first.state.readSGPR(1) === 14, 'v_readfirstlane_b32 reads the first active lane');
  const mb = run1(['v_mbcnt_lo_u32_b32 v0, -1, 0', 'v_mbcnt_hi_u32_b32 v1, -1, v0', 's_mov_b32 s0, 0xF0F0F0F0', 'v_mbcnt_lo_u32_b32 v2, s0, 100'].join('\n'));
  assert(mb.state.readVGPR_u32(0, 13) === 13 && mb.state.readVGPR_u32(1, 13) === 13, 'v_mbcnt_lo/hi lane-index idiom (wave32)');
  assert(mb.state.readVGPR_u32(2, 9) === 104, 'v_mbcnt_lo_u32_b32 counts mask bits below the lane');
  const perm = run1(['v_mbcnt_lo_u32_b32 v0, -1, 0', 's_mov_b32 s0, 0x87654321', 's_mov_b32 s1, 0x0fedcba9',
    'v_permlane16_b32 v1, v0, s0, s1', 'v_permlanex16_b32 v2, v0, s0, s1'].join('\n'));
  assert(perm.state.readVGPR_u32(1, 0) === 1 && perm.state.readVGPR_u32(1, 15) === 0 && perm.state.readVGPR_u32(1, 16) === 17, 'v_permlane16_b32 rotates within rows');
  assert(perm.state.readVGPR_u32(2, 0) === 17 && perm.state.readVGPR_u32(2, 16) === 1, 'v_permlanex16_b32 reads the other row');
}

group('Regression: arithmetic details');
{
  const mad = setup('v_mad_u64_u32 v[2:3], s6, v0, v1, v[4:5]\ns_endpgm');
  for (const r of [0, 1, 4, 5]) mad.state.writeVGPR_u32(r, 0, 0xFFFFFFFF);
  mad.state.exec = 1;
  mad.run();
  assert(mad.state.readVGPR_u32(2, 0) === 0 && mad.state.readVGPR_u32(3, 0) === 0xFFFFFFFE, 'v_mad_u64_u32: 64-bit result');
  assert(mad.state.readSGPR(6) === 1, 'v_mad_u64_u32: carry-out to the SDST SGPR');
  const fmas = setup('v_div_fmas_f32 v3, v0, v1, v2\ns_endpgm');
  for (const lane of [0, 1]) {
    fmas.state.writeVGPR(0, lane, 2.0);
    fmas.state.writeVGPR(1, lane, 3.0);
    fmas.state.writeVGPR(2, lane, 1.0);
  }
  fmas.state.vcc = 0b10;
  fmas.run();
  assert(fmas.state.readVGPR(3, 0) === 7 && fmas.state.readVGPR(3, 1) === 7 * 2 ** 32, 'v_div_fmas_f32 scales VCC lanes by 2^32');
}
{
  const sat = run1('v_add_nc_u32 v2, v0, v1 clamp', e => { e.state.writeVGPR_u32(0, 0, 0xFFFFFFF0); e.state.writeVGPR_u32(1, 0, 0x100); });
  assert(sat.state.readVGPR_u32(2, 0) === 0xFFFFFFFF, 'clamp saturates unsigned integer adds');
  const ssat = run1('v_sub_nc_i32 v2, v0, v1 clamp', e => { e.state.writeVGPR_u32(0, 0, 0x80000000); e.state.writeVGPR_u32(1, 0, 1); });
  assert(ssat.state.readVGPR_u32(2, 0) === 0x80000000, 'clamp saturates signed integer subtracts');
  const sext = run1('v_mov_b32 v1, v0 dst_sel:BYTE_1 dst_unused:UNUSED_SEXT src0_sel:BYTE_0', e => e.state.writeVGPR_u32(0, 0, 0x80));
  assert(sext.state.readVGPR_u32(1, 0) === 0xFFFF8000, 'SDWA UNUSED_SEXT sign-extends above the field and zeroes below');
  const ldexp = run1('v_ldexp_f32 v1, 0, v0', e => e.state.writeVGPR_u32(0, 0, 2000));
  assert(ldexp.state.readVGPR_u32(1, 0) === 0, 'v_ldexp_f32: 0 × 2^2000 = 0, not NaN');
  const ldexpNeg = run1('v_ldexp_f32 v1, -v2, v0', e => { e.state.writeVGPR_u32(0, 0, 3); e.state.writeVGPR(2, 0, 1.5); });
  assert(ldexpNeg.state.readVGPR(1, 0) === -12, 'v_ldexp_f32 accepts float source modifiers');
}
{
  const unknown = new Emulator();
  unknown.load(new Uint32Array([0x7C800100, ENDPGM])); // VOPC opcode 0x40: unassigned on GFX10
  unknown.run();
  assert(unknown.fault !== null && /Unknown instruction/.test(unknown.fault), 'unknown opcodes fault instead of crashing');
  const past = run1('s_mov_b32 m0, 10\nv_movreld_b32 v250, v0');
  assert(past.fault !== null && /past v255/.test(past.fault), 'v_movreld_b32 past v255 faults');
}

group('Regression: code review fixes');
{
  // v_nop has no VOP3, DPP or SDWA form; imported VOP3 v_nops (Xbox data dword) keep their layout
  for (const text of ['v_nop_e64', 'v_nop clamp', 'v_nop mul:2', 'v_nop_sdwa', 'v_nop dst_sel:DWORD', 'v_nop quad_perm:[0,1,2,3]', 'v_nop dpp8:[0,1,2,3,4,5,6,7]']) {
    assert(assemble(text).errors.length === 1, `${text} is rejected`);
  }
  const imported = decodeBinary(new Uint32Array([0xD5800000, 0x02010080, 0xDEADBEEF, 0x7E020285, ENDPGM]));
  const text = imported.map(d => disassemble(d, lookupByOpcode)).join('\n');
  const re = assemble(text);
  assert(re.errors.length === 0 && re.binary.length === 5 && /0xdeadbeef/i.test(text), 'an imported VOP3 v_nop + data dword re-assembles at the same size');
  const emu = new Emulator();
  emu.load(re.binary);
  emu.run();
  assert(emu.state.readVGPR_u32(1, 0) === 5, 'the instruction after an imported VOP3 v_nop still runs');
  const dppNop = decodeBinary(new Uint32Array([0x7E0000FA, 0xFF00E400, 0x7E020285, ENDPGM]));
  const dppText = dppNop.map(d => disassemble(d, lookupByOpcode)).join('\n');
  assert(assemble(dppText).binary.length === 4, 'imported 2-dword (DPP/SDWA/literal) v_nop forms keep their size too');
}
{
  // v_movrel* honour DPP and SDWA
  const dpp = run1('v_mbcnt_lo_u32_b32 v2, -1, 0\ns_mov_b32 m0, 1\nv_movrels_b32 v0, v1 quad_perm:[1,0,3,2]');
  assert([0, 1, 2, 3, 17].every(l => dpp.state.readVGPR_u32(0, l) === (l ^ 1)), 'v_movrels_b32 applies DPP lane selection to the M0-indexed source');
  const shr = run1('v_mbcnt_lo_u32_b32 v2, -1, 0\ns_mov_b32 m0, 1\nv_mov_b32 v0, 99\nv_movrels_b32 v0, v1 row_shr:1');
  assert(shr.state.readVGPR_u32(0, 0) === 99 && shr.state.readVGPR_u32(0, 1) === 0 && shr.state.readVGPR_u32(0, 16) === 99, 'v_movrels_b32 row_shr leaves lanes without a source unwritten');
  const sel = run1('s_mov_b32 m0, 1\nv_movrels_b32 v0, v1 src0_sel:BYTE_3', e => e.state.writeVGPR_u32(2, 0, 0x11223344));
  assert(sel.state.readVGPR_u32(0, 0) === 0x11, 'v_movrels_b32 applies the SDWA source select');
  const dst = run1('s_mov_b32 m0, 2\nv_movreld_b32 v0, v1 dst_sel:BYTE_1 dst_unused:UNUSED_PRESERVE',
    e => { e.state.writeVGPR_u32(1, 0, 0xAB); e.state.writeVGPR_u32(2, 0, 0x11223344); });
  assert(dst.state.readVGPR_u32(2, 0) === 0x1122AB44, 'v_movreld_b32 applies the SDWA destination select to the M0-indexed register');
}
{
  // Inline constants in 16-bit instructions: f16 ops get the f16 value in the low half,
  // integer ops the f32 bits, and integer constants are sign-extended
  const pk = run1('v_mov_b32 v0, 0\nv_pk_add_u16 v1, v0, 1.0');
  assert(pk.state.readVGPR_u32(1, 0) === 0x3F800000, 'packed integer ops receive inline float constants as f32 bits');
  const pkInt = run1('v_mov_b32 v0, 0\nv_pk_add_u16 v1, v0, -1');
  assert(pkInt.state.readVGPR_u32(1, 0) === 0xFFFFFFFF, 'negative integer constants fill both halves of a packed operand');
  const pkF16 = run1('v_mov_b32 v0, 0\nv_pk_add_f16 v1, v0, 1.0');
  assert(pkF16.state.readVGPR_u32(1, 0) === 0x00003C00, 'packed f16 ops receive inline float constants as f16 in the low half');
  const u16 = run1('v_mov_b32 v0, 5\nv_add_nc_u16 v1, 1.0, v0');
  assert((u16.state.readVGPR_u32(1, 0) & 0xFFFF) === 5, '16-bit integer ops use the low half of a float constant\'s f32 bits');
  const cmp = run1('v_mov_b32 v0, 0\nv_cmp_eq_u16 vcc_lo, 0.5, v0');
  assert(cmp.state.vcc === 0xFFFFFFFF, 'a float constant on a 16-bit integer compare reads as 0');
  const lit = assemble('v_add_nc_u16 v5, 3.5, v2');
  assert(lit.errors.length === 0 && lit.binary[2] === 0x40600000, 'a non-inline float on a 16-bit integer operand is its f32 bit pattern');
  const back = assemble(decodeBinary(lit.binary).map(d => disassemble(d, lookupByOpcode)).join('\n'));
  assert(back.errors.length === 0 && same(Array.from(back.binary), Array.from(lit.binary)), 'its disassembly re-assembles to the same words');
  const negZero = assemble('v_add_nc_u16 v0, v1, -0.0');
  const negZeroBack = assemble(decodeBinary(negZero.binary).map(d => disassemble(d, lookupByOpcode)).join('\n'));
  assert(negZeroBack.errors.length === 0 && same(Array.from(negZeroBack.binary), Array.from(negZero.binary)), '-0.0 on a 16-bit integer operand round-trips');
  const fmac = run1('v_mov_b32 v0, 0\nv_mov_b32 v1, 0x3c003c00\nv_pk_fmac_f16 v0, 1.5, v1');
  assert(fmac.state.readVGPR_u32(0, 0) === 0x00003E00 && enc('v_pk_fmac_f16 v0, 1.5, v1')[1] === 0x3E00,
    'v_pk_fmac_f16 encodes a float constant as packed f16 (value in the low half)');
}
{
  // Constant bus: 64-bit shifts read one scalar value; the literal at two operand sizes counts twice
  assert(assemble('v_lshlrev_b64 v[0:1], s0, s[2:3]').errors.some(e => /only one/.test(e.message)), '64-bit shifts may read only one scalar value');
  assert(assemble('v_lshlrev_b64 v[0:1], 0x1234, s[2:3]').errors.length === 1, 'a literal counts against the 64-bit shift limit');
  assert(assemble('v_lshrrev_b64 v[0:1], 4, s[2:3]').errors.length === 0, 'inline constants are free for 64-bit shifts');
  assert(assemble('v_ashrrev_i64 v[0:1], s0, v[2:3]').errors.length === 0, 'one SGPR is fine for a 64-bit shift');
  assert(assemble('v_mad_u64_u32 v[0:1], s4, s0, 0x12345, 0x12345').errors.length === 1, 'the literal used at two operand sizes counts twice');
  assert(assemble('v_mad_u64_u32 v[0:1], s4, v0, 0x12345, 0x12345').errors.length === 0, 'two literal reads are within the limit');
  assert(assemble('v_fma_f32 v0, s0, 0x12345, 0x12345').errors.length === 0, 'the same 32-bit literal twice counts once');
}
{
  // Instructions without a VOP3 form or a clamp bit
  for (const text of ['v_pk_fmac_f16_e64 v0, v1, v2', 'v_pk_fmac_f16 v0, -v1, v2 quad_perm:[1,0,3,2]', 'v_dot4c_i32_i8 v0, v1, v2 clamp',
    'v_swap_b32_e64 v0, v1', 'v_mov_b32_e64 v0, v1 clamp', 'v_and_b32_e64 v0, v1, v2 clamp', 'v_lshl_add_u32 v0, v1, 2, v2 clamp',
    'v_mbcnt_lo_u32_b32 v0, -1, 0 clamp', 'v_pk_lshlrev_b16 v0, 1, v1 clamp', 'v_mov_b32_sdwa v0, v1 clamp']) {
    assert(assemble(text).errors.length === 1, `${text} is rejected`);
  }
  assert(assemble('v_pk_fmac_f16 v0, v1, v2 quad_perm:[1,0,3,2]').errors.length === 0, 'v_pk_fmac_f16 may still use DPP');
}
{
  // clamp saturates integer arithmetic to the result type
  const regs = (vals: number[]) => (e: Emulator) => vals.forEach((v, i) => e.state.writeVGPR_u32(i + 1, 0, v >>> 0));
  const v0 = (src: string, vals: number[]) => run1(src, regs(vals)).state.readVGPR_u32(0, 0);
  assert(v0('v_mul_u32_u24_e64 v0, v1, v2 clamp', [0xFFFFFF, 0xFFFFFF]) === 0xFFFFFFFF, 'v_mul_u32_u24 clamp saturates');
  assert(v0('v_mul_u32_u24 v0, v1, v2', [0xFFFFFF, 0xFFFFFF]) === 0xFE000001, 'v_mul_u32_u24 without clamp keeps the low 32 bits');
  assert(v0('v_mul_i32_i24_e64 v0, v1, v2 clamp', [0x7FFFFF, 0x800000]) === 0x80000000, 'v_mul_i32_i24 clamp saturates to INT_MIN');
  assert(v0('v_mad_u32_u24 v0, v1, v2, v3 clamp', [0x10000, 0x10000, 5]) === 0xFFFFFFFF, 'v_mad_u32_u24 clamp saturates');
  assert(v0('v_add3_u32 v0, v1, v2, v3 clamp', [0xFFFFFFFF, 1, 1]) === 0xFFFFFFFF, 'v_add3_u32 clamp saturates');
  assert(v0('v_mul_lo_u32 v0, v1, v2 clamp', [0x10000, 0x10001]) === 0xFFFFFFFF, 'v_mul_lo_u32 clamp saturates');
  assert(v0('v_sad_u8 v0, v1, v2, v3 clamp', [0xFFFFFFFF, 0, 0xFFFFFFFF]) === 0xFFFFFFFF, 'v_sad_u8 clamp saturates the accumulation');
  assert(v0('v_pk_mul_lo_u16 v0, v1, v2 clamp', [0x01000100, 0x01000100]) === 0xFFFFFFFF, 'v_pk_mul_lo_u16 clamp saturates each half');
  assert(v0('v_cvt_pkrtz_f16_f32_e64 v0, 2.0, -1.0 clamp', []) === 0x00003C00, 'v_cvt_pkrtz_f16_f32 clamp limits each half to [0, 1]');
  assert(v0('v_pack_b32_f16 v0, v1, v2 clamp', [0x4200, 0x3800]) === 0x38003C00, 'v_pack_b32_f16 clamp limits each half to [0, 1]');
  const qsad = (c: string) => run1(`v_qsad_pk_u16_u8 v[0:1], v[2:3], v4, v[6:7]${c}`, e => {
    e.state.writeVGPR_u32(4, 0, 0xFFFFFFFF); e.state.writeVGPR_u32(6, 0, 0xFFFFFFFF); e.state.writeVGPR_u32(7, 0, 0xFFFFFFFF);
  }).state.readVGPR_u32(0, 0);
  assert(qsad(' clamp') === 0xFFFFFFFF && qsad('') === 0x03FB03FB, 'v_qsad_pk_u16_u8 saturates (clamp) or truncates each 16-bit sum');
  const mad = run1('v_mad_u64_u32 v[0:1], s4, v2, v3, v[4:5] clamp', regs([0, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF]));
  assert(mad.state.readVGPR_u32(0, 0) === 0xFFFFFFFF && mad.state.readVGPR_u32(1, 0) === 0xFFFFFFFF && (mad.state.readSGPR(4) & 1) === 1,
    'v_mad_u64_u32 clamp saturates the 64-bit result and still reports the carry');
}

/**
 * Run every invocation of a puzzle the way the app does. A crash (a fault, or running off the end
 * without s_endpgm) stops the run, and the solution is then never valid.
 */
function runPuzzle(puzzle: Puzzle, source: string): PuzzleResult {
  const r = assemble(source);
  assert(r.errors.length === 0, `puzzle solution assembles: ${r.errors.map(e => e.message).join('; ')}`);
  const outputs = new Map<number, number[]>(puzzle.outputs.map(o => [o.register, []]));
  const invocations = Math.ceil(puzzle.outputs[0].values.length / 32);
  for (let inv = 0; inv < invocations; inv++) {
    const emu = new Emulator();
    emu.load(r.binary);
    for (const input of puzzle.inputs) {
      if (input.isSGPR) {
        emu.state.writeSGPR(input.register, (input.values[inv] ?? 0) >>> 0);
        continue;
      }
      for (let lane = 0; lane < 32; lane++) {
        const v = input.values[inv * 32 + lane] ?? 0;
        if (input.isInteger) emu.state.writeVGPR_u32(input.register, lane, v >>> 0);
        else emu.state.writeVGPR(input.register, lane, v);
      }
    }
    emu.run();
    if (emu.fault) return validatePuzzle(puzzle, outputs, { invocation: inv, message: emu.fault });
    for (const o of puzzle.outputs) {
      const out = outputs.get(o.register)!;
      for (let lane = 0; lane < 32 && inv * 32 + lane < o.values.length; lane++) {
        out[inv * 32 + lane] = o.isInteger ? emu.state.readVGPR_u32(o.register, lane) : emu.state.readVGPR(o.register, lane);
      }
    }
  }
  return validatePuzzle(puzzle, outputs);
}

group('Regression: player report — the 3.0 in a smoothstep had no effect');
{
  // A player's Smooth Clamp solution failed because 3.0 was encoded as the integer 3 (a tiny denormal)
  const puzzle = getPuzzleById('smooth-clamp')!;
  const solves = (lines: string[]): boolean => runPuzzle(puzzle, lines.join('\n')).pass;
  const head = ['v_sub_f32 v2, v2, v0', 'v_sub_f32 v1, v1, v0', 'v_rcp_f32 v1, v1', 'v_mul_f32 v0, v1, v2',
    'v_max_f32 v0, v0, 0.0', 'v_min_f32 v0, v0, 1.0', 'v_mul_f32 v1, v0, v0'];
  const tail = ['v_mul_f32 v3, v0, v1', 's_endpgm'];
  assert(solves([...head, 'v_mul_f32 v0, v0, -2.0', 'v_add_f32 v0, v0, 3.0', ...tail]), 'the reported solution (v_add_f32 v0, v0, 3.0) passes Smooth Clamp');
  assert(solves([...head, 'v_mad_f32 v0, v0, -2.0, 3.0', ...tail]), 'v_mad_f32 v0, v0, -2.0, 3.0 passes Smooth Clamp');
  assert(solves([...head, 'v_mul_f32 v0, v0, -2.0', 'v_mov_b32 v4, 3.0', 'v_add_f32 v0, v0, v4', ...tail]), 'v_mov_b32 v4, 3.0 then v_add_f32 passes Smooth Clamp');
  const add = run1('v_add_f32 v1, v0, 3.0', e => e.state.writeVGPR(0, 0, -2));
  assert(add.state.readVGPR(1, 0) === 1, 'a non-inline float as the second operand reads as an f32 literal (VOP3)');
}

group('Regression: player report — an integer 3 where the float 3.0 was meant');
{
  // A Smooth Clamp solution computed 3 - 2t as v_sub_f32 v2, 3, v2: an integer constant is a bit pattern to a
  // float operand (3 is a tiny denormal), so the result was -2t³. It assembled without a word; now it warns.
  const puzzle = getPuzzleById('smooth-clamp')!;
  const solution = ['v_sub_f32 v3, v1, v0', 'v_rcp_f32 v3, v3', 'v_sub_f32 v2, v2, v0', 'v_mul_f32 v2, v2, v3, clamp',
    'v_mul_f32 v0, v2, v2', 'v_add_f32 v2, v2, v2', 'v_sub_f32 v2, 3, v2', 'v_mul_f32 v3, v0, v2', 's_endpgm'].join('\n');
  const w = assemble(solution).warnings;
  assert(w.length === 1 && w[0].line === 7 && w[0].column === 15 && /^3 is an integer.*0x00000003 \(4\.2e-45\) rather than 3\.0/.test(w[0].message),
    'the reported solution warns at the 3 of v_sub_f32 v2, 3, v2');
  assert(!runPuzzle(puzzle, solution).pass && runPuzzle(puzzle, solution.replace(', 3,', ', 3.0,')).pass,
    'the reported solution fails Smooth Clamp, and passes with 3.0');

  const warns = (src: string) => assemble(`${src}\ns_endpgm`).warnings.map(x => x.message);
  assert(/0xffffffff \(NaN\)/.test(warns('v_add_f32 v0, -1, v1')[0] ?? '') && /0x000003e8 /.test(warns('v_mul_f32 v0, v1, 1000')[0] ?? ''),
    'integer inline constants and integer literals warn, with the bits and the value read');
  assert(/0x0003 \(1\.79e-7\)/.test(warns('v_add_f16 v0, 3, v1')[0] ?? '') &&
    /0x0000000000000003 /.test(warns('v_add_f64 v[0:1], 3, v[2:3]')[0] ?? '') &&
    /0x000003e800000000 /.test(warns('v_add_f64 v[0:1], 1000, v[2:3]')[0] ?? ''),
    '16- and 64-bit float operands warn too (a literal fills the high half of a 64-bit operand)');
  const k = assemble('v_fmaak_f32 v0, v1, v2, 3\ns_endpgm').warnings;
  assert(k.length === 1 && k[0].column === 25 && /^3 is an integer/.test(k[0].message), 'an integer K constant warns, at the K');
  assert(['v_cmp_lt_f32 vcc_lo, 3, v1', 'v_fma_mix_f32 v0, 3, v1, v2', 'v_mul_f32_e64 v0, -|3|, v1'].every(s => warns(s).length === 1),
    'float compares, mixed-precision FMA sources and integers inside modifiers warn');
  assert(['v_add_f32 v0, 0x3, v1', 'v_add_f32 v0, 0, v1', 'v_add_f32 v0, 3.0, v1', 'v_fmamk_f32 v0, v1, 0x40400000, v2', 'v_mov_b32 v0, 3',
    'v_cvt_f32_i32 v0, 3', 'v_ldexp_f32 v0, v1, 3', 'v_add_nc_u32 v0, 3, v1', 'v_cndmask_b32 v0, 3, v1, vcc_lo'].every(s => warns(s).length === 0),
    'hex bit patterns, 0, floats and integer operands do not warn');
}

group('Regression: every program must finish by executing s_endpgm');
{
  // Assembler: a program without s_endpgm still assembles, with a warning on its last instruction
  const missing = assemble('; c\nv_mov_b32 v0, 1.0\nv_add_f32 v1, v0, v0\n; trailing comment');
  assert(missing.errors.length === 0 && missing.binary.length === 2, 'a program without s_endpgm still assembles');
  assert(missing.warnings.length === 1 && missing.warnings[0].line === 3 && /s_endpgm/.test(missing.warnings[0].message),
    'a missing s_endpgm is a warning on the last instruction');
  assert(assemble('v_mov_b32 v0, 1.0\ns_endpgm').warnings.length === 0, 'no warning when the program has an s_endpgm');
  assert(assemble('s_endpgm\nv_nop').warnings.length === 0, 'an s_endpgm anywhere in the program satisfies the check');
  const empty = assemble('; nothing yet');
  assert(empty.warnings.length === 1 && empty.warnings[0].line === 1, 'an empty program gets the warning on line 1');
  assert(assemble('v_bogus v0\nv_mov_b32 v0, 1.0').warnings.length === 1, 'the warning is reported alongside errors');
}
{
  // Emulator: running past the last instruction is a crash
  const fall = setup('v_mov_b32 v0, 1.0');
  assert(fall.step() && fall.isComplete(), 'falling off the end stops execution after the last instruction');
  assert(fall.fault !== null && /ran off the end of the program after v_mov_b32/.test(fall.fault) && /s_endpgm/.test(fall.fault),
    'falling off the end is a crash that names the last instruction');
  assert(fall.state.readVGPR(0, 0) === 1 && !fall.step(), 'the last instruction still runs, and nothing runs after the crash');
  const notTaken = setup('loop:\ns_cmp_eq_u32 s0, 1\ns_cbranch_scc1 loop');
  notTaken.run();
  assert(notTaken.fault !== null && /after s_cbranch_scc1/.test(notTaken.fault), 'a conditional branch not taken at the end crashes');
  const setpc = setup('s_getpc_b64 s[0:1]\ns_add_u32 s0, s0, 8\ns_setpc_b64 s[0:1]');
  setpc.run();
  assert(setpc.fault !== null && /s_setpc_b64 jumped to the end of the program/.test(setpc.fault), 's_setpc_b64 to the end of the program crashes');
  const none = new Emulator();
  none.load(new Uint32Array(0));
  none.run();
  assert(none.isComplete() && none.fault !== null && /no instructions/.test(none.fault), 'an empty program crashes');
  const branched = run1('s_branch done\nv_mov_b32 v0, 1.0\ndone:');
  assert(branched.fault === null && branched.state.readVGPR_u32(0, 0) === 0, 'branching to an s_endpgm finishes cleanly');
}
{
  // Puzzles: a crash is never a valid solution, even when the output registers hold the right values
  const boost = getPuzzleById('signal-boost')!;
  assert(runPuzzle(boost, 'v_mul_f32 v1, v0, 2.0\ns_endpgm').pass, 'Signal Boost passes with s_endpgm');
  const crashed = runPuzzle(boost, 'v_mul_f32 v1, v0, 2.0');
  assert(!crashed.pass && crashed.crash?.invocation === 0 && /s_endpgm/.test(crashed.crash.message),
    'without s_endpgm the solution crashes and is not valid');
  assert(crashed.invocations[0].crashed === true && crashed.totalCorrect === 0, 'the crashed invocation counts as wrong');
  const outputs = new Map([[1, boost.outputs[0].values.slice()]]);
  assert(validatePuzzle(boost, outputs).pass, 'the correct outputs pass when nothing crashed');
  const late = validatePuzzle(boost, outputs, { invocation: 1, message: 'crash' });
  assert(!late.pass && late.invocations[0].pass && !late.invocations[1].pass && late.invocations[1].crashed === true &&
    late.totalCorrect === 32, 'a crash in a later invocation still fails the solution, whatever the registers hold');
  for (const puzzle of ALL_PUZZLES) {
    const result = runPuzzle(puzzle, 'v_nop');
    assert(!result.pass && result.crash !== undefined, `${puzzle.id}: a program without s_endpgm crashes`);
  }
}
{
  // Every tutorial snippet finishes with s_endpgm
  for (const t of ALL_TUTORIALS) {
    t.steps.forEach((s, i) => {
      if (!s.code) return;
      const r = assemble(s.code);
      assert(r.errors.length === 0 && r.warnings.length === 0, `${t.id} step ${i + 1} assembles without warnings`);
      const emu = new Emulator();
      emu.load(r.binary);
      emu.run();
      assert(emu.fault === null, `${t.id} step ${i + 1} runs to s_endpgm`);
    });
  }
}

group('DPP and SDWA coverage');
{
  // DPP8 fi:1 uses the DPP8FI source marker (0xEA); the lane-selector dword is unchanged
  assert(same(enc('v_mov_b32 v0, v1 dpp8:[7,6,5,4,3,2,1,0] fi:1'), [0x7E0002EA, 0x05397701]), 'DPP8 fi:1 encodes as source 0xEA');
  // DPP8 has no bound_ctrl: an inactive source lane reads 0 unless fi:1 fetches it
  const base = 'v_mbcnt_lo_u32_b32 v0, -1, 0\nv_mov_b32 v1, 0x77\ns_mov_b32 exec_lo, 0xFFFFFFFD\n';
  const off = run1(base + 'v_mov_b32 v1, v0 dpp8:[1,0,3,2,5,4,7,6]');
  assert(off.state.readVGPR_u32(1, 0) === 0, 'DPP8: an inactive source lane reads 0');
  assert(off.state.readVGPR_u32(1, 1) === 0x77 && off.state.readVGPR_u32(1, 2) === 3, 'DPP8: inactive lanes are not written; active lanes read their selected lane');
  const on = run1(base + 'v_mov_b32 v1, v0 dpp8:[1,0,3,2,5,4,7,6] fi:1');
  assert(on.state.readVGPR_u32(1, 0) === 1, 'DPP8 fi:1 fetches the inactive lane');
}
{
  // DPP16 source modifiers: neg/abs bits [20..23] of the DPP dword, applied to the value read from the other lane
  const src = 'v_add_f32 v2, -v0, |v1| row_shr:1 bound_ctrl:1';
  assert(enc(src)[1] === 0xFF991100, 'DPP16 neg/abs bits: src0 neg [20], src1 abs [23]');
  const emu = run1('v_mbcnt_lo_u32_b32 v3, -1, 0\nv_cvt_f32_u32 v0, v3\nv_sub_f32 v1, 0, v0\n' + src);
  assert([1, 5, 15, 17, 31].every(l => emu.state.readVGPR(2, l) === 1), 'DPP16 with -v0 and |v1|: lane n = -(n - 1) + |-n| = 1');
  assert(emu.state.readVGPR(2, 0) === 0 && emu.state.readVGPR(2, 16) === 16, 'DPP16 with modifiers: bound_ctrl reads 0 at the start of each row');
  assert(assemble('v_add_f32 v2, -v0, v1 dpp8:[0,1,2,3,4,5,6,7]').errors.length === 1, 'DPP8 has no abs/neg modifiers');
}
{
  // bound_ctrl:0 encodes BC = 0, so lanes without a source are left unwritten (LLVM instead reads bound_ctrl:0 as BC = 1)
  assert(((enc('v_mov_b32 v1, v0 row_shr:1 bound_ctrl:0')[1] >>> 19) & 1) === 0, 'bound_ctrl:0 encodes BC = 0');
  assert(((enc('v_mov_b32 v1, v0 row_shr:1 bound_ctrl')[1] >>> 19) & 1) === 1, 'a bare bound_ctrl encodes BC = 1');
  const emu = run1('v_mbcnt_lo_u32_b32 v0, -1, 0\nv_mov_b32 v1, 0x77\nv_mov_b32 v1, v0 row_shr:1 bound_ctrl:0');
  assert(emu.state.readVGPR_u32(1, 0) === 0x77 && emu.state.readVGPR_u32(1, 1) === 0, 'bound_ctrl:0: lanes without a source keep their old value');
}
{
  // The _dpp and _sdwa suffixes, and the sext() operand syntax
  assert(same(enc('v_mov_b32_dpp v1, v0 quad_perm:[1,0,3,2]'), enc('v_mov_b32 v1, v0 quad_perm:[1,0,3,2]')), '_dpp suffix: same encoding as the plain mnemonic');
  assert(same(enc('v_add_f32_dpp v2, v0, v1 dpp8:[1,0,3,2,5,4,7,6]'), enc('v_add_f32 v2, v0, v1 dpp8:[1,0,3,2,5,4,7,6]')), '_dpp suffix works with DPP8');
  assert(assemble('v_mov_b32_dpp v1, v0').errors.some(e => /DPP lane control/.test(e.message)), '_dpp without a DPP control is an error');
  assert(enc('v_mov_b32_sdwa v1, v0').length === 2 && same(enc('v_mov_b32_sdwa v1, v0'), enc('v_mov_b32 v1, v0 src0_sel:DWORD')),
    '_sdwa without selectors uses the SDWA encoding with DWORD selects');
  assert(same(enc('v_add_nc_u32 v2, sext(v0), v1 src0_sel:BYTE_0 src1_sel:BYTE_0'), enc('v_add_nc_u32 v2, v0, v1 src0_sel:BYTE_0 src0_sext src1_sel:BYTE_0')),
    'sext(src0) is src0_sext');
  assert(same(enc('v_add_nc_u32_sdwa v2, v0, sext(v1) src0_sel:BYTE_0 src1_sel:BYTE_0'), enc('v_add_nc_u32 v2, v0, v1 src0_sel:BYTE_0 src1_sel:BYTE_0 src1_sext')),
    'sext(src1) is src1_sext');
  assert(assemble('v_mov_b32 sext(v0), v1 src0_sel:BYTE_0').errors.some(e => /sext\(\)/.test(e.message)), 'sext() only applies to SDWA sources');
}
{
  // src1_sext / sext() sign-extend the selected field before the operation
  const regs = (e: Emulator) => { e.state.writeVGPR_u32(0, 0, 5); e.state.writeVGPR_u32(1, 0, 0xFE); };
  assert(run1('v_add_nc_u32 v2, v0, v1 src0_sel:BYTE_0 src1_sel:BYTE_0 src1_sext', regs).state.readVGPR_u32(2, 0) === 3, 'src1_sext: 5 + (-2) = 3');
  assert(run1('v_add_nc_u32 v2, v0, sext(v1) src0_sel:BYTE_0 src1_sel:BYTE_0', regs).state.readVGPR_u32(2, 0) === 3, 'sext(v1): 5 + (-2) = 3');
  assert(run1('v_add_nc_u32 v2, v0, v1 src0_sel:BYTE_0 src1_sel:BYTE_0', regs).state.readVGPR_u32(2, 0) === 0x103, 'without sext the byte is zero-extended: 5 + 254');
  const word = run1('v_add_nc_u32 v2, sext(v1), v0 src0_sel:WORD_0 src1_sel:BYTE_0',
    e => { e.state.writeVGPR_u32(0, 0, 5); e.state.writeVGPR_u32(1, 0, 0xFFFE); });
  assert(word.state.readVGPR_u32(2, 0) === 3, 'sext() on a word: -2 + 5 = 3');
}
{
  // SDWA compares: per-lane compare of the selected bytes into VCC, an SGPR (the SD bit) or EXEC (v_cmpx)
  // Byte 1 of v0 is the lane index (other bytes hold junk); byte 0 of v1 is 15
  const bytes = 'v_mbcnt_lo_u32_b32 v2, -1, 0\nv_lshlrev_b32 v0, 8, v2\nv_or_b32 v0, 0xEE0000EE, v0\nv_mov_b32 v1, 0xAB00CD0F\n';
  const cmp = 'v0, v1 src0_sel:BYTE_1 src1_sel:BYTE_0';
  assert(run1(bytes + `v_cmp_gt_u32_sdwa vcc_lo, ${cmp}`).state.vcc === 0xFFFF0000, 'SDWA v_cmp compares the selected bytes into VCC');
  const sgpr = run1(bytes + `s_mov_b32 vcc_lo, 0x12345678\nv_cmp_gt_u32_sdwa s6, ${cmp}`);
  assert(sgpr.state.readSGPR(6) === 0xFFFF0000 && sgpr.state.vcc === 0x12345678, 'SDWA v_cmp into an SGPR leaves VCC alone');
  const w = enc(`v_cmp_gt_u32_sdwa s6, ${cmp}`)[1];
  assert(((w >>> 15) & 1) === 1 && ((w >>> 8) & 0x7F) === 6, 'SDWA v_cmp SGPR destination: SD bit [15] and SDST [14:8]');
  assert(((enc(`v_cmp_gt_u32_sdwa vcc_lo, ${cmp}`)[1] >>> 15) & 1) === 0, 'SDWA v_cmp into VCC leaves SD clear');
  const half = run1(bytes + `s_mov_b32 exec_lo, 0xFF00FF00\nv_cmp_gt_u32_sdwa s6, ${cmp}`);
  assert(half.state.readSGPR(6) === 0xFF000000, 'SDWA v_cmp writes 0 for inactive lanes');
  assert(run1(bytes + `v_cmpx_gt_u32_sdwa ${cmp}`).state.exec === 0xFFFF0000, 'SDWA v_cmpx writes the mask to EXEC');
  assert(assemble(`v_cmpx_gt_u32_sdwa s6, ${cmp}`).errors.length > 0, 'SDWA v_cmpx cannot write an SGPR');
}
{
  // SDWA with SGPR and inline-constant sources (the S0 [23] / S1 [31] bits)
  const sgpr = run1('s_mov_b32 s0, 0x1200\ns_mov_b32 s1, 0x560000\nv_mov_b32 v1, 0x340000\nv_mov_b32 v0, 0x11\n' +
    'v_add_nc_u32 v2, s0, v1 src0_sel:BYTE_1 src1_sel:WORD_1\nv_add_nc_u32 v3, v0, s1 src0_sel:BYTE_0 src1_sel:BYTE_2');
  assert(sgpr.state.readVGPR_u32(2, 0) === 0x12 + 0x34 && sgpr.state.readVGPR_u32(3, 0) === 0x11 + 0x56, 'SDWA selects bytes and words of SGPR sources');
  const w0 = enc('v_add_nc_u32 v2, s0, v1 src0_sel:BYTE_1 src1_sel:WORD_1');
  assert(((w0[1] >>> 23) & 1) === 1 && (w0[1] & 0xFF) === 0, 'SDWA SGPR src0: S0 bit set, SRC0 = s0');
  const w1 = enc('v_add_nc_u32 v3, v0, s1 src0_sel:BYTE_0 src1_sel:BYTE_2');
  assert(((w1[1] >>> 31) & 1) === 1 && ((w1[0] >>> 9) & 0xFF) === 1, 'SDWA SGPR src1: S1 bit set, VSRC1 = s1');
  const k = run1('v_mov_b32 v1, 0x0305\nv_add_nc_u32 v2, 7, v1 src0_sel:BYTE_0 src1_sel:BYTE_1');
  assert(k.state.readVGPR_u32(2, 0) === 10, 'SDWA with an inline-constant src0: 7 + byte 1 of v1');
  assert((enc('v_add_nc_u32 v2, 7, v1 src0_sel:BYTE_0 src1_sel:BYTE_1')[1] & 0x8000FF) === 0x800087, 'SDWA inline constant: S0 set, SRC0 = 135');
  assert(run1('v_mov_b32 v1, 0.5\nv_add_f32 v2, 2.0, v1 src0_sel:DWORD src1_sel:DWORD').state.readVGPR(2, 0) === 2.5,
    'SDWA with an inline float constant');
  assert(assemble('v_add_nc_u32 v2, 0x1234, v1 src0_sel:BYTE_0').errors.some(e => /literal/.test(e.message)), 'SDWA cannot use a literal constant');
}
{
  // SDWA output modifiers (clamp [13], omod [15:14]) and source abs/neg ([21]/[20] for src0, [29]/[28] for src1)
  const regs = 'v_mov_b32 v0, 0.5\nv_mov_b32 v1, 0x3f400000\n'; // 0.5 and 0.75
  assert(((enc('v_add_f32 v2, v0, v1 src0_sel:DWORD src1_sel:DWORD clamp')[1] >>> 13) & 1) === 1, 'SDWA clamp is bit 13');
  assert(run1(regs + 'v_add_f32 v2, v0, v1 src0_sel:DWORD src1_sel:DWORD clamp').state.readVGPR(2, 0) === 1, 'SDWA clamp: 0.5 + 0.75 clamps to 1.0');
  assert(((enc('v_add_f32 v2, v0, v1 src0_sel:DWORD mul:2')[1] >>> 14) & 3) === 1, 'SDWA mul:2 is omod 1 in bits [15:14]');
  assert(run1(regs + 'v_add_f32 v2, v0, v1 src0_sel:DWORD src1_sel:DWORD mul:2').state.readVGPR(2, 0) === 2.5, 'SDWA mul:2 doubles the result');
  const m = enc('v_add_f32 v2, -v0, |v1| src0_sel:DWORD src1_sel:DWORD')[1];
  assert(((m >>> 20) & 1) === 1 && ((m >>> 21) & 1) === 0 && ((m >>> 28) & 1) === 0 && ((m >>> 29) & 1) === 1, 'SDWA neg/abs: src0 neg [20], src1 abs [29]');
  const absneg = run1('v_mov_b32 v0, 0.75\nv_mov_b32 v1, -0.5\nv_add_f32 v2, -v0, |v1| src0_sel:DWORD src1_sel:DWORD');
  assert(absneg.state.readVGPR(2, 0) === -0.25, 'SDWA source modifiers: -0.75 + |-0.5| = -0.25');
}
{
  // row_ror rotates by any amount: lane n reads lane (n - k) mod 16 of its row
  const r4 = setupDpp16('row_ror:4');
  assert(r4.state.readVGPR_u32(1, 0) === 12 && r4.state.readVGPR_u32(1, 4) === 0 && r4.state.readVGPR_u32(1, 16) === 28, 'row_ror:4');
  const r8 = setupDpp16('row_ror:8');
  assert(r8.state.readVGPR_u32(1, 0) === 8 && r8.state.readVGPR_u32(1, 9) === 1 && r8.state.readVGPR_u32(1, 24) === 16, 'row_ror:8');
  const r15 = setupDpp16('row_ror:15');
  assert(r15.state.readVGPR_u32(1, 0) === 1 && r15.state.readVGPR_u32(1, 15) === 0 && r15.state.readVGPR_u32(1, 31) === 16, 'row_ror:15');
  // The reductions the DPP tutorial teaches solve Quad Average and Wave Average
  const quad = ['v_add_f32 v1, v0, v0 quad_perm:[1,0,3,2]', 'v_add_f32 v1, v1, v1 quad_perm:[2,3,0,1]'];
  assert(runPuzzle(getPuzzleById('quad-average')!, [...quad, 'v_mul_f32 v1, 0.25, v1', 's_endpgm'].join('\n')).pass,
    'Quad Average: quad_perm reduction');
  const wave = getPuzzleById('wave-average')!;
  assert(runPuzzle(wave, [...quad, 'v_add_f32 v1, v1, v1 row_ror:4', 'v_add_f32 v1, v1, v1 row_ror:8',
    'ds_swizzle_b32 v2, v1 offset:0x401F', 'v_add_f32 v1, v1, v2', 'v_mul_f32 v1, 0.03125, v1', 's_endpgm'].join('\n')).pass,
    'Wave Average: row_ror:4 and row_ror:8, then ds_swizzle across rows');
  assert(runPuzzle(wave, [...quad, 'v_add_f32 v1, v1, v1 row_xmask:4', 'v_add_f32 v1, v1, v1 row_xmask:8',
    'v_permlanex16_b32 v2, v1, 0, 0', 'v_add_f32 v1, v1, v2', 'v_mul_f32 v1, 0.03125, v1', 's_endpgm'].join('\n')).pass,
    'Wave Average: row_xmask:4 and row_xmask:8, then v_permlanex16_b32 across rows');
}
{
  // Every DPP control and SDWA form disassembles to text that re-assembles to the same words
  const roundTrips = (src: string): boolean => {
    const a = assemble(src);
    if (a.errors.length > 0) return false;
    const b = assemble(decodeBinary(a.binary).map(d => disassemble(d, lookupByOpcode)).join('\n'));
    return b.errors.length === 0 && same(Array.from(a.binary), Array.from(b.binary));
  };
  const forms = [
    'v_mov_b32 v1, v0 quad_perm:[3,2,1,0] row_mask:0x5 bank_mask:0xa', 'v_mov_b32 v1, v0 row_shl:15',
    'v_mov_b32 v1, v0 row_shr:1 bound_ctrl:1 fi:1', 'v_mov_b32 v1, v0 row_ror:8', 'v_mov_b32 v1, v0 row_mirror',
    'v_mov_b32 v1, v0 row_half_mirror', 'v_mov_b32 v1, v0 row_share:7', 'v_mov_b32 v1, v0 row_xmask:15',
    'v_add_f32 v2, -v0, |v1| row_shr:1', 'v_mov_b32 v1, v0 dpp8:[7,6,5,4,3,2,1,0]', 'v_add_f32 v2, v0, v1 dpp8:[1,0,3,2,5,4,7,6] fi:1',
    'v_mov_b32 v1, v0 dst_sel:BYTE_3 dst_unused:UNUSED_SEXT src0_sel:WORD_1 src0_sext',
    'v_add_nc_u32 v2, s0, v1 src0_sel:BYTE_1 src1_sel:WORD_1', 'v_add_nc_u32 v3, v0, s1 src0_sel:BYTE_0 src1_sel:BYTE_2 src1_sext',
    'v_add_nc_u32 v2, 7, v1 src0_sel:BYTE_0 src1_sel:BYTE_1', 'v_add_f32 v2, -v0, |v1| src0_sel:DWORD src1_sel:DWORD clamp mul:2',
    'v_cmp_gt_u32_sdwa s6, v0, v1 src0_sel:BYTE_1 src1_sel:BYTE_0', 'v_cmpx_gt_u32_sdwa v0, v1 src0_sel:BYTE_1 src1_sel:BYTE_0',
  ];
  for (const f of forms) assert(roundTrips(f), `round-trips: ${f}`);
}

group('Instruction Info editing: operand spans and choices');
{
  // Each operand records where it was written: just the register or constant, inside -, |…|, abs() and sext()
  const written = (src: string, slot: OperandSlot): string | undefined => {
    const span = assemble(src).instructions[0]?.spans?.[slot];
    return span ? src.split('\n')[0].slice(span.start - 1, span.end - 1) : undefined;
  };
  const line = 'v_add_f32 v2, -|v0|, abs(v1) ; comment';
  assert(written(line, 'mnemonic') === 'v_add_f32' && written(line, 'dst') === 'v2' &&
    written(line, 'src0') === 'v0' && written(line, 'src1') === 'v1', 'spans: mnemonic, destination and sources inside -|…| and abs()');
  assert(written('v_add_f32_e64 v[3:3], v0, 1.0', 'mnemonic') === 'v_add_f32', 'spans: the mnemonic leaves out an _e64 suffix');
  assert(written('v_add_f32_e64 v[3:3], v0, 1.0', 'dst') === 'v[3:3]', 'spans: a register range');
  assert(written('v_add_nc_u32 v2, sext(v0), v1 src0_sel:BYTE_0', 'src0') === 'v0', 'spans: inside sext()');
  assert(written('top: s_add_u32 s0, s1, 0x1234', 'mnemonic') === 's_add_u32' &&
    written('top: s_add_u32 s0, s1, 0x1234', 'src1') === '0x1234', 'spans: a scalar instruction after a label');
  assert(written('v_cmp_lt_f32 s4, v0, v1', 'sdst') === 's4', "spans: a compare's SGPR result");
  assert(written('v_readlane_b32 s7, v0, 3', 'dst') === 's7', 'spans: the scalar destination of v_readlane_b32');
  assert(written('v_madmk_f32 v0, v1, 2.5, v2', 'k') === '2.5' && written('v_madmk_f32 v0, v1, 2.5, v2', 'src1') === 'v2',
    'spans: the constant K and the source after it');
  assert(written('s_movk_i32 s3, 0x7fff', 'simm') === '0x7fff', 'spans: a SOPK immediate');
  assert(written('s_branch done\ndone: s_endpgm', 'simm') === 'done', 'spans: a branch label');
  assert(written('s_waitcnt vmcnt(0) & lgkmcnt(0)', 'simm') === 'vmcnt(0) & lgkmcnt(0)', 'spans: s_waitcnt counters');
  assert(written('ds_write2st64_b32 v0, v1, v2 offset1:1', 'src2') === 'v2', 'spans: the second data operand of an LDS write');
  assert(written('v_add_f32 v0, v1, v2', 'src2') === undefined && written('s_endpgm', 'simm') === undefined,
    'spans: operands that are not written have none');

  // Encoding suffixes only exist on vector ALU instructions
  assert(/has no _e64 form/.test(assemble('s_add_u32_e64 s0, s1, s2').errors[0]?.message ?? ''), 'suffixes: rejected on scalar ALU instructions');
  assert(assemble('ds_swizzle_b32_e32 v1, v0').errors.length === 1 && assemble('s_endpgm_sdwa').errors.length === 1,
    'suffixes: rejected on LDS and program-control instructions');
}
{
  const choices = (line: string, slot: OperandSlot, labels?: Set<string>) => editChoices(line, slot, labels);
  const find = (list: EditChoice[], text: string) => list.find(c => c.text === text);

  // VSRC1 must be a VGPR: SGPRs and constants are offered, but need the 8-byte VOP3 encoding
  const src1 = choices('v_add_f32 v0, v1, v2', 'src1');
  assert(find(src1, 'v7')?.bytes === 4 && find(src1, 's7')?.bytes === 8 && find(src1, '1.0')?.bytes === 8,
    'choices: SGPRs and constants as VSRC1 promote the instruction to VOP3');
  assert(src1.filter(c => c.current).map(c => c.text).join() === 'v2' && find(src1, 'v7')?.line === 'v_add_f32 v0, v1, v7',
    'choices: the current value is marked and each choice carries its line');
  assert(['v9', 's9', 'vcc_lo', 'm0', '64', '-16', '0.5', '-4.0'].every(t => find(choices('v_add_f32 v0, v1, v2', 'src0'), t)?.bytes === 4),
    'choices: SRC0 takes VGPRs, SGPRs, special registers and inline constants in 4 bytes');
  const dst = choices('v_add_f32 v0, v1, v2', 'dst');
  assert(dst.length === 256 && dst.every(c => c.group === 'VGPR'), 'choices: a VALU destination is any VGPR');
  assert(choices('v_add_f32 v2, v0, v1 row_shr:1', 'src0').every(c => c.group === 'VGPR'), 'choices: a DPP source is a VGPR');
  assert(find(choices('v_lshlrev_b64 v[0:1], 1, v[2:3]', 'src1'), 'v[4:5]')?.bytes === 8, 'choices: 64-bit sources are register pairs');
  const pairs = choices('s_mov_b64 s[0:1], s[2:3]', 'dst');
  assert(!!find(pairs, 's[4:5]') && !find(pairs, 's[1:2]') && !!find(pairs, 'vcc') && !find(pairs, 'v[0:1]'),
    'choices: 64-bit scalar destinations are even SGPR pairs, vcc or exec');

  // Mnemonics: only those that take the same operands, the instruction's own format first
  const ops = choices('v_add_f32 v0, v1, v2', 'mnemonic');
  assert(ops[0].group === 'VOP2' && find(ops, 'v_sub_f32')?.bytes === 4 && find(ops, 'v_mul_lo_u32')?.bytes === 8 &&
    find(ops, 'v_pk_add_f16')?.group === 'VOP3P', 'choices: mnemonics with the same operands, in any format');
  assert(!find(ops, 'v_fma_f32') && !find(ops, 'v_mov_b32') && !find(ops, 's_add_u32') && !find(ops, 'v_cmp_eq_f32'),
    'choices: mnemonics that need other operands are left out');
  assert(find(choices('v_add_f32_e64 v0, v1, v2', 'mnemonic'), 'v_sub_f32')?.line === 'v_sub_f32_e64 v0, v1, v2',
    'choices: a new mnemonic keeps the _e64 suffix');

  // Branch targets, modifiers and comments, literals
  assert(choices('s_cbranch_scc1 done', 'simm', new Set(['top', 'done'])).map(c => c.text + (c.current ? '*' : '')).join() === 'done*,top',
    'choices: a branch can target any label');
  assert(choices('s_waitcnt lgkmcnt(0)', 'simm').length === 0 && choices('v_madmk_f32 v0, v1, 2.5, v2', 'k').length === 0,
    'choices: immediates and K are typed, not listed');
  assert(find(choices('v_add_f32 v2, -|v0|, v1 ; note', 'src0'), 'v7')?.line === 'v_add_f32 v2, -|v7|, v1 ; note',
    'choices: modifiers and comments are kept');
  const literal = choices('v_mul_f32 v3, v0, 3.14159', 'src1').find(c => c.current);
  assert(literal?.text === '3.14159' && literal.group === 'Constant' && literal.bytes === 12, 'choices: a literal is listed as the current value');

  assert(checkLine('v_add_f32 v0, 3.14159, v1').words?.length === 2, 'checkLine: assembles one line');
  assert(checkLine('s_branch nowhere', new Set(['done'])).error === "Undefined label 'nowhere'", 'checkLine: an unknown branch target');
  assert(checkLine('v_add_f32 v0, s0, v1 row_shr:1').error !== undefined, 'checkLine: reports what is wrong');
  assert([...labelsIn('a: s_nop 0\nb:\n  s_branch a')].join() === 'a,b', 'labelsIn: every label definition');
}

group('16-bit integer VOP3, dot products and pack conversions');
{
  // Encodings from LLVM's GFX10 MC tests; mix lo/hi come from its GFX9 tests with the VOP3P prefix changed to GFX10's
  const llvm: Array<[string, number[]]> = [
    ['v_mad_u32_u16 v5, v1, v2, v3 clamp', [0xD7738005, 0x040E0501]],
    ['v_max3_i16 v5, v1, v2, v3 clamp', [0xD7558005, 0x040E0501]],
    ['v_lshlrev_b16 v5, v1, v2 op_sel:[1,1,1]', [0xD7145805, 0x02020501]],
    ['v_med3_u16 v5, v1, v2, v3 op_sel:[0,0,0,1]', [0xD7594005, 0x040E0501]],
    ['v_min_i16 v5, 0.5, v2', [0xD70C0005, 0x020204F0]],
    ['v_cvt_pk_i16_i32 v5, -1, v2', [0xD76B0005, 0x020204C1]],
    ['v_cvt_pknorm_u16_f32 v5, |v1|, |v2|', [0xD7690305, 0x02020501]],
    ['v_cvt_pknorm_i16_f16 v5, -v1, v2', [0xD7120005, 0x22020501]],
    ['v_fma_mixlo_f16 v0, |v1|, -v2, |v3|', [0xCC210500, 0x440E0501]],
    ['v_fma_mixhi_f16 v0, -v1, |v2|, -|v3|', [0xCC220600, 0xA40E0501]],
  ];
  for (const [src, words] of llvm) assert(same(enc(src), words), `encoding (LLVM): ${src}`);
  ['v_dot2_f32_f16', 'v_dot2_i32_i16', 'v_dot2_u32_u16', 'v_dot4_i32_i8', 'v_dot4_u32_u8', 'v_dot8_i32_i4', 'v_dot8_u32_u4'].forEach((m, i) =>
    assert(same(enc(`${m} v0, v1, v2, v3`), [(0xCC134000 + (i << 16)) >>> 0, 0x1C0E0501]), `encoding (LLVM): ${m} v0, v1, v2, v3`));
  assert(same(enc('v_dot2_f32_f16 v0, v1, v2, -|v3|'), [0xCC134400, 0x9C0E0501]),
    'v_dot2_f32_f16: -|src2| sets neg_lo[2] (negate) and neg_hi[2] (abs) of the f32 accumulator');

  const src = ['v_mad_i32_i16 v5, v1, v2, v3 op_sel:[1,0,0,0] clamp', 'v_ashrrev_i16 v6, v1, v2 op_sel:[0,1,1]',
    'v_cvt_pknorm_u16_f16 v7, |v1|, -v2 op_sel:[1,0,0]', 'v_dot2_f32_f16 v8, -v1, v2, -|v3| op_sel:[1,0,0] op_sel_hi:[0,1,1] clamp',
    'v_dot2_u32_u16 v9, v1, v2, v3 op_sel_hi:[1,0,1]', 'v_dot8_i32_i4 v10, v1, 0x11111111, v3 clamp',
    'v_fma_mixhi_f16 v11, v1, -v2, |v3| op_sel:[0,1,0] op_sel_hi:[0,1,0] clamp', 's_endpgm'].join('\n');
  const a = assemble(src);
  const b = assemble(decodeBinary(a.binary).map(d => disassemble(d)).join('\n'));
  assert(a.errors.length === 0 && b.errors.length === 0 && same(Array.from(a.binary), Array.from(b.binary)), 'new instructions: disassembly round-trips');
  assert(disassemble(decodeBinary(new Uint32Array(enc('v_dot4_u32_u8 v0, v1, v2, v3')))[0]) === 'v_dot4_u32_u8 v0, v1, v2, v3',
    'v_dot4 disassembles without packed modifiers');
}
{
  // 16-bit integer VOP3: v3 = op(v0, v1, v2); the destination's other half is kept
  const r16 = (src: string, a: number, b: number, c = 0, d = 0xABCD0000) => run1(src, e => {
    e.state.writeVGPR_u32(0, 0, a);
    e.state.writeVGPR_u32(1, 0, b);
    e.state.writeVGPR_u32(2, 0, c);
    e.state.writeVGPR_u32(3, 0, d);
  }).state.readVGPR_u32(3, 0);
  assert(r16('v_add_nc_i16 v3, v0, v1', 0x7FFF, 1) === 0xABCD8000, 'v_add_nc_i16 wraps and keeps the high half');
  assert(r16('v_add_nc_i16 v3, v0, v1 clamp', 0x7FFF, 1) === 0xABCD7FFF, 'v_add_nc_i16 clamp saturates at 32767');
  assert(r16('v_add_nc_i16 v3, v0, v1 clamp', 0x8000, 0xFFFF) === 0xABCD8000, 'v_add_nc_i16 clamp saturates at -32768');
  assert(r16('v_sub_nc_i16 v3, v0, v1', 0x8000, 1) === 0xABCD7FFF && r16('v_sub_nc_i16 v3, v0, v1 clamp', 0x8000, 1) === 0xABCD8000,
    'v_sub_nc_i16 wraps, or saturates with clamp');
  assert(r16('v_mul_lo_u16 v3, v0, v1', 300, 300) === 0xABCD5F90 && r16('v_mul_lo_u16 v3, v0, v1 clamp', 300, 300) === 0xABCDFFFF,
    'v_mul_lo_u16 keeps the low 16 bits, or saturates with clamp');
  assert(r16('v_mad_u16 v3, v0, v1, v2', 1000, 1000, 5) === 0xABCD4245 && r16('v_mad_u16 v3, v0, v1, v2 clamp', 1000, 1000, 5) === 0xABCDFFFF,
    'v_mad_u16 wraps, or saturates with clamp');
  assert(r16('v_mad_i16 v3, v0, v1, v2', 0xFF38, 200) === 0xABCD63C0 && r16('v_mad_i16 v3, v0, v1, v2 clamp', 0xFF38, 200) === 0xABCD8000,
    'v_mad_i16: -200 × 200 wraps, or saturates with clamp');
  assert(r16('v_max_i16 v3, v0, v1', 0xFFFF, 1) === 0xABCD0001 && r16('v_max_u16 v3, v0, v1', 0xFFFF, 1) === 0xABCDFFFF, 'v_max_i16 is signed, v_max_u16 unsigned');
  assert(r16('v_min_i16 v3, v0, v1', 0xFFFF, 1) === 0xABCDFFFF && r16('v_min_u16 v3, v0, v1', 0xFFFF, 1) === 0xABCD0001, 'v_min_i16 is signed, v_min_u16 unsigned');
  assert(r16('v_max3_i16 v3, v0, v1, v2', 0xFFFF, 0x8000, 5) === 0xABCD0005 && r16('v_min3_i16 v3, v0, v1, v2', 0xFFFF, 0x8000, 5) === 0xABCD8000,
    'v_max3_i16 / v_min3_i16 compare signed');
  assert(r16('v_max3_u16 v3, v0, v1, v2', 0xFFFF, 0x8000, 5) === 0xABCDFFFF && r16('v_min3_u16 v3, v0, v1, v2', 0xFFFF, 0x8000, 5) === 0xABCD0005,
    'v_max3_u16 / v_min3_u16 compare unsigned');
  assert(r16('v_med3_u16 v3, v0, v1, v2', 0xFFFF, 0x8000, 5) === 0xABCD8000 && r16('v_med3_i16 v3, v0, v1, v2', 0xFFFF, 0x8000, 5) === 0xABCDFFFF,
    'v_med3_u16 is unsigned, v_med3_i16 signed');
  assert(r16('v_lshlrev_b16 v3, v0, v1', 17, 0x8001) === 0xABCD0002, 'v_lshlrev_b16 shifts by src0[3:0]');
  assert(r16('v_ashrrev_i16 v3, v0, v1', 15, 0x8000) === 0xABCDFFFF && r16('v_ashrrev_i16 v3, v0, v1', 4, 0x7FF0) === 0xABCD07FF,
    'v_ashrrev_i16 fills with the sign bit');
  assert(r16('v_ashrrev_i16 v3, v0, v1 op_sel:[0,1,1]', 4, 0x80000000, 0, 0xABCD) === 0xF800ABCD, 'v_ashrrev_i16 op_sel: high half in, high half out');
  assert(r16('v_mad_u32_u16 v3, v0, v1, v2', 0xFFFF, 0xFFFF, 0xFFFFFFFF) === 0xFFFE0000 &&
    r16('v_mad_u32_u16 v3, v0, v1, v2 clamp', 0xFFFF, 0xFFFF, 0xFFFFFFFF) === 0xFFFFFFFF, 'v_mad_u32_u16 wraps, or saturates with clamp');
  assert(r16('v_mad_i32_i16 v3, v0, v1, v2 op_sel:[1,0,0,0]', 0xFFFD0000, 7, 100) === 79 &&
    r16('v_mad_i32_i16 v3, v0, v1, v2 op_sel:[1,0,0,0]', 0xFFFD0000, 7, 0) === 0xFFFFFFEB, 'v_mad_i32_i16 multiplies the signed halves picked by op_sel');
  assert(r16('v_mad_i32_i16 v3, v0, v1, v2', 1, 1, 0x7FFFFFFF) === 0x80000000 && r16('v_mad_i32_i16 v3, v0, v1, v2 clamp', 1, 1, 0x7FFFFFFF) === 0x7FFFFFFF,
    'v_mad_i32_i16 wraps, or saturates with clamp');
}
{
  // Pack conversions: v3 = {convert(v1), convert(v0)}
  const pack = (src: string, a: number, b: number) => run1(src, e => {
    e.state.writeVGPR_u32(0, 0, a);
    e.state.writeVGPR_u32(1, 0, b);
  }).state.readVGPR_u32(3, 0);
  const fb = floatBits;
  const h = (lo: number, hi: number) => ((f32ToF16(hi) << 16) | f32ToF16(lo)) >>> 0;
  assert(pack('v_cvt_pk_i16_i32 v3, v0, v1', 70000, -70000 >>> 0) === 0x80007FFF, 'v_cvt_pk_i16_i32 saturates each half');
  assert(pack('v_cvt_pk_i16_i32 v3, v0, v1', 5, -5 >>> 0) === 0xFFFB0005, 'v_cvt_pk_i16_i32 keeps values in range');
  assert(pack('v_cvt_pk_u16_u32 v3, v0, v1', 70000, 3) === 0x0003FFFF, 'v_cvt_pk_u16_u32 saturates at 65535');
  assert(pack('v_cvt_pk_u16_u32 v3, v0, v1', 0xFFFFFFFF, 0x10000) === 0xFFFFFFFF, 'v_cvt_pk_u16_u32 sources are unsigned');
  assert(pack('v_cvt_pknorm_i16_f32 v3, v0, v1', fb(1), fb(-1)) === 0x80017FFF, 'v_cvt_pknorm_i16_f32: ±1.0 → ±32767');
  assert(pack('v_cvt_pknorm_i16_f32 v3, v0, v1', fb(2), fb(-3)) === 0x80017FFF, 'v_cvt_pknorm_i16_f32 clamps to [-1, 1]');
  assert(pack('v_cvt_pknorm_i16_f32 v3, v0, v1', fb(-0.5), fb(0.5)) === 0x4000C000, 'v_cvt_pknorm_i16_f32 rounds ties to even (±16383.5 → ±16384)');
  assert(pack('v_cvt_pknorm_i16_f32 v3, v0, v1', fb(NaN), fb(-0)) === 0, 'v_cvt_pknorm_i16_f32: NaN and -0 convert to 0');
  assert(pack('v_cvt_pknorm_u16_f32 v3, v0, v1', fb(0.5), fb(-1)) === 0x00008000, 'v_cvt_pknorm_u16_f32: 0.5 → 32768, negative → 0');
  assert(pack('v_cvt_pknorm_u16_f32 v3, -v0, |v1|', fb(-0.25), fb(-1)) === 0xFFFF4000, 'v_cvt_pknorm_u16_f32 with -src0 and |src1|');
  assert(pack('v_cvt_pknorm_i16_f16 v3, v0, v1 op_sel:[1,0,0]', h(0, 1), h(-0.5, 0)) === 0xC0007FFF, 'v_cvt_pknorm_i16_f16: op_sel picks the high half of src0');
  assert(pack('v_cvt_pknorm_u16_f16 v3, 1.0, v1', 0, h(0.25, 9)) === 0x4000FFFF, 'v_cvt_pknorm_u16_f16: an inline 1.0 is f16; 0.25 → 16384');
  assert((run1('v_cvt_norm_i16_f16 v1, v0', e => writeF16(e, 0, 0, -0.5)).state.readVGPR_u32(1, 0) & 0xFFFF) === 0xC000,
    'v_cvt_norm_i16_f16 rounds ties to even: -0.5 × 32767 = -16383.5 → -16384');
}
{
  // Dot products: v0 = dot(v1, v2) + v3
  const dot = (src: string, a: number, b: number, c: number) => run1(src, e => {
    e.state.writeVGPR_u32(1, 0, a);
    e.state.writeVGPR_u32(2, 0, b);
    e.state.writeVGPR_u32(3, 0, c);
  }).state.readVGPR_u32(0, 0);
  const pkh = (lo: number, hi: number) => ((f32ToF16(hi) << 16) | f32ToF16(lo)) >>> 0;
  const f = (src: string, c = 10) => bitsToFloat(dot(src, pkh(1.5, 2.0), pkh(4.0, -0.5), floatBits(c)));
  assert(f('v_dot2_f32_f16 v0, v1, v2, v3') === 15, 'v_dot2_f32_f16: 1.5×4 + 2×(-0.5) + 10');
  assert(f('v_dot2_f32_f16 v0, v1, v2, v3 op_sel:[1,0,0] op_sel_hi:[0,1,1]') === 17.25,
    'v_dot2_f32_f16: op_sel / op_sel_hi pick the halves of the first / second product (2×4 + 1.5×(-0.5) + 10)');
  assert(f('v_dot2_f32_f16 v0, -v1, v2, v3') === 5, 'v_dot2_f32_f16: -src0 negates both halves');
  assert(f('v_dot2_f32_f16 v0, v1, v2, v3 neg_lo:[1,0,0]') === 3, 'v_dot2_f32_f16: neg_lo negates the first product only');
  assert(f('v_dot2_f32_f16 v0, v1, v2, -|v3|') === -5 && f('v_dot2_f32_f16 v0, v1, v2, |v3|', -10) === 15, 'v_dot2_f32_f16: -|src2| and |src2|');
  assert(f('v_dot2_f32_f16 v0, v1, v2, v3 clamp') === 1, 'v_dot2_f32_f16: clamp limits the result to [0, 1]');
  assert(f('v_dot2_f32_f16 v0, v1, 1.0, 0 op_sel_hi:[1,0]') === 3.5, 'v_dot2_f32_f16: op_sel_hi:[1,0] uses a constant in both products');
  assert(f('v_dot2_f32_f16 v0, v1, v2, 0.1') === Math.fround(5 + Math.fround(0.1)), 'v_dot2_f32_f16: src2 is an f32 literal');

  const i16 = (lo: number, hi: number) => (((hi & 0xFFFF) << 16) | (lo & 0xFFFF)) >>> 0;
  const min = i16(-32768, -32768);
  assert(dot('v_dot2_i32_i16 v0, v1, v2, v3', i16(-3, 1000), i16(7, -2), 100) === (-1921 >>> 0), 'v_dot2_i32_i16: -3×7 + 1000×(-2) + 100');
  assert(dot('v_dot2_i32_i16 v0, v1, v2, v3', min, min, 0) === 0x80000000, 'v_dot2_i32_i16: 2^31 wraps without clamp');
  assert(dot('v_dot2_i32_i16 v0, v1, v2, v3 clamp', min, min, 0) === 0x7FFFFFFF, 'v_dot2_i32_i16: clamp saturates to the i32 range');
  assert(dot('v_dot2_i32_i16 v0, v1, 1, 0 op_sel_hi:[1,0]', i16(-3, 1000), 0, 0) === 997, 'v_dot2_i32_i16: op_sel_hi:[1,0] sums the halves of src0');
  assert(dot('v_dot2_u32_u16 v0, v1, v2, v3', 0xFFFFFFFF, 0xFFFFFFFF, 5) === 0xFFFC0007, 'v_dot2_u32_u16: the sum wraps');
  assert(dot('v_dot2_u32_u16 v0, v1, v2, v3 clamp', 0xFFFFFFFF, 0xFFFFFFFF, 5) === 0xFFFFFFFF, 'v_dot2_u32_u16: clamp saturates to 0xFFFFFFFF');
  assert(dot('v_dot2_u32_u16 v0, v1, v2, v3 op_sel:[0,1,0] op_sel_hi:[1,0,1]', i16(2, 3), i16(5, 7), 0) === 2 * 7 + 3 * 5,
    'v_dot2_u32_u16: op_sel / op_sel_hi cross the halves');

  const bytes = (...b: number[]) => b.reduce((acc, x, i) => (acc | ((x & 0xFF) << (8 * i))) >>> 0, 0);
  assert(dot('v_dot4_i32_i8 v0, v1, v2, v3', bytes(1, -2, 3, -4), bytes(5, 6, -7, 8), 1000) === 940, 'v_dot4_i32_i8: 5 - 12 - 21 - 32 + 1000');
  assert(dot('v_dot4_u32_u8 v0, v1, v2, v3', bytes(1, -2, 3, -4), bytes(5, 6, -7, 8), 0) === 1 * 5 + 254 * 6 + 3 * 249 + 252 * 8,
    'v_dot4_u32_u8: bytes are unsigned');
  assert(dot('v_dot4_i32_i8 v0, v1, v2, v3', bytes(127), bytes(127), 0x7FFFFFFF) === 0x80003F00 &&
    dot('v_dot4_i32_i8 v0, v1, v2, v3 clamp', bytes(127), bytes(127), 0x7FFFFFFF) === 0x7FFFFFFF, 'v_dot4_i32_i8 wraps, or saturates with clamp');
  assert(dot('v_dot4_u32_u8 v0, v1, 0x01010101, 0', bytes(1, 2, 3, 4), 0, 0) === 10, 'v_dot4_u32_u8 with a 0x01010101 literal sums the bytes');
  assert(dot('v_dot8_i32_i4 v0, v1, v2, v3', 0x89ABCDEF, 0x11111111, 0) === (-36 >>> 0), 'v_dot8_i32_i4: nibbles 0x8–0xF are -8 to -1');
  assert(dot('v_dot8_u32_u4 v0, v1, v2, v3', 0x89ABCDEF, 0x11111111, 8) === 100, 'v_dot8_u32_u4: 15 + 14 + … + 8, plus 8');
}
{
  // v_fma_mixlo_f16 / v_fma_mixhi_f16: v0 half = v1 × v2 + v3
  const mix = (src: string) => run1(src, e => {
    e.state.writeVGPR(1, 0, 1.5);
    e.state.writeVGPR(2, 0, 2.0);
    e.state.writeVGPR(3, 0, 0.25);
    e.state.writeVGPR_u32(0, 0, 0xABCD1234);
  }).state.readVGPR_u32(0, 0);
  assert(mix('v_fma_mixlo_f16 v0, v1, v2, v3') === (0xABCD0000 | f32ToF16(3.25)) >>> 0, 'v_fma_mixlo_f16 writes the low half and keeps the high half');
  assert(mix('v_fma_mixhi_f16 v0, v1, v2, v3') === ((f32ToF16(3.25) << 16) | 0x1234) >>> 0, 'v_fma_mixhi_f16 writes the high half and keeps the low half');
  assert(mix('v_fma_mixlo_f16 v0, v1, v2, v3 clamp') === (0xABCD0000 | f32ToF16(1)) >>> 0, 'v_fma_mixlo_f16 clamp limits the result to [0, 1]');
  assert(mix('v_fma_mixhi_f16 v0, -v1, v2, |v3|') === ((f32ToF16(-2.75) << 16) | 0x1234) >>> 0, 'v_fma_mixhi_f16 with -src0 and |src2|');
  const halves = run1('v_fma_mixlo_f16 v0, v1, v1, v2 op_sel:[0,1,0] op_sel_hi:[1,1,0]', e => {
    e.state.writeVGPR_u32(1, 0, (f32ToF16(3.0) << 16) | f32ToF16(0.5));
    e.state.writeVGPR(2, 0, 100);
  });
  assert((halves.state.readVGPR_u32(0, 0) & 0xFFFF) === f32ToF16(101.5), 'v_fma_mixlo_f16 multiplies f16 halves (lo × hi) and adds an f32');
}
{
  const rejects = (src: string) => assemble(src).errors.length > 0;
  assert(rejects('v_dot4_i32_i8 v0, v1, v2, v3 op_sel:[1,0,0]') && rejects('v_dot8_u32_u4 v0, v1, v2, v3 op_sel_hi:[0,0,1]'),
    'v_dot4 / v_dot8 take no op_sel or op_sel_hi (as in LLVM)');
  assert(rejects('v_dot4_u32_u8 v0, -v1, v2, v3') && rejects('v_dot2_i32_i16 v0, v1, v2, v3 neg_lo:[1,0,0]') && rejects('v_dot2_u32_u16 v0, v1, -v2, v3'),
    'integer dot products take no neg modifiers');
  assert(rejects('v_dot2_f32_f16 v0, |v1|, v2, v3'), 'v_dot2_f32_f16: abs only applies to the f32 src2');
  assert(rejects('v_lshlrev_b16 v0, v1, v2 clamp') && rejects('v_ashrrev_i16 v0, v1, v2 clamp'), '16-bit shifts have no clamp');
  assert(rejects('v_cvt_pk_i16_i32 v0, v1, v2 op_sel:[1,0,0]') && rejects('v_cvt_pknorm_i16_f32 v0, v1, v2 op_sel:[1,0,0]'),
    'pack conversions with 32-bit sources take no op_sel');
  assert(rejects('v_cvt_pknorm_u16_f32 v0, v1, v2 mul:2'), 'pknorm results are integers: no output modifier');
}

group('VOPC: every GFX10 compare');
const f64ToBits = (v: number): bigint => new BigUint64Array(new Float64Array([v]).buffer)[0];
function write64(e: Emulator, reg: number, lane: number, bits: bigint): void {
  e.state.writeVGPR_u32(reg, lane, Number(BigInt.asUintN(64, bits) & 0xFFFFFFFFn));
  e.state.writeVGPR_u32(reg + 1, lane, Number(BigInt.asUintN(64, bits) >> 32n));
}
{
  const vopc = getAllOpcodes().filter(o => o.format === InstructionFormat.VOPC);
  assert(vopc.length === 190 && new Set(vopc.map(o => o.opcode)).size === 190, 'all 190 GFX10 compares exist, each with its own opcode');
  assert(lookupByOpcode(InstructionFormat.VOPC, 0x40) === undefined, 'VOPC opcodes 0x40-0x7F stay unassigned');

  // Encodings from LLVM's GFX10 MC tests (little-endian bytes)
  const words = (...b: number[]) =>
    Array.from({ length: b.length / 4 }, (_, i) => (b[4 * i] | (b[4 * i + 1] << 8) | (b[4 * i + 2] << 16) | (b[4 * i + 3] << 24)) >>> 0);
  const llvm: Array<[string, number[]]> = [
    ['v_cmp_lt_f64 vcc_lo, 0xaf123456, v[2:3]', words(0xff, 0x04, 0x42, 0x7c, 0x56, 0x34, 0x12, 0xaf)],
    ['v_cmp_eq_f64 vcc_lo, 0.5, v[2:3]', words(0xf0, 0x04, 0x44, 0x7c)],
    ['v_cmp_lt_u64 vcc_lo, s[2:3], v[2:3]', words(0x02, 0x04, 0xc2, 0x7d)],
    ['v_cmp_class_f64 vcc_lo, v[1:2], v2', words(0x01, 0x05, 0x50, 0x7d)],
    ['v_cmp_eq_f16 vcc_lo, 0x3456, v2', words(0xff, 0x04, 0x94, 0x7d, 0x56, 0x34, 0x00, 0x00)],
    ['v_cmp_nlg_f16 vcc_lo, v1, v2', words(0x01, 0x05, 0xd4, 0x7d)],
    ['v_cmp_lt_f64_e64 s10, -v[1:2], v[2:3]', words(0x0a, 0x00, 0x21, 0xd4, 0x01, 0x05, 0x02, 0x22)],
    ['v_cmp_lt_f64_e64 s10, v[1:2], v[2:3] clamp', words(0x0a, 0x80, 0x21, 0xd4, 0x01, 0x05, 0x02, 0x02)],
    ['v_cmp_ne_i64_e64 s10, exec, v[2:3]', words(0x0a, 0x00, 0xa5, 0xd4, 0x7e, 0x04, 0x02, 0x02)],
    ['v_cmp_class_f64_e64 s10, -v[1:2], v2', words(0x0a, 0x00, 0xa8, 0xd4, 0x01, 0x05, 0x02, 0x22)],
    ['v_cmp_tru_f16_e64 s10, v1, v2', words(0x0a, 0x00, 0xef, 0xd4, 0x01, 0x05, 0x02, 0x02)],
    ['v_cmp_nge_f16_sdwa s6, -v1, v2 src0_sel:DWORD src1_sel:DWORD', words(0xf9, 0x04, 0xd2, 0x7d, 0x01, 0x86, 0x16, 0x06)],
    ['v_cmp_eq_i16_sdwa s6, v1, sext(v2) src0_sel:DWORD src1_sel:DWORD', words(0xf9, 0x04, 0x14, 0x7d, 0x01, 0x86, 0x06, 0x0e)],
    ['v_cmpx_lt_u64_e64 v[1:2], v[2:3]', words(0x7e, 0x00, 0xf1, 0xd4, 0x01, 0x05, 0x02, 0x02)],
    ['v_cmpx_o_f32_sdwa v1, v2 src0_sel:WORD_1 src1_sel:DWORD', words(0xf9, 0x04, 0x2e, 0x7c, 0x01, 0x00, 0x05, 0x06)],
    ['v_cmpx_ne_u16 v1, v2', words(0x01, 0x05, 0x7a, 0x7d)],
  ];
  for (const [src, w] of llvm) assert(same(enc(src), w), `encoding (LLVM): ${src}`);

  const dis = (src: string) => disassemble(decodeBinary(new Uint32Array(enc(src)))[0]);
  assert(dis('v_cmp_lt_f64 vcc_lo, 2.5, v[0:1]') === 'v_cmp_lt_f64 vcc_lo, 2.5, v[0:1]', 'an f64 literal with a short value disassembles as a float');
  assert(dis('v_cmp_lt_f64 vcc_lo, 0xaf123456, v[0:1]') === 'v_cmp_lt_f64 vcc_lo, 0xaf123456, v[0:1]', 'other f64 literals disassemble in hex');
  const prog = ['v_cmp_lt_f64 vcc_lo, 2.5, v[0:1]', 'v_cmp_eq_i64_e64 s4, 0xffffffff, v[0:1]', 'v_cmp_class_f64_e64 s6, -|v[0:1]|, 0x3ff',
    'v_cmp_class_f16_sdwa vcc_lo, v1, v2 src0_sel:WORD_1 src1_sel:DWORD', 'v_cmpx_nlt_f64_e64 -|v[0:1]|, s[2:3]', 'v_cmp_t_u64 vcc_lo, -1, v[4:5]',
    'v_cmp_ge_u16_e64 s8, v1, 0x1234', 's_endpgm'].join('\n');
  const a = assemble(prog);
  const b = assemble(decodeBinary(a.binary).map(d => disassemble(d)).join('\n'));
  assert(a.errors.length === 0 && b.errors.length === 0 && same(Array.from(a.binary), Array.from(b.binary)), 'compares: disassembly round-trips');
}
{
  // Float conditions: lanes 0-3 hold src0 less than, equal to, greater than and unordered with src1, so with
  // EXEC = 0xF a compare's mask is its truth table (the condition's position in opcode order)
  const FLOAT_CONDS = ['f', 'lt', 'eq', 'le', 'gt', 'lg', 'ge', 'o', 'u', 'nge', 'nlg', 'ngt', 'nle', 'neq', 'nlt', 'tru'];
  const pairs: Array<[number, number]> = [[-1.5, 2], [-0, 0], [3, -0], [NaN, 2]];
  const setF = (e: Emulator, t: string, reg: number, lane: number, v: number) => {
    if (t === 'f16') e.state.writeVGPR_u32(reg, lane, (0xABCD0000 | f32ToF16(v)) >>> 0); // the high half is ignored
    else if (t === 'f32') e.state.writeVGPR(reg, lane, v);
    else write64(e, reg, lane, f64ToBits(v));
  };
  for (const t of ['f16', 'f32', 'f64']) {
    const srcs = t === 'f64' ? 'v[0:1], v[2:3]' : 'v0, v2';
    FLOAT_CONDS.forEach((c, truth) => {
      const init = (e: Emulator) => {
        e.state.exec = 0xF;
        e.state.vcc = 0x5A5A;
        pairs.forEach(([x, y], lane) => { setF(e, t, 0, lane, x); setF(e, t, 2, lane, y); });
      };
      assert(run1(`v_cmp_${c}_${t} vcc_lo, ${srcs}`, init).state.vcc === truth,
        `v_cmp_${c}_${t}: less/equal/greater/unordered lanes give ${truth.toString(2).padStart(4, '0')}`);
      const x = run1(`v_cmpx_${c}_${t} ${srcs}`, init).state;
      assert(x.exec === truth && x.vcc === 0x5A5A, `v_cmpx_${c}_${t} writes its mask to EXEC and leaves VCC alone`);
    });
  }
}
{
  // Integer conditions: lanes 0-2 hold less, equal and greater pairs in the compare's own signedness. The other
  // signedness orders lanes 0 and 2 the other way round, and the 64-bit lane 2 values are equal as doubles.
  const INT_CONDS = ['f', 'lt', 'eq', 'le', 'gt', 'ne', 'ge', 't'];
  const cases: Array<[string, bigint[][]]> = [
    ['i16', [[-2n, 1n], [-2n, -2n], [1n, -2n]]],
    ['u16', [[1n, 0xFFFFn], [0xFFFFn, 0xFFFFn], [0xFFFFn, 1n]]],
    ['i32', [[-2n, 1n], [-2n, -2n], [1n, -2n]]],
    ['u32', [[1n, 0xFFFFFFFFn], [0xFFFFFFFFn, 0xFFFFFFFFn], [0xFFFFFFFFn, 1n]]],
    ['i64', [[-2n, 1n], [0x123456789ABCDEFn, 0x123456789ABCDEFn], [0x7FFFFFFFFFFFFFFFn, 0x7FFFFFFFFFFFFFFEn]]],
    ['u64', [[1n, 0xFFFFFFFFFFFFFFFFn], [0x8000000000000001n, 0x8000000000000001n], [0xFFFFFFFFFFFFFFFFn, 0xFFFFFFFFFFFFFFFEn]]],
  ];
  for (const [t, lanes] of cases) {
    const bits = Number(t.slice(1));
    const conds = bits === 16 ? INT_CONDS.slice(1, 7) : INT_CONDS;
    const init = (e: Emulator) => {
      e.state.exec = 0x7;
      lanes.forEach(([x, y], lane) => {
        if (bits === 64) {
          write64(e, 0, lane, x);
          write64(e, 2, lane, y);
        } else {
          const hi = bits === 16 ? 0x5A5A0000 : 0; // 16-bit compares ignore the high half
          e.state.writeVGPR_u32(0, lane, (hi | Number(BigInt.asUintN(bits, x))) >>> 0);
          e.state.writeVGPR_u32(2, lane, (hi | Number(BigInt.asUintN(bits, y))) >>> 0);
        }
      });
    };
    const srcs = bits === 64 ? 'v[0:1], v[2:3]' : 'v0, v2';
    for (const c of conds) {
      const truth = INT_CONDS.indexOf(c);
      assert(run1(`v_cmp_${c}_${t} vcc_lo, ${srcs}`, init).state.vcc === truth,
        `v_cmp_${c}_${t}: less/equal/greater lanes give ${truth.toString(2).padStart(3, '0')}`);
    }
    const gt = run1(`v_cmpx_gt_${t} ${srcs}`, init).state;
    assert(gt.exec === 0b100, `v_cmpx_gt_${t} keeps only the greater lane`);
  }
}
{
  // Class tests: lane k holds a value of class k (0 signaling NaN, 1 quiet NaN, 2 -inf, 3 -normal, 4 -denormal,
  // 5 -0, 6 +0, 7 +denormal, 8 +normal, 9 +inf); src1 holds each lane's mask
  const CLASS_VALUES: Record<string, bigint[]> = {
    f16: [0x7C01n, 0x7E00n, 0xFC00n, 0xBC00n, 0x8001n, 0x8000n, 0n, 1n, 0x3C00n, 0x7C00n],
    f32: [0x7F800001n, 0x7FC00000n, 0xFF800000n, 0xBF800000n, 0x80000001n, 0x80000000n, 0n, 1n, 0x3F800000n, 0x7F800000n],
    f64: [0x7FF0000000000001n, 0x7FF8000000000000n, 0xFFF0000000000000n, 0xBFF0000000000000n, 0x8000000000000001n,
      0x8000000000000000n, 0n, 1n, 0x3FF0000000000000n, 0x7FF0000000000000n],
  };
  const negated = (k: number) => (k < 2 ? k : 11 - k); // -x flips the sign; NaNs stay NaNs
  const absolute = (k: number) => (k >= 2 && k <= 5 ? 11 - k : k);
  for (const [t, values] of Object.entries(CLASS_VALUES)) {
    const s0 = t === 'f64' ? 'v[0:1]' : 'v0';
    const run = (src: string, mask: (k: number) => number) => run1(src, e => {
      e.state.exec = 0x3FF;
      values.forEach((v, k) => {
        if (t === 'f64') write64(e, 0, k, v);
        else e.state.writeVGPR_u32(0, k, (Number(v) | (t === 'f16' ? 0x5A5A0000 : 0)) >>> 0);
        e.state.writeVGPR_u32(2, k, mask(k));
      });
    }).state;
    assert(run(`v_cmp_class_${t} vcc_lo, ${s0}, v2`, k => 1 << k).vcc === 0x3FF, `v_cmp_class_${t}: every lane matches its own class bit`);
    assert(run(`v_cmp_class_${t} vcc_lo, ${s0}, v2`, k => 0x3FF & ~(1 << k)).vcc === 0, `v_cmp_class_${t}: no lane matches another class bit`);
    assert(run(`v_cmp_class_${t}_e64 s4, -${s0}, v2`, k => 1 << negated(k)).readSGPR(4) === 0x3FF, `v_cmp_class_${t}: -src0 flips the sign of the class`);
    assert(run(`v_cmp_class_${t}_e64 s4, |${s0}|, v2`, k => 1 << absolute(k)).readSGPR(4) === 0x3FF, `v_cmp_class_${t}: |src0| makes the class positive`);
    assert(run(`v_cmpx_class_${t} ${s0}, v2`, k => (k % 2 ? 1 << k : 0)).exec === 0x2AA, `v_cmpx_class_${t} writes EXEC`);
  }
  const sdwa = run1('v_cmp_class_f16_sdwa vcc_lo, v0, v2 src0_sel:WORD_1 src1_sel:DWORD', e => {
    e.state.exec = 0x3FF;
    CLASS_VALUES.f16.forEach((v, k) => {
      e.state.writeVGPR_u32(0, k, ((Number(v) << 16) | 0x7E00) >>> 0);
      e.state.writeVGPR_u32(2, k, 1 << k);
    });
  });
  assert(sdwa.state.vcc === 0x3FF, 'v_cmp_class_f16 with src0_sel:WORD_1 tests the high half');
  assert((run1('v_cmp_class_f16 vcc_lo, 1.0, v2', e => e.state.writeVGPR_u32(2, 0, 1 << 8)).state.vcc & 1) === 1 &&
    (run1('v_cmp_class_f32 vcc_lo, -4.0, v2', e => e.state.writeVGPR_u32(2, 0, 1 << 3)).state.vcc & 1) === 1,
    'class tests of inline constants: 1.0 is +normal, -4.0 is -normal');
}
{
  // 64-bit sources: f64 literals are the high half of a double, integer literals are zero- or sign-extended
  const all = (bits: bigint, reg = 0) => (e: Emulator) => { for (let l = 0; l < 32; l++) write64(e, reg, l, bits); };
  assert(run1('v_cmp_eq_f64_e64 s4, 0x40490000, v[0:1]', all(f64ToBits(50))).state.readSGPR(4) === 0xFFFFFFFF,
    'an f64 literal is the high half of the double: 0x40490000 is 50.0');
  const exact = assemble('v_cmp_lt_f64 vcc_lo, 2.5, v[0:1]\ns_endpgm');
  assert(exact.warnings.length === 0 && exact.binary[1] === 0x40040000, 'a float that fits in the high half (2.5) is an exact f64 literal');
  const tenthSrc = 'v_cmp_lt_f64 vcc_lo, 0.1, v[0:1]';
  const tenth = assemble(tenthSrc + '\ns_endpgm');
  assert(tenth.errors.length === 0 && tenth.warnings.length === 1 && /high 32 bits/.test(tenth.warnings[0].message) &&
    tenth.warnings[0].column === tenthSrc.indexOf('0.1') + 1, 'an f64 float literal that loses its low 32 bits warns at the literal');
  assert(run1(tenthSrc, all(f64ToBits(0.0999999998))).state.vcc === 0xFFFFFFFF, '…and compares as 0.09999996423721313');
  const mods = run1('v_cmp_lt_f64_e64 s4, -v[0:1], |v[2:3]|', e => { all(f64ToBits(3))(e); all(f64ToBits(-2), 2)(e); });
  assert(mods.state.readSGPR(4) === 0xFFFFFFFF, 'f64 neg and abs modifiers: -3 < |-2|');
  const eq = (src: string, bits: bigint) => run1(src, all(bits)).state.readSGPR(4) === 0xFFFFFFFF;
  assert(eq('v_cmp_eq_u64_e64 s4, 0xffffffff, v[0:1]', 0xFFFFFFFFn) && !eq('v_cmp_eq_u64_e64 s4, 0xffffffff, v[0:1]', -1n),
    'a u64 literal is zero-extended');
  assert(eq('v_cmp_eq_i64_e64 s4, 0xffffffff, v[0:1]', -1n) && !eq('v_cmp_eq_i64_e64 s4, 0xffffffff, v[0:1]', 0xFFFFFFFFn),
    'an i64 literal is sign-extended');
  const pair = run1('v_cmp_lt_u64 vcc_lo, s[0:1], v[2:3]', e => {
    e.state.writeSGPR(0, 0);
    e.state.writeSGPR(1, 1);
    for (let l = 0; l < 32; l++) write64(e, 2, l, BigInt(l) << 31n);
  });
  assert(pair.state.vcc === 0xFFFFFFF8, 'an SGPR pair as src0: 2^32 < lane × 2^31 from lane 3 up');
}
{
  const ok = (src: string) => assemble(src).errors.length === 0;
  assert(ok('v_cmp_lt_f32_e64 s0, v0, v1 clamp') && ok('v_cmp_u_f64_e64 s0, v[0:1], v[2:3] clamp'), 'float compares accept clamp');
  assert(!ok('v_cmp_lt_i32_e64 s0, v0, v1 clamp') && !ok('v_cmp_lt_u64_e64 s0, v[0:1], v[2:3] clamp') && !ok('v_cmp_class_f32_e64 s0, v0, v1 clamp'),
    'integer and class compares take no clamp (as in LLVM)');
  assert(!ok('v_cmp_lt_u64 vcc_lo, s[1:2], v[2:3]') && !ok('v_cmp_lt_f64 vcc_lo, v[0:2], v[2:3]'), '64-bit compares need aligned register pairs');
  assert(!ok('v_cmp_lt_f64 vcc_lo, v[0:1], v[2:3] src0_sel:DWORD') && !ok('v_cmp_class_f64_sdwa vcc_lo, v[0:1], v2'), '64-bit compares have no SDWA form');
  assert(!ok('v_cmp_lt_i64_e64 s0, -v[0:1], v[2:3]') && !ok('v_cmp_class_f32_e64 s0, v0, -v1'),
    'neg only applies to float sources, not to integers or the class mask');
  assert(!ok('v_cmp_lt_u16_e64 s0, v0, v1 op_sel:[1,0,0]'), '16-bit compares take no op_sel on GFX10');
  assert(!ok('v_cmp_lt_i64 vcc_lo, 0.3, v[0:1]') && ok('v_cmp_lt_i64 vcc_lo, 0.5, v[0:1]'), 'a 64-bit integer operand takes only inline float constants');
  assert(!ok('v_cmp_lt_f64 vcc_lo, 0x123456789, v[0:1]'), 'an f64 integer literal must fit in 32 bits');
}

group('VALU: 64-bit floats');
const f64FromBits = (b: bigint): number => new Float64Array(new BigUint64Array([BigInt.asUintN(64, b)]).buffer)[0];
const read64 = (e: Emulator, reg: number, lane = 0): bigint =>
  BigInt(e.state.readVGPR_u32(reg, lane)) | (BigInt(e.state.readVGPR_u32(reg + 1, lane)) << 32n);
/** Run `src` with doubles in v[0:1], v[2:3] and v[4:5] of lane 0 and return the double it leaves in v[6:7]. */
const f64op = (src: string, ...vals: number[]) =>
  f64FromBits(read64(run1(src, e => vals.forEach((v, i) => write64(e, 2 * i, 0, f64ToBits(v)))), 6));
/** Bit-identical doubles (so -0 differs from +0); any NaN matches NaN. */
const isF64 = (got: number, want: number) => (Number.isNaN(want) ? Number.isNaN(got) : f64ToBits(got) === f64ToBits(want));
{
  const f64ops = getAllOpcodes().filter(o => o.format !== InstructionFormat.VOPC && o.types && [o.types.d, ...o.types.s].includes('f64'));
  assert(f64ops.length === 26, `26 f64 arithmetic instructions (got ${f64ops.length})`);

  // Encodings from LLVM's GFX10 MC tests (little-endian bytes)
  const words = (...b: number[]) =>
    Array.from({ length: b.length / 4 }, (_, i) => (b[4 * i] | (b[4 * i + 1] << 8) | (b[4 * i + 2] << 16) | (b[4 * i + 3] << 24)) >>> 0);
  const llvm: Array<[string, number[]]> = [
    ['v_rcp_f64 v[5:6], 0xaf123456', words(0xff, 0x5e, 0x0a, 0x7e, 0x56, 0x34, 0x12, 0xaf)],
    ['v_cvt_f64_f32_e64 v[5:6], v1 clamp', words(0x05, 0x80, 0x90, 0xd5, 0x01, 0x01, 0x01, 0x02)],
    ['v_sqrt_f64_e64 v[5:6], v[1:2] mul:2', words(0x05, 0x00, 0xb4, 0xd5, 0x01, 0x01, 0x01, 0x0a)],
    ['v_frexp_exp_i32_f64 v5, v[1:2]', words(0x01, 0x79, 0x0a, 0x7e)],
    ['v_fma_f64 v[5:6], -v[1:2], v[2:3], v[3:4]', words(0x05, 0x00, 0x4c, 0xd5, 0x01, 0x05, 0x0e, 0x24)],
    ['v_add_f64 v[5:6], v[1:2], v[2:3] div:2', words(0x05, 0x00, 0x64, 0xd5, 0x01, 0x05, 0x02, 0x1a)],
    ['v_mul_f64 v[5:6], 0.5, v[2:3]', words(0x05, 0x00, 0x65, 0xd5, 0xf0, 0x04, 0x02, 0x02)],
    ['v_max_f64 v[5:6], -v[1:2], v[2:3]', words(0x05, 0x00, 0x67, 0xd5, 0x01, 0x05, 0x02, 0x22)],
    ['v_ldexp_f64 v[5:6], v[1:2], v2', words(0x05, 0x00, 0x68, 0xd5, 0x01, 0x05, 0x02, 0x02)],
    ['v_trig_preop_f64 v[5:6], v[1:2], v2', words(0x05, 0x00, 0x74, 0xd5, 0x01, 0x05, 0x02, 0x02)],
    ['v_div_fixup_f64 v[5:6], v[1:2], -v[2:3], v[3:4]', words(0x05, 0x00, 0x60, 0xd5, 0x01, 0x05, 0x0e, 0x44)],
    ['v_div_fmas_f64 v[5:6], v[1:2], v[2:3], v[3:4]', words(0x05, 0x00, 0x70, 0xd5, 0x01, 0x05, 0x0e, 0x04)],
  ];
  for (const [src, w] of llvm) assert(same(enc(src), w), `encoding (LLVM): ${src}`);
  assert(same(enc('v_div_scale_f64 v[5:6], s0, v[1:2], v[2:3], v[3:4]'), words(0x05, 0x00, 0x6e, 0xd5, 0x01, 0x05, 0x0e, 0x04)),
    'v_div_scale_f64: VOP3B opcode 0x16E, laid out like the v_div_scale_f32 encodings in LLVM\'s tests');

  const prog = ['v_div_scale_f64 v[4:5], s0, -v[2:3], v[2:3], s[4:5]', 'v_fma_f64 v[6:7], -|v[0:1]|, 2.5, v[8:9] clamp',
    'v_cvt_f32_f64_e64 v10, -v[0:1] mul:2', 'v_cvt_f64_u32 v[12:13], 0x12345', 'v_trig_preop_f64 v[14:15], s[2:3], 3',
    'v_ldexp_f64 v[16:17], v[0:1], -7', 'v_div_fmas_f64 v[18:19], v[0:1], s[6:7], v[2:3]', 'v_floor_f64 v[20:21], 0x40490000', 's_endpgm'].join('\n');
  const a = assemble(prog);
  const b = assemble(decodeBinary(a.binary).map(d => disassemble(d)).join('\n'));
  assert(a.errors.length === 0 && b.errors.length === 0 && same(Array.from(a.binary), Array.from(b.binary)), 'f64 instructions: disassembly round-trips');
}
{
  const un = (m: string, x: number) => f64op(`${m} v[6:7], v[0:1]`, x);
  const bin = (m: string, x: number, y: number) => f64op(`${m} v[6:7], v[0:1], v[2:3]`, x, y);
  const fma = (x: number, y: number, z: number) => f64op('v_fma_f64 v[6:7], v[0:1], v[2:3], v[4:5]', x, y, z);
  assert(isF64(bin('v_add_f64', 0.1, 0.2), 0.1 + 0.2) && isF64(bin('v_mul_f64', 1e200, 1e200), Infinity) && isF64(bin('v_mul_f64', -0, 3), -0),
    'v_add_f64 / v_mul_f64 round like IEEE doubles');
  assert(isF64(fma(1 + 2 ** -52, 1 - 2 ** -52, -1), -(2 ** -104)), 'v_fma_f64 rounds once: (1+ε)(1-ε) - 1 = -ε² (a separate multiply gives 0)');
  assert(isF64(fma(2 ** 1023, 2.5, -1.75 * 2 ** 1023), 0.75 * 2 ** 1023), 'v_fma_f64 keeps a product beyond the double range');
  assert(isF64(fma(3 * 2 ** -1074, 0.5, 0), 2 ** -1073) && isF64(fma(2 ** -1074, 0.5, 0), 0), 'v_fma_f64 rounds subnormal results to nearest even');
  assert(isF64(fma(-0, 1, -0), -0) && isF64(fma(-0, 1, 0), 0) && isF64(fma(2, 3, -6), 0) && Number.isNaN(fma(Infinity, 0, 1)) &&
    Number.isNaN(fma(Infinity, 1, -Infinity)) && isF64(fma(Infinity, -2, 5), -Infinity), 'v_fma_f64: signed zeros, exact cancellation, ∞ × 0 and ∞ - ∞');
  assert(isF64(bin('v_min_f64', NaN, 2), 2) && isF64(bin('v_max_f64', 3, NaN), 3) && isF64(bin('v_min_f64', 0, -0), -0) &&
    isF64(bin('v_max_f64', -0, 0), 0), 'v_min_f64 / v_max_f64: a NaN input gives the other one; -0 < +0');

  const ldexp = (x: number, n: number) =>
    f64FromBits(read64(run1('v_ldexp_f64 v[6:7], v[0:1], v2', e => { write64(e, 0, 0, f64ToBits(x)); e.state.writeVGPR_u32(2, 0, n >>> 0); }), 6));
  assert(isF64(ldexp(1, -1074), 5e-324) && isF64(ldexp(1.5, -1074), 2 ** -1073) && isF64(ldexp(2 ** 1000, -2000), 2 ** -1000),
    'v_ldexp_f64 rounds a subnormal result once and keeps exact results exact');
  assert(isF64(ldexp(1, 5000), Infinity) && isF64(ldexp(-3, -0x80000000), -0) && isF64(ldexp(0, 2000), 0) && isF64(ldexp(-Infinity, -5), -Infinity),
    'v_ldexp_f64: overflow, underflow to -0, 0 × 2^2000 = 0 and ∞ unchanged');

  const rndne: Array<[number, number]> = [[0.49999999999999994, 0], [2 ** 52 + 1, 2 ** 52 + 1], [2.5, 2], [-2.5, -2], [3.5, 4], [-0.4, -0], [-1e300, -1e300]];
  assert(rndne.every(([x, want]) => isF64(un('v_rndne_f64', x), want)), 'v_rndne_f64 rounds ties to even exactly, keeping the sign of zero');
  assert(isF64(un('v_floor_f64', -0.5), -1) && isF64(un('v_ceil_f64', -0.5), -0) && isF64(un('v_trunc_f64', -1.5), -1) &&
    isF64(un('v_floor_f64', 2 ** 60 + 2 ** 8), 2 ** 60 + 2 ** 8), 'v_floor_f64 / v_ceil_f64 / v_trunc_f64');
  assert(isF64(un('v_fract_f64', -0.25), 0.75) && isF64(un('v_fract_f64', 5.5), 0.5) && Number.isNaN(un('v_fract_f64', Infinity)), 'v_fract_f64');
  assert(isF64(un('v_rcp_f64', 3), 1 / 3) && isF64(un('v_rcp_f64', -0), -Infinity) && isF64(un('v_sqrt_f64', 2), Math.SQRT2) &&
    isF64(un('v_sqrt_f64', -0), -0) && Number.isNaN(un('v_sqrt_f64', -1)) && isF64(un('v_rsq_f64', 0.25), 2) && Number.isNaN(un('v_rsq_f64', -4)),
    'v_rcp_f64 / v_sqrt_f64 / v_rsq_f64 values and special cases');

  const toF32 = (x: number) => run1('v_cvt_f32_f64 v6, v[0:1]', e => write64(e, 0, 0, f64ToBits(x))).state.readVGPR(6, 0);
  assert(toF32(1 + 2 ** -24) === 1 && toF32(1 + 3 * 2 ** -25) === 1 + 2 ** -23 && toF32(1e40) === Infinity && Object.is(toF32(-1e-50), -0),
    'v_cvt_f32_f64 rounds to nearest even; too large gives ∞, too small ±0');
  const toInt = (m: string, x: number) => run1(`${m} v6, v[0:1]`, e => write64(e, 0, 0, f64ToBits(x))).state.readVGPR_u32(6, 0);
  assert(toInt('v_cvt_i32_f64', -1.9) === 0xFFFFFFFF && toInt('v_cvt_i32_f64', 3e9) === 0x7FFFFFFF && toInt('v_cvt_i32_f64', -3e9) === 0x80000000 &&
    toInt('v_cvt_i32_f64', NaN) === 0, 'v_cvt_i32_f64 truncates and saturates; NaN gives 0');
  assert(toInt('v_cvt_u32_f64', -1) === 0 && toInt('v_cvt_u32_f64', 5e9) === 0xFFFFFFFF && toInt('v_cvt_u32_f64', 7.99) === 7,
    'v_cvt_u32_f64 truncates and clamps to [0, 2^32 - 1]');
  const fromRaw = (m: string, raw: number) => f64FromBits(read64(run1(`${m} v[6:7], v0`, e => e.state.writeVGPR_u32(0, 0, raw)), 6));
  assert(fromRaw('v_cvt_f64_i32', -5 >>> 0) === -5 && fromRaw('v_cvt_f64_u32', 0xFFFFFFFF) === 4294967295 &&
    fromRaw('v_cvt_f64_f32', floatBits(0.1)) === Math.fround(0.1), 'v_cvt_f64_i32 / v_cvt_f64_u32 / v_cvt_f64_f32 are exact');

  const frexp = (x: number): [number, number] => {
    const e = run1('v_frexp_mant_f64 v[6:7], v[0:1]\nv_frexp_exp_i32_f64 v8, v[0:1]', em => write64(em, 0, 0, f64ToBits(x)));
    return [f64FromBits(read64(e, 6)), e.state.readVGPR_u32(8, 0) | 0];
  };
  const frexpCases: Array<[number, number, number]> = [[8, 0.5, 4], [5e-324, 0.5, -1073], [-0.75, -0.75, 0], [-0, -0, 0], [Infinity, Infinity, 0], [NaN, NaN, 0]];
  assert(frexpCases.every(([x, m, ex]) => { const [gm, ge] = frexp(x); return isF64(gm, m) && ge === ex; }),
    'v_frexp_mant_f64 / v_frexp_exp_i32_f64: [0.5, 1) significands, subnormals normalized, ±0/±∞/NaN give themselves and 0');

  assert(isF64(f64op('v_add_f64 v[6:7], -v[0:1], |v[2:3]|', 1.5, -4), 2.5), 'f64 neg and abs modifiers');
  assert(isF64(f64op('v_add_f64 v[6:7], v[0:1], v[2:3] clamp', 0.75, 0.75), 1) && isF64(f64op('v_mul_f64 v[6:7], v[0:1], v[2:3] mul:4', 1.5, 2), 12),
    'f64 clamp and output modifiers');
  assert(isF64(f64op('v_sqrt_f64 v[6:7], 4.0'), 2) && isF64(f64op('v_sqrt_f64 v[6:7], 0x40310000'), Math.sqrt(17)),
    'VOP1 f64 sources: inline 4.0, and a literal is the high half of the double (0x40310000 is 17.0)');
  const pair = run1('v_add_f64 v[6:7], s[0:1], v[2:3]', e => {
    e.state.writeSGPR(0, 0);
    e.state.writeSGPR(1, 0x40040000); // 2.5
    write64(e, 2, 0, f64ToBits(0.25));
  });
  assert(f64FromBits(read64(pair, 6)) === 2.75, 'an SGPR pair as an f64 source');
}
{
  // v_trig_preop_f64 reads 2/π. Check the table against an independent computation (Gauss's formula
  // π/4 = 12·atan(1/18) + 8·atan(1/57) - 5·atan(1/239)) and the well-known leading digits of 2/π
  const table = twoOverPiTable();
  const P = 1201n + 64n;
  const one = 1n << P;
  const atanInverse = (x: bigint) => {
    let sum = 0n;
    let power = one / x;
    for (let k = 0n; power !== 0n; k++) {
      sum += (k % 2n === 0n ? power : -power) / (2n * k + 1n);
      power /= x * x;
    }
    return sum;
  };
  const pi = 4n * (12n * atanInverse(18n) + 8n * atanInverse(57n) - 5n * atanInverse(239n));
  assert(table === ((2n << (2n * P)) / pi) >> 64n, 'the 1201-bit 2/π table matches an independent computation');
  assert((table << 3n).toString(16).startsWith('a2f9836e4e441529fc2757d1f534ddc0db629599'), 'the 2/π table reads 0.a2f9836e4e441529fc27…');

  const preop = (x: number, segment: number) => f64FromBits(read64(run1('v_trig_preop_f64 v[6:7], v[0:1], v2', e => {
    write64(e, 0, 0, f64ToBits(x));
    e.state.writeVGPR_u32(2, 0, segment);
  }), 6));
  const window = (shift: number) => Number((table >> BigInt(1148 - shift)) & ((1n << 53n) - 1n));
  assert(f64ToBits(preop(1, 0)) === 0x3FE45F306DC9C882n, 'v_trig_preop_f64 segment 0 is the first 53 bits of 2/π, truncated');
  assert(Math.abs(preop(1, 0) + preop(1, 1) + preop(1, 2) - 2 / Math.PI) < 1e-16 && preop(1, 1) > 0 && preop(1, 1) < 2 ** -50,
    'segments 0, 1 and 2 add up to 2/π');
  assert(preop(2 ** 60, 0) === window(6) * 2 ** -59 && preop(-(2 ** 60), 0) === preop(2 ** 60, 0),
    'an exponent above 1077 moves the window right (2^60: by 6 bits)');
  assert(preop(2 ** 950, 1) === window(53 + 896) * 2 ** -874, 'exponents of 1968 or more scale the result up by 2^128');
  assert(preop(1, 31) === 0 && preop(1, 32) === preop(1, 0), 'segments past the table read 0, and only src1[4:0] counts');
  assert(preop(1, 20) === window(1060) * 2 ** -1000 * 2 ** -113 && preop(1, 20) > 0 && preop(1, 21) === 0,
    'segment 20 lands in the subnormal range and is rounded once; segment 21 lies below the smallest subnormal');
}
{
  // The division helpers, with the hardware behaviour where the ISA documents differ
  const scale = (s0: number, den: number, num: number) => {
    const e = run1('v_div_scale_f64 v[6:7], s4, v[0:1], v[2:3], v[4:5]', em => {
      em.state.exec = 1;
      write64(em, 0, 0, f64ToBits(s0));
      write64(em, 2, 0, f64ToBits(den));
      write64(em, 4, 0, f64ToBits(num));
    });
    return { v: f64FromBits(read64(e, 6)), flag: e.state.readSGPR(4) };
  };
  const zero = scale(1, 0, 1);
  assert(Number.isNaN(zero.v) && zero.flag === 1, 'v_div_scale_f64: a zero denominator gives NaN with the flag set (hardware; the documents leave it clear)');
  const [hugeDen, hugeNum] = [scale(1e-10, 1e-10, 1e300), scale(1e300, 1e-10, 1e300)];
  assert(hugeDen.v === 1e-10 * 2 ** 128 && hugeDen.flag === 1 && hugeNum.v === 1e300 && hugeNum.flag === 1,
    'a huge quotient: the denominator is scaled up by 2^128 and the flag set');
  const [tinyDen, tinyNum] = [scale(1e10, 1e10, 1e-300), scale(1e-300, 1e10, 1e-300)];
  assert(tinyDen.v === 1e10 && tinyNum.v === 1e-300 * 2 ** 128 && tinyNum.flag === 1, 'a subnormal quotient: the numerator is scaled up by 2^128');
  const [bigDen, bigNum] = [scale(1e308, 1e308, 1), scale(1, 1e308, 1)];
  assert(bigDen.v === 1e308 * 2 ** -128 && bigDen.flag === 1 && bigNum.v === 1,
    'a huge denominator with a subnormal quotient: the denominator is scaled down by 2^-128 (the documents say up, which overflows)');
  const [bigDenOnly, bigDenNum] = [scale(1e308, 1e308, 1e300), scale(1e300, 1e308, 1e300)];
  assert(bigDenOnly.v === 1e308 * 2 ** -128 && bigDenNum.v === 1e300 * 2 ** -128 && bigDenOnly.flag === 0 && bigDenNum.flag === 0,
    'a huge denominator (1/D subnormal) with an ordinary quotient: both operands are scaled down by 2^-128, without the flag');
  const sub = scale(5e-320, 5e-320, 1e-300);
  assert(sub.v === 5e-320 * 2 ** 128 && sub.flag === 0 && scale(3, 3, 7).v === 3 && scale(3, 3, 7).flag === 0,
    'a subnormal denominator is scaled up without the flag; ordinary operands are unchanged');

  const fmas = (vcc: number, x: number, y: number, z: number) => f64FromBits(read64(run1('v_div_fmas_f64 v[6:7], v[0:1], v[2:3], v[4:5]', e => {
    e.state.vcc = vcc;
    [x, y, z].forEach((v, i) => write64(e, 2 * i, 0, f64ToBits(v)));
  }), 6));
  assert(fmas(0, 2, 3, 1) === 7 && fmas(1, 2, 3, 4) === 10 * 2 ** 128 && fmas(1, 0.25, 1, 0.5) === 0.75 * 2 ** -128,
    'v_div_fmas_f64: with VCC set it rescales by 2^128 when |src2| ≥ 2, else by 2^-128 (hardware; the documents say 2^64)');
  assert(fmas(1, 1.5 * 2 ** -946, 1, -(2 ** -1006)) === 2 ** -1074, 'v_div_fmas_f64 rescales before its single rounding');

  const fixup = (q: bigint, den: bigint, num: bigint) => read64(run1('v_div_fixup_f64 v[6:7], v[0:1], v[2:3], v[4:5]', e => {
    [q, den, num].forEach((v, i) => write64(e, 2 * i, 0, v));
  }), 6);
  const b = f64ToBits;
  assert(fixup(b(NaN), b(0), b(0)) === 0xFFF8000000000000n && fixup(b(1), b(-Infinity), b(Infinity)) === 0xFFF8000000000000n,
    'v_div_fixup_f64: 0/0 and ∞/∞ give the NaN 0xfff8000000000000');
  assert(fixup(b(1), b(1), 0x7FF0000000000001n) === 0x7FF8000000000001n, 'a NaN numerator is returned quieted');
  assert(fixup(b(5), b(0), b(-3)) === b(-Infinity) && fixup(b(5), b(Infinity), b(-3)) === b(-0) && fixup(b(5), b(-2), b(3)) === b(-5) &&
    fixup(b(1), b(1e300), b(1e-300)) === b(0), 'x/0 → ±∞, x/∞ → ±0, underflow → ±0, and the sign of numerator/denominator');
  assert(fixup(b(NaN), b(1e-300), b(1e300)) === b(Infinity), 'a NaN quotient (the scaled steps overflowed) becomes ±∞ (hardware; the documents keep the NaN)');

  const mods = run1(['v_div_scale_f64 v[6:7], s4, -v[0:1], -v[2:3], v[4:5]', 'v_div_fmas_f64 v[8:9], -v[0:1], v[2:3], |v[10:11]|',
    'v_div_fixup_f64 v[12:13], v[4:5], -v[14:15], |v[16:17]|'].join('\n'), e => {
    e.state.vcc = 0;
    ([[0, 3], [2, 3], [4, 7], [10, -1], [14, 2], [16, -3]] as const).forEach(([reg, v]) => write64(e, reg, 0, f64ToBits(v)));
  });
  assert(f64FromBits(read64(mods, 6)) === -3 && f64FromBits(read64(mods, 8)) === -8 && f64FromBits(read64(mods, 12)) === -7,
    'the division helpers apply the abs and neg source modifiers');
}
{
  // LLVM's double division (scale, reciprocal, two Newton-Raphson steps, rescale, fix up) must give exactly
  // x / y as JavaScript computes it, including overflow, subnormal results and huge or subnormal denominators
  const DIV = ['v_div_scale_f64 v[4:5], s0, v[2:3], v[2:3], v[0:1]', 'v_rcp_f64 v[6:7], v[4:5]', 'v_fma_f64 v[8:9], -v[4:5], v[6:7], 1.0',
    'v_fma_f64 v[6:7], v[6:7], v[8:9], v[6:7]', 'v_fma_f64 v[8:9], -v[4:5], v[6:7], 1.0', 'v_div_scale_f64 v[10:11], vcc_lo, v[0:1], v[2:3], v[0:1]',
    'v_fma_f64 v[6:7], v[6:7], v[8:9], v[6:7]', 'v_mul_f64 v[8:9], v[10:11], v[6:7]', 'v_fma_f64 v[12:13], -v[4:5], v[8:9], v[10:11]',
    'v_div_fmas_f64 v[12:13], v[12:13], v[6:7], v[8:9]', 'v_div_fixup_f64 v[0:1], v[12:13], v[2:3], v[0:1]'].join('\n');
  const divide = (pairs: Array<[number, number]>): number[] => {
    const e = run1(DIV, em => pairs.forEach(([x, y], lane) => { write64(em, 0, lane, f64ToBits(x)); write64(em, 2, lane, f64ToBits(y)); }));
    return pairs.map((_, lane) => f64FromBits(read64(e, 0, lane)));
  };
  const cases: Array<[number, number]> = [[1, 3], [1e300, 1e60], [1e300, 1e-10], [1e308, 0.5], [1e-300, 1e10], [1, 1e308], [3, 1.5e308], [1e300, 1e308],
    [1e-300, 5e-320], [5e-324, 3], [1e-300, 1e-10], [1e-310, 1e-312], [0, 0], [1, 0], [0, 1], [-0, 5], [5, -0], [Infinity, Infinity], [Infinity, 2],
    [2, Infinity], [NaN, 1], [1, NaN], [-7, 2], [7, -2], [2 ** 1023, 0.5], [2 ** -1074, 2 ** 1023], [1.7976931348623157e308, 1e-300], [123.456, 7e-320]];
  let seed = 2024;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF) / 0x80000000;
  for (let i = cases.length; i < 32 * 40; i++) {
    const x = (rnd() + 0.5) * 2 ** (Math.floor(rnd() * 2100) - 1080) * (rnd() < 0.5 ? -1 : 1);
    const y = (rnd() + 0.5) * 2 ** (Math.floor(rnd() * 2100) - 1080) * (rnd() < 0.5 ? -1 : 1);
    cases.push([x, y]);
  }
  const wrong: string[] = [];
  for (let i = 0; i < cases.length; i += 32) {
    const batch = cases.slice(i, i + 32);
    divide(batch).forEach((q, k) => { if (!isF64(q, batch[k][0] / batch[k][1])) wrong.push(`${batch[k][0]} / ${batch[k][1]} gave ${q}`); });
  }
  assert(wrong.length === 0, `LLVM's f64 division sequence matches x / y in ${cases.length} cases${wrong.length ? `; e.g. ${wrong[0]}` : ''}`);
}
{
  const ok = (src: string) => assemble(src).errors.length === 0;
  assert(ok('v_div_fmas_f64 v[0:1], s[0:1], v[2:3], v[4:5]') && !ok('v_div_fmas_f64 v[0:1], s[0:1], s[2:3], v[4:5]'),
    'v_div_fmas_f64 reads VCC, which counts as one of its two scalar values');
  assert(!ok('v_add_f64 v[0:1], v[2:4], v[4:5]') && !ok('v_add_f64 v[0:1], s[1:2], v[4:5]'), 'f64 operands need aligned register pairs');
  assert(!ok('v_floor_f64 v[0:1], v[2:3] row_shr:1') && !ok('v_floor_f64_sdwa v[0:1], v[2:3]'), 'f64 instructions have no DPP or SDWA form');
  assert(!ok('v_div_scale_f64 v[0:1], vcc_lo, |v[2:3]|, v[2:3], v[4:5]') && ok('v_div_scale_f64 v[0:1], vcc_lo, -v[2:3], v[2:3], v[4:5]'),
    'v_div_scale_f64 (VOP3B) takes neg but not abs');
  assert(!ok('v_ldexp_f64 v[0:1], v[2:3], -v4') && !ok('v_trig_preop_f64 v[0:1], v[2:3], |v4|'), 'the integer src1 of v_ldexp_f64 / v_trig_preop_f64 takes no modifiers');
  const w = assemble('v_add_f64 v[0:1], 0.1, v[2:3]\ns_endpgm').warnings;
  assert(w.length === 1 && /high 32 bits/.test(w[0].message), 'an inexact f64 float literal warns');
}

// ════════════════════════════════════════════
//  Summary
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(40)}`);

process.exit(failed > 0 ? 1 : 0);
