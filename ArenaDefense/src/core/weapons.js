/**
 * Pure weapon logic: roster lookup, and the spread/pellet maths that turns one
 * aim direction into the directions actually fired.
 *
 * Weapon *stats* live in `config.js` (`player.weapons`), shaped like
 * `config.turrets` — an `order` array plus a `types` record — so the same
 * "resolve a def by id, iterate `order` for the UI" pattern works for both.
 *
 * Randomness is an injected `rand` rather than an import. Two reasons: it makes
 * `spreadDirs` deterministic under `node --test`, and it keeps spread off
 * `core/rng.js`'s seeded stream. That stream exists so a seed reproduces a
 * run's spawns; drawing from it once per pellet would make wave composition
 * depend on how much the player shot. Callers pass `Math.random`, the same
 * source `Effects.js` already uses for cosmetic scatter.
 */

const DEG2RAD = Math.PI / 180;

/**
 * @param {import('./types.js').GameConfig} cfg
 * @returns {string[]} Weapon ids in display order.
 */
export function weaponIds(cfg) {
  return cfg.player.weapons.order;
}

/**
 * @param {string} id
 * @param {import('./types.js').GameConfig} cfg
 * @returns {object|null} The weapon def, or `null` for an unknown id — callers
 *   fall back to `cfg.player.defaultWeapon` rather than throwing, so a stale
 *   id in a player's saved preferences can never break their boot.
 */
export function resolveWeapon(id, cfg) {
  const def = cfg.player.weapons.types[id];
  return def && cfg.player.weapons.order.includes(id) ? def : null;
}

/**
 * The weapon a session should start with: the requested one when it exists,
 * otherwise the configured default.
 *
 * @param {string|null|undefined} id
 * @param {import('./types.js').GameConfig} cfg
 * @returns {string} A valid weapon id.
 */
export function coerceWeaponId(id, cfg) {
  return resolveWeapon(id, cfg) ? /** @type {string} */ (id) : cfg.player.defaultWeapon;
}

/**
 * Steps `delta` places through `order`, wrapping — for next/previous weapon
 * cycling.
 *
 * @param {string} id
 * @param {string[]} order
 * @param {number} delta
 * @returns {string}
 */
export function nextWeapon(id, order, delta) {
  const at = order.indexOf(id);
  if (at < 0) return order[0];
  const n = order.length;
  return order[(((at + delta) % n) + n) % n];
}

/**
 * One direction per pellet, scattered uniformly across the weapon's spread
 * cone. A `spreadDeg` of 0 (or a single pellet on a pinpoint weapon) returns
 * the aim direction itself, so a sniper is exactly as accurate as the crosshair
 * promises.
 *
 * Vectors are plain `{x,y,z}` — `core/` may not import three.js.
 *
 * @param {{x:number,y:number,z:number}} dir Aim direction; need not be normalised.
 * @param {number} spreadDeg Half-angle of the cone, in degrees.
 * @param {number} pellets How many directions to produce (>= 1).
 * @param {() => number} rand Returns [0,1). Injected for testability.
 * @returns {{x:number,y:number,z:number}[]} `pellets` unit vectors.
 */
export function spreadDirs(dir, spreadDeg, pellets, rand) {
  const n = Math.max(1, Math.floor(pellets));
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };

  if (!(spreadDeg > 0)) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ ...d });
    return out;
  }

  // Orthonormal basis around `d`. The reference axis is chosen to be the one
  // `d` is least aligned with, so the cross product is never near-degenerate.
  const ref = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = normalise(cross(d, ref));
  const v = cross(d, u);

  const maxR = Math.tan(spreadDeg * DEG2RAD);
  const out = [];
  for (let i = 0; i < n; i++) {
    // sqrt() of a uniform draw spreads pellets evenly over the cone's disc
    // rather than clumping them at the centre.
    const r = Math.sqrt(rand()) * maxR;
    const a = rand() * Math.PI * 2;
    const ox = Math.cos(a) * r;
    const oy = Math.sin(a) * r;
    out.push(normalise({
      x: d.x + u.x * ox + v.x * oy,
      y: d.y + u.y * ox + v.y * oy,
      z: d.z + u.z * ox + v.z * oy,
    }));
  }
  return out;
}

/**
 * @param {{x:number,y:number,z:number}} a
 * @param {{x:number,y:number,z:number}} b
 * @returns {{x:number,y:number,z:number}}
 */
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * @param {{x:number,y:number,z:number}} a
 * @returns {{x:number,y:number,z:number}}
 */
function normalise(a) {
  const len = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}
