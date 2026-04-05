import { getAllOpcodes } from './src/isa/opcodes';
import { InstructionFormat } from './src/isa/types';

const all = getAllOpcodes();
const counts: Record<string, number> = {};
for (const op of all) {
  counts[op.format] = (counts[op.format] || 0) + 1;
}
console.log('=== Current instruction count by format ===');
for (const [fmt, count] of Object.entries(counts).sort()) {
  console.log(fmt + ': ' + count);
}
console.log('TOTAL:', all.length);
