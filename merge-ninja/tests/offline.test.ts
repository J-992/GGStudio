import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { GameCore } from '../src/core/GameCore';
import { offlineReward } from '../src/systems/OfflineProgress';
import type { StorageLike } from '../src/data/types';

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

const OFFLINE = BALANCE.offline;

describe('offlineReward', () => {
  const rate = 10; // coins per second of active play

  it('pays elapsed time at the reduced offline rate', () => {
    const result = offlineReward(10 * 60_000, rate, OFFLINE);
    expect(result).not.toBeNull();
    expect(result!.creditedMs).toBe(10 * 60_000);
    expect(result!.coins).toBe(Math.floor((10 * 60) * rate * OFFLINE.rate));
  });

  it('skips a quick refresh below the minimum threshold', () => {
    expect(offlineReward(OFFLINE.minMs - 1, rate, OFFLINE)).toBeNull();
    expect(offlineReward(OFFLINE.minMs, rate, OFFLINE)).not.toBeNull();
  });

  it('guards against zero and negative elapsed time', () => {
    expect(offlineReward(0, rate, OFFLINE)).toBeNull();
    expect(offlineReward(-5_000, rate, OFFLINE)).toBeNull();
  });

  it('caps the credited time', () => {
    const result = offlineReward(24 * 60 * 60_000, rate, OFFLINE);
    expect(result!.creditedMs).toBe(OFFLINE.capMs);
    expect(result!.coins).toBe(Math.floor((OFFLINE.capMs / 1000) * rate * OFFLINE.rate));
  });

  it('pays nothing when there is no income to credit', () => {
    expect(offlineReward(30 * 60_000, 0, OFFLINE)).toBeNull();
    expect(offlineReward(30 * 60_000, Number.NaN, OFFLINE)).toBeNull();
    expect(offlineReward(30 * 60_000, Number.POSITIVE_INFINITY, OFFLINE)).toBeNull();
  });
});

describe('offline crediting on load', () => {
  it('stamps lastSavedAt on every save', () => {
    const storage = new FakeStorage();
    let clock = 1_000_000;
    const game = new GameCore({ storage, now: () => clock });
    game.spawnTier(3);
    clock += 5_000;
    game.save();
    const saved = JSON.parse(storage.getItem(BALANCE.save.key) ?? '{}');
    expect(saved.lastSavedAt).toBe(1_005_000);
    expect(saved.version).toBe(BALANCE.save.version);
  });

  it('credits coins for time away and exposes the reward exactly once', () => {
    const storage = new FakeStorage();
    let clock = 1_000_000;
    const first = new GameCore({ storage, now: () => clock });
    first.spawnTier(5);
    first.save();

    clock += 10 * 60_000; // ten minutes closed
    const reopened = new GameCore({ storage, now: () => clock });
    const reward = reopened.consumeOfflineReward();
    expect(reward).not.toBeNull();
    expect(reward!.coins).toBeGreaterThan(0);
    // The credited coins landed on top of whatever the run had saved.
    expect(reopened.economy.coins).toBe(BALANCE.economy.startCoins + reward!.coins);
    expect(reopened.consumeOfflineReward()).toBeNull();

    // The credited amount mirrors active play at half rate.
    const dps = first.totalDps;
    const expected = Math.floor(
      (10 * 60) * dps * BALANCE.boss.coinsPerDamage * BALANCE.offline.rate,
    );
    expect(reward!.coins).toBe(expected);
  });

  it('ignores a reload within the minimum window', () => {
    const storage = new FakeStorage();
    let clock = 1_000_000;
    const first = new GameCore({ storage, now: () => clock });
    first.spawnTier(5);
    first.save();

    clock += OFFLINE.minMs - 1_000;
    const reopened = new GameCore({ storage, now: () => clock });
    expect(reopened.consumeOfflineReward()).toBeNull();
    expect(reopened.economy.coins).toBe(BALANCE.economy.startCoins);
  });

  it('pays nothing on a first-ever session', () => {
    const game = new GameCore({ storage: new FakeStorage(), now: () => 0 });
    expect(game.consumeOfflineReward()).toBeNull();
  });

  it('pays nothing when the saved roster has no damage', () => {
    const storage = new FakeStorage();
    let clock = 1_000_000;
    const first = new GameCore({ storage, now: () => clock });
    first.save(); // empty board, no purchases
    clock += 30 * 60_000;
    const reopened = new GameCore({ storage, now: () => clock });
    expect(reopened.consumeOfflineReward()).toBeNull();
  });

  it('survives a clock set before the save was written', () => {
    const storage = new FakeStorage();
    const first = new GameCore({ storage, now: () => 2_000_000 });
    first.spawnTier(5);
    first.save();

    const reopened = new GameCore({ storage, now: () => 1_000_000 });
    expect(reopened.consumeOfflineReward()).toBeNull();
  });

  it('a v4 save without lastSavedAt still loads and earns nothing', () => {
    const storage = new FakeStorage();
    storage.setItem(
      BALANCE.save.key,
      JSON.stringify({
        version: 4,
        coins: 250,
        board: [{ id: 3, tier: 4 }],
        stage: 2,
        bossHp: 10,
        damageCoinRemainder: 0,
        totalPurchases: 4,
        highestTierEverOwned: 4,
        playerHp: 140,
        revealedTiers: [4],
        seenBosses: [0],
        metrics: {
          timePlayedMs: 60_000, purchases: 4, merges: 1, sells: 0,
          highestTier: 4, bossDefeats: 1, boardFullCount: 0, coinsEarned: 100,
        },
      }),
    );

    const game = new GameCore({ storage, now: () => 10_000_000 });
    expect(game.consumeOfflineReward()).toBeNull();
    expect(game.economy.coins).toBe(250);
    expect(game.board.at(0)?.tier).toBe(4);
  });
});
