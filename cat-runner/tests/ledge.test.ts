import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { PhysicsWorld, initRapier, GROUP, collisionGroups } from '../src/physics/PhysicsWorld';
import { PlayerController, consumeEdges, type RunInput } from '../src/physics/PlayerController';
import { PHYSICS, resetPhysicsConfig, capsuleFeetOffset } from '../src/physics/PhysicsConfig';
import { RunPath } from '../src/levels/RunPath';
import { GAP_LENGTH } from '../src/levels/procedural/ChunkTypes';
import { CATNIP_SPEED_MULTIPLIER } from '../src/levels/procedural/PowerUpConfig';
import { SPEED_RAMP_MAX_MULTIPLIER } from '../src/levels/procedural/DifficultyCurve';

/**
 * What happens when a jump lands short of the next roof.
 *
 * The reported bug was that it did not land short at all. The capsule buried
 * itself in the side of the far deck slab, and because the runner writes a full
 * `runSpeed` into whatever is in front of it every step, the solver ground the
 * cat up the slab's one-unit face and popped it out on top still at speed - a
 * missed jump silently converted into a launch onto the roof, and from there
 * into whatever hazard happened to be standing on it. Catnip Rush made it worse
 * from both ends: half again the speed pushing into the face, and a deeper band
 * of approach heights that ended in a "save" rather than a fall.
 *
 * The two halves of the fix meet on the same line, half a capsule below the lip
 * (`capsuleFeetOffset()` and `PHYSICS.maxStepUp` are both 0.5):
 *
 *   - below it, `probeWall` cuts the forward drive and a miss is a fall;
 *   - above it, `tryStepUp` writes the capsule onto the deck a step before
 *     contact, so a graze is a scramble rather than a punt.
 *
 * Measured against the deck geometry the endless track actually builds - a
 * `DECK_THICKNESS`-thick slab either side of a `GAP_LENGTH` gap, tops flush,
 * exactly as `ObstaclePool.buildGround` makes them - rather than a shape
 * invented for the test.
 */

const NO_INPUT: RunInput = { laneStep: 0, turn: 0, jump: false, slide: false };

/** The fastest the game can ever run: the difficulty ramp's ceiling times
 *  Catnip Rush. The worst case for step size against capsule radius, which is
 *  what governs how deeply the capsule buries itself in one step. */
const TOP_SPEED = 11 * SPEED_RAMP_MAX_MULTIPLIER * CATNIP_SPEED_MULTIPLIER;

function addDeck(
  world: PhysicsWorld,
  centre: [number, number, number],
  half: [number, number, number],
): void {
  const body = world.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(...centre),
  );
  world.world.createCollider(
    RAPIER.ColliderDesc.cuboid(...half)
      .setFriction(0.9)
      .setCollisionGroups(collisionGroups(GROUP.GROUND, GROUP.PLAYER | GROUP.OBSTACLE)),
    body,
  );
}

interface Approach {
  /** Feet height relative to the far deck's top at the moment the capsule
   *  first reaches contact range of its face. Negative is below the lip. */
  feetAtLip: number;
  /** Whether the runner finished the run on the far deck rather than in the
   *  gap. */
  landed: boolean;
  /** Largest upward velocity seen while airborne. The run contains no jump, so
   *  anything here at all came from the solver. */
  peakLift: number;
  /** Most height gained while airborne and still short of the far deck's face.
   *  A single step-up assist shows up as one `maxStepUp`; the grind this test
   *  exists for showed up as the whole height of the slab. */
  climbedFace: number;
}

/**
 * Flies the capsule at the far deck's front face and reports what became of it.
 *
 * `startFeet` is where it starts, a short way back from the face; `feetAtLip`
 * is what it had fallen to by the time it got there, which is the number the
 * outcome actually depends on - so the assertions read off that rather than
 * off the input.
 */
function approachLip(startFeet: number, speed: number, vy: number, phasing: boolean): Approach {
  resetPhysicsConfig();
  PHYSICS.runSpeed = speed;

  const world = new PhysicsWorld();
  addDeck(world, [0, -0.5, -40], [7, 0.5, 40]);
  addDeck(world, [0, -0.5, GAP_LENGTH + 200], [7, 0.5, 200]);

  const player = new PlayerController(world);
  player.setPath(new RunPath([[0, 0, -60], [0, 0, 400]]));
  player.spawn(new THREE.Vector3(0, capsuleFeetOffset() + 0.05, -30), 0);
  player.setPhasing(phasing);

  // Placed mid-gap on the chosen arc. `recoverTo` zeroes the velocity, so the
  // arc is written straight afterwards; the first `probeGround` of the first
  // step finds nothing underneath and clears `grounded` on its own.
  player.recoverTo(new THREE.Vector3(0, startFeet + capsuleFeetOffset(), GAP_LENGTH - 1.5));
  player.body.setLinvel({ x: 0, y: vy, z: speed }, true);

  // Contact with the face begins when the capsule centre is one radius short.
  const contactZ = GAP_LENGTH - PHYSICS.colliderRadius;
  const pos = new THREE.Vector3();
  const vel = new THREE.Vector3();

  let feetAtLip = Number.NaN;
  let peakLift = 0;
  let climbedFace = 0;
  let lowestBeforeLip = Infinity;

  for (let i = 0; i < 400; i++) {
    const drive: RunInput = { ...NO_INPUT };
    player.step(PHYSICS.fixedTimeStep, drive);
    world.world.step();
    consumeEdges(drive);

    player.getPosition(pos);
    player.getVelocity(vel);
    const feet = pos.y - capsuleFeetOffset();

    if (Number.isNaN(feetAtLip) && pos.z >= contactZ) feetAtLip = feet;

    if (!player.grounded) {
      peakLift = Math.max(peakLift, vel.y);
      // Only while short of the face. Past it the runner is over the deck and
      // any rise is an ordinary landing.
      if (pos.z < GAP_LENGTH) {
        lowestBeforeLip = Math.min(lowestBeforeLip, feet);
        climbedFace = Math.max(climbedFace, feet - lowestBeforeLip);
      }
    }

    if (pos.y < -12) break;
  }

  player.getPosition(pos);
  const landed = pos.y > -12;
  world.dispose();

  return { feetAtLip, landed, peakLift, climbedFace };
}

describe('landing short of the next roof', () => {
  beforeAll(async () => {
    await initRapier();
  });
  afterEach(() => {
    resetPhysicsConfig();
  });

  const CASES: ReadonlyArray<{ label: string; speed: number; phasing: boolean }> = [
    { label: 'cruising', speed: 11, phasing: false },
    { label: 'Catnip Rush', speed: 11 * CATNIP_SPEED_MULTIPLIER, phasing: true },
    { label: 'Catnip Rush at the speed ramp ceiling', speed: TOP_SPEED, phasing: true },
  ];

  for (const { label, speed, phasing } of CASES) {
    describe(label, () => {
      it('is never carried up the face, and never thrown off it', () => {
        for (let startFeet = -1.6; startFeet <= 0.31; startFeet += 0.1) {
          for (const vy of [-1, -2, -5, -8]) {
            const at = `startFeet=${startFeet.toFixed(2)} vy=${vy}`;
            const r = approachLip(startFeet, speed, vy, phasing);

            // The grind: the capsule climbing the slab's whole one-unit face at
            // roughly a unit a second until its feet cleared the top. Measured
            // at up to 1.29 before the fix. One step-up assist is a single
            // `maxStepUp` write, and is the most any approach can legitimately
            // gain here.
            expect(r.climbedFace, at).toBeLessThanOrEqual(PHYSICS.maxStepUp + 0.06);

            // The punt: the solver throwing the capsule out of a deep overlap,
            // measured up to +13.0 before the fix. A run that contains no jump
            // must never gain more upward speed than a jump would.
            //
            // Deliberately not tighter. A landing that clips the very corner of
            // the deck still leaves a bounce - up to +5.7 at the top of the
            // speed ramp - which is contact resolution doing its ordinary job
            // on a landing the player made. What must not come back is the
            // launch off the *face*.
            expect(r.peakLift, at).toBeLessThan(PHYSICS.jumpImpulse);
          }
        }
      });

      it('falls when it arrives clearly below the lip', () => {
        for (const startFeet of [-0.5, -0.7, -1.0, -1.4]) {
          for (const vy of [-1, -2, -5]) {
            const r = approachLip(startFeet, speed, vy, phasing);
            const at = `startFeet=${startFeet} vy=${vy} feetAtLip=${r.feetAtLip.toFixed(3)}`;
            expect(r.landed, at).toBe(false);
          }
        }
      });

      it('lands, and keeps running, when it arrives over the lip', () => {
        for (const startFeet of [0.2, 0.3]) {
          for (const vy of [-1, -2]) {
            const r = approachLip(startFeet, speed, vy, phasing);
            const at = `startFeet=${startFeet} vy=${vy} feetAtLip=${r.feetAtLip.toFixed(3)}`;
            expect(r.landed, at).toBe(true);
            expect(r.climbedFace, at).toBeLessThanOrEqual(PHYSICS.maxStepUp + 0.06);
          }
        }
      });
    });
  }
});
