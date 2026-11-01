// ── Firestore rules tests ──
// Runs against the Firestore emulator, which loads firestore.rules: npm run test:rules (needs Java 21+). Each client
// signs in to the emulator as a made-up user (the runner as the UID in isRunner()); the token "owner" bypasses the
// rules.

import { readFileSync } from 'node:fs';
import { deleteApp, FirebaseApp, initializeApp } from 'firebase/app';
import {
  collection, connectFirestoreEmulator, deleteDoc, deleteField, doc, Firestore, getDoc, getDocs, getFirestore, limit,
  orderBy, query, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, where, writeBatch, WriteBatch,
} from 'firebase/firestore';

// The SDK logs every write the rules turn down; the results below say which were meant to be
setLogLevel('silent');

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
const projectId = process.env.GCLOUD_PROJECT ?? 'demo-human-compiler';
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const RUNNER = /function isRunner\(\)[^}]*request\.auth\.uid == '([^']+)'/.exec(rules)![1];

const apps: FirebaseApp[] = [];
function client(uid?: string): Firestore {
  const app = initializeApp({ projectId, apiKey: 'test' }, `client${apps.length}`);
  apps.push(app);
  const db = getFirestore(app);
  const mockUserToken = uid === undefined ? undefined : uid === 'owner' ? 'owner' : { sub: uid, user_id: uid };
  connectFirestoreEmulator(db, host, Number(port), mockUserToken ? { mockUserToken } : {});
  return db;
}
const alice = client('alice');
const bob = client('bob');
const carol = client('carol');
const dave = client('dave');
const erin = client('erin');
const frank = client('frank');
const gina = client('gina');
const runner = client(RUNNER);
const anon = client();
const admin = client('owner');

let passed = 0;
let failed = 0;
async function expect(kind: 'allow' | 'deny', label: string, op: () => Promise<unknown>): Promise<void> {
  let error: unknown;
  try {
    await op();
  } catch (e) {
    error = e;
  }
  const ok = kind === 'allow' ? error === undefined : (error as { code?: string } | undefined)?.code === 'permission-denied';
  if (ok) passed++;
  else failed++;
  const why = error === undefined ? 'allowed' : String((error as Error).message).split('\n')[0];
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${kind.padEnd(5)} ${label}${ok ? '' : `: ${why}`}`);
}

await fetch(`http://${host}:${port}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });

const entries = (db: Firestore, puzzle = 'signal-boost') => collection(db, 'leaderboards', puzzle, 'entries');
const entryOf = (db: Firestore, uid: string, puzzle = 'signal-boost') => doc(db, 'leaderboards', puzzle, 'entries', uid);
const entry = (uid: string, over: Record<string, unknown> = {}) =>
  ({ uid, name: 'Alice', codeSize: 12, vgprsUsed: 3, cycles: 96, timestamp: Date.now(), ...over });
const omit = (o: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
const DAY = 86_400_000;
const as = (db: Firestore, ref: { path: string }) => doc(db, ref.path);

/** Name a player as the client does: their players doc and the name's names doc in one batch, giving up `old`. */
function nameBatch(db: Firestore, uid: string, name: string, old?: string): WriteBatch {
  const b = writeBatch(db);
  const key = name.toLowerCase();
  b.set(doc(db, 'players', uid), { name, nameKey: key });
  if (key !== old?.toLowerCase()) b.set(doc(db, 'names', key), { uid });
  if (old !== undefined && old.toLowerCase() !== key) b.delete(doc(db, 'names', old.toLowerCase()));
  return b;
}
const claim = (db: Firestore, uid: string, name: string, old?: string) => nameBatch(db, uid, name, old).commit();
/** A batch of a players doc and a names doc, as written, for the cases claim() can't make. */
function rawClaim(db: Firestore, uid: string, player: Record<string, unknown>, key: string, owner = uid) {
  const b = writeBatch(db);
  b.set(doc(db, 'players', uid), player);
  b.set(doc(db, 'names', key), { uid: owner });
  return b.commit();
}

console.log('Players and names');
await expect('allow', 'claim a name (players and names in one batch)', () => claim(alice, 'alice', 'Alice'));
await expect('allow', 'anyone reads a player', () => getDoc(doc(anon, 'players', 'alice')));
await expect('allow', 'anyone reads who owns a name', () => getDoc(doc(anon, 'names', 'alice')));
await expect('deny', "claim someone else's name", () => claim(bob, 'bob', 'Alice'));
await expect('deny', "claim someone else's name in another case", () => claim(bob, 'bob', 'ALICE'));
await expect('deny', 'name myself without claiming the name', () => setDoc(doc(bob, 'players', 'bob'), { name: 'Bob', nameKey: 'bob' }));
await expect('deny', 'claim a name without naming myself', () => setDoc(doc(bob, 'names', 'bob'), { uid: 'bob' }));
await expect('deny', 'claim a name for someone else', () => rawClaim(bob, 'bob', { name: 'Bob', nameKey: 'bob' }, 'bob', 'carol'));
await expect('deny', 'name someone else', () => claim(bob, 'carol', 'Carol'));
await expect('deny', 'a nameKey that is not the name in lower case', () => rawClaim(bob, 'bob', { name: 'Bob', nameKey: 'bobby' }, 'bobby'));
await expect('deny', 'a players doc with an extra field', () => rawClaim(bob, 'bob', { name: 'Bob', nameKey: 'bob', admin: true }, 'bob'));
await expect('deny', 'a name that is not a string', () => rawClaim(bob, 'bob', { name: 42, nameKey: '42' }, '42'));
for (const [label, name] of [['a name with spaces around it', ' Bob '], ['a 21-character name', 'x'.repeat(21)]] as const) {
  await expect('deny', `claim ${label}`, () => claim(bob, 'bob', name));
}
// These aren't even document ids (Firestore refuses names/{them} itself); the rules turn the players doc down too
for (const [label, name] of [['an empty name', ''], ['a name with a /', 'a/b'], ['the name .', '.'], ['the name ..', '..'], ['a reserved name', '__Bob__']] as const) {
  await expect('deny', `name myself ${label}`, () => setDoc(doc(bob, 'players', 'bob'), { name, nameKey: name.toLowerCase() }));
}
await expect('allow', 'claim a name of 20 CJK characters', () => claim(carol, 'carol', '漢'.repeat(20)));
await expect('allow', 'claim a name of 10 emoji (maxlength 20 counts UTF-16 units)', () => claim(dave, 'dave', '😀'.repeat(10)));
await expect('allow', 'claim a name with spaces inside it', () => claim(bob, 'bob', 'Bob the Builder'));
await expect('deny', 'claim a second name, keeping the first', () => rawClaim(bob, 'bob', { name: 'Robert', nameKey: 'robert' }, 'robert'));
await expect('deny', 'give up my name while it is still mine', () => deleteDoc(doc(bob, 'names', 'bob the builder')));
await expect('deny', "give up someone else's name", () => deleteDoc(doc(bob, 'names', 'alice')));
await expect('deny', 'overwrite a name I own', () => setDoc(doc(bob, 'names', 'bob the builder'), { uid: 'bob' }));
await expect('allow', 'rename (claim the new name, give up the old)', () => claim(bob, 'bob', 'Robert', 'Bob the Builder'));
await expect('allow', "the old name is anyone's again", () => claim(erin, 'erin', 'bob the builder'));
await expect('allow', 'change only the case of my name', () => claim(bob, 'bob', 'ROBERT', 'Robert'));

console.log('Leaderboard entries (one a player, under their uid: their best in each category)');
const aliceEntry = entryOf(alice, 'alice');
await expect('allow', 'create my entry under my name', () => setDoc(aliceEntry, entry('alice')));
await expect('allow', 'create: another puzzle', () => setDoc(entryOf(alice, 'alice', 'euclidean-distance'), entry('alice')));
await expect('allow', 'create: the smallest values', () => setDoc(entryOf(alice, 'alice', 'merge-streams'), entry('alice', { codeSize: 4, vgprsUsed: 1, cycles: 1 })));
await expect('allow', 'create: the largest values, and a timestamp an hour ahead (clock skew)', () =>
  setDoc(entryOf(alice, 'alice', 'absolute-value'), entry('alice', { codeSize: 65536, vgprsUsed: 256, cycles: 10000000, timestamp: Date.now() + 3600000 })));
await expect('allow', 'create in the batch that claims my name (a first score)', () => {
  const b = nameBatch(frank, 'frank', 'Frank');
  b.set(entryOf(frank, 'frank'), entry('frank', { name: 'Frank' }));
  return b.commit();
});
await expect('deny', 'create with no name of my own', () => setDoc(entryOf(gina, 'gina'), entry('gina', { name: 'Gina' })));
await expect('deny', "create under someone else's name", () => setDoc(entryOf(bob, 'bob'), entry('bob', { name: 'Alice' })));
await expect('deny', 'create under my name in another case', () => setDoc(entryOf(bob, 'bob'), entry('bob', { name: 'robert' })));
await expect('deny', 'create a second entry under another id', () => setDoc(doc(entries(alice, 'channel-max'), 'alice-2'), entry('alice')));
await expect('deny', "create someone else's entry", () => setDoc(entryOf(alice, 'bob', 'channel-max'), entry('bob', { name: 'ROBERT' })));
await expect('deny', 'create unauthenticated', () => setDoc(entryOf(anon, 'alice', 'channel-max'), entry('alice')));
await expect('deny', 'create with hw (only the devkit adds it)', () => setDoc(entryOf(alice, 'alice', 'channel-max'), entry('alice', { hw: { cycles: 1 } })));
await expect('deny', 'create with an extra field', () => setDoc(entryOf(alice, 'alice', 'channel-max'), entry('alice', { admin: true })));
for (const k of ['uid', 'name', 'codeSize', 'vgprsUsed', 'cycles', 'timestamp']) {
  await expect('deny', `create without ${k}`, () => setDoc(entryOf(alice, 'alice', 'channel-max'), omit(entry('alice'), k)));
}
for (const [label, over] of [
  ['codeSize 0', { codeSize: 0 }], ['codeSize 6 (not whole dwords)', { codeSize: 6 }], ['codeSize 65540', { codeSize: 65540 }],
  ['codeSize 12.5', { codeSize: 12.5 }], ['codeSize "12"', { codeSize: '12' }], ['vgprsUsed 0', { vgprsUsed: 0 }],
  ['vgprsUsed 257', { vgprsUsed: 257 }], ['cycles 0', { cycles: 0 }], ['cycles 10000001', { cycles: 10000001 }],
  ['negative cycles', { cycles: -5 }], ['a timestamp 2 days ahead', { timestamp: Date.now() + 2 * DAY }], ['timestamp 0', { timestamp: 0 }],
  ['a Firestore Timestamp', { timestamp: Timestamp.now() }], ['a fractional timestamp', { timestamp: Date.now() + 0.5 }],
] as const) {
  await expect('deny', `create with ${label}`, () => setDoc(entryOf(alice, 'alice', 'channel-max'), entry('alice', over)));
}
await expect('deny', 'create under a bad puzzle id', () => setDoc(entryOf(alice, 'alice', 'Bad Id!'), entry('alice')));
await expect('deny', 'create under a 65-character puzzle id', () => setDoc(entryOf(alice, 'alice', 'p'.repeat(65)), entry('alice')));

await expect('allow', 'a better score in one category', () => setDoc(aliceEntry, entry('alice', { cycles: 90 })));
await expect('allow', 'a score no better than my bests (sent again)', () => setDoc(aliceEntry, entry('alice', { cycles: 90 })));
await expect('allow', 'better in every category', () => setDoc(aliceEntry, entry('alice', { codeSize: 8, vgprsUsed: 2, cycles: 80 })));
for (const [label, over] of [['a worse codeSize', { codeSize: 12 }], ['worse VGPRs', { vgprsUsed: 3 }], ['worse cycles', { cycles: 81 }]] as const) {
  await expect('deny', `a best getting worse: ${label}`, () => setDoc(aliceEntry, entry('alice', { codeSize: 8, vgprsUsed: 2, cycles: 80, ...over })));
}
await expect('deny', "my entry under someone else's name", () => updateDoc(aliceEntry, { name: 'ROBERT' }));
await expect('deny', 'change its uid', () => updateDoc(aliceEntry, { uid: 'bob' }));
await expect('deny', "update someone else's entry", () => updateDoc(as(bob, aliceEntry), { cycles: 1 }));

const hw = (over: Record<string, unknown> = {}) =>
  ({ cycles: 48, perInvocation: [24, 24], harness: 1, measuredAt: Timestamp.now(), submittedAt: Timestamp.now(), ...over });
await expect('deny', 'add hw to my own entry', () => updateDoc(aliceEntry, { hw: hw() }));
await expect('allow', 'the runner adds hw', () => updateDoc(as(runner, aliceEntry), { hw: hw() }));
await expect('allow', 'the runner replaces hw (a better time, or a new harness)', () =>
  updateDoc(as(runner, aliceEntry), { hw: hw({ cycles: 47, harness: 2, emulatorMismatches: 3 }) }));
await expect('deny', 'the runner changes anything else', () => updateDoc(as(runner, aliceEntry), { hw: hw(), name: 'Mallory' }));
for (const [label, value] of [
  ['fractional cycles', hw({ cycles: 4.5 })], ['negative cycles', hw({ cycles: -1 })], ['no measuredAt', omit(hw(), 'measuredAt')],
  ['no submittedAt', omit(hw(), 'submittedAt')], ['a submittedAt in milliseconds', hw({ submittedAt: Date.now() })],
  ['an extra field', hw({ detail: 'x' })], ['not a map', 48],
] as const) {
  await expect('deny', `the runner writes hw with ${label}`, () => updateDoc(as(runner, entryOf(alice, 'alice', 'euclidean-distance')), { hw: value }));
}
await expect('allow', 'a better score once the devkit has timed me (merged: hw stays)', () =>
  setDoc(aliceEntry, entry('alice', { codeSize: 8, vgprsUsed: 2, cycles: 70 }), { merge: true }));
await expect('deny', 'a better score that drops hw', () => setDoc(aliceEntry, entry('alice', { codeSize: 8, vgprsUsed: 2, cycles: 60 })));
await expect('deny', 'take hw off my entry', () => updateDoc(aliceEntry, { hw: deleteField() }));

await expect('allow', 'get unauthenticated', () => getDoc(as(anon, aliceEntry)));
for (const cat of ['codeSize', 'vgprsUsed', 'cycles']) {
  await expect('allow', `query orderBy(${cat}) unauthenticated`, () => getDocs(query(entries(anon), orderBy(cat, 'asc'), limit(50))));
}
await expect('allow', 'query the Hardware cycles board unauthenticated', () =>
  getDocs(query(entries(anon), orderBy('hw.cycles', 'asc'), orderBy('hw.submittedAt', 'asc'), limit(50))));

await expect('allow', 'rename: then my entries take the new name', async () => {
  await claim(alice, 'alice', 'Alicia', 'Alice');
  await updateDoc(aliceEntry, { name: 'Alicia' });
});
await expect('deny', "my other entries can't change until they take it too", () =>
  setDoc(entryOf(alice, 'alice', 'euclidean-distance'), { cycles: 1 }, { merge: true }));
await expect('allow', 'once they have it, they can', () =>
  setDoc(entryOf(alice, 'alice', 'euclidean-distance'), { name: 'Alicia', cycles: 1 }, { merge: true }));
await expect('allow', "Alice is anyone's now", () => claim(gina, 'gina', 'Alice'));
await expect('deny', "delete someone else's entry", () => deleteDoc(as(alice, entryOf(frank, 'frank'))));
await expect('deny', 'delete unauthenticated', () => deleteDoc(as(anon, entryOf(frank, 'frank'))));
await expect('deny', 'the runner deletes an entry', () => deleteDoc(as(runner, entryOf(frank, 'frank'))));

console.log('Submissions (a scored solution: its source and stats, for my entry)');
const submissions = (db: Firestore) => collection(db, 'submissions');
const source = (uid: string, over: Record<string, unknown> = {}) => ({
  uid, puzzleId: 'signal-boost', source: 'v_mul_f32 v1, 2.0, v0\ns_endpgm', appVersion: '0.5.98', puzzleHash: '0123456789abcdef',
  createdAt: serverTimestamp(), status: 'pending', ...over,
});
const scored = (uid: string, over: Record<string, unknown> = {}) => source(uid, { stats: { codeSize: 8, vgprsUsed: 2, cycles: 2 }, ...over });
const aliceSubmission = doc(submissions(alice));
await expect('allow', 'send a solution for my entry', () => setDoc(aliceSubmission, scored('alice')));
await expect('allow', 'send another for the same entry', () => setDoc(doc(submissions(alice)), scored('alice')));
await expect('allow', 'send one in the batch that makes my entry', () => {
  const b = writeBatch(alice);
  b.set(entryOf(alice, 'alice', 'byte-sort'), entry('alice', { name: 'Alicia' }));
  b.set(doc(submissions(alice)), scored('alice', { puzzleId: 'byte-sort' }));
  return b.commit();
});
await expect('deny', 'send it again (an overwrite)', () => setDoc(aliceSubmission, scored('alice')));
await expect('deny', 'send one for a puzzle I have no entry on', () => setDoc(doc(submissions(alice)), scored('alice', { puzzleId: 'channel-max' })));
await expect('deny', 'send one as someone else', () => setDoc(doc(submissions(alice)), scored('bob')));
await expect('deny', 'send one unauthenticated', () => setDoc(doc(submissions(anon)), scored('alice')));
await expect('deny', 'send a scored one under a trial id', () => setDoc(doc(submissions(alice), 'trial-alice'), scored('alice')));
for (const [label, over] of [
  ['a bad puzzle id', { puzzleId: '../signal-boost' }], ['status measured', { status: 'measured' }],
  ['a client createdAt', { createdAt: Timestamp.now() }], ['an extra field', { cycles: 1 }], ['an empty source', { source: '' }],
  ['a source over 100,000 characters', { source: 'x'.repeat(100001) }], ['a source that is not a string', { source: 42 }],
  ['a bad appVersion', { appVersion: 'v1' }], ['a bad puzzleHash', { puzzleHash: 'not-a-hash' }],
  ['stats with an extra field', { stats: { codeSize: 8, vgprsUsed: 2, cycles: 2, x: 1 } }],
  ['stats with a codeSize of 6', { stats: { codeSize: 6, vgprsUsed: 2, cycles: 2 } }],
  ['stats with 0 cycles', { stats: { codeSize: 8, vgprsUsed: 2, cycles: 0 } }], ['stats that are not a map', { stats: 8 }],
] as const) {
  await expect('deny', `send one with ${label}`, () => setDoc(doc(submissions(alice)), scored('alice', over)));
}
for (const k of ['uid', 'puzzleId', 'source', 'appVersion', 'puzzleHash', 'createdAt', 'status', 'stats']) {
  await expect('deny', `send one without ${k}`, () => setDoc(doc(submissions(alice)), omit(scored('alice'), k)));
}

await expect('allow', 'get my own', () => getDoc(aliceSubmission));
await expect('deny', "get someone else's", () => getDoc(as(bob, aliceSubmission)));
await expect('deny', 'get unauthenticated', () => getDoc(as(anon, aliceSubmission)));
await expect('allow', 'the runner gets any', () => getDoc(as(runner, aliceSubmission)));
await expect('allow', 'the runner queries the pending ones', () =>
  getDocs(query(submissions(runner), where('status', '==', 'pending'), orderBy('createdAt', 'asc'), limit(10))));
await expect('allow', "query where('uid', '==', me) on a puzzle", () =>
  getDocs(query(submissions(alice), where('uid', '==', 'alice'), where('puzzleId', '==', 'signal-boost'))));
await expect('deny', 'query all of them', () => getDocs(query(submissions(alice), limit(10))));
await expect('deny', "query someone else's", () => getDocs(query(submissions(bob), where('uid', '==', 'alice'))));

await expect('allow', 'the runner claims one', () => updateDoc(as(runner, aliceSubmission), { status: 'running', harness: 1, updatedAt: serverTimestamp() }));
await expect('allow', 'the runner records the result', () =>
  updateDoc(as(runner, aliceSubmission), { status: 'measured', cycles: 48, claimMismatches: ['codeSize: claimed 4, actually 8'], updatedAt: serverTimestamp() }));
await expect('allow', 'the runner records why it could not time it', () =>
  updateDoc(as(runner, aliceSubmission), { status: 'rejected', detail: 'Line 1: s_getpc_b64 uses program addresses' }));
await expect('deny', 'the runner sets an unknown status', () => updateDoc(as(runner, aliceSubmission), { status: 'pending' }));
await expect('deny', 'the runner changes the source', () => updateDoc(as(runner, aliceSubmission), { status: 'running', source: 'x' }));
await expect('deny', 'the author changes the status', () => updateDoc(aliceSubmission, { status: 'measured' }));
await expect('deny', "delete someone else's", () => deleteDoc(as(bob, aliceSubmission)));
await expect('deny', 'the runner deletes one', () => deleteDoc(as(runner, aliceSubmission)));
await expect('allow', 'delete one that does not exist (nothing happens)', () => deleteDoc(doc(submissions(bob), 'no-such-submission')));
await expect('deny', 'delete one that does not exist, unauthenticated', () => deleteDoc(doc(submissions(anon), 'no-such-submission')));
await expect('allow', 'delete my own', () => deleteDoc(aliceSubmission));
await expect('allow', 'delete my own entry', () => deleteDoc(aliceEntry));

console.log('Trial runs (trial-{uid}: a solution timed without a leaderboard entry)');
const aliceTrial = doc(submissions(alice), 'trial-alice');
const trial = (uid: string, over: Record<string, unknown> = {}) => source(uid, { puzzleId: 'smooth-clamp', ...over });
await expect('allow', 'run a solution on the devkit', () => setDoc(aliceTrial, trial('alice')));
await expect('allow', 'run another (it replaces the last)', () => setDoc(aliceTrial, trial('alice', { source: 'v_mov_b32 v3, v2\ns_endpgm' })));
await expect('deny', "run one under someone else's trial id", () => setDoc(doc(submissions(alice), 'trial-bob'), trial('alice')));
await expect('deny', 'run one as someone else', () => setDoc(aliceTrial, trial('bob')));
await expect('deny', 'run one unauthenticated', () => setDoc(doc(submissions(anon), 'trial-alice'), trial('alice')));
for (const [label, over] of [
  ['status measured', { status: 'measured' }], ['a client createdAt', { createdAt: Timestamp.now() }], ['a result', { cycles: 1 }],
  ['a bad puzzle id', { puzzleId: 'no such puzzle' }], ['an empty source', { source: '' }],
  ['stats (it has no entry)', { stats: { codeSize: 8, vgprsUsed: 2, cycles: 2 } }],
] as const) {
  await expect('deny', `run one with ${label}`, () => setDoc(aliceTrial, trial('alice', over)));
}
await expect('allow', 'get my own trial', () => getDoc(aliceTrial));
await expect('deny', "get someone else's trial", () => getDoc(as(bob, aliceTrial)));
await expect('allow', 'the runner claims it', () => updateDoc(as(runner, aliceTrial), { status: 'running', updatedAt: serverTimestamp() }));
await expect('allow', 'the runner records its result', () =>
  updateDoc(as(runner, aliceTrial), { status: 'measured', cycles: 38, harness: 2, updatedAt: serverTimestamp() }));
await expect('deny', 'the player times their own', () => updateDoc(aliceTrial, { status: 'measured', cycles: 1 }));
await expect('deny', 'the player sets it pending again, keeping the result', () =>
  updateDoc(aliceTrial, { status: 'pending', createdAt: serverTimestamp() }));
await expect('allow', 'run another after that: the last result goes', async () => {
  await setDoc(aliceTrial, trial('alice'));
  const d = (await getDoc(aliceTrial)).data();
  if (d?.status !== 'pending' || 'cycles' in d || 'harness' in d) throw new Error(`the last result stayed: ${JSON.stringify(d)}`);
});
await expect('allow', 'delete my own trial', () => deleteDoc(aliceTrial));

console.log('Runner status and everything else');
const status = (db: Firestore) => doc(db, 'runner', 'status');
await expect('allow', 'the runner writes its status', () => setDoc(status(runner), { heartbeat: serverTimestamp(), queued: 0, harness: 1, version: '0.5.98' }));
await expect('allow', 'anyone reads it', () => getDoc(status(anon)));
await expect('deny', 'a player writes it', () => setDoc(status(alice), { heartbeat: serverTimestamp() }));
await expect('deny', 'the runner writes another runner document', () => setDoc(doc(runner, 'runner', 'other'), { a: 1 }));
await expect('deny', 'write outside the known collections', () => setDoc(doc(alice, 'users', 'alice'), { a: 1 }));
await expect('deny', 'read outside the known collections', () => getDoc(doc(alice, 'users', 'alice')));
await expect('deny', 'write a leaderboard parent document', () => setDoc(doc(alice, 'leaderboards', 'signal-boost'), { a: 1 }));
await expect('allow', 'the owner token bypasses the rules (test setup)', () => setDoc(doc(admin, 'users', 'x'), { a: 1 }));

console.log(`\n  ${passed} passed, ${failed} failed`);
await Promise.all(apps.map(app => deleteApp(app)));
process.exit(failed > 0 ? 1 : 0);
