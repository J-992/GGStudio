import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { DebrisField } from '../src/systems/DebrisField';
import { MergeSystem } from '../src/systems/MergeSystem';

const D = BALANCE.debris;
const allSlots = Array.from({ length: BALANCE.board.slots }, (_, i) => i);
/** Always throws, and always takes the first candidate slot. */
const alwaysThrow = (): number => 0;
const neverThrow = (): number => 1;

describe('debris placement', () => {
  it('throws nothing before its starting stage', () => {
    const field = new DebrisField({ rng: alwaysThrow });
    expect(field.maybeThrow(D.startStage - 1, allSlots)).toBeNull();
    expect(field.chanceAt(D.startStage - 1)).toBe(0);
  });

  it('never leaves the board too tight to act on', () => {
    const field = new DebrisField({ rng: alwaysThrow });
    expect(field.maybeThrow(D.startStage, allSlots.slice(0, D.minFreeSlots))).toBeNull();
    expect(field.maybeThrow(D.startStage, allSlots.slice(0, D.minFreeSlots + 1))).not.toBeNull();
  });

  it('never holds more slots at once than the cap allows', () => {
    const field = new DebrisField({ rng: alwaysThrow });
    for (let i = 0; i < D.maxConcurrent + 3; i += 1) {
      field.maybeThrow(D.startStage, allSlots.filter((slot) => !field.has(slot)));
    }
    expect(field.count).toBe(D.maxConcurrent);
  });

  it('respects the roll, so most swings throw nothing', () => {
    expect(new DebrisField({ rng: neverThrow }).maybeThrow(D.startStage, allSlots)).toBeNull();
  });

  it('ramps its chance with the stage, up to a ceiling', () => {
    const field = new DebrisField({ rng: alwaysThrow });
    expect(field.chanceAt(D.startStage)).toBeCloseTo(D.chanceBase, 6);
    expect(field.chanceAt(D.startStage + 10)).toBeGreaterThan(field.chanceAt(D.startStage));
    expect(field.chanceAt(D.startStage + 10_000)).toBe(D.chanceMax);
  });

  it('throws nothing at all during a grace period', () => {
    const field = new DebrisField({ rng: alwaysThrow });
    field.startGrace();
    expect(field.inGrace).toBe(true);
    expect(field.maybeThrow(D.startStage, allSlots)).toBeNull();

    field.update(D.graceMs, () => {});
    expect(field.inGrace).toBe(false);
    expect(field.maybeThrow(D.startStage, allSlots)).not.toBeNull();
  });
});

describe('debris clearing', () => {
  it('clears itself on its own timer even if the player does nothing', () => {
    const field = new DebrisField({ rng: alwaysThrow });
    const slot = field.maybeThrow(D.startStage, allSlots);
    const expired: number[] = [];

    field.update(D.holdMs - 1, (s) => expired.push(s));
    expect(expired).toEqual([]);

    field.update(1, (s) => expired.push(s));
    expect(expired).toEqual([slot]);
    expect(field.count).toBe(0);
  });

  it('clears when a merge lands beside it, and not when it lands elsewhere', () => {
    const board = new MergeSystem();
    const field = new DebrisField({ rng: alwaysThrow });
    field.load([{ slot: 5, msLeft: D.holdMs }]);

    const far: number[] = [];
    field.clearNear(board.neighbours(0), (s) => far.push(s));
    expect(far).toEqual([]);

    const near: number[] = [];
    field.clearNear(board.neighbours(6), (s) => near.push(s));
    expect(near).toEqual([5]);
    expect(field.count).toBe(0);
  });

  it('round trips through a save without gaining time', () => {
    const field = new DebrisField({ rng: alwaysThrow });
    field.maybeThrow(D.startStage, allSlots);
    field.update(2_000, () => {});

    const restored = new DebrisField({ rng: alwaysThrow });
    restored.load(field.serialize());
    expect(restored.serialize()).toEqual(field.serialize());
    expect(restored.all[0]?.msLeft).toBeLessThan(D.holdMs);
  });
});

describe('board occupancy with blocked and locked slots', () => {
  it('keeps a blocked slot out of every path that could fill it', () => {
    const board = new MergeSystem();
    expect(board.block(3)).toBe(true);

    expect(board.usable(3)).toBe(false);
    expect(board.spawn(1, 3)).toBeNull();
    expect(board.freeSlots).not.toContain(3);

    board.spawn(1, 0);
    expect(board.move(0, 3)).toBeNull();
    expect(board.at(0)).not.toBeNull();
  });

  it('refuses to block a slot that already holds a ninja', () => {
    const board = new MergeSystem();
    board.spawn(1, 2);
    expect(board.block(2)).toBe(false);
  });

  it('skips blocked slots when finding the first empty one', () => {
    const board = new MergeSystem();
    board.block(0);
    board.block(1);
    expect(board.firstEmpty()).toBe(2);
  });

  it('locks every slot above the earned count without deleting anyone', () => {
    const board = new MergeSystem();
    board.spawn(1, 9);
    board.setUnlockedCount(BALANCE.slots.initial);

    expect(board.isLocked(BALANCE.slots.initial)).toBe(true);
    expect(board.isLocked(BALANCE.slots.initial - 1)).toBe(false);
    expect(board.at(9)?.tier).toBe(1);
    expect(board.freeSlots.every((slot) => slot < BALANCE.slots.initial)).toBe(true);
  });

  it('reports orthogonal neighbours only, and never off the grid', () => {
    const board = new MergeSystem();
    const { cols } = BALANCE.board;
    expect(board.neighbours(0).sort((a, b) => a - b)).toEqual([1, cols]);
    expect(board.neighbours(cols - 1)).toContain(cols - 2);
    expect(board.neighbours(cols - 1)).not.toContain(cols);
    board.neighbours(BALANCE.board.slots - 1).forEach((slot) => {
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(BALANCE.board.slots);
    });
  });
});
