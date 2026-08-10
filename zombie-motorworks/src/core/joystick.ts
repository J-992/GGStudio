/**
 * Floating-stick input shaping shared by every driving mode.
 *
 * Keeping the geometry and drive interpretation here lets touch UI remain a
 * thin Adapter: it supplies CSS-pixel positions, while the runtime receives
 * the same bounded controls regardless of how the stick is drawn.
 */

/** The physical and response envelope of a floating joystick. */
export interface JoystickConfig {
  /** Radius in px at which the stick reads full deflection. */
  readonly radiusPx: number;
  /** Fraction of the radius (0..1) kept neutral to prevent thumb jitter. */
  readonly deadzone: number;
  /**
   * Fraction of the radius (0..1) at which output reaches full magnitude.
   * Leaving travel at the rim makes full throttle reliable under a moving thumb.
   */
  readonly saturation: number;
}

/** A mobile-sized response curve with a forgiving centre and outer rim. */
export const DEFAULT_JOYSTICK_CONFIG: JoystickConfig = {
  radiusPx: 56,
  deadzone: 0.18,
  saturation: 0.92,
};

/** A bounded stick reading whose axes already use vehicle-facing directions. */
export interface JoystickVector {
  /** -1..1, positive = right. */
  readonly x: number;
  /** -1..1, positive = up/forward (screen-up, so already y-flipped). */
  readonly y: number;
  /** 0..1 radial deflection after deadzone and saturation shaping. */
  readonly magnitude: number;
  /** Radians from right toward up; irrelevant while magnitude is zero. */
  readonly angle: number;
  /** Escaping the deadzone, rather than pointer-down alone, starts driving. */
  readonly active: boolean;
}

/** A stable zero object keeps invalid pointer data out of vehicle physics. */
export const NEUTRAL_JOYSTICK: JoystickVector = {
  x: 0,
  y: 0,
  magnitude: 0,
  angle: 0,
  active: false,
};

const MAX_DEADZONE = 0.9;
const MIN_CONFIG_GAP = Number.EPSILON;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function resolveConfig(config: Partial<JoystickConfig>): JoystickConfig {
  const merged = { ...DEFAULT_JOYSTICK_CONFIG, ...config };
  const radiusPx = Math.max(
    MIN_CONFIG_GAP,
    finiteOr(merged.radiusPx, DEFAULT_JOYSTICK_CONFIG.radiusPx),
  );
  const deadzone = clamp(
    finiteOr(merged.deadzone, DEFAULT_JOYSTICK_CONFIG.deadzone),
    0,
    MAX_DEADZONE,
  );
  const requestedSaturation = clamp(
    finiteOr(merged.saturation, DEFAULT_JOYSTICK_CONFIG.saturation),
    0,
    1,
  );
  const saturation = Math.max(
    deadzone + MIN_CONFIG_GAP,
    requestedSaturation,
  );

  return { radiusPx, deadzone, saturation };
}

/**
 * Turns pointer travel into a radial stick reading. The deadzone is rescaled
 * away instead of merely cut off, avoiding a control jump as a resting thumb
 * begins to move; saturation similarly reserves the outer rim for an easy,
 * dependable full input.
 */
export function readJoystick(
  originX: number,
  originY: number,
  pointerX: number,
  pointerY: number,
  config: Partial<JoystickConfig> = {},
): JoystickVector {
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

  const magnitude =
    rawMagnitude >= saturation
      ? 1
      : (rawMagnitude - deadzone) / (saturation - deadzone);
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
 */
export function clampStickOffset(
  originX: number,
  originY: number,
  pointerX: number,
  pointerY: number,
  radiusPx = DEFAULT_JOYSTICK_CONFIG.radiusPx,
): { x: number; y: number } {
  if (
    ![originX, originY, pointerX, pointerY, radiusPx].every(Number.isFinite) ||
    radiusPx <= 0
  ) {
    return { x: 0, y: 0 };
  }

  const x = pointerX - originX;
  const y = pointerY - originY;
  const distance = Math.hypot(x, y);
  if (distance === 0 || !Number.isFinite(distance)) return { x: 0, y: 0 };
  if (distance <= radiusPx) return { x, y };

  return { x: (x / distance) * radiusPx, y: (y / distance) * radiusPx };
}

/** Bounded drive controls ready for the Runtime Vehicle. */
export interface JoystickDrive {
  /** Forward motor demand, from 0 to 1. */
  readonly throttle: number;
  /** Reverse motor demand, from 0 to 1. */
  readonly reverse: number;
  /** Service-brake demand, from 0 to 1. */
  readonly brake: number;
  /** Steering demand, from full left (-1) to full right (1). */
  readonly steer: number;
}

const NEUTRAL_DRIVE: JoystickDrive = {
  throttle: 0,
  reverse: 0,
  brake: 0,
  steer: 0,
};

/**
 * Gives downward stick travel the keyboard's context-sensitive meaning:
 * braking while still rolling forward, then reverse once nearly stopped.
 * Auto-hold deliberately remains with the owning mode so it is applied once.
 */
export function driveFromJoystick(
  stick: JoystickVector,
  /** Signed vehicle-forward speed used to choose braking or reversing. */
  forwardSpeedMps: number,
  options: {
    /** Forward speed above which downward travel still means braking. */
    readonly reverseSpeedThresholdMps?: number;
    /** Direct multiplier for lateral travel before the final steering clamp. */
    readonly steerGain?: number;
  } = {},
): JoystickDrive {
  if (
    !Number.isFinite(stick.x) ||
    !Number.isFinite(stick.y) ||
    !Number.isFinite(forwardSpeedMps)
  ) {
    return NEUTRAL_DRIVE;
  }

  const reverseSpeedThresholdMps = finiteOr(
    options.reverseSpeedThresholdMps ?? 0.6,
    0.6,
  );
  const steerGain = finiteOr(options.steerGain ?? 1, 1);
  const x = clamp(stick.x, -1, 1);
  const y = clamp(stick.y, -1, 1);
  const steer = clamp(x * steerGain, -1, 1);

  if (y > 0) {
    return { throttle: y, reverse: 0, brake: 0, steer };
  }
  if (y < 0 && forwardSpeedMps > reverseSpeedThresholdMps) {
    return { throttle: 0, reverse: 0, brake: -y, steer };
  }
  if (y < 0) {
    return { throttle: 0, reverse: -y, brake: 0, steer };
  }
  if (steer !== 0) {
    return { throttle: 0, reverse: 0, brake: 0, steer };
  }
  return NEUTRAL_DRIVE;
}
