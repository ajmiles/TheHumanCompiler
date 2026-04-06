// ── Leaderboard Overlay UI ──

import {
  LeaderboardEntryWithOwner,
  LeaderboardCategory,
  getRankedEntries,
  addLeaderboardEntry,
  clearLeaderboard,
  computeVisibleRows,
} from '../puzzle/leaderboard';
import {
  submitOnlineScore,
  fetchOnlineLeaderboard,
  isOnlineEnabled,
  deleteMyOnlineScores,
} from '../firebase/online-leaderboard';
import { getLeaderboardPref } from './settings';

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
    this._cachedOnlineResults = [];
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
    // Always render local immediately
    this._renderInner(puzzleTitle, justSubmitted, this._cachedOnlineResults);

    // Fetch online scores (always refresh on show and after submit)
    if (isOnlineEnabled()) {
      Promise.all(CATEGORIES.map(cat =>
        fetchOnlineLeaderboard(this.puzzleId, cat.key, 50)
      )).then(results => {
        this._cachedOnlineResults = results;
        this._renderInner(puzzleTitle, justSubmitted, results);
      }).catch(() => {});
    }
  }

  private _cachedOnlineResults: LeaderboardEntryWithOwner[][] = [];

  private _renderInner(puzzleTitle: string, justSubmitted: boolean, onlineResults: LeaderboardEntryWithOwner[][]): void {
    const stats = this.stats!;
    const pref = getLeaderboardPref();

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

    if (pref === 'disabled') {
      html += `<div class="leaderboard-local-notice">Leaderboards are disabled. Change this in ⚙️ Settings.</div>`;
      html += `<div class="leaderboard-footer">`;
      html += `<button class="controls-bar__btn leaderboard-close-btn" id="lb-close-btn">Close</button>`;
      html += `</div>`;
      this.content.innerHTML = html;
      this.content.querySelector('#lb-close-btn')?.addEventListener('click', () => this.hide());
      return;
    }

    if (pref === 'enabled' && !justSubmitted) {
      html += `
        <div class="leaderboard-submit">
          <input type="text" class="leaderboard-name-input" placeholder="Enter your name"
                 maxlength="20" id="lb-name-input" />
          <button class="controls-bar__btn controls-bar__btn--primary" id="lb-submit-btn">
            Submit Score
          </button>
        </div>
      `;
    } else if (pref === 'view-only' && !justSubmitted) {
      html += `<div class="leaderboard-local-notice">Score submission is disabled. Change this in ⚙️ Settings.</div>`;
    } else if (justSubmitted) {
      html += `<div class="leaderboard-submitted">Score submitted! ✓</div>`;
    }

    html += `<div class="leaderboard-tables">`;

    for (let ci = 0; ci < CATEGORIES.length; ci++) {
      const cat = CATEGORIES[ci];
      const localEntries = getRankedEntries(this.puzzleId, cat.key);
      const onlineEntries: LeaderboardEntryWithOwner[] = onlineResults[ci] ?? [];

      // Tag local entries with isMine based on saved player name
      const myName = localStorage.getItem('humancompiler_player_name') ?? '';
      const localTagged: LeaderboardEntryWithOwner[] = localEntries.map(e => ({
        ...e,
        isMine: !!myName && e.name === myName,
      }));

      // Merge local + online, deduplicate by name+score, sort
      const merged = new Map<string, LeaderboardEntryWithOwner>();
      for (const e of [...localTagged, ...onlineEntries]) {
        const key = `${e.name}:${e[cat.key]}`;
        const existing = merged.get(key);
        if (!existing || e[cat.key] < existing[cat.key]) {
          merged.set(key, e);
        } else if (existing && e.isMine) {
          existing.isMine = true;
        }
      }
      const entries = [...merged.values()]
        .sort((a, b) => a[cat.key] - b[cat.key]);

      const { indices, separatorBefore } = computeVisibleRows(entries);

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
        for (const idx of indices) {
          const entry = entries[idx];
          if (separatorBefore.has(idx)) {
            html += `<tr class="leaderboard-separator"><td colspan="3">···</td></tr>`;
          }
          const isCurrentScore = justSubmitted &&
            entry[cat.key] === stats[cat.key] &&
            entry.timestamp === stats.codeSize; // rough match
          const classes: string[] = [];
          if (isCurrentScore) classes.push('leaderboard-row--highlight');
          if (entry.isMine) classes.push('leaderboard-row--mine');
          const classAttr = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
          html += `
            <tr${classAttr}>
              <td>${medal}</td>
              <td>${this.escapeHtml(entry.name)}</td>
              <td>${entry[cat.key]}</td>
            </tr>
          `;
        }
      }

      html += `</tbody></table></div>`;
    }

    html += `</div>`;
    html += `<div class="leaderboard-footer">`;
    html += `<button class="controls-bar__btn controls-bar__btn--danger" id="lb-delete-mine-btn">Delete My Scores</button>`;
    html += `<button class="controls-bar__btn leaderboard-close-btn" id="lb-close-btn">Close</button>`;
    html += `</div>`;
    html += `<div class="leaderboard-local-notice">${
      isOnlineEnabled()
        ? '🌐 Scores are synced online — compete with other players!'
        : '⚠ Leaderboards are currently local only (stored in your browser). Online leaderboards coming soon!'
    }</div>`;

    this.content.innerHTML = html;

    // Wire up events
    const closeBtn = this.content.querySelector('#lb-close-btn') as HTMLButtonElement;
    closeBtn?.addEventListener('click', () => this.hide());

    const deleteBtn = this.content.querySelector('#lb-delete-mine-btn') as HTMLButtonElement;
    deleteBtn?.addEventListener('click', async () => {
      // Clear local scores
      clearLeaderboard(this.puzzleId);
      // Delete online scores matching this user's UID
      if (isOnlineEnabled()) {
        deleteBtn.textContent = 'Deleting...';
        deleteBtn.disabled = true;
        await deleteMyOnlineScores(this.puzzleId);
      }
      this._cachedOnlineResults = [];
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

        const entry = {
          name,
          codeSize: stats.codeSize,
          vgprsUsed: stats.vgprsUsed,
          cycles: stats.cycles,
          timestamp: Date.now(),
        };

        addLeaderboardEntry(this.puzzleId, entry);

        // Submit to online leaderboard if configured
        if (isOnlineEnabled()) {
          submitOnlineScore(this.puzzleId, entry).catch(() => {});
        }

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
