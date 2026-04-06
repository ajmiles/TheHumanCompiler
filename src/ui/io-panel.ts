// ── Input/Output Stream Display ──
// Unified table: one row per stream index, columns for all inputs, expected, actual

import { Puzzle, PuzzleResult } from '../puzzle/types';
import { WAVE_WIDTH } from '../isa/constants';

export type IOFormat = 'f32' | 'f16' | 'u32' | 'i32' | 'u16' | 'i16' | 'hex';

export class IOPanel {
  private container: HTMLElement;
  private infoEl!: HTMLElement;
  private tableWrapper!: HTMLElement;
  private invocationBar!: HTMLElement;
  private formatToggle!: HTMLElement;
  private hintsVisible = false;
  private currentPuzzle: Puzzle | null = null;
  private format: IOFormat = 'f32';
  private lastCollectedOutputs: Map<number, number[]> | null = null;
  private lastInvocation = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('puzzle-panel');
    this.buildStructure();
  }

  private buildStructure(): void {
    this.infoEl = document.createElement('div');
    this.infoEl.className = 'puzzle-info';

    this.formatToggle = document.createElement('div');
    this.formatToggle.className = 'format-toggle';
    this.formatToggle.style.margin = '4px 8px';
    this.formatToggle.style.display = 'none'; // hidden until puzzle loaded
    this.buildFormatToggle();

    this.tableWrapper = document.createElement('div');
    this.tableWrapper.className = 'io-table-wrapper';

    this.invocationBar = document.createElement('div');
    this.invocationBar.className = 'invocation-bar';

    this.container.append(this.infoEl, this.formatToggle, this.tableWrapper, this.invocationBar);
  }

  private buildFormatToggle(): void {
    this.formatToggle.innerHTML = '';
    const modes: Array<{ id: IOFormat; label: string }> = [
      { id: 'f32', label: 'F32' }, { id: 'f16', label: 'F16' },
      { id: 'u32', label: 'U32' }, { id: 'i32', label: 'I32' },
      { id: 'u16', label: 'U16' }, { id: 'i16', label: 'I16' },
      { id: 'hex', label: 'HEX' },
    ];
    for (const m of modes) {
      const btn = document.createElement('button');
      btn.className = 'format-toggle__btn' + (m.id === this.format ? ' format-toggle__btn--active' : '');
      btn.textContent = m.label;
      btn.onclick = () => {
        this.format = m.id;
        this.buildFormatToggle();
        if (this.currentPuzzle) {
          this.renderTable(this.currentPuzzle, this.lastCollectedOutputs, this.lastInvocation);
        }
      };
      this.formatToggle.appendChild(btn);
    }
  }

  clearPuzzle(): void {
    this.currentPuzzle = null;
    this.infoEl.innerHTML = '';
    this.tableWrapper.innerHTML = '';
    this.invocationBar.innerHTML = '';
    this.formatToggle.style.display = 'none';
  }

  setPuzzle(puzzle: Puzzle): void {
    this.currentPuzzle = puzzle;
    this.hintsVisible = false;
    this.lastCollectedOutputs = null;
    this.lastInvocation = 0;

    // Auto-set format based on puzzle data types
    const hasInteger = puzzle.inputs.some(i => i.isInteger && !i.isSGPR) ||
                       puzzle.outputs.some(o => o.isInteger);
    this.format = hasInteger ? 'u32' : 'f32';
    this.formatToggle.style.display = '';
    this.buildFormatToggle();

    // Info
    this.infoEl.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'puzzle-info__title';
    title.textContent = puzzle.title;

    const desc = document.createElement('div');
    desc.className = 'puzzle-info__desc';
    desc.textContent = puzzle.description;

    this.infoEl.append(title, desc);

    if (puzzle.hints.length > 0) {
      const hintToggle = document.createElement('div');
      hintToggle.className = 'puzzle-info__hint';
      hintToggle.style.cursor = 'pointer';
      hintToggle.textContent = '💡 Show hints';
      hintToggle.onclick = () => {
        this.hintsVisible = !this.hintsVisible;
        hintsContainer.style.display = this.hintsVisible ? 'block' : 'none';
        hintToggle.textContent = this.hintsVisible ? '💡 Hide hints' : '💡 Show hints';
      };

      const hintsContainer = document.createElement('div');
      hintsContainer.style.display = 'none';
      for (const hint of puzzle.hints) {
        const h = document.createElement('div');
        h.className = 'puzzle-info__hint';
        h.textContent = `→ ${hint}`;
        hintsContainer.appendChild(h);
      }

      this.infoEl.append(hintToggle, hintsContainer);
    }

    this.renderTable(puzzle, null, 0);
    this.renderInvocationBar(0, puzzle);
  }

  updateOutput(
    collectedOutputs: Map<number, number[]>,
    currentInvocation: number,
  ): void {
    if (!this.currentPuzzle) return;
    this.lastCollectedOutputs = collectedOutputs;
    this.lastInvocation = currentInvocation;
    this.renderTable(this.currentPuzzle, collectedOutputs, currentInvocation);
    this.renderInvocationBar(currentInvocation, this.currentPuzzle);
  }

  showResult(result: PuzzleResult): void {
    const dots = this.invocationBar.querySelectorAll('.invocation-dot');
    for (const inv of result.invocations) {
      if (inv.index < dots.length) {
        dots[inv.index].className = 'invocation-dot ' +
          (inv.pass ? 'invocation-dot--done' : 'invocation-dot--fail');
      }
    }
  }

  private renderTable(
    puzzle: Puzzle,
    collectedOutputs: Map<number, number[]> | null,
    currentInvocation: number,
  ): void {
    const vgprInputs = puzzle.inputs.filter(i => !i.isSGPR);
    const streamLen = vgprInputs[0]?.values.length ?? puzzle.outputs[0]?.values.length ?? 0;
    const inputs = vgprInputs;
    const outputs = puzzle.outputs;
    const chunkStart = currentInvocation * WAVE_WIDTH;
    const chunkEnd = chunkStart + WAVE_WIDTH;

    const table = document.createElement('table');
    table.className = 'io-table';

    // Header row
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    const thIdx = document.createElement('th');
    thIdx.textContent = '#';
    headerRow.appendChild(thIdx);

    for (const inp of inputs) {
      const th = document.createElement('th');
      th.className = 'io-table__input-header';
      th.textContent = `v${inp.register}`;
      th.title = inp.name;
      headerRow.appendChild(th);
    }

    // Separator
    const thSep = document.createElement('th');
    thSep.className = 'io-table__separator';
    thSep.textContent = '│';
    headerRow.appendChild(thSep);

    for (const out of outputs) {
      const thExp = document.createElement('th');
      thExp.className = 'io-table__expected-header';
      thExp.textContent = `exp`;
      thExp.title = `${out.name} (v${out.register}) — Expected`;
      headerRow.appendChild(thExp);

      const thAct = document.createElement('th');
      thAct.className = 'io-table__actual-header';
      thAct.textContent = `v${out.register}`;
      thAct.title = `${out.name} (v${out.register}) — Actual`;
      headerRow.appendChild(thAct);

      const thSt = document.createElement('th');
      thSt.className = 'io-table__status-header';
      thSt.textContent = '';
      headerRow.appendChild(thSt);
    }

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    let lastVisibleRow: HTMLElement | null = null;

    for (let i = 0; i < streamLen; i++) {
      const row = document.createElement('tr');

      // Row highlighting based on invocation chunk
      if (i >= chunkStart && i < chunkEnd) {
        row.classList.add('io-table__row--current');
      } else if (i < chunkStart) {
        row.classList.add('io-table__row--consumed');
      }

      // Index
      const tdIdx = document.createElement('td');
      tdIdx.className = 'io-table__idx';
      tdIdx.textContent = `${i}`;
      row.appendChild(tdIdx);

      // Input values
      for (const inp of inputs) {
        const td = document.createElement('td');
        td.className = 'io-table__input';
        td.textContent = formatValueAs(inp.values[i], this.format, inp.isInteger);
        row.appendChild(td);
      }

      // Separator
      const tdSep = document.createElement('td');
      tdSep.className = 'io-table__separator';
      tdSep.textContent = '│';
      row.appendChild(tdSep);

      // Output values (expected + actual + status per output port)
      for (const out of outputs) {
        const exp = out.values[i];
        const collected = collectedOutputs?.get(out.register);
        const hasActual = collected !== undefined && i < collected.length;
        const act = hasActual ? collected[i] : NaN;
        const match = hasActual && (out.isInteger
          ? (act >>> 0) === (exp >>> 0)
          : Math.abs(act - exp) < 0.01);

        const tdExp = document.createElement('td');
        tdExp.className = 'io-table__expected';
        tdExp.textContent = formatValueAs(exp, this.format, out.isInteger);
        row.appendChild(tdExp);

        const tdAct = document.createElement('td');
        tdAct.textContent = hasActual ? formatValueAs(act, this.format, out.isInteger) : '—';
        if (!hasActual) {
          tdAct.className = 'io-table__actual io-table__actual--pending';
        } else if (match) {
          tdAct.className = 'io-table__actual io-table__actual--match';
        } else {
          tdAct.className = 'io-table__actual io-table__actual--mismatch';
        }
        row.appendChild(tdAct);

        const tdSt = document.createElement('td');
        tdSt.className = 'io-table__status';
        if (hasActual) {
          tdSt.textContent = match ? '✓' : '✗';
          tdSt.classList.add(match ? 'io-table__status--match' : 'io-table__status--mismatch');
        }
        row.appendChild(tdSt);

        if (hasActual) lastVisibleRow = row;
      }

      tbody.appendChild(row);
    }

    table.appendChild(tbody);
    this.tableWrapper.replaceChildren(table);

    // Auto-scroll to latest actual value
    if (lastVisibleRow) {
      lastVisibleRow.scrollIntoView({ block: 'nearest' });
    }
  }

  private renderInvocationBar(current: number, puzzle: Puzzle): void {
    const streamLen = puzzle.outputs[0]?.values.length ?? 0;
    const numInvocations = Math.ceil(streamLen / WAVE_WIDTH);

    this.invocationBar.innerHTML = '';

    const label = document.createElement('span');
    label.textContent = `Invocation ${current + 1} / ${numInvocations}`;

    const progress = document.createElement('div');
    progress.className = 'invocation-bar__progress';

    for (let i = 0; i < numInvocations; i++) {
      const dot = document.createElement('div');
      dot.className = 'invocation-dot';
      if (i < current) dot.classList.add('invocation-dot--done');
      if (i === current) dot.classList.add('invocation-dot--current');
      progress.appendChild(dot);
    }

    this.invocationBar.append(label, progress);
  }
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

const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

function formatValueAs(val: number, format: IOFormat, isInteger?: boolean): string {
  if (Number.isNaN(val)) return 'NaN';

  // For integer ports, val is already a raw u32
  const raw = isInteger ? (val >>> 0) : (() => { _f32[0] = val; return _u32[0]; })();

  switch (format) {
    case 'hex':
      return '0x' + (raw >>> 0).toString(16).padStart(8, '0');
    case 'u32':
      return (raw >>> 0).toString();
    case 'i32':
      return (raw | 0).toString();
    case 'u16': {
      const lo = raw & 0xFFFF;
      const hi = (raw >>> 16) & 0xFFFF;
      return `${lo}, ${hi}`;
    }
    case 'i16': {
      const lo = ((raw & 0xFFFF) << 16) >> 16;
      const hi = (raw >> 16);
      return `${lo}, ${hi}`;
    }
    case 'f16': {
      const lo = f16ToF32(raw & 0xFFFF);
      const hi = f16ToF32((raw >>> 16) & 0xFFFF);
      return `${lo.toPrecision(4)}, ${hi.toPrecision(4)}`;
    }
    case 'f32':
    default:
      if (isInteger) {
        // Show raw u32 as float interpretation
        _u32[0] = raw;
        const f = _f32[0];
        if (Number.isInteger(f)) return f.toFixed(1);
        return f.toFixed(2);
      }
      if (Number.isInteger(val)) return val.toFixed(1);
      return val.toFixed(2);
  }
}
