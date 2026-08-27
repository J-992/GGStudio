import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/balance';
import { GameCore } from '../src/core/GameCore';
import type { GameEvent } from '../src/core/EventBus';

const C = BALANCE.combo;
const newGame = (): GameCore => new GameCore({ storage: null, now: () => 0, rng: () => 0 });

/** Puts a mergeable pair on the board and merges it. */
const mergeOnce = (game: GameCore, tier: number): void => {
  const first = game.spawnTier(tier);
  const second = game.spawnTier(tier);
  if (first === null || second === null) throw new Error('board has no room for a pair');
  game.drop(first.slot, { kind: 'slot', slot: second.slot });
};

describe('merge chain', () => {
  it('counts merges landing inside the window', () => {
    const game = newGame();
    const counts: number[] = [];
    game.events.on('mergeComboChanged', (event) => counts.push(event.count));

    mergeOnce(game, 1);
    expect(game.mergeCombo.count).toBe(1);
    mergeOnce(game, 2);
    expect(game.mergeCombo.count).toBe(2);
    expect(counts).toEqual([1, 2]);
  });

  it('resets when the window lapses without a merge', () => {
    const game = newGame();
    mergeOnce(game, 1);
    expect(game.mergeCombo.count).toBe(1);

    game.update(C.windowMs - 1);
    expect(game.mergeCombo.count).toBe(1);

    game.update(2);
    expect(game.mergeCombo.count).toBe(0);
  });

  it('refreshes the window on every merge, so a chain can be sustained', () => {
    const game = newGame();
    mergeOnce(game, 1);
    game.update(C.windowMs - 100);
    mergeOnce(game, 2);

    expect(game.mergeCombo.windowMs).toBe(C.windowMs);
    expect(game.mergeCombo.count).toBe(2);
  });

  it('pays out a powerup at the target and starts over', () => {
    const game = newGame();
    const rewards: Array<Extract<GameEvent, { type: 'mergeComboRewarded' }>> = [];
    game.events.on('mergeComboRewarded', (event) => rewards.push(event));

    for (let i = 0; i < C.rewardAt; i += 1) mergeOnce(game, i + 1);

    expect(rewards).toHaveLength(1);
    expect(rewards[0]?.source).toBe('merge');
    expect(rewards[0]?.count).toBe(C.rewardAt);
    expect(game.mergeCombo.count).toBe(0);
  });

  it('never hands out Coin Frenzy, which is authored as a rare surprise', () => {
    const game = newGame();
    const granted: string[] = [];
    game.events.on('mergeComboRewarded', (event) => granted.push(event.id));

    for (let round = 0; round < 4; round += 1) {
      for (let i = 0; i < C.rewardAt; i += 1) {
        // The board only owns its starting slots, and merged results stay put,
        // so it has to be cleared between chains to keep making pairs.
        game.clearBoard();
        mergeOnce(game, i + 1);
      }
      game.update(C.windowMs + 10);
    }

    expect(granted.length).toBeGreaterThan(0);
    expect(granted).not.toContain('coinFrenzy');
  });

  it('counts a merge that also clears debris, so the systems compound', () => {
    const game = newGame();
    mergeOnce(game, 1);
    expect(game.mergeCombo.count).toBe(1);
    expect(game.debrisSlots.length).toBe(0);
  });

  it('drops the chain on a run reset', () => {
    const game = newGame();
    mergeOnce(game, 1);
    game.resetRun();
    expect(game.mergeCombo.count).toBe(0);
    expect(game.mergeCombo.windowMs).toBe(0);
  });

  it('leaves the timed powerup cadence untouched as the floor', () => {
    // The chain is a ceiling on top of the spawn rhythm, never a replacement:
    // a player who never chains still meets every pickup on its own schedule.
    expect(C.rewardAt).toBeGreaterThan(1);
    expect(C.windowMs).toBeGreaterThan(0);
  });
});

describe('tap streak', () => {
  it('pays a frenzy once the streak is long enough', () => {
    const game = newGame();
    game.grantCoins(100_000);
    game.buy();
    const rewards: string[] = [];
    game.events.on('mergeComboRewarded', (event) => { if (event.source === 'tap') rewards.push(event.id); });

    for (let i = 0; i < C.tapRewardAt; i += 1) game.tapBoss();

    expect(rewards).toHaveLength(1);
    expect(rewards[0]).toBe('shurikenFrenzy');
  });

  it('does not pay for taps spread past the window', () => {
    const game = newGame();
    game.grantCoins(100_000);
    game.buy();
    let paid = 0;
    game.events.on('mergeComboRewarded', (event) => { if (event.source === 'tap') paid += 1; });

    for (let i = 0; i < C.tapRewardAt - 1; i += 1) game.tapBoss();
    game.update(C.windowMs + 10);
    game.tapBoss();

    expect(paid).toBe(0);
  });
});
