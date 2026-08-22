/**
 * Poki SDK boundary.
 *
 * Poki hosts the build and serves the ads, so there is no key and no score
 * submission here. What Poki wants instead is an honest account of when the
 * game is loading, when the player is actually playing, and when it is safe to
 * put an ad on screen.
 *
 * Every entry point is safe to call when the SDK never loaded. Poki's own docs
 * are explicit that a rejected `init()` -- an ad blocker, almost always -- must
 * not stop the game, so a rejection still marks the SDK available: the stub
 * methods stay callable and quietly do nothing.
 *
 * Ported from `aimer/src/game/platform/pokiSdk.ts` in the GGStudio monorepo so
 * both games answer Poki's checklist the same way.
 */

const POKI_SDK_URL = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';
const BOOT_WAIT_MS = 3000;
const RETRY_COOLDOWN_MS = 2000;

interface PokiSdk {
  init?: () => Promise<unknown>;
  setDebug?: (debug: boolean) => void;
  gameLoadingStart?: () => void;
  gameLoadingFinished?: () => void;
  gameplayStart?: () => void;
  gameplayStop?: () => void;
  commercialBreak?: (beforeAd?: () => void) => Promise<unknown> | void;
  rewardedBreak?: (beforeAd?: () => void) => Promise<unknown> | void;
  happyTime?: (intensity: number) => void;
  captureError?: (error: unknown) => void;
}

declare global {
  interface Window { PokiSDK?: PokiSdk }
}

let initialization: Promise<boolean> | undefined;
let scriptLoad: Promise<boolean> | undefined;
let available = false;
let nextRetryAt = 0;

let adMuted = false;
let adInFlight = false;
let breakInFlight: Promise<boolean> | undefined;

let gameplayWanted = false;
let gameplayReported = false;
let gameplaySync: Promise<void> | undefined;
let loadingReported = false;

const muteListeners = new Set<(muted: boolean) => void>();

function sdk(): PokiSdk | undefined {
  return typeof window === 'undefined' ? undefined : window.PokiSDK;
}

/**
 * Loads the SDK from Poki's CDN.
 *
 * A Poki build carries the tag in `index.html` already -- their checklist asks
 * for it in the head, and `vite-plugins/platformSdk` puts it there -- so this
 * normally finds `window.PokiSDK` and returns straight away. The injection path
 * is what keeps a dev server, or a build whose tag was stripped, from silently
 * losing the SDK.
 */
function loadScript(): Promise<boolean> {
  if (sdk() !== undefined) return Promise.resolve(true);
  if (scriptLoad !== undefined) return scriptLoad;

  const attempt = new Promise<boolean>((resolve) => {
    let settled = false;
    let el: HTMLScriptElement | null = null;

    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      if (!ok && el !== null) {
        el.onload = null;
        el.onerror = null;
        el.remove();
      }
      resolve(ok);
    };

    try {
      if (typeof document === 'undefined') { finish(false); return; }

      el = document.createElement('script');
      el.src = POKI_SDK_URL;
      el.async = true;
      el.onload = () => finish(true);
      el.onerror = () => finish(false);

      const parent: HTMLElement | null = document.head ?? document.documentElement;
      if (parent === null) { finish(false); return; }
      parent.appendChild(el);
    } catch {
      finish(false);
    }
  });

  scriptLoad = attempt.finally(() => { scriptLoad = undefined; });
  return scriptLoad;
}

function publishAdMute(muted: boolean): void {
  if (adMuted === muted) return;
  adMuted = muted;
  for (const listener of muteListeners) listener(adMuted);
}

function reportGameplay(s: PokiSdk): void {
  // Poki's checklist is explicit that no SDK event may fire while an ad is on
  // screen. The desired state is not lost -- it is held in `gameplayWanted` and
  // flushed by the resync the break runs on its way out.
  if (adInFlight) return;

  const desired = gameplayWanted;
  if (desired === gameplayReported) return;

  const report = desired ? s.gameplayStart : s.gameplayStop;
  if (report === undefined) return;

  try {
    report.call(s);
    gameplayReported = desired;
  } catch {
    // A wedged SDK must never be able to stop play.
  }
}

async function initialize(): Promise<boolean> {
  try {
    if (typeof window === 'undefined') return false;

    if (sdk() === undefined && !(await loadScript())) {
      nextRetryAt = Date.now() + RETRY_COOLDOWN_MS;
      return false;
    }

    const s = sdk();
    if (s === undefined) {
      nextRetryAt = Date.now() + RETRY_COOLDOWN_MS;
      return false;
    }

    // Poki's test ads only appear with this on, and it must never ship.
    if (import.meta.env.DEV) {
      try { s.setDebug?.(true); } catch { /* older SDK builds are fine */ }
    }

    // A rejected init means an ad blocker, not a broken SDK. Poki asks games to
    // carry on regardless, so the rejection is swallowed and the SDK is marked
    // available: its methods stay callable and quietly no-op.
    await s.init?.().catch(() => undefined);

    available = true;
    nextRetryAt = 0;
    reportGameplay(s);

    return true;
  } catch {
    nextRetryAt = Date.now() + RETRY_COOLDOWN_MS;
    return false;
  }
}

/**
 * Loads and initializes the SDK. Concurrent calls share one attempt; a failed
 * attempt is released after a cooldown so a late network recovery can still
 * succeed on the next lifecycle event or ad break.
 */
export function initPoki(): Promise<boolean> {
  if (available) return Promise.resolve(true);
  if (initialization !== undefined) return initialization;
  if (Date.now() < nextRetryAt) return Promise.resolve(false);

  const attempt = initialize();
  initialization = attempt.finally(() => { initialization = undefined; });

  return initialization;
}

/**
 * Give the SDK a short chance to initialize before booting the game. The
 * underlying attempt is deliberately left alive after the watchdog fires, so a
 * slow CDN response can still service later lifecycle calls and ad breaks.
 */
export async function initPokiForBoot(): Promise<boolean> {
  const attempt = initPoki();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      attempt,
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), BOOT_WAIT_MS); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Subscribe to the platform audio override; current state is emitted
 * immediately. This channel carries the ad break, during which the game has to
 * be silent.
 */
export function subscribePokiAudioMute(listener: (muted: boolean) => void): () => void {
  muteListeners.add(listener);
  listener(adMuted);
  void initPoki();
  return () => { muteListeners.delete(listener); };
}

/**
 * Report whether the player is actively playing rather than sitting in a menu,
 * an almanac page, a reveal or an ad. Calls are coalesced and the most recent
 * desired state wins even while initialization is still pending.
 */
export function setPokiGameplayActive(active: boolean): void {
  gameplayWanted = active;
  if (gameplaySync !== undefined) return;

  gameplaySync = (async () => {
    try {
      let before: boolean;
      do {
        before = gameplayWanted;
        if (await initPoki()) {
          const s = sdk();
          if (s !== undefined) reportGameplay(s);
        }
      } while (before !== gameplayWanted);
    } finally {
      // Cleared inline rather than from a `.finally` on the promise, which
      // would run a tick later: a call landing inside that tick would find the
      // guard still set, return early, and be lost by the loop that had already
      // decided it was finished.
      gameplaySync = undefined;
    }
  })();
}

/**
 * Poki gates their loading screen on this pair: until `gameLoadingFinished`
 * lands the player is looking at Poki's loader, not the game.
 */
export async function startPokiLoading(): Promise<boolean> {
  if (!(await initPoki())) return false;

  const s = sdk();
  if (loadingReported || s?.gameLoadingStart === undefined) return false;

  try { s.gameLoadingStart(); loadingReported = true; return true; } catch { return false; }
}

export async function stopPokiLoading(): Promise<boolean> {
  if (!(await initPoki())) return false;

  const s = sdk();
  if (!loadingReported || s?.gameLoadingFinished === undefined) return false;

  try { s.gameLoadingFinished(); loadingReported = false; return true; } catch { return false; }
}

/**
 * Shared plumbing for both break types. Poki forbids any other SDK event while
 * a break is on screen, so `adInFlight` gates the gameplay reports and the
 * wanted state is replayed on the way out.
 */
function runBreak(kind: 'commercial' | 'rewarded'): Promise<boolean> {
  if (breakInFlight !== undefined) return breakInFlight;

  const attempt = (async () => {
    if (!(await initPoki())) return false;

    const s = sdk();
    const call = kind === 'rewarded' ? s?.rewardedBreak : s?.commercialBreak;
    if (s === undefined || call === undefined) return false;

    adInFlight = true;

    try {
      // Poki calls this back at the last moment before the ad renders, which is
      // the only point at which muting is neither early nor late.
      const result = await call.call(s, () => publishAdMute(true));

      // `commercialBreak` resolves with nothing; `rewardedBreak` resolves with
      // whether the player earned the reward.
      return kind === 'rewarded' ? result === true : true;
    } catch {
      return false;
    } finally {
      publishAdMute(false);
      adInFlight = false;
      // Anything the game asked for mid-ad was held rather than sent. Replay
      // the latest wanted state now that events are allowed again; the usual
      // dedupe drops it if the state never moved.
      setPokiGameplayActive(gameplayWanted);
    }
  })();

  breakInFlight = attempt.finally(() => { breakInFlight = undefined; });
  return breakInFlight;
}

/**
 * Offer Poki a natural break to fill with an interstitial. Whether an ad
 * actually runs is Poki's decision -- they cap the frequency themselves, so the
 * game's job is only to call this where an ad interrupts nothing, and to be
 * silent and frozen while it plays.
 *
 * Resolves once the break is over, ad or no ad.
 */
export function pokiCommercialBreak(): Promise<boolean> {
  return runBreak('commercial');
}

/**
 * A rewarded video the player opted into. Resolves true only when the video ran
 * to completion and the reward is owed.
 */
export function pokiRewardedBreak(): Promise<boolean> {
  return runBreak('rewarded');
}

/**
 * A moment the player is enjoying -- a boss down, a tier they have never seen.
 * Poki uses it to learn where the good parts of the game are. `intensity` is
 * 0..1.
 */
export async function pokiHappyTime(intensity: number): Promise<boolean> {
  const clamped = Math.min(1, Math.max(0, intensity));

  // Same rule as the gameplay reports: nothing may be sent during an ad.
  if (adInFlight || !Number.isFinite(clamped) || !(await initPoki())) return false;

  const s = sdk();
  if (s?.happyTime === undefined) return false;

  try { s.happyTime(clamped); return true; } catch { return false; }
}

/** Hand a caught error to Poki so it shows up in their dashboard. */
export async function pokiCaptureError(error: unknown): Promise<boolean> {
  if (!(await initPoki())) return false;

  const s = sdk();
  if (s?.captureError === undefined) return false;

  try { s.captureError(error); return true; } catch { return false; }
}
