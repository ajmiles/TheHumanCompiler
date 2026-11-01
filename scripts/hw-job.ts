// ── hw-job: devkit jobs from the command line ──
// For trying a runner out before it reads submissions from Firestore (Phase 0 of the hardware leaderboard):
//
//   npx tsx scripts/hw-job.ts <puzzle-id> <solution.s>   a puzzle solution, checked as the leaderboard will check it
//   npx tsx scripts/hw-job.ts --sandbox <program.s>       a program with no inputs or outputs
//   npx tsx scripts/hw-job.ts --calibration               programs with known costs, to check the timing
//
// Options:
//   --runs N       how many times to run each program (default 100)
//   --out FILE     write the JSON there instead of to stdout
//   --bin DIR      also write each program's code to DIR/<name>-<solution|baseline>.bin (little-endian, relocations
//                  still to patch) and each invocation's input block to DIR/<name>-<invocation>-inputs.bin: see
//                  src/hardware/protocol.ts
//
// The output is a VerifyResult (src/hardware/verify.ts) per program, its job ready for the runner when `ok`.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_RUNS, verify, VerifyResult, verifySandbox } from '../src/hardware/verify';

const repeat = (n: number, lines: (i: number) => string[]) => Array.from({ length: n }, (_, i) => lines(i)).flat();

/** Programs whose costs scale in known ways: their timings check the harness and the measurements. */
function calibrationPrograms(): Record<string, string> {
  const programs: Record<string, string[]> = { empty: [] };
  for (const k of [1, 2, 4, 8, 16, 32, 64]) {
    programs[`dependent-v_add_f32-${k}`] = repeat(k, () => ['v_add_f32 v0, v0, v1']);
    programs[`independent-v_add_f32-${k}`] = repeat(k, i => [`v_add_f32 v${2 + (i % 8)}, v0, v1`]);
    programs[`dependent-v_sqrt_f32-${k}`] = repeat(k, () => ['v_sqrt_f32 v0, v0']);
    programs[`s_nop-${k}`] = repeat(k, () => ['s_nop 0']);
    programs[`lds-round-trip-${k}`] = repeat(k, () => ['ds_write_b32 v1, v0', 's_waitcnt lgkmcnt(0)', 'ds_read_b32 v0, v1', 's_waitcnt lgkmcnt(0)']);
    programs[`scalar-loop-${k}`] = [`s_movk_i32 s0, ${k}`, 'loop:', 's_sub_u32 s0, s0, 1', 's_cmp_lg_u32 s0, 0', 's_cbranch_scc1 loop'];
  }
  return Object.fromEntries(Object.entries(programs).map(([name, lines]) => [name, [...lines, 's_endpgm'].join('\n')]));
}

function main(argv: string[]): void {
  const option = (name: string) => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const value = argv[i + 1];
    argv.splice(i, 2);
    return value;
  };
  const runs = Number(option('--runs') ?? DEFAULT_RUNS);
  const out = option('--out');
  const bin = option('--bin');
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs takes a positive whole number');

  const results: Record<string, VerifyResult> = {};
  if (argv[0] === '--calibration' && argv.length === 1) {
    for (const [name, source] of Object.entries(calibrationPrograms())) results[name] = verifySandbox(source, runs);
  } else if (argv[0] === '--sandbox' && argv.length === 2) {
    results.sandbox = verifySandbox(readFileSync(argv[1], 'utf8'), runs);
  } else if (argv.length === 2 && !argv[0].startsWith('--')) {
    results[argv[0]] = verify(readFileSync(argv[1], 'utf8'), argv[0], undefined, runs);
  } else {
    throw new Error('Usage: hw-job.ts <puzzle-id> <solution.s> | --sandbox <program.s> | --calibration  [--runs N] [--out FILE] [--bin DIR]');
  }

  for (const [name, result] of Object.entries(results)) {
    if (!result.ok) console.error(`${name}: ${result.reason}`);
  }
  if (bin) {
    mkdirSync(bin, { recursive: true });
    for (const [name, result] of Object.entries(results)) {
      if (!result.job) continue;
      for (const which of ['solution', 'baseline'] as const) {
        writeFileSync(join(bin, `${name}-${which}.bin`), new Uint8Array(Uint32Array.from(result.job[which].code).buffer));
      }
      result.job.invocations.forEach((inv, i) => {
        writeFileSync(join(bin, `${name}-${i}-inputs.bin`), new Uint8Array(Uint32Array.from(inv.inputWords).buffer));
      });
    }
  }
  const json = JSON.stringify(results, null, 1);
  if (out) writeFileSync(out, json);
  else console.log(json);
  if (Object.values(results).some(r => !r.ok)) process.exitCode = 1;
}

main(process.argv.slice(2));
