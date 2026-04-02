// ── Puzzle Type Definitions ──

export interface PuzzlePort {
  name: string;       // Display name, e.g. "Input A"
  register: number;   // VGPR index, e.g. 0 for v0
  values: number[];   // Full stream of values
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
