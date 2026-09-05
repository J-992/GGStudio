import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import {
  FORWARD_SPEED, FWD_ACC, LAT_MAX, LAT_ACC_GROUND, LAT_ACC_AIR,
  GRAVITY, JUMP_V, JUMP_HOLD_GRAVITY_MULT, JUMP_RELEASE_GRAVITY_MULT,
  FALL_GRAVITY_MULT, COYOTE_TIME, JUMP_BUFFER,
  PLAYER_HALF_W, PLAYER_HALF_H, HALF,
  WALL_TRIGGER_DIST, ROT_HOLD_TIME,
} from "../game/Constants";

const ROPE_CLIMB_ACCEL = 20;
const ROPE_CLIMB_MAX_V = 8;
import { FORWARD, type SurfaceFrame } from "../tunnel/SurfaceOrientation";
import type { PlayerIndex } from "../input/InputManager";

export interface PlayerInputSample {
  lateral: number;
  jumpHeld: boolean;
  jumpPressed: boolean;
}

export interface PlayerEvents {
  jumped: boolean;
  landed: boolean;
  landImpact: number;
  launched?: boolean;
}

export const STATIC_GROUP = 0x0001;
export const PLAYER_GROUP = 0x0002;

export function moveToward(cur: number, target: number, maxDelta: number): number {
  if (cur < target) return Math.min(cur + maxDelta, target);
  return Math.max(cur - maxDelta, target);
}

const _pos = new THREE.Vector3();
const _neg = new THREE.Vector3();
const _qTmp = new THREE.Quaternion();
const _invQ = new THREE.Quaternion();
const _lean = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);

function rayHit(
  R: typeof RAPIER,
  world: RAPIER.World,
  pos: THREE.Vector3,
  dir: THREE.Vector3,
  maxToi: number,
  groups: number,
  self: RAPIER.RigidBody,
): number | null {
  const ray = new R.Ray({ x: pos.x, y: pos.y, z: pos.z }, { x: dir.x, y: dir.y, z: dir.z });
  const hit = world.castRay(ray, maxToi, true, undefined, groups, undefined, self);
  return hit ? hit.timeOfImpact : null;
}

export class Player {
  readonly index: PlayerIndex;
  color: number;
  body!: RAPIER.RigidBody;
  spawn = new THREE.Vector3();

  latVel = 0;
  fwdVel = FORWARD_SPEED;
  grounded = false;
  groundDist = 99;
  coyoteTimer = 0;
  jumpBufferTimer = 0;
  airTime = 0;
  beyond = 0;
  wasFar = false;
  lastGroundedAt = -10;
  rotHoldLeft = 0;
  rotHoldRight = 0;
  time = 0;

  /** Lateral carry from a conveyor or a slider, in units per second. */
  platformLat = 0;
  /** Set by a launch pad; spent on the next integrate. */
  boostUp = 0;
  private launchArc = false;

  tensionPull = new THREE.Vector3();
  tensionAmount = 0;
  winchActive = false;
  private climbing = false;
  private blockedUpTime = 0;
  private hauling = false;
  offScreenTime = 0;
  autoRun = true;
  private input: PlayerInputSample = { lateral: 0, jumpHeld: false, jumpPressed: false };

  collider!: RAPIER.Collider;

  setCollide(on: boolean) {
    this.collider.setCollisionGroups((PLAYER_GROUP << 16) | (on ? STATIC_GROUP | PLAYER_GROUP : STATIC_GROUP));
  }

  readonly container = new THREE.Group();
  private modelRoot = new THREE.Group();
  private orientQuat = new THREE.Quaternion();
  private squashVel = 0;
  private squash = 1;
  private runPhase = 0;
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  private visorMat!: THREE.MeshBasicMaterial;
  private accentMat!: THREE.MeshStandardMaterial;
  private bodyMat!: THREE.MeshStandardMaterial;
  shadow: THREE.Mesh;

  constructor(index: PlayerIndex, color: number, scene: THREE.Scene) {
    this.index = index;
    this.color = color;
    this.buildModel();
    scene.add(this.container);

    const shadowGeo = new THREE.CircleGeometry(0.42, 20);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false,
    });
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    scene.add(this.shadow);
  }

  /** Repaints the robot for a bought skin. Materials are shared per robot. */
  applySkin(body: number, accent: number) {
    this.color = accent;
    this.bodyMat.color.setHex(body);
    this.accentMat.color.setHex(accent);
    this.accentMat.emissive.setHex(accent);
    this.visorMat.color.setHex(accent);
  }

  private buildModel() {
    const dark = new THREE.MeshStandardMaterial({
      color: 0x46536b, roughness: 0.5, metalness: 0.35,
    });
    this.bodyMat = dark;
    this.accentMat = new THREE.MeshStandardMaterial({
      color: this.color, roughness: 0.35, metalness: 0.2,
      emissive: this.color, emissiveIntensity: 0.45,
    });
    this.visorMat = new THREE.MeshBasicMaterial({ color: this.color });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.38), dark);
    torso.position.y = 0.34;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.06), this.accentMat);
    chest.position.set(0, 0.36, -0.21);
    this.modelRoot.add(torso, chest);

    if (this.index === 0) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.34, 0.46), dark);
      head.position.y = 0.72;
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.11, 0.05), this.visorMat);
      visor.position.set(0, 0.73, -0.24);
      const shoulderGeo = new THREE.BoxGeometry(0.14, 0.14, 0.3);
      for (const sx of [-1, 1]) {
        const s = new THREE.Mesh(shoulderGeo, this.accentMat);
        s.position.set(sx * 0.33, 0.48, 0);
        this.modelRoot.add(s);
      }
      this.modelRoot.add(head, visor);
    } else {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.44, 0.4), dark);
      head.position.y = 0.75;
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.05), this.visorMat);
      visor.position.set(0, 0.78, -0.21);
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22), dark);
      antenna.position.y = 1.08;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), this.visorMat);
      tip.position.y = 1.2;
      this.modelRoot.add(head, visor, antenna, tip);
    }

    const legGeo = new THREE.BoxGeometry(0.15, 0.32, 0.17);
    legGeo.translate(0, -0.16, 0);
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.13, 0.15, 0);
      pivot.add(new THREE.Mesh(legGeo, dark));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.07, 0.26), this.accentMat);
      foot.position.set(0, -0.31, -0.03);
      pivot.add(foot);
      if (sx < 0) this.legL = pivot;
      else this.legR = pivot;
      this.modelRoot.add(pivot);
    }
    this.container.add(this.modelRoot);
  }

  attachBody(R: typeof RAPIER, world: RAPIER.World, pos: THREE.Vector3) {
    this.spawn.copy(pos);
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .lockRotations()
      .setCanSleep(false);
    this.body = world.createRigidBody(bodyDesc);
    const radius = 0.08;
    const colDesc = R.ColliderDesc.roundCuboid(
      PLAYER_HALF_W - radius,
      PLAYER_HALF_H - radius,
      PLAYER_HALF_W - radius,
      radius,
    )
      .setFriction(0)
      .setRestitution(0)
      .setCollisionGroups((PLAYER_GROUP << 16) | (STATIC_GROUP | PLAYER_GROUP));
    this.collider = world.createCollider(colDesc, this.body);
  }

  resetToSpawn() {
    this.warp(this.spawn.x, this.spawn.y, this.spawn.z);
  }

  warp(x: number, y: number, z: number) {
    this.body.setTranslation({ x, y, z }, true);
    this.stopMotion();
    this.container.position.set(x, y, z);
  }

  stopMotion() {
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.blockedUpTime = 0;
    this.hauling = false;
    this.latVel = 0;
    this.fwdVel = FORWARD_SPEED;
    this.grounded = false;
    this.groundDist = 99;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.airTime = 0;
    this.beyond = 0;
    this.wasFar = false;
    this.rotHoldLeft = 0;
    this.rotHoldRight = 0;
    this.platformLat = 0;
    this.boostUp = 0;
    this.launchArc = false;
    this.tensionPull.set(0, 0, 0);
    this.tensionAmount = 0;
  }

  position(out: THREE.Vector3): THREE.Vector3 {
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  velocityAlong(v: THREE.Vector3): number {
    const lv = this.body.linvel();
    return lv.x * v.x + lv.y * v.y + lv.z * v.z;
  }

  preStep(input: PlayerInputSample) {
    if (input.jumpPressed) this.jumpBufferTimer = JUMP_BUFFER;
    this.input = input;
  }

  integrate(frame: SurfaceFrame, dt: number, ev: PlayerEvents) {
    const input = this.input;

    const authority = 1 - 0.72 * this.tensionAmount;
    const accel = (this.grounded ? LAT_ACC_GROUND : LAT_ACC_AIR) * authority;
    this.latVel = moveToward(this.latVel, input.lateral * LAT_MAX, accel * dt);
    const fwdTarget = this.autoRun ? FORWARD_SPEED : 0;
    this.fwdVel = Math.max(-18, Math.min(18, moveToward(this.fwdVel, fwdTarget, FWD_ACC * dt)));

    let vUp = this.velocityAlong(frame.up);

    // A released jump is cut short on purpose. A launch pad is not a jump, so it
    // keeps its full arc whether or not anyone is holding the button.
    let gMult: number;
    if (vUp > 0.001) {
      if (this.launchArc) gMult = input.jumpHeld ? JUMP_HOLD_GRAVITY_MULT : 1;
      else gMult = input.jumpHeld ? JUMP_HOLD_GRAVITY_MULT : JUMP_RELEASE_GRAVITY_MULT;
    } else {
      gMult = FALL_GRAVITY_MULT;
      this.launchArc = false;
    }
    if (!this.grounded || vUp > 0 || this.tensionPull.dot(frame.up) < 0) vUp -= GRAVITY * gMult * dt;

    // A pad fires whether or not you also pressed jump. Without the saved flag the
    // jump clears `grounded` first and quietly swallows the launch, which is
    // exactly what you do not want on the lip of a chasm.
    const groundedBeforeJump = this.grounded;
    if (this.jumpBufferTimer > 0 && (this.grounded || this.coyoteTimer > 0)) {
      vUp = JUMP_V;
      this.jumpBufferTimer = 0;
      this.coyoteTimer = 0;
      this.grounded = false;
      this.squashVel = 2.6;
      ev.jumped = true;
    }

    if (this.boostUp > 0 && groundedBeforeJump) {
      vUp = this.boostUp;
      this.coyoteTimer = 0;
      this.grounded = false;
      this.launchArc = true;
      this.squashVel = 3.4;
      ev.launched = true;
    }
    this.boostUp = 0;

    vUp += this.tensionPull.dot(frame.up) * dt;
    this.latVel += this.tensionPull.dot(frame.right) * dt;
    this.fwdVel += this.tensionPull.dot(FORWARD) * dt;

    if (!this.grounded && input.jumpHeld && (this.tensionAmount > 0.08 || this.winchActive)) {
      const climb = ROPE_CLIMB_ACCEL * (this.winchActive ? 3 : 1);
      vUp += climb * dt;
      if (vUp > ROPE_CLIMB_MAX_V) vUp = ROPE_CLIMB_MAX_V;
      this.climbing = true;
    } else {
      this.climbing = false;
    }

    if (this.grounded && vUp <= 0.01 && !ev.jumped) vUp = 0;

    const lat = this.latVel + this.platformLat;
    const vx = frame.right.x * lat + FORWARD.x * this.fwdVel + frame.up.x * vUp;
    const vy = frame.right.y * lat + FORWARD.y * this.fwdVel + frame.up.y * vUp;
    const vz = frame.right.z * lat + FORWARD.z * this.fwdVel + frame.up.z * vUp;
    this.body.setLinvel({ x: vx, y: vy, z: vz }, true);
  }

  postStep(
    R: typeof RAPIER,
    world: RAPIER.World,
    frame: SurfaceFrame,
    rayGroups: number,
    dt: number,
    ev: PlayerEvents,
  ) {
    this.position(_pos);
    const wasGrounded = this.grounded;

    const downToi = rayHit(R, world, _pos, _neg.copy(frame.up).negate(), PLAYER_HALF_H + 0.14, rayGroups, this.body);
    this.grounded = downToi !== null;
    this.groundDist = downToi ?? 99;

    if (this.grounded) {
      this.airTime = 0;
      this.coyoteTimer = COYOTE_TIME;
      const vUp = this.velocityAlong(frame.up);
      if (vUp < 0) {
        const lv = this.body.linvel();
        this.body.setLinvel({
          x: lv.x - frame.up.x * vUp,
          y: lv.y - frame.up.y * vUp,
          z: lv.z - frame.up.z * vUp,
        }, true);
      }
      if (!wasGrounded) {
        const vImpact = -this.velocityAlong(frame.up);
        ev.landed = true;
        ev.landImpact = Math.max(0, Math.min(1, vImpact / 12));
        this.squashVel = -(2.2 * ev.landImpact + 0.5);
        this.lastGroundedAt = this.time;
      }
    } else {
      this.airTime += dt;
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    const upToi = rayHit(R, world, _pos, frame.up, PLAYER_HALF_H + 0.08, rayGroups, this.body);
    if (this.climbing && this.winchActive && upToi !== null && this.velocityAlong(frame.up) < 0.1) {
      this.blockedUpTime += dt;
    } else {
      this.blockedUpTime = 0;
    }
    this.hauling = this.blockedUpTime > 0.35;
    if (this.hauling) {
      this.position(_pos);
      const step = 0.085;
      _pos.addScaledVector(frame.up, step);
      this.body.setTranslation({ x: _pos.x, y: _pos.y, z: _pos.z }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      return ev;
    }
    if (upToi !== null && !this.climbing && this.velocityAlong(frame.up) > 0) {
      const lv = this.body.linvel();
      const vUp = this.velocityAlong(frame.up);
      this.body.setLinvel({
        x: lv.x - frame.up.x * vUp, y: lv.y - frame.up.y * vUp, z: lv.z - frame.up.z * vUp,
      }, true);
    }

    const alongRight = _pos.dot(frame.right);
    const pressingRight = this.input.lateral > 0.5;
    const pressingLeft = this.input.lateral < -0.5;
    this.rotHoldRight =
      this.grounded && pressingRight && alongRight > HALF - WALL_TRIGGER_DIST
        ? this.rotHoldRight + dt
        : 0;
    this.rotHoldLeft =
      this.grounded && pressingLeft && alongRight < -(HALF - WALL_TRIGGER_DIST)
        ? this.rotHoldLeft + dt
        : 0;
  }

  rotationIntent(): number {
    if (this.rotHoldRight >= ROT_HOLD_TIME) {
      this.rotHoldRight = 0;
      return 1;
    }
    if (this.rotHoldLeft >= ROT_HOLD_TIME) {
      this.rotHoldLeft = 0;
      return -1;
    }
    return 0;
  }

  updateVisual(dt: number, frame: SurfaceFrame) {
    this.time += dt;
    const t = this.body.translation();
    this.container.position.lerp(_pos.set(t.x, t.y, t.z), 1 - Math.exp(-40 * dt));
    this.orientQuat.slerp(frame.rollQuat, 1 - Math.exp(-14 * dt));
    this.container.quaternion.copy(this.orientQuat);

    const speedK = Math.abs(this.latVel) / LAT_MAX;
    if (this.grounded) this.runPhase += (9 + Math.abs(this.latVel) * 1.6) * dt;

    this.squashVel += (1 - this.squash) * 90 * dt;
    this.squashVel *= Math.exp(-10 * dt);
    this.squash += this.squashVel * dt;
    this.squash = Math.max(0.55, Math.min(1.45, this.squash));

    const swing = this.grounded ? Math.sin(this.runPhase) * (0.55 + speedK * 0.5) : 0;
    const rising = this.velocityAlong(frame.up) > 0;
    const airTuck = this.grounded ? 0 : rising ? -0.85 : -0.35;
    this.legL.rotation.x = this.grounded ? swing : airTuck;
    this.legR.rotation.x = this.grounded ? -swing : airTuck;

    const bank = -this.latVel * 0.035;
    _invQ.copy(this.orientQuat).invert();
    _lean.copy(this.tensionPull).applyQuaternion(_invQ);
    this.modelRoot.rotation.z = bank + _lean.x * 0.06 * this.tensionAmount;
    this.modelRoot.rotation.x = -_lean.z * 0.05 * this.tensionAmount +
      (this.grounded ? 0 : rising ? 0.08 : -0.1);
    this.modelRoot.position.y = this.grounded ? Math.abs(Math.sin(this.runPhase)) * 0.05 : 0;

    const sy = this.squash;
    const sxz = 1 / Math.sqrt(sy);
    this.modelRoot.scale.set(sxz, sy, sxz);

    this.visorMat.color.setHex(this.color).multiplyScalar(Math.min(2.2, 0.7 + this.tensionAmount * 1.6));
  }

  updateShadow(
    R: typeof RAPIER,
    world: RAPIER.World,
    frame: SurfaceFrame,
    rayGroups: number,
  ) {
    this.position(_pos);
    const toi = rayHit(R, world, _pos, _neg.copy(frame.up).negate(), 10, rayGroups, this.body);
    if (toi === null) {
      this.shadow.visible = false;
      return;
    }
    this.shadow.visible = true;
    const n = _neg.copy(frame.up).negate();
    this.shadow.position.set(_pos.x + n.x * toi, _pos.y + n.y * toi, _pos.z + n.z * toi);
    this.shadow.position.addScaledVector(frame.up, 0.03);
    const k = Math.max(0.35, 1 - toi / 10);
    this.shadow.scale.setScalar(k * 1.15);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.34 * k;
    _qTmp.setFromUnitVectors(_zAxis, frame.up);
    this.shadow.quaternion.copy(_qTmp);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.container);
    scene.remove(this.shadow);
    this.container.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
      }
    });
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
  }
}
