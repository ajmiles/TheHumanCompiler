// ── Leaderboard Browser ──
// Shows leaderboards for all completed puzzles in a single overlay.

import { LeaderboardEntryWithOwner, LeaderboardCategory, getRankedEntries, clearLeaderboard, computeVisibleRows } from '../puzzle/leaderboard';
import { fetchOnlineLeaderboard, isOnlineEnabled, deleteMyOnlineScores } from '../firebase/online-leaderboard';
import { Puzzle } from '../puzzle/types';

const CATEGORIES: { key: LeaderboardCategory; label: string; unit: string; icon: string }[] = [
  { key: 'codeSize', label: 'Code Size', unit: 'bytes', icon: '📦' },
  { key: 'vgprsUsed', label: 'VGPRs Used', unit: 'regs', icon: '🔲' },
  { key: 'cycles', label: 'Speed', unit: 'cycles', icon: '⚡' },
];

export class LeaderboardBrowser {
  private overlay: HTMLElement;
  private content: HTMLElement;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'puzzle-overlay puzzle-overlay--hidden';
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.overlay.classList.contains('puzzle-overlay--hidden')) {
        this.hide();
      }
    });

    this.content = document.createElement('div');
    this.content.className = 'puzzle-select-content';
    this.overlay.appendChild(this.content);
    container.appendChild(this.overlay);
  }

  show(allPuzzles: Puzzle[], completedIds: Set<string>): void {
    this.overlay.classList.remove('puzzle-overlay--hidden');

    let html = `<h2 class="level-select__heading">🏆 LEADERBOARDS</h2>`;
    html += `<div class="level-select__subtitle">Select a completed puzzle to view its leaderboard</div>`;

    html += `<div class="lb-browse-grid">`;
    for (let i = 0; i < allPuzzles.length; i++) {
      const puzzle = allPuzzles[i];
      const isCompleted = completedIds.has(puzzle.id);
      const num = i + 1;
      if (isCompleted) {
        html += `<button class="lb-browse-pill lb-browse-row" data-puzzle-id="${puzzle.id}" title="${this.esc(puzzle.title)}">`;
        html += `<span class="lb-browse-pill__num">${num}</span>`;
        html += `<span class="lb-browse-pill__name">${this.esc(puzzle.title)}</span>`;
        html += `</button>`;
      } else {
        html += `<button class="lb-browse-pill lb-browse-pill--locked" disabled title="${this.esc(puzzle.title)} (not completed)">`;
        html += `<span class="lb-browse-pill__num">${num}</span>`;
        html += `<span class="lb-browse-pill__name">${this.esc(puzzle.title)}</span>`;
        html += `</button>`;
      }
    }
    html += `</div>`;

    html += `<div id="lb-browse-detail"></div>`;

    this.content.innerHTML = html;

    // Wire up completed puzzle clicks
    const completedPuzzles = allPuzzles.filter(p => completedIds.has(p.id));
    this.content.querySelectorAll('.lb-browse-row').forEach(row => {
      (row as HTMLElement).addEventListener('click', () => {
        const puzzleId = (row as HTMLElement).dataset.puzzleId!;
        const puzzle = allPuzzles.find(p => p.id === puzzleId);
        if (puzzle) this.showPuzzleLeaderboard(puzzleId, puzzle.title);

        // Highlight selected
        this.content.querySelectorAll('.lb-browse-row').forEach(r =>
          (r as HTMLElement).classList.remove('lb-browse-pill--selected'));
        (row as HTMLElement).classList.add('lb-browse-pill--selected');
      });
    });

    // Auto-select first completed puzzle
    if (completedPuzzles.length > 0) {
      this.showPuzzleLeaderboard(completedPuzzles[0].id, completedPuzzles[0].title);
      const firstRow = this.content.querySelector(`.lb-browse-row[data-puzzle-id="${completedPuzzles[0].id}"]`) as HTMLElement;
      firstRow?.classList.add('lb-browse-pill--selected');
    }
  }

  hide(): void {
    this.overlay.classList.add('puzzle-overlay--hidden');
  }

  private showPuzzleLeaderboard(puzzleId: string, title: string): void {
    const detail = this.content.querySelector('#lb-browse-detail') as HTMLElement;
    if (!detail) return;

    // Render local immediately
    this.renderTables(detail, puzzleId, title, []);

    // Fetch online and re-render
    if (isOnlineEnabled()) {
      Promise.all(CATEGORIES.map(cat =>
        fetchOnlineLeaderboard(puzzleId, cat.key, 50)
      )).then(results => {
        this.renderTables(detail, puzzleId, title, results);
      }).catch(() => {});
    }
  }

  private renderTables(container: HTMLElement, puzzleId: string, title: string, onlineResults: LeaderboardEntryWithOwner[][]): void {
    let html = `<h3 style="color:var(--accent-cyan);margin:16px 0 8px;font-size:14px">${this.esc(title)}</h3>`;
    html += `<div class="leaderboard-tables">`;

    for (let ci = 0; ci < CATEGORIES.length; ci++) {
      const cat = CATEGORIES[ci];
      const localEntries = getRankedEntries(puzzleId, cat.key);
      const onlineEntries: LeaderboardEntryWithOwner[] = onlineResults[ci] ?? [];

      // Tag local entries with isMine based on saved player name
      const myName = localStorage.getItem('humancompiler_player_name') ?? '';
      const localTagged: LeaderboardEntryWithOwner[] = localEntries.map(e => ({
        ...e,
        isMine: !!myName && e.name === myName,
      }));

      // Merge and deduplicate
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

      html += `<div class="leaderboard-table-section">`;
      html += `<div class="leaderboard-table-title">${cat.icon} ${cat.label} (${cat.unit})</div>`;
      html += `<table class="leaderboard-table"><thead><tr><th>#</th><th>Name</th><th>${cat.unit}</th></tr></thead><tbody>`;

      if (entries.length === 0) {
        html += `<tr><td colspan="3" class="leaderboard-empty">No entries</td></tr>`;
      } else {
        for (const idx of indices) {
          const entry = entries[idx];
          if (separatorBefore.has(idx)) {
            html += `<tr class="leaderboard-separator"><td colspan="3">···</td></tr>`;
          }
          const mineClass = entry.isMine ? ' class="leaderboard-row--mine"' : '';
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
          html += `<tr${mineClass}><td>${medal}</td><td>${this.esc(entry.name)}</td><td>${entry[cat.key]}</td></tr>`;
        }
      }

      html += `</tbody></table></div>`;
    }

    html += `</div>`;
    html += `<div style="text-align:right;margin-top:12px">`;
    html += `<button class="controls-bar__btn controls-bar__btn--danger" id="lb-browse-delete-btn">Delete My Scores</button>`;
    html += `</div>`;
    container.innerHTML = html;

    const deleteBtn = container.querySelector('#lb-browse-delete-btn') as HTMLButtonElement;
    deleteBtn?.addEventListener('click', async () => {
      clearLeaderboard(puzzleId);
      if (isOnlineEnabled()) {
        deleteBtn.textContent = 'Deleting...';
        deleteBtn.disabled = true;
        await deleteMyOnlineScores(puzzleId);
      }
      this.showPuzzleLeaderboard(puzzleId, title);
    });
  }

  private esc(s: string): string {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
}
