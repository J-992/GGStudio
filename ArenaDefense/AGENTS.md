# Arena Defense — agent rules

A first-person, wave-based tower defense in a circular arena, for Poki. Read
`README.md` for how to run/build/test it; this file is only the rules that
differ from the repo-wide ones in `../AGENTS.md`.

## Verification

```sh
npm run check          # test && build:poki && budget && dist:check — the whole gate
npm run test            # node --test test/ only
```

There are no browser or Playwright tests, and none should be added — see
`../AGENTS.md`. `src/core/**` is plain data-in-data-out logic tested headlessly
with `node --test`; that is the whole point of keeping it free of three.js and
the DOM (see below) — a wave/economy/combo balance regression fails in CI
instead of in a playtest.

## Things that look like bugs and are not

- `src/config.js` holds every tunable number — wave tables, enemy/turret
  stats, combo tiers, timings, all of it. Balance and tuning work belongs
  there, never as a literal in a system file.
- `src/core/*.js` must stay free of three.js, the DOM, and `window`/
  `document`/`localStorage`. Anything that needs the renderer, input events,
  or persistence lives in `src/game/`, `src/ui/`, or `src/platform/` and
  calls into `core` with plain data — that boundary is what makes `core`
  testable with `node --test` and nothing else.
- `pickActiveGates`/wave spawn timing draw from a seeded `core/rng.js`
  stream so the same seed reproduces the same run; cosmetic-only randomness
  (if any is ever added) must not share that stream.
- The mute preference (`arenadefense.muted`) is stored under its own
  `platform/storage.js` key, deliberately NOT part of `core/storage.js`'s
  `{coins, bestWave, unlocks}` save shape (test-enforced) — it's a device
  preference, not run progress.

## Licence rules

Every shipped asset (models, sprites, audio, fonts) has a row in
`ASSET_LICENSES.md` — source path, author, licence, and how it was converted.
Adding or replacing an asset means adding or updating that row in the same
change. Several rows are recorded as UNKNOWN provenance (brainrot sprites, the
FBX prop pack) — that is a known, accepted risk, not something to "fix" by
deleting the row; see the plan's Risks section for the reasoning.

## Poki

`poki.json` registers the game with the repo's deploy pipeline —
`token_git_secret_name` names a GitHub secret, never the token itself. See
`README.md`'s "Poki registration — owner steps" for what a human still has to
do.

`platform/poki.js` is the only module allowed to touch `window.PokiSDK`.
**`gameplayStop()` must be called unconditionally before every ad** (inside
the `commercialBreak()`/`rewardedBreak()` wrapper, not left to each call
site) — Poki's own rule, and the thing their review checks first. The
sequencing itself (idempotent start/stop, no start during an ad, the
unconditional pre-ad stop, a watchdog against a hung ad promise) lives in
`src/core/adGuard.js` — pure and `node --test`-covered like everything else
in `core/` — so `platform/poki.js` only ever asks it "is this legal right
now" rather than re-deriving the rules.
