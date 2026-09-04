import { laneX, type Lane } from '../chunkTemplate';
import { CHUNK_LENGTH } from '../TrackConfig';
import type { Rng } from './ChunkGenerators';
import type { SectionType } from './SectionDirector';
import type { DifficultyTier } from './ChunkDirector';
import {
  FISH_ARC_PEAK_HEIGHT,
  FISH_HEIGHT,
  GAP_END_Z,
  GAP_START_Z,
  VENT_PIPE_HEIGHT,
  type ChunkSpec,
  type FishPlacement,
} from './ChunkTypes';

/**
 * Fish trails, placed in named patterns rather than scattered randomly - see
 * `ChunkDirector.ts`'s doc comment for the rhythm these patterns key off.
 *
 * "Reward riskier routes with more fish" is implemented structurally, not by
 * a difficulty flag: {@link arcPattern} only ever appears over a real jump
 * gap and {@link weavePattern} only ever appears at real obstacle Z's, read
 * straight off `spec.hasGap`/`spec.obstacles` - so a fish trail that asks for
 * the harder line is only ever placed where the harder line actually exists.
 */

const ALL_LANES: readonly Lane[] = [-1, 0, 1];

function randomLane(rng: Rng): Lane {
  return ALL_LANES[Math.floor(rng() * ALL_LANES.length)];
}

function otherLane(blocked: Lane, rng: Rng): Lane {
  const candidates = ALL_LANES.filter((l) => l !== blocked);
  return candidates[Math.floor(rng() * candidates.length)];
}

/** One lane, `count` fish evenly spaced with margin at both ends. */
function straightLinePattern(rng: Rng, count: number): FishPlacement[] {
  const x = laneX(randomLane(rng));
  const margin = 5;
  const span = CHUNK_LENGTH - margin * 2;
  const fish: FishPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const z = margin + (span * i) / Math.max(1, count - 1);
    fish.push({ x, y: FISH_HEIGHT, z });
  }
  return fish;
}

/** Alternates lanes step to step - teaches/exercises lane movement. */
function zigzagPattern(rng: Rng, count: number): FishPlacement[] {
  let idx = Math.floor(rng() * ALL_LANES.length);
  const dir = rng() < 0.5 ? 1 : -1;
  const margin = 4;
  const span = CHUNK_LENGTH - margin * 2;
  const fish: FishPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const z = margin + (span * i) / Math.max(1, count - 1);
    fish.push({ x: laneX(ALL_LANES[idx]), y: FISH_HEIGHT, z });
    idx = (idx + dir + ALL_LANES.length) % ALL_LANES.length;
  }
  return fish;
}

/**
 * A parabolic arc centred on the actual gap (`GAP_START_Z`/`GAP_END_Z`, read
 * off `ChunkTypes.ts` rather than re-guessed), starting and ending just
 * short of it on solid deck so the trail reads as "jump *through* this," not
 * "jump *to* this." Peak height (`FISH_ARC_PEAK_HEIGHT`) sits well above a
 * grounded cat's reach, so only committing to the jump collects the middle
 * of the trail - the risk/reward the spec asks for.
 */
function arcPattern(): FishPlacement[] {
  const count = 7;
  const startZ = GAP_START_Z - 3;
  const endZ = GAP_END_Z + 3;
  const fish: FishPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const arcT = Math.sin(t * Math.PI);
    fish.push({
      x: 0,
      y: FISH_HEIGHT + (FISH_ARC_PEAK_HEIGHT - FISH_HEIGHT) * arcT,
      z: startZ + (endZ - startZ) * t,
    });
  }
  return fish;
}

/**
 * A short, low arc straddling the vent pipe - the same "reward the harder
 * line" idea as {@link arcPattern}, scaled down to the pipe's much shorter
 * commitment. Peak sits just above the pipe's own top and well under the
 * jump apex, so only a real jump (not a lucky graze) ever collects the
 * middle fish.
 */
function ventArcPattern(ventZ: number): FishPlacement[] {
  const count = 3;
  const span = 4;
  const startZ = ventZ - span / 2;
  const endZ = ventZ + span / 2;
  const peakHeight = VENT_PIPE_HEIGHT + 0.2;
  const fish: FishPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const arcT = Math.sin(t * Math.PI);
    fish.push({
      x: 0,
      y: FISH_HEIGHT + (peakHeight - FISH_HEIGHT) * arcT,
      z: startZ + (endZ - startZ) * t,
    });
  }
  return fish;
}

/**
 * One fish per obstacle, in a lane the obstacle list says is clear at that
 * exact Z - collecting the whole trail means threading every decision
 * correctly, not just surviving them.
 */
function weavePattern(spec: ChunkSpec, rng: Rng): FishPlacement[] {
  return spec.obstacles.map(({ lane, z }) => ({
    x: laneX(otherLane(lane, rng)),
    y: FISH_HEIGHT,
    z,
  }));
}

export function generateFishPattern(
  spec: ChunkSpec,
  section: SectionType,
  tier: DifficultyTier,
  rng: Rng,
  /**
   * True on a `ChunkDirector`-forced recovery chunk (the guaranteed
   * `'straight'` right after a gap or a trampoline landing) - see
   * `ChunkSelection.forcedRecovery`. These chunks carry no hazard of their
   * own, so without this flag they'd fall into the plain `section` switch
   * below and could land on the sparse end of it just as easily as the
   * dense end. Defaults to `false` so every existing call site (direct unit
   * tests included) is unaffected.
   */
  forcedRecovery = false,
): readonly FishPlacement[] {
  // Gaps and obstacles get their own hazard-shaped pattern regardless of
  // section - the "risky route" fish always exist where the risk does.
  if (spec.hasGap) return arcPattern();
  if (spec.ventZ !== null) return ventArcPattern(spec.ventZ);
  if (spec.obstacles.length > 0) return weavePattern(spec, rng);

  // A safe landing deserves a rewarding, guaranteed line - not a coin-flip
  // against whatever `section` happens to be active. Checked ahead of the
  // turn/section branches below since a recovery chunk is never also a turn.
  if (forcedRecovery) return rng() < 0.5 ? zigzagPattern(rng, 5) : straightLinePattern(rng, 5);

  // Turns get their own guaranteed line too, for the same reason - the
  // section switch below is otherwise just as likely to hand a turn zero
  // fish as a straight filler chunk would.
  if (spec.type === 'turnLeft' || spec.type === 'turnRight') return zigzagPattern(rng, 3);

  // "Increasing fish-path complexity" expressed the same way every other
  // difficulty knob in this game already is: a probability that shifts
  // smoothly with distance, not a hard swap at a threshold. Early tier keeps
  // the original 50/50 split unchanged; later tiers favour the pattern that
  // actually exercises lane movement over the simplest one.
  const zigzagChance = tier === 'late' ? 0.75 : tier === 'mid' ? 0.6 : 0.5;

  switch (section) {
    case 'fishCollection':
      return rng() < zigzagChance ? zigzagPattern(rng, 6) : straightLinePattern(rng, 6);
    case 'reward':
      return straightLinePattern(rng, 5);
    case 'easy':
      return rng() < 0.75 ? zigzagPattern(rng, 4) : straightLinePattern(rng, 3);
    default:
      // obstacleChallenge/hardObstacleChallenge straight filler, or a plain
      // 'slide' chunk elsewhere (turns and forced-recovery straights are
      // carved out above) - denser than before, but still sparse enough
      // that fish don't blanket every chunk.
      return rng() < 0.6 ? straightLinePattern(rng, 3) : [];
  }
}
