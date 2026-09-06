// First-person player controller: movement, look, the held gun (fire +
// recoil + walk sway), health/regen/invulnerability, and touch auto-fire's
// `aimTarget` cone test.
//
// Yaw/pitch convention: yaw 0 looks toward -z (matching `core/arenaGeometry`'s
// "gate angle 0 points north/-z"), and increases clockwise — turning the
// camera right. Pitch is positive looking up. The camera uses Euler order
//'YXZ' with `rotation.y = -yaw`, `rotation.x = pitch`, which is exactly the
// sign convention `PointerLockControls`-style FPS code uses, so
// `lookDX`/`lookDY` (pixels, +x right, +y down — the same convention
// `movementX/Y` already uses) plug straight in: `yaw += lookDX * sens`,
// `pitch -= lookDY * sens`.
//
// Clock note: `invulnUntil` (and `fire()`'s cooldown) are compared against
// the player's own fixed-step clock, which accumulates the same `dt` every
// step as `Game.js`'s `world.time` — the two are numerically identical from
// frame 0, so any caller wanting to grant invulnerability can just write
// `player.invulnUntil = world.time + seconds`.
import * as THREE from 'three';
import { clampToArena } from '../core/arenaGeometry.js';

const DEG2RAD = Math.PI / 180;
const WALK_BOB_SPEED = 10;
const WALK_BOB_AMOUNT = 0.03;
const RECOIL_DECAY_PER_S = 6;

export class Player {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('./assets.js').Assets} assets
   * @param {import('../core/types.js').GameConfig} config
   */
  constructor(camera, assets, config) {
    this._camera = camera;
    this._config = config;

    const p = config.player;
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.hp = p.hp;
    this.alive = true;
    this.invulnUntil = 0;

    this.speed = p.speed;
    this.radius = p.radius;
    this.eyeHeight = p.eyeHeight;
    this.gun = p.gun;

    this._time = 0;
    this._lastDamageT = -Infinity;
    this._lastFireT = -Infinity;
    this._walkPhase = 0;
    this._recoil = 0;

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._fireOrigin = new THREE.Vector3();
    this._fireDir = new THREE.Vector3();
    this._toTarget = new THREE.Vector3();

    camera.rotation.order = 'YXZ';

    this._viewmodel = assets.propMesh('Gun_03');
    this._viewmodelBasePos = new THREE.Vector3(0.32, -0.28, -0.55);
    this._viewmodel.position.copy(this._viewmodelBasePos);
    camera.add(this._viewmodel);
  }

  /** Resets position/orientation/health for a fresh run; keeps the camera/viewmodel objects. */
  reset() {
    const p = this._config.player;
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.hp = p.hp;
    this.alive = true;
    this.invulnUntil = 0;
    this._lastFireT = -Infinity;
    this._recoil = 0;
  }

  /**
   * @param {number} dt
   * @param {import('../core/types.js').InputFrame} frame
   */
  update(dt, frame) {
    this._time += dt;
    const cfg = this._config;
    const p = cfg.player;

    const sens = frame.mode === 'touch' ? p.lookSensTouch : p.lookSensMouse;
    this.yaw += frame.lookDX * sens;
    this.pitch -= frame.lookDY * sens;
    const limit = p.pitchLimitDeg * DEG2RAD;
    this.pitch = Math.min(limit, Math.max(-limit, this.pitch));

    this._forward.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));

    const moving = this.alive && (frame.moveX !== 0 || frame.moveY !== 0);
    if (this.alive) {
      const dx = (this._right.x * frame.moveX + this._forward.x * frame.moveY) * this.speed * dt;
      const dz = (this._right.z * frame.moveX + this._forward.z * frame.moveY) * this.speed * dt;
      const next = clampToArena(this.x + dx, this.z + dz, cfg.arena.radius - this.radius);
      this.x = next.x;
      this.z = next.z;
    }

    if (this.alive && this.hp < p.hp && this._time - this._lastDamageT >= p.regenDelayS) {
      this.hp = Math.min(p.hp, this.hp + p.regenPerS * dt);
    }

    this._walkPhase += moving ? dt * WALK_BOB_SPEED : 0;
    const bob = moving ? Math.sin(this._walkPhase) * WALK_BOB_AMOUNT : 0;
    this._camera.position.set(this.x, this.eyeHeight + bob, this.z);
    this._camera.rotation.set(this.pitch, -this.yaw, 0);

    this._recoil = Math.max(0, this._recoil - dt * RECOIL_DECAY_PER_S);
    const sway = moving ? Math.sin(this._walkPhase * 0.5) * 0.01 : 0;
    this._viewmodel.position.set(
      this._viewmodelBasePos.x + sway,
      this._viewmodelBasePos.y - this._recoil * 0.5,
      this._viewmodelBasePos.z + this._recoil,
    );
  }

  /**
   * @returns {{ origin: THREE.Vector3, dir: THREE.Vector3 } | null} `null` while on cooldown or dead.
   */
  fire() {
    if (!this.alive) return null;
    const cooldownS = 1 / this.gun.rate;
    if (this._time - this._lastFireT < cooldownS) return null;
    this._lastFireT = this._time;
    this._recoil = Math.min(this.gun.recoilKick * 3, this._recoil + this.gun.recoilKick);

    this._camera.getWorldPosition(this._fireOrigin);
    this._camera.getWorldDirection(this._fireDir);
    return { origin: this._fireOrigin.clone(), dir: this._fireDir.clone() };
  }

  /**
   * @param {number} n Damage amount; ignored while dead or invulnerable.
   */
  takeDamage(n) {
    if (!this.alive) return;
    if (this._time < this.invulnUntil) return;
    this.hp -= n;
    this._lastDamageT = this._time;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  /**
   * Nearest candidate within `gun.coneDegTouch` of the current view direction
   * — used by touch auto-fire. `candidate.radius` is accepted for a future
   * radius-aware cone/occlusion test but unused in v1.
   *
   * @param {{x:number,y:number,z:number,radius:number}[]} candidates
   * @returns {number} Index into `candidates`, or -1 if none are within the cone.
   */
  aimTarget(candidates) {
    if (candidates.length === 0) return -1;
    this._camera.getWorldPosition(this._fireOrigin);
    this._camera.getWorldDirection(this._fireDir);
    const cosLimit = Math.cos(this._config.player.gun.coneDegTouch * DEG2RAD);

    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      this._toTarget.set(c.x - this._fireOrigin.x, c.y - this._fireOrigin.y, c.z - this._fireOrigin.z);
      const dist = this._toTarget.length();
      if (dist < 1e-5) continue;
      this._toTarget.multiplyScalar(1 / dist);
      const cosAngle = this._toTarget.dot(this._fireDir);
      if (cosAngle >= cosLimit && dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }
}
