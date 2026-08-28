import { describe, expect, it } from 'vitest';
import { AUDIO_STORAGE_KEY, SFX_NAMES, Sfx } from '../src/audio/Sfx';
import type { StorageLike } from '../src/data/types';

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();

  constructor(seed?: string) {
    if (seed !== undefined) this.data.set(AUDIO_STORAGE_KEY, seed);
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  raw(): string | null {
    return this.getItem(AUDIO_STORAGE_KEY);
  }
}

describe('audio settings', () => {
  it('starts both channels open when nothing was ever saved', () => {
    const sfx = new Sfx({ storage: new FakeStorage() });
    expect(sfx.sfxVolume).toBe(1);
    expect(sfx.musicVolume).toBe(1);
  });

  it('persists each channel so the next session opens where it was left', () => {
    const storage = new FakeStorage();
    const first = new Sfx({ storage });
    first.setSfxVolume(0.4);
    first.setMusicVolume(0);
    expect(storage.raw()).not.toBeNull();

    const second = new Sfx({ storage });
    expect(second.sfxVolume).toBeCloseTo(0.4);
    expect(second.musicVolume).toBe(0);
  });

  it('clamps out-of-range values instead of storing them', () => {
    const storage = new FakeStorage();
    const sfx = new Sfx({ storage });
    sfx.setSfxVolume(4);
    sfx.setMusicVolume(-2);
    expect(sfx.sfxVolume).toBe(1);
    expect(sfx.musicVolume).toBe(0);

    sfx.setSfxVolume(Number.NaN);
    expect(sfx.sfxVolume).toBe(1);
  });

  it('ignores unreadable or nonsense saved settings', () => {
    expect(new Sfx({ storage: new FakeStorage('not json') }).sfxVolume).toBe(1);
    expect(new Sfx({ storage: new FakeStorage('{"sfx":"loud"}') }).sfxVolume).toBe(1);
    expect(new Sfx({ storage: new FakeStorage('{"sfx":0.25}') }).sfxVolume).toBeCloseTo(0.25);
  });

  it('keeps muting separate from volume, so unmuting restores the level', () => {
    const sfx = new Sfx({ storage: new FakeStorage() });
    sfx.setSfxVolume(0.6);
    sfx.setMuted(true);
    expect(sfx.sfxVolume).toBeCloseTo(0.6);
    sfx.setMuted(false);
    expect(sfx.sfxVolume).toBeCloseTo(0.6);
  });

  it('survives storage that refuses to write', () => {
    const throwing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    const sfx = new Sfx({ storage: throwing });
    expect(() => sfx.setMusicVolume(0.3)).not.toThrow();
    expect(sfx.musicVolume).toBeCloseTo(0.3);
  });

  it('plays nothing before a gesture has unlocked the context', () => {
    const sfx = new Sfx({ storage: new FakeStorage() });
    expect(() => sfx.play('click')).not.toThrow();
  });

  it('remembers an act change made before the first audio gesture', () => {
    const sfx = new Sfx({ storage: new FakeStorage() });
    sfx.setMusicTrack('storm');
    expect(sfx.musicTrack).toBe('storm');
  });

  it('ships a broad, duplicate-free gameplay cue palette', () => {
    expect(SFX_NAMES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(SFX_NAMES).size).toBe(SFX_NAMES.length);
  });
});
