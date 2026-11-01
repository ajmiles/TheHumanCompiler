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

## Hardware cycles

A devkit times submitted solutions on real RDNA2 hardware, for a
"Hardware cycles" leaderboard (live since 1 November 2026). The public half is in
[`src/hardware/`](src/hardware/): `verify()` checks a solution in the emulator
and wraps it in a timing harness ([`harness.ts`](src/hardware/harness.ts)), and
`score()` turns the devkit's runs into the result
([`protocol.ts`](src/hardware/protocol.ts) describes what the runner gets and
sends back, and what it reads and writes in Firestore). The harness loads every
register's start value from an input block that the devkit copies in before
each run, so one program serves all of a puzzle's invocations. The devkit times
each program many times, each run straight after an untimed run so its
instructions are already cached, and the score is the most common duration less
that of the empty harness. The build bundles `verify()` and `score()`
into `dist/hw/verifier.js`, which the devkit runs in QuickJS. `npm run hw-job`
makes jobs by hand, including a set of calibration programs (see
[`scripts/hw-job.ts`](scripts/hw-job.ts)).

While the devkit is online (it keeps `runner/status` up to date), completing a
puzzle sends the solution's source to it, privately, as the player's own run
(`submissions/trial-{uid}`, which goes on no board): the Puzzle Complete screen
shows its Hardware cycles beside the simulated ones, Pending until the devkit
has timed it. Submitting a score uploads the source again, under
`submissions/{entryId}`, and the leaderboards show a Hardware cycles board of
the entries the devkit has timed. While it's offline the site shows no board and
uploads nothing. The devkit signs in with an Email/Password account of its own,
whose UID is in `isRunner()` in [`firestore.rules`](firestore.rules).

The simulated cycles (the Speed board) are one per instruction run, not counting
the `s_endpgm` that ends the program: the devkit doesn't time it either. (Before
1 November 2026 it was counted; the boards were cleared then.)

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
