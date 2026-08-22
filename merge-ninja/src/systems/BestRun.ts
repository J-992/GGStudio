/**
 * Personal bests: the one number in the game that survives losing.
 *
 * A run ends and everything it built is gone -- that is the design, and it is
 * why the end screen needs something the player keeps. These four records are
 * it. They also give the next run a target that is visibly *theirs* rather
 * than a designer's threshold, which is the whole retention argument for
 * keeping them.
 */

/** What one finished run achieved. */
export interface RunResult {
  stage: number;
  /** Highest tier the run ever owned, not merely what was on the board at the end. */
  tier: number;
  coins: number;
  timeMs: number;
}

/** The best value ever seen for each stat, across every run. */
export type BestRun = RunResult;

/** Which of the four stats this run just beat. */
export interface RecordFlags {
  stage: boolean;
  tier: boolean;
  coins: boolean;
  timeMs: boolean;
}

export interface BestComparison {
  /** The record board after folding this run in. */
  best: BestRun;
  records: RecordFlags;
  /** True when the run beat at least one record, so the end screen can celebrate. */
  beatAny: boolean;
  /** What the board held before this run; zeros on a first-ever run. */
  previous: BestRun;
}

const EMPTY: BestRun = { stage: 0, tier: 0, coins: 0, timeMs: 0 };

/** Zeros for anything missing, negative, fractional or not a number at all. */
const clean = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

const sanitize = (run: Partial<RunResult> | null | undefined): BestRun => ({
  stage: clean(run?.stage),
  tier: clean(run?.tier),
  coins: clean(run?.coins),
  timeMs: clean(run?.timeMs),
});

/** A stored record board, with anything corrupt or absent read as "no record yet". */
export function normalizeBest(value: unknown): BestRun {
  if (typeof value !== 'object' || value === null) return { ...EMPTY };
  return sanitize(value as Partial<RunResult>);
}

/**
 * Fold a finished run into the record board.
 *
 * A first-ever run compares against zeros, so a stage-1 defeat with nothing
 * earned sets no records and the end screen stays honest -- "NEW BEST: 0
 * COINS" would cheapen the badge everywhere else it appears.
 */
export function improveBest(previous: BestRun | null, run: Partial<RunResult>): BestComparison {
  const before = normalizeBest(previous);
  const result = sanitize(run);

  const records: RecordFlags = {
    stage: result.stage > before.stage,
    tier: result.tier > before.tier,
    coins: result.coins > before.coins,
    timeMs: result.timeMs > before.timeMs,
  };

  return {
    best: {
      stage: Math.max(before.stage, result.stage),
      tier: Math.max(before.tier, result.tier),
      coins: Math.max(before.coins, result.coins),
      timeMs: Math.max(before.timeMs, result.timeMs),
    },
    records,
    beatAny: records.stage || records.tier || records.coins || records.timeMs,
    previous: before,
  };
}
