import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOYSTICK_CONFIG,
  NEUTRAL_JOYSTICK,
  clampStickOffset,
  driveFromJoystick,
  readJoystick,
  type JoystickVector,
} from '../src/core/joystick.ts';

describe('joystick reading', () => {
  it('stays neutral inside the deadzone and begins continuously at its edge', () => {
    const radiusPx = 100;
    const deadzone = 0.2;
    const config = { radiusPx, deadzone, saturation: 0.9 };

    expect(readJoystick(0, 0, 19, 0, config)).toBe(NEUTRAL_JOYSTICK);
    expect(readJoystick(0, 0, 20, 0, config)).toBe(NEUTRAL_JOYSTICK);

    const justOutside = readJoystick(0, 0, 20.001, 0, config);
    expect(justOutside.active).toBe(true);
    expect(justOutside.magnitude).toBeGreaterThan(0);
    expect(justOutside.magnitude).toBeLessThan(0.001);
  });

  it('saturates at the configured outer threshold and beyond the rim', () => {
    const config = { radiusPx: 100, deadzone: 0.2, saturation: 0.8 };

    expect(readJoystick(0, 0, 80, 0, config)).toMatchObject({
      x: 1,
      y: 0,
      magnitude: 1,
    });
    expect(readJoystick(0, 0, 95, 0, config).magnitude).toBe(1);

    const beyondRim = readJoystick(0, 0, 300, -400, config);
    expect(beyondRim.magnitude).toBe(1);
    expect(beyondRim.x).toBeCloseTo(0.6, 10);
    expect(beyondRim.y).toBeCloseTo(0.8, 10);
  });

  it('flips screen y so dragging upward produces positive forward input', () => {
    const reading = readJoystick(50, 50, 50, 0, {
      radiusPx: 50,
      deadzone: 0,
      saturation: 1,
    });

    expect(reading.y).toBe(1);
    expect(reading.angle).toBeCloseTo(Math.PI / 2, 10);
  });

  it('keeps vector length equal to shaped magnitude at several angles', () => {
    const config = { radiusPx: 100, deadzone: 0.1, saturation: 0.9 };
    const offsets = [
      [45, 0],
      [30, -40],
      [-33, -44],
      [-24, 32],
    ] as const;

    for (const [x, y] of offsets) {
      const reading = readJoystick(0, 0, x, y, config);
      expect(Math.hypot(reading.x, reading.y)).toBeCloseTo(
        reading.magnitude,
        6,
      );
    }
  });

  it('returns neutral for invalid coordinates and zero-length travel', () => {
    const invalidReadings = [
      readJoystick(0, 0, 0, 0),
      readJoystick(Number.NaN, 0, 1, 1),
      readJoystick(0, Number.POSITIVE_INFINITY, 1, 1),
      readJoystick(0, 0, Number.NEGATIVE_INFINITY, 1),
      readJoystick(0, 0, 1, Number.NaN),
    ];

    for (const reading of invalidReadings) {
      expect(reading).toBe(NEUTRAL_JOYSTICK);
      expect(Object.values(reading).some(Number.isNaN)).toBe(false);
    }
  });

  it('sanitizes malformed response configuration instead of producing NaN', () => {
    const reading = readJoystick(0, 0, 10, 0, {
      radiusPx: 0,
      deadzone: Number.NaN,
      saturation: Number.POSITIVE_INFINITY,
    });

    expect(reading.magnitude).toBe(1);
    expect(Object.values(reading).some(Number.isNaN)).toBe(false);
  });
});

describe('joystick knob offset', () => {
  it('leaves inside travel alone and clamps outside travel to the rim', () => {
    expect(clampStickOffset(10, 20, 40, 60, 100)).toEqual({ x: 30, y: 40 });

    const clamped = clampStickOffset(10, 20, 310, 420, 75);
    expect(Math.hypot(clamped.x, clamped.y)).toBeCloseTo(75, 10);
    expect(clamped.x).toBeCloseTo(45, 10);
    expect(clamped.y).toBeCloseTo(60, 10);
  });

  it('uses the default radius and rejects invalid geometry safely', () => {
    const clamped = clampStickOffset(0, 0, 100, 0);
    expect(Math.hypot(clamped.x, clamped.y)).toBe(
      DEFAULT_JOYSTICK_CONFIG.radiusPx,
    );
    expect(clampStickOffset(0, 0, Number.NaN, 0, 50)).toEqual({ x: 0, y: 0 });
  });
});

describe('joystick drive mapping', () => {
  it('maps upward travel to throttle only', () => {
    expect(driveFromJoystick(stick(0.15, 0.8), 5)).toEqual({
      throttle: 0.8,
      reverse: 0,
      brake: 0,
      steer: 0.15,
    });
  });

  it('maps downward travel to braking while still rolling forward', () => {
    expect(driveFromJoystick(stick(0, -0.7), 5)).toEqual({
      throttle: 0,
      reverse: 0,
      brake: 0.7,
      steer: 0,
    });
  });

  it('maps downward travel to reverse near a stop', () => {
    expect(driveFromJoystick(stick(0, -0.7), 0)).toEqual({
      throttle: 0,
      reverse: 0.7,
      brake: 0,
      steer: 0,
    });
  });

  it('never emits throttle and reverse together across the response range', () => {
    for (const y of [-1, -0.4, 0, 0.4, 1]) {
      for (const speed of [0, 5]) {
        const drive = driveFromJoystick(stick(0, y), speed);
        expect(drive.throttle * drive.reverse).toBe(0);
      }
    }
  });

  it('preserves steer sign and applies bounded gain directly to stick x', () => {
    expect(driveFromJoystick(stick(0.2, 0.95), 0).steer).toBeCloseTo(0.2);
    expect(driveFromJoystick(stick(-0.4, 0), 0).steer).toBeCloseTo(-0.4);
    expect(
      driveFromJoystick(stick(0.75, 0), 0, { steerGain: 2 }).steer,
    ).toBe(1);
  });

  it('maps a neutral stick to no drive input or parking brake', () => {
    expect(driveFromJoystick(NEUTRAL_JOYSTICK, 0)).toEqual({
      throttle: 0,
      reverse: 0,
      brake: 0,
      steer: 0,
    });
  });
});

function stick(x: number, y: number): JoystickVector {
  const magnitude = Math.hypot(x, y);
  return {
    x,
    y,
    magnitude,
    angle: magnitude === 0 ? 0 : Math.atan2(y, x),
    active: magnitude > 0,
  };
}
