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
