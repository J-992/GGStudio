import * as THREE from "three";
import {
  TETHER_REST, TETHER_SPRING_K, TETHER_DAMP,
  TETHER_MAX_ACCEL, TETHER_HARD_MAX, TETHER_HARD_RELAX, TETHER_VEL_CLAMP,
} from "../game/Constants";
import type { Player } from "../player/Player";
import type { SurfaceFrame } from "../tunnel/SurfaceOrientation";

const _d = new THREE.Vector3();
const _raw = new THREE.Vector3();
const _plane = new THREE.Vector3();

const WINCH_MIN = 1.0;
const WINCH_RATE = 3.0;
const WINCH_RECOVER_RATE = 7;

export class TetherState {
  distance = 0;
  extension = 0;
  tension01 = 0;
  wasHigh = false;
  restEff = TETHER_REST;
  winchActive = false;
  private winchLatch = false;

  private applyTo(p: Player, pull: THREE.Vector3, frame: SurfaceFrame) {
    const upComp = pull.dot(frame.up);
    const footing = p.grounded ? 0.3 + 0.25 * this.tension01 * this.tension01 : 1;
    _plane.copy(pull).addScaledVector(frame.up, -upComp).multiplyScalar(footing);
    p.tensionPull.copy(_plane).addScaledVector(frame.up, upComp);
  }

  private updateWinch(p1: Player, p2: Player, dt: number) {
    const cand1 = !p1.grounded && p2.grounded && p1.beyond > 0.75;
    const cand2 = !p2.grounded && p1.grounded && p2.beyond > 0.75;
    if (cand1 || cand2) this.winchLatch = true;
    const anyDangle = (!p1.grounded && p2.grounded) || (!p2.grounded && p1.grounded);
    if (!anyDangle) this.winchLatch = false;
    const active =
      this.winchLatch && anyDangle && Math.max(p1.beyond, p2.beyond) > 0.25;
    this.winchActive = active;
    if (active) this.restEff = Math.max(WINCH_MIN, this.restEff - WINCH_RATE * dt);
    else this.restEff = Math.min(TETHER_REST, this.restEff + WINCH_RECOVER_RATE * dt);
  }

  compute(
    p1: Player,
    p2: Player,
    f1: SurfaceFrame,
    f2: SurfaceFrame,
    dt: number,
  ): { snap: boolean } {
    this.updateWinch(p1, p2, dt);
    p1.position(_p1);
    p2.position(_p2);
    _d.subVectors(_p2, _p1);
    const dist = _d.length();
    if (!Number.isFinite(dist) || dist < 1e-5) {
      this.distance = 0;
      this.tension01 = 0;
      p1.tensionPull.set(0, 0, 0);
      p2.tensionPull.set(0, 0, 0);
      return { snap: false };
    }
    _d.multiplyScalar(1 / dist);

    let snap = false;
    const ext = Math.max(0, dist - this.restEff);
    if (ext > 0) {
      const v1 = p1.body.linvel();
      const v2 = p2.body.linvel();
      const relV =
        (v1.x - v2.x) * _d.x + (v1.y - v2.y) * _d.y + (v1.z - v2.z) * _d.z;
      const stretchRate = -relV;
      let accel = TETHER_SPRING_K * ext + stretchRate * TETHER_DAMP;
      accel = Math.max(-TETHER_MAX_ACCEL, Math.min(TETHER_MAX_ACCEL, accel));
      _raw.copy(_d).multiplyScalar(accel);
      this.applyTo(p1, _raw, f1);
      this.applyTo(p2, _raw.negate(), f2);

      if (dist > TETHER_HARD_MAX) {
        const corr = Math.min((dist - TETHER_HARD_MAX) * TETHER_HARD_RELAX * 0.5, 0.06);
        p1.body.setTranslation({
          x: _p1.x + _d.x * corr, y: _p1.y + _d.y * corr, z: _p1.z + _d.z * corr,
        }, true);
        p2.body.setTranslation({
          x: _p2.x - _d.x * corr, y: _p2.y - _d.y * corr, z: _p2.z - _d.z * corr,
        }, true);
        snap = !this.wasHigh;
      }
    } else if (dist < this.restEff) {
      const v1 = p1.body.linvel();
      const v2 = p2.body.linvel();
      const relV =
        (v1.x - v2.x) * _d.x + (v1.y - v2.y) * _d.y + (v1.z - v2.z) * _d.z;
      if (relV > 0) {
        const brake = Math.min(relV * 4, 40);
        _raw.copy(_d).multiplyScalar(-brake);
        this.applyTo(p1, _raw, f1);
        this.applyTo(p2, _raw.negate(), f2);
      } else if (dist < 1.2) {
        _raw.copy(_d).multiplyScalar(-8);
        this.applyTo(p1, _raw, f1);
        this.applyTo(p2, _raw.negate(), f2);
      } else {
        p1.tensionPull.set(0, 0, 0);
        p2.tensionPull.set(0, 0, 0);
      }
    } else {
      p1.tensionPull.set(0, 0, 0);
      p2.tensionPull.set(0, 0, 0);
    }

    for (const b of [p1.body, p2.body]) {
      const lv = b.linvel();
      const sp2 = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z;
      if (sp2 > TETHER_VEL_CLAMP * TETHER_VEL_CLAMP) {
        const s = TETHER_VEL_CLAMP / Math.sqrt(sp2);
        b.setLinvel({ x: lv.x * s, y: lv.y * s, z: lv.z * s }, true);
      }
    }

    this.distance = dist;
    this.extension = ext;
    this.tension01 = Math.min(1, ext / Math.max(0.001, TETHER_HARD_MAX - this.restEff));
    this.wasHigh = this.tension01 > 0.85;
    void dt;
    return { snap };
  }
}

const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
