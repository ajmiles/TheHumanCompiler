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
}

export interface InvocationResult {
  index: number;
  pass: boolean;
  outputValues: number[];
  expectedValues: number[];
}
