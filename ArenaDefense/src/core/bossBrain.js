/**
 * Pure boss AI for `patapim` (and, in principle, any future melee boss that
 * shares the same "walk, periodically cast to spawn an add, melee attack on
 * cooldown" pattern). No three.js, DOM, or randomness — see `../../AGENTS.md`.
 * Consumed by `game/Boss.js`, which owns the render/spawn/damage side effects
 * and calls `update(dt, ctx)` once per fixed step with a plain-object
 * snapshot of the boss's current state.
 *
 * Priority every step: finish/continue an in-progress cast (blocks movement
 * and attacking) > start a new cast if the cadence timer is up and there's
 * room for another add > melee attack if in range and off cooldown >
 * otherwise walk toward the target.
 */

const CAST_SPAWN_PROGRESS = 0.6;

/**
 * @param {number} v
 * @returns {number}
 */
function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

export class BossBrain {
  /**
   * @param {import('./types.js').BossDef} def `cfg.bosses.patapim`-shaped (see `core/types.js`).
   * @param {import('./types.js').GameConfig} cfg Accepted for parity with every other pure-core
   *   constructor in this codebase (`enemyBrain`'s functions all take `cfg`) even though every
   *   number this brain needs today already lives on `def` — kept in case a future boss's cast
   *   timing needs a global config value.
   */
  constructor(def, cfg) {
    this._def = def;
    this._cfg = cfg;
    this.reset();
  }

  /** Resets all internal timers — call whenever a fresh boss instance is
   *  (re)spawned so a previous fight's cast/attack cadence never bleeds into
   *  the next one. */
  reset() {
    // Seconds until a new cast may start; only ticks while not casting.
    // Starts at a full interval (not 0) so a freshly spawned boss walks in
    // for a beat before its first cast, rather than summoning an add on the
    // very first update.
    this._castCooldown = this._def.addEveryS;
    this._casting = false;
    this._castElapsed = 0;
    this._castSpawnedThisCast = false;
    this._attackCooldown = 0;
  }

  /** @returns {number} Seconds until the next melee attack is off cooldown (0 = ready). Exposed for HUD/debug use only — nothing in this file reads it. */
  get attackCooldown() {
    return this._attackCooldown;
  }

  /** @returns {number} Seconds until a new cast may start (0 = eligible now, pending the add cap). Test/debug only — nothing in this file reads it back. */
  get castCooldown() {
    return this._castCooldown;
  }

  /**
   * @param {number} dt
   * @param {{ self:{x:number,z:number}, target:{x:number,z:number,dist:number}, addsAlive:number, time:number }} ctx `time` is accepted for a future boss whose cadence needs an absolute clock; today every timer here is tracked relative (dt-accumulated), so it goes unused.
   * @returns {{ action:'walk'|'cast'|'attack'|'idle', moveDir:{x:number,z:number}|null, spawnAdd:boolean, castProgress:number }}
   */
  update(dt, ctx) {
    const def = this._def;
    this._attackCooldown = Math.max(0, this._attackCooldown - dt);

    if (this._casting) {
      this._castElapsed += dt;
      const progress = clamp01(this._castElapsed / def.castDurationS);
      let spawnAdd = false;
      if (!this._castSpawnedThisCast && progress >= CAST_SPAWN_PROGRESS) {
        spawnAdd = true;
        this._castSpawnedThisCast = true;
      }
      if (this._castElapsed >= def.castDurationS) {
        this._casting = false;
      }
      return { action: 'cast', moveDir: null, spawnAdd, castProgress: progress };
    }

    this._castCooldown = Math.max(0, this._castCooldown - dt);
    if (this._castCooldown <= 0 && ctx.addsAlive < def.maxAdds) {
      this._casting = true;
      this._castElapsed = 0;
      this._castSpawnedThisCast = false;
      // Reset now (not on cast end) so the cadence is "a new cast may start
      // every addEveryS", measured start-to-start.
      this._castCooldown = def.addEveryS;
      return { action: 'cast', moveDir: null, spawnAdd: false, castProgress: 0 };
    }

    if (ctx.target.dist <= def.range && this._attackCooldown <= 0) {
      this._attackCooldown = def.cooldown;
      return { action: 'attack', moveDir: null, spawnAdd: false, castProgress: 0 };
    }

    const dx = ctx.target.x - ctx.self.x;
    const dz = ctx.target.z - ctx.self.z;
    const d = Math.hypot(dx, dz);
    if (d <= 1e-6) {
      return { action: 'idle', moveDir: null, spawnAdd: false, castProgress: 0 };
    }
    return { action: 'walk', moveDir: { x: dx / d, z: dz / d }, spawnAdd: false, castProgress: 0 };
  }
}
