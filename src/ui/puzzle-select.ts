// ── Puzzle Selection Overlay ──

import { Puzzle } from '../puzzle/types';

export class PuzzleSelect {
  private container: HTMLElement;
  private overlay: HTMLElement;
  private grid: HTMLElement;
  private selectCb: ((puzzleId: string) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.overlay = document.createElement('div');
    this.overlay.className = 'puzzle-overlay puzzle-overlay--hidden';

    this.grid = document.createElement('div');
    this.grid.className = 'puzzle-grid';

    this.overlay.appendChild(this.grid);
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

  show(puzzles: Puzzle[], completedIds: Set<string>): void {
    this.grid.innerHTML = '';

    for (const puzzle of puzzles) {
      const card = document.createElement('div');
      card.className = 'puzzle-card';
      if (completedIds.has(puzzle.id)) card.classList.add('puzzle-card--completed');

      const title = document.createElement('div');
      title.className = 'puzzle-card__title';
      title.textContent = puzzle.title;

      const desc = document.createElement('div');
      desc.className = 'puzzle-card__desc';
      desc.textContent = puzzle.description.slice(0, 120) +
        (puzzle.description.length > 120 ? '…' : '');

      card.append(title, desc);

      // Badge
      const badge = document.createElement('div');
      badge.className = 'puzzle-card__badge';
      if (completedIds.has(puzzle.id)) {
        badge.classList.add('puzzle-card__badge--completed');
        badge.textContent = '✓ Completed';
      } else {
        badge.classList.add('puzzle-card__badge--new');
        badge.textContent = 'New';
      }
      card.appendChild(badge);

      card.onclick = () => {
        this.selectCb?.(puzzle.id);
        this.hide();
      };

      this.grid.appendChild(card);
    }

    this.overlay.classList.remove('puzzle-overlay--hidden');
  }

  hide(): void {
    this.overlay.classList.add('puzzle-overlay--hidden');
  }

  onSelect(cb: (puzzleId: string) => void): void {
    this.selectCb = cb;
  }
}
