// ── Online Leaderboard (Firebase Firestore) ──
// Syncs leaderboard entries to Firestore for global visibility.
// Falls back gracefully to local-only when Firebase is not configured.

import { initializeApp, FirebaseApp, FirebaseError } from 'firebase/app';
import {
  connectAuthEmulator, getAuth, signInAnonymously, Auth, GoogleAuthProvider, linkWithPopup, signInWithCredential,
  signInWithPopup, signOut,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  limit,
  where,
  getDocs,
  deleteDoc,
  writeBatch,
  Firestore,
  WriteBatch,
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
  mergeBests,
  nameKeyOf,
} from '../puzzle/leaderboard';
import { ALL_PUZZLES } from '../puzzle/puzzles';
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
    // A player who signed in with Google stays signed in; anyone else plays as this browser's anonymous player
    await auth.authStateReady();
    if (!auth.currentUser) await signInAnonymously(auth);
    return true;
  } catch (e) {
    console.warn('Firebase init failed, using local leaderboards only:', e);
    return false;
  }
}

/** The current player's uid. */
function getUid(): string | null {
  return auth?.currentUser?.uid ?? null;
}

/** Firestore, once this browser has signed in (anonymously, unless with Google); null when that can't be done. */
export async function onlineDb(): Promise<Firestore | null> {
  return (await ensureInit()) ? db : null;
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

// ── The player: their name, and their Google account ──

/** The player in this browser: the name they own (null until they take one), and the Google account they use, if any. */
export interface Player {
  uid: string;
  name: string | null;
  /** The Google account's email (or name), when signed in with Google: then the player is the same on every device. */
  google: string | null;
}

interface PlayerDoc {
  name: string;
  nameKey: string;
}

export async function getPlayer(): Promise<Player | null> {
  const ok = await ensureInit();
  const user = auth?.currentUser;
  if (!ok || !db || !user) return null;
  let name: string | null = null;
  try {
    name = ((await getDoc(doc(db, 'players', user.uid))).data() as PlayerDoc | undefined)?.name ?? null;
  } catch {
    // unreachable: no name for now
  }
  const google = user.providerData.find(p => p.providerId === 'google.com');
  return { uid: user.uid, name, google: google ? google.email ?? google.displayName ?? 'Google' : null };
}

/**
 * Add the writes that give the player `name` to a batch: their players doc, and names/{key} if it isn't theirs yet,
 * giving up their old name. Whether the name is anyone else's must have been checked: then the batch fails.
 */
function nameWrites(batch: WriteBatch, uid: string, name: string, player: PlayerDoc | undefined, ownedByMe: boolean): void {
  if (player?.name === name) return;
  const key = nameKeyOf(name);
  batch.set(doc(db!, 'players', uid), { name, nameKey: key });
  if (!ownedByMe) batch.set(doc(db!, 'names', key), { uid });
  if (player && player.nameKey !== key) batch.delete(doc(db!, 'names', player.nameKey));
}

/** The player's entries on other puzzles take their new name (the rules want an entry's name to be the player's). */
async function renameEntries(uid: string, name: string): Promise<void> {
  await Promise.all(ALL_PUZZLES.map(async p => {
    const ref = doc(db!, 'leaderboards', p.id, 'entries', uid);
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().name !== name) await updateDoc(ref, { name });
  })).catch(e => console.warn('Failed to rename entries:', e));
}

/** Whose a name is, for the player in this browser. */
async function nameOwner(name: string, uid: string): Promise<'mine' | 'free' | 'taken'> {
  const owner = (await getDoc(doc(db!, 'names', nameKeyOf(name)))).data()?.uid as string | undefined;
  return owner === undefined ? 'free' : owner === uid ? 'mine' : 'taken';
}

export type NameResult = 'ok' | 'name-taken' | 'failed';

/** Change the player's name (or take their first): the old one is given up, and their entries show the new one. */
export async function renamePlayer(newName: string): Promise<NameResult> {
  const ok = await ensureInit();
  const uid = getUid();
  const name = newName.trim();
  if (!ok || !db || !uid || !name) return 'failed';
  try {
    const owner = await nameOwner(name, uid);
    if (owner === 'taken') return 'name-taken';
    const player = (await getDoc(doc(db, 'players', uid))).data() as PlayerDoc | undefined;
    const batch = writeBatch(db);
    nameWrites(batch, uid, name, player, owner === 'mine');
    await batch.commit();
    await renameEntries(uid, name);
    return 'ok';
  } catch (e) {
    console.warn('Failed to rename:', e);
    return (await nameOwner(name, uid).catch(() => 'free')) === 'taken' ? 'name-taken' : 'failed';
  }
}

export type SignInResult = 'linked' | 'switched' | 'cancelled' | 'blocked' | 'failed';

/**
 * Sign in with Google. This browser's anonymous player becomes the account's (keeping their name and scores), so that
 * signing in elsewhere is the same player: 'linked'. If the account already has a player, this browser plays as them
 * from now on, and its anonymous player is left as it was: 'switched'.
 */
export async function signInWithGoogle(): Promise<SignInResult> {
  // No waiting before the popup, which browsers allow only straight from a click: a player has been shown, so this
  // browser has signed in already
  const user = auth?.currentUser;
  if (!auth || !user) return 'failed';
  const provider = new GoogleAuthProvider();
  try {
    if (!user.isAnonymous) {
      await signInWithPopup(auth, provider);
      return 'switched';
    }
    await linkWithPopup(user, provider);
    return 'linked';
  } catch (e) {
    const code = (e as FirebaseError).code;
    if (code === 'auth/credential-already-in-use') {
      const credential = GoogleAuthProvider.credentialFromError(e as FirebaseError);
      if (credential) {
        await signInWithCredential(auth, credential);
        return 'switched';
      }
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'cancelled';
    if (code === 'auth/popup-blocked') return 'blocked';
    console.warn('Google sign-in failed:', e);
    return 'failed';
  }
}

/** What to tell the player when signing in with Google didn't work (null when it did, or they stopped it). */
export function signInProblem(result: SignInResult): string | null {
  return result === 'blocked' ? 'Your browser blocked the Google sign-in window: allow pop-ups for this site, then try again.'
    : result === 'failed' ? 'Signing in with Google failed.' : null;
}

/** Sign out of Google: this browser then plays as a new anonymous player, with no name yet. */
export async function signOutPlayer(): Promise<void> {
  if (!(await ensureInit()) || !auth) return;
  await signOut(auth);
  await signInAnonymously(auth);
}

// ── Scores ──

export type SubmitOutcome =
  | { ok: true; improved: LeaderboardCategory[]; submissionId: string | null; myUid: string }
  | { ok: false; reason: 'name-taken' | 'failed' };

/**
 * Submit a score under `entry.name`, which the player takes (or changes to) if it's nobody else's. Their entry on the
 * puzzle (under their uid) keeps their best in each category; `improved` says which this score bettered. With a
 * solution, its source goes up too, as a new submission with the stats it scored, for the devkit to time; a failure
 * there doesn't lose the score.
 */
export async function submitOnlineScore(
  puzzleId: string,
  entry: LeaderboardEntry,
  solution?: SubmittedSolution,
): Promise<SubmitOutcome> {
  const ok = await ensureInit();
  const uid = getUid();
  const name = entry.name.trim();
  if (!ok || !db || !uid || !name) return { ok: false, reason: 'failed' };

  const entryRef = doc(db, 'leaderboards', puzzleId, 'entries', uid);
  let improved: LeaderboardCategory[];
  let renamed: boolean;
  try {
    const [owner, playerSnap, entrySnap] = await Promise.all([nameOwner(name, uid), getDoc(doc(db, 'players', uid)), getDoc(entryRef)]);
    if (owner === 'taken') return { ok: false, reason: 'name-taken' };
    const player = playerSnap.data() as PlayerDoc | undefined;
    const merged = mergeBests(entrySnap.data() as LeaderboardEntry | undefined, entry);
    improved = merged.improved;
    renamed = player !== undefined && player.name !== name;
    const batch = writeBatch(db);
    nameWrites(batch, uid, name, player, owner === 'mine');
    // Merged, so that the devkit's hw stays
    batch.set(entryRef, { uid, name, ...merged.bests, timestamp: entry.timestamp }, { merge: true });
    await batch.commit();
  } catch (e) {
    console.warn('Failed to submit online score:', e);
    // The name may have gone to someone else meanwhile
    return { ok: false, reason: (await nameOwner(name, uid).catch(() => 'free')) === 'taken' ? 'name-taken' : 'failed' };
  }

  let submissionId: string | null = null;
  if (solution) {
    try {
      const ref = doc(collection(db, 'submissions'));
      await setDoc(ref, {
        uid,
        puzzleId,
        source: solution.source,
        appVersion: VERSION,
        puzzleHash: solution.puzzleHash,
        createdAt: serverTimestamp(),
        status: 'pending',
        stats: { codeSize: entry.codeSize, vgprsUsed: entry.vgprsUsed, cycles: entry.cycles },
      });
      submissionId = ref.id;
    } catch (e) {
      console.warn('Failed to upload the solution for the devkit:', e);
    }
  }
  if (renamed) await renameEntries(uid, name);
  return { ok: true, improved, submissionId, myUid: uid };
}

/**
 * Fetch the top entries for a puzzle from Firestore, sorted by category: each player once, at their best.
 * Each entry includes an `isMine` flag based on the current user's UID. Null if the board can't be read.
 */
export async function fetchOnlineLeaderboard(
  puzzleId: string,
  category: LeaderboardCategory,
  maxEntries = 20,
): Promise<LeaderboardEntryWithOwner[] | null> {
  const ok = await ensureInit();
  if (!ok || !db) return null;

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
    return null;
  }
}

/** A puzzle's boards in each of `categories` (in that order), or null if any of them can't be read. */
export async function fetchOnlineBoards(puzzleId: string, categories: readonly LeaderboardCategory[], maxEntries = 50):
  Promise<LeaderboardEntryWithOwner[][] | null> {
  const boards = await Promise.all(categories.map(c => fetchOnlineLeaderboard(puzzleId, c, maxEntries)));
  return boards.every(b => b !== null) ? boards as LeaderboardEntryWithOwner[][] : null;
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

/** Follow one of my submissions until the returned function is called; null when it can't be read. */
export function watchSubmission(submissionId: string, onChange: (state: SubmissionState | null) => void): () => void {
  if (!db) return () => undefined;
  return onSnapshot(doc(db, 'submissions', submissionId), snap => {
    if (!snap.exists() && snap.metadata.fromCache) return; // wait for the server's answer
    const d = snap.data();
    onChange(d ? { status: d.status, cycles: d.cycles, detail: d.detail } : null);
  }, () => onChange(null));
}

/**
 * Run a solution on the devkit without a score, so that it goes on no board. A player has one such run
 * (submissions/trial-{uid}), which the next replaces. Its id, to follow with watchSubmission(), or null if it couldn't
 * be sent.
 */
export async function runOnDevkit(puzzleId: string, solution: SubmittedSolution): Promise<string | null> {
  const ok = await ensureInit();
  const uid = getUid();
  if (!ok || !db || !uid) return null;
  const id = `trial-${uid}`;
  try {
    await setDoc(doc(db, 'submissions', id), {
      uid,
      puzzleId,
      source: solution.source,
      appVersion: VERSION,
      puzzleHash: solution.puzzleHash,
      createdAt: serverTimestamp(),
      status: 'pending',
    });
    return id;
  } catch (e) {
    console.warn('Failed to send the solution to the devkit:', e);
    return null;
  }
}

/** Check if online leaderboards are available. */
export function isOnlineEnabled(): boolean {
  return FIREBASE_ENABLED;
}

/**
 * Delete the player's score on a puzzle: their entry, and the solutions they sent with their scores there (not their
 * trial run, or their name). How many entries went (0 or 1).
 */
export async function deleteMyOnlineScores(puzzleId: string): Promise<number> {
  const ok = await ensureInit();
  if (!ok || !db) return 0;

  const uid = getUid();
  if (!uid) return 0;

  try {
    const entryRef = doc(db, 'leaderboards', puzzleId, 'entries', uid);
    const [entry, sent] = await Promise.all([
      getDoc(entryRef),
      getDocs(query(collection(db, 'submissions'), where('uid', '==', uid), where('puzzleId', '==', puzzleId))),
    ]);
    await Promise.all([
      deleteDoc(entryRef),
      ...sent.docs.filter(d => !d.id.startsWith('trial-')).map(d => deleteDoc(d.ref)),
    ]);
    return entry.exists() ? 1 : 0;
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
