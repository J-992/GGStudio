# Tether Dash

A fast co-op runner where being physically connected creates the fun. Two toy-factory
robots — Volt and Bea — race forward through a kinetic toy factory suspended in the
clouds, joined by an elastic bungee cord. The cord stretches, pulls, slingshots, and
saves whoever falls. 15 handcrafted levels, solo (with a companion AI) or local 2-player.

Phaser 3, no dependencies: the runners are rendered sprite sheets and everything else —
art and audio alike — is generated at runtime.

## Run

```
npm run dev
# serves the folder on http://localhost:8123 and opens it
```

(Or any static server — `python -m http.server`, etc. Phaser is vendored in
`vendor/phaser.min.js`.)

Append `?debug` to the URL for live tether-tuning sliders (slack, spring, damping,
max force) and a distance/state/fps readout. On `localhost` the Poki SDK runs in debug
mode, so ad breaks show test ads.

## Build

```
npm run check        # boots every script against a stub Phaser + validates level data
npm run build:poki   # -> dist/ (the folder Poki gets)
npm run package      # check, build, preflight, then dist/ -> tether-dash-poki.zip
```

`build:poki` is a concatenation, not a bundle. The classic scripts share globals through
the window, and `index.html` is where their load order is written down — so
`tools/build-poki.mjs` reads the order out of the HTML, concatenates those files into one
`game.js`, and rewrites the page to load it. Add a `<script src="src/...">` tag and the
build picks it up; there is no second list to keep in sync.

It is not a bundler because bundlers tree-shake: they drop top-level declarations nothing
appears to reference, which for classic scripts means `LEVELS` and `CFG` vanish from the
output and the game dies on Poki rather than here. The build also strips the jsdelivr
Phaser fallback — fine when you serve the folder yourself, a blocked third-party request
inside Poki's sandbox.

`npm run check` is the CI gate: it boots every script and compiles all 15 levels through
the real course builder, failing on a gap wider than a jump at that level's speed, a gate
with no opening wide enough to fit through, a checkpoint over a hole, or a missing SDK tag.

## Controls

|            | Move        | Jump         |
| ---------- | ----------- | ------------ |
| P1 / solo  | A / D       | W or Space   |
| P2         | ← / →       | ↑            |

Solo also accepts the arrow keys, and **Q** (or the SWAP button on touch) switches
which runner you control — the other follows with a tether-aware companion AI.
**Esc** pauses, **R** restarts the level. Touch devices get on-screen steer/jump
clusters (one per player in 2P mode).

## The tether

A capped spring, not a rope simulation (`src/systems/TetherSystem.js`):

- inside `slackLength` (4 units) the cord hangs loose and does nothing;
- past it, force grows with stretch (`stretch * springStrength`, damped, capped at
  `maxTetherForce`) — grounded runners grip the floor and feel less lateral pull,
  which is what makes anchor saves work;
- at `maxLength` (10 units) a hard positional constraint takes over: the pair simply
  cannot separate further, and separating velocity is cancelled — so the cord can
  never jitter or explode;
- when a runner falls past the rescue threshold while their partner stands on solid
  ground within reach, the cord swings them back up beside their partner. If both
  fall, the pair respawns together at the last checkpoint (fade is ~0.35s — retry is
  effectively instant).

Visual states: loose curved cord → straightening → taut orange glow → trembling red
at critical, with a creak whose pitch follows tension.

## Levels

All 15 levels are data (`src/data/levels.js`) — segment lists compiled by
`src/systems/Course.js` into platforms, walls, gears, pads, bolts and checkpoints.
Adding a level is appending an object; no scene code. Progression: 1–3 teach running
and jumping, 4–6 add gates/moving platforms/conveyors, 7–9 split paths + rescues +
gears, 10–12 speed, dividers and slaloms, 13–15 combine everything.

Scoring per level: 1 star to finish, +1 for 60% of the bolts, +1 for no falls **or**
beating the target time.

## Poki SDK

`src/systems/PokiSDK.js` wraps the platform SDK (loaded in `index.html` from
`game-cdn.poki.com/scripts/v2/poki-sdk.js`). Every call no-ops when the SDK is missing —
ad blocker, offline, or serving the folder yourself — so the game stays fully playable
off-platform.

| Signal | Where |
| --- | --- |
| `init` → game boot | `main.js` — Phaser starts once init settles (5s timeout guard) |
| `gameLoadingStart` / `gameLoadingFinished` | init / `BootScene` after textures generate |
| `gameplayStart` / `gameplayStop` | `GameScene.create` / scene shutdown + level complete |
| `happyTime` | checkpoint reached (0.4), level complete (1) |
| `commercialBreak` | `Poki.startLevel` — skips the session's first level, then min 60s apart |
| `rewardedBreak` | wired in the wrapper, no placement uses it yet |

Ads always play over a muted, frozen game: the wrapper stops gameplay, kills the tether
creak loop, suspends the WebAudio context and calls `game.loop.sleep()` for the duration,
restoring all of it afterwards. Every path into a level goes through `Poki.startLevel`, so
the rule about when an interstitial may play lives in one place — and mid-level retry
(pause menu, **R**) deliberately does not go through it, because instant retry is the
point.

### Shipping it

`poki.json` registers the game with the monorepo's pipeline: every push to `main` that
touches this directory runs `npm run check`, then `npm run build:poki`, then uploads
`dist/` as a new version. See `docs/poki-deploy.md` at the repo root.

Two things are needed before that does anything. Replace `game_id` in `poki.json` with the
UUID from the game's page at developers.poki.com — until then the pipeline reports the
game and skips it. And add the game's upload token to GitHub Secrets as
`POKI_UPLOAD_TOKEN_TETHER_DASH` (the name is derived from `ggs.id`; the token itself never
goes in this repo).

An upload creates a version, it does not publish one — `make_public` is off by default.

## File structure

```
index.html            script load order lives here
vendor/phaser.min.js
poki.json             registers the game with the monorepo's deploy pipeline
tools/
  check.mjs           the CI gate: stub boot + level validation
  boot.mjs            stub-Phaser harness shared by check and build
  build-poki.mjs      index.html + src/ -> dist/
  package-poki.mjs    preflight + zip, for uploading by hand
  meshy/              Meshy model -> sprite sheet (Blender render + palette grade)
assets/
  runnerA.png         Volt: 8-frame walk sheet, 200x240 per frame
  runnerB.png         Bea: same, reproportioned + recoloured
  README.md           Meshy prompts + render rules for the remaining models
src/
  Config.js           every tuning number in one place
  main.js             game config (960x540, FIT scaling)
  data/levels.js      all 15 levels as segment lists
  scenes/
    BootScene.js      loads the runner sheets, generates the rest
    MenuScene.js      title, mode toggle, sound
    LevelSelectScene.js
    GameScene.js      gameplay, fake-3D rendering, HUD, touch, pause, results
  systems/
    Projection.js     fake-3D camera math (one divide per point)
    Course.js         level compiler + ground/edge queries
    PlayerController.js  run/steer/jump, coyote time, buffering, pads, walls, gears
    CompanionAI.js    solo partner: route following, pre-steered jumps, gate picking
    TetherSystem.js   the elastic cord (see above)
    CameraController.js  frames both runners, widens as they separate
    InputManager.js   keyboard + touch -> per-runner input records
    Effects.js        particles, floating text, shared button
    AudioSystem.js    procedural WebAudio (incl. the tension creak)
    PokiSDK.js        Poki platform wrapper (ads, gameplay signals) — no-ops off-platform
    TextureFactory.js procedural sprite art (fallback for the runners)
    SaveSystem.js     localStorage: stars, bolts, best times, settings
```

## Art

The two runners are 8-frame walk cycles rendered from a Meshy model
(`assets/runnerA.png`, `assets/runnerB.png`); `BootScene` loads them and falls back to
the hand-drawn mascots if they are missing, so the game runs without them. Both sheets
currently come from the same rig — Bea is Volt reproportioned and hue-shifted, pending
her own model.

Everything else is procedural: sprites are drawn at runtime by `TextureFactory` and
every sound is synthesized. `assets/README.md` holds the prompts for the remaining
models; `tools/meshy/` holds the Blender + PIL pipeline that turns one into a sheet.
