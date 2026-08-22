import * as THREE from "three";
import { CAM_BACK, CAM_UP, LOOK_AHEAD, FOV_BASE, ROT_ANIM_TIME } from "../game/Constants";
import { FORWARD, getFrame, stepOrientation, Orientation } from "../tunnel/SurfaceOrientation";
import type { Player } from "../player/Player";

export class CoopCamera {
  readonly camera: THREE.PerspectiveCamera;
  private rollFrom = new THREE.Quaternion();
  private rollTo = new THREE.Quaternion();
  private rollT = 1;
  private currentRoll = new THREE.Quaternion();
  private smoothedMid = new THREE.Vector3(0, 0, 0);
  private initialized = false;
  private fov = FOV_BASE;
  private animTimer = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(FOV_BASE, aspect, 0.1, 220);
    this.currentRoll.copy(getFrame(Orientation.Floor).rollQuat);
  }

  get rolling(): boolean {
    return this.rollT < 1;
  }

  requestRoll(from: Orientation, to: Orientation) {
    this.rollFrom.copy(getFrame(from).rollQuat);
    this.rollTo.copy(getFrame(to).rollQuat);
    this.rollT = 0;
    this.animTimer = ROT_ANIM_TIME;
  }

  snapTo(orientation: Orientation) {
    this.currentRoll.copy(getFrame(orientation).rollQuat);
    this.rollT = 1;
    this.initialized = false;
  }

  update(dt: number, p1: Player, p2: Player, orientation: Orientation) {
    if (this.rollT < 1) {
      this.rollT = Math.min(1, this.rollT + dt / ROT_ANIM_TIME);
      const k = this.smoothstep(this.rollT);
      this.currentRoll.slerpQuaternions(this.rollFrom, this.rollTo, k);
    } else {
      this.currentRoll.slerp(getFrame(orientation).rollQuat, 1 - Math.exp(-10 * dt));
    }
    void stepOrientation;

    const up = _up.set(0, 1, 0).applyQuaternion(this.currentRoll);

    _mid1.copy(p1.container.position);
    _mid2.copy(p2.container.position);
    _target.addVectors(_mid1, _mid2).multiplyScalar(0.5);

    const sep = _mid1.distanceTo(_mid2);
    const sepK = Math.max(0, Math.min(1, (sep - 3) / 4.5));
    const back = CAM_BACK * (1 + 0.3 * sepK);
    const lift = CAM_UP * (1 + 0.22 * sepK);

    _look.copy(_target).addScaledVector(FORWARD, LOOK_AHEAD);
    _desired.copy(_look).addScaledVector(up, lift).addScaledVector(FORWARD, -back);

    if (!this.initialized) {
      this.smoothedMid.copy(_desired);
      this.initialized = true;
    }
    const rate = this.animTimer > 0 ? 10 : 6.5;
    this.animTimer = Math.max(0, this.animTimer - dt);
    this.smoothedMid.lerp(_desired, 1 - Math.exp(-rate * dt));

    this.camera.position.copy(this.smoothedMid);
    this.camera.up.copy(up);
    this.camera.lookAt(_look.x + up.x * 1.1, _look.y + up.y * 1.1, _look.z + up.z * 1.1);

    const targetFov = FOV_BASE + 11 * sepK;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-4 * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
  }
}

const _up = new THREE.Vector3();
const _mid1 = new THREE.Vector3();
const _mid2 = new THREE.Vector3();
const _target = new THREE.Vector3();
const _look = new THREE.Vector3();
const _desired = new THREE.Vector3();
