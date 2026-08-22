import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, ACHIEVEMENT_COUNT, achievementById } from '../src/data/achievements';
import type { AchievementSnapshot } from '../src/data/achievements';
import { BALANCE } from '../src/data/balance';
import { BOSS_COUNT } from '../src/data/enemies';
import { GameCore } from '../src/core/GameCore';
import { AchievementSystem } from '../src/systems/AchievementSystem';
import { ascensionRank, MAX_ASCENSION_RANK } from '../src/systems/AscensionSystem';
import type { StorageLike } from '../src/data/types';

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

const blank = (): AchievementSnapshot => ({
  stage: 1, highestTier: 1, merges: 0, purchases: 0, bossDefeats: 0,
  coinsEarned: 0, timePlayedMs: 0, tiersDiscovered: 0, bossesSeen: 0,
  ascensions: 0, daysVisited: 1,
});

describe('achievement definitions', () => {
  it('has unique ids', () => {
    const ids = ACHIEVEMENTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shouts every label, because the bitmap font has no lowercase glyphs', () => {
    for (const entry of ACHIEVEMENTS) {
      expect(entry.name).toBe(entry.name.toUpperCase());
      expect(entry.description).toBe(entry.description.toUpperCase());
    }
  });

  it('awards nothing to a player who has just started', () => {
    const earned = ACHIEVEMENTS.filter((entry) => entry.earned(blank()));
    expect(earned).toEqual([]);
  });

  it('is fully reachable: a maxed-out snapshot earns every one', () => {
    const maxed: AchievementSnapshot = {
      stage: 999,
      highestTier: BALANCE.tiers.count,
      merges: 10_000,
      purchases: 10_000,
      bossDefeats: 999,
      coinsEarned: 10_000_000,
      timePlayedMs: 60 * 60_000,
      tiersDiscovered: BALANCE.tiers.count,
      bossesSeen: BOSS_COUNT,
      ascensions: 10,
      daysVisited: 30,
    };
    expect(ACHIEVEMENTS.filter((entry) => entry.earned(maxed))).toHaveLength(ACHIEVEMENT_COUNT);
  });

  it('can complete the collection pair, which the old counter could not', () => {
    const complete = { ...blank(), tiersDiscovered: BALANCE.tiers.count, bossesSeen: BOSS_COUNT };
    expect(achievementById('collect-all')!.earned(complete)).toBe(true);
  });
});

describe('AchievementSystem', () => {
  it('awards each achievement exactly once', () => {
    const system = new AchievementSystem();
    const snapshot = { ...blank(), merges: 1 };

    expect(system.claim(snapshot).map((entry) => entry.id)).toEqual(['first-merge']);
    expect(system.claim(snapshot)).toEqual([]);
    expect(system.unlockedCount).toBe(1);
  });

  it('returns a simultaneous burst in easiest-first order', () => {
    const system = new AchievementSystem();
    const earned = system.claim({ ...blank(), merges: 300, bossDefeats: 1 });
    expect(earned.map((entry) => entry.id)).toEqual([
      'first-merge', 'first-victory', 'merge-50', 'merge-250',
    ]);
  });

  it('restores from a saved id list and never re-awards those', () => {
    const system = new AchievementSystem(['first-merge']);
    expect(system.has('first-merge')).toBe(true);
    expect(system.claim({ ...blank(), merges: 5 })).toEqual([]);
  });

  it('drops ids from an older build so the counter cannot exceed its total', () => {
    const system = new AchievementSystem(['first-merge', 'no-such-achievement']);
    expect(system.unlockedCount).toBe(1);
    expect(system.unlockedIds).toEqual(['first-merge']);
  });

  it('saves ids in definition order regardless of unlock order', () => {
    const system = new AchievementSystem();
    system.claim({ ...blank(), stage: 10 });
    system.claim({ ...blank(), merges: 1 });
    expect(system.unlockedIds).toEqual(['first-merge', 'stage-10']);
  });
});

describe('ascensionRank', () => {
  it('starts every player unranked', () => {
    expect(ascensionRank(0).index).toBe(0);
    expect(ascensionRank(0).name).toBe('STUDENT');
  });

  it('climbs one title per ascension', () => {
    expect(ascensionRank(1).name).toBe('INITIATE');
    expect(ascensionRank(2).name).toBe('ADEPT');
    expect(ascensionRank(1).name).not.toBe(ascensionRank(2).name);
  });

  it('holds the top title instead of inventing new ones', () => {
    const top = ascensionRank(MAX_ASCENSION_RANK);
    expect(ascensionRank(MAX_ASCENSION_RANK + 50)).toEqual(top);
  });

  it('survives a corrupt count', () => {
    expect(ascensionRank(Number.NaN).index).toBe(0);
    expect(ascensionRank(-5).index).toBe(0);
  });
});

describe('achievements in a live run', () => {
  it('announces an unlock through the event bus', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    const seen: string[] = [];
    game.events.on('achievementUnlocked', (event) => seen.push(event.id));

    game.spawnTier(1);
    game.spawnTier(1);
    game.drop(0, { kind: 'slot', slot: 1 });
    game.update(300);

    expect(seen).toContain('first-merge');
  });

  it('keeps unlocks across a defeat that wiped the run save', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    game.spawnTier(1);
    game.spawnTier(1);
    game.drop(0, { kind: 'slot', slot: 1 });
    game.update(300);
    expect(game.achievements.has('first-merge')).toBe(true);

    game.endRunForTest();
    const next = new GameCore({ storage, now: () => 0 });
    expect(next.achievements.has('first-merge')).toBe(true);
    expect(next.achievementProgress.total).toBe(ACHIEVEMENT_COUNT);
  });

  it('does not award anything during construction, where nobody is listening', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    expect(game.achievementProgress.have).toBe(0);
  });
});

describe('the lifetime almanac', () => {
  it('records tier 1, which the reveal-driven counter never could', () => {
    const game = new GameCore({ storage: new FakeStorage(), now: () => 0 });
    game.spawnTier(1);
    expect(game.discoveredTiers.has(1)).toBe(true);
  });

  it('survives losing the run', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    game.spawnTier(4);
    game.spawnTier(7);
    game.endRunForTest();

    const next = new GameCore({ storage, now: () => 0 });
    expect(next.discoveredTiers.has(4)).toBe(true);
    expect(next.discoveredTiers.has(7)).toBe(true);
    // The run itself really did start over.
    expect(next.progression.highestTierEverOwned).toBe(1);
  });

  it('survives an ascension', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    game.spawnTier(11);
    while (!game.canAscend) game.skipEnemy();
    game.ascend();
    expect(game.discoveredTiers.has(11)).toBe(true);
  });

  it('adopts the discoveries of a save written before the lifetime slot existed', () => {
    const storage = new FakeStorage();
    storage.setItem(
      BALANCE.save.key,
      JSON.stringify({
        version: BALANCE.save.version,
        coins: 500, board: [], stage: 6, bossHp: 10, damageCoinRemainder: 0,
        totalPurchases: 9, highestTierEverOwned: 8, playerHp: 150,
        revealedTiers: [2, 3, 8], seenBosses: [0, 1],
        metrics: {
          timePlayedMs: 0, purchases: 9, merges: 4, sells: 0,
          highestTier: 8, bossDefeats: 5, boardFullCount: 0, coinsEarned: 900,
        },
      }),
    );

    const game = new GameCore({ storage, now: () => 0 });
    // Everything up to the old ladder position counts as owned.
    for (let tier = 1; tier <= 8; tier += 1) expect(game.discoveredTiers.has(tier)).toBe(true);
    expect(game.seenBosses.has(1)).toBe(true);
  });
});
