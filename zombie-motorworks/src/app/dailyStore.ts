import {
  recordDailyResult,
  type DailyResult,
} from '../core/dailyChallenge.ts';

export const DAILY_STORAGE_KEY = 'scraprig.daily.v1';

/**
 * How many past days to keep. Long enough to show a month's streak on the
 * title card, short enough that the record can never grow without bound in a
 * storage slot shared with the garage and the leaderboard.
 */
export const DAILY_HISTORY_LIMIT = 60;

export interface DailyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): DailyStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** `YYYY-MM-DD`, checked rather than trusted — it is the record's primary key. */
function isDayId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isDailyResult(value: unknown): value is DailyResult {
  return (
    isRecord(value) &&
    isDayId(value.dayId) &&
    isNonNegativeInteger(value.score) &&
    isNonNegativeInteger(value.wave) &&
    isNonNegativeInteger(value.kills) &&
    isNonNegativeInteger(value.at)
  );
}

/** Parses stored daily history, discarding anything that fails validation. */
export function decodeDailyResults(json: string | null): DailyResult[] {
  if (json === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isDailyResult)
    .sort((left, right) => right.dayId.localeCompare(left.dayId))
    .slice(0, DAILY_HISTORY_LIMIT);
}

export function encodeDailyResults(results: readonly DailyResult[]): string {
  return JSON.stringify(results.slice(0, DAILY_HISTORY_LIMIT));
}

/** Daily-run history at the application boundary. Never throws. */
export class DailyStore {
  private cached: DailyResult[] | undefined;

  constructor(private readonly storage: DailyStorage | null = browserStorage()) {}

  /** Every recorded attempt, newest day first. */
  load(): DailyResult[] {
    if (this.cached !== undefined) return this.cached;

    let json: string | null = null;
    try {
      json = this.storage?.getItem(DAILY_STORAGE_KEY) ?? null;
    } catch {
      // Storage can be unavailable in privacy mode or under a strict origin.
    }
    this.cached = decodeDailyResults(json);
    return this.cached;
  }

  /** Files a finished attempt and returns the updated history. */
  record(result: DailyResult): DailyResult[] {
    const results = recordDailyResult(this.load(), result).slice(
      0,
      DAILY_HISTORY_LIMIT,
    );
    this.cached = results;
    try {
      this.storage?.setItem(DAILY_STORAGE_KEY, encodeDailyResults(results));
    } catch {
      // A failed write must not break the run that just ended.
    }
    return results;
  }

  /**
   * Deliberately not cleared by "New Game". A daily streak is a record of days
   * the player showed up, not of progress inside one save, and wiping it when
   * they restart a campaign would punish exactly the returning player the
   * daily exists to keep.
   */
  clear(): void {
    this.cached = [];
    try {
      this.storage?.removeItem(DAILY_STORAGE_KEY);
    } catch {
      // Nothing to recover from: the in-memory history is already empty.
    }
  }
}

export const dailyStore = new DailyStore();
