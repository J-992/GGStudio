import { describe, expect, it } from 'vitest';
import { GameCore } from '../src/core/GameCore';

describe('progression', () => {
  it('emits each never-before-seen merged tier exactly once', () => {
    const game = new GameCore({ storage: null, now: () => 0 });
    const discovered: number[] = [];
    game.events.on('newTierDiscovered', (event) => discovered.push(event.tier));

    game.spawnTier(1);
    game.spawnTier(1);
    game.drop(0, { kind: 'slot', slot: 1 });
    game.spawnTier(2);
    game.drop(1, { kind: 'slot', slot: 0 });
    game.spawnTier(1);
    game.spawnTier(1);
    game.drop(1, { kind: 'slot', slot: 2 });

    expect(discovered).toEqual([2, 3]);
    expect(game.progression.highestTierEverOwned).toBe(3);
  });
});
