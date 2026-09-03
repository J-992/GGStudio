import { describe, expect, it } from 'vitest';
import {
  RoofDirector,
  generateRoofProp,
  TRAMPOLINE_LAUNCH_VELOCITY,
} from '../src/levels/procedural/RoofFeatures';
import { mulberry32 } from '../src/levels/procedural/ChunkGenerators';
import { CHUNK_LENGTH, DECK_WIDTH } from '../src/levels/TrackConfig';
import { PHYSICS } from '../src/physics/PhysicsConfig';
import { SPEED_RAMP_START_MULTIPLIER } from '../src/levels/procedural/DifficultyCurve';
import {
  DECK_A_LENGTH,
  GAP_END_Z,
  ROOF_LOW,
  ROOF_MEDIUM,
  ROOF_TIER_HEIGHT,
  type ChunkType,
} from '../src/levels/procedural/ChunkTypes';

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

  /**
   * The pad sits 1.2 units short of deck A's far edge (`TRAMPOLINE_LOCAL_Z`
   * in `ChunkBuilder.ts`), so it's already offset into its own chunk before
   * the launch even starts - a raw "return-to-*launch*-height" hang distance
   * (the old version of this test) is a looser, less accurate proxy than
   * checking where the player actually lands: back down at the *landing*
   * deck's height (3 units higher, so partway down the arc, not the bottom
   * of it). `2 * CHUNK_LENGTH` bounds that to landing within the chunk right
   * after the one that launched it - the chunk `ChunkDirector`'s trampoline
   * recovery mechanism (see `ChunkDirector.noteTrampoline`) now guarantees
   * is always a plain, hazard-free `'straight'`.
   */
  it('lands within the guaranteed-safe chunk right after the one it launches from', () => {
    const g = Math.abs(PHYSICS.gravity);
    const rise = ROOF_TIER_HEIGHT[ROOF_MEDIUM] - ROOF_TIER_HEIGHT[ROOF_LOW];
    const v = TRAMPOLINE_LAUNCH_VELOCITY;
    // Second (descending) root of `rise = v*t - 0.5*g*t^2`.
    const landingTime = (v + Math.sqrt(v * v - 2 * g * rise)) / g;
    const horizontalDistance = PHYSICS.runSpeed * landingTime;
    expect(horizontalDistance).toBeLessThan(2 * CHUNK_LENGTH);
  });

  /**
   * The actual bug this tuning fixes, pinned directly: at the game's
   * slowest possible speed (the ramp's own opening floor - every run and
   * every tutorial attempt starts here), the player must cover the full
   * pad-to-landing-edge distance before descending back to landing height,
   * with real margin to spare - not exactly meet it, which is what the old
   * tuning did (zero margin, a coin-flip miss on any noise). See
   * `RoofFeatures.ts`'s own derivation comment for the full working; this
   * pins the conclusion.
   */
  it('clears the gap with real margin at the slowest speed the game ever runs', () => {
    const g = Math.abs(PHYSICS.gravity);
    const rise = ROOF_TIER_HEIGHT[ROOF_MEDIUM] - ROOF_TIER_HEIGHT[ROOF_LOW];
    const v = TRAMPOLINE_LAUNCH_VELOCITY;
    const landingTime = (v + Math.sqrt(v * v - 2 * g * rise)) / g;

    const worstCaseSpeed = PHYSICS.baseRunSpeed * SPEED_RAMP_START_MULTIPLIER;
    // Pad to landing-deck edge - see `RoofFeatures.ts`'s derivation comment;
    // 1.2 is `ChunkBuilder.ts`'s `TRAMPOLINE_LOCAL_Z` offset from deck A's
    // far edge, not itself exported (a placement-only implementation detail).
    const clearanceNeeded = GAP_END_Z - (DECK_A_LENGTH - 1.2);

    const margin = worstCaseSpeed * landingTime - clearanceNeeded;
    expect(margin).toBeGreaterThan(2); // comfortable, not exact
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
