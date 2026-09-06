// Entry point: Poki lifecycle hooks fire in the right order, assets load
// with a visible progress bar, the arena/player/HUD come up, and the loading
// screen comes down. Every path used here is either relative or driven by
// `window.__ASSET_BASE__`; nothing is fetched via `import.meta.env.BASE_URL`.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Input } from './ui/input.js';
import { loadAll } from './game/assets.js';
import { Hud } from './ui/Hud.js';
import { Audio } from './platform/audio.js';
import { Game } from './game/Game.js';

// Installed first so a `?poki=mock` run captures every call from here on,
// including the very next line's `gameLoadingStart`.
if (location.search.includes('poki=mock')) {
  installPokiMock();
}

// Must run before anything else: a slow-loading bundle should still count
// its loading time from as early as possible, and this can never throw even
// if the SDK script failed to load or doesn't exist (plain, non-Poki build).
try {
  window.PokiSDK?.gameLoadingStart?.();
} catch {
  // Keep the game playable even if the SDK is unavailable.
}

boot();

async function boot() {
  loadDisplayFont();

  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('scene'));
  const loading = document.getElementById('loading');
  const loadingStatus = loading?.querySelector('.loading-status');

  // Constructed before assets finish loading so touch/keyboard detection and
  // the title panel's silent input-swap are live the instant the page paints.
  const input = new Input(canvas, CONFIG);

  const assets = await loadAll((progress) => {
    if (loadingStatus) loadingStatus.textContent = `Loading… ${Math.round(progress * 100)}%`;
  });

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

  const game = new Game({ renderer, scene, camera, assets, input, hud, audio, config: CONFIG });

  installTitlePanel(game, input);

  if (loading) loading.hidden = true;

  try {
    window.PokiSDK?.gameLoadingFinished?.();
  } catch {
    // Keep the game playable even if the SDK is unavailable.
  }

  game.start();
}

/**
 * Minimal title screen for P2 — P6 replaces this with the real title screen
 * (brainrot boss portraits, credits, Poki `commercialBreak`/`gameplayStart`
 * flow). `Game` already advances `title -> build` on the very first input
 * frame, so this panel only needs to get out of the way once that happens;
 * it never drives the transition itself.
 *
 * @param {Game} game
 * @param {Input} input
 */
function installTitlePanel(game, input) {
  const ui = document.getElementById('ui');
  const panel = document.createElement('div');
  panel.className = 'title-panel';

  const heading = document.createElement('h1');
  heading.className = 'title-panel__heading';
  heading.textContent = 'ARENA DEFENSE';

  const prompt = document.createElement('p');
  prompt.className = 'title-panel__prompt';
  prompt.textContent = input.mode === 'touch' ? 'TAP TO PLAY' : 'CLICK OR PRESS A KEY TO PLAY';

  panel.append(heading, prompt);
  ui.appendChild(panel);

  input.onModeChange((mode) => {
    prompt.textContent = mode === 'touch' ? 'TAP TO PLAY' : 'CLICK OR PRESS A KEY TO PLAY';
  });

  const unsubscribe = game.bus.on('state:changed', ({ state }) => {
    if (state === 'title') return;
    panel.hidden = true;
    unsubscribe();
  });
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

/**
 * Installs a mock `window.PokiSDK` that records every call into
 * `window.__POKI_EVENTS__`, so `?poki=mock` runs can be asserted against
 * without the real SDK script. Shape copied from `run/src/platform/Poki.ts`'s
 * `installMock`.
 */
function installPokiMock() {
  const events = [];
  window.__POKI_EVENTS__ = events;
  window.PokiSDK = {
    init: async () => {
      events.push('init');
    },
    gameLoadingStart: () => {
      events.push('loadingStart');
    },
    gameLoadingFinished: () => {
      events.push('loadingFinished');
    },
    gameplayStart: () => {
      events.push('gameplayStart');
    },
    gameplayStop: () => {
      events.push('gameplayStop');
    },
    commercialBreak: async () => {
      events.push('commercialBreak');
    },
    rewardedBreak: async () => {
      events.push('rewardedBreak');
      return true;
    },
    measure: (category, value, action) => {
      events.push(`measure:${category}:${value}:${action}`);
    },
  };
}
