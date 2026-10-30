// ── Puzzle Validator ──
// Compares actual output from emulator against expected puzzle output

import { WAVE_WIDTH } from '../isa/constants';
import { Puzzle, PuzzleCrash, PuzzleResult, InvocationResult } from './types';

const EPSILON = 0.01; // Tolerance for float comparison (~2 decimal places of f32)

function floatEquals(a: number, b: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) < EPSILON;
}

/**
 * Validate collected output against puzzle expected values.
 *
 * A run that crashed — faulted, or ran off the end without executing s_endpgm — never passes:
 * the crashed invocation and the ones after it count as wrong whatever their registers hold.
 *
 * @param puzzle - The puzzle definition
 * @param collectedOutputs - Map of register index → collected output values across all invocations
 * @param crash - Where and why the run crashed, if it did
 */
export function validatePuzzle(
  puzzle: Puzzle,
  collectedOutputs: Map<number, number[]>,
  crash?: PuzzleCrash,
): PuzzleResult {
  const invocations: InvocationResult[] = [];
  let totalExpected = 0;
  let totalCorrect = 0;
  
  // Calculate number of invocations
  const streamLength = puzzle.outputs[0]?.values.length ?? 0;
  const numInvocations = Math.ceil(streamLength / WAVE_WIDTH);
  
  for (let inv = 0; inv < numInvocations; inv++) {
    const ran = !crash || inv < crash.invocation;
    let invPass = ran;
    const invOutputValues: number[] = [];
    const invExpectedValues: number[] = [];
    
    for (const output of puzzle.outputs) {
      const collected = collectedOutputs.get(output.register) ?? [];
      const startIdx = inv * WAVE_WIDTH;
      const endIdx = Math.min(startIdx + WAVE_WIDTH, output.values.length);
      
      for (let i = startIdx; i < endIdx; i++) {
        const expected = output.values[i];
        const actual = ran && i < collected.length ? collected[i] : NaN;
        
        invExpectedValues.push(expected);
        invOutputValues.push(actual);
        totalExpected++;
        
        if (ran && floatEquals(actual, expected)) {
          totalCorrect++;
        } else {
          invPass = false;
        }
      }
    }
    
    invocations.push({
      index: inv,
      pass: invPass,
      ...(crash?.invocation === inv ? { crashed: true } : {}),
      outputValues: invOutputValues,
      expectedValues: invExpectedValues,
    });
  }
  
  return {
    pass: !crash && totalCorrect === totalExpected,
    invocations,
    totalExpected,
    totalCorrect,
    ...(crash ? { crash } : {}),
  };
}
