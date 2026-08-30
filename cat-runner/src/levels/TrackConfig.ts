/**
 * The endless track's fixed geometry.
 *
 * Everything here is a consequence of one decision: the track is a single
 * straight run along +Z at a constant height, so world Z, arc length along the
 * route, chunk position and the player's score are all the same number. No
 * conversions anywhere.
 */

/**
 * Height of the walking surface.
 *
 * Kept at the campaign's rooftop height rather than moved to zero, because the
 * lighting and skyline blocks the themes inherit were tuned against a deck at
 * this height - the fog distances, the sun angle and the skyline height clamp
 * all read off it.
 */
export const TRACK_Y = 20.5;

/** Deck slab thickness. Its centre sits half of this below {@link TRACK_Y}. */
export const DECK_THICKNESS = 1;

/**
 * Deck width.
 *
 * Three lanes span `2 * laneSpacing` = 4.8 units; the rest is the margin that
 * makes a mistimed lane change survivable and gives the parapet somewhere to
 * stand. Cut from 30 (which matched the campaign's *widest* opening roof, and
 * read as excess dead space on the endless track's sides) to 14, matching
 * the campaign's own narrowest authored walkway (`ROOF_W` in `level1.ts`) -
 * "fits the narrowest authored walkway with room to spare" per that file's
 * own note, so this is a proven-safe width, not a new guess.
 *
 * Trimming this is cosmetic, not a fairness fix: `PlayerController` clamps
 * `lane` to {-1, 0, 1} and seeks `lateral` toward the lane's own centre, so
 * the runner was never able to reach the empty space at the old width
 * regardless of how wide the deck was.
 *
 * This was briefly cut to the lane span exactly, so that the deck edge was the
 * outer lane's edge. It read as a plank in a void, and it is not what makes
 * lane choice matter - the runner is confined to three lanes by the controller
 * whatever the roof is doing.
 */
export const DECK_WIDTH = 14;

/**
 * Length of one chunk.
 *
 * Was 80 through the first density/fish/power-up pass, then 30 through the
 * rooftop-tier rework. Halved again to 15 for this round: at `runSpeed` 11
 * that's ~1.4s per chunk, so a gameplay decision (obstacle, gap, height
 * change, fish trail, power-up) arrives roughly every second, not every
 * ~2.7s - "the plain straight chunk creates too much empty space" is fixed by
 * shrinking the whole grid uniformly rather than giving `'straight'` its own
 * shorter length, which would need `RouteGrowth`/`ChunkStreamer` to support a
 * variable arc-length per chunk type (see `ChunkDirector.ts`'s doc comment
 * for why `'straight'` is instead just rare, not shorter).
 *
 * Every other `CHUNK_LENGTH`-derived constant was re-checked against this
 * value, not just left to fall out of the formula silently - see
 * `ChunkTypes.ts`'s `MIN_HAZARD_SPACING`/`OBSTACLE_Z_LOOSE`/`_TIGHT` and
 * `RoofFeatures.ts`'s `TRAMPOLINE_LAUNCH_VELOCITY`, both of which had a
 * real, checked reason to change here, not an incidental one.
 */
export const CHUNK_LENGTH = 15;

/**
 * How far ahead of the player the deck must already exist.
 *
 * Cut from 220. That number was chosen as "about 20 s of running", but what
 * it actually bought was 60 units of fully-streamed track - real meshes, real
 * Rapier colliders, real draw calls - sitting *past* the point the fog had
 * already gone opaque, which is scenery nobody can see at any cost at all.
 * It also had the pop-in backwards: `ENDLESS_LIGHTING.fogFar` was 260 against
 * this 220, so a chunk arrived at ~70 % fog and faded the rest of the way in
 * on screen.
 *
 * Pinned to the fog's own far distance instead, which fixes both: a chunk is
 * now dealt exactly where the fog is opaque, so it materialises invisible and
 * emerges as the runner closes on it. At Catnip Rush speed this is still ~11 s
 * of track in hand, and `ChunkStreamer` only ever builds one chunk per frame,
 * so the shorter window is not a stall risk.
 */
export const AHEAD_DISTANCE = 165;

/** How far behind the player a chunk survives before being retired. The
 *  camera sits ~7 units back, so this is already many times what is needed to
 *  keep the deck under the frame - it exists for the fall-recovery setback,
 *  not for the view. */
export const BEHIND_DISTANCE = 45;

/**
 * Only chunks within this distance of the player get their fixed-step update.
 *
 * The campaign stepped every object in the level every step. On an endless
 * track that is unbounded work, and it is also pointless: a steam vent forty
 * seconds behind the player is not observable.
 */
export const STEP_RADIUS = 90;

/**
 * Total track length.
 *
 * Rapier stores f32, so the mantissa gives ~4mm of resolution at z = 65,536 and
 * ~8mm at 131,072. At `runSpeed` 11 this length is about 5 hours of continuous
 * running, and the precision is still millimetric well past the point anyone
 * plays. A floating origin would remove the ceiling entirely and becomes cheap
 * once chunks are pooled (Phase 2), but it buys nothing a player will ever see.
 */
export const TRACK_LENGTH = 200_000;

/**
 * Where the lane path begins.
 *
 * Behind the spawn, so `RunPath.alongOf()` is positive from the first frame -
 * `Game.trackSafeGround()` rejects a negative `along`, and with the path
 * starting at the spawn the very first recovery point would never be recorded.
 */
export const TRACK_START_Z = -400;

/** World Z the runner spawns at. Arc length 0 on the route. */
export const SPAWN_Z = 0;
