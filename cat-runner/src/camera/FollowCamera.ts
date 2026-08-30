import * as THREE from 'three';
import { PHYSICS } from '../physics/PhysicsConfig';
import { PhysicsWorld, GROUP, collisionGroups } from '../physics/PhysicsWorld';
import { CameraShake } from '../effects/CameraShake';

/**
 * Third-person spring camera.
 *
 * Two ideas do most of the work:
 *
 *  1. The camera's yaw tracks the *velocity* direction, not the cat's body yaw.
 *     A spinning cat therefore doesn't whip the camera around - it keeps looking
 *     where the cat is actually travelling, which is what the player needs to
 *     see. Below a threshold speed it falls back to body yaw so a standing cat
 *     still frames sensibly.
 *
 *  2. Position uses frame-rate-independent exponential smoothing rather than a
 *     rigid offset, so the camera lags into turns and settles after landings.
 */

export interface FollowCameraConfig {
  /** Distance behind the cat, in world units (= metres). */
  distance: number;
  /** Height above the cat's paws. */
  height: number;
  /**
   * Downward tilt of the camera's axis from horizontal, in degrees.
   *
   * The framing used to be set by an explicit look-ahead distance, which meant
   * the pitch was an emergent property of three other numbers - change the
   * height and the tilt moved with it, silently. Stating the angle and deriving
   * the look-ahead from it (see {@link lookAheadFor}) is the way round that
   * survives editing.
   */
  pitchDegrees: number;
  /** Height of the look-at point above the cat. */
  lookHeight: number;
  /** Position smoothing rate (horizontal x/z only). Higher = tighter/snappier. */
  positionDamping: number;
  /**
   * Vertical-only smoothing rate, slower than {@link positionDamping} on
   * purpose. `Game.cameraTarget()` anchors the camera's height to the
   * cat's *ground* Y rather than its raw position, so jumps no longer move
   * this target at all - what's left to smooth is real elevation change and
   * the odd step-up bump (`PlayerController.tryStepUp`, up to 0.5 units),
   * both small and infrequent enough that a gentler, dedicated rate reads as
   * "settling" rather than "chasing." Kept separate from `positionDamping`
   * so horizontal responsiveness (lanes, turns) isn't traded away to get it.
   */
  heightDamping: number;
  /** Yaw smoothing rate. */
  rotationDamping: number;
  /** Look-at smoothing rate. */
  lookDamping: number;
  /** Base vertical FOV in degrees. */
  baseFov: number;
  /** Speed below which yaw follows the body instead of velocity. */
  velocityYawMinSpeed: number;
  /** Closest the camera may be pulled in by an obstruction. */
  minOcclusionDistance: number;
}

/**
 * Framing note: all offsets are measured from the cat's *paws*, not the physics
 * capsule's centre - see `Game.cameraTarget`.
 *
 * The player character is a *cat*: roughly 1.1 units nose-to-tail and only 0.3
 * at the shoulder, so it is never going to fill much of the frame. An early
 * pass optimised for exactly that, sitting 1.35 above the cat at ~8 degrees of
 * downward pitch, which made the cat as large as possible and the level
 * unreadable - the horizon sat above centre, so the next roof and the gap
 * before it were simply off-screen and every jump was blind.
 *
 * WHERE THE CAT SITS IN FRAME, because it is not obvious from these numbers and
 * it is the thing that breaks if they are edited carelessly. The camera looks
 * along its own pitch, not at the cat, so the cat's position in frame is the
 * difference between the two angles:
 *
 *   angle down to the cat = atan(height / distance) = atan(3.6 / 1.8) = 63.4 deg
 *   camera axis           = pitchDegrees             =                    34.0 deg
 *   cat below axis         =                                              29.4 deg
 *
 * and half the vertical FOV is `baseFov / 2` = 37.5. The cat therefore
 * projects to y = -tan(29.4)/tan(37.5) = -0.74: comfortably on screen, over
 * `tests/camera.test.ts`'s bottom-edge bound (`> -0.85`) by about 0.11.
 *
 * Note that only the *ratio* appears in that arithmetic. `height`/`distance`
 * was 2/1 on an explicit "distance 1, height 2" request, and is now 3.6/1.8 -
 * the same 2:1, so every angle above, and the cat's y in frame, are exactly
 * where that request put them. What moved is scale, for a reason the ratio
 * cannot express:
 *
 * WHY THE RIG IS NOT AT 1/2 ANY MORE. The cat's *paws* projecting to -0.74
 * says nothing about the rest of it, and at 1/2 the rest of it did not fit. A
 * standing jump apexes 1.73 units up (`jumpImpulse^2 / (2*|gravity|)`) while
 * the camera stays put - `Game.cameraTarget()` anchors its height to ground Y
 * so a jump reads flat - so at apex the cat's head sat 2.73 up against a lens
 * only 2.0 up and 1.0 back: atan(0.73 / 1.0) = 36.3 deg *above* horizontal,
 * and so 70.3 deg above a camera axis pitched 34 deg down. Half the FOV is
 * 37.5 (44.5 at the speed-expanded 89), so the head was off the top of the
 * frame for the whole apex, which is exactly how it was reported. Scaling the
 * rig by 1.8 puts the head 25.7 deg *below* horizontal at the same apex - 8.3
 * deg above the axis (y = 0.19, a fifth of the way up from centre with the
 * whole top of the frame to spare) - because the jump's 1.73
 * is a fixed world distance and does not scale with the rig, so moving the
 * lens away is the only lever that shrinks it in frame.
 *
 * `baseFov` went from 67 to 75 alongside the earlier move in, and stays: at
 * 67 (half-FOV 33.5) this ratio would project the cat to -0.85, exactly on
 * `tests/camera.test.ts`'s bottom-edge bound rather than clear of it.
 *
 * The `positionDamping`/`heightDamping` ratio (~2.17:1) is still untouched -
 * it controls how quickly the camera *chases* a moved target, which is
 * orthogonal to where the rig sits once settled.
 *
 * `distance` is what buys the margin. Raising `height` without moving
 * `distance` out to match is the way this breaks: at 8 up and only, say, 4
 * back the cat falls off the bottom of the frame entirely - see the git
 * history for exactly that regression at a smaller scale. `tests/camera.test.ts`
 * pins the relationship by projecting the cat rather than by repeating this
 * arithmetic. At this height/distance ratio, `pitchDegrees` and `baseFov` are
 * doing far more of the framing work than `distance` alone - any further edit
 * to any of the four needs its margin (and, first, whether the cat is on
 * screen *at all*) re-checked against `tests/camera.test.ts`, not assumed.
 *
 * Trade-off worth knowing about: the cat is 1.0 unit tall and sits
 * sqrt(3.6^2 + 1.8^2) = 4.03 units from the lens (was 2.24, was 3.81, was
 * 4.39, was 5.70, was 7.11, was 9.55, was 13.5, was 38.2, was 34.1, was 25.6,
 * was 21.1, was 20.2, was 16.1, was 12.1, was 11.2, was 6.36 before that), so
 * it is about half the on-screen size it was at 1/2 - that is the price of
 * the jump fitting, paid in apparent size, and it is the cheaper half of the
 * trade because a head cut off by the top edge is not a framing preference.
 * {@link lookAheadFor} goes the other way, to ~3.5 units ahead of the cat
 * (was ~2.0): the sightline that riding at 1/2 had cut to almost nothing.
 *
 * This height is no longer chased vertically by every jump - see
 * `heightDamping` and `Game.cameraTarget()`'s doc comment - so raising it
 * further mainly costs character size on screen, not stability. Jumps in
 * particular stay visually flat: `Game.cameraTarget()` anchors to ground Y,
 * not the cat's raw position, so a jump's arc never moves the camera's own
 * height target at all - which is also why "do not increase camera distance
 * during jumps" needs no extra code here: `distance` is a fixed config
 * number this whole file only ever pulls *in* from via
 * {@link FollowCamera.resolveOcclusion} (an occluder pulling the camera
 * closer to avoid clipping through geometry), never pushes out past, so a
 * jump or a gap crossing was already incapable of enlarging it.
 */
export const DEFAULT_CAMERA: FollowCameraConfig = {
  distance: 1.8,
  height: 3.6,
  pitchDegrees: 34,
  lookHeight: 0.0,
  // Horizontal chase rate. `smoothing()` turns this into an exponential
  // approach, so the time constant is 1/rate: at the old 6.5 the camera took
  // ~154 ms to close 63% of a gap and ~450 ms to visually settle - three times
  // the 0.15 s the lane tween itself takes. The cat arrived in its new lane
  // while the frame was still sliding after it, and that trailing frame is
  // what a player reads as "the lane change lagged," independently of how
  // quickly the character actually moved. At 13 the time constant is ~77 ms,
  // so the camera settles roughly as the tween ends instead of long after it.
  // Raising this costs nothing in stability: the horizontal target is the
  // cat's interpolated position (`PhysicsWorld.sampleInterpolated`), which is
  // already smooth - it is only the *vertical* axis that needed gentling, and
  // that has its own separate `heightDamping` precisely so this one can be
  // stiffened without dragging jump/step-up bumps back into frame.
  positionDamping: 13,
  heightDamping: 3.0,
  rotationDamping: 4.2,
  // Moved with `positionDamping` for the same reason: the aim point trailing
  // the rig re-introduces the swing this was meant to remove.
  lookDamping: 14,
  baseFov: 75,
  velocityYawMinSpeed: 2.5,
  // 54% of the rig's full extension, the same fraction it was at 1/2 - the
  // floor only means "no closer than this relative to where the camera
  // normally sits", so it moves with `distance`/`height` rather than staying
  // an absolute that would swallow most of the rig.
  minOcclusionDistance: 2.16,
};

/**
 * How far ahead of the cat the look-at point has to sit to produce the
 * configured pitch.
 *
 * The camera is `distance` behind and `height` above, so the horizontal run
 * from the camera to the look point is `(height - lookHeight) / tan(pitch)`,
 * and the part of it that lies ahead of the *cat* is that less `distance`.
 */
export function lookAheadFor(config: FollowCameraConfig): number {
  const drop = config.height - config.lookHeight;
  const pitch = THREE.MathUtils.degToRad(config.pitchDegrees);
  return drop / Math.tan(pitch) - config.distance;
}

/**
 * The aspect every number in {@link DEFAULT_CAMERA} was tuned against.
 *
 * Poki asks for a game that scales proportionally from a 16:9 base, and that
 * is also the shape this rig's whole framing argument above is written for.
 */
const REFERENCE_ASPECT = 16 / 9;

/**
 * Widest vertical FOV a narrow viewport may be given.
 *
 * Holding the full 16:9 horizontal field on a 9:16 phone would need about 143
 * degrees vertically, which is not a camera so much as a fisheye - straight
 * parapets bow, and the cat at the bottom of the frame stretches. 88 is about
 * where that becomes noticeable, so the rest of the shortfall is paid for by
 * moving the rig instead.
 */
const MAX_NARROW_FOV = 88;

/**
 * Furthest the rig may be pulled back to buy the lateral coverage FOV alone
 * could not. Past roughly this the cat stops reading as a cat.
 */
const MAX_NARROW_PULLBACK = 2.6;

/**
 * Furthest the *run* rig may be pulled back on a narrow viewport.
 *
 * The compensation itself targets the 16:9 horizontal field (see
 * {@link FollowCamera.framing}), which at 9:16 asks for a factor of 3.16.
 * This is where that stops being worth having, and it binds well before then:
 * the rig is already 4.03 units out at 16:9, so 3.16 would put a phone at
 * 12.7 and the cat at half the size the tests will accept.
 *
 * 1.75 is sized off the thing portrait actually needs, which is not parity
 * with a desktop frustum wide enough to show roof either side of the lanes -
 * it is *the lanes*. At this cap the frustum is 2.65 units wide either side
 * of the cat at its own depth, against a `PHYSICS.laneSpacing` of 2.4, so
 * both neighbouring lanes are in frame level with the cat with a little to
 * spare, and the camera lands 7.04 units out - a cat 59 device pixels tall on
 * Poki's smallest reference panel, which `tests/portrait.test.ts` pins.
 */
const MAX_RUN_PULLBACK = 1.75;

/** What a given viewport shape does to the authored rig. */
export interface ViewportFraming {
  /** Vertical FOV to use in place of `baseFov`. */
  fov: number;
  /** Multiplier on `distance`, `height`, `lookHeight`, `minOcclusionDistance`. */
  rigScale: number;
}

/**
 * Holds a shot's *horizontal* field constant as the viewport narrows.
 *
 * `THREE.PerspectiveCamera.fov` is vertical, so a fixed FOV means the
 * horizontal field is whatever the aspect leaves: 108 degrees across on a
 * landscape phone, but only 39 on the same phone in portrait. Widening the
 * vertical FOV buys most of the difference back (preferred, since it costs
 * nothing in apparent size); a uniform scale of the rig buys the rest.
 * Scaling `distance` and `height` *together* is the point - it leaves
 * `atan(height / distance)` untouched, so the pitch and the composition
 * survive the move; only apparent size and lateral coverage change.
 *
 * At or above the reference aspect this is the identity, so no landscape or
 * desktop framing changes by a pixel.
 *
 * WHO USES THIS. The attract shot only (`Game.updateAttract`), which frames
 * the cat's width inside the clear band between the title lockup and the
 * button column - a genuinely horizontal problem, and one where nothing is
 * being *played*, so trading vertical framing for it costs nothing. The run
 * camera deliberately does not: see {@link FollowCamera.framing} for why
 * matching the desktop shot at every aspect beat matching its lateral
 * coverage.
 */
export function viewportFraming(baseFov: number, aspect: number): ViewportFraming {
  if (!Number.isFinite(aspect) || aspect >= REFERENCE_ASPECT) {
    return { fov: baseFov, rigScale: 1 };
  }

  // The horizontal half-angle the authored rig gets at 16:9 - the target.
  const halfReference = Math.atan(Math.tan(THREE.MathUtils.degToRad(baseFov) / 2) * REFERENCE_ASPECT);

  const wanted = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfReference) / aspect));
  const fov = Math.min(MAX_NARROW_FOV, wanted);

  // Whatever horizontal field that actually bought, and the pull-back needed
  // to cover the difference.
  const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect);
  const rigScale = Math.min(MAX_NARROW_PULLBACK, Math.tan(halfReference) / Math.tan(half));

  return { fov, rigScale };
}

/**
 * How far back the run rig has to move to keep the 16:9 horizontal field on a
 * viewport of `aspect` - see {@link FollowCamera.framing}.
 *
 * Exported so `tests/portrait.test.ts` can state the number rather than
 * re-derive it, and so the one place it is capped is visible from outside.
 */
export function narrowRigScale(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0 || aspect >= REFERENCE_ASPECT) return 1;
  return Math.min(MAX_RUN_PULLBACK, REFERENCE_ASPECT / aspect);
}

const _desired = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _flatVel = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly shake = new CameraShake();

  config: FollowCameraConfig = { ...DEFAULT_CAMERA };

  /** When true, damping is stiffened and shake/FOV effects are suppressed. */
  reducedMotion = false;

  /**
   * Extra degrees of vertical FOV, on top of the speed-derived expansion.
   *
   * Exists because the speed term cannot express a *power-up*: it is a ratio
   * against `PHYSICS.runSpeed`, and Catnip Rush's effect is a multiplier on
   * that same field, so the two cancel and the boost frames identically to
   * cruising (see `Game`'s `CATNIP_FOV_BOOST`). Written by the caller every
   * frame; `currentFov` eases toward the result, so setting and clearing this
   * is the whole animation. Suppressed under {@link reducedMotion}, like
   * every other FOV effect here.
   */
  boostFov = 0;

  private yaw = 0;
  private position = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private currentFov: number;
  private initialised = false;
  /** Current occlusion-resolved camera distance; see {@link resolveOcclusion}. */
  private occlusionClearDistance = Infinity;

  /**
   * The rig this viewport actually gets - see {@link framing}. Mutated in
   * place rather than rebuilt, since it is read on every frame.
   */
  private readonly framingResult: ViewportFraming = {
    fov: DEFAULT_CAMERA.baseFov,
    rigScale: 1,
  };

  constructor(
    aspect: number,
    private physics: PhysicsWorld | null = null,
  ) {
    this.camera = new THREE.PerspectiveCamera(DEFAULT_CAMERA.baseFov, aspect, 0.1, 500);
    this.currentFov = DEFAULT_CAMERA.baseFov;
  }

  /**
   * The authored rig, moved straight back on a narrow viewport - and nothing
   * else touched.
   *
   * Two wrong answers came before this one, and it is worth knowing why each
   * was wrong, because the fix is the half of each that was right.
   *
   * The first ran {@link viewportFraming} over the live aspect: hold the
   * *horizontal* field by widening the lens to 88 degrees and pulling the rig
   * back 2.6x. Pulling back was right. Widening was not - {@link baseFov} is
   * vertical, so on a viewport already twice as tall as it is wide the extra
   * 13 degrees all went into sky and near deck, and worse, it moved the cat.
   * The cat's screen position is `-tan(angle below axis) / tan(fov / 2)`, so
   * opening the lens from 75 to 88 slid it from -0.74 to -0.58 - up out of
   * the lower third and into the middle of the frame. That is what "not the
   * same camera" meant.
   *
   * The second answer was to change nothing at all, which fixed the
   * composition by giving up the compensation with it. At 9:16 a 75-degree
   * vertical lens is 47 degrees across, and from a rig sitting one unit
   * behind the cat that is a frustum barely wider than the cat itself: the
   * neighbouring lanes are off both edges of the screen at the cat's own
   * depth, and the near roof fills the bottom half. Correctly framed, and far
   * too close - which is exactly what it was reported as.
   *
   * So: pull back, and *only* pull back. A uniform scale of `distance` and
   * `height` leaves `atan(height / distance)` alone, and leaves the FOV alone,
   * so every angle in the shot survives it - the horizon sits on the same
   * scanline, the cat projects to the same y, the pitch is the pitch. Nothing
   * about the composition is viewport-dependent; the only thing that changes
   * is how much world fits inside those angles, which is the entire problem.
   * Since the FOV is fixed, the scale needed to hold the 16:9 horizontal
   * field collapses to the ratio of the aspects themselves:
   *
   *   tan(halfRef) / tan(half) = (tan(fov / 2) * REFERENCE) / (tan(fov / 2) * aspect)
   *                            = REFERENCE_ASPECT / aspect
   *
   * At 9:16 that asks for 3.16 and gets {@link MAX_RUN_PULLBACK}'s 1.75,
   * because full parity with a 16:9 frustum stopped being the right target
   * once the base rig itself moved out to 1.8/3.6: desktop now sees 4.78
   * units of roof either side of the cat, well past the outer lanes, and
   * matching *that* would only buy empty parapet at the cost of the cat's
   * readable size. The cap holds the part portrait genuinely needs - both
   * neighbouring lanes, in frame, level with the cat - and is derived against
   * that in {@link MAX_RUN_PULLBACK}.
   *
   * At or above 16:9 this is the identity, so no landscape or desktop framing
   * changes by a pixel.
   *
   * {@link viewportFraming} is still live for the attract shot in
   * `Game.updateAttract()`, which frames the cat's *width* inside a band
   * between the title and the buttons. Nothing is being played there, so
   * trading vertical framing for horizontal costs nothing - which is the one
   * place that trade is free.
   */
  private get framing(): ViewportFraming {
    this.framingResult.fov = this.config.baseFov;
    this.framingResult.rigScale = narrowRigScale(this.camera.aspect);
    return this.framingResult;
  }

  setPhysics(physics: PhysicsWorld | null): void {
    this.physics = physics;
  }

  /**
   * Pulls the far plane in to where the level's fog has already gone opaque.
   *
   * The default 500 was inherited from a build with a skyline scattered out to
   * a 430-unit radius. Nothing is out there now, and the fog on every level is
   * fully opaque by 340 at the very furthest - so everything between the fog
   * and the far plane was geometry surviving the frustum cull, being
   * transformed and rasterised, and then contributing nothing but fog colour.
   * A margin is kept past `fogFar` so the horizon still fades out rather than
   * ending at a visible edge.
   */
  setFarPlane(fogFar: number): void {
    this.camera.far = Math.max(60, fogFar * 1.1);
    this.camera.updateProjectionMatrix();
  }

  /** Places the camera immediately, skipping all smoothing. Use on spawn. */
  snapTo(targetPos: THREE.Vector3, targetYaw: number): void {
    const { fov, rigScale } = this.framing;

    this.yaw = targetYaw;
    this.occlusionClearDistance = Infinity;
    _offset.set(0, 0, -this.config.distance * rigScale).applyAxisAngle(_up, this.yaw);
    this.position.copy(targetPos).add(_offset);
    this.position.y += this.config.height * rigScale;

    // `lookAheadFor` is linear in the rig's own scale (both terms carry a
    // factor of it), so scaling the result is the same as scaling its inputs.
    _dir.set(0, 0, 1).applyAxisAngle(_up, this.yaw);
    this.lookAt.copy(targetPos).addScaledVector(_dir, lookAheadFor(this.config) * rigScale);
    this.lookAt.y += this.config.lookHeight * rigScale;

    this.currentFov = fov;
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
    this.shake.reset();
    this.initialised = true;
  }

  /**
   * @param targetPos  cat world position
   * @param bodyYaw    cat body heading, used only at low speed
   * @param velocity   cat world velocity, drives yaw and FOV
   * @param dt         real frame delta
   */
  update(
    targetPos: THREE.Vector3,
    bodyYaw: number,
    velocity: THREE.Vector3,
    dt: number,
  ): void {
    if (!this.initialised) {
      this.snapTo(targetPos, bodyYaw);
      return;
    }

    const motionScale = this.reducedMotion ? 1.8 : 1;

    // --- Yaw: the runner's heading, and only its heading ---
    //
    // This used to blend toward the *travel* direction, which was right for a
    // free-driving cat that could be pointing somewhere it wasn't going. A lane
    // runner is always pointing where it is going, and its sideways velocity is
    // a lane change - so blending in travel direction would swing the whole
    // camera every time the player tapped left or right, at exactly the moment
    // they need a stable view of what they are dodging.
    const targetYaw = bodyYaw;
    _flatVel.set(velocity.x, 0, velocity.z);
    const flatSpeed = _flatVel.length();

    this.yaw = lerpAngle(
      this.yaw,
      targetYaw,
      smoothing(this.config.rotationDamping * motionScale, dt),
    );

    // --- Desired position: behind and above, in camera yaw space ---
    const { fov: framedFov, rigScale } = this.framing;
    _offset.set(0, 0, -this.config.distance * rigScale).applyAxisAngle(_up, this.yaw);
    _desired.copy(targetPos).add(_offset);
    _desired.y += this.config.height * rigScale;

    _desired.copy(this.resolveOcclusion(targetPos, _desired, dt));

    // Horizontal and vertical are smoothed at different rates on purpose:
    // x/z need to stay snappy for lanes and turns to read as immediate, but
    // y - now anchored to ground height rather than the cat's raw position
    // (see `Game.cameraTarget()`) - only ever has small, infrequent changes
    // left to settle (a real elevation change, a step-up bump), so a slower
    // `heightDamping` reads as "settling" instead of either snapping or
    // (the old behaviour) chasing a jump arc.
    const posT = smoothing(this.config.positionDamping * motionScale, dt);
    const heightT = smoothing(this.config.heightDamping * motionScale, dt);
    this.position.x = THREE.MathUtils.lerp(this.position.x, _desired.x, posT);
    this.position.z = THREE.MathUtils.lerp(this.position.z, _desired.z, posT);
    this.position.y = THREE.MathUtils.lerp(this.position.y, _desired.y, heightT);

    // --- Look target: ahead of the cat along camera yaw ---
    // Derived from the cat rather than from the camera's own position, so the
    // smoothed position cannot feed back into the aim and chase itself.
    _dir.set(0, 0, 1).applyAxisAngle(_up, this.yaw);
    _lookTarget.copy(targetPos).addScaledVector(_dir, lookAheadFor(this.config) * rigScale);
    _lookTarget.y += this.config.lookHeight * rigScale;
    const lookT = smoothing(this.config.lookDamping * motionScale, dt);
    this.lookAt.x = THREE.MathUtils.lerp(this.lookAt.x, _lookTarget.x, lookT);
    this.lookAt.z = THREE.MathUtils.lerp(this.lookAt.z, _lookTarget.z, lookT);
    this.lookAt.y = THREE.MathUtils.lerp(this.lookAt.y, _lookTarget.y, heightT);

    // --- Speed FOV ---
    const targetFov = this.reducedMotion
      ? framedFov
      : framedFov +
        this.boostFov +
        PHYSICS.fovExpansionAmount *
          THREE.MathUtils.clamp(
            (flatSpeed - PHYSICS.fovExpansionSpeed) /
              (PHYSICS.runSpeed - PHYSICS.fovExpansionSpeed),
            0,
            1,
          );
    this.currentFov = THREE.MathUtils.lerp(this.currentFov, targetFov, smoothing(3.5, dt));

    // --- Apply ---
    this.shake.intensityScale = this.reducedMotion ? 0 : 1;
    this.shake.update(dt);

    this.camera.position.copy(this.position).add(this.shake.positionOffset);
    this.camera.lookAt(this.lookAt);
    this.camera.rotateX(this.shake.rotationOffset.x);
    this.camera.rotateY(this.shake.rotationOffset.y);
    this.camera.rotateZ(this.shake.rotationOffset.z);

    if (Math.abs(this.camera.fov - this.currentFov) > 0.01) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Pulls the camera in if something genuinely tall sits between it and the
   * cat, so the player is never blinded by level geometry.
   *
   * Root cause of the "camera isn't respecting the tuned height/distance"
   * report: this used to also check `GROUP.GROUND` - every deck slab,
   * including the rooftop-tier system's own elevated ones. That was
   * harmless while the track was flat (a ray from the player up-and-back
   * toward a camera 22 back/26 up never grazes a ground plane at the
   * player's own feet), but a roof-tier *transition* leaves the previous,
   * taller chunk's deck sitting directly behind and partway up that same
   * sightline for the transition chunk's full length - so every time the
   * player was one tier below where they'd just come from, the "avoid
   * clipping through a building" safety was pulling the camera in to
   * `minOcclusionDistance`, not the previous/`height`/`distance` tuning
   * being wrong. `GROUP.GROUND` never represented a wall-height occluder in
   * the first place (buildings/props are visual-only meshes with no
   * collider at all - see `Buildings.ts`/`RoofFeatures.ts`), so dropping it
   * loses no real protection; `GROUP.OBSTACLE` stays, for the rare case an
   * actual obstacle/parapet collider sits directly in the sightline.
   *
   * Separately, and still true: this used to return `desired` unmodified
   * whenever the raycast missed, so the instant an occluder left the ray -
   * which is exactly what happens when the cat leaves the ground to clear a
   * gap and the ray's origin rises with it - the pulled-in distance snapped
   * straight back out to the full `distance`/`height` offset in one frame.
   * Pulling in still happens instantly (that's a clipping-prevention safety,
   * and there's no "sudden" complaint about the camera getting *closer*);
   * only the release back out to full distance is damped, so an occluder
   * disappearing reads as a smooth push-back rather than a pop.
   */
  private resolveOcclusion(
    targetPos: THREE.Vector3,
    desired: THREE.Vector3,
    dt: number,
  ): THREE.Vector3 {
    if (!this.physics) return desired;

    _tmp.subVectors(desired, targetPos);
    const fullDistance = _tmp.length();
    if (fullDistance < 1e-4) return desired;
    _tmp.divideScalar(fullDistance);

    const hit = this.physics.raycast(
      targetPos,
      _tmp,
      fullDistance,
      undefined,
      collisionGroups(GROUP.SENSOR, GROUP.OBSTACLE),
    );

    // Stop just short of the surface so the near plane never clips through it.
    // The floor rides the rig's own scale: on a narrow viewport the camera
    // sits further out, and a fixed floor would let an occluder pull it in
    // proportionally much closer than it ever does at 16:9.
    const rawClear = hit
      ? Math.max(this.config.minOcclusionDistance * this.framing.rigScale, hit.distance - 0.35)
      : fullDistance;

    if (rawClear < this.occlusionClearDistance) {
      this.occlusionClearDistance = rawClear;
    } else {
      this.occlusionClearDistance = THREE.MathUtils.lerp(
        this.occlusionClearDistance,
        rawClear,
        smoothing(OCCLUSION_RELEASE_RATE, dt),
      );
    }

    return desired.copy(targetPos).addScaledVector(_tmp, this.occlusionClearDistance);
  }

  /**
   * Landing bump - scaled by how hard the impact was.
   *
   * A cat weighs about four kilos, and the camera shaking every time one lands
   * reads as the wrong animal entirely. Routine hops and gap jumps therefore
   * produce *no* shake at all: the scale starts at `hardLandingSpeed`, which is
   * already the point where the controller itself calls the landing rough, and
   * even a full tumble-speed impact only just registers.
   */
  addLandingShake(impactSpeed: number): void {
    // The top of the scale is a long drop rather than a designed landing, which
    // is why it is expressed as a multiple of the hard-landing threshold instead
    // of an authored ceiling.
    const range = Math.max(1, PHYSICS.hardLandingSpeed * 0.6);
    const t = THREE.MathUtils.clamp((impactSpeed - PHYSICS.hardLandingSpeed) / range, 0, 1);
    if (t <= 0) return;
    this.shake.add(0.06 + t * 0.14);
  }

  /**
   * Collision jolt - stronger and shorter than a landing.
   *
   * Halved from `0.35 + t * 0.35`. At the old magnitude a crash threw the whole
   * frame around hard enough to lose track of which lane the runner was in,
   * which is the worst possible moment for that: a crash costs a chance, and
   * the player needs to see where they are being put down.
   */
  /**
   * A knock with no physical quantity behind it - the caller has already
   * decided how hard, on a 0..1 scale.
   *
   * {@link addLandingShake} and {@link addCollisionShake} both derive their
   * magnitude from a speed against a `PHYSICS` threshold, which is right when
   * there *is* one and useless when there isn't: a hazard demolished by
   * Catnip Rush has no impact speed to read, and handing the landing version
   * a made-up number below `hardLandingSpeed` gets silently no shake at all.
   */
  addJolt(intensity: number): void {
    this.shake.add(THREE.MathUtils.clamp(intensity, 0, 1) * 0.2);
  }

  addCollisionShake(speed: number): void {
    const t = THREE.MathUtils.clamp(speed / PHYSICS.runSpeed, 0, 1);
    this.shake.add(0.18 + t * 0.17);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // A rotation from landscape to portrait changes the FOV as well as the
    // aspect; without this the new FOV would not land until the next
    // `update()` lerped its way there, which on the pause screen is never.
    this.currentFov = this.framing.fov;
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();
  }

  reset(): void {
    this.initialised = false;
    this.occlusionClearDistance = Infinity;
    this.shake.reset();
  }
}

/**
 * How quickly {@link FollowCamera.resolveOcclusion} lets the camera drift
 * back out to full distance once an occluder clears - deliberately slower
 * than `positionDamping`/`heightDamping` so the release itself is the visible
 * bottleneck, not whichever of those two a given moment happens to use.
 */
const OCCLUSION_RELEASE_RATE = 3.5;

/**
 * Frame-rate-independent smoothing factor.
 * Equivalent to an exponential decay toward the target at rate `rate`.
 */
function smoothing(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Lerps between angles the short way around the circle. */
function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}
