/**
 * Poki integration, isolated behind one adapter.
 *
 * No gameplay file imports the SDK. Two rules drive the design:
 *   1. The game must be fully playable with no SDK at all (local dev, itch,
 *      an ad blocker, a failed CDN). Every call degrades to a resolved promise.
 *   2. Poki rejects invalid event sequences, so gameplayStart/Stop are guarded
 *      by an explicit state machine rather than by call-site discipline.
 */

import { PLATFORM } from '../config';

type PokiSDK = {
  init(): Promise<void>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(before?: () => void | Promise<void>): Promise<void>;
  rewardedBreak(before?: () => void | Promise<void>): Promise<boolean>;
  customEvent(category: string, action: string, json?: Record<string, unknown>): void;
  setDebug(debug: boolean): void;
};

declare global {
  interface Window {
    PokiSDK?: PokiSDK;
  }
}

const SDK_URL = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';
const SDK_TIMEOUT_MS = 4000;

export type AdState = 'none' | 'playing';

export class PlatformAdapter {
  private sdk: PokiSDK | null = null;
  private ready = false;
  private loadingFinished = false;
  private gameplayActive = false;
  private adActive = false;
  private listeners = new Set<(state: AdState) => void>();
  private readonly adsEnabled: boolean;

  /**
   * `ads` defaults to the build-wide switch in config. It is a constructor
   * argument only so the ad-flow tests can exercise the enabled path while
   * playtest builds ship with breaks turned off.
   */
  constructor(options: { ads?: boolean } = {}) {
    this.adsEnabled = options.ads ?? PLATFORM.ads;
  }

  /** False while ad breaks are switched off for playtesting. */
  get adsAllowed(): boolean {
    return this.adsEnabled;
  }

  /** True once we know whether an SDK exists, either way. */
  get initialised(): boolean {
    return this.ready;
  }

  get hasSDK(): boolean {
    return this.sdk !== null;
  }

  get isAdPlaying(): boolean {
    return this.adActive;
  }

  /**
   * Resolves whether or not Poki is reachable. Never rejects, and never blocks
   * the loading screen for longer than SDK_TIMEOUT_MS.
   */
  async init(): Promise<void> {
    if (this.ready) return;
    try {
      const sdk = await withTimeout(loadScript(), SDK_TIMEOUT_MS);
      if (sdk) {
        await withTimeout(sdk.init(), SDK_TIMEOUT_MS);
        this.sdk = sdk;
      }
    } catch {
      this.sdk = null;
    }
    this.ready = true;
  }

  /**
   * Fired the moment the ESSENTIAL asset set is playable — deliberately not
   * after the deferred characters, which keep streaming in the background.
   */
  gameLoadingFinished(): void {
    if (this.loadingFinished) return;
    this.loadingFinished = true;
    this.safe(() => this.sdk?.gameLoadingFinished());
  }

  /** Idempotent: repeated calls without an intervening stop are dropped. */
  gameplayStart(): void {
    if (this.gameplayActive) return;
    this.gameplayActive = true;
    this.safe(() => this.sdk?.gameplayStart());
  }

  /** Idempotent: a stop with no active gameplay is dropped. */
  gameplayStop(): void {
    if (!this.gameplayActive) return;
    this.gameplayActive = false;
    this.safe(() => this.sdk?.gameplayStop());
  }

  get isGameplayActive(): boolean {
    return this.gameplayActive;
  }

  /**
   * Interstitial. Only ever called from the replay path, never mid-combat.
   * Gameplay is always stopped first by the caller.
   */
  async commercialBreak(): Promise<void> {
    if (!this.sdk || !this.adsEnabled) return;
    this.setAdState(true);
    try {
      await this.sdk.commercialBreak();
    } catch {
      /* an ad failing must not block the retry */
    } finally {
      this.setAdState(false);
    }
  }

  /**
   * Whether a rewarded ad can be offered at all.
   *
   * Checked before the button is drawn rather than after it is pressed: an
   * offer of a second chance that then silently does nothing is worse than not
   * offering one.
   */
  get canReward(): boolean {
    return this.sdk !== null && this.adsEnabled;
  }

  /** Feature-flagged revive path. Returns false when no reward was earned. */
  async rewardedBreak(): Promise<boolean> {
    if (!this.sdk || !this.adsEnabled) return false;
    this.setAdState(true);
    try {
      return await this.sdk.rewardedBreak();
    } catch {
      return false;
    } finally {
      this.setAdState(false);
    }
  }

  /** Diagnostic milestones only — telemetry can never affect gameplay. */
  measure(category: string, action: string): void {
    this.safe(() => this.sdk?.customEvent(category, action));
  }

  /** Notified when an ad starts/stops so audio and input can be suspended. */
  onAdState(fn: (state: AdState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setAdState(active: boolean): void {
    this.adActive = active;
    const state: AdState = active ? 'playing' : 'none';
    for (const fn of this.listeners) {
      try {
        fn(state);
      } catch {
        /* a listener must not break the ad flow */
      }
    }
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      /* SDK errors are never fatal */
    }
  }
}

function loadScript(): Promise<PokiSDK | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (window.PokiSDK) return Promise.resolve(window.PokiSDK);
  return new Promise((resolve) => {
    const el = document.createElement('script');
    el.src = SDK_URL;
    el.async = true;
    el.onload = () => resolve(window.PokiSDK ?? null);
    el.onerror = () => resolve(null);
    document.head.appendChild(el);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/** The single small set of diagnostic milestones we report. */
export const MEASURE = {
  tutorialLeft: ['tutorial', 'left-complete'],
  tutorialRight: ['tutorial', 'right-complete'],
  tutorialTiming: ['tutorial', 'timing-complete'],
  firstPerfect: ['milestone', 'first-perfect'],
  firstCombo10: ['milestone', 'first-combo-10'],
  firstGuardBreak: ['milestone', 'first-guard-break'],
  firstFlow: ['milestone', 'first-flow'],
  firstFlowComplete: ['milestone', 'first-flow-complete'],
  run30: ['run', '30-sec-reached'],
  run60: ['run', '60-sec-reached'],
  run120: ['run', '120-sec-reached'],
  run180: ['run', '180-sec-reached'],
  replayVisible: ['button', 'replay-visible'],
  replayInteract: ['button', 'replay-interact'],
  secondNinja: ['character', 'second-ninja-unlocked'],
  selectorInteract: ['character', 'selector-interact'],
  continueInteract: ['revive', 'continue-interact'],
} as const satisfies Record<string, readonly [string, string]>;

export type MeasureKey = keyof typeof MEASURE;
