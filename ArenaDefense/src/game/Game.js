// The run's orchestrator: owns the fixed-step loop, the state machine, the
// `world` bag every system reads/writes, and the `registerSystem` hook P3/P4/
// P5 attach `Enemies`/`Turrets`/`Boss` through. See `docs/INTERFACES.md` for
// the full contract (`world` shape, event names, `getSnapshot`).
//
// P2 wires only `boot -> title -> build -> wave`, with `build` timing out (or
// "Ready") into `wave` and `wave` dropping to `death` on `hp <= 0` — the rest
// of the state machine (`waveClear`, `runEnd`, revive) is a later package's
// job; `wave` simply has nothing that ever clears it yet, which is expected
// until P3's spawner/enemies land.
import { EventBus } from '../core/events.js';
import { GameStateMachine } from '../core/stateMachine.js';
import { Economy } from '../core/economy.js';
import { makeRng } from '../core/rng.js';
import { pickActiveGates } from '../core/waves.js';
import { slotPositions } from '../core/arenaGeometry.js';
import { Player } from './Player.js';
import { Arena } from './Arena.js';
import { Effects } from './Effects.js';

const FIXED_STEP_SAFETY_MAX_ITERATIONS = 8;
const DEBUG_REFRESH_S = 0.5;

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

    /**
     * The one bag every system reads/writes. `enemies`/`turrets`/`boss`/
     * `billboards` are `null` until P3/P4/P5 register their systems and
     * populate them — everything downstream reads them optional-chained.
     */
    this.world = {
      player,
      arena,
      enemies: null,
      turrets: null,
      boss: null,
      billboards: null,
      effects,
      bus: this.bus,
      time: 0,
      activeGates: [],
    };

    /** @type {{ name: string, system: { update(dt: number, world: object): void } }[]} */
    this._systems = [];

    this._economy = new Economy(config);
    this._wave = 1;
    this._buildTimer = 0;
    this._prevGatePair = null;
    this._gateRng = makeRng((Date.now() ^ 0x9e3779b9) >>> 0);

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

    this._setupDebug();

    this.state.go('title');
    this.bus.emit('state:changed', { state: 'title' });
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

  /**
   * Build-phase overlay snapshot (see the plan's "Build-phase overlay"
   * section). `turrets`/`slots` are placeholders until P4 lands.
   * @returns {{ wave: number, activeGates: number[], energy: number, player: {x:number,z:number,yaw:number}, turrets: any[], slots: any[] }}
   */
  getSnapshot() {
    return {
      wave: this._wave,
      activeGates: this.world.activeGates,
      energy: this._economy.energy,
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
    this._debugEl.textContent = `${fps} fps · ${calls} draws`;
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
      }
    }
  }

  _startRun() {
    this.state.go('build');
    this.world.player.reset();
    this._wave = 1;
    this._economy = new Economy(this._config);
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

    const end = shot.origin.clone().addScaledVector(shot.dir, this._config.player.gun.range);
    this.world.effects.tracer(shot.origin, end);
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
      this.state.go('death');
      this.bus.emit('state:changed', { state: 'death' });
    }
  }

  _syncHud() {
    this._hud.setHp(this.world.player.hp, this._config.player.hp);
    this._hud.setEnergy(this._economy.energy);
  }
}
