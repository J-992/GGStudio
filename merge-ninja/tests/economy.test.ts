import { describe, expect, it } from 'vitest';
import { BALANCE, sellValueOf } from '../src/data/balance';
import { TEMPO_PHASES } from '../src/data/pacing';
import { GameCore } from '../src/core/GameCore';
import { EconomySystem } from '../src/systems/EconomySystem';

const newGame = () => new GameCore({ storage: null, now: () => 0 });
const economy = () => new EconomySystem();

describe('economy', () => {
  it('raises cost with total purchases', () => {
    // The per-purchase inflation is deliberately gentle (1.01), so compare
    // across a realistic stretch of buys rather than a single step, where
    // integer rounding would hide it.
    expect(economy().cost(40, 1)).toBeGreaterThan(economy().cost(0, 1));
  });

  it('raises cost with buy tier', () => {
    expect(economy().cost(0, 2)).toBeGreaterThan(economy().cost(0, 1));
  });

  it('scales the cost between adjacent shop tiers by the configured multiplier', () => {
    const { tierCostMultiplier } = BALANCE.economy;
    for (const tier of [1, 2, 5, 10]) {
      const ratio = economy().cost(0, tier + 1) / economy().cost(0, tier);
      expect(ratio, `tier ${tier} -> ${tier + 1}`).toBeCloseTo(tierCostMultiplier, 1);
    }
  });

  it('keeps the price shown to the player as a whole coin amount', () => {
    expect(Number.isInteger(economy().cost(100, 8))).toBe(true);
  });

  it('refunds half of the tier cost when a ninja is sold', () => {
    for (const tier of [1, 4, 12, 29]) {
      const shopPrice = Math.round(
        BALANCE.economy.baseCost * BALANCE.economy.tierCostMultiplier ** (tier - 1),
      );
      const refund = sellValueOf(tier);
      expect(refund).toBe(Math.round(shopPrice * BALANCE.economy.sellRefund));
      expect(Math.abs(refund - shopPrice / 2)).toBeLessThanOrEqual(1);
    }
  });

  it('covers the opening two buys so the first merge needs no waiting', () => {
    const game = newGame();
    const openingTier = TEMPO_PHASES[0]!.buyTierOffset === 0
      ? 1
      : game.buyTier;
    const first = economy().cost(0, openingTier);
    const second = economy().cost(1, openingTier);
    expect(BALANCE.economy.startCoins).toBeGreaterThanOrEqual(first + second);
    game.economy.coins = BALANCE.economy.startCoins;
    expect(game.buy()).not.toBeNull();
    expect(game.buy()).not.toBeNull();
  });

  it('uses the revised buy tier formula at its boundary tiers', () => {
    const game = newGame();
    const offset = TEMPO_PHASES[0]!.buyTierOffset;
    expect(game.buyTier).toBe(1);
    game.spawnTier(offset + 1);
    expect(game.buyTier).toBe(1);
    game.spawnTier(offset + 2);
    expect(game.buyTier).toBe(2);
    game.spawnTier(offset + 8);
    expect(game.buyTier).toBe(8);
  });

  it('never makes coins negative and reports an unaffordable purchase', () => {
    const game = newGame();
    let reason = '';
    game.economy.coins = 0;
    game.events.on('purchaseRejected', (event) => {
      reason = event.reason;
    });

    expect(game.buy()).toBeNull();
    expect(game.economy.coins).toBe(0);
    expect(reason).toBe('coins');
  });

  it('reports a full board purchase and spends nothing', () => {
    const game = newGame();
    let reason = '';
    for (let index = 0; index < BALANCE.board.slots; index += 1) game.spawnTier(1);
    const coins = game.economy.coins;
    game.events.on('purchaseRejected', (event) => {
      reason = event.reason;
    });

    expect(game.buy()).toBeNull();
    expect(reason).toBe('boardFull');
    expect(game.economy.coins).toBe(coins);
    expect(game.metrics.boardFullCount).toBe(1);
  });
});
