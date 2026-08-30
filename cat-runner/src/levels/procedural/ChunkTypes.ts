import { CHUNK_LENGTH, DECK_WIDTH } from '../TrackConfig';
import type { Lane } from '../chunkTemplate';
import { CLOTHESLINE_CURTAIN_DROP } from '../../assets/ProceduralProps';

/**
 * The chunk types the director deals from, and the fixed geometry every
 * chunk of a given type shares.
 *
 * Every *size* below is a constant, on purpose: the object pool keeps one
 * fixed-size body per role per streamer slot and only ever repositions it,
 * never rebuilds it. Where a role sits - lane, Z within the chunk - changes
 * every spawn and always did (translation was never pooling-constrained,
 * only box dimensions were), which is what lets `obstacles`/`beamZ` below
 * vary freely per chunk instead of being fixed pairs. See `ObstaclePool.ts`
 * for why that's what makes pooling trivial here.
 */

export type ChunkType =
  | 'straight'
  | 'obstacle'
  | 'slide'
  | 'jump'
  | 'vent'
  | 'turnLeft'
  | 'turnRight';

export const CHUNK_TYPES: readonly ChunkType[] = [
  'straight',
  'obstacle',
  'slide',
  'jump',
  'vent',
  'turnLeft',
  'turnRight',
];

export interface TurnSpec {
  readonly dir: -1 | 1;
  /** Signed heading change in radians. Always ±90° for this prototype. */
  readonly deltaYaw: number;
}

/** Low/Medium/High rooftop tier - see `RoofFeatures.RoofDirector`. Named
 *  aliases below are the ones every call site should reason in; the numeric
 *  type itself stays `0|1|2` rather than a string union, since it already
 *  flows through `ChunkSpec`/`ChunkBuilder`/several tests as a plain array
 *  index (`ROOF_TIER_HEIGHT[tier]`) and a rename would touch all of that for
 *  no behavioural change. */
export type RoofTier = 0 | 1 | 2;

export const ROOF_LOW: RoofTier = 0;
export const ROOF_MEDIUM: RoofTier = 1;
export const ROOF_HIGH: RoofTier = 2;

/**
 * The three fixed, discrete rooftop heights - the only Y-levels a chunk's
 * deck is ever built at. One central table, on purpose: nothing in this
 * game ever computes an arbitrary or randomised roof height, only ever
 * looks one of these three values up.
 *
 * Applied uniformly to every placement in a chunk that sits on its *own*
 * tier (deck, obstacles, fish, power-ups, buildings) as `ChunkBuilder`'s
 * `roofY`. A gap chunk whose two sides sit at different tiers (see
 * `RoofDirector`) is the one exception - its far side still reads this same
 * table, just keyed by `previousRoofTier` instead (`ChunkBuilder`'s
 * `prevRoofY`), never by an offset added on top of it.
 */
export const ROOF_TIER_HEIGHT: Readonly<Record<RoofTier, number>> = {
  [ROOF_LOW]: 0,
  [ROOF_MEDIUM]: 3,
  [ROOF_HIGH]: 6,
};

export interface ObstaclePlacement {
  readonly lane: Lane;
  readonly z: number;
}

export interface FishPlacement {
  /** Chunk-local lateral offset - same axis/handedness as `laneX()`, but
   *  continuous rather than snapped to a lane centre (arcs/weaves need to
   *  sit off-centre). */
  readonly x: number;
  /** Height above the walking surface. */
  readonly y: number;
  readonly z: number;
}

export type PowerUpType =
  | 'fishMagnet'
  | 'catnipRush'
  | 'nineLives'
  | 'shield';

export interface PowerUpPlacement {
  readonly kind: PowerUpType;
  readonly lane: Lane;
  readonly z: number;
}

export interface ChunkSpec {
  readonly type: ChunkType;
  /** 0-3 independent lane-block decisions. Construction never allows a
   *  single Z to block all three lanes - see each generator's own comment -
   *  but different entries are free to sit at different Z's, so a chunk can
   *  contain several individually-safe decisions. */
  readonly obstacles: readonly ObstaclePlacement[];
  /** Chunk-local Z of the slide beam, or null if this chunk has none. */
  readonly beamZ: number | null;
  /** Chunk-local Z of the vent pipe (see `'vent'` chunks), or null if this
   *  chunk has none. Mirrors `beamZ` exactly - a full-width hazard at a
   *  single Z - but read by a real Rapier collider rather than a manual
   *  overlap check, since duck must never bypass it. See `VENT_PIPE_HEIGHT`. */
  readonly ventZ: number | null;
  /** True only for gap-bearing types: the gap-filler deck piece is left out. */
  readonly hasGap: boolean;
  readonly turn: TurnSpec | null;
  /** Collectible fish for this chunk - see `FishPatterns.ts`. */
  readonly fish: readonly FishPlacement[];
  /** At most one power-up pickup per chunk. */
  readonly powerUp: PowerUpPlacement | null;
  /** This chunk's own rooftop height tier - see `RoofFeatures.RoofDirector`,
   *  which decides it (never this module: it needs the previous chunk's
   *  tier, which a pure `(type, rng) -> ChunkSpec` function has no way to
   *  see). Defaults to 0 in `ChunkGenerators.EMPTY`, exactly like `fish`/
   *  `powerUp` default to empty - `ChunkBuilder` overwrites it before use. */
  readonly roofTier: RoofTier;
  /** The previous chunk's own tier - the trampoline pad sits at this (old,
   *  low-side) height, not `roofTier`. Equal to `roofTier` on any chunk
   *  that doesn't change height. */
  readonly previousRoofTier: RoofTier;
  /** True the one chunk a tier increase happens on - always a `'jump'`
   *  chunk, since height only ever changes at a gap. */
  readonly trampoline: boolean;
}

// --- Deck geometry -----------------------------------------------------------
//
// Every chunk's deck is the same three pieces end to end: A, a gap-filler C,
// then B. A non-gap chunk shows all three, so the deck is one unbroken
// 80-unit run with no lip. A gap chunk hides C, leaving a gap exactly where
// it sat. A and B never change size or position - only C's visibility does -
// so the pool never has to resize a collider.

/** Gap a jump-bearing chunk opens up. Comfortably under the campaign's 7.5u
 *  jump budget (`tests/levels.test.ts`), which this deliberately matches
 *  rather than re-deriving, so both tracks agree on what's actually
 *  jumpable. */
export const GAP_LENGTH = 6.5;
export const DECK_A_LENGTH = (CHUNK_LENGTH - GAP_LENGTH) / 2;
export const DECK_B_LENGTH = DECK_A_LENGTH;
export const DECK_A_CENTER_Z = DECK_A_LENGTH / 2;
export const DECK_C_CENTER_Z = DECK_A_LENGTH + GAP_LENGTH / 2;
export const DECK_B_CENTER_Z = DECK_A_LENGTH + GAP_LENGTH + DECK_B_LENGTH / 2;
/** World Z span the gap itself occupies - fish arcs read this directly
 *  rather than re-deriving it, so an arc is always centred on the real gap. */
export const GAP_START_Z = DECK_A_LENGTH;
export const GAP_END_Z = DECK_A_LENGTH + GAP_LENGTH;

export { DECK_WIDTH };

// --- Obstacle geometry ---------------------------------------------------

/** Fixed box size for every obstacle placement, whichever role holds it. */
export const OBSTACLE_SIZE = { width: 2.2, height: 1.4, depth: 1.8 } as const;

/** Minimum Z spacing enforced between any two hazard elements (obstacle,
 *  beam, or gap edge) placed in the same chunk - the density increase this
 *  round is "more frequent decisions," not "less reaction time between
 *  them." Was 10 (~0.9s of travel at PHYSICS.runSpeed) against a 30-unit
 *  `CHUNK_LENGTH`; halved to **5** (~0.45s) when the grid halved to 15, since
 *  a 30-unit-tuned 10-unit floor no longer fits inside a 15-unit chunk with
 *  any margin left for the deck/gap geometry itself. A real, checked
 *  trade-off, not an incidental one - `OBSTACLE_Z_LOOSE`/`_TIGHT`/`_TRIPLE`
 *  below are chosen so both their own internal spacing *and* the worst-case
 *  gap across a chunk boundary (one hazard near a chunk's tail, the next
 *  chunk's hazard near its head) still clear this floor - see
 *  `tests/procedural.test.ts`'s explicit check. */
export const MIN_HAZARD_SPACING = 5;

/**
 * Candidate chunk-local Z sets for the multi-obstacle chunk, re-derived for
 * the 15-unit grid in the same *proportions* the old pairs held within the
 * 30-unit one (`_TIGHT`: centred, smaller spacing, bigger edge margin;
 * `_LOOSE`: wider spacing, smaller edge margin) rather than picked fresh -
 * `ChunkGenerators.generateObstacle` picks between them so obstacle chunks
 * aren't always the same fixed split. Every set's own internal spacing, and
 * the margin it keeps from its own chunk's edges, clear
 * `MIN_HAZARD_SPACING` even in the worst case where an adjacent chunk's
 * hazard sits right at the shared boundary (`CHUNK_LENGTH - max + min`).
 */
export const OBSTACLE_Z_LOOSE: readonly [number, number] = [3, 11];
export const OBSTACLE_Z_TIGHT: readonly [number, number] = [5, 10];
/** Three-obstacle case (all three lanes blocked, each at its own Z) - see
 *  `ChunkGenerators.generateObstacle`'s doc comment for why three is now the
 *  common case rather than the rare one. */
export const OBSTACLE_Z_TRIPLE: readonly [number, number, number] = [2, 7, 12];

// --- Slide beam geometry ---------------------------------------------------

/**
 * Two bugs, one after the other, both from getting `CLOTHESLINE_ROPE_HEIGHT`
 * (1.8) wrong in the same way: treating it as the *centre* of a thin
 * +-radius band instead of the *top* of a band that drops down from it.
 *
 * Bug 1 (fixed previously): `BEAM_HEIGHT = CLOTHESLINE_ROPE_HEIGHT`,
 * `BEAM_RADIUS = 0.35` gave `[1.45, 2.15]`, entirely above a standing cat's
 * head (1.0) - so standing/running never collided and the beam could be
 * walked straight under without sliding.
 *
 * Bug 2 (fixed here): raising the band to overlap the head (`[0.3, 1.1]`,
 * `BEAM_HEIGHT = 0.7`, `BEAM_RADIUS = 0.4`) fixed that, but left the band's
 * *top* (1.1) well below the cat's max jump height (feet peak at
 * `jumpImpulse^2 / (2 * -gravity)` = 7.9^2 / 36 = 1.73 units - a hard
 * ceiling of the jump physics, not something timing can beat) - so the beam
 * could simply be jumped over instead.
 *
 * The campaign's own slide obstacle (`Clothesline.ts`, `hazard: true`)
 * already solves both at once, and its own doc comment
 * (`LevelTypes.ts`'s `ClotheslineDef`) says so explicitly: the curtain hangs
 * from `CLOTHESLINE_ROPE_HEIGHT` *down* by `CLOTHESLINE_CURTAIN_DROP`, not
 * centred on it - `curtainTop = 1.8`, `curtainBottom = 1.8 - 1.25 = 0.55`.
 * 1.8 sits just above the same 1.73 jump ceiling (shared `PhysicsConfig`
 * across campaign and endless track alike) - tight, but shipped and proven
 * fair - while 0.55 sits well below the standing head. Deriving the band the
 * same way fixed both at once.
 *
 * The band has since been re-derived against the *runner* rather than the
 * campaign prop - see {@link BEAM_BOTTOM} for why - but the two properties
 * that history establishes are the ones still being defended, and both are
 * pinned by `tests/procedural.test.ts`: the band's bottom must sit below a
 * standing head, and its top above the jump apex.
 */
/**
 * Bottom edge of the hazard band - the underside of the barrier, and so the
 * top of the gap the player slides through.
 *
 * Was 0.55, straight off the campaign clothesline's curtain bottom
 * (`CLOTHESLINE_ROPE_HEIGHT - CLOTHESLINE_CURTAIN_DROP`). That reads badly:
 * 0.55 against a 1.0-unit cat leaves a slot barely half the runner's height,
 * so at a glance the barrier looks like it meets the deck and the honest
 * response looks like "crash". Raised to 0.85 - 85% of the cat's standing
 * height - so there is an obvious cat-sized opening underneath, which is the
 * thing that tells the player to duck.
 *
 * 0.85 is close to the hard ceiling and deliberately so. Standing collision
 * is decided by `head >= BEAM_BOTTOM` in `ChunkBuilder.overlapsBeam()`, and a
 * standing head sits at exactly `2 * capsuleFeetOffset()` = 1.0, so any value
 * at or above 1.0 restores the original "walk straight under it without
 * sliding" bug. 0.85 keeps 0.15 of margin - 15% of the cat, ~44% of the
 * collider radius - which is far more than one frame of vertical
 * interpolation can eat. `tests/procedural.test.ts` pins the margin, so
 * pushing this any higher fails loudly rather than silently disarming the
 * hazard.
 *
 * No longer derived from the clothesline constants: the campaign prop hangs
 * from a real rope at a real height and has its own reasons for sitting where
 * it does, while this band is now positioned against the *runner* instead.
 * Tying them together would mean a future tweak to either one silently moving
 * the other.
 */
export const BEAM_BOTTOM = 0.85;

/**
 * Top edge of the hazard band.
 *
 * The band's *size* (top - bottom = 3.45) is settled and deliberately
 * unchanged here: raised from 1.25 on a report that the barrier "looks like
 * the player is supposed to jump over it," which at a 1.8 top was fair - it
 * stood barely taller than the 1.73 jump apex it was meant to defeat, so it
 * was unjumpable by 0.07 units and unreadable at the same time. 3.45 units of
 * panel - over three times the cat's height - can only be read as a wall.
 *
 * This value moves only because {@link BEAM_BOTTOM} moved: 0.85 + 3.45 = 4.3,
 * so the whole barrier slides up 0.3 and keeps the shape that already worked.
 * It stays well clear of the 1.73 jump ceiling either way, so jumping remains
 * impossible by construction rather than by timing.
 *
 * The follow camera sits 3.8 above the deck (`FollowCamera.DEFAULT_CAMERA`),
 * so the top of the panel is above the eyeline - as it already was at 4.0.
 * That costs nothing in practice: the barrier is 0.15 thick and the approach
 * behind it is only occluded for the moment it fills the frame, by which
 * point the duck is already committed.
 *
 * Note this widens the band upward, into space a jump could never reach.
 * Nothing about *when* the player must duck changes - see
 * {@link BEAM_HALF_DEPTH}, which is what actually governs that.
 */
export const BEAM_TOP = 4.3;

/**
 * Half the band's *vertical* extent, and the centre it is measured from - so
 * the `beam.y +- BEAM_RADIUS` test in `ChunkBuilder.overlapsBeam()` reproduces
 * [{@link BEAM_BOTTOM}, {@link BEAM_TOP}] with no asymmetric-band special case,
 * exactly as before.
 */
export const BEAM_RADIUS = (BEAM_TOP - BEAM_BOTTOM) / 2;

/**
 * Half the band's *along-track* extent - how deep the hazard is in the
 * direction the runner is travelling, and therefore how long the duck has to
 * last to get through it.
 *
 * Split out from `BEAM_RADIUS` when the band grew upward. The overlap test
 * used the one constant for both axes, which was harmless only while the band
 * happened to be roughly as deep as it was tall. Left shared, raising the top
 * edge to 4.0 would have silently deepened the trigger zone from 1.85 to 4.75
 * units - and at `runSpeed` 11 against a 0.55 s duck (6 units of travel) that
 * turns a hazard with comfortable timing slack either side into one that has
 * almost none. Pinned to the value the shared constant used to carry, so the
 * timing of a slide is bit-for-bit what it was before the visual change.
 */
export const BEAM_HALF_DEPTH = CLOTHESLINE_CURTAIN_DROP / 2;

/** Spans the full deck width - always all three lanes, per the spec. */
export const BEAM_LENGTH = DECK_WIDTH * 0.6;
/** Default beam position for a plain 'slide' chunk (dead centre). */
export const BEAM_LOCAL_Z = CHUNK_LENGTH * 0.5;
/**
 * Height above the walking surface - the *centre* of the band, i.e. the
 * midpoint of [{@link BEAM_BOTTOM}, {@link BEAM_TOP}]. A standing cat's head
 * sits at 1.0 (capsule is a full unit tall, feet at 0) - comfortably inside
 * the band - and the top now clears the max jump height (1.73) by a wide
 * margin rather than by 0.07, so running collides, jumping collides, and only
 * `player.isDucking` (checked before any geometry, same as the campaign's
 * `Clothesline`) lets the player through.
 */
export const BEAM_HEIGHT = (BEAM_TOP + BEAM_BOTTOM) / 2;

// --- Turn marker -----------------------------------------------------------

export const TURN_MARKER_LOCAL_Z = CHUNK_LENGTH * 0.15;
export const TURN_MARKER_RADIUS = 1.0;
export const TURN_MARKER_HEIGHT = 1.4;

// --- Fish geometry -----------------------------------------------------------

/**
 * Height fish float above the walking surface.
 *
 * Was 1.6 (matching the campaign's own token height), which - combined with
 * `Collectible`'s full-3D `COLLECT_RADIUS` (1.5) - was already collectible
 * without jumping, just visually floating well above a standing cat's head
 * (1.0). Lowered to sit at the standing capsule's own centre height, so fish
 * read as placed directly on the running path rather than floating in the
 * air.
 */
export const FISH_HEIGHT = 0.5;
/**
 * Height fish sit above the gap floor when arcing over a jump - well above
 * head height (1.0) so a grounded (non-jumping) cat can never sweep them up.
 *
 * Was 3.2, nearly a full unit above the capsule's own real reachable apex:
 * feet peak at `jumpImpulse^2 / (2*|gravity|)` = 1.73 (see
 * `ChunkTypes.BEAM_BOTTOM`'s derivation), and the capsule's *centre* - what
 * actually matters for `Collectible`'s distance-based pickup check - adds
 * `PHYSICS`'s collider half-height + radius (0.5) on top of that, so ~2.23.
 * At 3.2 the peak fish was only collectible at all because `COLLECT_RADIUS`
 * (1.5) closed the remaining ~1-unit gap - and since the run-speed ramp also
 * shifts *where* along Z the capsule's real apex falls relative to the
 * arc's fixed peak position, that whole 1.5-unit budget was often needed
 * just for the vertical shortfall, leaving little margin for the timing
 * mismatch. Lowered to sit just above the true capsule-centre apex instead,
 * so the pickup radius is mostly free to absorb timing/position drift
 * rather than a self-inflicted height gap.
 */
export const FISH_ARC_PEAK_HEIGHT = 2.3;

// --- Power-up geometry -------------------------------------------------------

export const POWERUP_RADIUS = 0.6;
/**
 * Height every power-up pickup floats above the walking surface - one
 * constant for all four types, so "consistent height across pickups" is true
 * by construction rather than by each spawn site agreeing separately.
 *
 * Was `FISH_HEIGHT + 0.4` (0.9), which read as floating noticeably higher
 * than the fish it shares a track with. Dropped to sit just above fish height
 * - still clearly a floating pickup, not a fish, but low enough to read as
 * part of the running path rather than hovering overhead. `PowerUps.ts`'s
 * `anchorAboveGround()` keeps whichever model is active clear of the deck
 * regardless of this value, and `ChunkBuilder`'s bob animation
 * (`POWERUP_BOB_AMOUNT`, +-0.18) is well within the margin that leaves.
 */
export const POWERUP_HEIGHT = FISH_HEIGHT + 0.1;

// --- Vent pipe geometry -------------------------------------------------------

/**
 * The jump-only hazard: a horizontal pipe sitting on the deck across every
 * lane, exactly like a crate obstacle except it can't be lane-dodged.
 *
 * Height is its own constant, deliberately thinner and lower than a crate
 * (`OBSTACLE_SIZE.height`, 1.4): the pipe reads as a single round bar, not a
 * box, so it can afford to sit closer to the deck while still being clearly
 * visible from a distance - a normal jump apex (`jumpImpulse^2 /
 * (2*|gravity|)` = 1.73, see `ChunkTypes.BEAM_BOTTOM`'s derivation for where
 * that number comes from) now clears its top (1.15) by a full 0.58-unit
 * margin, comfortably more than a crate's 0.33, so it never demands
 * frame-perfect timing even at the top of the run's speed ramp.
 *
 * Unlike the clothesline, this is a *real* Rapier collider (see
 * `ObstaclePool.buildVentPipe()`), not a manual overlap check gated on
 * `player.isDucking` - ducking is a pose flag that never moves the capsule's
 * actual Y in this engine (see `ChunkBuilder.overlapsBeam()`'s own note), so
 * a ground-mounted collider already can't be gone under by sliding; only
 * genuinely leaving the ground clears it. That is the whole point: running
 * underneath collides exactly like a crate would, and only a jump - which
 * measurably lifts the capsule - passes over it.
 *
 * The visual cylinder (`VentPipeHazard.buildVentPipeVisual`) is scaled
 * directly off this constant for both its diameter and its mounting height
 * (`ChunkBuilder.placeChunk`'s `VENT_PIPE_HEIGHT / 2`), and the collider box
 * (`ObstaclePool.buildVentPipe`) is sized off it too - one number keeps the
 * visible pipe, its mount height, and its hitbox in lockstep by construction.
 */
export const VENT_PIPE_HEIGHT = 1.15;
export const VENT_PIPE_DEPTH = OBSTACLE_SIZE.depth;
/** Spans the full deck width, exactly like the clothesline beam - the one
 *  thing that makes it un-dodgeable by lane change. */
export const VENT_PIPE_LENGTH = BEAM_LENGTH;
/** Same chunk-centre convention the slide beam uses. */
export const VENT_PIPE_LOCAL_Z = CHUNK_LENGTH * 0.5;
