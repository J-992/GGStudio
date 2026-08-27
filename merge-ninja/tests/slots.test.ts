import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { GameCore } from '../src/core/GameCore';
import type { StorageLike } from '../src/data/types';

class FakeStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

const S = BALANCE.slots;
const newGame = (): GameCore => new GameCore({ storage: null, now: () => 0, rng: () => 0.99 });

/** Advances the ladder without waiting out any fights. */
const climbTo = (game: GameCore, stage: number): void => {
  while (game.currentStage < stage) game.skipEnemy();
};

describe('slot unlocks', () => {
  it('starts a fresh run on the earned slots only', () => {
    const game = newGame();
    expect(game.unlockedSlotCount).toBe(S.initial);
    expect(game.lockedSlots).toHaveLength(BALANCE.board.slots - S.initial);
    expect(game.board.freeSlots).toHaveLength(S.initial);
  });

  it('accounts for every board slot between the grant and the ladder', () => {
    expect(S.initial + S.unlockStages.length).toBe(BALANCE.board.slots);
  });

  it('opens exactly one slot per unlock stage, in order', () => {
    const game = newGame();
    const opened: number[] = [];
    game.events.on('slotUnlocked', (event) => opened.push(event.slot));

    S.unlockStages.forEach((stage, index) => {
      climbTo(game, stage);
      game.defeatBossForTest();
      expect(game.unlockedSlotCount).toBe(S.initial + index + 1);
    });

    expect(opened).toEqual(S.unlockStages.map((_, index) => S.initial + index));
    expect(game.lockedSlots).toEqual([]);
    expect(game.nextUnlockStage).toBeNull();
    expect(game.nextUnlockSlot).toBeNull();
  });

  it('names the next reward until the board is whole', () => {
    const game = newGame();
    expect(game.nextUnlockStage).toBe(S.unlockStages[0]);
    expect(game.nextUnlockSlot).toBe(S.initial);
  });

  it('keeps a locked slot out of buying and moving', () => {
    const game = newGame();
    const locked = game.lockedSlots[0]!;
    game.grantCoins(100_000);

    for (let i = 0; i < S.initial + 4; i += 1) game.buy();
    expect(game.board.at(locked)).toBeNull();
    expect(game.board.freeSlots).not.toContain(locked);
    expect(game.drop(0, { kind: 'slot', slot: locked })).toBe('rejected');
  });

  it('never lets a boss throw debris into a slot the player has not earned', () => {
    const game = newGame();
    const locked = new Set(game.lockedSlots);
    for (const entry of game.debrisSlots) expect(locked.has(entry.slot)).toBe(false);
    expect(game.board.freeSlots.every((slot) => !locked.has(slot))).toBe(true);
  });

  it('relocks the board on a run reset, because a fresh climb is the point', () => {
    const game = newGame();
    climbTo(game, S.unlockStages[1]!);
    game.defeatBossForTest();
    expect(game.unlockedSlotCount).toBeGreaterThan(S.initial);

    game.resetRun();
    expect(game.unlockedSlotCount).toBe(S.initial);
    expect(game.lockedSlots).toHaveLength(BALANCE.board.slots - S.initial);
  });

  it('restores the slots a saved run had earned', () => {
    const storage = new FakeStorage();
    const game = new GameCore({ storage, now: () => 0, rng: () => 0.99 });
    climbTo(game, S.unlockStages[2]!);
    game.defeatBossForTest();
    const earned = game.unlockedSlotCount;
    game.save();

    const restored = new GameCore({ storage, now: () => 0, rng: () => 0.99 });
    expect(restored.unlockedSlotCount).toBe(earned);
  });

  it('grants the whole board to a save written before locking existed', () => {
    const storage = new FakeStorage();
    const seed = new GameCore({ storage, now: () => 0, rng: () => 0.99 });
    seed.save();
    const raw = JSON.parse(storage.getItem(BALANCE.save.key) ?? '{}') as Record<string, unknown>;
    delete raw.unlockedSlots;
    storage.setItem(BALANCE.save.key, JSON.stringify(raw));

    expect(new GameCore({ storage, now: () => 0 }).unlockedSlotCount).toBe(BALANCE.board.slots);
  });
});
