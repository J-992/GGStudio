import { describe, expect, it } from 'vitest';

import { generatePowerUp } from '../src/levels/procedural/PowerUps';
import {
  generateChunk,
  generateJump,
  generateObstacle,
  generateSlide,
  generateTurn,
  mulberry32,
} from '../src/levels/procedural/ChunkGenerators';
import {
  BEAM_BOTTOM,
  BEAM_HALF_DEPTH,
  BEAM_HEIGHT,
  BEAM_LOCAL_Z,
  BEAM_RADIUS,
  BEAM_TOP,
  CHUNK_TYPES,
  GAP_END_Z,
  GAP_START_Z,
  OBSTACLE_SIZE,
  POWERUP_RADIUS,
  TURN_MARKER_LOCAL_Z,
  type ChunkSpec,
} from '../src/levels/procedural/ChunkTypes';
import type { SectionType } from '../src/levels/procedural/SectionDirector';
import { PHYSICS } from '../src/physics/PhysicsConfig';

/**
 * "Power-up spawns are terrible - sometimes they spawn inside the actual
 * obstacle."
 *
 * `findSafeSpot` only ever knew about `spec.obstacles` and `spec.hasGap`. It
 * had no idea `beamZ` existed, so on a 'slide' chunk - whose beam sits at
 * `BEAM_LOCAL_Z` and spans *every* lane - the whole centre candidate row was
 * judged clear and the pickup was dropped inside the barrier. These pin the
 * placement against the chunk's real geometry rather than against the two
 * hazard kinds someone happened to think of.
 */

const SECTIONS: readonly SectionType[] = [
  'easy',
  'fishCollection',
  'obstacleChallenge',
  'reward',
  'hardObstacleChallenge',
];

/** Every power-up a broad sweep of chunks/sections/seeds produces. */
function* placements(): Generator<{ spec: ChunkSpec; z: number; lane: number }> {
  for (const type of CHUNK_TYPES) {
    for (const section of SECTIONS) {
      for (let seed = 0; seed < 250; seed++) {
        const rng = mulberry32(seed * 31 + 7);
        const spec = generateChunk(type, rng);
        const placed = generatePowerUp(spec, section, rng);
        if (placed) yield { spec, z: placed.z, lane: placed.lane };
      }
    }
  }
}

describe('power-up placement', () => {
  it('produces power-ups at all (the sweep is not vacuously passing)', () => {
    expect([...placements()].length).toBeGreaterThan(100);
  });

  it('never places a pickup inside the slide beam', () => {
    // The beam spans the full deck width, so lane is irrelevant - only Z is.
    // This is the actual reported bug.
    for (const { spec, z } of placements()) {
      if (spec.beamZ === null) continue;
      const overlap = Math.abs(spec.beamZ - z) < BEAM_HALF_DEPTH + POWERUP_RADIUS;
      expect(overlap, `pickup at z=${z} vs beam at z=${spec.beamZ}`).toBe(false);
    }
  });

  it('never places a pickup inside a crate', () => {
    for (const { spec, z, lane } of placements()) {
      for (const obstacle of spec.obstacles) {
        if (obstacle.lane !== lane) continue;
        const overlap = Math.abs(obstacle.z - z) < OBSTACLE_SIZE.depth / 2 + POWERUP_RADIUS;
        expect(overlap, `pickup at lane ${lane} z=${z} vs crate z=${obstacle.z}`).toBe(false);
      }
    }
  });

  it('never places a pickup over a gap', () => {
    for (const { spec, z } of placements()) {
      if (!spec.hasGap) continue;
      expect(z > GAP_START_Z && z < GAP_END_Z, `pickup at z=${z} over the gap`).toBe(false);
    }
  });

  it('never buries a pickup in the turn marker cone', () => {
    for (const { spec, z, lane } of placements()) {
      if (!spec.turn || spec.turn.dir !== lane) continue;
      expect(Math.abs(TURN_MARKER_LOCAL_Z - z)).toBeGreaterThan(POWERUP_RADIUS);
    }
  });

  it('declines to place rather than dropping a pickup on an unchecked fallback spot', () => {
    // The old no-candidates path returned `{ lane: 0, z: CANDIDATE_Z[1] }`
    // without testing it against anything - the one case where placement was
    // hardest was the one case it stopped checking. A chunk with nowhere clear
    // must yield null instead.
    // Contrived rather than generated - no real chunk type can reach this
    // state, which is exactly why the fallback was never noticed. The gap
    // rules out the centre candidate row, and crates in all three lanes cover
    // the head and tail rows, so nothing is left.
    const spec: ChunkSpec = {
      ...generateSlide(),
      obstacles: [
        { lane: -1, z: 2 },
        { lane: 0, z: 2 },
        { lane: 1, z: 2 },
        { lane: -1, z: 13 },
        { lane: 0, z: 13 },
        { lane: 1, z: 13 },
      ],
      hasGap: true,
    };
    const results = new Set<unknown>();
    for (let seed = 0; seed < 50; seed++) {
      results.add(generatePowerUp(spec, 'reward', mulberry32(seed)));
    }
    expect([...results]).toEqual([null]);
  });

  it('still guarantees a power-up on a reward section of an ordinary chunk', () => {
    // The null return above is a safety net, not a behaviour change: a normal
    // chunk must still reliably reward.
    for (let seed = 0; seed < 100; seed++) {
      const rng = mulberry32(seed);
      expect(generatePowerUp(generateObstacle(rng), 'reward', rng)).not.toBeNull();
    }
    for (let seed = 0; seed < 100; seed++) {
      const rng = mulberry32(seed);
      expect(generatePowerUp(generateSlide(), 'reward', rng)).not.toBeNull();
    }
    for (let seed = 0; seed < 100; seed++) {
      const rng = mulberry32(seed);
      expect(generatePowerUp(generateJump(), 'reward', rng)).not.toBeNull();
    }
    for (const dir of [-1, 1] as const) {
      for (let seed = 0; seed < 50; seed++) {
        const rng = mulberry32(seed);
        expect(generatePowerUp(generateTurn(dir), 'reward', rng)).not.toBeNull();
      }
    }
  });
});

describe('slide barrier shape', () => {
  const standingHead = 2 * (PHYSICS.colliderHalfHeight + PHYSICS.colliderRadius);
  const maxJumpApex = PHYSICS.jumpImpulse ** 2 / (2 * -PHYSICS.gravity);

  it('reads unmistakably as "go under", not "jump over"', () => {
    // The report was that the barrier "looks like the player is supposed to
    // jump over it" - which at a 1.8 top was a fair reading, since it stood
    // barely taller than the 1.73 jump apex it was meant to defeat. Being
    // unjumpable by 0.07 units is correct and unreadable at the same time.
    expect(BEAM_TOP).toBeGreaterThan(maxJumpApex * 2);
    expect(BEAM_TOP - BEAM_BOTTOM).toBeGreaterThan(standingHead * 2);
  });

  it('still collides with a standing runner, and still lets a ducking one through', () => {
    // The safety-critical half, unchanged by the height increase: the band's
    // bottom must sit below a standing head so running into it is a hit.
    expect(BEAM_BOTTOM).toBeLessThan(standingHead);
    expect(BEAM_BOTTOM).toBeGreaterThan(0);
  });

  it('derives the band from its own edges', () => {
    expect(BEAM_HEIGHT - BEAM_RADIUS).toBeCloseTo(BEAM_BOTTOM, 6);
    expect(BEAM_HEIGHT + BEAM_RADIUS).toBeCloseTo(BEAM_TOP, 6);
  });

  it('does not deepen the duck window when the barrier gets taller', () => {
    // The overlap test measures distance from the beam's centre *line*, so if
    // it keyed off the band's height the taller barrier would silently demand
    // a duck held over 4.75 units of travel instead of 2.5 units. These are
    // separate axes and must stay separate.
    expect(BEAM_HALF_DEPTH).toBeLessThan(BEAM_RADIUS);

    // Slide is hold-driven now (see `RunInput.slide`), not a fixed timer, so
    // there is no `PHYSICS.slideDuration` to measure "duck window" against
    // any more - the real question is just whether the beam is comfortably
    // narrower than even the shortest deliberate press-and-hold a player
    // would make. 0.3s is a fast but genuine hold, not a reflexive tap.
    const MIN_REASONABLE_SLIDE_SECONDS = 0.3;
    const duckTravel = MIN_REASONABLE_SLIDE_SECONDS * PHYSICS.runSpeed;
    expect(BEAM_HALF_DEPTH * 2).toBeLessThan(duckTravel / 2);
  });

  it('places the beam where the centre candidate row would otherwise sit', () => {
    // Documents *why* the power-up bug existed at all: the beam's default Z
    // and the middle power-up candidate are the same number, so the collision
    // was systematic rather than occasional.
    expect(BEAM_LOCAL_Z).toBe(7.5);
  });
});
