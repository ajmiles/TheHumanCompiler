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

    for (let idx = 0; idx < decoded.length; idx++) {
      const instr = decoded[idx];
      const entry = document.createElement('div');
      entry.className = 'binary-entry';

      if (idx === currentPC) {
        entry.classList.add('binary-entry--current');
      }

      // Byte address
      const addr = document.createElement('span');
      addr.className = 'binary-entry__addr';
      addr.textContent = (instr.address * 4).toString(16).padStart(3, '0');

      // All dwords for this instruction on one line
      const hex = document.createElement('span');
      hex.className = 'binary-entry__hex';

      // Determine instruction size: find next instruction's address or end of binary
      const nextAddr = (idx + 1 < decoded.length) ? decoded[idx + 1].address : binary.length;
      const words: string[] = [];
      for (let w = instr.address; w < nextAddr; w++) {
        words.push((binary[w] >>> 0).toString(16).padStart(8, '0'));
      }
      hex.textContent = words.join(' ');

      const asmEl = document.createElement('span');
      asmEl.className = 'binary-entry__asm';
      asmEl.textContent = disassemble(instr, lookupByOpcode);

      entry.append(addr, hex, asmEl);
      this.listEl.appendChild(entry);
    }
  }

  clear(): void {
    this.listEl.innerHTML = '';
  }
}
