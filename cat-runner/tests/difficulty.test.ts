import { describe, expect, it } from 'vitest';

import {
  speedMultiplierForElapsed,
  SPEED_RAMP_START_MULTIPLIER,
  SPEED_RAMP_RECOVERY_TIME,
  SPEED_RAMP_MAX_MULTIPLIER,
  SPEED_RAMP_FULL_TIME,
} from '../src/levels/procedural/DifficultyCurve';

/**
 * The speed half of the endless difficulty ramp.
 *
 * `ChunkDirector`/`FishPatterns` already have their own coverage for the
 * obstacle-frequency/fish-complexity half; this is the one number those
 * files don't touch.
 */
describe('speedMultiplierForElapsed', () => {
  it('starts at exactly the opening cut', () => {
    expect(speedMultiplierForElapsed(0)).toBe(SPEED_RAMP_START_MULTIPLIER);
  });

  it('never goes below the opening cut, even for negative elapsed time', () => {
    expect(speedMultiplierForElapsed(-50)).toBe(SPEED_RAMP_START_MULTIPLIER);
  });

  it('recovers exactly cruise speed (1x) by the recovery time', () => {
    expect(speedMultiplierForElapsed(SPEED_RAMP_RECOVERY_TIME)).toBeCloseTo(1, 10);
  });

  it('reaches exactly the max multiplier at the full-ramp time', () => {
    expect(speedMultiplierForElapsed(SPEED_RAMP_FULL_TIME)).toBeCloseTo(
      SPEED_RAMP_MAX_MULTIPLIER,
      10,
    );
  });

  it('never exceeds the max multiplier past the full-ramp time', () => {
    expect(speedMultiplierForElapsed(SPEED_RAMP_FULL_TIME * 5)).toBe(SPEED_RAMP_MAX_MULTIPLIER);
  });

  it('climbs smoothly and monotonically across every phase - no discrete jumps', () => {
    let previous = speedMultiplierForElapsed(0);
    for (let t = 1; t <= SPEED_RAMP_FULL_TIME; t += 1) {
      const current = speedMultiplierForElapsed(t);
      expect(current).toBeGreaterThanOrEqual(previous);
      // No single 1-second step should jump by more than a small fraction of
      // the whole ramp - guards against a future edit introducing a
      // discontinuity ("sudden difficulty spike") into what's meant to be an
      // eased curve, including at the recovery/climb phase boundary.
      const totalSpan = SPEED_RAMP_MAX_MULTIPLIER - SPEED_RAMP_START_MULTIPLIER;
      expect(current - previous).toBeLessThan(totalSpan * 0.1);
      previous = current;
    }
  });

  it('recovers most of the cut within the first few seconds - eases out, not linear', () => {
    const early = speedMultiplierForElapsed(SPEED_RAMP_RECOVERY_TIME * 0.25) - SPEED_RAMP_START_MULTIPLIER;
    const recovery = 1 - SPEED_RAMP_START_MULTIPLIER;
    // Ease-out: the first quarter of the recovery window covers more than a
    // quarter of the recovery climb - this is the "closes the risky
    // reduced-reach window quickly" property the recovery phase exists for.
    expect(early).toBeGreaterThan(recovery * 0.25);
  });

  it('is keyed to elapsed time, not distance - a stalled clock never advances it', () => {
    // Calling with the same elapsed value twice must be pure/idempotent -
    // nothing here should depend on hidden state or accumulate.
    const a = speedMultiplierForElapsed(42);
    const b = speedMultiplierForElapsed(42);
    expect(a).toBe(b);
  });

  it('is a deliberate cut, not a rounding artifact', () => {
    expect(SPEED_RAMP_START_MULTIPLIER).toBeCloseTo(0.7, 10);
  });

  it('is a modest ceiling - never a runaway speed the reaction-time budget was not tuned against', () => {
    expect(SPEED_RAMP_MAX_MULTIPLIER).toBeGreaterThan(1);
    expect(SPEED_RAMP_MAX_MULTIPLIER).toBeLessThan(1.5);
  });

  it('the recovery window is short relative to the full ramp', () => {
    // The reduced-reach opening (see `PhysicsConfig.ts`'s own comment on
    // `runSpeed`) is a brief opening feel, not a speed the ramp lingers at -
    // recovery should be a small fraction of the total climb.
    expect(SPEED_RAMP_RECOVERY_TIME).toBeLessThan(SPEED_RAMP_FULL_TIME * 0.2);
  });
});
