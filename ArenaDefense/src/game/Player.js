// First-person player controller: movement, look, the equipped weapon (fire +
// recoil + walk sway + the viewmodel), health/regen/invulnerability, and the
// `aimTarget` cone test that touch aim-assist uses.
//
// The weapon is swappable (`setWeapon`) — `this.gun` points at an entry in
// `config.player.weapons.types`, chosen on the weapon-select screen and again
// in any build phase.
//
// Recoil: one spring in `core/recoil.js` drives both the viewmodel (slide
// back, rise, muzzle-up tilt) and a pitch offset on the *rendered* camera
// rotation. `this.pitch`/`this.yaw` are never written by it, so the punch
// self-recovers to exactly where the player was aiming. Aim direction is
// derived from yaw/pitch by `_aimDirection` rather than read off the camera
// matrix, which is what keeps the kick cosmetic — see that method.
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
import { coerceWeaponId, resolveWeapon } from '../core/weapons.js';
import { buildWeaponMesh } from './weaponMesh.js';
import { clampToArena } from '../core/arenaGeometry.js';
import {
  createRecoilSpring,
  kickRecoilSpring,
  resetRecoilSpring,
  stepRecoilSpring,
} from '../core/recoil.js';

const DEG2RAD = Math.PI / 180;
const WALK_BOB_SPEED = 10;
const WALK_BOB_AMOUNT = 0.03;
const WALK_SWAY_AMOUNT = 0.01;

export class Player {
  /**
   * No `assets` dependency: the viewmodel is built from primitives by
   * `game/weaponMesh.js` rather than loaded from `props.glb`.
   *
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('../core/types.js').GameConfig} config
   */
  constructor(camera, config) {
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
    /** @type {object} The current weapon's def from `config.player.weapons.types`. Swap with `setWeapon`. */
    this.gun = resolveWeapon(p.defaultWeapon, config);
    this.weaponId = p.defaultWeapon;

    this._time = 0;
    this._lastDamageT = -Infinity;
    this._lastFireT = -Infinity;
    this._walkPhase = 0;
    this._recoil = createRecoilSpring();

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._fireOrigin = new THREE.Vector3();
    this._fireDir = new THREE.Vector3();
    this._toTarget = new THREE.Vector3();

    camera.rotation.order = 'YXZ';

    this._viewmodelBasePos = new THREE.Vector3(0.32, -0.28, -0.55);
    /** @type {THREE.Mesh|null} Rebuilt by `setWeapon`; see `_buildViewmodel`. */
    this._viewmodel = null;
    this._buildViewmodel();
  }

  /**
   * Points the player at a different weapon and rebuilds the viewmodel.
   * Unknown ids fall back to `config.player.defaultWeapon` rather than
   * throwing, so a stale id in saved preferences can't break a boot.
   *
   * @param {string} id
   * @returns {string} The id actually equipped.
   */
  setWeapon(id) {
    const resolved = coerceWeaponId(id, this._config);
    if (resolved === this.weaponId && this._viewmodel) return resolved;
    this.weaponId = resolved;
    this.gun = resolveWeapon(resolved, this._config);
    this._buildViewmodel();
    // Don't let a swap hand out a free shot: the new weapon starts on its own
    // cooldown rather than inheriting however long the old one had been idle.
    this._lastFireT = this._time;
    return resolved;
  }

  /**
   * Builds the held weapon from primitives (`game/weaponMesh.js`) rather than
   * from an authored mesh.
   *
   * All six weapons used to be `Gun_02`/`Gun_03` recoloured and rescaled, so
   * they were indistinguishable in the hand. They are also the two meshes
   * `ASSET_LICENSES.md` records as UNKNOWN provenance — and that file names
   * "procedural gun/turret-base geometry" as its own remedy. So this both
   * makes the weapons readable and retires a licensing risk, at zero
   * download bytes against a hard budget.
   */
  _buildViewmodel() {
    this._disposeViewmodel();

    /** @type {THREE.BufferGeometry[]} */
    this._ownedGeometries = [];
    /** @type {THREE.Material[]} */
    this._ownedMaterials = [];
    const mesh = buildWeaponMesh(this.weaponId, this.gun, this._ownedGeometries, this._ownedMaterials);
    // The builders work in near-real proportions; this brings the whole set
    // down to viewmodel size. See `config.player.weapons.viewmodelScale`.
    mesh.scale.multiplyScalar(this._config.player.weapons.viewmodelScale ?? 1);
    mesh.position.copy(this._viewmodelBasePos);
    // The recoil tilt is an *offset* from whatever orientation the builder
    // left, rather than a bare `rotation.set`. Euler order is the default
    // 'XYZ' (R = Rx*Ry*Rz), so adding to `.x` left-multiplies an extra Rx — a
    // muzzle-up tilt in the camera's frame regardless of the base rotation.
    // Recaptured per build, since each weapon has its own.
    this._viewmodelBaseRot = mesh.rotation.clone();
    this._camera.add(mesh);
    this._viewmodel = mesh;
  }

  /**
   * Releases the current viewmodel. Everything the builder allocated is in the
   * two owned arrays and is ours to free — nothing here is shared with the
   * scene, unlike the `propMesh` geometry this used to borrow.
   */
  _disposeViewmodel() {
    if (!this._viewmodel) return;
    this._camera.remove(this._viewmodel);
    for (const geom of this._ownedGeometries ?? []) geom.dispose();
    for (const mat of this._ownedMaterials ?? []) mat.dispose();
    this._ownedGeometries = [];
    this._ownedMaterials = [];
    this._viewmodel = null;
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
    resetRecoilSpring(this._recoil);
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

    // The equipped weapon's own amplitudes — the spring itself (stepped
    // below) is shared, so a heavier weapon kicks harder without retuning it.
    const r = this.gun.recoil;
    stepRecoilSpring(this._recoil, dt, cfg);
    const kick = this._recoil.value;

    this._walkPhase += moving ? dt * WALK_BOB_SPEED : 0;
    const bob = moving ? Math.sin(this._walkPhase) * WALK_BOB_AMOUNT : 0;
    this._camera.position.set(this.x, this.eyeHeight + bob, this.z);
    // The kick is an additive offset on the *rendered* rotation only —
    // `this.pitch` stays the player's own aim, so the view returns to exactly
    // where they left it with nothing to compensate for. Re-clamped with the
    // same `limit` so a kick can never push the view past `pitchLimitDeg`.
    const viewPitch = this.pitch + kick * r.camPitchDeg * DEG2RAD;
    this._camera.rotation.set(Math.min(limit, Math.max(-limit, viewPitch)), -this.yaw, 0);

    const sway = moving ? Math.sin(this._walkPhase * 0.5) * WALK_SWAY_AMOUNT : 0;
    this._viewmodel.position.set(
      this._viewmodelBasePos.x + sway,
      this._viewmodelBasePos.y + kick * r.viewUpM,
      this._viewmodelBasePos.z + kick * r.viewBackM,
    );
    this._viewmodel.rotation.x = this._viewmodelBaseRot.x + kick * r.viewPitchDeg * DEG2RAD;
  }

  /**
   * The view direction implied by `yaw`/`pitch`, as the analytic form of the
   * camera's `'YXZ'` / `rotation.y = -yaw` / `rotation.x = pitch` convention
   * — the pitched sibling of the flat `this._forward` built in `update`.
   *
   * Deliberately *not* `camera.getWorldDirection()`: the rendered camera
   * carries the recoil pitch offset, and reading direction off it would send
   * every shot after the first in a burst high and shrink the effective
   * `coneDegTouch` for touch auto-fire. Deriving from yaw/pitch keeps the
   * kick purely cosmetic — shots always go where the player is aiming.
   *
   * @param {THREE.Vector3} out Written in place and returned.
   * @returns {THREE.Vector3}
   */
  _aimDirection(out) {
    const cosPitch = Math.cos(this.pitch);
    return out.set(cosPitch * Math.sin(this.yaw), Math.sin(this.pitch), -cosPitch * Math.cos(this.yaw));
  }

  /**
   * @returns {{ origin: THREE.Vector3, dir: THREE.Vector3 } | null} `null`
   *   while on cooldown or dead. Both vectors are SCRATCH — they are reused
   *   by the next `fire()` call, so a caller that needs to keep either past
   *   the current fixed step must copy it. `Game#_handleFiring` consumes
   *   both within the step, and `Effects#tracer` copies what it is given.
   */
  fire() {
    if (!this.alive) return null;
    const cooldownS = 1 / this.gun.rate;
    if (this._time - this._lastFireT < cooldownS) return null;
    this._lastFireT = this._time;
    kickRecoilSpring(this._recoil, this.gun.recoil.impulse);

    // Position is unaffected by the kick (it offsets rotation only), so the
    // camera is still the right source for the muzzle origin.
    this._camera.getWorldPosition(this._fireOrigin);
    // Scratch vectors, not clones: `Game#_handleFiring` consumes both within
    // the same fixed step and `Effects#tracer` copies what it is given.
    this._aimDirection(this._fireDir);
    return { origin: this._fireOrigin, dir: this._fireDir };
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
   * — used by touch aim-assist (it used to drive auto-fire outright, before
   * the touch layer had a fire button; `Game#_handleFiring` now bends a
   * deliberately-fired touch shot onto this target instead). `candidate.radius` is accepted for a future
   * radius-aware cone/occlusion test but unused in v1.
   *
   * @param {{x:number,y:number,z:number,radius:number}[]} candidates
   * @returns {number} Index into `candidates`, or -1 if none are within the cone.
   */
  aimTarget(candidates) {
    if (candidates.length === 0) return -1;
    this._camera.getWorldPosition(this._fireOrigin);
    this._aimDirection(this._fireDir);
    const cosLimit = Math.cos(this.gun.coneDegTouch * DEG2RAD);

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
