// The run's orchestrator: owns the fixed-step loop, the state machine, the
// `world` bag every system reads/writes, and the `registerSystem` hook P3/P4/
// P5 attach `Enemies`/`Turrets`/`Boss` through. See `docs/INTERFACES.md` for
// the full contract (`world` shape, event names, `getSnapshot`).
//
// P3 wires the full wave loop: `build` spawns via `SpawnScheduler` into
// `Enemies`, `wave` clears into `waveClear` once the scheduler is done and
// nothing is left alive, `waveClear` either loops back to `build` (wave+1) or
// — on the final wave — chains straight into `runEnd` (see the added
// `waveClear -> runEnd` edge in `core/stateMachine.js`), and `death` (already
// wired by P2) now also discards pending coins and, after a short delay,
// moves on to `runEnd`. `runEnd` itself is a placeholder toast + delay until
// P6 builds the real screen.
import * as THREE from 'three';
import { EventBus } from '../core/events.js';
import { GameStateMachine } from '../core/stateMachine.js';
import { Economy } from '../core/economy.js';
import { makeRng } from '../core/rng.js';
import { pickActiveGates, waveDef, flattenSpawns } from '../core/waves.js';
import { SpawnScheduler } from '../core/spawner.js';
import { slotPositions } from '../core/arenaGeometry.js';
import { Player } from './Player.js';
import { Arena } from './Arena.js';
import { Effects } from './Effects.js';
import { Enemies } from './Enemies.js';
import { Billboards } from './Billboards.js';

const FIXED_STEP_SAFETY_MAX_ITERATIONS = 8;
const DEBUG_REFRESH_S = 0.5;

// P6 owns the real run-end screen; until then this is how long the
// "ARENA CLEARED"/"YOU DIED" toast stays up before looping back to title.
// Not a `config.js` value because it belongs to a screen that doesn't exist
// yet — P6 should move it there once it does.
const RUN_END_DISPLAY_S = 3;

const HIT_PARTICLE_COLOR = 0xffdd88;
const HIT_PARTICLE_COUNT = 6;

/**
 * @param {import('../core/types.js').InputFrame} frame
 * @returns {boolean}
 */
function hasAnyInput(frame) {
  return frame.fire || frame.ready || frame.pause || frame.select !== 0
    || frame.moveX !== 0 || frame.moveY !== 0
    || Math.abs(frame.lookDX) > 0 || Math.abs(frame.lookDY) > 0;
}

export class Game {
  /**
   * @param {object} deps
   * @param {import('three').WebGLRenderer} deps.renderer
   * @param {import('three').Scene} deps.scene
   * @param {import('three').PerspectiveCamera} deps.camera
   * @param {import('./assets.js').Assets} deps.assets
   * @param {import('../ui/input.js').Input} deps.input
   * @param {import('../ui/Hud.js').Hud} deps.hud
   * @param {import('../platform/audio.js').Audio} deps.audio
   * @param {import('../core/types.js').GameConfig} deps.config
   */
  constructor({ renderer, scene, camera, assets, input, hud, audio, config }) {
    this._renderer = renderer;
    this._scene = scene;
    this._camera = camera;
    this._assets = assets;
    this._input = input;
    this._hud = hud;
    this._audio = audio;
    this._config = config;

    this.bus = new EventBus();
    this.state = new GameStateMachine('boot');

    const player = new Player(camera, assets, config);
    const arena = new Arena(scene, assets, config);
    const effects = new Effects(scene);
    // +1 reserves a slot for a boss billboard (P5's `Boss.js`, not yet
    // registered) on top of every enemy-cap-sized `tungtung`.
    const billboards = new Billboards(scene, assets, config, config.enemies.cap + 1);
    const enemies = new Enemies(scene, assets, config, this.bus, billboards, audio);

    /**
     * The one bag every system reads/writes. `turrets`/`boss` are `null`
     * until P4/P5 register their systems and populate them — everything
     * downstream reads them optional-chained (`world.turrets?.list() ?? []`).
     */
    this.world = {
      player,
      arena,
      enemies,
      turrets: null,
      boss: null,
      billboards,
      effects,
      bus: this.bus,
      time: 0,
      activeGates: [],
    };

    /** @type {{ name: string, system: { update(dt: number, world: object): void } }[]} */
    this._systems = [];
    this.registerSystem('enemies', enemies);

    this._economy = new Economy(config);
    this._wave = 1;
    this._buildTimer = 0;
    this._prevGatePair = null;
    this._gateRng = makeRng((Date.now() ^ 0x9e3779b9) >>> 0);

    /** @type {import('../core/spawner.js').SpawnScheduler|null} */
    this._scheduler = null;
    this._currentWaveDef = null;
    this._waveClearTimer = 0;
    this._deathTimer = 0;
    this._runEndTimer = 0;

    this._paused = false;
    this._lastHp = undefined;
    this._lastMs = null;
    this._accumulator = 0;
    this._rafId = null;

    this._tick = this._tick.bind(this);
    this._onResize = this._resize.bind(this);
    this._onVisibility = () => {
      if (document.hidden) this.pause();
      else this.resume();
    };
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);

    this.bus.on('enemy:killed', (e) => this._economy.addEnergy(e.energy));

    this._setupDebug();

    const devWave = this._parseDevWaveParam();
    this.state.go('title');
    this.bus.emit('state:changed', { state: 'title' });
    if (devWave !== null) this._startRun(devWave);
  }

  /**
   * `?wave=N` dev param: jumps straight to wave N's build phase instead of
   * waiting at the title screen. Used for owner verification (P5's boss at
   * wave 5, late-wave balance, etc.) — never touched by normal play.
   * @returns {number|null}
   */
  _parseDevWaveParam() {
    const raw = new URLSearchParams(location.search).get('wave');
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > this._config.run.finalWave) return null;
    return n;
  }

  /**
   * @param {string} name
   * @param {{ update(dt: number, world: object): void }} system
   */
  registerSystem(name, system) {
    this._systems.push({ name, system });
  }

  /** Starts the render/update loop. Call once, after construction. */
  start() {
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._resize();
    this._lastMs = performance.now();
    this._rafId = requestAnimationFrame(this._tick);
  }

  /** Stops the loop and freezes input/audio (ad breaks, tab hidden). Idempotent. */
  pause() {
    if (this._paused) return;
    this._paused = true;
    this._input.freeze(true);
    this._audio.suspend();
  }

  /** Reverses `pause()`. Idempotent. */
  resume() {
    if (!this._paused) return;
    this._paused = false;
    this._input.freeze(false);
    this._audio.resume();
  }

  /** @returns {import('../core/economy.js').Economy} Read-only usage by P4/P5/P6 — only `Game` replaces the instance (new run). */
  get economy() {
    return this._economy;
  }

  /** @returns {number} Current wave number, 1-based. */
  get wave() {
    return this._wave;
  }

  /** @returns {number[]} The current wave's lit gate id pair (same array as `world.activeGates`). */
  get activeGates() {
    return this.world.activeGates;
  }

  /** @returns {import('../core/spawner.js').SpawnScheduler|null} The active wave's spawn schedule, or `null` outside `wave`. */
  get scheduler() {
    return this._scheduler;
  }

  /**
   * Build-phase overlay snapshot (see the plan's "Build-phase overlay"
   * section). `turrets`/`slots` are placeholders until P4 lands.
   * @returns {{ wave: number, activeGates: number[], energy: number, economy: import('../core/economy.js').Economy, scheduler: import('../core/spawner.js').SpawnScheduler|null, player: {x:number,z:number,yaw:number}, turrets: any[], slots: any[] }}
   */
  getSnapshot() {
    return {
      wave: this._wave,
      activeGates: this.world.activeGates,
      energy: this._economy.energy,
      economy: this._economy,
      scheduler: this._scheduler,
      player: { x: this.world.player.x, z: this.world.player.z, yaw: this.world.player.yaw },
      turrets: this.world.turrets?.list?.() ?? [],
      slots: slotPositions(this._config),
    };
  }

  dispose() {
    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.world.arena.dispose();
    this.world.effects.dispose();
  }

  _setupDebug() {
    if (!location.search.includes('debug=1')) return;
    this._debugEl = document.createElement('div');
    this._debugEl.className = 'debug-stats';
    document.getElementById('ui').appendChild(this._debugEl);
    this._debugAccum = 0;
    this._debugFrames = 0;
  }

  /**
   * @param {number} frameDt
   */
  _debugTick(frameDt) {
    if (!this._debugEl) return;
    this._debugFrames++;
    this._debugAccum += frameDt;
    if (this._debugAccum < DEBUG_REFRESH_S) return;
    const fps = Math.round(this._debugFrames / this._debugAccum);
    const calls = this._renderer.info.render.calls;
    const alive = this.world.enemies?.alive ?? 0;
    const cap = this._config.enemies.cap;
    this._debugEl.textContent = `${fps} fps · ${calls} draws · ${alive}/${cap} alive`;
    this._debugAccum = 0;
    this._debugFrames = 0;
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  /**
   * @param {number} nowMs
   */
  _tick(nowMs) {
    let frameDt = (nowMs - this._lastMs) / 1000;
    this._lastMs = nowMs;
    frameDt = Math.min(frameDt, this._config.timing.maxFrameDt);

    if (!this._paused) {
      this._accumulator += frameDt;
      const step = this._config.timing.fixedStep;
      let iterations = 0;
      while (this._accumulator >= step && iterations < FIXED_STEP_SAFETY_MAX_ITERATIONS) {
        this._fixedStep(step);
        this._accumulator -= step;
        iterations++;
      }
    }

    this._renderer.render(this._scene, this._camera);
    this._debugTick(frameDt);
    this._rafId = requestAnimationFrame(this._tick);
  }

  /**
   * @param {number} dt
   */
  _fixedStep(dt) {
    this.world.time += dt;
    const frame = this._input.frame();

    this._advanceStateMachine(dt, frame);

    this.world.player.update(dt, frame);
    this._handleFiring(frame);

    for (const entry of this._systems) entry.system.update(dt, this.world);

    this._checkPlayerDamageAndDeath();

    this.world.effects.update(dt);

    this._syncHud();
  }

  /**
   * @param {number} dt
   * @param {import('../core/types.js').InputFrame} frame
   */
  _advanceStateMachine(dt, frame) {
    const state = this.state.state;

    if (state === 'title') {
      if (hasAnyInput(frame)) this._startRun();
      return;
    }

    if (state === 'build') {
      this._buildTimer -= dt;
      const secondsLeft = Math.max(0, this._buildTimer);
      this._hud.setBuildCountdown(Math.ceil(secondsLeft));
      this.bus.emit('build:tick', { secondsLeft });

      if (this._buildTimer <= 0 || frame.ready) {
        const refund = this._economy.readyRefund(secondsLeft, this._config);
        this._economy.addEnergy(refund);
        this._hud.setBuildCountdown(null);
        this.state.go('wave');
        this.bus.emit('state:changed', { state: 'wave' });
        this._startWave();
      }
      return;
    }

    if (state === 'wave') {
      this._waveTick(dt);
      return;
    }

    if (state === 'waveClear') {
      this._waveClearTimer -= dt;
      if (this._waveClearTimer <= 0) {
        this._wave += 1;
        this._buildTimer = this._config.build.durationS;
        this._pickGates();
        this._hud.setWave(this._wave, this._config.run.finalWave);
        this.state.go('build');
        this.bus.emit('state:changed', { state: 'build' });
      }
      return;
    }

    if (state === 'death') {
      this._deathTimer -= dt;
      if (this._deathTimer <= 0) {
        this.state.go('runEnd');
        this.bus.emit('state:changed', { state: 'runEnd' });
        this._runEndTimer = RUN_END_DISPLAY_S;
      }
      return;
    }

    if (state === 'runEnd') {
      this._runEndTimer -= dt;
      if (this._runEndTimer <= 0) {
        this.state.go('title');
        this.bus.emit('state:changed', { state: 'title' });
      }
    }
  }

  /**
   * Builds this wave's spawn schedule from `core/waves.js`, capped at
   * `min(def.maxAlive, cfg.enemies.cap)` — the cap check inside
   * `SpawnScheduler` is what actually enforces this every tick.
   */
  _startWave() {
    const def = waveDef(this._config, this._wave);
    this._currentWaveDef = def;
    const cap = Math.min(def.maxAlive, this._config.enemies.cap);
    this._scheduler = new SpawnScheduler(flattenSpawns(def), cap);
    this._audio.play('wave-start');
    this.bus.emit('wave:started', { wave: this._wave, boss: def.boss ?? null });
  }

  /**
   * @param {number} dt
   */
  _waveTick(dt) {
    if (this._scheduler) {
      const due = this._scheduler.update(dt, this.world.enemies.alive);
      for (const entry of due) {
        const gateId = this.world.activeGates[entry.gateId];
        this.world.enemies.spawn(entry.enemy, gateId, this._currentWaveDef.hpMul);
      }
    }

    // Boss support lands in P5; until `world.boss` exists this is always
    // true, so a boss wave with no `spawns` (wave 5 today) clears instantly.
    const bossAlive = this.world.boss?.alive ?? false;
    if (this._scheduler?.done && this.world.enemies.alive === 0 && !bossAlive) {
      this._onWaveClear();
    }
  }

  _onWaveClear() {
    this._economy.bankWave();
    this.state.go('waveClear');
    this.bus.emit('wave:cleared', { wave: this._wave });
    this.bus.emit('state:changed', { state: 'waveClear' });

    if (this._wave >= this._config.run.finalWave) {
      // Victory — chain straight into runEnd (see the added
      // `waveClear -> runEnd` edge in `core/stateMachine.js`). P6 replaces
      // this toast-and-wait with the real run-end screen.
      this._hud.toast('ARENA CLEARED');
      this.state.go('runEnd');
      this.bus.emit('state:changed', { state: 'runEnd' });
      this._runEndTimer = RUN_END_DISPLAY_S;
      return;
    }

    this._waveClearTimer = this._config.timing.waveClearDelayS;
  }

  /**
   * @param {number} [startWave] Dev-only (`?wave=N`): begin the run already
   * at this wave's build phase instead of wave 1.
   */
  _startRun(startWave = 1) {
    this.state.go('build');
    this.world.player.reset();
    this.world.enemies?.clear();
    this._wave = startWave;
    this._economy = new Economy(this._config);
    this._scheduler = null;
    this._currentWaveDef = null;
    this._buildTimer = this._config.build.durationS;
    this._pickGates();
    this._hud.setWave(this._wave, this._config.run.finalWave);
    this.bus.emit('state:changed', { state: 'build' });
  }

  _pickGates() {
    const pair = pickActiveGates(this._gateRng, this._prevGatePair);
    this._prevGatePair = pair;
    this.world.arena.setActiveGates(pair);
    this.world.activeGates = pair;
  }

  /**
   * @param {import('../core/types.js').InputFrame} frame
   */
  _handleFiring(frame) {
    const targets = this.world.enemies?.targets?.() ?? [];
    const targetIndex = this.world.player.aimTarget(targets);
    this._hud.setReticle(targetIndex >= 0);

    const shouldFire = frame.mode === 'touch' ? targetIndex >= 0 : frame.fire;
    if (!shouldFire) return;

    const shot = this.world.player.fire();
    if (!shot) return;

    const gun = this._config.player.gun;
    const hit = this.world.enemies?.raycast?.(shot.origin, shot.dir, gun.range) ?? null;

    let tracerEnd;
    if (hit) {
      this.world.enemies.damageAt(hit.idx, gun.dmg, 'player');
      tracerEnd = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
      this.world.effects.burst(hit.point.x, hit.point.y, hit.point.z, HIT_PARTICLE_COLOR, HIT_PARTICLE_COUNT);
    } else {
      tracerEnd = shot.origin.clone().addScaledVector(shot.dir, gun.range);
    }

    this.world.effects.tracer(shot.origin, tracerEnd);
    this._audio.play('pistol-shot-1');
    this.bus.emit('player:fired', { origin: shot.origin, dir: shot.dir });
  }

  _checkPlayerDamageAndDeath() {
    const hp = this.world.player.hp;
    if (this._lastHp === undefined) this._lastHp = hp;
    if (hp < this._lastHp) {
      this.bus.emit('player:damaged', { hp, amount: this._lastHp - hp });
    }
    this._lastHp = hp;

    if (this.state.state === 'wave' && !this.world.player.alive) {
      this._economy.discardPending();
      this._deathTimer = this._config.timing.deathScreenDelayS;
      this.state.go('death');
      this.bus.emit('state:changed', { state: 'death' });
      this._hud.toast('YOU DIED');
    }
  }

  _syncHud() {
    this._hud.setHp(this.world.player.hp, this._config.player.hp);
    this._hud.setEnergy(this._economy.energy);
  }
}
