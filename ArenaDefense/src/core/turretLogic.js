/**
 * Pure turret math: per-level stats, upgrade/repair costs, targeting and
 * fire cadence. Nothing here touches three.js, the DOM, or `game/Turrets.js`
 * itself — `Turrets.js` (impure) drives the 3D scene and calls into these
 * functions with plain data, exactly like every other `src/core` module (see
 * `../../AGENTS.md`).
 *
 * A "turret" here is a plain, mutable record — not a class — shaped like
 * `{ slotId, type, level, hp, hpMax, x, z, alive, cooldown }`. `cooldown` is
 * owned and mutated by {@link fireReady} only; every other field is read-only
 * from this module's point of view.
 */

/**
 * Merges `cfg.turrets.types[type]`'s base stats with `levels[level]`'s
 * overrides. `level` is clamped to `[0, levels.length - 1]` so a stray
 * out-of-range level (should never happen, but this is the boundary between
 * game state and pure math) degrades to the nearest real level instead of
 * reading `undefined`.
 *
 * `splash`/`slow`/`slowDurS` are only present on the returned object when the
 * type actually has them (cannon: `splash`; tesla: `slow`+`slowDurS`) — a gun
 * turret's stats never carry a `splash` key at all, not even `undefined`.
 *
 * @param {string} type One of `cfg.turrets.order` (`'gun'|'tesla'|'cannon'`).
 * @param {number} level 0-based turret level.
 * @param {import('./types.js').GameConfig} cfg
 * @returns {{dmg:number, rate:number, range:number, splash?:number, slow?:number, slowDurS?:number}}
 */
export function statsFor(type, level, cfg) {
  const def = cfg.turrets.types[type];
  if (!def) throw new Error(`turretLogic.statsFor: unknown turret type "${type}"`);

  const clampedLevel = Math.max(0, Math.min(level, def.levels.length - 1));
  const override = def.levels[clampedLevel] ?? {};

  /** @param {string} key */
  const pick = (key) => (override[key] !== undefined ? override[key] : def[key]);

  const stats = {
    dmg: pick('dmg'),
    rate: pick('rate'),
    range: pick('range'),
  };
  if (def.splash !== undefined || override.splash !== undefined) stats.splash = pick('splash');
  if (def.slow !== undefined || override.slow !== undefined) stats.slow = pick('slow');
  if (def.slowDurS !== undefined || override.slowDurS !== undefined) stats.slowDurS = pick('slowDurS');
  return stats;
}

/**
 * Energy cost to go from `level` to `level + 1`.
 *
 * @param {string} type
 * @param {number} level Current (pre-upgrade) level.
 * @param {import('./types.js').GameConfig} cfg
 * @returns {number|undefined} `undefined` when `level` is already the max level.
 */
export function upgradeCost(type, level, cfg) {
  const def = cfg.turrets.types[type];
  if (!def) throw new Error(`turretLogic.upgradeCost: unknown turret type "${type}"`);
  return def.upgradeCost[level];
}

/**
 * @param {{hp:number, hpMax:number}} turret
 * @param {import('./types.js').GameConfig} cfg
 * @returns {number} 0 when already at full health.
 */
export function repairCost(turret, cfg) {
  const missing = turret.hpMax - turret.hp;
  if (missing <= 0) return 0;
  const { costPerHpMissing, minCost } = cfg.turrets.repair;
  return Math.max(minCost, Math.ceil(missing * costPerHpMissing));
}

/**
 * Picks the best target for a turret out of a flat enemy-position list, or
 * `-1` when nothing is in range.
 *
 * - `gun`/`tesla`: nearest enemy within `stats.range`.
 * - `cannon`: among enemies within `stats.range`, the one with the most
 *   *other* enemies within `stats.splash` of it (so a shot lands on the
 *   densest cluster rather than whichever target happens to be closest);
 *   ties broken by nearest-to-turret.
 *
 * @param {{type:string, x:number, z:number}} turret
 * @param {{x:number, z:number}[]} enemies Sparse-safe: `null`/`undefined` entries are skipped (a dead slot in a pooled array).
 * @param {{range:number, splash?:number}} stats
 * @returns {number} Index into `enemies`, or `-1`.
 */
export function pickTarget(turret, enemies, stats) {
  if (!enemies || enemies.length === 0) return -1;

  /** @type {{i:number, dist:number}[]} */
  const inRange = [];
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e == null) continue;
    const dist = Math.hypot(e.x - turret.x, e.z - turret.z);
    if (dist <= stats.range) inRange.push({ i, dist });
  }
  if (inRange.length === 0) return -1;

  if (turret.type === 'cannon' && stats.splash) {
    let bestIdx = -1;
    let bestCount = -1;
    let bestDist = Infinity;
    for (const cand of inRange) {
      const e = enemies[cand.i];
      let count = 0;
      for (let j = 0; j < enemies.length; j++) {
        if (j === cand.i) continue;
        const other = enemies[j];
        if (other == null) continue;
        if (Math.hypot(other.x - e.x, other.z - e.z) <= stats.splash) count++;
      }
      if (count > bestCount || (count === bestCount && cand.dist < bestDist)) {
        bestCount = count;
        bestDist = cand.dist;
        bestIdx = cand.i;
      }
    }
    return bestIdx;
  }

  let bestIdx = inRange[0].i;
  let bestDist = inRange[0].dist;
  for (const cand of inRange) {
    if (cand.dist < bestDist) {
      bestDist = cand.dist;
      bestIdx = cand.i;
    }
  }
  return bestIdx;
}

/**
 * Advances a turret's fire cooldown by `dt` and reports whether it is ready
 * to fire this call. On a ready call the cooldown is topped back up by
 * `1 / stats.rate` (added, not reset to it outright, so a `dt` that overshoots
 * the cooldown boundary doesn't lose the remainder — cadence stays accurate
 * under a fixed step even when `dt` doesn't divide `1/rate` evenly).
 *
 * Mutates `turret.cooldown` (initialised to `0` — i.e. ready — the first time
 * this is called on a fresh record with no `cooldown` field yet).
 *
 * @param {{cooldown?:number}} turret
 * @param {number} dt
 * @param {{rate:number}} stats
 * @returns {boolean}
 */
export function fireReady(turret, dt, stats) {
  turret.cooldown = (turret.cooldown ?? 0) - dt;
  if (turret.cooldown > 0) return false;
  turret.cooldown += 1 / stats.rate;
  return true;
}

/**
 * Caps one turret hit at `cfg.turrets.maxDamageFracPerHit` of the target's max
 * HP, so a turret always needs at least `1 / maxDamageFracPerHit` shots (3 at
 * the configured 1/3) to finish anything — however far its damage has been
 * upgraded past a weak enemy's health pool. The cap is relative to *max* HP
 * (not current), so it doesn't stop the last of those shots from killing, and
 * it leaves a turret's damage untouched against anything with enough HP not to
 * be capped in the first place (the boss, `tungtung`).
 *
 * @param {number} dmg Raw per-shot damage from {@link statsFor}.
 * @param {number} hpMax Target's max HP (already wave-scaled by `hpMul`).
 * @param {import('./types.js').GameConfig} cfg
 * @returns {number} `dmg`, clamped.
 */
export function turretHitDamage(dmg, hpMax, cfg) {
  const frac = cfg.turrets.maxDamageFracPerHit;
  if (!(frac > 0) || !(hpMax > 0)) return dmg;
  return Math.min(dmg, hpMax * frac);
}
