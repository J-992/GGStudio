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
Space/Enter for Ready.

**Touch** — left-side floating joystick to move, drag anywhere else to look,
auto-fire inside the reticle cone, tap a turret chip then tap a slot to
place/upgrade/repair.

## Run it

```sh
npm ci
npm run dev             # http://localhost:5173, HMR
npm run build            # plain build (dist/), no Poki SDK tag
npm run build:poki       # Poki build (dist/), SDK tag present
npm run preview
```

`?poki=mock` (either build, served) installs a mock `window.PokiSDK` that
records every lifecycle call into `window.__POKI_EVENTS__` instead of
requiring the real CDN script. `?touch=1` / `?touch=0` forces the input mode.

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
node ../scripts/poki/discover.mjs --all
node ../scripts/poki/upload.mjs ArenaDefense --dry-run   # from repo root; needs POKI_UPLOAD_TOKEN env only for a real upload
npm run check                         # test && build:poki && budget && dist-check
```

Owner checklist (no Playwright — see `AGENTS.md`):

- Desktop run to wave 5; phone run to wave 3.
- Input scheme swaps without a prompt (DevTools touch toggle).
- Overlay place/upgrade/repair/ready all work.
- Death → revive → run end → doubler flow.
- Reload keeps coins/best wave.
- `?poki=mock` event order is correct.
- Chrome perf on a mid-range Android profile at wave 10: draw calls < 40, 60 fps.
- 4G-throttled load < 15 s.
- Then: create the Poki game, paste `game_id`, add the secret, merge to `main`, watch the "Poki deploy" Actions run upload a version.

## Architecture

See `AGENTS.md` for the rules agents working in this folder must follow
(config-only tuning, `src/core` purity, licence handling, the Poki lifecycle
rule). The file tree, state machine, and full work-package breakdown live in
the approved plan this game was scaffolded from.
