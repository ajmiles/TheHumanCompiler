// ── IEEE 754 binary16 helpers ──

const f32Buf = new Float32Array(1);
const u32Buf = new Uint32Array(f32Buf.buffer);

/** Convert a 16-bit IEEE 754 half-precision bit pattern to a JS number. */
export function f16ToF32(h: number): number {
  const sign = (h >>> 15) & 1;
  const exp = (h >>> 10) & 0x1F;
  const frac = h & 0x3FF;

  if (exp === 0) {
    if (frac === 0) return sign ? -0 : 0;
    return (sign ? -1 : 1) * Math.pow(2, -14) * (frac / 1024);
  }
  if (exp === 0x1F) {
    if (frac === 0) return sign ? -Infinity : Infinity;
    return NaN;
  }
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

/**
 * Convert a JS number to a half-precision bit pattern.
 * The value is first rounded to single precision (the ALU computes in f32), then to f16
 * with round-to-nearest-even, or round-toward-zero when `rtz` is set.
 */
export function f32ToF16(v: number, rtz = false): number {
  f32Buf[0] = v;
  const x = u32Buf[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xFF;
  const mant = x & 0x7FFFFF;

  if (exp === 0xFF) {
    return mant !== 0 ? (sign | 0x7E00) : (sign | 0x7C00); // NaN (quiet) or ±Inf
  }

  const e = exp - 127 + 15;
  if (e >= 0x1F) {
    // Overflow: RNE saturates to infinity, RTZ to the largest finite value
    return rtz ? (sign | 0x7BFF) : (sign | 0x7C00);
  }

  if (e <= 0) {
    // Subnormal half (or zero)
    if (e < -10) return sign;
    const m = mant | 0x800000;
    const shift = 14 - e;
    let half = m >>> shift;
    if (!rtz) {
      const rem = m & ((1 << shift) - 1);
      const halfway = 1 << (shift - 1);
      if (rem > halfway || (rem === halfway && (half & 1))) half++;
    }
    return sign | half;
  }

  let half = (e << 10) | (mant >>> 13);
  if (!rtz) {
    const rem = mant & 0x1FFF;
    if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) half++; // may carry into exponent → Inf
  }
  return sign | half;
}
