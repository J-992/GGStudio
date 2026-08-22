import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { GameCore } from '../src/core/GameCore';
import { dailyBonus, localDayIndex } from '../src/systems/DailyBonus';
import type { StorageLike } from '../src/data/types';

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

const CONFIG = BALANCE.daily;
const DAY = 86_400_000;

describe('localDayIndex', () => {
  it('splits days at local midnight, not UTC midnight', () => {
    // 04:00 UTC. In UTC that is already the 2nd; five hours behind UTC it is
    // still 23:00 on the 1st, so the two must land on different day indices.
    const utcMorning = Date.UTC(2026, 0, 2, 4, 0, 0);
    expect(localDayIndex(utcMorning, 0)).toBe(localDayIndex(Date.UTC(2026, 0, 2, 12), 0));
    expect(localDayIndex(utcMorning, 300)).toBe(localDayIndex(utcMorning, 0) - 1);
  });

  it('advances by exactly one per calendar day', () => {
    const base = Date.UTC(2026, 5, 1, 12, 0, 0);
    expect(localDayIndex(base + DAY, 0) - localDayIndex(base, 0)).toBe(1);
    expect(localDayIndex(base + 3 * DAY, 0) - localDayIndex(base, 0)).toBe(3);
  });

  it('survives a nonsense clock', () => {
    expect(localDayIndex(Number.NaN, 0)).toBe(0);
    expect(Number.isFinite(localDayIndex(0, Number.NaN))).toBe(true);
  });
});

describe('dailyBonus', () => {
  it('pays on the first visit of a new day', () => {
    const result = dailyBonus(10, 11, 0, 4, CONFIG);
    expect(result).not.toBeNull();
    expect(result!.dayIndex).toBe(11);
    expect(result!.daysVisited).toBe(5);
  });

  it('pays only once per day, however many times the page reloads', () => {
    expect(dailyBonus(11, 11, 0, 1, CONFIG)).toBeNull();
  });

  it('scales with the player earn rate but never below the floor', () => {
    const idle = dailyBonus(1, 2, 0, 1, CONFIG);
    expect(idle!.coins).toBe(CONFIG.minCoins);

    const earning = dailyBonus(1, 2, 100, 1, CONFIG);
    expect(earning!.coins).toBe(100 * CONFIG.secondsOfIncome);
  });

  it('cannot be farmed by winding the clock backwards', () => {
    expect(dailyBonus(500, 499, 10, 3, CONFIG)).toBeNull();
    expect(dailyBonus(500, 100, 10, 3, CONFIG)).toBeNull();
  });

  it('counts a first visit with no history as day one', () => {
    const result = dailyBonus(null, 42, 0, 0, CONFIG);
    expect(result!.daysVisited).toBe(1);
  });

  it('ignores a corrupt visit count or day', () => {
    expect(dailyBonus(Number.NaN, 10, 0, 2, CONFIG)!.daysVisited).toBe(3);
    expect(dailyBonus(1, Number.NaN, 0, 2, CONFIG)).toBeNull();
    expect(dailyBonus(1, 2, 0, Number.NaN, CONFIG)!.daysVisited).toBe(1);
  });
});

describe('daily bonus on load', () => {
  it('pays nothing on a first-ever session, but remembers the day', () => {
    const storage = new FakeStorage();
    const first = new GameCore({ storage, now: () => Date.UTC(2026, 2, 1, 12) });
    expect(first.consumeDailyBonus()).toBeNull();
    expect(first.daysPlayed).toBe(1);
  });

  it('pays on the next day and hands the announcement over exactly once', () => {
    const storage = new FakeStorage();
    const first = new GameCore({ storage, now: () => Date.UTC(2026, 2, 1, 12) });
    first.spawnTier(6);
    first.save();

    const nextDay = new GameCore({ storage, now: () => Date.UTC(2026, 2, 2, 12) });
    const reward = nextDay.consumeDailyBonus();
    expect(reward).not.toBeNull();
    expect(reward!.coins).toBeGreaterThan(0);
    expect(reward!.daysVisited).toBe(2);
    expect(nextDay.consumeDailyBonus()).toBeNull();
  });

  it('does not pay twice in one day across reloads', () => {
    const storage = new FakeStorage();
    new GameCore({ storage, now: () => Date.UTC(2026, 2, 1, 9) });
    const later = new GameCore({ storage, now: () => Date.UTC(2026, 2, 1, 23) });
    expect(later.consumeDailyBonus()).toBeNull();
    expect(later.daysPlayed).toBe(1);
  });

  it('credits the coins, not just the announcement', () => {
    const storage = new FakeStorage();
    const first = new GameCore({ storage, now: () => Date.UTC(2026, 2, 1, 12) });
    first.save();
    const before = first.economy.coins;

    const nextDay = new GameCore({ storage, now: () => Date.UTC(2026, 2, 2, 12) });
    const reward = nextDay.consumeDailyBonus()!;
    expect(nextDay.economy.coins).toBe(before + reward.coins);
  });
});
