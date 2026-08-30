# Rooftop Rascal: Cat Escape

A Temple Run–style 3D rooftop auto-runner for the browser. You are an orange
cat who has just stolen a grilled fish from a restaurant. The chef and two
guard dogs are coming. You run at a constant pace down three lanes, dodging
obstacles, timing jumps and double-tapping the corners you don't want to run
straight off of.

Built with vanilla TypeScript, Three.js, Rapier 3D and Vite. No React, no
backend, no accounts, and **no network requests during gameplay**.

---

## Quick start

```bash
npm install     # also extracts the game assets (postinstall)
npm run dev     # http://localhost:5173
```

```bash
npm run build     # type-check + production build into /dist
npm run preview   # serve the built game
npm test          # 169 tests: save validation, physics, level & route geometry
npm run playtest  # headless browser playtest against a running preview
npm run profile   # render-cost profile against a running preview
```

`npm run playtest` drives a locally installed Chrome over the DevTools Protocol
(no extra dependencies) against `http://localhost:4173`. It boots the built
game, records every console message, uncaught exception and failed request, then
actually plays it — auto-runs, changes lanes, takes a corner with a double-tap,
jumps, pauses, restarts, loses lives, dies, loads all three levels — asserting
on live scene and physics state, and writing screenshots to
`scripts/playtest/shots/`. Set `CHROME_PATH` if your browser isn't found.
`npm run profile` uses the same harness to report per-level render cost — see
[Performance notes](#performance-notes).

`/dist` is a fully self-contained static site. Drop it on any static host —
there is no server component.

---

## Controls

The cat runs on its own at a constant speed — there is no throttle. Every
input is a discrete, edge-triggered pulse: a lane step, a corner turn, or a
jump.

### Keyboard

| Key | Action |
|---|---|
| `A` / `←` | Move one lane left. Tap twice within 280 ms to also turn a left corner. |
| `D` / `→` | Move one lane right. Tap twice within 280 ms to also turn a right corner. |
| `W` / `↑` / `Space` | Jump |
| `R` | Instant restart |
| `Esc` | Pause |
| `M` | Mute |
| `F2` | Physics debug panel |

A single tap always shifts a lane immediately, with no added latency. A second
tap on the *same* side, fast enough, additionally commits to a corner turn —
but only if a corner is actually in reach. Missing the double-tap at a corner
runs the cat straight off the roof.

You have **3 lives** per attempt, shown as 🐾 icons top-right. A failed
obstacle, a missed corner or a fall costs one life and buys a couple of
seconds of invulnerability (the cat flickers) to get clear. Losing the third
ends the run.

### Touch

One lane-change button bottom-left, one bottom-right, and jump on the far
right. Forward is automatic. Tap a lane button once to change lanes, twice to
also turn a corner — same timing as the keyboard. Buttons support
**simultaneous multi-touch**, so you can change lanes and jump with different
thumbs. There is no brake button; there is no throttle to fight. Button size
is adjustable in Settings.

### Gamepad

| Input | Action |
|---|---|
| Left stick (or D-pad) left/right | Move one lane |
| Left shoulder (L1/LB) | Turn a left corner, no double-tap needed |
| Right shoulder (R1/RB) | Turn a right corner, no double-tap needed |
| South button (A / ✕) | Jump |
| Start | Pause |

A pad has spare buttons, so corner turns get dedicated shoulder buttons rather
than a double-tap, which would be awkward on a stick.

---

## How it plays

Movement is **prescribed, not driven** — a three-lane auto-runner, not a
free-driving car. The cat is still a dynamic Rapier body (so gravity, landing
detection and wall blocking all still come from the physics solver for free),
but every step the controller writes its heading and horizontal velocity
outright rather than accelerating it with forces:

- Forward speed is **constant**. There is no throttle and no way to go faster
  or slower — every jump in every level is sized around this one number.
- The track is three lanes wide. A tap moves the cat one lane over,
  immediately.
- Corners come in two flavours: gentle bends are walked through automatically,
  no input needed, but a sharp corner demands a **double-tap** on the turn
  side while it's in reach. Miss it and the cat runs straight off the roof.
- Low-grip surfaces (metal, glass, awnings) still cost you: they push the cat
  sideways and blunt how fast a lane change lands, even though nothing is
  pushing it around directly any more.
- Bad landings and clipped obstacles cause a brief, mushy stumble — reduced
  lane authority and forward speed for under half a second — not a tumble.

You get **3 lives** per attempt, shown as 🐾 top-right. A failed obstacle, a
missed corner, or a fall costs one life and buys a couple of seconds of
invulnerability (the cat flickers) to get clear and land back on the route.
Losing the third life — or being caught by a pursuer — ends the attempt, with
a brief slow-motion beat and a restart in under half a second. Doing nothing
restarts automatically after a couple of seconds, so the loop never stalls.

Each level hides **three fish tokens** on riskier lines, which count towards
level progress. The character pack's six coats — orange tabby (the default),
brown tabby, calico, tuxedo, black and russian blue — are all selectable from
the Customize screen from the start. Cosmetics never affect physics.

**Assist Mode** (Settings, off by default) adds one midpoint checkpoint per level.
Runs completed with it are flagged as such on the results screen.

---

## Browser support

Needs WebGL 2, WebAssembly, ES2022 and the Web Audio API — every current
version of Chrome, Edge, Firefox and Safari (desktop and mobile) qualifies.

- Audio cannot start until the first user interaction; the game unlocks it on the
  first pointer or key event, as browsers require.
- WebGL context loss is handled: the game pauses and resumes cleanly.
- The simulation pauses when the tab is hidden or focus is lost.
- Landscape is preferred on mobile; portrait shows a rotate hint but still runs.

---

## Architecture

```
scripts/extract-assets.mjs   Cherry-picks the used models out of the source archives
public/assets/               Extracted runtime assets (cat, dog, KayKit props)
index.html                   Every UI screen, plus the inline SVG icon sprite sheet
src/
  main.ts                    Entry point
  game/
    Game.ts                  Orchestrator: renderer, loop, level lifecycle
    GameState.ts             State enum + machine with legal-transition table
    InputManager.ts          Keyboard, multi-touch, gamepad -> one RunInput (lane step, turn, jump)
    AudioManager.ts          Fully procedural Web Audio synthesis
    SaveManager.ts           localStorage behind a StorageAdapter, heavily validated
    SettingsManager.ts       Settings + change notifications
    IntegrationHooks.ts      Optional platform hooks (no-ops by default)
  physics/
    PhysicsConfig.ts         EVERY movement tunable, in one object
    PhysicsWorld.ts          Rapier wrapper, fixed timestep + render interpolation
    PlayerController.ts      Prescribes yaw + horizontal velocity onto a dynamic body every step
  camera/FollowCamera.ts     Spring camera with occlusion raycast and shake
  entities/
    Cat.ts, CatSkins.ts      Rigged cat + procedural attitude layer, runtime recolours
    Pursuer.ts               Route-following base for all chasers
    Dog.ts, RestaurantOwner.ts, Chef.ts, PigeonFlock.ts, Collectible.ts
  levels/
    LevelTypes.ts            The level data schema
    LevelManager.ts          Build / reset / dispose one level
    ChaseRoute.ts            Catmull-Rom spline: pursuer path + progress measure
    RunPath.ts               The route reduced to straight lane-runs + classified corners
    LevelGeometry.ts         compressGaps(): load-time gap-fit transform, paired with runSpeed
    level1.ts level2.ts level3.ts, index.ts
  obstacles/
    ObstacleFactory.ts       Level data -> meshes + colliders
    MovingPlatform.ts CollapsingTile.ts SteamVent.ts SwingingSign.ts Clothesline.ts
  effects/ParticlePool.ts CameraShake.ts
  assets/AssetRegistry.ts ProceduralProps.ts
  ui/UIManager.ts            Owns every DOM overlay
  styles/main.css
tests/smoke.test.ts
```

### The loop

```
frame()               render rate, variable dt — visuals, camera, HUD, particles
  physics.update()    accumulates real time
    fixedStep()       called at exactly 1/60s, N times per frame
                      player, obstacles, pursuers, fail checks
```

Nothing gameplay-relevant happens at render rate, which is why the game behaves
identically at 30, 60 and 144 fps. Visuals interpolate between the last two
physics steps.

### The chase

Pursuers have no navigation and no physics. Each holds one number — how far
along the level's spline it is — and reads its world position back off the curve.
Player progress is that same spline, projected. "How close is the chef" is
therefore a subtraction, and the whole chase is O(1) per pursuer per frame.

Believability comes from animation instead: run cycles, a bob, and a scripted
leap whenever a downward raycast finds no roof under the route.

---

## Creating another level

1. Copy `src/levels/level1.ts` to `src/levels/level4.ts`.
2. Change `id`, `name` and `index`.
3. Lay out `objects`, then trace the player's intended line through `route`.
4. Register it in `src/levels/index.ts`:

```ts
import { level4 } from './level4';
export const LEVELS: readonly LevelDef[] = [level1, level2, level3, level4];
```

That is the whole process — level select, unlock progression, results screens and
the smoke tests are all driven off that array.

### Conventions that will bite you

- Platform `position` is the slab **centre**. A slab at `y = 20` with
  `size.y = 1` has a walking surface at `y = 20.5`.
- Props (`chimney`, `acUnit`, `crate`, `watertower`, `barrel`, `flowerpot`,
  `prop`) have their origin at their **base** — place them *at* the surface
  height, not half-buried.
- `rotation` is in **degrees**.
- The `route` triples up: it's the pursuer path, the progress yardstick, *and*
  what `RunPath` simplifies into the lane track the player actually runs on
  (straight runs joined by classified corners — see `RunPath.ts`). It must
  follow the intended line, sit near walking height, and end within ~30 units of
  `finish.position`.
- Every route point must be above `killPlaneY`.
- Exactly three tokens. `chase.dogSpeed` must exceed `chase.chefSpeed`. Both are
  asserted by the tests.
- Gap sizing is two-step: author against a generous eyeball budget, then
  `compressGaps`/`GAP_COMPRESSION` in `src/levels/index.ts` pulls every
  authored gap a third closer at load time so it fits inside the actual
  measured reach at `PHYSICS.runSpeed` (currently ~9.5 units — `runSpeed` and
  `GAP_COMPRESSION` are a matched pair, see `TUNING.md`). Anything too wide
  even after compression needs a ramp or a steam vent. `npm test` walks every
  level's *compressed* geometry and fails on a gap that is too wide, so you
  will find out immediately.

Available obstacle kinds are the `LevelObject` union in `LevelTypes.ts`, and
`prop` names are listed in `ObstacleFactory.createPropMesh`.

---

## Replacing procedural models and sounds

### Models

Anything with no source asset is built in code in
`src/assets/ProceduralProps.ts` — chimneys, AC units, dishes, awnings,
clotheslines, signs, pigeons, and so on. To swap one for a real model:

1. Put the `.gltf`/`.glb` in `public/assets/`, and add it to the extraction list
   in `scripts/extract-assets.mjs` if it comes from an archive.
2. Preload it: add the name to `CITY_PROPS` / `RESTAURANT_PROPS` in
   `src/levels/index.ts`, or call `registry.loadProp(pack, name)`.
3. Reference it from level data as `{ kind: 'prop', prop: 'pack:model' }`, or
   replace the `build*()` call in `ObstacleFactory`.

Imported models are auto-normalised: `AssetRegistry.PACK_SCALE` handles the
per-pack scale difference (the KayKit city pack is authored at 1/10 the scale of
the restaurant pack), and rigged characters are measured and scaled to a target
length rather than relying on a magic multiplier.

### Sounds

All audio is synthesised — there are no audio files. `AudioManager.ts` documents
the swap-in path at the top of the file: preload `AudioBuffer`s, branch in the
one-shot builder, and reuse the existing gain and panner scaffolding.

### Cat skins

There is one cat texture on disk and it is a **tuxedo** cat, so all five
variants — the default orange included — are baked at runtime by sampling a
per-skin luminance ramp over `catskin.png` (`src/entities/CatSkins.ts`).

A ramp rather than a hue/saturation tint, because the source is essentially
two-tone: its body pixels are near-black, and saturation is a multiplier, so no
amount of tinting turns them orange. Edit a skin's `ramp` to restyle it, or
replace `getSkinTexture()` with a lookup of preloaded textures to ship real ones.

The orange ramp is deliberately lighter and more golden than a real ginger cat:
`PALETTE.terracotta` is the colour of nearly every surface the cat runs on, and
an accurate ginger sits within a few points of it and vanishes into the floor.

---

## Platform integration hooks

There is **no advertising SDK, no analytics, no authentication and no server
communication**. Instead there are optional hooks that default to harmless
no-ops, so a host page can wire in a platform without touching game code:

```html
<script type="module">
  // Available on window before or after the game boots.
  window.RooftopRascal.setIntegrationHooks({
    onGameStarted() { /* ... */ },
    onLevelCompleted(levelId, timeMs, collectibles) { /* ... */ },
    onGameFailed(reason) { /* ... */ },
    async onRewardedContinueRequested() { return false; },
    onSoundChanged(enabled) { /* ... */ },
  });
</script>
```

Or from inside the bundle:

```ts
import { setIntegrationHooks } from './game/IntegrationHooks';
```

Every hook invocation is wrapped in try/catch, so a badly behaved host
integration cannot break the game. `reason` values are `'fell'`,
`'caughtByDog'`, `'caughtByChef'` and `'outOfBounds'`.

---

## Performance notes

- Fixed 1/60 physics with render interpolation, capped catch-up steps.
- Device pixel ratio capped (1.0 / 1.25 / up to 2.0 by quality setting).
- **Static props are merged at build time.** Props are *authored* as models — a
  chimney is a stack plus its pots, a garden is planters plus shrubs — and then
  collapsed by `freezeStatic()` into one mesh per material before they are ever
  drawn. Subtrees marked with `markAnimated()` (fan blades, pigeon wings) are
  left alone, and `ObstacleFactory.ANIMATED_KINDS` opts out the kinds that are
  driven part-by-part at runtime.
- Instanced meshes for roof tiles and particles; one pooled `InstancedMesh`
  draws every particle in the game.
- Shared geometry and material caches; `MeshLambertMaterial` throughout — no PBR.
- One directional light plus a hemisphere fill. The sun's shadow frustum is
  tight (±32 units) and **follows the runner**, snapped to the shadow map's
  texel grid so the edges do not crawl as it moves.
- The camera's far plane is set from each level's `fogFar`, so nothing is
  rasterised that the fog has already made opaque.
- **The skyline is a silhouette band, not models.** The scattered instanced
  buildings that used to ring each route were about half of every frame's
  triangles, drawn behind fog that had already flattened them to a single tint,
  and flagged `frustumCulled = false` so the whole ring resubmitted every frame.
  They are now 72 plain boxes — one draw call, 864 triangles for the entire
  horizon. The band is centred on the *runner* and carried along by
  `LevelManager.updateFocus()`, which is what keeps every box inside the narrow
  fog window where it reads as a silhouette; sizes are fractions of the band's
  radius and the colour is derived from each level's fog, so it self-tunes
  across the daylight and night levels.
- Level teardown disposes every body, geometry, material and light, so switching
  levels leaks nothing.
- Simulation pauses when the tab is hidden.

Graphics quality (Settings) trades shadows, particles and pixel ratio.

### Measuring it

`npm run profile` (against `npm run preview`) reports draw calls, triangles,
resident GPU resources and shadow-caster counts per level. Draw calls and
triangles are hardware-independent and are what the budget is written against;
the fps it also prints comes from a software rasteriser and is only a relative
signal between runs on the same machine.

| Level | Draw calls | Triangles  |
| ----- | ---------- | ---------- |
| 1     | 898 → 284  | 257k → 61k |
| 2     | 663 → 226  | 303k → 48k |
| 3     | 886 → 166  | 320k → 38k |

---

## Accessibility

Reduced camera motion · Reduced screen shake · Assist Mode (one midpoint
checkpoint, off by default) · Master / music / effects volume and mute ·
High-contrast tutorial and HUD text · Adjustable touch control size · Graphics
quality · Pause on focus loss. `prefers-reduced-motion` disables UI animation.

---

## Licensing

All assets are CC0, supplied by the project owner, or generated in code. See
[ATTRIBUTION.md](ATTRIBUTION.md). Physics tuning is documented in
[TUNING.md](TUNING.md).
