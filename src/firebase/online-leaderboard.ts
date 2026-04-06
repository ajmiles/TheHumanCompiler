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
  getDocs,
  Firestore,
} from 'firebase/firestore';
import { firebaseConfig, FIREBASE_ENABLED } from './config';
import { LeaderboardEntry, LeaderboardCategory } from '../puzzle/leaderboard';

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

/**
 * Submit a score to the online leaderboard.
 * Stores in Firestore collection: leaderboards/{puzzleId}/entries
 */
export async function submitOnlineScore(
  puzzleId: string,
  entry: LeaderboardEntry,
): Promise<boolean> {
  const ok = await ensureInit();
  if (!ok || !db) return false;

  try {
    const entriesRef = collection(db, 'leaderboards', puzzleId, 'entries');
    await addDoc(entriesRef, {
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
 */
export async function fetchOnlineLeaderboard(
  puzzleId: string,
  category: LeaderboardCategory,
  maxEntries = 20,
): Promise<LeaderboardEntry[]> {
  const ok = await ensureInit();
  if (!ok || !db) return [];

  try {
    const entriesRef = collection(db, 'leaderboards', puzzleId, 'entries');
    const q = query(entriesRef, orderBy(category, 'asc'), limit(maxEntries));
    const snapshot = await getDocs(q);

    const entries: LeaderboardEntry[] = [];
    snapshot.forEach((doc) => {
      const d = doc.data();
      entries.push({
        name: d.name ?? 'Anonymous',
        codeSize: d.codeSize ?? 0,
        vgprsUsed: d.vgprsUsed ?? 0,
        cycles: d.cycles ?? 0,
        timestamp: d.timestamp ?? 0,
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
