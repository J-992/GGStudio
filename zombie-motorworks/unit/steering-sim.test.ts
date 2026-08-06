/**
 * Headless check that the steering law actually delivers the arc it promises:
 * the same rig, full throttle, full lock, measured as a real turn radius on
 * flat asphalt. Unit-testing the law in isolation cannot catch a rig that
 * understeers its way out of the commanded rate once tyres and mass are in the
 * loop, which is exactly the failure this replaced.
 */

import { readFileSync } from 'node:fs';

import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPartDef } from '../src/core/parts.ts';
import { deserializeBlueprint } from '../src/core/serialize.ts';
import { deriveConnections } from '../src/core/structural.ts';
import { GROUP_TERRAIN, lowestPointM } from '../src/runtime/assembler.ts';
import type { VehicleControls } from '../src/runtime/vehicle.ts';
import { RuntimeVehicle } from '../src/runtime/vehicle.ts';
import { rotateByQuat } from '../src/runtime/vec.ts';

const DT = 1 / 60;
const TERRAIN_GROUPS = (GROUP_TERRAIN << 16) | 0xffff;

const idleControls: VehicleControls = {
  throttle: 0,
  brake: 0,
  steer: 0,
  fire: false,
  aimYawWorld: 0,
};

beforeAll(async () => {
  await RAPIER.init();
});

function makeWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(400, 1, 400)
      .setTranslation(0, -1, 0)
      .setFriction(0.9)
      .setCollisionGroups(TERRAIN_GROUPS),
  );
  return world;
}

function spawnVehicle(world: RAPIER.World, fixture: string): RuntimeVehicle {
  const bp = deserializeBlueprint(
    readFileSync(new URL(`../tests/fixtures/${fixture}`, import.meta.url), 'utf8'),
  );
  const connections = deriveConnections(bp, getPartDef);
  return new RuntimeVehicle(world, bp, getPartDef, connections, {
    translation: { x: 0, y: -lowestPointM(bp, getPartDef) + 0.32, z: 0 },
  });
}

function drive(
  world: RAPIER.World,
  vehicle: RuntimeVehicle,
  controls: Partial<VehicleControls>,
  seconds: number,
): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    vehicle.preStep(DT, { ...idleControls, ...controls }, () => 'asphalt');
    world.step();
    vehicle.postStepStability(DT);
    vehicle.finishStep();
  }
}

interface Corner {
  /** Steady-state radius of the path actually traced, in metres. */
  radiusM: number;
  /** Speed held through the corner, in m/s. */
  speedMps: number;
  /** Seconds of held lock before the rig comes back round to its own tail. */
  lapSeconds: number;
  /** Flattest the chassis got mid-corner; 1 is level, 0 is on its side. */
  minUprightness: number;
}

/**
 * Hold throttle and lock, then measure the arc actually traced. Curvature is
 * taken from how fast the *velocity* vector rotates, not the chassis yaw: a rig
 * that points into the corner while sliding straight on has turned its nose and
 * nothing else, and that difference is the whole question here.
 */
function corner(fixture: string, steer: number, warmupSeconds: number): Corner {
  const world = makeWorld();
  const vehicle = spawnVehicle(world, fixture);
  drive(world, vehicle, {}, 1); // settle on the suspension
  drive(world, vehicle, { throttle: 1 }, warmupSeconds); // reach the entry speed
  drive(world, vehicle, { throttle: 1, steer }, 1.5); // let the turn stabilise

  let sweptRad = 0;
  let speedSum = 0;
  let minUprightness = 1;
  let previousHeading: number | null = null;
  const steps = Math.round(2 / DT);
  for (let i = 0; i < steps; i++) {
    vehicle.preStep(DT, { ...idleControls, throttle: 1, steer }, () => 'asphalt');
    world.step();
    vehicle.postStepStability(DT);
    vehicle.finishStep();
    const velocity = vehicle.body.linvel();
    speedSum += Math.hypot(velocity.x, velocity.z);
    const heading = Math.atan2(velocity.z, velocity.x);
    if (previousHeading !== null) {
      let step = heading - previousHeading;
      while (step > Math.PI) step -= 2 * Math.PI;
      while (step < -Math.PI) step += 2 * Math.PI;
      sweptRad += Math.abs(step);
    }
    previousHeading = heading;
    const up = rotateByQuat(vehicle.body.rotation(), { x: 0, y: 1, z: 0 });
    minUprightness = Math.min(minUprightness, up.y);
  }
  world.free();

  const pathRate = sweptRad / (steps * DT);
  const speedMps = speedSum / steps;
  return {
    radiusM: speedMps / pathRate,
    speedMps,
    lapSeconds: (2 * Math.PI) / pathRate,
    minUprightness,
  };
}

describe('steering arc', () => {
  it('turns a tight circle at full lock instead of washing wide', () => {
    const { radiusM, lapSeconds, speedMps } = corner('balanced.json', 1, 3);
    expect(speedMps).toBeGreaterThan(4); // genuinely driving, not crawling
    // Around a small roundabout, and back to its own tail inside three seconds.
    // Before the steering law this rig traced roughly 10 m and took 4.6 s.
    expect(radiusM).toBeLessThan(5);
    expect(lapSeconds).toBeLessThan(3);
  });

  it('takes a wider line for less input', () => {
    // Keyboard steer is ±1, but the law has to stay sane for an analogue stick.
    const quarter = corner('balanced.json', 0.25, 3);
    const half = corner('balanced.json', 0.5, 3);
    const full = corner('balanced.json', 1, 3);
    expect(quarter.radiusM).toBeGreaterThan(half.radiusM);
    expect(half.radiusM).toBeGreaterThan(full.radiusM * 1.3);
  });

  it('opens the arc up as speed rises rather than snapping the rig round', () => {
    const slow = corner('balanced.json', 1, 3);
    const fast = corner('balanced.json', 1, 10);
    expect(fast.speedMps).toBeGreaterThan(slow.speedMps + 2);
    expect(fast.radiusM).toBeGreaterThan(slow.radiusM);
    // Still a decisive corner at speed rather than the long sweep it was: this
    // entry used to trace 21.5 m and take 7.2 s to come round.
    expect(fast.radiusM).toBeLessThan(12);
    expect(fast.lapSeconds).toBeLessThan(5);
  });

  it('turns a heavy rig on the same kind of arc as a light one', () => {
    // The point of driving yaw directly: the turn circle is a property of the
    // build's geometry, not of how much mass its tyres happen to be fighting.
    const light = corner('balanced.json', 1, 3);
    const heavy = corner('heavy-armour.json', 1, 3);
    expect(heavy.radiusM).toBeLessThan(light.radiusM * 2);
  });

  it('does not roll a tall rig over on the tightened line', () => {
    // Commanding yaw directly could just as easily trip a top-heavy build; the
    // grip anchor and roll damping have to keep absorbing it.
    const tall = corner('tall-unstable.json', 1, 3);
    expect(tall.minUprightness).toBeGreaterThan(0.85);
    expect(tall.radiusM).toBeLessThan(5);
  });

  it('runs straight with the input centred', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world, 'balanced.json');
    drive(world, vehicle, {}, 1);
    drive(world, vehicle, { throttle: 1 }, 4);
    const start = vehicle.body.translation();
    drive(world, vehicle, { throttle: 1 }, 3);
    const end = vehicle.body.translation();
    const travelled = Math.hypot(end.x - start.x, end.z - start.z);
    expect(travelled).toBeGreaterThan(5);
    // Lateral wander stays a small fraction of the distance covered.
    expect(Math.abs(end.x - start.x)).toBeLessThan(travelled * 0.15);
    world.free();
  });
});
