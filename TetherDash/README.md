# Tether Dash

An endless runner set inside a square tunnel, where the walls and the ceiling are floors
too. Volt — a toy-factory robot with a magnetic tether to the tunnel's core — runs
forward forever; the track ahead is stitched together on the fly from modular pieces, and
the ones that matter have a hole in the floor too long for any jump. The way past is to
run off the corner and keep going up the wall.

Phaser 3, no dependencies: the runner is a rendered sprite sheet and everything else —
art and audio alike — is generated at runtime.

## Run

```
npm run dev
# serves the folder on http://localhost:8123 and opens it
```

(Or any static server — `python -m http.server`, etc. Phaser is vendored in
`vendor/phaser.min.js`.)

Append `?debug` to the URL for a face/speed/tier/chunk-count/fps readout. On `localhost`
the Poki SDK runs in debug mode, so ad breaks show test ads.

## Controls

| Steer across the face | Jump                |
| --------------------- | ------------------- |
| A / D or ← / →         | W, ↑ or Space       |

Hold a direction into a corner and the runner steps onto the next face round the tube;
the camera rolls to put it underfoot. **Esc** pauses, **R** restarts. Touch devices get
steer buttons bottom-left and a jump button bottom-right.

## How the tunnel works

The world is a square tube along `+z` with four faces — floor, right wall, ceiling, left
wall, in the order you meet them walking right around the inside. Each face carries its
own 2D coordinate system: `u` across it, `h` off it. **Gravity always points at the face
the runner is standing on**, so wall-running and ceiling-running need no special case in
the physics at all.

The only new mechanic is what happens at a corner. At `|u| = TUBE_R` two faces meet, and
the same world point is `(u, h)` on this face and `(h - R, R - u)` on the next one round.
`Runner.checkCorner` rotates position *and* velocity through that map, which is why a
wall-run feels continuous instead of like a teleport, and why jumping into a wall sticks
to it at the height you hit it. If the next face has no panel there, nothing happens —
and the ground check finds no floor, which is the fall.

The camera rolls `-90°` per face and lags by about a fifth of a second
(`CFG.ROLL_RATE`). That lag is most of what sells a flip: the runner stays upright in the
middle of the screen while the world swings through ninety degrees, so it reads as the
tunnel turning rather than the character falling over. `Projection` applies the roll as a
2D rotation of the cross-section before the same single-divide projection the game always
had — a wall becomes a floor purely by rotating it into view space.

## The track

Fourteen prefabs in `src/data/pieces.js`, stamped down by `src/systems/Track.js`. A piece
declares which panels exist on which faces, plus its bolts, hazards and pads, in
piece-local coordinates; nothing in it knows where it will end up.

- **Spawn and retire.** `Track.update(playerZ)` stamps a new piece whenever the far end
  comes inside draw distance, and hands the piece behind the runner back to the pools the
  moment it leaves the screen for good. About five pieces are ever live, so a
  five-minute run and a five-second run cost the same memory.
- **Coupler rings.** Every piece is welded on behind `RING_LEN` units where all four
  faces are solid. It is what makes the catalogue modular — a piece never has to care
  which face you arrive on — and it is long enough to walk from anywhere on a face to
  either of its corners.
- **Object pooling.** `src/systems/Pool.js`. Panel/bolt/hazard/pad records come from
  pools, and so do the Phaser sprites drawing them — bound to an entity for as long as
  its piece is alive, not per frame. Nothing is created or destroyed during a run; a
  soak over 5 km holds at ~110 display objects.
- **Grammar.** Pieces are weighted by a difficulty tier that opens up every 320 m. The
  same piece never appears twice running, and a tier-2+ piece is always followed by a
  breather.

The signature pieces are the ones the mechanic exists for: `wallRun` (18 units of missing
floor, both walls bridge it), `oneWall` (only one of them does), `ceilingRun` (the walls
run out sixteen units before the floor comes back), `spiral` (one continuous surface that
screws a quarter turn at a time) and `crossFlip` (floor → wall → ceiling, no way back
down until the end).

`GameScene.updateHint` reads the live track rather than a piece id: when the panels ahead
run out inside a gap no jump can clear and a neighbouring face carries on past it, a
chevron points at the wall to take. That is the whole tutorial, and it keeps working
forever.

## A run

Distance in metres plus 10 per bolt is the score; forward speed ramps from 11 to 21
units/sec with distance, and every 250 m is a milestone. Falling out of the tunnel is the
only way to lose — hazards knock you sideways and cost speed, which is dangerous mostly
because of where it puts you. One rewarded-video revive is offered per run, and it
rewinds the tunnel without rewinding the difficulty.

## Build

```
npm run check        # boots every script against a stub Phaser + audits the track
npm run build:poki   # -> dist/ (the folder Poki gets)
npm run package      # check, build, preflight, then dist/ -> tether-dash-poki.zip
```

`build:poki` is a concatenation, not a bundle. The classic scripts share globals through
the window, and `index.html` is where their load order is written down — so
`tools/build-poki.mjs` reads the order out of the HTML, concatenates those files into one
`game.js`, and rewrites the page to load it. Add a `<script src="src/...">` tag and the
build picks it up; there is no second list to keep in sync.

It is not a bundler because bundlers tree-shake: they drop top-level declarations nothing
appears to reference, which for classic scripts means `PIECES` and `CFG` vanish from the
output and the game dies on Poki rather than here. The build also strips the jsdelivr
Phaser fallback — fine when you serve the folder yourself, a blocked third-party request
inside Poki's sandbox.

### What `npm run check` enforces

An endless runner has no hand-checked levels: the generator will eventually show a player
every piece, at every difficulty, arriving on every face. So the guarantees are per piece
and structural.

- **Every piece has a route.** A breadth-first search over (face, z) starts on all four
  faces — the coupler ring makes that legal — and must reach the far end by running along
  a face, stepping round a corner where both faces are solid *and both reach it*, or
  clearing a gap no wider than a jump at the **slowest** run speed. A piece that fails
  that is not a hard piece; it is one that kills you whatever you do.
- **Panels are inside the tube**, wide enough to stand on, and inside the piece's own
  length. Bolts are below the top of a jump arc. Hazards and pads are on a panel rather
  than over a hole.
- **The generator behaves.** Five kilometres of tunnel: no chunk outside the catalogue,
  no piece repeated back to back, no hard piece without a breather after it, live chunks
  inside the spawn/retire window, every pooled record either in a live chunk or back in
  its pool, and every tier-0 piece actually seen.
- **The Poki lifecycle survives a slow SDK** — a `gameplayStart` fired before
  `PokiSDK.init()` resolves has to be replayed, in order, when it does.

## Poki SDK

`src/systems/PokiSDK.js` wraps the platform SDK (loaded in `index.html` from
`game-cdn.poki.com/scripts/v2/poki-sdk.js`). Every call no-ops when the SDK is missing —
ad blocker, offline, or serving the folder yourself — so the game stays fully playable
off-platform.

| Signal | Where |
| --- | --- |
| `init` → game boot | `main.js` — Phaser starts once init settles (5s timeout guard) |
| `gameLoadingStart` / `gameLoadingFinished` | init / `BootScene` after textures generate |
| `gameplayStart` / `gameplayStop` | `GameScene.create` / scene shutdown, pause, game over |
| `happyTime` | 250 m milestone (0.4), new personal best (1) |
| `commercialBreak` | `Poki.startRun` — skips the session's first run, then min 60s apart |
| `rewardedBreak` | the one revive offered per run, on the game-over panel |

Ads always play over a muted, frozen game: the wrapper stops gameplay, kills the tunnel
rush loop, suspends the WebAudio context and calls `game.loop.sleep()` for the duration,
restoring all of it afterwards. Every path into a run goes through `Poki.startRun`, so the
rule about when an interstitial may play lives in one place — and mid-run restart (pause
menu, **R**) deliberately does not go through it, because instant retry is the point.

### Shipping it

`poki.json` registers the game with the monorepo's pipeline: every push to `main` that
touches this directory runs `npm run check`, then `npm run build:poki`, then uploads
`dist/` as a new version. See `docs/poki-deploy.md` at the repo root.

The upload token goes in GitHub Secrets as `POKI_UPLOAD_TOKEN_TETHER_DASH` (the name is
derived from `ggs.id`; the token itself never goes in this repo). An upload creates a
version, it does not publish one — `make_public` is off by default.

## File structure

```
index.html            script load order lives here
vendor/phaser.min.js
poki.json             registers the game with the monorepo's deploy pipeline
tools/
  check.mjs           the CI gate: stub boot + piece audit + generator soak
  boot.mjs            stub-Phaser harness shared by check and build
  build-poki.mjs      index.html + src/ -> dist/
  package-poki.mjs    preflight + zip, for uploading by hand
  thumbshots.mjs      staged gameplay plates for the store thumbnail
  cutouts.mjs         transparent runner cutouts for compositing
  meshy/              Meshy model -> sprite sheet (Blender render + palette grade)
assets/
  runnerA.png         Volt: 8-frame walk sheet, 200x240 per frame
  runnerB.png         Bea: same rig, reproportioned + recoloured (title screen only)
  README.md           Meshy prompts + render rules for the remaining models
src/
  Config.js           every tuning number in one place
  main.js             game config (960x540, FIT scaling)
  data/pieces.js      the modular track catalogue
  scenes/
    BootScene.js      loads the runner sheets, generates the rest
    MenuScene.js      title over a live tunnel, sound toggle, personal best
    GameScene.js      the run, fake-3D rendering, HUD, touch, pause, game over
  systems/
    Projection.js     fake-3D camera math + the tube's face geometry
    Pool.js           record and sprite pools
    Track.js          spawn/retire loop, piece grammar, ground queries
    Runner.js         run/steer/jump + the corner map that flips faces
    CameraController.js  follows the runner and rolls to the face underfoot
    InputManager.js   keyboard + touch -> one input record per frame
    Effects.js        particles, floating text, shared button
    AudioSystem.js    procedural WebAudio (incl. the speed-tracking rush)
    PokiSDK.js        Poki platform wrapper (ads, gameplay signals) — no-ops off-platform
    TextureFactory.js procedural sprite art (fallback for the runner)
    SaveSystem.js     localStorage: best score, best distance, settings
```

## Art

The runner is an 8-frame walk cycle rendered from a Meshy model (`assets/runnerA.png`);
`BootScene` loads it and falls back to the hand-drawn mascot if it is missing, so the game
runs without it. Because the camera rolls with the tunnel, the same forward-running sheet
serves the floor, both walls and the ceiling — there is no upside-down art to make.

Everything else is procedural: sprites are drawn at runtime by `TextureFactory` and every
sound is synthesized. The tunnel itself is projected quads — dark panels with neon edges,
one hue per face, so a glance at the edge colour says which way is currently down.
`assets/README.md` holds the prompts for the remaining models; `tools/meshy/` holds the
Blender + PIL pipeline that turns one into a sheet.
