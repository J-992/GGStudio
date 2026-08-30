// The two currencies, kept deliberately apart:
//   coins  -- in-level only, produced by Cocofanto and the sky, spent planting
//   coins  -- meta, paid by dead monsters, banked ONLY on victory,
//             spent in the shop between levels
class Economy {
  constructor() {
    this.energy = 0;                  // doge coins
    this.pendingCoins = 0;            // this level's kill money, banked on win
  }

  canAfford(n) { return this.energy >= n; }

  spend(n) {
    if (!this.canAfford(n)) return false;
    this.energy -= n;
    return true;
  }

  earnEnergy(n) { this.energy += n; }

  earnCoins(n) { this.pendingCoins += n; }

  // victory: move the level's take into the persistent wallet
  bank(bonus) {
    const total = this.pendingCoins + (bonus || 0);
    SaveSys.data.coins += total;
    SaveSys.addStat('coinsEarned', total);
    SaveSys.save();
    this.pendingCoins = 0;
    return total;
  }
}
window.Economy = Economy;
