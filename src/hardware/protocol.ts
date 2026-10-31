// ── Hardware runs: protocol ──
// What the devkit runner gets and gives back. The runner is a GDK title: it loads each program's machine code as a
// wave32 compute shader, runs it and returns the raw results. Everything else (checking a solution, generating the
// programs, scoring the runs) is in src/hardware, which the title runs in QuickJS (see verifier.ts).
//
// Bump HW_PROTOCOL when these shapes change, and HW_HARNESS whenever the generated code changes: measurements made
// with another harness are out of date.

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
  /** How many times to run each program; the score uses the fastest run. */
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
 * unstable: runs disagree (different outputs, or faster than the empty program): measure again.
 */
export type HwStatus = 'measured' | 'failed' | 'unstable';

/** The verdict on a job's runs, to store with the leaderboard entry. */
export interface HwScore {
  status: HwStatus;
  harness: number;
  /** Core clocks over all invocations: for each, its fastest run minus the fastest run of its baseline. */
  cycles?: number;
  perInvocation?: number[];
  /** Output lanes whose bits differ from the emulator's though the puzzle passes (an approximate v_rcp_f32, say). */
  emulatorMismatches?: number;
  detail?: string;
}
