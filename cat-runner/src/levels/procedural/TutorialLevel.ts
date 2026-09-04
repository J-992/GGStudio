import { laneX, type Lane } from '../chunkTemplate';
import { CHUNK_LENGTH } from '../TrackConfig';
import {
  generateJump,
  generateSlide,
  generateStraight,
  generateTurn,
  generateVent,
} from './ChunkGenerators';
import { FISH_HEIGHT, OBSTACLE_Z_LOOSE, ROOF_LOW, ROOF_MEDIUM, type ChunkSpec, type FishPlacement } from './ChunkTypes';
import type { TutorialLesson } from '../../game/Tutorial';

/**
 * The first-run tutorial prefix - completely hand-authored, not a chunk of
 * it decided by `ChunkDirector`/`generateChunk()`'s RNG. Every hazard's
 * type, position, and (where relevant) roof tier is a literal value below,
 * not a roll - see `ChunkBuilder`'s `fixedChunks` option, which this feeds
 * as the *first* `TUTORIAL_LEVEL_CHUNKS.length` chunks of an ordinary
 * endless run; once the array runs out, that same `ChunkBuilder` instance
 * falls straight through into normal procedural generation, with no reset
 * or scene change - see `Game.startEndless()`.
 *
 * Seven sections, each teaching exactly one mechanic before the next starts,
 * two plain `'straight'` buffer chunks between them (the only spacing lever
 * available, since `CHUNK_LENGTH` is fixed and uniform across every chunk
 * type): lane change, the horizontal pipe (jump), the clothesline (duck),
 * the standard gap (gap), the trampoline, a 90-degree turn, then a Combined
 * Challenge that restages three of the earlier hazards back-to-back with
 * tighter spacing and no instructional cue - see `lesson` below.
 *
 * The trampoline chunk (index 15) is the *only* chunk in the whole prefix
 * that changes roof tier - every chunk before it is tier 0, every chunk
 * after it is tier 1 - so the higher rooftop is provably unreachable any
 * other way, by construction rather than by suppressing a random roll.
 */

interface TutorialStep {
  readonly spec: ChunkSpec;
  /**
   * The lesson this hazard belongs to, for checkpoint bookkeeping - or
   * `null` for a plain buffer chunk. Reused (not distinct ids) on the
   * Combined Challenge's three hazards: by the time the player reaches them
   * in the same attempt, `TutorialDirector.learned` already has these
   * lessons banked, so its own "never re-arm a learned lesson" behaviour
   * means no cue reappears there - the section is a retention test, not a
   * second teaching moment - while `Game.respawnAtTutorialCheckpoint()`
   * still resolves a failure there to the correct checkpoint either way.
   */
  readonly lesson: TutorialLesson | null;
}

/** A blocked-lane chunk at the loosest, farthest Z the obstacle geometry has
 *  (see `ChunkGenerators.generateObstacle`'s own `simple` doc comment) -
 *  built directly rather than via `generateObstacle()`, since that takes an
 *  `rng` and this level draws from none. */
function obstacleChunk(lane: Lane, fish: readonly FishPlacement[] = []): ChunkSpec {
  return {
    ...generateStraight(),
    type: 'obstacle',
    obstacles: [{ lane, z: OBSTACLE_Z_LOOSE[1] }],
    fish,
  };
}

/** Carries a chunk onto the higher rooftop once the trampoline has raised it -
 *  every chunk from the trampoline onward reuses this rather than repeating
 *  the tier pair by hand. */
function onUpperRoof(spec: ChunkSpec): ChunkSpec {
  return { ...spec, previousRoofTier: ROOF_MEDIUM, roofTier: ROOF_MEDIUM };
}

/** Five fish drifting from the centre lane into the one lane 1 doesn't block,
 *  well ahead of the obstacle - the "lane switching with fish coin trails"
 *  requirement. No other chunk in the level carries fish: each section
 *  teaches one thing without a secondary distraction. */
const LANE_CHANGE_FISH_TRAIL: readonly FishPlacement[] = [
  { x: laneX(0), y: FISH_HEIGHT, z: 2 },
  { x: laneX(0), y: FISH_HEIGHT, z: 5 },
  { x: laneX(-1), y: FISH_HEIGHT, z: 8 },
  { x: laneX(-1), y: FISH_HEIGHT, z: 10.5 },
  { x: laneX(-1), y: FISH_HEIGHT, z: 13 },
];

const buffer: TutorialStep = { spec: generateStraight(), lesson: null };

const STEPS: readonly TutorialStep[] = [
  buffer, // 0: opening
  buffer, // 1
  buffer, // 2
  { spec: obstacleChunk(1, LANE_CHANGE_FISH_TRAIL), lesson: 'laneChange' }, // 3
  buffer, // 4
  buffer, // 5
  { spec: generateVent(), lesson: 'jump' }, // 6: horizontal pipe
  buffer, // 7
  buffer, // 8
  { spec: generateSlide(), lesson: 'duck' }, // 9: clothesline
  buffer, // 10
  buffer, // 11
  { spec: generateJump(), lesson: 'gap' }, // 12: standard gap, no tier change
  buffer, // 13
  buffer, // 14
  {
    spec: { ...generateJump(), previousRoofTier: ROOF_LOW, roofTier: ROOF_MEDIUM, trampoline: true },
    lesson: 'trampoline',
  }, // 15: gap + forced rise - the only tier change in the level
  { spec: onUpperRoof(generateStraight()), lesson: null }, // 16
  { spec: onUpperRoof(generateStraight()), lesson: null }, // 17
  { spec: onUpperRoof(generateTurn(1)), lesson: 'turn' }, // 18: 90 degrees right
  { spec: onUpperRoof(generateStraight()), lesson: null }, // 19: post-turn rest
  { spec: onUpperRoof(generateStraight()), lesson: null }, // 20: pre-combined buffer
  { spec: onUpperRoof(obstacleChunk(-1)), lesson: 'laneChange' }, // 21: combined - lane change again
  { spec: onUpperRoof(generateStraight()), lesson: null }, // 22: tight buffer
  { spec: onUpperRoof(generateJump()), lesson: 'gap' }, // 23: combined - gap again
  { spec: onUpperRoof(generateStraight()), lesson: null }, // 24: tight buffer
  { spec: onUpperRoof(generateTurn(-1)), lesson: 'turn' }, // 25: combined - turn again, other way
  { spec: onUpperRoof(generateStraight()), lesson: null }, // 26: finish
];

export const TUTORIAL_LEVEL_CHUNKS: readonly ChunkSpec[] = STEPS.map((step) => step.spec);

export interface TutorialCheckpoint {
  readonly lesson: TutorialLesson;
  /** Arc of the hazard itself - the middle of its chunk. */
  readonly hazardArc: number;
  /** Arc to respawn to on failure - the start of the buffer chunk right
   *  before the hazard. */
  readonly respawnArc: number;
}

export const TUTORIAL_LEVEL_CHECKPOINTS: readonly TutorialCheckpoint[] = STEPS.reduce<
  TutorialCheckpoint[]
>((checkpoints, step, index) => {
  if (step.lesson) {
    checkpoints.push({
      lesson: step.lesson,
      hazardArc: index * CHUNK_LENGTH + CHUNK_LENGTH / 2,
      respawnArc: Math.max(0, (index - 1) * CHUNK_LENGTH),
    });
  }
  return checkpoints;
}, []);

/**
 * Arc at which the prefix is considered finished - the start of the final
 * chunk, a full chunk short of `STEPS.length * CHUNK_LENGTH`. That margin is
 * deliberate: it guarantees `Game.completeTutorial()` (and so `tutorialActive`
 * turning off) fires with a full chunk of lead time before the runner could
 * ever reach the first genuinely procedural chunk `ChunkBuilder` deals right
 * after this array runs out.
 */
export const TUTORIAL_LEVEL_FINISH_ARC = (STEPS.length - 1) * CHUNK_LENGTH;
