import { describe, expect, it } from 'vitest';
import { GameCore } from '../src/core/GameCore';
import type { GameEvent } from '../src/core/EventBus';
import { POWERUPS } from '../src/data/powerups';
import type { StorageLike } from '../src/data/types';
import { PowerupSystem } from '../src/systems/PowerupSystem';

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

const firstMerge = (game: GameCore): void => {
  game.grantCoins(100);
  expect(game.buy()).not.toBeNull();
  expect(game.buy()).not.toBeNull();
  expect(game.drop(0, { kind: 'slot', slot: 1 })).toBe('merged');
};

describe('first-run onboarding', () => {
  it('schedules the forced tutorial offer as a normal future pickup, never an immediate duplicate', () => {
    const system = new PowerupSystem([POWERUPS.shurikenFrenzy], { rng: () => 0 });
    system.update(5_000);

    expect(system.forceSpawn()).toBe('shurikenFrenzy');
    expect(system.maybeSpawn(5_000)).toBeNull();
    system.update(79_999);
    expect(system.maybeSpawn(84_999)).toBeNull();
    system.update(1);
    expect(system.maybeSpawn(85_000)).toBe('shurikenFrenzy');
  });

  it('keeps the opening safe through the boss tap without forcing an early powerup', () => {
    const game = new GameCore({ storage: null, now: () => 0 });
    const offers: Extract<GameEvent, { type: 'powerupSpawned' }>[] = [];
    let tutorialFinished = 0;
    game.events.on('powerupSpawned', (event) => offers.push(event));
    game.events.on('tutorialCompleted', () => { tutorialFinished += 1; });

    game.grantCoins(100);
    expect(game.buy()).not.toBeNull();
    game.update(3_000);
    expect(game.playerHealth).toBe(game.playerMaxHealth);

    expect(game.buy()).not.toBeNull();
    expect(game.drop(0, { kind: 'slot', slot: 1 })).toBe('merged');
    game.update(30_000);
    expect(offers).toHaveLength(0);
    expect(game.playerHealth).toBe(game.playerMaxHealth);

    expect(game.tapBoss()).toBeGreaterThan(0);
    expect(game.tutorialCompleted).toBe(true);
    expect(tutorialFinished).toBe(1);
    game.completeTutorial();
    expect(tutorialFinished).toBe(1);

    game.update(30_000);
    expect(game.playerHealth).toBeLessThan(game.playerMaxHealth);
  });

  it('restores the shield and boss-tap lesson after a reload mid-tutorial', () => {
    const storage = new FakeStorage();
    const first = new GameCore({ storage, now: () => 0 });
    firstMerge(first);
    first.save();

    const restored = new GameCore({ storage, now: () => 0 });
    const offers: Extract<GameEvent, { type: 'powerupSpawned' }>[] = [];
    restored.events.on('powerupSpawned', (event) => offers.push(event));
    const healthBeforeOffer = restored.playerHealth;
    restored.update(1_000);

    expect(offers).toHaveLength(0);
    expect(restored.playerHealth).toBe(healthBeforeOffer);
    expect(restored.tutorialCompleted).toBe(false);
    expect(restored.tapBoss()).toBeGreaterThan(0);
    expect(restored.tutorialCompleted).toBe(true);
  });
});
