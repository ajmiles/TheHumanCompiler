// ── Binary Hex Dump View ──

import { decodeBinary, disassemble } from '../isa/encoding';
import { lookupByOpcode } from '../isa/opcodes';

export class BinaryView {
  private container: HTMLElement;
  private listEl: HTMLElement;
  private scrollable: HTMLElement;
  private toggleBtn: HTMLButtonElement;
  private collapsed = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('binary-panel');

    const header = document.createElement('div');
    header.className = 'panel__header';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.cursor = 'pointer';

    const label = document.createElement('span');
    label.textContent = 'Binary';

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.className = 'binary-toggle';
    this.toggleBtn.textContent = '▼';
    this.toggleBtn.title = 'Collapse binary view';

    header.append(label, this.toggleBtn);
    header.onclick = () => this.toggle();

    this.listEl = document.createElement('div');
    this.listEl.className = 'binary-list';

    this.scrollable = document.createElement('div');
    this.scrollable.className = 'panel__content';
    this.scrollable.appendChild(this.listEl);

    this.container.append(header, this.scrollable);
  }

  private toggle(): void {
    this.collapsed = !this.collapsed;
    this.applyCollapsed();
  }

  private applyCollapsed(): void {
    this.scrollable.style.display = this.collapsed ? 'none' : '';
    this.toggleBtn.textContent = this.collapsed ? '▶' : '▼';
    this.toggleBtn.title = this.collapsed ? 'Expand binary view' : 'Collapse binary view';
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.applyCollapsed();
  }

  update(binary: Uint32Array, currentPC: number): void {
    this.listEl.innerHTML = '';

    const decoded = decodeBinary(binary);

    // Compute max dwords per instruction to size the hex column
    let maxWords = 1;
    for (let idx = 0; idx < decoded.length; idx++) {
      const nextAddr = (idx + 1 < decoded.length) ? decoded[idx + 1].address : binary.length;
      maxWords = Math.max(maxWords, nextAddr - decoded[idx].address);
    }
    // Each dword = 8 hex chars + 1 space separator. Width in ch units.
    const hexWidthCh = maxWords * 9 - 1;

    for (let idx = 0; idx < decoded.length; idx++) {
      const instr = decoded[idx];
      const entry = document.createElement('div');
      entry.className = 'binary-entry';

      if (idx === currentPC) {
        entry.classList.add('binary-entry--current');
      }

      const addr = document.createElement('span');
      addr.className = 'binary-entry__addr';
      addr.textContent = (instr.address * 4).toString(16).padStart(3, '0');

      const hex = document.createElement('span');
      hex.className = 'binary-entry__hex';
      hex.style.width = `${hexWidthCh}ch`;
      hex.style.minWidth = `${hexWidthCh}ch`;

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
