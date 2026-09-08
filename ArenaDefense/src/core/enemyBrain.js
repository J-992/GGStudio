/**
 * Pure enemy AI: target selection, seek+separation steering, and attack
 * cooldown gating. No three.js, DOM, or randomness — see `../../AGENTS.md`.
 * Consumed by `game/Enemies.js`, which owns the SoA enemy pool and calls
 * these once per alive enemy per fixed step with plain-object snapshots of
 * that enemy's current state.
 */

/**
 * @param {number} ax
 * @param {number} az
 * @param {number} bx
 * @param {number} bz
 * @returns {number}
 */
function dist(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
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

/**
 * Melee: nearest of {player, alive turrets}. Ranged: the player if within
 * `preferPlayerRange`, else the nearest turret, else the player (so a ranged
 * enemy with no turrets on the field still has a target).
 *
 * @param {{x:number, z:number, type:string}} enemy
 * @param {{x:number, z:number}} player
 * @param {{id?:number, slotId?:number, x:number, z:number, alive?:boolean}[]} turrets
 * @param {import('./types.js').GameConfig} cfg
 * @returns {{kind:'player'|'turret', id:number|null, x:number, z:number}}
 */
export function chooseTarget(enemy, player, turrets, cfg) {
  const typeDef = cfg.enemies.types[enemy.type];
  const aliveTurrets = turrets.filter((t) => t.alive !== false);

  const playerTarget = { kind: /** @type {const} */ ('player'), id: null, x: player.x, z: player.z };

  if (typeDef.kind === 'melee') {
    let best = playerTarget;
    let bestDist = dist(enemy.x, enemy.z, player.x, player.z);
    for (const t of aliveTurrets) {
      const d = dist(enemy.x, enemy.z, t.x, t.z);
      if (d < bestDist) {
        bestDist = d;
        best = { kind: 'turret', id: t.slotId ?? t.id ?? null, x: t.x, z: t.z };
      }
    }
    return best;
  }

  // Ranged.
  const playerDist = dist(enemy.x, enemy.z, player.x, player.z);
  if (typeDef.preferPlayerRange !== undefined && playerDist <= typeDef.preferPlayerRange) {
    return playerTarget;
  }
  if (aliveTurrets.length > 0) {
    let best = aliveTurrets[0];
    let bestDist = dist(enemy.x, enemy.z, best.x, best.z);
    for (const t of aliveTurrets) {
      const d = dist(enemy.x, enemy.z, t.x, t.z);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return { kind: 'turret', id: best.slotId ?? best.id ?? null, x: best.x, z: best.z };
  }
  return playerTarget;
}

/**
 * Seek toward `target` at `typeDef.speed` (a ranged enemy holds
 * `typeDef.keepDistance`, backing off when closer), plus separation from
 * `neighbours` within `cfg.enemies.separationRadius` scaled by
 * `separationForce`. Result clamped to `typeDef.speed`.
 *
 * @param {{x:number, z:number}} enemy
 * @param {{x:number, z:number}} target
 * @param {{x:number, z:number}[]} neighbours
 * @param {import('./types.js').GameConfig} cfg
 * @param {import('./types.js').EnemyTypeDef} typeDef
 * @returns {{vx:number, vz:number}}
 */
export function steer(enemy, target, neighbours, cfg, typeDef) {
  const dx = target.x - enemy.x;
  const dz = target.z - enemy.z;
  const d = Math.hypot(dx, dz);

  let seekX = 0;
  let seekZ = 0;
  if (d > 1e-6) {
    const nx = dx / d;
    const nz = dz / d;
    if (typeDef.kind === 'ranged' && typeDef.keepDistance !== undefined) {
      // Positive (approach) when farther than keepDistance, negative (back
      // off) when closer, ~0 right at keepDistance.
      const desired = clamp(d - typeDef.keepDistance, -typeDef.speed, typeDef.speed);
      seekX = nx * desired;
      seekZ = nz * desired;
    } else {
      seekX = nx * typeDef.speed;
      seekZ = nz * typeDef.speed;
    }
  }

  let sepX = 0;
  let sepZ = 0;
  const sepRadius = cfg.enemies.separationRadius;
  const sepForce = cfg.enemies.separationForce;
  for (const n of neighbours) {
    const ndx = enemy.x - n.x;
    const ndz = enemy.z - n.z;
    const nd = Math.hypot(ndx, ndz);
    if (nd < 1e-6) {
      // Exactly coincident enemies can't be pushed apart along a normalized
      // direction (division by zero) — nudge along a fixed axis instead.
      // Deterministic, and any nonzero push separates them over the next
      // few steps once they're no longer coincident.
      sepX += sepForce;
      continue;
    }
    if (nd < sepRadius) {
      const push = (1 - nd / sepRadius) * sepForce;
      sepX += (ndx / nd) * push;
      sepZ += (ndz / nd) * push;
    }
  }

  let vx = seekX + sepX;
  let vz = seekZ + sepZ;
  const speed = typeDef.speed;
  const vLen = Math.hypot(vx, vz);
  if (vLen > speed && vLen > 1e-6) {
    const scale = speed / vLen;
    vx *= scale;
    vz *= scale;
  }
  return { vx, vz };
}

/**
 * @param {{cooldown:number}} enemy
 * @param {number} distToTarget
 * @param {import('./types.js').EnemyTypeDef} typeDef
 * @returns {boolean}
 */
export function attackReady(enemy, distToTarget, typeDef) {
  return enemy.cooldown <= 0 && distToTarget <= typeDef.range;
}

/**
 * Does not mutate `enemy` — returns the new cooldown value for the caller to
 * store back (the SoA pool in `Enemies.js` writes it into a typed array).
 *
 * @param {{cooldown:number}} enemy
 * @param {number} dt
 * @returns {number}
 */
export function tickCooldown(enemy, dt) {
  return Math.max(0, enemy.cooldown - dt);
}

/**
 * @param {import('./types.js').EnemyTypeDef} typeDef
 * @param {number} hpMul
 * @returns {number}
 */
export function hpFor(typeDef, hpMul) {
  return typeDef.hp * hpMul;
}

/**
 * Knockback impulse speed for one hit, in m/s. Scales with damage relative
 * to `cfg.enemies.knockback.refDmg` and with the type's own
 * `knockbackScale` (heavier enemies barely budge), clamped so a cannon
 * shell can't launch a shambler across the arena.
 *
 * @param {number} dmg
 * @param {import('./types.js').EnemyTypeDef} typeDef
 * @param {import('./types.js').GameConfig} cfg
 * @returns {number} >= 0.
 */
export function knockbackSpeed(dmg, typeDef, cfg) {
  const k = cfg.enemies.knockback;
  const scale = typeDef?.knockbackScale ?? 1;
  if (scale <= 0 || k.refDmg <= 0) return 0;
  const raw = k.speed * (Math.max(0, dmg) / k.refDmg) * scale;
  return clamp(raw, 0, k.maxSpeed * scale);
}

/**
 * Exponential decay of an in-flight knockback velocity, snapping to a dead
 * stop below `stopSpeed` so an enemy never creeps on a hit long past.
 *
 * @param {number} vx
 * @param {number} vz
 * @param {number} dt
 * @param {import('./types.js').GameConfig} cfg
 * @returns {{vx:number, vz:number}}
 */
export function decayKnockback(vx, vz, dt, cfg) {
  const k = cfg.enemies.knockback;
  const factor = k.decayS > 0 ? Math.exp(-Math.max(0, dt) / k.decayS) : 0;
  const nx = vx * factor;
  const nz = vz * factor;
  if (Math.hypot(nx, nz) < k.stopSpeed) return { vx: 0, vz: 0 };
  return { vx: nx, vz: nz };
}

/**
 * How much of its own steering an enemy keeps while being knocked back: 1
 * when untouched, falling towards `1 - staggerDamp` at full knockback. This
 * is the "stagger" — a hit visibly interrupts the advance instead of just
 * sliding the enemy sideways while it keeps walking.
 *
 * @param {number} kickSpeed Current knockback speed (m/s).
 * @param {import('./types.js').EnemyTypeDef} typeDef
 * @param {import('./types.js').GameConfig} cfg
 * @returns {number} In `[1 - staggerDamp, 1]`.
 */
export function staggerFactor(kickSpeed, typeDef, cfg) {
  return 1 - cfg.enemies.knockback.staggerDamp * knockbackIntensity(kickSpeed, typeDef, cfg);
}

/**
 * How hard an enemy is currently being knocked back, normalized against the
 * hardest hit its type can take: 0 when untouched, 1 at a full-strength
 * impulse. The one place the "how hurt does this look" ramp is defined —
 * tilt, stagger and flinch-squash all read from it.
 *
 * @param {number} kickSpeed Current knockback speed (m/s).
 * @param {import('./types.js').EnemyTypeDef} typeDef
 * @param {import('./types.js').GameConfig} cfg
 * @returns {number} 0..1.
 */
export function knockbackIntensity(kickSpeed, typeDef, cfg) {
  const max = cfg.enemies.knockback.maxSpeed * (typeDef?.knockbackScale ?? 1);
  if (max <= 0) return 0;
  return clamp(Math.max(0, kickSpeed) / max, 0, 1);
}

/**
 * Lean-back angle (radians) for a body taking a hit, proportional to how
 * hard it is currently being pushed. `game/Enemies.js` tilts the voxel
 * instance around the axis perpendicular to the knockback direction.
 *
 * @param {number} kickSpeed
 * @param {import('./types.js').EnemyTypeDef} typeDef
 * @param {import('./types.js').GameConfig} cfg
 * @returns {number} In `[0, cfg.enemies.knockback.tiltRad]`.
 */
export function knockbackTilt(kickSpeed, typeDef, cfg) {
  return cfg.enemies.knockback.tiltRad * knockbackIntensity(kickSpeed, typeDef, cfg);
}
