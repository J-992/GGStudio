/**
 * Pure helpers around a run's end: coin totals (with an optional one-time
 * doubler) and best-wave bookkeeping. Split out of `game/Game.js` so the
 * money math a run-end screen depends on is unit-testable with `node --test`
 * and nothing else — see `../../AGENTS.md`.
 */

/**
 * @param {number} coins
 * @param {boolean} doubled
 * @returns {number} `coins`, doubled when `doubled` is true. Idempotent to
 *   call once per run-end regardless of the ad outcome — pass `false` when
 *   the doubler wasn't granted (or wasn't offered) and the amount is
 *   unchanged.
 */
export function applyDoubler(coins, doubled) {
  return doubled ? coins * 2 : coins;
}

/**
 * @param {number} savedCoins Coins already on the save (`save.coins`).
 * @param {number} earnedCoins This run's final take — `economy.bankedCoins`,
 *   already passed through `applyDoubler` if a doubler was granted.
 * @returns {number} New save `coins` total. Clamping to `cfg.save.maxCoins`
 *   is `core/storage.js#sanitize`'s job (every `saveSave` call runs the
 *   patch through it), not this function's.
 */
export function coinsForRun(savedCoins, earnedCoins) {
  return savedCoins + earnedCoins;
}

/**
 * @param {number} prevBestWave
 * @param {number} wave The wave that was just cleared.
 * @returns {number}
 */
export function bestWaveAfter(prevBestWave, wave) {
  return Math.max(prevBestWave, wave);
}
