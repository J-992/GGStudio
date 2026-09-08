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
 * @property {number} [knockbackScale] Multiplier on this type's hit-reaction knockback (and on its cap); 1 = the `cfg.enemies.knockback` defaults, lower = heavier body.
 */

/**
 * `cfg.bosses.patapim`'s shape (the only non-stub entry in `cfg.bosses` in
 * v1 — the other keys there are `{stub:true, ...}` data placeholders with no
 * corresponding `BossDef` fields beyond `sprite`/`kind`, not consumed by
 * `core/bossBrain.js` or `game/Boss.js`).
 * @typedef {object} BossDef
 * @property {'sprite'} render
 * @property {string} sprite
 * @property {number} height Metres; billboard width is `height * sprite.aspect`.
 * @property {number} hp
 * @property {number} speed
 * @property {'melee'} kind
 * @property {number} dmg
 * @property {number} range
 * @property {number} cooldown Seconds between melee attacks.
 * @property {string} addType Key into `cfg.enemies.types` — the add this boss spawns while casting.
 * @property {number} addEveryS Seconds between casts (cadence measured start-to-start; see `core/bossBrain.js`).
 * @property {number} maxAdds This boss's own adds cap — independent of, and additionally bounded by, `cfg.enemies.cap`.
 * @property {number} castDurationS Seconds a cast takes; the add spawns at 60% of the way through it.
 * @property {number} energy Energy awarded (via the generic `enemy:killed` listener in `Game.js`) on death.
 * @property {number} coins Coins P6's combo/coin system awards on death (`enemy:killed`'s `coins` field).
 * @property {number} radius Metres, for hit-testing (`game/Boss.js#hitTest`/`positions`) and arena-edge clamping.
 * @property {number} hitHeight Metres, the hit-test cylinder's height.
 */

/**
 * The plain-object snapshot `game/Boss.js` hands `core/bossBrain.js#update`
 * every fixed step.
 * @typedef {object} BossBrainCtx
 * @property {{x:number, z:number}} self
 * @property {{x:number, z:number, dist:number}} target
 * @property {number} addsAlive Count of this boss's own currently-alive adds (capped independently of `cfg.enemies.cap` — see `BossDef.maxAdds`).
 * @property {number} time Seconds, `world.time`-equivalent. Unused by `bossBrain.js` today (every timer there is dt-accumulated, not absolute) — accepted for parity with `EnemyTypeDef`-consuming functions and in case a future boss's cadence needs an absolute clock.
 */

/**
 * `core/bossBrain.js#update`'s return shape.
 * @typedef {object} BossBrainResult
 * @property {'walk'|'cast'|'attack'|'idle'} action
 * @property {{x:number, z:number}|null} moveDir Unit vector, only non-null when `action === 'walk'`.
 * @property {boolean} spawnAdd `true` on exactly one tick per cast (at 60% `castProgress`) — see `core/bossBrain.js`.
 * @property {number} castProgress 0..1 through the current cast; `0` when `action !== 'cast'`.
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
 * @property {number} coins Run total: banked + pending, matching `Hud#setCoins`.
 * @property {{x:number, z:number, yaw:number}} player
 * @property {TurretRecord[]} turrets Every tracked turret record, alive and destroyed alike.
 * @property {ReturnType<import('./arenaGeometry.js').slotPositions>} slots
 */

export {};
