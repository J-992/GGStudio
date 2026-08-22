import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { BOSS_COUNT } from '../src/data/enemies';
import { GameCore } from '../src/core/GameCore';
import { ascensionIncomeBonus, ascensionUnlocked } from '../src/systems/AscensionSystem';
import type { StorageLike } from '../src/data/types';

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

const ASCEND = BALANCE.ascension;

describe('ascension unlock condition', () => {
  it('stays locked through the whole boss ladder', () => {
    expect(ascensionUnlocked(1, 1)).toBe(false);
    expect(ascensionUnlocked(BOSS_COUNT - 1, 5)).toBe(false);
    expect(ascensionUnlocked(BOSS_COUNT, 10)).toBe(false);
  });

  it('unlocks once the boss ladder has been cleared', () => {
    expect(ascensionUnlocked(BOSS_COUNT + 1, 10)).toBe(true);
    expect(ascensionUnlocked(BOSS_COUNT + 40, 10)).toBe(true);
  });

  it('unlocks at the final tier even in the first loop', () => {
    expect(ascensionUnlocked(3, BALANCE.tiers.count)).toBe(true);
    expect(ascensionUnlocked(3, BALANCE.tiers.count - 1)).toBe(false);
  });
});

describe('ascension bonus curve', () => {
  it('grants nothing before the first ascension', () => {
    expect(ascensionIncomeBonus(0)).toBe(0);
  });

  it('grants the configured bonus after one ascension', () => {
    expect(ascensionIncomeBonus(1)).toBeCloseTo(ASCEND.incomeBonusFirst, 10);
  });

  it('diminishes with each further ascension', () => {
    const second = ascensionIncomeBonus(2) - ascensionIncomeBonus(1);
    const third = ascensionIncomeBonus(3) - ascensionIncomeBonus(2);
    expect(second).toBeLessThan(ASCEND.incomeBonusFirst);
    expect(third).toBeLessThan(second);
    expect(second).toBeCloseTo(ASCEND.incomeBonusFirst * ASCEND.incomeBonusDecay, 10);
  });

  it('keeps growing but never past the configured ceiling', () => {
    const small = ascensionIncomeBonus(3);
    const large = ascensionIncomeBonus(200);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThanOrEqual(ASCEND.maxIncomeBonus);
  });

  it('tolerates a nonsense count from a corrupt meta slot', () => {
    expect(ascensionIncomeBonus(-4)).toBe(0);
    expect(Number.isFinite(ascensionIncomeBonus(Number.NaN))).toBe(true);
  });
});

describe('ascension run integration', () => {
  it('starts locked and locked-looking', () => {
    const game = new GameCore({ storage: new FakeStorage(), now: () => 0 });
    expect(game.ascensionCount).toBe(0);
    expect(game.canAscend).toBe(false);
    expect(game.incomeMultiplier).toBe(1);
  });

  it('resets the run but keeps ascensions, discoveries, and the bonus', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    game.grantCoins(5_000);
    game.spawnTier(29);
    game.spawnTier(9);
    game.skipEnemy();
    game.revealTier(29);
    while (game.boss.stage < BOSS_COUNT + 1) game.skipEnemy();
    game.save();
    expect(game.canAscend).toBe(true);

    const before = {
      coins: game.economy.coins,
      units: game.board.slots.filter((ninja) => ninja !== null).length,
      stage: game.boss.stage,
      highest: game.progression.highestTierEverOwned,
      purchases: game.metrics.purchases,
      hp: game.playerHealth,
    };

    game.ascend();

    expect(game.ascensionCount).toBe(1);
    expect(game.economy.coins).toBe(BALANCE.economy.startCoins);
    expect(game.board.slots.every((ninja) => ninja === null)).toBe(true);
    expect(game.boss.stage).toBe(1);
    expect(game.progression.highestTierEverOwned).toBe(1);
    expect(game.metrics.purchases).toBe(0);
    expect(game.playerHealth).toBe(game.playerMaxHealth);
    expect(game.canAscend).toBe(false);
    // Almanac discoveries are meta-knowledge, not run state.
    expect(game.revealedTiers.has(29)).toBe(true);
    // The earned bonus is live immediately.
    expect(game.incomeMultiplier).toBeCloseTo(1 + ASCEND.incomeBonusFirst, 10);
    expect(before.units).toBeGreaterThan(0);

    // And it is already persisted for the next session.
    const reopened = new GameCore({ storage, now: () => 0 });
    expect(reopened.ascensionCount).toBe(1);
    expect(reopened.incomeMultiplier).toBeCloseTo(1 + ASCEND.incomeBonusFirst, 10);
  });

  it('survives Settings-style Restart Run and a game over', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    while (game.boss.stage < BOSS_COUNT + 1) game.skipEnemy();
    game.ascend();
    expect(game.ascensionCount).toBe(1);

    // Settings' Restart wipes the run slot; the meta slot must outlive it.
    game.wipeSave();
    const fresh = new GameCore({ storage, now: () => 0 });
    expect(fresh.ascensionCount).toBe(1);
    expect(fresh.canAscend).toBe(false);

    // Losing a run must not cost earned ascensions either.
    fresh.endRunForTest();
    const afterLoss = new GameCore({ storage, now: () => 0 });
    expect(afterLoss.ascensionCount).toBe(1);
  });

  it('boosts earned coins by the bonus curve', () => {
    const run = (ascensions: number): number => {
      const storage = new FakeStorage();
      if (ascensions > 0) {
        storage.setItem(BALANCE.save.metaKey, JSON.stringify({ ascensions }));
      }
      const game = new GameCore({ storage, now: () => 0 });
      game.spawnTier(6);
      game.update(4_000);
      return game.economy.coins - BALANCE.economy.startCoins;
    };

    const base = run(0);
    const boosted = run(1);
    expect(base).toBeGreaterThan(0);
    expect(boosted).toBeGreaterThanOrEqual(Math.floor(base * (1 + ASCEND.incomeBonusFirst)) - 2);
    expect(boosted).toBeLessThanOrEqual(Math.ceil(base * (1 + ASCEND.incomeBonusFirst)) + 2);
  });

  it('boosts the offline reward by the same curve', () => {
    const build = (ascensions: number): { storage: FakeStorage; closedAt: number } => {
      const storage = new FakeStorage();
      if (ascensions > 0) {
        storage.setItem(BALANCE.save.metaKey, JSON.stringify({ ascensions }));
      }
      const game = new GameCore({ storage, now: () => 1_000_000 });
      game.spawnTier(8);
      game.save();
      return { storage, closedAt: 1_000_000 + 20 * 60_000 };
    };

    const plain = build(0);
    const plainGame = new GameCore({ storage: plain.storage, now: () => plain.closedAt });
    const plainReward = plainGame.consumeOfflineReward()!.coins;

    const boosted = build(1);
    const boostedGame = new GameCore({ storage: boosted.storage, now: () => boosted.closedAt });
    const boostedReward = boostedGame.consumeOfflineReward()!.coins;

    expect(boostedReward).toBeGreaterThanOrEqual(Math.floor(plainReward * (1 + ASCEND.incomeBonusFirst)) - 2);
    expect(boostedReward).toBeLessThanOrEqual(Math.ceil(plainReward * (1 + ASCEND.incomeBonusFirst)) + 2);
  });

  it('is erased only by a full wipe, not by a run reset', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    while (game.boss.stage < BOSS_COUNT + 1) game.skipEnemy();
    game.ascend();

    game.resetRun();
    expect(game.ascensionCount).toBe(1);

    game.wipeEverything();
    expect(game.ascensionCount).toBe(0);
    // The wipe itself removes the slot outright.
    expect(storage.getItem(BALANCE.save.metaKey)).toBeNull();

    // Booting again writes a fresh meta record -- the slot now also carries the
    // day stamp behind the daily bonus -- but nothing earned survives it.
    const cleared = new GameCore({ storage, now: () => 0 });
    expect(cleared.ascensionCount).toBe(0);
    expect(cleared.achievementProgress.have).toBe(0);
    expect(cleared.best).toEqual({ stage: 0, tier: 0, coins: 0, timeMs: 0 });
    expect(cleared.discoveredTiers.size).toBe(0);
  });

  it('ignores a corrupt meta slot', () => {
    const storage = new FakeStorage();
    storage.setItem(BALANCE.save.metaKey, '{bad json');
    const game = new GameCore({ storage, now: () => 0 });
    expect(game.ascensionCount).toBe(0);
  });
});
