// ── Puzzle & Tutorial Selection Overlay ──

import { Puzzle } from '../puzzle/types';
import { Tutorial } from '../puzzle/tutorials';

export class PuzzleSelect {
  private container: HTMLElement;
  private overlay: HTMLElement;
  private content: HTMLElement;
  private selectCb: ((id: string, kind: 'puzzle' | 'tutorial') => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.overlay = document.createElement('div');
    this.overlay.className = 'puzzle-overlay puzzle-overlay--hidden';

    this.content = document.createElement('div');
    this.content.className = 'puzzle-select-content';

    this.overlay.appendChild(this.content);
    this.container.appendChild(this.overlay);

    // Escape to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });

    // Click backdrop to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  show(
    puzzles: Puzzle[],
    tutorials: Tutorial[],
    completedIds: Set<string>,
  ): void {
    this.content.innerHTML = '';

    // Title
    const heading = document.createElement('div');
    heading.className = 'puzzle-select__heading';
    heading.textContent = 'HUMAN COMPILER';
    this.content.appendChild(heading);

    // ── Tutorials section ──
    if (tutorials.length > 0) {
      const tutSection = document.createElement('div');
      tutSection.className = 'puzzle-select__section';

      const tutLabel = document.createElement('div');
      tutLabel.className = 'puzzle-select__section-label';
      tutLabel.textContent = '── TUTORIALS ──';
      tutSection.appendChild(tutLabel);

      const tutRow = document.createElement('div');
      tutRow.className = 'puzzle-select__tutorial-row';

      tutorials.forEach((tut, i) => {
        const card = document.createElement('div');
        card.className = 'puzzle-card puzzle-card--compact puzzle-card--tutorial';
        if (completedIds.has(tut.id)) card.classList.add('puzzle-card--completed');

        const number = document.createElement('span');
        number.className = 'puzzle-card__number puzzle-card__number--tutorial';
        number.textContent = `T${i + 1}`;

        const title = document.createElement('div');
        title.className = 'puzzle-card__title puzzle-card__title--compact';
        title.textContent = tut.title;

        const desc = document.createElement('div');
        desc.className = 'puzzle-card__desc puzzle-card__desc--compact';
        desc.textContent = tut.description.slice(0, 80) +
          (tut.description.length > 80 ? '…' : '');

        if (completedIds.has(tut.id)) {
          const badge = document.createElement('span');
          badge.className = 'puzzle-card__badge puzzle-card__badge--completed';
          badge.textContent = '✓';
          card.appendChild(badge);
        }

        card.append(number, title, desc);
        card.onclick = () => {
          this.selectCb?.(tut.id, 'tutorial');
          this.hide();
        };
        tutRow.appendChild(card);
      });

      tutSection.appendChild(tutRow);
      this.content.appendChild(tutSection);
    }

    // ── Puzzles section ──
    const puzSection = document.createElement('div');
    puzSection.className = 'puzzle-select__section';

    const puzLabel = document.createElement('div');
    puzLabel.className = 'puzzle-select__section-label';
    puzLabel.textContent = '── PUZZLES ──';
    puzSection.appendChild(puzLabel);

    const puzGrid = document.createElement('div');
    puzGrid.className = 'puzzle-grid';

    puzzles.forEach((puzzle, i) => {
      const card = document.createElement('div');
      card.className = 'puzzle-card puzzle-card--compact';
      if (completedIds.has(puzzle.id)) card.classList.add('puzzle-card--completed');

      const number = document.createElement('span');
      number.className = 'puzzle-card__number';
      number.textContent = `P${i + 1}`;

      const title = document.createElement('div');
      title.className = 'puzzle-card__title puzzle-card__title--compact';
      title.textContent = puzzle.title;

      const desc = document.createElement('div');
      desc.className = 'puzzle-card__desc puzzle-card__desc--compact';
      desc.textContent = puzzle.description.slice(0, 80) +
        (puzzle.description.length > 80 ? '…' : '');

      const meta = document.createElement('div');
      meta.className = 'puzzle-card__meta';

      const optBadge = document.createElement('span');
      optBadge.className = 'puzzle-card__optimal';
      optBadge.textContent = `${puzzle.optimalInstructions} instr`;
      optBadge.title = 'Optimal instruction count';
      meta.appendChild(optBadge);

      if (completedIds.has(puzzle.id)) {
        const badge = document.createElement('span');
        badge.className = 'puzzle-card__badge puzzle-card__badge--completed';
        badge.textContent = '✓ Completed';
        meta.appendChild(badge);
      } else {
        const badge = document.createElement('span');
        badge.className = 'puzzle-card__badge puzzle-card__badge--new';
        badge.textContent = 'New';
        meta.appendChild(badge);
      }

      card.append(number, title, desc, meta);
      card.onclick = () => {
        this.selectCb?.(puzzle.id, 'puzzle');
        this.hide();
      };
      puzGrid.appendChild(card);
    });

    puzSection.appendChild(puzGrid);
    this.content.appendChild(puzSection);

    this.overlay.classList.remove('puzzle-overlay--hidden');
  }

  hide(): void {
    this.overlay.classList.add('puzzle-overlay--hidden');
  }

  onSelect(cb: (id: string, kind: 'puzzle' | 'tutorial') => void): void {
    this.selectCb = cb;
  }
}
