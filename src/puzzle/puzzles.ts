// ── Built-in Puzzle Definitions ──

import { Puzzle } from './types';

// Generate deterministic float streams for puzzles
function generateStream(count: number, fn: (i: number) => number): number[] {
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    result.push(fn(i));
  }
  return result;
}

// Seed-based pseudo-random for repeatable puzzle data
function seededValues(seed: number, count: number, min: number, max: number): number[] {
  let s = seed;
  const next = () => {
    s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
    return min + (s / 0x7FFFFFFF) * (max - min);
  };
  return generateStream(count, () => Math.round(next() * 100) / 100);
}

// ── Puzzle 1: Signal Boost ──

const signalBoostInput = seededValues(42, 64, 0, 10);
const signalBoostExpected = signalBoostInput.map(v => v * 2);

const SIGNAL_BOOST: Puzzle = {
  id: 'signal-boost',
  title: 'Signal Boost',
  description:
    'Amplify the incoming signal. Read each value from the input stream and ' +
    'multiply it by 2.0, then write the result to the output.',
  inputs: [
    { name: 'Input', register: 0, values: signalBoostInput },
  ],
  outputs: [
    { name: 'Output', register: 1, values: signalBoostExpected },
  ],
  hints: [
    'You can use inline float constants like 2.0 directly as an operand.',
    'Only one instruction is needed!',
  ],
  optimalInstructions: 1,
};

// ── Puzzle 2: Merge Streams ──

const mergeInputA = seededValues(101, 64, -5, 5);
const mergeInputB = seededValues(202, 64, -5, 5);
const mergeExpected = mergeInputA.map((v, i) => {
  const f32 = new Float32Array(1);
  f32[0] = v + mergeInputB[i];
  return f32[0];
});

const MERGE_STREAMS: Puzzle = {
  id: 'merge-streams',
  title: 'Merge Streams',
  description:
    'Two data streams arrive simultaneously. Add them together element-wise ' +
    'and write the combined result to the output.',
  inputs: [
    { name: 'Input A', register: 0, values: mergeInputA },
    { name: 'Input B', register: 1, values: mergeInputB },
  ],
  outputs: [
    { name: 'Output', register: 2, values: mergeExpected },
  ],
  hints: [
    'v_add_f32 takes two source operands and writes to a destination.',
    'Think about which registers your inputs arrive in.',
  ],
  optimalInstructions: 1,
};

// ── Puzzle 3: Absolute Value ──

const absInput = seededValues(303, 64, -10, 10);
const absExpected = absInput.map(v => Math.abs(v));

const ABSOLUTE_VALUE: Puzzle = {
  id: 'absolute-value',
  title: 'Absolute Value',
  description:
    'Compute the absolute value of each input. Negative values become positive; ' +
    'positive values stay the same. Think creatively with the instructions available!',
  inputs: [
    { name: 'Input', register: 0, values: absInput },
  ],
  outputs: [
    { name: 'Output', register: 1, values: absExpected },
  ],
  hints: [
    'There is no v_abs instruction in the MVP set.',
    'Can you negate a value by subtracting from zero?',
    'v_max_f32 picks the larger of two values...',
  ],
  optimalInstructions: 2,
};

// ── Puzzle 4: Euclidean Distance ──

const distInputX1 = seededValues(404, 64, -5, 5);
const distInputY1 = seededValues(505, 64, -5, 5);
const distInputX2 = seededValues(606, 64, -5, 5);
const distInputY2 = seededValues(707, 64, -5, 5);
const distExpected = distInputX1.map((x1, i) => {
  const f32 = new Float32Array(1);
  const dx = x1 - distInputX2[i];
  const dy = distInputY1[i] - distInputY2[i];
  // Match f32 precision: compute each step through Float32Array
  const f32dx2 = new Float32Array(1);
  const f32dy2 = new Float32Array(1);
  f32dx2[0] = dx * dx;
  f32dy2[0] = dy * dy;
  const f32sum = new Float32Array(1);
  f32sum[0] = f32dx2[0] + f32dy2[0];
  f32[0] = Math.sqrt(f32sum[0]);
  return f32[0];
});

const EUCLIDEAN_DISTANCE: Puzzle = {
  id: 'euclidean-distance',
  title: 'Euclidean Distance',
  description:
    'Compute the 2D Euclidean distance between two points (x1,y1) and (x2,y2). ' +
    'The formula is: √((x1-x2)² + (y1-y2)²). You have four input streams.',
  inputs: [
    { name: 'X1', register: 0, values: distInputX1 },
    { name: 'Y1', register: 1, values: distInputY1 },
    { name: 'X2', register: 2, values: distInputX2 },
    { name: 'Y2', register: 3, values: distInputY2 },
  ],
  outputs: [
    { name: 'Distance', register: 4, values: distExpected },
  ],
  hints: [
    'Start by computing the differences: dx = x1-x2, dy = y1-y2.',
    'Square each difference, then add them together.',
    'v_sqrt_f32 computes the square root of a single source.',
    'You can reuse temporary registers for intermediate values.',
  ],
  optimalInstructions: 6,
};

// ── Puzzle 5: Quadratic Polynomial ──
// Evaluate ax² + bx + c using Horner's method or direct expansion
// Direct: mul x*x, mul a*x², mul b*x, add a*x²+b*x, add +c → 5 instrs with Horner: (a*x+b)*x+c
// But with 3 coefficients in separate regs it's trickier. Let's do full expansion = 8 instrs.
// Actually Horner's: t=a*x, t=t+b, t=t*x, t=t+c = 4 instrs. Too easy.
// Let's make it harder: compute BOTH roots of ax²+bx+c=0 using the quadratic formula.
// That's: (-b ± sqrt(b²-4ac)) / (2a)
// This is genuinely ~8-10 instructions.

// Actually let's do: "Smooth Clamp" — smoothstep(edge0, edge1, x)
// smoothstep = t*t*(3-2t) where t = clamp((x-edge0)/(edge1-edge0), 0, 1)
// Steps: sub, sub, rcp, mul, max(0), min(1), sub(3-2t), mul, mul = ~9 instrs
// That's a nice GPU-relevant function!

const ssEdge0 = seededValues(808, 64, 0, 2);
const ssEdge1Fixed = seededValues(809, 64, 3, 6); // ensure edge1 > edge0
const ssInput = seededValues(810, 64, -1, 8);

// Compute expected with f32 precision at each step
const ssExpected = ssInput.map((x, i) => {
  const e0 = ssEdge0[i];
  const e1 = ssEdge1Fixed[i];
  const f = new Float32Array(1);

  // t = (x - edge0) / (edge1 - edge0)
  f[0] = x - e0;
  const num = f[0];
  f[0] = e1 - e0;
  const den = f[0];
  f[0] = 1.0 / den;
  const rcpDen = f[0];
  f[0] = num * rcpDen;
  let t = f[0];

  // clamp to [0, 1]
  t = Math.max(0, t);
  t = Math.min(1, t);

  // smoothstep: t * t * (3 - 2*t)
  f[0] = 2.0 * t;
  const twoT = f[0];
  f[0] = 3.0 - twoT;
  const threeMinus2t = f[0];
  f[0] = t * t;
  const tSq = f[0];
  f[0] = tSq * threeMinus2t;
  return f[0];
});

const SMOOTH_CLAMP: Puzzle = {
  id: 'smooth-clamp',
  title: 'Smooth Clamp',
  description:
    'Implement the smoothstep function — a classic GPU interpolation curve. ' +
    'Given edge0, edge1, and x: compute t = clamp((x-edge0)/(edge1-edge0), 0, 1), ' +
    'then return t²·(3 - 2t). This produces a smooth S-curve between 0 and 1.',
  inputs: [
    { name: 'Edge0', register: 0, values: ssEdge0 },
    { name: 'Edge1', register: 1, values: ssEdge1Fixed },
    { name: 'X', register: 2, values: ssInput },
  ],
  outputs: [
    { name: 'Result', register: 3, values: ssExpected },
  ],
  hints: [
    'First compute (x - edge0) and (edge1 - edge0).',
    'Use v_rcp_f32 to get 1/(edge1-edge0), then multiply to divide.',
    'Clamp t to [0,1] using v_max_f32 with 0 and v_min_f32 with 1.0.',
    'The final polynomial is t*t*(3.0 - 2.0*t).',
    'Inline constants 0, 1.0, 2.0, and 3.0 are all available!',
  ],
  optimalInstructions: 10,
};

// ── Puzzle 6: Reflect Vector ──
// Reflect 2D vector V off surface with normal N: R = V - 2·(V·N)·N
// Inputs: Vx(v0), Vy(v1), Nx(v2), Ny(v3)
// dot = Vx*Nx + Vy*Ny          (2 muls + 1 add = 3)
// scale = 2 * dot               (1 mul = 4)
// Rx = Vx - scale*Nx            (1 mul + 1 sub = 6)
// Ry = Vy - scale*Ny            (1 mul + 1 sub = 8)
// But we can use v_mul_f32 with inline 2.0 and v_subrev to save.
// Actually: mul, mul, add, mul(2.0), mul, sub, mul, sub = 8 instrs
// Or with fused: mul, mul, add, add(self for *2), mul, sub, mul, sub = 8
// Let's aim for 10 by also requiring normalized output: Rx/len, Ry/len
// R = V - 2(V·N)N, then normalize: len = sqrt(Rx²+Ry²), out = R/len
// That adds: mul, mul, add, sqrt, rcp, mul, mul = 7 more → too many.
// Let's just do reflect without normalize = ~8, but require two outputs.
// To get to 10, let's add: also output the dot product as a 3rd output.
// Or: do 3D reflection. V=(v0,v1,v2), N=(v3,v4,v5), output R=(v6,v7,v8)
// dot = v0*v3 + v1*v4 + v2*v5 (5 ops: mul,mul,mul,add,add)
// scale = 2*dot (1 op: mul)
// Rx = v0 - scale*v3 (2 ops: mul,sub)
// Ry = v1 - scale*v4 (2 ops: mul,sub)
// Rz = v2 - scale*v5 (2 ops: mul,sub)
// Total: 5+1+6 = 12. A bit much. Let's stick to 2D but also output the angle.
// Actually, 2D reflect is elegant at 8. Let me just do it cleanly.

const refVx = seededValues(901, 64, -5, 5);
const refVy = seededValues(902, 64, -5, 5);
// Generate unit normals for realistic reflection
const refAngles = seededValues(903, 64, 0, 6.28);
const refNx = refAngles.map(a => { const f = new Float32Array(1); f[0] = Math.cos(a); return f[0]; });
const refNy = refAngles.map(a => { const f = new Float32Array(1); f[0] = Math.sin(a); return f[0]; });

// R = V - 2(V·N)N computed with f32 precision
const refExpectedX = refVx.map((vx, i) => {
  const f = new Float32Array(1);
  const vy = refVy[i], nx = refNx[i], ny = refNy[i];
  // dot = vx*nx + vy*ny
  f[0] = vx * nx; const t1 = f[0];
  f[0] = vy * ny; const t2 = f[0];
  f[0] = t1 + t2; const dot = f[0];
  // scale = 2 * dot
  f[0] = 2.0 * dot; const scale = f[0];
  // Rx = vx - scale*nx
  f[0] = scale * nx; const sn = f[0];
  f[0] = vx - sn;
  return f[0];
});
const refExpectedY = refVx.map((vx, i) => {
  const f = new Float32Array(1);
  const vy = refVy[i], nx = refNx[i], ny = refNy[i];
  f[0] = vx * nx; const t1 = f[0];
  f[0] = vy * ny; const t2 = f[0];
  f[0] = t1 + t2; const dot = f[0];
  f[0] = 2.0 * dot; const scale = f[0];
  // Ry = vy - scale*ny
  f[0] = scale * ny; const sn = f[0];
  f[0] = vy - sn;
  return f[0];
});

const REFLECT_VECTOR: Puzzle = {
  id: 'reflect-vector',
  title: 'Reflect Vector',
  description:
    'Compute the reflection of a 2D velocity vector V off a surface with normal N. ' +
    'The reflection formula is: R = V - 2·(V·N)·N. ' +
    'Output both the reflected X and Y components.',
  inputs: [
    { name: 'Vx', register: 0, values: refVx },
    { name: 'Vy', register: 1, values: refVy },
    { name: 'Nx', register: 2, values: refNx },
    { name: 'Ny', register: 3, values: refNy },
  ],
  outputs: [
    { name: 'Rx', register: 4, values: refExpectedX },
    { name: 'Ry', register: 5, values: refExpectedY },
  ],
  hints: [
    'First compute the dot product: dot = Vx·Nx + Vy·Ny.',
    'Multiply dot by 2.0 (inline constant available).',
    'Then: Rx = Vx - (2·dot)·Nx and Ry = Vy - (2·dot)·Ny.',
    'v_sub_f32 computes dst = src0 - vsrc1.',
    'The dot product result is scalar-like but still per-lane in a VGPR.',
  ],
  optimalInstructions: 8,
};

// ── Puzzle 7: Dot Product 3D ──
// Compute dot(A, B) = Ax*Bx + Ay*By + Az*Bz
// With v_fma_f32: mul, fma, fma = 3 instructions optimal
// Without: mul, mul, mul, add, add = 5 instructions

const dot3Ax = seededValues(1001, 64, -3, 3);
const dot3Ay = seededValues(1002, 64, -3, 3);
const dot3Az = seededValues(1003, 64, -3, 3);
const dot3Bx = seededValues(1004, 64, -3, 3);
const dot3By = seededValues(1005, 64, -3, 3);
const dot3Bz = seededValues(1006, 64, -3, 3);
const dot3Expected = dot3Ax.map((ax, i) => {
  const f = new Float32Array(1);
  f[0] = ax * dot3Bx[i];
  const t1 = f[0];
  f[0] = dot3Ay[i] * dot3By[i] + t1;
  const t2 = f[0];
  f[0] = dot3Az[i] * dot3Bz[i] + t2;
  return f[0];
});

const DOT_PRODUCT_3D: Puzzle = {
  id: 'dot-product-3d',
  title: 'Dot Product 3D',
  description:
    'Compute the 3D dot product of two vectors A and B: ' +
    'result = Ax·Bx + Ay·By + Az·Bz. This is one of the most fundamental ' +
    'operations in computer graphics — used for lighting, projections, and more.',
  inputs: [
    { name: 'Ax', register: 0, values: dot3Ax },
    { name: 'Ay', register: 1, values: dot3Ay },
    { name: 'Az', register: 2, values: dot3Az },
    { name: 'Bx', register: 3, values: dot3Bx },
    { name: 'By', register: 4, values: dot3By },
    { name: 'Bz', register: 5, values: dot3Bz },
  ],
  outputs: [
    { name: 'Dot', register: 6, values: dot3Expected },
  ],
  hints: [
    'The dot product is: Ax*Bx + Ay*By + Az*Bz.',
    'v_fma_f32 computes a*b+c in one instruction — perfect for accumulating.',
    'Start with v_mul_f32 for the first pair, then v_fma_f32 to accumulate the rest.',
    'Optimal solution: 3 instructions using v_fma_f32!',
  ],
  optimalInstructions: 3,
};

// ── Puzzle 8: Byte Shuffle (RGBA → BGRA) ──
// Input: packed 32-bit RGBA color (R in byte 0, G in byte 1, B in byte 2, A in byte 3)
// Output: reordered to BGRA (B in byte 0, G in byte 1, R in byte 2, A in byte 3)
// This is a real GPU task — converting texture formats!

const rgbaInput = seededValues(2001, 64, 0, 0xFFFFFFFF).map(v => Math.abs(Math.round(v)) >>> 0);
const bgraExpected = rgbaInput.map(rgba => {
  const r = rgba & 0xFF;
  const g = (rgba >>> 8) & 0xFF;
  const b = (rgba >>> 16) & 0xFF;
  const a = (rgba >>> 24) & 0xFF;
  return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
});

const BYTE_SHUFFLE: Puzzle = {
  id: 'byte-shuffle',
  title: 'Byte Shuffle (RGBA→BGRA)',
  description:
    'Convert a packed 32-bit RGBA color to BGRA format. ' +
    'Swap the R and B bytes while keeping G and A in place. ' +
    'Input: [R₇₋₀, G₁₅₋₈, B₂₃₋₁₆, A₃₁₋₂₄] → Output: [B₇₋₀, G₁₅₋₈, R₂₃₋₁₆, A₃₁₋₂₄]. ' +
    'This is a real GPU task for converting texture formats!',
  inputs: [
    { name: 'RGBA', register: 0, values: rgbaInput, isInteger: true },
  ],
  outputs: [
    { name: 'BGRA', register: 1, values: bgraExpected, isInteger: true },
  ],
  hints: [
    'You need to extract individual bytes and reassemble them.',
    'v_bfe_u32 extracts a bitfield: v_bfe_u32 vdst, src, offset, width.',
    'v_lshlrev_b32 shifts left, v_and_b32 masks bits, v_or_b32 combines.',
    'The G and A bytes stay in the same position — you can mask and keep them.',
    'Think about which bytes need to move: R (byte 0→byte 2) and B (byte 2→byte 0).',
  ],
  optimalInstructions: 7,
};

// ── All Puzzles ──

export const ALL_PUZZLES: Puzzle[] = [
  SIGNAL_BOOST,
  MERGE_STREAMS,
  ABSOLUTE_VALUE,
  EUCLIDEAN_DISTANCE,
  SMOOTH_CLAMP,
  REFLECT_VECTOR,
  DOT_PRODUCT_3D,
  BYTE_SHUFFLE,
];

export function getPuzzleById(id: string): Puzzle | undefined {
  return ALL_PUZZLES.find(p => p.id === id);
}
