// The run's orchestrator: owns the fixed-step loop, the state machine, the
// `world` bag every system reads/writes, and the `registerSystem` hook P3/P4/
// P5 attach `Enemies`/`Turrets`/`Boss` through. See `docs/INTERFACES.md` for
// the full contract (`world` shape, event names, `getSnapshot`).
//
// P3 wired the wave loop: `build` spawns via `SpawnScheduler` into
// `Enemies`, `wave` clears into `waveClear` once the scheduler is done and
// nothing is left alive, `waveClear` either loops back to `build` (wave+1)
// or — on the final wave — chains straight into `runEnd` (see the
// `waveClear -> runEnd` edge in `core/stateMachine.js`).
//
// P6 (this pass) replaces P3's placeholder toast-and-return-to-title with
// the real flow: a combo tracker that pays coins into `economy.pendingCoins`
// on every ended streak, `death` awaiting the player's revive/end-run choice
// through `ui/Screens.js` (with an actual once-per-run revive, pushed back
// via a stun rather than a reposition — see `_pushEnemiesFromPlayer`'s
// comment), `runEnd` awaiting play-again/title (with an optional coin
// doubler loop), and `game.save` persisted through `core/storage.js` +
// `platform/storage.js`. `game.hooks` is P7's seam into all of this: the
// default no-ads implementations below make every ad-gated choice behave as
// if the player always declined, so the whole flow works (and is fully
// playable) before P7 lands.
import * as THREE from 'three';
import { EventBus } from '../core/events.js';
import { GameStateMachine } from '../core/stateMachine.js';
import { Economy } from '../core/economy.js';
import { ComboTracker } from '../core/combo.js';
import { makeRng } from '../core/rng.js';
import { pickActiveGates, waveDef, flattenSpawns } from '../core/waves.js';
import { SpawnScheduler } from '../core/spawner.js';
import { slotPositions } from '../core/arenaGeometry.js';
import { loadSave, saveSave } from '../core/storage.js';
import { coinsForRun, applyDoubler, bestWaveAfter } from '../core/runFlow.js';
import { storageIO } from '../platform/storage.js';
import { Player } from './Player.js';
import { Arena } from './Arena.js';
import { Effects } from './Effects.js';
import { Enemies } from './Enemies.js';
import { Billboards } from './Billboards.js';

const FIXED_STEP_SAFETY_MAX_ITERATIONS = 8;
const DEBUG_REFRESH_S = 0.5;

const HIT_PARTICLE_COLOR = 0xffdd88;
const HIT_PARTICLE_COUNT = 6;

// Reused across every shot (`_handleFiring`) instead of a fresh
// `THREE.Vector3` per shot — `Effects#tracer` copies both endpoints into its
// own pooled `Tracer` immediately (`t.a.copy(a); t.b.copy(b);`), so handing
// it a shared scratch vector is safe (see `docs/INTERFACES.md`'s Effects
// section) and this file never needs to allocate one at fire time.
const _tracerEnd = new THREE.Vector3();

// See `_pushEnemiesFromPlayer`: `Enemies` (P3, frozen contract — see
// `docs/INTERFACES.md`) exposes no way to move an enemy's position from
// outside, only `applySlow(idx, factor, durS)`. A revive's "push enemies
// away" is therefore approximated as a near-stun (a very small speed
// multiplier) for the same duration as the post-revive invulnerability,
// rather than an actual knockback — see the P6 report's deviations list.
const REVIVE_STUN_FACTOR = 0.05;

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
   * @param {import('../ui/Screens.js').Screens} deps.screens P6 addition — see "P6 additions" in docs/INTERFACES.md.
   * @param {Partial<Game['hooks']>} [deps.hooks] P7 addition — real
   *   implementations for some/all of `hooks`, applied over the no-ads
   *   defaults below BEFORE this constructor's own dev-shortcut/title-screen
   *   dispatch runs at the bottom. Passed in here (rather than assigned onto
   *   `game.hooks` after construction, the pattern every other consumer of
   *   this seam uses) specifically so the `?wave=N` dev shortcut — which can
   *   call `hooks.onRunStart` synchronously from inside this very
   *   constructor — sees the real implementation too, not the default no-op.
   */
  constructor({ renderer, scene, camera, assets, input, hud, audio, config, screens, hooks }) {
    this._renderer = renderer;
    this._scene = scene;
    this._camera = camera;
    this._assets = assets;
    this._input = input;
    this._hud = hud;
    this._audio = audio;
    this._config = config;
    this._screens = screens;

    this.bus = new EventBus();
    this.state = new GameStateMachine('boot');

    // P7's seam: every ad-gated choice defaults to "no ad, declined" so the
    // whole run-end/death/title flow is playable without the Poki SDK.
    // `onRunStart`/`onRunStop` are named hook points for P7's
    // `commercialBreak`/`gameplayStart`/`gameplayStop` wiring — optional
    // (called with `?.()`), so `null` is a valid no-op default.
    this.hooks = {
      /** @returns {Promise<boolean>} */
      requestRevive: async () => false,
      /** @returns {Promise<boolean>} */
      requestDoubler: async () => false,
      /** @type {(() => void)|null} Called synchronously at the very start of every fresh run (title/runEnd's Play/Play Again, and the `?wave=N` dev shortcut). */
      onRunStart: null,
      /** @type {(() => void)|null} Called synchronously the moment gameplay stops for good this run (entering `death`, or clearing the final wave) — pairs with Poki's `gameplayStop()`. */
      onRunStop: null,
      /**
       * P7 additions: the manual pause toggle (`togglePause()`, wired to
       * `InputFrame`-adjacent Escape / the touch HUD's pause button — see
       * `_setManualPause`) calls these instead of touching any platform
       * module directly, mirroring `onRunStart`/`onRunStop`'s seam.
       * @type {(() => void)|null} Called synchronously on entering the manual pause.
       */
      onPause: null,
      /** @type {(() => void)|null} Called synchronously on leaving the manual pause. */
      onResume: null,
      ...hooks,
    };

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
    this._combo = new ComboTracker(config);
    this._wave = 1;
    this._buildTimer = 0;
    this._prevGatePair = null;
    this._gateRng = makeRng((Date.now() ^ 0x9e3779b9) >>> 0);

    // Persisted save data, loaded once at boot; `saveSave` merges+persists a
    // patch and returns the sanitized whole, which is what we keep as the
    // running in-memory copy.
    this._io = storageIO;
    this._save = loadSave(this._io);

    /** @type {import('../core/spawner.js').SpawnScheduler|null} */
    this._scheduler = null;
    this._currentWaveDef = null;
    this._waveClearTimer = 0;
    this._deathTimer = 0;
    this._reviveUsed = false;
    this._awaitingDeathDecision = false;

    this._paused = false;
    this._lastHp = undefined;
    this._lastMs = null;
    this._accumulator = 0;
    this._rafId = null;

    // Manual pause (Escape / the touch HUD's pause button — see
    // `togglePause`). Deliberately independent of `_paused` (which also
    // covers the ad-break and tab-hidden pauses): a raw `keydown` listener,
    // not `InputFrame.pause`, because `Input.frame()` zeroes every field
    // (`pause` included) while input is frozen — which `pause()` itself
    // does — so the fixed-step loop could never observe an "unpause" key
    // through the normal frame pipeline once paused (the loop is also not
    // ticking at all while `_paused`). Mirrors `ui/Screens.js`'s own
    // pattern of a dedicated `window` `keydown` listener for exactly this
    // reason.
    this._manualPaused = false;
    this._onEscapeKey = (e) => {
      if (e.key !== 'Escape') return;
      this._togglePauseGuarded();
    };
    window.addEventListener('keydown', this._onEscapeKey);

    this._tick = this._tick.bind(this);
    this._onResize = this._resize.bind(this);
    this._onVisibility = () => {
      if (document.hidden) this.pause();
      // A backgrounded-then-restored tab must not silently cancel a manual
      // pause the player set before backgrounding — `togglePause()`/Escape
      // remains the only way out of that one.
      else if (!this._manualPaused) this.resume();
    };
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);

    this.bus.on('enemy:killed', (e) => {
      this._economy.addEnergy(e.energy);
      this._combo.onKill(this.world.time);
      // P5's `Boss.js` tags a boss kill's payload with `boss:true` and
      // `coins` (see docs/INTERFACES.md's P5 additions) — energy is added
      // above unconditionally like any other kill (it's already on every
      // `enemy:killed` payload), coins only for the boss.
      if (e.boss) this._economy.addCoins(e.coins);
    });

    // Cursor/pointer-lock policy follows the state machine — see
    // `_syncPointerLock`. Subscribed (rather than called from each of the
    // eight `state:changed` emit sites) so no future transition can forget.
    this.bus.on('state:changed', () => this._syncPointerLock());

    this._setupDebug();

    const devWave = this._parseDevWaveParam();
    this.state.go('title');
    this.bus.emit('state:changed', { state: 'title' });
    if (devWave !== null) {
      this._startRun(devWave);
    } else {
      this._showTitleScreen();
    }
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
    this._syncPointerLock();
  }

  /**
   * Reverses `pause()`. Idempotent. Leaves input frozen if a screen
   * (`ui/Screens.js`) is currently up — e.g. the tab was backgrounded and
   * restored while the death screen is waiting on a choice — so this never
   * fights that screen's own freeze; the screen's own `hide()` is what
   * unfreezes input once its outcome is acted on.
   */
  resume() {
    if (!this._paused) return;
    this._paused = false;
    if (!this._screens.isOpen) this._input.freeze(false);
    this._audio.resume();
    this._syncPointerLock();
  }

  /**
   * Hands the pointer to gameplay, or gives it back. Playing a wave means
   * pointer lock on desktop (no system cursor, unclamped mouse look); the
   * build overlay, the pause panel and every `ui/Screens.js` screen are
   * pointed-and-clicked, so they need the cursor back. `Input` decides what
   * that means per scheme — touch has neither cursor nor lock.
   *
   * Called from every path that can change the answer: `state:changed` (via
   * the constructor's subscription), and `pause()`/`resume()`, which also
   * covers ad breaks, a backgrounded tab and the manual pause. A browser is
   * free to refuse the lock (it carries no user gesture outside the Ready
   * button's own click); `KeyboardMouse`'s click path is the backstop and
   * the `hide-cursor` class hides the cursor over the canvas either way.
   */
  _syncPointerLock() {
    const playing = !this._paused
      && !this._screens.isOpen
      && (this.state.state === 'wave' || this.state.state === 'waveClear');
    this._input.setPointerLockWanted?.(playing);
  }

  /** @returns {import('../core/economy.js').Economy} Read-only usage by P4/P5/P6 — only `Game` replaces the instance (new run). */
  get economy() {
    return this._economy;
  }

  /** @returns {import('../core/combo.js').ComboTracker} P6 addition. Read-only usage — only `Game` replaces the instance (new run). */
  get combo() {
    return this._combo;
  }

  /** @returns {import('../core/types.js').SaveData} P6 addition. Read-only usage — only `Game` persists via `core/storage.js#saveSave`. */
  get save() {
    return this._save;
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
      // Run total, the same banked+pending sum `_syncHud` shows — the build
      // overlay reads it because the HUD is hidden while the overlay is up.
      coins: this._economy.bankedCoins + this._economy.pendingCoins,
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
    window.removeEventListener('keydown', this._onEscapeKey);
    this.world.arena.dispose();
    this.world.effects.dispose();
  }

  /**
   * Toggles the manual pause — Escape, or the touch HUD's pause button (see
   * `ui/Hud.js#onPauseTap`). A no-op while a screen is open, mid-ad, or
   * outside `build`/`wave` (nothing meaningful to pause).
   */
  togglePause() {
    this._togglePauseGuarded();
  }

  /**
   * Shared by `togglePause()` and the raw Escape listener. Unpausing is
   * always allowed once `_manualPaused` is actually true; entering it
   * additionally requires `!this._paused` — **not** already paused for some
   * other reason (an ad, a backgrounded tab) — on top of being open while a
   * screen is up or outside `build`/`wave`. Without the `!this._paused`
   * check, pressing Escape *during* an ad (the raw listener bypasses
   * `Input.freeze()`, unlike `InputFrame.pause` — see the constructor's
   * comment on `_onEscapeKey`) could set `_manualPaused = true` while
   * `game.pause()` was already active for the ad; the ad's own `resume()`
   * would then clear `_paused` without ever knowing to clear
   * `_manualPaused` too, leaving the "PAUSED" panel stuck up and the two
   * flags desynced.
   */
  _togglePauseGuarded() {
    if (this._screens.isOpen) return;
    if (this._manualPaused) {
      this._setManualPause(false);
    } else if (!this._paused && (this.state.state === 'build' || this.state.state === 'wave')) {
      this._setManualPause(true);
    }
  }

  /**
   * @param {boolean} paused
   */
  _setManualPause(paused) {
    if (paused === this._manualPaused) return;
    this._manualPaused = paused;
    this._hud.setPaused(paused);
    if (paused) {
      this.pause();
      this.hooks.onPause?.();
    } else {
      this.resume();
      this.hooks.onResume?.();
    }
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
    this._updateCombo();

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
      // Screen-driven (ui/Screens.js's Play button / Enter / tap-anywhere) —
      // see `_showTitleScreen`. Nothing to poll here.
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
      if (this._deathTimer <= 0 && !this._awaitingDeathDecision) {
        this._awaitingDeathDecision = true;
        this._runDeathFlow();
      }
      return;
    }

    // 'runEnd' is fully screen/Promise-driven (see `_runRunEndFlow`) — no
    // per-frame polling needed.
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
    this._save = saveSave(this._io, { bestWave: bestWaveAfter(this._save.bestWave, this._wave) });

    this.state.go('waveClear');
    this.bus.emit('wave:cleared', { wave: this._wave });
    this.bus.emit('state:changed', { state: 'waveClear' });

    if (this._wave >= this._config.run.finalWave) {
      // Victory — chain straight into runEnd (see the `waveClear -> runEnd`
      // edge in `core/stateMachine.js`). Gameplay has definitively stopped
      // here, same as a death — see `hooks.onRunStop`'s doc comment.
      this.hooks.onRunStop?.();
      this.state.go('runEnd');
      this.bus.emit('state:changed', { state: 'runEnd' });
      this._runRunEndFlow(true);
      return;
    }

    this._waveClearTimer = this._config.timing.waveClearDelayS;
  }

  /** Shows the title screen (boot, and after a run ends and the player picks "title"). */
  _showTitleScreen() {
    this._hud.show(false);
    this._screens.showTitle({
      bestWave: this._save.bestWave,
      coins: this._save.coins,
      credits: this._config.credits,
      onPlay: () => this._startRun(),
    });
  }

  /**
   * Runs the death screen's revive/end-run choice to its conclusion, then
   * either resumes the wave (revive) or moves on to `runEnd`. Guarded by
   * `_awaitingDeathDecision` so the fixed-step loop (which keeps ticking
   * while this `await`s) never starts a second one.
   */
  async _runDeathFlow() {
    this._hud.show(false);
    const canRevive = !(this._config.run.reviveOncePerRun && this._reviveUsed);
    const choice = await this._screens.showDeath({ wave: this._wave, canRevive });

    if (choice === 'revive' && canRevive) {
      const granted = await this.hooks.requestRevive();
      if (granted) {
        this._reviveUsed = true;
        this._awaitingDeathDecision = false;
        this._doRevive();
        return;
      }
    }

    this._awaitingDeathDecision = false;
    this.state.go('runEnd');
    this.bus.emit('state:changed', { state: 'runEnd' });
    this._runRunEndFlow(false);
  }

  /**
   * Full hp, brief invulnerability, and enemies near the player stunned for
   * the same window — see `REVIVE_STUN_FACTOR`'s comment on why this is a
   * stun, not a reposition. Unlike every other screen outcome, nothing else
   * mounts a fresh screen right after this one, so this is the one call
   * site that must explicitly `screens.hide()` rather than relying on the
   * next `_open()` to clean up the previous screen for it.
   */
  _doRevive() {
    this._screens.hide();
    const p = this._config.player;
    this.world.player.hp = p.hp;
    this.world.player.alive = true;
    this.world.player.invulnUntil = this.world.time + p.invulnAfterReviveS;
    this._pushEnemiesFromPlayer();
    this._hud.show(true);
    this.state.go('wave');
    this.bus.emit('state:changed', { state: 'wave' });
  }

  /**
   * "Push enemies away" on revive: every enemy within `revivePushRadius` of
   * the player is thrown radially outwards (`Enemies#knockback`, the same
   * hit-reaction impulse a bullet lands, so the shove is visible — bodies
   * lean and stagger back) and stunned (`applySlow` at a near-zero speed
   * factor) for `invulnAfterReviveS` seconds, the same window the player is
   * invulnerable for.
   */
  _pushEnemiesFromPlayer() {
    const p = this._config.player;
    const r2 = p.revivePushRadius * p.revivePushRadius;
    const px = this.world.player.x;
    const pz = this.world.player.z;
    for (const e of this.world.enemies.positions()) {
      const dx = e.x - px;
      const dz = e.z - pz;
      if (dx * dx + dz * dz <= r2) {
        this.world.enemies.knockback(e.idx, { x: dx, z: dz }, p.revivePushSpeed);
        this.world.enemies.applySlow(e.idx, REVIVE_STUN_FACTOR, p.invulnAfterReviveS);
      }
    }
  }

  /**
   * Awaits the run-end screen to its conclusion — looping once through a
   * coin-doubler ad if the player asks for one — then persists coins and
   * either starts a fresh run or returns to the title screen.
   * @param {boolean} victory
   */
  async _runRunEndFlow(victory) {
    this._hud.show(false);
    let earned = this._economy.bankedCoins; // Already final: banked on every clean wave clear, discarded (not included) on death. Never depends on an ad.
    let canDouble = true;
    let action;

    // A loop, not a single await: sequential by design — each iteration is
    // one player decision, and "double" re-shows the screen with the (now
    // possibly doubled) total and the doubler option gone.
    for (;;) {
      action = await this._screens.showRunEnd({
        wave: this._wave,
        victory,
        coinsEarned: earned,
        coinsTotal: this._save.coins + earned,
        canDouble,
      });
      if (action !== 'double') break;
      canDouble = false; // One doubler offer per run-end, win or decline.
      const granted = await this.hooks.requestDoubler();
      if (granted) earned = applyDoubler(earned, true);
    }

    this._save = saveSave(this._io, { coins: coinsForRun(this._save.coins, earned) });

    if (action === 'again') {
      this._startRun();
    } else {
      this.state.go('title');
      this.bus.emit('state:changed', { state: 'title' });
      this._showTitleScreen();
    }
  }

  /**
   * @param {number} [startWave] Dev-only (`?wave=N`): begin the run already
   * at this wave's build phase instead of wave 1.
   */
  _startRun(startWave = 1) {
    this.hooks.onRunStart?.();
    this._screens.hide();
    this._hud.show(true);
    this.state.go('build');
    this.world.player.reset();
    this.world.enemies?.clear();
    this._wave = startWave;
    this._economy = new Economy(this._config);
    this._combo = new ComboTracker(this._config);
    this._reviveUsed = false;
    this._awaitingDeathDecision = false;
    this._scheduler = null;
    this._currentWaveDef = null;
    this._buildTimer = this._config.build.durationS;
    this._pickGates();
    this._hud.setWave(this._wave, this._config.run.finalWave);
    this._hud.setCombo(0, 0);
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
    const enemyHit = this.world.enemies?.raycast?.(shot.origin, shot.dir, gun.range) ?? null;
    // The boss renders through `Billboards`, not `Enemies`' pool, so it needs
    // its own cylinder test alongside the enemy raycast — see `Boss#hitTest`
    // and `docs/INTERFACES.md`'s P5 "Player firing" compromise note this
    // fixes. Only the NEARER of the two hits takes damage: a shot can never
    // hit both an enemy and the boss standing behind (or in front of) it.
    const bossHit = this.world.boss?.alive ? this.world.boss.hitTest(shot.origin, shot.dir, gun.range) : null;

    let hitPoint = null;
    if (bossHit && (!enemyHit || bossHit.dist < enemyHit.dist)) {
      this.world.boss.damage(gun.dmg, 'player');
      hitPoint = bossHit.point;
    } else if (enemyHit) {
      // Knockback follows the shot: the body is shoved along the bullet's
      // horizontal direction, so it reads as reacting to *this* hit.
      this.world.enemies.damageAt(enemyHit.idx, gun.dmg, 'player', { x: shot.dir.x, z: shot.dir.z });
      hitPoint = enemyHit.point;
    }

    let tracerEnd;
    if (hitPoint) {
      _tracerEnd.set(hitPoint.x, hitPoint.y, hitPoint.z);
      tracerEnd = _tracerEnd;
      this.world.effects.burst(hitPoint.x, hitPoint.y, hitPoint.z, HIT_PARTICLE_COLOR, HIT_PARTICLE_COUNT);
    } else {
      _tracerEnd.copy(shot.origin).addScaledVector(shot.dir, gun.range);
      tracerEnd = _tracerEnd;
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
      this.hooks.onRunStop?.();
      this.state.go('death');
      this.bus.emit('state:changed', { state: 'death' });
    }
  }

  /**
   * Polls the combo tracker every fixed step (its own contract —
   * `core/combo.js`'s doc comment). Banks a payout the instant a streak
   * ends with `coins > 0`, and keeps the HUD combo bar (kill count + this
   * tier's payout, from `Hud#setCombo`) current every step regardless.
   */
  _updateCombo() {
    const result = this._combo.update(this.world.time);
    if (result.ended && result.coins > 0) {
      this._economy.addCoins(result.coins);
      this._hud.toast(`COMBO x${result.kills} +${result.coins}`);
      this._audio.play('coin');
    }
    this._hud.setCombo(result.kills, this._combo.remaining(this.world.time));
  }

  _syncHud() {
    this._hud.setHp(this.world.player.hp, this._config.player.hp);
    this._hud.setEnergy(this._economy.energy);
    this._hud.setCoins(this._economy.bankedCoins + this._economy.pendingCoins);
  }
}
