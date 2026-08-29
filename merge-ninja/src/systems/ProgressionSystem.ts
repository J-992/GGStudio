import { BALANCE } from '../data/balance';

/** Persists tier discovery and turns it into the tier offered by the shop. */
export class ProgressionSystem {
  highestTierEverOwned: number;

  constructor(highest = 1) {
    this.highestTierEverOwned = Math.max(1, highest);
  }

  buyTier(offset: number = BALANCE.buyTier.offset): number {
    return Math.min(
      BALANCE.tiers.count,
      Math.max(1, this.highestTierEverOwned - Math.max(0, offset)),
    );
  }

  discover(tier: number): boolean {
    if (tier <= this.highestTierEverOwned) return false;
    this.highestTierEverOwned = tier;
    return true;
  }
}
