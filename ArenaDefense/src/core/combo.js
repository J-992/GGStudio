/**
 * Kill-streak combo tracking.
 *
 * A combo stays alive as long as kills keep landing within `combo.windowS`
 * seconds of each other — each kill *resets* the window rather than the
 * window being measured from the combo's start, so a fast, sustained streak
 * can run arbitrarily long. `update(t)` must be polled every frame; it
 * reports `ended: true` exactly once, on the frame the rolling window since
 * the last kill finally expires.
 */
export class ComboTracker {
  /**
   * @param {import('./types.js').GameConfig} cfg
   */
  constructor(cfg) {
    this._cfg = cfg;
    this._active = false;
    this._kills = 0;
    this._lastKillT = 0;
  }

  /**
   * @param {number} t Current time in seconds.
   */
  onKill(t) {
    this._active = true;
    this._kills += 1;
    this._lastKillT = t;
  }

  /**
   * @param {number} t Current time in seconds.
   * @returns {{ ended: boolean, kills: number, coins: number }}
   */
  update(t) {
    if (this._active && t - this._lastKillT >= this._cfg.combo.windowS) {
      const kills = this._kills;
      const coins = this.tierFor(kills);
      this._active = false;
      this._kills = 0;
      return { ended: true, kills, coins };
    }
    return { ended: false, kills: this._kills, coins: this._active ? this.tierFor(this._kills) : 0 };
  }

  /**
   * @param {number} t Current time in seconds.
   * @returns {number} 0..1 fraction of the window left before the combo expires; 0 while inactive.
   */
  remaining(t) {
    if (!this._active) return 0;
    const left = this._cfg.combo.windowS - (t - this._lastKillT);
    return Math.min(1, Math.max(0, left / this._cfg.combo.windowS));
  }

  /**
   * Coins for the highest tier reached by `kills`, or 0 if below the first tier.
   *
   * @param {number} kills
   * @returns {number}
   */
  tierFor(kills) {
    let coins = 0;
    for (const tier of this._cfg.combo.tiers) {
      if (kills >= tier.kills) coins = tier.coins;
    }
    return coins;
  }
}
