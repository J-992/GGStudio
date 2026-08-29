import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { GameCore } from '../src/core/GameCore';
import { SaveSystem } from '../src/systems/SaveSystem';
import type { StorageLike } from '../src/data/types';

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

describe('board lessons', () => {
  it('starts untaught and records each lesson exactly once', () => {
    const game = new GameCore({ storage: null, now: () => 0 });
    expect(game.boardLessonSeen('lockedSlots')).toBe(false);

    game.completeBoardLesson('lockedSlots');
    game.completeBoardLesson('lockedSlots');

    expect(game.boardLessonSeen('lockedSlots')).toBe(true);
    expect(game.boardLessonSeen('debris')).toBe(false);
  });

  it('keeps taught lessons for good, through a reset and a reload', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    game.completeBoardLesson('debris');
    game.resetRun();

    expect(game.boardLessonSeen('debris')).toBe(true);
    expect(new GameCore({ storage, now: () => 0 }).boardLessonSeen('debris')).toBe(true);
  });

  it('drops unknown lesson ids rather than trusting the meta slot', () => {
    const storage = new FakeStorage();
    new SaveSystem(storage).saveMeta({ ascensions: 0, boardLessonsSeen: ['debris', 'nonsense', 'debris'] });

    expect(new SaveSystem(storage).loadMeta()?.boardLessonsSeen).toEqual(['debris']);
  });

  it('has something to teach: a fresh run really does start with locked slots', () => {
    const game = new GameCore({ storage: null, now: () => 0 });
    expect(game.lockedSlots.length).toBe(BALANCE.board.slots - BALANCE.slots.initial);
    expect(game.nextUnlockSlot).not.toBeNull();
  });
});
