/**
 * The steering law. One idea runs all of it: the steer key is a request for a
 * *yaw rate* — how fast the chassis should rotate — and both halves of the
 * system are driven from that single number.
 *
 *   1. The hubs are angled to the lock that traces that rotation at the
 *      current speed (`steerLockFraction`).
 *   2. The chassis is pulled onto that rotation while its wheels are on the
 *      ground (`assistedYawRate`).
 *
 * Step 2 is what makes the arc match what the player asked for. Without it the
 * turn radius is whatever the balance of front and rear tyre forces happens to
 * settle on, which on a build-your-own-vehicle game means every rig understeers
 * by a different, unguessable amount — the "why is the arc so huge" feel. With
 * it, full lock traces the rig's own geometric turn circle, grip permitting.
 *
 * The commanded rate is bounded twice: by the lateral acceleration a corner is
 * allowed to ask for (so fast corners open up instead of turning on a pin) and
 * by a flat rotation ceiling (so nothing pirouettes). Because the rate is
 * capped, step 1 falls out for free: the lock needed to trace ω at speed v is
 * atan(wheelbase·ω/v), which is full lock at walking pace and a few degrees at
 * top speed. That replaces the old hand-tuned "steering fades with speed"
 * multiplier with the angle the geometry actually calls for.
 *
 * Treads are not part of this. They have no hub to angle (`maxLockRad` is 0),
 * so every entry point here returns zero for them and the skid-steer belt
 * controller in vehicle.ts is left to do the whole job.
 */

import type { RuntimeWheel } from './assembler.ts';
import { clamp } from './vec.ts';

/**
 * Lateral acceleration a commanded turn may ask for. This is the arc-vs-speed
 * knob and it sits deliberately *above* what a tyre can hold (~2g on asphalt):
 * the surplus is what makes a fast corner scrub speed off until the rig is
 * going slow enough to hold the tight line, instead of holding its speed and
 * running wide. Drop it and fast corners open out; raise it and they cost more
 * speed. Measured on the balanced fixture at full lock, this value turns a
 * 21.5 m arc at 19 m/s into a 9 m arc at 15 m/s.
 */
const MAX_TURN_LATERAL_ACCEL = 30; // m/s^2
/** Flat ceiling on commanded rotation, so no rig spins on the spot under lock. */
const MAX_TURN_YAW_RATE = 2.4; // rad/s
/**
 * How hard the chassis is pulled onto the commanded rate. High enough that
 * turn-in feels immediate, low enough that the rig still gets shoved around by
 * terrain and impacts instead of feeling railed.
 */
const YAW_ASSIST_RATE_PER_S = 6;
/**
 * Below this the lock is taken straight from the input. Speed cancels out of
 * the geometric branch, so this is only a guard against dividing by zero while
 * parked, not a separate low-speed regime.
 */
const PARKING_SPEED_MPS = 0.5;

type SteerableWheel = Pick<RuntimeWheel, 'steering' | 'broken' | 'wheelDef'>;

/** Tightest hub angle this rig can actually reach, in radians; 0 for treads. */
export function maxSteerLockRad(wheels: SteerableWheel[]): number {
  let max = 0;
  for (const w of wheels) {
    if (w.broken || !w.steering) continue;
    max = Math.max(max, (w.wheelDef.maxSteerAngleDeg * Math.PI) / 180);
  }
  return max;
}

/**
 * Yaw rate the player is asking for, in rad/s, from a signed forward speed —
 * so steering while reversing rotates the rig the other way, as it should.
 *
 * Positive steer turns toward -x, which is a *negative* rotation about +Y, so
 * the result carries the opposite sign to the input. (Same convention as the
 * skid-steer controller in vehicle.ts.)
 */
export function commandedYawRate(
  steer: number,
  forwardSpeedMps: number,
  wheelbase: number,
  maxLockRad: number,
): number {
  const s = clamp(steer, -1, 1);
  if (Math.abs(s) < 1e-6 || maxLockRad <= 0) return 0;
  const speed = Math.abs(forwardSpeedMps);
  if (speed < 1e-6) return 0;
  // The tightest circle this rig's geometry can point at: R = wheelbase/tan(lock).
  const radius = wheelbase / Math.tan(maxLockRad);
  // Bound the full-lock rate first, then scale by the input, so half a stick is
  // always half the rotation. Capping after scaling would pin every input above
  // some threshold to the same arc, which is the difference between a steering
  // wheel and an on/off switch.
  const fullLock = Math.min(
    speed / radius,
    MAX_TURN_LATERAL_ACCEL / speed,
    MAX_TURN_YAW_RATE,
  );
  return -s * Math.sign(forwardSpeedMps) * fullLock;
}

/**
 * Fraction of full lock (-1..1) the hubs should take to trace the commanded
 * rate at this speed. Feed it to `steerTargets` in place of the raw input.
 */
export function steerLockFraction(
  steer: number,
  speedMps: number,
  wheelbase: number,
  maxLockRad: number,
): number {
  const s = clamp(steer, -1, 1);
  if (Math.abs(s) < 1e-6 || maxLockRad <= 0) return 0;
  const speed = Math.abs(speedMps);
  if (speed <= PARKING_SPEED_MPS) return s;
  const yawRate = Math.abs(commandedYawRate(s, speed, wheelbase, maxLockRad));
  const lock = Math.atan((wheelbase * yawRate) / speed);
  // Never more lock than the player asked for: the cap can only wind it off.
  return Math.sign(s) * Math.min(Math.abs(s), lock / maxLockRad);
}

/**
 * Yaw rate to hand back to the body: the current rate blended toward the
 * commanded one. Authority is the share of wheels on the ground, so an
 * airborne or half-tipped rig keeps whatever rotation physics gave it.
 */
export function assistedYawRate(
  currentYawRate: number,
  targetYawRate: number,
  groundedFraction: number,
  dt: number,
): number {
  const authority = clamp(groundedFraction, 0, 1);
  if (authority <= 0) return currentYawRate;
  const blend = 1 - Math.exp(-YAW_ASSIST_RATE_PER_S * authority * dt);
  return currentYawRate + (targetYawRate - currentYawRate) * blend;
}
