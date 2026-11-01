// ── Leaderboard Data Model ──

export interface LeaderboardEntry {
  name: string;
  codeSize: number;    // bytes (binary length × 4)
  vgprsUsed: number;   // count of distinct VGPRs
  cycles: number;      // total cycles across all invocations
  timestamp: number;
}

export type LeaderboardCategory = 'codeSize' | 'vgprsUsed' | 'cycles';

const STORAGE_KEY = 'humancompiler_leaderboards';
const MAX_ENTRIES = 10;

// puzzleId → LeaderboardEntry[]
type LeaderboardData = Record<string, LeaderboardEntry[]>;

function loadData(): LeaderboardData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as LeaderboardData : {};
  } catch {
    return {};
  }
}

function saveData(data: LeaderboardData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getLeaderboard(puzzleId: string): LeaderboardEntry[] {
  return loadData()[puzzleId] ?? [];
}

export function clearLeaderboard(puzzleId?: string): void {
  if (puzzleId) {
    const data = loadData();
    delete data[puzzleId];
    saveData(data);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function addLeaderboardEntry(puzzleId: string, entry: LeaderboardEntry): void {
  const data = loadData();
  if (!data[puzzleId]) data[puzzleId] = [];
  data[puzzleId].push(entry);

  // Keep only the best MAX_ENTRIES per unique name (best = smallest in each category)
  // We store all and sort at display time
  if (data[puzzleId].length > MAX_ENTRIES * 3) {
    // Prune: keep top MAX_ENTRIES per category to avoid unbounded growth
    const entries = data[puzzleId];
    const kept = new Set<number>();

    for (const cat of ['codeSize', 'vgprsUsed', 'cycles'] as LeaderboardCategory[]) {
      const sorted = entries
        .map((e, i) => ({ e, i }))
        .sort((a, b) => a.e[cat] - b.e[cat]);
      for (let i = 0; i < Math.min(MAX_ENTRIES, sorted.length); i++) {
        kept.add(sorted[i].i);
      }
    }

    data[puzzleId] = entries.filter((_, i) => kept.has(i));
  }

  saveData(data);
}

export function getRankedEntries(
  puzzleId: string,
  category: LeaderboardCategory,
): LeaderboardEntry[] {
  const entries = getLeaderboard(puzzleId);
  return [...entries]
    .sort((a, b) => a[category] - b[category])
    .slice(0, MAX_ENTRIES);
}

export const CATEGORY_KEYS: readonly LeaderboardCategory[] = ['codeSize', 'vgprsUsed', 'cycles'];

/** A score's stats merged into a player's bests (each category on its own), and the categories it improves. */
export function mergeBests(best: Pick<LeaderboardEntry, LeaderboardCategory> | undefined, score: Pick<LeaderboardEntry, LeaderboardCategory>):
  { bests: Pick<LeaderboardEntry, LeaderboardCategory>; improved: LeaderboardCategory[] } {
  const improved = CATEGORY_KEYS.filter(c => best === undefined || score[c] < best[c]);
  const bests = Object.fromEntries(CATEGORY_KEYS.map(c => [c, Math.min(score[c], best?.[c] ?? Infinity)])) as Pick<LeaderboardEntry, LeaderboardCategory>;
  return { bests, improved };
}

/** One row per name, its best in `category` (the first of equals), best first: a player counts once on a board. */
export function bestPerName<T extends LeaderboardEntry>(entries: readonly T[], category: LeaderboardCategory): T[] {
  const best = new Map<string, T>();
  for (const e of entries) {
    const held = best.get(e.name);
    if (!held || e[category] < held[category]) best.set(e.name, e);
  }
  return [...best.values()].sort((a, b) => a[category] - b[category]);
}

/** A name's key in names/{key}: names are the same whatever their case. */
export function nameKeyOf(name: string): string {
  return name.trim().toLowerCase();
}

const CATEGORY_NAMES: Record<LeaderboardCategory, string> = { codeSize: 'code size', vgprsUsed: 'VGPRs', cycles: 'speed' };

/** What a submitted score did for the player's bests: mergeBests()'s `improved`. */
export function improvedText(improved: readonly LeaderboardCategory[]): string {
  if (improved.length === 0) return 'No new bests: your earlier scores stand.';
  const names = improved.map(c => CATEGORY_NAMES[c]);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `A new best for ${list}.`;
}

// ── Online entries ──

export interface LeaderboardEntryWithOwner extends LeaderboardEntry {
  isMine: boolean;
}

/** The name last submitted with in this browser. */
export const PLAYER_NAME_KEY = 'humancompiler_player_name';

/**
 * A board's rows, best first: the online board once it's in (each player once, at their best). Before that, or when
 * it can't be read, this browser's own scores, one row per name.
 */
export function boardRows(puzzleId: string, category: LeaderboardCategory, online: readonly LeaderboardEntryWithOwner[] | null):
  LeaderboardEntryWithOwner[] {
  if (online) return [...online];
  const myName = localStorage.getItem(PLAYER_NAME_KEY) ?? '';
  return bestPerName(getLeaderboard(puzzleId).map(e => ({ ...e, isMine: !!myName && e.name === myName })), category);
}

// ── Hardware cycles ──

/** An entry on the Hardware cycles board: its solution, timed on the devkit. */
export interface HardwareEntry {
  id: string;
  name: string;
  /** Core clocks over all invocations. */
  cycles: number;
  isMine: boolean;
}

/** The devkit's last check-in. */
export interface RunnerStatus {
  /** When it last checked in, in milliseconds since 1970. */
  lastSeen: number;
  /** Submissions waiting for it. */
  queued: number;
}

/** The devkit's status and the entries it has timed for a puzzle. */
export interface HardwareBoard {
  status: RunnerStatus;
  entries: HardwareEntry[];
}

/** How far a submitted solution has got on the devkit (the status the runner writes). */
export interface SubmissionState {
  status: 'pending' | 'running' | 'measured' | 'failed' | 'unstable' | 'rejected' | 'stale' | 'hung';
  /** Core clocks, once measured. */
  cycles?: number;
  /** Why it couldn't be timed. */
  detail?: string;
}
