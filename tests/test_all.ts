// ── Comprehensive RDNA2 Emulator Test Suite ──

import { assemble } from '../src/assembler/assembler';
import { Emulator } from '../src/emulator/emulator';
import { decodeBinary, disassemble } from '../src/isa/encoding';
import { lookupByOpcode } from '../src/isa/opcodes';

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

// EXEC masking: disabled lanes should not be modified
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
  assert(emu.state.readVGPR_u32(1, 0) === 1, 'ds_swizzle EXEC: active lane 0 swizzled (reads lane 1)');
  assert(emu.state.readVGPR_u32(1, 1) === 0xFF, 'ds_swizzle EXEC: inactive lane 1 unchanged (0xFF)');
  assert(emu.state.readVGPR_u32(1, 2) === 0xFF, 'ds_swizzle EXEC: inactive lane 2 unchanged (0xFF)');
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
//  DPP16 — row_shr, row_shl, row_ror, quad_perm, wave_shl/shr, row_mirror
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

// row_shr:1 — each lane reads from lane+1 within a row of 16
{
  const emu = setupDpp16('row_shr:1 bound_ctrl:1');
  assert(emu.state.readVGPR_u32(1, 0) === 1, 'DPP16 row_shr:1: lane 0 reads lane 1');
  assert(emu.state.readVGPR_u32(1, 14) === 15, 'DPP16 row_shr:1: lane 14 reads lane 15');
  assert(emu.state.readVGPR_u32(1, 15) === 0, 'DPP16 row_shr:1: lane 15 OOB → 0 (bound_ctrl)');
  assert(emu.state.readVGPR_u32(1, 16) === 17, 'DPP16 row_shr:1: lane 16 reads lane 17 (row 1)');
}

// row_shl:1 — each lane reads from lane-1 within a row
{
  const emu = setupDpp16('row_shl:1 bound_ctrl:1');
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'DPP16 row_shl:1: lane 0 OOB → 0 (bound_ctrl)');
  assert(emu.state.readVGPR_u32(1, 1) === 0, 'DPP16 row_shl:1: lane 1 reads lane 0');
  assert(emu.state.readVGPR_u32(1, 15) === 14, 'DPP16 row_shl:1: lane 15 reads lane 14');
}

// row_shr:4 — shift right by 4 within row
{
  const emu = setupDpp16('row_shr:4 bound_ctrl:1');
  assert(emu.state.readVGPR_u32(1, 0) === 4, 'DPP16 row_shr:4: lane 0 reads lane 4');
  assert(emu.state.readVGPR_u32(1, 11) === 15, 'DPP16 row_shr:4: lane 11 reads lane 15');
  assert(emu.state.readVGPR_u32(1, 12) === 0, 'DPP16 row_shr:4: lane 12 OOB → 0');
}

// row_ror:1 — rotate right within row (wraps around)
{
  const emu = setupDpp16('row_ror:1');
  assert(emu.state.readVGPR_u32(1, 0) === 1, 'DPP16 row_ror:1: lane 0 reads lane 1');
  assert(emu.state.readVGPR_u32(1, 15) === 0, 'DPP16 row_ror:1: lane 15 wraps to lane 0');
  assert(emu.state.readVGPR_u32(1, 16) === 17, 'DPP16 row_ror:1: lane 16 reads lane 17 (row 1)');
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

// wave_shl:1 — shift left across full wave
{
  const emu = setupDpp16('wave_shl:1 bound_ctrl:1');
  assert(emu.state.readVGPR_u32(1, 0) === 0, 'DPP16 wave_shl:1: lane 0 OOB → 0');
  assert(emu.state.readVGPR_u32(1, 1) === 0, 'DPP16 wave_shl:1: lane 1 reads lane 0');
  assert(emu.state.readVGPR_u32(1, 16) === 15, 'DPP16 wave_shl:1: lane 16 reads lane 15 (crosses row)');
}

// wave_shr:1 — shift right across full wave
{
  const emu = setupDpp16('wave_shr:1 bound_ctrl:1');
  assert(emu.state.readVGPR_u32(1, 0) === 1, 'DPP16 wave_shr:1: lane 0 reads lane 1');
  assert(emu.state.readVGPR_u32(1, 31) === 0, 'DPP16 wave_shr:1: lane 31 OOB → 0');
  assert(emu.state.readVGPR_u32(1, 15) === 16, 'DPP16 wave_shr:1: lane 15 reads lane 16 (crosses row)');
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
  // Lane 0: src0=v0[lane 1]=1.0 (DPP), src1=v0[lane 0]=0.0 → 1.0
  assert(approx(emu.state.readVGPR(1, 0), 1.0), 'DPP16 VOP2: v_add_f32 row_shr:1 lane 0 = 0.0 + 1.0');
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
//  VOP3P — Packed 16-bit Operations
// ════════════════════════════════════════════
group('VOP3P Packed 16-bit Operations');

// Helper: build VOP3P binary (2 dwords)
// opSelHi default 0x7 = bits[2:0] set → all source hi reads from hi half
function buildVOP3P(opcode: number, vdst: number, src0: number, src1: number, src2 = 0, opSelHi = 0x7): number[] {
  const dword0 = (0x33 << 26) | ((opcode & 0x3FF) << 16) | ((opSelHi & 0xF) << 11) | (vdst & 0xFF);
  const dword1 = ((src2 & 0x1FF) << 18) | ((src1 & 0x1FF) << 9) | (src0 & 0x1FF);
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
//  Summary
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(40)}`);

process.exit(failed > 0 ? 1 : 0);
