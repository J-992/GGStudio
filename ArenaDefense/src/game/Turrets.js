// Placed turrets: 3D visuals (a prop-mesh base + a procedural/prop head, level
// pips, an hp bar) plus the per-frame targeting/firing loop. Pure math
// (stats, costs, targeting, cadence) lives in `core/turretLogic.js`; this
// file only owns the three.js objects and the mutable `TurretRecord`s (see
// `core/types.js`) that both this file and `core/turretLogic.js` read/write.
//
// Registered as a system via `game.registerSystem('turrets', turrets)` by
// `buildPhase.js#installBuildPhase` — `update(dt, world)` then runs once per
// fixed step alongside every other system, targeting off
// `world.enemies?.positions()` and dealing damage back through
// `world.enemies.damageAt/damageRadius` + `applySlow` (see the "P4
// additions" section of `docs/INTERFACES.md` for the exact shape this file
// expects from P3's `Enemies`, which had not landed at the time this file was
// written).
import * as THREE from 'three';
import { slotPositions } from '../core/arenaGeometry.js';
import { statsFor, pickTarget, fireReady } from '../core/turretLogic.js';

/**
 * Real, measured world-space heights of the two base prop meshes (read
 * directly out of `public/assets/models/props.glb` via `@gltf-transform` —
 * `manifest.json` itself does not record a height for these two meshes, only
 * for the zed voxel models). `AmmoBox_5` decomposes to ~0.50m tall, plus an
 * additional `EXTRA_SCALE` per base name below to bring both bases into the
 * same "reads as roughly a metre" band the brief asks for, since 0.50m and
 * 1.10m otherwise look mismatched sitting side by side on the same ring.
 * @type {Record<string, number>}
 */
const BASE_EXTRA_SCALE = {
  AmmoBox_5: 1.8, // ~0.50m authored -> ~0.90m
  AttachedBoxes: 0.9, // ~1.10m authored -> ~0.99m
};

const GREY_COLOR = new THREE.Color(0x555555);
const PIP_COLOR = 0xffffff;
const HP_BAR_WIDTH = 0.9;
const HP_BAR_HEIGHT = 0.09;

/** Per-sound-name minimum interval so many turrets of one type firing in the
 * same fixed step don't turn into a wall of noise. Keyed by the sound name
 * actually passed to `audio.play`, not by turret type, since gun/tesla share
 * some fallback sounds. */
const SOUND_MIN_INTERVAL_S = {
  'turret-shot-1': 0.06,
  'explosion-metal': 0.12,
  'mechanical-clunk': 0.08,
};

const _target = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _v1 = new THREE.Vector3();

/**
 * @param {number} hex
 * @returns {THREE.Color}
 */
function color(hex) {
  return new THREE.Color(hex);
}

export class Turrets {
  /**
   * @param {import('three').Scene} scene
   * @param {import('./assets.js').Assets} assets
   * @param {import('../core/types.js').GameConfig} cfg
   * @param {import('../core/events.js').EventBus} bus
   * @param {import('./Effects.js').Effects} effects
   * @param {import('../platform/audio.js').Audio} audio
   */
  constructor(scene, assets, cfg, bus, effects, audio) {
    this._scene = scene;
    this._assets = assets;
    this._cfg = cfg;
    this._bus = bus;
    this._effects = effects;
    this._audio = audio;

    /** @type {Map<number, import('../core/arenaGeometry.js').slotPositions extends () => infer R ? (R extends (infer E)[] ? E : never) : never>} */
    this._slotsById = new Map(slotPositions(cfg).map((s) => [s.id, s]));

    /** @type {Map<number, import('../core/types.js').TurretRecord>} */
    this._records = new Map();
    /** @type {Map<number, object>} slotId -> visual bookkeeping */
    this._visuals = new Map();
    /** @type {Map<string, number>} sound name -> world.time it last played */
    this._lastSoundAt = new Map();
  }

  /**
   * @param {number} slotId
   * @param {string} type
   * @returns {import('../core/types.js').TurretRecord}
   */
  place(slotId, type) {
    if (this._records.has(slotId)) {
      throw new Error(`Turrets.place: slot ${slotId} is occupied`);
    }
    const slot = this._slotsById.get(slotId);
    if (!slot) throw new Error(`Turrets.place: unknown slot ${slotId}`);
    if (!this._cfg.turrets.types[type]) throw new Error(`Turrets.place: unknown turret type "${type}"`);

    const hpMax = this._cfg.turrets.hp;
    /** @type {import('../core/types.js').TurretRecord} */
    const rec = {
      slotId, type, level: 0, hp: hpMax, hpMax, x: slot.x, z: slot.z, alive: true, cooldown: 0,
    };
    this._records.set(slotId, rec);
    this._visuals.set(slotId, this._buildVisual(rec));
    this._bus.emit('turret:placed', { slotId, type });
    return rec;
  }

  /**
   * @param {number} slotId
   * @returns {import('../core/types.js').TurretRecord}
   */
  upgrade(slotId) {
    const rec = this._requireAlive(slotId, 'upgrade');
    const def = this._cfg.turrets.types[rec.type];
    if (rec.level >= def.levels.length - 1) {
      throw new Error(`Turrets.upgrade: slot ${slotId} is already at max level`);
    }
    rec.level += 1;
    this._refreshPips(slotId, rec);
    this._bus.emit('turret:upgraded', { slotId, level: rec.level });
    return rec;
  }

  /**
   * @param {number} slotId
   * @returns {import('../core/types.js').TurretRecord}
   */
  repair(slotId) {
    const rec = this._requireAlive(slotId, 'repair');
    rec.hp = rec.hpMax;
    this._refreshHpBar(slotId, rec);
    this._bus.emit('turret:repaired', { slotId });
    return rec;
  }

  /**
   * @param {number} slotId
   * @param {number} n
   */
  damage(slotId, n) {
    const rec = this._records.get(slotId);
    if (!rec || !rec.alive) return;
    rec.hp = Math.max(0, rec.hp - n);
    this._refreshHpBar(slotId, rec);
    if (rec.hp <= 0) {
      rec.alive = false;
      this._greyOut(slotId);
      this._bus.emit('turret:destroyed', { slotId });
    }
  }

  /**
   * @param {number} slotId
   * @returns {import('../core/types.js').TurretRecord|null}
   */
  get(slotId) {
    return this._records.get(slotId) ?? null;
  }

  /**
   * Every tracked turret record — alive and destroyed (wreck) alike, so
   * `Game#getSnapshot()` -> `ui/BuildOverlay.js` can render a destroyed slot
   * as its own state ("grey X") rather than as simply empty. Code that needs
   * only the turrets that should target/fire/take damage (this file's own
   * `update()`) filters `.alive` itself instead of relying on this list.
   * @returns {import('../core/types.js').TurretRecord[]}
   */
  list() {
    return [...this._records.values()];
  }

  /**
   * Removes a destroyed turret's record and visuals, freeing its slot for a
   * new placement. A no-op if the slot is empty or still alive (never call
   * this to "delete" a working turret).
   * @param {number} slotId
   */
  clearWreck(slotId) {
    const rec = this._records.get(slotId);
    if (!rec || rec.alive) return;
    this._disposeVisual(slotId);
    this._records.delete(slotId);
  }

  /**
   * @param {number} dt
   * @param {{ time: number, enemies: null | { positions(): {x:number,y:number,z:number,radius?:number}[], damageAt(idx:number, dmg:number, source:string): void, damageRadius(x:number, z:number, radius:number, dmg:number, source:string): void, applySlow(idx:number, amount:number, durationS:number): void } }} world
   */
  update(dt, world) {
    const enemies = world.enemies?.positions?.() ?? [];
    for (const rec of this._records.values()) {
      if (!rec.alive) continue;
      const stats = statsFor(rec.type, rec.level, this._cfg);
      const idx = pickTarget(rec, enemies, stats);
      this._faceTarget(rec, idx, enemies);
      if (idx < 0) continue;
      if (!fireReady(rec, dt, stats)) continue;
      this._fire(rec, stats, idx, enemies, world);
    }
  }

  /** Removes every turret (records + visuals). Used on a full reset. */
  clear() {
    for (const slotId of [...this._records.keys()]) {
      this._disposeVisual(slotId);
    }
    this._records.clear();
  }

  // ---- internals ----------------------------------------------------

  /**
   * @param {number} slotId
   * @param {string} verb
   * @returns {import('../core/types.js').TurretRecord}
   */
  _requireAlive(slotId, verb) {
    const rec = this._records.get(slotId);
    if (!rec || !rec.alive) throw new Error(`Turrets.${verb}: no live turret at slot ${slotId}`);
    return rec;
  }

  /**
   * @param {import('../core/types.js').TurretRecord} rec
   */
  _buildVisual(rec) {
    const def = this._cfg.turrets.types[rec.type];
    const group = new THREE.Group();
    group.position.set(rec.x, 0, rec.z);
    this._scene.add(group);

    // Geometries this file allocates itself (procedural heads, pips, hp bar)
    // and must dispose on `clearWreck`. Geometry that comes back from
    // `assets.propMesh()` is explicitly documented as shared with every other
    // placement of the same mesh name and must never be disposed here — only
    // the material clone `propMesh` hands out per-call is ours to free.
    const ownedGeometries = [];
    const ownedMaterials = [];

    const base = this._assets.propMesh(def.base);
    const extraScale = BASE_EXTRA_SCALE[def.base] ?? 1;
    base.scale.multiplyScalar(extraScale);
    this._tintMaterial(base.material, def.color);
    ownedMaterials.push(base.material);
    group.add(base);

    // Rough authored base height (post extra-scale) so heads/pips/hp bar sit
    // on top of the box instead of inside it — measured, not authored in
    // `manifest.json` (see the module doc comment).
    const baseHeight = (def.base === 'AmmoBox_5' ? 0.5 : 1.1) * extraScale;

    const headPivot = new THREE.Group();
    headPivot.position.set(0, baseHeight, 0);
    group.add(headPivot);
    const headMaterials = this._buildHead(rec.type, def, headPivot, ownedGeometries, ownedMaterials);

    const pips = [];
    for (let i = 0; i < 3; i++) {
      const pipGeom = new THREE.BoxGeometry(0.08, 0.08, 0.08);
      const pipMat = new THREE.MeshLambertMaterial({ color: PIP_COLOR, emissive: PIP_COLOR, emissiveIntensity: 0.8 });
      ownedGeometries.push(pipGeom);
      ownedMaterials.push(pipMat);
      const pip = new THREE.Mesh(pipGeom, pipMat);
      pip.position.set(-0.15 + i * 0.15, baseHeight + 0.08, 0.32);
      pip.visible = i === 0;
      group.add(pip);
      pips.push({ mesh: pip });
    }

    const hpBgGeom = new THREE.BoxGeometry(HP_BAR_WIDTH, HP_BAR_HEIGHT, 0.06);
    const hpBgMat = new THREE.MeshBasicMaterial({ color: 0x1a1310 });
    ownedGeometries.push(hpBgGeom);
    ownedMaterials.push(hpBgMat);
    const hpBg = new THREE.Mesh(hpBgGeom, hpBgMat);
    hpBg.position.set(0, baseHeight + 0.28, 0.32);
    group.add(hpBg);

    const hpFillGeom = new THREE.BoxGeometry(HP_BAR_WIDTH, HP_BAR_HEIGHT, 0.07);
    const hpFillMat = new THREE.MeshBasicMaterial({ color: 0x6fd66f });
    ownedGeometries.push(hpFillGeom);
    ownedMaterials.push(hpFillMat);
    const hpFill = new THREE.Mesh(hpFillGeom, hpFillMat);
    hpFill.position.copy(hpBg.position);
    group.add(hpFill);

    return {
      group, base, headPivot, headMaterials, pips,
      hpBg, hpFill, hpFillMat,
      ownedGeometries, ownedMaterials,
    };
  }

  /**
   * Builds the procedural/prop head for one turret type into `headPivot`
   * (already positioned atop the base; this only adds children at local
   * origin). Pushes every geometry/material it allocates into the given
   * arrays (for `_disposeVisual`) and returns the materials that need
   * tinting/greying later.
   * @param {string} type
   * @param {object} def `cfg.turrets.types[type]`
   * @param {THREE.Group} headPivot
   * @param {THREE.BufferGeometry[]} ownedGeometries
   * @param {THREE.Material[]} ownedMaterials
   * @returns {THREE.Material[]}
   */
  _buildHead(type, def, headPivot, ownedGeometries, ownedMaterials) {
    const materials = [];

    if (type === 'gun') {
      // Gun_02 measures ~0.8 x 0.15 x 0.05m authored (long, thin) — reads as
      // a barrel. Its long axis is local X; rotate -90 deg about Y so that
      // axis becomes local +Z, matching `headPivot.lookAt(...)`'s convention
      // that "forward" is +Z once aimed. Geometry is shared (propMesh) —
      // only the material clone it hands back is ours to dispose.
      const barrel = this._assets.propMesh('Gun_02');
      barrel.rotation.y = -Math.PI / 2;
      barrel.position.set(0, 0.08, 0.1);
      this._tintMaterial(barrel.material, def.color);
      ownedMaterials.push(barrel.material);
      materials.push(barrel.material);
      headPivot.add(barrel);

      const mountGeom = new THREE.BoxGeometry(0.22, 0.14, 0.22);
      const mountMat = new THREE.MeshLambertMaterial({ color: def.color });
      ownedGeometries.push(mountGeom);
      ownedMaterials.push(mountMat);
      const mount = new THREE.Mesh(mountGeom, mountMat);
      headPivot.add(mount);
      materials.push(mountMat);
    } else if (type === 'tesla') {
      // A coil of stacked cylinders with an emissive tip.
      const coilMat = new THREE.MeshLambertMaterial({ color: def.color });
      ownedMaterials.push(coilMat);
      materials.push(coilMat);
      const ringCount = 4;
      for (let i = 0; i < ringCount; i++) {
        const ringGeom = new THREE.CylinderGeometry(0.14 - i * 0.012, 0.14 - i * 0.012, 0.07, 12);
        ownedGeometries.push(ringGeom);
        const ring = new THREE.Mesh(ringGeom, coilMat);
        ring.position.y = 0.1 + i * 0.09;
        headPivot.add(ring);
      }
      const tipGeom = new THREE.SphereGeometry(0.09, 12, 8);
      const tipMat = new THREE.MeshLambertMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 1.2 });
      ownedGeometries.push(tipGeom);
      ownedMaterials.push(tipMat);
      const tip = new THREE.Mesh(tipGeom, tipMat);
      tip.position.y = 0.1 + ringCount * 0.09;
      headPivot.add(tip);
      materials.push(tipMat);
      headPivot.userData.tesla = { tip, tipMat };
    } else if (type === 'cannon') {
      // A thick short cylinder barrel.
      const barrelGeom = new THREE.CylinderGeometry(0.16, 0.18, 0.5, 14);
      barrelGeom.rotateX(Math.PI / 2); // cylinder's axis defaults to Y; point it along local +Z ("forward").
      ownedGeometries.push(barrelGeom);
      const barrelMat = new THREE.MeshLambertMaterial({ color: def.color });
      ownedMaterials.push(barrelMat);
      const barrel = new THREE.Mesh(barrelGeom, barrelMat);
      barrel.position.set(0, 0.14, 0.2);
      headPivot.add(barrel);
      materials.push(barrelMat);

      const mountGeom = new THREE.CylinderGeometry(0.22, 0.24, 0.16, 14);
      ownedGeometries.push(mountGeom);
      const mountMat = new THREE.MeshLambertMaterial({ color: def.color });
      ownedMaterials.push(mountMat);
      const mount = new THREE.Mesh(mountGeom, mountMat);
      headPivot.add(mount);
      materials.push(mountMat);
    }

    return materials;
  }

  /**
   * @param {THREE.Material|THREE.Material[]} material
   * @param {number} hex
   */
  _tintMaterial(material, hex) {
    const mats = Array.isArray(material) ? material : [material];
    for (const m of mats) {
      if ('color' in m) /** @type {any} */ (m).color = color(hex);
    }
  }

  /**
   * @param {import('../core/types.js').TurretRecord} rec
   * @param {number} idx
   * @param {{x:number,y:number,z:number}[]} enemies
   */
  _faceTarget(rec, idx, enemies) {
    const visual = this._visuals.get(rec.slotId);
    if (!visual) return;
    if (idx < 0) return; // keep the last facing rather than snapping back to a default.
    const enemy = enemies[idx];
    if (!enemy) return;
    visual.headPivot.getWorldPosition(_v1);
    _target.set(enemy.x, _v1.y, enemy.z);
    visual.headPivot.lookAt(_target);
  }

  /**
   * @param {import('../core/types.js').TurretRecord} rec
   * @param {{dmg:number, rate:number, range:number, splash?:number, slow?:number, slowDurS?:number}} stats
   * @param {number} idx Position within `enemies` (as returned by `pickTarget`) — NOT the enemy's own pool index; see `target.idx` below.
   * @param {{idx:number,x:number,y?:number,z:number}[]} enemies `world.enemies.positions()`'s return, each entry carrying the enemy's real pool index as `.idx`.
   * @param {{ time:number, enemies: any }} world
   */
  _fire(rec, stats, idx, enemies, world) {
    const target = enemies[idx];
    if (!target) return;
    // `idx` is only a position within this call's `enemies` array (which
    // omits dead enemies, so it drifts from the pool's own indexing the
    // moment anything has died); `target.idx` is the actual pool index
    // `Enemies#damageAt/applySlow` expect.
    const poolIdx = target.idx;
    const visual = this._visuals.get(rec.slotId);
    visual?.headPivot.getWorldPosition(_origin);
    const targetY = target.y ?? 1;

    if (rec.type === 'gun') {
      world.enemies?.damageAt?.(poolIdx, stats.dmg, 'turret');
      this._effects.tracer(_origin.clone(), new THREE.Vector3(target.x, targetY, target.z));
      this._playSound(world, 'turret-shot-1');
    } else if (rec.type === 'cannon') {
      world.enemies?.damageRadius?.(target.x, target.z, stats.splash ?? 0, stats.dmg, 'turret');
      this._effects.burst(target.x, targetY, target.z, this._cfg.turrets.types.cannon.color, 14);
      this._playSound(world, 'explosion-metal');
    } else if (rec.type === 'tesla') {
      world.enemies?.damageAt?.(poolIdx, stats.dmg, 'turret');
      // `cfg.turrets.types.tesla.slow` is a *strength* (bigger = more slow,
      // increasing with level — see `turretLogic.statsFor`'s monotonic
      // contract), but `Enemies#applySlow`'s `factor` is a *speed
      // multiplier* (bigger = less slow, 1 = unaffected) — invert here at
      // the one seam between the two conventions.
      if (stats.slow !== undefined) world.enemies?.applySlow?.(poolIdx, 1 - stats.slow, stats.slowDurS ?? 0);
      this._flashTeslaTip(rec.slotId);
      // The manifest ships no dedicated electric sound; fall back to
      // `mechanical-clunk` per the brief, using it whenever an
      // `electric-pulse` buffer isn't present (it never is in v1's asset
      // list, but this keeps the fallback honest instead of hardcoded).
      const hasElectric = this._assets.audioBuffers?.has?.('electric-pulse');
      this._playSound(world, hasElectric ? 'electric-pulse' : 'mechanical-clunk');
    }
  }

  /**
   * @param {number} slotId
   */
  _flashTeslaTip(slotId) {
    const visual = this._visuals.get(slotId);
    const tesla = visual?.headPivot.userData.tesla;
    if (!tesla) return;
    tesla.tipMat.emissiveIntensity = 2.5;
    setTimeout(() => {
      if (tesla.tipMat) tesla.tipMat.emissiveIntensity = 1.2;
    }, 90);
  }

  /**
   * @param {{ time:number }} world
   * @param {string} name
   */
  _playSound(world, name) {
    const minInterval = SOUND_MIN_INTERVAL_S[name] ?? 0;
    const last = this._lastSoundAt.get(name) ?? -Infinity;
    if (world.time - last < minInterval) return;
    this._lastSoundAt.set(name, world.time);
    this._audio.play(name);
  }

  /**
   * @param {number} slotId
   * @param {import('../core/types.js').TurretRecord} rec
   */
  _refreshPips(slotId, rec) {
    const visual = this._visuals.get(slotId);
    if (!visual) return;
    visual.pips.forEach((pip, i) => {
      pip.mesh.visible = i <= rec.level;
    });
  }

  /**
   * @param {number} slotId
   * @param {import('../core/types.js').TurretRecord} rec
   */
  _refreshHpBar(slotId, rec) {
    const visual = this._visuals.get(slotId);
    if (!visual) return;
    const frac = rec.hpMax > 0 ? Math.max(0, Math.min(1, rec.hp / rec.hpMax)) : 0;
    visual.hpFill.scale.x = frac;
    // Re-anchor the left edge as the box shrinks around its own centre.
    visual.hpFill.position.x = visual.hpBg.position.x - (HP_BAR_WIDTH * (1 - frac)) / 2;
    /** @type {THREE.MeshBasicMaterial} */ (visual.hpFillMat).color.setHex(frac > 0.4 ? 0x6fd66f : 0xe0523f);
  }

  /**
   * @param {number} slotId
   */
  _greyOut(slotId) {
    const visual = this._visuals.get(slotId);
    if (!visual) return;
    /** @type {any} */ (visual.base.material).color = GREY_COLOR.clone();
    for (const mat of visual.headMaterials) {
      if ('color' in mat) /** @type {any} */ (mat).color = GREY_COLOR.clone();
      if ('emissive' in mat) /** @type {any} */ (mat).emissiveIntensity = 0;
    }
    for (const pip of visual.pips) pip.mesh.visible = false;
    visual.hpBg.visible = false;
    visual.hpFill.visible = false;
  }

  /**
   * @param {number} slotId
   */
  _disposeVisual(slotId) {
    const visual = this._visuals.get(slotId);
    if (!visual) return;
    this._scene.remove(visual.group);
    // `visual.base`'s (and the gun head's `Gun_02` propMesh's) *geometry* is
    // shared with every other placement of the same mesh name — never
    // disposed here. Only `ownedGeometries`/`ownedMaterials` (everything
    // this file allocated itself: procedural heads, pips, hp bar, plus the
    // material *clones* `propMesh` hands back) are ours to free.
    for (const geom of visual.ownedGeometries) geom.dispose();
    for (const mat of visual.ownedMaterials) mat.dispose();
    this._visuals.delete(slotId);
  }
}
