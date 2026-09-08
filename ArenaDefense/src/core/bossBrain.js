/**
 * Pure boss AI. No three.js, DOM, or randomness — see `../../AGENTS.md`.
 * Consumed by `game/Boss.js`, which owns the render/spawn/damage side effects
 * and calls `update(dt, ctx)` once per fixed step with a plain-object
 * snapshot of the boss's current state. One `BossBrain` instance is created
 * per boss fight (`game/Boss.js#spawn` builds a fresh one against whichever
 * `cfg.bosses[key]` def is spawning), so every timer below is scoped to a
 * single fight and never needs to be told a new fight has started mid-update
 * — `reset()` covers the "same instance, new fight" case a re-spawn takes
 * instead.
 *
 * `def.mechanic` (absent on `patapim`/`lirili`) is what turns this from "walk,
 * periodically cast to spawn an add, melee attack on cooldown" into one of
 * four fights:
 *  - no mechanic: the pattern above, unchanged (`patapim`, and `lirili` which
 *    only swaps the add cadence/type numbers, not the shape).
 *  - `groundDenial`: an independent periodic timer (ticks every update
 *    regardless of what the main action state machine below is doing) that
 *    asks `game/Boss.js` to drop a damaging zone lead-predicted ahead of the
 *    target rather than glued to their feet.
 *  - `dash`: a windup → charge state machine that pre-empts the main action
 *    state machine entirely while active (see `_tickDash`).
 *  - `phases`: not a state machine of its own — every tick it latches the
 *    highest HP-threshold phase reached so far (monotonic, never reverts on
 *    a heal) and folds that phase's `speedMul`/`cooldownMul` into the normal
 *    walk/attack numbers below, plus surfaces `adds`/`enrage` flags.
 *
 * Priority per step once phase/ground-denial bookkeeping is done: an
 * in-progress or eligible dash > an in-progress cast (blocks movement and
 * attacking) > start a new cast if the cadence timer is up, there's room for
 * another add, and the current phase (if any) allows adds > melee/ranged
 * attack if in range and off cooldown > otherwise steer toward (melee, and
 * ranged beyond `keepDistance`) or hold near (ranged within `keepDistance`)
 * the target.
 */

const CAST_SPAWN_PROGRESS = 0.6;

// --- groundDenial tuning not carried by `def.mechanic` (see AGENTS.md: "if
// you need a number I did not provide, use a named module constant, and
// report it so I can move it into config") ---
//
// How far ahead (in seconds of the target's own estimated velocity) a new
// zone is placed. Estimated from the target's frame-to-frame displacement
// rather than a real velocity field, since `BossBrainCtx.target` only ever
// carries a position — see `_tickGroundDenial`.
const GROUND_ZONE_LEAD_S = 0.75;
// Minimum offset from the target's current position, used when they're
// standing still (estimated velocity ~0) so a zone never lands exactly
// underfoot — that would be unavoidable, not telegraphed. Also serves as the
// threshold below which the estimated lead is considered "not moving".
const GROUND_ZONE_MIN_LEAD_M = 2.5;

// --- ranged standoff tuning not carried by `def` (same rule as above) ---
// Width, in metres, of the deceleration band around `def.keepDistance`
// inside which the ranged boss's approach/retreat speed eases toward 0
// instead of banging between full speed in and full speed out.
const RANGED_STANDOFF_EASE_M = 2.0;

/**
 * @param {number} v
 * @returns {number}
 */
function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export class BossBrain {
  /**
   * @param {object} def A `cfg.bosses.<key>` entry (see `config.js`'s `bosses` block for the
   *   shared core fields every boss carries, plus the optional `mechanic` block).
   * @param {import('./types.js').GameConfig} cfg Accepted for parity with every other pure-core
   *   constructor in this codebase (`enemyBrain`'s functions all take `cfg`) even though every
   *   number this brain needs today already lives on `def`/`def.mechanic`.
   */
  constructor(def, cfg) {
    this._def = def;
    this._cfg = cfg;
    this.reset();
  }

  /** Resets all internal timers/state machines — call whenever a fresh boss
   *  instance is (re)spawned so a previous fight's cadence never bleeds into
   *  the next one. `game/Boss.js#spawn` also just builds a brand-new
   *  `BossBrain` per fight (defs differ boss-to-boss), so in practice this
   *  mainly matters for a stray double-spawn of the same boss and for tests. */
  reset() {
    const def = this._def;
    const mech = def.mechanic;

    // Seconds until a new cast may start; only ticks while not casting.
    // Starts at a full interval (not 0) so a freshly spawned boss walks in
    // for a beat before its first cast, rather than summoning an add on the
    // very first update. `Infinity` for a boss with no `addType` at all
    // (bombardiro, tralalero) so the "start a new cast" check below can
    // never pass — cheaper and more obviously-correct than sprinkling
    // `def.addType &&` guards through every branch that touches it.
    this._castCooldown = def.addType ? def.addEveryS : Infinity;
    this._casting = false;
    this._castElapsed = 0;
    this._castSpawnedThisCast = false;
    this._attackCooldown = 0;

    // Dash state machine (tralalero). `_dashDir` is locked once at windup
    // start and held through the charge — see `_tickDash`'s "why" comment on
    // why it must not be recomputed mid-windup.
    this._dashState = 'idle';
    this._dashTimer = 0;
    this._dashCooldown = mech?.kind === 'dash' ? mech.everyS : Infinity;
    this._dashDir = null;

    // Ground-denial cadence + the target-position history `_tickGroundDenial`
    // needs to estimate a lead velocity (see `GROUND_ZONE_LEAD_S`).
    this._zoneCooldown = mech?.kind === 'groundDenial' ? mech.everyS : Infinity;
    this._prevTargetX = null;
    this._prevTargetZ = null;

    // Phase latch (assassino). Index 0 is always the base phase (every
    // `phases` array's first entry is `belowHpFrac: 1.00`, trivially true
    // from full HP) — starting here rather than -1 means a boss with a
    // `phases` mechanic always has a valid "current phase" to read, even
    // before the first `update()` call.
    this._phaseIndex = 0;
  }

  /** @returns {number} Seconds until the next melee attack is off cooldown (0 = ready). Exposed for HUD/debug use only — nothing in this file reads it. */
  get attackCooldown() {
    return this._attackCooldown;
  }

  /** @returns {number} Seconds until a new cast may start (0 = eligible now, pending the add cap). Test/debug only — nothing in this file reads it back. */
  get castCooldown() {
    return this._castCooldown;
  }

  /** @returns {number} Seconds until the next dash may start (0 = eligible now, pending `minRange`). `Infinity` for a boss with no `dash` mechanic. Test/debug only. */
  get dashCooldown() {
    return this._dashCooldown;
  }

  /** @returns {number} Index into `def.mechanic.phases` of the highest threshold latched so far. `0` for a boss with no `phases` mechanic (harmless — nothing reads it in that case). Test/debug only. */
  get phaseIndex() {
    return this._phaseIndex;
  }

  /**
   * Latches `this._phaseIndex` forward to the highest phase whose
   * `belowHpFrac` the current HP fraction has crossed. Forward-only by
   * construction (the loop only ever raises `_phaseIndex`, never lowers it)
   * so a heal (turret repair aside, nothing heals a boss today, but the rule
   * is cheap to guarantee) can never un-latch a phase already reached — "as
   * HP crosses each threshold... never go backwards" per the design brief.
   * Iterates every remaining phase each call (never `break`s early) rather
   * than assuming `phases` is sorted by descending `belowHpFrac`, so a
   * config that briefly dips HP past two thresholds in one hit (e.g. a
   * cannon shell) still lands on the correct, highest one.
   *
   * @param {number} hpFrac 0..1.
   */
  _latchPhase(hpFrac) {
    const phases = this._def.mechanic.phases;
    for (let i = this._phaseIndex + 1; i < phases.length; i++) {
      if (hpFrac <= phases[i].belowHpFrac) this._phaseIndex = i;
    }
  }

  /**
   * Dash windup → charge state machine (tralalero). Returns `null` when
   * there's nothing dash-related happening this tick (idle and not yet
   * eligible), which tells `update()` to fall through to the normal
   * cast/attack/walk logic below; returns a full result object the instant
   * a dash is in progress or starting, which `update()` returns immediately
   * without running any of that other logic — a dash owns the whole tick.
   *
   * @param {number} dt
   * @param {{self:{x:number,z:number}, target:{x:number,z:number,dist:number}}} ctx
   * @param {object} mech `def.mechanic` (kind 'dash').
   * @returns {BossBrainResult|null}
   */
  _tickDash(dt, ctx, mech) {
    if (this._dashState === 'idle') {
      this._dashCooldown = Math.max(0, this._dashCooldown - dt);
      // "Only initiate beyond minRange, or it is unreadable" — a dash that
      // could start from melee range would cover the windup distance before
      // the player could react to it at all. If the cooldown is up but the
      // target is too close, the cooldown is simply left at 0 (not reset)
      // so the dash fires the instant the target opens the distance back up,
      // rather than waiting a further `everyS`.
      if (this._dashCooldown <= 0 && ctx.target.dist > mech.minRange) {
        this._dashState = 'windup';
        this._dashTimer = 0;
        const dx = ctx.target.x - ctx.self.x;
        const dz = ctx.target.z - ctx.self.z;
        const d = Math.hypot(dx, dz) || 1;
        // Locked here and held through the entire windup + charge (never
        // recomputed below) — "the wind-up is the whole fight": if the
        // aim kept tracking the target during the windup, the telegraph
        // would be a lie and standing still would always dodge it.
        this._dashDir = { x: dx / d, z: dz / d };
        // Start-to-start cadence, same convention as the cast cooldown
        // above: reset now rather than when the dash finishes, so "a new
        // dash may start every `everyS`" is measured from attempt to
        // attempt regardless of how long the windup+charge itself takes.
        this._dashCooldown = mech.everyS;
        return {
          action: 'dash', moveDir: null, spawnAdd: false, castProgress: 0,
          dash: { phase: 'windup', progress: 0, dir: this._dashDir },
        };
      }
      return null;
    }

    if (this._dashState === 'windup') {
      this._dashTimer += dt;
      const progress = clamp01(this._dashTimer / mech.windupS);
      if (this._dashTimer >= mech.windupS) {
        // Flip now; this tick still reports 'windup' (at progress 1) so the
        // frame the threshold is crossed doesn't skip straight to a charging
        // tick with a stale `_dashTimer` — the charge's own timer starts
        // fresh next tick, matching how a cast's `_casting` flag flips one
        // tick "late" relative to its own completing frame.
        this._dashState = 'charging';
        this._dashTimer = 0;
      }
      return {
        action: 'dash', moveDir: null, spawnAdd: false, castProgress: 0,
        dash: { phase: 'windup', progress, dir: this._dashDir },
      };
    }

    // Charging: a straight line along the locked `_dashDir`, ignoring the
    // target entirely (a charge that steered would just be fast melee, not
    // a dodge-or-get-hit commitment).
    this._dashTimer += dt;
    const progress = clamp01(this._dashTimer / mech.durationS);
    if (this._dashTimer >= mech.durationS) this._dashState = 'idle';
    return {
      action: 'dash', moveDir: this._dashDir, spawnAdd: false, castProgress: 0,
      dash: { phase: 'charging', progress, dir: this._dashDir },
    };
  }

  /**
   * Ground-denial cadence (bombardiro): independent of the main action state
   * machine above, so it keeps ticking while the boss is walking, attacking,
   * or (for a future boss that combined the two) casting/dashing. Returns
   * the world point a new zone should be placed at, or `null` on every tick
   * that isn't a placement tick.
   *
   * Placement is lead-predicted from the target's own frame-to-frame
   * displacement (there is no velocity field on `BossBrainCtx.target` to
   * read directly) so a zone lands ahead of a moving target — "where they
   * are heading, not exactly where they are". A near-stationary target
   * (estimated speed under `GROUND_ZONE_MIN_LEAD_M` worth of lead) instead
   * gets a fixed offset away from the boss, so a zone can never land exactly
   * underfoot regardless of how the target is moving.
   *
   * @param {number} dt
   * @param {{self:{x:number,z:number}, target:{x:number,z:number,dist:number}, activeZones:number}} ctx
   * @param {object} mech `def.mechanic` (kind 'groundDenial').
   * @returns {{x:number,z:number}|null}
   */
  _tickGroundDenial(dt, ctx, mech) {
    let leadX = 0;
    let leadZ = 0;
    if (this._prevTargetX !== null && dt > 1e-6) {
      const vx = (ctx.target.x - this._prevTargetX) / dt;
      const vz = (ctx.target.z - this._prevTargetZ) / dt;
      leadX = vx * GROUND_ZONE_LEAD_S;
      leadZ = vz * GROUND_ZONE_LEAD_S;
    }
    this._prevTargetX = ctx.target.x;
    this._prevTargetZ = ctx.target.z;

    this._zoneCooldown = Math.max(0, this._zoneCooldown - dt);
    if (this._zoneCooldown > 0 || ctx.activeZones >= mech.maxZones) return null;
    // Start-to-start cadence, same convention as casting/dashing above.
    this._zoneCooldown = mech.everyS;

    if (Math.hypot(leadX, leadZ) < GROUND_ZONE_MIN_LEAD_M) {
      const dx = ctx.target.x - ctx.self.x;
      const dz = ctx.target.z - ctx.self.z;
      const d = Math.hypot(dx, dz) || 1;
      leadX = (dx / d) * GROUND_ZONE_MIN_LEAD_M;
      leadZ = (dz / d) * GROUND_ZONE_MIN_LEAD_M;
    }
    return { x: ctx.target.x + leadX, z: ctx.target.z + leadZ };
  }

  /**
   * Steering direction for the walk branch. Melee (and a ranged boss with no
   * `keepDistance`) returns a unit vector straight at the target, unchanged
   * from the original patapim-only behaviour. A ranged boss with
   * `def.keepDistance` instead returns a vector whose *magnitude* (not just
   * direction) encodes "how urgently to close or open the distance" — 0 right
   * at `keepDistance`, ramping to ±1 (full speed in/out) over
   * `RANGED_STANDOFF_EASE_M` — so `game/Boss.js` can apply it directly as a
   * fraction of `def.speed` instead of always moving at full speed.
   *
   * @param {{self:{x:number,z:number}, target:{x:number,z:number,dist:number}}} ctx
   * @param {object} def
   * @returns {{x:number,z:number}|null} `null` when already exactly on the target (walk would be a degenerate zero-length direction — the caller reports `idle` instead).
   */
  _steer(ctx, def) {
    const dx = ctx.target.x - ctx.self.x;
    const dz = ctx.target.z - ctx.self.z;
    const d = Math.hypot(dx, dz);
    if (d <= 1e-6) return null;
    const nx = dx / d;
    const nz = dz / d;
    if (def.kind === 'ranged' && def.keepDistance !== undefined) {
      const frac = clamp((d - def.keepDistance) / RANGED_STANDOFF_EASE_M, -1, 1);
      return { x: nx * frac, z: nz * frac };
    }
    return { x: nx, z: nz };
  }

  /**
   * @param {number} dt
   * @param {import('./types.js').BossBrainCtx & {hpFrac?:number, activeZones?:number}} ctx `hpFrac`
   *   is only read for a `phases` mechanic; `activeZones` only for `groundDenial`. Both are
   *   `undefined`-safe to omit for every other boss (and every existing call site/test).
   * @returns {BossBrainResult}
   */
  update(dt, ctx) {
    const def = this._def;
    const mech = def.mechanic;

    // Phase latch first: `speedMul`/`cooldownMul`/`adds`/`enrage` below feed
    // straight into this tick's movement and attack-cooldown numbers, so
    // they must be current before either is computed.
    let speedMul = 1;
    let cooldownMul = 1;
    let addsAllowed = true;
    let enraged = false;
    if (mech?.kind === 'phases') {
      this._latchPhase(ctx.hpFrac);
      const phase = mech.phases[this._phaseIndex];
      speedMul = phase.speedMul ?? 1;
      cooldownMul = phase.cooldownMul ?? 1;
      addsAllowed = !!phase.adds;
      enraged = !!phase.enrage;
    }

    // Independent of everything else below — see `_tickGroundDenial`'s doc
    // comment for why this isn't folded into the action state machine.
    const groundZone = mech?.kind === 'groundDenial' ? this._tickGroundDenial(dt, ctx, mech) : null;

    if (mech?.kind === 'dash') {
      const dashResult = this._tickDash(dt, ctx, mech);
      if (dashResult) return { ...dashResult, groundZone, speedMul, enraged };
    }

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
      return {
        action: 'cast', moveDir: null, spawnAdd, castProgress: progress,
        dash: null, groundZone, speedMul, enraged,
      };
    }

    this._castCooldown = Math.max(0, this._castCooldown - dt);
    // `addsAllowed` gates only the *start* of a new cast, not an
    // already-in-progress one above — assassino's `adds` flag only ever
    // turns on (phases are forward-only), so there's no case where a cast
    // already underway would need to be cut short mid-way.
    if (addsAllowed && this._castCooldown <= 0 && ctx.addsAlive < def.maxAdds) {
      this._casting = true;
      this._castElapsed = 0;
      this._castSpawnedThisCast = false;
      this._castCooldown = def.addEveryS;
      return {
        action: 'cast', moveDir: null, spawnAdd: false, castProgress: 0,
        dash: null, groundZone, speedMul, enraged,
      };
    }

    if (ctx.target.dist <= def.range && this._attackCooldown <= 0) {
      this._attackCooldown = def.cooldown * cooldownMul;
      return {
        action: 'attack', moveDir: null, spawnAdd: false, castProgress: 0,
        dash: null, groundZone, speedMul, enraged,
      };
    }

    const moveDir = this._steer(ctx, def);
    if (!moveDir) {
      return {
        action: 'idle', moveDir: null, spawnAdd: false, castProgress: 0,
        dash: null, groundZone, speedMul, enraged,
      };
    }
    return {
      action: 'walk', moveDir, spawnAdd: false, castProgress: 0,
      dash: null, groundZone, speedMul, enraged,
    };
  }
}

/**
 * `core/bossBrain.js#update`'s return shape (extends the original
 * patapim-only shape documented on `BossBrainResult` in `core/types.js` —
 * not edited here per this change's file scope, so the additions are
 * documented here instead).
 * @typedef {object} BossBrainResult
 * @property {'walk'|'cast'|'attack'|'idle'|'dash'} action
 * @property {{x:number, z:number}|null} moveDir Unit vector for melee/'walk'; a `[-1,1]`-scaled
 *   fraction of `def.speed` per axis for a ranged boss holding `keepDistance` (see `_steer`); the
 *   locked dash direction (unit vector) while `action === 'dash'` and `dash.phase === 'charging'`;
 *   `null` otherwise.
 * @property {boolean} spawnAdd `true` on exactly one tick per cast (at 60% `castProgress`).
 * @property {number} castProgress 0..1 through the current cast; `0` when `action !== 'cast'`.
 * @property {{phase:'windup'|'charging', progress:number, dir:{x:number,z:number}}|null} dash
 *   Non-null only while `action === 'dash'`.
 * @property {{x:number,z:number}|null} groundZone Non-null on exactly the tick a new ground-denial
 *   zone should be placed there; `null` every other tick, and always `null` for a boss with no
 *   `groundDenial` mechanic.
 * @property {number} speedMul Current phase's movement speed multiplier (`1` for a boss with no
 *   `phases` mechanic).
 * @property {boolean} enraged Current phase's `enrage` flag (`false` for a boss with no `phases`
 *   mechanic, or before the first phase that sets it).
 */
