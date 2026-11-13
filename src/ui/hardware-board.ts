// ── Hardware cycles board ──
// The leaderboard of solutions timed on a real RDNA2 GPU by the devkit, for the leaderboard overlay and browser.
// It shows once there's a devkit (it has checked in at least once), and lists the entries it has measured.
// Also the help that explains Hardware cycles, from a button beside them.

import { HardwareEntry, RunnerStatus, SubmissionState } from '../puzzle/leaderboard';
import { infoDialog } from './dialog';

/** A devkit that hasn't checked in for this long counts as offline. */
const OFFLINE_AFTER_MS = 10 * 60 * 1000;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** The button beside "Hardware cycles" that explains them: see listenForHardwareHelp(). */
export const HARDWARE_HELP_BUTTON = '<button type="button" class="hw-help" title="What are hardware cycles?" ' +
  'aria-label="What are hardware cycles?">?</button>';

/** What Hardware cycles are, how the devkit measures them, and why they're usually more than simulated cycles. */
const HARDWARE_HELP = `
  <p>How long your solution takes on the RDNA2 GPU of an Xbox Series X|S devkit.</p>
  <h4>What it measures</h4>
  <p>The GPU's clock cycles from your first instruction until your code reaches <code>s_endpgm</code>, added up over
    the puzzle's invocations, as for simulated cycles. Loading the inputs and storing the outputs aren't counted, and
    as it counts cycles, not time, the GPU's clock speed makes no difference.</p>
  <h4>How it works</h4>
  <p>The devkit wraps your solution in a harness that loads an invocation's inputs, reads the GPU's cycle counter
    (<code>s_memtime</code>), runs your code, reads the counter again and stores your outputs. Each invocation is
    timed 100 times, each straight after an untimed run so that your code is in the instruction cache. The most
    common time counts, less the harness's time around an empty solution. Wrong outputs on the GPU get no time.</p>
  <p>The Puzzle Complete box times the solution you've just run. Submitting your score puts its time on the board,
    which keeps each player's fastest.</p>
  <h4>Why it's usually more than simulated cycles</h4>
  <p>Simulated cycles count one per instruction. A real GPU overlaps instructions, but each waits for its inputs, and
    your wave runs alone, with no other waves to fill the gaps:</p>
  <ul>
    <li><strong>Dependencies:</strong> an instruction that uses the result of the one just before it waits a few
      cycles. Independent instructions in between hide the wait.</li>
    <li><strong>Slow instructions:</strong> transcendentals (<code>v_rcp_f32</code>, <code>v_sqrt_f32</code>,
      <code>v_sin_f32</code>…), 64-bit float math and 32-bit integer multiplies (<code>v_mul_lo_u32</code>) take
      longer.</li>
    <li><strong>Branches:</strong> a taken branch costs extra cycles while the GPU fetches the instructions at its
      target, and a loop pays that on every pass.</li>
    <li><strong>Vector to scalar:</strong> a branch or scalar instruction that reads VCC, EXEC or an SGPR waits for a
      vector instruction that has just written it (<code>v_cmp</code>, <code>v_cmpx</code>,
      <code>v_readfirstlane_b32</code>).</li>
    <li><strong>LDS:</strong> <code>ds_</code> instructions, <code>ds_swizzle_b32</code> included, take many cycles to
      return their results, and <code>s_waitcnt</code> waits for them.</li>
  </ul>
  <p>So the fastest solution on the GPU isn't always the one with the fewest instructions.</p>`;

/** Explain Hardware cycles when a help button (HARDWARE_HELP_BUTTON) in `root` is clicked. */
export function listenForHardwareHelp(root: HTMLElement): void {
  root.addEventListener('click', e => {
    if (e.target instanceof Element && e.target.closest('.hw-help')) {
      void infoDialog('⏱️ Hardware cycles', HARDWARE_HELP);
    }
  });
}

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
  html += HARDWARE_HELP_BUTTON;
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
