import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import { getFrame, type Orientation, type SurfaceFrame } from "./SurfaceOrientation";

const Z = new THREE.Vector3(0, 0, 1);

/** One rigid rotating course assembly. Static scenery is deliberately outside it.
 * Terrain and collision use the same authoritative fixed-step angle. */
export class Drum {
  angle = 0;
  readonly rotation = new THREE.Quaternion();
  private inverse = new THREE.Quaternion();
  private bodies: { body: RAPIER.RigidBody; position: THREE.Vector3; rotation: THREE.Quaternion }[] = [];
  private frame: SurfaceFrame = {
    up: new THREE.Vector3(), right: new THREE.Vector3(), rollQuat: new THREE.Quaternion(),
  };
  private point = new THREE.Vector3();
  private quat = new THREE.Quaternion();

  constructor(readonly speed: number) {}

  attach(world: RAPIER.World, R: typeof RAPIER) {
    if (!this.speed) return;
    world.forEachRigidBody((body) => {
      // Drum courses intentionally exclude independently moving features.
      if (!body.isFixed()) throw new Error("Drum terrain must be rigid; put moving features in a static course");
      const t = body.translation(), q = body.rotation();
      this.bodies.push({ body, position: new THREE.Vector3(t.x, t.y, t.z), rotation: new THREE.Quaternion(q.x, q.y, q.z, q.w) });
      body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
    });
  }

  setAngle(angle: number, immediate = false) {
    this.angle = angle;
    this.rotation.setFromAxisAngle(Z, angle);
    this.inverse.copy(this.rotation).invert();
    for (const item of this.bodies) {
      this.point.copy(item.position).applyQuaternion(this.rotation);
      this.quat.multiplyQuaternions(this.rotation, item.rotation);
      if (immediate) {
        item.body.setTranslation(this.point, true);
        item.body.setRotation(this.quat, true);
      }
      item.body.setNextKinematicTranslation(this.point);
      item.body.setNextKinematicRotation(this.quat);
    }
  }

  advance(dt: number) { if (this.speed) this.setAngle(this.angle + this.speed * dt); }
  toLocal(p: THREE.Vector3) { return p.applyQuaternion(this.inverse); }
  toWorld(p: THREE.Vector3) { return p.applyQuaternion(this.rotation); }
  surface(o: Orientation): SurfaceFrame {
    const base = getFrame(o);
    if (!this.speed) return base;
    this.frame.up.copy(base.up).applyQuaternion(this.rotation);
    this.frame.right.copy(base.right).applyQuaternion(this.rotation);
    this.frame.rollQuat.multiplyQuaternions(this.rotation, base.rollQuat);
    return this.frame;
  }
}
