/**
 * Headless checks that the two supply crates which touch the Runtime Vehicle
 * do what the crate says: Colossus changes what the rig deals, takes, and can
 * reach, and a repair kit bolts a lost wheel back onto the body.
 */

import { readFileSync } from 'node:fs';

import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPartDef } from '../src/core/parts.ts';
import { deserializeBlueprint } from '../src/core/serialize.ts';
import { deriveConnections } from '../src/core/structural.ts';
import { GROUP_TERRAIN, lowestPointM } from '../src/runtime/assembler.ts';
import { WHEEL_DAMAGE_SHARE } from '../src/runtime/damage.ts';
import type { VehicleControls } from '../src/runtime/vehicle.ts';
import { RuntimeVehicle } from '../src/runtime/vehicle.ts';
import {
  COLOSSUS_DAMAGE_MULTIPLIER,
  COLOSSUS_MOBILITY,
  COLOSSUS_SCALE,
  COLOSSUS_SECONDS,
  COLOSSUS_TOUGHNESS,
} from '../src/survival/dropTable.ts';

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

function settle(world: RAPIER.World, vehicle: RuntimeVehicle, steps = 60): void {
  for (let i = 0; i < steps; i++) {
    vehicle.preStep(DT, idleControls, () => 'asphalt');
    world.step();
    vehicle.postStepStability(DT);
    vehicle.finishStep();
  }
}

function grantColossus(vehicle: RuntimeVehicle): void {
  vehicle.grantColossus(
    COLOSSUS_SECONDS,
    COLOSSUS_SCALE,
    COLOSSUS_DAMAGE_MULTIPLIER,
    COLOSSUS_TOUGHNESS,
    COLOSSUS_MOBILITY,
  );
}

describe('colossus crate', () => {
  it('doubles what the rig deals and halves what reaches its blocks', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    // A hull block, not a wheel: wheel hits are shared out across the parts the
    // wheel is bolted to (see WHEEL_DAMAGE_SHARE), which would hide the
    // toughness multiplier this test is measuring.
    const part = [...vehicle.assembled.parts.values()].find(
      (candidate) => candidate.def.id === 'frame-box',
    )!;

    expect(vehicle.outgoingDamageMultiplier).toBe(1);
    expect(vehicle.colossusScale).toBe(1);

    grantColossus(vehicle);
    expect(vehicle.outgoingDamageMultiplier).toBe(COLOSSUS_DAMAGE_MULTIPLIER);
    expect(vehicle.colossusScale).toBe(COLOSSUS_SCALE);

    const before = part.health;
    vehicle.applyDirectDamage(part.placed.id, 40);
    expect(before - part.health).toBeCloseTo(40 / COLOSSUS_TOUGHNESS, 5);

    world.free();
  });

  it('lapses back to an ordinary rig when its seconds run out', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    grantColossus(vehicle);

    for (let i = 0; i < Math.round((COLOSSUS_SECONDS + 0.5) / DT); i++) {
      vehicle.preStep(DT, idleControls, () => 'asphalt');
      world.step();
      vehicle.postStepStability(DT);
      vehicle.finishStep();
    }

    expect(vehicle.colossusSecondsRemaining).toBe(0);
    expect(vehicle.colossusScale).toBe(1);
    expect(vehicle.outgoingDamageMultiplier).toBe(1);

    world.free();
  });

  it('cannot be spammed into something stronger than one crate', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    grantColossus(vehicle);
    grantColossus(vehicle);

    expect(vehicle.colossusScale).toBe(COLOSSUS_SCALE);
    expect(vehicle.outgoingDamageMultiplier).toBe(COLOSSUS_DAMAGE_MULTIPLIER);

    world.free();
  });
});

describe('repair crate', () => {
  it('puts a destroyed wheel back on the body, driving again', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    settle(world, vehicle);

    const wheel = vehicle.wheels()[0];
    const part = vehicle.assembled.parts.get(wheel.partId)!;
    // Only WHEEL_DAMAGE_SHARE of a hit stays on the tire; the rest goes into
    // the block it is bolted to, so a killing blow costs proportionally more.
    vehicle.applyDirectDamage(
      wheel.partId,
      (part.def.health / WHEEL_DAMAGE_SHARE) * 1.05,
    );
    vehicle.finishStep();
    expect(part.alive).toBe(false);
    expect(wheel.broken).toBe(true);
    expect(vehicle.survivingPartIds()).not.toContain(wheel.partId);

    const repaired = vehicle.repairOne();

    expect(repaired).not.toBeNull();
    expect(repaired?.action).toBe('rebuild');
    expect(repaired?.partId).toBe(wheel.partId);
    expect(part.alive).toBe(true);
    expect(part.health).toBe(part.def.health);
    expect(wheel.broken).toBe(false);
    expect(part.colliderHandles.length).toBeGreaterThan(0);
    for (const handle of part.colliderHandles) {
      expect(vehicle.colliderToPart.get(handle)).toBe(wheel.partId);
    }

    // The rebuilt block has to survive the next structural pass rather than be
    // torn straight back off as its own island.
    settle(world, vehicle);
    expect(vehicle.survivingPartIds()).toContain(wheel.partId);

    world.free();
  });

  it('patches the worst-hurt block when nothing is missing, then nothing', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    settle(world, vehicle);

    const target = vehicle.wheels()[0].partId;
    const part = vehicle.assembled.parts.get(target)!;
    vehicle.applyDirectDamage(target, part.def.health * 0.9);
    vehicle.finishStep();
    expect(part.health).toBeLessThan(part.def.health);

    const patched = vehicle.repairOne();
    expect(patched?.action).toBe('heal');
    expect(patched?.partId).toBe(target);
    expect(part.health).toBe(part.def.health);

    world.free();
  });
});

describe('buff timers', () => {
  it('reports overdrive and the bubble as remaining over what they started from', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);

    expect(vehicle.overdriveSeconds).toEqual({ remaining: 0, total: 0 });
    expect(vehicle.invulnerableSeconds).toEqual({ remaining: 0, total: 0 });

    vehicle.grantOverdrive(4, 2, 1.2);
    vehicle.grantInvulnerability(3);
    expect(vehicle.overdriveSeconds).toEqual({ remaining: 4, total: 4 });
    expect(vehicle.invulnerableSeconds).toEqual({ remaining: 3, total: 3 });

    for (let i = 0; i < Math.round(1 / DT); i++) {
      vehicle.preStep(DT, idleControls, () => 'asphalt');
      world.step();
      vehicle.postStepStability(DT);
      vehicle.finishStep();
    }
    const overdrive = vehicle.overdriveSeconds;
    expect(overdrive.total).toBe(4);
    expect(overdrive.remaining).toBeGreaterThan(2.9);
    expect(overdrive.remaining).toBeLessThan(3.1);

    world.free();
  });

  it('clears a lapsed timer rather than leaving a stale denominator', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    vehicle.grantOverdrive(0.5, 2, 1.2);
    vehicle.grantInvulnerability(0.5);

    for (let i = 0; i < Math.round(1 / DT); i++) {
      vehicle.preStep(DT, idleControls, () => 'asphalt');
      world.step();
      vehicle.postStepStability(DT);
      vehicle.finishStep();
    }

    expect(vehicle.overdriveSeconds).toEqual({ remaining: 0, total: 0 });
    expect(vehicle.invulnerableSeconds).toEqual({ remaining: 0, total: 0 });

    world.free();
  });

  it('drops the reinforce timer the moment the ward is spent, not when it expires', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    settle(world, vehicle);
    vehicle.grantReinforce(8, 0.5, 30);
    expect(vehicle.reinforceSeconds).toEqual({ remaining: 8, total: 8 });

    // Spend the whole pool in one hit: the shell is down from here, so the HUD
    // timer has to go with it even though eight seconds are still on the clock.
    vehicle.applyDirectDamage(vehicle.wheels()[0].partId, 60);

    expect(vehicle.isReinforced).toBe(false);
    expect(vehicle.reinforceSeconds).toEqual({ remaining: 0, total: 0 });

    world.free();
  });

  it('tracks the hellfire nozzle with the most left on it', () => {
    const world = makeWorld();
    const vehicle = spawnVehicle(world);
    const weapons = vehicle.weaponStates();
    expect(weapons.length).toBeGreaterThan(0);

    expect(vehicle.overchargeSeconds).toEqual({ remaining: 0, total: 0 });
    expect(
      vehicle.grantHellfire(weapons[0].partId, 6, {
        damageMultiplier: 2,
        rangeMultiplier: 1.4,
        coneMultiplier: 1.3,
      }),
    ).toBe(true);

    expect(vehicle.overchargeSeconds).toEqual({ remaining: 6, total: 6 });

    world.free();
  });
});
