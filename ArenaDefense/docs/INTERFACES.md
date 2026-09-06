# Frozen interfaces (P2 → P3/P4)

This file is the contract P3 (spawner + enemy AI + billboards) and P4 (build
overlay + turrets + energy) code against. It has to match the code — if you
change a shape below, update this file in the same change. Everything here
lives in `src/game/{assets,Arena,Player,Effects,Game}.js`,
`src/ui/{input,Hud}.js`, and `src/platform/audio.js`.

## `InputFrame`

Produced fresh every fixed step by `Input#frame()` (`src/ui/input.js`); the
underlying scheme resets its own edge/delta accumulators on read, so calling
`frame()` twice in the same step is destructive (don't).

```js
/**
 * @typedef {object} InputFrame
 * @property {'touch'|'keyboard'} mode
 * @property {number} moveX      -1..1, positive = right (strafe), already normalised so a diagonal isn't faster.
 * @property {number} moveY      -1..1, positive = forward.
 * @property {number} lookDX     Pixels of look movement this frame, +x = right. Touch and mouse share this convention (touch is a delta-accumulating pad, mouse is `movementX`).
 * @property {number} lookDY     Pixels of look movement this frame, +y = down.
 * @property {boolean} fire      Level-triggered: true every frame the fire input is held (keyboard: left mouse button down; touch: always false — Game decides auto-fire from `player.aimTarget`).
 * @property {0|1|2|3} select    Edge-triggered turret-type pick (keyboard 1/2/3 keys only in P2; touch has no equivalent — BuildOverlay (P4) reads its own DOM taps directly, not through InputFrame).
 * @property {boolean} ready     Edge-triggered "Ready" (keyboard Space/Enter only in P2).
 * @property {boolean} pause     Edge-triggered pause toggle (keyboard Escape only in P2; unused by Game in P2 — see "Known P2 scope cuts" below).
 */
```

`Input` also exposes: `input.mode`, `input.freeze(bool)` (zeroes and ignores
all input — used for ad breaks/tab-hidden), `input.onModeChange(fn)`
(subscribes to silent scheme swaps, e.g. a mouse docked to a tablet), and
`input.dispose()`.

## `Assets` (`src/game/assets.js`)

```js
/** @returns {Promise<Assets>} */
export async function loadAll(onProgress) {}

/** `window.__ASSET_BASE__ + path` — build every asset URL through this, never a literal relative path. */
export function assetUrl(path) {}

class Assets {
  /**
   * Geometry/material/local-transform for one named mesh inside a loaded
   * GLB — `'zed_1'`, `'zed_3'`, or any mesh named in
   * `public/assets/manifest.json` (`SM-7-Fence`, `SM-8-Pillar`, `SM-3-Tomb1`,
   * `Rock_1`/`Rock_2`/`Rock_4`, `Gun_03`, `Gun_02`, `AmmoBox_5`,
   * `AttachedBoxes`, `Barricade_03`, `BarbedWires`). `localMatrix` MUST be
   * applied when building an `InstancedMesh` from `geometry` — it carries
   * the mesh's authored offset within its GLB, which for a meshopt-quantized
   * GLB is not optional (see the comment on `InstanceSource` in assets.js).
   * @param {string} name
   * @returns {{ geometry: THREE.BufferGeometry, material: THREE.Material, localMatrix: THREE.Matrix4 }}
   */
  instanceSource(name) {}

  /**
   * A standalone `Mesh` for `name`, positioned/rotated/scaled as authored
   * (its `localMatrix` decomposed onto the mesh's own transform) and
   * carrying its own material clone (safe to mutate per-instance —
   * emissive glow, tint — without affecting other placements). Geometry is
   * shared with every other instance of the same name.
   * @param {string} name
   * @returns {THREE.Mesh}
   */
  propMesh(name) {}

  /**
   * The brainrot sprite atlas. `sprites` is `brainrot.json`'s `sprites` map
   * (`{ [name]: { x, y, w, h, u0, v0, u1, v1, aspect } }`) — see "Billboard
   * atlas UV convention" below for how to sample `texture` with these rects.
   * @returns {{ texture: THREE.Texture, sprites: Record<string, {x:number,y:number,w:number,h:number,u0:number,v0:number,u1:number,v1:number,aspect:number}> }}
   */
  atlas() {}

  /** @type {Map<string, ArrayBuffer>} Raw (not decoded) audio bytes, keyed by filename without extension (e.g. `'pistol-shot-1'`). Decode through `platform/audio.js`, never directly. */
  audioBuffers;
}
```

### Billboard atlas UV convention

`brainrot.json`'s rects are in **top-left-origin, y-down** pixel/UV space:
row 0 of the source PNG is `v=0`, and `v` increases downward through the
image — `u0,v0` is a sprite's top-left corner, `u1,v1` its bottom-right.

`assets.atlas().texture` is loaded with **`flipY = false`**. Three's default
(`flipY = true`) re-flips the image on upload so GL's bottom-left-origin
`v=0` lines up with a *bottom*-left-origin UV convention — the opposite of
what `brainrot.json` already assumes. With `flipY = false` the image uploads
byte-for-byte, so **sample with `u0,v0,u1,v1` directly — no `1 - v` flip.**
`minFilter` is `NearestMipmapLinearFilter` (the atlas is 1024px, well above
the 256px mip-mapping threshold used elsewhere in this file), `magFilter` is
`NearestFilter`, `colorSpace` is `SRGBColorSpace`.

Billboards.js (P3): build the quad so local UV `(0,0)` is the sprite's
top-left (quad's top) and `(1,1)` is bottom-right (quad's feet/floor) — that
maps directly onto `u0,v0`..`u1,v1` with no inversion.

## `Player` (`src/game/Player.js`)

Public fields: `x, z, yaw, pitch, hp, alive, invulnUntil, speed, radius,
eyeHeight, gun` (a reference to `config.player.gun`).

Yaw/pitch convention: yaw `0` looks toward `-z` (matching
`core/arenaGeometry`'s "gate angle 0 = north/-z"), increasing clockwise.
Pitch is positive looking up, clamped to `±pitchLimitDeg`. Camera uses Euler
order `'YXZ'`, `rotation.y = -yaw`, `rotation.x = pitch`.

**Clock**: `invulnUntil` and `fire()`'s cooldown compare against the
player's own fixed-step clock (`_time`, accumulated one `dt` per
`update()` call). This is numerically identical to `Game`'s `world.time`
from frame 0 onward (both start at 0 and advance by the same `dt` every
step) — so `player.invulnUntil = world.time + seconds` is exactly correct
for a future revive system to grant invulnerability.

```js
class Player {
  /** @param {number} dt @param {InputFrame} frame */
  update(dt, frame) {}

  /** @returns {{origin: THREE.Vector3, dir: THREE.Vector3} | null} `null` while on `gun.rate` cooldown or dead. */
  fire() {}

  /** @param {number} n Ignored while dead or `world.time < invulnUntil`. */
  takeDamage(n) {}

  /** Resets position/orientation/health for a new run (camera/viewmodel objects persist). */
  reset() {}

  /**
   * Nearest candidate within `gun.coneDegTouch` of the current view
   * direction, or -1. Used by touch auto-fire; P3 passes
   * `world.enemies.targets()`. `candidate.radius` is accepted for a future
   * radius-aware test but unused in v1.
   * @param {{x:number,y:number,z:number,radius:number}[]} candidates
   * @returns {number}
   */
  aimTarget(candidates) {}
}
```

## `Effects` (`src/game/Effects.js`)

```js
class Effects {
  /** Radial burst (hit sparks, kill puffs). @param {number} x @param {number} y @param {number} z @param {number} color @param {number} n */
  burst(x, y, z, color, n) {}

  /** One bright, very short-lived particle (muzzle flash). */
  flash(x, y, z) {}

  /** A ~0.06s hitscan tracer from `a` to `b`. @param {THREE.Vector3} a @param {THREE.Vector3} b */
  tracer(a, b) {}

  /** @param {number} dt */
  update(dt) {}

  dispose() {}
}
```

Particle pool cap 256 (thin-box tracer pool cap 32, separate); free-list with
oldest-first eviction when exhausted; hidden instances get a zero-scale
matrix, never removed from the buffer. Particles are small tumbling cubes,
not camera-facing quads — `update(dt)` takes no camera.

## `Arena` (`src/game/Arena.js`)

```js
class Arena {
  /** @type {{id:number, angle:number, x:number, z:number, active:boolean}[]} One per `CONFIG.arena.gateAngles`, in `core/arenaGeometry.gatePositions` order. `angle` is degrees, same convention as `arenaGeometry`. */
  gates;

  /** @param {number[]} ids Gate ids to mark active (barricade/barbed-wire hidden, arch glows red); the rest close. */
  setActiveGates(ids) {}

  dispose() {}
}
```

## `Game` (`src/game/Game.js`)

```js
class Game {
  /** @param {{renderer, scene, camera, assets, input, hud, audio, config}} deps */
  constructor(deps) {}

  /**
   * @type {{
   *   player: Player, arena: Arena,
   *   enemies: null | { targets(): {x:number,y:number,z:number,radius:number}[] },
   *   turrets: null | { list(): any[] },
   *   boss: null | object,
   *   billboards: null | object,
   *   effects: Effects,
   *   bus: EventBus,
   *   time: number,           // seconds, fixed-step clock; see Player's clock note.
   *   activeGates: number[],  // the current wave's lit gate id pair.
   * }}
   */
  world;

  /** @type {GameStateMachine} */ // from core/stateMachine.js
  state;

  /**
   * Attaches a system whose `update(dt, world)` runs once per fixed step, in
   * registration order, after `player.update()` and before `effects.update()`.
   * @param {string} name
   * @param {{ update(dt: number, world: object): void }} system
   */
  registerSystem(name, system) {}

  pause() {}
  resume() {}

  /** Build-phase overlay snapshot. `turrets`/`slots` are placeholders (`[]` / full slot list) until P4 lands. */
  getSnapshot() {}
}
```

Fixed-step order every step: **read `InputFrame` → `player.update()` (+
firing) → registered systems, in registration order → `effects.update()` →
HUD sync.** State-machine bookkeeping (title→build detection, the build
countdown/Ready, the wave→death check) happens around that pipeline, not
inside it.

### Event bus (`game.bus`, `core/events.js`)

| Event | Payload | Emitted when |
| --- | --- | --- |
| `state:changed` | `{ state: GameState }` | Every state-machine transition P2 drives (`title`, `build`, `wave`, `death`). |
| `build:tick` | `{ secondsLeft: number }` | Every fixed step while `state === 'build'`. |
| `player:fired` | `{ origin: THREE.Vector3, dir: THREE.Vector3 }` | Every successful `player.fire()` (not on cooldown). |
| `player:damaged` | `{ hp: number, amount: number }` | Any fixed step where `player.hp` dropped since the previous step, from any source (`takeDamage` calls made by P3/P5 systems included — `Game` detects the delta, callers don't need bus access). |

P3/P5 will add their own events (`enemy:spawned/killed`, `wave:started/
cleared`, boss events) on the same bus; this table only covers what P2
itself emits.

### Known P2 scope cuts (so P3/P4 don't wait on them)

- `wave` never transitions to `waveClear` — there's no spawner/enemy count
  to clear yet. P3 wires that transition when `Enemies`/boss land.
- `frame.pause` (Escape) is read but unused by `Game` — no pause menu exists
  yet. `Game.pause()/resume()` work (used by `visibilitychange`); wiring a
  manual pause UI to the `pause` edge is a later package's call, and should
  NOT reuse `input.freeze()` for that (freeze is a one-way "ignore
  everything" switch meant for ad breaks, not a toggle the player can back
  out of with the same key).
- `death` never transitions onward (revive/`runEnd` is P6).
- The player can move/fire during `title`/`build` — P2 doesn't freeze
  gameplay behind the title panel; P6's real title screen can add that.

## `Hud` (`src/ui/Hud.js`)

```js
class Hud {
  setHp(hp, hpMax) {}
  setEnergy(energy) {}
  setWave(n, total) {}
  /** Not in the original brief's list, added to satisfy "a visible countdown in the HUD" during `build`. @param {number|null} secondsLeft */
  setBuildCountdown(secondsLeft) {}
  /** @param {boolean} hasTarget Turns the reticle red. */
  setReticle(hasTarget) {}
  /** @param {number} kills @param {number} fraction 0..1 of the combo window remaining. Hidden while `kills <= 0`. */
  setCombo(kills, fraction) {}
  /** @param {number|null} frac 0..1, or `null` to hide the bar. */
  setBossHp(frac) {}
  toast(text) {}
  show(visible) {}
}
```

`body.touch`/`body.keyboard` (set by `Input`) toggle `.hud-hint--keyboard`/
`.hud-hint--touch` via CSS — no JS wiring needed between `Input` and `Hud`.

## `Audio` (`src/platform/audio.js`)

```js
class Audio {
  /** @param {Assets} assets */
  constructor(assets) {}

  /** Lazily creates the `AudioContext` (idempotent) and resumes it if suspended. Auto-called on the first `pointerdown`/`keydown`/`touchstart`; safe to call again anytime. */
  unlock() {}

  /** @param {string} name Matches an `assets.audioBuffers` key. @param {{vol?: number, rate?: number, pan?: number}} [opts] Decodes+caches `name` on first use; silent no-op if unlocked/running is false or muted. */
  play(name, opts) {}

  suspend() {} // ad break
  resume() {}
  /** @param {boolean} muted */
  setMuted(muted) {}
}
```

Master gain `0.5`. Sound names available in v1 (all 14 files in
`public/assets/audio/`, name = filename without extension): `ui-click`,
`ui-place`, `ui-deny`, `wave-start`, `boss-alert`, `coin`, `pistol-shot-1`,
`turret-shot-1`, `impact-heavy`, `zombie-death-1`, `zombie-attack-1`,
`explosion-metal`, `mechanical-clunk`, `upgrade-confirm`.

## P3 additions (P3 → P4/P5/P6)

Everything below lives in `src/core/enemyBrain.js`, `src/game/{Enemies,
Billboards}.js`, and P3's wiring in `src/game/Game.js`. `world.enemies` and
`world.billboards` are populated from `boot` onward (never `null` — unlike
`world.turrets`/`world.boss`, which stay `null` until P4/P5 register their
own systems and populate them; code reading those two must still
optional-chain).

### `Enemies` (`src/game/Enemies.js`)

Deviation from the plan's constructor sketch: takes an `audio` instance too
— `new Enemies(scene, assets, cfg, bus, billboards, audio)` — rather than
routing every combat sound through `bus` listeners in `Game.js`. It needs
direct, per-sound-throttled control (30 zombies must not spam
`zombie-attack-1`), and nothing outside this file needs to know about
individual melee/impact sounds.

```js
class Enemies {
  /** @returns {number} Count of currently-alive enemies. */
  get alive() {}

  /**
   * @param {string} typeName Key into `cfg.enemies.types`.
   * @param {number} gateId Arena gate id (0..2) — already resolved from the
   *   wave's active-gate pair; `Game.js` does `activeGates[entry.gateId]`
   *   before calling this, so this file never sees the 0/1 pair-relative index.
   * @param {number} [hpMul]
   * @returns {number} Pool index, or -1 when at cap.
   */
  spawn(typeName, gateId, hpMul) {}

  /** @param {number} dt @param {object} world The `Game.world` bag. */
  update(dt, world) {}

  /**
   * @param {number} idx
   * @param {number} dmg
   * @param {string} source Free-form origin tag: `'player'`, `'turret'`, ...
   * @returns {boolean} Whether this hit killed the enemy.
   */
  damageAt(idx, dmg, source) {}

  /** Splash damage; returns the number of kills it caused. @returns {number} */
  damageRadius(x, z, r, dmg, source) {}

  /**
   * @param {number} idx
   * @param {number} factor Speed MULTIPLIER while slowed — 1 = unaffected,
   *   smaller = slower (e.g. 0.5 = half speed). This is the opposite sense
   *   from `cfg.turrets.types.tesla.slow` (a *strength*, bigger = more
   *   slow) — invert at the call site (`Turrets.js` already does: `1 -
   *   stats.slow`).
   * @param {number} durS
   */
  applySlow(idx, factor, durS) {}

  /**
   * Cylinder hit test (`typeDef.radius`, `typeDef.hitHeight`) per alive
   * enemy, nearest hit wins. Used by `Game.js` for the player's hitscan gun.
   * @param {THREE.Vector3} origin @param {THREE.Vector3} dir Normalized. @param {number} maxDist
   * @returns {{idx:number, point:{x:number,y:number,z:number}, dist:number}|null}
   */
  raycast(origin, dir, maxDist) {}

  /** @returns {{x:number,y:number,z:number,radius:number}[]} Centred at half `hitHeight` — feeds `player.aimTarget` for touch auto-fire. */
  targets() {}

  /** @returns {{idx:number,x:number,y:number,z:number,radius:number}[]} For turret targeting — `idx` is the real pool index `damageAt`/`applySlow` expect, `y` centred at half `hitHeight`. */
  positions() {}

  /** @param {(idx:number) => void} fn Calls `fn` once per currently-alive pool index. */
  forEachAlive(fn) {}

  /** Kills/hides every alive enemy and in-flight projectile. `Game.js` calls this at the start of every fresh run (`_startRun`) so a previous run's leftovers never carry into the next. */
  clear() {}
}
```

Rendering: two `InstancedMesh`es (one per voxel model, `zed_1`/shambler and
`zed_3`/spitter, each sized `cfg.enemies.cap`) built from
`assets.instanceSource(name)` with `localMatrix` applied, plus one billboard
slot per `tungtung` via `Billboards.alloc/free/set`, plus a 64-capacity
`InstancedMesh` of spheres for spitter projectiles (hit-tests the player and
every `world.turrets?.list()` entry at a 0.5 m radius each step, expiring
past `1.5 × typeDef.range`). All four meshes together are the "4 draw calls
for all smalls" the P3 brief's acceptance check refers to (plus whatever
`Billboards.js` itself adds for `tungtung`/a boss — see below).

Sounds (each with its own minimum replay interval so a crowd of zombies
doesn't spam the mixer): `zombie-attack-1` on a melee hit landing (player or
turret), `impact-heavy` when a spitter projectile hits the player,
`zombie-death-1` on every kill.

### `Billboards` (`src/game/Billboards.js`)

```js
class Billboards {
  /** @param {THREE.Scene} scene @param {import('./assets.js').Assets} assets @param {import('../core/types.js').GameConfig} cfg
   *  @param {number} cap Max simultaneous billboard units. */
  constructor(scene, assets, cfg, cap) {}

  /**
   * @param {string} spriteName Key into `assets.atlas().sprites`.
   * @param {number} height Metres; width is `height * sprite.aspect`.
   * @returns {number} Slot id, or -1 if the pool is exhausted.
   */
  alloc(spriteName, height) {}

  /** @param {number} id */
  free(id) {}

  /**
   * @param {number} id @param {number} x @param {number} z
   * @param {{y:number, sx:number, sy:number}} anim From `core/spriteAnim.bob` (optionally combined with `castRaise` for a boss cast).
   * @param {number} flash 0..1, from `core/spriteAnim.hitFlash`.
   */
  set(id, x, z, anim, flash) {}

  /** @param {number} id @param {number} r @param {number} g @param {number} b */
  setTint(id, r, g, b) {}

  /** Uploads attributes to the GPU, only for what changed since the last call. @param {number} dt */
  update(dt) {}

  /** @type {number} Live count of allocated (not necessarily visible) slots. */
  count;
}
```

`Game.js` constructs one shared instance sized `cfg.enemies.cap + 1` (the
`+1` reserves a slot for P5's boss on top of every enemy-cap-sized
`tungtung`) and hands it to both `Enemies` (for `tungtung`) and, later, P5's
`Boss.js` (for `patapim`) — both key off `render: 'sprite'` in
`cfg.enemies.types`/`cfg.bosses`. One `InstancedMesh` of camera-facing quads
(Y-axis-only billboarding, so feet stay planted regardless of camera pitch)
draws every billboard unit in one call; a second `InstancedMesh` of flat,
`depthWrite:false` discs draws their blob shadows. Hidden/free slots are
invisible via `aScale = (0,0)` (a zero-area quad), not a zero-scale
`instanceMatrix` — the per-instance `aScale` attribute is what actually
controls a slot's rendered size, since the shader's own billboard basis
doesn't look at `instanceMatrix`'s scale/rotation at all (only its
translation — the slot's feet position).

### Bus events (`game.bus`, `core/events.js`)

In addition to P2's table:

| Event | Payload | Emitted when |
| --- | --- | --- |
| `enemy:spawned` | `{ idx, type, gate }` | `Enemies#spawn` successfully allocates a pool slot. |
| `enemy:killed` | `{ idx, type, x, z, source, energy }` | An enemy's hp reaches 0 via `damageAt`/`damageRadius`, from any source. `Game.js` subscribes to this itself to add `energy` to `game.economy` — no other listener needs to. |
| `wave:started` | `{ wave, boss }` | `Game.js` enters `wave` (right after the `build -> wave` `state:changed`) and builds that wave's `SpawnScheduler`. `boss` is the wave's `cfg.waves[n].boss` string or `null`. |
| `wave:cleared` | `{ wave }` | The wave-clear condition (`scheduler.done && enemies.alive === 0 && !world.boss?.alive`) is met — emitted right after the `wave -> waveClear` `state:changed`, on both an intermediate clear and the final-wave (victory) clear. |

### `Game` additions

`world.enemies` and `world.billboards` are constructed in the `Game`
constructor and are never `null` (contrast `world.turrets`/`world.boss`,
still `null`-until-registered). `Enemies` is registered via
`registerSystem('enemies', enemies)`, so its `update(dt, world)` runs in the
normal registered-systems pass — after `player.update()`/firing, before
`effects.update()`.

`Game` now also exposes (read-only from outside — only `Game` itself ever
reassigns the underlying instance, on a fresh run):

```js
class Game {
  /** @returns {import('../core/economy.js').Economy} */
  get economy() {}
  /** @returns {number} Current wave number, 1-based. */
  get wave() {}
  /** @returns {number[]} The current wave's lit gate id pair. */
  get activeGates() {}
  /** @returns {import('../core/spawner.js').SpawnScheduler|null} `null` outside `wave`. */
  get scheduler() {}
}
```

`getSnapshot()` additionally carries `economy` and `scheduler` (the raw
instances, alongside the pre-existing `energy`/`wave`/`activeGates` fields).

Player firing (`_handleFiring`) now does a real hitscan: `world.enemies
.raycast(shot.origin, shot.dir, gun.range)`, and on a hit,
`damageAt(hit.idx, gun.dmg, 'player')`, a tracer to the hit point (instead of
the max-range point), and a small `effects.burst` at the hit point.

`?wave=N` (1..`run.finalWave`) skips the title screen and starts the run
directly at wave N's build phase — used for owner verification (P5's boss at
wave 5, late-wave balance). `?debug=1`'s HUD line now also shows
`alive/cap`.

**State machine note:** `core/stateMachine.js`'s `TRANSITIONS.waveClear` now
also allows `'runEnd'` (previously only `'build'`) — a minimal, additive
edge so the final wave's clear can chain straight into `runEnd` per the
plan's documented "wave==10 -> runEnd(victory)" behaviour, without touching
`wave`'s own transition list (`wave` still only ever goes to
`waveClear`/`death`). `death -> runEnd` (already legal) and the new
`waveClear -> runEnd` are both, for now, followed by a 3-second toast
("YOU DIED" / "ARENA CLEARED") and an automatic return to `title` — P6
replaces this with the real run-end screen and (for death) the
revive/decline flow.

## P4 additions (P4 → orchestrator/P5/P6)

Everything below lives in `src/core/turretLogic.js`, `src/game/Turrets.js`,
`src/game/buildPhase.js`, and `src/ui/BuildOverlay.js`. Written concurrently
with P3 — the `Enemies`/`positions()`/`applySlow()` shapes referenced here
match what landed in "P3 additions" above (this file's authors coordinated
the `1 - stats.slow` inversion note in both directions).

### `core/turretLogic.js` (pure)

```js
/** @returns {TurretStats} See core/types.js. splash/slow/slowDurS keys are
 *  only present when the type defines them (cannon: splash; tesla: slow +
 *  slowDurS) — a gun's stats object never carries a `splash` key at all. */
function statsFor(type, level, cfg) {}

/** @returns {number|undefined} Cost from `level` to `level+1`; `undefined` at max level. */
function upgradeCost(type, level, cfg) {}

/** @returns {number} `max(minCost, ceil((hpMax-hp) * costPerHpMissing))`, `0` at full health. */
function repairCost(turret, cfg) {}

/** @returns {number} Index into `enemies`, or -1. gun/tesla: nearest in range.
 *  cannon: most neighbours within `stats.splash`, ties broken by nearest. */
function pickTarget(turret, enemies, stats) {}

/** @returns {boolean} Mutates `turret.cooldown`; tops it back up by `1/stats.rate` (additive, not reset) on a ready call so cadence doesn't drift under a fixed step. */
function fireReady(turret, dt, stats) {}
```

### `TurretRecord` (`core/types.js`)

`{ slotId, type, level, hp, hpMax, x, z, alive }` (plus an internal
`cooldown` field owned by `fireReady`). **`alive: false` marks a destroyed
turret ("wreck") — the record is NOT removed from `Turrets`' bookkeeping
until `clearWreck(slotId)` runs**, so `Enemies.js`'s own turret-targeting
code (`chooseTarget`, the projectile-hit loop) must keep filtering
`t.alive !== false` itself, same as it already does.

### `Turrets` (`src/game/Turrets.js`)

```js
class Turrets {
  constructor(scene, assets, cfg, bus, effects, audio) {}
  place(slotId, type) {}   // throws if the slot already holds a record (alive or wrecked)
  upgrade(slotId) {}       // throws if dead or already at max level
  repair(slotId) {}        // throws if dead; no-op-safe to call at full hp (just re-sets hp = hpMax)
  damage(slotId, n) {}     // emits turret:destroyed at 0hp, greys the mesh, keeps the record as a wreck
  get(slotId) {}           // -> TurretRecord | null
  /** Every tracked record — alive AND destroyed. Deliberately NOT "only
   *  alive ones": `ui/BuildOverlay.js` renders a destroyed slot as a "grey
   *  X" from this same list, and `Enemies.js` needs the `alive:false`
   *  wrecks to skip in its own targeting — both read this one list. Code
   *  that only wants live turrets (this file's own `update()`) filters
   *  `.alive` itself. */
  list() {}
  clearWreck(slotId) {}    // no-op unless the slot holds a destroyed record; frees it for a new placement
  update(dt, world) {}     // world.enemies?.positions() / damageAt / damageRadius / applySlow — see below
  clear() {}
}
```

Visuals: base = `assets.propMesh(typeDef.base)` (`AmmoBox_5` or
`AttachedBoxes`), scaled up by a small fixed per-mesh factor
(`BASE_EXTRA_SCALE` in `Turrets.js`) so both read as roughly the same size —
**measured directly out of `props.glb`** (not in `manifest.json`, which
doesn't record a height for these two meshes): `AmmoBox_5` ≈0.50m tall,
`AttachedBoxes` ≈1.10m tall, both before the extra scale. Head: gun uses
`assets.propMesh('Gun_02')` (≈0.8×0.15×0.05m, reads as a barrel) plus a
small procedural mount; tesla and cannon heads are fully procedural
(stacked cylinders + emissive tip; a thick short cylinder, respectively).
Aiming uses `THREE.Object3D#lookAt` (self-updates its world matrix, so it's
safe to call mid-fixed-step) rather than manual yaw trig.

`update(dt, world)` reads `world.enemies?.positions() ?? []` — each entry is
`{idx, x, z, radius}` where **`idx` is the enemy's real pool index**, NOT
its position within that array (the array omits dead enemies, so the two
diverge after the first kill). `pickTarget` returns a position within the
array; `Turrets.js` resolves `enemies[pos].idx` before calling
`damageAt`/`applySlow` — get this backwards and turret fire silently damages
the wrong (or a since-freed) pool slot once any enemy has died.

`tesla`'s `applySlow(idx, factor, durS)` call inverts `cfg.turrets.types.
tesla.slow` (a *strength*, increasing with level) into the *speed
multiplier* `Enemies#applySlow` expects (`1 - stats.slow`) — see the
matching note on `applySlow` in "P3 additions" above.

Emits `turret:placed {slotId, type}`, `turret:upgraded {slotId, level}`,
`turret:repaired {slotId}`, `turret:destroyed {slotId}` on `game.bus`.

### `BuildOverlay` (`src/ui/BuildOverlay.js`)

```js
class BuildOverlay {
  constructor(cfg, audio) {}
  open(snapshot) {}
  close() {}
  setCountdown(secondsLeft) {}
  setEnergy(n) {}
  setSelectedType(type) {}
  refresh(snapshot) {}
  /** @type {boolean} */
  isOpen;
  // Set by buildPhase.js after construction — mutable public fields, not
  // constructor params, since the overlay is built before the game-state
  // wiring that drives it exists:
  /** @type {((slotId:number, type:string) => void)|null} */ onPlace;
  /** @type {((slotId:number) => void)|null} */ onUpgrade;
  /** @type {((slotId:number) => void)|null} */ onRepair;
  /** @type {(() => void)|null} */ onReady;
}
```

Renders into the `#overlay` node `index.html` already reserves (never
recreates it). `worldToMap`/`arenaGeometry`'s "+z world = down on screen"
convention needs no flip anywhere in this file — SVG's own y-axis already
increases downward, and `worldToMap` is a uniform scale. Does its own
affordability pre-check (shake + `ui-deny`) against its last-known energy
number before calling `onPlace`/`onUpgrade`/`onRepair` at all, purely for
snappy feedback tied to the tapped element — `buildPhase.js` re-checks
affordability itself before spending regardless, since the overlay's cached
energy can be up to 250ms stale (see `refresh`'s polling interval below).

`InputFrame.select`/`.ready` have no touch equivalent in P2/P3 (documented
on `InputFrame` above), so this file attaches its own `window` `keydown`
listener while `isOpen` (1/2/3 = select type, Space/Enter = Ready, Escape =
close the upgrade/repair sheet) rather than reading `InputFrame`.

### `installBuildPhase(game, { turrets, overlay, audio, hud, cfg })` (`src/game/buildPhase.js`)

The one call the orchestrator adds to wire P4 in, once `Turrets`/
`BuildOverlay` instances exist:

```js
const turrets = new Turrets(scene, assets, cfg, game.bus, game.world.effects, audio);
const overlay = new BuildOverlay(cfg, audio);
installBuildPhase(game, { turrets, overlay, audio, hud, cfg });
```

What it does: sets `game.world.turrets = turrets` (so `Enemies`'
targeting/damage and `Game#getSnapshot()` both see it — `Game.js` itself
never assigns this) and `game.registerSystem('turrets', turrets)`; opens the
overlay (`game.state.onEnter('build', ...)`) and closes it
(`game.state.onExit('build', ...)`, also clearing any wrecked turret's
record so its slot is free starting the *next* build phase — a destroyed
slot stays visible as a "grey X" for the rest of the build phase it died
into); mirrors `build:tick` into `overlay.setCountdown`; polls
`overlay.refresh(game.getSnapshot())` every 250ms while open, plus
immediately after every place/upgrade/repair/ready action; wires
`onPlace`/`onUpgrade`/`onRepair` into `Turrets` + `game.economy` (spend on
success, `ui-deny` on an unaffordable or otherwise-rejected attempt); wires
`onReady` to compute `game.economy.readyRefund(secondsLeft, cfg)`,
`addEnergy` it, toast it, and end the build phase via `game.state.go('wave')`
+ `game.bus.emit('state:changed', {state:'wave'})` — **the exact same two
calls `Game.js`'s own countdown-expiry path uses** — rather than duplicating
`Game`'s internal timer/refund bookkeeping, so a touch player tapping Ready
(no `InputFrame.ready` equivalent exists for touch) and a keyboard player's
Space/Enter both land in the same place with no double-refund risk (whichever
fires first flips `game.state` out of `'build'`, so the other path's own
`state === 'build'` guard — either `Game.js`'s or this file's — simply
no-ops).

**Known integration caveat:** `game.economy` is a live getter onto `Game`'s
own internal `Economy` instance (the same one `Game`'s HUD sync and its
own keyboard-Ready path already use), so as long as every P4 read goes
through `game.economy` — never a cached reference — this stays a single
shared source of truth with no further changes needed on P4's side. The
defensive `game.economy ??= new Economy(cfg)` in `installBuildPhase` exists
only for standalone use before that getter existed (or if a future refactor
ever removes it) and never overwrites a real instance.
