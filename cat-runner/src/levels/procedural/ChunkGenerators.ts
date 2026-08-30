import type { Lane } from '../chunkTemplate';
import {
  OBSTACLE_Z_LOOSE,
  OBSTACLE_Z_TIGHT,
  OBSTACLE_Z_TRIPLE,
  BEAM_LOCAL_Z,
  VENT_PIPE_LOCAL_Z,
  type ChunkSpec,
  type ChunkType,
  type ObstaclePlacement,
} from './ChunkTypes';

/**
 * Turns a chunk type into a `ChunkSpec` - the hazard geometry a chunk of
 * that type is made of this time. Pure functions of `(rng)`, so invariants
 * ("never blocks all three lanes at one Z", "always exactly 90°", "hazard
 * elements stay MIN_HAZARD_SPACING apart") are enforced by construction and
 * property-tested directly, the same way `DEFAULT_CHUNK`'s solvability was
 * hand-verified before any of this existed.
 *
 * Fish and power-ups are deliberately NOT set here (`fish: []`,
 * `powerUp: null`) - they depend on which *section* of the rhythm cycle a
 * chunk falls in, which this module has no notion of. `ChunkBuilder` layers
 * `FishPatterns.generateFishPattern()` / `PowerUps.generatePowerUp()` on top
 * of whatever this returns.
 */

export type Rng = () => number;

/** Deterministic PRNG for tests (and, if ever wanted, replayable seeds). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_LANES: readonly Lane[] = [-1, 0, 1];

function shuffledLanes(rng: Rng): Lane[] {
  const lanes = [...ALL_LANES];
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  return lanes;
}

/** Picks `count` distinct lanes. `count: 3` is the one case that *does* block
 *  every lane - legal here because, unlike the two-blocker case, each of the
 *  three sits at its own Z (see `OBSTACLE_Z_TRIPLE`), so there is always a
 *  clear lane at any given instant; only a single shared Z may never block
 *  all three. */
function someLanes(rng: Rng, count: 1 | 2 | 3): Lane[] {
  return shuffledLanes(rng).slice(0, count);
}

const EMPTY: ChunkSpec = {
  type: 'straight',
  obstacles: [],
  beamZ: null,
  ventZ: null,
  hasGap: false,
  turn: null,
  fish: [],
  powerUp: null,
  // Overwritten by ChunkBuilder from RoofFeatures.RoofDirector - see
  // ChunkSpec's own doc comment for why this module can't decide them.
  roofTier: 0,
  previousRoofTier: 0,
  trampoline: false,
};

export function generateStraight(): ChunkSpec {
  return { ...EMPTY, type: 'straight' };
}

/**
 * Blocks one, two, or all three lanes. Three is now the *common* case (was
 * capped at two): `ObstaclePool` always allocated headroom for a third
 * (`MAX_OBSTACLES_PER_CHUNK` in `ObstaclePool.ts`), only the generator
 * capped it, and "every gameplay chunk contains meaningful interaction"
 * calls for more than a coin flip's worth of dodging. Two-blocker chunks
 * still pick between the loose/tight Z pair (`OBSTACLE_Z_LOOSE`/`_TIGHT`)
 * exactly as before, always leaving one lane clear at their shared Z; three
 * blockers instead use `OBSTACLE_Z_TRIPLE`'s three distinct Z's, one lane
 * each, so there is always a clear lane at any given instant even though
 * every lane sees an obstacle somewhere in the chunk.
 *
 * `simple` skips the roll entirely and forces the gentlest shape this
 * generator can make: exactly one blocked lane, at `OBSTACLE_Z_LOOSE[1]` -
 * the *far* Z of the loose pair, so the runner sees it for the maximum
 * possible distance before having to act. Only the guaranteed opening
 * sequence asks for it (see `ChunkDirector`'s `forceStartSequence`); the
 * lane itself is still random, so the opening is a real decision rather
 * than a scripted one.
 */
export function generateObstacle(rng: Rng, simple = false): ChunkSpec {
  const roll = rng();
  const count: 1 | 2 | 3 = simple ? 1 : roll < 0.5 ? 3 : roll < 0.85 ? 2 : 1;
  const lanes = someLanes(rng, count);

  if (simple) {
    return { ...EMPTY, type: 'obstacle', obstacles: [{ lane: lanes[0], z: OBSTACLE_Z_LOOSE[1] }] };
  }

  let obstacles: ObstaclePlacement[];
  if (count === 3) {
    obstacles = lanes.map((lane, i) => ({ lane, z: OBSTACLE_Z_TRIPLE[i] }));
  } else {
    const zPair = rng() < 0.5 ? OBSTACLE_Z_LOOSE : OBSTACLE_Z_TIGHT;
    obstacles = lanes.map((lane, i) => ({ lane, z: zPair[i] }));
  }
  return { ...EMPTY, type: 'obstacle', obstacles };
}

export function generateSlide(): ChunkSpec {
  return { ...EMPTY, type: 'slide', beamZ: BEAM_LOCAL_Z };
}

export function generateJump(): ChunkSpec {
  return { ...EMPTY, type: 'jump', hasGap: true };
}

/** The full-width, jump-only pipe - see `ChunkTypes.VENT_PIPE_HEIGHT`'s own
 *  comment for why this can't be ducked or lane-dodged. */
export function generateVent(): ChunkSpec {
  return { ...EMPTY, type: 'vent', ventZ: VENT_PIPE_LOCAL_Z };
}

export function generateTurn(dir: -1 | 1): ChunkSpec {
  return {
    ...EMPTY,
    type: dir === -1 ? 'turnLeft' : 'turnRight',
    // RunPath: increasing yaw swings the heading from +Z toward +X, and +X is
    // the runner's LEFT, so turnDir -1 (left) needs deltaYaw >= 0. See
    // RunPath.ts's own note on this - same handedness convention, reused
    // rather than re-derived.
    turn: { dir, deltaYaw: dir === -1 ? Math.PI / 2 : -Math.PI / 2 },
  };
}

/** `simple` is only meaningful for `'obstacle'` (see {@link generateObstacle});
 *  every other type already has exactly one shape, so it is ignored there. */
export function generateChunk(type: ChunkType, rng: Rng, simple = false): ChunkSpec {
  switch (type) {
    case 'straight':
      return generateStraight();
    case 'obstacle':
      return generateObstacle(rng, simple);
    case 'slide':
      return generateSlide();
    case 'jump':
      return generateJump();
    case 'vent':
      return generateVent();
    case 'turnLeft':
      return generateTurn(-1);
    case 'turnRight':
      return generateTurn(1);
  }
}

