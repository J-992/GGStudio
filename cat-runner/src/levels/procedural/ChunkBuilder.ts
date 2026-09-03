import * as THREE from 'three';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { PlayerController } from '../../physics/PlayerController';
import { PHYSICS, capsuleFeetOffset } from '../../physics/PhysicsConfig';
import { RunPath } from '../RunPath';
import { ChunkStreamer, type ChunkPlacement, type StreamerCallbacks } from '../ChunkStreamer';
import { laneX, type Lane } from '../chunkTemplate';
import {
  AHEAD_DISTANCE,
  BEHIND_DISTANCE,
  CHUNK_LENGTH,
  DECK_THICKNESS,
  STEP_RADIUS,
  TRACK_Y,
} from '../TrackConfig';
import { CHUNK_DEBUG } from './debug';
import { ChunkDirector } from './ChunkDirector';
import { pickCycleVariant } from './SectionDirector';
import { generateChunk, generateStraight, mulberry32, type Rng } from './ChunkGenerators';
import { generateFishPattern } from './FishPatterns';
import { FishPool } from './FishPool';
import type { Collectible } from '../../entities/Collectible';
import { generatePowerUp, PowerUpPool } from './PowerUps';
import { FISH_MAGNET_RADIUS } from './PowerUpConfig';
import { pulsePowerUpGlow } from './PowerUpModels';
import { RouteGrowth } from './RouteGrowth';
import { ObstaclePool, type SlotRig } from './ObstaclePool';
import {
  BuildingPool,
  GapFacadePool,
  generateBuildingRow,
  generateCornerBuilding,
  generateGapFacade,
  type BuildingPlacement,
} from './Buildings';
import {
  RoofDirector,
  TrampolinePool,
  RoofPropPool,
  generateRoofProp,
  TRAMPOLINE_LAUNCH_VELOCITY,
  TRAMPOLINE_TRIGGER_RADIUS,
  TRAMPOLINE_CATCH_ABOVE,
  TRAMPOLINE_CATCH_BELOW,
} from './RoofFeatures';
import { RoofBorderPool, BORDER_LENGTH } from './RoofBorders';
import { brickMaterialForChunk } from './RoofBrickMaterials';
import { buildLighting, type LightingHandle } from '../../environment/EnvironmentLighting';
import { CloudField } from '../../environment/Clouds';
import type { LightingDef } from '../LevelTypes';
import {
  BEAM_HALF_DEPTH,
  BEAM_HEIGHT,
  VENT_PIPE_DEPTH,
  VENT_PIPE_HEIGHT,
  VENT_PIPE_LENGTH,
  BEAM_LENGTH,
  BEAM_RADIUS,
  DECK_A_CENTER_Z,
  DECK_A_LENGTH,
  DECK_B_CENTER_Z,
  DECK_B_LENGTH,
  DECK_C_CENTER_Z,
  DECK_WIDTH,
  GAP_LENGTH,
  GAP_START_Z,
  OBSTACLE_SIZE,
  POWERUP_HEIGHT,
  ROOF_TIER_HEIGHT,
  TURN_MARKER_LOCAL_Z,
  type ChunkSpec,
  type ChunkType,
  type ObstaclePlacement,
  type PowerUpType,
  type RoofTier,
  type TurnSpec,
} from './ChunkTypes';

/** How fast a pickup spins in place, radians/sec - purely cosmetic. */
const POWERUP_SPIN_RATE = 1.6;
/** Bob amplitude, matching `Collectible`'s own fish bob for visual
 *  consistency between fish and power-ups. */
const POWERUP_BOB_AMOUNT = 0.18;
/** Pickup radius, squared (avoids a sqrt every check). Deliberately more
 *  generous than the fish pickup radius - a power-up is a bigger deal to
 *  miss by a hair than one fish in a trail. */
const POWERUP_PICKUP_RADIUS_SQ = 2.2 * 2.2;
/** Pulse cycle rate for power-up glow, radians/sec - a slow, "subtle" pulse
 *  rather than a strobe (about one full pulse every 2 seconds). */
const POWERUP_PULSE_RATE = 3.2;
/** How far the pulse swings the glow away from its resting intensity. */
const POWERUP_PULSE_AMPLITUDE = 0.35;

const ALL_LANES: readonly Lane[] = [-1, 0, 1];
/** How close (chunk-local Z, same units as `ObstaclePlacement.z`) an obstacle
 *  has to be to a recovery arc to count as "blocking" that lane - matches
 *  `PowerUps.ts`'s own `CLEARANCE` for the same "close enough to this Z"
 *  judgment, restated here since that constant is module-private there. */
const RECOVERY_LANE_CLEARANCE = 2;

/**
 * The engine-bound half of the procedural track: turns the chunk types
 * `ChunkDirector` picks into real meshes and colliders, streamed through
 * `ChunkStreamer` and pooled through `ObstaclePool`.
 *
 * Mirrors the shape of the deleted `EndlessTrack.ts` (`start`/`update`/
 * `step`/`dispose`, one built chunk per streamer slot, step-radius culling)
 * but adds chunk variety, a difficulty director, real reposition-only
 * pooling, and a route that grows to follow turns instead of a flat
 * Z-translation.
 *
 * `ChunkStreamer`'s `startZ` is reinterpreted here as **arc length along the
 * route**, not raw world Z - the two only coincide before the first turn.
 * The player's world position is converted back to arc length every frame
 * via `route.projectDistance()` before it's handed to the streamer.
 */

const UP = new THREE.Vector3(0, 1, 0);
/** How long a duck-miss on the slide beam blocks re-triggering, seconds. */
const DUCK_MISS_COOLDOWN = 0.8;
/** Chunk-local Z of a trampoline pad: just short of deck A's far edge, so
 *  the launch happens on the take-off side of the gap it clears. Named
 *  rather than inline because `hazardsAhead()` needs the same number to tell
 *  the tutorial how far off the pad is. */
const TRAMPOLINE_LOCAL_Z = DECK_A_LENGTH - 1.2;
/**
 * How close a phased runner has to get to a hazard to demolish it, as a box
 * in the hazard's *own* frame: half-extents across the deck and along it.
 *
 * A box rather than a radius because the two roles this is used for are
 * different shapes - a crate is a lane-wide lump, a vent pipe is a bar right
 * across the deck - and a circle big enough to catch the pipe from an outer
 * lane would also blow up crates two lanes over. Rotating the offset into the
 * hazard's frame costs one quaternion multiply and gets both right.
 *
 * Each half-extent is the hazard's own, plus the capsule's radius, plus a
 * little: a hazard that visibly passes *through* the cat and survives is the
 * exact bug this whole feature exists to stop looking like.
 */
const SMASH_MARGIN = 0.25;
/** Vertical reach, so a crate on the tier below is not demolished from above.
 *  Generous, because the runner may be mid-jump when it goes through. */
const SMASH_HALF_HEIGHT = 1.8;
/** Extra margin added to the beam's radius for the hit test - a hazard you
 *  brush past by a hair should read as a hit, not a near miss. */
const BEAM_HIT_MARGIN = 0.3;

/**
 * Bright, well-lit daytime sky for the endless track - no fixed skyline to
 * dress like a campaign level, just sun + sky + fog so obstacles read
 * clearly at a run. Fog colour matches the sky gradient's near-horizon tone
 * so the horizon has no seam, and near/far are sized around `AHEAD_DISTANCE`
 * so newly streamed chunks fade in through fog rather than popping into view.
 *
 * The actual sky is now a stylized sunset gradient baked in
 * `EnvironmentLighting.buildSunsetSkyBackground()` (blue-violet at the top,
 * through warm pink/peach/orange, to golden-yellow at the horizon) -
 * `skyColor` here is kept as a flat representative tone (the gradient's peach
 * midpoint) rather than removed, since `BuildingWindows.ts` still reads it as
 * a brightness reference for window-emissive tuning. `sunColor`/
 * `ambientGround`/`sunIntensity`/`ambientIntensity` are deliberately left at
 * their existing warm-daylight values - this is a sky/horizon change, not a
 * scene-brightness one, and obstacles reading clearly is what those numbers
 * already protect.
 */
const ENDLESS_LIGHTING: LightingDef = {
  skyColor: 0xf9c89b,
  fogColor: 0xffdd8c,
  // Sized so `fogFar` and `AHEAD_DISTANCE` are the same number: a chunk is
  // dealt at exactly the distance the fog has gone opaque, so it arrives
  // invisible rather than at ~70 % fog and visibly fading in, and nothing is
  // ever streamed, collided or drawn past the point it can be seen.
  fogNear: 88,
  fogFar: AHEAD_DISTANCE,
  sunColor: 0xffe0a8,
  sunIntensity: 2.6,
  sunPosition: [40, 95, -25],
  ambientSky: 0xbfe3ff,
  ambientGround: 0xd9b98a,
  ambientIntensity: 1.4,
};

/**
 * The track just ahead of the runner, in **arc length along the route** - the
 * same units `RunPath.projectDistance` speaks, not world Z and not chunk-local
 * Z. `Infinity` means "no such hazard inside the window that was scanned",
 * which is the only value that lets a consumer compare without a null check
 * per hazard.
 *
 * Filled by {@link ChunkBuilder.hazardsAhead} into a caller-owned object.
 * Read by the first-run tutorial (`Tutorial.ts`), which needs to know how far
 * off the first clothesline and the first trampoline pad are so it can start
 * a lesson early enough to be a lesson rather than a jump-scare.
 */
export interface TrackAhead {
  /** Near edge of the next gap in the deck. */
  gapArc: number;
  /** Next full-width hazard that has to be jumped (a vent pipe). */
  jumpArc: number;
  /** Next full-width hazard that has to be ducked under (a clothesline). */
  duckArc: number;
  /** Nearest obstacle row - one or more crates sharing roughly one arc. */
  obstacleArc: number;
  /** Which lanes that row blocks, indexed by `lane + 1`. */
  blocked: readonly [boolean, boolean, boolean];
  /**
   * Next trampoline pad - the only way up a rooftop tier.
   *
   * Reported separately from `gapArc` (which deliberately omits the gap a pad
   * chunk opens) because a pad is not a hazard to clear, it is a *thing to be
   * standing on*, and the two want opposite answers. `TRAMPOLINE_TRIGGER_RADIUS`
   * (1.6, horizontal-only) is still well under half a `laneSpacing` (2.4)
   * away from the neighbouring lane, so the pad still effectively fires only
   * for a runner in (or committing to) the centre lane - see `step()`'s
   * trigger check for why it no longer also requires `grounded`.
   */
  padArc: number;
}

interface BeamHazard {
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly y: number;
}

interface LiveChunk {
  readonly placement: ChunkPlacement;
  readonly type: ChunkType | 'bootstrap';
  readonly centreDist: number;
  readonly beam: BeamHazard | null;
  /** World position of this chunk's trampoline pad, or null if it has none -
   *  see `step()`'s own trigger check against `PlayerController.launchUpward()`. */
  readonly trampoline: THREE.Vector3 | null;
  /** Latches once the pad has launched the player, so running back and
   *  forth near it (or simply the several fixed steps spent inside the
   *  trigger radius) can't fire it more than once per chunk lifetime. */
  trampolineUsed: boolean;
  readonly fishCount: number;
  readonly hasPowerUp: boolean;
  readonly obstacles: readonly ObstaclePlacement[];
  cooldown: number;
  /** The roof tier this chunk's deck sits on - see `roofTierNear()`. */
  readonly roofTier: RoofTier;
  /** Chunk-local geometry {@link TrackAhead} reports on - a gap to clear, a
   *  beam to duck, a pipe to hop. Held as the chunk's own local Z (not world,
   *  not arc) exactly like `obstacles`, because that is the frame every
   *  generator authored them in; `hazardsAhead()` is the one place that
   *  converts. */
  readonly hasGap: boolean;
  readonly beamZ: number | null;
  readonly ventZ: number | null;
}

interface Frame {
  readonly origin: THREE.Vector3;
  readonly dir: THREE.Vector3;
  readonly left: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
}

/**
 * Route frame at an arc length: world origin, heading, "screen left" (see
 * `chunkTemplate.ts`'s `laneX` note - the same −X-is-right handedness), and
 * the yaw-only quaternion that carries a chunk-local placement into world
 * space. Sampled once per chunk at its start distance; the heading is
 * constant across the chunk's own span by construction (`RouteGrowth` only
 * ever bends the route at a chunk boundary), so one sample is enough to
 * place everything inside it.
 */
function frameFromRoute(path: RunPath, distance: number): Frame {
  const origin = path.getPositionAt(distance, new THREE.Vector3());
  const dir = path.getDirectionAt(distance, new THREE.Vector3());
  const left = new THREE.Vector3(dir.z, 0, -dir.x);
  const yaw = Math.atan2(dir.x, dir.z);
  return { origin, dir, left, quaternion: new THREE.Quaternion().setFromAxisAngle(UP, yaw) };
}

function localToWorld(frame: Frame, localX: number, localY: number, localZ: number): THREE.Vector3 {
  return new THREE.Vector3()
    .copy(frame.origin)
    .addScaledVector(frame.dir, localZ)
    .addScaledVector(frame.left, localX)
    .setY(frame.origin.y + localY);
}

export interface ChunkBuilderOptions {
  seed?: number;
  /** Threaded through to `buildLighting()`; defaults to full resolution. */
  shadowMapSize?: number;
  /** Forces the first chunk dealt to this type - see `ChunkDirector`'s own
   *  constructor doc for the one caller that wants it and why. */
  openingType?: ChunkType;
  /** Pins a real run's first two chunks to straight-then-simple-obstacle -
   *  see `ChunkDirector`'s own constructor doc. `Game.startEndless()` passes
   *  it; the attract screen deliberately does not. */
  forceStartSequence?: boolean;
  /**
   * A hand-authored, non-procedural chunk sequence - `spawnChunk()` pulls
   * chunk `index` straight from this array instead of asking `director`/
   * `roofDirector`/`generateFishPattern` for one, so nothing here is rolled.
   * Once the array is exhausted, spawning falls back to an empty repeating
   * `generateStraight()` filler (`Game.startTutorial()`'s level is short
   * enough, and its own finish-arc trigger fires early enough, that the
   * filler is never actually reached in play - it exists only so the
   * streamer always has *something* to build one chunk past the end).
   */
  fixedChunks?: readonly ChunkSpec[];
  /**
   * Called at the world position of every hazard Catnip Rush demolishes -
   * see {@link ChunkBuilder.smashPhased}. `Game` turns it into the burst,
   * the crunch and the jolt; the vector is scratch and must not be retained.
   */
  onHazardSmashed?: (position: THREE.Vector3) => void;
}

/**
 * Whether `point` is inside a box centred on `object`, with `halfX` across
 * the object's own local X, `halfZ` along its local Z and
 * {@link SMASH_HALF_HEIGHT} vertically - each horizontal extent widened by
 * the player capsule's radius and {@link SMASH_MARGIN}.
 *
 * The rotation matters: hazards are placed with the route frame's quaternion,
 * so on a corner chunk their local axes are nothing like world X/Z.
 */
function withinSmashBox(
  point: THREE.Vector3,
  object: THREE.Object3D,
  halfX: number,
  halfZ: number,
): boolean {
  _smashLocal.copy(point).sub(object.position).applyQuaternion(_smashInverse.copy(object.quaternion).invert());
  const reach = PHYSICS.colliderRadius + SMASH_MARGIN;
  return (
    Math.abs(_smashLocal.x) <= halfX + reach &&
    Math.abs(_smashLocal.z) <= halfZ + reach &&
    Math.abs(_smashLocal.y) <= SMASH_HALF_HEIGHT
  );
}

const _smashLocal = new THREE.Vector3();
const _smashInverse = new THREE.Quaternion();

export class ChunkBuilder {
  readonly root = new THREE.Group();

  private readonly streamer: ChunkStreamer;
  private readonly pool: ObstaclePool;
  private readonly director: ChunkDirector;
  private readonly route: RouteGrowth;
  private readonly rng: Rng;
  private readonly liveChunks: (LiveChunk | null)[];
  private readonly callbacks: StreamerCallbacks;
  private readonly lighting: LightingHandle;
  private readonly clouds: CloudField;
  private readonly fish: FishPool;
  private readonly powerUps: PowerUpPool;
  private readonly buildings: BuildingPool;
  private readonly gapFacades: GapFacadePool;
  private readonly roofDirector = new RoofDirector();
  private readonly trampolines: TrampolinePool;
  private readonly roofProps: RoofPropPool;
  private readonly roofBorders: RoofBorderPool;
  private magnetActive = false;
  /** Shared phase for `pulsePowerUpGlow` - see `updatePowerUps()`. */
  private powerUpPulsePhase = 0;
  /** How many trampoline pads have actually launched the player - a debug
   *  canary for tests, mirroring the streamer/pool ones below, since
   *  `LiveChunk.trampolineUsed` itself isn't otherwise observable from
   *  outside `step()`. */
  private trampolinesFired = 0;

  private readonly onHazardSmashed: ((position: THREE.Vector3) => void) | null;
  /** See `ChunkBuilderOptions.fixedChunks`. */
  private readonly fixedChunks: readonly ChunkSpec[] | null;

  private readonly spawnPosition = new THREE.Vector3(0, TRACK_Y, 0);
  private readonly spawnHeading = new THREE.Vector3(0, 0, 1);
  private readonly scratchPos = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    private readonly player: PlayerController,
    options: ChunkBuilderOptions = {},
  ) {
    scene.add(this.root);

    this.pool = new ObstaclePool(this.root, physics);
    this.fish = new FishPool(this.root);
    this.powerUps = new PowerUpPool(this.root);
    this.buildings = new BuildingPool(this.root);
    this.gapFacades = new GapFacadePool(this.root);
    this.trampolines = new TrampolinePool(this.root);
    this.roofProps = new RoofPropPool(this.root);
    this.roofBorders = new RoofBorderPool(this.root);
    this.route = new RouteGrowth(this.spawnPosition, this.spawnHeading);
    this.onHazardSmashed = options.onHazardSmashed ?? null;
    this.fixedChunks = options.fixedChunks ?? null;
    this.rng = mulberry32(options.seed ?? 0xc47a11);
    // Drawn from the same per-run stream as everything else, so a run's
    // seed alone fully determines its section-order variant too. Built
    // unconditionally even when `fixedChunks` is set - `nextSpec()` simply
    // never calls into it then, and constructing it regardless keeps this
    // constructor from needing two shapes.
    this.director = new ChunkDirector(
      pickCycleVariant(this.rng),
      options.openingType ?? null,
      options.forceStartSequence ?? false,
    );
    this.lighting = buildLighting(scene, this.root, ENDLESS_LIGHTING, options.shadowMapSize);
    this.clouds = new CloudField(this.root, {}, this.rng);

    this.streamer = new ChunkStreamer({
      chunkLength: CHUNK_LENGTH,
      aheadDistance: AHEAD_DISTANCE,
      behindDistance: BEHIND_DISTANCE,
    });
    this.liveChunks = new Array(this.streamer.slotCount).fill(null);

    this.callbacks = {
      spawn: (placement, slot) => this.spawnChunk(placement, slot),
      recycle: (placement, slot) => this.recycleChunk(placement, slot),
    };
  }

  /** The route so far. Null until `start()` has dealt at least one chunk. */
  get path(): RunPath | null {
    return this.route.path;
  }

  /** Deals the opening run and hands the player its starting path. */
  start(): void {
    this.streamer.reset(0, this.callbacks);
    if (this.route.path) this.player.setPath(this.route.path);
  }

  /** RENDER RATE. Never call from inside the physics fixed step. */
  update(playerPosition: THREE.Vector3): void {
    const arcLength = this.route.path ? this.route.path.projectDistance(playerPosition) : 0;
    this.streamer.update(arcLength, this.callbacks);

    // No day/night cycle: `buildLighting()` already sets up full, warm
    // daytime lighting from `ENDLESS_LIGHTING`, and simply never calling
    // `updateTimeOfDay` leaves it exactly there - bright, consistent, no
    // transitions - for a cheerful atmosphere suited to younger players.
    // `updateFocus` still runs every frame; it only re-centres the shadow
    // frustum (and the now-permanently-hidden moon/star field) on the
    // runner, which is unrelated to time-of-day.
    this.lighting.updateFocus(playerPosition);
    this.clouds.update(playerPosition);
  }

  /** FIXED STEP. The slide beam and the trampoline pad both need a
   *  per-frame check - everything else here is static once placed. */
  step(dt: number): void {
    if (!this.route.path) return;
    const playerPos = this.player.getPosition(this.scratchPos);
    const playerArc = this.route.path.projectDistance(playerPos);

    const phasing = this.player.isPhasing;

    for (let slot = 0; slot < this.liveChunks.length; slot++) {
      const chunk = this.liveChunks[slot];
      if (!chunk) continue;
      if (Math.abs(chunk.centreDist - playerArc) > STEP_RADIUS) continue;

      if (phasing) this.smashPhased(slot, chunk, playerPos);

      if (chunk.beam) {
        if (chunk.cooldown > 0) {
          chunk.cooldown -= dt;
        } else if (
          // A cat that ducked correctly passes straight through - checked
          // before any geometry, same order Clothesline uses and for the
          // same reason: the pose is the answer, not the overlap.
          !this.player.isDucking &&
          this.overlapsBeam(chunk.beam)
        ) {
          chunk.cooldown = DUCK_MISS_COOLDOWN;
          this.player.reportObstacleHit();
        }
      }

      // A horizontal (XZ) radius for "which pad", and a generous vertical
      // safety zone above it for "catch the runner whether they're standing
      // on it or already mid-jump through it" - deliberately NOT gated on
      // `this.player.grounded` any more. It used to be: a standing jump's
      // hang time covers ~9.66 horizontal units, far wider than this ~2.6-
      // unit-wide window, so any jump taken while passing through it (an
      // ordinary thing to do, since the pad sits only 1.2 units before the
      // gap it leads to) made `grounded` false for the whole pass, silently
      // skipping the check every fixed step and leaving the pad un-triggered
      // - "passes through instead of bouncing." `launchUpward()` already
      // clamps any existing downward velocity before applying its impulse,
      // so it has always been safe to call on an airborne runner; nothing
      // stopped this except the gate itself. Only once per chunk still -
      // see `LiveChunk.trampolineUsed`'s own doc comment.
      if (chunk.trampoline && !chunk.trampolineUsed) {
        const dx = playerPos.x - chunk.trampoline.x;
        const dz = playerPos.z - chunk.trampoline.z;
        const dy = playerPos.y - chunk.trampoline.y;
        if (
          dx * dx + dz * dz <= TRAMPOLINE_TRIGGER_RADIUS * TRAMPOLINE_TRIGGER_RADIUS &&
          dy >= -TRAMPOLINE_CATCH_BELOW &&
          dy <= TRAMPOLINE_CATCH_ABOVE
        ) {
          chunk.trampolineUsed = true;
          this.trampolinesFired++;
          this.player.launchUpward(TRAMPOLINE_LAUNCH_VELOCITY);
        }
      }
    }
  }

  /**
   * RENDER RATE. Fish are decorative + a distance-check pickup (see
   * `Collectible`), so - like the campaign's `LevelManager.updateVisuals` -
   * this runs every frame, not the fixed step. No `particles` parameter:
   * `Collectible` no longer drives any particle effects (item 8's VFX
   * removal), so there is nothing left to hand it.
   */
  updateFishVisuals(dt: number): number {
    if (!this.route.path) return 0;
    const playerPos = this.player.getPosition(this.scratchPos);
    const playerArc = this.route.path.projectDistance(playerPos);
    let caught = 0;

    for (let slot = 0; slot < this.liveChunks.length; slot++) {
      const chunk = this.liveChunks[slot];
      if (!chunk || chunk.fishCount === 0) continue;
      if (Math.abs(chunk.centreDist - playerArc) > STEP_RADIUS) continue;

      const rig = this.fish.rigFor(slot);
      for (let i = 0; i < chunk.fishCount; i++) {
        const entry = rig[i];
        if (this.magnetActive && this.withinMagnetRange(entry, playerPos)) {
          entry.pullToward(playerPos, dt);
        }
        if (entry.update(dt, playerPos)) caught++;
      }
    }

    return caught;
  }

  /**
   * RENDER RATE. Same sweep as `updateFishVisuals()`, but purely cosmetic -
   * spin/bob only, via `Collectible.animateIdle()`, with no collection check
   * and no player position needed. The attract-mode main menu calls this
   * instead of `updateFishVisuals()` so its background fish animate without
   * ever being "caught" - see `Game.updateAttract()`.
   */
  updateIdleFishVisuals(dt: number): void {
    if (!this.route.path) return;

    for (let slot = 0; slot < this.liveChunks.length; slot++) {
      const chunk = this.liveChunks[slot];
      if (!chunk || chunk.fishCount === 0) continue;

      const rig = this.fish.rigFor(slot);
      for (let i = 0; i < chunk.fishCount; i++) rig[i].animateIdle(dt);
    }
  }

  /** Whether Fish Magnet is currently pulling nearby fish toward the player. */
  setFishMagnetActive(active: boolean): void {
    this.magnetActive = active;
  }

  /**
   * RENDER RATE. Spins visible pickups and does the same cheap
   * distance-check pickup fish use. Returns every type collected this frame
   * (almost always 0 or 1, but never assumed to be at most 1).
   */
  updatePowerUps(dt: number): PowerUpType[] {
    if (!this.route.path) return [];
    const playerPos = this.player.getPosition(this.scratchPos);
    const playerArc = this.route.path.projectDistance(playerPos);
    const collected: PowerUpType[] = [];

    this.powerUpPulsePhase += dt;
    const pulseFactor =
      1 + POWERUP_PULSE_AMPLITUDE * Math.sin(this.powerUpPulsePhase * POWERUP_PULSE_RATE);

    for (let slot = 0; slot < this.liveChunks.length; slot++) {
      const chunk = this.liveChunks[slot];
      if (!chunk?.hasPowerUp) continue;
      if (Math.abs(chunk.centreDist - playerArc) > STEP_RADIUS) continue;

      const entry = this.powerUps.rigFor(slot);
      if (!entry.root.visible || entry.collected || !entry.kind) continue;

      entry.root.rotation.y += dt * POWERUP_SPIN_RATE;
      entry.root.position.y = entry.baseY + Math.sin(entry.root.rotation.y * 1.4) * POWERUP_BOB_AMOUNT;

      // Only the one sub-model matching `entry.kind` is visible at a time
      // (see `PowerUpPool.place`) - pulsing just that one keeps this to a
      // handful of material writes per visible pickup, not per pool slot.
      const visibleModel = entry.shield.visible
        ? entry.shield
        : entry.heart.visible
          ? entry.heart
          : entry.magnet.visible
            ? entry.magnet
            : entry.energyDrink.visible
              ? entry.energyDrink
              : null;
      if (visibleModel) pulsePowerUpGlow(visibleModel, pulseFactor);

      if (playerPos.distanceToSquared(entry.root.position) <= POWERUP_PICKUP_RADIUS_SQ) {
        entry.collected = true;
        entry.root.visible = false;
        collected.push(entry.kind);
      }
    }

    return collected;
  }

  /**
   * World position of a currently visible, uncollected energy-drink pickup
   * within streaming range, or null if none is live right now. Lets
   * `Game.ts` drive a low-rate green-ember particle effect near it without
   * this file taking a `ParticlePool` dependency of its own - see
   * `updateFishVisuals`'s own doc comment on why particles were pulled off
   * this class's hot path.
   */
  getActiveEnergyDrinkPosition(): THREE.Vector3 | null {
    if (!this.route.path) return null;
    const playerPos = this.player.getPosition(this.scratchPos);
    const playerArc = this.route.path.projectDistance(playerPos);

    for (let slot = 0; slot < this.liveChunks.length; slot++) {
      const chunk = this.liveChunks[slot];
      if (!chunk?.hasPowerUp) continue;
      if (Math.abs(chunk.centreDist - playerArc) > STEP_RADIUS) continue;

      const entry = this.powerUps.rigFor(slot);
      if (entry.root.visible && !entry.collected && entry.kind === 'catnipRush') {
        return entry.root.position;
      }
    }
    return null;
  }

  /**
   * Which lane to land a fall/wedge recovery in, given the arc distance the
   * player is being recovered to and the lane they were in when they fell.
   * Used by `Game.recoverEndlessFall()` so a recovery never drops the runner
   * right back in front of the obstacle that (indirectly) caused the fall.
   *
   * Chunk generation never blocks all three lanes at one Z (see
   * `ChunkGenerators.generateObstacle`), so this always has at least one lane
   * to return; an arc distance with no live chunk covering it (still
   * loading, or past the streamed window) has nothing to be blocked by
   * either, so `preferredLane` is returned unchanged in that case.
   */
  safeLaneNear(arc: number, preferredLane: Lane): Lane {
    for (const chunk of this.liveChunks) {
      if (!chunk) continue;
      const startDist = chunk.centreDist - CHUNK_LENGTH / 2;
      if (arc < startDist || arc >= startDist + CHUNK_LENGTH) continue;

      const localZ = arc - startDist;
      const blocked = new Set<Lane>();
      for (const o of chunk.obstacles) {
        if (Math.abs(o.z - localZ) <= RECOVERY_LANE_CLEARANCE) blocked.add(o.lane);
      }
      if (blocked.size === 0 || !blocked.has(preferredLane)) return preferredLane;

      const clear = ALL_LANES.filter((lane) => !blocked.has(lane));
      if (clear.length === 0) return preferredLane;
      return clear.reduce((best, lane) =>
        Math.abs(lane - preferredLane) < Math.abs(best - preferredLane) ? lane : best,
      );
    }
    return preferredLane;
  }

  /**
   * What the track holds between `arc` and `arc + range`, in arc length along
   * the route.
   *
   * Every placement a chunk holds is authored in that chunk's own local Z
   * (an obstacle's `z`, `beamZ`, `ventZ`, and the fixed `GAP_START_Z` a
   * gap-bearing chunk opens at), so this is the one place that converts:
   * a chunk's local Z is its arc `startDist` plus that Z, and `startDist`
   * is the same `centreDist - CHUNK_LENGTH / 2` every other query here uses.
   *
   * Writes into a caller-owned `out` rather than returning a fresh object -
   * it runs once per rendered frame while the tutorial still has a lesson
   * owed, and the caller reads it and forgets it.
   *
   * `Infinity` for a hazard means "none inside the window": see
   * {@link TrackAhead}, whose comparisons are all written to fall through on
   * it rather than needing a null check per hazard.
   */
  hazardsAhead(arc: number, range: number, out: TrackAhead): TrackAhead {
    const blocked = out.blocked as [boolean, boolean, boolean];
    out.gapArc = Infinity;
    out.jumpArc = Infinity;
    out.duckArc = Infinity;
    out.obstacleArc = Infinity;
    out.padArc = Infinity;
    blocked[0] = blocked[1] = blocked[2] = false;

    const limit = arc + range;

    for (const chunk of this.liveChunks) {
      if (!chunk) continue;
      const startDist = chunk.centreDist - CHUNK_LENGTH / 2;
      if (startDist > limit || startDist + CHUNK_LENGTH < arc) continue;

      // A gap to jump - *unless* this chunk carries a trampoline, which is
      // the one case where jumping is actively wrong. A trampoline chunk
      // steps the roof up a whole tier (3 units, six times
      // `PHYSICS.maxStepUp`), and the pad only fires for a runner that is
      // `grounded` when it crosses the trigger radius, so a jump taken a beat
      // early skips the launch and then lands short against a lip nothing can
      // climb. Leaving the gap off the list hands the tier change to the pad,
      // which is what the tutorial's own prompt is about.
      if (chunk.hasGap && !chunk.trampoline) {
        const gap = startDist + GAP_START_Z;
        if (gap >= arc && gap <= limit && gap < out.gapArc) out.gapArc = gap;
      }
      if (chunk.trampoline) {
        // The pad's own arc. It is placed at `TRAMPOLINE_LOCAL_Z` in the
        // chunk's frame (see `placeChunk`), which is all a caller needs - the
        // world position `LiveChunk.trampoline` holds is for the proximity
        // test in `step()`, and projecting it back onto the route here would
        // be the same number by a longer road.
        const pad = startDist + TRAMPOLINE_LOCAL_Z;
        if (pad >= arc && pad <= limit && pad < out.padArc) out.padArc = pad;
      }
      if (chunk.ventZ !== null) {
        const vent = startDist + chunk.ventZ;
        if (vent >= arc && vent <= limit && vent < out.jumpArc) out.jumpArc = vent;
      }
      if (chunk.beamZ !== null) {
        const beam = startDist + chunk.beamZ;
        if (beam >= arc && beam <= limit && beam < out.duckArc) out.duckArc = beam;
      }
      for (const obstacle of chunk.obstacles) {
        const at = startDist + obstacle.z;
        if (at < arc || at > limit || at >= out.obstacleArc) continue;
        out.obstacleArc = at;
      }
    }

    // The lane mask is filled in a second pass, once the nearest row's arc is
    // actually known: a row is every obstacle within `RECOVERY_LANE_CLEARANCE`
    // of it (the same "close enough to this Z to count" margin
    // `safeLaneNear()` uses), and a single obstacle from the row behind it
    // must not be folded into the mask for the row in front.
    if (out.obstacleArc === Infinity) return out;

    for (const chunk of this.liveChunks) {
      if (!chunk) continue;
      const startDist = chunk.centreDist - CHUNK_LENGTH / 2;
      for (const obstacle of chunk.obstacles) {
        if (Math.abs(startDist + obstacle.z - out.obstacleArc) > RECOVERY_LANE_CLEARANCE) continue;
        blocked[obstacle.lane + 1] = true;
      }
    }

    return out;
  }

  /**
   * The roof tier - and so the deck's world-space Y via `ROOF_TIER_HEIGHT` -
   * of whichever live chunk covers `arc`. Used by `Game.recoverEndlessFall()`
   * so a recovery lands on the deck instead of the flat `TRACK_Y` the track
   * used before the roof-tier system existed; falls back to tier 0 (ground
   * level) for an arc with no live chunk covering it, same "nothing to be
   * wrong about" reasoning as `safeLaneNear()`'s own fallback.
   */
  roofTierNear(arc: number): RoofTier {
    for (const chunk of this.liveChunks) {
      if (!chunk) continue;
      const startDist = chunk.centreDist - CHUNK_LENGTH / 2;
      if (arc < startDist || arc >= startDist + CHUNK_LENGTH) continue;
      return chunk.roofTier;
    }
    return 0;
  }

  dispose(): void {
    this.pool.dispose();
    this.fish.dispose();
    this.powerUps.dispose();
    this.buildings.dispose();
    this.gapFacades.dispose();
    this.trampolines.dispose();
    this.roofProps.dispose();
    this.roofBorders.dispose();
    this.liveChunks.fill(null);
    this.lighting.dispose();
    this.clouds.dispose();
    this.root.removeFromParent();
  }

  // --- Debug / leak canaries, mirroring ChunkStreamer's own -----------------
  get liveChunkCount(): number {
    return this.streamer.liveCount;
  }
  get spawnCount(): number {
    return this.streamer.spawnCount;
  }
  get recycleCount(): number {
    return this.streamer.recycleCount;
  }
  get builtRigCount(): number {
    return this.pool.builtCount;
  }
  get trampolinesFiredCount(): number {
    return this.trampolinesFired;
  }

  // -------------------------------------------------------------------------

  /**
   * Whether `entry` is close enough for Fish Magnet to have hold of it.
   *
   * The pull itself belongs to `Collectible` - it has to move the coin's
   * *anchor*, not the transform the idle bob rewrites every frame - so all
   * that is left here is the range test.
   */
  private withinMagnetRange(entry: Collectible, target: THREE.Vector3): boolean {
    return entry.root.position.distanceToSquared(target) <= FISH_MAGNET_RADIUS * FISH_MAGNET_RADIUS;
  }

  /**
   * Demolishes every hazard the phased runner is currently inside.
   *
   * Catnip Rush's invincibility is implemented by taking `GROUP.OBSTACLE` out
   * of the player capsule's collision filter (`PlayerController.setPhasing`),
   * which is correct and completely invisible: on screen a crate slides
   * through the cat and carries on down the street, which is what a broken
   * collider looks like, not what a power-up looks like. So the hazard is
   * removed at the moment of contact instead - parked exactly as a despawn
   * would park it - and the caller is handed the position to throw a burst
   * at. Running the length of a rooftop leaving a trail of wreckage is the
   * only version of "invincible" the player can actually read.
   *
   * Everything demolished here stays demolished for that chunk's lifetime,
   * including after the effect ends. That is the honest bookkeeping: the
   * crate is gone because the cat went through it, not because the cat is
   * currently immune, and a crate that popped back into existence the instant
   * the rainbow faded would be the same invisible-collider problem wearing a
   * different hat.
   *
   * Deliberately not the fish or the power-ups, which are pickups rather than
   * hazards, and not the trampoline pad, which is the one thing on the deck
   * the runner still *wants* to hit.
   */
  private smashPhased(slot: number, chunk: LiveChunk, playerPos: THREE.Vector3): void {
    const rig = this.pool.rigAt(slot);
    if (!rig) return;

    for (const entry of rig.obstacles) {
      if (!entry.mesh.visible) continue;
      if (!withinSmashBox(playerPos, entry.mesh, OBSTACLE_SIZE.width / 2, OBSTACLE_SIZE.depth / 2)) {
        continue;
      }
      this.reportSmash(entry.mesh.position);
      this.pool.park(entry);
    }

    if (
      rig.ventPipe.mesh.visible &&
      // Full-width, so the box is the pipe's own span across the deck - a
      // radius would either miss it from an outer lane or catch crates two
      // lanes over. See SMASH_MARGIN.
      withinSmashBox(playerPos, rig.ventPipe.mesh, VENT_PIPE_LENGTH / 2, VENT_PIPE_DEPTH / 2)
    ) {
      this.reportSmash(rig.ventPipe.mesh.position);
      this.pool.park(rig.ventPipe);
    }

    // The clothesline has no collider at all (see `ObstaclePool`'s doc), so
    // it reuses the same segment test the duck check does - minus the pose,
    // which is the whole point: a phased cat does not have to tuck.
    if (chunk.beam && rig.beam.visible && this.overlapsBeam(chunk.beam)) {
      this.reportSmash(rig.beam.position);
      this.pool.hideVisual(rig.beam);
    }
  }

  /** Hands one smashed hazard's position to the caller, if it asked. */
  private reportSmash(position: THREE.Vector3): void {
    this.onHazardSmashed?.(position);
  }

  private overlapsBeam(beam: BeamHazard): boolean {
    const pos = this.player.getPosition(this.scratchPos);
    const abx = beam.end.x - beam.start.x;
    const abz = beam.end.z - beam.start.z;
    const apx = pos.x - beam.start.x;
    const apz = pos.z - beam.start.z;
    const lengthSq = abx * abx + abz * abz;
    const t =
      lengthSq > 1e-9 ? THREE.MathUtils.clamp((apx * abx + apz * abz) / lengthSq, 0, 1) : 0;
    const dx = pos.x - (beam.start.x + abx * t);
    const dz = pos.z - (beam.start.z + abz * t);
    // Along-track depth, NOT the vertical half-extent: this test is a distance
    // from the beam's centre *line*, so it governs how early/late a duck has
    // to be, and pairing it with the band's height would make a taller barrier
    // silently harder to slide under. See `ChunkTypes.BEAM_HALF_DEPTH`.
    const hitRadius = BEAM_HALF_DEPTH + BEAM_HIT_MARGIN;
    if (dx * dx + dz * dz > hitRadius * hitRadius) return false;

    const feet = pos.y - capsuleFeetOffset();
    const head = pos.y + capsuleFeetOffset();
    return head >= beam.y - BEAM_RADIUS && feet <= beam.y + BEAM_RADIUS;
  }

  /**
   * The spec for chunk `placement.index` - either pulled straight from a
   * hand-authored {@link ChunkBuilderOptions.fixedChunks} sequence, or
   * decided the normal procedural way (`director.select()` -> `generateChunk()`
   * -> `roofDirector.next()` -> fish/power-up placement, each layered on top
   * of the finished hazard geometry rather than deciding it, since they need
   * to read which lanes are blocked / where the gap is / whether this is even
   * a `'straight'` chunk - see RoofFeatures.ts/FishPatterns.ts/PowerUps.ts).
   */
  private nextSpec(placement: ChunkPlacement): ChunkSpec {
    if (this.fixedChunks) return this.fixedChunks[placement.index] ?? generateStraight();

    const { type, tier, section, simple } = this.director.select(placement.startZ, this.rng);
    const hazardSpec = generateChunk(type, this.rng, simple);
    const roof = this.roofDirector.next(hazardSpec.type, this.rng);
    // Told after the fact, not before: `ChunkDirector` decided `type` with no
    // idea whether it would end up carrying a trampoline - only `RoofDirector`,
    // just above, knows that - so the earliest this director can be informed
    // is right here, in time for the recovery chunk to land on the *next*
    // `select()` call. See `ChunkDirector.noteTrampoline()`.
    if (roof.trampoline) this.director.noteTrampoline();
    return {
      ...hazardSpec,
      fish: generateFishPattern(hazardSpec, section, tier, this.rng),
      powerUp: generatePowerUp(hazardSpec, section, this.rng),
      roofTier: roof.tier,
      previousRoofTier: roof.previousTier,
      trampoline: roof.trampoline,
    };
  }

  private spawnChunk(placement: ChunkPlacement, slot: number): void {
    const rig = this.pool.rigFor(slot);

    if (placement.index < 0) {
      this.placeBootstrap(placement, rig, slot);
      this.fish.hideAll(slot);
      this.powerUps.hide(slot);
      this.liveChunks[slot] = {
        placement,
        type: 'bootstrap',
        centreDist: placement.startZ + CHUNK_LENGTH / 2,
        beam: null,
        trampoline: null,
        trampolineUsed: false,
        fishCount: 0,
        hasPowerUp: false,
        obstacles: [],
        cooldown: 0,
        roofTier: 0,
        hasGap: false,
        beamZ: null,
        ventZ: null,
      };
      if (CHUNK_DEBUG) console.debug('[chunk] spawn (bootstrap)', { index: placement.index, slot });
      return;
    }

    // If the streamer ever jumps its own index forward (a long stall or a
    // forward teleport - see ChunkStreamer's own `fill()`), the route must
    // not be asked to place a chunk past its own frontier. Silently paving
    // the skipped span with straight filler keeps "the player always has a
    // valid path" true even in that edge case, rather than crashing on a
    // distance mismatch.
    while (this.route.frontierDistance < placement.startZ) {
      this.route.extend(generateChunk('straight', this.rng));
    }

    const spec = this.nextSpec(placement);
    const { startDist, path } = this.route.extend(spec);

    this.player.extendPath(path);

    const frame = frameFromRoute(path, startDist);
    const { beam, fishCount, hasPowerUp, trampoline } = this.placeChunk(
      spec,
      rig,
      slot,
      frame,
      placement.index,
    );

    this.liveChunks[slot] = {
      placement,
      type: spec.type,
      centreDist: startDist + CHUNK_LENGTH / 2,
      beam,
      trampoline,
      trampolineUsed: false,
      fishCount,
      hasPowerUp,
      obstacles: spec.obstacles,
      cooldown: 0,
      roofTier: spec.roofTier,
      hasGap: spec.hasGap,
      beamZ: spec.beamZ,
      ventZ: spec.ventZ,
    };

    if (CHUNK_DEBUG) {
      const exit = path.getPositionAt(startDist + CHUNK_LENGTH, new THREE.Vector3());
      console.debug('[chunk] spawn', {
        index: placement.index,
        slot,
        type: spec.type,
        fish: fishCount,
        powerUp: spec.powerUp?.kind ?? null,
        entry: frame.origin.toArray().map((n) => n.toFixed(1)),
        exit: exit.toArray().map((n) => n.toFixed(1)),
      });
    }
  }

  private recycleChunk(placement: ChunkPlacement, slot: number): void {
    this.pool.hideAll(slot);
    this.fish.hideAll(slot);
    this.powerUps.hide(slot);
    this.buildings.hideAll(slot);
    this.gapFacades.hideAll(slot);
    this.trampolines.hide(slot);
    this.roofProps.hide(slot);
    this.roofBorders.hideAll(slot);
    this.liveChunks[slot] = null;
    if (CHUNK_DEBUG) console.debug('[chunk] recycle', { index: placement.index, slot });
  }

  private placeBootstrap(placement: ChunkPlacement, rig: SlotRig, slot: number): void {
    const origin = this.spawnPosition
      .clone()
      .addScaledVector(this.spawnHeading, placement.startZ);
    const frame: Frame = {
      origin,
      dir: this.spawnHeading,
      left: new THREE.Vector3(1, 0, 0),
      quaternion: new THREE.Quaternion(),
    };

    this.pool.place(
      rig.deckA,
      localToWorld(frame, 0, -DECK_THICKNESS / 2, DECK_A_CENTER_Z),
      frame.quaternion,
    );
    this.pool.place(
      rig.deckC,
      localToWorld(frame, 0, -DECK_THICKNESS / 2, DECK_C_CENTER_Z),
      frame.quaternion,
    );
    this.pool.place(
      rig.deckB,
      localToWorld(frame, 0, -DECK_THICKNESS / 2, DECK_B_CENTER_Z),
      frame.quaternion,
    );
    for (const entry of rig.obstacles) this.pool.park(entry);
    this.pool.park(rig.ventPipe);
    this.pool.hideVisual(rig.beam);
    this.pool.hideVisual(rig.turnMarker);
    this.trampolines.hide(slot);
    this.roofProps.hide(slot);

    // Bootstrap is always tier 0 with no gap/turn - `at`/`atPrev` agree.
    const bootstrapAt = (x: number, y: number, z: number) => localToWorld(frame, x, y, z);
    this.placeRoofSurface(
      slot,
      frame,
      bootstrapAt,
      bootstrapAt,
      placement.index,
      { hasGap: false, turn: null },
      rig,
    );

    const facadeRig = this.gapFacades.rigFor(slot);
    const facadeA = generateGapFacade(placement.index, 'A');
    this.gapFacades.place(
      facadeRig.a,
      localToWorld(frame, 0, -DECK_THICKNESS, DECK_A_CENTER_Z),
      frame.quaternion,
      DECK_WIDTH,
      DECK_A_LENGTH,
      facadeA.color,
      facadeA.pattern,
    );
    const facadeC = generateGapFacade(placement.index, 'C');
    this.gapFacades.place(
      facadeRig.c,
      localToWorld(frame, 0, -DECK_THICKNESS, DECK_C_CENTER_Z),
      frame.quaternion,
      DECK_WIDTH,
      GAP_LENGTH,
      facadeC.color,
      facadeC.pattern,
    );
    const facadeB = generateGapFacade(placement.index, 'B');
    this.gapFacades.place(
      facadeRig.b,
      localToWorld(frame, 0, -DECK_THICKNESS, DECK_B_CENTER_Z),
      frame.quaternion,
      DECK_WIDTH,
      DECK_B_LENGTH,
      facadeB.color,
      facadeB.pattern,
    );
    this.gapFacades.hide(facadeRig.corner);

    this.placeBuildings(slot, frame, placement.index, null);
  }

  /**
   * The two skyline rows plus, on a turn chunk, the corner-bridging building
   * - see `Buildings.ts` for why this is chunk-local (never a route-wide
   * radius check) and why the pattern is a pure function of `chunkIndex`.
   *
   * On a turn chunk, the *inside* row's slot nearest the pivot is left
   * empty (`generateBuildingRow`'s `suppressNearPivotSlot`) rather than
   * placed and trusted to clear the track: this chunk's own frame reflects
   * its NEW heading, but the previous chunk's deck was laid out in the OLD
   * one, and mapping that old footprint through the turn's rotation puts it
   * well into what this chunk's frame would otherwise consider "clear of
   * the deck" on the inside - the very overlap this was reported for.
   * `spec.turn.dir`'s sign is the OUTSIDE of the turn (matching
   * `cornerFill`'s/`generateCornerBuilding`'s own convention - see either's
   * doc comment), so the inside is `-turn.dir`; the corner building already
   * only ever sits on the outside, so it needs no equivalent change.
   *
   * That suppression alone still leaves a second, symmetric overlap: the
   * *previous* chunk's own row was placed before anyone knew this chunk
   * would turn (chunks are generated strictly in order), so its last slot -
   * the one nearest the pivot from the other side - was never suppressed
   * either. A 90-degree turn's new forward axis is always exactly the
   * previous chunk's own left or right lateral axis (never a diagonal, since
   * every turn here is exactly +-90 degrees), so the new deck sweeps
   * `DECK_WIDTH / 2` back along whichever of the previous chunk's lateral
   * directions that is - reaching well inside that chunk's own last slot,
   * which starts only `SLOT_SPAN` (15) units from the pivot with up to
   * ~6.75 units of its own depth/jitter to reach back with. Working through
   * the rotation algebra (`RouteGrowth.extend`'s `deltaYaw` convention),
   * that side always turns out to be the same `-turn.dir` computed above -
   * so `suppressPreviousChunkPivotSlot` reuses `insideOfTurnSide` rather
   * than re-deriving it. See `tests/procedural.test.ts`'s
   * "never overlaps a deck, including across a turn" test for the empirical
   * check this reasoning was built from (found by literally walking a real
   * `ChunkBuilder` through many seeds and comparing pooled mesh transforms).
   */
  private placeBuildings(
    slot: number,
    frame: Frame,
    chunkIndex: number,
    turn: TurnSpec | null,
  ): void {
    const rig = this.buildings.rigFor(slot);
    const insideOfTurnSide: -1 | 1 | null = turn ? ((-turn.dir) as -1 | 1) : null;

    this.placeBuildingRow(
      rig.right,
      frame,
      generateBuildingRow(chunkIndex, 1, insideOfTurnSide === 1),
    );
    this.placeBuildingRow(
      rig.left,
      frame,
      generateBuildingRow(chunkIndex, -1, insideOfTurnSide === -1),
    );

    if (turn) {
      this.suppressPreviousChunkPivotSlot(chunkIndex, insideOfTurnSide!);
      this.placeBuildingOne(rig.corner, frame, generateCornerBuilding(chunkIndex, turn.dir));
    } else {
      this.buildings.hide(rig.corner);
    }
  }

  /**
   * Hides the previous chunk's own last building slot on `insideOfTurnSide`
   * - see `placeBuildings`'s doc comment for why a turn chunk has to reach
   * back and correct a row that was already placed before this chunk's own
   * turn was known. A no-op if the previous chunk isn't currently live
   * (streamed out, or this is very early in a run) - nothing to correct in
   * that case, the same "nothing to be wrong about" fallback
   * `safeLaneNear`/`roofTierNear` already use.
   */
  private suppressPreviousChunkPivotSlot(chunkIndex: number, insideOfTurnSide: -1 | 1): void {
    const previousIndex = chunkIndex - 1;
    for (let prevSlot = 0; prevSlot < this.liveChunks.length; prevSlot++) {
      const chunk = this.liveChunks[prevSlot];
      if (!chunk || chunk.placement.index !== previousIndex) continue;

      const prevRig = this.buildings.rigFor(prevSlot);
      const row = insideOfTurnSide === 1 ? prevRig.right : prevRig.left;
      this.buildings.hide(row[row.length - 1]);
      return;
    }
  }

  private placeBuildingRow(
    meshes: readonly THREE.Mesh[],
    frame: Frame,
    placements: readonly (BuildingPlacement | null)[],
  ): void {
    for (let i = 0; i < meshes.length; i++) {
      const p = placements[i];
      if (p) this.placeBuildingOne(meshes[i], frame, p);
      else this.buildings.hide(meshes[i]);
    }
  }

  private placeBuildingOne(mesh: THREE.Mesh, frame: Frame, p: BuildingPlacement): void {
    this.buildings.placeOne(
      mesh,
      localToWorld(frame, p.x, p.y, p.z),
      frame.quaternion,
      p.width,
      p.height,
      p.depth,
      p.color,
      p.pattern,
    );
  }

  /**
   * The building each deck segment sits directly on top of - see
   * `Buildings.ts`'s own "GAP FACADES" doc comment for why this exists (the
   * deck used to read as a floating platform, worst of all across a gap).
   * Mirrors the deck placement immediately above it exactly: same footprint
   * (`DECK_WIDTH` x each segment's own length), parked whenever that
   * segment's own deck is parked (`spec.hasGap` for C, "not a turn" for the
   * corner patch) so a facade never floats under empty air. Facade A takes
   * `atPrev`, not `at` - deck A sits at `previousRoofTier` (see
   * `placeChunk`'s own comment), and its facade has to reach down from
   * that same height, not the new one, on a gap chunk that changes tier.
   */
  private placeGapFacades(
    slot: number,
    frame: Frame,
    at: (x: number, y: number, z: number) => THREE.Vector3,
    atPrev: (x: number, y: number, z: number) => THREE.Vector3,
    chunkIndex: number,
    spec: ChunkSpec,
  ): void {
    const rig = this.gapFacades.rigFor(slot);

    const a = generateGapFacade(chunkIndex, 'A');
    this.gapFacades.place(
      rig.a,
      atPrev(0, -DECK_THICKNESS, DECK_A_CENTER_Z),
      frame.quaternion,
      DECK_WIDTH,
      DECK_A_LENGTH,
      a.color,
      a.pattern,
    );

    const b = generateGapFacade(chunkIndex, 'B');
    this.gapFacades.place(
      rig.b,
      at(0, -DECK_THICKNESS, DECK_B_CENTER_Z),
      frame.quaternion,
      DECK_WIDTH,
      DECK_B_LENGTH,
      b.color,
      b.pattern,
    );

    if (spec.hasGap) {
      this.gapFacades.hide(rig.c);
    } else {
      const c = generateGapFacade(chunkIndex, 'C');
      this.gapFacades.place(
        rig.c,
        at(0, -DECK_THICKNESS, DECK_C_CENTER_Z),
        frame.quaternion,
        DECK_WIDTH,
        GAP_LENGTH,
        c.color,
        c.pattern,
      );
    }

    if (spec.turn) {
      const corner = generateGapFacade(chunkIndex, 'corner');
      this.gapFacades.place(
        rig.corner,
        at(spec.turn.dir * (DECK_WIDTH / 4), -DECK_THICKNESS, -(DECK_WIDTH / 4)),
        frame.quaternion,
        DECK_WIDTH / 2,
        DECK_WIDTH / 2,
        corner.color,
        corner.pattern,
      );
    } else {
      this.gapFacades.hide(rig.corner);
    }
  }

  /**
   * The deck's own brick material (§6) and the border rail alongside it
   * (§5) - handled together since both are keyed off the same per-building
   * colour choice (`RoofBrickMaterials.brickColorIndexFor`). Mirrors
   * `placeGapFacades` exactly: same per-role footprint, same "parked
   * wherever that role's own deck is parked" rule, `atPrev` for A so a
   * mixed-height gap's border sits at each side's own tier.
   */
  private placeRoofSurface(
    slot: number,
    frame: Frame,
    at: (x: number, y: number, z: number) => THREE.Vector3,
    atPrev: (x: number, y: number, z: number) => THREE.Vector3,
    chunkIndex: number,
    spec: Pick<ChunkSpec, 'hasGap' | 'turn'>,
    rig: SlotRig,
  ): void {
    (rig.deckA.mesh as THREE.Mesh).material = brickMaterialForChunk(chunkIndex, 'A');
    (rig.deckB.mesh as THREE.Mesh).material = brickMaterialForChunk(chunkIndex, 'B');
    if (!spec.hasGap) {
      (rig.deckC.mesh as THREE.Mesh).material = brickMaterialForChunk(chunkIndex, 'C');
    }
    if (spec.turn) {
      (rig.cornerFill.mesh as THREE.Mesh).material = brickMaterialForChunk(chunkIndex, 'corner');
    }

    const borderRig = this.roofBorders.rigFor(slot);
    this.roofBorders.place(
      borderRig.a,
      atPrev(0, 0, DECK_A_CENTER_Z),
      frame.quaternion,
      frame.left,
      BORDER_LENGTH.a,
      chunkIndex,
    );
    this.roofBorders.place(
      borderRig.b,
      at(0, 0, DECK_B_CENTER_Z),
      frame.quaternion,
      frame.left,
      BORDER_LENGTH.b,
      chunkIndex,
    );

    if (spec.hasGap) {
      this.roofBorders.hide(borderRig.c);
    } else {
      this.roofBorders.place(
        borderRig.c,
        at(0, 0, DECK_C_CENTER_Z),
        frame.quaternion,
        frame.left,
        BORDER_LENGTH.c,
        chunkIndex,
      );
    }

    if (spec.turn) {
      this.roofBorders.placeCorner(
        borderRig.corner,
        at(0, 0, 0),
        frame.quaternion,
        frame.dir,
        frame.left,
        spec.turn.dir,
        chunkIndex,
      );
      this.roofBorders.placeInnerCorner(
        borderRig.innerCorner,
        at(0, 0, 0),
        frame.quaternion,
        frame.dir,
        frame.left,
        spec.turn.dir,
        chunkIndex,
      );
    } else {
      this.roofBorders.hideCorner(borderRig.corner);
      this.roofBorders.hideCorner(borderRig.innerCorner);
    }
  }

  private placeChunk(
    spec: ChunkSpec,
    rig: SlotRig,
    slot: number,
    frame: Frame,
    chunkIndex: number,
  ): {
    beam: BeamHazard | null;
    trampoline: THREE.Vector3 | null;
    fishCount: number;
    hasPowerUp: boolean;
  } {
    this.placeBuildings(slot, frame, chunkIndex, spec.turn);

    // Height only ever changes on a `'jump'` chunk (a gap) - see
    // RoofFeatures.RoofDirector - so deck A (before the gap) and everything
    // from deck B onward (after it) can sit at two different tiers within
    // one chunk. `at` is this chunk's own new tier; `atPrev` is the tier the
    // *previous* chunk (and so deck A) sits at - equal to `at` whenever this
    // chunk doesn't change height, which is every chunk type except a
    // transitioning `'jump'`, so using `atPrev` for deck A unconditionally
    // is a no-op there rather than a special case.
    const roofY = ROOF_TIER_HEIGHT[spec.roofTier];
    const prevRoofY = ROOF_TIER_HEIGHT[spec.previousRoofTier];
    const at = (x: number, y: number, z: number) => localToWorld(frame, x, y + roofY, z);
    const atPrev = (x: number, y: number, z: number) => localToWorld(frame, x, y + prevRoofY, z);

    this.pool.place(rig.deckA, atPrev(0, -DECK_THICKNESS / 2, DECK_A_CENTER_Z), frame.quaternion);
    this.pool.place(rig.deckB, at(0, -DECK_THICKNESS / 2, DECK_B_CENTER_Z), frame.quaternion);

    if (spec.hasGap) {
      this.pool.park(rig.deckC);
    } else {
      this.pool.place(rig.deckC, at(0, -DECK_THICKNESS / 2, DECK_C_CENTER_Z), frame.quaternion);
    }

    // Every 90-degree turn leaves a DECK_WIDTH/2 square hole on the outside
    // of the pivot: the incoming (old-heading) and outgoing (this chunk's,
    // new-heading) decks are both plain rectangles that only ever share the
    // single pivot point, never that quadrant. Traced from frameFromRoute's
    // own world<->local mapping: the missing square always sits behind this
    // chunk's own start (negative local Z) and on whichever side
    // `spec.turn.dir` points away from the old heading (its sign, not its
    // negation - a left turn's dir=-1 leaves the gap at negative local X,
    // a right turn's dir=1 at positive local X). No new frame/transform is
    // needed - this chunk's own `frame` already reaches it.
    //
    // Turn chunks never change roof tier (RoofDirector only rolls a change
    // on 'jump', and a turn is never also a gap), so `at`/`atPrev` agree
    // here - no separate case needed.
    if (spec.turn) {
      this.pool.place(
        rig.cornerFill,
        at(spec.turn.dir * (DECK_WIDTH / 4), -DECK_THICKNESS / 2, -(DECK_WIDTH / 4)),
        frame.quaternion,
      );
    } else {
      this.pool.park(rig.cornerFill);
    }

    this.placeGapFacades(slot, frame, at, atPrev, chunkIndex, spec);
    this.placeRoofSurface(slot, frame, at, atPrev, chunkIndex, spec, rig);

    for (let i = 0; i < rig.obstacles.length; i++) {
      const placement = spec.obstacles[i];
      if (!placement) {
        this.pool.park(rig.obstacles[i]);
        continue;
      }
      this.pool.place(
        rig.obstacles[i],
        at(laneX(placement.lane), OBSTACLE_SIZE.height / 2, placement.z),
        frame.quaternion,
      );
    }

    if (spec.ventZ !== null) {
      this.pool.place(rig.ventPipe, at(0, VENT_PIPE_HEIGHT / 2, spec.ventZ), frame.quaternion);
    } else {
      this.pool.park(rig.ventPipe);
    }

    let beam: BeamHazard | null = null;
    if (spec.beamZ !== null) {
      const centre = at(0, BEAM_HEIGHT, spec.beamZ);
      this.pool.placeVisual(rig.beam, centre, frame.quaternion);
      const halfSpan = BEAM_LENGTH / 2;
      beam = {
        start: centre.clone().addScaledVector(frame.left, halfSpan),
        end: centre.clone().addScaledVector(frame.left, -halfSpan),
        y: centre.y,
      };
    } else {
      this.pool.hideVisual(rig.beam);
    }

    if (spec.turn) {
      this.pool.placeVisual(
        rig.turnMarker,
        at(laneX(spec.turn.dir), 0.02, TURN_MARKER_LOCAL_Z),
        frame.quaternion,
      );
    } else {
      this.pool.hideVisual(rig.turnMarker);
    }

    // Sits on deck A, a short lead-in before the gap opens - still `atPrev`
    // (deck A's own tier), so the pad reads as installed on the low roof the
    // player is standing on, not floating over the gap. Offset was 2.5 units
    // back from the gap when `DECK_A_LENGTH` was 11.75 (`CHUNK_LENGTH` 30);
    // cut to 1.2 for the 15-unit grid's much shorter ~4.25-unit deck A, so
    // there is still comfortable margin from both the chunk's own start and
    // the gap edge rather than the pad nearly spanning the whole segment.
    // Only ever rolled on a `'jump'` chunk that steps up (RoofDirector.next()),
    // so the pad always has a real gap in front of it to launch across.
    let trampoline: THREE.Vector3 | null = null;
    if (spec.trampoline) {
      trampoline = atPrev(0, 0, TRAMPOLINE_LOCAL_Z);
      this.trampolines.place(slot, trampoline, frame.quaternion);
    } else {
      this.trampolines.hide(slot);
    }

    const prop = generateRoofProp(spec.hasGap, this.rng);
    if (prop) {
      this.roofProps.place(slot, prop, at(prop.x, 0, prop.z));
    } else {
      this.roofProps.hide(slot);
    }

    const fishRig = this.fish.rigFor(slot);
    for (let i = 0; i < fishRig.length; i++) {
      const placement = spec.fish[i];
      if (!placement) {
        fishRig[i].root.visible = false;
        continue;
      }
      fishRig[i].moveTo(at(placement.x, placement.y, placement.z));
    }

    if (spec.powerUp) {
      this.powerUps.place(
        slot,
        spec.powerUp.kind,
        at(laneX(spec.powerUp.lane), POWERUP_HEIGHT, spec.powerUp.z),
      );
    } else {
      this.powerUps.hide(slot);
    }

    return { beam, trampoline, fishCount: spec.fish.length, hasPowerUp: spec.powerUp !== null };
  }
}
