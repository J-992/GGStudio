# Drawer Organizer

A cozy drag-and-drop organizing game in Phaser 3. Tidy the messy drawer, earn decorations,
make the room cuter. Kid-friendly: no timers, no fail states, everything is forgiving.

## Run

Serve the folder with any static server and open it in a browser:

```
python -m http.server 8080
# then visit http://localhost:8080
```

(Or `npx http-server`, or drop the folder on any static host. Phaser is vendored in
`vendor/phaser.min.js` — no build step for development, no backend, no database.)

Works with mouse and touch; audio unlocks on first tap; progress saves to localStorage.
On `localhost` the Poki SDK runs in debug mode, so ad breaks show test ads.

## Build

```
bun run check        # boots every script against a stub Phaser + validates level data
bun run build:poki   # -> dist/ (the folder Poki gets)
bun run package      # check, build, preflight, then dist/ -> drawer-organizer-poki.zip
```

`build:poki` is a concatenation, not a bundle. The classic scripts share globals
through the window, and `index.html` is where their load order is written down —
so `tools/build-poki.mjs` reads the order out of the HTML, concatenates those files into
one `game.js`, and rewrites the page to load it. Add a `<script src="src/...">` tag and
the build picks it up; there is no second list to keep in sync.

It is not a bundler because bundlers tree-shake: Bun's drops top-level declarations
nothing appears to reference, which for classic scripts means `ITEM_DEFS` and friends
vanish from the output and the game dies on Poki rather than here. The build also strips
the jsdelivr Phaser fallback — fine when you serve the folder yourself, a blocked
third-party request inside Poki's sandbox.

## File structure

```
index.html            also the load order the build reads
package.json          scripts only — the game has no dependencies
poki.json             registers the game with the monorepo's deploy pipeline
tools/
  build-poki.mjs      index.html + src/ -> dist/
  check.mjs           the CI gate: stub boot + level-data validation
  package-poki.mjs    preflight + zip, for uploading by hand
vendor/phaser.min.js
assets/               empty placeholder folders + Meshy pipeline notes (assets/README.md)
src/
  main.js             game config (960x640, FIT scaling)
  data/
    items.js          item catalogue (category, label, size)
    levels.js         all level definitions — add levels here
    decorations.js    reward decorations + room anchor positions
  scenes/
    BootScene.js      generates all procedural textures
    HomeScene.js      title screen
    RoomScene.js      room hub: decorations, level dots, play button
    LevelScene.js     gameplay + completion + reward choice overlays
  systems/
    DragSystem.js     grab/lift/drag with shadow
    PlacementSystem.js containers, snap slots, drop resolution, completion
    ProgressionSystem.js level/reward progression
    SaveSystem.js     localStorage persistence
    AudioSystem.js    procedural WebAudio sounds
    PokiSDK.js        Poki platform wrapper (ads, gameplay signals) — no-ops off-platform
    Effects.js        sparkles, confetti, buttons, tween juice
    TextureFactory.js all sprite art, generated at runtime
```

## Authoring a level

Append an object to `LEVELS` in `src/data/levels.js` — no scene code needed:

```js
{
  id: 6,
  name: 'My Level',
  containers: [
    // x/y = center. accepts = item categories. grid auto-lays-out snap slots.
    { x: 300, y: 468, w: 300, h: 200, tint: 0xffd3e0, label: 'Lipsticks',
      accepts: ['lipstick'], grid: { cols: 3, rows: 1 } }
  ],
  items: [ { key: 'lipstick', count: 3 } ],   // scattered into the messy drawer
  reward: { options: ['plant', 'rug', 'basket'] }  // keys from decorations.js
}
```

Rules of thumb: total slots per category ≥ item count; containers live in y ≈ 360–570;
the messy drawer scatter zone is x 130–830, y 130–280. New item types = one entry in
`items.js` + one draw block in `TextureFactory.items()`. New decorations = one entry in
`decorations.js` + one draw block in `TextureFactory.decorations()`.

## Poki SDK

`src/systems/PokiSDK.js` wraps the platform SDK (loaded in `index.html` from
`game-cdn.poki.com/scripts/v2/poki-sdk.js`). Every call no-ops when the SDK is missing —
ad blocker, offline, or serving the folder yourself — so the game stays fully playable
off-platform. On `localhost` it turns on `setDebug(true)`, so you get Poki's test ads.

| Signal | Where |
| --- | --- |
| `init` → game boot | `main.js` — Phaser starts once init settles (5s timeout guard) |
| `gameLoadingStart` / `gameLoadingFinished` | init / `BootScene` after textures generate |
| `gameplayStart` / `gameplayStop` | `LevelScene.create` / scene `shutdown` + completion |
| `happyTime` | level completed |
| `commercialBreak` | `RoomScene.startLevel` — skips the session's first level, then min 60s apart |
| `rewardedBreak` | complete panel: "WATCH AD: 2 REWARDS" grants a second decoration |

### Shipping it

`poki.json` registers the game with the monorepo's pipeline: every push to `main` that
touches this directory runs `bun run check`, then `bun run build:poki`, then uploads
`dist/` as a new version. See `docs/poki-deploy.md` at the repo root.

Two things are needed before that does anything. Replace `game_id` in `poki.json` with
the UUID from the game's page at developers.poki.com — until then the pipeline reports
the game and skips it. And add the game's upload token to GitHub Secrets as
`POKI_UPLOAD_TOKEN_DRAWER_ORGANIZER` (the name is derived from the directory; the token
itself never goes in this repo).

An upload creates a version, it does not publish one — `make_public` is off by default.

Ads always play over a muted, frozen game: the wrapper suspends the WebAudio context and
calls `game.loop.sleep()` for the duration, restoring both (and gameplay state) afterwards.
The rewarded button only appears when two or more *unowned* decorations are still on offer,
so the ad can never pay out a duplicate.

## Meshy assets

See `assets/README.md`: low-poly models, one consistent 3/4 camera angle, transparent PNG
renders at 2x the sizes in `items.js`, packed into an atlas. Every sprite key currently
generated by TextureFactory can be replaced 1:1 by a loaded image with the same key.

## Current placeholders

Everything visual and audible is procedural (vector-drawn textures + WebAudio tones):
all 16 items, all trays, the room, all 15 decorations, UI, and every sound effect.
