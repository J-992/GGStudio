import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { GameCore } from '../src/core/GameCore';
import { SaveSystem } from '../src/systems/SaveSystem';
import type { StorageLike } from '../src/data/types';

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    return null;
  }

  setItem(): void {
    throw new Error('Private browsing blocks storage');
  }

  removeItem(): void {}
}


/** A minimal, valid run slot at a given save version. */
const legacyRun = (version: number): Record<string, unknown> => ({
  version,
  coins: 120,
  board: [{ id: 1, tier: 4 }, null],
  stage: 6,
  bossHp: 40,
  damageCoinRemainder: 0,
  totalPurchases: 3,
  highestTierEverOwned: 4,
  playerHp: 150,
  metrics: {
        timePlayedMs: 0, purchases: 3, merges: 2, sells: 0,
        highestTier: 4, bossDefeats: 1, boardFullCount: 0, coinsEarned: 0,
      },
});

describe('save system', () => {
  it('round trips coins, board, stage, boss HP, purchases, and highest tier', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    game.grantCoins(100);
    game.buy();
    game.spawnTier(4);
    game.update(500);
    game.skipEnemy();
    game.save();

    const restored = new GameCore({ storage, now: () => 0 });
    expect(restored.economy.coins).toBe(game.economy.coins);
    expect(restored.board.at(0)?.tier).toBe(1);
    expect(restored.board.at(1)?.tier).toBe(4);
    expect(restored.boss.stage).toBe(2);
    expect(restored.boss.hp).toBe(restored.boss.boss.maxHealth);
    expect(restored.buyCost).toBe(game.buyCost);
    expect(restored.progression.highestTierEverOwned).toBe(4);
  });

  it('ignores corrupt JSON and starts a fresh run', () => {
    const storage = new FakeStorage();
    storage.setItem(BALANCE.save.key, '{bad');

    expect(() => new GameCore({ storage, now: () => 0 })).not.toThrow();
    const game = new GameCore({ storage, now: () => 0 });
    expect(game.economy.coins).toBe(BALANCE.economy.startCoins);
    expect(game.board.at(0)).toBeNull();
  });

  it('discards a save from a different version rather than partially loading it', () => {
    const storage = new FakeStorage();
    storage.setItem(
      BALANCE.save.key,
      JSON.stringify({
        version: 999,
        coins: 999,
        board: [{ id: 1, tier: 12 }],
        stage: 20,
        bossHp: 1,
        damageCoinRemainder: 0,
        totalPurchases: 20,
        highestTierEverOwned: 12,
        metrics: {},
      }),
    );

    const game = new GameCore({ storage, now: () => 0 });
    expect(game.economy.coins).toBe(BALANCE.economy.startCoins);
    expect(game.board.at(0)).toBeNull();
    expect(game.boss.stage).toBe(1);
  });

  it('wipes the slot so the next session is a first-ever one', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    game.grantCoins(500);
    game.buy();
    game.spawnTier(6);
    game.skipEnemy();
    game.save();

    game.wipeSave();
    expect(storage.getItem(BALANCE.save.key)).toBeNull();

    const fresh = new GameCore({ storage, now: () => 0 });
    expect(fresh.economy.coins).toBe(BALANCE.economy.startCoins);
    expect(fresh.board.slots.every((ninja) => ninja === null)).toBe(true);
    expect(fresh.boss.stage).toBe(1);
    expect(fresh.progression.highestTierEverOwned).toBe(1);
    expect(fresh.revealedTiers.size).toBe(0);
    expect(fresh.metrics.purchases).toBe(0);
  });

  it('does not let a pending flush resurrect a wiped save', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    game.grantCoins(500);
    game.buy();

    game.wipeSave();
    game.update(BALANCE.save.flushMs + 100);

    expect(storage.getItem(BALANCE.save.key)).toBeNull();
  });

  it('does not crash when storage throws during a save', () => {
    const game = new GameCore({ storage: new ThrowingStorage(), now: () => 0 });
    game.spawnTier(1);

    expect(() => game.save()).not.toThrow();
    expect(game.board.at(0)?.tier).toBe(1);
  });

  it('keeps first-run tutorial completion in meta progression', () => {
    const storage = new FakeStorage();
    const first = new GameCore({ storage, now: () => 0 });
    expect(first.tutorialCompleted).toBe(false);

    first.completeTutorial();
    const returning = new GameCore({ storage, now: () => 0 });
    expect(returning.tutorialCompleted).toBe(true);
    expect(returning.powerupCoachCompleted).toBe(false);

    returning.completePowerupCoach('shurikenFrenzy');
    const coached = new GameCore({ storage, now: () => 0 });
    expect(coached.powerupCoachCompleted).toBe(true);
  });

  it('migrates a legacy 50-tier save into the curated 29-tier roster', () => {
    const storage = new FakeStorage();
    storage.setItem(
      BALANCE.save.key,
      JSON.stringify({
        version: 3,
        coins: 200,
        board: [{ id: 9, tier: 50 }, { id: 10, tier: 40 }],
        stage: 1,
        bossHp: 1,
        damageCoinRemainder: 0,
        totalPurchases: 20,
        highestTierEverOwned: 50,
        playerHp: 300,
        revealedTiers: [40, 50, 50],
        seenBosses: [0, 36, 49],
        metrics: {
          timePlayedMs: 0, purchases: 20, merges: 19, sells: 0,
          highestTier: 50, bossDefeats: 8, boardFullCount: 0, coinsEarned: 0,
        },
      }),
    );

    const restored = new GameCore({ storage, now: () => 0 });
    expect(restored.board.at(0)?.tier).toBe(29);
    expect(restored.board.at(1)?.tier).toBe(24);
    expect(restored.progression.highestTierEverOwned).toBe(29);
    expect(restored.metrics.highestTier).toBe(29);
    expect([...restored.revealedTiers]).toEqual([24, 29]);
    expect([...restored.seenBosses]).toEqual([0, 36]);

    restored.save();
    expect(JSON.parse(storage.getItem(BALANCE.save.key) ?? '{}').version).toBe(BALANCE.save.version);
  });

  it('grants a pre-version-6 save the whole board rather than confiscating slots', () => {
    const storage = new FakeStorage();
    storage.setItem(BALANCE.save.key, JSON.stringify(legacyRun(5)));

    const restored = new SaveSystem(storage).load();
    expect(restored?.version).toBe(BALANCE.save.version);
    expect(restored?.unlockedSlots).toBe(BALANCE.board.slots);
    expect(restored?.debris).toEqual([]);
    expect(restored?.draftPicks).toEqual([]);
  });

  it('grants the whole board to a version-6 save written before slot locking shipped', () => {
    const storage = new FakeStorage();
    storage.setItem(BALANCE.save.key, JSON.stringify(legacyRun(BALANCE.save.version)));

    expect(new SaveSystem(storage).load()?.unlockedSlots).toBe(BALANCE.board.slots);
  });

  it('holds earned slots inside the board, never below the starting grant', () => {
    const storage = new FakeStorage();
    const load = (unlockedSlots: unknown): number | undefined => {
      storage.setItem(BALANCE.save.key, JSON.stringify({ ...legacyRun(BALANCE.save.version), unlockedSlots }));
      return new SaveSystem(storage).load()?.unlockedSlots;
    };

    expect(load(0)).toBe(BALANCE.slots.initial);
    expect(load(BALANCE.board.slots + 5)).toBe(BALANCE.board.slots);
    expect(load(BALANCE.slots.initial + 1.8)).toBe(BALANCE.slots.initial + 1);
  });

  it('drops debris that points nowhere, repeats a slot, or has no time left', () => {
    const storage = new FakeStorage();
    storage.setItem(
      BALANCE.save.key,
      JSON.stringify({
        ...legacyRun(BALANCE.save.version),
        debris: [
          { slot: 3, msLeft: 4_000 },
          { slot: 3, msLeft: 9_000 },
          { slot: -1, msLeft: 5_000 },
          { slot: BALANCE.board.slots, msLeft: 5_000 },
          { slot: 5, msLeft: 0 },
          { slot: 6, msLeft: BALANCE.debris.holdMs * 4 },
        ],
      }),
    );

    const debris = new SaveSystem(storage).load()?.debris ?? [];
    expect(debris).toEqual([
      { slot: 3, msLeft: 4_000 },
      { slot: 6, msLeft: BALANCE.debris.holdMs },
    ]);
  });

  it('never restores more debris than the board is allowed to carry at once', () => {
    const storage = new FakeStorage();
    storage.setItem(
      BALANCE.save.key,
      JSON.stringify({
        ...legacyRun(BALANCE.save.version),
        debris: Array.from({ length: BALANCE.board.slots }, (_, slot) => ({ slot, msLeft: 1_000 })),
      }),
    );

    expect(new SaveSystem(storage).load()?.debris).toHaveLength(BALANCE.debris.maxConcurrent);
  });

  it('keeps taught boss archetypes in meta progression, dropping unknown ids', () => {
    const storage = new FakeStorage();
    const saves = new SaveSystem(storage);
    saves.saveMeta({ ascensions: 0, archetypeSeen: ['shielded', 'enraged', 'shielded', 'nonsense'] });

    expect(saves.loadMeta()?.archetypeSeen).toEqual(['shielded', 'enraged']);
  });
});

