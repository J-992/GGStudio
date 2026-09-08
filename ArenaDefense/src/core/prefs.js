/**
 * Device preferences: look sensitivity, invert-look, the FPS readout, and the
 * weapon the player last chose.
 *
 * These deliberately do NOT live in `core/storage.js`'s save shape. That shape
 * is exactly `{coins, bestWave, unlocks}` and `test/storage.test.js` asserts
 * the persisted key set matches it exactly — because it is *run progress*.
 * Preferences belong to the device, not the run, which is the same reasoning
 * that put the mute flag under its own key (see `platform/storage.js`).
 *
 * Pure: sanitising happens here, reading and writing happens in
 * `platform/storage.js`.
 */

/** @type {{sensMouse:number|null, sensTouch:number|null, invertY:boolean, showFps:boolean, weapon:string|null}} */
export const DEFAULT_PREFS = Object.freeze({
  // `null` means "use the config default" — storing the resolved number
  // instead would freeze a player's sensitivity at whatever the config said
  // the day they first played, so a later retune would never reach them.
  sensMouse: null,
  sensTouch: null,
  invertY: false,
  showFps: false,
  weapon: null,
});

// Multipliers on the configured base sensitivity, so the stored value stays
// meaningful if `config.player.lookSens*` is ever retuned.
export const SENS_MIN = 0.25;
export const SENS_MAX = 3;

/**
 * @param {number} value
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * @param {any} value
 * @returns {number|null} A finite multiplier inside [SENS_MIN, SENS_MAX], or `null`.
 */
function sanitizeSens(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return clamp(value, SENS_MIN, SENS_MAX);
}

/**
 * Coerces anything at all — a partial object, a stale schema, `null`, a string
 * that happened to parse — into a complete, safe prefs object. Never throws:
 * corrupted preferences must not be able to stop the game booting.
 *
 * @param {any} raw
 * @returns {{sensMouse:number|null, sensTouch:number|null, invertY:boolean, showFps:boolean, weapon:string|null}}
 */
export function sanitizePrefs(raw) {
  const src = (raw !== null && typeof raw === 'object') ? raw : {};
  return {
    sensMouse: sanitizeSens(src.sensMouse),
    sensTouch: sanitizeSens(src.sensTouch),
    invertY: src.invertY === true,
    showFps: src.showFps === true,
    // Validated against the roster by `core/weapons.js#coerceWeaponId` at the
    // point of use — this layer only guarantees the type.
    weapon: typeof src.weapon === 'string' && src.weapon !== '' ? src.weapon : null,
  };
}

/**
 * Resolves a stored sensitivity multiplier against the configured base.
 *
 * @param {number|null} multiplier
 * @param {number} base `config.player.lookSensMouse` or `lookSensTouch`.
 * @returns {number}
 */
export function effectiveSens(multiplier, base) {
  return multiplier === null ? base : base * multiplier;
}
