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

// ── Podium + Context Types & Helpers ──

export interface LeaderboardEntryWithOwner extends LeaderboardEntry {
  isMine: boolean;
}

export interface VisibleRowResult {
  indices: number[];
  separatorBefore: Set<number>;
}

/**
 * Compute which row indices to display in a "podium + context" view.
 * - Shows all entries if total ≤ 8.
 * - Otherwise shows top 3 (podium) + 2 above/below the user's best position.
 * - Returns separator positions where there are gaps between shown rows.
 */
export function computeVisibleRows<T extends { isMine: boolean }>(
  entries: T[],
): VisibleRowResult {
  const total = entries.length;

  if (total <= 8) {
    return {
      indices: Array.from({ length: total }, (_, i) => i),
      separatorBefore: new Set(),
    };
  }

  const PODIUM = 3;
  const CONTEXT_RADIUS = 2;

  const visible = new Set<number>();
  for (let i = 0; i < Math.min(PODIUM, total); i++) visible.add(i);

  const myIndex = entries.findIndex(e => e.isMine);
  if (myIndex !== -1) {
    const start = Math.max(0, myIndex - CONTEXT_RADIUS);
    const end = Math.min(total - 1, myIndex + CONTEXT_RADIUS);
    for (let i = start; i <= end; i++) visible.add(i);
  }

  const indices = [...visible].sort((a, b) => a - b);

  const separatorBefore = new Set<number>();
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) {
      separatorBefore.add(indices[i]);
    }
  }

  return { indices, separatorBefore };
}
