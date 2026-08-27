import { describe, expect, it } from 'vitest';
import { BALANCE, sellValueOf } from '../src/data/balance';
import { GameCore } from '../src/core/GameCore';
import type { StorageLike } from '../src/data/types';

const newGame = () => new GameCore({ storage: null, now: () => 0 });

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

describe('merge board', () => {
  it('merges matching tiers into the target, frees the source, and gives the result a fresh id', () => {
    const game = newGame();
    const source = game.spawnTier(1)!;
    const target = game.spawnTier(1)!;

    expect(game.drop(0, { kind: 'slot', slot: 1 })).toBe('merged');
    expect(game.board.at(0)).toBeNull();
    expect(game.board.at(1)).toMatchObject({ tier: 2, slot: 1 });
    expect(game.board.at(1)?.id).not.toBe(source.id);
    expect(game.board.at(1)?.id).not.toBe(target.id);
  });

  it('swaps with a different-tier occupant, both ninjas keeping their ids and tiers', () => {
    const game = newGame();
    const first = game.spawnTier(1)!;
    const second = game.spawnTier(2)!;

    expect(game.drop(0, { kind: 'slot', slot: 1 })).toBe('swapped');
    expect(game.board.at(0)?.id).toBe(second.id);
    expect(game.board.at(0)?.tier).toBe(2);
    expect(game.board.at(1)?.id).toBe(first.id);
    expect(game.board.at(1)?.tier).toBe(1);
  });

  it('keeps both slot fields in step after a swap', () => {
    const game = newGame();
    const first = game.spawnTier(1)!;
    const second = game.spawnTier(4)!;

    game.drop(0, { kind: 'slot', slot: 1 });
    expect(first.slot).toBe(1);
    expect(second.slot).toBe(0);
    expect(game.board.slots[0]).toEqual(second);
    expect(game.board.slots[1]).toEqual(first);
  });

  it('emits ninjaSwapped carrying both ids, tiers, and slots', () => {
    const game = newGame();
    const first = game.spawnTier(1)!;
    const second = game.spawnTier(2)!;
    const swaps: unknown[] = [];
    game.events.on('ninjaSwapped', (event) => swaps.push(event));

    expect(game.drop(0, { kind: 'slot', slot: 1 })).toBe('swapped');
    expect(swaps).toEqual([
      { type: 'ninjaSwapped', fromSlot: 0, toSlot: 1, ids: [first.id, second.id], tiers: [1, 2] },
    ]);
  });

  it('refuses to swap onto an empty or out-of-range cell', () => {
    const game = newGame();
    const ninja = game.spawnTier(1)!;

    expect(game.board.swap(0, 5)).toBeNull();
    expect(game.board.swap(0, -1)).toBeNull();
    expect(game.board.swap(11, 0)).toBeNull();
    expect(game.board.at(0)).toEqual(ninja);
    expect(game.board.at(5)).toBeNull();
  });

  it('still moves when the target cell is empty', () => {
    const game = newGame();
    const first = game.spawnTier(2)!;
    const second = game.spawnTier(3)!;

    expect(game.drop(0, { kind: 'slot', slot: 4 })).toBe('moved');
    expect(game.board.at(4)?.id).toBe(first.id);
    expect(game.board.at(1)?.id).toBe(second.id);
  });

  // SPEC: dropping a max-tier pair must resolve as a trade, never a silent
  // refusal. The fallback belongs in GameCore.drop (same-tier path): when
  // board.merge() returns null because both units sit at BALANCE.tiers.count,
  // fall through to board.swap and emit ninjaSwapped like any other trade.
  // This test pins that contract from the UI's side.
  it('drops a max-tier pair into a swap instead of refusing it silently', () => {
    const game = newGame();
    const first = game.spawnTier(BALANCE.tiers.count)!;
    const second = game.spawnTier(BALANCE.tiers.count)!;

    expect(game.drop(0, { kind: 'slot', slot: 1 })).toBe('swapped');
    expect(game.board.at(0)?.id).toBe(second.id);
    expect(game.board.at(0)?.tier).toBe(BALANCE.tiers.count);
    expect(game.board.at(1)?.id).toBe(first.id);
    expect(game.board.at(1)?.tier).toBe(BALANCE.tiers.count);
  });

  it('returns the board to its original arrangement after swapping twice', () => {
    const game = newGame();
    const first = game.spawnTier(2)!;
    const second = game.spawnTier(5)!;

    expect(game.drop(0, { kind: 'slot', slot: 1 })).toBe('swapped');
    expect(game.drop(0, { kind: 'slot', slot: 1 })).toBe('swapped');
    expect(game.board.at(0)?.id).toBe(first.id);
    expect(game.board.at(0)?.tier).toBe(2);
    expect(game.board.at(1)?.id).toBe(second.id);
    expect(game.board.at(1)?.tier).toBe(5);
  });

  it('keeps a swap across a save/load round-trip, identities included', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    const first = game.spawnTier(1)!;
    const second = game.spawnTier(4)!;

    expect(game.drop(0, { kind: 'slot', slot: 1 })).toBe('swapped');
    game.save();

    const restored = new GameCore({ storage, now: () => 0 });
    expect(restored.board.at(0)?.id).toBe(second.id);
    expect(restored.board.at(0)?.tier).toBe(4);
    expect(restored.board.at(1)?.id).toBe(first.id);
    expect(restored.board.at(1)?.tier).toBe(1);
  });

  it('moves a ninja when dropped on an empty slot', () => {
    const game = newGame();
    const ninja = game.spawnTier(1)!;

    expect(game.drop(0, { kind: 'slot', slot: 4 })).toBe('moved');
    expect(game.board.at(0)).toBeNull();
    expect(game.board.at(4)?.id).toBe(ninja.id);
  });

  it('rejects a drop onto its own slot without changing anything', () => {
    const game = newGame();
    const ninja = game.spawnTier(3)!;

    expect(game.drop(0, { kind: 'slot', slot: 0 })).toBe('rejected');
    expect(game.board.at(0)).toEqual(ninja);
    expect(game.metrics.merges).toBe(0);
  });

  it('sells through trash, credits its value, and emits sale and coin events', () => {
    const game = newGame();
    const ninja = game.spawnTier(3)!;
    const coins = game.economy.coins;
    const events: string[] = [];
    game.events.on('ninjaSold', () => events.push('ninjaSold'));
    game.events.on('coinsChanged', () => events.push('coinsChanged'));

    expect(game.drop(0, { kind: 'trash' })).toBe('sold');
    expect(game.economy.coins).toBe(coins + sellValueOf(3));
    expect(game.board.at(0)).toBeNull();
    expect(events).toEqual(['coinsChanged', 'ninjaSold']);
    expect(ninja.slot).toBe(0);
  });

  it('can free a full one-of-each-tier board through the trash', () => {
    const game = newGame();
    // A fresh run only owns its starting slots, so "full" means every slot the
    // player has actually earned -- which is the board that can deadlock.
    const usable = game.board.freeSlots.length;
    for (let tier = 1; tier <= usable; tier += 1) game.spawnTier(tier);
    const last = usable - 1;

    expect(game.board.firstEmpty()).toBeNull();
    expect(game.drop(last, { kind: 'trash' })).toBe('sold');
    expect(game.board.firstEmpty()).toBe(last);
    expect(game.board.at(last)).toBeNull();
  });

  it('persists a swap once the dirty board flushes to the save slot', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0 });
    game.spawnTier(1);
    game.spawnTier(3);

    expect(game.drop(0, { kind: 'slot', slot: 1 })).toBe('swapped');
    game.update(BALANCE.save.flushMs);

    const saved = JSON.parse(storage.getItem(BALANCE.save.key)!);
    expect(saved.board.filter((unit: unknown) => unit !== null).map((unit: { tier: number }) => unit.tier)).toEqual([3, 1]);

    const restored = new GameCore({ storage, now: () => 0 });
    expect(restored.board.at(0)?.tier).toBe(3);
    expect(restored.board.at(1)?.tier).toBe(1);
  });
});
