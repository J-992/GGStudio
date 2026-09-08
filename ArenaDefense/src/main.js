// Entry point: Poki lifecycle hooks fire in the right order, assets load
// with a visible progress bar, the arena/player/HUD come up, and the loading
// screen comes down. Every path used here is either relative or driven by
// `window.__ASSET_BASE__`; nothing is fetched via `import.meta.env.BASE_URL`.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Input } from './ui/input.js';
import { loadAll } from './game/assets.js';
import { Hud } from './ui/Hud.js';
import { Screens } from './ui/Screens.js';
import { Audio } from './platform/audio.js';
import { Platform } from './platform/poki.js';
import { loadMuted, saveMuted } from './platform/storage.js';
import { Game } from './game/Game.js';
import { Turrets } from './game/Turrets.js';
import { BuildOverlay } from './ui/BuildOverlay.js';
import { installBuildPhase } from './game/buildPhase.js';
import { Boss } from './game/Boss.js';
import { installBoss } from './game/bossPhase.js';

// `platform/poki.js` is the only module allowed to touch `window.PokiSDK`
// (see `AGENTS.md`) — constructing it also installs the `?poki=mock`
// recorder, if requested, before anything else runs.
const platform = new Platform(CONFIG);

// Must run before anything else: a slow-loading bundle should still count
// its loading time from as early as possible. `Platform#gameLoadingStart`
// never throws, even if the SDK script failed to load or doesn't exist
// (plain, non-Poki build).
platform.gameLoadingStart();

boot();

async function boot() {
  loadDisplayFont();

  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('scene'));
  const loading = document.getElementById('loading');
  const loadingStatus = loading?.querySelector('.loading-status');

  // Constructed before assets finish loading so touch/keyboard detection and
  // silent input-swap are live the instant the page paints.
  const input = new Input(canvas, CONFIG);

  // Runs alongside the asset load rather than blocking it — a slow/absent
  // SDK must never delay first paint. `Platform#init()` never rejects.
  const [assets] = await Promise.all([
    loadAll((progress) => {
      if (loadingStatus) loadingStatus.textContent = `Loading… ${Math.round(progress * 100)}%`;
    }),
    platform.init(),
  ]);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
  // `Player` parents the gun viewmodel to `camera` (so it moves/recoils with
  // the view). `renderer.render(scene, camera)` only ever traverses `scene`
  // looking for things to draw, so unless `camera` itself is somewhere in
  // that graph, its children are invisible — added here, not in Player,
  // since owning the scene graph's shape is main.js's job.
  scene.add(camera);

  const hud = new Hud(CONFIG);
  const audio = new Audio(assets);
  // Restore the player's saved mute preference before anything plays a
  // sound. Stored under its own localStorage key (`arenadefense.muted`, via
  // `platform/storage.js`) — deliberately NOT part of `core/storage.js`'s
  // `{coins, bestWave, unlocks}` save shape.
  const initialMuted = loadMuted();
  audio.setMuted(initialMuted);
  hud.setMuted(initialMuted);
  hud.onMuteTap((muted) => {
    audio.setMuted(muted);
    saveMuted(muted);
  });

  // Title/death/run-end screens (P6) — constructed before `Game` since its
  // constructor drives the title screen synchronously; see
  // docs/INTERFACES.md's "P6 additions". `platform` lets Screens hide the
  // revive/doubler buttons when there's no ad to show (see P7 additions).
  const screens = new Screens(CONFIG, input, audio, platform);

  // P7's seam into every ad-gated decision and the two Poki lifecycle call
  // points `Game.js` couldn't itself make real (see docs/INTERFACES.md's P6
  // additions for the defaults these replace). Built as a plain object and
  // passed into the constructor below — rather than assigned onto
  // `game.hooks` afterward — so the `?wave=N` dev shortcut (which can call
  // `hooks.onRunStart` synchronously from inside the constructor itself) also
  // gets the real implementation, not the default no-op. `onResume`/
  // `onPause` close over `game`, declared but not yet assigned here — by the
  // time either callback actually runs, `game` has always been assigned
  // (both only ever fire well after construction completes).
  let game;
  const hooks = {
    onRunStart: () => platform.commercialBreak().then(() => platform.gameplayStart()),
    onRunStop: () => platform.gameplayStop(),
    // `requestDoubler` never restarts gameplay — the doubler is offered on
    // the run-end screen, while gameplay is already stopped for the run and
    // stays stopped regardless of the outcome. `requestRevive` is the one
    // rewarded break that DOES resume gameplay on a grant — chained here
    // rather than relying on the generic `onAdState('none')` re-issue below,
    // since at the instant that fires the game is still in `death` (state
    // only flips to `wave` a tick later, in `Game.js#_doRevive`) — see the
    // P7 report's adversarial re-read for the full trace.
    requestRevive: async () => {
      const granted = await platform.rewardedBreak();
      if (granted) platform.gameplayStart();
      return granted;
    },
    requestDoubler: () => platform.rewardedBreak(),
    // Manual pause (Escape / the touch pause button) — see `Game#togglePause`.
    onPause: () => platform.gameplayStop(),
    onResume: () => {
      if (game.state.state === 'build' || game.state.state === 'wave') platform.gameplayStart();
    },
  };

  game = new Game({ renderer, scene, camera, assets, input, hud, audio, config: CONFIG, screens, hooks });

  // `game.pause()`/`game.resume()` already freeze input and suspend/resume
  // audio (and `resume()` already refuses to unfreeze input while a screen
  // is open — see its doc comment in Game.js) — reused here rather than
  // duplicating that logic. The `gameplayStart` re-issue is a defensive
  // backstop for any future ad trigger point: today's two ad call sites
  // (`onRunStart`'s own `.then()`, `requestRevive`'s wrapper above) already
  // arrange their own gameplayStart, and `AdGuard#start()` is idempotent, so
  // this can never produce a second real SDK call.
  platform.onAdState((state) => {
    if (state === 'playing') {
      game.pause();
    } else {
      game.resume();
      if (game.state.state === 'build' || game.state.state === 'wave') platform.gameplayStart();
    }
  });

  // Turrets + the top-down build overlay (P4) attach through one call so
  // Game.js never has to know about them; see docs/INTERFACES.md.
  const turrets = new Turrets(scene, assets, CONFIG, game.bus, game.world.effects, audio);
  const overlay = new BuildOverlay(CONFIG, audio);
  installBuildPhase(game, { turrets, overlay, audio, hud, cfg: CONFIG });

  // P5: boss install
  const boss = new Boss(scene, assets, CONFIG, game.bus, game.world.billboards, game.world.effects, audio);
  installBoss(game, { boss, hud, audio, cfg: CONFIG });

  hud.onPauseTap(() => game.togglePause());

  if (loading) loading.hidden = true;

  platform.loadingFinished();

  game.start();
}

/**
 * Loads `Lilita One` via `window.__ASSET_BASE__` rather than a CSS
 * `@font-face url()`, which would resolve against the stylesheet's own
 * location — precisely the relative-path trap `__ASSET_BASE__` exists to
 * avoid (see the comment in `index.html`). Best-effort: a missing font file
 * (e.g. before `assets:build` has run) must never block boot.
 */
function loadDisplayFont() {
  try {
    const url = `${window.__ASSET_BASE__}assets/fonts/LilitaOne-Regular.ttf`;
    const face = new FontFace('Lilita One', `url(${JSON.stringify(url)})`);
    face.load().then(
      (loaded) => document.fonts.add(loaded),
      () => {
        /* Font not built yet or failed to load; the CSS fallback stack covers it. */
      },
    );
  } catch {
    // FontFace unsupported or __ASSET_BASE__ missing; fall back silently.
  }
}
