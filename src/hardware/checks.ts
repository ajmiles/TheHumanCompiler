// ── Hardware runs: what can't be timed on the devkit ──
// A solution reaches the devkit only once it passes in the emulator, so on hardware it takes the same path. These
// are the instructions and registers that behave differently there, and could send it elsewhere.

import { TTMP_MAX, TTMP_MIN } from '../isa/constants';
import { lookupByMnemonic } from '../isa/opcodes';
import { operandRegCount, OperandRole } from '../isa/operands';
import { InstructionFormat, Operand, OperandType, ParsedInstruction } from '../isa/types';

/** Formats the emulator runs and the devkit can too (memory instructions other than LDS don't assemble). */
const RUNNABLE = new Set<InstructionFormat>([
  InstructionFormat.SOP1, InstructionFormat.SOP2, InstructionFormat.SOPC, InstructionFormat.SOPK, InstructionFormat.SOPP,
  InstructionFormat.VOP1, InstructionFormat.VOP2, InstructionFormat.VOPC, InstructionFormat.VOP3, InstructionFormat.VOP3P,
  InstructionFormat.DS,
]);

/** Program-counter instructions: on the devkit the code is somewhere else, so the addresses differ from the emulator's. */
const PROGRAM_ADDRESSES = new Set(['s_getpc_b64', 's_setpc_b64', 's_swappc_b64']);

/** Why a solution can't be timed on the devkit, one reason per instruction (none when it can). */
export function hardwareProblems(instructions: readonly ParsedInstruction[]): string[] {
  const problems: string[] = [];
  for (const instr of instructions) {
    const at = `Line ${instr.line}: ${instr.mnemonic}`;
    const info = lookupByMnemonic(instr.mnemonic);
    if (!info || !RUNNABLE.has(info.format)) {
      problems.push(`${at} can't run on the devkit`);
      continue;
    }
    if (PROGRAM_ADDRESSES.has(info.mnemonic)) {
      problems.push(`${at} uses program addresses, which are different on the devkit`);
      continue;
    }
    if (info.mnemonic === 's_setreg_imm32_b32') {
      problems.push(`${at} changes hardware state that the emulator doesn't model`);
      continue;
    }
    const operands: [OperandRole | null, Operand | undefined][] = [
      ['dst', instr.dst], ['src0', instr.src0], ['src1', instr.src1], ['src2', instr.src2], [null, instr.sdst],
    ];
    const ttmp = operands.some(([role, op]) => {
      if (op?.type !== OperandType.SPECIAL) return false;
      const last = op.value + Math.max(op.regCount ?? 1, role ? operandRegCount(info, role) : 1) - 1;
      return op.value <= TTMP_MAX && last >= TTMP_MIN;
    });
    if (ttmp) problems.push(`${at} uses a ttmp register, which belongs to the trap handler on the devkit`);
  }
  return problems;
}
