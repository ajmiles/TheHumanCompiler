// ── Hardware runs: hashes ──
// Identify a puzzle's data and a solution's machine code, so a measurement only stands while both are unchanged.
// The app sends the puzzle hash with each submission; the devkit checks it against the puzzles it has.

import { Puzzle, PuzzlePort } from '../puzzle/types';

/** The puzzle id of a job for a program with no inputs or outputs. */
export const SANDBOX = 'sandbox';

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** The bits a puzzle value has in a register, as the app writes it. */
export function valueBits(value: number, isInteger?: boolean): number {
  if (isInteger) return value >>> 0;
  f32[0] = value;
  return u32[0];
}

/** FNV-1a (64-bit) of a string's UTF-16 code units, as 16 hex digits. */
export function hash64(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) h = BigInt.asUintN(64, (h ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n);
  return h.toString(16).padStart(16, '0');
}

/** Identifies a puzzle's data: a measurement only stands while the puzzle stays the same. */
export function puzzleHash(puzzle: Puzzle | null): string {
  if (!puzzle) return hash64(SANDBOX);
  const port = (p: PuzzlePort) =>
    [p.register, p.isSGPR ? 's' : 'v', p.isInteger ? 'u' : 'f', ...p.values.map(v => valueBits(v, p.isInteger || p.isSGPR).toString(16))].join(',');
  return hash64([puzzle.id, ...puzzle.inputs.map(port), '|', ...puzzle.outputs.map(port)].join(';'));
}

/** Identifies a solution's machine code. */
export function codeHash(binary: Uint32Array): string {
  return hash64(Array.from(binary, w => w.toString(16)).join(','));
}
