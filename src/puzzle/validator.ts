// ── Puzzle Validator ──
// Compares actual output from emulator against expected puzzle output

import { WAVE_WIDTH } from '../isa/constants';
import { Puzzle, PuzzleResult, InvocationResult } from './types';

const EPSILON = 1e-4; // Tolerance for float comparison

function floatEquals(a: number, b: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) < EPSILON;
}

/**
 * Validate collected output against puzzle expected values.
 * 
 * @param puzzle - The puzzle definition
 * @param collectedOutputs - Map of register index → collected output values across all invocations
 */
export function validatePuzzle(
  puzzle: Puzzle,
  collectedOutputs: Map<number, number[]>,
): PuzzleResult {
  const invocations: InvocationResult[] = [];
  let totalExpected = 0;
  let totalCorrect = 0;
  
  // Calculate number of invocations
  const streamLength = puzzle.outputs[0]?.values.length ?? 0;
  const numInvocations = Math.ceil(streamLength / WAVE_WIDTH);
  
  for (let inv = 0; inv < numInvocations; inv++) {
    let invPass = true;
    const invOutputValues: number[] = [];
    const invExpectedValues: number[] = [];
    
    for (const output of puzzle.outputs) {
      const collected = collectedOutputs.get(output.register) ?? [];
      const startIdx = inv * WAVE_WIDTH;
      const endIdx = Math.min(startIdx + WAVE_WIDTH, output.values.length);
      
      for (let i = startIdx; i < endIdx; i++) {
        const expected = output.values[i];
        const actual = i < collected.length ? collected[i] : NaN;
        
        invExpectedValues.push(expected);
        invOutputValues.push(actual);
        totalExpected++;
        
        if (floatEquals(actual, expected)) {
          totalCorrect++;
        } else {
          invPass = false;
        }
      }
    }
    
    invocations.push({
      index: inv,
      pass: invPass,
      outputValues: invOutputValues,
      expectedValues: invExpectedValues,
    });
  }
  
  return {
    pass: totalCorrect === totalExpected,
    invocations,
    totalExpected,
    totalCorrect,
  };
}
