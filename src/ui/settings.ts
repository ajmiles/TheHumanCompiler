// ── Settings Overlay ──

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
    html += `<div style="text-align:right;margin-top:16px">`;
    html += `<button class="controls-bar__btn leaderboard-close-btn" id="settings-close-btn">Close</button>`;
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

    const closeBtn = this.content.querySelector('#settings-close-btn');
    closeBtn?.addEventListener('click', () => this.hide());
  }
}
