// ── Hardware cycles board ──
// The leaderboard of solutions timed on a real RDNA2 GPU by the devkit, for the leaderboard overlay and browser.
// It shows once there's a devkit (it has checked in at least once), and lists the entries it has measured.

import { HardwareEntry, RunnerStatus, SubmissionState } from '../puzzle/leaderboard';

/** A devkit that hasn't checked in for this long counts as offline. */
const OFFLINE_AFTER_MS = 10 * 60 * 1000;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** A rough length of time: "5 minutes", "3 hours", "2 days". */
function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.round(hours / 24)} days`;
}

/** Whether the devkit has checked in lately enough to count as online. */
export function devkitOnline(status: RunnerStatus, now = Date.now()): boolean {
  return now - status.lastSeen <= OFFLINE_AFTER_MS;
}

/** Whether the devkit is online, and how many solutions are waiting for it. */
export function runnerStatusText(status: RunnerStatus, now = Date.now()): string {
  if (!devkitOnline(status, now)) return `Devkit offline, last seen ${duration(now - status.lastSeen)} ago`;
  return status.queued > 0 ? `Devkit online, ${status.queued} waiting` : 'Devkit online';
}

/**
 * What has happened to the player's submitted solution: `undefined` before the devkit's record of it arrives, `null`
 * if there is none.
 */
export function submissionStatusText(state: SubmissionState | null | undefined): string {
  if (state === undefined) return '⏳ Sending your solution to the devkit…';
  const detail = state?.detail ? `: ${state.detail}` : '';
  switch (state?.status) {
    case 'pending': return '⏳ Waiting for the devkit to time your solution';
    case 'running': return '⚙️ Timing your solution on the devkit…';
    case 'measured': return `✓ Your solution takes ${state.cycles} cycles on the devkit`;
    case 'failed': return `✗ Your solution gave wrong results on the devkit${detail}`;
    case 'unstable': return "✗ The devkit's timings of your solution didn't agree, so it has none";
    case 'rejected': return `✗ The devkit can't time this solution${detail}`;
    case 'stale': return '✗ The puzzle has changed since you solved it, so the devkit won\'t time this solution';
    case 'hung': return "✗ Your solution didn't finish on the devkit";
    default: return "✗ Your solution couldn't be sent to the devkit";
  }
}

/**
 * The player's own run of their solution on the devkit, from the Puzzle Complete screen: 'checking' while finding out
 * whether there's a devkit; 'none' when there isn't one (or online features are off), so there's no box; 'offline'
 * when it hasn't checked in lately, so nothing is sent; or 'sent', with the devkit's record of it (as for
 * submissionStatusText()).
 */
export type DevkitRun =
  | { state: 'checking' }
  | { state: 'none' }
  | { state: 'offline'; status: RunnerStatus }
  | { state: 'sent'; submission: SubmissionState | null | undefined };

/** The Hardware cycles box for a run: its value, and what went wrong if anything did. Null when there's no box. */
export function devkitRunStat(run: DevkitRun, now = Date.now()): { value: string; note?: string } | null {
  switch (run.state) {
    case 'none': return null;
    case 'checking': return { value: 'Pending' };
    case 'offline': return { value: 'Offline', note: runnerStatusText(run.status, now) };
    case 'sent': {
      const s = run.submission;
      if (s === undefined || s?.status === 'pending' || s?.status === 'running') return { value: 'Pending' };
      if (s?.status === 'measured') return { value: String(s.cycles ?? '?') };
      return { value: '✗', note: submissionStatusText(s) };
    }
  }
}

/**
 * A row of the board: an entry with its name and time. A player has one entry, under a name nobody else has, so
 * entries sharing a name and time come only from before that: the first stands for the rest.
 */
interface Row extends HardwareEntry {
  highlight: boolean;
}

function rowsOf(entries: HardwareEntry[], highlightId: string | undefined): Row[] {
  const rows = new Map<string, Row>();
  for (const entry of entries) {
    const key = `${entry.name}:${entry.cycles}`;
    const row = rows.get(key);
    if (row) {
      row.isMine ||= entry.isMine;
      row.highlight ||= entry.id === highlightId;
    } else {
      rows.set(key, { ...entry, highlight: entry.id === highlightId });
    }
  }
  return [...rows.values()];
}

/**
 * The Hardware cycles table, across the width of the other boards, from entries in board order: every row, like the
 * other boards. `highlightId` marks the entry of the player who has just submitted.
 */
export function hardwareTableHtml(entries: HardwareEntry[], status: RunnerStatus, highlightId?: string, now = Date.now()): string {
  const rows = rowsOf(entries, highlightId);
  let html = '<div class="leaderboard-table-section leaderboard-table-section--wide">';
  html += '<div class="leaderboard-table-title">⏱️ Hardware cycles (timed on an Xbox Series X|S devkit)';
  html += `<span class="leaderboard-table-status">${escapeHtml(runnerStatusText(status, now))}</span></div>`;
  html += '<table class="leaderboard-table"><thead><tr><th>#</th><th>Name</th><th>cycles</th></tr></thead><tbody>';
  if (rows.length === 0) html += '<tr><td colspan="3" class="leaderboard-empty">No solutions timed yet</td></tr>';
  rows.forEach((row, idx) => {
    const classes = [row.highlight ? 'leaderboard-row--highlight' : '', row.isMine ? 'leaderboard-row--mine' : ''].filter(Boolean);
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
    html += `<tr${classes.length > 0 ? ` class="${classes.join(' ')}"` : ''}><td>${medal}</td><td>${escapeHtml(row.name)}</td><td>${row.cycles}</td></tr>`;
  });
  return `${html}</tbody></table></div>`;
}
