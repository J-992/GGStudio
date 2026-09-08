// The enemy pool: a fixed-capacity struct-of-arrays sized `cfg.enemies.cap`,
// rendered as two voxel `InstancedMesh`es (one per model — `zed_1`/shambler,
// `zed_3`/spitter) plus one billboard slot per sprite-rendered enemy
// (`tungtung`, via `Billboards.js`), and a small `InstancedMesh` of spitter
// projectiles. AI is delegated to the pure `core/enemyBrain.js` per alive
// enemy per fixed step; this file owns the pool, the render sync, and the
// combat side effects (damage, particles, sounds, events).
//
// Deviation from the plan's constructor sketch: this class also takes an
// `audio` instance (`new Enemies(scene, assets, cfg, bus, billboards,
// audio)`) rather than routing every combat sound through `bus` listeners in
// `Game.js` — it needs direct, per-sound-throttled control (30 zombies must
// not spam `zombie-attack-1`), and `Game.js` doesn't otherwise need to know
// about individual melee/impact sounds. Documented in
// `docs/INTERFACES.md`'s "P3 additions" section.
import * as THREE from 'three';
import { gatePositions, clampToArena } from '../core/arenaGeometry.js';
import {
  chooseTarget, steer, attackReady, tickCooldown, hpFor,
  knockbackSpeed, decayKnockback, staggerFactor, knockbackTilt, knockbackIntensity,
} from '../core/enemyBrain.js';
import { bob, hitFlash, hitSquash } from '../core/spriteAnim.js';
import { turretHitDamage } from '../core/turretLogic.js';

const HP_DEATH_EPS = 1e-3;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const ZERO_SCALE = new THREE.Matrix4().makeScale(0, 0, 0);

const PROJECTILE_CAP = 64;
const PROJECTILE_HIT_RADIUS = 0.5;
const SPAWN_SPREAD = 1.4;
const LUNGE_SWING_S = 0.15;
const MELEE_SOUND_MIN_INTERVAL_S = 0.12;
const IMPACT_SOUND_MIN_INTERVAL_S = 0.15;
const DEATH_SOUND_MIN_INTERVAL_S = 0.05;

// Zed OBJ→GLB conversion assumed the model's forward is +Z (see
// `public/assets/manifest.json`'s `facingAxisNote`, unverified). Flip to
// `Math.PI` here if walking smalls look like they're facing backwards.
const FACING_FIX = 0;

const _matrix = new THREE.Matrix4();
const _place = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _quatYaw = new THREE.Quaternion();
const _quatLean = new THREE.Quaternion();
const _quatPitch = new THREE.Quaternion();
const _quatKick = new THREE.Quaternion();
const _kickAxis = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();

/**
 * Axis-aligned (Y) swept-cylinder ray test, radius `radius`, extending from
 * y=0 to y=`height`, centred at `(cx, cz)`.
 *
 * @param {THREE.Vector3} origin
 * @param {THREE.Vector3} dir Normalized.
 * @param {number} cx
 * @param {number} cz
 * @param {number} radius
 * @param {number} height
 * @param {number} maxDist
 * @returns {{dist:number, point:{x:number,y:number,z:number}}|null}
 */
function cylinderHit(origin, dir, cx, cz, radius, height, maxDist) {
  const ox = origin.x - cx;
  const oz = origin.z - cz;
  const a = dir.x * dir.x + dir.z * dir.z;
  const b = 2 * (ox * dir.x + oz * dir.z);
  const c = ox * ox + oz * oz - radius * radius;

  if (a < 1e-8) {
    // Ray parallel to the cylinder's axis: only meaningful if the ray's
    // origin already lies within the circle; a first-person hitscan gun is
    // never perfectly vertical in practice, so this is a defensive fallback.
    if (c > 0) return null;
    if (origin.y >= 0 && origin.y <= height) {
      return { dist: 0, point: { x: origin.x, y: origin.y, z: origin.z } };
    }
    return null;
  }

  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  const tA = (-b - sqrtDisc) / (2 * a);
  const tB = (-b + sqrtDisc) / (2 * a);
  const t0 = Math.min(tA, tB);
  const t1 = Math.max(tA, tB);

  for (const t of [t0, t1]) {
    if (t < 0 || t > maxDist) continue;
    const y = origin.y + dir.y * t;
    if (y >= 0 && y <= height) {
      return { dist: t, point: { x: origin.x + dir.x * t, y, z: origin.z + dir.z * t } };
    }
  }
  return null;
}

export class Enemies {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./assets.js').Assets} assets
   * @param {import('../core/types.js').GameConfig} cfg
   * @param {import('../core/events.js').EventBus} bus
   * @param {import('./Billboards.js').Billboards} billboards
   * @param {import('../platform/audio.js').Audio} audio
   */
  constructor(scene, assets, cfg, bus, billboards, audio) {
    this._scene = scene;
    this._assets = assets;
    this._cfg = cfg;
    this._bus = bus;
    this._billboards = billboards;
    this._audio = audio;

    this._gates = gatePositions(cfg);
    this._cap = cfg.enemies.cap;
    this._time = 0;
    this._worldRef = null;
    /** @type {Record<string, number>} */
    this._lastSoundAt = {};

    const cap = this._cap;
    this._type = new Array(cap).fill(null);
    this._x = new Float32Array(cap);
    this._z = new Float32Array(cap);
    this._yaw = new Float32Array(cap);
    this._hp = new Float32Array(cap);
    this._hpMax = new Float32Array(cap);
    this._alive = new Uint8Array(cap);
    this._cooldown = new Float32Array(cap);
    this._slowUntil = new Float32Array(cap);
    this._slowFactor = new Float32Array(cap).fill(1);
    this._targetKind = new Uint8Array(cap); // 0 = player, 1 = turret
    this._targetId = new Int32Array(cap).fill(-1);
    this._hitAt = new Float32Array(cap).fill(-Infinity);
    // Knockback velocity (m/s) left over from recent hits: added to the
    // enemy's own steering each step and decayed towards zero, and the
    // source of the lean/squash the body plays while it's being shoved.
    this._kickVX = new Float32Array(cap);
    this._kickVZ = new Float32Array(cap);
    this._walkPhase = new Float32Array(cap);
    /** Gait phase in STRIDES, advanced by `speed * stepsPerMetre * dt`. Kept
     *  separate from `_walkPhase` (raw seconds) because `spriteAnim.js#bob`
     *  applies speed itself — handing it a pre-scaled phase would scale it
     *  twice. */
    this._gaitPhase = new Float32Array(cap);
    this._gate = new Int32Array(cap).fill(-1);
    /** @type {(('voxel'|'sprite')|null)[]} */
    this._renderKind = new Array(cap).fill(null);
    this._slotId = new Int32Array(cap).fill(-1);
    // Size variant (small/normal/large, or whatever `cfg.enemies.variants`
    // defines): `_sizeMul` drives everything geometric — voxel/sprite render
    // scale and the hitbox (`_radiusOf`/`_hitHeightOf` below) — and is read
    // straight off `cfg.enemies.variants.types[variant].size` at spawn time.
    // `_variant` is kept alongside it only as the cache key into
    // `_variantDefCache` (see `_resolveTypeDef`); the two must always be set
    // together in `spawn()`.
    this._sizeMul = new Float32Array(cap).fill(1);
    /** @type {string[]} */
    this._variant = new Array(cap).fill('normal');

    // (type, variant) -> frozen EnemyTypeDef with hp/speed/knockbackScale
    // pre-multiplied by that variant's config. Built lazily, at most
    // `types x variants` entries (e.g. 3x3=9) for the life of this pool, so
    // that `update()`'s per-enemy per-fixed-step hot loop can index into it
    // instead of allocating a scaled copy of `typeDef` every tick — see
    // `_resolveTypeDef`.
    /** @type {Map<string, import('../core/types.js').EnemyTypeDef>} */
    this._variantDefCache = new Map();

    /** @type {number[]} Free-list of pool indices. */
    this._free = [];
    for (let i = cap - 1; i >= 0; i--) this._free.push(i);
    this._aliveCount = 0;

    /** @type {Record<string, {mesh:THREE.InstancedMesh, localMatrix:THREE.Matrix4, free:number[], dirty:boolean}>} */
    this._voxelModels = {};
    this._buildVoxelMesh('zed_1');
    this._buildVoxelMesh('zed_3');

    this._buildProjectiles();
  }

  /**
   * @param {string} modelName
   */
  _buildVoxelMesh(modelName) {
    const source = this._assets.instanceSource(modelName);
    const material = source.material.clone();
    const mesh = new THREE.InstancedMesh(source.geometry, material, this._cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = this._cap;
    mesh.name = `enemies-${modelName}`;
    this._scene.add(mesh);

    /** @type {number[]} */
    const free = [];
    for (let i = this._cap - 1; i >= 0; i--) {
      free.push(i);
      mesh.setMatrixAt(i, ZERO_SCALE);
    }
    mesh.instanceMatrix.needsUpdate = true;

    this._voxelModels[modelName] = { mesh, localMatrix: source.localMatrix, free, dirty: false };
  }

  _buildProjectiles() {
    const geometry = new THREE.SphereGeometry(0.15, 8, 6);
    const material = new THREE.MeshBasicMaterial({ color: 0x8fffa0 });
    const mesh = new THREE.InstancedMesh(geometry, material, PROJECTILE_CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = PROJECTILE_CAP;
    mesh.name = 'enemy-projectiles';
    this._scene.add(mesh);

    this._projMesh = mesh;
    this._projX = new Float32Array(PROJECTILE_CAP);
    this._projY = new Float32Array(PROJECTILE_CAP);
    this._projZ = new Float32Array(PROJECTILE_CAP);
    this._projVX = new Float32Array(PROJECTILE_CAP);
    this._projVZ = new Float32Array(PROJECTILE_CAP);
    this._projDmg = new Float32Array(PROJECTILE_CAP);
    this._projMaxDist = new Float32Array(PROJECTILE_CAP);
    this._projTraveled = new Float32Array(PROJECTILE_CAP);
    this._projActive = new Uint8Array(PROJECTILE_CAP);
    this._projFree = [];
    for (let i = PROJECTILE_CAP - 1; i >= 0; i--) {
      this._projFree.push(i);
      mesh.setMatrixAt(i, ZERO_SCALE);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this._projDirty = false;
  }

  /** @returns {number} Count of currently-alive enemies. */
  get alive() {
    return this._aliveCount;
  }

  /**
   * Resolves the `EnemyTypeDef` a given (type, variant) pair should use for
   * everything EXCEPT the hitbox/visual scale: `hp`, `speed` and
   * `knockbackScale` pre-multiplied by `cfg.enemies.variants.types[variant]`,
   * every other field inherited untouched from `cfg.enemies.types[typeName]`
   * (in particular `energy`, which must stay variant-invariant — see
   * `AGENTS.md`/`test/waves.test.js`'s wave-1 energy pin). Deliberately does
   * NOT touch `radius`/`hitHeight`: those scale per INSTANCE via `_sizeMul`
   * (`_radiusOf`/`_hitHeightOf` below), not per (type, variant), so they stay
   * off this object and are read straight from the base def there.
   *
   * Cached (frozen, built once per key) rather than computed per call: this
   * backs `_typeDefAt`, which `update()` calls once per alive enemy per fixed
   * step — allocating a scaled clone there would be 35-70 throwaway objects
   * a tick in the hottest loop in the game.
   *
   * @param {string} typeName
   * @param {string} variant
   * @returns {import('../core/types.js').EnemyTypeDef}
   */
  _resolveTypeDef(typeName, variant) {
    const key = `${typeName} ${variant}`;
    let def = this._variantDefCache.get(key);
    if (def) return def;

    const base = this._cfg.enemies.types[typeName];
    // No variants block configured yet, or an unrecognized variant key:
    // fall back to the base def unscaled rather than throwing, so this
    // mechanism is safe to land before the config/caller side exists.
    const variantCfg = this._cfg.enemies.variants?.types?.[variant];
    def = variantCfg
      ? Object.freeze({
          ...base,
          hp: base.hp * (variantCfg.hp ?? 1),
          speed: base.speed * (variantCfg.speed ?? 1),
          knockbackScale: (base.knockbackScale ?? 1) * (variantCfg.knockback ?? 1),
        })
      : base;
    this._variantDefCache.set(key, def);
    return def;
  }

  /**
   * @param {number} i Pool index.
   * @returns {import('../core/types.js').EnemyTypeDef} This enemy's
   *   variant-adjusted type def — see `_resolveTypeDef`.
   */
  _typeDefAt(i) {
    return this._resolveTypeDef(this._type[i], this._variant[i]);
  }

  /** @param {number} i Pool index. @returns {number} Hitbox/arena-clamp radius, scaled by this enemy's size variant. */
  _radiusOf(i) {
    return this._typeDefAt(i).radius * this._sizeMul[i];
  }

  /** @param {number} i Pool index. @returns {number} Hitbox height, scaled by this enemy's size variant. */
  _hitHeightOf(i) {
    return this._typeDefAt(i).hitHeight * this._sizeMul[i];
  }

  /**
   * @param {string} typeName Key into `cfg.enemies.types`.
   * @param {number} gateId Arena gate id (already resolved from the wave's active-gate pair — see `Game.js`).
   * @param {number} hpMul
   * @param {string} [variant] Key into `cfg.enemies.variants.types` (e.g.
   *   'small'/'normal'/'large'); defaults to 'normal'. The roll is gameplay,
   *   not cosmetic, so — unlike the position jitter below — it is NOT decided
   *   in here with `Math.random()`: the caller passes it in, already drawn
   *   from the seeded `core/rng.js` stream, so a seed still reproduces a run.
   * @returns {number} Pool index, or -1 when at cap.
   */
  spawn(typeName, gateId, hpMul = 1, variant = 'normal') {
    const idx = this._free.pop();
    if (idx === undefined) return -1;

    const typeDef = this._resolveTypeDef(typeName, variant);
    const sizeMul = this._cfg.enemies.variants?.types?.[variant]?.size ?? 1;
    const gate = this._gates.find((g) => g.id === gateId) ?? this._gates[gateId % this._gates.length];
    // Cosmetic-only spawn jitter — per AGENTS.md this must not share the
    // seeded gameplay rng stream, so plain Math.random() is correct here.
    const x = gate.x + (Math.random() - 0.5) * SPAWN_SPREAD;
    const z = gate.z + (Math.random() - 0.5) * SPAWN_SPREAD;

    this._type[idx] = typeName;
    this._variant[idx] = variant;
    this._sizeMul[idx] = sizeMul;
    this._x[idx] = x;
    this._z[idx] = z;
    this._yaw[idx] = 0;
    this._hpMax[idx] = hpFor(typeDef, hpMul);
    this._hp[idx] = this._hpMax[idx];
    this._alive[idx] = 1;
    this._cooldown[idx] = 0;
    this._slowUntil[idx] = 0;
    this._slowFactor[idx] = 1;
    this._targetKind[idx] = 0;
    this._targetId[idx] = -1;
    this._hitAt[idx] = -Infinity;
    this._kickVX[idx] = 0;
    this._kickVZ[idx] = 0;
    this._walkPhase[idx] = 0;
    // Deliberately random, and deliberately NOT from the seeded stream: this
    // is cosmetic. Starting every enemy at 0 put the whole crowd in lockstep,
    // which reads as one sliding object rather than thirty-five walkers.
    this._gaitPhase[idx] = Math.random();
    this._gate[idx] = gateId;
    this._renderKind[idx] = typeDef.render;
    this._slotId[idx] = -1;

    if (typeDef.render === 'voxel') {
      const pool = this._voxelModels[typeDef.model];
      const slot = pool.free.pop();
      this._slotId[idx] = slot === undefined ? -1 : slot;
    } else if (typeDef.render === 'sprite') {
      // Billboards stores height per SLOT, not per type (see the module
      // header note), so a bigger/smaller variant is just a scaled height
      // argument here — the sprite and its blob shadow both follow.
      this._slotId[idx] = this._billboards.alloc(typeDef.sprite, typeDef.height * sizeMul);
    }

    this._aliveCount++;
    this._bus.emit('enemy:spawned', { idx, type: typeName, gate: gateId });
    return idx;
  }

  /**
   * @param {number} dt
   * @param {object} world See `docs/INTERFACES.md`'s `Game.world` shape.
   */
  update(dt, world) {
    this._worldRef = world;
    this._time = world.time;
    const cfg = this._cfg;
    const player = world.player;
    const turretList = world.turrets?.list?.() ?? [];

    // Snapshot alive positions once for O(n) separation lookups instead of
    // O(n) full-pool scans per enemy.
    const alivePositions = [];
    for (let i = 0; i < this._cap; i++) {
      if (this._alive[i]) alivePositions.push({ idx: i, x: this._x[i], z: this._z[i] });
    }
    const sepRadius = cfg.enemies.separationRadius;
    const sepRadius2 = sepRadius * sepRadius;

    for (let i = 0; i < this._cap; i++) {
      if (!this._alive[i]) continue;
      const typeName = this._type[i];
      // Variant-adjusted (hp/speed/knockbackScale) — see `_resolveTypeDef`.
      // `radius`/`hitHeight` are NOT on this object; use `_radiusOf`/
      // `_hitHeightOf` for those.
      const typeDef = this._typeDefAt(i);

      const enemySnapshot = { x: this._x[i], z: this._z[i], type: typeName, cooldown: this._cooldown[i] };
      const target = chooseTarget(enemySnapshot, { x: player.x, z: player.z }, turretList, cfg);
      this._targetKind[i] = target.kind === 'player' ? 0 : 1;
      this._targetId[i] = target.id ?? -1;

      const neighbours = [];
      for (const n of alivePositions) {
        if (n.idx === i) continue;
        const dx = n.x - this._x[i];
        const dz = n.z - this._z[i];
        if (dx * dx + dz * dz < sepRadius2) neighbours.push(n);
      }

      const { vx, vz } = steer(enemySnapshot, target, neighbours, cfg, typeDef);
      const speedMul = this._time < this._slowUntil[i] ? this._slowFactor[i] : 1;
      const moving = Math.abs(vx) > 1e-4 || Math.abs(vz) > 1e-4;

      // A hit shoves the body: its own steering is damped for as long as the
      // knockback lasts (the stagger) and the leftover impulse is added on
      // top, so the enemy visibly loses ground instead of walking through it.
      const kickSpeed = Math.hypot(this._kickVX[i], this._kickVZ[i]);
      const stagger = kickSpeed > 0 ? staggerFactor(kickSpeed, typeDef, cfg) : 1;

      const nx = this._x[i] + (vx * speedMul * stagger + this._kickVX[i]) * dt;
      const nz = this._z[i] + (vz * speedMul * stagger + this._kickVZ[i]) * dt;
      const clamped = clampToArena(nx, nz, cfg.arena.radius - this._radiusOf(i));
      this._x[i] = clamped.x;
      this._z[i] = clamped.z;

      if (kickSpeed > 0) {
        const decayed = decayKnockback(this._kickVX[i], this._kickVZ[i], dt, cfg);
        this._kickVX[i] = decayed.vx;
        this._kickVZ[i] = decayed.vz;
      }

      if (moving) {
        // Matches Player.js/arenaGeometry's yaw convention: yaw 0 = -z,
        // increasing clockwise, i.e. forward = (sin(yaw), 0, -cos(yaw)).
        this._yaw[i] = Math.atan2(vx, -vz);
        this._walkPhase[i] += dt;
        // Cadence follows how fast this thing is really travelling, so a
        // sprinting spitter visibly out-steps a shambler. The old flat
        // `+= dt` gave every enemy the same 1 Hz regardless of speed.
        this._gaitPhase[i] += Math.hypot(vx, vz) * this._cfg.enemies.gait.stepsPerMetre * dt;
      }

      this._cooldown[i] = tickCooldown({ cooldown: this._cooldown[i] }, dt);

      const distToTarget = Math.hypot(target.x - this._x[i], target.z - this._z[i]);
      if (attackReady({ cooldown: this._cooldown[i] }, distToTarget, typeDef)) {
        this._cooldown[i] = typeDef.cooldown;
        this._performAttack(i, typeDef, target, world);
      }

      if (this._renderKind[i] === 'voxel') {
        this._updateVoxelInstance(i, typeDef, moving);
      } else if (this._renderKind[i] === 'sprite') {
        this._updateBillboardInstance(i, typeDef, moving);
      }
    }

    this._updateProjectiles(dt, world);

    for (const modelName of Object.keys(this._voxelModels)) {
      const pool = this._voxelModels[modelName];
      if (pool.dirty) {
        pool.mesh.instanceMatrix.needsUpdate = true;
        pool.dirty = false;
      }
    }
    if (this._projDirty) {
      this._projMesh.instanceMatrix.needsUpdate = true;
      this._projDirty = false;
    }
    this._billboards.update(dt);
  }

  /**
   * @param {number} i
   * @param {import('../core/types.js').EnemyTypeDef} typeDef
   * @param {boolean} moving
   */
  _updateVoxelInstance(i, typeDef, moving) {
    const pool = this._voxelModels[typeDef.model];
    const slot = this._slotId[i];
    if (slot < 0) return;

    // One stride is two footfalls, so the vertical bob and the heel-strike
    // compression run at TWICE the stride frequency while the roll and the
    // lateral sway run once per stride. Getting those two rates different is
    // most of what separates a walk from a hum: matched rates read as a body
    // vibrating, mismatched rates read as weight moving foot to foot.
    const gait = this._cfg.enemies.gait;
    const stride = this._gaitPhase[i] * 2 * Math.PI;
    const step = stride * 2;
    const bobY = moving ? Math.sin(step) * gait.bobAmp : 0;
    const roll = moving ? Math.sin(stride) * gait.rollRad : 0;
    const sway = moving ? Math.cos(stride) * gait.swayM : 0;
    // Compression on the way down only — a heel taking weight, not a bounce.
    const heel = moving ? Math.max(0, -Math.sin(step)) * gait.squashAmp : 0;

    const kickX = this._kickVX[i];
    const kickZ = this._kickVZ[i];
    const kickSpeed = Math.hypot(kickX, kickZ);
    const hit = kickSpeed > 0 ? knockbackIntensity(kickSpeed, typeDef, this._cfg) : 0;
    const squash = hit > 0 ? hitSquash(hit, this._cfg) : null;

    // Sway is lateral, so it goes along the body's right axis rather than a
    // world one — otherwise a zombie walking north and one walking east would
    // shift in the same direction.
    const yaw = this._yaw[i];
    _pos.set(
      this._x[i] + Math.cos(yaw) * sway,
      bobY,
      this._z[i] + Math.sin(yaw) * sway,
    );
    _quatYaw.setFromAxisAngle(Y_AXIS, yaw + FACING_FIX);
    _quatLean.setFromAxisAngle(Z_AXIS, roll);
    // A constant forward lean while moving: a walker leads with its chest.
    // Applied in the body's own frame, after yaw, so it leans along the
    // direction of travel whichever way that points.
    _quatPitch.setFromAxisAngle(X_AXIS, moving ? -gait.leanFwdRad : 0);
    _quat.copy(_quatYaw).multiply(_quatLean).multiply(_quatPitch);

    if (hit > 0) {
      // Tilt the body's top *towards* the push, around the world axis
      // perpendicular to it — the classic "knocked off balance" lean. World
      // space, so it pre-multiplies the yaw/walk-lean rotation rather than
      // rotating with the model.
      _kickAxis.set(kickZ / kickSpeed, 0, -kickX / kickSpeed);
      _quatKick.setFromAxisAngle(_kickAxis, knockbackTilt(kickSpeed, typeDef, this._cfg));
      _quat.premultiply(_quatKick);
    }

    // Size variant folded straight into the render scale (squashed or not)
    // rather than kept as a separate branch — `_scale` is always the matrix
    // that gets composed now, never the old shared `_scaleOne` constant.
    if (squash) _scale.set(squash.sx, squash.sy, squash.sx);
    else _scale.set(1, 1, 1);
    // Heel strike: a brief vertical compression, widening slightly as it
    // squats so the volume reads as roughly conserved. Multiplied into
    // whatever the hit-squash left, since a body can be shoved mid-step.
    if (heel > 0) {
      _scale.y *= 1 - heel;
      _scale.x *= 1 + heel * 0.5;
      _scale.z *= 1 + heel * 0.5;
    }
    _scale.multiplyScalar(this._sizeMul[i]);
    _place.compose(_pos, _quat, _scale);
    _matrix.multiplyMatrices(_place, pool.localMatrix);
    pool.mesh.setMatrixAt(slot, _matrix);
    pool.dirty = true;
  }

  /**
   * @param {number} i
   * @param {import('../core/types.js').EnemyTypeDef} typeDef
   * @param {boolean} moving
   */
  _updateBillboardInstance(i, typeDef, moving) {
    const slot = this._slotId[i];
    if (slot < 0) return;
    const anim = bob(this._walkPhase[i], moving ? typeDef.speed : 0, this._cfg);
    const kickSpeed = Math.hypot(this._kickVX[i], this._kickVZ[i]);
    if (kickSpeed > 0) {
      // Billboards carry no rotation, so a sprite plays the hit as the
      // knockback slide (already in `_x`/`_z`) plus this flinch squash.
      const squash = hitSquash(knockbackIntensity(kickSpeed, typeDef, this._cfg), this._cfg);
      anim.sx *= squash.sx;
      anim.sy *= squash.sy;
    }
    const flash = hitFlash(this._time - this._hitAt[i], this._cfg);
    this._billboards.set(slot, this._x[i], this._z[i], anim, flash);
  }

  /**
   * @param {number} i
   * @param {import('../core/types.js').EnemyTypeDef} typeDef
   * @param {{kind:'player'|'turret', id:number|null, x:number, z:number}} target
   * @param {object} world
   */
  _performAttack(i, typeDef, target, world) {
    if (typeDef.kind === 'melee') {
      if (target.kind === 'player') {
        world.player.takeDamage(typeDef.dmg);
      } else {
        world.turrets?.damage?.(target.id, typeDef.dmg);
      }
      this._playThrottled('zombie-attack-1', MELEE_SOUND_MIN_INTERVAL_S);

      if (typeDef.lunge) {
        const dx = target.x - this._x[i];
        const dz = target.z - this._z[i];
        const d = Math.hypot(dx, dz);
        if (d > 1e-4) {
          const step = Math.min(typeDef.lunge * LUNGE_SWING_S, Math.max(0, d - this._radiusOf(i)));
          this._x[i] += (dx / d) * step;
          this._z[i] += (dz / d) * step;
        }
      }
    } else {
      this._spawnProjectile(i, typeDef, target);
    }
  }

  /**
   * @param {number} i
   * @param {import('../core/types.js').EnemyTypeDef} typeDef
   * @param {{x:number, z:number}} target
   */
  _spawnProjectile(i, typeDef, target) {
    const idx = this._projFree.pop();
    if (idx === undefined) return; // pool exhausted: drop the shot, never throw.

    const dx = target.x - this._x[i];
    const dz = target.z - this._z[i];
    const d = Math.hypot(dx, dz) || 1;

    this._projX[idx] = this._x[i];
    this._projY[idx] = this._hitHeightOf(i) * 0.5;
    this._projZ[idx] = this._z[i];
    this._projVX[idx] = (dx / d) * typeDef.projSpeed;
    this._projVZ[idx] = (dz / d) * typeDef.projSpeed;
    this._projDmg[idx] = typeDef.dmg;
    this._projMaxDist[idx] = typeDef.range * 1.5; // margin: the target may have moved by the time the shot lands.
    this._projTraveled[idx] = 0;
    this._projActive[idx] = 1;
  }

  /**
   * @param {number} dt
   * @param {object} world
   */
  _updateProjectiles(dt, world) {
    const turretList = world.turrets?.list?.() ?? [];
    for (let i = 0; i < PROJECTILE_CAP; i++) {
      if (!this._projActive[i]) continue;

      const stepX = this._projVX[i] * dt;
      const stepZ = this._projVZ[i] * dt;
      this._projX[i] += stepX;
      this._projZ[i] += stepZ;
      this._projTraveled[i] += Math.hypot(stepX, stepZ);

      const dxp = world.player.x - this._projX[i];
      const dzp = world.player.z - this._projZ[i];
      if (Math.hypot(dxp, dzp) < PROJECTILE_HIT_RADIUS) {
        world.player.takeDamage(this._projDmg[i]);
        this._playThrottled('impact-heavy', IMPACT_SOUND_MIN_INTERVAL_S);
        this._freeProjectile(i);
        continue;
      }

      let hitTurret = false;
      for (const t of turretList) {
        if (t.alive === false) continue;
        const dxt = t.x - this._projX[i];
        const dzt = t.z - this._projZ[i];
        if (Math.hypot(dxt, dzt) < PROJECTILE_HIT_RADIUS) {
          world.turrets?.damage?.(t.slotId ?? t.id, this._projDmg[i]);
          hitTurret = true;
          break;
        }
      }
      if (hitTurret) {
        this._freeProjectile(i);
        continue;
      }

      if (this._projTraveled[i] > this._projMaxDist[i]) {
        this._freeProjectile(i);
        continue;
      }

      _matrix.makeTranslation(this._projX[i], this._projY[i], this._projZ[i]);
      this._projMesh.setMatrixAt(i, _matrix);
      this._projDirty = true;
    }
  }

  /**
   * @param {number} i
   */
  _freeProjectile(i) {
    this._projActive[i] = 0;
    this._projFree.push(i);
    this._projMesh.setMatrixAt(i, ZERO_SCALE);
    this._projDirty = true;
  }

  /**
   * @param {number} idx
   * @param {number} dmg
   * @param {string} source Free-form origin tag (`'player'`, a turret type name, ...). `'turret'` is the one tag with a rule attached: the hit is capped by `turretHitDamage` so turrets never one-shot (knockback included — a capped hit shoves proportionally less).
   * @param {{x:number, z:number}} [dir] Push direction (need not be normalized). Omitted/zero pushes the enemy straight backwards from its own facing.
   * @returns {boolean} Whether this hit killed the enemy.
   */
  damageAt(idx, dmg, source, dir) {
    if (idx < 0 || !this._alive[idx]) return false;
    const applied = source === 'turret' ? turretHitDamage(dmg, this._hpMax[idx], this._cfg) : dmg;
    this._hp[idx] -= applied;
    this._hitAt[idx] = this._time;
    this._applyKnockback(idx, applied, dir);
    // `_hp` is a Float32Array, so a capped turret hit — exactly half of a
    // wave-scaled `hpMax` like 33.0 — can leave a ~1e-6 sliver behind on the
    // shot that should have finished the job. Anything under this threshold
    // is dead, not a third-shot enemy.
    if (this._hp[idx] <= HP_DEATH_EPS) {
      this._kill(idx, source);
      return true;
    }
    return false;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} r
   * @param {number} dmg
   * @param {string} source
   * @returns {number} Kills caused by this splash.
   */
  damageRadius(x, z, r, dmg, source) {
    let kills = 0;
    const r2 = r * r;
    for (let i = 0; i < this._cap; i++) {
      if (!this._alive[i]) continue;
      const dx = this._x[i] - x;
      const dz = this._z[i] - z;
      // A blast throws every body radially outwards from where it landed.
      if (dx * dx + dz * dz <= r2 && this.damageAt(i, dmg, source, { x: dx, z: dz })) kills++;
    }
    return kills;
  }

  /**
   * Damage-free shove — the revive push in `Game.js` uses it to physically
   * clear the ring of enemies around the player.
   *
   * @param {number} idx
   * @param {{x:number, z:number}} dir Need not be normalized; zero shoves the enemy backwards from its own facing.
   * @param {number} speed Impulse in m/s, before the type's `knockbackScale` cap.
   */
  knockback(idx, dir, speed) {
    if (idx < 0 || !this._alive[idx]) return;
    this._applyKnockback(idx, speed, dir, true);
  }

  /**
   * Adds one hit's impulse to whatever knockback is already in flight,
   * clamped so rapid fire staggers an enemy without launching it.
   *
   * @param {number} idx
   * @param {number} amount Damage dealt, or — with `rawSpeed` — an impulse in m/s.
   * @param {{x:number, z:number}} [dir]
   * @param {boolean} [rawSpeed] Treat `amount` as a speed rather than damage.
   */
  _applyKnockback(idx, amount, dir, rawSpeed = false) {
    // Variant-adjusted `knockbackScale` (see `_resolveTypeDef`): a big/tanky
    // variant is configured with a lower `knockback` multiplier so it isn't
    // flung across the arena by a hit sized for the normal variant.
    const typeDef = this._typeDefAt(idx);
    const impulse = rawSpeed
      ? Math.max(0, amount) * (typeDef.knockbackScale ?? 1)
      : knockbackSpeed(amount, typeDef, this._cfg);
    if (impulse <= 0) return;

    let dx = dir?.x ?? 0;
    let dz = dir?.z ?? 0;
    let d = Math.hypot(dx, dz);
    if (d < 1e-4) {
      // No direction from the hit (or the blast landed dead centre): shove
      // the enemy backwards along its own facing — yaw 0 = -z, so forward is
      // (sin, -cos) and back is (-sin, cos).
      dx = -Math.sin(this._yaw[idx]);
      dz = Math.cos(this._yaw[idx]);
      d = 1;
    }

    const vx = this._kickVX[idx] + (dx / d) * impulse;
    const vz = this._kickVZ[idx] + (dz / d) * impulse;
    const speed = Math.hypot(vx, vz);
    const max = this._cfg.enemies.knockback.maxSpeed * (typeDef.knockbackScale ?? 1);
    const clampMul = speed > max ? max / speed : 1;
    this._kickVX[idx] = vx * clampMul;
    this._kickVZ[idx] = vz * clampMul;
  }

  /**
   * @param {number} idx
   * @param {number} factor Speed multiplier while slowed (e.g. 0.5 = half speed).
   * @param {number} durS
   */
  applySlow(idx, factor, durS) {
    if (idx < 0 || !this._alive[idx]) return;
    this._slowFactor[idx] = factor;
    this._slowUntil[idx] = this._time + durS;
  }

  /**
   * @param {number} idx
   * @param {string} source
   */
  _kill(idx, source) {
    const typeName = this._type[idx];
    const typeDef = this._typeDefAt(idx);
    const x = this._x[idx];
    const z = this._z[idx];
    const y = this._hitHeightOf(idx) * 0.5;

    this._alive[idx] = 0;
    this._aliveCount--;

    if (this._renderKind[idx] === 'voxel') {
      const pool = this._voxelModels[typeDef.model];
      const slot = this._slotId[idx];
      if (slot >= 0) {
        pool.free.push(slot);
        pool.mesh.setMatrixAt(slot, ZERO_SCALE);
        pool.dirty = true;
      }
    } else if (this._renderKind[idx] === 'sprite') {
      if (this._slotId[idx] >= 0) this._billboards.free(this._slotId[idx]);
    }
    this._slotId[idx] = -1;
    this._renderKind[idx] = null;
    this._type[idx] = null;
    this._free.push(idx);

    this._worldRef?.effects?.burst(x, y, z, 0xff5533, 10);
    this._playThrottled('zombie-death-1', DEATH_SOUND_MIN_INTERVAL_S);
    this._bus.emit('enemy:killed', { idx, type: typeName, x, z, source, energy: typeDef.energy });
  }

  /**
   * @param {string} name
   * @param {number} minIntervalS
   */
  _playThrottled(name, minIntervalS) {
    const last = this._lastSoundAt[name] ?? -Infinity;
    if (this._time - last < minIntervalS) return;
    this._lastSoundAt[name] = this._time;
    this._audio.play(name);
  }

  /**
   * Cylinder hit test (`_radiusOf`/`_hitHeightOf` — the type's base
   * `radius`/`hitHeight` scaled by that enemy's size variant) per alive
   * enemy, nearest hit wins. This is the player's hitbox against enemies, so
   * a large variant is deliberately easier to hit and a small one harder.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} dir Normalized.
   * @param {number} maxDist
   * @param {Set<number>|null} [skip] Pool indices to ignore — how a piercing
   *   weapon walks past the enemies it has already hit on this shot.
   * @returns {{idx:number, point:{x:number,y:number,z:number}, dist:number}|null}
   */
  raycast(origin, dir, maxDist, skip = null) {
    let best = null;
    let bestDist = maxDist;
    for (let i = 0; i < this._cap; i++) {
      if (!this._alive[i]) continue;
      if (skip?.has(i)) continue;
      const hit = cylinderHit(origin, dir, this._x[i], this._z[i], this._radiusOf(i), this._hitHeightOf(i), bestDist);
      if (hit && hit.dist < bestDist) {
        bestDist = hit.dist;
        best = { idx: i, point: hit.point, dist: hit.dist };
      }
    }
    return best;
  }

  /**
   * @returns {{x:number,y:number,z:number,radius:number}[]} Centred at half `hitHeight` — for `player.aimTarget`.
   */
  targets() {
    const out = [];
    for (let i = 0; i < this._cap; i++) {
      if (!this._alive[i]) continue;
      out.push({ x: this._x[i], y: this._hitHeightOf(i) * 0.5, z: this._z[i], radius: this._radiusOf(i) });
    }
    return out;
  }

  /**
   * @returns {{idx:number,x:number,y:number,z:number,radius:number}[]} For turret targeting — `y` is centred at half `hitHeight`, same convention as `targets()`.
   */
  positions() {
    const out = [];
    for (let i = 0; i < this._cap; i++) {
      if (!this._alive[i]) continue;
      out.push({ idx: i, x: this._x[i], y: this._hitHeightOf(i) * 0.5, z: this._z[i], radius: this._radiusOf(i) });
    }
    return out;
  }

  /**
   * @param {(idx:number) => void} fn
   */
  forEachAlive(fn) {
    for (let i = 0; i < this._cap; i++) {
      if (this._alive[i]) fn(i);
    }
  }

  /** Kills/hides every alive enemy and in-flight projectile — used on a fresh run. */
  clear() {
    for (let i = 0; i < this._cap; i++) {
      if (!this._alive[i]) continue;
      this._alive[i] = 0;
      if (this._renderKind[i] === 'sprite' && this._slotId[i] >= 0) {
        this._billboards.free(this._slotId[i]);
      }
      this._slotId[i] = -1;
      this._renderKind[i] = null;
      this._type[i] = null;
      this._kickVX[i] = 0;
      this._kickVZ[i] = 0;
    }
    this._aliveCount = 0;
    this._free = [];
    for (let i = this._cap - 1; i >= 0; i--) this._free.push(i);

    for (const modelName of Object.keys(this._voxelModels)) {
      const pool = this._voxelModels[modelName];
      pool.free = [];
      for (let i = this._cap - 1; i >= 0; i--) {
        pool.free.push(i);
        pool.mesh.setMatrixAt(i, ZERO_SCALE);
      }
      pool.mesh.instanceMatrix.needsUpdate = true;
    }

    for (let i = 0; i < PROJECTILE_CAP; i++) {
      if (this._projActive[i]) this._freeProjectile(i);
    }
    if (this._projDirty) {
      this._projMesh.instanceMatrix.needsUpdate = true;
      this._projDirty = false;
    }
  }

  dispose() {
    for (const modelName of Object.keys(this._voxelModels)) {
      const pool = this._voxelModels[modelName];
      pool.mesh.material.dispose();
      pool.mesh.removeFromParent();
    }
    this._projMesh.geometry.dispose();
    this._projMesh.material.dispose();
    this._projMesh.removeFromParent();
  }
}
