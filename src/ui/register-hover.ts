// ── Register values for the editor's hovers while debugging ──

import { tokenize, TokenType } from '../assembler/lexer';
import { registerOf } from '../assembler/parser';
import { GPUState } from '../emulator/state';
import {
  EXEC_LO, NULL_REG, SGPR_MAX, SRC_EXECZ, SRC_SCC, SRC_VCCZ, TTMP_MAX, TTMP_MIN, VCC_LO, WAVE_WIDTH,
} from '../isa/constants';
import { f16ToF32, f32ToF16 } from '../isa/float16';

/** The register named at `column` (1-based) of a source line: its token's text and the columns it spans (end exclusive). */
export function registerAt(lineText: string, column: number): { name: string; start: number; end: number } | null {
  for (const token of tokenize(lineText)) {
    if (token.type === TokenType.REGISTER && token.column <= column && column < token.end) {
      return { name: token.value, start: token.column, end: token.end };
    }
  }
  return null;
}

/**
 * Markdown showing what register `name` (a register token's text) holds now, in `lane` for VGPRs,
 * or null if it holds nothing to show (null, or not a register).
 */
export function registerValueHover(state: GPUState, name: string, lane: number): string | null {
  const ref = registerOf(name);
  if (!ref) return null;
  const title = `**${name}**`;

  if (ref.kind === 'v') {
    const regs = Array.from({ length: ref.count }, (_, i) => ref.index + i);
    const active = ((state.exec >>> lane) & 1) === 1;
    return `${title} · lane ${lane}${active ? '' : ' · inactive in EXEC'}\n\n` +
      valueBlock(regs.map(r => `v${r}`), regs.map(r => state.readVGPR_u32(r, lane)));
  }

  switch (ref.index) {
    case NULL_REG: return null;
    case SRC_SCC: return `${title} = ${state.scc}`;
    case SRC_VCCZ: return `${title} = ${state.vcc === 0 ? 1 : 0}`;
    case SRC_EXECZ: return `${title} = ${state.exec === 0 ? 1 : 0}`;
  }

  // Lane masks: vcc and exec (their _lo halves alone too)
  if (ref.index === VCC_LO || ref.index === EXEC_LO) {
    const base = ref.index === VCC_LO ? 'vcc' : 'exec';
    const mask = state.readSGPR(ref.index);
    const lines = [`${base}_lo ${hex(mask)}`];
    if (ref.count > 1) lines.push(`${base}_hi ${hex(state.readSGPR(ref.index + 1))}`);
    lines.push(`${popcount(mask)} of ${WAVE_WIDTH} lanes ${base === 'exec' ? 'active' : 'set'}`);
    return `${title} · lane ${lane}: ${(mask >>> lane) & 1}\n\n${codeBlock(lines)}`;
  }

  const regs = Array.from({ length: ref.count }, (_, i) => ref.index + i);
  const names = regs.map(r => r <= SGPR_MAX ? `s${r}` : r >= TTMP_MIN && r <= TTMP_MAX ? `ttmp${r - TTMP_MIN}` : name);
  return `${title}\n\n${valueBlock(names, regs.map(r => state.readSGPR(r)))}`;
}

/** A value in every form it is read as: one register (32 bits), a pair (64), or each register of a longer range. */
function valueBlock(names: string[], words: number[]): string {
  if (words.length === 1) {
    const w = words[0];
    return codeBlock([
      `hex ${hex(w)}`,
      `u32 ${w >>> 0}`,
      `i32 ${w | 0}`,
      `f32 ${shortestFloat(f32Of(w), Math.fround, 9)}`,
      `f16 lo ${f16Text(w & 0xFFFF)}, hi ${f16Text(w >>> 16)}`,
    ]);
  }
  if (words.length === 2) {
    const bits = (BigInt(words[1] >>> 0) << 32n) | BigInt(words[0] >>> 0);
    return codeBlock([
      `hex 0x${bits.toString(16).padStart(16, '0')}`,
      `u64 ${bits}`,
      `i64 ${BigInt.asIntN(64, bits)}`,
      `f64 ${shortestFloat(f64Of(words[0], words[1]), x => x, 17)}`,
    ]);
  }
  const width = Math.max(...names.map(n => n.length));
  return codeBlock(words.map((w, i) => `${names[i].padEnd(width)} ${hex(w)} ${shortestFloat(f32Of(w), Math.fround, 9)}`));
}

function codeBlock(lines: string[]): string {
  return '```\n' + lines.join('\n') + '\n```';
}

function hex(word: number): string {
  return '0x' + (word >>> 0).toString(16).padStart(8, '0');
}

function popcount(word: number): number {
  let n = 0;
  for (let lane = 0; lane < 32; lane++) n += (word >>> lane) & 1;
  return n;
}

const f32Buf = new Float32Array(1);
const u32Buf = new Uint32Array(f32Buf.buffer);
const f64View = new DataView(new ArrayBuffer(8));

function f32Of(word: number): number {
  u32Buf[0] = word;
  return f32Buf[0];
}

function f64Of(lo: number, hi: number): number {
  f64View.setUint32(0, lo >>> 0, true);
  f64View.setUint32(4, hi >>> 0, true);
  return f64View.getFloat64(0, true);
}

function f16Text(bits: number): string {
  return shortestFloat(f16ToF32(bits), x => f16ToF32(f32ToF16(x)), 5);
}

/** The shortest decimal that `round` (to the value's precision) reads back as `value`, which needs at most `maxDigits`. */
function shortestFloat(value: number, round: (x: number) => number, maxDigits: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  let x = value;
  for (let digits = 1; digits <= maxDigits; digits++) {
    x = Number(value.toPrecision(digits));
    if (round(x) === value) break;
  }
  const text = String(x);
  return /^-?\d+$/.test(text) ? `${text}.0` : text;
}
