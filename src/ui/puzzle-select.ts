// ── Level Selection Overlay ──
// Shows tutorials and puzzles in a single ordered list.

import { Puzzle } from '../puzzle/types';
import { Tutorial } from '../puzzle/tutorials';

export type LevelItem =
  | { kind: 'tutorial'; data: Tutorial }
  | { kind: 'puzzle'; data: Puzzle };

export class PuzzleSelect {
  private overlay: HTMLElement;
  private content: HTMLElement;
  private selectCb: ((id: string, kind: 'puzzle' | 'tutorial') => void) | null = null;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'puzzle-overlay puzzle-overlay--hidden';

    this.content = document.createElement('div');
    this.content.className = 'puzzle-select-content';

    this.overlay.appendChild(this.content);
    container.appendChild(this.overlay);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  show(levels: LevelItem[], completedIds: Set<string>): void {
    this.content.innerHTML = '';

    // Title
    const heading = document.createElement('div');
    heading.className = 'level-select__heading';
    heading.textContent = '⚡ HUMAN COMPILER';
    this.content.appendChild(heading);

    const subtitle = document.createElement('div');
    subtitle.className = 'level-select__subtitle';
    subtitle.textContent = 'AMD RDNA2 Shader Puzzles';
    this.content.appendChild(subtitle);

    // Level list
    const list = document.createElement('div');
    list.className = 'level-list';

    let levelNum = 1;
    for (const level of levels) {
      const isTutorial = level.kind === 'tutorial';
      const id = isTutorial ? level.data.id : level.data.id;
      const title = isTutorial ? level.data.title : level.data.title;
      const desc = isTutorial
        ? (level.data as Tutorial).description
        : (level.data as Puzzle).description;
      const completed = completedIds.has(id);

      const row = document.createElement('div');
      row.className = 'level-row';
      if (isTutorial) row.classList.add('level-row--tutorial');
      if (completed) row.classList.add('level-row--completed');
      row.onclick = () => {
        this.selectCb?.(id, level.kind);
        this.hide();
      };

      // Number badge
      const numBadge = document.createElement('span');
      numBadge.className = 'level-row__num';
      if (isTutorial) numBadge.classList.add('level-row__num--tutorial');
      numBadge.textContent = `${levelNum}`;

      // Title
      const titleEl = document.createElement('span');
      titleEl.className = 'level-row__title';
      titleEl.textContent = title;

      // Type tag
      const tag = document.createElement('span');
      tag.className = 'level-row__tag';
      if (isTutorial) {
        tag.classList.add('level-row__tag--tutorial');
        tag.textContent = 'TUTORIAL';
      } else {
        tag.classList.add('level-row__tag--puzzle');
        tag.textContent = `${(level.data as Puzzle).optimalInstructions} instr`;
      }

      // Description (truncated)
      const descEl = document.createElement('span');
      descEl.className = 'level-row__desc';
      descEl.textContent = desc.length > 100 ? desc.slice(0, 100) + '…' : desc;

      // Status
      const status = document.createElement('span');
      status.className = 'level-row__status';
      if (completed) {
        status.textContent = '✓';
        status.classList.add('level-row__status--done');
      }

      row.append(numBadge, titleEl, tag, descEl, status);
      list.appendChild(row);
      levelNum++;
    }

    this.content.appendChild(list);
    this.overlay.classList.remove('puzzle-overlay--hidden');
  }

  hide(): void {
    this.overlay.classList.add('puzzle-overlay--hidden');
  }

  onSelect(cb: (id: string, kind: 'puzzle' | 'tutorial') => void): void {
    this.selectCb = cb;
  }
}
