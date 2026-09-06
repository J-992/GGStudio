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

## P5 additions (P5 → orchestrator/P6/P7)

Everything below lives in `src/core/bossBrain.js`, `src/game/Boss.js`, and
`src/game/bossPhase.js`. Written against the `Enemies`/`Billboards`/`Turrets`
shapes documented above (`Enemies#spawn`, `Billboards#alloc/free/set`,
`Turrets#list/damage`) — this file's authors read those sections rather than
guessing at them.

### `core/bossBrain.js` (pure)

```js
class BossBrain {
  /** @param {import('./types.js').BossDef} def `cfg.bosses.patapim`.
   *  @param {import('./types.js').GameConfig} cfg */
  constructor(def, cfg) {}

  /** Resets every internal timer — call whenever a fresh boss instance is (re)spawned. */
  reset() {}

  /** @param {number} dt @param {import('./types.js').BossBrainCtx} ctx
   *  @returns {import('./types.js').BossBrainResult} */
  update(dt, ctx) {}

  /** @type {number} Seconds until the next melee attack is ready (0 = ready now). Debug/HUD use only. */
  attackCooldown;
  /** @type {number} Seconds until a new cast is eligible (0 = eligible now, pending the add cap). Debug/HUD use only. */
  castCooldown;
}
```

Priority every step: finish/continue an in-progress cast (blocks movement
and attacking; the add spawns exactly once, at 60% `castProgress`) > start a
new cast if the cadence timer (`def.addEveryS`, measured start-to-start —
**not** paused while casting, only while a cast is *not* in progress) has
elapsed and `ctx.addsAlive < def.maxAdds` > melee attack if
`ctx.target.dist <= def.range` and off `def.cooldown` > otherwise walk
toward the target (a normalised `moveDir`), or `action:'idle'` in the
degenerate case where the target is already exactly coincident with `self`.
`reset()` (not a plain `castCooldown = 0`) seeds a **full** `addEveryS`
interval so a freshly spawned boss walks in for a beat before its first
cast, rather than summoning an add the instant it spawns.

### `Boss` (`src/game/Boss.js`)

```js
class Boss {
  /** @param {import('three').Scene} scene Unused directly (renders entirely through `billboards`, like `Enemies`' `tungtung`) — kept for constructor-signature parity and a future 3D-model boss.
   *  @param {import('./assets.js').Assets} assets Unused directly today, same reason.
   *  @param {import('../core/types.js').GameConfig} cfg
   *  @param {import('../core/events.js').EventBus} bus
   *  @param {import('./Billboards.js').Billboards} billboards
   *  @param {import('./Effects.js').Effects} effects
   *  @param {import('../platform/audio.js').Audio} audio */
  constructor(scene, assets, cfg, bus, billboards, effects, audio) {}

  /** @param {number} gateId Arena gate id (0..2), already resolved from the wave's active-gate pair — same convention as `Enemies#spawn`. */
  spawn(gateId) {}

  /** @param {number} dt @param {object} world The `Game.world` bag. */
  update(dt, world) {}

  /** @param {number} n @param {string} source Free-form origin tag, matching `Enemies#damageAt`'s convention. */
  damage(n, source) {}

  /** Cylinder hit test (`def.radius`, `def.hitHeight`) — see "Player firing" below.
   *  @param {{x:number,y:number,z:number}} origin @param {{x:number,y:number,z:number}} dir Normalized. @param {number} maxDist
   *  @returns {{point:{x:number,y:number,z:number}, dist:number}|null} */
  hitTest(origin, dir, maxDist) {}

  /** `Enemies#positions()`-shaped, `idx` always `-1` (a sentinel, not a real `Enemies` pool index) — see "Turret targeting" below.
   *  @returns {{idx:number,x:number,y:number,z:number,radius:number}[]} */
  positions() {}

  /** Kills/hides the boss and resets every timer. Called on every fresh run (see "Reset on a fresh run" below). Does NOT unsubscribe from `bus` — the `enemy:killed` subscription is a singleton for this instance's whole lifetime, taken once in the constructor. */
  clear() {}

  /** @type {boolean} */ alive;
  /** @type {number} */ hp;
  /** @type {number} */ hpMax;
  /** @type {number} */ x;
  /** @type {number} */ z;
  /** @type {number} */ yaw; // cosmetic only — the billboard shader ignores yaw entirely (Y-axis-only camera facing); kept for a future 3D-model swap.
  /** @type {number} */ cooldown; // mirrors `brain.attackCooldown` after every `update()`.
  /** @type {number} */ addsAlive;
}
```

Rendering: one `Billboards` slot (`billboards.alloc(def.sprite, def.height)`,
freed on death/`clear()`), bob-while-walking via `core/spriteAnim.bob`, hit
flash via `core/spriteAnim.hitFlash` — same as `Enemies.js`'s `tungtung`
path. **Cast "raise" scale**: `Billboards#set`'s `anim` parameter only
carries a vertical offset plus an x/y squash pair (no separate uniform-scale
channel) — `Boss.js` multiplies both squash axes (`anim.sx`/`anim.sy`) by
`core/spriteAnim.castRaise(castProgress)` while casting, which scales the
whole quad uniformly since `Billboards.js`'s vertex shader already
multiplies width/height by `aAnim.y`/`aAnim.z` respectively. No Billboards.js
change was needed for this.

**Targeting**: nearest of {player, alive turrets} — `Boss.js` reimplements
the melee branch of `core/enemyBrain.chooseTarget` directly (a handful of
lines) rather than calling it, since that function's `typeDef` lookup keys
off `cfg.enemies.types[enemy.type]` and the boss's def lives in
`cfg.bosses` instead.

**Adds**: `Boss.js` tracks its own adds' `Enemies#spawn`-returned pool
indices in a `Set`, subscribed once (constructor) to `bus`'s `enemy:killed`
to decrement `addsAlive` when one of those indices dies — this is the only
way to know an add died, since `Enemies` has no "notify me when idx X dies"
API beyond the shared bus event every kill already emits. **Cap
interaction**: `Enemies#spawn` returns `-1` at `cfg.enemies.cap` (boss adds
share that one pool with every other enemy) — `Boss.js` only counts a spawn
toward `addsAlive` when the returned index is `>= 0`, so a saturated cap
never permanently blocks this boss's own cast cadence.

**Add spawn position — v1 compromise**: the plan brief's "spawn at the
boss's own feet" is not implemented literally. `Enemies#spawn(typeName,
gateId, hpMul)`'s frozen contract only ever positions a new enemy at a real
arena gate (with small cosmetic jitter) — it exposes no method to place or
teleport an enemy to an arbitrary world point. `Boss.js` instead spawns the
add at the boss's *nearest* gate. Fixing this properly would mean adding a
position-setter to `Enemies.js` (out of P5's owned-files list) — flagged
here for whichever package next touches `Enemies.js`.

**Player firing — v1 compromise (no `Game.js` edit)**: `Game.js`'s own
hitscan (`_handleFiring`) only tests `world.enemies.raycast(...)` — it has
no knowledge of the boss at all, and P5 may not edit `Game.js`.
`bossPhase.js` instead subscribes to the same `player:fired {origin, dir}`
bus event `Game.js` already emits after resolving its own shot, and
independently cylinder-hit-tests the boss over the full `gun.range`,
applying `gun.dmg` on a hit. Because `player:fired` fires *after* `Game.js`
has already resolved (and applied) its own enemy hit for that same shot,
this handler has no way to learn whether an enemy stood in front of the
boss and "used up" the shot first (that enemy may already be dead and
freed by the time this handler runs, so re-running `world.enemies.raycast`
here would silently see through it) — so a shot that kills an enemy
standing in front of the boss can also damage the boss behind it. This is
an accepted v1 compromise, not a bug to chase down under P5. **The better
fix, for whichever package next touches `Game.js`**: expose
`boss.hitTest(origin, dir, maxDist)` (already implemented, see above) and
have `Game.js#_handleFiring` call it alongside `world.enemies.raycast`,
comparing both hits' distances before applying either — this file's
`hitTest` is written exactly for that call site.

**Turret targeting**: `Boss.js` exposes `positions()` in the same shape as
`Enemies#positions()` (`idx` is always `-1`, a sentinel — not a real
`Enemies` pool index) so a future package can point `Turrets` at the boss.
Checked `Turrets.js`'s `update(dt, world)`: it only ever reads
`world.enemies?.positions()`, never `world.boss?.positions()` — so in v1
**turrets simply ignore the boss** (they never damage it, and it never
appears as a turret's target). No `Turrets.js` change was made or needed.

**Reset on a fresh run**: a previous run's boss can still be `alive` when a
new run begins — e.g. the player died mid-fight without killing it
(`Game.js`'s death path only checks the player's hp, never the boss's).
`bossPhase.js` calls `boss.clear()` exactly on the `title -> build` and
`runEnd -> build` edges (the state machine's two "start a fresh run"
transitions), detected via `game.state.onExit('title'|'runEnd', ...)` +
`game.state.onEnter('build', ...)` (`GameStateMachine#go` fires the
outgoing exit hook immediately before the incoming enter hook — see
`core/stateMachine.js`) rather than by inspecting any bus event payload.
Like every other registered system, `boss.update(dt, world)` still runs
every fixed step regardless of the top-level game state (it early-returns
on `!alive`) — this matches `Enemies.js`'s own pre-existing behaviour (its
`update()` isn't state-gated either; only `Game.js`'s spawn *scheduler* is
gated to `state === 'wave'`), so a boss left alive across the brief
death→runEnd→title window can keep acting for a few seconds (harmlessly:
`Player#takeDamage` already no-ops while the player is dead) until the next
`build` entry clears it. Not treated as a P5-introduced regression since
`Enemies` already has the identical characteristic.

### Bus events (`game.bus`, `core/events.js`)

In addition to P2/P3's tables:

| Event | Payload | Emitted when |
| --- | --- | --- |
| `enemy:killed` | `{ idx:-1, type:'patapim', boss:true, x, z, source, energy, coins }` | The boss's hp reaches 0 via `Boss#damage`. Deliberately the **same event name** `Enemies` uses (`idx:-1` and `boss:true` mark it as not a real `Enemies` pool slot) — `Game.js`'s existing generic listener (`this._economy.addEnergy(e.energy)`) applies unmodified with no `Game.js` change; P6's combo/coin system should key off `e.boss`/`e.coins` on this same event rather than a new one. |

`Boss.js` does not itself emit `enemy:spawned`/`wave:started`/`wave:cleared`
— those stay exactly as P2/P3 defined them; `wave:started`'s pre-existing
`boss` field (the wave def's `boss` string or `null`) is what
`bossPhase.js` reads to decide whether to spawn.

### `installBoss(game, { boss, hud, audio, cfg })` (`src/game/bossPhase.js`)

The one call the orchestrator adds to wire P5 in, once a `Boss` instance
exists (mirrors P4's `installBuildPhase` pattern). `src/main.js` (P6-owned —
not edited by this package) already carries a `// P5: boss install goes
here` marker comment at the exact spot; the two imports plus this snippet
(using `main.js`'s own local variable names — `CONFIG`, `game`, `scene`,
`assets`, `audio`, `hud`) are what go there:

```js
import { Boss } from './game/Boss.js';
import { installBoss } from './game/bossPhase.js';
// …
const boss = new Boss(scene, assets, CONFIG, game.bus, game.world.billboards, game.world.effects, audio);
installBoss(game, { boss, hud, audio, cfg: CONFIG });
```

What it does: sets `game.world.boss = boss` (so `Game.js`'s own
`!world.boss?.alive` wave-clear check and `Game#getSnapshot()` both see it —
`Game.js` itself never assigns this, same pattern as `world.turrets`) and
`game.registerSystem('boss', boss)`; registers a second tiny system
(`'bossHud'`) that calls `hud.setBossHp(boss.alive ? boss.hp/boss.hpMax :
null)` every fixed step (not a bus listener — there's no per-step "boss hp
changed" event, and this must also fire the exact step hp reaches 0); on
`wave:started` with a non-null `boss` name, spawns the boss at
`game.activeGates[0]` and plays `boss-alert`; resets the boss on a fresh run
(see above); and subscribes to `player:fired` to hit-test/damage the boss
(see the "Player firing" compromise above).

**Known integration caveat**, matching P4's `installBuildPhase` pattern: the
`+1` `Billboards` pool slot `Game.js`'s constructor already reserves
(`config.enemies.cap + 1`) is exactly what `Boss#spawn`'s single
`billboards.alloc` call consumes — no `Billboards.js` change was needed
either.

**Orchestration note (done by P6):** the `// P5: boss install` two-line
snippet above has been pasted into `src/main.js` verbatim (P6 owns
`main.js` and P5's own doc explicitly handed the snippet to "whichever
package wires it in" — leaving it unwired would have meant wave 5 never
spawns a boss at all, which would have made P6's own boss-coin/energy path
in `Game.js`'s `enemy:killed` handler untestable). No other P5 file was
touched.

## P6 additions (P6 → P7)

Everything below lives in `src/game/Game.js`, `src/main.js`,
`src/platform/storage.js`, `src/ui/{Screens,Hud}.js`, and
`src/core/{combo,runFlow}.js`. Replaces P3's placeholder "toast + 3s +
return to title" for `death`/`runEnd` (see the old note under "P3
additions" → "State machine note" — still accurate for the
`waveClear -> runEnd` state-machine edge itself, just not for what happens
once `runEnd` is entered) with the real combo/coin/save/screen flow.

### `Game` additions

```js
class Game {
  /** @param {object} deps ...as before, plus:
   *  @param {import('../ui/Screens.js').Screens} deps.screens */
  constructor(deps) {}

  /** @returns {import('../core/combo.js').ComboTracker} Read-only from outside — only `Game` replaces the instance, on a fresh run. */
  get combo() {}

  /** @returns {import('../core/types.js').SaveData} Read-only from outside — only `Game` persists (via `core/storage.js#saveSave`) and reassigns this. */
  get save() {}

  /**
   * P7's seam into every ad-gated decision and the two Poki lifecycle call
   * points this package couldn't itself make real. Mutable — P7 replaces
   * these functions wholesale (not by wrapping them); the defaults below
   * make the entire death/run-end/title flow fully playable with no ads at
   * all.
   * @type {{
   *   requestRevive: () => Promise<boolean>,   // default: async () => false
   *   requestDoubler: () => Promise<boolean>,  // default: async () => false
   *   onRunStart: (() => void) | null,          // default: null. Called synchronously at the very top of every fresh-run start (title's Play, run-end's Play Again, and the `?wave=N` dev shortcut) — this is where P7's `commercialBreak()` + `gameplayStart()` pairing goes.
   *   onRunStop: (() => void) | null,           // default: null. Called synchronously the instant gameplay stops for good this run — entering `death`, or a clean clear of `run.finalWave` — pairs with Poki's `gameplayStop()`. Never called twice for the same run-ending event.
   * }}
   */
  hooks;
}
```

`_startRun()` (title's Play, run-end's Play Again, `?wave=N`) now, in order:
calls `hooks.onRunStart?.()`, `screens.hide()`, `hud.show(true)`, resets
`economy`/`combo` (fresh instances) and `_reviveUsed`/wave/scheduler, then
proceeds exactly as before (`state.go('build')`, `pickGates`, etc.).

### Combo → coins wiring

`Game`'s constructor's existing `enemy:killed` listener (previously just
`economy.addEnergy(e.energy)`) now also calls `combo.onKill(world.time)` on
every kill (boss kills included — a boss kill counts toward whatever streak
is in progress) and, only when `e.boss` is true, `economy.addCoins(e.coins)`
— this is a *separate* coin source from the combo payout below, not a
double-count of the same coins (see P5's `enemy:killed` payload shape
above: `energy` is on every kill's payload and was already being added
unconditionally before this package touched anything; `coins` only exists
on a boss kill's payload).

Every fixed step (`_updateCombo`, called from `_fixedStep` after
`_checkPlayerDamageAndDeath`): polls `combo.update(world.time)` — **using
the fixed-step game clock, never wall time** (`combo.js`'s own contract).
When a streak just ended with `coins > 0`: `economy.addCoins(coins)`,
`hud.toast('COMBO x{kills} +{coins}')`, and the `coin` sound. Every step
regardless: `hud.setCombo(result.kills, combo.remaining(world.time))` — see
`Hud` additions below for what that now renders. A combo whose window
happens to still be open when a wave is banked pays out later, into
whatever wave is current by then (correct, not a bug — see the P6 report's
"adversarial re-read" notes for the full trace).

### Coin/save timing

- `waveClear` (`_onWaveClear`, both the loop-back and the final-wave/victory
  chain into `runEnd`): `economy.bankWave()` (pending → banked), then
  `save = saveSave(io, { bestWave: bestWaveAfter(save.bestWave, wave) })`.
- `death` (`_checkPlayerDamageAndDeath`, already wired by P3):
  `economy.discardPending()` — unchanged, still fires before this
  package's death-screen flow begins.
- `runEnd` (`_runRunEndFlow`): `earned` starts as `economy.bankedCoins`
  (final — never touched by discard, and banked wave-by-wave regardless of
  any ad) and is persisted via `save = saveSave(io, { coins:
  coinsForRun(save.coins, earned) })` once the screen loop below concludes.
  **Coins never depend on an ad**: the doubler can only ever increase
  `earned` before that one `saveSave` call, never gate whether the base
  amount is saved at all.

### `core/runFlow.js` (pure)

```js
/** @returns {number} `coins`, doubled when `doubled` is true. */
function applyDoubler(coins, doubled) {}

/** @returns {number} `savedCoins + earnedCoins` — clamping to `cfg.save.maxCoins` is `core/storage.js#sanitize`'s job, not this function's. */
function coinsForRun(savedCoins, earnedCoins) {}

/** @returns {number} `Math.max(prevBestWave, wave)`. */
function bestWaveAfter(prevBestWave, wave) {}
```

### `core/combo.js` addition

```js
/** Pure, stateless version of `ComboTracker#tierFor` (which now delegates to
 *  this) — importable without constructing a tracker, so `ui/Hud.js` can
 *  show "coins this tier would pay" from a live kill count.
 *  @returns {number} */
function tierFor(kills, cfg) {}
```

### Death / revive flow

`death`'s existing entry (P3, unchanged: `economy.discardPending()`,
`deathTimer = timing.deathScreenDelayS`) now also calls
`hooks.onRunStop?.()` right there — gameplay has stopped for the run at
that exact instant, matching the state-machine doc's `wave -> death:
gameplayStop()` bullet. Once `deathTimer` elapses (`_runDeathFlow`, guarded
by `_awaitingDeathDecision` so the still-ticking fixed-step loop never
starts a second one while this `await`s):

1. `hud.show(false)`; `canRevive = !(cfg.run.reviveOncePerRun &&
   _reviveUsed)`.
2. `await screens.showDeath({ wave, canRevive })` → `'revive'|'end'`.
3. If `'revive'` and `canRevive`: `await hooks.requestRevive()`. If
   granted: `_reviveUsed = true`, `_doRevive()` (below), stay in `death`'s
   caller no further — the wave resumes.
4. Otherwise (declined, `!canRevive`, or the ad wasn't granted):
   `state.go('runEnd')` + `state:changed`, then `_runRunEndFlow(false)`.

`_doRevive()`: **first** `screens.hide()` (the one outcome with no
follow-up screen to lean on for cleanup — every other outcome's next
`_open()` call removes the previous screen for free, this one doesn't),
then full hp, `alive = true`, `invulnUntil = world.time +
invulnAfterReviveS`, `_pushEnemiesFromPlayer()` (below), `hud.show(true)`,
`state.go('wave')`.

**Deviation — "push enemies away" is a stun, not a reposition.** The plan
brief calls for pushing nearby enemies outward on revive. `Enemies.js`'s
frozen public contract (P3's "P3 additions" section above) exposes exactly
one per-enemy mutator besides damage: `applySlow(idx, factor, durS)` — no
`setPosition`/knockback of any kind, and P6 is not in a position to add one
(out of this package's owned-files list, same reasoning P5 gave for not
adding an add-spawn-position setter). `_pushEnemiesFromPlayer` instead
calls `world.enemies.positions()`, finds every entry within
`revivePushRadius` of the player, and `applySlow(idx, 0.05,
invulnAfterReviveS)`s each one — a near-stun for exactly the same window
the player is invulnerable for. Enemies don't visually leap backward, but
the player gets equivalent practical breathing room. Flagged here for
whichever package next touches `Enemies.js`, same spirit as P5's add-spawn
flag above.

### Run-end flow

`_runRunEndFlow(victory)` (entered from `_onWaveClear`'s final-wave chain,
or `_runDeathFlow`'s decline path — both already call `state.go('runEnd')`
+ `state:changed` before invoking this): `hud.show(false)`; loops on
`await screens.showRunEnd({ wave, victory, coinsEarned: earned, coinsTotal:
save.coins + earned, canDouble })` — `canDouble` starts `true` and flips to
`false` the moment `'double'` is picked once (win or decline; one offer per
run-end) — until the result isn't `'double'`. A `'double'` result:
`await hooks.requestDoubler()`, and if granted, `earned =
applyDoubler(earned, true)`, then loops back (re-showing the screen with
the updated total and the doubler button now hidden). Once the loop exits
with `'again'`/`'title'`: persists coins (see "Coin/save timing" above),
then `'again'` → `_startRun()`; `'title'` → `state.go('title')` +
`state:changed` + `_showTitleScreen()`.

### `ui/Screens.js`

```js
class Screens {
  /** @param {import('../core/types.js').GameConfig} cfg @param {import('../ui/input.js').Input} input @param {import('../platform/audio.js').Audio} audio */
  constructor(cfg, input, audio) {}

  /** @type {boolean} True while a screen is mounted. */
  isOpen;

  /** Removes any mounted screen and restores input + pointer-lock state. Idempotent. */
  hide() {}

  /** Callback style (stays up indefinitely until the player acts — no Promise to await). @param {{bestWave:number, coins:number, credits:string, onPlay:() => void}} opts */
  showTitle(opts) {}

  /** @param {{wave:number, canRevive:boolean}} opts @returns {Promise<'revive'|'end'>} */
  showDeath(opts) {}

  /** @param {{wave:number, victory:boolean, coinsEarned:number, coinsTotal:number, canDouble:boolean}} opts @returns {Promise<'double'|'again'|'title'>} */
  showRunEnd(opts) {}
}
```

Every `show*` call freezes input (`input.freeze(true)`) and releases
pointer lock (`document.exitPointerLock()` if currently locked) for as long
as the screen is up; `hide()` reverses both and removes the mounted DOM
node. `showDeath`/`showRunEnd`'s buttons are disabled (not removed) the
instant a choice is made, so a `'double'`-then-ad round trip can't be
double-fired while `Game.js` awaits the ad hook — the next `show*` call's
own `hide()` (via its `_open()`) is what actually clears that disabled DOM.
All three screens render into `#ui` (mobile-first, `Lilita One`, buttons
≥48px tall — see the `/* P6 screens */` block in `style.css`); every button
is reachable by click/tap and by keyboard (title: Space/Enter/click-
anywhere; death: Enter/Space picks revive-if-offered-else-end, Escape ends;
run-end: Enter/Space picks "again", Escape picks "title"). `showTitle`'s
portraits come from `assetUrl('assets/sprites/portrait-<name>.webp')` for
the four names actually shipped in `manifest.json`'s `sprites.portraits`
(`patapim`, `tungtung`, `bombardiro`, `tralalero`).

`Game.resume()` (the `visibilitychange` pause/resume pair, unrelated to any
screen) now checks `!screens.isOpen` before unfreezing input, so a
backgrounded-then-restored tab never fights a currently-open screen's own
freeze — `screens.hide()` remains the only thing that actually unfreezes
once a screen's outcome has been acted on.

## P7 additions (final)

Everything below lives in `src/core/adGuard.js`, `src/platform/poki.js`,
`src/main.js`, `src/game/{Game,Turrets,bossPhase}.js`, `src/ui/{Screens,
Hud}.js`, and `src/platform/storage.js`.

### `core/adGuard.js` (pure)

```js
class AdGuard {
  get started() {}     // bool: gameplayStart fired without a matching stop.
  get adPlaying() {}    // bool.
  canStart() {}         // bool: legal to call gameplayStart right now.
  canStop() {}          // bool: would gameplayStop actually do anything right now.
  start() {}            // bool: whether this call actually transitioned stopped -> started.
  stop() {}             // bool: whether this call actually transitioned started -> stopped.
  beginAd() {}          // bool `wasStarted`: unconditionally sets started=false, adPlaying=true.
  endAd() {}            // adPlaying=false. Does NOT resume gameplay itself.
}

/** Resolves with `factory()`'s result, or `fallback` if `ms` elapses first — a hung ad promise can never freeze the caller. */
function withWatchdog(factory, ms, fallback) {}
```

This is the single source of truth `platform/poki.js` drives every real SDK
call from — no sequencing logic is duplicated there. `test/adGuard.test.js`
asserts the four invariants the P7 brief called out by name: `start()`/
`stop()` are idempotent, `beginAd()` always reports and forces `started`
false regardless of prior state, `canStart()` refuses for as long as an ad
plays, and `withWatchdog` releases with the fallback on a promise that never
settles (as well as on a synchronous throw or a rejection).

### `platform/poki.js`

```js
class Platform {
  constructor(cfg) {}
  get hasAds() {}                    // ACTIVE && cfg.platform.adsEnabled.
  onAdState(fn) {}                   // fn('playing'|'none'); returns an unsubscribe.
  async init() {}                    // never rejects.
  gameLoadingStart() {}              // safe to call before init() resolves.
  loadingFinished() {}
  gameplayStart() {}                 // no-op during an ad or if already started.
  gameplayStop() {}                  // idempotent.
  async commercialBreak() {}         // Promise<void>.
  async rewardedBreak() {}           // Promise<boolean>, true only on a genuine SDK `true`.
}
```

The only module allowed to touch `window.PokiSDK` (unchanged rule from
`AGENTS.md`). `HAS_POKI` (`typeof __POKI__ !== 'undefined' && __POKI__` —
`__POKI__` is `vite.config.js`'s build-time `define`, true only for
`vite build --mode poki`) and `IS_DEV` (`import.meta.env.DEV`, true only
under the Vite dev server, false for *any* `vite build`) combine into
`ACTIVE = HAS_POKI || IS_DEV`. Every SDK-touching branch in this file is
gated behind `ACTIVE`/`HAS_POKI`, both statically known at build time, so in
the plain `vite build` (the one distribution where neither is true) the
whole body folds to dead code and is stripped by minification — this is
what makes `grep -c PokiSDK dist/assets/*.js` read `0` after `npm run build`
and `>0` after `npm run build:poki` (see the README's verify list). `IS_DEV`
specifically (not `HAS_POKI` alone) is what lets `?poki=mock` work under
`npm run dev`, where `__POKI__` is false (no `--mode poki` there).

`?poki=mock` installs a mock SDK (idempotent — a module-level side effect
that runs once, the first time this file is imported, gated behind `ACTIVE`
and the query param) recording every call into `window.__POKI_EVENTS__`:
`init`, `gameLoadingStart`, `gameLoadingFinished`, `gameplayStart`,
`gameplayStop`, `commercialBreak`, `rewardedBreak:true|false`. The mock ad
"plays" for 2 s (both `commercialBreak` and `rewardedBreak`); `?poki=mock&
reward=0` makes every `rewardedBreak` resolve `false`.

**The central invariant**: `commercialBreak()`/`rewardedBreak()` both call
`AdGuard#beginAd()` before ever touching the SDK — architecturally, no call
site anywhere is responsible for stopping gameplay before requesting an ad,
the wrapper always does it. The real SDK's `gameplayStop()` is only actually
invoked when `beginAd()` reports gameplay genuinely was running
(`wasStarted`) — every real call site in this game already stops gameplay
before ever reaching an ad (see below), so in normal play this is a
defensive no-op that only fires if some future call site ever raced ahead of
that. Both break methods are watchdog-guarded at 60 s (`AD_WATCHDOG_MS`),
notify `onAdState('playing')` before the SDK call and `onAdState('none')`
after (in a `finally`, so a rejected/hung promise still releases the
listeners), and every SDK call is wrapped in try/catch.

### `Game` additions

```js
class Game {
  /** @param {object} deps ...as before, plus:
   *  @param {Partial<Game['hooks']>} [deps.hooks] Real hook implementations, applied over the no-ads defaults BEFORE this constructor's own `?wave=N`/title dispatch runs. */
  constructor(deps) {}

  /** Toggles the manual pause (Escape / the touch HUD's pause button). No-op with a screen open, mid-ad, or outside build/wave. */
  togglePause() {}

  /** @type {{ ...as before, onPause: (() => void)|null, onResume: (() => void)|null }} */
  hooks;
}
```

`hooks` gained `onPause`/`onResume` (both default `null`), called
synchronously by the new manual-pause toggle — mirrors `onRunStart`/
`onRunStop`'s existing seam rather than introducing a different pattern.
`hooks` is now also accepted as a constructor param (`deps.hooks`, merged
over the defaults via `{...defaults, ...hooks}`) instead of only being
assignable after construction — the `?wave=N` dev shortcut can call
`hooks.onRunStart` synchronously from inside the constructor itself (before
`main.js` would otherwise get a chance to assign `game.hooks.onRunStart =
...` on the returned instance), so the real implementation has to already be
in place by then.

**Manual pause**: a `window` `keydown` listener for `Escape` (deliberately
NOT routed through `InputFrame.pause` — see the code comment on
`_onEscapeKey` for why: `Input.frame()` zeroes every field, `pause` included,
while input is frozen, which `pause()` itself does, so the fixed-step loop
could never observe an "unpause" key through the normal frame pipeline once
paused — mirrors `ui/Screens.js`'s own pattern of a dedicated raw listener).
Toggling calls `pause()`/`resume()` (reusing their existing input-freeze/
audio-suspend/`screens.isOpen`-guard behaviour) plus `hud.setPaused(bool)`
and `hooks.onPause`/`onResume`. Guarded so it only engages during `build`/
`wave` and never while a screen is open. `visibilitychange`'s own
`resume()` call now also checks `!this._manualPaused` first, so a
backgrounded-then-restored tab can't silently cancel a pause the player set
before backgrounding.

**Boss hitscan fix**: `_handleFiring` now tests `world.boss?.hitTest(...)`
alongside `world.enemies.raycast(...)` and damages only the **nearer** of
the two hits (comparing `.dist`) — replacing P5's documented v1 compromise
(a second, independent `player:fired` listener in `bossPhase.js` that could
double-hit both an enemy and the boss standing behind it on the same shot).
`bossPhase.js` no longer listens to `player:fired` at all.

### `Turrets` additions

`update(dt, world)` now concatenates `world.boss?.positions() ?? []` onto
`world.enemies.positions()` as one more candidate list whenever the boss is
alive (its sentinel `idx:-1` — see P5's "Turret targeting" note — was always
shaped for exactly this). `_fire` resolves `idx === -1` back to
`world.boss.damage(stats.dmg, 'turret')` for every turret type instead of
`Enemies#damageAt`; cannon splash becomes a direct hit against the boss (no
radius query — the boss isn't a position in `Enemies`' pool to splash
around), and tesla's slow effect simply doesn't apply to the boss (no
speed-multiplier hook exists on `Boss`, unlike `Enemies#applySlow`).

### `ui/Screens.js` additions

```js
class Screens {
  constructor(cfg, input, audio, platform = { hasAds: true }) {}
}
```

`showDeath`/`showRunEnd` now hide the Revive/Double Coins button — and treat
Enter/Space as if it were never offered — whenever `!platform.hasAds`, on
top of the existing `canRevive`/`canDouble` checks. The default parameter
(`{ hasAds: true }`) keeps any caller that doesn't pass one behaving exactly
as before P7.

### `ui/Hud.js` additions

```js
class Hud {
  setPaused(paused) {}     // shows/hides a centred "PAUSED" panel over the (still-visible) HUD.
  onPauseTap(fn) {}        // touch-only pause button (hidden via CSS under body.keyboard).
  onMuteTap(fn) {}         // fn(newMutedState) — caller applies it (audio.setMuted, storage).
  setMuted(muted) {}       // visual-only; does not fire onMuteTap's callback.
}
```

Both buttons are appended directly to `#ui` (a `.hud-controls` div, sibling
of `.hud`/`.touch-layer`) rather than nested inside `.hud` — `.touch-layer`'s
`.touch-zone--move`/`--look` children cover the *entire* left/right halves
of the screen at their own z-index, scoped within `.touch-layer`'s own
(higher) stacking context; a z-index set on a `.hud` descendant is capped
inside `.hud`'s own (lower) stacking context and could never win that
comparison no matter how high it were set. Only a sibling of `.touch-layer`
at the shared `#ui` parent level, given its own higher z-index, actually
receives taps over that area.

### `platform/storage.js` additions

```js
function loadMuted() {}      // @returns {boolean} — false if never set or storage unavailable.
function saveMuted(muted) {} // @param {boolean} muted
```

Persisted under its own key (`arenadefense.muted`), deliberately NOT part of
`core/storage.js`'s `{coins, bestWave, unlocks}` save shape (that set is
test-enforced) — mute is a device/session preference, not run progress.

### Wiring (`src/main.js`)

```
game.hooks.onRunStart = () => platform.commercialBreak().then(() => platform.gameplayStart());
game.hooks.onRunStop  = () => platform.gameplayStop();
game.hooks.requestRevive = async () => {
  const granted = await platform.rewardedBreak();
  if (granted) platform.gameplayStart();   // the one rewardedBreak that DOES resume gameplay.
  return granted;
};
game.hooks.requestDoubler = () => platform.rewardedBreak();   // never restarts gameplay.
game.hooks.onPause  = () => platform.gameplayStop();
game.hooks.onResume = () => { if (state is build/wave) platform.gameplayStart(); };
platform.onAdState((state) => {
  if (state === 'playing') game.pause();
  else { game.resume(); if (state is build/wave) platform.gameplayStart(); }
});
```

`requestRevive` is deliberately NOT a bare `() => platform.rewardedBreak()`
passthrough (unlike `requestDoubler`, which is): at the instant
`onAdState('none')` fires inside `rewardedBreak()`, the game is still in
`death` (state only flips to `wave` a tick later, in `Game.js#_doRevive`,
once `_runDeathFlow`'s `await hooks.requestRevive()` actually returns) — so
the generic `onAdState`-driven `gameplayStart` re-issue can never catch the
revive case. Chaining it explicitly here is both simpler and matches the
state-machine doc's `death -> wave: rewardedBreak() true: gameplayStart()`
bullet directly. Every other combination (`onRunStart`'s own `.then()`, the
generic `onAdState('none')` re-issue) can safely overlap with this without
producing a duplicate real SDK call — `AdGuard#start()` is idempotent.

Full mock event order for one revive-then-death run: `gameLoadingStart` /
`init` (order not significant) → `gameLoadingFinished` → `commercialBreak` →
`gameplayStart` → *(wave play)* → `gameplayStop` → `rewardedBreak:true` →
`gameplayStart` → *(wave play)* → `gameplayStop`. Traced end-to-end against
this exact implementation in the P7 report's adversarial re-read.

### `platform/storage.js`

```js
/** @type {import('../core/types.js').SaveIO} */
const storageIO = { get(key) {}, set(key, value) {} };
```

`localStorage`-backed, with a write-probe (`setItem`+`removeItem` a scratch
key) before every access and an in-memory `Map` fallback latched on for the
rest of the session the first time a real write throws (Safari private
mode, quota exceeded, a cross-origin iframe policy) — ports the `raw()`
idea from `ninja-flow/src/core/Storage.ts`. Every `set()` updates the
in-memory copy first regardless of whether the real write below it
succeeds, so a save made mid-session is never lost even if `localStorage`
itself has already gone bad. `key` is whatever `core/storage.js#loadSave`/
`saveSave` pass through (`CONFIG.save.key`) — this file never parses or
sanitizes, that stays `core/storage.js`'s job.

### `Hud` additions

```js
class Hud {
  /** @param {number} coins Running total for the current run (`economy.bankedCoins + economy.pendingCoins`) — synced every fixed step by `Game#_syncHud`, same as `setHp`/`setEnergy`. */
  setCoins(coins) {}
}
```

`setCombo(kills, fraction)`'s existing signature is unchanged, but its
text now also shows the coins the current tier would pay
(`x{kills} +{coins}` via `core/combo.js`'s new standalone `tierFor`, or
just `x{kills}` below the first tier) — still hidden while `kills <= 0`.

### Removed

The `title-panel*`/`placeholder-title` CSS (P2's placeholder title, now
`ui/Screens.js`'s `showTitle`) and `src/main.js`'s `installTitlePanel`
function are gone. `Game.js`'s old `RUN_END_DISPLAY_S`-timed
toast-and-return-to-title for `death`/`waveClear -> runEnd` is replaced by
the flow above; nothing on the frozen P2/P3/P4 API list (`registerSystem`,
`world` shape, `getSnapshot`, state enter/exit hooks, `game.economy`) was
removed or reshaped — `game.combo`/`game.save`/`game.hooks` and the
`screens` constructor dependency are additive.
