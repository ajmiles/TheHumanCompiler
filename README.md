# TheHumanCompiler
A programming mini-game based on the AMD RDNA2 ISA

## Development

```sh
npm install            # also points git at .githooks (pre-commit bumps src/version.ts)
npm run dev            # local dev server; its online leaderboards use the Firebase emulators
npm run emulators      # the Firebase Auth and Firestore emulators (needs Java 11+)
npm test               # ISA/assembler/emulator test suite
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
sends back). The build bundles them into `dist/hw/verifier.js`, which the
devkit runs in QuickJS. `npm run hw-job` makes jobs by hand, including a set of
calibration programs (see [`scripts/hw-job.ts`](scripts/hw-job.ts)).

## Online leaderboard rules

Online leaderboards live in Cloud Firestore (`leaderboards/{puzzleId}/entries`).
Their security rules are in [`firestore.rules`](firestore.rules) and are not
deployed by CI; after changing them, deploy with the
[Firebase CLI](https://firebase.google.com/docs/cli):

```sh
firebase deploy --only firestore:rules --project human-compiler
```

The rules make leaderboards publicly readable, let signed-in (anonymous)
players create entries only under their own `uid` with bounded values (name
length, code size, VGPRs, cycles, timestamp), forbid edits, and let players
delete only their own entries. Scores are still reported by the client, though:
the rules bound the values and enforce ownership, but fully trustworthy scores
would require re-verifying submitted solutions server-side.

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
