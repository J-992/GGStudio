/**
 * The welcome-back gift for a new calendar day.
 *
 * This is deliberately not a login streak. Nothing accumulates that can be
 * broken, missing a week costs exactly nothing, and the game never asks the
 * player to come back -- it only notices when they do. A streak counter would
 * turn a nice surprise into an obligation, which is the exact pattern this
 * game is meant to avoid.
 *
 * The bonus pays a few minutes of the player's own earn rate, so it keeps
 * meaning something after hours of play, with a flat floor for the early run
 * where that rate is still near zero.
 */

export interface DailyBonusConfig {
  secondsOfIncome: number;
  minCoins: number;
}

export interface DailyBonusResult {
  /** The local day this visit belongs to; store it and pass it back next time. */
  dayIndex: number;
  coins: number;
  /** How many distinct days this player has ever shown up, this one included. */
  daysVisited: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Which local calendar day a moment belongs to, as a whole number of days.
 *
 * The offset is minutes *behind* UTC exactly as `Date.prototype.getTimezoneOffset`
 * reports it, so the caller can hand in a fixed value under test and the live
 * game can read the player's real clock.
 */
export function localDayIndex(nowMs: number, timezoneOffsetMinutes: number): number {
  if (!Number.isFinite(nowMs)) return 0;
  const offsetMs = Number.isFinite(timezoneOffsetMinutes) ? timezoneOffsetMinutes * 60_000 : 0;
  return Math.floor((nowMs - offsetMs) / MS_PER_DAY);
}

/** The player's current local day, read from the host clock. */
export function currentDayIndex(nowMs: number): number {
  return localDayIndex(nowMs, new Date(nowMs).getTimezoneOffset());
}

/**
 * Decide what a visit on `dayIndex` is worth.
 *
 * Returns null when the day has already been claimed -- reloading the page
 * twenty times in an afternoon pays once. A clock that has moved backwards
 * (a traveller, a corrected system time) is treated as the same day rather
 * than as a fresh one, so the bonus can never be farmed by winding the clock.
 */
export function dailyBonus(
  lastVisitDay: number | null | undefined,
  dayIndex: number,
  coinsPerSecond: number,
  daysVisited: number,
  config: DailyBonusConfig,
): DailyBonusResult | null {
  if (!Number.isFinite(dayIndex)) return null;
  const today = Math.floor(dayIndex);
  const last = typeof lastVisitDay === 'number' && Number.isFinite(lastVisitDay)
    ? Math.floor(lastVisitDay)
    : null;
  if (last !== null && today <= last) return null;

  const rate = Number.isFinite(coinsPerSecond) && coinsPerSecond > 0 ? coinsPerSecond : 0;
  const earned = Math.floor(rate * config.secondsOfIncome);
  const before = Number.isFinite(daysVisited) && daysVisited > 0 ? Math.floor(daysVisited) : 0;

  return {
    dayIndex: today,
    coins: Math.max(config.minCoins, earned),
    daysVisited: before + 1,
  };
}
