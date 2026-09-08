// A pooled travelling-projectile system for the player's splash weapon
// (`config.player.weapons.types.rpg7` today, but any weapon def with a
// truthy `projSpeed` routes here from `Game.js#_handleFiring` instead of the
// hitscan path — see that file's `if (gun.projSpeed) { ... }` branch). Every
// other player weapon resolves instantly on the frame it's fired
// (`_resolvePellet`); a rocket instead lives in this pool for however many
// fixed steps it takes to reach something, then detonates with splash
// damage.
//
// Structure mirrors `Enemies.js`'s own projectile pool (`PROJECTILE_CAP`
// SoA typed arrays + free-list, one `InstancedMesh` for all live shots,
// hidden slots zero-scaled — same idiom as `Effects.js`'s particle pool)
// almost exactly, but cannot reuse it: that pool is private to `Enemies`,
// integrates on the XZ plane only (fixed Y), and only ever damages the
// player/turrets. A rocket the player fires at the ground or up at the boss
// needs a full 3D velocity, and needs to damage enemies/the boss instead.
//
// Hit detection deliberately does NOT re-implement a stepped/swept sphere
// check against a "small contact radius" by hand. Every candidate a rocket
// can detonate against already exposes an exact, continuous ray-vs-shape
// test over an arbitrary distance — `Enemies#raycast` (ray vs. per-type
// cylinder), `Boss#hitTest` (ray vs. the boss's cylinder), and
// `arenaGeometry.rayArenaHit` (ray vs. floor plane / wall cylinder). Casting
// one such test per candidate, per projectile, per frame — from the
// projectile's position at the start of the frame, along its direction of
// travel, out to exactly the distance it covers this frame — is the same
// technique the player's own hitscan already uses, and it is mathematically
// exact: a fast rocket cannot tunnel through a body between two frames
// because the whole segment between them is swept, not just its two
// endpoints. This is strictly stronger than discrete sub-stepping with a
// fixed contact radius (which is itself only an approximation of the same
// continuous test), so it's used here instead.
import * as THREE from 'three';
import { rayArenaHit } from '../core/arenaGeometry.js';

// --- Module-level tunables new to this file (not sourced from `cfg`) ---
// Every other number this file uses (`gun.projSpeed`, `.splash`,
// `.splashDmg`, `.dmg`, `.range`, `.sound`, `.color`) comes straight from
// `cfg.player.weapons.types.rpg7` per AGENTS.md — these are the ones that
// don't have a config home yet; see the caller's report for whether any of
// these should move into `src/config.js`.

/** Max rockets in flight at once. `rpg7.rate` is 0.45 shots/s and its
 *  `range`/`projSpeed` give at most ~2s of flight time, so one shot in
 *  flight is the common case — this gives generous headroom for a player
 *  who switches weapons and back, or fires at the very end of a rocket's
 *  life, without ever feeling the cap. */
const PROJECTILE_CAP = 16;
/** Cone geometry radius (metres) — purely cosmetic. */
const ROCKET_RADIUS = 0.12;
/** Cone geometry length (metres) — purely cosmetic. */
const ROCKET_LENGTH = 0.55;
/** Particle color for a rocket's detonation burst (a hot orange, distinct
 *  from the red hit-particle color used elsewhere for plain hitscan hits). */
const EXPLOSION_COLOR = 0xffa347;
/** Particle count for a detonation burst — bigger than a regular hitscan
 *  hit (10) or even the boss's own death burst (24), since a splash
 *  explosion is the biggest single visual moment this weapon produces. */
const EXPLOSION_PARTICLE_COUNT = 28;
/** Minimum gap between detonation-sound plays, so a rocket that splashes
 *  several enemies and the boss at once doesn't stack overlapping voices —
 *  same throttling idiom as `Enemies.js#_playThrottled`. */
const EXPLOSION_SOUND_MIN_INTERVAL_S = 0.08;
/** Fallback sound if `gun.sound` is ever unset — this class has no `assets`
 *  reference (only `audio`, per its constructor contract) to check a buffer
 *  actually exists the way `Turrets#_fire`/`Game#_playShotSound` do, so this
 *  is a plain truthiness fallback onto a name confirmed present in
 *  `public/assets/manifest.json` rather than a verified-present one. */
const FALLBACK_SOUND = 'explosion-metal';

const ZERO_SCALE = new THREE.Matrix4().makeScale(0, 0, 0);
const _up = new THREE.Vector3(0, 1, 0);

const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scaleOne = new THREE.Vector3(1, 1, 1);
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Projectiles {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../core/types.js').GameConfig} cfg
   * @param {import('../platform/audio.js').Audio} audio
   */
  constructor(scene, cfg, audio) {
    this._scene = scene;
    this._cfg = cfg;
    this._audio = audio;
    /** @type {Record<string, number>} */
    this._lastSoundAt = {};

    // Cosmetic only: the rpg7's own configured color, so the rocket reads as
    // "the same weapon" rather than an arbitrary new hardcoded hue.
    const rpgColor = cfg.player?.weapons?.types?.rpg7?.color ?? 0x3d5a3d;
    const geometry = new THREE.ConeGeometry(ROCKET_RADIUS, ROCKET_LENGTH, 8);
    const material = new THREE.MeshBasicMaterial({ color: rpgColor });
    const mesh = new THREE.InstancedMesh(geometry, material, PROJECTILE_CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = PROJECTILE_CAP;
    mesh.name = 'player-projectiles';
    scene.add(mesh);
    this._mesh = mesh;

    this._x = new Float32Array(PROJECTILE_CAP);
    this._y = new Float32Array(PROJECTILE_CAP);
    this._z = new Float32Array(PROJECTILE_CAP);
    // Unit direction of travel, fixed for the projectile's whole life (no
    // gravity/homing) — kept separate from speed so the per-frame segment
    // length can change if `dt` varies without re-normalizing anything.
    this._dirX = new Float32Array(PROJECTILE_CAP);
    this._dirY = new Float32Array(PROJECTILE_CAP);
    this._dirZ = new Float32Array(PROJECTILE_CAP);
    this._speed = new Float32Array(PROJECTILE_CAP);
    this._dmg = new Float32Array(PROJECTILE_CAP);
    this._splash = new Float32Array(PROJECTILE_CAP);
    this._splashDmg = new Float32Array(PROJECTILE_CAP);
    this._maxDist = new Float32Array(PROJECTILE_CAP);
    this._traveled = new Float32Array(PROJECTILE_CAP);
    this._sound = new Array(PROJECTILE_CAP).fill(FALLBACK_SOUND);
    this._active = new Uint8Array(PROJECTILE_CAP);

    /** @type {number[]} Free-list of pool indices. */
    this._free = [];
    for (let i = PROJECTILE_CAP - 1; i >= 0; i--) {
      this._free.push(i);
      mesh.setMatrixAt(i, ZERO_SCALE);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this._dirty = false;
  }

  /**
   * Fires one projectile.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} dir Need not be pre-normalized.
   * @param {object} gun Weapon def with `projSpeed`, `splash`, `splashDmg`, `dmg`, `range`, `sound`.
   */
  launch(origin, dir, gun) {
    const idx = this._free.pop();
    if (idx === undefined) return; // Pool exhausted: drop the shot, never throw.

    const len = dir.length() || 1;
    this._x[idx] = origin.x;
    this._y[idx] = origin.y;
    this._z[idx] = origin.z;
    this._dirX[idx] = dir.x / len;
    this._dirY[idx] = dir.y / len;
    this._dirZ[idx] = dir.z / len;
    this._speed[idx] = gun.projSpeed;
    this._dmg[idx] = gun.dmg;
    this._splash[idx] = gun.splash;
    this._splashDmg[idx] = gun.splashDmg;
    this._maxDist[idx] = gun.range;
    this._traveled[idx] = 0;
    this._sound[idx] = gun.sound || FALLBACK_SOUND;
    this._active[idx] = 1;

    _matrix.makeTranslation(origin.x, origin.y, origin.z);
    this._mesh.setMatrixAt(idx, _matrix);
    this._dirty = true;
  }

  /**
   * Fixed-step update; registered via `game.registerSystem('projectiles', this)`.
   * @param {number} dt
   * @param {object} world See `docs/INTERFACES.md`'s `Game.world` shape.
   */
  update(dt, world) {
    for (let i = 0; i < PROJECTILE_CAP; i++) {
      if (!this._active[i]) continue;

      const step = this._speed[i] * dt;
      _origin.set(this._x[i], this._y[i], this._z[i]);
      _dir.set(this._dirX[i], this._dirY[i], this._dirZ[i]);

      const hit = this._nearestHit(_origin, _dir, step, world);
      if (hit) {
        this._detonate(hit.point, this._dmg[i], this._splash[i], this._splashDmg[i], this._sound[i], hit, world);
        this._freeProjectile(i);
        continue;
      }

      this._x[i] += this._dirX[i] * step;
      this._y[i] += this._dirY[i] * step;
      this._z[i] += this._dirZ[i] * step;
      this._traveled[i] += step;

      if (this._traveled[i] > this._maxDist[i]) {
        // Out of range: despawns quietly, same convention as
        // `Enemies#_updateProjectiles`'s own range-expiry (no detonation).
        this._freeProjectile(i);
        continue;
      }

      _origin.set(this._x[i], this._y[i], this._z[i]);
      _quat.setFromUnitVectors(_up, _dir);
      _matrix.compose(_origin, _quat, _scaleOne);
      this._mesh.setMatrixAt(i, _matrix);
      this._dirty = true;
    }

    if (this._dirty) {
      this._mesh.instanceMatrix.needsUpdate = true;
      this._dirty = false;
    }
  }

  /**
   * Nearest of {an enemy, the boss, the arena floor/wall} this frame's
   * travel segment (`origin` -> `origin + dir*maxDist`) touches, if any —
   * the "swept continuous test" described in this file's header comment.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} dir Normalized.
   * @param {number} maxDist
   * @param {object} world
   * @returns {{kind:'enemy'|'boss'|'arena', idx?:number, point:{x:number,y:number,z:number}, dist:number}|null}
   */
  _nearestHit(origin, dir, maxDist, world) {
    let best = null;

    const enemyHit = world.enemies?.raycast?.(origin, dir, maxDist, null) ?? null;
    if (enemyHit) best = { kind: 'enemy', idx: enemyHit.idx, point: enemyHit.point, dist: enemyHit.dist };

    const bossHit = world.boss?.alive ? world.boss.hitTest(origin, dir, maxDist) : null;
    if (bossHit && (!best || bossHit.dist < best.dist)) {
      best = { kind: 'boss', point: bossHit.point, dist: bossHit.dist };
    }

    const arenaHit = rayArenaHit(origin, dir, maxDist, this._cfg);
    if (arenaHit && (!best || arenaHit.dist < best.dist)) {
      best = { kind: 'arena', point: arenaHit, dist: arenaHit.dist };
    }

    return best;
  }

  /**
   * Applies splash (and, to whatever was directly struck, bonus direct
   * damage on top of it), spawns the explosion burst, and plays the
   * detonation sound.
   * @param {{x:number,y:number,z:number}} point
   * @param {number} dmg Direct-hit bonus damage.
   * @param {number} splash Splash radius.
   * @param {number} splashDmg Splash damage.
   * @param {string} sound
   * @param {{kind:'enemy'|'boss'|'arena', idx?:number}} hit
   * @param {object} world
   */
  _detonate(point, dmg, splash, splashDmg, sound, hit, world) {
    world.enemies?.damageRadius?.(point.x, point.z, splash, splashDmg, 'rpg7');
    if (hit.kind === 'enemy') {
      world.enemies?.damageAt?.(hit.idx, dmg, 'rpg7');
    }

    const boss = world.boss;
    if (boss?.alive) {
      const dx = boss.x - point.x;
      const dz = boss.z - point.z;
      if (dx * dx + dz * dz <= splash * splash) {
        boss.damage(splashDmg, 'rpg7');
      }
      if (hit.kind === 'boss') {
        boss.damage(dmg, 'rpg7');
      }
    }

    world.effects?.burst?.(point.x, point.y, point.z, EXPLOSION_COLOR, EXPLOSION_PARTICLE_COUNT);
    this._playThrottled(sound, world.time);
  }

  /**
   * @param {string} name
   * @param {number} time `world.time`.
   */
  _playThrottled(name, time) {
    const last = this._lastSoundAt[name] ?? -Infinity;
    if (time - last < EXPLOSION_SOUND_MIN_INTERVAL_S) return;
    this._lastSoundAt[name] = time;
    this._audio.play(name);
  }

  /**
   * @param {number} i
   */
  _freeProjectile(i) {
    this._active[i] = 0;
    this._free.push(i);
    this._mesh.setMatrixAt(i, ZERO_SCALE);
    this._dirty = true;
  }

  dispose() {
    this._mesh.geometry.dispose();
    this._mesh.material.dispose();
    this._mesh.removeFromParent();
  }
}
