/**
 * The one number `ChunkDirector`/`SectionDirector` don't already ramp:
 * forward speed.
 *
 * Obstacle frequency, hazard combinations and how much of a run is "empty"
 * straight chunks are already a smooth, distance-driven progression -
 * `ChunkDirector.tierAt()` plus `TIER_HAZARD_SCALE` ramps hazard weight as
 * distance grows, and `SECTION_WEIGHTS` plus `COMBO_WEIGHT_BOOST` already
 * varies hazard density and pairs hazards into combinations. This file adds
 * the missing piece - `PHYSICS.runSpeed`.
 *
 * A run now opens at a deliberate 30% cut below `PHYSICS.baseRunSpeed` (11),
 * easing back up in two phases, both keyed to *elapsed real gameplay
 * seconds* (not distance - "every minute of gameplay," not "every metre
 * covered," which is what a slower start would otherwise silently stretch
 * out). `baseRunSpeed` itself is untouched - this is a multiplier applied at
 * run start exactly the way Catnip Rush's own multiply/divide already rides
 * on top of `runSpeed`, not a change to the design's cruise-speed constant
 * (see `PhysicsConfig.ts`'s own comment on `runSpeed` for why that constant
 * has to stay put: every raw-physics test, and the lane-change graze-gate
 * ratio, are tuned against it directly):
 *
 *  1. **Recovery** (0 to {@link SPEED_RAMP_RECOVERY_TIME}): climbs from
 *     {@link SPEED_RAMP_START_MULTIPLIER} back to exactly 1x (the normal
 *     cruise speed) quickly. This phase exists because jump reach scales
 *     directly with `runSpeed` (`PhysicsConfig.ts`'s own comment) - a
 *     flat jump that clears the endless track's 6.5-unit gap with a 3.03-unit
 *     margin at cruise speed only clears it by ~0.17 at the 30%-cut starting
 *     speed, so this window is kept short rather than easing the player
 *     through it slowly.
 *  2. **Climb** ({@link SPEED_RAMP_RECOVERY_TIME} to
 *     {@link SPEED_RAMP_FULL_TIME}): continues gradually up to
 *     {@link SPEED_RAMP_MAX_MULTIPLIER} - unchanged from before this pass, so
 *     a long run still ends up exactly as fast as it always did, just paced
 *     by the clock instead of the odometer.
 *
 * All three phases (the cut itself included) use the same ease-out shape
 * (`1 - (1-t)^2`) the old distance-based ramp used, chained so the value is
 * continuous across every phase boundary - climbs fastest right when each
 * phase starts, levels off toward its own target, never a discrete jump.
 *
 * `Game.updateDifficultySpeed()` is the only caller, and applies the result
 * as a *ratio* against whatever `PHYSICS.runSpeed` currently is, rather than
 * overwriting it outright - see that method's own comment for why that's
 * what lets this compose safely with Catnip Rush's independent multiply/
 * divide of the same field.
 */

/** Multiplier of `PHYSICS.baseRunSpeed` a run opens at - a deliberate 30% cut
 *  for a gentler start. */
export const SPEED_RAMP_START_MULTIPLIER = 0.7;

/** Seconds of elapsed gameplay to climb from {@link SPEED_RAMP_START_MULTIPLIER}
 *  back to exactly cruise speed (1x). Short and deliberate - see this file's
 *  own doc comment on why the reduced-reach window needs to close quickly
 *  rather than ease out over the whole ramp. */
export const SPEED_RAMP_RECOVERY_TIME = 15;

/** Fastest the ramp ever asks for, as a multiple of `PHYSICS.baseRunSpeed`.
 *  Unchanged from the pre-cut ramp - deliberately modest: a runaway top speed
 *  would eat into the reaction-time budget every hazard's spacing was tuned
 *  against, and this is speed on top of - not instead of - the section/tier
 *  system's own difficulty curve. */
export const SPEED_RAMP_MAX_MULTIPLIER = 1.25;

/** Seconds of elapsed gameplay for the full climb (recovery included) to
 *  reach {@link SPEED_RAMP_MAX_MULTIPLIER}. Five minutes - long enough that
 *  "gradually increase every minute of gameplay" reads as a real, ongoing
 *  climb rather than something that's already over by the time a player
 *  notices it. */
export const SPEED_RAMP_FULL_TIME = 300;

/** `1 - (1-t)^2` on `[0,1]` - the ease-out shape every ramp phase shares. */
function easeOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) * (1 - clamped);
}

/**
 * Run-speed multiplier for a given elapsed gameplay time (seconds) -
 * {@link SPEED_RAMP_START_MULTIPLIER} at the start, easing up to exactly 1x
 * by {@link SPEED_RAMP_RECOVERY_TIME}, then continuing to
 * {@link SPEED_RAMP_MAX_MULTIPLIER} by {@link SPEED_RAMP_FULL_TIME}, then flat.
 */
export function speedMultiplierForElapsed(elapsedSeconds: number): number {
  const t = Math.max(0, elapsedSeconds);

  if (t <= SPEED_RAMP_RECOVERY_TIME) {
    const eased = easeOut(t / SPEED_RAMP_RECOVERY_TIME);
    return SPEED_RAMP_START_MULTIPLIER + (1 - SPEED_RAMP_START_MULTIPLIER) * eased;
  }

  const climbSpan = SPEED_RAMP_FULL_TIME - SPEED_RAMP_RECOVERY_TIME;
  const eased = easeOut((t - SPEED_RAMP_RECOVERY_TIME) / climbSpan);
  return 1 + (SPEED_RAMP_MAX_MULTIPLIER - 1) * eased;
}
