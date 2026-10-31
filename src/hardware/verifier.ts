// ── Hardware verifier (bundle entry) ──
// npm run build turns this into dist/hw/verifier.js: a script that defines the global HumanCompilerVerifier. The
// devkit title loads it into QuickJS from the live site, so its checks and harness always match the deployed game.
// The JSON functions are for the title, which passes strings in and out.

import './engine-fixes';
import { getPuzzleById } from '../puzzle/puzzles';
import { VERSION } from '../version';
import { puzzleHash } from './hash';
import { HW_HARNESS, HW_PROTOCOL, HwJob, HwJobRuns } from './protocol';
import { DEFAULT_RUNS, score, SolutionStats, verify, verifySandbox } from './verify';

// An embedded engine may have no console: nothing here should log, but stray logging mustn't throw
const host = globalThis as { console?: unknown };
if (host.console === undefined) {
  const quiet = () => undefined;
  host.console = { log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet };
}

export { score, verify, verifySandbox };
/** The game version this verifier was built from. */
export const version = VERSION;
export const protocol = HW_PROTOCOL;
export const harness = HW_HARNESS;

/**
 * The hash of a puzzle as this verifier has it, or null if it has no such puzzle. A submission whose puzzleHash
 * differs was solved for another version of the puzzle: it's stale.
 */
export function puzzleHashOf(puzzleId: string): string | null {
  const puzzle = getPuzzleById(puzzleId);
  return puzzle ? puzzleHash(puzzle) : null;
}

/** verify() for JSON: {"source", "puzzleId", "claim"?, "runs"?} → VerifyResult. */
export function verifyJson(request: string): string {
  const r = JSON.parse(request) as { source: string; puzzleId: string; claim?: Partial<SolutionStats>; runs?: number };
  return JSON.stringify(verify(r.source, r.puzzleId, r.claim, r.runs ?? DEFAULT_RUNS));
}

/** score() for JSON: {"job", "runs"} → HwScore. */
export function scoreJson(request: string): string {
  const r = JSON.parse(request) as { job: HwJob; runs: HwJobRuns };
  return JSON.stringify(score(r.job, r.runs));
}
