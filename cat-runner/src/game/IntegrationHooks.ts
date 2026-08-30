/**
 * ============================================================================
 * Platform integration contract
 * ============================================================================
 *
 * Rooftop Rascal: Cat Escape ships with no backend, no analytics, and no
 * network calls. This file is the *only* seam a future host page needs to
 * touch to hook into game lifecycle events - e.g. a YouTube Playables
 * wrapper, or any other web-game portal that wants start/stop signals, level
 * telemetry, or a rewarded-ad "continue" flow. Everything else in the
 * codebase stays portal-agnostic and must not know any particular host exists.
 *
 * How it works:
 *   - `hooks` holds the live, currently-active implementation of every hook.
 *     It starts out fully populated with harmless no-ops (see DEFAULT_HOOKS)
 *     so the game behaves identically whether or not a host is present.
 *   - Before the game boots, a host page calls
 *     `setIntegrationHooks({ ...partial })` to override any subset of hooks
 *     with real implementations (analytics pings, ad calls, cloud saves,
 *     etc). Anything left un-overridden keeps the default no-op behaviour.
 *   - Game code must NEVER call `hooks.*` directly. It calls the
 *     `notify*` / `request*` wrapper functions exported below instead. Those
 *     wrappers catch and swallow anything a misbehaving host integration
 *     throws (or a rejected promise), so a broken third-party hook can never
 *     crash or hang the game.
 *   - `debugHooks` (default false) turns on console logging inside the
 *     *default* no-op implementations only, to make it obvious during local
 *     development which lifecycle events fire and when. A host that
 *     overrides a hook is responsible for its own logging.
 *
 * For a future implementer wiring up a real portal SDK: implement the
 * `IntegrationHooks` you care about, then call `setIntegrationHooks({...})`
 * (or, from a plain <script> tag with no bundler,
 * `window.RooftopRascal.setIntegrationHooks({...})`) before the game starts.
 * Nothing else in the game needs to know your SDK exists.
 * ============================================================================
 */

export interface IntegrationHooks {
  onGameStarted(): void;
  onLevelCompleted(levelId: string, timeMs: number, collectibles: number): void;
  onGameFailed(reason: string): void;
  /** Ask the host to grant a continue (e.g. after a rewarded ad). No host = never granted. */
  onRewardedContinueRequested(): Promise<boolean>;
  onSoundChanged(enabled: boolean): void;
}

/** Set true locally to see the default (no-op) hook firings logged to console. */
export let debugHooks = false;

/** Convenience setter - `debugHooks` is a live binding, so other modules can't assign to it directly. */
export function setDebugHooks(enabled: boolean): void {
  debugHooks = enabled;
}

function log(message: string, ...args: unknown[]): void {
  if (!debugHooks) return;
  // eslint-disable-next-line no-console
  console.log(`[IntegrationHooks] ${message}`, ...args);
}

/** Harmless defaults used until (unless) a host overrides them. */
const DEFAULT_HOOKS: IntegrationHooks = {
  onGameStarted(): void {
    log('onGameStarted');
  },
  onLevelCompleted(levelId: string, timeMs: number, collectibles: number): void {
    log('onLevelCompleted', { levelId, timeMs, collectibles });
  },
  onGameFailed(reason: string): void {
    log('onGameFailed', { reason });
  },
  onRewardedContinueRequested(): Promise<boolean> {
    log('onRewardedContinueRequested -> false (no host integration)');
    return Promise.resolve(false);
  },
  onSoundChanged(enabled: boolean): void {
    log('onSoundChanged', { enabled });
  },
};

/**
 * The live hook set. Starts as a copy of `DEFAULT_HOOKS`; mutated in place
 * (not reassigned) by `setIntegrationHooks` so any code that imported `hooks`
 * earlier still observes later overrides.
 */
export const hooks: IntegrationHooks = { ...DEFAULT_HOOKS };

/** Partially override the live hooks. A host page should call this before the game boots. */
export function setIntegrationHooks(partial: Partial<IntegrationHooks>): void {
  Object.assign(hooks, partial);
}

// ---------------------------------------------------------------------------
// Safe-call wrappers - the rest of the game calls these, never `hooks.*`
// directly, so a throwing (or rejecting) host integration can never break
// gameplay.
// ---------------------------------------------------------------------------

export function notifyGameStarted(): void {
  try {
    hooks.onGameStarted();
  } catch (err) {
    log('onGameStarted threw', err);
  }
}

export function notifyLevelCompleted(levelId: string, timeMs: number, collectibles: number): void {
  try {
    hooks.onLevelCompleted(levelId, timeMs, collectibles);
  } catch (err) {
    log('onLevelCompleted threw', err);
  }
}

export function notifyGameFailed(reason: string): void {
  try {
    hooks.onGameFailed(reason);
  } catch (err) {
    log('onGameFailed threw', err);
  }
}

export async function requestRewardedContinue(): Promise<boolean> {
  try {
    const granted = await hooks.onRewardedContinueRequested();
    return granted === true;
  } catch (err) {
    log('onRewardedContinueRequested threw', err);
    return false;
  }
}

export function notifySoundChanged(enabled: boolean): void {
  try {
    hooks.onSoundChanged(enabled);
  } catch (err) {
    log('onSoundChanged threw', err);
  }
}

// ---------------------------------------------------------------------------
// Bundler-free integration point: a host page loaded via a plain <script>
// tag (no import graph) can still reach `setIntegrationHooks` through this
// global. Guarded so importing this module in a non-browser context (e.g. a
// future test runner) never throws on a missing `window`.
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  (window as any).RooftopRascal = { setIntegrationHooks };
}
