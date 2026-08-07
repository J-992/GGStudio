/**
 * Sentry crates: drive over one and a gun turret bolts itself to the ground
 * where the crate stood, shoots whatever comes near it for a few seconds, then
 * burns out and sinks away.
 *
 * The turret that stands up is the crate's own block — the same model
 * `pickupModels` hovers over the drop, set down on the ground and turned to
 * face what it is shooting. What the player drove over is exactly what they
 * get, which is the whole reason the crate shows hardware instead of a box.
 *
 * A sentry is not part of the rig — it has no blueprint, no colliders, and no
 * structure. It is a position, a timer, and a hitscan pass over the zombies
 * already tracked by `ZombieSystem`, which is why it can be dropped anywhere
 * and thrown away without touching the vehicle.
 */

import * as THREE from 'three';
import { PICKUP_KINDS } from './dropTable.ts';
import {
  buildPickupModel,
  disposePickupModel,
  SENTRY_MUZZLE_LOCAL,
} from './pickupModels.ts';

const RANGE_M = 22;
const FIRE_INTERVAL = 0.28; // seconds between shots
const DAMAGE = 26;
const SINK_SECONDS = 0.4; // tail of the lifetime spent dropping out of sight
const YAW_RATE = 9; // rad/s the turret slews at

/** A live target the sentry can shoot: whatever the zombie system is tracking. */
export interface SentryTarget {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly colliderHandle: number;
}

export interface SentryHooks {
  /**
   * Closest shootable body within `radiusM` of the sentry, or null. The owner
   * may return a reused object: a sentry reads it before asking again.
   */
  nearestTarget(x: number, z: number, radiusM: number): SentryTarget | null;
  /** Land one shot. Returns false when the handle no longer resolves. */
  hit(colliderHandle: number, damage: number): boolean;
  /** Draw the streak and the flash for a shot that connected. */
  onShot(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
  ): void;
}

interface Sentry {
  readonly group: THREE.Group;
  x: number;
  z: number;
  yaw: number;
  ttl: number;
  lifetime: number;
  cooldown: number;
}

export class SentryTurrets {
  private readonly root = new THREE.Group();
  private readonly active: Sentry[] = [];
  private readonly pool: Sentry[] = [];
  // Reused shot endpoints: a sentry fires several times a second and the
  // tracer/VFX layers only read them synchronously.
  private readonly muzzle = { x: 0, y: 0, z: 0 };
  private readonly impact = { x: 0, y: 0, z: 0 };
  private disposed = false;

  /**
   * The crate's block, built once and cloned per deployment. Clones share its
   * geometry and materials, so a dozen sentries over a run cost one set of
   * buffers rather than one each.
   */
  private readonly template = buildPickupModel('sentry', PICKUP_KINDS.sentry.color);
  /** Lift that puts the model's feet on the ground rather than through it. */
  private readonly standY: number;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly hooks: SentryHooks,
  ) {
    this.root.name = 'sentry-turrets';
    this.scene.add(this.root);
    // Measured, not assumed: the block is modelled about its own middle, and
    // whatever its lowest point is has to end up at ground level.
    this.standY = -new THREE.Box3().setFromObject(this.template).min.y;
  }

  /** Stand a sentry up at a world point for `seconds`. */
  deploy(x: number, z: number, seconds: number): void {
    if (this.disposed || seconds <= 0) return;
    const sentry = this.pool.pop() ?? this.build();
    sentry.x = x;
    sentry.z = z;
    sentry.yaw = 0;
    sentry.ttl = seconds;
    sentry.lifetime = seconds;
    // Ready to fire the moment it lands: a five-second turret that spends its
    // first interval winding up is a three-shot turret.
    sentry.cooldown = 0;
    sentry.group.position.set(x, this.standY, z);
    sentry.group.rotation.y = 0;
    sentry.group.visible = true;
    this.active.push(sentry);
  }

  private build(): Sentry {
    const group = new THREE.Group();
    group.add(this.template.clone());
    group.visible = false;
    this.root.add(group);
    return {
      group,
      x: 0,
      z: 0,
      yaw: 0,
      ttl: 0,
      lifetime: 0,
      cooldown: 0,
    };
  }

  /** True while at least one sentry is standing. */
  get hasActive(): boolean {
    return this.active.length > 0;
  }

  /**
   * Seconds left on the longest-lived sentry, for the HUD timer. Sentries can
   * overlap, and the bar should empty when the last gun goes quiet rather than
   * when the first one does.
   */
  get secondsRemaining(): number {
    let longest = 0;
    for (const sentry of this.active) longest = Math.max(longest, sentry.ttl);
    return longest;
  }

  /** The lifetime that longest-lived sentry started from, as its denominator. */
  get longestLifetime(): number {
    let longest = 0;
    let lifetime = 0;
    for (const sentry of this.active) {
      if (sentry.ttl <= longest) continue;
      longest = sentry.ttl;
      lifetime = sentry.lifetime;
    }
    return lifetime;
  }

  /** Run every live sentry's clock and let each take its shots. */
  step(dt: number): void {
    if (this.disposed || this.active.length === 0) return;
    for (let index = this.active.length - 1; index >= 0; index -= 1) {
      const sentry = this.active[index];
      sentry.ttl -= dt;
      if (sentry.ttl <= 0) {
        sentry.group.visible = false;
        this.active.splice(index, 1);
        this.pool.push(sentry);
        continue;
      }
      const target = this.hooks.nearestTarget(sentry.x, sentry.z, RANGE_M);
      if (target === null) continue;
      sentry.yaw = Math.atan2(target.x - sentry.x, target.z - sentry.z);
      sentry.cooldown -= dt;
      if (sentry.cooldown > 0) continue;
      sentry.cooldown = FIRE_INTERVAL;
      // Shots leave the barrel tips of the block that is standing there, along
      // the yaw it is already turning onto.
      this.muzzle.x = sentry.x + Math.sin(sentry.yaw) * SENTRY_MUZZLE_LOCAL.z;
      this.muzzle.y = this.standY + SENTRY_MUZZLE_LOCAL.y;
      this.muzzle.z = sentry.z + Math.cos(sentry.yaw) * SENTRY_MUZZLE_LOCAL.z;
      this.impact.x = target.x;
      this.impact.y = target.y;
      this.impact.z = target.z;
      if (this.hooks.hit(target.colliderHandle, DAMAGE)) {
        this.hooks.onShot(this.muzzle, this.impact);
      }
    }
  }

  /**
   * Slew the turrets toward what they are shooting and drop the dying ones into
   * the ground, so a sentry ending reads as a sentry ending rather than one
   * vanishing between frames.
   */
  updateVisuals(frameDt: number): void {
    if (this.disposed) return;
    for (const sentry of this.active) {
      const delta = wrapAngle(sentry.yaw - sentry.group.rotation.y);
      const step = Math.min(Math.abs(delta), YAW_RATE * frameDt);
      sentry.group.rotation.y += Math.sign(delta) * step;
      const sinking = Math.max(0, SINK_SECONDS - sentry.ttl) / SINK_SECONDS;
      sentry.group.position.y = this.standY - sinking * 1.2;
    }
  }

  /** Drop every standing sentry (wave end, mode teardown). */
  clear(): void {
    for (const sentry of this.active) {
      sentry.group.visible = false;
      this.pool.push(sentry);
    }
    this.active.length = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active.length = 0;
    this.pool.length = 0;
    this.scene.remove(this.root);
    this.root.clear();
    disposePickupModel(this.template);
  }
}

function wrapAngle(radians: number): number {
  let out = radians;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
}
