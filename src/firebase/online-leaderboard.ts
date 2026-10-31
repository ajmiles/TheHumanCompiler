// ── Online Leaderboard (Firebase Firestore) ──
// Syncs leaderboard entries to Firestore for global visibility.
// Falls back gracefully to local-only when Firebase is not configured.

import { initializeApp, FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously, Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  limit,
  where,
  getDocs,
  deleteDoc,
  Firestore,
} from 'firebase/firestore';
import { firebaseConfig, FIREBASE_ENABLED, FIREBASE_EMULATORS } from './config';
import {
  LeaderboardEntry,
  LeaderboardEntryWithOwner,
  LeaderboardCategory,
  HardwareBoard,
  HardwareEntry,
  RunnerStatus,
  SubmissionState,
} from '../puzzle/leaderboard';
import { VERSION } from '../version';

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
/**
 * The one sign-in, which every caller shares. Separate sign-ins at the same time would each make a new anonymous
 * user, and a write queued as one of them is never sent once another takes over.
 */
let initPromise: Promise<boolean> | null = null;

function ensureInit(): Promise<boolean> {
  if (!FIREBASE_ENABLED) return Promise.resolve(false);
  initPromise ??= init();
  return initPromise;
}

async function init(): Promise<boolean> {
  try {
    const emulators = FIREBASE_EMULATORS;
    app = initializeApp(emulators ? { ...firebaseConfig, projectId: emulators.projectId } : firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    if (emulators) {
      console.info('Online leaderboards use the local Firebase emulators (npm run emulators); VITE_FIREBASE_PROD=1 uses the live ones');
      connectAuthEmulator(auth, `http://${emulators.host}:${emulators.authPort}`, { disableWarnings: true });
      connectFirestoreEmulator(db, emulators.host, emulators.firestorePort);
    }
    await signInAnonymously(auth);
    return true;
  } catch (e) {
    console.warn('Firebase init failed, using local leaderboards only:', e);
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

/** A solution's source, uploaded privately with its score so that the devkit can time it on hardware. */
export interface SubmittedSolution {
  source: string;
  /** puzzleHash() of the puzzle the player solved (src/hardware/hash.ts). */
  puzzleHash: string;
}

/**
 * Submit a score to the online leaderboard, storing the UID with the entry for ownership. With a solution, its
 * source goes up too, under the entry's id, for the devkit; a failure there doesn't lose the score.
 * Returns the entry's id, or null if it wasn't submitted.
 */
export async function submitOnlineScore(
  puzzleId: string,
  entry: LeaderboardEntry,
  solution?: SubmittedSolution,
): Promise<string | null> {
  const ok = await ensureInit();
  if (!ok || !db) return null;

  const uid = getUid();
  if (!uid) return null;

  const entryRef = doc(collection(db, 'leaderboards', puzzleId, 'entries'));
  try {
    await setDoc(entryRef, {
      uid,
      name: entry.name,
      codeSize: entry.codeSize,
      vgprsUsed: entry.vgprsUsed,
      cycles: entry.cycles,
      timestamp: entry.timestamp,
    });
  } catch (e) {
    console.warn('Failed to submit online score:', e);
    return null;
  }
  if (solution) {
    try {
      await setDoc(doc(db, 'submissions', entryRef.id), {
        uid,
        puzzleId,
        source: solution.source,
        appVersion: VERSION,
        puzzleHash: solution.puzzleHash,
        createdAt: serverTimestamp(),
        status: 'pending',
      });
    } catch (e) {
      console.warn('Failed to upload the solution for the devkit:', e);
    }
  }
  return entryRef.id;
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

/**
 * The entries the devkit has timed, fastest first. A tie goes to the one submitted first, by the server's clock: the
 * devkit copies the submission's createdAt into hw.submittedAt (the entry's own timestamp is the player's clock).
 */
export async function fetchHardwareLeaderboard(puzzleId: string, maxEntries = 50): Promise<HardwareEntry[]> {
  const ok = await ensureInit();
  if (!ok || !db) return [];

  const currentUid = getUid();
  try {
    const entriesRef = collection(db, 'leaderboards', puzzleId, 'entries');
    const snapshot = await getDocs(query(entriesRef, orderBy('hw.cycles', 'asc'), orderBy('hw.submittedAt', 'asc'), limit(maxEntries)));
    return snapshot.docs.map(entryDoc => {
      const d = entryDoc.data();
      return {
        id: entryDoc.id,
        name: d.name ?? 'Anonymous',
        cycles: d.hw?.cycles ?? 0,
        isMine: !!currentUid && d.uid === currentUid,
      };
    });
  } catch (e) {
    console.warn('Failed to fetch the Hardware cycles leaderboard:', e);
    return [];
  }
}

/** The devkit's status, or null when there's no devkit (yet): then nothing is timed on hardware. */
export async function fetchRunnerStatus(): Promise<RunnerStatus | null> {
  const ok = await ensureInit();
  if (!ok || !db) return null;
  try {
    const snap = await getDoc(doc(db, 'runner', 'status'));
    const d = snap.data();
    return d ? { lastSeen: d.heartbeat?.toMillis?.() ?? 0, queued: d.queued ?? 0 } : null;
  } catch {
    return null; // e.g. before the rules that let it be read are deployed
  }
}

/** The Hardware cycles board for a puzzle, or null when there's no devkit (and so no board). */
export async function fetchHardwareBoard(puzzleId: string): Promise<HardwareBoard | null> {
  const status = await fetchRunnerStatus();
  return status ? { status, entries: await fetchHardwareLeaderboard(puzzleId) } : null;
}

/** Follow the submission of one of my entries until the returned function is called; null when it can't be read. */
export function watchSubmission(entryId: string, onChange: (state: SubmissionState | null) => void): () => void {
  if (!db) return () => undefined;
  return onSnapshot(doc(db, 'submissions', entryId), snap => {
    if (!snap.exists() && snap.metadata.fromCache) return; // wait for the server's answer
    const d = snap.data();
    onChange(d ? { status: d.status, cycles: d.cycles, detail: d.detail } : null);
  }, () => onChange(null));
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
    snapshot.forEach((entryDoc) => {
      promises.push(deleteDoc(entryDoc.ref));
      // And the solution uploaded with it, if any
      promises.push(deleteDoc(doc(entryDoc.ref.firestore, 'submissions', entryDoc.id)).catch(() => undefined));
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
