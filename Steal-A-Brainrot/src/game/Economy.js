// Coins + tickets, the game's only two currencies (design rule). Coins feed
// the Brainrot Machine; tickets come from bosses and buy guaranteed rare pulls.
class Economy {
  constructor() {
    this.coins = 0;
    this.tickets = 0;
  }

  canAfford(n) { return this.coins >= n; }

  spend(n) {
    if (!this.canAfford(n)) return false;
    this.coins -= n;
    return true;
  }

  earn(n) {
    this.coins += n;
    SaveSys.addStat('coinsEarned', n);
  }

  earnTickets(n) { this.tickets += n; }

  spendTicket() {
    if (this.tickets < 1) return false;
    this.tickets -= 1;
    return true;
  }
}
window.Economy = Economy;
