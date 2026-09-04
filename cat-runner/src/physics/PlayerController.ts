import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS } from './PhysicsConfig';
import { PhysicsWorld, GROUP, collisionGroups } from './PhysicsWorld';
import type { RunPath } from '../levels/RunPath';
import { wrapAngle } from '../levels/RunPath';

/**
 * Lane-runner cat controller.
 *
 * The cat is still a dynamic Rapier capsule, but it is no longer *driven* - it
 * is *prescribed*. Every fixed step the controller writes the body's yaw and its
 * horizontal velocity outright, and leaves the vertical component alone:
 *
 *   - forward   -> a constant PHYSICS.runSpeed along the current heading. There
 *                  is no throttle; the player never controls speed.
 *   - sideways  -> a fixed-duration tween across to the target lane, with a
 *                  proportional hold term taking over once it arrives.
 *   - vertical  -> untouched, so gravity, the jump impulse and falling off the
 *                  world all still come from the solver for free.
 *
 * Staying dynamic rather than going kinematic is deliberate: Rapier applies no
 * gravity to kinematic bodies and resolves no contacts for them, so a kinematic
 * runner would mean reimplementing gravity, ground snapping, landing detection
 * and wall blocking by hand. Prescribing velocity on a dynamic body keeps all
 * four, and contact resolution still wins against a wall - the runner is stopped
 * by geometry, it just isn't pushed around by it.
 *
 * Two consequences of prescribing motion are easy to miss and both are handled
 * below. Writing rotation without also zeroing angular velocity leaves the
 * capsule permanently nose-down about ten degrees, because the tangential
 * friction of the prescribed slide torques it and angularDamping balances rather
 * than removes that. And a lip taller than about 0.4 units becomes an absorbing
 * wall, since nothing ever gives the capsule the vertical speed to climb it -
 * hence the step-up assist.
 *
 * All vector maths uses module-level scratch objects: the step function must not
 * allocate.
 */

export enum PlayerState {
  Running = 'running',
  /** Briefly mushy after a hard landing or a clipped obstacle. */
  Stumbling = 'stumbling',
  /** Failed - fell off the level or was caught. No recovery. */
  Dead = 'dead',
}

export interface RunInput {
  /** Net lane steps requested this frame: -2..+2, negative left. */
  laneStep: number;
  /** Turn request pulse: -1 left, +1 right, 0 none. */
  turn: -1 | 0 | 1;
  /** True on the frame jump was newly pressed. */
  jump: boolean;
  /**
   * True for as long as slide is held down - a level, not a pulse, unlike
   * every other field here. Drives `isDucking` directly and continuously
   * (see `tickTimers()`/`updateDucking()`): there is nothing to buffer or
   * consume once per step, since it already reflects "held right now" as of
   * the last read.
   */
  slide: boolean;
}

export interface PlayerEvents {
  onJump?: () => void;
  /** impactSpeed is the downward speed at the moment of contact. */
  onLand?: (impactSpeed: number, hard: boolean) => void;
  onCollision?: (speed: number) => void;
  /** The cat has ducked. Fired on the press, so the pose starts with the input. */
  onDuck?: () => void;
  /** Fired continuously while the cat is skidding across a low-grip roof. */
  onSlide?: (slipSpeed: number) => void;
  /** A corner was taken successfully. */
  onTurn?: (direction: -1 | 1) => void;
  /**
   * A lane change was committed. Fired on the press, not on arrival, so the
   * hop reads as a reaction to the input rather than to the outcome.
   */
  onLaneChange?: (direction: -1 | 1, duration: number) => void;
  /** The runner has been stopped dead by geometry it cannot climb. */
  onBlocked?: () => void;
}

/** Lane indices, centre first - the runner always spawns in the middle. */
export const LANES = [-1, 0, 1] as const;

/**
 * Blanks the edge-triggered verbs after they have been consumed by one step.
 *
 * A `RunInput` is read once per *rendered* frame, but the fixed-step loop may
 * run several sub-steps off that one read. Every edge verb here is "the player
 * pressed a key", not "the player is holding a key", so applying it more than
 * once per press is wrong: `laneStep` is additive, so a single tap at 30 fps
 * moved the runner two lanes.
 *
 * Call this after the first `step()` of a frame, not after the last - the point
 * is that sub-steps two onward see no input at all.
 *
 * `slide` is deliberately not touched here - it is a level, not a pulse (see
 * `RunInput.slide`), so there is nothing to consume: every sub-step should
 * see the same "is it held right now" answer, not have it zeroed after the
 * first.
 */
export function consumeEdges(input: RunInput): void {
  input.laneStep = 0;
  input.turn = 0;
  input.jump = false;
}

/**
 * Folds one frame's freshly-read input `source` into the pending `target`,
 * which {@link consumeEdges} is the only thing that clears.
 *
 * The counterpart to `consumeEdges`, and it exists because assigning `source`
 * straight onto `target` is wrong in a way that is easy to miss. A rendered
 * frame drives however many fixed steps the accumulator has banked, and that
 * number is frequently *zero* - any frame arriving faster than
 * `PHYSICS.fixedTimeStep` (16.67 ms) drives none at all, which on a 144 Hz
 * display is about three frames in five. A press read on such a frame is never
 * seen by a `step()`, so `consumeEdges` never runs for it, so an assignment on
 * the following frame overwrites it with that frame's empty snapshot and the
 * press is gone. Not delayed - gone. Above 60 Hz that silently ate a large
 * share of every lane change, jump and slide.
 *
 * Latching instead lets a press wait out however many zero-step frames it
 * takes for the accumulator to fill, while `consumeEdges` still guarantees it
 * is applied exactly once.
 *
 * `slide` is the one field here that isn't an edge (see `RunInput.slide`), so
 * it isn't OR-latched with the others - it's simply overwritten with
 * whatever `source` currently reads, since a level has no pulse to preserve
 * across a zero-step frame; it will just be read again, correctly, next time.
 */
export function latchEdges(target: RunInput, source: RunInput): void {
  // Clamped to the same +-2 a single frame's read is clamped to: banking
  // across frames must not let input pile up into a longer sweep than one
  // frame's worth of presses could ask for.
  target.laneStep = THREE.MathUtils.clamp(target.laneStep + source.laneStep, -2, 2);
  if (source.turn !== 0) target.turn = source.turn;
  target.jump = target.jump || source.jump;
  target.slide = source.slide;
}

// Scratch vectors - reused every step to keep the update loop allocation-free.
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _horiz = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _down = new THREE.Vector3(0, -1, 0);

const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Above this rate of climb, `probeGround` will not call the runner grounded
 * even if a surface sits within `standDistance`.
 *
 * `applyRunVelocity` never derives a positive `vy` from slope-following (see
 * its own doc comment), so on the ground `vy` is always ~0 or negative -
 * genuinely positive `vy` only happens for the fixed few steps right after a
 * jump impulse, before the runner has climbed far enough to clear the probe's
 * own tolerance. Without this guard `probeGround` reports "grounded" through
 * that whole window, which `detectLanding` then misreads as a landing on the
 * very next step - `tryJump` already clears `wasGrounded` for exactly that
 * step - and fires a spurious `onLand` that stomps the jump animation with
 * `land` a frame after it started.
 */
const JUMP_RISE_GUARD = 0.5;

/**
 * Shortest airborne period `detectLanding` will treat as a real landing.
 *
 * `probeGround`'s `grounded` comes from a single raycast per fixed step with
 * no hysteresis, so a seam between two independently-placed deck/roof pieces
 * (or the tail end of `tryStepUp`) can flip it false for exactly one step and
 * true again the next - `detectLanding` used to read that flicker as a
 * genuine landing every time, firing the landing sound, camera shake, paw
 * prints, and (via `Cat.onLand`) a `land` one-shot that interrupted the run
 * animation's blend mid-stride - the visible stutter this guards against. A
 * one-step flicker is one `fixedTimeStep` (~0.017s); even the shortest real
 * jump is airborne for hundreds of milliseconds (ballistic time from
 * `jumpImpulse`/`gravity`), so three steps' margin filters the flicker
 * without ever touching a real landing.
 */
const MIN_AIRBORNE_FOR_LANDING = 3 * PHYSICS.fixedTimeStep;

/**
 * Whether hitting this collider should cost the player a life.
 *
 * Only `GROUP.OBSTACLE` does. Everything the runner is meant to travel across -
 * roof slabs, planks, ramps - is `GROUP.GROUND`, and being charged for touching
 * the edge of something you are supposed to run along is never right.
 *
 * `collisionGroups()` packs membership into the high 16 bits, so this is its
 * inverse; see the helper in PhysicsWorld.
 */
function isObstacle(collider: RAPIER.Collider | null | undefined): boolean {
  if (!collider) return false;
  return ((collider.collisionGroups() >>> 16) & GROUP.OBSTACLE) !== 0;
}

export class PlayerController {
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;

  state = PlayerState.Running;

  // --- Ground state ---
  grounded = false;
  groundNormal = new THREE.Vector3(0, 1, 0);
  /** Angle between the ground normal and world up, in degrees. */
  slopeAngle = 0;
  groundDistance = Infinity;
  /** Friction coefficient of the surface underfoot, or full grip in the air. */
  groundFriction = 1;
  /** Height of the last ground the cat actually stood on. */
  lastGroundY = 0;
  /** True when a face too steep to climb is directly ahead. */
  wallAhead = false;

  // --- Derived motion, read by camera / HUD / debug ---
  speed = 0;
  horizontalSpeed = 0;
  slipSpeed = 0;
  /**
   * Skidding across a low-grip roof.
   *
   * NOT the duck-slide - see {@link isDucking}. This one is a *consequence* of
   * the surface and the player never asks for it; the names are unfortunately
   * close and the two are unrelated.
   */
  isSliding = false;
  /**
   * True while the cat is tucked under something.
   *
   * A held pose, not a timed one: true for exactly as long as `input.slide`
   * is held (and the cat is grounded and alive), false the instant it's
   * released - see `tickTimers()`/`updateDucking()`. The capsule is
   * deliberately not resized - obstacles that can be ducked test this flag
   * instead, which keeps the collider a constant the rest of the controller
   * can rely on. See `Clothesline`.
   */
  isDucking = false;

  // --- Track state ---
  /** Which run of the RunPath the cat is committed to. */
  segment = 0;
  /** Target lane, -1 left .. +1 right. */
  lane = 0;
  /** Signed offset from the segment centreline, positive right. */
  lateral = 0;
  /** True while inside a corner's turn window. */
  /**
   * Ghost mode: obstacles stop existing for the runner.
   *
   * Set for the whole of Catnip Rush, which is a "you cannot lose this" power
   * (see `Game.readDriveInput`). Turning it on is not just a cosmetic
   * pass-through - it takes `GROUP.OBSTACLE` out of the capsule's own
   * collision filter, so the solver never resolves a contact in the first
   * place, and it silences the three paths that can bill the player for one
   * anyway: {@link probeWall}'s rising-edge crash, {@link handleContact}, and
   * {@link reportObstacleHit} (the colliderless clothesline/beam hazards).
   *
   * Ground is deliberately still solid. The runner has to keep landing on
   * roofs, and `detectBlocked` still exists for geometry it genuinely cannot
   * climb - but with every obstacle phased out there is nothing left on the
   * deck to wedge against.
   *
   * Read back by `ChunkBuilder.step()` through {@link isPhasing}, which turns
   * "the crate was not there" into "the crate was demolished" - a
   * pass-through nobody can see is indistinguishable from a collision bug.
   */
  private phasing = false;

  inTurnZone = false;
  /** Direction the pending corner turns, or 0 when there isn't one. */
  pendingTurn: -1 | 0 | 1 = 0;
  /**
   * Distance still to run before the pending corner, or Infinity when there
   * isn't one. Negative once past it and inside the late-turn grace.
   *
   * Read by the HUD so the turn warning can tighten as the corner closes;
   * `inTurnZone` alone is a boolean and cannot express urgency.
   */
  turnDistance = Infinity;
  /**
   * A turn the player has asked for and that is waiting for the corner.
   *
   * Read by the HUD so the warning can acknowledge the input rather than
   * carrying on flashing at someone who has already pressed.
   */
  turnBuffered: -1 | 0 | 1 = 0;

  // --- Timers ---
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private jumpCooldownTimer = 0;
  /** `isDucking` as of last step - not read for physics, only to fire
   *  `onDuck` on the rising edge, the same "derive the edge from the state"
   *  pattern `Cat.ts`'s own `wasDucking` uses for its animation rewind. */
  private wasDucking = false;
  private stumbleTimer = 0;
  private airTime = 0;
  /** `airTime` as it stood the instant before a landing zeroed it - see
   *  `MIN_AIRBORNE_FOR_LANDING`. */
  private lastAirborneTime = 0;
  private blockedTimer = 0;
  /** Set on jump, cleared only by a genuine landing. Blocks air jumps. */
  private jumpConsumed = false;

  // --- Lane change tween ---
  /** Seconds elapsed into the current lane change, or >= duration when idle. */
  private laneTimer = 0;
  private laneDuration = 0;
  /** Lateral offset the tween started from. */
  private laneFrom = 0;
  /** Lateral offset the tween is heading to. */
  private laneTo = 0;

  /** Fastest downward speed reached during the current airborne period. */
  private peakFallSpeed = 0;
  private wasGrounded = true;

  private spawnPos = new THREE.Vector3();
  private spawnYaw = 0;

  /** The lane track. Null before a level is built. */
  private path: RunPath | null = null;
  /** Heading actually being rendered and run along. */
  private yaw = 0;
  /** Heading the current segment wants. */
  private targetYaw = 0;
  /** Collider the ground probe last found, so contacts can ignore the floor. */
  private groundColliderHandle = -1;

  constructor(
    private physics: PhysicsWorld,
    private events: PlayerEvents = {},
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  spawn(position: THREE.Vector3, yaw = 0): void {
    this.spawnPos.copy(position);
    this.spawnYaw = yaw;

    if (!this.body) this.createBody();
    this.reset();
  }

  /** Hands the controller the track it should run along. */
  setPath(path: RunPath | null): void {
    this.path = path;
    if (!path || !this.body) return;
    this.lockToPath();
  }

  /**
   * Swaps in a rebuilt path *without* resetting track state.
   *
   * `setPath()` calls `lockToPath()`, which is correct at a level start but
   * would yank the runner back to the centre lane every time it fires - which
   * is unusable for the procedural track, where the path is rebuilt every
   * time a new chunk extends it (`RouteGrowth.extend()`), possibly several
   * times a second.
   *
   * Safe specifically because `RouteGrowth` only ever *appends* route points:
   * `RunPath`'s merge/corner pass scans strictly left to right, so every
   * segment index at or behind the runner is unchanged by the rebuild, and
   * `this.segment` stays a valid index into the new path. See
   * `tests/procedural.test.ts` for the index-stability check this relies on.
   */
  extendPath(path: RunPath): void {
    this.path = path;
  }

  private createBody(): void {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(this.spawnPos.x, this.spawnPos.y, this.spawnPos.z)
      .setLinearDamping(PHYSICS.linearDamping)
      .setAngularDamping(PHYSICS.angularDamping)
      // Rapier's own sleeping would freeze the cat mid-run.
      .setCanSleep(false)
      .setCcdEnabled(true);

    this.body = this.physics.world.createRigidBody(desc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(
      PHYSICS.colliderHalfHeight,
      PHYSICS.colliderRadius,
    )
      .setMass(PHYSICS.mass)
      // Friction is nearly irrelevant now that horizontal velocity is written
      // outright, but keeping it low stops the solver fighting the prescription
      // at seams. The surface's own coefficient is read back in probeGround and
      // applied as a lane-seek penalty instead.
      .setFriction(0.15)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0.05)
      .setCollisionGroups(
        collisionGroups(GROUP.PLAYER, GROUP.GROUND | GROUP.OBSTACLE | GROUP.SENSOR),
      );

    this.collider = this.physics.world.createCollider(colliderDesc, this.body);
    // `colliderDesc` above always carries the un-phased filter, so a body
    // rebuilt while phasing was on would silently go solid again. Re-apply.
    if (this.phasing) {
      this.collider.setCollisionGroups(
        collisionGroups(GROUP.PLAYER, GROUP.GROUND | GROUP.SENSOR),
      );
    }
    this.physics.trackBody(this.body);
    this.physics.onContact(this.collider, (info) =>
      this.handleContact(info.started, info.otherHandle),
    );
  }

  /** Returns the cat to its spawn point with all state cleared. */
  reset(): void {
    this.yaw = this.spawnYaw;
    this.targetYaw = this.spawnYaw;
    _quat.setFromAxisAngle(WORLD_UP, this.spawnYaw);

    this.body.setTranslation(this.spawnPos, true);
    this.body.setRotation(_quat, true);
    this.body.setLinvel(ZERO, true);
    this.body.setAngvel(ZERO, true);
    this.physics.resetInterpolation(this.body);

    this.state = PlayerState.Running;
    this.grounded = false;
    this.groundNormal.set(0, 1, 0);
    this.slopeAngle = 0;
    this.groundDistance = Infinity;
    this.groundFriction = 1;
    this.groundColliderHandle = -1;
    this.lastGroundY = this.spawnPos.y;
    this.wallAhead = false;
    this.speed = 0;
    this.horizontalSpeed = 0;
    this.slipSpeed = 0;
    this.isSliding = false;
    this.isDucking = false;
    this.wasDucking = false;

    this.lane = 0;
    this.lateral = 0;
    this.inTurnZone = false;
    this.pendingTurn = 0;
    this.turnDistance = Infinity;
    this.turnBuffered = 0;
    this.cancelLaneChange();

    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.jumpCooldownTimer = 0;
    this.stumbleTimer = 0;
    this.airTime = 0;
    this.blockedTimer = 0;
    this.jumpConsumed = false;
    this.peakFallSpeed = 0;
    this.wasGrounded = true;
    // A fresh run never inherits Catnip Rush's ghost mode from the last one.
    this.setPhasing(false);

    this.lockToPath();
  }

  /**
   * Puts the runner back on the track: nearest segment, centre lane, facing
   * along the run. Used by spawn, respawn and every life-loss recovery.
   */
  private lockToPath(): void {
    if (!this.path || !this.body) {
      if (!this.path) {
        console.warn('[player] lockToPath() called with no path set - spawn/recovery position is a no-op');
      }
      return;
    }

    const t = this.body.translation();
    _v1.set(t.x, t.y, t.z);

    this.segment = this.path.nearestSegment(_v1);
    this.lane = 0;
    this.lateral = this.path.lateralOf(this.segment, _v1);
    this.cancelLaneChange();
    this.yaw = this.path.segments[this.segment].yaw;
    this.targetYaw = this.yaw;

    _quat.setFromAxisAngle(WORLD_UP, this.yaw);
    this.body.setRotation(_quat, true);
    this.physics.resetInterpolation(this.body);
  }

  /**
   * Teleports the runner to a point on the track and resumes running.
   * The caller owns the "is this somewhere safe" decision.
   */
  recoverTo(position: THREE.Vector3): void {
    if (!this.body) return;

    this.body.setTranslation(position, true);
    this.body.setLinvel(ZERO, true);
    this.body.setAngvel(ZERO, true);

    this.state = PlayerState.Running;
    this.stumbleTimer = 0;
    this.blockedTimer = 0;
    this.jumpConsumed = false;
    this.peakFallSpeed = 0;
    this.wasGrounded = true;
    this.grounded = true;
    this.lastGroundY = position.y;

    this.lockToPath();
    this.physics.resetInterpolation(this.body);
  }

  /**
   * Turns {@link phasing} on or off. Idempotent, and safe to call before the
   * body exists (the menu's attract screen has no collider yet).
   */
  setPhasing(enabled: boolean): void {
    if (this.phasing === enabled) return;
    this.phasing = enabled;
    this.collider?.setCollisionGroups(
      collisionGroups(
        GROUP.PLAYER,
        enabled ? GROUP.GROUND | GROUP.SENSOR : GROUP.GROUND | GROUP.OBSTACLE | GROUP.SENSOR,
      ),
    );
  }

  /** Whether obstacles are currently phased out - see {@link phasing}. */
  get isPhasing(): boolean {
    return this.phasing;
  }

  dispose(): void {
    if (!this.body) return;
    this.physics.offContact(this.collider);
    this.physics.untrackBody(this.body);
    this.physics.world.removeRigidBody(this.body);
    this.body = undefined as unknown as RAPIER.RigidBody;
  }

  // -------------------------------------------------------------------------
  // Fixed step
  // -------------------------------------------------------------------------

  step(dt: number, input: RunInput): void {
    if (!this.body) return;

    this.tickTimers(dt, input);
    this.readVelocity();
    this.probeGround();
    this.detectLanding();

    if (this.state === PlayerState.Dead) return;

    this.trackProgress();
    this.applyTurnInput(input);
    this.applyLaneInput(input);

    this.applyHeading(dt);
    this.probeWall();
    this.applyRunVelocity(dt);
    this.tryStepUp();
    this.tryJump();
    this.updateDucking(input);
    this.detectBlocked(dt);
  }

  private tickTimers(dt: number, input: RunInput): void {
    if (input.jump) this.jumpBufferTimer = PHYSICS.jumpBufferTime;
    else this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);

    this.jumpCooldownTimer = Math.max(0, this.jumpCooldownTimer - dt);

    // A first-pass value, off *last* step's `grounded` - `updateDucking()`
    // (after `probeGround()`/`detectLanding()` below have this step's real
    // answer) corrects it, the same two-pass shape `tryJump()`'s coyote/buffer
    // handling uses for the same reason. There is nothing to tuck against
    // mid-air, so airborne is never ducking regardless of how long `slide`
    // has been held.
    this.isDucking = input.slide && this.grounded && this.state !== PlayerState.Dead;

    if (this.stumbleTimer > 0) {
      this.stumbleTimer -= dt;
      if (this.stumbleTimer <= 0 && this.state === PlayerState.Stumbling) {
        this.state = PlayerState.Running;
      }
    }
  }

  private readVelocity(): void {
    const v = this.body.linvel();
    _vel.set(v.x, v.y, v.z);
    this.speed = _vel.length();
    _horiz.set(v.x, 0, v.z);
    this.horizontalSpeed = _horiz.length();
  }

  /**
   * Finds the ground with a downward ray from the capsule centre.
   * Anything steeper than maxSlopeAngle is treated as a wall, not a floor.
   */
  private probeGround(): void {
    const t = this.body.translation();
    _v1.set(t.x, t.y, t.z);

    const reach =
      PHYSICS.colliderHalfHeight +
      PHYSICS.colliderRadius +
      PHYSICS.groundRayLength +
      PHYSICS.groundProbeExtra;

    const hit = this.physics.raycast(
      _v1,
      _down,
      reach,
      this.body,
      collisionGroups(GROUP.PLAYER, GROUP.GROUND | GROUP.OBSTACLE),
    );

    const standDistance =
      PHYSICS.colliderHalfHeight + PHYSICS.colliderRadius + PHYSICS.groundRayLength;

    if (hit) {
      this.groundDistance = hit.distance;
      const normal = _v2.copy(hit.normal);
      // A ray can report the back face when starting inside geometry.
      if (normal.y < 0) normal.negate();
      const angle = THREE.MathUtils.radToDeg(
        Math.acos(THREE.MathUtils.clamp(normal.y, -1, 1)),
      );

      const standable =
        angle <= PHYSICS.maxSlopeAngle &&
        hit.distance <= standDistance &&
        _vel.y <= JUMP_RISE_GUARD;
      if (standable) {
        this.grounded = true;
        this.groundNormal.copy(normal);
        this.slopeAngle = angle;
        // The surface's own coefficient, straight off the collider. This is the
        // only thing left that makes a metal roof feel different from a tiled
        // one now that the drive is prescribed.
        this.groundFriction = hit.collider.friction();
        this.groundColliderHandle = hit.collider.handle;
        this.lastGroundY = _v1.y - hit.distance;
      } else {
        this.grounded = false;
        if (angle > PHYSICS.maxSlopeAngle) this.slopeAngle = angle;
      }
    } else {
      this.groundDistance = Infinity;
      this.grounded = false;
      this.slopeAngle = 0;
      this.groundColliderHandle = -1;
    }

    if (this.grounded) {
      this.coyoteTimer = PHYSICS.coyoteTime;
      // Captured before the reset below so detectLanding() can tell a real
      // landing from a single-step probe flicker - see MIN_AIRBORNE_FOR_LANDING.
      this.lastAirborneTime = this.airTime;
      this.airTime = 0;
      this.groundNormal.normalize();
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - PHYSICS.fixedTimeStep);
      this.airTime += PHYSICS.fixedTimeStep;
      this.groundFriction = PHYSICS.fullGripFriction;
      this.groundNormal.lerp(WORLD_UP, 0.12).normalize();
      this.peakFallSpeed = Math.max(this.peakFallSpeed, -_vel.y);
    }
  }

  /** Converts an airborne -> grounded transition into a landing reaction. */
  private detectLanding(): void {
    // Settled on the ground and no longer rising - the jump is spent, so the
    // next press is allowed. Checking vertical velocity is what stops the latch
    // clearing during the brief "still grounded" window at the start of a rise.
    if (this.grounded && _vel.y <= 0.1) this.jumpConsumed = false;

    if (this.grounded && !this.wasGrounded) {
      // A landing this brief was never really airborne - see
      // MIN_AIRBORNE_FOR_LANDING. peakFallSpeed still resets below either way,
      // since a flicker never accumulated a meaningful fall speed anyway.
      if (this.lastAirborneTime >= MIN_AIRBORNE_FOR_LANDING) {
        const impact = this.peakFallSpeed;
        const hard = impact >= PHYSICS.hardLandingSpeed;

        if (hard) {
          this.state = PlayerState.Stumbling;
          this.stumbleTimer = PHYSICS.stumbleDuration;
        }

        this.events.onLand?.(impact, hard);
      }
      this.peakFallSpeed = 0;
    }
    this.wasGrounded = this.grounded;
  }

  // -------------------------------------------------------------------------
  // Track
  // -------------------------------------------------------------------------

  /**
   * Advances the committed segment and works out whether a corner is in reach.
   *
   * Soft junctions are crossed automatically the moment the runner passes them.
   * Turn junctions are *not*: the segment index stays put until the player earns
   * it, so a missed corner leaves the runner pointing down the old run and
   * carries it off the roof, which is the whole point.
   */
  private trackProgress(): void {
    if (!this.path) return;

    const t = this.body.translation();
    _v1.set(t.x, t.y, t.z);

    // Cleared up front rather than in each exit branch. The walk below breaks
    // out of four different places - no junction, a soft bend not yet reached,
    // the end of the path - and only one of them used to clear these, so a soft
    // bend after a corner left the HUD warning about a corner already taken.
    this.inTurnZone = false;
    this.pendingTurn = 0;
    this.turnDistance = Infinity;

    for (;;) {
      const segment = this.path.segments[this.segment];
      if (!segment) break;

      const junction = this.path.junctionAfter(this.segment);
      if (!junction) break;

      const along = this.path.alongOf(this.segment, _v1);
      const remaining = segment.length - along;

      if (junction.kind === 'soft') {
        if (remaining > 0) break;
        this.segment++;
        continue;
      }

      // A real corner. Offer it while approaching and briefly after.
      this.turnDistance = remaining;
      this.inTurnZone =
        remaining <= PHYSICS.turnZoneBefore && remaining >= -PHYSICS.turnZoneAfter;
      this.pendingTurn = this.inTurnZone ? junction.turnDir : 0;
      break;
    }

    const segment = this.path.segments[this.segment];
    if (!segment) return;

    this.lateral = this.path.lateralOf(this.segment, _v1);
    this.targetYaw = segment.yaw;

    // Out of the window without the corner having been taken - the runner
    // missed it, and a booked turn must not fire at whatever junction comes
    // next. Also covers the frame after a successful turn.
    if (!this.inTurnZone) this.turnBuffered = 0;
  }

  /**
   * Takes the corner, if one is in reach and the player asked for it.
   *
   * A **single sideways press in the corner's direction is enough**. It used to
   * require a double-tap inside 280 ms and nothing else would do, so the
   * obvious input - press left at a left corner - silently changed lane and
   * carried the runner straight off the roof. The double-tap still works, and
   * the gamepad's dedicated turn buttons still bypass all of this by setting
   * `input.turn` directly; this just stops the natural press being ignored.
   *
   * Handedness lines up on its own: `InputManager.registerTap(-1)` for a left
   * press banks `laneStep -= 1`, and `RunPath` reports `turnDir: -1` for a left
   * corner, so the sign of the lane step is already the turn direction.
   */
  private applyTurnInput(input: RunInput): void {
    if (!this.path) return;
    if (!this.inTurnZone || this.pendingTurn === 0) return;

    if (this.turnBuffered === 0) {
      const request = input.turn !== 0 ? input.turn : Math.sign(input.laneStep);
      if (request !== this.pendingTurn) return;

      // Consume the press. Turn input is applied before lane input, and a
      // double-tap banks two lane steps as well as the turn - so without this
      // the runner rounded the corner, was placed in the centre lane, and was
      // then immediately shoved into an outer one by its own turn input.
      input.laneStep = 0;
      this.turnBuffered = this.pendingTurn;
    }

    // Booked, but the manoeuvre waits for the corner - see turnCommitDistance.
    if (this.turnDistance > PHYSICS.turnCommitDistance) return;

    const junction = this.path.junctionAfter(this.segment);
    if (!junction) return;

    this.turnBuffered = 0;
    this.segment++;
    this.inTurnZone = false;
    this.pendingTurn = 0;
    this.turnDistance = Infinity;

    // Round the corner onto the new run's centre line. Carrying the old lane
    // through would be meaningless: the lanes are perpendicular to the heading,
    // so "left" means something different on the other side of the turn.
    //
    // Cancelling any in-flight tween is not optional. Its endpoints are lateral
    // offsets measured against the OLD segment, and the new segment's `right`
    // is perpendicular to that one - so a lane change started a tenth of a
    // second before the corner would spend the rest of its duration dragging
    // the runner along the new track's centreline instead of across it.
    this.lane = 0;
    this.cancelLaneChange();
    this.targetYaw = this.path.segments[this.segment].yaw;

    this.events.onTurn?.(junction.turnDir);
  }

  /**
   * Commits a lane change and starts its tween.
   *
   * The tween runs from wherever the runner actually is - not from the lane it
   * nominally occupies - so a change requested mid-flight through an earlier
   * one retargets smoothly instead of snapping back to a lane boundary first.
   */
  private applyLaneInput(input: RunInput): void {
    if (input.laneStep === 0) return;
    if (this.state === PlayerState.Dead) return;

    const previous = this.lane;
    this.lane = THREE.MathUtils.clamp(this.lane + input.laneStep, -1, 1);

    const steps = Math.abs(this.lane - previous);
    if (steps === 0) return;

    this.laneFrom = this.lateral;
    this.laneTo = this.lane * PHYSICS.laneSpacing;
    this.laneDuration = Math.min(
      PHYSICS.laneChangeTime * steps,
      PHYSICS.laneChangeMaxTime,
    );
    this.laneTimer = 0;

    this.events.onLaneChange?.(this.lane > previous ? 1 : -1, this.laneDuration);
  }

  /** Ends any lane tween, leaving the hold term to keep the runner in lane. */
  private cancelLaneChange(): void {
    this.laneTimer = 0;
    this.laneDuration = 0;
  }

  /** True while a lane change is still sweeping. */
  get isChangingLane(): boolean {
    return this.laneTimer < this.laneDuration;
  }

  // -------------------------------------------------------------------------
  // Motion
  // -------------------------------------------------------------------------

  /**
   * Writes the heading, easing toward whatever the current run wants.
   *
   * Rotation is assigned rather than torqued, and angular velocity is zeroed in
   * the same step. Without that zero the tangential friction of the prescribed
   * slide keeps torquing the capsule and angularDamping settles it at a
   * permanent ten-degree nose-down - which also sinks the visual, because a
   * pitched capsule's lowest point is further from its centre than
   * capsuleFeetOffset assumes.
   */
  private applyHeading(dt: number): void {
    const delta = wrapAngle(this.targetYaw - this.yaw);
    if (delta !== 0) {
      // Corners get a fixed-duration sweep so they read the same every time;
      // soft bends get an exponential ease.
      const cornerRate = (Math.PI / 2) / PHYSICS.turnBlendTime;
      const easeStep = delta * (1 - Math.exp(-PHYSICS.headingEaseRate * dt));
      const cornerStep = THREE.MathUtils.clamp(delta, -cornerRate * dt, cornerRate * dt);

      this.yaw += Math.abs(cornerStep) > Math.abs(easeStep) ? cornerStep : easeStep;
      this.yaw = wrapAngle(this.yaw);
    }

    _quat.setFromAxisAngle(WORLD_UP, this.yaw);
    this.body.setRotation(_quat, true);
    this.body.setAngvel(ZERO, true);
  }

  /**
   * Writes the horizontal velocity: constant forward, proportional lane seek.
   *
   * The vertical component is read back and written straight through, never
   * derived. Writing a projected vertical would make `vy` positive on every
   * uphill ramp, and detectLanding's `vy <= 0.1` latch would then refuse to
   * clear - so the player could not jump anywhere on a slope.
   */
  private applyRunVelocity(dt: number): void {
    const segment = this.path?.segments[this.segment];
    const authority =
      (this.state === PlayerState.Stumbling ? 0.4 : 1) *
      (this.grounded ? 1 : PHYSICS.airControl);

    // Low-grip roofs cost lane authority and push the runner outward, which is
    // what keeps metal, glass and awning surfaces meaning something.
    const grip = THREE.MathUtils.clamp(
      this.groundFriction / PHYSICS.fullGripFriction,
      0,
      1,
    );

    _forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    let lateralSpeed = 0;
    if (segment) {
      const target = this.lane * PHYSICS.laneSpacing;

      if (this.laneTimer < this.laneDuration) {
        // Tweening. The desired offset is an eased interpolation between the
        // endpoints, and the speed that gets written is whatever closes the
        // remaining distance in one step - so arrival is exact and on schedule
        // rather than asymptotic. Solving for the position error each step,
        // instead of integrating a velocity curve, is also what makes the tween
        // self-correcting: a step the solver refuses (a wall, a shove) is
        // simply made up by the next one.
        //
        // The curve is a quarter-sine ease-*out*, not the smoothstep this used
        // to run. Smoothstep is symmetric, so it starts at zero velocity: a
        // tenth of the way through the tween it has covered 2.8% of the
        // distance, and the first ~40 ms after a press therefore show almost no
        // movement at all. That dead zone is read as input lag even though the
        // tween as a whole is short - the press *did* register, it just looks
        // like it didn't yet.
        //
        // sin(t * PI/2) leaves at full speed and decelerates into the lane,
        // which is the shape an arcade lane-change wants: 15.6% of the distance
        // covered in the first tenth, 5.5x smoothstep's, for a peak rate of
        // only PI/2 (1.571x average) against smoothstep's 1.5x. Nearly all of
        // the responsiveness, at nearly none of the peak-speed cost - which
        // matters because `maxLaneSpeed` has to clear that peak or the clamp
        // flattens the ease back into the drift the tween replaced.
        this.laneTimer = Math.min(this.laneTimer + dt, this.laneDuration);
        const t = this.laneDuration > 0 ? this.laneTimer / this.laneDuration : 1;
        const eased = Math.sin(t * (Math.PI / 2));
        const desired = this.laneFrom + (this.laneTo - this.laneFrom) * eased;
        lateralSpeed = ((desired - this.lateral) / dt) * grip * authority;
      } else {
        // Arrived. This is the hold term: it does not drive lane changes any
        // more, it just resists drift and being pushed off the line.
        lateralSpeed = (target - this.lateral) * PHYSICS.laneSnapRate * grip * authority;
      }

      lateralSpeed = THREE.MathUtils.clamp(
        lateralSpeed,
        -PHYSICS.maxLaneSpeed,
        PHYSICS.maxLaneSpeed,
      );

      // Sliding outward on a low-grip surface, away from the centre line.
      if (this.grounded && grip < 1) {
        lateralSpeed += Math.sign(this.lateral || 1) * (1 - grip) * PHYSICS.lowGripDrift;
      }
    }

    // Pushing into a face the runner cannot climb is what makes the solver
    // extrude it upward, so stop pushing - it is stopped, and detectBlocked
    // below is what turns that into a crash.
    const forwardSpeed = this.wallAhead
      ? 0
      : PHYSICS.runSpeed * (this.state === PlayerState.Stumbling ? 0.75 : 1);

    _v1.copy(_forward).multiplyScalar(forwardSpeed);
    if (segment) _v1.addScaledVector(segment.right, lateralSpeed);

    // Follow the slope rather than launching off the top of a ramp. Only the
    // horizontal part is rotated; vy stays whatever the solver made it.
    if (this.grounded && this.slopeAngle > 1) {
      const into = _v1.dot(this.groundNormal);
      _v1.addScaledVector(this.groundNormal, -into);
    }

    // Slip is *unintended* sideways motion - that is what the dust, the skid
    // loop and the cat's lean are all reacting to. A commanded lane change is
    // not slipping, and now that the tween peaks near 20 u/s rather than the
    // seek's 11, counting it would put the runner permanently in a skid every
    // time they changed lane.
    this.slipSpeed = this.laneTimer < this.laneDuration ? 0 : Math.abs(lateralSpeed);
    this.isSliding = this.grounded && this.slipSpeed > PHYSICS.slipThreshold;
    if (this.isSliding) this.events.onSlide?.(this.slipSpeed);

    const v = this.body.linvel();
    this.body.setLinvel({ x: _v1.x, y: v.y, z: _v1.z }, true);
  }

  /**
   * Looks for a face directly ahead that the step-up assist cannot lift the
   * runner over.
   *
   * Without this the runner keeps writing a full runSpeed straight into the
   * wall every step. The solver cannot satisfy both that and non-penetration,
   * and the measured result is not a stop but a slow upward extrusion - the cat
   * climbs the wall at half a unit per second and eventually floats off the top
   * of it, breaking free at full speed one step in five on the way.
   *
   * The probe starts just above the tallest lip tryStepUp can handle, so a
   * climbable seam never reads as a wall, and anything shallow enough to stand
   * on is treated as a ramp rather than an obstruction.
   */
  private probeWall(): void {
    const wasBlocked = this.wallAhead;
    this.wallAhead = false;
    // Airborne, the same cut would kill a jump the moment the far side of a gap
    // came into probe range, and the extrusion only ever happens on the ground.
    // wasBlocked is captured above, before this return, so going airborne reads
    // as a falling edge next grounded step rather than a spurious collision now.
    if (!this.grounded) return;

    const t = this.body.translation();
    const footY = t.y - this.groundDistance;

    _v1.set(t.x, footY + PHYSICS.maxStepUp + 0.06, t.z);
    _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    const hit = this.physics.raycast(
      _v1,
      _v2,
      PHYSICS.colliderRadius + 0.3,
      this.body,
      // Phasing: obstacles are not in the capsule's collision filter either,
      // so leaving them in this probe's would stop the runner dead in front
      // of something it is supposed to be running straight through.
      collisionGroups(
        GROUP.PLAYER,
        this.phasing ? GROUP.GROUND : GROUP.GROUND | GROUP.OBSTACLE,
      ),
    );
    if (!hit) return;

    const angle = THREE.MathUtils.radToDeg(
      Math.acos(THREE.MathUtils.clamp(Math.abs(hit.normal.y), 0, 1)),
    );
    this.wallAhead = angle > PHYSICS.maxSlopeAngle;

    // Fire the crash here rather than waiting for handleContact. The probe
    // deliberately stops the runner ~0.3 units short of the face - that gap is
    // what stops the solver extruding the capsule up the wall - so the contact
    // that used to report this now never happens. Only the rising edge counts:
    // wallAhead stays true for as long as the runner sits there, and
    // detectBlocked is what escalates a runner that cannot get free.
    //
    // Ground geometry still blocks, but does not bill for it - see
    // {@link isObstacle}. The runner is still stopped by the side of a
    // building; it just is not charged the instant it touches one.
    //
    // Bug fix: `wallAhead` only proves something solid sits along the probe
    // ray - it says nothing about which way the body is actually *moving*.
    // During a fast lane-change tween (maxLaneSpeed, more than double
    // runSpeed) the real velocity can be mostly sideways for a step or two
    // while the ray still catches an obstacle's edge, charging a full crash -
    // life lost, damage flash - for what reads to the player as a graze they
    // were already dodging past. handleContact() already guards its own
    // crash report the same way (`alignment < 0.35` -> ignore); this mirrors
    // that exact check and threshold rather than inventing a new one. `_v2`
    // is this step's forward heading, already computed above for the ray
    // itself; `_horiz`/horizontalSpeed are this step's real velocity, read
    // once in readVelocity() and untouched since.
    const alignment =
      this.horizontalSpeed > 1e-4
        ? (_horiz.x * _v2.x + _horiz.z * _v2.z) / this.horizontalSpeed
        : 1;

    if (
      this.wallAhead &&
      !wasBlocked &&
      isObstacle(hit.collider) &&
      this.horizontalSpeed >= PHYSICS.collisionMinSpeed &&
      alignment >= 0.35
    ) {
      this.events.onCollision?.(this.horizontalSpeed);
    }
  }

  /**
   * Lifts the runner over a lip it would otherwise wedge against.
   *
   * With velocity prescribed every step, contact resolution wins at a vertical
   * face and nothing ever supplies the vertical speed to climb it, so a 0.4-unit
   * seam is a permanent stop rather than a bump. A forward probe finds standable
   * ground just above the current footing and writes the capsule up onto it.
   */
  private tryStepUp(): void {
    if (!this.grounded) return;
    if (this.groundDistance === Infinity) return;

    const t = this.body.translation();
    const probeAhead = PHYSICS.colliderRadius + 0.25;

    _v2.set(
      t.x + _forward.x * probeAhead,
      t.y + PHYSICS.maxStepUp,
      t.z + _forward.z * probeAhead,
    );

    const reach = PHYSICS.maxStepUp + PHYSICS.colliderHalfHeight + PHYSICS.colliderRadius + 0.3;
    const hit = this.physics.raycast(
      _v2,
      _down,
      reach,
      this.body,
      collisionGroups(GROUP.PLAYER, GROUP.GROUND),
    );
    if (!hit) return;

    const aheadY = _v2.y - hit.distance;
    const footY = t.y - this.groundDistance;
    const rise = aheadY - footY;

    if (rise <= 0.06 || rise > PHYSICS.maxStepUp) return;

    // The lip is climbable: write the capsule up so the next step clears it.
    _v3.set(t.x, t.y + rise, t.z);
    this.body.setTranslation(_v3, true);
    this.lastGroundY = aheadY;
  }

  private tryJump(): void {
    if (this.jumpBufferTimer <= 0) return;
    if (this.jumpCooldownTimer > 0) return;
    // One jump per airborne period, enforced by a latch rather than by the
    // cooldown alone. The ground probe deliberately reaches a little way below
    // the cat, so "grounded" stays true for the first fraction of a rise - with
    // only a timer, a held jump button could fire again during that window and
    // stack impulses into an ever-higher climb.
    if (this.jumpConsumed) return;
    // Coyote time is the only thing that permits a jump off a ledge.
    if (!this.grounded && this.coyoteTimer <= 0) return;

    const v = this.body.linvel();
    // Vertical is replaced so jump height is consistent whether rising or
    // falling; horizontal is already being prescribed every step anyway.
    this.body.setLinvel({ x: v.x, y: Math.max(v.y, 0), z: v.z }, true);

    _v1.copy(WORLD_UP).multiplyScalar(PHYSICS.jumpImpulse * PHYSICS.mass);
    this.body.applyImpulse(_v1, true);

    this.jumpBufferTimer = 0;
    this.coyoteTimer = 0;
    this.jumpCooldownTimer = PHYSICS.jumpCooldown;
    this.jumpConsumed = true;
    this.grounded = false;
    this.wasGrounded = false;
    this.peakFallSpeed = 0;

    this.events.onJump?.();
  }

  /**
   * Forced upward launch - a trampoline pad, not a jump the player asked
   * for. Same underlying mechanic as {@link tryJump} (vertical velocity is
   * replaced rather than added, for the same reason: consistent height
   * whether rising or falling into the pad), just triggered by
   * `ChunkBuilder`'s own position check against the pad instead of buffered
   * input, and sized for the specific apex height a roof-tier trampoline
   * needs rather than the fixed standing-jump height.
   *
   * Reuses `events.onJump` rather than a new event, so the existing jump
   * sound/animation wiring in `Game.ts`/`Cat.onJump()` fires for free - "use
   * the existing jump animation" per the request that added this.
   */
  launchUpward(velocity: number): void {
    const v = this.body.linvel();
    this.body.setLinvel({ x: v.x, y: Math.max(v.y, 0), z: v.z }, true);

    _v1.copy(WORLD_UP).multiplyScalar(velocity * PHYSICS.mass);
    this.body.applyImpulse(_v1, true);

    this.jumpBufferTimer = 0;
    this.coyoteTimer = 0;
    this.jumpCooldownTimer = PHYSICS.jumpCooldown;
    this.jumpConsumed = true;
    this.grounded = false;
    this.wasGrounded = false;
    this.peakFallSpeed = 0;

    this.events.onJump?.();
  }

  /**
   * The authoritative `isDucking` for this step, and where `onDuck` actually
   * fires.
   *
   * `tickTimers()` already set a provisional value off *last* step's
   * `grounded`. This corrects it: runs after `probeGround()`/`detectLanding()`,
   * so `this.grounded` here is this step's real answer - the case that
   * matters is a slide held (or pressed) on the exact step the runner lands,
   * which `tickTimers()`'s stale read would otherwise miss for one step.
   *
   * `onDuck` fires here, not in `tickTimers()`, for the same reason: it must
   * fire off the *real* grounded answer, and only on the rising edge of
   * `isDucking` (tracked via `wasDucking`) - once per hold, not once per
   * step, since a hold spans many steps but the sound/pose-start event it
   * drives (`Game.ts`'s `onDuck` callback) should not.
   *
   * No `state !== PlayerState.Dead` check needed here - `step()` only calls
   * this after its own Dead early-return, so `isDucking` simply freezes at
   * whatever `tickTimers()` last set it to (false, by its own Dead check)
   * once the runner dies.
   */
  private updateDucking(input: RunInput): void {
    this.isDucking = input.slide && this.grounded;

    if (this.isDucking && !this.wasDucking) this.events.onDuck?.();
    this.wasDucking = this.isDucking;
  }

  /**
   * Notices when the runner has been stopped by something it cannot climb.
   *
   * Nothing else would: contacts only fire on start, the prescribed velocity
   * keeps being written, and the body simply sits against the face until the
   * pursuers arrive. Reading the *body's* speed rather than the prescribed one
   * is what makes this work - the body correctly reports nearly zero.
   */
  private detectBlocked(dt: number): void {
    if (!this.grounded || this.state === PlayerState.Dead) {
      this.blockedTimer = 0;
      return;
    }

    if (this.horizontalSpeed > PHYSICS.runSpeed * 0.2) {
      // Decay rather than reset: a body jammed against geometry breaks free for
      // the odd single step, and a hard reset let that hide a permanent stop.
      this.blockedTimer = Math.max(0, this.blockedTimer - dt * 2);
      return;
    }

    this.blockedTimer += dt;
    if (this.blockedTimer < PHYSICS.blockedGraceTime) return;

    this.blockedTimer = 0;
    this.events.onBlocked?.();
  }

  // -------------------------------------------------------------------------
  // Collisions
  // -------------------------------------------------------------------------

  private handleContact(started: boolean, otherHandle: number): void {
    if (!started || this.state === PlayerState.Dead) return;
    if (this.phasing) return;

    // Running onto a floor is not a collision. The old test for this compared
    // groundDistance against 0.1, but groundDistance is a raycast from the
    // capsule *centre* and reads about 0.5 at rest - so it never passed, and
    // every landing and platform seam fired a knockback. Comparing collider
    // handles is exact.
    if (otherHandle === this.groundColliderHandle) return;

    // ...but the handle comparison only excuses the ONE surface the ground ray
    // happens to be reporting this step, and a level is full of others. Planks,
    // ramps and every roof slab are all GROUP.GROUND, so standing on roof A and
    // clipping plank B's edge used to read as a crash and cost a life. It was
    // easy to hit: a plank narrower than the lane span leaves both outer lanes
    // hanging over its side.
    //
    // Walkable geometry is not an obstacle. Running into a piece of it that
    // cannot be climbed still ends the run, through detectBlocked's grace
    // period, which is the mechanism that can tell "wedged" from "brushed".
    if (!isObstacle(this.physics.world.getCollider(otherHandle))) return;

    const v = this.body.linvel();
    _v1.set(v.x, 0, v.z);
    const speed = _v1.length();
    if (speed < PHYSICS.collisionMinSpeed) return;

    _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    // Only react to hits that are meaningfully head-on.
    const alignment = (_v1.x * _v2.x + _v1.z * _v2.z) / speed;
    if (alignment < 0.35) return;

    if (this.state === PlayerState.Running) {
      this.state = PlayerState.Stumbling;
      this.stumbleTimer = PHYSICS.stumbleDuration * 0.7;
    }

    this.events.onCollision?.(speed);
  }

  /**
   * Reports a hit from an obstacle that has no collider of its own.
   *
   * Most obstacles are solid and reach the player through {@link handleContact}.
   * A clothesline cannot be: a rope the capsule bounces off would be a wall the
   * player is asked to run through, and the whole point of the obstacle is that
   * you *do* pass through it, tucked. So it tests its own overlap and calls
   * this, which puts it on exactly the same footing as a crate - same stumble,
   * same event, same cost - without a collider that would also stop a cat who
   * ducked correctly.
   *
   * Silently ignored below `collisionMinSpeed`, matching the contact path: a
   * cat that has already been stopped by something else is not crashing again.
   *
   * Also gated on alignment, same threshold and reasoning as
   * `handleContact()`'s own `alignment < 0.35` check (and `detectBlocked()`'s
   * mirror of it): a hazard clipped at a shallow angle - mid lane-change,
   * mid-turn, or just grazed while mostly past it - is not the same event as
   * running straight into it, and didn't used to be excused here the way it
   * already was on every other contact path. This was the actual source of
   * the reported false-positive stumble: `reportObstacleHit()`'s only real
   * caller (`ChunkBuilder`'s duck-under-beam check) already gates on "not
   * ducking" and "actually overlapping," but had nothing gating on
   * direction, so a beam brushed side-on while turning played the full
   * damage animation.
   */
  reportObstacleHit(): void {
    if (this.state === PlayerState.Dead) return;
    // The colliderless hazards route through here rather than through the
    // physics contact path, so phasing has to be honoured a second time.
    if (this.phasing) return;
    if (this.horizontalSpeed < PHYSICS.collisionMinSpeed) return;

    const v = this.body.linvel();
    _v1.set(v.x, 0, v.z);
    _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const alignment = (_v1.x * _v2.x + _v1.z * _v2.z) / this.horizontalSpeed;
    if (alignment < 0.35) return;

    if (this.state === PlayerState.Running) {
      this.state = PlayerState.Stumbling;
      this.stumbleTimer = PHYSICS.stumbleDuration * 0.7;
    }

    this.events.onCollision?.(this.horizontalSpeed);
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /**
   * The body only exists between the first {@link spawn} and {@link dispose},
   * but the render loop runs continuously - it draws the menu before any level
   * has been built, and can have a frame in flight while a level is torn down.
   * Every accessor therefore has to survive being called with no body, or the
   * whole frame (including the `renderer.render` at the end of it) throws.
   */
  get hasBody(): boolean {
    return this.body !== undefined;
  }

  /** Writes the cat's world position into `out`. */
  getPosition(out: THREE.Vector3): THREE.Vector3 {
    if (!this.body) return out;
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  /**
   * The transform to *draw* the cat at, sampled between the last two fixed
   * steps.
   *
   * Anything rendered has to use this rather than {@link getPosition}. Physics
   * advances in fixed 60 Hz steps drained from an accumulator, so a rendered
   * frame drives two steps, one, or none - and reading the raw translation at
   * render rate therefore makes the cat lurch forward and stall. Against a
   * damped camera that reads as the cat shaking. Every other tracked body in
   * the game already goes through this path via `PhysicsWorld.syncObject`; the
   * player was the one thing that did not.
   */
  sampleRenderTransform(outPosition: THREE.Vector3, outRotation: THREE.Quaternion): void {
    if (!this.body) return;
    this.physics.sampleInterpolated(this.body, outPosition, outRotation);
  }

  getRotation(out: THREE.Quaternion): THREE.Quaternion {
    if (!this.body) return out;
    const r = this.body.rotation();
    return out.set(r.x, r.y, r.z, r.w);
  }

  getVelocity(out: THREE.Vector3): THREE.Vector3 {
    if (!this.body) return out.set(0, 0, 0);
    const v = this.body.linvel();
    return out.set(v.x, v.y, v.z);
  }

  /** Heading as a yaw angle, derived from the body's own forward axis. */
  getYaw(): number {
    if (!this.body) return this.spawnYaw;
    const r = this.body.rotation();
    _quat.set(r.x, r.y, r.z, r.w);
    _forward.copy(LOCAL_FORWARD).applyQuaternion(_quat);
    return Math.atan2(_forward.x, _forward.z);
  }

  /** How far the cat has dropped below the last ground it stood on. */
  get fallDepth(): number {
    if (!this.body) return 0;
    return this.lastGroundY - this.body.translation().y;
  }

  /** Marks the attempt failed. Kills all control and lets the body fall. */
  kill(): void {
    this.state = PlayerState.Dead;
  }
}

const ZERO = { x: 0, y: 0, z: 0 };
