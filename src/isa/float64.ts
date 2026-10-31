// ── Exact 64-bit float helpers ──
// JS numbers are IEEE doubles, so +, ×, / and √ already round correctly. These helpers add what JS lacks:
// a fused multiply-add, power-of-two scaling that rounds subnormal results once, frexp, round to nearest
// even, the 2/π table read by v_trig_preop_f64 and the division helpers' special cases.

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

export function f64ToBits(v: number): bigint {
  f64[0] = v;
  return u64[0];
}

export function bitsToF64(bits: bigint): number {
  u64[0] = BigInt.asUintN(64, bits);
  return f64[0];
}

const SIGN = 1n << 63n;
const MAGNITUDE = SIGN - 1n;
const INF_BITS = 0x7FF0000000000000n;
const QUIET_BIT = 1n << 51n;

/** Biased exponent field: 0 for zeros and subnormals, 2047 for infinities and NaNs. */
export function exponentF64(v: number): number {
  return Number((f64ToBits(v) >> 52n) & 0x7FFn);
}

export function isSubnormalF64(v: number): boolean {
  return v !== 0 && Math.abs(v) < 2 ** -1022;
}

/** A finite double as (-1)^neg × mant × 2^exp with an integer mantissa. */
function decompose(v: number): { neg: boolean; mant: bigint; exp: number } {
  const bits = f64ToBits(v);
  const field = Number((bits >> 52n) & 0x7FFn);
  const frac = bits & ((1n << 52n) - 1n);
  return { neg: bits >= SIGN, mant: field === 0 ? frac : frac | (1n << 52n), exp: (field === 0 ? 1 : field) - 1075 };
}

function bitLength(v: bigint): number {
  return v === 0n ? 0 : v.toString(2).length;
}

/**
 * The double nearest to ±mant × 2^exp (ties to even). Results below the normal range round once into the
 * subnormals; too-large ones overflow to infinity.
 */
export function roundF64(neg: boolean, mant: bigint, exp: number): number {
  const sign = neg ? SIGN : 0n;
  if (mant === 0n) return bitsToF64(sign);
  const top = exp + bitLength(mant) - 1; // exponent of the leading bit
  if (top > 1023) return bitsToF64(sign | INF_BITS);
  if (top < -1076) return bitsToF64(sign); // less than half the smallest subnormal
  let quantum = Math.max(top - 52, -1074); // weight of the result's last bit
  let m: bigint;
  if (quantum <= exp) {
    m = mant << BigInt(exp - quantum);
  } else {
    const shift = BigInt(quantum - exp);
    m = mant >> shift;
    const rem = mant & ((1n << shift) - 1n);
    const half = 1n << (shift - 1n);
    if (rem > half || (rem === half && (m & 1n) === 1n)) m += 1n;
  }
  if (m === 1n << 53n) {
    m >>= 1n;
    quantum += 1;
  }
  if (m < 1n << 52n) return bitsToF64(sign | m); // subnormal (quantum is 2^-1074)
  const field = BigInt(quantum + 1075);
  if (field >= 2047n) return bitsToF64(sign | INF_BITS);
  return bitsToF64(sign | (field << 52n) | (m - (1n << 52n)));
}

/**
 * Fused multiply-add with a single rounding: a × b + c, optionally times 2^scale before that rounding
 * (V_DIV_FMAS_F64's fused rescale).
 */
export function fmaF64(a: number, b: number, c: number, scale = 0): number {
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) return NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    const p = a * b; // ±Infinity, or NaN for ∞ × 0
    return Number.isFinite(c) || c === p ? p : NaN; // ∞ - ∞ is NaN
  }
  if (!Number.isFinite(c)) return c;
  const x = decompose(a);
  const y = decompose(b);
  const z = decompose(c);
  const pNeg = x.neg !== y.neg;
  const pMant = x.mant * y.mant;
  const pExp = x.exp + y.exp;
  if (pMant === 0n && z.mant === 0n) return pNeg && z.neg ? -0 : 0;
  const e = Math.min(pExp, z.exp);
  const sum = (pNeg ? -pMant : pMant) * (1n << BigInt(pExp - e)) + (z.neg ? -z.mant : z.mant) * (1n << BigInt(z.exp - e));
  if (sum === 0n) return 0; // an exact cancellation is +0 when rounding to nearest
  return roundF64(sum < 0n, sum < 0n ? -sum : sum, e + scale);
}

/** v × 2^n, rounded once (±0, ±∞ and NaN are unchanged). */
export function ldexpF64(v: number, n: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const d = decompose(v);
  return roundF64(d.neg, d.mant, d.exp + n);
}

/** Split v into a significand in [0.5, 1) with v's sign and an exponent (±0, ±∞ and NaN: v and 0). */
export function frexpF64(v: number): { mant: number; exp: number } {
  if (v === 0 || !Number.isFinite(v)) return { mant: v, exp: 0 };
  const d = decompose(v);
  const len = bitLength(d.mant); // subnormals are normalized
  return { mant: roundF64(d.neg, d.mant, -len), exp: d.exp + len };
}

/** Round to the nearest integer, ties to even, keeping the sign of zero (exact for every double). */
export function rndneF64(v: number): number {
  if (!Number.isFinite(v) || Math.abs(v) >= 2 ** 52) return v; // already an integer (or ±∞ / NaN)
  const t = Math.trunc(v);
  const frac = Math.abs(v - t); // exact
  const r = frac > 0.5 || (frac === 0.5 && Math.abs(t) % 2 === 1) ? t + Math.sign(v) : t;
  return r === 0 ? (v < 0 || Object.is(v, -0) ? -0 : 0) : r;
}

let twoOverPi: bigint | undefined;

/**
 * floor(2/π × 2^1201): the table V_TRIG_PREOP_F64 reads, whose bit 1200 is the first fractional bit of
 * 2/π. Computed once from π by Machin's formula, π/4 = 4·atan(1/5) - atan(1/239), with 64 guard bits.
 */
export function twoOverPiTable(): bigint {
  if (twoOverPi === undefined) {
    const P = 1201n + 64n;
    const one = 1n << P;
    const atanInverse = (x: bigint): bigint => {
      let sum = 0n;
      let power = one / x;
      for (let k = 0n; power !== 0n; k++) {
        sum += (k % 2n === 0n ? power : -power) / (2n * k + 1n);
        power /= x * x;
      }
      return sum;
    };
    const pi = 4n * (4n * atanInverse(5n) - atanInverse(239n));
    twoOverPi = ((2n << (2n * P)) / pi) >> 64n;
  }
  return twoOverPi;
}

/**
 * V_TRIG_PREOP_F64: 53 bits of 2/π starting at fractional bit 53 × segment, moved further right by the
 * amount src0's exponent exceeds 1077, scaled to their place value. That scaling is an ldexp, so a result
 * in the subnormal range is rounded to nearest even (always down, as bit 1075 of 2/π is 0).
 */
export function trigPreopF64(v: number, segment: number): number {
  const field = exponentF64(v);
  let shift = (segment & 31) * 53;
  if (field > 1077) shift += field - 1077;
  const table = twoOverPiTable();
  const window = shift <= 1148 ? table >> BigInt(1148 - shift) : table << BigInt(shift - 1148);
  let scale = -53 - shift;
  if (field >= 1968) scale += 128; // keeps the segments of huge inputs out of the subnormal range
  return roundF64(false, window & ((1n << 53n) - 1n), scale);
}

/**
 * V_DIV_SCALE_F64 (s0 is either the denominator or the numerator): s0 scaled so that the division's
 * Newton-Raphson steps avoid subnormals, and whether V_DIV_FMAS_F64 must rescale the quotient.
 */
export function divScaleF64(s0: number, den: number, num: number): { value: number; vcc: boolean } {
  // Hardware sets VCC here; the ISA documents leave it clear
  if (num === 0 || den === 0) return { value: NaN, vcc: true };
  const expNum = exponentF64(num);
  const expDen = exponentF64(den);
  // A huge quotient: scale the denominator up
  if (expNum - expDen >= 768) return { value: s0 === den ? ldexpF64(s0, 128) : s0, vcc: true };
  if (isSubnormalF64(den)) return { value: ldexpF64(s0, 128), vcc: false };
  const tinyRcp = isSubnormalF64(1 / den);
  const tinyQuotient = isSubnormalF64(num / den);
  // A huge denominator and a subnormal quotient: scale the denominator down. The ISA documents say up
  // (2^+128), which would overflow a denominator above 2^1022 and break the division.
  if (tinyRcp && tinyQuotient) return { value: s0 === den ? ldexpF64(s0, -128) : s0, vcc: true };
  if (tinyRcp) return { value: ldexpF64(s0, -128), vcc: false };
  // A subnormal quotient: scale the numerator up
  if (tinyQuotient) return { value: s0 === num ? ldexpF64(s0, 128) : s0, vcc: true };
  if (expNum <= 53) return { value: ldexpF64(s0, 128), vcc: false }; // tiny numerator: scale both
  return { value: s0, vcc: false };
}

/**
 * V_DIV_FMAS_F64's rescale when VCC is set: 2^128 when |s2| ≥ 2 (a huge quotient computed with a scaled
 * denominator), otherwise 2^-128 (a subnormal quotient computed with a scaled numerator). The ISA documents
 * say 2^64 in both cases, which does not undo V_DIV_SCALE_F64; this follows measured hardware behaviour.
 */
export function divFmasScale(s2: number): number {
  return exponentF64(s2) > 1023 ? 128 : -128;
}

/** V_DIV_FIXUP_F64 on bit patterns: the quotient's final sign and the special cases of numerator / denominator. */
export function divFixupF64(quotient: bigint, den: bigint, num: bigint): bigint {
  const signOut = (den ^ num) & SIGN;
  const isNaN = (b: bigint) => (b & MAGNITUDE) > INF_BITS;
  const isInf = (b: bigint) => (b & MAGNITUDE) === INF_BITS;
  const isZero = (b: bigint) => (b & MAGNITUDE) === 0n;
  if (isNaN(num)) return num | QUIET_BIT;
  if (isNaN(den)) return den | QUIET_BIT;
  if ((isZero(den) && isZero(num)) || (isInf(den) && isInf(num))) return 0xFFF8000000000000n; // 0/0, ∞/∞
  if (isZero(den) || isInf(num)) return signOut | INF_BITS; // x/0, ∞/y
  if (isInf(den) || isZero(num)) return signOut; // x/∞, 0/y
  const expNum = Number((num >> 52n) & 0x7FFn);
  const expDen = Number((den >> 52n) & 0x7FFn);
  if (expNum - expDen < -1075) return signOut; // underflows to ±0
  // A NaN quotient means the scaled steps overflowed: the ISA documents return it, hardware returns ±∞
  if (isNaN(quotient)) return signOut | INF_BITS;
  return signOut | (quotient & MAGNITUDE);
}
