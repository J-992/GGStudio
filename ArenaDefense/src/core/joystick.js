/**
 * Floating-stick input shaping — JS port of
 * `zombie-motorworks/src/core/joystick.ts` (`readJoystick`, `clampStickOffset`,
 * `DEFAULT_JOYSTICK_CONFIG`). Only the pieces ArenaDefense's look/move stick
 * needs are ported; the vehicle-steering helpers in the original
 * (`driveFromJoystick`, `driveTowardHeading`, `wrapAngle`) do not apply here.
 */

/** @type {import('./types.js').JoystickConfig} A mobile-sized response curve with a forgiving centre and outer rim. */
export const DEFAULT_JOYSTICK_CONFIG = {
  radiusPx: 56,
  deadzone: 0.18,
  saturation: 0.92,
};

/** @type {import('./types.js').JoystickVector} A stable zero object keeps invalid pointer data out of downstream logic. */
export const NEUTRAL_JOYSTICK = {
  x: 0,
  y: 0,
  magnitude: 0,
  angle: 0,
  active: false,
};

const MAX_DEADZONE = 0.9;
const MIN_CONFIG_GAP = Number.EPSILON;

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {number} value
 * @param {number} fallback
 * @returns {number}
 */
function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * @param {Partial<import('./types.js').JoystickConfig>} config
 * @returns {import('./types.js').JoystickConfig}
 */
function resolveConfig(config) {
  const merged = { ...DEFAULT_JOYSTICK_CONFIG, ...config };
  const radiusPx = Math.max(MIN_CONFIG_GAP, finiteOr(merged.radiusPx, DEFAULT_JOYSTICK_CONFIG.radiusPx));
  const deadzone = clamp(finiteOr(merged.deadzone, DEFAULT_JOYSTICK_CONFIG.deadzone), 0, MAX_DEADZONE);
  const requestedSaturation = clamp(finiteOr(merged.saturation, DEFAULT_JOYSTICK_CONFIG.saturation), 0, 1);
  const saturation = Math.max(deadzone + MIN_CONFIG_GAP, requestedSaturation);
  return { radiusPx, deadzone, saturation };
}

/**
 * Turns pointer travel into a radial stick reading. The deadzone is rescaled
 * away instead of merely cut off, avoiding a control jump as a resting thumb
 * begins to move; saturation similarly reserves the outer rim for an easy,
 * dependable full input.
 *
 * @param {number} originX
 * @param {number} originY
 * @param {number} pointerX
 * @param {number} pointerY
 * @param {Partial<import('./types.js').JoystickConfig>} [config]
 * @returns {import('./types.js').JoystickVector}
 */
export function readJoystick(originX, originY, pointerX, pointerY, config = {}) {
  if (![originX, originY, pointerX, pointerY].every(Number.isFinite)) {
    return NEUTRAL_JOYSTICK;
  }

  const { radiusPx, deadzone, saturation } = resolveConfig(config);
  const dx = pointerX - originX;
  const screenDy = pointerY - originY;
  const distance = Math.hypot(dx, screenDy);
  if (distance === 0 || !Number.isFinite(distance)) return NEUTRAL_JOYSTICK;

  const rawMagnitude = Math.min(1, distance / radiusPx);
  if (rawMagnitude <= deadzone) return NEUTRAL_JOYSTICK;

  const magnitude = rawMagnitude >= saturation ? 1 : (rawMagnitude - deadzone) / (saturation - deadzone);
  const directionX = dx === 0 ? 0 : dx / distance;
  const directionY = screenDy === 0 ? 0 : -screenDy / distance;

  return {
    x: directionX * magnitude,
    y: directionY * magnitude,
    magnitude,
    angle: Math.atan2(directionY, directionX),
    active: true,
  };
}

/**
 * Knob offset in CSS pixels, kept on the visual rim even when the player's
 * finger travels farther so presentation never implies extra usable input.
 *
 * @param {number} originX
 * @param {number} originY
 * @param {number} pointerX
 * @param {number} pointerY
 * @param {number} [radiusPx]
 * @returns {{ x: number, y: number }}
 */
export function clampStickOffset(originX, originY, pointerX, pointerY, radiusPx = DEFAULT_JOYSTICK_CONFIG.radiusPx) {
  if (![originX, originY, pointerX, pointerY, radiusPx].every(Number.isFinite) || radiusPx <= 0) {
    return { x: 0, y: 0 };
  }

  const x = pointerX - originX;
  const y = pointerY - originY;
  const distance = Math.hypot(x, y);
  if (distance === 0 || !Number.isFinite(distance)) return { x: 0, y: 0 };
  if (distance <= radiusPx) return { x, y };

  return { x: (x / distance) * radiusPx, y: (y / distance) * radiusPx };
}
