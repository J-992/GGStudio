/**
 * Player-facing settings (audio, accessibility, controls, quality) for
 * Rooftop Rascal: Cat Escape. Persisted through the same `StorageAdapter`
 * seam as `SaveManager` so both can later be pointed at a platform SDK
 * together.
 */

import type { StorageAdapter } from './SaveManager';
import { LocalStorageAdapter } from './SaveManager';

export interface GameSettings {
  masterVolume: number; // 0..1
  musicVolume: number; // 0..1
  effectsVolume: number; // 0..1
  muted: boolean;
  reducedCameraMotion: boolean;
  reducedScreenShake: boolean;
  assistMode: boolean; // opt-in only - must default to false
  highContrastText: boolean;
  graphicsQuality: 'low' | 'medium' | 'high';
  pauseOnFocusLoss: boolean;
}

const STORAGE_KEY = 'rooftop-rascal:settings:v1';
const SAVE_DEBOUNCE_MS = 250;

const VOLUME_MIN = 0;
const VOLUME_MAX = 1;

/**
 * Crude, one-shot detection of a reasonable starting `graphicsQuality`. This
 * only picks the *initial* value shown the first time a player opens
 * settings - they can always change it, and the choice is never re-evaluated
 * after that, so keeping the guesswork isolated here makes it easy to find
 * and revise later without hunting through the rest of the game.
 */
function detectDefaultGraphicsQuality(): GameSettings['graphicsQuality'] {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const cores = typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 4;
  const looksMobile = typeof nav?.userAgent === 'string' && /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);

  // Coarse pointer / touch points is a more reliable "this is a touch
  // device" signal than the UA regex above, but doesn't replace it - some
  // in-app webviews report a normal desktop-ish UA while still being touch
  // primary, and vice versa. Kept as a local, standalone check (rather than
  // importing InputManager's own `detectTouchCapability`) so this module
  // stays dependency-free, same as it's always been.
  const win = typeof window !== 'undefined' ? window : undefined;
  const looksTouchPrimary =
    (typeof win?.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches) ||
    (typeof nav?.maxTouchPoints === 'number' && nav.maxTouchPoints > 0);

  // A phone/tablet UA at a low-to-mid core count is the strongest signal
  // this game has for "actual weak mobile hardware" - shadows and particles
  // are both still enabled at 'medium' (see `Game.ts`'s settings-change
  // handler), and both are real cost on a budget phone's GPU, so this is
  // the one case worth reaching all the way down to 'low' automatically.
  // `hardwareConcurrency` is a crude, sometimes browser-capped signal on
  // mobile, so it only ever pulls the default *down* to 'low' here, never
  // back up past 'medium' - a mobile UA with a high reported core count
  // still lands on 'medium', the same default this returned before.
  if (looksMobile) return cores <= 4 ? 'low' : 'medium';
  if (looksTouchPrimary) return 'medium';
  return cores <= 2 ? 'medium' : 'high';
}

function createDefaultSettings(): GameSettings {
  return {
    masterVolume: 1,
    musicVolume: 1,
    effectsVolume: 1,
    muted: false,
    reducedCameraMotion: false,
    reducedScreenShake: false,
    assistMode: false,
    highContrastText: false,
    graphicsQuality: detectDefaultGraphicsQuality(),
    pauseOnFocusLoss: true,
  };
}

// ---------------------------------------------------------------------------
// Field-level validation helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeRangedNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function isGraphicsQuality(value: unknown): value is GameSettings['graphicsQuality'] {
  return value === 'low' || value === 'medium' || value === 'high';
}

type ChangeHandler = (settings: GameSettings, changedKey: keyof GameSettings) => void;

export class SettingsManager {
  private readonly adapter: StorageAdapter;
  private _settings: GameSettings;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly handlers = new Set<ChangeHandler>();

  constructor(adapter: StorageAdapter = new LocalStorageAdapter()) {
    this.adapter = adapter;
    this._settings = createDefaultSettings();
    this.load();
  }

  get settings(): GameSettings {
    return this._settings;
  }

  private load(): void {
    const raw = this.adapter.get(STORAGE_KEY);
    if (raw === null) {
      this._settings = createDefaultSettings();
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt/truncated JSON must never crash the game - fall back to defaults.
      this._settings = createDefaultSettings();
      return;
    }

    this._settings = this.sanitize(parsed);
  }

  get<K extends keyof GameSettings>(key: K): GameSettings[K] {
    return this._settings[key];
  }

  set<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void {
    // Route the candidate value through the same sanitizer used for loading,
    // by merging it into the current settings first - this guarantees a
    // single source of truth for "what counts as valid" and clamps/validates
    // before anything is stored or broadcast.
    const candidate: Record<string, unknown> = { ...this._settings, [key]: value };
    this._settings = this.sanitize(candidate);
    this.persist();
    this.notify(key);
  }

  /** Fires whenever any setting changes. Returns an unsubscribe function. */
  onChange(handler: ChangeHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  reset(): void {
    this._settings = createDefaultSettings();
    this.persist();
    // A reset touches every field at once; there's no single "changed key",
    // so each key is announced individually for subscribers that filter on one.
    for (const key of Object.keys(this._settings) as Array<keyof GameSettings>) {
      this.notify(key);
    }
  }

  private notify(changedKey: keyof GameSettings): void {
    for (const handler of this.handlers) {
      handler(this._settings, changedKey);
    }
  }

  private persist(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.writeNow();
    }, SAVE_DEBOUNCE_MS);
  }

  private writeNow(): void {
    try {
      this.adapter.set(STORAGE_KEY, JSON.stringify(this._settings));
    } catch {
      // Best-effort persistence: a write failure (quota, etc) must not break gameplay.
    }
  }

  /**
   * Re-derives a trustworthy `GameSettings` from an arbitrary value (parsed
   * JSON from storage, or a candidate merge from `set()`). Numbers are
   * clamped into range rather than rejected outright, enums are checked
   * against the exact allowed literals, and booleans are coerced - anything
   * that doesn't fit falls back to the corresponding default field.
   */
  private sanitize(raw: unknown): GameSettings {
    const fallback = createDefaultSettings();
    if (typeof raw !== 'object' || raw === null) return fallback;
    const obj = raw as Record<string, unknown>;

    return {
      masterVolume: sanitizeRangedNumber(obj.masterVolume, VOLUME_MIN, VOLUME_MAX, fallback.masterVolume),
      musicVolume: sanitizeRangedNumber(obj.musicVolume, VOLUME_MIN, VOLUME_MAX, fallback.musicVolume),
      effectsVolume: sanitizeRangedNumber(obj.effectsVolume, VOLUME_MIN, VOLUME_MAX, fallback.effectsVolume),
      muted: sanitizeBoolean(obj.muted, fallback.muted),
      reducedCameraMotion: sanitizeBoolean(obj.reducedCameraMotion, fallback.reducedCameraMotion),
      reducedScreenShake: sanitizeBoolean(obj.reducedScreenShake, fallback.reducedScreenShake),
      assistMode: sanitizeBoolean(obj.assistMode, fallback.assistMode),
      highContrastText: sanitizeBoolean(obj.highContrastText, fallback.highContrastText),
      graphicsQuality: isGraphicsQuality(obj.graphicsQuality) ? obj.graphicsQuality : fallback.graphicsQuality,
      pauseOnFocusLoss: sanitizeBoolean(obj.pauseOnFocusLoss, fallback.pauseOnFocusLoss),
    };
  }
}
