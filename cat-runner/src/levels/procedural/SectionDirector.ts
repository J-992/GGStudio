import { CHUNK_LENGTH } from '../TrackConfig';
import type { Rng } from './ChunkGenerators';

/**
 * The repeating gameplay rhythm requested for this pass, sitting above the
 * existing early/mid/late difficulty tiers (`ChunkDirector.tierAt`, which
 * keeps scaling *overall* intensity across a whole run). This governs
 * moment-to-moment pacing *within* any tier:
 *
 *   Easy -> Fish Collection -> Obstacle Challenge -> Reward -> Hard Obstacle
 *   Challenge -> repeat
 *
 * A pure function of chunk index (plus which cycle variant a run picked, see
 * below), not stateful - streamer chunk indices are already monotonically
 * increasing and never revisited, so "which section is chunk N in" never
 * needs to remember anything beyond that one per-run choice.
 */

export type SectionType =
  | 'easy'
  | 'fishCollection'
  | 'obstacleChallenge'
  | 'reward'
  | 'hardObstacleChallenge';

interface CycleEntry {
  readonly section: SectionType;
  /** Chunks this section lasts. */
  readonly length: number;
}

/**
 * A handful of reorderings of the same 11-chunk rhythm, so the moment-to-
 * moment pacing doesn't play out identically on every run. Every variant
 * keeps the same section *types* and *counts* (2 easy + 2 fish collection +
 * 3 obstacle challenge + 1 reward + 3 hard obstacle challenge), and keeps
 * `easy` first and `hardObstacleChallenge` last - so section 0 is always a
 * breather and Hard content never gets front-loaded, regardless of which
 * variant a run picks. Only the middle 6 chunks (fish/obstacle/reward) get
 * reshuffled between variants.
 */
const CYCLE_VARIANTS: readonly (readonly CycleEntry[])[] = [
  // Variant 0 - the original order.
  [
    { section: 'easy', length: 2 },
    { section: 'fishCollection', length: 2 },
    { section: 'obstacleChallenge', length: 3 },
    { section: 'reward', length: 1 },
    { section: 'hardObstacleChallenge', length: 3 },
  ],
  // Variant 1 - the obstacle run comes first, fish collection right before Hard.
  [
    { section: 'easy', length: 2 },
    { section: 'obstacleChallenge', length: 3 },
    { section: 'reward', length: 1 },
    { section: 'fishCollection', length: 2 },
    { section: 'hardObstacleChallenge', length: 3 },
  ],
  // Variant 2 - the reward sits right after the easy opener, before either challenge.
  [
    { section: 'easy', length: 2 },
    { section: 'reward', length: 1 },
    { section: 'fishCollection', length: 2 },
    { section: 'obstacleChallenge', length: 3 },
    { section: 'hardObstacleChallenge', length: 3 },
  ],
];

export const CYCLE_VARIANT_COUNT = CYCLE_VARIANTS.length;
export const CYCLE_LENGTH_CHUNKS = CYCLE_VARIANTS[0].reduce((sum, e) => sum + e.length, 0);
export const CYCLE_LENGTH_UNITS = CYCLE_LENGTH_CHUNKS * CHUNK_LENGTH;

/** Picks a cycle variant for a run, drawing from the same per-run PRNG
 *  stream chunk generation already uses rather than a second random source. */
export function pickCycleVariant(rng: Rng): number {
  return Math.floor(rng() * CYCLE_VARIANT_COUNT) % CYCLE_VARIANT_COUNT;
}

/** Which section a chunk at this index (0-based, negative treated as 0)
 *  falls into, under the given cycle variant (defaults to the original
 *  order - existing callers that don't care about variation keep working
 *  unchanged). */
export function sectionAtIndex(chunkIndex: number, variant = 0): SectionType {
  const cycle = CYCLE_VARIANTS[variant] ?? CYCLE_VARIANTS[0];
  const clamped = Math.max(0, chunkIndex);
  let offset = clamped % CYCLE_LENGTH_CHUNKS;
  for (const entry of cycle) {
    if (offset < entry.length) return entry.section;
    offset -= entry.length;
  }
  return cycle[0].section; // unreachable - offset is always < CYCLE_LENGTH_CHUNKS
}

/** Same thing, from a route distance rather than a chunk index. */
export function sectionAtDistance(distance: number, variant = 0): SectionType {
  return sectionAtIndex(Math.round(distance / CHUNK_LENGTH), variant);
}
