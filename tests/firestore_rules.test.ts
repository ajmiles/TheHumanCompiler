// ── Firestore rules tests ──
// Runs against the Firestore emulator, which loads firestore.rules: npm run test:rules (needs Java 21+). Each client
// signs in to the emulator as a made-up user (the runner as the UID in isRunner()); the token "owner" bypasses the
// rules.

import { readFileSync } from 'node:fs';
import { deleteApp, FirebaseApp, initializeApp } from 'firebase/app';
import {
  addDoc, collection, connectFirestoreEmulator, deleteDoc, doc, Firestore, getDoc, getDocs, getFirestore, limit,
  orderBy, query, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, where,
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
const entry = (uid: string, over: Record<string, unknown> = {}) =>
  ({ uid, name: 'Alice', codeSize: 12, vgprsUsed: 3, cycles: 96, timestamp: Date.now(), ...over });
const omit = (o: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
const DAY = 86_400_000;

console.log('Leaderboard entries');
await expect('allow', 'create a valid entry', () => addDoc(entries(alice), entry('alice')));
await expect('allow', 'create: a name of 20 ASCII characters', () => addDoc(entries(alice), entry('alice', { name: 'x'.repeat(20) })));
await expect('allow', 'create: a name of 20 CJK characters', () => addDoc(entries(alice), entry('alice', { name: '漢'.repeat(20) })));
await expect('allow', 'create: a name of 10 emoji (maxlength 20 counts UTF-16 units)', () => addDoc(entries(alice), entry('alice', { name: '😀'.repeat(10) })));
await expect('allow', 'create: the smallest values', () => addDoc(entries(alice), entry('alice', { codeSize: 4, vgprsUsed: 1, cycles: 1 })));
await expect('allow', 'create: the largest values', () => addDoc(entries(alice), entry('alice', { codeSize: 65536, vgprsUsed: 256, cycles: 10000000 })));
await expect('allow', 'create: a timestamp an hour ahead (clock skew)', () => addDoc(entries(alice), entry('alice', { timestamp: Date.now() + 3600000 })));
await expect('allow', 'create: another puzzle', () => addDoc(entries(alice, 'euclidean-distance'), entry('alice')));
await expect('deny', 'create unauthenticated', () => addDoc(entries(anon), entry('alice')));
await expect('deny', "create with someone else's uid", () => addDoc(entries(bob), entry('alice')));
await expect('deny', 'create with an extra field', () => addDoc(entries(alice), entry('alice', { admin: true })));
await expect('deny', 'create with hw (only the devkit adds it)', () => addDoc(entries(alice), entry('alice', { hw: { cycles: 1 } })));
for (const k of ['uid', 'name', 'codeSize', 'vgprsUsed', 'cycles', 'timestamp']) {
  await expect('deny', `create without ${k}`, () => addDoc(entries(alice), omit(entry('alice'), k)));
}
for (const [label, over] of [
  ['an empty name', { name: '' }], ['a blank name', { name: '   ' }], ['a 21-character name', { name: 'x'.repeat(21) }],
  ['a name that is not a string', { name: 42 }], ['codeSize 0', { codeSize: 0 }], ['codeSize 6 (not whole dwords)', { codeSize: 6 }],
  ['codeSize 65540', { codeSize: 65540 }], ['codeSize 12.5', { codeSize: 12.5 }], ['codeSize "12"', { codeSize: '12' }],
  ['vgprsUsed 0', { vgprsUsed: 0 }], ['vgprsUsed 257', { vgprsUsed: 257 }], ['cycles 0', { cycles: 0 }],
  ['cycles 10000001', { cycles: 10000001 }], ['negative cycles', { cycles: -5 }], ['a timestamp 2 days ahead', { timestamp: Date.now() + 2 * DAY }],
  ['timestamp 0', { timestamp: 0 }], ['a Firestore Timestamp', { timestamp: Timestamp.now() }], ['a fractional timestamp', { timestamp: Date.now() + 0.5 }],
] as const) {
  await expect('deny', `create with ${label}`, () => addDoc(entries(alice), entry('alice', over)));
}
await expect('deny', 'create under a bad puzzle id', () => addDoc(entries(alice, 'Bad Id!'), entry('alice')));
await expect('deny', 'create under a 65-character puzzle id', () => addDoc(entries(alice, 'p'.repeat(65)), entry('alice')));

const aliceEntry = doc(entries(alice));
const aliceEntry2 = doc(entries(alice));
const bobEntry = doc(entries(bob));
await setDoc(aliceEntry, entry('alice'));
await setDoc(aliceEntry2, entry('alice'));
await setDoc(bobEntry, entry('bob', { name: 'Bob' }));
const as = (db: Firestore, ref: { path: string }) => doc(db, ref.path);
const hw = (over: Record<string, unknown> = {}) =>
  ({ cycles: 48, perInvocation: [24, 24], harness: 1, measuredAt: Timestamp.now(), submittedAt: Timestamp.now(), ...over });

await expect('allow', 'get unauthenticated', () => getDoc(as(anon, aliceEntry)));
for (const cat of ['codeSize', 'vgprsUsed', 'cycles']) {
  await expect('allow', `query orderBy(${cat}) unauthenticated`, () => getDocs(query(entries(anon), orderBy(cat, 'asc'), limit(50))));
}
await expect('allow', 'query the Hardware cycles board unauthenticated', () =>
  getDocs(query(entries(anon), orderBy('hw.cycles', 'asc'), orderBy('hw.submittedAt', 'asc'), limit(50))));
await expect('allow', "query where('uid', '==', me)", () => getDocs(query(entries(alice), where('uid', '==', 'alice'))));
await expect('deny', 'update my own entry', () => updateDoc(as(alice, aliceEntry), { cycles: 1 }));
await expect('deny', 'overwrite my own entry', () => setDoc(as(alice, aliceEntry), entry('alice', { cycles: 1 })));
await expect('deny', 'add hw to my own entry', () => updateDoc(as(alice, aliceEntry), { hw: hw() }));
await expect('allow', 'the runner adds hw', () => updateDoc(as(runner, aliceEntry), { hw: hw() }));
await expect('allow', 'the runner replaces hw (a new harness)', () => updateDoc(as(runner, aliceEntry), { hw: hw({ cycles: 47, harness: 2, emulatorMismatches: 3 }) }));
await expect('deny', 'the runner changes anything else', () => updateDoc(as(runner, aliceEntry), { hw: hw(), name: 'Mallory' }));
for (const [label, value] of [
  ['fractional cycles', hw({ cycles: 4.5 })], ['negative cycles', hw({ cycles: -1 })], ['no measuredAt', omit(hw(), 'measuredAt')],
  ['no submittedAt', omit(hw(), 'submittedAt')], ['a submittedAt in milliseconds', hw({ submittedAt: Date.now() })],
  ['an extra field', hw({ detail: 'x' })], ['not a map', 48],
] as const) {
  await expect('deny', `the runner writes hw with ${label}`, () => updateDoc(as(runner, aliceEntry2), { hw: value }));
}
await expect('deny', "delete someone else's entry", () => deleteDoc(as(alice, bobEntry)));
await expect('deny', 'delete unauthenticated', () => deleteDoc(as(anon, bobEntry)));
await expect('deny', 'the runner deletes an entry', () => deleteDoc(as(runner, bobEntry)));

console.log('Submissions');
const submissions = (db: Firestore) => collection(db, 'submissions');
const submission = (uid: string, over: Record<string, unknown> = {}) => ({
  uid, puzzleId: 'signal-boost', source: 'v_mul_f32 v1, 2.0, v0\ns_endpgm', appVersion: '0.5.98', puzzleHash: '0123456789abcdef',
  createdAt: serverTimestamp(), status: 'pending', ...over,
});
const aliceSubmission = doc(submissions(alice), aliceEntry.id);
await expect('allow', 'create the source of my entry', () => setDoc(aliceSubmission, submission('alice')));
await expect('deny', 'create it again (an overwrite)', () => setDoc(aliceSubmission, submission('alice')));
await expect('deny', "create for someone else's entry", () => setDoc(doc(submissions(alice), bobEntry.id), submission('alice')));
await expect('deny', "create as someone else", () => setDoc(doc(submissions(alice), aliceEntry2.id), submission('bob')));
await expect('deny', 'create for an entry that does not exist', () => setDoc(doc(submissions(alice), 'no-such-entry'), submission('alice')));
await expect('deny', "create for my entry under another puzzle's id", () =>
  setDoc(doc(submissions(alice), aliceEntry2.id), submission('alice', { puzzleId: 'merge-streams' })));
await expect('deny', 'create unauthenticated', () => setDoc(doc(submissions(anon), aliceEntry2.id), submission('alice')));
for (const [label, over] of [
  ['a bad puzzle id', { puzzleId: '../signal-boost' }], ['status measured', { status: 'measured' }],
  ['a client createdAt', { createdAt: Timestamp.now() }], ['an extra field', { cycles: 1 }], ['an empty source', { source: '' }],
  ['a source over 100,000 characters', { source: 'x'.repeat(100001) }], ['a source that is not a string', { source: 42 }],
  ['a bad appVersion', { appVersion: 'v1' }], ['a bad puzzleHash', { puzzleHash: 'not-a-hash' }],
] as const) {
  await expect('deny', `create with ${label}`, () => setDoc(doc(submissions(alice), aliceEntry2.id), submission('alice', over)));
}
for (const k of ['uid', 'puzzleId', 'source', 'appVersion', 'puzzleHash', 'createdAt', 'status']) {
  await expect('deny', `create without ${k}`, () => setDoc(doc(submissions(alice), aliceEntry2.id), omit(submission('alice'), k)));
}

await expect('allow', 'get my own', () => getDoc(aliceSubmission));
await expect('deny', "get someone else's", () => getDoc(as(bob, aliceSubmission)));
await expect('deny', 'get unauthenticated', () => getDoc(as(anon, aliceSubmission)));
await expect('allow', 'the runner gets any', () => getDoc(as(runner, aliceSubmission)));
await expect('allow', 'the runner queries the pending ones', () =>
  getDocs(query(submissions(runner), where('status', '==', 'pending'), orderBy('createdAt', 'asc'), limit(10))));
await expect('allow', "query where('uid', '==', me)", () => getDocs(query(submissions(alice), where('uid', '==', 'alice'))));
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
await expect('allow', 'delete one that does not exist (nothing happens)', () => deleteDoc(doc(submissions(bob), aliceEntry2.id)));
await expect('deny', 'delete one that does not exist, unauthenticated', () => deleteDoc(doc(submissions(anon), aliceEntry2.id)));
await expect('allow', 'delete my own', () => deleteDoc(aliceSubmission));
await expect('allow', 'delete my own entry', () => deleteDoc(as(alice, aliceEntry)));

console.log('Trial runs (trial-{uid}: a solution timed without a leaderboard entry)');
const aliceTrial = doc(submissions(alice), 'trial-alice');
const trial = (uid: string, over: Record<string, unknown> = {}) => submission(uid, { puzzleId: 'smooth-clamp', ...over });
await expect('allow', 'run a solution on the devkit', () => setDoc(aliceTrial, trial('alice')));
await expect('allow', 'run another (it replaces the last)', () => setDoc(aliceTrial, trial('alice', { source: 'v_mov_b32 v3, v2\ns_endpgm' })));
await expect('deny', "run one under someone else's trial id", () => setDoc(doc(submissions(alice), 'trial-bob'), trial('alice')));
await expect('deny', 'run one as someone else', () => setDoc(aliceTrial, trial('bob')));
await expect('deny', 'run one unauthenticated', () => setDoc(doc(submissions(anon), 'trial-alice'), trial('alice')));
for (const [label, over] of [
  ['status measured', { status: 'measured' }], ['a client createdAt', { createdAt: Timestamp.now() }], ['a result', { cycles: 1 }],
  ['a bad puzzle id', { puzzleId: 'no such puzzle' }], ['an empty source', { source: '' }],
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
