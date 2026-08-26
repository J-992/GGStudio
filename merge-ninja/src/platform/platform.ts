/**
 * The portal boundary the game actually calls.
 *
 * Poki is the ship target, but the same source also has to run on a plain dev
 * server and on a playtest link, where reaching out to Poki's CDN would be
 * wrong. This module is the one place that knows which of those a build is;
 * every scene sees only the neutral verbs.
 *
 * The target is fixed at build time by `vite.config.ts`, because it has to be:
 * the portal hosts its own copy of the build. It is inlined as a bare boolean
 * so the bundler folds the branch below and drops the platform nobody asked
 * for -- a `npm run build` playtest bundle carries no Poki code and no Poki URL
 * at all.
 *
 * Every verb is safe to call on every platform. A platform that cannot do one
 * resolves false rather than throwing, which is the same path a blocked or
 * missing SDK already takes.
 */

import {
  initPokiForBoot,
  pokiCaptureError,
  pokiCommercialBreak,
  pokiHappyTime,
  pokiMeasure,
  pokiRewardedBreak,
  setPokiGameplayActive,
  startPokiLoading,
  stopPokiLoading,
  subscribePokiAudioMute,
} from './pokiSdk';

type PlatformId = 'poki' | 'none';

interface GamePlatform {
  /** Which of the two this is; carried so the objects read as themselves. */
  readonly id: PlatformId;
  /** Whether a break request can ever put something on screen. */
  readonly hasAds: boolean;
  initForBoot: () => Promise<boolean>;
  startLoading: () => Promise<boolean>;
  stopLoading: () => Promise<boolean>;
  subscribeAudioMute: (listener: (muted: boolean) => void) => () => void;
  setGameplayActive: (active: boolean) => void;
  commercialBreak: () => Promise<boolean>;
  rewardedBreak: () => Promise<boolean>;
  happyTime: (intensity: number) => Promise<boolean>;
  measure: (category: string, what: string, action: string) => Promise<boolean>;
  captureError: (error: unknown) => Promise<boolean>;
}

const NO = (): Promise<boolean> => Promise.resolve(false);

const pokiPlatform: GamePlatform = {
  id: 'poki',
  hasAds: true,
  initForBoot: initPokiForBoot,
  startLoading: startPokiLoading,
  stopLoading: stopPokiLoading,
  subscribeAudioMute: subscribePokiAudioMute,
  setGameplayActive: setPokiGameplayActive,
  commercialBreak: pokiCommercialBreak,
  rewardedBreak: pokiRewardedBreak,
  happyTime: pokiHappyTime,
  measure: pokiMeasure,
  captureError: pokiCaptureError,
};

/**
 * The build with no portal at all: the dev server, a playtest link. Nothing is
 * loaded, nothing is reported, and no request leaves the page.
 */
const nonePlatform: GamePlatform = {
  id: 'none',
  hasAds: false,
  initForBoot: NO,
  startLoading: NO,
  stopLoading: NO,
  subscribeAudioMute: (listener) => { listener(false); return () => undefined; },
  setGameplayActive: () => undefined,
  commercialBreak: NO,
  rewardedBreak: NO,
  happyTime: NO,
  measure: NO,
  captureError: NO,
};

const platform: GamePlatform = __POKI__ ? pokiPlatform : nonePlatform;

/** Which portal this build was made for. */
export function platformId(): PlatformId {
  return platform.id;
}

/** Whether an ad break can ever show anything here. */
export function platformHasAds(): boolean {
  return platform.hasAds;
}

export function initPlatformForBoot(): Promise<boolean> {
  return platform.initForBoot();
}

export function startPlatformLoading(): Promise<boolean> {
  return platform.startLoading();
}

export function stopPlatformLoading(): Promise<boolean> {
  return platform.stopLoading();
}

export function subscribePlatformAudioMute(listener: (muted: boolean) => void): () => void {
  return platform.subscribeAudioMute(listener);
}

export function setPlatformGameplayActive(active: boolean): void {
  platform.setGameplayActive(active);
}

/**
 * Offer the portal a break to fill. Resolves when the break is over -- whether
 * an ad ran, was declined, or the platform has no ads at all -- so a caller can
 * safely wait on it before handing control back to the player.
 */
export function requestPlatformCommercialBreak(): Promise<boolean> {
  return platform.commercialBreak();
}

/** Resolves true only when the player watched a rewarded video through. */
export function requestPlatformRewardedBreak(): Promise<boolean> {
  return platform.rewardedBreak();
}

export function reportPlatformHappyTime(intensity: number): Promise<boolean> {
  return platform.happyTime(intensity);
}

export function reportPlatformMeasure(category: string, what: string, action: string): Promise<boolean> {
  return platform.measure(category, what, action);
}

export function reportPlatformError(error: unknown): Promise<boolean> {
  return platform.captureError(error);
}
