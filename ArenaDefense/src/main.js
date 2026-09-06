// Placeholder entry point proving the pipeline end to end: Poki lifecycle
// hooks fire in the right order, three.js renders something, and the loading
// screen comes down. Real gameplay wiring (Game.js, the state machine, asset
// loading, etc.) lands in later work packages — see the plan. Every path
// used here is either relative or driven by `window.__ASSET_BASE__`; nothing
// is fetched yet, so `import.meta.env.BASE_URL` never needs to appear.
import * as THREE from 'three';

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

function boot() {
  loadDisplayFont();

  const canvas = document.getElementById('scene');
  const ui = document.getElementById('ui');

  const title = document.createElement('h1');
  title.className = 'placeholder-title';
  title.textContent = 'ARENA DEFENSE';
  ui.appendChild(title);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1310);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 1.5, 4);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xfff2e0, 0x2a1a12, 1.2));

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xe0523f }),
  );
  scene.add(cube);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  function tick(now) {
    const dt = (now - last) / 1000;
    last = now;
    cube.rotation.x += dt * 0.6;
    cube.rotation.y += dt * 0.9;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  const loading = document.getElementById('loading');
  if (loading) loading.hidden = true;

  try {
    window.PokiSDK?.gameLoadingFinished?.();
  } catch {
    // Keep the game playable even if the SDK is unavailable.
  }
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
