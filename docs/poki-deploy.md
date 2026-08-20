# Deploying to Poki

Every push to `main` uploads a new build to Poki for Developers, for each game
in this monorepo whose files that push touched. Nothing runs a deploy command,
and nothing goes in front of players without somebody saying so.

## Adding a game to the pipeline

Write one file. There is no list of games to update and no workflow to edit —
`.github/workflows/poki-deploy.yml` finds games by looking for `poki.json`.

```sh
cd my-game
node ../scripts/poki/discover.mjs --all   # see what is registered today
```

`my-game/poki.json`:

```json
{
  "game_id": "c7bfd2ba-e23b-486f-9504-a6f196cb44df",
  "build_dir": "dist",
  "ggs": {
    "package_manager": "npm",
    "install": "npm ci",
    "build": "npm run build:poki",
    "verify": ["npm run lint", "npm run test:unit"]
  }
}
```

`game_id` and `build_dir` are `@poki/cli`'s own keys, so `npx @poki/cli upload`
works by hand in that directory too. Everything this repo adds lives under
`ggs`, which the CLI ignores.

Get `game_id` from the address bar on the game's page at
<https://developers.poki.com/>. Until it is a real UUID, leave it as
`REPLACE_WITH_POKI_GAME_ID` — the game is then discovered, reported, and
skipped, rather than failing the run.

### The `ggs` block

| Key | Default | What it is for |
| --- | --- | --- |
| `id` | the directory name | Matrix key, concurrency key, and the job name in the Actions UI. |
| `enabled` | `true` | `false` parks a game without deleting its config. |
| `package_manager` | `npm` | `bun` also installs Bun in the runner. |
| `node_version` | `22` | Per game, so upgrading one is not a negotiation with the others. |
| `bun_version` | `latest` | Pin it if the game's `bun.lock` is version-sensitive. |
| `install` | `npm ci` | Run in the game directory. |
| `build` | `npm run build` | Must produce a **Poki** build — the SDK tag included. |
| `verify` | `[]` | Gates run before the build. Typecheck, lint, unit tests. No Playwright. |
| `lfs` | `[]` | Globs handed to `git lfs pull`. See below. |
| `watch` | `[]` | Extra globs that also trigger a deploy, e.g. `Shared/audio/**`. |
| `allowed_origins` | Poki's CDN | Origins the built bundle may reference. |
| `ignore_origins` | licences, engine homepages | Regexes for URLs that appear as text and are never fetched. |
| `require_sdk` | `true` | Fails the build if `index.html` carries no Poki SDK tag. |
| `max_bytes` | none | Fails the build over a size budget. |
| `make_public` | `false` | See "Uploading is not publishing". |
| `token_secret` | `POKI_UPLOAD_TOKEN` | Repository secret to authenticate with. |

## One-time setup

Each game has its own **Game Upload Token**, on its page at
developers.poki.com. Add one repository secret per game (Settings → Secrets and
variables → Actions):

| Secret | Game |
| --- | --- |
| `POKI_UPLOAD_TOKEN_AIMER` | aimer |
| `POKI_UPLOAD_TOKEN_ZOMBIE_MOTORWORKS` | zombie-motorworks |

The name is whatever the game's `ggs.token_secret` says; the workflow looks it
up with `secrets[matrix.token_secret]`, so adding a game with its own token
changes no workflow code. The value reaches `@poki/cli` as `POKI_UPLOAD_TOKEN`,
which is the variable it reads.

Do not share one token across games. The upload request looks the same either
way — `Authorization: Token <t>` to `/games/{id}/versions` — so a wrong-scoped
token fails at Poki's end with a 401 or 404, not with anything that says
"wrong token".

## Uploading is not publishing

The pipeline creates a **version**. It does not put that version in front of
players. Publishing is `--make-public`, and it is off by default, because
replacing what a live game serves should be a decision somebody makes rather
than a side effect of a merge — and because Poki wants a review requested from
the dashboard anyway.

Two ways to turn it on:

- per game, `"make_public": true` in `ggs`;
- per run, the **make_public** checkbox on a manual **Run workflow**.

## What runs, and when

| Trigger | What it deploys |
| --- | --- |
| Push to `main` | Every registered game with a changed file in its directory (or in one of its `watch` globs). |
| **Run workflow** → a game id | That game, changed or not. |
| **Run workflow** → `all` | Every registered game. |

Pushes that CI cannot diff — a force push, the first push to a branch, an
all-zero `before` — deploy **nothing** and say so in the run summary. Uploading
a version to every game because a subtraction failed is the wrong default; the
fix is a manual run.

Editing the workflow or `scripts/poki/` does **not** redeploy anything. A tweak
to the pipeline should not put a new version on five dashboards.

## The parts

```
.github/workflows/poki-deploy.yml   plan → deploy (one matrix job per game)
scripts/poki/config.mjs             reads and validates a poki.json
scripts/poki/discover.mjs           which games changed → the Actions matrix
scripts/poki/preflight.mjs          refuses a build Poki would reject
scripts/poki/upload.mjs             runs @poki/cli, and fails when it fails
```

Run any of it locally:

```sh
npm ci                                    # pins @poki/cli at the repo root
npm run poki:list                         # what is registered
npm run poki:preflight aimer              # check a build you already made
npm run poki:upload aimer -- --dry-run    # everything except the upload
```

### Why `upload.mjs` exists instead of a one-line `run:`

`@poki/cli` 0.1.19 catches its own upload errors, prints them, and exits **0**:

```console
$ POKI_UPLOAD_TOKEN=nope npx @poki/cli upload --game 0000... --build-dir dist
uploading...
Error: {"statusCode":404,"data":"{\"message\":\"not found\"...}"}
$ echo $?
0
```

A step that shells straight into it is green whether or not anything reached
Poki, which is worse than having no pipeline at all. `upload.mjs` runs the CLI
as a child and passes only if the success line it prints on a `201` actually
appears. It does not retry: an upload is not idempotent, and a retry on a
partial failure means two versions.

### Why preflight exists

Poki unpacks the archive onto a path of their choosing and serves it from their
own domain. Three things break a submission, all of them invisible until a
human opens the inspector:

- an absolute `src`/`href`, which resolves against Poki's host, not the game
  (fix: `base: './'` in the Vite config);
- a request to any origin other than Poki's CDN, which their sandbox blocks;
- a build made for another platform, spotted by the missing SDK tag.

It also catches a fourth thing that is specific to this repo. `aimer`'s favicon
is a Git LFS object, and a checkout that did not fetch LFS leaves a 130-byte
text file with a `.png` name where the image should be. Vite copies it into the
build without complaint. Preflight fails on the pointer instead.

### Why LFS is fetched by glob

`lfs: true` on `actions/checkout` pulls every LFS object in the repo — the
700-odd files in `Shared/`, `comfy-zoo/` and `saved/` that no game build reads —
on every deploy, against a bandwidth quota. The workflow checks out without LFS
and then runs `git lfs pull --include=` with the globs the game asked for. A
game that forgets is caught by preflight rather than shipping stubs.

## Known snags

- **`zombie-motorworks` has a Poki build that mentions `sdk.crazygames.com`.**
  `selectPlatform()` in `src/app/platform.ts` switches on
  `import.meta.env.VITE_PLATFORM?.trim()`, and the `.trim()` stops Rollup
  folding the constant, so the CrazyGames branch and its SDK loader survive into
  the Poki bundle. Nothing calls it — `activePlatform` is the Poki one — so no
  request is made, and `ggs.ignore_origins` allows the string. The real fix is
  to branch on a boolean `define` the way `aimer` does, which drops the dead
  loader entirely.
- **`npm ci` fails if a lockfile has drifted.** `npm install --package-lock-only`
  is the fix, and the result has to be committed. This has already broken the
  Vercel deploy once.
- **Game dependencies are not cached** between runs; only the root
  `package-lock.json` is. Worth revisiting if install time becomes the slow part.
