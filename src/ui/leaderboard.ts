// ── Leaderboard Overlay UI ──

import {
  LeaderboardCategory,
  getRankedEntries,
  addLeaderboardEntry,
  clearLeaderboard,
} from '../puzzle/leaderboard';

const CATEGORIES: { key: LeaderboardCategory; label: string; unit: string; icon: string }[] = [
  { key: 'codeSize', label: 'Code Size', unit: 'bytes', icon: '📦' },
  { key: 'vgprsUsed', label: 'VGPRs Used', unit: 'regs', icon: '🔲' },
  { key: 'cycles', label: 'Speed', unit: 'cycles', icon: '⚡' },
];

export interface SolutionStats {
  codeSize: number;
  vgprsUsed: number;
  cycles: number;
}

export class LeaderboardOverlay {
  private overlay: HTMLElement;
  private content: HTMLElement;
  private puzzleId = '';
  private stats: SolutionStats | null = null;
  private onDismissCb: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'puzzle-overlay puzzle-overlay--hidden';
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    this.content = document.createElement('div');
    this.content.className = 'leaderboard-modal';
    this.overlay.appendChild(this.content);
    container.appendChild(this.overlay);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.overlay.classList.contains('puzzle-overlay--hidden')) {
        this.hide();
      }
    });
  }

  show(puzzleId: string, puzzleTitle: string, stats: SolutionStats): void {
    this.puzzleId = puzzleId;
    this.stats = stats;
    this.overlay.classList.remove('puzzle-overlay--hidden');
    this.render(puzzleTitle, false);
  }

  hide(): void {
    this.overlay.classList.add('puzzle-overlay--hidden');
    this.onDismissCb?.();
  }

  onDismiss(cb: () => void): void {
    this.onDismissCb = cb;
  }

  private render(puzzleTitle: string, justSubmitted: boolean): void {
    const stats = this.stats!;

    let html = `
      <div class="leaderboard-header">
        <h2 class="leaderboard-title">✓ Puzzle Complete!</h2>
        <div class="leaderboard-subtitle">${puzzleTitle}</div>
      </div>

      <div class="leaderboard-stats">
        <div class="leaderboard-stat">
          <span class="leaderboard-stat__icon">📦</span>
          <span class="leaderboard-stat__value">${stats.codeSize}</span>
          <span class="leaderboard-stat__label">bytes</span>
        </div>
        <div class="leaderboard-stat">
          <span class="leaderboard-stat__icon">🔲</span>
          <span class="leaderboard-stat__value">${stats.vgprsUsed}</span>
          <span class="leaderboard-stat__label">VGPRs</span>
        </div>
        <div class="leaderboard-stat">
          <span class="leaderboard-stat__icon">⚡</span>
          <span class="leaderboard-stat__value">${stats.cycles}</span>
          <span class="leaderboard-stat__label">cycles</span>
        </div>
      </div>
    `;

    if (!justSubmitted) {
      html += `
        <div class="leaderboard-submit">
          <input type="text" class="leaderboard-name-input" placeholder="Enter your name"
                 maxlength="20" id="lb-name-input" />
          <button class="controls-bar__btn controls-bar__btn--primary" id="lb-submit-btn">
            Submit Score
          </button>
        </div>
      `;
    } else {
      html += `<div class="leaderboard-submitted">Score submitted! ✓</div>`;
    }

    html += `<div class="leaderboard-tables">`;

    for (const cat of CATEGORIES) {
      const entries = getRankedEntries(this.puzzleId, cat.key);
      html += `
        <div class="leaderboard-table-section">
          <div class="leaderboard-table-title">${cat.icon} ${cat.label} (${cat.unit})</div>
          <table class="leaderboard-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>${cat.unit}</th>
              </tr>
            </thead>
            <tbody>
      `;

      if (entries.length === 0) {
        html += `<tr><td colspan="3" class="leaderboard-empty">No entries yet</td></tr>`;
      } else {
        entries.forEach((entry, i) => {
          const isCurrentScore = justSubmitted &&
            entry[cat.key] === stats[cat.key] &&
            entry.timestamp === stats.codeSize; // rough match
          const highlight = isCurrentScore ? ' class="leaderboard-row--highlight"' : '';
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
          html += `
            <tr${highlight}>
              <td>${medal}</td>
              <td>${this.escapeHtml(entry.name)}</td>
              <td>${entry[cat.key]}</td>
            </tr>
          `;
        });
      }

      html += `</tbody></table></div>`;
    }

    html += `</div>`;
    html += `<div class="leaderboard-footer">`;
    html += `<button class="controls-bar__btn controls-bar__btn--danger" id="lb-clear-btn">Clear Scores</button>`;
    html += `<button class="controls-bar__btn leaderboard-close-btn" id="lb-close-btn">Close</button>`;
    html += `</div>`;
    html += `<div class="leaderboard-local-notice">⚠ Leaderboards are currently local only (stored in your browser). Online leaderboards coming soon!</div>`;

    this.content.innerHTML = html;

    // Wire up events
    const closeBtn = this.content.querySelector('#lb-close-btn') as HTMLButtonElement;
    closeBtn?.addEventListener('click', () => this.hide());

    const clearBtn = this.content.querySelector('#lb-clear-btn') as HTMLButtonElement;
    clearBtn?.addEventListener('click', () => {
      clearLeaderboard(this.puzzleId);
      this.render(puzzleTitle, justSubmitted);
    });

    if (!justSubmitted) {
      const nameInput = this.content.querySelector('#lb-name-input') as HTMLInputElement;
      const submitBtn = this.content.querySelector('#lb-submit-btn') as HTMLButtonElement;

      // Try to restore last used name
      const lastName = localStorage.getItem('humancompiler_player_name') ?? '';
      if (nameInput && lastName) nameInput.value = lastName;

      // Focus the name input
      setTimeout(() => nameInput?.focus(), 100);

      // Submit on enter key
      nameInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitBtn?.click();
      });

      submitBtn?.addEventListener('click', () => {
        const name = nameInput?.value.trim();
        if (!name) {
          nameInput?.classList.add('leaderboard-name-input--error');
          return;
        }

        localStorage.setItem('humancompiler_player_name', name);

        addLeaderboardEntry(this.puzzleId, {
          name,
          codeSize: stats.codeSize,
          vgprsUsed: stats.vgprsUsed,
          cycles: stats.cycles,
          timestamp: Date.now(),
        });

        this.render(puzzleTitle, true);
      });
    }
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
