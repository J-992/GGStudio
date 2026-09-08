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
 * @property {boolean} fire      Level-triggered: true every frame the fire input is held (keyboard: left mouse button down; touch, since "P8 additions": the dedicated `.touch-fire` button in `ui/TouchControls.js`, held). Stale as of P8: this used to read "touch: always false — Game decides auto-fire from `player.aimTarget`" — `Game#_handleFiring` now gates firing on this field alone for both modes, and `player.aimTarget` only decides touch aim-assist (bending a held shot onto a nearby enemy) and the reticle color, never whether to fire at all. See "P8 additions" below.
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
eyeHeight, gun, weaponId`. Stale as of P8: `gun` used to be "a reference to
`config.player.gun`" — that single frozen weapon shape is gone. `gun` is now
the *equipped* weapon's def, `config.player.weapons.types[weaponId]`, swapped
at runtime with `setWeapon(id)` below — see "P8 additions" for the roster
shape.

Yaw/pitch convention: yaw `0` looks toward `-z` (matching
`core/arenaGeometry`'s "gate angle 0 = north/-z"), increasing clockwise.
Pitch is positive looking up, clamped to `±pitchLimitDeg`. Camera uses Euler
order `'YXZ'`, `rotation.y = -yaw`, `rotation.x = pitch`.

**Recoil is a rendering offset, not aim.** `update()` writes
`rotation.x = clamp(pitch + kick * camPitchDeg)` where `kick` is the
`core/recoil.js` spring value; `this.pitch`/`this.yaw` themselves are never
written by recoil, so the punch fully self-recovers and nothing outside
`Player` should try to compensate for it. Because the rendered camera
carries that offset, `fire()` and `aimTarget()` derive their direction from
`yaw`/`pitch` analytically (`_aimDirection`) instead of reading
`camera.getWorldDirection()` — otherwise every shot after the first in a
burst would drift high and the effective `coneDegTouch` for touch auto-fire
would shrink. The shot origin still comes from `camera.getWorldPosition()`,
which the kick does not touch (it offsets rotation only). Net contract: the
gun and the view kick, but a shot always goes exactly where the player is
aiming.

**Clock**: `invulnUntil` and `fire()`'s cooldown compare against the
player's own fixed-step clock (`_time`, accumulated one `dt` per
`update()` call). This is numerically identical to `Game`'s `world.time`
from frame 0 onward (both start at 0 and advance by the same `dt` every
step) — so `player.invulnUntil = world.time + seconds` is exactly correct
for a future revive system to grant invulnerability.

```js
class Player {
  /**
   * Points the player at a different weapon and rebuilds the viewmodel.
   * Added in P8 — see "P8 additions" for the full roster/rendering story.
   * @param {string} id
   * @returns {string} The id actually equipped — `coerceWeaponId(id, cfg)`,
   *   so an unknown/stale id falls back to `config.player.defaultWeapon`
   *   rather than throwing.
   */
  setWeapon(id) {}

  /** @param {number} dt @param {InputFrame} frame */
  update(dt, frame) {}

  /** @returns {{origin: THREE.Vector3, dir: THREE.Vector3} | null} `null` while on `gun.rate` cooldown or dead. */
  fire() {}

  /** @param {number} n Ignored while dead or `world.time < invulnUntil`. */
  takeDamage(n) {}

  /** Resets position/orientation/health for a new run (camera/viewmodel objects persist), and returns the recoil spring to exact rest — value *and* velocity, so no leftover kick bleeds into the first frame. */
  reset() {}

  /**
   * Nearest candidate within `gun.coneDegTouch` of the current view
   * direction, or -1. Stale as of P8: this used to read "Used by touch
   * auto-fire" — touch now fires from its own button (`InputFrame.fire`,
   * above), and this method's only remaining job is touch aim-assist
   * (bending a held shot onto the return value) plus the reticle color; see
   * "P8 additions". P3 passes `world.enemies.targets()`. `candidate.radius`
   * is accepted for a future radius-aware test but unused in v1.
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
   *   projectiles: null | object,  // Projectiles (P8); never null in practice, same as billboards — see "P8 additions".
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
   * @param {{x:number,z:number}} [dir] Hit-reaction push direction (need not be
   *   normalized) — the bullet's direction, or turret→enemy. Omitted or zero
   *   shoves the enemy straight backwards from its own facing.
   * @returns {boolean} Whether this hit killed the enemy.
   */
  damageAt(idx, dmg, source, dir) {}

  /** Splash damage; returns the number of kills it caused. Each body is thrown radially outwards from `(x, z)`. @returns {number} */
  damageRadius(x, z, r, dmg, source) {}

  /**
   * Damage-free hit reaction — the revive push uses it. See "Hit reaction
   * (knockback)" below.
   * @param {number} idx
   * @param {{x:number,z:number}} dir Radial push direction; zero shoves the enemy backwards from its own facing.
   * @param {number} speed Impulse in m/s, scaled by the type's `knockbackScale`.
   */
  knockback(idx, dir, speed) {}

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
   * @param {Set<number>|null} [skip] Added in P8: pool indices to ignore —
   *   how a piercing weapon walks past enemies it has already hit on this
   *   shot. `null`/omitted (every pre-P8 call site) behaves exactly as
   *   before. See "P8 additions".
   * @returns {{idx:number, point:{x:number,y:number,z:number}, dist:number}|null}
   */
  raycast(origin, dir, maxDist, skip = null) {}

  /** @returns {{x:number,y:number,z:number,radius:number}[]} Centred at half `hitHeight` — feeds `player.aimTarget`, which as of P8 uses this for touch aim-assist rather than deciding whether to fire (see "P8 additions"). */
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
`damageAt(hit.idx, gun.dmg, 'player', { x: shot.dir.x, z: shot.dir.z })`, a
tracer to the hit point (instead of the max-range point), and a small
`effects.burst` at the hit point.

## Hit reaction (knockback)

Every hit on a pool enemy shoves its body: `damageAt`'s optional `dir` is
turned into a knockback velocity (`core/enemyBrain.knockbackSpeed`, scaled by
damage and the type's `knockbackScale`, capped and stackable) held in
`Enemies`' `_kickVX/_kickVZ` arrays. Per fixed step that velocity is added to
the enemy's own steering, which is itself damped by
`staggerFactor` while the kick lasts, then decayed by `decayKnockback` (it
snaps to zero below `stopSpeed`, so a hit never leaves a permanent drift).
Every tunable lives in `cfg.enemies.knockback`.

The same impulse drives the visuals, via
`knockbackIntensity` (0..1): voxel enemies tilt `knockbackTilt` radians about
the world axis perpendicular to the push (pre-multiplied onto the yaw/walk
rotation, pivoting at the feet) and play `spriteAnim.hitSquash`; sprite
enemies, which carry no rotation, play the knockback slide plus that squash
on top of their walk `bob`, alongside the pre-existing `hitFlash`. Direction
per source: the player's bullet direction, turret→enemy for gun/tesla, and
radially outwards from the blast centre for cannon splash. The boss has no
knockback — it keeps its `hitFlash` only.

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
   *   onRunStop: (() => void) | null,           // default: null. Called synchronously the instant gameplay stops for good this run — entering `death`, or a clean clear of `run.finalWave` — pairs with Poki's `gameplayStop()`. Never called twice for the same run-ending event. Stale as of P8: a third trigger exists now — quitting to title from the pause menu also calls this, right before `state.go('runEnd')`; see "P8 additions".
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

**"Push enemies away" is a real shove plus a stun.** The plan brief calls
for pushing nearby enemies outward on revive. This was originally a stun
only — `Enemies.js` exposed no positional mutator besides damage — and is
now both, since the hit-reaction work added one:
`_pushEnemiesFromPlayer` calls `world.enemies.positions()`, and for every
entry within `revivePushRadius` of the player fires
`knockback(idx, {x: dx, z: dz}, player.revivePushSpeed)` (radially outwards
— bodies lean and stagger back exactly as they do off a bullet) followed by
`applySlow(idx, 0.05, invulnAfterReviveS)`, a near-stun for exactly the same
window the player is invulnerable for.

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

  /**
   * Stale as of P8: renamed to `showMenu` and given two more buttons/callbacks
   * — see "P8 additions" for the current shape. Left here, struck through in
   * spirit, only so a reader following an old reference to `showTitle` lands
   * on an explanation instead of a dead end.
   *
   * Callback style (stays up indefinitely until the player acts — no Promise to await). @param {{bestWave:number, coins:number, credits:string, onPlay:() => void}} opts
   */
  showTitle(opts) {} // P8: renamed showMenu(opts) — opts gained weaponName/onWeapons/onSettings.

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
anywhere — **stale as of P8**: the menu's tap-anywhere-starts behaviour is
gone now that it has three buttons instead of one, see "P8 additions";
death: Enter/Space picks revive-if-offered-else-end, Escape ends; run-end:
Enter/Space picks "again", Escape picks "title"). `showTitle`'s (P8:
`showMenu`'s) portraits come from
`assetUrl('assets/sprites/portrait-<name>.webp')` for the four names
actually shipped in `manifest.json`'s `sprites.portraits` (`patapim`,
`tungtung`, `bombardiro`, `tralalero`).

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
and `hooks.onPause`/`onResume`. **Stale as of P8**: `_setManualPause` now
calls `hud.setPaused(false)` on *both* legs (paused and unpaused) — see
"P8 additions" for why (a real pause menu screen replaced the bare "PAUSED"
panel this call used to show). Guarded so it only engages during `build`/
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
  setPaused(paused) {}     // shows/hides a centred "PAUSED" panel over the (still-visible) HUD. As of P8 no caller ever passes `true` any more — see "P8 additions".
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
`ui/Screens.js`'s `showTitle` — itself renamed `showMenu` and expanded in
P8, see "P8 additions") and `src/main.js`'s `installTitlePanel`
function are gone. `Game.js`'s old `RUN_END_DISPLAY_S`-timed
toast-and-return-to-title for `death`/`waveClear -> runEnd` is replaced by
the flow above; nothing on the frozen P2/P3/P4 API list (`registerSystem`,
`world` shape, `getSnapshot`, state enter/exit hooks, `game.economy`) was
removed or reshaped — `game.combo`/`game.save`/`game.hooks` and the
`screens` constructor dependency are additive.

## P8 additions

P7 called itself "final"; P8 landed anyway. Everything below lives in
`core/{arenaGeometry,weapons,prefs,stateMachine}.js`, `game/Game.js`,
`game/Player.js`, `game/Enemies.js` (one signature change, documented in
place above), `game/Projectiles.js` (new), `game/buildPhase.js`,
`platform/{storage,audio}.js`, `game/assets.js`, and
`ui/{Screens,BuildOverlay,Hud,input,TouchControls}.js`. Six things landed
together: shots that miss now land somewhere; the single `config.player.gun`
became a six-weapon roster; multi-pellet spread and piercing; a real
menu/weapon-select/pause/settings screen flow; touch got a fire button plus
device preferences (sensitivity, invert, FPS, last weapon); and the RPG-7's
rocket got its own projectile pool. No new bus event was added by any of
this — checked every `bus.emit` call site in the diff, not assumed; the P2
table above is still complete.

### `core/arenaGeometry.js`: `rayArenaHit`

```js
/**
 * Nearest hit of a ray against the arena's two solid surfaces: the floor
 * (`y = 0`, only where inside the wall) and the wall (a vertical cylinder of
 * `arena.radius`, capped at `arena.wallHeight`).
 * @param {{x:number, y:number, z:number}} origin
 * @param {{x:number, y:number, z:number}} dir Need not be normalised; `dist` is in units of `dir`'s length.
 * @param {number} maxDist Hits beyond this are discarded (the weapon's range).
 * @param {import('./types.js').GameConfig} cfg
 * @returns {{x:number, y:number, z:number, dist:number, surface:'ground'|'wall'} | null}
 */
export function rayArenaHit(origin, dir, maxDist, cfg) {}
```

The player is always inside the cylinder, so a level or downward shot always
hits one of the two surfaces; only a shot angled out over the wall top
returns `null`. Two call sites: `Game#_resolvePellet` (a hitscan pellet that
hit no enemy or boss lands here instead of vanishing into empty space) and
`Projectiles#_nearestHit` (a rocket that reaches the arena's edge without
hitting anything detonates against it). Both compare its `dist` against
whatever else the same ray might have hit and take the nearer.

### Weapon roster (`config.js`, `core/weapons.js`)

`config.player.gun` — the single frozen `{dmg, rate, range, coneDegTouch,
recoilKick}` shape — is gone. In its place: `config.player.defaultWeapon`
(a weapon id) and `config.player.weapons`, shaped exactly like
`config.turrets` (an `order` array plus a `types` record), so `core/
weapons.js` and the select-screen UI reuse the same "resolve a def by id,
iterate `order` for display" pattern the turret chips already use. Six ids
ship (`pistol`, `ak47`, `m4a1`, `spas12`, `m82`, `rpg7`), each a
`{name, blurb, dmg, rate, range, spreadDeg, pellets, recoilKick,
coneDegTouch, model, color, scale, sound}` — `m82` also carries `pierce`,
`rpg7` also carries `projSpeed`/`splash`/`splashDmg`. Deliberately
**sidegrades, not a power ladder**: every weapon is unlocked from wave 1, and
each lands in the same 70-110 effective-DPS band, separated by range/spread/
burst shape instead — a strictly better weapon would flatten the whole run
(this reasoning is a code comment in `config.js`, not this file's own
editorializing). `model` is one of the two gun meshes in `props.glb` — a
weapon is told apart by `color`/`scale`, the same trick `Turrets#_buildHead`
already uses for turret heads (see "P4 additions" above) — and `sound` is a
name from `game/assets.js`'s `AUDIO_NAMES` (four new files shipped:
`pistol-shot-2`, `gunfire`, `cannon-shot-1`, `sniper-shot-1`).

```js
/** @returns {string[]} Weapon ids in display order. @param {GameConfig} cfg */
export function weaponIds(cfg) {}

/** @returns {object|null} The weapon def, or `null` for an unknown id.
 *  @param {string} id @param {GameConfig} cfg */
export function resolveWeapon(id, cfg) {}

/** @returns {string} `id` if it resolves, else `cfg.player.defaultWeapon`.
 *  @param {string|null|undefined} id @param {GameConfig} cfg */
export function coerceWeaponId(id, cfg) {}

/** Steps `delta` places through `order`, wrapping.
 *  @param {string} id @param {string[]} order @param {number} delta @returns {string} */
export function nextWeapon(id, order, delta) {}

/**
 * One direction per pellet, scattered uniformly across the weapon's spread
 * cone (`spreadDeg` of 0, or one pellet, returns the aim direction itself).
 * Vectors are plain `{x,y,z}` — `core/` may not import three.js.
 * @param {{x:number,y:number,z:number}} dir Aim direction; need not be normalised.
 * @param {number} spreadDeg Half-angle of the cone, in degrees.
 * @param {number} pellets How many directions to produce (>= 1).
 * @param {() => number} rand Returns [0,1). Injected — see below.
 * @returns {{x:number,y:number,z:number}[]} `pellets` unit vectors.
 */
export function spreadDirs(dir, spreadDeg, pellets, rand) {}
```

**Why `spreadDirs` takes an injected `rand` instead of importing
`core/rng.js`**: `core/rng.js`'s seeded stream exists so a run's *seed*
reproduces its *spawns* — drawing from that same stream once per pellet
would make wave composition depend on how much the player fired, which
breaks the one property the seed is for. `spreadDirs`'s one real call site
(`Game#_handleFiring`) passes `Math.random`, the same source `Effects.js`
already uses for cosmetic scatter; tests pass a seeded stand-in instead,
which is the other reason for injecting it — `spreadDirs` is deterministic
under `node --test` with no faked-global gymnastics.

`nextWeapon` is exported and tested but has no call site yet in `Game.js` —
weapon switching mid-run happens only through the build-phase chip row and
the menu's weapon-select screen (both call `equipWeapon(id)` directly with
a concrete id), not a next/previous cycle. Flagged here, same spirit as
earlier packages' "flagged for whoever touches this file next" notes, in
case a future package wants a keybind for it.

### `Player` additions

```js
class Player {
  /**
   * Points the player at a different weapon and rebuilds the viewmodel.
   * @param {string} id
   * @returns {string} The id actually equipped (`coerceWeaponId(id, cfg)` —
   *   an unknown/stale id, e.g. from an older saved preference, falls back
   *   to `config.player.defaultWeapon` rather than throwing).
   */
  setWeapon(id) {}
}
```

`gun` (see the corrected "Public fields" line above) is now
`config.player.weapons.types[weaponId]`, and `weaponId` is a new public
field. Swapping resets the fire cooldown against the *new* weapon's own
timer (`_lastFireT = this._time`) rather than inheriting however long the
old weapon had been idle — a swap must never hand out a free instant shot.
Only two gun meshes exist in `props.glb` (`Gun_02`, `Gun_03`), so, exactly
like `Turrets#_buildHead`'s turret heads, weapons are told apart by tint and
scale rather than six distinct models — `assets.propMesh(gun.model)` already
hands back a per-call material clone, so tinting one weapon's viewmodel
never touches the shared turret barrel mesh or another weapon's own
viewmodel.

**`aimTarget`'s role narrowed.** Before P8, `Game` used
`aimTarget(targets) >= 0` to decide *whether to fire at all* on touch (there
was no touch fire button). Now that there is one (`InputFrame.fire`, see
below), `aimTarget` only feeds **aim-assist**: `Game#_handleFiring` still
calls it every frame for the reticle color, and when the player is actually
holding the touch fire button and it returns a hit, the fired shot's
direction is bent onto that target before resolving. The method itself is
unchanged (same cone test, same `-1`-or-index return) — only what its caller
does with the result changed.

### `Game#_handleFiring` / multi-pellet, piercing, and misses that land

`_handleFiring` now reads `this.world.player.gun` — the *equipped* weapon —
rather than `config.player.gun`, so a swapped weapon's stats actually take
effect. It still gates on `frame.fire` alone (both modes now — no more
`frame.mode === 'touch' ? targetIndex >= 0 : frame.fire` branch), applies the
touch aim-assist bend described above, then dispatches on the weapon's own
shape:

- **`gun.projSpeed` truthy** (only `rpg7` today): `world.projectiles.launch(shot.origin, shot.dir, gun)` — see `Projectiles` below. Damage resolves on impact, not this frame.
- **Otherwise** (every hitscan weapon): `spreadDirs(shot.dir, gun.spreadDeg, gun.pellets, Math.random)` produces one direction per pellet (`1` for every weapon but `spas12`, which fires `9`), and `_resolvePellet(origin, dir, gun)` runs once per direction.

```js
/**
 * One hitscan pellet: damages the nearest enemy or boss it meets, and
 * leaves a mark wherever it stops — on a body, or failing that on the arena
 * itself. A weapon with `pierce` carries on through each enemy it kills or
 * wounds, up to that many bodies; the boss always stops a piercing shot
 * outright rather than being hit once per pellet pass.
 * @param {THREE.Vector3} origin @param {THREE.Vector3} dir Normalized. @param {object} gun
 */
_resolvePellet(origin, dir, gun) {}
```

Piercing walks `Enemies#raycast`'s new `skip` parameter forward: each
enemy the pellet has already damaged this pass goes into a `Set` passed to
the *next* `raycast` call, so the same pellet never re-hits (or gets stuck
re-detecting) a body it already passed through. A pellet that hits nobody —
the common case for a wide `spas12` spread, or any shot into open air — now
calls `rayArenaHit(origin, dir, gun.range, cfg)`: on a hit, a small
`effects.burst` in `cfg.effects.impact`'s `groundColor`/`wallColor` (by
`surface`) marks the spot and the tracer runs there instead of to a bare
`range`-distance point in empty space; on a genuine miss over the wall top,
the tracer still runs to the max-range point as before. `Effects#flash`
(previously dead code, documented but never called anywhere in the P2-P7
codebase) is now used for real: gated behind the new `config.effects.
muzzleFlash` boolean, called once per shot (not per pellet) at
`shot.origin`.

**Shot sound**, throttled: every weapon has a `sound` name; `_playShotSound`
falls back to `pistol-shot-1` if that name somehow isn't in
`assets.audioBuffers` (mirrors `Turrets#_fire`'s own graceful-degradation
pattern), and enforces a `SHOT_SOUND_MIN_INTERVAL_S` (0.07s) floor —
unthrottled shot audio was fine with one 6/s pistol, but the `m4a1`'s 11/s
would otherwise stack overlapping voices well past what the mixer should
carry, so it now uses the same floor `Enemies`/`Turrets` already apply to
their own sounds.

### `game/Projectiles.js` (new)

```js
class Projectiles {
  /** @param {THREE.Scene} scene @param {import('../core/types.js').GameConfig} cfg @param {import('../platform/audio.js').Audio} audio */
  constructor(scene, cfg, audio) {}

  /**
   * Fires one projectile. Silently drops the shot if the pool (`cfg.
   * projectiles.cap`, 16) is exhausted — never throws.
   * @param {THREE.Vector3} origin @param {THREE.Vector3} dir Need not be pre-normalized.
   * @param {object} gun Weapon def with `projSpeed`, `splash`, `splashDmg`, `dmg`, `range`, `sound`.
   */
  launch(origin, dir, gun) {}

  /** @param {number} dt @param {object} world The `Game.world` bag. */
  update(dt, world) {}

  /** Drops every projectile still in flight — called from `Game#_startRun` alongside `enemies.clear()`, so a rocket launched in a dying run's last seconds can't arrive and explode into the next one. */
  clear() {}

  dispose() {}
}
```

Structure mirrors `Enemies.js`'s own internal projectile pool almost
exactly (fixed-capacity SoA typed arrays + free-list, one `InstancedMesh`
for every live shot, hidden slots zero-scaled) but cannot reuse it: that
pool is private to `Enemies`, moves only on the XZ plane, and only ever
damages the player/turrets — a player rocket needs full 3D velocity and
needs to damage enemies/the boss instead. Registered via
`game.registerSystem('projectiles', projectiles)`, so it runs in the normal
per-step systems pass; `world.projectiles` is constructed unconditionally in
the `Game` constructor and is never `null` (same convention as `billboards`
— contrast `world.turrets`/`world.boss`, still `null`-until-registered).

**Hit detection is a swept continuous test, not stepped sub-sampling.**
Every candidate a rocket can detonate against already exposes an exact
ray-vs-shape test over an arbitrary distance: `Enemies#raycast` (ray vs.
per-type cylinder), `Boss#hitTest` (ray vs. the boss's cylinder), and this
package's own `rayArenaHit` (ray vs. floor/wall). `_nearestHit(origin, dir,
maxDist, world)` casts all three, from the projectile's position at the
start of the fixed step, along its direction of travel, out to exactly the
distance it covers that step, and detonates against the nearest. This is
mathematically exact — a fast rocket cannot tunnel through a body between
two frames, because the whole segment between them is swept, not just its
two endpoints — which is strictly stronger than discrete sub-stepping
against a fixed contact radius (itself only an approximation of the same
continuous test), so that's what's used instead.

`_detonate` applies `splashDmg` in a radius via `enemies.damageRadius` (and,
if the boss is within the same radius, `boss.damage`), plus a direct-hit
bonus `dmg` to whatever was actually struck; spawns `cfg.effects.explosion`'s
burst; and plays the weapon's sound through its own per-name throttle
(`cfg.effects.explosion.soundMinIntervalS`), independent of `Game.js`'s own
`_playShotSound` floor — the two never compete because a projectile weapon
never reaches `_playShotSound` at all (it plays its *launch* sound there,
same as any other weapon, then its *detonation* sound here).

`Projectiles` is the one `src/game/` module with unit tests
(`test/projectiles.test.js`). Everything else there needs a renderer, a DOM,
or both; this class only builds an `InstancedMesh` and does maths on typed
arrays, so it constructs and ticks headlessly with no WebGL context.

That exception is deliberate rather than incidental. The system is registered
unconditionally in `Game`'s constructor and runs every fixed step from boot,
so a fault in it is not an edge case — it takes the whole game down on the
first frame. `update()` shipped for part of P8 with an out-of-scope loop
bound (`cap`, a `const` local to the constructor), which threw
`ReferenceError` on the first tick and was caught by neither `node --check`,
nor the unit suite, nor a successful `vite build`: a `ReferenceError` is only
raised when the line actually runs, and nothing ran it. The tests cover
construction, a tick with an empty pool, detonation against the wall and the
floor, splash reaching the enemy pool, the swept collision test's
anti-tunnelling guarantee, `clear()`, and pool exhaustion.

### `ui/Screens.js`: `showMenu`, `showWeaponSelect`, `showPause`, `showSettings`

```js
class Screens {
  /**
   * The main menu (`showTitle` above, renamed and expanded). Callback style,
   * same reason as before: it stays up indefinitely, and its own buttons
   * lead to other screens that come back here rather than resolving once.
   * Unlike the old single-button title, tapping the backdrop no longer
   * starts a run — with three buttons, a stray tap next to SETTINGS
   * silently starting the game would be an unpleasant surprise. Enter/Space
   * still plays.
   * @param {{bestWave:number, coins:number, credits:string, weaponName:string,
   *          onPlay:() => void, onWeapons:() => void, onSettings:() => void}} opts
   */
  showMenu(opts) {}

  /**
   * Weapon select. Picking a card only highlights it; a second, explicit
   * action (the confirm button, Enter/Space, or Escape-to-cancel) commits —
   * see-before-you-commit, so the player can read a weapon's blurb/stat bars
   * before swapping away from whatever they're using. 1-6 jump straight to
   * a card by index.
   * @param {{weapons: {id:string, def:object}[], current:string, confirmLabel?:string}} opts
   * @returns {Promise<string>} The chosen id; `current` if cancelled (Escape).
   */
  showWeaponSelect(opts) {}

  /**
   * The manual pause menu — replaces the HUD's old bare "PAUSED" text panel
   * outright (see the corrected "Manual pause" note under "P7 additions"
   * above). Escape both opens (`Game`'s listener) and closes (this screen's
   * own listener) it.
   * @returns {Promise<'resume'|'settings'|'title'>}
   */
  showPause() {}

  /**
   * Settings. Resolves with the full patch to persist; this screen only
   * collects it; the caller applies and stores it (`Game#_runSettingsFlow`).
   * Only the slider matching the *current* input mode (`touch` ? `sensTouch`
   * : `sensMouse`) is actually editable — the other axis passes through
   * unchanged in the resolved object (seeded from the stored value, or `1` if
   * it was `null`), so opening Settings on one input device and touching
   * anything at all pins the *other* device's sensitivity from "unset,
   * follow config" to a concrete `1` the first time it's saved.
   * @param {{prefs: object, touch: boolean, muted: boolean}} opts
   * @returns {Promise<{sensMouse:number, sensTouch:number, invertY:boolean, showFps:boolean, muted:boolean}>}
   */
  showSettings(opts) {}
}
```

Reasoning worth carrying over precisely, from the code itself: **why weapon
select resolves BEFORE `_startRun` rather than being folded into it** —
`_startRun`'s very first act is `hooks.onRunStart?.()`, which in the real
Poki wiring (`main.js`) is `commercialBreak().then(gameplayStart)`. A DOM
screen mounted *under* a Poki ad iframe is exactly the ordering Poki's own
review flags, so Menu → Play routes through `_playFromMenu()`:
`showWeaponSelect` (labelled `START`) resolves and equips its choice
first, and only then does `_startRun()` run and open the ad. The build
overlay's own weapon row (`onSelectWeapon`, below) is unaffected — it can
freely swap mid-build since no ad is anywhere nearby.

All four screens share `Screens`' existing conventions (documented under
"P6 additions" above): `_open()`/`hide()` freeze input and release pointer
lock for as long as they're up, buttons disable rather than remove on
choice, and they render into the same `#ui` node with the same visual
language (new CSS in the `/* P8 screens */`-shaped block of `style.css`:
`.weapon-card`, `.weapon-stat*`, `.settings-row`/`.settings-slider`/
`.settings-toggle`, `.screen--pause`).

### `Game` orchestration additions

```js
class Game {
  /**
   * Equips a weapon and remembers the choice (`savePrefs({weapon: id})`).
   * Public because `ui/BuildOverlay.js`'s weapon-swap chip row is wired from
   * `game/buildPhase.js`, outside this class.
   * @param {string} id
   */
  equipWeapon(id) {}
}
```

**Boot-time weapon**: the constructor calls `world.player.setWeapon(
coerceWeaponId(this._prefs.weapon, config))` and `_applyPrefs()` before
`state.go('title')` — before anything is shown, including the `?wave=N` dev
shortcut, which now starts on whatever weapon was last equipped (or the
default) rather than forcing a choice.

**Why preferences (`core/prefs.js` + `platform/storage.js`) live under
their own `arenadefense.prefs` key, not `core/storage.js`'s save shape** —
straight from the code comment: `core/storage.js`'s persisted shape is
exactly `{coins, bestWave, unlocks}`, and `test/storage.test.js` asserts
that key set exactly. Preferences (sensitivity, invert, FPS toggle, last
weapon) are *device* state, not *run progress* — the same reasoning that
already put the mute flag under its own `arenadefense.muted` key in P7.
`loadPrefs()`/`savePrefs(patch)` (merge-and-persist) sit in `platform/
storage.js`; sanitizing (`sanitizePrefs`, clamping, type-coercion, never
throwing on a corrupt/hand-edited value) is pure and lives in `core/
prefs.js`, same read/write-vs-sanitize split `core/storage.js` and
`platform/storage.js` already have.

**Why sensitivity is stored as a multiplier, not a resolved value**:
`DEFAULT_PREFS.sensMouse`/`sensTouch` are `null` — meaning "use whatever
`config.player.lookSens*` says" — rather than a copy of that number. A
slider always writes a **multiplier** in `[SENS_MIN, SENS_MAX]` (0.25..3)
on top of the configured base; storing the resolved absolute value instead
would freeze a player's sensitivity at whatever the config said the day
they first touched the slider, so a later balance retune of `config.player.
lookSens*` would never reach a player who has ever saved a preference.
`Input#setLookSensitivity({mouse, touch, invertY})` applies the multiplier
in `Input#frame()` — the one place every scheme's raw `sample()` becomes an
`InputFrame` — rather than inside each scheme, so a silent scheme swap
(`_handleMediaChange`, e.g. a mouse docked to a tablet mid-session) can
never lose the setting, and `Player.js` still does its own multiplication
by the frozen `config.player.lookSens*` constant unchanged: the two compose
to `config x multiplier`. `invertY` flips `lookDY`'s sign in the same place,
since `Player.js` applies one identical multiplier to both axes and exposes
no separate invert knob.

**Touch fire button** (`ui/TouchControls.js`): `.touch-fire`, a sibling of
the move/look zones inside `.touch-layer`'s own stacking context (not
nested under `.hud` — same "only a sibling of `.touch-layer` can out-stack
its full-screen zones" reasoning `Hud.js`'s mute/pause buttons already
established in "P7 additions"). Level-triggered exactly like
`KeyboardMouse`'s left mouse button (`sample().fire` is `true` for every
frame between `pointerdown` and the matching release); releases on
`pointerup`/`pointercancel`/**`pointerleave`** rather than
`setPointerCapture`-then-`pointerup` alone, deliberately — capturing the
pointer would suppress `pointerleave` for it, and a finger sliding off the
button while still down must stop firing via `pointerleave`, not stay
latched until an eventual `pointerup` that may never target this element
again.

**The two new state-machine edges** (`core/stateMachine.js`):
`TRANSITIONS.build` gained `'runEnd'` and `TRANSITIONS.wave` gained
`'runEnd'`, alongside their pre-existing targets (`build → wave` and
`wave → {waveClear, death}` respectively are unchanged, purely additive).
Both are the pause menu's "QUIT TO TITLE": abandoning a run still has to
end it *through* `runEnd`, exactly like a death or a victory, because
`_runRunEndFlow` is what persists coins — going straight to `title` would
silently throw away whatever the run had banked. Concretely,
`_runPauseFlow`'s `'title'` branch does `hooks.onRunStop?.()`,
`state.go('runEnd')`, `bus.emit('state:changed', {state:'runEnd'})`, then
`_runRunEndFlow(false)` — the identical `state.go('runEnd')` +
`state:changed` pairing `_runDeathFlow`'s decline path and the final-wave
victory chain (both P6) already use before calling the same
`_runRunEndFlow`, so no third bookkeeping path exists for "how a run ends."
**What "banked so far"
actually means on a quit**: `_runRunEndFlow` reads `economy.bankedCoins` —
coins from waves *already cleared* (`bankWave()` on each clean clear). Any
coins still `pendingCoins` from the wave in progress when the player quit
are neither explicitly banked nor explicitly discarded — they're simply
never read, and `_startRun`'s next `new Economy(cfg)` replaces the instance
outright — so the net effect is identical to a death's `discardPending()`,
just implicit rather than an explicit call. A quit mid-build (no wave in
progress, `pendingCoins` always 0 there) has no pending coins to lose at
all.

**Why `Hud#setPaused`'s bare "PAUSED" panel now has no caller that sets it
`true`**: the real pause menu (`Screens#showPause`) replaced it —
`_setManualPause(paused)` now calls `hud.setPaused(false)` on *both* the
pause and resume legs (a reset, not a toggle), and opens/awaits
`_runPauseFlow()`'s screen separately. Nothing else needs the old panel:
every *involuntary* pause (the case P2's own scope-cut note anticipated) is
already covered by something else fully covering the screen — Poki's ad
iframe during an ad-triggered pause, or the browser's own chrome during a
backgrounded/unfocused tab — so there was never a scenario left where a
bare text panel was the only thing telling the player they were paused. The
method itself is left in place (a future caller could still use it), just
unreached today.

### `ui/BuildOverlay.js` / `game/buildPhase.js`: weapon-swap chip row

```js
class BuildOverlay {
  /** @type {((id:string) => void)|null} */ onSelectWeapon;
  /** Pure local state — does NOT itself invoke `onSelectWeapon` (same
   *  set-vs-fire split `setSelectedType`/its chip click handler already
   *  use for turrets), so a caller can sync the displayed selection without
   *  re-triggering its own callback. @param {string} id */
  setSelectedWeapon(id) {}
}
```

One `.bo-chip`/`.bo-weapon-chip` per `cfg.player.weapons.order` entry,
mirroring `_buildChips()`'s turret-chip pattern — but with no
`.is-affordable` state to toggle at all, since every weapon is free and
unlocked from wave 1 (the asymmetry with turret chips is deliberate, not a
missed case). No number-key hotkey either: `_attachKeys` already binds 1/2/3
to turret-type selection, and overloading the same `window` `keydown`
listener with six more digits would make one handler juggle two unrelated
pickers. `installBuildPhase` wires `overlay.onSelectWeapon = (id) => {
if (game.state.state !== 'build') return; game.equipWeapon(id); ... }` —
guarded to the build phase only, and, unlike `onPlace`/`onUpgrade`/
`onRepair`, spends nothing from `game.economy` (there is no cost).

### `ui/Hud.js`: FPS readout

```js
class Hud {
  setFpsVisible(visible) {}  // hidden by default until called.
  setFps(fps) {}             // e.g. "62 FPS".
}
```

Driven by a settings-screen toggle (`Game#_applyPrefs` calls
`setFpsVisible`; `Game#_debugTick` calls `setFps` on the same
`DEBUG_REFRESH_S` cadence the `?debug=1` overlay already used, and — also
new — that overlay's own debug element is no longer required for
`_debugTick` to run its fps math at all, so the HUD readout works with or
without `?debug=1`). Unlike `.hud-controls` (the mute/pause buttons, a
sibling of `.hud` for the stacking-context reasons "P7 additions" documents
at length), the FPS readout is an ordinary read-only child of `.hud` itself
— it never needs to receive a tap, so it has no reason to escape `.hud`'s
own (lower) stacking context.

### `platform/audio.js`: `muted` getter

```js
class Audio {
  /** @returns {boolean} */
  get muted() {}
}
```

One line, added so `Game#_runSettingsFlow` can seed the settings screen's
mute toggle from the audio system's own live state (`this._audio.muted`)
rather than needing a second source of truth for it.

### Bus events (`game.bus`, `core/events.js`)

No new event was added — checked, not assumed: every `bus.emit` call in the
diff is either `state:changed` (the pause-menu quit path re-emitting it for
`'runEnd'`, exactly like every other `state`/`bus` pairing already in the
codebase) or the pre-existing `player:fired`. The tables under "P2/P3/P5
additions" above are still the complete list.
## Weapon recoil

### `core/recoil.js` (pure)

```js
/** @typedef {{ value: number, velocity: number }} RecoilSpring */

/** @returns {RecoilSpring} At rest. */
export function createRecoilSpring() {}

/** Returns the spring to exact rest (value *and* velocity). @param {RecoilSpring} spring */
export function resetRecoilSpring(spring) {}

/** Adds one shot's signed velocity impulse; repeated kicks stack. @param {RecoilSpring} spring @param {number} impulse */
export function kickRecoilSpring(spring, impulse) {}

/** Semi-implicit Euler step of `x'' = -stiffness*x - damping*x'`. @param {RecoilSpring} spring @param {number} dt @param {GameConfig} cfg */
export function stepRecoilSpring(spring, dt, cfg) {}
```

One normalized scalar, no three.js/DOM and no `core/rng.js` — fully
deterministic, which is what lets `test/recoil.test.js` pin its properties.

A shot adds a **velocity** impulse rather than stepping the value, so the
kick ramps in over ~4 frames and eases back out: a punch, not a pop.
`CONFIG.player.gun.recoil.impulse` is normalized so a single shot peaks
`value` at ~1.0, which makes every amplitude in that block readable as
"per shot". `damping` is exactly `2*sqrt(stiffness)` (critically damped), so
the value never overshoots below rest — the property that makes it safe to
drive the camera pitch with, since an undershoot would swing the view *below*
the player's aim. Sustained fire at `gun.rate` overlaps on the tail and
plateaus around 1.3x a single shot; `maxValue` bounds that stack.

The step sub-divides `dt` to ~1/480s (capped at 8 sub-steps). This is for
**accuracy, not stability**: at the raw 1/60 fixed step the explicit damping
term eats most of a fresh impulse in the first step and the kick peaks at
about half its analytic height. Sub-stepping also makes the felt response
independent of `timing.fixedStep`. The `maxValue` clamp doubles as the
divergence guard for a pathological `dt` — the spring saturates and then
recovers rather than blowing up.

`game/Player.js` owns all the three.js: it multiplies the one spring value by
the four amplitudes in `CONFIG.player.gun.recoil` — `viewBackM` (viewmodel
slides toward the eye), `viewUpM` (and up — the pre-recoil code slid it
*down*, which read as a dip), `viewPitchDeg` (muzzle-up tilt, the channel
that carries the read), and `camPitchDeg` (the view punch). The viewmodel
tilt is applied as `rotation.x = baseRot.x + kick * viewPitchDeg`, an offset
from the orientation `assets.propMesh` bakes in from the model, never a bare
`rotation.set`.

Pause/resume needs no handling: `Game#pause()` stops the fixed-step loop, so
the spring simply freezes mid-kick and continues on resume.

### Where the recoil numbers live (reconciled with the weapon roster)

This landed alongside the P8 weapon roster, which removed `CONFIG.player.gun`
outright. The recoil config is therefore split in two rather than sitting in
one `gun.recoil` block:

- **`CONFIG.player.recoil`** — `stiffness`, `damping`, `maxValue`. Shared by
  every weapon, because they are normalization and stability constants rather
  than feel knobs, and `stepRecoilSpring(spring, dt, cfg)` reads them from
  here.
- **`CONFIG.player.weapons.types[*].recoil`** — `impulse`, `viewBackM`,
  `viewUpM`, `viewPitchDeg`, `camPitchDeg`. Per weapon, read through
  `player.gun.recoil` (the equipped weapon), which is what lets a SPAS-12 kick
  roughly two and a half times as hard as the M9 without retuning the spring.

`impulse` stays at the normalized `46.5` on every weapon. That value is what
makes one shot peak the spring at ~1.0, so each amplitude reads directly as
"per shot"; scaling it per weapon as well would push into `maxValue`'s clamp
and count the weapon's heft twice. `camPitchDeg` is scaled far more gently
than the viewmodel channels (`1 + (heft - 1) * 0.35`), because it moves where
the player is actually aiming rather than just the gun on screen — every
weapon stays under the "camera punch below half the aim cone" bound the
recoil tests pin.

`Player.js`'s hardcoded `RECOIL_DECAY_PER_S` is gone, per `AGENTS.md`'s
"every tunable number lives in `config.js`". `Player#_buildViewmodel`
re-captures `_viewmodelBaseRot` on every weapon swap, since each weapon's
mesh carries its own baked orientation for the tilt to offset from.
