// ── Input/Output Stream Display ──
// Unified table: one row per stream index, columns for all inputs, expected, actual

import { Puzzle, PuzzleResult } from '../puzzle/types';
import { WAVE_WIDTH } from '../isa/constants';

export class IOPanel {
  private container: HTMLElement;
  private infoEl!: HTMLElement;
  private tableWrapper!: HTMLElement;
  private invocationBar!: HTMLElement;
  private hintsVisible = false;
  private currentPuzzle: Puzzle | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('puzzle-panel');
    this.buildStructure();
  }

  private buildStructure(): void {
    this.infoEl = document.createElement('div');
    this.infoEl.className = 'puzzle-info';

    this.tableWrapper = document.createElement('div');
    this.tableWrapper.className = 'io-table-wrapper';

    this.invocationBar = document.createElement('div');
    this.invocationBar.className = 'invocation-bar';

    this.container.append(this.infoEl, this.tableWrapper, this.invocationBar);
  }

  setPuzzle(puzzle: Puzzle): void {
    this.currentPuzzle = puzzle;
    this.hintsVisible = false;

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
        td.textContent = formatValue(inp.values[i], inp.isInteger);
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
        tdExp.textContent = formatValue(exp, out.isInteger);
        row.appendChild(tdExp);

        const tdAct = document.createElement('td');
        tdAct.textContent = hasActual ? formatValue(act, out.isInteger) : '—';
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

function formatValue(val: number, isInteger?: boolean): string {
  if (Number.isNaN(val)) return 'NaN';
  if (isInteger) return (val >>> 0).toString();
  if (Number.isInteger(val)) return val.toFixed(1);
  return val.toFixed(2);
}
