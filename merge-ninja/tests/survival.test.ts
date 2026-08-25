import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { GameCore } from '../src/core/GameCore';
import { POTION, potionGapMs } from '../src/data/pickups';
import type { GameEvent } from '../src/core/EventBus';
import type { StorageLike } from '../src/data/types';

const newGame = () => new GameCore({ storage: null });

/** Run the sim until the line dies, or give up so a bug cannot hang the suite. */
const playUntilDead = (game: GameCore, budgetMs = 20 * 60_000): void => {
  let elapsed = 0;
  while (!game.isGameOver && elapsed < budgetMs) {
    game.update(250);
    elapsed += 250;
  }
};

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

describe('running out of health', () => {
  it('ends the run at zero rather than quietly reviving the line', () => {
    const game = newGame();
    game.spawnTier(1);
    playUntilDead(game);

    expect(game.isGameOver).toBe(true);
    expect(game.playerHealth).toBe(0);
    expect(game.healthRatio).toBe(0);
  });

  it('announces the game over once, with the run worth showing on the screen', () => {
    const game = newGame();
    game.spawnTier(1);
    const overs: Array<Extract<GameEvent, { type: 'gameOver' }>> = [];
    game.events.on('gameOver', (event) => overs.push(event));

    playUntilDead(game);
    game.update(60_000);

    expect(overs).toHaveLength(1);
    expect(overs[0]?.stage).toBeGreaterThanOrEqual(1);
    expect(overs[0]?.highestTier).toBeGreaterThanOrEqual(1);
  });

  it('freezes the simulation so a dead line cannot keep fighting', () => {
    const game = newGame();
    game.spawnTier(1);
    playUntilDead(game);

    const bossHp = game.boss.hp;
    const coins = game.economy.coins;
    const played = game.metrics.timePlayedMs;
    game.update(10_000);

    expect(game.boss.hp).toBe(bossHp);
    expect(game.economy.coins).toBe(coins);
    expect(game.metrics.timePlayedMs).toBe(played);
  });

  it('throws the save away so a reload is a fresh run, not a corpse', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage });
    game.spawnTier(1);
    game.save();
    expect(storage.getItem(BALANCE.save.key)).not.toBeNull();

    playUntilDead(game);
    game.update(BALANCE.save.flushMs * 3);

    expect(storage.getItem(BALANCE.save.key)).toBeNull();
  });

  it('refuses to buy, merge or heal after the run is over', () => {
    const game = newGame();
    game.spawnTier(1);
    playUntilDead(game);

    game.grantCoins(10_000);
    expect(game.buy()).toBeNull();
    expect(game.healPlayer(50)).toBe(0);
    expect(game.playerHealth).toBe(0);
  });

  it('allows exactly one rewarded revive and resumes the frozen run at 45% health', () => {
    const game = newGame();
    game.spawnTier(1);
    playUntilDead(game);

    expect(game.canRewardedRevive).toBe(true);
    expect(game.reviveFromRewardedAd()).toBe(true);
    expect(game.isGameOver).toBe(false);
    expect(game.healthRatio).toBeGreaterThanOrEqual(0.45);
    expect(game.reviveFromRewardedAd()).toBe(false);
  });
});

describe('low health warning', () => {
  it('is quiet at full health and raised under the warning ratio', () => {
    const game = newGame();
    game.spawnTier(1);
    expect(game.lowHealth).toBe(false);

    while (!game.isGameOver && game.healthRatio > BALANCE.player.lowHealthRatio) game.update(250);

    expect(game.isGameOver).toBe(false);
    expect(game.lowHealth).toBe(true);
  });

  it('stops warning once the run is over -- the game over screen speaks for itself', () => {
    const game = newGame();
    game.spawnTier(1);
    playUntilDead(game);
    expect(game.lowHealth).toBe(false);
  });
});

describe('potion pickups', () => {
  it('restores health and reports what it actually gave back', () => {
    const game = newGame();
    game.spawnTier(1);
    while (game.healthRatio > 0.5 && !game.isGameOver) game.update(250);
    const before = game.playerHealth;

    const healed = game.healPlayer(30);

    expect(healed).toBe(30);
    expect(game.playerHealth).toBe(before + 30);
  });

  it('never overheals past the line\'s maximum', () => {
    const game = newGame();
    game.spawnTier(1);
    const healed = game.healPlayer(9_999);

    expect(game.playerHealth).toBe(game.playerMaxHealth);
    expect(healed).toBe(0);
  });

  it('announces the heal so the HUD can react', () => {
    const game = newGame();
    game.spawnTier(1);
    while (game.healthRatio > 0.5 && !game.isGameOver) game.update(250);

    const reasons: string[] = [];
    game.events.on('playerHealthChanged', (event) => reasons.push(event.reason));
    game.healPlayer(20);

    expect(reasons).toContain('potion');
  });

  it('drops more often than the golden clock', () => {
    expect(POTION.firstSpawnMs).toBeLessThan(45_000);
    expect(POTION.maxGapMs).toBeLessThan(80_000);
    expect(POTION.minGapMs).toBeLessThan(POTION.maxGapMs);
  });

  it('hurries the next bottle along when the line is nearly out', () => {
    const calm = potionGapMs(1, 0.5);
    const urgent = potionGapMs(0.15, 0.5);

    expect(urgent).toBeLessThan(calm);
    expect(urgent).toBeGreaterThanOrEqual(POTION.urgentMinGapMs);
    expect(urgent).toBeLessThanOrEqual(POTION.urgentMaxGapMs);
  });

  it('keeps every gap inside its band whatever the roll', () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      const gap = potionGapMs(1, roll);
      expect(gap).toBeGreaterThanOrEqual(POTION.minGapMs);
      expect(gap).toBeLessThanOrEqual(POTION.maxGapMs);
    }
  });
});
