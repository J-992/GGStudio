// Patapim: a single billboard boss unit driven by the pure `core/bossBrain.js`.
// One `Billboards` slot (allocated from the `cfg.enemies.cap + 1`-sized pool
// `Game.js` already reserves a spot for), walking/attacking the nearest of
// {player, alive turrets}, periodically "casting" (no movement, a
// `castRaise` grow) to spawn a `tungtung` add through `world.enemies.spawn`.
//
// Registered as a system via `game.registerSystem('boss', boss)` by
// `game/bossPhase.js#installBoss` — `update(dt, world)` then runs once per
// fixed step alongside every other system (see `docs/INTERFACES.md`'s "P5
// additions" section for the exact contract this file follows, including the
// documented deviations below).
import { gatePositions, clampToArena } from '../core/arenaGeometry.js';
import { BossBrain } from '../core/bossBrain.js';
import { bob, castRaise, hitFlash } from '../core/spriteAnim.js';

const HIT_PARTICLE_COLOR = 0xff5533;
const DEATH_PARTICLE_COUNT = 24;

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
   * @param {import('three').Scene} scene Unused directly — the boss renders entirely through
   *   `billboards`, exactly like `Enemies.js`'s `tungtung` sprites. Kept as a constructor
   *   parameter for signature parity with every other `game/*.js` system class (`Enemies`,
   *   `Turrets`) and in case a future 3D-model boss (see the plan's Meshy follow-up) needs it.
   * @param {import('./assets.js').Assets} assets Unused directly today, for the same reason.
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

    this._def = cfg.bosses.patapim;
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
   */
  spawn(gateId) {
    const def = this._def;
    const gate = this._gates.find((g) => g.id === gateId) ?? this._gates[gateId % this._gates.length];

    // Defensive: normal play only ever calls `spawn()` once per run (wave
    // 5's `wave:started` fires exactly once, and `bossPhase.js` clears the
    // boss on every fresh run before its next boss wave could re-trigger
    // this) — but a stray double-spawn must not leak the previous slot.
    if (this._slotId >= 0) {
      this._billboards.free(this._slotId);
      this._slotId = -1;
    }

    this.alive = true;
    this.hp = def.hp;
    this.hpMax = def.hp;
    this.x = gate.x;
    this.z = gate.z;
    this.yaw = 0;
    this.cooldown = 0;
    this.addsAlive = 0;
    this._addIdxs.clear();
    this._brain.reset();
    this._walkPhase = 0;
    this._hitAt = -Infinity;
    this._slotId = this._billboards.alloc(def.sprite, def.height);
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

    const target = this._nearestTarget(world);
    const dist = Math.hypot(target.x - this.x, target.z - this.z);

    const result = this._brain.update(dt, {
      self: { x: this.x, z: this.z },
      target: { x: target.x, z: target.z, dist },
      addsAlive: this.addsAlive,
      time: this._time,
    });
    this.cooldown = this._brain.attackCooldown;

    const moving = result.action === 'walk' && !!result.moveDir;
    if (moving) {
      this._walkPhase += dt;
      const nx = this.x + result.moveDir.x * def.speed * dt;
      const nz = this.z + result.moveDir.z * def.speed * dt;
      const clamped = clampToArena(nx, nz, cfg.arena.radius - def.radius);
      this.x = clamped.x;
      this.z = clamped.z;
      // Matches Player.js/Enemies.js/arenaGeometry's yaw convention: yaw 0 =
      // -z, increasing clockwise. Cosmetic only — the billboard shader
      // ignores yaw entirely (Y-axis-only camera facing) — kept for a
      // future 3D-model swap and for HUD/debug use.
      this.yaw = Math.atan2(result.moveDir.x, -result.moveDir.z);
    } else if (result.action === 'attack') {
      if (target.kind === 'player') {
        world.player.takeDamage(def.dmg);
      } else {
        world.turrets?.damage?.(target.id, def.dmg);
      }
      this._audio.play('zombie-attack-1');
    } else if (result.action === 'cast' && result.spawnAdd) {
      this._spawnAdd(world);
    }

    this._updateBillboard(result, moving);
  }

  /**
   * Nearest of {player, alive turrets} — the melee branch of
   * `core/enemyBrain.chooseTarget`, reimplemented directly rather than
   * called: that function keys its `typeDef` lookup off
   * `cfg.enemies.types[enemy.type]`, and the boss's def lives in
   * `cfg.bosses` instead, so adapting its signature would cost more than
   * this handful of lines.
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
   * @param {{action:string, castProgress:number}} result
   * @param {boolean} moving
   */
  _updateBillboard(result, moving) {
    if (this._slotId < 0) return;
    const cfg = this._cfg;
    const def = this._def;
    const anim = bob(this._walkPhase, moving ? def.speed : 0, cfg);
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
    // system to key off (see `docs/INTERFACES.md`'s "P5 additions").
    this._bus.emit('enemy:killed', {
      idx: -1, type: 'patapim', boss: true, x: this.x, z: this.z, source, energy: def.energy, coins: def.coins,
    });
    if (this._slotId >= 0) {
      this._billboards.free(this._slotId);
      this._slotId = -1;
    }
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
  }
}
