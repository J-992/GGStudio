import type { StorageLike } from '../data/types';
import { Music } from './Music';

export type SfxName = 'click' | 'coin' | 'pickup' | 'drop' | 'merge' | 'hit' | 'strongHit' | 'defeat' | 'newTier' | 'bossDefeat' | 'sell';

/** Where the two channel volumes live between sessions. */
export const AUDIO_STORAGE_KEY = 'mn.audio';

/** Loudest the cue bus ever runs, before the player's own sfx volume. */
const SFX_CEILING = .18;

const clamp01 = (value: number, fallback: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

/** Small, deliberately soft WebAudio cues. Construction is deferred until a gesture. */
export class Sfx {
  private context: AudioContext | null = null; private master: GainNode | null = null; private music: GainNode | null = null; private muted = false; private voices = 0;
  /**
   * The portal's own override, held apart from the player's mute so an ad
   * cannot unmute a game the player muted, and the player's setting survives
   * the break untouched.
   */
  private platformMuted = false;
  private sfxLevel = 1; private musicLevel = 1; private track: Music | null = null;
  private readonly storage: StorageLike | null;

  constructor(opts: { storage?: StorageLike | null } = {}) {
    this.storage = opts.storage === undefined ? this.defaultStorage() : opts.storage;
    this.loadLevels();
  }

  /** Cue volume the player chose, 0..1. Muting does not move it. */
  get sfxVolume(): number { return this.sfxLevel; }
  /** Music volume the player chose, 0..1. Drives the synthesized theme bus. */
  get musicVolume(): number { return this.musicLevel; }

  unlock(): void {
    if (this.context !== null) { void this.context.resume(); return; }
    const Ctor = window.AudioContext; if (Ctor === undefined) return;
    this.context = new Ctor();
    // Mobile browsers suspend the context when the tab hides; pick it back up
    // the moment the player returns instead of waiting for the next gesture.
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.master = this.context.createGain(); this.master.gain.value = this.effectiveSfxGain(); this.master.connect(this.context.destination);
    // Built now so a music track added later only has to connect to it: the
    // player's slider is already applied, and already persisted.
    this.music = this.context.createGain(); this.music.gain.value = this.effectiveMusicGain(); this.music.connect(this.context.destination);
    // First real gesture is also the cue to roll the theme; playMusic is idempotent.
    this.playMusic();
  }

  /** Stops the theme, drops every node, and releases the AudioContext. */
  dispose(): void {
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.track?.stop();
    this.track = null;
    void this.context?.close().catch(() => undefined);
    this.context = null; this.master = null; this.music = null;
  }

  private handleVisibility = (): void => {
    if (document.hidden || this.context === null) return;
    if (this.context.state === 'suspended') void this.context.resume();
  };

  setMuted(muted: boolean): void { this.muted = muted; this.applyGains(); }

  /** Silence demanded by the portal -- an ad is on screen. Poki requires it. */
  setPlatformMuted(muted: boolean): void { this.platformMuted = muted; this.applyGains(); }

  setSfxVolume(value: number): void { this.sfxLevel = clamp01(value, this.sfxLevel); this.applyGains(); this.saveLevels(); }

  setMusicVolume(value: number): void { this.musicLevel = clamp01(value, this.musicLevel); this.applyGains(); this.saveLevels(); }

  /** Starts the theme on the music bus. Safe to call any number of times. */
  playMusic(): void {
    if (this.context === null || this.music === null || this.track !== null) return;
    this.track = new Music(this.context, this.music);
    this.track.start();
  }

  play(name: SfxName, tier = 1): void {
    if (this.context === null || this.master === null || this.silenced || this.sfxLevel <= 0 || this.voices >= 5) return;
    const c = this.context; const now = c.currentTime;
    const base: Record<SfxName, number> = { click: 440, coin: 880, pickup: 520, drop: 300, merge: 420 + tier * 65, hit: 180, strongHit: 130, defeat: 220, newTier: 620, bossDefeat: 360, sell: 330 };
    const osc = c.createOscillator(); const gain = c.createGain();
    osc.type = name === 'hit' || name === 'strongHit' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(base[name], now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(70, base[name] * (name === 'merge' || name === 'coin' ? 1.35 : .7)), now + .12);
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.22, now + .012); gain.gain.exponentialRampToValueAtTime(.0001, now + .16);
    osc.connect(gain).connect(this.master);
    this.voices += 1; osc.start(now); osc.stop(now + .18);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); this.voices -= 1; };
  }

  private get silenced(): boolean { return this.muted || this.platformMuted; }

  private effectiveSfxGain(): number { return this.silenced ? 0 : SFX_CEILING * this.sfxLevel; }

  private effectiveMusicGain(): number { return this.silenced ? 0 : this.musicLevel; }

  private applyGains(): void {
    if (this.context === null) return;
    const now = this.context.currentTime;
    this.master?.gain.setTargetAtTime(this.effectiveSfxGain(), now, .02);
    this.music?.gain.setTargetAtTime(this.effectiveMusicGain(), now, .02);
  }

  private loadLevels(): void {
    try {
      const raw = this.storage?.getItem(AUDIO_STORAGE_KEY);
      if (raw === null || raw === undefined) return;
      const saved: unknown = JSON.parse(raw);
      if (typeof saved !== 'object' || saved === null) return;
      const { sfx, music } = saved as { sfx?: unknown; music?: unknown };
      if (typeof sfx === 'number') this.sfxLevel = clamp01(sfx, 1);
      if (typeof music === 'number') this.musicLevel = clamp01(music, 1);
    } catch {
      // Unreadable settings are not worth failing a boot over.
    }
  }

  private saveLevels(): void {
    try {
      this.storage?.setItem(AUDIO_STORAGE_KEY, JSON.stringify({ sfx: this.sfxLevel, music: this.musicLevel }));
    } catch {
      // Storage may throw in Safari private browsing; play continues.
    }
  }

  private defaultStorage(): StorageLike | null { try { return globalThis.localStorage; } catch { return null; } }
}
