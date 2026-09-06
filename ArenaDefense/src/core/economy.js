/**
 * Per-run resource state: build-phase energy, and the coins/pending split
 * that lets a death discard only the current run's unbanked winnings.
 *
 * Coins earned during a wave (combo tiers, boss kill) go to `pendingCoins`.
 * `bankWave()` moves them into `bankedCoins` on a clean wave clear;
 * `discardPending()` drops them on death. Only `bankedCoins` is ever
 * persisted (see `storage.js`).
 */
export class Economy {
  /**
   * @param {import('./types.js').GameConfig} cfg
   */
  constructor(cfg) {
    this.energy = cfg.build.startEnergy;
    this.pendingCoins = 0;
    this.bankedCoins = 0;
  }

  /**
   * @param {number} cost
   * @returns {boolean}
   */
  canAfford(cost) {
    return this.energy >= cost;
  }

  /**
   * @param {number} cost
   * @returns {boolean} Whether the spend succeeded (false if unaffordable; energy is left unchanged).
   */
  spend(cost) {
    if (!this.canAfford(cost)) return false;
    this.energy -= cost;
    return true;
  }

  /**
   * @param {number} amount
   */
  addEnergy(amount) {
    this.energy = Math.max(0, this.energy + amount);
  }

  /**
   * @param {number} amount
   */
  addCoins(amount) {
    this.pendingCoins += amount;
  }

  /** Moves this wave's pending coins into the persisted bank. */
  bankWave() {
    this.bankedCoins += this.pendingCoins;
    this.pendingCoins = 0;
  }

  /** Drops this wave's pending coins on death — already-banked coins are untouched. */
  discardPending() {
    this.pendingCoins = 0;
  }

  /**
   * Energy refunded for calling the build phase early ("Ready").
   *
   * @param {number} secondsLeft Time remaining in the build countdown.
   * @param {import('./types.js').GameConfig} cfg
   * @returns {number}
   */
  readyRefund(secondsLeft, cfg) {
    return Math.floor(Math.max(0, secondsLeft) * cfg.build.refundEnergyPerS);
  }
}
