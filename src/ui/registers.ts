// ── Register File Visualization ──

import { GPUState } from '../emulator/state';
import { WAVE_WIDTH } from '../isa/constants';

const f32Buf = new Float32Array(1);
const u32Buf = new Uint32Array(f32Buf.buffer);

function floatToHex(val: number): string {
  f32Buf[0] = val;
  return '0x' + (u32Buf[0] >>> 0).toString(16).padStart(8, '0');
}

function formatFloat(val: number, full: boolean): string {
  if (full) {
    // Show enough digits to distinguish any f32 value
    const s = val.toPrecision(9);
    // Trim trailing zeros after decimal point but keep at least one
    return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '.0');
  }
  return val.toFixed(2);
}

export class RegisterDisplay {
  private container: HTMLElement;
  private showHex = false;
  private sgprShowHex = true;  // SGPRs default to hex
  private vgprScrollWrapper!: HTMLElement;
  private sgprList!: HTMLElement;
  private specialRegsEl!: HTMLElement;
  private maxVgpr = 0;
  private maxSgpr = -1;
  private lastState: GPUState | null = null;
  private fullPrecisionLanes = new Set<number>();
  private transposed = true; // default: rows=lanes, cols=registers

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('register-panel');
    this.buildStructure();
  }

  setUsedVGPRs(maxIndex: number): void {
    this.maxVgpr = maxIndex;
  }

  setUsedSGPRs(maxIndex: number): void {
    this.maxSgpr = maxIndex;
  }

  private buildStructure(): void {
    // VGPR section
    const vgprSection = document.createElement('div');
    vgprSection.className = 'register-section';

    const vgprHeader = document.createElement('div');
    vgprHeader.className = 'register-section__header';

    const vgprLabel = document.createElement('span');
    vgprLabel.textContent = 'VGPRs';

    const headerRight = document.createElement('div');
    headerRight.style.display = 'flex';
    headerRight.style.gap = '8px';
    headerRight.style.alignItems = 'center';

    // Float/Hex toggle
    const toggle = document.createElement('div');
    toggle.className = 'format-toggle';

    const floatBtn = document.createElement('button');
    floatBtn.className = 'format-toggle__btn format-toggle__btn--active';
    floatBtn.textContent = 'F32';
    floatBtn.onclick = () => {
      this.showHex = false;
      floatBtn.classList.add('format-toggle__btn--active');
      hexBtn.classList.remove('format-toggle__btn--active');
      this.rerender();
    };

    const hexBtn = document.createElement('button');
    hexBtn.className = 'format-toggle__btn';
    hexBtn.textContent = 'HEX';
    hexBtn.onclick = () => {
      this.showHex = true;
      hexBtn.classList.add('format-toggle__btn--active');
      floatBtn.classList.remove('format-toggle__btn--active');
      this.rerender();
    };

    toggle.append(floatBtn, hexBtn);

    // Transpose toggle
    const transposeBtn = document.createElement('button');
    transposeBtn.className = 'format-toggle__btn format-toggle__btn--active';
    transposeBtn.textContent = '⇄';
    transposeBtn.title = 'Toggle layout: rows=lanes vs rows=registers';
    transposeBtn.onclick = () => {
      this.transposed = !this.transposed;
      this.fullPrecisionLanes.clear();
      this.rerender();
    };

    headerRight.append(toggle, transposeBtn);
    vgprHeader.append(vgprLabel, headerRight);
    vgprSection.appendChild(vgprHeader);

    this.vgprScrollWrapper = document.createElement('div');
    this.vgprScrollWrapper.className = 'vgpr-scroll-wrapper';
    vgprSection.appendChild(this.vgprScrollWrapper);

    // SGPR section
    const sgprSection = document.createElement('div');
    sgprSection.className = 'register-section';

    const sgprHeader = document.createElement('div');
    sgprHeader.className = 'register-section__header';

    const sgprLabel = document.createElement('span');
    sgprLabel.textContent = 'SGPRs';

    const sgprHeaderRight = document.createElement('div');
    sgprHeaderRight.style.display = 'flex';
    sgprHeaderRight.style.gap = '8px';
    sgprHeaderRight.style.alignItems = 'center';

    const sgprToggle = document.createElement('div');
    sgprToggle.className = 'format-toggle';

    const sgprUintBtn = document.createElement('button');
    sgprUintBtn.className = 'format-toggle__btn';
    sgprUintBtn.textContent = 'UINT';
    sgprUintBtn.onclick = () => {
      this.sgprShowHex = false;
      sgprUintBtn.classList.add('format-toggle__btn--active');
      sgprHexBtn.classList.remove('format-toggle__btn--active');
      this.rerender();
    };

    const sgprHexBtn = document.createElement('button');
    sgprHexBtn.className = 'format-toggle__btn format-toggle__btn--active';
    sgprHexBtn.textContent = 'HEX';
    sgprHexBtn.onclick = () => {
      this.sgprShowHex = true;
      sgprHexBtn.classList.add('format-toggle__btn--active');
      sgprUintBtn.classList.remove('format-toggle__btn--active');
      this.rerender();
    };

    sgprToggle.append(sgprUintBtn, sgprHexBtn);
    sgprHeaderRight.append(sgprToggle);
    sgprHeader.append(sgprLabel, sgprHeaderRight);

    this.sgprList = document.createElement('div');
    this.sgprList.className = 'sgpr-list';

    sgprSection.append(sgprHeader, this.sgprList);

    // Special registers section
    const specialSection = document.createElement('div');
    specialSection.className = 'register-section';

    const specialHeader = document.createElement('div');
    specialHeader.className = 'register-section__header';
    specialHeader.textContent = 'Special';

    this.specialRegsEl = document.createElement('div');
    this.specialRegsEl.className = 'special-regs';

    specialSection.append(specialHeader, this.specialRegsEl);

    this.container.append(vgprSection, sgprSection, specialSection);
  }

  private pcBytes = 0;

  update(state: GPUState, pcBytes?: number): void {
    this.lastState = state;
    if (pcBytes !== undefined) this.pcBytes = pcBytes;
    this.renderVGPRs(state);
    this.renderSGPRs(state);
    this.renderSpecial(state);
  }

  private rerender(): void {
    if (this.lastState) this.update(this.lastState, this.pcBytes);
  }

  private renderVGPRs(state: GPUState): void {
    const regCount = Math.max(this.maxVgpr + 1, 1);
    const lanes = WAVE_WIDTH;

    if (this.transposed) {
      this.renderVGPRsTransposed(state, regCount, lanes);
    } else {
      this.renderVGPRsNormal(state, regCount, lanes);
    }
  }

  /** Rows = registers, Columns = lanes (original layout) */
  private renderVGPRsNormal(state: GPUState, regCount: number, lanes: number): void {
    const table = document.createElement('table');
    table.className = 'vgpr-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.className = 'vgpr-table__header-row';

    const regTh = document.createElement('th');
    regTh.textContent = 'Reg';
    headerRow.appendChild(regTh);

    for (let l = 0; l < lanes; l++) {
      const th = document.createElement('th');
      th.textContent = `L${l}`;
      th.style.cursor = 'pointer';
      th.title = this.fullPrecisionLanes.has(l)
        ? `Lane ${l}: full precision (click for 2dp)`
        : `Lane ${l}: 2dp (click for full precision)`;
      if (this.fullPrecisionLanes.has(l)) {
        th.classList.add('vgpr-table__th--full');
      }
      const lane = l;
      th.onclick = () => {
        if (this.fullPrecisionLanes.has(lane)) {
          this.fullPrecisionLanes.delete(lane);
        } else {
          this.fullPrecisionLanes.add(lane);
        }
        this.rerender();
      };
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let r = 0; r < regCount; r++) {
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = `v${r}`;
      row.appendChild(nameCell);

      const isModified = state.modifiedRegs.has(`v${r}`);

      for (let l = 0; l < lanes; l++) {
        const td = document.createElement('td');
        const val = state.readVGPR(r, l);
        const full = this.fullPrecisionLanes.has(l);
        td.textContent = this.showHex ? floatToHex(val) : formatFloat(val, full);
        if (isModified) td.classList.add('modified');
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    this.vgprScrollWrapper.replaceChildren(table);
  }

  /** Rows = lanes, Columns = registers (transposed layout) */
  private renderVGPRsTransposed(state: GPUState, regCount: number, lanes: number): void {
    const table = document.createElement('table');
    table.className = 'vgpr-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.className = 'vgpr-table__header-row';

    const laneTh = document.createElement('th');
    laneTh.textContent = 'Lane';
    headerRow.appendChild(laneTh);

    for (let r = 0; r < regCount; r++) {
      const th = document.createElement('th');
      th.textContent = `v${r}`;
      th.style.cursor = 'pointer';
      th.title = `v${r}`;
      if (state.modifiedRegs.has(`v${r}`)) {
        th.classList.add('vgpr-table__th--full');
      }
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let l = 0; l < lanes; l++) {
      const row = document.createElement('tr');
      const laneCell = document.createElement('td');
      laneCell.textContent = `L${l}`;
      row.appendChild(laneCell);

      for (let r = 0; r < regCount; r++) {
        const td = document.createElement('td');
        const val = state.readVGPR(r, l);
        td.textContent = this.showHex ? floatToHex(val) : formatFloat(val, false);
        if (state.modifiedRegs.has(`v${r}`)) td.classList.add('modified');
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    this.vgprScrollWrapper.replaceChildren(table);
  }

  private renderSGPRs(state: GPUState): void {
    this.sgprList.innerHTML = '';
    if (this.maxSgpr < 0) return; // no SGPRs used

    const count = this.maxSgpr + 1;
    for (let i = 0; i < count; i++) {
      const entry = document.createElement('div');
      entry.className = 'sgpr-entry';
      if (state.modifiedRegs.has(`s${i}`)) entry.classList.add('modified');

      const name = document.createElement('span');
      name.className = 'sgpr-entry__name';
      name.textContent = `s${i}`;

      const rawVal = state.readSGPR(i) >>> 0;
      const val = document.createElement('span');
      val.className = 'sgpr-entry__value';
      val.textContent = this.sgprShowHex
        ? '0x' + rawVal.toString(16).padStart(8, '0')
        : rawVal.toString();

      entry.append(name, val);
      this.sgprList.appendChild(entry);
    }
  }

  private _pulseTarget: string | undefined;

  private renderSpecial(state: GPUState): void {
    this.specialRegsEl.innerHTML = '';
    const regs: [string, string][] = [
      ['EXEC', '0x' + (state.exec >>> 0).toString(16).padStart(8, '0')],
      ['VCC', '0x' + (state.vcc >>> 0).toString(16).padStart(8, '0')],
      ['SCC', state.scc.toString()],
      ['PC', '0x' + this.pcBytes.toString(16).padStart(3, '0')],
    ];

    for (const [name, value] of regs) {
      const el = document.createElement('div');
      el.className = 'special-reg';
      if (name === this._pulseTarget) el.classList.add('special-reg--pulse');

      const nameEl = document.createElement('span');
      nameEl.className = 'special-reg__name';
      nameEl.textContent = name;

      const valEl = document.createElement('span');
      valEl.className = 'special-reg__value';
      valEl.textContent = value;

      el.append(nameEl, valEl);
      this.specialRegsEl.appendChild(el);
    }
  }

  /** Pulse a special register row to draw attention (e.g. 'SCC', 'EXEC'). */
  pulseSpecial(name: string | undefined): void {
    this._pulseTarget = name;
    // Apply immediately to current DOM
    this.specialRegsEl.querySelectorAll('.special-reg').forEach(el => {
      const div = el as HTMLElement;
      div.classList.toggle('special-reg--pulse', div.dataset.regName === name);
    });
  }
}
