// Shared JSDoc typedefs for `src/core/**`. Nothing here has a runtime effect;
// it exists purely so editors and `tsc --checkJs` (if ever run) can type the
// plain-object shapes that pass between the pure core modules. Every module
// under `src/core` stays free of three.js, the DOM, and `window`/`document`/
// `localStorage` — see `../../AGENTS.md`.

/**
 * @typedef {'boot'|'title'|'build'|'wave'|'waveClear'|'death'|'runEnd'} GameState
 */

/**
 * @typedef {object} EnemyTypeDef
 * @property {'voxel'|'sprite'} render
 * @property {string} [model]
 * @property {string} [sprite]
 * @property {number} [height]
 * @property {number} hp
 * @property {number} speed
 * @property {'melee'|'ranged'} kind
 * @property {number} dmg
 * @property {number} range
 * @property {number} [keepDistance]
 * @property {number} [preferPlayerRange]
 * @property {number} cooldown
 * @property {number} [projSpeed]
 * @property {number} [lunge]
 * @property {number} energy
 * @property {number} radius
 * @property {number} hitHeight
 */

/**
 * @typedef {object} WaveSpawnEntryDef
 * @property {string} enemy
 * @property {number} n
 * @property {number} everyS
 * @property {number} [startS]
 */

/**
 * @typedef {object} WaveDef
 * @property {number} n
 * @property {number} hpMul
 * @property {number} maxAlive
 * @property {WaveSpawnEntryDef[]} spawns
 * @property {string} [boss]
 */

/**
 * A single spawn instruction with an absolute time and a resolved gate,
 * produced by `waves.js#flattenSpawns`.
 * @typedef {object} FlatSpawnEntry
 * @property {string} enemy
 * @property {number} t Absolute time in seconds since wave start.
 * @property {number} gateId Index into the wave's active-gate pair.
 */

/**
 * @typedef {object} Vec2
 * @property {number} x
 * @property {number} z
 */

/**
 * @typedef {object} MapPoint Normalised build-overlay coordinates, +z down.
 * @property {number} x
 * @property {number} z
 */

/**
 * @typedef {object} SaveData
 * @property {number} coins
 * @property {number} bestWave
 * @property {string[]} unlocks
 */

/**
 * @typedef {object} SaveIO
 * @property {(key: string) => string|null} get
 * @property {(key: string, value: string) => void} set
 */

/**
 * @typedef {object} JoystickConfig
 * @property {number} radiusPx
 * @property {number} deadzone
 * @property {number} saturation
 */

/**
 * @typedef {object} JoystickVector
 * @property {number} x -1..1, positive = right.
 * @property {number} y -1..1, positive = up/forward (already screen-y-flipped).
 * @property {number} magnitude 0..1 radial deflection after shaping.
 * @property {number} angle Radians from right toward up.
 * @property {boolean} active
 */

/**
 * Per-frame movement/look/action sample handed from `ui/input.js` to
 * `game/Player.js` and `game/Game.js`. Produced fresh every fixed step by
 * `Input#frame()`, which also resets its own edge-triggered fields — see
 * `docs/INTERFACES.md` for full semantics.
 * @typedef {object} InputFrame
 * @property {'touch'|'keyboard'} mode
 * @property {number} moveX -1..1, positive = right (strafe).
 * @property {number} moveY -1..1, positive = forward.
 * @property {number} lookDX Pixels of look movement this frame, positive = right.
 * @property {number} lookDY Pixels of look movement this frame, positive = down.
 * @property {boolean} fire Level-triggered: true every frame the fire input is held.
 * @property {0|1|2|3} select Edge-triggered turret-type pick; 0 = none, 1/2/3 = gun/tesla/cannon.
 * @property {boolean} ready Edge-triggered "Ready" (skip build countdown).
 * @property {boolean} pause Edge-triggered pause toggle.
 */

/**
 * Resolved per-level combat numbers for one turret, from
 * `core/turretLogic.js#statsFor`. `splash`/`slow`/`slowDurS` are only present
 * on the object at all for the turret types that define them (cannon/tesla
 * respectively) — see that function's doc comment.
 * @typedef {object} TurretStats
 * @property {number} dmg
 * @property {number} rate Shots per second.
 * @property {number} range Metres.
 * @property {number} [splash] Splash radius in metres (cannon only).
 * @property {number} [slow] Fractional speed reduction 0..1 (tesla only).
 * @property {number} [slowDurS] Slow duration in seconds (tesla only).
 */

/**
 * A placed turret's persistent state, owned by `game/Turrets.js` and read
 * (via `Turrets#list()`/`Game#getSnapshot()`) by `ui/BuildOverlay.js`. Not a
 * class — a plain mutable record, so `core/turretLogic.js` can stay pure and
 * mutate only the `cooldown` field it owns.
 * @typedef {object} TurretRecord
 * @property {number} slotId Index into `arenaGeometry.slotPositions(cfg)`.
 * @property {string} type One of `cfg.turrets.order`.
 * @property {number} level 0-based, `cfg.turrets.types[type].levels.length - 1` at max.
 * @property {number} hp
 * @property {number} hpMax
 * @property {number} x World metres.
 * @property {number} z World metres.
 * @property {boolean} alive `false` once destroyed — the record (a "wreck")
 *   stays in `Turrets`' bookkeeping, still returned by `list()`, until
 *   `Turrets#clearWreck(slotId)` removes it and frees the slot.
 * @property {number} [cooldown] Seconds until the next shot is ready; owned by `core/turretLogic.js#fireReady`.
 */

/**
 * `Game#getSnapshot()`'s return shape — everything `ui/BuildOverlay.js` needs
 * to render one frame of the build-phase map, see `docs/INTERFACES.md`.
 * @typedef {object} BuildSnapshot
 * @property {number} wave Current wave number, 1-based.
 * @property {number[]} activeGates The current wave's lit gate id pair.
 * @property {number} energy
 * @property {{x:number, z:number, yaw:number}} player
 * @property {TurretRecord[]} turrets Every tracked turret record, alive and destroyed alike.
 * @property {ReturnType<import('./arenaGeometry.js').slotPositions>} slots
 */

export {};
