# TheHumanCompiler
A programming mini-game based on the AMD RDNA2 ISA

## Development

```sh
npm install            # also points git at .githooks (pre-commit bumps src/version.ts)
npm run dev            # local dev server; its online leaderboards use the Firebase emulators
npm run emulators      # the Firebase Auth and Firestore emulators (needs Java 21+)
npm test               # ISA/assembler/emulator test suite
npm run test:rules     # firestore.rules against the Firestore emulator (needs Java 21+)
npm run build          # type-check + production build into dist/ (with dist/hw/verifier.js)
npm run test:verifier  # after a build: run dist/hw/verifier.js in QuickJS, as the devkit will
```

A dev build never touches the live leaderboards: it signs in to the local
emulators under the `demo-human-compiler` project. To point it at the live
project anyway, run it with `VITE_FIREBASE_PROD=1`.

## Hardware cycles (in progress)

A devkit is to time submitted solutions on real RDNA2 hardware, for a
"Hardware cycles" leaderboard. The public half is in
[`src/hardware/`](src/hardware/): `verify()` checks a solution in the emulator
and wraps it in a timing harness ([`harness.ts`](src/hardware/harness.ts)), and
`score()` turns the devkit's runs into the result
([`protocol.ts`](src/hardware/protocol.ts) describes what the runner gets and
sends back, and what it reads and writes in Firestore). The build bundles them
into `dist/hw/verifier.js`, which the devkit runs in QuickJS. `npm run hw-job`
makes jobs by hand, including a set of calibration programs (see
[`scripts/hw-job.ts`](scripts/hw-job.ts)).

While the devkit is online (it keeps `runner/status` up to date), submitting a
score also uploads the solution's source, privately, to `submissions/{entryId}`,
and the leaderboards show a Hardware cycles board of the entries it has timed.
Until then the site shows neither, and uploads nothing. To launch it:

1. In the Firebase console, add an email/password user for the devkit, and put
   its UID in `isRunner()` in [`firestore.rules`](firestore.rules).
2. Deploy the rules and indexes (below).
3. Start the devkit's runner.

## Online leaderboard rules

Online leaderboards live in Cloud Firestore (`leaderboards/{puzzleId}/entries`).
Their security rules are in [`firestore.rules`](firestore.rules), and the
indexes that the Hardware cycles board needs are in
[`firestore.indexes.json`](firestore.indexes.json). CI tests the rules
(`npm run test:rules`) but doesn't deploy them; after changing them, deploy
with the [Firebase CLI](https://firebase.google.com/docs/cli):

```sh
firebase deploy --only firestore:rules,firestore:indexes --project human-compiler
```

The rules make leaderboards publicly readable, let signed-in (anonymous)
players create entries only under their own `uid` with bounded values (name
length, code size, VGPRs, cycles, timestamp), forbid edits, and let players
delete only their own entries. A submitted solution can be read only by its
author and the devkit, and only the devkit can record what it found: its
status on the submission, and its timing (`hw`) on the entry. The scores on
the Code Size, VGPRs and Speed boards are still reported by the client, though:
the rules bound the values and enforce ownership, but don't check them. Only
the Hardware cycles board comes from solutions checked again away from the
player's browser, on the devkit.

## Credits

Background music ([`src/assets/music/`](src/assets/music/), re-encoded from the original
releases, with "Half Mystery" raised 7.2 dB to match the loudness of "Beauty Flow"):

"Beauty Flow" Kevin MacLeod (incompetech.com)  
Licensed under Creative Commons: By Attribution 4.0  
https://creativecommons.org/licenses/by/4.0/

"Half Mystery" Kevin MacLeod (incompetech.com)  
Licensed under Creative Commons: By Attribution 4.0  
https://creativecommons.org/licenses/by/4.0/

The game shows these credits under Settings → Credits, as the licence requires.
