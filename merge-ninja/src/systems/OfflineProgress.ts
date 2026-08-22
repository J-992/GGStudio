import type { OfflineConfig } from '../data/balance';

export interface OfflineReward {
  /** How much of the absence was actually paid for, after the cap. */
  creditedMs: number;
  coins: number;
}

/**
 * Turn a closed-tab absence into a coin payout, or decide it deserves none.
 *
 * The rate handed in is the player's live earn rate (coins per second) at the
 * moment the game was last saved; offline time pays a reduced share of it.
 * Anything below the minimum window is a refresh rather than an absence, a
 * non-positive elapsed time is a clock that moved backwards, and a roster with
 * no damage has no income to credit — none of those pay.
 */
export function offlineReward(
  elapsedMs: number,
  coinsPerSecond: number,
  config: OfflineConfig,
): OfflineReward | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs < config.minMs) return null;
  if (!Number.isFinite(coinsPerSecond) || coinsPerSecond <= 0) return null;

  const creditedMs = Math.min(elapsedMs, config.capMs);
  const coins = Math.floor((creditedMs / 1000) * coinsPerSecond * config.rate);
  return coins > 0 ? { creditedMs, coins } : null;
}
