// ── Shares: sandbox code stored for a link ──
// shares/{id} holds { source, appVersion, createdAt }. firestore.rules lets anyone read one by its id (nobody can
// list them), and lets a signed-in player make one, which is never changed or deleted.

import { FirebaseError } from 'firebase/app';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { onlineDb } from './online-leaderboard';
import { MAX_SHARE_CHARS, newShareId } from '../puzzle/share';
import { VERSION } from '../version';

export type ShareOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: 'too-long' | 'unreachable' | 'failed' };

/**
 * Store `source` as a new share, under a new random id. The rules refuse a write to an id that's taken (it would change
 * that share), so on a refusal another id is tried.
 */
export async function createShare(source: string): Promise<ShareOutcome> {
  if (source.length > MAX_SHARE_CHARS) return { ok: false, reason: 'too-long' };
  const db = await onlineDb();
  if (!db) return { ok: false, reason: 'unreachable' };
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newShareId();
    try {
      await setDoc(doc(db, 'shares', id), { source, appVersion: VERSION, createdAt: serverTimestamp() });
      return { ok: true, id };
    } catch (e) {
      if ((e as FirebaseError).code !== 'permission-denied') {
        console.warn('Failed to share the code:', e);
        return { ok: false, reason: 'failed' };
      }
    }
  }
  return { ok: false, reason: 'failed' };
}

/** A share's code, and the version of the game it was shared from. */
export interface Share {
  source: string;
  appVersion: string;
}

/** The share with this id: null when there's none, 'unreachable' when it can't be read now. */
export async function fetchShare(id: string): Promise<Share | null | 'unreachable'> {
  const db = await onlineDb();
  if (!db) return 'unreachable';
  try {
    const d = (await getDoc(doc(db, 'shares', id))).data();
    if (typeof d?.source !== 'string') return null;
    return { source: d.source, appVersion: typeof d.appVersion === 'string' ? d.appVersion : '' };
  } catch (e) {
    console.warn('Failed to fetch the shared code:', e);
    return 'unreachable';
  }
}
