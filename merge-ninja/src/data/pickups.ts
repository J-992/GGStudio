import { LEGACY_PICKUP_TUNING } from './powerups';

/**
 * Tuning for the drifting pickups.
 *
 * Source of truth moved to `LEGACY_PICKUP_TUNING` in src/data/powerups.ts;
 * this module keeps the potion's public shape so existing importers are
 * untouched. The golden clock's numbers live with its widget in
 * `src/ui/TimeClock.ts`; the potion lives here because the cadence is a
 * balance decision the unit suite has to be able to read, and the test runner
 * cannot import Phaser.
 *
 * The potion is the counterweight to a run that can now actually end. It drops
 * roughly twice as often as the clock, and a line that is nearly out gets the
 * next bottle much sooner -- losing should take a run of bad decisions, not one
 * unlucky spawn timer.
 */
export const POTION = LEGACY_PICKUP_TUNING.potion;

/**
 * How long until the next bottle, given how the run is going.
 *
 * `roll` is a 0..1 sample, passed in rather than drawn inside so the cadence
 * is deterministic under test.
 */
export function potionGapMs(healthRatio: number, roll: number): number {
  const safeRoll = Math.max(0, Math.min(1, Number.isFinite(roll) ? roll : 0.5));
  const urgent = healthRatio < POTION.urgentBelowRatio;
  const min = urgent ? POTION.urgentMinGapMs : POTION.minGapMs;
  const max = urgent ? POTION.urgentMaxGapMs : POTION.maxGapMs;
  return Math.round(min + (max - min) * safeRoll);
}
