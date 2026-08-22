import { BALANCE } from '../data/balance';

/** Tracks currency and derives the cost of each ninja purchase. */
export class EconomySystem {
  coins: number;

  constructor(coins: number = BALANCE.economy.startCoins) {
    this.coins = coins;
  }

  cost(purchases: number, tier: number): number {
    return Math.round(
      Math.round(BALANCE.economy.baseCost * BALANCE.economy.costGrowth ** purchases) *
      BALANCE.economy.tierCostMultiplier ** (tier - 1)
    );
  }

  canAfford(cost: number): boolean {
    return this.coins >= cost;
  }

  add(amount: number): void {
    this.coins = Math.max(0, this.coins + amount);
  }

  spend(amount: number): boolean {
    if (!this.canAfford(amount)) return false;
    this.coins -= amount;
    return true;
  }
}
