import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PHYSICS } from './PhysicsConfig';

/**
 * Wraps the Rapier world behind a fixed-timestep accumulator.
 *
 * The renderer runs at whatever rate the display allows; physics always advances
 * in exact PHYSICS.fixedTimeStep increments, and visuals interpolate between the
 * last two steps using {@link alpha}. This is what keeps movement identical at
 * 30, 60 and 144 fps.
 */

/** Collision groups, packed as Rapier's (membership << 16) | filter. */
export const GROUP = {
  PLAYER: 0x0001,
  GROUND: 0x0002,
  OBSTACLE: 0x0004,
  SENSOR: 0x0008,
  PURSUER: 0x0010,
} as const;

export function collisionGroups(membership: number, filter: number): number {
  return (membership << 16) | filter;
}

/** Snapshot pair used to interpolate a body's render transform. */
interface Snapshot {
  prevPos: THREE.Vector3;
  prevRot: THREE.Quaternion;
  currPos: THREE.Vector3;
  currRot: THREE.Quaternion;
}

export interface ContactInfo {
  /** The other collider involved. */
  otherHandle: number;
  /** True on contact start, false on separation. */
  started: boolean;
}

export type ContactListener = (info: ContactInfo) => void;

let rapierReady: Promise<void> | null = null;

/** Loads the Rapier WASM once. Safe to await repeatedly. */
export function initRapier(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

export class PhysicsWorld {
  world!: RAPIER.World;

  private eventQueue!: RAPIER.EventQueue;
  private accumulator = 0;
  private snapshots = new Map<number, Snapshot>();
  private listeners = new Map<number, ContactListener>();

  /** Interpolation factor in [0,1] between the previous and current step. */
  alpha = 0;
  /** Fixed steps actually simulated during the last update() call. */
  stepsLastFrame = 0;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: PHYSICS.gravity, z: 0 });
    this.world.timestep = PHYSICS.fixedTimeStep;
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  /**
   * Advances the simulation by real elapsed time.
   * @param dt seconds since the last frame, already clamped by the caller
   * @param onStep invoked once per fixed step, before Rapier integrates
   */
  update(dt: number, onStep?: (fixedDt: number) => void): void {
    const step = PHYSICS.fixedTimeStep;
    this.accumulator += dt;

    // Drop the backlog rather than spiral-of-death after a tab stall.
    const maxAccum = step * PHYSICS.maxSubSteps;
    if (this.accumulator > maxAccum) this.accumulator = maxAccum;

    this.stepsLastFrame = 0;
    while (this.accumulator >= step) {
      this.captureSnapshots();
      onStep?.(step);
      this.world.step(this.eventQueue);
      this.drainContacts();
      this.accumulator -= step;
      this.stepsLastFrame++;
    }

    this.alpha = this.accumulator / step;
  }

  private captureSnapshots(): void {
    for (const [handle, snap] of this.snapshots) {
      const body = this.world.getRigidBody(handle);
      if (!body) continue;
      snap.prevPos.copy(snap.currPos);
      snap.prevRot.copy(snap.currRot);
      const t = body.translation();
      const r = body.rotation();
      snap.currPos.set(t.x, t.y, t.z);
      snap.currRot.set(r.x, r.y, r.z, r.w);
    }
  }

  private drainContacts(): void {
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      const l1 = this.listeners.get(h1);
      if (l1) l1({ otherHandle: h2, started });
      const l2 = this.listeners.get(h2);
      if (l2) l2({ otherHandle: h1, started });
    });
  }

  // -------------------------------------------------------------------------
  // Interpolation
  // -------------------------------------------------------------------------

  /** Starts tracking a body so its render transform can be interpolated. */
  trackBody(body: RAPIER.RigidBody): void {
    const t = body.translation();
    const r = body.rotation();
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    const rot = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    this.snapshots.set(body.handle, {
      prevPos: pos.clone(),
      prevRot: rot.clone(),
      currPos: pos.clone(),
      currRot: rot.clone(),
    });
  }

  untrackBody(body: RAPIER.RigidBody): void {
    this.snapshots.delete(body.handle);
  }

  /** Clears interpolation history so a teleported body doesn't smear. */
  resetInterpolation(body: RAPIER.RigidBody): void {
    const snap = this.snapshots.get(body.handle);
    if (!snap) return;
    const t = body.translation();
    const r = body.rotation();
    snap.currPos.set(t.x, t.y, t.z);
    snap.currRot.set(r.x, r.y, r.z, r.w);
    snap.prevPos.copy(snap.currPos);
    snap.prevRot.copy(snap.currRot);
  }

  /**
   * Samples a tracked body's transform between the last two fixed steps.
   *
   * Physics runs at a fixed 60 Hz off an accumulator, so a rendered frame may
   * drive two steps, one, or none. Reading `body.translation()` directly at
   * render rate therefore returns a position that lurches forward and then
   * stalls - which, against a damped camera, reads as the object shaking. This
   * is what {@link alpha} exists for.
   *
   * Falls back to the raw transform for an untracked body, so callers do not
   * have to know whether a body was registered with {@link trackBody}.
   */
  sampleInterpolated(
    body: RAPIER.RigidBody,
    outPosition: THREE.Vector3,
    outRotation: THREE.Quaternion,
  ): void {
    const snap = this.snapshots.get(body.handle);
    if (!snap) {
      const t = body.translation();
      const r = body.rotation();
      outPosition.set(t.x, t.y, t.z);
      outRotation.set(r.x, r.y, r.z, r.w);
      return;
    }
    outPosition.lerpVectors(snap.prevPos, snap.currPos, this.alpha);
    outRotation.slerpQuaternions(snap.prevRot, snap.currRot, this.alpha);
  }

  /** Writes the interpolated transform of a tracked body onto an Object3D. */
  syncObject(body: RAPIER.RigidBody, object: THREE.Object3D): void {
    this.sampleInterpolated(body, object.position, object.quaternion);
  }

  // -------------------------------------------------------------------------
  // Contacts
  // -------------------------------------------------------------------------

  /** Registers a contact callback for a collider. Requires COLLISION_EVENTS. */
  onContact(collider: RAPIER.Collider, listener: ContactListener): void {
    collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.listeners.set(collider.handle, listener);
  }

  offContact(collider: RAPIER.Collider): void {
    this.listeners.delete(collider.handle);
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  private rayOrigin = { x: 0, y: 0, z: 0 };
  private rayDir = { x: 0, y: 0, z: 0 };
  private ray = new RAPIER.Ray(this.rayOrigin, this.rayDir);

  /**
   * Casts a ray and returns the hit distance plus surface normal.
   * Reuses internal scratch objects - do not retain the returned normal.
   */
  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    excludeBody?: RAPIER.RigidBody,
    filterGroups?: number,
  ): { distance: number; normal: THREE.Vector3; collider: RAPIER.Collider } | null {
    this.rayOrigin.x = origin.x;
    this.rayOrigin.y = origin.y;
    this.rayOrigin.z = origin.z;
    this.rayDir.x = direction.x;
    this.rayDir.y = direction.y;
    this.rayDir.z = direction.z;
    this.ray.origin = this.rayOrigin;
    this.ray.dir = this.rayDir;

    const hit = this.world.castRayAndGetNormal(
      this.ray,
      maxDistance,
      true,
      undefined,
      filterGroups,
      undefined,
      excludeBody,
    );
    if (!hit) return null;

    return {
      distance: hit.timeOfImpact,
      normal: SCRATCH_NORMAL.set(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
    };
  }

  /** Number of rigid bodies currently in the world - surfaced by the debug panel. */
  get bodyCount(): number {
    return this.world.bodies.len();
  }

  // -------------------------------------------------------------------------

  /** Frees all Rapier memory. The instance is unusable afterwards. */
  dispose(): void {
    this.snapshots.clear();
    this.listeners.clear();
    this.eventQueue.free();
    this.world.free();
  }
}

const SCRATCH_NORMAL = new THREE.Vector3();

export { RAPIER };
