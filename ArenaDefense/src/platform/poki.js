/**
 * The only module allowed to touch `window.PokiSDK` (see `AGENTS.md`).
 * Every real lifecycle call is routed through `core/adGuard.js` so
 * `gameplayStart`/`gameplayStop` can never double-fire, never fire during an
 * ad, and every ad break stops gameplay unconditionally before the SDK is
 * ever touched — the rule Poki's own review checks first.
 *
 * `HAS_POKI` (`__POKI__`, a build-time `define` from `vite.config.js` — true
 * only for `vite build --mode poki`) and `IS_DEV` (`import.meta.env.DEV`,
 * true only under the Vite dev server) combine into `ACTIVE`. Both are
 * statically known at build time, so in the plain `vite build` (the only
 * distribution where neither is true) every branch this file gates behind
 * `ACTIVE`/`HAS_POKI` folds to dead code and is stripped by minification —
 * verified with `grep -c PokiSDK dist/assets/*.js` in the repo's own verify
 * list (must be 0 for `npm run build`, >0 for `npm run build:poki`).
 * `npm run dev` needs the mock (`?poki=mock`) to work too — hence `IS_DEV`,
 * not `HAS_POKI` alone, gating the mock/lifecycle body. Real script
 * injection in `init()` is gated on `HAS_POKI` specifically: a dev/mock
 * session must never attempt a real fetch to `game-cdn.poki.com`.
 *
 * `typeof __POKI__ !== 'undefined'` is a `declare`-style fallback for
 * anything that might evaluate this module outside Vite's `define` (it never
 * does in this repo — `__POKI__` is always substituted by Vite — but the
 * check costs nothing and matches the project's own convention).
 */
import { AdGuard, withWatchdog } from '../core/adGuard.js';

const HAS_POKI = typeof __POKI__ !== 'undefined' && __POKI__;
const IS_DEV = typeof import.meta !== 'undefined' && !!import.meta.env && !!import.meta.env.DEV;
const ACTIVE = HAS_POKI || IS_DEV;

const SDK_TAG_SRC = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';

/** Every ad break (commercial or rewarded) is watchdog-guarded at this
 *  ceiling — long enough for a real ad, short enough that a hung SDK promise
 *  can never leave the game frozen indefinitely. */
const AD_WATCHDOG_MS = 60000;

/** How long the `?poki=mock` fake ad "plays" before its promise resolves. */
const MOCK_AD_MS = 2000;

/**
 * Installs a mock `window.PokiSDK` (idempotent — safe to call more than
 * once) that records every lifecycle call into `window.__POKI_EVENTS__`
 * instead of requiring the real CDN script, gated behind `?poki=mock`.
 * `?poki=mock&reward=0` makes every rewarded break resolve `false` (ad
 * declined/unfilled), for exercising the "revive denied" / "no doubler"
 * paths without leaving the URL bar.
 */
function installMockIfRequested() {
  let params;
  try {
    params = new URLSearchParams(location.search);
  } catch {
    return;
  }
  if (params.get('poki') !== 'mock') return;
  if (window.__POKI_MOCK_INSTALLED__) return;
  window.__POKI_MOCK_INSTALLED__ = true;

  const events = [];
  window.__POKI_EVENTS__ = events;
  const rewardOk = params.get('reward') !== '0';

  window.PokiSDK = {
    init: () => {
      events.push('init');
      return Promise.resolve();
    },
    gameLoadingStart: () => {
      events.push('gameLoadingStart');
    },
    gameLoadingFinished: () => {
      events.push('gameLoadingFinished');
    },
    gameplayStart: () => {
      events.push('gameplayStart');
    },
    gameplayStop: () => {
      events.push('gameplayStop');
    },
    commercialBreak: () => {
      events.push('commercialBreak');
      return new Promise((resolve) => setTimeout(resolve, MOCK_AD_MS));
    },
    rewardedBreak: () => {
      events.push(`rewardedBreak:${rewardOk}`);
      return new Promise((resolve) => setTimeout(() => resolve(rewardOk), MOCK_AD_MS));
    },
  };
}

if (ACTIVE) installMockIfRequested();

export class Platform {
  /**
   * @param {import('../core/types.js').GameConfig} cfg
   */
  constructor(cfg) {
    this._cfg = cfg;
    this._guard = new AdGuard();
    /** @type {Set<(state: 'playing'|'none') => void>} */
    this._adListeners = new Set();
    /** @type {any} `window.PokiSDK`, once resolved — `null` until `init()` finds/loads it, or forever if the SDK never becomes available. */
    this._sdk = ACTIVE && typeof window !== 'undefined' ? (window.PokiSDK ?? null) : null;
  }

  /**
   * @returns {boolean} Whether ad-gated UI (the revive/doubler buttons) has
   *   anywhere to actually send an ad request — false with no SDK active at
   *   all, or when `cfg.platform.adsEnabled` is turned off. `ui/Screens.js`
   *   hides both optional ad buttons when this is false; the economy is
   *   otherwise identical either way (see `AGENTS.md`).
   */
  get hasAds() {
    return ACTIVE && !!this._cfg.platform.adsEnabled;
  }

  /**
   * @param {(state: 'playing'|'none') => void} fn
   * @returns {() => void} Unsubscribe.
   */
  onAdState(fn) {
    this._adListeners.add(fn);
    return () => this._adListeners.delete(fn);
  }

  /** @param {'playing'|'none'} state */
  _notifyAd(state) {
    for (const fn of [...this._adListeners]) fn(state);
  }

  /**
   * Resolves the SDK: uses `window.PokiSDK` if the static `<script>` tag (or
   * the mock installer above) already produced it; otherwise, only in a real
   * Poki build, injects the script tag itself and waits up to
   * `cfg.platform.pokiInitTimeoutMs` for it to appear. Never rejects and
   * never throws — every branch is try/caught, so a missing or broken SDK
   * degrades to every subsequent call being a safe no-op rather than taking
   * the game down.
   * @returns {Promise<void>}
   */
  async init() {
    if (!ACTIVE) return;
    const timeoutMs = this._cfg.platform.pokiInitTimeoutMs;

    try {
      if (!this._sdk) this._sdk = window.PokiSDK ?? null;

      if (!this._sdk && HAS_POKI) {
        await withWatchdog(() => this._injectSdkScript(), timeoutMs, undefined);
        this._sdk = window.PokiSDK ?? null;
      }

      if (this._sdk?.init) {
        await withWatchdog(() => Promise.resolve(this._sdk.init()), timeoutMs, undefined);
      }
    } catch {
      // A broken/missing SDK must never block boot — every call below
      // already tolerates `this._sdk` staying null forever.
    }
  }

  /** @returns {Promise<void>} Resolves once the tag loads, errors, or is never appended (SSR-less environment guard). */
  _injectSdkScript() {
    return new Promise((resolve) => {
      if (typeof document === 'undefined') {
        resolve();
        return;
      }
      const existing = document.querySelector(`script[src="${SDK_TAG_SRC}"]`);
      if (existing) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = SDK_TAG_SRC;
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });
  }

  /**
   * Must run before anything else that might be slow — Poki counts loading
   * time from as early as possible. Safe to call before `init()` resolves
   * (mirrors the real SDK's own synchronous `gameLoadingStart`); a call this
   * early may find `this._sdk` still null if the static tag hasn't executed
   * yet, in which case it best-effort re-reads `window.PokiSDK` once.
   */
  gameLoadingStart() {
    if (!ACTIVE) return;
    try {
      (this._sdk ?? window.PokiSDK)?.gameLoadingStart?.();
    } catch {
      // Keep the game playable even if the SDK is unavailable.
    }
  }

  /** Called once assets are loaded and the title is visible. */
  loadingFinished() {
    if (!ACTIVE) return;
    try {
      this._sdk?.gameLoadingFinished?.();
    } catch {
      // Keep the game playable even if the SDK is unavailable.
    }
  }

  /** No-op (never a double start, never during an ad) — see `core/adGuard.js`. */
  gameplayStart() {
    if (!ACTIVE) return;
    if (!this._guard.start()) return;
    try {
      this._sdk?.gameplayStart?.();
    } catch {
      // Keep the game playable even if the SDK is unavailable.
    }
  }

  /** Idempotent — a second call in a row is a safe no-op. */
  gameplayStop() {
    if (!ACTIVE) return;
    if (!this._guard.stop()) return;
    try {
      this._sdk?.gameplayStop?.();
    } catch {
      // Keep the game playable even if the SDK is unavailable.
    }
  }

  /**
   * The central invariant: gameplay is unconditionally marked stopped (via
   * `AdGuard#beginAd`, which also blocks any `gameplayStart()` for the
   * duration of the ad) BEFORE the SDK's own `commercialBreak()` is ever
   * invoked — the wrapper takes care of this itself; no call site is ever
   * responsible for stopping gameplay before requesting an ad. The real
   * SDK's `gameplayStop()` method is only actually invoked when
   * `beginAd()` reports gameplay genuinely was running (`wasStarted`) —
   * every real call site in this game already stops gameplay before ever
   * reaching an ad (death/run-end precede every rewarded break, and
   * commercial breaks only ever fire from `title`/`runEnd`), so in normal
   * play this is a defensive no-op; if some future call site ever raced
   * ahead of that, this is what still tells Poki gameplay stopped rather
   * than silently leaving their side of the bookkeeping wrong.
   *
   * Notifies `onAdState('playing')`, awaits the ad behind a watchdog so a
   * hung promise can't freeze the game, then notifies `onAdState('none')`.
   * A no-op (resolves immediately, no state change at all) when `!hasAds`
   * — nothing to interrupt.
   * @returns {Promise<void>}
   */
  async commercialBreak() {
    if (!this.hasAds) return;

    const wasStarted = this._guard.beginAd();
    if (wasStarted) {
      try {
        this._sdk?.gameplayStop?.();
      } catch {
        // Keep the game playable even if the SDK is unavailable.
      }
    }
    this._notifyAd('playing');

    try {
      await withWatchdog(
        () => (this._sdk?.commercialBreak ? Promise.resolve(this._sdk.commercialBreak()) : Promise.resolve()),
        AD_WATCHDOG_MS,
        undefined,
      );
    } finally {
      this._guard.endAd();
      this._notifyAd('none');
    }
  }

  /**
   * Same central invariant as `commercialBreak()`. Resolves `true` only when
   * the SDK genuinely resolves `true` — any rejection, timeout, missing SDK,
   * or `!hasAds` resolves `false` (ad declined/unavailable), never throws.
   * @returns {Promise<boolean>}
   */
  async rewardedBreak() {
    if (!this.hasAds) return false;

    const wasStarted = this._guard.beginAd();
    if (wasStarted) {
      try {
        this._sdk?.gameplayStop?.();
      } catch {
        // Keep the game playable even if the SDK is unavailable.
      }
    }
    this._notifyAd('playing');

    let granted = false;
    try {
      const result = await withWatchdog(
        () => (this._sdk?.rewardedBreak ? Promise.resolve(this._sdk.rewardedBreak()) : Promise.resolve(false)),
        AD_WATCHDOG_MS,
        false,
      );
      granted = result === true;
    } finally {
      this._guard.endAd();
      this._notifyAd('none');
    }
    return granted;
  }
}
