// ── Settings Overlay ──

import { clearLeaderboard } from '../puzzle/leaderboard';
import { deleteAllMyOnlineScores, isOnlineEnabled } from '../firebase/online-leaderboard';
import { ALL_PUZZLES } from '../puzzle/puzzles';
import { MusicPlayer } from './music';

const LAST_TRACK_TIP = 'At least one track stays in the playlist: use the 🔇 button in the header to turn the music off';

export type LeaderboardPref = 'disabled' | 'view-only' | 'enabled';

const SETTINGS_KEY = 'humancompiler_settings';

interface Settings {
  leaderboardPref: LeaderboardPref;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { leaderboardPref: 'enabled' };
}

function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function getLeaderboardPref(): LeaderboardPref {
  return loadSettings().leaderboardPref;
}

export function setLeaderboardPref(pref: LeaderboardPref): void {
  const s = loadSettings();
  s.leaderboardPref = pref;
  saveSettings(s);
}

export class SettingsOverlay {
  private overlay: HTMLElement;
  private content: HTMLElement;
  private music: MusicPlayer;

  constructor(container: HTMLElement, music: MusicPlayer) {
    this.music = music;
    // Keep the music credits' switches and "playing" marks current while Settings is open
    music.onChange(() => this.updateTracks());
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
    this.content.style.maxWidth = '480px';
    this.overlay.appendChild(this.content);
    container.appendChild(this.overlay);
  }

  show(): void {
    this.overlay.classList.remove('puzzle-overlay--hidden');
    this.render();
  }

  hide(): void {
    this.overlay.classList.add('puzzle-overlay--hidden');
  }

  /** Show each music track's switch and whether it is playing (in place, so nothing else re-renders). */
  private updateTracks(): void {
    const states = this.music.tracks();
    const enabledCount = states.filter(s => s.enabled).length;
    for (const { track, enabled, playing } of states) {
      const row = this.content.querySelector<HTMLElement>(`.settings-track[data-track="${track.id}"]`);
      if (!row) continue;
      const box = row.querySelector<HTMLInputElement>('input')!;
      const last = enabled && enabledCount === 1;
      box.checked = enabled;
      box.disabled = last;
      row.title = last ? LAST_TRACK_TIP : '';
      row.classList.toggle('settings-track--on', enabled);
      row.querySelector<HTMLElement>('.settings-track__playing')!.hidden = !playing;
    }
  }

  private render(): void {
    const current = getLeaderboardPref();

    const options: { value: LeaderboardPref; label: string; desc: string }[] = [
      { value: 'enabled', label: 'Enabled', desc: 'View leaderboards and submit your scores' },
      { value: 'view-only', label: 'View Only', desc: 'View leaderboards but don\'t submit scores' },
      { value: 'disabled', label: 'Disabled', desc: 'Hide all leaderboard features' },
    ];

    let html = `<h2 class="level-select__heading">⚙️ SETTINGS</h2>`;
    html += `<div style="margin:20px 0">`;
    html += `<div style="color:var(--text-primary);font-weight:600;margin-bottom:12px">Online Leaderboards</div>`;

    for (const opt of options) {
      const checked = current === opt.value ? 'checked' : '';
      const activeClass = current === opt.value ? 'style="border-color:var(--accent-cyan);background:rgba(0,200,255,0.05)"' : '';
      html += `<label class="settings-radio" ${activeClass}>`;
      html += `<input type="radio" name="lb-pref" value="${opt.value}" ${checked}>`;
      html += `<div>`;
      html += `<div style="font-weight:600;color:var(--text-primary)">${opt.label}</div>`;
      html += `<div style="font-size:12px;color:var(--text-muted)">${opt.desc}</div>`;
      html += `</div>`;
      html += `</label>`;
    }

    html += `</div>`;

    // Credits (the music's Creative Commons licence requires this attribution), each with a switch
    // that puts the track in the playlist or takes it out
    const link = (href: string, text: string) =>
      `<a href="${href}" target="_blank" rel="noopener" style="color:var(--text-accent)">${text}</a>`;
    html += `<div style="margin:24px 0 0;padding-top:16px;border-top:1px solid var(--border-default)">`;
    html += `<div style="color:var(--text-primary);font-weight:600;margin-bottom:8px">Credits</div>`;
    html += `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Music: ticked tracks play in turn</div>`;
    for (const { track: t } of this.music.tracks()) {
      html += `<label class="settings-radio settings-track" data-track="${t.id}">`;
      html += `<input type="checkbox" name="music-track" value="${t.id}">`;
      html += `<div style="flex:1;font-size:12px;color:var(--text-secondary);line-height:1.6">`;
      html += `<span class="settings-track__playing" hidden>♪ playing</span>`;
      html += `<div style="color:var(--text-primary)">"${t.title}" ${t.artist} (${link(t.siteUrl, t.site)})</div>`;
      html += `Licensed under ${t.license}<br>`;
      html += link(t.licenseUrl, t.licenseUrl);
      html += `</div>`;
      html += `</label>`;
    }
    html += `</div>`;

    // Danger zone
    html += `<div style="margin:24px 0 0;padding-top:16px;border-top:1px solid var(--border-default)">`;
    html += `<div style="color:#f85149;font-weight:600;margin-bottom:12px">Danger Zone</div>`;

    // Delete leaderboard scores
    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid #f8514930;border-radius:6px;background:rgba(248,81,73,0.03);margin-bottom:8px">`;
    html += `<div>`;
    html += `<div style="font-weight:600;color:var(--text-primary)">Delete All My Scores</div>`;
    html += `<div style="font-size:12px;color:var(--text-muted)">Remove your leaderboard scores (local + online). Solutions are kept — rerun to resubmit.</div>`;
    html += `</div>`;
    html += `<button class="controls-bar__btn controls-bar__btn--danger" id="settings-delete-scores-btn" style="white-space:nowrap">Delete Scores</button>`;
    html += `</div>`;

    // Delete all local data
    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid #f8514930;border-radius:6px;background:rgba(248,81,73,0.03)">`;
    html += `<div>`;
    html += `<div style="font-weight:600;color:var(--text-primary)">Delete All Local Data</div>`;
    html += `<div style="font-size:12px;color:var(--text-muted)">Remove all saved solutions, progress, scores, and settings</div>`;
    html += `</div>`;
    html += `<button class="controls-bar__btn controls-bar__btn--danger" id="settings-reset-btn">Delete Everything</button>`;
    html += `</div>`;
    html += `</div>`;

    html += `<div style="text-align:right;margin-top:16px">`;
    html += `<button class="controls-bar__btn leaderboard-close-btn" id="settings-close-btn">Close</button>`;
    html += `</div>`;

    // Confirmation dialog (hidden by default)
    html += `<div id="settings-confirm-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;display:none;align-items:center;justify-content:center">`;
    html += `<div style="background:var(--bg-secondary);border:1px solid #f85149;border-radius:12px;padding:24px;max-width:400px;width:90%">`;
    html += `<h3 style="color:#f85149;margin:0 0 12px">⚠️ Are you sure?</h3>`;
    html += `<p style="color:var(--text-primary);font-size:13px;margin:0 0 16px">This will permanently delete all your saved solutions, puzzle progress, leaderboard scores, and settings. This cannot be undone.</p>`;
    html += `<p style="color:var(--text-muted);font-size:13px;margin:0 0 12px">Type <strong style="color:#f85149">Delete</strong> to confirm:</p>`;
    html += `<input type="text" id="settings-confirm-input" style="width:100%;padding:8px 12px;background:var(--bg-tertiary);border:1px solid var(--border-default);border-radius:4px;color:var(--text-primary);font-family:var(--font-mono);font-size:14px;box-sizing:border-box;margin-bottom:16px" placeholder="Type 'Delete' here" autocomplete="off">`;
    html += `<div style="display:flex;gap:8px;justify-content:flex-end">`;
    html += `<button class="controls-bar__btn" id="settings-confirm-cancel">Cancel</button>`;
    html += `<button class="controls-bar__btn controls-bar__btn--danger" id="settings-confirm-ok" disabled>Delete Everything</button>`;
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;

    this.content.innerHTML = html;

    // Wire up radio changes
    this.content.querySelectorAll('input[name="lb-pref"]').forEach(input => {
      (input as HTMLInputElement).addEventListener('change', () => {
        const val = (input as HTMLInputElement).value as LeaderboardPref;
        setLeaderboardPref(val);
        this.render();
      });
    });

    // Music tracks in or out of the playlist
    this.content.querySelectorAll<HTMLInputElement>('input[name="music-track"]').forEach(input => {
      input.addEventListener('change', () => {
        this.music.setTrackEnabled(input.value, input.checked);
        this.updateTracks();
      });
    });
    this.updateTracks();

    const closeBtn = this.content.querySelector('#settings-close-btn');
    closeBtn?.addEventListener('click', () => this.hide());

    // Delete all leaderboard scores
    const deleteScoresBtn = this.content.querySelector('#settings-delete-scores-btn') as HTMLButtonElement;
    deleteScoresBtn?.addEventListener('click', async () => {
      deleteScoresBtn.textContent = 'Deleting...';
      deleteScoresBtn.disabled = true;
      // Clear local scores
      clearLeaderboard();
      // Clear online scores
      if (isOnlineEnabled()) {
        await deleteAllMyOnlineScores(ALL_PUZZLES.map(p => p.id));
      }
      deleteScoresBtn.textContent = 'Done ✓';
      setTimeout(() => {
        deleteScoresBtn.textContent = 'Delete Scores';
        deleteScoresBtn.disabled = false;
      }, 2000);
    });

    // Danger zone: reset button shows confirmation dialog
    const resetBtn = this.content.querySelector('#settings-reset-btn');
    const confirmOverlay = this.content.querySelector('#settings-confirm-overlay') as HTMLElement;
    const confirmInput = this.content.querySelector('#settings-confirm-input') as HTMLInputElement;
    const confirmOk = this.content.querySelector('#settings-confirm-ok') as HTMLButtonElement;
    const confirmCancel = this.content.querySelector('#settings-confirm-cancel');

    resetBtn?.addEventListener('click', () => {
      if (confirmOverlay) {
        confirmOverlay.style.display = 'flex';
        confirmInput.value = '';
        confirmOk.disabled = true;
        setTimeout(() => confirmInput?.focus(), 50);
      }
    });

    confirmInput?.addEventListener('input', () => {
      confirmOk.disabled = confirmInput.value !== 'Delete';
    });

    confirmCancel?.addEventListener('click', () => {
      if (confirmOverlay) confirmOverlay.style.display = 'none';
    });

    confirmOk?.addEventListener('click', () => {
      if (confirmInput.value === 'Delete') {
        localStorage.clear();
        location.reload();
      }
    });
  }
}
