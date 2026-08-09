/**
 * Where a beating lands on the rig. Tires used to be both the nearest thing to
 * a zombie standing beside the car and a one-part single point of failure, so
 * a run ended with one corner shot out and the hull untouched. Two rules move
 * that: the horde bites by tier once it is in reach, and a hit that does land
 * on a wheel is mostly carried by what the wheel is bolted to.
 */

import { readFileSync } from 'node:fs';

import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPartDef } from '../src/core/parts.ts';
import { deserializeBlueprint } from '../src/core/serialize.ts';
import { deriveConnections } from '../src/core/structural.ts';
import { GROUP_TERRAIN, lowestPointM } from '../src/runtime/assembler.ts';
import { RuntimeVehicle } from '../src/runtime/vehicle.ts';
import { WHEEL_DAMAGE_SHARE } from '../src/runtime/damage.ts';
import { ZombieSystem } from '../src/survival/zombies/ZombieSystem.ts';
import {
  BITE_TIER,
  bitePriority,
  ZOMBIE_ATTACK_RANGE,
} from '../src/survival/zombies/zombieConfig.ts';

const TERRAIN_GROUPS = (GROUP_TERRAIN << 16) | 0xffff;

beforeAll(async () => {
  await RAPIER.init();
});

function spawnVehicle(world: RAPIER.World): RuntimeVehicle {
  const bp = deserializeBlueprint(
    readFileSync(
      new URL('../tests/fixtures/balanced.json', import.meta.url),
      'utf8',
    ),
  );
  const connections = deriveConnections(bp, getPartDef);
  return new RuntimeVehicle(world, bp, getPartDef, connections, {
    translation: { x: 0, y: -lowestPointM(bp, getPartDef) + 0.32, z: 0 },
  });
}

function makeWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(400, 1, 400)
      .setTranslation(0, -1, 0)
      .setCollisionGroups(TERRAIN_GROUPS),
  );
  return world;
}

/** One anchor as `scanNearestVehiclePart` reads it: a live part at a place. */
function anchor(defId: string, x: number, y: number, z: number) {
  return {
    partId: `${defId}@${x},${y},${z}`,
    part: { alive: true, detached: false, health: 50, def: getPartDef(defId) },
    worldX: x,
    worldY: y,
    worldZ: z,
  };
}

/**
 * `scanNearestVehiclePart` only walks `vehicleAnchors`, so it runs on a bare
 * instance without a Rapier world or a zombie pool — same trick as the splash
 * tests use for `explodeAt`.
 */
function pickTarget(
  anchors: ReturnType<typeof anchor>[],
  x: number,
  y: number,
  z: number,
): { partId: string | null; distance: number } {
  const system = Object.create(ZombieSystem.prototype) as ZombieSystem;
  Object.assign(system, { vehicleAnchors: anchors });
  const zombie = {
    position: { x, y, z },
    vehicleTarget: { partId: null, x: 0, y: 0, z: 0, distance: Infinity },
  };
  (
    system as unknown as { scanNearestVehiclePart(z: unknown): void }
  ).scanNearestVehiclePart(zombie);
  return zombie.vehicleTarget;
}

describe('bite priority', () => {
  it('ranks weapons ahead of blocks, and tires last of all', () => {
    expect(bitePriority(getPartDef('turret'))).toBe(BITE_TIER.weapon);
    expect(bitePriority(getPartDef('spike-ram'))).toBe(BITE_TIER.weapon);
    expect(bitePriority(getPartDef('frame-box'))).toBe(BITE_TIER.block);
    expect(bitePriority(getPartDef('armour-plate'))).toBe(BITE_TIER.block);
    expect(bitePriority(getPartDef('engine-small'))).toBe(BITE_TIER.block);
    expect(bitePriority(getPartDef('wheel-standard'))).toBe(BITE_TIER.wheel);
    expect(bitePriority(getPartDef('tread-tank'))).toBe(BITE_TIER.wheel);
  });
});

describe('zombie target selection', () => {
  it('bites a reachable weapon over the wheel right in front of it', () => {
    const wheel = anchor('wheel-standard', 0, 0.4, 0);
    const gun = anchor('turret', 0, 1.4, 1.4);
    const frame = anchor('frame-box', 0, 1, 0.8);

    const target = pickTarget([wheel, gun, frame], 0, 0.5, -0.5);

    expect(target.partId).toBe(gun.partId);
  });

  it('falls back to a block when no weapon is in reach', () => {
    const wheel = anchor('wheel-standard', 0, 0.4, 0);
    const frame = anchor('frame-box', 0, 1, 0.8);
    const gun = anchor('turret', 0, 1.4, 9);

    const target = pickTarget([wheel, frame, gun], 0, 0.5, -0.5);

    expect(target.partId).toBe(frame.partId);
  });

  it('still bites the tire when the tire is all there is in reach', () => {
    const wheel = anchor('wheel-standard', 0, 0.4, 0);
    const frame = anchor('frame-box', 0, 1, 6);

    const target = pickTarget([wheel, frame], 0, 0.5, -0.5);

    expect(target.partId).toBe(wheel.partId);
    expect(target.distance).toBeLessThanOrEqual(ZOMBIE_ATTACK_RANGE);
  });

  it('walks at the nearest part while still out of biting range', () => {
    const wheel = anchor('wheel-standard', 0, 0.4, 0);
    const gun = anchor('turret', 0, 1.4, 4);

    const target = pickTarget([wheel, gun], 0, 0.5, -8);

    expect(target.partId).toBe(wheel.partId);
  });
});

describe('wheel damage sharing', () => {
  it('leaves most of a hit on the block the tire is bolted to', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    const wheelId = vehicle.wheels()[0].partId;
    const wheel = vehicle.assembled.parts.get(wheelId)!;
    const carriers = vehicle.assembled.connections
      .filter((conn) => conn.aId === wheelId || conn.bId === wheelId)
      .map((conn) => (conn.aId === wheelId ? conn.bId : conn.aId))
      .map((id) => vehicle.assembled.parts.get(id)!);
    expect(carriers.length).toBeGreaterThan(0);

    const before = new Map(
      [...vehicle.assembled.parts].map(([id, part]) => [id, part.health]),
    );
    vehicle.applyDirectDamage(wheelId, 100);

    expect(before.get(wheelId)! - wheel.health).toBeCloseTo(
      100 * WHEEL_DAMAGE_SHARE,
      5,
    );
    let carried = 0;
    for (const carrier of carriers) {
      carried += before.get(carrier.placed.id)! - carrier.health;
    }
    expect(carried).toBeCloseTo(100 * (1 - WHEEL_DAMAGE_SHARE), 5);

    world.free();
  });

  it('takes a hit in full once the tire has nothing left to lean on', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    const wheelId = vehicle.wheels()[0].partId;
    const wheel = vehicle.assembled.parts.get(wheelId)!;
    for (const conn of vehicle.assembled.connections) {
      if (conn.aId === wheelId || conn.bId === wheelId) conn.health = 0;
    }

    const before = wheel.health;
    vehicle.applyDirectDamage(wheelId, 30);

    expect(before - wheel.health).toBeCloseTo(30, 5);

    world.free();
  });

  it('costs a tire more than its listed health to destroy outright', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    const wheelId = vehicle.wheels()[0].partId;
    const wheel = vehicle.assembled.parts.get(wheelId)!;

    vehicle.applyDirectDamage(wheelId, wheel.def.health);
    vehicle.finishStep();

    expect(wheel.alive).toBe(true);
    expect(wheel.health).toBeGreaterThan(0);

    world.free();
  });
});
