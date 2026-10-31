// ── Engine fixes for the hardware verifier ──
// Imported first by verifier.ts, so it runs before any other module of the bundle. Some QuickJS builds get
// BigInt.asUintN wrong (quickjs-ng 0.32 returns a negative number when the result's top bit is set, or for a
// negative input), and the emulator relies on it for every 64-bit operation. Where the engine gets it wrong, put in
// versions built on &, which is right everywhere.

const asUintN = (bits: number, value: bigint): bigint => value & ((1n << BigInt(bits)) - 1n);

if (BigInt.asUintN(64, -1n) !== 0xFFFFFFFFFFFFFFFFn || BigInt.asUintN(32, -5n) !== 0xFFFFFFFBn) {
  BigInt.asUintN = asUintN;
}
if (BigInt.asIntN(64, 0xFFFFFFFFFFFFFFFFn) !== -1n || BigInt.asIntN(32, 0x80000000n) !== -0x80000000n) {
  BigInt.asIntN = (bits: number, value: bigint): bigint => {
    const u = asUintN(bits, value);
    return bits > 0 && u >> BigInt(bits - 1) !== 0n ? u - (1n << BigInt(bits)) : u;
  };
}

export {};
