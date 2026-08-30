/**
 * Every tunable that shapes how the cat moves, in one place.
 *
 * See TUNING.md for what each value does and which direction to push it.
 * Nothing outside this file should contain a magic movement number.
 */

export interface PhysicsConfig {
  // --- World ---
  /** Downward acceleration, world units/s². More negative = heavier, snappier arcs. */
  gravity: number;
  /** Physics step. Fixed so frame rate can never alter movement. */
  fixedTimeStep: number;
  /** Safety clamp on catch-up steps after a long frame stall. */
  maxSubSteps: number;

  // --- Body ---
  /** Mass of the invisible controller body. */
  mass: number;
  /** Capsule radius of the player collider. */
  colliderRadius: number;
  /** Capsule cylinder half-height (total height = 2*(halfHeight+radius)). */
  colliderHalfHeight: number;
  /** Per-second velocity bleed. Low values keep momentum feeling heavy. */
  linearDamping: number;
  /** Per-second spin bleed. Higher values stop endless tumbling. */
  angularDamping: number;

  // --- Run ---
  /**
   * Forward speed, world units/s. Constant: the player never controls it.
   *
   * This one number sets the reach of every jump and therefore the size of
   * every gap the levels are allowed to contain. Raising it makes the levels
   * easier, not harder, because there is no approach speed to get wrong.
   */
  runSpeed: number;
  /**
   * The design-tuned run speed at the start of a run, before the endless
   * difficulty ramp or Catnip Rush touch it.
   *
   * `runSpeed` itself is the *live* value both of those mutate - Catnip by a
   * multiply/divide pair (`PowerUpManager`), the endless ramp by a ratio
   * applied every time the target changes (`Game.updateDifficultySpeed()`).
   * Keeping the untouched reference separate is what lets the ramp compute
   * "how much faster should this be *now*" without ever needing to know
   * whether a Catnip multiplier happens to be baked into `runSpeed` at that
   * moment - see `DifficultyCurve.ts`'s own doc comment.
   */
  baseRunSpeed: number;
  /** Sideways distance between adjacent lane centres. */
  laneSpacing: number;
  /**
   * How long one lane step takes, seconds.
   *
   * A lane change is a *timed tween*, not a seek, and this is its duration.
   * That distinction is the whole difference between snappy and floaty: a
   * proportional controller approaches its target asymptotically, so it has no
   * arrival time at all - it has a time constant and an exponential tail that
   * reads as drifting. A tween arrives, on schedule, every time.
   */
  laneChangeTime: number;
  /** Ceiling on a multi-lane sweep, so a two-lane dash cannot feel sluggish. */
  laneChangeMaxTime: number;
  /**
   * How fast the runner closes any *residual* lane error, 1/s.
   *
   * No longer what drives a lane change - see {@link laneChangeTime}. This is
   * the hold term that runs once a tween has arrived, and its job is to absorb
   * low-grip drift and being shoved sideways by geometry.
   */
  laneSnapRate: number;
  /**
   * Ceiling on sideways speed.
   *
   * Has to clear the tween's peak or it would flatten the ease back into the
   * drift it replaces: smoothstep peaks at 1.5x the average rate, so one lane
   * (2.4) in laneChangeTime (0.18) tops out near 20 u/s.
   */
  maxLaneSpeed: number;
  /** Fraction of lane authority retained in the air. */
  airControl: number;

  // --- Turning ---
  /** How long the heading takes to swing through a 90-degree corner, seconds. */
  turnBlendTime: number;
  /** How far before a corner a turn input starts being accepted. */
  turnZoneBefore: number;
  /** How far past a corner a late turn is still honoured. */
  turnZoneAfter: number;
  /**
   * How close to the corner the heading actually swings, regardless of when the
   * player pressed.
   *
   * The input window and the manoeuvre are deliberately separate. Accepting a
   * press early is forgiving; *acting* on it early is not - the runner would
   * pivot short of the corner, and the new run's centreline is then most of the
   * input window away sideways, so it gets dragged across the roof and off the
   * edge. Buffering the press and swinging here keeps the corner a corner no
   * matter how early it was called, the same way `jumpBufferTime` lets a jump
   * be asked for before the ground arrives.
   */
  turnCommitDistance: number;
  /**
   * How quickly the heading eases through a soft bend, 1/s.
   *
   * Soft bends are walked through without input, so this is pure presentation:
   * too low and the runner cuts the corner off its own rooftops, too high and
   * the camera snaps.
   */
  headingEaseRate: number;

  // --- Grip ---
  /**
   * Sideways drift, units/s, on a surface with no grip at all.
   *
   * Prescribing velocity makes collider friction irrelevant, which would quietly
   * delete the difference between terracotta and the metal and glass roofs that
   * levels 2 and 3 are built around. Instead the ground's own friction
   * coefficient is read back off the raycast and scaled into a lane-seek penalty
   * and this much outward drift.
   */
  lowGripDrift: number;
  /** Friction coefficient treated as full grip. Above this nothing is lost. */
  fullGripFriction: number;
  /** Sideways speed (units/s) above which the cat is considered sliding. */
  slipThreshold: number;
  /**
   * Tallest lip the runner is lifted over rather than stopped by.
   *
   * With velocity prescribed every step, contact resolution wins against a
   * vertical face and the runner simply stops - permanently, because nothing
   * ever gives it the vertical speed to climb. Small authored steps at platform
   * seams and ramp lips get a hand up instead.
   */
  maxStepUp: number;
  /** How long the runner may be blocked before it counts as a crash, seconds. */
  blockedGraceTime: number;

  // --- Jump ---
  /** Upward impulse on jump. */
  jumpImpulse: number;
  /** Window after leaving a ledge where a jump still counts, seconds. */
  coyoteTime: number;
  /** Window before landing where a pressed jump is remembered, seconds. */
  jumpBufferTime: number;
  /** Minimum spacing between jumps - stops buffered double-jumps, seconds. */
  jumpCooldown: number;

  // --- Ground detection ---
  /** Ray length below the capsule used to detect ground. */
  groundRayLength: number;
  /** Extra ray length used only for coyote/landing prediction. */
  groundProbeExtra: number;
  /** Steepest surface (degrees) that still counts as standable ground. */
  maxSlopeAngle: number;

  // --- Stability & recovery ---
  /** Downward speed on impact above which a landing counts as "hard". */
  hardLandingSpeed: number;
  /** How long a stumble makes the runner mushy, seconds. */
  stumbleDuration: number;
  /**
   * How long one press keeps the cat tucked, seconds.
   *
   * Sized against the thing it exists to clear. At `runSpeed` 11 the cat covers
   * 11 units a second and a clothesline's overlap band is about 2.2 units deep,
   * so the tuck has to outlast roughly 0.2 s of travel. 0.55 gives a window
   * either side of that - late enough to answer a line the player has only just
   * read, generous enough that a slightly early press still lands - without
   * making the duck free. Holding the key does not extend it; see
   * `PlayerController.tickTimers`.
   */
  slideDuration: number;
  /**
   * Window before landing where a pressed slide is remembered, seconds.
   *
   * Same idea as `jumpBufferTime`: a press on the fixed step just before the
   * cat touches down would otherwise be discarded outright, because a
   * grounded press is required to start a duck. Kept short - a slide is
   * usually pressed in reaction to something already on screen, not
   * anticipated the way a jump over a known gap can be, so a wide window
   * would let stray presses buffer in from further away than makes sense.
   */
  slideBufferTime: number;
  /**
   * How far the runner may drop below the last ground it stood on before the
   * fall is unrecoverable. Well under any authored step, well over any lip.
   */
  fallThreshold: number;

  // --- Collisions ---
  /** Impulse scale applied sideways when clipping an obstacle. */
  collisionKnockback: number;
  /** Relative speed below which a collision is ignored entirely. */
  collisionMinSpeed: number;
  /** Fraction of speed lost on a solid hit. */
  collisionSpeedLoss: number;

  // --- Camera coupling ---
  /** Speed at which camera FOV expansion begins. */
  fovExpansionSpeed: number;
  /** Maximum extra FOV degrees added at top speed. */
  fovExpansionAmount: number;

  // --- Failure ---
  /** World Y below which the attempt is failed. Overridden per level. */
  killPlaneY: number;
}

export const DEFAULT_PHYSICS: PhysicsConfig = {
  // World
  gravity: -18,
  fixedTimeStep: 1 / 60,
  maxSubSteps: 5,

  // Body
  mass: 1.6,
  colliderRadius: 0.34,
  colliderHalfHeight: 0.16,
  linearDamping: 0.12,
  angularDamping: 1.6,

  // Run
  //
  // 11 u/s against gravity -18 and jumpImpulse 7.9 gives a measured flat-to-flat
  // jump of 9.53 units. Every gap in the campaign is compressed to fit inside
  // that (see GAP_COMPRESSION in src/levels/index.ts) - the two numbers are a
  // pair, and moving one without the other makes levels uncompletable.
  //
  // This stays the design cruise speed, not the *starting* one - the endless
  // run's own opening 30% cut (and its ramp back up) lives entirely in
  // `DifficultyCurve.ts`/`Game.updateDifficultySpeed()`, as a multiplier
  // applied to `runSpeed` at run start exactly the way Catnip Rush already
  // is, rather than as a change to this base value. That is deliberate: this
  // constant is also every raw-physics test's and the lane-change graze-gate
  // ratio's reference speed, none of which are about the endless ramp at all.
  runSpeed: 11,
  baseRunSpeed: 11,
  // Three lanes at 2.4 span 4.8 units plus the capsule, which fits the narrowest
  // authored walkway with room to spare.
  laneSpacing: 2.4,
  // Pulled to the fast end (0.18 -> 0.15) of the 0.15-0.29 window the feel
  // pass asked for, alongside the tween's move from smoothstep to a sine
  // ease-out (see `PlayerController.applyRunVelocity`) - together they are the
  // "lane changes respond immediately" half of the input-latency pass. A
  // two-lane sweep at 0.26 still arrives inside the window.
  laneChangeTime: 0.15,
  laneChangeMaxTime: 0.26,
  laneSnapRate: 9,
  // Has to clear the eased tween's peak rate or the clamp flattens the ease.
  // The sine ease-out peaks at PI/2 (1.571x) the average rate, and the fastest
  // average is a two-lane sweep: 2 * 2.4 / 0.26 = 18.5 u/s, peaking at 29.0.
  // Raised from 24 to exactly that. Deliberately not higher: at 29 the
  // combined-velocity alignment of a peak-speed lane change against forward
  // `runSpeed` is 11 / hypot(11, 29) = 0.355, which stays above the 0.35
  // shallow-graze gate in `reportObstacleHit`/`handleContact` - so clipping a
  // crate mid-change still counts as a crash, exactly as it did at 24.
  maxLaneSpeed: 29,
  airControl: 0.55,

  // Turning
  turnBlendTime: 0.22,
  // Generous either side: at 11 u/s the runner covers 10 units in under a
  // second, so a tight window would be a reaction test rather than a decision.
  // 18 is 1.6s of approach - it was 14, which at speed is close enough to a
  // reflex check that missing a corner felt arbitrary.
  turnZoneBefore: 18,
  turnZoneAfter: 4,
  // The heading takes turnBlendTime (0.22s) to swing, which at runSpeed is 2.4
  // units of travel - so starting at 2.5 has the runner aligned with the new
  // run just about as it reaches the corner.
  turnCommitDistance: 2.5,
  headingEaseRate: 3.2,

  // Grip
  lowGripDrift: 2.6,
  fullGripFriction: 0.85,
  slipThreshold: 1.2,
  // Measured: a lip of 0.3 is survivable but costs almost all forward speed,
  // and 0.4 stops the runner permanently. Lifting anything up to 0.5 keeps
  // platform seams and ramp lips from being invisible walls.
  maxStepUp: 0.5,
  blockedGraceTime: 0.35,

  // Jump
  jumpImpulse: 7.9,
  coyoteTime: 0.1,
  jumpBufferTime: 0.14,
  jumpCooldown: 0.18,

  // Ground detection
  groundRayLength: 0.62,
  groundProbeExtra: 0.5,
  maxSlopeAngle: 52,

  // Stability & recovery
  hardLandingSpeed: 13,
  stumbleDuration: 0.45,
  slideDuration: 0.55,
  slideBufferTime: 0.12,
  fallThreshold: 3.5,

  // Collisions
  collisionKnockback: 4.5,
  collisionMinSpeed: 3.5,
  collisionSpeedLoss: 0.28,

  // Camera coupling
  //
  // Lowered from 9 with the endless run's opening 30% speed cut
  // (`DifficultyCurve.ts` - live `runSpeed` starts a run at 7.7, not the 11
  // this file's own `runSpeed` documents as the cruise reference). FollowCamera
  // divides by `PHYSICS.runSpeed - fovExpansionSpeed`, using whatever the
  // *live*, ramped runSpeed currently is - so this only needs to stay below
  // the ramp's lowest point (7.7) for that denominator to stay positive; left
  // at the old value of 9, FOV widening would have inverted (maxed out at
  // the calmest, slowest moment of a run instead of the fastest) for as long
  // as a run's live speed sat below 9. 6.3 keeps the same ~0.82 fraction of
  // the reduced starting speed the old 9/11 pair had of the cruise speed.
  fovExpansionSpeed: 6.3,
  // Raised with the camera's move to a 60-degree base lens. A narrower lens
  // reads as slower, so the speed cue has to come from the *swing* instead:
  // 60 -> 74 is a wider opening than the 76 -> 87 it replaces, on a base that
  // no longer distorts the edges of the frame.
  fovExpansionAmount: 14,

  // Failure
  killPlaneY: -30,
};

/** Working copy the game mutates. Reset via {@link resetPhysicsConfig}. */
export const PHYSICS: PhysicsConfig = { ...DEFAULT_PHYSICS };

export function resetPhysicsConfig(): void {
  Object.assign(PHYSICS, DEFAULT_PHYSICS);
}

/**
 * Distance from the controller capsule's centre down to the surface it rests on.
 *
 * The physics body's translation is the capsule *centre*, but the cat model is
 * normalised with its paws at local y=0 (see `normaliseToLength` in
 * AssetRegistry). Anything that positions a *visual* from the body translation -
 * the cat itself, and the camera that frames it - must subtract this, or it
 * renders half a capsule above the roof.
 */
export function capsuleFeetOffset(): number {
  return PHYSICS.colliderHalfHeight + PHYSICS.colliderRadius;
}
