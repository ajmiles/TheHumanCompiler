// ── Leaderboard Overlay UI ──

import {
  LeaderboardEntry,
  LeaderboardEntryWithOwner,
  LeaderboardCategory,
  HardwareBoard,
  SubmissionState,
  addLeaderboardEntry,
  boardRows,
  clearLeaderboard,
  improvedText,
  nameKeyOf,
  PLAYER_NAME_KEY,
} from '../puzzle/leaderboard';
import {
  submitOnlineScore,
  fetchOnlineBoards,
  fetchHardwareBoard,
  fetchRunnerStatus,
  runOnDevkit,
  watchSubmission,
  isOnlineEnabled,
  deleteMyOnlineScores,
  getPlayer,
  signInProblem,
  signInWithGoogle,
  Player,
  SubmittedSolution,
} from '../firebase/online-leaderboard';
import { getLeaderboardPref } from './settings';
import { DevkitRun, devkitOnline, devkitRunStat, hardwareTableHtml, submissionStatusText } from './hardware-board';

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
  /** Bumped by show(), hide() and deleting, so that what arrives for an earlier state is dropped. */
  private generation = 0;
  /** The score has been submitted in this showing, so the form has gone. */
  private submitted = false;
  /** Online fetches started, and the newest one shown: one that arrives after a newer one is dropped. */
  private fetchesStarted = 0;
  private fetchShown = 0;
  /** The solution, for the devkit to time if it's online when the score is submitted. */
  private solution: SubmittedSolution | null = null;
  /** The devkit's status and board, once fetched; null while there's no devkit. */
  private hardware: HardwareBoard | null = null;
  /** Whether the solution went with the submitted score, and so has a status to show. */
  private solutionSent = false;
  /** The player's entry, once they've submitted, to highlight on the Hardware cycles board. */
  private submittedId: string | null = null;
  /** The devkit's record of the solution: undefined until it arrives, null if there's none. */
  private submissionState: SubmissionState | null | undefined = undefined;
  private unwatchSubmission: (() => void) | null = null;
  /** The solution's own run on the devkit, sent as the screen shows, for the Hardware cycles box. */
  private devkitRun: DevkitRun = { state: 'none' };
  /** Bumped by show() and hide() (not by deleting scores, which leaves the run alone). */
  private runGeneration = 0;
  private unwatchRun: (() => void) | null = null;
  /** The player (the name they own, their Google account), once fetched. */
  private player: Player | null = null;
  /** The player has typed in the name box, so the name they own isn't filled in over it. */
  private nameEdited = false;
  /** The score is on its way online: the form waits. */
  private submitting = false;
  /** Why the last try at submitting didn't go through (shown under the form), and whether it was the name. */
  private submitError: { text: string; nameTaken: boolean } | null = null;
  /** The categories the submitted score bettered: null until it's submitted. */
  private improved: LeaderboardCategory[] | null = null;
  /** What came of signing in with Google here. */
  private signInNote: string | null = null;

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

  /**
   * `solution` is what scored `stats`. With online features on, it's run on the devkit straight away (for the Hardware
   * cycles box), and submitting the score sends it too, for the board.
   */
  show(puzzleId: string, puzzleTitle: string, stats: SolutionStats, solution?: SubmittedSolution): void {
    this.stopWatching();
    this.stopWatchingRun();
    this.generation++;
    this.runGeneration++;
    this.puzzleId = puzzleId;
    this.stats = stats;
    this.solution = solution ?? null;
    this.hardware = null;
    this.submitted = false;
    this.solutionSent = false;
    this.submittedId = null;
    this.submissionState = undefined;
    this.player = null;
    this.nameEdited = false;
    this.submitting = false;
    this.submitError = null;
    this.improved = null;
    this.signInNote = null;
    const runIt = !!solution && isOnlineEnabled() && getLeaderboardPref() !== 'disabled';
    this.devkitRun = runIt ? { state: 'checking' } : { state: 'none' };
    this._cachedOnlineResults = null;
    this.content.innerHTML = ''; // a new showing starts from the saved name, not what was typed last time
    this.overlay.classList.remove('puzzle-overlay--hidden');
    this.render(puzzleTitle);
    if (runIt) this.startDevkitRun(puzzleTitle);
    if (isOnlineEnabled() && getLeaderboardPref() === 'enabled') this.loadPlayer(puzzleTitle);
  }

  hide(): void {
    this.stopWatching();
    this.stopWatchingRun();
    this.generation++;
    this.runGeneration++;
    this.overlay.classList.add('puzzle-overlay--hidden');
    this.onDismissCb?.();
  }

  onDismiss(cb: () => void): void {
    this.onDismissCb = cb;
  }

  private render(puzzleTitle: string): void {
    // Always render local immediately
    this._renderInner(puzzleTitle, this._cachedOnlineResults);

    // Fetch online scores (always refresh on show and after submit)
    if (isOnlineEnabled()) {
      const generation = this.generation;
      const request = ++this.fetchesStarted;
      Promise.all([
        fetchOnlineBoards(this.puzzleId, CATEGORIES.map(cat => cat.key)),
        fetchHardwareBoard(this.puzzleId),
      ]).then(([results, hardware]) => {
        // Drop boards for an earlier state, or older than those shown
        if (generation !== this.generation || request < this.fetchShown) return;
        this.fetchShown = request;
        this._cachedOnlineResults = results ?? this._cachedOnlineResults;
        this.hardware = hardware;
        this._renderInner(puzzleTitle, this._cachedOnlineResults);
      }).catch(() => {});
    }
  }

  /** Follow what the devkit does with the submitted solution, re-rendering as it changes. */
  private watch(submissionId: string, puzzleTitle: string): void {
    this.stopWatching();
    const generation = this.generation;
    this.unwatchSubmission = watchSubmission(submissionId, state => {
      if (generation !== this.generation) return;
      const measuredNow = state?.status === 'measured' && this.submissionState?.status !== 'measured';
      this.submissionState = state;
      this._renderInner(puzzleTitle, this._cachedOnlineResults);
      // Its time is on the board now
      if (measuredNow) this.render(puzzleTitle);
    });
  }

  private stopWatching(): void {
    this.unwatchSubmission?.();
    this.unwatchSubmission = null;
  }

  /** Fetch the player: fill in the name they own (unless one has been typed), and say how they're signed in. */
  private loadPlayer(puzzleTitle: string): void {
    const generation = this.generation;
    void getPlayer().then(player => {
      if (generation !== this.generation) return;
      this.player = player;
      const input = this.content.querySelector<HTMLInputElement>('#lb-name-input');
      if (input && player?.name && !this.nameEdited) input.value = player.name;
      this.showPlayerParts(puzzleTitle);
    });
  }

  /** What the name being typed will do: take a name, rename the player, or (after a refusal) why it didn't go. */
  private nameNote(): { text: string; error: boolean } {
    if (this.submitError) return { text: this.submitError.text, error: true };
    const typed = this.content.querySelector<HTMLInputElement>('#lb-name-input')?.value.trim() ?? '';
    const mine = this.player?.name;
    if (!this.player || !typed) return { text: '', error: false };
    if (!mine) return { text: `${typed} will be your name: nobody else can use it.`, error: false };
    if (nameKeyOf(typed) !== nameKeyOf(mine)) return { text: `Submitting renames you from ${mine} to ${typed}, on every board.`, error: false };
    if (typed !== mine) return { text: `Submitting changes your name to ${typed}.`, error: false };
    return { text: '', error: false };
  }

  /** The name note and the Google line, in place (not a full re-render: the name box keeps its focus). */
  private showPlayerParts(puzzleTitle: string): void {
    const note = this.content.querySelector<HTMLElement>('#lb-name-note');
    if (note) {
      const { text, error } = this.nameNote();
      note.textContent = text;
      note.hidden = !text;
      note.classList.toggle('leaderboard-name-note--error', error);
    }
    const line = this.content.querySelector<HTMLElement>('#lb-player-line');
    if (!line) return;
    const said = this.signInNote ? ` ${this.escapeHtml(this.signInNote)}` : '';
    if (!this.player) {
      line.innerHTML = '';
    } else if (this.player.google) {
      line.innerHTML = `🔑 Signed in with Google (${this.escapeHtml(this.player.google)}): your name is yours on every device.${said}`;
    } else {
      line.innerHTML = `🔑 <button class="leaderboard-link-btn" id="lb-google-btn">Sign in with Google</button> to keep your name on every device.${said}`;
      line.querySelector('#lb-google-btn')?.addEventListener('click', () => void this.googleSignIn(puzzleTitle));
    }
  }

  /** Sign in with Google from here: the same player everywhere (or, if the account has one already, that player). */
  private async googleSignIn(puzzleTitle: string): Promise<void> {
    const generation = this.generation;
    const result = await signInWithGoogle();
    if (generation !== this.generation || result === 'cancelled') return;
    this.signInNote = result === 'switched' ? "This browser plays as that account's player now." : signInProblem(result);
    this.player = await getPlayer();
    if (generation !== this.generation) return;
    const input = this.content.querySelector<HTMLInputElement>('#lb-name-input');
    if (input && this.player?.name && (result === 'switched' || !this.nameEdited)) input.value = this.player.name;
    if (result === 'switched') {
      // A different player now: their own run of the solution, and their marks on the boards
      if (this.devkitRun.state !== 'none') {
        this.stopWatchingRun();
        this.runGeneration++;
        this.devkitRun = { state: 'checking' };
        this.startDevkitRun(puzzleTitle);
      }
      this.render(puzzleTitle);
    }
    this.showPlayerParts(puzzleTitle);
  }

  /**
   * Run the solution on the devkit, without a score, if the devkit is online; and follow what it makes of it in the
   * Hardware cycles box.
   */
  private startDevkitRun(puzzleTitle: string): void {
    const generation = this.runGeneration;
    const current = () => generation === this.runGeneration;
    const solution = this.solution!;
    void (async () => {
      const status = await fetchRunnerStatus();
      if (!current()) return;
      if (!status || !devkitOnline(status)) {
        this.devkitRun = status ? { state: 'offline', status } : { state: 'none' };
        this._renderInner(puzzleTitle, this._cachedOnlineResults);
        return;
      }
      const id = await runOnDevkit(this.puzzleId, solution);
      if (!current()) return;
      this.devkitRun = { state: 'sent', submission: id ? undefined : null };
      this._renderInner(puzzleTitle, this._cachedOnlineResults);
      if (!id) return;
      this.unwatchRun = watchSubmission(id, state => {
        if (!current()) return;
        this.devkitRun = { state: 'sent', submission: state };
        this.showDevkitRun(puzzleTitle);
      });
    })();
  }

  private stopWatchingRun(): void {
    this.unwatchRun?.();
    this.unwatchRun = null;
  }

  /** Show how the run is going in its box, without redrawing the rest (the name being typed, say). */
  private showDevkitRun(puzzleTitle: string): void {
    const stat = devkitRunStat(this.devkitRun);
    const value = this.content.querySelector('#lb-hw-stat-value');
    const note = this.content.querySelector<HTMLElement>('#lb-hw-run-note');
    if (!stat || !value || !note) {
      this._renderInner(puzzleTitle, this._cachedOnlineResults);
      return;
    }
    value.textContent = stat.value;
    value.classList.toggle('leaderboard-stat__value--text', !/^\d+$/.test(stat.value));
    note.textContent = stat.note ?? '';
    note.hidden = !stat.note;
  }

  private _cachedOnlineResults: LeaderboardEntryWithOwner[][] | null = null;

  private _renderInner(puzzleTitle: string, onlineResults: LeaderboardEntryWithOwner[][] | null): void {
    const stats = this.stats!;
    const pref = getLeaderboardPref();
    const justSubmitted = this.submitted;
    const run = devkitRunStat(this.devkitRun);
    const runSent = this.devkitRun.state === 'checking' || this.devkitRun.state === 'sent';

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
          <span class="leaderboard-stat__label">simulated cycles</span>
        </div>
        ${run ? `
        <div class="leaderboard-stat" id="lb-hw-stat">
          <span class="leaderboard-stat__icon">⏱️</span>
          <span class="leaderboard-stat__value${/^\d+$/.test(run.value) ? '' : ' leaderboard-stat__value--text'}" id="lb-hw-stat-value">${this.escapeHtml(run.value)}</span>
          <span class="leaderboard-stat__label">hardware cycles</span>
        </div>` : ''}
      </div>
    `;
    if (run) {
      html += `<div class="leaderboard-hw-status" id="lb-hw-run-note"${run.note ? '' : ' hidden'}>${this.escapeHtml(run.note ?? '')}</div>`;
    }
    if (runSent) {
      html += `<div class="leaderboard-hw-notice">🔒 Your solution goes to the devkit to be timed on a real GPU. Only you and the devkit can read it.</div>`;
    }

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
      const nameError = this.submitError?.nameTaken ? ' leaderboard-name-input--error' : '';
      html += `
        <div class="leaderboard-submit">
          <input type="text" class="leaderboard-name-input${nameError}" placeholder="Enter your name"
                 maxlength="20" id="lb-name-input" />
          <button class="controls-bar__btn controls-bar__btn--primary" id="lb-submit-btn"${this.submitting ? ' disabled' : ''}>
            ${this.submitting ? 'Submitting…' : 'Submit Score'}
          </button>
        </div>
        <div class="leaderboard-name-note" id="lb-name-note" hidden></div>
      `;
      if (isOnlineEnabled()) html += `<div class="leaderboard-player-line" id="lb-player-line"></div>`;
      if (this.hardware && this.solution && !runSent) {
        html += `<div class="leaderboard-hw-notice">🔒 Submitting also sends your solution to the devkit to time on a real GPU. Only you and the devkit can read it.</div>`;
      }
    } else if (pref === 'view-only' && !justSubmitted) {
      html += `<div class="leaderboard-local-notice">Score submission is disabled. Change this in ⚙️ Settings.</div>`;
    } else if (justSubmitted) {
      html += `<div class="leaderboard-submitted">Score submitted! ✓</div>`;
      if (this.improved) html += `<div class="leaderboard-hw-status">${this.escapeHtml(improvedText(this.improved))}</div>`;
      if (this.solutionSent) {
        html += `<div class="leaderboard-hw-status">${this.escapeHtml(submissionStatusText(this.submissionState))}</div>`;
      }
    }

    html += `<div class="leaderboard-tables">`;

    // Once the online boards are in, they're the boards (each player once, at their best); until then, this
    // browser's own scores, one row per name
    for (let ci = 0; ci < CATEGORIES.length; ci++) {
      const cat = CATEGORIES[ci];
      const entries = boardRows(this.puzzleId, cat.key, onlineResults?.[ci] ?? null);

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
        for (let idx = 0; idx < entries.length; idx++) {
          const entry = entries[idx];
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

    if (this.hardware) {
      html += hardwareTableHtml(this.hardware.entries, this.hardware.status, this.submittedId ?? undefined);
    }

    html += `</div>`;
    html += `<div class="leaderboard-footer">`;
    html += `<button class="controls-bar__btn controls-bar__btn--danger" id="lb-delete-mine-btn"${this.submitting ? ' disabled' : ''}>Delete My Scores</button>`;
    html += `<button class="controls-bar__btn leaderboard-close-btn" id="lb-close-btn">Close</button>`;
    html += `</div>`;
    html += `<div class="leaderboard-local-notice">${
      isOnlineEnabled()
        ? '🌐 Scores are synced online — compete with other players!'
        : '⚠ Leaderboards are currently local only (stored in your browser). Online leaderboards coming soon!'
    }</div>`;

    // A re-render (when the online boards arrive) keeps the name being typed
    const typedName = (this.content.querySelector('#lb-name-input') as HTMLInputElement | null)?.value;
    this.content.innerHTML = html;

    // Wire up events
    const closeBtn = this.content.querySelector('#lb-close-btn') as HTMLButtonElement;
    closeBtn?.addEventListener('click', () => this.hide());

    const deleteBtn = this.content.querySelector('#lb-delete-mine-btn') as HTMLButtonElement;
    deleteBtn?.addEventListener('click', async () => {
      // Clear local scores
      clearLeaderboard(this.puzzleId);
      // Delete the player's online entry (and the solutions sent with it); their name stays theirs
      if (isOnlineEnabled()) {
        deleteBtn.textContent = 'Deleting...';
        deleteBtn.disabled = true;
        this.stopWatching();
        this.generation++;
        this.solutionSent = false;
        this.submittedId = null;
        this.improved = null;
        await deleteMyOnlineScores(this.puzzleId);
      }
      this._cachedOnlineResults = null;
      this.render(puzzleTitle);
    });

    if (!justSubmitted) {
      const nameInput = this.content.querySelector('#lb-name-input') as HTMLInputElement;
      const submitBtn = this.content.querySelector('#lb-submit-btn') as HTMLButtonElement;

      // The name being typed; else the name the player owns; else the last one used here
      const lastName = typedName ?? this.player?.name ?? localStorage.getItem(PLAYER_NAME_KEY) ?? '';
      if (nameInput && lastName) nameInput.value = lastName;
      this.showPlayerParts(puzzleTitle);

      // Focus the name input
      setTimeout(() => nameInput?.focus(), 100);

      nameInput?.addEventListener('input', () => {
        this.nameEdited = true;
        this.submitError = null;
        nameInput.classList.remove('leaderboard-name-input--error');
        this.showPlayerParts(puzzleTitle);
      });

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
        if (!this.submitting) {
          void this.submit(puzzleTitle, { name, codeSize: stats.codeSize, vgprsUsed: stats.vgprsUsed, cycles: stats.cycles, timestamp: Date.now() });
        }
      });
    }
  }

  /**
   * Submit the score: online first, where it goes in only under a name that's the player's (or nobody's, and then
   * becomes theirs), with the solution for the devkit to time; then into this browser's own boards.
   */
  private async submit(puzzleTitle: string, entry: LeaderboardEntry): Promise<void> {
    const puzzleId = this.puzzleId;
    const keepHere = () => {
      localStorage.setItem(PLAYER_NAME_KEY, entry.name);
      addLeaderboardEntry(puzzleId, entry);
    };
    if (!isOnlineEnabled()) {
      keepHere();
      this.submitted = true;
      this.render(puzzleTitle);
      return;
    }
    const generation = this.generation;
    const solution = this.hardware && this.solution ? this.solution : undefined;
    this.submitting = true;
    this.submitError = null;
    this._renderInner(puzzleTitle, this._cachedOnlineResults);
    const outcome = await submitOnlineScore(puzzleId, entry, solution);
    if (outcome.ok) keepHere(); // in this browser too, even if the screen has gone
    if (generation !== this.generation) return;
    this.submitting = false;
    if (!outcome.ok) {
      this.submitError = outcome.reason === 'name-taken'
        ? { text: `${entry.name} is another player's name: choose another.`, nameTaken: true }
        : { text: "Your score couldn't be submitted. Try again?", nameTaken: false };
      this._renderInner(puzzleTitle, this._cachedOnlineResults);
      return;
    }
    this.submitted = true;
    this.improved = outcome.improved;
    this.submittedId = outcome.myUid;
    this.solutionSent = !!solution;
    if (outcome.submissionId) this.watch(outcome.submissionId, puzzleTitle);
    else if (solution) this.submissionState = null;
    if (this.player) this.player = { ...this.player, name: entry.name };
    this.render(puzzleTitle);
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
