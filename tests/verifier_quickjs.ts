// ── The hardware verifier in QuickJS ──
// The devkit title runs dist/hw/verifier.js (built by npm run build) in QuickJS. This loads that file into
// quickjs-ng, the engine the title embeds, and checks that it answers exactly as the TypeScript it's built from.
// Run it after a build: npm run test:verifier.

import { readFileSync } from 'node:fs';
import variant from '@jitl/quickjs-ng-wasmfile-release-sync';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import { HwJobRuns } from '../src/hardware/protocol';
import { score, verify, verifySandbox } from '../src/hardware/verify';
import { VERSION } from '../src/version';

let failed = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL:'} ${message}`);
  if (!ok) failed++;
}

const bundle = readFileSync(new URL('../dist/hw/verifier.js', import.meta.url), 'utf8');
const quickjs = await newQuickJSWASMModuleFromVariant(variant);
const vm = quickjs.newContext();

/** Evaluate an expression in QuickJS and return its value as a string. */
function evaluate(expression: string): string {
  const handle = vm.unwrapResult(vm.evalCode(expression));
  try {
    return vm.getString(handle);
  } finally {
    handle.dispose();
  }
}

vm.unwrapResult(vm.evalCode(bundle, 'verifier.js')).dispose();
console.log(`verifier.js: ${(bundle.length / 1024).toFixed(0)} KB`);
check(evaluate('typeof console') === 'object' && evaluate('HumanCompilerVerifier.version') === VERSION &&
  evaluate('String(HumanCompilerVerifier.protocol) + "," + HumanCompilerVerifier.harness') === '1,1',
  'the bundle defines HumanCompilerVerifier, of this version, and a console where the engine has none');
check(evaluate('[BigInt.asUintN(64, -5n), BigInt.asUintN(64, 0xe71fa2190541574bn), BigInt.asUintN(32, -5n), BigInt.asIntN(64, 0xe71fa2190541574bn)].join()') ===
  [BigInt.asUintN(64, -5n), BigInt.asUintN(64, 0xe71fa2190541574bn), BigInt.asUintN(32, -5n), BigInt.asIntN(64, 0xe71fa2190541574bn)].join(),
  'BigInt.asUintN / asIntN are right after loading the bundle (quickjs-ng 0.32 gets asUintN wrong)');

const smoothClamp = ['v_sub_f32 v2, v2, v0', 'v_sub_f32 v1, v1, v0', 'v_rcp_f32 v1, v1', 'v_mul_f32 v0, v1, v2', 'v_max_f32 v0, v0, 0.0',
  'v_min_f32 v0, v0, 1.0', 'v_mul_f32 v1, v0, v0', 'v_mad_f32 v0, v0, -2.0, 3.0', 'v_mul_f32 v3, v0, v1', 's_endpgm'].join('\n');
// Signal Boost (x × 2) through 64-bit values with the top bit set: an f64 −2.0, and SALU results of 0x8000000000000000
const viaF64 = ['s_mov_b32 s0, 0', 's_mov_b32 s1, 0xc0000000', 'v_cvt_f64_f32 v[2:3], v0', 'v_mul_f64 v[2:3], v[2:3], s[0:1]',
  'v_cvt_f32_f64 v1, -v[2:3]', 's_endpgm'].join('\n');
const viaSalu64 = ['s_mov_b64 s[4:5], -1', 's_lshr_b64 s[4:5], s[4:5], 1', 's_not_b64 s[4:5], s[4:5]', 's_bitcmp1_b64 s[4:5], 63',
  's_cselect_b32 s6, 2.0, 0', 'v_mul_f32 v1, s6, v0', 's_endpgm'].join('\n');
const requests = [
  { source: smoothClamp, puzzleId: 'smooth-clamp', claim: { codeSize: 40 } },
  { source: `v_mov_b32 v255, 0\n${smoothClamp}`, puzzleId: 'smooth-clamp', runs: 9 },
  { source: viaF64, puzzleId: 'signal-boost' },
  { source: viaSalu64, puzzleId: 'signal-boost' },
  { source: 'v_mov_b32 v3, 0', puzzleId: 'smooth-clamp' },
  { source: `s_getpc_b64 s[10:11]\n${smoothClamp}`, puzzleId: 'smooth-clamp' },
  { source: 'v_mov_b32 v1, v0\ns_endpgm', puzzleId: 'byte-sort' },
  { source: smoothClamp, puzzleId: 'no-such-puzzle' },
];
check(verify(viaF64, 'signal-boost').ok && verify(viaSalu64, 'signal-boost').ok, 'the 64-bit Signal Boost solutions pass in Node');
for (const r of requests) {
  const t0 = performance.now();
  const inQuickJs = evaluate(`HumanCompilerVerifier.verifyJson(${JSON.stringify(JSON.stringify(r))})`);
  const ms = performance.now() - t0;
  const expected = JSON.stringify(verify(r.source, r.puzzleId, r.claim, r.runs));
  check(inQuickJs === expected, `verifyJson ${r.puzzleId} (${r.source.split('\n')[0]}…): ${JSON.parse(inQuickJs).ok ? 'ok' : JSON.parse(inQuickJs).reason}, ${ms.toFixed(0)} ms`);
}

const calibration = 'v_add_f32 v0, v0, v1\nv_add_f32 v0, v0, v1\ns_endpgm';
check(evaluate(`JSON.stringify(HumanCompilerVerifier.verifySandbox(${JSON.stringify(calibration)}))`) === JSON.stringify(verifySandbox(calibration)),
  'verifySandbox: a calibration program');

const job = verify(smoothClamp, 'smooth-clamp').job!;
const runs = (outputs: number[][]): HwJobRuns => ({
  invocations: outputs.map(o => ({
    solution: { durations: [135, 131, 133], outputWords: o, outputsStable: true },
    baseline: { durations: [101, 100], outputWords: [], outputsStable: true },
  })),
});
for (const outputs of [job.invocations.map(i => i.emulatorOutputs), job.invocations.map(i => i.emulatorOutputs.map(() => 0))]) {
  const request = JSON.stringify({ job, runs: runs(outputs) });
  const inQuickJs = evaluate(`HumanCompilerVerifier.scoreJson(${JSON.stringify(request)})`);
  check(inQuickJs === JSON.stringify(score(job, runs(outputs))), `scoreJson: ${inQuickJs}`);
}

vm.dispose();
console.log(failed === 0 ? '\nThe verifier gives the same answers in QuickJS.' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
