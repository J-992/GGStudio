/**
 * The daily run: one arena, one seed, one attempt, the same for everybody, and
 * a new one every midnight UTC.
 *
 * This exists for one metric. Nothing else in the game gives a player a reason
 * to come back tomorrow, so nothing else can move day-one retention off the
 * floor. A run that is gone when the clock rolls over — and a streak that
 * breaks if it is missed — is the cheapest honest version of that reason.
 *
 * Everything here is pure and clock-injectable: the day boundary, the seed, the
 * arena and the streak are all derived, never stored, so a save that travels
 * between devices or sits in localStorage over a timezone change still resolves
 * to the same challenge the rest of the world is playing.
 */

import { BIOME_IDS, type BiomeId } from './biomes.ts';
import { makeRng, rngShuffle } from './rng.ts';
import { SIMPLE_PART_IDS } from './tutorial.ts';

/** A calendar day in UTC, `YYYY-MM-DD`. The daily challenge's primary key. */
export type DayId = string;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * UTC rather than local time, and not negotiable: the whole point of a daily is
 * that two players comparing scores played the same arena. A local-midnight
 * boundary would hand Auckland and Los Angeles different challenges under the
 * same date string, and the board would be quietly comparing different games.
 */
export function dayIdFor(now: number = Date.now()): DayId {
  const stamp = Number.isFinite(now) ? now : 0;
  return new Date(stamp).toISOString().slice(0, 10);
}

/** Epoch ms of the next UTC midnight — when the current challenge expires. */
export function nextRolloverAt(now: number = Date.now()): number {
  const stamp = Number.isFinite(now) ? now : 0;
  return Math.floor(stamp / DAY_MS) * DAY_MS + DAY_MS;
}

/** Whole milliseconds left on today's challenge, never negative. */
export function millisUntilRollover(now: number = Date.now()): number {
  return Math.max(0, nextRolloverAt(now) - (Number.isFinite(now) ? now : 0));
}

/** "6h 12m" / "48m" / "under a minute" — the countdown on the daily card. */
export function formatCountdown(millis: number): string {
  const total = Math.max(0, Math.floor(millis / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return 'under a minute';
}

/**
 * Fold a day id into a 32-bit seed.
 *
 * FNV-1a over the date string: it has to be stable across machines and browser
 * versions, which rules out anything built on `Math.random` or on a hash whose
 * implementation could change under us.
 */
export function dailySeed(dayId: DayId): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < dayId.length; index += 1) {
    hash ^= dayId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Which arena today runs in. Derived from a second, differently-salted fold of
 * the same day id so the map does not march through the list in lockstep with
 * the seed — reusing `dailySeed` directly gave a visible three-day cycle.
 */
export function dailyBiome(dayId: DayId): BiomeId {
  const salted = dailySeed(`${dayId}:arena`);
  return BIOME_IDS[salted % BIOME_IDS.length];
}

/**
 * What today hands the player before they drive out.
 *
 * Two shapes, alternating on the calendar's roll, because a daily that is the
 * same exercise every day stops being a reason to come back. A `budget` day is
 * a spending problem: here is a wallet, the whole catalog is open, spend it
 * well. A `crate` day is a drafting problem: no money at all, but you may take
 * any N parts you like — so the question stops being "what can I afford" and
 * becomes "what are the N best blocks in the game for this arena".
 */
export type DailyLoadout =
  | { kind: 'budget'; money: number; kit: null }
  | { kind: 'crate'; money: 0; kit: DailyKit };

/** The block types a draft day hands out, and how many of each. */
export type DailyKit = Readonly<Record<string, number>>;

/** Wallets a budget day can roll. Spread wide enough to change what is buildable. */
const DAILY_BUDGETS: readonly number[] = [900, 1400, 2000, 2800, 3600];

/**
 * How many block types a draft day's kit contains, the structural frame
 * included. Capped at the build bar's five slots: the whole point of a draft
 * day is that everything you have is already on the bar, so a kit that spilled
 * past it would put part of itself somewhere the player has to go looking.
 */
const DAILY_KIT_SIZES: readonly number[] = [3, 4, 5];

/** Blocks a kit is always built around, because nothing mounts without them. */
const KIT_STAPLE = 'frame-box';
const KIT_STAPLE_COUNT = 8;
/** Enough of each drafted block to commit to it rather than ration it. */
const KIT_PICK_COUNT = 3;

/**
 * Blocks a draft kit can roll.
 *
 * The store's own shelf minus the two blocks that are never a choice: the
 * frame, which every kit gets anyway, and the chassis core, which the rig is
 * already built around and which cannot be placed twice.
 */
const KIT_POOL: readonly string[] = SIMPLE_PART_IDS.filter(
  (id) => id !== KIT_STAPLE && id !== 'chassis-core',
);

/**
 * The exact crate a draft day hands out — same blocks, same counts, for
 * everyone playing that date.
 *
 * Drawn with the shared seeded shuffle rather than by indexing the pool at
 * intervals, so adding a part to the catalog reshuffles the draw instead of
 * silently shifting every future day's kit by one.
 */
export function dailyKit(dayId: DayId, typeCount: number): DailyKit {
  const picks = rngShuffle(makeRng(dailySeed(`${dayId}:kit`)), KIT_POOL).slice(
    0,
    Math.max(0, typeCount - 1),
  );
  return Object.fromEntries([
    [KIT_STAPLE, KIT_STAPLE_COUNT],
    ...picks.map((defId) => [defId, KIT_PICK_COUNT] as const),
  ]);
}

/**
 * Today's rules, folded out of the date the same way the seed and arena are.
 *
 * Salted separately from both so the three do not move in lockstep — sharing a
 * fold made the big-budget days land on the same arena every time, which is the
 * one thing a daily must not do.
 */
export function dailyLoadout(dayId: DayId): DailyLoadout {
  const roll = dailySeed(`${dayId}:loadout`);
  // Two budget days for every crate day: the wallet is the mode players
  // understand on sight, and the draft is the change of pace.
  if (roll % 3 === 2) {
    const typeCount = DAILY_KIT_SIZES[(roll >>> 8) % DAILY_KIT_SIZES.length];
    return { kind: 'crate', money: 0, kit: dailyKit(dayId, typeCount) };
  }
  return {
    kind: 'budget',
    money: DAILY_BUDGETS[(roll >>> 8) % DAILY_BUDGETS.length],
    kit: null,
  };
}

/** One line for the menu card: what today is actually asking of the player. */
export function describeDailyLoadout(loadout: DailyLoadout): string {
  return loadout.kind === 'crate'
    ? `Draft day — a fixed kit of ${Object.keys(loadout.kit).length} blocks, no store.`
    : `Budget day — $${loadout.money.toLocaleString()} and the whole catalog.`;
}

/** One finished daily attempt. */
export interface DailyResult {
  dayId: DayId;
  score: number;
  wave: number;
  kills: number;
  /** Epoch ms the attempt ended. */
  at: number;
}

/**
 * Consecutive days played, counting back from today.
 *
 * Yesterday counts as well as today, so a player who has not yet had their run
 * today still sees the streak they are about to extend rather than a zero that
 * reads as already broken. That distinction is the entire motivational job of
 * the number, so it is worth the extra branch.
 */
export function dailyStreak(
  results: readonly DailyResult[],
  now: number = Date.now(),
): number {
  const played = new Set(results.map((result) => result.dayId));
  if (played.size === 0) return 0;

  const today = dayIdFor(now);
  const yesterday = dayIdFor(now - DAY_MS);
  // Anchor on whichever of the two the player actually has, so a streak is only
  // broken by missing a whole day, not by being early in the current one.
  let cursor = played.has(today) ? now : played.has(yesterday) ? now - DAY_MS : 0;
  if (cursor === 0) return 0;

  let streak = 0;
  while (played.has(dayIdFor(cursor))) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

/** Today's attempt, if it has already been played. */
export function resultForDay(
  results: readonly DailyResult[],
  dayId: DayId,
): DailyResult | null {
  return results.find((result) => result.dayId === dayId) ?? null;
}

/** Whether today's single attempt is still available. */
export function canPlayDaily(
  results: readonly DailyResult[],
  now: number = Date.now(),
): boolean {
  return resultForDay(results, dayIdFor(now)) === null;
}

/**
 * Record an attempt, keeping the better score if the same day somehow lands
 * twice. `canPlayDaily` already gates the menu, but a run finishing after
 * midnight, or two tabs, can both reach here — losing the better of the two
 * results to whichever wrote last would be the wrong answer.
 */
export function recordDailyResult(
  results: readonly DailyResult[],
  result: DailyResult,
): DailyResult[] {
  const existing = resultForDay(results, result.dayId);
  if (existing !== null && existing.score >= result.score) return [...results];
  return [
    ...results.filter((entry) => entry.dayId !== result.dayId),
    result,
  ].sort((left, right) => right.dayId.localeCompare(left.dayId));
}
