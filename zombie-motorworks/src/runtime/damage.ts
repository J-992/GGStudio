/**
 * Collision damage and structural island splitting.
 *
 * Connections are tracked logically; when one fails, connected components are
 * recomputed. The component containing the root keeps the main body; every
 * other island becomes a new compound rigid body with preserved point
 * velocity (v + ω×r). Debris colliders are slightly shrunk instead of using a
 * collision-group grace period — break-plane neighbours then never spawn
 * interpenetrating, which avoids solver pop (documented deviation from
 * PHYSICS_MODEL.md's grace-period suggestion).
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type { AssembledVehicle, RuntimePart } from './assembler.ts';
import { DEBRIS_GROUPS } from './assembler.ts';
import { CELL_SIZE } from '../core/types.ts';
import { computeIslands } from '../core/structural.ts';
import { add, cross, scale, sub, v3 } from './vec.ts';

export interface DetachedIsland {
  body: RAPIER.RigidBody;
  partIds: string[];
}

export interface DamageEvents {
  destroyedParts: string[];
  detachedIslands: DetachedIsland[];
}

export const SAFE_IMPACT_FORCE_N = 100_000;
export const IMPACT_DAMAGE_SCALE = 1 / 65; // HP per N·s above the safe force
export const CONNECTION_DAMAGE_SCALE = 1 / 5_000; // connection health per N·s
export const REFERENCE_CONNECTION_FORCE_N = 120_000;

const IMPACT_STEP_SECONDS = 1 / 60;

export function impactImpulseNs(forceN: number): number {
  return Math.max(0, forceN - SAFE_IMPACT_FORCE_N) * IMPACT_STEP_SECONDS;
}

export function partDamage(impulseNs: number): number {
  return impulseNs * IMPACT_DAMAGE_SCALE;
}

export function connectionDamage(
  impulseShareNs: number,
  maxForceN: number,
): number {
  return (
    (impulseShareNs * CONNECTION_DAMAGE_SCALE * REFERENCE_CONNECTION_FORCE_N) /
    maxForceN
  );
}

/**
 * How much of a ram a part actually feels, 0..1. Ramming hardware — the plough
 * blade above all — is built to be driven into walls and wrecks, so it eats
 * most of the impulse rather than passing it on to its own health and mounts.
 */
export function impactFelt(def: { impactResistance?: number }): number {
  const resistance = def.impactResistance ?? 0;
  return 1 - Math.min(1, Math.max(0, resistance));
}

/**
 * Apply impact damage to a part (by collider handle) and its connections.
 *
 * `damageScale` is the whole-vehicle multiplier a buff puts on incoming damage
 * (a Colossus rig takes collisions at a fraction of their force). It scales the
 * impulse rather than the part's health, so the connections around the hit are
 * spared in the same proportion as the block itself.
 */
export function applyImpactDamage(
  vehicle: AssembledVehicle,
  colliderToPart: Map<number, string>,
  colliderHandle: number,
  forceMagnitude: number,
  damageScale = 1,
): void {
  const partId = colliderToPart.get(colliderHandle);
  if (!partId) return;
  const part = vehicle.parts.get(partId);
  if (!part || !part.alive) return;
  // The blade's own resistance covers its mounts too: surviving the hit only
  // to be shaken off the nose is the same failure from the driver's seat.
  const impulseNs =
    impactImpulseNs(forceMagnitude) * impactFelt(part.def) * damageScale;
  part.health -= partDamage(impulseNs);

  const liveConnections = (vehicle.connectionsByPart.get(partId) ?? [])
    .map((ci) => vehicle.connections[ci])
    .filter((conn) => conn.health > 0);
  if (liveConnections.length === 0) return;
  const impulseShareNs = impulseNs / liveConnections.length;
  for (const conn of liveConnections) {
    conn.health -= connectionDamage(impulseShareNs, conn.maxForce);
  }
}

/**
 * Share of a hit landing on a tire or tread that the wheel itself keeps; the
 * rest is carried into whatever it is bolted to.
 *
 * A wheel is one part with one health bar, but losing it costs the player a
 * corner of the car — far more than the block next to it is worth — and it is
 * the part every hazard reaches first, sitting lowest and furthest out. Passing
 * most of a hit up into the mount and the frame around it spreads a beating
 * across the rig instead of shooting out one corner, so a run ends with a car
 * that has been ground down rather than one that lost a tire and then died.
 */
export const WHEEL_DAMAGE_SHARE = 0.4;

/** One part eating one hit: armour first, and never fully absorbed. */
function dealTo(part: RuntimePart, amount: number): void {
  const absorb =
    part.def.armour && !part.def.armour.cosmetic
      ? part.def.armour.protection
      : 0;
  part.health -= Math.max(1, amount - absorb);
}

/** Live, still-attached parts this one is bolted to through a live connection. */
function loadBearingNeighbours(
  vehicle: AssembledVehicle,
  partId: string,
): RuntimePart[] {
  const out: RuntimePart[] = [];
  for (const ci of vehicle.connectionsByPart.get(partId) ?? []) {
    const conn = vehicle.connections[ci];
    if (conn.health <= 0) continue;
    const otherId = conn.aId === partId ? conn.bId : conn.aId;
    const other = vehicle.parts.get(otherId);
    // Wheels pass a hit on to structure, never to another wheel — a bogie of
    // treads would otherwise just trade the same damage back and forth.
    if (!other || !other.alive || other.detached || other.def.wheel) continue;
    out.push(other);
  }
  return out;
}

export function applyDirectDamage(
  vehicle: AssembledVehicle,
  partId: string,
  amount: number,
): void {
  const part = vehicle.parts.get(partId);
  if (!part || !part.alive) return;
  if (part.def.wheel === undefined) {
    dealTo(part, amount);
    return;
  }
  const carriers = loadBearingNeighbours(vehicle, partId);
  if (carriers.length === 0) {
    // A wheel hanging off a broken mount has nothing to share with.
    dealTo(part, amount);
    return;
  }
  dealTo(part, amount * WHEEL_DAMAGE_SHARE);
  const carried = (amount * (1 - WHEEL_DAMAGE_SHARE)) / carriers.length;
  for (const carrier of carriers) dealTo(carrier, carried);
}

/**
 * Resolve deaths and splits after damage was applied this step.
 * Removes dead parts' colliders, recomputes islands, spawns debris bodies.
 */
export function resolveStructure(
  world: RAPIER.World,
  vehicle: AssembledVehicle,
  colliderToPart: Map<number, string>,
): DamageEvents {
  const destroyed: string[] = [];

  for (const [id, part] of vehicle.parts) {
    if (part.alive && part.health <= 0) {
      part.alive = false;
      destroyed.push(id);
      for (const h of part.colliderHandles) {
        const col = world.getCollider(h);
        if (col) world.removeCollider(col, true);
        colliderToPart.delete(h);
      }
      part.colliderHandles = [];
      for (const ci of vehicle.connectionsByPart.get(id) ?? []) {
        vehicle.connections[ci].health = 0;
      }
      const wheel = vehicle.wheels.find((candidate) => candidate.partId === id);
      if (wheel) {
        wheel.broken = true;
        wheel.grounded = false;
        wheel.contactPointW = null;
        wheel.loadN = 0;
      }
    }
  }

  // Recompute islands over alive, still-attached parts.
  const attached = [...vehicle.parts.values()].filter(
    (p) => p.alive && !p.detached,
  );
  const liveConns = vehicle.connections.filter((c) => {
    if (c.health <= 0) return false;
    const a = vehicle.parts.get(c.aId);
    const b = vehicle.parts.get(c.bId);
    return !!a && !!b && a.alive && !a.detached && b.alive && !b.detached;
  });
  const islands = computeIslands(
    attached.map((p) => p.placed.id),
    liveConns,
  );

  const detachedIslands: DetachedIsland[] = [];
  if (islands.length <= 1)
    return { destroyedParts: destroyed, detachedIslands };

  const rootIsland =
    islands.find((isle) => isle.includes(vehicle.rootPartId)) ?? islands[0];
  const body = vehicle.body;
  const bodyPos = body.translation();
  const bodyRot = body.rotation();
  const linvel = body.linvel();
  const angvel = body.angvel();
  const com = body.worldCom();

  for (const isle of islands) {
    if (isle === rootIsland) continue;
    const newBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(bodyPos.x, bodyPos.y, bodyPos.z)
        .setRotation(bodyRot)
        .setAngvel(angvel)
        .setLinvel(linvel.x, linvel.y, linvel.z),
    );
    const half = (CELL_SIZE / 2) * 0.94; // shrunk: no break-plane interpenetration pop
    const islandCentres: { x: number; y: number; z: number }[] = [];
    for (const partId of isle) {
      const part = vehicle.parts.get(partId)!;
      part.detached = true;
      for (const h of part.colliderHandles) {
        const col = world.getCollider(h);
        if (col) world.removeCollider(col, true);
        colliderToPart.delete(h);
      }
      const newHandles: number[] = [];
      for (const centre of part.colliderCentresM) {
        const desc = RAPIER.ColliderDesc.cuboid(half, half, half)
          .setTranslation(centre.x, centre.y, centre.z)
          .setMass(part.def.massKg / part.colliderCentresM.length)
          .setFriction(0.6)
          .setCollisionGroups(DEBRIS_GROUPS);
        const col = world.createCollider(desc, newBody);
        newHandles.push(col.handle);
        islandCentres.push(centre);
      }
      part.colliderHandles = newHandles;
      const wheel = vehicle.wheels.find((w) => w.partId === partId);
      if (wheel) wheel.broken = true;
    }
    // Point velocity at the island CoM: v + ω × r (not a plain linvel copy).
    if (islandCentres.length > 0) {
      const centroid = islandCentres.reduce(
        (acc, c) => ({
          x: acc.x + c.x / islandCentres.length,
          y: acc.y + c.y / islandCentres.length,
          z: acc.z + c.z / islandCentres.length,
        }),
        { x: 0, y: 0, z: 0 },
      );
      // centroid is body-local; rotate into world.
      const qv = { x: bodyRot.x, y: bodyRot.y, z: bodyRot.z };
      const t = scale(
        cross(v3(qv.x, qv.y, qv.z), v3(centroid.x, centroid.y, centroid.z)),
        2,
      );
      const centroidW = add(
        v3(bodyPos.x, bodyPos.y, bodyPos.z),
        add(
          v3(centroid.x, centroid.y, centroid.z),
          add(scale(t, bodyRot.w), cross(v3(qv.x, qv.y, qv.z), t)),
        ),
      );
      const r = sub(centroidW, v3(com.x, com.y, com.z));
      const pointVel = add(
        v3(linvel.x, linvel.y, linvel.z),
        cross(v3(angvel.x, angvel.y, angvel.z), r),
      );
      newBody.setLinvel({ x: pointVel.x, y: pointVel.y, z: pointVel.z }, true);
    }
    detachedIslands.push({ body: newBody, partIds: isle });
  }

  return { destroyedParts: destroyed, detachedIslands };
}
