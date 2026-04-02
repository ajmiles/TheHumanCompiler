// ── Binary Hex Dump View ──

import { decodeBinary, disassemble } from '../isa/encoding';
import { lookupByOpcode } from '../isa/opcodes';

export class BinaryView {
  private container: HTMLElement;
  private listEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('binary-panel');

    const header = document.createElement('div');
    header.className = 'panel__header';
    header.textContent = 'Binary';

    this.listEl = document.createElement('div');
    this.listEl.className = 'binary-list';

    const scrollable = document.createElement('div');
    scrollable.className = 'panel__content';
    scrollable.appendChild(this.listEl);

    this.container.append(header, scrollable);
  }

  update(binary: Uint32Array, currentPC: number): void {
    this.listEl.innerHTML = '';

    const decoded = decodeBinary(binary);

    // Build a map from word address → decoded instruction
    const instrAtAddress = new Map<number, ReturnType<typeof decodeBinary>[number]>();
    for (const instr of decoded) {
      instrAtAddress.set(instr.address, instr);
    }

    // Render each word
    for (let i = 0; i < binary.length; i++) {
      const entry = document.createElement('div');
      entry.className = 'binary-entry';

      // Check if this word is the current PC's instruction
      const instr = instrAtAddress.get(i);
      const instrIdx = instr ? decoded.indexOf(instr) : -1;
      if (instrIdx === currentPC) {
        entry.classList.add('binary-entry--current');
      }

      const addr = document.createElement('span');
      addr.className = 'binary-entry__addr';
      addr.textContent = i.toString(16).padStart(4, '0');

      const hex = document.createElement('span');
      hex.className = 'binary-entry__hex';
      hex.textContent = '0x' + (binary[i] >>> 0).toString(16).padStart(8, '0');

      const asmEl = document.createElement('span');
      asmEl.className = 'binary-entry__asm';

      if (instr) {
        asmEl.textContent = disassemble(instr, lookupByOpcode);
      }

      entry.append(addr, hex, asmEl);
      this.listEl.appendChild(entry);
    }
  }

  clear(): void {
    this.listEl.innerHTML = '';
  }
}
