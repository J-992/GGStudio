import { describe, expect, it } from 'vitest';
import { getPartDef } from '../src/core/parts.ts';
import type { RuntimeWheel } from '../src/runtime/assembler.ts';
import {
  assistedYawRate,
  commandedYawRate,
  maxSteerLockRad,
  steerLockFraction,
} from '../src/runtime/steering.ts';

function wheel(
  defId: string,
  steering = true,
  broken = false,
): Pick<RuntimeWheel, 'steering' | 'broken' | 'wheelDef'> {
  return { steering, broken, wheelDef: getPartDef(defId).wheel! };
}

const WHEELBASE = 2.4;
const LOCK = (40 * Math.PI) / 180;
/** Radius the geometry traces at full lock: R = wheelbase / tan(lock). */
const FULL_LOCK_RADIUS = WHEELBASE / Math.tan(LOCK);

describe('max steer lock', () => {
  it('takes the widest lock among the live steering wheels', () => {
    const lock = maxSteerLockRad([
      wheel('wheel-standard'), // 40 deg
      wheel('wheel-offroad'), // 32 deg
    ]);
    expect((lock * 180) / Math.PI).toBeCloseTo(40, 6);
  });

  it('ignores broken and non-steering wheels', () => {
    expect(
      maxSteerLockRad([
        wheel('wheel-moto', true, true), // 42 deg, but broken
        wheel('wheel-standard', false), // 40 deg, but does not steer
        wheel('wheel-offroad'), // 32 deg
      ]) *
        (180 / Math.PI),
    ).toBeCloseTo(32, 6);
  });

  it('is zero for a tread rig, which has no hub lock at all', () => {
    expect(maxSteerLockRad([wheel('tread-tank')])).toBe(0);
  });
});

describe('commanded yaw rate', () => {
  it('is zero with no input, no lock, or no motion', () => {
    expect(commandedYawRate(0, 10, WHEELBASE, LOCK)).toBe(0);
    expect(commandedYawRate(1, 10, WHEELBASE, 0)).toBe(0);
    expect(commandedYawRate(1, 0, WHEELBASE, LOCK)).toBe(0);
  });

  it('traces the rig geometric turn circle at ordinary speed', () => {
    // Below the lateral-accel cap the rate is purely kinematic: v / R.
    const speed = 4;
    const rate = commandedYawRate(1, speed, WHEELBASE, LOCK);
    expect(speed / Math.abs(rate)).toBeCloseTo(FULL_LOCK_RADIUS, 4);
  });

  it('turns toward -x for positive steer, matching the hub targets', () => {
    // Positive steer is a negative rotation about +Y.
    expect(commandedYawRate(1, 8, WHEELBASE, LOCK)).toBeLessThan(0);
    expect(commandedYawRate(-1, 8, WHEELBASE, LOCK)).toBeGreaterThan(0);
  });

  it('rotates the other way when the same input is given in reverse', () => {
    expect(commandedYawRate(1, -8, WHEELBASE, LOCK)).toBeGreaterThan(0);
  });

  it('asks for less rotation with less input', () => {
    const half = Math.abs(commandedYawRate(0.5, 4, WHEELBASE, LOCK));
    const full = Math.abs(commandedYawRate(1, 4, WHEELBASE, LOCK));
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full);
  });

  it('opens the arc up at speed instead of pivoting on a pin', () => {
    const slow = Math.abs(commandedYawRate(1, 6, WHEELBASE, LOCK));
    const fast = Math.abs(commandedYawRate(1, 30, WHEELBASE, LOCK));
    expect(6 / slow).toBeLessThan(30 / fast);
    // The lateral load a corner may ask for stays bounded as speed climbs.
    expect(30 * fast).toBeLessThanOrEqual(30 + 1e-9);
  });

  it('never commands a pirouette, however tight the rig is', () => {
    const stubby = commandedYawRate(1, 12, 0.4, (60 * Math.PI) / 180);
    expect(Math.abs(stubby)).toBeLessThanOrEqual(2.4 + 1e-9);
  });
});

describe('steer lock fraction', () => {
  it('gives full lock at parking speed', () => {
    expect(steerLockFraction(1, 0, WHEELBASE, LOCK)).toBe(1);
    expect(steerLockFraction(-0.4, 0.2, WHEELBASE, LOCK)).toBeCloseTo(-0.4, 6);
  });

  it('still gives full lock once rolling, while geometry is the limit', () => {
    // Speed cancels out of the kinematic branch, so there is no low-speed
    // cliff between the parked case and the moving one.
    expect(steerLockFraction(1, 3, WHEELBASE, LOCK)).toBeCloseTo(1, 4);
  });

  it('winds lock off at speed, monotonically', () => {
    const speeds = [5, 10, 20, 35];
    const locks = speeds.map((v) => steerLockFraction(1, v, WHEELBASE, LOCK));
    for (let i = 1; i < locks.length; i++) {
      expect(locks[i]!).toBeLessThan(locks[i - 1]!);
    }
    expect(locks.at(-1)!).toBeGreaterThan(0);
  });

  it('never commands more lock than the player asked for', () => {
    for (const v of [0, 1, 5, 15, 40]) {
      expect(steerLockFraction(0.3, v, WHEELBASE, LOCK)).toBeLessThanOrEqual(0.3);
    }
  });

  it('is zero without input or without a steerable hub', () => {
    expect(steerLockFraction(0, 10, WHEELBASE, LOCK)).toBe(0);
    expect(steerLockFraction(1, 10, WHEELBASE, 0)).toBe(0);
  });
});

describe('yaw assist', () => {
  const dt = 1 / 60;

  it('moves the chassis toward the commanded rate without overshooting', () => {
    const next = assistedYawRate(0, -1.5, 1, dt);
    expect(next).toBeLessThan(0);
    expect(next).toBeGreaterThan(-1.5);
  });

  it('converges on the commanded rate when the input is held', () => {
    let yaw = 0;
    for (let i = 0; i < 120; i++) yaw = assistedYawRate(yaw, -1.5, 1, dt);
    expect(yaw).toBeCloseTo(-1.5, 3);
  });

  it('settles a rotating rig back to straight once the input is centred', () => {
    let yaw = 1.2;
    for (let i = 0; i < 120; i++) yaw = assistedYawRate(yaw, 0, 1, dt);
    expect(Math.abs(yaw)).toBeLessThan(0.01);
  });

  it('has no authority with every wheel off the ground', () => {
    expect(assistedYawRate(0.8, -1.5, 0, dt)).toBe(0.8);
  });

  it('has less authority with fewer wheels down', () => {
    const half = assistedYawRate(0, -1.5, 0.5, dt);
    const full = assistedYawRate(0, -1.5, 1, dt);
    expect(Math.abs(half)).toBeLessThan(Math.abs(full));
  });
});
