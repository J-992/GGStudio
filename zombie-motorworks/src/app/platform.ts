/**
 * The portal boundary the game actually calls.
 *
 * Zombie Motorworks ships to more than one web-game portal, and each wants the
 * same handful of facts — loading started, loading finished, the player is
 * playing, the player stopped, here is a score, here is a safe moment for an ad
 * — through a different SDK. This module is the one place that knows which
 * portal a build is for; `main.ts` and `App.ts` see only the neutral verbs.
 *
 * The target is fixed at build time by `VITE_PLATFORM`, because it has to be:
 * each portal hosts its own copy of the build, and loading two ad SDKs into one
 * page is neither allowed nor sensible. `crazygames` stays the default so an
 * unconfigured build behaves exactly as it did before this seam existed.
 *
 * Every verb is safe to call on every platform. A portal that cannot do one —
 * CrazyGames has no equivalent of Poki's `happyTime`, Poki has no leaderboard
 * for the game to submit to — resolves false rather than throwing, and the
 * caller carries on as though it were unavailable, which is the same path a
 * blocked or missing SDK already takes.
 */

import {
  initCrazyGamesForBoot,
  setCrazyGamesGameplayActive,
  startCrazyGamesLoading,
  stopCrazyGamesLoading,
  submitCrazyGamesScore,
  subscribeCrazyGamesAudioMute,
} from './crazyGamesSdk.ts';
import {
  initPokiForBoot,
  pokiCommercialBreak,
  pokiHappyTime,
  setPokiGameplayActive,
  startPokiLoading,
  stopPokiLoading,
  subscribePokiAudioMute,
} from './pokiSdk.ts';

export type PlatformId = 'crazygames' | 'poki' | 'none';

interface GamePlatform {
  readonly id: PlatformId;
  /** Whether `commercialBreak` can ever show anything on this portal. */
  readonly hasAds: boolean;
  /** Initialize with a boot-time watchdog; false means "not ready yet". */
  initForBoot: () => Promise<boolean>;
  /** Bracket the game's own loading screen. */
  startLoading: () => Promise<boolean>;
  stopLoading: () => Promise<boolean>;
  /** Platform-level audio override; the current value is emitted immediately. */
  subscribeAudioMute: (listener: (muted: boolean) => void) => () => void;
  /** Playing, as opposed to a menu, the garage, a pause, or a result card. */
  setGameplayActive: (active: boolean) => void;
  /** Final run score for the portal's own leaderboard. */
  submitScore: (score: number) => Promise<boolean>;
  /** Offer a natural break the portal may fill with an interstitial. */
  commercialBreak: () => Promise<boolean>;
  /** Flag a moment the player enjoyed. `intensity` is 0..1. */
  happyTime: (intensity: number) => Promise<boolean>;
}

const NOT_SUPPORTED = (): Promise<boolean> => Promise.resolve(false);

const crazyGamesPlatform: GamePlatform = {
  id: 'crazygames',
  hasAds: false,
  initForBoot: initCrazyGamesForBoot,
  startLoading: startCrazyGamesLoading,
  stopLoading: stopCrazyGamesLoading,
  subscribeAudioMute: subscribeCrazyGamesAudioMute,
  setGameplayActive: setCrazyGamesGameplayActive,
  submitScore: submitCrazyGamesScore,
  // CrazyGames does have midgame ads (`SDK.ad.requestAd`), but this game has
  // never asked for one and turning them on is a tuning decision, not a
  // translation of the Poki call. Left off deliberately.
  commercialBreak: NOT_SUPPORTED,
  happyTime: NOT_SUPPORTED,
};

const pokiPlatform: GamePlatform = {
  id: 'poki',
  hasAds: true,
  initForBoot: initPokiForBoot,
  startLoading: startPokiLoading,
  stopLoading: stopPokiLoading,
  subscribeAudioMute: subscribePokiAudioMute,
  setGameplayActive: setPokiGameplayActive,
  // Poki has no score API. The game's local leaderboard is what players see on
  // every platform anyway, so nothing is lost by this being a no-op.
  submitScore: NOT_SUPPORTED,
  commercialBreak: pokiCommercialBreak,
  happyTime: pokiHappyTime,
};

/**
 * The build with no portal at all: the Vercel playtest link, a dev server, the
 * unit suite. Nothing is loaded, nothing is reported, and no network request
 * leaves the page.
 */
const nonePlatform: GamePlatform = {
  id: 'none',
  hasAds: false,
  initForBoot: NOT_SUPPORTED,
  startLoading: NOT_SUPPORTED,
  stopLoading: NOT_SUPPORTED,
  subscribeAudioMute: (listener) => {
    listener(false);
    return () => undefined;
  },
  setGameplayActive: () => undefined,
  submitScore: NOT_SUPPORTED,
  commercialBreak: NOT_SUPPORTED,
  happyTime: NOT_SUPPORTED,
};

function selectPlatform(): GamePlatform {
  switch (import.meta.env.VITE_PLATFORM?.trim()) {
    case 'poki':
      return pokiPlatform;
    case 'none':
      return nonePlatform;
    default:
      return crazyGamesPlatform;
  }
}

const activePlatform = selectPlatform();

/** Which portal this build talks to. */
export function activePlatformId(): PlatformId {
  return activePlatform.id;
}

export function initPlatformForBoot(): Promise<boolean> {
  return activePlatform.initForBoot();
}

export function startPlatformLoading(): Promise<boolean> {
  return activePlatform.startLoading();
}

export function stopPlatformLoading(): Promise<boolean> {
  return activePlatform.stopLoading();
}

export function subscribePlatformAudioMute(
  listener: (muted: boolean) => void,
): () => void {
  return activePlatform.subscribeAudioMute(listener);
}

export function setPlatformGameplayActive(active: boolean): void {
  activePlatform.setGameplayActive(active);
}

export function submitPlatformScore(score: number): Promise<boolean> {
  return activePlatform.submitScore(score);
}

/**
 * Whether an ad break can ever show anything here. Callers use it to skip the
 * gameplay stop/start pair a break is wrapped in, which on an ad-free portal
 * would be two reports describing a break that never happens.
 */
export function platformHasAds(): boolean {
  return activePlatform.hasAds;
}

/**
 * Offer the portal a break to fill. Resolves when the break is over — whether
 * an ad ran, was declined, or the portal has no ads at all — so a caller can
 * safely wait on it before handing control back to the player.
 */
export function requestPlatformCommercialBreak(): Promise<boolean> {
  return activePlatform.commercialBreak();
}

export function reportPlatformHappyTime(intensity: number): Promise<boolean> {
  return activePlatform.happyTime(intensity);
}
