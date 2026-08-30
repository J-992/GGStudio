import { describe, expect, it } from 'vitest';

import { formatDistance, formatFish } from '../src/ui/UIManager';
import {
  BEAM_BOTTOM,
  BEAM_HALF_DEPTH,
  BEAM_HEIGHT,
  BEAM_RADIUS,
  BEAM_TOP,
} from '../src/levels/procedural/ChunkTypes';
import { PHYSICS, capsuleFeetOffset } from '../src/physics/PhysicsConfig';

/**
 * The run's readouts, and the barrier the run has to get under.
 *
 * Two unrelated-looking halves in one file because both are the same kind of
 * thing: a number whose exact value is a *presentation* decision that nothing
 * else in the codebase would notice going wrong. A distance that rounds the
 * wrong way and a barrier that sits two centimetres too high both compile,
 * both run, and both are only visible by playing.
 */

describe('distance readout', () => {
  it('rounds down, never up', () => {
    // The HUD, the results overlay and the menu record all read through this,
    // so rounding to nearest would let the counter show a metre the player has
    // not run yet - and, worse, let a run display the same number as the
    // record it did not actually beat.
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(0.99)).toBe('0 m');
    expect(formatDistance(41.5)).toBe('41 m');
    expect(formatDistance(999.999)).toBe('999 m');
  });

  it('separates thousands with a comma regardless of the host locale', () => {
    // Pinned deliberately. Left to the browser's own locale, a player in much
    // of Europe reads "1.234 m" mid-run, which looks like a decimal rather
    // than four digits - and a run past 1 km is exactly when the number
    // matters most.
    expect(formatDistance(1234)).toBe('1,234 m');
    expect(formatDistance(1_000_000)).toBe('1,000,000 m');
  });

  it('never shows a negative distance', () => {
    // `Game.updateDistance` holds the furthest arc reached, so this should not
    // arise - but the arc is a projection onto a generated route and a
    // spawn-frame projection can land just behind the origin.
    expect(formatDistance(-1)).toBe('0 m');
    // NaN needs its own guard, not just the clamp: `Math.max(0, NaN)` is NaN,
    // so a clamp alone renders the literal text "NaN m" on the HUD every frame
    // for the rest of the run. This test caught exactly that.
    expect(formatDistance(Number.NaN)).toBe('0 m');
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe('0 m');
  });

  it('formats fish the same way, without the unit', () => {
    expect(formatFish(0)).toBe('0');
    expect(formatFish(7.9)).toBe('7');
    expect(formatFish(1500)).toBe('1,500');
    expect(formatFish(-3)).toBe('0');
  });
});

describe('slide barrier position', () => {
  const standingHead = 2 * capsuleFeetOffset();
  const maxJumpApex = PHYSICS.jumpImpulse ** 2 / (2 * -PHYSICS.gravity);

  it('leaves a cat-sized opening underneath', () => {
    // The reason the barrier moved up. At 0.55 the slot under it was barely
    // half the runner's height, so the barrier looked like it met the deck and
    // the honest read of it was "crash", not "duck". The opening has to be a
    // large fraction of the cat for "go under" to be visible at a glance.
    expect(BEAM_BOTTOM / standingHead).toBeGreaterThan(0.75);
  });

  it('still collides with a standing runner, with real margin', () => {
    // The hard ceiling on how high it can go: `overlapsBeam` decides a
    // standing hit with `head >= BEAM_BOTTOM`, so a bottom edge at or above
    // the head means the cat walks straight under a hazard it is supposed to
    // have to duck. The margin is what stops one frame of vertical
    // interpolation turning that into an intermittent bug rather than an
    // obvious one.
    expect(BEAM_BOTTOM).toBeLessThan(standingHead);
    expect(standingHead - BEAM_BOTTOM).toBeGreaterThan(PHYSICS.colliderRadius * 0.25);
  });

  it('keeps the barrier size the height pass settled on', () => {
    // "The size is now great" - so raising it moved both edges together rather
    // than stretching the panel. Pinned so a later nudge to either edge has to
    // be a deliberate resize, not a side effect.
    expect(BEAM_TOP - BEAM_BOTTOM).toBeCloseTo(3.45, 6);
  });

  it('is still unjumpable by a wide margin, not a hair', () => {
    expect(BEAM_TOP).toBeGreaterThan(maxJumpApex * 2);
  });

  it('derives the band from its own edges', () => {
    expect(BEAM_HEIGHT - BEAM_RADIUS).toBeCloseTo(BEAM_BOTTOM, 6);
    expect(BEAM_HEIGHT + BEAM_RADIUS).toBeCloseTo(BEAM_TOP, 6);
  });

  it('does not change the duck timing by moving the barrier up', () => {
    // The along-track axis is what decides how long a duck has to be held, and
    // it is a separate constant precisely so that raising or resizing the band
    // cannot silently make the hazard harder to clear. Same value it has had
    // since the two axes were split apart.
    expect(BEAM_HALF_DEPTH).toBeCloseTo(0.625, 6);
  });
});
