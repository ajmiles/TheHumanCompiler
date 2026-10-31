// ── Hardware runs: protocol ──
// What the devkit runner gets and gives back. The runner is a GDK title: it loads each program's machine code as a
// wave32 compute shader, runs it and returns the raw results. Everything else (checking a solution, generating the
// programs, scoring the runs) is in src/hardware, which the title runs in QuickJS (see verifier.ts).
//
// Bump HW_PROTOCOL when these shapes change, and HW_HARNESS whenever the generated code changes: measurements made
// with another harness are out of date.
//
// In Firestore, where firestore.rules lets only the runner's account do these, the runner:
//   1. Keeps runner/status up to date: { heartbeat: server time, queued: submissions waiting, harness: HW_HARNESS,
//      version: the verifier's }. While it exists, the site shows the Hardware cycles board and sends solutions.
//   2. Takes the submissions/{entryId} whose status is 'pending', oldest createdAt first, and sets 'running'.
//   3. Sets 'stale' if the submission's puzzleHash isn't the puzzle's any more. Otherwise it verify()s the source,
//      with the stats that leaderboards/{puzzleId}/entries/{entryId} claims: if that isn't ok, it sets 'rejected',
//      with the reason as detail.
//   4. Times the job and score()s the runs, recording the status, detail, cycles, claimMismatches and harness ('hung'
//      if the GPU doesn't finish), and updatedAt: server time.
//   5. When measured, adds hw: { cycles, perInvocation, emulatorMismatches, harness, measuredAt: server time,
//      submittedAt: the submission's createdAt } to the entry, in the same batch as step 4: that puts the entry on the
//      board, where ties go to the earliest submittedAt (kept when the entry is timed again).

export const HW_PROTOCOL = 1;
export const HW_HARNESS = 1;

/** How the runner must set up the compute shader the programs are patched into. */
export const HW_REQUIREMENTS = {
  waveSize: 32,
  threadsPerGroup: 32,
  vgprs: 256,
  ldsBytes: 65536,
} as const;

/**
 * Each run writes a record at the result address: T_start and T_end (u64 core clocks, from s_memtime), then 32
 * lanes of each output register, in the puzzle's order.
 */
export const RESULT_T_START = 0;
export const RESULT_T_END = 8;
export const RESULT_OUTPUTS = 16;

export interface HwRelocation {
  /** Index into `code` of a dword the runner overwrites before creating the pipeline. */
  dword: number;
  /** The result buffer's GPU virtual address, low or high 32 bits. */
  value: 'resultAddressLo' | 'resultAddressHi';
}

/** One program: machine code for the start of the shader, and the dwords to patch. */
export interface HwProgram {
  /** Little-endian dwords. The shader's code starts with the first, which on hardware is 256-byte aligned. */
  code: number[];
  relocations: HwRelocation[];
}

export interface HwInvocationJob {
  /** The solution, wrapped in the harness. */
  solution: HwProgram;
  /** The same harness around just s_endpgm: its time is subtracted from the solution's. */
  baseline: HwProgram;
  /** The output registers' bits in the emulator: 32 lanes of each output, in the puzzle's order. */
  emulatorOutputs: number[];
}

export interface HwJob {
  protocol: number;
  harness: number;
  /** A puzzle id, or 'sandbox' for a program with no inputs or outputs. */
  puzzleId: string;
  puzzleHash: string;
  codeHash: string;
  /**
   * How many times to time each program. Each timed run must follow an untimed run of the same program with nothing
   * but a UAV barrier between them, so its instruction cache is warm (resource transitions invalidate it).
   * The score uses the most common duration.
   */
  runs: number;
  /** Bytes each run writes at the result address. */
  resultBytes: number;
  requirements: typeof HW_REQUIREMENTS;
  invocations: HwInvocationJob[];
}

/** What the runner sends back for one program. */
export interface HwProgramRuns {
  /** T_end − T_start of each run, in core clocks. */
  durations: number[];
  /** The output dwords of the first run's record (32 per output register). */
  outputWords: number[];
  /** Every run wrote the same output dwords. */
  outputsStable: boolean;
}

export interface HwJobRuns {
  invocations: Array<{ solution: HwProgramRuns; baseline: HwProgramRuns }>;
}

/**
 * measured: the outputs pass the puzzle and `cycles` is the time.
 * failed: the outputs are wrong, or the runs don't fit the job.
 * unstable: runs disagree (different outputs, no duration in half the runs, or faster than the empty program):
 * measure again.
 */
export type HwStatus = 'measured' | 'failed' | 'unstable';

/** The verdict on a job's runs, to store with the leaderboard entry. */
export interface HwScore {
  status: HwStatus;
  harness: number;
  /** Core clocks over all invocations: for each, its solution's most common duration less its baseline's. */
  cycles?: number;
  perInvocation?: number[];
  /** Output lanes whose bits differ from the emulator's though the puzzle passes (an approximate v_rcp_f32, say). */
  emulatorMismatches?: number;
  detail?: string;
}
