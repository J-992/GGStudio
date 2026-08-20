# Shipping AIMER to Poki

Everything Poki's technical review looks for, where it lives in this repo, and
what still needs a human with a phone.

## Build and package

```bash
bun install
bun run package      # typecheck-free fast path: build + preflight + zip
```

`bun run package` writes `aimer-poki.zip` in the repo root. That is the file you
upload. It contains `index.html` at the archive root, which is where Poki looks
for it.

The preflight in `scripts/package-poki.mjs` refuses to package a build that
would fail review:

- an absolute `src`/`href` in `index.html` (Poki serves from a path this repo
  does not control, so every URL has to be relative)
- a request to any origin other than `https://game-cdn.poki.com`
- a missing SDK tag, which is how a `build:web` build gets caught before upload

It also prints the raw and gzipped size of every file, so a regression in bundle
size is visible at the moment it happens rather than a month later.

| Command | What it makes |
| --- | --- |
| `bun run dev` | Dev server on `:8080`, `host: true` so a phone on the LAN can reach it. Talks to Poki with `setDebug(true)`, so their **test ads** fill the break slots. |
| `bun run build` | The Poki build. SDK tag injected, ad calls live. |
| `bun run build:web` | A standalone playtest build. No SDK tag, no ad calls, no request to Poki's CDN. |
| `bun run check` | `typecheck` + `build`. |

The portal is chosen in `vite/config.shared.mjs` and inlined at build time, not
read from a shell variable, so the same command produces the same bytes on every
machine.

## Current size

| | Raw | Gzipped |
| --- | --- | --- |
| Phaser | 1.28 MB | ~330 KB |
| Game | 75 KB | ~25 KB |
| **Total** | **1.36 MB** | **~365 KB** |

No external art or audio: every graphic is a Phaser shape or a canvas texture
generated in `Boot`, and every sound is synthesised in `core/audio.ts`. There is
nothing to preload and nothing to serve from a CDN.

## SDK integration

`src/game/platform/pokiSdk.ts` is the only file that knows Poki exists.
`src/game/platform/platform.ts` wraps it in neutral verbs, and everything else
in the game calls those. Both are safe to call when the SDK never loaded — an ad
blocker rejects `init()`, and Poki's own docs are explicit that the game must
carry on anyway, so the stubs stay callable and quietly do nothing.

| Poki call | Where it comes from |
| --- | --- |
| `init` | `src/main.ts`, before the Phaser game is constructed, with a 3s watchdog |
| `gameLoadingStart` | `src/main.ts`, immediately after init |
| `gameLoadingFinished` | `scenes/Boot.ts`, once every texture exists |
| `gameplayStart` / `gameplayStop` | `core/lifecycle.ts`, driven by `setGameplayActive` from the scenes |
| `commercialBreak` | `core/ads.ts` → end of a run, and between two levels |
| `rewardedBreak` | `core/adButton.ts` → extra life, double coins, reroll cards |
| `happyTime` | streak milestones, level clears, new bests, a finished run |
| `captureError` | `core/lifecycle.ts`, on `error` and `unhandledrejection` |
| `setDebug` | dev builds only — the call is tree-shaken out of production |

### Gameplay reporting

Only `GameScene` counts as gameplay. The menu, the upgrade screen and the
results card all report stopped, and so does a hidden page, a sideways phone and
an ad — `core/lifecycle.ts` reports `wanted && nothing is holding the game`, so
the two can never disagree.

### Nothing runs during an ad

`core/lifecycle.ts` holds the game on three things: an ad is on screen, the page
is hidden, or the phone is sideways. Any hold pauses every running scene *and*
puts the render loop to sleep *and* suspends the WebAudio context. Pausing the
scenes alone would keep burning frames behind the ad; sleeping the loop alone
would leave Phaser's own visibility handler free to wake it back up mid-break.

The SDK wrapper additionally refuses to send any event while a break is in
flight, which is Poki's rule — the desired gameplay state is held and replayed on
the way out.

### Ad placement

`core/ads.ts` owns the policy:

- **No interstitial until three levels have been cleared.** A player who has not
  finished anything yet never sees one.
- **100s minimum between breaks**, on top of whatever Poki enforces, and a
  rewarded video resets that clock too — back-to-back ads are the fastest way to
  lose a player.
- Both interstitial slots fire on an **already-black screen**: the fade out at
  the end of a run, and the fade out between two levels. Nothing is mid-animation
  behind them.

Rewarded videos are opt-in and labelled with what they give plus a video icon
(`core/adButton.ts`). Declining costs the player nothing:

- **EXTRA LIFE** (`+10s`) when the clock runs out, once per level. The board, the
  combo and the level score are all still standing at that moment, which is the
  whole reason it is worth watching — retrying was always free and always started
  the level over.
- **DOUBLE COINS** on the results card. The run's coins are already banked before
  the offer appears.
- **REROLL CARDS** on the upgrade screen, as often as the player is willing to
  watch. The three cards only change once a video has actually played.

## Playability

- **9:16 portrait**, 540×960 internal, `Scale.FIT` with `expandParent` — fills
  whatever box Poki's iframe gives it, on any aspect ratio, and re-fits on
  rotate.
- A **rotate prompt** covers the game on a phone held sideways (CSS in
  `public/style.css`, breakpoint is height-based so a desktop browser never sees
  it), and the level clock is frozen behind it.
- **Set orientation to portrait** in the Poki dashboard when you submit.
- Audio never starts before a touch (`unlockAudio` on the first gesture) and the
  mute preference persists.
- Pinch zoom, rubber-band scroll, long-press menus and double-tap zoom are all
  suppressed in `src/main.ts` — the game is in someone else's iframe, and a
  stray gesture lands on their page.
- `localStorage` is wrapped in try/catch: a blocked storage partition costs the
  player their save, not their session.

## Before you upload

Poki tests on real phones, so these are the checks a build server cannot make.
Run `bun run dev` and open it on a phone on the same network.

- [ ] The game reaches the menu and Poki's loader goes away.
- [ ] Clear three levels, then finish a run — a test ad plays on the way out.
- [ ] Nothing moves and nothing is audible while that ad is on screen; the game
      picks up where it left off afterwards.
- [ ] Run the clock out: **EXTRA LIFE** puts 10s back with the board and score
      intact; **GIVE UP** goes to the results card. The offer does not come back
      a second time in the same level.
- [ ] Tap **DOUBLE COINS** on the results card: coins go up only after the video
      finishes, and closing the video early leaves the total alone.
- [ ] Tap **REROLL CARDS** twice: three new cards each time, and declining leaves
      whatever three are on the table.
- [ ] Switch tabs mid-level — the timer does not run down while you are away.
- [ ] Turn the phone sideways mid-level — rotate prompt, and the timer holds.
- [ ] The mute button still works after an ad.
