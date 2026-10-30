// ── Puzzle Type Definitions ──

export interface PuzzlePort {
  name: string;       // Display name, e.g. "Input A"
  register: number;   // VGPR index (or SGPR index if isSGPR)
  values: number[];   // Full stream of values
  isInteger?: boolean; // If true, values are raw u32 (not float)
  isSGPR?: boolean;   // If true, this is a scalar register input
}

export interface Puzzle {
  id: string;
  title: string;
  description: string;
  inputs: PuzzlePort[];
  outputs: PuzzlePort[];
  hints: string[];
  optimalInstructions: number; // For showing "X / optimal" score
}

export interface PuzzleResult {
  pass: boolean;
  invocations: InvocationResult[];
  totalExpected: number;
  totalCorrect: number;
  /** The run crashed (e.g. ran off the end without s_endpgm): the solution is not valid. */
  crash?: PuzzleCrash;
}

export interface PuzzleCrash {
  /** Index of the invocation that crashed; later invocations never ran. */
  invocation: number;
  message: string;
}

export interface InvocationResult {
  index: number;
  pass: boolean;
  crashed?: boolean;
  outputValues: number[];
  expectedValues: number[];
}
