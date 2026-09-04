import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { PhysicsWorld, initRapier } from '../src/physics/PhysicsWorld';
import { PlayerController, consumeEdges, type RunInput } from '../src/physics/PlayerController';
import { resetPhysicsConfig, capsuleFeetOffset, PHYSICS } from '../src/physics/PhysicsConfig';
import { CHUNK_LENGTH, TRACK_Y } from '../src/levels/TrackConfig';
import { ChunkBuilder } from '../src/levels/procedural/ChunkBuilder';
import { generateJump, generateStraight } from '../src/levels/procedural/ChunkGenerators';
import { ROOF_LOW, ROOF_MEDIUM, ROOF_HIGH, ROOF_TIER_HEIGHT, type ChunkSpec, type RoofTier } from '../src/levels/procedural/ChunkTypes';
import { SPEED_RAMP_START_MULTIPLIER } from '../src/levels/procedural/DifficultyCurve';

/**
 * Real, physics-backed trampoline activation. Every other test that drives a
 * `ChunkBuilder` (`tests/procedural.test.ts`, `tests/tutoriallevel.test.ts`)
 * walks a fake, non-physics point rather than a genuinely simulated
 * `PlayerController` - none of them ever exercise `player.grounded` through
 * a real jump/land cycle, which is exactly the state the trampoline trigger
 * used to depend on. These do.
 */

const NO_INPUT: RunInput = { laneStep: 0, turn: 0, jump: false, slide: false };

/**
 * A short, hand-authored sequence: two buffer chunks, a trampoline (a gap
 * that rises from `previousRoofTier` to `roofTier`), then two more buffers -
 * enough room to approach, launch, and land. Leading/trailing buffers sit at
 * the tier they need to for a continuous deck either side of the rise, the
 * same way `TutorialLevel.ts`'s own `onUpperRoof()` helper does it.
 */
function trampolineChunks(
  previousRoofTier: RoofTier = ROOF_LOW,
  roofTier: RoofTier = ROOF_MEDIUM,
): ChunkSpec[] {
  const atStart = (spec: ChunkSpec): ChunkSpec => ({
    ...spec,
    previousRoofTier,
    roofTier: previousRoofTier,
  });
  const atEnd = (spec: ChunkSpec): ChunkSpec => ({ ...spec, previousRoofTier: roofTier, roofTier });
  return [
    atStart(generateStraight()),
    atStart(generateStraight()),
    { ...generateJump(), previousRoofTier, roofTier, trampoline: true },
    atEnd(generateStraight()),
    atEnd(generateStraight()),
  ];
}

describe('trampoline reliability', () => {
  let world: PhysicsWorld;
  let player: PlayerController;
  let scene: THREE.Scene;
  let builder: ChunkBuilder;
  const pos = new THREE.Vector3();

  beforeAll(async () => {
    await initRapier();
  });

  beforeEach(() => {
    resetPhysicsConfig();
  });

  afterEach(() => {
    builder.dispose();
    player.dispose();
    world.dispose();
  });

  function setup(chunks: ChunkSpec[], startTier: RoofTier = ROOF_LOW): void {
    world = new PhysicsWorld();
    scene = new THREE.Scene();
    player = new PlayerController(world);
    builder = new ChunkBuilder(scene, world, player, { fixedChunks: chunks });
    builder.start();
    player.spawn(new THREE.Vector3(0, TRACK_Y + ROOF_TIER_HEIGHT[startTier] + capsuleFeetOffset(), 0), 0);
  }

  /** One fixed step: player, then the chunk builder's own trigger checks
   *  (beam/trampoline), then world integration - mirrors `Game.ts`'s real
   *  ordering (`fixedStep()`'s `player.step()` -> `endless.step()`, with
   *  Rapier's `world.step()` integrating only after that callback returns). */
  function fixedStep(input: RunInput): void {
    player.step(1 / 60, input);
    consumeEdges(input);
    builder.step(1 / 60);
    world.world.step();
  }

  /** Steps until the player's arc reaches `untilArc`, or `maxSteps` is hit -
   *  `input()` is asked fresh each step, so a caller can react to the
   *  player's live position (e.g. "press jump once we're nearly at the pad"). */
  function runUntilArc(untilArc: number, maxSteps: number, input: () => RunInput): void {
    for (let i = 0; i < maxSteps; i++) {
      player.getPosition(pos);
      if (builder.path && builder.path.projectDistance(pos) >= untilArc) return;
      fixedStep(input());
    }
  }

  /** True once the player is standing (grounded, settled) at roughly the
   *  expected height for `tier` - not merely that a launch fired, but that
   *  it actually delivered them onto the target deck rather than falling
   *  short into the gap or landing wedged against the lip below it. */
  function landedOnTier(tier: RoofTier): boolean {
    player.getPosition(pos);
    const expectedY = TRACK_Y + ROOF_TIER_HEIGHT[tier] + capsuleFeetOffset();
    return player.grounded && Math.abs(pos.y - expectedY) < 0.2;
  }

  it('launches on a plain, grounded approach - no jump pressed', () => {
    setup(trampolineChunks());
    runUntilArc(4 * CHUNK_LENGTH, 3000, () => NO_INPUT);
    expect(builder.trampolinesFiredCount).toBe(1);
    expect(landedOnTier(ROOF_MEDIUM)).toBe(true);
  });

  /**
   * The diagnosed bug. A standing jump's hang time (~9.66 horizontal units
   * at base run speed) is far wider than the pad's own trigger window
   * (~2.6 units), so a jump pressed a beat before reaching the pad used to
   * leave `player.grounded` false for the whole pass and silently skip the
   * trigger every fixed step - "passes through instead of bouncing." Must
   * now still launch.
   */
  it('still launches when the player jumps shortly before reaching the pad', () => {
    setup(trampolineChunks());
    const padArc = 2 * CHUNK_LENGTH + 3; // inside the trampoline chunk, well before its far edge
    let jumped = false;

    runUntilArc(4 * CHUNK_LENGTH, 3000, () => {
      player.getPosition(pos);
      const arc = builder.path ? builder.path.projectDistance(pos) : 0;
      if (!jumped && arc >= padArc - 3) {
        jumped = true;
        return { ...NO_INPUT, jump: true };
      }
      return NO_INPUT;
    });

    expect(builder.trampolinesFiredCount).toBe(1);
    expect(landedOnTier(ROOF_MEDIUM)).toBe(true);
  });

  /**
   * The actual regression test for the diagnosed reachability bug - not
   * just "did the trigger fire" (that alone was never in question for a
   * plain grounded approach, even at the old tuning) but "did the launch
   * *deliver* the player onto the target deck," at the exact speed - the
   * ramp's own opening floor, which every run and every tutorial attempt
   * starts at - where the old `TRAMPOLINE_LAUNCH_VELOCITY` (12.0) left
   * exactly zero horizontal margin. This would fail at that old value.
   */
  it('reliably reaches the target rooftop at the slowest speed the game ever runs', () => {
    setup(trampolineChunks());
    PHYSICS.runSpeed = PHYSICS.baseRunSpeed * SPEED_RAMP_START_MULTIPLIER;

    runUntilArc(4 * CHUNK_LENGTH, 3000, () => NO_INPUT);

    expect(builder.trampolinesFiredCount).toBe(1);
    expect(landedOnTier(ROOF_MEDIUM)).toBe(true);
  });

  it('still launches approaching at a high, ramped/Catnip-like speed', () => {
    setup(trampolineChunks());
    // Matches the stacked speed-ramp + Catnip Rush ceiling used to rule out
    // tunneling in the investigation behind this fix.
    PHYSICS.runSpeed = PHYSICS.baseRunSpeed * 1.25 * 1.5;

    runUntilArc(4 * CHUNK_LENGTH, 2000, () => NO_INPUT);
    expect(builder.trampolinesFiredCount).toBe(1);
    expect(landedOnTier(ROOF_MEDIUM)).toBe(true);
  });

  it('launches correctly at a MEDIUM-to-HIGH tier trampoline, not just LOW-to-MEDIUM', () => {
    setup(trampolineChunks(ROOF_MEDIUM, ROOF_HIGH), ROOF_MEDIUM);
    runUntilArc(4 * CHUNK_LENGTH, 3000, () => NO_INPUT);
    expect(builder.trampolinesFiredCount).toBe(1);
    expect(landedOnTier(ROOF_HIGH)).toBe(true);
  });

  it('reaches a MEDIUM-to-HIGH trampoline at the slowest speed too', () => {
    setup(trampolineChunks(ROOF_MEDIUM, ROOF_HIGH), ROOF_MEDIUM);
    PHYSICS.runSpeed = PHYSICS.baseRunSpeed * SPEED_RAMP_START_MULTIPLIER;

    runUntilArc(4 * CHUNK_LENGTH, 3000, () => NO_INPUT);

    expect(builder.trampolinesFiredCount).toBe(1);
    expect(landedOnTier(ROOF_HIGH)).toBe(true);
  });

  it('only ever fires once per pad, even lingering in the zone for many steps', () => {
    setup(trampolineChunks());
    // Spawn already inside the trigger window instead of walking there, so
    // many consecutive fixed steps land inside it - the scenario the
    // `trampolineUsed` latch exists for.
    player.spawn(new THREE.Vector3(0, TRACK_Y + capsuleFeetOffset(), 2 * CHUNK_LENGTH + 2.5), 0);

    for (let i = 0; i < 60; i++) fixedStep(NO_INPUT);

    expect(builder.trampolinesFiredCount).toBe(1);
  });

  it('does not fire for an off-centre lane at the pad\'s own Z', () => {
    setup(trampolineChunks());
    player.lane = 1; // commits to an outer lane for the whole approach

    runUntilArc(4 * CHUNK_LENGTH, 3000, () => NO_INPUT);

    expect(builder.trampolinesFiredCount).toBe(0);
  });
});
