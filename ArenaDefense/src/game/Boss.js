// One billboard boss unit driven by the pure `core/bossBrain.js`. One
// `Billboards` slot (allocated from the `cfg.enemies.cap + 1`-sized pool
// `Game.js` already reserves a spot for), walking/attacking the nearest of
// {player, alive turrets}, and — depending on which `cfg.bosses.<key>` entry
// `spawn()` is given — optionally "casting" (no movement, a `castRaise`
// grow) to spawn an add through `world.enemies.spawn`, holding a ranged
// standoff and firing its own small projectile pool, dropping telegraphed
// ground-denial zones, or windup-then-charging in a dash. Every one of those
// mechanics is decided by `core/bossBrain.js`; this file only ever executes
// what it's told (move here, deal this damage, place a zone there) and owns
// every three.js/audio/particle side effect that decision implies — see
// `core/bossBrain.js`'s file-top comment for the full mechanic rundown.
//
// Registered as a system via `game.registerSystem('boss', boss)` by
// `game/bossPhase.js#installBoss` — `update(dt, world)` then runs once per
// fixed step alongside every other system (see `docs/INTERFACES.md`'s "P5
// additions" section for the exact contract this file follows, including the
// documented deviations below).
import * as THREE from 'three';
import { gatePositions, clampToArena } from '../core/arenaGeometry.js';
import { BossBrain } from '../core/bossBrain.js';
import { bob, castRaise, hitFlash } from '../core/spriteAnim.js';

const HIT_PARTICLE_COLOR = 0xff5533;
const DEATH_PARTICLE_COUNT = 24;

// --- ranged mechanic (bombardiro's `kind: 'ranged'`): this boss's own tiny
// projectile pool. `Enemies.js` already has one, but it's private (no public
// "spawn a projectile from an arbitrary point" API) and this file may not be
// edited to add one — see this change's file-scope note. Sized generously
// above what a single boss on a ~1.5s cooldown could ever have in flight at
// once (def.cooldown / (def.range/def.projSpeed) for bombardiro is under 1),
// not a balance number — report if a future ranged boss needs it larger.
const BOSS_PROJECTILE_CAP = 8;
// Contact radius for a boss projectile against the player/a turret. Not in
// `def.mechanic` (this is a `def`-level `kind: 'ranged'` concern, not a
// `mechanic` block) — `Enemies.js`'s own private `PROJECTILE_HIT_RADIUS` is
// 0.5; kept slightly larger here since a boss projectile reads as a bigger
// physical object. Report so it can move to config if that's wanted.
const BOSS_PROJECTILE_HIT_RADIUS = 0.6;
const BOSS_PROJECTILE_COLOR = 0xff8844; // cosmetic only.
const BOSS_PROJECTILE_RADIUS_M = 0.25; // cosmetic only — the sphere mesh's own radius.

// --- groundDenial mechanic (bombardiro): a small pool of ground-marker
// meshes, one per concurrently active zone. Chosen over `Effects` (whose
// `burst`/`flash`/`tracer` are all one-shot/instant, see that file) because a
// zone has to stay visibly on the ground for the whole `durationS` — see
// `_placeZone`'s doc comment. `Effects.burst` is still used for the placement
// "pop" so a new zone reads as an event, not just something that silently
// appeared. Cap has headroom above any configured `mechanic.maxZones`
// (bombardiro's is 4) so a future boss's slightly higher zone cap doesn't
// silently drop placements — report if that headroom ever needs to grow.
const GROUND_ZONE_POOL_CAP = 6;
const GROUND_ZONE_Y = 0.02; // lifted off the floor to avoid z-fighting, same idea as Billboards.js's shadow discs.
const GROUND_ZONE_COLOR = 0xff3300; // cosmetic only.
const GROUND_ZONE_OPACITY = 0.45; // cosmetic only.
const GROUND_ZONE_PULSE_HZ = 1.5; // cosmetic only — reads as "still live", not a static decal.
const GROUND_ZONE_BURST_PARTICLES = 14; // cosmetic only, same role as DEATH_PARTICLE_COUNT above.

// --- dash mechanic (tralalero) telegraph ---
const DASH_TINT_PULSE_HZ = 4; // cosmetic only — how fast the windup tint pulses.
const DASH_TINT = { r: 1, g: 0.35, b: 0.3 }; // cosmetic only.
const WHITE_TINT = { r: 1, g: 1, b: 1 };

// --- phases mechanic (assassino) enrage telegraph ---
const ENRAGE_TINT = { r: 1, g: 0.3, b: 0.3 }; // cosmetic only.

const _matrix = new THREE.Matrix4();
const _zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
const _tracerA = new THREE.Vector3();
const _tracerB = new THREE.Vector3();

/**
 * Axis-aligned (Y) swept-cylinder ray test, radius `radius`, extending from
 * y=0 to y=`height`, centred at `(cx, cz)`. Identical math to the private
 * `cylinderHit` in `Enemies.js` (not exported there, so duplicated here
 * rather than reaching into that file's internals) — see this file's
 * `hitTest`.
 *
 * @param {{x:number,y:number,z:number}} origin
 * @param {{x:number,y:number,z:number}} dir Normalized.
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

export class Boss {
  /**
   * @param {import('three').Scene} scene Owns three.js objects this file allocates directly
   *   (ground-denial zone markers, the boss's own projectile pool) — everything else still renders
   *   through `billboards`, exactly like `Enemies.js`'s `tungtung` sprites.
   * @param {import('./assets.js').Assets} assets Unused directly today, kept for constructor
   *   signature parity with every other `game/*.js` system class.
   * @param {import('../core/types.js').GameConfig} cfg
   * @param {import('../core/events.js').EventBus} bus
   * @param {import('./Billboards.js').Billboards} billboards
   * @param {import('./Effects.js').Effects} effects
   * @param {import('../platform/audio.js').Audio} audio
   */
  constructor(scene, assets, cfg, bus, billboards, effects, audio) {
    this._scene = scene;
    this._assets = assets;
    this._cfg = cfg;
    this._bus = bus;
    this._billboards = billboards;
    this._effects = effects;
    this._audio = audio;

    // `spawn()` replaces both of these with whichever `cfg.bosses[key]` def
    // it's given (any of `cfg.bosses`, not just patapim) — a fresh
    // `BossBrain` per fight rather than one long-lived instance, since
    // different bosses need different mechanic state shapes, not just
    // different numbers.
    this._def = cfg.bosses.patapim;
    this._bossKey = 'patapim';
    this._gates = gatePositions(cfg);
    this._brain = new BossBrain(this._def, cfg);

    this.alive = false;
    this.hp = 0;
    this.hpMax = 0;
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.cooldown = 0; // mirrors `this._brain.attackCooldown` after every update() — see the getter's doc comment.
    this.addsAlive = 0;

    /** @type {Set<number>} Pool indices (`Enemies.spawn`'s return) of this boss's own live adds — see `_onEnemyKilled`. */
    this._addIdxs = new Set();

    this._slotId = -1;
    this._time = 0;
    this._walkPhase = 0;
    this._hitAt = -Infinity;

    this._buildProjectilePool();
    this._buildZonePool();
    /** @type {{x:number,z:number,radius:number,dmgPerS:number,remaining:number,meshIdx:number}[]} */
    this._zones = [];

    // Dash contact bookkeeping — which targets this charge has already hit,
    // so a fast pass through the player/a turret deals `mechanic.dmg` once,
    // not once per frame it happens to still be overlapping. Cleared at the
    // start of every windup (see `_updateDash`).
    this._dashHitPlayer = false;
    this._dashHitTurrets = new Set();

    // Subscribed once, for the lifetime of this instance (this class is
    // constructed exactly once by `main.js`, same as `Enemies`/`Billboards`)
    // — `clear()` resets state, it never re-subscribes.
    bus.on('enemy:killed', (e) => this._onEnemyKilled(e));
  }

  /**
   * @param {{idx:number}} e
   */
  _onEnemyKilled(e) {
    if (this._addIdxs.delete(e.idx)) {
      this.addsAlive = this._addIdxs.size;
    }
  }

  /**
   * @param {number} gateId Arena gate id (0..2) — the caller (`bossPhase.js`) resolves this from
   *   the wave's active-gate pair, same convention as `Enemies#spawn`.
   * @param {string} [bossKey] Key into `cfg.bosses` — which of the four+ boss defs to spawn.
   *   Defaults to `'patapim'` so the existing `boss.spawn(gateId)` call site in `bossPhase.js`
   *   (not edited by this change — see its file-scope note) keeps spawning exactly what it always
   *   has; wiring an actual wave-to-boss-name mapping through that call site is that file's job.
   */
  spawn(gateId, bossKey = 'patapim') {
    const def = this._cfg.bosses[bossKey];
    const gate = this._gates.find((g) => g.id === gateId) ?? this._gates[gateId % this._gates.length];

    // Defensive: normal play only ever calls `spawn()` once per run (wave
    // 5's `wave:started` fires exactly once, and `bossPhase.js` clears the
    // boss on every fresh run before its next boss wave could re-trigger
    // this) — but a stray double-spawn must not leak the previous slot, any
    // zones/projectiles from a previous fight, or the previous fight's brain
    // state (a fresh `BossBrain` below covers the timers; the pools need
    // their own explicit clears since they're pure `game/`-side state).
    if (this._slotId >= 0) {
      this._billboards.free(this._slotId);
      this._slotId = -1;
    }
    this._clearZones();
    this._clearProjectiles();

    this._def = def;
    this._bossKey = bossKey;
    this._brain = new BossBrain(def, this._cfg);

    this.alive = true;
    this.hp = def.hp;
    this.hpMax = def.hp;
    this.x = gate.x;
    this.z = gate.z;
    this.yaw = 0;
    this.cooldown = 0;
    this.addsAlive = 0;
    this._addIdxs.clear();
    this._walkPhase = 0;
    this._hitAt = -Infinity;
    this._dashHitPlayer = false;
    this._dashHitTurrets.clear();
    this._slotId = this._billboards.alloc(def.sprite, def.height);
    if (this._slotId >= 0) this._billboards.setTint(this._slotId, WHITE_TINT.r, WHITE_TINT.g, WHITE_TINT.b);
  }

  /**
   * @param {number} dt
   * @param {object} world See `docs/INTERFACES.md`'s `Game.world` shape.
   */
  update(dt, world) {
    if (!this.alive) return;
    this._time = world.time;
    const cfg = this._cfg;
    const def = this._def;
    const mech = def.mechanic;

    const target = this._nearestTarget(world);
    const dist = Math.hypot(target.x - this.x, target.z - this.z);

    const result = this._brain.update(dt, {
      self: { x: this.x, z: this.z },
      target: { x: target.x, z: target.z, dist },
      addsAlive: this.addsAlive,
      time: this._time,
      hpFrac: this.hpMax > 0 ? this.hp / this.hpMax : 1,
      activeZones: this._zones.length,
    });
    this.cooldown = this._brain.attackCooldown;

    let moving = false;
    if (result.action === 'dash') {
      moving = this._updateDash(result, dt, world, def, mech);
    } else if (result.action === 'walk' && result.moveDir) {
      moving = true;
      this._walkPhase += dt;
      const spd = def.speed * result.speedMul;
      const nx = this.x + result.moveDir.x * spd * dt;
      const nz = this.z + result.moveDir.z * spd * dt;
      const clamped = clampToArena(nx, nz, cfg.arena.radius - def.radius);
      this.x = clamped.x;
      this.z = clamped.z;
      // Matches Player.js/Enemies.js/arenaGeometry's yaw convention: yaw 0 =
      // -z, increasing clockwise. Cosmetic only — the billboard shader
      // ignores yaw entirely (Y-axis-only camera facing) — kept for a
      // future 3D-model swap and for HUD/debug use.
      this.yaw = Math.atan2(result.moveDir.x, -result.moveDir.z);
    } else if (result.action === 'attack') {
      this._performAttack(def, target, world);
    } else if (result.action === 'cast' && result.spawnAdd) {
      this._spawnAdd(world);
    }

    if (result.groundZone) this._placeZone(result.groundZone, mech);
    this._updateZones(dt, world);
    this._updateProjectiles(dt, world);
    this._updateTint(result, def, mech);

    this._updateBillboard(result, moving);
  }

  /**
   * Nearest of {player, alive turrets} — the melee branch of
   * `core/enemyBrain.chooseTarget`, reimplemented directly rather than
   * called: that function keys its `typeDef` lookup off
   * `cfg.enemies.types[enemy.type]`, and the boss's def lives in
   * `cfg.bosses` instead, so adapting its signature would cost more than
   * this handful of lines. Used for every boss kind (melee and ranged
   * alike) — none of the four new defs set `preferPlayerRange`, so there's
   * no case yet where a ranged boss needs `enemyBrain`'s fuller
   * player-vs-turret preference logic.
   * @param {object} world
   * @returns {{kind:'player'|'turret', id:number|null, x:number, z:number}}
   */
  _nearestTarget(world) {
    const player = world.player;
    const turrets = world.turrets?.list?.() ?? [];
    let best = { kind: /** @type {const} */ ('player'), id: null, x: player.x, z: player.z };
    let bestDist = Math.hypot(player.x - this.x, player.z - this.z);
    for (const t of turrets) {
      if (t.alive === false) continue;
      const d = Math.hypot(t.x - this.x, t.z - this.z);
      if (d < bestDist) {
        bestDist = d;
        best = { kind: 'turret', id: t.slotId, x: t.x, z: t.z };
      }
    }
    return best;
  }

  /**
   * Spawns one `def.addType` at the boss's nearest gate.
   *
   * Deviation from the plan brief's "spawn at the boss's own position": the
   * frozen `Enemies#spawn(typeName, gateId, hpMul)` contract only ever
   * positions a new enemy at a real arena gate (with small cosmetic jitter)
   * — it exposes no way to place or teleport an enemy to an arbitrary world
   * point (checked `docs/INTERFACES.md`'s "P3 additions" section; no such
   * method exists). Spawning at the boss's nearest gate instead of at its
   * feet is the documented v1 compromise — see this file's "P5 additions"
   * entry in `docs/INTERFACES.md`.
   * @param {object} world
   */
  _spawnAdd(world) {
    const def = this._def;
    let nearestGateId = this._gates[0].id;
    let bestDist = Infinity;
    for (const g of this._gates) {
      const d = Math.hypot(g.x - this.x, g.z - this.z);
      if (d < bestDist) {
        bestDist = d;
        nearestGateId = g.id;
      }
    }
    const idx = world.enemies?.spawn?.(def.addType, nearestGateId, 1.0) ?? -1;
    // `Enemies#spawn` returns -1 at `cfg.enemies.cap` — boss adds share that
    // one pool with every other enemy, so a full pool must NOT be counted
    // as a live add (it would otherwise permanently block this boss's own
    // cast cadence once the general enemy count saturates the cap).
    if (idx >= 0) {
      this._addIdxs.add(idx);
      this.addsAlive = this._addIdxs.size;
    }
  }

  /**
   * Executes the brain's 'attack' decision — melee deals damage directly
   * (unchanged from before this file supported more than one `def.kind`);
   * ranged instead fires one of this boss's own projectiles, since an
   * instant hit at `def.range` up to 20m would give a ranged boss no
   * travel-time tell at all.
   * @param {object} def
   * @param {{kind:'player'|'turret', id:number|null, x:number, z:number}} target
   * @param {object} world
   */
  _performAttack(def, target, world) {
    if (def.kind === 'ranged') {
      this._spawnProjectile(def, target);
    } else if (target.kind === 'player') {
      world.player.takeDamage(def.dmg);
    } else {
      world.turrets?.damage?.(target.id, def.dmg);
    }
    this._audio.play('zombie-attack-1');
  }

  /**
   * @param {{action:string, castProgress:number, speedMul:number}} result
   * @param {boolean} moving
   */
  _updateBillboard(result, moving) {
    if (this._slotId < 0) return;
    const cfg = this._cfg;
    const def = this._def;
    // During a dash charge the boss moves at `mechanic.speed`, not
    // `def.speed` — feeding the walk-bob curve the actual current speed
    // (rather than always `def.speed`) keeps the animation's cadence
    // visually matched to how fast the boss is really covering ground.
    let animSpeed = 0;
    if (moving) {
      animSpeed = result.action === 'dash' && result.dash?.phase === 'charging'
        ? def.mechanic.speed
        : def.speed * result.speedMul;
    }
    const anim = bob(this._walkPhase, animSpeed, cfg);
    if (result.action === 'cast') {
      // `Billboards.set`'s `anim` only carries a vertical offset + an x/y
      // squash pair (no separate uniform-scale channel) — a cast's "raise"
      // grow is applied by multiplying both squash axes by the same
      // `castRaise` factor, which scales the whole quad uniformly since the
      // vertex shader multiplies width/height by `aAnim.y`/`aAnim.z`
      // respectively (see `Billboards.js`'s vertex shader and
      // `docs/INTERFACES.md`'s "P5 additions" section).
      const raise = castRaise(result.castProgress);
      anim.sx *= raise;
      anim.sy *= raise;
    }
    const flash = hitFlash(this._time - this._hitAt, cfg);
    this._billboards.set(this._slotId, this.x, this.z, anim, flash);
  }

  /**
   * Applies the two mechanics that read as a persistent colour change on the
   * boss's own sprite rather than a one-shot effect: a dash's windup
   * telegraph (pulsing red while it stands still aiming) and a `phases`
   * boss's `enrage` flag (steady red from the phase it turns on onward).
   * Neither boss config combines `dash` and `phases`, so there's no
   * precedence rule needed between them yet — report if a future boss ever
   * does.
   * @param {import('../core/bossBrain.js').BossBrainResult} result
   * @param {object} def
   * @param {object|undefined} mech `def.mechanic`.
   */
  _updateTint(result, def, mech) {
    if (this._slotId < 0) return;
    if (mech?.kind === 'dash') {
      if (result.action === 'dash' && result.dash.phase === 'windup') {
        const pulse = 0.5 + 0.5 * Math.sin(this._time * DASH_TINT_PULSE_HZ * 2 * Math.PI);
        const r = WHITE_TINT.r + (DASH_TINT.r - WHITE_TINT.r) * pulse;
        const g = WHITE_TINT.g + (DASH_TINT.g - WHITE_TINT.g) * pulse;
        const b = WHITE_TINT.b + (DASH_TINT.b - WHITE_TINT.b) * pulse;
        this._billboards.setTint(this._slotId, r, g, b);
      } else {
        this._billboards.setTint(this._slotId, WHITE_TINT.r, WHITE_TINT.g, WHITE_TINT.b);
      }
      return;
    }
    if (mech?.kind === 'phases') {
      const t = result.enraged ? ENRAGE_TINT : WHITE_TINT;
      this._billboards.setTint(this._slotId, t.r, t.g, t.b);
    }
  }

  // --- dash mechanic (tralalero) ---

  /**
   * Executes one tick of the brain's dash result: stands still and faces the
   * locked charge direction during the windup (also drawing the telegraph),
   * or moves along it at `mechanic.speed` during the charge, dealing
   * `mechanic.dmg` to the player/each turret it passes through — once per
   * target per charge, since a fast pass can otherwise overlap a target for
   * several consecutive frames.
   * @param {import('../core/bossBrain.js').BossBrainResult} result
   * @param {number} dt
   * @param {object} world
   * @param {object} def
   * @param {object} mech `def.mechanic` (kind 'dash').
   * @returns {boolean} Whether the boss moved this tick (for the walk-bob animation).
   */
  _updateDash(result, dt, world, def, mech) {
    const dash = result.dash;
    this.yaw = Math.atan2(dash.dir.x, -dash.dir.z);

    if (dash.phase === 'windup') {
      if (dash.progress === 0) {
        // Fresh dash: nothing hit yet this charge.
        this._dashHitPlayer = false;
        this._dashHitTurrets.clear();
      }
      this._renderDashTelegraph(dash, def, mech);
      return false;
    }

    // Charging.
    const nx = this.x + dash.dir.x * mech.speed * dt;
    const nz = this.z + dash.dir.z * mech.speed * dt;
    const clamped = clampToArena(nx, nz, this._cfg.arena.radius - def.radius);
    this.x = clamped.x;
    this.z = clamped.z;
    this._walkPhase += dt;

    const dPlayer = Math.hypot(world.player.x - this.x, world.player.z - this.z);
    if (!this._dashHitPlayer && dPlayer <= def.range) {
      world.player.takeDamage(mech.dmg);
      this._dashHitPlayer = true;
      this._audio.play('zombie-attack-1');
    }
    for (const t of world.turrets?.list?.() ?? []) {
      if (t.alive === false) continue;
      const id = t.slotId;
      if (this._dashHitTurrets.has(id)) continue;
      const d = Math.hypot(t.x - this.x, t.z - this.z);
      if (d <= def.range) {
        world.turrets?.damage?.(id, mech.dmg);
        this._dashHitTurrets.add(id);
      }
    }
    return true;
  }

  /**
   * Draws the windup's "which way it's going" tell: a tracer line the length
   * of the charge, refreshed every windup tick since `Effects.tracer` only
   * lives `TRACER_LIFE_S` (~60ms) — a single call at windup start would
   * vanish long before the windup itself is over. Paired with `_updateTint`'s
   * pulsing red tint on the boss's own sprite.
   * @param {{dir:{x:number,z:number}}} dash
   * @param {object} def
   * @param {object} mech `def.mechanic` (kind 'dash').
   */
  _renderDashTelegraph(dash, def, mech) {
    const laneLen = mech.speed * mech.durationS; // total charge distance — exactly how far the lane the tracer draws actually reaches.
    const y = def.hitHeight * 0.5;
    _tracerA.set(this.x, y, this.z);
    _tracerB.set(this.x + dash.dir.x * laneLen, y, this.z + dash.dir.z * laneLen);
    this._effects.tracer(_tracerA, _tracerB);
  }

  // --- ranged mechanic (bombardiro's `kind: 'ranged'`) — this boss's own projectile pool ---

  _buildProjectilePool() {
    const geom = new THREE.SphereGeometry(BOSS_PROJECTILE_RADIUS_M, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: BOSS_PROJECTILE_COLOR });
    this._projMesh = new THREE.InstancedMesh(geom, mat, BOSS_PROJECTILE_CAP);
    this._projMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._projMesh.frustumCulled = false;
    this._projMesh.count = BOSS_PROJECTILE_CAP;
    this._scene.add(this._projMesh);

    /** @type {{active:boolean, x:number, y:number, z:number, vx:number, vz:number, dmg:number, maxDist:number, traveled:number}[]} */
    this._proj = Array.from({ length: BOSS_PROJECTILE_CAP }, () => (
      { active: false, x: 0, y: 0, z: 0, vx: 0, vz: 0, dmg: 0, maxDist: 0, traveled: 0 }
    ));
    /** @type {number[]} */
    this._projFree = [];
    for (let i = BOSS_PROJECTILE_CAP - 1; i >= 0; i--) {
      this._projFree.push(i);
      this._projMesh.setMatrixAt(i, _zeroScale);
    }
    this._projMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * @param {object} def
   * @param {{x:number, z:number}} target
   */
  _spawnProjectile(def, target) {
    const idx = this._projFree.pop();
    if (idx === undefined) return; // pool exhausted: drop the shot, never throw — same rule as `Enemies.js`'s own pool.

    const dx = target.x - this.x;
    const dz = target.z - this.z;
    const d = Math.hypot(dx, dz) || 1;

    const p = this._proj[idx];
    p.active = true;
    p.x = this.x;
    p.y = def.hitHeight * 0.5;
    p.z = this.z;
    p.vx = (dx / d) * def.projSpeed;
    p.vz = (dz / d) * def.projSpeed;
    p.dmg = def.dmg;
    p.maxDist = def.range * 1.5; // margin: the target may have moved by the time the shot lands — same convention as `Enemies.js`'s `_spawnProjectile`.
    p.traveled = 0;
  }

  /**
   * @param {number} dt
   * @param {object} world
   */
  _updateProjectiles(dt, world) {
    let dirty = false;
    for (let i = 0; i < this._proj.length; i++) {
      const p = this._proj[i];
      if (!p.active) continue;
      dirty = true;

      const stepX = p.vx * dt;
      const stepZ = p.vz * dt;
      p.x += stepX;
      p.z += stepZ;
      p.traveled += Math.hypot(stepX, stepZ);

      const dxp = world.player.x - p.x;
      const dzp = world.player.z - p.z;
      if (Math.hypot(dxp, dzp) < BOSS_PROJECTILE_HIT_RADIUS) {
        world.player.takeDamage(p.dmg);
        this._freeProjectile(i);
        continue;
      }

      let hitTurret = false;
      for (const t of world.turrets?.list?.() ?? []) {
        if (t.alive === false) continue;
        const dxt = t.x - p.x;
        const dzt = t.z - p.z;
        if (Math.hypot(dxt, dzt) < BOSS_PROJECTILE_HIT_RADIUS) {
          world.turrets?.damage?.(t.slotId, p.dmg);
          hitTurret = true;
          break;
        }
      }
      if (hitTurret) {
        this._freeProjectile(i);
        continue;
      }

      if (p.traveled > p.maxDist) {
        this._freeProjectile(i);
        continue;
      }

      _matrix.makeTranslation(p.x, p.y, p.z);
      this._projMesh.setMatrixAt(i, _matrix);
    }
    if (dirty) this._projMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * @param {number} i
   */
  _freeProjectile(i) {
    this._proj[i].active = false;
    this._projFree.push(i);
    this._projMesh.setMatrixAt(i, _zeroScale);
    this._projMesh.instanceMatrix.needsUpdate = true;
  }

  _clearProjectiles() {
    for (let i = 0; i < this._proj.length; i++) {
      if (this._proj[i].active) this._freeProjectile(i);
    }
  }

  // --- groundDenial mechanic (bombardiro) — ground-marker pool ---

  _buildZonePool() {
    this._zoneMeshes = [];
    for (let i = 0; i < GROUND_ZONE_POOL_CAP; i++) {
      const geom = new THREE.CircleGeometry(1, 24);
      geom.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: GROUND_ZONE_COLOR, transparent: true, opacity: 0, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.visible = false;
      this._scene.add(mesh);
      this._zoneMeshes.push(mesh);
    }
  }

  /**
   * @returns {number} Index of a free (currently invisible) zone mesh slot, or -1 if the pool
   *   is exhausted (shouldn't happen — see `GROUND_ZONE_POOL_CAP`'s doc comment).
   */
  _freeZoneMeshIdx() {
    for (let i = 0; i < this._zoneMeshes.length; i++) {
      if (!this._zoneMeshes[i].visible) return i;
    }
    return -1;
  }

  /**
   * Places one ground-denial zone at the brain's chosen point (already
   * lead-predicted ahead of the target — see `core/bossBrain.js#_tickGroundDenial`),
   * clamped inside the arena wall so a zone predicted near the edge doesn't
   * render (or become steppable-in) outside it. Rendered as a flat
   * translucent disc scaled to `mechanic.radius` — chosen as "a minimal
   * marker" over `Effects`' primitives because none of `burst`/`flash`/
   * `tracer` persist for a `durationS`-long window (all one-shot or
   * sub-100ms) — plus one `Effects.burst` "pop" on placement so the moment a
   * zone appears reads as an event worth reacting to, not just a shape that
   * silently exists.
   * @param {{x:number,z:number}} pos
   * @param {object} mech `def.mechanic` (kind 'groundDenial').
   */
  _placeZone(pos, mech) {
    const meshIdx = this._freeZoneMeshIdx();
    if (meshIdx < 0) return;

    const clamped = clampToArena(pos.x, pos.z, this._cfg.arena.radius - mech.radius);
    const mesh = this._zoneMeshes[meshIdx];
    mesh.scale.set(mech.radius, 1, mech.radius);
    mesh.position.set(clamped.x, GROUND_ZONE_Y, clamped.z);
    mesh.visible = true;
    mesh.material.opacity = GROUND_ZONE_OPACITY;

    this._zones.push({
      x: clamped.x, z: clamped.z, radius: mech.radius, dmgPerS: mech.dmgPerS,
      remaining: mech.durationS, meshIdx,
    });
    this._effects.burst(clamped.x, 0.2, clamped.z, GROUND_ZONE_COLOR, GROUND_ZONE_BURST_PARTICLES);
  }

  /**
   * Ticks every active zone's lifetime, damages the player while they stand
   * in one (turrets are stationary and already the boss's secondary target
   * via melee/ranged attacks — ground denial is specifically about pushing
   * the *player* off ground, per the design brief), and frees expired
   * zones' mesh slots.
   * @param {number} dt
   * @param {object} world
   */
  _updateZones(dt, world) {
    for (let i = this._zones.length - 1; i >= 0; i--) {
      const z = this._zones[i];
      z.remaining -= dt;
      const mesh = this._zoneMeshes[z.meshIdx];
      if (z.remaining <= 0) {
        mesh.visible = false;
        this._zones.splice(i, 1);
        continue;
      }

      const pulse = 0.7 + 0.3 * Math.sin(this._time * GROUND_ZONE_PULSE_HZ * 2 * Math.PI);
      mesh.material.opacity = GROUND_ZONE_OPACITY * pulse;

      const dx = world.player.x - z.x;
      const dz = world.player.z - z.z;
      if (Math.hypot(dx, dz) <= z.radius) {
        world.player.takeDamage(z.dmgPerS * dt);
      }
    }
  }

  _clearZones() {
    for (const z of this._zones) this._zoneMeshes[z.meshIdx].visible = false;
    this._zones.length = 0;
  }

  /**
   * @param {number} n
   * @param {string} source Free-form origin tag (`'player'`, ...), matching `Enemies#damageAt`'s convention.
   */
  damage(n, source) {
    if (!this.alive) return;
    this.hp -= n;
    this._hitAt = this._time;
    if (this.hp <= 0) this._die(source);
  }

  /**
   * @param {string} source
   */
  _die(source) {
    const def = this._def;
    this.alive = false;
    this._effects.burst(this.x, def.hitHeight * 0.5, this.z, HIT_PARTICLE_COLOR, DEATH_PARTICLE_COUNT);
    this._audio.play('explosion-metal');
    // `idx: -1` marks this as not a real `Enemies` pool slot — `Game.js`'s
    // own generic `enemy:killed` listener (`this._economy.addEnergy(e.energy)`)
    // still applies unmodified; `boss: true` and `coins` are for P6's combo/coin
    // system to key off (see `docs/INTERFACES.md`'s "P5 additions"). `type` is
    // the actual boss that died (`this._bossKey`, set by `spawn()`) — not
    // hardcoded to `'patapim'` now that `spawn()` can bring up any boss.
    this._bus.emit('enemy:killed', {
      idx: -1, type: this._bossKey, boss: true, x: this.x, z: this.z, source, energy: def.energy, coins: def.coins,
    });
    if (this._slotId >= 0) {
      this._billboards.free(this._slotId);
      this._slotId = -1;
    }
    this._clearZones();
    this._clearProjectiles();
  }

  /**
   * Cylinder hit test (`def.radius`, `def.hitHeight`), for the player's
   * hitscan gun — see `game/bossPhase.js#installBoss`'s `player:fired`
   * handler and its documented v1 double-hit compromise.
   * @param {{x:number,y:number,z:number}} origin
   * @param {{x:number,y:number,z:number}} dir Normalized.
   * @param {number} maxDist
   * @returns {{point:{x:number,y:number,z:number}, dist:number}|null}
   */
  hitTest(origin, dir, maxDist) {
    if (!this.alive) return null;
    const def = this._def;
    const hit = cylinderHit(origin, dir, this.x, this.z, def.radius, def.hitHeight, maxDist);
    return hit ? { point: hit.point, dist: hit.dist } : null;
  }

  /**
   * `Enemies#positions()`-shaped, for a future turret-targeting merge.
   * `idx` is always `-1` (a sentinel, not a real `Enemies` pool index) since
   * `Turrets.js`'s `update(dt, world)` only ever reads `world.enemies?.
   * positions()` today — it never reads this method, so in v1 turrets
   * simply ignore the boss (see `docs/INTERFACES.md`'s "P5 additions").
   * @returns {{idx:number,x:number,y:number,z:number,radius:number}[]}
   */
  positions() {
    if (!this.alive) return [];
    const def = this._def;
    return [{ idx: -1, x: this.x, y: def.hitHeight * 0.5, z: this.z, radius: def.radius }];
  }

  /** Kills/hides the boss and resets every timer — called on a fresh run so a
   *  previous run's boss (e.g. one still alive when the player died) never
   *  bleeds into the next. Does NOT unsubscribe from `bus` (see the
   *  constructor's comment — the subscription is a singleton for this
   *  instance's whole lifetime). */
  clear() {
    if (this._slotId >= 0) {
      this._billboards.free(this._slotId);
      this._slotId = -1;
    }
    this.alive = false;
    this.hp = 0;
    this.hpMax = 0;
    this.cooldown = 0;
    this.addsAlive = 0;
    this._addIdxs.clear();
    this._brain.reset();
    this._walkPhase = 0;
    this._hitAt = -Infinity;
    this._dashHitPlayer = false;
    this._dashHitTurrets.clear();
    this._clearZones();
    this._clearProjectiles();
  }
}
