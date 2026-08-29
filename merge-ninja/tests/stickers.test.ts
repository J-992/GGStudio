import { describe, expect, it } from 'vitest';
import { GameCore } from '../src/core/GameCore';
import { BALANCE } from '../src/data/balance';
import type { StorageLike } from '../src/data/types';

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

function defeatCurrentBoss(game: GameCore): void {
  for (let hit = 0; hit < 200 && game.boss.hp > 0; hit += 1) game.tapBoss();
  expect(game.boss.hp).toBe(0);
}

describe('boss sticker progression', () => {
  it('collects stage 1/5/10 seals, unlocks the style, and persists it', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    game.spawnTier(29);
    const events: string[] = [];
    game.events.on('bossStickerCollected', (event) => events.push(`${event.id}:${event.progress}/${event.total}`));
    game.events.on('dojoStyleUnlocked', (event) => events.push(`unlock:${event.id}`));
    game.events.on('dojoStyleEquipped', (event) => events.push(`equip:${event.id}:${event.source}`));

    defeatCurrentBoss(game);
    game.update(BALANCE.boss.defeatDelayMs);
    while (game.boss.stage < 5) game.skipEnemy();
    defeatCurrentBoss(game);
    game.update(BALANCE.boss.defeatDelayMs);
    while (game.boss.stage < 10) game.skipEnemy();
    defeatCurrentBoss(game);

    expect(events).toEqual([
      'crimson-dojo-1:1/3',
      'crimson-dojo-2:2/3',
      'crimson-dojo-3:3/3',
      'unlock:crimson-dojo',
      'equip:crimson-dojo:unlock',
    ]);
    expect(game.crimsonDojoProgress.complete).toBe(true);
    expect(game.equippedDojoStyle.id).toBe('crimson-dojo');

    const restored = new GameCore({ storage, now: () => 0 });
    expect(restored.collectedStickerIds).toEqual(new Set([
      'crimson-dojo-1', 'crimson-dojo-2', 'crimson-dojo-3',
    ]));
    expect(restored.equippedDojoStyle.id).toBe('crimson-dojo');
    expect(restored.equipDojoStyle('classic')).toBe(true);
    expect(new GameCore({ storage, now: () => 0 }).equippedDojoStyle.id).toBe('classic');
  });

  it('does not equip a style before its page is complete', () => {
    const game = new GameCore({ storage: null });
    expect(game.equipDojoStyle('crimson-dojo')).toBe(false);
    expect(game.equippedDojoStyle.id).toBe('classic');
  });
});
