// ── Online Leaderboard (Firebase Firestore) ──
// Syncs leaderboard entries to Firestore for global visibility.
// Falls back gracefully to local-only when Firebase is not configured.

import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, Auth } from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  where,
  getDocs,
  deleteDoc,
  Firestore,
} from 'firebase/firestore';
import { firebaseConfig, FIREBASE_ENABLED } from './config';
import { LeaderboardEntry, LeaderboardEntryWithOwner, LeaderboardCategory } from '../puzzle/leaderboard';

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let initialized = false;

async function ensureInit(): Promise<boolean> {
  if (!FIREBASE_ENABLED) return false;
  if (initialized) return db !== null;

  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    await signInAnonymously(auth);
    initialized = true;
    return true;
  } catch (e) {
    console.warn('Firebase init failed, using local leaderboards only:', e);
    initialized = true;
    return false;
  }
}

/** Get the current anonymous user's UID. */
function getUid(): string | null {
  return auth?.currentUser?.uid ?? null;
}

/** Expose the current user's UID for ownership checks. */
export function getMyUid(): string | null {
  return auth?.currentUser?.uid ?? null;
}

/**
 * Submit a score to the online leaderboard.
 * Stores UID alongside the entry for ownership tracking.
 */
export async function submitOnlineScore(
  puzzleId: string,
  entry: LeaderboardEntry,
): Promise<boolean> {
  const ok = await ensureInit();
  if (!ok || !db) return false;

  const uid = getUid();
  if (!uid) return false;

  try {
    const entriesRef = collection(db, 'leaderboards', puzzleId, 'entries');
    await addDoc(entriesRef, {
      uid,
      name: entry.name,
      codeSize: entry.codeSize,
      vgprsUsed: entry.vgprsUsed,
      cycles: entry.cycles,
      timestamp: entry.timestamp,
    });
    return true;
  } catch (e) {
    console.warn('Failed to submit online score:', e);
    return false;
  }
}

/**
 * Fetch the top entries for a puzzle from Firestore, sorted by category.
 * Each entry includes an `isMine` flag based on the current user's UID.
 */
export async function fetchOnlineLeaderboard(
  puzzleId: string,
  category: LeaderboardCategory,
  maxEntries = 20,
): Promise<LeaderboardEntryWithOwner[]> {
  const ok = await ensureInit();
  if (!ok || !db) return [];

  const currentUid = getUid();

  try {
    const entriesRef = collection(db, 'leaderboards', puzzleId, 'entries');
    const q = query(entriesRef, orderBy(category, 'asc'), limit(maxEntries));
    const snapshot = await getDocs(q);

    const entries: LeaderboardEntryWithOwner[] = [];
    snapshot.forEach((doc) => {
      const d = doc.data();
      entries.push({
        name: d.name ?? 'Anonymous',
        codeSize: d.codeSize ?? 0,
        vgprsUsed: d.vgprsUsed ?? 0,
        cycles: d.cycles ?? 0,
        timestamp: d.timestamp ?? 0,
        isMine: !!currentUid && d.uid === currentUid,
      });
    });
    return entries;
  } catch (e) {
    console.warn('Failed to fetch online leaderboard:', e);
    return [];
  }
}

/** Check if online leaderboards are available. */
export function isOnlineEnabled(): boolean {
  return FIREBASE_ENABLED;
}

/**
 * Delete all of the current user's scores for a specific puzzle.
 * Only deletes entries matching the current anonymous UID.
 */
export async function deleteMyOnlineScores(puzzleId: string): Promise<number> {
  const ok = await ensureInit();
  if (!ok || !db) return 0;

  const uid = getUid();
  if (!uid) return 0;

  try {
    const entriesRef = collection(db, 'leaderboards', puzzleId, 'entries');
    const q = query(entriesRef, where('uid', '==', uid));
    const snapshot = await getDocs(q);

    let deleted = 0;
    const promises: Promise<void>[] = [];
    snapshot.forEach((doc) => {
      promises.push(deleteDoc(doc.ref));
      deleted++;
    });
    await Promise.all(promises);
    return deleted;
  } catch (e) {
    console.warn('Failed to delete online scores:', e);
    return 0;
  }
}

/**
 * Delete all of the current user's scores across ALL puzzles.
 * Requires knowing which puzzle IDs to check.
 */
export async function deleteAllMyOnlineScores(puzzleIds: string[]): Promise<number> {
  let total = 0;
  for (const pid of puzzleIds) {
    total += await deleteMyOnlineScores(pid);
  }
  return total;
}
