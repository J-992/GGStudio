# Arena Defense

A first-person, wave-based tower defense in a circular arena, built for Poki
(mobile-first, keyboard secondary). three.js + vanilla JS ES modules, Vite
build. Hold a gate line with turrets during the build phase, then fight the
wave yourself; every 5th wave adds a brainrot boss. V1: 3 turrets, 3 enemy
types, 1 boss, 10 waves, 1 arena.

## Controls

**Keyboard + mouse** — WASD to move, mouse to look (pointer-lock on canvas
click; drag-to-look if that's rejected), click to fire, 1/2/3 to pick a
turret type during the build phase, tap a build slot to place/upgrade/repair,
Space/Enter for Ready, **Escape to pause/resume**.

**Touch** — left-side floating joystick to move, drag anywhere else to look,
auto-fire inside the reticle cone, tap a turret chip then tap a slot to
place/upgrade/repair, **the pause button (bottom-right) to pause/resume**.

**Both** — a mute button (bottom-right, next to pause) toggles audio; the
choice is remembered across reloads.

## Run it

```sh
npm ci
npm run dev             # http://localhost:5173, HMR
npm run build            # plain build (dist/), no Poki SDK tag, no PokiSDK code at all
npm run build:poki       # Poki build (dist/), SDK tag present
npm run preview
```

### Dev URL params

| Param | Effect |
| --- | --- |
| `?poki=mock` | Installs a mock `window.PokiSDK` that records every lifecycle call into `window.__POKI_EVENTS__` instead of requiring the real CDN script. Works under `npm run dev` and in a `build:poki` build; the plain `build` strips every Poki-related code path (including this mock) — that distribution never touches `window.PokiSDK` at all, so `?poki=mock` has nothing to install there. |
| `?poki=mock&reward=0` | Same mock, but every rewarded break (revive, coin doubler) resolves `false` — for exercising the "ad declined/unfilled" paths. |
| `?touch=1` / `?touch=0` | Forces the input mode, overriding device detection. |
| `?wave=N` (1..10) | Skips the title screen and starts the run directly at wave `N`'s build phase (e.g. `?wave=5` for the boss). |
| `?debug=1` | Adds an on-screen `fps · draw calls · alive/cap` readout. |

## Test

```sh
npm run test             # node --test test/ — src/core/** only, no DOM/three
npm run check            # test && build:poki && budget && dist:check — the CI gate
```

## Rebuilding the shipped assets

Source art lives outside this repo (in `/Shared`, `Steal-A-Brainrot`,
`zombie-motorworks`, LFS-fetched via `media.githubusercontent.com` where
needed) and is converted into `public/assets/` by two scripts. Regenerate
them only when you actually need to change the art — the output is committed
so a fresh clone doesn't need to run either one:

```sh
npm run assets:fetch      # -> art-src/ (gitignored)
npm run assets:build      # art-src/ -> public/assets/ (committed)
```

See `ASSET_LICENSES.md` for what's shipped, where it came from, and under
what licence.

## Poki registration — owner steps

The only part of this game an agent cannot do. Follow them in order:

1. Add the game on https://developers.poki.com/ first.
2. Game Name → Settings → Integration → **Game Upload Token**.
3. GitHub → Settings → Secrets and variables → Actions → new secret named **`POKI_UPLOAD_TOKEN_ARENADEFENSE`** with that token as the value. The token itself never goes in the repo.
4. Game Name → Settings → General → **Game ID**, copy it.
5. Put the Game ID in `ArenaDefense/poki.json` `game_id`. `token_git_secret_name` is already `"POKI_UPLOAD_TOKEN_ARENADEFENSE"` — the **name** of the secret, never the secret.
6. Push/merge to `main`. The workflow uploads a new version of every changed game. Players see nothing until `make_public` is set (in `ggs` or on a manual run) and Poki review is requested.

Until step 5 is done, `game_id` stays the placeholder and CI lists this game
as "skipped, unregistered" without failing the build.

## Verify this

From `ArenaDefense/`:

```sh
npm ci
node scripts/fetch-sources.mjs        # art-src/ (gitignored), LFS-aware
node scripts/build-assets.mjs         # regenerates public/assets/** (committed)
npm run test                          # node --test test/
npm run build:poki && npm run build   # both must succeed
node scripts/budget.mjs               # gz ≤ 1.5 MiB
node ../scripts/poki/preflight.mjs .  # root preflight
```

From the repo root:

```sh
node scripts/poki/discover.mjs --all                     # lists ArenaDefense as registered/skipped, never fails on it
node scripts/poki/upload.mjs ArenaDefense --dry-run       # runs the whole deploy path minus the upload; refuses on the placeholder game_id — expected until registration
```

Grep checks on both builds (`npm run build` then `npm run build:poki`, from `ArenaDefense/`):

```sh
grep -c PokiSDK dist/assets/*.js   # after `npm run build`: 0 in every file
grep -c PokiSDK dist/assets/*.js   # after `npm run build:poki`: >0
```

### Owner checklist (no Playwright/browser — see `AGENTS.md` and the root `../AGENTS.md`)

One merged, ordered pass through everything every work package's own brief asked to be checked by hand, plus this package's additions:

1. **Boot** — `npm run dev` loads to the title screen (portraits + best wave + coins); `?poki=mock` records `gameLoadingStart`, `init`, `gameLoadingFinished` (order between the first two is not significant) in `window.__POKI_EVENTS__` before Play is ever pressed.
2. **Input schemes** — desktop: pointer-lock on canvas click, WASD + mouse look, click to fire, 1/2/3 turret chips. Phone (or DevTools device toolbar): floating stick + look-drag, no fire button (auto-fire inside the reticle), safe-area padding respected. Toggling DevTools' touch emulation swaps the HUD hints silently, with no prompt.
3. **Wave 1–4** — 5 shamblers spawn from the 2 lit gates on wave 1 (exactly 50 energy banked after, enough for one gun turret); wave 3's spitters hold distance and lob; wave 4's Tung Tung Tung Sahur sprite stomps in and swings.
4. **Build overlay** — opens after wave 1 clears; tapping an empty slot places the selected turret facing the arena centre; tapping an occupied slot opens the upgrade/repair sheet; an unaffordable action shakes and plays the deny sound; Ready with time left banks the partial-time energy refund.
5. **Boss (wave 5, or `?wave=5`)** — Patapim enters a lit gate, walks in, periodically rears up ("cast") and drops a Tung Tung Tung Sahur add (capped at 6 alive) every ~5 s, takes melee damage in range, dies after ~900 damage, and the wave clears. The player's gun and every turret in range (including gun/cannon/tesla) all damage the boss; a shot that also kills an enemy standing in front of the boss damages only the nearer of the two, never both.
6. **Combo/coins/save** — 3 kills within the combo window shows the combo bar and a "+coins" toast; dying loses the current wave's *pending* combo coins but keeps every wave already banked; reloading the page after a run shows the saved coins and best wave on the title screen.
7. **Death → revive → run end → doubler** — dying opens the death screen; picking Revive plays the (mocked, 2 s) ad and resumes the same wave with full hp, brief invulnerability, and nearby enemies stunned; revive is offered at most once per run. Ending the run (or a victory) shows the run-end screen; Double Coins plays a second ad and updates the coin total, offered at most once per run-end.
8. **Ads invariant** — with `?poki=mock` open the browser console and confirm `window.__POKI_EVENTS__` reads, for one full run: `gameLoadingStart`/`init` → `gameLoadingFinished` → `commercialBreak` → `gameplayStart` → *(wave play)* → `gameplayStop` → `rewardedBreak:true` (or `:false` with `&reward=0`) → `gameplayStart` only if the revive was granted → *(wave play)* → `gameplayStop`. `gameplayStart` never appears while an ad is playing, and every ad is preceded by gameplay already being marked stopped.
9. **Ads disabled** (temporarily set `platform.adsEnabled: false` in `src/config.js` to check) — the Revive and Double Coins buttons disappear entirely (End Run / Play Again / Title still work); every other number (coins, energy, wave, combo) behaves identically to ads-enabled play.
10. **Pause** — Escape (keyboard) or the pause button (touch, bottom-right) freezes movement/look/fire, shows a "PAUSED" panel, and silences audio; pressing it again resumes exactly where play left off. A backgrounded-then-restored browser tab does not silently cancel a manual pause.
11. **Mute** — the mute button (bottom-right, both input modes) silences/restores audio immediately and the choice survives a reload.
12. **Perf** — Chrome DevTools performance profile on a mid-range Android CPU throttle, at wave 10: draw calls stay under 40, frame rate holds near 60 fps; `?debug=1`'s `alive/cap` counter never exceeds the wave's cap. A 4G-throttled cold load finishes in under 15 s.
13. **Deploy readiness** — `npm run check` is green; `node ../scripts/poki/preflight.mjs .` (from `ArenaDefense/`) passes; `node scripts/poki/discover.mjs --all` (repo root) lists ArenaDefense as registered-and-skipped or ready, never failing; `node scripts/poki/upload.mjs ArenaDefense --dry-run` (repo root) runs preflight and stops cleanly at the placeholder `game_id` (or actually uploads, once registered).
14. **Register and ship** — follow "Poki registration — owner steps" above, then merge to `main` and watch the "Poki deploy" Actions run upload a version. Nothing is public until `make_public` is set (in `poki.json`'s `ggs` block, or on a manual workflow run) and review is requested from the Poki dashboard.

## Architecture

See `AGENTS.md` for the rules agents working in this folder must follow
(config-only tuning, `src/core` purity, licence handling, the Poki lifecycle
rule). The file tree, state machine, and full work-package breakdown live in
the approved plan this game was scaffolded from.
