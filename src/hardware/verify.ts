// ── Hardware runs: checking a solution, and scoring its runs ──
// verify() turns a submitted solution into a devkit job, once it passes in the emulator the way it did in the
// player's browser; score() turns what the devkit sends back into the Hardware cycles result.

import { assemble } from '../assembler/assembler';
import { Emulator } from '../emulator/emulator';
import { WAVE_WIDTH } from '../isa/constants';
import { getPuzzleById } from '../puzzle/puzzles';
import { runPuzzle, vgprsUsed } from '../puzzle/runner';
import { Puzzle } from '../puzzle/types';
import { validatePuzzle } from '../puzzle/validator';
import { hardwareProblems } from './checks';
import { INPUT_OFFSET, inputWords, jobPrograms, resultBytes } from './harness';
import { codeHash, puzzleHash, SANDBOX } from './hash';
import { HW_HARNESS, HW_PROTOCOL, HW_REQUIREMENTS, HwJob, HwJobRuns, HwScore, HwStatus } from './protocol';

/** How many times the devkit runs each program by default. */
export const DEFAULT_RUNS = 100;

/** A solution's leaderboard stats. */
export interface SolutionStats {
  /** Bytes of machine code. */
  codeSize: number;
  vgprsUsed: number;
  /** Instructions executed over all invocations (the Speed board). */
  cycles: number;
}

export interface VerifyResult {
  /** The solution passes in the emulator and can be timed on the devkit: `job` is ready. */
  ok: boolean;
  /** Why not. */
  reason?: string;
  /** The stats, worked out again: there once the solution passes in the emulator. */
  stats?: SolutionStats;
  /** Claimed stats that don't match `stats`. */
  claimMismatches?: string[];
  job?: HwJob;
}

function buildJob(puzzle: Puzzle | null, binary: Uint32Array, vgprs: number, emulatorOutputs: number[][], runs: number): HwJob {
  return {
    protocol: HW_PROTOCOL,
    harness: HW_HARNESS,
    puzzleId: puzzle?.id ?? SANDBOX,
    puzzleHash: puzzleHash(puzzle),
    codeHash: codeHash(binary),
    runs,
    resultBytes: resultBytes(puzzle),
    inputOffset: INPUT_OFFSET,
    requirements: { ...HW_REQUIREMENTS },
    ...jobPrograms(puzzle, binary, vgprs),
    invocations: emulatorOutputs.map((outputs, inv) => ({ inputWords: inputWords(puzzle, inv), emulatorOutputs: outputs })),
  };
}

/** The leaderboard fields a claim gets wrong. */
function mismatches(stats: SolutionStats, claim: Partial<SolutionStats> | undefined): string[] {
  return (['codeSize', 'vgprsUsed', 'cycles'] as const)
    .filter(k => claim?.[k] !== undefined && claim[k] !== stats[k])
    .map(k => `${k}: claimed ${claim![k]}, actually ${stats[k]}`);
}

/** Why the devkit can't time a solution, in one line. */
function problemSummary(problems: string[]): string {
  return problems.length > 3 ? `${problems.slice(0, 3).join('; ')}; and ${problems.length - 3} more` : problems.join('; ');
}

/**
 * Check a submitted solution and build its devkit job. It must assemble and pass the puzzle in the emulator, as it
 * did for the player, and use nothing that behaves differently on hardware. `claim` is the stats the entry claims.
 */
export function verify(source: string, puzzleId: string, claim?: Partial<SolutionStats>, runs = DEFAULT_RUNS): VerifyResult {
  const puzzle = getPuzzleById(puzzleId);
  if (!puzzle) return { ok: false, reason: `There is no puzzle '${puzzleId}'` };
  const asm = assemble(source);
  if (asm.errors.length > 0) return { ok: false, reason: `Line ${asm.errors[0].line}: ${asm.errors[0].message}` };

  const run = runPuzzle(puzzle, asm.binary);
  const crash = run.result.crash;
  if (crash) return { ok: false, reason: `It crashed in invocation ${crash.invocation + 1}: ${crash.message}` };
  if (!run.result.pass) return { ok: false, reason: `Wrong output: ${run.result.totalCorrect} of ${run.result.totalExpected} values are right` };

  const stats: SolutionStats = {
    codeSize: asm.binary.length * 4,
    vgprsUsed: vgprsUsed(asm.instructions, puzzle, run.peakIndirectVgpr),
    cycles: run.cycles,
  };
  const wrong = mismatches(stats, claim);
  const checked = { stats, ...(wrong.length > 0 ? { claimMismatches: wrong } : {}) };
  const problems = hardwareProblems(asm.instructions);
  if (problems.length > 0) return { ok: false, reason: problemSummary(problems), ...checked };
  const outputs = run.invocations.map(i => i.outputBits.flat());
  return { ok: true, ...checked, job: buildJob(puzzle, asm.binary, stats.vgprsUsed, outputs, runs) };
}

/** Build a job for a program with no inputs or outputs (a calibration program, say), once it runs in the emulator. */
export function verifySandbox(source: string, runs = DEFAULT_RUNS): VerifyResult {
  const asm = assemble(source);
  if (asm.errors.length > 0) return { ok: false, reason: `Line ${asm.errors[0].line}: ${asm.errors[0].message}` };
  const emu = new Emulator();
  emu.load(asm.binary);
  emu.run();
  if (emu.fault) return { ok: false, reason: `It crashed: ${emu.fault}` };
  const stats: SolutionStats = {
    codeSize: asm.binary.length * 4,
    vgprsUsed: vgprsUsed(asm.instructions, null, emu.state.maxIndirectVgpr),
    cycles: emu.getCycleCount(),
  };
  const problems = hardwareProblems(asm.instructions);
  if (problems.length > 0) return { ok: false, reason: problemSummary(problems), stats };
  return { ok: true, stats, job: buildJob(null, asm.binary, stats.vgprsUsed, [[]], runs) };
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const floatOf = (bits: number) => {
  u32[0] = bits;
  return f32[0];
};

/**
 * The duration most runs took (the shorter, for a tie), and the share of runs that took it. On a devkit about 99% of
 * runs agree exactly; a few come in a couple of cycles short or much longer, so neither the fastest run nor an
 * average is the cost.
 */
function settled(durations: number[]): { duration: number; share: number } {
  const counts = new Map<number, number>();
  for (const d of durations) counts.set(d, (counts.get(d) ?? 0) + 1);
  let duration = Infinity;
  let count = 0;
  for (const [d, c] of counts) {
    if (c > count || (c === count && d < duration)) {
      duration = d;
      count = c;
    }
  }
  return { duration, share: count / durations.length };
}

/**
 * Score a job's runs: each invocation costs its solution's most common duration less its baseline's, and the
 * outputs must pass the puzzle, as the emulator's did.
 */
export function score(job: HwJob, runs: HwJobRuns): HwScore {
  const verdict = (status: HwStatus, detail: string): HwScore => ({ status, harness: job.harness, detail });
  if (job.protocol !== HW_PROTOCOL || job.harness !== HW_HARNESS) {
    return verdict('failed', `The job is for protocol ${job.protocol}, harness ${job.harness}; this verifier is ${HW_PROTOCOL}, ${HW_HARNESS}`);
  }
  const puzzle = job.puzzleId === SANDBOX ? null : getPuzzleById(job.puzzleId) ?? null;
  if (job.puzzleId !== SANDBOX && (!puzzle || puzzleHash(puzzle) !== job.puzzleHash)) {
    return verdict('failed', `The puzzle '${job.puzzleId}' has changed since the job was made`);
  }
  if (runs.invocations.length !== job.invocations.length) {
    return verdict('failed', `${runs.invocations.length} invocations ran, but the job has ${job.invocations.length}`);
  }

  const outputs = puzzle?.outputs ?? [];
  const collected = new Map<number, number[]>(outputs.map(o => [o.register, []]));
  const perInvocation: number[] = [];
  let emulatorMismatches = 0;
  // Wrong outputs fail even if the timings are unstable too: measuring again won't fix them
  let unstableTiming: string | undefined;
  for (const [inv, { solution, baseline }] of runs.invocations.entries()) {
    for (const [name, r] of [['solution', solution], ['baseline', baseline]] as const) {
      if (r.durations.length === 0) return verdict('failed', `The ${name} of invocation ${inv + 1} never ran`);
      if (!r.outputsStable) return verdict('unstable', `The ${name} of invocation ${inv + 1} wrote different outputs on different runs`);
    }
    if (solution.outputWords.length !== outputs.length * WAVE_WIDTH) {
      return verdict('failed', `Invocation ${inv + 1} sent ${solution.outputWords.length} output dwords, not ${outputs.length * WAVE_WIDTH}`);
    }
    const emulated = job.invocations[inv].emulatorOutputs;
    outputs.forEach((o, k) => {
      for (let lane = 0; lane < WAVE_WIDTH && inv * WAVE_WIDTH + lane < o.values.length; lane++) {
        const word = solution.outputWords[k * WAVE_WIDTH + lane] >>> 0;
        collected.get(o.register)![inv * WAVE_WIDTH + lane] = o.isInteger ? word : floatOf(word);
        if (word !== emulated[k * WAVE_WIDTH + lane] >>> 0) emulatorMismatches++;
      }
    });
    const s = settled(solution.durations);
    const b = settled(baseline.durations);
    if (s.share < 0.5 || b.share < 0.5) unstableTiming ??= `The timings of invocation ${inv + 1} didn't settle: no duration came up in half the runs`;
    else if (s.duration < b.duration) unstableTiming ??= `Invocation ${inv + 1} ran faster than the empty program`;
    perInvocation.push(s.duration - b.duration);
  }

  if (puzzle) {
    const check = validatePuzzle(puzzle, collected);
    if (!check.pass) return verdict('failed', `Wrong output on the devkit: ${check.totalCorrect} of ${check.totalExpected} values are right`);
  }
  if (unstableTiming) return verdict('unstable', unstableTiming);
  return {
    status: 'measured',
    harness: job.harness,
    cycles: perInvocation.reduce((a, b) => a + b, 0),
    perInvocation,
    ...(emulatorMismatches > 0 ? { emulatorMismatches } : {}),
  };
}
