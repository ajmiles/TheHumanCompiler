# TheHumanCompiler
A programming mini-game based on the AMD RDNA2 ISA

## Development

```sh
npm install     # also points git at .githooks (pre-commit bumps src/version.ts)
npm run dev     # local dev server
npm test        # ISA/assembler/emulator test suite
npm run build   # type-check + production build into dist/
```

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
