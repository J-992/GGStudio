# Poki deploy

Every push to `main` builds the game, checks the build against Poki's technical
requirements, and uploads it to Poki for Developers as a new **version**. It does
not put that version in front of players — publishing stays a decision somebody
makes, not a side effect of a push.

Modelled on the pipeline in `JosephLiao542211/GGStudio`, minus the monorepo
discovery: there is one game here, so its settings live in `poki.json` at the
root instead of being found by a scanner.

## What you have to do once

1. **Paste the game id.** `poki.json` ships with a placeholder and the upload
   refuses to run until it is replaced:

   ```
   FAIL  no Poki game id yet — paste the id from developers.poki.com into "game_id"
   ```

   The id is in the URL of the game's page in Poki for Developers.

2. **Add the upload token.** In Poki for Developers, generate an upload token,
   then add it to the GitHub repository under
   *Settings → Secrets and variables → Actions* as `POKI_UPLOAD_TOKEN`. The name
   is configurable via `ggs.token_git_secret_name` in `poki.json`.

3. **Push this repository to GitHub.** Actions only run on GitHub; a local
   repository with no remote deploys nothing.

## Everyday use

Push to `main`. The run appears under *Actions → Poki deploy*, and its summary
says how big the build was and whether the version was published.

To publish immediately, or to rehearse without uploading, run it by hand from
*Actions → Poki deploy → Run workflow*:

| input | effect |
|---|---|
| `make_public` | replaces what players currently see |
| `dry_run` | builds and preflights, uploads nothing |

Locally:

```
npm run poki:preflight     # check the current dist/ the way CI will
npm run poki:upload        # build and upload, needs POKI_UPLOAD_TOKEN
node scripts/poki/upload.mjs --dry-run
```

## What preflight refuses

These are the failures that get a submission bounced, caught before it leaves
the machine rather than a week later in a review queue.

- **An absolute asset path** in `index.html`. Poki serves the game from a
  subdirectory, so `/assets/…` resolves against their host and 404s. This is not
  hypothetical — it is what got a submission rejected as "broken or incomplete"
  before `base: './'` was set in `vite.config.ts`.
- **A third-party origin.** Poki blocks external requests. Only the SDK and the
  netlib signalling host are allowed; anything else has to be bundled or listed
  under `ggs.ignore_origins` with a reason.
- **A missing SDK.** A build with no Poki SDK in it was made for some other
  platform.
- **An oversized initial download**, against `ggs.max_bytes` (8 MB here, matching
  Poki's guidance).

## Why the upload is wrapped

`@poki/cli upload` catches its own errors, prints them, and exits `0`. A CI step
that shells straight into it is green whether or not anything reached Poki, which
is worse than having no pipeline at all. `scripts/poki/upload.mjs` runs the CLI as
a child and only passes if the success line it prints on a 201 actually appears.

## One gotcha in this repository

`package.json` is shared with a second project. `npm run dev` starts **squish**;
Tether Run is `npm run dev:tether`. The deploy uses `npm run build`, which is
Tether Run's build, so CI is unaffected — but it will surprise you locally.
