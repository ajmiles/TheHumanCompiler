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
    const s = val.toPrecision(9);
    return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '.0');
  }
  return val.toFixed(2);
}

/** Convert a 16-bit IEEE 754 half-precision float to a JS number. */
function f16ToF32(h: number): number {
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

function formatF16(bits: number): string {
  const v = f16ToF32(bits);
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? 'Inf' : '-Inf';
  if (v === 0) return '0.00';
  return v.toPrecision(4);
}

export class RegisterDisplay {
  private container: HTMLElement;
  private vgprMode: 'f32' | 'hex' | 'u32' | 'i32' | 'f16' | 'u16' | 'i16' = 'f32';
  private _updateVgprToggle: (() => void) | null = null;
  private sgprMode: 'hex' | 'uint' | 'f32' = 'hex';
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

  /** Set the VGPR display mode programmatically (e.g. when loading a puzzle). */
  setVGPRMode(mode: 'f32' | 'hex' | 'u32' | 'i32' | 'f16' | 'u16' | 'i16'): void {
    this.vgprMode = mode;
    this._updateVgprToggle?.();
  }

  private buildStructure(): void {
    // VGPR section
    const vgprSection = document.createElement('div');
    vgprSection.className = 'register-section';

    const vgprHeader = document.createElement('div');
    vgprHeader.className = 'register-section__header';

    const vgprLabel = document.createElement('span');
    vgprLabel.textContent = 'VGPRs';

    vgprHeader.appendChild(vgprLabel);
    vgprSection.appendChild(vgprHeader);

    // VGPR format toggle — 4x2 grid with transpose button
    const toggleGrid = document.createElement('div');
    toggleGrid.className = 'format-toggle';
    toggleGrid.style.display = 'grid';
    toggleGrid.style.gridTemplateColumns = 'repeat(4, 1fr)';
    toggleGrid.style.gap = '2px';
    toggleGrid.style.margin = '4px 8px';

    type VgprMode = 'f32' | 'hex' | 'u32' | 'i32' | 'f16' | 'u16' | 'i16';
    // Row 1: U32 I32 HEX [Transpose]
    // Row 2: F32 F16 U16 I16
    const row1: Array<{ id: VgprMode; label: string } | 'transpose'> = [
      { id: 'u32', label: 'U32' },
      { id: 'i32', label: 'I32' },
      { id: 'hex', label: 'HEX' },
      'transpose',
    ];
    const row2: Array<{ id: VgprMode; label: string }> = [
      { id: 'f32', label: 'F32' },
      { id: 'f16', label: 'F16' },
      { id: 'u16', label: 'U16' },
      { id: 'i16', label: 'I16' },
    ];

    const modeBtns: HTMLButtonElement[] = [];
    const modes: Array<{ id: VgprMode; label: string }> = [];

    // Transpose button
    const transposeBtn = document.createElement('button');
    transposeBtn.className = 'format-toggle__btn format-toggle__btn--active';
    transposeBtn.textContent = '⇄';
    transposeBtn.title = 'Toggle layout: rows=lanes vs rows=registers';
    transposeBtn.onclick = () => {
      this.transposed = !this.transposed;
      this.fullPrecisionLanes.clear();
      this.rerender();
    };

    for (const item of [...row1, ...row2]) {
      if (item === 'transpose') {
        toggleGrid.appendChild(transposeBtn);
      } else {
        const m = item;
        modes.push(m);
        const btn = document.createElement('button');
        btn.className = 'format-toggle__btn' + (m.id === 'f32' ? ' format-toggle__btn--active' : '');
        btn.textContent = m.label;
        btn.onclick = () => { this.vgprMode = m.id; updateVgprToggle(); };
        modeBtns.push(btn);
        toggleGrid.appendChild(btn);
      }
    }

    const updateVgprToggle = () => {
      for (let i = 0; i < modes.length; i++) {
        modeBtns[i].classList.toggle('format-toggle__btn--active', this.vgprMode === modes[i].id);
      }
      this.rerender();
    };
    this._updateVgprToggle = updateVgprToggle;

    vgprSection.appendChild(toggleGrid);

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
    sgprUintBtn.textContent = 'U32';

    const sgprHexBtn = document.createElement('button');
    sgprHexBtn.className = 'format-toggle__btn format-toggle__btn--active';
    sgprHexBtn.textContent = 'HEX';

    const sgprF32Btn = document.createElement('button');
    sgprF32Btn.className = 'format-toggle__btn';
    sgprF32Btn.textContent = 'F32';

    const updateSgprToggle = () => {
      sgprUintBtn.classList.toggle('format-toggle__btn--active', this.sgprMode === 'uint');
      sgprHexBtn.classList.toggle('format-toggle__btn--active', this.sgprMode === 'hex');
      sgprF32Btn.classList.toggle('format-toggle__btn--active', this.sgprMode === 'f32');
      this.rerender();
    };

    sgprUintBtn.onclick = () => { this.sgprMode = 'uint'; updateSgprToggle(); };
    sgprHexBtn.onclick = () => { this.sgprMode = 'hex'; updateSgprToggle(); };
    sgprF32Btn.onclick = () => { this.sgprMode = 'f32'; updateSgprToggle(); };

    sgprToggle.append(sgprUintBtn, sgprHexBtn, sgprF32Btn);
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
    const isSplit = this.vgprMode === 'f16' || this.vgprMode === 'u16' || this.vgprMode === 'i16';
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
      if (isSplit) {
        // Two rows per register: v0.lo and v0.hi
        const isModified = state.modifiedRegs.has(`v${r}`);
        for (const half of ['lo', 'hi'] as const) {
          const row = document.createElement('tr');
          const nameCell = document.createElement('td');
          nameCell.textContent = `v${r}.${half}`;
          nameCell.style.fontSize = '10px';
          row.appendChild(nameCell);
          for (let l = 0; l < lanes; l++) {
            const td = document.createElement('td');
            const raw = state.readVGPR_u32(r, l);
            const bits = half === 'lo' ? (raw & 0xFFFF) : (raw >>> 16);
            td.textContent = this.format16(bits);
            if (isModified) td.classList.add('modified');
            row.appendChild(td);
          }
          tbody.appendChild(row);
        }
      } else {
        const row = document.createElement('tr');
        const nameCell = document.createElement('td');
        nameCell.textContent = `v${r}`;
        row.appendChild(nameCell);

        const isModified = state.modifiedRegs.has(`v${r}`);

        for (let l = 0; l < lanes; l++) {
          const td = document.createElement('td');
          td.textContent = this.format32(state, r, l);
          if (isModified) td.classList.add('modified');
          row.appendChild(td);
        }
        tbody.appendChild(row);
      }
    }
    table.appendChild(tbody);
    this.vgprScrollWrapper.replaceChildren(table);
  }

  /** Rows = lanes, Columns = registers (transposed layout) */
  private renderVGPRsTransposed(state: GPUState, regCount: number, lanes: number): void {
    const isSplit = this.vgprMode === 'f16' || this.vgprMode === 'u16' || this.vgprMode === 'i16';
    const table = document.createElement('table');
    table.className = 'vgpr-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.className = 'vgpr-table__header-row';

    const laneTh = document.createElement('th');
    laneTh.textContent = 'Lane';
    headerRow.appendChild(laneTh);

    for (let r = 0; r < regCount; r++) {
      if (isSplit) {
        for (const half of ['lo', 'hi'] as const) {
          const th = document.createElement('th');
          th.textContent = `v${r}.${half}`;
          th.style.fontSize = '10px';
          if (state.modifiedRegs.has(`v${r}`)) th.classList.add('vgpr-table__th--full');
          headerRow.appendChild(th);
        }
      } else {
        const th = document.createElement('th');
        th.textContent = `v${r}`;
        th.style.cursor = 'pointer';
        th.title = `v${r}`;
        if (state.modifiedRegs.has(`v${r}`)) th.classList.add('vgpr-table__th--full');
        headerRow.appendChild(th);
      }
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
        if (isSplit) {
          const raw = state.readVGPR_u32(r, l);
          for (const half of ['lo', 'hi'] as const) {
            const td = document.createElement('td');
            const bits = half === 'lo' ? (raw & 0xFFFF) : (raw >>> 16);
            td.textContent = this.format16(bits);
            if (state.modifiedRegs.has(`v${r}`)) td.classList.add('modified');
            row.appendChild(td);
          }
        } else {
          const td = document.createElement('td');
          td.textContent = this.format32(state, r, l);
          if (state.modifiedRegs.has(`v${r}`)) td.classList.add('modified');
          row.appendChild(td);
        }
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    this.vgprScrollWrapper.replaceChildren(table);
  }

  /** Format a 32-bit VGPR value based on current mode. */
  private format32(state: GPUState, reg: number, lane: number): string {
    if (this.vgprMode === 'hex') return floatToHex(state.readVGPR(reg, lane));
    if (this.vgprMode === 'u32') return (state.readVGPR_u32(reg, lane) >>> 0).toString();
    if (this.vgprMode === 'i32') return (state.readVGPR_u32(reg, lane) | 0).toString();
    return formatFloat(state.readVGPR(reg, lane), this.fullPrecisionLanes.has(lane));
  }

  /** Format a 16-bit half based on current mode (f16/u16/i16). */
  private format16(bits: number): string {
    if (this.vgprMode === 'f16') return formatF16(bits);
    if (this.vgprMode === 'u16') return (bits & 0xFFFF).toString();
    // i16: sign-extend from 16 to 32 bits
    return ((bits << 16) >> 16).toString();
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
      if (this.sgprMode === 'hex') {
        val.textContent = '0x' + rawVal.toString(16).padStart(8, '0');
      } else if (this.sgprMode === 'f32') {
        const f32 = new Float32Array(1);
        const u32 = new Uint32Array(f32.buffer);
        u32[0] = rawVal;
        val.textContent = f32[0].toPrecision(6);
      } else {
        val.textContent = rawVal.toString();
      }

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
      ['EXECZ', state.exec === 0 ? '1' : '0'],
      ['VCCZ', state.vcc === 0 ? '1' : '0'],
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
