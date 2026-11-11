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
has timed it. Submitting a score uploads the source again, as a submission
with the stats it scored, and the leaderboards show a Hardware cycles board of
each player's best time on the devkit. While it's offline (no heartbeat for 10
minutes), the board says when it was last seen, solutions submitted with scores
wait for it (it times them, oldest first, when it's back), and the Puzzle
Complete screen says Offline rather than sending a run. Before the devkit's
first check-in there's no board, and nothing is uploaded. The devkit signs in
with an Email/Password account of its own, whose UID is in `isRunner()` in
[`firestore.rules`](firestore.rules).

The simulated cycles (the Speed board) are one per instruction run, not counting
the `s_endpgm` that ends the program: the devkit doesn't time it either. (Before
1 November 2026 it was counted; the boards were cleared then.)

## Players and their names

A player has one entry on each puzzle's boards: their best code size, VGPRs and
cycles (each may come from a different solution), and their best time on the
devkit. Submitting a worse score leaves it as it was. A name belongs to the
first player to submit a score with it, whatever its case: nobody else can
then submit under it. A player can rename themselves (in Settings, or by
submitting under another name), which frees the old name and shows the new one
on all their entries.

Players sign in anonymously, so a player is one browser. Signing in with
Google (Settings, or the Puzzle Complete screen) makes them that account's
player on any device, keeping their name and scores. If the account has a
player already, the browser switches to it, and the browser's own anonymous
player is left as it was. Google sign-in needs the Google provider enabled in
the Firebase project, and the site's domain among Authentication's authorised
domains.

## Sharing sandbox code

In the Sandbox, 🔗 Share stores the code in Firestore (`shares/{id}`, with a
random 8-character id) and gives a link to it: the site's address with
`?s={id}`, which opens the Sandbox with that code. The address bar shows the
link while the editor holds the shared code. A share holds up to 50,000
characters and is never changed or deleted. Sharing again before changing the
code shows the same link.

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

The rules make leaderboards publicly readable. A signed-in player's entry on a
puzzle is under their `uid`, with bounded values (code size, VGPRs, cycles,
timestamp) that may only get better, and the name the player owns. Who owns a
name is in `names/{name in lower case}`, and a player's name in
`players/{uid}`: the two change together in one batch, so a name can't be taken
from its owner, and changing it frees the old one. Players can delete only
their own entries. A submitted solution can be read only by its author and the
devkit, and only the devkit can record what it found: its status on the
submission, and the player's best time (`hw`) on their entry. The scores on
the Code Size, VGPRs and Speed boards are still reported by the client, though:
the rules bound the values and enforce ownership, but don't check them. Only
the Hardware cycles board comes from solutions checked again away from the
player's browser, on the devkit.

Anyone can read a share whose id they have, but nobody can list them. A
signed-in player (anonymous or not) can make one, with the source, the game's
version and the server's time, and nothing else (not who made it); nobody can
change or delete one.

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
