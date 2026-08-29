/**
 * Poki SDK boundary. Poki hosts the build itself and serves the ads, so unlike
 * the CrazyGames wrapper there is no key and no score submission here — what
 * Poki wants instead is an honest account of when the game is loading, when the
 * player is actually playing, and when it is safe to put an ad on screen.
 *
 * Every entry point is safe to call when the SDK never loaded. Poki's own docs
 * are explicit that a rejected `init()` (an ad blocker, almost always) must not
 * stop the game: the stub methods stay callable and simply do nothing, so the
 * wrapper keeps reporting lifecycle to them rather than latching itself off.
 */

const POKI_SDK_URL = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';
const POKI_BOOT_WAIT_MS = 3_000;
const POKI_RETRY_COOLDOWN_MS = 2_000;

interface PokiSdk {
  init?: () => Promise<unknown>;
  setDebug?: (debug: boolean) => void;
  gameLoadingStart?: () => void;
  gameLoadingFinished?: () => void;
  gameplayStart?: () => void;
  gameplayStop?: () => void;
  commercialBreak?: (
    beforeAd?: () => void,
  ) => Promise<unknown> | undefined | void;
  rewardedBreak?: (
    beforeAd?: () => void,
  ) => Promise<unknown> | undefined | void;
  happyTime?: (intensity: number) => void;
  measure?: (category: string, what: string, action: string) => void;
  captureError?: (error: unknown) => void;
}

declare global {
  interface Window {
    PokiSDK?: PokiSdk;
  }
}

let initialization: Promise<boolean> | undefined;
let available = false;
let nextRetryAt = 0;
let scriptLoad: Promise<boolean> | undefined;
let adMuted = false;
let breakInFlight: Promise<boolean> | undefined;
let adInFlight = false;
let gameplayWanted = false;
let gameplayReported = false;
let gameplaySync: Promise<void> | undefined;
let loadingReported = false;

const muteListeners = new Set<(muted: boolean) => void>();

function currentSdk(): PokiSdk | undefined {
  return typeof window === 'undefined' ? undefined : window.PokiSDK;
}

/**
 * Loads the SDK from Poki's CDN.
 *
 * A Poki build normally carries the tag in `index.html` already — their
 * integration checklist asks for it in the head, and `vite-plugins/platformSdk`
 * puts it there — so this usually finds `window.PokiSDK` and returns straight
 * away. The injection path is what keeps a dev server, a unit test, or a build
 * whose tag was stripped from silently losing the SDK.
 */
function loadPokiScript(): Promise<boolean> {
  if (currentSdk() !== undefined) return Promise.resolve(true);
  if (scriptLoad !== undefined) return scriptLoad;

  const attempt = new Promise<boolean>((resolve) => {
    let settled = false;
    let script: HTMLScriptElement | null = null;

    const finish = (loaded: boolean): void => {
      if (settled) return;
      settled = true;
      if (!loaded && script !== null) {
        script.onload = null;
        script.onerror = null;
        script.remove?.();
      }
      resolve(loaded);
    };

    try {
      if (typeof document === 'undefined') {
        finish(false);
        return;
      }

      script = document.createElement('script');
      script.src = POKI_SDK_URL;
      script.async = true;
      script.onload = () => finish(true);
      script.onerror = () => finish(false);

      const parent = document.head ?? document.documentElement;
      if (parent === null) {
        finish(false);
        return;
      }
      parent.appendChild(script);
    } catch {
      finish(false);
    }
  });
  scriptLoad = attempt.finally(() => {
    scriptLoad = undefined;
  });
  return scriptLoad;
}

function publishAdMute(muted: boolean): void {
  if (adMuted === muted) return;
  adMuted = muted;
  for (const listener of muteListeners) listener(adMuted);
}

function reportGameplayState(sdk: PokiSdk): void {
  // Poki's checklist is explicit that no SDK event may fire while a midroll or
  // rewarded video is on screen. The desired state is not lost — it is held in
  // `gameplayWanted` and flushed by the resync the break runs on its way out.
  if (adInFlight) return;
  const desired = gameplayWanted;
  if (desired === gameplayReported) return;
  const report = desired ? sdk.gameplayStart : sdk.gameplayStop;
  if (report === undefined) return;
  try {
    report.call(sdk);
    gameplayReported = desired;
  } catch {
    // A wedged SDK must never be able to stop play.
  }
}

async function initializePoki(): Promise<boolean> {
  try {
    if (typeof window === 'undefined') return false;
    if (currentSdk() === undefined && !(await loadPokiScript())) {
      nextRetryAt = Date.now() + POKI_RETRY_COOLDOWN_MS;
      return false;
    }

    const sdk = currentSdk();
    if (sdk === undefined) {
      nextRetryAt = Date.now() + POKI_RETRY_COOLDOWN_MS;
      return false;
    }

    // Poki's own test ads only appear with this on, and it must never ship.
    if (import.meta.env.DEV) {
      try {
        sdk.setDebug?.(true);
      } catch {
        // Older SDK builds without the hook are still perfectly usable.
      }
    }

    // A rejected init means an ad blocker, not a broken SDK. Poki asks games to
    // carry on regardless, so the rejection is swallowed and the SDK is marked
    // available: its methods stay callable and quietly no-op from here.
    await sdk.init?.().catch(() => undefined);
    available = true;
    nextRetryAt = 0;
    reportGameplayState(sdk);
    return true;
  } catch {
    nextRetryAt = Date.now() + POKI_RETRY_COOLDOWN_MS;
    return false;
  }
}

/**
 * Loads and initializes the Poki SDK. Concurrent calls share one attempt; a
 * failed attempt is released after a short cooldown so a late network recovery
 * can still succeed on the next lifecycle event or ad break.
 */
export function initPoki(): Promise<boolean> {
  if (available) return Promise.resolve(true);
  if (initialization !== undefined) return initialization;
  if (Date.now() < nextRetryAt) return Promise.resolve(false);
  const attempt = initializePoki();
  initialization = attempt.finally(() => {
    initialization = undefined;
  });
  return initialization;
}

/**
 * Give the SDK a short chance to initialize before booting the game. The
 * underlying initialization is deliberately left alive after this watchdog so a
 * slow CDN response can still service later lifecycle calls and ad breaks.
 */
export async function initPokiForBoot(): Promise<boolean> {
  const initializationAttempt = initPoki();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      initializationAttempt,
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), POKI_BOOT_WAIT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** True once init has run — including the ad-blocked path, which still counts. */
export function isPokiAvailable(): boolean {
  return available;
}

/**
 * Subscribe to the platform audio override; current state is emitted
 * immediately. Poki has no persistent mute setting the way CrazyGames does —
 * this channel carries the ad break, during which the game has to be silent.
 */
export function subscribePokiAudioMute(
  listener: (muted: boolean) => void,
): () => void {
  muteListeners.add(listener);
  listener(adMuted);
  void initPoki();
  return () => muteListeners.delete(listener);
}

/**
 * Report whether the player is actively playing rather than sitting in a menu,
 * the garage, a pause, or an ad. Calls are coalesced and the most recent
 * desired state wins even while SDK initialization is still pending.
 */
export function setPokiGameplayActive(active: boolean): void {
  gameplayWanted = Boolean(active);
  if (gameplaySync !== undefined) return;
  gameplaySync = (async () => {
    try {
      let before: boolean;
      do {
        before = gameplayWanted;
        if (await initPoki()) {
          const sdk = currentSdk();
          if (sdk) reportGameplayState(sdk);
        }
      } while (before !== gameplayWanted);
    } finally {
      // Cleared here rather than from a `.finally` on the promise, which would
      // run a tick later: a call landing inside that tick would find the guard
      // still set, return early, and be lost by the loop that had already
      // decided it was finished. Doing it inline closes the window, because
      // this runs in the same synchronous step as the condition above.
      gameplaySync = undefined;
    }
  })();
}

/**
 * Poki gates the loading screen on this pair: until `gameLoadingFinished` lands
 * the player is looking at Poki's own loader, not the game.
 */
export async function startPokiLoading(): Promise<boolean> {
  if (!(await initPoki())) return false;
  const sdk = currentSdk();
  if (loadingReported || sdk?.gameLoadingStart === undefined) return false;
  try {
    sdk.gameLoadingStart();
    loadingReported = true;
    return true;
  } catch {
    return false;
  }
}

export async function stopPokiLoading(): Promise<boolean> {
  if (!(await initPoki())) return false;
  const sdk = currentSdk();
  if (!loadingReported || sdk?.gameLoadingFinished === undefined) return false;
  try {
    sdk.gameLoadingFinished();
    loadingReported = false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Offer Poki a natural break to fill with an interstitial. Whether an ad
 * actually runs is Poki's decision — they cap the frequency themselves, so the
 * game's job is only to call this at moments where an ad would not interrupt
 * anything, and to be silent while it plays.
 *
 * Resolves once the break is over, ad or no ad. Concurrent callers share the
 * one break rather than stacking. The caller is responsible for having stopped
 * gameplay first; the audio mute is handled here.
 */
export function pokiCommercialBreak(): Promise<boolean> {
  if (breakInFlight !== undefined) return breakInFlight;
  const attempt = (async () => {
    if (!(await initPoki())) return false;
    const sdk = currentSdk();
    if (sdk?.commercialBreak === undefined) return false;
    adInFlight = true;
    try {
      // Poki calls this back at the last moment before the ad renders, which is
      // the only point at which muting is neither early nor late.
      await sdk.commercialBreak(() => publishAdMute(true));
      return true;
    } catch {
      return false;
    } finally {
      publishAdMute(false);
      adInFlight = false;
      // Anything the game asked for mid-ad was held rather than sent. Replay
      // the latest wanted state now that events are allowed again; the usual
      // dedupe drops it if the state never actually moved.
      setPokiGameplayActive(gameplayWanted);
    }
  })();
  breakInFlight = attempt.finally(() => {
    breakInFlight = undefined;
  });
  return breakInFlight;
}

/**
 * A moment the player is enjoying — a personal best, a boss down. Poki uses it
 * to learn where the good parts of the game are. `intensity` is 0..1.
 */
export async function pokiHappyTime(intensity: number): Promise<boolean> {
  const clamped = Math.min(1, Math.max(0, intensity));
  // Same rule as the gameplay reports: nothing may be sent during an ad.
  if (adInFlight || !Number.isFinite(clamped) || !(await initPoki()))
    return false;
  const sdk = currentSdk();
  if (sdk?.happyTime === undefined) return false;
  try {
    sdk.happyTime(clamped);
    return true;
  } catch {
    return false;
  }
}

/**
 * One retention-funnel checkpoint, sent to Poki Game Events.
 *
 * Poki's dashboard pairs these into Started / Completed / Failed / Left
 * columns by `action`, which is why `funnel.ts` is so strict about only ever
 * emitting matched shapes — an unmatched action shows up there as a column of
 * zeroes rather than as an error.
 */
export async function pokiMeasure(
  category: string,
  what: string,
  action: string,
): Promise<boolean> {
  // Same rule as the gameplay reports: nothing may be sent during an ad.
  if (adInFlight || !(await initPoki())) return false;
  const sdk = currentSdk();
  if (sdk?.measure === undefined) return false;
  try {
    sdk.measure(category, what, action);
    return true;
  } catch {
    return false;
  }
}
