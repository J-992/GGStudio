# Shipping Merge Ninja to Poki

Where the SDK lives, what each call is wired to, and what still needs a human
with a phone.

## Build

```bash
npm ci
npm run build:poki     # the Poki build: SDK tag in the head, ad calls live
npm run build          # a playtest build: no SDK tag, no Poki code at all
npm run dev:poki       # dev server with the SDK on and setDebug(true): test ads
npm run dev            # dev server with no portal at all
```

Bun runs all of these too — `bun install` in place of `npm ci`, `bun run` in
place of `npm run`. The CI pipeline in `poki.json` is npm, so `package-lock.json`
stays the lockfile of record: a dependency added with Bun needs
`npm install --package-lock-only` after it or the deploy's `npm ci` will fail on
a lockfile that no longer matches `package.json`.

`--mode poki` is the whole switch. It inlines `__POKI__` as a literal `true`,
which lets Rollup fold the branch in `src/platform/platform.ts` and drop the
Poki module out of any other build — a playtest bundle contains no mention of
their CDN, which is what stops the preflight failing a build made for the wrong
platform.

Deploys are the monorepo's, not this directory's: `poki.json` registers the game
with `.github/workflows/poki-deploy.yml`, and a push to `main` that touches
`merge-ninja/` uploads a new version. See `docs/poki-deploy.md`. Two things are
still owed before that does anything:

- **`game_id`** is `REPLACE_WITH_POKI_GAME_ID`. Until it is the real UUID from
  the address bar at <https://developers.poki.com/>, the game is discovered,
  reported and skipped rather than failing the run.
- **`POKI_UPLOAD_TOKEN_MERGE_NINJA`** has to exist as a repository secret
  (Settings → Secrets and variables → Actions), holding this game's own Game
  Upload Token. The token value never goes in this repo.

Uploading is not publishing: `make_public` is off, so a version lands on the
dashboard and waits for somebody to say so.

## SDK integration

`src/platform/pokiSdk.ts` is the only file that knows Poki exists — ported from
`aimer/src/game/platform/pokiSdk.ts` so both games answer the checklist the same
way. `src/platform/platform.ts` wraps it in neutral verbs and everything else
calls those. Both are safe to call when the SDK never loaded: an ad blocker
rejects `init()`, and Poki's docs are explicit that the game must carry on
anyway, so the stubs stay callable and quietly do nothing.

| Poki call | Where it comes from |
| --- | --- |
| `init` | `src/main.ts`, before the Phaser game is constructed, with a 3s watchdog |
| `gameLoadingStart` | `src/main.ts`, immediately after init |
| `gameLoadingFinished` | `src/scenes/BootScene.ts`, once every texture and animation exists |
| `gameplayStart` / `gameplayStop` | `GameScene.syncGameplayReport`, on every frame the answer changes |
| `commercialBreak` | `GameScene.restartRun` — the one interstitial slot |
| `happyTime` | a new ninja tier (0.8), a boss down (0.5), an achievement (0.6), an ascension (1.0) |
| `captureError` | `src/main.ts`, on `error` and `unhandledrejection` |
| `setDebug` | dev builds only — the call is tree-shaken out of production |
| `rewardedBreak` | wired and unused; nothing in the game offers a video yet |

### Gameplay reporting

A live run with nothing on top of it counts as gameplay. The almanac, the
settings page, the achievements panel, a tier reveal and the game-over card all
report stopped — Poki counts a menu as a menu however good the game behind it
is — and so does a finished run.

### Nothing runs during an ad

`src/platform/adHold.ts` holds the game on the mute channel Poki fires from
`beforeAd`, which is the last moment before the ad renders. The hold pauses the
scene *and* sleeps the render loop *and* mutes the audio bus. Any one alone is
not enough: pausing the scene keeps burning frames behind the ad, sleeping the
loop leaves Phaser's own visibility handler free to wake it back up mid-break,
and neither silences the synthesized theme.

The portal's mute is held apart from the player's own (`Sfx.setPlatformMuted`),
so an ad cannot unmute a game the player muted, and their setting survives the
break untouched.

The SDK wrapper additionally refuses to send any event while a break is in
flight, which is Poki's rule — the desired gameplay state is held and replayed
on the way out.

### Ad placement

One interstitial, on **Try Again**: the run is already over, the board is frozen
behind a full-screen card, and the next thing the player sees is a new run
either way. Whether an ad actually plays is Poki's decision — they cap the
frequency, so a player who restarts twice in a minute does not pay for it.

Nothing interrupts a live run. An idle merger is a game people leave open, and a
break in the middle of a boss fight is the fastest way to lose one.

## Before you upload

Poki tests on real phones, and these are the checks a build server cannot make.
Run `npm run dev:poki` and open it on a phone on the same network — that server
loads the SDK and talks to Poki with `setDebug(true)`, so their **test ads** fill
the break slots. Plain `npm run dev` has no portal in it and will never show one.

- [ ] The game reaches the board and Poki's loader goes away.
- [ ] Lose a run, tap **TRY AGAIN**: a test ad plays before the new run starts.
- [ ] Nothing moves and nothing is audible while that ad is on screen, and the
      new run is running normally afterwards.
- [ ] Mute the game, then take an ad: it is still muted when you come back.
- [ ] Switch tabs mid-run and come back — the arena picks up where it left off.
- [ ] Turn the phone sideways: the layout re-fits rather than clipping the board.
- [ ] Reload after a few merges: the roster, coins and stage are all still there.
- [ ] Set the orientation to **portrait** in the Poki dashboard when you submit.

## Known snags

- **The build is ~6 MB** (4.7 MB over the wire), down from ~29 MB: the art was
  converted to WebP by `tools/optimize_assets.sh` and 114 unreferenced files
  moved to `art-unused/`. `"max_bytes"` in `poki.json` fails the preflight if it
  climbs back over 10 MB. What is left is mostly Phaser itself (1.4 MB) and the
  packed atlas `game.webp` (852 KB), which is kept lossless because it is pixel
  art — lossy compression bleeds colour across its frame boundaries.
- **The unverified sprite sheets in `ASSET_LICENSES.md` are still unresolved.**
  That file is the record; read it before this goes in front of players.
