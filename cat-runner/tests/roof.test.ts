import { describe, expect, it } from 'vitest';
import {
  RoofDirector,
  generateRoofProp,
  TRAMPOLINE_LAUNCH_VELOCITY,
} from '../src/levels/procedural/RoofFeatures';
import { mulberry32 } from '../src/levels/procedural/ChunkGenerators';
import { CHUNK_LENGTH, DECK_WIDTH } from '../src/levels/TrackConfig';
import { PHYSICS } from '../src/physics/PhysicsConfig';
import type { ChunkType } from '../src/levels/procedural/ChunkTypes';

/**
 * Rooftop tier progression and prop dressing.
 *
 * The one invariant that actually matters for gameplay - "avoid extreme
 * height differences on the playable path" - is enforced structurally
 * (tier only ever moves one step, and only on a chunk with no other hazard
 * of its own), so it's checked directly across a long, varied sequence
 * rather than sampled once.
 */

const CHUNK_TYPES: readonly ChunkType[] = [
  'straight',
  'obstacle',
  'slide',
  'jump',
  'vent',
  'turnLeft',
  'turnRight',
];

describe('RoofDirector', () => {
  it('never steps by more than one tier, and never leaves [0, 2]', () => {
    const rng = mulberry32(1);
    const director = new RoofDirector();
    let previous = 0;

    for (let i = 0; i < 500; i++) {
      const type = CHUNK_TYPES[Math.floor(rng() * CHUNK_TYPES.length)];
      const { tier } = director.next(type, rng);

      expect(tier).toBeGreaterThanOrEqual(0);
      expect(tier).toBeLessThanOrEqual(2);
      expect(Math.abs(tier - previous)).toBeLessThanOrEqual(1);
      previous = tier;
    }
  });

  it('only ever changes tier on a jump chunk - a gap - never elsewhere', () => {
    const rng = mulberry32(2);
    const director = new RoofDirector();
    let previous = 0;

    for (let i = 0; i < 500; i++) {
      const type = CHUNK_TYPES[Math.floor(rng() * CHUNK_TYPES.length)];
      const { tier, previousTier } = director.next(type, rng);

      expect(previousTier).toBe(previous);
      if (type !== 'jump') expect(tier).toBe(previous);
      previous = tier;
    }
  });

  it('actually does change tier on at least some jump chunks - the roll is not stuck at 0', () => {
    const rng = mulberry32(6);
    const director = new RoofDirector();
    let sawChange = false;

    for (let i = 0; i < 500; i++) {
      const { tier, previousTier } = director.next('jump', rng);
      if (tier !== previousTier) sawChange = true;
    }
    expect(sawChange).toBe(true);
  });

  it('places a trampoline on every tier increase, and only on an increase', () => {
    const rng = mulberry32(3);
    const director = new RoofDirector();

    for (let i = 0; i < 500; i++) {
      const type = CHUNK_TYPES[Math.floor(rng() * CHUNK_TYPES.length)];
      const { tier, previousTier, trampoline } = director.next(type, rng);

      expect(trampoline).toBe(tier > previousTier);
    }
  });

  it('is deterministic for the same rng sequence', () => {
    // 'jump', not 'straight': 'straight' never rolls at all any more, so it
    // would trivially "pass" this without actually exercising the RNG-driven
    // branch this test exists to check.
    const seq = () => {
      const rng = mulberry32(42);
      const director = new RoofDirector();
      const out: unknown[] = [];
      for (let i = 0; i < 50; i++) out.push(director.next('jump', rng));
      return out;
    };
    expect(seq()).toEqual(seq());
  });
});

describe('TRAMPOLINE_LAUNCH_VELOCITY', () => {
  // Regression for "trampolines barely out-jump a normal jump": the
  // previous tuning's apex (~1.6) was actually *below* the standing jump's
  // own (~1.73), which is what these bounds exist to catch. A trampoline
  // now has to read as dramatically higher, while still not launching the
  // player clean over the next chunk's own hazards.
  const standingJumpApex = PHYSICS.jumpImpulse ** 2 / (2 * Math.abs(PHYSICS.gravity));
  const apex = (TRAMPOLINE_LAUNCH_VELOCITY * TRAMPOLINE_LAUNCH_VELOCITY) / (2 * Math.abs(PHYSICS.gravity));

  it('clears a one-unit rise with a lot of margin', () => {
    expect(apex).toBeGreaterThan(1);
  });

  it('launches noticeably higher than a standing jump, not just barely above it', () => {
    expect(apex).toBeGreaterThan(standingJumpApex * 2);
  });

  it('does not fling the player over the chunk beyond the one it launches from', () => {
    const hangTime = (2 * TRAMPOLINE_LAUNCH_VELOCITY) / Math.abs(PHYSICS.gravity);
    const horizontalDistance = PHYSICS.runSpeed * hangTime;
    expect(horizontalDistance).toBeLessThan(CHUNK_LENGTH);
  });
});

describe('generateRoofProp', () => {
  it('keeps every placed prop off the lanes and inside the deck edge', () => {
    const rng = mulberry32(7);
    let sawOne = false;
    for (let i = 0; i < 300; i++) {
      const prop = generateRoofProp(false, rng);
      if (!prop) continue;
      sawOne = true;
      expect(Math.abs(prop.x)).toBeGreaterThan(PHYSICS.laneSpacing);
      expect(Math.abs(prop.x)).toBeLessThan(DECK_WIDTH / 2);
    }
    expect(sawOne).toBe(true);
  });

  it('sometimes places no prop at all', () => {
    const rng = mulberry32(8);
    let sawNone = false;
    for (let i = 0; i < 300; i++) {
      if (generateRoofProp(false, rng) === null) sawNone = true;
    }
    expect(sawNone).toBe(true);
  });

  it('avoids the middle third of a gap chunk, so nothing floats over the hole', () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 300; i++) {
      const prop = generateRoofProp(true, rng);
      if (!prop) continue;
      const third = CHUNK_LENGTH / 3; // matches generateRoofProp's own split
      expect(prop.z < third || prop.z > CHUNK_LENGTH - third).toBe(true);
    }
  });
});
